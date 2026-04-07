"""
Raster (parallel) finishing strategy.

Generates zigzag passes across the part surface, riding the heightfield.
Best for gently curved surfaces where waterline would produce sparse paths.

Features:
- Zigzag scan pattern to minimize retracts
- Heightfield-based Z tracking (tool follows surface)
- Configurable scan direction (X or Y primary)
- Lift detection: retracts only over air gaps, not continuous surface
"""
from __future__ import annotations

import math

from ..models import ToolpathChain, ToolpathJob, ToolpathResult
from ..geometry import Mesh, Heightfield, build_heightfield
from ..optimizer import adjust_feed_for_engagement, compute_engagement_angle


def generate_raster(job: ToolpathJob, mesh: Mesh) -> ToolpathResult:
    """Generate raster finishing toolpath following mesh surface.

    When ``job.raster_angle_deg`` is non-zero the scan direction is rotated by
    that angle.  World-space coordinates are transformed into a rotated scan
    frame, scan lines are generated in that frame (still Y-primary in the
    frame), and each output point is rotated back to world space before being
    appended to the toolpath.  This produces diagonal (e.g. 45°) and arbitrary-
    angle raster patterns without changing the heightfield sampling logic.
    """
    result = ToolpathResult(strategy="raster")
    bounds = mesh.bounds
    tool_r = job.tool.radius
    stepover = job.cuts.stepover_mm
    safe_z = job.cuts.safe_z_mm
    feed = job.cuts.feed_mm_min
    plunge = job.cuts.plunge_mm_min

    # Adjust cutting feed for radial engagement (chip thinning).
    engagement_deg = compute_engagement_angle(tool_r, stepover)
    cut_feed = adjust_feed_for_engagement(feed, engagement_deg)

    # Build heightfield with tool compensation
    resolution = max(0.1, min(stepover / 2, job.tolerance_mm * 10))
    hf = build_heightfield(mesh, resolution_mm=resolution, tool_radius=tool_r)

    # Stock bounds, clamped to mesh + tool radius
    wx_min = max(job.stock.x_min, bounds.min_pt.x - tool_r)
    wx_max = min(job.stock.x_max, bounds.max_pt.x + tool_r)
    wy_min = max(job.stock.y_min, bounds.min_pt.y - tool_r)
    wy_max = min(job.stock.y_max, bounds.max_pt.y + tool_r)

    # ── Rotation helpers ────────────────────────────────────────────────────
    angle_rad = math.radians(job.raster_angle_deg)
    cos_a = math.cos(angle_rad)
    sin_a = math.sin(angle_rad)
    # World → scan frame (rotate by -angle so the scan frame's Y aligns with the
    # requested scan direction).
    cx = (wx_min + wx_max) / 2.0
    cy = (wy_min + wy_max) / 2.0

    def to_scan(wx: float, wy: float) -> tuple[float, float]:
        dx, dy = wx - cx, wy - cy
        return dx * cos_a + dy * sin_a, -dx * sin_a + dy * cos_a

    def to_world(su: float, sv: float) -> tuple[float, float]:
        return cx + su * cos_a - sv * sin_a, cy + su * sin_a + sv * cos_a

    # Compute scan-frame bounding box from the four world corners
    corners_s = [
        to_scan(wx_min, wy_min),
        to_scan(wx_max, wy_min),
        to_scan(wx_min, wy_max),
        to_scan(wx_max, wy_max),
    ]
    u_min = min(c[0] for c in corners_s)
    u_max = max(c[0] for c in corners_s)
    v_min = min(c[1] for c in corners_s)
    v_max = max(c[1] for c in corners_s)

    # Generate scan lines along V (scan-frame Y), stepping in U (scan-frame X)
    v_positions = _generate_positions(v_min, v_max, stepover)
    u_positions = _generate_positions(u_min, u_max, resolution)

    gap_threshold = 2.0 * resolution

    flip = False
    for v in v_positions:
        u_scan = u_positions if not flip else list(reversed(u_positions))

        # Collect surface points for this scan line (sample in world coords)
        points: list[tuple[float, float, float]] = []  # (wx, wy, z)
        for u in u_scan:
            wx, wy = to_world(u, v)
            z = hf.sample_z(wx, wy)
            if z > bounds.min_pt.z - 1.0:
                points.append((wx, wy, z))

        if not points:
            flip = not flip
            continue

        chain = ToolpathChain(comment=f"raster v={v:.3f} angle={job.raster_angle_deg:.1f}deg")

        # Emit scan line with gap detection
        for i, (wx, wy, z) in enumerate(points):
            if i == 0:
                chain.append_rapid(wx, wy, safe_z)
                chain.append_rapid(wx, wy, z + 2.0)
                chain.append_feed(wx, wy, z, plunge)
            else:
                prev_wx, prev_wy, prev_z = points[i - 1]
                z_diff = abs(z - prev_z)
                if z_diff > gap_threshold and z < prev_z - gap_threshold:
                    chain.append_feed(wx, wy, z, cut_feed)
                elif z < bounds.min_pt.z - 0.5:
                    chain.append_rapid(prev_wx, prev_wy, safe_z)
                    chain.append_rapid(wx, wy, safe_z)
                    chain.append_rapid(wx, wy, z + 2.0)
                    chain.append_feed(wx, wy, z, plunge)
                else:
                    chain.append_feed(wx, wy, z, cut_feed)

        if chain.segments:
            last = chain.segments[-1]
            chain.append_rapid(last.x, last.y, safe_z)
            result.chains.append(chain)

        flip = not flip

    _compute_stats(result, safe_z)
    return result


def _generate_positions(start: float, end: float, step: float) -> list[float]:
    """Generate evenly spaced positions from start to end."""
    positions: list[float] = []
    pos = start
    while pos <= end + 1e-6:
        positions.append(pos)
        pos += step
    return positions


def _compute_stats(result: ToolpathResult, safe_z: float) -> None:
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
