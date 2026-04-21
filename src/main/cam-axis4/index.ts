/**
 * 4-Axis CAM Engine — Public Facade
 *
 * Single entry point for every 4-axis operation. Replaces the ~360-line
 * dispatch block at `cam-runner.ts:1163-1559`.
 *
 * Pipeline:
 *   1. Read STL → triangles
 *   2. `frame.ts` — apply user gizmo transform (or identity) → machine frame
 *   3. `validation.ts` — pre-generation hard checks (no silent clamps)
 *   4. Dispatch to one of 6 strategies (roughing/finishing/contour/indexed/
 *      pattern/continuous) based on `operationKind`
 *   5. `renderPost` — render through the GRBL/Carvera template
 *
 * The facade does not know anything about IPC, file paths beyond the input
 * STL, or the renderer. It returns a `CamRunResult` shaped exactly like the
 * one `cam-runner.ts` produces for other ops, so the caller can drop it in.
 */
import { readFile, writeFile } from 'node:fs/promises'
import type { MachineProfile } from '../../shared/machine-schema'
import { parse4AxisParams } from '../../shared/cam-4axis-params'
import {
  rotaryMachinableXSpanMm,
  rotaryMeshStockAlignmentHint
} from '../../shared/cam-setup-defaults'
import {
  formatMachineEnvelopeHintForPostedGcode,
  formatRotaryRadialHintForPostedGcode
} from '../../shared/cam-machine-envelope'
import {
  collectAsciiStlTriangles,
  collectBinaryStlTriangles,
  isBinaryStlLayout,
  isLikelyAsciiStl
} from '../stl'
import { renderPost } from '../post-process'
import {
  identityPlacement,
  meshToMachineFrame,
  type Placement,
  type Triangle
} from './frame'
import { validateAxis4Job } from './validation'
import { surfaceStepoverDegFromMm } from './rasterize'
import { generateRoughing } from './strategies/roughing'
import { generateFinishing } from './strategies/finishing'
import { generateContour } from './strategies/contour'
import { generateIndexed } from './strategies/indexed'
import { generatePattern } from './strategies/pattern'
import { generateContinuous } from './strategies/continuous'
import { extractPostProcessingOpts, manufactureKindUses4AxisEngine } from './runner-shims'

// Re-export for cam-runner.ts so it can keep its existing dispatch import.
export { manufactureKindUses4AxisEngine }
// Re-export the Placement type so cam-runner.ts and other consumers can
// strongly type the optional gizmo transform.
export type { Placement } from './frame'

/** Job config consumed by the 4-axis facade. Mirrors `CamJobConfig` fields used here. */
export type Axis4JobConfig = {
  stlPath: string
  outputGcodePath: string
  machine: MachineProfile
  resourcesRoot: string
  zPassMm: number
  stepoverMm: number
  feedMmMin: number
  plungeMmMin: number
  safeZMm: number
  operationKind: string
  operationLabel?: string
  operationParams?: Record<string, unknown>
  workCoordinateIndex?: number
  toolDiameterMm?: number
  toolSlot?: number
  rotaryStockLengthMm?: number
  rotaryStockDiameterMm?: number
  rotaryChuckDepthMm?: number
  rotaryClampOffsetMm?: number
  /** User gizmo transform (Three.js viewer space). Defaults to identity. */
  placement?: Placement
}

export type Axis4Result =
  | {
      ok: true
      gcode: string
      usedEngine: 'builtin'
      engine: { requestedEngine: 'builtin'; usedEngine: 'builtin'; fallbackApplied: false }
      hint: string
      warnings?: string[]
    }
  | { ok: false; error: string; hint?: string }

const UNVERIFIED =
  'Posted with the new 4-axis engine — run an air cut with spindle OFF before any real cut.'

/** Normalize zPass to a negative radial depth (the convention the strategies expect). */
function normalizeRadialZPassMm(zPassMm: number): number {
  if (zPassMm < -1e-9) return zPassMm
  if (zPassMm > 1e-9) return -Math.abs(zPassMm)
  return -0.5
}

/** Iterate from -zStep down to zPass (inclusive), in zStep increments. */
function iterDepthsMm(zPassMm: number, zStepMm: number): number[] {
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

/**
 * Compute roughing depth levels with optional mesh-aware shallow start.
 *
 * If we know the mesh's maximum radial extent, start at the depth where the
 * tool first encounters the mesh (`mr - r`) instead of the stock surface.
 * Avoids spending dozens of empty waterline passes on undersized parts.
 */
function computeDepthsMm(
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
    return iterDepthsMm(zp, zStepMm)
  }
  const zShallow = mr - r
  if (zShallow <= zp + 1e-6) return iterDepthsMm(zp, zStepMm)
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

/** Read STL and collect triangles in raw STL coordinates (no transform). */
async function readStlTriangles(stlPath: string): Promise<{
  triangles: Triangle[]
  truncated: boolean
}> {
  const buf = await readFile(stlPath)
  if (isBinaryStlLayout(buf)) {
    const out = collectBinaryStlTriangles(buf, 500_000)
    return { triangles: out.triangles as unknown as Triangle[], truncated: out.truncated }
  }
  if (isLikelyAsciiStl(buf)) {
    const out = collectAsciiStlTriangles(buf, 500_000)
    return { triangles: out.triangles as unknown as Triangle[], truncated: out.truncated }
  }
  // Fall through: try binary anyway (some STLs are mislabeled).
  const out = collectBinaryStlTriangles(buf, 500_000)
  return { triangles: out.triangles as unknown as Triangle[], truncated: out.truncated }
}

function envelopeHint(
  machine: MachineProfile,
  gcode: string,
  rotaryStockDiameterMm: number
): string {
  if (machine.kind !== 'cnc') return ''
  let h = formatMachineEnvelopeHintForPostedGcode(gcode, machine.workAreaMm)
  const ac = machine.axisCount ?? 3
  if (ac >= 4 && rotaryStockDiameterMm > 0) {
    h += formatRotaryRadialHintForPostedGcode(gcode, rotaryStockDiameterMm)
  }
  return h
}

/**
 * Run the 4-axis CAM pipeline for a single job. Returns a result shaped to
 * drop into `cam-runner.ts`.
 */
export async function runAxis4(job: Axis4JobConfig): Promise<Axis4Result> {
  const opKind = job.operationKind
  const params = job.operationParams ?? {}
  const ax4 = parse4AxisParams(params)

  // ── Stock geometry ────────────────────────────────────────────────────────
  const stockLength =
    job.rotaryStockLengthMm != null && job.rotaryStockLengthMm > 0
      ? job.rotaryStockLengthMm
      : ax4.cylinderLengthMm ?? 100
  const stockDiameter =
    job.rotaryStockDiameterMm != null && job.rotaryStockDiameterMm > 0
      ? job.rotaryStockDiameterMm
      : ax4.cylinderDiameterMm ?? 50
  const stockRadius = stockDiameter / 2

  // ── Machinable axial span (chuck/clamp deductions) ───────────────────────
  const chuckDepthMm = job.rotaryChuckDepthMm ?? ax4.chuckDepthMm ?? 0
  const clampOffsetMm = job.rotaryClampOffsetMm ?? ax4.clampOffsetMm ?? 0
  const span = rotaryMachinableXSpanMm(stockLength, chuckDepthMm, clampOffsetMm)
  const machXStartMm = span.machXStartMm
  const machXEndMm = Math.min(stockLength, span.machXEndMm)

  // ── Stepover (degrees) ────────────────────────────────────────────────────
  const stepDegFromMm = (job.stepoverMm / (Math.PI * Math.max(stockDiameter, 1e-6))) * 360
  const stepDegFromSurface =
    ax4.surfaceStepoverMm != null
      ? surfaceStepoverDegFromMm(stockRadius, ax4.surfaceStepoverMm)
      : undefined
  const stepoverDeg =
    ax4.stepoverDeg != null
      ? ax4.stepoverDeg
      : stepDegFromSurface != null
        ? stepDegFromSurface
        : Math.max(1, Math.min(90, stepDegFromMm))

  // ── Z step (waterline spacing) ────────────────────────────────────────────
  let zStepMm = ax4.zStepMm ?? 0
  const normZPass = normalizeRadialZPassMm(job.zPassMm)
  if (!(zStepMm > 0) && Math.abs(normZPass) > 0.3) {
    zStepMm = Math.min(2, Math.max(0.25, Math.abs(normZPass) / 4))
  }

  // ── Read mesh + apply user transform ─────────────────────────────────────
  // Contour and indexed strategies do not need a mesh. Pattern is the no-mesh
  // fallback. For the others we read the STL and run it through frame.ts.
  const needsMesh =
    opKind === 'cnc_4axis_roughing' ||
    opKind === 'cnc_4axis_finishing' ||
    opKind === 'cnc_4axis_continuous'

  let frame: ReturnType<typeof meshToMachineFrame> | null = null
  let meshTruncated = false
  if (needsMesh || opKind === 'cnc_4axis_contour' || opKind === 'cnc_4axis_indexed') {
    try {
      const { triangles, truncated } = await readStlTriangles(job.stlPath)
      meshTruncated = truncated
      if (triangles.length > 0) {
        frame = meshToMachineFrame(triangles, job.placement ?? identityPlacement(), {
          lengthMm: stockLength,
          diameterMm: stockDiameter
        })
      }
    } catch {
      // Mesh is optional for contour/indexed; required for roughing/finishing/continuous.
      frame = null
    }
  }

  if (needsMesh && (frame == null || frame.triangles.length === 0)) {
    return {
      ok: false,
      error: `4-axis ${opKind} requires a readable STL mesh.`,
      hint: 'Ensure the staged STL file at the job path exists and is a valid binary or ASCII STL.'
    }
  }

  // ── Pre-generation validation ────────────────────────────────────────────
  const aAxisOrientationRaw = String(job.machine.aAxisOrientation ?? 'x').toLowerCase()
  const aAxisOrientation: 'x' | 'y' = aAxisOrientationRaw === 'y' ? 'y' : 'x'
  const validation = validateAxis4Job({
    operationKind: opKind,
    stock: { lengthMm: stockLength, diameterMm: stockDiameter },
    axisCount: job.machine.axisCount ?? 3,
    aAxisOrientation,
    dialect: job.machine.dialect,
    frame: frame ?? {
      triangles: [],
      bbox: { min: [0, 0, 0], max: [stockLength, 0, 0] },
      meshRadialMax: 0,
      meshRadialMin: 0,
      warnings: []
    },
    machXStartMm,
    machXEndMm,
    contourPoints: ax4.contourPoints,
    indexAnglesDeg: ax4.indexAnglesDeg,
    aAxisRangeDeg: job.machine.aAxisRangeDeg,
    zPassMm: normZPass
  })
  if (validation.ok === false) {
    return { ok: false, error: validation.error, hint: validation.hint }
  }
  const validationWarnings = validation.warnings

  // ── Depth levels ──────────────────────────────────────────────────────────
  const useMeshRadial =
    ax4.useMeshRadialZBands === true && frame != null && frame.meshRadialMax > 0
  const zDepths = computeDepthsMm(
    normZPass,
    zStepMm,
    stockRadius,
    useMeshRadial,
    frame?.meshRadialMax
  )

  // ── Dispatch ──────────────────────────────────────────────────────────────
  const toolDiameterMm = job.toolDiameterMm ?? 3.175
  const finishAllowanceMm =
    ax4.rotaryFinishAllowanceMm != null ? Math.max(0, ax4.rotaryFinishAllowanceMm) : undefined
  const overcutMm = ax4.overcutMm
  const maxCells =
    ax4.cylindricalRasterMaxCells != null
      ? Math.min(500_000, Math.floor(ax4.cylindricalRasterMaxCells))
      : 250_000
  const adaptive = ax4.adaptiveRefinement === true
  const maxZMm = job.machine.workAreaMm?.z

  let lines: string[]
  let stratWarnings: string[]

  switch (opKind) {
    case 'cnc_4axis_roughing': {
      const r = generateRoughing({
        triangles: frame!.triangles,
        cylinderDiameterMm: stockDiameter,
        machXStartMm,
        machXEndMm,
        stepoverDeg,
        stepXMm: Math.max(0.25, job.stepoverMm),
        zDepthsMm: zDepths,
        feedMmMin: job.feedMmMin,
        plungeMmMin: job.plungeMmMin,
        safeZMm: job.safeZMm,
        finishAllowanceMm,
        maxCells,
        toolDiameterMm,
        overcutMm,
        maxZMm,
        maxRotaryRpm: job.machine.maxRotaryRpm,
        adaptiveRefinement: adaptive
      })
      lines = r.lines
      stratWarnings = r.warnings
      break
    }
    case 'cnc_4axis_finishing': {
      const finishDepth = zDepths[zDepths.length - 1]!
      const r = generateFinishing({
        triangles: frame!.triangles,
        cylinderDiameterMm: stockDiameter,
        machXStartMm,
        machXEndMm,
        stepoverDeg,
        finishStepoverDeg: ax4.finishStepoverDeg,
        stepXMm: Math.max(0.25, job.stepoverMm),
        finishDepthMm: finishDepth,
        feedMmMin: job.feedMmMin,
        plungeMmMin: job.plungeMmMin,
        safeZMm: job.safeZMm,
        finishAllowanceMm: 0,
        maxCells,
        toolDiameterMm,
        overcutMm,
        maxZMm,
        maxRotaryRpm: job.machine.maxRotaryRpm,
        adaptiveRefinement: adaptive
      })
      lines = r.lines
      stratWarnings = r.warnings
      break
    }
    case 'cnc_4axis_continuous': {
      const r = generateContinuous({
        triangles: frame!.triangles,
        cylinderDiameterMm: stockDiameter,
        machXStartMm,
        machXEndMm,
        stepoverDeg,
        finishStepoverDeg: ax4.finishStepoverDeg,
        stepXMm: Math.max(0.25, job.stepoverMm),
        zDepthsMm: zDepths,
        feedMmMin: job.feedMmMin,
        plungeMmMin: job.plungeMmMin,
        safeZMm: job.safeZMm,
        finishAllowanceMm,
        maxCells,
        toolDiameterMm,
        overcutMm,
        maxZMm,
        maxRotaryRpm: job.machine.maxRotaryRpm,
        adaptiveRefinement: adaptive
      })
      lines = r.lines
      stratWarnings = r.warnings
      break
    }
    case 'cnc_4axis_contour': {
      const r = generateContour({
        contourPoints: ax4.contourPoints!,
        cylinderDiameterMm: stockDiameter,
        machXStartMm,
        machXEndMm,
        zDepthsMm: zDepths,
        feedMmMin: job.feedMmMin,
        plungeMmMin: job.plungeMmMin,
        safeZMm: job.safeZMm,
        toolDiameterMm,
        maxZMm,
        maxRotaryRpm: job.machine.maxRotaryRpm
      })
      lines = r.lines
      stratWarnings = r.warnings
      break
    }
    case 'cnc_4axis_indexed': {
      const r = generateIndexed({
        indexAnglesDeg: ax4.indexAnglesDeg!,
        cylinderDiameterMm: stockDiameter,
        machXStartMm,
        machXEndMm,
        zDepthsMm: zDepths,
        feedMmMin: job.feedMmMin,
        plungeMmMin: job.plungeMmMin,
        safeZMm: job.safeZMm,
        toolDiameterMm,
        overcutMm,
        maxZMm,
        maxRotaryRpm: job.machine.maxRotaryRpm
      })
      lines = r.lines
      stratWarnings = r.warnings
      break
    }
    default: {
      // No mesh and no specific kind matched — fall back to pattern parallel.
      const r = generatePattern({
        cylinderDiameterMm: stockDiameter,
        machXStartMm,
        machXEndMm,
        zDepthsMm: zDepths,
        stepoverDeg,
        feedMmMin: job.feedMmMin,
        plungeMmMin: job.plungeMmMin,
        safeZMm: job.safeZMm,
        toolDiameterMm,
        overcutMm,
        maxZMm,
        maxRotaryRpm: job.machine.maxRotaryRpm
      })
      lines = r.lines
      stratWarnings = r.warnings
      break
    }
  }

  if (lines.length === 0) {
    return {
      ok: false,
      error: '4-axis toolpath is empty.',
      hint: 'Check zPassMm, stepover, and stock diameter; verify the mesh sits within the stock cylinder.'
    }
  }

  // ── Post-process ──────────────────────────────────────────────────────────
  const postResult = await renderPost(job.resourcesRoot, job.machine, lines, {
    workCoordinateIndex: job.workCoordinateIndex,
    operationLabel: job.operationLabel ?? opKind,
    toolNumber: job.toolSlot,
    ...extractPostProcessingOpts(job.operationParams)
  })
  const gcode = postResult.gcode
  await writeFile(job.outputGcodePath, gcode, 'utf-8')

  // ── Hint composition ──────────────────────────────────────────────────────
  let alignHint = ''
  if (frame != null && frame.bbox.max[0] > frame.bbox.min[0]) {
    const h = rotaryMeshStockAlignmentHint({
      stockLengthMm: stockLength,
      meshMinX: frame.bbox.min[0],
      meshMaxX: frame.bbox.max[0]
    })
    if (h) alignHint = ` ${h}`
  }
  if (meshTruncated) {
    alignHint += ' Mesh was truncated to 500k triangles — simplify the model for full coverage.'
  }

  const hint =
    `4-axis toolpath (${opKind}) posted. ${UNVERIFIED}` +
    envelopeHint(job.machine, gcode, stockDiameter) +
    alignHint

  const allWarnings = [...validationWarnings, ...stratWarnings, ...postResult.warnings]

  return {
    ok: true,
    gcode,
    usedEngine: 'builtin',
    engine: { requestedEngine: 'builtin', usedEngine: 'builtin', fallbackApplied: false },
    hint,
    ...(allWarnings.length > 0 ? { warnings: allWarnings } : {})
  }
}
