/**
 * Small bridge module so `cam-axis4/index.ts` can call helpers without
 * importing `cam-runner.ts` directly (which would create a circular import,
 * since cam-runner.ts imports `runAxis4` from `cam-axis4/index.ts`).
 *
 * Both helpers are pure functions of their inputs — they have no I/O and no
 * dependency on the rest of cam-runner.
 */
import type { SubroutineDialect, LineNumberingConfig } from '../post-process'

/**
 * Whether the operation kind routes to the 4-axis TS engine.
 * These ops require `axisCount >= 4` on the machine profile.
 */
export function manufactureKindUses4AxisEngine(kind: string | undefined): boolean {
  return (
    kind === 'cnc_4axis_roughing' ||
    kind === 'cnc_4axis_finishing' ||
    kind === 'cnc_4axis_contour' ||
    kind === 'cnc_4axis_indexed' ||
    kind === 'cnc_4axis_continuous'
  )
}

/**
 * Extract post-processing options from the operation params record.
 * Returns the subset of `renderPost` opts that control arc fitting,
 * cutter compensation, subroutines, line numbering, and inverse-time feed.
 * All fields are optional — omitted when the user hasn't enabled them.
 */
export function extractPostProcessingOpts(params: Record<string, unknown> | undefined): {
  enableArcFitting?: boolean
  arcTolerance?: number
  cutterCompensation?: 'none' | 'left' | 'right'
  cutterCompDRegister?: number
  enableSubroutines?: boolean
  subroutineDialect?: SubroutineDialect
  lineNumbering?: LineNumberingConfig
  inverseTimeFeed?: boolean
} {
  if (!params) return {}
  const opts: ReturnType<typeof extractPostProcessingOpts> = {}

  if (params['enableArcFitting'] === true) {
    opts.enableArcFitting = true
    if (typeof params['arcTolerance'] === 'number' && params['arcTolerance'] > 0) {
      opts.arcTolerance = params['arcTolerance']
    }
  }

  const cc = params['cutterCompensation']
  if (cc === 'left' || cc === 'right') {
    opts.cutterCompensation = cc
    if (typeof params['cutterCompDRegister'] === 'number' && params['cutterCompDRegister'] >= 1) {
      opts.cutterCompDRegister = params['cutterCompDRegister']
    }
  }

  if (params['enableSubroutines'] === true) {
    opts.enableSubroutines = true
    const dialect = params['subroutineDialect']
    if (dialect === 'fanuc' || dialect === 'siemens' || dialect === 'mach3') {
      opts.subroutineDialect = dialect
    } else {
      opts.subroutineDialect = 'fanuc'
    }
  }

  if (params['lineNumberingEnabled'] === true) {
    const start =
      typeof params['lineNumberingStart'] === 'number' ? params['lineNumberingStart'] : 10
    const increment =
      typeof params['lineNumberingIncrement'] === 'number'
        ? params['lineNumberingIncrement']
        : 10
    opts.lineNumbering = { enabled: true, start, increment }
  }

  if (params['inverseTimeFeed'] === true) {
    opts.inverseTimeFeed = true
  }

  return opts
}
