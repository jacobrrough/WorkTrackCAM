# SPDX-License-Identifier: MIT

import pytest
from integration.carvera.atc_sequencer import (
    AtcCapability,
    generate_tool_change,
    sequence_multi_tool_job,
)


class TestGenerateToolChange:
    def test_basic_tool_change(self):
        atc = AtcCapability(slot_count=6, probe_slot=0)
        lines = generate_tool_change(1, 1, atc)
        assert any("T1 M6" in l for l in lines)
        assert any("G43 H1" in l for l in lines)

    def test_safe_z_retract(self):
        atc = AtcCapability()
        lines = generate_tool_change(2, 2, atc, safe_z=75.0)
        assert any("Z75.0" in l for l in lines)

    def test_no_tlc_when_disabled(self):
        atc = AtcCapability(has_tool_length_comp=False)
        lines = generate_tool_change(1, 1, atc)
        assert not any("G43" in l for l in lines)


class TestSequenceMultiToolJob:
    def test_single_tool(self):
        blocks = sequence_multi_tool_job([1])
        assert len(blocks) == 1
        assert blocks[0].tool_number == 1

    def test_deduplicates_consecutive(self):
        blocks = sequence_multi_tool_job([1, 1, 2, 2, 3])
        assert len(blocks) == 3
        assert [b.tool_number for b in blocks] == [1, 2, 3]

    def test_empty_order(self):
        blocks = sequence_multi_tool_job([])
        assert len(blocks) == 0

    def test_slot_wraps_around(self):
        atc = AtcCapability(slot_count=6)
        blocks = sequence_multi_tool_job([7], atc)
        assert blocks[0].slot_number == 1  # 7 % 6 = 1
