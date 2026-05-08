# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Jacob Rrough
#
# FreeCAD command: Carvera ATC (Automatic Tool Changer) sequencing panel.

import FreeCAD
import FreeCADGui
from PySide import QtCore, QtWidgets

from integration.carvera.atc_sequencer import (
    AtcCapability,
    ToolSlot,
    sequence_multi_tool_job,
)


class AtcSequencerPanel(QtWidgets.QWidget):
    """Task panel for configuring multi-tool ATC sequences."""

    def __init__(self, parent=None):
        super().__init__(parent)
        layout = QtWidgets.QVBoxLayout(self)

        header = QtWidgets.QLabel("Carvera ATC Sequencer")
        header.setStyleSheet("font-size: 14px; font-weight: bold;")
        layout.addWidget(header)

        # ATC configuration
        atc_group = QtWidgets.QGroupBox("ATC Configuration")
        atc_layout = QtWidgets.QGridLayout(atc_group)

        atc_layout.addWidget(QtWidgets.QLabel("Slot count:"), 0, 0)
        self.slot_count = QtWidgets.QSpinBox()
        self.slot_count.setRange(1, 6)
        self.slot_count.setValue(6)
        atc_layout.addWidget(self.slot_count, 0, 1)

        self.tlc_check = QtWidgets.QCheckBox("Tool length compensation (G43)")
        self.tlc_check.setChecked(True)
        atc_layout.addWidget(self.tlc_check, 1, 0, 1, 2)

        self.probe_check = QtWidgets.QCheckBox("Wireless probe (T0, G38.2)")
        self.probe_check.setChecked(True)
        atc_layout.addWidget(self.probe_check, 2, 0, 1, 2)

        layout.addWidget(atc_group)

        # Tool order
        order_group = QtWidgets.QGroupBox("Tool Order")
        order_layout = QtWidgets.QVBoxLayout(order_group)

        self.tool_list = QtWidgets.QListWidget()
        self.tool_list.setMaximumHeight(120)
        order_layout.addWidget(self.tool_list)

        tool_btn_layout = QtWidgets.QHBoxLayout()
        self.add_tool_spin = QtWidgets.QSpinBox()
        self.add_tool_spin.setRange(1, 6)
        self.add_tool_spin.setValue(1)
        tool_btn_layout.addWidget(self.add_tool_spin)

        self.add_btn = QtWidgets.QPushButton("Add Tool")
        self.add_btn.clicked.connect(self._add_tool)
        tool_btn_layout.addWidget(self.add_btn)

        self.clear_btn = QtWidgets.QPushButton("Clear")
        self.clear_btn.clicked.connect(self._clear_tools)
        tool_btn_layout.addWidget(self.clear_btn)

        order_layout.addLayout(tool_btn_layout)
        layout.addWidget(order_group)

        # Sequence output
        self.output_text = QtWidgets.QTextEdit()
        self.output_text.setReadOnly(True)
        self.output_text.setMaximumHeight(150)
        self.output_text.setFont(QtWidgets.QApplication.font())
        layout.addWidget(self.output_text)

        # Generate button
        self.gen_btn = QtWidgets.QPushButton("Generate Sequence")
        self.gen_btn.clicked.connect(self._generate)
        self.gen_btn.setStyleSheet("font-weight: bold;")
        layout.addWidget(self.gen_btn)

        layout.addStretch()

        self._tool_order: list = []

    def _add_tool(self):
        tool_num = self.add_tool_spin.value()
        self._tool_order.append(tool_num)
        self.tool_list.addItem(f"T{tool_num}")

    def _clear_tools(self):
        self._tool_order.clear()
        self.tool_list.clear()

    def _generate(self):
        if not self._tool_order:
            self.output_text.setText("Add at least one tool to the sequence.")
            return

        atc = AtcCapability(
            slot_count=self.slot_count.value(),
            has_tool_length_comp=self.tlc_check.isChecked(),
            has_wireless_probe=self.probe_check.isChecked(),
        )

        blocks = sequence_multi_tool_job(self._tool_order, atc)
        lines = []
        for block in blocks:
            lines.append(f"; --- Tool change to T{block.tool_number} (slot {block.slot_number}) ---")
            lines.extend(block.gcode_lines)
            lines.append("")

        self.output_text.setText("\n".join(lines))
        FreeCAD.Console.PrintMessage(
            f"WorkTrackCAM: Generated {len(blocks)} tool change blocks\n"
        )


class AtcSequencerTaskPanel:
    """FreeCAD task panel adapter."""

    def __init__(self):
        self.form = AtcSequencerPanel()

    def accept(self):
        FreeCADGui.Control.closeDialog()
        return True

    def reject(self):
        FreeCADGui.Control.closeDialog()
        return True


class CommandAtcSequencer:
    """Carvera ATC multi-tool sequencing."""

    def GetResources(self):
        return {
            "MenuText": "ATC Sequencer",
            "ToolTip": "Configure multi-tool ATC sequences for Makera Carvera",
        }

    def IsActive(self):
        return True

    def Activated(self):
        panel = AtcSequencerTaskPanel()
        FreeCADGui.Control.showDialog(panel)


FreeCADGui.addCommand("WorkTrackCAM_AtcSequencer", CommandAtcSequencer())
