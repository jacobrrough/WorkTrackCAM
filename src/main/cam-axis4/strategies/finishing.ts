/**
 * 4-Axis Cylindrical Finishing Pass
 *
 * Surface-following finish at the deepest depth level.
 *
 * Key differences from roughing:
 *   - Uses ONE depth (the deepest user-requested level)
 *   - Finer angular stepover (defaults to roughing stepover / 2)
 *   - Follows the compensated mesh surface — no waterline floor
 *   - Higher rotational density warrants its own heightmap rebuild if the
 *     finish stepover is finer than the roughing stepover
 */
import type { Triangle } from '../frame'
import {
  buildCylindricalHeightmap,
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

export type FinishingParams = {
  triangles: Triangle[]
  cylinderDiameterMm: number
  machXStartMm: number
  machXEndMm: number
  /** Roughing stepover (deg) — finish defaults to half of this. */
  stepoverDeg: number
  finishStepoverDeg?: number
  stepXMm: number
  /** Single deepest depth (negative; the finishing target). */
  finishDepthMm: number
  feedMmMin: number
  plungeMmMin: number
  safeZMm: number
  finishAllowanceMm?: number
  maxCells?: number
  toolDiameterMm: number
  overcutMm?: number
  maxZMm?: number
  maxRotaryRpm?: number
  adaptiveRefinement?: boolean
}

export type FinishingResult = {
  lines: string[]
  warnings: string[]
}

export function generateFinishing(p: FinishingParams): FinishingResult {
  const stockR = Math.max(1e-6, p.cylinderDiameterMm / 2)
  const toolD = p.toolDiameterMm
  const toolR = toolD / 2
  const overcutMm = p.overcutMm ?? toolD
  const stepA = Math.max(0.5, Math.min(90, p.stepoverDeg))
  const finishStepDeg = Math.max(0.5, p.finishStepoverDeg ?? stepA / 2)

  const machXStartClamped = Math.max(0, p.machXStartMm)
  const machXEndClamped = Math.max(machXStartClamped + 0.1, p.machXEndMm)
  const extXStart = Math.max(0, machXStartClamped - overcutMm)
  const extXEnd = machXEndClamped + overcutMm
  const extSpanX = extXEnd - extXStart

  const targetStepX = Math.max(0.1, p.stepXMm)
  let nx = Math.max(10, Math.ceil(extSpanX / targetStepX) + 1)
  let na = Math.max(36, Math.ceil(360 / finishStepDeg))
  const maxCells = Math.max(1000, Math.min(500_000, p.maxCells ?? 250_000))
  while (nx * na > maxCells && nx > 10) nx--
  while (nx * na > maxCells && na > 36) na--

  const allowance = Math.max(0, p.finishAllowanceMm ?? 0)
  const actualFinishDaDeg = 360 / na
  const actualDx = extSpanX / Math.max(1, nx - 1)

  // Build the finishing heightmap directly at the finer angular resolution.
  const hm = buildCylindricalHeightmap(p.triangles, {
    stockRadius: stockR,
    xStart: extXStart,
    xEnd: extXEnd,
    nx,
    na
  })
  const compensated = applyToolRadiusCompensation(hm, toolR, stockR)

  // Per-angle X extents (used to skip air regions during finishing).
  const overcutCells = Math.max(1, Math.ceil(overcutMm / actualDx))
  const finishExtents = computePerAngleXExtents(hm, overcutCells)

  // Adaptive refinement.
  let finishPassAngles: number[]
  if (p.adaptiveRefinement === true) {
    const curvature = computeAngularCurvature(hm)
    const maxExtra = Math.min(Math.ceil(na * 0.3), Math.floor(maxCells / nx - na))
    finishPassAngles = buildAdaptiveAngles(actualFinishDaDeg, na, curvature, Math.max(0, maxExtra))
  } else {
    finishPassAngles = Array.from({ length: na }, (_, i) => i * actualFinishDaDeg)
  }

  const finishTargetR = stockR + p.finishDepthMm
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
    `4-axis cylindrical finishing — R=${stockR.toFixed(1)}mm (Ø${(stockR * 2).toFixed(1)}), ` +
      `target R=${finishTargetR.toFixed(3)}mm, A step=${actualFinishDaDeg.toFixed(2)}° (${na} passes)`
  )
  emit.comment('Algorithm: surface-following finish at single deepest depth level')
  emit.retractToClear(true)

  if (finishTargetR < 0.05) {
    emit.comment(
      `Skipping finish: target R ${finishTargetR.toFixed(3)} is below cutting threshold`
    )
    emit.returnHome()
    return { lines: emit.lines(), warnings: emit.warnings() }
  }

  // Stepover clearance: above target by 2 mm or one tool diameter.
  const stepoverClearZ = Math.min(emit.clearZ, finishTargetR + Math.max(2, toolD))
  let firstPass = true

  for (const aDeg of finishPassAngles) {
    const finIaFloat = aDeg / actualFinishDaDeg
    const finIsOnGrid = Math.abs(finIaFloat - Math.round(finIaFloat)) < 1e-6
    const finIa = finIsOnGrid ? Math.round(finIaFloat) % na : -1

    const nearestIa = Math.round(finIaFloat) % na
    const [xIdxStart, xIdxEnd] = finishExtents[nearestIa]!
    if (xIdxStart === -1) continue

    const passPoints: Array<{ x: number; cutZ: number }> = []
    for (let ix = xIdxStart; ix <= xIdxEnd; ix++) {
      const x = hm.xStart + ix * hm.dx
      let compR: number
      if (finIa >= 0) {
        compR = compensated[ix * na + finIa]!
      } else {
        compR = sampleHeightmapAtAngle(hm, compensated, ix, aDeg)
      }
      let cutZ: number
      if (compR === NO_HIT || compR === HIT_CLAMPED || compR <= 0) {
        cutZ = finishTargetR
      } else {
        cutZ = compR + allowance
      }
      if (cutZ < 0.05) continue
      if (cutZ >= stockR - 0.05) continue
      passPoints.push({ x, cutZ })
    }
    if (passPoints.length < 2) continue

    const firstPt = passPoints[0]!

    if (firstPass) {
      emit.rapidX(firstPt.x)
      emit.rotateA(aDeg, emit.clearZ)
      emit.plungeZ(firstPt.cutZ)
      firstPass = false
    } else {
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

  emit.returnHome()
  return { lines: emit.lines(), warnings: emit.warnings() }
}
