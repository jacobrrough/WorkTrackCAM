"""
Detailed machining report generator.

Produces a comprehensive summary of the toolpath including:
- Cycle time breakdown (cut, rapid, dwell)
- Material removal statistics
- Tool wear estimation
- Power consumption estimate
- Safety assessment summary
- Efficiency metrics and recommendations
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

from .models import ToolpathResult, ToolpathJob, Tool, CutParams, Material
from .optimizer import compute_engagement_angle, compute_scallop_height, OptimizedParams
from .simulator import SimulationReport


@dataclass
class MachiningReport:
    """Complete machining report with all metrics and recommendations."""
    # Timing
    estimated_cycle_time_s: float = 0.0
    cut_time_s: float = 0.0
    rapid_time_s: float = 0.0

    # Distances
    total_distance_mm: float = 0.0
    cut_distance_mm: float = 0.0
    rapid_distance_mm: float = 0.0
    air_cut_distance_mm: float = 0.0

    # Material removal
    material_removed_cm3: float = 0.0
    avg_mrr_cm3_min: float = 0.0
    peak_mrr_cm3_min: float = 0.0

    # Tool metrics
    tool_description: str = ""
    engagement_angle_deg: float = 0.0
    scallop_height_um: float = 0.0
    estimated_wear_index: float = 0.0

    # Power
    avg_power_kw: float = 0.0
    peak_power_kw: float = 0.0

    # Quality
    strategy_used: str = ""
    num_chains: int = 0
    num_segments: int = 0
    num_gcode_lines: int = 0

    # Safety
    is_safe: bool = True
    error_count: int = 0
    warning_count: int = 0
    safety_issues: list[str] = field(default_factory=list)

    # Efficiency
    cutting_efficiency: float = 0.0  # cut_time / total_time
    air_cut_fraction: float = 0.0
    recommendations: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        """Convert to JSON-serializable dict."""
        return {
            "timing": {
                "estimatedCycleTimeS": round(self.estimated_cycle_time_s, 1),
                "cutTimeS": round(self.cut_time_s, 1),
                "rapidTimeS": round(self.rapid_time_s, 1),
            },
            "distances": {
                "totalMm": round(self.total_distance_mm, 1),
                "cutMm": round(self.cut_distance_mm, 1),
                "rapidMm": round(self.rapid_distance_mm, 1),
                "airCutMm": round(self.air_cut_distance_mm, 1),
            },
            "materialRemoval": {
                "removedCm3": round(self.material_removed_cm3, 2),
                "avgMrrCm3Min": round(self.avg_mrr_cm3_min, 2),
            },
            "tool": {
                "description": self.tool_description,
                "engagementAngleDeg": round(self.engagement_angle_deg, 1),
                "scallopHeightUm": round(self.scallop_height_um, 1),
                "wearIndex": round(self.estimated_wear_index, 3),
            },
            "power": {
                "avgKw": round(self.avg_power_kw, 3),
            },
            "quality": {
                "strategy": self.strategy_used,
                "chains": self.num_chains,
                "segments": self.num_segments,
                "gcodeLines": self.num_gcode_lines,
            },
            "safety": {
                "isSafe": self.is_safe,
                "errors": self.error_count,
                "warnings": self.warning_count,
                "issues": self.safety_issues,
            },
            "efficiency": {
                "cuttingEfficiency": round(self.cutting_efficiency, 3),
                "airCutFraction": round(self.air_cut_fraction, 3),
                "recommendations": self.recommendations,
            },
        }


def generate_report(
    result: ToolpathResult,
    job: ToolpathJob,
    sim_report: SimulationReport | None = None,
    opt_params: OptimizedParams | None = None,
    num_gcode_lines: int = 0,
) -> MachiningReport:
    """Generate a comprehensive machining report from toolpath results."""
    report = MachiningReport()
    tool = job.tool
    cuts = job.cuts
    material = job.material

    # Basic metrics from toolpath result
    report.strategy_used = result.strategy
    report.num_chains = len(result.chains)
    report.num_segments = result.total_segments
    report.num_gcode_lines = num_gcode_lines

    report.total_distance_mm = result.total_distance_mm
    report.cut_distance_mm = result.cut_distance_mm
    report.rapid_distance_mm = result.rapid_distance_mm
    report.estimated_cycle_time_s = result.estimated_time_s

    # Timing breakdown
    rapid_speed = job.machine.max_rapid_mm_min
    report.rapid_time_s = (result.rapid_distance_mm / rapid_speed * 60) if rapid_speed > 0 else 0
    report.cut_time_s = report.estimated_cycle_time_s - report.rapid_time_s

    # Tool description
    report.tool_description = (
        f"{tool.shape.value} D{tool.diameter_mm:.1f}mm "
        f"{tool.flute_count}F L{tool.flute_length_mm:.1f}mm"
    )
    if tool.corner_radius_mm > 0:
        report.tool_description += f" CR{tool.corner_radius_mm:.2f}mm"

    # Engagement and scallop
    report.engagement_angle_deg = compute_engagement_angle(tool.radius, cuts.stepover_mm)
    report.scallop_height_um = compute_scallop_height(
        tool.radius, cuts.stepover_mm, tool.shape
    ) * 1000.0  # mm -> um

    # Efficiency metrics
    if report.estimated_cycle_time_s > 0:
        report.cutting_efficiency = report.cut_time_s / report.estimated_cycle_time_s

    # Simulation data
    if sim_report:
        report.is_safe = sim_report.is_safe
        report.error_count = sim_report.error_count
        report.warning_count = sim_report.warning_count
        report.air_cut_distance_mm = sim_report.air_cut_distance_mm
        report.material_removed_cm3 = sim_report.material_removed_cm3
        report.avg_mrr_cm3_min = sim_report.estimated_mrr_cm3_min
        report.avg_power_kw = sim_report.estimated_power_kw

        for issue in sim_report.issues:
            report.safety_issues.append(f"[{issue.severity}] {issue.message}")

        if result.cut_distance_mm > 0:
            report.air_cut_fraction = sim_report.air_cut_distance_mm / result.cut_distance_mm

    # Optimizer data
    if opt_params:
        report.estimated_wear_index = opt_params.tool_wear_index

    # Generate recommendations
    _generate_recommendations(report, job)

    return report


def _generate_recommendations(report: MachiningReport, job: ToolpathJob) -> None:
    """Generate actionable recommendations based on the report metrics."""
    if report.air_cut_fraction > 0.25:
        report.recommendations.append(
            "High air-cutting detected. Consider using rest machining or "
            "tighter stock bounds to reduce wasted motion."
        )

    if report.cutting_efficiency < 0.5 and report.rapid_distance_mm > report.cut_distance_mm:
        report.recommendations.append(
            "Low cutting efficiency — more time spent on rapids than cutting. "
            "Consider reordering operations or using a continuous strategy (spiral)."
        )

    if report.scallop_height_um > 50:
        report.recommendations.append(
            f"Scallop height ({report.scallop_height_um:.0f}um) may leave visible marks. "
            "Consider reducing stepover or switching to a ball-end mill."
        )

    if report.engagement_angle_deg > 120:
        report.recommendations.append(
            f"High engagement angle ({report.engagement_angle_deg:.0f}°). "
            "Consider reducing stepover for better tool life and surface finish."
        )

    if report.estimated_wear_index > 0.7:
        report.recommendations.append(
            "High tool wear predicted. Consider reducing cutting speed or "
            "using a more wear-resistant tool coating."
        )

    if not report.is_safe:
        report.recommendations.insert(0,
            "SAFETY: Toolpath has simulation errors that must be resolved "
            "before running on a machine."
        )
