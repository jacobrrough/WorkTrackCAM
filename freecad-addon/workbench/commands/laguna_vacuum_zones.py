# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Jacob Rrough
#
# FreeCAD command: Vacuum zone allocation panel for Laguna Swift 5x10.
# Shows a 2x3 grid representing the vacuum table zones with engagement status.

import FreeCAD
import FreeCADGui
from PySide import QtCore, QtWidgets, QtGui

from integration.laguna.vacuum_allocator import (
    allocate_zones,
    engaged_zone_indices,
    BED_WIDTH_MM,
    BED_LENGTH_MM,
    ZONE_COLS,
    ZONE_ROWS,
    ZONE_WIDTH,
    ZONE_LENGTH,
    SHEET_PRESETS,
)
from integration.laguna.vacuum_postlude import generate_vacuum_on, generate_vacuum_off


class VacuumZoneGrid(QtWidgets.QWidget):
    """Visual 2x3 grid representation of the Laguna vacuum zones."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self._zones_engaged = [False] * 6
        self._zone_coverage = [0.0] * 6
        self.setMinimumSize(200, 300)

    def set_allocations(self, allocations):
        for alloc in allocations:
            if 0 <= alloc.zone_index < 6:
                self._zones_engaged[alloc.zone_index] = alloc.engaged
                self._zone_coverage[alloc.zone_index] = alloc.coverage_fraction
        self.update()

    def paintEvent(self, event):
        painter = QtGui.QPainter(self)
        painter.setRenderHint(QtGui.QPainter.Antialiasing)

        w = self.width() - 20
        h = self.height() - 20
        cell_w = w / ZONE_COLS
        cell_h = h / ZONE_ROWS

        for row in range(ZONE_ROWS):
            for col in range(ZONE_COLS):
                idx = row * ZONE_COLS + col
                x = 10 + col * cell_w
                y = 10 + row * cell_h

                rect = QtCore.QRectF(x, y, cell_w - 2, cell_h - 2)

                if self._zones_engaged[idx]:
                    green = int(100 + 155 * self._zone_coverage[idx])
                    painter.setBrush(QtGui.QColor(50, green, 50))
                else:
                    painter.setBrush(QtGui.QColor(80, 80, 80))

                painter.setPen(QtGui.QPen(QtGui.QColor(200, 200, 200), 2))
                painter.drawRoundedRect(rect, 4, 4)

                painter.setPen(QtGui.QColor(255, 255, 255))
                label = f"Zone {idx}\n{self._zone_coverage[idx]*100:.0f}%"
                painter.drawText(rect, QtCore.Qt.AlignCenter, label)

        painter.end()


class VacuumZonePanel(QtWidgets.QWidget):
    """Task panel for vacuum zone allocation."""

    def __init__(self, parent=None):
        super().__init__(parent)
        layout = QtWidgets.QVBoxLayout(self)

        header = QtWidgets.QLabel("Laguna Vacuum Zones")
        header.setStyleSheet("font-size: 14px; font-weight: bold;")
        layout.addWidget(header)

        # Stock dimensions
        dims_group = QtWidgets.QGroupBox("Stock Placement")
        dims_layout = QtWidgets.QGridLayout(dims_group)

        dims_layout.addWidget(QtWidgets.QLabel("Origin X (mm):"), 0, 0)
        self.origin_x = QtWidgets.QDoubleSpinBox()
        self.origin_x.setRange(0, BED_WIDTH_MM)
        self.origin_x.setValue(0)
        dims_layout.addWidget(self.origin_x, 0, 1)

        dims_layout.addWidget(QtWidgets.QLabel("Origin Y (mm):"), 1, 0)
        self.origin_y = QtWidgets.QDoubleSpinBox()
        self.origin_y.setRange(0, BED_LENGTH_MM)
        self.origin_y.setValue(0)
        dims_layout.addWidget(self.origin_y, 1, 1)

        dims_layout.addWidget(QtWidgets.QLabel("Width (mm):"), 2, 0)
        self.stock_width = QtWidgets.QDoubleSpinBox()
        self.stock_width.setRange(0, BED_WIDTH_MM)
        self.stock_width.setValue(1219.2)
        dims_layout.addWidget(self.stock_width, 2, 1)

        dims_layout.addWidget(QtWidgets.QLabel("Length (mm):"), 3, 0)
        self.stock_length = QtWidgets.QDoubleSpinBox()
        self.stock_length.setRange(0, BED_LENGTH_MM)
        self.stock_length.setValue(2438.4)
        dims_layout.addWidget(self.stock_length, 3, 1)

        layout.addWidget(dims_group)

        # Sheet presets
        preset_layout = QtWidgets.QHBoxLayout()
        preset_layout.addWidget(QtWidgets.QLabel("Preset:"))
        self.preset_combo = QtWidgets.QComboBox()
        self.preset_combo.addItem("Custom", "custom")
        self.preset_combo.addItem("Full 4'x8'", "full_4x8")
        self.preset_combo.addItem("Half 4'x4'", "half_4x4")
        self.preset_combo.addItem("Quarter 2'x4'", "quarter_2x4")
        self.preset_combo.addItem("Full 5'x10'", "full_5x10")
        self.preset_combo.currentIndexChanged.connect(self._on_preset_changed)
        preset_layout.addWidget(self.preset_combo)
        layout.addLayout(preset_layout)

        # Zone grid visualization
        self.zone_grid = VacuumZoneGrid()
        layout.addWidget(self.zone_grid)

        # G-code output
        self.gcode_output = QtWidgets.QTextEdit()
        self.gcode_output.setReadOnly(True)
        self.gcode_output.setMaximumHeight(80)
        self.gcode_output.setFont(QtGui.QFont("Consolas", 9))
        layout.addWidget(self.gcode_output)

        # Calculate button
        self.calc_btn = QtWidgets.QPushButton("Calculate Zones")
        self.calc_btn.clicked.connect(self._calculate)
        self.calc_btn.setStyleSheet("font-weight: bold;")
        layout.addWidget(self.calc_btn)

        layout.addStretch()

        self._calculate()

    def _on_preset_changed(self, index):
        key = self.preset_combo.currentData()
        if key and key != "custom" and key in SHEET_PRESETS:
            w, l = SHEET_PRESETS[key]
            self.stock_width.setValue(w)
            self.stock_length.setValue(l)
            self.origin_x.setValue(0)
            self.origin_y.setValue(0)
            self._calculate()

    def _calculate(self):
        allocations = allocate_zones(
            self.origin_x.value(),
            self.origin_y.value(),
            self.stock_width.value(),
            self.stock_length.value(),
        )
        self.zone_grid.set_allocations(allocations)
        engaged = engaged_zone_indices(allocations)

        on_code = generate_vacuum_on(engaged)
        off_code = generate_vacuum_off(engaged)
        self.gcode_output.setText(f"{on_code}\n\n{off_code}")

        FreeCAD.Console.PrintMessage(
            f"WorkTrackCAM: Vacuum zones engaged: {engaged}\n"
        )


class VacuumZoneTaskPanel:
    """FreeCAD task panel adapter."""

    def __init__(self):
        self.form = VacuumZonePanel()

    def accept(self):
        FreeCADGui.Control.closeDialog()
        return True

    def reject(self):
        FreeCADGui.Control.closeDialog()
        return True


class CommandVacuumZones:
    """Laguna Swift 5x10 vacuum zone allocation."""

    def GetResources(self):
        return {
            "MenuText": "Vacuum Zones",
            "ToolTip": "Allocate vacuum table zones for Laguna Swift 5×10 stock placement",
        }

    def IsActive(self):
        return True

    def Activated(self):
        panel = VacuumZoneTaskPanel()
        FreeCADGui.Control.showDialog(panel)


FreeCADGui.addCommand("WorkTrackCAM_VacuumZones", CommandVacuumZones())
