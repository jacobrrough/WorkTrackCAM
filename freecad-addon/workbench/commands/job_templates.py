# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Jacob Rrough
#
# FreeCAD command: Job template loader for common workflows.

import pathlib

import FreeCAD
import FreeCADGui
from PySide import QtCore, QtWidgets

_templates_dir = pathlib.Path(__file__).resolve().parent.parent.parent / "resources" / "templates"


TEMPLATES = [
    {
        "id": "laguna_fullsheet_plywood",
        "label": "Laguna — Full-Sheet Plywood",
        "machine": "Laguna_Swift_5x10",
        "description": "4'x8' plywood on vacuum table, 3/4\" stock, profile + pocket ready",
        "stock": {"width": 1219.2, "length": 2438.4, "height": 19.05},
    },
    {
        "id": "laguna_sign_mdf",
        "label": "Laguna — Sign (MDF)",
        "machine": "Laguna_Swift_5x10",
        "description": "2'x4' MDF sign blank, 1/2\" stock, V-carve + profile",
        "stock": {"width": 609.6, "length": 1219.2, "height": 12.7},
    },
    {
        "id": "carvera_small_part",
        "label": "Carvera — Small Part",
        "machine": "Makera_Carvera_3axis",
        "description": "100x100x25mm aluminum block, ATC multi-tool workflow",
        "stock": {"width": 100, "length": 100, "height": 25},
    },
    {
        "id": "carvera_4axis_cylinder",
        "label": "Carvera — 4-Axis Cylinder",
        "machine": "Makera_Carvera_4axis",
        "description": "50mm dia x 100mm cylinder, rotary roughing + finishing",
        "stock": {"diameter": 50, "length": 100},
    },
    {
        "id": "k2_standard_pla",
        "label": "K2 Plus — Standard PLA",
        "machine": "Creality_K2_Plus",
        "description": "PLA print at 210°C nozzle, 60°C bed, 150mm/s",
        "stock": {},
    },
    {
        "id": "k2_highspeed_pla",
        "label": "K2 Plus — High-Speed PLA",
        "machine": "Creality_K2_Plus",
        "description": "PLA print at 220°C nozzle, 60°C bed, 300mm/s",
        "stock": {},
    },
]


class JobTemplatePanel(QtWidgets.QWidget):
    """Task panel for selecting job templates."""

    template_selected = QtCore.Signal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        layout = QtWidgets.QVBoxLayout(self)

        header = QtWidgets.QLabel("Job Templates")
        header.setStyleSheet("font-size: 14px; font-weight: bold;")
        layout.addWidget(header)

        info = QtWidgets.QLabel("Quick-start presets for common workflows:")
        info.setStyleSheet("color: gray; margin-bottom: 8px;")
        info.setWordWrap(True)
        layout.addWidget(info)

        for template in TEMPLATES:
            btn = QtWidgets.QPushButton()
            btn.setStyleSheet(
                "QPushButton { text-align: left; padding: 10px; margin: 2px 0; }"
                "QPushButton:hover { background-color: palette(highlight); color: palette(highlighted-text); }"
            )
            btn.setText(f"{template['label']}\n{template['description']}")
            btn.clicked.connect(
                lambda checked=False, tid=template["id"]: self._on_select(tid)
            )
            layout.addWidget(btn)

        layout.addStretch()

    def _on_select(self, template_id):
        self.template_selected.emit(template_id)


class JobTemplateTaskPanel:
    """FreeCAD task panel adapter."""

    def __init__(self):
        self.form = JobTemplatePanel()
        self.form.template_selected.connect(self._on_template)

    def _on_template(self, template_id):
        template = next((t for t in TEMPLATES if t["id"] == template_id), None)
        if template is None:
            return

        FreeCAD.Console.PrintMessage(
            f"WorkTrackCAM: Loading template '{template['label']}'\n"
        )
        FreeCADGui.Control.closeDialog()

        from workbench.commands.job_presets import create_job_for_machine
        create_job_for_machine(template["machine"])

    def accept(self):
        FreeCADGui.Control.closeDialog()
        return True

    def reject(self):
        FreeCADGui.Control.closeDialog()
        return True


class CommandJobTemplates:
    """Load a pre-configured job template."""

    def GetResources(self):
        return {
            "MenuText": "Job Templates",
            "ToolTip": "Start a new job from a pre-configured template",
        }

    def IsActive(self):
        return True

    def Activated(self):
        panel = JobTemplateTaskPanel()
        FreeCADGui.Control.showDialog(panel)


FreeCADGui.addCommand("WorkTrackCAM_JobTemplates", CommandJobTemplates())
