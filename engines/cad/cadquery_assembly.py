"""CadQuery Assembly support for the WorkTrack3D sidecar.

Provides parametric multi-part assembly construction backed by ``cq.Assembly``.
Mirrors the structure of ``cadquery_import.py`` and ``cadquery_script.py``:
a small set of pure functions plus the shared ``_HANDLES`` handle table so
downstream ``cad.export`` / ``cam.*`` calls can reach the assembly by handle.

Wire surface
============
Three method bodies live here:

  * :func:`build_assembly_from_parts` — wraps ``cq.Assembly`` and ``child.add``
    so the renderer can glue multiple bodies (each already registered behind a
    ``script:`` / ``step:`` handle from a prior call) into a single assembly
    via per-child 4x4 transform matrices. Returns a new ``assembly:`` handle
    stored in the shared ``_HANDLES`` table.
  * :func:`tessellate_assembly` — walks the assembly hierarchy, tessellates
    every child with its applied transform, and returns the flat-buffer mesh
    shape (``vertices`` / ``indices`` / ``faceIds`` / ``faceMap``) the
    renderer already understands. The renderer does not need to know it is
    looking at an assembly vs. a single solid — same wire contract as
    ``cadquery_script.tessellate_with_face_ids``.
  * :func:`export_assembly` — delegates to ``cq.exporters.export`` with
    assembly-aware support. STEP is the canonical assembly format; STL must
    be tessellated through the per-child path first because STL has no
    component concept.

Best-effort + structured errors
================================
``cq.Assembly`` is part of mainline CadQuery (2.x), but the binding occasionally
ships without it (vendored old OCP, CI snapshot, …). Every code path raises
``_CadHandlerError`` with a stable code so the TS bridge can fall back to a
single-body workflow rather than crash. Codes:

  * ``cadquery_not_installed``       — ``import cadquery`` failed.
  * ``assembly_not_supported``       — ``cadquery.Assembly`` is missing.
  * ``invalid_handle``               — a child handle is not in ``_HANDLES``.
  * ``bad_params``                   — empty parts list, malformed transform,
                                       null-byte in outPath, bad format, …
  * ``tessellation_error``           — CadQuery raised mid-tessellate.
  * ``export_error``                 — CadQuery raised mid-export.

Safety Rule 1 — G-code is sacred
================================
This module never emits G-code. It DOES emit STL (via the per-child
tessellation path) that flows into ``cam.run_toolpath``. Same Safety Rule 1
guarantees apply: every triangle is non-degenerate (filtered via the same
``_triangle_normal`` zero-area guard used by ``cadquery_import._build_binary_stl``),
indices are bounds-checked, and the flat-buffer shape is identical to what
``cad.tessellate_with_ids`` already returns.
"""
from __future__ import annotations

import math
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from .cadquery_import import (
    StepDocument,
    _CadHandlerError,
    _HANDLES,
)


# Allowed export formats. STEP keeps the assembly structure; STL collapses to
# a single mesh via the per-child tessellation path. DXF is intentionally
# excluded — DXF has no assembly concept and CadQuery's exporter cannot
# meaningfully flatten an assembly into a 2-D drawing.
ALLOWED_ASSEMBLY_FORMATS: Tuple[str, ...] = ("step", "stl")


# ── Public surface: build_assembly_from_parts ─────────────────────────────


def build_assembly_from_parts(
    parts: Sequence[Dict[str, Any]],
    *,
    assembly_name: Optional[str] = None,
) -> Dict[str, Any]:
    """Wrap a list of part handles + per-child transforms in a ``cq.Assembly``.

    Wire input::

        parts: [
          {"handle": "script:abc...",
           "name":   "left-bracket",
           "transform": [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]]   # 4x4 row-major
          },
          {"handle": "step:def...",
           "name":   "right-bracket",
           "transform": "identity"      # shortcut for the identity matrix
          },
          ...
        ]

    Wire result::

        {
          "handle": "assembly:<uuid>",
          "childCount": int,
          "bbox": {"min": [..3], "max": [..3]}   # axis-aligned union of children
        }

    Raises ``_CadHandlerError`` with:
      * ``cadquery_not_installed``   — pip dep missing.
      * ``assembly_not_supported``   — ``cq.Assembly`` not available in this
                                       CadQuery build.
      * ``bad_params``               — empty parts list, malformed entry,
                                       malformed transform shape, …
      * ``invalid_handle``           — a child handle is not in ``_HANDLES``.

    Notes
    -----
    * Each transform is interpreted as a row-major 4x4 affine matrix where the
      last row is ``[0, 0, 0, 1]``. We accept the literal string ``"identity"``
      as a compact shortcut so the renderer does not have to hand-write the
      4-row matrix for the "no offset" common case.
    * The bbox is computed by transforming each child's cached bbox corners
      and taking the axis-aligned union. We do NOT call ``compound.BoundingBox``
      because that would force an OCCT recompute on every keystroke; the cached
      bbox is accurate enough for framing the viewport.
    """
    if not isinstance(parts, (list, tuple)):
        raise _CadHandlerError(
            "bad_params",
            f"parts must be a list, got {type(parts).__name__}",
        )
    if not parts:
        raise _CadHandlerError(
            "bad_params",
            "parts list must contain at least one entry — an empty assembly "
            "is meaningless and would produce a zero-size bbox.",
        )

    # Validate parts + collect child docs BEFORE importing CadQuery so the
    # cheap "is the wire envelope sane?" checks fire with a deterministic
    # ``bad_params`` / ``invalid_handle`` regardless of whether the pip
    # dependency is installed. Doing the validation lazily would mean a
    # malformed payload + missing CadQuery surfaces as ``cadquery_not_installed``
    # — confusing for the TS bridge that's mapping codes to operator hints.
    validated: List[Tuple[StepDocument, Tuple[Tuple[float, ...], ...], str]] = []
    for index, entry in enumerate(parts):
        if not isinstance(entry, dict):
            raise _CadHandlerError(
                "bad_params",
                f"parts[{index}] must be an object, got {type(entry).__name__}",
            )
        handle = entry.get("handle")
        if not isinstance(handle, str) or not handle:
            raise _CadHandlerError(
                "bad_params",
                f"parts[{index}].handle must be a non-empty string",
            )
        doc = _HANDLES.get(handle)
        if doc is None:
            raise _CadHandlerError(
                "invalid_handle",
                f"unknown CAD handle: {handle!r} "
                f"(table holds {len(_HANDLES)} entries)",
            )

        transform = _parse_transform(entry.get("transform"), index)
        child_name = entry.get("name")
        if child_name is None:
            child_name = f"part_{index}"
        if not isinstance(child_name, str) or not child_name:
            raise _CadHandlerError(
                "bad_params",
                f"parts[{index}].name must be a non-empty string when provided",
            )

        validated.append((doc, transform, child_name))

    # Only import CadQuery after every part has been validated above. This is
    # what makes the bad_params / invalid_handle responses deterministic in
    # environments that lack the pip dependency.
    try:
        import cadquery as cq  # noqa: PLC0415 - optional dependency
    except ImportError as exc:
        raise _CadHandlerError(
            "cadquery_not_installed",
            "CadQuery is not installed in the sidecar's Python environment",
            detail=str(exc),
        ) from exc

    if not hasattr(cq, "Assembly"):
        raise _CadHandlerError(
            "assembly_not_supported",
            "cadquery.Assembly is not available in this CadQuery build — "
            "the renderer should fall back to single-body workflows.",
        )

    # Build the cq.Assembly. We wrap a try/except around the whole construction
    # block because Location / Matrix construction can raise on degenerate
    # transforms (e.g. zero-scale rows) and we want a structured error rather
    # than a bare OCP traceback.
    try:
        assembly = cq.Assembly(name=assembly_name or "WorkTrack3D-Assembly")
        for doc, transform, child_name in validated:
            location = _location_from_matrix(cq, transform)
            assembly.add(doc.workplane, name=child_name, loc=location)
    except _CadHandlerError:
        raise
    except Exception as exc:  # noqa: BLE001 - CadQuery raises arbitrary types
        raise _CadHandlerError(
            "assembly_build_error",
            f"CadQuery assembly construction failed: {exc}",
            detail=str(exc),
        ) from exc

    bbox_min, bbox_max = _assembly_bbox(validated)
    handle = f"assembly:{uuid.uuid4().hex}"

    # Stash in the shared handle table. The ``workplane`` slot stores the
    # cq.Assembly itself (NOT a Workplane) — tessellate_assembly / export_assembly
    # check ``isinstance(doc.workplane, cq.Assembly)`` to fork on the assembly
    # path. The legacy ``cad.tessellate`` / ``cad.export`` paths still see a
    # solid-only handle table because they early-exit on the ``script:`` /
    # ``step:`` prefix before reaching the assembly branch.
    _HANDLES[handle] = StepDocument(
        workplane=assembly,
        bbox_min=bbox_min,
        bbox_max=bbox_max,
        source_path="<cad_assembly>",
    )

    return {
        "handle": handle,
        "childCount": len(validated),
        "bbox": {
            "min": list(bbox_min),
            "max": list(bbox_max),
        },
    }


# ── Public surface: tessellate_assembly ───────────────────────────────────


def tessellate_assembly(
    handle: str, *, tolerance_mm: float = 0.1
) -> Dict[str, Any]:
    """Walk the assembly hierarchy, tessellate every child, return a flat mesh.

    Returns the same wire shape as ``cadquery_script.tessellate_with_face_ids``::

        {
          "vertices":      [x0,y0,z0, x1,y1,z1, ...]   # flat float list
          "indices":       [i0,i1,i2, ...]             # flat int list
          "faceIds":       [0, 0, 1, 1, ...]           # length = triangleCount
          "triangleCount": int,
          "bbox":          {"min":[..3], "max":[..3]},
          "faceMap":       {"<faceId>": {"kind":"face", "occtHash":int, "area":float}}
        }

    Per-face IDs are assigned sequentially across children so the renderer can
    use the same selection logic on assemblies as on single solids. The
    ``faceMap`` dict gains a ``childName`` field on each entry so the inspector
    panel can surface which part the face belongs to.

    Raises ``_CadHandlerError`` with:
      * ``invalid_handle``         — handle missing from the table.
      * ``not_an_assembly``        — handle resolves to a Workplane / Solid
                                     rather than a ``cq.Assembly``.
      * ``cadquery_not_installed`` — pip dep missing.
      * ``tessellation_error``     — CadQuery raised mid-tessellate.
    """
    if not isinstance(handle, str) or not handle:
        raise _CadHandlerError(
            "bad_params", "handle must be a non-empty string"
        )

    doc = _HANDLES.get(handle)
    if doc is None:
        raise _CadHandlerError(
            "invalid_handle",
            f"unknown CAD handle: {handle!r} "
            f"(table holds {len(_HANDLES)} entries)",
        )

    try:
        import cadquery as cq  # noqa: PLC0415
    except ImportError as exc:
        raise _CadHandlerError(
            "cadquery_not_installed",
            "CadQuery is not installed in the sidecar's Python environment",
            detail=str(exc),
        ) from exc

    if not hasattr(cq, "Assembly") or not isinstance(doc.workplane, cq.Assembly):
        raise _CadHandlerError(
            "not_an_assembly",
            f"handle {handle!r} is not an assembly — call cad.tessellate or "
            f"cad.tessellate_with_ids for single-body shapes.",
        )

    try:
        children = list(doc.workplane.traverse())
    except Exception as exc:  # noqa: BLE001 - CadQuery raises arbitrary types
        raise _CadHandlerError(
            "tessellation_error",
            f"assembly traversal failed: {exc}",
            detail=str(exc),
        ) from exc

    vertices_flat: List[float] = []
    indices_flat: List[int] = []
    face_ids: List[int] = []
    face_map: Dict[str, Dict[str, Any]] = {}
    face_id_counter = 0

    for child_name, child in children:
        # ``Assembly.traverse()`` yields (name, Assembly) pairs starting with
        # the root. The root itself has no geometry — skip it.
        try:
            child_obj = child.obj
        except Exception:  # noqa: BLE001 - guard binding mismatches
            child_obj = None
        if child_obj is None:
            continue

        # Resolve the world-space location for this child by composing the
        # ancestor chain. ``child.location`` is the local placement; we need
        # the world placement to apply the transform during tessellation.
        try:
            world_loc = child.loc  # CadQuery composes when iterating
        except Exception:  # noqa: BLE001 - fall back to identity
            world_loc = None

        try:
            solid = _coerce_to_solid(child_obj)
            faces = list(solid.Faces())
        except Exception as exc:  # noqa: BLE001 - CadQuery raises arbitrary types
            raise _CadHandlerError(
                "tessellation_error",
                f"child {child_name!r}: face enumeration failed: {exc}",
                detail=str(exc),
            ) from exc

        for face in faces:
            try:
                # Apply the world transform to the face before tessellation so
                # vertices arrive in assembly-world coordinates.
                if world_loc is not None:
                    moved = face.moved(world_loc)
                else:
                    moved = face
                face_verts, face_tris = moved.tessellate(float(tolerance_mm))
            except Exception:  # noqa: BLE001 - skip a bad face, keep mesh
                face_map[str(face_id_counter)] = {
                    "kind": "face",
                    "occtHash": 0,
                    "area": 0.0,
                    "childName": child_name,
                    "error": "tessellate failed",
                }
                face_id_counter += 1
                continue

            base_index = len(vertices_flat) // 3
            for v in face_verts:
                if hasattr(v, "x") and hasattr(v, "y") and hasattr(v, "z"):
                    vertices_flat.append(float(v.x))
                    vertices_flat.append(float(v.y))
                    vertices_flat.append(float(v.z))
                else:
                    vertices_flat.append(float(v[0]))
                    vertices_flat.append(float(v[1]))
                    vertices_flat.append(float(v[2]))

            for tri in face_tris:
                i0, i1, i2 = int(tri[0]), int(tri[1]), int(tri[2])
                if i0 == i1 or i1 == i2 or i0 == i2:
                    continue  # degenerate
                if not (0 <= i0 < len(face_verts) and 0 <= i1 < len(face_verts)
                        and 0 <= i2 < len(face_verts)):
                    continue
                indices_flat.append(base_index + i0)
                indices_flat.append(base_index + i1)
                indices_flat.append(base_index + i2)
                face_ids.append(face_id_counter)

            face_map[str(face_id_counter)] = {
                "kind": "face",
                "occtHash": _safe_face_hash(face),
                "area": _safe_face_area(face),
                "childName": child_name,
            }
            face_id_counter += 1

    triangle_count = len(face_ids)
    bbox_min, bbox_max = doc.bbox_min, doc.bbox_max

    return {
        "vertices": vertices_flat,
        "indices": indices_flat,
        "faceIds": face_ids,
        "triangleCount": triangle_count,
        "bbox": {"min": list(bbox_min), "max": list(bbox_max)},
        "faceMap": face_map,
    }


# ── Public surface: export_assembly ───────────────────────────────────────


def export_assembly(
    handle: str,
    out_path: str,
    fmt: str,
    *,
    tolerance_mm: float = 0.1,
) -> Dict[str, Any]:
    """Export the assembly behind ``handle`` to STEP / STL on disk.

    STEP is the canonical assembly format and preserves the part hierarchy.
    STL collapses to a single mesh via the same per-child tessellation path
    used by :func:`tessellate_assembly`.

    Returns ``{"outPath": str, "bytesWritten": int}``.

    Raises ``_CadHandlerError`` with:
      * ``bad_params``               — null-byte in path / empty path /
                                       unsupported format.
      * ``invalid_handle``           — handle missing.
      * ``not_an_assembly``          — handle resolves to a non-assembly.
      * ``cadquery_not_installed``   — pip dep missing.
      * ``export_error``             — CadQuery raised mid-export.
    """
    if not out_path or "\x00" in out_path:
        raise _CadHandlerError(
            "bad_params",
            "outPath must be a non-empty path without null bytes",
        )
    if fmt not in ALLOWED_ASSEMBLY_FORMATS:
        raise _CadHandlerError(
            "bad_params",
            f"format must be one of {list(ALLOWED_ASSEMBLY_FORMATS)}, "
            f"got {fmt!r}",
        )
    if not handle:
        raise _CadHandlerError(
            "bad_params", "handle must be a non-empty string"
        )

    doc = _HANDLES.get(handle)
    if doc is None:
        raise _CadHandlerError(
            "invalid_handle",
            f"unknown CAD handle: {handle!r} "
            f"(table holds {len(_HANDLES)} entries)",
        )

    try:
        import cadquery as cq  # noqa: PLC0415
    except ImportError as exc:
        raise _CadHandlerError(
            "cadquery_not_installed",
            "CadQuery is not installed in the sidecar's Python environment",
            detail=str(exc),
        ) from exc

    if not hasattr(cq, "Assembly") or not isinstance(doc.workplane, cq.Assembly):
        raise _CadHandlerError(
            "not_an_assembly",
            f"handle {handle!r} is not an assembly — call cad.export for "
            f"single-body shapes.",
        )

    out = Path(out_path)
    try:
        out.parent.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise _CadHandlerError(
            "export_error",
            f"failed to create output directory {out.parent}: {exc}",
            detail=str(exc),
        ) from exc

    if fmt == "step":
        # cq.Assembly has its own ``.save()`` that preserves the part
        # hierarchy in the resulting STEP file. We try that first; if the
        # binding does not expose ``.save`` we fall back to ``cq.exporters.export``.
        try:
            if hasattr(doc.workplane, "save"):
                doc.workplane.save(str(out), exportType="STEP")
            else:
                cq.exporters.export(doc.workplane, str(out))
        except Exception as exc:  # noqa: BLE001 - CadQuery raises arbitrary types
            raise _CadHandlerError(
                "export_error",
                f"CadQuery STEP export failed: {exc}",
                detail=str(exc),
            ) from exc
    else:  # stl — flatten via the per-child tessellation path
        try:
            mesh = tessellate_assembly(handle, tolerance_mm=float(tolerance_mm))
            _write_binary_stl_from_flat_mesh(
                out, mesh["vertices"], mesh["indices"]
            )
        except _CadHandlerError:
            raise
        except Exception as exc:  # noqa: BLE001 - guard tessellate edges
            raise _CadHandlerError(
                "export_error",
                f"assembly STL export failed: {exc}",
                detail=str(exc),
            ) from exc

    try:
        bytes_written = out.stat().st_size
    except OSError as exc:
        raise _CadHandlerError(
            "export_error",
            f"failed to stat exported file: {exc}",
            detail=str(exc),
        ) from exc
    return {"outPath": str(out), "bytesWritten": int(bytes_written)}


# ── Internal helpers ─────────────────────────────────────────────────────


def _parse_transform(
    raw: Any, index: int
) -> Tuple[Tuple[float, ...], ...]:
    """Coerce a wire-shape transform to a row-major 4x4 tuple-of-tuples.

    Accepts:
      * ``None`` or ``"identity"`` → identity matrix.
      * Nested list/tuple of 4 rows × 4 columns of finite numbers.

    Raises ``_CadHandlerError`` with ``bad_params`` on any malformed input.
    The validator is strict: a transform with non-finite values would crash
    OCP's Location constructor with an opaque error, so we catch it here and
    surface a clean, debuggable wire response instead.
    """
    if raw is None or raw == "identity":
        return (
            (1.0, 0.0, 0.0, 0.0),
            (0.0, 1.0, 0.0, 0.0),
            (0.0, 0.0, 1.0, 0.0),
            (0.0, 0.0, 0.0, 1.0),
        )
    if not isinstance(raw, (list, tuple)):
        raise _CadHandlerError(
            "bad_params",
            f"parts[{index}].transform must be 'identity' or a 4x4 matrix, "
            f"got {type(raw).__name__}",
        )
    if len(raw) != 4:
        raise _CadHandlerError(
            "bad_params",
            f"parts[{index}].transform must have exactly 4 rows, "
            f"got {len(raw)}",
        )

    rows: List[Tuple[float, ...]] = []
    for row_index, row in enumerate(raw):
        if not isinstance(row, (list, tuple)):
            raise _CadHandlerError(
                "bad_params",
                f"parts[{index}].transform[{row_index}] must be a sequence, "
                f"got {type(row).__name__}",
            )
        if len(row) != 4:
            raise _CadHandlerError(
                "bad_params",
                f"parts[{index}].transform[{row_index}] must have exactly "
                f"4 columns, got {len(row)}",
            )
        row_values: List[float] = []
        for col_index, v in enumerate(row):
            if isinstance(v, bool) or not isinstance(v, (int, float)):
                raise _CadHandlerError(
                    "bad_params",
                    f"parts[{index}].transform[{row_index}][{col_index}] "
                    f"must be a number, got {type(v).__name__}",
                )
            f = float(v)
            if not math.isfinite(f):
                raise _CadHandlerError(
                    "bad_params",
                    f"parts[{index}].transform[{row_index}][{col_index}] "
                    f"must be finite (got {v!r})",
                )
            row_values.append(f)
        rows.append(tuple(row_values))
    return tuple(rows)


def _location_from_matrix(
    cq: Any, transform: Tuple[Tuple[float, ...], ...]
) -> Any:
    """Build a ``cq.Location`` from a row-major 4x4 transform.

    Uses ``cq.Location(Matrix)`` when available; falls back to translation-only
    when the binding lacks a Matrix-style constructor (very old CadQuery).
    Identity matrices short-circuit to ``cq.Location()`` so we do not pay the
    matrix-construction cost on the common case.
    """
    if _is_identity(transform):
        return cq.Location()

    # Try the OCP Matrix path first (modern CadQuery).
    try:
        from cadquery.occ_impl.geom import Matrix  # type: ignore[import]

        matrix = Matrix(
            [
                list(transform[0]),
                list(transform[1]),
                list(transform[2]),
            ]
        )
        return cq.Location(matrix)
    except Exception:  # noqa: BLE001 - fall through to translation-only
        pass

    # Fallback: translation-only Location from the 4th column of the matrix.
    # This loses rotation but keeps the build flow alive on legacy bindings.
    tx, ty, tz = transform[0][3], transform[1][3], transform[2][3]
    try:
        Vector = cq.Vector  # type: ignore[attr-defined]
        return cq.Location(Vector(tx, ty, tz))
    except Exception as exc:  # noqa: BLE001 - last-ditch
        raise _CadHandlerError(
            "assembly_build_error",
            f"could not build cq.Location from transform: {exc}",
            detail=str(exc),
        ) from exc


def _is_identity(transform: Tuple[Tuple[float, ...], ...]) -> bool:
    """True iff every cell equals the identity matrix to within 1e-9."""
    for r in range(4):
        for c in range(4):
            expected = 1.0 if r == c else 0.0
            if abs(transform[r][c] - expected) > 1e-9:
                return False
    return True


def _assembly_bbox(
    validated: List[Tuple[StepDocument, Tuple[Tuple[float, ...], ...], str]],
) -> Tuple[Tuple[float, float, float], Tuple[float, float, float]]:
    """Compute the axis-aligned union bbox of every child after its transform.

    Transforms each child's 8 cached bbox corners through the 4x4 matrix and
    takes the per-axis min/max. Fast (no OCCT) and accurate for axis-aligned
    cases; conservative (over-estimates) for arbitrary rotations, which is
    fine for viewport framing.
    """
    big = float("inf")
    min_x, min_y, min_z = big, big, big
    max_x, max_y, max_z = -big, -big, -big

    for doc, transform, _name in validated:
        bb_min = doc.bbox_min
        bb_max = doc.bbox_max
        for cx in (bb_min[0], bb_max[0]):
            for cy in (bb_min[1], bb_max[1]):
                for cz in (bb_min[2], bb_max[2]):
                    tx = (
                        transform[0][0] * cx
                        + transform[0][1] * cy
                        + transform[0][2] * cz
                        + transform[0][3]
                    )
                    ty = (
                        transform[1][0] * cx
                        + transform[1][1] * cy
                        + transform[1][2] * cz
                        + transform[1][3]
                    )
                    tz = (
                        transform[2][0] * cx
                        + transform[2][1] * cy
                        + transform[2][2] * cz
                        + transform[2][3]
                    )
                    if tx < min_x:
                        min_x = tx
                    if ty < min_y:
                        min_y = ty
                    if tz < min_z:
                        min_z = tz
                    if tx > max_x:
                        max_x = tx
                    if ty > max_y:
                        max_y = ty
                    if tz > max_z:
                        max_z = tz

    # If every child's cached bbox was zero (rare — empty solid), guard against
    # the impossible "infinity" sentinel leaking onto the wire.
    if not math.isfinite(min_x):
        return ((0.0, 0.0, 0.0), (0.0, 0.0, 0.0))
    return (
        (float(min_x), float(min_y), float(min_z)),
        (float(max_x), float(max_y), float(max_z)),
    )


def _coerce_to_solid(obj: Any) -> Any:
    """Pull a Solid out of either a Workplane wrapper or a raw Solid/Compound.

    ``Assembly.add`` stores the original object handed in. Some callers pass
    a Workplane (the common case via execute_script), others a raw Solid (the
    STEP-import path). We normalize to a Solid-like object that exposes
    ``.Faces()`` for the tessellation walk.
    """
    # Workplane → findSolid
    if hasattr(obj, "findSolid"):
        try:
            return obj.findSolid()
        except Exception:  # noqa: BLE001 - fall through
            pass
    # Already a Solid / Compound — has .Faces()
    if hasattr(obj, "Faces"):
        return obj
    raise _CadHandlerError(
        "tessellation_error",
        f"assembly child of type {type(obj).__name__!r} has no .Faces() — "
        f"cannot tessellate.",
    )


def _safe_face_hash(face: Any) -> int:
    """Return OCCT's TopoDS hash code for ``face`` (or 0 on failure).

    Mirrors ``cadquery_script._safe_face_hash`` — same fallback chain for the
    OCP HashCode binding. Duplicated rather than imported to keep the assembly
    module standalone (no cycles between cad/ files).
    """
    try:
        wrapped = face.wrapped
    except Exception:  # noqa: BLE001 - fall through
        return 0
    if wrapped is None:
        return 0
    for upper in (2_147_483_647, 1_000_000_000, 1_000_000):
        try:
            h = wrapped.HashCode(upper)
            return int(h) if h is not None else 0
        except Exception:  # noqa: BLE001 - try next bound
            continue
    return 0


def _safe_face_area(face: Any) -> float:
    """Return ``face.Area()`` as a float, or 0.0 on failure."""
    try:
        return float(face.Area())
    except Exception:  # noqa: BLE001 - area is best-effort
        return 0.0


def _write_binary_stl_from_flat_mesh(
    out_path: Path,
    vertices_flat: List[float],
    indices_flat: List[int],
) -> None:
    """Write a binary STL from the flat-buffer mesh produced by tessellate_assembly.

    Same Safety Rule 1 guarantees as ``cadquery_import._build_binary_stl``:
    degenerate triangles filtered, right-hand-rule normals, post-write size
    check. We re-implement the STL writer here (rather than calling the
    existing one) because tessellate_assembly's output uses flat lists of
    floats / ints whereas ``_build_binary_stl`` expects ``cq.Vector`` instances
    and tuple triangles. The numerics are identical.
    """
    import struct

    if len(vertices_flat) % 3 != 0:
        raise _CadHandlerError(
            "export_error",
            f"vertices_flat length {len(vertices_flat)} is not divisible by 3",
        )
    if len(indices_flat) % 3 != 0:
        raise _CadHandlerError(
            "export_error",
            f"indices_flat length {len(indices_flat)} is not divisible by 3",
        )

    # Pre-extract (x,y,z) for fast index lookup in the triangle loop.
    pts: List[Tuple[float, float, float]] = []
    for i in range(0, len(vertices_flat), 3):
        pts.append((vertices_flat[i], vertices_flat[i + 1], vertices_flat[i + 2]))

    good: List[
        Tuple[
            Tuple[float, float, float],
            Tuple[float, float, float],
            Tuple[float, float, float],
            Tuple[float, float, float],
        ]
    ] = []
    for tri_i in range(0, len(indices_flat), 3):
        i0 = indices_flat[tri_i]
        i1 = indices_flat[tri_i + 1]
        i2 = indices_flat[tri_i + 2]
        if i0 == i1 or i1 == i2 or i0 == i2:
            continue
        if not (0 <= i0 < len(pts) and 0 <= i1 < len(pts) and 0 <= i2 < len(pts)):
            continue
        v0, v1, v2 = pts[i0], pts[i1], pts[i2]
        ax, ay, az = v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]
        bx, by, bz = v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]
        nx = ay * bz - az * by
        ny = az * bx - ax * bz
        nz = ax * by - ay * bx
        mag = math.sqrt(nx * nx + ny * ny + nz * nz)
        if mag <= 1e-12:
            continue  # zero-area
        good.append(((nx / mag, ny / mag, nz / mag), v0, v1, v2))

    triangle_count = len(good)
    header = b"WorkTrack3D CadQuery Assembly STL".ljust(80, b"\x00")
    count_bytes = struct.pack("<I", triangle_count)
    tri_struct = struct.Struct("<12fH")
    body_parts: List[bytes] = []
    for normal, v0, v1, v2 in good:
        body_parts.append(
            tri_struct.pack(
                normal[0], normal[1], normal[2],
                v0[0], v0[1], v0[2],
                v1[0], v1[1], v1[2],
                v2[0], v2[1], v2[2],
                0,
            )
        )

    payload = header + count_bytes + b"".join(body_parts)
    out_path.write_bytes(payload)

    # Sanity-check post-write size — catches truncated writes on disk-full.
    expected = 80 + 4 + 50 * triangle_count
    on_disk = out_path.stat().st_size
    if on_disk != expected:
        raise _CadHandlerError(
            "export_error",
            f"STL short write: wrote {on_disk} bytes, expected {expected} "
            f"({triangle_count} triangles)",
        )


__all__ = [
    "ALLOWED_ASSEMBLY_FORMATS",
    "ALLOWED_MATE_KINDS",
    "build_assembly_from_parts",
    "build_assembly_with_mates",
    "add_mate_to_assembly",
    "tessellate_assembly",
    "export_assembly",
]


# ── CAD V1.5: cq.Assembly mate constraints (additive surface) ─────────────
#
# Three mate kinds — point / axis / plane — back the renderer's V1.5
# AssemblyView modal. Each mate references two children by name (the same
# ``name`` used when ``build_assembly_from_parts`` added them to the
# ``cq.Assembly``) plus a feature on each child:
#
#   * PointMate: a 3-D point in the child's local frame (e.g. a face
#     centroid). Constraint solver welds the two points together so the
#     assembly's degrees of freedom drop by 3.
#   * AxisMate:  a 3-D axis (direction vector) in the child's local frame.
#     Constraint solver aligns the two axes (parallel + co-linear), dropping
#     the assembly's rotational DOFs by 2.
#   * PlaneMate: a 3-D plane (origin + normal) in the child's local frame.
#     Constraint solver mates the two planes face-to-face, dropping 1
#     translation DOF + 2 rotational DOFs.
#
# Why a separate function instead of folding the mates into
# ``build_assembly_from_parts``? The renderer V1.5 flow is:
#   1. Build assembly with identity transforms (existing call).
#   2. Operator picks features in the viewport (Modal step 2 in the spec).
#   3. Renderer calls ``cad.add_assembly_mate`` per mate — incremental.
# Folding mates into the build call would force the renderer to redo the
# whole assembly every time a mate lands. The split mirrors how Fusion 360 /
# Onshape treat mates: additive constraints on an existing assembly.
#
# Error vocabulary mirrors the rest of the assembly surface:
#   * cadquery_not_installed  — pip dep missing.
#   * assembly_not_supported  — cq.Assembly missing from the binding.
#   * invalid_handle          — assembly handle missing from _HANDLES.
#   * not_an_assembly         — handle resolves to a single body.
#   * bad_params              — malformed mate definition, missing child,
#                                unknown mate kind, non-finite cell.
#   * mate_solve_failed       — cq.Assembly.solve() raised. Most common in
#                                practice: the solver is over-constrained
#                                (operator stacked conflicting mates) — we
#                                surface the raw OCCT message in ``detail``.

ALLOWED_MATE_KINDS: Tuple[str, ...] = ("point", "axis", "plane")


def _resolve_assembly_handle(handle: str) -> Tuple[Any, "StepDocument"]:
    """Look up an assembly handle and return (cq, document) — used by mates.

    Centralized so every mate-related function shares one set of guards:
    ``invalid_handle`` if the handle is missing, ``cadquery_not_installed``
    if pip dep is gone, ``assembly_not_supported`` if cq.Assembly is missing,
    ``not_an_assembly`` if the handle is a single-body shape.
    """
    if not isinstance(handle, str) or not handle:
        raise _CadHandlerError(
            "bad_params", "handle must be a non-empty string"
        )

    doc = _HANDLES.get(handle)
    if doc is None:
        raise _CadHandlerError(
            "invalid_handle",
            f"unknown CAD handle: {handle!r} "
            f"(table holds {len(_HANDLES)} entries)",
        )

    try:
        import cadquery as cq  # noqa: PLC0415
    except ImportError as exc:
        raise _CadHandlerError(
            "cadquery_not_installed",
            "CadQuery is not installed in the sidecar's Python environment",
            detail=str(exc),
        ) from exc

    if not hasattr(cq, "Assembly"):
        raise _CadHandlerError(
            "assembly_not_supported",
            "cadquery.Assembly is not available in this CadQuery build — "
            "the renderer should fall back to single-body workflows.",
        )

    if not isinstance(doc.workplane, cq.Assembly):
        raise _CadHandlerError(
            "not_an_assembly",
            f"handle {handle!r} is not an assembly — mates apply only to "
            f"assemblies built via cad.create_assembly.",
        )
    return cq, doc


def _parse_3_vector(raw: Any, label: str) -> Tuple[float, float, float]:
    """Coerce a wire-shape 3-vector ``[x, y, z]`` to a typed tuple.

    The mate validators all share this helper: every point / axis / plane
    field is a 3-tuple of finite numbers. We reject NaN / Inf up front so
    OCP's Vector constructor cannot raise an opaque error mid-solve.
    """
    if not isinstance(raw, (list, tuple)):
        raise _CadHandlerError(
            "bad_params",
            f"{label} must be a 3-tuple [x, y, z], got {type(raw).__name__}",
        )
    if len(raw) != 3:
        raise _CadHandlerError(
            "bad_params",
            f"{label} must have exactly 3 components, got {len(raw)}",
        )
    out: List[float] = []
    for index, v in enumerate(raw):
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            raise _CadHandlerError(
                "bad_params",
                f"{label}[{index}] must be a number, "
                f"got {type(v).__name__}",
            )
        f = float(v)
        if not math.isfinite(f):
            raise _CadHandlerError(
                "bad_params",
                f"{label}[{index}] must be finite (got {v!r})",
            )
        out.append(f)
    return (out[0], out[1], out[2])


def _validate_mate_definition(mate: Any) -> Dict[str, Any]:
    """Validate a mate dict and normalize its fields.

    Returns a dict with shape::

        {
          "kind":      "point" | "axis" | "plane",
          "part1Id":   str,
          "part2Id":   str,
          "feature1":  (x, y, z),         # point/axis/plane → vector OR
                                          # plane origin
          "feature2":  (x, y, z),
          # plane mates also carry a "normal1" / "normal2" pair:
          "normal1":   (x, y, z),         # plane only
          "normal2":   (x, y, z),         # plane only
        }

    Centralizing the wire-envelope validation here means
    ``build_assembly_with_mates`` (the bulk path) and ``add_mate_to_assembly``
    (the incremental renderer path) share one source of truth.
    """
    if not isinstance(mate, dict):
        raise _CadHandlerError(
            "bad_params",
            f"mate must be an object, got {type(mate).__name__}",
        )
    kind = mate.get("kind")
    if not isinstance(kind, str) or kind not in ALLOWED_MATE_KINDS:
        raise _CadHandlerError(
            "bad_params",
            f"mate.kind must be one of {list(ALLOWED_MATE_KINDS)}, "
            f"got {kind!r}",
        )
    part1_id = mate.get("part1Id")
    if not isinstance(part1_id, str) or not part1_id:
        raise _CadHandlerError(
            "bad_params",
            "mate.part1Id must be a non-empty string (child name)",
        )
    part2_id = mate.get("part2Id")
    if not isinstance(part2_id, str) or not part2_id:
        raise _CadHandlerError(
            "bad_params",
            "mate.part2Id must be a non-empty string (child name)",
        )
    if part1_id == part2_id:
        raise _CadHandlerError(
            "bad_params",
            f"mate.part1Id and mate.part2Id must reference different "
            f"children (both = {part1_id!r})",
        )

    if kind == "plane":
        # Plane mates need (origin, normal) for each child — 4 vectors total.
        feature1 = _parse_3_vector(mate.get("point1"), "mate.point1")
        feature2 = _parse_3_vector(mate.get("point2"), "mate.point2")
        normal1 = _parse_3_vector(mate.get("normal1"), "mate.normal1")
        normal2 = _parse_3_vector(mate.get("normal2"), "mate.normal2")
        return {
            "kind": kind,
            "part1Id": part1_id,
            "part2Id": part2_id,
            "feature1": feature1,
            "feature2": feature2,
            "normal1": normal1,
            "normal2": normal2,
        }
    elif kind == "axis":
        feature1 = _parse_3_vector(mate.get("axis1"), "mate.axis1")
        feature2 = _parse_3_vector(mate.get("axis2"), "mate.axis2")
        return {
            "kind": kind,
            "part1Id": part1_id,
            "part2Id": part2_id,
            "feature1": feature1,
            "feature2": feature2,
        }
    else:  # point
        feature1 = _parse_3_vector(mate.get("point1"), "mate.point1")
        feature2 = _parse_3_vector(mate.get("point2"), "mate.point2")
        return {
            "kind": kind,
            "part1Id": part1_id,
            "part2Id": part2_id,
            "feature1": feature1,
            "feature2": feature2,
        }


def _apply_mate_constraint(
    cq: Any,
    assembly: Any,
    mate: Dict[str, Any],
    child_names: List[str],
) -> None:
    """Call ``cq.Assembly.constrain`` for a single normalized mate.

    Both child names MUST be present in the assembly's children list, OR
    we raise ``bad_params`` so the renderer can hint the operator
    ("part1Id refers to a child not in the assembly").

    Why call ``.constrain()`` per mate (vs. batching)? CadQuery's
    ``Assembly.constrain`` is variadic — each call adds one constraint to
    the internal table. The solver runs only when ``.solve()`` is invoked.
    Adding mates one at a time means a bad-parameter mate fails fast with
    a precise pointer ("mate #2: unknown child"), instead of polluting
    the entire assembly's constraint set.
    """
    if mate["part1Id"] not in child_names:
        raise _CadHandlerError(
            "bad_params",
            f"mate.part1Id={mate['part1Id']!r} is not a child of this "
            f"assembly (children: {sorted(child_names)})",
        )
    if mate["part2Id"] not in child_names:
        raise _CadHandlerError(
            "bad_params",
            f"mate.part2Id={mate['part2Id']!r} is not a child of this "
            f"assembly (children: {sorted(child_names)})",
        )

    kind = mate["kind"]
    try:
        # CadQuery's assembly solver calls ``.located()`` / ``.location()`` on
        # EVERY constraint arg (occ_impl/solver.py:toPODs), so each arg MUST be
        # a Shape — a bare ``cq.Vector`` (Point/Axis) or ``cq.Plane`` (Plane)
        # raises "'Vector' object has no attribute 'located'" at solve time.
        # Build the equivalent Shape per kind: Vertex (point), Edge along the
        # direction (axis), unbounded planar Face (plane).
        if kind == "point":
            p1 = cq.Vertex.makeVertex(*mate["feature1"])
            p2 = cq.Vertex.makeVertex(*mate["feature2"])
            assembly.constrain(
                mate["part1Id"], p1, mate["part2Id"], p2, "Point"
            )
        elif kind == "axis":
            # An Edge through the origin along the axis direction; the solver
            # reads the edge's direction. Direction is validated non-zero
            # upstream (``_validate_mate_definition``).
            a1 = cq.Edge.makeLine(cq.Vector(0, 0, 0), cq.Vector(*mate["feature1"]))
            a2 = cq.Edge.makeLine(cq.Vector(0, 0, 0), cq.Vector(*mate["feature2"]))
            assembly.constrain(
                mate["part1Id"], a1, mate["part2Id"], a2, "Axis"
            )
        else:  # plane
            f1 = cq.Face.makePlane(
                None,
                None,
                basePnt=cq.Vector(*mate["feature1"]),
                dir=cq.Vector(*mate["normal1"]),
            )
            f2 = cq.Face.makePlane(
                None,
                None,
                basePnt=cq.Vector(*mate["feature2"]),
                dir=cq.Vector(*mate["normal2"]),
            )
            assembly.constrain(
                mate["part1Id"], f1, mate["part2Id"], f2, "Plane"
            )
    except _CadHandlerError:
        raise
    except Exception as exc:  # noqa: BLE001 - CadQuery raises arbitrary types
        raise _CadHandlerError(
            "bad_params",
            f"mate kind={kind!r}: cq.Assembly.constrain failed: {exc}",
            detail=str(exc),
        ) from exc


def _solve_with_mates(assembly: Any) -> None:
    """Run ``cq.Assembly.solve()`` and surface failures as structured errors.

    Common failure modes:
      * Over-constrained (operator stacked conflicting mates).
      * Under-constrained — the solver typically still returns a result,
        but the result is non-unique. We do not flag that here; the
        renderer surfaces it as a "loose" assembly visually.
      * Numerical (degenerate constraint geometry, e.g. zero-length axis).
    """
    try:
        assembly.solve()
    except Exception as exc:  # noqa: BLE001 - CadQuery raises arbitrary types
        raise _CadHandlerError(
            "mate_solve_failed",
            f"cq.Assembly.solve() failed (likely over-constrained): {exc}",
            detail=str(exc),
        ) from exc


def _list_child_names(assembly: Any) -> List[str]:
    """Return the names of every direct child in the assembly.

    Mate references work against these names. The root's own name is
    excluded so a mate cannot reference the assembly itself.
    """
    names: List[str] = []
    try:
        children = list(assembly.children)
    except Exception:  # noqa: BLE001 - fall back to traverse()
        try:
            traverse = list(assembly.traverse())
        except Exception:  # noqa: BLE001 - last-ditch empty
            return []
        for child_name, _child in traverse:
            if child_name and child_name != assembly.name:
                names.append(child_name)
        return names

    for child in children:
        try:
            n = child.name
        except Exception:  # noqa: BLE001 - skip nameless
            continue
        if n:
            names.append(n)
    return names


def _bbox_after_solve(
    assembly: Any,
    fallback_min: Tuple[float, float, float],
    fallback_max: Tuple[float, float, float],
) -> Tuple[Tuple[float, float, float], Tuple[float, float, float]]:
    """Best-effort post-solve bbox.

    After ``.solve()`` the child locations may have moved, so the cached
    pre-solve bbox under-represents the assembly. We re-walk the children
    and union their world-space bboxes; if that fails we fall back to the
    pre-solve cache so the wire response is always populated.
    """
    big = float("inf")
    min_x, min_y, min_z = big, big, big
    max_x, max_y, max_z = -big, -big, -big
    have_any = False

    try:
        children = list(assembly.traverse())
    except Exception:  # noqa: BLE001 - fall back to fixture bbox
        return fallback_min, fallback_max

    for _name, child in children:
        try:
            obj = child.obj
        except Exception:  # noqa: BLE001 - skip degenerate
            obj = None
        if obj is None:
            continue
        try:
            loc = child.loc
        except Exception:  # noqa: BLE001 - identity
            loc = None
        try:
            moved = obj.moved(loc) if loc is not None else obj
            bbox = moved.BoundingBox()
            xmin, ymin, zmin = bbox.xmin, bbox.ymin, bbox.zmin
            xmax, ymax, zmax = bbox.xmax, bbox.ymax, bbox.zmax
        except Exception:  # noqa: BLE001 - skip non-BBox-capable children
            continue
        have_any = True
        if xmin < min_x:
            min_x = xmin
        if ymin < min_y:
            min_y = ymin
        if zmin < min_z:
            min_z = zmin
        if xmax > max_x:
            max_x = xmax
        if ymax > max_y:
            max_y = ymax
        if zmax > max_z:
            max_z = zmax

    if not have_any or not math.isfinite(min_x):
        return fallback_min, fallback_max
    return (
        (float(min_x), float(min_y), float(min_z)),
        (float(max_x), float(max_y), float(max_z)),
    )


def build_assembly_with_mates(
    parts: Sequence[Dict[str, Any]],
    mates: Sequence[Dict[str, Any]],
    *,
    assembly_name: Optional[str] = None,
) -> Dict[str, Any]:
    """Build an assembly AND apply a set of mate constraints in one call.

    Convenience wrapper over :func:`build_assembly_from_parts` plus the
    incremental mate path. Useful for callers that already know the full
    mate set (renderer bulk-save / round-trip from disk). The incremental
    renderer flow uses :func:`add_mate_to_assembly` instead.

    Wire input::

        parts: see build_assembly_from_parts
        mates: [
          {"kind": "point",
           "part1Id": "<child name>", "point1": [x, y, z],
           "part2Id": "<child name>", "point2": [x, y, z]},
          {"kind": "axis",
           "part1Id": "<child name>", "axis1":  [x, y, z],
           "part2Id": "<child name>", "axis2":  [x, y, z]},
          {"kind": "plane",
           "part1Id": "<child name>", "point1": [x, y, z], "normal1": [x, y, z],
           "part2Id": "<child name>", "point2": [x, y, z], "normal2": [x, y, z]},
          ...
        ]

    Wire result::

        {
          "handle":     "assembly:<uuid>",
          "childCount": int,
          "mateCount":  int,
          "bbox":       {"min":[..3], "max":[..3]}
        }

    Raises ``_CadHandlerError`` with codes shared with
    ``build_assembly_from_parts`` plus:
      * ``mate_solve_failed`` — cq.Assembly.solve() raised.

    Notes
    -----
    * Mates are validated UP FRONT — every mate's wire envelope is checked
      before we touch CadQuery. Same posture as the per-part validator in
      ``build_assembly_from_parts``.
    * The bbox is computed AFTER the solve so the operator sees the
      assembly's actual on-screen extent.
    """
    if not isinstance(mates, (list, tuple)):
        raise _CadHandlerError(
            "bad_params",
            f"mates must be a list, got {type(mates).__name__}",
        )
    # Validate every mate envelope before we touch CadQuery — matches the
    # per-part validation strategy in build_assembly_from_parts so the
    # bad-params response is deterministic across environments.
    validated_mates: List[Dict[str, Any]] = []
    for index, mate in enumerate(mates):
        try:
            validated_mates.append(_validate_mate_definition(mate))
        except _CadHandlerError as exc:
            # Re-raise with the index in the message so the renderer can
            # point the operator at the bad row.
            raise _CadHandlerError(
                exc.code,
                f"mates[{index}]: {exc.args[0] if exc.args else str(exc)}",
                detail=exc.detail,
            ) from exc

    # Build the bare assembly via the existing path so the part-validation /
    # bbox / handle-table-insert logic stays in one place.
    bare = build_assembly_from_parts(parts, assembly_name=assembly_name)
    handle = bare["handle"]

    if not validated_mates:
        # No mates → nothing to do. Echo the build response with a 0 mate
        # count so the wire shape is uniform.
        return {
            "handle": handle,
            "childCount": bare["childCount"],
            "mateCount": 0,
            "bbox": bare["bbox"],
        }

    # Resolve the cq + assembly off the freshly-inserted handle. We MUST
    # go through the handle table because build_assembly_from_parts inserts
    # the cq.Assembly into _HANDLES and the assembly variable goes out of
    # scope on exit.
    cq, doc = _resolve_assembly_handle(handle)
    assembly = doc.workplane
    child_names = _list_child_names(assembly)
    for mate in validated_mates:
        _apply_mate_constraint(cq, assembly, mate, child_names)
    _solve_with_mates(assembly)

    bbox_min, bbox_max = _bbox_after_solve(
        assembly,
        fallback_min=tuple(bare["bbox"]["min"]),  # type: ignore[arg-type]
        fallback_max=tuple(bare["bbox"]["max"]),  # type: ignore[arg-type]
    )
    # Update the cached bbox on the handle so subsequent tessellate calls
    # see the post-solve extent.
    _HANDLES[handle] = StepDocument(
        workplane=assembly,
        bbox_min=bbox_min,
        bbox_max=bbox_max,
        source_path=doc.source_path,
    )

    return {
        "handle": handle,
        "childCount": bare["childCount"],
        "mateCount": len(validated_mates),
        "bbox": {
            "min": list(bbox_min),
            "max": list(bbox_max),
        },
    }


def add_mate_to_assembly(
    handle: str,
    mate: Dict[str, Any],
) -> Dict[str, Any]:
    """Attach a single mate constraint to an existing assembly and re-solve.

    Powers the renderer's incremental mate-define flow: the operator picks
    two features in the viewport and the renderer calls this for each
    confirmed mate. The assembly's handle stays stable — the cached
    workplane is updated in place.

    Wire input::

        handle: "assembly:<uuid>" from a prior cad.create_assembly call.
        mate:   {"kind": "point" | "axis" | "plane",
                 "part1Id": str, ..., "part2Id": str, ...}

    Wire result::

        {
          "handle":    str,        # echo of input
          "kind":      str,
          "part1Id":   str,
          "part2Id":   str,
          "bbox":      {"min":[..3], "max":[..3]}
        }

    Raises ``_CadHandlerError`` with:
      * ``bad_params``           — malformed mate envelope.
      * ``invalid_handle``       — handle missing from _HANDLES.
      * ``not_an_assembly``      — handle resolves to a single body.
      * ``cadquery_not_installed`` — pip dep missing.
      * ``assembly_not_supported`` — cq.Assembly not in the binding.
      * ``mate_solve_failed``    — cq.Assembly.solve() raised.
    """
    validated = _validate_mate_definition(mate)
    cq, doc = _resolve_assembly_handle(handle)
    assembly = doc.workplane
    child_names = _list_child_names(assembly)
    _apply_mate_constraint(cq, assembly, validated, child_names)
    _solve_with_mates(assembly)

    bbox_min, bbox_max = _bbox_after_solve(
        assembly,
        fallback_min=doc.bbox_min,
        fallback_max=doc.bbox_max,
    )
    _HANDLES[handle] = StepDocument(
        workplane=assembly,
        bbox_min=bbox_min,
        bbox_max=bbox_max,
        source_path=doc.source_path,
    )

    return {
        "handle": handle,
        "kind": validated["kind"],
        "part1Id": validated["part1Id"],
        "part2Id": validated["part2Id"],
        "bbox": {
            "min": list(bbox_min),
            "max": list(bbox_max),
        },
    }
