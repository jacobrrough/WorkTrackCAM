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


# ── Sandboxed import ─────────────────────────────────────────────────────
#
# CadQuery 2.x performs dynamic imports while *building geometry* at exec time
# (the body construction calls ``__import__``), so the exec namespace must
# expose ``__import__`` or every non-trivial script aborts with
# "ImportError: __import__ not found". We restore it through a guard that
# denies the filesystem / network / process module roots. Keying on the
# *resolved root module name* (not a substring) makes this strictly stronger
# than the prior "no __import__" state: it also catches whitespace-obfuscated
# escapes such as ``import   os`` that ``scan_banned_tokens`` (a naive substring
# scan) would miss. Security still rests primarily on that pre-scan; this is
# defense-in-depth for a single trusted operator running their own scripts.
_BLOCKED_IMPORT_ROOTS: frozenset = frozenset(
    {
        "os",
        "sys",
        "subprocess",
        "socket",
        "shutil",
        "pathlib",
        "importlib",
        "ctypes",
        "multiprocessing",
        "threading",
        "asyncio",
        "http",
        "urllib",
        "requests",
    }
)


def _sandboxed_import(
    name: str,
    globals: Any = None,  # noqa: A002 - matches the __import__ signature
    locals: Any = None,  # noqa: A002 - matches the __import__ signature
    fromlist: Sequence[str] = (),
    level: int = 0,
) -> Any:
    """Restricted ``__import__`` installed into the CAD exec sandbox.

    Allows CadQuery's runtime imports (and a script's own ``import cadquery as
    cq`` / ``import math``) while blocking the dangerous module roots in
    :data:`_BLOCKED_IMPORT_ROOTS`. Runs in module scope, so the bare
    ``__import__`` below resolves to the real builtin (no recursion).
    """
    root = (name or "").split(".", 1)[0]
    if root in _BLOCKED_IMPORT_ROOTS:
        raise ImportError(f"import of {name!r} is blocked in CAD scripts")
    return __import__(name, globals, locals, fromlist, level)


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
    # Restore a *guarded* __import__ so CadQuery's runtime geometry construction
    # works (it aborts with "ImportError: __import__ not found" otherwise). The
    # guard blocks dangerous module roots; the static scan above is the primary
    # boundary. "__import__" itself stays a BANNED_TOKEN so a script can't call
    # it by name -- only `import x` statements reach this, and dangerous ones are
    # already rejected by scan_banned_tokens / blocked here by root name.
    namespace["__builtins__"]["__import__"] = _sandboxed_import

    # Parse to an AST so build-parameter overrides can be applied cqgi-style
    # (below) before compiling. Equivalent to ``compile(script, ...)`` when
    # there are no overrides.
    try:
        tree = ast.parse(script, "<cad_script>", "exec")
    except SyntaxError as exc:
        raise _CadHandlerError(
            "script_exec_error",
            f"script syntax error on line {exc.lineno}: {exc.msg}",
            detail=str(exc),
        ) from exc

    if build_parameters:
        validated: Dict[str, Any] = {}
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
            validated[k] = v
        # cqgi-style override: a script declares a parameter as a bare top-level
        # default (``L = 10``). Pre-seeding ``namespace[k]`` is NOT enough — the
        # script's own ``L = 10`` runs during exec and clobbers it. So replace
        # the default LITERAL in the AST for each overridden top-level
        # ``<name> = <literal>``. Parameters with no matching top-level
        # assignment fall back to namespace injection (a script that reads an
        # undeclared name still gets the override).
        substituted = set()
        for node in tree.body:
            if (
                isinstance(node, ast.Assign)
                and len(node.targets) == 1
                and isinstance(node.targets[0], ast.Name)
                and node.targets[0].id in validated
            ):
                name = node.targets[0].id
                node.value = ast.copy_location(
                    ast.Constant(validated[name]), node.value
                )
                substituted.add(name)
        for k, v in validated.items():
            if k not in substituted:
                namespace[k] = v
        ast.fix_missing_locations(tree)

    compiled = compile(tree, "<cad_script>", "exec")

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
    #
    # In addition we ALSO build a face-tagged tessellation (``faceMap``) per
    # body so the renderer can map mesh triangles back to CadQuery faces for
    # the CAD V1 selection foundation. The faceMap is small (10s-100s of
    # entries even on complex parts) and the per-face tessellation cost is
    # the same total work — we just call BRepMesh on each face individually
    # instead of on the whole solid in one shot.
    meshes_out: List[Dict[str, Any]] = []
    face_count_total = 0
    stl_dir = Path(tempfile.gettempdir()) / "worktrackcam-cad-scripts"
    for body, _label in bodies:
        handle, mesh_payload = _tessellate_and_register(
            body, tolerance_mm=0.1, stl_dir=stl_dir
        )
        # Best-effort: a face-tagged tessellation failure must not break the
        # STL path that downstream CAM strategies depend on. The renderer's
        # 3D viewport falls back to the STL mesh without selection support.
        face_tagged = _tessellate_with_face_ids_for_handle(
            handle, tolerance_mm=0.1
        )
        mesh_entry: Dict[str, Any] = {"handle": handle, **mesh_payload}
        if face_tagged is not None:
            mesh_entry["faceMap"] = face_tagged["faceMap"]
            mesh_entry["faceIds"] = face_tagged["faceIds"]
            # FG-5b: also embed the edge map so the renderer can wire picked-edge
            # selection immediately without a second cad.tessellate_with_ids
            # round trip. Best-effort: absent when face-tagging failed (above).
            mesh_entry["edgeMap"] = face_tagged.get("edgeMap", {})
        meshes_out.append(mesh_entry)
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


# ── Face-tagged tessellation (CAD V1 selection foundation) ──────────────
#
# These helpers walk ``solid.Faces()`` and tessellate each face independently
# so every output triangle carries the face index that produced it. The
# renderer maps mouse-ray hits to mesh triangles and then to CadQuery faces
# via the parallel ``faceIds`` array; ``faceMap`` carries per-face metadata
# (kind, OCCT hash, area) for the inspector pane.
#
# Memory profile: a typical part has 10s-100s of faces and 1k-100k triangles.
# The ``faceIds`` parallel array is ``triangleCount`` * 4 bytes (uint32) — a
# rounding error next to the vertex buffer.
#
# Stability: face ordering inside ``solid.Faces()`` is deterministic per OCCT
# build for a given construction history, so re-running the same script
# produces the same face IDs. The ``occtHash`` is OCCT's TopoDS hash code
# (``Shape.HashCode``) and gives a second stability axis that's resilient to
# minor reorderings of the face list across CadQuery versions.


def tessellate_with_face_ids(
    handle: str, *, tolerance_mm: float = 0.1
) -> Dict[str, Any]:
    """Build a face-tagged tessellation for the body behind ``handle``.

    Returns::

        {
          "vertices":      [x0,y0,z0, x1,y1,z1, ...]   # flat float list
          "indices":       [i0,i1,i2, i0,i1,i2, ...]   # flat int list
          "faceIds":       [0, 0, 1, 1, ...]           # length = triangleCount
          "triangleCount": int,
          "bbox":          {"min":[..3], "max":[..3]},
          "faceMap":       {
            "<faceId>": {
              "kind":     "face",
              "occtHash": int,     # session hash; 0 in the bundled OCP build
              "occtId":   str,     # STABLE geometry hash — the picked handle
              "area":     float,
            },
            ...
          },
          "edgeMap":       {       # FG-5b — parallel to faceMap, NO faceIds
            "<occtId>": {          # keyed by the STABLE edge id (not an index)
              "kind":     "edge",
              "occtId":   str,     # == the key; the picked-edge handle
              "occtHash": int,     # session hash; 0 in the bundled OCP build
              "length":   float,
            },
            ...
          },
        }

    The ``edgeMap`` is keyed by the STABLE per-edge id (``"e:<fnv>"``), NOT by a
    positional index, because edges have no per-triangle parallel array to map
    through (the mesh is face-tessellated). The renderer resolves a picked edge
    by matching the id it stored against ``edgeMap`` keys; the build resolver
    (:func:`resolve_picked_edges`) matches the same id against the rebuilt
    solid's edges. ``occtId`` is added to every ``faceMap`` entry as the stable
    FACE handle (``shell_inward.pickedFaceIds`` matches it). See the FG-5b
    helper block above for the stability limitation (topological naming).

    Raises ``_CadHandlerError`` with one of:
      * ``invalid_handle``      — handle missing from the table.
      * ``tessellation_error``  — CadQuery raised mid-tessellation.

    Notes
    -----
    * Each face is tessellated independently via ``face.tessellate(tol)``;
      vertex indices are remapped into the concatenated buffer.
    * Degenerate triangles are filtered the same way as
      ``cadquery_import._build_binary_stl`` (Safety Rule 1 parity — the STL
      and the face-tagged mesh have the same triangle count for the same
      tolerance, modulo per-face boundary stitching).
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
        faces = list(solid.Faces())
    except Exception as exc:  # noqa: BLE001 - CadQuery raises arbitrary types
        raise _CadHandlerError(
            "tessellation_error",
            f"CadQuery face enumeration failed: {exc}",
            detail=str(exc),
        ) from exc

    vertices_flat: List[float] = []
    indices_flat: List[int] = []
    face_ids: List[int] = []
    face_map: Dict[str, Dict[str, Any]] = {}

    for face_id, face in enumerate(faces):
        try:
            face_verts, face_tris = face.tessellate(float(tolerance_mm))
        except Exception as exc:  # noqa: BLE001 - skip a bad face, keep mesh
            # A single problem face shouldn't kill the whole tessellation;
            # record an empty entry and continue so the renderer can still
            # show the rest of the part. Selection on this face is impossible
            # but the operator still gets the geometry.
            face_map[str(face_id)] = {
                "kind": "face",
                "occtHash": 0,
                "area": 0.0,
                "error": f"tessellate failed: {exc}",
            }
            continue

        # Remap per-face vertex indices into the global buffer. We never
        # de-duplicate across faces because two adjacent faces legitimately
        # share an edge in 3-space but each has its own normal — keeping
        # them distinct preserves crease shading in the renderer.
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

        face_tri_count = 0
        for tri in face_tris:
            i0, i1, i2 = int(tri[0]), int(tri[1]), int(tri[2])
            if i0 == i1 or i1 == i2 or i0 == i2:
                continue  # degenerate
            if not (0 <= i0 < len(face_verts) and 0 <= i1 < len(face_verts)
                    and 0 <= i2 < len(face_verts)):
                continue  # out of range — guard against CadQuery edge cases
            indices_flat.append(base_index + i0)
            indices_flat.append(base_index + i1)
            indices_flat.append(base_index + i2)
            face_ids.append(face_id)
            face_tri_count += 1

        # Per-face metadata. ``Area()`` returns the parametric surface area in
        # mm². ``HashCode()`` on the underlying TopoDS_Face is OCCT's stable
        # hash — same shape, same construction history → same hash.
        face_map[str(face_id)] = {
            "kind": "face",
            "occtHash": _safe_face_hash(face),
            # FG-5b: STABLE geometry-derived handle (the int occtHash above is 0
            # in the bundled OCP build — see the helper block). This is what
            # shell_inward.pickedFaceIds matches against at build time.
            "occtId": _safe_face_geom_id(face),
            "area": _safe_face_area(face),
        }

    triangle_count = len(face_ids)
    bbox_min, bbox_max = doc.bbox_min, doc.bbox_max

    # FG-5b: build the edge map. Edges have no per-triangle parallel array (the
    # mesh is face-tessellated), so the edgeMap is keyed by the STABLE edge id
    # and carries only metadata. Best-effort: a failure to enumerate edges must
    # not break the face-tagged mesh the renderer already depends on.
    edge_map: Dict[str, Dict[str, Any]] = {}
    # FG-5 (viewport edge picking): a parallel list of per-edge sampled
    # POLYLINES so the renderer can render the wireframe AND raycast a click
    # near an edge back to its stable id. Each entry is {id, points:[[x,y,z],...]}
    # keyed by the SAME stable id (``e:<hex>``) the edge_map / resolver use, so a
    # picked polyline resolves to the exact OCCT edge at build time. Best-effort
    # and ADDITIVE: a failure to enumerate edges leaves both maps empty and the
    # renderer falls back to face-only picking (the STL/CAM path is untouched).
    edge_polylines: List[Dict[str, Any]] = []
    try:
        for edge in solid.Edges():
            eid = _safe_edge_geom_id(edge)
            # If two edges hash identically (rare geometric coincidence) keep the
            # first — the resolver applies the op to ALL geometric matches anyway.
            if eid not in edge_map:
                edge_map[eid] = {
                    "kind": "edge",
                    "occtId": eid,
                    "occtHash": _safe_edge_hash(edge),
                    "length": _safe_edge_length(edge),
                }
                pts = _safe_edge_polyline(edge, tolerance_mm=float(tolerance_mm))
                if len(pts) >= 2:
                    edge_polylines.append({"id": eid, "points": pts})
    except Exception:  # noqa: BLE001 - edge ids are non-critical metadata
        edge_map = {}
        edge_polylines = []

    return {
        "vertices": vertices_flat,
        "indices": indices_flat,
        "faceIds": face_ids,
        "triangleCount": triangle_count,
        "bbox": {"min": list(bbox_min), "max": list(bbox_max)},
        "faceMap": face_map,
        "edgeMap": edge_map,
        "edges": edge_polylines,
    }


def _tessellate_with_face_ids_for_handle(
    handle: str, *, tolerance_mm: float
) -> Optional[Dict[str, Any]]:
    """Best-effort wrapper for embedding a face-tagged tessellation alongside
    the STL path in ``execute_script``'s result.

    Returns ``None`` if ``tessellate_with_face_ids`` raised — the caller
    (``execute_script``) treats absence as "no selection info available"
    and the renderer falls back to picking on the whole solid. This is the
    right posture because the STL path is on the critical chain for CAM
    downstream and must NEVER be blocked by a selection-only failure.
    """
    try:
        return tessellate_with_face_ids(handle, tolerance_mm=tolerance_mm)
    except _CadHandlerError:
        return None
    except Exception:  # noqa: BLE001 - selection info is non-critical
        return None


def _safe_face_hash(face: Any) -> int:
    """Return OCCT's TopoDS hash code for ``face`` (or 0 on failure).

    CadQuery exposes the wrapped OCCT shape via ``.wrapped``. The OCP/PythonOCC
    binding provides ``HashCode(upper)`` on TopoDS_Shape. We pass a large
    upper bound (sys.maxsize is too big for the OCCT signed-int API on Linux)
    and fall back to 0 so a binding-version mismatch never kills the mesh.
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
    """Return ``face.Area()`` as a float, or 0.0 on failure.

    A zero area is a strong "this face has no material" signal that the UI
    can surface to the operator. We deliberately do NOT raise — the rest of
    the face map is still useful even if a single face has a wonky area.
    """
    try:
        return float(face.Area())
    except Exception:  # noqa: BLE001 - area is best-effort
        return 0.0


# ── FG-5b: stable geometry-derived ids + picked-id resolution ────────────
#
# The selection layer (``src/renderer/design/selection-state.ts``) and the
# fillet/chamfer/shell schema (``src/shared/part-features-schema.ts``
# ``pickedEdgeIds`` / ``pickedFaceIds``) need a topology handle that:
#
#   1. is the SAME for the same geometric edge/face across an independent
#      rebuild of the same script (so a picked id survives a parametric edit),
#      and
#   2. can be resolved back to the exact OCCT edge/face at build time.
#
# OCCT's ``TopoDS_Shape.HashCode`` is NOT usable here: in the bundled OCP build
# (OCCT 7.7+/8.x, cadquery 2.7.0) ``HashCode`` was REMOVED from the binding —
# ``hasattr(face.wrapped, "HashCode")`` is False, so the legacy
# ``_safe_face_hash`` returns 0 for every face in this environment, and the
# session-bound alternatives (``TopTools_ShapeMapHasher`` / Python ``hash`` on
# the wrapped shape) change on every rebuild (fresh pointers) and so fail
# requirement (1).
#
# So the stable handle is a **quantized-geometry FNV-1a hash**, the SAME
# technique ``engines/cad/cadquery_drawing_geometry.py`` uses for its stable 2D
# drawing ids. We hash the edge's (sorted endpoints + quantized length) or the
# face's (quantized centroid + area + outward normal). This is deterministic,
# orientation-independent, dependency-free, and — critically — survives a
# rebuild that reproduces the same geometry.
#
# Stability limitation (topological naming). A geometry hash is stable across a
# rebuild that REPRODUCES the same edge/face geometry. It is NOT stable across a
# parametric change that MOVES or RESIZES that topology (a 20 mm box edge and a
# 25 mm box edge hash differently), nor is it guaranteed unique if two distinct
# edges happen to share endpoints + length (rare on real parts; the resolver
# below handles a multi-match by applying the op to ALL matches, which for a
# genuine geometric coincidence is the right behaviour). This is the same
# fundamental limit every B-rep kernel hits without a full topological-naming
# graph; the schema doc and the FG-5b UI both flag it.

# FNV-1a 64-bit constants (same family as cadquery_drawing_geometry._fnv1a and
# the renderer's plate-thumbnail cache key — determinism, not crypto strength).
_GEOM_FNV_OFFSET = 0xCBF29CE484222325
_GEOM_FNV_PRIME = 0x100000001B3
_GEOM_FNV_MASK = 0xFFFFFFFFFFFFFFFF

# Decimal places coordinates/length/area are quantized to before hashing. 1e-3
# mm is finer than any CAD tolerance and absorbs float jitter (e.g. a centroid
# that lands at -3.5e-16 instead of 0.0) so the same feature keeps its id.
_GEOM_QUANT = 3


def _geom_q(value: float) -> float:
    """Quantize a coordinate/length to the id grid; fold -0.0 to 0.0."""
    try:
        r = round(float(value), _GEOM_QUANT)
    except Exception:  # noqa: BLE001 - non-numeric → 0.0 keeps the id stable
        return 0.0
    return 0.0 if r == 0.0 else r


def _geom_fnv1a(payload: str) -> str:
    """FNV-1a 64-bit hash of ``payload`` as a fixed-width hex string.

    Python's builtin ``hash`` is salted per process, so it is unusable for a
    stable cross-run id; this is the dependency-free deterministic alternative.
    """
    h = _GEOM_FNV_OFFSET
    for byte in payload.encode("utf-8"):
        h ^= byte
        h = (h * _GEOM_FNV_PRIME) & _GEOM_FNV_MASK
    return f"{h:016x}"


def _xyz_of(point: Any) -> Tuple[float, float, float]:
    """Best-effort (x, y, z) from a cadquery Vector / OCP point / tuple."""
    for ax in ("x", "y", "z"):
        if hasattr(point, ax):
            return (
                _geom_q(getattr(point, "x")),
                _geom_q(getattr(point, "y")),
                _geom_q(getattr(point, "z")),
            )
    if hasattr(point, "X") and hasattr(point, "Y") and hasattr(point, "Z"):
        return (_geom_q(point.X()), _geom_q(point.Y()), _geom_q(point.Z()))
    try:
        return (_geom_q(point[0]), _geom_q(point[1]), _geom_q(point[2]))
    except Exception:  # noqa: BLE001 - degenerate point → origin
        return (0.0, 0.0, 0.0)


def _safe_edge_geom_id(edge: Any) -> str:
    """Stable ``"e:"``-prefixed id for a cadquery ``Edge``.

    Keyed on the SORTED quantized endpoints (orientation-independent) + the
    quantized edge length. Returns ``"e:degenerate"`` if the geometry can't be
    read (the resolver then simply never matches it — safe).
    """
    try:
        verts = list(edge.Vertices())
        ends = sorted(
            (_geom_q(v.X), _geom_q(v.Y), _geom_q(v.Z))
            if hasattr(v, "X")
            else _xyz_of(v)
            for v in verts
        )
        length = _geom_q(edge.Length())
        # A closed circle has no distinct endpoints; fold in the center so two
        # concentric circles of different radius still separate (length differs
        # too, but the center makes coincident-length cases robust).
        center = _xyz_of(edge.Center())
        payload = f"E|len{length:.3f}|c{center[0]:.3f},{center[1]:.3f},{center[2]:.3f}|"
        payload += "|".join(f"{p[0]:.3f},{p[1]:.3f},{p[2]:.3f}" for p in ends)
        return "e:" + _geom_fnv1a(payload)
    except Exception:  # noqa: BLE001 - unreadable edge → never-matching id
        return "e:degenerate"


def _safe_face_geom_id(face: Any) -> str:
    """Stable ``"f:"``-prefixed id for a cadquery ``Face``.

    Keyed on the quantized centroid + quantized area + quantized outward normal
    (so two coplanar faces with the same centroid but opposite normals — e.g.
    the two caps of a zero-thickness sliver — still separate). Returns
    ``"f:degenerate"`` on read failure (resolver never matches it — safe).
    """
    try:
        center = _xyz_of(face.Center())
        area = _geom_q(face.Area())
        try:
            nrm = face.normalAt()
            normal = _xyz_of(nrm)
        except Exception:  # noqa: BLE001 - normal optional; centroid+area alone
            normal = (0.0, 0.0, 0.0)
        payload = (
            f"F|c{center[0]:.3f},{center[1]:.3f},{center[2]:.3f}"
            f"|a{area:.3f}"
            f"|n{normal[0]:.3f},{normal[1]:.3f},{normal[2]:.3f}"
        )
        return "f:" + _geom_fnv1a(payload)
    except Exception:  # noqa: BLE001 - unreadable face → never-matching id
        return "f:degenerate"


def _safe_edge_hash(edge: Any) -> int:
    """Session OCCT hash for an edge (``occtHash`` int field), or 0.

    Parallels :func:`_safe_face_hash`. In the bundled OCP build ``HashCode`` is
    gone from the edge binding, so this returns 0 there (the STABLE handle is
    :func:`_safe_edge_geom_id`, not this). Kept so the ``edgeMap`` entry shape
    mirrors ``faceMap`` and so a future binding that restores ``HashCode`` lights
    up automatically.
    """
    try:
        wrapped = edge.wrapped
    except Exception:  # noqa: BLE001 - fall through
        return 0
    if wrapped is None:
        return 0
    hash_code = getattr(wrapped, "HashCode", None)
    if callable(hash_code):
        for upper in (2_147_483_647, 1_000_000_000, 1_000_000):
            try:
                h = hash_code(upper)
                return int(h) if h is not None else 0
            except Exception:  # noqa: BLE001 - try next bound
                continue
    return 0


def _safe_edge_length(edge: Any) -> float:
    """Return ``edge.Length()`` as a float, or 0.0 on failure (best-effort)."""
    try:
        return float(edge.Length())
    except Exception:  # noqa: BLE001 - length is best-effort metadata
        return 0.0


# ── FG-5: per-edge polyline sampling (viewport edge picking) ─────────────────
#
# The mesh is FACE-tessellated, so an edge has no per-triangle parallel array the
# renderer can ray-pick through. Instead we emit a sampled POLYLINE per edge: a
# short ordered list of 3D points the renderer turns into pickable LineSegments
# (carrying the stable edge id in userData). A click near one of those segments
# resolves to the edge id — which the kernel then resolves back to the exact OCCT
# edge for ``fillet_select`` / ``chamfer_select`` ``pickedEdgeIds`` targeting.
#
# Why ``positionAt`` and not ``Edge.tessellate``? In the bundled OCP/cadquery
# build ``Edge.tessellate(tol)`` returns empty point lists (it is wired for faces),
# so we sample the curve parametrically via ``positionAt(t)`` (t in [0, 1]). A
# straight edge (geomType "LINE") needs only its two endpoints; a curved edge is
# sampled at a density that keeps the chord deviation under ``tolerance_mm`` —
# computed from the radius when available, otherwise a fixed fallback. The point
# count is bounded so a pathological edge can never explode the wire payload.

# Max sampled points per edge. A circle at 0.1 mm tolerance on a large radius is
# the worst realistic case; 128 keeps the wire compact while staying smooth.
_EDGE_POLYLINE_MAX_POINTS = 128
# Min samples for any curved edge (so a tiny arc still reads as a curve, not a chord).
_EDGE_POLYLINE_MIN_CURVED = 8


def _edge_is_straight(edge: Any) -> bool:
    """True when the edge is a straight line (only endpoints are needed).

    Prefers ``geomType()`` ("LINE"); falls back to a 3-point colinearity test so an
    edge whose geomType is unavailable still classifies correctly. Defaults to
    False (treat as curved → sample more densely) on any read failure — denser
    sampling is always visually safe, just slightly larger.
    """
    try:
        gt = edge.geomType()
        if isinstance(gt, str):
            return gt.upper() == "LINE"
    except Exception:  # noqa: BLE001 - fall through to the geometric test
        pass
    try:
        a = edge.positionAt(0.0)
        m = edge.positionAt(0.5)
        b = edge.positionAt(1.0)
        # Colinear if the mid point lies on the chord a→b (cross product ~0).
        ab = (b.x - a.x, b.y - a.y, b.z - a.z)
        am = (m.x - a.x, m.y - a.y, m.z - a.z)
        cx = ab[1] * am[2] - ab[2] * am[1]
        cy = ab[2] * am[0] - ab[0] * am[2]
        cz = ab[0] * am[1] - ab[1] * am[0]
        return (cx * cx + cy * cy + cz * cz) <= 1e-12
    except Exception:  # noqa: BLE001 - unreadable → treat as curved (safe)
        return False


def _edge_sample_count(edge: Any, tolerance_mm: float) -> int:
    """How many points to sample along a CURVED edge to stay within tolerance.

    Uses the chord-deviation bound for a circular arc: for a subtended angle dθ on
    radius r, the sagitta is r·(1 − cos(dθ/2)). Solving for dθ at the target
    deviation gives the segment count = ceil(total_angle / dθ). We estimate the
    radius from length when ``radius()`` is not exposed (closed circle: r ≈ L/2π).
    Bounded by [_EDGE_POLYLINE_MIN_CURVED, _EDGE_POLYLINE_MAX_POINTS].
    """
    try:
        length = float(edge.Length())
    except Exception:  # noqa: BLE001
        return _EDGE_POLYLINE_MIN_CURVED
    if not math.isfinite(length) or length <= 0:
        return _EDGE_POLYLINE_MIN_CURVED
    radius = None
    try:
        r = edge.radius()
        if math.isfinite(float(r)) and float(r) > 0:
            radius = float(r)
    except Exception:  # noqa: BLE001 - radius() not exposed for every curve
        radius = None
    if radius is None:
        # Fall back to the full-circle estimate; for an arc this over-samples
        # slightly (more points than strictly needed), which is visually safe.
        radius = length / (2.0 * math.pi)
    if radius <= 0:
        return _EDGE_POLYLINE_MIN_CURVED
    tol = max(1e-4, float(tolerance_mm))
    if tol >= radius:
        return _EDGE_POLYLINE_MIN_CURVED
    # Max angle per segment so the sagitta r(1−cos(dθ/2)) ≈ tol.
    d_theta = 2.0 * math.acos(max(-1.0, min(1.0, 1.0 - tol / radius)))
    if d_theta <= 1e-6:
        return _EDGE_POLYLINE_MAX_POINTS
    total_angle = length / radius  # arc angle (radians)
    segments = int(math.ceil(total_angle / d_theta))
    count = segments + 1
    return max(_EDGE_POLYLINE_MIN_CURVED, min(_EDGE_POLYLINE_MAX_POINTS, count))


def _safe_edge_polyline(
    edge: Any, *, tolerance_mm: float = 0.1
) -> List[List[float]]:
    """Sample ``edge`` into an ordered ``[[x, y, z], ...]`` polyline (>= 2 points).

    Straight edges return their two endpoints; curved edges are sampled at a
    tolerance-driven density (see :func:`_edge_sample_count`). NEVER raises — an
    unreadable edge returns ``[]`` so the caller simply omits it from the wire
    (the renderer then can't pick that one edge, but the rest of the part is fine).
    """
    try:
        if _edge_is_straight(edge):
            ts = [0.0, 1.0]
        else:
            n = _edge_sample_count(edge, tolerance_mm)
            ts = [i / (n - 1) for i in range(n)] if n >= 2 else [0.0, 1.0]
        out: List[List[float]] = []
        for t in ts:
            pt = edge.positionAt(t)
            out.append([float(pt.x), float(pt.y), float(pt.z)])
        return out
    except Exception:  # noqa: BLE001 - unreadable edge → omit it (never crash)
        return []


def resolve_picked_edges(solid: Any, picked_ids: Any) -> Tuple[List[Any], List[str]]:
    """Resolve picked stable edge ids to actual cadquery ``Edge`` objects.

    Returns ``(matched_edges, unresolved_ids)``. ``matched_edges`` are the
    ``solid.Edges()`` whose :func:`_safe_edge_geom_id` is in ``picked_ids``
    (de-duplicated, order follows the solid's edge order for determinism).
    ``unresolved_ids`` are the requested ids with no matching edge — the caller
    falls back to the axis bucket for those and surfaces a non-fatal warning.

    NEVER raises and NEVER guesses: an id that doesn't match contributes
    nothing to ``matched_edges`` (so the op is applied to the wrong edge over
    our dead body — Safety Rule, the kernel is sacred).
    """
    wanted = _normalize_id_list(picked_ids)
    if not wanted:
        return [], []
    try:
        edges = list(solid.Edges())
    except Exception:  # noqa: BLE001 - no topology → everything unresolved
        return [], sorted(wanted)
    matched: List[Any] = []
    seen_ids: set = set()
    for edge in edges:
        eid = _safe_edge_geom_id(edge)
        if eid in wanted:
            matched.append(edge)
            seen_ids.add(eid)
    unresolved = sorted(wanted - seen_ids)
    return matched, unresolved


def resolve_picked_faces(solid: Any, picked_ids: Any) -> Tuple[List[Any], List[str]]:
    """Resolve picked stable face ids to actual cadquery ``Face`` objects.

    Mirror of :func:`resolve_picked_edges` for faces. Returns
    ``(matched_faces, unresolved_ids)``. Same never-raise, never-guess contract.
    """
    wanted = _normalize_id_list(picked_ids)
    if not wanted:
        return [], []
    try:
        faces = list(solid.Faces())
    except Exception:  # noqa: BLE001 - no topology → everything unresolved
        return [], sorted(wanted)
    matched: List[Any] = []
    seen_ids: set = set()
    for face in faces:
        fid = _safe_face_geom_id(face)
        if fid in wanted:
            matched.append(face)
            seen_ids.add(fid)
    unresolved = sorted(wanted - seen_ids)
    return matched, unresolved


def _normalize_id_list(picked_ids: Any) -> set:
    """Coerce a wire ``pickedEdgeIds`` / ``pickedFaceIds`` value to a string set.

    Accepts a list/tuple of strings (the schema shape); silently drops any
    non-string / empty entry so a malformed wire value degrades to "resolve
    what you can, fall back for the rest" rather than raising mid-build.
    """
    if not isinstance(picked_ids, (list, tuple, set)):
        return set()
    out: set = set()
    for entry in picked_ids:
        if isinstance(entry, str) and entry:
            out.add(entry)
    return out


# ── FG-5b: axis-bucket selectors (the fallback when no/unresolved picked id) ──
#
# These reproduce the axis-bucket targeting that the (schema-level)
# ``edgeDirection`` / ``openDirection`` fields name. An edge is "in" a bucket
# when its undirected tangent is parallel to that world axis (so ``+Z`` and
# ``-Z`` name the SAME set of vertical edges — an edge has no inherent sign);
# a face is the ``openDirection`` cap when its OUTWARD normal points along that
# SIGNED axis (here the sign matters: ``+Z`` is the top cap, ``-Z`` the bottom).
# This is the documented, working pre-FG-5b behaviour; the picked-id path layers
# on top of it and falls back to it.

_AXIS_VEC: Dict[str, Tuple[float, float, float]] = {
    "+X": (1.0, 0.0, 0.0),
    "-X": (-1.0, 0.0, 0.0),
    "+Y": (0.0, 1.0, 0.0),
    "-Y": (0.0, -1.0, 0.0),
    "+Z": (0.0, 0.0, 1.0),
    "-Z": (0.0, 0.0, -1.0),
}

# Cosine tolerance for "parallel to an axis". 0.999 ≈ 2.6° — tight enough that
# only genuinely axis-aligned box/prism edges qualify, loose enough to absorb
# tessellation/float noise.
_AXIS_PARALLEL_COS = 0.999


def _unit(vec: Tuple[float, float, float]) -> Optional[Tuple[float, float, float]]:
    mag = math.sqrt(vec[0] * vec[0] + vec[1] * vec[1] + vec[2] * vec[2])
    if mag <= 1e-9:
        return None
    return (vec[0] / mag, vec[1] / mag, vec[2] / mag)


def _edge_tangent(edge: Any) -> Optional[Tuple[float, float, float]]:
    """Undirected unit tangent of a (straight) edge from its endpoints.

    Curved edges return ``None`` (no single tangent → never in an axis bucket),
    which is the right behaviour: an axis bucket only ever meant straight edges.
    """
    try:
        verts = list(edge.Vertices())
        if len(verts) != 2:
            return None
        a, b = verts[0], verts[1]
        return _unit((b.X - a.X, b.Y - a.Y, b.Z - a.Z))
    except Exception:  # noqa: BLE001 - unreadable edge → not bucketable
        return None


def _edges_in_axis_bucket(solid: Any, edge_direction: str) -> List[Any]:
    """Edges whose undirected tangent is parallel to ``edge_direction``'s axis.

    ``+Z`` and ``-Z`` return the same set (edges are undirected). Returns [] for
    an unknown direction string or an unreadable solid.
    """
    axis = _AXIS_VEC.get(edge_direction)
    if axis is None:
        return []
    try:
        edges = list(solid.Edges())
    except Exception:  # noqa: BLE001
        return []
    out: List[Any] = []
    for edge in edges:
        tan = _edge_tangent(edge)
        if tan is None:
            continue
        # |dot| because the edge is undirected: parallel either way counts.
        dot = abs(tan[0] * axis[0] + tan[1] * axis[1] + tan[2] * axis[2])
        if dot >= _AXIS_PARALLEL_COS:
            out.append(edge)
    return out


def _faces_in_open_bucket(solid: Any, open_direction: str) -> List[Any]:
    """Faces whose OUTWARD normal points along the SIGNED ``open_direction``.

    Sign matters for a cap: ``+Z`` is the top face, ``-Z`` the bottom. Returns []
    for an unknown direction or unreadable solid.
    """
    axis = _AXIS_VEC.get(open_direction)
    if axis is None:
        return []
    try:
        faces = list(solid.Faces())
    except Exception:  # noqa: BLE001
        return []
    out: List[Any] = []
    for face in faces:
        try:
            nrm = face.normalAt()
            unit = _unit((nrm.x, nrm.y, nrm.z))
        except Exception:  # noqa: BLE001 - unreadable normal → skip
            continue
        if unit is None:
            continue
        dot = unit[0] * axis[0] + unit[1] * axis[1] + unit[2] * axis[2]
        if dot >= _AXIS_PARALLEL_COS:  # signed: must point the SAME way
            out.append(face)
    return out


# ── FG-5b: high-level op application (picked-id first, axis-bucket fallback) ──
#
# These are the canonical implementations the kernel build path calls for the
# ``fillet_select`` / ``chamfer_select`` / ``shell_inward`` ops. Each takes a
# cadquery ``Workplane`` (wrapping the current solid) plus the op dict and
# returns ``(new_workplane, warnings)``. The kernel is sacred: an op is NEVER
# applied to the wrong topology — a picked id that doesn't resolve contributes
# nothing and we fall back to the axis bucket with a non-fatal warning; if even
# the bucket is empty we return the solid UNCHANGED with a warning rather than
# raising (a no-op is always safer than a wrong cut).


def _warn(warnings: List[str], message: str) -> None:
    warnings.append(message)


def apply_fillet_select_op(
    workplane: Any, op: Dict[str, Any]
) -> Tuple[Any, List[str]]:
    """Apply a ``fillet_select`` op. Picked edge ids win; else the axis bucket.

    ``op`` keys: ``radiusMm`` (required), ``edgeDirection`` (axis-bucket
    fallback), ``pickedEdgeIds`` (optional list of stable edge ids).
    """
    warnings: List[str] = []
    radius = float(op.get("radiusMm", 0.0) or 0.0)
    if radius <= 0:
        _warn(warnings, "fillet_select skipped: radiusMm must be > 0")
        return workplane, warnings

    solid = workplane.findSolid()
    edges, source = _select_edges(solid, op, "fillet_select", warnings)
    if not edges:
        _warn(warnings, "fillet_select skipped: no edges to fillet (left solid unchanged)")
        return workplane, warnings

    try:
        result = workplane.newObject(edges).fillet(radius)
    except Exception as exc:  # noqa: BLE001 - OCC fillet can reject a radius
        _warn(
            warnings,
            f"fillet_select failed on {len(edges)} {source} edge(s): {exc} "
            "(left solid unchanged)",
        )
        return workplane, warnings
    return result, warnings


def apply_chamfer_select_op(
    workplane: Any, op: Dict[str, Any]
) -> Tuple[Any, List[str]]:
    """Apply a ``chamfer_select`` op. Picked edge ids win; else the axis bucket.

    ``op`` keys: ``lengthMm`` (required), ``edgeDirection`` (fallback),
    ``pickedEdgeIds`` (optional).
    """
    warnings: List[str] = []
    length = float(op.get("lengthMm", 0.0) or 0.0)
    if length <= 0:
        _warn(warnings, "chamfer_select skipped: lengthMm must be > 0")
        return workplane, warnings

    solid = workplane.findSolid()
    edges, source = _select_edges(solid, op, "chamfer_select", warnings)
    if not edges:
        _warn(warnings, "chamfer_select skipped: no edges to chamfer (left solid unchanged)")
        return workplane, warnings

    try:
        result = workplane.newObject(edges).chamfer(length)
    except Exception as exc:  # noqa: BLE001 - OCC chamfer can reject a length
        _warn(
            warnings,
            f"chamfer_select failed on {len(edges)} {source} edge(s): {exc} "
            "(left solid unchanged)",
        )
        return workplane, warnings
    return result, warnings


def apply_shell_inward_op(
    workplane: Any, op: Dict[str, Any]
) -> Tuple[Any, List[str]]:
    """Apply a ``shell_inward`` op. Picked face ids win; else the axis bucket.

    ``op`` keys: ``thicknessMm`` (required), ``openDirection`` (axis-bucket
    fallback, default ``+Z``), ``pickedFaceIds`` (optional list of stable face
    ids). The wall is hollowed INWARD (negative thickness to ``cq.shell``).
    """
    warnings: List[str] = []
    thickness = float(op.get("thicknessMm", 0.0) or 0.0)
    if thickness <= 0:
        _warn(warnings, "shell_inward skipped: thicknessMm must be > 0")
        return workplane, warnings

    solid = workplane.findSolid()
    faces, source = _select_faces(solid, op, warnings)
    if not faces:
        _warn(warnings, "shell_inward skipped: no open face resolved (left solid unchanged)")
        return workplane, warnings

    # Inward shell = negative thickness on the chosen open face(s).
    try:
        result = workplane.newObject(faces).shell(-thickness)
        return result, warnings
    except Exception as exc:  # noqa: BLE001 - OCC may reject the first cap
        _warn(
            warnings,
            f"shell_inward on {len(faces)} {source} face(s) rejected by OCC: {exc}",
        )

    # OCC rejected the chosen cap — try the OPPOSITE axis-bucket cap, matching
    # the documented "kernel tries the opposite cap if OCC rejects the first"
    # behaviour. Only meaningful for the axis-bucket path.
    open_dir = op.get("openDirection") or "+Z"
    opposite = _opposite_direction(open_dir)
    if opposite is not None:
        opp_faces = _faces_in_open_bucket(solid, opposite)
        if opp_faces:
            try:
                result = workplane.newObject(opp_faces).shell(-thickness)
                _warn(
                    warnings,
                    f"shell_inward fell back to the opposite cap {opposite}",
                )
                return result, warnings
            except Exception as exc:  # noqa: BLE001
                _warn(warnings, f"shell_inward opposite cap {opposite} also rejected: {exc}")

    _warn(warnings, "shell_inward skipped: OCC rejected every candidate cap (left solid unchanged)")
    return workplane, warnings


def _select_edges(
    solid: Any, op: Dict[str, Any], op_kind: str, warnings: List[str]
) -> Tuple[List[Any], str]:
    """Pick edges for a fillet/chamfer op: picked ids first, axis bucket else.

    Returns ``(edges, source)`` where ``source`` is ``"picked"`` or
    ``"axis-bucket"`` for the warning text. An UNRESOLVED picked id appends a
    non-fatal warning and the op falls back to the axis bucket for the whole op
    (we do NOT mix a partial picked set with the bucket — that would surprise
    the operator; an all-or-nothing fallback is predictable).
    """
    picked = op.get("pickedEdgeIds")
    if picked:
        matched, unresolved = resolve_picked_edges(solid, picked)
        if unresolved:
            _warn(
                warnings,
                f"{op_kind}: {len(unresolved)} picked edge id(s) did not resolve "
                f"against the rebuilt solid {sorted(unresolved)!r}; "
                "falling back to the axis bucket "
                "(topological-naming limit — the edge may have moved or been "
                "removed by an earlier op)",
            )
        elif matched:
            return matched, "picked"
        # If nothing matched at all we fall through to the bucket below.
    edge_direction = op.get("edgeDirection")
    if not isinstance(edge_direction, str):
        return [], "axis-bucket"
    return _edges_in_axis_bucket(solid, edge_direction), "axis-bucket"


def _select_faces(
    solid: Any, op: Dict[str, Any], warnings: List[str]
) -> Tuple[List[Any], str]:
    """Pick faces for a shell op: picked ids first, axis bucket else.

    Same all-or-nothing fallback contract as :func:`_select_edges`.
    """
    picked = op.get("pickedFaceIds")
    if picked:
        matched, unresolved = resolve_picked_faces(solid, picked)
        if unresolved:
            _warn(
                warnings,
                f"shell_inward: {len(unresolved)} picked face id(s) did not "
                f"resolve against the rebuilt solid {sorted(unresolved)!r}; "
                "falling back to the axis bucket (topological-naming limit)",
            )
        elif matched:
            return matched, "picked"
    open_dir = op.get("openDirection") or "+Z"
    if not isinstance(open_dir, str):
        open_dir = "+Z"
    return _faces_in_open_bucket(solid, open_dir), "axis-bucket"


def _opposite_direction(direction: str) -> Optional[str]:
    """Map ``+Z`` -> ``-Z`` etc. for the shell opposite-cap retry."""
    if not isinstance(direction, str) or len(direction) != 2:
        return None
    sign, axis = direction[0], direction[1]
    if sign == "+":
        return "-" + axis
    if sign == "-":
        return "+" + axis
    return None


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
    "tessellate_with_face_ids",
    # FG-5b: stable id derivation + picked-id → topology resolution
    "_safe_edge_geom_id",
    "_safe_face_geom_id",
    "_safe_edge_polyline",
    "resolve_picked_edges",
    "resolve_picked_faces",
    # FG-5b: build-time op application (picked-id first, axis-bucket fallback)
    "apply_fillet_select_op",
    "apply_chamfer_select_op",
    "apply_shell_inward_op",
]
