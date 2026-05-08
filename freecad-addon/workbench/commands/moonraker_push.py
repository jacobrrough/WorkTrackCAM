# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Jacob Rrough
#
# FreeCAD command: Upload G-code to K2 Plus via Moonraker and start print.

import os
import threading

import FreeCAD
import FreeCADGui
from PySide import QtCore, QtWidgets

from integration.moonraker.client import MoonrakerClient, MoonrakerConfig
from integration.moonraker.temp_validator import TempCeilings, validate_gcode_temps
from integration.safety.validation_pipeline import validate_post_output


class MoonrakerPushPanel(QtWidgets.QWidget):
    """Task panel for uploading G-code to the K2 Plus printer."""

    upload_complete = QtCore.Signal(bool, str)

    def __init__(self, parent=None):
        super().__init__(parent)
        layout = QtWidgets.QVBoxLayout(self)

        header = QtWidgets.QLabel("Send to K2 Plus")
        header.setStyleSheet("font-size: 14px; font-weight: bold;")
        layout.addWidget(header)

        # Printer URL
        url_layout = QtWidgets.QHBoxLayout()
        url_layout.addWidget(QtWidgets.QLabel("Printer URL:"))
        self.url_input = QtWidgets.QLineEdit("http://192.168.1.100:7125")
        url_layout.addWidget(self.url_input)
        layout.addLayout(url_layout)

        # G-code file selection
        file_layout = QtWidgets.QHBoxLayout()
        file_layout.addWidget(QtWidgets.QLabel("G-code:"))
        self.file_input = QtWidgets.QLineEdit()
        self.file_input.setPlaceholderText("Select a .gcode file...")
        file_layout.addWidget(self.file_input)
        self.browse_btn = QtWidgets.QPushButton("Browse...")
        self.browse_btn.clicked.connect(self._browse_file)
        file_layout.addWidget(self.browse_btn)
        layout.addLayout(file_layout)

        # Auto-start checkbox
        self.auto_start = QtWidgets.QCheckBox("Start print after upload")
        self.auto_start.setChecked(True)
        layout.addWidget(self.auto_start)

        # Status area
        self.status_label = QtWidgets.QLabel("Ready")
        self.status_label.setWordWrap(True)
        layout.addWidget(self.status_label)

        # Progress bar
        self.progress = QtWidgets.QProgressBar()
        self.progress.setRange(0, 100)
        self.progress.setValue(0)
        self.progress.setVisible(False)
        layout.addWidget(self.progress)

        # Validation results
        self.validation_text = QtWidgets.QTextEdit()
        self.validation_text.setReadOnly(True)
        self.validation_text.setMaximumHeight(80)
        self.validation_text.setVisible(False)
        layout.addWidget(self.validation_text)

        # Action buttons
        btn_layout = QtWidgets.QHBoxLayout()
        self.test_btn = QtWidgets.QPushButton("Test Connection")
        self.test_btn.clicked.connect(self._test_connection)
        btn_layout.addWidget(self.test_btn)

        self.upload_btn = QtWidgets.QPushButton("Validate && Upload")
        self.upload_btn.clicked.connect(self._validate_and_upload)
        self.upload_btn.setStyleSheet("font-weight: bold;")
        btn_layout.addWidget(self.upload_btn)
        layout.addLayout(btn_layout)

        layout.addStretch()

        self.upload_complete.connect(self._on_upload_complete)

    def _browse_file(self):
        path, _ = QtWidgets.QFileDialog.getOpenFileName(
            self, "Select G-code File", "", "G-code (*.gcode *.nc *.ngc);;All Files (*)"
        )
        if path:
            self.file_input.setText(path)

    def _get_client(self) -> MoonrakerClient:
        url = self.url_input.text().strip()
        return MoonrakerClient(MoonrakerConfig(base_url=url))

    def _test_connection(self):
        self.status_label.setText("Testing connection...")
        try:
            client = self._get_client()
            info = client.server_info()
            version = info.get("result", {}).get("software_version", "unknown")
            self.status_label.setText(f"Connected! Moonraker {version}")
            self.status_label.setStyleSheet("color: green;")
        except Exception as e:
            self.status_label.setText(f"Connection failed: {e}")
            self.status_label.setStyleSheet("color: red;")

    def _validate_and_upload(self):
        filepath = self.file_input.text().strip()
        if not filepath or not os.path.isfile(filepath):
            self.status_label.setText("Please select a valid G-code file")
            self.status_label.setStyleSheet("color: red;")
            return

        self.status_label.setText("Validating G-code...")
        self.status_label.setStyleSheet("")

        with open(filepath, "r") as f:
            gcode = f.read()

        result = validate_post_output(gcode, "Creality_K2_Plus")
        if not result.passed:
            self.validation_text.setVisible(True)
            self.validation_text.setText("\n".join(result.all_violations))
            self.status_label.setText("Validation FAILED — upload blocked")
            self.status_label.setStyleSheet("color: red;")
            return

        self.validation_text.setVisible(False)
        self.status_label.setText("Validation passed — uploading...")
        self.progress.setVisible(True)
        self.progress.setValue(10)
        self.upload_btn.setEnabled(False)

        filename = os.path.basename(filepath)
        auto_start = self.auto_start.isChecked()

        thread = threading.Thread(
            target=self._upload_worker,
            args=(filepath, filename, auto_start),
            daemon=True,
        )
        thread.start()

    def _upload_worker(self, filepath, filename, auto_start):
        try:
            client = self._get_client()
            client.upload_gcode(filepath, filename)

            if auto_start:
                client.start_print(filename)
                self.upload_complete.emit(True, f"Uploaded and started: {filename}")
            else:
                self.upload_complete.emit(True, f"Uploaded: {filename}")
        except Exception as e:
            self.upload_complete.emit(False, str(e))

    def _on_upload_complete(self, success, message):
        self.progress.setVisible(False)
        self.upload_btn.setEnabled(True)
        if success:
            self.status_label.setText(message)
            self.status_label.setStyleSheet("color: green;")
            self.progress.setValue(100)
        else:
            self.status_label.setText(f"Upload failed: {message}")
            self.status_label.setStyleSheet("color: red;")


class MoonrakerPushTaskPanel:
    """FreeCAD task panel adapter."""

    def __init__(self):
        self.form = MoonrakerPushPanel()

    def accept(self):
        FreeCADGui.Control.closeDialog()
        return True

    def reject(self):
        FreeCADGui.Control.closeDialog()
        return True


class CommandMoonrakerPush:
    """Upload G-code to K2 Plus via Moonraker."""

    def GetResources(self):
        return {
            "MenuText": "Send to K2 Plus",
            "ToolTip": "Validate and upload G-code to Creality K2 Plus via Moonraker",
        }

    def IsActive(self):
        return True

    def Activated(self):
        panel = MoonrakerPushTaskPanel()
        FreeCADGui.Control.showDialog(panel)


FreeCADGui.addCommand("WorkTrackCAM_MoonrakerPush", CommandMoonrakerPush())
