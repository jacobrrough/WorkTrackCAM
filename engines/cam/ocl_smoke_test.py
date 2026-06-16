"""OCL-gated smoke for the TRUE OpenCAMLib toolpath path.

These tests exercise the real OpenCAMLib drop-cutter + waterline engine through
the repo's shared strategy core (``ocl_strategies.dispatch_strategy``). They are
guarded by ``requires_ocl`` and **SKIP cleanly** on any environment without
OpenCAMLib installed (green on machines where OCL is absent) -- but on a venv
that has it (CPython 3.7-3.11 + ``pip install opencamlib``, see
``scripts/bundle-opencamlib.ps1``) they MUST RUN and prove real CL points →
G-code.

Import-name nuance (the load-bearing finding)
=============================================
The engine code (``engines/cam/ocl_toolpath.py``) does ``import ocl``, but the
PyPI distribution is ``opencamlib`` (its compiled extension lives at
``opencamlib.ocl``). A plain ``pip install opencamlib`` does NOT create a bare
top-level ``ocl`` module. ``scripts/bundle-opencamlib.ps1`` writes an ``ocl.py``
shim so ``import ocl`` resolves. To run regardless of whether that shim is
present yet, the probe below tries ``ocl`` first and falls back to
``opencamlib``.

Run on the sidecar venv (the repo's system python skips OCL just like it skips
@requires_cadquery)::

    C:/Users/jrrou/wtcam-sidecar-venv/Scripts/python.exe -m pytest \
        engines/cam/ocl_smoke_test.py -v

Safety: this test only ASSERTS on engine output (finite, feed-bearing G1
moves). It changes NO G-code-emitting code and posts nothing to a machine.
"""
from __future__ import annotations

import math
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

import pytest

# Make the sibling strategy module importable when this file is collected from
# the repo root (engines/cam is not a package on sys.path during plain pytest).
sys.path.insert(0, str(Path(__file__).resolve().parent))

import ocl_strategies as S  # noqa: E402  (after sys.path shim)


# ── Probe / gate ──────────────────────────────────────────────────────────


def _load_ocl() -> Any | None:
    """Return an imported OCL module (bare ``ocl`` or ``opencamlib``), or None."""
    try:
        import ocl  # noqa: PLC0415 - probe; resolves via the bundle-opencamlib shim
        return ocl
    except ImportError:
        pass
    try:
        import opencamlib  # noqa: PLC0415 - PyPI package name (no shim yet)
        return opencamlib
    except ImportError:
        return None


_OCL = _load_ocl()

requires_ocl = pytest.mark.skipif(
    _OCL is None,
    reason="opencamlib (OpenCAMLib) not installed in this environment",
)


# ── Fixtures ──────────────────────────────────────────────────────────────


def _write_box_stl(path: Path, x: float = 10.0, y: float = 10.0, z: float = 5.0) -> None:
    """A closed 12-triangle box so waterline has vertical walls (=> closed loops)."""

    def tri(n: tuple[float, float, float], a: tuple[float, ...], b: tuple[float, ...], c: tuple[float, ...]) -> str:
        return (
            f"facet normal {n[0]} {n[1]} {n[2]}\n"
            " outer loop\n"
            f"  vertex {a[0]} {a[1]} {a[2]}\n"
            f"  vertex {b[0]} {b[1]} {b[2]}\n"
            f"  vertex {c[0]} {c[1]} {c[2]}\n"
            " endloop\n"
            "endfacet\n"
        )

    v = [
        (0, 0, 0), (x, 0, 0), (x, y, 0), (0, y, 0),
        (0, 0, z), (x, 0, z), (x, y, z), (0, y, z),
    ]
    faces = [
        ((0, 0, -1), 0, 2, 1), ((0, 0, -1), 0, 3, 2),   # bottom
        ((0, 0, 1), 4, 5, 6), ((0, 0, 1), 4, 6, 7),      # top
        ((0, -1, 0), 0, 1, 5), ((0, -1, 0), 0, 5, 4),    # front
        ((1, 0, 0), 1, 2, 6), ((1, 0, 0), 1, 6, 5),      # right
        ((0, 1, 0), 2, 3, 7), ((0, 1, 0), 2, 7, 6),      # back
        ((-1, 0, 0), 3, 0, 4), ((-1, 0, 0), 3, 4, 7),    # left
    ]
    body = "solid box\n" + "".join(tri(n, v[a], v[b], v[c]) for (n, a, b, c) in faces) + "endsolid box\n"
    path.write_text(body, encoding="utf-8")


@pytest.fixture()
def box_stl() -> Any:
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp) / "box.stl"
        _write_box_stl(p)
        yield p


# ── G-code line assertions (Safety Rule 1) ────────────────────────────────


def _assert_safe_g1_moves(lines: list[str]) -> int:
    """Every G1 cutting move must carry a feed and finite coordinates. Returns the G1 count."""
    g1 = [ln for ln in lines if ln.startswith("G1 X")]
    assert g1, "expected at least one G1 cutting move"
    for ln in g1:
        assert " F" in ln, f"G1 cut move missing feed: {ln!r}"
        assert "nan" not in ln.lower() and "inf" not in ln.lower(), f"non-finite coordinate: {ln!r}"
        # Every numeric token must parse as a finite float.
        for tok in ln.split():
            if tok[:1] in ("X", "Y", "Z", "F"):
                assert math.isfinite(float(tok[1:])), f"non-finite token {tok!r} in {ln!r}"
    return len(g1)


# ── Tests (skipped when OCL absent) ───────────────────────────────────────


@requires_ocl
def test_ocl_imports_and_reports_version() -> None:
    assert _OCL is not None
    # version() is a stable OCL API across the wheel builds we target.
    ver = _OCL.version()
    assert isinstance(ver, str) and ver, f"unexpected ocl.version() => {ver!r}"


@requires_ocl
def test_raw_pathdropcutter_returns_cl_points(box_stl: Path) -> None:
    """Minimal raw-OCL smoke: CylCutter + STLSurf + PathDropCutter -> CL points."""
    ocl = _OCL
    surf = ocl.STLSurf()
    ocl.STLReader(str(box_stl), surf)
    assert surf.size() == 12  # closed box

    cutter = ocl.CylCutter(3.0, 20.0)
    pdc = ocl.PathDropCutter()
    pdc.setSTL(surf)
    pdc.setCutter(cutter)
    pdc.setSampling(1.0)
    pdc.setZ(-50.0)

    path = ocl.Path()
    path.append(ocl.Line(ocl.Point(0, 5, 0), ocl.Point(10, 5, 0)))
    pdc.setPath(path)
    pdc.run()
    pts = pdc.getCLPoints()
    assert len(pts) > 0, "PathDropCutter returned no CL points"
    # The cutter should be pulled UP onto the box top surface (z=5).
    zs = {round(float(p.z), 3) for p in pts}
    assert any(abs(z - 5.0) < 1e-6 for z in zs), f"expected a CL point at top surface z=5, got {sorted(zs)}"


@requires_ocl
def test_dispatch_raster_real_ocl(box_stl: Path) -> None:
    """The repo strategy core drives OCL PathDropCutter for the raster strategy."""
    ocl = _OCL
    stl = S.load_stl(ocl, box_stl)
    lines = S.dispatch_strategy(
        ocl, stl, strategy="raster",
        z_pass_mm=1.0, stepover_mm=1.0, tool_diameter_mm=3.0,
        safe_z_mm=10.0, feed_mm_min=1000.0, plunge_mm_min=400.0,
    )
    assert lines, "raster produced no lines"
    n = _assert_safe_g1_moves(lines)
    assert n >= 10  # a 10mm box at 1mm stepover sweeps many rows


@requires_ocl
def test_dispatch_waterline_real_ocl(box_stl: Path) -> None:
    """The repo strategy core drives OCL Waterline -> closed-loop G-code."""
    ocl = _OCL
    stl = S.load_stl(ocl, box_stl)
    lines = S.dispatch_strategy(
        ocl, stl, strategy="waterline",
        z_pass_mm=1.0, stepover_mm=1.0, tool_diameter_mm=3.0,
        safe_z_mm=10.0, feed_mm_min=1000.0, plunge_mm_min=400.0,
    )
    assert lines, "waterline produced no lines"
    _assert_safe_g1_moves(lines)
    # Waterline emits a per-level comment for each Z slice.
    assert any(ln.startswith("; OCL waterline Z=") for ln in lines), "missing waterline level comments"


@requires_ocl
def test_dispatch_surface_scan_real_ocl(box_stl: Path) -> None:
    """surface_scan uses a ball-end PathDropCutter finish pass via OCL."""
    ocl = _OCL
    stl = S.load_stl(ocl, box_stl)
    lines = S.dispatch_strategy(
        ocl, stl, strategy="surface_scan",
        z_pass_mm=1.0, stepover_mm=1.0, tool_diameter_mm=3.0,
        safe_z_mm=10.0, feed_mm_min=1000.0, plunge_mm_min=400.0,
    )
    assert lines, "surface_scan produced no lines"
    _assert_safe_g1_moves(lines)


# NOTE (honest scoping): the ``adaptive_waterline`` strategy is intentionally
# NOT smoke-tested here against real OCL. ``ocl_strategies.run_waterline_levels``
# calls ``AdaptiveWaterline.setCosLimit(...)``, but the only installable PyPI
# wheel (opencamlib 2023.1.11) does NOT expose ``setCosLimit`` on
# ``AdaptiveWaterline`` -> it raises AttributeError. Fixing that lives in the
# engine code (out of scope for this packaging cycle); see docs/OPENCAMLIB.md
# "Known incompatibility". The waterline test above covers the loop machinery.


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
