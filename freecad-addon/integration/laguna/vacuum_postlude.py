# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Jacob Rrough
#
# Vacuum zone postlude generator for Laguna Swift 5x10.
# Generates M64/M65 digital output commands to control the 6-zone vacuum table.
#
# Zone mapping (RichAuto A-series digital outputs):
#   Zone 0 (col 0, row 0) -> Digital output 0 -> M64 P0 / M65 P0
#   Zone 1 (col 1, row 0) -> Digital output 1 -> M64 P1 / M65 P1
#   Zone 2 (col 0, row 1) -> Digital output 2 -> M64 P2 / M65 P2
#   Zone 3 (col 1, row 1) -> Digital output 3 -> M64 P3 / M65 P3
#   Zone 4 (col 0, row 2) -> Digital output 4 -> M64 P4 / M65 P4
#   Zone 5 (col 1, row 2) -> Digital output 5 -> M64 P5 / M65 P5

from typing import List


def generate_vacuum_on(zone_indices: List[int]) -> str:
    """Generate G-code to turn ON specified vacuum zones (M64 = output ON)."""
    if not zone_indices:
        return "; No vacuum zones engaged"
    lines = ["; Vacuum zones ON"]
    for idx in sorted(zone_indices):
        if 0 <= idx <= 5:
            lines.append(f"M64 P{idx}")
    return "\n".join(lines)


def generate_vacuum_off(zone_indices: List[int]) -> str:
    """Generate G-code to turn OFF specified vacuum zones (M65 = output OFF)."""
    if not zone_indices:
        return "; No vacuum zones to release"
    lines = ["; Vacuum zones OFF"]
    for idx in sorted(zone_indices):
        if 0 <= idx <= 5:
            lines.append(f"M65 P{idx}")
    return "\n".join(lines)


def generate_vacuum_all_off() -> str:
    """Generate G-code to turn OFF all 6 vacuum zones."""
    return generate_vacuum_off([0, 1, 2, 3, 4, 5])


def wrap_gcode_with_vacuum(
    gcode: str,
    zone_indices: List[int],
    dwell_after_on_s: float = 2.0,
) -> str:
    """Wrap a complete G-code program with vacuum zone ON/OFF commands.

    Inserts vacuum-on commands after the preamble (after the first M3/spindle start),
    and vacuum-off commands before the postamble (before M5/spindle stop).
    """
    if not zone_indices:
        return gcode

    lines = gcode.splitlines()
    vacuum_on = generate_vacuum_on(zone_indices)
    if dwell_after_on_s > 0:
        vacuum_on += f"\nG4 P{dwell_after_on_s}"
    vacuum_off = generate_vacuum_off(zone_indices)

    spindle_start_idx = None
    spindle_stop_idx = None

    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("M3 ") or stripped == "M3":
            spindle_start_idx = i
        if stripped.startswith("M5") or stripped == "M5":
            if spindle_stop_idx is None or i > spindle_start_idx:
                spindle_stop_idx = i

    result = []
    for i, line in enumerate(lines):
        result.append(line)
        if i == spindle_start_idx:
            result.append(vacuum_on)

    if spindle_stop_idx is not None:
        final = []
        inserted = False
        for i, line in enumerate(result):
            stripped = line.strip()
            if not inserted and (stripped.startswith("M5") or stripped == "M5"):
                final.append(vacuum_off)
                inserted = True
            final.append(line)
        result = final
    else:
        result.append(vacuum_off)

    return "\n".join(result)
