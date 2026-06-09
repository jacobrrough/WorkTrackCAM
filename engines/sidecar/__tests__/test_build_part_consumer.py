"""No-code build consumer coverage: ``engines/occt/build_part.py``.

This is the file ``src/main/cad/build-kernel-part.ts`` spawns to turn a
kernel-op timeline (sketch profile + post-solid ops) into STEP + STL. Before
this consumer existed, the kernel-op timeline + Wave-2 feature dialogs emitted
ops that built NO geometry (build_part.py had never existed in git). These
tests pin the build_part.py payload/output contract so the Wire phase can
trigger it with confidence.

Tier-1 tests (no CadQuery) cover the argv/usage + payload-error envelopes.
Tier-2 tests (skipped when CadQuery is absent) build a REAL rectangle->extrude
solid and prove (Safety Rule 5):

  * a picked-edge fillet rounds ONLY the picked edge (removes ~1/4 of what the
    axis bucket filleting all four parallel edges removes);
  * a fillet->chamfer->shell chain applies in order and hollows the body;
  * an UNRESOLVED picked id falls back to the axis bucket WITH a warning and
    NEVER crashes (kernel is sacred);
  * a back-compat pre-#15 axis-bucket-only timeline (fillet_all + boolean +
    pattern) still builds;
  * the placement transform matches the renderer preview (canonical -> world
    ``(x, z, -y)`` for datum XY);
  * the script invoked EXACTLY as build-kernel-part.ts invokes it (argv +
    last-stdout-line JSON) returns the contracted envelope.

Run the Tier-2 tests with the cadquery venv python:
    C:/Users/jrrou/wtcam-sidecar-venv/Scripts/python.exe -m pytest \
        engines/sidecar/__tests__/test_build_part_consumer.py
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, List

import pytest

from engines.occt import build_part as bp

_REPO_ROOT = Path(__file__).resolve().parents[3]
_BUILD_SCRIPT = _REPO_ROOT / "engines" / "occt" / "build_part.py"


def _cadquery_available() -> bool:
    try:
        import cadquery  # noqa: F401 - probe only
        return True
    except ImportError:
        return False


requires_cadquery = pytest.mark.skipif(
    not _cadquery_available(),
    reason="cadquery not installed in this environment",
)


# Canonical rectangle 20 x 12, extrude 8 -> base volume 1920 mm^3.
_RECT = [[-10, -6], [10, -6], [10, 6], [-10, 6]]
_BASE_VOL = 20.0 * 12.0 * 8.0


def _payload(ops: List[Dict[str, Any]] | None = None, **overrides: Any) -> Dict[str, Any]:
    p: Dict[str, Any] = {
        "version": 3,
        "solidKind": "extrude",
        "extrudeDepthMm": 8.0,
        "revolve": {"angleDeg": 360, "axisX": 0},
        "profiles": [{"type": "loop", "points": _RECT}],
        "sketchPlane": {"kind": "datum", "datum": "XY"},
    }
    if ops is not None:
        p["postSolidOps"] = ops
    p.update(overrides)
    return p


# ── Tier 1: argv + payload-error envelopes (no cadquery) ─────────────────────


def test_main_usage_envelope_on_missing_args(capsys: Any) -> None:
    with pytest.raises(SystemExit) as exc:
        bp.main(["build_part.py", "only-one-arg"])
    assert exc.value.code == 1
    out = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert out == {"ok": False, "error": "usage", "detail": out["detail"]}
    assert out["error"] == "usage"


def test_load_payload_rejects_missing_file(capsys: Any) -> None:
    with pytest.raises(SystemExit):
        bp._load_payload(str(_REPO_ROOT / "does-not-exist-xyz.json"))
    out = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert out["ok"] is False
    assert out["error"] == "payload_read_failed"


def test_load_payload_rejects_non_object(capsys: Any) -> None:
    tmp = tempfile.mkdtemp()
    p = Path(tmp) / "arr.json"
    p.write_text("[1, 2, 3]", encoding="utf-8")
    with pytest.raises(SystemExit):
        bp._load_payload(str(p))
    out = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert out["error"] == "invalid_payload"


def test_require_finite_mm_rejects_nan_and_inf() -> None:
    assert bp._require_finite_mm(3.5, "x") == 3.5
    for bad in (float("nan"), float("inf"), float("-inf"), "abc", None):
        with pytest.raises(bp._PayloadError):
            bp._require_finite_mm(bad, "x")


def test_placement_basis_matches_preview_fingerprint() -> None:
    # EXACT mirror of sketch-preview-placement-pin.test.ts fingerprints.
    xy = bp._placement_basis({"kind": "datum", "datum": "XY"})
    assert xy == ((1.0, 0.0, 0.0), (0.0, 0.0, -1.0), (0.0, 1.0, 0.0), (0.0, 0.0, 0.0))
    xz = bp._placement_basis({"kind": "datum", "datum": "XZ"})
    assert xz == xy  # XZ uses the same basis as XY in the preview
    yz = bp._placement_basis({"kind": "datum", "datum": "YZ"})
    assert yz == ((0.0, 1.0, 0.0), (0.0, 0.0, 1.0), (1.0, 0.0, 0.0), (0.0, 0.0, 0.0))
    # Unknown / malformed plane -> None (caller leaves canonical, never guesses).
    assert bp._placement_basis({"kind": "datum", "datum": "ZZ"}) is None
    assert bp._placement_basis({"kind": "face"}) is None


# ── Tier 2: REAL fixtures (Safety Rule 5) ────────────────────────────────────


def _vol_of_step(step_path: str) -> float:
    import cadquery as cq

    return float(cq.importers.importStep(step_path).findSolid().Volume())


def _picked_vertical_edge_id() -> str:
    """Stable id of ONE of the four +Z (vertical) edges, computed from the SAME
    canonical base solid build_part builds (so the id resolves at build)."""
    import cadquery as cq

    from engines.cad.cadquery_script import _edges_in_axis_bucket, _safe_edge_geom_id

    base = cq.Workplane("XY").polyline(_RECT).close().extrude(8)
    z_edges = _edges_in_axis_bucket(base.findSolid(), "+Z")
    assert len(z_edges) == 4
    return _safe_edge_geom_id(z_edges[0])


@requires_cadquery
def test_extrude_base_volume_and_world_placement() -> None:
    """A bare rectangle->extrude builds the right solid AND lands in world space
    with the preview transform (canonical (x,y,z) -> world (x, z, -y))."""
    import cadquery as cq

    out = tempfile.mkdtemp()
    res = bp.build_part(_payload(), out, "kernel-part")
    assert Path(res["stepPath"]).is_file()
    assert Path(res["stlPath"]).is_file()

    solid = cq.importers.importStep(res["stepPath"]).findSolid()
    assert abs(solid.Volume() - _BASE_VOL) < 1e-3
    bb = solid.BoundingBox()
    # canonical x[-10,10] -> world X[-10,10]; canonical z[0,8] -> world Y[0,8];
    # canonical y[-6,6] -> world Z[-6,6] (negated y).
    assert abs(bb.xmin - (-10)) < 1e-6 and abs(bb.xmax - 10) < 1e-6
    assert abs(bb.ymin - 0) < 1e-6 and abs(bb.ymax - 8) < 1e-6
    assert abs(bb.zmin - (-6)) < 1e-6 and abs(bb.zmax - 6) < 1e-6


@requires_cadquery
def test_picked_edge_fillet_touches_only_that_edge() -> None:
    """HEADLINE: the picked-edge fillet removes ~1/4 of the axis-bucket fillet
    (which rounds all four parallel vertical edges) -> the op targeted the
    picked edge, not the bucket."""
    one_id = _picked_vertical_edge_id()

    picked = bp.build_part(
        _payload([{"kind": "fillet_select", "radiusMm": 2.0, "edgeDirection": "+Z", "pickedEdgeIds": [one_id]}]),
        tempfile.mkdtemp(),
        "kernel-part",
    )
    bucket = bp.build_part(
        _payload([{"kind": "fillet_select", "radiusMm": 2.0, "edgeDirection": "+Z"}]),
        tempfile.mkdtemp(),
        "kernel-part",
    )
    assert picked.get("warnings") is None  # clean resolve, no fallback
    picked_removed = _BASE_VOL - _vol_of_step(picked["stepPath"])
    bucket_removed = _BASE_VOL - _vol_of_step(bucket["stepPath"])
    assert picked_removed > 0.0
    assert bucket_removed > picked_removed
    assert abs(bucket_removed - 4.0 * picked_removed) < 1e-2


@requires_cadquery
def test_fillet_chamfer_shell_chain_applies_in_order_and_hollows() -> None:
    """A {fillet picked -> chamfer bucket -> shell} timeline applies in order and
    hollows the body (volume drops well below base; inner walls add faces)."""
    import cadquery as cq

    one_id = _picked_vertical_edge_id()
    res = bp.build_part(
        _payload(
            [
                {"kind": "fillet_select", "radiusMm": 2.0, "edgeDirection": "+Z", "pickedEdgeIds": [one_id]},
                {"kind": "chamfer_select", "lengthMm": 1.0, "edgeDirection": "+Z"},
                {"kind": "shell_inward", "thicknessMm": 1.5, "openDirection": "+Z"},
            ]
        ),
        tempfile.mkdtemp(),
        "kernel-part",
    )
    solid = cq.importers.importStep(res["stepPath"]).findSolid()
    assert solid.Volume() < _BASE_VOL  # genuinely hollowed
    # A hollow box has more than the 6 faces of a solid box (inner walls + caps).
    assert len(solid.Faces()) > 6


@requires_cadquery
def test_unresolved_picked_id_falls_back_with_warning() -> None:
    """An unresolved picked id NEVER crashes: it falls back to the axis bucket
    (same volume) and surfaces a non-fatal warning."""
    bucket = bp.build_part(
        _payload([{"kind": "fillet_select", "radiusMm": 2.0, "edgeDirection": "+Z"}]),
        tempfile.mkdtemp(),
        "kernel-part",
    )
    fallback = bp.build_part(
        _payload([{"kind": "fillet_select", "radiusMm": 2.0, "edgeDirection": "+Z", "pickedEdgeIds": ["e:does-not-exist"]}]),
        tempfile.mkdtemp(),
        "kernel-part",
    )
    assert any("did not resolve" in w for w in (fallback.get("warnings") or []))
    assert abs(_vol_of_step(fallback["stepPath"]) - _vol_of_step(bucket["stepPath"])) < 1e-4


@requires_cadquery
def test_back_compat_axis_bucket_only_timeline_builds() -> None:
    """A pre-#15 axis-bucket-only timeline (no pickedEdgeIds anywhere) still
    builds: fillet_all + boolean_subtract_box + pattern_rectangular."""
    res = bp.build_part(
        _payload(
            [
                {"kind": "fillet_all", "radiusMm": 1.0},
                {"kind": "boolean_subtract_box", "xMinMm": -2, "xMaxMm": 2, "yMinMm": -2, "yMaxMm": 2, "zMinMm": -1, "zMaxMm": 9},
                {"kind": "pattern_rectangular", "countX": 2, "countY": 1, "spacingXMm": 40, "spacingYMm": 0},
            ]
        ),
        tempfile.mkdtemp(),
        "kernel-part",
    )
    assert Path(res["stepPath"]).is_file()
    assert _vol_of_step(res["stepPath"]) > 0.0


@requires_cadquery
def test_bad_op_is_skipped_with_warning_not_raised() -> None:
    """The kernel is sacred: a structurally-bad op (here a hole referencing a
    profileIndex out of range) is SKIPPED with a warning, not raised — the base
    solid still builds and exports."""
    res = bp.build_part(
        _payload([{"kind": "hole_from_profile", "profileIndex": 99, "mode": "through_all"}]),
        tempfile.mkdtemp(),
        "kernel-part",
    )
    assert Path(res["stepPath"]).is_file()
    assert abs(_vol_of_step(res["stepPath"]) - _BASE_VOL) < 1e-3  # op was a no-op
    assert any("profileIndex out of range" in w for w in (res.get("warnings") or []))


@requires_cadquery
def test_revolve_base_builds() -> None:
    """A revolve timeline builds a solid of revolution (sanity for the second
    base-solid path)."""
    res = bp.build_part(
        _payload(
            solidKind="revolve",
            revolve={"angleDeg": 90, "axisX": 0},
            profiles=[{"type": "loop", "points": [[2, 0], [5, 0], [5, 4], [2, 4]]}],
        ),
        tempfile.mkdtemp(),
        "kernel-part",
    )
    assert Path(res["stepPath"]).is_file()
    assert _vol_of_step(res["stepPath"]) > 0.0


@requires_cadquery
def test_subprocess_contract_matches_build_kernel_part_ts() -> None:
    """Invoke EXACTLY as src/main/cad/build-kernel-part.ts does: write the
    payload to a file, spawn ``python build_part.py <payload> <outDir> <base>``,
    and parse the LAST non-empty stdout/stderr line as JSON (mirrors
    runPythonJson). The envelope must carry ok + stepPath + stlPath, and exit 0."""
    one_id = _picked_vertical_edge_id()
    out = tempfile.mkdtemp()
    payload_path = os.path.join(out, ".kernel-build-payload.json")
    with open(payload_path, "w", encoding="utf-8") as f:
        json.dump(
            _payload([{"kind": "fillet_select", "radiusMm": 2.0, "edgeDirection": "+Z", "pickedEdgeIds": [one_id]}]),
            f,
        )

    proc = subprocess.run(
        [sys.executable, str(_BUILD_SCRIPT), payload_path, out, "kernel-part"],
        capture_output=True,
        cwd=str(_REPO_ROOT),
    )
    # The result line MUST be pure ASCII (json ensure_ascii) so a Windows cp1252
    # console can never corrupt the line runPythonJson parses.
    combined = (proc.stdout + proc.stderr).strip().splitlines()
    last = [ln for ln in combined if ln.strip()][-1]
    assert all(b < 128 for b in last), "result line must be ASCII-only"
    parsed = json.loads(last.decode("ascii"))
    assert proc.returncode == 0
    assert parsed["ok"] is True
    assert Path(parsed["stepPath"]).is_file()
    assert Path(parsed["stlPath"]).is_file()


@requires_cadquery
def test_construct_datums_are_markers_not_geometry() -> None:
    """Construct datums (plane / axis / point) are REFERENCE geometry: the kernel
    surfaces them in the manifest ``datums`` list but the built solid is
    BYTE-IDENTICAL to a build without them — a datum can never alter the body
    (Safety Rule 1 + 5)."""
    datum_ops = [
        {"kind": "datum_plane", "basePlane": "XY", "offsetMm": 5.0, "label": "mid"},
        {"kind": "datum_axis", "axis": "Z", "originXMm": 1.0, "originYMm": 2.0, "originZMm": 0.0},
        {"kind": "datum_point", "xMm": 3.0, "yMm": 4.0, "zMm": 5.0, "label": "p"},
    ]
    with_datums = bp.build_part(_payload(datum_ops), tempfile.mkdtemp(), "kernel-part")
    without = bp.build_part(_payload([]), tempfile.mkdtemp(), "kernel-part")

    # Datums surfaced in the manifest (3 entries, kinds + fields echoed).
    datums = with_datums.get("datums")
    assert isinstance(datums, list) and len(datums) == 3
    assert datums[0] == {"kind": "datum_plane", "basePlane": "XY", "offsetMm": 5.0, "label": "mid"}
    assert datums[1]["kind"] == "datum_axis" and datums[1]["originMm"] == [1.0, 2.0, 0.0]
    assert datums[2]["pointMm"] == [3.0, 4.0, 5.0]
    # A build WITHOUT datums carries no datums key.
    assert "datums" not in without

    # The solid is byte-identical: datums never touched the geometry.
    a = Path(with_datums["stlPath"]).read_bytes()
    b = Path(without["stlPath"]).read_bytes()
    assert a == b


@requires_cadquery
def test_bad_datum_fields_skip_with_warning_not_raised() -> None:
    """A structurally-bad datum (bad base plane / axis / NaN coord) is SKIPPED
    with a warning, never raised — the base solid still builds (kernel is
    sacred), and a valid op AFTER the bad ones still applies."""
    res = bp.build_part(
        _payload(
            [
                {"kind": "datum_plane", "basePlane": "BOGUS", "offsetMm": 1.0},
                {"kind": "datum_axis", "axis": "Q"},
                {"kind": "datum_point", "xMm": float("nan"), "yMm": 0, "zMm": 0},
                # A valid datum after the bad ones still records.
                {"kind": "datum_plane", "basePlane": "YZ", "offsetMm": 0.0},
            ]
        ),
        tempfile.mkdtemp(),
        "kernel-part",
    )
    assert Path(res["stepPath"]).is_file()
    assert abs(_vol_of_step(res["stepPath"]) - _BASE_VOL) < 1e-3  # solid unchanged
    warnings = res.get("warnings") or []
    assert any("datum_plane skipped" in w for w in warnings)
    assert any("datum_axis skipped" in w for w in warnings)
    assert any("datum_point" in w for w in warnings)
    # Only the one VALID datum survived into the manifest.
    datums = res.get("datums") or []
    assert len(datums) == 1 and datums[0]["basePlane"] == "YZ"


@requires_cadquery
def test_subprocess_unknown_solid_kind_envelope() -> None:
    """A payload with an unknown solidKind fails with the contracted
    ``unknown_solid_kind`` error code and a non-zero exit (build-kernel-part.ts
    maps this to a user message)."""
    out = tempfile.mkdtemp()
    payload_path = os.path.join(out, "payload.json")
    with open(payload_path, "w", encoding="utf-8") as f:
        json.dump(_payload(solidKind="bogus"), f)

    proc = subprocess.run(
        [sys.executable, str(_BUILD_SCRIPT), payload_path, out, "kernel-part"],
        capture_output=True,
        cwd=str(_REPO_ROOT),
    )
    last = [ln for ln in (proc.stdout + proc.stderr).strip().splitlines() if ln.strip()][-1]
    parsed = json.loads(last.decode("ascii"))
    assert proc.returncode == 1
    assert parsed["ok"] is False
    assert parsed["error"] == "unknown_solid_kind"
