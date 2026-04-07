"""
Feed/speed optimizer and dynamic adjustment.

Computes optimal cutting parameters based on:
- Tool geometry and material properties
- Radial and axial engagement
- Chip thinning compensation
- Tool deflection limits
- Machine power constraints
"""
from __future__ import annotations

import math
from dataclasses import dataclass

from .models import CutParams, Material, MachineKinematics, Tool, ToolShape


@dataclass
class OptimizedParams:
    """Result of feed/speed optimization."""
    feed_mm_min: float
    spindle_rpm: float
    doc_mm: float  # axial depth of cut
    woc_mm: float  # radial width of cut (stepover)
    chip_load_mm: float
    mrr_cm3_min: float  # material removal rate
    engagement_deg: float
    power_kw: float
    deflection_um: float
    warnings: list[str]


def optimize_params(
    tool: Tool,
    material: Material,
    machine: MachineKinematics,
    cuts: CutParams,
    engagement_deg: float = 90.0,
) -> OptimizedParams:
    """
    Compute optimized cutting parameters.

    Uses the HSM principle: high speed, controlled engagement, adjusted chip load.
    """
    warnings: list[str] = []

    # 1. Compute base RPM from surface speed
    sfm_target = (material.sfm_range[0] + material.sfm_range[1]) / 2.0
    smm = sfm_target * 0.3048  # SFM to m/min
    circumference_m = math.pi * tool.diameter_mm / 1000.0

    if circumference_m > 0:
        rpm = smm / circumference_m
    else:
        rpm = 10000.0

    # Clamp to machine limits
    rpm = min(rpm, machine.max_spindle_rpm)
    rpm = max(rpm, 1000.0)

    # 2. Compute chip load from material range
    chip_load = (material.chip_load_range[0] + material.chip_load_range[1]) / 2.0

    # 3. Apply chip thinning compensation
    # When radial engagement < 50%, actual chip thickness is reduced
    # Compensate by increasing feed to maintain effective chip load
    engagement_rad = math.radians(engagement_deg)
    if engagement_deg < 90:
        # Chip thinning factor: chip_load_adjusted = chip_load / sin(engagement/2)
        # But clamped to avoid extreme values at very low engagement
        thin_factor = math.sin(engagement_rad / 2)
        thin_factor = max(0.2, thin_factor)
        chip_load_adjusted = chip_load / thin_factor
    else:
        chip_load_adjusted = chip_load

    # 4. Compute feed rate
    feed = chip_load_adjusted * tool.flute_count * rpm
    feed = min(feed, machine.max_feed_mm_min)

    # 5. Compute depths
    woc = cuts.stepover_mm  # radial width of cut
    doc = cuts.z_step_mm    # axial depth of cut

    # Limit doc to flute length
    max_doc = tool.flute_length_mm * 0.8
    if tool.max_doc_mm > 0:
        max_doc = min(max_doc, tool.max_doc_mm)
    if doc > max_doc:
        doc = max_doc
        warnings.append(f"DOC clamped to {doc:.2f}mm (flute length limit)")

    # 6. Estimate material removal rate
    mrr = (woc * doc * feed) / 1000.0  # cm³/min

    # 7. Estimate cutting power (simplified)
    # P = MRR * specific cutting energy
    # Typical kc for aluminum: 700-900 N/mm², steel: 1500-3000 N/mm²
    kc = 800.0 * material.machinability_index  # N/mm² (specific cutting energy)
    power_w = mrr * 1000.0 * kc / 60.0  # simplified: W = MRR(mm³/s) * kc
    # More accurate: convert cm³/min to mm³/s
    mrr_mm3_s = mrr * 1000.0 / 60.0
    power_w = mrr_mm3_s * kc / 1000.0  # rough estimate
    power_kw = power_w / 1000.0

    # 8. Estimate tool deflection (simplified beam model)
    # δ = (F * L³) / (3 * E * I)
    # where F = tangential force, L = stick-out, E = carbide modulus, I = moment of inertia
    tangential_force = kc * doc * chip_load_adjusted  # N (simplified)
    stick_out = tool.flute_length_mm * 1.2  # mm
    e_carbide = 600000.0  # N/mm² (Young's modulus of carbide)
    moment_of_inertia = math.pi * (tool.diameter_mm / 2)**4 / 4  # mm⁴

    if moment_of_inertia > 0:
        deflection_mm = (tangential_force * stick_out**3) / (3 * e_carbide * moment_of_inertia)
        deflection_um = deflection_mm * 1000.0
    else:
        deflection_um = 0.0

    # Warn if deflection is excessive
    if deflection_um > 25.0:
        warnings.append(f"Tool deflection {deflection_um:.0f}μm exceeds 25μm limit; reduce DOC or stepover")

    return OptimizedParams(
        feed_mm_min=round(feed, 0),
        spindle_rpm=round(rpm, 0),
        doc_mm=round(doc, 3),
        woc_mm=round(woc, 3),
        chip_load_mm=round(chip_load_adjusted, 4),
        mrr_cm3_min=round(mrr, 2),
        engagement_deg=round(engagement_deg, 1),
        power_kw=round(power_kw, 3),
        deflection_um=round(deflection_um, 1),
        warnings=warnings,
    )


def adjust_feed_for_engagement(
    base_feed: float,
    actual_engagement_deg: float,
    target_engagement_deg: float = 90.0,
) -> float:
    """
    Dynamically adjust feed rate based on actual vs target engagement.

    When engagement drops (e.g., in corners where tool wraps around),
    the chip thins and feed should increase to maintain chip load.
    When engagement rises (plunging into a slot), feed should decrease
    for safety.
    """
    if actual_engagement_deg <= 0:
        return base_feed

    target_rad = math.radians(target_engagement_deg)
    actual_rad = math.radians(actual_engagement_deg)

    target_factor = math.sin(target_rad / 2)
    actual_factor = math.sin(actual_rad / 2)

    if actual_factor < 0.1:
        actual_factor = 0.1

    # Feed scales inversely with chip thinning
    adjusted = base_feed * (target_factor / actual_factor)

    # Clamp to reasonable range: 50% to 200% of base
    return max(base_feed * 0.5, min(adjusted, base_feed * 2.0))


def compute_engagement_angle(
    tool_radius: float,
    stepover: float,
) -> float:
    """
    Compute radial engagement angle from tool radius and stepover.

    θ = 2 * arccos(1 - stepover/radius)
    """
    if tool_radius <= 0 or stepover <= 0:
        return 0.0

    ratio = stepover / tool_radius
    if ratio >= 2.0:
        return 180.0  # full slotting

    cos_val = 1.0 - ratio
    cos_val = max(-1.0, min(1.0, cos_val))
    return math.degrees(2.0 * math.acos(cos_val))
