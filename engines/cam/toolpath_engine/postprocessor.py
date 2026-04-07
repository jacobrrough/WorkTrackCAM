"""
G-code post-processor with multi-controller and multi-axis support.

Converts ToolpathResult into controller-specific G-code.
Supports: Fanuc, GRBL, Siemens 840D, Heidenhain TNC, Generic.

Multi-axis features:
- 5-axis RTCP/TCP (G43.4 / TRAORI / TCPM) for tool-tip control
- Inverse time feed (G93) for 5-axis moves
- B-axis word output for simultaneous 5-axis
- Tilted work plane (G68.2) for 3+2 positioning
- Cutter compensation (G41/G42) support
- Arc fitting: detects circular arcs in linear moves and outputs G2/G3

Two output modes:
1. generate_gcode() - Full G-code with headers/footers for standalone files
2. toolpath_to_ipc_lines() - Bare G0/G1 lines for IPC contract (Handlebars templates)
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from .models import (
    DrillCycleMode,
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
    coolant_code: str = "M8"
    modal_suppression: bool = True
    # Multi-axis options
    enable_rtcp: bool = False
    enable_inverse_time_feed: bool = False
    enable_cutter_comp: bool = False
    cutter_comp_side: str = "left"  # "left" (G41) or "right" (G42)
    # Arc fitting
    enable_arc_fitting: bool = True
    arc_tolerance: float = 0.005  # mm


def generate_gcode(
    result: ToolpathResult,
    tool: Tool,
    cuts: CutParams,
    config: PostConfig | None = None,
) -> list[str]:
    """Convert a ToolpathResult into full G-code with headers/footers."""
    if config is None:
        config = PostConfig()

    # Optionally fit arcs before generating G-code
    if config.enable_arc_fitting:
        result = _fit_arcs_in_result(result, config.arc_tolerance)

    dialect = _get_dialect(config.dialect)
    lines: list[str] = []
    ln = config.line_number_start

    def _emit(line: str) -> None:
        nonlocal ln
        if config.use_line_numbers:
            lines.append(f"N{ln} {line}")
            ln += config.line_number_increment
        else:
            lines.append(line)

    def _comment(text: str) -> None:
        if config.include_comments:
            _emit(dialect.format_comment(text))

    if config.include_header:
        for h in dialect.header(config, tool, cuts):
            _emit(h)

    # Enable RTCP if configured
    if config.enable_rtcp:
        for rtcp_line in dialect.enable_rtcp(config):
            _emit(rtcp_line)

    # Enable cutter compensation if configured
    if config.enable_cutter_comp:
        comp_code = "G41" if config.cutter_comp_side == "left" else "G42"
        _emit(f"{comp_code} D{config.tool_number}")

    # Modal state tracking
    modal_g = ""
    modal_f = -1.0
    prev_x = prev_y = prev_z = prev_a = prev_b = None
    fmt = f".{config.decimal_places}f"
    is_5axis = False

    for chain in result.chains:
        if chain.comment and config.include_comments:
            _comment(chain.comment)

        for seg in chain.segments:
            has_ab = seg.a is not None or seg.b is not None
            if has_ab and not is_5axis:
                is_5axis = True
                if config.enable_inverse_time_feed:
                    _emit("G93")  # Inverse time feed mode

            g_code = "G0" if seg.is_rapid else "G1"

            # Check for arc segments (stored via arc fitting)
            arc_map = getattr(chain, '_arc_map', None)
            arc_info = arc_map.get(id(seg)) if arc_map else None
            if arc_info is not None and not seg.is_rapid:
                # Emit G2 or G3 arc
                arc_g = "G2" if arc_info['cw'] else "G3"
                words: list[str] = [arc_g]

                if prev_x is None or abs(seg.x - prev_x) > 1e-6:
                    words.append(f"X{seg.x:{fmt}}")
                if prev_y is None or abs(seg.y - prev_y) > 1e-6:
                    words.append(f"Y{seg.y:{fmt}}")
                if prev_z is None or abs(seg.z - prev_z) > 1e-6:
                    words.append(f"Z{seg.z:{fmt}}")

                words.append(f"I{arc_info['i']:{fmt}}")
                words.append(f"J{arc_info['j']:{fmt}}")

                if not seg.is_rapid and seg.feed > 0:
                    f_rounded = round(seg.feed, 0)
                    if f_rounded != modal_f:
                        words.append(f"F{f_rounded:.0f}")
                        modal_f = f_rounded

                _emit(" ".join(words))
                modal_g = arc_g
                prev_x, prev_y, prev_z = seg.x, seg.y, seg.z
                continue

            words: list[str] = []

            if not config.modal_suppression or g_code != modal_g:
                words.append(g_code)
                modal_g = g_code

            # Coordinate words (suppress unchanged)
            if prev_x is None or abs(seg.x - prev_x) > 1e-6:
                words.append(f"X{seg.x:{fmt}}")
                prev_x = seg.x
            if prev_y is None or abs(seg.y - prev_y) > 1e-6:
                words.append(f"Y{seg.y:{fmt}}")
                prev_y = seg.y
            if prev_z is None or abs(seg.z - prev_z) > 1e-6:
                words.append(f"Z{seg.z:{fmt}}")
                prev_z = seg.z

            # 4-axis A word
            if seg.a is not None:
                if prev_a is None or abs(seg.a - prev_a) > 1e-6:
                    words.append(f"A{seg.a:{fmt}}")
                    prev_a = seg.a

            # 5-axis B word
            if seg.b is not None:
                if prev_b is None or abs(seg.b - prev_b) > 1e-6:
                    words.append(f"B{seg.b:{fmt}}")
                    prev_b = seg.b

            # Feed rate
            if not seg.is_rapid and seg.feed > 0:
                if config.enable_inverse_time_feed and has_ab:
                    # G93 inverse time: F = 1/minutes_for_this_move
                    inv_time_f = _compute_inverse_time_feed(
                        seg, prev_x, prev_y, prev_z, prev_a, prev_b)
                    if inv_time_f != modal_f:
                        words.append(f"F{inv_time_f:.1f}")
                        modal_f = inv_time_f
                else:
                    f_rounded = round(seg.feed, 0)
                    if f_rounded != modal_f:
                        words.append(f"F{f_rounded:.0f}")
                        modal_f = f_rounded

            if words:
                _emit(" ".join(words))

    # Disable cutter compensation
    if config.enable_cutter_comp:
        _emit("G40")

    # Disable RTCP
    if config.enable_rtcp:
        for rtcp_line in dialect.disable_rtcp(config):
            _emit(rtcp_line)

    # Switch back to normal feed mode if we used inverse time
    if is_5axis and config.enable_inverse_time_feed:
        _emit("G94")

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
    """Convert ToolpathResult to bare G0/G1/G2/G3 lines for IPC contract."""
    lines: list[str] = []
    fmt = ".3f"

    for chain in result.chains:
        if chain.comment:
            lines.append(f"; {chain.comment}")

        for seg in chain.segments:
            if seg.is_rapid:
                line = f"G0 X{seg.x:{fmt}} Y{seg.y:{fmt}} Z{seg.z:{fmt}}"
            else:
                line = f"G1 X{seg.x:{fmt}} Y{seg.y:{fmt}} Z{seg.z:{fmt}} F{seg.feed:.0f}"

            # Insert A-word
            if seg.a is not None:
                if seg.is_rapid:
                    line += f" A{seg.a:{fmt}}"
                else:
                    line = line.replace(
                        f" F{seg.feed:.0f}",
                        f" A{seg.a:{fmt}} F{seg.feed:.0f}",
                    )

            # Insert B-word
            if seg.b is not None:
                if seg.is_rapid:
                    line += f" B{seg.b:{fmt}}"
                else:
                    line = line.replace(
                        f" F{seg.feed:.0f}",
                        f" B{seg.b:{fmt}} F{seg.feed:.0f}",
                    )

            lines.append(line)

    return lines


# ═══════════════════════════════════════════════════════════════════════
# CANNED DRILL CYCLE POST-PROCESSING
# ═══════════════════════════════════════════════════════════════════════


def generate_drill_gcode(
    result: ToolpathResult,
    tool: Tool,
    cuts: CutParams,
    config: PostConfig | None = None,
) -> list[str]:
    """Generate G-code for drill cycles using canned cycle blocks.

    Instead of emitting the expanded rapid/feed sequences, this function
    outputs compact canned cycle blocks (G81/G82/G83/G73) per the drill
    cycle metadata stored on the result by the drill strategy.

    Standard canned cycle format (Fanuc):
        G81 X__ Y__ Z__ R__ F__    (simple drill)
        G82 X__ Y__ Z__ R__ P__ F__ (drill with dwell)
        G83 X__ Y__ Z__ R__ Q__ F__ (peck drill, full retract)
        G73 X__ Y__ Z__ R__ Q__ F__ (high-speed peck, partial retract)
        G80                          (cancel canned cycle)
    """
    if config is None:
        config = PostConfig()

    dialect = _get_dialect(config.dialect)
    lines: list[str] = []
    ln = config.line_number_start
    fmt = f".{config.decimal_places}f"

    def _emit(line: str) -> None:
        nonlocal ln
        if config.use_line_numbers:
            lines.append(f"N{ln} {line}")
            ln += config.line_number_increment
        else:
            lines.append(line)

    def _comment(text: str) -> None:
        if config.include_comments:
            _emit(dialect.format_comment(text))

    if config.include_header:
        for h in dialect.header(config, tool, cuts):
            _emit(h)

    # Extract drill metadata from result
    mode: DrillCycleMode = getattr(result, '_drill_cycle_mode', DrillCycleMode.G81)
    retract_z: float = getattr(result, '_drill_retract_z', cuts.safe_z_mm)
    peck_mm: float = getattr(result, '_drill_peck_mm', 0.0)
    dwell_ms: float = getattr(result, '_drill_dwell_ms', 0.0)
    hole_z: float = getattr(result, '_drill_hole_z', 0.0)
    plunge_feed = cuts.plunge_mm_min

    if config.include_comments:
        _comment(f"Drill cycle: {mode.value.upper()}, "
                 f"{len(result.chains)} holes, Z={hole_z:{fmt}}")

    # Initial safe-Z position
    _emit(f"G0 Z{cuts.safe_z_mm:{fmt}}")

    if mode == DrillCycleMode.EXPANDED:
        # Expanded mode: emit raw G0/G1 sequences
        for chain in result.chains:
            if chain.comment and config.include_comments:
                _comment(chain.comment)
            for seg in chain.segments:
                if seg.is_rapid:
                    _emit(f"G0 X{seg.x:{fmt}} Y{seg.y:{fmt}} Z{seg.z:{fmt}}")
                else:
                    _emit(f"G1 X{seg.x:{fmt}} Y{seg.y:{fmt}} Z{seg.z:{fmt}} "
                           f"F{seg.feed:.0f}")
    else:
        # Canned cycle mode
        for chain in result.chains:
            if chain.comment and config.include_comments:
                _comment(chain.comment)

            # Extract hole position from the first segment
            if not chain.segments:
                continue
            x = chain.segments[0].x
            y = chain.segments[0].y

            if mode == DrillCycleMode.G81:
                _emit(f"G81 X{x:{fmt}} Y{y:{fmt}} Z{hole_z:{fmt}} "
                       f"R{retract_z:{fmt}} F{plunge_feed:.0f}")

            elif mode == DrillCycleMode.G82:
                _emit(f"G82 X{x:{fmt}} Y{y:{fmt}} Z{hole_z:{fmt}} "
                       f"R{retract_z:{fmt}} P{dwell_ms:.0f} F{plunge_feed:.0f}")

            elif mode == DrillCycleMode.G83:
                _emit(f"G83 X{x:{fmt}} Y{y:{fmt}} Z{hole_z:{fmt}} "
                       f"R{retract_z:{fmt}} Q{peck_mm:{fmt}} F{plunge_feed:.0f}")

            elif mode == DrillCycleMode.G73:
                _emit(f"G73 X{x:{fmt}} Y{y:{fmt}} Z{hole_z:{fmt}} "
                       f"R{retract_z:{fmt}} Q{peck_mm:{fmt}} F{plunge_feed:.0f}")

        # Cancel canned cycle
        _emit("G80")

    # Final retract
    _emit(f"G0 Z{cuts.safe_z_mm:{fmt}}")

    if config.include_footer:
        for f_line in dialect.footer(config):
            _emit(f_line)

    return lines


# ═══════════════════════════════════════════════════════════════════════
# ARC FITTING
# ═══════════════════════════════════════════════════════════════════════

def _fit_arcs_in_result(result: ToolpathResult, tolerance: float) -> ToolpathResult:
    """Identify circular arcs in linear feed moves and tag them.

    Arc info is stored in chain._arc_map (dict[int, dict]) keyed by segment
    id(), because MotionSegment uses __slots__ and cannot hold extra attrs.
    """
    for chain in result.chains:
        _fit_arcs_in_chain(chain, tolerance)
    return result


def _fit_arcs_in_chain(chain: ToolpathChain, tolerance: float) -> None:
    """Scan a chain for sequences of feed moves that form circular arcs.

    Tags qualifying segments with _arc_info dict containing:
    - i, j: arc center offset from start point
    - cw: True for clockwise, False for counter-clockwise
    """
    segments = chain.segments
    n = len(segments)
    if n < 4:
        return

    i = 0
    while i < n - 2:
        # Only fit arcs through consecutive feed moves at the same Z
        if segments[i].is_rapid or segments[i + 1].is_rapid or segments[i + 2].is_rapid:
            i += 1
            continue

        # Check Z is constant (XY arc)
        z0 = segments[i].z
        if (abs(segments[i + 1].z - z0) > tolerance or
                abs(segments[i + 2].z - z0) > tolerance):
            i += 1
            continue

        # Skip if any have rotary axes (arcs don't apply to 5-axis moves)
        if (segments[i].a is not None or segments[i].b is not None or
                segments[i + 1].a is not None or segments[i + 1].b is not None):
            i += 1
            continue

        # Try to fit a circle through 3 points
        p0 = (segments[i].x, segments[i].y)
        p1 = (segments[i + 1].x, segments[i + 1].y)
        p2 = (segments[i + 2].x, segments[i + 2].y)

        center = _fit_circle_3pt(p0, p1, p2)
        if center is None:
            i += 1
            continue

        cx, cy, radius = center

        # Reject arcs with very small or very large radius
        if radius < 0.1 or radius > 1000.0:
            i += 1
            continue

        # Extend the arc: check how many subsequent points lie on this circle
        arc_end = i + 2
        while arc_end + 1 < n:
            next_seg = segments[arc_end + 1]
            if next_seg.is_rapid:
                break
            if abs(next_seg.z - z0) > tolerance:
                break
            if next_seg.a is not None or next_seg.b is not None:
                break

            d = math.sqrt((next_seg.x - cx) ** 2 + (next_seg.y - cy) ** 2)
            if abs(d - radius) > tolerance:
                break

            arc_end += 1

        # Minimum arc length: at least 3 points
        if arc_end - i < 2:
            i += 1
            continue

        # Determine CW or CCW
        cross = ((p1[0] - p0[0]) * (p2[1] - p0[1]) -
                 (p1[1] - p0[1]) * (p2[0] - p0[0]))
        is_cw = cross < 0

        # Tag the final segment of the arc with arc info via chain-level map
        # (MotionSegment uses __slots__, so we can't set arbitrary attrs)
        arc_seg = segments[arc_end]
        if not hasattr(chain, '_arc_map'):
            chain._arc_map = {}
        chain._arc_map[id(arc_seg)] = {
            'i': round(cx - segments[i].x, 4),
            'j': round(cy - segments[i].y, 4),
            'cw': is_cw,
            'radius': round(radius, 4),
        }

        # Remove intermediate segments (they're now part of the arc)
        del segments[i + 1:arc_end]
        n = len(segments)
        i += 2  # Skip past the arc
        continue


def _fit_circle_3pt(
    p0: tuple[float, float],
    p1: tuple[float, float],
    p2: tuple[float, float],
) -> tuple[float, float, float] | None:
    """Fit a circle through 3 points. Returns (cx, cy, radius) or None."""
    ax, ay = p0
    bx, by = p1
    cx, cy = p2

    d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
    if abs(d) < 1e-10:
        return None

    ux = ((ax * ax + ay * ay) * (by - cy) +
          (bx * bx + by * by) * (cy - ay) +
          (cx * cx + cy * cy) * (ay - by)) / d
    uy = ((ax * ax + ay * ay) * (cx - bx) +
          (bx * bx + by * by) * (ax - cx) +
          (cx * cx + cy * cy) * (bx - ax)) / d

    radius = math.sqrt((ax - ux) ** 2 + (ay - uy) ** 2)
    return (ux, uy, radius)


# ═══════════════════════════════════════════════════════════════════════
# INVERSE TIME FEED CALCULATION
# ═══════════════════════════════════════════════════════════════════════

def _compute_inverse_time_feed(
    seg: MotionSegment,
    prev_x: float | None, prev_y: float | None, prev_z: float | None,
    prev_a: float | None, prev_b: float | None,
) -> float:
    """Compute G93 inverse time feed rate for a 5-axis move.

    G93 mode: F value = 1/time_in_minutes for this move.
    Time = distance / linear_feed_rate.
    """
    if prev_x is None:
        return seg.feed if seg.feed > 0 else 1000.0

    # Linear distance
    dx = seg.x - (prev_x or 0.0)
    dy = seg.y - (prev_y or 0.0)
    dz = seg.z - (prev_z or 0.0)
    linear_dist = math.sqrt(dx * dx + dy * dy + dz * dz)

    # Include rotary distance (approximate: 1 degree ≈ some mm equivalent)
    rotary_equiv_mm_per_deg = 0.5  # Configurable
    da = abs(seg.a - (prev_a or 0.0)) if seg.a is not None else 0.0
    db = abs(seg.b - (prev_b or 0.0)) if seg.b is not None else 0.0
    rotary_dist = (da + db) * rotary_equiv_mm_per_deg

    total_dist = max(linear_dist + rotary_dist, 0.001)

    # Time in minutes = distance / feed_rate
    time_min = total_dist / max(seg.feed, 1.0)

    # F in G93 = 1/time_in_minutes
    inv_time_f = 1.0 / max(time_min, 1e-6)
    return round(min(inv_time_f, 99999.0), 1)


# ═══════════════════════════════════════════════════════════════════════
# DIALECT IMPLEMENTATIONS
# ═══════════════════════════════════════════════════════════════════════

class _Dialect:
    """Base post-processor dialect (Fanuc-style)."""

    def format_comment(self, text: str) -> str:
        return f"({text})"

    def header(self, config: PostConfig, tool: Tool, cuts: CutParams) -> list[str]:
        return [
            "%",
            f"O{config.program_number:04d}",
            self.format_comment(f"Tool: D{tool.diameter_mm:.1f}mm {tool.shape.value}"),
            "G90 G21",
            "G17",
            config.work_offset,
            f"T{config.tool_number} M6",
            f"S{cuts.spindle_rpm:.0f} M3",
            config.coolant_code,
        ]

    def footer(self, config: PostConfig) -> list[str]:
        return ["M9", "M5", "G28 G91 Z0", "M30", "%"]

    def enable_rtcp(self, config: PostConfig) -> list[str]:
        return ["G43.4 H1"]  # Fanuc RTCP

    def disable_rtcp(self, config: PostConfig) -> list[str]:
        return ["G49"]


class _FanucDialect(_Dialect):
    pass


class _GrblDialect(_Dialect):
    def header(self, config: PostConfig, tool: Tool, cuts: CutParams) -> list[str]:
        return [
            self.format_comment(f"Toolpath engine v4 - D{tool.diameter_mm:.1f}mm {tool.shape.value}"),
            "G90 G21",
            f"S{cuts.spindle_rpm:.0f} M3",
            "G4 P2",
        ]

    def footer(self, config: PostConfig) -> list[str]:
        return [f"G0 Z{10.0:.3f}", "M5", "M2"]

    def enable_rtcp(self, config: PostConfig) -> list[str]:
        return []  # GRBL doesn't support RTCP

    def disable_rtcp(self, config: PostConfig) -> list[str]:
        return []


class _SiemensDialect(_Dialect):
    def format_comment(self, text: str) -> str:
        return f"; {text}"

    def header(self, config: PostConfig, tool: Tool, cuts: CutParams) -> list[str]:
        return [
            "; Toolpath engine v4",
            f"; Tool: D{tool.diameter_mm:.1f}mm {tool.shape.value}",
            f"T{config.tool_number} D1",
            "M6",
            "G90 G71",
            "G17",
            "TRANS X0 Y0 Z0",
            f"S{cuts.spindle_rpm:.0f} M3",
            "M8",
        ]

    def footer(self, config: PostConfig) -> list[str]:
        return ["M9", "M5", "G0 Z100", "M30"]

    def enable_rtcp(self, config: PostConfig) -> list[str]:
        return ["TRAORI"]  # Siemens RTCP

    def disable_rtcp(self, config: PostConfig) -> list[str]:
        return ["TRAFOOF"]


class _HeidenhainDialect(_Dialect):
    def format_comment(self, text: str) -> str:
        return f"; {text}"

    def header(self, config: PostConfig, tool: Tool, cuts: CutParams) -> list[str]:
        return [
            "BEGIN PGM TOOLPATH MM",
            f"; Tool: D{tool.diameter_mm:.1f}mm {tool.shape.value}",
            f"TOOL CALL {config.tool_number} Z S{cuts.spindle_rpm:.0f}",
            "M3 M8",
        ]

    def footer(self, config: PostConfig) -> list[str]:
        return ["M9", "M5", "TOOL CALL 0", "END PGM TOOLPATH MM"]

    def enable_rtcp(self, config: PostConfig) -> list[str]:
        return ["FUNCTION TCPM F TCP AXIS POS PATHCTRL AXIS"]  # Heidenhain TCPM

    def disable_rtcp(self, config: PostConfig) -> list[str]:
        return ["FUNCTION RESET TCPM"]


def _get_dialect(dialect: PostDialect) -> _Dialect:
    return {
        PostDialect.FANUC: _FanucDialect(),
        PostDialect.GRBL: _GrblDialect(),
        PostDialect.SIEMENS: _SiemensDialect(),
        PostDialect.HEIDENHAIN: _HeidenhainDialect(),
        PostDialect.GENERIC: _Dialect(),
    }.get(dialect, _Dialect())
