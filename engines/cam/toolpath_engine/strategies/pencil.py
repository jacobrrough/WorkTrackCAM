"""
Pencil trace finishing strategy.

Detects concave regions via heightfield curvature (Laplacian) and generates
targeted cleanup passes along valleys, fillets, and inside corners.
"""
from __future__ import annotations

import math

from ..models import ToolpathChain, ToolpathJob, ToolpathResult, compute_stats
from ..geometry import Mesh, Heightfield, build_heightfield
from ..optimizer import adjust_feed_for_engagement, compute_engagement_angle

try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False


def generate_pencil(job: ToolpathJob, mesh: Mesh) -> ToolpathResult:
    """Generate pencil trace toolpath for concave regions."""
    result = ToolpathResult(strategy="pencil")

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
            "stock must have positive area to generate a pencil trace toolpath"
        )
        return result

    bounds = mesh.bounds
    tool_r = job.tool.radius
    safe_z = job.cuts.safe_z_mm
    engagement_deg = compute_engagement_angle(tool_r, job.cuts.stepover_mm)
    feed = adjust_feed_for_engagement(job.cuts.feed_mm_min, engagement_deg)
    plunge = job.cuts.plunge_mm_min

    resolution = max(0.2, tool_r / 3)
    hf = build_heightfield(mesh, resolution_mm=resolution, tool_radius=0.0)

    concave_points = _find_concave_traces(hf, tool_r, threshold=0.02)

    if not concave_points:
        result.warnings.append("No concave regions detected for pencil trace")
        return result

    traces = _chain_concave_points(concave_points, max_gap=resolution * 3)

    for trace_idx, trace in enumerate(traces):
        if len(trace) < 2:
            continue

        chain = ToolpathChain(comment=f"pencil trace {trace_idx}")
        sx, sy, sz = trace[0]
        chain.append_rapid(sx, sy, safe_z)
        chain.append_rapid(sx, sy, sz + 2.0)
        chain.append_feed(sx, sy, sz, plunge)

        for x, y, z in trace[1:]:
            chain.append_feed(x, y, z, feed)

        chain.append_rapid(trace[-1][0], trace[-1][1], safe_z)
        result.chains.append(chain)

    compute_stats(result, safe_z)
    return result


def _find_concave_traces(
    hf: Heightfield, tool_radius: float, threshold: float,
) -> list[tuple[float, float, float]]:
    """Find concave points via Laplacian curvature analysis."""
    points: list[tuple[float, float, float]] = []

    if HAS_NUMPY and hf.grid is not None:
        grid = hf.grid
        ny, nx = grid.shape
        if nx < 3 or ny < 3:
            return points

        laplacian = (
            grid[:-2, 1:-1] + grid[2:, 1:-1]
            + grid[1:-1, :-2] + grid[1:-1, 2:]
            - 4 * grid[1:-1, 1:-1]
        )
        laplacian /= (hf.dx * hf.dy)

        concave_mask = laplacian < -threshold
        iy_indices, ix_indices = np.where(concave_mask)

        for k in range(len(iy_indices)):
            iy = int(iy_indices[k]) + 1
            ix = int(ix_indices[k]) + 1
            x = hf.world_x(ix)
            y = hf.world_y(iy)
            z = float(grid[iy, ix])
            points.append((x, y, z))
    else:
        for iy in range(1, hf.ny - 1):
            for ix in range(1, hf.nx - 1):
                z_c = hf.get_z(ix, iy)
                z_l = hf.get_z(ix - 1, iy)
                z_r = hf.get_z(ix + 1, iy)
                z_u = hf.get_z(ix, iy - 1)
                z_d = hf.get_z(ix, iy + 1)

                lap = (z_l + z_r + z_u + z_d - 4 * z_c) / (hf.dx * hf.dy)
                if lap < -threshold:
                    points.append((hf.world_x(ix), hf.world_y(iy), z_c))

    return points


def _chain_concave_points(
    points: list[tuple[float, float, float]], max_gap: float,
) -> list[list[tuple[float, float, float]]]:
    """Chain nearby concave points into ordered traces using greedy nearest-neighbor."""
    if not points:
        return []

    remaining = list(points)
    traces: list[list[tuple[float, float, float]]] = []

    while remaining:
        trace = [remaining.pop(0)]
        changed = True
        while changed:
            changed = False
            best_idx = -1
            best_dist = max_gap
            tail = trace[-1]
            for i, pt in enumerate(remaining):
                d = math.sqrt((pt[0] - tail[0]) ** 2 + (pt[1] - tail[1]) ** 2)
                if d < best_dist:
                    best_dist = d
                    best_idx = i
            if best_idx >= 0:
                trace.append(remaining.pop(best_idx))
                changed = True

        if len(trace) >= 2:
            traces.append(trace)

    return traces
