"""
Drill strategy — generates canned drill cycle toolpaths (G81/G82/G83/G73).

Supports:
- G81: Simple drill cycle (rapid to R, feed to Z, rapid out)
- G82: Drill with dwell at hole bottom
- G83: Full-retract peck drilling with configurable peck depth
- G73: High-speed peck drilling with partial retract
- Expanded: Plain G0/G1 sequences (no canned cycle codes)

Drill points are provided as (x, y) pairs; depth comes from the job's
z_step_mm (hole depth below stock top) or stock.z_min.
"""
from __future__ import annotations

import math

from ..models import (
    DrillCycleMode,
    ToolpathChain,
    ToolpathJob,
    ToolpathResult,
    compute_stats,
)


def generate_drill(job: ToolpathJob, mesh) -> ToolpathResult:
    """Generate a drill toolpath from job.drill_points.

    Each drill point becomes one chain.  The chain structure depends on
    ``job.drill_cycle_mode``:

    - **EXPANDED**: explicit rapid-to-position, feed-plunge, rapid-retract
      (no canned cycle metadata).
    - **G81/G82/G83/G73**: a single "drill move" chain per hole.  The
      postprocessor inspects ``chain.comment`` for the cycle tag and emits
      the appropriate canned-cycle block.

    For peck drilling (G83/G73), the peck depth is taken from
    ``job.peck_depth_mm``.  If it is zero or negative, the strategy falls
    back to G81 with a warning.
    """
    result = ToolpathResult(strategy="drill")

    if not job.drill_points:
        result.warnings.append("No drill points provided")
        return result

    safe_z = job.cuts.safe_z_mm
    plunge_feed = job.cuts.plunge_mm_min
    mode = job.drill_cycle_mode
    peck = job.peck_depth_mm
    dwell = job.dwell_ms
    retract_z = job.retract_z_mm if job.retract_z_mm != 0.0 else safe_z

    # Hole depth: use z_step_mm as the depth below stock top (negative convention)
    # or fall back to stock.z_min
    hole_bottom_z = job.stock.z_min
    if job.cuts.z_step_mm > 0:
        hole_bottom_z = job.stock.z_max - job.cuts.z_step_mm

    # Validate peck for G83/G73
    if mode in (DrillCycleMode.G83, DrillCycleMode.G73) and peck <= 0:
        result.warnings.append(
            f"Drill cycle {mode.value.upper()} requires peckDepthMm > 0; "
            f"falling back to G81"
        )
        mode = DrillCycleMode.G81

    # Validate dwell for G82
    if mode == DrillCycleMode.G82 and dwell <= 0:
        result.warnings.append(
            "Drill cycle G82 requires dwellMs > 0; falling back to G81"
        )
        mode = DrillCycleMode.G81

    for i, (x, y) in enumerate(job.drill_points):
        chain = ToolpathChain(
            comment=f"drill hole {i + 1} ({mode.value}) X{x:.3f} Y{y:.3f}"
        )

        if mode == DrillCycleMode.EXPANDED:
            _expanded_drill(chain, x, y, hole_bottom_z, safe_z, plunge_feed)
        elif mode == DrillCycleMode.G83:
            _peck_drill_g83(
                chain, x, y, hole_bottom_z, retract_z, safe_z,
                peck, plunge_feed,
            )
        elif mode == DrillCycleMode.G73:
            _peck_drill_g73(
                chain, x, y, hole_bottom_z, retract_z, safe_z,
                peck, plunge_feed,
            )
        elif mode == DrillCycleMode.G82:
            _dwell_drill_g82(
                chain, x, y, hole_bottom_z, retract_z, safe_z,
                dwell, plunge_feed,
            )
        else:
            # G81 simple drill
            _simple_drill_g81(
                chain, x, y, hole_bottom_z, retract_z, safe_z, plunge_feed,
            )

        if chain.segments:
            result.chains.append(chain)

    # Store cycle metadata for the postprocessor
    result._drill_cycle_mode = mode  # type: ignore[attr-defined]
    result._drill_retract_z = retract_z  # type: ignore[attr-defined]
    result._drill_peck_mm = peck  # type: ignore[attr-defined]
    result._drill_dwell_ms = dwell  # type: ignore[attr-defined]
    result._drill_hole_z = hole_bottom_z  # type: ignore[attr-defined]

    compute_stats(result, safe_z)
    return result


# ── Cycle implementations ────────────────────────────────────────────────


def _expanded_drill(
    chain: ToolpathChain,
    x: float, y: float,
    z_bottom: float,
    safe_z: float,
    plunge_feed: float,
) -> None:
    """Expanded G0/G1 drill — no canned cycle."""
    chain.append_rapid(x, y, safe_z)
    chain.append_feed(x, y, z_bottom, plunge_feed)
    chain.append_rapid(x, y, safe_z)


def _simple_drill_g81(
    chain: ToolpathChain,
    x: float, y: float,
    z_bottom: float,
    retract_z: float,
    safe_z: float,
    plunge_feed: float,
) -> None:
    """G81 simple drill cycle: rapid to R, feed to Z, rapid to R.

    The motion segments model the physical tool motion.  The postprocessor
    will detect drill chains and emit the compact G81 block instead.
    """
    chain.append_rapid(x, y, safe_z)
    chain.append_rapid(x, y, retract_z)
    chain.append_feed(x, y, z_bottom, plunge_feed)
    chain.append_rapid(x, y, retract_z)


def _dwell_drill_g82(
    chain: ToolpathChain,
    x: float, y: float,
    z_bottom: float,
    retract_z: float,
    safe_z: float,
    dwell_ms: float,
    plunge_feed: float,
) -> None:
    """G82 drill with dwell: same as G81 but with dwell at bottom.

    Dwell is encoded in the chain comment for postprocessor use.
    """
    chain.comment += f" dwell={dwell_ms:.0f}ms"
    chain.append_rapid(x, y, safe_z)
    chain.append_rapid(x, y, retract_z)
    chain.append_feed(x, y, z_bottom, plunge_feed)
    chain.append_rapid(x, y, retract_z)


def _peck_drill_g83(
    chain: ToolpathChain,
    x: float, y: float,
    z_bottom: float,
    retract_z: float,
    safe_z: float,
    peck_depth: float,
    plunge_feed: float,
) -> None:
    """G83 peck drill: incremental pecks with full retract to R between pecks.

    Standard G83 behaviour:
    1. Rapid to X, Y position
    2. Rapid to R plane
    3. Feed down by peck depth Q
    4. Rapid retract to R plane (chip clear)
    5. Rapid back to previous depth minus clearance
    6. Feed next peck
    7. Repeat until Z depth reached
    8. Rapid to R plane
    """
    chain.append_rapid(x, y, safe_z)
    chain.append_rapid(x, y, retract_z)

    current_z = retract_z
    while current_z > z_bottom + 1e-6:
        next_z = max(current_z - peck_depth, z_bottom)
        chain.append_feed(x, y, next_z, plunge_feed)
        if next_z > z_bottom + 1e-6:
            # Retract to R for chip clearing
            chain.append_rapid(x, y, retract_z)
            # Rapid back to just above previous depth (clearance = 1mm)
            chain.append_rapid(x, y, next_z + 1.0)
        current_z = next_z

    chain.append_rapid(x, y, retract_z)


def _peck_drill_g73(
    chain: ToolpathChain,
    x: float, y: float,
    z_bottom: float,
    retract_z: float,
    safe_z: float,
    peck_depth: float,
    plunge_feed: float,
) -> None:
    """G73 high-speed peck: incremental pecks with partial retract.

    Like G83 but retracts only a small amount (typ. 1mm) between pecks
    rather than all the way to R.  Faster cycle time, relies on coolant
    for chip evacuation.
    """
    partial_retract = 1.0  # mm retract between pecks

    chain.append_rapid(x, y, safe_z)
    chain.append_rapid(x, y, retract_z)

    current_z = retract_z
    while current_z > z_bottom + 1e-6:
        next_z = max(current_z - peck_depth, z_bottom)
        chain.append_feed(x, y, next_z, plunge_feed)
        if next_z > z_bottom + 1e-6:
            # Partial retract for chip breaking
            chain.append_rapid(x, y, next_z + partial_retract)
        current_z = next_z

    chain.append_rapid(x, y, retract_z)
