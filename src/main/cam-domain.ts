import { runCamPipeline, type CamJobConfig, type CamRunResult } from './cam-runner'
import { camRunResultSchema } from '../shared/cam-ipc-contract'
import { normalizeCamRunToEngineResult } from './cam-engine-adapter'
import { withCamStageTelemetry } from './cam-runtime-telemetry'

export type CamDomainRequest = CamJobConfig
export type CamDomainResult = CamRunResult

/**
 * Boundary facade for CAM execution.
 * Keeps IPC handlers decoupled from the large cam-runner implementation.
 */
export async function runCamDomain(request: CamDomainRequest): Promise<CamDomainResult> {
  const result = await withCamStageTelemetry('cam.run_pipeline', () => runCamPipeline(request))
  // Phase-2 contract unification: ensure the legacy pipeline maps cleanly to
  // the canonical engine contract shape.
  try {
    normalizeCamRunToEngineResult(result)
  } catch (error) {
    return {
      ok: false,
      error: 'CAM engine adapter contract violation.',
      hint: error instanceof Error ? error.message : String(error)
    }
  }
  const parsed = camRunResultSchema.safeParse(result)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'CAM result violated IPC contract.',
      hint: parsed.error.issues.map((issue) => issue.message).join('; ')
    }
  }
  return result
}
