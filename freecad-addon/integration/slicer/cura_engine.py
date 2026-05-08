# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Jacob Rrough
#
# CuraEngine subprocess wrapper for K2 Plus FDM slicing.
# CuraEngine is GPL — subprocess isolation keeps WorkTrackCAM MIT-clean.
#
# Usage:
#   result = slice_stl("/path/to/model.stl", preset_name="high_speed")
#   if result.success:
#       print(f"G-code at {result.gcode_path}, {result.layer_count} layers")

import json
import os
import pathlib
import re
import subprocess
import tempfile
from dataclasses import dataclass, field
from typing import Dict, List, Optional


@dataclass
class SlicePreset:
    name: str
    layer_height_mm: float
    infill_percent: int
    print_speed_mm_s: int
    nozzle_temp_c: int
    bed_temp_c: int
    wall_count: int = 3
    top_layers: int = 4
    bottom_layers: int = 4
    support_enabled: bool = False
    retraction_distance_mm: float = 0.8
    retraction_speed_mm_s: int = 40
    fan_speed_percent: int = 100
    initial_layer_speed_mm_s: int = 30

    def to_cura_settings(self) -> Dict[str, str]:
        return {
            "layer_height": str(self.layer_height_mm),
            "infill_sparse_density": str(self.infill_percent),
            "speed_print": str(self.print_speed_mm_s),
            "material_print_temperature": str(self.nozzle_temp_c),
            "material_bed_temperature": str(self.bed_temp_c),
            "wall_line_count": str(self.wall_count),
            "top_layers": str(self.top_layers),
            "bottom_layers": str(self.bottom_layers),
            "support_enable": "true" if self.support_enabled else "false",
            "retraction_amount": str(self.retraction_distance_mm),
            "retraction_speed": str(self.retraction_speed_mm_s),
            "cool_fan_speed": str(self.fan_speed_percent),
            "speed_layer_0": str(self.initial_layer_speed_mm_s),
        }


PRESETS = {
    "standard": SlicePreset(
        name="Standard PLA",
        layer_height_mm=0.2,
        infill_percent=20,
        print_speed_mm_s=150,
        nozzle_temp_c=210,
        bed_temp_c=60,
    ),
    "high_speed": SlicePreset(
        name="High Speed PLA",
        layer_height_mm=0.25,
        infill_percent=15,
        print_speed_mm_s=300,
        nozzle_temp_c=220,
        bed_temp_c=60,
        wall_count=2,
        top_layers=3,
        bottom_layers=3,
        retraction_distance_mm=0.6,
    ),
    "quality": SlicePreset(
        name="Quality PLA",
        layer_height_mm=0.12,
        infill_percent=25,
        print_speed_mm_s=80,
        nozzle_temp_c=205,
        bed_temp_c=60,
        wall_count=4,
        top_layers=6,
        bottom_layers=6,
    ),
}


@dataclass
class SliceResult:
    gcode_path: str
    success: bool
    stderr: str = ""
    layer_count: int = 0
    filament_used_mm: float = 0.0
    print_time_s: float = 0.0


def find_cura_engine() -> Optional[str]:
    """Locate the bundled CuraEngine binary."""
    addon_dir = pathlib.Path(__file__).resolve().parent.parent.parent
    candidates = [
        addon_dir / "resources" / "slicer" / "bin" / "CuraEngine.exe",
        addon_dir / "resources" / "slicer" / "bin" / "CuraEngine",
    ]
    for path in candidates:
        if path.exists():
            return str(path)
    return None


def _default_definition_path() -> Optional[str]:
    addon_dir = pathlib.Path(__file__).resolve().parent.parent.parent
    def_path = addon_dir / "resources" / "slicer" / "creality_k2_plus.def.json"
    if def_path.exists():
        return str(def_path)
    return None


def _parse_layer_count(gcode_path: str) -> int:
    """Count layers from LAYER: comments in the generated G-code."""
    count = 0
    try:
        with open(gcode_path, "r") as f:
            for line in f:
                if line.startswith(";LAYER:"):
                    count += 1
    except OSError:
        pass
    return count


def _parse_gcode_stats(gcode_path: str) -> Dict[str, float]:
    """Extract filament used and print time from G-code comments."""
    stats: Dict[str, float] = {"filament_mm": 0.0, "time_s": 0.0}
    try:
        with open(gcode_path, "r") as f:
            for line in f:
                if line.startswith(";Filament used:"):
                    m = re.search(r"([\d.]+)m", line)
                    if m:
                        stats["filament_mm"] = float(m.group(1)) * 1000
                elif line.startswith(";TIME:"):
                    m = re.search(r"(\d+)", line)
                    if m:
                        stats["time_s"] = float(m.group(1))
    except OSError:
        pass
    return stats


def build_cura_command(
    engine_path: str,
    stl_path: str,
    output_path: str,
    definition_path: str,
    settings: Dict[str, str],
) -> List[str]:
    """Build the CuraEngine command-line arguments."""
    cmd = [
        engine_path,
        "slice",
        "-j", definition_path,
        "-o", output_path,
        "-l", stl_path,
    ]
    for key, value in settings.items():
        cmd.extend(["-s", f"{key}={value}"])
    return cmd


def slice_stl(
    stl_path: str,
    output_dir: Optional[str] = None,
    preset_name: str = "standard",
    definition_path: Optional[str] = None,
    extra_settings: Optional[Dict[str, str]] = None,
) -> SliceResult:
    """Slice an STL file using CuraEngine. Returns path to generated G-code."""
    engine = find_cura_engine()
    if engine is None:
        return SliceResult("", False, "CuraEngine binary not found in resources/slicer/bin/")

    preset = PRESETS.get(preset_name)
    if preset is None:
        return SliceResult("", False, f"Unknown preset: {preset_name}. Available: {list(PRESETS.keys())}")

    if definition_path is None:
        definition_path = _default_definition_path()
    if definition_path is None:
        return SliceResult("", False, "Cura machine definition not found at resources/slicer/creality_k2_plus.def.json")

    if not os.path.isfile(stl_path):
        return SliceResult("", False, f"STL file not found: {stl_path}")

    if output_dir is None:
        output_dir = tempfile.mkdtemp(prefix="worktrack_slice_")

    output_path = str(pathlib.Path(output_dir) / "output.gcode")

    settings = preset.to_cura_settings()
    if extra_settings:
        settings.update(extra_settings)

    cmd = build_cura_command(engine, stl_path, output_path, definition_path, settings)

    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300,
        )
    except subprocess.TimeoutExpired:
        return SliceResult("", False, "CuraEngine timed out after 300 seconds")
    except FileNotFoundError:
        return SliceResult("", False, f"CuraEngine binary not executable: {engine}")

    if proc.returncode != 0:
        return SliceResult("", False, f"CuraEngine exited with code {proc.returncode}: {proc.stderr}")

    if not os.path.isfile(output_path):
        return SliceResult("", False, "CuraEngine completed but no output file was generated")

    layer_count = _parse_layer_count(output_path)
    stats = _parse_gcode_stats(output_path)

    return SliceResult(
        gcode_path=output_path,
        success=True,
        stderr=proc.stderr,
        layer_count=layer_count,
        filament_used_mm=stats["filament_mm"],
        print_time_s=stats["time_s"],
    )
