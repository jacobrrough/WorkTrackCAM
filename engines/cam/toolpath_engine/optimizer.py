"""
Multi-objective feed/speed optimizer.

Computes optimal cutting parameters based on:
- Tool geometry and material properties
- Radial/axial engagement with chip-thinning compensation
- Tool deflection limits (beam model)
- Machine power constraints
- Multi-objective scoring: minimize time + wear + power

Uses scipy.optimize when available; falls back to analytical approach.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from .models import CutParams, Material, MachineKinematics, Tool, ToolShape

try:
    from scipy.optimize import minimize as scipy_minimize
    HAS_SCIPY = True
except ImportError:
    HAS_SCIPY = False


@dataclass
class OptimizedParams:
    """Result of feed/speed optimization."""
    feed_mm_min: float
    spindle_rpm: float
    doc_mm: float
    woc_mm: float
    chip_load_mm: float
    mrr_cm3_min: float
    engagement_deg: float
    power_kw: float
    deflection_um: float
    tool_wear_index: float  # relative wear rate (0-1)
    efficiency_score: float  # composite optimization score
    warnings: list[str] = field(default_factory=list)


def optimize_params(
    tool: Tool,
    material: Material,
    machine: MachineKinematics,
    cuts: CutParams,
    engagement_deg: float = 90.0,
) -> OptimizedParams:
    """
    Compute optimized cutting parameters.

    Uses HSM principles: high speed, controlled engagement, adjusted chip load.
    When scipy is available, runs multi-objective optimization.
    """
    warnings: list[str] = []

    # 1. RPM from surface speed
    sfm_target = (material.sfm_range[0] + material.sfm_range[1]) / 2.0
    smm = sfm_target * 0.3048  # SFM to m/min
    circumference_m = math.pi * tool.diameter_mm / 1000.0

    rpm = smm / circumference_m if circumference_m > 0 else 10000.0
    rpm = max(machine.min_spindle_rpm, min(rpm, machine.max_spindle_rpm))

    # 2. Chip load from material range
    chip_load = (material.chip_load_range[0] + material.chip_load_range[1]) / 2.0

    # 3. Chip thinning compensation
    engagement_rad = math.radians(engagement_deg)
    if engagement_deg < 90:
        thin_factor = max(0.2, math.sin(engagement_rad / 2))
        chip_load_adj = chip_load / thin_factor
    else:
        chip_load_adj = chip_load

    # 4. Feed rate
    feed = chip_load_adj * tool.flute_count * rpm
    feed = min(feed, machine.max_feed_mm_min)

    # 5. Depths
    woc = cuts.stepover_mm
    doc = cuts.z_step_mm
    max_doc = tool.flute_length_mm * 0.8
    if tool.max_doc_mm > 0:
        max_doc = min(max_doc, tool.max_doc_mm)
    if doc > max_doc:
        doc = max_doc
        warnings.append(f"DOC clamped to {doc:.2f}mm (flute length limit)")

    # 6. MRR
    mrr = (woc * doc * feed) / 1000.0  # cm^3/min

    # 7. Power estimate
    kc = material.specific_cutting_energy
    mrr_mm3_s = mrr * 1000.0 / 60.0
    power_kw = mrr_mm3_s * kc / 1e6

    # Check machine power limit
    if power_kw > machine.max_power_kw:
        # Scale back feed to stay within power
        scale = machine.max_power_kw / power_kw
        feed *= scale
        mrr *= scale
        power_kw = machine.max_power_kw
        warnings.append(f"Feed reduced to {feed:.0f} mm/min (power limit)")

    # 8. Tool deflection (cantilever beam model)
    tangential_force = kc * doc * chip_load_adj
    stick_out = tool.flute_length_mm * 1.2
    e_carbide = 600000.0  # N/mm^2
    moment = math.pi * (tool.diameter_mm / 2) ** 4 / 4

    deflection_um = 0.0
    if moment > 0:
        deflection_mm = (tangential_force * stick_out ** 3) / (3 * e_carbide * moment)
        deflection_um = deflection_mm * 1000.0

    if deflection_um > 25.0:
        warnings.append(f"Tool deflection {deflection_um:.0f}um exceeds 25um limit")

    # 9. Tool wear index (simplified Taylor's equation)
    # V*T^n = C; higher speed = more wear
    cutting_speed_m_min = smm
    v_ref = (material.sfm_range[0] * 0.3048 + material.sfm_range[1] * 0.3048) / 2
    wear_index = min(1.0, (cutting_speed_m_min / max(v_ref, 1.0)) ** 2)

    # 10. Multi-objective optimization (try scipy first, then GA, then analytical)
    if HAS_SCIPY:
        optimized = _scipy_optimize_params(
            tool, material, machine, cuts, engagement_deg,
            rpm, chip_load, feed, doc, woc, mrr, power_kw,
            deflection_um, wear_index, warnings,
        )
        if optimized is not None:
            return optimized

    # Try numpy-based genetic algorithm
    ga_result = _genetic_optimize_params(
        tool, material, machine, cuts, engagement_deg,
        rpm, feed, doc, woc, warnings,
    )
    if ga_result is not None:
        return ga_result

    # Fallback: analytical efficiency score (weighted multi-objective)
    mrr_score = min(1.0, mrr / 10.0) if mrr > 0 else 0
    wear_score = 1.0 - wear_index
    power_score = 1.0 - min(1.0, power_kw / max(machine.max_power_kw, 0.1))
    defl_score = 1.0 - min(1.0, deflection_um / 50.0)

    efficiency = 0.4 * mrr_score + 0.3 * wear_score + 0.2 * power_score + 0.1 * defl_score

    return OptimizedParams(
        feed_mm_min=round(feed, 0),
        spindle_rpm=round(rpm, 0),
        doc_mm=round(doc, 3),
        woc_mm=round(woc, 3),
        chip_load_mm=round(chip_load_adj, 4),
        mrr_cm3_min=round(mrr, 2),
        engagement_deg=round(engagement_deg, 1),
        power_kw=round(power_kw, 3),
        deflection_um=round(deflection_um, 1),
        tool_wear_index=round(wear_index, 3),
        efficiency_score=round(efficiency, 3),
        warnings=warnings,
    )


def _scipy_optimize_params(
    tool: Tool,
    material: Material,
    machine: MachineKinematics,
    cuts: CutParams,
    engagement_deg: float,
    base_rpm: float,
    base_chip_load: float,
    base_feed: float,
    base_doc: float,
    base_woc: float,
    base_mrr: float,
    base_power: float,
    base_deflection: float,
    base_wear: float,
    warnings: list[str],
) -> OptimizedParams | None:
    """
    Scipy-based multi-objective optimization.

    Optimizes feed rate and DOC simultaneously to maximize a weighted
    objective of MRR, tool life, power usage, and surface quality.
    Uses Nelder-Mead simplex (derivative-free, robust for noisy objectives).
    """
    import numpy as np

    kc = material.specific_cutting_energy
    max_doc = tool.flute_length_mm * 0.8
    if tool.max_doc_mm > 0:
        max_doc = min(max_doc, tool.max_doc_mm)

    e_carbide = 600000.0
    moment = math.pi * (tool.diameter_mm / 2) ** 4 / 4
    stick_out = tool.flute_length_mm * 1.2

    # Bounds: [feed_fraction, doc_fraction] in [0.3, 1.5] range
    # relative to the analytically computed base values
    def objective(x):
        feed_frac, doc_frac = x
        feed = base_feed * feed_frac
        doc = min(base_doc * doc_frac, max_doc)

        # Recompute derived quantities
        chip_load_adj = feed / (tool.flute_count * max(base_rpm, 1.0))
        mrr = (base_woc * doc * feed) / 1000.0
        mrr_mm3_s = mrr * 1000.0 / 60.0
        power_kw = mrr_mm3_s * kc / 1e6

        # Deflection
        tangential_force = kc * doc * chip_load_adj
        deflection_mm = (tangential_force * stick_out ** 3) / (3 * e_carbide * moment) if moment > 0 else 0
        deflection_um = deflection_mm * 1000.0

        # Penalties
        power_penalty = max(0, power_kw - machine.max_power_kw) * 10.0
        defl_penalty = max(0, deflection_um - 25.0) * 0.5
        feed_penalty = max(0, feed - machine.max_feed_mm_min) * 0.01

        # Wear (simplified Taylor)
        smm = base_rpm * math.pi * tool.diameter_mm / 1000.0
        v_ref = sum(material.sfm_range) / 2 * 0.3048
        wear = min(1.0, (smm / max(v_ref, 1.0)) ** 2)

        # Objective: minimize (negative MRR + penalties)
        # Higher MRR is better, lower wear/power/deflection is better
        score = -(0.4 * min(mrr, 20.0) / 20.0
                  - 0.25 * wear
                  - 0.2 * min(power_kw, machine.max_power_kw) / max(machine.max_power_kw, 0.1)
                  - 0.15 * min(deflection_um, 50.0) / 50.0)

        return score + power_penalty + defl_penalty + feed_penalty

    try:
        result = scipy_minimize(
            objective,
            x0=[1.0, 1.0],
            method="Nelder-Mead",
            bounds=[(0.3, 1.5), (0.3, 1.5)],
            options={"maxiter": 100, "xatol": 0.01, "fatol": 0.001},
        )

        if result.success or result.fun < objective([1.0, 1.0]):
            feed_frac, doc_frac = result.x
            opt_feed = base_feed * feed_frac
            opt_doc = min(base_doc * doc_frac, max_doc)
            opt_feed = min(opt_feed, machine.max_feed_mm_min)

            chip_load_adj = opt_feed / (tool.flute_count * max(base_rpm, 1.0))
            mrr = (base_woc * opt_doc * opt_feed) / 1000.0
            mrr_mm3_s = mrr * 1000.0 / 60.0
            power_kw = mrr_mm3_s * kc / 1e6

            if power_kw > machine.max_power_kw:
                scale = machine.max_power_kw / power_kw
                opt_feed *= scale
                mrr *= scale
                power_kw = machine.max_power_kw

            tangential_force = kc * opt_doc * chip_load_adj
            deflection_mm = (tangential_force * stick_out ** 3) / (3 * e_carbide * moment) if moment > 0 else 0
            deflection_um = deflection_mm * 1000.0

            smm = base_rpm * math.pi * tool.diameter_mm / 1000.0
            v_ref = sum(material.sfm_range) / 2 * 0.3048
            wear_index = min(1.0, (smm / max(v_ref, 1.0)) ** 2)

            # Compute analytical efficiency score (same formula as fallback)
            mrr_score = min(1.0, mrr / 10.0) if mrr > 0 else 0
            wear_score = 1.0 - wear_index
            power_score_val = 1.0 - min(1.0, power_kw / max(machine.max_power_kw, 0.1))
            defl_score_val = 1.0 - min(1.0, deflection_um / 50.0)
            efficiency = 0.4 * mrr_score + 0.3 * wear_score + 0.2 * power_score_val + 0.1 * defl_score_val

            if deflection_um > 25.0:
                warnings.append(f"Tool deflection {deflection_um:.0f}um exceeds 25um limit")
            if base_doc * doc_frac > max_doc:
                warnings.append(f"DOC clamped to {opt_doc:.2f}mm (flute length limit)")

            return OptimizedParams(
                feed_mm_min=round(opt_feed, 0),
                spindle_rpm=round(base_rpm, 0),
                doc_mm=round(opt_doc, 3),
                woc_mm=round(base_woc, 3),
                chip_load_mm=round(chip_load_adj, 4),
                mrr_cm3_min=round(mrr, 2),
                engagement_deg=round(engagement_deg, 1),
                power_kw=round(power_kw, 3),
                deflection_um=round(deflection_um, 1),
                tool_wear_index=round(wear_index, 3),
                efficiency_score=round(efficiency, 3),
                warnings=warnings,
            )
    except Exception:
        pass  # Fall through to analytical approach

    return None


def adjust_feed_for_engagement(
    base_feed: float,
    actual_engagement_deg: float,
    target_engagement_deg: float = 90.0,
) -> float:
    """Dynamically adjust feed based on actual vs target engagement."""
    if actual_engagement_deg <= 0:
        return base_feed

    target_rad = math.radians(target_engagement_deg)
    actual_rad = math.radians(actual_engagement_deg)

    target_factor = math.sin(target_rad / 2)
    actual_factor = max(0.1, math.sin(actual_rad / 2))

    adjusted = base_feed * (target_factor / actual_factor)
    return max(base_feed * 0.5, min(adjusted, base_feed * 2.0))


def compute_engagement_angle(tool_radius: float, stepover: float) -> float:
    """Compute radial engagement angle from tool radius and stepover."""
    if tool_radius <= 0 or stepover <= 0:
        return 0.0
    ratio = stepover / tool_radius
    if ratio >= 2.0:
        return 180.0
    cos_val = max(-1.0, min(1.0, 1.0 - ratio))
    return math.degrees(2.0 * math.acos(cos_val))


def compute_scallop_height(tool_radius: float, stepover: float, tool_shape: ToolShape) -> float:
    """Compute theoretical scallop height for a given tool and stepover."""
    if tool_shape == ToolShape.FLAT:
        return 0.0  # flat tools leave no scallop in XY plane
    r = tool_radius
    if stepover >= 2 * r:
        return r
    return r - math.sqrt(r * r - (stepover / 2) ** 2)


# ── Per-pass adaptive feed rate ──────────────────────────────────────────


def estimate_local_engagement(
    prev_z: float,
    curr_z: float,
    tool_radius: float,
    stepover: float,
    z_step: float,
) -> float:
    """Estimate the local engagement angle for a segment.

    When the tool moves to a deeper Z (more material), engagement increases.
    When moving to shallower Z (less material), engagement decreases.

    The estimation combines:
    1. Radial engagement from stepover (constant per pass)
    2. Z-change factor: descending moves encounter more material

    Returns engagement in degrees (0-180).
    """
    if tool_radius <= 0 or stepover <= 0:
        return 0.0

    # Base radial engagement from stepover
    base_engagement = compute_engagement_angle(tool_radius, stepover)

    # Z-change modulation: when cutting deeper, engagement increases
    dz = prev_z - curr_z  # positive = descending (more material)
    if z_step <= 0:
        z_step = 1.0  # prevent division by zero

    # Normalized depth change: how much of a z_step is this descent?
    z_factor = max(0.0, min(1.0, dz / z_step))

    # When descending, add axial engagement component (up to 30 deg extra)
    axial_contribution = z_factor * 30.0

    return min(180.0, base_engagement + axial_contribution)


def compute_adaptive_feed(
    base_feed: float,
    prev_z: float,
    curr_z: float,
    tool_radius: float,
    stepover: float,
    z_step: float,
    target_engagement_deg: float = 90.0,
    min_feed_factor: float = 0.5,
    max_feed_factor: float = 1.5,
) -> float:
    """Compute feed rate adjusted for local material engagement.

    Uses the local engagement estimate to scale feed:
    - High engagement (heavy cut) -> reduce feed for tool protection
    - Low engagement (light/finishing) -> allow higher feed for productivity

    Parameters
    ----------
    base_feed : float
        Nominal feed rate in mm/min.
    prev_z, curr_z : float
        Z positions of previous and current segments.
    tool_radius : float
        Tool radius in mm.
    stepover : float
        Radial stepover in mm.
    z_step : float
        Axial depth of cut per Z-level in mm.
    target_engagement_deg : float
        The engagement angle at which base_feed is optimal (default 90).
    min_feed_factor : float
        Minimum feed as fraction of base_feed (default 0.5).
    max_feed_factor : float
        Maximum feed as fraction of base_feed (default 1.5).

    Returns
    -------
    float
        Adjusted feed rate in mm/min, clamped to [min, max] factor range.
    """
    if base_feed <= 0:
        return base_feed

    local_engagement = estimate_local_engagement(
        prev_z, curr_z, tool_radius, stepover, z_step,
    )

    if local_engagement <= 0:
        return base_feed * max_feed_factor

    adjusted = adjust_feed_for_engagement(
        base_feed, local_engagement, target_engagement_deg,
    )

    return max(base_feed * min_feed_factor, min(adjusted, base_feed * max_feed_factor))


def apply_adaptive_feed_to_result(
    result: "ToolpathResult",
    tool_radius: float,
    stepover: float,
    z_step: float,
    base_feed: float,
    target_engagement_deg: float = 90.0,
) -> None:
    """Apply per-segment adaptive feed rate to all chains in a ToolpathResult.

    Modifies segment feed rates in-place based on local engagement estimation.
    Only adjusts non-rapid feed moves.

    This is called after strategy generation when adaptive feed is enabled.
    """
    from .models import ToolpathResult  # local to avoid circular import at module level

    for chain in result.chains:
        prev_z = 0.0
        for i, seg in enumerate(chain.segments):
            if seg.is_rapid:
                prev_z = seg.z
                continue

            # Compute adaptive feed for this segment
            seg.feed = compute_adaptive_feed(
                base_feed=base_feed,
                prev_z=prev_z,
                curr_z=seg.z,
                tool_radius=tool_radius,
                stepover=stepover,
                z_step=z_step,
                target_engagement_deg=target_engagement_deg,
            )
            prev_z = seg.z


# ── Genetic Algorithm Optimizer (numpy-based, no DEAP dependency) ──────

def _genetic_optimize_params(
    tool: Tool,
    material: Material,
    machine: MachineKinematics,
    cuts: CutParams,
    engagement_deg: float,
    base_rpm: float,
    base_feed: float,
    base_doc: float,
    base_woc: float,
    warnings: list[str],
    population_size: int = 40,
    generations: int = 30,
) -> OptimizedParams | None:
    """
    Multi-objective genetic algorithm optimizer using numpy.

    Evolves a population of (feed_fraction, doc_fraction, rpm_fraction) vectors
    to maximize a weighted objective of MRR, tool life, surface quality, and power.

    Uses tournament selection, SBX crossover, and polynomial mutation.
    """
    try:
        import numpy as np
    except ImportError:
        return None

    kc = material.specific_cutting_energy
    max_doc = tool.flute_length_mm * 0.8
    if tool.max_doc_mm > 0:
        max_doc = min(max_doc, tool.max_doc_mm)
    e_carbide = 600000.0
    moment = math.pi * (tool.diameter_mm / 2) ** 4 / 4
    stick_out = tool.flute_length_mm * 1.2

    # Gene bounds: [feed_frac, doc_frac, rpm_frac] each in [0.3, 1.5]
    lo = np.array([0.3, 0.3, 0.7])
    hi = np.array([1.5, 1.5, 1.3])

    def evaluate(pop: np.ndarray) -> np.ndarray:
        """Evaluate fitness for entire population at once. Lower is better."""
        feed_frac = pop[:, 0]
        doc_frac = pop[:, 1]
        rpm_frac = pop[:, 2]

        feeds = base_feed * feed_frac
        docs = np.minimum(base_doc * doc_frac, max_doc)
        rpms = np.clip(base_rpm * rpm_frac, machine.min_spindle_rpm, machine.max_spindle_rpm)
        feeds = np.minimum(feeds, machine.max_feed_mm_min)

        chip_loads = feeds / (tool.flute_count * np.maximum(rpms, 1.0))
        mrrs = (base_woc * docs * feeds) / 1000.0  # cm³/min
        mrr_mm3_s = mrrs * 1000.0 / 60.0
        powers = mrr_mm3_s * kc / 1e6

        # Deflection
        tang_forces = kc * docs * chip_loads
        deflections_mm = np.where(
            moment > 0,
            (tang_forces * stick_out ** 3) / (3 * e_carbide * moment),
            0.0,
        )
        deflections_um = deflections_mm * 1000.0

        # Wear (Taylor's equation simplified)
        smm = rpms * math.pi * tool.diameter_mm / 1000.0
        v_ref = sum(material.sfm_range) / 2 * 0.3048
        wear = np.clip((smm / max(v_ref, 1.0)) ** 2, 0.0, 1.0)

        # Penalties (hard constraints)
        power_penalty = np.maximum(0, powers - machine.max_power_kw) * 20.0
        defl_penalty = np.maximum(0, deflections_um - 25.0) * 1.0
        feed_penalty = np.maximum(0, feeds - machine.max_feed_mm_min) * 0.05

        # Multi-objective: minimize negative composite score + penalties
        mrr_norm = np.clip(mrrs / 20.0, 0, 1)
        wear_norm = wear
        power_norm = np.clip(powers / max(machine.max_power_kw, 0.1), 0, 1)
        defl_norm = np.clip(deflections_um / 50.0, 0, 1)

        # Weighted objective (lower = better for minimization)
        fitness = -(0.40 * mrr_norm
                    - 0.25 * wear_norm
                    - 0.20 * power_norm
                    - 0.15 * defl_norm)
        fitness += power_penalty + defl_penalty + feed_penalty
        return fitness

    # Initialize population
    rng = np.random.default_rng(42)
    pop = rng.uniform(lo, hi, size=(population_size, 3))
    pop[0] = [1.0, 1.0, 1.0]  # always include baseline

    best_idx = 0
    best_fitness = float("inf")

    for _gen in range(generations):
        fitness = evaluate(pop)

        gen_best = int(np.argmin(fitness))
        if fitness[gen_best] < best_fitness:
            best_fitness = float(fitness[gen_best])
            best_idx = gen_best

        # Tournament selection (size 3)
        new_pop = np.empty_like(pop)
        new_pop[0] = pop[int(np.argmin(fitness))]  # elitism: keep best

        for i in range(1, population_size):
            candidates = rng.integers(0, population_size, size=3)
            winner = candidates[int(np.argmin(fitness[candidates]))]
            new_pop[i] = pop[winner]

        # SBX crossover
        for i in range(1, population_size - 1, 2):
            if rng.random() < 0.8:
                eta = 2.0
                u = rng.random(3)
                beta = np.where(
                    u <= 0.5,
                    (2.0 * u) ** (1.0 / (eta + 1.0)),
                    (1.0 / (2.0 * (1.0 - u))) ** (1.0 / (eta + 1.0)),
                )
                p1, p2 = new_pop[i].copy(), new_pop[i + 1].copy()
                new_pop[i] = np.clip(0.5 * ((1 + beta) * p1 + (1 - beta) * p2), lo, hi)
                new_pop[i + 1] = np.clip(0.5 * ((1 - beta) * p1 + (1 + beta) * p2), lo, hi)

        # Polynomial mutation
        for i in range(1, population_size):
            if rng.random() < 0.2:
                j = rng.integers(0, 3)
                eta_m = 20.0
                u = rng.random()
                if u < 0.5:
                    delta = (2.0 * u) ** (1.0 / (eta_m + 1.0)) - 1.0
                else:
                    delta = 1.0 - (2.0 * (1.0 - u)) ** (1.0 / (eta_m + 1.0))
                new_pop[i, j] = np.clip(new_pop[i, j] + delta * (hi[j] - lo[j]) * 0.1, lo[j], hi[j])

        pop = new_pop

    # Extract best solution
    fitness = evaluate(pop)
    best_idx = int(np.argmin(fitness))
    best = pop[best_idx]

    # Decode
    opt_feed = min(base_feed * best[0], machine.max_feed_mm_min)
    opt_doc = min(base_doc * best[1], max_doc)
    opt_rpm = max(machine.min_spindle_rpm, min(base_rpm * best[2], machine.max_spindle_rpm))

    chip_load_adj = opt_feed / (tool.flute_count * max(opt_rpm, 1.0))
    mrr = (base_woc * opt_doc * opt_feed) / 1000.0
    mrr_mm3_s = mrr * 1000.0 / 60.0
    power_kw = mrr_mm3_s * kc / 1e6

    if power_kw > machine.max_power_kw:
        scale = machine.max_power_kw / power_kw
        opt_feed *= scale
        mrr *= scale
        power_kw = machine.max_power_kw

    tangential_force = kc * opt_doc * chip_load_adj
    deflection_mm = (tangential_force * stick_out ** 3) / (3 * e_carbide * moment) if moment > 0 else 0
    deflection_um = deflection_mm * 1000.0

    smm = opt_rpm * math.pi * tool.diameter_mm / 1000.0
    v_ref = sum(material.sfm_range) / 2 * 0.3048
    wear_index = min(1.0, (smm / max(v_ref, 1.0)) ** 2)

    mrr_score = min(1.0, mrr / 10.0) if mrr > 0 else 0
    wear_score = 1.0 - wear_index
    power_score_val = 1.0 - min(1.0, power_kw / max(machine.max_power_kw, 0.1))
    defl_score_val = 1.0 - min(1.0, deflection_um / 50.0)
    efficiency = 0.4 * mrr_score + 0.3 * wear_score + 0.2 * power_score_val + 0.1 * defl_score_val

    if deflection_um > 25.0:
        warnings.append(f"Tool deflection {deflection_um:.0f}um exceeds 25um limit")
    if base_doc * best[1] > max_doc:
        warnings.append(f"DOC clamped to {opt_doc:.2f}mm (flute length limit)")

    return OptimizedParams(
        feed_mm_min=round(opt_feed, 0),
        spindle_rpm=round(opt_rpm, 0),
        doc_mm=round(opt_doc, 3),
        woc_mm=round(base_woc, 3),
        chip_load_mm=round(chip_load_adj, 4),
        mrr_cm3_min=round(mrr, 2),
        engagement_deg=round(engagement_deg, 1),
        power_kw=round(power_kw, 3),
        deflection_um=round(deflection_um, 1),
        tool_wear_index=round(wear_index, 3),
        efficiency_score=round(efficiency, 3),
        warnings=warnings,
    )
