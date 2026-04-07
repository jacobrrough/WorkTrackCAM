"""Toolpath generation strategies.

v4.0 — Full multi-axis strategy support with 14 strategies:
  3-axis:  adaptive_clear, waterline, raster, pencil, rest,
           spiral_finish, morphing_finish, trochoidal_hsm,
           steep_shallow, scallop
  4-axis:  axis4_continuous, axis4_indexed, axis4_wrapping
  5-axis:  5axis_contour, 5axis_swarf, 5axis_flowline
"""
from __future__ import annotations

from ..models import Strategy, ToolpathJob, ToolpathResult


def run_strategy(job: ToolpathJob, mesh) -> ToolpathResult:
    """Dispatch to the appropriate strategy based on job.strategy."""
    from .adaptive_clear import generate_adaptive_clear
    from .waterline import generate_waterline
    from .raster import generate_raster
    from .pencil import generate_pencil
    from .rest import generate_rest
    from .spiral_finish import generate_spiral_finish
    from .morphing_finish import generate_morphing_finish
    from .trochoidal_hsm import generate_trochoidal_hsm
    from .drill import generate_drill
    from .fiveaxis_contour import (
        generate_fiveaxis_contour,
        generate_fiveaxis_swarf,
        generate_fiveaxis_flowline,
    )

    dispatch = {
        Strategy.ADAPTIVE_CLEAR: generate_adaptive_clear,
        Strategy.WATERLINE: generate_waterline,
        Strategy.RASTER: generate_raster,
        Strategy.PENCIL: generate_pencil,
        Strategy.REST: generate_rest,
        Strategy.SPIRAL_FINISH: generate_spiral_finish,
        Strategy.MORPHING_FINISH: generate_morphing_finish,
        Strategy.TROCHOIDAL_HSM: generate_trochoidal_hsm,
        Strategy.DRILL: generate_drill,
        Strategy.FIVEAXIS_CONTOUR: generate_fiveaxis_contour,
        Strategy.FIVEAXIS_SWARF: generate_fiveaxis_swarf,
        Strategy.FIVEAXIS_FLOWLINE: generate_fiveaxis_flowline,
    }

    # Lazy-load new strategies (they may not exist yet during development)
    try:
        from .steep_shallow import generate_steep_shallow
        dispatch[Strategy.STEEP_SHALLOW] = generate_steep_shallow
    except ImportError:
        pass

    try:
        from .scallop_finish import generate_scallop
        dispatch[Strategy.SCALLOP] = generate_scallop
    except ImportError:
        pass

    try:
        from .axis4_continuous import generate_axis4_continuous
        dispatch[Strategy.AXIS4_CONTINUOUS] = generate_axis4_continuous
    except ImportError:
        pass

    func = dispatch.get(job.strategy)
    if func is None:
        raise ValueError(f"Unsupported strategy: {job.strategy.value}")

    return func(job, mesh)


def auto_select_and_run(job: ToolpathJob, mesh) -> ToolpathResult:
    """
    Analyze mesh geometry, auto-select the best strategy, then run it.
    """
    from .auto_select import analyze_mesh_for_strategy

    analysis = analyze_mesh_for_strategy(job, mesh)
    job.strategy = analysis.recommended_strategy

    result = run_strategy(job, mesh)
    result.warnings.insert(0, (
        f"Auto-selected strategy: {analysis.recommended_strategy.value} "
        f"(confidence={analysis.confidence:.0%}, reason: {analysis.reasoning})"
    ))
    if analysis.alternative_strategies:
        alts = ", ".join(s.value for s in analysis.alternative_strategies)
        result.warnings.append(f"Alternative strategies: {alts}")

    return result
