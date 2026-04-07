"""
CLI entry point for the toolpath engine v2.

Matches the existing Unified Fab Studio IPC contract:
  python -m engines.cam.toolpath_engine <config.json>

Also supports standalone argparse CLI:
  python -m engines.cam.toolpath_engine --config config.json --strategy raster

Config JSON keys (matching existing pattern):
  stlPath, toolpathJsonPath, strategy, toolDiameterMm, feedMmMin,
  plungeMmMin, stepoverMm, zStepMm, safeZMm, etc.

Output: writes {"ok": true, "toolpathLines": [...], "strategy": "..."} to toolpathJsonPath
        prints one-line JSON summary to stdout
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any

from .logging_config import get_logger, configure_structlog

log = get_logger("toolpath_engine.main")


def _progress(phase: str, percent: int, message: str) -> None:
    """Emit a structured progress line to stdout for the Electron host to parse."""
    payload = {"phase": phase, "percent": percent, "message": message}
    sys.stdout.write(f"PROGRESS:{json.dumps(payload, ensure_ascii=False)}\n")
    sys.stdout.flush()


def _die(error: str, detail: str | None = None, code: int = 2) -> None:
    _progress("error", 0, error if detail is None else f"{error}: {detail}")
    payload: dict[str, Any] = {"ok": False, "error": error}
    if detail is not None:
        payload["detail"] = detail
    print(json.dumps(payload, ensure_ascii=False))
    sys.exit(code)


def _load_cfg_ipc() -> dict[str, Any]:
    """Load config from first positional arg (IPC mode)."""
    if len(sys.argv) < 2:
        return {}
    p = Path(sys.argv[1])
    if not p.suffix == ".json":
        return {}
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


def _parse_args() -> argparse.Namespace:
    """Parse CLI arguments for standalone mode."""
    parser = argparse.ArgumentParser(
        prog="toolpath_engine",
        description="Production-grade CNC toolpath generator",
    )
    parser.add_argument("config_path", nargs="?", help="Path to config JSON file")
    parser.add_argument("--config", "-c", help="Alternative config path flag")
    parser.add_argument("--strategy", "-s", help="Override strategy")
    parser.add_argument("--stl", help="Override STL path")
    parser.add_argument("--output", "-o", help="Override output path")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose logging")
    return parser.parse_args()


def main() -> None:
    t0 = time.monotonic()
    _progress("init", 0, "Initializing engine")

    # Determine if IPC mode (positional JSON arg) or CLI mode
    cfg: dict[str, Any] = {}
    args = _parse_args()

    if args.verbose:
        configure_structlog(verbose=True)

    config_path = args.config_path or args.config
    if config_path:
        p = Path(config_path)
        if not p.exists():
            _die("config_not_found", str(p), code=2)
        try:
            cfg = json.loads(p.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            _die("invalid_config_json", str(e), code=2)

    # CLI overrides
    if args.strategy:
        cfg["strategy"] = args.strategy
    if args.stl:
        cfg["stlPath"] = args.stl
    if args.output:
        cfg["toolpathJsonPath"] = args.output

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

    # Import engine modules (deferred to avoid startup errors)
    try:
        from .models import job_from_config, Strategy
        from .geometry import load_stl
        from .strategies import run_strategy, auto_select_and_run
        from .postprocessor import toolpath_to_ipc_lines
        from .simulator import simulate
        from .report import generate_report
    except ImportError as e:
        _die("import_error", str(e), code=2)

    # Parse job config
    try:
        job = job_from_config(cfg)
    except (ValueError, TypeError) as e:
        _die("invalid_config", str(e), code=2)

    errors = job.validate()
    if errors:
        _die("invalid_params", "; ".join(errors), code=2)

    # Load STL
    _progress("mesh_load", 10, "Loading STL mesh")
    try:
        mesh = load_stl(stl_path)
    except (ValueError, FileNotFoundError) as e:
        _die("stl_read_error", str(e), code=3)
    except Exception as e:
        _die("stl_read_error", str(e), code=3)

    if mesh.num_triangles == 0:
        _die("stl_read_error", "STL contains 0 triangles", code=3)

    log.info("stl_loaded", triangles=mesh.num_triangles,
             bounds_min=mesh.bounds.min_pt.as_tuple(),
             bounds_max=mesh.bounds.max_pt.as_tuple())

    _progress("heightfield", 30, "Building heightfield")

    # Auto-compute stock from mesh if not specified
    bounds = mesh.bounds
    if cfg.get("stockXMax") is None:
        job.stock.x_min = bounds.min_pt.x - 2.0
        job.stock.x_max = bounds.max_pt.x + 2.0
        job.stock.y_min = bounds.min_pt.y - 2.0
        job.stock.y_max = bounds.max_pt.y + 2.0
        job.stock.z_min = bounds.min_pt.z
        job.stock.z_max = bounds.max_pt.z + 2.0

    # Run strategy (auto-select if strategy is AUTO)
    _progress("toolpath", 50, f"Generating toolpath: {job.strategy.value}")
    log.info("strategy_start", strategy=job.strategy.value,
             tool_diameter=job.tool.diameter_mm, stepover=job.cuts.stepover_mm)
    try:
        if job.strategy == Strategy.AUTO:
            result = auto_select_and_run(job, mesh)
        else:
            result = run_strategy(job, mesh)
    except Exception as e:
        _die("strategy_error", f"{job.strategy.value}: {e}", code=3)

    log.info("strategy_complete", strategy=result.strategy,
             chains=len(result.chains), segments=result.total_segments,
             cut_distance_mm=round(result.cut_distance_mm, 1),
             elapsed_s=round(time.monotonic() - t0, 2))

    if not result.chains:
        _die("empty_toolpath", f"Strategy {job.strategy.value} produced no toolpath", code=4)

    # Safety simulation
    sim_report = None
    try:
        sim_report = simulate(result, job.machine, job.stock, job.cuts.safe_z_mm, job.tool)
        if not sim_report.is_safe:
            for issue in sim_report.issues:
                if issue.severity == "error":
                    result.warnings.append(f"SIMULATION: {issue.message}")
    except Exception:
        pass  # Simulation failure should not block output

    # Post-process to G-code lines
    _progress("post_process", 80, "Post-processing G-code")
    try:
        lines = toolpath_to_ipc_lines(result, job.tool, job.cuts)
    except Exception as e:
        _die("postprocess_error", str(e), code=3)

    if not lines:
        _die("empty_toolpath", "Post-processor produced no G-code lines", code=4)

    # Generate detailed machining report
    machining_report = None
    try:
        machining_report = generate_report(
            result, job,
            sim_report=sim_report,
            num_gcode_lines=len(lines),
        )
    except Exception:
        pass  # Report generation failure should not block output

    # Write output
    _progress("write", 90, "Writing output")
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
    if machining_report:
        payload["report"] = machining_report.to_dict()
    if result.warnings:
        payload["warnings"] = result.warnings

    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    _progress("complete", 100, "Done")

    # Print summary to stdout (IPC pattern)
    summary = {
        "ok": True,
        "lines": len(lines),
        "strategy": result.strategy,
        "elapsedS": round(elapsed, 2),
    }
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
