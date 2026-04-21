/**
 * 4-Axis Contour Wrapping
 *
 * Wraps a 2D contour (X, Y_mm) onto the cylinder surface as X / A moves.
 * Y is converted to A degrees: A = (Y / (π·D)) × 360.
 * X is clamped to the machinable axial span.
 */
import { Emitter } from '../emit'

export type ContourParams = {
  contourPoints: ReadonlyArray<readonly [number, number]>
  cylinderDiameterMm: number
  machXStartMm: number
  machXEndMm: number
  /** Depth levels (negative; relative to stock surface). */
  zDepthsMm: number[]
  feedMmMin: number
  plungeMmMin: number
  safeZMm: number
  toolDiameterMm: number
  maxZMm?: number
  maxRotaryRpm?: number
}

export type ContourResult = {
  lines: string[]
  warnings: string[]
}

export function generateContour(p: ContourParams): ContourResult {
  const stockR = Math.max(1e-6, p.cylinderDiameterMm / 2)
  const circumference = Math.PI * p.cylinderDiameterMm

  const emit = new Emitter({
    stockRadius: stockR,
    safeZMm: p.safeZMm,
    maxZMm: p.maxZMm,
    feedMmMin: p.feedMmMin,
    plungeMmMin: p.plungeMmMin,
    stockDiameterMm: p.cylinderDiameterMm,
    maxRotaryRpm: p.maxRotaryRpm,
    toolDiameterMm: p.toolDiameterMm
  })

  emit.comment(
    `4-axis contour wrapping — D=${p.cylinderDiameterMm.toFixed(1)}mm, ` +
      `${p.contourPoints.length} pts, X clamp [${p.machXStartMm.toFixed(2)}..${p.machXEndMm.toFixed(2)}], ` +
      `Z levels=${p.zDepthsMm.length}`
  )
  emit.retractToClear(true)

  if (p.contourPoints.length === 0) {
    emit.returnHome()
    return { lines: emit.lines(), warnings: emit.warnings() }
  }

  const linearToA = (yMm: number): number => {
    if (circumference <= 0) return 0
    return (yMm / circumference) * 360
  }

  const clampX = (x: number): number => {
    return Math.max(p.machXStartMm, Math.min(p.machXEndMm, x))
  }

  for (const zd of p.zDepthsMm) {
    const cutZ = stockR + zd
    if (cutZ < 0.05) continue
    emit.comment(`--- contour at Z_pass=${zd.toFixed(3)} ---`)

    const [firstX, firstY] = p.contourPoints[0]!
    const cx0 = clampX(firstX)
    const a0 = linearToA(firstY)

    // Retract before re-positioning to a new depth's start.
    emit.rapidZ(emit.clearZ)
    emit.rotateA(a0, emit.clearZ)
    emit.rapidX(cx0)
    emit.plungeZ(cutZ)

    for (let i = 1; i < p.contourPoints.length; i++) {
      const [xMm, yMm] = p.contourPoints[i]!
      const cx = clampX(xMm)
      const aDeg = linearToA(yMm)
      emit.cutTo(cx, cutZ, aDeg)
    }
  }

  emit.returnHome()
  return { lines: emit.lines(), warnings: emit.warnings() }
}
