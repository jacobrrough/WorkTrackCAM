"""Paired-pin contract for engines/cam/advanced/postprocessor.py invariants.

[ID-0191] Cycle 115 cam-engine pull. Extends the existing test_postprocessor.py
basic coverage (11 it() methods) with explicit invariants the existing tests
leave unpinned. Drift defense for two areas in particular:

1. **A-axis emission semantics** -- A-word position vs F-word, decimal-3 format,
   per-segment emission (no modal suppression) -- critical for Makera Carvera
   + 4th Axis Rotary 4-axis indexed jobs where a stale A inheritance would
   silently rotate the workpiece off-cut.
2. **Modal suppression** -- G1/F/X/Y/Z modal economy in generate_gcode()
   already used by the cam-runner orchestrator for advanced strategies on
   Laguna Swift 5x10 routing. Drops in modal economy bloat post-processed
   files; missed-suppression bugs would inflate Mach3-superset RichAuto
   A-series jobs by ~3-5x in line count.

Plus per-dialect safety pins (GRBL spindle warm-up dwell, Fanuc tape markers
+ G28 G91 Z0 retract, decimal-place config knob, comment suppression rules,
empty-result edge case).

All test methods are CARVERA / LAGUNA-relevant (the Python advanced engine
feeds the cam-runner orchestrator which dispatches strategies for these two
machines via Handlebars post-templates downstream). The Creality K2 Plus FDM
path does NOT consume this engine, so K2 is out of scope here -- the dialect
enum has no FDM entry by design.
"""
from __future__ import annotations

import re

import pytest

from ..models import (
    CutParams,
    MotionSegment,
    PostDialect,
    Tool,
    ToolpathChain,
    ToolpathResult,
)
from ..postprocessor import (
    PostConfig,
    generate_gcode,
    toolpath_to_ipc_lines,
)


def _ipc_chain() -> ToolpathResult:
    """Multi-segment chain for IPC line and modal-suppression tests."""
    chain = ToolpathChain(comment="contract chain")
    chain.append_rapid(0, 0, 10)
    chain.append_feed(5, 5, 0, 400)  # plunge
    chain.append_feed(10, 5, 0, 1000)  # cut
    chain.append_feed(10, 10, 0, 1000)  # cut, same feed
    return ToolpathResult(chains=[chain])


def _aaxis_chain() -> ToolpathResult:
    """Feed-only chain with A-axis values for Carvera 4-axis pins.

    NOTE: rapids carry no F-word, and toolpath_to_ipc_lines\'s A-insertion
    logic uses a string.replace on the F-word -- so A is silently dropped on
    rapid moves in that path. This fixture sticks to feed moves so that A is
    actually emitted; testing the rapid quirk is out of scope for this
    contract (it is current behavior, not a documented invariant).
    """
    chain = ToolpathChain()
    chain.segments.append(MotionSegment(x=10, y=0, z=5, feed=1000, a=45.0))
    chain.segments.append(MotionSegment(x=10, y=0, z=5, feed=1000, a=90.0))
    chain.segments.append(MotionSegment(x=20, y=0, z=5, feed=1000, a=180.0))
    return ToolpathResult(chains=[chain])


# ── toolpath_to_ipc_lines: A-axis ordering & format ─────────────────────────


class TestIpcLinesAxisOrdering:
    """Pins A-axis ordering & format in toolpath_to_ipc_lines (Carvera 4-axis)."""

    def test_a_word_precedes_f_word(self):
        result = _aaxis_chain()
        lines = toolpath_to_ipc_lines(result, Tool(diameter_mm=6.0), CutParams())
        for line in lines:
            if line.startswith("G1") and "A" in line and "F" in line:
                assert line.index("A") < line.index("F"), (
                    f"A-word must precede F-word in IPC line: {line}"
                )

    def test_a_axis_decimal_three(self):
        result = _aaxis_chain()
        lines = toolpath_to_ipc_lines(result, Tool(diameter_mm=6.0), CutParams())
        a_lines = [l for l in lines if " A" in l]
        assert len(a_lines) >= 2
        for line in a_lines:
            m = re.search(r"A(-?\d+\.\d+)", line)
            assert m is not None, f"line carries A but no formatted value: {line}"
            decimals = m.group(1).split(".")[1]
            assert len(decimals) == 3, (
                f"A-axis must use 3 decimal places (Carvera convention): {line}"
            )

    def test_a_emitted_per_segment_no_modal_suppression(self):
        """Carvera safety: every A-bearing segment must carry its A explicitly."""
        result = _aaxis_chain()
        lines = toolpath_to_ipc_lines(result, Tool(diameter_mm=6.0), CutParams())
        a_lines = [l for l in lines if " A" in l]
        assert len(a_lines) == 3
        assert any("A45.000" in l for l in a_lines)
        assert any("A90.000" in l for l in a_lines)
        assert any("A180.000" in l for l in a_lines)

    def test_no_a_word_when_a_is_none(self):
        chain = ToolpathChain()
        chain.append_rapid(0, 0, 10)
        chain.append_feed(5, 5, 0, 400)
        result = ToolpathResult(chains=[chain])
        lines = toolpath_to_ipc_lines(result, Tool(diameter_mm=6.0), CutParams())
        # comment lines start with `;`; only inspect motion lines
        motion = [l for l in lines if not l.startswith(";")]
        assert all("A" not in l for l in motion), (
            "no A-word should be emitted when MotionSegment.a is None"
        )


# ── toolpath_to_ipc_lines: format invariants ────────────────────────────────


class TestIpcLinesFormat:
    """Pins decimal precision and G0/G1 emission format in toolpath_to_ipc_lines."""

    def test_xyz_decimal_three(self):
        result = _ipc_chain()
        lines = toolpath_to_ipc_lines(result, Tool(diameter_mm=6.0), CutParams())
        for line in lines:
            if line.startswith(";"):
                continue
            for axis in ("X", "Y", "Z"):
                m = re.search(rf"{axis}(-?\d+\.\d+)", line)
                if m:
                    decimals = m.group(1).split(".")[1]
                    assert len(decimals) == 3, (
                        f"{axis} must use 3 decimal places: {line}"
                    )

    def test_feed_word_integer_format(self):
        result = _ipc_chain()
        lines = toolpath_to_ipc_lines(result, Tool(diameter_mm=6.0), CutParams())
        for line in lines:
            m = re.search(r"F(\d+)(\.\d*)?", line)
            if m and m.group(2):
                pytest.fail(
                    f"F-word must be integer-formatted (no decimals): {line}"
                )

    def test_rapid_omits_feed_word(self):
        result = _ipc_chain()
        lines = toolpath_to_ipc_lines(result, Tool(diameter_mm=6.0), CutParams())
        for line in lines:
            if line.startswith("G0"):
                assert "F" not in line, f"G0 line must not carry feed: {line}"

    def test_comment_prefix_semicolon_space(self):
        result = _ipc_chain()
        lines = toolpath_to_ipc_lines(result, Tool(diameter_mm=6.0), CutParams())
        comment_lines = [l for l in lines if l.startswith(";")]
        assert len(comment_lines) == 1
        assert comment_lines[0] == "; contract chain"

    def test_every_motion_line_has_xyz(self):
        """toolpath_to_ipc_lines does NOT modal-suppress -- every motion line
        carries an explicit X, Y, Z so the controller never inherits a stale
        coordinate from a prior segment."""
        result = _ipc_chain()
        lines = toolpath_to_ipc_lines(result, Tool(diameter_mm=6.0), CutParams())
        for line in lines:
            if line.startswith(";"):
                continue
            assert "X" in line and "Y" in line and "Z" in line, (
                f"toolpath_to_ipc_lines must emit X+Y+Z explicitly per motion: {line}"
            )


# ── generate_gcode: modal suppression ───────────────────────────────────────


class TestGenerateGcodeModal:
    """Pins modal suppression for G/F/X/Y/Z words in generate_gcode."""

    def test_g1_modal_emitted_once_across_consecutive_feeds(self):
        chain = ToolpathChain()
        chain.append_feed(0, 0, 0, 1000)
        chain.append_feed(5, 0, 0, 1000)
        chain.append_feed(10, 0, 0, 1000)
        result = ToolpathResult(chains=[chain])
        config = PostConfig(
            include_header=False, include_footer=False, include_comments=False
        )
        lines = generate_gcode(result, Tool(diameter_mm=6.0), CutParams(), config)
        g1_count = sum(1 for l in lines if "G1" in l)
        assert g1_count == 1, (
            "G1 must be modal: emitted once across consecutive feed moves"
        )

    def test_g0_modal_emitted_once_across_consecutive_rapids(self):
        chain = ToolpathChain()
        chain.append_rapid(0, 0, 10)
        chain.append_rapid(5, 5, 10)
        chain.append_rapid(10, 10, 10)
        result = ToolpathResult(chains=[chain])
        config = PostConfig(
            include_header=False, include_footer=False, include_comments=False
        )
        lines = generate_gcode(result, Tool(diameter_mm=6.0), CutParams(), config)
        g0_count = sum(1 for l in lines if "G0" in l)
        assert g0_count == 1

    def test_feed_modal_suppression_when_unchanged(self):
        chain = ToolpathChain()
        chain.append_feed(0, 0, 0, 1000)
        chain.append_feed(5, 0, 0, 1000)  # same feed
        chain.append_feed(10, 0, 0, 1500)  # changed feed
        result = ToolpathResult(chains=[chain])
        config = PostConfig(
            include_header=False, include_footer=False, include_comments=False
        )
        lines = generate_gcode(result, Tool(diameter_mm=6.0), CutParams(), config)
        f_lines = [l for l in lines if "F" in l]
        assert len(f_lines) == 2, "F must be emitted only when the feed changes"

    def test_y_coordinate_modal_suppression(self):
        chain = ToolpathChain()
        chain.append_feed(0, 5, 0, 1000)
        chain.append_feed(10, 5, 0, 1000)  # Y unchanged
        chain.append_feed(20, 5, 0, 1000)  # Y still unchanged
        result = ToolpathResult(chains=[chain])
        config = PostConfig(
            include_header=False, include_footer=False, include_comments=False
        )
        lines = generate_gcode(result, Tool(diameter_mm=6.0), CutParams(), config)
        y_lines = [l for l in lines if "Y" in l]
        assert len(y_lines) == 1, "Y must be suppressed across unchanged values"

    def test_z_coordinate_modal_suppression(self):
        chain = ToolpathChain()
        chain.append_feed(0, 0, 5, 1000)
        chain.append_feed(10, 0, 5, 1000)
        chain.append_feed(20, 0, 5, 1000)
        result = ToolpathResult(chains=[chain])
        config = PostConfig(
            include_header=False, include_footer=False, include_comments=False
        )
        lines = generate_gcode(result, Tool(diameter_mm=6.0), CutParams(), config)
        z_lines = [l for l in lines if "Z" in l]
        assert len(z_lines) == 1


# ── generate_gcode: A-axis emission (Carvera 4-axis path) ───────────────────


class TestGenerateGcodeAaxis:
    """Pins A-axis emission in generate_gcode (Carvera 4-axis indexed path)."""

    def test_a_word_emitted_per_segment(self):
        result = _aaxis_chain()
        config = PostConfig(
            include_header=False, include_footer=False, include_comments=False
        )
        lines = generate_gcode(result, Tool(diameter_mm=6.0), CutParams(), config)
        a_lines = [l for l in lines if "A" in l]
        assert len(a_lines) == 3, (
            "A is NOT modal-suppressed in generate_gcode: every A-bearing "
            "segment must carry its value explicitly (Carvera safety)"
        )
        assert any("A45.000" in l for l in a_lines)
        assert any("A90.000" in l for l in a_lines)
        assert any("A180.000" in l for l in a_lines)

    def test_a_word_position_after_z_before_f(self):
        result = _aaxis_chain()
        config = PostConfig(
            include_header=False, include_footer=False, include_comments=False
        )
        lines = generate_gcode(result, Tool(diameter_mm=6.0), CutParams(), config)
        for line in lines:
            if "A" in line and "F" in line:
                assert line.index("A") < line.index("F"), (
                    f"A must precede F in {line}"
                )
            if "A" in line and "Z" in line:
                assert line.index("Z") < line.index("A"), (
                    f"Z must precede A in {line}"
                )


# ── GRBL dialect safety ─────────────────────────────────────────────────────


class TestGrblHeaderSafety:
    """Pins GRBL spindle warm-up dwell + safe-Z footer retract."""

    def test_grbl_header_includes_g4_p2_dwell(self):
        result = _ipc_chain()
        config = PostConfig(dialect=PostDialect.GRBL)
        lines = generate_gcode(result, Tool(diameter_mm=6.0), CutParams(), config)
        assert any("G4 P2" in l for l in lines), (
            "GRBL header must include G4 P2 dwell for spindle spin-up"
        )

    def test_grbl_header_metric_absolute(self):
        result = _ipc_chain()
        config = PostConfig(dialect=PostDialect.GRBL)
        lines = generate_gcode(result, Tool(diameter_mm=6.0), CutParams(), config)
        assert any("G90 G21" in l for l in lines)

    def test_grbl_footer_safe_z_retract_precedes_spindle_stop(self):
        result = _ipc_chain()
        config = PostConfig(dialect=PostDialect.GRBL)
        lines = generate_gcode(result, Tool(diameter_mm=6.0), CutParams(), config)
        m5_idx = next(i for i, l in enumerate(lines) if l == "M5")
        z_retract_idx = next(
            i for i, l in enumerate(lines) if l.startswith("G0 Z")
        )
        assert z_retract_idx < m5_idx, (
            "Safe-Z retract must precede M5 spindle stop in GRBL footer"
        )

    def test_grbl_footer_program_end_m2(self):
        result = _ipc_chain()
        config = PostConfig(dialect=PostDialect.GRBL)
        lines = generate_gcode(result, Tool(diameter_mm=6.0), CutParams(), config)
        # GRBL uses M2 not M30; pin both presence and tail-position
        assert lines[-1] == "M2"


# ── Fanuc dialect (default base) safety ─────────────────────────────────────


class TestFanucHeaderFooterSafety:
    """Pins Fanuc-style header/footer safety invariants."""

    def test_fanuc_header_required_safety_words(self):
        result = _ipc_chain()
        config = PostConfig(dialect=PostDialect.FANUC, include_comments=False)
        lines = generate_gcode(result, Tool(diameter_mm=6.0), CutParams(), config)
        assert any("G90 G21" in l for l in lines), "absolute + metric required"
        assert any(l.strip() == "G17" for l in lines), "XY plane select required"

    def test_fanuc_header_tape_markers(self):
        result = _ipc_chain()
        config = PostConfig(dialect=PostDialect.FANUC)
        lines = generate_gcode(result, Tool(diameter_mm=6.0), CutParams(), config)
        assert lines[0] == "%", "Fanuc tape start marker missing"
        assert lines[-1] == "%", "Fanuc tape end marker missing"

    def test_fanuc_footer_safety_sequence(self):
        result = _ipc_chain()
        config = PostConfig(dialect=PostDialect.FANUC)
        lines = generate_gcode(result, Tool(diameter_mm=6.0), CutParams(), config)
        idx_m9 = next(i for i, l in enumerate(lines) if l == "M9")
        idx_m5 = next(i for i, l in enumerate(lines) if l == "M5")
        idx_retract = next(i for i, l in enumerate(lines) if l == "G28 G91 Z0")
        idx_m30 = next(i for i, l in enumerate(lines) if l == "M30")
        assert idx_m9 < idx_m5 < idx_retract < idx_m30, (
            "footer safety order: M9 -> M5 -> G28 G91 Z0 -> M30"
        )

    def test_fanuc_header_tool_call_and_spindle(self):
        result = _ipc_chain()
        config = PostConfig(
            dialect=PostDialect.FANUC, tool_number=3, coolant="M7"
        )
        lines = generate_gcode(result, Tool(diameter_mm=6.0), CutParams(), config)
        # Tool call uses configured tool_number with M6
        assert any(l == "T3 M6" for l in lines)
        # Coolant uses configured value
        assert any(l == "M7" for l in lines)
        # Spindle on uses CutParams.spindle_rpm (default 10000) with M3
        assert any("S10000" in l and "M3" in l for l in lines)


# ── PostConfig.decimal_places knob ──────────────────────────────────────────


class TestDecimalPlacesConfig:
    """Pins PostConfig.decimal_places config knob in generate_gcode."""

    def test_decimal_places_four(self):
        result = _ipc_chain()
        config = PostConfig(
            decimal_places=4,
            include_header=False,
            include_footer=False,
            include_comments=False,
        )
        lines = generate_gcode(result, Tool(diameter_mm=6.0), CutParams(), config)
        for line in lines:
            for axis in ("X", "Y", "Z"):
                m = re.search(rf"{axis}(-?\d+\.\d+)", line)
                if m:
                    decimals = m.group(1).split(".")[1]
                    assert len(decimals) == 4, (
                        f"decimal_places=4 must produce 4-decimal {axis}: {line}"
                    )

    def test_decimal_places_two(self):
        result = _ipc_chain()
        config = PostConfig(
            decimal_places=2,
            include_header=False,
            include_footer=False,
            include_comments=False,
        )
        lines = generate_gcode(result, Tool(diameter_mm=6.0), CutParams(), config)
        for line in lines:
            for axis in ("X", "Y", "Z"):
                m = re.search(rf"{axis}(-?\d+\.\d+)", line)
                if m:
                    decimals = m.group(1).split(".")[1]
                    assert len(decimals) == 2


# ── Edge cases & generic dialect ────────────────────────────────────────────


class TestEdgeCases:
    """Edge cases: empty chains, comment suppression, generic dialect."""

    def test_empty_result_emits_only_header_footer(self):
        """Empty toolpath must still emit a complete safety wrap so the
        operator can dry-run the program before loading stock."""
        result = ToolpathResult(chains=[])
        config = PostConfig(dialect=PostDialect.FANUC)
        lines = generate_gcode(result, Tool(diameter_mm=6.0), CutParams(), config)
        assert lines[0] == "%"
        assert lines[-1] == "%"
        assert any("M30" in l for l in lines)
        assert any("G28 G91 Z0" == l for l in lines)
        assert any("G90 G21" in l for l in lines)

    def test_chain_comment_suppression(self):
        """Chain comments respect include_comments=False; header tool comment
        is unconditional (it is a hard-coded line in dialect.header())."""
        result = _ipc_chain()
        config = PostConfig(dialect=PostDialect.FANUC, include_comments=False)
        lines = generate_gcode(result, Tool(diameter_mm=6.0), CutParams(), config)
        assert not any("contract chain" in l for l in lines), (
            "chain.comment must be suppressed when include_comments=False"
        )

    def test_generic_dialect_default(self):
        """Default config must use GENERIC dialect with the base envelope."""
        result = _ipc_chain()
        lines = generate_gcode(result, Tool(diameter_mm=6.0), CutParams())
        assert lines[0] == "%"
        assert any("G90 G21" in l for l in lines)
        assert any("M30" == l for l in lines)
        assert any("G28 G91 Z0" == l for l in lines)

    def test_line_numbers_increment(self):
        """Line numbers increment by line_number_increment from line_number_start."""
        result = _ipc_chain()
        config = PostConfig(
            use_line_numbers=True,
            line_number_start=100,
            line_number_increment=5,
            include_header=False,
            include_footer=False,
            include_comments=False,
        )
        lines = generate_gcode(result, Tool(diameter_mm=6.0), CutParams(), config)
        ns = [
            int(l.split()[0][1:])
            for l in lines
            if l.startswith("N") and l[1].isdigit()
        ]
        assert ns[0] == 100
        # Each subsequent N must be exactly +5
        for prev, nxt in zip(ns, ns[1:]):
            assert nxt - prev == 5, f"line numbers must step by 5: {prev} -> {nxt}"
