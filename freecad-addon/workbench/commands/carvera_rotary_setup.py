# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Jacob Rrough
#
# FreeCAD command: Carvera 4th axis rotary setup wizard.

import FreeCAD
import FreeCADGui
from PySide import QtCore, QtWidgets

from integration.carvera.rotary_ops import (
    RotaryStrategy,
    RotaryJobSetup,
    plan_operation,
    operation_to_gcode,
)
from integration.carvera.rotary_collision import (
    RotaryFixture,
    check_radial_clearance,
)


class RotarySetupPanel(QtWidgets.QWidget):
    """Task panel for setting up a Carvera 4th axis rotary job."""

    def __init__(self, parent=None):
        super().__init__(parent)
        layout = QtWidgets.QVBoxLayout(self)

        header = QtWidgets.QLabel("Carvera 4th Axis Setup")
        header.setStyleSheet("font-size: 14px; font-weight: bold;")
        layout.addWidget(header)

        # Stock dimensions
        stock_group = QtWidgets.QGroupBox("Stock")
        stock_layout = QtWidgets.QGridLayout(stock_group)

        stock_layout.addWidget(QtWidgets.QLabel("Diameter (mm):"), 0, 0)
        self.diameter = QtWidgets.QDoubleSpinBox()
        self.diameter.setRange(5, 92)
        self.diameter.setValue(50)
        stock_layout.addWidget(self.diameter, 0, 1)

        stock_layout.addWidget(QtWidgets.QLabel("Length (mm):"), 1, 0)
        self.length = QtWidgets.QDoubleSpinBox()
        self.length.setRange(5, 240)
        self.length.setValue(100)
        stock_layout.addWidget(self.length, 1, 1)

        layout.addWidget(stock_group)

        # Strategy selector
        strategy_layout = QtWidgets.QHBoxLayout()
        strategy_layout.addWidget(QtWidgets.QLabel("Strategy:"))
        self.strategy_combo = QtWidgets.QComboBox()
        for strat in RotaryStrategy:
            self.strategy_combo.addItem(strat.value.capitalize(), strat.value)
        strategy_layout.addWidget(self.strategy_combo)
        layout.addLayout(strategy_layout)

        # Machining parameters
        params_group = QtWidgets.QGroupBox("Parameters")
        params_layout = QtWidgets.QGridLayout(params_group)

        params_layout.addWidget(QtWidgets.QLabel("Depth (mm):"), 0, 0)
        self.depth = QtWidgets.QDoubleSpinBox()
        self.depth.setRange(0.1, 30)
        self.depth.setValue(3.0)
        params_layout.addWidget(self.depth, 0, 1)

        params_layout.addWidget(QtWidgets.QLabel("Stepover (mm):"), 1, 0)
        self.stepover = QtWidgets.QDoubleSpinBox()
        self.stepover.setRange(0.1, 10)
        self.stepover.setValue(1.0)
        params_layout.addWidget(self.stepover, 1, 1)

        params_layout.addWidget(QtWidgets.QLabel("Stepdown (mm):"), 2, 0)
        self.stepdown = QtWidgets.QDoubleSpinBox()
        self.stepdown.setRange(0.1, 10)
        self.stepdown.setValue(1.0)
        params_layout.addWidget(self.stepdown, 2, 1)

        params_layout.addWidget(QtWidgets.QLabel("Feed (mm/min):"), 3, 0)
        self.feed_rate = QtWidgets.QSpinBox()
        self.feed_rate.setRange(50, 2000)
        self.feed_rate.setValue(300)
        params_layout.addWidget(self.feed_rate, 3, 1)

        params_layout.addWidget(QtWidgets.QLabel("Spindle (RPM):"), 4, 0)
        self.spindle_rpm = QtWidgets.QSpinBox()
        self.spindle_rpm.setRange(6000, 15000)
        self.spindle_rpm.setValue(10000)
        params_layout.addWidget(self.spindle_rpm, 4, 1)

        layout.addWidget(params_group)

        # Collision check result
        self.collision_label = QtWidgets.QLabel("")
        self.collision_label.setWordWrap(True)
        layout.addWidget(self.collision_label)

        # Preview / plan info
        self.info_label = QtWidgets.QLabel("")
        self.info_label.setWordWrap(True)
        self.info_label.setStyleSheet("color: gray;")
        layout.addWidget(self.info_label)

        # Buttons
        btn_layout = QtWidgets.QHBoxLayout()
        self.check_btn = QtWidgets.QPushButton("Check Clearance")
        self.check_btn.clicked.connect(self._check_clearance)
        btn_layout.addWidget(self.check_btn)

        self.plan_btn = QtWidgets.QPushButton("Plan Operation")
        self.plan_btn.clicked.connect(self._plan_operation)
        self.plan_btn.setStyleSheet("font-weight: bold;")
        btn_layout.addWidget(self.plan_btn)
        layout.addLayout(btn_layout)

        layout.addStretch()

    def _get_setup(self) -> RotaryJobSetup:
        strat_value = self.strategy_combo.currentData()
        strategy = RotaryStrategy(strat_value)
        return RotaryJobSetup(
            stock_diameter_mm=self.diameter.value(),
            stock_length_mm=self.length.value(),
            spindle_rpm=self.spindle_rpm.value(),
            strategy=strategy,
            stepover_mm=self.stepover.value(),
            stepdown_mm=self.stepdown.value(),
            feed_rate_mm_min=self.feed_rate.value(),
        )

    def _check_clearance(self):
        fixture = RotaryFixture()
        radius = self.diameter.value() / 2.0
        clearance = check_radial_clearance(
            tool_x=10, tool_y=0, tool_z=radius + 3,
            tool_radius=3.175,
            fixture=fixture,
        )
        if clearance > 0:
            self.collision_label.setText(f"Clearance OK: {clearance:.1f}mm from chuck")
            self.collision_label.setStyleSheet("color: green;")
        else:
            self.collision_label.setText(f"COLLISION: {abs(clearance):.1f}mm into chuck zone")
            self.collision_label.setStyleSheet("color: red;")

    def _plan_operation(self):
        setup = self._get_setup()
        depth = self.depth.value()
        op = plan_operation(setup, depth)
        self.info_label.setText(
            f"Strategy: {op.strategy.value}\n"
            f"Passes: {len(op.passes)}\n"
            f"Ready to generate G-code"
        )
        FreeCAD.Console.PrintMessage(
            f"WorkTrackCAM: Planned {op.strategy.value} with {len(op.passes)} passes\n"
        )


class RotarySetupTaskPanel:
    """FreeCAD task panel adapter."""

    def __init__(self):
        self.form = RotarySetupPanel()

    def accept(self):
        FreeCADGui.Control.closeDialog()
        return True

    def reject(self):
        FreeCADGui.Control.closeDialog()
        return True


class CommandRotarySetup:
    """Carvera 4th axis rotary job setup."""

    def GetResources(self):
        import pathlib
        icon = pathlib.Path(__file__).resolve().parent.parent / "icons" / "Carvera.svg"
        return {
            "MenuText": "4th Axis Setup",
            "ToolTip": "Set up a 4th axis rotary job for Makera Carvera",
            "Pixmap": str(icon),
        }

    def IsActive(self):
        return True

    def Activated(self):
        panel = RotarySetupTaskPanel()
        FreeCADGui.Control.showDialog(panel)


FreeCADGui.addCommand("WorkTrackCAM_RotarySetup", CommandRotarySetup())
