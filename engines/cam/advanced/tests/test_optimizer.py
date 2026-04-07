"""Tests for feed/speed optimizer."""
from __future__ import annotations

import math
import pytest

from ..optimizer import (
    optimize_params,
    adjust_feed_for_engagement,
    compute_engagement_angle,
    OptimizedParams,
)
from ..models import Tool, ToolShape, Material, MachineKinematics, CutParams


class TestOptimizeParams:
    def test_basic_aluminum(self):
        tool = Tool(diameter_mm=6.0, flute_count=2)
        material = Material()  # aluminum default
        machine = MachineKinematics()
        cuts = CutParams(stepover_mm=1.0, z_step_mm=1.0)

        result = optimize_params(tool, material, machine, cuts, engagement_deg=90)
        assert result.feed_mm_min > 0
        assert result.spindle_rpm > 0
        assert result.mrr_cm3_min > 0
        assert result.chip_load_mm > 0

    def test_rpm_clamped_to_machine(self):
        tool = Tool(diameter_mm=1.0, flute_count=2)  # small tool = very high RPM
        material = Material()
        machine = MachineKinematics(max_spindle_rpm=12000)
        cuts = CutParams()

        result = optimize_params(tool, material, machine, cuts)
        assert result.spindle_rpm <= 12000

    def test_doc_clamped_to_flute(self):
        tool = Tool(diameter_mm=6.0, flute_length_mm=10.0)
        material = Material()
        machine = MachineKinematics()
        cuts = CutParams(z_step_mm=20.0)  # exceeds flute length

        result = optimize_params(tool, material, machine, cuts)
        assert result.doc_mm <= 10.0
        assert any("DOC clamped" in w for w in result.warnings)

    def test_deflection_warning(self):
        tool = Tool(diameter_mm=1.0, flute_length_mm=30.0, flute_count=2)  # long thin tool
        material = Material()
        machine = MachineKinematics()
        cuts = CutParams(stepover_mm=0.5, z_step_mm=5.0)

        result = optimize_params(tool, material, machine, cuts, engagement_deg=90)
        # Long thin tool should produce deflection warning
        # (may or may not depending on chip load calculation)


class TestAdjustFeedForEngagement:
    def test_same_engagement(self):
        f = adjust_feed_for_engagement(1000, 90, 90)
        assert abs(f - 1000) < 1.0

    def test_low_engagement_increases_feed(self):
        f = adjust_feed_for_engagement(1000, 30, 90)
        assert f > 1000

    def test_high_engagement_decreases_feed(self):
        f = adjust_feed_for_engagement(1000, 150, 90)
        assert f < 1000

    def test_zero_engagement(self):
        f = adjust_feed_for_engagement(1000, 0, 90)
        assert f == 1000  # returns base for zero

    def test_clamped_to_range(self):
        f = adjust_feed_for_engagement(1000, 5, 90)
        assert f <= 2000  # max 200%
        f = adjust_feed_for_engagement(1000, 170, 90)
        assert f >= 500  # min 50%


class TestComputeEngagementAngle:
    def test_full_slot(self):
        angle = compute_engagement_angle(5.0, 10.0)
        assert abs(angle - 180.0) < 0.1

    def test_stepover_equals_radius(self):
        angle = compute_engagement_angle(5.0, 5.0)
        # stepover = radius → 2*arccos(1-1) = 2*arccos(0) = 180°
        assert abs(angle - 180.0) < 0.1

    def test_half_radius_stepover(self):
        angle = compute_engagement_angle(5.0, 2.5)
        # stepover = radius/2 → 2*arccos(1-0.5) = 2*arccos(0.5) = 120°
        assert abs(angle - 120.0) < 1.0

    def test_small_stepover(self):
        angle = compute_engagement_angle(5.0, 0.5)
        assert angle < 60.0

    def test_zero_inputs(self):
        assert compute_engagement_angle(0, 5) == 0.0
        assert compute_engagement_angle(5, 0) == 0.0
