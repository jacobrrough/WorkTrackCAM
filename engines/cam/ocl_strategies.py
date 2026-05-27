"""Pure-Python OpenCAMLib strategy core, shared by the legacy subprocess
(``engines/cam/ocl_toolpath.py``) and the long-term sidecar handler
(``engines/sidecar/cam_handlers.py``).

Why a shared module?
====================
The legacy subprocess `ocl_toolpath.py` is the only working CAM toolpath
engine in the repo after the 2026-05-27 foundation pivot. The sidecar
needs the *same* OCL invocations to produce the *same* G-code line output,
so a regression-free migration MUST reuse the proven numerics rather than
re-implement them.

Contract for every ``run_*`` function in this module
====================================================
- Input: a path to an STL on disk + validated numeric params + the imported
  ``ocl`` module. The caller is responsible for installing/importing OCL
  and for validating numeric params (positive feeds, finite safeZ, etc.).
- Output: ``list[str]`` of G-code lines (``"G0 Z..."`` / ``"G1 X.. Y.. Z.."``
  / ``"; comment"``). Each line is plain ASCII, no trailing newline.
- Side effects: none. No disk writes, no environment changes, no stdout.
- Errors: any OCL runtime issue is allowed to propagate. The caller decides
  how to surface it (subprocess exit code vs. sidecar error envelope).

Safety Rule 1 — G-code is sacred
================================
Every line emitted goes straight into the downstream Handlebars post
templates and from there onto a real machine (Laguna Swift, Makera Carvera,
or the K2 Plus controller). Coordinates MUST be:
  * finite (no NaN / Inf)
  * formatted with 3 decimal places (machine controllers expect a stable
    precision; trailing-digit drift confuses arc-fitting in some posts)
  * feeds MUST appear on plunge / cutting moves (controllers without a
    persisted F default to 0 and crash)
  * comments are prefixed with ``;`` so generic_mm-style posts treat them
    as machine-passthrough metadata, not commands.
"""
from __future__ import annotations

import math
from pathlib import Path
from typing import Any


# ── Cutter constructors ──────────────────────────────────────────────────


def build_cutter(ocl: Any, tool_diameter_mm: float, cutter_kind: str = "cyl") -> Any:
    """Build an OCL cutter for the given diameter.

    ``cutter_kind`` selects the cutter shape:
      * ``"cyl"`` — flat-end mill (CylCutter) — best for waterline / raster
      * ``"ball"`` — ball-end mill (BallCutter) — best for 3D finish surface scan

    Length scales mildly with diameter to give OCL enough flute travel for
    deep features without overflowing internal arrays.
    """
    d = max(0.1, float(tool_diameter_mm))
    length = max(20.0, d * 4.0)
    if cutter_kind == "ball":
        return ocl.BallCutter(d, length)
    return ocl.CylCutter(d, length)


# ── STL loader ───────────────────────────────────────────────────────────


def load_stl(ocl: Any, stl_path: Path) -> Any:
    """Build an OCL ``STLSurf`` from a binary/ASCII STL file on disk."""
    surf = ocl.STLSurf()
    ocl.STLReader(str(stl_path), surf)
    return surf


# ── G-code emitters (shared between strategies) ──────────────────────────


def loops_to_lines(
    loops: Any,
    *,
    safe_z: float,
    feed: float,
    plunge: float,
) -> list[str]:
    """Turn OCL loop point lists into G0/G1 strings (mm, three decimals).

    Each loop becomes: lift to safeZ, rapid to first point XY, plunge to
    first Z at plunge feed, then G1 around the loop at cutting feed.
    """
    lines: list[str] = []
    for loop in loops:
        if not loop:
            continue
        n = len(loop)
        first = loop[0]
        lines.append(f"G0 Z{safe_z:.3f}")
        lines.append(f"G0 X{first.x:.3f} Y{first.y:.3f}")
        lines.append(f"G1 Z{first.z:.3f} F{plunge:.0f}")
        for i in range(1, n):
            p = loop[i]
            lines.append(f"G1 X{p.x:.3f} Y{p.y:.3f} Z{p.z:.3f} F{feed:.0f}")
    return lines


def clpoints_to_polyline(
    pts: Any,
    *,
    safe_z: float,
    feed: float,
    plunge: float,
) -> list[str]:
    """Convert an OCL CL-point list to a single G0/G1 polyline.

    The first point uses a safe-Z rapid + plunge; subsequent points are
    cutting moves at the cutting feed. Returns an empty list for empty /
    unsized inputs.
    """
    lines: list[str] = []
    if not pts:
        return lines
    try:
        n = len(pts)
    except TypeError:
        return lines
    for i in range(n):
        p = pts[i]
        x, y, z = float(p.x), float(p.y), float(p.z)
        if i == 0:
            lines.append(f"G0 Z{safe_z:.3f}")
            lines.append(f"G0 X{x:.3f} Y{y:.3f}")
            lines.append(f"G1 Z{z:.3f} F{plunge:.0f}")
        else:
            lines.append(f"G1 X{x:.3f} Y{y:.3f} Z{z:.3f} F{feed:.0f}")
    return lines


# ── Path helpers ─────────────────────────────────────────────────────────


def append_xy_line(path: Any, ocl: Any, xa: float, ya: float, xb: float, yb: float) -> None:
    """Append one horizontal scan span to an OCL ``Path``.

    OCL's ``Path`` exposes either ``append`` (newer builds) or ``addLine``
    (older builds); we accept both to stay portable across pip wheels.
    """
    p1 = ocl.Point(float(xa), float(ya), 0.0)
    p2 = ocl.Point(float(xb), float(yb), 0.0)
    ln = ocl.Line(p1, p2)
    if hasattr(path, "append"):
        path.append(ln)
    elif hasattr(path, "addLine"):
        path.addLine(ln)
    else:
        raise RuntimeError("ocl_path_has_no_append_or_addLine")


def make_waterline(ocl: Any, strategy: str) -> tuple[Any, str]:
    """Instantiate Waterline or AdaptiveWaterline per strategy.

    Returns ``(waterline_object, description_tag)`` for comment lines.
    If AdaptiveWaterline is missing in this OCL build, falls back to
    Waterline and notes that in the tag.
    """
    if strategy == "adaptive_waterline":
        try:
            return ocl.AdaptiveWaterline(), "adaptive waterline"
        except AttributeError:
            return ocl.Waterline(), "waterline (AdaptiveWaterline unavailable in this ocl build)"
    return ocl.Waterline(), "waterline"


# ── Strategy runners ─────────────────────────────────────────────────────


def run_raster_pathdrop(
    ocl: Any,
    stl: Any,
    *,
    stepover_mm: float,
    sampling_mm: float,
    tool_diameter_mm: float,
    safe_z_mm: float,
    feed_mm_min: float,
    plunge_mm_min: float,
    cutter_kind: str = "cyl",
) -> list[str]:
    """XY zigzag raster via OCL PathDropCutter.

    Scans Y from minY to maxY in ``stepover_mm`` increments, alternating
    X direction each row (zigzag) to minimise non-cutting moves. PathDrop
    pulls the cutter UP onto the surface (``setZ`` is a floor 100 mm below
    the model), so the resulting Z values follow the mesh height field.

    Used by both the ``raster`` and ``surface_scan`` (3D finish) strategies;
    cutter shape differs (``"cyl"`` vs. ``"ball"``).
    """
    bounds = stl.getBounds()
    minx, maxx, miny, maxy, minz, _maxz = (
        float(bounds[0]),
        float(bounds[1]),
        float(bounds[2]),
        float(bounds[3]),
        float(bounds[4]),
        float(bounds[5]),
    )
    step = max(0.05, float(stepover_mm))
    sampling = max(0.05, min(float(sampling_mm), 5.0))
    cutter = build_cutter(ocl, tool_diameter_mm, cutter_kind=cutter_kind)
    z_floor = float(minz) - 100.0

    pdc = ocl.PathDropCutter()
    pdc.setSTL(stl)
    pdc.setCutter(cutter)
    pdc.setSampling(sampling)
    pdc.setZ(z_floor)

    all_lines: list[str] = []
    y = miny
    flip = False
    while y <= maxy + 1e-6:
        xa, xb = (minx, maxx) if not flip else (maxx, minx)
        path = ocl.Path()
        append_xy_line(path, ocl, xa, y, xb, y)
        pdc.setPath(path)
        pdc.run()
        pts = pdc.getCLPoints()
        all_lines.append(f"; OCL PathDropCutter {cutter_kind} raster Y={y:.3f}")
        all_lines.extend(
            clpoints_to_polyline(
                pts, safe_z=safe_z_mm, feed=feed_mm_min, plunge=plunge_mm_min
            )
        )
        flip = not flip
        y += step

    return all_lines


def run_waterline_levels(
    ocl: Any,
    stl: Any,
    *,
    strategy: str,
    z_pass_mm: float,
    stepover_mm: float,
    tool_diameter_mm: float,
    safe_z_mm: float,
    feed_mm_min: float,
    plunge_mm_min: float,
) -> list[str]:
    """Slice the STL between bounds with repeated waterline passes at decreasing Z."""
    bounds = stl.getBounds()
    _minx, _maxx, _miny, _maxy, minz, maxz = (
        float(bounds[0]),
        float(bounds[1]),
        float(bounds[2]),
        float(bounds[3]),
        float(bounds[4]),
        float(bounds[5]),
    )
    step = max(0.05, abs(float(z_pass_mm)))
    sampling = max(0.05, min(float(stepover_mm), 5.0))
    cutter = build_cutter(ocl, tool_diameter_mm, cutter_kind="cyl")
    z_floor = minz + tool_diameter_mm * 0.25
    z = maxz - 0.001

    all_lines: list[str] = []
    while z >= z_floor - 1e-6:
        wl, tag = make_waterline(ocl, strategy)
        wl.setSTL(stl)
        wl.setCutter(cutter)
        wl.setSampling(sampling)
        if strategy == "adaptive_waterline" and "adaptive waterline" in tag:
            wl.setMinSampling(max(0.02, sampling * 0.25))
            wl.setCosLimit(0.65)
        wl.setZ(z)
        wl.run()
        loops = wl.getLoops()
        all_lines.append(f"; OCL {tag} Z={z:.3f}")
        all_lines.extend(
            loops_to_lines(loops, safe_z=safe_z_mm, feed=feed_mm_min, plunge=plunge_mm_min)
        )
        z -= step
        if not math.isfinite(z):
            break

    return all_lines


# ── Top-level dispatch ───────────────────────────────────────────────────

#: Strategies the shared runner can dispatch. Kept in sync with
#: ``src/shared/sidecar-protocol.ts``'s ``CamStrategy`` union AND
#: ``ocl_toolpath.py``'s ALLOWED_STRATEGIES.
STRATEGY_NAMES = frozenset(
    {"waterline", "adaptive_waterline", "raster", "surface_scan"}
)


def dispatch_strategy(
    ocl: Any,
    stl: Any,
    *,
    strategy: str,
    z_pass_mm: float,
    stepover_mm: float,
    tool_diameter_mm: float,
    safe_z_mm: float,
    feed_mm_min: float,
    plunge_mm_min: float,
) -> list[str]:
    """Dispatch ``strategy`` to the appropriate OCL runner.

    Raises ``ValueError`` if ``strategy`` is unknown — keep this in lock-step
    with ``STRATEGY_NAMES``.
    """
    if strategy in ("waterline", "adaptive_waterline"):
        return run_waterline_levels(
            ocl,
            stl,
            strategy=strategy,
            z_pass_mm=z_pass_mm,
            stepover_mm=stepover_mm,
            tool_diameter_mm=tool_diameter_mm,
            safe_z_mm=safe_z_mm,
            feed_mm_min=feed_mm_min,
            plunge_mm_min=plunge_mm_min,
        )
    if strategy == "raster":
        return run_raster_pathdrop(
            ocl,
            stl,
            stepover_mm=stepover_mm,
            sampling_mm=stepover_mm,
            tool_diameter_mm=tool_diameter_mm,
            safe_z_mm=safe_z_mm,
            feed_mm_min=feed_mm_min,
            plunge_mm_min=plunge_mm_min,
            cutter_kind="cyl",
        )
    if strategy == "surface_scan":
        # 3D finish: smaller sampling than stepover for finer surface
        # following (controlled scallop height), ball-end mill for clean
        # cusps between rows.
        sampling = max(0.05, min(stepover_mm * 0.5, 1.0))
        return run_raster_pathdrop(
            ocl,
            stl,
            stepover_mm=stepover_mm,
            sampling_mm=sampling,
            tool_diameter_mm=tool_diameter_mm,
            safe_z_mm=safe_z_mm,
            feed_mm_min=feed_mm_min,
            plunge_mm_min=plunge_mm_min,
            cutter_kind="ball",
        )
    raise ValueError(f"unknown strategy: {strategy!r}")
