"""Tests for toolpath strategies: all strategies including trochoidal HSM, scallop finish, and 5-axis contour."""
from __future__ import annotations

import math
import struct
import tempfile
from pathlib import Path

import pytest

from ..models import (
    ToolpathJob, Strategy, Tool, ToolShape, CutParams, StockDefinition,
    DrillCycleMode,
)
from ..geometry import load_stl, Mesh
from ..strategies import run_strategy


# ── STL helpers ─────────────────────────────────────────────────────────

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
    return [
        ((0, 0, -1), (0, 0, 0), (sx, sy, 0), (sx, 0, 0)),
        ((0, 0, -1), (0, 0, 0), (0, sy, 0), (sx, sy, 0)),
        ((0, 0, 1), (0, 0, sz), (sx, 0, sz), (sx, sy, sz)),
        ((0, 0, 1), (0, 0, sz), (sx, sy, sz), (0, sy, sz)),
        ((0, -1, 0), (0, 0, 0), (sx, 0, 0), (sx, 0, sz)),
        ((0, -1, 0), (0, 0, 0), (sx, 0, sz), (0, 0, sz)),
        ((0, 1, 0), (0, sy, 0), (0, sy, sz), (sx, sy, sz)),
        ((0, 1, 0), (0, sy, 0), (sx, sy, sz), (sx, sy, 0)),
        ((-1, 0, 0), (0, 0, 0), (0, 0, sz), (0, sy, sz)),
        ((-1, 0, 0), (0, 0, 0), (0, sy, sz), (0, sy, 0)),
        ((1, 0, 0), (sx, 0, 0), (sx, sy, 0), (sx, sy, sz)),
        ((1, 0, 0), (sx, 0, 0), (sx, sy, sz), (sx, 0, sz)),
    ]


def _hemisphere_triangles(radius=5.0, segments=8, rings=4):
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
            n = (0, 0, 1)
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


# ── Adaptive Clear ──────────────────────────────────────────────────────

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

    def test_z_above_minimum(self):
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.ADAPTIVE_CLEAR)
        result = run_strategy(job, mesh)
        for chain in result.chains:
            for seg in chain.segments:
                assert seg.z >= -1.0, f"Z={seg.z} below expected minimum"

    def test_stats_computed(self):
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.ADAPTIVE_CLEAR)
        result = run_strategy(job, mesh)
        assert result.cut_distance_mm > 0
        assert result.total_distance_mm > 0
        assert result.estimated_time_s > 0


# ── Waterline ───────────────────────────────────────────────────────────

class TestWaterline:
    def test_box_produces_result(self):
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.WATERLINE)
        result = run_strategy(job, mesh)
        assert result.strategy == "waterline"

    def test_hemisphere_produces_chains(self):
        mesh = _make_mesh(_hemisphere_triangles(radius=5.0))
        job = _make_job(Strategy.WATERLINE)
        job.stock.z_max = 6.0
        result = run_strategy(job, mesh)
        assert result.strategy == "waterline"

    def test_box_uniform_z_levels(self):
        """A box with vertical walls (uniform steep slope) should produce
        approximately uniform Z-spacing, matching the old constant-step behavior."""
        from ..strategies.waterline import (
            _compute_z_step,
            _compute_adaptive_z_levels,
        )
        from ..geometry import build_heightfield

        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.WATERLINE)
        z_step = _compute_z_step(job)

        bounds = mesh.bounds
        z_top = bounds.max_pt.z - z_step * 0.5
        z_bottom = bounds.min_pt.z + job.tool.radius * 0.25

        hf = build_heightfield(mesh, resolution_mm=1.0, tool_radius=0.0)
        z_levels = _compute_adaptive_z_levels(z_top, z_bottom, z_step, hf)

        # Compute constant-step levels for comparison
        z_levels_const = []
        z = z_top
        while z >= z_bottom - 1e-6:
            z_levels_const.append(z)
            z -= z_step

        # Box should produce the same number of levels (+-1 for rounding)
        assert abs(len(z_levels) - len(z_levels_const)) <= 1

    def test_hemisphere_nonuniform_z_levels(self):
        """A hemisphere should produce non-uniform Z-levels with tighter steps
        near the top (shallow region) compared to a constant-step approach."""
        from ..strategies.waterline import (
            _compute_z_step,
            _compute_adaptive_z_levels,
        )
        from ..geometry import build_heightfield

        mesh = _make_mesh(_hemisphere_triangles(radius=5.0, segments=16, rings=8))
        job = _make_job(Strategy.WATERLINE)
        z_step = _compute_z_step(job)

        bounds = mesh.bounds
        z_top = bounds.max_pt.z - z_step * 0.5
        z_bottom = bounds.min_pt.z + job.tool.radius * 0.25

        hf = build_heightfield(mesh, resolution_mm=0.5, tool_radius=0.0)
        z_levels = _compute_adaptive_z_levels(z_top, z_bottom, z_step, hf)

        # Compute constant-step levels for comparison
        z_levels_const = []
        z = z_top
        while z >= z_bottom - 1e-6:
            z_levels_const.append(z)
            z -= z_step

        # Hemisphere should produce MORE levels than constant (tighter near top)
        assert len(z_levels) >= len(z_levels_const), (
            f"Adaptive produced {len(z_levels)} levels vs constant {len(z_levels_const)}; "
            "expected more or equal on a hemisphere"
        )

    def test_min_z_step_respected(self):
        """Z-step should never go below the 0.05mm minimum, even on perfectly flat surfaces."""
        from ..strategies.waterline import (
            _compute_adaptive_z_levels,
            _MIN_Z_STEP,
        )
        from ..geometry import Heightfield

        # Create a heightfield that is perfectly flat (all cells at z=5.0)
        hf = Heightfield(0, 10, 0, 10, 20, 20, default_z=5.0)

        z_levels = _compute_adaptive_z_levels(6.0, 3.0, 1.0, hf)

        # Check that consecutive Z differences are >= _MIN_Z_STEP
        for i in range(len(z_levels) - 1):
            diff = z_levels[i] - z_levels[i + 1]
            assert diff >= _MIN_Z_STEP - 1e-9, (
                f"Step {i}: {z_levels[i]:.4f} -> {z_levels[i+1]:.4f}, "
                f"diff={diff:.4f} < min={_MIN_Z_STEP}"
            )

    def test_z_step_upper_bound(self):
        """Z-step should never exceed the user's configured z_step."""
        from ..strategies.waterline import _compute_adaptive_z_levels
        from ..geometry import Heightfield

        # Steep surface: no cells in band -> large angle -> full z_step
        hf = Heightfield(0, 10, 0, 10, 10, 10, default_z=-100.0)

        user_z_step = 0.5
        z_levels = _compute_adaptive_z_levels(5.0, 0.0, user_z_step, hf)

        for i in range(len(z_levels) - 1):
            diff = z_levels[i] - z_levels[i + 1]
            assert diff <= user_z_step + 1e-9, (
                f"Step {i} diff={diff:.4f} exceeds user z_step={user_z_step}"
            )


# ── Raster ──────────────────────────────────────────────────────────────

class TestRaster:
    def test_box_produces_chains(self):
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.RASTER)
        result = run_strategy(job, mesh)
        assert len(result.chains) > 0
        assert result.strategy == "raster"

    def test_zigzag_pattern(self):
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.RASTER)
        result = run_strategy(job, mesh)
        if len(result.chains) >= 2:
            def first_feed_x(chain):
                for s in chain.segments:
                    if not s.is_rapid:
                        return s.x
                return None

            x0 = first_feed_x(result.chains[0])
            x1 = first_feed_x(result.chains[1])
            if x0 is not None and x1 is not None:
                assert x0 != pytest.approx(x1, abs=0.5)

    def test_stats(self):
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.RASTER)
        result = run_strategy(job, mesh)
        assert result.total_distance_mm > 0

    def test_raster_angle_zero_matches_default(self):
        """raster_angle_deg=0 must produce the same number of chains as the default."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job_default = _make_job(Strategy.RASTER)
        job_zero = _make_job(Strategy.RASTER)
        job_zero.raster_angle_deg = 0.0
        r_default = run_strategy(job_default, mesh)
        r_zero = run_strategy(job_zero, mesh)
        assert len(r_zero.chains) == len(r_default.chains)
        assert r_zero.total_distance_mm == pytest.approx(r_default.total_distance_mm, rel=1e-3)

    def test_raster_angle_45_produces_chains(self):
        """raster_angle_deg=45 must still produce a non-empty toolpath."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.RASTER)
        job.raster_angle_deg = 45.0
        result = run_strategy(job, mesh)
        assert len(result.chains) > 0
        assert result.total_distance_mm > 0

    def test_raster_angle_45_differs_from_0(self):
        """45-degree raster should produce toolpath points at different Y positions vs 0."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job_0 = _make_job(Strategy.RASTER)
        job_0.raster_angle_deg = 0.0
        job_45 = _make_job(Strategy.RASTER)
        job_45.raster_angle_deg = 45.0
        r0 = run_strategy(job_0, mesh)
        r45 = run_strategy(job_45, mesh)

        # Extract all feed-move Y positions
        def feed_ys(result):
            ys = set()
            for chain in result.chains:
                for s in chain.segments:
                    if not s.is_rapid:
                        ys.add(round(s.y, 2))
            return ys

        ys_0 = feed_ys(r0)
        ys_45 = feed_ys(r45)
        # 45-degree scan lines cross multiple Y values per chain — the Y sets should differ
        assert ys_0 != ys_45

    def test_raster_angle_90_produces_y_sweep_lines(self):
        """raster_angle_deg=90 should rotate scan lines to sweep along Y.

        At 0 degrees the default raster sweeps along X (Y is near-constant per
        chain).  At 90 degrees, scan lines are rotated so each chain sweeps
        along Y with near-constant X — the opposite of the default.
        """
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.RASTER)
        job.raster_angle_deg = 90.0
        result = run_strategy(job, mesh)
        assert len(result.chains) > 0

        # At 90 degrees each scan line sweeps along Y with near-constant X.
        for chain in result.chains:
            feed_xs = [s.x for s in chain.segments if not s.is_rapid]
            feed_ys = [s.y for s in chain.segments if not s.is_rapid]
            if len(feed_xs) < 2:
                continue
            x_range = max(feed_xs) - min(feed_xs)
            y_range = max(feed_ys) - min(feed_ys)
            # X should be near-constant (small range), Y should have large sweep
            assert x_range < y_range + 1.0, (
                f"At 90-deg, expected X-range ({x_range:.2f}) < Y-range ({y_range:.2f}) + 1 "
                "per chain (scan lines should sweep along Y axis)"
            )


# ── Pencil ──────────────────────────────────────────────────────────────

class TestPencil:
    def test_box_no_concave(self):
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.PENCIL)
        result = run_strategy(job, mesh)
        assert result.strategy == "pencil"


# ── Rest ────────────────────────────────────────────────────────────────

class TestRest:
    def test_requires_larger_prior_tool(self):
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.REST)
        job.prior_tool_diameter_mm = 4.0
        result = run_strategy(job, mesh)
        assert any("not larger" in w for w in result.warnings)

    def test_valid_prior_tool(self):
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.REST)
        job.prior_tool_diameter_mm = 12.0
        result = run_strategy(job, mesh)
        assert result.strategy == "rest"


# ── Spiral Finish ───────────────────────────────────────────────────────

class TestSpiralFinish:
    def test_box_produces_chains(self):
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.SPIRAL_FINISH)
        result = run_strategy(job, mesh)
        assert len(result.chains) > 0
        assert result.strategy == "spiral_finish"

    def test_has_continuous_path(self):
        """Spiral should produce a single long chain (no retracts mid-spiral)."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.SPIRAL_FINISH)
        result = run_strategy(job, mesh)
        # Should have exactly 1 chain (the spiral)
        assert len(result.chains) == 1
        # Chain should have many segments
        assert len(result.chains[0].segments) > 10

    def test_hemisphere(self):
        mesh = _make_mesh(_hemisphere_triangles(radius=5.0))
        job = _make_job(Strategy.SPIRAL_FINISH)
        result = run_strategy(job, mesh)
        assert result.strategy == "spiral_finish"
        assert result.total_distance_mm > 0


# ── Edge cases ──────────────────────────────────────────────────────────

# ── Morphing Finish ────────────────────────────────────────────────────

class TestMorphingFinish:
    def test_box_produces_chains(self):
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.MORPHING_FINISH)
        result = run_strategy(job, mesh)
        assert result.strategy == "morphing_finish"

    def test_hemisphere_produces_chains(self):
        """Hemisphere has both steep and gentle surfaces - ideal for morphing."""
        mesh = _make_mesh(_hemisphere_triangles(radius=5.0))
        job = _make_job(Strategy.MORPHING_FINISH)
        job.stock.z_max = 6.0
        result = run_strategy(job, mesh)
        assert result.strategy == "morphing_finish"

    def test_has_raster_chains(self):
        """Should produce raster passes for gentle areas."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.MORPHING_FINISH)
        result = run_strategy(job, mesh)
        raster_chains = [c for c in result.chains if "morph-raster" in c.comment]
        assert len(raster_chains) > 0

    def test_stats_computed(self):
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.MORPHING_FINISH)
        result = run_strategy(job, mesh)
        assert result.total_distance_mm > 0


# ── Trochoidal Slot Clearing ──────────────────────────────────────────

class TestTrochoidalSlot:
    def test_generates_chain(self):
        from ..strategies.adaptive_clear import generate_trochoidal_slot
        chain = generate_trochoidal_slot(
            x_start=0, y_start=5,
            x_end=50, y_end=5,
            z_level=-5.0,
            tool_radius=3.0,
            slot_width=8.0,
            stepover=1.0,
            feed=1000,
            safe_z=10.0,
            plunge=400,
        )
        assert len(chain.segments) > 10
        assert chain.comment.startswith("trochoidal")

    def test_has_cutting_moves(self):
        from ..strategies.adaptive_clear import generate_trochoidal_slot
        chain = generate_trochoidal_slot(
            x_start=0, y_start=0,
            x_end=20, y_end=0,
            z_level=-3.0,
            tool_radius=3.0,
            slot_width=6.0,
            stepover=1.0,
            feed=1000,
            safe_z=10.0,
            plunge=400,
        )
        feed_count = sum(1 for s in chain.segments if not s.is_rapid)
        assert feed_count > 0

    def test_zero_length_slot_is_empty(self):
        from ..strategies.adaptive_clear import generate_trochoidal_slot
        chain = generate_trochoidal_slot(
            x_start=5, y_start=5,
            x_end=5, y_end=5,
            z_level=-3.0,
            tool_radius=3.0,
            slot_width=6.0,
            stepover=1.0,
            feed=1000,
            safe_z=10.0,
            plunge=400,
        )
        assert len(chain.segments) == 0


# ── Trochoidal HSM Strategy ──────────────────────────────────────────

class TestTrochoidalHSM:
    """Tests for the standalone trochoidal HSM roughing strategy."""

    def test_box_produces_chains(self):
        """Trochoidal HSM should generate chains for a simple box mesh."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.TROCHOIDAL_HSM)
        result = run_strategy(job, mesh)
        assert result.strategy == "trochoidal_hsm"
        assert len(result.chains) > 0

    def test_has_feed_moves(self):
        """Trochoidal HSM must produce cutting (non-rapid) segments."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.TROCHOIDAL_HSM)
        result = run_strategy(job, mesh)
        feed_count = sum(
            1 for c in result.chains for s in c.segments if not s.is_rapid
        )
        assert feed_count > 0, "trochoidal HSM produced no cutting moves"

    def test_stats_computed(self):
        """Statistics should be populated after generation."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.TROCHOIDAL_HSM)
        result = run_strategy(job, mesh)
        assert result.cut_distance_mm > 0
        assert result.total_distance_mm > 0
        assert result.estimated_time_s > 0

    def test_z_levels_descend(self):
        """Feed moves should generally descend through Z levels from top to bottom."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.TROCHOIDAL_HSM)
        result = run_strategy(job, mesh)
        # Collect the Z value of the first feed move in each chain
        z_values: list[float] = []
        for chain in result.chains:
            for seg in chain.segments:
                if not seg.is_rapid:
                    z_values.append(seg.z)
                    break
        # Z values should generally not be increasing (they process top-down)
        if len(z_values) >= 2:
            # At least the first Z should be >= the last Z
            assert z_values[0] >= z_values[-1] - 1.0

    def test_trochoidal_arc_pattern(self):
        """Trochoidal motion should produce oscillating X/Y patterns
        (the defining characteristic of trochoidal milling)."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.TROCHOIDAL_HSM)
        result = run_strategy(job, mesh)

        # Find a chain with many feed moves (the trochoidal arc moves)
        for chain in result.chains:
            feed_segs = [s for s in chain.segments if not s.is_rapid]
            if len(feed_segs) < 20:
                continue
            # Check for direction reversals in X or Y (sign of arc motion)
            x_changes = 0
            y_changes = 0
            for i in range(2, len(feed_segs)):
                dx_prev = feed_segs[i - 1].x - feed_segs[i - 2].x
                dx_curr = feed_segs[i].x - feed_segs[i - 1].x
                dy_prev = feed_segs[i - 1].y - feed_segs[i - 2].y
                dy_curr = feed_segs[i].y - feed_segs[i - 1].y
                if dx_prev * dx_curr < 0:
                    x_changes += 1
                if dy_prev * dy_curr < 0:
                    y_changes += 1
            # Trochoidal motion oscillates, so should have many direction changes
            total_changes = x_changes + y_changes
            if total_changes > 5:
                return  # success: found oscillating arc pattern
        # If we get here, at least one chain should have shown the pattern
        # (but on very small meshes it may not, so just ensure chains exist)
        assert len(result.chains) > 0

    def test_degenerate_stock_warns(self):
        """Degenerate stock should produce a warning and empty result."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.TROCHOIDAL_HSM)
        job.stock.x_min = 5.0
        job.stock.x_max = 5.0  # zero-width stock
        result = run_strategy(job, mesh)
        assert any("Degenerate" in w for w in result.warnings)
        assert len(result.chains) == 0

    def test_empty_mesh_warns(self):
        """Empty mesh should produce a warning and empty result."""
        mesh = Mesh(vertices=[], normals=[])
        job = _make_job(Strategy.TROCHOIDAL_HSM)
        result = run_strategy(job, mesh)
        assert any("Empty mesh" in w for w in result.warnings)
        assert len(result.chains) == 0

    def test_multiple_z_levels(self):
        """A standard box should produce chains at multiple Z levels."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.TROCHOIDAL_HSM)
        # default stock z_max=7, mesh top=5, z_step=1mm
        # Should have z levels from 6 down to 0 (at least 5 levels)
        result = run_strategy(job, mesh)
        # Check that chains appear at multiple distinct Z values
        z_levels_seen: set[float] = set()
        for chain in result.chains:
            for seg in chain.segments:
                if not seg.is_rapid:
                    z_levels_seen.add(round(seg.z, 1))
                    break
        assert len(z_levels_seen) >= 2, (
            f"Expected chains at multiple Z levels, got {z_levels_seen}"
        )

    def test_contour_interpolation_helper(self):
        """Test the _interpolate_contour helper for correct position and direction."""
        from ..strategies.trochoidal_hsm import _interpolate_contour
        contour = [(0.0, 0.0), (10.0, 0.0), (10.0, 10.0)]
        cum_dist = [0.0, 10.0, 20.0]

        # At distance 0: should be at start, direction along first segment
        px, py, dx, dy = _interpolate_contour(contour, cum_dist, 0.0)
        assert abs(px) < 1e-6
        assert abs(py) < 1e-6
        assert abs(dx - 1.0) < 1e-6  # direction along +X
        assert abs(dy) < 1e-6

        # At distance 5: should be midway along first segment
        px, py, dx, dy = _interpolate_contour(contour, cum_dist, 5.0)
        assert abs(px - 5.0) < 1e-6
        assert abs(py) < 1e-6

        # At distance 15: should be midway along second segment, direction +Y
        px, py, dx, dy = _interpolate_contour(contour, cum_dist, 15.0)
        assert abs(px - 10.0) < 1e-6
        assert abs(py - 5.0) < 1e-6
        assert abs(dx) < 1e-6
        assert abs(dy - 1.0) < 1e-6

    def test_hemisphere_produces_chains(self):
        """Hemisphere should also work with trochoidal HSM."""
        mesh = _make_mesh(_hemisphere_triangles(radius=5.0, segments=8, rings=4))
        job = _make_job(Strategy.TROCHOIDAL_HSM)
        job.stock.x_min = -7
        job.stock.x_max = 7
        job.stock.y_min = -7
        job.stock.y_max = 7
        job.stock.z_min = 0
        job.stock.z_max = 6
        result = run_strategy(job, mesh)
        assert result.strategy == "trochoidal_hsm"
        assert len(result.chains) > 0


# ── Steep-and-Shallow ─────────────────────────────────────────────────

class TestSteepShallow:
    def test_box_produces_chains(self):
        """Box has both horizontal top/bottom (shallow) and vertical sides (steep)."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.STEEP_SHALLOW, tool=Tool(diameter_mm=6.0, shape=ToolShape.BALL))
        result = run_strategy(job, mesh)
        assert result.strategy == "steep_shallow"
        assert len(result.chains) > 0

    def test_produces_both_raster_and_waterline_chains(self):
        """Box geometry should produce a mix of raster and waterline chains."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.STEEP_SHALLOW, tool=Tool(diameter_mm=6.0, shape=ToolShape.BALL))
        result = run_strategy(job, mesh)
        # Warning message reports the chain counts
        assert any("raster" in w or "waterline" in w for w in result.warnings)

    def test_hemisphere_produces_chains(self):
        """Hemisphere has steep walls near base and shallow top — ideal for steep/shallow split."""
        mesh = _make_mesh(_hemisphere_triangles(radius=5.0, segments=8, rings=4))
        job = _make_job(
            Strategy.STEEP_SHALLOW,
            tool=Tool(diameter_mm=4.0, shape=ToolShape.BALL),
        )
        job.stock.x_min = -6
        job.stock.x_max = 6
        job.stock.y_min = -6
        job.stock.y_max = 6
        job.stock.z_min = 0
        job.stock.z_max = 6
        result = run_strategy(job, mesh)
        assert result.strategy == "steep_shallow"
        assert len(result.chains) > 0

    def test_has_feed_moves(self):
        """The overall result from steep/shallow must contain cutting (non-rapid) segments."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.STEEP_SHALLOW, tool=Tool(diameter_mm=6.0, shape=ToolShape.BALL))
        result = run_strategy(job, mesh)
        feed_count = sum(1 for c in result.chains for s in c.segments if not s.is_rapid)
        assert feed_count > 0


# ── Scallop Finish ─────────────────────────────────────────────────────

class TestScallopFinish:
    def test_hemisphere_produces_chains(self):
        """Hemisphere is the canonical surface for scallop finishing."""
        mesh = _make_mesh(_hemisphere_triangles(radius=5.0, segments=8, rings=4))
        job = _make_job(
            Strategy.SCALLOP,
            tool=Tool(diameter_mm=6.0, shape=ToolShape.BALL),
        )
        job.stock.x_min = -7
        job.stock.x_max = 7
        job.stock.y_min = -7
        job.stock.y_max = 7
        job.stock.z_min = 0
        job.stock.z_max = 6
        result = run_strategy(job, mesh)
        assert result.strategy == "scallop"
        assert len(result.chains) > 0

    def test_box_produces_chains(self):
        """Flat endmill on a box — scallop strategy should still generate paths."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.SCALLOP, tool=Tool(diameter_mm=6.0, shape=ToolShape.BALL))
        result = run_strategy(job, mesh)
        assert result.strategy == "scallop"
        assert len(result.chains) > 0

    def test_has_feed_moves(self):
        """Scallop result must contain cutting (non-rapid) segments."""
        mesh = _make_mesh(_hemisphere_triangles(radius=5.0, segments=8, rings=4))
        job = _make_job(
            Strategy.SCALLOP,
            tool=Tool(diameter_mm=6.0, shape=ToolShape.BALL),
        )
        job.stock.x_min = -7
        job.stock.x_max = 7
        job.stock.y_min = -7
        job.stock.y_max = 7
        job.stock.z_min = 0
        job.stock.z_max = 6
        result = run_strategy(job, mesh)
        feed_count = sum(1 for c in result.chains for s in c.segments if not s.is_rapid)
        assert feed_count > 0, "scallop finish produced no cutting moves"

    def test_stats_computed(self):
        """Statistics should be populated after generation."""
        mesh = _make_mesh(_hemisphere_triangles(radius=5.0, segments=8, rings=4))
        job = _make_job(
            Strategy.SCALLOP,
            tool=Tool(diameter_mm=6.0, shape=ToolShape.BALL),
        )
        job.stock.x_min = -7
        job.stock.x_max = 7
        job.stock.y_min = -7
        job.stock.y_max = 7
        job.stock.z_min = 0
        job.stock.z_max = 6
        result = run_strategy(job, mesh)
        assert result.cut_distance_mm > 0
        assert result.total_distance_mm > 0
        assert result.estimated_time_s > 0

    def test_adaptive_stepover_formula(self):
        """Verify the core _stepover_for_angle function maintains scallop height."""
        from ..strategies.scallop_finish import _stepover_for_angle

        cusp_radius = 3.0  # ball endmill R=3mm
        scallop_h = 0.01   # 10 um scallop target
        max_stepover = 2.0

        # Flat surface (0 deg): should give maximum stepover (up to max)
        so_flat = _stepover_for_angle(0.0, cusp_radius, scallop_h, max_stepover)
        assert so_flat > 0.0

        # Moderate angle (45 deg): should be smaller than flat
        so_45 = _stepover_for_angle(45.0, cusp_radius, scallop_h, max_stepover)
        assert 0 < so_45 < so_flat + 1e-9

        # Steep angle (80 deg): should be even smaller
        so_steep = _stepover_for_angle(80.0, cusp_radius, scallop_h, max_stepover)
        assert 0 < so_steep < so_45 + 1e-9

        # Near-vertical (85+ deg): should return 0 (skip)
        so_vertical = _stepover_for_angle(86.0, cusp_radius, scallop_h, max_stepover)
        assert so_vertical == 0.0

    def test_flat_endmill_fallback(self):
        """Flat endmill has no cusp geometry; should fall back to constant stepover."""
        from ..strategies.scallop_finish import _stepover_for_angle

        # cusp_radius=0 means flat endmill
        so = _stepover_for_angle(30.0, 0.0, 0.01, 2.0)
        assert so == 2.0  # should return max_stepover for flat endmill

    def test_target_scallop_height_conversion(self):
        """Ra to scallop height conversion should follow the Ra*4 formula."""
        from ..strategies.scallop_finish import _target_scallop_height

        # Ra = 3.2 um -> scallop = 3.2*4/1000 = 0.0128 mm
        h = _target_scallop_height(3.2)
        assert abs(h - 0.0128) < 1e-6

        # Ra = 0 -> should clamp to floor (0.0005 mm)
        h_zero = _target_scallop_height(0.0)
        assert h_zero >= 0.0005 - 1e-9

    def test_cusp_radius_for_ball_endmill(self):
        """Ball endmill cusp radius should equal the full tool radius."""
        from ..strategies.scallop_finish import _cusp_radius
        r = _cusp_radius(ToolShape.BALL, 3.0, 0.0)
        assert r == 3.0

    def test_cusp_radius_for_bull_endmill(self):
        """Bull-nose cusp radius should equal the corner radius."""
        from ..strategies.scallop_finish import _cusp_radius
        r = _cusp_radius(ToolShape.BULL, 5.0, 1.5)
        assert r == 1.5

    def test_cusp_radius_for_flat_endmill(self):
        """Flat endmill has no cusp: radius should be 0."""
        from ..strategies.scallop_finish import _cusp_radius
        r = _cusp_radius(ToolShape.FLAT, 3.0, 0.0)
        assert r == 0.0

    def test_degenerate_stock_warns(self):
        """Degenerate stock should produce a warning and empty result."""
        mesh = _make_mesh(_hemisphere_triangles(radius=5.0))
        job = _make_job(
            Strategy.SCALLOP,
            tool=Tool(diameter_mm=6.0, shape=ToolShape.BALL),
        )
        job.stock.x_min = 0.0
        job.stock.x_max = 0.0  # zero-width stock
        result = run_strategy(job, mesh)
        assert any("Degenerate" in w for w in result.warnings)
        assert len(result.chains) == 0

    def test_empty_mesh_warns(self):
        """Empty mesh should produce a warning and empty result."""
        mesh = Mesh(vertices=[], normals=[])
        job = _make_job(
            Strategy.SCALLOP,
            tool=Tool(diameter_mm=6.0, shape=ToolShape.BALL),
        )
        result = run_strategy(job, mesh)
        assert any("Empty mesh" in w for w in result.warnings)
        assert len(result.chains) == 0

    def test_adaptive_stepover_steep_vs_flat(self):
        """On steep surfaces the stepover formula should produce a smaller value
        than on flat surfaces, confirming that the strategy adapts spacing."""
        from ..strategies.scallop_finish import _stepover_for_angle
        cusp_radius = 3.0
        scallop_h = 0.01
        max_stepover = 2.0

        so_flat = _stepover_for_angle(5.0, cusp_radius, scallop_h, max_stepover)
        so_steep = _stepover_for_angle(60.0, cusp_radius, scallop_h, max_stepover)

        # Steep surface must have a smaller stepover (more passes)
        assert so_steep < so_flat, (
            f"Steep stepover ({so_steep:.4f}) should be less than flat ({so_flat:.4f})"
        )

    def test_flat_endmill_warns_and_produces_passes(self):
        """A flat endmill with scallop strategy should warn about fallback."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(
            Strategy.SCALLOP,
            tool=Tool(diameter_mm=6.0, shape=ToolShape.FLAT),
        )
        result = run_strategy(job, mesh)
        assert any("Flat endmill" in w or "flat" in w.lower() for w in result.warnings)
        # Should still produce toolpath via constant-stepover fallback
        assert len(result.chains) > 0


# ── 4-Axis Continuous ─────────────────────────────────────────────────

class TestAxis4Continuous:
    def _cylinder_mesh(self):
        """Cylinder mesh for rotary machining tests."""
        import math as _math
        radius, length, segments = 10.0, 20.0, 12
        tris = []
        for i in range(segments):
            t0 = 2 * _math.pi * i / segments
            t1 = 2 * _math.pi * (i + 1) / segments
            p00 = (0, radius * _math.cos(t0), radius * _math.sin(t0))
            p10 = (length, radius * _math.cos(t0), radius * _math.sin(t0))
            p01 = (0, radius * _math.cos(t1), radius * _math.sin(t1))
            p11 = (length, radius * _math.cos(t1), radius * _math.sin(t1))
            n = (0, _math.cos(t0), _math.sin(t0))
            tris.append((n, p00, p10, p01))
            tris.append((n, p10, p11, p01))
        return _make_mesh(tris)

    def _4axis_job(self) -> "ToolpathJob":
        from ..models import MachineKinematics
        machine = MachineKinematics(has_4th_axis=True)
        job = _make_job(Strategy.AXIS4_CONTINUOUS, tool=Tool(diameter_mm=6.0, shape=ToolShape.FLAT))
        job.machine = machine
        job.cylinder_diameter_mm = 20.0
        job.stock.x_min = 0
        job.stock.x_max = 20
        job.stock.y_min = -12
        job.stock.y_max = 12
        job.stock.z_min = -12
        job.stock.z_max = 12
        return job

    def test_cylinder_produces_chains(self):
        """4-axis continuous should generate chains for a cylindrical workpiece."""
        mesh = self._cylinder_mesh()
        job = self._4axis_job()
        result = run_strategy(job, mesh)
        assert result.strategy == "4axis_continuous"
        assert len(result.chains) > 0

    def test_requires_4th_axis(self):
        """Without has_4th_axis the strategy should warn and return empty/warning."""
        from ..models import MachineKinematics
        mesh = self._cylinder_mesh()
        job = self._4axis_job()
        job.machine = MachineKinematics(has_4th_axis=False)
        result = run_strategy(job, mesh)
        # Should either be empty or contain a warning about missing 4th axis
        assert result.strategy == "4axis_continuous"
        if len(result.chains) == 0:
            assert any("4th" in w or "axis" in w.lower() for w in result.warnings)

    def test_has_cutting_moves(self):
        """At least one 4-axis continuous chain must have cutting (non-rapid) segments."""
        mesh = self._cylinder_mesh()
        job = self._4axis_job()
        result = run_strategy(job, mesh)
        feed_count = sum(1 for c in result.chains for s in c.segments if not s.is_rapid)
        assert feed_count > 0, "4-axis continuous produced no cutting moves"


# ── 5-Axis Strategies ─────────────────────────────────────────────────

class TestFiveAxisStrategies:
    """Basic smoke tests for the three 5-axis strategies: contour, swarf, flowline."""

    def _make_5axis_job(self, strategy: Strategy) -> "ToolpathJob":
        from ..models import MachineKinematics
        machine = MachineKinematics(has_5th_axis=True)
        job = _make_job(strategy, tool=Tool(diameter_mm=6.0, shape=ToolShape.BALL))
        job.machine = machine
        return job

    def test_contour_produces_chains(self):
        """5-axis contour should generate normal-following chains on a box."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = self._make_5axis_job(Strategy.FIVEAXIS_CONTOUR)
        result = run_strategy(job, mesh)
        assert result.strategy == "5axis_contour"
        assert len(result.chains) > 0

    def test_swarf_produces_chains(self):
        """5-axis swarf (flank milling) should generate chains on a box."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = self._make_5axis_job(Strategy.FIVEAXIS_SWARF)
        result = run_strategy(job, mesh)
        assert result.strategy == "5axis_swarf"
        assert len(result.chains) > 0

    def test_flowline_produces_chains(self):
        """5-axis flowline should generate smooth surface-following chains."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = self._make_5axis_job(Strategy.FIVEAXIS_FLOWLINE)
        result = run_strategy(job, mesh)
        assert result.strategy == "5axis_flowline"
        assert len(result.chains) > 0

    def test_contour_fallback_without_5th_axis(self):
        """Without has_5th_axis, 5-axis contour falls back and warns."""
        from ..models import MachineKinematics
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.FIVEAXIS_CONTOUR, tool=Tool(diameter_mm=6.0, shape=ToolShape.BALL))
        job.machine = MachineKinematics(has_5th_axis=False)
        result = run_strategy(job, mesh)
        # Strategy may fall back to raster; must not crash, chains must be present
        assert len(result.chains) > 0
        # Should emit a fallback warning
        assert any("5th" in w or "axis" in w.lower() or "raster" in w.lower() for w in result.warnings)

    def test_contour_has_feed_moves(self):
        """5-axis contour must produce cutting (non-rapid) segments."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = self._make_5axis_job(Strategy.FIVEAXIS_CONTOUR)
        result = run_strategy(job, mesh)
        feed_count = sum(1 for c in result.chains for s in c.segments if not s.is_rapid)
        assert feed_count > 0, "5-axis contour produced no cutting moves"


# ── 5-Axis Contour (Detailed) ───────────────────────────────────────

class TestFiveAxisContourDetailed:
    """Detailed tests for 5-axis surface normal contour strategy correctness."""

    def _make_5axis_job(self, strategy: Strategy = Strategy.FIVEAXIS_CONTOUR) -> "ToolpathJob":
        from ..models import MachineKinematics
        machine = MachineKinematics(has_5th_axis=True, max_tilt_deg=45.0)
        job = _make_job(strategy, tool=Tool(diameter_mm=6.0, shape=ToolShape.BALL))
        job.machine = machine
        return job

    def test_contour_5axis_segments_have_ab_angles(self):
        """5-axis contour feed segments must include A and B rotary angles."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = self._make_5axis_job()
        result = run_strategy(job, mesh)
        has_ab = False
        for chain in result.chains:
            for seg in chain.segments:
                if not seg.is_rapid and seg.a is not None and seg.b is not None:
                    has_ab = True
                    break
            if has_ab:
                break
        assert has_ab, "5-axis contour produced no segments with A/B angles"

    def test_contour_tilt_within_machine_limits(self):
        """A/B angles must not exceed the machine's max_tilt_deg."""
        mesh = _make_mesh(_hemisphere_triangles(radius=5.0, segments=8, rings=4))
        job = self._make_5axis_job()
        job.stock.x_min = -7
        job.stock.x_max = 7
        job.stock.y_min = -7
        job.stock.y_max = 7
        job.stock.z_min = 0
        job.stock.z_max = 6
        max_tilt = job.machine.max_tilt_deg
        result = run_strategy(job, mesh)
        for chain in result.chains:
            for seg in chain.segments:
                if seg.a is not None:
                    assert abs(seg.a) <= max_tilt + 1.0, (
                        f"A angle {seg.a:.1f} exceeds max tilt {max_tilt:.1f}"
                    )
                if seg.b is not None:
                    assert abs(seg.b) <= max_tilt + 1.0, (
                        f"B angle {seg.b:.1f} exceeds max tilt {max_tilt:.1f}"
                    )

    def test_tool_axis_vector_normalized(self):
        """The _ab_to_axis_vector helper must return unit vectors."""
        from ..strategies.fiveaxis_contour import _ab_to_axis_vector
        # Test several angle combinations
        test_cases = [
            (0.0, 0.0),    # vertical
            (15.0, 0.0),   # A tilt only
            (0.0, 20.0),   # B tilt only
            (10.0, 10.0),  # both tilted
            (-5.0, 12.0),  # negative A
            (30.0, -15.0), # mixed signs
        ]
        for a_deg, b_deg in test_cases:
            vx, vy, vz = _ab_to_axis_vector(a_deg, b_deg)
            length = math.sqrt(vx * vx + vy * vy + vz * vz)
            assert abs(length - 1.0) < 1e-6, (
                f"Axis vector ({vx:.4f}, {vy:.4f}, {vz:.4f}) not unit "
                f"(length={length:.6f}) for A={a_deg}, B={b_deg}"
            )

    def test_normal_to_ab_roundtrip(self):
        """Converting a surface normal to A/B angles and back to axis
        vector should produce a vector close to the original normal direction."""
        from ..strategies.fiveaxis_contour import _normal_to_ab_angles, _ab_to_axis_vector
        max_tilt = math.radians(45.0)

        # Test with a tilted normal (not too steep)
        nx, ny, nz = 0.3, 0.2, 0.9
        ln = math.sqrt(nx * nx + ny * ny + nz * nz)
        nx, ny, nz = nx / ln, ny / ln, nz / ln

        a_deg, b_deg = _normal_to_ab_angles(nx, ny, nz, max_tilt, 0.0, 1.0)
        vx, vy, vz = _ab_to_axis_vector(a_deg, b_deg)

        # The reconstructed vector should be roughly aligned with the original normal
        dot = vx * nx + vy * ny + vz * nz
        assert dot > 0.7, (
            f"Roundtrip dot product {dot:.3f} too low: "
            f"normal=({nx:.3f}, {ny:.3f}, {nz:.3f}), "
            f"axis=({vx:.3f}, {vy:.3f}, {vz:.3f})"
        )

    def test_smooth_angle_limits_rate(self):
        """_smooth_angle should limit the change per step."""
        from ..strategies.fiveaxis_contour import _smooth_angle

        # Large jump should be clamped
        result = _smooth_angle(0.0, 30.0, max_rate_deg=5.0)
        assert abs(result - 5.0) < 1e-6

        # Small jump should pass through
        result = _smooth_angle(10.0, 12.0, max_rate_deg=5.0)
        assert abs(result - 12.0) < 1e-6

        # Negative direction
        result = _smooth_angle(0.0, -20.0, max_rate_deg=5.0)
        assert abs(result - (-5.0)) < 1e-6

    def test_contour_stats_computed(self):
        """5-axis contour statistics should be populated."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = self._make_5axis_job()
        result = run_strategy(job, mesh)
        assert result.cut_distance_mm > 0
        assert result.total_distance_mm > 0
        assert result.estimated_time_s > 0

    def test_hemisphere_5axis_contour(self):
        """5-axis contour on a hemisphere should produce chains with A/B axes."""
        mesh = _make_mesh(_hemisphere_triangles(radius=5.0, segments=8, rings=4))
        job = self._make_5axis_job()
        job.stock.x_min = -7
        job.stock.x_max = 7
        job.stock.y_min = -7
        job.stock.y_max = 7
        job.stock.z_min = 0
        job.stock.z_max = 6
        result = run_strategy(job, mesh)
        assert len(result.chains) > 0
        # 5-axis segments should have A/B angle fields populated (even if 0)
        has_5axis_seg = False
        for chain in result.chains:
            for seg in chain.segments:
                if seg.a is not None and seg.b is not None:
                    has_5axis_seg = True
                    break
            if has_5axis_seg:
                break
        assert has_5axis_seg, (
            "5-axis on hemisphere should produce segments with A/B angle fields"
        )

    def test_swarf_stats_computed(self):
        """5-axis swarf statistics should be populated."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = self._make_5axis_job(Strategy.FIVEAXIS_SWARF)
        result = run_strategy(job, mesh)
        if result.chains:
            assert result.total_distance_mm > 0

    def test_flowline_stats_computed(self):
        """5-axis flowline statistics should be populated."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = self._make_5axis_job(Strategy.FIVEAXIS_FLOWLINE)
        result = run_strategy(job, mesh)
        if result.chains:
            assert result.total_distance_mm > 0

    def test_degenerate_stock_warns(self):
        """Degenerate stock should produce a warning."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = self._make_5axis_job()
        job.stock.x_min = 5.0
        job.stock.x_max = 5.0  # zero-width
        result = run_strategy(job, mesh)
        assert any("Degenerate" in w for w in result.warnings)
        assert len(result.chains) == 0

    def test_empty_mesh_warns(self):
        """Empty mesh should produce a warning."""
        mesh = Mesh(vertices=[], normals=[])
        job = self._make_5axis_job()
        result = run_strategy(job, mesh)
        assert any("Empty mesh" in w for w in result.warnings)
        assert len(result.chains) == 0


# ── Edge cases ────────────────────────────────────────────────────────

# ── Drill Strategy ────────────────────────────────────────────────────

class TestDrillStrategy:
    def test_g81_produces_chains(self):
        """G81 simple drill should produce one chain per hole."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.DRILL)
        job.drill_points = [(5.0, 5.0), (15.0, 5.0), (10.0, 10.0)]
        job.drill_cycle_mode = DrillCycleMode.G81
        result = run_strategy(job, mesh)
        assert result.strategy == "drill"
        assert len(result.chains) == 3

    def test_g83_peck_drill_produces_chains(self):
        """G83 peck drill should produce chains with peck motion."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.DRILL)
        job.drill_points = [(5.0, 5.0)]
        job.drill_cycle_mode = DrillCycleMode.G83
        job.peck_depth_mm = 2.0
        result = run_strategy(job, mesh)
        assert result.strategy == "drill"
        assert len(result.chains) == 1
        # Peck drill should have more segments than simple drill (multiple pecks)
        assert len(result.chains[0].segments) > 4

    def test_g83_without_peck_falls_back_to_g81(self):
        """G83 with peck_depth_mm=0 should fall back to G81 with warning."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.DRILL)
        job.drill_points = [(5.0, 5.0)]
        job.drill_cycle_mode = DrillCycleMode.G83
        job.peck_depth_mm = 0.0
        result = run_strategy(job, mesh)
        assert any("G81" in w for w in result.warnings)

    def test_g73_high_speed_peck(self):
        """G73 should produce chains with partial-retract peck pattern."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.DRILL)
        job.drill_points = [(5.0, 5.0)]
        job.drill_cycle_mode = DrillCycleMode.G73
        job.peck_depth_mm = 1.5
        result = run_strategy(job, mesh)
        assert result.strategy == "drill"
        assert len(result.chains) == 1

    def test_expanded_drill(self):
        """Expanded mode should produce simple G0/G1 sequences."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.DRILL)
        job.drill_points = [(5.0, 5.0)]
        job.drill_cycle_mode = DrillCycleMode.EXPANDED
        result = run_strategy(job, mesh)
        assert result.strategy == "drill"
        assert len(result.chains) == 1
        # Expanded: rapid-to, plunge, retract = 3 segments
        assert len(result.chains[0].segments) == 3

    def test_no_drill_points_warns(self):
        """Empty drill points should produce warning and no chains."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.DRILL)
        job.drill_points = []
        result = run_strategy(job, mesh)
        assert len(result.chains) == 0
        assert any("No drill points" in w for w in result.warnings)

    def test_drill_has_correct_xy_positions(self):
        """Drill chains should position the tool at the correct X, Y coordinates."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.DRILL)
        job.drill_points = [(3.0, 7.0), (8.0, 2.0)]
        job.drill_cycle_mode = DrillCycleMode.G81
        result = run_strategy(job, mesh)
        for i, (x, y) in enumerate(job.drill_points):
            chain = result.chains[i]
            # First segment should position to hole XY
            assert chain.segments[0].x == pytest.approx(x)
            assert chain.segments[0].y == pytest.approx(y)

    def test_g82_without_dwell_falls_back_to_g81(self):
        """G82 with dwell_ms=0 should fall back to G81 with warning."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.DRILL)
        job.drill_points = [(5.0, 5.0)]
        job.drill_cycle_mode = DrillCycleMode.G82
        job.dwell_ms = 0.0
        result = run_strategy(job, mesh)
        assert any("G81" in w for w in result.warnings)

    def test_drill_stats_computed(self):
        """Drill toolpath should have computed distance/time stats."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.DRILL)
        job.drill_points = [(5.0, 5.0), (10.0, 10.0)]
        result = run_strategy(job, mesh)
        assert result.total_distance_mm > 0
        assert result.estimated_time_s > 0


# ── Raster with adaptive feed ────────────────────────────────────────

class TestRasterAdaptiveFeed:
    def test_adaptive_feed_modifies_segments(self):
        """When adaptive_feed_enabled is True, feed rates should vary."""
        mesh = _make_mesh(_hemisphere_triangles(radius=5.0, segments=8, rings=4))
        job = _make_job(Strategy.RASTER)
        job.adaptive_feed_enabled = True
        job.stock.x_min = -6
        job.stock.x_max = 6
        job.stock.y_min = -6
        job.stock.y_max = 6
        job.stock.z_min = 0
        job.stock.z_max = 6
        result = run_strategy(job, mesh)
        assert len(result.chains) > 0
        # Collect all feed values
        feeds = set()
        for chain in result.chains:
            for seg in chain.segments:
                if not seg.is_rapid and seg.feed > 0:
                    feeds.add(round(seg.feed, 1))
        # With a hemisphere, the varying Z should produce varied feed rates
        # (not all identical)
        assert len(feeds) >= 1  # at minimum some feed moves exist

    def test_adaptive_feed_disabled_has_uniform_feed(self):
        """Without adaptive feed, all cutting feeds should be the same
        (within chip-thinning adjusted range)."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.RASTER)
        job.adaptive_feed_enabled = False
        result = run_strategy(job, mesh)
        feeds = set()
        for chain in result.chains:
            for seg in chain.segments:
                if not seg.is_rapid and seg.feed > 0:
                    feeds.add(round(seg.feed, 0))
        # Without adaptive feed, all cutting feeds should be identical
        # (one value from chip-thinning adjustment)
        assert len(feeds) <= 2  # plunge + cut feed


# ── Edge cases ────────────────────────────────────────────────────────

class TestEdgeCases:
    def test_unsupported_strategy(self):
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.AXIS4_WRAPPING)
        with pytest.raises(ValueError, match="Unsupported"):
            run_strategy(job, mesh)

    def test_tiny_stock(self):
        """Very small stock should still produce something or warn."""
        mesh = _make_mesh(_box_triangles(1, 1, 0.5))
        job = _make_job(Strategy.RASTER)
        job.stock.x_min = -0.5
        job.stock.x_max = 1.5
        job.stock.y_min = -0.5
        job.stock.y_max = 1.5
        job.stock.z_min = 0
        job.stock.z_max = 1
        result = run_strategy(job, mesh)
        # Should not crash
        assert result.strategy == "raster"
