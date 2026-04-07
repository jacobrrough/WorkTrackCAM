"""
Enhanced toolpath simulator with heightfield-based material tracking.

Checks:
- Machine envelope violations
- Rapid moves through material (crash detection via stock heightfield)
- Feed rate limits
- Safe retract heights
- Z-depth violations
- Tool holder collisions (simplified)
- Air-cut detection (cutting above remaining stock)
- Material removal rate tracking

Maintains a stock heightfield that is carved by each cutting move,
enabling accurate rapid-crash detection even after partial machining.

Returns a detailed report with issues, statistics, and safety verdict.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from .models import MachineKinematics, ToolpathResult, StockDefinition, Tool

try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False


@dataclass
class SimulationIssue:
    """A detected safety or quality issue."""
    severity: str  # "error", "warning", "info"
    message: str
    chain_index: int = -1
    segment_index: int = -1
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0


@dataclass
class SimulationReport:
    """Results of toolpath simulation."""
    issues: list[SimulationIssue] = field(default_factory=list)
    is_safe: bool = True
    total_moves: int = 0
    rapid_moves: int = 0
    feed_moves: int = 0
    max_feed: float = 0.0
    min_z: float = 0.0
    max_z: float = 0.0
    total_cut_distance_mm: float = 0.0
    total_rapid_distance_mm: float = 0.0
    air_cut_distance_mm: float = 0.0
    estimated_mrr_cm3_min: float = 0.0
    estimated_power_kw: float = 0.0
    material_removed_cm3: float = 0.0

    @property
    def error_count(self) -> int:
        return sum(1 for i in self.issues if i.severity == "error")

    @property
    def warning_count(self) -> int:
        return sum(1 for i in self.issues if i.severity == "warning")


def simulate(
    result: ToolpathResult,
    machine: MachineKinematics,
    stock: StockDefinition,
    safe_z: float = 10.0,
    tool: Tool | None = None,
) -> SimulationReport:
    """
    Run comprehensive safety simulation on a toolpath result.

    When numpy is available, maintains a stock heightfield that tracks
    material removal, enabling accurate rapid-crash detection even
    after partial machining has lowered the stock surface.
    """
    report = SimulationReport()

    # Build stock heightfield for material tracking
    stock_hf = _build_stock_heightfield(stock, tool)
    tool_r = tool.radius if tool else 0.0

    prev_x, prev_y, prev_z = 0.0, 0.0, safe_z

    for ci, chain in enumerate(result.chains):
        for si, seg in enumerate(chain.segments):
            report.total_moves += 1

            if seg.is_rapid:
                report.rapid_moves += 1
            else:
                report.feed_moves += 1
                if seg.feed > report.max_feed:
                    report.max_feed = seg.feed

            # Track Z bounds
            if seg.z < report.min_z:
                report.min_z = seg.z
            if seg.z > report.max_z:
                report.max_z = seg.z

            # Distance tracking
            d = math.sqrt(
                (seg.x - prev_x) ** 2 + (seg.y - prev_y) ** 2 + (seg.z - prev_z) ** 2
            )
            if seg.is_rapid:
                report.total_rapid_distance_mm += d
            else:
                report.total_cut_distance_mm += d

                # Air-cut detection using stock heightfield
                if stock_hf is not None:
                    stock_z = _sample_stock_z(stock_hf, seg.x, seg.y, stock)
                    prev_stock_z = _sample_stock_z(stock_hf, prev_x, prev_y, stock)
                    if seg.z > stock_z + 0.1 and prev_z > prev_stock_z + 0.1:
                        report.air_cut_distance_mm += d
                elif seg.z > stock.z_max + 0.1 and prev_z > stock.z_max + 0.1:
                    report.air_cut_distance_mm += d

                # Carve stock heightfield for feed moves
                if stock_hf is not None:
                    _carve_stock(stock_hf, prev_x, prev_y, seg.x, seg.y,
                                 min(prev_z, seg.z), tool_r, stock)

            # Check 1: Machine envelope
            _check_envelope(report, seg.x, seg.y, seg.z, machine, ci, si)

            # Check 2: Rapid into material (using tracked stock surface)
            if seg.is_rapid:
                _check_rapid_safety(
                    report, prev_x, prev_y, prev_z,
                    seg.x, seg.y, seg.z,
                    stock, safe_z, ci, si,
                    stock_hf=stock_hf,
                )

            # Check 3: Excessive feed
            if not seg.is_rapid and seg.feed > machine.max_feed_mm_min:
                report.issues.append(SimulationIssue(
                    severity="warning",
                    message=f"Feed {seg.feed:.0f} exceeds machine max {machine.max_feed_mm_min:.0f} mm/min",
                    chain_index=ci, segment_index=si,
                    x=seg.x, y=seg.y, z=seg.z,
                ))

            # Check 4: Z depth violation (below Z travel)
            if seg.z < -machine.z_travel_mm:
                report.issues.append(SimulationIssue(
                    severity="error",
                    message=f"Z={seg.z:.1f} exceeds Z travel limit ({machine.z_travel_mm:.0f}mm)",
                    chain_index=ci, segment_index=si,
                    x=seg.x, y=seg.y, z=seg.z,
                ))

            # Check 5: Tool holder collision
            if tool and tool.effective_holder_diameter > tool.diameter_mm:
                _check_holder_collision(
                    report, seg.x, seg.y, seg.z,
                    tool, stock, ci, si,
                )

            prev_x, prev_y, prev_z = seg.x, seg.y, seg.z

    # Compute MRR and power estimates from material removed via stock heightfield
    if stock_hf is not None and tool is not None and HAS_NUMPY:
        initial_volume = float(np.sum(stock_hf.max() - stock_hf) * 0) if False else 0.0
        # Approximate material removed from carved heightfield cells
        original_z_max = stock.z_max
        cells_carved = np.sum(stock_hf < original_z_max - 0.01)
        if cells_carved > 0:
            dx_hf = (stock.x_max - stock.x_min) / max(stock_hf.shape[1], 1)
            dy_hf = (stock.y_max - stock.y_min) / max(stock_hf.shape[0], 1)
            cell_area_mm2 = dx_hf * dy_hf
            depth_sum = float(np.sum(np.maximum(0.0, original_z_max - stock_hf)))
            report.material_removed_cm3 = depth_sum * cell_area_mm2 / 1000.0  # mm^3 -> cm^3

        # Estimate MRR from material removed and cut time
        if report.total_cut_distance_mm > 0 and report.max_feed > 0:
            avg_feed = report.max_feed * 0.7  # estimate avg feed
            cut_time_min = report.total_cut_distance_mm / avg_feed
            if cut_time_min > 0:
                report.estimated_mrr_cm3_min = report.material_removed_cm3 / cut_time_min

        # Estimate power from MRR and material specific cutting energy
        # Default kc for aluminum: ~800 N/mm²
        kc = 800.0  # N/mm²
        mrr_mm3_s = report.estimated_mrr_cm3_min * 1000.0 / 60.0
        report.estimated_power_kw = mrr_mm3_s * kc / 1e6

    # Check for excessive air-cutting (efficiency warning)
    if report.total_cut_distance_mm > 0:
        air_fraction = report.air_cut_distance_mm / report.total_cut_distance_mm
        if air_fraction > 0.3:
            report.issues.append(SimulationIssue(
                severity="warning",
                message=(
                    f"Excessive air-cutting: {air_fraction:.0%} of cut distance "
                    f"({report.air_cut_distance_mm:.0f}mm) is above stock surface. "
                    "Consider tighter stock bounds or rest machining."
                ),
            ))

    report.is_safe = report.error_count == 0
    return report


# ── Stock heightfield tracking ─────────────────────────────────────────

def _build_stock_heightfield(stock: StockDefinition, tool: Tool | None):
    """Build a 2D grid initialized to stock.z_max for material tracking."""
    if not HAS_NUMPY:
        return None
    resolution = 1.0  # 1mm grid for simulation (fast, adequate accuracy)
    nx = max(1, int(math.ceil((stock.x_max - stock.x_min) / resolution)))
    ny = max(1, int(math.ceil((stock.y_max - stock.y_min) / resolution)))
    # Cap at 500k cells for simulation speed
    if nx * ny > 500_000:
        scale = math.sqrt(500_000 / (nx * ny))
        nx = max(1, int(nx * scale))
        ny = max(1, int(ny * scale))
    return np.full((ny, nx), stock.z_max, dtype=np.float64)


def _sample_stock_z(stock_hf, x: float, y: float, stock: StockDefinition) -> float:
    """Sample the stock heightfield at world coordinates."""
    if stock_hf is None:
        return stock.z_max
    ny, nx = stock_hf.shape
    dx = (stock.x_max - stock.x_min) / nx if nx > 1 else 1.0
    dy = (stock.y_max - stock.y_min) / ny if ny > 1 else 1.0
    ix = int((x - stock.x_min) / dx)
    iy = int((y - stock.y_min) / dy)
    ix = max(0, min(ix, nx - 1))
    iy = max(0, min(iy, ny - 1))
    return float(stock_hf[iy, ix])


def _carve_stock(
    stock_hf, x1: float, y1: float, x2: float, y2: float,
    z: float, tool_r: float, stock: StockDefinition,
) -> None:
    """
    Carve the stock heightfield along a linear tool move.

    Uses vectorized numpy slicing to update affected cells in one operation,
    avoiding Python-level nested loops for better performance on large grids.
    """
    if stock_hf is None:
        return
    ny, nx = stock_hf.shape
    dx = (stock.x_max - stock.x_min) / nx if nx > 1 else 1.0
    dy = (stock.y_max - stock.y_min) / ny if ny > 1 else 1.0

    # Determine affected grid cells (tool footprint along move)
    xmin = min(x1, x2) - tool_r
    xmax = max(x1, x2) + tool_r
    ymin = min(y1, y2) - tool_r
    ymax = max(y1, y2) + tool_r

    ix_lo = max(0, int((xmin - stock.x_min) / dx))
    ix_hi = min(nx, int((xmax - stock.x_min) / dx) + 1)
    iy_lo = max(0, int((ymin - stock.y_min) / dy))
    iy_hi = min(ny, int((ymax - stock.y_min) / dy) + 1)

    if ix_hi <= ix_lo or iy_hi <= iy_lo:
        return

    # Vectorized: clamp entire sub-grid to z in one numpy operation
    if HAS_NUMPY:
        region = stock_hf[iy_lo:iy_hi, ix_lo:ix_hi]
        np.minimum(region, z, out=region)
    else:
        for iy in range(iy_lo, iy_hi):
            for ix in range(ix_lo, ix_hi):
                if stock_hf[iy, ix] > z:
                    stock_hf[iy, ix] = z


def _check_envelope(
    report: SimulationReport,
    x: float, y: float, z: float,
    machine: MachineKinematics,
    ci: int, si: int,
) -> None:
    half_x = machine.x_travel_mm / 2
    half_y = machine.y_travel_mm / 2

    if abs(x) > half_x + 10:
        report.issues.append(SimulationIssue(
            severity="warning",
            message=f"X={x:.1f} may exceed X travel ({machine.x_travel_mm:.0f}mm)",
            chain_index=ci, segment_index=si, x=x, y=y, z=z,
        ))
    if abs(y) > half_y + 10:
        report.issues.append(SimulationIssue(
            severity="warning",
            message=f"Y={y:.1f} may exceed Y travel ({machine.y_travel_mm:.0f}mm)",
            chain_index=ci, segment_index=si, x=x, y=y, z=z,
        ))


def _check_rapid_safety(
    report: SimulationReport,
    x1: float, y1: float, z1: float,
    x2: float, y2: float, z2: float,
    stock: StockDefinition,
    safe_z: float,
    ci: int, si: int,
    stock_hf=None,
) -> None:
    min_z = min(z1, z2)
    if min_z >= safe_z - 0.1:
        return

    xy_dist = math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
    if xy_dist < 0.5:
        return

    within_stock = (
        min(x1, x2) < stock.x_max and max(x1, x2) > stock.x_min
        and min(y1, y2) < stock.y_max and max(y1, y2) > stock.y_min
    )

    if not within_stock:
        return

    # Use tracked stock surface when available (more accurate after machining)
    if stock_hf is not None:
        stock_z_at_dest = _sample_stock_z(stock_hf, x2, y2, stock)
        stock_z_at_src = _sample_stock_z(stock_hf, x1, y1, stock)
        effective_stock_top = max(stock_z_at_dest, stock_z_at_src)
    else:
        effective_stock_top = stock.z_max

    if min_z < effective_stock_top:
        report.issues.append(SimulationIssue(
            severity="error",
            message=(
                f"Rapid move at Z={min_z:.1f} with XY travel {xy_dist:.1f}mm "
                f"within stock bounds (stock top={effective_stock_top:.1f}) -- potential crash"
            ),
            chain_index=ci, segment_index=si,
            x=x2, y=y2, z=z2,
        ))


def _check_holder_collision(
    report: SimulationReport,
    x: float, y: float, z: float,
    tool: Tool,
    stock: StockDefinition,
    ci: int, si: int,
) -> None:
    """Simplified holder collision: check if holder would intersect stock top."""
    holder_clearance_z = z + tool.flute_length_mm
    if holder_clearance_z < stock.z_max:
        holder_r = tool.effective_holder_diameter / 2.0
        tool_r = tool.radius
        overhang = holder_r - tool_r
        if overhang > 0:
            # Holder extends beyond cutter -- could hit walls
            if (x - holder_r < stock.x_min or x + holder_r > stock.x_max
                    or y - holder_r < stock.y_min or y + holder_r > stock.y_max):
                pass  # Outside stock, no collision risk
            else:
                report.issues.append(SimulationIssue(
                    severity="warning",
                    message=(
                        f"Tool holder (D={tool.effective_holder_diameter:.1f}mm) "
                        f"may collide at Z={z:.1f} (flute length {tool.flute_length_mm:.1f}mm)"
                    ),
                    chain_index=ci, segment_index=si,
                    x=x, y=y, z=z,
                ))
