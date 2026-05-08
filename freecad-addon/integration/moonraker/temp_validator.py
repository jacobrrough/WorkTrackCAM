# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Jacob Rrough
#
# Pre-upload temperature ceiling validation for K2 Plus.
# Ported from WorkTrackCAM src/shared/gcode-temp-validator.ts

import re
from dataclasses import dataclass
from typing import List, Optional


@dataclass
class TempCeilings:
    max_nozzle_c: int = 350
    max_bed_c: int = 120
    max_chamber_c: int = 60


@dataclass
class TempViolation:
    line_number: int
    command: str
    requested_temp: int
    ceiling: int
    component: str


TEMP_PATTERNS = [
    (re.compile(r"M10[49]\s+S(\d+)"), "nozzle"),
    (re.compile(r"M1[49]0\s+S(\d+)"), "bed"),
    (re.compile(r"M141\s+S(\d+)"), "chamber"),
]


def validate_gcode_temps(
    gcode: str,
    ceilings: Optional[TempCeilings] = None,
    max_header_bytes: int = 131072,
) -> List[TempViolation]:
    """Scan G-code header for temperature commands exceeding machine ceilings."""
    if ceilings is None:
        ceilings = TempCeilings()

    ceiling_map = {
        "nozzle": ceilings.max_nozzle_c,
        "bed": ceilings.max_bed_c,
        "chamber": ceilings.max_chamber_c,
    }

    violations: List[TempViolation] = []
    header = gcode[:max_header_bytes]

    for line_num, line in enumerate(header.splitlines(), start=1):
        stripped = line.strip()
        if not stripped or stripped.startswith(";"):
            continue
        for pattern, component in TEMP_PATTERNS:
            match = pattern.search(stripped)
            if match:
                temp = int(match.group(1))
                ceiling = ceiling_map[component]
                if temp > ceiling:
                    violations.append(TempViolation(
                        line_number=line_num,
                        command=stripped,
                        requested_temp=temp,
                        ceiling=ceiling,
                        component=component,
                    ))
    return violations
