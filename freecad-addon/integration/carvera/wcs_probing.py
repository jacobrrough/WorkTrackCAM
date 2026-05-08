# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Jacob Rrough
#
# WCS probing block generation for Makera Carvera.
# Generates G38.2 probing sequences for workpiece coordinate system setup.
#
# The Carvera wireless probe is T0 and uses G38.2 for touch-off.
# Typical probe sequence:
#   1. Select probe tool (T0 M6 if ATC available)
#   2. Move to approximate probe position
#   3. G38.2 Z<target> F<feed> — probe downward
#   4. G92 Z<offset> — set WCS zero at contact point
#   5. Retract to safe Z
#   6. Change to cutting tool

from dataclasses import dataclass
from typing import List, Optional


@dataclass
class ProbeConfig:
    probe_feed_rate: float = 100.0
    fast_probe_feed: float = 200.0
    slow_probe_feed: float = 50.0
    probe_retract_mm: float = 2.0
    probe_depth_mm: float = 50.0
    safe_z_mm: float = 50.0
    probe_x: Optional[float] = None
    probe_y: Optional[float] = None
    use_two_pass: bool = True


def generate_z_probe(
    config: Optional[ProbeConfig] = None,
    wcs_z_offset: float = 0.0,
) -> List[str]:
    """Generate a Z-axis probing sequence for workpiece top surface."""
    if config is None:
        config = ProbeConfig()

    lines = [
        "(--- WCS Z Probe ---)",
        f"G0 Z{config.safe_z_mm:.1f}",
    ]

    if config.probe_x is not None and config.probe_y is not None:
        lines.append(f"G0 X{config.probe_x:.3f} Y{config.probe_y:.3f}")

    if config.use_two_pass:
        lines.extend([
            f"(Fast probe)",
            f"G38.2 Z-{config.probe_depth_mm:.1f} F{config.fast_probe_feed:.0f}",
            f"G91",
            f"G0 Z{config.probe_retract_mm:.1f}",
            f"G90",
            f"(Slow probe for accuracy)",
            f"G38.2 Z-{config.probe_retract_mm + 2:.1f} F{config.slow_probe_feed:.0f}",
        ])
    else:
        lines.append(
            f"G38.2 Z-{config.probe_depth_mm:.1f} F{config.probe_feed_rate:.0f}"
        )

    lines.extend([
        f"G92 Z{wcs_z_offset:.3f}",
        f"G0 Z{config.safe_z_mm:.1f}",
        "(--- End Z Probe ---)",
    ])

    return lines


def generate_xy_probe_corner(
    config: Optional[ProbeConfig] = None,
    corner: str = "front_left",
    stock_thickness_mm: float = 0.0,
) -> List[str]:
    """Generate an XY corner probing sequence for workpiece edge location."""
    if config is None:
        config = ProbeConfig()

    lines = [
        f"(--- WCS XY Probe — {corner} corner ---)",
        f"G0 Z{config.safe_z_mm:.1f}",
    ]

    probe_z = -stock_thickness_mm / 2 if stock_thickness_mm > 0 else -5.0

    if corner in ("front_left", "back_left"):
        lines.extend([
            f"(Probe X edge)",
            f"G0 Z{probe_z:.1f}",
            f"G38.2 X-50 F{config.probe_feed_rate:.0f}",
            "G92 X0",
            f"G0 X5",
        ])
    else:
        lines.extend([
            f"(Probe X edge)",
            f"G0 Z{probe_z:.1f}",
            f"G38.2 X50 F{config.probe_feed_rate:.0f}",
            "G92 X0",
            f"G0 X-5",
        ])

    if corner in ("front_left", "front_right"):
        lines.extend([
            f"(Probe Y edge)",
            f"G38.2 Y-50 F{config.probe_feed_rate:.0f}",
            "G92 Y0",
            f"G0 Y5",
        ])
    else:
        lines.extend([
            f"(Probe Y edge)",
            f"G38.2 Y50 F{config.probe_feed_rate:.0f}",
            "G92 Y0",
            f"G0 Y-5",
        ])

    lines.extend([
        f"G0 Z{config.safe_z_mm:.1f}",
        f"(--- End XY Probe ---)",
    ])

    return lines


def generate_full_wcs_probe(
    config: Optional[ProbeConfig] = None,
    corner: str = "front_left",
    wcs_z_offset: float = 0.0,
    stock_thickness_mm: float = 0.0,
) -> List[str]:
    """Generate a complete WCS probing sequence (Z + XY corner)."""
    if config is None:
        config = ProbeConfig()

    lines = ["(=== Full WCS Probe Sequence ===)"]
    lines.extend(generate_z_probe(config, wcs_z_offset))
    lines.append("")
    lines.extend(generate_xy_probe_corner(config, corner, stock_thickness_mm))
    lines.append("(=== End Full WCS Probe ===)")

    return lines


def generate_tool_probe_with_atc(
    tool_number: int,
    config: Optional[ProbeConfig] = None,
) -> List[str]:
    """Generate a tool length probe after ATC tool change on Carvera."""
    if config is None:
        config = ProbeConfig()

    return [
        f"(Probe tool T{tool_number} length after ATC change)",
        f"T0 M6",
        f"G0 Z{config.safe_z_mm:.1f}",
        f"G38.2 Z-{config.probe_depth_mm:.1f} F{config.probe_feed_rate:.0f}",
        "G92 Z0",
        f"G0 Z{config.safe_z_mm:.1f}",
        f"T{tool_number} M6",
        f"G43 H{tool_number}",
    ]
