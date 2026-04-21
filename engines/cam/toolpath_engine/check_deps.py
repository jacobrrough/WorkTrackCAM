"""
Startup dependency checker for the WorkTrackCAM toolpath engine.

Detects required and optional Python packages, validates the Python version,
and emits a structured JSON report to stdout.

Usage (standalone check):
    python -m engines.cam.toolpath_engine.check_deps

Exit codes:
    0  All required dependencies present
    1  One or more required dependencies missing
"""
from __future__ import annotations

import json
import sys
from typing import Any


_MIN_PYTHON = (3, 9)


def _check_package(name: str) -> tuple[bool, str | None]:
    """Return (available, version_string_or_None)."""
    try:
        mod = __import__(name)
        version = getattr(mod, "__version__", None)
        return True, str(version) if version is not None else "unknown"
    except ImportError:
        return False, None


def _check_ocp_meta() -> tuple[bool, str | None]:
    """OCP (OpenCascade Python) — used by step_to_stl.py when CadQuery is absent."""
    import importlib.util

    spec = importlib.util.find_spec("OCP")
    if spec is None:
        return False, None
    return True, "installed"


def check_all() -> dict[str, Any]:
    """
    Check all runtime dependencies and return a structured report dict.

    The dict has:
        ok: bool                    True when all *required* deps are present
        python_ok: bool             True when Python version meets minimum
        python_version: str         e.g. "3.11.4"
        python_min: str             e.g. "3.9"
        required: list[DepStatus]   Core deps (numpy)
        optional: list[DepStatus]   Enhanced deps (structlog, opencamlib)
        missing_required: list[str] Names of absent required deps

    DepStatus dict: {name, available, version, note}
    """
    python_version = sys.version_info
    python_ok = python_version >= _MIN_PYTHON
    python_str = f"{python_version.major}.{python_version.minor}.{python_version.micro}"
    min_str = f"{_MIN_PYTHON[0]}.{_MIN_PYTHON[1]}"

    required: list[dict[str, Any]] = []
    optional: list[dict[str, Any]] = []

    # ── Required ────────────────────────────────────────────────────────
    numpy_ok, numpy_ver = _check_package("numpy")
    required.append({
        "name": "numpy",
        "available": numpy_ok,
        "version": numpy_ver,
        "note": (
            "Vectorized STL loading, drop-cutter heightfields, and surface "
            "analysis. Without numpy, the engine falls back to pure Python, "
            "which is 10-100x slower on large meshes."
        ),
    })

    # ── Optional ────────────────────────────────────────────────────────
    structlog_ok, structlog_ver = _check_package("structlog")
    optional.append({
        "name": "structlog",
        "available": structlog_ok,
        "version": structlog_ver,
        "note": (
            "Structured JSON log output for the engine and IPC layer. "
            "Without structlog, the engine uses stdlib logging with "
            "plain-text stderr output."
        ),
    })

    ocl_ok, ocl_ver = _check_package("ocl")
    optional.append({
        "name": "opencamlib (ocl)",
        "available": ocl_ok,
        "version": ocl_ver,
        "note": (
            "High-performance C++ drop-cutter via OpenCAMLib. "
            "Required for ocl_toolpath.py (waterline/adaptive_waterline/raster "
            "using the OCL backend). The toolpath_engine uses its own pure-Python "
            "drop-cutter and does not require OpenCAMLib."
        ),
    })

    trimesh_ok, trimesh_ver = _check_package("trimesh")
    optional.append({
        "name": "trimesh",
        "available": trimesh_ok,
        "version": trimesh_ver,
        "note": (
            "Mesh import (OBJ, PLY, GLB, GLTF, 3MF, OFF, DAE, FBX, …) via "
            "engines/mesh/mesh_to_stl.py. Install: pip install trimesh"
        ),
    })

    cq_ok, cq_ver = _check_package("cadquery")
    optional.append({
        "name": "cadquery",
        "available": cq_ok,
        "version": cq_ver,
        "note": (
            "STEP/IGES tessellation through engines/occt/step_to_stl.py (preferred path). "
            "Install: pip install cadquery (or cadquery-ocp bundle)."
        ),
    })

    ocp_ok, ocp_ver = _check_ocp_meta()
    optional.append({
        "name": "OCP",
        "available": ocp_ok,
        "version": ocp_ver,
        "note": (
            "OpenCascade Python bindings — fallback in step_to_stl.py when CadQuery "
            "is not installed. Often provided with cadquery-ocp."
        ),
    })

    missing_required = [r["name"] for r in required if not r["available"]]

    return {
        "ok": python_ok and len(missing_required) == 0,
        "python_ok": python_ok,
        "python_version": python_str,
        "python_min": min_str,
        "required": required,
        "optional": optional,
        "missing_required": missing_required,
    }


def main() -> None:
    report = check_all()
    print(json.dumps(report, indent=2, ensure_ascii=False))
    if not report["ok"]:
        if not report["python_ok"]:
            print(
                f"ERROR: Python {report['python_min']}+ required, "
                f"got {report['python_version']}",
                file=sys.stderr,
            )
        for name in report["missing_required"]:
            print(
                f"ERROR: Required package '{name}' is not installed. "
                f"Run: pip install {name}",
                file=sys.stderr,
            )
        sys.exit(1)


if __name__ == "__main__":
    main()
