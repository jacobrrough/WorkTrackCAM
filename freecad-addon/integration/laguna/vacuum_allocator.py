# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Jacob Rrough
#
# 6-zone vacuum table allocation for Laguna Swift 5x10.
# Ported from WorkTrackCAM src/shared/laguna-vacuum-allocator.ts

from dataclasses import dataclass
from typing import List, Tuple

BED_WIDTH_MM = 1524.0
BED_LENGTH_MM = 3048.0
ZONE_COLS = 2
ZONE_ROWS = 3
ZONE_WIDTH = BED_WIDTH_MM / ZONE_COLS
ZONE_LENGTH = BED_LENGTH_MM / ZONE_ROWS


@dataclass
class ZoneAllocation:
    zone_index: int
    col: int
    row: int
    overlap_area_mm2: float
    coverage_fraction: float
    engaged: bool


def allocate_zones(
    stock_origin_x: float,
    stock_origin_y: float,
    stock_width: float,
    stock_length: float,
    min_coverage: float = 0.05,
) -> List[ZoneAllocation]:
    """Determine which vacuum zones to engage for a given stock placement.

    The bed is divided into a 2×3 grid (6 zones). Each zone is 762×1016 mm.
    A zone is engaged if the stock overlaps it by at least `min_coverage`
    fraction of the zone area.
    """
    allocations: List[ZoneAllocation] = []
    zone_area = ZONE_WIDTH * ZONE_LENGTH

    for row in range(ZONE_ROWS):
        for col in range(ZONE_COLS):
            zone_idx = row * ZONE_COLS + col
            zone_x0 = col * ZONE_WIDTH
            zone_y0 = row * ZONE_LENGTH
            zone_x1 = zone_x0 + ZONE_WIDTH
            zone_y1 = zone_y0 + ZONE_LENGTH

            stock_x1 = stock_origin_x + stock_width
            stock_y1 = stock_origin_y + stock_length

            overlap_x = max(0.0, min(zone_x1, stock_x1) - max(zone_x0, stock_origin_x))
            overlap_y = max(0.0, min(zone_y1, stock_y1) - max(zone_y0, stock_origin_y))
            overlap_area = overlap_x * overlap_y
            coverage = overlap_area / zone_area if zone_area > 0 else 0.0

            allocations.append(ZoneAllocation(
                zone_index=zone_idx,
                col=col,
                row=row,
                overlap_area_mm2=overlap_area,
                coverage_fraction=coverage,
                engaged=coverage >= min_coverage,
            ))

    return allocations


def engaged_zone_indices(allocations: List[ZoneAllocation]) -> List[int]:
    """Return sorted list of engaged zone indices."""
    return sorted(z.zone_index for z in allocations if z.engaged)


# --- Full-sheet stock presets ---

SHEET_PRESETS = {
    "full_4x8": (1219.2, 2438.4),
    "half_4x4": (1219.2, 1219.2),
    "quarter_2x4": (609.6, 1219.2),
    "full_5x10": (BED_WIDTH_MM, BED_LENGTH_MM),
}


def preset_allocation(preset_name: str, origin_x: float = 0.0, origin_y: float = 0.0) -> List[ZoneAllocation]:
    """Allocate zones for a named sheet stock preset."""
    dims = SHEET_PRESETS.get(preset_name)
    if dims is None:
        raise ValueError(f"Unknown sheet preset: {preset_name}")
    return allocate_zones(origin_x, origin_y, dims[0], dims[1])
