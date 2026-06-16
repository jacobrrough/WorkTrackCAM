import { z } from 'zod'

/**
 * JSON-safe primitive value types allowed in operation params and feature params records.
 * Replaces the former `z.unknown()` with a concrete union so saved project data is
 * validated at parse time. Covers every value shape actually used by CAM runners
 * (numbers, strings, booleans, null, and arrays/tuples of those).
 *
 * The runtime schema validates strictly, but the inferred TypeScript type stays
 * compatible with `Record<string, unknown>` to avoid cascading type changes across
 * the renderer/main boundary (callers construct params as `Record<string, unknown>`).
 */
const _jsonSafeValueSchema: z.ZodType<JsonSafeValue> = z.lazy(() =>
  z.union([
    z.number(),
    z.string(),
    z.boolean(),
    z.null(),
    z.array(z.lazy(() => _jsonSafeValueSchema))
  ])
)

/**
 * Exported schema: runtime validates JSON-safe values, TypeScript infers as `unknown`
 * so existing `Record<string, unknown>` usage remains compatible.
 */
export const jsonSafeValueSchema: z.ZodType<unknown> = _jsonSafeValueSchema

/** Recursive type for JSON-safe values used in operation/feature params. */
export type JsonSafeValue = number | string | boolean | null | JsonSafeValue[]

/**
 * Stock material types — used to auto-select tool presets (Makera CAM style).
 * The material type drives default speed/feed lookup in materialPresets on ToolRecord.
 */
export const STOCK_MATERIAL_TYPES = [
  'wood',
  'plywood',
  'mdf',
  'aluminum',
  'brass',
  'steel',
  'plastic',
  'acrylic',
  'pcb',
  'carbon_fiber',
  'foam',
  'wax',
  'other'
] as const

export type StockMaterialType = (typeof STOCK_MATERIAL_TYPES)[number]

export const STOCK_MATERIAL_LABELS: Record<StockMaterialType, string> = {
  wood: 'Wood (hardwood)',
  plywood: 'Plywood',
  mdf: 'MDF',
  aluminum: 'Aluminum',
  brass: 'Brass',
  steel: 'Steel',
  plastic: 'Plastic (general)',
  acrylic: 'Acrylic / PMMA',
  pcb: 'PCB (FR4)',
  carbon_fiber: 'Carbon Fiber',
  foam: 'Foam / EPS',
  wax: 'Machinable Wax',
  other: 'Other'
}

/**
 * WCS origin control point — maps to one of 10 positions on the stock (5 top + 5 bottom).
 * Matches the Makera CAM "10-point stock origin picker" concept.
 * top-tl / top-tc / top-tr / top-ml / top-center / top-mr / top-bl / top-bc / top-br = 9 (3×3 grid)
 * bottom-center = 10th point (flip side reference).
 */
export const WCS_ORIGIN_POINTS = [
  'top-tl',
  'top-tc',
  'top-tr',
  'top-ml',
  'top-center',
  'top-mr',
  'top-bl',
  'top-bc',
  'top-br',
  'bottom-center'
] as const

export type WcsOriginPoint = (typeof WCS_ORIGIN_POINTS)[number]

/** Shared optional fields present on all stock kinds. */
const stockCommonFields = {
  /** Extra material on stock faces for roughing (mm). */
  allowanceMm: z.number().nonnegative().optional().describe('Extra material allowance on stock faces for roughing (mm)'),
  /** Material type for auto speed/feed preset lookup. */
  materialType: z.enum(STOCK_MATERIAL_TYPES).optional().describe('Stock material type for auto speed/feed preset lookup')
} as const

/** Box stock: requires length (x), width (y), height (z) in mm. Optional for backward compat with legacy data. */
export const stockBoxSchema = z.object({
  kind: z.literal('box').describe('Rectangular box stock'),
  x: z.number().positive().optional().describe('Stock length (X) in mm'),
  y: z.number().positive().optional().describe('Stock width (Y) in mm'),
  z: z.number().positive().optional().describe('Stock height (Z) in mm'),
  ...stockCommonFields
})

/** Cylinder stock: requires diameter (z) and length (x) in mm. Optional for backward compat. */
export const stockCylinderSchema = z.object({
  kind: z.literal('cylinder').describe('Cylindrical stock for rotary machining'),
  x: z.number().positive().optional().describe('Stock length (X axis) in mm'),
  y: z.number().positive().optional().describe('Unused for cylinder — reserved for compat'),
  z: z.number().positive().optional().describe('Stock diameter in mm'),
  ...stockCommonFields
})

/** FromExtents stock: auto-derived from mesh AABB; no manual dimensions needed. */
export const stockFromExtentsSchema = z.object({
  kind: z.literal('fromExtents').describe('Stock auto-derived from mesh bounding box'),
  x: z.number().positive().optional().describe('Overridden X extent in mm (auto from mesh if absent)'),
  y: z.number().positive().optional().describe('Overridden Y extent in mm (auto from mesh if absent)'),
  z: z.number().positive().optional().describe('Overridden Z extent in mm (auto from mesh if absent)'),
  ...stockCommonFields
})

/**
 * Discriminated union for stock definitions.
 * Each `kind` enforces contextually appropriate dimensions:
 * - `box`: L/W/H (x, y, z)
 * - `cylinder`: length (x) and diameter (z)
 * - `fromExtents`: auto from mesh AABB (dimensions optional overrides)
 *
 * Fields are kept optional for backward compatibility with existing saved projects
 * that may have incomplete dimension data.
 */
export const stockSchema = z.discriminatedUnion('kind', [
  stockBoxSchema,
  stockCylinderSchema,
  stockFromExtentsSchema
])

export const setupSchema = z.object({
  id: z.string().trim().min(1).describe('Unique setup identifier'),
  label: z.string().trim().min(1).describe('Human-readable setup label'),
  machineId: z.string().trim().min(1).describe('Machine profile ID for this setup'),
  wcsNote: z.string().optional().describe('Work coordinate system note for the operator'),
  /** Fixture / vises / soft-jaw context for the operator (not interpreted by CAM yet). */
  fixtureNote: z.string().optional().describe('Fixture/vise context note for the operator'),
  /** Work offset index 1–6 → G54–G59 on most mills. */
  workCoordinateIndex: z.number().int().min(1).max(6).optional().describe('Work offset index 1-6 mapping to G54-G59'),
  stock: stockSchema.optional().describe('Stock definition for this setup'),
  /**
   * Makera-style WCS origin control point — one of 10 positions on the stock
   * (3×3 top grid + bottom center). Tells the operator which corner/face of
   * the physical workpiece maps to machine zero.
   */
  wcsOriginPoint: z.enum(WCS_ORIGIN_POINTS).optional(),
  /** Axis count for this setup: 3 (default), 4, or 5. Drives default op kinds offered. */
  axisMode: z
    .enum(['3axis', '4axis', '5axis'])
    .optional()
    .describe('Axis count for this setup: 3axis, 4axis, or 5axis'),
  /** mm — in-chuck zone from stock left face along X (4-axis rotary). */
  rotaryChuckDepthMm: z.number().nonnegative().optional(),
  /** mm — safety buffer after chuck before machinable zone (4-axis). */
  rotaryClampOffsetMm: z.number().nonnegative().optional(),
  /** Cross-section shape for 4-axis rotary stock: 'cylinder' (round bar) or 'square' (square bar). */
  rotaryStockProfile: z.enum(['cylinder', 'square']).optional().describe('Rotary stock cross-section: cylinder or square'),
  /**
   * Outer radius of the rotary CHUCK body (mm) for the 4-axis collision sweep.
   * Typically larger than the stock radius (the jaw front face). When set on a
   * setup it overrides the machine-profile `rotaryChuckOuterRadiusMm` default in
   * the `checkRotaryFixtureCollision` sweep (see `src/shared/rotary-collision.ts`).
   * Advisory only — feeds collision WARNINGS, never alters emitted G-code.
   */
  rotaryChuckOuterRadiusMm: z
    .number()
    .positive()
    .finite()
    .optional()
    .describe('Outer radius of the rotary chuck body (mm) for the 4-axis collision sweep'),
  /**
   * Axial position where the TAILSTOCK body begins (mm), measured along the
   * rotation axis (engine X) from the chuck face. Tailstock occupies X ≥ this
   * value. Set together with `rotaryTailstockOuterRadiusMm` to enable the
   * tailstock arm of the 4-axis collision sweep; omit both to skip it.
   * Advisory only — feeds collision WARNINGS, never alters emitted G-code.
   */
  rotaryTailstockStartXMm: z
    .number()
    .nonnegative()
    .finite()
    .optional()
    .describe('Axial X where the tailstock body begins (mm) for the 4-axis collision sweep'),
  /** Outer radius of the tailstock body (mm). Required to enable the tailstock collision check. */
  rotaryTailstockOuterRadiusMm: z
    .number()
    .positive()
    .finite()
    .optional()
    .describe('Outer radius of the tailstock body (mm) for the 4-axis collision sweep'),
  /**
   * Three.js viewer-space orientation of the part for a 4-axis rotary job —
   * produced by the `RotaryOrientGizmo`. Mirrors the engine `Placement`
   * (`src/main/cam-axis4/frame.ts`): position (mm) / rotation (intrinsic XYZ
   * Euler degrees) / scale (1 = unscaled). When present it replaces the
   * historical hard-coded identity transform in `run-cam-for-op.ts` so the
   * 4-axis engine aligns a real-world STL to the rotation axis (engine X).
   * Absent ⇒ identity (the STL is assumed authored in rotary WCS).
   */
  rotaryPlacement: z
    .object({
      position: z.object({
        x: z.number().finite(),
        y: z.number().finite(),
        z: z.number().finite()
      }),
      rotation: z.object({
        x: z.number().finite(),
        y: z.number().finite(),
        z: z.number().finite()
      }),
      scale: z.object({
        x: z.number().finite(),
        y: z.number().finite(),
        z: z.number().finite()
      })
    })
    .optional()
    .describe('4-axis rotary part orientation (Three.js viewer-space placement) from the orient gizmo')
})

export type ManufactureSetup = z.infer<typeof setupSchema>

export const manufactureOperationSchema = z.object({
  id: z.string().trim().min(1).describe('Unique operation identifier'),
  kind: z.enum([
    'fdm_slice',
    'cnc_parallel',
    'cnc_contour',
    'cnc_pocket',
    'cnc_drill',
    /**
     * Adaptive clearing — TWO modes keyed on geometry (Stack B v1, additive):
     * - **2D contour mode** (when `contourPoints` is set): capped-radial-engagement
     *   clearing over the offset-level region model (`generateAdaptiveClearing2dLines`).
     *   Same base loops as the pocket `offset_spiral` strategy; where the local
     *   engagement would exceed `maxEngagementMm` (default 40% of tool diameter)
     *   the engine inserts trochoidal relief loops, and channels narrower than
     *   ~tool Ø + stepover are cleared fully trochoidally. Honest v1 limits:
     *   arcs are emitted as fine G1 polylines (NO G2/G3), region-core entry
     *   loops are cut fully buried (use `entryMode: 'ramp'`), and wall-level
     *   spikes the engine cannot relieve are SKIPPED with a hint (material
     *   left — never slotted above the cap). Depth is hard-capped to stock
     *   thickness. Params: `contourPoints`, optional `islandRings`,
     *   `maxEngagementMm`, `trochoidRadiusMm` (default cap/2),
     *   `trochoidStepMm` (default cap/4), plus the pocket family
     *   (`stepoverMm`, `wallStockMm`, `zStepMm`, `entryMode`, `rampMm`,
     *   `rampMaxAngleDeg`, `finishPass`), and rest machining via
     *   `restPrevToolDiameterMm` (clear only what a previous, larger tool left).
     * - **Mesh mode** (no `contourPoints`): OpenCAMLib `AdaptiveWaterline` when
     *   available; else built-in parallel finish from STL bounds (CAM run
     *   reports fallback reason). Unchanged legacy path.
     */
    'cnc_adaptive',
    /** Z-level waterline — OpenCAMLib `Waterline` when `pip install opencamlib` works for your Python; else built-in parallel finish (CAM run reports fallback reason). */
    'cnc_waterline',
    /** XY raster — OpenCAMLib `PathDropCutter` in `engines/cam/ocl_toolpath.py` when available; else built-in 2.5D mesh height-field, then orthogonal bounds zigzag (reason shown in CAM output). Optional `rasterRestStockMm` on mesh height-field fallback; when `stockBoxZMm` is passed on `cam:run`, omit `autoRasterRestFromSetup: false` to auto-fill rest from stock Z + mesh min Z (WCS). Opt-in `usePriorPostedGcodeRest: true` + `output/cam.nc` (Manufacture) uses prior feed moves as a coarse rest floor (same WCS). Opt-in `meshAnalyticPriorRoughStockMm` (positive mm) applies only when **no** G-code rest sampler is in use — simulates a prior rough stock height for mesh-raster skip logic vs finish rest (2.5D heuristic). Opt-in `autoDocFromSetupMesh: true` + stock box on `cam:run` can set default negative `zPassMm` from stock Z vs STL min Z. */
    'cnc_raster',
    /**
     * Pencil / rest cleanup — same OpenCAMLib **raster** path as `cnc_raster` with a **tighter effective stepover**
     * (`resolvePencilStepoverMm`: optional `pencilStepoverMm` or `pencilStepoverFactor` × op stepover, default factor 0.22).
     * Optional `rasterRestStockMm` on built-in mesh height-field fallback; same `usePriorPostedGcodeRest` / `priorRoughToolDiameterMm` / `autoDocFromSetupMesh` as `cnc_raster` when applicable.
     */
    'cnc_pencil',
    /**
     * 4-axis roughing — mesh-aware radial waterline roughing on cylindrical stock.
     * Removes bulk material layer-by-layer from stock OD toward part surface using
     * a cylindrical heightmap and tool-radius compensation. Requires `axisCount >= 4`.
     * Params: `zPassMm` (total radial depth), `zStepMm` (per-layer step-down),
     * `stepoverDeg` (angular step), `toolDiameterMm`, `overcutMm` (extend past edges),
     * `feedMmMin`, `plungeMmMin`, `safeZMm`.
     */
    'cnc_4axis_roughing',
    /**
     * 4-axis finishing — mesh-aware surface-following finish pass on cylindrical stock.
     * Fine angular stepover, follows the compensated part surface at final depth.
     * Requires `axisCount >= 4`.
     * Params: `zPassMm` (final radial depth), `finishStepoverDeg` (fine angular step),
     * `toolDiameterMm`, `feedMmMin`, `plungeMmMin`, `safeZMm`.
     */
    'cnc_4axis_finishing',
    /**
     * 4-axis contour — wraps a 2D contour onto the cylinder surface.
     * For engraving, V-carving, and profiling on rotary stock.
     * Requires `axisCount >= 4` and `contourPoints: [x,y][]`.
     * Params: `contourPoints`, `zPassMm`, `feedMmMin`, `plungeMmMin`, `safeZMm`.
     */
    'cnc_4axis_contour',
    /**
     * 4-axis indexed — machine multiple 3-axis setups with the A axis locked at
     * discrete rotation angles. Each index stop is a separate sub-operation.
     * Requires `axisCount >= 4` on the active machine profile.
     * Params: `indexAnglesDeg` (array of A-axis stops, e.g. [0, 90, 180, 270]),
     * `zPassMm`, `stepoverMm`, `feedMmMin`, `safeZMm`, `toolDiameterMm`.
     */
    'cnc_4axis_indexed',
    /**
     * 3D Roughing — aggressive adaptive clearing to remove bulk material.
     * Routes to OpenCAMLib `AdaptiveWaterline` when available; falls back to
     * built-in parallel with coarse stepover. Leaves `stockAllowanceMm` on walls.
     * Params: `zPassMm`, `stepoverMm`, `feedMmMin`, `plungeMmMin`, `safeZMm`,
     *   `toolDiameterMm`, `stockAllowanceMm` (default 0.5), `toolId`.
     */
    'cnc_3d_rough',
    /**
     * 3D Finishing — fine surface pass to hit final geometry tolerance.
     * Uses raster (default) or waterline strategy with tight stepover.
     * Params: `zPassMm`, `stepoverMm`, `feedMmMin`, `plungeMmMin`, `safeZMm`,
     *   `toolDiameterMm`, `finishStrategy` ('raster'|'waterline'|'pencil'),
     *   `finishStepoverMm` (if >0, overrides stepover for finish passes),
     *   `finishScallopMm` + optional `finishScallopMode` ('ball'|'flat') derive stepover when `finishStepoverMm` unset,
     *   optional `rasterRestStockMm` on built-in mesh raster fallback (+Z envelope offset), `toolId`.
     */
    'cnc_3d_finish',
    /**
     * 2D Chamfer — cuts a chamfer along an edge contour using a V-bit or chamfer mill.
     * Params: `contourPoints: [x,y][]`, `chamferAngleDeg` (tool half-angle, default 45),
     * `chamferDepthMm` (cut depth for chamfer profile), `toolDiameterMm`, `feedMmMin`, `safeZMm`.
     */
    'cnc_chamfer',
    /**
     * V-Carve / prismatic carving (Vectric VCarve Pro / Carveco style) — the TRUE
     * variable-depth sign-lettering carve, NOT the single-offset fixed-depth bevel that
     * `cnc_chamfer` produces. From closed input vector(s) a medial-axis ridge is solved
     * (distance-field approximation in `generateVCarve2dLines`); at each ridge point the
     * clearance radius `r` (distance to the nearest boundary) sets the V-bit depth
     * `d = r / tan(vBitAngleDeg/2)`, so the carve is deepest where the shape is widest and
     * runs out to zero at narrow tips — the depth profile is monotonic-with-width.
     * Routes through the SAME 2D dispatch + post as the other `cnc_*` 2D ops
     * (`vcarve_mach3.hbs` for the Laguna Swift); the generic XYZ emitter posts it unchanged.
     * Params: `contourPoints: [x,y][]` (closed loop in setup WCS, mm),
     *   optional `islandRings: Array<Array<[xMm, yMm]>>` (interior HOLE loops, even-odd with
     *     the outer loop — the carve runs BETWEEN outer wall and hole wall, e.g. the counter
     *     of a letter 'O'; auto-set by the nested-ring sketch derive when the picked profile
     *     encloses other closed loops),
     *   `vBitAngleDeg` (FULL included angle of the V-bit, e.g. 60 or 90; default 90),
     *   `maxDepthMm` (HARD depth cap, mm — the carve never plunges past this; further
     *     capped to stock thickness via the runner's `stockBoxZMm` so the V-bit cannot
     *     drive past the material),
     *   optional `flatBottomClearance` (mm — flat-bottom / prism carving: where the carve
     *     saturates the depth cap a SECOND chained section clears the flat floor at
     *     z = -maxDepthMm using this raster stepover plus a rim finish along the inset
     *     boundary, so wide regions get a true flat prism floor; absent ⇒ V-walls only),
     *   optional `stepoverMm` (mm — medial-axis sampling resolution; smaller = finer ridge),
     *   plus the shared `feedMmMin`, `plungeMmMin`, `safeZMm`.
     */
    'cnc_vcarve',
    /**
     * Thread milling — helical thread entry along a contour or single bore.
     * Params: `contourPoints: [x,y][]`, `threadPitchMm`, `threadDepthMm`,
     * `threadDirection` ('right'|'left'), `zPassMm`, `toolDiameterMm`, `feedMmMin`, `safeZMm`.
     */
    'cnc_thread_mill',
    /**
     * Laser — vector or raster laser path (inline with milling ops, same project).
     * Params: `laserMode` ('vector'|'raster'|'fill'), `laserPower` (0–100%),
     * `laserSpeed` (mm/min), `passes` (integer), `contourPoints: [x,y][]` for vector mode.
     */
    'cnc_laser',
    /**
     * PCB isolation (trace/copper clearing) — imported from Gerber or polygon contours.
     * Params: `contourPoints: [x,y][][]` (array of polygons), `isolationDepthMm` (default 0.05),
     * `toolDiameterMm`, `feedMmMin`, `safeZMm`.
     */
    'cnc_pcb_isolation',
    /**
     * PCB drilling — drill holes from Excellon / drill point array.
     * Params: `drillPoints: [x,y][]`, `zPassMm`, `toolDiameterMm`, `feedMmMin`, `safeZMm`.
     */
    'cnc_pcb_drill',
    /**
     * PCB board outline contour — cuts the PCB perimeter with optional tabs.
     * Params: `contourPoints: [x,y][]`, `zPassMm`, `zStepMm`, `tabCount`, `tabWidthMm`,
     * `tabHeightMm`, `toolDiameterMm`, `feedMmMin`, `safeZMm`.
     */
    'cnc_pcb_contour',
    /**
     * Spiral finishing — continuous spiral toolpath for smooth freeform surfaces.
     * Minimal retracts, low vibration. Best for surfaces with low curvature variance.
     * Requires Python toolpath engine. Routes to `spiral_finish` strategy.
     * Params: `toolDiameterMm`, `stepoverMm`, `feedMmMin`, `plungeMmMin`, `safeZMm`.
     */
    'cnc_spiral_finish',
    /**
     * Morphing finish — automatic blend between waterline and raster based on
     * local surface angle. Seamless steep/shallow transitions.
     * Requires Python toolpath engine. Routes to `morphing_finish` strategy.
     * Params: `toolDiameterMm`, `stepoverMm`, `feedMmMin`, `plungeMmMin`, `safeZMm`.
     */
    'cnc_morphing_finish',
    /**
     * Trochoidal HSM — constant chip-load trochoidal clearing for high-speed
     * machining. Reduces tool wear and heat in slotting operations.
     * - **2D contour mode** (when `contourPoints` is set, Stack B v1): alias of
     *   the `cnc_adaptive` 2D engine with a trochoid-heavy default engagement
     *   cap (20% of tool diameter instead of 40%) so relief triggers sooner and
     *   the derived trochoid radius/step shrink with it. Same params + honest
     *   v1 limits as `cnc_adaptive` 2D mode (G1 polyline arcs, no G2/G3); an
     *   explicit `maxEngagementMm` always overrides the default.
     * - **Mesh mode** (no `contourPoints`): the Python `trochoidal_hsm`
     *   toolpath_engine this kind originally targeted was DELETED in the
     *   2026-05-27 pivot — mesh jobs fall through to the built-in parallel
     *   finish (the CAM run reports the fallback). Prefer the 2D contour mode.
     * Params: `toolDiameterMm`, `stepoverMm`, `feedMmMin`, `plungeMmMin`, `safeZMm`, `zPassMm`.
     */
    'cnc_trochoidal_hsm',
    /**
     * Steep-and-shallow finishing — classifies mesh into steep and shallow regions,
     * applies waterline to steep walls and raster to gentle surfaces with an overlap
     * band for seamless blending.
     * Requires Python toolpath engine. Routes to `steep_shallow` strategy.
     * Params: `toolDiameterMm`, `stepoverMm`, `feedMmMin`, `plungeMmMin`, `safeZMm`.
     */
    'cnc_steep_shallow',
    /**
     * Scallop finishing — constant scallop height across 3D surfaces.
     * Adapts XY pass spacing based on local surface angle to maintain uniform
     * residual cusp height. Best finish quality on mixed-curvature freeform.
     * Requires Python toolpath engine. Routes to `scallop` strategy.
     * Params: `toolDiameterMm`, `stepoverMm`, `feedMmMin`, `plungeMmMin`, `safeZMm`,
     *   `surfaceFinishRaUm` (target Ra, default 3.2).
     */
    'cnc_scallop_finish',
    /**
     * 4-axis continuous — simultaneous 4-axis machining with cylindrical heightmap.
     * Tool addresses workpiece radially with helical ramp entries and zigzag axial sweeps.
     * Both roughing and finishing in one pass. Requires `axisCount >= 4`.
     * Routes to the TypeScript 4-axis engine at `src/main/cam-axis4/` (continuous strategy).
     * Params: `toolDiameterMm`, `stepoverMm`, `feedMmMin`, `plungeMmMin`, `safeZMm`,
     *   `cylinderDiameterMm`, `cylinderLengthMm`.
     */
    'cnc_4axis_continuous',
    /**
     * 5-axis contour — simultaneous 5-axis normal-following with collision avoidance.
     * Tool tilts to follow surface normals using A+B axes. BVH-accelerated interference
     * checking with binary-search tilt reduction on collision.
     * Requires `axisCount: 5`. Routes to toolpath_engine `5axis_contour` strategy.
     * Params: `toolDiameterMm`, `stepoverMm`, `feedMmMin`, `plungeMmMin`, `safeZMm`.
     */
    'cnc_5axis_contour',
    /**
     * 5-axis swarf cutting — flank milling for steep/vertical walls.
     * Tool tilts into wall along contour tangent direction for efficient wall finishing.
     * Requires `axisCount: 5`. Routes to toolpath_engine `5axis_swarf` strategy.
     * Params: `toolDiameterMm`, `stepoverMm`, `feedMmMin`, `plungeMmMin`, `safeZMm`.
     */
    'cnc_5axis_swarf',
    /**
     * 5-axis flowline — follows dominant surface direction with smooth angular rate limits.
     * Continuous tool orientation for complex freeform surfaces.
     * Requires `axisCount: 5`. Routes to toolpath_engine `5axis_flowline` strategy.
     * Params: `toolDiameterMm`, `stepoverMm`, `feedMmMin`, `plungeMmMin`, `safeZMm`.
     */
    'cnc_5axis_flowline',
    /**
     * Auto-select strategy — analyzes mesh geometry (surface angles, curvature, aspect ratio)
     * and automatically selects the optimal machining strategy.
     * Requires Python toolpath engine. Routes to `auto` strategy.
     * Params: `toolDiameterMm`, `stepoverMm`, `feedMmMin`, `plungeMmMin`, `safeZMm`.
     */
    'cnc_auto_select',
    /**
     * Probing cycle — generates safe touch-probe G-code for WCS zeroing, bore/boss
     * centering, corner finding, and tool length measurement. Not sent through
     * `cam:run`; uses `probe:generate` IPC directly with `ProbeCycleType` params.
     * 5 cycle types: singleSurface, boreCenter, bossCenter, cornerFind, toolLength.
     */
    'cnc_probe',
    /**
     * Lathe / turning — **planning only** in this release: not posted by the built-in CAM runner.
     * Reserved for future `cam:run` + lathe posts (axis semantics, stock cylinder, G71/G70-class cycles).
     */
    'cnc_lathe_turn',
    'export_stl'
  ]).describe('Operation strategy type'),
  label: z.string().trim().min(1).describe('Human-readable operation label'),
  /** Relative path under project: assets/foo.stl */
  sourceMesh: z.string().optional().describe('Relative path to source mesh under project (e.g. assets/foo.stl)'),
  suppressed: z.boolean().optional().describe('When true, operation is skipped during CAM generation'),
  /**
   * CNC CAM (`cam:run`): optional `toolDiameterMm`, `toolId`, `zPassMm`, `stepoverMm`, `feedMmMin`, `plungeMmMin`, `safeZMm`.
   * 2D milling kinds can also pass geometry as arrays:
   * - contour/pocket: `contourPoints: Array<[xMm, yMm]>`, optional `contourSourceId`,
   *   `contourSourceLabel`, `contourSourceSignature` (for sketch drift checks), `contourDerivedAt` (ISO timestamp),
   *   and contour options `contourSide` ('climb'|'conventional'), `leadInMm`, `leadOutMm`,
   *   `leadInMode` ('linear'|'arc'), `leadOutMode` ('linear'|'arc').
   *   Contour ramp entry: `rampType` ('plunge'|'linear'|'helix', default 'plunge'),
   *   `rampAngleDeg` (default 3: ramp angle from horizontal in degrees).
   *   Contour: optional `zStepMm` when `zPassMm` is negative — multiple full contour passes stepped into material down to `zPassMm`.
   *   True-arc output (Cycle-263, opt-in + tolerance-gated; read by `resolveArcFitOptions`):
   *   optional `arcTolMm` (max chord deviation in mm — when finite and > 0 the 2D contour/pocket
   *   engine collapses co-circular linearized runs into true G2/G3 arcs; absent / <= 0 emits the
   *   exact legacy G1 chain, byte-identical), plus optional refinements `arcMinSweepDeg` (min arc
   *   sweep to fit, default 5) and `arcMinPoints` (min points per arc, default 4). 3-axis only —
   *   flows through `generateContour2dLines` which never carries A/B/C words; meaningful only on
   *   router posts that support circular interpolation (Laguna mach3 / Carvera-3 smoothieware).
   *   Pocket can also set `zStepMm` (optional step-down increment), `entryMode` ('plunge'|'ramp'|'helix'),
   *   `rampMm`, optional `rampMaxAngleDeg` (default 45: max ramp angle from horizontal; XY run may grow),
   *   `wallStockMm` (rough stock to leave), `finishPass` (boolean, default true), and
   *   `finishEachDepth` (boolean, default false).
   *   Pocket HELIX entry (`entryMode: 'helix'`, raster strategy only; routers only): the cut entry
   *   descends on a region-clamped helical bore (G2 arcs via `buildEntryMoves`) instead of a straight
   *   plunge -- the helix radius is clamped so the whole helix stays INSIDE the pocket (outer ring
   *   minus islands), degrading to a bounded ramp then a straight plunge where it cannot fit
   *   (never-degrade). Tunes: `helixRadiusMm` (requested radius, clamped down to fit) and
   *   `entryAngleDeg` (incline from horizontal, clamped to 1-30 deg, default 3). The cutter radius
   *   (from tool diameter) is folded into the fit margin. The offset_spiral strategy maps a helix
   *   request to its inclined ramp entry (with a hint).
   *   Pocket islands + clearing strategy (additive): `islandRings: Array<Array<[xMm, yMm]>>`
   *   (interior keep-out islands subtracted from the clearable region -- raster rows split
   *   around them, the offset strategy grows them by the inset, and island walls get a
   *   final-depth finish contour when `finishPass` is on) and `pocketStrategy`
   *   ('raster'|'offset_spiral', default 'raster' -- 'offset_spiral' clears with successive
   *   concentric insets of (outer - islands) at `wallStockMm + k*stepover`, traced inside-out
   *   with a safe-Z lift between every loop). Pocket depth is hard-capped to the stock
   *   thickness when `stockBoxZMm` is known (clearing passes AND finish contours).
   *   Rest machining (Stack C v1, additive): `restPrevToolDiameterMm` (mm) opts the pocket
   *   family (`cnc_pocket`, and `cnc_adaptive` / `cnc_trochoidal_hsm` in 2D contour mode) into
   *   clearing ONLY the REST REGION -- the material a PREVIOUS, larger tool of that diameter
   *   provably could not reach (square corners, narrow channels): reachable = morphological
   *   opening of the pocket region by the previous tool radius (clipper erode + dilate, round
   *   joins); rest = region minus reachable. The value must be finite and LARGER than this
   *   op's tool diameter or the run fails with an honest validation error; an empty rest (the
   *   previous tool reached everything) is an honest error too, never a crash. In rest mode
   *   the outer-wall AND island finish traces are SUPPRESSED (the previous tool's op already
   *   finished those walls -- re-tracing wastes air / burnishes the wall) and `wallStockMm` is
   *   folded into the rest solve instead of the clearing generator. Ops WITHOUT the param are
   *   untouched (byte-identical output).
   * - adaptive clearing (`cnc_adaptive` / `cnc_trochoidal_hsm` in 2D contour mode, Stack B v1):
   *   `contourPoints` + optional `islandRings` exactly like pocket, plus
   *   `maxEngagementMm` (radial engagement cap, mm; default 40% of tool Ø for `cnc_adaptive`,
   *   20% for `cnc_trochoidal_hsm` -- cut runs whose local bite would exceed the cap get
   *   trochoidal relief; narrow channels are cleared fully trochoidally),
   *   `trochoidRadiusMm` (relief circle radius, default cap/2, clamped to 0.8*cap) and
   *   `trochoidStepMm` (advance per relief circle, default cap/4, clamped to the radius).
   *   Shares the pocket param family (`stepoverMm`, `wallStockMm`, `zStepMm`, `entryMode`,
   *   `rampMm`, `rampMaxAngleDeg`, `finishPass`) and the stock-thickness depth hard-cap.
   *   The adaptive family honors `restPrevToolDiameterMm` too (see the pocket rest-machining
   *   paragraph above) -- note the Stack-B engine SKIPS cusped corner-lobe rest regions with a
   *   hint (use cnc_pocket for those); channel-shaped rest regions cut normally.
   *   v1 honesty: relief arcs are fine G1 polylines (no G2/G3); unrelievable geometry is
   *   skipped with material left + a hint, never slotted above the cap. WITHOUT
   *   `contourPoints` both kinds keep their legacy mesh path (OCL AdaptiveWaterline /
   *   parallel-finish fallback).
   * - drill: `drillPoints: Array<[xMm, yMm]>`, optional `retractMm`, `peckMm`, `dwellMs`,
   *   `drillCycle` ('expanded'|'g73'|'g81'|'g82'|'g83')
   *   and `drillDerivedAt` (ISO timestamp)
   * - pencil (`cnc_pencil`): optional `pencilStepoverMm` (mm, clamped to tool Ø) or `pencilStepoverFactor` (0.05–1, default 0.22)
   *   applied to resolved `stepoverMm` for the tight raster pass.
   * - contour/pcb_contour tab generation: optional `tabsMode` ('none'|'count'|'interval'),
   *   `tabCount` (int, for 'count' mode), `tabIntervalMm` (mm, for 'interval' mode),
   *   `tabWidthMm` (default 3), `tabHeightMm` (default 1.5) — holding bridges auto-inserted.
   * - chamfer (`cnc_chamfer`): `contourPoints: [x,y][]`, `chamferAngleDeg` (default 45),
   *   `chamferDepthMm` (how far below surface to reach full width), `toolDiameterMm`, `feedMmMin`.
   * - vcarve (`cnc_vcarve`): `contourPoints: [x,y][]` (closed loop), `vBitAngleDeg` (FULL included
   *   V-bit angle, default 90), `maxDepthMm` (hard depth cap; also capped to stock thickness),
   *   optional `islandRings: Array<Array<[xMm, yMm]>>` (interior hole loops, even-odd with the
   *   outer — the ridge runs between outer wall and hole wall; auto-set by the nested-ring
   *   sketch derive), optional `flatBottomClearance` (mm, flat-bottom prism floor: raster
   *   stepover for the chained floor-clearance section emitted where the carve saturates the
   *   cap), optional `stepoverMm` (medial-axis sampling resolution), `feedMmMin`, `plungeMmMin`,
   *   `safeZMm`.
   * - laser (`cnc_laser`): `laserMode` ('vector'|'raster'|'fill'), `laserPower` (0–100),
   *   `laserSpeed` mm/min, `passes`, `contourPoints` for vector/fill.
   * See `resolveCamCutParams` / `resolveCamToolDiameterMm` for defaults.
   */
  params: z
    .record(z.string(), jsonSafeValueSchema)
    .optional()
    .describe('Strategy-specific operation parameters (validated at runtime per operation kind)')
})

/**
 * Plate — a self-contained Setup + Operation bundle (Gap #7 v1).
 *
 * Both OrcaSlicer and Bambu Studio center their FDM workflow on plates; CNC has
 * the same idea (a "job" = one plate). A project file can carry multiple plates
 * so the user can prototype, e.g., 5 K2 calibration tests in one session without
 * switching projects. Each plate has its own `setups` + `operations` arrays —
 * the underlying CAM runners and post-processors consume those arrays per plate
 * exactly as they did pre-plate (Safety Rule 1: G-code emission unchanged).
 *
 * v1 scope (this cycle): the plate concept exists in the file format, the
 * renderer has a tab strip to switch between plates, and migration auto-wraps
 * legacy top-level setups+operations into `plates[0]`. Future cycles add
 * batch-slice-all-plates, copy-op-across-plates, and per-plate Moonraker push
 * queueing.
 */
export const plateSchema = z.object({
  id: z.string().trim().min(1).describe('Unique plate identifier'),
  label: z.string().trim().min(1).describe('Human-readable plate label shown in the tab strip'),
  createdAt: z.string().optional().describe('ISO timestamp when the plate was first created'),
  setups: z.array(setupSchema).default([]).describe('Per-plate manufacturing setups'),
  operations: z
    .array(manufactureOperationSchema)
    .default([])
    .describe('Per-plate ordered list of manufacturing operations')
})

export type Plate = z.infer<typeof plateSchema>

/**
 * Manufacture file schema.
 *
 * v1: `{ version: 1, setups, operations }` — single-plate, no `plates` field.
 * v2: `{ version: 2, setups, operations, plates: Plate[] }` — `plates` carries
 *     the active per-plate bundles. Top-level `setups` + `operations` are
 *     retained as empty arrays in v2 (kept for back-compat with the IPC
 *     surface and any reader that has not been migrated to read from `plates`).
 *     The renderer / CAM runners prefer `plates` when present.
 *
 * Both versions are accepted by the schema so a v1 file on disk parses without
 * a migration round-trip — the migration pipeline (`buildMigrationPipeline`,
 * see `src/shared/schema-migration.ts`) is the canonical path invoked by
 * `ipc-fabrication.ts` on load.
 */
export const manufactureFileSchema = z.object({
  version: z
    .union([z.literal(1), z.literal(2)])
    .describe('Schema version for migration support (1 = pre-plate, 2 = plates[])'),
  setups: z.array(setupSchema).default([]).describe('Manufacturing setups (machine, stock, WCS)'),
  operations: z
    .array(manufactureOperationSchema)
    .default([])
    .describe('Ordered list of manufacturing operations'),
  /**
   * v2 plates. Optional so v1 files (which never had this field) and minimal
   * v2 files parse cleanly. When present and non-empty, the renderer treats
   * `plates` as the source of truth and `setups`/`operations` at the top
   * level as a deprecated mirror.
   */
  plates: z.array(plateSchema).optional().describe('v2: per-plate Setup + Operation bundles')
})

export type ManufactureFile = z.infer<typeof manufactureFileSchema>
export type ManufactureOperation = z.infer<typeof manufactureOperationSchema>
export type ManufactureOperationKind = ManufactureOperation['kind']

/**
 * Whether this operation kind uses the CNC CAM path (`cam:run`, tool / cut params).
 * Convention: CNC kinds use the `cnc_` prefix — keep that when extending the enum above.
 */
export function isManufactureCncOperationKind(kind: ManufactureOperationKind): boolean {
  return kind.startsWith('cnc_')
}

/** Stable default-plate id used when migrating v1 files and bootstrapping new v2 files. */
export const DEFAULT_PLATE_ID = 'plate-default'

/** Construct a fresh empty default plate (id-stable for tests + migration). */
export function createDefaultPlate(): Plate {
  return {
    id: DEFAULT_PLATE_ID,
    label: 'Default plate',
    setups: [],
    operations: []
  }
}

/**
 * Build an empty v2 manufacture file containing one default plate.
 *
 * v2 invariant: at least one plate exists in `plates` so the renderer has
 * something to render in the new tab strip. The top-level `setups`/`operations`
 * arrays are kept empty for back-compat (see `manufactureFileSchema` doc).
 */
export function emptyManufacture(): ManufactureFile {
  return {
    version: 2,
    setups: [],
    operations: [],
    plates: [createDefaultPlate()]
  }
}

/** Current canonical schema version (Gap #7 v1: bumped to 2 for plates). */
const MANUFACTURE_CURRENT_VERSION = 2

/**
 * Parse and migrate a manufacture.json payload.
 *
 * Accepts both v1 and v2 shapes. v1 inputs are auto-wrapped into a v2 with one
 * `Default plate` containing the legacy top-level setups + operations. v2 inputs
 * pass through after schema validation.
 *
 * For the canonical IPC migration path see `manufactureMigrationPipeline` in
 * `src/main/ipc-fabrication.ts` — it uses `buildMigrationPipeline` from
 * `src/shared/schema-migration.ts`.
 */
export function parseManufactureFile(raw: unknown): ManufactureFile {
  const parsed = manufactureFileSchema.parse(raw)
  if (parsed.version === MANUFACTURE_CURRENT_VERSION) return parsed
  // v1 -> v2 inline migration so direct callers (tests, legacy paths) get a v2.
  return upgradeManufactureV1toV2(parsed)
}

/**
 * Inline v1 -> v2 upgrade used by `parseManufactureFile`.
 *
 * Wraps the legacy top-level setups + operations into a single default plate.
 * If both arrays are empty, still emits a single empty plate so the renderer
 * always has at least one tab to show.
 *
 * Top-level setups + operations are kept (cleared to empty) for back-compat —
 * any IPC surface that still reads from the top level sees `[]` and falls
 * through to the plate-aware path.
 */
export function upgradeManufactureV1toV2(v1: ManufactureFile): ManufactureFile {
  if (v1.version === 2) return v1
  const legacyPlate: Plate = {
    id: DEFAULT_PLATE_ID,
    label: 'Default plate',
    setups: v1.setups,
    operations: v1.operations
  }
  return {
    version: 2,
    setups: [],
    operations: [],
    plates: [legacyPlate]
  }
}
