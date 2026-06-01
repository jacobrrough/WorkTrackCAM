"""pytest coverage for the CadQuery Assembly handlers in the sidecar.

Covers the three new methods registered by ``engines/sidecar/cad_handlers.py``:

  * ``cad.create_assembly``     — wrap part handles + per-child transforms in
                                   a ``cq.Assembly``.
  * ``cad.tessellate_assembly`` — walk the assembly hierarchy and produce a
                                   flat-buffer mesh (vertices / indices /
                                   faceIds / faceMap).
  * ``cad.export_assembly``     — export to STEP (hierarchy-preserving) or
                                   STL (flattened).

The tests follow the same Tier 1 / Tier 2 split as ``test_cad_script_handlers.py``:

  Tier 1 — **No CadQuery required.** Wire-envelope / param validation
    paths (``bad_params``, ``invalid_handle``, ``invalid_numeric_params``,
    ``not_an_assembly``, ``assembly_not_supported``). These run in any env.

  Tier 2 — **CadQuery required.** Skipped automatically when
    ``import cadquery`` fails. When CadQuery is present, exercises the full
    create → tessellate → export round trip for 2-part and 3-part assemblies
    with both identity and translated child transforms.
"""
from __future__ import annotations

import os
import struct
import tempfile
from pathlib import Path
from typing import Any, Dict, List

import pytest

from engines.cad.cadquery_import import _HANDLES, reset_handle_table
from engines.cad.cadquery_assembly import (
    ALLOWED_ASSEMBLY_FORMATS,
    build_assembly_from_parts,
    export_assembly,
    tessellate_assembly,
)
from engines.cad.cadquery_import import _CadHandlerError
from engines.sidecar import cad_handlers


# ── Fixtures / probes ────────────────────────────────────────────────────


def _cadquery_available() -> bool:
    try:
        import cadquery  # noqa: F401 - probe only
        return True
    except ImportError:
        return False


def _cadquery_assembly_available() -> bool:
    """True iff cq.Assembly is exposed in the current build.

    Mirrors the same fallback the assembly core itself uses — a CadQuery build
    without ``cq.Assembly`` should make Tier 2 tests SKIP cleanly, not fail.
    """
    try:
        import cadquery as cq  # noqa: PLC0415

        return hasattr(cq, "Assembly")
    except ImportError:
        return False


requires_cadquery = pytest.mark.skipif(
    not _cadquery_available(),
    reason="cadquery not installed in this environment",
)


requires_assembly = pytest.mark.skipif(
    not _cadquery_assembly_available(),
    reason="cadquery.Assembly not available in this CadQuery build",
)


@pytest.fixture(autouse=True)
def _clean_handle_table() -> None:
    """Reset the global handle table before every test for isolation."""
    reset_handle_table()
    yield
    reset_handle_table()


def _identity_matrix() -> List[List[float]]:
    return [
        [1.0, 0.0, 0.0, 0.0],
        [0.0, 1.0, 0.0, 0.0],
        [0.0, 0.0, 1.0, 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ]


def _translation_matrix(dx: float, dy: float, dz: float) -> List[List[float]]:
    return [
        [1.0, 0.0, 0.0, dx],
        [0.0, 1.0, 0.0, dy],
        [0.0, 0.0, 1.0, dz],
        [0.0, 0.0, 0.0, 1.0],
    ]


def _make_box_handle(size: float = 10.0) -> str:
    """Helper: run a tiny CadQuery script to produce a single-body handle.

    Used by Tier 2 tests to populate the handle table before exercising the
    assembly path. Centralized here so updating the script body in one place
    propagates everywhere.
    """
    script = f"""
import cadquery as cq
result = cq.Workplane('XY').box({size}, {size}, {size})
"""
    r = cad_handlers.execute_script({"script": script})
    return r["meshes"][0]["handle"]


# ── Tier 1: dispatch table registration ──────────────────────────────────


def test_dispatch_table_registers_assembly_methods() -> None:
    """The sidecar dispatch table MUST expose the three new assembly methods
    by their dotted names. Drift here breaks the wire contract."""
    from engines.sidecar.main import _build_dispatch_table

    table = _build_dispatch_table()
    assert "cad.create_assembly" in table
    assert "cad.tessellate_assembly" in table
    assert "cad.export_assembly" in table


# ── Tier 1: create_assembly param validation ─────────────────────────────


def test_create_assembly_requires_parts_array() -> None:
    """Missing ``parts`` must short-circuit with ``bad_params`` before we
    touch CadQuery."""
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.create_assembly({})
    assert exc_info.value.code == "bad_params"


def test_create_assembly_rejects_non_array_parts() -> None:
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.create_assembly({"parts": "not an array"})
    assert exc_info.value.code == "bad_params"


def test_create_assembly_rejects_empty_parts() -> None:
    """An empty parts list is meaningless and should be rejected before any
    CadQuery construction — same posture as ``cad.execute_script``'s
    ``script_no_result``."""
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.create_assembly({"parts": []})
    assert exc_info.value.code == "bad_params"


def test_create_assembly_rejects_non_string_name() -> None:
    """``name`` is optional but must be a non-empty string when provided —
    catches a renderer bug that passes a number instead of a label."""
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.create_assembly({
            "parts": [{"handle": "script:abc", "transform": "identity"}],
            "name": 42,
        })
    assert exc_info.value.code == "bad_params"


def test_create_assembly_rejects_part_without_handle() -> None:
    """Every parts entry must carry a non-empty ``handle`` string. A missing
    handle would silently drop the child in the assembly — surface it as a
    structured error instead."""
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.create_assembly({
            "parts": [{"transform": "identity"}],
        })
    assert exc_info.value.code == "bad_params"


def test_create_assembly_rejects_unknown_handle() -> None:
    """An unknown handle must produce ``invalid_handle`` BEFORE we attempt to
    import CadQuery — keeps the failure mode deterministic across environments
    that lack the pip dependency."""
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.create_assembly({
            "parts": [{"handle": "script:never-existed", "transform": "identity"}],
        })
    assert exc_info.value.code == "invalid_handle"


def test_create_assembly_rejects_malformed_transform_shape() -> None:
    """A transform with wrong row count must produce ``bad_params`` rather
    than letting OCP's Matrix constructor crash with an opaque error."""
    # First seed the handle table so the validator reaches the transform check.
    _HANDLES["script:fake"] = _HANDLES.get(
        "script:fake",
        _make_fake_doc(),
    )
    try:
        with pytest.raises(_CadHandlerError) as exc_info:
            cad_handlers.create_assembly({
                "parts": [{
                    "handle": "script:fake",
                    "transform": [[1.0, 0.0, 0.0, 0.0]],  # 1 row, not 4
                }],
            })
        assert exc_info.value.code == "bad_params"
    finally:
        _HANDLES.pop("script:fake", None)


def test_create_assembly_rejects_non_finite_transform_value() -> None:
    """NaN / Inf in a transform cell must surface as ``bad_params`` — would
    otherwise propagate into the renderer's BufferGeometry and silently
    corrupt the viewport."""
    _HANDLES["script:fake"] = _make_fake_doc()
    try:
        bad_matrix = _identity_matrix()
        bad_matrix[0][3] = float("inf")
        with pytest.raises(_CadHandlerError) as exc_info:
            cad_handlers.create_assembly({
                "parts": [{
                    "handle": "script:fake",
                    "transform": bad_matrix,
                }],
            })
        assert exc_info.value.code == "bad_params"
    finally:
        _HANDLES.pop("script:fake", None)


# ── Tier 1: tessellate_assembly param validation ─────────────────────────


def test_tessellate_assembly_requires_handle() -> None:
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.tessellate_assembly({})
    assert exc_info.value.code == "bad_params"


def test_tessellate_assembly_rejects_negative_tolerance() -> None:
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.tessellate_assembly({
            "handle": "assembly:fake",
            "toleranceMm": -0.5,
        })
    assert exc_info.value.code == "invalid_numeric_params"


def test_tessellate_assembly_rejects_non_numeric_tolerance() -> None:
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.tessellate_assembly({
            "handle": "assembly:fake",
            "toleranceMm": "tight",
        })
    assert exc_info.value.code == "invalid_numeric_params"


def test_tessellate_assembly_rejects_unknown_handle() -> None:
    """Handle lookup happens before CadQuery import so the failure mode is
    deterministic regardless of whether the pip dep is installed."""
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.tessellate_assembly({
            "handle": "assembly:never-existed",
        })
    assert exc_info.value.code == "invalid_handle"


# ── Tier 1: export_assembly param validation ─────────────────────────────


def test_export_assembly_requires_handle_outpath_format() -> None:
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.export_assembly({"outPath": "/tmp/x.step", "format": "step"})
    assert exc_info.value.code == "bad_params"


def test_export_assembly_rejects_null_byte_path() -> None:
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.export_assembly({
            "handle": "assembly:abc",
            "outPath": "/tmp/evil\x00.step",
            "format": "step",
        })
    assert exc_info.value.code == "bad_params"


def test_export_assembly_rejects_unsupported_format() -> None:
    """DXF is intentionally not allowed for assemblies — has no component
    concept and CadQuery cannot meaningfully flatten an assembly into a
    2-D drawing."""
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.export_assembly({
            "handle": "assembly:abc",
            "outPath": "/tmp/x.dxf",
            "format": "dxf",
        })
    assert exc_info.value.code == "bad_params"


def test_export_assembly_rejects_unknown_handle_when_no_cadquery() -> None:
    """Unknown handle must produce ``invalid_handle`` BEFORE CadQuery import
    so the failure mode is deterministic across environments."""
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.export_assembly({
            "handle": "assembly:never-existed",
            "outPath": str(Path(tempfile.gettempdir()) / "wt-assembly-test.step"),
            "format": "step",
        })
    assert exc_info.value.code == "invalid_handle"


def test_allowed_assembly_formats_excludes_dxf() -> None:
    """Pin: STL + STEP only. DXF is excluded by design — adding it would
    require a 2D-projection pass that lives in cadquery_drawing.py, not
    cadquery_assembly.py."""
    assert "step" in ALLOWED_ASSEMBLY_FORMATS
    assert "stl" in ALLOWED_ASSEMBLY_FORMATS
    assert "dxf" not in ALLOWED_ASSEMBLY_FORMATS


# ── Tier 2: full CadQuery round trip ─────────────────────────────────────


@requires_cadquery
@requires_assembly
def test_create_assembly_2_part_bbox_is_union_of_children() -> None:
    """A 2-part assembly with identity transforms must have a bbox equal to
    the per-axis union of the two child bboxes.

    Construction: two 10mm cubes both centered at origin → bbox is the
    single cube's bbox (they overlap exactly). This is the load-bearing
    sanity pin for the bbox-union math in ``_assembly_bbox``.
    """
    handle_a = _make_box_handle(size=10.0)
    handle_b = _make_box_handle(size=10.0)

    r = cad_handlers.create_assembly({
        "parts": [
            {"handle": handle_a, "name": "cube_a", "transform": "identity"},
            {"handle": handle_b, "name": "cube_b", "transform": "identity"},
        ],
        "name": "TwoCubes",
    })

    assert r["handle"].startswith("assembly:")
    assert r["childCount"] == 2
    # Both cubes are 10mm centered at origin → bbox is (-5, -5, -5) to (5, 5, 5).
    assert abs(r["bbox"]["min"][0] - (-5.0)) < 0.01
    assert abs(r["bbox"]["max"][0] - 5.0) < 0.01
    assert abs(r["bbox"]["min"][2] - (-5.0)) < 0.01
    assert abs(r["bbox"]["max"][2] - 5.0) < 0.01


@requires_cadquery
@requires_assembly
def test_create_assembly_3_part_with_translation_reports_combined_extent() -> None:
    """A 3-part assembly with one child translated by -50mm on X must report
    a bbox extending at least 45mm into negative X (50 offset - 5 half-size).

    This is the second load-bearing pin for the bbox-union math: it proves
    that the per-child transform is correctly applied to the cached bbox
    corners (not just to the assembly hierarchy)."""
    h_a = _make_box_handle(size=10.0)
    h_b = _make_box_handle(size=10.0)
    h_c = _make_box_handle(size=10.0)

    r = cad_handlers.create_assembly({
        "parts": [
            {"handle": h_a, "name": "a", "transform": "identity"},
            {"handle": h_b, "name": "b", "transform": _translation_matrix(0, 0, 0)},
            {"handle": h_c, "name": "c", "transform": _translation_matrix(-50.0, 0, 0)},
        ],
    })

    assert r["childCount"] == 3
    # Cube C shifted -50 on X → its min-X corner is at -55. Assembly min-X
    # should match that within tessellation noise (no tessellation here — just
    # the bbox math).
    assert r["bbox"]["min"][0] <= -54.99, (
        f"expected min-X <= -54.99, got {r['bbox']['min'][0]!r}"
    )
    # Cubes A/B span [-5, +5] on X → assembly max-X stays at +5.
    assert abs(r["bbox"]["max"][0] - 5.0) < 0.01


@requires_cadquery
@requires_assembly
def test_tessellate_assembly_round_trip_2_part() -> None:
    """End-to-end: create_assembly → tessellate_assembly. The returned mesh
    must have the same flat-buffer shape as ``cad.tessellate_with_ids`` so the
    renderer's selection logic can reuse the same code path."""
    h_a = _make_box_handle(size=10.0)
    h_b = _make_box_handle(size=10.0)
    r_create = cad_handlers.create_assembly({
        "parts": [
            {"handle": h_a, "name": "a", "transform": "identity"},
            {"handle": h_b, "name": "b", "transform": _translation_matrix(20, 0, 0)},
        ],
    })

    r = cad_handlers.tessellate_assembly({"handle": r_create["handle"]})

    # Same wire shape as cad.tessellate_with_ids.
    assert isinstance(r["vertices"], list)
    assert isinstance(r["indices"], list)
    assert isinstance(r["faceIds"], list)
    assert isinstance(r["faceMap"], dict)
    assert len(r["vertices"]) % 3 == 0
    assert len(r["indices"]) % 3 == 0
    # Parallel-array invariant: faceIds.length == triangleCount.
    assert len(r["faceIds"]) == r["triangleCount"]
    assert len(r["indices"]) == r["triangleCount"] * 3
    # Both cubes have 6 faces → 12 faces total (no de-dup across children).
    assert len(r["faceMap"]) == 12
    # Every face_map entry carries childName so the inspector can attribute
    # the selection to the correct part.
    for entry in r["faceMap"].values():
        assert entry["kind"] == "face"
        assert "childName" in entry
        assert entry["childName"] in ("a", "b")


@requires_cadquery
@requires_assembly
def test_export_assembly_step_round_trip_and_reimport_succeeds() -> None:
    """Exporting a 2-part assembly to STEP must produce a non-empty file on
    disk. Re-importing the resulting STEP via ``cad.import_step`` must succeed
    (proves the file is a valid STEP, not just non-zero bytes).

    NOTE: We do NOT pin the re-imported face count to the original because
    CadQuery's STEP exporter for assemblies fuses the components into a single
    compound — a known behavior, and the round-trip succeeding is the actual
    contract that matters for the operator.
    """
    h_a = _make_box_handle(size=10.0)
    h_b = _make_box_handle(size=10.0)
    r_create = cad_handlers.create_assembly({
        "parts": [
            {"handle": h_a, "name": "left", "transform": "identity"},
            {"handle": h_b, "name": "right", "transform": _translation_matrix(20, 0, 0)},
        ],
    })

    with tempfile.TemporaryDirectory() as tmp:
        step_path = os.path.join(tmp, "assembly.step")
        export_r = cad_handlers.export_assembly({
            "handle": r_create["handle"],
            "outPath": step_path,
            "format": "step",
        })

        assert export_r["outPath"] == step_path
        assert export_r["bytesWritten"] > 0
        assert Path(step_path).exists()

        # Re-import — must succeed and produce a fresh handle distinct from
        # the original assembly handle.
        reimport = cad_handlers.import_step({"path": step_path})
        assert reimport["handle"] != r_create["handle"]
        assert reimport["handle"].startswith("step:")


@requires_cadquery
@requires_assembly
def test_export_assembly_stl_produces_valid_binary_stl() -> None:
    """STL flattening must produce a valid binary STL per Safety Rule 1:
    80-byte header + uint32 triangle count + 50 * N triangle records."""
    h = _make_box_handle(size=10.0)
    r_create = cad_handlers.create_assembly({
        "parts": [{"handle": h, "name": "solo", "transform": "identity"}],
    })

    with tempfile.TemporaryDirectory() as tmp:
        stl_path = os.path.join(tmp, "assembly.stl")
        export_r = cad_handlers.export_assembly({
            "handle": r_create["handle"],
            "outPath": stl_path,
            "format": "stl",
            "toleranceMm": 0.1,
        })

        assert export_r["bytesWritten"] >= 84  # 80 header + 4 count minimum
        stl_bytes = Path(stl_path).read_bytes()
        assert len(stl_bytes) == export_r["bytesWritten"]
        header_count = struct.unpack("<I", stl_bytes[80:84])[0]
        # Header count must match the actual byte count.
        expected = 80 + 4 + 50 * header_count
        assert len(stl_bytes) == expected
        assert header_count > 0


@requires_cadquery
@requires_assembly
def test_tessellate_assembly_rejects_non_assembly_handle() -> None:
    """Passing a single-body (``script:`` / ``step:``) handle to
    ``cad.tessellate_assembly`` must surface ``not_an_assembly`` so the
    renderer falls back to ``cad.tessellate_with_ids`` cleanly."""
    h = _make_box_handle(size=10.0)
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.tessellate_assembly({"handle": h})
    assert exc_info.value.code == "not_an_assembly"


# ── Internal helpers ─────────────────────────────────────────────────────


def _make_fake_doc() -> Any:
    """Build a placeholder StepDocument with a tiny bbox so the validator can
    reach the transform-shape check without crashing on a None workplane.

    Used by Tier 1 tests that need a valid-looking handle in ``_HANDLES`` but
    don't actually call into CadQuery."""
    from engines.cad.cadquery_import import StepDocument

    return StepDocument(
        workplane=object(),
        bbox_min=(0.0, 0.0, 0.0),
        bbox_max=(1.0, 1.0, 1.0),
        source_path="<fake>",
    )
