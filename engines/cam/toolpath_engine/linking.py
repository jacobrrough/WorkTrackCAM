"""
Toolpath linking optimizer: reorder chains and minimize rapid travel.

Called after a strategy generates its toolpath chains, this module optimizes
the transitions between chains to reduce total cycle time. Three independent
passes are available and composable:

  1. **Chain reordering** -- nearest-neighbor TSP heuristic (greedy O(N^2))
  2. **Retract-height optimization** -- replace full-safe-Z retracts with
     minimum-clearance retracts using a stock heightfield
  3. **Arc fitting** -- detect circular-arc sequences in linear feed moves
     and replace them with compact arc segments (G2/G3 ready)

A convenience ``simplify_path`` (Douglas-Peucker) is also provided for
removing redundant collinear points from feed moves.

All dimensions in mm.  Angles in degrees where noted.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Sequence

from .models import MotionSegment, ToolpathChain, ToolpathResult
from .geometry import Heightfield


# ---------------------------------------------------------------------------
#  Arc-annotated motion segment
# ---------------------------------------------------------------------------

@dataclass(slots=True)
class ArcSegment:
    """A feed move that represents a circular arc in the XY plane (G17).

    Stored separately from ``MotionSegment`` because that class uses
    ``__slots__`` and cannot be extended at runtime.  The postprocessor
    can inspect ``chain.arc_segments`` (if populated) to emit G2/G3.
    """
    index: int          # index into the parent chain's segment list
    arc_i: float        # arc center offset from start, X component
    arc_j: float        # arc center offset from start, Y component
    radius: float
    clockwise: bool     # True -> G2 (CW), False -> G3 (CCW)


# ---------------------------------------------------------------------------
#  Internal helpers
# ---------------------------------------------------------------------------

def _seg_xyz(seg: MotionSegment) -> tuple[float, float, float]:
    return (seg.x, seg.y, seg.z)


def _dist3(a: tuple[float, float, float],
           b: tuple[float, float, float]) -> float:
    dx = a[0] - b[0]
    dy = a[1] - b[1]
    dz = a[2] - b[2]
    return math.sqrt(dx * dx + dy * dy + dz * dz)


def _dist2(ax: float, ay: float, bx: float, by: float) -> float:
    dx = ax - bx
    dy = ay - by
    return math.sqrt(dx * dx + dy * dy)


def _chain_start(chain: ToolpathChain) -> tuple[float, float, float] | None:
    """Return the XYZ of the first segment, or None for empty chains."""
    if chain.segments:
        s = chain.segments[0]
        return (s.x, s.y, s.z)
    return None


def _chain_end(chain: ToolpathChain) -> tuple[float, float, float] | None:
    """Return the XYZ of the last segment, or None for empty chains."""
    if chain.segments:
        s = chain.segments[-1]
        return (s.x, s.y, s.z)
    return None


def _reverse_chain(chain: ToolpathChain) -> ToolpathChain:
    """Return a new chain with segments in reverse order.

    Feed rates are preserved per-segment.  This is only valid when the
    machining direction is not critical (e.g. non-climb-sensitive passes).
    """
    rev = ToolpathChain(
        segments=list(reversed(chain.segments)),
        comment=chain.comment,
    )
    return rev


# ---------------------------------------------------------------------------
#  1. Chain reordering -- nearest-neighbour TSP heuristic
# ---------------------------------------------------------------------------

def optimize_linking(
    result: ToolpathResult,
    safe_z: float,
    retract_z: float = 0.0,
) -> ToolpathResult:
    """Reorder chains to minimize total rapid travel distance.

    Uses a greedy nearest-neighbour heuristic starting from the machine
    home position ``(0, 0, safe_z)``.  For each unvisited chain the
    algorithm considers both the original and reversed chain orientation
    and picks whichever start point is closer to the current position.

    Parameters
    ----------
    result : ToolpathResult
        The toolpath whose chains will be reordered.  Not mutated.
    safe_z : float
        The safe retract height (mm) used as the starting Z.
    retract_z : float, optional
        Ignored in this implementation but kept for API symmetry with
        other linking strategies.

    Returns
    -------
    ToolpathResult
        A new result with reordered chains.  All metadata fields
        (strategy, warnings, etc.) are copied; distance stats are
        *not* recalculated -- call ``compute_stats`` afterwards.
    """
    chains = result.chains
    n = len(chains)

    # Trivial cases
    if n <= 1:
        return ToolpathResult(
            chains=list(chains),
            strategy=result.strategy,
            warnings=list(result.warnings),
        )

    # Pre-compute start/end of each chain (and its reverse)
    starts: list[tuple[float, float, float] | None] = []
    ends: list[tuple[float, float, float] | None] = []
    rev_starts: list[tuple[float, float, float] | None] = []
    for c in chains:
        starts.append(_chain_start(c))
        ends.append(_chain_end(c))
        rev_starts.append(_chain_end(c))  # reversed chain starts at the end

    # Nearest-neighbour walk
    visited = [False] * n
    order: list[tuple[int, bool]] = []  # (chain_index, reversed?)
    current_pos: tuple[float, float, float] = (0.0, 0.0, safe_z)

    for _ in range(n):
        best_idx = -1
        best_rev = False
        best_dist = math.inf

        for j in range(n):
            if visited[j]:
                continue

            # Forward orientation
            s = starts[j]
            if s is not None:
                d = _dist3(current_pos, s)
                if d < best_dist:
                    best_dist = d
                    best_idx = j
                    best_rev = False

            # Reversed orientation
            rs = rev_starts[j]
            if rs is not None:
                d = _dist3(current_pos, rs)
                if d < best_dist:
                    best_dist = d
                    best_idx = j
                    best_rev = True

        if best_idx < 0:
            # All remaining chains are empty -- just append them
            for j in range(n):
                if not visited[j]:
                    order.append((j, False))
                    visited[j] = True
            break

        visited[best_idx] = True
        order.append((best_idx, best_rev))

        # Advance current_pos to end of chosen chain
        if best_rev:
            # Reversed chain: its "end" is the original start
            ep = starts[best_idx]
        else:
            ep = ends[best_idx]
        if ep is not None:
            current_pos = ep

    # Build output
    reordered: list[ToolpathChain] = []
    for idx, rev in order:
        c = chains[idx]
        reordered.append(_reverse_chain(c) if rev else c)

    return ToolpathResult(
        chains=reordered,
        strategy=result.strategy,
        warnings=list(result.warnings),
    )


# ---------------------------------------------------------------------------
#  2. Retract-height optimisation
# ---------------------------------------------------------------------------

def _max_stock_z_along_line(
    hf: Heightfield,
    x0: float, y0: float,
    x1: float, y1: float,
    num_samples: int = 20,
) -> float:
    """Sample the heightfield along a straight XY line and return the max Z.

    Used to find the tallest stock between two chain endpoints so we
    know the minimum safe retract height for the linking move.
    """
    max_z = -math.inf
    for i in range(num_samples + 1):
        t = i / num_samples
        sx = x0 + (x1 - x0) * t
        sy = y0 + (y1 - y0) * t
        z = hf.sample_z(sx, sy)
        if math.isfinite(z) and z > max_z:
            max_z = z
    return max_z


def optimize_retract_heights(
    result: ToolpathResult,
    stock_heightfield: Heightfield | None = None,
    clearance: float = 2.0,
) -> ToolpathResult:
    """Replace full-safe-Z retracts with minimum-clearance retracts.

    Between consecutive chains the tool must retract, traverse, and
    plunge.  Instead of always going to safe_z, this computes the
    minimum height that clears the stock surface plus a clearance gap.

    If no heightfield is provided, the function uses a conservative
    heuristic: the retract height is set to
    ``max(end_z, start_z) + clearance`` which at least avoids the full
    safe-Z trip when both endpoints are high.

    Parameters
    ----------
    result : ToolpathResult
        Input toolpath (not mutated).
    stock_heightfield : Heightfield or None
        Optional Z-height map of the current stock surface.
    clearance : float
        Minimum gap (mm) above stock or chain endpoints.

    Returns
    -------
    ToolpathResult
        New result with optimized linking rapids inserted between each
        pair of adjacent chains.
    """
    chains = result.chains
    if len(chains) <= 1:
        return ToolpathResult(
            chains=list(chains),
            strategy=result.strategy,
            warnings=list(result.warnings),
        )

    optimized: list[ToolpathChain] = []

    for ci, chain in enumerate(chains):
        if chain.is_empty():
            optimized.append(chain)
            continue

        if ci == 0:
            # First chain: nothing to link from
            optimized.append(chain)
            continue

        prev = chains[ci - 1]
        if prev.is_empty():
            optimized.append(chain)
            continue

        prev_end = prev.segments[-1]
        cur_start = chain.segments[0]

        # Compute minimum retract Z
        retract_z = max(prev_end.z, cur_start.z) + clearance

        if stock_heightfield is not None:
            stock_max = _max_stock_z_along_line(
                stock_heightfield,
                prev_end.x, prev_end.y,
                cur_start.x, cur_start.y,
            )
            if math.isfinite(stock_max):
                retract_z = max(retract_z, stock_max + clearance)

        # Build a linking chain: retract -> traverse -> plunge
        link = ToolpathChain(comment=f"link {ci - 1}->{ci}")
        link.append_rapid(prev_end.x, prev_end.y, retract_z)
        link.append_rapid(cur_start.x, cur_start.y, retract_z)
        link.append_rapid(cur_start.x, cur_start.y, cur_start.z)

        optimized.append(link)
        optimized.append(chain)

    return ToolpathResult(
        chains=optimized,
        strategy=result.strategy,
        warnings=list(result.warnings),
    )


# ---------------------------------------------------------------------------
#  3. Arc fitting (XY-plane, G17)
# ---------------------------------------------------------------------------

def _fit_circle_3pt(
    x1: float, y1: float,
    x2: float, y2: float,
    x3: float, y3: float,
) -> tuple[float, float, float] | None:
    """Fit a circle through three XY points.

    Returns ``(cx, cy, radius)`` or ``None`` if the points are
    (nearly) collinear.
    """
    ax, ay = x1, y1
    bx, by = x2, y2
    cx, cy = x3, y3

    d = 2.0 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
    if abs(d) < 1e-12:
        return None  # collinear

    a2 = ax * ax + ay * ay
    b2 = bx * bx + by * by
    c2 = cx * cx + cy * cy

    ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d
    uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d
    r = math.sqrt((ax - ux) ** 2 + (ay - uy) ** 2)

    return (ux, uy, r)


def _arc_direction_cw(
    x1: float, y1: float,
    x2: float, y2: float,
    x3: float, y3: float,
) -> bool:
    """Determine if the arc from p1 -> p2 -> p3 is clockwise.

    Uses the sign of the cross product of the vectors (p1->p2) and
    (p2->p3).  Negative cross product => CW in standard XY.
    """
    cross = (x2 - x1) * (y3 - y2) - (y2 - y1) * (x3 - x2)
    return cross < 0.0


def _try_fit_arc(
    points: Sequence[tuple[float, float, float]],
    tolerance: float,
) -> tuple[float, float, float, bool] | None:
    """Attempt to fit all *points* onto a single circular arc in XY.

    Uses the first, middle, and last points to define the candidate
    circle, then checks that every intermediate point lies within
    *tolerance* of that circle.

    Returns ``(cx, cy, radius, clockwise)`` on success, or ``None``.
    """
    n = len(points)
    if n < 3:
        return None

    # Pick three reference points
    p0 = points[0]
    pm = points[n // 2]
    pn = points[-1]

    circle = _fit_circle_3pt(p0[0], p0[1], pm[0], pm[1], pn[0], pn[1])
    if circle is None:
        return None

    cx, cy, r = circle

    # Reject degenerate / enormous arcs
    if r < 1e-6 or r > 1e6:
        return None

    # Check all points lie on the circle within tolerance
    for px, py, _pz in points:
        dist_to_center = math.sqrt((px - cx) ** 2 + (py - cy) ** 2)
        if abs(dist_to_center - r) > tolerance:
            return None

    # Verify Z is constant across the arc (XY-plane arcs only)
    z0 = points[0][2]
    for _, _, pz in points[1:]:
        if abs(pz - z0) > tolerance:
            return None

    cw = _arc_direction_cw(p0[0], p0[1], pm[0], pm[1], pn[0], pn[1])
    return (cx, cy, r, cw)


def fit_arcs(
    chains: list[ToolpathChain],
    tolerance: float = 0.01,
) -> list[ToolpathChain]:
    """Identify linear feed-move sequences that approximate circular arcs.

    For each chain, a sliding window scans consecutive feed-rate moves.
    When a window of 3+ moves fits a circle within *tolerance*, the
    window is expanded greedily.  The matched segments are kept as-is
    in the chain (for backward compatibility) but ``ArcSegment``
    annotations are attached to the chain under the ``arc_segments``
    attribute so the postprocessor can emit G2/G3 codes.

    Only XY-plane arcs (G17) at constant Z are detected.

    Parameters
    ----------
    chains : list[ToolpathChain]
        Input chains (not mutated).
    tolerance : float
        Maximum radial deviation (mm) allowed for a point to be
        considered on-arc.

    Returns
    -------
    list[ToolpathChain]
        New chain list with ``arc_segments`` annotations.
    """
    out: list[ToolpathChain] = []

    for chain in chains:
        segs = chain.segments
        n = len(segs)
        new_chain = ToolpathChain(
            segments=list(segs),
            comment=chain.comment,
        )
        arcs: list[ArcSegment] = []

        if n < 3:
            out.append(new_chain)
            continue

        i = 0
        while i < n - 2:
            # Only consider feed moves
            if segs[i].is_rapid or segs[i + 1].is_rapid or segs[i + 2].is_rapid:
                i += 1
                continue

            # Collect points for a candidate arc window starting at i
            window_start = i
            window_end = i + 2  # inclusive

            pts: list[tuple[float, float, float]] = [
                _seg_xyz(segs[j]) for j in range(window_start, window_end + 1)
            ]

            arc = _try_fit_arc(pts, tolerance)
            if arc is None:
                i += 1
                continue

            # Greedily expand the window
            while window_end + 1 < n and not segs[window_end + 1].is_rapid:
                candidate = pts + [_seg_xyz(segs[window_end + 1])]
                expanded = _try_fit_arc(candidate, tolerance)
                if expanded is None:
                    break
                window_end += 1
                pts = candidate
                arc = expanded

            cx, cy, r, cw = arc
            end_seg = segs[window_end]

            # The arc center offset is relative to the start point
            start_seg = segs[window_start]
            arc_i = cx - start_seg.x
            arc_j = cy - start_seg.y

            arcs.append(ArcSegment(
                index=window_end,
                arc_i=arc_i,
                arc_j=arc_j,
                radius=r,
                clockwise=cw,
            ))

            i = window_end + 1

        # Attach annotations -- use a plain attribute since ToolpathChain
        # is a regular dataclass (no __slots__).
        new_chain.arc_segments = arcs  # type: ignore[attr-defined]
        out.append(new_chain)

    return out


# ---------------------------------------------------------------------------
#  4. Douglas-Peucker path simplification
# ---------------------------------------------------------------------------

def _perpendicular_distance(
    px: float, py: float, pz: float,
    ax: float, ay: float, az: float,
    bx: float, by: float, bz: float,
) -> float:
    """Compute the perpendicular distance from point P to line segment AB
    in 3D space."""
    abx = bx - ax
    aby = by - ay
    abz = bz - az
    ab_len_sq = abx * abx + aby * aby + abz * abz

    if ab_len_sq < 1e-24:
        # A and B are the same point
        dx = px - ax
        dy = py - ay
        dz = pz - az
        return math.sqrt(dx * dx + dy * dy + dz * dz)

    # Project P onto AB
    t = ((px - ax) * abx + (py - ay) * aby + (pz - az) * abz) / ab_len_sq
    t = max(0.0, min(1.0, t))

    # Closest point on AB
    cx = ax + t * abx
    cy = ay + t * aby
    cz = az + t * abz

    dx = px - cx
    dy = py - cy
    dz = pz - cz
    return math.sqrt(dx * dx + dy * dy + dz * dz)


def _douglas_peucker(
    points: list[tuple[float, float, float, float]],
    tolerance: float,
    start: int,
    end: int,
    keep: list[bool],
) -> None:
    """Recursive Douglas-Peucker simplification.

    ``points`` is a list of ``(x, y, z, feed)`` tuples.
    ``keep[i]`` is set to True for points that survive simplification.
    """
    if end - start < 2:
        return

    ax, ay, az, _ = points[start]
    bx, by, bz, _ = points[end]

    max_dist = 0.0
    max_idx = start

    for i in range(start + 1, end):
        px, py, pz, _ = points[i]
        d = _perpendicular_distance(px, py, pz, ax, ay, az, bx, by, bz)
        if d > max_dist:
            max_dist = d
            max_idx = i

    if max_dist > tolerance:
        keep[max_idx] = True
        _douglas_peucker(points, tolerance, start, max_idx, keep)
        _douglas_peucker(points, tolerance, max_idx, end, keep)


def simplify_path(
    chain: ToolpathChain,
    tolerance: float = 0.01,
) -> ToolpathChain:
    """Remove redundant collinear points from feed moves using
    Douglas-Peucker simplification.

    Rapid moves are never simplified -- they pass through unchanged.
    The first and last points of any feed-move run are always kept.

    Parameters
    ----------
    chain : ToolpathChain
        Input chain (not mutated).
    tolerance : float
        Maximum allowed deviation (mm) from the simplified path.

    Returns
    -------
    ToolpathChain
        Simplified chain.
    """
    segs = chain.segments
    if len(segs) <= 2:
        return ToolpathChain(segments=list(segs), comment=chain.comment)

    # Split into runs of feed moves separated by rapids
    result_segs: list[MotionSegment] = []
    i = 0
    n = len(segs)

    while i < n:
        if segs[i].is_rapid:
            result_segs.append(segs[i])
            i += 1
            continue

        # Collect consecutive feed moves
        run_start = i
        while i < n and not segs[i].is_rapid:
            i += 1
        run_end = i  # exclusive

        run = segs[run_start:run_end]
        if len(run) <= 2:
            result_segs.extend(run)
            continue

        # Build points for Douglas-Peucker
        pts = [(s.x, s.y, s.z, s.feed) for s in run]
        keep = [False] * len(pts)
        keep[0] = True
        keep[-1] = True
        _douglas_peucker(pts, tolerance, 0, len(pts) - 1, keep)

        for j, should_keep in enumerate(keep):
            if should_keep:
                result_segs.append(run[j])

    return ToolpathChain(segments=result_segs, comment=chain.comment)


def simplify_chains(
    chains: list[ToolpathChain],
    tolerance: float = 0.01,
) -> list[ToolpathChain]:
    """Apply Douglas-Peucker simplification to every chain in a list.

    Parameters
    ----------
    chains : list[ToolpathChain]
        Input chains (not mutated).
    tolerance : float
        Maximum allowed deviation (mm).

    Returns
    -------
    list[ToolpathChain]
        Simplified chains.
    """
    return [simplify_path(c, tolerance) for c in chains]


# ---------------------------------------------------------------------------
#  Combined optimisation pipeline
# ---------------------------------------------------------------------------

def optimize_full(
    result: ToolpathResult,
    safe_z: float,
    stock_heightfield: Heightfield | None = None,
    clearance: float = 2.0,
    arc_tolerance: float = 0.01,
    simplify_tolerance: float = 0.005,
    enable_reorder: bool = True,
    enable_retract_opt: bool = True,
    enable_arc_fit: bool = True,
    enable_simplify: bool = True,
) -> ToolpathResult:
    """Run the full linking optimisation pipeline.

    Applies each enabled pass in sequence:

    1. Path simplification (Douglas-Peucker)
    2. Arc fitting
    3. Chain reordering (TSP nearest-neighbour)
    4. Retract-height optimisation

    Parameters
    ----------
    result : ToolpathResult
        Input toolpath from any strategy.
    safe_z : float
        Machine safe-Z height (mm).
    stock_heightfield : Heightfield or None
        Optional stock surface for retract optimisation.
    clearance : float
        Clearance gap above stock for retract moves.
    arc_tolerance : float
        Tolerance for arc fitting.
    simplify_tolerance : float
        Tolerance for Douglas-Peucker simplification.
    enable_reorder : bool
        Enable chain reordering.
    enable_retract_opt : bool
        Enable retract height optimisation.
    enable_arc_fit : bool
        Enable arc fitting.
    enable_simplify : bool
        Enable path simplification.

    Returns
    -------
    ToolpathResult
        Optimised toolpath.  Call ``compute_stats`` to refresh distance
        and time estimates.
    """
    current = result

    # 1. Simplify paths first -- reduces point count for later passes
    if enable_simplify and current.chains:
        current = ToolpathResult(
            chains=simplify_chains(current.chains, simplify_tolerance),
            strategy=current.strategy,
            warnings=list(current.warnings),
        )

    # 2. Arc fitting -- detect arcs in simplified feed moves
    if enable_arc_fit and current.chains:
        current = ToolpathResult(
            chains=fit_arcs(current.chains, arc_tolerance),
            strategy=current.strategy,
            warnings=list(current.warnings),
        )

    # 3. Reorder chains to minimise rapid travel
    if enable_reorder:
        current = optimize_linking(current, safe_z)

    # 4. Optimise retract heights between chains
    if enable_retract_opt:
        current = optimize_retract_heights(
            current,
            stock_heightfield=stock_heightfield,
            clearance=clearance,
        )

    return current
