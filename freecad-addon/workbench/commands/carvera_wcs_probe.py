# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Jacob Rrough
#
# FreeCAD command: WCS probing setup for Makera Carvera.

import FreeCAD
import FreeCADGui
from PySide import QtCore, QtWidgets

from integration.carvera.wcs_probing import (
    ProbeConfig,
    generate_z_probe,
    generate_xy_probe_corner,
    generate_full_wcs_probe,
    generate_tool_probe_with_atc,
)


class WcsProbePanel(QtWidgets.QWidget):
    """Task panel for configuring and generating WCS probe sequences."""

    def __init__(self, parent=None):
        super().__init__(parent)
        layout = QtWidgets.QVBoxLayout(self)

        header = QtWidgets.QLabel("Carvera WCS Probing")
        header.setStyleSheet("font-size: 14px; font-weight: bold;")
        layout.addWidget(header)

        info = QtWidgets.QLabel("Generate G38.2 probe sequences for workpiece setup:")
        info.setStyleSheet("color: gray; margin-bottom: 8px;")
        info.setWordWrap(True)
        layout.addWidget(info)

        # Probe type
        type_layout = QtWidgets.QHBoxLayout()
        type_layout.addWidget(QtWidgets.QLabel("Probe Type:"))
        self.type_combo = QtWidgets.QComboBox()
        self.type_combo.addItem("Z Only (top surface)", "z")
        self.type_combo.addItem("XY Corner", "xy")
        self.type_combo.addItem("Full WCS (Z + XY)", "full")
        self.type_combo.addItem("Tool Length (ATC)", "tool")
        self.type_combo.currentIndexChanged.connect(self._on_type_change)
        type_layout.addWidget(self.type_combo)
        layout.addLayout(type_layout)

        # Corner selection
        corner_layout = QtWidgets.QHBoxLayout()
        corner_layout.addWidget(QtWidgets.QLabel("Corner:"))
        self.corner_combo = QtWidgets.QComboBox()
        self.corner_combo.addItem("Front Left", "front_left")
        self.corner_combo.addItem("Front Right", "front_right")
        self.corner_combo.addItem("Back Left", "back_left")
        self.corner_combo.addItem("Back Right", "back_right")
        corner_layout.addWidget(self.corner_combo)
        layout.addLayout(corner_layout)

        # Feed rates
        feed_group = QtWidgets.QGroupBox("Feed Rates")
        feed_layout = QtWidgets.QFormLayout(feed_group)
        self.fast_feed = QtWidgets.QDoubleSpinBox()
        self.fast_feed.setRange(10, 500)
        self.fast_feed.setValue(200)
        self.fast_feed.setSuffix(" mm/min")
        feed_layout.addRow("Fast probe:", self.fast_feed)
        self.slow_feed = QtWidgets.QDoubleSpinBox()
        self.slow_feed.setRange(5, 200)
        self.slow_feed.setValue(50)
        self.slow_feed.setSuffix(" mm/min")
        feed_layout.addRow("Slow probe:", self.slow_feed)
        layout.addWidget(feed_group)

        # Parameters
        param_group = QtWidgets.QGroupBox("Parameters")
        param_layout = QtWidgets.QFormLayout(param_group)
        self.safe_z = QtWidgets.QDoubleSpinBox()
        self.safe_z.setRange(5, 200)
        self.safe_z.setValue(50)
        self.safe_z.setSuffix(" mm")
        param_layout.addRow("Safe Z:", self.safe_z)
        self.z_offset = QtWidgets.QDoubleSpinBox()
        self.z_offset.setRange(-50, 50)
        self.z_offset.setValue(0)
        self.z_offset.setSuffix(" mm")
        param_layout.addRow("Z offset:", self.z_offset)
        self.stock_thickness = QtWidgets.QDoubleSpinBox()
        self.stock_thickness.setRange(0, 150)
        self.stock_thickness.setValue(0)
        self.stock_thickness.setSuffix(" mm")
        param_layout.addRow("Stock thickness:", self.stock_thickness)
        self.two_pass = QtWidgets.QCheckBox("Two-pass probe (fast + slow)")
        self.two_pass.setChecked(True)
        param_layout.addRow(self.two_pass)
        self.tool_number = QtWidgets.QSpinBox()
        self.tool_number.setRange(1, 6)
        self.tool_number.setValue(1)
        param_layout.addRow("Tool # (ATC):", self.tool_number)
        layout.addWidget(param_group)

        # Generate button
        self.gen_btn = QtWidgets.QPushButton("Generate Probe G-code")
        self.gen_btn.setStyleSheet("font-weight: bold;")
        self.gen_btn.clicked.connect(self._generate)
        layout.addWidget(self.gen_btn)

        # Output
        self.output = QtWidgets.QPlainTextEdit()
        self.output.setReadOnly(True)
        self.output.setMaximumHeight(200)
        layout.addWidget(self.output)

        # Copy button
        self.copy_btn = QtWidgets.QPushButton("Copy to Clipboard")
        self.copy_btn.clicked.connect(self._copy)
        layout.addWidget(self.copy_btn)

        layout.addStretch()
        self._on_type_change()

    def _on_type_change(self):
        probe_type = self.type_combo.currentData()
        self.corner_combo.setEnabled(probe_type in ("xy", "full"))
        self.z_offset.setEnabled(probe_type in ("z", "full"))
        self.stock_thickness.setEnabled(probe_type in ("xy", "full"))
        self.two_pass.setEnabled(probe_type in ("z", "full"))
        self.tool_number.setEnabled(probe_type == "tool")

    def _build_config(self) -> ProbeConfig:
        return ProbeConfig(
            fast_probe_feed=self.fast_feed.value(),
            slow_probe_feed=self.slow_feed.value(),
            safe_z_mm=self.safe_z.value(),
            use_two_pass=self.two_pass.isChecked(),
        )

    def _generate(self):
        config = self._build_config()
        probe_type = self.type_combo.currentData()
        corner = self.corner_combo.currentData()

        if probe_type == "z":
            lines = generate_z_probe(config, self.z_offset.value())
        elif probe_type == "xy":
            lines = generate_xy_probe_corner(config, corner, self.stock_thickness.value())
        elif probe_type == "full":
            lines = generate_full_wcs_probe(
                config, corner, self.z_offset.value(), self.stock_thickness.value()
            )
        elif probe_type == "tool":
            lines = generate_tool_probe_with_atc(self.tool_number.value(), config)
        else:
            lines = []

        self.output.setPlainText("\n".join(lines))
        FreeCAD.Console.PrintMessage(
            f"WorkTrackCAM: Generated {probe_type} probe sequence ({len(lines)} lines)\n"
        )

    def _copy(self):
        text = self.output.toPlainText()
        if text:
            QtWidgets.QApplication.clipboard().setText(text)
            FreeCAD.Console.PrintMessage("WorkTrackCAM: Probe G-code copied to clipboard\n")


class WcsProbeTaskPanel:
    """FreeCAD task panel adapter."""

    def __init__(self):
        self.form = WcsProbePanel()

    def accept(self):
        FreeCADGui.Control.closeDialog()
        return True

    def reject(self):
        FreeCADGui.Control.closeDialog()
        return True


class CommandWcsProbe:
    """Generate WCS probing sequences for Makera Carvera."""

    def GetResources(self):
        import pathlib
        icon = pathlib.Path(__file__).resolve().parent.parent / "icons" / "Carvera.svg"
        return {
            "MenuText": "WCS Probing",
            "ToolTip": "Generate G38.2 probing sequences for workpiece coordinate setup",
            "Pixmap": str(icon),
        }

    def IsActive(self):
        return True

    def Activated(self):
        panel = WcsProbeTaskPanel()
        FreeCADGui.Control.showDialog(panel)


FreeCADGui.addCommand("WorkTrackCAM_WcsProbe", CommandWcsProbe())
