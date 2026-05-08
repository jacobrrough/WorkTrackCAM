# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Jacob Rrough
#
# Chuck/tailstock collision detection for Carvera 4th axis.
# Ported from WorkTrackCAM src/shared/rotary-collision.ts

import math
from dataclasses import dataclass
from typing import List, Optional, Tuple


@dataclass
class RotaryFixture:
    chuck_outer_radius_mm: float = 46.0
    chuck_depth_mm: float = 15.0
    tailstock_offset_mm: float = 0.0
    tailstock_radius_mm: float = 0.0


@dataclass
class CollisionResult:
    has_collision: bool
    collision_points: List[Tuple[float, float, float]]
    min_clearance_mm: float
    segment_index: int = -1


def check_radial_clearance(
    tool_x: float,
    tool_y: float,
    tool_z: float,
    tool_radius: float,
    fixture: RotaryFixture,
    stock_center_z: float = 0.0,
) -> float:
    """Check radial clearance between tool and rotary fixture at a given position.

    The rotary axis runs along X. The chuck sits at X=0 (or at the
    headstock X offset). Y=0 is the rotary center. The tool tip is at
    (tool_x, tool_y, tool_z) in machine coordinates.
    """
    radial_distance = math.sqrt(tool_y ** 2 + tool_z ** 2)
    effective_tool_radius = tool_radius

    # Chuck collision zone: X < chuck_depth_mm
    if tool_x < fixture.chuck_depth_mm:
        clearance = radial_distance - fixture.chuck_outer_radius_mm - effective_tool_radius
        return clearance

    # Tailstock collision zone: X > (total_length - tailstock offset)
    if fixture.tailstock_radius_mm > 0 and fixture.tailstock_offset_mm > 0:
        tailstock_x = fixture.tailstock_offset_mm
        if tool_x > tailstock_x:
            clearance = radial_distance - fixture.tailstock_radius_mm - effective_tool_radius
            return clearance

    return float("inf")


def sweep_segments(
    segments: List[Tuple[float, float, float]],
    tool_radius: float,
    fixture: RotaryFixture,
    samples_per_segment: int = 8,
) -> CollisionResult:
    """Sweep toolpath segments checking for chuck/tailstock collisions.

    Each segment is (x, y, z) in machine coordinates. We sample
    `samples_per_segment` points along each linear segment and check
    radial clearance at each.
    """
    collision_points: List[Tuple[float, float, float]] = []
    min_clearance = float("inf")
    worst_segment = -1

    for i in range(len(segments) - 1):
        x0, y0, z0 = segments[i]
        x1, y1, z1 = segments[i + 1]

        for s in range(samples_per_segment + 1):
            t = s / samples_per_segment
            px = x0 + t * (x1 - x0)
            py = y0 + t * (y1 - y0)
            pz = z0 + t * (z1 - z0)

            clearance = check_radial_clearance(px, py, pz, tool_radius, fixture)
            if clearance < min_clearance:
                min_clearance = clearance
                worst_segment = i
            if clearance < 0:
                collision_points.append((px, py, pz))

    return CollisionResult(
        has_collision=len(collision_points) > 0,
        collision_points=collision_points,
        min_clearance_mm=min_clearance,
        segment_index=worst_segment,
    )
