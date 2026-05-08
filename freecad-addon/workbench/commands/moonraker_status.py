# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Jacob Rrough
#
# FreeCAD command: Poll K2 Plus printer status via Moonraker.

import threading

import FreeCAD
import FreeCADGui
from PySide import QtCore, QtWidgets

from integration.moonraker.client import MoonrakerClient, MoonrakerConfig


class PrinterStatusPanel(QtWidgets.QWidget):
    """Task panel showing live printer status from Moonraker."""

    status_updated = QtCore.Signal(dict)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._polling = False
        self._timer = QtCore.QTimer(self)
        self._timer.timeout.connect(self._poll)

        layout = QtWidgets.QVBoxLayout(self)

        header = QtWidgets.QLabel("K2 Plus Status")
        header.setStyleSheet("font-size: 14px; font-weight: bold;")
        layout.addWidget(header)

        # Printer URL
        url_layout = QtWidgets.QHBoxLayout()
        url_layout.addWidget(QtWidgets.QLabel("URL:"))
        self.url_input = QtWidgets.QLineEdit("http://192.168.1.100:7125")
        url_layout.addWidget(self.url_input)
        layout.addLayout(url_layout)

        # Status grid
        grid = QtWidgets.QGridLayout()
        self.state_label = QtWidgets.QLabel("--")
        self.nozzle_label = QtWidgets.QLabel("--")
        self.bed_label = QtWidgets.QLabel("--")
        self.progress_label = QtWidgets.QLabel("--")
        self.filename_label = QtWidgets.QLabel("--")

        grid.addWidget(QtWidgets.QLabel("State:"), 0, 0)
        grid.addWidget(self.state_label, 0, 1)
        grid.addWidget(QtWidgets.QLabel("Nozzle:"), 1, 0)
        grid.addWidget(self.nozzle_label, 1, 1)
        grid.addWidget(QtWidgets.QLabel("Bed:"), 2, 0)
        grid.addWidget(self.bed_label, 2, 1)
        grid.addWidget(QtWidgets.QLabel("Progress:"), 3, 0)
        grid.addWidget(self.progress_label, 3, 1)
        grid.addWidget(QtWidgets.QLabel("File:"), 4, 0)
        grid.addWidget(self.filename_label, 4, 1)
        layout.addLayout(grid)

        # Progress bar
        self.progress_bar = QtWidgets.QProgressBar()
        self.progress_bar.setRange(0, 100)
        layout.addWidget(self.progress_bar)

        # Error display
        self.error_label = QtWidgets.QLabel("")
        self.error_label.setStyleSheet("color: red;")
        self.error_label.setWordWrap(True)
        self.error_label.setVisible(False)
        layout.addWidget(self.error_label)

        # Buttons
        btn_layout = QtWidgets.QHBoxLayout()
        self.start_btn = QtWidgets.QPushButton("Start Polling")
        self.start_btn.clicked.connect(self._toggle_polling)
        btn_layout.addWidget(self.start_btn)
        layout.addLayout(btn_layout)

        layout.addStretch()

        self.status_updated.connect(self._update_display)

    def _get_client(self) -> MoonrakerClient:
        url = self.url_input.text().strip()
        return MoonrakerClient(MoonrakerConfig(base_url=url))

    def _toggle_polling(self):
        if self._polling:
            self._timer.stop()
            self._polling = False
            self.start_btn.setText("Start Polling")
            self.url_input.setEnabled(True)
        else:
            self._polling = True
            self.start_btn.setText("Stop Polling")
            self.url_input.setEnabled(False)
            self._poll()
            self._timer.start(3000)

    def _poll(self):
        thread = threading.Thread(target=self._poll_worker, daemon=True)
        thread.start()

    def _poll_worker(self):
        try:
            client = self._get_client()
            data = client.printer_status()
            self.status_updated.emit(data)
        except Exception as e:
            self.status_updated.emit({"error": str(e)})

    def _update_display(self, data):
        if "error" in data:
            self.error_label.setText(str(data["error"]))
            self.error_label.setVisible(True)
            return

        self.error_label.setVisible(False)
        result = data.get("result", {}).get("status", {})

        extruder = result.get("extruder", {})
        bed = result.get("heater_bed", {})
        stats = result.get("print_stats", {})

        nozzle_temp = extruder.get("temperature", 0)
        nozzle_target = extruder.get("target", 0)
        bed_temp = bed.get("temperature", 0)
        bed_target = bed.get("target", 0)
        state = stats.get("state", "unknown")
        filename = stats.get("filename", "")
        progress = stats.get("progress", 0)

        self.state_label.setText(state.capitalize())
        self.nozzle_label.setText(f"{nozzle_temp:.1f} / {nozzle_target:.0f} C")
        self.bed_label.setText(f"{bed_temp:.1f} / {bed_target:.0f} C")
        self.progress_label.setText(f"{progress * 100:.1f}%")
        self.progress_bar.setValue(int(progress * 100))
        self.filename_label.setText(filename or "--")

        if state == "printing":
            self.state_label.setStyleSheet("color: green; font-weight: bold;")
        elif state == "error":
            self.state_label.setStyleSheet("color: red; font-weight: bold;")
        else:
            self.state_label.setStyleSheet("")


class PrinterStatusTaskPanel:
    """FreeCAD task panel adapter."""

    def __init__(self):
        self.form = PrinterStatusPanel()

    def accept(self):
        self.form._timer.stop()
        FreeCADGui.Control.closeDialog()
        return True

    def reject(self):
        self.form._timer.stop()
        FreeCADGui.Control.closeDialog()
        return True


class CommandMoonrakerStatus:
    """Monitor K2 Plus printer status via Moonraker."""

    def GetResources(self):
        return {
            "MenuText": "K2 Plus Status",
            "ToolTip": "Monitor Creality K2 Plus printer temperature and print progress",
        }

    def IsActive(self):
        return True

    def Activated(self):
        panel = PrinterStatusTaskPanel()
        FreeCADGui.Control.showDialog(panel)


FreeCADGui.addCommand("WorkTrackCAM_MoonrakerStatus", CommandMoonrakerStatus())
