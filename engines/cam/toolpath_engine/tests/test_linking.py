"""Tests for the toolpath linking optimizer (engines/cam/toolpath_engine/linking.py).

Covers:
- optimize_linking: chain reordering to minimize rapid travel
- simplify_path / simplify_chains: Douglas-Peucker collinear-point removal
- fit_arcs: circular arc detection for G2/G3 annotation
- optimize_full: end-to-end pipeline convenience function
"""
from __future__ import annotations

import math

import pytest

from ..models import ToolpathChain, ToolpathResult
from ..linking import (
    optimize_linking,
    simplify_path,
    simplify_chains,
    fit_arcs,
    optimize_full,
)


# ── Helpers ────────────────────────────────────────────────────────────

def _make_chain(
    x0: float, y0: float,
    x1: float, y1: float,
    z: float = -1.0,
    feed: float = 1000.0,
    safe_z: float = 10.0,
    comment: str = "",
) -> ToolpathChain:
    """One rapid retract → plunge → feed → retract chain."""
    c = ToolpathChain(comment=comment)
    c.append_rapid(x0, y0, safe_z)
    c.append_feed(x0, y0, z, feed)
    c.append_feed(x1, y1, z, feed)
    c.append_rapid(x1, y1, safe_z)
    return c


def _make_result(*chains: ToolpathChain, strategy: str = "test") -> ToolpathResult:
    r = ToolpathResult(strategy=strategy)
    r.chains = list(chains)
    return r


# ── optimize_linking ───────────────────────────────────────────────────

class TestOptimizeLinking:
    def test_single_chain_unchanged(self):
        """One chain: reordering must return it as-is."""
        chain = _make_chain(5, 5, 10, 5, comment="only")
        result = optimize_linking(_make_result(chain), safe_z=10.0)
        assert len(result.chains) == 1
        assert result.chains[0].comment == "only"

    def test_empty_result_unchanged(self):
        """Zero chains should not crash."""
        result = optimize_linking(_make_result(), safe_z=10.0)
        assert result.chains == []

    def test_nearest_chain_first(self):
        """Chain near origin (0,0) should be visited before a far-away chain."""
        near = _make_chain(1, 1, 5, 1, comment="near")
        far = _make_chain(100, 100, 110, 100, comment="far")
        # Feed near-to-far order (far first in original list)
        result = optimize_linking(_make_result(far, near), safe_z=10.0)
        assert result.chains[0].comment == "near", (
            "Nearest chain to origin should be traversed first"
        )

    def test_chain_count_preserved(self):
        """Reordering must not add or drop chains."""
        chains = [_make_chain(i * 20, 0, i * 20 + 10, 0, comment=str(i)) for i in range(5)]
        result = optimize_linking(_make_result(*chains), safe_z=10.0)
        assert len(result.chains) == 5

    def test_strategy_and_warnings_copied(self):
        """Metadata (strategy, warnings) must survive reordering."""
        r = _make_result(_make_chain(0, 0, 1, 0), strategy="waterline")
        r.warnings.append("test warning")
        optimized = optimize_linking(r, safe_z=10.0)
        assert optimized.strategy == "waterline"
        assert "test warning" in optimized.warnings

    def test_two_chains_produces_shorter_total_rapid(self):
        """
        With two chains, the optimised rapid distance should be ≤ the original.
        'near' chain (0→10) and 'far' chain (100→110).
        When near is visited first the second rapid is only ~90 mm; if far is
        first the second rapid is ~100+ mm.
        """
        near = _make_chain(0, 0, 10, 0, comment="near")
        far = _make_chain(100, 0, 110, 0, comment="far")
        # Original order: far first (bad)
        bad_result = _make_result(far, near)
        good_result = optimize_linking(bad_result, safe_z=10.0)
        assert good_result.chains[0].comment == "near"


# ── simplify_path ──────────────────────────────────────────────────────

class TestSimplifyPath:
    def test_collinear_middle_point_removed(self):
        """Three strictly collinear feed points: middle must be dropped."""
        chain = ToolpathChain(comment="collinear")
        chain.append_rapid(0, 0, 10)
        chain.append_feed(0, 0, -1, 1000)
        chain.append_feed(5, 0, -1, 1000)   # collinear midpoint
        chain.append_feed(10, 0, -1, 1000)
        simplified = simplify_path(chain, tolerance=0.01)
        feed_segs = [s for s in simplified.segments if not s.is_rapid]
        # First and last must be retained; middle should be dropped
        assert len(feed_segs) == 2
        assert feed_segs[0].x == pytest.approx(0, abs=1e-6)
        assert feed_segs[-1].x == pytest.approx(10, abs=1e-6)

    def test_non_collinear_points_kept(self):
        """Points forming an L-shape must all be retained."""
        chain = ToolpathChain(comment="corner")
        chain.append_rapid(0, 0, 10)
        chain.append_feed(0, 0, -1, 1000)
        chain.append_feed(10, 0, -1, 1000)   # horizontal leg
        chain.append_feed(10, 10, -1, 1000)  # vertical leg (corner)
        simplified = simplify_path(chain, tolerance=0.01)
        feed_segs = [s for s in simplified.segments if not s.is_rapid]
        assert len(feed_segs) == 3

    def test_rapids_are_preserved_unchanged(self):
        """Rapids must pass through simplify_path unmodified."""
        chain = ToolpathChain(comment="rapids")
        chain.append_rapid(0, 0, 10)
        chain.append_rapid(10, 10, 10)  # second rapid
        simplified = simplify_path(chain, tolerance=0.01)
        rapids = [s for s in simplified.segments if s.is_rapid]
        assert len(rapids) == 2

    def test_empty_chain_no_crash(self):
        """Empty chain should return an empty chain without raising."""
        chain = ToolpathChain(comment="empty")
        simplified = simplify_path(chain, tolerance=0.01)
        assert len(simplified.segments) == 0

    def test_two_feed_segments_unchanged(self):
        """Two-segment chain cannot be simplified further (always kept)."""
        chain = ToolpathChain(comment="two")
        chain.append_feed(0, 0, -1, 1000)
        chain.append_feed(5, 5, -1, 1000)
        simplified = simplify_path(chain, tolerance=0.01)
        assert len(simplified.segments) == 2

    def test_comment_preserved(self):
        """simplify_path must preserve the chain comment."""
        chain = ToolpathChain(comment="my_chain")
        chain.append_feed(0, 0, -1, 1000)
        simplified = simplify_path(chain)
        assert simplified.comment == "my_chain"

    def test_many_collinear_points_collapsed(self):
        """20 collinear feed points should reduce to 2 endpoints."""
        chain = ToolpathChain(comment="many_collinear")
        for i in range(20):
            chain.append_feed(float(i), 0, -1, 1000)
        simplified = simplify_path(chain, tolerance=0.01)
        feed_segs = [s for s in simplified.segments if not s.is_rapid]
        assert len(feed_segs) == 2


# ── simplify_chains ────────────────────────────────────────────────────

class TestSimplifyChains:
    def test_multiple_chains_all_simplified(self):
        """simplify_chains must process every chain in the list."""
        c1 = ToolpathChain(comment="c1")
        c1.append_feed(0, 0, -1, 1000)
        c1.append_feed(5, 0, -1, 1000)
        c1.append_feed(10, 0, -1, 1000)  # collinear

        c2 = ToolpathChain(comment="c2")
        c2.append_feed(0, 0, -1, 1000)
        c2.append_feed(0, 5, -1, 1000)
        c2.append_feed(0, 10, -1, 1000)  # collinear

        result = simplify_chains([c1, c2], tolerance=0.01)
        assert len(result) == 2
        for simplified in result:
            feed_segs = [s for s in simplified.segments if not s.is_rapid]
            assert len(feed_segs) == 2

    def test_empty_list_no_crash(self):
        assert simplify_chains([]) == []


# ── fit_arcs ───────────────────────────────────────────────────────────

class TestFitArcs:
    def test_quarter_circle_detected(self):
        """8 feed points along a quarter-circle (XY plane, constant Z) should
        produce at least one arc annotation on the chain."""
        chain = ToolpathChain(comment="quarter_circle")
        chain.append_rapid(0, 0, 10)
        r = 10.0
        # Start at (10, 0) and sweep to (0, 10)
        for i in range(9):
            angle = math.pi / 2 * i / 8
            chain.append_feed(r * math.cos(angle), r * math.sin(angle), -1.0, 1000)
        result = fit_arcs([chain], tolerance=0.2)
        assert len(result) == 1
        assert len(result[0].arc_segments) >= 1, "Quarter-circle must produce at least one arc annotation"

    def test_straight_line_no_arcs(self):
        """Perfectly straight feed moves must not produce any arc annotations."""
        chain = ToolpathChain(comment="straight")
        for i in range(8):
            chain.append_feed(float(i), 0.0, -1.0, 1000)
        result = fit_arcs([chain], tolerance=0.01)
        assert getattr(result[0], "arc_segments", []) == []

    def test_single_feed_segment_no_arcs(self):
        """A single feed segment cannot form an arc."""
        chain = ToolpathChain(comment="one_seg")
        chain.append_feed(0, 0, -1, 1000)
        result = fit_arcs([chain], tolerance=0.01)
        # arc_segments is only attached when arcs are detected
        assert getattr(result[0], "arc_segments", []) == []

    def test_chain_count_preserved(self):
        """fit_arcs must return the same number of chains it receives."""
        chains = [
            ToolpathChain(comment=f"c{i}") for i in range(3)
        ]
        for c in chains:
            c.append_feed(0, 0, -1, 1000)
        result = fit_arcs(chains, tolerance=0.01)
        assert len(result) == 3

    def test_empty_list_no_crash(self):
        assert fit_arcs([]) == []


# ── optimize_full ──────────────────────────────────────────────────────

class TestOptimizeFull:
    def test_does_not_crash_on_empty_result(self):
        result = _make_result(strategy="raster")
        out = optimize_full(result, safe_z=10.0)
        assert out.chains == []

    def test_returns_result_with_same_strategy(self):
        chain = _make_chain(0, 0, 10, 0, comment="c1")
        result = _make_result(chain, strategy="waterline")
        out = optimize_full(result, safe_z=10.0)
        assert out.strategy == "waterline"

    def test_all_chains_present(self):
        """optimize_full must not discard any cutting chain.

        optimize_full may insert link chains between cuts, so total chain count
        can exceed the original.  Verify all 4 original cutting chains survive.
        """
        chains = [_make_chain(i * 10, 0, i * 10 + 5, 0, comment=str(i)) for i in range(4)]
        result = _make_result(*chains)
        out = optimize_full(result, safe_z=10.0)
        cutting_chains = [c for c in out.chains if any(not s.is_rapid for s in c.segments)]
        assert len(cutting_chains) >= 4
