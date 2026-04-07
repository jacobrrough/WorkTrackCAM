"""Toolpath generation strategies."""
from __future__ import annotations

from ..models import Strategy, ToolpathJob, ToolpathResult
from .adaptive_clear import generate_adaptive_clear
from .waterline import generate_waterline
from .raster import generate_raster
from .pencil import generate_pencil
from .rest import generate_rest


def run_strategy(job: ToolpathJob, mesh) -> ToolpathResult:
    """Dispatch to the appropriate strategy based on job.strategy."""
    dispatch = {
        Strategy.ADAPTIVE_CLEAR: generate_adaptive_clear,
        Strategy.WATERLINE: generate_waterline,
        Strategy.RASTER: generate_raster,
        Strategy.PENCIL: generate_pencil,
        Strategy.REST: generate_rest,
    }

    func = dispatch.get(job.strategy)
    if func is None:
        raise ValueError(f"Unsupported strategy: {job.strategy.value}")

    return func(job, mesh)
