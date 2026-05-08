# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Jacob Rrough
#
# FreeCAD command: G-code safety validation for post-processed output.

import pathlib

import FreeCAD
import FreeCADGui
from PySide import QtWidgets

from integration.safety.validation_pipeline import validate_post_output, MACHINE_DIALECTS

_icon_dir = pathlib.Path(__file__).resolve().parent.parent / "icons"


class GcodeValidatePanel(QtWidgets.QWidget):
    """Task panel for validating G-code against machine safety rules."""

    def __init__(self, parent=None):
        super().__init__(parent)
        layout = QtWidgets.QVBoxLayout(self)

        header = QtWidgets.QLabel("G-code Safety Validation")
        header.setStyleSheet("font-size: 14px; font-weight: bold;")
        layout.addWidget(header)

        info = QtWidgets.QLabel(
            "Validate post-processed G-code against dialect rules, "
            "header/end invariants, safe-Z retracts, and temperature ceilings."
        )
        info.setWordWrap(True)
        info.setStyleSheet("color: gray; margin-bottom: 8px;")
        layout.addWidget(info)

        # Machine selector
        machine_layout = QtWidgets.QHBoxLayout()
        machine_layout.addWidget(QtWidgets.QLabel("Machine:"))
        self.machine_combo = QtWidgets.QComboBox()
        for mid in MACHINE_DIALECTS:
            self.machine_combo.addItem(mid)
        machine_layout.addWidget(self.machine_combo)
        layout.addLayout(machine_layout)

        # File selector
        file_layout = QtWidgets.QHBoxLayout()
        file_layout.addWidget(QtWidgets.QLabel("G-code file:"))
        self.file_path = QtWidgets.QLineEdit()
        self.file_path.setPlaceholderText("Select a .gcode or .nc file...")
        file_layout.addWidget(self.file_path)
        browse_btn = QtWidgets.QPushButton("Browse...")
        browse_btn.clicked.connect(self._browse)
        file_layout.addWidget(browse_btn)
        layout.addLayout(file_layout)

        # Or paste G-code directly
        self.gcode_input = QtWidgets.QPlainTextEdit()
        self.gcode_input.setPlaceholderText("Or paste G-code here...")
        self.gcode_input.setMaximumHeight(150)
        layout.addWidget(self.gcode_input)

        # Validate button
        self.validate_btn = QtWidgets.QPushButton("Validate")
        self.validate_btn.setStyleSheet("font-weight: bold;")
        self.validate_btn.clicked.connect(self._validate)
        layout.addWidget(self.validate_btn)

        # Results
        self.results = QtWidgets.QPlainTextEdit()
        self.results.setReadOnly(True)
        self.results.setMaximumHeight(200)
        layout.addWidget(self.results)

        layout.addStretch()

    def _browse(self):
        path, _ = QtWidgets.QFileDialog.getOpenFileName(
            self,
            "Select G-code File",
            "",
            "G-code (*.gcode *.nc *.ngc *.tap *.mmg);;All files (*)",
        )
        if path:
            self.file_path.setText(path)

    def _get_gcode(self) -> str:
        path = self.file_path.text().strip()
        if path:
            try:
                with open(path, "r") as f:
                    return f.read()
            except Exception as e:
                self.results.setPlainText(f"Error reading file: {e}")
                return ""

        text = self.gcode_input.toPlainText().strip()
        if text:
            return text

        self.results.setPlainText("No G-code provided. Browse for a file or paste G-code above.")
        return ""

    def _validate(self):
        gcode = self._get_gcode()
        if not gcode:
            return

        machine_id = self.machine_combo.currentText()
        result = validate_post_output(gcode, machine_id)

        lines = []
        if result.passed:
            lines.append("PASSED — All safety checks passed.")
        else:
            lines.append("FAILED — Safety violations found:")

        for check in result.checks:
            status = "PASS" if check.passed else "FAIL"
            lines.append(f"\n  [{status}] {check.name}")
            for v in check.violations:
                lines.append(f"    - {v}")

        if result.temp_violations:
            lines.append(f"\n  Temperature violations:")
            for tv in result.temp_violations:
                lines.append(
                    f"    - {tv.component}: {tv.actual_temp}°C exceeds "
                    f"ceiling {tv.ceiling_temp}°C (line {tv.line_number})"
                )

        self.results.setPlainText("\n".join(lines))

        log_status = "passed" if result.passed else "FAILED"
        FreeCAD.Console.PrintMessage(
            f"WorkTrackCAM: G-code validation {log_status} for {machine_id}\n"
        )


class GcodeValidateTaskPanel:
    """FreeCAD task panel adapter."""

    def __init__(self):
        self.form = GcodeValidatePanel()

    def accept(self):
        FreeCADGui.Control.closeDialog()
        return True

    def reject(self):
        FreeCADGui.Control.closeDialog()
        return True


class CommandGcodeValidate:
    """Validate G-code against machine safety rules."""

    def GetResources(self):
        return {
            "MenuText": "Validate G-code",
            "ToolTip": "Check post-processed G-code for safety violations",
            "Pixmap": str(_icon_dir / "WorkTrackCAM.svg"),
        }

    def IsActive(self):
        return True

    def Activated(self):
        panel = GcodeValidateTaskPanel()
        FreeCADGui.Control.showDialog(panel)


FreeCADGui.addCommand("WorkTrackCAM_GcodeValidate", CommandGcodeValidate())
