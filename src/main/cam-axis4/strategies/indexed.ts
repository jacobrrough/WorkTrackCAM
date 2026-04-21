/**
 * 4-Axis Indexed Passes
 *
 * At each angle in `indexAnglesDeg`, face along X at each depth level.
 * Alternates X direction for efficient zigzag.
 */
import { Emitter } from '../emit'

export type IndexedParams = {
  indexAnglesDeg: ReadonlyArray<number>
  cylinderDiameterMm: number
  machXStartMm: number
  machXEndMm: number
  zDepthsMm: number[]
  feedMmMin: number
  plungeMmMin: number
  safeZMm: number
  toolDiameterMm: number
  overcutMm?: number
  maxZMm?: number
  maxRotaryRpm?: number
}

export type IndexedResult = {
  lines: string[]
  warnings: string[]
}

export function generateIndexed(p: IndexedParams): IndexedResult {
  const stockR = Math.max(1e-6, p.cylinderDiameterMm / 2)
  const ocMm = p.overcutMm ?? p.toolDiameterMm
  const extXStart = Math.max(0, p.machXStartMm - ocMm)
  const extXEnd = p.machXEndMm + ocMm

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
    `4-axis indexed — ${p.indexAnglesDeg.length} angles, ` +
      `X=[${p.machXStartMm.toFixed(2)}..${p.machXEndMm.toFixed(2)}] +overcut ${ocMm.toFixed(1)}mm, ` +
      `Z levels=${p.zDepthsMm.length}`
  )
  emit.comment(`D=${p.cylinderDiameterMm.toFixed(1)}mm`)
  emit.comment('VERIFY: A zero, stock zero, each index angle before running')
  emit.retractToClear(true)

  let direction = 1
  for (const zd of p.zDepthsMm) {
    const cutZ = stockR + zd
    if (cutZ < 0.05) continue
    emit.comment(`--- indexed passes at Z_pass=${zd.toFixed(3)} ---`)

    for (let i = 0; i < p.indexAnglesDeg.length; i++) {
      const angle = p.indexAnglesDeg[i]!
      const xs = direction === 1 ? extXStart : extXEnd
      const xe = direction === 1 ? extXEnd : extXStart
      emit.comment(
        `Index ${i + 1}/${p.indexAnglesDeg.length}  A=${angle.toFixed(2)}°  Z=${zd.toFixed(3)}`
      )
      emit.rapidZ(emit.clearZ)
      emit.rotateA(angle, emit.clearZ)
      emit.rapidX(xs)
      emit.plungeZ(cutZ)
      emit.cutTo(xe, cutZ)
      emit.rapidZ(emit.clearZ)
      direction *= -1
    }
  }

  emit.returnHome()
  return { lines: emit.lines(), warnings: emit.warnings() }
}
