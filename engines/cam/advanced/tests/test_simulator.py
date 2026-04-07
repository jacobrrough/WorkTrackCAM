"""Tests for toolpath simulator."""
from __future__ import annotations

import pytest

from ..models import (
    ToolpathResult, ToolpathChain, MotionSegment,
    MachineKinematics, StockDefinition,
)
from ..simulator import simulate, SimulationReport


def _make_result(chains: list[ToolpathChain]) -> ToolpathResult:
    return ToolpathResult(chains=chains)


class TestSimulate:
    def test_safe_toolpath(self):
        chain = ToolpathChain()
        chain.append_rapid(0, 0, 10)
        chain.append_rapid(5, 5, 10)
        chain.append_feed(5, 5, 0, 400)
        chain.append_feed(10, 5, 0, 1000)
        chain.append_rapid(10, 5, 10)

        result = _make_result([chain])
        machine = MachineKinematics(x_travel_mm=300, y_travel_mm=200, z_travel_mm=100)
        stock = StockDefinition(x_min=0, x_max=20, y_min=0, y_max=20, z_min=-10, z_max=0)

        report = simulate(result, machine, stock, safe_z=10)
        assert report.is_safe
        assert report.error_count == 0
        assert report.total_moves == 5
        assert report.rapid_moves == 3
        assert report.feed_moves == 2

    def test_z_envelope_violation(self):
        chain = ToolpathChain()
        chain.append_rapid(0, 0, 10)
        chain.append_feed(0, 0, -200, 400)  # way below Z travel

        result = _make_result([chain])
        machine = MachineKinematics(z_travel_mm=100)
        stock = StockDefinition()

        report = simulate(result, machine, stock)
        assert not report.is_safe
        assert report.error_count > 0

    def test_rapid_through_stock(self):
        chain = ToolpathChain()
        chain.append_rapid(0, 0, -5)  # start below stock top at origin
        chain.append_rapid(50, 50, -5)  # rapid XY while below stock top

        result = _make_result([chain])
        machine = MachineKinematics()
        stock = StockDefinition(x_min=0, x_max=100, y_min=0, y_max=100, z_min=-20, z_max=0)

        report = simulate(result, machine, stock, safe_z=10)
        assert report.error_count > 0
        assert any("crash" in i.message.lower() or "rapid" in i.message.lower()
                    for i in report.issues)

    def test_excessive_feed_warning(self):
        chain = ToolpathChain()
        chain.append_feed(10, 10, 0, 99999)  # absurd feed rate

        result = _make_result([chain])
        machine = MachineKinematics(max_feed_mm_min=5000)
        stock = StockDefinition()

        report = simulate(result, machine, stock)
        assert report.warning_count > 0

    def test_empty_toolpath(self):
        result = _make_result([])
        machine = MachineKinematics()
        stock = StockDefinition()

        report = simulate(result, machine, stock)
        assert report.is_safe
        assert report.total_moves == 0

    def test_stats_tracking(self):
        chain = ToolpathChain()
        chain.append_rapid(0, 0, 10)
        chain.append_feed(0, 0, -5, 400)
        chain.append_feed(10, 0, -5, 1000)

        result = _make_result([chain])
        machine = MachineKinematics()
        stock = StockDefinition()

        report = simulate(result, machine, stock)
        assert report.min_z == -5
        assert report.max_z == 10
        assert report.max_feed == 1000
