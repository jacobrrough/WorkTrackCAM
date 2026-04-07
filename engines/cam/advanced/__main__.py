"""
CLI entry point for the advanced toolpath engine.

Matches the existing Unified Fab Studio IPC contract:
  python -m engines.cam.advanced <config.json>

Config JSON keys (matching existing pattern):
  stlPath, toolpathJsonPath, strategy, toolDiameterMm, feedMmMin,
  plungeMmMin, stepoverMm, zStepMm, safeZMm, etc.

Output: writes {"ok": true, "toolpathLines": [...], "strategy": "..."} to toolpathJsonPath
        prints one-line JSON summary to stdout

Strategies: adaptive_clear, waterline, raster, pencil, rest
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from typing import Any


def _die(error: str, detail: str | None = None, code: int = 2) -> None:
    payload: dict[str, Any] = {"ok": False, "error": error}
    if detail is not None:
        payload["detail"] = detail
    print(json.dumps(payload, ensure_ascii=False))
    sys.exit(code)


def _load_cfg() -> dict[str, Any]:
    if len(sys.argv) < 2:
        _die("usage", "python -m engines.cam.advanced <config.json>", code=2)
    p = Path(sys.argv[1])
    try:
        raw = p.read_text(encoding="utf-8")
    except FileNotFoundError:
        _die("config_not_found", str(p), code=2)
    except OSError as e:
        _die("config_read_error", str(e), code=2)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        _die("invalid_config_json", f"{e.msg} at line {e.lineno} col {e.colno}", code=2)
    if not isinstance(data, dict):
        _die("invalid_config_shape", "root must be a JSON object", code=2)
    return data


def main() -> None:
    t0 = time.monotonic()

    cfg = _load_cfg()

    # Validate required keys
    stl_path_str = cfg.get("stlPath", "")
    out_json_str = cfg.get("toolpathJsonPath", "")
    if not stl_path_str:
        _die("config_missing_keys", "stlPath")
    if not out_json_str:
        _die("config_missing_keys", "toolpathJsonPath")

    stl_path = Path(str(stl_path_str))
    out_json = Path(str(out_json_str))

    if not stl_path.is_file():
        _die("stl_missing", str(stl_path), code=2)
    try:
        if stl_path.stat().st_size == 0:
            _die("stl_read_error", "STL file is empty (0 bytes)", code=3)
    except OSError as e:
        _die("stl_read_error", str(e), code=3)

    # Import engine modules (deferred to avoid import errors on startup)
    try:
        from .models import job_from_config
        from .geometry import load_stl
        from .strategies import run_strategy
        from .postprocessor import toolpath_to_ipc_lines
        from .simulator import simulate
    except ImportError as e:
        _die("import_error", str(e), code=2)

    # Parse job config
    try:
        job = job_from_config(cfg)
    except (ValueError, TypeError) as e:
        _die("invalid_config", str(e), code=2)

    # Validate
    errors = job.validate()
    if errors:
        _die("invalid_params", "; ".join(errors), code=2)

    # Load STL
    try:
        mesh = load_stl(stl_path)
    except ValueError as e:
        _die("stl_read_error", str(e), code=3)
    except Exception as e:
        _die("stl_read_error", str(e), code=3)

    if mesh.num_triangles == 0:
        _die("stl_read_error", "STL contains 0 triangles", code=3)

    # Auto-compute stock from mesh if not specified
    bounds = mesh.bounds
    if cfg.get("stockXMax") is None:
        job.stock.x_min = bounds.min_pt.x - 2.0
        job.stock.x_max = bounds.max_pt.x + 2.0
        job.stock.y_min = bounds.min_pt.y - 2.0
        job.stock.y_max = bounds.max_pt.y + 2.0
        job.stock.z_min = bounds.min_pt.z
        job.stock.z_max = bounds.max_pt.z + 2.0

    # Run strategy
    try:
        result = run_strategy(job, mesh)
    except Exception as e:
        _die("strategy_error", f"{job.strategy.value}: {e}", code=3)

    if not result.chains:
        _die("empty_toolpath", f"Strategy {job.strategy.value} produced no toolpath", code=4)

    # Run safety simulation
    try:
        sim_report = simulate(result, job.machine, job.stock, job.cuts.safe_z_mm)
        if not sim_report.is_safe:
            # Add warnings but don't fail — let the guardrails in cam-runner.ts handle it
            for issue in sim_report.issues:
                if issue.severity == "error":
                    result.warnings.append(f"SIMULATION: {issue.message}")
    except Exception:
        pass  # Simulation failure should not block toolpath output

    # Convert to G-code lines
    try:
        lines = toolpath_to_ipc_lines(result, job.tool, job.cuts)
    except Exception as e:
        _die("postprocess_error", str(e), code=3)

    if not lines:
        _die("empty_toolpath", "Post-processor produced no G-code lines", code=4)

    # Write output
    elapsed = time.monotonic() - t0
    payload: dict[str, Any] = {
        "ok": True,
        "toolpathLines": lines,
        "strategy": result.strategy,
        "stats": {
            "chains": len(result.chains),
            "lines": len(lines),
            "cutDistanceMm": round(result.cut_distance_mm, 1),
            "rapidDistanceMm": round(result.rapid_distance_mm, 1),
            "estimatedTimeS": round(result.estimated_time_s, 1),
            "elapsedS": round(elapsed, 2),
            "triangles": mesh.num_triangles,
        },
    }

    if result.warnings:
        payload["warnings"] = result.warnings

    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    # Print summary to stdout (matches existing IPC pattern)
    summary = {
        "ok": True,
        "lines": len(lines),
        "strategy": result.strategy,
        "elapsedS": round(elapsed, 2),
    }
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
