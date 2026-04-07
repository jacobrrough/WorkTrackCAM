"""Tests for geometry engine: STL loading, heightfield, slicing, offsetting."""
from __future__ import annotations

import math
import struct
import tempfile
from pathlib import Path

import pytest

from ..geometry import (
    Mesh,
    Heightfield,
    load_stl,
    build_heightfield,
    slice_mesh_at_z,
    offset_contour,
    contour_winding,
    _ray_z_at_xy,
)
from ..models import Vec3


# ── Helpers to create test STL data ──────────────────────────────────────

def _make_binary_stl(triangles: list[tuple]) -> bytes:
    """
    Build a binary STL from triangle specs.

    Each triangle: ((nx,ny,nz), (v0x,v0y,v0z), (v1x,v1y,v1z), (v2x,v2y,v2z))
    """
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


def _flat_square_triangles(size: float = 10.0, z: float = 0.0):
    """Two triangles forming a flat square at height z, from (0,0) to (size,size)."""
    return [
        ((0, 0, 1), (0, 0, z), (size, 0, z), (size, size, z)),
        ((0, 0, 1), (0, 0, z), (size, size, z), (0, size, z)),
    ]


def _box_triangles(sx: float = 10.0, sy: float = 10.0, sz: float = 5.0):
    """12 triangles forming a box from (0,0,0) to (sx,sy,sz)."""
    # Just top and bottom faces for heightfield testing
    tris = []
    # Bottom (z=0)
    tris.append(((0, 0, -1), (0, 0, 0), (sx, sy, 0), (sx, 0, 0)))
    tris.append(((0, 0, -1), (0, 0, 0), (0, sy, 0), (sx, sy, 0)))
    # Top (z=sz)
    tris.append(((0, 0, 1), (0, 0, sz), (sx, 0, sz), (sx, sy, sz)))
    tris.append(((0, 0, 1), (0, 0, sz), (sx, sy, sz), (0, sy, sz)))
    # Front (y=0)
    tris.append(((0, -1, 0), (0, 0, 0), (sx, 0, 0), (sx, 0, sz)))
    tris.append(((0, -1, 0), (0, 0, 0), (sx, 0, sz), (0, 0, sz)))
    # Back (y=sy)
    tris.append(((0, 1, 0), (0, sy, 0), (0, sy, sz), (sx, sy, sz)))
    tris.append(((0, 1, 0), (0, sy, 0), (sx, sy, sz), (sx, sy, 0)))
    # Left (x=0)
    tris.append(((-1, 0, 0), (0, 0, 0), (0, 0, sz), (0, sy, sz)))
    tris.append(((-1, 0, 0), (0, 0, 0), (0, sy, sz), (0, sy, 0)))
    # Right (x=sx)
    tris.append(((1, 0, 0), (sx, 0, 0), (sx, sy, 0), (sx, sy, sz)))
    tris.append(((1, 0, 0), (sx, 0, 0), (sx, sy, sz), (sx, 0, sz)))
    return tris


def _write_tmp_stl(tris) -> str:
    """Write triangles to a temp STL file, return path."""
    data = _make_binary_stl(tris)
    f = tempfile.NamedTemporaryFile(suffix=".stl", delete=False)
    f.write(data)
    f.close()
    return f.name


class TestRayZAtXY:
    def test_center_of_triangle(self):
        # Triangle at z=5 from (0,0) to (10,0) to (5,10)
        z = _ray_z_at_xy(5, 3, 0, 0, 5, 10, 0, 5, 5, 10, 5)
        assert z is not None
        assert abs(z - 5.0) < 1e-6

    def test_outside_triangle(self):
        z = _ray_z_at_xy(20, 20, 0, 0, 5, 10, 0, 5, 5, 10, 5)
        assert z is None

    def test_sloped_triangle(self):
        # Triangle: (0,0,0), (10,0,0), (5,10,10)
        z = _ray_z_at_xy(5, 5, 0, 0, 0, 10, 0, 0, 5, 10, 10)
        assert z is not None
        assert z > 0  # somewhere on the slope


class TestLoadStl:
    def test_load_flat_square(self):
        path = _write_tmp_stl(_flat_square_triangles())
        try:
            mesh = load_stl(path)
            assert mesh.num_triangles == 2
            b = mesh.bounds
            assert abs(b.min_pt.x - 0.0) < 1e-3
            assert abs(b.max_pt.x - 10.0) < 1e-3
            assert abs(b.min_pt.z) < 1e-3
        finally:
            Path(path).unlink(missing_ok=True)

    def test_load_box(self):
        path = _write_tmp_stl(_box_triangles(10, 10, 5))
        try:
            mesh = load_stl(path)
            assert mesh.num_triangles == 12
            b = mesh.bounds
            assert abs(b.max_pt.z - 5.0) < 1e-3
        finally:
            Path(path).unlink(missing_ok=True)

    def test_empty_stl_raises(self):
        data = b"\x00" * 80 + struct.pack("<I", 0)
        f = tempfile.NamedTemporaryFile(suffix=".stl", delete=False)
        f.write(data)
        f.close()
        try:
            with pytest.raises(ValueError, match="0 triangles"):
                load_stl(f.name)
        finally:
            Path(f.name).unlink(missing_ok=True)

    def test_truncated_stl_raises(self):
        data = b"\x00" * 80 + struct.pack("<I", 100)  # claims 100 triangles
        f = tempfile.NamedTemporaryFile(suffix=".stl", delete=False)
        f.write(data)
        f.close()
        try:
            with pytest.raises(ValueError, match="truncated"):
                load_stl(f.name)
        finally:
            Path(f.name).unlink(missing_ok=True)


class TestHeightfield:
    def test_basic_grid(self):
        hf = Heightfield(0, 10, 0, 10, 11, 11, default_z=-1.0)
        assert hf.get_z(0, 0) == -1.0
        hf.set_z(5, 5, 3.0)
        assert hf.get_z(5, 5) == 3.0

    def test_sample_z_interpolation(self):
        # 3x3 grid from (0,0) to (10,10) → dx=dy=5, cells at x=[0,5,10], y=[0,5,10]
        hf = Heightfield(0, 10, 0, 10, 3, 3, default_z=0.0)
        # Column 0 (x=0) = 0, column 1 (x=5) = 5, column 2 (x=10) = 10
        for iy in range(3):
            hf.set_z(0, iy, 0.0)
            hf.set_z(1, iy, 5.0)
            hf.set_z(2, iy, 10.0)
        # At x=2.5 (between column 0 and 1), should interpolate between 0 and 5
        z = hf.sample_z(2.5, 5.0)
        assert 0.0 <= z <= 5.0

    def test_world_coordinates(self):
        hf = Heightfield(10, 20, 30, 40, 11, 11)
        assert hf.world_x(0) == 10.0
        assert hf.world_y(0) == 30.0


class TestBuildHeightfield:
    def test_flat_square(self):
        path = _write_tmp_stl(_flat_square_triangles(10, z=5.0))
        try:
            mesh = load_stl(path)
            hf = build_heightfield(mesh, resolution_mm=1.0)
            # Center of the square should be at z=5
            z = hf.sample_z(5.0, 5.0)
            assert abs(z - 5.0) < 0.5
        finally:
            Path(path).unlink(missing_ok=True)

    def test_box_top(self):
        path = _write_tmp_stl(_box_triangles(10, 10, 5))
        try:
            mesh = load_stl(path)
            hf = build_heightfield(mesh, resolution_mm=1.0)
            z = hf.sample_z(5.0, 5.0)
            assert abs(z - 5.0) < 0.5
        finally:
            Path(path).unlink(missing_ok=True)


class TestSliceMeshAtZ:
    def test_slice_box_mid_height(self):
        path = _write_tmp_stl(_box_triangles(10, 10, 5))
        try:
            mesh = load_stl(path)
            loops = slice_mesh_at_z(mesh, 2.5)
            assert len(loops) >= 1
            # At least one loop with 4+ points (rectangle cross-section)
            max_pts = max(len(l) for l in loops)
            assert max_pts >= 4
        finally:
            Path(path).unlink(missing_ok=True)

    def test_slice_above_mesh(self):
        path = _write_tmp_stl(_box_triangles(10, 10, 5))
        try:
            mesh = load_stl(path)
            loops = slice_mesh_at_z(mesh, 10.0)
            assert len(loops) == 0
        finally:
            Path(path).unlink(missing_ok=True)


class TestOffsetContour:
    def test_square_offset_changes_area(self):
        # CCW square: offset produces contours with different area
        square = [(0, 0), (10, 0), (10, 10), (0, 10)]
        area_orig = abs(contour_winding(square))

        offset_pos = offset_contour(square, 1.0)
        offset_neg = offset_contour(square, -1.0)
        assert len(offset_pos) == 4
        assert len(offset_neg) == 4

        area_pos = abs(contour_winding(offset_pos))
        area_neg = abs(contour_winding(offset_neg))

        # One direction should be larger, the other smaller
        assert area_pos != pytest.approx(area_neg, abs=1.0)
        assert (area_pos > area_orig) != (area_neg > area_orig)

    def test_square_offset_preserves_count(self):
        square = [(0, 0), (10, 0), (10, 10), (0, 10)]
        offset = offset_contour(square, 0.5)
        assert len(offset) == 4

    def test_too_few_points(self):
        result = offset_contour([(0, 0), (1, 1)], 1.0)
        assert len(result) == 2  # returned unchanged


class TestContourWinding:
    def test_ccw_positive(self):
        ccw = [(0, 0), (10, 0), (10, 10), (0, 10)]
        area = contour_winding(ccw)
        assert area > 0  # CCW = positive

    def test_cw_negative(self):
        cw = [(0, 0), (0, 10), (10, 10), (10, 0)]
        area = contour_winding(cw)
        assert area < 0  # CW = negative

    def test_area_value(self):
        square = [(0, 0), (10, 0), (10, 10), (0, 10)]
        area = abs(contour_winding(square))
        assert abs(area - 100.0) < 1e-6
