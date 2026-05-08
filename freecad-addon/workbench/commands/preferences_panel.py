# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Jacob Rrough
#
# FreeCAD command: WorkTrackCAM preferences panel.

import pathlib

import FreeCAD
import FreeCADGui
from PySide import QtWidgets

from workbench import preferences as prefs

_icon_dir = pathlib.Path(__file__).resolve().parent.parent / "icons"

MACHINE_IDS = [
    ("Laguna_Swift_5x10", "Laguna Swift 5×10"),
    ("Makera_Carvera_3axis", "Makera Carvera (3-axis)"),
    ("Makera_Carvera_4axis", "Makera Carvera (4-axis)"),
    ("Creality_K2_Plus", "Creality K2 Plus"),
]


class PreferencesPanel(QtWidgets.QWidget):
    """Task panel for configuring WorkTrackCAM preferences."""

    def __init__(self, parent=None):
        super().__init__(parent)
        layout = QtWidgets.QVBoxLayout(self)

        header = QtWidgets.QLabel("WorkTrackCAM Preferences")
        header.setStyleSheet("font-size: 14px; font-weight: bold;")
        layout.addWidget(header)

        # General
        general_group = QtWidgets.QGroupBox("General")
        general_layout = QtWidgets.QFormLayout(general_group)
        self.default_machine = QtWidgets.QComboBox()
        for mid, label in MACHINE_IDS:
            self.default_machine.addItem(label, mid)
        current = prefs.get_default_machine()
        for i, (mid, _) in enumerate(MACHINE_IDS):
            if mid == current:
                self.default_machine.setCurrentIndex(i)
                break
        general_layout.addRow("Default machine:", self.default_machine)
        layout.addWidget(general_group)

        # K2 Plus
        k2_group = QtWidgets.QGroupBox("Creality K2 Plus")
        k2_layout = QtWidgets.QFormLayout(k2_group)
        self.moonraker_url = QtWidgets.QLineEdit(prefs.get_moonraker_url())
        self.moonraker_url.setPlaceholderText("http://192.168.1.xxx:7125")
        k2_layout.addRow("Moonraker URL:", self.moonraker_url)
        self.cura_path = QtWidgets.QLineEdit(prefs.get_cura_engine_path())
        self.cura_path.setPlaceholderText("Path to CuraEngine binary")
        k2_layout.addRow("CuraEngine path:", self.cura_path)
        self.k2_preset = QtWidgets.QComboBox()
        self.k2_preset.addItems(["standard", "high_speed", "quality"])
        self.k2_preset.setCurrentText(prefs.get_k2_default_preset())
        k2_layout.addRow("Default preset:", self.k2_preset)
        layout.addWidget(k2_group)

        # Laguna
        laguna_group = QtWidgets.QGroupBox("Laguna Swift 5×10")
        laguna_layout = QtWidgets.QFormLayout(laguna_group)
        self.laguna_sheet = QtWidgets.QComboBox()
        self.laguna_sheet.addItems(["full_4x8", "half_4x4", "quarter_2x4", "full_5x10"])
        self.laguna_sheet.setCurrentText(prefs.get_laguna_default_sheet())
        laguna_layout.addRow("Default sheet:", self.laguna_sheet)
        self.vacuum_dwell = QtWidgets.QDoubleSpinBox()
        self.vacuum_dwell.setRange(0, 30)
        self.vacuum_dwell.setValue(prefs.get_laguna_vacuum_dwell())
        self.vacuum_dwell.setSuffix(" s")
        laguna_layout.addRow("Vacuum engage dwell:", self.vacuum_dwell)
        layout.addWidget(laguna_group)

        # Carvera
        carvera_group = QtWidgets.QGroupBox("Makera Carvera")
        carvera_layout = QtWidgets.QFormLayout(carvera_group)
        self.carvera_safe_z = QtWidgets.QDoubleSpinBox()
        self.carvera_safe_z.setRange(5, 200)
        self.carvera_safe_z.setValue(prefs.get_carvera_safe_z())
        self.carvera_safe_z.setSuffix(" mm")
        carvera_layout.addRow("Safe Z height:", self.carvera_safe_z)
        self.probe_two_pass = QtWidgets.QCheckBox("Two-pass probing (fast + slow)")
        self.probe_two_pass.setChecked(prefs.get_carvera_probe_two_pass())
        carvera_layout.addRow(self.probe_two_pass)
        layout.addWidget(carvera_group)

        # Save button
        self.save_btn = QtWidgets.QPushButton("Save Preferences")
        self.save_btn.setStyleSheet("font-weight: bold;")
        self.save_btn.clicked.connect(self._save)
        layout.addWidget(self.save_btn)

        layout.addStretch()

    def _save(self):
        prefs.set_default_machine(self.default_machine.currentData())
        prefs.set_moonraker_url(self.moonraker_url.text())
        prefs.set_cura_engine_path(self.cura_path.text())
        prefs.set_k2_default_preset(self.k2_preset.currentText())
        prefs.set_laguna_default_sheet(self.laguna_sheet.currentText())
        prefs.set_laguna_vacuum_dwell(self.vacuum_dwell.value())
        prefs.set_carvera_safe_z(self.carvera_safe_z.value())
        prefs.set_carvera_probe_two_pass(self.probe_two_pass.isChecked())
        FreeCAD.Console.PrintMessage("WorkTrackCAM: preferences saved\n")


class PreferencesTaskPanel:
    """FreeCAD task panel adapter."""

    def __init__(self):
        self.form = PreferencesPanel()

    def accept(self):
        self.form._save()
        FreeCADGui.Control.closeDialog()
        return True

    def reject(self):
        FreeCADGui.Control.closeDialog()
        return True


class CommandPreferences:
    """Open WorkTrackCAM preferences."""

    def GetResources(self):
        return {
            "MenuText": "Preferences",
            "ToolTip": "Configure WorkTrackCAM settings for all three machines",
            "Pixmap": str(_icon_dir / "WorkTrackCAM.svg"),
        }

    def IsActive(self):
        return True

    def Activated(self):
        panel = PreferencesTaskPanel()
        FreeCADGui.Control.showDialog(panel)


FreeCADGui.addCommand("WorkTrackCAM_Preferences", CommandPreferences())
