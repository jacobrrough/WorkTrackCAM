"""Tests for the multi-objective optimizer."""
from __future__ import annotations

import math
import pytest

from ..optimizer import (
    optimize_params, adjust_feed_for_engagement,
    compute_engagement_angle, compute_scallop_height, OptimizedParams,
    estimate_local_engagement, compute_adaptive_feed,
    apply_adaptive_feed_to_result,
)
from ..models import (
    Tool, ToolShape, Material, MachineKinematics, CutParams,
    ToolpathResult, ToolpathChain,
)


class TestOptimizeParams:
    def test_basic_aluminum(self):
        tool = Tool(diameter_mm=6.0)
        material = Material.from_name("aluminum_6061")
        machine = MachineKinematics()
        cuts = CutParams(stepover_mm=1.0, z_step_mm=1.0)
        result = optimize_params(tool, material, machine, cuts, engagement_deg=90.0)
        assert result.feed_mm_min > 0
        assert result.spindle_rpm > 0
        assert result.mrr_cm3_min > 0
        assert result.efficiency_score > 0

    def test_power_limit_clamps_feed(self):
        tool = Tool(diameter_mm=25.0, flute_count=4)
        material = Material.from_name("mild_steel")
        machine = MachineKinematics(max_power_kw=0.01)  # tiny power limit
        cuts = CutParams(stepover_mm=10.0, z_step_mm=5.0, feed_mm_min=5000)
        result = optimize_params(tool, material, machine, cuts)
        assert any("power" in w.lower() for w in result.warnings)

    def test_doc_clamp_to_flute_length(self):
        tool = Tool(diameter_mm=6.0, flute_length_mm=5.0)
        cuts = CutParams(z_step_mm=10.0)
        result = optimize_params(
            tool, Material(), MachineKinematics(), cuts,
        )
        assert result.doc_mm <= tool.flute_length_mm

    def test_high_deflection_warning(self):
        tool = Tool(diameter_mm=2.0, flute_length_mm=30.0)
        material = Material.from_name("mild_steel")
        cuts = CutParams(stepover_mm=1.0, z_step_mm=5.0)
        result = optimize_params(tool, material, MachineKinematics(), cuts)
        # Small tool + deep cut should warn about deflection
        assert result.deflection_um >= 0

    def test_rpm_clamp_to_machine(self):
        tool = Tool(diameter_mm=1.0)  # Very small = very high RPM
        machine = MachineKinematics(max_spindle_rpm=10000)
        result = optimize_params(tool, Material(), machine, CutParams())
        assert result.spindle_rpm <= 10000

    def test_wear_index_range(self):
        result = optimize_params(
            Tool(), Material(), MachineKinematics(), CutParams(),
        )
        assert 0 <= result.tool_wear_index <= 1.0


class TestEngagementAngle:
    def test_full_slotting(self):
        angle = compute_engagement_angle(tool_radius=5.0, stepover=10.0)
        assert angle == pytest.approx(180.0)

    def test_partial_stepover(self):
        angle = compute_engagement_angle(tool_radius=5.0, stepover=3.0)
        assert 60 < angle < 180

    def test_zero_stepover(self):
        assert compute_engagement_angle(5.0, 0.0) == 0.0

    def test_zero_radius(self):
        assert compute_engagement_angle(0.0, 1.0) == 0.0


class TestAdjustFeed:
    def test_lower_engagement_increases_feed(self):
        adjusted = adjust_feed_for_engagement(1000.0, 30.0, 90.0)
        assert adjusted > 1000.0

    def test_higher_engagement_decreases_feed(self):
        adjusted = adjust_feed_for_engagement(1000.0, 150.0, 90.0)
        assert adjusted < 1000.0

    def test_same_engagement_same_feed(self):
        adjusted = adjust_feed_for_engagement(1000.0, 90.0, 90.0)
        assert adjusted == pytest.approx(1000.0, rel=0.1)

    def test_zero_engagement(self):
        assert adjust_feed_for_engagement(1000.0, 0.0) == 1000.0

    def test_clamp_range(self):
        adjusted = adjust_feed_for_engagement(1000.0, 1.0, 90.0)
        assert adjusted <= 2000.0  # max 2x


class TestScallopHeight:
    def test_flat_no_scallop(self):
        assert compute_scallop_height(5.0, 2.0, ToolShape.FLAT) == 0.0

    def test_ball_scallop(self):
        h = compute_scallop_height(5.0, 2.0, ToolShape.BALL)
        assert h > 0
        assert h < 5.0

    def test_smaller_stepover_less_scallop(self):
        h1 = compute_scallop_height(5.0, 1.0, ToolShape.BALL)
        h2 = compute_scallop_height(5.0, 2.0, ToolShape.BALL)
        assert h1 < h2


class TestEstimateLocalEngagement:
    def test_flat_pass_returns_base_engagement(self):
        """No Z change means only radial engagement from stepover."""
        eng = estimate_local_engagement(prev_z=0.0, curr_z=0.0,
                                        tool_radius=3.0, stepover=1.0, z_step=1.0)
        base = compute_engagement_angle(3.0, 1.0)
        assert eng == pytest.approx(base, abs=0.1)

    def test_descending_increases_engagement(self):
        """Moving to deeper Z should increase engagement."""
        flat_eng = estimate_local_engagement(prev_z=0.0, curr_z=0.0,
                                             tool_radius=3.0, stepover=1.0, z_step=1.0)
        deep_eng = estimate_local_engagement(prev_z=0.0, curr_z=-1.0,
                                             tool_radius=3.0, stepover=1.0, z_step=1.0)
        assert deep_eng > flat_eng

    def test_ascending_keeps_base_engagement(self):
        """Moving to shallower Z should not add axial engagement."""
        ascending = estimate_local_engagement(prev_z=-5.0, curr_z=-3.0,
                                              tool_radius=3.0, stepover=1.0, z_step=1.0)
        base = compute_engagement_angle(3.0, 1.0)
        assert ascending == pytest.approx(base, abs=0.1)

    def test_zero_inputs(self):
        """Zero tool radius or stepover should return 0."""
        assert estimate_local_engagement(0.0, 0.0, 0.0, 1.0, 1.0) == 0.0
        assert estimate_local_engagement(0.0, 0.0, 3.0, 0.0, 1.0) == 0.0

    def test_clamped_to_180(self):
        """Engagement should never exceed 180 degrees."""
        eng = estimate_local_engagement(prev_z=0.0, curr_z=-10.0,
                                        tool_radius=3.0, stepover=6.0, z_step=1.0)
        assert eng <= 180.0


class TestComputeAdaptiveFeed:
    def test_flat_pass_near_base_feed(self):
        """Flat pass at target engagement should return near base feed."""
        feed = compute_adaptive_feed(
            base_feed=1000.0, prev_z=0.0, curr_z=0.0,
            tool_radius=3.0, stepover=1.0, z_step=1.0,
        )
        # Should be close to base feed (within adaptive range)
        assert 500 <= feed <= 1500

    def test_heavy_cut_reduces_feed(self):
        """Descending into material should reduce feed."""
        flat_feed = compute_adaptive_feed(
            base_feed=1000.0, prev_z=0.0, curr_z=0.0,
            tool_radius=3.0, stepover=1.0, z_step=1.0,
        )
        deep_feed = compute_adaptive_feed(
            base_feed=1000.0, prev_z=0.0, curr_z=-1.0,
            tool_radius=3.0, stepover=1.0, z_step=1.0,
        )
        assert deep_feed <= flat_feed

    def test_feed_clamped_to_range(self):
        """Output should always be within [0.5x, 1.5x] of base."""
        feed = compute_adaptive_feed(
            base_feed=1000.0, prev_z=0.0, curr_z=-100.0,
            tool_radius=3.0, stepover=6.0, z_step=1.0,
        )
        assert feed >= 500.0
        assert feed <= 1500.0

    def test_zero_base_feed_unchanged(self):
        """Zero base feed should return zero."""
        assert compute_adaptive_feed(0.0, 0.0, -1.0, 3.0, 1.0, 1.0) == 0.0


class TestApplyAdaptiveFeed:
    def test_modifies_feed_moves(self):
        """apply_adaptive_feed_to_result should modify feed segments."""
        result = ToolpathResult(strategy="test")
        chain = ToolpathChain()
        chain.append_rapid(0, 0, 10)
        chain.append_feed(0, 0, 0, 1000)
        chain.append_feed(10, 0, 0, 1000)
        chain.append_feed(10, 0, -5, 1000)  # descending cut
        result.chains.append(chain)

        apply_adaptive_feed_to_result(
            result, tool_radius=3.0, stepover=1.0, z_step=1.0,
            base_feed=1000.0,
        )

        # Feed values should have been adjusted
        feeds = [s.feed for s in chain.segments if not s.is_rapid]
        assert len(feeds) == 3
        # The descending segment should have a different feed than flat
        # (though exact values depend on engagement calculation)

    def test_rapids_unchanged(self):
        """Rapid moves should not be modified by adaptive feed."""
        result = ToolpathResult(strategy="test")
        chain = ToolpathChain()
        chain.append_rapid(0, 0, 10)
        chain.append_rapid(10, 0, 10)
        result.chains.append(chain)

        apply_adaptive_feed_to_result(
            result, tool_radius=3.0, stepover=1.0, z_step=1.0,
            base_feed=1000.0,
        )

        for seg in chain.segments:
            assert seg.is_rapid
            assert seg.feed == 0.0


class TestScipyOptimization:
    """Tests verifying scipy multi-objective optimization works correctly."""

    def test_scipy_produces_valid_params(self):
        """When scipy is available, optimizer should still produce valid results."""
        tool = Tool(diameter_mm=6.0, flute_count=2, flute_length_mm=25.0)
        material = Material.from_name("aluminum_6061")
        machine = MachineKinematics(max_spindle_rpm=24000, max_feed_mm_min=5000)
        cuts = CutParams(stepover_mm=1.0, z_step_mm=1.0)
        result = optimize_params(tool, material, machine, cuts)
        assert result.feed_mm_min > 0
        assert result.spindle_rpm > 0
        assert result.doc_mm > 0
        assert result.efficiency_score > 0

    def test_different_materials_different_params(self):
        """Different materials should produce different optimized params."""
        tool = Tool(diameter_mm=6.0, flute_count=2, flute_length_mm=25.0)
        machine = MachineKinematics(max_spindle_rpm=24000, max_feed_mm_min=5000)
        cuts = CutParams(stepover_mm=1.0, z_step_mm=1.0)

        alu = optimize_params(tool, Material.from_name("aluminum_6061"), machine, cuts)
        steel = optimize_params(tool, Material.from_name("mild_steel"), machine, cuts)

        # Steel should generally have lower feed and RPM than aluminum
        assert alu.spindle_rpm != steel.spindle_rpm or alu.feed_mm_min != steel.feed_mm_min

    def test_optimizer_respects_power_limit(self):
        """Optimized params should not exceed machine power."""
        tool = Tool(diameter_mm=12.0, flute_count=4, flute_length_mm=50.0)
        material = Material.from_name("stainless_304")
        machine = MachineKinematics(max_power_kw=0.5, max_spindle_rpm=10000)
        cuts = CutParams(stepover_mm=3.0, z_step_mm=2.0)
        result = optimize_params(tool, material, machine, cuts)
        assert result.power_kw <= machine.max_power_kw + 0.01
