# SPDX-License-Identifier: MIT
#
# Tests for the Laguna vacuum postlude G-code generator.

import pytest
from integration.laguna.vacuum_postlude import (
    generate_vacuum_on,
    generate_vacuum_off,
    generate_vacuum_all_off,
    wrap_gcode_with_vacuum,
)
from integration.laguna.vacuum_allocator import engaged_zone_indices, allocate_zones


class TestGenerateVacuumOn:
    def test_single_zone(self):
        result = generate_vacuum_on([0])
        assert "M64 P0" in result

    def test_multiple_zones(self):
        result = generate_vacuum_on([0, 2, 4])
        assert "M64 P0" in result
        assert "M64 P2" in result
        assert "M64 P4" in result

    def test_all_six_zones(self):
        result = generate_vacuum_on([0, 1, 2, 3, 4, 5])
        for i in range(6):
            assert f"M64 P{i}" in result

    def test_empty_zones(self):
        result = generate_vacuum_on([])
        assert "No vacuum zones" in result
        assert "M64" not in result

    def test_out_of_range_ignored(self):
        result = generate_vacuum_on([0, 7, -1])
        assert "M64 P0" in result
        assert "M64 P7" not in result

    def test_sorted_output(self):
        result = generate_vacuum_on([4, 1, 3])
        lines = [l for l in result.splitlines() if l.startswith("M64")]
        assert lines == ["M64 P1", "M64 P3", "M64 P4"]


class TestGenerateVacuumOff:
    def test_single_zone(self):
        result = generate_vacuum_off([0])
        assert "M65 P0" in result

    def test_multiple_zones(self):
        result = generate_vacuum_off([1, 3, 5])
        assert "M65 P1" in result
        assert "M65 P3" in result
        assert "M65 P5" in result

    def test_empty_zones(self):
        result = generate_vacuum_off([])
        assert "No vacuum zones" in result
        assert "M65" not in result


class TestGenerateVacuumAllOff:
    def test_all_six_zones(self):
        result = generate_vacuum_all_off()
        for i in range(6):
            assert f"M65 P{i}" in result


class TestWrapGcodeWithVacuum:
    SAMPLE_GCODE = """\
G21
G90
G17
G0 Z203.0
M3 S18000
G4 P2.0
G0 X50 Y50
G1 Z-5.0 F1000
G1 X150 Y150 F2000
M5
G0 Z203.0
M30"""

    def test_inserts_vacuum_on_after_spindle_start(self):
        result = wrap_gcode_with_vacuum(self.SAMPLE_GCODE, [0, 1])
        lines = result.splitlines()
        m3_idx = next(i for i, l in enumerate(lines) if "M3 " in l)
        m64_indices = [i for i, l in enumerate(lines) if "M64" in l]
        assert all(idx > m3_idx for idx in m64_indices)

    def test_inserts_vacuum_off_before_spindle_stop(self):
        result = wrap_gcode_with_vacuum(self.SAMPLE_GCODE, [0, 1])
        lines = result.splitlines()
        m5_idx = next(i for i, l in enumerate(lines) if l.strip() == "M5" or l.strip().startswith("M5"))
        m65_indices = [i for i, l in enumerate(lines) if "M65" in l]
        assert all(idx < m5_idx for idx in m65_indices)

    def test_empty_zones_returns_unchanged(self):
        result = wrap_gcode_with_vacuum(self.SAMPLE_GCODE, [])
        assert result == self.SAMPLE_GCODE

    def test_includes_dwell_after_vacuum_on(self):
        result = wrap_gcode_with_vacuum(self.SAMPLE_GCODE, [0], dwell_after_on_s=2.0)
        assert "G4 P2.0" in result

    def test_no_dwell_when_zero(self):
        result = wrap_gcode_with_vacuum(self.SAMPLE_GCODE, [0], dwell_after_on_s=0)
        vacuum_on_block = generate_vacuum_on([0])
        assert vacuum_on_block in result
        assert "G4 P0" not in result

    def test_all_zones_engaged(self):
        result = wrap_gcode_with_vacuum(self.SAMPLE_GCODE, [0, 1, 2, 3, 4, 5])
        for i in range(6):
            assert f"M64 P{i}" in result
            assert f"M65 P{i}" in result

    def test_original_gcode_preserved(self):
        result = wrap_gcode_with_vacuum(self.SAMPLE_GCODE, [0, 1])
        assert "G21" in result
        assert "G1 X150 Y150" in result
        assert "M30" in result
