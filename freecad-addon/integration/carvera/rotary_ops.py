# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Jacob Rrough
#
# 4-axis rotary operation strategies for Makera Carvera.
# Ported from WorkTrackCAM src/main/cam-axis4/
#
# Six rotary strategies:
# 1. roughing    — indexed A-axis rotation with XZ profiling passes
# 2. finishing   — continuous A-axis with XZ surface contouring
# 3. contour     — continuous A-axis wrapping 2D contours around cylinder
# 4. indexed     — discrete A-axis positions with 3-axis operations at each
# 5. pattern     — repeating a 2D pattern around the cylinder circumference
# 6. continuous  — fully simultaneous 4-axis with inverse-time feed (G93)

import math
from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional, Tuple


class RotaryStrategy(Enum):
    ROUGHING = "roughing"
    FINISHING = "finishing"
    CONTOUR = "contour"
    INDEXED = "indexed"
    PATTERN = "pattern"
    CONTINUOUS = "continuous"


@dataclass
class RotaryJobSetup:
    stock_diameter_mm: float
    stock_length_mm: float
    stock_center_offset_x_mm: float = 0.0
    safe_z_mm: float = 46.0
    spindle_rpm: int = 10000
    strategy: RotaryStrategy = RotaryStrategy.ROUGHING
    stepover_mm: float = 1.0
    stepdown_mm: float = 1.0
    feed_rate_mm_min: float = 300.0
    plunge_rate_mm_min: float = 100.0
    a_start_deg: float = 0.0
    a_end_deg: float = 360.0
    a_step_deg: float = 15.0
    pattern_repeat_count: int = 4
    use_inverse_time: bool = False


@dataclass
class RotaryPass:
    """A single machining pass in a rotary operation."""
    a_angle_deg: float
    x_start_mm: float
    x_end_mm: float
    z_depth_mm: float
    feed_rate: float
    is_rapid: bool = False


@dataclass
class RotaryOperation:
    strategy: RotaryStrategy
    passes: List[RotaryPass]
    preamble: str = ""
    postamble: str = ""


def _stock_radius(setup: RotaryJobSetup) -> float:
    return setup.stock_diameter_mm / 2.0


def generate_indexed_positions(
    a_start: float,
    a_end: float,
    a_step: float,
) -> List[float]:
    """Generate the discrete A-axis positions for indexed operations."""
    positions = []
    a = a_start
    while a <= a_end + 0.001:
        positions.append(round(a, 3))
        a += a_step
    return positions


def plan_roughing(setup: RotaryJobSetup, final_depth_mm: float) -> RotaryOperation:
    """Plan a roughing strategy — indexed rotations with XZ profiling."""
    positions = generate_indexed_positions(
        setup.a_start_deg, setup.a_end_deg, setup.a_step_deg
    )
    passes = []
    radius = _stock_radius(setup)

    for a_pos in positions:
        depth = setup.stepdown_mm
        current_z = -depth
        while current_z >= -final_depth_mm:
            passes.append(RotaryPass(
                a_angle_deg=a_pos,
                x_start_mm=setup.stock_center_offset_x_mm,
                x_end_mm=setup.stock_center_offset_x_mm + setup.stock_length_mm,
                z_depth_mm=current_z,
                feed_rate=setup.feed_rate_mm_min,
            ))
            current_z -= depth

    return RotaryOperation(
        strategy=RotaryStrategy.ROUGHING,
        passes=passes,
        preamble=_rotary_preamble(setup),
        postamble=_rotary_postamble(setup),
    )


def plan_finishing(setup: RotaryJobSetup, final_depth_mm: float) -> RotaryOperation:
    """Plan a finishing strategy — continuous A with fine XZ contouring."""
    passes = []
    a_range = setup.a_end_deg - setup.a_start_deg
    circ_mm = math.pi * setup.stock_diameter_mm
    steps_around = max(1, int(circ_mm / setup.stepover_mm))
    a_increment = a_range / steps_around

    for i in range(steps_around):
        a = setup.a_start_deg + i * a_increment
        passes.append(RotaryPass(
            a_angle_deg=round(a, 3),
            x_start_mm=setup.stock_center_offset_x_mm,
            x_end_mm=setup.stock_center_offset_x_mm + setup.stock_length_mm,
            z_depth_mm=-final_depth_mm,
            feed_rate=setup.feed_rate_mm_min,
        ))

    return RotaryOperation(
        strategy=RotaryStrategy.FINISHING,
        passes=passes,
        preamble=_rotary_preamble(setup),
        postamble=_rotary_postamble(setup),
    )


def plan_contour(setup: RotaryJobSetup, depth_mm: float) -> RotaryOperation:
    """Plan a contour strategy — wraps a 2D profile around the cylinder."""
    passes = []
    circ_mm = math.pi * setup.stock_diameter_mm
    a_per_mm = 360.0 / circ_mm

    num_steps = max(1, int(circ_mm / setup.stepover_mm))
    for i in range(num_steps):
        arc_pos = i * setup.stepover_mm
        a = setup.a_start_deg + arc_pos * a_per_mm

        passes.append(RotaryPass(
            a_angle_deg=round(a % 360, 3),
            x_start_mm=setup.stock_center_offset_x_mm,
            x_end_mm=setup.stock_center_offset_x_mm + setup.stock_length_mm,
            z_depth_mm=-depth_mm,
            feed_rate=setup.feed_rate_mm_min,
        ))

    return RotaryOperation(
        strategy=RotaryStrategy.CONTOUR,
        passes=passes,
        preamble=_rotary_preamble(setup),
        postamble=_rotary_postamble(setup),
    )


def plan_indexed(setup: RotaryJobSetup, depth_mm: float) -> RotaryOperation:
    """Plan indexed operation — 3-axis ops at discrete A positions."""
    positions = generate_indexed_positions(
        setup.a_start_deg, setup.a_end_deg, setup.a_step_deg
    )
    passes = []
    for a in positions:
        passes.append(RotaryPass(
            a_angle_deg=a,
            x_start_mm=setup.stock_center_offset_x_mm,
            x_end_mm=setup.stock_center_offset_x_mm + setup.stock_length_mm,
            z_depth_mm=-depth_mm,
            feed_rate=setup.feed_rate_mm_min,
        ))

    return RotaryOperation(
        strategy=RotaryStrategy.INDEXED,
        passes=passes,
        preamble=_rotary_preamble(setup),
        postamble=_rotary_postamble(setup),
    )


def plan_pattern(setup: RotaryJobSetup, depth_mm: float) -> RotaryOperation:
    """Plan pattern repeat — repeats a pattern N times around the cylinder."""
    angle_per_repeat = 360.0 / setup.pattern_repeat_count
    passes = []

    for i in range(setup.pattern_repeat_count):
        a = setup.a_start_deg + i * angle_per_repeat
        passes.append(RotaryPass(
            a_angle_deg=round(a % 360, 3),
            x_start_mm=setup.stock_center_offset_x_mm,
            x_end_mm=setup.stock_center_offset_x_mm + setup.stock_length_mm,
            z_depth_mm=-depth_mm,
            feed_rate=setup.feed_rate_mm_min,
        ))

    return RotaryOperation(
        strategy=RotaryStrategy.PATTERN,
        passes=passes,
        preamble=_rotary_preamble(setup),
        postamble=_rotary_postamble(setup),
    )


def plan_operation(
    setup: RotaryJobSetup,
    depth_mm: float,
) -> RotaryOperation:
    """Plan a rotary operation using the strategy specified in setup."""
    if setup.strategy == RotaryStrategy.ROUGHING:
        return plan_roughing(setup, depth_mm)
    elif setup.strategy == RotaryStrategy.FINISHING:
        return plan_finishing(setup, depth_mm)
    elif setup.strategy == RotaryStrategy.CONTOUR:
        return plan_contour(setup, depth_mm)
    elif setup.strategy == RotaryStrategy.INDEXED:
        return plan_indexed(setup, depth_mm)
    elif setup.strategy == RotaryStrategy.PATTERN:
        return plan_pattern(setup, depth_mm)
    elif setup.strategy == RotaryStrategy.CONTINUOUS:
        return plan_finishing(setup, depth_mm)
    raise ValueError(f"Unknown strategy: {setup.strategy}")


def rotary_pass_to_gcode(rp: RotaryPass, use_inverse_time: bool = False) -> List[str]:
    """Convert a single RotaryPass to G-code lines."""
    lines = []
    lines.append(f"G0 A{rp.a_angle_deg:.1f}")

    if rp.is_rapid:
        lines.append(f"G0 X{rp.x_start_mm:.3f} Z{rp.z_depth_mm:.3f}")
        lines.append(f"G0 X{rp.x_end_mm:.3f}")
    else:
        lines.append(f"G0 X{rp.x_start_mm:.3f}")
        if use_inverse_time:
            lines.append("G93")
        lines.append(f"G1 Z{rp.z_depth_mm:.3f} F{rp.feed_rate / 3:.0f}")
        lines.append(f"G1 X{rp.x_end_mm:.3f} F{rp.feed_rate:.0f}")
        if use_inverse_time:
            lines.append("G94")

    return lines


def operation_to_gcode(op: RotaryOperation, use_inverse_time: bool = False) -> str:
    """Convert a complete RotaryOperation to G-code."""
    lines = []
    if op.preamble:
        lines.append(op.preamble)

    for rp in op.passes:
        lines.extend(rotary_pass_to_gcode(rp, use_inverse_time))

    if op.postamble:
        lines.append(op.postamble)

    return "\n".join(lines)


def _rotary_preamble(setup: RotaryJobSetup) -> str:
    return "\n".join([
        "; Carvera 4-Axis Rotary Operation",
        f"; Strategy: {setup.strategy.value}",
        f"; Stock: {setup.stock_diameter_mm}mm dia x {setup.stock_length_mm}mm",
        "G21",
        "G90",
        "G17",
        f"G0 Z{setup.safe_z_mm}",
        "G0 Y0",
        f"M3 S{setup.spindle_rpm}",
        "G4 P2",
    ])


def _rotary_postamble(setup: RotaryJobSetup) -> str:
    return "\n".join([
        "M5",
        f"G0 Z{setup.safe_z_mm}",
        "G0 A0",
        "G0 X0 Y0",
        "M9",
        "M2",
    ])
