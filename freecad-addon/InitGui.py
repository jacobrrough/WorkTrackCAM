# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Jacob Rrough

import FreeCAD

if FreeCAD.GuiUp:
    import FreeCADGui
    from FreeCADGui import Workbench
else:
    class Workbench:
        pass


class WorkTrackCAMWorkbench(Workbench):
    """Workshop-focused CAM workbench for 3 target machines."""

    MenuText = "WorkTrackCAM"
    ToolTip = "Workshop CAM for Creality K2 Plus, Laguna Swift 5x10, and Makera Carvera"

    def __init__(self):
        import pathlib
        icon_dir = pathlib.Path(__file__).parent / "workbench" / "icons"
        icon_path = icon_dir / "WorkTrackCAM.svg"
        if icon_path.exists():
            self.__class__.Icon = str(icon_path)

    def Initialize(self):
        from PySide.QtCore import QT_TRANSLATE_NOOP
        import FreeCADGui

        # Import the standard CAM workbench modules so all operations are available
        import Path
        import Path.GuiInit
        Path.GuiInit.Startup()

        # Register WorkTrackCAM commands
        from workbench.commands import my_shop_panel
        from workbench.commands import job_presets
        from workbench.commands import moonraker_push
        from workbench.commands import moonraker_status
        from workbench.commands import k2_slice
        from workbench.commands import laguna_vacuum_zones
        from workbench.commands import laguna_fullsheet
        from workbench.commands import carvera_rotary_setup
        from workbench.commands import carvera_atc_sequencer

        # --- Toolbar: My Shop ---
        shop_cmds = [
            "WorkTrackCAM_MyShop",
            "WorkTrackCAM_NewJob_Laguna",
            "WorkTrackCAM_NewJob_Carvera",
            "WorkTrackCAM_NewJob_K2",
        ]

        # --- Toolbar: K2 Plus FDM ---
        k2_cmds = [
            "WorkTrackCAM_K2Slice",
            "WorkTrackCAM_MoonrakerPush",
            "WorkTrackCAM_MoonrakerStatus",
        ]

        # --- Toolbar: Laguna ---
        laguna_cmds = [
            "WorkTrackCAM_VacuumZones",
            "WorkTrackCAM_FullSheet",
        ]

        # --- Toolbar: Carvera ---
        carvera_cmds = [
            "WorkTrackCAM_RotarySetup",
            "WorkTrackCAM_AtcSequencer",
        ]

        # --- Toolbar: CAM Operations (reuse FreeCAD CAM commands) ---
        from Path.Main.Gui import JobCmd as PathJobCmd
        from Path.Tool.library.ui import cmd as PathToolBitLibraryCmd

        cam_2d_cmds = [
            "CAM_Profile",
            "CAM_Pocket_Shape",
            "CAM_MillFacing",
            "CAM_Helix",
            "CAM_Adaptive",
            "CAM_Slot",
        ]
        cam_3d_cmds = ["CAM_Pocket3D"]
        cam_engrave_cmds = ["CAM_Engrave", "CAM_Deburr", "CAM_Vcarve"]
        cam_drill_cmds = ["CAM_Drilling", "CAM_ThreadMilling"]
        cam_dressup_cmds = [
            "CAM_DressupTag",
            "CAM_DressupDogbone",
            "CAM_DressupLeadInOut",
            "CAM_DressupRampEntry",
            "CAM_DressupPathBoundary",
        ]
        cam_post_cmds = ["CAM_Post", "CAM_Inspect"]
        cam_sim_cmds = ["CAM_SimulatorGL"]

        # Register toolbars
        self.appendToolbar(
            QT_TRANSLATE_NOOP("Workbench", "My Shop"),
            shop_cmds,
        )
        self.appendToolbar(
            QT_TRANSLATE_NOOP("Workbench", "2D Operations"),
            cam_2d_cmds,
        )
        self.appendToolbar(
            QT_TRANSLATE_NOOP("Workbench", "3D Operations"),
            cam_3d_cmds,
        )
        self.appendToolbar(
            QT_TRANSLATE_NOOP("Workbench", "Engrave"),
            cam_engrave_cmds,
        )
        self.appendToolbar(
            QT_TRANSLATE_NOOP("Workbench", "Drilling"),
            cam_drill_cmds,
        )
        self.appendToolbar(
            QT_TRANSLATE_NOOP("Workbench", "Dressups"),
            cam_dressup_cmds,
        )
        self.appendToolbar(
            QT_TRANSLATE_NOOP("Workbench", "Laguna Swift"),
            laguna_cmds,
        )
        self.appendToolbar(
            QT_TRANSLATE_NOOP("Workbench", "Carvera"),
            carvera_cmds,
        )
        self.appendToolbar(
            QT_TRANSLATE_NOOP("Workbench", "K2 Plus FDM"),
            k2_cmds,
        )
        self.appendToolbar(
            QT_TRANSLATE_NOOP("Workbench", "Post & Simulate"),
            cam_post_cmds + cam_sim_cmds,
        )

        # Register menus
        self.appendMenu(
            QT_TRANSLATE_NOOP("Workbench", "&My Shop"),
            shop_cmds,
        )
        self.appendMenu(
            QT_TRANSLATE_NOOP("Workbench", "&Operations"),
            cam_2d_cmds + cam_3d_cmds + cam_engrave_cmds + cam_drill_cmds,
        )
        self.appendMenu(
            QT_TRANSLATE_NOOP("Workbench", "&Dressups"),
            cam_dressup_cmds,
        )
        self.appendMenu(
            QT_TRANSLATE_NOOP("Workbench", "&Laguna Swift"),
            laguna_cmds,
        )
        self.appendMenu(
            QT_TRANSLATE_NOOP("Workbench", "&Carvera"),
            carvera_cmds,
        )
        self.appendMenu(
            QT_TRANSLATE_NOOP("Workbench", "&K2 Plus"),
            k2_cmds,
        )
        self.appendMenu(
            QT_TRANSLATE_NOOP("Workbench", "&Output"),
            cam_post_cmds + cam_sim_cmds,
        )

        FreeCAD.Console.PrintLog("WorkTrackCAM workbench initialized\n")

    def Activated(self):
        FreeCAD.Console.PrintLog("WorkTrackCAM workbench activated\n")

    def Deactivated(self):
        FreeCAD.Console.PrintLog("WorkTrackCAM workbench deactivated\n")

    def GetClassName(self):
        return "Gui::PythonWorkbench"


FreeCADGui.addWorkbench(WorkTrackCAMWorkbench)
