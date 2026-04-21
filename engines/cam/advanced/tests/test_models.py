"""Tests for data models and config parsing."""
from __future__ import annotations

import math
import pytest

from ..models import (
    AABB, Vec3, Tool, ToolShape, Material, CutParams, StockDefinition,
    ToolpathJob, Strategy, MotionSegment, ToolpathChain, job_from_config,
)


class TestVec3:
    def test_add(self):
        a = Vec3(1, 2, 3)
        b = Vec3(4, 5, 6)
        c = a + b
        assert c.x == 5 and c.y == 7 and c.z == 9

    def test_sub(self):
        a = Vec3(5, 5, 5)
        b = Vec3(1, 2, 3)
        c = a - b
        assert c.x == 4 and c.y == 3 and c.z == 2

    def test_mul(self):
        a = Vec3(1, 2, 3)
        b = a * 2
        assert b.x == 2 and b.y == 4 and b.z == 6

    def test_length(self):
        v = Vec3(3, 4, 0)
        assert abs(v.length() - 5.0) < 1e-10

    def test_dot(self):
        a = Vec3(1, 0, 0)
        b = Vec3(0, 1, 0)
        assert abs(a.dot(b)) < 1e-10

    def test_cross(self):
        a = Vec3(1, 0, 0)
        b = Vec3(0, 1, 0)
        c = a.cross(b)
        assert abs(c.z - 1.0) < 1e-10


class TestAABB:
    def test_size(self):
        bb = AABB(Vec3(0, 0, 0), Vec3(10, 20, 30))
        s = bb.size
        assert s.x == 10 and s.y == 20 and s.z == 30

    def test_center(self):
        bb = AABB(Vec3(0, 0, 0), Vec3(10, 20, 30))
        c = bb.center
        assert c.x == 5 and c.y == 10 and c.z == 15


class TestTool:
    def test_validate_valid(self):
        t = Tool(diameter_mm=6.0, shape=ToolShape.FLAT)
        t.validate()  # should not raise

    def test_validate_zero_diameter(self):
        t = Tool(diameter_mm=0.0)
        with pytest.raises(ValueError, match="diameter"):
            t.validate()

    def test_validate_negative_diameter(self):
        t = Tool(diameter_mm=-1.0)
        with pytest.raises(ValueError, match="diameter"):
            t.validate()

    def test_validate_bull_nose_corner_too_large(self):
        t = Tool(diameter_mm=6.0, shape=ToolShape.BULL, corner_radius_mm=4.0)
        with pytest.raises(ValueError, match="Corner radius"):
            t.validate()

    def test_effective_radius_flat(self):
        t = Tool(diameter_mm=10.0, shape=ToolShape.FLAT)
        assert t.effective_radius == 5.0

    def test_effective_radius_ball(self):
        t = Tool(diameter_mm=10.0, shape=ToolShape.BALL)
        assert t.effective_radius == 5.0

    def test_effective_radius_bull(self):
        t = Tool(diameter_mm=10.0, shape=ToolShape.BULL, corner_radius_mm=2.0)
        assert t.effective_radius == 3.0


class TestToolpathJob:
    def test_validate_valid(self):
        job = ToolpathJob()
        errors = job.validate()
        assert errors == []

    def test_validate_bad_feed(self):
        job = ToolpathJob()
        job.cuts.feed_mm_min = -1
        errors = job.validate()
        assert any("feed" in e for e in errors)

    def test_validate_bad_stepover(self):
        job = ToolpathJob()
        job.cuts.stepover_mm = 0
        errors = job.validate()
        assert any("stepover" in e for e in errors)

    def test_validate_stepover_exceeds_diameter(self):
        job = ToolpathJob()
        job.tool = Tool(diameter_mm=6.0)
        job.cuts.stepover_mm = 7.0
        errors = job.validate()
        assert any("stepover" in e for e in errors)


class TestMotionSegment:
    def test_rapid(self):
        seg = MotionSegment(x=10, y=20, z=30, feed=0)
        assert seg.is_rapid is True

    def test_feed_move(self):
        seg = MotionSegment(x=10, y=20, z=30, feed=1000)
        assert seg.is_rapid is False


class TestToolpathChain:
    def test_empty(self):
        chain = ToolpathChain()
        assert chain.is_empty()

    def test_append_rapid(self):
        chain = ToolpathChain()
        chain.append_rapid(1, 2, 3)
        assert not chain.is_empty()
        assert chain.segments[0].is_rapid

    def test_append_feed(self):
        chain = ToolpathChain()
        chain.append_feed(1, 2, 3, 1000)
        assert chain.segments[0].feed == 1000


class TestJobFromConfig:
    def test_minimal_config(self):
        cfg = {
            "stlPath": "test.stl",
            "toolpathJsonPath": "out.json",
        }
        job = job_from_config(cfg)
        assert job.stl_path == "test.stl"
        assert job.strategy == Strategy.RASTER  # default

    def test_strategy_mapping(self):
        cfg = {
            "stlPath": "test.stl",
            "toolpathJsonPath": "out.json",
            "strategy": "adaptive_clear",
        }
        job = job_from_config(cfg)
        assert job.strategy == Strategy.ADAPTIVE_CLEAR

    def test_numeric_params(self):
        cfg = {
            "stlPath": "test.stl",
            "toolpathJsonPath": "out.json",
            "toolDiameterMm": 3.175,
            "feedMmMin": 800,
            "stepoverMm": 0.5,
            "stockAllowanceMm": 0.35,
            "maxEngagementDeg": 95,
        }
        job = job_from_config(cfg)
        assert job.tool.diameter_mm == 3.175
        assert job.cuts.feed_mm_min == 800
        assert job.cuts.stepover_mm == 0.5
        assert job.stock_allowance_mm == pytest.approx(0.35)
        assert job.max_engagement_deg == pytest.approx(95)

    def test_null_values_use_defaults(self):
        cfg = {
            "stlPath": "test.stl",
            "toolpathJsonPath": "out.json",
            "toolDiameterMm": None,
            "strategy": None,
        }
        job = job_from_config(cfg)
        assert job.tool.diameter_mm == 6.0
        assert job.strategy == Strategy.RASTER

    def test_validate_rejects_negative_stock_allowance(self):
        job = ToolpathJob()
        job.stock_allowance_mm = -0.1
        errors = job.validate()
        assert any("stock_allowance_mm" in e for e in errors)
