import { spawnBounded, spawnBoundedWithLineCallback } from './subprocess-bounded'
import { parseCamProgressLine, type CamProgressEvent } from '../shared/cam-progress'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { MachineProfile } from '../shared/machine-schema'
import {
  buildPriorRoughFloorSamplerFromGcode,
  computeNegativeZDepthPasses,
  generateChamfer2dLines,
  generateContour2dLines,
  generateDrill2dLines,
  generateMeshHeightRasterLines,
  generateOrthoBoundsRasterLines,
  generatePocket2dLines,
  generateParallelFinishLines
} from './cam-local'
import { adjustFeedForEngagement, computeEngagementAngleDeg, resolvePencilStepoverMm } from '../shared/cam-cut-params'
import { parse4AxisParams } from '../shared/cam-4axis-params'
import {
  rotaryMachinableXSpanMm,
  rotaryMeshStockAlignmentHint,
  rasterRestGapFromStockAndMeshMinZ,
  suggestedZPassMmFromStockAndMeshMinZ
} from '../shared/cam-setup-defaults'
import {
  formatMachineEnvelopeHintForPostedGcode,
  formatRotaryRadialHintForPostedGcode
} from '../shared/cam-machine-envelope'
import { check4AxisAngularVelocity, check4AxisTravelLimits, formatAngularVelocityHint, formatTravelLimitHint } from '../shared/cam-4axis-feed-check'
import { resolve3dFinishStepoverMm } from '../shared/cam-scallop-stepover'
import { getEnginesRoot } from './paths'
import { applyCamToolpathGuardrails, clampFeedAndPlungeToMachineMax, formatRapidBelowStockHintForPostedGcode, warnBallEndMillZPass, warnDocExceedsFluteLength } from './cam-toolpath-guardrails'
import { renderPost, type SubroutineDialect, type LineNumberingConfig } from './post-process'
import {
  collectAsciiStlTriangles,
  collectBinaryStlTriangles,
  isBinaryStlLayout,
  isLikelyAsciiStl,
  parseBinaryStl
} from './stl'
import { dispatch2dStrategy } from './cam-runner-2d'
import {
  generateCylindricalMeshRasterLines,
  generateContourWrappingLines,
  generateIndexedPassLines,
  generatePatternParallelLines,
  surfaceStepoverDegFromMm
} from './cam-axis4-cylindrical-raster'

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

  // Arc fitting
  if (params['enableArcFitting'] === true) {
    opts.enableArcFitting = true
    if (typeof params['arcTolerance'] === 'number' && params['arcTolerance'] > 0) {
      opts.arcTolerance = params['arcTolerance']
    }
  }

  // Cutter compensation
  const cc = params['cutterCompensation']
  if (cc === 'left' || cc === 'right') {
    opts.cutterCompensation = cc
    if (typeof params['cutterCompDRegister'] === 'number' && params['cutterCompDRegister'] >= 1) {
      opts.cutterCompDRegister = params['cutterCompDRegister']
    }
  }

  // Subroutines
  if (params['enableSubroutines'] === true) {
    opts.enableSubroutines = true
    const dialect = params['subroutineDialect']
    if (dialect === 'fanuc' || dialect === 'siemens' || dialect === 'mach3') {
      opts.subroutineDialect = dialect
    } else {
      opts.subroutineDialect = 'fanuc'
    }
  }

  // Line numbering
  if (params['lineNumberingEnabled'] === true) {
    const start = typeof params['lineNumberingStart'] === 'number' ? params['lineNumberingStart'] : 10
    const increment = typeof params['lineNumberingIncrement'] === 'number' ? params['lineNumberingIncrement'] : 10
    opts.lineNumbering = { enabled: true, start, increment }
  }

  // Inverse-time feed
  if (params['inverseTimeFeed'] === true) {
    opts.inverseTimeFeed = true
  }

  return opts
}

function createCamDebugPhaseLogger(): (label: string) => void {
  const on = process.env.DEBUG_CAM === '1' || process.env.DEBUG_CAM === 'true'
  if (!on) return () => {}
  const t0 = Date.now()
  let last = t0
  return (label: string) => {
    const now = Date.now()
    console.error(`[DEBUG_CAM] ${label}: +${now - last}ms (total ${now - t0}ms)`)
    last = now
  }
}

export type CamJobConfig = {
  stlPath: string
  outputGcodePath: string
  machine: MachineProfile
  resourcesRoot: string
  appRoot: string
  zPassMm: number
  stepoverMm: number
  feedMmMin: number
  plungeMmMin: number
  safeZMm: number
  pythonPath: string
  /** manufacture.json operation kind — drives optional OpenCAMLib strategy */
  operationKind?: string
  /** Optional human-readable operation label for G-code file header comment (e.g. "Rough Pass 1 — 8mm flat"). */
  operationLabel?: string
  /** Optional: emit G54–G59 after safety blocks in the post (from manufacture setup). */
  workCoordinateIndex?: number
  /** End mill diameter (mm) for OCL cutter; defaults to 6 */
  toolDiameterMm?: number
  /** Optional operation params from manufacture.json for 2D ops. */
  operationParams?: Record<string, unknown>
  /** Shop rotary job: stock length (mm), chuck depth, clamp buffer — used by the 4-axis TS engine. */
  rotaryStockLengthMm?: number
  /** Shop rotary job: stock diameter (mm), same as job stock Y — used when set instead of operation params. */
  rotaryStockDiameterMm?: number
  rotaryChuckDepthMm?: number
  rotaryClampOffsetMm?: number
  /** Manufacture/Shop setup: stock height (mm) for auto raster rest below mesh (WCS Z0 = stock top). */
  stockBoxZMm?: number
  /** Optional full box for future XY voxel/sim (mm). */
  stockBoxXMm?: number
  stockBoxYMm?: number
  /**
   * Optional prior posted G-code (same WCS as current job). When `operationParams.usePriorPostedGcodeRest === true`,
   * built-in mesh raster uses a coarse min-Z floor from feed moves to skip pencil/rest cleanup where roughing already passed the surface.
   */
  priorPostedGcode?: string
  /**
   * When false, omit STL X min/max clamp for 4-axis machinable span (avoids empty span if mesh WCS ≠ stock).
   * Operation param `useMeshMachinableXClamp: false` also disables.
   */
  useMeshMachinableXClamp?: boolean
  /**
   * ATC tool slot number (1–6). Passed through to the post-processor as `toolNumber`
   * so templates emit the correct M6 T<n> and G43 H<n> commands.
   */
  toolSlot?: number
  /**
   * Optional AbortSignal. When aborted, any running Python subprocess is killed immediately
   * and the CAM run resolves as cancelled. Set by the IPC layer when the user cancels.
   */
  signal?: AbortSignal
  /**
   * Optional progress callback. Called when the Python engine emits structured
   * progress JSON lines to stdout (prefixed with `PROGRESS:`). The IPC layer
   * forwards these to the renderer via `webContents.send('cam:progress', event)`.
   */
  onProgress?: (event: CamProgressEvent) => void
}

export type CamRunResult =
  | {
      ok: true
      gcode: string
      usedEngine: 'advanced' | 'ocl' | 'builtin'
      engine: CamEngineOutcome
      hint?: string
      warnings?: string[]
    }
  | { ok: false; error: string; hint?: string }

export type CamFallbackReason =
  | 'invalid_numeric_params'
  | 'stl_missing'
  | 'config_error'
  | 'stl_read_error'
  | 'opencamlib_not_installed'
  | 'ocl_runtime_or_empty'
  | 'python_spawn_failed'
  | 'advanced_engine_failed'
  | 'unknown_ocl_failure'

export type CamEngineOutcome = {
  requestedEngine: 'advanced' | 'ocl' | 'builtin'
  usedEngine: 'advanced' | 'ocl' | 'builtin'
  fallbackApplied: boolean
  fallbackReason?: CamFallbackReason
  fallbackDetail?: string
}

export type ReadStlBufferForCamResult =
  | { ok: true; buf: Buffer }
  | { ok: false; error: string; hint?: string }

/**
 * Load STL for mesh-based CAM. Validates binary layout; rejects missing, empty,
 * ASCII, and corrupt files before OpenCAMLib / built-in mesh paths run.
 */
export async function readStlBufferForCam(stlPath: string): Promise<ReadStlBufferForCamResult> {
  let buf: Buffer
  try {
    buf = await readFile(stlPath)
  } catch (e) {
    const code = e && typeof e === 'object' && 'code' in e && typeof e.code === 'string' ? e.code : undefined
    if (code === 'ENOENT') {
      return {
        ok: false,
        error: 'CAM input mesh file was not found.',
        hint: `Expected a binary STL at the staged path. Use Make → Generate CAM to pick a file, or ensure the path exists. (${stlPath})`
      }
    }
    return {
      ok: false,
      error: 'Could not read the CAM input mesh file.',
      hint: e instanceof Error ? e.message : String(e)
    }
  }
  if (buf.length === 0) {
    return {
      ok: false,
      error: 'CAM input mesh file is empty.',
      hint: 'Re-export a binary STL from your CAD tool and try again.'
    }
  }
  if (isLikelyAsciiStl(buf) && !isBinaryStlLayout(buf)) {
    return {
      ok: false,
      error: 'ASCII STL is not supported for CAM.',
      hint: 'Convert or re-export as binary STL (this pipeline parses the binary layout only).'
    }
  }
  try {
    parseBinaryStl(buf)
  } catch (err) {
    return {
      ok: false,
      error: 'STL could not be parsed as a binary mesh.',
      hint: err instanceof Error ? err.message : 'File may be truncated or mislabeled.'
    }
  }
  return { ok: true, buf }
}

/** OpenCAMLib strategy string passed to `engines/cam/ocl_toolpath.py`. */
export function manufactureKindUsesOclStrategy(kind: string | undefined): 'waterline' | 'adaptive_waterline' | 'raster' | null {
  if (kind === 'cnc_waterline') return 'waterline'
  if (kind === 'cnc_adaptive' || kind === 'cnc_3d_rough') return 'adaptive_waterline'
  if (kind === 'cnc_raster' || kind === 'cnc_pencil' || kind === 'cnc_3d_finish') return 'raster'
  return null
}

/** Waterline / adaptive OpenCAMLib strategies only (excludes raster). */
export function manufactureKindUsesOclWaterline(
  kind: string | undefined
): 'waterline' | 'adaptive_waterline' | null {
  const s = manufactureKindUsesOclStrategy(kind)
  if (s === 'waterline' || s === 'adaptive_waterline') return s
  return null
}

type OclToolpathFile = {
  ok?: boolean
  toolpathLines?: string[]
  strategy?: string
}

/**
 * Type guard for the JSON payload written by ocl_toolpath.py.
 * Replaces unsafe `JSON.parse(raw) as OclToolpathFile` casts with a runtime check.
 */
export function isOclToolpathFile(v: unknown): v is OclToolpathFile {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const o = v as Record<string, unknown>
  if ('ok' in o && typeof o['ok'] !== 'boolean') return false
  if ('toolpathLines' in o && !Array.isArray(o['toolpathLines'])) return false
  if ('strategy' in o && typeof o['strategy'] !== 'string') return false
  return true
}

/** Safely extract a number property from a Record<string, unknown>, with fallback. */
function numParam(p: Record<string, unknown>, key: string, fallback: number): number {
  const v = p[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/** Safely extract a string property from a Record<string, unknown>, with fallback. */
function strParam(p: Record<string, unknown>, key: string, fallback: string): string {
  const v = p[key]
  return typeof v === 'string' ? v : fallback
}

function rasterRestStockMmFromParams(p: Record<string, unknown> | undefined): number | undefined {
  if (!p) return undefined
  const v = p['rasterRestStockMm']
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v
  return undefined
}

/**
 * Apply chip-thinning feed compensation for TS-side raster/parallel generators.
 *
 * When stepover < tool radius (light radial engagement), the chip thins and
 * the cutter can safely move faster. Delegates to `adjustFeedForEngagement`
 * with a 90° target engagement (standard industry reference for feed tables).
 * Returns the base feed unchanged when tool diameter is unknown or zero.
 */
function chipThinningAdjustedFeedMmMin(feedMmMin: number, stepoverMm: number, toolDiameterMm: number | undefined): number {
  const toolR = (toolDiameterMm ?? 0) / 2
  if (!(toolR > 0)) return feedMmMin
  const engDeg = computeEngagementAngleDeg(toolR, stepoverMm)
  return adjustFeedForEngagement(feedMmMin, engDeg)
}

function meshAnalyticPriorRoughStockMmFromParams(p: Record<string, unknown> | undefined): number | undefined {
  if (!p) return undefined
  const v = p['meshAnalyticPriorRoughStockMm']
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v
  return undefined
}

function priorRoughFloorSamplerForMeshRaster(
  job: CamJobConfig,
  bounds: { min: [number, number, number]; max: [number, number, number] }
): ReturnType<typeof buildPriorRoughFloorSamplerFromGcode> | undefined {
  const p = job.operationParams
  if (p?.['usePriorPostedGcodeRest'] !== true) return undefined
  const g = job.priorPostedGcode?.trim()
  if (!g) return undefined
  const rawRoughDia = p['priorRoughToolDiameterMm']
  const roughDia =
    typeof rawRoughDia === 'number' && Number.isFinite(rawRoughDia) && rawRoughDia > 0
      ? rawRoughDia
      : job.toolDiameterMm ?? 6
  const toolRadiusMm = roughDia * 0.5
  return buildPriorRoughFloorSamplerFromGcode({
    gcode: g,
    minX: bounds.min[0],
    maxX: bounds.max[0],
    minY: bounds.min[1],
    maxY: bounds.max[1],
    toolRadiusMm
  }) ?? undefined
}

function effectiveRasterRestStockMm(job: CamJobConfig, meshMinZMm: number): number | undefined {
  const p = job.operationParams
  const explicit = rasterRestStockMmFromParams(p)
  if (explicit != null) return explicit
  if (p?.['autoRasterRestFromSetup'] === false) return undefined
  const sz = job.stockBoxZMm
  if (sz == null || !(sz > 0)) return undefined
  return rasterRestGapFromStockAndMeshMinZ(sz, meshMinZMm)
}

function postedGcodeEnvelopeHint(machine: MachineProfile, gcode: string, rotaryStockDiameterMm?: number, stockTopZ?: number): string {
  if (machine.kind !== 'cnc') return ''
  let h = formatMachineEnvelopeHintForPostedGcode(gcode, machine.workAreaMm)
  const ac = machine.axisCount ?? 3
  if (ac >= 4 && rotaryStockDiameterMm != null && rotaryStockDiameterMm > 0) {
    h += formatRotaryRadialHintForPostedGcode(gcode, rotaryStockDiameterMm)
  }
  h += formatRapidBelowStockHintForPostedGcode(gcode, stockTopZ ?? 0)
  return h
}

function rotaryTravelHintForPostedGcode(operationKind: string | undefined, gcode: string): string {
  if (!operationKind?.includes('4axis')) return ''
  const re = /\bA\s*(-?\d+(?:\.\d+)?)/gi
  let m: RegExpExecArray | null
  let maxAbs = 0
  while ((m = re.exec(gcode)) != null) {
    const v = Math.abs(Number.parseFloat(m[1]!))
    if (v > maxAbs) maxAbs = v
  }
  if (maxAbs < 1e-6) return ''
  if (maxAbs > 720) {
    return ` Large A-axis travel (~${maxAbs.toFixed(0)}° in program); confirm post/controller wrap and soft limits (docs/MACHINES.md).`
  }
  return ''
}

export function resolveDrillCycleMode(input: {
  dialect: MachineProfile['dialect']
  operationParams?: Record<string, unknown>
}): 'g73' | 'g81' | 'g82' | 'g83' | 'expanded' {
  return resolveDrillCycleDecision(input).mode
}

export function resolveDrillCycleDecision(input: {
  dialect: MachineProfile['dialect']
  operationParams?: Record<string, unknown>
}): { mode: 'g73' | 'g81' | 'g82' | 'g83' | 'expanded'; hint?: string } {
  const p = input.operationParams ?? {}
  const raw = p['drillCycle']
  const peckMm = typeof p['peckMm'] === 'number' && Number.isFinite(p['peckMm']) ? p['peckMm'] : undefined
  const dwellMs = typeof p['dwellMs'] === 'number' && Number.isFinite(p['dwellMs']) ? p['dwellMs'] : undefined
  if (raw === 'expanded' || raw === 'g73' || raw === 'g81' || raw === 'g82' || raw === 'g83') {
    if (raw === 'g73' && !(peckMm != null && peckMm > 0)) {
      return {
        mode: 'g81',
        hint: 'Drill cycle: requested G73 but peckMm is missing/invalid; falling back to G81.'
      }
    }
    if (raw === 'g83' && !(peckMm != null && peckMm > 0)) {
      return {
        mode: 'g81',
        hint: 'Drill cycle: requested G83 but peckMm is missing/invalid; falling back to G81.'
      }
    }
    if (raw === 'g82' && !(dwellMs != null && dwellMs > 0)) {
      return {
        mode: 'g81',
        hint: 'Drill cycle: requested G82 but dwellMs is missing/invalid; falling back to G81.'
      }
    }
    return { mode: raw, hint: `Drill cycle: using explicit override (${raw.toUpperCase()}).` }
  }
  if (input.dialect === 'grbl') {
    return {
      mode: 'expanded',
      hint: 'Drill cycle: grbl defaulted to expanded (G0/G1) unless you explicitly choose a canned cycle.'
    }
  }
  if (peckMm != null && peckMm > 0) {
    return { mode: 'g83', hint: `Drill cycle: auto-selected G83 from peckMm (${peckMm}).` }
  }
  if (dwellMs != null && dwellMs > 0) {
    return { mode: 'g82', hint: `Drill cycle: auto-selected G82 from dwellMs (${dwellMs}).` }
  }
  return { mode: 'g81', hint: 'Drill cycle: defaulted to G81.' }
}

/** Extra operator-facing lines merged into successful `cnc_drill` `hint` (depth / retract clarity). */
export function drillOperationHints(
  operationParams: Record<string, unknown> | undefined,
  job: { zPassMm: number; safeZMm: number }
): string[] {
  const p = operationParams ?? {}
  const hints: string[] = []
  const retractMm = typeof p['retractMm'] === 'number' && Number.isFinite(p['retractMm']) ? p['retractMm'] : undefined
  if (retractMm == null) {
    hints.push(
      `Drill: retract plane R uses safeZMm (${job.safeZMm.toFixed(1)} mm) because retractMm is unset — set retractMm for a different chip-clear height between holes.`
    )
  }
  hints.push(
    `Drill depth Z uses zPassMm (${job.zPassMm.toFixed(3)} mm) as hole bottom in the posted cycle; confirm sign vs fixture/WCS (docs/MACHINES.md).`
  )
  return hints
}

function rawPointArrayLength(v: unknown): number {
  return Array.isArray(v) ? v.length : 0
}

/**
 * Validates 2D op geometry before generating toolpaths. Returns user-facing
 * `error` + optional `hint` (also sent over `cam:run` on failure).
 */
export function validate2dOperationGeometry(
  operationKind: string | undefined,
  operationParams?: Record<string, unknown>
): { ok: true } | { ok: false; error: string; hint?: string } {
  const p = operationParams ?? {}
  if (
    operationKind === 'cnc_contour' ||
    operationKind === 'cnc_pocket' ||
    operationKind === 'cnc_chamfer' ||
    operationKind === 'cnc_pcb_isolation' ||
    operationKind === 'cnc_pcb_contour'
  ) {
    const rawKey = 'contourPoints'
    const rawCount = rawPointArrayLength(p[rawKey])
    const contour = point2dList(p[rawKey])
    if (contour.length >= 3) return { ok: true }
    if (rawCount === 0) {
      return {
        ok: false,
        error: 'Contour geometry missing.',
        hint: `Add ${rawKey}: at least three numeric [x,y] pairs in mm (Manufacture tab: derive from sketch or paste JSON). There is no STL fallback for this operation.`
      }
    }
    return {
      ok: false,
      error: 'Contour geometry invalid or incomplete.',
      hint:
        rawCount > contour.length
          ? `Some ${rawKey} entries were not valid [x,y] numbers; at least three usable points are required.`
          : `Need at least three valid points for contour/pocket geometry (self-intersecting or degenerate loops may also fail later).`
    }
  }
  if (operationKind === 'cnc_pcb_drill' || operationKind === 'cnc_drill') {
    const rawKey = 'drillPoints'
    const rawCount = rawPointArrayLength(p[rawKey])
    const drill = point2dList(p[rawKey])
    if (drill.length >= 1) return { ok: true }
    if (rawCount === 0) {
      return {
        ok: false,
        error: 'Drill geometry missing.',
        hint: `Add ${rawKey}: at least one numeric [x,y] pair in mm (derive from sketch circles or paste JSON). There is no STL fallback for this operation.`
      }
    }
    return {
      ok: false,
      error: 'Drill geometry invalid.',
      hint: `No valid [x,y] drill positions could be read from ${rawKey}; check that every entry is a pair of finite numbers.`
    }
  }
  return { ok: true }
}

export function resolveContourPathOptions(operationParams?: Record<string, unknown>): {
  contourSide: 'climb' | 'conventional'
  leadInMm: number
  leadOutMm: number
  leadInMode: 'linear' | 'arc'
  leadOutMode: 'linear' | 'arc'
} {
  const p = operationParams ?? {}
  const contourSide = p['contourSide'] === 'conventional' ? 'conventional' : 'climb'
  const leadInMm = typeof p['leadInMm'] === 'number' && Number.isFinite(p['leadInMm']) ? Math.max(0, p['leadInMm']) : 0
  const leadOutMm =
    typeof p['leadOutMm'] === 'number' && Number.isFinite(p['leadOutMm']) ? Math.max(0, p['leadOutMm']) : 0
  const leadInMode = p['leadInMode'] === 'arc' ? 'arc' as const : 'linear' as const
  const leadOutMode = p['leadOutMode'] === 'arc' ? 'arc' as const : 'linear' as const
  return { contourSide, leadInMm, leadOutMm, leadInMode, leadOutMode }
}

/**
 * Resolve contour ramp entry parameters from raw operation params.
 * Returns `undefined` rampType when no ramp is configured (backward compatible default: plunge).
 */
export function resolveContourRampOptions(operationParams?: Record<string, unknown>): {
  rampType: 'plunge' | 'linear' | 'helix'
  rampAngleDeg: number
} {
  const p = operationParams ?? {}
  const raw = p['rampType']
  const rampType: 'plunge' | 'linear' | 'helix' =
    raw === 'linear' ? 'linear' : raw === 'helix' ? 'helix' : 'plunge'
  const rampAngleDeg =
    typeof p['rampAngleDeg'] === 'number' && Number.isFinite(p['rampAngleDeg'])
      ? Math.min(89, Math.max(0.5, p['rampAngleDeg']))
      : 3
  return { rampType, rampAngleDeg }
}

/**
 * Resolve contour tab (holding bridge) parameters from raw operation params.
 * Returns `undefined` when no tabs are configured.
 */
export function resolveContourTabParams(operationParams?: Record<string, unknown>): import('./cam-local').TabParams | undefined {
  const p = operationParams ?? {}
  const tabsMode = p['tabsMode']
  if (tabsMode !== 'count' && tabsMode !== 'interval') return undefined
  return {
    tabsMode,
    tabCount: typeof p['tabCount'] === 'number' && Number.isFinite(p['tabCount']) ? Math.max(1, Math.round(p['tabCount'])) : 4,
    tabIntervalMm: typeof p['tabIntervalMm'] === 'number' && Number.isFinite(p['tabIntervalMm']) ? Math.max(1, p['tabIntervalMm']) : 50,
    tabWidthMm: typeof p['tabWidthMm'] === 'number' && Number.isFinite(p['tabWidthMm']) ? Math.max(0.5, p['tabWidthMm']) : 3,
    tabHeightMm: typeof p['tabHeightMm'] === 'number' && Number.isFinite(p['tabHeightMm']) ? Math.max(0.1, p['tabHeightMm']) : 1.5
  }
}

export function shouldAppendFinalPocketFinishPass(input: { finishPass: boolean; finishEachDepth: boolean }): boolean {
  return input.finishPass && !input.finishEachDepth
}

const CAM_PYTHON_OUTPUT_MAX_BYTES = 8 * 1024 * 1024

async function runPythonScript(
  scriptRelative: string,
  cfgPath: string,
  pythonPath: string,
  appRoot: string,
  timeoutMs = 60_000,
  signal?: AbortSignal
): Promise<{ code: number | null; stdout: string }> {
  const script = join(getEnginesRoot(), 'cam', scriptRelative)
  try {
    const r = await spawnBounded(pythonPath, [script, cfgPath], {
      cwd: appRoot,
      timeoutMs,
      maxBufferBytes: CAM_PYTHON_OUTPUT_MAX_BYTES,
      signal
    })
    return { code: r.code, stdout: r.stdout + r.stderr }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('timed out')) {
      throw new Error(
        `Python script '${scriptRelative}' timed out after ${timeoutMs / 1000}s. ` +
          `Check that '${pythonPath}' is a valid Python 3 executable (set it in Utilities → Settings → Paths).`
      )
    }
    if (msg.includes('maxBufferBytes')) {
      throw new Error(
        `Python script '${scriptRelative}' produced excessive output; CAM aborted. ` +
          `If this persists, check for debug prints in the engine script.`
      )
    }
    if (msg.includes('ENOENT') || msg.includes('not found') || msg.includes('is not recognized')) {
      throw new Error(
        `Python executable '${pythonPath}' not found. ` +
          `Check that Python is installed and the path is correct in Utilities → Settings → Paths.`
      )
    }
    throw e
  }
}

async function tryOclToolpath(job: CamJobConfig, strategy: string): Promise<{
  ok: boolean
  toolpathLines?: string[]
  stdout: string
  code: number | null
}> {
  const toolpathJsonPath = join(dirname(job.outputGcodePath), '_cam_toolpath.json')
  const cfgPath = join(getEnginesRoot(), 'cam', '_tmp_cam.json')
  await mkdir(dirname(cfgPath), { recursive: true })
  await writeFile(
    cfgPath,
    JSON.stringify({
      stlPath: job.stlPath,
      toolpathJsonPath,
      strategy,
      zPassMm: job.zPassMm,
      stepoverMm: job.stepoverMm,
      feedMmMin: job.feedMmMin,
      plungeMmMin: job.plungeMmMin,
      safeZMm: job.safeZMm,
      toolDiameterMm: job.toolDiameterMm ?? 6
    }),
    'utf-8'
  )

  let code: number | null = 1
  let stdout = ''
  try {
    const r = await runPythonScript('ocl_toolpath.py', cfgPath, job.pythonPath, job.appRoot, 60_000, job.signal)
    code = r.code
    stdout = r.stdout
  } catch {
    code = 1
    stdout = 'python_spawn_failed'
  }

  if (code !== 0) {
    return { ok: false, stdout, code }
  }

  try {
    const raw = await readFile(toolpathJsonPath, 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    if (isOclToolpathFile(parsed)) {
      const lines = parsed.toolpathLines
      if (parsed.ok && Array.isArray(lines) && lines.length > 0) {
        await unlink(toolpathJsonPath).catch(() => {})
        return { ok: true, toolpathLines: lines, stdout, code }
      }
    }
  } catch {
    /* fall through */
  }

  return { ok: false, stdout, code }
}

// ── Advanced toolpath engine ─────────────────────────────────────────────────

/**
 * Maps manufacture operation kind to an advanced engine strategy string.
 * Returns null for operation kinds not supported by the advanced engine
 * (2D ops, 4-axis ops which have their own dedicated pipelines).
 */
export function manufactureKindUsesAdvancedStrategy(
  kind: string | undefined
): 'adaptive_clear' | 'waterline' | 'raster' | 'pencil' | null {
  if (kind === 'cnc_adaptive' || kind === 'cnc_3d_rough') return 'adaptive_clear'
  if (kind === 'cnc_waterline') return 'waterline'
  if (kind === 'cnc_raster' || kind === 'cnc_3d_finish') return 'raster'
  if (kind === 'cnc_pencil') return 'pencil'
  // cnc_parallel stays on the built-in parallel finish (no Python needed)
  return null
}

/**
 * Maps manufacture.json operation kinds to the v4.0 toolpath_engine strategies.
 * Returns the Python strategy string or null if this kind doesn't use the toolpath engine.
 */
export function manufactureKindUsesToolpathEngine(
  kind: string | undefined
): string | null {
  const map: Record<string, string> = {
    // New 3-axis strategies (toolpath_engine only)
    cnc_spiral_finish: 'spiral_finish',
    cnc_morphing_finish: 'morphing_finish',
    cnc_trochoidal_hsm: 'trochoidal_hsm',
    cnc_steep_shallow: 'steep_shallow',
    cnc_scallop_finish: 'scallop',
    // 4-axis continuous (toolpath_engine only)
    cnc_4axis_continuous: '4axis_continuous',
    // 5-axis (toolpath_engine only)
    cnc_5axis_contour: '5axis_contour',
    cnc_5axis_swarf: '5axis_swarf',
    cnc_5axis_flowline: '5axis_flowline',
    // Auto-select (geometry analysis + strategy)
    cnc_auto_select: 'auto',
    // Existing strategies can also route through toolpath_engine as fallback
    cnc_adaptive: 'adaptive_clear',
    cnc_3d_rough: 'adaptive_clear',
    cnc_waterline: 'waterline',
    cnc_raster: 'raster',
    cnc_pencil: 'pencil',
  }
  return kind ? (map[kind] ?? null) : null
}

async function tryAdvancedToolpath(
  job: CamJobConfig,
  strategy: string,
  bounds: { min: [number, number, number]; max: [number, number, number] }
): Promise<{
  ok: boolean
  toolpathLines?: string[]
  stdout: string
  code: number | null
}> {
  const toolpathJsonPath = join(dirname(job.outputGcodePath), '_cam_advanced_toolpath.json')
  const cfgPath = join(getEnginesRoot(), 'cam', '_tmp_advanced_cam.json')
  await mkdir(dirname(cfgPath), { recursive: true })

  const stockZMin = job.stockBoxZMm != null ? -(job.stockBoxZMm) : bounds.min[2]
  const stockZMax = 0 // WCS Z0 = stock top convention
  const advParams = job.operationParams ?? {}

  await writeFile(
    cfgPath,
    JSON.stringify({
      stlPath: job.stlPath,
      toolpathJsonPath,
      strategy,
      toolDiameterMm: job.toolDiameterMm ?? 6,
      feedMmMin: job.feedMmMin,
      plungeMmMin: job.plungeMmMin,
      stepoverMm: job.stepoverMm,
      zStepMm: Math.abs(job.zPassMm),
      safeZMm: job.safeZMm,
      // Stock bounds from mesh + stock box
      stockXMin: bounds.min[0] - 2,
      stockXMax: bounds.max[0] + 2,
      stockYMin: bounds.min[1] - 2,
      stockYMax: bounds.max[1] + 2,
      stockZMin,
      stockZMax,
      // Machine limits
      xTravelMm: job.machine.workAreaMm?.x ?? 300,
      yTravelMm: job.machine.workAreaMm?.y ?? 200,
      zTravelMm: job.machine.workAreaMm?.z ?? 100,
      maxFeedMmMin: job.machine.maxFeedMmMin ?? 5000,
      maxSpindleRpm: 24000,
      // Raster-specific — scanAngleDeg takes precedence over rasterAngleDeg
      rasterAngleDeg: numParam(advParams, 'rasterAngleDeg', 0),
      ...(advParams?.['scanAngleDeg'] != null ? { scanAngleDeg: numParam(advParams, 'scanAngleDeg', 0) } : {})
    }),
    'utf-8'
  )

  let code: number | null = 1
  let stdout = ''
  try {
    // Use the advanced engine package: python -m engines.cam.advanced <config.json>
    // We pass the module path to runPythonScript which joins with engines/cam/
    const script = join(getEnginesRoot(), 'cam', 'advanced')
    const r = await spawnBounded(job.pythonPath, ['-m', 'engines.cam.advanced', cfgPath], {
      cwd: job.appRoot,
      timeoutMs: 60_000,
      maxBufferBytes: CAM_PYTHON_OUTPUT_MAX_BYTES,
      signal: job.signal
    })
    code = r.code
    stdout = r.stdout + r.stderr
  } catch (e) {
    code = 1
    stdout = `advanced_engine_spawn_failed: ${e instanceof Error ? e.message : String(e)}`
  }

  if (code !== 0) {
    return { ok: false, stdout, code }
  }

  try {
    const raw = await readFile(toolpathJsonPath, 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    if (isOclToolpathFile(parsed)) {
      const lines = parsed.toolpathLines
      if (parsed.ok && Array.isArray(lines) && lines.length > 0) {
        await unlink(toolpathJsonPath).catch(() => {})
        return { ok: true, toolpathLines: lines, stdout, code }
      }
    }
  } catch {
    /* fall through */
  }

  return { ok: false, stdout, code }
}

/**
 * Try the v4.0 toolpath_engine (14 strategies, drop-cutter, linking optimizer).
 * Invoked via `python -m engines.cam.toolpath_engine <config.json>`.
 */
async function tryToolpathEngine(
  job: CamJobConfig,
  strategy: string,
  bounds: { min: [number, number, number]; max: [number, number, number] }
): Promise<{
  ok: boolean
  toolpathLines?: string[]
  stdout: string
  code: number | null
  warnings?: string[]
}> {
  const toolpathJsonPath = join(dirname(job.outputGcodePath), '_cam_toolpath_engine.json')
  const cfgPath = join(getEnginesRoot(), 'cam', '_tmp_cam.json')
  await mkdir(dirname(cfgPath), { recursive: true })

  const stockZMin = job.stockBoxZMm != null ? -(job.stockBoxZMm) : bounds.min[2]
  const stockZMax = 0 // WCS Z0 = stock top convention
  const params = job.operationParams ?? {}

  // Build config matching toolpath_engine/models.py job_from_config() expectations
  const config: Record<string, unknown> = {
    stlPath: job.stlPath,
    toolpathJsonPath,
    strategy,
    // Tool
    toolDiameterMm: job.toolDiameterMm ?? 6,
    toolShape: strParam(params, 'toolShape', 'flat'),
    cornerRadiusMm: numParam(params, 'cornerRadiusMm', 0),
    fluteLengthMm: numParam(params, 'fluteLengthMm', 25),
    fluteCount: numParam(params, 'fluteCount', 2),
    holderDiameterMm: numParam(params, 'holderDiameterMm', 0),
    // Cut params
    feedMmMin: job.feedMmMin,
    plungeMmMin: job.plungeMmMin,
    stepoverMm: job.stepoverMm,
    zStepMm: Math.abs(job.zPassMm),
    safeZMm: job.safeZMm,
    rampAngleDeg: numParam(params, 'rampAngleDeg', 3),
    spindleRpm: numParam(params, 'spindleRpm', 10000),
    climbMilling: params.climbMilling !== false,
    // Stock bounds
    stockXMin: bounds.min[0] - 2,
    stockXMax: bounds.max[0] + 2,
    stockYMin: bounds.min[1] - 2,
    stockYMax: bounds.max[1] + 2,
    stockZMin,
    stockZMax,
    // Machine limits
    xTravelMm: job.machine.workAreaMm?.x ?? 300,
    yTravelMm: job.machine.workAreaMm?.y ?? 200,
    zTravelMm: job.machine.workAreaMm?.z ?? 100,
    maxFeedMmMin: job.machine.maxFeedMmMin ?? 5000,
    maxRapidMmMin: numParam(params, 'maxRapidMmMin', 10000),
    maxSpindleRpm: numParam(params, 'maxSpindleRpm', 24000),
    // Machine capabilities
    has4thAxis: (job.machine.axisCount ?? 3) >= 4,
    has5thAxis: (job.machine.axisCount ?? 3) >= 5,
    // Tolerances
    toleranceMm: numParam(params, 'toleranceMm', 0.01),
    surfaceFinishRaUm: numParam(params, 'surfaceFinishRaUm', 3.2),
    maxEngagementDeg: numParam(params, 'maxEngagementDeg', 90),
    // Post dialect
    postDialect: job.machine.dialect ?? 'generic_mm',
    // Raster-specific — scanAngleDeg takes precedence over rasterAngleDeg
    rasterAngleDeg: numParam(params, 'rasterAngleDeg', 0),
    ...(params?.['scanAngleDeg'] != null ? { scanAngleDeg: numParam(params, 'scanAngleDeg', 0) } : {}),
    // 4-axis params
    cylinderDiameterMm: numParam(params, 'cylinderDiameterMm', job.rotaryStockDiameterMm ?? 50),
    // Material
    materialName: strParam(params, 'materialName', 'aluminum_6061'),
    // Adaptive feed
    ...(params?.['adaptiveFeedEnabled'] != null ? { adaptiveFeedEnabled: !!params['adaptiveFeedEnabled'] } : {}),
  }

  await writeFile(cfgPath, JSON.stringify(config), 'utf-8')

  let code: number | null = 1
  let stdout = ''
  try {
    const r = await spawnBounded(job.pythonPath, ['-m', 'engines.cam.toolpath_engine', cfgPath], {
      cwd: job.appRoot,
      timeoutMs: 120_000, // v4.0 engine may take longer for complex strategies
      maxBufferBytes: CAM_PYTHON_OUTPUT_MAX_BYTES,
      signal: job.signal
    })
    code = r.code
    stdout = r.stdout + r.stderr
  } catch (e) {
    code = 1
    stdout = `toolpath_engine_spawn_failed: ${e instanceof Error ? e.message : String(e)}`
  }

  if (code !== 0) {
    return { ok: false, stdout, code }
  }

  try {
    const raw = await readFile(toolpathJsonPath, 'utf-8')
    const parsed = JSON.parse(raw) as {
      ok?: boolean
      toolpathLines?: string[]
      strategy?: string
      warnings?: string[]
      stats?: Record<string, unknown>
    }
    const lines = parsed.toolpathLines
    if (parsed.ok && Array.isArray(lines) && lines.length > 0) {
      await unlink(toolpathJsonPath).catch(() => {})
      return { ok: true, toolpathLines: lines, stdout, code, warnings: parsed.warnings }
    }
  } catch {
    /* fall through */
  }

  return { ok: false, stdout, code }
}

/** Strategy labels for human-readable hints. */
const TOOLPATH_ENGINE_STRATEGY_LABELS: Record<string, string> = {
  adaptive_clear: 'adaptive clearing (constant engagement)',
  waterline: 'waterline (Z-level contour)',
  raster: 'raster (surface-following)',
  pencil: 'pencil trace (concave cleanup)',
  spiral_finish: 'spiral finishing (continuous)',
  morphing_finish: 'morphing finish (steep/shallow blend)',
  trochoidal_hsm: 'trochoidal HSM (constant chip load)',
  steep_shallow: 'steep-and-shallow (region-based)',
  scallop: 'scallop finishing (constant cusp height)',
  '4axis_continuous': '4-axis continuous (simultaneous rotary)',
  '5axis_contour': '5-axis contour (normal-following)',
  '5axis_swarf': '5-axis swarf (flank milling)',
  '5axis_flowline': '5-axis flowline (surface-following)',
  auto: 'auto-selected strategy',
}

/** Maps `ocl_toolpath.py` stdout (JSON error lines) to operator-facing fallback hints. Exported for tests. */
export function builtinOclFailureHint(stdout: string, operationKind: string | undefined): string | undefined {
  const raster = operationKind === 'cnc_raster' || operationKind === 'cnc_pencil'
  const waterline = operationKind === 'cnc_waterline'
  const adaptive = operationKind === 'cnc_adaptive'
  if (stdout.includes('invalid_numeric_params')) {
    return 'CAM job used invalid feed, tool, or stepover values; fix operation parameters and retry OpenCAMLib.'
  }
  if (stdout.includes('stl_missing')) {
    return raster
      ? 'OpenCAMLib config pointed at a missing STL path; using built-in mesh or orthogonal bounds raster.'
      : waterline
        ? 'OpenCAMLib config pointed at a missing STL path; using built-in parallel finish from STL bounds (Waterline intent).'
        : adaptive
          ? 'OpenCAMLib config pointed at a missing STL path; using built-in parallel finish from STL bounds (Adaptive clearing intent).'
          : 'OpenCAMLib config pointed at a missing STL path; using built-in parallel finish from STL bounds.'
  }
  if (
    stdout.includes('config_not_found') ||
    stdout.includes('config_read_error') ||
    stdout.includes('config_not_utf8') ||
    stdout.includes('invalid_config_json') ||
    stdout.includes('invalid_config_shape') ||
    stdout.includes('config_missing_keys')
  ) {
    return waterline
      ? 'OpenCAMLib helper could not read or parse its temp config JSON (internal CAM wiring); using built-in parallel finish (Waterline intent).'
      : adaptive
        ? 'OpenCAMLib helper could not read or parse its temp config JSON (internal CAM wiring); using built-in parallel finish (Adaptive clearing intent).'
        : 'OpenCAMLib helper could not read or parse its temp config JSON (internal CAM wiring); using built-in fallback toolpaths.'
  }
  if (stdout.includes('stl_read_error')) {
    return raster
      ? 'OpenCAMLib could not read the STL (corrupt or unsupported file); using built-in mesh or orthogonal bounds raster.'
      : waterline
        ? 'OpenCAMLib could not read the STL (corrupt or unsupported file); using built-in parallel finish from STL bounds (Waterline intent).'
        : adaptive
          ? 'OpenCAMLib could not read the STL (corrupt or unsupported file); using built-in parallel finish from STL bounds (Adaptive clearing intent).'
          : 'OpenCAMLib could not read the STL (corrupt or unsupported file); using built-in parallel finish from STL bounds.'
  }
  if (stdout.includes('opencamlib_not_installed')) {
    return raster
      ? 'Install Python 3.7–3.11 and pip install opencamlib for OpenCAMLib PathDropCutter raster; using built-in mesh or orthogonal bounds raster.'
      : waterline
        ? 'Install Python 3.7–3.11 and pip install opencamlib for OpenCAMLib Waterline; using built-in parallel finish from STL bounds.'
        : adaptive
          ? 'Install Python 3.7–3.11 and pip install opencamlib for OpenCAMLib AdaptiveWaterline; using built-in parallel finish from STL bounds.'
          : 'Install Python 3.7–3.11 and pip install opencamlib for OpenCAMLib Waterline or AdaptiveWaterline; using built-in parallel finish from STL bounds.'
  }
  if (stdout.includes('ocl_empty_toolpath') || stdout.includes('ocl_runtime_error')) {
    return raster
      ? 'OpenCAMLib raster failed (missing/invalid STL, PathDropCutter error, or empty CL points); using built-in mesh or orthogonal bounds raster.'
      : waterline
        ? 'OpenCAMLib Waterline did not produce a toolpath (missing/invalid STL or OCL error); using built-in parallel finish from STL bounds.'
        : adaptive
          ? 'OpenCAMLib AdaptiveWaterline did not produce a toolpath (missing/invalid STL or OCL error); using built-in parallel finish from STL bounds.'
          : 'OpenCAMLib did not produce a toolpath (missing/invalid STL or OCL error); using built-in parallel finish from STL bounds.'
  }
  if (stdout === 'python_spawn_failed') {
    return raster
      ? 'Could not spawn Python for OpenCAMLib; using built-in mesh or orthogonal bounds raster.'
      : waterline
        ? 'Could not spawn Python for OpenCAMLib; using built-in parallel finish from STL bounds (Waterline intent).'
        : adaptive
          ? 'Could not spawn Python for OpenCAMLib; using built-in parallel finish from STL bounds (Adaptive clearing intent).'
          : 'Could not spawn Python for OpenCAMLib; using built-in parallel finish from STL bounds.'
  }
  return undefined
}

/** Normalized OCL/advanced failure category used by IPC/renderer fallback messaging. */
export function resolveOclFallbackReason(stdout: string): CamFallbackReason | undefined {
  if (stdout.includes('advanced_engine_spawn_failed') || stdout.includes('advanced_engine_failed')) return 'advanced_engine_failed'
  if (stdout.includes('invalid_numeric_params')) return 'invalid_numeric_params'
  if (stdout.includes('stl_missing')) return 'stl_missing'
  if (
    stdout.includes('config_not_found') ||
    stdout.includes('config_read_error') ||
    stdout.includes('config_not_utf8') ||
    stdout.includes('invalid_config_json') ||
    stdout.includes('invalid_config_shape') ||
    stdout.includes('config_missing_keys')
  ) {
    return 'config_error'
  }
  if (stdout.includes('stl_read_error')) return 'stl_read_error'
  if (stdout.includes('opencamlib_not_installed')) return 'opencamlib_not_installed'
  if (stdout.includes('ocl_empty_toolpath') || stdout.includes('ocl_runtime_error')) return 'ocl_runtime_or_empty'
  if (stdout === 'python_spawn_failed') return 'python_spawn_failed'
  return undefined
}

const UNVERIFIED =
  'G-code is unverified until you check post, units, and clearances for your machine (docs/MACHINES.md).'

function toolpathHasXYCutMoves(lines: string[]): boolean {
  return lines.some((l) => /^G1 X-?[\d.]+ Y-?[\d.]+ Z-?[\d.]+ F\d/.test(l))
}

function point2d(v: unknown): [number, number] | null {
  if (!Array.isArray(v) || v.length < 2) return null
  const x = v[0]
  const y = v[1]
  if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) return null
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

/**
 * 4-axis engine uses **negative** `zPassMm` as radial depth into the cylinder
 * (`cutZ = radius + zPass`). Positive values place the tool **outside** the stock (air).
 * Shared CAM resolution can still yield positive `zPassMm` (e.g. cut-param defaults),
 * so we treat positive magnitudes as “depth into stock” and zero as a small default cut.
 */
export function normalizeAxis4RadialZPassMm(zPassMm: number): number {
  if (zPassMm < -1e-9) return zPassMm
  if (zPassMm > 1e-9) return -Math.abs(zPassMm)
  // Near-zero depth: use a minimal safe default rather than an arbitrary -1mm
  // that could produce unexpectedly deep cuts on small-diameter stock.
  return -0.5
}

function iterAxis4ZDepthsMm(zPassMm: number, zStepMm: number): number[] {
  const zp = zPassMm
  const zs = Math.max(0, zStepMm)
  if (zp >= -1e-9) return [zp]
  if (zs <= 1e-6) return [zp]
  const out: number[] = []
  let d = -zs
  while (d > zp + 1e-6) {
    out.push(d)
    d -= zs
  }
  out.push(zp)
  return out
}

function computeAxis4ZDepthsMm(
  zPassMm: number,
  zStepMm: number,
  cylinderRadiusMm: number,
  useMeshRadial: boolean,
  meshRadialMaxMm?: number
): number[] {
  const zp = zPassMm
  const r = Math.max(1e-6, cylinderRadiusMm)
  const mr = meshRadialMaxMm ?? 0
  if (!useMeshRadial || !(mr > 0) || mr >= r - 1e-6) {
    return iterAxis4ZDepthsMm(zp, zStepMm)
  }
  const zShallow = mr - r
  if (zShallow <= zp + 1e-6) return iterAxis4ZDepthsMm(zp, zStepMm)
  const zs = Math.max(0, zStepMm)
  if (zs <= 1e-6) return [zp]
  const out: number[] = []
  let d = zShallow
  while (d > zp + 1e-6) {
    out.push(d)
    d -= zs
  }
  out.push(zp)
  return out
}

/**
 * Whether the operation kind routes to the 4-axis TS engine.
 * These ops require `axisCount >= 4` on the machine profile.
 */
export function manufactureKindUses4AxisEngine(kind: string | undefined): boolean {
  return kind === 'cnc_4axis_roughing' || kind === 'cnc_4axis_finishing' || kind === 'cnc_4axis_contour' || kind === 'cnc_4axis_indexed' || kind === 'cnc_4axis_continuous'
}

/**
 * CAM pipeline: for `cnc_waterline` / `cnc_adaptive` / `cnc_raster` / `cnc_pencil`, try OpenCAMLib → toolpath lines → post.
 * `cnc_pencil` uses the **raster** OCL strategy with a tighter stepover (`resolvePencilStepoverMm`).
 * `cnc_4axis_roughing` / `cnc_4axis_finishing` use TS cylindrical heightmap engine (pattern-parallel TS fallback).
 * `cnc_4axis_contour` / `cnc_4axis_indexed` use dedicated TS contour-wrapping / indexed-pass generators.
 * Fallbacks: parallel finish (waterline/adaptive) or mesh / ortho raster (raster + pencil); other kinds use parallel finish.
 */
export async function runCamPipeline(initialJob: CamJobConfig): Promise<CamRunResult> {
  const dbg = createCamDebugPhaseLogger()
  dbg('runCamPipeline:start')
  await mkdir(dirname(initialJob.outputGcodePath), { recursive: true })
  const gr = applyCamToolpathGuardrails(initialJob)
  const machMax = initialJob.machine.maxFeedMmMin
  const machCap = clampFeedAndPlungeToMachineMax(gr.job.feedMmMin, gr.job.plungeMmMin, machMax)
  let job = { ...gr.job, feedMmMin: machCap.feedMmMin, plungeMmMin: machCap.plungeMmMin }
  // Advisory warnings: ball-end-mill DOC and flute-length DOC — emitted only when conditions are met.
  const advisoryNotes: string[] = []
  const opParams = initialJob.operationParams
  if (typeof opParams?.['toolShape'] === 'string' && opParams['toolShape'] === 'ball') {
    const ballWarn = warnBallEndMillZPass(initialJob.zPassMm, initialJob.toolDiameterMm ?? 0)
    if (ballWarn) advisoryNotes.push(ballWarn)
  }
  const rawFlute = opParams?.['fluteLengthMm']
  const fluteLengthMm = typeof rawFlute === 'number' ? rawFlute : undefined
  if (fluteLengthMm != null) {
    const fluteWarn = warnDocExceedsFluteLength(initialJob.zPassMm, fluteLengthMm)
    if (fluteWarn) advisoryNotes.push(fluteWarn)
  }
  const allGuardrailNotes = [...gr.notes, ...machCap.notes, ...advisoryNotes]
  const guardHint = allGuardrailNotes.length
    ? ` Applied guardrails: ${allGuardrailNotes.join('; ')}.`
    : ''

  // ── 4-axis operations ──────────────────────────────────────────────────────
  if (manufactureKindUses4AxisEngine(job.operationKind)) {
    const p = job.operationParams ?? {}
    const ax4 = parse4AxisParams(p)
    const axis4Strategy = job.operationKind === 'cnc_4axis_indexed' ? '4axis_indexed'
      : job.operationKind === 'cnc_4axis_contour' ? '4axis_wrapping'
      : '4axis_wrapping' // roughing & finishing both use wrapping strategy
    const isFinishing = job.operationKind === 'cnc_4axis_finishing'
    const isContour = job.operationKind === 'cnc_4axis_contour'

    let contourClosureHint = ''
    if (isContour) {
      const cpts = ax4.contourPoints ?? []
      if (cpts.length < 2) {
        return {
          ok: false,
          error: '4-axis contour wrapping requires contourPoints (at least two [x, y] points in mm).',
          hint: 'Add contourPoints to the operation or apply a sketch contour from the Manufacture plan. See docs/CAM_4TH_AXIS_REFERENCE.md.'
        }
      }
      if (cpts.length >= 3) {
        const [fx, fy] = cpts[0]!
        const [lx, ly] = cpts[cpts.length - 1]!
        const gap = Math.hypot(lx - fx, ly - fy)
        if (gap > 0.5) {
          contourClosureHint = ` Contour wrap: polyline is not closed (endpoints ${gap.toFixed(2)} mm apart) — close the loop in WCS for predictable unwrap.`
        }
      }
    }

    const axisCount = job.machine.axisCount ?? 3
    if (axisCount < 4) {
      return {
        ok: false,
        error: `Operation '${job.operationKind}' requires a machine with axisCount ≥ 4.`,
        hint: `The selected machine profile '${job.machine.name}' is configured as a ${axisCount}-axis machine. Switch to the 'Makera Carvera (4th Axis)' profile or another profile with axisCount: 4.`
      }
    }

    const stockL = job.rotaryStockLengthMm
    const stockD = job.rotaryStockDiameterMm

    let cylinderLengthMm = 100
    if (stockL != null && Number.isFinite(stockL) && stockL > 0) cylinderLengthMm = stockL
    else if (ax4.cylinderLengthMm != null) cylinderLengthMm = ax4.cylinderLengthMm

    let cylD = 50
    if (stockD != null && Number.isFinite(stockD) && stockD > 0) cylD = stockD
    else if (ax4.cylinderDiameterMm != null) cylD = ax4.cylinderDiameterMm
    const stepDegFromMm = (job.stepoverMm / (Math.PI * Math.max(cylD, 1e-6))) * 360
    // `surfaceStepoverMm` converts a desired surface arc-length to degrees for the stock radius.
    // Priority: explicit stepoverDeg > surfaceStepoverMm > derived from job.stepoverMm.
    const stepDegFromSurface =
      ax4.surfaceStepoverMm != null
        ? surfaceStepoverDegFromMm(cylD / 2, ax4.surfaceStepoverMm)
        : undefined
    const stepoverDeg =
      ax4.stepoverDeg != null
        ? ax4.stepoverDeg
        : stepDegFromSurface != null
          ? stepDegFromSurface
          : Math.max(1, Math.min(90, stepDegFromMm))

    let zStepMm = ax4.zStepMm ?? 0
    const normZPass = normalizeAxis4RadialZPassMm(job.zPassMm)
    if (!(zStepMm > 0) && Math.abs(normZPass) > 0.3) {
      zStepMm = Math.min(2, Math.max(0.25, Math.abs(normZPass) / 4))
    }

    const chuckDepthMm =
      job.rotaryChuckDepthMm ?? (ax4.chuckDepthMm ?? 0)
    const clampOffsetMm =
      job.rotaryClampOffsetMm ?? (ax4.clampOffsetMm ?? 0)

    const wrapAxRaw = ax4.wrapAxis?.toLowerCase() ?? ''
    const machA = String(job.machine.aAxisOrientation ?? 'x').toLowerCase()
    const aAxisOrientation = wrapAxRaw === 'x' || wrapAxRaw === 'y' ? wrapAxRaw : machA === 'y' ? 'y' : 'x'

    const useMeshXClamp = job.useMeshMachinableXClamp !== false && ax4.useMeshMachinableXClamp !== false

    let meshMachinableXMinMm: number | undefined
    let meshMachinableXMaxMm: number | undefined
    let meshRadialMaxMm: number | undefined
    // The .cam-aligned.stl uses center_origin + user transform, so the mesh center
    // in X depends on the user's position.  Map it to the stock-centered GRBL frame
    // where X=0 is the chuck face: shift = stockCenter - meshCenter.
    let viewerToMachineXShift = cylinderLengthMm / 2 // fallback if mesh can't be read
    let _diagRawMeshBounds: { min: number[]; max: number[] } | null = null
    try {
      const stlBuf = await readFile(job.stlPath)
      if (isBinaryStlLayout(stlBuf)) {
        const mb = parseBinaryStl(stlBuf)
        _diagRawMeshBounds = { min: [...mb.min], max: [...mb.max] }
        // Compute shift to center mesh in stock: stockCenter - meshCenterX
        const rawMeshCenterX = (mb.min[0] + mb.max[0]) / 2
        viewerToMachineXShift = cylinderLengthMm / 2 - rawMeshCenterX
        meshMachinableXMinMm = mb.min[0] + viewerToMachineXShift
        meshMachinableXMaxMm = mb.max[0] + viewerToMachineXShift
        // Auto-center Y-Z bounding box to rotation axis (matching the TS engine's
        // centerTrianglesOnRotationAxis) before computing radial extent.
        // Without this, off-center models report inflated radial extent.
        const yCen = (mb.min[1] + mb.max[1]) / 2
        const zCen = (mb.min[2] + mb.max[2]) / 2
        const yzCorners: [number, number][] = [
          [mb.min[1] - yCen, mb.min[2] - zCen],
          [mb.min[1] - yCen, mb.max[2] - zCen],
          [mb.max[1] - yCen, mb.min[2] - zCen],
          [mb.max[1] - yCen, mb.max[2] - zCen]
        ]
        meshRadialMaxMm = Math.max(...yzCorners.map(([y, z]) => Math.hypot(y, z)))
      }
    } catch {
      /* optional — pattern-only 4-axis if STL missing */
    }

    const cylR = cylD / 2

    const toolD = job.toolDiameterMm ?? 3.175
    let axialBandCount = 1
    if (ax4.axialBandCount != null && ax4.axialBandCount >= 1) {
      axialBandCount = Math.min(24, Math.max(1, Math.floor(ax4.axialBandCount)))
    } else if (
      useMeshXClamp &&
      meshMachinableXMinMm != null &&
      meshMachinableXMaxMm != null &&
      meshMachinableXMaxMm > meshMachinableXMinMm + 1e-3
    ) {
      const span = meshMachinableXMaxMm - meshMachinableXMinMm
      if (span > toolD * 2.5) {
        axialBandCount = Math.min(10, Math.max(2, Math.round(span / Math.max(toolD * 4, 10))))
      }
    }

    const stockLenForMach =
      stockL != null && Number.isFinite(stockL) && stockL > 0 ? stockL : cylinderLengthMm
    const spanMach = rotaryMachinableXSpanMm(stockLenForMach, chuckDepthMm, clampOffsetMm)
    let mach_x_s = spanMach.machXStartMm
    let mach_x_e = Math.min(cylinderLengthMm, spanMach.machXEndMm)
    if (
      useMeshXClamp &&
      meshMachinableXMinMm != null &&
      meshMachinableXMaxMm != null &&
      meshMachinableXMaxMm > meshMachinableXMinMm + 1e-3
    ) {
      mach_x_s = Math.max(mach_x_s, meshMachinableXMinMm)
      mach_x_e = Math.min(mach_x_e, meshMachinableXMaxMm)
    }

    let alignHint = ''
    if (
      meshMachinableXMinMm != null &&
      meshMachinableXMaxMm != null &&
      meshMachinableXMaxMm > meshMachinableXMinMm
    ) {
      const h = rotaryMeshStockAlignmentHint({
        stockLengthMm: stockLenForMach,
        meshMinX: meshMachinableXMinMm,
        meshMaxX: meshMachinableXMaxMm
      })
      if (h) alignHint = ` ${h}`
    }

    const normAxis4ZPass = normalizeAxis4RadialZPassMm(job.zPassMm)
    const zDepths = computeAxis4ZDepthsMm(
      normAxis4ZPass,
      zStepMm,
      cylR,
      ax4.useMeshRadialZBands === true &&
        meshRadialMaxMm != null &&
        Number.isFinite(meshRadialMaxMm) &&
        meshRadialMaxMm > 0,
      meshRadialMaxMm
    )

    const radialExtentHint =
      meshRadialMaxMm != null &&
      Number.isFinite(meshRadialMaxMm) &&
      meshRadialMaxMm > cylR + 0.5
        ? ` Rotary: STL extends ~${meshRadialMaxMm.toFixed(1)} mm from the X axis but job cylinder radius is ${cylR.toFixed(
            1
          )} mm (Ø${cylD.toFixed(1)}). Toolpaths only cut inside that cylinder — increase rotary stock Ø (≥ ~${(2 * meshRadialMaxMm).toFixed(1)} mm) or rescale/reorient the STL (docs/CAM_4TH_AXIS_REFERENCE.md).`
        : ''

    // ── Mesh-aware TS heightmap engine for roughing/finishing ──
    // Contour mode uses explicit contour points (not mesh) → handled in TS fallback.
    // Indexed mode uses discrete angles → handled in TS fallback.
    // Roughing/finishing: try TS mesh-aware engine first, fall back to pattern parallel.

    let axis4Lines: string[] | null = null
    if (!isContour && job.operationKind !== 'cnc_4axis_indexed' && mach_x_e > mach_x_s + 0.05) {
      try {
        const stlBuf = await readFile(job.stlPath)
        const { triangles, truncated } = isBinaryStlLayout(stlBuf)
          ? collectBinaryStlTriangles(stlBuf, 500_000)
          : isLikelyAsciiStl(stlBuf)
            ? collectAsciiStlTriangles(stlBuf, 500_000)
            : collectBinaryStlTriangles(stlBuf, 500_000)
        // Shift triangle X from viewer-centered frame to machine frame
        // (same offset applied to mesh bounds above).
        for (const tri of triangles) {
          for (const v of tri) (v as unknown as number[])[0] += viewerToMachineXShift
        }
        if (triangles.length > 0) {
          const maxCells =
            ax4.cylindricalRasterMaxCells != null
              ? Math.min(500_000, Math.floor(ax4.cylindricalRasterMaxCells))
              : 250_000
          const finishAl =
            ax4.rotaryFinishAllowanceMm != null
              ? Math.max(0, ax4.rotaryFinishAllowanceMm)
              : undefined
          const overcutMm = ax4.overcutMm
          // Finishing: finer stepover, single final depth, enable finish pass
          // Roughing: normal stepover, all depth levels, no finish pass
          const effectiveStepoverDeg = isFinishing
            ? (ax4.finishStepoverDeg != null
                ? ax4.finishStepoverDeg
                : Math.max(0.5, stepoverDeg / 2))
            : stepoverDeg
          const effectiveZDepths = isFinishing
            ? [zDepths[zDepths.length - 1]!]
            : zDepths
          const lines = generateCylindricalMeshRasterLines({
            triangles,
            cylinderDiameterMm: cylD,
            machXStartMm: mach_x_s,
            machXEndMm: mach_x_e,
            stepoverDeg: effectiveStepoverDeg,
            stepXMm: Math.max(0.25, job.stepoverMm),
            zDepthsMm: effectiveZDepths,
            feedMmMin: job.feedMmMin,
            plungeMmMin: job.plungeMmMin,
            safeZMm: job.safeZMm,
            finishAllowanceMm: finishAl,
            maxCells,
            toolDiameterMm: toolD,
            overcutMm,
            enableFinishPass: isFinishing,
            maxZMm: job.machine.workAreaMm?.z
          })
          // Validate output: must have both plunge moves (G1 ... Z) AND cutting moves (G1 ... X)
          // Use \b word boundary to match X/Z anywhere on G1 lines (combined moves like G1 X10 A45 Z5)
          const g1xCount = lines.filter((l) => /^G1\b/i.test(l) && /\bX[\d.-]/i.test(l)).length
          const hasG1z = lines.some((l) => /^G1\b/i.test(l) && /\bZ[\d.-]/i.test(l))
          if (hasG1z && g1xCount >= 4) {
            axis4Lines = lines
            if (truncated) {
              alignHint +=
                ' Cylindrical raster used a truncated STL triangle budget (500k limit) — simplify mesh or see docs/CAM_4TH_AXIS_REFERENCE.md.'
            }
          }
        }
      } catch (meshRasterErr) {
        // Log but don't block — fall through to Python engine
        dbg(`4axis:ts_mesh_raster_error: ${meshRasterErr instanceof Error ? meshRasterErr.message : String(meshRasterErr)}`)
      }
    }

    // ── TS fallback: contour wrapping, indexed passes, or pattern parallel ──
    if (axis4Lines == null) {
      dbg('4axis:ts_fallback_start')
      if (isContour) {
        const cpts = ax4.contourPoints ?? []
        if (cpts.length >= 2) {
          axis4Lines = generateContourWrappingLines({
            contourPoints: cpts,
            cylinderDiameterMm: cylD,
            machXStartMm: mach_x_s,
            machXEndMm: mach_x_e,
            zDepthsMm: zDepths,
            feedMmMin: job.feedMmMin,
            plungeMmMin: job.plungeMmMin,
            safeZMm: job.safeZMm,
            maxZMm: job.machine.workAreaMm?.z
          })
        }
      } else if (job.operationKind === 'cnc_4axis_indexed') {
        const angles = ax4.indexAnglesDeg ?? []
        if (angles.length > 0) {
          axis4Lines = generateIndexedPassLines({
            indexAnglesDeg: angles,
            cylinderDiameterMm: cylD,
            machXStartMm: mach_x_s,
            machXEndMm: mach_x_e,
            zDepthsMm: zDepths,
            feedMmMin: job.feedMmMin,
            plungeMmMin: job.plungeMmMin,
            safeZMm: job.safeZMm,
            toolDiameterMm: toolD,
            overcutMm: ax4.overcutMm,
            maxZMm: job.machine.workAreaMm?.z
          })
        }
      } else {
        // Roughing/finishing without mesh data — simple pattern parallel
        axis4Lines = generatePatternParallelLines({
          cylinderDiameterMm: cylD,
          machXStartMm: mach_x_s,
          machXEndMm: mach_x_e,
          zDepthsMm: zDepths,
          stepoverDeg,
          feedMmMin: job.feedMmMin,
          plungeMmMin: job.plungeMmMin,
          safeZMm: job.safeZMm,
          toolDiameterMm: toolD,
          overcutMm: ax4.overcutMm,
          maxZMm: job.machine.workAreaMm?.z
        })
      }
      dbg('4axis:ts_fallback_end')
    }

    if (axis4Lines == null || axis4Lines.length === 0) {
      return {
        ok: false,
        error: '4-axis toolpath is empty.',
        hint: 'Check cylinderDiameterMm, cylinderLengthMm, and zPassMm. For contour mode add contourPoints. For indexed mode ensure indexAnglesDeg is a non-empty array. If mesh raster found no hits, verify STL WCS vs stock or use Parallel mode.'
      }
    }

    dbg('4axis:post_start')
    const postResult = await renderPost(job.resourcesRoot, job.machine, axis4Lines, {
      workCoordinateIndex: job.workCoordinateIndex,
      operationLabel: job.operationLabel ?? job.operationKind,
      toolNumber: job.toolSlot,
      ...extractPostProcessingOpts(job.operationParams)
    })
    const gcode = postResult.gcode
    await writeFile(job.outputGcodePath, gcode, 'utf-8')
    dbg('4axis:done')

    // Check for excessive A-axis angular velocity in posted G-code
    const angularVelocityWarnings = check4AxisAngularVelocity(
      gcode.split(/\r?\n/),
      {
        maxRotaryRpm: job.machine.maxRotaryRpm,
        stockDiameterMm: job.rotaryStockDiameterMm ?? cylD
      }
    )
    const angularVelocityHint = formatAngularVelocityHint(angularVelocityWarnings)

    // Check for A-axis positions exceeding machine travel limits
    const travelLimitWarnings = check4AxisTravelLimits(
      gcode.split(/\r?\n/),
      { aAxisRangeDeg: job.machine.aAxisRangeDeg }
    )
    const travelLimitHint = formatTravelLimitHint(travelLimitWarnings)

    return {
      ok: true,
      gcode,
      usedEngine: 'builtin',
      engine: { requestedEngine: 'builtin', usedEngine: 'builtin', fallbackApplied: false },
      ...(postResult.warnings.length ? { warnings: postResult.warnings } : {}),
      hint: `4-axis toolpath (${job.operationKind}) posted. ${UNVERIFIED} Run an air cut with spindle OFF before any real cut. Confirm cylinder diameter and A WCS home (docs/MACHINES.md).${postedGcodeEnvelopeHint(job.machine, gcode, job.rotaryStockDiameterMm ?? cylD)}${rotaryTravelHintForPostedGcode(job.operationKind, gcode)}${angularVelocityHint}${travelLimitHint}${guardHint}${alignHint}${contourClosureHint}${radialExtentHint}` +
        (_diagRawMeshBounds
          ? ` [DIAG] raw .cam-aligned mesh: X=[${_diagRawMeshBounds.min[0]?.toFixed(1)}..${_diagRawMeshBounds.max[0]?.toFixed(1)}] Y=[${_diagRawMeshBounds.min[1]?.toFixed(1)}..${_diagRawMeshBounds.max[1]?.toFixed(1)}] Z=[${_diagRawMeshBounds.min[2]?.toFixed(1)}..${_diagRawMeshBounds.max[2]?.toFixed(1)}]; xShift=${viewerToMachineXShift.toFixed(1)}; stock Ø${cylD.toFixed(1)}×${cylinderLengthMm.toFixed(1)}; machX=[${mach_x_s.toFixed(1)}..${mach_x_e.toFixed(1)}]`
          : '')
    }
  }

  if (
    job.operationKind === 'cnc_contour' ||
    job.operationKind === 'cnc_pocket' ||
    job.operationKind === 'cnc_drill' ||
    job.operationKind === 'cnc_chamfer' ||
    job.operationKind === 'cnc_pcb_isolation' ||
    job.operationKind === 'cnc_pcb_contour' ||
    job.operationKind === 'cnc_pcb_drill'
  ) {
    dbg('2d:dispatch_start')
    const result2d = await dispatch2dStrategy(job, guardHint, postedGcodeEnvelopeHint)
    dbg('2d:dispatch_done')
    return result2d
  }

  /* 2D strategy code extracted to cam-runner-2d.ts — dispatch2dStrategy() */
  /* eslint-disable @typescript-eslint/no-unnecessary-condition -- dead code guarded during migration */
  if (false as boolean) {
    const p = job.operationParams ?? {}
    let lines: string[] = []
    let pocketResultHints: string[] = []
    let drillResultHints: string[] = []
    if (job.operationKind === 'cnc_contour') {
      const contour = point2dList(p['contourPoints'])
      const { contourSide, leadInMm, leadOutMm, leadInMode, leadOutMode } = resolveContourPathOptions(p)
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
        leadOutMode
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
            'Check contourPoints form a closed, non-degenerate polygon (≥3 distinct points, non-zero area) in setup WCS; zPassMm must reach stock; safe height and feeds must be valid. Open or self-intersecting loops produce no moves.'
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
            'Check contourPoints form a closed polygon (≥3 points), chamferDepthMm is positive, and feed/safe-Z are valid.'
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
            'Check contourPoints form a closed, non-degenerate polygon (≥3 points) and zPassMm is non-zero.'
        }
      }
    } else {
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
    dbg('2d:post_start')
    const postResult2d = await renderPost(job.resourcesRoot, job.machine, lines, {
      workCoordinateIndex: job.workCoordinateIndex,
      operationLabel: job.operationLabel ?? job.operationKind,
      toolNumber: job.toolSlot,
      ...extractPostProcessingOpts(job.operationParams)
    })
    const gcode = postResult2d.gcode
    await writeFile(job.outputGcodePath, gcode, 'utf-8')
    dbg('2d:done')
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
      ...(postResult2d.warnings.length ? { warnings: postResult2d.warnings } : {}),
      hint:
        [base2dHint, ...pocketResultHints, ...drillResultHints].filter(Boolean).join(' ') +
        postedGcodeEnvelopeHint(job.machine, gcode) +
        guardHint
    }
  }

  dbg('stl:read_start')
  const stlLoad = await readStlBufferForCam(job.stlPath)
  dbg('stl:read_done')
  if (!stlLoad.ok) return stlLoad
  const meshBuf = stlLoad.buf
  const boundsEarly = parseBinaryStl(meshBuf)
  const pAutoDoc = job.operationParams
  if (pAutoDoc?.['autoDocFromSetupMesh'] === true && job.stockBoxZMm != null && job.stockBoxZMm > 0) {
    const sug = suggestedZPassMmFromStockAndMeshMinZ(job.stockBoxZMm, boundsEarly.min[2])
    if (sug != null) {
      const grDoc = applyCamToolpathGuardrails({ ...job, zPassMm: sug })
      job = grDoc.job
    }
  }

  const camJob =
    job.operationKind === 'cnc_pencil'
      ? {
          ...job,
          stepoverMm: resolvePencilStepoverMm({
            baseStepoverMm: job.stepoverMm,
            toolDiameterMm: job.toolDiameterMm ?? 6,
            operationParams: job.operationParams
          })
        }
      : job.operationKind === 'cnc_3d_finish'
      ? {
          ...job,
          stepoverMm: resolve3dFinishStepoverMm({
            toolDiameterMm: job.toolDiameterMm ?? 6,
            baseStepoverMm: job.stepoverMm,
            operationParams: job.operationParams
          }).stepoverMm
        }
      : job

  // ── Try v4.0 toolpath engine for new strategies (spiral, morphing, trochoidal, steep/shallow, scallop, 5-axis, auto-select) ──
  const tpEngineStrategy = manufactureKindUsesToolpathEngine(camJob.operationKind)
  const isNewStrategy = tpEngineStrategy && !manufactureKindUsesAdvancedStrategy(camJob.operationKind)
  if (isNewStrategy && tpEngineStrategy) {
    dbg('toolpath_engine:start')
    const tpe = await tryToolpathEngine(camJob, tpEngineStrategy, boundsEarly)
    dbg(tpe.ok && tpe.toolpathLines && tpe.toolpathLines.length > 0 ? 'toolpath_engine:success' : `toolpath_engine:fallback reason=${tpe.stdout.slice(0, 200)}`)
    if (tpe.ok && tpe.toolpathLines && tpe.toolpathLines.length > 0) {
      dbg('toolpath_engine:post_start')
      const postResultTpe = await renderPost(job.resourcesRoot, job.machine, tpe.toolpathLines, {
        workCoordinateIndex: job.workCoordinateIndex,
        toolNumber: job.toolSlot,
        ...extractPostProcessingOpts(job.operationParams)
      })
      const gcode = postResultTpe.gcode
      await writeFile(job.outputGcodePath, gcode, 'utf-8')
      dbg('toolpath_engine:done')
      const stratLabel = TOOLPATH_ENGINE_STRATEGY_LABELS[tpEngineStrategy] ?? tpEngineStrategy
      const warningHint = tpe.warnings?.length ? ` Warnings: ${tpe.warnings.join('; ')}` : ''
      return {
        ok: true,
        gcode,
        usedEngine: 'advanced' as const,
        engine: {
          requestedEngine: 'advanced' as const,
          usedEngine: 'advanced' as const,
          fallbackApplied: false
        },
        ...(postResultTpe.warnings.length ? { warnings: postResultTpe.warnings } : {}),
        hint: `Toolpath engine v4.0 ${stratLabel} posted for your machine profile.${warningHint} ${UNVERIFIED}${postedGcodeEnvelopeHint(job.machine, gcode)}${guardHint}`
      }
    }
    dbg('toolpath_engine:fallback')
    // For new-only strategies with no legacy fallback, report the error
    if (!manufactureKindUsesAdvancedStrategy(camJob.operationKind) && !manufactureKindUsesOclStrategy(camJob.operationKind)) {
      return {
        ok: false,
        error: `Toolpath engine failed for strategy "${tpEngineStrategy}". Ensure Python is configured and available.`,
        hint: tpe.stdout.includes('import_error')
          ? 'The toolpath engine could not import required modules. Check your Python installation.'
          : tpe.stdout.includes('stl_missing')
            ? 'STL file was not found at the expected path.'
            : `Engine output: ${tpe.stdout.slice(0, 500)}`
      }
    }
    // For strategies that also have legacy fallback (adaptive, waterline, raster, pencil), fall through
  }

  // ── Try advanced toolpath engine (adaptive clearing, waterline, raster, pencil) ──
  const advancedStrategy = manufactureKindUsesAdvancedStrategy(camJob.operationKind)
  if (advancedStrategy) {
    dbg('advanced:start')
    const adv = await tryAdvancedToolpath(camJob, advancedStrategy, boundsEarly)
    dbg(adv.ok && adv.toolpathLines && adv.toolpathLines.length > 0 ? 'advanced:success' : `advanced:fallback reason=${adv.stdout.slice(0, 200)}`)
    if (adv.ok && adv.toolpathLines && adv.toolpathLines.length > 0) {
      dbg('advanced:post_start')
      const postResultAdv = await renderPost(job.resourcesRoot, job.machine, adv.toolpathLines, {
        workCoordinateIndex: job.workCoordinateIndex,
        toolNumber: job.toolSlot,
        ...extractPostProcessingOpts(job.operationParams)
      })
      const gcode = postResultAdv.gcode
      await writeFile(job.outputGcodePath, gcode, 'utf-8')
      dbg('advanced:done')
      const stratLabel =
        advancedStrategy === 'adaptive_clear'
          ? 'adaptive clearing (constant engagement)'
          : advancedStrategy === 'waterline'
            ? 'waterline (Z-level contour)'
            : advancedStrategy === 'pencil'
              ? 'pencil trace (concave cleanup)'
              : 'raster (surface-following)'
      return {
        ok: true,
        gcode,
        usedEngine: 'advanced',
        engine: {
          requestedEngine: 'advanced',
          usedEngine: 'advanced',
          fallbackApplied: false
        },
        ...(postResultAdv.warnings.length ? { warnings: postResultAdv.warnings } : {}),
        hint: `Advanced engine ${stratLabel} toolpath posted for your machine profile. ${UNVERIFIED}${postedGcodeEnvelopeHint(job.machine, gcode)}${guardHint}`
      }
    }
    dbg('advanced:fallback_to_ocl')
    // Advanced engine failed — fall through to OCL / builtin chain
  }

  const oclStrategy = manufactureKindUsesOclStrategy(camJob.operationKind)
  if (oclStrategy) {
    dbg('ocl:start')
    const ocl = await tryOclToolpath(camJob, oclStrategy)
    dbg(ocl.ok && ocl.toolpathLines && ocl.toolpathLines.length > 0 ? 'ocl:success' : 'ocl:fallback')
    if (ocl.ok && ocl.toolpathLines && ocl.toolpathLines.length > 0) {
      dbg('ocl:post_start')
      const postResultOcl = await renderPost(job.resourcesRoot, job.machine, ocl.toolpathLines, {
        workCoordinateIndex: job.workCoordinateIndex,
        toolNumber: job.toolSlot,
        ...extractPostProcessingOpts(job.operationParams)
      })
      const gcode = postResultOcl.gcode
      await writeFile(job.outputGcodePath, gcode, 'utf-8')
      dbg('ocl:done')
      const stratLabel =
        oclStrategy === 'adaptive_waterline'
          ? 'AdaptiveWaterline'
          : oclStrategy === 'raster'
            ? job.operationKind === 'cnc_pencil'
              ? 'PathDropCutter raster (pencil / tight stepover)'
              : 'PathDropCutter raster'
            : 'waterline'
      return {
        ok: true,
        gcode,
        usedEngine: 'ocl',
        engine: {
          requestedEngine: 'ocl',
          usedEngine: 'ocl',
          fallbackApplied: false
        },
        ...(postResultOcl.warnings.length ? { warnings: postResultOcl.warnings } : {}),
        hint: `OpenCAMLib ${stratLabel} toolpath posted for your machine profile. ${UNVERIFIED}${postedGcodeEnvelopeHint(job.machine, gcode)}${guardHint}`
      }
    }
    const fallbackReason = resolveOclFallbackReason(ocl.stdout) ?? 'unknown_ocl_failure'
    const hint = builtinOclFailureHint(ocl.stdout, job.operationKind)
    const bounds = boundsEarly

    if (oclStrategy === 'raster') {
      dbg('fallback:mesh_raster_start')
      const mesh = collectBinaryStlTriangles(meshBuf)
      const sampleStepMm = Math.max(0.2, Math.min(camJob.stepoverMm, 2))
      const rest = effectiveRasterRestStockMm(job, bounds.min[2])
      const priorFloor = priorRoughFloorSamplerForMeshRaster(job, bounds)
      const analyticRough = meshAnalyticPriorRoughStockMmFromParams(job.operationParams)
      let lines = generateMeshHeightRasterLines({
        triangles: mesh.triangles,
        minX: bounds.min[0],
        maxX: bounds.max[0],
        minY: bounds.min[1],
        maxY: bounds.max[1],
        stepoverMm: camJob.stepoverMm,
        sampleStepMm,
        feedMmMin: chipThinningAdjustedFeedMmMin(job.feedMmMin, camJob.stepoverMm, job.toolDiameterMm),
        plungeMmMin: job.plungeMmMin,
        safeZMm: job.safeZMm,
        ...(rest != null ? { rasterRestStockMm: rest } : {}),
        ...(priorFloor ? { priorRoughFloorSampler: priorFloor } : {}),
        ...(analyticRough != null ? { meshAnalyticPriorRoughStockMm: analyticRough } : {})
      })
      dbg('fallback:mesh_raster_end')
      const extras: string[] = []
      if (mesh.truncated) {
        extras.push(`STL sampled with first ${mesh.triangles.length} triangles only (cap).`)
      }
      if (!toolpathHasXYCutMoves(lines)) {
        lines = generateOrthoBoundsRasterLines({
          bounds,
          zPassMm: job.zPassMm,
          stepoverMm: camJob.stepoverMm,
          feedMmMin: chipThinningAdjustedFeedMmMin(job.feedMmMin, camJob.stepoverMm, job.toolDiameterMm),
          plungeMmMin: job.plungeMmMin,
          safeZMm: job.safeZMm
        })
        extras.push(
          'Mesh height-field produced no XY cuts (empty mesh, ASCII STL, or samples off-surface); using orthogonal bounds zigzag at fixed Z from params.'
        )
      } else {
        extras.push(
          'Built-in 2.5D mesh height-field XY raster (upper envelope; no cutter-radius compensation or undercut handling).'
        )
      }
      if (job.operationKind === 'cnc_pencil') {
        extras.push('Pencil op: built-in raster uses reduced stepover vs standard raster.')
      }
      if (priorFloor) {
        extras.push(
          'Prior posted G-code rest floor (MVP): feed moves from priorPostedGcode used to skip mesh points already machined past the surface (+ raster rest). Same WCS required.'
        )
      }
      if (analyticRough != null && !priorFloor) {
        extras.push(
          `Analytic rough stock (meshAnalyticPriorRoughStockMm=${analyticRough} mm) simulates a prior rest floor on mesh raster fallback when no usePriorPostedGcodeRest sampler — 2.5D heuristic only.`
        )
      }
      dbg('fallback:raster_post_start')
      const postResultRaster = await renderPost(job.resourcesRoot, job.machine, lines, {
        workCoordinateIndex: job.workCoordinateIndex,
        toolNumber: job.toolSlot,
        ...extractPostProcessingOpts(job.operationParams)
      })
      const gcode = postResultRaster.gcode
      await writeFile(job.outputGcodePath, gcode, 'utf-8')
      dbg('fallback:raster_done')
      const tail = extras.length ? ` ${extras.join(' ')}` : ''
      return {
        ok: true,
        gcode,
        usedEngine: 'builtin',
        engine: {
          requestedEngine: 'ocl',
          usedEngine: 'builtin',
          fallbackApplied: true,
          fallbackReason,
          fallbackDetail: extras.join(' ')
        },
        ...(postResultRaster.warnings.length ? { warnings: postResultRaster.warnings } : {}),
        hint: [hint, tail.trim(), UNVERIFIED].filter(Boolean).join(' ') + postedGcodeEnvelopeHint(job.machine, gcode) + guardHint
      }
    }

    dbg('fallback:parallel_finish_start')
    const lines = generateParallelFinishLines({
      bounds,
      zPassMm: job.zPassMm,
      stepoverMm: job.stepoverMm,
      feedMmMin: chipThinningAdjustedFeedMmMin(job.feedMmMin, job.stepoverMm, job.toolDiameterMm),
      plungeMmMin: job.plungeMmMin,
      safeZMm: job.safeZMm
    })
    dbg('fallback:parallel_finish_end')
    const postResultParFb = await renderPost(job.resourcesRoot, job.machine, lines, {
      workCoordinateIndex: job.workCoordinateIndex,
      operationLabel: job.operationLabel ?? job.operationKind,
      toolNumber: job.toolSlot,
      ...extractPostProcessingOpts(job.operationParams)
    })
    const gcode = postResultParFb.gcode
    await writeFile(job.outputGcodePath, gcode, 'utf-8')
    dbg('fallback:parallel_done')
    return {
      ok: true,
      gcode,
      usedEngine: 'builtin',
      engine: {
        requestedEngine: 'ocl',
        usedEngine: 'builtin',
        fallbackApplied: true,
        fallbackReason
      },
      ...(postResultParFb.warnings.length ? { warnings: postResultParFb.warnings } : {}),
      hint: [hint, UNVERIFIED].filter(Boolean).join(' ') + postedGcodeEnvelopeHint(job.machine, gcode) + guardHint
    }
  }

  dbg('builtin_parallel:start')
  const bounds = boundsEarly
  const lines = generateParallelFinishLines({
    bounds,
    zPassMm: job.zPassMm,
    stepoverMm: job.stepoverMm,
    feedMmMin: chipThinningAdjustedFeedMmMin(job.feedMmMin, job.stepoverMm, job.toolDiameterMm),
    plungeMmMin: job.plungeMmMin,
    safeZMm: job.safeZMm
  })
  dbg('builtin_parallel:post_start')
  const postResultBuiltin = await renderPost(job.resourcesRoot, job.machine, lines, {
    workCoordinateIndex: job.workCoordinateIndex,
    toolNumber: job.toolSlot,
    ...extractPostProcessingOpts(job.operationParams)
  })
  const gcode = postResultBuiltin.gcode
  await writeFile(job.outputGcodePath, gcode, 'utf-8')
  dbg('builtin_parallel:done')
  return {
    ok: true,
    gcode,
    usedEngine: 'builtin',
    engine: {
      requestedEngine: 'builtin',
      usedEngine: 'builtin',
      fallbackApplied: false
    },
    ...(postResultBuiltin.warnings.length ? { warnings: postResultBuiltin.warnings } : {}),
    hint: `Built-in parallel finish from STL bounding box (no OpenCAMLib). ${UNVERIFIED}${postedGcodeEnvelopeHint(job.machine, gcode)}${guardHint}`
  }
}
