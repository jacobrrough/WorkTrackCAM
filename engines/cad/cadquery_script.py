"""Pure-Python CadQuery script executor + AST inspector.

Shared by the sidecar handlers in ``engines/sidecar/cad_handlers.py``. Mirrors
the structure of ``cadquery_import.py`` and ``ocl_strategies.py``: a tiny set
of pure functions plus dictionary stash points so the sidecar handler stays
thin (param validation + envelope mapping).

Wire surface
============
Three method bodies live here:

  * :func:`execute_script` — runs a user-written CadQuery script in a
    sandboxed ``exec()`` namespace; tessellates the result and stashes the
    workplane behind a handle so downstream ``cad.export`` / ``cam.*`` calls
    can reach it. Reuses ``cadquery_import.tessellate_body()`` for the binary
    STL writer (degenerate-triangle filtering, right-hand-rule normals,
    post-write size check).
  * :func:`export_by_handle` — exports the body behind a handle (from a
    prior :func:`execute_script` or :func:`import_step_file`) to STEP /
    STL / DXF on disk. STL goes through the existing degenerate-filter
    binary writer; STEP / DXF use ``cq.exporters.export``.
  * :func:`list_operations` — static ``ast`` parse for the read-only
    FeatureTree (no script execution; safe to run on every keystroke).

Safety
======
Scripts are **user-trusted** (the user typed them in their own desktop app),
so we are guarding against accidents (typos, copy-paste mistakes) rather
than adversarial input. Specifically:

  * A ``BANNED_TOKENS`` pre-scan rejects substrings that strongly suggest
    process / filesystem escape (``import os``, ``__import__``, ``exec(``,
    ``eval(``, ``subprocess``, …) before any code runs. This is a tripwire
    against pasted-in scripts that try to ``rm -rf`` the user's project; it
    is not a perfect sandbox (you can't make one in CPython without ``-S``
    + a separate interpreter), and the comment in the code says so.
  * ``exec()`` runs against a restricted ``__builtins__`` dict that exposes
    only the names a parametric-CAD script legitimately needs (``len``,
    ``range``, ``min``, ``max``, math arithmetic, ``True`` / ``False`` /
    ``None``). ``open``, ``import``, ``eval``, ``exec`` are absent.
  * Output paths for :func:`export_by_handle` are rejected for null-byte
    injection — same posture as ``src/main/path-security.ts``.
"""
from __future__ import annotations

import ast
import math
import tempfile
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .cadquery_import import (
    StepDocument,
    _CadHandlerError,
    _HANDLES,
    _build_binary_stl,
    _binary_stl_size,
    _safe_bbox,
    tessellate_body,
)


# ── Banned-token tripwire ────────────────────────────────────────────────
#
# These substrings strongly suggest a script is trying to escape the
# parametric-CAD sandbox (filesystem, network, subprocess, dynamic import,
# attribute-stuffing). A match aborts execution with ``unsafe_script`` BEFORE
# any code runs. Comment-stripping is intentionally absent — if you put
# ``# import os`` in a CadQuery script the scanner will still reject it, but
# that's a tiny price to pay for not having to write a tokenizer-aware filter
# (which a determined attacker can still trick anyway).
BANNED_TOKENS: Tuple[str, ...] = (
    "import os",
    "import sys",
    "import subprocess",
    "import socket",
    "import shutil",
    "import pathlib",
    "import importlib",
    "import ctypes",
    "import multiprocessing",
    "import threading",
    "import asyncio",
    "import http",
    "import urllib",
    "import requests",
    "from os ",
    "from sys ",
    "from subprocess ",
    "from socket ",
    "from shutil ",
    "from pathlib ",
    "from importlib ",
    "from ctypes ",
    "__import__",
    "open(",
    "eval(",
    "exec(",
    "compile(",
    "globals(",
    "locals(",
    "getattr(",
    "setattr(",
    "delattr(",
    "vars(",
    "input(",
    "__builtins__",
    "__class__",
    "__bases__",
    "__subclasses__",
)


# Restricted builtins exposed to user scripts. Anything not in this dict is
# unreachable through bare-name lookup inside the exec() namespace.
_SAFE_BUILTINS: Dict[str, Any] = {
    "abs": abs,
    "all": all,
    "any": any,
    "bool": bool,
    "dict": dict,
    "enumerate": enumerate,
    "float": float,
    "int": int,
    "len": len,
    "list": list,
    "map": map,
    "max": max,
    "min": min,
    "pow": pow,
    "print": print,  # captured into log[] via redirect below
    "range": range,
    "reversed": reversed,
    "round": round,
    "set": set,
    "sorted": sorted,
    "str": str,
    "sum": sum,
    "tuple": tuple,
    "zip": zip,
    "True": True,
    "False": False,
    "None": None,
}


# ── Banned-token scan ────────────────────────────────────────────────────


def scan_banned_tokens(script: str) -> Optional[str]:
    """Return the first banned token found in ``script``, or ``None``.

    Naive substring scan — not tokenizer-aware. Documented behavior: a
    legitimate variable named ``opensesame`` containing ``open(`` would
    falsely trip ``open(``. Acceptable trade-off in the MVP because the
    sandbox is a tripwire, not a security boundary. Users who hit a false
    positive can rename the variable.
    """
    for token in BANNED_TOKENS:
        if token in script:
            return token
    return None


# ── Script execution ─────────────────────────────────────────────────────


def execute_script(
    script: str,
    build_parameters: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Execute a CadQuery script and return tessellated mesh data + handles.

    Wire result::

        {
          "meshes":     [{"handle": "script:...", "vertices": [...],
                          "indices": [[i0,i1,i2], ...],
                          "triangleCount": int,
                          "bbox": {"min":[..3], "max":[..3]}}],
          "faceCount":  int,
          "log":        [str, ...]    # captured print() lines
        }

    Raises ``_CadHandlerError`` with one of:
      * ``unsafe_script`` — banned-token tripped pre-scan.
      * ``cadquery_not_installed`` — ``import cadquery`` failed.
      * ``script_exec_error`` — user script raised during exec().
      * ``script_no_result`` — script finished but produced no Workplane
        (neither ``result`` nor any ``show_object()`` call).
      * ``tessellation_error`` — CadQuery failed to tessellate the result.

    Behavior on multiple shapes
    ----------------------------
    A script may either:
      * assign a single Workplane to a top-level name ``result`` (or
        ``assembly``), OR
      * call ``show_object(<Workplane>)`` one or more times (CQGI-style).
    Both produce one entry in ``meshes`` per produced body, in the order
    they were created. ``show_object`` results take precedence when both
    paths are used.
    """
    banned = scan_banned_tokens(script)
    if banned is not None:
        raise _CadHandlerError(
            "unsafe_script",
            f"script contains banned token {banned!r}; "
            "the parametric editor does not allow filesystem / subprocess / "
            "dynamic-import calls inside scripts.",
        )

    try:
        import cadquery as cq  # noqa: PLC0415 - optional dependency
    except ImportError as exc:
        raise _CadHandlerError(
            "cadquery_not_installed",
            "CadQuery is not installed in the sidecar's Python environment",
            detail=str(exc),
        ) from exc

    # Captured ``show_object`` calls + print() lines.
    shown: List[Tuple[Any, Optional[str]]] = []
    log_lines: List[str] = []

    def _show_object(obj: Any, name: Optional[str] = None, **_kw: Any) -> None:
        shown.append((obj, name))

    def _log_print(*args: Any, **kw: Any) -> None:
        sep = kw.get("sep", " ")
        log_lines.append(sep.join(str(a) for a in args))

    # Build the exec namespace. ``cadquery`` (and the short alias ``cq``) are
    # the only modules a script may touch. Build parameters land as bare
    # top-level names so a script can write ``length = 50``-style defaults
    # AND the renderer can override them at run time.
    namespace: Dict[str, Any] = {
        "__builtins__": dict(_SAFE_BUILTINS),
        "cadquery": cq,
        "cq": cq,
        "math": math,
        "show_object": _show_object,
        "debug": _log_print,
    }
    # Shadow print() in the sandboxed builtins with the log-capturing version.
    namespace["__builtins__"]["print"] = _log_print

    if build_parameters:
        for k, v in build_parameters.items():
            if not isinstance(k, str) or not k.isidentifier():
                raise _CadHandlerError(
                    "bad_params",
                    f"build parameter name must be a valid identifier: {k!r}",
                )
            if not isinstance(v, (int, float, bool, str)):
                raise _CadHandlerError(
                    "bad_params",
                    f"build parameter {k!r} must be number / bool / str, "
                    f"got {type(v).__name__}",
                )
            namespace[k] = v

    try:
        compiled = compile(script, "<cad_script>", "exec")
    except SyntaxError as exc:
        raise _CadHandlerError(
            "script_exec_error",
            f"script syntax error on line {exc.lineno}: {exc.msg}",
            detail=str(exc),
        ) from exc

    try:
        # noqa: S102 - intentional exec; sandbox docs above
        exec(compiled, namespace)  # nosec - intentional
    except _CadHandlerError:
        raise
    except Exception as exc:  # noqa: BLE001 - user script raises anything
        raise _CadHandlerError(
            "script_exec_error",
            f"script raised {type(exc).__name__}: {exc}",
            detail=repr(exc),
        ) from exc

    # Resolve bodies. ``show_object`` results win over the ``result`` /
    # ``assembly`` bare names if both exist — CQGI convention.
    bodies: List[Tuple[Any, Optional[str]]] = []
    if shown:
        bodies.extend(shown)
    else:
        for name in ("result", "assembly"):
            obj = namespace.get(name)
            if obj is not None:
                bodies.append((obj, name))
                break

    if not bodies:
        raise _CadHandlerError(
            "script_no_result",
            "script finished without producing a result. Assign a Workplane "
            "to a top-level variable named 'result' (or call show_object(...)).",
        )

    # Tessellate each body. Reuse ``cadquery_import.tessellate_body`` (which
    # in turn uses the degenerate-filtering binary STL writer) so the on-disk
    # STL is byte-identical to what cad.tessellate produces from STEP imports
    # (Safety Rule 1: same path feeds OCL drop / waterline downstream).
    meshes_out: List[Dict[str, Any]] = []
    face_count_total = 0
    stl_dir = Path(tempfile.gettempdir()) / "worktrackcam-cad-scripts"
    for body, _label in bodies:
        handle, mesh_payload = _tessellate_and_register(
            body, tolerance_mm=0.1, stl_dir=stl_dir
        )
        meshes_out.append({"handle": handle, **mesh_payload})
        face_count_total += int(mesh_payload["triangleCount"])

    return {
        "meshes": meshes_out,
        "faceCount": face_count_total,
        "log": log_lines,
    }


def _tessellate_and_register(
    body: Any, *, tolerance_mm: float, stl_dir: Path
) -> Tuple[str, Dict[str, Any]]:
    """Tessellate ``body``, stash it in ``_HANDLES``, and write a binary STL.

    Returns ``(handle, mesh_payload)`` where ``mesh_payload`` carries the
    on-disk STL path + triangle count + bbox the renderer needs to load the
    mesh into Three.js (matches the ``CadExecuteScriptMesh`` wire type in
    ``src/shared/sidecar-protocol.ts``).

    Reuses the same handle table as ``cadquery_import`` so downstream
    ``cad.export`` / ``cam.*`` calls can resolve script-produced bodies via
    the existing lookup path. The STL is written via ``tessellate_body``
    (the same degenerate-filtering binary writer used by ``cad.tessellate``)
    so a script-produced mesh is byte-identical to the same shape exported
    from STEP — Safety Rule 1.
    """
    # Resolve the body to a Workplane wrapping a single Solid so the existing
    # ``findSolid()`` + ``tessellate()`` numerics from the STEP path apply
    # unchanged. CadQuery accepts both Workplane and raw Solid here.
    workplane = _coerce_to_workplane(body)
    bbox_min, bbox_max = _safe_bbox(workplane)

    handle = f"script:{uuid.uuid4().hex}"
    _HANDLES[handle] = StepDocument(
        workplane=workplane,
        bbox_min=bbox_min,
        bbox_max=bbox_max,
        source_path="<cad_script>",
    )

    # Write the STL via the existing degenerate-filtering binary writer.
    # Failures here surface as ``tessellation_error`` / ``stl_write_error``
    # from the shared core — exact same error vocabulary as ``cad.tessellate``.
    stl_dir.mkdir(parents=True, exist_ok=True)
    stl_path = stl_dir / f"{handle.split(':', 1)[1]}.stl"
    tess = tessellate_body(handle, str(stl_path), float(tolerance_mm))

    return handle, {
        "stlPath": tess["stlPath"],
        "triangleCount": int(tess["triangleCount"]),
        "bbox": {"min": list(bbox_min), "max": list(bbox_max)},
    }


def _coerce_to_workplane(body: Any) -> Any:
    """Wrap a raw Solid / Compound in a Workplane so .findSolid() works.

    Lazily imported so the module load stays cheap when CadQuery isn't
    installed (we never reach this path in that case).
    """
    import cadquery as cq  # noqa: PLC0415

    if isinstance(body, cq.Workplane):
        return body
    # ``cq.Workplane()`` with a passed object slot wraps it.
    try:
        wp = cq.Workplane()
        wp.objects = [body]
        return wp
    except Exception:  # noqa: BLE001 - falls through to error below
        raise _CadHandlerError(
            "script_no_result",
            f"script produced a value of type {type(body).__name__!r} that is "
            "neither a Workplane nor a Solid; assign a Workplane to 'result'.",
        )


# ── Script-driven export ─────────────────────────────────────────────────


def export_by_handle(
    handle: str,
    out_path: str,
    fmt: str,
    *,
    tolerance_mm: float = 0.1,
) -> Dict[str, Any]:
    """Export the body behind ``handle`` to STEP / STL / DXF on disk.

    ``handle`` must already be in the shared ``_HANDLES`` table (populated by
    a prior ``cad.execute_script`` or ``cad.import_step`` call inside the same
    sidecar lifetime). Stateless re-execution from the script is intentionally
    NOT done here — keeping the export path side-effect-free means a
    parametric-edit cycle does not duplicate solid construction work.

    Returns ``{"outPath": str, "bytesWritten": int}``.

    Raises ``_CadHandlerError`` with one of:
      * ``bad_params`` — null-byte in path / empty path / bad format.
      * ``invalid_handle`` — handle is not in the table (sidecar restarted?
        Renderer should re-run cad.execute_script).
      * ``cadquery_not_installed`` — pip dependency missing.
      * ``export_error`` — CadQuery raised during ``cq.exporters.export``.
      * ``tessellation_error`` / ``stl_write_error`` — propagated from
        ``tessellate_body`` on the STL path (Safety Rule 1).
    """
    if not out_path or "\x00" in out_path:
        raise _CadHandlerError(
            "bad_params",
            "outPath must be a non-empty path without null bytes",
        )
    if fmt not in ("step", "stl", "dxf"):
        raise _CadHandlerError(
            "bad_params",
            f"format must be one of step/stl/dxf, got {fmt!r}",
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

    out = Path(out_path)
    try:
        out.parent.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise _CadHandlerError(
            "export_error",
            f"failed to create output directory {out.parent}: {exc}",
            detail=str(exc),
        ) from exc

    # STL: reuse the existing degenerate-filtering binary writer. This is the
    # path Send-to-CAM hits, so it MUST match the CadQuery STEP-import STL
    # exactly (same Safety Rule 1 guarantees).
    if fmt == "stl":
        tess = tessellate_body(handle, str(out), float(tolerance_mm))
        return {
            "outPath": tess["stlPath"],
            "bytesWritten": _binary_stl_size(int(tess["triangleCount"])),
        }

    try:
        import cadquery as cq  # noqa: PLC0415
    except ImportError as exc:
        raise _CadHandlerError(
            "cadquery_not_installed",
            "CadQuery is not installed in the sidecar's Python environment",
            detail=str(exc),
        ) from exc

    # STEP / DXF: CadQuery's own exporter. Wrap any failure into export_error.
    try:
        if fmt == "step":
            cq.exporters.export(doc.workplane, str(out))
        else:  # dxf
            cq.exporters.export(doc.workplane, str(out), exportType="DXF")
    except Exception as exc:  # noqa: BLE001 - CadQuery raises arbitrary types
        raise _CadHandlerError(
            "export_error",
            f"CadQuery export to {fmt!r} failed: {exc}",
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


# ── Static AST inspection (no execution) ─────────────────────────────────


# The 16 MVP operations the FeatureTree understands. The key is the lower-cased
# method name; the value is the human-readable summary kind echoed over the
# wire (so the renderer doesn't have to map). Names match CadQuery's
# Workplane / Sketch API.
_OPERATION_KINDS: Dict[str, str] = {
    "workplane": "workplane",
    "rect": "rect",
    "circle": "circle",
    "polygon": "polygon",
    "extrude": "extrude",
    "revolve": "revolve",
    "sweep": "sweep",
    "loft": "loft",
    "fillet": "fillet",
    "chamfer": "chamfer",
    "shell": "shell",
    "hole": "hole",
    "cborehole": "cboreHole",
    "cskhole": "cskHole",
    "union": "union",
    "cut": "cut",
    "intersect": "intersect",
    "text": "text",
}


def list_operations(script: str) -> Dict[str, Any]:
    """Static-parse ``script`` and return parameter + operation metadata.

    Wire result::

        {
          "parameters": [{"name": str, "value": ..., "kind": "number|boolean|string"}, ...],
          "operations": [{"index": int, "kind": str, "line": int, "summary": str}, ...],
          "parseError": {"line": int, "message": str}   # only on syntax error
        }

    Does NOT execute the script. Walks the ``ast`` to find method-call sites
    whose method names match the MVP operation list, plus top-level
    ``Name = <constant>`` assignments that the renderer surfaces as build
    parameters.
    """
    try:
        tree = ast.parse(script, filename="<cad_script>", mode="exec")
    except SyntaxError as exc:
        return {
            "parameters": [],
            "operations": [],
            "parseError": {
                "line": int(exc.lineno or 0),
                "message": exc.msg,
            },
        }

    parameters = _extract_parameters(tree)
    operations = _extract_operations(tree)
    return {"parameters": parameters, "operations": operations}


def _extract_parameters(tree: ast.AST) -> List[Dict[str, Any]]:
    """Find top-level ``name = <literal>`` assignments.

    Only literal numbers / booleans / strings count — anything else (a
    CadQuery call, an attribute access, etc.) is not a build parameter from
    the renderer's perspective. Order preserved by source position.
    """
    params: List[Dict[str, Any]] = []
    if not isinstance(tree, ast.Module):
        return params
    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue
        if len(node.targets) != 1:
            continue
        target = node.targets[0]
        if not isinstance(target, ast.Name):
            continue

        value = node.value
        # bool is a subclass of int; check bool first so True/False classify
        # as 'boolean' not 'number'.
        kind: Optional[str] = None
        py_value: Any = None
        if isinstance(value, ast.Constant):
            v = value.value
            if isinstance(v, bool):
                kind = "boolean"
                py_value = v
            elif isinstance(v, (int, float)):
                kind = "number"
                py_value = float(v) if isinstance(v, float) else int(v)
            elif isinstance(v, str):
                kind = "string"
                py_value = v
        elif isinstance(value, ast.UnaryOp) and isinstance(value.op, ast.USub):
            inner = value.operand
            if isinstance(inner, ast.Constant) and isinstance(inner.value, (int, float)) \
                    and not isinstance(inner.value, bool):
                kind = "number"
                py_value = -inner.value
        if kind is None:
            continue
        params.append({
            "name": target.id,
            "value": py_value,
            "kind": kind,
        })
    return params


def _extract_operations(tree: ast.AST) -> List[Dict[str, Any]]:
    """Walk every ``ast.Call`` and keep the ones whose method matches the MVP set.

    Output order matches **construction order** — i.e. the order a CAD user
    types the chain. For a single source line like
    ``cq.Workplane("XY").rect(50, 30).extrude(10).fillet(2.0)``, every Call
    node shares the same ``col_offset`` (the start of the chain) but has a
    monotonically-increasing ``end_col_offset`` (innermost ends first), so
    we sort by ``(line, end_col)`` to get ``Workplane → rect → extrude →
    fillet`` rather than the reverse.

    Each entry carries a one-line ``summary`` built from the call's
    keyword/positional args, suitable for the FeatureTree to display verbatim.
    """
    found: List[Tuple[Tuple[int, int], Dict[str, Any]]] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        method_name: Optional[str] = None
        if isinstance(func, ast.Attribute):
            method_name = func.attr
        elif isinstance(func, ast.Name):
            method_name = func.id
        if method_name is None:
            continue
        kind = _OPERATION_KINDS.get(method_name.lower())
        if kind is None:
            continue
        line = int(getattr(node, "lineno", 0) or 0)
        end_col = int(getattr(node, "end_col_offset", 0) or 0)
        summary = _summarize_call(method_name, node)
        found.append((
            (line, end_col),
            {"kind": kind, "line": line, "summary": summary},
        ))

    found.sort(key=lambda pair: pair[0])
    return [
        {"index": i, **payload}
        for i, (_pos, payload) in enumerate(found)
    ]


def _summarize_call(method_name: str, call: ast.Call) -> str:
    """Build a one-line summary like ``extrude(20)`` or ``rect(40, 30)``.

    Uses ``ast.unparse`` per argument (stdlib, Python ≥ 3.9). Wide-open
    expressions are truncated to keep the FeatureTree line manageable.
    """
    parts: List[str] = []
    for arg in call.args:
        parts.append(_short_unparse(arg))
    for kw in call.keywords:
        key = kw.arg or "**"
        parts.append(f"{key}={_short_unparse(kw.value)}")
    inside = ", ".join(parts)
    if len(inside) > 60:
        inside = inside[:57] + "..."
    return f"{method_name}({inside})"


def _short_unparse(node: ast.AST) -> str:
    try:
        text = ast.unparse(node)
    except Exception:  # noqa: BLE001 - ast.unparse can raise on exotic nodes
        text = "<expr>"
    text = text.strip().replace("\n", " ")
    if len(text) > 40:
        text = text[:37] + "..."
    return text


__all__ = [
    "BANNED_TOKENS",
    "execute_script",
    "export_by_handle",
    "list_operations",
    "scan_banned_tokens",
]
