"""Tests for data models and config parsing."""
from __future__ import annotations

import json
import pytest

from ..models import (
    Vec3, AABB, Tool, ToolShape, Material, CutParams,
    StockDefinition, ToolpathJob, Strategy, MotionSegment,
    ToolpathChain, ToolpathResult, compute_stats, job_from_config,
    DrillCycleMode,
)


class TestVec3:
    def test_add(self):
        v = Vec3(1, 2, 3) + Vec3(4, 5, 6)
        assert v.x == 5 and v.y == 7 and v.z == 9

    def test_sub(self):
        v = Vec3(4, 5, 6) - Vec3(1, 2, 3)
        assert v.x == 3 and v.y == 3 and v.z == 3

    def test_mul(self):
        v = Vec3(1, 2, 3) * 2
        assert v.x == 2 and v.y == 4 and v.z == 6

    def test_length(self):
        v = Vec3(3, 4, 0)
        assert v.length() == pytest.approx(5.0)

    def test_dot(self):
        assert Vec3(1, 0, 0).dot(Vec3(0, 1, 0)) == 0.0

    def test_cross(self):
        c = Vec3(1, 0, 0).cross(Vec3(0, 1, 0))
        assert c.z == pytest.approx(1.0)

    def test_normalized(self):
        n = Vec3(0, 0, 5).normalized()
        assert n.z == pytest.approx(1.0)

    def test_normalized_zero(self):
        n = Vec3(0, 0, 0).normalized()
        assert n.length() == pytest.approx(0.0)

    def test_distance_to(self):
        d = Vec3(0, 0, 0).distance_to(Vec3(3, 4, 0))
        assert d == pytest.approx(5.0)


class TestAABB:
    def test_size(self):
        aabb = AABB(Vec3(0, 0, 0), Vec3(10, 20, 30))
        assert aabb.size.x == 10

    def test_center(self):
        aabb = AABB(Vec3(0, 0, 0), Vec3(10, 20, 30))
        assert aabb.center.x == pytest.approx(5.0)

    def test_contains(self):
        aabb = AABB(Vec3(0, 0, 0), Vec3(10, 10, 10))
        assert aabb.contains(Vec3(5, 5, 5))
        assert not aabb.contains(Vec3(15, 5, 5))

    def test_expand(self):
        aabb = AABB(Vec3(0, 0, 0), Vec3(10, 10, 10))
        expanded = aabb.expand(5.0)
        assert expanded.min_pt.x == -5.0
        assert expanded.max_pt.x == 15.0


class TestTool:
    def test_valid_tool(self):
        t = Tool(diameter_mm=6.0, shape=ToolShape.FLAT)
        assert t.validate() == []
        assert t.radius == 3.0

    def test_invalid_diameter(self):
        t = Tool(diameter_mm=-1.0)
        errors = t.validate()
        assert any("diameter" in e.lower() for e in errors)

    def test_ball_end_effective_radius(self):
        t = Tool(diameter_mm=10.0, shape=ToolShape.BALL)
        assert t.effective_radius == 5.0

    def test_bull_nose_effective_radius(self):
        t = Tool(diameter_mm=10.0, shape=ToolShape.BULL, corner_radius_mm=2.0)
        assert t.effective_radius == 3.0

    def test_bull_nose_invalid_corner(self):
        t = Tool(diameter_mm=10.0, shape=ToolShape.BULL, corner_radius_mm=6.0)
        errors = t.validate()
        assert len(errors) > 0


class TestMaterial:
    def test_from_name(self):
        m = Material.from_name("aluminum_6061")
        assert m.name == "aluminum_6061"
        assert m.machinability_index == 1.0

    def test_from_name_unknown(self):
        m = Material.from_name("unobtanium")
        assert m.name == "aluminum_6061"  # default


class TestToolpathJob:
    def test_valid_job(self):
        job = ToolpathJob()
        errors = job.validate()
        assert errors == []

    def test_invalid_feed(self):
        job = ToolpathJob()
        job.cuts.feed_mm_min = -100
        errors = job.validate()
        assert any("feed" in e.lower() for e in errors)

    def test_invalid_stepover(self):
        job = ToolpathJob()
        job.cuts.stepover_mm = 20  # > tool diameter
        errors = job.validate()
        assert any("stepover" in e.lower() for e in errors)

    def test_rest_requires_prior_tool(self):
        job = ToolpathJob(strategy=Strategy.REST)
        errors = job.validate()
        assert any("prior_tool" in e.lower() for e in errors)


class TestMotionSegment:
    def test_rapid(self):
        seg = MotionSegment(1.0, 2.0, 3.0, feed=0.0)
        assert seg.is_rapid

    def test_feed(self):
        seg = MotionSegment(1.0, 2.0, 3.0, feed=1000.0)
        assert not seg.is_rapid

    def test_distance(self):
        s1 = MotionSegment(0, 0, 0)
        s2 = MotionSegment(3, 4, 0)
        assert s1.distance_to(s2) == pytest.approx(5.0)


class TestToolpathChain:
    def test_append_rapid(self):
        c = ToolpathChain()
        c.append_rapid(1, 2, 3)
        assert len(c.segments) == 1
        assert c.segments[0].is_rapid

    def test_append_feed(self):
        c = ToolpathChain()
        c.append_feed(1, 2, 3, 1000)
        assert not c.segments[0].is_rapid

    def test_last(self):
        c = ToolpathChain()
        assert c.last is None
        c.append_rapid(1, 2, 3)
        assert c.last.x == 1.0


class TestComputeStats:
    def test_basic_stats(self):
        result = ToolpathResult()
        c = ToolpathChain()
        c.append_rapid(10, 0, 10)
        c.append_feed(10, 0, 0, 1000)
        c.append_feed(20, 0, 0, 1000)
        result.chains.append(c)
        compute_stats(result, safe_z=10.0)
        assert result.cut_distance_mm > 0
        assert result.rapid_distance_mm > 0
        assert result.estimated_time_s > 0


class TestJobFromConfig:
    def test_minimal_config(self):
        cfg = {
            "stlPath": "test.stl",
            "toolpathJsonPath": "out.json",
            "strategy": "raster",
        }
        job = job_from_config(cfg)
        assert job.strategy == Strategy.RASTER
        assert job.stl_path == "test.stl"

    def test_full_config(self):
        cfg = {
            "stlPath": "test.stl",
            "toolpathJsonPath": "out.json",
            "strategy": "adaptive_clear",
            "toolDiameterMm": 8.0,
            "toolShape": "ball",
            "feedMmMin": 2000,
            "plungeMmMin": 600,
            "stepoverMm": 1.5,
            "zStepMm": 2.0,
            "safeZMm": 20.0,
            "materialName": "mild_steel",
        }
        job = job_from_config(cfg)
        assert job.strategy == Strategy.ADAPTIVE_CLEAR
        assert job.tool.diameter_mm == 8.0
        assert job.tool.shape == ToolShape.BALL
        assert job.cuts.feed_mm_min == 2000
        assert job.material.name == "mild_steel"

    def test_unknown_strategy_defaults_to_raster(self):
        cfg = {"stlPath": "t.stl", "toolpathJsonPath": "o.json", "strategy": "unknown"}
        job = job_from_config(cfg)
        assert job.strategy == Strategy.RASTER

    def test_none_values_use_defaults(self):
        cfg = {"stlPath": "t.stl", "toolpathJsonPath": "o.json", "feedMmMin": None}
        job = job_from_config(cfg)
        assert job.cuts.feed_mm_min == 1000.0

    def test_raster_angle_deg_parsed(self):
        cfg = {"stlPath": "t.stl", "toolpathJsonPath": "o.json", "rasterAngleDeg": 45.0}
        job = job_from_config(cfg)
        assert job.raster_angle_deg == 45.0

    def test_raster_angle_deg_defaults_to_zero(self):
        cfg = {"stlPath": "t.stl", "toolpathJsonPath": "o.json"}
        job = job_from_config(cfg)
        assert job.raster_angle_deg == 0.0

    def test_scan_angle_deg_overrides_raster_angle(self):
        """scanAngleDeg should take precedence over rasterAngleDeg."""
        cfg = {
            "stlPath": "t.stl", "toolpathJsonPath": "o.json",
            "rasterAngleDeg": 30.0, "scanAngleDeg": 60.0
        }
        job = job_from_config(cfg)
        assert job.raster_angle_deg == 60.0
        assert job.scan_angle_deg == 60.0

    def test_scan_angle_deg_without_raster_angle(self):
        """scanAngleDeg alone should set raster_angle_deg."""
        cfg = {"stlPath": "t.stl", "toolpathJsonPath": "o.json", "scanAngleDeg": 45.0}
        job = job_from_config(cfg)
        assert job.raster_angle_deg == 45.0

    def test_scan_angle_deg_absent_uses_raster_angle(self):
        """When scanAngleDeg is absent, rasterAngleDeg is used."""
        cfg = {"stlPath": "t.stl", "toolpathJsonPath": "o.json", "rasterAngleDeg": 90.0}
        job = job_from_config(cfg)
        assert job.raster_angle_deg == 90.0
        assert job.scan_angle_deg is None

    def test_drill_points_parsed(self):
        """drillPoints should be parsed as list of (x, y) tuples."""
        cfg = {
            "stlPath": "t.stl", "toolpathJsonPath": "o.json",
            "strategy": "drill",
            "drillPoints": [[5.0, 10.0], [15.0, 20.0]],
        }
        job = job_from_config(cfg)
        assert job.strategy == Strategy.DRILL
        assert len(job.drill_points) == 2
        assert job.drill_points[0] == pytest.approx((5.0, 10.0))
        assert job.drill_points[1] == pytest.approx((15.0, 20.0))

    def test_drill_cycle_mode_parsed(self):
        """drillCycleMode should map to the DrillCycleMode enum."""
        cfg = {
            "stlPath": "t.stl", "toolpathJsonPath": "o.json",
            "drillCycleMode": "g83",
        }
        job = job_from_config(cfg)
        assert job.drill_cycle_mode == DrillCycleMode.G83

    def test_drill_peck_depth_parsed(self):
        """peckDepthMm should be parsed as a float."""
        cfg = {"stlPath": "t.stl", "toolpathJsonPath": "o.json", "peckDepthMm": 2.5}
        job = job_from_config(cfg)
        assert job.peck_depth_mm == 2.5

    def test_drill_cycle_mode_defaults_to_g81(self):
        """Default drill cycle mode should be G81."""
        cfg = {"stlPath": "t.stl", "toolpathJsonPath": "o.json"}
        job = job_from_config(cfg)
        assert job.drill_cycle_mode == DrillCycleMode.G81

    def test_adaptive_feed_enabled_parsed(self):
        """adaptiveFeedEnabled should be parsed as boolean."""
        cfg = {"stlPath": "t.stl", "toolpathJsonPath": "o.json", "adaptiveFeedEnabled": True}
        job = job_from_config(cfg)
        assert job.adaptive_feed_enabled is True

    def test_adaptive_feed_defaults_to_false(self):
        """Default adaptive feed should be disabled."""
        cfg = {"stlPath": "t.stl", "toolpathJsonPath": "o.json"}
        job = job_from_config(cfg)
        assert job.adaptive_feed_enabled is False

    def test_drill_points_with_invalid_entries(self):
        """Invalid drill point entries should be silently skipped."""
        cfg = {
            "stlPath": "t.stl", "toolpathJsonPath": "o.json",
            "drillPoints": [[5.0, 10.0], "invalid", [15.0], [20.0, 30.0]],
        }
        job = job_from_config(cfg)
        # Only the valid [5.0, 10.0] and [20.0, 30.0] should be parsed
        assert len(job.drill_points) == 2
