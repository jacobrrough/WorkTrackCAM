"""
G-code post-processor with multi-controller support.

Converts ToolpathResult (motion segments) into controller-specific G-code.
Supports: Fanuc, GRBL, Siemens 840D, Heidenhain TNC, and generic dialects.

Output matches the existing IPC contract: list of G-code line strings.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from .models import (
    PostDialect,
    ToolpathResult,
    ToolpathChain,
    MotionSegment,
    Tool,
    CutParams,
)


@dataclass
class PostConfig:
    """Post-processor configuration."""
    dialect: PostDialect = PostDialect.GENERIC
    decimal_places: int = 3
    use_line_numbers: bool = False
    line_number_start: int = 10
    line_number_increment: int = 10
    include_comments: bool = True
    include_header: bool = True
    include_footer: bool = True
    program_number: int = 1
    tool_number: int = 1
    work_offset: str = "G54"
    coolant: str = "M8"  # M8=flood, M7=mist, M9=off


def generate_gcode(
    result: ToolpathResult,
    tool: Tool,
    cuts: CutParams,
    config: PostConfig | None = None,
) -> list[str]:
    """
    Convert a ToolpathResult into G-code lines.

    Returns list of strings matching the existing IPC contract format.
    """
    if config is None:
        config = PostConfig()

    dialect = _get_dialect(config.dialect)
    lines: list[str] = []
    ln = [config.line_number_start]  # mutable counter

    def _emit(line: str) -> None:
        if config.use_line_numbers:
            lines.append(f"N{ln[0]} {line}")
            ln[0] += config.line_number_increment
        else:
            lines.append(line)

    def _comment(text: str) -> None:
        if config.include_comments:
            _emit(dialect.format_comment(text))

    # Header
    if config.include_header:
        for h in dialect.header(config, tool, cuts):
            _emit(h)

    # Track modal state to suppress redundant codes
    modal_g = ""
    modal_f = -1.0
    prev_x, prev_y, prev_z = None, None, None
    fmt = f".{config.decimal_places}f"

    for chain in result.chains:
        if chain.comment:
            _comment(chain.comment)

        for seg in chain.segments:
            g_code = "G0" if seg.is_rapid else "G1"

            # Build coordinate words, suppressing unchanged values
            words: list[str] = []

            if g_code != modal_g:
                words.append(g_code)
                modal_g = g_code

            if prev_x is None or abs(seg.x - prev_x) > 1e-6:
                words.append(f"X{seg.x:{fmt}}")
                prev_x = seg.x
            if prev_y is None or abs(seg.y - prev_y) > 1e-6:
                words.append(f"Y{seg.y:{fmt}}")
                prev_y = seg.y
            if prev_z is None or abs(seg.z - prev_z) > 1e-6:
                words.append(f"Z{seg.z:{fmt}}")
                prev_z = seg.z

            # A-axis
            if seg.a is not None:
                words.append(f"A{seg.a:{fmt}}")

            # Feed rate (only on feed moves, suppress if unchanged)
            if not seg.is_rapid and seg.feed > 0:
                f_rounded = round(seg.feed, 0)
                if f_rounded != modal_f:
                    words.append(f"F{f_rounded:.0f}")
                    modal_f = f_rounded

            if words:
                _emit(" ".join(words))

    # Footer
    if config.include_footer:
        for f_line in dialect.footer(config):
            _emit(f_line)

    return lines


def toolpath_to_ipc_lines(
    result: ToolpathResult,
    tool: Tool,
    cuts: CutParams,
    dialect: PostDialect = PostDialect.GENERIC,
) -> list[str]:
    """
    Convert ToolpathResult to the simple G-code line format used by the
    existing Unified Fab Studio IPC contract.

    This produces bare G0/G1 lines without headers, footers, or line numbers.
    The cam-runner post-processes these through Handlebars templates.
    """
    lines: list[str] = []
    fmt = ".3f"

    for chain in result.chains:
        if chain.comment:
            lines.append(f"; {chain.comment}")

        for seg in chain.segments:
            if seg.is_rapid:
                parts = [f"G0 X{seg.x:{fmt}} Y{seg.y:{fmt}} Z{seg.z:{fmt}}"]
            else:
                parts = [f"G1 X{seg.x:{fmt}} Y{seg.y:{fmt}} Z{seg.z:{fmt}} F{seg.feed:.0f}"]

            if seg.a is not None:
                # Insert A-word before F-word
                parts[0] = parts[0].replace(
                    f" F{seg.feed:.0f}",
                    f" A{seg.a:{fmt}} F{seg.feed:.0f}",
                )

            lines.append(parts[0])

    return lines


# ── Dialect implementations ──────────────────────────────────────────────

class _Dialect:
    """Base post-processor dialect."""

    def format_comment(self, text: str) -> str:
        return f"({text})"

    def header(self, config: PostConfig, tool: Tool, cuts: CutParams) -> list[str]:
        return [
            "%",
            f"O{config.program_number:04d}",
            self.format_comment(f"Tool: D{tool.diameter_mm:.1f}mm"),
            "G90 G21",  # absolute, metric
            f"G17",     # XY plane
            f"{config.work_offset}",
            f"T{config.tool_number} M6",
            f"S{cuts.spindle_rpm:.0f} M3",
            config.coolant,
        ]

    def footer(self, config: PostConfig) -> list[str]:
        return [
            "M9",           # coolant off
            "M5",           # spindle stop
            "G28 G91 Z0",   # return to reference
            "M30",          # program end
            "%",
        ]


class _FanucDialect(_Dialect):
    """Fanuc-compatible post."""
    pass  # Base dialect is Fanuc-style


class _GrblDialect(_Dialect):
    """GRBL-compatible post (simpler, no % delimiters)."""

    def header(self, config: PostConfig, tool: Tool, cuts: CutParams) -> list[str]:
        return [
            self.format_comment(f"Advanced toolpath - Tool D{tool.diameter_mm:.1f}mm"),
            "G90 G21",
            f"S{cuts.spindle_rpm:.0f} M3",
            "G4 P2",  # dwell for spindle spin-up
        ]

    def footer(self, config: PostConfig) -> list[str]:
        return [
            f"G0 Z{10.0:.3f}",
            "M5",
            "M2",
        ]


class _SiemensDialect(_Dialect):
    """Siemens 840D-compatible post."""

    def format_comment(self, text: str) -> str:
        return f"; {text}"

    def header(self, config: PostConfig, tool: Tool, cuts: CutParams) -> list[str]:
        return [
            f"; Advanced toolpath",
            f"; Tool: D{tool.diameter_mm:.1f}mm",
            f"T{config.tool_number} D1",
            "M6",
            "G90 G71",  # absolute, metric
            f"G17",
            f"TRANS X0 Y0 Z0",
            f"S{cuts.spindle_rpm:.0f} M3",
            f"M8",
        ]

    def footer(self, config: PostConfig) -> list[str]:
        return [
            "M9",
            "M5",
            "G0 Z100",
            "M30",
        ]


class _HeidenhainDialect(_Dialect):
    """Heidenhain TNC-compatible post (conversational-style)."""

    def format_comment(self, text: str) -> str:
        return f"; {text}"

    def header(self, config: PostConfig, tool: Tool, cuts: CutParams) -> list[str]:
        return [
            "BEGIN PGM ADVANCED MM",
            f"; Tool: D{tool.diameter_mm:.1f}mm",
            f"TOOL CALL {config.tool_number} Z S{cuts.spindle_rpm:.0f}",
            f"M3 M8",
        ]

    def footer(self, config: PostConfig) -> list[str]:
        return [
            "M9",
            "M5",
            "TOOL CALL 0",
            "END PGM ADVANCED MM",
        ]


def _get_dialect(dialect: PostDialect) -> _Dialect:
    """Return the dialect handler for a given PostDialect enum."""
    return {
        PostDialect.FANUC: _FanucDialect(),
        PostDialect.GRBL: _GrblDialect(),
        PostDialect.SIEMENS: _SiemensDialect(),
        PostDialect.HEIDENHAIN: _HeidenhainDialect(),
        PostDialect.GENERIC: _Dialect(),
    }.get(dialect, _Dialect())
