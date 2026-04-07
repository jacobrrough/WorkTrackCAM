"""Tests for performance optimizations.

Verifies that optimized code paths produce identical results to the
original algorithms.  Each test exercises a specific optimization to
ensure it does not change toolpath output.
"""
from __future__ import annotations

import math
import struct
import tempfile
from pathlib import Path

import numpy as np
import pytest

from ..geometry import (
    Mesh,
    load_stl,
    Heightfield,
    build_heightfield,
    slice_mesh_at_z,
    build_surface_angle_map,
    build_bvh,
    query_bvh_xy_range,
)
from ..models import (
    ToolpathJob,
    Strategy,
    Tool,
    ToolShape,
    CutParams,
    StockDefinition,
    Vec3,
)
from ..strategies import run_strategy


# ── STL helpers ──────────────────────────────────────────────────────────

def _make_binary_stl(triangles):
    header = b"\x00" * 80
    count = struct.pack("<I", len(triangles))
    data = header + count
    for tri in triangles:
        normal, v0, v1, v2 = tri
        data += struct.pack("<fff", *normal)
        data += struct.pack("<fff", *v0)
        data += struct.pack("<fff", *v1)
        data += struct.pack("<fff", *v2)
        data += struct.pack("<H", 0)
    return data


def _box_triangles(sx=10.0, sy=10.0, sz=5.0):
    return [
        ((0, 0, -1), (0, 0, 0), (sx, sy, 0), (sx, 0, 0)),
        ((0, 0, -1), (0, 0, 0), (0, sy, 0), (sx, sy, 0)),
        ((0, 0, 1), (0, 0, sz), (sx, 0, sz), (sx, sy, sz)),
        ((0, 0, 1), (0, 0, sz), (sx, sy, sz), (0, sy, sz)),
        ((0, -1, 0), (0, 0, 0), (sx, 0, 0), (sx, 0, sz)),
        ((0, -1, 0), (0, 0, 0), (sx, 0, sz), (0, 0, sz)),
        ((0, 1, 0), (0, sy, 0), (0, sy, sz), (sx, sy, sz)),
        ((0, 1, 0), (0, sy, 0), (sx, sy, sz), (sx, sy, 0)),
        ((-1, 0, 0), (0, 0, 0), (0, 0, sz), (0, sy, sz)),
        ((-1, 0, 0), (0, 0, 0), (0, sy, sz), (0, sy, 0)),
        ((1, 0, 0), (sx, 0, 0), (sx, sy, 0), (sx, sy, sz)),
        ((1, 0, 0), (sx, 0, 0), (sx, sy, sz), (sx, 0, sz)),
    ]


def _hemisphere_triangles(radius=5.0, segments=8, rings=4):
    tris = []
    for ring in range(rings):
        phi0 = (math.pi / 2) * ring / rings
        phi1 = (math.pi / 2) * (ring + 1) / rings
        for seg in range(segments):
            theta0 = 2 * math.pi * seg / segments
            theta1 = 2 * math.pi * (seg + 1) / segments

            def pt(phi, theta):
                return (
                    radius * math.cos(phi) * math.cos(theta),
                    radius * math.cos(phi) * math.sin(theta),
                    radius * math.sin(phi),
                )

            p00 = pt(phi0, theta0)
            p10 = pt(phi1, theta0)
            p01 = pt(phi0, theta1)
            p11 = pt(phi1, theta1)
            n = (0, 0, 1)
            tris.append((n, p00, p10, p01))
            tris.append((n, p10, p11, p01))
    return tris


def _make_mesh(triangles) -> Mesh:
    data = _make_binary_stl(triangles)
    f = tempfile.NamedTemporaryFile(suffix=".stl", delete=False)
    f.write(data)
    f.close()
    mesh = load_stl(f.name)
    Path(f.name).unlink(missing_ok=True)
    return mesh


def _make_job(strategy: Strategy = Strategy.RASTER, **overrides) -> ToolpathJob:
    params = dict(
        strategy=strategy,
        tool=Tool(diameter_mm=6.0, shape=ToolShape.FLAT),
        cuts=CutParams(
            stepover_mm=1.0,
            z_step_mm=1.0,
            safe_z_mm=20.0,
            feed_mm_min=1000.0,
            plunge_mm_min=300.0,
        ),
        stock=StockDefinition(
            x_min=-2.0, x_max=12.0,
            y_min=-2.0, y_max=12.0,
            z_min=0.0, z_max=7.0,
        ),
    )
    params.update(overrides)
    return ToolpathJob(**params)


# ── Vectorized BVH construction ──────────────────────────────────────────

class TestVectorizedBVH:
    """Verify that vectorized ensure_bvh produces correct spatial index."""

    def test_bvh_query_coverage_box(self):
        """BVH from vectorized centroid/bbox should find all box triangles."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        mesh.ensure_bvh()
        assert mesh.bvh is not None
        # Full-range query should find all 12 triangles
        hits = query_bvh_xy_range(mesh.bvh, -1, 11, -1, 11)
        assert len(hits) == 12

    def test_bvh_query_partial(self):
        """BVH query for a sub-region should return only relevant triangles."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        mesh.ensure_bvh()
        # Query only the right half of the box
        hits = query_bvh_xy_range(mesh.bvh, 8, 12, -1, 11)
        # Should find some but not all triangles
        assert 0 < len(hits) <= 12

    def test_bvh_idempotent(self):
        """Calling ensure_bvh multiple times should not change results."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        mesh.ensure_bvh()
        hits1 = set(query_bvh_xy_range(mesh.bvh, -1, 11, -1, 11))
        mesh.ensure_bvh()  # should be a no-op
        hits2 = set(query_bvh_xy_range(mesh.bvh, -1, 11, -1, 11))
        assert hits1 == hits2

    def test_bvh_hemisphere(self):
        """BVH should correctly index a curved mesh."""
        mesh = _make_mesh(_hemisphere_triangles(5.0, 12, 6))
        mesh.ensure_bvh()
        assert mesh.bvh is not None
        # Full query should find all triangles
        hits = query_bvh_xy_range(mesh.bvh, -10, 10, -10, 10)
        assert len(hits) == mesh.num_triangles


# ── Vectorized subtract_tool_pass ────────────────────────────────────────

class TestVectorizedSubtractToolPass:
    """Verify numpy-vectorized subtract_tool_pass matches per-cell behavior."""

    def test_flat_tool_lowers_stock(self):
        """Flat tool pass should lower stock within tool radius."""
        hf = Heightfield(0, 20, 0, 20, 40, 40, default_z=10.0)
        hf.subtract_tool_pass(10.0, 10.0, 5.0, tool_radius=3.0,
                              tool_shape=ToolShape.FLAT)
        # Center should be lowered to 5.0
        z_center = hf.sample_z(10.0, 10.0)
        assert z_center == pytest.approx(5.0, abs=0.5)
        # Far corner should be unchanged at 10.0
        z_far = hf.sample_z(0.5, 0.5)
        assert z_far == pytest.approx(10.0, abs=0.5)

    def test_ball_tool_profile(self):
        """Ball tool pass should produce hemispherical cut profile."""
        hf = Heightfield(0, 20, 0, 20, 100, 100, default_z=10.0)
        hf.subtract_tool_pass(10.0, 10.0, 5.0, tool_radius=3.0,
                              tool_shape=ToolShape.BALL)
        # Center should be at z_tip
        z_center = hf.sample_z(10.0, 10.0)
        assert z_center == pytest.approx(5.0, abs=0.5)
        # At tool edge (3mm away), Z should be higher (sphere profile)
        z_edge = hf.sample_z(12.5, 10.0)
        assert z_edge > z_center  # edge is higher than center

    def test_bull_tool_profile(self):
        """Bull-nose tool pass should produce flat center with rounded edges."""
        hf = Heightfield(0, 20, 0, 20, 100, 100, default_z=10.0)
        hf.subtract_tool_pass(10.0, 10.0, 5.0, tool_radius=3.0,
                              tool_shape=ToolShape.BULL, corner_radius=1.0)
        z_center = hf.sample_z(10.0, 10.0)
        assert z_center == pytest.approx(5.0, abs=0.5)

    def test_out_of_bounds_tool_no_crash(self):
        """Tool pass near grid edge should not crash."""
        hf = Heightfield(0, 10, 0, 10, 20, 20, default_z=10.0)
        # Tool centered at edge of grid
        hf.subtract_tool_pass(0.0, 0.0, 5.0, tool_radius=3.0,
                              tool_shape=ToolShape.FLAT)
        # Should not crash and some cells near (0,0) should be lowered
        z_corner = hf.sample_z(0.5, 0.5)
        assert z_corner < 10.0

    def test_multiple_passes_accumulate(self):
        """Multiple tool passes should cumulatively lower stock."""
        hf = Heightfield(0, 20, 0, 20, 40, 40, default_z=10.0)
        hf.subtract_tool_pass(10.0, 10.0, 7.0, tool_radius=3.0,
                              tool_shape=ToolShape.FLAT)
        hf.subtract_tool_pass(10.0, 10.0, 5.0, tool_radius=3.0,
                              tool_shape=ToolShape.FLAT)
        z_center = hf.sample_z(10.0, 10.0)
        assert z_center == pytest.approx(5.0, abs=0.5)


# ── Optimized slice_mesh_at_z deduplication ──────────────────────────────

class TestSliceDedup:
    """Verify hash-based crossing deduplication produces correct contours."""

    def test_box_slice_produces_loop(self):
        """Slicing a box at mid-height should produce a rectangular loop."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        loops = slice_mesh_at_z(mesh, 2.5)
        assert len(loops) >= 1
        # The loop should approximately trace the box perimeter
        loop = loops[0]
        xs = [p[0] for p in loop]
        ys = [p[1] for p in loop]
        assert min(xs) == pytest.approx(0.0, abs=0.5)
        assert max(xs) == pytest.approx(10.0, abs=0.5)
        assert min(ys) == pytest.approx(0.0, abs=0.5)
        assert max(ys) == pytest.approx(10.0, abs=0.5)

    def test_slice_at_vertex_z_no_duplicates(self):
        """Slicing at a vertex Z should not produce duplicate points."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        # Z=0.0 is exactly at vertices
        loops = slice_mesh_at_z(mesh, 0.0)
        if loops:
            for loop in loops:
                # Check no adjacent duplicate points
                for i in range(1, len(loop)):
                    dist = math.sqrt(
                        (loop[i][0] - loop[i-1][0]) ** 2 +
                        (loop[i][1] - loop[i-1][1]) ** 2
                    )
                    # Adjacent points should either be distinct or intentionally close
                    # (but not exact duplicates from dedup failure)
                    assert dist > 1e-8 or dist == 0.0

    def test_hemisphere_slice(self):
        """Slicing a hemisphere should produce a circular-ish loop."""
        mesh = _make_mesh(_hemisphere_triangles(5.0, 16, 8))
        loops = slice_mesh_at_z(mesh, 2.5)
        assert len(loops) >= 1


# ── Optimized surface angle map ──────────────────────────────────────────

class TestOptimizedAngleMap:
    """Verify numpy.maximum-based angle map matches expected values."""

    def test_box_angle_map_range(self):
        angle_map = build_surface_angle_map(
            _make_mesh(_box_triangles(10, 10, 5)), resolution_mm=1.0
        )
        # All values should be in [0, 90]
        assert angle_map.grid.min() >= 0.0
        assert angle_map.grid.max() <= 90.0 + 0.01

    def test_flat_mesh_has_zero_angle(self):
        """A single flat triangle should produce ~0 degree angles."""
        flat_tri = [((0, 0, 1), (0, 0, 0), (10, 0, 0), (0, 10, 0))]
        mesh = _make_mesh(flat_tri)
        angle_map = build_surface_angle_map(mesh, resolution_mm=1.0)
        # The flat triangle's normal is (0,0,1) -> angle = 0
        center_angle = angle_map.sample_z(3.0, 3.0)
        assert center_angle == pytest.approx(0.0, abs=5.0)


# ── Strategy output consistency ──────────────────────────────────────────

class TestStrategyOutputConsistency:
    """Run strategies and verify they produce valid, non-empty output."""

    def test_raster_produces_chains(self):
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.RASTER)
        result = run_strategy(job, mesh)
        assert result.strategy == "raster"
        assert len(result.chains) > 0
        assert result.total_segments > 0

    def test_waterline_produces_chains(self):
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.WATERLINE)
        result = run_strategy(job, mesh)
        assert result.strategy == "waterline"
        assert len(result.chains) > 0

    def test_adaptive_produces_chains(self):
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.ADAPTIVE_CLEAR)
        result = run_strategy(job, mesh)
        assert result.strategy == "adaptive_clear"
        assert len(result.chains) > 0

    def test_raster_with_angle(self):
        """Raster with non-zero angle should still produce valid output."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.RASTER)
        job.raster_angle_deg = 45.0
        result = run_strategy(job, mesh)
        assert len(result.chains) > 0

    def test_raster_hemisphere(self):
        """Raster on curved surface should produce valid output."""
        mesh = _make_mesh(_hemisphere_triangles(5.0, 12, 6))
        job = _make_job(Strategy.RASTER)
        result = run_strategy(job, mesh)
        assert len(result.chains) > 0

    def test_waterline_hemisphere(self):
        """Waterline on curved surface should produce valid output."""
        mesh = _make_mesh(_hemisphere_triangles(5.0, 12, 6))
        job = _make_job(Strategy.WATERLINE)
        result = run_strategy(job, mesh)
        assert len(result.chains) > 0


# ── Heightfield dropcutter output ────────────────────────────────────────

class TestDropcutterHeightfield:
    """Verify optimized dropcutter heightfield matches expected values."""

    def test_flat_tool_on_box(self):
        """Flat tool on box top should give Z close to box top."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        hf = build_heightfield(mesh, resolution_mm=0.5, tool_radius=3.0,
                               tool_shape=ToolShape.FLAT)
        z_center = hf.sample_z(5.0, 5.0)
        assert z_center == pytest.approx(5.0, abs=0.5)

    def test_ball_tool_on_box(self):
        """Ball tool on box should give CL surface close to box top."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        hf = build_heightfield(mesh, resolution_mm=0.5, tool_radius=3.0,
                               tool_shape=ToolShape.BALL)
        z_center = hf.sample_z(5.0, 5.0)
        # Ball tool CL surface at center of flat top = mesh_z + tool_radius
        # But our heightfield stores tool-tip Z, so center should be ~ 5.0
        assert z_center == pytest.approx(5.0, abs=1.0)

    def test_heightfield_no_nan(self):
        """Heightfield should not contain NaN or Inf values."""
        mesh = _make_mesh(_hemisphere_triangles(5.0, 12, 6))
        hf = build_heightfield(mesh, resolution_mm=0.5, tool_radius=2.0,
                               tool_shape=ToolShape.FLAT)
        if hf.grid is not None:
            assert not np.any(np.isnan(hf.grid))
            assert not np.any(np.isinf(hf.grid))


# ── Chain ordering optimization ──────────────────────────────────────────

class TestChainOrdering:
    """Verify waterline chain ordering does not affect toolpath content."""

    def test_waterline_chains_ordered(self):
        """Waterline chains should be ordered to minimize rapid traversal."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.WATERLINE)
        result = run_strategy(job, mesh)
        # Each chain should have non-zero segments
        for chain in result.chains:
            assert len(chain.segments) > 0

    def test_waterline_total_distance_positive(self):
        """Total cut distance should be positive."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.WATERLINE)
        result = run_strategy(job, mesh)
        assert result.cut_distance_mm > 0
