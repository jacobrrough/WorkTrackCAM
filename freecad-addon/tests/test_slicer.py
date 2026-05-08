# SPDX-License-Identifier: MIT
#
# Tests for the CuraEngine slicer wrapper and K2 presets.

import os
import pytest
from integration.slicer.cura_engine import (
    PRESETS,
    SlicePreset,
    SliceResult,
    build_cura_command,
    find_cura_engine,
    _parse_layer_count,
    _parse_gcode_stats,
)
from integration.slicer.k2_presets import (
    K2_STANDARD,
    K2_HIGH_SPEED,
    K2_QUALITY,
    K2_ABS,
    get_k2_settings,
    get_k2_start_gcode,
    get_k2_end_gcode,
)


class TestSlicePresets:
    def test_standard_preset_exists(self):
        assert "standard" in PRESETS
        assert PRESETS["standard"].layer_height_mm == 0.2

    def test_high_speed_preset_exists(self):
        assert "high_speed" in PRESETS
        assert PRESETS["high_speed"].print_speed_mm_s == 300

    def test_quality_preset_exists(self):
        assert "quality" in PRESETS
        assert PRESETS["quality"].layer_height_mm == 0.12

    def test_all_presets_have_required_fields(self):
        for name, preset in PRESETS.items():
            assert preset.name, f"{name} missing name"
            assert preset.layer_height_mm > 0, f"{name} invalid layer height"
            assert preset.infill_percent >= 0
            assert preset.print_speed_mm_s > 0
            assert preset.nozzle_temp_c > 0
            assert preset.bed_temp_c >= 0

    def test_preset_to_cura_settings(self):
        settings = PRESETS["standard"].to_cura_settings()
        assert settings["layer_height"] == "0.2"
        assert settings["infill_sparse_density"] == "20"
        assert settings["material_print_temperature"] == "210"
        assert settings["material_bed_temperature"] == "60"
        assert settings["speed_print"] == "150"

    def test_high_speed_fewer_walls(self):
        assert PRESETS["high_speed"].wall_count == 2
        assert PRESETS["standard"].wall_count == 3

    def test_quality_more_layers(self):
        assert PRESETS["quality"].top_layers == 6
        assert PRESETS["quality"].bottom_layers == 6


class TestBuildCuraCommand:
    def test_basic_command(self):
        cmd = build_cura_command(
            "/usr/bin/CuraEngine",
            "/tmp/model.stl",
            "/tmp/output.gcode",
            "/tmp/k2.def.json",
            {"layer_height": "0.2", "speed_print": "150"},
        )
        assert cmd[0] == "/usr/bin/CuraEngine"
        assert cmd[1] == "slice"
        assert "-j" in cmd
        assert cmd[cmd.index("-j") + 1] == "/tmp/k2.def.json"
        assert "-o" in cmd
        assert cmd[cmd.index("-o") + 1] == "/tmp/output.gcode"
        assert "-l" in cmd
        assert cmd[cmd.index("-l") + 1] == "/tmp/model.stl"
        assert "-s" in cmd

    def test_settings_pairs(self):
        cmd = build_cura_command(
            "engine", "in.stl", "out.gcode", "def.json",
            {"layer_height": "0.2", "infill": "20"},
        )
        s_indices = [i for i, v in enumerate(cmd) if v == "-s"]
        assert len(s_indices) == 2
        settings = [cmd[i + 1] for i in s_indices]
        assert "layer_height=0.2" in settings
        assert "infill=20" in settings


class TestParseLayerCount:
    def test_counts_layers(self, tmp_path):
        gcode = tmp_path / "test.gcode"
        gcode.write_text(
            ";LAYER:0\nG1 X10\n;LAYER:1\nG1 X20\n;LAYER:2\nG1 X30\n"
        )
        assert _parse_layer_count(str(gcode)) == 3

    def test_no_layers(self, tmp_path):
        gcode = tmp_path / "test.gcode"
        gcode.write_text("G28\nG1 X10\n")
        assert _parse_layer_count(str(gcode)) == 0

    def test_missing_file(self):
        assert _parse_layer_count("/nonexistent/file.gcode") == 0


class TestParseGcodeStats:
    def test_parses_filament_and_time(self, tmp_path):
        gcode = tmp_path / "test.gcode"
        gcode.write_text(
            ";Filament used: 2.5m\n;TIME:3600\nG28\n"
        )
        stats = _parse_gcode_stats(str(gcode))
        assert stats["filament_mm"] == 2500.0
        assert stats["time_s"] == 3600.0

    def test_missing_stats(self, tmp_path):
        gcode = tmp_path / "test.gcode"
        gcode.write_text("G28\nG1 X10\n")
        stats = _parse_gcode_stats(str(gcode))
        assert stats["filament_mm"] == 0.0
        assert stats["time_s"] == 0.0


class TestSliceStlWithoutEngine:
    def test_missing_engine_returns_failure(self):
        from integration.slicer.cura_engine import slice_stl
        result = slice_stl("/tmp/nonexistent.stl")
        assert not result.success
        assert "not found" in result.stderr.lower() or "not found" in result.stderr


class TestK2MachineOverrides:
    def test_standard_accel(self):
        assert K2_STANDARD.max_acceleration_mm_s2 == 30000

    def test_high_speed_input_shaping(self):
        assert K2_HIGH_SPEED.input_shaping_enabled is True

    def test_quality_lower_accel(self):
        assert K2_QUALITY.max_acceleration_mm_s2 == 10000

    def test_abs_chamber_temp(self):
        assert K2_ABS.chamber_temp_c == 50


class TestK2Settings:
    def test_standard_settings(self):
        settings = get_k2_settings("standard")
        assert settings["machine_width"] == "350"
        assert settings["machine_depth"] == "350"
        assert settings["machine_height"] == "350"
        assert settings["material_print_temperature"] == "210"
        assert settings["material_bed_temperature"] == "60"

    def test_high_speed_settings(self):
        settings = get_k2_settings("high_speed")
        assert settings["speed_print"] == "300"
        assert settings["machine_acceleration"] == "30000"

    def test_quality_settings(self):
        settings = get_k2_settings("quality")
        assert settings["layer_height"] == "0.12"
        assert settings["machine_acceleration"] == "10000"

    def test_unknown_preset_falls_back(self):
        settings = get_k2_settings("nonexistent")
        assert settings["material_print_temperature"] == "210"


class TestK2GcodeBlocks:
    def test_start_gcode_has_homing(self):
        gcode = get_k2_start_gcode("standard")
        assert "G28" in gcode

    def test_start_gcode_has_temps(self):
        gcode = get_k2_start_gcode("standard")
        assert "M104 S210" in gcode
        assert "M140 S60" in gcode
        assert "M109 S210" in gcode
        assert "M190 S60" in gcode

    def test_start_gcode_has_prime_line(self):
        gcode = get_k2_start_gcode("standard")
        assert "G1 X0.1 Y200 E15" in gcode

    def test_start_gcode_high_speed_temps(self):
        gcode = get_k2_start_gcode("high_speed")
        assert "M104 S220" in gcode

    def test_end_gcode_cools_down(self):
        gcode = get_k2_end_gcode()
        assert "M104 S0" in gcode
        assert "M140 S0" in gcode

    def test_end_gcode_presents_print(self):
        gcode = get_k2_end_gcode()
        assert "G1 X0 Y340" in gcode

    def test_end_gcode_disables_steppers(self):
        gcode = get_k2_end_gcode()
        assert "M84" in gcode

    def test_end_gcode_retracts_z(self):
        gcode = get_k2_end_gcode()
        assert "G1 Z10" in gcode
