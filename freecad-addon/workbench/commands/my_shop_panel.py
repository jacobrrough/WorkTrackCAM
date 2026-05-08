# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Jacob Rrough

import FreeCAD
import FreeCADGui
from PySide import QtCore, QtWidgets

MACHINES = [
    {
        "id": "Laguna_Swift_5x10",
        "label": "Laguna Swift 5×10",
        "kind": "cnc",
        "icon": ":/icons/daggers-crossed.svg",
        "description": "3-axis CNC router — 1524×3048 mm, RichAuto A-series",
    },
    {
        "id": "Makera_Carvera_3axis",
        "label": "Makera Carvera",
        "kind": "cnc",
        "icon": ":/icons/daggers-crossed.svg",
        "description": "Desktop CNC — 360×240×140 mm, ATC 6-slot",
    },
    {
        "id": "Makera_Carvera_4axis",
        "label": "Carvera 4th Axis",
        "kind": "cnc",
        "icon": ":/icons/daggers-crossed.svg",
        "description": "4-axis rotary — 240×92 mm, harmonic drive",
    },
    {
        "id": "Creality_K2_Plus",
        "label": "Creality K2 Plus",
        "kind": "fdm",
        "icon": ":/icons/daggers-crossed.svg",
        "description": "FDM 3D printer — 350×350×350 mm, Klipper + Moonraker",
    },
]


class MyShopPanel(QtWidgets.QWidget):
    """Task panel showing the 3 target machines as selectable cards."""

    machine_selected = QtCore.Signal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        layout = QtWidgets.QVBoxLayout(self)

        header = QtWidgets.QLabel("My Shop")
        header.setStyleSheet("font-size: 16px; font-weight: bold; margin-bottom: 8px;")
        layout.addWidget(header)

        for machine in MACHINES:
            btn = QtWidgets.QPushButton()
            btn.setStyleSheet(
                "QPushButton { text-align: left; padding: 12px; margin: 2px 0; }"
                "QPushButton:hover { background-color: palette(highlight); color: palette(highlighted-text); }"
            )
            btn.setText(f"{machine['label']}\n{machine['description']}")
            btn.setProperty("machine_id", machine["id"])
            btn.clicked.connect(lambda checked=False, mid=machine["id"]: self._on_select(mid))
            layout.addWidget(btn)

        layout.addStretch()

    def _on_select(self, machine_id):
        self.machine_selected.emit(machine_id)


class MyShopTaskPanel:
    """FreeCAD task panel adapter for the My Shop selector."""

    def __init__(self):
        self.form = MyShopPanel()
        self.form.machine_selected.connect(self._on_machine_selected)

    def _on_machine_selected(self, machine_id):
        FreeCAD.Console.PrintMessage(f"WorkTrackCAM: selected machine {machine_id}\n")
        FreeCADGui.Control.closeDialog()
        # Trigger job creation for the selected machine
        from workbench.commands.job_presets import create_job_for_machine
        create_job_for_machine(machine_id)

    def accept(self):
        FreeCADGui.Control.closeDialog()
        return True

    def reject(self):
        FreeCADGui.Control.closeDialog()
        return True


class CommandMyShop:
    """Open the My Shop machine selector panel."""

    def GetResources(self):
        return {
            "MenuText": "My Shop",
            "ToolTip": "Select a machine from your shop to start a new CAM job",
        }

    def IsActive(self):
        return True

    def Activated(self):
        panel = MyShopTaskPanel()
        FreeCADGui.Control.showDialog(panel)


FreeCADGui.addCommand("WorkTrackCAM_MyShop", CommandMyShop())
