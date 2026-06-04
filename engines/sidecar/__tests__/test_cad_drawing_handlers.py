"""pytest coverage for the CadQuery drawing handlers in the sidecar.

Covers the two new methods registered by ``engines/sidecar/cad_handlers.py``
for CAD V2 Workflow A2 (Drawings):

  * ``cad.project_drawing`` — returns an inline SVG string for the 2D
    projection of a body handle.
  * ``cad.export_drawing``  — writes the same SVG to disk.

Tiered the same way as ``test_cad_script_handlers.py``:

  Tier 1 — **No CadQuery required.** Covers wire-envelope / param validation
    (``bad_params`` for empty handle / unknown view / null-byte path,
    ``invalid_handle`` for handles missing from the table) and dispatch
    registration. Runs in any environment with the sidecar code on the path.

  Tier 2 — **CadQuery required.** Skipped automatically when ``import
    cadquery`` fails. Exercises the full execute_script → project_drawing
    round trip on a 30 mm cube and parses the returned SVG with
    ``xml.etree.ElementTree`` to assert the front-view projection contains
    at least 4 line segments forming a 30×30 square, and that the iso view
    produces a different (richer) drawing.
"""
from __future__ import annotations

import re
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import List, Tuple

import pytest

from engines.cad.cadquery_import import reset_handle_table
from engines.cad.cadquery_drawing import (
    ALLOWED_DIMENSION_KINDS,
    ALLOWED_SECTION_AXES,
    ALLOWED_VIEWS,
    TITLE_BLOCK_FIELDS,
    VIEW_DIRECTIONS,
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


# ── Tier 1: dispatch registration ───────────────────────────────────────


def test_dispatch_table_registers_drawing_methods() -> None:
    """The sidecar dispatch table MUST expose the two new dotted-name methods
    so the TS bridge can reach them. Drift here breaks the wire contract.
    """
    from engines.sidecar.main import _build_dispatch_table

    table = _build_dispatch_table()
    assert "cad.project_drawing" in table
    assert "cad.export_drawing" in table


# ── Tier 1: handler-level param validation ──────────────────────────────


def test_project_drawing_requires_handle() -> None:
    """Empty params must short-circuit with ``bad_params`` BEFORE we touch
    the CadQuery import — mirrors ``cad.export`` posture."""
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.project_drawing({})
    assert exc_info.value.code == "bad_params"


def test_project_drawing_requires_view() -> None:
    """A handle without a view must fail with ``bad_params``."""
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.project_drawing({"handle": "script:abc"})
    assert exc_info.value.code == "bad_params"


def test_project_drawing_rejects_unknown_view() -> None:
    """A typo like ``'fornt'`` must fail fast with ``bad_params`` instead of
    silently producing some default view the operator didn't ask for."""
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.project_drawing({
            "handle": "script:abc",
            "view": "fornt",
        })
    assert exc_info.value.code == "bad_params"
    # Error message lists the allowed views so the renderer can surface them.
    assert "front" in str(exc_info.value)


def test_project_drawing_rejects_unknown_handle_when_no_cadquery() -> None:
    """Handle lookup happens BEFORE CadQuery import so the failure mode is
    deterministic regardless of whether the pip dependency exists."""
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.project_drawing({
            "handle": "script:never-existed",
            "view": "front",
        })
    assert exc_info.value.code == "invalid_handle"


def test_export_drawing_rejects_null_byte_path() -> None:
    """Null-byte in outPath MUST be rejected at the handler before any disk
    I/O. Mirrors ``cad.export`` posture and the path-security helper used by
    the main process."""
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.export_drawing({
            "handle": "script:abc",
            "view": "front",
            "outPath": "/tmp/evil\x00.svg",
        })
    assert exc_info.value.code == "bad_params"


def test_export_drawing_requires_all_params() -> None:
    """Missing handle / view / outPath each surface as ``bad_params``."""
    # Missing outPath
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.export_drawing({"handle": "h", "view": "front"})
    assert exc_info.value.code == "bad_params"
    # Missing view
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.export_drawing({"handle": "h", "outPath": "/tmp/x.svg"})
    assert exc_info.value.code == "bad_params"
    # Missing handle
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.export_drawing({"view": "front", "outPath": "/tmp/x.svg"})
    assert exc_info.value.code == "bad_params"


def test_view_directions_cover_allowed_views() -> None:
    """Every allowed view name MUST have a registered direction vector
    (otherwise the validator passes but the projector explodes on lookup)."""
    for view in ALLOWED_VIEWS:
        assert view in VIEW_DIRECTIONS
        direction = VIEW_DIRECTIONS[view]
        assert len(direction) == 3
        # All non-zero (no degenerate viewing direction).
        assert any(abs(c) > 0 for c in direction)


# ── Tier 2: full CadQuery round trip with SVG parsing ───────────────────


def _extract_svg_segments(svg_text: str) -> List[Tuple[float, float, float, float]]:
    """Parse an SVG string and return its visible line segments as
    ``(x1, y1, x2, y2)`` tuples.

    Handles two CadQuery output shapes seen across releases:
      * ``<line x1=.. y1=.. x2=.. y2=.. />`` — the simple/legacy form.
      * ``<path d="M x1 y1 L x2 y2" />``     — the post-2.4 form using
        SVG path-data commands.

    The ``d`` attribute parser is permissive on whitespace / decimals and
    only handles the moveto + lineto pair the projector emits for straight
    edges. Curves (cubic/quadratic) are ignored — we don't need them for the
    cube test which has only straight edges.
    """
    segments: List[Tuple[float, float, float, float]] = []
    root = ET.fromstring(svg_text)
    # SVG namespace varies; strip it for simple tag matching.
    for elem in root.iter():
        tag = elem.tag.split("}", 1)[-1] if "}" in elem.tag else elem.tag
        if tag == "line":
            try:
                x1 = float(elem.attrib["x1"])
                y1 = float(elem.attrib["y1"])
                x2 = float(elem.attrib["x2"])
                y2 = float(elem.attrib["y2"])
                segments.append((x1, y1, x2, y2))
            except (KeyError, ValueError):
                continue
        elif tag == "path":
            d = elem.attrib.get("d", "")
            # Match `M x y L x y` (case-insensitive). Numbers may be
            # signed / decimal / scientific.
            num = r"-?\d+(?:\.\d+)?(?:[eE]-?\d+)?"
            pattern = (
                rf"[Mm]\s*({num})[ ,]+({num})\s*"
                rf"[Ll]\s*({num})[ ,]+({num})"
            )
            for match in re.finditer(pattern, d):
                x1, y1, x2, y2 = (float(g) for g in match.groups())
                segments.append((x1, y1, x2, y2))
    return segments


def _segment_lengths(
    segments: List[Tuple[float, float, float, float]],
) -> List[float]:
    out: List[float] = []
    for (x1, y1, x2, y2) in segments:
        dx = x2 - x1
        dy = y2 - y1
        out.append((dx * dx + dy * dy) ** 0.5)
    return out


@requires_cadquery
def test_project_drawing_front_view_of_30mm_cube_returns_square() -> None:
    """A 30 mm cube projected to the front view must produce an SVG whose
    visible line segments include 4 edges forming a 30×30 square (within
    SVG-stroke-rounding tolerance).

    This is the load-bearing geometry pin for the Drawings feature — if the
    projector ever returns the wrong bbox or the wrong view direction the
    operator gets a wrong-sized drawing on the page and a wrong CAM setup
    downstream. We parse the SVG with ``xml.etree.ElementTree`` so a future
    CadQuery exporter that changes element naming (``<line>`` → ``<path>``)
    is caught by the parser update rather than a silent diff.
    """
    # 30 mm cube centered at origin.
    script = """
import cadquery as cq
result = cq.Workplane('XY').box(30, 30, 30)
"""
    exec_result = cad_handlers.execute_script({"script": script})
    handle = exec_result["meshes"][0]["handle"]

    r = cad_handlers.project_drawing({"handle": handle, "view": "front"})

    assert r["view"] == "front"
    assert r["bytes"] > 0
    assert isinstance(r["svg"], str)
    assert r["svg"].lstrip().startswith("<")  # SVG / XML root

    # Parse segments. The cube has 4 visible front-face edges + (at least)
    # 4 hidden-line edges depending on the exporter; we require at least 4
    # segments of length ≈ 30 mm.
    segments = _extract_svg_segments(r["svg"])
    assert len(segments) >= 4, (
        f"expected at least 4 line segments in front-view SVG, got "
        f"{len(segments)}: {segments[:8]!r}"
    )

    lengths = _segment_lengths(segments)
    long_segments = [
        L for L in lengths if 25.0 < L < 35.0  # 30mm ± SVG-stroke tolerance
    ]
    assert len(long_segments) >= 4, (
        f"expected at least 4 segments of length ≈30 mm in front-view SVG, "
        f"got lengths {sorted(lengths)!r}"
    )


@requires_cadquery
def test_project_drawing_iso_view_differs_from_front() -> None:
    """An isometric view of the same cube must produce a different SVG than
    the front view (more line segments — iso shows 9 visible edges on a cube
    vs. 4 in front), proving the ``projectionDir`` switch actually flows
    through to CadQuery's exporter and isn't being silently ignored.
    """
    script = """
import cadquery as cq
result = cq.Workplane('XY').box(30, 30, 30)
"""
    exec_result = cad_handlers.execute_script({"script": script})
    handle = exec_result["meshes"][0]["handle"]

    front = cad_handlers.project_drawing({"handle": handle, "view": "front"})
    iso = cad_handlers.project_drawing({"handle": handle, "view": "iso"})

    # The two SVGs must differ.
    assert front["svg"] != iso["svg"], (
        "front and iso views produced identical SVG — projectionDir is "
        "being ignored upstream"
    )

    front_segments = _extract_svg_segments(front["svg"])
    iso_segments = _extract_svg_segments(iso["svg"])
    # The iso view is a richer drawing (9 visible edges on a cube vs. 4 in
    # the orthographic front view), so segment count should be strictly
    # greater. If a CadQuery refactor breaks this it likely means the iso
    # direction collapsed to a degenerate axis-aligned view.
    assert len(iso_segments) > len(front_segments), (
        f"iso view should have more segments than front view; "
        f"front={len(front_segments)} iso={len(iso_segments)}"
    )


@requires_cadquery
def test_export_drawing_writes_svg_to_disk() -> None:
    """End-to-end: execute_script → grab handle → cad.export_drawing.
    The file must exist on disk with non-zero size and SVG content.
    """
    script = """
import cadquery as cq
result = cq.Workplane('XY').box(20, 15, 10)
"""
    exec_result = cad_handlers.execute_script({"script": script})
    handle = exec_result["meshes"][0]["handle"]

    with tempfile.TemporaryDirectory() as tmp:
        out_path = str(Path(tmp) / "drawing-top.svg")
        r = cad_handlers.export_drawing({
            "handle": handle,
            "view": "top",
            "outPath": out_path,
        })
        assert r["outPath"] == out_path
        assert r["view"] == "top"
        assert r["bytesWritten"] > 0

        # Disk content must be valid SVG/XML markup.
        text = Path(out_path).read_text(encoding="utf-8")
        assert text.lstrip().startswith("<")
        # Parses without raising.
        ET.fromstring(text)


@requires_cadquery
def test_export_drawing_invalid_handle_raises() -> None:
    """When the handle is unknown the export must surface ``invalid_handle``
    BEFORE any disk write — no orphan empty files left in the output dir.
    """
    with tempfile.TemporaryDirectory() as tmp:
        out_path = str(Path(tmp) / "ghost.svg")
        with pytest.raises(_CadHandlerError) as exc_info:
            cad_handlers.export_drawing({
                "handle": "script:never-existed",
                "view": "front",
                "outPath": out_path,
            })
        assert exc_info.value.code == "invalid_handle"
        # No file created on the failure path.
        assert not Path(out_path).exists()


# ─────────────────────────────────────────────────────────────────────────
# CAD V1.5 — Drawing dimensions / sections / title block coverage
# ─────────────────────────────────────────────────────────────────────────
#
# 8 new test cases — 4 Tier 1 (no CadQuery) + 4 Tier 2 (full round-trip).
# Tier 1 pins the dispatch + param-validation surface so a renderer typo
# fails fast with `bad_params`; Tier 2 verifies the SVG layer composition
# actually adds the expected `<g>` markers on top of a real projection.


# ── Tier 1: dispatch + param validation ─────────────────────────────────


def test_v15_dispatch_table_registers_new_methods() -> None:
    """The three new V1.5 methods MUST appear in the sidecar dispatch
    table — drift here breaks the wire contract for the renderer's V1.5
    DrawingView toolbar.
    """
    from engines.sidecar.main import _build_dispatch_table

    table = _build_dispatch_table()
    assert "cad.dimension_drawing" in table
    assert "cad.section_drawing" in table
    assert "cad.attach_title_block" in table


def test_v15_dimension_drawing_validates_kind() -> None:
    """A dimension spec with an unknown `kind` MUST fail fast with
    `bad_params` so a renderer typo (`'distancee'`) doesn't silently
    drop the annotation on the floor."""
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.dimension_drawing({
            "handle": "script:abc",
            "view": "front",
            "dimensions": [{"kind": "distancee", "p1": {"x": 0, "y": 0}, "p2": {"x": 5, "y": 0}}],
        })
    assert exc_info.value.code == "bad_params"


def test_v15_section_drawing_validates_axis() -> None:
    """A section plane with an unknown axis MUST fail with `bad_params`.
    Mirrors the `view` validator posture."""
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.section_drawing({
            "handle": "script:abc",
            "view": "front",
            "plane": {"axis": "w", "offset": 0},
        })
    assert exc_info.value.code == "bad_params"
    # Allowed axes vocabulary is exposed for the renderer.
    assert set(ALLOWED_SECTION_AXES) == {"x", "y", "z"}


def test_v15_attach_title_block_requires_svg_and_metadata() -> None:
    """Both `svg` and `metadata` MUST be present; missing either fails
    with `bad_params`."""
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.attach_title_block({"metadata": {"name": "X"}})
    assert exc_info.value.code == "bad_params"
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.attach_title_block({"svg": "<svg></svg>"})
    assert exc_info.value.code == "bad_params"
    # All five title-block fields are exposed for renderer parity.
    assert set(TITLE_BLOCK_FIELDS) == {"name", "scale", "author", "date", "sheet"}


# ── Tier 2: full CadQuery round trip ─────────────────────────────────────


@requires_cadquery
def test_v15_dimension_drawing_overlays_distance_layer() -> None:
    """A distance dimension overlay must add a `<g class="dim ..."` group
    to the SVG output of a real projection. Pins the SVG composition
    contract: the BUILD-3 projection is preserved AND the dimension
    layer is appended."""
    script = """
import cadquery as cq
result = cq.Workplane('XY').box(30, 30, 30)
"""
    exec_result = cad_handlers.execute_script({"script": script})
    handle = exec_result["meshes"][0]["handle"]

    r = cad_handlers.dimension_drawing({
        "handle": handle,
        "view": "front",
        "dimensions": [
            {"kind": "distance",
             "p1": {"x": 0, "y": 0},
             "p2": {"x": 30, "y": 0},
             "label": "30 mm"},
        ],
    })
    assert r["view"] == "front"
    assert r["dimensionCount"] == 1
    assert isinstance(r["svg"], str)
    # The dimension layer is stamped on top of the base projection.
    assert "dim--distance" in r["svg"]
    # The user-supplied label appears verbatim in the dimension text.
    assert "30 mm" in r["svg"]
    # The base SVG/XML markup is still present.
    assert r["svg"].lstrip().startswith("<")
    # The bytes count matches the encoded length.
    assert r["bytes"] == len(r["svg"].encode("utf-8"))


@requires_cadquery
def test_v15_dimension_label_is_xml_escaped() -> None:
    """A dimension label carrying XML metacharacters MUST be entity-escaped in
    the emitted SVG. The drawing SVG is rendered in the renderer via
    `dangerouslySetInnerHTML`, and labels are operator free-text persisted in
    drawing.json — escaping at the sidecar is the stored-XSS guard (Safety
    Rule 4). A normal label (no specials) is unaffected (escape is a no-op),
    so the verbatim-label pin above still holds."""
    script = """
import cadquery as cq
result = cq.Workplane('XY').box(30, 30, 30)
"""
    exec_result = cad_handlers.execute_script({"script": script})
    handle = exec_result["meshes"][0]["handle"]

    r = cad_handlers.dimension_drawing({
        "handle": handle,
        "view": "front",
        "dimensions": [
            {"kind": "distance",
             "p1": {"x": 0, "y": 0},
             "p2": {"x": 30, "y": 0},
             "label": '</text><script>alert(1)</script> & done'},
        ],
    })
    svg = r["svg"]
    # No raw markup from the label may survive into the SVG.
    assert "<script>" not in svg
    assert "</text><script>" not in svg
    # The metacharacters are entity-escaped; the inner text is preserved.
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in svg
    assert "&amp; done" in svg


@requires_cadquery
def test_v15_dimension_drawing_empty_list_round_trips() -> None:
    """An empty dimension list MUST round-trip back to the bare
    projection (zero `<g class="dim` markers) so the renderer can toggle
    the layer off without two separate IPC paths."""
    script = """
import cadquery as cq
result = cq.Workplane('XY').box(20, 20, 20)
"""
    exec_result = cad_handlers.execute_script({"script": script})
    handle = exec_result["meshes"][0]["handle"]

    r = cad_handlers.dimension_drawing({
        "handle": handle,
        "view": "front",
        "dimensions": [],
    })
    assert r["dimensionCount"] == 0
    assert "class=\"dim" not in r["svg"]


@requires_cadquery
def test_v15_section_drawing_produces_different_svg() -> None:
    """A section view of the cube MUST produce a different SVG than the
    bare front view (cutting away half the cube changes the projected
    silhouette). Pins the section-cut wiring: a no-op section would be
    indistinguishable from a bare projection."""
    script = """
import cadquery as cq
result = cq.Workplane('XY').box(30, 30, 30)
"""
    exec_result = cad_handlers.execute_script({"script": script})
    handle = exec_result["meshes"][0]["handle"]

    bare = cad_handlers.project_drawing({"handle": handle, "view": "front"})
    sectioned = cad_handlers.section_drawing({
        "handle": handle,
        "view": "front",
        "plane": {"axis": "z", "offset": 0, "keepSide": "positive"},
    })

    assert sectioned["view"] == "front"
    assert sectioned["plane"]["axis"] == "z"
    assert sectioned["plane"]["offset"] == 0
    assert sectioned["plane"]["keepSide"] == "positive"
    # The two SVGs are produced by different geometry, so they must
    # not be byte-identical. A regression where the cut silently
    # no-ops would surface as equality here.
    assert sectioned["svg"] != bare["svg"]
    assert sectioned["bytes"] == len(sectioned["svg"].encode("utf-8"))


def test_v15_attach_title_block_is_idempotent() -> None:
    """Stamping the title block twice MUST NOT double the markup — the
    second call detects the existing `class="title-block"` marker and
    returns the SVG unchanged. Lets the operator re-export a drawing
    without doubling the block in the bottom-right corner."""
    base_svg = (
        '<?xml version="1.0"?>'
        '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">'
        '<rect width="100" height="100"/></svg>'
    )
    metadata = {
        "name": "Bracket-V1",
        "scale": "1:1",
        "author": "Jacob",
        "date": "2026-06-01",
        "sheet": "1 of 1",
    }
    once = cad_handlers.attach_title_block({"svg": base_svg, "metadata": metadata})
    assert "title-block" in once["svg"]
    assert "Bracket-V1" in once["svg"]
    # All five normalized metadata fields are echoed.
    assert once["metadata"]["name"] == "Bracket-V1"
    assert once["metadata"]["scale"] == "1:1"
    # Stamping again — input is the previously-stamped SVG — MUST NOT
    # add a second `<g class="title-block">` group. Count the marker
    # before and after to verify idempotency.
    twice = cad_handlers.attach_title_block({"svg": once["svg"], "metadata": metadata})
    assert twice["svg"].count("class=\"title-block\"") == 1
    # The dimension kinds vocabulary is in sync with what the renderer
    # expects — pins the allowed list against drift.
    assert set(ALLOWED_DIMENSION_KINDS) == {"distance", "radius", "diameter", "angle"}
