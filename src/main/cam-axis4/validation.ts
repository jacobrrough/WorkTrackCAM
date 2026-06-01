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
  /**
   * Defense-in-depth: machine profile flag (`machineProfile.yAxisMustBeZero`).
   * When true, the validator rejects any toolpath segment with a non-zero
   * machine-Y component (see `toolpathYValues`). The Carvera 4-axis HD
   * REQUIRES Y=0 because the rotary headstock centers the stock on Y=0;
   * non-zero Y would drive the cutter off-axis. See machineProfileSchema.
   */
  yAxisMustBeZero?: boolean
  /**
   * Optional array of machine-frame Y values from toolpath segments. When
   * absent (the typical 4-axis case: the strategies build Y=0 by
   * construction), the `yAxisMustBeZero` gate is a no-op. Callers that
   * author raw G-code with explicit Y components should pass those Y
   * values here so the gate fires before the post-emit `G0 Y0` silently
   * re-centers the toolpath.
   */
  toolpathYValues?: ReadonlyArray<number>
  /**
   * Defense-in-depth: machine profile field
   * (`machineProfile.rotaryHeadstockXOffsetMm`). For 4-axis CNC machines,
   * the validator REQUIRES this field to be set so a profile imported from
   * a `.cps` file or hand-edited without it is rejected with an actionable
   * hint instead of producing G-code against an unknown chuck position.
   */
  rotaryHeadstockXOffsetMm?: number
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

  // ── Machine: rotary headstock X-offset (defense-in-depth) ────────────────
  // Pre-launch punch-list rank 13: every 4-axis CNC job must have an
  // operator-measured X offset from spindle X=0 to the chuck face. Today the
  // post template hardcodes `G0 Y0` and the chuck-span validator catches
  // most cases, but a profile imported from a `.cps` file or hand-edited
  // without `rotaryHeadstockXOffsetMm` would emit G-code against an unknown
  // chuck position. Reject up front so the operator fixes the profile
  // BEFORE air-cutting. Run this early so the failure message is
  // deterministic when other invariants are also violated.
  const headstockCheck = assertRotaryHeadstockXOffsetSet({
    axisCount: ctx.axisCount,
    rotaryHeadstockXOffsetMm: ctx.rotaryHeadstockXOffsetMm
  })
  if (headstockCheck !== null) {
    return headstockCheck
  }

  // ── Machine: yAxisMustBeZero toolpath-Y sanity (defense-in-depth) ────────
  // Pre-launch punch-list rank 13: when the machine profile declares
  // `yAxisMustBeZero: true` (Carvera 4-axis HD), reject any toolpath
  // segment with a non-zero machine-Y value. The post template emits
  // `G0 Y0` unconditionally as the bottom of the safety stack; this gate
  // surfaces misconfiguration BEFORE the post can silently re-center.
  //
  // NOTE: the 4-axis `contourPoints` field's second component is the
  // unwrap-circumference distance (not machine Y) -- the strategy maps
  // that to A-axis angles and builds machine Y=0 by construction. So this
  // gate is a no-op for the typical contour/roughing/finishing/indexed
  // job (`toolpathYValues` is omitted). The gate exists to catch future
  // callers who author raw machine-frame Y values directly.
  const yCheck = assertYAxisIsZeroForProfile({
    yAxisMustBeZero: ctx.yAxisMustBeZero,
    toolpathYValues: ctx.toolpathYValues
  })
  if (yCheck !== null) {
    return yCheck
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

// ───────────────────────────────────────────────────────────────────────────
// Defense-in-depth validators -- punch-list rank 13
// ───────────────────────────────────────────────────────────────────────────
//
// Two standalone validators that ALSO compose into validateAxis4Job above.
// They are exported so callers that drive a partial validation chain (e.g. a
// UI preflight that only knows the machine profile and contour points) can
// reuse the exact same error wording without re-implementing the gates.
//
// Convention: each returns `null` on success, or a `ValidationFailure` to
// surface the structured error envelope. validateAxis4Job composes by
// short-circuiting on any non-null return. This mirrors the existing
// "fail-fast with actionable hint" pattern at the top of the file.

/**
 * When the machine profile's `yAxisMustBeZero` flag is true, reject any
 * toolpath segment that requests non-zero machine-Y motion. Today's safety
 * stack relies on the post-emit hardcoded `G0 Y0` in
 * `resources/posts/carvera_4axis.hbs`, which silently re-centers the tool;
 * this validator surfaces the upstream misconfiguration as a hard error
 * BEFORE G-code is emitted, so an operator hand-editing a profile (or an
 * imported `.cps` file) cannot accidentally request off-axis motion.
 *
 * IMPORTANT distinction from the 4-axis `contourPoints` shape:
 *   contourPoints: ReadonlyArray<[axialX, unwrapDistance]>
 *     -- the second component is the unwrap-circumference distance (which
 *     the strategy linearizes to an A-axis angle), NOT machine Y. The
 *     strategy builds Y=0 by construction. So this validator does NOT scan
 *     contour points -- it scans an explicit `toolpathYValues` array that
 *     callers compose when they author raw machine-frame G-code segments
 *     (the only path where machine Y can be non-zero).
 *
 * Pattern/raster/indexed/contour strategies all build Y=0 internally so
 * they are safe by construction. This validator is a defense-in-depth
 * gate for: (a) future strategies that expose Y to the caller, (b) custom
 * G-code pasted in from a `.cps` import, (c) hand-edited toolpaths.
 *
 * Returns null on success; ValidationFailure on rejection. Designed so
 * `validateAxis4Job` can short-circuit with `if (r !== null) return r`.
 */
export function assertYAxisIsZeroForProfile(input: {
  yAxisMustBeZero?: boolean
  /**
   * Optional array of machine-frame Y values from toolpath segments. When
   * absent or empty (the typical case for contour/pattern/indexed jobs),
   * the validator is a no-op gate -- the strategies build Y=0 internally.
   * Callers that author raw G-code with explicit Y components should pass
   * those Y values here so the gate fires before the post.
   */
  toolpathYValues?: ReadonlyArray<number>
}): ValidationFailure | null {
  if (input.yAxisMustBeZero !== true) return null
  const ys = input.toolpathYValues ?? []
  for (let i = 0; i < ys.length; i++) {
    const y = ys[i]!
    if (Math.abs(y) > 1e-6) {
      return {
        ok: false,
        error: `Machine profile requires Y=0 (yAxisMustBeZero) but toolpath segment ${i} has Y=${y.toFixed(4)}.`,
        hint: 'The Carvera 4-axis HD setup keeps the tool centered on the rotary axis (Y=0); remove the non-zero Y component from the toolpath, or pick a machine profile that allows Y motion.'
      }
    }
  }
  return null
}

/**
 * For 4-axis CNC machines (axisCount === 4), require the machine profile to
 * declare `rotaryHeadstockXOffsetMm` (operator-measured offset from spindle
 * X=0 to the chuck face). A profile imported from a `.cps` file or hand-
 * edited without this field would generate G-code against an unknown chuck
 * position, defeating the operator's runbook G54 X setup. Reject early so
 * the operator fixes the profile BEFORE air-cutting.
 *
 * Machines below 4 axes (3-axis CNC, FDM) skip the check -- the field has
 * no meaning when there is no rotary fixture.
 *
 * Returns null on success; ValidationFailure on rejection. Designed so
 * `validateAxis4Job` can short-circuit with `if (r !== null) return r`.
 */
export function assertRotaryHeadstockXOffsetSet(input: {
  axisCount: number
  rotaryHeadstockXOffsetMm?: number
}): ValidationFailure | null {
  if (input.axisCount !== 4) return null
  const val = input.rotaryHeadstockXOffsetMm
  if (val == null || !Number.isFinite(val)) {
    return {
      ok: false,
      error: '4-axis machine profile is missing rotaryHeadstockXOffsetMm.',
      hint: 'Add `rotaryHeadstockXOffsetMm` (mm offset from spindle X=0 to the rotary chuck face) to the machine profile. The bundled Makera Carvera 4-axis profile uses 5 mm. Until this field is set, G-code cannot be generated safely against an unknown chuck position.'
    }
  }
  return null
}
