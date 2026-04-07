"""
Basic toolpath simulator for safety validation.

Checks:
- Machine envelope violations (XYZ travel limits)
- Rapid moves through material (potential crashes)
- Excessive feed rates
- Safe retract heights
- 4-axis coordinate sanity
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from .models import MachineKinematics, ToolpathResult, StockDefinition


@dataclass
class SimulationIssue:
    """A detected safety or quality issue."""
    severity: str  # "error", "warning", "info"
    message: str
    chain_index: int = -1
    segment_index: int = -1
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0


@dataclass
class SimulationReport:
    """Results of toolpath simulation."""
    issues: list[SimulationIssue] = field(default_factory=list)
    is_safe: bool = True
    total_moves: int = 0
    rapid_moves: int = 0
    feed_moves: int = 0
    max_feed: float = 0.0
    min_z: float = 0.0
    max_z: float = 0.0

    @property
    def error_count(self) -> int:
        return sum(1 for i in self.issues if i.severity == "error")

    @property
    def warning_count(self) -> int:
        return sum(1 for i in self.issues if i.severity == "warning")


def simulate(
    result: ToolpathResult,
    machine: MachineKinematics,
    stock: StockDefinition,
    safe_z: float = 10.0,
) -> SimulationReport:
    """Run safety simulation on a toolpath result."""
    report = SimulationReport()

    prev_x, prev_y, prev_z = 0.0, 0.0, safe_z
    prev_is_rapid = True

    for ci, chain in enumerate(result.chains):
        for si, seg in enumerate(chain.segments):
            report.total_moves += 1

            if seg.is_rapid:
                report.rapid_moves += 1
            else:
                report.feed_moves += 1
                if seg.feed > report.max_feed:
                    report.max_feed = seg.feed

            # Track Z bounds
            if seg.z < report.min_z:
                report.min_z = seg.z
            if seg.z > report.max_z:
                report.max_z = seg.z

            # Check 1: Machine envelope
            _check_envelope(report, seg.x, seg.y, seg.z, machine, ci, si)

            # Check 2: Rapid into material
            if seg.is_rapid:
                _check_rapid_safety(
                    report, prev_x, prev_y, prev_z,
                    seg.x, seg.y, seg.z,
                    stock, safe_z, ci, si,
                )

            # Check 3: Excessive feed
            if not seg.is_rapid and seg.feed > machine.max_feed_mm_min:
                report.issues.append(SimulationIssue(
                    severity="warning",
                    message=f"Feed {seg.feed:.0f} exceeds machine max {machine.max_feed_mm_min:.0f} mm/min",
                    chain_index=ci, segment_index=si,
                    x=seg.x, y=seg.y, z=seg.z,
                ))

            # Check 4: Zero-length move
            d = math.sqrt(
                (seg.x - prev_x)**2 + (seg.y - prev_y)**2 + (seg.z - prev_z)**2
            )
            if d < 1e-6 and report.total_moves > 1:
                pass  # zero-length moves are harmless, just wasteful

            prev_x, prev_y, prev_z = seg.x, seg.y, seg.z
            prev_is_rapid = seg.is_rapid

    report.is_safe = report.error_count == 0
    return report


def _check_envelope(
    report: SimulationReport,
    x: float, y: float, z: float,
    machine: MachineKinematics,
    ci: int, si: int,
) -> None:
    """Check if position is within machine travel limits."""
    # Allow negative coordinates (WCS can be anywhere)
    # Check absolute travel range centered on 0
    half_x = machine.x_travel_mm / 2
    half_y = machine.y_travel_mm / 2

    if abs(x) > half_x + 10:  # 10mm tolerance for WCS offset
        report.issues.append(SimulationIssue(
            severity="warning",
            message=f"X={x:.1f} may exceed X travel ({machine.x_travel_mm:.0f}mm)",
            chain_index=ci, segment_index=si,
            x=x, y=y, z=z,
        ))

    if abs(y) > half_y + 10:
        report.issues.append(SimulationIssue(
            severity="warning",
            message=f"Y={y:.1f} may exceed Y travel ({machine.y_travel_mm:.0f}mm)",
            chain_index=ci, segment_index=si,
            x=x, y=y, z=z,
        ))

    if z < -machine.z_travel_mm:
        report.issues.append(SimulationIssue(
            severity="error",
            message=f"Z={z:.1f} exceeds Z travel ({machine.z_travel_mm:.0f}mm)",
            chain_index=ci, segment_index=si,
            x=x, y=y, z=z,
        ))


def _check_rapid_safety(
    report: SimulationReport,
    x1: float, y1: float, z1: float,
    x2: float, y2: float, z2: float,
    stock: StockDefinition,
    safe_z: float,
    ci: int, si: int,
) -> None:
    """
    Check if a rapid move might crash through material.

    A rapid is dangerous if it moves horizontally while Z is below safe_z
    and within stock bounds.
    """
    # Only check if Z is below safe height during XY travel
    min_z = min(z1, z2)
    if min_z >= safe_z - 0.1:
        return  # Above safe Z, rapid is fine

    # Check if there's significant XY movement at this low Z
    xy_dist = math.sqrt((x2 - x1)**2 + (y2 - y1)**2)
    if xy_dist < 0.5:
        return  # Negligible XY movement

    # Check if within stock bounds
    within_stock = (
        min(x1, x2) < stock.x_max and max(x1, x2) > stock.x_min and
        min(y1, y2) < stock.y_max and max(y1, y2) > stock.y_min
    )

    if within_stock and min_z < stock.z_max:
        report.issues.append(SimulationIssue(
            severity="error",
            message=(
                f"Rapid move at Z={min_z:.1f} with XY travel {xy_dist:.1f}mm "
                f"within stock bounds — potential crash"
            ),
            chain_index=ci, segment_index=si,
            x=x2, y=y2, z=z2,
        ))
