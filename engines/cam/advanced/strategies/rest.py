"""
Rest machining strategy.

Detects areas where a prior (larger) tool left material and generates
targeted cleanup passes with the current (smaller) tool.

Uses heightfield comparison: builds one heightfield with the prior tool
radius and one with the current tool radius. Where the difference exceeds
a threshold, rest material exists.
"""
from __future__ import annotations

import math

from ..models import ToolpathChain, ToolpathJob, ToolpathResult
from ..geometry import Mesh, Heightfield, build_heightfield
from ..optimizer import adjust_feed_for_engagement, compute_engagement_angle


def generate_rest(job: ToolpathJob, mesh: Mesh) -> ToolpathResult:
    """Generate rest machining toolpath."""
    result = ToolpathResult(strategy="rest")
    bounds = mesh.bounds
    tool_r = job.tool.radius
    prior_r = job.prior_tool_diameter_mm / 2.0
    safe_z = job.cuts.safe_z_mm
    feed = job.cuts.feed_mm_min
    plunge = job.cuts.plunge_mm_min
    stepover = job.cuts.stepover_mm

    # Adjust feed for actual radial engagement so rest passes maintain chip load.
    # Rest raster uses the same stepover as a finish raster — chip-thinning at
    # low engagement means we can push the feed faster; slotting reduces it.
    engagement_deg = compute_engagement_angle(tool_r, stepover)
    feed = adjust_feed_for_engagement(feed, engagement_deg)

    if prior_r <= tool_r:
        result.warnings.append(
            f"Prior tool ({prior_r*2:.1f}mm) not larger than current ({tool_r*2:.1f}mm); "
            "rest machining requires a larger prior tool"
        )
        return result

    # Build heightfields: one for prior tool, one for current tool
    resolution = max(0.2, tool_r / 2)
    hf_prior = build_heightfield(mesh, resolution_mm=resolution, tool_radius=prior_r)
    hf_current = build_heightfield(mesh, resolution_mm=resolution, tool_radius=tool_r)

    # Find rest regions: where prior tool leaves material that current tool can reach
    # rest = prior_z - current_z > threshold (prior tool rides higher = leaves material)
    # Scale threshold with tool radius: ~1% of tool radius, minimum 5 µm.
    # Tiny tools need finer detection; large face mills do not need sub-micron resolution.
    threshold = max(0.005, tool_r * 0.01)

    rest_mask = _build_rest_mask(hf_prior, hf_current, threshold)
    if not any(any(row) for row in rest_mask):
        result.warnings.append("No rest material detected")
        return result

    # Generate raster passes only through rest regions
    y_step = stepover
    x_step = resolution

    flip = False
    y = hf_current.y_min
    while y <= hf_current.y_max:
        iy = int(round((y - hf_current.y_min) / hf_current.dy))
        iy = max(0, min(iy, hf_current.ny - 1))

        chain = ToolpathChain(comment=f"rest raster y={y:.3f}")
        in_rest = False

        x_start = hf_current.x_min
        x_end = hf_current.x_max
        x_range = _x_range(x_start, x_end, x_step, flip)

        for x in x_range:
            ix = int(round((x - hf_current.x_min) / hf_current.dx))
            ix = max(0, min(ix, hf_current.nx - 1))

            is_rest = rest_mask[iy][ix] if iy < len(rest_mask) and ix < len(rest_mask[0]) else False
            z = hf_current.sample_z(x, y)

            if is_rest and z > bounds.min_pt.z - 1.0:
                if not in_rest:
                    # Start new rest cut
                    chain.append_rapid(x, y, safe_z)
                    chain.append_rapid(x, y, z + 2.0)
                    chain.append_feed(x, y, z, plunge)
                    in_rest = True
                else:
                    chain.append_feed(x, y, z, feed)
            else:
                if in_rest:
                    # End rest cut segment
                    last = chain.segments[-1]
                    chain.append_rapid(last.x, last.y, safe_z)
                    in_rest = False

        if in_rest and chain.segments:
            last = chain.segments[-1]
            chain.append_rapid(last.x, last.y, safe_z)

        if chain.segments:
            result.chains.append(chain)

        flip = not flip
        y += y_step

    _compute_stats(result, safe_z)
    return result


def _build_rest_mask(
    hf_prior: Heightfield, hf_current: Heightfield, threshold: float,
) -> list[list[bool]]:
    """Build a boolean mask of rest material locations."""
    ny = min(hf_prior.ny, hf_current.ny)
    nx = min(hf_prior.nx, hf_current.nx)

    mask: list[list[bool]] = []
    for iy in range(ny):
        row: list[bool] = []
        for ix in range(nx):
            z_prior = hf_prior.get_z(ix, iy)
            z_current = hf_current.get_z(ix, iy)
            # Prior tool rides higher (leaves more material) than current tool can reach
            row.append(z_prior - z_current > threshold)
        mask.append(row)

    return mask


def _x_range(x_start: float, x_end: float, step: float, flip: bool) -> list[float]:
    """Generate X positions for a scan line."""
    positions: list[float] = []
    x = x_start
    while x <= x_end + 1e-6:
        positions.append(x)
        x += step
    if flip:
        positions.reverse()
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
    cut_time = total_cut / 1000.0 if total_cut > 0 else 0
    result.estimated_time_s = (rapid_time + cut_time) * 60
