# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Jacob Rrough
#
# Persistent preferences for WorkTrackCAM.
# Uses FreeCAD's parameter system for cross-session storage.

import FreeCAD

_PREF_GROUP = "User parameter:BaseApp/Preferences/Mod/WorkTrackCAM"


def _group():
    return FreeCAD.ParamGet(_PREF_GROUP)


def get_moonraker_url() -> str:
    return _group().GetString("MoonrakerURL", "http://localhost:7125")


def set_moonraker_url(url: str):
    _group().SetString("MoonrakerURL", url)


def get_default_machine() -> str:
    return _group().GetString("DefaultMachine", "Laguna_Swift_5x10")


def set_default_machine(machine_id: str):
    _group().SetString("DefaultMachine", machine_id)


def get_cura_engine_path() -> str:
    return _group().GetString("CuraEnginePath", "")


def set_cura_engine_path(path: str):
    _group().SetString("CuraEnginePath", path)


def get_k2_default_preset() -> str:
    return _group().GetString("K2DefaultPreset", "standard")


def set_k2_default_preset(preset: str):
    _group().SetString("K2DefaultPreset", preset)


def get_laguna_default_sheet() -> str:
    return _group().GetString("LagunaDefaultSheet", "full_4x8")


def set_laguna_default_sheet(preset: str):
    _group().SetString("LagunaDefaultSheet", preset)


def get_laguna_vacuum_dwell() -> float:
    return _group().GetFloat("LagunaVacuumDwell", 3.0)


def set_laguna_vacuum_dwell(seconds: float):
    _group().SetFloat("LagunaVacuumDwell", seconds)


def get_carvera_safe_z() -> float:
    return _group().GetFloat("CarveraSafeZ", 50.0)


def set_carvera_safe_z(mm: float):
    _group().SetFloat("CarveraSafeZ", mm)


def get_carvera_probe_two_pass() -> bool:
    return _group().GetBool("CarveraProbeTwoPass", True)


def set_carvera_probe_two_pass(enabled: bool):
    _group().SetBool("CarveraProbeTwoPass", enabled)
