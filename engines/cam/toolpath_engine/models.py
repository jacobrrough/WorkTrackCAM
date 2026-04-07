"""
Data models for the toolpath engine.

Uses pydantic for validation when available, falls back to dataclasses.
All dimensions in mm, angles in degrees, feeds in mm/min.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

# Try pydantic for validation; fall back to dataclasses if unavailable
try:
    from pydantic import BaseModel, Field, field_validator, model_validator
    HAS_PYDANTIC = True
except ImportError:
    HAS_PYDANTIC = False


# ── Enums ───────────────────────────────────────────────────────────────

class Strategy(Enum):
    ADAPTIVE_CLEAR = "adaptive_clear"
    WATERLINE = "waterline"
    RASTER = "raster"
    PENCIL = "pencil"
    REST = "rest"
    SPIRAL_FINISH = "spiral_finish"
    MORPHING_FINISH = "morphing_finish"
    TROCHOIDAL_HSM = "trochoidal_hsm"
    FIVEAXIS_CONTOUR = "5axis_contour"
    FIVEAXIS_SWARF = "5axis_swarf"
    FIVEAXIS_FLOWLINE = "5axis_flowline"
    AXIS4_WRAPPING = "4axis_wrapping"
    AXIS4_CONTINUOUS = "4axis_continuous"
    AXIS4_INDEXED = "4axis_indexed"
    STEEP_SHALLOW = "steep_shallow"
    SCALLOP = "scallop"
    DRILL = "drill"
    AUTO = "auto"


class DrillCycleMode(Enum):
    """Canned drill cycle selection for drilling operations."""
    G81 = "g81"       # Simple drill: rapid to R, feed to Z, rapid out
    G82 = "g82"       # Drill with dwell at bottom
    G83 = "g83"       # Peck drill: incremental peck with full retract
    G73 = "g73"       # High-speed peck: incremental peck with partial retract
    EXPANDED = "expanded"  # No canned cycle — expanded G0/G1 moves


class ToolShape(Enum):
    FLAT = "flat"
    BALL = "ball"
    BULL = "bull"
    TAPER = "taper"
    LOLLIPOP = "lollipop"


class PostDialect(Enum):
    FANUC = "fanuc"
    GRBL = "grbl"
    SIEMENS = "siemens"
    HEIDENHAIN = "heidenhain"
    GENERIC = "generic"


# ── Vec3 ────────────────────────────────────────────────────────────────

@dataclass(slots=True)
class Vec3:
    """3D vector with basic math operations."""
    x: float
    y: float
    z: float

    def __add__(self, o: Vec3) -> Vec3:
        return Vec3(self.x + o.x, self.y + o.y, self.z + o.z)

    def __sub__(self, o: Vec3) -> Vec3:
        return Vec3(self.x - o.x, self.y - o.y, self.z - o.z)

    def __mul__(self, s: float) -> Vec3:
        return Vec3(self.x * s, self.y * s, self.z * s)

    def __neg__(self) -> Vec3:
        return Vec3(-self.x, -self.y, -self.z)

    def length(self) -> float:
        return math.sqrt(self.x * self.x + self.y * self.y + self.z * self.z)

    def length_sq(self) -> float:
        return self.x * self.x + self.y * self.y + self.z * self.z

    def normalized(self) -> Vec3:
        ln = self.length()
        if ln < 1e-15:
            return Vec3(0.0, 0.0, 0.0)
        return Vec3(self.x / ln, self.y / ln, self.z / ln)

    def dot(self, o: Vec3) -> float:
        return self.x * o.x + self.y * o.y + self.z * o.z

    def cross(self, o: Vec3) -> Vec3:
        return Vec3(
            self.y * o.z - self.z * o.y,
            self.z * o.x - self.x * o.z,
            self.x * o.y - self.y * o.x,
        )

    def distance_to(self, o: Vec3) -> float:
        return (self - o).length()

    def xy_distance_to(self, o: Vec3) -> float:
        dx = self.x - o.x
        dy = self.y - o.y
        return math.sqrt(dx * dx + dy * dy)

    def as_tuple(self) -> tuple[float, float, float]:
        return (self.x, self.y, self.z)


# ── AABB ────────────────────────────────────────────────────────────────

@dataclass(slots=True)
class AABB:
    """Axis-aligned bounding box."""
    min_pt: Vec3
    max_pt: Vec3

    @property
    def size(self) -> Vec3:
        return self.max_pt - self.min_pt

    @property
    def center(self) -> Vec3:
        return Vec3(
            (self.min_pt.x + self.max_pt.x) * 0.5,
            (self.min_pt.y + self.max_pt.y) * 0.5,
            (self.min_pt.z + self.max_pt.z) * 0.5,
        )

    def contains(self, pt: Vec3) -> bool:
        return (
            self.min_pt.x <= pt.x <= self.max_pt.x
            and self.min_pt.y <= pt.y <= self.max_pt.y
            and self.min_pt.z <= pt.z <= self.max_pt.z
        )

    def expand(self, margin: float) -> AABB:
        m = Vec3(margin, margin, margin)
        return AABB(self.min_pt - m, self.max_pt + m)


# ── Tool ────────────────────────────────────────────────────────────────

@dataclass
class Tool:
    """Cutting tool definition with full geometry."""
    diameter_mm: float = 6.0
    shape: ToolShape = ToolShape.FLAT
    corner_radius_mm: float = 0.0
    flute_length_mm: float = 25.0
    flute_count: int = 2
    holder_diameter_mm: float = 0.0
    max_doc_mm: float = 0.0
    tool_number: int = 1

    @property
    def radius(self) -> float:
        return self.diameter_mm / 2.0

    @property
    def effective_radius(self) -> float:
        if self.shape == ToolShape.BALL:
            return self.radius
        if self.shape == ToolShape.BULL:
            return self.radius - self.corner_radius_mm
        return self.radius

    @property
    def effective_holder_diameter(self) -> float:
        return self.holder_diameter_mm if self.holder_diameter_mm > 0 else self.diameter_mm

    def validate(self) -> list[str]:
        errors: list[str] = []
        if self.diameter_mm <= 0:
            errors.append(f"Tool diameter must be > 0, got {self.diameter_mm}")
        if self.corner_radius_mm < 0:
            errors.append("Corner radius must be >= 0")
        if self.shape == ToolShape.BULL and self.corner_radius_mm > self.radius:
            errors.append("Corner radius cannot exceed tool radius for bull-nose")
        if self.shape == ToolShape.BALL and self.corner_radius_mm > 0:
            pass  # corner_radius is ignored for ball-end
        if self.flute_length_mm <= 0:
            errors.append("Flute length must be > 0")
        if self.flute_count < 1:
            errors.append("Flute count must be >= 1")
        return errors


# ── Material ────────────────────────────────────────────────────────────

@dataclass
class Material:
    """Workpiece material properties for feed/speed optimization."""
    name: str = "aluminum_6061"
    hardness_bhn: float = 95.0
    sfm_range: tuple[float, float] = (300.0, 800.0)
    chip_load_range: tuple[float, float] = (0.02, 0.10)
    machinability_index: float = 1.0
    specific_cutting_energy: float = 800.0  # N/mm^2 (kc)

    @staticmethod
    def from_name(name: str) -> Material:
        """Look up material by common name."""
        presets = {
            "aluminum_6061": Material("aluminum_6061", 95, (300, 800), (0.02, 0.10), 1.0, 800),
            "aluminum_7075": Material("aluminum_7075", 150, (250, 700), (0.02, 0.08), 0.9, 900),
            "mild_steel": Material("mild_steel", 130, (80, 200), (0.05, 0.15), 0.5, 2000),
            "stainless_304": Material("stainless_304", 200, (50, 150), (0.03, 0.10), 0.35, 2500),
            "brass": Material("brass", 100, (300, 600), (0.03, 0.12), 1.2, 600),
            "wood_hardwood": Material("wood_hardwood", 0, (500, 2000), (0.10, 0.50), 3.0, 50),
            "wood_softwood": Material("wood_softwood", 0, (500, 2000), (0.15, 0.60), 4.0, 30),
            "acrylic": Material("acrylic", 0, (300, 800), (0.05, 0.15), 2.0, 100),
            "hdpe": Material("hdpe", 0, (300, 1000), (0.10, 0.30), 2.5, 50),
            "carbon_fiber": Material("carbon_fiber", 0, (200, 500), (0.02, 0.08), 0.6, 1500),
        }
        return presets.get(name, Material())


# ── Machine ─────────────────────────────────────────────────────────────

@dataclass
class MachineKinematics:
    """Machine travel limits, capabilities, and performance envelope."""
    x_travel_mm: float = 300.0
    y_travel_mm: float = 160.0
    z_travel_mm: float = 65.0
    max_feed_mm_min: float = 5000.0
    max_rapid_mm_min: float = 10000.0
    max_spindle_rpm: float = 24000.0
    min_spindle_rpm: float = 1000.0
    max_power_kw: float = 2.2
    max_accel_mm_s2: float = 500.0
    has_4th_axis: bool = False
    has_5th_axis: bool = False
    a_axis_orientation: str = "x"
    a_axis_range_deg: float = 360.0
    # 5-axis kinematic chain: "table-table", "head-head", or "table-head"
    fiveaxis_type: str = "table-table"
    b_axis_range_deg: float = 120.0  # B or C tilt range (symmetric: +/- half)
    b_axis_orientation: str = "y"
    max_tilt_deg: float = 60.0  # max simultaneous tilt from vertical


# ── Lead-in/lead-out ───────────────────────────────────────────────────

@dataclass
class LeadInOutParams:
    """Configurable lead-in / lead-out arc parameters.

    Strategies that generate approach/departure arcs read from this
    instead of using hardcoded values.  When ``mode`` is ``"none"``,
    strategies skip lead-in/lead-out entirely.

    Modes:
      ``"arc"``  — tangential quarter-circle arc (default, legacy behaviour).
      ``"line"`` — short tangential linear ramp.
      ``"none"`` — disabled; tool plunges/retracts vertically.
    """
    mode: str = "arc"                    # "arc", "line", "none"
    radius_mm: float = 0.0              # 0 = auto (min(tool_r * 0.5, 2.0))
    arc_angle_deg: float = 90.0         # sweep angle for arc mode
    arc_steps: int = 8                  # interpolation points per arc
    feed_factor: float = 0.5            # fraction of cut feed during lead moves

    def effective_radius(self, tool_radius: float) -> float:
        """Return the lead arc radius, falling back to the automatic default."""
        if self.radius_mm > 0:
            return self.radius_mm
        return min(tool_radius * 0.5, 2.0)


# ── Cut params ──────────────────────────────────────────────────────────

@dataclass
class CutParams:
    """Resolved cutting parameters for an operation."""
    feed_mm_min: float = 1000.0
    plunge_mm_min: float = 400.0
    ramp_angle_deg: float = 3.0
    spindle_rpm: float = 10000.0
    stepover_mm: float = 1.0
    z_step_mm: float = 1.0
    safe_z_mm: float = 10.0
    retract_z_mm: float = 5.0
    climb_milling: bool = True
    coolant: str = "flood"  # flood, mist, air, off
    lead_in_out: LeadInOutParams = field(default_factory=LeadInOutParams)


# ── Stock ───────────────────────────────────────────────────────────────

@dataclass
class StockDefinition:
    """Stock bounding box (WCS coordinates)."""
    x_min: float = 0.0
    x_max: float = 100.0
    y_min: float = 0.0
    y_max: float = 100.0
    z_min: float = -20.0
    z_max: float = 0.0

    @property
    def aabb(self) -> AABB:
        return AABB(
            Vec3(self.x_min, self.y_min, self.z_min),
            Vec3(self.x_max, self.y_max, self.z_max),
        )

    @property
    def size(self) -> Vec3:
        return Vec3(
            self.x_max - self.x_min,
            self.y_max - self.y_min,
            self.z_max - self.z_min,
        )


# ── Job specification ───────────────────────────────────────────────────

@dataclass
class ToolpathJob:
    """Complete job specification for toolpath generation."""
    stl_path: str = ""
    output_path: str = ""
    strategy: Strategy = Strategy.RASTER
    tool: Tool = field(default_factory=lambda: Tool(diameter_mm=6.0))
    material: Material = field(default_factory=Material)
    machine: MachineKinematics = field(default_factory=MachineKinematics)
    cuts: CutParams = field(default_factory=CutParams)
    stock: StockDefinition = field(default_factory=StockDefinition)
    post_dialect: PostDialect = PostDialect.GENERIC
    tolerance_mm: float = 0.01
    surface_finish_ra_um: float = 3.2
    max_engagement_deg: float = 90.0
    prior_tool_diameter_mm: float = 0.0
    # Raster-specific
    raster_angle_deg: float = 0.0  # scan line rotation (0 = Y-primary, 45 = diagonal)
    scan_angle_deg: float | None = None  # alias for raster_angle_deg (takes precedence if set)
    cylinder_diameter_mm: float = 50.0
    a_axis_orientation: str = "x"
    # Drill-specific
    drill_points: list[tuple[float, float]] = field(default_factory=list)  # [(x, y), ...]
    drill_cycle_mode: DrillCycleMode = DrillCycleMode.G81
    peck_depth_mm: float = 0.0   # Q word: peck increment for G73/G83 (0 = disabled)
    dwell_ms: float = 0.0        # P word: dwell at hole bottom for G82 (0 = disabled)
    retract_z_mm: float = 0.0    # R word: retract plane (0 = use safe_z_mm)
    # Adaptive feed
    adaptive_feed_enabled: bool = False  # enable per-pass feed adjustment based on engagement

    def validate(self) -> list[str]:
        errors = self.tool.validate()
        if self.cuts.feed_mm_min <= 0:
            errors.append("feed_mm_min must be > 0")
        if self.cuts.plunge_mm_min <= 0:
            errors.append("plunge_mm_min must be > 0")
        if self.cuts.stepover_mm <= 0:
            errors.append("stepover_mm must be > 0")
        if self.cuts.stepover_mm > self.tool.diameter_mm:
            errors.append("stepover_mm should not exceed tool diameter")
        if self.cuts.z_step_mm <= 0:
            errors.append("z_step_mm must be > 0")
        if self.cuts.safe_z_mm <= 0:
            errors.append("safe_z_mm must be > 0")
        if self.strategy == Strategy.REST and self.prior_tool_diameter_mm <= 0:
            errors.append("prior_tool_diameter_mm required for rest machining")
        return errors


# ── Motion primitives ───────────────────────────────────────────────────

@dataclass(slots=True)
class MotionSegment:
    """Single toolpath motion: rapid or feed move."""
    x: float
    y: float
    z: float
    feed: float = 0.0
    a: float | None = None
    b: float | None = None  # 5-axis tilt angle (B or C axis)

    @property
    def is_rapid(self) -> bool:
        return self.feed <= 0

    def distance_to(self, other: MotionSegment) -> float:
        return math.sqrt(
            (self.x - other.x) ** 2
            + (self.y - other.y) ** 2
            + (self.z - other.z) ** 2
        )

    def xy_distance_to(self, other: MotionSegment) -> float:
        return math.sqrt(
            (self.x - other.x) ** 2
            + (self.y - other.y) ** 2
        )


@dataclass
class ToolpathChain:
    """Ordered sequence of motion segments forming one contiguous cut."""
    segments: list[MotionSegment] = field(default_factory=list)
    comment: str = ""

    def append_rapid(self, x: float, y: float, z: float) -> None:
        self.segments.append(MotionSegment(x, y, z, feed=0.0))

    def append_feed(self, x: float, y: float, z: float, feed: float) -> None:
        self.segments.append(MotionSegment(x, y, z, feed=feed))

    def append_4axis(self, x: float, y: float, z: float, a: float, feed: float) -> None:
        self.segments.append(MotionSegment(x, y, z, feed=feed, a=a))

    def append_5axis(self, x: float, y: float, z: float, a: float, b: float, feed: float) -> None:
        self.segments.append(MotionSegment(x, y, z, feed=feed, a=a, b=b))

    def is_empty(self) -> bool:
        return len(self.segments) == 0

    @property
    def last(self) -> MotionSegment | None:
        return self.segments[-1] if self.segments else None


@dataclass
class ToolpathResult:
    """Complete toolpath output from a strategy."""
    chains: list[ToolpathChain] = field(default_factory=list)
    strategy: str = ""
    estimated_time_s: float = 0.0
    total_distance_mm: float = 0.0
    cut_distance_mm: float = 0.0
    rapid_distance_mm: float = 0.0
    mrr_cm3_min: float = 0.0
    warnings: list[str] = field(default_factory=list)

    @property
    def total_segments(self) -> int:
        return sum(len(c.segments) for c in self.chains)


# ── Statistics helper ───────────────────────────────────────────────────

def compute_stats(result: ToolpathResult, safe_z: float, rapid_speed: float = 5000.0) -> None:
    """Compute distance and time statistics for a toolpath result. Shared by all strategies."""
    total_cut = 0.0
    total_rapid = 0.0
    weighted_feed_sum = 0.0
    feed_distance = 0.0
    prev_x, prev_y, prev_z = 0.0, 0.0, safe_z

    for chain in result.chains:
        for seg in chain.segments:
            d = math.sqrt(
                (seg.x - prev_x) ** 2 + (seg.y - prev_y) ** 2 + (seg.z - prev_z) ** 2
            )
            if seg.is_rapid:
                total_rapid += d
            else:
                total_cut += d
                if seg.feed > 0 and d > 0:
                    weighted_feed_sum += d * seg.feed
                    feed_distance += d
            prev_x, prev_y, prev_z = seg.x, seg.y, seg.z

    result.cut_distance_mm = total_cut
    result.rapid_distance_mm = total_rapid
    result.total_distance_mm = total_cut + total_rapid

    rapid_time_min = total_rapid / rapid_speed if total_rapid > 0 else 0
    avg_feed = weighted_feed_sum / feed_distance if feed_distance > 0 else 1000.0
    cut_time_min = total_cut / avg_feed if total_cut > 0 else 0
    result.estimated_time_s = (rapid_time_min + cut_time_min) * 60


# ── Config parsing from JSON ────────────────────────────────────────────

def job_from_config(cfg: dict[str, Any]) -> ToolpathJob:
    """Parse a JSON config dict into a ToolpathJob (matching existing IPC contract)."""

    def _f(key: str, default: float) -> float:
        v = cfg.get(key, default)
        return default if v is None else float(v)

    def _s(key: str, default: str) -> str:
        v = cfg.get(key, default)
        return default if v is None else str(v)

    def _b(key: str, default: bool) -> bool:
        v = cfg.get(key, default)
        return default if v is None else bool(v)

    strat_str = _s("strategy", "raster")
    strat_map = {s.value: s for s in Strategy}
    strategy = strat_map.get(strat_str, Strategy.RASTER)

    tool_shape_str = _s("toolShape", "flat")
    shape_map = {s.value: s for s in ToolShape}
    tool_shape = shape_map.get(tool_shape_str, ToolShape.FLAT)

    post_str = _s("postDialect", "generic")
    post_map = {s.value: s for s in PostDialect}
    post_dialect = post_map.get(post_str, PostDialect.GENERIC)

    material_name = _s("materialName", "aluminum_6061")
    material = Material.from_name(material_name)

    tool = Tool(
        diameter_mm=_f("toolDiameterMm", 6.0),
        shape=tool_shape,
        corner_radius_mm=_f("cornerRadiusMm", 0.0),
        flute_length_mm=_f("fluteLengthMm", 25.0),
        flute_count=int(_f("fluteCount", 2)),
        holder_diameter_mm=_f("holderDiameterMm", 0.0),
        max_doc_mm=_f("maxDocMm", 0.0),
        tool_number=int(_f("toolNumber", 1)),
    )

    # Parse lead-in/lead-out sub-object (optional)
    lio_cfg = cfg.get("leadInOut", {})
    if not isinstance(lio_cfg, dict):
        lio_cfg = {}
    lead_in_out = LeadInOutParams(
        mode=str(lio_cfg.get("mode", "arc")),
        radius_mm=float(lio_cfg.get("radiusMm", 0.0)),
        arc_angle_deg=float(lio_cfg.get("arcAngleDeg", 90.0)),
        arc_steps=int(lio_cfg.get("arcSteps", 8)),
        feed_factor=float(lio_cfg.get("feedFactor", 0.5)),
    )

    cuts = CutParams(
        feed_mm_min=_f("feedMmMin", 1000.0),
        plunge_mm_min=_f("plungeMmMin", 400.0),
        ramp_angle_deg=_f("rampAngleDeg", 3.0),
        spindle_rpm=_f("spindleRpm", 10000.0),
        stepover_mm=_f("stepoverMm", 1.0),
        z_step_mm=_f("zStepMm", 1.0),
        safe_z_mm=_f("safeZMm", 10.0),
        retract_z_mm=_f("retractZMm", 5.0),
        climb_milling=_b("climbMilling", True),
        coolant=_s("coolant", "flood"),
        lead_in_out=lead_in_out,
    )

    stock = StockDefinition(
        x_min=_f("stockXMin", 0.0),
        x_max=_f("stockXMax", 100.0),
        y_min=_f("stockYMin", 0.0),
        y_max=_f("stockYMax", 100.0),
        z_min=_f("stockZMin", -20.0),
        z_max=_f("stockZMax", 0.0),
    )

    machine = MachineKinematics(
        x_travel_mm=_f("xTravelMm", 300.0),
        y_travel_mm=_f("yTravelMm", 160.0),
        z_travel_mm=_f("zTravelMm", 65.0),
        max_feed_mm_min=_f("maxFeedMmMin", 5000.0),
        max_rapid_mm_min=_f("maxRapidMmMin", 10000.0),
        max_spindle_rpm=_f("maxSpindleRpm", 24000.0),
        min_spindle_rpm=_f("minSpindleRpm", 1000.0),
        max_power_kw=_f("maxPowerKw", 2.2),
        has_4th_axis=_b("has4thAxis", False),
        has_5th_axis=_b("has5thAxis", False),
        fiveaxis_type=_s("fiveaxisType", "table-table"),
        b_axis_range_deg=_f("bAxisRangeDeg", 120.0),
        b_axis_orientation=_s("bAxisOrientation", "y"),
        max_tilt_deg=_f("maxTiltDeg", 60.0),
    )

    # Parse drill points: list of [x, y] pairs
    raw_drill_pts = cfg.get("drillPoints", [])
    drill_points: list[tuple[float, float]] = []
    if isinstance(raw_drill_pts, list):
        for pt in raw_drill_pts:
            if isinstance(pt, (list, tuple)) and len(pt) >= 2:
                try:
                    drill_points.append((float(pt[0]), float(pt[1])))
                except (TypeError, ValueError):
                    pass

    # Parse drill cycle mode
    drill_cycle_str = _s("drillCycleMode", "g81")
    drill_cycle_map = {m.value: m for m in DrillCycleMode}
    drill_cycle_mode = drill_cycle_map.get(drill_cycle_str, DrillCycleMode.G81)

    # scanAngleDeg takes precedence over rasterAngleDeg when explicitly set
    scan_angle_raw = cfg.get("scanAngleDeg")
    scan_angle_deg: float | None = None
    if scan_angle_raw is not None:
        try:
            scan_angle_deg = float(scan_angle_raw)
        except (TypeError, ValueError):
            pass

    raster_angle = _f("rasterAngleDeg", 0.0)
    if scan_angle_deg is not None:
        raster_angle = scan_angle_deg

    return ToolpathJob(
        stl_path=_s("stlPath", ""),
        output_path=_s("toolpathJsonPath", ""),
        strategy=strategy,
        tool=tool,
        material=material,
        machine=machine,
        cuts=cuts,
        stock=stock,
        post_dialect=post_dialect,
        tolerance_mm=_f("toleranceMm", 0.01),
        surface_finish_ra_um=_f("surfaceFinishRaUm", 3.2),
        max_engagement_deg=_f("maxEngagementDeg", 90.0),
        prior_tool_diameter_mm=_f("priorToolDiameterMm", 0.0),
        raster_angle_deg=raster_angle,
        scan_angle_deg=scan_angle_deg,
        cylinder_diameter_mm=_f("cylinderDiameterMm", 50.0),
        drill_points=drill_points,
        drill_cycle_mode=drill_cycle_mode,
        peck_depth_mm=_f("peckDepthMm", 0.0),
        dwell_ms=_f("dwellMs", 0.0),
        retract_z_mm=_f("retractZMm", 0.0),
        adaptive_feed_enabled=_b("adaptiveFeedEnabled", False),
    )
