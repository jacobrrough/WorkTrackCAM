"""
Pencil trace finishing strategy.

Traces concave edges and fillets where ball-end raster/waterline leave
unfinished scallop material. Detects concave regions via heightfield
curvature analysis and generates targeted cleanup passes.
"""
from __future__ import annotations

import math

from ..models import ToolpathChain, ToolpathJob, ToolpathResult
from ..geometry import Mesh, Heightfield, build_heightfield

try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False


def generate_pencil(job: ToolpathJob, mesh: Mesh) -> ToolpathResult:
    """Generate pencil trace toolpath for concave regions."""
    result = ToolpathResult(strategy="pencil")
    bounds = mesh.bounds
    tool_r = job.tool.radius
    safe_z = job.cuts.safe_z_mm
    feed = job.cuts.feed_mm_min
    plunge = job.cuts.plunge_mm_min

    # Build fine heightfield for curvature detection
    resolution = max(0.2, tool_r / 3)
    hf = build_heightfield(mesh, resolution_mm=resolution, tool_radius=0.0)

    # Detect concave regions via second derivative (Laplacian) of heightfield
    concave_points = _find_concave_traces(hf, tool_r, threshold=0.02)

    if not concave_points:
        result.warnings.append("No concave regions detected for pencil trace")
        return result

    # Chain nearby concave points into trace paths
    traces = _chain_concave_points(concave_points, max_gap=resolution * 3)

    for trace_idx, trace in enumerate(traces):
        if len(trace) < 2:
            continue

        chain = ToolpathChain(comment=f"pencil trace {trace_idx}")

        # Rapid to start
        sx, sy, sz = trace[0]
        chain.append_rapid(sx, sy, safe_z)
        chain.append_rapid(sx, sy, sz + 2.0)
        chain.append_feed(sx, sy, sz, plunge)

        # Follow trace
        for x, y, z in trace[1:]:
            chain.append_feed(x, y, z, feed)

        # Retract
        chain.append_rapid(trace[-1][0], trace[-1][1], safe_z)
        result.chains.append(chain)

    _compute_stats(result, safe_z)
    return result


def _find_concave_traces(
    hf: Heightfield, tool_radius: float, threshold: float
) -> list[tuple[float, float, float]]:
    """
    Find concave points on the heightfield using Laplacian curvature.

    Points where the Laplacian is significantly negative indicate concave
    regions (valleys, fillets, inside corners).
    """
    points: list[tuple[float, float, float]] = []

    if HAS_NUMPY and hasattr(hf, 'grid'):
        grid = hf.grid
        ny, nx = grid.shape

        if nx < 3 or ny < 3:
            return points

        # Laplacian via finite differences
        laplacian = (
            grid[:-2, 1:-1] + grid[2:, 1:-1] +
            grid[1:-1, :-2] + grid[1:-1, 2:] -
            4 * grid[1:-1, 1:-1]
        )

        # Normalize by grid spacing
        laplacian /= (hf.dx * hf.dy)

        # Find strongly concave points
        concave_mask = laplacian < -threshold
        iy_indices, ix_indices = np.where(concave_mask)

        for k in range(len(iy_indices)):
            iy = int(iy_indices[k]) + 1  # +1 for the border offset
            ix = int(ix_indices[k]) + 1
            x = hf.world_x(ix)
            y = hf.world_y(iy)
            z = float(grid[iy, ix])
            points.append((x, y, z))
    else:
        # Pure Python fallback
        for iy in range(1, hf.ny - 1):
            for ix in range(1, hf.nx - 1):
                z_c = hf.get_z(ix, iy)
                z_l = hf.get_z(ix - 1, iy)
                z_r = hf.get_z(ix + 1, iy)
                z_u = hf.get_z(ix, iy - 1)
                z_d = hf.get_z(ix, iy + 1)

                lap = (z_l + z_r + z_u + z_d - 4 * z_c) / (hf.dx * hf.dy)
                if lap < -threshold:
                    x = hf.world_x(ix)
                    y = hf.world_y(iy)
                    points.append((x, y, z_c))

    return points


def _chain_concave_points(
    points: list[tuple[float, float, float]],
    max_gap: float,
) -> list[list[tuple[float, float, float]]]:
    """
    Chain nearby concave points into ordered traces.

    Uses a simple greedy nearest-neighbor chaining approach.
    """
    if not points:
        return []

    remaining = list(points)
    traces: list[list[tuple[float, float, float]]] = []

    while remaining:
        # Start a new trace from the first remaining point
        trace = [remaining.pop(0)]

        changed = True
        while changed:
            changed = False
            best_idx = -1
            best_dist = max_gap

            # Find nearest unvisited point to trace end
            tail = trace[-1]
            for i, pt in enumerate(remaining):
                d = math.sqrt((pt[0] - tail[0])**2 + (pt[1] - tail[1])**2)
                if d < best_dist:
                    best_dist = d
                    best_idx = i

            if best_idx >= 0:
                trace.append(remaining.pop(best_idx))
                changed = True

        if len(trace) >= 2:
            traces.append(trace)

    return traces


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
    cut_time = total_cut / 1000.0 if total_cut > 0 else 0
    result.estimated_time_s = (rapid_time + cut_time) * 60
