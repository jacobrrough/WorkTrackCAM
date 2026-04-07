import type { ManufactureFile, ManufactureOperation, ManufactureSetup } from './manufacture-schema'
import { recommendedSafeZFromStockThicknessMm, setupStockThicknessZMm } from './cam-setup-defaults'
import { calcCutParams, type MaterialRecord } from './material-schema'
import type { ToolRecord } from './tool-schema'
import { CAM_FEED_PLUNGE_FLOOR_MM_MIN } from './cam-numeric-floors'

/** Matches previous hardcoded `cam:run` values from the Make tab. */
export const CAM_CUT_DEFAULTS = {
  zPassMm: 5,
  stepoverMm: 2,
  feedMmMin: 1200,
  plungeMmMin: 400,
  safeZMm: 10
} as const

export type CamCutParamsResolved = {
  zPassMm: number
  stepoverMm: number
  feedMmMin: number
  plungeMmMin: number
  safeZMm: number
}

type CamMaterialCutInput = {
  operation: ManufactureOperation | undefined
  materialId: string | null | undefined
  materials: MaterialRecord[]
  tools: ToolRecord[]
  /** Manufacture setup stock drives default safe Z when op omits `safeZMm`. */
  setup?: Pick<ManufactureSetup, 'stock'> | undefined
}

function finiteNonZeroNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v) && v !== 0) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number.parseFloat(v)
    if (Number.isFinite(n) && n !== 0) return n
  }
  return undefined
}

function finitePositiveNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number.parseFloat(v)
    if (Number.isFinite(n) && n > 0) return n
  }
  return undefined
}

/**
 * Cutting parameters for `cam:run` / OCL config from `manufacture.json` operation `params`.
 * Used for all CNC kinds, including catalog labels “3D” that still map to 2D contour/pocket (`cnc_contour` / `cnc_pocket`).
 * Unknown or invalid fields fall back to {@link CAM_CUT_DEFAULTS}.
 * When `setup` includes **box/cylinder** stock with **Z height**, `safeZMm` defaults from stock thickness if the op omits `safeZMm`.
 */
export function resolveCamCutParams(
  operation: ManufactureOperation | undefined,
  setup?: Pick<ManufactureSetup, 'stock'> | undefined
): CamCutParamsResolved {
  const p = operation?.params
  const stockZ = setupStockThicknessZMm(setup?.stock)
  const defaultSafeZ =
    stockZ != null ? recommendedSafeZFromStockThicknessMm(stockZ) : CAM_CUT_DEFAULTS.safeZMm

  if (!p || typeof p !== 'object') {
    return { ...CAM_CUT_DEFAULTS, safeZMm: defaultSafeZ }
  }

  return {
    zPassMm: finiteNonZeroNumber(p['zPassMm']) ?? CAM_CUT_DEFAULTS.zPassMm,
    stepoverMm: finitePositiveNumber(p['stepoverMm']) ?? CAM_CUT_DEFAULTS.stepoverMm,
    feedMmMin: Math.max(CAM_FEED_PLUNGE_FLOOR_MM_MIN, finitePositiveNumber(p['feedMmMin']) ?? CAM_CUT_DEFAULTS.feedMmMin),
    plungeMmMin: Math.max(CAM_FEED_PLUNGE_FLOOR_MM_MIN, finitePositiveNumber(p['plungeMmMin']) ?? CAM_CUT_DEFAULTS.plungeMmMin),
    safeZMm: finitePositiveNumber(p['safeZMm']) ?? defaultSafeZ
  }
}

function resolvePositiveNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number.parseFloat(v)
    if (Number.isFinite(n) && n > 0) return n
  }
  return undefined
}

function resolveOperationToolDiameterMm(operation: ManufactureOperation | undefined, tools: ToolRecord[]): number {
  const p = operation?.params
  if (p && typeof p === 'object') {
    const explicit = resolvePositiveNumber(p['toolDiameterMm'])
    if (explicit != null) return explicit
    const toolId = typeof p['toolId'] === 'string' ? p['toolId'].trim() : ''
    if (toolId) {
      const byId = tools.find((t) => t.id === toolId)
      if (byId) return byId.diameterMm
    }
  }
  return 6
}

function resolveOperationFluteCount(operation: ManufactureOperation | undefined, tools: ToolRecord[]): number {
  const p = operation?.params
  if (p && typeof p === 'object') {
    const toolId = typeof p['toolId'] === 'string' ? p['toolId'].trim() : ''
    if (toolId) {
      const byId = tools.find((t) => t.id === toolId)
      const fc = byId?.fluteCount
      if (typeof fc === 'number' && Number.isFinite(fc) && fc > 0) return fc
    }
    const explicitDiameter = resolvePositiveNumber(p['toolDiameterMm'])
    if (explicitDiameter != null) {
      const byDiameter = tools.find((t) => Math.abs(t.diameterMm - explicitDiameter) < 0.001)
      const fc = byDiameter?.fluteCount
      if (typeof fc === 'number' && Number.isFinite(fc) && fc > 0) return fc
    }
  }
  return 2
}

/**
 * Resolves final CAM cut parameters and optionally overrides feed/plunge/stepover/z-pass
 * from a selected material record.
 */
export function resolveCamCutParamsWithMaterial(input: CamMaterialCutInput): CamCutParamsResolved {
  const base = resolveCamCutParams(input.operation, input.setup)
  const materialId = input.materialId?.trim()
  if (!materialId) return base
  const material = input.materials.find((m) => m.id === materialId)
  if (!material) return base
  const toolDiameterMm = resolveOperationToolDiameterMm(input.operation, input.tools)
  const fluteCount = resolveOperationFluteCount(input.operation, input.tools)
  const derived = calcCutParams(material, toolDiameterMm, fluteCount, 'default')
  return {
    ...base,
    zPassMm: derived.zPassMm,
    stepoverMm: derived.stepoverMm,
    feedMmMin: derived.feedMmMin,
    plungeMmMin: derived.plungeMmMin
  }
}

/**
 * Same setup resolution as Make → Generate CAM (`cam:run`): prefer a setup whose `machineId`
 * matches the CNC machine used for the run, else first setup.
 */
/**
 * Tighter stepover for `cnc_pencil` (rest / cleanup raster intent).
 * Uses optional `pencilStepoverMm`, else `pencilStepoverFactor` × base stepover (default 0.22), clamped to tool Ø.
 */
export function resolvePencilStepoverMm(input: {
  baseStepoverMm: number
  toolDiameterMm: number
  operationParams?: Record<string, unknown>
}): number {
  const p = input.operationParams ?? {}
  const toolD = Math.max(0.1, input.toolDiameterMm)
  const explicit = finitePositiveNumber(p['pencilStepoverMm'])
  if (explicit != null) {
    return Math.min(Math.max(explicit, 0.05), toolD * 0.49)
  }
  const rawFactor = p['pencilStepoverFactor']
  let factor = 0.22
  if (typeof rawFactor === 'number' && Number.isFinite(rawFactor)) {
    factor = Math.min(1, Math.max(0.05, rawFactor))
  } else if (typeof rawFactor === 'string' && rawFactor.trim() !== '') {
    const n = Number.parseFloat(rawFactor)
    if (Number.isFinite(n)) factor = Math.min(1, Math.max(0.05, n))
  }
  const scaled = input.baseStepoverMm * factor
  return Math.min(Math.max(scaled, 0.05), toolD * 0.49)
}

/**
 * Radial engagement angle (degrees) from tool radius and stepover.
 * θ = 2 · arccos(1 − stepover/radius).  Returns 180 for full slotting, 0 for no cut.
 */
export function computeEngagementAngleDeg(toolRadiusMm: number, stepoverMm: number): number {
  if (toolRadiusMm <= 0 || stepoverMm <= 0) return 0
  const ratio = stepoverMm / toolRadiusMm
  if (ratio >= 2) return 180
  const cosVal = Math.max(-1, Math.min(1, 1 - ratio))
  return (2 * Math.acos(cosVal) * 180) / Math.PI
}

/**
 * Chip-thinning feed compensation.
 * When radial engagement < target (typically 90°), the chip thins — increase feed
 * to maintain effective chip load. Clamped to [50%, 200%] of base feed.
 */
export function adjustFeedForEngagement(
  baseFeedMmMin: number,
  actualEngagementDeg: number,
  targetEngagementDeg = 90
): number {
  if (actualEngagementDeg <= 0) return baseFeedMmMin
  const targetFactor = Math.sin((targetEngagementDeg * Math.PI) / 360)
  const actualFactor = Math.max(0.1, Math.sin((actualEngagementDeg * Math.PI) / 360))
  const adjusted = baseFeedMmMin * (targetFactor / actualFactor)
  return Math.max(baseFeedMmMin * 0.5, Math.min(adjusted, baseFeedMmMin * 2))
}

/**
 * Resolve raster scan angle from operation params.
 * `scanAngleDeg` takes precedence over `rasterAngleDeg` when present.
 * Default is 0 (X-aligned / Y-primary scan direction).
 */
export function resolveRasterScanAngleDeg(operationParams?: Record<string, unknown>): number {
  const p = operationParams ?? {}
  const scanAngle = finiteNonZeroNumber(p['scanAngleDeg'])
  if (scanAngle != null) return scanAngle
  const rasterAngle = finiteNonZeroNumber(p['rasterAngleDeg'])
  if (rasterAngle != null) return rasterAngle
  return 0
}

/**
 * Per-pass adaptive feed rate: compute adjusted feed based on local engagement.
 *
 * When the tool encounters more material (higher engagement from deeper cuts),
 * feed is reduced proportionally. When engagement is low (finishing passes
 * at constant depth), feed is allowed to increase for productivity.
 *
 * @param baseFeedMmMin - Nominal programmed feed rate
 * @param prevZ - Z position of previous segment (mm)
 * @param currZ - Z position of current segment (mm)
 * @param toolRadiusMm - Tool radius (mm)
 * @param stepoverMm - Radial stepover (mm)
 * @param zStepMm - Axial depth of cut per level (mm)
 * @param targetEngagementDeg - Target engagement angle (default 90)
 * @returns Adjusted feed rate in mm/min
 */
export function computeAdaptiveFeed(
  baseFeedMmMin: number,
  prevZ: number,
  currZ: number,
  toolRadiusMm: number,
  stepoverMm: number,
  zStepMm: number,
  targetEngagementDeg = 90
): number {
  if (baseFeedMmMin <= 0 || toolRadiusMm <= 0 || stepoverMm <= 0) return baseFeedMmMin

  // Base radial engagement from stepover
  const baseEngagement = computeEngagementAngleDeg(toolRadiusMm, stepoverMm)

  // Z-change modulation: descending = more material
  const dz = prevZ - currZ
  const effectiveZStep = zStepMm > 0 ? zStepMm : 1.0
  const zFactor = Math.max(0, Math.min(1, dz / effectiveZStep))

  // Axial contribution when descending (up to 30 deg extra)
  const localEngagement = Math.min(180, baseEngagement + zFactor * 30)

  if (localEngagement <= 0) return baseFeedMmMin * 1.5

  const adjusted = adjustFeedForEngagement(baseFeedMmMin, localEngagement, targetEngagementDeg)
  return Math.max(baseFeedMmMin * 0.5, Math.min(adjusted, baseFeedMmMin * 1.5))
}

export function resolveManufactureSetupForCam(
  mfg: Pick<ManufactureFile, 'setups'>,
  cncMachineId: string | undefined
): ManufactureSetup | undefined {
  if (mfg.setups.length === 0) return undefined
  if (cncMachineId) {
    const hit = mfg.setups.find((s) => s.machineId === cncMachineId)
    if (hit) return hit
  }
  return mfg.setups[0]
}

/**
 * Merges material-derived cutting parameters (feed, plunge, stepover, zPass) into
 * a new operation's static default params. Used when adding an operation to a job
 * that already has a material selected, so users get material-appropriate starting
 * values instead of generic hardcoded defaults.
 *
 * Preserves all other fields in `baseParams` (e.g. `toolDiameterMm`, `safeZMm`,
 * `indexAnglesDeg`) — only the four cut-motion fields are overridden.
 *
 * Returns `baseParams` unchanged when no material is found or materialId is absent.
 */
export function applyMaterialToNewOpParams(
  baseParams: Record<string, unknown>,
  context: {
    materialId: string | null | undefined
    materials: MaterialRecord[]
    tools: ToolRecord[]
  }
): Record<string, unknown> {
  const { materialId, materials, tools } = context
  if (!materialId) return baseParams
  const material = materials.find((m) => m.id === materialId)
  if (!material) return baseParams

  // Use the tool diameter embedded in the static defaults for this op kind.
  // Falls back to 6mm (the most common default across all op kinds).
  const toolDiameterMm = resolvePositiveNumber(baseParams['toolDiameterMm']) ?? 6

  // Resolve flute count: prefer a library tool matching the diameter, default 2.
  let fluteCount = 2
  const byDiameter = tools.find((t) => Math.abs(t.diameterMm - toolDiameterMm) < 0.001)
  if (byDiameter?.fluteCount != null && byDiameter.fluteCount > 0) {
    fluteCount = byDiameter.fluteCount
  }

  const derived = calcCutParams(material, toolDiameterMm, fluteCount, 'default')

  return {
    ...baseParams,
    feedMmMin: derived.feedMmMin,
    plungeMmMin: derived.plungeMmMin,
    stepoverMm: derived.stepoverMm,
    zPassMm: derived.zPassMm,
  }
}
