# SPDX-License-Identifier: MIT
#
# Tests for the 4-axis rotary operation strategies.

import math
import pytest
from integration.carvera.rotary_ops import (
    RotaryStrategy,
    RotaryJobSetup,
    RotaryPass,
    RotaryOperation,
    generate_indexed_positions,
    plan_roughing,
    plan_finishing,
    plan_contour,
    plan_indexed,
    plan_pattern,
    plan_operation,
    rotary_pass_to_gcode,
    operation_to_gcode,
)


class TestGenerateIndexedPositions:
    def test_full_rotation(self):
        positions = generate_indexed_positions(0, 360, 90)
        assert positions == [0, 90, 180, 270, 360]

    def test_half_rotation(self):
        positions = generate_indexed_positions(0, 180, 45)
        assert positions == [0, 45, 90, 135, 180]

    def test_single_position(self):
        positions = generate_indexed_positions(0, 0, 15)
        assert positions == [0]

    def test_fine_step(self):
        positions = generate_indexed_positions(0, 30, 10)
        assert positions == [0, 10, 20, 30]


class TestPlanRoughing:
    def test_generates_passes(self):
        setup = RotaryJobSetup(
            stock_diameter_mm=50,
            stock_length_mm=100,
            strategy=RotaryStrategy.ROUGHING,
            a_step_deg=90,
            stepdown_mm=1.0,
        )
        op = plan_roughing(setup, final_depth_mm=3.0)
        assert op.strategy == RotaryStrategy.ROUGHING
        assert len(op.passes) > 0

    def test_multiple_depths(self):
        setup = RotaryJobSetup(
            stock_diameter_mm=50,
            stock_length_mm=100,
            strategy=RotaryStrategy.ROUGHING,
            a_start_deg=0,
            a_end_deg=0,
            a_step_deg=360,
            stepdown_mm=1.0,
        )
        op = plan_roughing(setup, final_depth_mm=3.0)
        depths = [p.z_depth_mm for p in op.passes]
        assert depths == [-1.0, -2.0, -3.0]

    def test_has_preamble_and_postamble(self):
        setup = RotaryJobSetup(stock_diameter_mm=50, stock_length_mm=100)
        op = plan_roughing(setup, 2.0)
        assert "G21" in op.preamble
        assert "M2" in op.postamble


class TestPlanFinishing:
    def test_generates_passes(self):
        setup = RotaryJobSetup(
            stock_diameter_mm=50,
            stock_length_mm=100,
            strategy=RotaryStrategy.FINISHING,
            stepover_mm=5.0,
        )
        op = plan_finishing(setup, 2.0)
        assert op.strategy == RotaryStrategy.FINISHING
        assert len(op.passes) > 0

    def test_pass_count_matches_circumference(self):
        setup = RotaryJobSetup(
            stock_diameter_mm=50,
            stock_length_mm=100,
            stepover_mm=5.0,
        )
        op = plan_finishing(setup, 2.0)
        circumference = math.pi * 50
        expected_steps = int(circumference / 5.0)
        assert len(op.passes) == expected_steps


class TestPlanContour:
    def test_generates_passes(self):
        setup = RotaryJobSetup(
            stock_diameter_mm=50,
            stock_length_mm=100,
            stepover_mm=5.0,
        )
        op = plan_contour(setup, 2.0)
        assert op.strategy == RotaryStrategy.CONTOUR
        assert len(op.passes) > 0

    def test_angles_wrap_around(self):
        setup = RotaryJobSetup(
            stock_diameter_mm=50,
            stock_length_mm=100,
            stepover_mm=5.0,
        )
        op = plan_contour(setup, 2.0)
        for p in op.passes:
            assert 0 <= p.a_angle_deg < 360


class TestPlanIndexed:
    def test_generates_one_pass_per_position(self):
        setup = RotaryJobSetup(
            stock_diameter_mm=50,
            stock_length_mm=100,
            a_step_deg=90,
        )
        op = plan_indexed(setup, 2.0)
        assert op.strategy == RotaryStrategy.INDEXED
        assert len(op.passes) == 5  # 0, 90, 180, 270, 360


class TestPlanPattern:
    def test_four_repeats(self):
        setup = RotaryJobSetup(
            stock_diameter_mm=50,
            stock_length_mm=100,
            pattern_repeat_count=4,
        )
        op = plan_pattern(setup, 2.0)
        assert op.strategy == RotaryStrategy.PATTERN
        assert len(op.passes) == 4

    def test_angles_evenly_spaced(self):
        setup = RotaryJobSetup(
            stock_diameter_mm=50,
            stock_length_mm=100,
            pattern_repeat_count=6,
        )
        op = plan_pattern(setup, 2.0)
        angles = [p.a_angle_deg for p in op.passes]
        for i in range(1, len(angles)):
            assert abs(angles[i] - angles[i-1] - 60) < 0.01


class TestPlanOperation:
    def test_dispatches_roughing(self):
        setup = RotaryJobSetup(stock_diameter_mm=50, stock_length_mm=100, strategy=RotaryStrategy.ROUGHING)
        op = plan_operation(setup, 2.0)
        assert op.strategy == RotaryStrategy.ROUGHING

    def test_dispatches_finishing(self):
        setup = RotaryJobSetup(stock_diameter_mm=50, stock_length_mm=100, strategy=RotaryStrategy.FINISHING)
        op = plan_operation(setup, 2.0)
        assert op.strategy == RotaryStrategy.FINISHING

    def test_dispatches_contour(self):
        setup = RotaryJobSetup(stock_diameter_mm=50, stock_length_mm=100, strategy=RotaryStrategy.CONTOUR)
        op = plan_operation(setup, 2.0)
        assert op.strategy == RotaryStrategy.CONTOUR

    def test_dispatches_indexed(self):
        setup = RotaryJobSetup(stock_diameter_mm=50, stock_length_mm=100, strategy=RotaryStrategy.INDEXED)
        op = plan_operation(setup, 2.0)
        assert op.strategy == RotaryStrategy.INDEXED

    def test_dispatches_pattern(self):
        setup = RotaryJobSetup(stock_diameter_mm=50, stock_length_mm=100, strategy=RotaryStrategy.PATTERN)
        op = plan_operation(setup, 2.0)
        assert op.strategy == RotaryStrategy.PATTERN

    def test_dispatches_continuous(self):
        setup = RotaryJobSetup(stock_diameter_mm=50, stock_length_mm=100, strategy=RotaryStrategy.CONTINUOUS)
        op = plan_operation(setup, 2.0)
        assert op.strategy == RotaryStrategy.FINISHING


class TestRotaryPassToGcode:
    def test_basic_pass(self):
        rp = RotaryPass(a_angle_deg=45.0, x_start_mm=0, x_end_mm=100, z_depth_mm=-2.0, feed_rate=300)
        lines = rotary_pass_to_gcode(rp)
        assert "G0 A45.0" in lines
        assert any("G1 Z-2.0" in l for l in lines)
        assert any("G1 X100.0" in l for l in lines)

    def test_rapid_pass(self):
        rp = RotaryPass(a_angle_deg=0, x_start_mm=0, x_end_mm=50, z_depth_mm=-1.0, feed_rate=300, is_rapid=True)
        lines = rotary_pass_to_gcode(rp)
        assert any("G0 X" in l for l in lines)

    def test_inverse_time_mode(self):
        rp = RotaryPass(a_angle_deg=90, x_start_mm=0, x_end_mm=50, z_depth_mm=-1.0, feed_rate=300)
        lines = rotary_pass_to_gcode(rp, use_inverse_time=True)
        assert "G93" in lines
        assert "G94" in lines


class TestOperationToGcode:
    def test_complete_operation(self):
        setup = RotaryJobSetup(
            stock_diameter_mm=50,
            stock_length_mm=100,
            a_step_deg=90,
            strategy=RotaryStrategy.INDEXED,
        )
        op = plan_indexed(setup, 2.0)
        gcode = operation_to_gcode(op)
        assert "G21" in gcode
        assert "M3 S10000" in gcode
        assert "G0 Y0" in gcode
        assert "M5" in gcode
        assert "G0 A0" in gcode
        assert "M2" in gcode

    def test_preamble_has_safety_comments(self):
        setup = RotaryJobSetup(stock_diameter_mm=50, stock_length_mm=100)
        op = plan_roughing(setup, 2.0)
        assert "4-Axis Rotary" in op.preamble
