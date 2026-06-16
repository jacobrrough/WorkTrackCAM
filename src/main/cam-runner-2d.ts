/**
 * 2D strategy dispatch for cam-runner.
 *
 * Extracted from the monolithic `runCamPipeline()` to isolate contour, pocket,
 * drill, chamfer, and PCB toolpath generation. The caller in `cam-runner.ts`
 * invokes `dispatch2dStrategy()` when the operation kind matches a 2D family.
 *
 * Wave 3k — THE ONE AUTHORITATIVE NESTING-PLACEMENT SPOT: this dispatcher is
 * the single place the scalar `placementXMm` / `placementYMm` /
 * `placementRotationDeg` params (written by the renderer's
 * `applyNestingPlacements`) are consumed. `applyPlacementToOperationParams2d`
 * runs ONCE at the top of `dispatch2dStrategy`, before any geometry is
 * parsed, so contour, pocket(+islands), chamfer, v-carve(+hole rings), PCB,
 * and drill geometry all receive the SAME rigid transform (CCW rotation
 * about the local origin, then rotated-OUTER-bbox-min translated to
 * (xMm, yMm) — the exact Wave-3j nesting contract). Do NOT also transform in
 * the renderer or in the generators — that would double-transform. Ops
 * without placement params keep the original params object reference, so
 * their posted bytes are untouched. The placed coordinates then flow into
 * the posted program, where the existing machine-envelope check
 * (`postedGcodeEnvelopeHint`) still catches placements that push the
 * toolpath past the bed.
 */
import { writeFile } from 'node:fs/promises'
import type { MachineProfile } from '../shared/machine-schema'
import { applyPlacementToOperationParams2d } from '../shared/cam-placement-transform'
import { generateAdaptiveClearing2dLines } from './cam-adaptive-clearing'
import {
  computeNegativeZDepthPasses,
  generateChamfer2dLines,
  generateContour2dLines,
  generateDrill2dLines,
  generatePocket2dLines,
  generateVCarve2dLines,
  type CamPoint2d
} from './cam-local'
import { generatePocketOffsetSpiralLines } from './cam-pocket-offset'
import { solveRestRegion } from './cam-rest-region'
import { renderPost } from './post-process'
import {
  extractPostProcessingOpts,
  resolveArcFitOptions,
  resolveContourPathOptions,
  resolveContourRampOptions,
  resolveContourTabParams,
  resolveDrillCycleDecision,
  drillOperationHints,
  shouldAppendFinalPocketFinishPass,
  validate2dOperationGeometry,
  type CamJobConfig,
  type CamRunResult
} from './cam-runner'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function point2d(v: unknown): [number, number] | null {
  if (!Array.isArray(v) || v.length < 2) return null
  const x = Number(v[0])
  const y = Number(v[1])
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return [x, y]
}

function point2dList(v: unknown): [number, number][] {
  if (!Array.isArray(v)) return []
  const out: [number, number][] = []
  for (const item of v) {
    const p = point2d(item)
    if (p) out.push(p)
  }
  return out
}

/** Parse the `islandRings` operation param: an array of >=3-point [x,y] rings (invalid entries dropped). */
function islandRingsParam(v: unknown): [number, number][][] {
  if (!Array.isArray(v)) return []
  const out: [number, number][][] = []
  for (const ring of v) {
    const pts = point2dList(ring)
    if (pts.length >= 3) out.push(pts)
  }
  return out
}

/** Finite positive number param, else undefined (adaptive tuning params). */
function positiveParamNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined
}

/**
 * Stack C v1 -- resolved rest-machining mode for the pocket family
 * (`cnc_pocket`, `cnc_adaptive`, `cnc_trochoidal_hsm` in 2D contour mode).
 *
 * `restPrevToolDiameterMm` opts an op into REST MACHINING: instead of clearing
 * the whole pocket region, the op clears ONLY the rest region -- the material a
 * PREVIOUS, larger tool of that diameter provably could not reach (square
 * corners, narrow channels). Absent param = normal full-region pass, and the
 * whole rest path is skipped BY CONSTRUCTION (ops without the param post
 * byte-identically to pre-Stack-C output).
 */
type RestMachiningMode =
  | { kind: 'off' }
  | { kind: 'rest'; prevToolDiameterMm: number }
  | { kind: 'invalid'; error: string; hint: string }

/**
 * Parse + validate `restPrevToolDiameterMm`. The param must be a positive,
 * finite number STRICTLY larger than the current tool diameter (when the
 * current diameter is known) -- an equal or smaller previous tool left nothing
 * only this tool can reach, so the honest answer is a validation error, not an
 * empty program.
 */
function resolveRestMachiningMode(
  p: Record<string, unknown>,
  currentToolDiameterMm: number | undefined
): RestMachiningMode {
  const raw = p['restPrevToolDiameterMm']
  if (raw == null) return { kind: 'off' }
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
    return {
      kind: 'invalid',
      error: 'Rest machining parameter invalid.',
      hint: `restPrevToolDiameterMm must be a positive, finite diameter in mm (the PREVIOUS, larger tool that already roughed this region); got ${typeof raw === 'string' ? `'${raw}'` : String(raw)}. Remove the param to run a normal full-region pass.`
    }
  }
  if (
    typeof currentToolDiameterMm === 'number' &&
    Number.isFinite(currentToolDiameterMm) &&
    currentToolDiameterMm > 0 &&
    raw <= currentToolDiameterMm
  ) {
    return {
      kind: 'invalid',
      error: 'Rest machining requires a larger previous tool.',
      hint: `restPrevToolDiameterMm (${raw.toFixed(3)} mm) must exceed this operation's tool diameter (${currentToolDiameterMm.toFixed(3)} mm) -- an equal or smaller previous tool left nothing only this tool can reach. Set it to the roughing tool's diameter, or remove it for a normal pass.`
    }
  }
  return { kind: 'rest', prevToolDiameterMm: raw }
}

/**
 * Stack B v1 -- trochoid-heavy default engagement cap for `cnc_trochoidal_hsm`
 * as a fraction of tool diameter (vs the engine's 0.4 `cnc_adaptive` default).
 * A tighter cap makes relief trigger sooner AND shrinks the derived trochoid
 * radius/step defaults (cap/2, cap/4) -- the honest v1 reading of "constant
 * chip-load trochoidal clearing" now that the Python toolpath_engine the
 * schema once promised is gone (deleted in the 2026-05-27 pivot).
 */
const TROCHOIDAL_HSM_ENGAGEMENT_FRACTION = 0.2

// ---------------------------------------------------------------------------
// Public dispatch
// ---------------------------------------------------------------------------

/**
 * Generate, post-process, and write G-code for a 2D CNC operation.
 *
 * Handles: `cnc_contour`, `cnc_pocket`, `cnc_drill`, `cnc_chamfer`,
 * `cnc_vcarve`, `cnc_adaptive` / `cnc_trochoidal_hsm` (contour-geometry mode
 * only -- `runCamPipeline` routes those two here ONLY when the op carries
 * `contourPoints`; mesh ops keep the legacy OCL chain), `cnc_pcb_isolation`,
 * `cnc_pcb_contour`, `cnc_pcb_drill`.
 *
 * Stack C v1 -- REST MACHINING: when a pocket-family op (`cnc_pocket`,
 * `cnc_adaptive`, `cnc_trochoidal_hsm`) carries `restPrevToolDiameterMm`
 * (must be finite and LARGER than the current tool diameter, else an honest
 * validation error), `solveRestRegion` runs FIRST on the placed geometry and
 * the selected clearing generator runs ONCE PER rest region (regions chain
 * through safe-Z by construction). Rest mode suppresses the outer-wall AND
 * island finish traces (the previous, larger tool's op already finished those
 * walls). An empty rest is an honest `ok: false` ("the previous tool left
 * nothing this tool can reach"), never a crash. Ops WITHOUT the param take
 * the pre-Stack-C code path unchanged and post byte-identically.
 */
export async function dispatch2dStrategy(
  job: CamJobConfig,
  guardHint: string,
  postedGcodeEnvelopeHint: (machine: MachineProfile, gcode: string) => string
): Promise<CamRunResult> {
  // Wave 3k: consume nesting placement params (identity — same object
  // reference — when absent/partial, so un-nested ops post byte-identically).
  // Validation runs on the PLACED geometry; the rigid transform preserves
  // point counts and entry validity, so validation outcomes are
  // placement-independent by construction.
  const placedParams = applyPlacementToOperationParams2d(job.operationParams)
  const valid = validate2dOperationGeometry(job.operationKind, placedParams)
  if (!valid.ok) {
    return { ok: false, error: valid.error, hint: valid.hint }
  }

  const p = placedParams ?? {}
  let lines: string[] = []
  let pocketResultHints: string[] = []
  let drillResultHints: string[] = []

  if (job.operationKind === 'cnc_contour') {
    const contour = point2dList(p['contourPoints'])
    const { contourSide, leadInMm, leadOutMm, leadInMode, leadOutMode } = resolveContourPathOptions(p)
    const { rampType, rampAngleDeg } = resolveContourRampOptions(p)
    const tabParams = resolveContourTabParams(p)
    // TRUE-ARC output (opt-in `arcTolMm`): collapse co-circular ring runs into
    // G2/G3. Tolerance-gated -> absent param yields the exact legacy G1 chain.
    const arcFit = resolveArcFitOptions(p)
    const zStepContour =
      typeof p['zStepMm'] === 'number' && Number.isFinite(p['zStepMm']) ? Math.max(0.01, p['zStepMm']) : undefined
    const contourOpts = {
      contourPoints: contour,
      feedMmMin: job.feedMmMin,
      plungeMmMin: job.plungeMmMin,
      safeZMm: job.safeZMm,
      contourSide,
      leadInMm,
      leadOutMm,
      leadInMode,
      leadOutMode,
      rampType,
      rampAngleDeg,
      ...arcFit,
      ...(tabParams ? { tabParams } : {})
    }
    if (job.zPassMm < 0 && zStepContour != null) {
      const depths = computeNegativeZDepthPasses(job.zPassMm, zStepContour)
      lines = depths.flatMap((z) => generateContour2dLines({ ...contourOpts, zPassMm: z }))
    } else {
      lines = generateContour2dLines({ ...contourOpts, zPassMm: job.zPassMm })
    }
    if (lines.length === 0) {
      return {
        ok: false,
        error: 'Contour toolpath is empty.',
        hint:
          'Check contourPoints form a closed, non-degenerate polygon (\u22653 distinct points, non-zero area) in setup WCS; zPassMm must reach stock; safe height and feeds must be valid. Open or self-intersecting loops produce no moves.'
      }
    }
  } else if (job.operationKind === 'cnc_pocket') {
    const contour = point2dList(p['contourPoints'])
    const wallStockMm = typeof p['wallStockMm'] === 'number' && Number.isFinite(p['wallStockMm']) ? Math.max(0, p['wallStockMm']) : 0
    const zStepMm = typeof p['zStepMm'] === 'number' && Number.isFinite(p['zStepMm']) ? Math.max(0.01, p['zStepMm']) : undefined
    const entryMode = p['entryMode'] === 'ramp' ? 'ramp' : 'plunge'
    const rampMm = typeof p['rampMm'] === 'number' && Number.isFinite(p['rampMm']) ? Math.max(0.01, p['rampMm']) : undefined
    const rampMaxAngleDeg =
      typeof p['rampMaxAngleDeg'] === 'number' && Number.isFinite(p['rampMaxAngleDeg'])
        ? p['rampMaxAngleDeg']
        : undefined
    const finishPass = p['finishPass'] !== false
    const finishEachDepth = p['finishEachDepth'] === true
    // Island + clearing-strategy params (additive -- absent params reproduce the
    // legacy raster output byte-for-byte).
    const islandRings = islandRingsParam(p['islandRings'])
    const pocketStrategy: 'raster' | 'offset_spiral' =
      p['pocketStrategy'] === 'offset_spiral' ? 'offset_spiral' : 'raster'
    // G-code safety: pocket depth is HARD-CAPPED to the stock thickness
    // (job.stockBoxZMm, WCS Z0 = stock top) so the cutter can never pass through
    // the bottom of the material -- same contract as the cnc_vcarve cap below.
    // Applies to the clearing passes AND the appended finish contours.
    const pocketStockThickness =
      typeof job.stockBoxZMm === 'number' && Number.isFinite(job.stockBoxZMm) && job.stockBoxZMm > 0
        ? job.stockBoxZMm
        : undefined
    const pocketZCapped = pocketStockThickness != null && job.zPassMm < -pocketStockThickness
    const pocketZPassMm = pocketZCapped && pocketStockThickness != null ? -pocketStockThickness : job.zPassMm
    const { contourSide, leadInMm, leadOutMm, leadInMode, leadOutMode } = resolveContourPathOptions(p)
    // TRUE-ARC output for the pocket finish traces (opt-in `arcTolMm`,
    // tolerance-gated). Applies to the outer-wall AND island-wall finish
    // contours; the raster clearing rows are straight by construction and never
    // arc-fitted. Absent param -> byte-identical legacy G1 finish traces.
    const arcFit = resolveArcFitOptions(p)
    // Stack C v1 -- REST MACHINING (`restPrevToolDiameterMm`): clear ONLY the
    // material a previous, larger tool could not reach. PLACEMENT NOTE
    // (verified): `applyPlacementToOperationParams2d` already ran at the top of
    // this dispatcher, so `contour` / `islandRings` are in PLACED coordinates
    // and the rest solve below happens in placed space automatically. A rigid
    // placement (rotation + translation) preserves distances, so it COMMUTES
    // with the morphological opening -- solving after placement is exactly
    // equivalent to solving in local coordinates and transforming the rest
    // regions; nothing is double-transformed.
    const restMode = resolveRestMachiningMode(p, job.toolDiameterMm)
    if (restMode.kind === 'invalid') {
      return { ok: false, error: restMode.error, hint: restMode.hint }
    }
    // One clearing run over one region (the whole pocket in normal mode; one
    // rest polygon per call in rest mode). Both strategies emit a safe-Z lift
    // before EVERY loop/segment entry and end their body at safe Z, so
    // concatenated per-region bodies are chained through safe-Z by
    // construction (no XY transit at depth between rest regions).
    const runPocketRegion = (
      regionOuter: ReadonlyArray<CamPoint2d>,
      regionIslands: ReadonlyArray<ReadonlyArray<CamPoint2d>>,
      regionWallStockMm: number
    ): { lines: string[]; hints: string[] } =>
      pocketStrategy === 'offset_spiral'
        ? generatePocketOffsetSpiralLines({
            outerRing: regionOuter,
            islandRings: regionIslands,
            stepoverMm: job.stepoverMm,
            zPassMm: pocketZPassMm,
            zStepMm,
            feedMmMin: job.feedMmMin,
            plungeMmMin: job.plungeMmMin,
            safeZMm: job.safeZMm,
            wallStockMm: regionWallStockMm,
            finishEachDepth,
            entryMode,
            rampMm,
            rampMaxAngleDeg
          })
        : generatePocket2dLines({
            contourPoints: regionOuter,
            islandRings: regionIslands,
            stepoverMm: job.stepoverMm,
            zPassMm: pocketZPassMm,
            zStepMm,
            feedMmMin: job.feedMmMin,
            plungeMmMin: job.plungeMmMin,
            safeZMm: job.safeZMm,
            wallStockMm: regionWallStockMm,
            finishEachDepth,
            entryMode,
            rampMm,
            rampMaxAngleDeg
          })
    if (restMode.kind === 'rest') {
      // `wallStockMm` is applied INSIDE the rest solve (the region is inset by
      // it before the opening), so each rest region is cleared with wall stock
      // 0 -- re-applying it would double-inset and can annihilate corner lobes.
      const rest = solveRestRegion({
        outerRing: contour,
        islandRings,
        wallStockMm,
        prevToolDiameterMm: restMode.prevToolDiameterMm,
        ...(typeof job.toolDiameterMm === 'number' && Number.isFinite(job.toolDiameterMm) && job.toolDiameterMm > 0
          ? { toolDiameterMm: job.toolDiameterMm }
          : {})
      })
      if (rest.regions.length === 0) {
        return {
          ok: false,
          error: 'Rest machining: the previous tool left nothing this tool can reach.',
          hint: rest.hints.join(' ')
        }
      }
      const restLines: string[] = []
      const restHints: string[] = [...rest.hints]
      rest.regions.forEach((region, idx) => {
        const r = runPocketRegion(region.outerRing, region.islandRings, 0)
        if (r.lines.length > 0) {
          restLines.push(
            `; Rest region ${idx + 1}/${rest.regions.length} (previous tool ${restMode.prevToolDiameterMm.toFixed(3)} mm)`
          )
          restLines.push(...r.lines)
        }
        restHints.push(...r.hints)
      })
      lines = restLines
      pocketResultHints = [...new Set(restHints)]
    } else {
      const pocket = runPocketRegion(contour, islandRings, wallStockMm)
      lines = pocket.lines
      pocketResultHints = pocket.hints
    }
    if (pocketZCapped && pocketStockThickness != null) {
      pocketResultHints = [
        `Pocket: depth cap reduced from ${Math.abs(job.zPassMm).toFixed(3)} mm to the ${pocketStockThickness.toFixed(3)} mm stock thickness so the cutter does not plunge past the material.`,
        ...pocketResultHints
      ]
    }
    // REST RULE: in rest mode NEITHER the outer-wall finish trace NOR the
    // island-wall traces run -- the previous (larger) tool's op already
    // finished every real wall, so re-tracing them with the small tool is
    // wasted air / wall burnishing at best (the solver's
    // REST_SKIP_WALL_FINISH_HINT in `pocketResultHints` tells the operator).
    if (restMode.kind !== 'rest' && shouldAppendFinalPocketFinishPass({ finishPass, finishEachDepth })) {
      lines.push(
        ...generateContour2dLines({
          contourPoints: contour,
          zPassMm: pocketZPassMm,
          feedMmMin: job.feedMmMin,
          plungeMmMin: job.plungeMmMin,
          safeZMm: job.safeZMm,
          contourSide,
          leadInMm,
          leadOutMm,
          leadInMode,
          leadOutMode,
          ...arcFit
        })
      )
    }
    if (restMode.kind !== 'rest' && finishPass && islandRings.length > 0 && lines.length > 0) {
      // Island WALL finish -- one bare contour pass around each island ring at
      // the final (capped) depth, for BOTH clearing strategies. No leads: an
      // arc or tangent lead could swing into the island; each pass begins with
      // its own safe-Z lift + rapid (generateContour2dLines lifts first), so
      // island-to-island transitions are never at-depth rapids.
      for (const ring of islandRings) {
        lines.push(
          ...generateContour2dLines({
            contourPoints: ring,
            zPassMm: pocketZPassMm,
            feedMmMin: job.feedMmMin,
            plungeMmMin: job.plungeMmMin,
            safeZMm: job.safeZMm,
            contourSide,
            ...arcFit
          })
        )
      }
    }
    if (lines.length === 0) {
      return {
        ok: false,
        error: 'Pocket toolpath is empty.',
        hint:
          restMode.kind === 'rest'
            ? `Rest machining: rest regions were solved but the '${pocketStrategy}' strategy emitted no cut moves -- corner lobes can be smaller than the raster row spacing. Use pocketStrategy 'offset_spiral' (it traces every rest boundary) or reduce stepoverMm. ${pocketResultHints.join(' ')}`
            : 'Common causes: tool diameter too large for the pocket, contour too tight for stepover, invalid ramp settings, self-intersecting or open contours, islands consuming the whole region, or geometry the offsetter cannot offset. Try smaller toolDiameterMm / stepover or simplify contourPoints.'
      }
    }
  } else if (job.operationKind === 'cnc_adaptive' || job.operationKind === 'cnc_trochoidal_hsm') {
    // Stack B v1 -- ADAPTIVE CLEARING (capped radial engagement) over the
    // Wave-3i offset-level region model, with trochoidal relief where the
    // local bite would exceed the engagement cap. `runCamPipeline` routes
    // these two kinds here ONLY when the op carries sketch-derived
    // `contourPoints`; mesh-driven ops keep the legacy OCL AdaptiveWaterline
    // chain untouched. Mirrors the cnc_pocket contract: placement transform
    // (already applied above), islandRings, stock depth hard-cap, multi-depth
    // via zStepMm, and the cheap final finish-contour reuse.
    const contour = point2dList(p['contourPoints'])
    const islandRings = islandRingsParam(p['islandRings'])
    const wallStockMm = typeof p['wallStockMm'] === 'number' && Number.isFinite(p['wallStockMm']) ? Math.max(0, p['wallStockMm']) : 0
    const zStepMm = typeof p['zStepMm'] === 'number' && Number.isFinite(p['zStepMm']) ? Math.max(0.01, p['zStepMm']) : undefined
    const entryMode = p['entryMode'] === 'ramp' ? 'ramp' : 'plunge'
    const rampMm = typeof p['rampMm'] === 'number' && Number.isFinite(p['rampMm']) ? Math.max(0.01, p['rampMm']) : undefined
    const rampMaxAngleDeg =
      typeof p['rampMaxAngleDeg'] === 'number' && Number.isFinite(p['rampMaxAngleDeg'])
        ? p['rampMaxAngleDeg']
        : undefined
    const finishPass = p['finishPass'] !== false
    // Same fallback diameter the OCL config writer uses for tool-less jobs.
    const toolDiameterMm = job.toolDiameterMm ?? 6
    // `cnc_trochoidal_hsm` is the SAME engine with a trochoid-heavy default
    // cap (TROCHOIDAL_HSM_ENGAGEMENT_FRACTION of tool diameter); an explicit
    // `maxEngagementMm` param always wins for both kinds.
    const maxEngagementMm =
      positiveParamNumber(p['maxEngagementMm']) ??
      (job.operationKind === 'cnc_trochoidal_hsm'
        ? TROCHOIDAL_HSM_ENGAGEMENT_FRACTION * toolDiameterMm
        : undefined)
    const trochoidRadiusMm = positiveParamNumber(p['trochoidRadiusMm'])
    const trochoidStepMm = positiveParamNumber(p['trochoidStepMm'])
    // G-code safety: depth HARD-CAPPED to the stock thickness (WCS Z0 = stock
    // top) -- the same contract as cnc_pocket / cnc_vcarve. stockBoxZMm is
    // ALSO forwarded to the engine (belt + braces; after this pre-cap the
    // engine's own cap is a no-op and emits no duplicate hint).
    const adaptiveStockThickness =
      typeof job.stockBoxZMm === 'number' && Number.isFinite(job.stockBoxZMm) && job.stockBoxZMm > 0
        ? job.stockBoxZMm
        : undefined
    const adaptiveZCapped = adaptiveStockThickness != null && job.zPassMm < -adaptiveStockThickness
    const adaptiveZPassMm = adaptiveZCapped && adaptiveStockThickness != null ? -adaptiveStockThickness : job.zPassMm
    const { contourSide, leadInMm, leadOutMm, leadInMode, leadOutMode } = resolveContourPathOptions(p)
    // TRUE-ARC output for the adaptive finish traces (opt-in `arcTolMm`,
    // tolerance-gated). Only reached on the adaptiveClearedToWalls === true gate
    // below; absent param -> byte-identical legacy G1 finish traces.
    const arcFit = resolveArcFitOptions(p)
    // Stack C v1 -- REST MACHINING for the adaptive family. Same placement
    // reasoning as cnc_pocket above: the placement transform already ran, so
    // the rest solve operates in placed coordinates (rigid transforms commute
    // with the morphological opening). The honesty gate compares against the
    // engine's MATERIALIZED tool diameter (`job.toolDiameterMm ?? 6`).
    const restModeAdaptive = resolveRestMachiningMode(p, toolDiameterMm)
    if (restModeAdaptive.kind === 'invalid') {
      return { ok: false, error: restModeAdaptive.error, hint: restModeAdaptive.hint }
    }
    // The engine emits a safe-Z lift before every loop entry and ends its body
    // at safe Z, so concatenated per-rest-region bodies chain through safe-Z.
    const runAdaptiveRegion = (
      regionOuter: ReadonlyArray<CamPoint2d>,
      regionIslands: ReadonlyArray<ReadonlyArray<CamPoint2d>>,
      regionWallStockMm: number
    ): ReturnType<typeof generateAdaptiveClearing2dLines> =>
      generateAdaptiveClearing2dLines({
        outerRing: regionOuter,
        islandRings: regionIslands,
        toolDiameterMm,
        stepoverMm: job.stepoverMm,
        maxEngagementMm,
        trochoidRadiusMm,
        trochoidStepMm,
        zPassMm: adaptiveZPassMm,
        zStepMm,
        feedMmMin: job.feedMmMin,
        plungeMmMin: job.plungeMmMin,
        safeZMm: job.safeZMm,
        wallStockMm: regionWallStockMm,
        entryMode,
        rampMm,
        rampMaxAngleDeg,
        stockBoxZMm: adaptiveStockThickness
      })
    if (restModeAdaptive.kind === 'rest') {
      // `wallStockMm` is folded into the rest solve; regions are cleared with
      // wall stock 0 (re-applying would double-inset -- see the pocket branch).
      const rest = solveRestRegion({
        outerRing: contour,
        islandRings,
        wallStockMm,
        prevToolDiameterMm: restModeAdaptive.prevToolDiameterMm,
        toolDiameterMm
      })
      if (rest.regions.length === 0) {
        return {
          ok: false,
          error: 'Rest machining: the previous tool left nothing this tool can reach.',
          hint: rest.hints.join(' ')
        }
      }
      const restLines: string[] = []
      const restHints: string[] = [...rest.hints]
      rest.regions.forEach((region, idx) => {
        const r = runAdaptiveRegion(region.outerRing, region.islandRings, 0)
        if (r.lines.length > 0) {
          restLines.push(
            `; Rest region ${idx + 1}/${rest.regions.length} (previous tool ${restModeAdaptive.prevToolDiameterMm.toFixed(3)} mm)`
          )
          restLines.push(...r.lines)
        }
        restHints.push(...r.hints)
      })
      lines = restLines
      pocketResultHints = [...new Set(restHints)]
      // REST RULE: no finish trace at all in rest mode (outer wall OR islands)
      // -- the previous tool's op already finished those walls. This also
      // trivially preserves the Stack-B `adaptiveClearedToWalls` contract: the
      // dispatcher's finish pass only ever runs when a NON-rest run reports
      // `adaptiveClearedToWalls === true` (the gate below), so rest mode can
      // never trace a wall the engine refused to clear. Cusped corner-lobe
      // rest regions are typically SKIPPED by this engine with a hint (use
      // cnc_pocket for those); channel-shaped rest regions cut normally.
    } else {
      const adaptive = runAdaptiveRegion(contour, islandRings, wallStockMm)
      lines = adaptive.lines
      pocketResultHints = adaptive.hints
      if (finishPass && lines.length > 0 && adaptive.adaptiveClearedToWalls !== true) {
        // The engine SKIPPED or TRUNCATED some geometry (spike runs, unrelievable
        // narrow regions, or the trochoid budget) -- material was deliberately
        // left at the walls there. A finish contour would trace the FULL wall at
        // final depth, cutting full-burial into that uncleared stock: exactly the
        // above-the-cap slot the engine refuses to make. Suppress it honestly.
        pocketResultHints = [
          ...pocketResultHints,
          'Finish pass suppressed: adaptive clearing left material in skipped/truncated regions, so the wall trace would cut full-burial into uncleared stock. Clear the remainder (smaller tool, larger trochoid budget, or a dedicated narrow-channel pass), then run a separate contour finish.'
        ]
      }
      if (finishPass && lines.length > 0 && adaptive.adaptiveClearedToWalls === true) {
        // Cheap finish reuse (cnc_pocket contract): one wall contour at the
        // final (capped) depth, then a bare trace around each island ring.
        // Every pass begins with its own safe-Z lift (generateContour2dLines
        // lifts first), so pass transitions are never at-depth rapids.
        // INTENTIONAL differences from cnc_pocket: the finish is gated on a
        // non-empty clearing body AND on the engine's adaptiveClearedToWalls
        // flag -- when anything was skipped/truncated, the wall trace would be
        // a fully-buried slot at depth, the exact above-the-cap cut this engine
        // exists to prevent (see the suppression branch above). Rest mode never
        // reaches this gate (the REST RULE branch above suppresses all finish
        // traces), so the adaptiveClearedToWalls contract is preserved.
        lines.push(
          ...generateContour2dLines({
            contourPoints: contour,
            zPassMm: adaptiveZPassMm,
            feedMmMin: job.feedMmMin,
            plungeMmMin: job.plungeMmMin,
            safeZMm: job.safeZMm,
            contourSide,
            leadInMm,
            leadOutMm,
            leadInMode,
            leadOutMode,
            ...arcFit
          })
        )
        for (const ring of islandRings) {
          lines.push(
            ...generateContour2dLines({
              contourPoints: ring,
              zPassMm: adaptiveZPassMm,
              feedMmMin: job.feedMmMin,
              plungeMmMin: job.plungeMmMin,
              safeZMm: job.safeZMm,
              contourSide,
              ...arcFit
            })
          )
        }
      }
    }
    if (adaptiveZCapped && adaptiveStockThickness != null) {
      pocketResultHints = [
        `Adaptive clearing: depth cap reduced from ${Math.abs(job.zPassMm).toFixed(3)} mm to the ${adaptiveStockThickness.toFixed(3)} mm stock thickness so the cutter does not plunge past the material.`,
        ...pocketResultHints
      ]
    }
    if (lines.length === 0) {
      return {
        ok: false,
        error: 'Adaptive clearing toolpath is empty.',
        hint:
          restModeAdaptive.kind === 'rest'
            ? `Rest machining: rest regions were solved but the adaptive engine skipped them all -- cusped corner lobes taper below its v1 spine coverage, so it refuses to slot them. Clear corner rest with cnc_pocket (pocketStrategy 'offset_spiral' or 'raster'); adaptive rest suits channel-shaped rest regions. ${pocketResultHints.join(' ')}`
            : 'Common causes: tool diameter or stepover too large for the region, wall stock consuming the whole pocket, islands covering the clearable area, or open/self-intersecting contourPoints. Reduce stepoverMm / wallStockMm, use a smaller tool, or simplify the loop.'
      }
    }
  } else if (job.operationKind === 'cnc_chamfer') {
    const contour = point2dList(p['contourPoints'])
    const chamferDepthMm =
      typeof p['chamferDepthMm'] === 'number' && Number.isFinite(p['chamferDepthMm']) && p['chamferDepthMm'] > 0
        ? p['chamferDepthMm']
        : Math.abs(job.zPassMm)
    const chamferAngleDeg =
      typeof p['chamferAngleDeg'] === 'number' && Number.isFinite(p['chamferAngleDeg'])
        ? p['chamferAngleDeg']
        : undefined
    lines = generateChamfer2dLines({
      contourPoints: contour,
      chamferDepthMm,
      chamferAngleDeg,
      feedMmMin: job.feedMmMin,
      plungeMmMin: job.plungeMmMin,
      safeZMm: job.safeZMm
    })
    if (lines.length === 0) {
      return {
        ok: false,
        error: 'Chamfer toolpath is empty.',
        hint:
          'Check contourPoints form a closed polygon (\u22653 points), chamferDepthMm is positive, and feed/safe-Z are valid.'
      }
    }
  } else if (job.operationKind === 'cnc_vcarve') {
    // TRUE V-carve (medial-axis variable depth) -- the flagship VCarve Pro op.
    // The depth cap is the smaller of the requested maxDepthMm and the stock
    // thickness (job.stockBoxZMm, WCS Z0 = stock top) so the V-bit can never
    // plunge past the material (G-code safety: never cut below the stock).
    const ring = point2dList(p['contourPoints'])
    // Interior hole rings (additive `islandRings` param -- same name as the
    // pocket family; set by the nested-ring sketch derive). The engine treats
    // rings even-odd, so the carve runs BETWEEN the outer wall and each hole
    // wall (letter counters, washers) instead of ploughing across the hole.
    const vcarveHoleRings = islandRingsParam(p['islandRings'])
    const vBitAngleDeg =
      typeof p['vBitAngleDeg'] === 'number' && Number.isFinite(p['vBitAngleDeg']) && p['vBitAngleDeg'] > 0
        ? p['vBitAngleDeg']
        : 90
    const requestedMaxDepth =
      typeof p['maxDepthMm'] === 'number' && Number.isFinite(p['maxDepthMm']) && p['maxDepthMm'] > 0
        ? p['maxDepthMm']
        : Math.abs(job.zPassMm) > 1e-6
          ? Math.abs(job.zPassMm)
          : 3
    const stockThickness =
      typeof job.stockBoxZMm === 'number' && Number.isFinite(job.stockBoxZMm) && job.stockBoxZMm > 0
        ? job.stockBoxZMm
        : undefined
    const cappedToStock = stockThickness != null && stockThickness < requestedMaxDepth
    const maxDepthMm = stockThickness != null ? Math.min(requestedMaxDepth, stockThickness) : requestedMaxDepth
    const stepoverMm =
      typeof p['stepoverMm'] === 'number' && Number.isFinite(p['stepoverMm']) && p['stepoverMm'] > 0
        ? p['stepoverMm']
        : typeof job.stepoverMm === 'number' && Number.isFinite(job.stepoverMm) && job.stepoverMm > 0
          ? job.stepoverMm
          : undefined
    const flatBottomClearance =
      typeof p['flatBottomClearance'] === 'number' && Number.isFinite(p['flatBottomClearance']) && p['flatBottomClearance'] > 0
        ? p['flatBottomClearance']
        : undefined
    const vcarve = generateVCarve2dLines({
      rings: [ring, ...vcarveHoleRings],
      vBitAngleDeg,
      maxDepthMm,
      feedMmMin: job.feedMmMin,
      plungeMmMin: job.plungeMmMin,
      safeZMm: job.safeZMm,
      ...(stepoverMm != null ? { stepoverMm } : {}),
      ...(flatBottomClearance != null ? { flatBottomClearance } : {})
    })
    lines = vcarve.lines
    pocketResultHints = vcarve.hints
    if (vcarveHoleRings.length > 0) {
      pocketResultHints = [
        `V-carve: ${vcarveHoleRings.length} interior hole ring(s) carved around (even-odd with the outer loop).`,
        ...pocketResultHints
      ]
    }
    if (cappedToStock && stockThickness != null) {
      pocketResultHints = [
        `V-carve: depth cap reduced from ${requestedMaxDepth.toFixed(3)} mm to the ${stockThickness.toFixed(3)} mm stock thickness so the V-bit does not plunge past the material.`,
        ...pocketResultHints
      ]
    }
    if (lines.length === 0) {
      return {
        ok: false,
        error: 'V-carve toolpath is empty.',
        hint:
          'Check contourPoints form a closed, non-degenerate polygon with non-zero area in setup WCS, vBitAngleDeg is a valid V-bit angle, and maxDepthMm (or stock thickness) is positive. A line / open loop yields no medial axis.'
      }
    }
  } else if (job.operationKind === 'cnc_pcb_isolation' || job.operationKind === 'cnc_pcb_contour') {
    const contour = point2dList(p['contourPoints'])
    lines = generateContour2dLines({
      contourPoints: contour,
      zPassMm: job.zPassMm,
      feedMmMin: job.feedMmMin,
      plungeMmMin: job.plungeMmMin,
      safeZMm: job.safeZMm
    })
    if (lines.length === 0) {
      return {
        ok: false,
        error: 'PCB toolpath is empty.',
        hint:
          'Check contourPoints form a closed, non-degenerate polygon (\u22653 points) and zPassMm is non-zero.'
      }
    }
  } else {
    // Drill operations (cnc_drill, cnc_pcb_drill)
    const drillPoints = point2dList(p['drillPoints'])
    const retractMm = typeof p['retractMm'] === 'number' && Number.isFinite(p['retractMm']) ? p['retractMm'] : undefined
    const peckMm = typeof p['peckMm'] === 'number' && Number.isFinite(p['peckMm']) ? p['peckMm'] : undefined
    const dwellMs = typeof p['dwellMs'] === 'number' && Number.isFinite(p['dwellMs']) ? p['dwellMs'] : undefined
    const drillCycleDecision = resolveDrillCycleDecision({ dialect: job.machine.dialect, operationParams: p })
    lines = generateDrill2dLines({
      drillPoints,
      zPassMm: job.zPassMm,
      feedMmMin: job.feedMmMin,
      safeZMm: job.safeZMm,
      retractMm,
      peckMm,
      dwellMs,
      cycleMode: drillCycleDecision.mode
    })
    drillResultHints = drillCycleDecision.hint ? [drillCycleDecision.hint] : []
    drillResultHints.push(...drillOperationHints(p, { zPassMm: job.zPassMm, safeZMm: job.safeZMm }))
    if (lines.length === 0) {
      return {
        ok: false,
        error: 'Drill toolpath is empty.',
        hint: 'Check drillPoints, zPassMm (depth), safeZMm, and retractMm; all must be consistent so the cycle can emit moves.'
      }
    }
  }

  const postResult = await renderPost(job.resourcesRoot, job.machine, lines, {
    workCoordinateIndex: job.workCoordinateIndex,
    operationLabel: job.operationLabel ?? job.operationKind,
    toolNumber: job.toolSlot,
    ...extractPostProcessingOpts(job.operationParams)
  })
  const gcode = postResult.gcode
  await writeFile(job.outputGcodePath, gcode, 'utf-8')

  const base2dHint =
    '2D path posted from operation geometry params (`contourPoints` / `drillPoints`). G-code is unverified until post/machine checks (docs/MACHINES.md).'
  return {
    ok: true,
    gcode,
    usedEngine: 'builtin',
    engine: {
      requestedEngine: 'builtin',
      usedEngine: 'builtin',
      fallbackApplied: false
    },
    ...(postResult.warnings.length ? { warnings: postResult.warnings } : {}),
    hint:
      [base2dHint, ...pocketResultHints, ...drillResultHints].filter(Boolean).join(' ') +
      postedGcodeEnvelopeHint(job.machine, gcode) +
      guardHint
  }
}
