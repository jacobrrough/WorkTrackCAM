"""CadQuery-backed CAD handlers for the WorkTrackCAM sidecar.

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
    from engines.cad.cadquery_assembly import (
        ALLOWED_ASSEMBLY_FORMATS as _ALLOWED_ASSEMBLY_FORMATS,
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
    from cad.cadquery_assembly import (  # type: ignore[no-redef]
        ALLOWED_ASSEMBLY_FORMATS as _ALLOWED_ASSEMBLY_FORMATS,
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


ALLOWED_EXPORT_FORMATS = ("step", "stl", "dxf")


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
    """Export the body referenced by ``handle`` to STEP / STL / DXF.

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
#       "faceMap":       {"<id>": {"kind":"face", "occtHash":int, "area":float}}
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
#     "dof":    0    # always 0 on success (planegcs reports the degrees of
#                    # freedom; the V1 handler refuses under-constrained
#                    # systems and surfaces solver_under_constrained instead)
#   }
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
}
