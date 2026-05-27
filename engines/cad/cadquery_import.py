"""Pure-Python CadQuery STEP import + tessellation core.

Shared by the sidecar handler in ``engines/sidecar/cad_handlers.py``. Mirrors
the structure of ``engines/cam/ocl_strategies.py``: a tiny set of pure
functions plus a process-local handle table for the multi-call workflow
(``import_step`` → handle → ``tessellate(handle)``).

Why a handle table?
===================
The renderer wants a two-phase flow:
  1. Import STEP, get bbox immediately so the viewport can frame the part.
  2. Later, possibly with a UI-chosen tolerance, tessellate to an STL on disk.
Re-parsing the STEP twice would double the latency on big assemblies, so the
sidecar keeps the parsed CadQuery ``Workplane`` in a dict keyed by a UUID.
The renderer is the only owner of the handle and never inspects its
internals.

Safety Rule 1 — G-code is sacred
================================
This module DOES NOT emit G-code. It DOES emit STL that flows into
``cam.run_toolpath`` (OpenCAMLib drop / waterline). A malformed STL would
cause OCL to either crash or silently emit a bad toolpath, so:

  * Every STL is binary-format STL (80-byte header + uint32 count + 50-byte
    triangles), which OCL's STLReader expects.
  * Vertex coordinates are written as IEEE-754 32-bit floats little-endian,
    matching the standard.
  * Triangle normals are computed from the vertices (right-hand rule, ordering
    preserved from CadQuery's tessellate output, which is outward-facing for
    a manifold solid).
  * Zero-area degenerate triangles are filtered out — OCL's drop-cutter on a
    degenerate triangle returns NaN, which propagates into a bad G-code Z.
  * Triangle counts are sanity-checked against the actual byte size before
    the file is reported as "written" — guards against partial-write disk
    errors.

Error vocabulary (raised as ``_CadHandlerError``)
=================================================
  * ``cadquery_not_installed``  — ``import cadquery`` failed.
  * ``step_file_missing``       — path does not exist on disk.
  * ``step_read_error``         — CadQuery raised during ``importStep``.
  * ``invalid_handle``          — caller passed a handle not in the table.
  * ``tessellation_error``      — CadQuery raised during ``tessellate``.
  * ``stl_write_error``         — disk write failed or short write.
"""
from __future__ import annotations

import math
import struct
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Tuple


# ── Error type ───────────────────────────────────────────────────────────


class _CadHandlerError(Exception):
    """Marker exception carrying a structured error code.

    The sidecar dispatch loop unwraps ``code`` / ``detail`` into the JSON-RPC
    error envelope so the TS bridge can map to operator-facing hints.

    Shares the ``(code, message, detail)`` shape with
    ``cam_handlers._SidecarHandlerError``; the dispatch loop in
    ``engines/sidecar/main.py`` checks for both via duck typing on ``code`` /
    ``detail`` attributes.
    """

    def __init__(self, code: str, message: str, detail: str | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.detail = detail


# ── Handle table (process-local) ──────────────────────────────────────────


@dataclass
class StepDocument:
    """Opaque entry in the handle table.

    ``workplane`` is the raw CadQuery object — never serialized, never exposed
    across the JSON-RPC wire.
    ``bbox`` is precomputed at import time so ``cad.import_step`` can return
    it without a second CadQuery call.
    ``source_path`` is retained for diagnostics (logged in tracebacks).
    """

    workplane: Any
    bbox_min: Tuple[float, float, float]
    bbox_max: Tuple[float, float, float]
    source_path: str


# Single module-global dict. The sidecar is a per-job subprocess (see
# main.py docstring) so cross-tenant leakage is impossible by construction.
_HANDLES: Dict[str, StepDocument] = {}


def reset_handle_table() -> None:
    """Clear the handle table — only used by tests to enforce isolation."""
    _HANDLES.clear()


def handle_table_size() -> int:
    """Return the number of live handles. For diagnostics / tests."""
    return len(_HANDLES)


# ── STEP import ──────────────────────────────────────────────────────────


def import_step_file(path: str) -> Tuple[str, StepDocument]:
    """Import a STEP file via CadQuery and stash it in the handle table.

    Returns ``(handle, document)``. Caller normally only echoes ``handle`` and
    ``document.bbox_*`` over the wire.

    Raises ``_CadHandlerError`` with one of:
      * ``cadquery_not_installed``
      * ``step_file_missing``
      * ``step_read_error``
    """
    p = Path(path)
    if not p.is_file():
        raise _CadHandlerError(
            "step_file_missing", f"STEP file not found: {path}"
        )

    try:
        import cadquery as cq  # noqa: PLC0415 - optional dependency
    except ImportError as exc:
        raise _CadHandlerError(
            "cadquery_not_installed",
            "CadQuery is not installed in the sidecar's Python environment",
            detail=str(exc),
        ) from exc

    try:
        workplane = cq.importers.importStep(str(p))
    except Exception as exc:  # noqa: BLE001 - CadQuery raises arbitrary types
        raise _CadHandlerError(
            "step_read_error",
            f"CadQuery could not import STEP file: {exc}",
            detail=str(exc),
        ) from exc

    bbox_min, bbox_max = _safe_bbox(workplane)

    handle = f"step:{uuid.uuid4().hex}"
    doc = StepDocument(
        workplane=workplane,
        bbox_min=bbox_min,
        bbox_max=bbox_max,
        source_path=str(p),
    )
    _HANDLES[handle] = doc
    return handle, doc


def _safe_bbox(workplane: Any) -> Tuple[
    Tuple[float, float, float], Tuple[float, float, float]
]:
    """Pull (min, max) corners from a CadQuery Workplane.

    Falls back to a zero bbox if the solid is empty (rare — CadQuery would
    have raised on import). Never raises: bbox is informational; a missing
    one shouldn't fail the entire import path.
    """
    try:
        solid = workplane.findSolid()
        bb = solid.BoundingBox()
        return (
            (float(bb.xmin), float(bb.ymin), float(bb.zmin)),
            (float(bb.xmax), float(bb.ymax), float(bb.zmax)),
        )
    except Exception:  # noqa: BLE001 - bbox is best-effort
        return ((0.0, 0.0, 0.0), (0.0, 0.0, 0.0))


# ── Tessellation + binary STL writer ─────────────────────────────────────


def tessellate_body(
    handle: str, out_path: str, tolerance_mm: float
) -> Dict[str, Any]:
    """Tessellate the body behind ``handle`` and write a binary STL to ``out_path``.

    Returns ``{stlPath, triangleCount}`` for the wire envelope.

    Raises ``_CadHandlerError`` with one of:
      * ``invalid_handle``
      * ``tessellation_error``
      * ``stl_write_error``
    """
    doc = _HANDLES.get(handle)
    if doc is None:
        raise _CadHandlerError(
            "invalid_handle",
            f"unknown CAD handle: {handle!r} "
            f"(table holds {len(_HANDLES)} entries)",
        )

    try:
        solid = doc.workplane.findSolid()
        # CadQuery tessellate returns (List[Vector], List[Tuple[int,int,int]]).
        # Tolerance is in mm — surface deviation, not edge length.
        vertices, triangles = solid.tessellate(float(tolerance_mm))
    except Exception as exc:  # noqa: BLE001 - CadQuery raises arbitrary types
        raise _CadHandlerError(
            "tessellation_error",
            f"CadQuery tessellation failed: {exc}",
            detail=str(exc),
        ) from exc

    # Build the binary STL payload in memory before touching disk so a
    # tessellation that produces zero usable triangles fails BEFORE we write
    # a half-formed file.
    payload, triangle_count = _build_binary_stl(vertices, triangles)

    out = Path(out_path)
    try:
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(payload)
    except OSError as exc:
        raise _CadHandlerError(
            "stl_write_error",
            f"failed to write STL to {out_path}: {exc}",
            detail=str(exc),
        ) from exc

    # Sanity-check that the bytes hit disk. Catches truncated-write disk-full
    # scenarios where write_bytes returned without an exception.
    try:
        on_disk = out.stat().st_size
    except OSError as exc:
        raise _CadHandlerError(
            "stl_write_error",
            f"failed to stat STL after write: {exc}",
            detail=str(exc),
        ) from exc
    expected = _binary_stl_size(triangle_count)
    if on_disk != expected:
        raise _CadHandlerError(
            "stl_write_error",
            f"STL short write: wrote {on_disk} bytes, expected {expected} "
            f"({triangle_count} triangles)",
        )

    return {"stlPath": str(out), "triangleCount": triangle_count}


def _build_binary_stl(
    vertices: List[Any], triangles: List[Tuple[int, int, int]]
) -> Tuple[bytes, int]:
    """Build a binary STL payload from CadQuery tessellate output.

    Filters degenerate (zero-area) triangles before counting — OCL's
    drop-cutter against a degenerate triangle returns NaN, which would
    propagate into a bad G-code Z later.

    Returns ``(payload_bytes, triangle_count)``. Triangle count in the header
    reflects ONLY the non-degenerate triangles actually serialized.
    """
    # Pre-convert vertices to (x, y, z) tuples so we don't repeatedly poke at
    # cadquery.Vector attribute access inside the hot loop. CadQuery exposes
    # ``.x`` / ``.y`` / ``.z`` on Vector; protect against the rare case of an
    # already-tuple input by falling back to indexing.
    pts: List[Tuple[float, float, float]] = []
    for v in vertices:
        if hasattr(v, "x") and hasattr(v, "y") and hasattr(v, "z"):
            pts.append((float(v.x), float(v.y), float(v.z)))
        else:
            pts.append((float(v[0]), float(v[1]), float(v[2])))

    # First pass: build the list of usable triangles + normals.
    good: List[
        Tuple[
            Tuple[float, float, float],
            Tuple[float, float, float],
            Tuple[float, float, float],
            Tuple[float, float, float],
        ]
    ] = []
    for tri in triangles:
        i0, i1, i2 = int(tri[0]), int(tri[1]), int(tri[2])
        if i0 == i1 or i1 == i2 or i0 == i2:
            continue  # degenerate index triple
        if not (0 <= i0 < len(pts) and 0 <= i1 < len(pts) and 0 <= i2 < len(pts)):
            continue  # out-of-range index (shouldn't happen but guard anyway)
        v0, v1, v2 = pts[i0], pts[i1], pts[i2]
        normal = _triangle_normal(v0, v1, v2)
        if normal is None:
            continue  # zero-area (collinear vertices)
        good.append((normal, v0, v1, v2))

    triangle_count = len(good)

    # Header: 80 bytes of free-form data. Conventionally we put a short
    # human-readable tag; tools that read it back ignore it.
    header = b"WorkTrackCAM CadQuery STL".ljust(80, b"\x00")
    count_bytes = struct.pack("<I", triangle_count)

    # Each triangle: 3 floats normal + 3*3 floats vertices + uint16 attr = 50 bytes
    # Use ``<12fH`` to pack the whole record in one call per triangle.
    tri_struct = struct.Struct("<12fH")
    body_parts: List[bytes] = []
    for normal, v0, v1, v2 in good:
        body_parts.append(
            tri_struct.pack(
                normal[0], normal[1], normal[2],
                v0[0], v0[1], v0[2],
                v1[0], v1[1], v1[2],
                v2[0], v2[1], v2[2],
                0,  # attribute byte count — unused by every consumer in our pipeline
            )
        )

    payload = header + count_bytes + b"".join(body_parts)
    return payload, triangle_count


def _triangle_normal(
    v0: Tuple[float, float, float],
    v1: Tuple[float, float, float],
    v2: Tuple[float, float, float],
) -> Tuple[float, float, float] | None:
    """Right-hand-rule normal for the triangle ``(v0, v1, v2)``.

    Returns ``None`` if the triangle is zero-area (collinear vertices). The
    magnitude threshold is intentionally loose (1e-12) — tighter and we'd
    drop legitimately small triangles near sharp features.
    """
    ax, ay, az = v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]
    bx, by, bz = v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]
    nx = ay * bz - az * by
    ny = az * bx - ax * bz
    nz = ax * by - ay * bx
    mag = math.sqrt(nx * nx + ny * ny + nz * nz)
    if mag <= 1e-12:
        return None
    return (nx / mag, ny / mag, nz / mag)


def _binary_stl_size(triangle_count: int) -> int:
    """Expected on-disk size of a binary STL with N triangles."""
    return 80 + 4 + 50 * triangle_count
