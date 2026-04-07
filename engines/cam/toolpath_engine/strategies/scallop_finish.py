"""
Scallop finishing strategy — constant scallop height across 3D surfaces.

Unlike constant-stepover raster finishing, this strategy adapts the XY pass
spacing so that the residual cusp (scallop) left between adjacent passes
has a uniform peak-to-valley height everywhere on the part.  This produces
even surface finish quality on both steep and gently curved regions.

Scallop height geometry
-----------------------
When a ball-endmill of radius R passes over a surface inclined at angle
theta from horizontal, two adjacent passes separated by stepover *s* leave
a cusp whose peak-to-valley height *h* satisfies:

    h = R - sqrt(R^2 - (s / (2 * cos(theta)))^2)

Solving for the stepover that yields a target scallop height *h_target*:

    s = 2 * cos(theta) * sqrt(h_target * (2*R - h_target))

On a perfectly horizontal surface (theta = 0) this reduces to the
standard formula.  As the surface steepens the passes are brought closer
together automatically.

For flat endmills the cusp height is theoretically zero (the tool
sweeps a flat band), so we fall back to the user-specified stepover.
For bull-nose (toroidal) endmills the corner radius replaces R in the
formula above.

Ra-to-scallop conversion
-------------------------
The target scallop height is derived from the user-specified Ra (arithmetic
average roughness) via the approximation:

    scallop_peak_valley ~= Ra * 4

This assumes a roughly sinusoidal cusp profile which is a good fit for
ball-endmill finishing.
"""
from __future__ import annotations

import math

from ..models import (
    ToolpathChain,
    ToolpathJob,
    ToolpathResult,
    ToolShape,
    compute_stats,
)
from ..geometry import Mesh, Heightfield, build_heightfield, build_surface_angle_map
from ..optimizer import adjust_feed_for_engagement, compute_engagement_angle


# ── Constants ──────────────────────────────────────────────────────────

_MIN_STEPOVER_MM = 0.05   # Prevent infinite passes on near-vertical walls
_VERTICAL_SKIP_DEG = 85.0  # Skip passes where angle exceeds this (waterline territory)
_LEADIN_MM = 0.5           # Lead-in / lead-out extension beyond mesh bounds
_AIR_GAP_THRESHOLD = 0.5   # Z drop below floor used as air-gap indicator


# ── Public entry point ─────────────────────────────────────────────────

def generate_scallop(job: ToolpathJob, mesh: Mesh) -> ToolpathResult:
    """Generate a scallop-height-controlled finishing toolpath.

    The XY pass spacing varies along the Y axis so that the residual cusp
    between adjacent passes maintains a constant peak-to-valley height
    derived from ``job.surface_finish_ra_um``.

    Parameters
    ----------
    job : ToolpathJob
        Complete job specification including tool geometry, cut parameters,
        surface finish target, and stock bounds.
    mesh : Mesh
        Triangle mesh of the part to be machined.

    Returns
    -------
    ToolpathResult
        Toolpath chains with computed statistics.
    """
    result = ToolpathResult(strategy="scallop")

    # Early exit: degenerate stock (zero or negative area)
    stock_dx = job.stock.x_max - job.stock.x_min
    stock_dy = job.stock.y_max - job.stock.y_min
    if stock_dx <= 1e-6 or stock_dy <= 1e-6:
        result.warnings.append(
            f"Degenerate stock dimensions: X={stock_dx:.3f} mm, Y={stock_dy:.3f} mm — "
            "stock must have positive area to generate a scallop toolpath"
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
    user_stepover = job.cuts.stepover_mm

    # ── Scallop height target ──────────────────────────────────────────
    scallop_h = _target_scallop_height(job.surface_finish_ra_um)

    # ── Cusp radius for the stepover formula ───────────────────────────
    cusp_radius = _cusp_radius(job.tool.shape, tool_r, job.tool.corner_radius_mm)

    if cusp_radius <= 0.0:
        # Flat endmill — no cusp geometry, fall back to constant stepover
        result.warnings.append(
            "Flat endmill produces no scallop; falling back to constant stepover."
        )
        cusp_radius = 0.0

    # ── Build heightfield and angle map ────────────────────────────────
    resolution = max(0.1, min(user_stepover / 2.0, job.tolerance_mm * 10.0))
    hf = build_heightfield(
        mesh,
        resolution_mm=resolution,
        tool_radius=tool_r,
        tool_shape=job.tool.shape,
        corner_radius=job.tool.corner_radius_mm,
    )
    angle_map = build_surface_angle_map(mesh, resolution_mm=resolution)

    # ── Scan bounds (mesh extents + tool radius) ───────────────────────
    x_min = max(job.stock.x_min, bounds.min_pt.x - tool_r)
    x_max = min(job.stock.x_max, bounds.max_pt.x + tool_r)
    y_min = max(job.stock.y_min, bounds.min_pt.y - tool_r)
    y_max = min(job.stock.y_max, bounds.max_pt.y + tool_r)

    if x_max <= x_min or y_max <= y_min:
        result.warnings.append("Mesh bounds are degenerate; no toolpath generated.")
        return result

    # ── Generate adaptive Y positions ──────────────────────────────────
    y_positions = _adaptive_y_positions(
        y_min, y_max, x_min, x_max,
        angle_map, cusp_radius, scallop_h,
        user_stepover,
    )

    if not y_positions:
        result.warnings.append("No valid Y positions computed.")
        return result

    x_positions = _gen_positions(x_min - _LEADIN_MM, x_max + _LEADIN_MM, resolution)
    floor_z = bounds.min_pt.z - 1.0

    # ── Raster passes with zigzag ──────────────────────────────────────
    flip = False
    prev_y: float | None = None
    for y in y_positions:
        chain = ToolpathChain(comment=f"scallop y={y:.3f}")
        x_scan = x_positions if not flip else list(reversed(x_positions))

        # Collect surface points along the raster line
        points: list[tuple[float, float]] = []
        for x in x_scan:
            z = hf.sample_z(x, y)
            if math.isfinite(z) and z > floor_z:
                points.append((x, z))

        if not points:
            flip = not flip
            prev_y = y
            continue

        # Adjust cutting feed for the actual local stepover (chip thinning).
        local_stepover = (y - prev_y) if prev_y is not None else user_stepover
        local_engagement = compute_engagement_angle(tool_r, local_stepover)
        cut_feed = adjust_feed_for_engagement(feed, local_engagement)

        # Emit the pass with air-gap detection and retract
        _emit_pass(chain, points, y, safe_z, cut_feed, plunge, floor_z)

        if chain.segments:
            # Lead-out retract
            chain.append_rapid(chain.segments[-1].x, y, safe_z)
            result.chains.append(chain)

        prev_y = y
        flip = not flip

    if not result.chains:
        result.warnings.append("Scallop strategy produced no toolpath chains.")

    compute_stats(result, safe_z)
    return result


# ── Scallop geometry helpers ───────────────────────────────────────────

def _target_scallop_height(ra_um: float) -> float:
    """Convert Ra (um) to target peak-to-valley scallop height (mm).

    Uses the standard approximation for a sinusoidal cusp profile:
        peak_to_valley ~= Ra * 4

    A sensible floor is applied so the value never reaches zero.
    """
    h_mm = (ra_um * 4.0) / 1000.0  # um -> mm
    return max(h_mm, 0.0005)  # floor at 0.5 um


def _cusp_radius(shape: ToolShape, tool_radius: float, corner_radius: float) -> float:
    """Return the effective radius governing cusp geometry.

    - Ball endmill: full tool radius
    - Bull-nose: the corner (torus) radius
    - Flat / other: 0 (no cusp)
    """
    if shape == ToolShape.BALL:
        return tool_radius
    if shape == ToolShape.BULL:
        return corner_radius if corner_radius > 0.0 else 0.0
    return 0.0


def _stepover_for_angle(
    angle_deg: float,
    cusp_radius: float,
    scallop_h: float,
    max_stepover: float,
) -> float:
    """Compute the adaptive stepover to maintain *scallop_h* at a given surface angle.

    Returns a value clamped between ``_MIN_STEPOVER_MM`` and *max_stepover*.
    """
    if cusp_radius <= 0.0:
        # Flat endmill — constant stepover regardless of angle
        return max_stepover

    if angle_deg >= _VERTICAL_SKIP_DEG:
        # Near-vertical: signal caller to skip this pass
        return 0.0

    # Clamp scallop height to less than the cusp radius (geometric constraint)
    h = min(scallop_h, cusp_radius * 0.99)

    cos_theta = math.cos(math.radians(angle_deg))
    if cos_theta < 1e-9:
        return _MIN_STEPOVER_MM

    # s = 2 * cos(theta) * sqrt(h * (2R - h))
    discriminant = h * (2.0 * cusp_radius - h)
    if discriminant <= 0.0:
        return _MIN_STEPOVER_MM

    stepover = 2.0 * cos_theta * math.sqrt(discriminant)

    return max(_MIN_STEPOVER_MM, min(stepover, max_stepover))


# ── Y-position generation with adaptive spacing ───────────────────────

def _adaptive_y_positions(
    y_min: float,
    y_max: float,
    x_min: float,
    x_max: float,
    angle_map: Heightfield,
    cusp_radius: float,
    scallop_h: float,
    max_stepover: float,
) -> list[float]:
    """Build a list of Y positions with adaptive spacing.

    At each candidate Y the dominant surface angle is sampled across the
    X extent and the stepover is computed to maintain the target scallop
    height.  Passes at angles beyond the vertical threshold are omitted.
    """
    positions: list[float] = []
    y = y_min

    # Number of X samples used to estimate the dominant angle at a given Y
    n_samples = max(5, int((x_max - x_min) / max(max_stepover, 1.0)))
    x_step = (x_max - x_min) / n_samples if n_samples > 1 else 0.0

    while y <= y_max + 1e-6:
        positions.append(y)

        # Sample the surface angle across the X width at this Y
        angle = _dominant_angle_at_y(
            y, x_min, x_step, n_samples, angle_map,
        )

        step = _stepover_for_angle(angle, cusp_radius, scallop_h, max_stepover)

        if step <= 0.0:
            # Near-vertical band — skip ahead by the minimum stepover
            y += _MIN_STEPOVER_MM
        else:
            y += step

    return positions


def _dominant_angle_at_y(
    y: float,
    x_min: float,
    x_step: float,
    n_samples: int,
    angle_map: Heightfield,
) -> float:
    """Return the representative surface angle at a given Y position.

    Samples *n_samples* points across the X extent and returns the
    weighted-maximum angle (75th percentile approximation) so that the
    stepover is conservatively small enough for the steepest common region
    while not being dominated by isolated outliers.
    """
    angles: list[float] = []
    x = x_min
    for _ in range(n_samples + 1):
        a = angle_map.sample_z(x, y)  # angle_map stores degrees as "Z"
        if math.isfinite(a):
            angles.append(a)
        x += x_step

    if not angles:
        return 0.0

    angles.sort()
    # Use 75th percentile as the representative angle — steeper than average
    # but not skewed by one-off spikes.
    idx = min(int(len(angles) * 0.75), len(angles) - 1)
    return angles[idx]


# ── Pass emission ──────────────────────────────────────────────────────

def _emit_pass(
    chain: ToolpathChain,
    points: list[tuple[float, float]],
    y: float,
    safe_z: float,
    feed: float,
    plunge: float,
    floor_z: float,
) -> None:
    """Emit a single raster pass with air-gap detection.

    Points are (x, z) tuples already sorted in the scan direction.
    When the Z value drops close to the mesh floor the cutter is retracted
    and repositioned to skip the gap.
    """
    in_cut = False
    for i, (x, z) in enumerate(points):
        if not in_cut:
            # Approach: rapid to safe, rapid down, plunge to surface
            chain.append_rapid(x, y, safe_z)
            chain.append_rapid(x, y, z + 2.0)
            chain.append_feed(x, y, z, plunge)
            in_cut = True
        else:
            prev_x, prev_z = points[i - 1]
            if z < floor_z + _AIR_GAP_THRESHOLD:
                # Air gap detected — retract and reposition
                chain.append_rapid(prev_x, y, safe_z)
                in_cut = False
            else:
                chain.append_feed(x, y, z, feed)


# ── Utility ────────────────────────────────────────────────────────────

def _gen_positions(start: float, end: float, step: float) -> list[float]:
    """Generate evenly spaced positions from *start* to *end* inclusive."""
    if step <= 1e-9:
        return [start] if start <= end + 1e-6 else []
    positions: list[float] = []
    pos = start
    while pos <= end + 1e-6:
        positions.append(pos)
        pos += step
    return positions
