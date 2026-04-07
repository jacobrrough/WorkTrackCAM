"""
Continuous 4-axis simultaneous machining strategy.

Generates simultaneous 4-axis toolpaths for parts mounted on a rotary (A) axis,
with the tool always addressing the workpiece radially.  Both roughing and
finishing are handled in a single entry point.

Algorithm outline
-----------------
1. Build a cylindrical heightmap (axial position x rotation angle) by sampling
   ``cylindrical_drop_cutter_radius`` over the part.
2. Roughing: helical depth-level passes from stock OD inward.  Each level uses
   zigzag axial sweeps that advance angularly, with helical ramp entries.
3. Finishing: follow the compensated surface heightmap with a finer angular
   stepover and smooth axial sweeps.
4. Motion is emitted via ``chain.append_4axis()`` with cylindrical-to-Cartesian
   conversion governed by ``job.a_axis_orientation``.

Coordinate conventions
----------------------
- **Axial** — along the rotation axis (X for orientation "x", Z for "z").
- **Radial** — perpendicular distance from the rotation axis.
- **Angular** — rotation angle in degrees (0-360, A-axis output).

Edge-case handling
------------------
- Partial wrapping (< 360 deg) detected from the heightmap.
- Concave regions that dip below stock radius are clamped to avoid air-cutting.
- Stock overcut protection at part edges via a guard margin of one tool radius.
"""
from __future__ import annotations

import math
from typing import List, Tuple

from ..models import (
    ToolpathChain,
    ToolpathJob,
    ToolpathResult,
    ToolShape,
    compute_stats,
)
from ..geometry import Mesh, Heightfield, cylindrical_drop_cutter_radius
from ..logging_config import get_logger

_log = get_logger(__name__)

# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def generate_axis4_continuous(job: ToolpathJob, mesh: Mesh) -> ToolpathResult:
    """
    Generate a continuous 4-axis simultaneous toolpath for a rotary-mounted
    part, covering both roughing and finishing passes.

    Parameters
    ----------
    job : ToolpathJob
        Complete job specification (tool, stock cylinder, feeds, etc.).
    mesh : Mesh
        Triangle mesh of the target part.

    Returns
    -------
    ToolpathResult
        Toolpath chains with distance/time statistics populated.
    """
    result = ToolpathResult(strategy="4axis_continuous")

    # -- validate inputs ---------------------------------------------------
    errors = job.validate()
    if errors:
        result.warnings.extend(errors)
        return result

    if not job.machine.has_4th_axis:
        result.warnings.append(
            "Machine does not have a 4th axis; enable has4thAxis in machine "
            "config.  Returning empty toolpath."
        )
        return result

    stock_radius = job.cylinder_diameter_mm / 2.0
    if stock_radius <= 0:
        result.warnings.append(
            f"cylinder_diameter_mm={job.cylinder_diameter_mm} is not positive. "
            "Cannot generate 4-axis toolpath."
        )
        return result

    tool_r = job.tool.radius
    if tool_r <= 0:
        result.warnings.append("Tool radius must be > 0.")
        return result

    # -- derive grid parameters --------------------------------------------
    bounds = mesh.bounds
    axis = job.a_axis_orientation  # "x" or "z"

    axial_min, axial_max = _axial_range(bounds, axis, tool_r)
    axial_length = axial_max - axial_min
    if axial_length <= 0:
        result.warnings.append("Mesh has zero extent along the rotation axis.")
        return result

    stepover = max(job.cuts.stepover_mm, 0.05)
    angular_stepover_deg = _angular_stepover(stepover, stock_radius)

    n_axial = max(4, int(math.ceil(axial_length / (stepover * 0.5))) + 1)
    n_angular = max(8, int(math.ceil(360.0 / angular_stepover_deg)) + 1)
    # Clamp to sane limits
    n_axial = min(n_axial, 4000)
    n_angular = min(n_angular, 3600)

    axial_step = axial_length / max(1, n_axial - 1)
    angle_step = 360.0 / max(1, n_angular - 1)

    _log.debug(
        "axis4_continuous grid",
        n_axial=n_axial,
        n_angular=n_angular,
        axial_step=round(axial_step, 4),
        angle_step=round(angle_step, 4),
    )

    # -- build cylindrical heightmap ---------------------------------------
    heightmap = _build_cylindrical_heightmap(
        mesh, axial_min, axial_step, n_axial,
        angle_step, n_angular, tool_r, stock_radius, axis,
    )

    # Detect partial wrapping
    active_angles = _detect_active_angular_range(heightmap, n_axial, n_angular)
    if active_angles < n_angular * 0.5:
        result.warnings.append(
            f"Part does not wrap full 360 deg — only ~{active_angles * angle_step:.0f} deg "
            "of angular coverage detected."
        )

    # -- roughing passes ---------------------------------------------------
    z_step = max(job.cuts.z_step_mm, 0.05)
    min_radial = _heightmap_min(heightmap, n_axial, n_angular)
    # Ensure we don't rough deeper than the part surface
    min_radial = max(min_radial, 0.0)

    depth_levels = _compute_depth_levels(stock_radius, min_radial, z_step)

    safe_r = stock_radius + job.cuts.safe_z_mm
    feed = job.cuts.feed_mm_min
    plunge = job.cuts.plunge_mm_min
    ramp_angle = max(job.cuts.ramp_angle_deg, 0.5)

    _log.info(
        "axis4_continuous roughing",
        depth_levels=len(depth_levels),
        stock_radius=round(stock_radius, 3),
        min_radial=round(min_radial, 3),
    )

    for level_idx, radial_depth in enumerate(depth_levels):
        chains = _roughing_level(
            job, heightmap, axial_min, axial_step, n_axial,
            angle_step, n_angular, radial_depth, stock_radius,
            safe_r, feed, plunge, ramp_angle, tool_r, axis, level_idx,
        )
        result.chains.extend(chains)

    # -- finishing passes --------------------------------------------------
    finish_angle_step = angle_step * 0.5  # half the roughing angular stepover
    finish_n_angular = max(8, int(math.ceil(360.0 / finish_angle_step)) + 1)
    finish_n_angular = min(finish_n_angular, 7200)
    finish_angle_step = 360.0 / max(1, finish_n_angular - 1)

    # Build a finer heightmap for finishing if resolution doubled
    if finish_n_angular > n_angular:
        finish_heightmap = _build_cylindrical_heightmap(
            mesh, axial_min, axial_step, n_axial,
            finish_angle_step, finish_n_angular,
            tool_r, stock_radius, axis,
        )
    else:
        finish_heightmap = heightmap
        finish_n_angular = n_angular
        finish_angle_step = angle_step

    _log.info(
        "axis4_continuous finishing",
        finish_n_angular=finish_n_angular,
        finish_angle_step=round(finish_angle_step, 4),
    )

    finish_chains = _finishing_passes(
        job, finish_heightmap, axial_min, axial_step, n_axial,
        finish_angle_step, finish_n_angular, stock_radius,
        safe_r, feed, plunge, tool_r, axis,
    )
    result.chains.extend(finish_chains)

    # -- statistics --------------------------------------------------------
    compute_stats(result, safe_r, rapid_speed=job.machine.max_rapid_mm_min)

    _log.info(
        "axis4_continuous complete",
        chains=len(result.chains),
        segments=result.total_segments,
        estimated_time_s=round(result.estimated_time_s, 1),
    )

    return result


# ---------------------------------------------------------------------------
# Cylindrical heightmap construction
# ---------------------------------------------------------------------------

def _build_cylindrical_heightmap(
    mesh: Mesh,
    axial_min: float,
    axial_step: float,
    n_axial: int,
    angle_step: float,
    n_angular: int,
    tool_radius: float,
    stock_radius: float,
    axis: str,
) -> List[List[float]]:
    """
    Build a 2-D heightmap in cylindrical coordinates.

    ``heightmap[ia][ja]`` stores the radial distance from the rotation axis
    to the compensated tool-contact surface at axial index *ia* and angular
    index *ja*.  A value of 0.0 means the ray did not intersect the mesh
    (empty space — tool would pass through).

    Returns
    -------
    list[list[float]]
        Radial distance grid, shape ``(n_axial, n_angular)``.
    """
    mesh.ensure_bvh()

    heightmap: List[List[float]] = []
    for ia in range(n_axial):
        x_axial = axial_min + ia * axial_step
        row: List[float] = []
        for ja in range(n_angular):
            angle_deg = ja * angle_step
            r = cylindrical_drop_cutter_radius(
                mesh, x_axial, angle_deg, tool_radius, stock_radius, axis,
            )
            # Clamp: radial distance must be between 0 and stock_radius
            r = max(0.0, min(r, stock_radius))
            row.append(r)
        heightmap.append(row)

    return heightmap


def _detect_active_angular_range(
    heightmap: List[List[float]],
    n_axial: int,
    n_angular: int,
) -> int:
    """Count angular columns that have at least one non-zero radial hit."""
    active = 0
    for ja in range(n_angular):
        for ia in range(n_axial):
            if heightmap[ia][ja] > 1e-6:
                active += 1
                break
    return active


def _heightmap_min(
    heightmap: List[List[float]],
    n_axial: int,
    n_angular: int,
) -> float:
    """Return the minimum nonzero radial value across the entire heightmap."""
    best = float("inf")
    for ia in range(n_axial):
        for ja in range(n_angular):
            v = heightmap[ia][ja]
            if v > 1e-6:
                best = min(best, v)
    return best if best < float("inf") else 0.0


# ---------------------------------------------------------------------------
# Roughing
# ---------------------------------------------------------------------------

def _compute_depth_levels(
    stock_radius: float,
    min_radial: float,
    z_step: float,
) -> List[float]:
    """
    Build a list of radial depth levels from the stock OD inward.

    Each level is a radial distance from the rotation axis at which the tool
    tip runs.  We start just inside the stock surface and step inward toward
    the part surface.

    Returns
    -------
    list[float]
        Radial values, descending from stock surface toward part.
    """
    levels: List[float] = []
    current = stock_radius - z_step
    while current > min_radial + 1e-6:
        levels.append(current)
        current -= z_step
    # Always include a final pass at the part surface (leave no material)
    levels.append(min_radial)
    return levels


def _roughing_level(
    job: ToolpathJob,
    heightmap: List[List[float]],
    axial_min: float,
    axial_step: float,
    n_axial: int,
    angle_step: float,
    n_angular: int,
    radial_depth: float,
    stock_radius: float,
    safe_r: float,
    feed: float,
    plunge: float,
    ramp_angle: float,
    tool_r: float,
    axis: str,
    level_idx: int,
) -> List[ToolpathChain]:
    """
    Generate all roughing chains at one radial depth level.

    Uses zigzag axial sweeps that advance around the part angularly, with a
    helical ramp entry at the start of each depth level.
    """
    chains: List[ToolpathChain] = []
    ramp_done = False
    flip = False

    for ja in range(n_angular):
        angle_deg = ja * angle_step

        # Determine if this angular column has material to cut
        has_material = False
        for ia in range(n_axial):
            surface_r = heightmap[ia][ja]
            if surface_r > 1e-6 and radial_depth < stock_radius - 1e-6:
                has_material = True
                break
        if not has_material:
            continue

        chain = ToolpathChain(
            comment=f"rough L{level_idx} a={angle_deg:.1f} r={radial_depth:.3f}"
        )

        # Helical ramp entry at the start of each depth level
        if not ramp_done:
            _helical_ramp_entry(
                chain, axial_min, angle_deg, radial_depth,
                stock_radius, safe_r, ramp_angle, plunge, axis,
            )
            ramp_done = True
        else:
            # Rapid to start of this angular position at cutting depth
            x_start = axial_min if not flip else axial_min + (n_axial - 1) * axial_step
            cx, cy, cz = _cylindrical_to_cartesian(
                x_start, safe_r, angle_deg, axis,
            )
            chain.append_4axis(cx, cy, cz, angle_deg, feed=0.0)
            cx, cy, cz = _cylindrical_to_cartesian(
                x_start, radial_depth, angle_deg, axis,
            )
            chain.append_4axis(cx, cy, cz, angle_deg, feed=plunge)

        # Zigzag axial sweep
        axial_indices = range(n_axial) if not flip else range(n_axial - 1, -1, -1)
        for ia in axial_indices:
            x_axial = axial_min + ia * axial_step
            surface_r = heightmap[ia][ja]

            # Clamp cutting depth: never cut below the part surface
            cut_r = radial_depth
            if surface_r > 1e-6:
                cut_r = max(radial_depth, surface_r)
            else:
                # No mesh here — skip (air cut protection)
                cut_r = max(radial_depth, stock_radius - 0.01)

            cx, cy, cz = _cylindrical_to_cartesian(
                x_axial, cut_r, angle_deg, axis,
            )
            chain.append_4axis(cx, cy, cz, angle_deg, feed=feed)

        # Retract at end of sweep
        last_axial = axial_min + ((n_axial - 1) * axial_step if not flip else 0)
        cx, cy, cz = _cylindrical_to_cartesian(
            last_axial, safe_r, angle_deg, axis,
        )
        chain.append_4axis(cx, cy, cz, angle_deg, feed=0.0)

        if chain.segments:
            chains.append(chain)

        flip = not flip

    return chains


def _helical_ramp_entry(
    chain: ToolpathChain,
    axial_pos: float,
    start_angle_deg: float,
    target_radial: float,
    stock_radius: float,
    safe_r: float,
    ramp_angle_deg: float,
    plunge_feed: float,
    axis: str,
) -> None:
    """
    Emit a helical ramp entry from safe retract down to the target radial
    depth, spiralling over a partial rotation to spread the plunge.

    The ramp descends in the radial direction while advancing angularly,
    producing a smooth entry that avoids plunging straight into material.
    """
    # Rapid to safe position above the start angle
    cx, cy, cz = _cylindrical_to_cartesian(
        axial_pos, safe_r, start_angle_deg, axis,
    )
    chain.append_4axis(cx, cy, cz, start_angle_deg, feed=0.0)

    # Rapid down to stock surface
    cx, cy, cz = _cylindrical_to_cartesian(
        axial_pos, stock_radius, start_angle_deg, axis,
    )
    chain.append_4axis(cx, cy, cz, start_angle_deg, feed=0.0)

    # Helical ramp: spread the radial descent over angular travel
    radial_drop = stock_radius - target_radial
    if radial_drop < 1e-6:
        return

    ramp_rad = math.radians(max(ramp_angle_deg, 0.5))
    # Angular extent needed for helical ramp (at the stock surface circumference)
    circumference_at_stock = 2.0 * math.pi * stock_radius
    ramp_arc_length = radial_drop / math.tan(ramp_rad)
    ramp_angle_extent = (ramp_arc_length / max(circumference_at_stock, 0.01)) * 360.0
    ramp_angle_extent = max(ramp_angle_extent, 30.0)  # at least 30 degrees
    ramp_angle_extent = min(ramp_angle_extent, 720.0)  # at most two full turns

    n_ramp_steps = max(8, int(ramp_angle_extent / 5.0))
    d_angle = ramp_angle_extent / n_ramp_steps
    d_radial = radial_drop / n_ramp_steps

    for step in range(1, n_ramp_steps + 1):
        a = start_angle_deg + step * d_angle
        r = stock_radius - step * d_radial
        # Wrap angle for output
        a_out = a % 360.0
        cx, cy, cz = _cylindrical_to_cartesian(axial_pos, r, a, axis)
        chain.append_4axis(cx, cy, cz, a_out, feed=plunge_feed)


# ---------------------------------------------------------------------------
# Finishing
# ---------------------------------------------------------------------------

def _finishing_passes(
    job: ToolpathJob,
    heightmap: List[List[float]],
    axial_min: float,
    axial_step: float,
    n_axial: int,
    angle_step: float,
    n_angular: int,
    stock_radius: float,
    safe_r: float,
    feed: float,
    plunge: float,
    tool_r: float,
    axis: str,
) -> List[ToolpathChain]:
    """
    Generate finishing passes that follow the compensated surface heightmap.

    Each angular position produces one axial sweep at the surface radial
    distance.  The angular stepover is half the roughing stepover for a
    finer finish.  Smooth transitions between angular positions are achieved
    by maintaining the tool in-cut where possible.
    """
    chains: List[ToolpathChain] = []
    flip = False
    floor_r = 1e-6  # minimum meaningful radial distance

    prev_angle_deg: float | None = None

    for ja in range(n_angular):
        angle_deg = ja * angle_step

        # Scan this column for any surface presence
        has_surface = any(
            heightmap[ia][ja] > floor_r for ia in range(n_axial)
        )
        if not has_surface:
            prev_angle_deg = None
            continue

        chain = ToolpathChain(
            comment=f"finish a={angle_deg:.1f}"
        )

        axial_indices = range(n_axial) if not flip else range(n_axial - 1, -1, -1)
        axial_list = list(axial_indices)

        # Smooth transition: if the previous angular pass ended in-cut,
        # link from that position rather than doing a full retract.
        first_ia = axial_list[0]
        first_axial = axial_min + first_ia * axial_step
        first_r = heightmap[first_ia][ja]
        if first_r < floor_r:
            first_r = stock_radius  # above surface — no contact

        if prev_angle_deg is not None:
            # Arc transition at current radial depth from previous angle
            transition_r = min(first_r + tool_r * 0.5, safe_r)
            cx, cy, cz = _cylindrical_to_cartesian(
                first_axial, transition_r, angle_deg, axis,
            )
            chain.append_4axis(cx, cy, cz, angle_deg, feed=feed * 0.5)
        else:
            # Full retract approach
            cx, cy, cz = _cylindrical_to_cartesian(
                first_axial, safe_r, angle_deg, axis,
            )
            chain.append_4axis(cx, cy, cz, angle_deg, feed=0.0)

        # Plunge to surface at first axial position
        cx, cy, cz = _cylindrical_to_cartesian(
            first_axial, first_r, angle_deg, axis,
        )
        chain.append_4axis(cx, cy, cz, angle_deg, feed=plunge)

        # Sweep axially along the surface
        in_cut = True
        for ia in axial_list:
            x_axial = axial_min + ia * axial_step
            surface_r = heightmap[ia][ja]

            if surface_r < floor_r:
                # No surface — retract and skip
                if in_cut:
                    prev_ia = axial_list[max(0, axial_list.index(ia) - 1)]
                    prev_axial = axial_min + prev_ia * axial_step
                    cx, cy, cz = _cylindrical_to_cartesian(
                        prev_axial, safe_r, angle_deg, axis,
                    )
                    chain.append_4axis(cx, cy, cz, angle_deg, feed=0.0)
                    in_cut = False
                continue

            if not in_cut:
                # Re-engage: rapid to above, plunge to surface
                cx, cy, cz = _cylindrical_to_cartesian(
                    x_axial, safe_r, angle_deg, axis,
                )
                chain.append_4axis(cx, cy, cz, angle_deg, feed=0.0)
                cx, cy, cz = _cylindrical_to_cartesian(
                    x_axial, surface_r + tool_r * 0.2, angle_deg, axis,
                )
                chain.append_4axis(cx, cy, cz, angle_deg, feed=plunge)
                in_cut = True

            cx, cy, cz = _cylindrical_to_cartesian(
                x_axial, surface_r, angle_deg, axis,
            )
            chain.append_4axis(cx, cy, cz, angle_deg, feed=feed)

        # Final retract
        last_ia = axial_list[-1]
        last_axial = axial_min + last_ia * axial_step
        cx, cy, cz = _cylindrical_to_cartesian(
            last_axial, safe_r, angle_deg, axis,
        )
        chain.append_4axis(cx, cy, cz, angle_deg, feed=0.0)

        if chain.segments:
            chains.append(chain)
            prev_angle_deg = angle_deg
        else:
            prev_angle_deg = None

        flip = not flip

    return chains


# ---------------------------------------------------------------------------
# Coordinate conversion
# ---------------------------------------------------------------------------

def _cylindrical_to_cartesian(
    axial: float,
    radial: float,
    angle_deg: float,
    axis: str,
) -> Tuple[float, float, float]:
    """
    Convert cylindrical (axial, radial, angle) to Cartesian (x, y, z).

    For ``axis="x"`` (rotation around X):
        X = axial position
        Y = radial * cos(angle)
        Z = radial * sin(angle)

    For ``axis="z"`` (rotation around Z):
        X = radial * cos(angle)
        Y = radial * sin(angle)
        Z = axial position
    """
    angle_rad = math.radians(angle_deg)
    cos_a = math.cos(angle_rad)
    sin_a = math.sin(angle_rad)

    if axis == "x":
        return (axial, radial * cos_a, radial * sin_a)
    else:
        return (radial * cos_a, radial * sin_a, axial)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _axial_range(
    bounds,
    axis: str,
    tool_r: float,
) -> Tuple[float, float]:
    """
    Determine the axial extent of the part plus a guard margin of one tool
    radius on each end to prevent stock overcut at edges.
    """
    if axis == "x":
        return (bounds.min_pt.x - tool_r, bounds.max_pt.x + tool_r)
    else:
        return (bounds.min_pt.z - tool_r, bounds.max_pt.z + tool_r)


def _angular_stepover(
    linear_stepover: float,
    stock_radius: float,
) -> float:
    """
    Convert a linear stepover (mm) to an angular stepover (degrees) at the
    stock surface.  Clamped to [0.5, 45] degrees.
    """
    circumference = 2.0 * math.pi * stock_radius
    if circumference < 1e-6:
        return 10.0
    deg = (linear_stepover / circumference) * 360.0
    return max(0.5, min(deg, 45.0))
