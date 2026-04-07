/**
 * 2D strategy dispatch for cam-runner.
 *
 * Extracted from the monolithic `runCamPipeline()` to isolate contour, pocket,
 * drill, chamfer, and PCB toolpath generation. The caller in `cam-runner.ts`
 * invokes `dispatch2dStrategy()` when the operation kind matches a 2D family.
 */
import { writeFile } from 'node:fs/promises'
import type { MachineProfile } from '../shared/machine-schema'
import {
  computeNegativeZDepthPasses,
  generateChamfer2dLines,
  generateContour2dLines,
  generateDrill2dLines,
  generatePocket2dLines
} from './cam-local'
import { renderPost } from './post-process'
import {
  extractPostProcessingOpts,
  resolveContourPathOptions,
  resolveContourRampOptions,
  resolveContourTabParams,
  resolveDrillCycleDecision,
  drillOperationHints,
  shouldAppendFinalPocketFinishPass,
  validate2dOperationGeometry,
  type CamJobConfig,
  type CamRunResult
} from './cam-runner'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function point2d(v: unknown): [number, number] | null {
  if (!Array.isArray(v) || v.length < 2) return null
  const x = Number(v[0])
  const y = Number(v[1])
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return [x, y]
}

function point2dList(v: unknown): [number, number][] {
  if (!Array.isArray(v)) return []
  const out: [number, number][] = []
  for (const item of v) {
    const p = point2d(item)
    if (p) out.push(p)
  }
  return out
}

// ---------------------------------------------------------------------------
// Public dispatch
// ---------------------------------------------------------------------------

/**
 * Generate, post-process, and write G-code for a 2D CNC operation.
 *
 * Handles: `cnc_contour`, `cnc_pocket`, `cnc_drill`, `cnc_chamfer`,
 * `cnc_pcb_isolation`, `cnc_pcb_contour`, `cnc_pcb_drill`.
 */
export async function dispatch2dStrategy(
  job: CamJobConfig,
  guardHint: string,
  postedGcodeEnvelopeHint: (machine: MachineProfile, gcode: string) => string
): Promise<CamRunResult> {
  const valid = validate2dOperationGeometry(job.operationKind, job.operationParams)
  if (!valid.ok) {
    return { ok: false, error: valid.error, hint: valid.hint }
  }

  const p = job.operationParams ?? {}
  let lines: string[] = []
  let pocketResultHints: string[] = []
  let drillResultHints: string[] = []

  if (job.operationKind === 'cnc_contour') {
    const contour = point2dList(p['contourPoints'])
    const { contourSide, leadInMm, leadOutMm, leadInMode, leadOutMode } = resolveContourPathOptions(p)
    const { rampType, rampAngleDeg } = resolveContourRampOptions(p)
    const tabParams = resolveContourTabParams(p)
    const zStepContour =
      typeof p['zStepMm'] === 'number' && Number.isFinite(p['zStepMm']) ? Math.max(0.01, p['zStepMm']) : undefined
    const contourOpts = {
      contourPoints: contour,
      feedMmMin: job.feedMmMin,
      plungeMmMin: job.plungeMmMin,
      safeZMm: job.safeZMm,
      contourSide,
      leadInMm,
      leadOutMm,
      leadInMode,
      leadOutMode,
      rampType,
      rampAngleDeg,
      ...(tabParams ? { tabParams } : {})
    }
    if (job.zPassMm < 0 && zStepContour != null) {
      const depths = computeNegativeZDepthPasses(job.zPassMm, zStepContour)
      lines = depths.flatMap((z) => generateContour2dLines({ ...contourOpts, zPassMm: z }))
    } else {
      lines = generateContour2dLines({ ...contourOpts, zPassMm: job.zPassMm })
    }
    if (lines.length === 0) {
      return {
        ok: false,
        error: 'Contour toolpath is empty.',
        hint:
          'Check contourPoints form a closed, non-degenerate polygon (\u22653 distinct points, non-zero area) in setup WCS; zPassMm must reach stock; safe height and feeds must be valid. Open or self-intersecting loops produce no moves.'
      }
    }
  } else if (job.operationKind === 'cnc_pocket') {
    const contour = point2dList(p['contourPoints'])
    const wallStockMm = typeof p['wallStockMm'] === 'number' && Number.isFinite(p['wallStockMm']) ? Math.max(0, p['wallStockMm']) : 0
    const zStepMm = typeof p['zStepMm'] === 'number' && Number.isFinite(p['zStepMm']) ? Math.max(0.01, p['zStepMm']) : undefined
    const entryMode = p['entryMode'] === 'ramp' ? 'ramp' : 'plunge'
    const rampMm = typeof p['rampMm'] === 'number' && Number.isFinite(p['rampMm']) ? Math.max(0.01, p['rampMm']) : undefined
    const rampMaxAngleDeg =
      typeof p['rampMaxAngleDeg'] === 'number' && Number.isFinite(p['rampMaxAngleDeg'])
        ? p['rampMaxAngleDeg']
        : undefined
    const finishPass = p['finishPass'] !== false
    const finishEachDepth = p['finishEachDepth'] === true
    const { contourSide, leadInMm, leadOutMm, leadInMode, leadOutMode } = resolveContourPathOptions(p)
    const pocket = generatePocket2dLines({
      contourPoints: contour,
      stepoverMm: job.stepoverMm,
      zPassMm: job.zPassMm,
      zStepMm,
      feedMmMin: job.feedMmMin,
      plungeMmMin: job.plungeMmMin,
      safeZMm: job.safeZMm,
      wallStockMm,
      finishEachDepth,
      entryMode,
      rampMm,
      rampMaxAngleDeg
    })
    lines = pocket.lines
    pocketResultHints = pocket.hints
    if (shouldAppendFinalPocketFinishPass({ finishPass, finishEachDepth })) {
      lines.push(
        ...generateContour2dLines({
          contourPoints: contour,
          zPassMm: job.zPassMm,
          feedMmMin: job.feedMmMin,
          plungeMmMin: job.plungeMmMin,
          safeZMm: job.safeZMm,
          contourSide,
          leadInMm,
          leadOutMm,
          leadInMode,
          leadOutMode
        })
      )
    }
    if (lines.length === 0) {
      return {
        ok: false,
        error: 'Pocket toolpath is empty.',
        hint:
          'Common causes: tool diameter too large for the pocket, contour too tight for stepover, invalid ramp settings, self-intersecting or open contours, or geometry the offsetter cannot offset. Try smaller toolDiameterMm / stepover or simplify contourPoints.'
      }
    }
  } else if (job.operationKind === 'cnc_chamfer') {
    const contour = point2dList(p['contourPoints'])
    const chamferDepthMm =
      typeof p['chamferDepthMm'] === 'number' && Number.isFinite(p['chamferDepthMm']) && p['chamferDepthMm'] > 0
        ? p['chamferDepthMm']
        : Math.abs(job.zPassMm)
    const chamferAngleDeg =
      typeof p['chamferAngleDeg'] === 'number' && Number.isFinite(p['chamferAngleDeg'])
        ? p['chamferAngleDeg']
        : undefined
    lines = generateChamfer2dLines({
      contourPoints: contour,
      chamferDepthMm,
      chamferAngleDeg,
      feedMmMin: job.feedMmMin,
      plungeMmMin: job.plungeMmMin,
      safeZMm: job.safeZMm
    })
    if (lines.length === 0) {
      return {
        ok: false,
        error: 'Chamfer toolpath is empty.',
        hint:
          'Check contourPoints form a closed polygon (\u22653 points), chamferDepthMm is positive, and feed/safe-Z are valid.'
      }
    }
  } else if (job.operationKind === 'cnc_pcb_isolation' || job.operationKind === 'cnc_pcb_contour') {
    const contour = point2dList(p['contourPoints'])
    lines = generateContour2dLines({
      contourPoints: contour,
      zPassMm: job.zPassMm,
      feedMmMin: job.feedMmMin,
      plungeMmMin: job.plungeMmMin,
      safeZMm: job.safeZMm
    })
    if (lines.length === 0) {
      return {
        ok: false,
        error: 'PCB toolpath is empty.',
        hint:
          'Check contourPoints form a closed, non-degenerate polygon (\u22653 points) and zPassMm is non-zero.'
      }
    }
  } else {
    // Drill operations (cnc_drill, cnc_pcb_drill)
    const drillPoints = point2dList(p['drillPoints'])
    const retractMm = typeof p['retractMm'] === 'number' && Number.isFinite(p['retractMm']) ? p['retractMm'] : undefined
    const peckMm = typeof p['peckMm'] === 'number' && Number.isFinite(p['peckMm']) ? p['peckMm'] : undefined
    const dwellMs = typeof p['dwellMs'] === 'number' && Number.isFinite(p['dwellMs']) ? p['dwellMs'] : undefined
    const drillCycleDecision = resolveDrillCycleDecision({ dialect: job.machine.dialect, operationParams: p })
    lines = generateDrill2dLines({
      drillPoints,
      zPassMm: job.zPassMm,
      feedMmMin: job.feedMmMin,
      safeZMm: job.safeZMm,
      retractMm,
      peckMm,
      dwellMs,
      cycleMode: drillCycleDecision.mode
    })
    drillResultHints = drillCycleDecision.hint ? [drillCycleDecision.hint] : []
    drillResultHints.push(...drillOperationHints(p, { zPassMm: job.zPassMm, safeZMm: job.safeZMm }))
    if (lines.length === 0) {
      return {
        ok: false,
        error: 'Drill toolpath is empty.',
        hint: 'Check drillPoints, zPassMm (depth), safeZMm, and retractMm; all must be consistent so the cycle can emit moves.'
      }
    }
  }

  const postResult = await renderPost(job.resourcesRoot, job.machine, lines, {
    workCoordinateIndex: job.workCoordinateIndex,
    operationLabel: job.operationLabel ?? job.operationKind,
    toolNumber: job.toolSlot,
    ...extractPostProcessingOpts(job.operationParams)
  })
  const gcode = postResult.gcode
  await writeFile(job.outputGcodePath, gcode, 'utf-8')

  const base2dHint =
    '2D path posted from operation geometry params (`contourPoints` / `drillPoints`). G-code is unverified until post/machine checks (docs/MACHINES.md).'
  return {
    ok: true,
    gcode,
    usedEngine: 'builtin',
    engine: {
      requestedEngine: 'builtin',
      usedEngine: 'builtin',
      fallbackApplied: false
    },
    ...(postResult.warnings.length ? { warnings: postResult.warnings } : {}),
    hint:
      [base2dHint, ...pocketResultHints, ...drillResultHints].filter(Boolean).join(' ') +
      postedGcodeEnvelopeHint(job.machine, gcode) +
      guardHint
  }
}
