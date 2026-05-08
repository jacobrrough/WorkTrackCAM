# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Jacob Rrough
#
# Validation pipeline — wraps post-processing with safety checks.
# Runs after G-code generation but before file write / Moonraker upload.

from dataclasses import dataclass, field
from typing import List, Optional

from integration.safety.gcode_guardrails import SafetyReport, validate_gcode
from integration.moonraker.temp_validator import (
    TempCeilings,
    TempViolation,
    validate_gcode_temps,
)


@dataclass
class MachineDialect:
    name: str
    dialect: str
    safe_z_mm: float
    end_code: str
    temp_ceilings: Optional[TempCeilings] = None


MACHINE_DIALECTS = {
    "Laguna_Swift_5x10": MachineDialect(
        name="Laguna Swift 5×10",
        dialect="mach3",
        safe_z_mm=25.0,
        end_code="M30",
    ),
    "Makera_Carvera_3axis": MachineDialect(
        name="Makera Carvera (3-axis)",
        dialect="grbl",
        safe_z_mm=50.0,
        end_code="M2",
    ),
    "Makera_Carvera_4axis": MachineDialect(
        name="Makera Carvera (4-axis)",
        dialect="grbl",
        safe_z_mm=46.0,
        end_code="M2",
    ),
    "Creality_K2_Plus": MachineDialect(
        name="Creality K2 Plus",
        dialect="generic",
        safe_z_mm=0.0,
        end_code="",
        temp_ceilings=TempCeilings(max_nozzle_c=350, max_bed_c=120, max_chamber_c=60),
    ),
}


@dataclass
class ValidationResult:
    machine_id: str
    safety_report: SafetyReport
    temp_violations: List[TempViolation] = field(default_factory=list)
    passed: bool = True

    @property
    def all_violations(self) -> List[str]:
        msgs = [v.message for v in self.safety_report.violations]
        msgs += [
            f"Temperature violation on line {v.line_number}: "
            f"{v.component} at {v.requested_temp}°C exceeds {v.ceiling}°C ceiling"
            for v in self.temp_violations
        ]
        return msgs


def validate_post_output(gcode: str, machine_id: str) -> ValidationResult:
    """Run all safety and temperature checks for a given machine's G-code output."""
    dialect_info = MACHINE_DIALECTS.get(machine_id)
    if dialect_info is None:
        report = SafetyReport()
        report.add("config", 0, f"Unknown machine ID: {machine_id}")
        return ValidationResult(machine_id=machine_id, safety_report=report, passed=False)

    safety = validate_gcode(gcode, dialect_info.dialect, dialect_info.safe_z_mm)

    temp_violations: List[TempViolation] = []
    if dialect_info.temp_ceilings is not None:
        temp_violations = validate_gcode_temps(gcode, dialect_info.temp_ceilings)

    passed = safety.passed and len(temp_violations) == 0

    return ValidationResult(
        machine_id=machine_id,
        safety_report=safety,
        temp_violations=temp_violations,
        passed=passed,
    )
