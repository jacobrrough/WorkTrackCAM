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


HANDLERS: dict[str, HandlerFn] = {
    "import_step": import_step,
    "tessellate": tessellate,
    "execute_script": execute_script,
    "export": export,
    "list_operations": list_operations,
    "tessellate_with_ids": tessellate_with_ids,
}
