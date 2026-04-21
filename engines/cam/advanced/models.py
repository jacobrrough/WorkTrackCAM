"""
Data models for the advanced toolpath engine.

Uses dataclasses (no external deps) with validation helpers.
All dimensions in mm, angles in degrees, feeds in mm/min.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class Strategy(Enum):
    ADAPTIVE_CLEAR = "adaptive_clear"
    WATERLINE = "waterline"
    RASTER = "raster"
    PENCIL = "pencil"
    REST = "rest"
    AXIS4_WRAPPING = "4axis_wrapping"


class ToolShape(Enum):
    FLAT = "flat"
    BALL = "ball"
    BULL = "bull"


class PostDialect(Enum):
    FANUC = "fanuc"
    GRBL = "grbl"
    SIEMENS = "siemens"
    HEIDENHAIN = "heidenhain"
    GENERIC = "generic"


@dataclass
class Vec3:
    x: float
    y: float
    z: float

    def __add__(self, o: Vec3) -> Vec3:
        return Vec3(self.x + o.x, self.y + o.y, self.z + o.z)

    def __sub__(self, o: Vec3) -> Vec3:
        return Vec3(self.x - o.x, self.y - o.y, self.z - o.z)

    def __mul__(self, s: float) -> Vec3:
        return Vec3(self.x * s, self.y * s, self.z * s)

    def length(self) -> float:
        return math.sqrt(self.x**2 + self.y**2 + self.z**2)

    def dot(self, o: Vec3) -> float:
        return self.x * o.x + self.y * o.y + self.z * o.z

    def cross(self, o: Vec3) -> Vec3:
        return Vec3(
            self.y * o.z - self.z * o.y,
            self.z * o.x - self.x * o.z,
            self.x * o.y - self.y * o.x,
        )


@dataclass
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
            (self.min_pt.x + self.max_pt.x) / 2,
            (self.min_pt.y + self.max_pt.y) / 2,
            (self.min_pt.z + self.max_pt.z) / 2,
        )


@dataclass
class Tool:
    diameter_mm: float
    shape: ToolShape = ToolShape.FLAT
    corner_radius_mm: float = 0.0
    flute_length_mm: float = 25.0
    flute_count: int = 2
    holder_diameter_mm: float = 0.0  # 0 = same as tool
    max_doc_mm: float = 0.0  # 0 = auto from flute length

    @property
    def radius(self) -> float:
        return self.diameter_mm / 2.0

    @property
    def effective_radius(self) -> float:
        """Effective cutting radius at tip."""
        if self.shape == ToolShape.BALL:
            return self.radius
        if self.shape == ToolShape.BULL:
            return self.radius - self.corner_radius_mm
        return self.radius

    def validate(self) -> None:
        if self.diameter_mm <= 0:
            raise ValueError(f"Tool diameter must be > 0, got {self.diameter_mm}")
        if self.corner_radius_mm < 0:
            raise ValueError("Corner radius must be >= 0")
        if self.shape == ToolShape.BULL and self.corner_radius_mm > self.radius:
            raise ValueError("Corner radius cannot exceed tool radius")
        if self.flute_length_mm <= 0:
            raise ValueError("Flute length must be > 0")


@dataclass
class Material:
    name: str = "aluminum_6061"
    hardness_bhn: float = 95.0
    sfm_range: tuple[float, float] = (300.0, 800.0)  # surface feet per minute
    chip_load_range: tuple[float, float] = (0.02, 0.10)  # mm per tooth
    machinability_index: float = 1.0  # 1.0 = baseline (aluminum)


@dataclass
class MachineKinematics:
    """Machine travel limits and capabilities."""
    x_travel_mm: float = 300.0
    y_travel_mm: float = 160.0
    z_travel_mm: float = 65.0
    max_feed_mm_min: float = 5000.0
    max_rapid_mm_min: float = 10000.0
    max_spindle_rpm: float = 24000.0
    has_4th_axis: bool = False
    a_axis_orientation: str = "x"  # rotation axis: 'x' or 'y'


@dataclass
class CutParams:
    """Resolved cutting parameters for an operation."""
    feed_mm_min: float = 1000.0
    plunge_mm_min: float = 400.0
    ramp_angle_deg: float = 3.0
    spindle_rpm: float = 10000.0
    stepover_mm: float = 1.0
    z_step_mm: float = 1.0  # axial depth of cut
    safe_z_mm: float = 10.0
    retract_z_mm: float = 5.0  # clearance above stock top


@dataclass
class StockDefinition:
    """Stock bounding box (WCS coordinates)."""
    x_min: float = 0.0
    x_max: float = 100.0
    y_min: float = 0.0
    y_max: float = 100.0
    z_min: float = -20.0
    z_max: float = 0.0  # stock top = Z0 by default

    @property
    def aabb(self) -> AABB:
        return AABB(
            Vec3(self.x_min, self.y_min, self.z_min),
            Vec3(self.x_max, self.y_max, self.z_max),
        )


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
    surface_finish_ra_um: float = 3.2  # target Ra in microns
    # Adaptive-specific
    max_engagement_deg: float = 90.0  # max radial engagement angle
    stock_allowance_mm: float = 0.0
    # Rest machining
    prior_tool_diameter_mm: float = 0.0  # previous tool for rest detection
    # Raster-specific
    raster_angle_deg: float = 0.0  # scan line rotation (0 = Y-primary, 45 = diagonal)
    # 4-axis specific
    cylinder_diameter_mm: float = 50.0
    a_axis_orientation: str = "x"

    def validate(self) -> list[str]:
        """Return list of validation errors (empty = valid)."""
        errors: list[str] = []
        self.tool.validate()
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
        if self.cuts.retract_z_mm <= 0:
            errors.append("retract_z_mm must be > 0")
        if self.max_engagement_deg <= 0 or self.max_engagement_deg > 180:
            errors.append("max_engagement_deg must be in (0, 180]")
        if self.stock_allowance_mm < 0:
            errors.append("stock_allowance_mm must be >= 0")
        return errors


# ── Motion primitives ────────────────────────────────────────────────────

@dataclass
class MotionSegment:
    """Single toolpath motion: rapid or feed move."""
    x: float
    y: float
    z: float
    feed: float = 0.0  # 0 = rapid
    a: float | None = None  # 4th axis

    @property
    def is_rapid(self) -> bool:
        return self.feed <= 0


@dataclass
class ToolpathChain:
    """Ordered sequence of motion segments forming one contiguous cut."""
    segments: list[MotionSegment] = field(default_factory=list)
    comment: str = ""

    def append_rapid(self, x: float, y: float, z: float) -> None:
        self.segments.append(MotionSegment(x, y, z, feed=0.0))

    def append_feed(self, x: float, y: float, z: float, feed: float) -> None:
        self.segments.append(MotionSegment(x, y, z, feed=feed))

    def is_empty(self) -> bool:
        return len(self.segments) == 0


@dataclass
class ToolpathResult:
    """Complete toolpath output from a strategy."""
    chains: list[ToolpathChain] = field(default_factory=list)
    strategy: str = ""
    estimated_time_s: float = 0.0
    total_distance_mm: float = 0.0
    cut_distance_mm: float = 0.0
    rapid_distance_mm: float = 0.0
    warnings: list[str] = field(default_factory=list)


# ── Config parsing from JSON ─────────────────────────────────────────────

def job_from_config(cfg: dict[str, Any]) -> ToolpathJob:
    """Parse a JSON config dict into a ToolpathJob (matching existing IPC contract)."""

    def _f(key: str, default: float) -> float:
        v = cfg.get(key, default)
        if v is None:
            return default
        return float(v)

    def _s(key: str, default: str) -> str:
        v = cfg.get(key, default)
        return default if v is None else str(v)

    # Map strategy strings to enum
    strat_str = _s("strategy", "raster")
    strat_map = {s.value: s for s in Strategy}
    strategy = strat_map.get(strat_str, Strategy.RASTER)

    tool_shape_str = _s("toolShape", "flat")
    shape_map = {s.value: s for s in ToolShape}
    tool_shape = shape_map.get(tool_shape_str, ToolShape.FLAT)

    post_str = _s("postDialect", "generic")
    post_map = {s.value: s for s in PostDialect}
    post_dialect = post_map.get(post_str, PostDialect.GENERIC)

    tool = Tool(
        diameter_mm=_f("toolDiameterMm", 6.0),
        shape=tool_shape,
        corner_radius_mm=_f("cornerRadiusMm", 0.0),
        flute_length_mm=_f("fluteLengthMm", 25.0),
        flute_count=int(_f("fluteCount", 2)),
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
        max_spindle_rpm=_f("maxSpindleRpm", 24000.0),
    )

    return ToolpathJob(
        stl_path=_s("stlPath", ""),
        output_path=_s("toolpathJsonPath", ""),
        strategy=strategy,
        tool=tool,
        material=Material(name=_s("materialName", "aluminum_6061")),
        machine=machine,
        cuts=cuts,
        stock=stock,
        post_dialect=post_dialect,
        tolerance_mm=_f("toleranceMm", 0.01),
        max_engagement_deg=max(1.0, min(180.0, _f("maxEngagementDeg", 90.0))),
        stock_allowance_mm=max(0.0, _f("stockAllowanceMm", 0.0)),
        prior_tool_diameter_mm=_f("priorToolDiameterMm", 0.0),
        raster_angle_deg=_f("rasterAngleDeg", 0.0),
        cylinder_diameter_mm=_f("cylinderDiameterMm", 50.0),
    )
