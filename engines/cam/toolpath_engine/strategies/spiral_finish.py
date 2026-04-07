"""
Spiral finishing strategy.

Generates a continuous spiral path from the outside of the stock inward
(or top-down in Z) that follows the mesh surface. This minimizes retracts
and produces excellent surface finish on gently curved surfaces.

The spiral is a hybrid: XY spiral with Z surface-following via heightfield.
"""
from __future__ import annotations

import math

from ..models import ToolpathChain, ToolpathJob, ToolpathResult, compute_stats
from ..geometry import Mesh, Heightfield, build_heightfield
from ..optimizer import adjust_feed_for_engagement, compute_engagement_angle


def generate_spiral_finish(job: ToolpathJob, mesh: Mesh) -> ToolpathResult:
    """Generate spiral finishing toolpath."""
    result = ToolpathResult(strategy="spiral_finish")

    # Early exit: degenerate stock (zero or negative area)
    stock_dx = job.stock.x_max - job.stock.x_min
    stock_dy = job.stock.y_max - job.stock.y_min
    if stock_dx <= 1e-6 or stock_dy <= 1e-6:
        result.warnings.append(
            f"Degenerate stock dimensions: X={stock_dx:.3f} mm, Y={stock_dy:.3f} mm — "
            "stock must have positive area to generate a spiral finish toolpath"
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
    engagement_deg = compute_engagement_angle(tool_r, stepover)
    cut_feed = adjust_feed_for_engagement(feed, engagement_deg)

    resolution = max(0.1, min(stepover / 2, job.tolerance_mm * 10))
    hf = build_heightfield(mesh, resolution_mm=resolution, tool_radius=tool_r)

    # Compute spiral center and extents
    cx = (bounds.min_pt.x + bounds.max_pt.x) / 2.0
    cy = (bounds.min_pt.y + bounds.max_pt.y) / 2.0
    rx = (bounds.max_pt.x - bounds.min_pt.x) / 2.0 + tool_r
    ry = (bounds.max_pt.y - bounds.min_pt.y) / 2.0 + tool_r
    max_r = math.sqrt(rx * rx + ry * ry)

    if max_r < stepover:
        result.warnings.append("Part too small for spiral finishing")
        return result

    # Generate Archimedean spiral from outside in
    # r(theta) = max_r - stepover * theta / (2*pi)
    points_per_rev = max(36, int(2 * math.pi * max_r / resolution))
    d_theta = 2.0 * math.pi / points_per_rev
    r_decrement_per_step = stepover / points_per_rev

    chain = ToolpathChain(comment="spiral finish")

    # Start position
    theta = 0.0
    r = max_r
    sx = cx + r * math.cos(theta)
    sy = cy + r * math.sin(theta)
    sz = hf.sample_z(sx, sy)

    chain.append_rapid(sx, sy, safe_z)
    chain.append_rapid(sx, sy, sz + 2.0)
    chain.append_feed(sx, sy, sz, plunge)

    # Spiral inward with air-gap detection: retract when cutter crosses
    # below the mesh floor instead of dragging through empty space.
    floor_z = bounds.min_pt.z - 1.0
    air_gap_threshold = 0.5  # mm below floor triggers retract
    in_cut = True  # start in-cut after the initial plunge
    step_count = 0
    max_steps = int((max_r / stepover) * points_per_rev * 1.1)

    while r > stepover * 0.5 and step_count < max_steps:
        theta += d_theta
        r -= r_decrement_per_step
        if r < 0:
            break

        # Elliptical scaling to match part aspect ratio
        x = cx + r * (rx / max_r) * math.cos(theta)
        y = cy + r * (ry / max_r) * math.sin(theta)
        z = hf.sample_z(x, y)

        if z < floor_z + air_gap_threshold:
            # Below mesh floor — air gap detected
            if in_cut:
                # Retract from current position
                last = chain.last
                if last:
                    chain.append_rapid(last.x, last.y, safe_z)
                in_cut = False
        else:
            if not in_cut:
                # Re-engage: rapid to new XY at safe height, then plunge
                chain.append_rapid(x, y, safe_z)
                chain.append_rapid(x, y, z + 2.0)
                chain.append_feed(x, y, z, plunge)
                in_cut = True
            else:
                chain.append_feed(x, y, z, cut_feed)
        step_count += 1

    # Final retract
    if chain.segments:
        last = chain.segments[-1]
        if in_cut:
            chain.append_rapid(last.x, last.y, safe_z)
        result.chains.append(chain)

    compute_stats(result, safe_z)
    return result
