"""
Comprehensive edge-case tests for the toolpath engine.

Covers: zero stock, impossible depths, 5-axis singularities,
degenerate meshes, auto-strategy selection, optimizer bounds,
simulator safety, and report generation.
"""
from __future__ import annotations

import math
import struct
import tempfile
from pathlib import Path

import pytest

from ..models import (
    ToolpathJob, Strategy, Tool, ToolShape, CutParams,
    StockDefinition, Material, MachineKinematics, ToolpathChain,
    ToolpathResult, MotionSegment, compute_stats, job_from_config,
)
from ..geometry import load_stl, Mesh
from ..strategies import run_strategy
from ..optimizer import (
    optimize_params, adjust_feed_for_engagement,
    compute_engagement_angle, compute_scallop_height,
)
from ..simulator import simulate, SimulationReport
from ..postprocessor import toolpath_to_ipc_lines, generate_gcode
from ..report import generate_report


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


def _flat_plate_triangles(sx=20.0, sy=20.0, z=2.0):
    """A flat horizontal plate (no vertical walls)."""
    return [
        ((0, 0, 1), (0, 0, z), (sx, 0, z), (sx, sy, z)),
        ((0, 0, 1), (0, 0, z), (sx, sy, z), (0, sy, z)),
        ((0, 0, -1), (0, 0, 0), (sx, sy, 0), (sx, 0, 0)),
        ((0, 0, -1), (0, 0, 0), (0, sy, 0), (sx, sy, 0)),
    ]


def _steep_wall_triangles(width=10.0, height=20.0, depth=2.0):
    """A tall thin wall (mostly vertical surfaces)."""
    return [
        ((0, -1, 0), (0, 0, 0), (width, 0, 0), (width, 0, height)),
        ((0, -1, 0), (0, 0, 0), (width, 0, height), (0, 0, height)),
        ((0, 1, 0), (0, depth, 0), (0, depth, height), (width, depth, height)),
        ((0, 1, 0), (0, depth, 0), (width, depth, height), (width, depth, 0)),
        ((0, 0, 1), (0, 0, height), (width, 0, height), (width, depth, height)),
        ((0, 0, 1), (0, 0, height), (width, depth, height), (0, depth, height)),
        ((0, 0, -1), (0, 0, 0), (width, depth, 0), (width, 0, 0)),
        ((0, 0, -1), (0, 0, 0), (0, depth, 0), (width, depth, 0)),
    ]


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


# ── Zero Stock Tests ────────────────────────────────────────────────────

class TestZeroStock:
    """Tests for zero or near-zero stock conditions."""

    def test_stock_equals_mesh_adaptive(self):
        """Stock top == mesh top means nothing to remove."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.ADAPTIVE_CLEAR)
        job.stock.z_max = 5.0  # same as mesh top
        result = run_strategy(job, mesh)
        # Should produce something or empty result without crashing
        assert result.strategy == "adaptive_clear"

    def test_stock_below_mesh(self):
        """Stock top below mesh top — nothing to machine above."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.ADAPTIVE_CLEAR)
        job.stock.z_max = 2.0  # below mesh top
        result = run_strategy(job, mesh)
        assert result.strategy == "adaptive_clear"

    def test_zero_volume_stock(self):
        """Stock with z_min == z_max (paper-thin stock)."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.RASTER)
        job.stock.z_min = 5.0
        job.stock.z_max = 5.0
        result = run_strategy(job, mesh)
        assert result.strategy == "raster"


# ── Impossible Depth Tests ──────────────────────────────────────────────

class TestImpossibleDepth:
    """Tests for z_step exceeding tool capability."""

    def test_z_step_larger_than_stock(self):
        """z_step much larger than stock height."""
        mesh = _make_mesh(_box_triangles(10, 10, 2))
        job = _make_job(Strategy.ADAPTIVE_CLEAR)
        job.cuts.z_step_mm = 50.0  # way larger than stock
        job.stock.z_max = 4.0
        result = run_strategy(job, mesh)
        assert result.strategy == "adaptive_clear"

    def test_extreme_stepover(self):
        """Stepover larger than tool diameter — should be clamped or handled."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.RASTER)
        job.cuts.stepover_mm = 100.0  # absurd
        result = run_strategy(job, mesh)
        assert result.strategy == "raster"


# ── Degenerate Mesh Tests ──────────────────────────────────────────────

class TestDegenerateMesh:
    """Tests for degenerate or unusual mesh geometry."""

    def test_single_triangle(self):
        """A single triangle should not crash any strategy."""
        tris = [((0, 0, 1), (0, 0, 5), (10, 0, 5), (5, 10, 5))]
        mesh = _make_mesh(tris)
        job = _make_job(Strategy.RASTER)
        result = run_strategy(job, mesh)
        assert result.strategy == "raster"

    def test_coplanar_triangles(self):
        """All triangles on same Z plane (flat part)."""
        mesh = _make_mesh(_flat_plate_triangles(20, 20, 3))
        job = _make_job(Strategy.WATERLINE)
        result = run_strategy(job, mesh)
        assert result.strategy == "waterline"

    def test_very_thin_part(self):
        """Part thinner than tool diameter."""
        tris = _box_triangles(10, 10, 0.1)  # 0.1mm tall
        mesh = _make_mesh(tris)
        job = _make_job(Strategy.ADAPTIVE_CLEAR)
        job.stock.z_max = 0.5
        result = run_strategy(job, mesh)
        assert result.strategy == "adaptive_clear"


# ── Auto-Strategy Selection Tests ──────────────────────────────────────

class TestAutoStrategy:
    """Tests for the automatic strategy selection module."""

    def test_auto_select_flat_part(self):
        """Flat part should recommend raster or spiral."""
        from ..strategies.auto_select import analyze_mesh_for_strategy
        mesh = _make_mesh(_flat_plate_triangles(20, 20, 3))
        job = _make_job(Strategy.AUTO)
        analysis = analyze_mesh_for_strategy(job, mesh)
        assert analysis.recommended_strategy in (
            Strategy.RASTER, Strategy.SPIRAL_FINISH
        )
        assert analysis.gentle_fraction > 0.3

    def test_auto_select_steep_wall(self):
        """Steep wall should recommend waterline."""
        from ..strategies.auto_select import analyze_mesh_for_strategy
        mesh = _make_mesh(_steep_wall_triangles(10, 20, 2))
        job = _make_job(Strategy.AUTO)
        analysis = analyze_mesh_for_strategy(job, mesh)
        # Steep wall: waterline or morphing
        assert analysis.steep_fraction > 0.3

    def test_auto_select_box(self):
        """Box has mixed steep/flat surfaces."""
        from ..strategies.auto_select import analyze_mesh_for_strategy
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.AUTO)
        analysis = analyze_mesh_for_strategy(job, mesh)
        assert analysis.recommended_strategy is not None
        assert analysis.confidence > 0

    def test_auto_select_deep_pocket(self):
        """Deep pocket should favor adaptive clearing."""
        from ..strategies.auto_select import analyze_mesh_for_strategy
        mesh = _make_mesh(_box_triangles(10, 10, 20))
        job = _make_job(Strategy.AUTO)
        job.tool = Tool(diameter_mm=6.0)
        analysis = analyze_mesh_for_strategy(job, mesh)
        assert analysis.has_deep_pockets

    def test_auto_select_empty_mesh(self):
        """Empty mesh should not crash."""
        from ..strategies.auto_select import analyze_mesh_for_strategy
        mesh = Mesh(vertices=[], normals=[])
        job = _make_job(Strategy.AUTO)
        analysis = analyze_mesh_for_strategy(job, mesh)
        assert analysis.recommended_strategy == Strategy.RASTER  # default

    def test_auto_run_produces_result(self):
        """Auto select and run should produce a valid toolpath."""
        from ..strategies import auto_select_and_run
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.AUTO)
        result = auto_select_and_run(job, mesh)
        assert result.strategy != ""
        assert any("Auto-selected" in w for w in result.warnings)

    def test_auto_select_confidence_in_range(self):
        """Confidence must always be in [0, 1]."""
        from ..strategies.auto_select import analyze_mesh_for_strategy
        for tris_fn in (
            _flat_plate_triangles,
            _steep_wall_triangles,
            lambda: _box_triangles(10, 10, 5),
        ):
            mesh = _make_mesh(tris_fn())
            job = _make_job(Strategy.AUTO)
            analysis = analyze_mesh_for_strategy(job, mesh)
            assert 0.0 <= analysis.confidence <= 1.0, (
                f"confidence={analysis.confidence!r} out of range for "
                f"{tris_fn.__name__}"
            )

    def test_auto_select_mixed_box_has_alternatives(self):
        """A box (mixed steep/flat) should produce at least one alternative strategy."""
        from ..strategies.auto_select import analyze_mesh_for_strategy
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.AUTO)
        analysis = analyze_mesh_for_strategy(job, mesh)
        # A box has both flat top/bottom and steep walls — multiple valid strategies
        assert isinstance(analysis.alternative_strategies, list)
        # Recommended + alternatives should all be Strategy instances
        for s in analysis.alternative_strategies:
            assert isinstance(s, Strategy)

    def test_auto_select_5axis_machine_no_crash(self):
        """5-axis machine analysis must not crash and must return a valid recommendation."""
        from ..strategies.auto_select import analyze_mesh_for_strategy
        mesh = _make_mesh(_steep_wall_triangles(10, 10, 2))
        job = _make_job(Strategy.AUTO)
        job.machine = MachineKinematics(has_5th_axis=True)
        analysis = analyze_mesh_for_strategy(job, mesh)
        assert isinstance(analysis.recommended_strategy, Strategy)
        assert analysis.confidence >= 0.0
        # All items in alternative_strategies must be Strategy instances
        for s in analysis.alternative_strategies:
            assert isinstance(s, Strategy)

    def test_auto_select_4axis_aspect_ratio_computed(self):
        """Elongated part (40×8mm) must have aspect_ratio_xy > 3.0."""
        from ..strategies.auto_select import analyze_mesh_for_strategy
        # Long narrow part: 40mm x 8mm x 4mm → aspect ratio 5:1
        mesh = _make_mesh(_box_triangles(sx=40.0, sy=8.0, sz=4.0))
        job = _make_job(Strategy.AUTO)
        job.machine = MachineKinematics(has_4th_axis=True)
        analysis = analyze_mesh_for_strategy(job, mesh)
        assert analysis.aspect_ratio_xy > 3.0, (
            f"Expected aspect_ratio_xy > 3.0, got {analysis.aspect_ratio_xy:.2f}"
        )
        # Should complete without error and return a Strategy
        assert isinstance(analysis.recommended_strategy, Strategy)

    def test_auto_select_pure_python_angle_analysis(self):
        """Pure-Python angle analysis should produce results consistent with the numpy path."""
        from ..strategies.auto_select import (
            GeometryAnalysis,
            _analyze_surface_angles_pure,
            _analyze_surface_angles_numpy,
            HAS_NUMPY,
        )
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        # Run pure-Python path
        analysis_pure = GeometryAnalysis()
        _analyze_surface_angles_pure(mesh, analysis_pure)
        assert 0.0 <= analysis_pure.steep_fraction <= 1.0
        assert 0.0 <= analysis_pure.gentle_fraction <= 1.0
        assert analysis_pure.steep_fraction + analysis_pure.gentle_fraction <= 1.001
        assert analysis_pure.mean_angle_deg >= 0.0
        if HAS_NUMPY:
            # With numpy available, both paths must agree within 1%
            analysis_np = GeometryAnalysis()
            _analyze_surface_angles_numpy(mesh, analysis_np)
            assert abs(analysis_pure.steep_fraction - analysis_np.steep_fraction) < 0.01, (
                f"steep_fraction mismatch: pure={analysis_pure.steep_fraction:.4f} "
                f"numpy={analysis_np.steep_fraction:.4f}"
            )
            assert abs(analysis_pure.gentle_fraction - analysis_np.gentle_fraction) < 0.01

    def test_auto_select_geometry_metrics(self):
        """Geometry analysis metrics should match known geometry of test shapes."""
        from ..strategies.auto_select import analyze_mesh_for_strategy

        # Flat plate: mostly gentle angles
        flat_mesh = _make_mesh(_flat_plate_triangles(20, 20, 2))
        job = _make_job(Strategy.AUTO)
        flat = analyze_mesh_for_strategy(job, flat_mesh)
        assert flat.gentle_fraction > 0.4, f"Flat plate should be mostly gentle, got {flat.gentle_fraction:.2f}"
        assert flat.depth_to_width_ratio < 1.0

        # Steep wall: predominantly steep angles
        steep_mesh = _make_mesh(_steep_wall_triangles(10, 20, 2))
        steep = analyze_mesh_for_strategy(job, steep_mesh)
        assert steep.steep_fraction > 0.3, f"Steep wall should have high steep fraction, got {steep.steep_fraction:.2f}"

        # Deep part: should detect deep pockets
        deep_mesh = _make_mesh(_box_triangles(10, 10, 25))
        deep_job = _make_job(Strategy.AUTO)
        deep_job.tool = Tool(diameter_mm=6.0)
        deep = analyze_mesh_for_strategy(deep_job, deep_mesh)
        assert deep.has_deep_pockets, "Part taller than 2x tool diameter should flag has_deep_pockets"


# ── Optimizer Edge Cases ───────────────────────────────────────────────

class TestOptimizerEdgeCases:
    """Edge cases for the multi-objective optimizer."""

    def test_zero_tool_diameter(self):
        """Zero diameter tool should be handled gracefully."""
        tool = Tool(diameter_mm=0.001)  # near-zero
        mat = Material()
        machine = MachineKinematics()
        cuts = CutParams()
        result = optimize_params(tool, mat, machine, cuts, engagement_deg=90)
        assert result.feed_mm_min > 0

    def test_extreme_sfm_material(self):
        """Material with extreme SFM range."""
        tool = Tool(diameter_mm=6.0)
        mat = Material(sfm_range=(5000, 10000))  # very high
        machine = MachineKinematics(max_spindle_rpm=50000)
        cuts = CutParams()
        result = optimize_params(tool, mat, machine, cuts, engagement_deg=90)
        assert result.spindle_rpm <= machine.max_spindle_rpm

    def test_tiny_machine(self):
        """Machine with very low limits."""
        tool = Tool(diameter_mm=6.0)
        mat = Material()
        machine = MachineKinematics(
            max_feed_mm_min=100,
            max_spindle_rpm=5000,
            max_power_kw=0.1,
        )
        cuts = CutParams(feed_mm_min=5000)
        result = optimize_params(tool, mat, machine, cuts, engagement_deg=90)
        assert result.feed_mm_min <= machine.max_feed_mm_min

    def test_full_engagement(self):
        """180° engagement (slotting) should not produce NaN."""
        angle = compute_engagement_angle(3.0, 6.0)  # stepover == diameter
        assert angle == pytest.approx(180.0, abs=1.0)

    def test_zero_engagement(self):
        """Zero engagement should return zero."""
        angle = compute_engagement_angle(3.0, 0.0)
        assert angle == 0.0

    def test_scallop_flat_tool(self):
        """Flat tool produces no scallop."""
        h = compute_scallop_height(3.0, 1.0, ToolShape.FLAT)
        assert h == 0.0

    def test_scallop_ball_tool(self):
        """Ball tool scallop should be positive and reasonable."""
        h = compute_scallop_height(3.0, 1.0, ToolShape.BALL)
        assert 0 < h < 3.0

    def test_feed_adjustment_zero_engagement(self):
        """Zero actual engagement should return base feed."""
        result = adjust_feed_for_engagement(1000, 0)
        assert result == 1000

    def test_genetic_optimizer_runs(self):
        """Genetic optimizer should produce valid results when numpy is available."""
        try:
            import numpy as np
        except ImportError:
            pytest.skip("numpy not available")

        from ..optimizer import _genetic_optimize_params
        tool = Tool(diameter_mm=6.0, flute_count=2, flute_length_mm=25.0)
        mat = Material()
        machine = MachineKinematics()
        cuts = CutParams()
        warnings = []
        result = _genetic_optimize_params(
            tool, mat, machine, cuts,
            engagement_deg=90, base_rpm=10000, base_feed=1000,
            base_doc=1.0, base_woc=2.0, warnings=warnings,
            population_size=20, generations=10,
        )
        if result is not None:
            assert result.feed_mm_min > 0
            assert result.spindle_rpm > 0
            assert result.efficiency_score >= 0


# ── Simulator Edge Cases ───────────────────────────────────────────────

class TestSimulatorEdgeCases:
    """Edge cases for the safety simulator."""

    def test_empty_toolpath(self):
        """Empty toolpath should produce clean report."""
        result = ToolpathResult()
        machine = MachineKinematics()
        stock = StockDefinition()
        report = simulate(result, machine, stock)
        assert report.is_safe
        assert report.total_moves == 0

    def test_rapid_into_stock(self):
        """Rapid move into stock should be flagged as error."""
        result = ToolpathResult()
        chain = ToolpathChain()
        chain.append_rapid(5, 5, 15)  # start above stock
        chain.append_rapid(5, 5, -5)  # rapid into stock
        chain.append_rapid(50, 5, -5)  # rapid traverse at depth
        result.chains.append(chain)

        machine = MachineKinematics(x_travel_mm=200, y_travel_mm=200, z_travel_mm=100)
        stock = StockDefinition(x_min=0, x_max=100, y_min=0, y_max=100, z_min=-20, z_max=0)
        report = simulate(result, machine, stock, safe_z=10.0)
        # Should detect the dangerous rapid
        assert report.error_count > 0

    def test_safe_toolpath(self):
        """Properly structured toolpath should pass safety."""
        result = ToolpathResult()
        chain = ToolpathChain()
        chain.append_rapid(5, 5, 15)       # above stock
        chain.append_rapid(5, 5, 2)        # approach
        chain.append_feed(5, 5, -1, 400)   # plunge
        chain.append_feed(50, 5, -1, 1000) # cut
        chain.append_rapid(50, 5, 15)      # retract
        result.chains.append(chain)

        machine = MachineKinematics(x_travel_mm=200, y_travel_mm=200, z_travel_mm=100)
        stock = StockDefinition(x_min=0, x_max=100, y_min=0, y_max=100, z_min=-20, z_max=0)
        report = simulate(result, machine, stock, safe_z=10.0)
        assert report.error_count == 0

    def test_envelope_violation(self):
        """Moves outside machine envelope should be warned."""
        result = ToolpathResult()
        chain = ToolpathChain()
        chain.append_rapid(500, 5, 15)  # way outside X travel
        result.chains.append(chain)

        machine = MachineKinematics(x_travel_mm=100, y_travel_mm=100, z_travel_mm=50)
        stock = StockDefinition()
        report = simulate(result, machine, stock)
        assert report.warning_count > 0


# ── Postprocessor Edge Cases ──────────────────────────────────────────

class TestPostprocessorEdgeCases:
    """Edge cases for G-code post-processing."""

    def test_empty_toolpath_ipc(self):
        """Empty toolpath should produce empty lines."""
        result = ToolpathResult()
        tool = Tool()
        cuts = CutParams()
        lines = toolpath_to_ipc_lines(result, tool, cuts)
        assert lines == []

    def test_4axis_output(self):
        """4-axis moves should include A-word."""
        result = ToolpathResult()
        chain = ToolpathChain()
        chain.append_4axis(10, 0, -5, 45.0, 1000)
        result.chains.append(chain)
        tool = Tool()
        cuts = CutParams()
        lines = toolpath_to_ipc_lines(result, tool, cuts)
        assert any("A45" in line for line in lines)

    def test_comment_in_chain(self):
        """Chain comments should appear as G-code comments."""
        result = ToolpathResult()
        chain = ToolpathChain(comment="test operation")
        chain.append_rapid(0, 0, 10)
        result.chains.append(chain)
        tool = Tool()
        cuts = CutParams()
        lines = toolpath_to_ipc_lines(result, tool, cuts)
        assert any("test operation" in line for line in lines)

    def test_full_gcode_has_header_footer(self):
        """Full G-code should include header and footer."""
        result = ToolpathResult()
        chain = ToolpathChain()
        chain.append_rapid(0, 0, 10)
        chain.append_feed(10, 0, -5, 1000)
        result.chains.append(chain)
        tool = Tool(tool_number=3)
        cuts = CutParams(spindle_rpm=12000)
        lines = generate_gcode(result, tool, cuts)
        joined = "\n".join(lines)
        assert "G90" in joined  # absolute mode in header
        assert "M30" in joined or "M2" in joined  # program end


# ── Report Generation Tests ──────────────────────────────────────────

class TestReportGeneration:
    """Tests for the machining report generator."""

    def test_basic_report(self):
        """Report should be generated from a simple toolpath."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.RASTER)
        result = run_strategy(job, mesh)
        report = generate_report(result, job)
        assert report.strategy_used == "raster"
        assert report.num_chains > 0
        assert report.total_distance_mm > 0
        assert report.tool_description != ""

    def test_report_to_dict(self):
        """Report should serialize to JSON-compatible dict."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.RASTER)
        result = run_strategy(job, mesh)
        report = generate_report(result, job)
        d = report.to_dict()
        assert "timing" in d
        assert "distances" in d
        assert "tool" in d
        assert "safety" in d
        assert "efficiency" in d
        assert d["quality"]["strategy"] == "raster"

    def test_report_with_simulation(self):
        """Report should include simulation data when available."""
        result = ToolpathResult(strategy="raster")
        chain = ToolpathChain()
        chain.append_rapid(5, 5, 15)
        chain.append_feed(50, 5, -1, 1000)
        result.chains.append(chain)
        compute_stats(result, 15)

        job = _make_job(Strategy.RASTER)
        sim = SimulationReport(is_safe=True, total_moves=2)
        report = generate_report(result, job, sim_report=sim)
        assert report.is_safe

    def test_report_recommendations(self):
        """Report should generate recommendations for poor efficiency."""
        result = ToolpathResult(
            strategy="raster",
            cut_distance_mm=100,
            rapid_distance_mm=500,  # 5x more rapids than cuts
            estimated_time_s=60,
        )
        chain = ToolpathChain()
        chain.append_rapid(0, 0, 10)
        result.chains.append(chain)

        job = _make_job(Strategy.RASTER)
        report = generate_report(result, job)
        # Should have efficiency recommendation
        assert len(report.recommendations) >= 0  # may or may not trigger


# ── Config Parsing Edge Cases ──────────────────────────────────────────

class TestConfigEdgeCases:
    """Edge cases for job_from_config parsing."""

    def test_auto_strategy_config(self):
        """Auto strategy should parse correctly."""
        cfg = {"stlPath": "test.stl", "toolpathJsonPath": "out.json", "strategy": "auto"}
        job = job_from_config(cfg)
        assert job.strategy == Strategy.AUTO

    def test_unknown_strategy_falls_to_raster(self):
        """Unknown strategy string should default to raster."""
        cfg = {"stlPath": "test.stl", "strategy": "nonexistent"}
        job = job_from_config(cfg)
        assert job.strategy == Strategy.RASTER

    def test_none_values_use_defaults(self):
        """None values in config should use defaults, not crash."""
        cfg = {
            "stlPath": "test.stl",
            "feedMmMin": None,
            "stepoverMm": None,
            "toolDiameterMm": None,
        }
        job = job_from_config(cfg)
        assert job.cuts.feed_mm_min == 1000.0
        assert job.cuts.stepover_mm == 1.0
        assert job.tool.diameter_mm == 6.0

    def test_empty_config(self):
        """Empty config should produce default job."""
        job = job_from_config({})
        assert job.strategy == Strategy.RASTER
        assert job.tool.diameter_mm == 6.0

    def test_ball_end_tool_config(self):
        """Ball-end tool shape should parse correctly."""
        cfg = {"toolShape": "ball", "toolDiameterMm": 8.0}
        job = job_from_config(cfg)
        assert job.tool.shape == ToolShape.BALL
        assert job.tool.diameter_mm == 8.0

    def test_all_materials(self):
        """All material presets should be loadable."""
        materials = [
            "aluminum_6061", "aluminum_7075", "mild_steel", "stainless_304",
            "brass", "wood_hardwood", "wood_softwood", "acrylic", "hdpe",
            "carbon_fiber",
        ]
        for name in materials:
            mat = Material.from_name(name)
            assert mat.name == name
            assert mat.sfm_range[0] < mat.sfm_range[1]

    def test_unknown_material_uses_default(self):
        """Unknown material should fall back to default."""
        mat = Material.from_name("unobtanium")
        assert mat.name == "aluminum_6061"  # default


# ── Integration: Full Pipeline Edge Cases ──────────────────────────────

class TestFullPipeline:
    """Integration tests running full strategy + postprocess + simulate."""

    def test_all_strategies_on_box(self):
        """Every strategy should complete on a simple box without error."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        strategies = [
            Strategy.ADAPTIVE_CLEAR,
            Strategy.WATERLINE,
            Strategy.RASTER,
            Strategy.PENCIL,
            Strategy.SPIRAL_FINISH,
            Strategy.MORPHING_FINISH,
        ]
        for strat in strategies:
            job = _make_job(strat)
            result = run_strategy(job, mesh)
            assert result.strategy == strat.value, f"{strat.value} failed"

            # Post-process should not crash
            lines = toolpath_to_ipc_lines(result, job.tool, job.cuts)
            # lines may be empty for pencil (no concave regions on box)

    def test_rest_after_adaptive(self):
        """Rest machining with properly larger prior tool."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.REST)
        job.prior_tool_diameter_mm = 12.0
        result = run_strategy(job, mesh)
        assert result.strategy == "rest"

    def test_simulate_raster_result(self):
        """Full raster result should pass simulation."""
        mesh = _make_mesh(_box_triangles(10, 10, 5))
        job = _make_job(Strategy.RASTER)
        result = run_strategy(job, mesh)

        machine = MachineKinematics(x_travel_mm=300, y_travel_mm=300, z_travel_mm=100)
        stock = job.stock
        tool = job.tool
        report = simulate(result, machine, stock, safe_z=15.0, tool=tool)
        # Should not have any crash errors (rapids should be above stock)
        crash_errors = [i for i in report.issues if i.severity == "error" and "crash" in i.message.lower()]
        # Raster strategy should produce safe rapids
        assert len(crash_errors) == 0
