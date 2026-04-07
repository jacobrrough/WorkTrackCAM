"""
OpenCAMLib strategies for Unified Fab Studio (optional dependency).

Install: ``pip install opencamlib`` (wheels typically Python 3.7–3.11; other
versions may need a local build).

IPC contract (invoked by ``src/main/cam-runner.ts``)
----------------------------------------------------
- **argv**: ``python ocl_toolpath.py <config.json>``
- **cwd**: app root (Electron ``job.appRoot``); paths in JSON are absolute or
  cwd-relative as written by main.
- **config.json** (required keys): ``stlPath``, ``toolpathJsonPath``; optional:
  ``strategy`` (``waterline`` | ``adaptive_waterline`` | ``raster``), ``zPassMm``,
  ``stepoverMm``, ``toolDiameterMm``, ``safeZMm``, ``feedMmMin``,
  ``plungeMmMin``.
- **Success**: exit 0; write ``toolpathJsonPath`` with
  ``{"ok": true, "toolpathLines": [...], "strategy": ...}``; print a one-line
  JSON summary to stdout.
- **Failure**: non-zero exit; print a one-line JSON object with ``error`` and
  optional ``detail`` (main greps stdout for known ``error`` codes when
  falling back to the built-in parallel finish). Includes ``invalid_numeric_params``
  when feeds, tool diameter, stepover, or (for waterline) ``zPassMm`` are non-finite
  or out of range. ``stl_read_error`` when the STL path exists but OpenCAMLib cannot
  load it (corrupt file, unsupported variant, etc.).
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path
from typing import Any

REQUIRED_CFG_KEYS = ("stlPath", "toolpathJsonPath")
ALLOWED_STRATEGIES = frozenset({"waterline", "adaptive_waterline", "raster"})


def _die(error: str, detail: str | None = None, code: int = 2) -> None:
    """Print a single JSON line and exit (stderr is unused for machine-parseable errors)."""
    payload: dict[str, Any] = {"ok": False, "error": error}
    if detail is not None:
        payload["detail"] = detail
    print(json.dumps(payload, ensure_ascii=False))
    sys.exit(code)


def _load_cfg() -> dict[str, Any]:
    """Load and parse ``argv[1]`` as UTF-8 JSON. Never raises for I/O or JSON."""
    if len(sys.argv) < 2:
        _die("usage", "ocl_toolpath.py <config.json>", code=2)
    p = Path(sys.argv[1])
    try:
        raw = p.read_text(encoding="utf-8")
    except FileNotFoundError:
        _die("config_not_found", str(p), code=2)
    except OSError as e:
        _die("config_read_error", str(e), code=2)
    except UnicodeDecodeError as e:
        _die("config_not_utf8", str(e), code=2)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        _die("invalid_config_json", f"{e.msg} at line {e.lineno} col {e.colno}", code=2)
    if not isinstance(data, dict):
        _die("invalid_config_shape", "root must be a JSON object", code=2)
    return data


def _coerce_strategy(cfg: dict[str, Any]) -> str:
    """Default missing or JSON-null ``strategy`` to ``waterline``."""
    s = cfg.get("strategy", "waterline")
    return "waterline" if s is None else str(s)


def _validate_cfg(cfg: dict[str, Any]) -> None:
    missing = [k for k in REQUIRED_CFG_KEYS if k not in cfg or cfg[k] in (None, "")]
    if missing:
        _die("config_missing_keys", ",".join(missing), code=2)
    strategy = _coerce_strategy(cfg)
    if strategy not in ALLOWED_STRATEGIES:
        _die(
            "invalid_strategy",
            f"must be one of {sorted(ALLOWED_STRATEGIES)}, got {strategy!r}",
            code=2,
        )


def _float_param(cfg: dict[str, Any], key: str, default: float) -> float:
    """Parse optional float from config; missing or JSON-null uses ``default``."""
    if key not in cfg or cfg[key] is None:
        v = default
    else:
        try:
            v = float(cfg[key])
        except (TypeError, ValueError):
            _die("invalid_numeric_params", f"{key} must be a finite number", code=2)
    if not math.isfinite(v):
        _die("invalid_numeric_params", f"{key} must be finite", code=2)
    return v


def _parse_cam_numeric_params(cfg: dict[str, Any], strategy: str) -> dict[str, float]:
    """
    Validate feeds, tool size, and step distances before loading STL / OCL.

    ``safeZMm`` may be any finite value (job coordinates); cutting params must be positive.
    """
    z_pass = _float_param(cfg, "zPassMm", 1.0)
    stepover = _float_param(cfg, "stepoverMm", 1.0)
    tool_d = _float_param(cfg, "toolDiameterMm", 6.0)
    safe_z = _float_param(cfg, "safeZMm", 10.0)
    feed = _float_param(cfg, "feedMmMin", 1000.0)
    plunge = _float_param(cfg, "plungeMmMin", 400.0)

    if tool_d <= 0:
        _die("invalid_numeric_params", "toolDiameterMm must be > 0", code=2)
    if feed <= 0:
        _die("invalid_numeric_params", "feedMmMin must be > 0", code=2)
    if plunge <= 0:
        _die("invalid_numeric_params", "plungeMmMin must be > 0", code=2)
    if stepover <= 0:
        _die("invalid_numeric_params", "stepoverMm must be > 0", code=2)
    if strategy in ("waterline", "adaptive_waterline") and z_pass <= 0:
        _die("invalid_numeric_params", "zPassMm must be > 0 for waterline strategies", code=2)

    # Clamp stepover vs tool Ø: > Ø skips stock; tiny values explode path length (HSM uses bounded radial engagement).
    _min_s = max(0.01, tool_d * 0.02)
    _max_s = tool_d * 0.98
    if stepover < _min_s:
        stepover = _min_s
    elif stepover > _max_s:
        stepover = _max_s

    return {
        "zPassMm": z_pass,
        "stepoverMm": stepover,
        "toolDiameterMm": tool_d,
        "safeZMm": safe_z,
        "feedMmMin": feed,
        "plungeMmMin": plunge,
    }


def _stlsurf_from_file(filepath: Path):
    """Build an OCL ``STLSurf`` from a binary/ASCII STL file on disk."""
    import ocl  # noqa: PLC0415 — optional dependency

    s = ocl.STLSurf()
    ocl.STLReader(str(filepath), s)
    return s


def _cutter(ocl, tool_diameter: float):
    """Cylindrical cutter: diameter clamped; length scales mildly with diameter."""
    d = max(0.1, float(tool_diameter))
    length = max(20.0, d * 4.0)
    return ocl.CylCutter(d, length)


def _make_waterline(ocl, strategy: str):
    """
    Instantiate Waterline or AdaptiveWaterline per strategy.

    Returns ``(waterline_object, description_tag)`` for comment lines.
    If AdaptiveWaterline is missing in this OCL build, falls back to Waterline.
    """
    if strategy == "adaptive_waterline":
        try:
            return ocl.AdaptiveWaterline(), "adaptive waterline"
        except AttributeError:
            return ocl.Waterline(), "waterline (AdaptiveWaterline unavailable in this ocl build)"
    return ocl.Waterline(), "waterline"


def _loops_to_lines(
    loops,
    *,
    safe_z: float,
    feed: float,
    plunge: float,
) -> list[str]:
    """Turn OCL loop point lists into G0/G1 strings (mm, three decimals)."""
    lines: list[str] = []
    for loop in loops:
        if not loop:
            continue
        n = len(loop)
        first = loop[0]
        lines.append(f"G0 Z{safe_z:.3f}")
        lines.append(f"G0 X{first.x:.3f} Y{first.y:.3f}")
        lines.append(f"G1 Z{first.z:.3f} F{plunge:.0f}")
        for i in range(1, n):
            p = loop[i]
            lines.append(f"G1 X{p.x:.3f} Y{p.y:.3f} Z{p.z:.3f} F{feed:.0f}")
    return lines


def _path_append_xy_line(path, ocl_mod, xa: float, ya: float, xb: float, yb: float) -> None:
    """Append one horizontal scan span to an OCL ``Path`` (API differs slightly by build)."""
    p1 = ocl_mod.Point(float(xa), float(ya), 0.0)
    p2 = ocl_mod.Point(float(xb), float(yb), 0.0)
    ln = ocl_mod.Line(p1, p2)
    if hasattr(path, "append"):
        path.append(ln)
    elif hasattr(path, "addLine"):
        path.addLine(ln)
    else:
        raise RuntimeError("ocl_path_has_no_append_or_addLine")


def _clpoints_to_polyline(pts, *, safe_z: float, feed: float, plunge: float) -> list[str]:
    """Convert OCL CL-point list to G0/G1 strings."""
    lines: list[str] = []
    if not pts:
        return lines
    try:
        n = len(pts)
    except TypeError:
        return lines
    for i in range(n):
        p = pts[i]
        x, y, z = float(p.x), float(p.y), float(p.z)
        if i == 0:
            lines.append(f"G0 Z{safe_z:.3f}")
            lines.append(f"G0 X{x:.3f} Y{y:.3f}")
            lines.append(f"G1 Z{z:.3f} F{plunge:.0f}")
        else:
            lines.append(f"G1 X{x:.3f} Y{y:.3f} Z{z:.3f} F{feed:.0f}")
    return lines


def _run_raster_pathdrop(
    ocl,
    stl,
    *,
    stepover_mm: float,
    sampling_mm: float,
    tool_diameter_mm: float,
    safe_z_mm: float,
    feed_mm_min: float,
    plunge_mm_min: float,
) -> list[str]:
    """
    XY zigzag raster: PathDropCutter along horizontal lines, Y stepped by ``stepover_mm``.
    ``setZ`` is a floor below the model so the cutter can lift to the surface.
    """
    bounds = stl.getBounds()
    minx, maxx, miny, maxy, minz, _maxz = (
        float(bounds[0]),
        float(bounds[1]),
        float(bounds[2]),
        float(bounds[3]),
        float(bounds[4]),
        float(bounds[5]),
    )
    step = max(0.05, float(stepover_mm))
    sampling = max(0.05, min(float(sampling_mm), 5.0))
    cutter = _cutter(ocl, tool_diameter_mm)
    z_floor = float(minz) - 100.0

    pdc = ocl.PathDropCutter()
    pdc.setSTL(stl)
    pdc.setCutter(cutter)
    pdc.setSampling(sampling)
    pdc.setZ(z_floor)

    all_lines: list[str] = []
    y = miny
    flip = False
    while y <= maxy + 1e-6:
        xa, xb = (minx, maxx) if not flip else (maxx, minx)
        path = ocl.Path()
        _path_append_xy_line(path, ocl, xa, y, xb, y)
        pdc.setPath(path)
        pdc.run()
        pts = pdc.getCLPoints()
        all_lines.append(f"; OCL PathDropCutter raster Y={y:.3f}")
        all_lines.extend(_clpoints_to_polyline(pts, safe_z=safe_z_mm, feed=feed_mm_min, plunge=plunge_mm_min))
        flip = not flip
        y += step

    return all_lines


def _run_waterline_levels(
    ocl,
    stl,
    *,
    strategy: str,
    z_pass_mm: float,
    stepover_mm: float,
    tool_diameter_mm: float,
    safe_z_mm: float,
    feed_mm_min: float,
    plunge_mm_min: float,
) -> list[str]:
    """Slice the STL between bounds with repeated waterline passes at decreasing Z."""
    bounds = stl.getBounds()
    _minx, _maxx, _miny, _maxy, minz, maxz = (
        float(bounds[0]),
        float(bounds[1]),
        float(bounds[2]),
        float(bounds[3]),
        float(bounds[4]),
        float(bounds[5]),
    )
    step = max(0.05, abs(float(z_pass_mm)))
    sampling = max(0.05, min(float(stepover_mm), 5.0))
    cutter = _cutter(ocl, tool_diameter_mm)
    z_floor = minz + tool_diameter_mm * 0.25
    z = maxz - 0.001

    all_lines: list[str] = []
    while z >= z_floor - 1e-6:
        wl, tag = _make_waterline(ocl, strategy)
        wl.setSTL(stl)
        wl.setCutter(cutter)
        wl.setSampling(sampling)
        if strategy == "adaptive_waterline" and "adaptive waterline" in tag:
            wl.setMinSampling(max(0.02, sampling * 0.25))
            wl.setCosLimit(0.65)
        wl.setZ(z)
        wl.run()
        loops = wl.getLoops()
        all_lines.append(f"; OCL {tag} Z={z:.3f}")
        all_lines.extend(_loops_to_lines(loops, safe_z=safe_z_mm, feed=feed_mm_min, plunge=plunge_mm_min))
        z -= step
        if not math.isfinite(z):
            break

    return all_lines


def main() -> None:
    cfg = _load_cfg()
    _validate_cfg(cfg)

    stl_path = Path(str(cfg["stlPath"]))
    out_json = Path(str(cfg["toolpathJsonPath"]))
    strategy = _coerce_strategy(cfg)

    # Check STL before importing OpenCAMLib so config/path errors do not depend on pip installs.
    if not stl_path.is_file():
        _die("stl_missing", str(stl_path), code=2)
    try:
        if stl_path.stat().st_size == 0:
            _die("stl_read_error", "STL file is empty (0 bytes)", code=3)
    except OSError as e:
        _die("stl_read_error", str(e), code=3)

    nums = _parse_cam_numeric_params(cfg, strategy)
    z_pass = nums["zPassMm"]
    stepover = nums["stepoverMm"]
    tool_d = nums["toolDiameterMm"]
    safe_z = nums["safeZMm"]
    feed = nums["feedMmMin"]
    plunge = nums["plungeMmMin"]

    try:
        import ocl  # noqa: PLC0415
    except Exception as e:  # noqa: BLE001
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": "opencamlib_not_installed",
                    "detail": str(e),
                },
                ensure_ascii=False,
            )
        )
        sys.exit(1)

    try:
        try:
            stl = _stlsurf_from_file(stl_path)
        except Exception as e:  # noqa: BLE001
            print(
                json.dumps({"ok": False, "error": "stl_read_error", "detail": str(e)}, ensure_ascii=False)
            )
            sys.exit(3)

        if strategy == "raster":
            lines = _run_raster_pathdrop(
                ocl,
                stl,
                stepover_mm=stepover,
                sampling_mm=stepover,
                tool_diameter_mm=tool_d,
                safe_z_mm=safe_z,
                feed_mm_min=feed,
                plunge_mm_min=plunge,
            )
        else:
            lines = _run_waterline_levels(
                ocl,
                stl,
                strategy=strategy,
                z_pass_mm=z_pass,
                stepover_mm=stepover,
                tool_diameter_mm=tool_d,
                safe_z_mm=safe_z,
                feed_mm_min=feed,
                plunge_mm_min=plunge,
            )
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": "ocl_runtime_error", "detail": str(e)}, ensure_ascii=False))
        sys.exit(3)

    if not lines:
        detail = "no raster segments" if strategy == "raster" else "no loops"
        print(json.dumps({"ok": False, "error": "ocl_empty_toolpath", "detail": detail}, ensure_ascii=False))
        sys.exit(4)

    payload = {"ok": True, "toolpathLines": lines, "strategy": strategy}
    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({"ok": True, "lines": len(lines), "strategy": strategy}, ensure_ascii=False))


if __name__ == "__main__":
    main()
