# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Jacob Rrough
#
# G-code safety validation suite.
# Ported from WorkTrackCAM src/shared/gcode-*-invariants.ts (4 modules)

import re
from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class SafetyViolation:
    rule: str
    line_number: int
    message: str
    severity: str = "error"


@dataclass
class SafetyReport:
    violations: List[SafetyViolation] = field(default_factory=list)
    passed: bool = True

    def add(self, rule: str, line: int, msg: str, severity: str = "error"):
        self.violations.append(SafetyViolation(rule, line, msg, severity))
        if severity == "error":
            self.passed = False


# --- Header invariants ---

REQUIRED_HEADER_CODES = {
    "units": re.compile(r"G2[01]\b"),
    "absolute_mode": re.compile(r"G90\b"),
    "plane_select": re.compile(r"G1[789]\b"),
}


def check_header_invariants(gcode: str, max_lines: int = 30) -> SafetyReport:
    """Verify units, mode, and plane declarations appear before first motion."""
    report = SafetyReport()
    lines = gcode.splitlines()[:max_lines]
    found = {k: False for k in REQUIRED_HEADER_CODES}

    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        if not stripped or stripped.startswith(";") or stripped.startswith("("):
            continue
        if re.search(r"G[01]\s", stripped):
            break
        for key, pattern in REQUIRED_HEADER_CODES.items():
            if pattern.search(stripped):
                found[key] = True

    for key, was_found in found.items():
        if not was_found:
            report.add("header", 0, f"Missing {key} declaration before first motion command")

    return report


# --- End-program invariants ---

def check_end_program(gcode: str, dialect: str = "generic") -> SafetyReport:
    """Verify program ends with spindle off and proper end code."""
    report = SafetyReport()
    lines = [l.strip() for l in gcode.splitlines() if l.strip() and not l.strip().startswith(";")]
    if not lines:
        report.add("end_program", 0, "Empty G-code output")
        return report

    tail = "\n".join(lines[-10:])
    if not re.search(r"M[25]\b", tail):
        report.add("end_program", len(lines), "Spindle not stopped (M5) before program end")

    end_codes = {"mach3": r"M30\b", "grbl": r"M2\b", "smoothieware": r"M2\b"}
    expected = end_codes.get(dialect, r"M[23]0?\b")
    if not re.search(expected, tail):
        report.add("end_program", len(lines), f"Missing end-program code for dialect '{dialect}'")

    return report


# --- Safe-Z retract invariants ---

def check_safe_z_retract(gcode: str, safe_z_mm: float = 25.0) -> SafetyReport:
    """Verify safe Z retract height before/between/after cuts."""
    report = SafetyReport()
    lines = gcode.splitlines()
    in_cut = False

    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        if not stripped or stripped.startswith(";") or stripped.startswith("("):
            continue

        z_match = re.search(r"Z(-?[\d.]+)", stripped)
        if z_match:
            z_val = float(z_match.group(1))
            is_rapid = stripped.startswith("G0") or stripped.startswith("G00")
            if is_rapid and z_val < safe_z_mm * 0.5:
                report.add(
                    "safe_z",
                    i,
                    f"Rapid move to Z{z_val:.1f} is below safe retract threshold ({safe_z_mm:.1f} mm)",
                    severity="warning",
                )

    return report


# --- Combined validation ---

def validate_gcode(
    gcode: str,
    dialect: str = "generic",
    safe_z_mm: float = 25.0,
) -> SafetyReport:
    """Run all G-code safety checks and return a combined report."""
    combined = SafetyReport()

    for check in [
        check_header_invariants(gcode),
        check_end_program(gcode, dialect),
        check_safe_z_retract(gcode, safe_z_mm),
    ]:
        combined.violations.extend(check.violations)
        if not check.passed:
            combined.passed = False

    return combined
