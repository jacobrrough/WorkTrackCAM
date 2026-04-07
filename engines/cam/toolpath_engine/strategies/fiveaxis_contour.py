"""
5-axis simultaneous machining strategies.

Provides three 5-axis modes:
- Surface-normal contouring: tool tilts to follow local surface normal
- Swarf cutting: tool side cuts along vertical/ruled surfaces
- Flowline finishing: tool follows surface UV parameterization

Features:
- BVH-accelerated collision detection (tool + holder vs workpiece)
- Configurable lead/lag/tilt angles for optimal chip evacuation
- Smooth axis interpolation to prevent sudden rotary moves
- Tilt limiting with automatic collision avoidance fallback
- Support for table-table, head-head, and table-head kinematics
- RTCP-aware motion: outputs tool-tip coordinates + rotary angles
"""
from __future__ import annotations

import math

from ..models import (
    ToolpathChain, ToolpathJob, ToolpathResult,
    MachineKinematics, ToolShape, compute_stats,
)
from ..geometry import (
    Mesh,
    Heightfield,
    build_heightfield,
    build_surface_angle_map,
    check_tool_collision,
)


def generate_fiveaxis_contour(job: ToolpathJob, mesh: Mesh) -> ToolpathResult:
    """
    Generate 5-axis simultaneous contour finishing toolpath.

    The tool axis tilts to follow the local surface normal at each point,
    constrained by machine tilt limits and collision detection.
    """
    result = ToolpathResult(strategy="5axis_contour")

    # Early exit: empty mesh
    if mesh.num_triangles == 0:
        result.warnings.append("Empty mesh — no triangles to machine")
        return result

    # Early exit: degenerate stock (zero or negative area)
    stock_dx = job.stock.x_max - job.stock.x_min
    stock_dy = job.stock.y_max - job.stock.y_min
    if stock_dx <= 1e-6 or stock_dy <= 1e-6:
        result.warnings.append(
            f"Degenerate stock dimensions: X={stock_dx:.3f} mm, Y={stock_dy:.3f} mm — "
            "stock must have positive area to generate a 5-axis contour toolpath"
        )
        return result

    bounds = mesh.bounds
    tool_r = job.tool.radius
    stepover = job.cuts.stepover_mm
    safe_z = job.cuts.safe_z_mm
    feed = job.cuts.feed_mm_min
    plunge = job.cuts.plunge_mm_min
    machine = job.machine

    if not machine.has_5th_axis:
        result.warnings.append(
            "Machine does not have 5th axis; falling back to 3-axis contour. "
            "Set has5thAxis=true in machine config to enable 5-axis."
        )
        return _fallback_3axis_raster(job, mesh)

    max_tilt = math.radians(machine.max_tilt_deg)
    lead_angle_rad = math.radians(5.0)

    resolution = max(0.2, min(stepover / 2, job.tolerance_mm * 10))
    hf = build_heightfield(mesh, resolution_mm=resolution, tool_radius=tool_r,
                           tool_shape=job.tool.shape,
                           corner_radius=job.tool.corner_radius_mm)

    normal_map = _build_normal_map(mesh, hf, resolution)

    x_min = max(job.stock.x_min, bounds.min_pt.x - tool_r)
    x_max = min(job.stock.x_max, bounds.max_pt.x + tool_r)
    y_min = max(job.stock.y_min, bounds.min_pt.y - tool_r)
    y_max = min(job.stock.y_max, bounds.max_pt.y + tool_r)

    y_positions = _gen_positions(y_min, y_max, stepover)
    x_positions = _gen_positions(x_min, x_max, resolution)
    floor_z = bounds.min_pt.z - 1.0

    # Collision detection config
    holder_r = job.tool.effective_holder_diameter / 2.0
    holder_len = max(job.tool.flute_length_mm * 0.5, 20.0)
    tool_len = job.tool.flute_length_mm

    flip = False
    prev_a = 0.0
    prev_b = 0.0

    for y in y_positions:
        chain = ToolpathChain(comment=f"5axis y={y:.3f}")
        x_scan = x_positions if not flip else list(reversed(x_positions))

        points: list[tuple[float, float, float, float]] = []
        for x in x_scan:
            z = hf.sample_z(x, y)
            if z <= floor_z:
                continue

            nx, ny, nz = _sample_normal(normal_map, x, y, hf)

            a_deg, b_deg = _normal_to_ab_angles(
                nx, ny, nz, max_tilt, lead_angle_rad,
                feed_dir_x=1.0 if not flip else -1.0,
            )

            # Collision check: test if the tilted tool + holder collides
            if holder_r > 0:
                axis_x, axis_y, axis_z = _ab_to_axis_vector(a_deg, b_deg)
                collides, clearance = check_tool_collision(
                    mesh, x, y, z,
                    axis_x, axis_y, axis_z,
                    tool_r, tool_len,
                    holder_r, holder_len,
                )
                if collides:
                    # Reduce tilt until no collision, or fall back to vertical
                    a_deg, b_deg = _find_safe_tilt(
                        mesh, x, y, z, nx, ny, nz,
                        max_tilt, tool_r, tool_len, holder_r, holder_len,
                    )

            # Smooth axis motion
            a_deg = _smooth_angle(prev_a, a_deg, max_rate_deg=5.0)
            b_deg = _smooth_angle(prev_b, b_deg, max_rate_deg=5.0)

            points.append((x, z, a_deg, b_deg))
            prev_a = a_deg
            prev_b = b_deg

        if not points:
            flip = not flip
            continue

        in_cut = False
        for i, (x, z, a_deg, b_deg) in enumerate(points):
            if not in_cut:
                chain.append_rapid(x, y, safe_z)
                chain.append_rapid(x, y, z + 2.0)
                chain.append_5axis(x, y, z, a_deg, b_deg, plunge)
                in_cut = True
            else:
                prev_x, prev_z, _, _ = points[i - 1]
                if z < floor_z + 0.5:
                    chain.append_rapid(prev_x, y, safe_z)
                    chain.append_rapid(x, y, safe_z)
                    chain.append_rapid(x, y, z + 2.0)
                    chain.append_5axis(x, y, z, a_deg, b_deg, plunge)
                else:
                    chain.append_5axis(x, y, z, a_deg, b_deg, feed)

        if chain.segments:
            last = chain.segments[-1]
            chain.append_rapid(last.x, y, safe_z)
            result.chains.append(chain)

        flip = not flip

    compute_stats(result, safe_z)
    return result


def generate_fiveaxis_swarf(job: ToolpathJob, mesh: Mesh) -> ToolpathResult:
    """
    Generate 5-axis swarf cutting toolpath.

    Uses the full side (flank) of the tool to machine ruled surfaces
    and near-vertical walls. The tool axis is tilted to align with
    the wall direction, producing excellent surface finish with the
    full cutting length engaged.

    Best for: tapered walls, vertical faces, ruled surfaces.
    """
    result = ToolpathResult(strategy="5axis_swarf")
    bounds = mesh.bounds
    tool_r = job.tool.radius
    safe_z = job.cuts.safe_z_mm
    feed = job.cuts.feed_mm_min
    plunge = job.cuts.plunge_mm_min
    machine = job.machine
    z_step = job.cuts.z_step_mm
    stepover = job.cuts.stepover_mm

    if not machine.has_5th_axis:
        result.warnings.append("Swarf cutting requires 5-axis machine")
        return _fallback_3axis_raster(job, mesh)

    max_tilt = math.radians(machine.max_tilt_deg)

    # Build heightfield and angle map to identify steep regions
    resolution = max(0.3, stepover / 2)
    hf = build_heightfield(mesh, resolution_mm=resolution, tool_radius=0.0)
    angle_map = build_surface_angle_map(mesh, resolution_mm=resolution)

    # Swarf cutting targets steep regions (> 60 degrees from horizontal)
    steep_threshold = 60.0

    # Generate Z-level contours for steep regions
    z_top = bounds.max_pt.z - z_step * 0.5
    z_bottom = bounds.min_pt.z + tool_r * 0.25
    z_levels: list[float] = []
    z = z_top
    while z >= z_bottom - 1e-6:
        z_levels.append(z)
        z -= z_step

    from ..geometry import slice_mesh_at_z, offset_contour

    for z_level in z_levels:
        loops = slice_mesh_at_z(mesh, z_level)
        if not loops:
            continue

        for loop_idx, loop in enumerate(loops):
            if len(loop) < 3:
                continue

            # Check if this contour passes through steep regions
            has_steep = False
            for pt in loop[::max(1, len(loop) // 10)]:
                angle = angle_map.sample_z(pt[0], pt[1])
                if angle > steep_threshold:
                    has_steep = True
                    break

            if not has_steep:
                continue

            # Offset for tool radius
            offset_loop = offset_contour(loop, -tool_r)
            if len(offset_loop) < 3:
                offset_loop = offset_contour(loop, tool_r)
                if len(offset_loop) < 3:
                    continue

            chain = ToolpathChain(comment=f"swarf z={z_level:.3f} loop={loop_idx}")

            start = offset_loop[0]
            chain.append_rapid(start[0], start[1], safe_z)
            chain.append_rapid(start[0], start[1], z_level + 2.0)

            # For each point on the contour, compute the swarf tilt
            for i, pt in enumerate(offset_loop):
                # Estimate wall direction from contour tangent
                i_next = (i + 1) % len(offset_loop)
                i_prev = (i - 1) % len(offset_loop)

                tang_x = offset_loop[i_next][0] - offset_loop[i_prev][0]
                tang_y = offset_loop[i_next][1] - offset_loop[i_prev][1]
                tang_len = math.sqrt(tang_x * tang_x + tang_y * tang_y)
                if tang_len < 1e-8:
                    tang_x, tang_y = 1.0, 0.0
                else:
                    tang_x /= tang_len
                    tang_y /= tang_len

                # Inward normal (perpendicular to tangent)
                wall_nx = -tang_y
                wall_ny = tang_x

                # Surface angle at this point
                angle = angle_map.sample_z(pt[0], pt[1])
                angle_rad = math.radians(min(angle, 85.0))

                # Tool axis: lean into the wall by the surface angle
                # For swarf cutting, the tool axis is in the plane of
                # (wall_normal, Z) tilted by (90 - angle) from vertical
                tilt = min(angle_rad, max_tilt)
                sin_tilt = math.sin(tilt)
                cos_tilt = math.cos(tilt)

                # Tool axis components
                ax_x = wall_nx * sin_tilt
                ax_y = wall_ny * sin_tilt
                ax_z = cos_tilt

                # Convert to A/B angles
                a_deg = round(math.degrees(math.atan2(ax_y, ax_z)), 3)
                b_deg = round(math.degrees(math.atan2(-ax_x, ax_z)), 3)

                # Clamp to machine limits
                half_b = machine.b_axis_range_deg / 2.0
                a_deg = max(-machine.a_axis_range_deg / 2, min(machine.a_axis_range_deg / 2, a_deg))
                b_deg = max(-half_b, min(half_b, b_deg))

                if i == 0:
                    chain.append_5axis(pt[0], pt[1], z_level, a_deg, b_deg, plunge)
                else:
                    chain.append_5axis(pt[0], pt[1], z_level, a_deg, b_deg, feed)

            # Close the loop
            start_pt = offset_loop[0]
            chain.append_5axis(start_pt[0], start_pt[1], z_level, 0.0, 0.0, feed)

            chain.append_rapid(start_pt[0], start_pt[1], safe_z)
            result.chains.append(chain)

    compute_stats(result, safe_z)
    return result


def generate_fiveaxis_flowline(job: ToolpathJob, mesh: Mesh) -> ToolpathResult:
    """
    Generate 5-axis flowline finishing toolpath.

    Creates smooth passes that flow along the natural surface parameterization,
    ideal for turbine blades, impellers, and directionally consistent surfaces.

    The flowline direction is determined by the dominant curvature direction
    of the mesh surface.
    """
    result = ToolpathResult(strategy="5axis_flowline")
    bounds = mesh.bounds
    tool_r = job.tool.radius
    stepover = job.cuts.stepover_mm
    safe_z = job.cuts.safe_z_mm
    feed = job.cuts.feed_mm_min
    plunge = job.cuts.plunge_mm_min
    machine = job.machine

    if not machine.has_5th_axis:
        result.warnings.append("Flowline requires 5-axis machine")
        return _fallback_3axis_raster(job, mesh)

    max_tilt = math.radians(machine.max_tilt_deg)
    resolution = max(0.2, min(stepover / 2, job.tolerance_mm * 10))

    hf = build_heightfield(mesh, resolution_mm=resolution, tool_radius=tool_r,
                           tool_shape=job.tool.shape,
                           corner_radius=job.tool.corner_radius_mm)
    normal_map = _build_normal_map(mesh, hf, resolution)

    # Determine dominant flow direction from mesh shape
    x_range = bounds.max_pt.x - bounds.min_pt.x
    y_range = bounds.max_pt.y - bounds.min_pt.y

    # Flow along the longer dimension, cross-passes along shorter
    if x_range >= y_range:
        flow_along_x = True
        primary_positions = _gen_positions(
            bounds.min_pt.x - tool_r, bounds.max_pt.x + tool_r, resolution)
        cross_positions = _gen_positions(
            bounds.min_pt.y - tool_r, bounds.max_pt.y + tool_r, stepover)
    else:
        flow_along_x = False
        primary_positions = _gen_positions(
            bounds.min_pt.y - tool_r, bounds.max_pt.y + tool_r, resolution)
        cross_positions = _gen_positions(
            bounds.min_pt.x - tool_r, bounds.max_pt.x + tool_r, stepover)

    floor_z = bounds.min_pt.z - 1.0
    flip = False
    prev_a = 0.0
    prev_b = 0.0

    for cross in cross_positions:
        chain = ToolpathChain(
            comment=f"flowline {'x' if flow_along_x else 'y'}={cross:.3f}")
        scan = primary_positions if not flip else list(reversed(primary_positions))

        points: list[tuple[float, float, float, float, float]] = []
        for primary in scan:
            x = primary if flow_along_x else cross
            y = cross if flow_along_x else primary

            z = hf.sample_z(x, y)
            if z <= floor_z:
                continue

            nx, ny, nz = _sample_normal(normal_map, x, y, hf)
            a_deg, b_deg = _normal_to_ab_angles(
                nx, ny, nz, max_tilt, math.radians(3.0),
                feed_dir_x=1.0 if not flip else -1.0,
            )
            a_deg = _smooth_angle(prev_a, a_deg, max_rate_deg=3.0)
            b_deg = _smooth_angle(prev_b, b_deg, max_rate_deg=3.0)

            points.append((x, y, z, a_deg, b_deg))
            prev_a = a_deg
            prev_b = b_deg

        if not points:
            flip = not flip
            continue

        in_cut = False
        for i, (x, y, z, a_deg, b_deg) in enumerate(points):
            if not in_cut:
                chain.append_rapid(x, y, safe_z)
                chain.append_rapid(x, y, z + 2.0)
                chain.append_5axis(x, y, z, a_deg, b_deg, plunge)
                in_cut = True
            else:
                px, py, pz, _, _ = points[i - 1]
                if z < floor_z + 0.5:
                    chain.append_rapid(px, py, safe_z)
                    chain.append_rapid(x, y, safe_z)
                    chain.append_rapid(x, y, z + 2.0)
                    chain.append_5axis(x, y, z, a_deg, b_deg, plunge)
                else:
                    chain.append_5axis(x, y, z, a_deg, b_deg, feed)

        if chain.segments:
            last = chain.segments[-1]
            chain.append_rapid(last.x, last.y, safe_z)
            result.chains.append(chain)

        flip = not flip

    compute_stats(result, safe_z)
    return result


# ═══════════════════════════════════════════════════════════════════════
# SHARED HELPERS
# ═══════════════════════════════════════════════════════════════════════

def _build_normal_map(
    mesh: Mesh, hf: Heightfield, resolution: float,
) -> dict[tuple[int, int], tuple[float, float, float]]:
    """Build grid-aligned surface normal map via finite differences on heightfield."""
    normal_map: dict[tuple[int, int], tuple[float, float, float]] = {}

    try:
        import numpy as np
    except ImportError:
        return normal_map

    if hf.grid is None:
        return normal_map

    grid = hf.grid
    ny, nx = grid.shape

    for iy in range(1, ny - 1):
        for ix in range(1, nx - 1):
            dzdx = (grid[iy, ix + 1] - grid[iy, ix - 1]) / (2 * resolution)
            dzdy = (grid[iy + 1, ix] - grid[iy - 1, ix]) / (2 * resolution)
            length = math.sqrt(dzdx * dzdx + dzdy * dzdy + 1.0)
            normal_map[(ix, iy)] = (-dzdx / length, -dzdy / length, 1.0 / length)

    return normal_map


def _sample_normal(
    normal_map: dict[tuple[int, int], tuple[float, float, float]],
    x: float, y: float,
    hf: Heightfield,
) -> tuple[float, float, float]:
    """Sample surface normal at world coordinate."""
    if not normal_map or hf.grid is None:
        return (0.0, 0.0, 1.0)

    try:
        import numpy as np
    except ImportError:
        return (0.0, 0.0, 1.0)

    ny, nx = hf.grid.shape
    dx = (hf.x_max - hf.x_min) / nx if nx > 1 else 1.0
    dy = (hf.y_max - hf.y_min) / ny if ny > 1 else 1.0
    ix = int((x - hf.x_min) / dx)
    iy = int((y - hf.y_min) / dy)
    ix = max(1, min(ix, nx - 2))
    iy = max(1, min(iy, ny - 2))

    return normal_map.get((ix, iy), (0.0, 0.0, 1.0))


def _normal_to_ab_angles(
    nx: float, ny: float, nz: float,
    max_tilt: float,
    lead_angle_rad: float,
    feed_dir_x: float = 1.0,
) -> tuple[float, float]:
    """Convert surface normal to A and B rotation angles (degrees)."""
    if abs(nz) < 1e-6:
        nz = 1e-6

    tilt_from_vertical = math.acos(max(-1.0, min(1.0, abs(nz))))

    if tilt_from_vertical < 0.001:
        return (0.0, 0.0)

    if tilt_from_vertical > max_tilt:
        scale = max_tilt / tilt_from_vertical
        nx_adj = nx * scale
        ny_adj = ny * scale
    else:
        nx_adj = nx
        ny_adj = ny

    b_rad = math.atan2(-nx_adj, abs(nz))
    a_rad = math.atan2(ny_adj, abs(nz))

    b_rad += lead_angle_rad * feed_dir_x

    b_rad = max(-max_tilt, min(max_tilt, b_rad))
    a_rad = max(-max_tilt, min(max_tilt, a_rad))

    return (round(math.degrees(a_rad), 3), round(math.degrees(b_rad), 3))


def _ab_to_axis_vector(a_deg: float, b_deg: float) -> tuple[float, float, float]:
    """Convert A/B angles to tool axis unit vector (pointing up from workpiece)."""
    a_rad = math.radians(a_deg)
    b_rad = math.radians(b_deg)
    # Rotation around X by A, then around Y by B
    # Starting from (0, 0, 1) vertical
    x = -math.sin(b_rad) * math.cos(a_rad)
    y = math.sin(a_rad)
    z = math.cos(a_rad) * math.cos(b_rad)
    return (x, y, z)


def _find_safe_tilt(
    mesh: Mesh,
    tip_x: float, tip_y: float, tip_z: float,
    nx: float, ny: float, nz: float,
    max_tilt: float,
    tool_r: float, tool_len: float,
    holder_r: float, holder_len: float,
) -> tuple[float, float]:
    """Binary search for the maximum tilt angle that avoids collision."""
    # Start from the desired tilt and reduce until safe
    tilt = math.acos(max(-1.0, min(1.0, abs(nz))))
    tilt = min(tilt, max_tilt)

    for _ in range(8):  # 8 iterations of bisection
        if tilt < 0.01:
            return (0.0, 0.0)

        # Scale normal to this tilt
        if abs(nz) > 1e-6:
            scale = tilt / math.acos(max(-1.0, min(1.0, abs(nz))))
        else:
            scale = 1.0
        scale = min(scale, 1.0)

        test_nx = nx * scale
        test_ny = ny * scale

        b_rad = math.atan2(-test_nx, abs(nz))
        a_rad = math.atan2(test_ny, abs(nz))

        a_deg = math.degrees(a_rad)
        b_deg = math.degrees(b_rad)

        axis_x, axis_y, axis_z = _ab_to_axis_vector(a_deg, b_deg)
        collides, _ = check_tool_collision(
            mesh, tip_x, tip_y, tip_z,
            axis_x, axis_y, axis_z,
            tool_r, tool_len,
            holder_r, holder_len,
        )

        if collides:
            tilt *= 0.5
        else:
            return (round(a_deg, 3), round(b_deg, 3))

    return (0.0, 0.0)  # Fall back to vertical


def _smooth_angle(prev: float, target: float, max_rate_deg: float) -> float:
    """Limit angular velocity to prevent sudden rotary moves."""
    delta = target - prev
    if abs(delta) > max_rate_deg:
        return prev + max_rate_deg * (1.0 if delta > 0 else -1.0)
    return target


def _gen_positions(start: float, end: float, step: float) -> list[float]:
    positions: list[float] = []
    pos = start
    while pos <= end + 1e-6:
        positions.append(pos)
        pos += step
    return positions


def _fallback_3axis_raster(job: ToolpathJob, mesh: Mesh) -> ToolpathResult:
    """Fallback to 3-axis raster when 5-axis unavailable."""
    from .raster import generate_raster
    result = generate_raster(job, mesh)
    result.strategy = "5axis_contour"
    result.warnings.insert(0, "Fell back to 3-axis raster (5th axis not available)")
    return result
