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
 * cutter compensation, subroutines, line numbering, inverse-time feed,
 * and dust-collection M-code emission.
 * All fields are optional — omitted when the user hasn't enabled them.
 *
 * Roadmap: [ID-0064] adds the `dustCollection` pass-through so the
 * Laguna Swift 5x10 RichAuto A-series post (`vcarve_mach3.hbs`) can emit
 * `M7` (dust collection ON) after the spindle warm-up dwell and `M9`
 * before spindle-off when the operator opts in via the per-job UI checkbox.
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
  dustCollection?: boolean
  enableSimultaneous4Axis?: boolean
  manualToolChange?: boolean
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

  // [ID-0064] dust collection: per-job opt-in for posts that wire M7/M9
  // behind a flag (Laguna Swift 5x10 vcarve_mach3.hbs today). Strict-true
  // gate so `false` / undefined / non-bool params behave the same — keeps
  // the post template's commented-reminder default in play.
  if (params['dustCollection'] === true) {
    opts.dustCollection = true
  }

  // [ID-0015] Carvera 4-axis simultaneous opt-in: when true, the post emits
  // a prominent UNVERIFIED-SIMULTANEOUS warning header acknowledging the
  // operator has opted in to community-firmware-dependent behaviour.
  // Strict-true gate so anything other than literal `true` reads as off
  // (preserving Safety Rule 2 byte-identical default).
  if (params['enableSimultaneous4Axis'] === true) {
    opts.enableSimultaneous4Axis = true
  }

  // [ID-0013-integration] Carvera 3-axis ATC opt-out: when true, the post
  // template suppresses M6 + G43 emission and emits a manual-change comment.
  // Strict-true gate so anything other than literal `true` reads as off
  // (Safety Rule 2 default byte-identity preserved).
  if (params['manualToolChange'] === true) {
    opts.manualToolChange = true
  }

  return opts
}
