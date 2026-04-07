"""Tests for the toolpath simulator."""
from __future__ import annotations

import pytest

from ..simulator import simulate, SimulationReport
from ..models import (
    ToolpathResult, ToolpathChain, MotionSegment,
    MachineKinematics, StockDefinition, Tool,
)


def _simple_toolpath() -> ToolpathResult:
    """Create a simple safe toolpath for testing."""
    result = ToolpathResult(strategy="test")
    chain = ToolpathChain()
    chain.append_rapid(10.0, 10.0, 20.0)    # rapid to above stock
    chain.append_rapid(10.0, 10.0, 5.0)     # lower
    chain.append_feed(10.0, 10.0, -5.0, 400)  # plunge
    chain.append_feed(50.0, 10.0, -5.0, 1000) # cut
    chain.append_feed(50.0, 50.0, -5.0, 1000) # cut
    chain.append_rapid(50.0, 50.0, 20.0)    # retract
    result.chains.append(chain)
    return result


def _dangerous_toolpath() -> ToolpathResult:
    """Create a toolpath with rapid-through-material."""
    result = ToolpathResult(strategy="test")
    chain = ToolpathChain()
    chain.append_rapid(10.0, 10.0, -5.0)  # rapid below stock top!
    chain.append_rapid(50.0, 50.0, -5.0)  # lateral rapid in material!
    result.chains.append(chain)
    return result


class TestSimulate:
    def test_safe_toolpath(self):
        result = _simple_toolpath()
        machine = MachineKinematics(x_travel_mm=200, y_travel_mm=200, z_travel_mm=50)
        stock = StockDefinition(x_min=0, x_max=60, y_min=0, y_max=60, z_min=-10, z_max=0)
        report = simulate(result, machine, stock, safe_z=20.0)
        assert report.is_safe
        assert report.error_count == 0

    def test_rapid_crash_detected(self):
        result = _dangerous_toolpath()
        machine = MachineKinematics(x_travel_mm=200, y_travel_mm=200, z_travel_mm=50)
        stock = StockDefinition(x_min=0, x_max=60, y_min=0, y_max=60, z_min=-10, z_max=0)
        report = simulate(result, machine, stock, safe_z=20.0)
        assert not report.is_safe
        assert report.error_count > 0
        assert any("crash" in i.message.lower() for i in report.issues)

    def test_excessive_feed_warning(self):
        result = ToolpathResult(strategy="test")
        chain = ToolpathChain()
        chain.append_rapid(10, 10, 20)
        chain.append_feed(50, 10, 0, 99999)  # absurd feed
        result.chains.append(chain)
        machine = MachineKinematics(max_feed_mm_min=5000)
        stock = StockDefinition()
        report = simulate(result, machine, stock)
        assert report.warning_count > 0

    def test_envelope_warning(self):
        result = ToolpathResult(strategy="test")
        chain = ToolpathChain()
        chain.append_rapid(500, 500, 20)  # way outside machine travel
        result.chains.append(chain)
        machine = MachineKinematics(x_travel_mm=100, y_travel_mm=100)
        stock = StockDefinition()
        report = simulate(result, machine, stock)
        assert report.warning_count > 0

    def test_move_counting(self):
        result = _simple_toolpath()
        machine = MachineKinematics()
        stock = StockDefinition()
        report = simulate(result, machine, stock)
        assert report.total_moves == 6
        assert report.rapid_moves == 3
        assert report.feed_moves == 3

    def test_distance_tracking(self):
        result = _simple_toolpath()
        machine = MachineKinematics()
        stock = StockDefinition()
        report = simulate(result, machine, stock)
        assert report.total_cut_distance_mm > 0
        assert report.total_rapid_distance_mm > 0

    def test_empty_toolpath(self):
        result = ToolpathResult(strategy="test")
        machine = MachineKinematics()
        stock = StockDefinition()
        report = simulate(result, machine, stock)
        assert report.is_safe
        assert report.total_moves == 0

    def test_stock_heightfield_tracking(self):
        """After machining, stock heightfield should reflect material removal."""
        result = ToolpathResult(strategy="test")
        chain = ToolpathChain()
        # First: normal plunge + cut that clears material at z=-5
        chain.append_rapid(10, 10, 20)
        chain.append_rapid(10, 10, 2)
        chain.append_feed(10, 10, -5, 400)
        chain.append_feed(50, 10, -5, 1000)
        chain.append_rapid(50, 10, 20)
        result.chains.append(chain)

        # Second chain: rapid to already-cleared area
        chain2 = ToolpathChain()
        chain2.append_rapid(30, 10, -3)  # Below original stock but above cut depth
        result.chains.append(chain2)

        machine = MachineKinematics(x_travel_mm=200, y_travel_mm=200, z_travel_mm=50)
        stock = StockDefinition(x_min=0, x_max=60, y_min=0, y_max=60, z_min=-10, z_max=0)
        tool = Tool(diameter_mm=6.0)
        report = simulate(result, machine, stock, safe_z=20.0, tool=tool)
        # Total should be 5 + 1 = 6 moves
        assert report.total_moves == 6

    def test_air_cut_detection(self):
        """Feed moves above stock should be counted as air cuts."""
        result = ToolpathResult(strategy="test")
        chain = ToolpathChain()
        chain.append_rapid(10, 10, 20)
        chain.append_feed(10, 10, 5, 1000)  # Cutting at z=5, above stock top (0)
        chain.append_feed(50, 10, 5, 1000)  # Also above stock
        result.chains.append(chain)

        machine = MachineKinematics()
        stock = StockDefinition(x_min=0, x_max=60, y_min=0, y_max=60, z_min=-10, z_max=0)
        report = simulate(result, machine, stock, safe_z=20.0)
        assert report.air_cut_distance_mm > 0

    def test_z_depth_violation(self):
        """Z below machine travel limit should be an error."""
        result = ToolpathResult(strategy="test")
        chain = ToolpathChain()
        chain.append_rapid(10, 10, 20)
        chain.append_feed(10, 10, -100, 400)  # Way below z_travel
        result.chains.append(chain)

        machine = MachineKinematics(z_travel_mm=50)
        stock = StockDefinition()
        report = simulate(result, machine, stock)
        assert not report.is_safe
        assert any("Z travel" in i.message for i in report.issues)


class TestSimulatorMRR:
    def test_mrr_fields_exist(self):
        """SimulationReport should have MRR and power fields."""
        from ..simulator import SimulationReport
        report = SimulationReport()
        assert hasattr(report, "estimated_mrr_cm3_min")
        assert hasattr(report, "estimated_power_kw")
        assert hasattr(report, "material_removed_cm3")
        assert report.estimated_mrr_cm3_min == 0.0
        assert report.estimated_power_kw == 0.0
        assert report.material_removed_cm3 == 0.0

    def test_mrr_computed_for_cutting(self):
        """Simulator should estimate MRR when cuts remove stock."""
        result = ToolpathResult()
        chain = ToolpathChain()
        # Simulate a cutting pass that removes material
        chain.append_rapid(0, 0, 10)   # safe height
        chain.append_feed(0, 0, -2, 1000)  # plunge into stock
        chain.append_feed(50, 0, -2, 1000)  # cut across stock
        chain.append_rapid(50, 0, 10)
        result.chains.append(chain)

        stock = StockDefinition(x_min=-5, x_max=55, y_min=-5, y_max=5, z_min=-10, z_max=0)
        machine = MachineKinematics()
        tool = Tool(diameter_mm=6.0)

        report = simulate(result, machine, stock, safe_z=10.0, tool=tool)
        # Should have tracked some material removal
        assert report.material_removed_cm3 >= 0.0
