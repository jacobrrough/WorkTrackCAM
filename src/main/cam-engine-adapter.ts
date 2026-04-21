import type { CamRunResult } from './cam-runner'
import { camEngineResultSchema, type CamEngineResult } from '../shared/cam-engine-contract'

/**
 * Canonical adapter for mapping existing CAM pipeline results into the
 * shared engine contract. This lets TS fallback and Python-backed paths
 * report through one shape.
 */
export function normalizeCamRunToEngineResult(result: CamRunResult): CamEngineResult {
  if (result.ok) {
    return camEngineResultSchema.parse({
      ok: true,
      engineId: result.engine.usedEngine,
      postedGcode: result.gcode,
      warnings: (result.warnings ?? []).map((message) => ({
        code: 'runtime_warning',
        message
      }))
    })
  }
  return camEngineResultSchema.parse({
    ok: false,
    engineId: 'builtin',
    failure: {
      code: 'cam_run_failed',
      message: result.error,
      detail: result.hint
    }
  })
}
