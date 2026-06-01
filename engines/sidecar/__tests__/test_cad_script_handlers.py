"""pytest coverage for the CadQuery script handlers in the sidecar.

Covers the three new methods registered by ``engines/sidecar/cad_handlers.py``:

  * ``cad.execute_script``  — sandboxed CadQuery script execution
  * ``cad.export``          — handle-based STEP / STL / DXF export
  * ``cad.list_operations`` — static AST parse for the FeatureTree

The tests are split into two tiers:

  Tier 1 — **No CadQuery required.** These cover the wire-envelope / param
    validation paths (``unsafe_script``, ``bad_params``,
    ``invalid_numeric_params``, ``cadquery_not_installed``, ``script_no_result``,
    syntax-error parse) and the pure-Python ``list_operations`` AST walker.
    They run in any environment that has the sidecar code on the path —
    including Python 3.14 sandboxes where no CadQuery wheel exists.

  Tier 2 — **CadQuery required.** These are skipped automatically when
    ``import cadquery`` fails. When CadQuery is present, they exercise the
    full execute → tessellate → STL-on-disk → handle-based export round trip
    against a 10×10×10 cube + ensure the binary STL is valid per Safety
    Rule 1 (80-byte header + uint32 count + 50-byte triangles).
"""
from __future__ import annotations

import math
import os
import struct
import tempfile
from pathlib import Path
from typing import Any, Dict

import pytest

from engines.cad.cadquery_import import _HANDLES, reset_handle_table
from engines.cad.cadquery_script import (
    BANNED_TOKENS,
    _CadHandlerError,
    execute_script,
    export_by_handle,
    list_operations,
    scan_banned_tokens,
    tessellate_with_face_ids,
)
from engines.sidecar import cad_handlers


# ── Fixtures / probes ────────────────────────────────────────────────────


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


@pytest.fixture(autouse=True)
def _clean_handle_table() -> None:
    """Reset the global handle table before every test for isolation."""
    reset_handle_table()
    yield
    reset_handle_table()


# ── Tier 1: banned-token tripwire ────────────────────────────────────────


@pytest.mark.parametrize(
    "snippet",
    [
        "import os\nresult = 1",
        "import sys\nresult = 1",
        "import subprocess\nresult = 1",
        "from os import path\nresult = 1",
        "x = __import__('os')",
        "open('/etc/passwd')",
        "eval('1+1')",
        "exec('print(1)')",
        "compile('1', 'f', 'eval')",
        "getattr(object, 'x')",
    ],
)
def test_execute_script_rejects_banned_tokens(snippet: str) -> None:
    """Every banned-token form must raise ``unsafe_script`` before any exec."""
    with pytest.raises(_CadHandlerError) as exc_info:
        execute_script(snippet)
    assert exc_info.value.code == "unsafe_script"


def test_scan_banned_tokens_returns_first_match() -> None:
    assert scan_banned_tokens("clean script\nresult = 1") is None
    # Confirm the scanner returns the SPECIFIC token that tripped — not just
    # a boolean. UI surfaces this so the user knows what to remove. The scan
    # order is the BANNED_TOKENS tuple order (NOT source order in the
    # script), so we assert against whichever banned token appears first in
    # the tuple from the candidates present.
    hit = scan_banned_tokens("import sys\nimport os")
    assert hit in BANNED_TOKENS
    candidates = {"import sys", "import os"}
    first_in_tuple = next(tok for tok in BANNED_TOKENS if tok in candidates)
    assert hit == first_in_tuple


# ── Tier 1: handler-level param validation ───────────────────────────────


def test_execute_script_handler_requires_script_param() -> None:
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.execute_script({})
    assert exc_info.value.code == "bad_params"


def test_execute_script_rejects_non_dict_build_parameters() -> None:
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.execute_script({
            "script": "result = 1",
            "buildParameters": "not a dict",
        })
    assert exc_info.value.code == "bad_params"


def test_export_handler_requires_handle_outpath_format() -> None:
    # Missing handle
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.export({"outPath": "/tmp/x.step", "format": "step"})
    assert exc_info.value.code == "bad_params"
    # Missing outPath
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.export({"handle": "script:abc", "format": "step"})
    assert exc_info.value.code == "bad_params"
    # Missing format
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.export({"handle": "script:abc", "outPath": "/tmp/x"})
    assert exc_info.value.code == "bad_params"


def test_export_handler_rejects_null_byte_path() -> None:
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.export({
            "handle": "script:abc",
            "outPath": "/tmp/evil\x00.step",
            "format": "step",
        })
    assert exc_info.value.code == "bad_params"


def test_export_handler_rejects_bad_format() -> None:
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.export({
            "handle": "script:abc",
            "outPath": "/tmp/x.foo",
            "format": "obj",
        })
    assert exc_info.value.code == "bad_params"


def test_export_handler_rejects_negative_tolerance() -> None:
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.export({
            "handle": "script:abc",
            "outPath": "/tmp/x.stl",
            "format": "stl",
            "toleranceMm": -1.0,
        })
    assert exc_info.value.code == "invalid_numeric_params"


def test_export_handler_rejects_non_numeric_tolerance() -> None:
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.export({
            "handle": "script:abc",
            "outPath": "/tmp/x.stl",
            "format": "stl",
            "toleranceMm": "tight",
        })
    assert exc_info.value.code == "invalid_numeric_params"


def test_export_handler_rejects_unknown_handle_when_no_cadquery() -> None:
    """When the handle is not in the table the export must fail with
    invalid_handle BEFORE we attempt the STL/STEP write — regardless of
    whether CadQuery is installed in the env.
    """
    # Using STL format on purpose because that path calls tessellate_body,
    # which does the handle-table lookup before any disk I/O.
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.export({
            "handle": "script:never-existed",
            "outPath": str(Path(tempfile.gettempdir()) / "wt-export-test.stl"),
            "format": "stl",
            "toleranceMm": 0.1,
        })
    assert exc_info.value.code == "invalid_handle"


# ── Tier 1: list_operations (pure AST, no cadquery needed) ──────────────


def test_list_operations_returns_empty_for_empty_script() -> None:
    r = list_operations("")
    assert r == {"parameters": [], "operations": []}


def test_list_operations_extracts_top_level_literal_parameters() -> None:
    script = """
length = 50
width = 30.5
mirror = True
label = 'big-plate'
"""
    r = list_operations(script)
    by_name = {p["name"]: p for p in r["parameters"]}
    assert by_name["length"] == {"name": "length", "value": 50, "kind": "number"}
    assert by_name["width"] == {"name": "width", "value": 30.5, "kind": "number"}
    assert by_name["mirror"] == {"name": "mirror", "value": True, "kind": "boolean"}
    assert by_name["label"] == {"name": "label", "value": "big-plate", "kind": "string"}


def test_list_operations_extracts_negative_literal_parameters() -> None:
    # ``UnaryOp(USub, Constant)`` should classify as a number with negated value.
    script = "depth = -5\n"
    r = list_operations(script)
    assert r["parameters"] == [
        {"name": "depth", "value": -5, "kind": "number"},
    ]


def test_list_operations_ignores_non_literal_assignments() -> None:
    script = """
length = 50
plate = cq.Workplane('XY')
"""
    r = list_operations(script)
    names = [p["name"] for p in r["parameters"]]
    assert "length" in names
    assert "plate" not in names  # Workplane call is not a literal


def test_list_operations_finds_all_mvp_operations() -> None:
    """Every operation in the MVP list must produce an entry."""
    script = """
import cadquery as cq
plate = (
    cq.Workplane('XY')
    .rect(50, 30)
    .circle(5)
    .polygon(6, 20)
    .extrude(10)
    .revolve()
    .sweep(path)
    .loft()
    .fillet(2.0)
    .chamfer(1.0)
    .shell(0.5)
    .hole(3)
    .cboreHole(3, 6, 2)
    .cskHole(3, 6, 82.0)
    .union(other)
    .cut(other)
    .intersect(other)
    .text('hi', 10, 1)
)
"""
    r = list_operations(script)
    kinds = [op["kind"] for op in r["operations"]]
    # cboreHole / cskHole / union / cut / intersect / text — all expected
    for expected in [
        "workplane", "rect", "circle", "polygon", "extrude", "revolve",
        "sweep", "loft", "fillet", "chamfer", "shell", "hole",
        "cboreHole", "cskHole", "union", "cut", "intersect", "text",
    ]:
        assert expected in kinds, f"missing {expected!r} in {kinds}"


def test_list_operations_orders_by_construction() -> None:
    """For a chained expression, operations must be returned in the order
    the user typed them — Workplane → rect → extrude → fillet, NOT the
    reverse (which is what ``ast.walk`` visits because the outer Call
    nodes have the same col_offset as the inner ones).
    """
    script = "result = cq.Workplane('XY').rect(50, 30).extrude(10).fillet(2.0)\n"
    r = list_operations(script)
    kinds = [op["kind"] for op in r["operations"]]
    assert kinds == ["workplane", "rect", "extrude", "fillet"]
    # Indices must match position (0, 1, 2, 3).
    for i, op in enumerate(r["operations"]):
        assert op["index"] == i


def test_list_operations_reports_syntax_error_with_line() -> None:
    """SyntaxError must surface as ``parseError`` with the source line — the
    renderer underlines that line in the editor.
    """
    script = "result = (\n"  # unclosed paren
    r = list_operations(script)
    assert "parseError" in r
    assert r["parseError"]["line"] == 1
    assert isinstance(r["parseError"]["message"], str)
    assert r["operations"] == []
    assert r["parameters"] == []


def test_list_operations_summary_truncates_long_args() -> None:
    """The summary line for a call with very long args must be truncated so
    the FeatureTree row stays one-line-friendly.
    """
    long_text = "x" * 200
    script = f"result = cq.Workplane('XY').text('{long_text}', 5, 1)\n"
    r = list_operations(script)
    text_ops = [op for op in r["operations"] if op["kind"] == "text"]
    assert len(text_ops) == 1
    assert len(text_ops[0]["summary"]) <= 80  # method name + truncated inside


def test_list_operations_handler_returns_same_shape() -> None:
    """The handler wrapper must pass through to the pure function unchanged."""
    r = cad_handlers.list_operations({"script": "x = 1\n"})
    assert r == {
        "parameters": [{"name": "x", "value": 1, "kind": "number"}],
        "operations": [],
    }


# ── Tier 1: execute_script without cadquery → cadquery_not_installed ─────


def test_execute_script_surfaces_cadquery_not_installed_when_missing() -> None:
    """When cadquery is absent, a clean-looking script must surface the
    ``cadquery_not_installed`` envelope (not a generic exception). This is
    the path the TS bridge maps to the operator-facing install hint.
    """
    if _cadquery_available():
        pytest.skip("cadquery IS installed; this test only covers the missing case")
    with pytest.raises(_CadHandlerError) as exc_info:
        execute_script("result = 42")  # legit syntax, no banned tokens
    assert exc_info.value.code == "cadquery_not_installed"


# ── Tier 2: full CadQuery round trip ─────────────────────────────────────


@requires_cadquery
def test_execute_script_round_trip_cube_via_handler() -> None:
    """Run a parametric cube script through the sidecar handler. Validate
    the wire envelope shape (handle, stlPath, triangleCount, bbox) and that
    the on-disk STL is well-formed binary STL per Safety Rule 1.
    """
    script = """
import cadquery as cq
length = 10
width = 10
height = 10
result = cq.Workplane('XY').box(length, width, height)
"""
    r = cad_handlers.execute_script({"script": script})

    assert "meshes" in r
    assert len(r["meshes"]) == 1
    mesh = r["meshes"][0]
    assert mesh["handle"].startswith("script:")
    assert mesh["triangleCount"] > 0
    assert mesh["bbox"]["min"][0] < 0  # box centered at origin
    assert mesh["bbox"]["max"][0] > 0

    # Safety Rule 1: binary STL = 80 header + uint32 count + 50*N.
    stl_path = Path(mesh["stlPath"])
    assert stl_path.exists()
    bytes_on_disk = stl_path.read_bytes()
    assert len(bytes_on_disk) == 80 + 4 + 50 * mesh["triangleCount"]
    header_count = struct.unpack("<I", bytes_on_disk[80:84])[0]
    assert header_count == mesh["triangleCount"]

    # faceCount mirrors triangleCount for a single-body result.
    assert r["faceCount"] == mesh["triangleCount"]


@requires_cadquery
def test_execute_script_threads_build_parameters() -> None:
    """``buildParameters`` must land as top-level names inside the script
    namespace so a parametric edit (e.g. slider change) re-runs without
    rewriting the script."""
    script = """
import cadquery as cq
result = cq.Workplane('XY').box(length, width, height)
"""
    r = cad_handlers.execute_script({
        "script": script,
        "buildParameters": {"length": 5, "width": 5, "height": 20},
    })
    mesh = r["meshes"][0]
    # bbox Z extent should be ~20mm (height) and X/Y should be ~5mm.
    z_extent = mesh["bbox"]["max"][2] - mesh["bbox"]["min"][2]
    x_extent = mesh["bbox"]["max"][0] - mesh["bbox"]["min"][0]
    assert abs(z_extent - 20.0) < 0.01
    assert abs(x_extent - 5.0) < 0.01


@requires_cadquery
def test_execute_script_build_parameters_round_trip_changes_bbox() -> None:
    """CAD V1 round-trip pin: the same script run twice with different
    ``buildParameters`` overrides MUST produce different geometry.

    This is the load-bearing contract for the FeatureTree's editable
    parameter UX — clicking "Apply" with a new value must re-run the
    script through cqgi so the bbox actually reflects the override
    (otherwise the operator is editing dead UI). We assert max-X of
    the resulting bbox tracks the ``L`` override because the script
    uses ``L`` as the box X dimension and ``cq.Workplane('XY').box``
    centers the solid at the origin (max-X = L / 2).
    """
    script = """
import cadquery as cq
L = 10
result = cq.Workplane('XY').box(L, 1, 1)
"""

    # First run: no override -> script default L = 10 -> max-X = 5.
    r1 = cad_handlers.execute_script({"script": script})
    bbox1 = r1["meshes"][0]["bbox"]
    assert abs(bbox1["max"][0] - 5.0) < 0.01, (
        f"default L=10 should produce max-X≈5, got {bbox1['max'][0]!r}"
    )

    # Second run: override L to 25 -> max-X = 12.5. Same script body.
    r2 = cad_handlers.execute_script({
        "script": script,
        "buildParameters": {"L": 25},
    })
    bbox2 = r2["meshes"][0]["bbox"]
    assert abs(bbox2["max"][0] - 12.5) < 0.01, (
        f"override L=25 should produce max-X≈12.5, got {bbox2['max'][0]!r}"
    )

    # And the two runs MUST land on different handles — the override
    # path goes through the same _tessellate_and_register helper, so a
    # collision would indicate the handle table is keyed by script text
    # instead of execution.
    assert r1["meshes"][0]["handle"] != r2["meshes"][0]["handle"]


@requires_cadquery
def test_execute_script_captures_show_object_results() -> None:
    """A CQGI-style script using ``show_object`` must produce one mesh per
    call, in source order, even without a top-level ``result`` assignment.
    """
    script = """
import cadquery as cq
show_object(cq.Workplane('XY').box(10, 10, 10), name='cube')
show_object(cq.Workplane('XY').cylinder(20, 5), name='cyl')
"""
    r = cad_handlers.execute_script({"script": script})
    assert len(r["meshes"]) == 2
    # Both got handles in the global table.
    for m in r["meshes"]:
        assert m["handle"] in _HANDLES


@requires_cadquery
def test_execute_script_no_result_raises() -> None:
    """A script that finishes without assigning ``result`` or calling
    ``show_object`` must surface ``script_no_result`` so the renderer can
    show 'add `result = …` to your script' inline.
    """
    script = "x = 1 + 2\n"  # no result, no show_object
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.execute_script({"script": script})
    assert exc_info.value.code == "script_no_result"


@requires_cadquery
def test_execute_script_script_exec_error_carries_repr() -> None:
    """A user-script runtime error must surface as ``script_exec_error`` and
    carry the original exception repr in ``detail`` so the operator can see
    what blew up."""
    script = """
import cadquery as cq
result = cq.Workplane('XY').extrude(10)  # extrude with no sketch -> error
"""
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.execute_script({"script": script})
    assert exc_info.value.code == "script_exec_error"
    assert exc_info.value.detail  # repr captured


@requires_cadquery
def test_export_handle_round_trip_step_and_stl() -> None:
    """End-to-end: execute_script → grab handle → cad.export to STEP, then
    to STL. Both files must exist on disk with non-zero size, and the STL
    must match the binary-STL shape.
    """
    script = """
import cadquery as cq
result = cq.Workplane('XY').box(15, 10, 5)
"""
    exec_result = cad_handlers.execute_script({"script": script})
    handle = exec_result["meshes"][0]["handle"]

    with tempfile.TemporaryDirectory() as tmp:
        # STEP export
        step_path = os.path.join(tmp, "out.step")
        step_r = cad_handlers.export({
            "handle": handle,
            "outPath": step_path,
            "format": "step",
        })
        assert step_r["outPath"] == step_path
        assert step_r["bytesWritten"] > 0
        assert Path(step_path).exists()

        # STL export
        stl_path = os.path.join(tmp, "out.stl")
        stl_r = cad_handlers.export({
            "handle": handle,
            "outPath": stl_path,
            "format": "stl",
            "toleranceMm": 0.1,
        })
        assert stl_r["outPath"] == stl_path
        assert stl_r["bytesWritten"] >= 84  # 80 header + 4 count, even empty
        stl_bytes = Path(stl_path).read_bytes()
        assert len(stl_bytes) == stl_r["bytesWritten"]
        # Header is 80 bytes; uint32 count follows.
        header_count = struct.unpack("<I", stl_bytes[80:84])[0]
        assert header_count > 0


@requires_cadquery
def test_export_invalid_handle_raises() -> None:
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.export({
            "handle": "script:never-existed",
            "outPath": str(Path(tempfile.gettempdir()) / "ghost.step"),
            "format": "step",
        })
    # When cadquery IS installed but the handle isn't, we should see
    # invalid_handle (not cadquery_not_installed).
    assert exc_info.value.code == "invalid_handle"


# ── Sidecar dispatch table includes the new methods ──────────────────────


def test_dispatch_table_registers_new_cad_methods() -> None:
    """The sidecar dispatch table MUST expose every method name the TS bridge
    can call by dotted name. Drift here breaks the wire contract.

    BUILD 2 adds ``cad.tessellate_with_ids`` — the selection-grade
    tessellator that powers the CAD V1 face-picking workflow.
    """
    from engines.sidecar.main import _build_dispatch_table

    table = _build_dispatch_table()
    assert "cad.execute_script" in table
    assert "cad.export" in table
    assert "cad.list_operations" in table
    assert "cad.tessellate_with_ids" in table


# ── Tier 1: tessellate_with_ids handler-level param validation ───────────


def test_tessellate_with_ids_requires_handle() -> None:
    """Empty params must short-circuit with ``bad_params`` before we touch
    the CadQuery import — same posture as ``cad.export``."""
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.tessellate_with_ids({})
    assert exc_info.value.code == "bad_params"


def test_tessellate_with_ids_rejects_negative_tolerance() -> None:
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.tessellate_with_ids({
            "handle": "script:never-existed",
            "toleranceMm": -0.5,
        })
    assert exc_info.value.code == "invalid_numeric_params"


def test_tessellate_with_ids_rejects_non_numeric_tolerance() -> None:
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.tessellate_with_ids({
            "handle": "script:never-existed",
            "toleranceMm": "fine",
        })
    assert exc_info.value.code == "invalid_numeric_params"


def test_tessellate_with_ids_rejects_unknown_handle_when_no_cadquery() -> None:
    """Handle lookup happens BEFORE CadQuery import so the failure mode is
    deterministic regardless of whether the pip dependency exists in the
    sidecar env."""
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.tessellate_with_ids({
            "handle": "script:never-existed",
            "toleranceMm": 0.1,
        })
    assert exc_info.value.code == "invalid_handle"


# ── Tier 2: face-tagged tessellation full round-trip ─────────────────────


@requires_cadquery
def test_tessellate_with_ids_box_has_six_faces() -> None:
    """A cq.box has 6 axis-aligned faces by construction. The face-tagged
    tessellation MUST surface all six in the ``faceMap`` dict, and every
    triangle MUST be tagged with a face id in the 0..5 range — the load-
    bearing pre-condition for the renderer's mouse-ray → face mapping.
    """
    script = """
import cadquery as cq
result = cq.Workplane('XY').box(20, 15, 10)
"""
    exec_result = cad_handlers.execute_script({"script": script})
    handle = exec_result["meshes"][0]["handle"]

    r = cad_handlers.tessellate_with_ids({"handle": handle})

    # Shape sanity. Vertices come in flat (x,y,z) triples; indices come in
    # flat (i0,i1,i2) triples.
    assert isinstance(r["vertices"], list)
    assert isinstance(r["indices"], list)
    assert isinstance(r["faceIds"], list)
    assert len(r["vertices"]) % 3 == 0
    assert len(r["indices"]) % 3 == 0

    # Parallel-array invariant — broken contract means every renderer
    # selection lookup silently lies about which face was hit.
    assert len(r["faceIds"]) == r["triangleCount"]
    assert len(r["indices"]) == r["triangleCount"] * 3

    # bbox echoed from the handle.
    bbox = r["bbox"]
    assert bbox["min"][0] < 0 < bbox["max"][0]  # box centered at origin

    # 6 faces in the dict, keyed by string id.
    face_map = r["faceMap"]
    assert isinstance(face_map, dict)
    assert len(face_map) == 6, f"expected 6 faces, got {sorted(face_map.keys())}"
    for face_id in range(6):
        entry = face_map[str(face_id)]
        assert entry["kind"] == "face"
        # Every box face should have non-zero area.
        assert entry["area"] > 0.0, (
            f"face {face_id} reported zero area: {entry!r}"
        )
        # occtHash is always an int; 0 is a fallback for binding mismatches.
        assert isinstance(entry["occtHash"], int)

    # Every triangle must be tagged with a face id pointing into the face_map.
    valid_ids = set(int(k) for k in face_map.keys())
    assert all(fid in valid_ids for fid in r["faceIds"]), (
        f"unknown face ids in faceIds; valid={valid_ids}"
    )


@requires_cadquery
def test_tessellate_with_ids_face_ids_stable_across_reruns() -> None:
    """Stability pin: the same script produces the same face id assignment
    across two independent execute_script → tessellate_with_ids round trips.
    This is what lets the renderer remember a selection across edits — if
    face id 3 means "top" today it must mean "top" tomorrow.
    """
    script = """
import cadquery as cq
result = cq.Workplane('XY').box(20, 15, 10)
"""
    # First run
    exec1 = cad_handlers.execute_script({"script": script})
    r1 = cad_handlers.tessellate_with_ids({"handle": exec1["meshes"][0]["handle"]})

    # Second run — same script, fresh handle.
    exec2 = cad_handlers.execute_script({"script": script})
    r2 = cad_handlers.tessellate_with_ids({"handle": exec2["meshes"][0]["handle"]})

    # Same face count + same per-face areas (within tessellation noise).
    assert set(r1["faceMap"].keys()) == set(r2["faceMap"].keys())
    for fid in r1["faceMap"]:
        a1 = r1["faceMap"][fid]["area"]
        a2 = r2["faceMap"][fid]["area"]
        assert abs(a1 - a2) < 1e-6, (
            f"face {fid} area drifted: run1={a1!r} run2={a2!r}"
        )
        # OCCT hash is the strongest stability signal we can publish to the
        # renderer. If CadQuery's binding exposes HashCode (common case), the
        # two runs MUST agree — same construction history → same hash.
        h1 = r1["faceMap"][fid]["occtHash"]
        h2 = r2["faceMap"][fid]["occtHash"]
        if h1 != 0 or h2 != 0:  # both 0 means binding mismatch, not a drift
            assert h1 == h2, (
                f"face {fid} OCCT hash drifted: run1={h1} run2={h2}"
            )


@requires_cadquery
def test_tessellate_with_ids_face_ids_within_triangle_count() -> None:
    """Every entry of ``faceIds`` MUST be a non-negative integer within the
    ``faceMap`` key set. A renderer that hits an unknown face id falls back
    to "no selection", which is a silent loss of click responsiveness.
    """
    script = """
import cadquery as cq
result = cq.Workplane('XY').box(10, 10, 10)
"""
    exec_result = cad_handlers.execute_script({"script": script})
    r = cad_handlers.tessellate_with_ids({
        "handle": exec_result["meshes"][0]["handle"],
        "toleranceMm": 0.05,
    })

    valid_ids = set(int(k) for k in r["faceMap"].keys())
    for fid in r["faceIds"]:
        assert isinstance(fid, int)
        assert fid >= 0
        assert fid in valid_ids


@requires_cadquery
def test_execute_script_embeds_face_map_on_meshes() -> None:
    """``cad.execute_script`` MUST also embed the face-tagged tessellation
    on each produced mesh (best-effort) so the renderer can wire selection
    immediately without a second IPC round trip.

    A future CadQuery refactor that breaks ``face.tessellate`` would surface
    as a missing ``faceMap`` / ``faceIds`` on the mesh (the selection-failure
    fallback), NOT as a broken ``execute_script`` result — Safety Rule 1:
    the CAM STL path must keep working even when selection breaks.
    """
    script = """
import cadquery as cq
result = cq.Workplane('XY').box(8, 8, 8)
"""
    r = cad_handlers.execute_script({"script": script})
    mesh = r["meshes"][0]
    # Backward-compat: existing fields are always present.
    assert "handle" in mesh
    assert "stlPath" in mesh
    assert "triangleCount" in mesh
    assert "bbox" in mesh
    # New CAD V1 selection fields (best-effort — absence is documented).
    assert "faceMap" in mesh
    assert "faceIds" in mesh
    assert len(mesh["faceMap"]) == 6  # box has 6 faces
    assert len(mesh["faceIds"]) > 0
    # Every faceId must point into the faceMap.
    valid = set(int(k) for k in mesh["faceMap"].keys())
    assert all(fid in valid for fid in mesh["faceIds"])


@requires_cadquery
def test_tessellate_with_ids_cylinder_lateral_face_has_area() -> None:
    """A cylinder has 3 faces (top disk, bottom disk, curved side). The
    curved side is the largest face and the one selection in real-world
    use most often. Pin its area to a known formula so a CadQuery refactor
    that drops the curved face from the face list is caught immediately.
    """
    script = """
import cadquery as cq
# Radius 5, height 20 -> lateral area = 2 * pi * r * h = 200*pi ≈ 628.319
result = cq.Workplane('XY').cylinder(20, 5)
"""
    exec_result = cad_handlers.execute_script({"script": script})
    r = cad_handlers.tessellate_with_ids({
        "handle": exec_result["meshes"][0]["handle"],
    })

    assert len(r["faceMap"]) == 3  # top + bottom + side
    # The largest face is the cylindrical side.
    areas = sorted((entry["area"] for entry in r["faceMap"].values()), reverse=True)
    largest = areas[0]
    expected_lateral = 2.0 * math.pi * 5.0 * 20.0
    assert abs(largest - expected_lateral) < 1.0, (
        f"lateral area mismatch: got {largest!r}, expected ~{expected_lateral!r}"
    )
