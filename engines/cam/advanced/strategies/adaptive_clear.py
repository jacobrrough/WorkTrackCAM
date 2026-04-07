"""
Adaptive clearing (roughing) strategy with constant-engagement milling.

This implements a contour-offset based roughing approach:
1. At each Z level, slice the stock boundary and mesh boundary
2. Generate offset contours from outside (stock) to inside (mesh)
3. Use helical/ramp entry to each level
4. Maintain constant radial engagement for consistent chip load

The approach is similar to HSMWorks/Fusion 360 adaptive clearing but simplified
for mesh-based (non-BREP) geometry.
"""
from __future__ import annotations

import math

from ..models import ToolpathChain, ToolpathJob, ToolpathResult
from ..geometry import (
    Mesh,
    Heightfield,
    build_heightfield,
    slice_mesh_at_z,
    offset_contour,
    contour_winding,
)
from ..optimizer import adjust_feed_for_engagement


def generate_adaptive_clear(job: ToolpathJob, mesh: Mesh) -> ToolpathResult:
    """
    Generate adaptive clearing toolpath.

    Strategy:
    - Compute Z levels from stock top to mesh bottom in z_step increments
    - At each level, generate offset contours spiraling from stock boundary
      toward the part, maintaining max engagement angle
    - Use helical ramp entry at each new Z level
    - Connect levels with minimum retracts
    """
    result = ToolpathResult(strategy="adaptive_clear")
    bounds = mesh.bounds
    tool_r = job.tool.radius
    stepover = job.cuts.stepover_mm
    z_step = job.cuts.z_step_mm
    safe_z = job.cuts.safe_z_mm
    feed = job.cuts.feed_mm_min
    plunge = job.cuts.plunge_mm_min
    ramp_angle = job.cuts.ramp_angle_deg

    # Compute effective max stepover from engagement angle
    # Engagement angle θ: stepover = r * (1 - cos(θ/2)) approximately
    max_engagement_rad = math.radians(job.max_engagement_deg)
    max_stepover = tool_r * (1 - math.cos(max_engagement_rad / 2))
    effective_stepover = min(stepover, max_stepover) if max_stepover > 0.01 else stepover

    # Ensure minimum stepover
    effective_stepover = max(effective_stepover, 0.05)

    # Adjust feed for actual engagement. Adaptive clearing targets max_engagement_deg
    # as its design point; feed adjustment compensates for deviations (e.g. corner
    # wraps that drop engagement and thin the chip, or entry passes at full slot).
    feed = adjust_feed_for_engagement(feed, job.max_engagement_deg)

    # Build heightfield for floor detection
    hf_resolution = max(0.5, effective_stepover / 2)
    hf = build_heightfield(mesh, resolution_mm=hf_resolution, tool_radius=tool_r)

    # Compute Z levels
    stock_top = job.stock.z_max
    mesh_bottom = bounds.min_pt.z
    z_levels = _compute_z_levels(stock_top, mesh_bottom, z_step)

    if not z_levels:
        result.warnings.append("No Z levels to machine (stock top <= mesh bottom)")
        return result

    # Stock boundary rectangle
    stock_contour = _stock_rect(job)

    # Geometry-proportional pass cap: approximate inradius / stepover.
    # For a rectangular stock of area A, the inradius ≈ sqrt(A/π).
    # Fewer passes than this can't possibly clear a full contour spiral.
    # Cap at 10 000 to guard against degenerate near-zero stepovers.
    stock_area = abs(contour_winding(stock_contour))
    inradius_approx = math.sqrt(stock_area / math.pi) if stock_area > 0 else 50.0
    proportional_max_passes = max(100, min(10000, int(math.ceil(inradius_approx / effective_stepover)) + 10))
    if proportional_max_passes > 5000:
        result.warnings.append(
            f"Adaptive clear: pass cap set to {proportional_max_passes} "
            f"(inradius≈{inradius_approx:.1f}mm, stepover={effective_stepover:.3f}mm); "
            "reduce stock size or increase stepover if generation is slow."
        )

    for z_idx, z_level in enumerate(z_levels):
        # Get mesh contours at this Z level
        mesh_loops = slice_mesh_at_z(mesh, z_level)

        # If no mesh intersection at this level, use full stock area
        if not mesh_loops:
            # Machine the entire stock area at this level
            chains = _clear_full_stock(
                stock_contour, z_level, tool_r, effective_stepover,
                safe_z, feed, plunge, ramp_angle, hf,
                is_first_level=(z_idx == 0),
                max_passes=proportional_max_passes,
            )
        else:
            # Generate offset contours between stock boundary and mesh
            chains = _clear_around_mesh(
                stock_contour, mesh_loops, z_level, tool_r,
                effective_stepover, safe_z, feed, plunge, ramp_angle, hf,
                is_first_level=(z_idx == 0),
                max_passes=proportional_max_passes,
            )

        result.chains.extend(chains)

    _compute_stats(result, safe_z)
    return result


def _compute_z_levels(stock_top: float, mesh_bottom: float, z_step: float) -> list[float]:
    """Generate Z levels from stock_top-z_step down to mesh_bottom."""
    levels: list[float] = []
    z = stock_top - z_step
    while z >= mesh_bottom - 1e-6:
        levels.append(z)
        z -= z_step
    # Ensure we reach the bottom
    if levels and levels[-1] > mesh_bottom + 0.01:
        levels.append(mesh_bottom)
    if not levels and stock_top > mesh_bottom:
        levels.append(mesh_bottom)
    return levels


def _stock_rect(job: ToolpathJob) -> list[tuple[float, float]]:
    """Stock boundary as a CCW rectangle."""
    s = job.stock
    return [
        (s.x_min, s.y_min),
        (s.x_max, s.y_min),
        (s.x_max, s.y_max),
        (s.x_min, s.y_max),
    ]


def _clear_full_stock(
    stock_contour: list[tuple[float, float]],
    z_level: float,
    tool_r: float,
    stepover: float,
    safe_z: float,
    feed: float,
    plunge: float,
    ramp_angle: float,
    hf: Heightfield,
    is_first_level: bool,
    max_passes: int = 500,
) -> list[ToolpathChain]:
    """Generate offset clearing passes across the full stock area at z_level."""
    chains: list[ToolpathChain] = []

    # Start from stock boundary offset inward by tool radius
    current = offset_contour(stock_contour, -tool_r)
    pass_num = 0

    while True:
        if len(current) < 3:
            break

        # Check if contour has meaningful area
        area = abs(contour_winding(current))
        if area < stepover * stepover:
            break

        chain = ToolpathChain(comment=f"adaptive clear z={z_level:.3f} pass={pass_num}")

        # Entry: ramp or plunge
        if pass_num == 0:
            _add_ramp_entry(chain, current, z_level, safe_z, feed, plunge, ramp_angle)
        else:
            # Link from previous pass at same Z — short retract
            _add_link_move(chain, current[0], z_level, safe_z, feed, plunge)

        # Cut the contour
        _add_contour_cut(chain, current, z_level, feed, hf)

        chains.append(chain)

        # Offset inward for next pass
        current = offset_contour(current, -stepover)
        pass_num += 1

        # Geometry-proportional safety limit (set by caller from stock dimensions)
        if pass_num > max_passes:
            break

    return chains


def _clear_around_mesh(
    stock_contour: list[tuple[float, float]],
    mesh_loops: list[list[tuple[float, float]]],
    z_level: float,
    tool_r: float,
    stepover: float,
    safe_z: float,
    feed: float,
    plunge: float,
    ramp_angle: float,
    hf: Heightfield,
    is_first_level: bool,
    max_passes: int = 500,
) -> list[ToolpathChain]:
    """
    Clear material between stock boundary and mesh contours.

    Generates concentric offset passes from outside in, stopping when
    we reach the mesh boundary (plus tool radius clearance).
    """
    chains: list[ToolpathChain] = []

    # Build mesh boundary offset (tool radius clearance)
    mesh_boundaries: list[list[tuple[float, float]]] = []
    for loop in mesh_loops:
        # Offset mesh outward by tool radius for clearance
        offset_loop = offset_contour(loop, tool_r)
        if len(offset_loop) >= 3:
            mesh_boundaries.append(offset_loop)

    # Generate offset passes from stock boundary inward
    current = offset_contour(stock_contour, -tool_r)
    pass_num = 0

    while True:
        if len(current) < 3:
            break

        area = abs(contour_winding(current))
        if area < stepover * stepover:
            break

        # Check if this contour is still outside all mesh boundaries
        if _contour_inside_any(current, mesh_boundaries):
            break

        chain = ToolpathChain(comment=f"adaptive clear z={z_level:.3f} pass={pass_num}")

        if pass_num == 0:
            _add_ramp_entry(chain, current, z_level, safe_z, feed, plunge, ramp_angle)
        else:
            _add_link_move(chain, current[0], z_level, safe_z, feed, plunge)

        _add_contour_cut(chain, current, z_level, feed, hf)
        chains.append(chain)

        current = offset_contour(current, -stepover)
        pass_num += 1

        # Geometry-proportional safety limit (set by caller from stock dimensions)
        if pass_num > max_passes:
            break

    return chains


def _add_ramp_entry(
    chain: ToolpathChain,
    contour: list[tuple[float, float]],
    z_level: float,
    safe_z: float,
    feed: float,
    plunge: float,
    ramp_angle_deg: float,
) -> None:
    """Add a helical/ramp entry to the first point of a contour."""
    if not contour:
        return

    start = contour[0]
    chain.append_rapid(start[0], start[1], safe_z)

    # Ramp down along a portion of the contour
    ramp_angle_rad = math.radians(max(1.0, ramp_angle_deg))
    ramp_z_start = safe_z
    ramp_z_end = z_level
    z_drop = ramp_z_start - ramp_z_end

    if z_drop <= 0:
        chain.append_feed(start[0], start[1], z_level, plunge)
        return

    # Calculate ramp distance from angle
    ramp_distance = z_drop / math.tan(ramp_angle_rad)

    # Walk along contour to build ramp
    total_dist = 0.0
    prev = start
    points_with_dist: list[tuple[float, float, float]] = [(start[0], start[1], 0.0)]

    for pt in contour[1:]:
        d = math.sqrt((pt[0] - prev[0])**2 + (pt[1] - prev[1])**2)
        total_dist += d
        points_with_dist.append((pt[0], pt[1], total_dist))
        prev = pt
        if total_dist >= ramp_distance:
            break

    # If contour too short for full ramp, loop back
    if total_dist < ramp_distance and total_dist > 0:
        ramp_distance = total_dist  # truncate ramp

    # Emit ramp moves
    for px, py, dist in points_with_dist:
        if ramp_distance > 0:
            t = min(1.0, dist / ramp_distance)
        else:
            t = 1.0
        z = ramp_z_start - t * z_drop
        chain.append_feed(px, py, z, plunge)


def _add_link_move(
    chain: ToolpathChain,
    target: tuple[float, float],
    z_level: float,
    safe_z: float,
    feed: float,
    plunge: float,
) -> None:
    """Add a clearance-height link move to a new contour start."""
    retract_z = z_level + 2.0  # small clearance retract
    chain.append_rapid(chain.segments[-1].x if chain.segments else target[0],
                       chain.segments[-1].y if chain.segments else target[1],
                       retract_z)
    chain.append_rapid(target[0], target[1], retract_z)
    chain.append_feed(target[0], target[1], z_level, plunge)


def _add_contour_cut(
    chain: ToolpathChain,
    contour: list[tuple[float, float]],
    z_level: float,
    feed: float,
    hf: Heightfield,
) -> None:
    """Add cutting moves along a contour, adjusting Z to heightfield floor."""
    for pt in contour:
        # Use heightfield to detect if we need to go deeper
        floor_z = hf.sample_z(pt[0], pt[1])
        cut_z = max(z_level, floor_z)  # don't cut below mesh surface
        chain.append_feed(pt[0], pt[1], cut_z, feed)

    # Close the contour
    if contour:
        first = contour[0]
        floor_z = hf.sample_z(first[0], first[1])
        cut_z = max(z_level, floor_z)
        chain.append_feed(first[0], first[1], cut_z, feed)


def _contour_inside_any(
    contour: list[tuple[float, float]],
    boundaries: list[list[tuple[float, float]]],
) -> bool:
    """Check if the centroid of contour is inside any of the boundary loops."""
    if not contour:
        return False

    # Use centroid as representative point
    cx = sum(p[0] for p in contour) / len(contour)
    cy = sum(p[1] for p in contour) / len(contour)

    for boundary in boundaries:
        if _point_in_polygon(cx, cy, boundary):
            return True
    return False


def _point_in_polygon(x: float, y: float, poly: list[tuple[float, float]]) -> bool:
    """Ray-casting point-in-polygon test."""
    n = len(poly)
    inside = False
    j = n - 1
    for i in range(n):
        yi, xi = poly[i][1], poly[i][0]
        yj, xj = poly[j][1], poly[j][0]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside


def _compute_stats(result: ToolpathResult, safe_z: float) -> None:
    """Compute distance and time statistics."""
    total_cut = 0.0
    total_rapid = 0.0
    prev_x, prev_y, prev_z = 0.0, 0.0, safe_z

    for chain in result.chains:
        for seg in chain.segments:
            d = math.sqrt((seg.x - prev_x)**2 + (seg.y - prev_y)**2 + (seg.z - prev_z)**2)
            if seg.is_rapid:
                total_rapid += d
            else:
                total_cut += d
            prev_x, prev_y, prev_z = seg.x, seg.y, seg.z

    result.cut_distance_mm = total_cut
    result.rapid_distance_mm = total_rapid
    result.total_distance_mm = total_cut + total_rapid

    # Estimate time (rough: assume 5000 mm/min rapid, feed from first chain)
    rapid_time = total_rapid / 5000.0 if total_rapid > 0 else 0
    avg_feed = 1000.0
    for chain in result.chains:
        for seg in chain.segments:
            if seg.feed > 0:
                avg_feed = seg.feed
                break
        break
    cut_time = total_cut / avg_feed if total_cut > 0 else 0
    result.estimated_time_s = (rapid_time + cut_time) * 60
