import { renderPost, type RenderPostResult, type SubroutineDialect, type LineNumberingConfig } from './post-process'
import type { MachineProfile } from '../shared/machine-schema'
import type { LagunaVacuumZoneAllocation } from '../shared/laguna-vacuum-allocator'
import type { LagunaVacuumPostludeOptions } from '../shared/laguna-vacuum-postlude'
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
    /**
     * Optional Laguna Swift 5x10 vacuum-zone allocation. When supplied,
     * renderPost splices the Cycle 103 wrapLagunaToolpathWithVacuumBlocks
     * preamble + release postamble around the toolpath. Roadmap
     * [ID-0020-wire] (Cycle 109). The two opts are pure pass-through to
     * renderPost; they have NO effect on non-Laguna machines because the
     * helper short-circuits when no allocation is supplied.
     */
    vacuumZoneAllocation?: LagunaVacuumZoneAllocation
    /** Companion options for vacuumZoneAllocation (e.g. M64/M65 opt-in). */
    vacuumOptions?: LagunaVacuumPostludeOptions
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
