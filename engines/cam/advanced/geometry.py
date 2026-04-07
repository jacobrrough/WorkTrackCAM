"""
Geometry engine: STL loading, mesh queries, heightfield sampling, and Z-slicing.

Uses numpy for performance. Falls back to pure-Python struct parsing if numpy
is unavailable (slower but functional).
"""
from __future__ import annotations

import math
import struct
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    pass

try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False

from .models import AABB, Vec3


# ── STL loading ──────────────────────────────────────────────────────────

class Mesh:
    """
    Triangle mesh loaded from STL.

    Stores vertices as flat arrays for fast numpy operations.
    Each triangle i has vertices at indices [i*3, i*3+1, i*3+2],
    with each vertex being (x, y, z).

    Attributes:
        vertices: (N*3, 3) array of vertex coordinates
        normals: (N, 3) array of face normals
        num_triangles: number of triangles
        bounds: axis-aligned bounding box
    """

    def __init__(
        self,
        vertices: list[tuple[float, float, float]] | None = None,
        normals: list[tuple[float, float, float]] | None = None,
    ):
        if HAS_NUMPY:
            self._verts = np.array(vertices or [], dtype=np.float64).reshape(-1, 3)
            self._norms = np.array(normals or [], dtype=np.float64).reshape(-1, 3)
        else:
            self._verts_list: list[tuple[float, float, float]] = list(vertices or [])
            self._norms_list: list[tuple[float, float, float]] = list(normals or [])

        self.num_triangles = (len(self._verts) // 3) if HAS_NUMPY else (len(self._verts_list) // 3)
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
            self._bounds = AABB(Vec3(mn[0], mn[1], mn[2]), Vec3(mx[0], mx[1], mx[2]))
        else:
            xs = [v[0] for v in self._verts_list]
            ys = [v[1] for v in self._verts_list]
            zs = [v[2] for v in self._verts_list]
            self._bounds = AABB(
                Vec3(min(xs), min(ys), min(zs)),
                Vec3(max(xs), max(ys), max(zs)),
            )
        return self._bounds

    def get_triangle(self, i: int) -> tuple[Vec3, Vec3, Vec3]:
        """Return the 3 vertices of triangle i."""
        if HAS_NUMPY:
            v0 = self._verts[i * 3]
            v1 = self._verts[i * 3 + 1]
            v2 = self._verts[i * 3 + 2]
            return Vec3(*v0), Vec3(*v1), Vec3(*v2)
        else:
            base = i * 3
            return (
                Vec3(*self._verts_list[base]),
                Vec3(*self._verts_list[base + 1]),
                Vec3(*self._verts_list[base + 2]),
            )

    def get_vertices_numpy(self):
        """Return (N*3, 3) numpy array of vertices. Raises if numpy unavailable."""
        if not HAS_NUMPY:
            raise RuntimeError("numpy required for get_vertices_numpy")
        return self._verts

    def get_triangle_vertices_numpy(self):
        """Return (N, 3, 3) numpy array: [tri_index, vertex_index, xyz]."""
        if not HAS_NUMPY:
            raise RuntimeError("numpy required")
        return self._verts.reshape(-1, 3, 3)


def load_stl(path: str | Path) -> Mesh:
    """Load an STL file (binary or ASCII) into a Mesh."""
    p = Path(path)
    data = p.read_bytes()

    if _is_ascii_stl(data):
        return _load_ascii_stl(data)
    return _load_binary_stl(data)


def _is_ascii_stl(data: bytes) -> bool:
    """Check if STL data is ASCII format."""
    # ASCII STL starts with 'solid' (but some binary files also do)
    if not data[:5].lower().startswith(b"solid"):
        return False
    # Binary STL: 80-byte header + 4-byte count + 50 bytes per triangle
    if len(data) < 84:
        return True
    tri_count = struct.unpack_from("<I", data, 80)[0]
    expected_size = 84 + tri_count * 50
    # If binary size matches exactly, it's binary
    if len(data) == expected_size:
        return False
    # Otherwise check for 'endsolid' near the end
    return b"endsolid" in data[-256:]


def _load_binary_stl(data: bytes) -> Mesh:
    """Parse binary STL into Mesh."""
    if len(data) < 84:
        raise ValueError(f"Binary STL too short: {len(data)} bytes")

    tri_count = struct.unpack_from("<I", data, 80)[0]
    if tri_count == 0:
        raise ValueError("STL contains 0 triangles")

    expected = 84 + tri_count * 50
    if len(data) < expected:
        raise ValueError(f"STL truncated: expected {expected} bytes, got {len(data)}")

    if HAS_NUMPY:
        # Fast numpy parsing
        dt = np.dtype([
            ("normal", "<f4", (3,)),
            ("v0", "<f4", (3,)),
            ("v1", "<f4", (3,)),
            ("v2", "<f4", (3,)),
            ("attr", "<u2"),
        ])
        tris = np.frombuffer(data, dtype=dt, count=tri_count, offset=84)
        normals = tris["normal"].astype(np.float64)
        # Interleave v0, v1, v2 into (N*3, 3)
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
        mesh.num_triangles = tri_count
        mesh._bounds = None
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
            offset += 2  # attribute byte count
        return Mesh(vertices=vertices, normals=normals_list)


def _load_ascii_stl(data: bytes) -> Mesh:
    """Parse ASCII STL into Mesh."""
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


# ── Heightfield sampling ─────────────────────────────────────────────────

class Heightfield:
    """
    2D grid of Z heights sampled from mesh surface.

    Used for raster finishing and rest machining detection.
    Grid is aligned to XY plane with configurable resolution.
    """

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
        self.default_z = default_z

        if HAS_NUMPY:
            self.grid = np.full((self.ny, self.nx), default_z, dtype=np.float64)
        else:
            self.grid_list = [[default_z] * self.nx for _ in range(self.ny)]

    def set_z(self, ix: int, iy: int, z: float) -> None:
        if 0 <= ix < self.nx and 0 <= iy < self.ny:
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
            return v if math.isfinite(v) else self.default_z
        return self.default_z

    def sample_z(self, x: float, y: float) -> float:
        """Bilinear interpolation of Z at world (x, y)."""
        fx = (x - self.x_min) / self.dx
        fy = (y - self.y_min) / self.dy
        ix = int(math.floor(fx))
        iy = int(math.floor(fy))
        ix = max(0, min(ix, self.nx - 2))
        iy = max(0, min(iy, self.ny - 2))
        tx = fx - ix
        ty = fy - iy
        tx = max(0.0, min(1.0, tx))
        ty = max(0.0, min(1.0, ty))

        z00 = self.get_z(ix, iy)
        z10 = self.get_z(ix + 1, iy)
        z01 = self.get_z(ix, iy + 1)
        z11 = self.get_z(ix + 1, iy + 1)

        z0 = z00 + (z10 - z00) * tx
        z1 = z01 + (z11 - z01) * tx
        result = z0 + (z1 - z0) * ty
        # Guard: if interpolation produces a non-finite value (e.g. from OOB sentinel
        # mixing with valid cells), clamp to the default Z so callers get a safe value.
        if not math.isfinite(result):
            return self.default_z
        return result

    def world_x(self, ix: int) -> float:
        return self.x_min + ix * self.dx

    def world_y(self, iy: int) -> float:
        return self.y_min + iy * self.dy


def build_heightfield(mesh: Mesh, resolution_mm: float = 0.5,
                      tool_radius: float = 0.0) -> Heightfield:
    """
    Build a heightfield from a mesh by ray-casting downward (-Z) at each grid point.

    Uses Moller-Trumbore ray-triangle intersection.
    If tool_radius > 0, applies a min-envelope dilation (conservative tool compensation).
    """
    b = mesh.bounds
    margin = tool_radius + resolution_mm
    nx = max(1, int(math.ceil((b.max_pt.x - b.min_pt.x + 2 * margin) / resolution_mm)))
    ny = max(1, int(math.ceil((b.max_pt.y - b.min_pt.y + 2 * margin) / resolution_mm)))

    # Cap grid size to prevent OOM
    max_grid = 2000
    if nx > max_grid:
        nx = max_grid
    if ny > max_grid:
        ny = max_grid

    hf = Heightfield(
        b.min_pt.x - margin, b.max_pt.x + margin,
        b.min_pt.y - margin, b.max_pt.y + margin,
        nx, ny, default_z=b.min_pt.z - 1.0,
    )

    if HAS_NUMPY and mesh.num_triangles > 0:
        _fill_heightfield_numpy(mesh, hf)
    elif mesh.num_triangles > 0:
        _fill_heightfield_pure(mesh, hf)

    if tool_radius > 0:
        _apply_tool_radius_compensation(hf, tool_radius)

    return hf


def _fill_heightfield_numpy(mesh: Mesh, hf: Heightfield) -> None:
    """Vectorized heightfield fill using numpy."""
    tris = mesh.get_triangle_vertices_numpy()  # (N, 3, 3)
    v0 = tris[:, 0, :]  # (N, 3)
    v1 = tris[:, 1, :]
    v2 = tris[:, 2, :]

    # Precompute triangle bounding boxes in XY
    tri_xmin = np.minimum(np.minimum(v0[:, 0], v1[:, 0]), v2[:, 0])
    tri_xmax = np.maximum(np.maximum(v0[:, 0], v1[:, 0]), v2[:, 0])
    tri_ymin = np.minimum(np.minimum(v0[:, 1], v1[:, 1]), v2[:, 1])
    tri_ymax = np.maximum(np.maximum(v0[:, 1], v1[:, 1]), v2[:, 1])

    for iy in range(hf.ny):
        y = hf.world_y(iy)
        # Filter triangles that overlap this Y row
        y_mask = (tri_ymin <= y) & (tri_ymax >= y)
        if not np.any(y_mask):
            continue

        row_v0 = v0[y_mask]
        row_v1 = v1[y_mask]
        row_v2 = v2[y_mask]
        row_xmin = tri_xmin[y_mask]
        row_xmax = tri_xmax[y_mask]

        for ix in range(hf.nx):
            x = hf.world_x(ix)
            # Filter triangles overlapping this X
            x_mask = (row_xmin <= x) & (row_xmax >= x)
            if not np.any(x_mask):
                continue

            sel_v0 = row_v0[x_mask]
            sel_v1 = row_v1[x_mask]
            sel_v2 = row_v2[x_mask]

            # Barycentric test for each triangle
            max_z = hf.get_z(ix, iy)
            for ti in range(len(sel_v0)):
                z = _ray_z_at_xy(
                    x, y,
                    sel_v0[ti, 0], sel_v0[ti, 1], sel_v0[ti, 2],
                    sel_v1[ti, 0], sel_v1[ti, 1], sel_v1[ti, 2],
                    sel_v2[ti, 0], sel_v2[ti, 1], sel_v2[ti, 2],
                )
                if z is not None and z > max_z:
                    max_z = z
            hf.set_z(ix, iy, max_z)


def _fill_heightfield_pure(mesh: Mesh, hf: Heightfield) -> None:
    """Pure-Python heightfield fill (slower but no deps)."""
    for i in range(mesh.num_triangles):
        v0, v1, v2 = mesh.get_triangle(i)
        # Triangle XY bounding box
        txmin = min(v0.x, v1.x, v2.x)
        txmax = max(v0.x, v1.x, v2.x)
        tymin = min(v0.y, v1.y, v2.y)
        tymax = max(v0.y, v1.y, v2.y)

        ix_start = max(0, int(math.floor((txmin - hf.x_min) / hf.dx)))
        ix_end = min(hf.nx - 1, int(math.ceil((txmax - hf.x_min) / hf.dx)))
        iy_start = max(0, int(math.floor((tymin - hf.y_min) / hf.dy)))
        iy_end = min(hf.ny - 1, int(math.ceil((tymax - hf.y_min) / hf.dy)))

        for iy in range(iy_start, iy_end + 1):
            y = hf.world_y(iy)
            for ix in range(ix_start, ix_end + 1):
                x = hf.world_x(ix)
                z = _ray_z_at_xy(
                    x, y,
                    v0.x, v0.y, v0.z,
                    v1.x, v1.y, v1.z,
                    v2.x, v2.y, v2.z,
                )
                if z is not None and z > hf.get_z(ix, iy):
                    hf.set_z(ix, iy, z)


def _ray_z_at_xy(
    px: float, py: float,
    ax: float, ay: float, az: float,
    bx: float, by: float, bz: float,
    cx: float, cy: float, cz: float,
) -> float | None:
    """
    Find Z where vertical ray at (px, py) intersects triangle (a, b, c).

    Returns Z value or None if ray misses the triangle.
    Uses barycentric coordinates in the XY projection.
    """
    # Vectors in XY
    v0x = cx - ax
    v0y = cy - ay
    v1x = bx - ax
    v1y = by - ay
    v2x = px - ax
    v2y = py - ay

    # Dot products
    dot00 = v0x * v0x + v0y * v0y
    dot01 = v0x * v1x + v0y * v1y
    dot02 = v0x * v2x + v0y * v2y
    dot11 = v1x * v1x + v1y * v1y
    dot12 = v1x * v2x + v1y * v2y

    denom = dot00 * dot11 - dot01 * dot01
    if abs(denom) < 1e-12:
        return None

    inv_denom = 1.0 / denom
    u = (dot11 * dot02 - dot01 * dot12) * inv_denom
    v = (dot00 * dot12 - dot01 * dot02) * inv_denom

    if u < -1e-8 or v < -1e-8 or (u + v) > 1.0 + 1e-8:
        return None

    # Interpolate Z
    return az + u * (cz - az) + v * (bz - az)


def _apply_tool_radius_compensation(hf: Heightfield, radius: float) -> None:
    """
    Conservative tool radius offset: at each grid point, take the minimum Z
    in a circular neighborhood of the tool radius. This ensures the tool
    center stays above the surface.
    """
    r_cells = max(1, int(math.ceil(radius / min(hf.dx, hf.dy))))

    if HAS_NUMPY:
        original = hf.grid.copy()
        for dy in range(-r_cells, r_cells + 1):
            for dx in range(-r_cells, r_cells + 1):
                dist = math.sqrt((dx * hf.dx) ** 2 + (dy * hf.dy) ** 2)
                if dist > radius:
                    continue
                shifted = np.roll(np.roll(original, -dy, axis=0), -dx, axis=1)
                # Mask border regions that wrapped around
                if dy > 0:
                    shifted[-dy:, :] = original[-dy:, :]
                elif dy < 0:
                    shifted[:-dy, :] = original[:-dy, :]
                if dx > 0:
                    shifted[:, -dx:] = original[:, -dx:]
                elif dx < 0:
                    shifted[:, :-dx] = original[:, :-dx]
                np.minimum(hf.grid, shifted, out=hf.grid)
    else:
        original = [row[:] for row in hf.grid_list]
        for iy in range(hf.ny):
            for ix in range(hf.nx):
                min_z = original[iy][ix]
                for dy in range(-r_cells, r_cells + 1):
                    ny_ = iy + dy
                    if ny_ < 0 or ny_ >= hf.ny:
                        continue
                    for dx in range(-r_cells, r_cells + 1):
                        nx_ = ix + dx
                        if nx_ < 0 or nx_ >= hf.nx:
                            continue
                        dist = math.sqrt((dx * hf.dx) ** 2 + (dy * hf.dy) ** 2)
                        if dist <= radius:
                            min_z = min(min_z, original[ny_][nx_])
                hf.grid_list[iy][ix] = min_z


# ── Z-level slicing ──────────────────────────────────────────────────────

def slice_mesh_at_z(mesh: Mesh, z: float) -> list[list[tuple[float, float]]]:
    """
    Slice mesh at a constant Z level, returning closed contour loops.

    Each loop is a list of (x, y) points forming a closed polygon.
    """
    # Collect edge intersection segments
    segments: list[tuple[tuple[float, float], tuple[float, float]]] = []

    for i in range(mesh.num_triangles):
        v0, v1, v2 = mesh.get_triangle(i)
        verts = [v0, v1, v2]
        crossings: list[tuple[float, float]] = []

        for j in range(3):
            a = verts[j]
            b = verts[(j + 1) % 3]
            if (a.z <= z <= b.z) or (b.z <= z <= a.z):
                dz = b.z - a.z
                if abs(dz) < 1e-12:
                    # Edge lies on the plane — add both endpoints
                    crossings.append((a.x, a.y))
                    crossings.append((b.x, b.y))
                else:
                    t = (z - a.z) / dz
                    t = max(0.0, min(1.0, t))
                    x = a.x + t * (b.x - a.x)
                    y = a.y + t * (b.y - a.y)
                    crossings.append((x, y))

        # Remove duplicates (within tolerance)
        unique: list[tuple[float, float]] = []
        for pt in crossings:
            is_dup = False
            for u in unique:
                if abs(pt[0] - u[0]) < 1e-8 and abs(pt[1] - u[1]) < 1e-8:
                    is_dup = True
                    break
            if not is_dup:
                unique.append(pt)

        if len(unique) == 2:
            segments.append((unique[0], unique[1]))

    if not segments:
        return []

    # Chain segments into loops
    return _chain_segments(segments)


def _chain_segments(
    segments: list[tuple[tuple[float, float], tuple[float, float]]],
    tol: float = 1e-4,
) -> list[list[tuple[float, float]]]:
    """Chain line segments into closed loops by matching endpoints."""
    remaining = list(segments)
    loops: list[list[tuple[float, float]]] = []

    while remaining:
        seg = remaining.pop(0)
        chain = [seg[0], seg[1]]

        changed = True
        while changed:
            changed = False
            for i, s in enumerate(remaining):
                # Try to extend from chain end
                if _pt_close(chain[-1], s[0], tol):
                    chain.append(s[1])
                    remaining.pop(i)
                    changed = True
                    break
                elif _pt_close(chain[-1], s[1], tol):
                    chain.append(s[0])
                    remaining.pop(i)
                    changed = True
                    break
                # Try to extend from chain start
                elif _pt_close(chain[0], s[1], tol):
                    chain.insert(0, s[0])
                    remaining.pop(i)
                    changed = True
                    break
                elif _pt_close(chain[0], s[0], tol):
                    chain.insert(0, s[1])
                    remaining.pop(i)
                    changed = True
                    break

        if len(chain) >= 3:
            loops.append(chain)

    return loops


def _pt_close(a: tuple[float, float], b: tuple[float, float], tol: float) -> bool:
    return abs(a[0] - b[0]) < tol and abs(a[1] - b[1]) < tol


# ── Contour offsetting ───────────────────────────────────────────────────

def offset_contour(points: list[tuple[float, float]], offset: float) -> list[tuple[float, float]]:
    """
    Offset a 2D contour inward (negative offset) or outward (positive offset).

    Uses vertex normal bisector method. Handles convex and mildly concave contours.
    For complex self-intersecting results, a full polygon clipping library would be needed.
    """
    n = len(points)
    if n < 3:
        return points[:]

    result: list[tuple[float, float]] = []
    for i in range(n):
        p_prev = points[(i - 1) % n]
        p_curr = points[i]
        p_next = points[(i + 1) % n]

        # Edge normals (pointing inward for CW winding)
        e1x = p_curr[0] - p_prev[0]
        e1y = p_curr[1] - p_prev[1]
        e2x = p_next[0] - p_curr[0]
        e2y = p_next[1] - p_curr[1]

        # Perpendicular normals (left of edge direction)
        n1x, n1y = -e1y, e1x
        n2x, n2y = -e2y, e2x

        # Normalize
        l1 = math.sqrt(n1x**2 + n1y**2)
        l2 = math.sqrt(n2x**2 + n2y**2)
        if l1 < 1e-12 or l2 < 1e-12:
            result.append(p_curr)
            continue

        n1x /= l1
        n1y /= l1
        n2x /= l2
        n2y /= l2

        # Bisector
        bx = n1x + n2x
        by = n1y + n2y
        bl = math.sqrt(bx**2 + by**2)
        if bl < 1e-12:
            result.append(p_curr)
            continue

        bx /= bl
        by /= bl

        # Scale by 1/cos(half-angle) to maintain correct offset distance
        cos_half = bx * n1x + by * n1y
        if abs(cos_half) < 0.1:
            cos_half = 0.1  # clamp to avoid spikes at sharp corners

        d = offset / cos_half
        result.append((p_curr[0] + bx * d, p_curr[1] + by * d))

    return result


def contour_winding(points: list[tuple[float, float]]) -> float:
    """Return signed area (positive = CCW, negative = CW)."""
    area = 0.0
    n = len(points)
    for i in range(n):
        j = (i + 1) % n
        area += points[i][0] * points[j][1]
        area -= points[j][0] * points[i][1]
    return area / 2.0
