# SPDX-License-Identifier: MIT

import math
import pytest
from integration.carvera.rotary_collision import (
    RotaryFixture,
    check_radial_clearance,
    sweep_segments,
)


class TestRadialClearance:
    def test_tool_far_from_chuck(self):
        fixture = RotaryFixture(chuck_outer_radius_mm=46.0, chuck_depth_mm=15.0)
        clearance = check_radial_clearance(50, 0, 80, 3.175, fixture)
        assert clearance == float("inf")

    def test_tool_inside_chuck_zone_clear(self):
        fixture = RotaryFixture(chuck_outer_radius_mm=46.0, chuck_depth_mm=15.0)
        clearance = check_radial_clearance(5, 0, 60, 3.175, fixture)
        assert clearance > 0

    def test_tool_inside_chuck_zone_collision(self):
        fixture = RotaryFixture(chuck_outer_radius_mm=46.0, chuck_depth_mm=15.0)
        clearance = check_radial_clearance(5, 0, 40, 10, fixture)
        assert clearance < 0


class TestSweepSegments:
    def test_safe_path_no_collision(self):
        fixture = RotaryFixture(chuck_outer_radius_mm=46.0, chuck_depth_mm=15.0)
        segments = [(20, 0, 80), (100, 0, 80), (200, 0, 80)]
        result = sweep_segments(segments, 3.175, fixture)
        assert not result.has_collision
        assert result.min_clearance_mm > 0

    def test_path_through_chuck_collision(self):
        fixture = RotaryFixture(chuck_outer_radius_mm=46.0, chuck_depth_mm=15.0)
        segments = [(0, 0, 30), (10, 0, 30)]
        result = sweep_segments(segments, 3.175, fixture)
        assert result.has_collision
        assert len(result.collision_points) > 0

    def test_empty_segments(self):
        fixture = RotaryFixture()
        result = sweep_segments([], 3.175, fixture)
        assert not result.has_collision
