# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Jacob Rrough
#
# FreeCAD command: Slice STL for K2 Plus using CuraEngine, then push via Moonraker.

import os
import threading
import tempfile

import FreeCAD
import FreeCADGui
from PySide import QtCore, QtWidgets

from integration.slicer.cura_engine import PRESETS, slice_stl
from integration.slicer.k2_presets import get_k2_settings, get_k2_start_gcode, get_k2_end_gcode


class K2SlicePanel(QtWidgets.QWidget):
    """Task panel for slicing STL and sending to K2 Plus."""

    slice_complete = QtCore.Signal(bool, str, str)

    def __init__(self, parent=None):
        super().__init__(parent)
        layout = QtWidgets.QVBoxLayout(self)

        header = QtWidgets.QLabel("K2 Plus Slicer")
        header.setStyleSheet("font-size: 14px; font-weight: bold;")
        layout.addWidget(header)

        # STL file
        file_layout = QtWidgets.QHBoxLayout()
        file_layout.addWidget(QtWidgets.QLabel("STL:"))
        self.file_input = QtWidgets.QLineEdit()
        self.file_input.setPlaceholderText("Select an STL file...")
        file_layout.addWidget(self.file_input)
        self.browse_btn = QtWidgets.QPushButton("Browse...")
        self.browse_btn.clicked.connect(self._browse_file)
        file_layout.addWidget(self.browse_btn)
        layout.addLayout(file_layout)

        # Preset selector
        preset_layout = QtWidgets.QHBoxLayout()
        preset_layout.addWidget(QtWidgets.QLabel("Quality:"))
        self.preset_combo = QtWidgets.QComboBox()
        for key, preset in PRESETS.items():
            self.preset_combo.addItem(preset.name, key)
        preset_layout.addWidget(self.preset_combo)
        layout.addLayout(preset_layout)

        # Preset details
        self.detail_label = QtWidgets.QLabel()
        self.detail_label.setStyleSheet("color: gray; font-size: 11px;")
        self.detail_label.setWordWrap(True)
        layout.addWidget(self.detail_label)
        self.preset_combo.currentIndexChanged.connect(self._update_details)
        self._update_details()

        # Support checkbox
        self.support_check = QtWidgets.QCheckBox("Enable supports")
        layout.addWidget(self.support_check)

        # Status
        self.status_label = QtWidgets.QLabel("Ready")
        self.status_label.setWordWrap(True)
        layout.addWidget(self.status_label)

        # Progress bar
        self.progress = QtWidgets.QProgressBar()
        self.progress.setRange(0, 0)
        self.progress.setVisible(False)
        layout.addWidget(self.progress)

        # Result info
        self.result_text = QtWidgets.QTextEdit()
        self.result_text.setReadOnly(True)
        self.result_text.setMaximumHeight(80)
        self.result_text.setVisible(False)
        layout.addWidget(self.result_text)

        # Buttons
        btn_layout = QtWidgets.QHBoxLayout()
        self.slice_btn = QtWidgets.QPushButton("Slice")
        self.slice_btn.clicked.connect(self._start_slice)
        self.slice_btn.setStyleSheet("font-weight: bold;")
        btn_layout.addWidget(self.slice_btn)

        self.send_btn = QtWidgets.QPushButton("Send to Printer")
        self.send_btn.setEnabled(False)
        self.send_btn.clicked.connect(self._send_to_printer)
        btn_layout.addWidget(self.send_btn)
        layout.addLayout(btn_layout)

        layout.addStretch()

        self._last_gcode_path = ""
        self.slice_complete.connect(self._on_slice_complete)

    def _browse_file(self):
        path, _ = QtWidgets.QFileDialog.getOpenFileName(
            self, "Select STL File", "", "STL Files (*.stl);;All Files (*)"
        )
        if path:
            self.file_input.setText(path)

    def _update_details(self):
        key = self.preset_combo.currentData()
        preset = PRESETS.get(key)
        if preset:
            self.detail_label.setText(
                f"Layer: {preset.layer_height_mm}mm | Speed: {preset.print_speed_mm_s}mm/s | "
                f"Infill: {preset.infill_percent}% | Nozzle: {preset.nozzle_temp_c}C | "
                f"Bed: {preset.bed_temp_c}C"
            )

    def _start_slice(self):
        stl_path = self.file_input.text().strip()
        if not stl_path or not os.path.isfile(stl_path):
            self.status_label.setText("Please select a valid STL file")
            self.status_label.setStyleSheet("color: red;")
            return

        preset_name = self.preset_combo.currentData()
        support = self.support_check.isChecked()

        self.status_label.setText("Slicing...")
        self.status_label.setStyleSheet("")
        self.progress.setVisible(True)
        self.slice_btn.setEnabled(False)
        self.send_btn.setEnabled(False)
        self.result_text.setVisible(False)

        thread = threading.Thread(
            target=self._slice_worker,
            args=(stl_path, preset_name, support),
            daemon=True,
        )
        thread.start()

    def _slice_worker(self, stl_path, preset_name, support):
        extra = {}
        if support:
            extra["support_enable"] = "true"

        result = slice_stl(
            stl_path,
            preset_name=preset_name,
            extra_settings=extra,
        )
        if result.success:
            info = (
                f"Layers: {result.layer_count}\n"
                f"Filament: {result.filament_used_mm / 1000:.1f}m\n"
                f"Est. time: {result.print_time_s / 60:.0f} min"
            )
            self.slice_complete.emit(True, result.gcode_path, info)
        else:
            self.slice_complete.emit(False, "", result.stderr)

    def _on_slice_complete(self, success, gcode_path, info):
        self.progress.setVisible(False)
        self.slice_btn.setEnabled(True)

        if success:
            self._last_gcode_path = gcode_path
            self.status_label.setText(f"Slicing complete: {os.path.basename(gcode_path)}")
            self.status_label.setStyleSheet("color: green;")
            self.result_text.setText(info)
            self.result_text.setVisible(True)
            self.send_btn.setEnabled(True)
        else:
            self.status_label.setText(f"Slicing failed: {info}")
            self.status_label.setStyleSheet("color: red;")

    def _send_to_printer(self):
        if self._last_gcode_path and os.path.isfile(self._last_gcode_path):
            FreeCADGui.runCommand("WorkTrackCAM_MoonrakerPush")


class K2SliceTaskPanel:
    """FreeCAD task panel adapter."""

    def __init__(self):
        self.form = K2SlicePanel()

    def accept(self):
        FreeCADGui.Control.closeDialog()
        return True

    def reject(self):
        FreeCADGui.Control.closeDialog()
        return True


class CommandK2Slice:
    """Slice an STL for the Creality K2 Plus."""

    def GetResources(self):
        import pathlib
        icon = pathlib.Path(__file__).resolve().parent.parent / "icons" / "K2Plus.svg"
        return {
            "MenuText": "Slice for K2 Plus",
            "ToolTip": "Slice an STL file using CuraEngine with K2 Plus presets",
            "Pixmap": str(icon),
        }

    def IsActive(self):
        return True

    def Activated(self):
        panel = K2SliceTaskPanel()
        FreeCADGui.Control.showDialog(panel)


FreeCADGui.addCommand("WorkTrackCAM_K2Slice", CommandK2Slice())
