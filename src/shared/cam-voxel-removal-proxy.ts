import type { ToolpathSegment3 } from './cam-gcode-toolpath'

export type BuildVoxelRemovalOptions = {
  toolRadiusMm: number
  maxCols?: number
  maxRows?: number
  maxLayers?: number
  stockTopZ?: number
  /**
   * When set (mm, CNC Z), extends the carved stock block downward to this Z so the voxel grid
   * includes nominal rectangular stock below the toolpath (WCS: top of stock = `stockTopZ`, typical cut Z negative).
   */
  stockBottomZ?: number
  /** Expand XY voxel bounds to include nominal rectangular stock (WCS mm). */
  stockRectXYMm?: { minX: number; maxX: number; minY: number; maxY: number }
  cuttingZThreshold?: number
  marginMm?: number
  /** Cap total sphere stamps (performance). */
  maxStamps?: number
  /** Max points in `samplePositions` for visualization (×3 floats). */
  maxSamplePoints?: number
  /**
   * Tool shape for voxel carving accuracy.
   * - `'flat'` (default): cylindrical flat end mill — carves by XY radial distance only
   *   (correct swept volume for vertical cutting passes).
   * - `'ball'`: ball-end mill — carves by full 3D Euclidean distance (hemisphere envelope).
   */
  toolShape?: 'flat' | 'ball'
}

/** Tier-3 voxel sim quality presets (grid resolution + stamp budget). Not boolean-exact. */
export type VoxelSimQualityPreset = 'fast' | 'balanced' | 'detailed'

export const VOXEL_SIM_QUALITY_PRESETS: Record<
  VoxelSimQualityPreset,
  Pick<BuildVoxelRemovalOptions, 'maxCols' | 'maxRows' | 'maxLayers' | 'maxStamps' | 'maxSamplePoints'>
> = {
  fast: { maxCols: 22, maxRows: 22, maxLayers: 14, maxStamps: 3500, maxSamplePoints: 1400 },
  balanced: { maxCols: 34, maxRows: 34, maxLayers: 20, maxStamps: 8000, maxSamplePoints: 2400 },
  detailed: { maxCols: 44, maxRows: 44, maxLayers: 28, maxStamps: 14000, maxSamplePoints: 4200 }
}

export type VoxelRemovalPreview = {
  cols: number
  rows: number
  layers: number
  cellMm: number
  originX: number
  originY: number
  zBottom: number
  stockTopZ: number
  stockVoxelCount: number
  carvedVoxelCount: number
  approxRemovedVolumeMm3: number
  /** Flat xyz… carved voxel centers (subset). */
  samplePositions: Float32Array
  stampsCapped: boolean
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

function index3(i: number, j: number, k: number, cols: number, rows: number): number {
  return k * cols * rows + j * cols + i
}

/**
 * Tier-3 experimental preview: coarse voxel stock, carved by tool stamps along cutting feeds.
 * Flat end mills use cylinder stamps (XY radial distance); ball-end mills use sphere stamps
 * (3D Euclidean distance). Not swept-volume exact; not collision-safe.
 */
export function buildVoxelRemovalFromCuttingSegments(
  segments: ReadonlyArray<ToolpathSegment3>,
  opts: BuildVoxelRemovalOptions
): VoxelRemovalPreview | null {
  const toolR = Math.max(0.05, opts.toolRadiusMm)
  const toolShape = opts.toolShape ?? 'flat'
  const maxCols = opts.maxCols ?? 36
  const maxRows = opts.maxRows ?? 36
  const maxLayers = opts.maxLayers ?? 22
  const stockTopZ = opts.stockTopZ ?? 0
  const cuttingZThreshold = opts.cuttingZThreshold ?? 0.08
  const marginMm = opts.marginMm ?? toolR + 1.5
  const maxStamps = opts.maxStamps ?? 9000
  const maxSamplePoints = opts.maxSamplePoints ?? 2600

  const cutting = segments.filter(
    (s) =>
      s.kind === 'feed' &&
      (Math.min(s.z0, s.z1) < cuttingZThreshold || Math.max(s.z0, s.z1) < cuttingZThreshold)
  )
  if (cutting.length === 0) return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let minZ = Infinity
  for (const s of cutting) {
    minX = Math.min(minX, s.x0, s.x1)
    minY = Math.min(minY, s.y0, s.y1)
    maxX = Math.max(maxX, s.x0, s.x1)
    maxY = Math.max(maxY, s.y0, s.y1)
    minZ = Math.min(minZ, s.z0, s.z1)
  }
  minX -= marginMm
  minY -= marginMm
  maxX += marginMm
  maxY += marginMm
  const rect = opts.stockRectXYMm
  if (
    rect &&
    Number.isFinite(rect.minX) &&
    Number.isFinite(rect.maxX) &&
    Number.isFinite(rect.minY) &&
    Number.isFinite(rect.maxY) &&
    rect.maxX > rect.minX &&
    rect.maxY > rect.minY
  ) {
    minX = Math.min(minX, rect.minX - marginMm)
    maxX = Math.max(maxX, rect.maxX + marginMm)
    minY = Math.min(minY, rect.minY - marginMm)
    maxY = Math.max(maxY, rect.maxY + marginMm)
  }
  let zBottom = Math.min(minZ - marginMm, stockTopZ - toolR * 2)
  if (opts.stockBottomZ != null && Number.isFinite(opts.stockBottomZ)) {
    zBottom = Math.min(zBottom, opts.stockBottomZ)
  }

  const spanX = maxX - minX
  const spanY = maxY - minY
  const spanZ = Math.max(stockTopZ - zBottom, toolR * 2)
  if (!(spanX > 1e-6) || !(spanY > 1e-6) || !(spanZ > 1e-6)) return null

  let cellMm = Math.max(spanX / maxCols, spanY / maxRows, spanZ / maxLayers, 0.12)
  let cols = clamp(Math.ceil(spanX / cellMm), 2, maxCols)
  let rows = clamp(Math.ceil(spanY / cellMm), 2, maxRows)
  let layers = clamp(Math.ceil(spanZ / cellMm), 2, maxLayers)

  cellMm = Math.max(spanX / cols, spanY / rows, spanZ / layers, 0.12)

  const originX = minX
  const originY = minY

  const solid = new Uint8Array(cols * rows * layers)
  let stockVoxelCount = 0
  for (let k = 0; k < layers; k++) {
    const cz = zBottom + (k + 0.5) * cellMm
    if (cz > stockTopZ + 1e-9) continue
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const idx = index3(i, j, k, cols, rows)
        solid[idx] = 1
        stockVoxelCount++
      }
    }
  }

  const samplePositions = new Float32Array(maxSamplePoints * 3)
  let sampleCount = 0
  let stamps = 0
  let stampsCapped = false

  const tryRecordSample = (vx: number, vy: number, vz: number): void => {
    if (sampleCount >= maxSamplePoints) return
    const o = sampleCount * 3
    samplePositions[o] = vx
    samplePositions[o + 1] = vy
    samplePositions[o + 2] = vz
    sampleCount++
  }

  for (const s of cutting) {
    const len = Math.hypot(s.x1 - s.x0, s.y1 - s.y0, s.z1 - s.z0)
    const step = Math.max(cellMm * 0.35, 0.08)
    const nSeg = Math.max(1, Math.ceil(len / step))
    for (let t = 0; t <= nSeg; t++) {
      if (stamps >= maxStamps) {
        stampsCapped = true
        break
      }
      stamps++
      const u = t / nSeg
      const cx = s.x0 + u * (s.x1 - s.x0)
      const cy = s.y0 + u * (s.y1 - s.y0)
      const cz = s.z0 + u * (s.z1 - s.z0)
      const rCells = Math.ceil((toolR + cellMm * 0.5) / cellMm) + 1
      const ic = Math.floor((cx - originX) / cellMm)
      const jc = Math.floor((cy - originY) / cellMm)
      const kc = Math.floor((cz - zBottom) / cellMm)
      for (let dk = -rCells; dk <= rCells; dk++) {
        for (let dj = -rCells; dj <= rCells; dj++) {
          for (let di = -rCells; di <= rCells; di++) {
            const i = ic + di
            const j = jc + dj
            const kk = kc + dk
            if (i < 0 || j < 0 || kk < 0 || i >= cols || j >= rows || kk >= layers) continue
            const vx = originX + (i + 0.5) * cellMm
            const vy = originY + (j + 0.5) * cellMm
            const vz = zBottom + (kk + 0.5) * cellMm
            if (vz > stockTopZ + 1e-9) continue
            // Flat end mill: cylinder stamp — XY radial distance only (correct for vertical passes).
            // Ball end mill: sphere stamp — full 3D Euclidean distance (hemisphere envelope).
            const inTool =
              toolShape === 'ball'
                ? Math.hypot(vx - cx, vy - cy, vz - cz) <= toolR + 1e-6
                : Math.hypot(vx - cx, vy - cy) <= toolR + 1e-6
            if (!inTool) continue
            const idx = index3(i, j, kk, cols, rows)
            if (solid[idx]) {
              solid[idx] = 0
              tryRecordSample(vx, vy, vz)
            }
          }
        }
      }
    }
    if (stampsCapped) break
  }

  let remaining = 0
  for (let i = 0; i < solid.length; i++) {
    if (solid[i]) remaining++
  }
  const carvedVoxelCount = stockVoxelCount - remaining
  const vol = cellMm * cellMm * cellMm
  const approxRemovedVolumeMm3 = carvedVoxelCount * vol

  return {
    cols,
    rows,
    layers,
    cellMm,
    originX,
    originY,
    zBottom,
    stockTopZ,
    stockVoxelCount,
    carvedVoxelCount,
    approxRemovedVolumeMm3,
    samplePositions: samplePositions.subarray(0, sampleCount * 3),
    stampsCapped
  }
}
