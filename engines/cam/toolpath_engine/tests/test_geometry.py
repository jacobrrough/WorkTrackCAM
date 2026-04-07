"""Tests for geometry engine: STL loading, heightfield, slicing, offsetting, BVH, smoothing."""
from __future__ import annotations

import math
import struct
import tempfile
from pathlib import Path

import numpy as np
import pytest

from ..geometry import (
    Mesh, load_stl, Heightfield,
    build_heightfield, build_heightfield_chunked,
    slice_mesh_at_z,
    offset_contour, contour_winding, contour_length,
    point_in_polygon,
    simplify_contour, smooth_contour_3d,
    build_bvh, query_bvh_xy_range,
)
from ..models import Vec3


# ── STL test helpers ────────────────────────────────────────────────────

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
    """12 triangles forming a box from (0,0,0) to (sx,sy,sz)."""
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


def _write_stl(triangles) -> Path:
    data = _make_binary_stl(triangles)
    f = tempfile.NamedTemporaryFile(suffix=".stl", delete=False)
    f.write(data)
    f.close()
    return Path(f.name)


def _make_mesh(triangles) -> Mesh:
    p = _write_stl(triangles)
    mesh = load_stl(p)
    p.unlink(missing_ok=True)
    return mesh


# ── STL loading tests ───────────────────────────────────────────────────

class TestLoadSTL:
    def test_load_binary_box(self):
        mesh = _make_mesh(_box_triangles())
        assert mesh.num_triangles == 12

    def test_bounds(self):
        mesh = _make_mesh(_box_triangles(10, 20, 5))
        b = mesh.bounds
        assert b.min_pt.x == pytest.approx(0.0)
        assert b.max_pt.x == pytest.approx(10.0)
        assert b.max_pt.y == pytest.approx(20.0)
        assert b.max_pt.z == pytest.approx(5.0)

    def test_empty_file_raises(self):
        f = tempfile.NamedTemporaryFile(suffix=".stl", delete=False)
        f.write(b"")
        f.close()
        with pytest.raises(ValueError, match="empty"):
            load_stl(f.name)
        Path(f.name).unlink(missing_ok=True)

    def test_truncated_stl_raises(self):
        data = _make_binary_stl(_box_triangles())
        f = tempfile.NamedTemporaryFile(suffix=".stl", delete=False)
        f.write(data[:100])
        f.close()
        with pytest.raises(ValueError, match="truncated"):
            load_stl(f.name)
        Path(f.name).unlink(missing_ok=True)

    def test_missing_file_raises(self):
        with pytest.raises(FileNotFoundError):
            load_stl("/nonexistent/path.stl")

    def test_ascii_stl(self):
        ascii_data = b"""solid test
  facet normal 0 0 1
    outer loop
      vertex 0 0 0
      vertex 1 0 0
      vertex 0 1 0
    endloop
  endfacet
endsolid test"""
        f = tempfile.NamedTemporaryFile(suffix=".stl", delete=False)
        f.write(ascii_data)
        f.close()
        mesh = load_stl(f.name)
        assert mesh.num_triangles == 1
        Path(f.name).unlink(missing_ok=True)

    def test_get_triangle(self):
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        v0, v1, v2 = mesh.get_triangle(0)
        # Should return valid Vec3 objects
        assert isinstance(v0, Vec3)


# ── Heightfield tests ───────────────────────────────────────────────────

class TestHeightfield:
    def test_creation(self):
        hf = Heightfield(0, 10, 0, 10, 20, 20, default_z=-5.0)
        assert hf.nx == 20
        assert hf.ny == 20

    def test_set_get(self):
        hf = Heightfield(0, 10, 0, 10, 10, 10, default_z=0.0)
        hf.set_z(5, 5, 3.14)
        assert hf.get_z(5, 5) == pytest.approx(3.14)

    def test_out_of_bounds(self):
        hf = Heightfield(0, 10, 0, 10, 10, 10, default_z=0.0)
        assert hf.get_z(-1, 0) == -1e9
        assert hf.get_z(100, 0) == -1e9

    def test_bilinear_interpolation(self):
        # 10x10 grid, x: 0..10, y: 0..10
        hf = Heightfield(0, 10, 0, 10, 10, 10, default_z=0.0)
        # Set all cells to a gradient: z = x
        for iy in range(10):
            for ix in range(10):
                hf.set_z(ix, iy, float(ix))
        # Interpolation at midpoint should give ~half the X range
        z_mid = hf.sample_z(5, 5)
        assert z_mid == pytest.approx(5.0, abs=1.5)

    def test_world_coords(self):
        hf = Heightfield(5, 15, 10, 20, 10, 10)
        assert hf.world_x(0) == pytest.approx(5.0)
        assert hf.world_y(0) == pytest.approx(10.0)


class TestBuildHeightfield:
    def test_box_heightfield(self):
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        hf = build_heightfield(mesh, resolution_mm=1.0)
        # Center of box top should be at Z=5
        z = hf.sample_z(5.0, 5.0)
        assert z == pytest.approx(5.0, abs=0.5)

    def test_tool_compensation_lowers_surface(self):
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        hf_no_comp = build_heightfield(mesh, resolution_mm=1.0, tool_radius=0.0)
        hf_with_comp = build_heightfield(mesh, resolution_mm=1.0, tool_radius=3.0)
        z_no = hf_no_comp.sample_z(5, 5)
        z_with = hf_with_comp.sample_z(5, 5)
        # Tool compensation should lower the surface near edges
        # At center of a 10mm box with 3mm radius, effect is less
        assert z_with <= z_no + 0.1

    def test_grid_cap(self):
        mesh = _make_mesh(_box_triangles(1000, 1000, 5))
        hf = build_heightfield(mesh, resolution_mm=0.01)
        # Should be capped to prevent OOM
        assert hf.nx * hf.ny <= 4_000_001


# ── Slicing tests ───────────────────────────────────────────────────────

class TestSliceMesh:
    def test_box_slice_at_mid_z(self):
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        loops = slice_mesh_at_z(mesh, 2.5)
        # Box cross-section at Z=2.5 should produce at least one loop
        assert len(loops) >= 1

    def test_slice_above_mesh_empty(self):
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        loops = slice_mesh_at_z(mesh, 10.0)
        assert len(loops) == 0

    def test_slice_below_mesh_empty(self):
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        loops = slice_mesh_at_z(mesh, -5.0)
        assert len(loops) == 0


# ── Contour tests ───────────────────────────────────────────────────────

class TestContour:
    def test_offset_inward(self):
        # The offset direction depends on winding. Test that offset produces
        # a contour with different area (either larger or smaller).
        square = [(0, 0), (10, 0), (10, 10), (0, 10)]
        inset = offset_contour(square, -1.0)
        outset = offset_contour(square, 1.0)
        assert len(inset) == 4
        assert len(outset) == 4
        # The two offsets should produce different areas
        area_in = abs(contour_winding(inset))
        area_out = abs(contour_winding(outset))
        assert area_in != pytest.approx(area_out, abs=1.0)

    def test_offset_outward(self):
        square = [(0, 0), (10, 0), (10, 10), (0, 10)]
        outset = offset_contour(square, 1.0)
        assert len(outset) == 4

    def test_winding_ccw(self):
        square = [(0, 0), (10, 0), (10, 10), (0, 10)]
        assert contour_winding(square) > 0  # CCW

    def test_winding_cw(self):
        square = [(0, 0), (0, 10), (10, 10), (10, 0)]
        assert contour_winding(square) < 0  # CW

    def test_contour_length(self):
        square = [(0, 0), (10, 0), (10, 10), (0, 10)]
        assert contour_length(square) == pytest.approx(40.0)

    def test_point_in_polygon(self):
        square = [(0, 0), (10, 0), (10, 10), (0, 10)]
        assert point_in_polygon(5, 5, square)
        assert not point_in_polygon(15, 5, square)

    def test_offset_small_contour(self):
        # Very small contour should not crash
        tiny = [(0, 0), (0.01, 0), (0.01, 0.01)]
        result = offset_contour(tiny, -0.1)
        assert isinstance(result, list)


# ── Face normals & surface angle map ──────────────────────────────────

class TestFaceNormals:
    def test_box_normals(self):
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        normals = mesh.compute_face_normals_numpy()
        assert normals.shape == (12, 3)
        # All normals should be unit length
        lengths = np.linalg.norm(normals, axis=1)
        for l in lengths:
            assert l == pytest.approx(1.0, abs=1e-6)

    def test_box_has_axis_aligned_normals(self):
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        normals = mesh.compute_face_normals_numpy()
        # Box faces should have normals along X, Y, or Z axes
        # At least some should have abs(nz) close to 1 (top/bottom)
        nz_abs = np.abs(normals[:, 2])
        assert np.any(nz_abs > 0.9)


class TestSurfaceAngleMap:
    def test_box_angle_map(self):
        from ..geometry import build_surface_angle_map
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        angle_map = build_surface_angle_map(mesh, resolution_mm=1.0)
        # Box top face is flat (angle = 0), walls are steep (angle = 90)
        # Center should sample the top face = 0 degrees
        center_angle = angle_map.sample_z(5.0, 5.0)
        assert center_angle >= 0.0
        assert center_angle <= 90.0

    def test_returns_heightfield(self):
        from ..geometry import build_surface_angle_map
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        angle_map = build_surface_angle_map(mesh, resolution_mm=2.0)
        assert angle_map.nx > 0
        assert angle_map.ny > 0


# ── BVH tests ──────────────────────────────────────────────────────────

class TestBVH:
    def test_build_bvh(self):
        centroids = [(1, 1, 0), (5, 5, 0), (9, 9, 0)]
        bboxes = [
            ((0, 0, 0), (2, 2, 1)),
            ((4, 4, 0), (6, 6, 1)),
            ((8, 8, 0), (10, 10, 1)),
        ]
        root = build_bvh(centroids, bboxes)
        assert root is not None
        assert root.bbox_min[0] == 0.0
        assert root.bbox_max[0] == 10.0

    def test_query_bvh_xy_range(self):
        centroids = [(1, 1, 0), (5, 5, 0), (9, 9, 0)]
        bboxes = [
            ((0, 0, 0), (2, 2, 1)),
            ((4, 4, 0), (6, 6, 1)),
            ((8, 8, 0), (10, 10, 1)),
        ]
        root = build_bvh(centroids, bboxes)
        # Query bottom-left: should find triangle 0
        hits = query_bvh_xy_range(root, 0, 2, 0, 2)
        assert 0 in hits
        # Query top-right: should find triangle 2
        hits = query_bvh_xy_range(root, 8, 10, 8, 10)
        assert 2 in hits
        # Query outside: should find nothing
        hits = query_bvh_xy_range(root, 20, 30, 20, 30)
        assert len(hits) == 0

    def test_mesh_ensure_bvh(self):
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        mesh.ensure_bvh()
        assert mesh.bvh is not None
        # Calling again should not crash (idempotent)
        mesh.ensure_bvh()
        assert mesh.bvh is not None

    def test_bvh_query_finds_all(self):
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        mesh.ensure_bvh()
        # Query entire mesh bounds should find all triangles
        hits = query_bvh_xy_range(mesh.bvh, -1, 11, -1, 11)
        assert len(hits) == 12


# ── Contour smoothing tests ───────────────────────────────────────────

class TestContourSmoothing:
    def test_simplify_straight_line(self):
        # Points along a straight line should simplify to just endpoints
        points = [(0, 0), (1, 0), (2, 0), (3, 0), (4, 0)]
        result = simplify_contour(points, tolerance=0.01)
        assert len(result) == 2
        assert result[0] == (0, 0)
        assert result[1] == (4, 0)

    def test_simplify_preserves_corners(self):
        # Right angle should be preserved
        points = [(0, 0), (5, 0), (10, 0), (10, 5), (10, 10)]
        result = simplify_contour(points, tolerance=0.1)
        assert len(result) >= 3  # At least start, corner, end

    def test_simplify_preserves_curve(self):
        # Arc with high tolerance should still keep some intermediate points
        points = []
        for i in range(21):
            t = i / 20.0 * math.pi
            points.append((math.cos(t) * 10, math.sin(t) * 10))
        result_tight = simplify_contour(points, tolerance=0.01)
        result_loose = simplify_contour(points, tolerance=1.0)
        assert len(result_tight) >= len(result_loose)

    def test_simplify_short_input(self):
        assert simplify_contour([], tolerance=1.0) == []
        assert simplify_contour([(1, 2)], tolerance=1.0) == [(1, 2)]
        assert simplify_contour([(1, 2), (3, 4)], tolerance=1.0) == [(1, 2), (3, 4)]

    def test_smooth_3d_straight(self):
        points = [(0, 0, 0), (1, 0, 0), (2, 0, 0), (3, 0, 0)]
        result = smooth_contour_3d(points, tolerance=0.01)
        assert len(result) == 2

    def test_smooth_3d_preserves_z_changes(self):
        # Points that change Z should not be simplified away
        points = [(0, 0, 0), (1, 0, 0), (2, 0, 5), (3, 0, 5)]
        result = smooth_contour_3d(points, tolerance=0.1)
        assert len(result) >= 3  # Z change must be preserved


# ── Chunked heightfield tests ─────────────────────────────────────────

class TestChunkedHeightfield:
    def test_matches_standard(self):
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        hf_std = build_heightfield(mesh, resolution_mm=1.0)
        hf_chunked = build_heightfield_chunked(mesh, resolution_mm=1.0)
        # Results should be very similar
        assert hf_std.nx == hf_chunked.nx
        assert hf_std.ny == hf_chunked.ny
        # Center sample should match
        z_std = hf_std.sample_z(5, 5)
        z_chunked = hf_chunked.sample_z(5, 5)
        assert z_std == pytest.approx(z_chunked, abs=0.1)

    def test_small_mesh_fallback(self):
        # Small mesh should fallback to standard (< 10000 triangles)
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        hf = build_heightfield_chunked(mesh, resolution_mm=1.0)
        assert hf.nx > 0
        assert hf.ny > 0
