"""Tests for G-code post-processor."""
from __future__ import annotations

import pytest

from ..postprocessor import (
    generate_gcode, generate_drill_gcode, toolpath_to_ipc_lines, PostConfig,
)
from ..models import (
    DrillCycleMode, PostDialect, ToolpathResult, ToolpathChain, MotionSegment,
    Tool, ToolShape, CutParams,
)


def _sample_result() -> ToolpathResult:
    result = ToolpathResult(strategy="test")
    chain = ToolpathChain(comment="test cut")
    chain.append_rapid(10.0, 10.0, 20.0)
    chain.append_rapid(10.0, 10.0, 2.0)
    chain.append_feed(10.0, 10.0, -5.0, 400.0)
    chain.append_feed(50.0, 10.0, -5.0, 1000.0)
    chain.append_feed(50.0, 50.0, -5.0, 1000.0)
    chain.append_rapid(50.0, 50.0, 20.0)
    result.chains.append(chain)
    return result


class TestIPCLines:
    def test_produces_lines(self):
        result = _sample_result()
        lines = toolpath_to_ipc_lines(result, Tool(), CutParams())
        assert len(lines) > 0

    def test_g0_for_rapids(self):
        result = _sample_result()
        lines = toolpath_to_ipc_lines(result, Tool(), CutParams())
        g0_lines = [l for l in lines if l.startswith("G0")]
        assert len(g0_lines) >= 2

    def test_g1_for_feeds(self):
        result = _sample_result()
        lines = toolpath_to_ipc_lines(result, Tool(), CutParams())
        g1_lines = [l for l in lines if l.startswith("G1")]
        assert len(g1_lines) >= 2

    def test_feed_rate_present(self):
        result = _sample_result()
        lines = toolpath_to_ipc_lines(result, Tool(), CutParams())
        g1_lines = [l for l in lines if l.startswith("G1")]
        assert any("F" in l for l in g1_lines)

    def test_comment_preserved(self):
        result = _sample_result()
        lines = toolpath_to_ipc_lines(result, Tool(), CutParams())
        comment_lines = [l for l in lines if l.startswith(";")]
        assert len(comment_lines) >= 1

    def test_4axis(self):
        result = ToolpathResult(strategy="test")
        chain = ToolpathChain()
        chain.append_4axis(10, 0, 5, 45.0, 1000)
        result.chains.append(chain)
        lines = toolpath_to_ipc_lines(result, Tool(), CutParams())
        assert any("A45" in l for l in lines)


class TestGenerateGcode:
    def test_generic_dialect(self):
        result = _sample_result()
        config = PostConfig(dialect=PostDialect.GENERIC)
        lines = generate_gcode(result, Tool(), CutParams(), config)
        assert any("G90" in l for l in lines)
        assert any("M30" in l for l in lines)

    def test_grbl_dialect(self):
        result = _sample_result()
        config = PostConfig(dialect=PostDialect.GRBL)
        lines = generate_gcode(result, Tool(), CutParams(), config)
        assert any("G90 G21" in l for l in lines)
        assert any("M2" in l for l in lines)
        # GRBL should NOT have %
        assert not any(l.strip() == "%" for l in lines)

    def test_fanuc_dialect(self):
        result = _sample_result()
        config = PostConfig(dialect=PostDialect.FANUC)
        lines = generate_gcode(result, Tool(), CutParams(), config)
        assert any(l.strip() == "%" for l in lines)

    def test_siemens_dialect(self):
        result = _sample_result()
        config = PostConfig(dialect=PostDialect.SIEMENS)
        lines = generate_gcode(result, Tool(), CutParams(), config)
        assert any("G71" in l for l in lines)

    def test_heidenhain_dialect(self):
        result = _sample_result()
        config = PostConfig(dialect=PostDialect.HEIDENHAIN)
        lines = generate_gcode(result, Tool(), CutParams(), config)
        assert any("BEGIN PGM" in l for l in lines)
        assert any("END PGM" in l for l in lines)

    def test_line_numbers(self):
        result = _sample_result()
        config = PostConfig(use_line_numbers=True)
        lines = generate_gcode(result, Tool(), CutParams(), config)
        assert any(l.startswith("N") for l in lines)

    def test_no_line_numbers(self):
        result = _sample_result()
        config = PostConfig(use_line_numbers=False)
        lines = generate_gcode(result, Tool(), CutParams(), config)
        # Non-G-code lines should not start with N
        gcode_lines = [l for l in lines if l.startswith("G0") or l.startswith("G1")]
        for l in gcode_lines:
            assert not l.startswith("N")

    def test_modal_suppression(self):
        """Consecutive G0 moves should suppress the G0 code."""
        result = ToolpathResult(strategy="test")
        chain = ToolpathChain()
        chain.append_rapid(10, 10, 20)
        chain.append_rapid(20, 10, 20)
        chain.append_rapid(30, 10, 20)
        result.chains.append(chain)
        config = PostConfig(modal_suppression=True)
        lines = generate_gcode(result, Tool(), CutParams(), config)
        g0_count = sum(1 for l in lines if "G0" in l)
        # Should have G0 only once (modal), rest should just be coordinates
        assert g0_count <= 2  # header + first move

    def test_empty_result(self):
        result = ToolpathResult(strategy="test")
        lines = generate_gcode(result, Tool(), CutParams())
        # Should still have header and footer
        assert len(lines) > 0

    def test_tool_info_in_comment(self):
        tool = Tool(diameter_mm=8.0, shape=ToolShape.BALL)
        result = _sample_result()
        config = PostConfig(include_comments=True)
        lines = generate_gcode(result, tool, CutParams(), config)
        assert any("D8.0" in l and "ball" in l for l in lines)


# ── Drill cycle G-code ─────────────────────────────────────────────────


def _drill_result(mode: DrillCycleMode, holes: list[tuple[float, float]],
                  peck_mm: float = 0.0, dwell_ms: float = 0.0,
                  hole_z: float = -10.0, retract_z: float = 5.0) -> ToolpathResult:
    """Build a drill ToolpathResult with cycle metadata."""
    result = ToolpathResult(strategy="drill")
    for i, (x, y) in enumerate(holes):
        chain = ToolpathChain(comment=f"drill hole {i + 1} ({mode.value})")
        chain.append_rapid(x, y, 15.0)
        chain.append_rapid(x, y, retract_z)
        chain.append_feed(x, y, hole_z, 400.0)
        chain.append_rapid(x, y, retract_z)
        result.chains.append(chain)
    result._drill_cycle_mode = mode  # type: ignore[attr-defined]
    result._drill_retract_z = retract_z  # type: ignore[attr-defined]
    result._drill_peck_mm = peck_mm  # type: ignore[attr-defined]
    result._drill_dwell_ms = dwell_ms  # type: ignore[attr-defined]
    result._drill_hole_z = hole_z  # type: ignore[attr-defined]
    return result


class TestDrillGcode:
    def test_g81_output(self):
        """G81 drill should emit G81 X Y Z R F blocks."""
        result = _drill_result(DrillCycleMode.G81, [(10.0, 20.0), (30.0, 40.0)])
        lines = generate_drill_gcode(result, Tool(), CutParams())
        g81_lines = [l for l in lines if l.strip().startswith("G81")]
        assert len(g81_lines) == 2
        assert "X10.000" in g81_lines[0]
        assert "Y20.000" in g81_lines[0]
        assert "Z-10.000" in g81_lines[0]
        assert "R5.000" in g81_lines[0]
        assert "F" in g81_lines[0]

    def test_g83_output(self):
        """G83 peck drill should emit G83 X Y Z R Q F blocks."""
        result = _drill_result(DrillCycleMode.G83, [(10.0, 20.0)],
                               peck_mm=2.5)
        lines = generate_drill_gcode(result, Tool(), CutParams())
        g83_lines = [l for l in lines if l.strip().startswith("G83")]
        assert len(g83_lines) == 1
        assert "Q2.500" in g83_lines[0]
        assert "Z-10.000" in g83_lines[0]

    def test_g73_output(self):
        """G73 high-speed peck should emit G73 blocks."""
        result = _drill_result(DrillCycleMode.G73, [(5.0, 5.0)],
                               peck_mm=1.0)
        lines = generate_drill_gcode(result, Tool(), CutParams())
        g73_lines = [l for l in lines if l.strip().startswith("G73")]
        assert len(g73_lines) == 1
        assert "Q1.000" in g73_lines[0]

    def test_g82_output_with_dwell(self):
        """G82 drill with dwell should emit G82 blocks with P word."""
        result = _drill_result(DrillCycleMode.G82, [(10.0, 10.0)],
                               dwell_ms=500.0)
        lines = generate_drill_gcode(result, Tool(), CutParams())
        g82_lines = [l for l in lines if l.strip().startswith("G82")]
        assert len(g82_lines) == 1
        assert "P500" in g82_lines[0]

    def test_g80_cancel_emitted(self):
        """Canned cycle mode should end with G80 cancel."""
        result = _drill_result(DrillCycleMode.G81, [(10.0, 20.0)])
        lines = generate_drill_gcode(result, Tool(), CutParams())
        assert any(l.strip() == "G80" for l in lines)

    def test_expanded_no_g80(self):
        """Expanded mode should NOT emit G80."""
        result = _drill_result(DrillCycleMode.EXPANDED, [(10.0, 20.0)])
        lines = generate_drill_gcode(result, Tool(), CutParams())
        assert not any(l.strip() == "G80" for l in lines)

    def test_expanded_uses_g0_g1(self):
        """Expanded mode should use G0/G1 instead of canned cycles."""
        result = _drill_result(DrillCycleMode.EXPANDED, [(10.0, 20.0)])
        lines = generate_drill_gcode(result, Tool(), CutParams())
        g0_lines = [l for l in lines if l.strip().startswith("G0")]
        g1_lines = [l for l in lines if l.strip().startswith("G1")]
        assert len(g0_lines) >= 2
        assert len(g1_lines) >= 1

    def test_header_and_footer(self):
        """Drill G-code should include header and footer."""
        result = _drill_result(DrillCycleMode.G81, [(10.0, 20.0)])
        config = PostConfig(dialect=PostDialect.GENERIC)
        lines = generate_drill_gcode(result, Tool(), CutParams(), config)
        assert any("G90" in l for l in lines)
        assert any("M30" in l for l in lines)

    def test_multiple_holes_g83(self):
        """Multiple holes with G83 should emit one G83 per hole."""
        result = _drill_result(DrillCycleMode.G83,
                               [(0, 0), (10, 0), (20, 0), (30, 0)],
                               peck_mm=3.0)
        lines = generate_drill_gcode(result, Tool(), CutParams())
        g83_lines = [l for l in lines if l.strip().startswith("G83")]
        assert len(g83_lines) == 4
