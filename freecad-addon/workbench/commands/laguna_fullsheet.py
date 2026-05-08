# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Jacob Rrough
#
# FreeCAD command: Full-sheet stock preset wizard for Laguna Swift 5x10.

import FreeCAD
import FreeCADGui
from PySide import QtCore, QtWidgets

from integration.laguna.vacuum_allocator import SHEET_PRESETS, BED_WIDTH_MM, BED_LENGTH_MM


MATERIAL_THICKNESSES = {
    "1/4\" plywood (6.35 mm)": 6.35,
    "1/2\" plywood (12.7 mm)": 12.7,
    "3/4\" plywood (19.05 mm)": 19.05,
    "1/4\" MDF (6.35 mm)": 6.35,
    "1/2\" MDF (12.7 mm)": 12.7,
    "3/4\" MDF (19.05 mm)": 19.05,
    "1/8\" acrylic (3.175 mm)": 3.175,
    "1/4\" acrylic (6.35 mm)": 6.35,
    "1/8\" aluminum (3.175 mm)": 3.175,
    "1/4\" aluminum (6.35 mm)": 6.35,
}


class FullSheetPanel(QtWidgets.QWidget):
    """Task panel for selecting sheet stock presets."""

    def __init__(self, parent=None):
        super().__init__(parent)
        layout = QtWidgets.QVBoxLayout(self)

        header = QtWidgets.QLabel("Laguna Full-Sheet Presets")
        header.setStyleSheet("font-size: 14px; font-weight: bold;")
        layout.addWidget(header)

        # Sheet size
        size_layout = QtWidgets.QHBoxLayout()
        size_layout.addWidget(QtWidgets.QLabel("Sheet Size:"))
        self.size_combo = QtWidgets.QComboBox()
        self.size_combo.addItem("Full 4'x8' (1219 x 2438 mm)", "full_4x8")
        self.size_combo.addItem("Half 4'x4' (1219 x 1219 mm)", "half_4x4")
        self.size_combo.addItem("Quarter 2'x4' (610 x 1219 mm)", "quarter_2x4")
        self.size_combo.addItem("Full 5'x10' (1524 x 3048 mm)", "full_5x10")
        self.size_combo.currentIndexChanged.connect(self._update_dims)
        size_layout.addWidget(self.size_combo)
        layout.addLayout(size_layout)

        # Material thickness
        mat_layout = QtWidgets.QHBoxLayout()
        mat_layout.addWidget(QtWidgets.QLabel("Material:"))
        self.material_combo = QtWidgets.QComboBox()
        for name in MATERIAL_THICKNESSES:
            self.material_combo.addItem(name)
        self.material_combo.currentIndexChanged.connect(self._update_dims)
        mat_layout.addWidget(self.material_combo)
        layout.addLayout(mat_layout)

        # Custom thickness
        custom_layout = QtWidgets.QHBoxLayout()
        custom_layout.addWidget(QtWidgets.QLabel("Custom thickness (mm):"))
        self.custom_thickness = QtWidgets.QDoubleSpinBox()
        self.custom_thickness.setRange(0.1, 100.0)
        self.custom_thickness.setValue(19.05)
        self.custom_thickness.setEnabled(False)
        custom_layout.addWidget(self.custom_thickness)
        self.custom_check = QtWidgets.QCheckBox("Custom")
        self.custom_check.toggled.connect(self._toggle_custom)
        custom_layout.addWidget(self.custom_check)
        layout.addLayout(custom_layout)

        # Summary
        self.summary = QtWidgets.QLabel()
        self.summary.setWordWrap(True)
        self.summary.setStyleSheet("color: gray; margin-top: 8px;")
        layout.addWidget(self.summary)

        # Create job button
        self.create_btn = QtWidgets.QPushButton("Create Laguna Job with Stock")
        self.create_btn.setStyleSheet("font-weight: bold;")
        self.create_btn.clicked.connect(self._create_job)
        layout.addWidget(self.create_btn)

        layout.addStretch()
        self._update_dims()

    def _toggle_custom(self, checked):
        self.custom_thickness.setEnabled(checked)
        self.material_combo.setEnabled(not checked)
        self._update_dims()

    def _get_thickness(self) -> float:
        if self.custom_check.isChecked():
            return self.custom_thickness.value()
        material_name = self.material_combo.currentText()
        return MATERIAL_THICKNESSES.get(material_name, 19.05)

    def _get_sheet_dims(self):
        key = self.size_combo.currentData()
        return SHEET_PRESETS.get(key, SHEET_PRESETS["full_4x8"])

    def _update_dims(self):
        w, l = self._get_sheet_dims()
        t = self._get_thickness()
        self.summary.setText(
            f"Stock: {w:.1f} x {l:.1f} x {t:.2f} mm\n"
            f"Sheet: {w/25.4:.1f}\" x {l/25.4:.1f}\" x {t/25.4:.3f}\"\n"
            f"Bed utilization: {(w*l)/(BED_WIDTH_MM*BED_LENGTH_MM)*100:.0f}%"
        )

    def _create_job(self):
        w, l = self._get_sheet_dims()
        t = self._get_thickness()

        FreeCAD.Console.PrintMessage(
            f"WorkTrackCAM: Creating Laguna job — stock {w:.1f}x{l:.1f}x{t:.2f}mm\n"
        )

        from workbench.commands.job_presets import create_job_for_machine
        create_job_for_machine("Laguna_Swift_5x10")


class FullSheetTaskPanel:
    """FreeCAD task panel adapter."""

    def __init__(self):
        self.form = FullSheetPanel()

    def accept(self):
        FreeCADGui.Control.closeDialog()
        return True

    def reject(self):
        FreeCADGui.Control.closeDialog()
        return True


class CommandFullSheet:
    """Laguna Swift 5x10 full-sheet stock preset wizard."""

    def GetResources(self):
        return {
            "MenuText": "Full-Sheet Stock",
            "ToolTip": "Select a standard sheet stock preset for Laguna Swift 5×10",
        }

    def IsActive(self):
        return True

    def Activated(self):
        panel = FullSheetTaskPanel()
        FreeCADGui.Control.showDialog(panel)


FreeCADGui.addCommand("WorkTrackCAM_FullSheet", CommandFullSheet())
