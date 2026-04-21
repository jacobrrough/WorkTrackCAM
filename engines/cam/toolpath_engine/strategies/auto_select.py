"""
Automatic strategy selection based on mesh geometry analysis.

Analyzes the mesh shape, surface curvature distribution, and aspect ratio
to recommend the optimal machining strategy. This eliminates guesswork
for operators and ensures the best surface finish / cycle time tradeoff.

Selection heuristics:
- Flat/shallow parts → raster (fast, good finish on gentle surfaces)
- Steep-walled parts → waterline (clean walls, no staircase)
- Complex mixed geometry → morphing_finish (auto-blend)
- Deep pockets/cavities → adaptive_clear (efficient roughing)
- Concave details after roughing → pencil (targeted cleanup)
- Smooth freeform → spiral_finish (continuous, minimal retracts)
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from ..models import Strategy, ToolpathJob

try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False


@dataclass
class GeometryAnalysis:
    """Results of mesh geometry analysis for strategy selection."""
    # Surface angle distribution (0=flat, 90=vertical)
    mean_angle_deg: float = 0.0
    steep_fraction: float = 0.0       # fraction of surface > 50°
    gentle_fraction: float = 0.0      # fraction of surface < 20°
    mixed_fraction: float = 0.0       # fraction between 20-50°

    # Shape metrics
    aspect_ratio_xy: float = 1.0      # width / depth in XY
    depth_to_width_ratio: float = 0.0 # Z range / max XY extent
    has_deep_pockets: bool = False     # Z depth > 2x tool diameter
    has_concave_regions: bool = False  # significant negative curvature

    # Complexity
    triangle_count: int = 0
    curvature_variance: float = 0.0   # high = complex freeform

    recommended_strategy: Strategy = Strategy.RASTER
    confidence: float = 0.0           # 0-1 confidence in recommendation
    reasoning: str = ""
    alternative_strategies: list[Strategy] = field(default_factory=list)


def analyze_mesh_for_strategy(job: ToolpathJob, mesh) -> GeometryAnalysis:
    """
    Analyze mesh geometry and recommend the best machining strategy.

    Args:
        job: The toolpath job specification
        mesh: Loaded Mesh object

    Returns:
        GeometryAnalysis with recommendation and supporting metrics
    """
    analysis = GeometryAnalysis()
    analysis.triangle_count = mesh.num_triangles
    bounds = mesh.bounds

    if mesh.num_triangles == 0:
        analysis.reasoning = "Empty mesh, defaulting to raster"
        return analysis

    # Compute shape metrics
    x_range = bounds.max_pt.x - bounds.min_pt.x
    y_range = bounds.max_pt.y - bounds.min_pt.y
    z_range = bounds.max_pt.z - bounds.min_pt.z
    max_xy = max(x_range, y_range, 0.001)
    min_xy = min(x_range, y_range, 0.001) if min(x_range, y_range) > 0 else 0.001

    analysis.aspect_ratio_xy = max_xy / min_xy
    analysis.depth_to_width_ratio = z_range / max_xy if max_xy > 0 else 0
    analysis.has_deep_pockets = z_range > 2.0 * job.tool.diameter_mm

    # Compute surface angle distribution
    if HAS_NUMPY:
        _analyze_surface_angles_numpy(mesh, analysis)
        _analyze_curvature_numpy(mesh, analysis, job.tool.radius)
    else:
        _analyze_surface_angles_pure(mesh, analysis)

    # Decision logic
    _select_strategy(analysis, job)

    return analysis


def _analyze_surface_angles_numpy(mesh, analysis: GeometryAnalysis) -> None:
    """Compute surface angle statistics using vectorized numpy."""
    normals = mesh.compute_face_normals_numpy()
    # Angle from Z-axis: acos(|nz|)
    nz_abs = np.abs(normals[:, 2])
    angles_deg = np.degrees(np.arccos(np.clip(nz_abs, 0.0, 1.0)))

    analysis.mean_angle_deg = float(np.mean(angles_deg))
    n = len(angles_deg)
    analysis.steep_fraction = float(np.sum(angles_deg > 50.0)) / n if n > 0 else 0
    analysis.gentle_fraction = float(np.sum(angles_deg < 20.0)) / n if n > 0 else 0
    analysis.mixed_fraction = 1.0 - analysis.steep_fraction - analysis.gentle_fraction


def _analyze_surface_angles_pure(mesh, analysis: GeometryAnalysis) -> None:
    """Pure-Python fallback for surface angle analysis."""
    steep_count = 0
    gentle_count = 0
    total_angle = 0.0
    n = mesh.num_triangles

    for i in range(n):
        v0, v1, v2 = mesh.get_triangle(i)
        # Cross product for face normal
        e1x, e1y, e1z = v1.x - v0.x, v1.y - v0.y, v1.z - v0.z
        e2x, e2y, e2z = v2.x - v0.x, v2.y - v0.y, v2.z - v0.z
        nz = e1x * e2y - e1y * e2x
        nx = e1y * e2z - e1z * e2y
        ny = e1z * e2x - e1x * e2z
        length = math.sqrt(nx * nx + ny * ny + nz * nz)
        if length < 1e-12:
            continue
        nz_abs = abs(nz / length)
        angle = math.degrees(math.acos(min(1.0, nz_abs)))
        total_angle += angle
        if angle > 50:
            steep_count += 1
        elif angle < 20:
            gentle_count += 1

    if n > 0:
        analysis.mean_angle_deg = total_angle / n
        analysis.steep_fraction = steep_count / n
        analysis.gentle_fraction = gentle_count / n
        analysis.mixed_fraction = 1.0 - analysis.steep_fraction - analysis.gentle_fraction


def _analyze_curvature_numpy(mesh, analysis: GeometryAnalysis, tool_radius: float) -> None:
    """Detect concave regions via vertex-neighborhood curvature variance."""
    if mesh.num_triangles < 10:
        return

    normals = mesh.compute_face_normals_numpy()
    # Curvature variance: high variance = complex freeform surface
    nz = normals[:, 2]
    analysis.curvature_variance = float(np.var(nz))

    # Detect concave regions: adjacent faces with diverging normals
    # Simple heuristic: if nz variance is high AND there are steep regions,
    # there are likely concave transitions
    if analysis.curvature_variance > 0.1 and analysis.steep_fraction > 0.1:
        analysis.has_concave_regions = True


def _select_strategy(analysis: GeometryAnalysis, job: ToolpathJob) -> None:
    """Select optimal strategy based on geometry analysis."""
    scores: dict[Strategy, float] = {}
    reasons: dict[Strategy, str] = {}

    # ADAPTIVE_CLEAR: best for roughing deep pockets
    roughing_score = 0.0
    if analysis.has_deep_pockets:
        roughing_score += 0.5
    roughing_score += analysis.depth_to_width_ratio * 0.3
    if analysis.steep_fraction > 0.3:
        roughing_score += 0.2
    scores[Strategy.ADAPTIVE_CLEAR] = roughing_score
    reasons[Strategy.ADAPTIVE_CLEAR] = "deep pockets, significant material removal needed"

    # WATERLINE: best for predominantly steep walls
    waterline_score = analysis.steep_fraction * 0.7
    if analysis.mean_angle_deg > 45:
        waterline_score += 0.3
    scores[Strategy.WATERLINE] = waterline_score
    reasons[Strategy.WATERLINE] = f"steep surfaces ({analysis.steep_fraction:.0%} > 50°)"

    # RASTER: best for gentle/flat surfaces
    raster_score = analysis.gentle_fraction * 0.6
    if analysis.mean_angle_deg < 30:
        raster_score += 0.3
    if analysis.depth_to_width_ratio < 0.3:
        raster_score += 0.1
    scores[Strategy.RASTER] = raster_score
    reasons[Strategy.RASTER] = f"gentle surfaces ({analysis.gentle_fraction:.0%} < 20°)"

    # STEEP_SHALLOW: best for mixed steep + flat geometry (replaces morphing for many cases)
    steep_shallow_score = 0.0
    if analysis.steep_fraction > 0.15 and analysis.gentle_fraction > 0.15:
        steep_shallow_score = 0.55  # Higher than morphing for truly mixed cases
    if analysis.mixed_fraction > 0.3:
        steep_shallow_score += 0.15
    scores[Strategy.STEEP_SHALLOW] = steep_shallow_score
    reasons[Strategy.STEEP_SHALLOW] = "mixed steep/gentle geometry benefits from automatic region-based strategy"

    # MORPHING_FINISH: similar to steep_shallow but with heuristic blending
    morphing_score = analysis.mixed_fraction * 0.4
    if analysis.steep_fraction > 0.15 and analysis.gentle_fraction > 0.15:
        morphing_score += 0.35
    if analysis.curvature_variance > 0.05:
        morphing_score += 0.2
    scores[Strategy.MORPHING_FINISH] = morphing_score
    reasons[Strategy.MORPHING_FINISH] = "mixed geometry with heuristic steep/raster blending"

    # SCALLOP: best for freeform surfaces requiring uniform finish quality
    scallop_score = 0.0
    if analysis.curvature_variance > 0.03 and analysis.mixed_fraction > 0.2:
        scallop_score = 0.5
    if analysis.gentle_fraction > 0.3 and analysis.steep_fraction > 0.1:
        scallop_score += 0.15
    scores[Strategy.SCALLOP] = scallop_score
    reasons[Strategy.SCALLOP] = "freeform surface requiring uniform scallop height"

    # SPIRAL_FINISH: best for smooth freeform with low curvature variance
    spiral_score = 0.0
    if analysis.curvature_variance < 0.05 and analysis.gentle_fraction > 0.5:
        spiral_score = 0.6
    if analysis.aspect_ratio_xy < 2.0:
        spiral_score += 0.1
    scores[Strategy.SPIRAL_FINISH] = spiral_score
    reasons[Strategy.SPIRAL_FINISH] = "smooth freeform surface, low curvature variance"

    # PENCIL: secondary cleanup, not primary
    pencil_score = 0.0
    if analysis.has_concave_regions:
        pencil_score = 0.3
    scores[Strategy.PENCIL] = pencil_score
    reasons[Strategy.PENCIL] = "concave regions detected for targeted cleanup"

    # 5-axis strategies: only if machine has 5th axis
    if job.machine.has_5th_axis:
        # FIVEAXIS_CONTOUR: best for complex 3D surfaces
        fiveaxis_score = 0.0
        if analysis.steep_fraction > 0.3 and analysis.mixed_fraction > 0.2:
            fiveaxis_score = 0.65
        if analysis.curvature_variance > 0.1:
            fiveaxis_score += 0.1
        scores[Strategy.FIVEAXIS_CONTOUR] = fiveaxis_score
        reasons[Strategy.FIVEAXIS_CONTOUR] = "complex 3D surface benefits from 5-axis normal-following"

        # FIVEAXIS_SWARF: best for predominantly steep/vertical walls
        swarf_score = analysis.steep_fraction * 0.6
        if analysis.mean_angle_deg > 55:
            swarf_score += 0.2
        scores[Strategy.FIVEAXIS_SWARF] = swarf_score
        reasons[Strategy.FIVEAXIS_SWARF] = "steep walls benefit from 5-axis swarf cutting"

    # 4-axis dispatch was removed in the April 2026 4-axis subsystem rewrite.
    # All 4-axis strategy generation now lives in the TypeScript engine at
    # `src/main/cam-axis4/`; the Python auto-selector only ranks the 3-axis
    # and 5-axis strategies it can actually run.

    # Select highest-scoring strategy
    best = max(scores, key=lambda s: scores[s])
    best_score = scores[best]

    sorted_scores = sorted(scores.values(), reverse=True)
    if len(sorted_scores) >= 2 and sorted_scores[0] > 0:
        margin = sorted_scores[0] - sorted_scores[1]
        analysis.confidence = min(1.0, margin / sorted_scores[0] + 0.3)
    else:
        analysis.confidence = 0.5

    if best_score < 0.15:
        best = Strategy.RASTER
        analysis.confidence = 0.4
        analysis.reasoning = "No strong geometry signal; raster is a safe default"
    else:
        analysis.reasoning = reasons[best]

    analysis.recommended_strategy = best

    analysis.alternative_strategies = [
        s for s, score in sorted(scores.items(), key=lambda x: -x[1])
        if s != best and score > best_score - 0.2 and score > 0.1
    ]
