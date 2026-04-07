"""
Trochoidal HSM (High-Speed Machining) roughing strategy.

Generates constant-engagement trochoidal toolpaths that trace overlapping
circular arcs advancing along offset contours. This maintains a controlled
radial engagement angle even in full-width and tight-corner situations,
enabling higher feed rates and better tool life than conventional adaptive.

Features:
- Constant radial engagement via trochoidal circular motions
- Per-segment dynamic feed adjustment based on actual engagement
- Z-level stratification with heightfield floor detection
- Corner slowdown: reduces advance rate in tight curvature regions
- Smooth ramp entry to each Z level
"""
from __future__ import annotations

import math

from ..models import ToolpathChain, ToolpathJob, ToolpathResult, compute_stats
from ..optimizer import adjust_feed_for_engagement, compute_engagement_angle
from ..geometry import (
    Mesh,
    Heightfield,
    build_heightfield,
    slice_mesh_at_z,
    offset_contour,
    contour_winding,
    contour_length,
    point_in_polygon,
)


def generate_trochoidal_hsm(job: ToolpathJob, mesh: Mesh) -> ToolpathResult:
    """
    Generate trochoidal HSM roughing toolpath with constant engagement.

    At each Z level, offset contours are traversed with overlapping trochoidal
    circles. The circle diameter and advance rate are computed to maintain
    the target engagement angle throughout the cut.
    """
    result = ToolpathResult(strategy="trochoidal_hsm")
    bounds = mesh.bounds
    tool_r = job.tool.radius
    stepover = job.cuts.stepover_mm
    z_step = job.cuts.z_step_mm
    safe_z = job.cuts.safe_z_mm
    feed = job.cuts.feed_mm_min
    plunge = job.cuts.plunge_mm_min
    ramp_angle = job.cuts.ramp_angle_deg

    # Early exit: degenerate stock (zero or negative area)
    stock_dx = job.stock.x_max - job.stock.x_min
    stock_dy = job.stock.y_max - job.stock.y_min
    if stock_dx <= 1e-6 or stock_dy <= 1e-6:
        result.warnings.append(
            f"Degenerate stock dimensions: X={stock_dx:.3f} mm, Y={stock_dy:.3f} mm — "
            "stock must have positive area to generate a trochoidal HSM toolpath"
        )
        return result

    # Early exit: empty mesh
    if mesh.num_triangles == 0:
        result.warnings.append("Empty mesh — no triangles to machine")
        return result

    # Target engagement from job or default to 40% of tool diameter
    target_engagement_deg = min(job.max_engagement_deg, 90.0)
    target_engagement_rad = math.radians(target_engagement_deg)

    # Trochoidal circle radius: stepover-derived to maintain engagement
    # The circle radius determines the radial depth of cut per arc
    troch_radius = min(stepover * 0.8, tool_r * 0.4)
    troch_radius = max(troch_radius, 0.2)

    # Advance per trochoidal circle: controls engagement
    advance_per_circle = stepover * 0.6
    advance_per_circle = max(advance_per_circle, 0.1)

    # Build heightfield for floor detection
    hf_resolution = max(0.5, stepover / 2)
    hf = build_heightfield(mesh, resolution_mm=hf_resolution, tool_radius=tool_r)

    # Compute Z levels
    stock_top = job.stock.z_max
    mesh_bottom = bounds.min_pt.z
    z_levels = _compute_z_levels(stock_top, mesh_bottom, z_step)

    if not z_levels:
        result.warnings.append("No Z levels to machine (stock top <= mesh bottom)")
        return result

    stock_contour = _stock_rect(job)
    arc_steps = 12  # points per trochoidal circle

    for z_level in z_levels:
        mesh_loops = slice_mesh_at_z(mesh, z_level)

        # Generate offset passes from stock boundary inward
        current = offset_contour(stock_contour, -tool_r)
        pass_num = 0

        while True:
            if len(current) < 3:
                break
            area = abs(contour_winding(current))
            if area < stepover * stepover:
                break

            # Check if contour is inside mesh boundary (stop condition)
            if mesh_loops:
                cx = sum(p[0] for p in current) / len(current)
                cy = sum(p[1] for p in current) / len(current)
                mesh_boundaries = []
                for loop in mesh_loops:
                    oloop = offset_contour(loop, tool_r)
                    if len(oloop) >= 3:
                        mesh_boundaries.append(oloop)
                if any(point_in_polygon(cx, cy, b) for b in mesh_boundaries):
                    break

            # Enforce milling direction: CCW for climb, CW for conventional
            winding = contour_winding(current)
            if job.cuts.climb_milling and winding < 0:
                current = list(reversed(current))
            elif not job.cuts.climb_milling and winding > 0:
                current = list(reversed(current))

            chain = ToolpathChain(
                comment=f"trochoidal z={z_level:.3f} pass={pass_num}"
            )

            # Ramp entry on first pass, link move on subsequent
            if pass_num == 0:
                _add_ramp_entry(chain, current, z_level, safe_z, plunge, ramp_angle)
            else:
                _add_link_move(chain, current[0], z_level, safe_z, plunge)

            # Trochoidal traverse along the contour
            _add_trochoidal_contour(
                chain, current, z_level, tool_r, troch_radius,
                advance_per_circle, feed, target_engagement_deg,
                hf, arc_steps, job.cuts.climb_milling,
            )

            result.chains.append(chain)

            current = offset_contour(current, -stepover)
            pass_num += 1
            if pass_num > 500:
                break

    compute_stats(result, safe_z)
    return result


def _compute_z_levels(stock_top: float, mesh_bottom: float, z_step: float) -> list[float]:
    levels: list[float] = []
    z = stock_top - z_step
    while z >= mesh_bottom - 1e-6:
        levels.append(z)
        z -= z_step
    if levels and levels[-1] > mesh_bottom + 0.01:
        levels.append(mesh_bottom)
    if not levels and stock_top > mesh_bottom:
        levels.append(mesh_bottom)
    return levels


def _stock_rect(job: ToolpathJob) -> list[tuple[float, float]]:
    s = job.stock
    return [
        (s.x_min, s.y_min),
        (s.x_max, s.y_min),
        (s.x_max, s.y_max),
        (s.x_min, s.y_max),
    ]


def _add_ramp_entry(
    chain: ToolpathChain,
    contour: list[tuple[float, float]],
    z_level: float,
    safe_z: float,
    plunge: float,
    ramp_angle_deg: float,
) -> None:
    if not contour:
        return
    start = contour[0]
    chain.append_rapid(start[0], start[1], safe_z)

    ramp_angle_rad = math.radians(max(1.0, ramp_angle_deg))
    z_drop = safe_z - z_level
    if z_drop <= 0:
        chain.append_feed(start[0], start[1], z_level, plunge)
        return

    ramp_distance = z_drop / math.tan(ramp_angle_rad)
    total_dist = 0.0
    prev = start
    points_with_dist: list[tuple[float, float, float]] = [(start[0], start[1], 0.0)]

    for pt in contour[1:]:
        d = math.sqrt((pt[0] - prev[0]) ** 2 + (pt[1] - prev[1]) ** 2)
        total_dist += d
        points_with_dist.append((pt[0], pt[1], total_dist))
        prev = pt
        if total_dist >= ramp_distance:
            break

    if total_dist < ramp_distance and total_dist > 0:
        ramp_distance = total_dist

    for px, py, dist in points_with_dist:
        t = min(1.0, dist / ramp_distance) if ramp_distance > 0 else 1.0
        z = safe_z - t * z_drop
        chain.append_feed(px, py, z, plunge)


def _add_link_move(
    chain: ToolpathChain,
    target: tuple[float, float],
    z_level: float,
    safe_z: float,
    plunge: float,
) -> None:
    retract_z = z_level + 2.0
    last = chain.last
    if last:
        chain.append_rapid(last.x, last.y, retract_z)
    chain.append_rapid(target[0], target[1], retract_z)
    chain.append_feed(target[0], target[1], z_level, plunge)


def _add_trochoidal_contour(
    chain: ToolpathChain,
    contour: list[tuple[float, float]],
    z_level: float,
    tool_radius: float,
    troch_radius: float,
    advance: float,
    feed: float,
    target_engagement_deg: float,
    hf: Heightfield,
    arc_steps: int,
    climb_milling: bool = True,
) -> None:
    """
    Walk along the contour, generating trochoidal circles at each step.

    Each circle sweeps perpendicular to the contour direction while
    advancing along the contour by `advance` distance. The feed rate
    is dynamically adjusted based on the engagement angle implied by
    the trochoidal radius and stepover.
    """
    if len(contour) < 2:
        return

    # Compute cumulative distances along contour
    cum_dist = [0.0]
    for i in range(1, len(contour)):
        d = math.sqrt(
            (contour[i][0] - contour[i - 1][0]) ** 2
            + (contour[i][1] - contour[i - 1][1]) ** 2
        )
        cum_dist.append(cum_dist[-1] + d)

    total_length = cum_dist[-1]
    if total_length < 0.1:
        return

    # Engagement-adjusted feed: trochoidal maintains low engagement
    engagement = compute_engagement_angle(tool_radius, troch_radius * 2)
    adjusted_feed = adjust_feed_for_engagement(feed, engagement, target_engagement_deg)

    # Walk along contour generating trochoidal circles
    # CCW (positive d_theta) for climb milling, CW (negative) for conventional
    traveled = 0.0
    d_theta = 2.0 * math.pi / arc_steps
    if not climb_milling:
        d_theta = -d_theta

    while traveled < total_length:
        # Interpolate position and direction on contour
        px, py, dx, dy = _interpolate_contour(contour, cum_dist, traveled)

        # Perpendicular direction (left of travel direction)
        perp_x = -dy
        perp_y = dx

        # Local curvature detection: slow down in corners
        look_ahead = min(advance * 2, total_length - traveled)
        if look_ahead > 0.5:
            px2, py2, dx2, dy2 = _interpolate_contour(
                contour, cum_dist, traveled + look_ahead
            )
            dot = dx * dx2 + dy * dy2
            # dot < 0.7 means > 45 degree turn ahead: reduce advance
            if dot < 0.7:
                local_advance = advance * max(0.3, dot)
                local_feed = adjusted_feed * max(0.5, dot)
            else:
                local_advance = advance
                local_feed = adjusted_feed
        else:
            local_advance = advance
            local_feed = adjusted_feed

        # Floor detection: clamp Z to mesh surface
        floor_z = hf.sample_z(px, py)
        cut_z = max(z_level, floor_z)

        # Generate one trochoidal circle (direction set by climb_milling)
        for i in range(arc_steps + 1):
            theta = i * d_theta
            fwd_frac = i / arc_steps
            # Circle center advances along contour during arc
            fwd_offset = local_advance * fwd_frac
            # Arc point: perpendicular oscillation + forward advance
            ax = px + dx * fwd_offset + perp_x * troch_radius * math.cos(theta)
            ay = py + dy * fwd_offset + perp_y * troch_radius * math.cos(theta)
            # Forward component of the circle creates the trochoidal motion
            ax += dx * troch_radius * math.sin(theta)
            ay += dy * troch_radius * math.sin(theta)

            # Floor detection at arc point
            arc_floor = hf.sample_z(ax, ay)
            arc_z = max(cut_z, arc_floor)

            chain.append_feed(ax, ay, arc_z, local_feed)

        traveled += local_advance

    # Close: return to contour start
    start = contour[0]
    floor_z = hf.sample_z(start[0], start[1])
    chain.append_feed(start[0], start[1], max(z_level, floor_z), adjusted_feed)


def _interpolate_contour(
    contour: list[tuple[float, float]],
    cum_dist: list[float],
    distance: float,
) -> tuple[float, float, float, float]:
    """
    Interpolate position and unit direction on a contour at given distance.

    Returns (x, y, dir_x, dir_y) where dir is the unit tangent direction.
    """
    distance = max(0.0, min(distance, cum_dist[-1]))

    # Find segment containing this distance
    seg_idx = 0
    for i in range(1, len(cum_dist)):
        if cum_dist[i] >= distance:
            seg_idx = i - 1
            break
    else:
        seg_idx = len(contour) - 2

    seg_idx = max(0, min(seg_idx, len(contour) - 2))

    # Interpolate within segment
    seg_len = cum_dist[seg_idx + 1] - cum_dist[seg_idx]
    if seg_len < 1e-10:
        px = contour[seg_idx][0]
        py = contour[seg_idx][1]
        # Use next segment for direction if available
        if seg_idx + 1 < len(contour):
            dx = contour[seg_idx + 1][0] - contour[seg_idx][0]
            dy = contour[seg_idx + 1][1] - contour[seg_idx][1]
        else:
            dx, dy = 1.0, 0.0
    else:
        t = (distance - cum_dist[seg_idx]) / seg_len
        t = max(0.0, min(1.0, t))
        p0 = contour[seg_idx]
        p1 = contour[seg_idx + 1]
        px = p0[0] + t * (p1[0] - p0[0])
        py = p0[1] + t * (p1[1] - p0[1])
        dx = p1[0] - p0[0]
        dy = p1[1] - p0[1]

    # Normalize direction
    length = math.sqrt(dx * dx + dy * dy)
    if length < 1e-10:
        return px, py, 1.0, 0.0
    return px, py, dx / length, dy / length
