/**
 * 4-Axis Pre-Generation Validation
 *
 * Hard pre-generation checks replace silent clamps and post-hoc warnings.
 * Principle: if the job is geometrically impossible or unsafe, fail loudly
 * with an actionable hint BEFORE generating any G-code, rather than producing
 * a half-broken toolpath the user has to interpret.
 *
 * Specific invariants enforced here that regressed in the legacy engine:
 *   - `meshRadialMax > stockRadius` is now a hard error. The legacy engine
 *     silently clamped to stock OD, producing undercut parts.
 *   - Extended machinable X is enforced ≥ 0 by the emitter / strategies so
 *     overcut moves never drive into the chuck face.
 */
import type { MeshFrameResult, Stock } from './frame'

export type ValidationContext = {
  operationKind: string
  stock: Stock
  /** Axis count from the machine profile. */
  axisCount: number
  /** Machine A-axis orientation: 'x' (rotates around X) or 'y' (around Y). */
  aAxisOrientation: 'x' | 'y'
  /** Post-process dialect (e.g. 'cnc_4axis_grbl'). v1 only accepts grbl. */
  dialect: string
  /** Frame transform output to validate against the stock envelope. */
  frame: MeshFrameResult
  /** Machinable X span after chuck/clamp deductions. */
  machXStartMm: number
  machXEndMm: number
  /** Optional contour points for cnc_4axis_contour. */
  contourPoints?: ReadonlyArray<readonly [number, number]>
  /** Optional indexed angles for cnc_4axis_indexed. */
  indexAnglesDeg?: ReadonlyArray<number>
  /** Machine A-axis travel limit (degrees, ± from home). */
  aAxisRangeDeg?: number
  /** Radial depth-per-pass (negative; depth into stock surface). */
  zPassMm: number
}

export type ValidationFailure = {
  ok: false
  error: string
  hint: string
}

export type ValidationSuccess = {
  ok: true
  warnings: string[]
}

export type ValidationResult = ValidationFailure | ValidationSuccess

const FOUR_AXIS_KINDS = new Set([
  'cnc_4axis_roughing',
  'cnc_4axis_finishing',
  'cnc_4axis_contour',
  'cnc_4axis_indexed',
  'cnc_4axis_continuous'
])

/**
 * Run all 4-axis pre-generation checks. Returns the first failure encountered,
 * or `{ ok: true, warnings }` if all checks pass.
 *
 * Order of checks is intentional: cheapest / most fundamental first so that
 * later checks can rely on earlier invariants (e.g. axis count gates everything).
 */
export function validateAxis4Job(ctx: ValidationContext): ValidationResult {
  const warnings: string[] = []

  // ── Operation kind ────────────────────────────────────────────────────────
  if (!FOUR_AXIS_KINDS.has(ctx.operationKind)) {
    return {
      ok: false,
      error: `validateAxis4Job called with non-4-axis kind '${ctx.operationKind}'.`,
      hint: 'This is an internal dispatch error — only 4-axis kinds should reach this validator.'
    }
  }

  // ── Machine: axis count ───────────────────────────────────────────────────
  if (ctx.axisCount < 4) {
    return {
      ok: false,
      error: `Operation '${ctx.operationKind}' requires a machine with axisCount ≥ 4.`,
      hint: `The selected machine profile is configured as a ${ctx.axisCount}-axis machine. Switch to the 'Makera Carvera (4th Axis)' profile or another profile with axisCount: 4.`
    }
  }

  // ── Machine: A-axis orientation ──────────────────────────────────────────
  // v1 of the new engine only supports A around X. Y-axis rotary (e.g. some
  // Mach3 / LinuxCNC profiles) is rejected with an actionable hint. TODO: add
  // a Y-axis branch in `frame.ts` and `heightmap.ts` when there's a real user
  // demand.
  if (ctx.aAxisOrientation !== 'x') {
    return {
      ok: false,
      error: `4-axis engine v1 only supports A-axis around X (got '${ctx.aAxisOrientation}').`,
      hint: 'Set aAxisOrientation: "x" on the machine profile, or open an issue if your machine truly rotates around Y.'
    }
  }

  // ── Post-process dialect ──────────────────────────────────────────────────
  // v1 only emits the GRBL/Carvera template. The other 4-axis dialects
  // (fanuc/mach3/linuxcnc/siemens/heidenhain) have been removed from
  // `resources/posts/`; `machine-cps-import.ts` repoints them to the grbl
  // template with a warning so existing user machine profiles still import.
  if (!/grbl/i.test(ctx.dialect)) {
    return {
      ok: false,
      error: `4-axis engine v1 only emits the GRBL/Carvera dialect (got '${ctx.dialect}').`,
      hint: 'Set the post-process dialect to cnc_4axis_grbl on the machine profile.'
    }
  }

  // ── Stock geometry ────────────────────────────────────────────────────────
  if (!(ctx.stock.lengthMm > 0)) {
    return {
      ok: false,
      error: `Rotary stock length must be > 0 mm (got ${ctx.stock.lengthMm}).`,
      hint: 'Set rotary stock length on the job.'
    }
  }
  if (!(ctx.stock.diameterMm > 0)) {
    return {
      ok: false,
      error: `Rotary stock diameter must be > 0 mm (got ${ctx.stock.diameterMm}).`,
      hint: 'Set rotary stock diameter on the job.'
    }
  }
  const stockRadius = ctx.stock.diameterMm / 2

  // ── Z pass / depth-per-pass ───────────────────────────────────────────────
  // The 4-axis convention is `zPassMm < 0` (radial depth into the cylinder).
  // Positive values would place the tool outside the stock; near-zero would
  // produce no cut at all.
  if (!Number.isFinite(ctx.zPassMm)) {
    return {
      ok: false,
      error: `zPassMm must be a finite number (got ${ctx.zPassMm}).`,
      hint: 'Set the radial depth-per-pass on the operation.'
    }
  }
  // Accept either sign — the runner normalizes to negative — but reject magnitudes
  // larger than the stock radius (would cut past the rotation axis).
  if (Math.abs(ctx.zPassMm) > stockRadius + 0.1) {
    return {
      ok: false,
      error: `zPassMm magnitude (${Math.abs(ctx.zPassMm).toFixed(2)} mm) exceeds stock radius (${stockRadius.toFixed(2)} mm).`,
      hint: 'Reduce the depth-per-pass or increase rotary stock diameter — the engine cannot cut past the rotation axis.'
    }
  }

  // ── Machinable X span ─────────────────────────────────────────────────────
  // The chuck face is at machine X=0; tools must never enter X<0 (would crash
  // into the chuck). The machinable end is bounded by stock length minus any
  // clamp/tail offset.
  if (ctx.machXStartMm < 0) {
    return {
      ok: false,
      error: `Machinable X start (${ctx.machXStartMm.toFixed(2)} mm) is negative — would drive tool into chuck face.`,
      hint: 'Increase chuck depth or clamp offset, or check rotaryChuckDepthMm/rotaryClampOffsetMm on the job.'
    }
  }
  if (ctx.machXEndMm <= ctx.machXStartMm + 0.1) {
    return {
      ok: false,
      error: `Machinable X span is empty: start=${ctx.machXStartMm.toFixed(2)}, end=${ctx.machXEndMm.toFixed(2)}.`,
      hint: 'Reduce chuck depth/clamp offset, or increase rotary stock length.'
    }
  }
  if (ctx.machXEndMm > ctx.stock.lengthMm + 0.1) {
    return {
      ok: false,
      error: `Machinable X end (${ctx.machXEndMm.toFixed(2)} mm) exceeds stock length (${ctx.stock.lengthMm.toFixed(2)} mm).`,
      hint: 'Reduce machinable X end or increase rotary stock length.'
    }
  }

  // ── Mesh frame: radial extent vs stock OD ─────────────────────────────────
  // CRITICAL — replaces the silent clamp at cam-axis4-cylindrical-raster.ts:228
  // that produced the "undercut" bug. If the user's mesh sticks out past the
  // stock OD, the engine cannot cut it — fail loudly with a fix-it hint.
  if (ctx.frame.meshRadialMax > stockRadius + 0.05) {
    const minDiameter = 2 * ctx.frame.meshRadialMax
    return {
      ok: false,
      error: `Mesh extends ${(ctx.frame.meshRadialMax - stockRadius).toFixed(2)} mm past the stock OD after the user transform was applied.`,
      hint: `Increase rotary stock Ø to ≥ ${minDiameter.toFixed(1)} mm, or scale/reposition the model so its maximum radial extent (${ctx.frame.meshRadialMax.toFixed(2)} mm) fits inside the stock radius (${stockRadius.toFixed(2)} mm).`
    }
  }

  // ── Mesh frame: axial bounds vs machinable span ───────────────────────────
  // CRITICAL — this is the "toolpath doesn't map to the model" symptom
  // surfacing as a clear error instead of silent miscentering. If after the
  // user transform the mesh's X bbox is outside [0, stockLengthMm], the user
  // moved the gizmo to a place the machine cannot reach. Show the actual
  // bbox so they can debug.
  const meshMinX = ctx.frame.bbox.min[0]
  const meshMaxX = ctx.frame.bbox.max[0]
  if (meshMinX < -0.5 || meshMaxX > ctx.stock.lengthMm + 0.5) {
    return {
      ok: false,
      error: `Mesh bbox X=[${meshMinX.toFixed(2)}, ${meshMaxX.toFixed(2)}] does not fit inside stock X=[0, ${ctx.stock.lengthMm.toFixed(2)}].`,
      hint: 'Move the model along X using the gizmo so it sits within the stock cylinder, or increase rotary stock length.'
    }
  }
  if (meshMaxX < 0 || meshMinX > ctx.stock.lengthMm) {
    return {
      ok: false,
      error: `Mesh bbox X=[${meshMinX.toFixed(2)}, ${meshMaxX.toFixed(2)}] is entirely outside stock X=[0, ${ctx.stock.lengthMm.toFixed(2)}].`,
      hint: 'Reposition the model in X using the gizmo. The toolpath cannot reach this position.'
    }
  }

  // Soft warning if the mesh barely overlaps the machinable span.
  const overlap = Math.min(meshMaxX, ctx.machXEndMm) - Math.max(meshMinX, ctx.machXStartMm)
  if (overlap < 0.5) {
    warnings.push(
      `Mesh X bounds [${meshMinX.toFixed(2)}, ${meshMaxX.toFixed(2)}] barely overlap machinable span [${ctx.machXStartMm.toFixed(2)}, ${ctx.machXEndMm.toFixed(2)}]. Most of the mesh is in chuck/tail clearance zones.`
    )
  }

  // ── Operation-specific checks ─────────────────────────────────────────────
  if (ctx.operationKind === 'cnc_4axis_contour') {
    const cpts = ctx.contourPoints ?? []
    if (cpts.length < 2) {
      return {
        ok: false,
        error: '4-axis contour wrapping requires at least 2 contour points.',
        hint: 'Add contourPoints to the operation, or apply a sketch contour from the Manufacture plan. See docs/CAM_4TH_AXIS_REFERENCE.md.'
      }
    }
    // Check axial bounds — contour X must fit in machinable span.
    let minCx = Infinity
    let maxCx = -Infinity
    for (const [cx] of cpts) {
      if (cx < minCx) minCx = cx
      if (cx > maxCx) maxCx = cx
    }
    if (minCx < ctx.machXStartMm - 0.5 || maxCx > ctx.machXEndMm + 0.5) {
      return {
        ok: false,
        error: `Contour X bounds [${minCx.toFixed(2)}, ${maxCx.toFixed(2)}] do not fit inside machinable span [${ctx.machXStartMm.toFixed(2)}, ${ctx.machXEndMm.toFixed(2)}].`,
        hint: 'Move or trim the contour points to stay within the machinable axial range.'
      }
    }
    // Soft closure check (warning only).
    if (cpts.length >= 3) {
      const [fx, fy] = cpts[0]!
      const [lx, ly] = cpts[cpts.length - 1]!
      const gap = Math.hypot(lx - fx, ly - fy)
      if (gap > 0.5) {
        warnings.push(
          `Contour wrap: polyline is not closed (endpoints ${gap.toFixed(2)} mm apart). The toolpath will be open — close the loop in WCS for predictable unwrap.`
        )
      }
    }
  }

  if (ctx.operationKind === 'cnc_4axis_indexed') {
    const angles = ctx.indexAnglesDeg ?? []
    if (angles.length < 1) {
      return {
        ok: false,
        error: '4-axis indexed passes require at least one indexAnglesDeg entry.',
        hint: 'Add indexAnglesDeg to the operation as an array of degree values.'
      }
    }
    if (ctx.aAxisRangeDeg != null && Number.isFinite(ctx.aAxisRangeDeg) && ctx.aAxisRangeDeg > 0) {
      const limit = Math.abs(ctx.aAxisRangeDeg)
      const out = angles.filter((a) => Math.abs(a) > limit + 1e-6)
      if (out.length > 0) {
        return {
          ok: false,
          error: `Indexed angles [${out.map((a) => a.toFixed(1)).join(', ')}] exceed machine A-axis range ±${limit.toFixed(1)}°.`,
          hint: 'Remove out-of-range angles, or increase aAxisRangeDeg on the machine profile if the machine truly supports them.'
        }
      }
    }
    // Duplicate check (soft warning).
    const seen = new Set<number>()
    const dups: number[] = []
    for (const a of angles) {
      const key = Math.round(a * 100) / 100
      if (seen.has(key)) dups.push(a)
      seen.add(key)
    }
    if (dups.length > 0) {
      warnings.push(`Indexed angles contain duplicates: [${dups.map((a) => a.toFixed(2)).join(', ')}].`)
    }
  }

  return { ok: true, warnings }
}
