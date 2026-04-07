"""
Tests for the startup dependency checker (check_deps.py).

Validates: report structure, Python version detection, numpy availability
reporting, optional-dep reporting, missing_required population, exit-code logic.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from ..check_deps import check_all


class TestCheckAll:
    """Unit tests for check_all()."""

    def test_returns_dict(self):
        report = check_all()
        assert isinstance(report, dict)

    def test_required_keys_present(self):
        report = check_all()
        assert "ok" in report
        assert "python_ok" in report
        assert "python_version" in report
        assert "python_min" in report
        assert "required" in report
        assert "optional" in report
        assert "missing_required" in report

    def test_python_version_format(self):
        report = check_all()
        parts = report["python_version"].split(".")
        assert len(parts) == 3
        assert all(p.isdigit() for p in parts)

    def test_python_min_format(self):
        report = check_all()
        parts = report["python_min"].split(".")
        assert len(parts) == 2
        assert all(p.isdigit() for p in parts)

    def test_python_ok_matches_current_version(self):
        report = check_all()
        min_parts = [int(p) for p in report["python_min"].split(".")]
        current_parts = [int(p) for p in report["python_version"].split(".")]
        expected = tuple(current_parts[:2]) >= tuple(min_parts[:2])
        assert report["python_ok"] == expected

    def test_required_list_structure(self):
        report = check_all()
        for dep in report["required"]:
            assert "name" in dep
            assert "available" in dep
            assert "version" in dep
            assert "note" in dep
            assert isinstance(dep["available"], bool)
            assert isinstance(dep["name"], str)
            assert isinstance(dep["note"], str)

    def test_optional_list_structure(self):
        report = check_all()
        for dep in report["optional"]:
            assert "name" in dep
            assert "available" in dep
            assert "version" in dep
            assert "note" in dep
            assert isinstance(dep["available"], bool)

    def test_numpy_in_required(self):
        report = check_all()
        names = [d["name"] for d in report["required"]]
        assert "numpy" in names

    def test_structlog_in_optional(self):
        report = check_all()
        names = [d["name"] for d in report["optional"]]
        assert "structlog" in names

    def test_opencamlib_in_optional(self):
        report = check_all()
        names = [d["name"] for d in report["optional"]]
        # name contains "opencamlib" (may include parenthetical)
        assert any("opencamlib" in n.lower() for n in names)

    def test_missing_required_is_list(self):
        report = check_all()
        assert isinstance(report["missing_required"], list)

    def test_ok_false_when_missing_required(self):
        """ok must be False when missing_required is non-empty."""
        report = check_all()
        if report["missing_required"]:
            assert report["ok"] is False
        else:
            # ok may still be False for other reasons (Python version)
            if report["python_ok"]:
                assert report["ok"] is True

    def test_numpy_available_in_this_env(self):
        """numpy is a required dep — it must be installed in the test environment."""
        report = check_all()
        numpy_entry = next(d for d in report["required"] if d["name"] == "numpy")
        assert numpy_entry["available"], (
            "numpy is required but not found. Run: pip install numpy"
        )

    def test_version_string_when_available(self):
        """When a dep is available, version should be a non-empty string."""
        report = check_all()
        for dep in report["required"] + report["optional"]:
            if dep["available"]:
                assert dep["version"] is not None
                assert isinstance(dep["version"], str)
                assert len(dep["version"]) > 0

    def test_version_none_when_missing(self):
        """When a dep is unavailable, version should be None."""
        report = check_all()
        for dep in report["required"] + report["optional"]:
            if not dep["available"]:
                assert dep["version"] is None

    def test_report_is_json_serialisable(self):
        report = check_all()
        serialised = json.dumps(report)
        round_tripped = json.loads(serialised)
        assert round_tripped["python_version"] == report["python_version"]


class TestMainEntrypoint:
    """Test the CLI entrypoint via subprocess."""

    def test_exits_zero_when_deps_ok(self):
        """When all required deps are present, the script must exit 0."""
        result = subprocess.run(
            [sys.executable, "-m", "engines.cam.toolpath_engine.check_deps"],
            capture_output=True,
            text=True,
            cwd=str(Path(__file__).parents[4]),  # repo root (WorkTrackCAM)
        )
        report = json.loads(result.stdout)
        if report["ok"]:
            assert result.returncode == 0
        else:
            assert result.returncode == 1

    def test_stdout_is_valid_json(self):
        """CLI output must always be valid JSON."""
        result = subprocess.run(
            [sys.executable, "-m", "engines.cam.toolpath_engine.check_deps"],
            capture_output=True,
            text=True,
            cwd=str(Path(__file__).parents[4]),  # repo root
        )
        report = json.loads(result.stdout)
        assert "ok" in report
        assert "required" in report
