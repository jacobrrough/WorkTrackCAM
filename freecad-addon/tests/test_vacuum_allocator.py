# SPDX-License-Identifier: MIT

import pytest
from integration.laguna.vacuum_allocator import (
    allocate_zones,
    engaged_zone_indices,
    preset_allocation,
    BED_WIDTH_MM,
    BED_LENGTH_MM,
    ZONE_WIDTH,
    ZONE_LENGTH,
)


class TestVacuumAllocator:
    def test_full_bed_engages_all_zones(self):
        alloc = allocate_zones(0, 0, BED_WIDTH_MM, BED_LENGTH_MM)
        assert len(alloc) == 6
        assert all(z.engaged for z in alloc)
        assert engaged_zone_indices(alloc) == [0, 1, 2, 3, 4, 5]

    def test_single_zone_coverage(self):
        alloc = allocate_zones(0, 0, ZONE_WIDTH * 0.5, ZONE_LENGTH * 0.5)
        engaged = engaged_zone_indices(alloc)
        assert 0 in engaged
        assert len(engaged) == 1

    def test_stock_straddling_four_zones(self):
        cx = ZONE_WIDTH - 200
        cy = ZONE_LENGTH - 200
        alloc = allocate_zones(cx, cy, 400, 400)
        engaged = engaged_zone_indices(alloc)
        assert len(engaged) == 4

    def test_off_bed_engages_nothing(self):
        alloc = allocate_zones(BED_WIDTH_MM + 100, 0, 100, 100)
        assert all(not z.engaged for z in alloc)

    def test_zone_grid_dimensions(self):
        assert abs(ZONE_WIDTH - 762.0) < 0.1
        assert abs(ZONE_LENGTH - 1016.0) < 0.1

    def test_full_4x8_preset(self):
        alloc = preset_allocation("full_4x8")
        engaged = engaged_zone_indices(alloc)
        assert len(engaged) >= 4

    def test_unknown_preset_raises(self):
        with pytest.raises(ValueError):
            preset_allocation("nonexistent")


class TestZoneAllocationCoverage:
    def test_coverage_fraction_range(self):
        alloc = allocate_zones(0, 0, 500, 500)
        for z in alloc:
            assert 0.0 <= z.coverage_fraction <= 1.0

    def test_overlap_area_nonnegative(self):
        alloc = allocate_zones(100, 100, 300, 300)
        for z in alloc:
            assert z.overlap_area_mm2 >= 0.0
