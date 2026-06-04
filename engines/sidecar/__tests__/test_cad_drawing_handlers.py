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
    DEFAULT_SECTION_LABEL,
    TITLE_BLOCK_FIELDS,
    VIEW_DIRECTIONS,
    _build_section_hatch_svg,
    _build_section_line_svg,
    _validate_section_label,
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


# ── Stack 2: section cutting-plane line + A-A label + cut-face hatch ──────
#
# These pins are deliberately Tier 1 (NO CadQuery): they exercise the pure
# SVG-composition helpers (`_build_section_line_svg`, `_build_section_hatch_svg`,
# `_validate_section_label`) directly. CadQuery is unavailable in the system
# Python that runs the default suite, so the Safety-Rule-4 escaping pin MUST
# be CadQuery-free to actually execute (a Tier-2 pin would just skip).


def test_v15_section_line_stamps_cutting_plane_and_escaped_label() -> None:
    """The cutting-plane line layer MUST carry the ASME dash-dot stroke, the
    viewing-direction arrowheads, and the section label in a `<text>` node.
    A plain "A-A" label appears verbatim (escape is a no-op for it)."""
    markup = _build_section_line_svg("z", 0.0, "A-A", 800.0, 600.0)
    assert "class=\"section-line\"" in markup
    # ASME phantom dash-dot pattern is present on the cutting-plane line.
    assert "stroke-dasharray" in markup
    # Viewing-direction arrowheads (filled triangles) are stamped.
    assert markup.count("<path") >= 2
    # The label rides in a <text> node at each terminator.
    assert markup.count("<text") >= 2
    assert ">A-A<" in markup


def test_v15_section_label_is_xml_escaped() -> None:
    """A cutting-plane label carrying XML metacharacters MUST be entity-escaped
    in the emitted SVG. The section SVG is rendered in DrawingView via
    `dangerouslySetInnerHTML`, and the section label is operator free-text
    persisted in drawing.json — escaping at the sidecar is the stored-XSS guard
    (Safety Rule 4). Mirrors `test_v15_dimension_label_is_xml_escaped`."""
    payload = '</text><script>alert(1)</script> & done'
    markup = _build_section_line_svg("z", 0.0, payload, 800.0, 600.0)
    # No raw markup from the label may survive into the SVG.
    assert "<script>" not in markup
    assert "</text><script>" not in markup
    # The metacharacters are entity-escaped; the inner text is preserved.
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in markup
    assert "&amp; done" in markup


def test_v15_section_hatch_emits_pattern_and_path() -> None:
    """The cut-face hatch MUST emit a `<pattern>` of 45° lines and a `<path>`
    of the cap-ring polygon, clipped to itself. A square cap ring round-trips
    to a closed `M ... Z` subpath filled with the hatch pattern."""
    ring = [(-10.0, -10.0), (10.0, -10.0), (10.0, 10.0), (-10.0, 10.0)]
    markup = _build_section_hatch_svg([ring])
    assert "class=\"section-hatch\"" in markup
    # The 45° hatch pattern tile + the clipped fill path are both present.
    assert "<pattern" in markup
    assert "patternTransform=\"rotate(45" in markup
    assert "<path" in markup
    assert "fill=\"url(#section-hatch-pattern)\"" in markup
    assert "clip-path=\"url(#section-hatch-clip)\"" in markup
    # The polygon closes (Z) — an open path would not fill.
    assert "Z" in markup


def test_v15_section_hatch_empty_rings_is_noop() -> None:
    """No usable cap ring → the hatch helper returns an empty string so the
    caller degrades to a line-only section (HLR-unavailable graceful path)."""
    assert _build_section_hatch_svg([]) == ""
    # A degenerate (sub-3-point) ring is rejected, not stamped.
    assert _build_section_hatch_svg([[(0.0, 0.0), (1.0, 1.0)]]) == ""


def test_v15_section_label_defaults_to_a_a() -> None:
    """An absent / blank label falls back to the drafting default "A-A";
    a non-string label fails fast with `bad_params`."""
    assert _validate_section_label(None) == DEFAULT_SECTION_LABEL == "A-A"
    assert _validate_section_label("   ") == "A-A"
    assert _validate_section_label("B-B") == "B-B"
    with pytest.raises(_CadHandlerError) as exc_info:
        _validate_section_label(123)
    assert exc_info.value.code == "bad_params"


def test_v15_section_drawing_handler_rejects_non_string_label() -> None:
    """The handler wrapper MUST reject a non-string `label` with `bad_params`
    (defence in depth — the core validates too, but the wire boundary is the
    first gate)."""
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.section_drawing({
            "handle": "script:abc",
            "view": "front",
            "plane": {"axis": "z", "offset": 0},
            "label": 42,
        })
    assert exc_info.value.code == "bad_params"


@requires_cadquery
def test_v15_section_drawing_round_trip_has_hatch_and_escaped_label() -> None:
    """End-to-end: a real section of the cube MUST stamp the cutting-plane
    line + the 45° hatch `<pattern>`/`<path>` and echo the escaped label.
    A markup-bearing label is entity-escaped in the composed SVG."""
    script = """
import cadquery as cq
result = cq.Workplane('XY').box(30, 30, 30)
"""
    exec_result = cad_handlers.execute_script({"script": script})
    handle = exec_result["meshes"][0]["handle"]

    sectioned = cad_handlers.section_drawing({
        "handle": handle,
        "view": "top",
        "plane": {"axis": "z", "offset": 0, "keepSide": "positive"},
        "label": '<b>A-A</b>',
    })
    svg = sectioned["svg"]
    # Cutting-plane line layer is present.
    assert "class=\"section-line\"" in svg
    # Cut-face hatch is present (HLR cap outline resolved for the cube).
    assert "class=\"section-hatch\"" in svg
    assert "<pattern" in svg
    # The label round-trips ESCAPED both in the SVG and the echoed field.
    assert "<b>A-A</b>" not in svg
    assert "&lt;b&gt;A-A&lt;/b&gt;" in svg
    assert sectioned["label"] == "&lt;b&gt;A-A&lt;/b&gt;"
    assert sectioned["bytes"] == len(svg.encode("utf-8"))


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


# ─────────────────────────────────────────────────────────────────────────
# CAD V1.5 — GD&T feature-control-frame coverage (BUILD 10)
# ─────────────────────────────────────────────────────────────────────────
#
# All Tier 1 — NO CadQuery needed. ``_build_fcf_svg`` / ``annotate_gdt`` are
# pure SVG composition (the handler operates on an existing SVG string, like
# ``drawing_bom_table``), so the escaping pin actually executes in the system-
# Python environment where ``import cadquery`` is unavailable. That is the whole
# point: Safety Rule 4's stored-XSS guard MUST be verifiable without the heavy
# optional dependency.


def test_gdt_dispatch_table_registers_annotate() -> None:
    """``cad.annotate_gdt`` MUST appear in the sidecar dispatch table — drift
    here breaks the wire contract for the renderer's GD&T toolbar."""
    from engines.sidecar.main import _build_dispatch_table

    table = _build_dispatch_table()
    assert "cad.annotate_gdt" in table


def test_gdt_annotate_requires_svg_and_frames() -> None:
    """Both ``svg`` and ``frames`` MUST be present; missing either fails with
    ``bad_params`` BEFORE any rendering."""
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.annotate_gdt({"frames": []})
    assert exc_info.value.code == "bad_params"
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.annotate_gdt({"svg": "<svg></svg>"})
    assert exc_info.value.code == "bad_params"


def test_gdt_annotate_rejects_unknown_characteristic() -> None:
    """A frame with an unknown characteristic MUST fail fast with
    ``bad_params`` so a renderer typo doesn't silently drop the frame."""
    from engines.cad.cadquery_drawing import ALLOWED_GDT_CHARACTERISTICS

    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.annotate_gdt({
            "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>",
            "frames": [{
                "characteristic": "perpendicularityy",
                "toleranceMm": 0.1,
                "placement": {"x": 10, "y": 10},
            }],
        })
    assert exc_info.value.code == "bad_params"
    # The allowed vocabulary is exposed (14 ASME Y14.5 characteristics) so the
    # renderer can surface them. Pins the list against drift.
    assert len(ALLOWED_GDT_CHARACTERISTICS) == 14
    assert "position" in ALLOWED_GDT_CHARACTERISTICS
    assert "total_runout" in ALLOWED_GDT_CHARACTERISTICS


def test_gdt_annotate_rejects_too_many_datums() -> None:
    """A feature control frame references at most 3 datums (primary /
    secondary / tertiary); a 4th MUST fail with ``bad_params``."""
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.annotate_gdt({
            "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>",
            "frames": [{
                "characteristic": "position",
                "toleranceMm": 0.1,
                "datums": ["A", "B", "C", "D"],
                "placement": {"x": 10, "y": 10},
            }],
        })
    assert exc_info.value.code == "bad_params"


def test_gdt_annotate_rejects_negative_tolerance() -> None:
    """A negative tolerance zone is nonsensical and MUST fail with
    ``bad_params``."""
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.annotate_gdt({
            "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>",
            "frames": [{
                "characteristic": "flatness",
                "toleranceMm": -0.05,
                "placement": {"x": 0, "y": 0},
            }],
        })
    assert exc_info.value.code == "bad_params"


def test_gdt_annotate_empty_frames_round_trips() -> None:
    """An empty ``frames`` list round-trips the input SVG unchanged so the
    renderer can toggle the layer off without a second IPC path."""
    base = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"100\" height=\"80\"></svg>"
    r = cad_handlers.annotate_gdt({"svg": base, "frames": []})
    assert r["frameCount"] == 0
    assert r["svg"] == base
    assert r["bytes"] == len(base.encode("utf-8"))


def test_gdt_fcf_renders_frame() -> None:
    """A feature control frame renders a ``<g class="gdt-fcf">`` group with the
    characteristic glyph and the tolerance value. Pins the SVG composition
    contract — Tier 1, no CadQuery."""
    from engines.cad.cadquery_drawing import _build_fcf_svg

    svg = _build_fcf_svg(
        "position",
        0.1,
        datums=["A", "B", "C"],
        placement=(10.0, 10.0),
    )
    # The frame is a bordered <g> with a rect border and per-cell dividers.
    assert "class=\"gdt-fcf\"" in svg
    assert "<rect" in svg
    # The position glyph (⌖) and the tolerance value appear.
    assert "⌖" in svg          # ⌖ position glyph
    assert "0.1" in svg             # tolerance value (via _format_number)
    # Each datum letter is present.
    assert ">A<" in svg
    assert ">B<" in svg
    assert ">C<" in svg


def test_gdt_annotate_overlays_layer() -> None:
    """``annotate_gdt`` folds a ``<g class="gdt-layer">`` onto the input SVG and
    preserves the base markup. Tier 1, no CadQuery."""
    base = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"100\" height=\"80\"><line/></svg>"
    r = cad_handlers.annotate_gdt({
        "svg": base,
        "frames": [{
            "characteristic": "flatness",
            "toleranceMm": 0.05,
            "datums": ["A"],
            "placement": {"x": 5, "y": 5},
        }],
    })
    assert r["frameCount"] == 1
    # The GD&T layer is stamped on top of the base markup.
    assert "gdt-layer" in r["svg"]
    assert "gdt-fcf" in r["svg"]
    # The base SVG content survives.
    assert "<line/>" in r["svg"]
    # The bytes count matches the encoded length.
    assert r["bytes"] == len(r["svg"].encode("utf-8"))


def test_gdt_datum_is_xml_escaped() -> None:
    """A datum reference carrying XML metacharacters MUST be entity-escaped in
    the emitted SVG. The drawing SVG is rendered in the renderer via
    ``dangerouslySetInnerHTML`` and datums are operator free-text persisted in
    drawing.json — escaping at the sidecar is the stored-XSS guard (Safety
    Rule 4). Tier 1 (pure ``_build_fcf_svg``) so the pin runs without CadQuery.
    """
    from engines.cad.cadquery_drawing import _build_fcf_svg

    svg = _build_fcf_svg(
        "position",
        0.1,
        datums=["</text><script>alert(1)</script>", "A & B"],
        placement=(10.0, 10.0),
    )
    # No raw markup from the datum may survive into the SVG.
    assert "<script>" not in svg
    assert "</text><script>" not in svg
    # The metacharacters are entity-escaped; the inner text is preserved.
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in svg
    assert "A &amp; B" in svg


def test_gdt_label_is_xml_escaped() -> None:
    """The optional frame ``label`` caption is operator free-text and MUST be
    entity-escaped too — same stored-XSS guard as the datum cells (Safety
    Rule 4). Tier 1, no CadQuery."""
    from engines.cad.cadquery_drawing import _build_fcf_svg

    svg = _build_fcf_svg(
        "perpendicularity",
        0.02,
        datums=["A"],
        placement=(0.0, 0.0),
        label="</text><script>evil()</script> & co",
    )
    assert "<script>" not in svg
    assert "</text><script>" not in svg
    assert "&lt;script&gt;evil()&lt;/script&gt;" in svg
    assert "&amp; co" in svg


def test_gdt_annotate_datum_is_xml_escaped_end_to_end() -> None:
    """End-to-end via the handler: a datum with markup pushed through
    ``cad.annotate_gdt`` is escaped in the composed SVG. Confirms the handler
    path (not just the leaf builder) is XSS-safe. Tier 1, no CadQuery."""
    base = "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>"
    r = cad_handlers.annotate_gdt({
        "svg": base,
        "frames": [{
            "characteristic": "position",
            "toleranceMm": 0.1,
            "datums": ["</text><script>alert(1)</script>"],
            "placement": {"x": 10, "y": 10},
        }],
    })
    svg = r["svg"]
    assert "<script>" not in svg
    assert "</text><script>" not in svg
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in svg


# ─────────────────────────────────────────────────────────────────────────
# CAD V1.5 — Detail (crop) view coverage
# ─────────────────────────────────────────────────────────────────────────
#
# `cad.detail_drawing` crops a circular region of a parent projection and
# magnifies it (e.g. 2:1). Tier 1 pins dispatch + param validation (runs
# without CadQuery); Tier 2 pins the real crop: the returned SVG carries a
# genuinely SCALED viewBox (pixel canvas == scale × viewBox window) and the
# operator's detail label is XML-entity-escaped (Safety Rule 4 — the detail
# SVG is rendered via `dangerouslySetInnerHTML` in DrawingView, so a label
# carrying markup must not survive as live `<script>`).


def _register_detail_body(handle: str, build: str) -> None:
    """Register a CadQuery body directly in the handle table under ``handle``.

    Bypasses ``cad.execute_script`` (whose restricted exec namespace blocks
    ``import`` in some interpreters) so the Tier-2 detail tests can stand up a
    body deterministically — same approach as the geometry-test fixture.
    """
    import cadquery as cq  # noqa: PLC0415
    from engines.cad import cadquery_import as _imp  # noqa: PLC0415

    wp = eval(build, {"cq": cq})  # noqa: S307 - test-only, fixed literal
    bb = wp.findSolid().BoundingBox()
    _imp._HANDLES[handle] = _imp.StepDocument(
        workplane=wp,
        bbox_min=(bb.xmin, bb.ymin, bb.zmin),
        bbox_max=(bb.xmax, bb.ymax, bb.zmax),
        source_path="<test>",
    )


# ── Tier 1: dispatch + param validation ─────────────────────────────────


def test_detail_drawing_dispatch_registered() -> None:
    """``cad.detail_drawing`` MUST appear in the sidecar dispatch table so the
    TS bridge can reach it. Drift here breaks the renderer's detail tool."""
    from engines.sidecar.main import _build_dispatch_table

    table = _build_dispatch_table()
    assert "cad.detail_drawing" in table
    assert "detail_drawing" in cad_handlers.HANDLERS


def test_detail_drawing_requires_handle() -> None:
    """Empty params short-circuit with ``bad_params`` BEFORE the CadQuery
    import — mirrors the BUILD-3 / BUILD-7 drawing posture."""
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.detail_drawing({})
    assert exc_info.value.code == "bad_params"


def test_detail_drawing_rejects_unknown_view() -> None:
    """A view typo (``'fornt'``) fails fast with ``bad_params`` and the error
    lists the allowed views so the renderer can surface them."""
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.detail_drawing({
            "handle": "script:abc",
            "view": "fornt",
            "center": {"x": 1, "y": 2},
            "radiusMm": 5.0,
        })
    assert exc_info.value.code == "bad_params"
    assert "front" in str(exc_info.value)


def test_detail_drawing_rejects_missing_center() -> None:
    """A missing crop ``center`` fails with ``bad_params`` (the core's
    point2d validator), before any CadQuery import."""
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.detail_drawing({
            "handle": "script:abc",
            "view": "front",
            "radiusMm": 5.0,
        })
    assert exc_info.value.code == "bad_params"


def test_detail_drawing_rejects_nonpositive_radius_and_scale() -> None:
    """A zero / negative ``radiusMm`` or ``scale`` is degenerate and MUST fail
    with ``bad_params`` rather than emitting an empty / inverted crop."""
    for bad in (
        {"radiusMm": 0.0},
        {"radiusMm": -3.0},
        {"radiusMm": 5.0, "scale": 0.0},
        {"radiusMm": 5.0, "scale": -2.0},
    ):
        with pytest.raises(_CadHandlerError) as exc_info:
            cad_handlers.detail_drawing({
                "handle": "script:abc",
                "view": "front",
                "center": {"x": 1, "y": 2},
                **bad,
            })
        assert exc_info.value.code == "bad_params"


def test_detail_drawing_rejects_unknown_handle() -> None:
    """A valid envelope with a stale handle reaches handle resolution and
    fails deterministically with ``invalid_handle`` regardless of whether
    CadQuery is installed."""
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.detail_drawing({
            "handle": "script:never-existed",
            "view": "front",
            "center": {"x": 1, "y": 2},
            "radiusMm": 5.0,
        })
    assert exc_info.value.code == "invalid_handle"


# ── Tier 2: full crop round trip ─────────────────────────────────────────


@requires_cadquery
def test_detail_drawing_returns_scaled_viewbox() -> None:
    """The crop returns a fresh SVG whose pixel canvas is ``scale ×`` its
    viewBox window — i.e. a genuinely SCALED viewBox (the magnification). The
    crop window is ``(cx-r, cy-r, 2r, 2r)`` and the parent linework is
    re-hosted clipped to the crop circle."""
    _register_detail_body("body:detail", "cq.Workplane('XY').box(30, 30, 30)")

    # Learn the parent canvas size so the crop window sits inside it.
    base = cad_handlers.project_drawing({"handle": "body:detail", "view": "front"})
    m = re.search(r'width="([0-9.]+)"\s+height="([0-9.]+)"', base["svg"])
    assert m is not None
    width, height = float(m.group(1)), float(m.group(2))
    cx, cy, radius, scale = width / 2.0, height / 2.0, 40.0, 2.0

    r = cad_handlers.detail_drawing({
        "handle": "body:detail",
        "view": "front",
        "center": {"x": cx, "y": cy},
        "radiusMm": radius,
        "scale": scale,
        "label": "DETAIL A",
    })
    svg = r["svg"]

    # Echoed crop params round-trip.
    assert r["view"] == "front"
    assert r["radiusMm"] == radius
    assert r["scale"] == scale
    assert r["center"] == {"x": cx, "y": cy}
    assert r["bytes"] == len(svg.encode("utf-8"))

    # The viewBox window is 2r; the pixel canvas is 2r*scale -> ratio == scale.
    vb = re.search(r'viewBox="([\-0-9.]+) ([\-0-9.]+) ([0-9.]+) ([0-9.]+)"', svg)
    assert vb is not None, "detail SVG must carry a viewBox"
    vb_x, vb_y, vb_w, vb_h = (float(vb.group(i)) for i in range(1, 5))
    px = re.search(r'<svg[^>]*\swidth="([0-9.]+)"[^>]*\sheight="([0-9.]+)"', svg)
    assert px is not None
    px_w, px_h = float(px.group(1)), float(px.group(2))
    assert abs(vb_w - 2.0 * radius) < 1e-6
    assert abs(vb_h - 2.0 * radius) < 1e-6
    assert abs(px_w - 2.0 * radius * scale) < 1e-6
    assert abs(px_h - 2.0 * radius * scale) < 1e-6
    # The genuinely-scaled viewBox: canvas / window == magnification.
    assert abs((px_w / vb_w) - scale) < 1e-6
    # viewBox origin centres the crop on the operator's point.
    assert abs(vb_x - (cx - radius)) < 1e-6
    assert abs(vb_y - (cy - radius)) < 1e-6

    # Structure: a clipped re-host of the parent linework + a detail circle.
    assert 'class="detail-view"' in svg
    assert "clip-path=\"url(#wt-detail-clip-" in svg
    assert "<path" in svg  # parent linework actually re-hosted
    assert "(2:1)" in svg  # integer magnification renders as a ratio caption


@requires_cadquery
def test_detail_drawing_label_is_xml_escaped() -> None:
    """A detail label carrying XML metacharacters MUST be entity-escaped in the
    emitted SVG AND in the echoed ``label`` field. The detail SVG is rendered
    via ``dangerouslySetInnerHTML`` and the label is operator free-text
    persisted in drawing.json — escaping at the sidecar is the stored-XSS guard
    (Safety Rule 4)."""
    _register_detail_body("body:detail2", "cq.Workplane('XY').box(30, 30, 30)")
    base = cad_handlers.project_drawing({"handle": "body:detail2", "view": "front"})
    m = re.search(r'width="([0-9.]+)"\s+height="([0-9.]+)"', base["svg"])
    assert m is not None
    width, height = float(m.group(1)), float(m.group(2))

    r = cad_handlers.detail_drawing({
        "handle": "body:detail2",
        "view": "front",
        "center": {"x": width / 2.0, "y": height / 2.0},
        "radiusMm": 40.0,
        "label": "</text><script>alert(1)</script> & done",
    })
    svg = r["svg"]
    # No raw markup from the label may survive into the SVG.
    assert "<script>" not in svg
    assert "</text><script>" not in svg
    # The metacharacters are entity-escaped; the inner text is preserved.
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in svg
    assert "&amp; done" in svg
    # The echoed label field is escaped too (it is persisted / re-displayed).
    assert "<script>" not in r["label"]
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in r["label"]
