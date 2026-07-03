"""CadQuery-backed CAD handlers for the WorkTrack3D sidecar.

End-to-end CadQuery dispatcher. Reuses the shared core in
``engines/cad/cadquery_import.py`` so the import/tessellate numerics live in
one place and the sidecar handler stays thin (param validation + envelope
mapping).

Wire contract (kept in lock-step with ``src/shared/sidecar-protocol.ts``)
-------------------------------------------------------------------------
Method: ``cad.import_step``

Params::

    {"path": str}  # absolute path to a .step / .stp file

Success result::

    {
      "handle": str,                # opaque handle for cad.tessellate
      "bbox": {                     # axis-aligned bbox of the imported solid
        "min": [float, float, float],
        "max": [float, float, float]
      }
    }

Method: ``cad.tessellate``

Params::

    {
      "handle":      str,          # from cad.import_step
      "outPath":     str,          # absolute path for the output STL
      "toleranceMm": float (> 0)   # surface deviation tolerance
    }

Success result::

    {
      "stlPath":       str,        # echo of outPath (now exists on disk)
      "triangleCount": int         # number of triangles in the STL
    }

Safety Rule 1 — G-code is sacred
================================
This handler does NOT emit G-code. It DOES emit STL that flows into
``cam.run_toolpath`` (OpenCAMLib drop / waterline). A malformed STL would
crash or silently corrupt downstream toolpaths, so the shared core in
``engines/cad/cadquery_import.py`` guarantees:

  * Binary STL format (80-byte header + uint32 count + 50-byte triangles).
  * Zero-area degenerate triangles filtered before write.
  * Right-hand-rule normals (outward-facing for a manifold solid imported
    from STEP).
  * Post-write size check vs. expected ``80 + 4 + 50*N`` bytes — catches
    truncated writes on disk-full.

Error vocabulary (TS bridge maps these to operator-facing hints)
================================================================
  * ``cadquery_not_installed``  — pip dependency missing; renderer can fall
    back to the legacy ``engines/occt/step_to_stl.py`` subprocess path.
  * ``step_file_missing``       — caller's path does not exist.
  * ``step_read_error``         — CadQuery raised during import (malformed
    STEP, unsupported entity, …).
  * ``invalid_handle``          — caller's handle is not in the table
    (sidecar restarted? Renderer should re-import).
  * ``tessellation_error``      — CadQuery raised during tessellate.
  * ``stl_write_error``         — disk write failed or short write.
  * ``bad_params`` / ``invalid_numeric_params`` — param validation failures.
"""
from __future__ import annotations

import math
from pathlib import Path
from typing import Any, Callable

# Shared CadQuery core lives under engines/cad/ — make it importable
# regardless of how the sidecar is launched (``python -m engines.sidecar.main``
# vs. a frozen build).
try:
    from engines.cad.cadquery_import import (
        _CadHandlerError,
        import_step_file,
        tessellate_body,
    )
    from engines.cad.cadquery_hlr import (
        hlr_section as _hlr_section_core,
    )
    from engines.cad.cadquery_script import (
        execute_script as _execute_script_core,
        export_by_handle as _export_by_handle_core,
        list_operations as _list_operations_core,
        tessellate_with_face_ids as _tessellate_with_face_ids_core,
    )
    from engines.cad.cadquery_drawing import (
        ALLOWED_VIEWS as _ALLOWED_DRAWING_VIEWS,
        export_drawing as _export_drawing_core,
        project_to_drawing as _project_to_drawing_core,
    )
    # CAD V1.5 — additive drawing helpers (drawing dimensions / sections /
    # title block). Imported next to the existing drawing core so the
    # import-fallback branch covers both. Names prefixed with ``_v15_`` so
    # this block stays diff-isolated from the BUILD-3 drawing core above.
    from engines.cad.cadquery_drawing import (
        ALLOWED_DIMENSION_KINDS as _V15_ALLOWED_DIMENSION_KINDS,
        ALLOWED_SECTION_AXES as _V15_ALLOWED_SECTION_AXES,
        TITLE_BLOCK_FIELDS as _V15_TITLE_BLOCK_FIELDS,
        attach_title_block as _v15_attach_title_block_core,
        dimension_drawing as _v15_dimension_drawing_core,
        section_drawing as _v15_section_drawing_core,
        detail_drawing as _v15d_detail_drawing_core,
    )
    # CAD V1.5 — BOM-table stamp (associative-dimension BOM surface). Prefixed
    # ``_v15b_`` so this block stays diff-isolated from the BUILD-7 surface above.
    from engines.cad.cadquery_drawing import (
        drawing_bom_table as _v15b_drawing_bom_table_core,
    )
    # CAD V1.5 — GD&T feature-control-frame stamp. Prefixed ``_v15g_`` so this
    # block stays diff-isolated from the BOM surface above. Operates on an
    # existing SVG (no handle table), like ``drawing_bom_table``.
    from engines.cad.cadquery_drawing import (
        annotate_gdt as _v15g_annotate_gdt_core,
    )
    # CAD V2 — projected 2D drawing geometry with quantized-hash stable ids and
    # the SVG from the SAME projection (so geometry + SVG never disagree on
    # origin / scale). Lives in its own module ``cadquery_drawing_geometry`` and
    # supersedes the earlier naive-projection helper.
    from engines.cad.cadquery_drawing_geometry import (
        extract_drawing_geometry as _extract_drawing_geometry_core,
    )
    from engines.cad.cadquery_assembly import (
        ALLOWED_ASSEMBLY_FORMATS as _ALLOWED_ASSEMBLY_FORMATS,
        ALLOWED_MATE_KINDS as _ALLOWED_MATE_KINDS,
        add_mate_to_assembly as _add_mate_core,
        build_assembly_from_parts as _build_assembly_core,
        export_assembly as _export_assembly_core,
        tessellate_assembly as _tessellate_assembly_core,
    )
    from engines.cad.sketch_solver import (
        solve_sketch_payload as _solve_sketch_payload_core,
    )
except ImportError:  # pragma: no cover - frozen-app import path
    import sys

    _here = Path(__file__).resolve().parent
    _engines_root = _here.parent
    sys.path.insert(0, str(_engines_root))
    from cad.cadquery_import import (  # type: ignore[no-redef]
        _CadHandlerError,
        import_step_file,
        tessellate_body,
    )
    from cad.cadquery_hlr import (  # type: ignore[no-redef]
        hlr_section as _hlr_section_core,
    )
    from cad.cadquery_script import (  # type: ignore[no-redef]
        execute_script as _execute_script_core,
        export_by_handle as _export_by_handle_core,
        list_operations as _list_operations_core,
        tessellate_with_face_ids as _tessellate_with_face_ids_core,
    )
    from cad.cadquery_drawing import (  # type: ignore[no-redef]
        ALLOWED_VIEWS as _ALLOWED_DRAWING_VIEWS,
        export_drawing as _export_drawing_core,
        project_to_drawing as _project_to_drawing_core,
    )
    # CAD V1.5 — frozen-app fallback for the additive drawing helpers.
    from cad.cadquery_drawing import (  # type: ignore[no-redef]
        ALLOWED_DIMENSION_KINDS as _V15_ALLOWED_DIMENSION_KINDS,
        ALLOWED_SECTION_AXES as _V15_ALLOWED_SECTION_AXES,
        TITLE_BLOCK_FIELDS as _V15_TITLE_BLOCK_FIELDS,
        attach_title_block as _v15_attach_title_block_core,
        dimension_drawing as _v15_dimension_drawing_core,
        section_drawing as _v15_section_drawing_core,
        detail_drawing as _v15d_detail_drawing_core,
    )
    # CAD V1.5 — frozen-app fallback for the BOM-table helper.
    from cad.cadquery_drawing import (  # type: ignore[no-redef]
        drawing_bom_table as _v15b_drawing_bom_table_core,
    )
    # CAD V1.5 — frozen-app fallback for the GD&T feature-control-frame helper.
    from cad.cadquery_drawing import (  # type: ignore[no-redef]
        annotate_gdt as _v15g_annotate_gdt_core,
    )
    # CAD V2 — frozen-app fallback for the projected-geometry module.
    from cad.cadquery_drawing_geometry import (  # type: ignore[no-redef]
        extract_drawing_geometry as _extract_drawing_geometry_core,
    )
    from cad.cadquery_assembly import (  # type: ignore[no-redef]
        ALLOWED_ASSEMBLY_FORMATS as _ALLOWED_ASSEMBLY_FORMATS,
        ALLOWED_MATE_KINDS as _ALLOWED_MATE_KINDS,
        add_mate_to_assembly as _add_mate_core,
        build_assembly_from_parts as _build_assembly_core,
        export_assembly as _export_assembly_core,
        tessellate_assembly as _tessellate_assembly_core,
    )
    from cad.sketch_solver import (  # type: ignore[no-redef]
        solve_sketch_payload as _solve_sketch_payload_core,
    )


HandlerFn = Callable[[dict[str, Any]], dict[str, Any]]

# Accept either capitalization of the STEP extension. We deliberately reject
# unrelated extensions so a renderer bug ("import this STL via cad.import_step")
# fails fast with bad_params instead of triggering a CadQuery read error.
ALLOWED_STEP_SUFFIXES = (".step", ".stp")


def _require_str(params: dict[str, Any], key: str) -> str:
    val = params.get(key)
    if not isinstance(val, str) or not val:
        raise _CadHandlerError(
            "bad_params", f"missing or empty string param: {key!r}"
        )
    return val


def _require_positive_float(params: dict[str, Any], key: str) -> float:
    val = params.get(key)
    if not isinstance(val, (int, float)) or isinstance(val, bool):
        raise _CadHandlerError(
            "invalid_numeric_params", f"param {key!r} must be a number"
        )
    f = float(val)
    if not math.isfinite(f) or f <= 0:
        raise _CadHandlerError(
            "invalid_numeric_params",
            f"param {key!r} must be a positive finite number",
        )
    return f


def import_step(params: dict[str, Any]) -> dict[str, Any]:
    """Import a STEP file via CadQuery and return a handle + bbox.

    See module docstring for the wire contract.
    """
    path = _require_str(params, "path")
    suffix = Path(path).suffix.lower()
    if suffix not in ALLOWED_STEP_SUFFIXES:
        raise _CadHandlerError(
            "bad_params",
            f"path must end in .step or .stp (got {suffix!r}): {path}",
        )

    handle, doc = import_step_file(path)
    return {
        "handle": handle,
        "bbox": {
            "min": list(doc.bbox_min),
            "max": list(doc.bbox_max),
        },
    }


def tessellate(params: dict[str, Any]) -> dict[str, Any]:
    """Tessellate a CadQuery shape handle to a binary STL file on disk.

    See module docstring for the wire contract.
    """
    handle = _require_str(params, "handle")
    out_path = _require_str(params, "outPath")
    tolerance = _require_positive_float(params, "toleranceMm")
    return tessellate_body(handle, out_path, tolerance)


# ── BUILD 1: parametric script handlers ──────────────────────────────────
#
# These power the Design workspace's script-driven workflow:
#
#   cad.execute_script   — run a user script, return tessellated meshes
#   cad.export           — run a user script, write STEP / STL / DXF to disk
#   cad.list_operations  — static AST parse for the read-only FeatureTree
#
# Numerics live in ``engines/cad/cadquery_script.py``. The thin wrappers below
# only validate the wire envelope and translate to the structured-error
# vocabulary documented at the top of the module.


# Multi-format export whitelist (Phase-3). Kept in lock-step with
# ``EXPORT_FORMATS`` in ``engines/cad/cadquery_script.py`` (the numeric core) and
# ``CAD_EXPORT_FORMATS`` in ``src/main/ipc-cad.ts`` (the IPC boundary). Every
# member is proven REAL against the bundled CadQuery build — nothing speculative.
#   * step / brep — B-rep solid (exact surfaces).
#   * stl         — binary mesh (degenerate-filtered writer, Safety Rule 1).
#   * 3mf / amf   — tessellated mesh container at ``toleranceMm``.
#   * dxf         — 2D projection.
ALLOWED_EXPORT_FORMATS = ("step", "stl", "dxf", "3mf", "amf", "brep")


def _optional_build_parameters(params: dict[str, Any]) -> dict[str, Any] | None:
    """Validate the optional ``buildParameters`` object on the wire.

    Returns ``None`` when absent. The cadquery_script core re-checks each
    name/value pair, but pulling it through a typed accessor here means a
    non-dict on the wire fails with ``bad_params`` before we touch CadQuery.
    """
    bp = params.get("buildParameters")
    if bp is None:
        return None
    if not isinstance(bp, dict):
        raise _CadHandlerError(
            "bad_params", "buildParameters must be an object when provided"
        )
    return bp


def execute_script(params: dict[str, Any]) -> dict[str, Any]:
    """Run a parametric CadQuery script and return tessellated meshes."""
    script = _require_str(params, "script")
    bp = _optional_build_parameters(params)
    return _execute_script_core(script, build_parameters=bp)


def export(params: dict[str, Any]) -> dict[str, Any]:
    """Export the body referenced by ``handle`` to any format in
    :data:`ALLOWED_EXPORT_FORMATS` (STEP / STL / DXF / 3MF / AMF / BREP).

    The handle must come from a prior ``cad.execute_script`` or
    ``cad.import_step`` call inside the same sidecar process — the
    in-memory handle table is process-local (see ``cadquery_import._HANDLES``).
    """
    handle = _require_str(params, "handle")
    out_path = _require_str(params, "outPath")
    fmt = _require_str(params, "format").lower()
    if fmt not in ALLOWED_EXPORT_FORMATS:
        raise _CadHandlerError(
            "bad_params",
            f"format must be one of {sorted(ALLOWED_EXPORT_FORMATS)}, "
            f"got {fmt!r}",
        )

    # Reject null-byte injection before delegating — mirrors the posture in
    # ``src/main/path-security.ts`` and prevents the cadquery_script core
    # from ever touching a malicious-looking path.
    if "\x00" in out_path:
        raise _CadHandlerError(
            "bad_params", "outPath must not contain null bytes"
        )

    tol_raw = params.get("toleranceMm", 0.1)
    if isinstance(tol_raw, (int, float)) and not isinstance(tol_raw, bool):
        tolerance = float(tol_raw)
        if not (tolerance > 0 and tolerance < math.inf):
            raise _CadHandlerError(
                "invalid_numeric_params",
                "toleranceMm must be a positive finite number when provided",
            )
    else:
        raise _CadHandlerError(
            "invalid_numeric_params",
            "toleranceMm must be a number when provided",
        )

    return _export_by_handle_core(
        handle,
        out_path,
        fmt,
        tolerance_mm=tolerance,
    )


def list_operations(params: dict[str, Any]) -> dict[str, Any]:
    """Static AST parse of a CadQuery script for the FeatureTree."""
    script = _require_str(params, "script")
    return _list_operations_core(script)


# ── BUILD 2: face-tagged tessellation (CAD V1 selection foundation) ──────
#
# ``cad.tessellate_with_ids`` returns a flat-buffer mesh PLUS a ``faceIds``
# parallel array (length == triangleCount) and a ``faceMap`` dict so the
# renderer can map mouse-ray hits to CadQuery faces. The body must already
# be in the handle table (from a prior ``cad.execute_script`` or
# ``cad.import_step``); the in-memory handle table is process-local.
#
# Wire result (kept in lock-step with ``src/shared/sidecar-protocol.ts``)::
#
#     {
#       "vertices":      [x0,y0,z0, x1,y1,z1, ...]   # flat float array
#       "indices":       [i0,i1,i2, i0,i1,i2, ...]   # flat int array
#       "faceIds":       [0, 0, 1, 1, ...]           # length == triangleCount
#       "triangleCount": int,
#       "bbox":          {"min":[..3], "max":[..3]},
#       "faceMap":       {"<id>": {"kind":"face", "occtHash":int, "area":float}},
#       "edgeMap":       {"<e-id>": {"kind":"edge", "occtId":str,
#                          "occtHash":int, "length":float}},   # keyed by stable id
#       "edges":         [{"id": "<e-id>", "points": [[x,y,z], ...]}, ...],
#       "edgesTruncated": bool   # honest flag: the defensive TOTAL point cap
#                                 # dropped whole polylines (edgeMap complete)
#     }


def tessellate_with_ids(params: dict[str, Any]) -> dict[str, Any]:
    """Build a face-tagged tessellation for a body already in the handle table.

    Toleranace defaults to 0.1 mm to match ``cad.execute_script`` so the
    triangle counts line up across the two calls for the same body. The
    handle MUST come from a prior ``cad.execute_script`` or
    ``cad.import_step``; restarting the sidecar invalidates handles.
    """
    handle = _require_str(params, "handle")

    # Optional toleranceMm; default matches execute_script's bake.
    tol_raw = params.get("toleranceMm", 0.1)
    if not isinstance(tol_raw, (int, float)) or isinstance(tol_raw, bool):
        raise _CadHandlerError(
            "invalid_numeric_params",
            "toleranceMm must be a number when provided",
        )
    tolerance = float(tol_raw)
    if not math.isfinite(tolerance) or tolerance <= 0:
        raise _CadHandlerError(
            "invalid_numeric_params",
            "toleranceMm must be a positive finite number",
        )

    return _tessellate_with_face_ids_core(handle, tolerance_mm=tolerance)


# ── BUILD 3 (Drawings — Wave 2 Workflow A2): 2D projection handlers ───────
#
# These thin wrappers expose ``engines/cad/cadquery_drawing.py`` over the
# JSON-RPC wire so the renderer's Drawings panel can fetch inline SVG for the
# 3D viewport's currently-loaded body. Two methods so the renderer can
# stream inline markup for live previews AND export to disk on operator
# click without invoking the projector twice over the wire.
#
#   cad.project_drawing   — returns the SVG string inline.
#   cad.export_drawing    — writes the SVG to disk.
#
# Wire result for ``cad.project_drawing``::
#
#     {"svg": str, "view": str, "bytes": int}
#
# Wire result for ``cad.export_drawing``::
#
#     {"outPath": str, "view": str, "bytesWritten": int}
#
# Errors mirror ``cad.export``'s vocabulary: ``bad_params`` for empty
# handle / unknown view / null-byte path; ``invalid_handle`` for missing
# handle; ``cadquery_not_installed`` for the pip dep; ``drawing_error`` for
# any CadQuery raise inside the projection; ``svg_write_error`` for the
# export-to-disk method only.
#
# Safety Rule 1: this path does NOT touch STL / G-code. The SVG is renderer-
# only; no downstream CAM logic ever consumes it.


def _require_view_param(params: dict[str, Any]) -> str:
    """Validate the ``view`` param against the allowed set.

    Pulled out so both ``project_drawing`` and ``export_drawing`` reject the
    same set of bad inputs with identical error messages — drift here would
    surface to the operator as inconsistent UX between "preview" and "export".
    """
    view = _require_str(params, "view")
    if view not in _ALLOWED_DRAWING_VIEWS:
        raise _CadHandlerError(
            "bad_params",
            f"view must be one of {sorted(_ALLOWED_DRAWING_VIEWS)}, "
            f"got {view!r}",
        )
    return view


def project_drawing(params: dict[str, Any]) -> dict[str, Any]:
    """Project a body handle into a 2D SVG drawing string (inline)."""
    handle = _require_str(params, "handle")
    view = _require_view_param(params)
    return _project_to_drawing_core(handle, view=view)


def export_drawing(params: dict[str, Any]) -> dict[str, Any]:
    """Project a body handle into a 2D SVG and write it to disk."""
    handle = _require_str(params, "handle")
    view = _require_view_param(params)
    out_path = _require_str(params, "outPath")
    # Reject null-byte injection BEFORE delegating — same posture as
    # ``cad.export``. Keeps a malicious-looking path from ever reaching the
    # drawing core's Path() construction.
    if "\x00" in out_path:
        raise _CadHandlerError(
            "bad_params", "outPath must not contain null bytes"
        )
    return _export_drawing_core(handle, view, out_path)


# ── BUILD 4 (Assemblies — Wave 2 Workflow A1): cq.Assembly handlers ───────
#
# Three thin wrappers expose ``engines/cad/cadquery_assembly.py`` over the
# JSON-RPC wire so the renderer's Assembly panel can compose multiple existing
# part handles (each already registered behind a ``script:`` / ``step:``
# handle from a prior call) into a single ``cq.Assembly``, then either render
# it (``tessellate_assembly``) or write it to disk (``export_assembly``).
#
# Wire results::
#
#     cad.create_assembly:
#       {"handle": "assembly:<uuid>",
#        "childCount": int,
#        "bbox": {"min":[..3], "max":[..3]}}
#
#     cad.tessellate_assembly:
#       {"vertices": [..],
#        "indices":  [..],
#        "faceIds":  [..],
#        "triangleCount": int,
#        "bbox": {"min":[..3], "max":[..3]},
#        "faceMap": {"<id>": {"kind":"face", "occtHash":int, "area":float,
#                              "childName":str}}}
#
#     cad.export_assembly:
#       {"outPath": str, "bytesWritten": int}
#
# Error vocabulary mirrors ``cad.export`` / ``cad.tessellate_with_ids``:
# ``bad_params`` (empty parts, null-byte path, unsupported format),
# ``invalid_handle`` (child or assembly handle missing), ``not_an_assembly``
# (caller passed a single-body handle to a tessellate_assembly / export_assembly
# method), ``cadquery_not_installed`` (pip dep missing),
# ``assembly_not_supported`` (CadQuery build lacks ``cq.Assembly``),
# ``tessellation_error`` / ``export_error`` for CadQuery raises.
#
# Safety Rule 1: STL export from an assembly flows through the same
# degenerate-triangle filter + post-write size check as ``cad.tessellate``, so
# downstream ``cam.run_toolpath`` numerics are byte-identical regardless of
# whether the source was a single body or a flattened assembly.


def _require_parts_list(params: dict[str, Any]) -> list[Any]:
    """Validate the ``parts`` array on the wire BEFORE delegating.

    Catches the common "renderer forgot to wrap in an array" case with a
    structured ``bad_params`` instead of a confusing ``TypeError`` from
    inside the assembly core.
    """
    raw = params.get("parts")
    if raw is None:
        raise _CadHandlerError(
            "bad_params",
            "missing required param 'parts' (must be a non-empty array)",
        )
    if not isinstance(raw, list):
        raise _CadHandlerError(
            "bad_params",
            f"parts must be an array, got {type(raw).__name__}",
        )
    return raw


def _optional_assembly_name(params: dict[str, Any]) -> str | None:
    """Validate the optional ``name`` param for ``cad.create_assembly``.

    Returns ``None`` when absent so the core can apply its default name.
    """
    name = params.get("name")
    if name is None:
        return None
    if not isinstance(name, str) or not name:
        raise _CadHandlerError(
            "bad_params", "name must be a non-empty string when provided"
        )
    return name


def create_assembly(params: dict[str, Any]) -> dict[str, Any]:
    """Build a ``cq.Assembly`` from existing part handles + per-child transforms.

    Each child entry must carry a ``handle`` that is already registered in the
    process-local ``_HANDLES`` table (from a prior ``cad.execute_script`` or
    ``cad.import_step``). The ``transform`` field accepts the literal string
    ``"identity"`` or a row-major 4x4 matrix.
    """
    parts = _require_parts_list(params)
    name = _optional_assembly_name(params)
    return _build_assembly_core(parts, assembly_name=name)


def tessellate_assembly(params: dict[str, Any]) -> dict[str, Any]:
    """Walk an assembly handle and produce a flat-buffer mesh.

    Returns the same wire shape as ``cad.tessellate_with_ids`` so the
    renderer's selection logic does not need to fork on assembly vs. single
    body. The ``faceMap`` dict gains a ``childName`` field on each entry so
    the inspector panel can attribute selected faces to the right part.
    """
    handle = _require_str(params, "handle")

    # Optional toleranceMm; default 0.1 mm to match the per-child tessellation
    # path used by ``cad.execute_script`` so face IDs and triangle counts line
    # up across solo-body and assembly workflows.
    tol_raw = params.get("toleranceMm", 0.1)
    if not isinstance(tol_raw, (int, float)) or isinstance(tol_raw, bool):
        raise _CadHandlerError(
            "invalid_numeric_params",
            "toleranceMm must be a number when provided",
        )
    tolerance = float(tol_raw)
    if not math.isfinite(tolerance) or tolerance <= 0:
        raise _CadHandlerError(
            "invalid_numeric_params",
            "toleranceMm must be a positive finite number",
        )

    return _tessellate_assembly_core(handle, tolerance_mm=tolerance)


def export_assembly(params: dict[str, Any]) -> dict[str, Any]:
    """Export an assembly handle to STEP (hierarchy-preserving) or STL (flattened).

    STEP preserves the part hierarchy via ``cq.Assembly.save``. STL flattens
    to a single mesh by walking the per-child tessellation path — same
    Safety Rule 1 guarantees as ``cad.export`` (degenerate-triangle filter,
    right-hand-rule normals, post-write size check).
    """
    handle = _require_str(params, "handle")
    out_path = _require_str(params, "outPath")
    fmt = _require_str(params, "format").lower()
    if fmt not in _ALLOWED_ASSEMBLY_FORMATS:
        raise _CadHandlerError(
            "bad_params",
            f"format must be one of {sorted(_ALLOWED_ASSEMBLY_FORMATS)}, "
            f"got {fmt!r}",
        )

    # Reject null-byte injection before delegating — mirrors ``cad.export`` /
    # ``cad.export_drawing`` posture so a malicious-looking path never reaches
    # the assembly core's Path() construction.
    if "\x00" in out_path:
        raise _CadHandlerError(
            "bad_params", "outPath must not contain null bytes"
        )

    tol_raw = params.get("toleranceMm", 0.1)
    if isinstance(tol_raw, (int, float)) and not isinstance(tol_raw, bool):
        tolerance = float(tol_raw)
        if not (tolerance > 0 and tolerance < math.inf):
            raise _CadHandlerError(
                "invalid_numeric_params",
                "toleranceMm must be a positive finite number when provided",
            )
    else:
        raise _CadHandlerError(
            "invalid_numeric_params",
            "toleranceMm must be a number when provided",
        )

    return _export_assembly_core(
        handle, out_path, fmt, tolerance_mm=tolerance
    )


# ── BUILD 5: planegcs sketch solver (CAD V1 Sketcher constraint solve) ───
#
# ``cad.solve_sketch`` takes the renderer's current sketch state and a list
# of constraints, runs planegcs, and returns the updated sketch with points
# moved to satisfy the constraints. The wire shape lives in
# ``src/shared/sidecar-protocol.ts`` (``CadSolveSketchParams`` /
# ``CadSolveSketchResult``); the numerics live in
# ``engines/cad/sketch_solver.py``.
#
# Params::
#
#   {
#     "sketchState": {
#       "points":  [{"id": str, "x": number, "y": number, "fixed": bool}, ...],
#       "lines":   [{"id": str, "p1": str, "p2": str}, ...],
#       "circles": [{"id": str, "center": str, "radius": number}, ...],
#       "arcs":    [{"id": str, "center": str, "start": str, "end": str,
#                    "radius": number, "startAngle": number, "endAngle": number}, ...]
#     },
#     "constraintList": [
#       {"id": str, "kind": "horizontal" | "vertical" | "coincident"
#                          | "distance" | "radius" | "parallel"
#                          | "perpendicular", ...kind-specific fields},
#       ...
#     ]
#   }
#
# Success result::
#
#   {
#     "sketch": {<same shape as sketchState, points moved to satisfy the constraints>},
#     "dof":    0,                       # real residual DOF (0 == fully constrained)
#     # ── ADDITIVE diagnostics (CAD V1 Sketcher DOF badge) ───────────────
#     "status": "fully",                 # "fully" | "under" | "over" | "conflicting"
#     "conflictingConstraintIds": [],    # source constraint ids in conflict
#     "redundantConstraintIds":   [],    # source constraint ids flagged redundant
#     "underConstrainedEntityIds":[]     # sketch point ids still free to move
#   }
#
# On the fully-constrained success path ``dof`` is 0 and the three id arrays
# are empty, so callers that predate the diagnostics fields are unaffected.
# The V1 handler still RAISES solver_under_constrained / solver_over_constrained
# rather than returning a partial-solution success; the same DOF/status payload
# rides along on the raised error's ``diagnostics`` attribute for callers that
# want the structured data. See ``CadSolveSketchResult`` in
# ``src/shared/sidecar-protocol.ts`` for the mirrored optional fields.
#
# Errors mirror the sketch_solver vocabulary: planegcs_not_installed,
# invalid_sketch, invalid_constraint, solver_under_constrained,
# solver_over_constrained, solver_failed.


def solve_sketch(params: dict[str, Any]) -> dict[str, Any]:
    """Run the planegcs constraint solver on a sketch + constraint list.

    Validates the wire envelope shape, defers to
    ``engines/cad/sketch_solver.py`` for the numeric solve, and returns the
    updated sketch geometry. Designed to be called interactively from the
    Sketcher canvas — the renderer pushes a fresh sketch+constraints payload
    every time the user adds or moves something and re-solves.
    """
    sketch_state = params.get("sketchState")
    if sketch_state is None:
        raise _CadHandlerError(
            "bad_params", "missing required param: 'sketchState'"
        )
    if not isinstance(sketch_state, dict):
        raise _CadHandlerError(
            "bad_params", "'sketchState' must be a JSON object"
        )

    constraint_list = params.get("constraintList")
    if constraint_list is None:
        raise _CadHandlerError(
            "bad_params", "missing required param: 'constraintList'"
        )
    if not isinstance(constraint_list, list):
        raise _CadHandlerError(
            "bad_params", "'constraintList' must be a JSON array"
        )

    return _solve_sketch_payload_core(sketch_state, constraint_list)


# ── BUILD 6 (Assembly mates — Wave 3 CAD V1.5): incremental mate handler ──
#
# Adds a single mate constraint (point / axis / plane) to an existing
# assembly. Powers the renderer's V1.5 AssemblyView modal, which lets the
# operator pick two features in the viewport and call this method once per
# confirmed mate. The assembly handle stays stable across calls — the
# sidecar updates the cached cq.Assembly + bbox in place.
#
# Wire result::
#
#     {
#       "handle":  str,                       # echo of input
#       "kind":    "point" | "axis" | "plane",
#       "part1Id": str,
#       "part2Id": str,
#       "bbox":    {"min":[..3], "max":[..3]}  # post-solve extent
#     }
#
# Error vocabulary mirrors the bulk assembly path with one addition:
#   * 'mate_solve_failed' — cq.Assembly.solve() raised, usually because
#                            the operator stacked conflicting mates
#                            (over-constrained system).


def _require_mate_payload(params: dict[str, Any]) -> dict[str, Any]:
    """Validate the ``mate`` wire envelope BEFORE delegating.

    Catches the common 'renderer forgot to wrap the kind in a string' /
    'sent the mate as a list instead of an object' bugs with a structured
    ``bad_params`` instead of letting them surface as opaque KeyErrors.
    """
    raw = params.get("mate")
    if raw is None:
        raise _CadHandlerError(
            "bad_params",
            "missing required param 'mate' (object with kind / part1Id / "
            "part2Id / feature fields)",
        )
    if not isinstance(raw, dict):
        raise _CadHandlerError(
            "bad_params",
            f"mate must be an object, got {type(raw).__name__}",
        )
    return raw


def add_assembly_mate(params: dict[str, Any]) -> dict[str, Any]:
    """Attach a mate constraint to an existing assembly handle.

    See module docstring for the wire contract. Deep validation of the
    mate envelope (feature shapes, finite-number checks, child-name
    resolution) happens inside the assembly core — this wrapper only
    enforces the envelope-level checks (handle present, mate is an
    object) so the renderer can surface structured failures fast.
    """
    handle = _require_str(params, "handle")
    mate = _require_mate_payload(params)
    return _add_mate_core(handle, mate)


# ── BUILD 7 (Drawing dimensions / sections / title block — CAD V1.5) ─────
#
# Three thin wrappers exposing the ``cadquery_drawing`` extensions to the
# sidecar wire so the renderer's V1.5 DrawingView can build a real
# mechanical drawing on top of the bare projection. All three operate on
# top of an existing body handle (from ``cad.execute_script`` or
# ``cad.import_step``) — they do NOT introduce a new handle category.
#
#   cad.dimension_drawing  — overlay a dimension annotation layer.
#   cad.section_drawing    — slice the body and project the cut.
#   cad.attach_title_block — stamp a title-block ``<g>`` into an SVG.
#
# Wire results::
#
#   cad.dimension_drawing:
#     {"svg": str, "view": str, "bytes": int, "dimensionCount": int}
#
#   cad.section_drawing:
#     {"svg": str, "view": str, "bytes": int,
#      "plane": {"axis": str, "offset": float, "keepSide": str}}
#
#   cad.attach_title_block:
#     {"svg": str, "bytes": int,
#      "metadata": {"name": str, "scale": str, "author": str,
#                    "date": str, "sheet": str}}
#
# Error vocabulary mirrors the BUILD-3 drawing path with two additions:
#   * 'section_error'    — CadQuery raised during the cut/half-space
#                            operation (degenerate plane offset, etc.).
#   * 'bad_params'       — malformed dimension spec, unknown dimension
#                            kind, non-finite coordinate, bad section axis,
#                            empty SVG, non-string title-block field.
#
# Safety Rule 1 reminder: these methods DO NOT touch G-code / STL. The
# annotated SVG is renderer-only; no downstream CAM logic reads it.


def _require_list_param(params: dict[str, Any], key: str) -> list[Any]:
    """Validate a list-typed param. Returns the list or raises ``bad_params``."""
    val = params.get(key)
    if val is None:
        raise _CadHandlerError(
            "bad_params", f"missing required param {key!r} (must be an array)"
        )
    if not isinstance(val, list):
        raise _CadHandlerError(
            "bad_params", f"{key!r} must be an array, got {type(val).__name__}"
        )
    return val


def _require_dict_param(params: dict[str, Any], key: str) -> dict[str, Any]:
    """Validate an object-typed param. Returns the dict or raises ``bad_params``."""
    val = params.get(key)
    if val is None:
        raise _CadHandlerError(
            "bad_params", f"missing required param {key!r} (must be an object)"
        )
    if not isinstance(val, dict):
        raise _CadHandlerError(
            "bad_params", f"{key!r} must be an object, got {type(val).__name__}"
        )
    return val


def _optional_bool(params: dict[str, Any], key: str, default: bool) -> bool:
    """Read an optional boolean flag. Absent / ``None`` → ``default``.

    A present value MUST be a real ``bool`` (not a truthy int/str) so a
    renderer typo (``"true"`` as a string) fails fast with ``bad_params``
    rather than silently flipping the flag on.
    """
    val = params.get(key)
    if val is None:
        return default
    if not isinstance(val, bool):
        raise _CadHandlerError(
            "bad_params", f"{key!r} must be a boolean when provided"
        )
    return val


def _require_v15_view_param(params: dict[str, Any]) -> str:
    """Validate the ``view`` param. Identical to the BUILD-3 version, kept
    local to this section so the V1.5 surface stays diff-isolated.
    """
    view = _require_str(params, "view")
    if view not in _ALLOWED_DRAWING_VIEWS:
        raise _CadHandlerError(
            "bad_params",
            f"view must be one of {sorted(_ALLOWED_DRAWING_VIEWS)}, "
            f"got {view!r}",
        )
    return view


def dimension_drawing(params: dict[str, Any]) -> dict[str, Any]:
    """Project a body handle and overlay a dimension annotation layer.

    See module docstring for the wire contract. The renderer pushes a fresh
    payload every time the operator adds / edits a dimension; the sidecar
    re-runs the base projection and folds the dimensions in. An empty
    dimension list round-trips back to the bare projection.
    """
    handle = _require_str(params, "handle")
    view = _require_v15_view_param(params)
    dimensions = _require_list_param(params, "dimensions")
    return _v15_dimension_drawing_core(handle, view, dimensions)


def section_drawing(params: dict[str, Any]) -> dict[str, Any]:
    """Slice the body behind ``handle`` and project the section view.

    The cut is performed on a CLONE of the body — the handle table is not
    mutated, so toggling the section view on and off is non-destructive.

    Optional annotation params (additive — older renderers omit them and get
    the documented defaults):
      * ``label``           — cutting-plane label string (defaults to "A-A").
        Operator free-text; the core escapes it before any ``<text>`` node.
      * ``showHatch``       — bool, fill the cut face with a 45° hatch.
      * ``showSectionLine`` — bool, stamp the ASME cutting-plane line.
    """
    handle = _require_str(params, "handle")
    view = _require_v15_view_param(params)
    plane = _require_dict_param(params, "plane")
    label = params.get("label")
    if label is not None and not isinstance(label, str):
        raise _CadHandlerError(
            "bad_params", "label must be a string when provided"
        )
    show_hatch = _optional_bool(params, "showHatch", True)
    show_section_line = _optional_bool(params, "showSectionLine", True)
    return _v15_section_drawing_core(
        handle,
        view,
        plane,
        label=label,
        show_hatch=show_hatch,
        show_section_line=show_section_line,
    )


def detail_drawing(params: dict[str, Any]) -> dict[str, Any]:
    """Crop a circular region of a parent projection and magnify it.

    Thin wrapper over ``cadquery_drawing.detail_drawing``: the renderer passes
    ``{handle, view, center:{x,y}, radiusMm, scale?, label?}``; the core
    projects the parent view ONCE then re-frames a circular crop into a fresh
    ``<svg>`` whose ``viewBox`` is the crop window and whose pixel size is
    ``scale ×`` that window (the magnification). ``label`` is operator
    free-text — the core routes it through ``_xml_escape`` before any
    ``<text>`` node (Safety Rule 4). The envelope is validated here; all the
    crop geometry / escaping lives in the core.

    ``radiusMm`` and ``scale`` are forwarded raw (``None`` when absent) so the
    core's positive-finite guard owns the numeric vocabulary and a missing /
    zero / negative value fails with ``bad_params`` from one place.
    """
    handle = _require_str(params, "handle")
    view = _require_v15_view_param(params)
    center = _require_dict_param(params, "center")
    radius_mm = params.get("radiusMm")
    scale = params.get("scale", 2.0)
    label = params.get("label")
    return _v15d_detail_drawing_core(
        handle,
        view,
        center,
        radius_mm,
        scale,
        label,
    )


def attach_title_block(params: dict[str, Any]) -> dict[str, Any]:
    """Stamp a title-block ``<g>`` into the bottom-right of an SVG.

    Idempotent against an already-stamped SVG: the wrapper passes the call
    straight through to the core, which detects the ``class="title-block"``
    marker and skips re-stamping.
    """
    svg_text = _require_str(params, "svg")
    metadata = _require_dict_param(params, "metadata")
    return _v15_attach_title_block_core(svg_text, metadata)


# ── BUILD 9 (Associative-dimension geometry + BOM-table stamp — CAD V1.5) ──
#
# Two more thin wrappers. ``drawing_bom_table`` exposes the ``cadquery_drawing``
# BOM helper; ``extract_drawing_geometry`` exposes the dedicated projected-
# geometry module ``cadquery_drawing_geometry``. Both operate alongside the
# BUILD-7 drawing surface:
#
#   cad.extract_drawing_geometry — project a body handle for a view (via the
#                                   SAME OCCT HLR projection ``getSVG`` uses) and
#                                   return projected vertices / edges / snap
#                                   points WITH quantized-hash STABLE ids, PLUS
#                                   the matching ``svg`` so geometry + SVG never
#                                   disagree on origin / scale. Operates on an
#                                   existing body handle, like ``project_drawing``.
#   cad.drawing_bom_table        — stamp a BOM-table ``<g>`` into an SVG. Like
#                                   ``attach_title_block``, it operates on the
#                                   SVG string directly (no handle table) and
#                                   renders the caller-supplied rows verbatim —
#                                   it does NOT recompute the BOM.
#
# Wire results::
#
#   cad.extract_drawing_geometry (superset — back-compat ``id`` / ``points`` /
#   ``sourceId`` fields are included alongside the canonical names so the
#   existing ipc-cad.ts coercer keeps working):
#     {"view": str,
#      "viewBox": {"x": float, "y": float, "w": float, "h": float},
#      "vertices":   [{"vertexId": str, "id": str, "x": float, "y": float}, ...],
#      "edges":      [{"edgeId": str, "id": str, "kind": "line"|"circle"|"arc",
#                      "p1": [x,y], "p2": [x,y], "center": [x,y]|null,
#                      "radius": float|null, "v1": str, "v2": str,
#                      "points": [[x,y], ...]}, ...],
#      "snapPoints": [{"kind": "endpoint"|"midpoint"|"center"|"quadrant",
#                      "x": float, "y": float, "ownerId": str,
#                      "id": str, "sourceId": str}, ...],
#      "svg": str}
#
#   cad.drawing_bom_table:
#     {"svg": str, "bytes": int, "rowCount": int}
#
# Error vocabulary mirrors the BUILD-3 / BUILD-7 drawing path, plus the HLR
# binding code from cadquery_drawing_geometry:
#   * 'bad_params'      — unknown view, empty SVG, malformed BOM row / column.
#   * 'invalid_handle'  — handle missing (extract_drawing_geometry only;
#                          drawing_bom_table doesn't read the table).
#   * 'ocp_hlr_not_available' — OCP HLR / projection binding missing
#                                (extract_drawing_geometry only).
#   * 'drawing_error' / 'cadquery_not_installed' — propagated.
#
# Safety Rule 1 reminder: these methods DO NOT touch G-code / STL. The
# geometry + SVG are renderer-only; no downstream CAM logic reads them.


def extract_drawing_geometry(params: dict[str, Any]) -> dict[str, Any]:
    """Project a body handle and return id-tagged 2D vertices / edges / snaps.

    The renderer's DrawingView calls this once per (handle, view) and feeds the
    ``snapPoints`` into its two-click dimension placement so a placed dimension
    records the snapped feature's ``sourceId`` (associative anchor).
    """
    handle = _require_str(params, "handle")
    view = _require_v15_view_param(params)
    return _extract_drawing_geometry_core(handle, view=view)


def drawing_bom_table(params: dict[str, Any]) -> dict[str, Any]:
    """Stamp a BOM-table ``<g>`` into an SVG from caller-supplied rows.

    Idempotent against an already-stamped SVG: the wrapper passes the call
    straight through to the core, which detects the ``class="bom-table"``
    marker and skips re-stamping. The ``rows`` are the BOM lines the assembly
    model already computed — the core renders them verbatim and does NOT
    recompute quantities.
    """
    svg_text = _require_str(params, "svg")
    rows = _require_list_param(params, "rows")
    # ``columns`` / ``title`` are optional; the core validates + defaults them.
    columns = params.get("columns")
    title = params.get("title")
    return _v15b_drawing_bom_table_core(svg_text, rows, columns, title)


# ── BUILD 10 (GD&T feature control frames — CAD V1.5) ─────────────────────
#
# One more thin wrapper. ``annotate_gdt`` exposes the ``cadquery_drawing``
# GD&T helper. Like ``drawing_bom_table`` / ``attach_title_block`` it operates
# on the SVG string directly (no handle table) and stamps a
# feature-control-frame ``<g>`` layer onto an existing drawing:
#
#   cad.annotate_gdt — compose GD&T feature-control-frame(s) onto an SVG.
#
# Wire result::
#
#   cad.annotate_gdt:
#     {"svg": str, "bytes": int, "frameCount": int}
#
# Error vocabulary mirrors the BUILD-7 / BUILD-9 drawing path:
#   * 'bad_params' — empty SVG, ``frames`` not an array, malformed frame
#                     (unknown characteristic, negative tolerance, > 3 datums,
#                     non-string datum, bad placement).
#
# Safety Rule 4 (stored-XSS): every operator-controlled string — each datum
# reference AND any override label — is entity-escaped in the core before it
# reaches a ``<text>`` node. The renderer drops the SVG into
# ``dangerouslySetInnerHTML``; unescaped markup here would be stored XSS.
#
# Safety Rule 1 reminder: renderer-only SVG; never touches G-code / STL.


def annotate_gdt(params: dict[str, Any]) -> dict[str, Any]:
    """Stamp GD&T feature-control-frame(s) into an SVG from caller-supplied frames.

    The renderer pushes a fresh payload every time the operator adds / edits a
    feature control frame; the core re-composes the layer and folds it onto
    the supplied SVG. An empty ``frames`` list round-trips the SVG unchanged.

    The ``frames`` are validated frame-by-frame in the core (unknown
    characteristic / negative tolerance / > 3 datums / bad placement all fail
    fast with ``bad_params``). Every operator string is XML-escaped in the
    core before injection (Safety Rule 4).
    """
    svg_text = _require_str(params, "svg")
    frames = _require_list_param(params, "frames")
    return _v15g_annotate_gdt_core(svg_text, frames)


# -- BUILD 8 (3D viewport true-HLR section cut -- CAD V1.5) ----------------
#
# ``cad.hlr_section`` powers the Design workspace's engineering section view in
# the 3D viewport (NOT the 2D drawing pipeline -- that is ``cad.section_drawing``
# above). It cuts the body at an axis-aligned-or-arbitrary plane, fills the cut
# with a cap face, and runs real B-rep hidden-line removal from a view
# direction so the renderer can draw visible (solid) vs hidden (dashed) edges
# correctly. Numerics live in ``engines/cad/cadquery_hlr.py``.
#
# Wire result (kept in lock-step with ``src/shared/sidecar-protocol.ts``)::
#
#     {
#       "visibleEdges":     [[[x,y,z], ...], ...],
#       "hiddenEdges":      [[[x,y,z], ...], ...],
#       "capFaceTriangles": [x,y,z, x,y,z, x,y,z, ...],   # 9 floats / triangle
#       "capFaceOutline":   [[[x,y,z], ...], ...],        # 1 ring / section loop
#       "bbox":             {"min": [..3], "max": [..3]},
#       "truncated":        bool
#     }
#
# Error vocabulary adds two codes to the shared set:
#   * 'ocp_hlr_not_available' -- OCP HLR / section binding missing; the
#                                 renderer falls back to the GPU half-space
#                                 clip + a toast.
#   * 'hlr_section_error'     -- OCCT raised mid-pipeline.
# plus the usual 'bad_params' / 'invalid_handle'.
#
# Safety Rule 1: this path does NOT emit G-code / STL. The section overlay is
# renderer-only; no downstream CAM logic reads it.


def _require_vec3_param(params: dict[str, Any], key: str) -> list[float]:
    """Validate a 3-element numeric vector param. Raises ``bad_params``.

    The deep finite-number / zero-length checks live in the hlr core; this
    wrapper only enforces the envelope shape so a malformed call fails fast
    with a structured error before the (slow) OCP import.
    """
    raw = params.get(key)
    if not isinstance(raw, (list, tuple)) or len(raw) != 3:
        raise _CadHandlerError(
            "bad_params", f"{key!r} must be a 3-element [x, y, z] vector"
        )
    out: list[float] = []
    for i, c in enumerate(raw):
        if isinstance(c, bool) or not isinstance(c, (int, float)):
            raise _CadHandlerError(
                "bad_params", f"{key}[{i}] must be a number"
            )
        out.append(float(c))
    return out


def hlr_section(params: dict[str, Any]) -> dict[str, Any]:
    """Compute a true-HLR section view for a body handle (3D viewport overlay).

    See the section comment above for the wire contract. Mirrors the thin-
    wrapper posture of ``section_drawing`` / ``project_drawing``: validate the
    envelope here, defer all geometry to the ``cadquery_hlr`` core.
    """
    handle = _require_str(params, "handle")
    plane_normal = _require_vec3_param(params, "planeNormal")
    plane_offset = params.get("planeOffset", 0.0)
    if isinstance(plane_offset, bool) or not isinstance(plane_offset, (int, float)):
        raise _CadHandlerError(
            "bad_params", "planeOffset must be a number"
        )
    view_dir = _require_vec3_param(params, "viewDir")

    # Optional toleranceMm; default 0.1 mm to match the other tessellation
    # paths so edge sampling density is consistent across the app.
    tol_raw = params.get("toleranceMm", 0.1)
    if not isinstance(tol_raw, (int, float)) or isinstance(tol_raw, bool):
        raise _CadHandlerError(
            "invalid_numeric_params",
            "toleranceMm must be a number when provided",
        )
    tolerance = float(tol_raw)
    if not math.isfinite(tolerance) or tolerance <= 0:
        raise _CadHandlerError(
            "invalid_numeric_params",
            "toleranceMm must be a positive finite number",
        )

    return _hlr_section_core(
        handle,
        plane_normal,
        float(plane_offset),
        view_dir,
        tolerance_mm=tolerance,
    )


HANDLERS: dict[str, HandlerFn] = {
    "import_step": import_step,
    "tessellate": tessellate,
    "execute_script": execute_script,
    "export": export,
    "list_operations": list_operations,
    "tessellate_with_ids": tessellate_with_ids,
    # BUILD 3 — Drawings
    "project_drawing": project_drawing,
    "export_drawing": export_drawing,
    # BUILD 4 — Assemblies
    "create_assembly": create_assembly,
    "tessellate_assembly": tessellate_assembly,
    "export_assembly": export_assembly,
    # BUILD 5 — Sketcher constraint solve
    "solve_sketch": solve_sketch,
    # BUILD 6 — Assembly mate constraints (CAD V1.5)
    "add_assembly_mate": add_assembly_mate,
    # BUILD 7 — Drawing dimensions / sections / title block (CAD V1.5)
    "dimension_drawing": dimension_drawing,
    "section_drawing": section_drawing,
    "detail_drawing": detail_drawing,
    "attach_title_block": attach_title_block,
    # BUILD 8 -- 3D viewport true-HLR section cut (CAD V1.5)
    "hlr_section": hlr_section,
    # BUILD 9 — Associative-dimension geometry + BOM-table stamp (CAD V1.5)
    "extract_drawing_geometry": extract_drawing_geometry,
    "drawing_bom_table": drawing_bom_table,
    # BUILD 10 — GD&T feature control frames (CAD V1.5)
    "annotate_gdt": annotate_gdt,
}
