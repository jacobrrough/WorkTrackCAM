"""
Morphing finish strategy: automatic blend between Z-level and raster.

Analyzes surface angle at each point and selects the optimal strategy:
- Steep regions (> threshold angle): Z-level waterline passes
- Flat/gentle regions (< threshold angle): Raster surface-following passes

This produces superior surface finish on complex geometries with both
steep walls and gentle curves, without the "staircase" effect of pure
waterline on flat areas or the poor coverage of pure raster on walls.
"""
from __future__ import annotations

import math

from ..models import ToolpathChain, ToolpathJob, ToolpathResult, ToolShape, compute_stats
from ..geometry import (
    Mesh,
    Heightfield,
    build_heightfield,
    build_surface_angle_map,
    slice_mesh_at_z,
    offset_contour,
    contour_winding,
)
from ..optimizer import adjust_feed_for_engagement, compute_engagement_angle


# Angle threshold (degrees) above which Z-level waterline is preferred
DEFAULT_STEEP_THRESHOLD_DEG = 50.0


def generate_morphing_finish(job: ToolpathJob, mesh: Mesh) -> ToolpathResult:
    """
    Generate a morphing finish toolpath that blends waterline and raster.

    For each Y-position raster pass, check the surface angle map:
    - Where surface is steep, skip raster and rely on waterline passes
    - Where surface is gentle, emit raster surface-following moves

    Additionally, generate waterline passes only at Z-levels where
    steep surfaces exist.
    """
    result = ToolpathResult(strategy="morphing_finish")

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
            "stock must have positive area to generate a morphing finish toolpath"
        )
        return result

    bounds = mesh.bounds
    tool_r = job.tool.radius
    stepover = job.cuts.stepover_mm
    safe_z = job.cuts.safe_z_mm
    feed = job.cuts.feed_mm_min
    plunge = job.cuts.plunge_mm_min

    steep_threshold = DEFAULT_STEEP_THRESHOLD_DEG

    # Adjust cutting feed for radial engagement (chip thinning).
    engagement_deg = compute_engagement_angle(tool_r, stepover)
    raster_cut_feed = adjust_feed_for_engagement(feed, engagement_deg)

    # Build heightfields
    resolution = max(0.1, min(stepover / 2, job.tolerance_mm * 10))
    hf = build_heightfield(mesh, resolution_mm=resolution, tool_radius=tool_r)
    angle_map = build_surface_angle_map(mesh, resolution_mm=resolution)

    # ── Phase 1: Raster passes for gentle surfaces ──
    x_min = max(job.stock.x_min, bounds.min_pt.x - tool_r)
    x_max = min(job.stock.x_max, bounds.max_pt.x + tool_r)
    y_min = max(job.stock.y_min, bounds.min_pt.y - tool_r)
    y_max = min(job.stock.y_max, bounds.max_pt.y + tool_r)

    y_positions = _gen_positions(y_min, y_max, stepover)
    x_positions = _gen_positions(x_min, x_max, resolution)
    floor_z = bounds.min_pt.z - 1.0

    flip = False
    for y in y_positions:
        chain = ToolpathChain(comment=f"morph-raster y={y:.3f}")
        x_scan = x_positions if not flip else list(reversed(x_positions))

        in_cut = False
        for i, x in enumerate(x_scan):
            z = hf.sample_z(x, y)
            angle = angle_map.sample_z(x, y)

            # Skip steep regions (waterline will cover them)
            if z <= floor_z or angle > steep_threshold:
                if in_cut:
                    last = chain.segments[-1]
                    chain.append_rapid(last.x, last.y, safe_z)
                    in_cut = False
                continue

            if not in_cut:
                chain.append_rapid(x, y, safe_z)
                chain.append_rapid(x, y, z + 2.0)
                chain.append_feed(x, y, z, plunge)
                in_cut = True
            else:
                chain.append_feed(x, y, z, raster_cut_feed)

        if in_cut and chain.segments:
            last = chain.segments[-1]
            chain.append_rapid(last.x, last.y, safe_z)

        if chain.segments:
            result.chains.append(chain)

        flip = not flip

    # ── Phase 2: Waterline passes for steep surfaces ──
    z_step = _compute_z_step(job)

    # Engagement compensation for waterline passes (z_step governs engagement).
    wl_engagement_deg = compute_engagement_angle(tool_r, z_step)
    wl_cut_feed = adjust_feed_for_engagement(feed, wl_engagement_deg)
    z_top = bounds.max_pt.z - z_step * 0.5
    z_bottom = bounds.min_pt.z + tool_r * 0.25

    z_levels: list[float] = []
    z = z_top
    while z >= z_bottom - 1e-6:
        z_levels.append(z)
        z -= z_step

    for z_level in z_levels:
        loops = slice_mesh_at_z(mesh, z_level)
        if not loops:
            continue

        for loop_idx, loop in enumerate(loops):
            if len(loop) < 3:
                continue

            # Only emit waterline if this Z-level has steep surfaces
            has_steep = _loop_has_steep_region(loop, angle_map, steep_threshold)
            if not has_steep:
                continue

            offset_loop = offset_contour(loop, -tool_r)
            if len(offset_loop) < 3:
                offset_loop = offset_contour(loop, tool_r)
                if len(offset_loop) < 3:
                    continue

            # Skip degenerate contours with negligible area
            area = abs(contour_winding(offset_loop))
            if area < tool_r * tool_r * 0.01:
                continue

            chain = ToolpathChain(comment=f"morph-waterline z={z_level:.3f} loop={loop_idx}")

            start = offset_loop[0]
            lead_in_r = min(tool_r * 0.5, 2.0)

            # Tangential lead-in arc
            lead_in_pts = _compute_lead_in_arc(offset_loop, lead_in_r)
            if lead_in_pts:
                arc_start = lead_in_pts[0]
                chain.append_rapid(arc_start[0], arc_start[1], safe_z)
                chain.append_rapid(arc_start[0], arc_start[1], z_level + 2.0)
                chain.append_feed(arc_start[0], arc_start[1], z_level, plunge)
                for pt in lead_in_pts[1:]:
                    chain.append_feed(pt[0], pt[1], z_level, feed * 0.5)
            else:
                chain.append_rapid(start[0], start[1], safe_z)
                chain.append_rapid(start[0], start[1], z_level + 2.0)
                chain.append_feed(start[0], start[1], z_level, plunge)

            # Climb milling direction control
            if job.cuts.climb_milling:
                winding = contour_winding(offset_loop)
                if winding < 0:
                    offset_loop = list(reversed(offset_loop))
                    start = offset_loop[0]

            for pt in offset_loop[1:]:
                chain.append_feed(pt[0], pt[1], z_level, wl_cut_feed)
            chain.append_feed(start[0], start[1], z_level, wl_cut_feed)

            # Tangential lead-out arc
            lead_out_pts = _compute_lead_out_arc(offset_loop, lead_in_r)
            if lead_out_pts:
                for pt in lead_out_pts:
                    chain.append_feed(pt[0], pt[1], z_level, feed * 0.5)

            # Retract
            last = chain.last
            if last:
                chain.append_rapid(last.x, last.y, safe_z)
            else:
                chain.append_rapid(start[0], start[1], safe_z)
            result.chains.append(chain)

    compute_stats(result, safe_z)
    return result


def _loop_has_steep_region(
    loop: list[tuple[float, float]],
    angle_map: Heightfield,
    threshold: float,
) -> bool:
    """Check if any point in the loop is in a steep region."""
    check_interval = max(1, len(loop) // 10)
    for i in range(0, len(loop), check_interval):
        pt = loop[i]
        angle = angle_map.sample_z(pt[0], pt[1])
        if angle > threshold:
            return True
    return False


def _compute_z_step(job: ToolpathJob) -> float:
    """Compute optimal Z step from tool geometry and surface finish target."""
    if job.tool.shape == ToolShape.BALL:
        r = job.tool.radius
        scallop_mm = job.surface_finish_ra_um / 1000.0 * 4
        scallop_mm = max(0.005, min(scallop_mm, r * 0.5))
        z_step = 2.0 * math.sqrt(scallop_mm * (2 * r - scallop_mm))
        return max(0.05, min(z_step, job.cuts.z_step_mm))
    elif job.tool.shape == ToolShape.BULL:
        cr = job.tool.corner_radius_mm
        if cr > 0:
            scallop_mm = job.surface_finish_ra_um / 1000.0 * 4
            scallop_mm = max(0.005, min(scallop_mm, cr * 0.5))
            z_step = 2.0 * math.sqrt(scallop_mm * (2 * cr - scallop_mm))
            return max(0.05, min(z_step, job.cuts.z_step_mm))
    return job.cuts.z_step_mm


def _gen_positions(start: float, end: float, step: float) -> list[float]:
    positions: list[float] = []
    pos = start
    while pos <= end + 1e-6:
        positions.append(pos)
        pos += step
    return positions


def _compute_lead_in_arc(
    contour: list[tuple[float, float]],
    radius: float,
    arc_steps: int = 8,
) -> list[tuple[float, float]]:
    """Compute a tangential lead-in arc approaching the first contour point."""
    if len(contour) < 2 or radius < 0.01:
        return []

    p0 = contour[0]
    p1 = contour[1]

    dx = p1[0] - p0[0]
    dy = p1[1] - p0[1]
    seg_len = math.sqrt(dx * dx + dy * dy)
    if seg_len < 1e-8:
        return []

    tx = dx / seg_len
    ty = dy / seg_len
    nx = ty
    ny = -tx

    cx = p0[0] + nx * radius
    cy = p0[1] + ny * radius

    points: list[tuple[float, float]] = []
    for i in range(arc_steps + 1):
        t = i / arc_steps
        angle = math.pi * 0.5 * (1.0 - t)
        ax = cx - nx * radius * math.cos(angle) + tx * radius * math.sin(angle)
        ay = cy - ny * radius * math.cos(angle) + ty * radius * math.sin(angle)
        points.append((ax, ay))

    return points


def _compute_lead_out_arc(
    contour: list[tuple[float, float]],
    radius: float,
    arc_steps: int = 8,
) -> list[tuple[float, float]]:
    """Compute a tangential lead-out arc departing from the first contour point."""
    if len(contour) < 2 or radius < 0.01:
        return []

    p0 = contour[0]
    p_last = contour[-1]

    dx = p0[0] - p_last[0]
    dy = p0[1] - p_last[1]
    seg_len = math.sqrt(dx * dx + dy * dy)
    if seg_len < 1e-8:
        return []

    tx = dx / seg_len
    ty = dy / seg_len
    nx = ty
    ny = -tx

    cx = p0[0] + nx * radius
    cy = p0[1] + ny * radius

    points: list[tuple[float, float]] = []
    for i in range(1, arc_steps + 1):
        t = i / arc_steps
        angle = math.pi * 0.5 * t
        ax = cx - nx * radius * math.cos(angle) + tx * radius * math.sin(angle)
        ay = cy - ny * radius * math.cos(angle) + ty * radius * math.sin(angle)
        points.append((ax, ay))

    return points
