/**
 * 4-Axis Cylindrical Waterline Roughing
 *
 * Algorithm:
 *   1. Build a cylindrical heightmap from the (already machine-frame) mesh
 *   2. Apply tool-radius compensation
 *   3. Compute mesh-aware depth levels (deepest mesh point → user requested)
 *   4. For each depth, for each angular pass:
 *        a. Retract Z to stepover clearance
 *        b. Rotate A to the new angle
 *        c. Plunge to the cut depth
 *        d. Cut along X at that depth, with surface-following where the mesh
 *           pokes above the layer (waterline cut otherwise)
 *
 * The strategy uses ONLY the `Emitter` for output — no raw G-code lines —
 * so all safety invariants (chuck-face, never-rotate-at-depth, plunge-vs-cut
 * feed) are enforced centrally.
 */
import type { Triangle } from '../frame'
import {
  buildCylindricalHeightmap,
  countHits,
  HIT_CLAMPED,
  NO_HIT
} from '../heightmap'
import { Emitter } from '../emit'
import {
  buildAdaptiveAngles,
  computeAngularCurvature,
  computePerAngleXExtents,
  sampleHeightmapAtAngle
} from '../rasterize'
import { applyToolRadiusCompensation } from '../tool-comp'

export type RoughingParams = {
  /** Triangles in machine frame (X axial in [0, stockLen], Y/Z perpendicular). */
  triangles: Triangle[]
  /** Stock cylinder diameter (mm). */
  cylinderDiameterMm: number
  /** Machinable axial range (mm), already chuck-/clamp-deducted by the caller. */
  machXStartMm: number
  machXEndMm: number
  /** Angular stepover (deg) — the base grid resolution for A. */
  stepoverDeg: number
  /** Approximate axial step (mm). */
  stepXMm: number
  /** Depth levels (negative; relative to stock surface). */
  zDepthsMm: number[]
  feedMmMin: number
  plungeMmMin: number
  safeZMm: number
  /** Optional radial finish allowance left on the mesh surface (mm). */
  finishAllowanceMm?: number
  /** Hard cap on grid cells. */
  maxCells?: number
  /** Tool diameter (mm). */
  toolDiameterMm: number
  /** Overcut past part edges (mm). Defaults to one tool diameter. */
  overcutMm?: number
  /** Machine work-area Z (mm) — clearZ is clamped to maxZMm - 1. */
  maxZMm?: number
  /** Machine max rotary RPM — used by feed adaptation. */
  maxRotaryRpm?: number
  /** Enable curvature-adaptive angular refinement. */
  adaptiveRefinement?: boolean
}

export type RoughingResult = {
  lines: string[]
  warnings: string[]
}

export function generateRoughing(p: RoughingParams): RoughingResult {
  const stockR = Math.max(1e-6, p.cylinderDiameterMm / 2)
  const toolD = p.toolDiameterMm
  const toolR = toolD / 2
  const overcutMm = p.overcutMm ?? toolD
  const stepA = Math.max(0.5, Math.min(90, p.stepoverDeg))

  const machXStartClamped = Math.max(0, p.machXStartMm)
  const machXEndClamped = Math.max(machXStartClamped + 0.1, p.machXEndMm)

  // Extend machinable range by overcut on each side. CHUCK-FACE SAFETY: never
  // negative.
  const extXStart = Math.max(0, machXStartClamped - overcutMm)
  const extXEnd = machXEndClamped + overcutMm
  const extSpanX = extXEnd - extXStart

  const targetStepX = Math.max(0.1, p.stepXMm)
  let nx = Math.max(10, Math.ceil(extSpanX / targetStepX) + 1)
  let na = Math.max(36, Math.ceil(360 / stepA))
  const maxCells = Math.max(1000, Math.min(500_000, p.maxCells ?? 250_000))
  while (nx * na > maxCells && nx > 10) nx--
  while (nx * na > maxCells && na > 36) na--

  const allowance = Math.max(0, p.finishAllowanceMm ?? 0)

  let actualStepADeg = 360 / na
  let actualDx = extSpanX / Math.max(1, nx - 1)

  // Build initial heightmap. validation.ts has already enforced
  // meshRadialMax ≤ stockRadius, so we don't expect HIT_CLAMPED in production
  // — but the cell state still distinguishes them so the warning is honest.
  let hm = buildCylindricalHeightmap(p.triangles, {
    stockRadius: stockR,
    xStart: extXStart,
    xEnd: extXEnd,
    nx,
    na
  })

  let stats = countHits(hm)

  // Adaptive refinement: if hit rate is below 60% and we have room for more
  // cells, double resolution and retry.
  const initialHitRate = hm.radii.length > 0 ? stats.hitCount / hm.radii.length : 0
  if (initialHitRate > 0 && initialHitRate < 0.6 && nx * na < maxCells * 0.6) {
    const refineNx = Math.min(
      Math.ceil(nx * 1.8),
      Math.ceil(Math.sqrt(maxCells * (extSpanX / 360)))
    )
    const refineNa = Math.min(
      Math.ceil(na * 1.8),
      Math.ceil(Math.sqrt(maxCells * (360 / Math.max(1, extSpanX))))
    )
    if (refineNx * refineNa <= maxCells && (refineNx > nx || refineNa > na)) {
      nx = refineNx
      na = refineNa
      // CRITICAL: recompute actualDx and actualStepADeg after refinement.
      // Previously these were captured pre-refinement, so the X loop iterated
      // `nx_post * dx_pre` which marched well past `extXEnd` and produced
      // toolpaths that overflowed the stock cylinder. Caught by the
      // integration test in `__tests__/integration.test.ts`.
      actualDx = extSpanX / Math.max(1, nx - 1)
      actualStepADeg = 360 / na
      hm = buildCylindricalHeightmap(p.triangles, {
        stockRadius: stockR,
        xStart: extXStart,
        xEnd: extXEnd,
        nx,
        na
      })
      stats = countHits(hm)
    }
  }

  // ── Tool radius compensation ───────────────────────────────────────────
  const compensated = applyToolRadiusCompensation(hm, toolR, stockR)
  let minCompR = Infinity
  for (let i = 0; i < compensated.length; i++) {
    const v = compensated[i]!
    if (v > 0 && v < minCompR) minCompR = v
  }
  if (minCompR === Infinity) minCompR = stats.meshRadialMin > 0 ? stats.meshRadialMin : stockR

  // ── Mesh-aware depth levels ────────────────────────────────────────────
  const providedStep =
    p.zDepthsMm.length >= 2 ? Math.abs(p.zDepthsMm[0]! - p.zDepthsMm[1]!) : 0
  const userZPass = Math.min(...p.zDepthsMm)
  const zStepMm = providedStep > 0.1 ? providedStep : 2

  let allDepths: number[]
  if (stats.meshRadialMin > 0 && stats.meshRadialMin < stockR - 0.1 && stats.hitCount > 0) {
    allDepths = computeMeshAwareDepths(minCompR, stockR, zStepMm, userZPass)
  } else {
    allDepths = [...p.zDepthsMm].sort((a, b) => b - a)
  }

  // ── Curvature-adaptive angular refinement ──────────────────────────────
  let roughPassAngles: number[]
  if (p.adaptiveRefinement === true) {
    const curvature = computeAngularCurvature(hm)
    const maxExtra = Math.min(Math.ceil(na * 0.3), Math.floor(maxCells / nx - na))
    roughPassAngles = buildAdaptiveAngles(actualStepADeg, na, curvature, Math.max(0, maxExtra))
  } else {
    roughPassAngles = Array.from({ length: na }, (_, i) => i * actualStepADeg)
  }

  // ── Emit ──────────────────────────────────────────────────────────────
  const emit = new Emitter({
    stockRadius: stockR,
    safeZMm: p.safeZMm,
    maxZMm: p.maxZMm,
    feedMmMin: p.feedMmMin,
    plungeMmMin: p.plungeMmMin,
    stockDiameterMm: p.cylinderDiameterMm,
    maxRotaryRpm: p.maxRotaryRpm,
    toolDiameterMm: toolD
  })

  emit.comment(
    `4-axis cylindrical roughing — R=${stockR.toFixed(1)}mm (Ø${(stockR * 2).toFixed(1)}), ` +
      `X=[${p.machXStartMm.toFixed(2)}..${p.machXEndMm.toFixed(2)}] +overcut ${overcutMm.toFixed(1)}mm, ` +
      `A step≈${actualStepADeg.toFixed(2)}° (grid ${nx}×${na}), Z levels=${allDepths.length}, ` +
      `tool Ø${toolD.toFixed(2)}mm`
  )
  emit.comment(`Depth levels: ${allDepths.map((d) => d.toFixed(2)).join(', ')}`)
  emit.comment('Algorithm: cylindrical heightmap + tool-radius compensation + waterline roughing')
  emit.comment('VERIFY: cylinder diameter; A home')
  emit.comment(
    `Heightmap: ${stats.hitCount}/${hm.radii.length} cells hit (${((stats.hitCount / hm.radii.length) * 100).toFixed(1)}%)`
  )
  if (stats.clampedCount > 0) {
    emit.comment(
      `WARNING: ${stats.clampedCount} cells had triangles past stock OD (HIT_CLAMPED) — validation should have caught this`
    )
  }

  emit.retractToClear(true)
  let firstPassEver = true

  for (let di = 0; di < allDepths.length; di++) {
    const zd = allDepths[di]!
    const targetCutR = stockR + zd
    if (targetCutR < 0.05) continue

    if (di > 0) {
      // Full retract between depth levels.
      emit.rapidZ(emit.clearZ)
    }
    emit.comment(`─── Roughing: depth ${zd.toFixed(3)}mm (waterline R=${targetCutR.toFixed(3)}mm) ───`)

    // Stepover clearance: above current depth level by at least 2mm or one
    // tool diameter, whichever is larger. Capped at clearZ.
    const stepoverClearZ = Math.min(emit.clearZ, targetCutR + Math.max(2, toolD))

    let firstPassThisDepth = true

    for (const aDeg of roughPassAngles) {
      const iaFloat = aDeg / actualStepADeg
      const isOnGrid = Math.abs(iaFloat - Math.round(iaFloat)) < 1e-6
      const ia = isOnGrid ? Math.round(iaFloat) % na : -1

      const passPoints: Array<{ x: number; cutZ: number }> = []
      for (let ix = 0; ix < nx; ix++) {
        const x = extXStart + ix * actualDx
        let compR: number
        if (ia >= 0) {
          compR = compensated[ix * na + ia]!
        } else {
          compR = sampleHeightmapAtAngle(hm, compensated, ix, aDeg)
        }

        let cutZ: number
        if (compR === NO_HIT || compR === HIT_CLAMPED || compR <= 0) {
          // No mesh at this position — cut at waterline depth to clear stock
          cutZ = targetCutR
        } else {
          const surfaceLimit = compR + allowance
          cutZ = Math.max(surfaceLimit, targetCutR)
        }
        if (cutZ < 0.05) continue
        if (cutZ >= stockR - 0.05) continue
        passPoints.push({ x, cutZ })
      }

      if (passPoints.length < 2) continue

      const firstPt = passPoints[0]!

      if (firstPassEver) {
        // Very first pass overall — rapid into position.
        emit.rapidX(firstPt.x)
        emit.rotateA(aDeg, emit.clearZ)
        emit.plungeZ(firstPt.cutZ)
        firstPassEver = false
        firstPassThisDepth = false
      } else if (firstPassThisDepth) {
        // First pass at this depth level: full retract to clearZ already done.
        emit.rotateA(aDeg, emit.clearZ)
        emit.rapidX(firstPt.x)
        emit.plungeZ(firstPt.cutZ)
        firstPassThisDepth = false
      } else {
        // Subsequent pass at the same depth — retract to stepover clearance,
        // rotate, reposition, plunge.
        emit.rapidZ(stepoverClearZ)
        emit.rotateA(aDeg, stepoverClearZ)
        emit.rapidX(firstPt.x)
        emit.plungeZ(firstPt.cutZ)
      }

      for (let i = 1; i < passPoints.length; i++) {
        const pt = passPoints[i]!
        emit.cutTo(pt.x, pt.cutZ)
      }
    }
  }

  emit.returnHome()

  return { lines: emit.lines(), warnings: emit.warnings() }
}

// ─── Mesh-aware depth helper (port from cam-axis4-cylindrical-raster.ts) ───

function computeMeshAwareDepths(
  meshRadialMin: number,
  stockRadius: number,
  zStepMm: number,
  userZPassMm: number
): number[] {
  // Stop the deepest waterline pass 0.5mm ABOVE the closest-to-axis mesh point.
  // The legacy code subtracted 0.5 here ("with a small margin past it"), which
  // put the cut RADIUS 0.5mm INSIDE the mesh — a 0.5mm gouge on every part.
  // Caught by the integration test against a 24-segment ring (R=15) where the
  // polygon apothem is 14.87mm but the strategy cut to 14.37mm.
  const ROUGHING_SAFETY_MARGIN_MM = 0.5
  const meshDepth = -(stockRadius - Math.max(0.5, meshRadialMin + ROUGHING_SAFETY_MARGIN_MM))
  const targetDepth = Math.min(userZPassMm, meshDepth)
  if (targetDepth >= -0.1) return [-1]
  const step = Math.max(0.25, Math.min(Math.abs(targetDepth) / 2, zStepMm > 0 ? zStepMm : 2))
  const depths: number[] = []
  let d = -step
  while (d > targetDepth + 1e-6) {
    depths.push(d)
    d -= step
  }
  depths.push(targetDepth)
  return depths
}
