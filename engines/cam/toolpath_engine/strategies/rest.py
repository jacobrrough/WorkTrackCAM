"""
Rest machining strategy.

Detects material left by a prior (larger) tool via dual-heightfield comparison
and generates targeted cleanup passes only in rest regions.
Vectorized rest mask when numpy is available.
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


def generate_rest(job: ToolpathJob, mesh: Mesh) -> ToolpathResult:
    """Generate rest machining toolpath."""
    result = ToolpathResult(strategy="rest")

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
            "stock must have positive area to generate a rest machining toolpath"
        )
        return result

    bounds = mesh.bounds
    tool_r = job.tool.radius
    prior_r = job.prior_tool_diameter_mm / 2.0
    safe_z = job.cuts.safe_z_mm
    feed = job.cuts.feed_mm_min
    plunge = job.cuts.plunge_mm_min
    stepover = job.cuts.stepover_mm

    # Adjust cutting feed for radial engagement (chip thinning).
    engagement_deg = compute_engagement_angle(tool_r, stepover)
    cut_feed = adjust_feed_for_engagement(feed, engagement_deg)

    if prior_r <= tool_r:
        result.warnings.append(
            f"Prior tool ({prior_r * 2:.1f}mm) not larger than current ({tool_r * 2:.1f}mm); "
            "rest machining requires a larger prior tool"
        )
        return result

    resolution = max(0.2, tool_r / 2)
    hf_prior = build_heightfield(mesh, resolution_mm=resolution, tool_radius=prior_r)
    hf_current = build_heightfield(mesh, resolution_mm=resolution, tool_radius=tool_r)

    # Scale threshold with tool radius: ~1% of tool radius, minimum 5 µm.
    # A 1mm micro-tool needs finer detection (10 µm) than a 20mm face mill (200 µm).
    # This matches the advanced engine's proportional threshold.
    threshold = max(0.005, tool_r * 0.01)
    rest_mask = _build_rest_mask(hf_prior, hf_current, threshold)
    if not any(any(row) for row in rest_mask):
        result.warnings.append("No rest material detected")
        return result

    # Raster passes through rest regions only
    flip = False
    y = hf_current.y_min
    while y <= hf_current.y_max:
        iy = int(round((y - hf_current.y_min) / hf_current.dy))
        iy = max(0, min(iy, hf_current.ny - 1))

        chain = ToolpathChain(comment=f"rest y={y:.3f}")
        in_rest = False

        x_start = hf_current.x_min
        x_end = hf_current.x_max
        x_positions = _x_range(x_start, x_end, resolution, flip)

        for x in x_positions:
            ix = int(round((x - hf_current.x_min) / hf_current.dx))
            ix = max(0, min(ix, hf_current.nx - 1))

            is_rest = (
                iy < len(rest_mask) and ix < len(rest_mask[0]) and rest_mask[iy][ix]
            )
            z = hf_current.sample_z(x, y)

            if is_rest and z > bounds.min_pt.z - 1.0:
                if not in_rest:
                    chain.append_rapid(x, y, safe_z)
                    chain.append_rapid(x, y, z + 2.0)
                    chain.append_feed(x, y, z, plunge)
                    in_rest = True
                else:
                    chain.append_feed(x, y, z, cut_feed)
            else:
                if in_rest:
                    last = chain.segments[-1]
                    chain.append_rapid(last.x, last.y, safe_z)
                    in_rest = False

        if in_rest and chain.segments:
            last = chain.segments[-1]
            chain.append_rapid(last.x, last.y, safe_z)

        if chain.segments:
            result.chains.append(chain)

        flip = not flip
        y += stepover

    compute_stats(result, safe_z)
    return result


def _build_rest_mask(
    hf_prior: Heightfield, hf_current: Heightfield, threshold: float,
) -> list[list[bool]]:
    ny = min(hf_prior.ny, hf_current.ny)
    nx = min(hf_prior.nx, hf_current.nx)

    # Vectorized path: compute entire mask in one numpy operation
    if HAS_NUMPY and hf_prior.grid is not None and hf_current.grid is not None:
        prior_slice = hf_prior.grid[:ny, :nx]
        current_slice = hf_current.grid[:ny, :nx]
        np_mask = (prior_slice - current_slice) > threshold
        return [list(row) for row in np_mask]

    # Fallback: Python loop
    mask: list[list[bool]] = []
    for iy in range(ny):
        row: list[bool] = []
        for ix in range(nx):
            z_prior = hf_prior.get_z(ix, iy)
            z_current = hf_current.get_z(ix, iy)
            row.append(z_prior - z_current > threshold)
        mask.append(row)
    return mask


def _x_range(x_start: float, x_end: float, step: float, flip: bool) -> list[float]:
    positions: list[float] = []
    x = x_start
    while x <= x_end + 1e-6:
        positions.append(x)
        x += step
    if flip:
        positions.reverse()
    return positions
