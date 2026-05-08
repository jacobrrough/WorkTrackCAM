# SPDX-License-Identifier: MIT

import pytest
from integration.carvera.wcs_probing import (
    ProbeConfig,
    generate_z_probe,
    generate_xy_probe_corner,
    generate_full_wcs_probe,
    generate_tool_probe_with_atc,
)


class TestZProbe:
    def test_default_two_pass(self):
        lines = generate_z_probe()
        text = "\n".join(lines)
        assert "G38.2" in text
        assert "Fast probe" in text
        assert "Slow probe" in text
        assert "G92 Z0.000" in text
        assert text.startswith("(--- WCS Z Probe ---)")
        assert text.endswith("(--- End Z Probe ---)")

    def test_single_pass(self):
        config = ProbeConfig(use_two_pass=False)
        lines = generate_z_probe(config)
        text = "\n".join(lines)
        assert text.count("G38.2") == 1
        assert "Fast probe" not in text

    def test_z_offset(self):
        lines = generate_z_probe(wcs_z_offset=3.5)
        text = "\n".join(lines)
        assert "G92 Z3.500" in text

    def test_custom_position(self):
        config = ProbeConfig(probe_x=50.0, probe_y=75.0)
        lines = generate_z_probe(config)
        text = "\n".join(lines)
        assert "G0 X50.000 Y75.000" in text

    def test_no_position_when_none(self):
        lines = generate_z_probe()
        text = "\n".join(lines)
        assert "X" not in text.split("G38.2")[0].split("G0 Z")[1]

    def test_safe_z_retract(self):
        config = ProbeConfig(safe_z_mm=80.0)
        lines = generate_z_probe(config)
        assert lines[1] == "G0 Z80.0"
        assert lines[-2] == "G0 Z80.0"


class TestXYProbeCorner:
    def test_front_left_directions(self):
        lines = generate_xy_probe_corner(corner="front_left")
        text = "\n".join(lines)
        assert "G38.2 X-50" in text
        assert "G38.2 Y-50" in text
        assert "G92 X0" in text
        assert "G92 Y0" in text

    def test_front_right_directions(self):
        lines = generate_xy_probe_corner(corner="front_right")
        text = "\n".join(lines)
        assert "G38.2 X50" in text
        assert "G38.2 Y-50" in text

    def test_back_left_directions(self):
        lines = generate_xy_probe_corner(corner="back_left")
        text = "\n".join(lines)
        assert "G38.2 X-50" in text
        assert "G38.2 Y50" in text

    def test_back_right_directions(self):
        lines = generate_xy_probe_corner(corner="back_right")
        text = "\n".join(lines)
        assert "G38.2 X50" in text
        assert "G38.2 Y50" in text

    def test_stock_thickness_affects_probe_z(self):
        lines_thin = generate_xy_probe_corner(stock_thickness_mm=0)
        lines_thick = generate_xy_probe_corner(stock_thickness_mm=20)
        z_thin = [l for l in lines_thin if l.startswith("G0 Z-")]
        z_thick = [l for l in lines_thick if l.startswith("G0 Z-")]
        assert len(z_thin) > 0
        assert len(z_thick) > 0
        assert z_thin[0] != z_thick[0]


class TestFullWCSProbe:
    def test_combines_z_and_xy(self):
        lines = generate_full_wcs_probe()
        text = "\n".join(lines)
        assert "(=== Full WCS Probe Sequence ===)" in text
        assert "(--- WCS Z Probe ---)" in text
        assert "front_left corner" in text
        assert "(=== End Full WCS Probe ===)" in text

    def test_custom_corner(self):
        lines = generate_full_wcs_probe(corner="back_right")
        text = "\n".join(lines)
        assert "back_right corner" in text

    def test_passes_config_through(self):
        config = ProbeConfig(safe_z_mm=100.0)
        lines = generate_full_wcs_probe(config)
        assert "G0 Z100.0" in lines


class TestToolProbeWithAtc:
    def test_probe_sequence(self):
        lines = generate_tool_probe_with_atc(3)
        text = "\n".join(lines)
        assert "T0 M6" in text
        assert "G38.2" in text
        assert "G92 Z0" in text
        assert "T3 M6" in text
        assert "G43 H3" in text

    def test_tool_number_in_comment(self):
        lines = generate_tool_probe_with_atc(5)
        assert "T5" in lines[0]

    def test_safe_z_from_config(self):
        config = ProbeConfig(safe_z_mm=75.0)
        lines = generate_tool_probe_with_atc(1, config)
        assert "G0 Z75.0" in lines
