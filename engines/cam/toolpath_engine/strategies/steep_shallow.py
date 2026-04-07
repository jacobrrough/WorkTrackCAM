"""
Steep-and-shallow finishing strategy for CNC toolpath generation.

Classifies the mesh surface into steep and shallow regions based on the angle
each face makes with the horizontal plane, then applies the optimal cutting
strategy to each region:

  - **Steep regions** (angle > threshold): waterline (Z-level) passes that
    follow constant-height contours, avoiding the staircase artifacts that
    raster passes produce on near-vertical walls.

  - **Shallow regions** (angle < threshold): raster (parallel) passes that
    track the mesh surface via a heightfield, delivering low scallop height
    on gently curved and flat areas where waterline passes would be too
    widely spaced.

  - **Overlap band**: a configurable angular band straddling the threshold
    where *both* strategies contribute, ensuring a seamless blend with no
    unmachined gaps at the boundary between steep and shallow zones.

The default steep threshold is 50 degrees from horizontal. Waterline Z-step
is computed from scallop-height geometry for the active tool shape (ball-end
or bull-nose), and raster stepover comes from the job's CutParams. Tangential
lead-in / lead-out arcs are generated for each waterline contour to prevent
entry marks and gouging.

All dimensions in mm, angles in degrees, feeds in mm/min.
"""
from __future__ import annotations

import math
from typing import List, Tuple

from ..models import (
    ToolpathChain,
    ToolpathJob,
    ToolpathResult,
    ToolShape,
    compute_stats,
)
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

# ── Constants ──────────────────────────────────────────────────────────

DEFAULT_STEEP_THRESHOLD_DEG: float = 50.0
"""Angle (from horizontal) above which a surface is classified as steep."""

OVERLAP_BAND_DEG: float = 5.0
"""Half-width of the angular overlap band on each side of the threshold."""


# ── Public entry point ─────────────────────────────────────────────────

def generate_steep_shallow(job: ToolpathJob, mesh: Mesh) -> ToolpathResult:
    """Generate a steep-and-shallow finishing toolpath.

    The algorithm proceeds in four phases:

    1. **Surface analysis** -- build a heightfield (CL surface for the active
       tool) and a surface-angle map, both sampled on the same XY grid.
    2. **Raster passes (shallow)** -- zigzag scan lines that emit feed moves
       only where the local surface angle is below the steep threshold plus
       the overlap band.  Steep pockets are skipped with rapid retracts.
    3. **Waterline passes (steep)** -- Z-level contours sliced from the mesh,
       offset by the tool radius, emitted only when at least part of the
       contour lies in a steep region.  Tangential lead-in/out arcs are added
       to each loop.
    4. **Statistics** -- distance, time, and feed-rate statistics are computed
       over the combined chain list.

    Parameters
    ----------
    job : ToolpathJob
        Complete job specification (tool, stock, cuts, tolerances, etc.).
    mesh : Mesh
        Triangle mesh of the part to be machined.

    Returns
    -------
    ToolpathResult
        Combined toolpath chains from both strategies, with stats populated.
    """
    result = ToolpathResult(strategy="steep_shallow")

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
            "stock must have positive area to generate a steep-and-shallow toolpath"
        )
        return result

    bounds = mesh.bounds

    tool_r = job.tool.radius
    stepover = job.cuts.stepover_mm
    safe_z = job.cuts.safe_z_mm
    feed = job.cuts.feed_mm_min
    plunge = job.cuts.plunge_mm_min

    # Adjust cutting feed for radial engagement (chip thinning).
    engagement_deg = compute_engagement_angle(tool_r, stepover)
    raster_cut_feed = adjust_feed_for_engagement(feed, engagement_deg)

    # Derive the steep/shallow threshold.  A tighter surface-finish target
    # nudges the boundary slightly lower so waterline covers more area,
    # producing finer finish on marginal surfaces.
    steep_threshold = _resolve_steep_threshold(job)
    upper_bound = steep_threshold + OVERLAP_BAND_DEG  # raster goes up to here
    lower_bound = steep_threshold - OVERLAP_BAND_DEG  # waterline goes down to here

    # ── Phase 1: build surface analysis grids ──────────────────────────

    resolution = max(0.1, min(stepover / 2.0, job.tolerance_mm * 10.0))
    hf = build_heightfield(mesh, resolution_mm=resolution, tool_radius=tool_r)
    angle_map = build_surface_angle_map(mesh, resolution_mm=resolution)

    # Working bounds clamped to stock and mesh extents
    x_min = max(job.stock.x_min, bounds.min_pt.x - tool_r)
    x_max = min(job.stock.x_max, bounds.max_pt.x + tool_r)
    y_min = max(job.stock.y_min, bounds.min_pt.y - tool_r)
    y_max = min(job.stock.y_max, bounds.max_pt.y + tool_r)

    floor_z = bounds.min_pt.z - 1.0

    # ── Phase 2: raster passes for shallow regions ─────────────────────

    y_positions = _gen_positions(y_min, y_max, stepover)
    x_positions = _gen_positions(x_min, x_max, resolution)

    flip = False
    for y in y_positions:
        chain = ToolpathChain(comment=f"steep_shallow-raster y={y:.3f}")
        x_scan = x_positions if not flip else list(reversed(x_positions))

        in_cut = False
        for x in x_scan:
            z = hf.sample_z(x, y)
            angle = angle_map.sample_z(x, y)

            # Outside mesh or in purely-steep zone -- retract and skip
            if z <= floor_z or angle > upper_bound:
                if in_cut:
                    last = chain.last
                    if last is not None:
                        chain.append_rapid(last.x, last.y, safe_z)
                    in_cut = False
                continue

            if not in_cut:
                # Approach: rapid to position, plunge to surface
                chain.append_rapid(x, y, safe_z)
                chain.append_rapid(x, y, z + 2.0)
                chain.append_feed(x, y, z, plunge)
                in_cut = True
            else:
                chain.append_feed(x, y, z, raster_cut_feed)

        # Retract at end of scan line
        if in_cut and chain.last is not None:
            chain.append_rapid(chain.last.x, chain.last.y, safe_z)

        if not chain.is_empty():
            result.chains.append(chain)

        flip = not flip

    # ── Phase 3: waterline passes for steep regions ────────────────────

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

    if not z_levels:
        result.warnings.append("No Z levels generated within mesh range")

    for z_level in z_levels:
        loops = slice_mesh_at_z(mesh, z_level)
        if not loops:
            continue

        for loop_idx, loop in enumerate(loops):
            if len(loop) < 3:
                continue

            # Only emit waterline where the contour traverses steep surface
            if not _loop_has_steep_region(loop, angle_map, lower_bound):
                continue

            # Offset contour by tool radius (try inward, then outward)
            offset_loop = offset_contour(loop, -tool_r)
            if len(offset_loop) < 3:
                offset_loop = offset_contour(loop, tool_r)
                if len(offset_loop) < 3:
                    continue

            # Skip degenerate contours with negligible area
            area = abs(contour_winding(offset_loop))
            if area < tool_r * tool_r * 0.01:
                continue

            chain = ToolpathChain(
                comment=f"steep_shallow-waterline z={z_level:.3f} loop={loop_idx}",
            )

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

            # Cut the contour
            for pt in offset_loop[1:]:
                chain.append_feed(pt[0], pt[1], z_level, wl_cut_feed)

            # Close loop back to start
            chain.append_feed(start[0], start[1], z_level, wl_cut_feed)

            # Tangential lead-out arc
            lead_out_pts = _compute_lead_out_arc(offset_loop, lead_in_r)
            if lead_out_pts:
                for pt in lead_out_pts:
                    chain.append_feed(pt[0], pt[1], z_level, feed * 0.5)

            # Retract
            last = chain.last
            if last is not None:
                chain.append_rapid(last.x, last.y, safe_z)
            else:
                chain.append_rapid(start[0], start[1], safe_z)

            result.chains.append(chain)

    # ── Phase 4: statistics ────────────────────────────────────────────

    n_raster = sum(1 for c in result.chains if "raster" in c.comment)
    n_waterline = sum(1 for c in result.chains if "waterline" in c.comment)
    result.warnings.insert(0, (
        f"Steep/shallow split at {steep_threshold:.1f} deg "
        f"(+/- {OVERLAP_BAND_DEG:.1f} deg overlap): "
        f"{n_raster} raster chains, {n_waterline} waterline chains"
    ))

    compute_stats(result, safe_z)
    return result


# ── Private helpers ────────────────────────────────────────────────────

def _resolve_steep_threshold(job: ToolpathJob) -> float:
    """Derive the steep/shallow boundary angle from job parameters.

    Starts from ``DEFAULT_STEEP_THRESHOLD_DEG`` and adjusts downward for
    finer surface-finish targets.  A lower threshold means more surface
    area is covered by waterline passes, which is appropriate when Ra is
    tight because waterline avoids the scallop ridges that raster leaves
    on moderately steep faces.

    The adjustment is clamped to [30, 65] degrees to stay physically
    sensible.
    """
    base = DEFAULT_STEEP_THRESHOLD_DEG

    # For Ra < 1.6 um (fine finish), lower the threshold to let waterline
    # cover more territory; for Ra > 6.3 um (rough), raise it.
    ra = job.surface_finish_ra_um
    if ra < 1.6:
        base -= 8.0
    elif ra < 3.2:
        base -= 3.0
    elif ra > 6.3:
        base += 5.0

    return max(30.0, min(base, 65.0))


def _gen_positions(start: float, end: float, step: float) -> list[float]:
    """Generate evenly spaced positions from *start* to *end* inclusive.

    Handles floating-point fencepost by allowing a small epsilon overshoot.
    """
    if step <= 0:
        return [start]
    positions: list[float] = []
    pos = start
    while pos <= end + 1e-6:
        positions.append(pos)
        pos += step
    return positions


def _compute_z_step(job: ToolpathJob) -> float:
    """Compute waterline Z step from tool shape and surface-finish target.

    For ball-end and bull-nose mills the step is derived from scallop-height
    geometry:

        scallop_peak = Ra * 4   (approximate Ra-to-peak conversion)
        z_step = 2 * sqrt(h * (2R - h))

    where *h* is the clamped scallop peak and *R* is the effective cutting
    radius (tool radius for ball-end, corner radius for bull-nose).

    For flat end-mills the user-specified ``z_step_mm`` is used directly.
    The result is always clamped to [0.05, z_step_mm].
    """
    if job.tool.shape == ToolShape.BALL:
        r = job.tool.radius
        scallop_mm = job.surface_finish_ra_um / 1000.0 * 4.0
        scallop_mm = max(0.005, min(scallop_mm, r * 0.5))
        z_step = 2.0 * math.sqrt(scallop_mm * (2.0 * r - scallop_mm))
        return max(0.05, min(z_step, job.cuts.z_step_mm))

    if job.tool.shape == ToolShape.BULL:
        cr = job.tool.corner_radius_mm
        if cr > 0:
            scallop_mm = job.surface_finish_ra_um / 1000.0 * 4.0
            scallop_mm = max(0.005, min(scallop_mm, cr * 0.5))
            z_step = 2.0 * math.sqrt(scallop_mm * (2.0 * cr - scallop_mm))
            return max(0.05, min(z_step, job.cuts.z_step_mm))

    return job.cuts.z_step_mm


def _loop_has_steep_region(
    loop: list[tuple[float, float]],
    angle_map: Heightfield,
    threshold: float,
) -> bool:
    """Return True if any sampled point on *loop* exceeds *threshold* degrees.

    Samples at most ~10 evenly spaced points around the loop to avoid
    O(n) overhead on very dense contours.
    """
    n = len(loop)
    if n == 0:
        return False
    check_interval = max(1, n // 10)
    for i in range(0, n, check_interval):
        pt = loop[i]
        angle = angle_map.sample_z(pt[0], pt[1])
        if angle > threshold:
            return True
    return False


def _compute_lead_in_arc(
    contour: list[tuple[float, float]],
    radius: float,
    arc_steps: int = 8,
) -> list[tuple[float, float]]:
    """Compute a quarter-circle tangential lead-in arc into the first contour point.

    The arc sweeps from a point offset perpendicular to the initial cut
    direction, curving smoothly into the contour start.  This avoids a
    straight plunge that would leave an entry mark on the finished surface.

    Returns an empty list if the contour is too short or *radius* is
    negligible, in which case the caller should fall back to a direct plunge.
    """
    if len(contour) < 2 or radius < 0.01:
        return []

    p0 = contour[0]
    p1 = contour[1]

    dx = p1[0] - p0[0]
    dy = p1[1] - p0[1]
    seg_len = math.sqrt(dx * dx + dy * dy)
    if seg_len < 1e-8:
        return []

    # Unit tangent along the first segment and outward normal
    tx = dx / seg_len
    ty = dy / seg_len
    nx = ty
    ny = -tx

    # Arc centre offset from the contour start along the normal
    cx = p0[0] + nx * radius
    cy = p0[1] + ny * radius

    points: list[tuple[float, float]] = []
    for i in range(arc_steps + 1):
        t = i / arc_steps
        angle = math.pi * 0.5 * (1.0 - t)  # 90 deg -> 0 deg
        ax = cx - nx * radius * math.cos(angle) + tx * radius * math.sin(angle)
        ay = cy - ny * radius * math.cos(angle) + ty * radius * math.sin(angle)
        points.append((ax, ay))

    return points


def _compute_lead_out_arc(
    contour: list[tuple[float, float]],
    radius: float,
    arc_steps: int = 8,
) -> list[tuple[float, float]]:
    """Compute a quarter-circle tangential lead-out arc departing the contour start.

    Called after the contour loop has been closed back to its first point.
    The arc curves away from the contour along the exit tangent so the tool
    lifts off smoothly without a witness mark.
    """
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
        angle = math.pi * 0.5 * t  # 0 deg -> 90 deg
        ax = cx - nx * radius * math.cos(angle) + tx * radius * math.sin(angle)
        ay = cy - ny * radius * math.cos(angle) + ty * radius * math.sin(angle)
        points.append((ax, ay))

    return points
