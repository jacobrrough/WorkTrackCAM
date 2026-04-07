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
  rotaryStockProfile: z.enum(['cylinder', 'square']).optional().describe('Rotary stock cross-section: cylinder or square')
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
    /** Adaptive clearing — OpenCAMLib `AdaptiveWaterline` when available; else built-in parallel finish from STL bounds (CAM run reports fallback reason). */
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
     * Trochoidal HSM — constant chip-load trochoidal slot clearing for high-speed
     * machining. Reduces tool wear and heat in slotting operations.
     * Requires Python toolpath engine. Routes to `trochoidal_hsm` strategy.
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
     * Routes to toolpath_engine `axis4_continuous` strategy.
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
   *   Pocket can also set `zStepMm` (optional step-down increment), `entryMode` ('plunge'|'ramp'),
   *   `rampMm`, optional `rampMaxAngleDeg` (default 45: max ramp angle from horizontal; XY run may grow),
   *   `wallStockMm` (rough stock to leave), `finishPass` (boolean, default true), and
   *   `finishEachDepth` (boolean, default false).
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
   * - laser (`cnc_laser`): `laserMode` ('vector'|'raster'|'fill'), `laserPower` (0–100),
   *   `laserSpeed` mm/min, `passes`, `contourPoints` for vector/fill.
   * See `resolveCamCutParams` / `resolveCamToolDiameterMm` for defaults.
   */
  params: z
    .record(z.string(), jsonSafeValueSchema)
    .optional()
    .describe('Strategy-specific operation parameters (validated at runtime per operation kind)')
})

export const manufactureFileSchema = z.object({
  version: z.literal(1).describe('Schema version for migration support'),
  setups: z.array(setupSchema).default([]).describe('Manufacturing setups (machine, stock, WCS)'),
  operations: z.array(manufactureOperationSchema).default([]).describe('Ordered list of manufacturing operations')
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

export function emptyManufacture(): ManufactureFile {
  return { version: 1, setups: [], operations: [] }
}

/** Current canonical schema version. Bump when adding v2 migrations. */
const MANUFACTURE_CURRENT_VERSION = 1

/**
 * Parse and migrate a manufacture.json payload.
 *
 * Currently v1 -> v1 (identity), but the infrastructure is in place so that
 * a future v2 only needs:
 *   1. Widen the incoming version literal to `z.union([z.literal(1), z.literal(2)])`
 *   2. Add a `migrateV1toV2()` function
 *   3. Bump MANUFACTURE_CURRENT_VERSION
 *
 * Follows the same pattern as `parseAssemblyFile()` in assembly-schema.ts.
 */
export function parseManufactureFile(raw: unknown): ManufactureFile {
  const parsed = manufactureFileSchema.parse(raw)
  // Future: if (parsed.version !== MANUFACTURE_CURRENT_VERSION) return migrateToLatest(parsed)
  void MANUFACTURE_CURRENT_VERSION // referenced to prevent unused-variable lint
  return parsed
}
