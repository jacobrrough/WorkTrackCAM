import type { ManufactureSetup } from './manufacture-schema'

/**
 * Safe Z (mm above stock / clearance plane) from nominal stock thickness.
 * WCS convention: Z0 = top of stock; safe height should clear fixtures and top face.
 */
export function recommendedSafeZFromStockThicknessMm(stockZMm: number): number {
  const z = Math.max(0.01, stockZMm)
  return Math.min(30, Math.max(4, 4 + z * 0.08))
}

/** Gap (mm) between lowest mesh Z and stock bottom when both are in CAM WCS (top of stock = Z0, cuts negative). */
export function rasterRestGapFromStockAndMeshMinZ(stockZMm: number, meshMinZMm: number): number | undefined {
  if (!(stockZMm > 0) || !Number.isFinite(meshMinZMm)) return undefined
  const gap = meshMinZMm + stockZMm
  return gap > 0.02 ? gap : undefined
}

export type SetupStockLike = NonNullable<ManufactureSetup['stock']>

/** True if setup stock has usable box/cylinder dimensions for CAM defaults. */
export function setupStockHasDims(stock: SetupStockLike | undefined): stock is SetupStockLike {
  if (!stock) return false
  if (stock.kind === 'fromExtents') return false
  const xz = stock.x != null && stock.x > 0 && stock.z != null && stock.z > 0
  const xy = stock.x != null && stock.x > 0 && stock.y != null && stock.y > 0
  return xz || xy
}

export function setupStockThicknessZMm(stock: SetupStockLike | undefined): number | undefined {
  if (!stock || stock.kind === 'fromExtents') return undefined
  if (typeof stock.z === 'number' && Number.isFinite(stock.z) && stock.z > 0) return stock.z
  return undefined
}

/**
 * Rotary stock length (along X) and diameter for 4-axis when manufacture setup uses box/cylinder dims.
 * Shop convention: stock X = length along rotation axis, Y = diameter.
 */
export function rotaryDimsFromSetupStock(stock: SetupStockLike | undefined): {
  lengthMm?: number
  diameterMm?: number
} {
  if (!stock || stock.kind === 'fromExtents') return {}
  if (stock.kind === 'cylinder' || stock.kind === 'box') {
    const x = typeof stock.x === 'number' && stock.x > 0 ? stock.x : undefined
    const y = typeof stock.y === 'number' && stock.y > 0 ? stock.y : undefined
    return { lengthMm: x, diameterMm: y }
  }
  return {}
}

/**
 * Machinable axial interval [start, end] mm along X from the stock left face (WCS).
 * Matches the 4-axis engine's machinable X span (`src/main/cam-axis4/`) and
 * Shop rig coloring.
 */
export function rotaryMachinableXSpanMm(
  stockLengthMm: number,
  chuckDepthMm: number,
  clampOffsetMm: number
): { machXStartMm: number; machXEndMm: number } {
  const sl = Math.max(0, stockLengthMm)
  const ck = Math.max(0, chuckDepthMm)
  const off = Math.max(0, clampOffsetMm)
  const clampLen = Math.max(0, Math.min(ck, sl * 0.6))
  const offsetLen = Math.max(0, Math.min(off, Math.max(0, sl - clampLen - 1)))
  const machXStartMm = clampLen + offsetLen
  const machXEndMm = sl
  return { machXStartMm, machXEndMm }
}

/**
 * Heuristic: STL X extent vs stock length — warns when mesh likely not aligned to rotary WCS.
 */
export function rotaryMeshStockAlignmentHint(params: {
  stockLengthMm: number
  meshMinX: number
  meshMaxX: number
}): string | undefined {
  const { stockLengthMm, meshMinX, meshMaxX } = params
  if (!(stockLengthMm > 0) || !(meshMaxX > meshMinX)) return undefined
  const overlapLen = Math.max(
    0,
    Math.min(meshMaxX, stockLengthMm) - Math.max(meshMinX, 0)
  )
  // Origin-centered CAD exports often span X<0; stock along the bar is [0, length]. If +X extent
  // stays in the first half of stock while the mesh reaches clearly negative X, alignment is suspect.
  const minNegExtent = Math.min(10, stockLengthMm * 0.15)
  if (
    meshMinX < -minNegExtent &&
    meshMaxX < stockLengthMm * 0.5 &&
    overlapLen > 1
  ) {
    return `Rotary WCS hint: STL X span [${meshMinX.toFixed(1)}, ${meshMaxX.toFixed(
      1
    )}] mm vs stock length ${stockLengthMm.toFixed(1)} mm — mesh may be centered in CAD while stock zero is the left face. Align export/placement or disable STL X clamp (see docs/CAM_4TH_AXIS_REFERENCE.md).`
  }
  return undefined
}

/** Map Shop job stock to manufacture-style setup for `resolveCamCutParams*` safe-Z defaults. */
export function shopJobStockAsCamSetup(stock: {
  x: number
  y: number
  z: number
}): Pick<ManufactureSetup, 'stock'> {
  return {
    stock: {
      kind: 'box',
      x: stock.x,
      y: stock.y,
      z: stock.z
    }
  }
}

/**
 * Suggested single-pass Z depth (mm, negative into stock from Z0 top) from nominal stock thickness vs STL min Z,
 * when WCS aligns (Z0 = stock top, mesh Z negative below top). Opt-in via `autoDocFromSetupMesh` on the op.
 */
export function suggestedZPassMmFromStockAndMeshMinZ(stockZMm: number, meshMinZMm: number): number | undefined {
  if (!(stockZMm > 0) || !Number.isFinite(meshMinZMm) || meshMinZMm >= -1e-6) return undefined
  const depth = Math.min(stockZMm, -meshMinZMm)
  if (depth < 0.5) return undefined
  return -Math.min(depth, stockZMm)
}
