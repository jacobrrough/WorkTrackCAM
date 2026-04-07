/**
 * Stock Fit Engine — computes optimal orientation and uniform scale
 * to maximize a model's size within stock geometry.
 *
 * Supports:
 * - Flat rectangular stock (3-axis CNC / FDM)
 * - Cylindrical rotary stock (4/5-axis CNC, round bar)
 * - Square-bar rotary stock (4/5-axis CNC, square cross-section)
 *
 * Algorithm: sweep candidate orientations (Euler angles in steps),
 * compute the maximum uniform scale for each, pick the orientation
 * that yields the largest model.
 *
 * Coordinate conventions match ShopModelViewer applyTransform:
 *   Three.js X = model X               (t.position.x)
 *   Three.js Y = model Z               (t.position.z, t.scale.z)
 *   Three.js Z = model Y               (t.position.y, t.scale.y)
 *
 * For 4-axis: rotation axis runs along Three.js X, centered at origin.
 */

// ── Public types ──────────────────────────────────────────────────────

export interface StockFitResult {
  position: { x: number; y: number; z: number }
  rotation: { x: number; y: number; z: number }
  scale: { x: number; y: number; z: number }
  /** The achieved uniform scale factor (higher = bigger model). */
  fitScale: number
}

// ── Angular sweep resolution (degrees) ────────────────────────────────

/** Cylindrical / square-bar: sweep ry & rz in this step. 5 deg = 19×19 = 361 orientations. */
const ROT_STEP = 5

/** Flat: sweep all three axes. 15 degrees = 7×7×7 = 343 orientations. */
const FLAT_STEP = 15

// ── Internal helpers ──────────────────────────────────────────────────

const DEG_TO_RAD = Math.PI / 180

/**
 * Rotate all 8 box corners and return per-axis extrema in Three.js space.
 *
 * Rotation convention mirrors `computeModelCornerWorldPointsInThreeJS`:
 *   ex = rotation.x,  ey = rotation.z,  ez = rotation.y
 *   Applied Z → Y → X intrinsic.
 *
 * Returns maxAbsX (half axial extent), maxAbsY, maxAbsZ, and maxRadSq.
 */
function rotatedBoxExtrema(
  wx: number,
  wy: number,
  wz: number,
  rx: number,
  ry: number,
  rz: number
): { maxAbsX: number; maxAbsY: number; maxAbsZ: number; maxRadSq: number } {
  const ex = rx * DEG_TO_RAD
  const ey = rz * DEG_TO_RAD // model Z rotation → Three.js Y
  const ez = ry * DEG_TO_RAD // model Y rotation → Three.js Z

  const cX = Math.cos(ex),
    sX = Math.sin(ex)
  const cY = Math.cos(ey),
    sY = Math.sin(ey)
  const cZ = Math.cos(ez),
    sZ = Math.sin(ez)

  const hx = wx / 2,
    hy = wy / 2,
    hz = wz / 2
  let maxAbsX = 0,
    maxAbsY = 0,
    maxAbsZ = 0,
    maxRadSq = 0

  for (const signX of [-1, 1] as const) {
    for (const signY of [-1, 1] as const) {
      for (const signZ of [-1, 1] as const) {
        const x = signX * hx,
          y = signY * hy,
          z = signZ * hz

        // Z rotation
        const x1 = x * cZ - y * sZ
        const y1 = x * sZ + y * cZ
        const z1 = z

        // Y rotation
        const x2 = x1 * cY + z1 * sY
        const y2 = y1
        const z2 = -x1 * sY + z1 * cY

        // X rotation (x3 = x2 unchanged)
        const y3 = y2 * cX - z2 * sX
        const z3 = y2 * sX + z2 * cX

        maxAbsX = Math.max(maxAbsX, Math.abs(x2))
        maxAbsY = Math.max(maxAbsY, Math.abs(y3))
        maxAbsZ = Math.max(maxAbsZ, Math.abs(z3))
        maxRadSq = Math.max(maxRadSq, y3 * y3 + z3 * z3)
      }
    }
  }

  return { maxAbsX, maxAbsY, maxAbsZ, maxRadSq }
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Find the orientation and uniform scale that maximises a model inside
 * a cylindrical rotary stock (round bar).
 *
 * Radial constraint: max corner distance from X axis ≤ diameter / 2.
 */
export function fitCylindrical(
  modelSz: { x: number; y: number; z: number },
  stockLenMm: number,
  stockDiaMm: number,
  chuckDepthMm = 0,
  clampOffsetMm = 0
): StockFitResult {
  const unusable = chuckDepthMm + clampOffsetMm
  const usableLen = Math.max(1, stockLenMm - unusable)
  const xCenter = unusable / 2
  const R = stockDiaMm / 2

  let bestScale = -1
  let bestRot = { x: 0, y: 0, z: 0 }

  for (let ry = 0; ry <= 90; ry += ROT_STEP) {
    for (let rz = 0; rz <= 90; rz += ROT_STEP) {
      const { maxAbsX, maxRadSq } = rotatedBoxExtrema(
        modelSz.x,
        modelSz.y,
        modelSz.z,
        0,
        ry,
        rz
      )
      const axialExtent = maxAbsX * 2
      const maxRadius = Math.sqrt(maxRadSq)
      if (axialExtent < 1e-9 || maxRadius < 1e-9) continue
      const s = Math.min(usableLen / axialExtent, R / maxRadius)
      if (s > bestScale) {
        bestScale = s
        bestRot = { x: 0, y: ry, z: rz }
      }
    }
  }

  const s = Math.max(0.001, bestScale)
  return {
    position: { x: xCenter, y: 0, z: 0 },
    rotation: bestRot,
    scale: { x: s, y: s, z: s },
    fitScale: s
  }
}

/**
 * Find the orientation and uniform scale that maximises a model inside
 * a square-bar rotary stock.
 *
 * The stock cross-section is a square of side `stockSideMm`.
 * Radial constraint: each model corner's Y and Z must independently
 * stay within ±side/2 (axis-aligned box cross-section, not inscribed circle).
 * This allows larger rectangular models that wouldn't fit a cylinder.
 *
 * @param stockSideMm  Side length of the square cross-section (same input as diameter for cylinder).
 */
export function fitSquareBar(
  modelSz: { x: number; y: number; z: number },
  stockLenMm: number,
  stockSideMm: number,
  chuckDepthMm = 0,
  clampOffsetMm = 0
): StockFitResult {
  const unusable = chuckDepthMm + clampOffsetMm
  const usableLen = Math.max(1, stockLenMm - unusable)
  const xCenter = unusable / 2
  const halfSide = stockSideMm / 2

  let bestScale = -1
  let bestRot = { x: 0, y: 0, z: 0 }

  // For square stock, rotation around the cylinder axis (rx) DOES matter
  // because the square cross-section is not rotationally symmetric.
  // Sweep rx too — a 45° spin can fit a wider model at certain orientations.
  for (let rx = 0; rx <= 45; rx += ROT_STEP) {
    for (let ry = 0; ry <= 90; ry += ROT_STEP) {
      for (let rz = 0; rz <= 90; rz += ROT_STEP) {
        const { maxAbsX, maxAbsY, maxAbsZ } = rotatedBoxExtrema(
          modelSz.x,
          modelSz.y,
          modelSz.z,
          rx,
          ry,
          rz
        )
        const axialExtent = maxAbsX * 2
        if (axialExtent < 1e-9 || maxAbsY < 1e-9 || maxAbsZ < 1e-9) continue
        const sAxial = usableLen / axialExtent
        const sY = halfSide / maxAbsY
        const sZ = halfSide / maxAbsZ
        const s = Math.min(sAxial, sY, sZ)
        if (s > bestScale) {
          bestScale = s
          bestRot = { x: rx, y: ry, z: rz }
        }
      }
    }
  }

  const s = Math.max(0.001, bestScale)
  return {
    position: { x: xCenter, y: 0, z: 0 },
    rotation: bestRot,
    scale: { x: s, y: s, z: s },
    fitScale: s
  }
}

/**
 * Find the orientation and uniform scale that maximises a model inside
 * a flat rectangular stock.
 *
 * Stock mapping to Three.js:
 *   stock.x → Three X extent (width, centered at 0)
 *   stock.y → Three Z extent (depth, centered at 0)
 *   stock.z → Three Y extent (height, bottom at Y=0)
 */
export function fitFlat(
  modelSz: { x: number; y: number; z: number },
  stock: { x: number; y: number; z: number }
): StockFitResult {
  let bestScale = -1
  let bestRot = { x: 0, y: 0, z: 0 }

  for (let rx = 0; rx <= 90; rx += FLAT_STEP) {
    for (let ry = 0; ry <= 90; ry += FLAT_STEP) {
      for (let rz = 0; rz <= 90; rz += FLAT_STEP) {
        const { maxAbsX, maxAbsY, maxAbsZ } = rotatedBoxExtrema(
          modelSz.x,
          modelSz.y,
          modelSz.z,
          rx,
          ry,
          rz
        )
        const threeX = maxAbsX * 2,
          threeY = maxAbsY * 2,
          threeZ = maxAbsZ * 2
        if (threeX < 1e-9 || threeY < 1e-9 || threeZ < 1e-9) continue
        const s = Math.min(stock.x / threeX, stock.z / threeY, stock.y / threeZ)
        if (s > bestScale) {
          bestScale = s
          bestRot = { x: rx, y: ry, z: rz }
        }
      }
    }
  }

  const s = Math.max(0.001, bestScale)
  return {
    position: { x: 0, y: 0, z: stock.z / 2 },
    rotation: bestRot,
    scale: { x: s, y: s, z: s },
    fitScale: s
  }
}
