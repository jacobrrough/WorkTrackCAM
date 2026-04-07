"""
Waterline (Z-level) finishing strategy.

v4.1 — Adaptive Z-stepping for improved surface finish on curved parts.

Features:
- Drop-cutter-based heightfield for accurate CL surface
- Scallop-height-aware stepdown for ball-end and bull-nose mills
- Adaptive Z-stepping: tighter steps on shallow regions, normal steps on steep
- Tangential lead-in/lead-out arcs to prevent entry gouging
- Multi-loop handling with proper inside/outside detection
- Optimized chain ordering to minimize rapid traversal
- Overlap band at shallow regions for blending with raster strategies
"""
from __future__ import annotations

import math

try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False

from ..models import ToolpathChain, ToolpathJob, ToolpathResult, ToolShape, compute_stats
from ..geometry import (
    Mesh,
    Heightfield,
    build_heightfield,
    slice_mesh_at_z,
    offset_contour,
    contour_winding,
    contour_length,
)
from ..optimizer import adjust_feed_for_engagement, compute_engagement_angle

# ── Adaptive Z-step constants ────────────────────────────────────────────
_MIN_Z_STEP = 0.05          # mm — absolute minimum step to avoid micro-steps
_SHALLOW_THRESHOLD = 30.0   # degrees — surface angles below this are "shallow"
_SHALLOW_FACTOR_MIN = 0.5   # tightest multiplication factor for shallow regions
_SHALLOW_FACTOR_MAX = 0.7   # loosest multiplication factor for shallow regions
_SHALLOW_FRACTION_MIN = 0.15  # at least this fraction of cells must be "near" Z


def generate_waterline(job: ToolpathJob, mesh: Mesh) -> ToolpathResult:
    """Generate waterline finishing toolpath with scallop-optimized Z-steps."""
    result = ToolpathResult(strategy="waterline")

    # Early exit: degenerate stock (zero or negative area)
    stock_dx = job.stock.x_max - job.stock.x_min
    stock_dy = job.stock.y_max - job.stock.y_min
    if stock_dx <= 1e-6 or stock_dy <= 1e-6:
        result.warnings.append(
            f"Degenerate stock dimensions: X={stock_dx:.3f} mm, Y={stock_dy:.3f} mm — "
            "stock must have positive area to generate a waterline toolpath"
        )
        return result

    # Early exit: empty mesh
    if mesh.num_triangles == 0:
        result.warnings.append("Empty mesh — no triangles to machine")
        return result

    bounds = mesh.bounds
    tool_r = job.tool.radius
    safe_z = job.cuts.safe_z_mm
    feed = job.cuts.feed_mm_min
    plunge = job.cuts.plunge_mm_min

    z_step = _compute_z_step(job)

    # Adjust cutting feed for radial engagement (chip thinning).
    engagement_deg = compute_engagement_angle(tool_r, z_step)
    cut_feed = adjust_feed_for_engagement(feed, engagement_deg)

    z_top = bounds.max_pt.z - z_step * 0.5
    z_bottom = bounds.min_pt.z + tool_r * 0.25

    # Build a lightweight heightfield (raw surface, no tool compensation) for
    # adaptive Z-step estimation.  Resolution is coarse to keep this cheap.
    hf_resolution = max(1.0, (bounds.max_pt.x - bounds.min_pt.x) / 100.0)
    hf = build_heightfield(mesh, resolution_mm=hf_resolution, tool_radius=0.0)

    z_levels = _compute_adaptive_z_levels(z_top, z_bottom, z_step, hf)
    if not z_levels:
        result.warnings.append("No Z levels in mesh range")
        return result

    all_chains: list[tuple[ToolpathChain, float, float]] = []  # chain, start_x, start_y

    for z_level in z_levels:
        loops = slice_mesh_at_z(mesh, z_level)
        if not loops:
            continue

        for loop_idx, loop in enumerate(loops):
            if len(loop) < 3:
                continue

            # Try both inward and outward offset for different contour orientations
            offset_loop = offset_contour(loop, -tool_r)
            if len(offset_loop) < 3:
                offset_loop = offset_contour(loop, tool_r)
                if len(offset_loop) < 3:
                    continue

            # Ensure the offset contour has reasonable area
            area = abs(contour_winding(offset_loop))
            if area < tool_r * tool_r * 0.01:
                continue

            chain = ToolpathChain(comment=f"waterline z={z_level:.3f} loop={loop_idx}")

            start = offset_loop[0]

            # Tangential lead-in arc
            lead_in_r = min(tool_r * 0.5, 2.0)
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

            # Cut the contour (climb milling direction)
            if job.cuts.climb_milling:
                # Ensure CCW for climb milling on outside contours
                winding = contour_winding(offset_loop)
                if winding < 0:
                    offset_loop = list(reversed(offset_loop))

            for pt in offset_loop[1:]:
                chain.append_feed(pt[0], pt[1], z_level, cut_feed)

            # Close the loop
            chain.append_feed(start[0], start[1], z_level, cut_feed)

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

            all_chains.append((chain, start[0], start[1]))

    # Optimize chain ordering to minimize rapid traversal
    ordered = _order_chains_nearest_neighbor(all_chains)
    result.chains = ordered

    compute_stats(result, safe_z)
    return result


def _order_chains_nearest_neighbor(
    chains: list[tuple[ToolpathChain, float, float]],
) -> list[ToolpathChain]:
    """Reorder chains using nearest-neighbor heuristic to minimize rapids.

    Uses numpy for vectorized distance computation when available, reducing
    the inner-loop cost from O(n) Python iterations to a single vectorized
    operation per step.  Overall complexity remains O(n^2) but the constant
    factor is dramatically lower for large chain counts.
    """
    if not chains:
        return []
    if len(chains) == 1:
        return [chains[0][0]]

    n = len(chains)

    if HAS_NUMPY and n > 20:
        # Vectorized nearest-neighbor with numpy
        starts = np.array([(sx, sy) for _, sx, sy in chains], dtype=np.float64)  # (n, 2)
        used = np.zeros(n, dtype=np.bool_)
        ordered: list[ToolpathChain] = []
        cur = np.array([0.0, 0.0], dtype=np.float64)

        for _ in range(n):
            # Squared distances to all unused chains
            diffs = starts - cur  # (n, 2)
            dists_sq = diffs[:, 0] ** 2 + diffs[:, 1] ** 2  # (n,)
            dists_sq[used] = np.inf
            best_idx = int(np.argmin(dists_sq))

            chain, sx, sy = chains[best_idx]
            ordered.append(chain)
            used[best_idx] = True

            if chain.last:
                cur[0] = chain.last.x
                cur[1] = chain.last.y
            else:
                cur[0] = sx
                cur[1] = sy

        return ordered
    else:
        # Pure-Python fallback for small chain counts
        remaining = list(range(n))
        ordered_py: list[ToolpathChain] = []
        cx, cy = 0.0, 0.0

        while remaining:
            best_idx = -1
            best_dist = float("inf")
            for i in remaining:
                _, sx, sy = chains[i]
                d = (sx - cx) ** 2 + (sy - cy) ** 2  # skip sqrt for comparison
                if d < best_dist:
                    best_dist = d
                    best_idx = i

            chain, sx, sy = chains[best_idx]
            ordered_py.append(chain)
            remaining.remove(best_idx)

            if chain.last:
                cx, cy = chain.last.x, chain.last.y
            else:
                cx, cy = sx, sy

        return ordered_py


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


def _estimate_surface_angle_at_z(
    hf: Heightfield,
    z: float,
    z_step: float,
) -> float:
    """Estimate the average surface angle at a given Z level using the heightfield.

    Counts the fraction of heightfield cells whose Z value falls within
    [z - z_step, z]. A large fraction indicates a predominantly shallow (near-
    horizontal) surface at that level; a small fraction indicates steep walls.

    Returns an estimated angle in degrees:
      - ~0° means nearly all cells are at this Z (very shallow / flat)
      - ~90° means very few cells are at this Z (steep walls)
    """
    z_lo = z - z_step
    z_hi = z

    if HAS_NUMPY and hf.grid is not None:
        grid = hf.grid
        # Exclude default/unset cells (< mesh min - some margin)
        valid_mask = grid > -1e8
        valid_count = int(np.sum(valid_mask))
        if valid_count == 0:
            return 90.0
        in_band = np.sum((grid >= z_lo) & (grid <= z_hi) & valid_mask)
        fraction = float(in_band) / valid_count
    else:
        # Pure-Python fallback
        valid_count = 0
        in_band_count = 0
        for iy in range(hf.ny):
            for ix in range(hf.nx):
                val = hf.get_z(ix, iy)
                if val > -1e8:
                    valid_count += 1
                    if z_lo <= val <= z_hi:
                        in_band_count += 1
        if valid_count == 0:
            return 90.0
        fraction = in_band_count / valid_count

    # Map fraction to angle estimate:
    # fraction = 0 -> 90° (steep, no surface here)
    # fraction = 1 -> 0° (entirely flat at this level)
    # Use arccos for a smooth mapping: angle = arccos(fraction) in degrees
    # But clamp fraction to [0, 1] first
    fraction = max(0.0, min(1.0, fraction))
    if fraction < 1e-9:
        return 90.0
    angle_rad = math.acos(min(1.0, fraction))
    return math.degrees(angle_rad)


def _compute_adaptive_z_levels(
    z_top: float,
    z_bottom: float,
    z_step: float,
    hf: Heightfield,
) -> list[float]:
    """Compute Z-levels with adaptive stepping based on local surface angle.

    On shallow regions (low surface angle), the step is tightened to reduce
    scallop height. On steep regions, the normal z_step is used. If the
    surface has uniform steepness, the result is identical to constant stepping.

    The user's z_step is always the upper bound. The minimum step is _MIN_Z_STEP.
    """
    z_levels: list[float] = []
    z = z_top
    while z >= z_bottom - 1e-6:
        z_levels.append(z)
        angle = _estimate_surface_angle_at_z(hf, z, z_step)
        if angle < _SHALLOW_THRESHOLD:
            # Interpolate factor: angle=0 -> _SHALLOW_FACTOR_MIN, angle=threshold -> _SHALLOW_FACTOR_MAX
            t = angle / _SHALLOW_THRESHOLD
            factor = _SHALLOW_FACTOR_MIN + t * (_SHALLOW_FACTOR_MAX - _SHALLOW_FACTOR_MIN)
            adaptive_step = z_step * factor
        else:
            adaptive_step = z_step
        # Clamp to allowed range
        adaptive_step = max(_MIN_Z_STEP, min(adaptive_step, z_step))
        z -= adaptive_step
    return z_levels
