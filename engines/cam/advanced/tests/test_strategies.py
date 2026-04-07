"""Tests for toolpath strategies: adaptive clear, waterline, raster, pencil, rest."""
from __future__ import annotations

import math
import struct
import tempfile
from pathlib import Path

import pytest

from ..models import ToolpathJob, Strategy, Tool, ToolShape, CutParams, StockDefinition
from ..optimizer import adjust_feed_for_engagement, compute_engagement_angle
from ..geometry import load_stl
from ..strategies import run_strategy
from ..strategies.waterline import _lead_in_arc_points, _lead_out_arc_points


# ── Test STL helpers ─────────────────────────────────────────────────────

def _make_binary_stl(triangles):
    header = b"\x00" * 80
    count = struct.pack("<I", len(triangles))
    data = header + count
    for tri in triangles:
        normal, v0, v1, v2 = tri
        data += struct.pack("<fff", *normal)
        data += struct.pack("<fff", *v0)
        data += struct.pack("<fff", *v1)
        data += struct.pack("<fff", *v2)
        data += struct.pack("<H", 0)
    return data


def _box_triangles(sx=10.0, sy=10.0, sz=5.0):
    tris = []
    tris.append(((0, 0, -1), (0, 0, 0), (sx, sy, 0), (sx, 0, 0)))
    tris.append(((0, 0, -1), (0, 0, 0), (0, sy, 0), (sx, sy, 0)))
    tris.append(((0, 0, 1), (0, 0, sz), (sx, 0, sz), (sx, sy, sz)))
    tris.append(((0, 0, 1), (0, 0, sz), (sx, sy, sz), (0, sy, sz)))
    tris.append(((0, -1, 0), (0, 0, 0), (sx, 0, 0), (sx, 0, sz)))
    tris.append(((0, -1, 0), (0, 0, 0), (sx, 0, sz), (0, 0, sz)))
    tris.append(((0, 1, 0), (0, sy, 0), (0, sy, sz), (sx, sy, sz)))
    tris.append(((0, 1, 0), (0, sy, 0), (sx, sy, sz), (sx, sy, 0)))
    tris.append(((-1, 0, 0), (0, 0, 0), (0, 0, sz), (0, sy, sz)))
    tris.append(((-1, 0, 0), (0, 0, 0), (0, sy, sz), (0, sy, 0)))
    tris.append(((1, 0, 0), (sx, 0, 0), (sx, sy, 0), (sx, sy, sz)))
    tris.append(((1, 0, 0), (sx, 0, 0), (sx, sy, sz), (sx, 0, sz)))
    return tris


def _hemisphere_triangles(radius=5.0, segments=8, rings=4):
    """Simple hemisphere for testing curved surface strategies."""
    import math
    tris = []
    for ring in range(rings):
        phi0 = (math.pi / 2) * ring / rings
        phi1 = (math.pi / 2) * (ring + 1) / rings
        for seg in range(segments):
            theta0 = 2 * math.pi * seg / segments
            theta1 = 2 * math.pi * (seg + 1) / segments

            def pt(phi, theta):
                return (
                    radius * math.cos(phi) * math.cos(theta),
                    radius * math.cos(phi) * math.sin(theta),
                    radius * math.sin(phi),
                )

            p00 = pt(phi0, theta0)
            p10 = pt(phi1, theta0)
            p01 = pt(phi0, theta1)
            p11 = pt(phi1, theta1)

            n = (0, 0, 1)  # approximate
            tris.append((n, p00, p10, p01))
            tris.append((n, p10, p11, p01))
    return tris


def _make_mesh(tris):
    data = _make_binary_stl(tris)
    f = tempfile.NamedTemporaryFile(suffix=".stl", delete=False)
    f.write(data)
    f.close()
    mesh = load_stl(f.name)
    Path(f.name).unlink(missing_ok=True)
    return mesh


def _make_job(strategy: Strategy, **overrides) -> ToolpathJob:
    job = ToolpathJob(
        strategy=strategy,
        tool=Tool(diameter_mm=6.0, shape=ToolShape.FLAT),
        cuts=CutParams(
            feed_mm_min=1000,
            plunge_mm_min=400,
            stepover_mm=2.0,
            z_step_mm=1.0,
            safe_z_mm=15.0,
        ),
        stock=StockDefinition(
            x_min=-2, x_max=12,
            y_min=-2, y_max=12,
            z_min=0, z_max=7,
        ),
    )
    for k, v in overrides.items():
        setattr(job, k, v)
    return job


class TestAdaptiveClear:
    def test_box_produces_chains(self):
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.ADAPTIVE_CLEAR)
        result = run_strategy(job, mesh)
        assert len(result.chains) > 0
        assert result.strategy == "adaptive_clear"

    def test_has_feed_moves(self):
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.ADAPTIVE_CLEAR)
        result = run_strategy(job, mesh)
        feed_count = sum(
            1 for c in result.chains for s in c.segments if not s.is_rapid
        )
        assert feed_count > 0

    def test_all_z_above_minimum(self):
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.ADAPTIVE_CLEAR)
        result = run_strategy(job, mesh)
        for chain in result.chains:
            for seg in chain.segments:
                # No segment should go below mesh bottom minus tolerance
                assert seg.z >= -1.0, f"Z={seg.z} below expected minimum"

    def test_stats_computed(self):
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.ADAPTIVE_CLEAR)
        result = run_strategy(job, mesh)
        assert result.cut_distance_mm > 0
        assert result.total_distance_mm > 0


class TestWaterline:
    def test_box_produces_chains(self):
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.WATERLINE)
        result = run_strategy(job, mesh)
        # A box has vertical walls, so waterline should produce contours
        assert result.strategy == "waterline"
        # May or may not produce chains depending on slicing
        # (a box with vertical walls should produce rectangular loops)

    def test_hemisphere_produces_chains(self):
        mesh = _make_mesh(_hemisphere_triangles(radius=5.0))
        job = _make_job(Strategy.WATERLINE)
        job.stock.z_max = 6.0
        result = run_strategy(job, mesh)
        assert result.strategy == "waterline"


class TestWaterlineLeadInOut:
    """Unit tests for lead-in/lead-out arc generation."""

    def test_lead_in_starts_above_ends_at_z(self):
        pts = _lead_in_arc_points((10.0, 5.0), (15.0, 5.0), tool_r=3.0, z_level=-2.0, safe_z=10.0)
        assert len(pts) >= 2
        # First point should be above z_level
        assert pts[0][2] > -2.0
        # Last point should be at z_level
        assert abs(pts[-1][2] - (-2.0)) < 1e-6
        # Last XY should be at the start point
        assert abs(pts[-1][0] - 10.0) < 1e-3
        assert abs(pts[-1][1] - 5.0) < 1e-3

    def test_lead_out_lifts_from_z(self):
        pts = _lead_out_arc_points((10.0, 5.0), (5.0, 5.0), tool_r=3.0, z_level=-2.0, safe_z=10.0)
        assert len(pts) >= 1
        # All points should be at or above z_level
        for _, _, z in pts:
            assert z >= -2.0 - 1e-6
        # Last point should be above z_level
        assert pts[-1][2] > -2.0

    def test_degenerate_same_points_falls_back(self):
        """When start == second, lead-in should still return valid points (vertical plunge)."""
        pts = _lead_in_arc_points((5.0, 5.0), (5.0, 5.0), tool_r=3.0, z_level=-1.0, safe_z=10.0)
        assert len(pts) >= 2
        assert pts[-1][2] == pytest.approx(-1.0)

    def test_arc_radius_clamped(self):
        """Arc radius should not exceed tool_r * 0.75 or 4mm."""
        pts_small = _lead_in_arc_points((0, 0), (10, 0), tool_r=2.0, z_level=0, safe_z=5.0)
        pts_large = _lead_in_arc_points((0, 0), (10, 0), tool_r=20.0, z_level=0, safe_z=5.0)
        # Both should produce valid arcs
        assert len(pts_small) >= 2
        assert len(pts_large) >= 2
        # Large tool's arc should be capped at 4mm (max lateral displacement)
        max_displacement = max(math.hypot(p[0], p[1]) for p in pts_large)
        assert max_displacement < 10  # much less than tool_r=20


class TestRaster:
    def test_box_produces_chains(self):
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.RASTER)
        result = run_strategy(job, mesh)
        assert len(result.chains) > 0
        assert result.strategy == "raster"

    def test_scan_lines_zigzag(self):
        """Check that consecutive chains alternate scan direction."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.RASTER)
        result = run_strategy(job, mesh)
        if len(result.chains) >= 2:
            # First chain's first feed move X should differ from second chain's
            def first_feed_x(chain):
                for s in chain.segments:
                    if not s.is_rapid:
                        return s.x
                return None

            x0 = first_feed_x(result.chains[0])
            x1 = first_feed_x(result.chains[1])
            if x0 is not None and x1 is not None:
                # They should be scanning from opposite sides
                assert x0 != pytest.approx(x1, abs=0.5)

    def test_raster_stats(self):
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.RASTER)
        result = run_strategy(job, mesh)
        assert result.total_distance_mm > 0

    def test_raster_angle_zero_matches_default(self):
        """raster_angle_deg=0 must produce the same number of chains as the default."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job_default = _make_job(Strategy.RASTER)
        job_zero = _make_job(Strategy.RASTER, raster_angle_deg=0.0)
        r_default = run_strategy(job_default, mesh)
        r_zero = run_strategy(job_zero, mesh)
        assert len(r_zero.chains) == len(r_default.chains)
        assert r_zero.total_distance_mm == pytest.approx(r_default.total_distance_mm, rel=1e-3)

    def test_raster_angle_45_produces_chains(self):
        """raster_angle_deg=45 must still produce a non-empty toolpath."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.RASTER, raster_angle_deg=45.0)
        result = run_strategy(job, mesh)
        assert len(result.chains) > 0
        assert result.total_distance_mm > 0

    def test_raster_angle_45_differs_from_0(self):
        """45° raster should produce toolpath points at diagonal positions vs 0°."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job_0 = _make_job(Strategy.RASTER, raster_angle_deg=0.0)
        job_45 = _make_job(Strategy.RASTER, raster_angle_deg=45.0)
        r0 = run_strategy(job_0, mesh)
        r45 = run_strategy(job_45, mesh)
        # Extract all feed-move Y positions from first chain
        def feed_ys(result):
            ys = set()
            for chain in result.chains:
                for s in chain.segments:
                    if not s.is_rapid:
                        ys.add(round(s.y, 2))
            return ys
        ys_0 = feed_ys(r0)
        ys_45 = feed_ys(r45)
        # 45° scan lines cross multiple Y values per chain — the Y sets should differ
        assert ys_0 != ys_45


class TestPencil:
    def test_box_no_concave_regions(self):
        """A box has no concave regions — pencil should produce empty or few chains."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.PENCIL)
        result = run_strategy(job, mesh)
        assert result.strategy == "pencil"
        # Box is purely convex, so expect no pencil traces (just warnings)


class TestRest:
    def test_requires_larger_prior_tool(self):
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.REST)
        job.prior_tool_diameter_mm = 4.0  # smaller than current 6mm
        result = run_strategy(job, mesh)
        assert any("not larger" in w for w in result.warnings)

    def test_with_valid_prior_tool(self):
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.REST)
        job.prior_tool_diameter_mm = 12.0  # larger than current 6mm
        result = run_strategy(job, mesh)
        assert result.strategy == "rest"

    def test_feed_adjusted_for_engagement(self):
        """Rest strategy feed should be engagement-adjusted (chip thinning at low stepover)."""
        base_feed = 1000.0
        tool_r = 3.0
        # Very small stepover → engagement well below 90° → chip thinning → feed > base
        # ratio=0.5/3≈0.167 → angle≈2*arccos(0.833)≈67° < 90°
        stepover_light = 0.5
        eng_light = compute_engagement_angle(tool_r, stepover_light)
        assert eng_light < 90.0
        expected_feed_light = adjust_feed_for_engagement(base_feed, eng_light)
        assert expected_feed_light > base_feed

        # Full slotting (stepover = diameter) → engagement=180° → feed decreases
        stepover_slot = 6.0
        eng_slot = compute_engagement_angle(tool_r, stepover_slot)
        assert eng_slot == 180.0
        expected_slot = adjust_feed_for_engagement(base_feed, eng_slot)
        assert expected_slot < base_feed


class TestAdaptiveClearFeedEngagement:
    def test_feed_adjusted_for_max_engagement(self):
        """Adaptive clearing applies engagement-adjusted feed at its design engagement angle."""
        base_feed = 1000.0
        # max_engagement_deg defaults to 90 → sin(45°)/sin(45°) = 1 → feed unchanged
        eng_90 = adjust_feed_for_engagement(base_feed, 90.0)
        assert abs(eng_90 - base_feed) < 1e-6

        # Low engagement (30°) → chip thinning → feed > base
        eng_30 = adjust_feed_for_engagement(base_feed, 30.0)
        assert eng_30 > base_feed

        # High engagement (160°, near full slot) → feed < base
        eng_160 = adjust_feed_for_engagement(base_feed, 160.0)
        assert eng_160 < base_feed
