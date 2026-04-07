"""
Waterline (Z-level) finishing strategy.

Generates contour passes at constant Z levels by slicing the mesh.
Ideal for steep-walled parts where raster would leave poor finish.

Features:
- Automatic Z-level spacing based on tool geometry and surface finish target
- Scallop-height aware stepdown for ball-end mills
- Contour ordering to minimize rapids
- Lead-in/lead-out arcs for smooth entry
"""
from __future__ import annotations

import math

from ..models import ToolpathChain, ToolpathJob, ToolpathResult, ToolShape
from ..geometry import Mesh, slice_mesh_at_z, offset_contour, contour_winding
from ..optimizer import adjust_feed_for_engagement, compute_engagement_angle


def generate_waterline(job: ToolpathJob, mesh: Mesh) -> ToolpathResult:
    """Generate waterline finishing toolpath."""
    result = ToolpathResult(strategy="waterline")
    bounds = mesh.bounds
    tool_r = job.tool.radius
    safe_z = job.cuts.safe_z_mm
    feed = job.cuts.feed_mm_min
    plunge = job.cuts.plunge_mm_min

    # Compute Z step from tool geometry
    z_step = _compute_z_step(job)

    # Adjust cutting feed for radial engagement.
    # For waterline finishing, the tool cuts a thin chip each Z level. The
    # effective radial engagement is approximated from z_step vs. tool radius.
    # When engagement < 90° (typical for finishing), chip thinning occurs and
    # feed can be increased to maintain target chip load.
    engagement_deg = compute_engagement_angle(tool_r, z_step)
    cut_feed = adjust_feed_for_engagement(feed, engagement_deg)

    # Generate Z levels from top to bottom
    z_top = bounds.max_pt.z - z_step * 0.5  # start slightly below top
    z_bottom = bounds.min_pt.z + tool_r * 0.25

    z_levels: list[float] = []
    z = z_top
    while z >= z_bottom - 1e-6:
        z_levels.append(z)
        z -= z_step
    if not z_levels:
        result.warnings.append("No Z levels in mesh range")
        return result

    for z_level in z_levels:
        loops = slice_mesh_at_z(mesh, z_level)
        if not loops:
            continue

        # Build all valid offset loops at this Z level before ordering them.
        valid_loops: list[list[tuple[float, float]]] = []
        for loop in loops:
            if len(loop) < 3:
                continue
            # Offset by tool radius (inward for outside contours)
            offset_loop = offset_contour(loop, -tool_r)
            if len(offset_loop) < 3:
                # Try outward offset (for inside contours / pockets)
                offset_loop = offset_contour(loop, tool_r)
                if len(offset_loop) < 3:
                    continue
            # Skip degenerate contours with negligible area
            area = abs(contour_winding(offset_loop))
            if area < tool_r * tool_r * 0.01:
                continue
            # Ensure CCW winding for climb milling (default), CW for conventional
            winding = contour_winding(offset_loop)
            if winding < 0:
                offset_loop = list(reversed(offset_loop))
            valid_loops.append(offset_loop)

        if not valid_loops:
            continue

        # Nearest-neighbor chain: order loops so each start is closest to the
        # previous endpoint, minimising rapid travel distance between contours.
        ordered_loops = _chain_loops_nearest_neighbor(valid_loops)

        for loop_idx, offset_loop in enumerate(ordered_loops):
            chain = ToolpathChain(
                comment=f"waterline z={z_level:.3f} loop={loop_idx}"
            )

            start = offset_loop[0]
            second = offset_loop[1] if len(offset_loop) > 1 else start

            # Lead-in arc: tangential entry reduces tool shock and witness marks
            leadin = _lead_in_arc_points(start, second, tool_r, z_level, safe_z)

            # Rapid to arc start
            chain.append_rapid(leadin[0][0], leadin[0][1], safe_z)
            chain.append_rapid(leadin[0][0], leadin[0][1], leadin[0][2])

            # Feed along lead-in arc down to cut Z
            for ax, ay, az in leadin[1:]:
                chain.append_feed(ax, ay, az, plunge)

            # Cut the contour using engagement-adjusted feed
            for pt in offset_loop[1:]:
                chain.append_feed(pt[0], pt[1], z_level, cut_feed)

            # Close the loop
            chain.append_feed(start[0], start[1], z_level, cut_feed)

            # Lead-out arc: tangential exit avoids dwell mark
            last = offset_loop[-1] if len(offset_loop) > 1 else start
            leadout = _lead_out_arc_points(start, last, tool_r, z_level, safe_z)
            for ox, oy, oz in leadout:
                chain.append_feed(ox, oy, oz, plunge)

            # Retract
            chain.append_rapid(leadout[-1][0], leadout[-1][1], safe_z)

            result.chains.append(chain)

    _compute_stats(result, safe_z)
    return result


def _chain_loops_nearest_neighbor(
    loops: list[list[tuple[float, float]]]
) -> list[list[tuple[float, float]]]:
    """
    Order contour loops at a single Z level so each loop's start point is as
    close as possible to the end of the preceding loop.

    This greedy nearest-neighbour pass reduces total rapid travel between
    waterline contours — particularly important for parts with many small
    islands at each Z level. O(n²) in the number of loops per level, which
    is acceptable because typical waterline passes have few contours per Z.
    """
    if len(loops) <= 1:
        return loops

    remaining = list(loops)
    ordered: list[list[tuple[float, float]]] = [remaining.pop(0)]
    cur_x, cur_y = ordered[0][0]

    while remaining:
        best_idx = 0
        best_dist = math.inf
        for i, loop in enumerate(remaining):
            sx, sy = loop[0]
            d = math.hypot(sx - cur_x, sy - cur_y)
            if d < best_dist:
                best_dist = d
                best_idx = i
        next_loop = remaining.pop(best_idx)
        ordered.append(next_loop)
        cur_x, cur_y = next_loop[0]

    return ordered


def _lead_in_arc_points(
    start: tuple[float, float],
    second: tuple[float, float],
    tool_r: float,
    z_level: float,
    safe_z: float,
    arc_steps: int = 8,
) -> list[tuple[float, float, float]]:
    """
    Generate a quarter-circle lead-in arc that approaches *start* tangentially
    from the direction perpendicular to the first contour segment.

    Returns a list of (x, y, z) points.  The first point is above z_level
    (approach altitude), the last point is at (start, z_level).
    """
    arc_r = min(tool_r * 0.75, 4.0)
    # Tangent direction along the contour at the start
    dx = second[0] - start[0]
    dy = second[1] - start[1]
    seg_len = math.hypot(dx, dy)
    if seg_len < 1e-9:
        # Degenerate: fall back to vertical plunge (no arc)
        return [(start[0], start[1], z_level + 2.0), (start[0], start[1], z_level)]
    tx, ty = dx / seg_len, dy / seg_len
    # Normal pointing away from material (perpendicular left)
    nx, ny = -ty, tx
    # Arc centre is offset from start by arc_r in the normal direction
    cx = start[0] + nx * arc_r
    cy = start[1] + ny * arc_r
    approach_z = min(z_level + 2.0, safe_z)
    pts: list[tuple[float, float, float]] = []
    for i in range(arc_steps + 1):
        t = i / arc_steps  # 0 → 1
        # Sweep from the normal direction (away) toward the start point
        angle = math.pi * 0.5 * (1.0 - t)  # π/2 → 0
        px = cx - nx * arc_r * math.cos(angle) + tx * arc_r * math.sin(angle)
        py = cy - ny * arc_r * math.cos(angle) + ty * arc_r * math.sin(angle)
        pz = approach_z + t * (z_level - approach_z)
        pts.append((px, py, pz))
    return pts


def _lead_out_arc_points(
    start: tuple[float, float],
    last: tuple[float, float],
    tool_r: float,
    z_level: float,
    safe_z: float,
    arc_steps: int = 8,
) -> list[tuple[float, float, float]]:
    """
    Generate a quarter-circle lead-out arc from *start* lifting away
    tangentially in the direction approaching from *last*.

    Mirrors the lead-in geometry on the exit side.
    """
    arc_r = min(tool_r * 0.75, 4.0)
    dx = start[0] - last[0]
    dy = start[1] - last[1]
    seg_len = math.hypot(dx, dy)
    if seg_len < 1e-9:
        return [(start[0], start[1], z_level + 2.0)]
    tx, ty = dx / seg_len, dy / seg_len
    nx, ny = -ty, tx
    cx = start[0] + nx * arc_r
    cy = start[1] + ny * arc_r
    exit_z = min(z_level + 2.0, safe_z)
    pts: list[tuple[float, float, float]] = []
    for i in range(1, arc_steps + 1):
        t = i / arc_steps  # 0 → 1
        angle = math.pi * 0.5 * t  # 0 → π/2
        px = cx - nx * arc_r * math.cos(angle) - tx * arc_r * math.sin(angle)
        py = cy - ny * arc_r * math.cos(angle) - ty * arc_r * math.sin(angle)
        pz = z_level + t * (exit_z - z_level)
        pts.append((px, py, pz))
    return pts


def _compute_z_step(job: ToolpathJob) -> float:
    """
    Compute optimal Z step based on tool shape and target surface finish.

    For ball-end mills: z_step = 2 * sqrt(Ra * (2*R - Ra))
    where Ra = target scallop height and R = ball radius.
    For flat-end mills: use configured z_step directly.
    """
    if job.tool.shape == ToolShape.BALL:
        r = job.tool.radius
        # Target scallop height in mm (from Ra in microns)
        scallop_mm = job.surface_finish_ra_um / 1000.0 * 4  # Ra to peak-valley approx
        scallop_mm = max(0.005, min(scallop_mm, r * 0.5))

        z_step = 2.0 * math.sqrt(scallop_mm * (2 * r - scallop_mm))
        return max(0.05, min(z_step, job.cuts.z_step_mm))

    elif job.tool.shape == ToolShape.BULL:
        # Bull nose: use corner radius for scallop calculation
        cr = job.tool.corner_radius_mm
        if cr > 0:
            scallop_mm = job.surface_finish_ra_um / 1000.0 * 4
            scallop_mm = max(0.005, min(scallop_mm, cr * 0.5))
            z_step = 2.0 * math.sqrt(scallop_mm * (2 * cr - scallop_mm))
            return max(0.05, min(z_step, job.cuts.z_step_mm))

    return job.cuts.z_step_mm


def _compute_stats(result: ToolpathResult, safe_z: float) -> None:
    """Compute distance and time statistics."""
    total_cut = 0.0
    total_rapid = 0.0
    prev_x, prev_y, prev_z = 0.0, 0.0, safe_z

    for chain in result.chains:
        for seg in chain.segments:
            d = math.sqrt(
                (seg.x - prev_x) ** 2 + (seg.y - prev_y) ** 2 + (seg.z - prev_z) ** 2
            )
            if seg.is_rapid:
                total_rapid += d
            else:
                total_cut += d
            prev_x, prev_y, prev_z = seg.x, seg.y, seg.z

    result.cut_distance_mm = total_cut
    result.rapid_distance_mm = total_rapid
    result.total_distance_mm = total_cut + total_rapid

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
