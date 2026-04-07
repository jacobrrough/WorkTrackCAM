/**
 * Derive raster / parallel stepover from target scallop (cusp) height between adjacent passes.
 * Simplified ball-end and flat-end models share the same chord formula for small scallops:
 *   stepover ≈ 2 * sqrt(2*R*scallop - scallop²)  with R = tool radius.
 * See machining handbooks / CAM texts (cusp height vs stepover for 3D finishing).
 */

export type FinishScallopMode = 'ball' | 'flat'

/** Lateral stepover (mm) for given tool radius and scallop height. */
export function stepoverFromScallopMm(toolDiameterMm: number, scallopMm: number, _mode: FinishScallopMode): number {
  const R = Math.max(toolDiameterMm * 0.5, 1e-6)
  const h = Math.max(scallopMm, 1e-9)
  if (h >= R * 0.999) return Math.min(R * 1.9, toolDiameterMm * 0.95)
  const inner = 2 * R * h - h * h
  if (inner <= 0) return toolDiameterMm * 0.05
  const e = 2 * Math.sqrt(inner)
  return Math.min(Math.max(e, 0.01), toolDiameterMm * 0.95)
}

export function resolve3dFinishStepoverMm(input: {
  toolDiameterMm: number
  baseStepoverMm: number
  operationParams?: Record<string, unknown> | null
}): { stepoverMm: number; source: 'finishStepoverMm' | 'finishScallopMm' | 'stepoverMm' } {
  const p = input.operationParams
  const finishStep =
    p && typeof p['finishStepoverMm'] === 'number' && Number.isFinite(p['finishStepoverMm']) && p['finishStepoverMm'] > 0
      ? p['finishStepoverMm']
      : undefined
  if (finishStep != null) return { stepoverMm: finishStep, source: 'finishStepoverMm' }

  const scallop =
    p && typeof p['finishScallopMm'] === 'number' && Number.isFinite(p['finishScallopMm']) && p['finishScallopMm'] > 0
      ? p['finishScallopMm']
      : undefined
  if (scallop != null) {
    const rawMode = p?.['finishScallopMode']
    const mode: FinishScallopMode = rawMode === 'flat' ? 'flat' : 'ball'
    return {
      stepoverMm: stepoverFromScallopMm(input.toolDiameterMm, scallop, mode),
      source: 'finishScallopMm'
    }
  }

  return { stepoverMm: input.baseStepoverMm, source: 'stepoverMm' }
}
