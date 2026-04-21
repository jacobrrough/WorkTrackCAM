import { renderPost, type RenderPostResult, type SubroutineDialect, type LineNumberingConfig } from './post-process'
import type { MachineProfile } from '../shared/machine-schema'
import { withCamStageTelemetry } from './cam-runtime-telemetry'

export type PostDomainRequest = {
  resourcesRoot: string
  machine: MachineProfile
  toolpathLines: string[]
  opts?: {
    workCoordinateIndex?: number
    operationLabel?: string
    spindleRpm?: number
    toolNumber?: number
    inverseTimeFeed?: boolean
    toolWearOffsetH?: number
    toolWearOffsetD?: number
    enableArcFitting?: boolean
    arcTolerance?: number
    cutterCompensation?: 'none' | 'left' | 'right'
    cutterCompDRegister?: number
    enableSubroutines?: boolean
    subroutineDialect?: SubroutineDialect
    lineNumbering?: LineNumberingConfig
  }
}

/**
 * Post-processing boundary facade.
 * Centralizes the main-process entrypoint to posting logic.
 */
export async function runPostDomain(request: PostDomainRequest): Promise<RenderPostResult> {
  return withCamStageTelemetry('cam.post_render', () =>
    renderPost(request.resourcesRoot, request.machine, request.toolpathLines, request.opts)
  )
}
