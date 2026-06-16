/**
 * 4-Axis CAM Engine — Public Facade
 *
 * Single entry point for every 4-axis operation. Replaces the ~360-line
 * dispatch block at `cam-runner.ts:1163-1559`.
 *
 * Pipeline:
 *   1. Read STL → triangles
 *   2. `frame.ts` — apply user gizmo transform (or identity) → machine frame
 *   3. `validation.ts` — pre-generation hard checks (no silent clamps)
 *   4. Dispatch to one of 6 strategies (roughing/finishing/contour/indexed/
 *      pattern/continuous) based on `operationKind`
 *   5. `renderPost` — render through the GRBL/Carvera template
 *
 * The facade does not know anything about IPC, file paths beyond the input
 * STL, or the renderer. It returns a `CamRunResult` shaped exactly like the
 * one `cam-runner.ts` produces for other ops, so the caller can drop it in.
 */
import { readFile, writeFile } from 'node:fs/promises'
import type { MachineProfile } from '../../shared/machine-schema'
import { parse4AxisParams } from '../../shared/cam-4axis-params'
import {
  rotaryMachinableXSpanMm,
  rotaryMeshStockAlignmentHint
} from '../../shared/cam-setup-defaults'
import {
  formatMachineEnvelopeHintForPostedGcode,
  formatRotaryRadialHintForPostedGcode
} from '../../shared/cam-machine-envelope'
import {
  collectAsciiStlTriangles,
  collectBinaryStlTriangles,
  isBinaryStlLayout,
  isLikelyAsciiStl
} from '../stl'
import { renderPost } from '../post-process'
import {
  identityPlacement,
  meshToMachineFrame,
  type Placement,
  type Triangle
} from './frame'
import { validateAxis4Job } from './validation'
import { surfaceStepoverDegFromMm } from './rasterize'
import { generateRoughing } from './strategies/roughing'
import { generateFinishing } from './strategies/finishing'
import { generateContour } from './strategies/contour'
import { generateIndexed } from './strategies/indexed'
import { generatePattern } from './strategies/pattern'
import { generateContinuous } from './strategies/continuous'
import { extractPostProcessingOpts, manufactureKindUses4AxisEngine } from './runner-shims'
import { extractToolpathSegments4AxisFromGcode } from '../../shared/cam-gcode-toolpath'
import {
  checkRotaryFixtureCollision,
  formatRotaryCollisionWarnings,
  type RotaryFixtureConfig
} from '../../shared/rotary-collision'

// Re-export for cam-runner.ts so it can keep its existing dispatch import.
export { manufactureKindUses4AxisEngine }
// Re-export the Placement type so cam-runner.ts and other consumers can
// strongly type the optional gizmo transform.
export type { Placement } from './frame'

/** Job config consumed by the 4-axis facade. Mirrors `CamJobConfig` fields used here. */
export type Axis4JobConfig = {
  stlPath: string
  outputGcodePath: string
  machine: MachineProfile
  resourcesRoot: string
  zPassMm: number
  stepoverMm: number
  feedMmMin: number
  plungeMmMin: number
  safeZMm: number
  operationKind: string
  operationLabel?: string
  operationParams?: Record<string, unknown>
  workCoordinateIndex?: number
  toolDiameterMm?: number
  toolSlot?: number
  rotaryStockLengthMm?: number
  rotaryStockDiameterMm?: number
  rotaryChuckDepthMm?: number
  rotaryClampOffsetMm?: number
  /** User gizmo transform (Three.js viewer space). Defaults to identity. */
  placement?: Placement
  /**
   * Optional rotary fixture geometry for the chuck (and optional tailstock)
   * collision sweep. When present, every 4-axis toolpath segment is checked
   * against the fixture cylinders and any violations are surfaced as warnings
   * on the result. When omitted, the chuck-radius sweep is skipped — the
   * existing X-span validator still catches contour points inside the chuck's
   * axial footprint; this extra check is the radial extent guard.
   */
  rotaryFixture?: RotaryFixtureConfig
}

export type Axis4Result =
  | {
      ok: true
      gcode: string
      usedEngine: 'builtin'
      engine: { requestedEngine: 'builtin'; usedEngine: 'builtin'; fallbackApplied: false }
      hint: string
      warnings?: string[]
    }
  | { ok: false; error: string; hint?: string }

const UNVERIFIED =
  'Posted with the new 4-axis engine — run an air cut with spindle OFF before any real cut.'

/**
 * Normalize zPass to a negative radial depth (the convention the strategies
 * expect). Pairs with [ID-0178] depth-passes-contract pin set: any drift in
 * the sign-coercion or zero-fallback semantics will surface as a focused
 * test failure in `__tests__/depth-passes-contract.test.ts` -- production
 * callers (`runAxis4`, `cam-runner.ts`) treat the return value as a
 * strictly-negative cut depth and rely on the -0.5 default for zPass=0.
 *
 * Contract:
 *   - `zPassMm < -1e-9` -> returned unchanged (already negative)
 *   - `zPassMm > 1e-9`  -> returned as `-Math.abs(zPassMm)` (sign-flipped)
 *   - `|zPassMm| <= 1e-9` (i.e. zero) -> returned as `-0.5` (sentinel default)
 */
export function normalizeRadialZPassMm(zPassMm: number): number {
  if (zPassMm < -1e-9) return zPassMm
  if (zPassMm > 1e-9) return -Math.abs(zPassMm)
  return -0.5
}

/**
 * Iterate from `-zStep` down to `zPass` (inclusive), in `zStep` increments.
 * Used by `runAxis4` to materialise the depth-pass schedule when no mesh
 * radial-extent shortcut applies. Pairs with [ID-0178] contract pin set.
 *
 * Contract:
 *   - `zPassMm >= -1e-9` (i.e. non-negative) -> single-element `[zPassMm]`
 *   - `zStepMm <= 1e-6` (i.e. effectively zero step) -> single-element `[zPassMm]`
 *     (degenerate guard: the strategies expect at least one pass)
 *   - Otherwise: emits `-zStep, -2*zStep, ...` until the next step would
 *     pass `zPassMm`, then appends `zPassMm` as the final pass. The
 *     `+1e-6` epsilon in the loop guard prevents float-rounding from
 *     emitting a duplicate-of-zPass pass when `zPassMm` is an integer
 *     multiple of `zStepMm`.
 */
export function iterDepthsMm(zPassMm: number, zStepMm: number): number[] {
  const zp = zPassMm
  const zs = Math.max(0, zStepMm)
  if (zp >= -1e-9) return [zp]
  if (zs <= 1e-6) return [zp]
  const out: number[] = []
  let d = -zs
  while (d > zp + 1e-6) {
    out.push(d)
    d -= zs
  }
  out.push(zp)
  return out
}

/**
 * Compute roughing depth levels with optional mesh-aware shallow start.
 *
 * If we know the mesh's maximum radial extent, start at the depth where the
 * tool first encounters the mesh (`mr - r`) instead of the stock surface.
 * Avoids spending dozens of empty waterline passes on undersized parts.
 *
 * Pairs with [ID-0178] depth-passes-contract pin set; any drift in the
 * shallow-start guard (`mr >= r - 1e-6`, `zShallow <= zp + 1e-6`) is
 * load-bearing for Carvera 4-axis roughing performance and gets caught
 * by the focused tests in `__tests__/depth-passes-contract.test.ts`.
 *
 * Contract (in order of guards):
 *   1. `useMeshRadial=false` OR `meshRadialMaxMm` falsy/non-positive
 *      OR `mr >= r - 1e-6` (mesh extends past stock OD) -> falls through
 *      to `iterDepthsMm` (no shallow shortcut).
 *   2. `zShallow = mr - r <= zp + 1e-6` (the shallow start is already
 *      deeper than the deepest target) -> falls through to `iterDepthsMm`.
 *   3. `zStepMm <= 1e-6` (degenerate step) -> single-element `[zp]`.
 *   4. Otherwise: emits `zShallow, zShallow-zStep, ...` until the next
 *      step would pass `zPassMm`, then appends `zPassMm` as the final pass.
 */
export function computeDepthsMm(
  zPassMm: number,
  zStepMm: number,
  cylinderRadiusMm: number,
  useMeshRadial: boolean,
  meshRadialMaxMm?: number
): number[] {
  const zp = zPassMm
  const r = Math.max(1e-6, cylinderRadiusMm)
  const mr = meshRadialMaxMm ?? 0
  if (!useMeshRadial || !(mr > 0) || mr >= r - 1e-6) {
    return iterDepthsMm(zp, zStepMm)
  }
  const zShallow = mr - r
  if (zShallow <= zp + 1e-6) return iterDepthsMm(zp, zStepMm)
  const zs = Math.max(0, zStepMm)
  if (zs <= 1e-6) return [zp]
  const out: number[] = []
  let d = zShallow
  while (d > zp + 1e-6) {
    out.push(d)
    d -= zs
  }
  out.push(zp)
  return out
}

/** Read STL and collect triangles in raw STL coordinates (no transform). */
async function readStlTriangles(stlPath: string): Promise<{
  triangles: Triangle[]
  truncated: boolean
}> {
  const buf = await readFile(stlPath)
  if (isBinaryStlLayout(buf)) {
    const out = collectBinaryStlTriangles(buf, 500_000)
    return { triangles: out.triangles as unknown as Triangle[], truncated: out.truncated }
  }
  if (isLikelyAsciiStl(buf)) {
    const out = collectAsciiStlTriangles(buf, 500_000)
    return { triangles: out.triangles as unknown as Triangle[], truncated: out.truncated }
  }
  // Fall through: try binary anyway (some STLs are mislabeled).
  const out = collectBinaryStlTriangles(buf, 500_000)
  return { triangles: out.triangles as unknown as Triangle[], truncated: out.truncated }
}

function envelopeHint(
  machine: MachineProfile,
  gcode: string,
  rotaryStockDiameterMm: number
): string {
  if (machine.kind !== 'cnc') return ''
  let h = formatMachineEnvelopeHintForPostedGcode(gcode, machine.workAreaMm)
  const ac = machine.axisCount ?? 3
  if (ac >= 4 && rotaryStockDiameterMm > 0) {
    h += formatRotaryRadialHintForPostedGcode(gcode, rotaryStockDiameterMm)
  }
  return h
}

/**
 * Run the 4-axis CAM pipeline for a single job. Returns a result shaped to
 * drop into `cam-runner.ts`.
 */
export async function runAxis4(job: Axis4JobConfig): Promise<Axis4Result> {
  const opKind = job.operationKind
  const params = job.operationParams ?? {}
  const ax4 = parse4AxisParams(params)

  // ── Stock geometry ────────────────────────────────────────────────────────
  const stockLength =
    job.rotaryStockLengthMm != null && job.rotaryStockLengthMm > 0
      ? job.rotaryStockLengthMm
      : ax4.cylinderLengthMm ?? 100
  const stockDiameter =
    job.rotaryStockDiameterMm != null && job.rotaryStockDiameterMm > 0
      ? job.rotaryStockDiameterMm
      : ax4.cylinderDiameterMm ?? 50
  const stockRadius = stockDiameter / 2

  // ── Machinable axial span (chuck/clamp deductions) ───────────────────────
  const chuckDepthMm = job.rotaryChuckDepthMm ?? ax4.chuckDepthMm ?? 0
  const clampOffsetMm = job.rotaryClampOffsetMm ?? ax4.clampOffsetMm ?? 0
  const span = rotaryMachinableXSpanMm(stockLength, chuckDepthMm, clampOffsetMm)
  const machXStartMm = span.machXStartMm
  const machXEndMm = Math.min(stockLength, span.machXEndMm)

  // ── Stepover (degrees) ────────────────────────────────────────────────────
  const stepDegFromMm = (job.stepoverMm / (Math.PI * Math.max(stockDiameter, 1e-6))) * 360
  const stepDegFromSurface =
    ax4.surfaceStepoverMm != null
      ? surfaceStepoverDegFromMm(stockRadius, ax4.surfaceStepoverMm)
      : undefined
  const stepoverDeg =
    ax4.stepoverDeg != null
      ? ax4.stepoverDeg
      : stepDegFromSurface != null
        ? stepDegFromSurface
        : Math.max(1, Math.min(90, stepDegFromMm))

  // ── Z step (waterline spacing) ────────────────────────────────────────────
  let zStepMm = ax4.zStepMm ?? 0
  const normZPass = normalizeRadialZPassMm(job.zPassMm)
  if (!(zStepMm > 0) && Math.abs(normZPass) > 0.3) {
    zStepMm = Math.min(2, Math.max(0.25, Math.abs(normZPass) / 4))
  }

  // ── Read mesh + apply user transform ─────────────────────────────────────
  // Contour and indexed strategies do not need a mesh. Pattern is the no-mesh
  // fallback. For the others we read the STL and run it through frame.ts.
  const needsMesh =
    opKind === 'cnc_4axis_roughing' ||
    opKind === 'cnc_4axis_finishing' ||
    opKind === 'cnc_4axis_continuous'

  let frame: ReturnType<typeof meshToMachineFrame> | null = null
  let meshTruncated = false
  if (needsMesh || opKind === 'cnc_4axis_contour' || opKind === 'cnc_4axis_indexed') {
    try {
      const { triangles, truncated } = await readStlTriangles(job.stlPath)
      meshTruncated = truncated
      if (triangles.length > 0) {
        frame = meshToMachineFrame(triangles, job.placement ?? identityPlacement(), {
          lengthMm: stockLength,
          diameterMm: stockDiameter
        })
      }
    } catch {
      // Mesh is optional for contour/indexed; required for roughing/finishing/continuous.
      frame = null
    }
  }

  if (needsMesh && (frame == null || frame.triangles.length === 0)) {
    return {
      ok: false,
      error: `4-axis ${opKind} requires a readable STL mesh.`,
      hint: 'Ensure the staged STL file at the job path exists and is a valid binary or ASCII STL.'
    }
  }

  // ── Pre-generation validation ────────────────────────────────────────────
  const aAxisOrientationRaw = String(job.machine.aAxisOrientation ?? 'x').toLowerCase()
  const aAxisOrientation: 'x' | 'y' = aAxisOrientationRaw === 'y' ? 'y' : 'x'
  const validation = validateAxis4Job({
    operationKind: opKind,
    stock: { lengthMm: stockLength, diameterMm: stockDiameter },
    axisCount: job.machine.axisCount ?? 3,
    aAxisOrientation,
    dialect: job.machine.dialect,
    frame: frame ?? {
      triangles: [],
      bbox: { min: [0, 0, 0], max: [stockLength, 0, 0] },
      meshRadialMax: 0,
      meshRadialMin: 0,
      warnings: []
    },
    machXStartMm,
    machXEndMm,
    contourPoints: ax4.contourPoints,
    indexAnglesDeg: ax4.indexAnglesDeg,
    aAxisRangeDeg: job.machine.aAxisRangeDeg,
    zPassMm: normZPass,
    // Pre-launch punch-list rank 13: defense-in-depth schema gates. The
    // validator rejects non-zero Y on `yAxisMustBeZero` machines (Carvera
    // 4-axis HD) and requires `rotaryHeadstockXOffsetMm` on every 4-axis
    // profile so a hand-edited / CPS-imported profile cannot bypass the
    // post-emit `G0 Y0` safety net.
    yAxisMustBeZero: job.machine.yAxisMustBeZero,
    rotaryHeadstockXOffsetMm: job.machine.rotaryHeadstockXOffsetMm
  })
  if (validation.ok === false) {
    return { ok: false, error: validation.error, hint: validation.hint }
  }
  const validationWarnings = validation.warnings

  // ── Depth levels ──────────────────────────────────────────────────────────
  const useMeshRadial =
    ax4.useMeshRadialZBands === true && frame != null && frame.meshRadialMax > 0
  const zDepths = computeDepthsMm(
    normZPass,
    zStepMm,
    stockRadius,
    useMeshRadial,
    frame?.meshRadialMax
  )

  // ── Dispatch ──────────────────────────────────────────────────────────────
  const toolDiameterMm = job.toolDiameterMm ?? 3.175
  const finishAllowanceMm =
    ax4.rotaryFinishAllowanceMm != null ? Math.max(0, ax4.rotaryFinishAllowanceMm) : undefined
  const overcutMm = ax4.overcutMm
  const maxCells =
    ax4.cylindricalRasterMaxCells != null
      ? Math.min(500_000, Math.floor(ax4.cylindricalRasterMaxCells))
      : 250_000
  const adaptive = ax4.adaptiveRefinement === true
  const maxZMm = job.machine.workAreaMm?.z

  let lines: string[]
  let stratWarnings: string[]

  switch (opKind) {
    case 'cnc_4axis_roughing': {
      const r = generateRoughing({
        triangles: frame!.triangles,
        cylinderDiameterMm: stockDiameter,
        machXStartMm,
        machXEndMm,
        stepoverDeg,
        stepXMm: Math.max(0.25, job.stepoverMm),
        zDepthsMm: zDepths,
        feedMmMin: job.feedMmMin,
        plungeMmMin: job.plungeMmMin,
        safeZMm: job.safeZMm,
        finishAllowanceMm,
        maxCells,
        toolDiameterMm,
        overcutMm,
        maxZMm,
        maxRotaryRpm: job.machine.maxRotaryRpm,
        adaptiveRefinement: adaptive
      })
      lines = r.lines
      stratWarnings = r.warnings
      break
    }
    case 'cnc_4axis_finishing': {
      const finishDepth = zDepths[zDepths.length - 1]!
      const r = generateFinishing({
        triangles: frame!.triangles,
        cylinderDiameterMm: stockDiameter,
        machXStartMm,
        machXEndMm,
        stepoverDeg,
        finishStepoverDeg: ax4.finishStepoverDeg,
        stepXMm: Math.max(0.25, job.stepoverMm),
        finishDepthMm: finishDepth,
        feedMmMin: job.feedMmMin,
        plungeMmMin: job.plungeMmMin,
        safeZMm: job.safeZMm,
        finishAllowanceMm: 0,
        maxCells,
        toolDiameterMm,
        overcutMm,
        maxZMm,
        maxRotaryRpm: job.machine.maxRotaryRpm,
        adaptiveRefinement: adaptive
      })
      lines = r.lines
      stratWarnings = r.warnings
      break
    }
    case 'cnc_4axis_continuous': {
      const r = generateContinuous({
        triangles: frame!.triangles,
        cylinderDiameterMm: stockDiameter,
        machXStartMm,
        machXEndMm,
        stepoverDeg,
        finishStepoverDeg: ax4.finishStepoverDeg,
        stepXMm: Math.max(0.25, job.stepoverMm),
        zDepthsMm: zDepths,
        feedMmMin: job.feedMmMin,
        plungeMmMin: job.plungeMmMin,
        safeZMm: job.safeZMm,
        finishAllowanceMm,
        maxCells,
        toolDiameterMm,
        overcutMm,
        maxZMm,
        maxRotaryRpm: job.machine.maxRotaryRpm,
        adaptiveRefinement: adaptive
      })
      lines = r.lines
      stratWarnings = r.warnings
      break
    }
    case 'cnc_4axis_contour': {
      const r = generateContour({
        contourPoints: ax4.contourPoints!,
        cylinderDiameterMm: stockDiameter,
        machXStartMm,
        machXEndMm,
        zDepthsMm: zDepths,
        feedMmMin: job.feedMmMin,
        plungeMmMin: job.plungeMmMin,
        safeZMm: job.safeZMm,
        toolDiameterMm,
        maxZMm,
        maxRotaryRpm: job.machine.maxRotaryRpm
      })
      lines = r.lines
      stratWarnings = r.warnings
      break
    }
    case 'cnc_4axis_indexed': {
      const r = generateIndexed({
        indexAnglesDeg: ax4.indexAnglesDeg!,
        cylinderDiameterMm: stockDiameter,
        machXStartMm,
        machXEndMm,
        zDepthsMm: zDepths,
        feedMmMin: job.feedMmMin,
        plungeMmMin: job.plungeMmMin,
        safeZMm: job.safeZMm,
        toolDiameterMm,
        overcutMm,
        maxZMm,
        maxRotaryRpm: job.machine.maxRotaryRpm
      })
      lines = r.lines
      stratWarnings = r.warnings
      break
    }
    default: {
      // No mesh and no specific kind matched — fall back to pattern parallel.
      const r = generatePattern({
        cylinderDiameterMm: stockDiameter,
        machXStartMm,
        machXEndMm,
        zDepthsMm: zDepths,
        stepoverDeg,
        feedMmMin: job.feedMmMin,
        plungeMmMin: job.plungeMmMin,
        safeZMm: job.safeZMm,
        toolDiameterMm,
        overcutMm,
        maxZMm,
        maxRotaryRpm: job.machine.maxRotaryRpm
      })
      lines = r.lines
      stratWarnings = r.warnings
      break
    }
  }

  if (lines.length === 0) {
    return {
      ok: false,
      error: '4-axis toolpath is empty.',
      hint: 'Check zPassMm, stepover, and stock diameter; verify the mesh sits within the stock cylinder.'
    }
  }

  // ── Post-process ──────────────────────────────────────────────────────────
  // SAFETY: the bundled 4-axis engine emits every F-word in mm/min (feed per
  // minute). The inverse-time-feed flag (G93) makes the controller read F as
  // 1/time, so emitting G93 around mm/min feeds would make every cutting feed
  // wildly wrong on the machine — a crash. Until a real inverse-time F
  // conversion exists, strip `inverseTimeFeed` here so G93 is NEVER emitted
  // with unconverted feeds, and surface an honest warning that the bundled
  // engine does not support it. (The flag stays in the schema / extractor for
  // a future converting path; this guard is specific to the TS 4-axis engine.)
  const postOpts = extractPostProcessingOpts(job.operationParams)
  const inverseTimeFeedWarnings: string[] = []
  if (postOpts.inverseTimeFeed) {
    delete postOpts.inverseTimeFeed
    inverseTimeFeedWarnings.push(
      'Inverse-time feed (G93) was requested but is NOT supported by the bundled 4-axis engine: ' +
        'its feeds are emitted in mm/min and would be misread under G93. G93 was suppressed and the ' +
        'program posts in feed-per-minute (G94) mode. Remove the inverse-time option or supply a ' +
        'post that converts F to inverse-time.'
    )
  }
  const postResult = await renderPost(job.resourcesRoot, job.machine, lines, {
    workCoordinateIndex: job.workCoordinateIndex,
    operationLabel: job.operationLabel ?? opKind,
    toolNumber: job.toolSlot,
    ...postOpts
  })
  const gcode = postResult.gcode
  await writeFile(job.outputGcodePath, gcode, 'utf-8')

  // ── Hint composition ──────────────────────────────────────────────────────
  let alignHint = ''
  if (frame != null && frame.bbox.max[0] > frame.bbox.min[0]) {
    const h = rotaryMeshStockAlignmentHint({
      stockLengthMm: stockLength,
      meshMinX: frame.bbox.min[0],
      meshMaxX: frame.bbox.max[0]
    })
    if (h) alignHint = ` ${h}`
  }
  if (meshTruncated) {
    alignHint += ' Mesh was truncated to 500k triangles — simplify the model for full coverage.'
  }

  const hint =
    `4-axis toolpath (${opKind}) posted. ${UNVERIFIED}` +
    envelopeHint(job.machine, gcode, stockDiameter) +
    alignHint

  // ── Rotary fixture collision sweep (radial extent guard) ─────────────────
  // The X-span validator already rejects contour points inside the chuck's
  // axial footprint. This additional sweep catches the complementary problem:
  // the tool tip may be past `chuckDepthMm` axially but still dive below the
  // chuck body's outer radius, which would crash on fixtures where the chuck
  // OD is wider than the stock OD (typical of harmonic-drive rotary modules
  // like the Carvera 4th-axis attachment).
  //
  // Fixture resolution order:
  //   1. Caller-supplied `job.rotaryFixture` wins (full control: tailstock,
  //      custom radii, etc.).
  //   2. Otherwise, synthesize a default chuck-only fixture from the machine
  //      profile's `rotaryChuckOuterRadiusMm` (mandated by that field's
  //      JSDoc: "Used as the conservative radial clearance floor by the
  //      on-by-default checkRotaryFixtureCollision sweep ... when the caller
  //      does not supply an explicit rotaryFixture"). Chuck axial extent
  //      defaults to the already-computed `machXStartMm` (chuck depth +
  //      clamp offset), which is the start of the machinable X span.
  //   3. If neither is available (machine missing the field, or
  //      `toolDiameterMm` not set), the sweep is skipped -- the historical
  //      X-span axial check is still in effect via `validateAxis4Job`.
  let resolvedFixture: RotaryFixtureConfig | undefined = job.rotaryFixture
  if (
    resolvedFixture == null &&
    job.machine.rotaryChuckOuterRadiusMm != null &&
    job.machine.rotaryChuckOuterRadiusMm > 0
  ) {
    resolvedFixture = {
      chuckDepthMm: machXStartMm,
      chuckOuterRadiusMm: job.machine.rotaryChuckOuterRadiusMm
    }
  }
  let collisionWarnings: string[] = []
  if (resolvedFixture && job.toolDiameterMm != null && job.toolDiameterMm > 0) {
    const segments = extractToolpathSegments4AxisFromGcode(gcode)
    const collisionResult = checkRotaryFixtureCollision(segments, resolvedFixture, {
      toolDiameterMm: job.toolDiameterMm
    })
    collisionWarnings = formatRotaryCollisionWarnings(collisionResult)
  }

  const allWarnings = [
    ...validationWarnings,
    ...stratWarnings,
    ...postResult.warnings,
    ...collisionWarnings,
    ...inverseTimeFeedWarnings
  ]

  return {
    ok: true,
    gcode,
    usedEngine: 'builtin',
    engine: { requestedEngine: 'builtin', usedEngine: 'builtin', fallbackApplied: false },
    hint,
    ...(allWarnings.length > 0 ? { warnings: allWarnings } : {})
  }
}
