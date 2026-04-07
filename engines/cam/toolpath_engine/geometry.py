"""
Geometry engine: STL loading, drop-cutter toolpath sampling, BVH-accelerated
mesh queries, heightfield construction, Z-slicing, robust contour operations.

v4.0 — Production-grade drop-cutter implementation for flat/ball/bull endmills.

Key capabilities:
- Drop-cutter algorithm with 7 sub-tests per triangle (3 vertex, 3 edge, 1 facet)
  for each tool shape, matching OpenCAMLib methodology
- BVH spatial index for O(log n) triangle queries
- Hash-based O(n) segment chaining for mesh slicing
- Robust contour offset with self-intersection removal
- Vectorized heightfield construction with tool compensation
- Cylindrical drop-cutter for 4-axis operations
- Directional ray-cast for 5-axis collision detection
- Douglas-Peucker simplification for 3D toolpaths
"""
from __future__ import annotations

import math
import struct
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False

from .models import AABB, Vec3, ToolShape


# ── BVH (Bounding Volume Hierarchy) ───────────────────────────────────

class _BVHNode:
    """Binary BVH node for spatial acceleration of triangle queries."""
    __slots__ = ("bbox_min", "bbox_max", "left", "right", "tri_indices")

    def __init__(self):
        self.bbox_min: tuple[float, float, float] = (0.0, 0.0, 0.0)
        self.bbox_max: tuple[float, float, float] = (0.0, 0.0, 0.0)
        self.left: _BVHNode | None = None
        self.right: _BVHNode | None = None
        self.tri_indices: list[int] | None = None  # leaf only


def build_bvh(centroids: list[tuple[float, float, float]],
              tri_bboxes: list[tuple[tuple[float, float, float], tuple[float, float, float]]],
              indices: list[int] | None = None,
              max_leaf: int = 8) -> _BVHNode:
    """Build a BVH from triangle centroids and bounding boxes. O(n log n)."""
    if indices is None:
        indices = list(range(len(centroids)))

    node = _BVHNode()
    if not indices:
        return node

    bmin = [float("inf")] * 3
    bmax = [float("-inf")] * 3
    for i in indices:
        for d in range(3):
            bmin[d] = min(bmin[d], tri_bboxes[i][0][d])
            bmax[d] = max(bmax[d], tri_bboxes[i][1][d])
    node.bbox_min = (bmin[0], bmin[1], bmin[2])
    node.bbox_max = (bmax[0], bmax[1], bmax[2])

    if len(indices) <= max_leaf:
        node.tri_indices = indices
        return node

    # Split on longest axis at midpoint
    extents = [bmax[d] - bmin[d] for d in range(3)]
    axis = extents.index(max(extents))
    mid = (bmin[axis] + bmax[axis]) * 0.5

    left_idx = [i for i in indices if centroids[i][axis] <= mid]
    right_idx = [i for i in indices if centroids[i][axis] > mid]

    if not left_idx or not right_idx:
        indices_sorted = sorted(indices, key=lambda i: centroids[i][axis])
        half = len(indices_sorted) // 2
        left_idx = indices_sorted[:half]
        right_idx = indices_sorted[half:]

    node.left = build_bvh(centroids, tri_bboxes, left_idx, max_leaf)
    node.right = build_bvh(centroids, tri_bboxes, right_idx, max_leaf)
    return node


def query_bvh_xy_range(node: _BVHNode, x_lo: float, x_hi: float,
                       y_lo: float, y_hi: float) -> list[int]:
    """Query BVH for triangles whose XY bbox overlaps the given range."""
    result: list[int] = []
    _query_bvh_xy_range_recursive(node, x_lo, x_hi, y_lo, y_hi, result)
    return result


def _query_bvh_xy_range_recursive(node: _BVHNode, x_lo: float, x_hi: float,
                                  y_lo: float, y_hi: float, result: list[int]) -> None:
    if node is None:
        return
    if (node.bbox_max[0] < x_lo or node.bbox_min[0] > x_hi or
            node.bbox_max[1] < y_lo or node.bbox_min[1] > y_hi):
        return
    if node.tri_indices is not None:
        result.extend(node.tri_indices)
        return
    _query_bvh_xy_range_recursive(node.left, x_lo, x_hi, y_lo, y_hi, result)
    _query_bvh_xy_range_recursive(node.right, x_lo, x_hi, y_lo, y_hi, result)


def query_bvh_sphere(node: _BVHNode, cx: float, cy: float, cz: float,
                     radius: float) -> list[int]:
    """Query BVH for triangles whose bbox overlaps a sphere."""
    result: list[int] = []
    _query_bvh_sphere_recursive(node, cx, cy, cz, radius, result)
    return result


def _query_bvh_sphere_recursive(node: _BVHNode, cx: float, cy: float, cz: float,
                                radius: float, result: list[int]) -> None:
    if node is None:
        return
    # AABB-sphere overlap: find closest point on AABB to sphere center
    dx = max(node.bbox_min[0] - cx, 0.0, cx - node.bbox_max[0])
    dy = max(node.bbox_min[1] - cy, 0.0, cy - node.bbox_max[1])
    dz = max(node.bbox_min[2] - cz, 0.0, cz - node.bbox_max[2])
    if dx * dx + dy * dy + dz * dz > radius * radius:
        return
    if node.tri_indices is not None:
        result.extend(node.tri_indices)
        return
    _query_bvh_sphere_recursive(node.left, cx, cy, cz, radius, result)
    _query_bvh_sphere_recursive(node.right, cx, cy, cz, radius, result)


# ── Mesh ────────────────────────────────────────────────────────────────

class Mesh:
    """
    Triangle mesh loaded from STL.

    Stores vertices as flat arrays for fast numpy operations.
    Each triangle i has vertices at indices [i*3, i*3+1, i*3+2].
    """
    __slots__ = ("_verts", "_norms", "_verts_list", "_norms_list",
                 "num_triangles", "_bounds", "_tri_bvh")

    def __init__(
        self,
        vertices: list[tuple[float, float, float]] | None = None,
        normals: list[tuple[float, float, float]] | None = None,
    ):
        self._tri_bvh = None
        if HAS_NUMPY:
            self._verts = np.array(vertices or [], dtype=np.float64).reshape(-1, 3)
            self._norms = np.array(normals or [], dtype=np.float64).reshape(-1, 3)
            self._verts_list = None
            self._norms_list = None
        else:
            self._verts = None
            self._norms = None
            self._verts_list = list(vertices or [])
            self._norms_list = list(normals or [])

        self.num_triangles = (
            (len(self._verts) // 3) if HAS_NUMPY
            else (len(self._verts_list) // 3)
        )
        self._bounds: AABB | None = None

    @property
    def bounds(self) -> AABB:
        if self._bounds is not None:
            return self._bounds
        if self.num_triangles == 0:
            self._bounds = AABB(Vec3(0, 0, 0), Vec3(0, 0, 0))
            return self._bounds
        if HAS_NUMPY:
            mn = self._verts.min(axis=0)
            mx = self._verts.max(axis=0)
            self._bounds = AABB(Vec3(float(mn[0]), float(mn[1]), float(mn[2])),
                                Vec3(float(mx[0]), float(mx[1]), float(mx[2])))
        else:
            xs = [v[0] for v in self._verts_list]
            ys = [v[1] for v in self._verts_list]
            zs = [v[2] for v in self._verts_list]
            self._bounds = AABB(Vec3(min(xs), min(ys), min(zs)),
                                Vec3(max(xs), max(ys), max(zs)))
        return self._bounds

    def get_triangle(self, i: int) -> tuple[Vec3, Vec3, Vec3]:
        if HAS_NUMPY:
            v0 = self._verts[i * 3]
            v1 = self._verts[i * 3 + 1]
            v2 = self._verts[i * 3 + 2]
            return Vec3(float(v0[0]), float(v0[1]), float(v0[2])), \
                   Vec3(float(v1[0]), float(v1[1]), float(v1[2])), \
                   Vec3(float(v2[0]), float(v2[1]), float(v2[2]))
        else:
            base = i * 3
            return (Vec3(*self._verts_list[base]),
                    Vec3(*self._verts_list[base + 1]),
                    Vec3(*self._verts_list[base + 2]))

    def get_triangle_raw(self, i: int) -> tuple[
        tuple[float, float, float],
        tuple[float, float, float],
        tuple[float, float, float],
    ]:
        """Get triangle as raw float tuples (faster than Vec3 for inner loops)."""
        if HAS_NUMPY:
            v0 = self._verts[i * 3]
            v1 = self._verts[i * 3 + 1]
            v2 = self._verts[i * 3 + 2]
            return ((float(v0[0]), float(v0[1]), float(v0[2])),
                    (float(v1[0]), float(v1[1]), float(v1[2])),
                    (float(v2[0]), float(v2[1]), float(v2[2])))
        else:
            base = i * 3
            return (self._verts_list[base],
                    self._verts_list[base + 1],
                    self._verts_list[base + 2])

    def get_vertices_numpy(self):
        if not HAS_NUMPY:
            raise RuntimeError("numpy required for get_vertices_numpy")
        return self._verts

    def get_triangle_vertices_numpy(self):
        if not HAS_NUMPY:
            raise RuntimeError("numpy required")
        return self._verts.reshape(-1, 3, 3)

    def compute_face_normals_numpy(self):
        """Compute per-face unit normals via cross product. Returns (N, 3) array."""
        if not HAS_NUMPY:
            raise RuntimeError("numpy required")
        tris = self.get_triangle_vertices_numpy()
        e1 = tris[:, 1, :] - tris[:, 0, :]
        e2 = tris[:, 2, :] - tris[:, 0, :]
        normals = np.cross(e1, e2)
        lengths = np.linalg.norm(normals, axis=1, keepdims=True)
        lengths = np.where(lengths < 1e-12, 1.0, lengths)
        return normals / lengths

    def ensure_bvh(self) -> None:
        """Build BVH spatial index if not already built."""
        if self._tri_bvh is not None:
            return
        if self.num_triangles == 0:
            return

        centroids: list[tuple[float, float, float]] = []
        tri_bboxes: list[tuple[tuple[float, float, float], tuple[float, float, float]]] = []

        if HAS_NUMPY and self._verts is not None:
            # Vectorized centroid and bbox computation — avoids per-triangle
            # Python loop which is the dominant cost for large meshes.
            tris = self.get_triangle_vertices_numpy()  # (N, 3, 3)
            mn = tris.min(axis=1)  # (N, 3)
            mx = tris.max(axis=1)  # (N, 3)
            ctrs = (mn + mx) * 0.5  # (N, 3)
            # Convert to list-of-tuples for BVH builder
            centroids = [
                (float(ctrs[i, 0]), float(ctrs[i, 1]), float(ctrs[i, 2]))
                for i in range(self.num_triangles)
            ]
            tri_bboxes = [
                ((float(mn[i, 0]), float(mn[i, 1]), float(mn[i, 2])),
                 (float(mx[i, 0]), float(mx[i, 1]), float(mx[i, 2])))
                for i in range(self.num_triangles)
            ]
        else:
            for i in range(self.num_triangles):
                v0, v1, v2 = self.get_triangle(i)
                mn = (min(v0.x, v1.x, v2.x), min(v0.y, v1.y, v2.y), min(v0.z, v1.z, v2.z))
                mx = (max(v0.x, v1.x, v2.x), max(v0.y, v1.y, v2.y), max(v0.z, v1.z, v2.z))
                centroids.append(((mn[0]+mx[0])*0.5, (mn[1]+mx[1])*0.5, (mn[2]+mx[2])*0.5))
                tri_bboxes.append((mn, mx))

        self._tri_bvh = build_bvh(centroids, tri_bboxes)

    @property
    def bvh(self) -> _BVHNode | None:
        return self._tri_bvh


# ── STL loading ─────────────────────────────────────────────────────────

def load_stl(path: str | Path) -> Mesh:
    """Load an STL file (binary or ASCII) into a Mesh."""
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"STL file not found: {p}")
    data = p.read_bytes()
    if len(data) == 0:
        raise ValueError("STL file is empty (0 bytes)")
    if _is_ascii_stl(data):
        return _load_ascii_stl(data)
    return _load_binary_stl(data)


def _is_ascii_stl(data: bytes) -> bool:
    if not data[:5].lower().startswith(b"solid"):
        return False
    if len(data) < 84:
        return True
    tri_count = struct.unpack_from("<I", data, 80)[0]
    expected_size = 84 + tri_count * 50
    if len(data) == expected_size:
        return False
    return b"endsolid" in data[-256:]


def _load_binary_stl(data: bytes) -> Mesh:
    if len(data) < 84:
        raise ValueError(f"Binary STL too short: {len(data)} bytes")
    tri_count = struct.unpack_from("<I", data, 80)[0]
    if tri_count == 0:
        raise ValueError("STL contains 0 triangles")
    expected = 84 + tri_count * 50
    if len(data) < expected:
        raise ValueError(f"STL truncated: expected {expected} bytes, got {len(data)}")

    if HAS_NUMPY:
        dt = np.dtype([
            ("normal", "<f4", (3,)),
            ("v0", "<f4", (3,)),
            ("v1", "<f4", (3,)),
            ("v2", "<f4", (3,)),
            ("attr", "<u2"),
        ])
        tris = np.frombuffer(data, dtype=dt, count=tri_count, offset=84)
        normals = tris["normal"].astype(np.float64)
        v0 = tris["v0"].astype(np.float64)
        v1 = tris["v1"].astype(np.float64)
        v2 = tris["v2"].astype(np.float64)
        verts = np.empty((tri_count * 3, 3), dtype=np.float64)
        verts[0::3] = v0
        verts[1::3] = v1
        verts[2::3] = v2
        mesh = Mesh.__new__(Mesh)
        mesh._verts = verts
        mesh._norms = normals
        mesh._verts_list = None
        mesh._norms_list = None
        mesh.num_triangles = tri_count
        mesh._bounds = None
        mesh._tri_bvh = None
        return mesh
    else:
        vertices: list[tuple[float, float, float]] = []
        normals_list: list[tuple[float, float, float]] = []
        offset = 84
        for _ in range(tri_count):
            nx, ny, nz = struct.unpack_from("<fff", data, offset)
            normals_list.append((nx, ny, nz))
            offset += 12
            for _ in range(3):
                x, y, z = struct.unpack_from("<fff", data, offset)
                vertices.append((x, y, z))
                offset += 12
            offset += 2
        return Mesh(vertices=vertices, normals=normals_list)


def _load_ascii_stl(data: bytes) -> Mesh:
    text = data.decode("utf-8", errors="replace")
    vertices: list[tuple[float, float, float]] = []
    normals: list[tuple[float, float, float]] = []

    for line in text.splitlines():
        line = line.strip()
        if line.startswith("facet normal"):
            parts = line.split()
            if len(parts) >= 5:
                normals.append((float(parts[2]), float(parts[3]), float(parts[4])))
        elif line.startswith("vertex"):
            parts = line.split()
            if len(parts) >= 4:
                vertices.append((float(parts[1]), float(parts[2]), float(parts[3])))

    if len(vertices) == 0:
        raise ValueError("ASCII STL contains no vertices")
    if len(vertices) % 3 != 0:
        raise ValueError(f"ASCII STL vertex count {len(vertices)} not divisible by 3")
    return Mesh(vertices=vertices, normals=normals)


# ═══════════════════════════════════════════════════════════════════════
# DROP-CUTTER ALGORITHM
#
# The core of accurate 3-axis toolpath generation. For a given (x,y)
# position, determines the highest Z at which the tool contacts the mesh.
#
# For each triangle, tests 7 contact cases:
#   3 vertex contacts  — tool touches a vertex of the triangle
#   3 edge contacts    — tool touches an edge of the triangle
#   1 facet contact    — tool touches the interior of the triangle
#
# Supports flat endmill, ball endmill, and bull-nose (toroidal) endmill.
# ═══════════════════════════════════════════════════════════════════════

def drop_cutter_z(
    mesh: Mesh,
    x: float,
    y: float,
    tool_radius: float,
    tool_shape: ToolShape = ToolShape.FLAT,
    corner_radius: float = 0.0,
    default_z: float = -1e9,
) -> float:
    """
    Drop a tool at position (x,y) and find the highest Z contact with the mesh.

    This is the fundamental operation for generating accurate 3-axis toolpaths.
    The tool center is at (x, y, z) where z is the returned value.

    Args:
        mesh: Triangle mesh to test against
        x, y: Tool center XY position
        tool_radius: Tool radius in mm
        tool_shape: FLAT, BALL, or BULL
        corner_radius: Corner radius for BULL endmill
        default_z: Returned if no contact found

    Returns:
        Z position of tool center at highest contact point
    """
    mesh.ensure_bvh()
    best_z = default_z

    # Query BVH for nearby triangles
    if mesh.bvh is not None:
        tri_ids = query_bvh_xy_range(
            mesh.bvh,
            x - tool_radius, x + tool_radius,
            y - tool_radius, y + tool_radius,
        )
    else:
        tri_ids = range(mesh.num_triangles)

    r = tool_radius
    r_sq = r * r

    for ti in tri_ids:
        v0, v1, v2 = mesh.get_triangle_raw(ti)

        if tool_shape == ToolShape.FLAT:
            z = _dc_flat_triangle(x, y, r, r_sq, v0, v1, v2)
        elif tool_shape == ToolShape.BALL:
            z = _dc_ball_triangle(x, y, r, r_sq, v0, v1, v2)
        elif tool_shape == ToolShape.BULL:
            cr = corner_radius if corner_radius > 0 else 0.0
            z = _dc_bull_triangle(x, y, r, r_sq, cr, v0, v1, v2)
        else:
            z = _dc_flat_triangle(x, y, r, r_sq, v0, v1, v2)

        if z > best_z:
            best_z = z

    return best_z


# ── Flat endmill drop-cutter ───────────────────────────────────────────

def _dc_flat_triangle(
    cx: float, cy: float, r: float, r_sq: float,
    v0: tuple, v1: tuple, v2: tuple,
) -> float:
    """Drop flat endmill onto a triangle. Returns tool-tip Z or -inf."""
    best_z = -1e18

    # Test 1-3: Vertex contacts (point under cylindrical tool)
    for v in (v0, v1, v2):
        dx = v[0] - cx
        dy = v[1] - cy
        if dx * dx + dy * dy <= r_sq:
            if v[2] > best_z:
                best_z = v[2]

    # Test 4-6: Edge contacts
    edges = ((v0, v1), (v1, v2), (v2, v0))
    for a, b in edges:
        z = _dc_flat_edge(cx, cy, r, r_sq, a, b)
        if z > best_z:
            best_z = z

    # Test 7: Facet contact (point (cx,cy) inside triangle projection)
    z = _dc_flat_facet(cx, cy, v0, v1, v2)
    if z > best_z:
        best_z = z

    return best_z


def _dc_flat_edge(
    cx: float, cy: float, r: float, r_sq: float,
    a: tuple, b: tuple,
) -> float:
    """Test flat endmill contact with a triangle edge."""
    # Project onto edge in XY and find closest point
    ex = b[0] - a[0]
    ey = b[1] - a[1]
    e_len_sq = ex * ex + ey * ey
    if e_len_sq < 1e-20:
        return -1e18

    # Parameter along edge
    t = ((cx - a[0]) * ex + (cy - a[1]) * ey) / e_len_sq
    t = max(0.0, min(1.0, t))

    # Closest point on edge in XY
    px = a[0] + t * ex
    py = a[1] + t * ey

    dx = px - cx
    dy = py - cy
    if dx * dx + dy * dy > r_sq:
        return -1e18

    # Z at this point on the edge
    return a[2] + t * (b[2] - a[2])


def _dc_flat_facet(
    cx: float, cy: float,
    v0: tuple, v1: tuple, v2: tuple,
) -> float:
    """Test flat endmill contact with triangle interior (facet test)."""
    # Check if (cx, cy) is inside the triangle in XY projection
    # using barycentric coordinates
    e0x = v2[0] - v0[0]
    e0y = v2[1] - v0[1]
    e1x = v1[0] - v0[0]
    e1y = v1[1] - v0[1]

    dot00 = e0x * e0x + e0y * e0y
    dot01 = e0x * e1x + e0y * e1y
    dot11 = e1x * e1x + e1y * e1y
    denom = dot00 * dot11 - dot01 * dot01

    if abs(denom) < 1e-15:
        return -1e18

    inv = 1.0 / denom
    v2x = cx - v0[0]
    v2y = cy - v0[1]
    dot02 = e0x * v2x + e0y * v2y
    dot12 = e1x * v2x + e1y * v2y

    u = (dot11 * dot02 - dot01 * dot12) * inv
    v = (dot00 * dot12 - dot01 * dot02) * inv

    if u < -1e-8 or v < -1e-8 or (u + v) > 1.0 + 1e-8:
        return -1e18

    return v0[2] + u * (v2[2] - v0[2]) + v * (v1[2] - v0[2])


# ── Ball endmill drop-cutter ──────────────────────────────────────────

def _dc_ball_triangle(
    cx: float, cy: float, r: float, r_sq: float,
    v0: tuple, v1: tuple, v2: tuple,
) -> float:
    """Drop ball endmill onto a triangle. Returns tool-tip Z or -inf.

    For a ball-nose endmill, the cutting surface is a hemisphere of radius r
    centered at (cx, cy, z+r) where z is the tool tip. The contact point
    is where the sphere touches the triangle.
    """
    best_z = -1e18

    # Test 1-3: Vertex contacts (sphere touching vertex)
    for v in (v0, v1, v2):
        dx = v[0] - cx
        dy = v[1] - cy
        d_sq = dx * dx + dy * dy
        if d_sq > r_sq:
            continue
        # Sphere center at (cx, cy, z+r); distance to vertex = r
        # (dx² + dy² + (vz - z - r)²) = r²
        # (vz - z - r)² = r² - d_sq
        # vz - z - r = ±sqrt(r² - d_sq)
        # z = vz - r + sqrt(r² - d_sq)   (take the higher position)
        h = math.sqrt(r_sq - d_sq)
        z = v[2] - r + h
        if z > best_z:
            best_z = z

    # Test 4-6: Edge contacts (sphere touching edge)
    edges = ((v0, v1), (v1, v2), (v2, v0))
    for a, b in edges:
        z = _dc_ball_edge(cx, cy, r, r_sq, a, b)
        if z > best_z:
            best_z = z

    # Test 7: Facet contact (sphere touching triangle plane)
    z = _dc_ball_facet(cx, cy, r, v0, v1, v2)
    if z > best_z:
        best_z = z

    return best_z


def _dc_ball_edge(
    cx: float, cy: float, r: float, r_sq: float,
    a: tuple, b: tuple,
) -> float:
    """Test ball endmill contact with a triangle edge.

    Find the point on the edge closest to the tool axis (cx, cy, z+r)
    and compute the Z where the sphere contacts.
    """
    # Edge direction
    ex = b[0] - a[0]
    ey = b[1] - a[1]
    ez = b[2] - a[2]
    e_len_sq = ex * ex + ey * ey + ez * ez
    if e_len_sq < 1e-20:
        return -1e18

    # XY distance: find t that minimizes XY distance from (cx,cy) to edge
    e_xy_sq = ex * ex + ey * ey
    if e_xy_sq < 1e-20:
        # Vertical edge: check XY distance to endpoint
        dx = a[0] - cx
        dy = a[1] - cy
        d_sq = dx * dx + dy * dy
        if d_sq > r_sq:
            return -1e18
        h = math.sqrt(r_sq - d_sq)
        z_lo = min(a[2], b[2])
        z_hi = max(a[2], b[2])
        # Contact with any point on the vertical edge
        z = z_hi - r + h
        return z

    t = ((cx - a[0]) * ex + (cy - a[1]) * ey) / e_xy_sq
    t = max(0.0, min(1.0, t))

    # Point on edge at parameter t
    px = a[0] + t * ex
    py = a[1] + t * ey
    pz = a[2] + t * ez

    dx = px - cx
    dy = py - cy
    d_sq = dx * dx + dy * dy
    if d_sq > r_sq:
        return -1e18

    h = math.sqrt(r_sq - d_sq)
    return pz - r + h


def _dc_ball_facet(
    cx: float, cy: float, r: float,
    v0: tuple, v1: tuple, v2: tuple,
) -> float:
    """Test ball endmill contact with the triangle interior (facet).

    The sphere center at (cx, cy, z+r) must be at distance r from the
    triangle plane, and the contact point must be inside the triangle.
    """
    # Compute triangle normal
    e1x = v1[0] - v0[0]
    e1y = v1[1] - v0[1]
    e1z = v1[2] - v0[2]
    e2x = v2[0] - v0[0]
    e2y = v2[1] - v0[1]
    e2z = v2[2] - v0[2]

    nx = e1y * e2z - e1z * e2y
    ny = e1z * e2x - e1x * e2z
    nz = e1x * e2y - e1y * e2x
    n_len = math.sqrt(nx * nx + ny * ny + nz * nz)
    if n_len < 1e-15:
        return -1e18

    nx /= n_len
    ny /= n_len
    nz /= n_len

    # Ensure normal points upward (toward tool)
    if nz < 0:
        nx, ny, nz = -nx, -ny, -nz

    if abs(nz) < 1e-10:
        return -1e18  # Vertical face: ball can't drop onto it from above

    # Contact point on sphere surface: center - r*normal
    # center = (cx, cy, z + r)
    # contact = (cx - r*nx, cy - r*ny, z + r - r*nz)
    # This contact must lie on the triangle plane.
    # Plane equation: n · (p - v0) = 0
    # n · ((cx - r*nx, cy - r*ny, z + r - r*nz) - v0) = 0
    # nx*(cx - r*nx - v0x) + ny*(cy - r*ny - v0y) + nz*(z + r - r*nz - v0z) = 0
    # nz * z = nx*(v0x - cx + r*nx) + ny*(v0y - cy + r*ny) + nz*(v0z - r + r*nz) - nz*r
    # Let me redo:
    # d = n · v0 (plane distance from origin)
    d = nx * v0[0] + ny * v0[1] + nz * v0[2]
    # contact point = (cx - r*nx, cy - r*ny, zc + r - r*nz)
    # where zc is the tool tip Z (what we want)
    # n · contact = d
    # nx*(cx - r*nx) + ny*(cy - r*ny) + nz*(zc + r - r*nz) = d
    # nx*cx - r*nx² + ny*cy - r*ny² + nz*zc + nz*r - r*nz² = d
    # nz*zc = d - nx*cx + r*nx² - ny*cy + r*ny² - nz*r + r*nz²
    # nz*zc = d - nx*cx - ny*cy + r*(nx² + ny² + nz²) - nz*r
    # Since nx² + ny² + nz² = 1:
    # nz*zc = d - nx*cx - ny*cy + r - nz*r
    # zc = (d - nx*cx - ny*cy + r*(1 - nz)) / nz

    zc = (d - nx * cx - ny * cy + r * (1.0 - nz)) / nz

    # Check if contact point is inside the triangle
    contact_x = cx - r * nx
    contact_y = cy - r * ny

    if not _point_in_triangle_2d(contact_x, contact_y, v0, v1, v2):
        return -1e18

    return zc


# ── Bull-nose (toroidal) endmill drop-cutter ──────────────────────────

def _dc_bull_triangle(
    cx: float, cy: float, r: float, r_sq: float,
    cr: float,  # corner radius
    v0: tuple, v1: tuple, v2: tuple,
) -> float:
    """Drop bull-nose endmill onto a triangle. Returns tool-tip Z or -inf.

    A bull-nose endmill has a flat center region of radius (r - cr) and
    a toroidal edge of minor radius cr and major radius (r - cr).

    The contact surface is:
    - A flat disk of radius (r - cr) at the bottom
    - A torus of major radius (r - cr) and minor radius cr around the edge
    """
    best_z = -1e18
    R = r - cr  # major radius of the torus (distance from axis to torus center circle)

    # Test 1-3: Vertex contacts
    for v in (v0, v1, v2):
        z = _dc_bull_vertex(cx, cy, r, R, cr, v)
        if z > best_z:
            best_z = z

    # Test 4-6: Edge contacts
    edges = ((v0, v1), (v1, v2), (v2, v0))
    for a, b in edges:
        z = _dc_bull_edge(cx, cy, r, R, cr, a, b)
        if z > best_z:
            best_z = z

    # Test 7: Facet contact
    z = _dc_bull_facet(cx, cy, r, R, cr, v0, v1, v2)
    if z > best_z:
        best_z = z

    return best_z


def _dc_bull_vertex(
    cx: float, cy: float, r: float, R: float, cr: float,
    v: tuple,
) -> float:
    """Bull-nose vertex contact."""
    dx = v[0] - cx
    dy = v[1] - cy
    d_xy = math.sqrt(dx * dx + dy * dy)

    if d_xy <= R:
        # Under the flat part
        return v[2]
    elif d_xy <= r:
        # Under the torus
        # Distance from vertex to torus center circle (in XY)
        d_from_torus = d_xy - R
        if d_from_torus > cr:
            return -1e18
        # Height offset from torus minor circle
        h = math.sqrt(max(0.0, cr * cr - d_from_torus * d_from_torus))
        return v[2] - cr + h
    return -1e18


def _dc_bull_edge(
    cx: float, cy: float, r: float, R: float, cr: float,
    a: tuple, b: tuple,
) -> float:
    """Bull-nose edge contact."""
    best_z = -1e18

    # Project edge onto XY, find closest point to tool center
    ex = b[0] - a[0]
    ey = b[1] - a[1]
    ez = b[2] - a[2]
    e_xy_sq = ex * ex + ey * ey
    if e_xy_sq < 1e-20:
        # Nearly vertical edge: test as vertex
        z0 = _dc_bull_vertex(cx, cy, r, R, cr, a)
        z1 = _dc_bull_vertex(cx, cy, r, R, cr, b)
        return max(z0, z1)

    t = ((cx - a[0]) * ex + (cy - a[1]) * ey) / e_xy_sq
    t = max(0.0, min(1.0, t))

    px = a[0] + t * ex
    py = a[1] + t * ey
    pz = a[2] + t * ez

    dx = px - cx
    dy = py - cy
    d_xy = math.sqrt(dx * dx + dy * dy)

    if d_xy <= R:
        # Flat part contact
        if d_xy <= r:
            best_z = pz
    elif d_xy <= r:
        # Torus part: closest point on torus center circle to edge point
        d_from_torus = d_xy - R
        if d_from_torus <= cr:
            h = math.sqrt(max(0.0, cr * cr - d_from_torus * d_from_torus))
            z = pz - cr + h
            if z > best_z:
                best_z = z

    # Also check: the edge may contact the torus at a point not at the
    # closest XY approach. Use iterative refinement on a few samples.
    for ti in (0.0, 0.25, 0.5, 0.75, 1.0):
        px2 = a[0] + ti * ex
        py2 = a[1] + ti * ey
        pz2 = a[2] + ti * ez
        z2 = _dc_bull_vertex(cx, cy, r, R, cr, (px2, py2, pz2))
        if z2 > best_z:
            best_z = z2

    return best_z


def _dc_bull_facet(
    cx: float, cy: float, r: float, R: float, cr: float,
    v0: tuple, v1: tuple, v2: tuple,
) -> float:
    """Bull-nose facet contact."""
    # Compute triangle normal
    e1x = v1[0] - v0[0]
    e1y = v1[1] - v0[1]
    e1z = v1[2] - v0[2]
    e2x = v2[0] - v0[0]
    e2y = v2[1] - v0[1]
    e2z = v2[2] - v0[2]

    nx = e1y * e2z - e1z * e2y
    ny = e1z * e2x - e1x * e2z
    nz = e1x * e2y - e1y * e2x
    n_len = math.sqrt(nx * nx + ny * ny + nz * nz)
    if n_len < 1e-15:
        return -1e18
    nx /= n_len
    ny /= n_len
    nz /= n_len
    if nz < 0:
        nx, ny, nz = -nx, -ny, -nz
    if abs(nz) < 1e-10:
        return -1e18

    # For a bull-nose tool, the torus center circle is at height cr above the tip.
    # The torus contacts the plane; we need to find the contact point.
    # The contact point on the torus circle that is closest to the plane
    # is at XY offset = R * (nx_xy, ny_xy) / |n_xy| from tool center.
    n_xy_len = math.sqrt(nx * nx + ny * ny)

    if n_xy_len < 1e-10:
        # Horizontal face: flat bottom contacts
        if _point_in_triangle_2d(cx, cy, v0, v1, v2):
            d = nx * v0[0] + ny * v0[1] + nz * v0[2]
            return (d - nx * cx - ny * cy) / nz
        return -1e18

    # Torus center circle contact point (XY direction toward slope)
    tcx = cx + R * nx / n_xy_len
    tcy = cy + R * ny / n_xy_len

    # This point on the torus center circle + sphere of radius cr contacts the plane
    # Plane equation: n · p = d
    d = nx * v0[0] + ny * v0[1] + nz * v0[2]
    # Contact: (tcx - cr*nx, tcy - cr*ny, zc + cr - cr*nz)
    # n · contact = d
    # nx*(tcx - cr*nx) + ny*(tcy - cr*ny) + nz*(zc + cr - cr*nz) = d
    # nz*zc = d - nx*tcx + cr*nx² - ny*tcy + cr*ny² - nz*cr + cr*nz²
    # nz*zc = d - nx*tcx - ny*tcy + cr*(1 - nz)
    zc = (d - nx * tcx - ny * tcy + cr * (1.0 - nz)) / nz

    # Verify contact point is inside triangle
    contact_x = tcx - cr * nx
    contact_y = tcy - cr * ny
    if not _point_in_triangle_2d(contact_x, contact_y, v0, v1, v2):
        return -1e18

    return zc


def _point_in_triangle_2d(
    px: float, py: float,
    v0: tuple, v1: tuple, v2: tuple,
) -> bool:
    """Test if point (px,py) is inside triangle (v0,v1,v2) in XY projection."""
    e0x = v2[0] - v0[0]
    e0y = v2[1] - v0[1]
    e1x = v1[0] - v0[0]
    e1y = v1[1] - v0[1]

    dot00 = e0x * e0x + e0y * e0y
    dot01 = e0x * e1x + e0y * e1y
    dot11 = e1x * e1x + e1y * e1y
    denom = dot00 * dot11 - dot01 * dot01
    if abs(denom) < 1e-15:
        return False

    inv = 1.0 / denom
    v2x = px - v0[0]
    v2y = py - v0[1]
    dot02 = e0x * v2x + e0y * v2y
    dot12 = e1x * v2x + e1y * v2y

    u = (dot11 * dot02 - dot01 * dot12) * inv
    v = (dot00 * dot12 - dot01 * dot02) * inv

    return u >= -1e-6 and v >= -1e-6 and (u + v) <= 1.0 + 1e-6


# ═══════════════════════════════════════════════════════════════════════
# BATCH DROP-CUTTER (vectorized for heightfield construction)
# ═══════════════════════════════════════════════════════════════════════

def batch_drop_cutter(
    mesh: Mesh,
    x_positions: list[float] | None = None,
    y_positions: list[float] | None = None,
    tool_radius: float = 3.0,
    tool_shape: ToolShape = ToolShape.FLAT,
    corner_radius: float = 0.0,
    default_z: float = -1e9,
) -> list[list[float]]:
    """
    Batch drop-cutter for building heightfields.

    For each (x,y) grid point, runs the full 7-test drop-cutter algorithm.
    Uses BVH to limit triangle tests per grid cell.

    Returns a 2D grid [iy][ix] of Z values.
    """
    if x_positions is None or y_positions is None:
        return []

    mesh.ensure_bvh()
    nx = len(x_positions)
    ny = len(y_positions)
    grid = [[default_z] * nx for _ in range(ny)]

    r = tool_radius
    r_sq = r * r

    for iy, y in enumerate(y_positions):
        for ix, x in enumerate(x_positions):
            # BVH query for candidate triangles
            if mesh.bvh is not None:
                tri_ids = query_bvh_xy_range(
                    mesh.bvh, x - r, x + r, y - r, y + r,
                )
            else:
                tri_ids = range(mesh.num_triangles)

            best_z = default_z
            for ti in tri_ids:
                v0, v1, v2 = mesh.get_triangle_raw(ti)

                if tool_shape == ToolShape.FLAT:
                    z = _dc_flat_triangle(x, y, r, r_sq, v0, v1, v2)
                elif tool_shape == ToolShape.BALL:
                    z = _dc_ball_triangle(x, y, r, r_sq, v0, v1, v2)
                elif tool_shape == ToolShape.BULL:
                    z = _dc_bull_triangle(x, y, r, r_sq, corner_radius, v0, v1, v2)
                else:
                    z = _dc_flat_triangle(x, y, r, r_sq, v0, v1, v2)

                if z > best_z:
                    best_z = z

            grid[iy][ix] = best_z

    return grid


# ═══════════════════════════════════════════════════════════════════════
# HEIGHTFIELD
# ═══════════════════════════════════════════════════════════════════════

class Heightfield:
    """2D grid of Z heights with bilinear interpolation."""
    __slots__ = ("x_min", "x_max", "y_min", "y_max", "nx", "ny",
                 "dx", "dy", "grid", "grid_list")

    def __init__(self, x_min: float, x_max: float, y_min: float, y_max: float,
                 nx: int, ny: int, default_z: float = -1e9):
        self.x_min = x_min
        self.x_max = x_max
        self.y_min = y_min
        self.y_max = y_max
        self.nx = max(1, nx)
        self.ny = max(1, ny)
        self.dx = (x_max - x_min) / self.nx if self.nx > 1 else 1.0
        self.dy = (y_max - y_min) / self.ny if self.ny > 1 else 1.0

        if HAS_NUMPY:
            self.grid = np.full((self.ny, self.nx), default_z, dtype=np.float64)
            self.grid_list = None
        else:
            self.grid = None
            self.grid_list = [[default_z] * self.nx for _ in range(self.ny)]

    def set_z(self, ix: int, iy: int, z: float) -> None:
        if 0 <= ix < self.nx and 0 <= iy < self.ny:
            # Reject NaN/Infinity to keep the grid clean
            if not math.isfinite(z):
                return
            if HAS_NUMPY:
                self.grid[iy, ix] = z
            else:
                self.grid_list[iy][ix] = z

    def get_z(self, ix: int, iy: int) -> float:
        if 0 <= ix < self.nx and 0 <= iy < self.ny:
            if HAS_NUMPY:
                v = float(self.grid[iy, ix])
            else:
                v = self.grid_list[iy][ix]
            # Guard against corrupted grid cells (e.g. external numpy writes)
            return v if math.isfinite(v) else -1e9
        return -1e9

    def sample_z(self, x: float, y: float) -> float:
        """Bilinear interpolation of Z at world (x, y)."""
        fx = (x - self.x_min) / self.dx
        fy = (y - self.y_min) / self.dy
        ix = int(math.floor(fx))
        iy = int(math.floor(fy))
        ix = max(0, min(ix, self.nx - 2))
        iy = max(0, min(iy, self.ny - 2))
        tx = max(0.0, min(1.0, fx - ix))
        ty = max(0.0, min(1.0, fy - iy))

        z00 = self.get_z(ix, iy)
        z10 = self.get_z(ix + 1, iy)
        z01 = self.get_z(ix, iy + 1)
        z11 = self.get_z(ix + 1, iy + 1)

        z0 = z00 + (z10 - z00) * tx
        z1 = z01 + (z11 - z01) * tx
        result = z0 + (z1 - z0) * ty
        # Guard against non-finite values
        if not math.isfinite(result):
            return self.get_z(max(0, min(ix, self.nx - 1)),
                              max(0, min(iy, self.ny - 1)))
        return result

    def world_x(self, ix: int) -> float:
        return self.x_min + ix * self.dx

    def world_y(self, iy: int) -> float:
        return self.y_min + iy * self.dy

    def copy(self) -> Heightfield:
        """Create an independent copy of this heightfield."""
        hf = Heightfield(self.x_min, self.x_max, self.y_min, self.y_max,
                         self.nx, self.ny)
        if HAS_NUMPY and self.grid is not None:
            hf.grid = self.grid.copy()
        elif self.grid_list is not None:
            hf.grid_list = [row[:] for row in self.grid_list]
        return hf

    def subtract_tool_pass(self, x: float, y: float, z_tip: float,
                           tool_radius: float, tool_shape: ToolShape = ToolShape.FLAT,
                           corner_radius: float = 0.0) -> None:
        """Update heightfield by subtracting a tool at the given position.
        Used for in-process stock tracking.

        Uses numpy vectorization when available to process the entire tool
        footprint in one pass instead of per-cell Python loops.
        """
        r = tool_radius
        r_cells = max(1, int(math.ceil(r / min(self.dx, self.dy))))
        ix_c = int(round((x - self.x_min) / self.dx))
        iy_c = int(round((y - self.y_min) / self.dy))

        # Clamp cell range to grid bounds
        ix_lo = max(0, ix_c - r_cells)
        ix_hi = min(self.nx, ix_c + r_cells + 1)
        iy_lo = max(0, iy_c - r_cells)
        iy_hi = min(self.ny, iy_c + r_cells + 1)

        if ix_lo >= ix_hi or iy_lo >= iy_hi:
            return

        if HAS_NUMPY and self.grid is not None:
            # Vectorized: compute all cell distances and tool_z in one pass
            ix_arr = np.arange(ix_lo, ix_hi)
            iy_arr = np.arange(iy_lo, iy_hi)
            wx = self.x_min + ix_arr * self.dx  # (W,)
            wy = self.y_min + iy_arr * self.dy  # (H,)
            dx_grid = wx - x  # (W,)
            dy_grid = wy - y  # (H,)
            # d_xy[j, i] = distance from (x,y) to cell (ix_lo+i, iy_lo+j)
            d_xy_sq = dx_grid[np.newaxis, :] ** 2 + dy_grid[:, np.newaxis] ** 2
            d_xy = np.sqrt(d_xy_sq)

            if tool_shape is None or tool_shape == ToolShape.FLAT:
                mask = d_xy <= r
                tool_z = np.full_like(d_xy, z_tip)
            elif tool_shape == ToolShape.BALL:
                mask = d_xy <= r
                tool_z = z_tip + r - np.sqrt(np.maximum(0.0, r * r - d_xy_sq))
            elif tool_shape == ToolShape.BULL:
                R = r - corner_radius
                mask = d_xy <= r
                # Flat bottom region
                tool_z = np.full_like(d_xy, z_tip)
                # Torus region: d_xy > R and d_xy <= r
                torus_mask = d_xy > R
                d_from_torus = d_xy - R
                h = np.sqrt(np.maximum(0.0, corner_radius * corner_radius - d_from_torus * d_from_torus))
                tool_z = np.where(torus_mask, z_tip + corner_radius - h, tool_z)
            else:
                mask = d_xy <= r
                tool_z = np.full_like(d_xy, z_tip)

            # Apply: where tool_z < current grid and within tool radius
            sub_grid = self.grid[iy_lo:iy_hi, ix_lo:ix_hi]
            update_mask = mask & (tool_z < sub_grid)
            sub_grid[update_mask] = tool_z[update_mask]
        else:
            # Pure-Python fallback
            for diy in range(-r_cells, r_cells + 1):
                iy = iy_c + diy
                if iy < 0 or iy >= self.ny:
                    continue
                wy = self.y_min + iy * self.dy
                for dix in range(-r_cells, r_cells + 1):
                    ix = ix_c + dix
                    if ix < 0 or ix >= self.nx:
                        continue
                    wx = self.x_min + ix * self.dx
                    ddx = wx - x
                    ddy = wy - y
                    d_xy = math.sqrt(ddx * ddx + ddy * ddy)

                    if tool_shape == ToolShape.FLAT:
                        if d_xy <= r:
                            tool_z_val = z_tip
                        else:
                            continue
                    elif tool_shape == ToolShape.BALL:
                        if d_xy > r:
                            continue
                        tool_z_val = z_tip + r - math.sqrt(max(0.0, r * r - d_xy * d_xy))
                    elif tool_shape == ToolShape.BULL:
                        R = r - corner_radius
                        if d_xy <= R:
                            tool_z_val = z_tip
                        elif d_xy <= r:
                            d_from_torus = d_xy - R
                            h = math.sqrt(max(0.0, corner_radius * corner_radius - d_from_torus * d_from_torus))
                            tool_z_val = z_tip + corner_radius - h
                        else:
                            continue
                    else:
                        if d_xy <= r:
                            tool_z_val = z_tip
                        else:
                            continue

                    current = self.get_z(ix, iy)
                    if tool_z_val < current:
                        self.set_z(ix, iy, tool_z_val)


# ── Heightfield construction via drop-cutter ──────────────────────────

def build_heightfield(
    mesh: Mesh,
    resolution_mm: float = 0.5,
    tool_radius: float = 0.0,
    stock_aabb: AABB | None = None,
    tool_shape: ToolShape = ToolShape.FLAT,
    corner_radius: float = 0.0,
) -> Heightfield:
    """
    Build a heightfield from a mesh using the drop-cutter algorithm.

    When tool_radius > 0, uses proper drop-cutter (7-test per triangle)
    to compute the CL (cutter-location) surface. This accounts for the
    actual tool shape and prevents gouging.

    When tool_radius == 0, falls back to direct barycentric Z projection
    for raw mesh surface sampling.
    """
    b = mesh.bounds
    margin = max(tool_radius, 1.0) + resolution_mm
    if stock_aabb:
        x_lo = min(b.min_pt.x, stock_aabb.min_pt.x) - margin
        x_hi = max(b.max_pt.x, stock_aabb.max_pt.x) + margin
        y_lo = min(b.min_pt.y, stock_aabb.min_pt.y) - margin
        y_hi = max(b.max_pt.y, stock_aabb.max_pt.y) + margin
    else:
        x_lo = b.min_pt.x - margin
        x_hi = b.max_pt.x + margin
        y_lo = b.min_pt.y - margin
        y_hi = b.max_pt.y + margin

    nx = max(1, int(math.ceil((x_hi - x_lo) / resolution_mm)))
    ny = max(1, int(math.ceil((y_hi - y_lo) / resolution_mm)))

    max_cells = 4_000_000
    if nx * ny > max_cells:
        scale = math.sqrt(max_cells / (nx * ny))
        nx = max(1, int(nx * scale))
        ny = max(1, int(ny * scale))

    hf = Heightfield(x_lo, x_hi, y_lo, y_hi, nx, ny, default_z=b.min_pt.z - 1.0)

    if mesh.num_triangles == 0:
        return hf

    if tool_radius > 0:
        # Use proper drop-cutter for CL surface
        _fill_heightfield_dropcutter(mesh, hf, tool_radius, tool_shape, corner_radius)
    else:
        # Direct projection for raw mesh surface
        if HAS_NUMPY:
            _fill_heightfield_vectorized(mesh, hf)
        else:
            _fill_heightfield_pure(mesh, hf)

    return hf


def _fill_heightfield_dropcutter(
    mesh: Mesh, hf: Heightfield,
    tool_radius: float, tool_shape: ToolShape, corner_radius: float,
) -> None:
    """Fill heightfield using BVH-accelerated drop-cutter.

    Optimizations over a naive per-cell approach:
    - Row-band BVH query: queries the BVH once per row for the full X span,
      gathering a superset of candidate triangles.  Per-cell queries then
      filter this pre-fetched list, avoiding redundant BVH traversals.
    - Triangle data pre-fetch: raw triangle vertices are loaded once per row
      band and stored in a local list, avoiding repeated Mesh.get_triangle_raw
      calls with Python-level index arithmetic.
    - Direct grid write: bypasses get_z/set_z bounds checks (indices are
      guaranteed valid inside the loop ranges).
    - Tool-shape dispatch is resolved once outside all loops.
    """
    mesh.ensure_bvh()
    r = tool_radius
    r_sq = r * r

    # Select drop-cutter function once (avoids per-cell if/elif chain)
    if tool_shape == ToolShape.BALL:
        _dc_fn = _dc_ball_triangle
        _dc_extra = ()
    elif tool_shape == ToolShape.BULL:
        _dc_fn = _dc_bull_triangle
        _dc_extra = (corner_radius,)
    else:
        _dc_fn = _dc_flat_triangle
        _dc_extra = ()

    has_bvh = mesh.bvh is not None
    x_min = hf.x_min
    y_min = hf.y_min
    dx = hf.dx
    dy = hf.dy
    nx = hf.nx

    use_numpy = HAS_NUMPY and hf.grid is not None

    for iy in range(hf.ny):
        y = y_min + iy * dy

        # Row-band BVH query: fetch all triangles whose Y bbox overlaps
        # [y - r, y + r] across the full X range of the heightfield.
        if has_bvh:
            row_tri_ids = query_bvh_xy_range(
                mesh.bvh,
                x_min - r, x_min + nx * dx + r,
                y - r, y + r,
            )
            if not row_tri_ids:
                continue  # No triangles near this row at all

            # Pre-fetch triangle data for this row's candidate set
            row_tris = [mesh.get_triangle_raw(ti) for ti in row_tri_ids]
        else:
            row_tri_ids = None
            row_tris = [mesh.get_triangle_raw(ti) for ti in range(mesh.num_triangles)]

        for ix in range(nx):
            x = x_min + ix * dx

            if use_numpy:
                best_z = float(hf.grid[iy, ix])
            else:
                best_z = hf.grid_list[iy][ix]

            if row_tri_ids is not None:
                # Filter row candidates by X range for this cell
                x_lo_cell = x - r
                x_hi_cell = x + r
                for tri_data in row_tris:
                    v0, v1, v2 = tri_data
                    # Quick X-extent rejection (cheaper than full drop-cutter)
                    tri_x_min = min(v0[0], v1[0], v2[0])
                    tri_x_max = max(v0[0], v1[0], v2[0])
                    if tri_x_max < x_lo_cell or tri_x_min > x_hi_cell:
                        continue
                    if _dc_extra:
                        z = _dc_fn(x, y, r, r_sq, _dc_extra[0], v0, v1, v2)
                    else:
                        z = _dc_fn(x, y, r, r_sq, v0, v1, v2)
                    if z > best_z:
                        best_z = z
            else:
                for tri_data in row_tris:
                    v0, v1, v2 = tri_data
                    if _dc_extra:
                        z = _dc_fn(x, y, r, r_sq, _dc_extra[0], v0, v1, v2)
                    else:
                        z = _dc_fn(x, y, r, r_sq, v0, v1, v2)
                    if z > best_z:
                        best_z = z

            if use_numpy:
                hf.grid[iy, ix] = best_z
            else:
                hf.grid_list[iy][ix] = best_z


def build_surface_angle_map(
    mesh: Mesh,
    resolution_mm: float = 0.5,
    stock_aabb: AABB | None = None,
) -> Heightfield:
    """Build a map where each cell stores the surface angle (0-90 degrees)."""
    if not HAS_NUMPY:
        b = mesh.bounds
        nx = max(1, int(math.ceil((b.max_pt.x - b.min_pt.x + 2) / resolution_mm)))
        ny = max(1, int(math.ceil((b.max_pt.y - b.min_pt.y + 2) / resolution_mm)))
        return Heightfield(b.min_pt.x - 1, b.max_pt.x + 1,
                           b.min_pt.y - 1, b.max_pt.y + 1, nx, ny, default_z=0.0)

    b = mesh.bounds
    margin = resolution_mm
    sa = stock_aabb
    if sa:
        x_lo = min(b.min_pt.x, sa.min_pt.x) - margin
        x_hi = max(b.max_pt.x, sa.max_pt.x) + margin
        y_lo = min(b.min_pt.y, sa.min_pt.y) - margin
        y_hi = max(b.max_pt.y, sa.max_pt.y) + margin
    else:
        x_lo, x_hi = b.min_pt.x - margin, b.max_pt.x + margin
        y_lo, y_hi = b.min_pt.y - margin, b.max_pt.y + margin

    nx = max(1, int(math.ceil((x_hi - x_lo) / resolution_mm)))
    ny = max(1, int(math.ceil((y_hi - y_lo) / resolution_mm)))
    max_cells = 2_000_000
    if nx * ny > max_cells:
        scale = math.sqrt(max_cells / (nx * ny))
        nx = max(1, int(nx * scale))
        ny = max(1, int(ny * scale))

    angle_map = Heightfield(x_lo, x_hi, y_lo, y_hi, nx, ny, default_z=0.0)

    tris = mesh.get_triangle_vertices_numpy()
    normals = mesh.compute_face_normals_numpy()
    angles_rad = np.arccos(np.clip(np.abs(normals[:, 2]), 0.0, 1.0))
    angles_deg = np.degrees(angles_rad)

    v0 = tris[:, 0, :]
    v1 = tris[:, 1, :]
    v2 = tris[:, 2, :]

    tri_xmin = np.minimum(np.minimum(v0[:, 0], v1[:, 0]), v2[:, 0])
    tri_xmax = np.maximum(np.maximum(v0[:, 0], v1[:, 0]), v2[:, 0])
    tri_ymin = np.minimum(np.minimum(v0[:, 1], v1[:, 1]), v2[:, 1])
    tri_ymax = np.maximum(np.maximum(v0[:, 1], v1[:, 1]), v2[:, 1])

    dx = angle_map.dx
    dy = angle_map.dy
    ix_lo_arr = np.clip(((tri_xmin - x_lo) / dx).astype(np.intp), 0, nx - 1)
    ix_hi_arr = np.clip(((tri_xmax - x_lo) / dx).astype(np.intp) + 1, 0, nx)
    iy_lo_arr = np.clip(((tri_ymin - y_lo) / dy).astype(np.intp), 0, ny - 1)
    iy_hi_arr = np.clip(((tri_ymax - y_lo) / dy).astype(np.intp) + 1, 0, ny)

    grid = angle_map.grid

    # Sort triangles by angle descending so we can skip triangles whose angle
    # cannot improve any remaining cell.  For large meshes this avoids most
    # inner-loop iterations for small triangles that are already dominated.
    sorted_order = np.argsort(-angles_deg)

    for idx in range(len(sorted_order)):
        ti = int(sorted_order[idx])
        ang = float(angles_deg[ti])
        iy_s = int(iy_lo_arr[ti])
        iy_e = int(iy_hi_arr[ti])
        ix_s = int(ix_lo_arr[ti])
        ix_e = int(ix_hi_arr[ti])
        if iy_s >= iy_e or ix_s >= ix_e:
            continue
        # Use numpy slice to update the sub-grid in one operation
        sub = grid[iy_s:iy_e, ix_s:ix_e]
        np.maximum(sub, ang, out=sub)

    return angle_map


def _fill_heightfield_vectorized(mesh: Mesh, hf: Heightfield) -> None:
    """Vectorized heightfield fill (raw surface projection, no tool comp)."""
    tris = mesh.get_triangle_vertices_numpy()
    v0 = tris[:, 0, :]
    v1 = tris[:, 1, :]
    v2 = tris[:, 2, :]

    tri_xmin = np.minimum(np.minimum(v0[:, 0], v1[:, 0]), v2[:, 0])
    tri_xmax = np.maximum(np.maximum(v0[:, 0], v1[:, 0]), v2[:, 0])
    tri_ymin = np.minimum(np.minimum(v0[:, 1], v1[:, 1]), v2[:, 1])
    tri_ymax = np.maximum(np.maximum(v0[:, 1], v1[:, 1]), v2[:, 1])

    ix_lo = np.clip(((tri_xmin - hf.x_min) / hf.dx).astype(np.intp), 0, hf.nx - 1)
    ix_hi = np.clip(((tri_xmax - hf.x_min) / hf.dx).astype(np.intp) + 1, 0, hf.nx)
    iy_lo = np.clip(((tri_ymin - hf.y_min) / hf.dy).astype(np.intp), 0, hf.ny - 1)
    iy_hi = np.clip(((tri_ymax - hf.y_min) / hf.dy).astype(np.intp) + 1, 0, hf.ny)

    _batch_rasterize_triangles(
        hf, v0, v1, v2, ix_lo, ix_hi, iy_lo, iy_hi, mesh.num_triangles,
    )


def _batch_rasterize_triangles(
    hf: Heightfield,
    v0, v1, v2,
    ix_lo, ix_hi, iy_lo, iy_hi,
    num_tris: int,
) -> None:
    """Batch rasterize triangles with vectorized barycentric setup."""
    e0x = v2[:, 0] - v0[:, 0]
    e0y = v2[:, 1] - v0[:, 1]
    e1x = v1[:, 0] - v0[:, 0]
    e1y = v1[:, 1] - v0[:, 1]

    dot00 = e0x * e0x + e0y * e0y
    dot01 = e0x * e1x + e0y * e1y
    dot11 = e1x * e1x + e1y * e1y
    denom = dot00 * dot11 - dot01 * dot01

    valid = np.abs(denom) > 1e-12
    inv_denom = np.where(valid, 1.0 / np.where(valid, denom, 1.0), 0.0)

    grid = hf.grid

    for ti in range(num_tris):
        if not valid[ti]:
            continue
        _rasterize_one_precomputed(
            grid, hf.x_min, hf.y_min, hf.dx, hf.dy,
            float(v0[ti, 0]), float(v0[ti, 1]), float(v0[ti, 2]),
            float(v1[ti, 2]), float(v2[ti, 2]),
            float(e0x[ti]), float(e0y[ti]),
            float(e1x[ti]), float(e1y[ti]),
            float(dot00[ti]), float(dot01[ti]), float(dot11[ti]),
            float(inv_denom[ti]),
            int(ix_lo[ti]), int(ix_hi[ti]),
            int(iy_lo[ti]), int(iy_hi[ti]),
        )


def _rasterize_one_precomputed(
    grid, x_min, y_min, dx, dy,
    ax, ay, az, bz, cz,
    e0x, e0y, e1x, e1y,
    dot00, dot01, dot11, inv_denom,
    ix_lo, ix_hi, iy_lo, iy_hi,
) -> None:
    """Rasterize one triangle with precomputed barycentric constants."""
    for iy in range(iy_lo, iy_hi):
        py = y_min + iy * dy
        v2y = py - ay
        for ix in range(ix_lo, ix_hi):
            px = x_min + ix * dx
            v2x = px - ax
            dot02 = e0x * v2x + e0y * v2y
            dot12 = e1x * v2x + e1y * v2y

            u = (dot11 * dot02 - dot01 * dot12) * inv_denom
            v = (dot00 * dot12 - dot01 * dot02) * inv_denom

            if u < -1e-8 or v < -1e-8 or (u + v) > 1.0 + 1e-8:
                continue

            z = az + u * (cz - az) + v * (bz - az)
            if z > grid[iy, ix]:
                grid[iy, ix] = z


def _fill_heightfield_pure(mesh: Mesh, hf: Heightfield) -> None:
    """Pure-Python heightfield fill (slower but no deps)."""
    for i in range(mesh.num_triangles):
        v0, v1, v2 = mesh.get_triangle(i)
        txmin = min(v0.x, v1.x, v2.x)
        txmax = max(v0.x, v1.x, v2.x)
        tymin = min(v0.y, v1.y, v2.y)
        tymax = max(v0.y, v1.y, v2.y)

        ix_start = max(0, int(math.floor((txmin - hf.x_min) / hf.dx)))
        ix_end = min(hf.nx, int(math.ceil((txmax - hf.x_min) / hf.dx)) + 1)
        iy_start = max(0, int(math.floor((tymin - hf.y_min) / hf.dy)))
        iy_end = min(hf.ny, int(math.ceil((tymax - hf.y_min) / hf.dy)) + 1)

        _rasterize_triangle_pure(
            hf, v0, v1, v2, ix_start, ix_end, iy_start, iy_end,
        )


def _rasterize_triangle_pure(
    hf: Heightfield,
    v0: Vec3, v1: Vec3, v2: Vec3,
    ix_lo: int, ix_hi: int,
    iy_lo: int, iy_hi: int,
) -> None:
    e0x = v2.x - v0.x
    e0y = v2.y - v0.y
    e1x = v1.x - v0.x
    e1y = v1.y - v0.y

    dot00 = e0x * e0x + e0y * e0y
    dot01 = e0x * e1x + e0y * e1y
    dot11 = e1x * e1x + e1y * e1y
    denom = dot00 * dot11 - dot01 * dot01
    if abs(denom) < 1e-12:
        return
    inv_denom = 1.0 / denom

    for iy in range(iy_lo, iy_hi):
        py = hf.y_min + iy * hf.dy
        v2y = py - v0.y
        for ix in range(ix_lo, ix_hi):
            px = hf.x_min + ix * hf.dx
            v2x = px - v0.x
            dot02 = e0x * v2x + e0y * v2y
            dot12 = e1x * v2x + e1y * v2y

            u = (dot11 * dot02 - dot01 * dot12) * inv_denom
            v = (dot00 * dot12 - dot01 * dot02) * inv_denom

            if u < -1e-8 or v < -1e-8 or (u + v) > 1.0 + 1e-8:
                continue

            z = v0.z + u * (v2.z - v0.z) + v * (v1.z - v0.z)
            if z > hf.grid_list[iy][ix]:
                hf.grid_list[iy][ix] = z


# ═══════════════════════════════════════════════════════════════════════
# Z-LEVEL SLICING (hash-based O(n) segment chaining)
# ═══════════════════════════════════════════════════════════════════════

def slice_mesh_at_z(mesh: Mesh, z: float) -> list[list[tuple[float, float]]]:
    """Slice mesh at constant Z, returning closed contour loops.

    Uses hash-based endpoint matching for O(n) segment chaining
    instead of O(n^2) brute-force search.
    """
    segments: list[tuple[tuple[float, float], tuple[float, float]]] = []

    for i in range(mesh.num_triangles):
        v0, v1, v2 = mesh.get_triangle_raw(i)
        verts = [v0, v1, v2]
        crossings: list[tuple[float, float]] = []

        for j in range(3):
            a = verts[j]
            b = verts[(j + 1) % 3]
            if (a[2] <= z <= b[2]) or (b[2] <= z <= a[2]):
                dz = b[2] - a[2]
                if abs(dz) < 1e-12:
                    crossings.append((a[0], a[1]))
                    crossings.append((b[0], b[1]))
                else:
                    t = (z - a[2]) / dz
                    t = max(0.0, min(1.0, t))
                    crossings.append((a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])))

        # Deduplicate crossing points using hash-based lookup (O(1) per point)
        # instead of O(n) linear scan.  Tolerance-based quantization ensures
        # points within 1e-6 of each other are treated as identical.
        _dedup_inv = 1e6  # 1/tolerance for quantization
        unique: list[tuple[float, float]] = []
        seen_keys: set[tuple[int, int]] = set()
        for pt in crossings:
            key = (int(round(pt[0] * _dedup_inv)), int(round(pt[1] * _dedup_inv)))
            if key not in seen_keys:
                seen_keys.add(key)
                unique.append(pt)

        if len(unique) == 2:
            segments.append((unique[0], unique[1]))

    if not segments:
        return []
    return _chain_segments_hash(segments)


def _chain_segments_hash(
    segments: list[tuple[tuple[float, float], tuple[float, float]]],
    tol: float = 1e-4,
) -> list[list[tuple[float, float]]]:
    """Chain line segments into closed loops using spatial hashing. O(n) average.

    Uses collections.deque for the chain to avoid O(n) list.insert(0, ...)
    during backward extension, reducing overall chaining from O(n^2) worst-case
    to amortized O(n).
    """
    if not segments:
        return []

    from collections import defaultdict, deque

    # Quantize endpoints for hashing
    inv_tol = 1.0 / tol

    def _key(pt: tuple[float, float]) -> tuple[int, int]:
        return (int(round(pt[0] * inv_tol)), int(round(pt[1] * inv_tol)))

    # Build adjacency: each endpoint maps to the list of segment indices
    adj: dict[tuple[int, int], list[int]] = defaultdict(list)
    used = [False] * len(segments)

    for i, (a, b) in enumerate(segments):
        adj[_key(a)].append(i)
        adj[_key(b)].append(i)

    loops: list[list[tuple[float, float]]] = []

    for start_idx in range(len(segments)):
        if used[start_idx]:
            continue

        chain: deque[tuple[float, float]] = deque()
        chain.append(segments[start_idx][0])
        chain.append(segments[start_idx][1])
        used[start_idx] = True

        # Extend forward
        for _ in range(len(segments)):
            key = _key(chain[-1])
            found = False
            for si in adj[key]:
                if used[si]:
                    continue
                a, b = segments[si]
                ka = _key(a)
                kb = _key(b)
                if ka == key:
                    chain.append(b)
                    used[si] = True
                    found = True
                    break
                elif kb == key:
                    chain.append(a)
                    used[si] = True
                    found = True
                    break
            if not found:
                break

        # Extend backward — deque.appendleft is O(1) vs list.insert(0) which is O(n)
        for _ in range(len(segments)):
            key = _key(chain[0])
            found = False
            for si in adj[key]:
                if used[si]:
                    continue
                a, b = segments[si]
                ka = _key(a)
                kb = _key(b)
                if ka == key:
                    chain.appendleft(b)
                    used[si] = True
                    found = True
                    break
                elif kb == key:
                    chain.appendleft(a)
                    used[si] = True
                    found = True
                    break
            if not found:
                break

        if len(chain) >= 3:
            loops.append(list(chain))

    return loops


# Backward-compatible alias
def _chain_segments(segments, tol=1e-4):
    return _chain_segments_hash(segments, tol)


# ═══════════════════════════════════════════════════════════════════════
# CONTOUR OPERATIONS (robust offset with self-intersection removal)
# ═══════════════════════════════════════════════════════════════════════

def offset_contour(
    points: list[tuple[float, float]], offset: float
) -> list[tuple[float, float]]:
    """
    Offset a 2D contour inward (negative) or outward (positive).

    Uses vertex normal bisector method with:
    - Spike clamping for sharp corners
    - Self-intersection removal via sweep
    - Minimum-area check to discard collapsed contours
    """
    n = len(points)
    if n < 3:
        return points[:]

    # Phase 1: Compute raw offset vertices
    raw: list[tuple[float, float]] = []
    for i in range(n):
        p_prev = points[(i - 1) % n]
        p_curr = points[i]
        p_next = points[(i + 1) % n]

        e1x = p_curr[0] - p_prev[0]
        e1y = p_curr[1] - p_prev[1]
        e2x = p_next[0] - p_curr[0]
        e2y = p_next[1] - p_curr[1]

        n1x, n1y = -e1y, e1x
        n2x, n2y = -e2y, e2x

        l1 = math.sqrt(n1x * n1x + n1y * n1y)
        l2 = math.sqrt(n2x * n2x + n2y * n2y)
        if l1 < 1e-12 or l2 < 1e-12:
            raw.append(p_curr)
            continue

        n1x /= l1
        n1y /= l1
        n2x /= l2
        n2y /= l2

        bx = n1x + n2x
        by = n1y + n2y
        bl = math.sqrt(bx * bx + by * by)
        if bl < 1e-12:
            raw.append(p_curr)
            continue

        bx /= bl
        by /= bl

        cos_half = bx * n1x + by * n1y
        if abs(cos_half) < 0.1:
            cos_half = 0.1 if cos_half >= 0 else -0.1

        d = offset / cos_half
        max_d = abs(offset) * 4.0
        d = max(-max_d, min(max_d, d))
        raw.append((p_curr[0] + bx * d, p_curr[1] + by * d))

    # Phase 2: Remove self-intersections
    result = _remove_self_intersections(raw)

    # Phase 3: Discard if collapsed
    if len(result) < 3:
        return []
    area = abs(contour_winding(result))
    if area < abs(offset) * abs(offset) * 0.01:
        return []

    return result


def _remove_self_intersections(
    points: list[tuple[float, float]],
) -> list[tuple[float, float]]:
    """Remove self-intersections from an offset contour.

    Uses a quadratic sweep to find crossings and extract the largest
    non-self-intersecting loop. For typical CAM contours (< 1000 pts)
    this is fast enough.
    """
    n = len(points)
    if n < 4:
        return points[:]

    # Find all intersection pairs
    intersections: list[tuple[int, int, float, float]] = []

    for i in range(n):
        i2 = (i + 1) % n
        a1x, a1y = points[i]
        a2x, a2y = points[i2]

        for j in range(i + 2, n):
            if j == (i - 1) % n:
                continue
            j2 = (j + 1) % n
            if j2 == i:
                continue

            b1x, b1y = points[j]
            b2x, b2y = points[j2]

            ix_pt = _segment_intersection(a1x, a1y, a2x, a2y, b1x, b1y, b2x, b2y)
            if ix_pt is not None:
                intersections.append((i, j, ix_pt[0], ix_pt[1]))

    if not intersections:
        return points[:]

    # Take the first intersection and extract the larger loop
    i_seg, j_seg, ix, iy = intersections[0]

    # Two candidate loops: [0..i, intersection, j+1..n] and [i+1..j, intersection]
    loop_a = list(points[:i_seg + 1]) + [(ix, iy)] + list(points[j_seg + 1:])
    loop_b = [(ix, iy)] + list(points[i_seg + 1:j_seg + 1])

    area_a = abs(contour_winding(loop_a)) if len(loop_a) >= 3 else 0
    area_b = abs(contour_winding(loop_b)) if len(loop_b) >= 3 else 0

    return loop_a if area_a >= area_b else loop_b


def _segment_intersection(
    a1x: float, a1y: float, a2x: float, a2y: float,
    b1x: float, b1y: float, b2x: float, b2y: float,
) -> tuple[float, float] | None:
    """Find intersection of two line segments, or None."""
    dx1 = a2x - a1x
    dy1 = a2y - a1y
    dx2 = b2x - b1x
    dy2 = b2y - b1y

    denom = dx1 * dy2 - dy1 * dx2
    if abs(denom) < 1e-12:
        return None

    t = ((b1x - a1x) * dy2 - (b1y - a1y) * dx2) / denom
    u = ((b1x - a1x) * dy1 - (b1y - a1y) * dx1) / denom

    if 0.0 < t < 1.0 and 0.0 < u < 1.0:
        return (a1x + t * dx1, a1y + t * dy1)
    return None


def contour_winding(points: list[tuple[float, float]]) -> float:
    """Return signed area (positive = CCW, negative = CW)."""
    area = 0.0
    n = len(points)
    for i in range(n):
        j = (i + 1) % n
        area += points[i][0] * points[j][1]
        area -= points[j][0] * points[i][1]
    return area / 2.0


def contour_length(points: list[tuple[float, float]]) -> float:
    """Total perimeter length of a 2D contour."""
    total = 0.0
    for i in range(len(points)):
        j = (i + 1) % len(points)
        dx = points[j][0] - points[i][0]
        dy = points[j][1] - points[i][1]
        total += math.sqrt(dx * dx + dy * dy)
    return total


def point_in_polygon(x: float, y: float, poly: list[tuple[float, float]]) -> bool:
    """Ray-casting point-in-polygon test."""
    n = len(poly)
    inside = False
    j = n - 1
    for i in range(n):
        yi, xi = poly[i][1], poly[i][0]
        yj, xj = poly[j][1], poly[j][0]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside


# ═══════════════════════════════════════════════════════════════════════
# CYLINDRICAL DROP-CUTTER (for 4-axis toolpath generation)
# ═══════════════════════════════════════════════════════════════════════

def cylindrical_drop_cutter_radius(
    mesh: Mesh,
    x_axial: float,
    angle_deg: float,
    tool_radius: float,
    stock_radius: float,
    axis: str = "x",
) -> float:
    """
    Drop-cutter for cylindrical (4-axis) operations.

    Casts a ray from outside the stock toward the rotation axis at the
    given axial position and angle. Returns the radial distance at which
    the tool contacts the mesh.

    Args:
        mesh: Triangle mesh
        x_axial: Position along the rotation axis
        angle_deg: Rotation angle in degrees
        tool_radius: Tool radius
        stock_radius: Stock cylinder radius
        axis: Rotation axis ("x" or "z")

    Returns:
        Radial distance from rotation axis to tool tip contact
    """
    angle_rad = math.radians(angle_deg)
    cos_a = math.cos(angle_rad)
    sin_a = math.sin(angle_rad)

    # Ray origin: outside the stock looking inward
    ray_dist = stock_radius + tool_radius + 5.0

    if axis == "x":
        # Rotation around X: ray in YZ plane
        ray_ox = x_axial
        ray_oy = ray_dist * cos_a
        ray_oz = ray_dist * sin_a
        ray_dx = 0.0
        ray_dy = -cos_a
        ray_dz = -sin_a
    else:
        # Rotation around Z: ray in XY plane
        ray_ox = ray_dist * cos_a
        ray_oy = ray_dist * sin_a
        ray_oz = x_axial
        ray_dx = -cos_a
        ray_dy = -sin_a
        ray_dz = 0.0

    # Cast ray against mesh
    best_t = float("inf")
    mesh.ensure_bvh()

    for i in range(mesh.num_triangles):
        v0, v1, v2 = mesh.get_triangle_raw(i)
        t = _ray_triangle_intersect(
            ray_ox, ray_oy, ray_oz,
            ray_dx, ray_dy, ray_dz,
            v0, v1, v2,
        )
        if t is not None and 0 < t < best_t:
            best_t = t

    if best_t == float("inf"):
        return 0.0  # No intersection

    # Convert hit distance to radial distance
    return ray_dist - best_t - tool_radius


def _ray_triangle_intersect(
    ox: float, oy: float, oz: float,
    dx: float, dy: float, dz: float,
    v0: tuple, v1: tuple, v2: tuple,
) -> float | None:
    """Moller-Trumbore ray-triangle intersection. Returns t or None."""
    e1x = v1[0] - v0[0]
    e1y = v1[1] - v0[1]
    e1z = v1[2] - v0[2]
    e2x = v2[0] - v0[0]
    e2y = v2[1] - v0[1]
    e2z = v2[2] - v0[2]

    # Cross product of ray direction and e2
    px = dy * e2z - dz * e2y
    py = dz * e2x - dx * e2z
    pz = dx * e2y - dy * e2x

    det = e1x * px + e1y * py + e1z * pz
    if abs(det) < 1e-12:
        return None

    inv_det = 1.0 / det
    tx = ox - v0[0]
    ty = oy - v0[1]
    tz = oz - v0[2]

    u = (tx * px + ty * py + tz * pz) * inv_det
    if u < 0.0 or u > 1.0:
        return None

    qx = ty * e1z - tz * e1y
    qy = tz * e1x - tx * e1z
    qz = tx * e1y - ty * e1x

    v = (dx * qx + dy * qy + dz * qz) * inv_det
    if v < 0.0 or u + v > 1.0:
        return None

    t = (e2x * qx + e2y * qy + e2z * qz) * inv_det
    if t < 1e-6:
        return None

    return t


# ═══════════════════════════════════════════════════════════════════════
# COLLISION DETECTION (for 5-axis and holder interference checking)
# ═══════════════════════════════════════════════════════════════════════

def check_tool_collision(
    mesh: Mesh,
    tip_x: float, tip_y: float, tip_z: float,
    axis_x: float, axis_y: float, axis_z: float,
    tool_radius: float,
    tool_length: float,
    holder_radius: float = 0.0,
    holder_length: float = 0.0,
) -> tuple[bool, float]:
    """
    Check if a positioned tool collides with the mesh.

    Tests both the cutting tool (cylinder/cone) and the holder for
    interference with the workpiece mesh.

    Args:
        mesh: Triangle mesh
        tip_x/y/z: Tool tip position
        axis_x/y/z: Tool axis unit vector (pointing away from workpiece)
        tool_radius: Tool cutting radius
        tool_length: Flute length
        holder_radius: Holder radius (0 = no holder check)
        holder_length: Holder length above flute

    Returns:
        (collides, min_clearance_mm) — whether collision exists and
        minimum clearance distance (negative if collision)
    """
    mesh.ensure_bvh()
    min_clearance = float("inf")

    # Check a series of sample points along the tool/holder axis
    check_points: list[tuple[float, float, float, float]] = []  # x, y, z, radius

    # Tool body: sample points along the flute
    n_tool_samples = max(3, int(tool_length / 2.0))
    for i in range(n_tool_samples + 1):
        t = i / n_tool_samples
        px = tip_x + axis_x * tool_length * t
        py = tip_y + axis_y * tool_length * t
        pz = tip_z + axis_z * tool_length * t
        check_points.append((px, py, pz, tool_radius))

    # Holder: sample points along the holder
    if holder_radius > 0 and holder_length > 0:
        n_holder_samples = max(2, int(holder_length / 5.0))
        for i in range(n_holder_samples + 1):
            t = i / n_holder_samples
            offset = tool_length + holder_length * t
            px = tip_x + axis_x * offset
            py = tip_y + axis_y * offset
            pz = tip_z + axis_z * offset
            check_points.append((px, py, pz, holder_radius))

    # For each check point, find distance to nearest mesh surface
    for px, py, pz, check_r in check_points:
        if mesh.bvh is not None:
            tri_ids = query_bvh_sphere(mesh.bvh, px, py, pz, check_r + 5.0)
        else:
            tri_ids = range(mesh.num_triangles)

        for ti in tri_ids:
            v0, v1, v2 = mesh.get_triangle_raw(ti)
            dist = _point_triangle_distance(px, py, pz, v0, v1, v2)
            clearance = dist - check_r
            if clearance < min_clearance:
                min_clearance = clearance

    return (min_clearance < 0, min_clearance)


def _point_triangle_distance(
    px: float, py: float, pz: float,
    v0: tuple, v1: tuple, v2: tuple,
) -> float:
    """Compute minimum distance from a point to a triangle in 3D."""
    # Project point onto triangle plane
    e0 = (v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2])
    e1 = (v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2])

    v = (px - v0[0], py - v0[1], pz - v0[2])

    dot00 = e0[0]*e0[0] + e0[1]*e0[1] + e0[2]*e0[2]
    dot01 = e0[0]*e1[0] + e0[1]*e1[1] + e0[2]*e1[2]
    dot11 = e1[0]*e1[0] + e1[1]*e1[1] + e1[2]*e1[2]
    dot0v = e0[0]*v[0] + e0[1]*v[1] + e0[2]*v[2]
    dot1v = e1[0]*v[0] + e1[1]*v[1] + e1[2]*v[2]

    denom = dot00 * dot11 - dot01 * dot01
    if abs(denom) < 1e-15:
        # Degenerate triangle: distance to vertices
        d0 = math.sqrt((px-v0[0])**2 + (py-v0[1])**2 + (pz-v0[2])**2)
        d1 = math.sqrt((px-v1[0])**2 + (py-v1[1])**2 + (pz-v1[2])**2)
        d2 = math.sqrt((px-v2[0])**2 + (py-v2[1])**2 + (pz-v2[2])**2)
        return min(d0, d1, d2)

    inv = 1.0 / denom
    s = (dot11 * dot0v - dot01 * dot1v) * inv
    t = (dot00 * dot1v - dot01 * dot0v) * inv

    # Clamp to triangle
    if s < 0:
        s = 0
    if t < 0:
        t = 0
    if s + t > 1:
        total = s + t
        s /= total
        t /= total

    # Closest point on triangle
    cpx = v0[0] + s * e0[0] + t * e1[0]
    cpy = v0[1] + s * e0[1] + t * e1[1]
    cpz = v0[2] + s * e0[2] + t * e1[2]

    return math.sqrt((px-cpx)**2 + (py-cpy)**2 + (pz-cpz)**2)


# ═══════════════════════════════════════════════════════════════════════
# CONTOUR SMOOTHING
# ═══════════════════════════════════════════════════════════════════════

def simplify_contour(
    points: list[tuple[float, float]],
    tolerance: float = 0.01,
) -> list[tuple[float, float]]:
    """Douglas-Peucker contour simplification."""
    if len(points) <= 2:
        return points[:]

    start = points[0]
    end = points[-1]
    max_dist = 0.0
    max_idx = 0

    dx = end[0] - start[0]
    dy = end[1] - start[1]
    line_len_sq = dx * dx + dy * dy

    for i in range(1, len(points) - 1):
        if line_len_sq < 1e-20:
            dist = math.sqrt((points[i][0] - start[0]) ** 2 + (points[i][1] - start[1]) ** 2)
        else:
            t = max(0.0, min(1.0,
                ((points[i][0] - start[0]) * dx + (points[i][1] - start[1]) * dy) / line_len_sq))
            proj_x = start[0] + t * dx
            proj_y = start[1] + t * dy
            dist = math.sqrt((points[i][0] - proj_x) ** 2 + (points[i][1] - proj_y) ** 2)

        if dist > max_dist:
            max_dist = dist
            max_idx = i

    if max_dist > tolerance:
        left = simplify_contour(points[:max_idx + 1], tolerance)
        right = simplify_contour(points[max_idx:], tolerance)
        return left[:-1] + right
    else:
        return [start, end]


def smooth_contour_3d(
    points: list[tuple[float, float, float]],
    tolerance: float = 0.01,
) -> list[tuple[float, float, float]]:
    """Douglas-Peucker simplification for 3D point sequences."""
    if len(points) <= 2:
        return points[:]

    start = points[0]
    end = points[-1]
    max_dist = 0.0
    max_idx = 0

    dx = end[0] - start[0]
    dy = end[1] - start[1]
    dz = end[2] - start[2]
    line_len_sq = dx * dx + dy * dy + dz * dz

    for i in range(1, len(points) - 1):
        if line_len_sq < 1e-20:
            dist = math.sqrt(
                (points[i][0] - start[0]) ** 2 +
                (points[i][1] - start[1]) ** 2 +
                (points[i][2] - start[2]) ** 2)
        else:
            t = max(0.0, min(1.0,
                ((points[i][0] - start[0]) * dx +
                 (points[i][1] - start[1]) * dy +
                 (points[i][2] - start[2]) * dz) / line_len_sq))
            proj_x = start[0] + t * dx
            proj_y = start[1] + t * dy
            proj_z = start[2] + t * dz
            dist = math.sqrt(
                (points[i][0] - proj_x) ** 2 +
                (points[i][1] - proj_y) ** 2 +
                (points[i][2] - proj_z) ** 2)

        if dist > max_dist:
            max_dist = dist
            max_idx = i

    if max_dist > tolerance:
        left = smooth_contour_3d(points[:max_idx + 1], tolerance)
        right = smooth_contour_3d(points[max_idx:], tolerance)
        return left[:-1] + right
    else:
        return [start, end]


# ═══════════════════════════════════════════════════════════════════════
# CHUNKED HEIGHTFIELD (parallel construction for large meshes)
# ═══════════════════════════════════════════════════════════════════════

def build_heightfield_chunked(
    mesh: Mesh,
    resolution_mm: float = 0.5,
    tool_radius: float = 0.0,
    stock_aabb: AABB | None = None,
    num_workers: int = 4,
    tool_shape: ToolShape = ToolShape.FLAT,
    corner_radius: float = 0.0,
) -> Heightfield:
    """Build heightfield using chunked parallel processing for large meshes."""
    if not HAS_NUMPY or mesh.num_triangles < 10000:
        return build_heightfield(mesh, resolution_mm, tool_radius, stock_aabb,
                                 tool_shape, corner_radius)

    b = mesh.bounds
    margin = max(tool_radius, 1.0) + resolution_mm
    if stock_aabb:
        x_lo = min(b.min_pt.x, stock_aabb.min_pt.x) - margin
        x_hi = max(b.max_pt.x, stock_aabb.max_pt.x) + margin
        y_lo = min(b.min_pt.y, stock_aabb.min_pt.y) - margin
        y_hi = max(b.max_pt.y, stock_aabb.max_pt.y) + margin
    else:
        x_lo = b.min_pt.x - margin
        x_hi = b.max_pt.x + margin
        y_lo = b.min_pt.y - margin
        y_hi = b.max_pt.y + margin

    nx = max(1, int(math.ceil((x_hi - x_lo) / resolution_mm)))
    ny = max(1, int(math.ceil((y_hi - y_lo) / resolution_mm)))

    max_cells = 4_000_000
    if nx * ny > max_cells:
        scale = math.sqrt(max_cells / (nx * ny))
        nx = max(1, int(nx * scale))
        ny = max(1, int(ny * scale))

    hf = Heightfield(x_lo, x_hi, y_lo, y_hi, nx, ny, default_z=b.min_pt.z - 1.0)

    if tool_radius > 0:
        # Use drop-cutter for accuracy
        mesh.ensure_bvh()
        r = tool_radius
        r_sq = r * r
        chunk_size = max(1, ny // num_workers)

        def _process_chunk(iy_start: int, iy_end: int) -> None:
            for iy in range(iy_start, iy_end):
                y = y_lo + iy * hf.dy
                for ix in range(nx):
                    x = x_lo + ix * hf.dx

                    if mesh.bvh is not None:
                        tri_ids = query_bvh_xy_range(mesh.bvh, x - r, x + r, y - r, y + r)
                    else:
                        tri_ids = range(mesh.num_triangles)

                    best_z = hf.grid[iy, ix]
                    for ti in tri_ids:
                        v0, v1, v2 = mesh.get_triangle_raw(ti)
                        if tool_shape == ToolShape.FLAT:
                            z = _dc_flat_triangle(x, y, r, r_sq, v0, v1, v2)
                        elif tool_shape == ToolShape.BALL:
                            z = _dc_ball_triangle(x, y, r, r_sq, v0, v1, v2)
                        elif tool_shape == ToolShape.BULL:
                            z = _dc_bull_triangle(x, y, r, r_sq, corner_radius, v0, v1, v2)
                        else:
                            z = _dc_flat_triangle(x, y, r, r_sq, v0, v1, v2)
                        if z > best_z:
                            best_z = z
                    hf.grid[iy, ix] = best_z

        chunks = []
        for start in range(0, ny, chunk_size):
            end = min(start + chunk_size, ny)
            chunks.append((start, end))

        if len(chunks) > 1:
            with ThreadPoolExecutor(max_workers=num_workers) as pool:
                futures = [pool.submit(_process_chunk, s, e) for s, e in chunks]
                for f in futures:
                    f.result()
        else:
            for s, e in chunks:
                _process_chunk(s, e)
    else:
        # Direct projection (fast path)
        _fill_heightfield_vectorized(mesh, hf)

    return hf
