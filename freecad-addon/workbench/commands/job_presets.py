# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Jacob Rrough

import pathlib
import FreeCAD
import FreeCADGui

_machines_dir = pathlib.Path(__file__).resolve().parent.parent.parent / "machines"

MACHINE_PRESETS = {
    "Laguna_Swift_5x10": {
        "fcm": "Laguna_Swift_5x10.fcm",
        "stock_type": "box",
        "stock_defaults": {"length": 1219.2, "width": 2438.4, "height": 19.05},
        "description": "Laguna Swift 5×10 — Full-sheet plywood preset",
    },
    "Makera_Carvera_3axis": {
        "fcm": "Makera_Carvera_3axis.fcm",
        "stock_type": "box",
        "stock_defaults": {"length": 100, "width": 100, "height": 25},
        "description": "Makera Carvera 3-axis — Small part preset",
    },
    "Makera_Carvera_4axis": {
        "fcm": "Makera_Carvera_4axis.fcm",
        "stock_type": "cylinder",
        "stock_defaults": {"radius": 25, "length": 100},
        "description": "Makera Carvera 4th Axis — Rotary cylinder preset",
    },
    "Creality_K2_Plus": {
        "fcm": "Creality_K2_Plus.fcm",
        "stock_type": "none",
        "stock_defaults": {},
        "description": "Creality K2 Plus — FDM print (slicer workflow)",
    },
}


def create_job_for_machine(machine_id):
    """Create a new CAM Job pre-configured for the specified machine."""
    preset = MACHINE_PRESETS.get(machine_id)
    if not preset:
        FreeCAD.Console.PrintError(f"WorkTrackCAM: unknown machine '{machine_id}'\n")
        return

    doc = FreeCAD.ActiveDocument
    if doc is None:
        doc = FreeCAD.newDocument("WorkTrackCAM")

    if machine_id == "Creality_K2_Plus":
        FreeCAD.Console.PrintMessage(
            "WorkTrackCAM: K2 Plus FDM workflow — slicer integration coming in Phase 3\n"
        )
        return

    # Load the machine configuration
    fcm_path = _machines_dir / preset["fcm"]
    if not fcm_path.exists():
        FreeCAD.Console.PrintError(
            f"WorkTrackCAM: machine file not found: {fcm_path}\n"
        )
        return

    try:
        from Machine.models.machine import MachineFactory
        machine_config = MachineFactory.load_configuration(str(fcm_path.stem))
    except Exception as e:
        FreeCAD.Console.PrintWarning(
            f"WorkTrackCAM: could not load machine config: {e}\n"
        )
        machine_config = None

    # Create a Job using FreeCAD's CAM Job system
    try:
        from Path.Main.Gui import JobCmd
        FreeCADGui.runCommand("CAM_Job")
        FreeCAD.Console.PrintMessage(
            f"WorkTrackCAM: created job for {preset['description']}\n"
        )
    except Exception as e:
        FreeCAD.Console.PrintError(f"WorkTrackCAM: failed to create job: {e}\n")


class CommandNewJobLaguna:
    """Create a new Job pre-configured for the Laguna Swift 5x10."""

    def GetResources(self):
        return {
            "MenuText": "New Laguna Job",
            "ToolTip": "Create a CAM job for Laguna Swift 5×10 (3-axis CNC router)",
        }

    def IsActive(self):
        return True

    def Activated(self):
        create_job_for_machine("Laguna_Swift_5x10")


class CommandNewJobCarvera:
    """Create a new Job pre-configured for the Makera Carvera."""

    def GetResources(self):
        return {
            "MenuText": "New Carvera Job",
            "ToolTip": "Create a CAM job for Makera Carvera (3-axis or 4-axis)",
        }

    def IsActive(self):
        return True

    def Activated(self):
        create_job_for_machine("Makera_Carvera_3axis")


class CommandNewJobK2:
    """Create a new Job for the Creality K2 Plus (FDM slicer workflow)."""

    def GetResources(self):
        return {
            "MenuText": "New K2 Plus Print",
            "ToolTip": "Start an FDM print job for Creality K2 Plus (Klipper + Moonraker)",
        }

    def IsActive(self):
        return True

    def Activated(self):
        create_job_for_machine("Creality_K2_Plus")


FreeCADGui.addCommand("WorkTrackCAM_NewJob_Laguna", CommandNewJobLaguna())
FreeCADGui.addCommand("WorkTrackCAM_NewJob_Carvera", CommandNewJobCarvera())
FreeCADGui.addCommand("WorkTrackCAM_NewJob_K2", CommandNewJobK2())
