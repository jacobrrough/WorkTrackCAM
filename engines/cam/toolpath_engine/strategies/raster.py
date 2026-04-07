"""
Raster (parallel) finishing strategy.

Generates zigzag passes following the mesh surface via heightfield tracking.
Includes air-gap detection to minimize unnecessary retracts.

Features:
- Zigzag scan pattern to minimize retracts
- Heightfield-based Z tracking (tool follows surface)
- Configurable scan angle via ``raster_angle_deg`` (0 = Y-primary, 45 = diagonal)
- Lift detection: retracts only over air gaps, not continuous surface
"""
from __future__ import annotations

import math

try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False

from ..models import ToolpathChain, ToolpathJob, ToolpathResult, compute_stats
from ..geometry import Mesh, Heightfield, build_heightfield
from ..optimizer import (
    adjust_feed_for_engagement,
    apply_adaptive_feed_to_result,
    compute_engagement_angle,
)


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

    # Early exit: degenerate stock (zero or negative area)
    stock_dx = job.stock.x_max - job.stock.x_min
    stock_dy = job.stock.y_max - job.stock.y_min
    if stock_dx <= 1e-6 or stock_dy <= 1e-6:
        result.warnings.append(
            f"Degenerate stock dimensions: X={stock_dx:.3f} mm, Y={stock_dy:.3f} mm — "
            "stock must have positive area to generate a raster toolpath"
        )
        return result

    # Early exit: empty mesh
    if mesh.num_triangles == 0:
        result.warnings.append("Empty mesh — no triangles to machine")
        return result

    bounds = mesh.bounds
    tool_r = job.tool.radius
    stepover = job.cuts.stepover_mm
    safe_z = job.cuts.safe_z_mm
    feed = job.cuts.feed_mm_min
    plunge = job.cuts.plunge_mm_min

    # Adjust cutting feed for radial engagement (chip thinning).
    # For raster finishing, stepover determines the radial engagement per pass.
    engagement_deg = compute_engagement_angle(tool_r, stepover)
    cut_feed = adjust_feed_for_engagement(feed, engagement_deg)

    resolution = max(0.1, min(stepover / 2, job.tolerance_mm * 10))
    hf = build_heightfield(mesh, resolution_mm=resolution, tool_radius=tool_r)

    # Clamp scan bounds to mesh extents + tool radius
    wx_min = max(job.stock.x_min, bounds.min_pt.x - tool_r)
    wx_max = min(job.stock.x_max, bounds.max_pt.x + tool_r)
    wy_min = max(job.stock.y_min, bounds.min_pt.y - tool_r)
    wy_max = min(job.stock.y_max, bounds.max_pt.y + tool_r)

    # ── Rotation helpers ────────────────────────────────────────────────────
    angle_rad = math.radians(job.raster_angle_deg)
    cos_a = math.cos(angle_rad)
    sin_a = math.sin(angle_rad)
    # Centre of the scan region — rotation pivot
    cx = (wx_min + wx_max) / 2.0
    cy = (wy_min + wy_max) / 2.0

    def to_scan(wx: float, wy: float) -> tuple[float, float]:
        """World → scan frame (rotate by -angle)."""
        dx, dy = wx - cx, wy - cy
        return dx * cos_a + dy * sin_a, -dx * sin_a + dy * cos_a

    def to_world(su: float, sv: float) -> tuple[float, float]:
        """Scan frame → world (rotate by +angle)."""
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
    v_positions = _gen_positions(v_min, v_max, stepover)
    u_positions = _gen_positions(u_min, u_max, resolution)

    floor_z = bounds.min_pt.z - 1.0
    gap_threshold = resolution * 1.5

    flip = False
    for v in v_positions:
        u_scan = u_positions if not flip else list(reversed(u_positions))

        # Collect valid surface points (sample in world coords)
        points: list[tuple[float, float, float]] = []  # (wx, wy, z)
        for u in u_scan:
            wx, wy = to_world(u, v)
            z = hf.sample_z(wx, wy)
            if z > floor_z:
                points.append((wx, wy, z))

        if not points:
            flip = not flip
            continue

        comment = f"raster v={v:.3f}"
        if job.raster_angle_deg != 0.0:
            comment += f" angle={job.raster_angle_deg:.1f}deg"
        chain = ToolpathChain(comment=comment)

        # Emit scan line with gap detection.
        # A gap is detected when two consecutive *valid* surface points are
        # further apart in XY than the gap threshold.  Points with no mesh
        # contact are excluded from `points` entirely, so an unusually large
        # jump between consecutive list entries means the tool would traverse
        # a gap in the mesh surface.  In that case retract to safe_z and replunge.
        in_cut = False
        for i, (wx, wy, z) in enumerate(points):
            if not in_cut:
                chain.append_rapid(wx, wy, safe_z)
                chain.append_rapid(wx, wy, z + 2.0)
                chain.append_feed(wx, wy, z, plunge)
                in_cut = True
            else:
                prev_wx, prev_wy, _prev_z = points[i - 1]
                xy_dist = math.sqrt((wx - prev_wx) ** 2 + (wy - prev_wy) ** 2)
                if xy_dist > gap_threshold:
                    # Gap in surface coverage — retract and replunge
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

    # Apply per-segment adaptive feed when enabled
    if job.adaptive_feed_enabled:
        apply_adaptive_feed_to_result(
            result,
            tool_radius=tool_r,
            stepover=stepover,
            z_step=job.cuts.z_step_mm,
            base_feed=feed,
            target_engagement_deg=job.max_engagement_deg,
        )

    compute_stats(result, safe_z)
    return result


def _gen_positions(start: float, end: float, step: float) -> list[float]:
    """Generate evenly spaced positions from start to end.

    Uses numpy.arange when available for fast array generation instead of
    a Python while-loop with repeated list appends.
    """
    if step <= 1e-9:
        return [start] if start <= end + 1e-6 else []
    if HAS_NUMPY:
        arr = np.arange(start, end + 1e-6 + step * 0.5, step)
        # Trim any values past end + tolerance (arange can overshoot with floats)
        arr = arr[arr <= end + 1e-6]
        return arr.tolist()
    else:
        positions: list[float] = []
        pos = start
        while pos <= end + 1e-6:
            positions.append(pos)
            pos += step
        return positions
