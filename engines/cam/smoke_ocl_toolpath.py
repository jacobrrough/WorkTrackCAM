#!/usr/bin/env python3
"""
Standalone smoke tests for ``ocl_toolpath.py`` error paths.

Most cases need **no OpenCAMLib** (config / validation only). A few use a tiny on-disk ASCII STL.

Run from repo root or from this directory::

    python engines/cam/smoke_ocl_toolpath.py
    # or
    cd engines/cam && python smoke_ocl_toolpath.py

Exit 0 if all checks pass; non-zero if any subprocess expectation fails.
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path


def _script_path() -> Path:
    return Path(__file__).resolve().parent / "ocl_toolpath.py"


def _run(cfg_path: Path) -> tuple[int, str]:
    r = subprocess.run(
        [sys.executable, str(_script_path()), str(cfg_path)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    out = (r.stdout or "") + (r.stderr or "")
    return r.returncode, out


def _write_minimal_ascii_stl(path: Path) -> None:
    """One-triangle ASCII STL so ``is_file()`` and format are plausible for numeric-only tests."""
    path.write_text(
        "\n".join(
            [
                "solid ufs_smoke",
                "  facet normal 0 0 1",
                "    outer loop",
                "      vertex 0 0 0",
                "      vertex 1 0 0",
                "      vertex 0 1 0",
                "    endloop",
                "  endfacet",
                "endsolid ufs_smoke",
                "",
            ]
        ),
        encoding="utf-8",
    )


def _assert_json_line(stdout: str, expect_error: str) -> dict:
    line = stdout.strip().splitlines()[-1] if stdout.strip() else ""
    try:
        obj = json.loads(line)
    except json.JSONDecodeError as e:
        raise AssertionError(f"last stdout line is not JSON: {line!r} ({e})") from e
    if obj.get("error") != expect_error:
        raise AssertionError(f"expected error={expect_error!r}, got {obj!r}")
    return obj


def main() -> int:
    script = _script_path()
    if not script.is_file():
        print(f"missing {script}", file=sys.stderr)
        return 1

    with tempfile.TemporaryDirectory() as tmp:
        td = Path(tmp)

        # 1) No argv
        r = subprocess.run(
            [sys.executable, str(script)],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        if r.returncode != 2:
            print(f"expected exit 2 for missing argv, got {r.returncode}", file=sys.stderr)
            return 1
        _assert_json_line(r.stdout + r.stderr, "usage")

        # 2) Invalid JSON
        bad = td / "bad.json"
        bad.write_text("{ not json", encoding="utf-8")
        code, out = _run(bad)
        if code != 2:
            print(f"expected exit 2 for invalid JSON, got {code}", file=sys.stderr)
            return 1
        _assert_json_line(out, "invalid_config_json")

        # 3) Missing required keys
        partial = td / "partial.json"
        partial.write_text(json.dumps({"stlPath": "/nope"}), encoding="utf-8")
        code, out = _run(partial)
        if code != 2:
            print(f"expected exit 2 for missing keys, got {code}", file=sys.stderr)
            return 1
        _assert_json_line(out, "config_missing_keys")

        # 4) Bad strategy
        bad_strat = td / "bad_strat.json"
        bad_strat.write_text(
            json.dumps(
                {
                    "stlPath": str(td / "x.stl"),
                    "toolpathJsonPath": str(td / "out.json"),
                    "strategy": "nope",
                }
            ),
            encoding="utf-8",
        )
        code, out = _run(bad_strat)
        if code != 2:
            print(f"expected exit 2 for invalid strategy, got {code}", file=sys.stderr)
            return 1
        _assert_json_line(out, "invalid_strategy")

        # 5) Config path does not exist
        ghost = td / "definitely_absent_config.json"
        if ghost.is_file():
            raise AssertionError(f"unexpected file {ghost}")
        code, out = _run(ghost)
        if code != 2:
            print(f"expected exit 2 for config_not_found, got {code}", file=sys.stderr)
            return 1
        _assert_json_line(out, "config_not_found")

        # 6) Root JSON not an object
        not_obj = td / "array.json"
        not_obj.write_text("[]", encoding="utf-8")
        code, out = _run(not_obj)
        if code != 2:
            print(f"expected exit 2 for invalid_config_shape, got {code}", file=sys.stderr)
            return 1
        _assert_json_line(out, "invalid_config_shape")

        # 7) Valid shape but STL missing (OCL may or may not be installed; error must be stl_missing)
        missing_stl = td / "ok.json"
        missing_stl.write_text(
            json.dumps(
                {
                    "stlPath": str(td / "nonexistent.stl"),
                    "toolpathJsonPath": str(td / "out.json"),
                    "strategy": "waterline",
                }
            ),
            encoding="utf-8",
        )
        code, out = _run(missing_stl)
        if code != 2:
            print(f"expected exit 2 for missing STL, got {code}", file=sys.stderr)
            return 1
        _assert_json_line(out, "stl_missing")

        tiny = td / "tiny.stl"
        _write_minimal_ascii_stl(tiny)

        # 8) zPassMm = 0 for waterline
        z0 = td / "z0.json"
        z0.write_text(
            json.dumps(
                {
                    "stlPath": str(tiny),
                    "toolpathJsonPath": str(td / "out.json"),
                    "strategy": "waterline",
                    "zPassMm": 0,
                }
            ),
            encoding="utf-8",
        )
        code, out = _run(z0)
        if code != 2:
            print(f"expected exit 2 for zPassMm=0, got {code}", file=sys.stderr)
            return 1
        _assert_json_line(out, "invalid_numeric_params")

        # 9) Invalid numeric (negative feed) — STL exists; fails before OCL import
        bad_num = td / "bad_num.json"
        bad_num.write_text(
            json.dumps(
                {
                    "stlPath": str(tiny),
                    "toolpathJsonPath": str(td / "out.json"),
                    "strategy": "waterline",
                    "feedMmMin": -100,
                }
            ),
            encoding="utf-8",
        )
        code, out = _run(bad_num)
        if code != 2:
            print(f"expected exit 2 for invalid_numeric_params, got {code}", file=sys.stderr)
            return 1
        _assert_json_line(out, "invalid_numeric_params")

        # 10) Non-numeric parameter
        bad_type = td / "bad_type.json"
        bad_type.write_text(
            json.dumps(
                {
                    "stlPath": str(tiny),
                    "toolpathJsonPath": str(td / "out.json"),
                    "strategy": "waterline",
                    "stepoverMm": "wide",
                }
            ),
            encoding="utf-8",
        )
        code, out = _run(bad_type)
        if code != 2:
            print(f"expected exit 2 for non-numeric stepover, got {code}", file=sys.stderr)
            return 1
        _assert_json_line(out, "invalid_numeric_params")

        # 11) toolDiameterMm <= 0
        bad_tool = td / "bad_tool.json"
        bad_tool.write_text(
            json.dumps(
                {
                    "stlPath": str(tiny),
                    "toolpathJsonPath": str(td / "out.json"),
                    "strategy": "waterline",
                    "toolDiameterMm": 0,
                }
            ),
            encoding="utf-8",
        )
        code, out = _run(bad_tool)
        if code != 2:
            print(f"expected exit 2 for toolDiameterMm=0, got {code}", file=sys.stderr)
            return 1
        _assert_json_line(out, "invalid_numeric_params")

        # 12) stepoverMm <= 0
        bad_step = td / "bad_step.json"
        bad_step.write_text(
            json.dumps(
                {
                    "stlPath": str(tiny),
                    "toolpathJsonPath": str(td / "out.json"),
                    "strategy": "waterline",
                    "stepoverMm": 0,
                }
            ),
            encoding="utf-8",
        )
        code, out = _run(bad_step)
        if code != 2:
            print(f"expected exit 2 for stepoverMm=0, got {code}", file=sys.stderr)
            return 1
        _assert_json_line(out, "invalid_numeric_params")

        # 13) plungeMmMin <= 0
        bad_plunge = td / "bad_plunge.json"
        bad_plunge.write_text(
            json.dumps(
                {
                    "stlPath": str(tiny),
                    "toolpathJsonPath": str(td / "out.json"),
                    "strategy": "waterline",
                    "plungeMmMin": 0,
                }
            ),
            encoding="utf-8",
        )
        code, out = _run(bad_plunge)
        if code != 2:
            print(f"expected exit 2 for plungeMmMin=0, got {code}", file=sys.stderr)
            return 1
        _assert_json_line(out, "invalid_numeric_params")

        # 14) Non-finite numeric (Infinity)
        bad_inf = td / "bad_inf.json"
        cfg_inf = {
            "stlPath": str(tiny),
            "toolpathJsonPath": str(td / "out.json"),
            "strategy": "waterline",
            "feedMmMin": float("inf"),
        }
        bad_inf.write_text(json.dumps(cfg_inf), encoding="utf-8")
        code, out = _run(bad_inf)
        if code != 2:
            print(f"expected exit 2 for non-finite feedMmMin, got {code}", file=sys.stderr)
            return 1
        _assert_json_line(out, "invalid_numeric_params")

        # 15) Config file is not valid UTF-8 (read fails before JSON parse)
        bad_utf8 = td / "bad_utf8.json"
        bad_utf8.write_bytes(b"\xff\xfe\x00")
        code, out = _run(bad_utf8)
        if code != 2:
            print(f"expected exit 2 for config_not_utf8, got {code}", file=sys.stderr)
            return 1
        _assert_json_line(out, "config_not_utf8")

        # 16) Non-finite numeric (NaN) — JSON allows NaN in Python's decoder
        bad_nan = td / "bad_nan.json"
        cfg_nan = {
            "stlPath": str(tiny),
            "toolpathJsonPath": str(td / "out.json"),
            "strategy": "waterline",
            "feedMmMin": float("nan"),
        }
        bad_nan.write_text(json.dumps(cfg_nan), encoding="utf-8")
        code, out = _run(bad_nan)
        if code != 2:
            print(f"expected exit 2 for NaN feedMmMin, got {code}", file=sys.stderr)
            return 1
        _assert_json_line(out, "invalid_numeric_params")

    print("smoke_ocl_toolpath: ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
