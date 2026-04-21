/**
 * 4-Axis Continuous (combined roughing + finishing pass)
 *
 * `cnc_4axis_continuous` was a phantom kind in the old engine — listed by
 * `manufactureKindUses4AxisEngine` but with no real handler (it fell through
 * to `'4axis_wrapping'` which used the same code as roughing).
 *
 * For v1 of the rewire, we make `continuous` mean "run the cylindrical
 * roughing strategy followed by a finishing pass at the deepest depth", in a
 * single G-code stream. This matches what most users seem to expect from a
 * "continuous" 4-axis op (one program that fully cuts the part).
 *
 * If a user actually wants true simultaneous 4-axis interpolation (5-axis-style
 * sweeps), that's a future feature — flag it via the warnings list so they know
 * what they're getting.
 */
import type { Triangle } from '../frame'
import { generateFinishing, type FinishingResult } from './finishing'
import { generateRoughing, type RoughingResult } from './roughing'

export type ContinuousParams = {
  triangles: Triangle[]
  cylinderDiameterMm: number
  machXStartMm: number
  machXEndMm: number
  stepoverDeg: number
  finishStepoverDeg?: number
  stepXMm: number
  zDepthsMm: number[]
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

export type ContinuousResult = {
  lines: string[]
  warnings: string[]
}

export function generateContinuous(p: ContinuousParams): ContinuousResult {
  const warnings: string[] = []
  warnings.push(
    'cnc_4axis_continuous in v1 emits roughing + finishing in sequence, not true simultaneous 4-axis interpolation. Open an issue if your job requires the latter.'
  )

  const roughDepths = p.zDepthsMm.length > 1 ? p.zDepthsMm.slice(0, -1) : p.zDepthsMm
  const finishDepth = p.zDepthsMm[p.zDepthsMm.length - 1]!

  const rough: RoughingResult = generateRoughing({
    triangles: p.triangles,
    cylinderDiameterMm: p.cylinderDiameterMm,
    machXStartMm: p.machXStartMm,
    machXEndMm: p.machXEndMm,
    stepoverDeg: p.stepoverDeg,
    stepXMm: p.stepXMm,
    zDepthsMm: roughDepths,
    feedMmMin: p.feedMmMin,
    plungeMmMin: p.plungeMmMin,
    safeZMm: p.safeZMm,
    finishAllowanceMm: p.finishAllowanceMm,
    maxCells: p.maxCells,
    toolDiameterMm: p.toolDiameterMm,
    overcutMm: p.overcutMm,
    maxZMm: p.maxZMm,
    maxRotaryRpm: p.maxRotaryRpm,
    adaptiveRefinement: p.adaptiveRefinement
  })

  const finish: FinishingResult = generateFinishing({
    triangles: p.triangles,
    cylinderDiameterMm: p.cylinderDiameterMm,
    machXStartMm: p.machXStartMm,
    machXEndMm: p.machXEndMm,
    stepoverDeg: p.stepoverDeg,
    finishStepoverDeg: p.finishStepoverDeg,
    stepXMm: p.stepXMm,
    finishDepthMm: finishDepth,
    feedMmMin: p.feedMmMin,
    plungeMmMin: p.plungeMmMin,
    safeZMm: p.safeZMm,
    finishAllowanceMm: 0, // finishing pass should land on the surface itself
    maxCells: p.maxCells,
    toolDiameterMm: p.toolDiameterMm,
    overcutMm: p.overcutMm,
    maxZMm: p.maxZMm,
    maxRotaryRpm: p.maxRotaryRpm,
    adaptiveRefinement: p.adaptiveRefinement
  })

  const lines = [
    '; ─── Continuous 4-axis: roughing followed by finishing ───',
    ...rough.lines,
    '; ─── Finishing pass ───',
    ...finish.lines
  ]
  warnings.push(...rough.warnings, ...finish.warnings)
  return { lines, warnings }
}
