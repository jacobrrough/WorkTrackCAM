# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Jacob Rrough
#
# Multi-tool ATC sequencing for Makera Carvera 3-axis.
# Ported from WorkTrackCAM src/shared/post-process-atc-capability.ts

from dataclasses import dataclass
from typing import List, Optional


@dataclass
class ToolSlot:
    slot_number: int
    tool_number: int
    description: str = ""


@dataclass
class AtcCapability:
    slot_count: int = 6
    probe_slot: int = 0
    has_tool_length_comp: bool = True
    has_wireless_probe: bool = True


@dataclass
class ToolChangeBlock:
    """G-code block emitted for each tool change in a multi-tool job."""
    slot_number: int
    tool_number: int
    gcode_lines: List[str]


def generate_tool_change(
    tool_number: int,
    slot_number: int,
    atc: AtcCapability,
    safe_z: float = 50.0,
) -> List[str]:
    """Generate G-code lines for an ATC tool change on Carvera."""
    lines = [
        f"(Tool change: T{tool_number} from slot {slot_number})",
        f"G0 Z{safe_z:.1f}",
        f"T{tool_number} M6",
    ]
    if atc.has_tool_length_comp:
        lines.append(f"G43 H{tool_number}")
    if atc.has_wireless_probe and atc.probe_slot == 0:
        lines.extend([
            "(Probe tool length)",
            "G38.2 Z-50 F100",
            "G92 Z0",
            f"G0 Z{safe_z:.1f}",
        ])
    return lines


def sequence_multi_tool_job(
    tool_order: List[int],
    atc: Optional[AtcCapability] = None,
    safe_z: float = 50.0,
) -> List[ToolChangeBlock]:
    """Generate the sequence of tool change blocks for a multi-tool job.

    `tool_order` is the list of tool numbers in the order they are used.
    Consecutive duplicate tools are deduplicated.
    """
    if atc is None:
        atc = AtcCapability()

    blocks: List[ToolChangeBlock] = []
    prev_tool = None

    for tool_num in tool_order:
        if tool_num == prev_tool:
            continue
        slot = tool_num % atc.slot_count
        lines = generate_tool_change(tool_num, slot, atc, safe_z)
        blocks.append(ToolChangeBlock(
            slot_number=slot,
            tool_number=tool_num,
            gcode_lines=lines,
        ))
        prev_tool = tool_num

    return blocks
