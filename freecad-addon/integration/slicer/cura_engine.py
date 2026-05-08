# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Jacob Rrough
#
# CuraEngine subprocess wrapper for K2 Plus FDM slicing.
# Phase 3 implementation — this is a stub for the addon skeleton.

import json
import pathlib
import subprocess
import tempfile
from dataclasses import dataclass
from typing import Optional


@dataclass
class SliceResult:
    gcode_path: str
    success: bool
    stderr: str = ""
    layer_count: int = 0


@dataclass
class SlicePreset:
    name: str
    layer_height_mm: float
    infill_percent: int
    print_speed_mm_s: int
    nozzle_temp_c: int
    bed_temp_c: int


PRESETS = {
    "standard": SlicePreset("Standard PLA", 0.2, 20, 150, 210, 60),
    "high_speed": SlicePreset("High Speed PLA", 0.25, 15, 300, 220, 60),
    "quality": SlicePreset("Quality PLA", 0.12, 25, 80, 205, 60),
}


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


def slice_stl(
    stl_path: str,
    output_dir: Optional[str] = None,
    preset_name: str = "standard",
    definition_path: Optional[str] = None,
) -> SliceResult:
    """Slice an STL file using CuraEngine. Returns path to generated G-code."""
    engine = find_cura_engine()
    if engine is None:
        return SliceResult("", False, "CuraEngine binary not found")

    preset = PRESETS.get(preset_name, PRESETS["standard"])

    if output_dir is None:
        output_dir = tempfile.mkdtemp(prefix="worktrack_slice_")

    output_path = pathlib.Path(output_dir) / "output.gcode"

    # TODO Phase 3: build full CuraEngine command with definition file,
    # settings overrides from preset, and proper argument construction.
    # For now this is a stub showing the intended interface.
    return SliceResult(str(output_path), False, "Slicer integration not yet implemented (Phase 3)")
