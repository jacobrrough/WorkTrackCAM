/**
 * 4-Axis Pattern Parallel Fallback (no STL)
 *
 * Simple pattern-based parallel passes used when no mesh is available:
 * zigzag X at each A angle, for each Z depth.
 */
import { Emitter } from '../emit'

export type PatternParams = {
  cylinderDiameterMm: number
  machXStartMm: number
  machXEndMm: number
  zDepthsMm: number[]
  stepoverDeg: number
  feedMmMin: number
  plungeMmMin: number
  safeZMm: number
  toolDiameterMm: number
  overcutMm?: number
  maxZMm?: number
  maxRotaryRpm?: number
}

export type PatternResult = {
  lines: string[]
  warnings: string[]
}

export function generatePattern(p: PatternParams): PatternResult {
  const stockR = Math.max(1e-6, p.cylinderDiameterMm / 2)
  const ocMm = p.overcutMm ?? p.toolDiameterMm
  const extXStart = Math.max(0, p.machXStartMm - ocMm)
  const extXEnd = p.machXEndMm + ocMm
  const step = p.stepoverDeg

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
    `4-axis cylindrical parallel (pattern) — D=${p.cylinderDiameterMm.toFixed(1)}mm, ` +
      `X=[${p.machXStartMm.toFixed(2)}..${p.machXEndMm.toFixed(2)}] +overcut ${ocMm.toFixed(1)}mm, ` +
      `Z levels=${p.zDepthsMm.length}, A step=${step.toFixed(1)}°`
  )
  emit.comment('VERIFY: cylinder diameter, stock zero, A WCS home, chuck bounds')
  emit.retractToClear(true)

  let passNum = 0
  let direction = 1
  for (const zd of p.zDepthsMm) {
    const cutZ = stockR + zd
    if (cutZ < 0.05) continue
    emit.comment(`--- Z depth ${zd.toFixed(3)} mm (radial cut Z=${cutZ.toFixed(3)}) ---`)

    let aAngle = 0
    while (aAngle <= 360 + 1e-6) {
      passNum++
      const xs = direction === 1 ? extXStart : extXEnd
      const xe = direction === 1 ? extXEnd : extXStart
      emit.comment(`Pass ${passNum}  A=${aAngle.toFixed(2)}°  Z_pass=${zd.toFixed(3)}`)
      emit.rapidZ(emit.clearZ)
      emit.rotateA(aAngle, emit.clearZ)
      emit.rapidX(xs)
      emit.plungeZ(cutZ)
      emit.cutTo(xe, cutZ)
      emit.rapidZ(emit.clearZ)
      aAngle += step
      direction *= -1
    }
  }

  emit.returnHome()
  return { lines: emit.lines(), warnings: emit.warnings() }
}
