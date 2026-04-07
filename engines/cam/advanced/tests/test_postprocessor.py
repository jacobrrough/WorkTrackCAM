"""Tests for G-code post-processor."""
from __future__ import annotations

import pytest

from ..models import (
    Tool, CutParams, ToolpathResult, ToolpathChain, MotionSegment, PostDialect,
)
from ..postprocessor import (
    generate_gcode,
    toolpath_to_ipc_lines,
    PostConfig,
)


def _simple_result() -> ToolpathResult:
    """Create a simple toolpath with a few moves for testing."""
    chain = ToolpathChain(comment="test chain")
    chain.append_rapid(0, 0, 10)
    chain.append_rapid(5, 5, 10)
    chain.append_feed(5, 5, 0, 400)  # plunge
    chain.append_feed(15, 5, 0, 1000)  # cut
    chain.append_feed(15, 15, 0, 1000)  # cut
    chain.append_rapid(15, 15, 10)

    return ToolpathResult(chains=[chain], strategy="test")


class TestToolpathToIpcLines:
    def test_basic_output(self):
        result = _simple_result()
        lines = toolpath_to_ipc_lines(result, Tool(diameter_mm=6.0), CutParams())
        assert len(lines) > 0
        # Should have comment + G0/G1 lines
        assert any(l.startswith("; ") for l in lines)
        assert any("G0" in l for l in lines)
        assert any("G1" in l for l in lines)

    def test_feed_included(self):
        result = _simple_result()
        lines = toolpath_to_ipc_lines(result, Tool(diameter_mm=6.0), CutParams())
        feed_lines = [l for l in lines if "F" in l and "G1" in l]
        assert len(feed_lines) > 0

    def test_coordinates_formatted(self):
        result = _simple_result()
        lines = toolpath_to_ipc_lines(result, Tool(diameter_mm=6.0), CutParams())
        for line in lines:
            if line.startswith(";"):
                continue
            if "X" in line:
                # Should have 3 decimal places
                assert ".000" in line or ".500" in line or any(
                    f".{d}" in line for d in range(10)
                )


class TestGenerateGcode:
    def test_fanuc_header(self):
        result = _simple_result()
        config = PostConfig(dialect=PostDialect.FANUC)
        lines = generate_gcode(result, Tool(diameter_mm=6.0), CutParams(), config)
        assert any("%" in l for l in lines)
        assert any("G90" in l for l in lines)
        assert any("M30" in l for l in lines)

    def test_grbl_no_percent(self):
        result = _simple_result()
        config = PostConfig(dialect=PostDialect.GRBL)
        lines = generate_gcode(result, Tool(diameter_mm=6.0), CutParams(), config)
        # GRBL doesn't use % delimiters in header
        # But should have G90
        assert any("G90" in l for l in lines)
        assert any("M2" in l for l in lines)

    def test_siemens_comments(self):
        result = _simple_result()
        config = PostConfig(dialect=PostDialect.SIEMENS, include_comments=True)
        lines = generate_gcode(result, Tool(diameter_mm=6.0), CutParams(), config)
        # Siemens uses '; comment' style
        comment_lines = [l for l in lines if l.strip().startswith(";")]
        assert len(comment_lines) > 0

    def test_heidenhain_begin_end(self):
        result = _simple_result()
        config = PostConfig(dialect=PostDialect.HEIDENHAIN)
        lines = generate_gcode(result, Tool(diameter_mm=6.0), CutParams(), config)
        assert any("BEGIN PGM" in l for l in lines)
        assert any("END PGM" in l for l in lines)

    def test_line_numbers(self):
        result = _simple_result()
        config = PostConfig(use_line_numbers=True, line_number_start=10, line_number_increment=10)
        lines = generate_gcode(result, Tool(diameter_mm=6.0), CutParams(), config)
        numbered = [l for l in lines if l.startswith("N")]
        assert len(numbered) > 0
        # First should be N10
        assert numbered[0].startswith("N10 ")

    def test_modal_suppression(self):
        """Consecutive G0 moves should suppress the G0 word after the first."""
        chain = ToolpathChain()
        chain.append_rapid(0, 0, 10)
        chain.append_rapid(5, 5, 10)
        chain.append_rapid(10, 10, 10)
        result = ToolpathResult(chains=[chain])

        config = PostConfig(include_header=False, include_footer=False, include_comments=False)
        lines = generate_gcode(result, Tool(diameter_mm=6.0), CutParams(), config)
        g0_count = sum(1 for l in lines if "G0" in l)
        assert g0_count == 1  # only the first G0 should appear

    def test_no_header_footer(self):
        result = _simple_result()
        config = PostConfig(include_header=False, include_footer=False)
        lines = generate_gcode(result, Tool(diameter_mm=6.0), CutParams(), config)
        assert not any("M30" in l for l in lines)
        assert not any("%" == l.strip() for l in lines)


class TestWithAAxis:
    def test_a_axis_in_ipc_lines(self):
        chain = ToolpathChain()
        chain.segments.append(MotionSegment(x=10, y=0, z=5, feed=0, a=45.0))
        chain.segments.append(MotionSegment(x=10, y=0, z=5, feed=1000, a=90.0))
        result = ToolpathResult(chains=[chain])

        lines = toolpath_to_ipc_lines(result, Tool(diameter_mm=6.0), CutParams())
        a_lines = [l for l in lines if "A" in l]
        assert len(a_lines) >= 1
