# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Jacob Rrough

import pathlib
import FreeCAD

_addon_dir = pathlib.Path(__file__).parent

# Register WorkTrackCAM machine definitions with FreeCAD's MachineFactory
_machines_dir = _addon_dir / "machines"
if _machines_dir.is_dir():
    try:
        from Machine.models.machine import MachineFactory
        MachineFactory.register_addon_machine_dir(_machines_dir, namespace="WorkTrackCAM")
        FreeCAD.Console.PrintLog("WorkTrackCAM: registered machine profiles\n")
    except ImportError:
        FreeCAD.Console.PrintWarning(
            "WorkTrackCAM: Machine module not available — machine profiles not registered\n"
        )

# Register WorkTrackCAM post-processor scripts
_posts_dir = _addon_dir / "posts"
if _posts_dir.is_dir():
    try:
        import Path.Preferences as PathPreferences
        PathPreferences.addPostSearchPath(str(_posts_dir))
        FreeCAD.Console.PrintLog("WorkTrackCAM: registered post-processor scripts\n")
    except (ImportError, AttributeError):
        FreeCAD.Console.PrintWarning(
            "WorkTrackCAM: Path.Preferences not available — post-processors not registered\n"
        )

FreeCAD.__unit_test__ += ["TestWorkTrackCAM"]
