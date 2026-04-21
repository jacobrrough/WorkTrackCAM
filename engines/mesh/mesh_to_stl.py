#!/usr/bin/env python3
"""
Convert mesh files (OBJ, PLY, GLTF, GLB, 3MF, OFF, DAE, FBX, …) to binary STL via trimesh.

Usage:
    python mesh_to_stl.py <input_path> <output.stl>

Emits a single JSON object on stdout (last line must parse alone for Electron `runPythonJson`):
    {"ok": true, "vertices": N, "faces": M}
    {"ok": false, "error": "...", "detail": "..."}
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path


def _emit(ok: bool, **extra: object) -> None:
    payload: dict[str, object] = {"ok": ok}
    payload.update(extra)
    print(json.dumps(payload, ensure_ascii=False))
    sys.exit(0 if ok else 1)


def main() -> None:
    if len(sys.argv) < 3:
        _emit(False, error="usage", detail="mesh_to_stl.py <input_path> <output.stl>")

    in_path = Path(sys.argv[1]).resolve()
    out_path = Path(sys.argv[2]).resolve()

    if not in_path.is_file():
        _emit(False, error="input_missing", detail=str(in_path))
    try:
        if in_path.stat().st_size == 0:
            _emit(False, error="input_empty", detail=str(in_path))
    except OSError as e:
        _emit(False, error="input_stat_error", detail=str(e))

    try:
        import trimesh
    except ImportError:
        _emit(
            False,
            error="trimesh_not_installed",
            detail="pip install trimesh (see engines/requirements.txt)",
        )

    try:
        # force='mesh' avoids returning Scene for some loaders when a single mesh exists
        loaded = trimesh.load(str(in_path), force="mesh")
    except Exception as e:
        _emit(False, error="load_failed", detail=str(e))

    try:
        if isinstance(loaded, trimesh.Scene):
            mesh = loaded.dump(concatenate=True)
        else:
            mesh = loaded
    except Exception as e:
        _emit(False, error="scene_merge_failed", detail=str(e))

    if mesh is None or (hasattr(mesh, "is_empty") and mesh.is_empty):
        _emit(False, error="empty_mesh", detail=str(in_path))

    try:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        # Binary STL; merge vertices for smaller output where applicable
        mesh.export(str(out_path), file_type="stl")
    except Exception as e:
        _emit(False, error="export_failed", detail=str(e))

    try:
        v = int(len(mesh.vertices))
        f = int(len(mesh.faces))
    except Exception:
        v, f = 0, 0

    _emit(True, vertices=v, faces=f)


if __name__ == "__main__":
    # So runPythonJson can take the last non-empty line if other libs print warnings
    try:
        main()
    except Exception as e:
        print(json.dumps({"ok": False, "error": "unexpected", "detail": str(e)}, ensure_ascii=False))
        sys.exit(1)
