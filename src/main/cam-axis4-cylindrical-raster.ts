/**
 * 4-Axis Cylindrical Heightmap CAM Engine
 *
 * Generates proper rotary toolpaths using a cylindrical heightmap approach:
 *   1. Auto-center the mesh on the rotation axis (Y-Z centroid → origin)
 *   2. Build a cylindrical heightmap by ray-casting the mesh from stock OD inward
 *   3. Apply tool-radius compensation (min-envelope over tool footprint)
 *   4. Auto-compute radial depth levels from stock OD to mesh surface
 *   5. Generate continuous zigzag passes at each radial depth level (waterline roughing)
 *   6. Extend passes past material edges for clean cuts (overcut)
 *   7. Finishing passes follow the compensated surface with fine stepover
 *
 * Coordinate system (matches GRBL 4-axis convention):
 *   X = axial position along rotation axis
 *   Z = radial distance from rotation center (tool approach axis)
 *   A = rotation angle (degrees), 0–360
 *
 * References:
 *   - BlenderCAM/FabexCNC parallel-around-rotary strategy
 *   - pngcam heightmap-to-toolpath with tool-radius compensation
 *   - BobCAD-CAM rotary waterline roughing
 *   - ENCY CAM rotary adaptive roughing
 */
import type { Vec3 } from './stl'

type Triangle = readonly [Vec3, Vec3, Vec3]

// ─── Ray–triangle intersection (Möller–Trumbore) ───────────────────────────

const EPS = 1e-7

function rayIntersectTriangle(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  v0: Vec3, v1: Vec3, v2: Vec3
): number | null {
  const [x0, y0, z0] = v0
  const [x1, y1, z1] = v1
  const [x2, y2, z2] = v2
  const e1x = x1 - x0, e1y = y1 - y0, e1z = z1 - z0
  const e2x = x2 - x0, e2y = y2 - y0, e2z = z2 - z0
  const px = dy * e2z - dz * e2y
  const py = dz * e2x - dx * e2z
  const pz = dx * e2y - dy * e2x
  const det = e1x * px + e1y * py + e1z * pz
  if (Math.abs(det) < EPS) return null
  const invDet = 1 / det
  const tx = ox - x0, ty = oy - y0, tz = oz - z0
  const u = (tx * px + ty * py + tz * pz) * invDet
  if (u < -EPS || u > 1 + EPS) return null
  const qx = ty * e1z - tz * e1y
  const qy = tz * e1x - tx * e1z
  const qz = tx * e1y - ty * e1x
  const v = (dx * qx + dy * qy + dz * qz) * invDet
  if (v < -EPS || u + v > 1 + EPS) return null
  const t = (e2x * qx + e2y * qy + e2z * qz) * invDet
  return t > EPS ? t : null
}

// ─── Spatial acceleration: slice triangles by X bucket ──────────────────────

type XBuckets = { buckets: Triangle[][]; xMin: number; bucketWidth: number; count: number }

function buildXBuckets(triangles: Triangle[], xMin: number, xMax: number, numBuckets: number): XBuckets {
  const span = Math.max(1e-6, xMax - xMin)
  const w = span / numBuckets
  const buckets: Triangle[][] = Array.from({ length: numBuckets }, () => [])
  for (const tri of triangles) {
    const txMin = Math.min(tri[0][0], tri[1][0], tri[2][0])
    const txMax = Math.max(tri[0][0], tri[1][0], tri[2][0])
    const i0 = Math.max(0, Math.min(numBuckets - 1, Math.floor((txMin - xMin) / w)))
    const i1 = Math.max(0, Math.min(numBuckets - 1, Math.floor((txMax - xMin) / w)))
    for (let i = i0; i <= i1; i++) buckets[i]!.push(tri)
  }
  return { buckets, xMin, bucketWidth: w, count: numBuckets }
}

function queryBucket(xb: XBuckets, x: number): Triangle[] {
  const i = Math.max(0, Math.min(xb.count - 1, Math.floor((x - xb.xMin) / xb.bucketWidth)))
  return xb.buckets[i]!
}

// ─── Auto-center triangles on rotation axis ────────────────────────────────

/**
 * Compute the area-weighted centroid of triangle faces in the Y-Z plane and
 * translate all triangles so the mesh is centered on the rotation axis (Y=0,
 * Z=0). Returns the centered triangles and the offset applied.
 *
 * Area-weighted centroid is more accurate than a bounding-box midpoint for
 * asymmetric parts (e.g. an L-bracket, stepped cylinder, or part sitting on a
 * ground plane with most mass at one end). For symmetric meshes the result is
 * identical to the bbox midpoint. Falls back to bbox midpoint if all triangles
 * project to zero area in YZ (degenerate / fully axial mesh).
 *
 * Real STL models are almost never centered on the X-axis. They sit on a
 * ground plane, are offset by CAD origin, etc. Without centering, the
 * cylindrical ray-casting misses most of the mesh.
 */
function centerTrianglesOnRotationAxis(
  triangles: Triangle[]
): { centered: Triangle[]; offsetY: number; offsetZ: number; meshRadialMax: number } {
  if (triangles.length === 0) {
    return { centered: [], offsetY: 0, offsetZ: 0, meshRadialMax: 0 }
  }

  // Pass 1: area-weighted centroid in YZ + bbox for fallback
  let yMin = Infinity, yMax = -Infinity, zMin = Infinity, zMax = -Infinity
  let totalArea = 0, sumY = 0, sumZ = 0
  for (const [v0, v1, v2] of triangles) {
    for (const [, y, z] of [v0, v1, v2]) {
      if (y < yMin) yMin = y
      if (y > yMax) yMax = y
      if (z < zMin) zMin = z
      if (z > zMax) zMax = z
    }
    // 2D triangle area in the YZ plane (projection onto rotation cross-section)
    const dyA = v1[1] - v0[1], dzA = v1[2] - v0[2]
    const dyB = v2[1] - v0[1], dzB = v2[2] - v0[2]
    const area = Math.abs(dyA * dzB - dzA * dyB) * 0.5
    totalArea += area
    sumY += ((v0[1] + v1[1] + v2[1]) / 3) * area
    sumZ += ((v0[2] + v1[2] + v2[2]) / 3) * area
  }

  const offsetY = totalArea > 1e-9 ? sumY / totalArea : (yMin + yMax) / 2
  const offsetZ = totalArea > 1e-9 ? sumZ / totalArea : (zMin + zMax) / 2

  const centered: Triangle[] = []
  let meshRadialMax = 0
  for (const [v0, v1, v2] of triangles) {
    const a: Vec3 = [v0[0], v0[1] - offsetY, v0[2] - offsetZ]
    const b: Vec3 = [v1[0], v1[1] - offsetY, v1[2] - offsetZ]
    const c: Vec3 = [v2[0], v2[1] - offsetY, v2[2] - offsetZ]
    centered.push([a, b, c])
    // Track maximum radial extent
    for (const [, y, z] of [a, b, c]) {
      const r = Math.hypot(y, z)
      if (r > meshRadialMax) meshRadialMax = r
    }
  }

  return { centered, offsetY, offsetZ, meshRadialMax }
}

// ─── Cylindrical heightmap ──────────────────────────────────────────────────

/**
 * A cylindrical heightmap stores the radial distance from the X-axis to the
 * part surface at each (axial X, angular A) grid cell.
 *
 * `NO_HIT` means no mesh was found at that position (air / outside part).
 */
const NO_HIT = -1

type CylindricalHeightmap = {
  /** Radial distance to part surface. NO_HIT = no mesh. [ix * na + ia] */
  radii: Float32Array
  /** Number of X steps */
  nx: number
  /** Number of angular steps */
  na: number
  /** X value at index 0 */
  xStart: number
  /** X step size */
  dx: number
  /** Angular step in degrees */
  daDeg: number
}

function buildCylindricalHeightmap(
  triangles: Triangle[],
  stockRadius: number,
  xStart: number,
  xEnd: number,
  nx: number,
  na: number
): CylindricalHeightmap {
  const radii = new Float32Array(nx * na).fill(NO_HIT)
  const spanX = xEnd - xStart
  const dx = spanX / Math.max(1, nx - 1)
  const daDeg = 360 / na
  const castR = stockRadius + 30 // start ray well outside stock

  // Build spatial acceleration.
  // Scale bucket count with mesh length — use at least nx/2 buckets so short meshes
  // still get adequate spatial binning for ray tests. Cap at min(nx, 4000).
  const meshLengthMm = Math.max(1, xEnd - xStart)
  const numBuckets = Math.max(Math.ceil(nx / 2), Math.min(nx, Math.ceil(meshLengthMm * 2), 4000))
  const xb = buildXBuckets(triangles, xStart - dx, xEnd + dx, numBuckets)

  for (let ix = 0; ix < nx; ix++) {
    const x = xStart + ix * dx
    const localTris = queryBucket(xb, x)
    if (localTris.length === 0) continue

    for (let ia = 0; ia < na; ia++) {
      const aDeg = ia * daDeg
      const aRad = (aDeg * Math.PI) / 180
      const uy = Math.cos(aRad)
      const uz = Math.sin(aRad)

      // Ray from outside stock, pointing inward toward X-axis
      const oy = uy * castR
      const oz = uz * castR
      const dy = -uy
      const dz = -uz

      // Cast ray through all triangles in this X bucket
      let bestT: number | null = null
      for (const [v0, v1, v2] of localTris) {
        const t = rayIntersectTriangle(x, oy, oz, 0, dy, dz, v0, v1, v2)
        if (t != null && (bestT == null || t < bestT)) bestT = t
      }
      if (bestT == null) continue

      // Compute radial distance of hit point from X-axis
      const hy = oy + bestT * dy
      const hz = oz + bestT * dz
      const rHit = Math.hypot(hy, hz)

      // Ignore hits at the axis center (degenerate)
      if (rHit < 0.01) continue

      // Clamp hits beyond the stock to the stock surface rather than discarding.
      // This preserves the knowledge that mesh EXISTS at this angle (preventing
      // NO_HIT waterline fallback), even if the mesh extends beyond the stock.
      radii[ix * na + ia] = Math.min(rHit, stockRadius)
    }
  }

  return { radii, nx, na, xStart, dx, daDeg }
}

function hmGet(hm: CylindricalHeightmap, ix: number, ia: number): number {
  if (ix < 0 || ix >= hm.nx || ia < 0 || ia >= hm.na) return NO_HIT
  return hm.radii[ix * hm.na + ia]!
}

// ─── Tool radius compensation ───────────────────────────────────────────────

/**
 * Apply tool radius compensation to the heightmap.
 * For each cell, find the MAXIMUM radial distance within the tool footprint.
 * This prevents the tool center from gouging into adjacent higher features.
 */
function applyToolRadiusCompensation(
  hm: CylindricalHeightmap,
  toolRadius: number,
  stockRadius: number
): Float32Array {
  const compensated = new Float32Array(hm.nx * hm.na).fill(NO_HIT)
  const kernelIx = Math.max(1, Math.ceil(toolRadius / Math.max(0.01, hm.dx)))
  const angularSpanDeg = (toolRadius / Math.max(0.01, stockRadius)) * (180 / Math.PI)
  const kernelIa = Math.max(1, Math.ceil(angularSpanDeg / hm.daDeg))

  for (let ix = 0; ix < hm.nx; ix++) {
    for (let ia = 0; ia < hm.na; ia++) {
      let maxR = NO_HIT
      let hasAnyHit = false

      for (let dix = -kernelIx; dix <= kernelIx; dix++) {
        const nix = ix + dix
        if (nix < 0 || nix >= hm.nx) continue

        for (let dia = -kernelIa; dia <= kernelIa; dia++) {
          let nia = ia + dia
          if (nia < 0) nia += hm.na
          if (nia >= hm.na) nia -= hm.na

          const distX = dix * hm.dx
          const distA = dia * hm.daDeg * (Math.PI / 180) * stockRadius
          const dist = Math.hypot(distX, distA)
          if (dist > toolRadius) continue

          const r = hmGet(hm, nix, nia)
          if (r !== NO_HIT) {
            hasAnyHit = true
            if (r > maxR) maxR = r
          }
        }
      }

      if (hasAnyHit) {
        compensated[ix * hm.na + ia] = maxR
      }
    }
  }

  return compensated
}

// ─── Edge detection and overcut extension ───────────────────────────────────

function computePerAngleXExtents(
  hm: CylindricalHeightmap,
  overcutCells: number
): Array<[number, number]> {
  const extents: Array<[number, number]> = []
  for (let ia = 0; ia < hm.na; ia++) {
    let first = -1
    let last = -1
    for (let ix = 0; ix < hm.nx; ix++) {
      if (hmGet(hm, ix, ia) !== NO_HIT) {
        if (first === -1) first = ix
        last = ix
      }
    }
    if (first === -1) {
      extents.push([-1, -1])
    } else {
      const extStart = Math.max(0, first - overcutCells)
      const extEnd = Math.min(hm.nx - 1, last + overcutCells)
      extents.push([extStart, extEnd])
    }
  }

  // Fill gaps from neighboring angles
  for (let ia = 0; ia < hm.na; ia++) {
    if (extents[ia]![0] !== -1) continue
    const prev = (ia - 1 + hm.na) % hm.na
    const next = (ia + 1) % hm.na
    if (extents[prev]![0] !== -1 && extents[next]![0] !== -1) {
      extents[ia] = [
        Math.min(extents[prev]![0], extents[next]![0]),
        Math.max(extents[prev]![1], extents[next]![1])
      ]
    } else if (extents[prev]![0] !== -1) {
      extents[ia] = [...extents[prev]!]
    } else if (extents[next]![0] !== -1) {
      extents[ia] = [...extents[next]!]
    }
  }

  return extents
}

// ─── Auto-compute depth levels from mesh ────────────────────────────────────

/**
 * Compute radial depth levels that go from stock OD all the way down to the
 * deepest point on the mesh surface. This ensures the toolpath reaches every
 * part of the model, including concavities and areas close to the rotation axis.
 *
 * @param meshRadialMin Minimum radial extent of the mesh (closest to axis)
 * @param stockRadius Stock cylinder radius
 * @param zStepMm Step-down per layer (mm radial)
 * @param userZPassMm User-requested total depth (negative = from stock surface)
 * @returns Array of negative depth values (relative to stock surface)
 */
function computeMeshAwareDepths(
  meshRadialMin: number,
  stockRadius: number,
  zStepMm: number,
  userZPassMm: number
): number[] {
  // How deep we need to go: from stock OD to the DEEPEST point on the mesh
  // Use meshRadialMin (closest point to axis), with a small margin past it
  const meshDepth = -(stockRadius - Math.max(0.5, meshRadialMin - 0.5))

  // Use the deeper of: user-requested depth, or depth to reach mesh
  const targetDepth = Math.min(userZPassMm, meshDepth)

  // If target depth is too shallow (near zero), use at least -1
  if (targetDepth >= -0.1) return [-1]

  // Step down from stock surface to target depth
  const step = Math.max(0.25, Math.min(Math.abs(targetDepth) / 2, zStepMm > 0 ? zStepMm : 2))
  const depths: number[] = []
  let d = -step
  while (d > targetDepth + 1e-6) {
    depths.push(d)
    d -= step
  }
  depths.push(targetDepth)
  return depths
}

// ─── Angular stepover utility ───────────────────────────────────────────────

/**
 * Convert a desired surface arc-step (mm) at the stock outer radius to angular
 * degrees for use as `stepoverDeg` / `finishStepoverDeg`.
 *
 * Uses the arc-length formula: θ (rad) = arcLengthMm / stockRadiusMm.
 * For small angles this equals the chord formula; for ≥30° steps the arc
 * is longer than the chord, so the angular step is larger than the chord-based
 * equivalent. Use arc-length convention when the number of passes matters;
 * use chord-based when actual cut width on a flat slice matters.
 *
 * Clamps output to [0.1°, 180°].
 *
 * @param stockRadiusMm  Outer radius of the cylinder (mm). Must be > 0.
 * @param targetSurfaceStepoverMm  Desired arc-length between adjacent passes (mm). Must be > 0.
 */
export function surfaceStepoverDegFromMm(stockRadiusMm: number, targetSurfaceStepoverMm: number): number {
  const r = Math.max(1e-6, stockRadiusMm)
  const s = Math.max(1e-6, targetSurfaceStepoverMm)
  const deg = (s / r) * (180 / Math.PI)
  return Math.min(180, Math.max(0.1, deg))
}

// ─── Curvature-adaptive angular resolution ─────────────────────────────────

/**
 * Compute per-angle curvature score from heightmap second derivatives.
 *
 * For each angular index, computes the average absolute second derivative
 * of the radial distance in the angular direction (across all X positions).
 * High values indicate sharp surface transitions where finer angular
 * resolution improves surface quality.
 */
export function computeAngularCurvature(hm: CylindricalHeightmap, _stockR: number): Float32Array {
  const scores = new Float32Array(hm.na)
  const daRad = (hm.daDeg * Math.PI) / 180
  for (let ia = 0; ia < hm.na; ia++) {
    let totalCurvature = 0
    let count = 0
    for (let ix = 0; ix < hm.nx; ix++) {
      const idx = ix * hm.na + ia
      const r = hm.radii[idx]!
      if (r <= 0) continue
      // Angular second derivative (wrap-around)
      const iaPrev = (ia - 1 + hm.na) % hm.na
      const iaNext = (ia + 1) % hm.na
      const rPrev = hm.radii[ix * hm.na + iaPrev]!
      const rNext = hm.radii[ix * hm.na + iaNext]!
      if (rPrev <= 0 || rNext <= 0) continue
      const d2r = Math.abs(rPrev + rNext - 2 * r) / (daRad * daRad)
      totalCurvature += d2r
      count++
    }
    scores[ia] = count > 0 ? totalCurvature / count : 0
  }
  return scores
}

/**
 * Generate refined angular pass list — insert midpoint passes in high-curvature regions.
 *
 * Uses the 75th percentile of non-zero curvature scores as the threshold.
 * Angles above this threshold get an extra midpoint pass inserted between
 * them and the next grid angle, up to `maxExtraPasses` additional passes.
 *
 * @param baseDeg    Base angular step size in degrees
 * @param na         Base number of angular steps
 * @param curvature  Per-angle curvature scores from `computeAngularCurvature`
 * @param maxExtraPasses  Budget cap for additional midpoint passes
 * @returns Sorted array of angular positions in degrees
 */
export function buildAdaptiveAngles(
  baseDeg: number,
  na: number,
  curvature: Float32Array,
  maxExtraPasses: number
): number[] {
  // Compute curvature threshold (75th percentile of non-zero curvatures)
  const nonZero = Array.from(curvature).filter(c => c > 0).sort((a, b) => a - b)
  if (nonZero.length === 0) {
    // No curvature data — return uniform angles
    return Array.from({ length: na }, (_, i) => i * baseDeg)
  }
  const threshold = nonZero[Math.floor(nonZero.length * 0.75)] || 0

  // Start with base angles, inserting midpoints where curvature is high
  const angles: number[] = []
  let extraBudget = maxExtraPasses

  for (let ia = 0; ia < na; ia++) {
    const baseAngle = ia * baseDeg
    angles.push(baseAngle)

    // If this angle has high curvature AND we have budget, add midpoint
    if (curvature[ia]! > threshold && extraBudget > 0) {
      const midAngle = baseAngle + baseDeg / 2
      if (midAngle < 360) {
        angles.push(midAngle)
        extraBudget--
      }
    }
  }

  // Sort and deduplicate
  angles.sort((a, b) => a - b)
  return angles
}

/**
 * Sample the compensated heightmap at an arbitrary angular position using
 * linear interpolation between the two nearest grid angles.
 *
 * Used for adaptive refinement passes that fall between grid points.
 */
export function sampleHeightmapAtAngle(
  hm: CylindricalHeightmap,
  comp: Float32Array,
  ix: number,
  aDeg: number
): number {
  const iaFloat = aDeg / hm.daDeg
  const ia0 = Math.floor(iaFloat) % hm.na
  const ia1 = (ia0 + 1) % hm.na
  const frac = iaFloat - Math.floor(iaFloat)
  const r0 = comp[ix * hm.na + ia0]!
  const r1 = comp[ix * hm.na + ia1]!
  if (r0 <= 0 && r1 <= 0) return 0
  if (r0 <= 0) return r1
  if (r1 <= 0) return r0
  return r0 + frac * (r1 - r0)
}

// ─── Toolpath generation ────────────────────────────────────────────────────

export type CylindricalRasterParams = {
  triangles: Triangle[]
  /** Outer diameter of the rotary stock cylinder (mm). */
  cylinderDiameterMm: number
  machXStartMm: number
  machXEndMm: number
  /** Angular step in degrees. */
  stepoverDeg: number
  /** Approximate step along X (mm). */
  stepXMm: number
  /** Depth levels relative to stock surface (negative values). Used as fallback if mesh centering fails. */
  zDepthsMm: number[]
  feedMmMin: number
  plungeMmMin: number
  safeZMm: number
  /** Optional extra radial stock left on mesh hits (mm). */
  finishAllowanceMm?: number
  /** Hard cap on grid cells (x steps × a steps). */
  maxCells?: number
  /** Tool diameter in mm (default 3.175). */
  toolDiameterMm?: number
  /** Overcut distance past material edges in mm (default: tool diameter). */
  overcutMm?: number
  /** Generate a finishing pass (default: auto based on depth count). */
  enableFinishPass?: boolean
  /** Finishing pass angular stepover in degrees (default: stepoverDeg / 2). */
  finishStepoverDeg?: number
  /** Machine maximum Z travel (mm). clearZ is clamped to maxZMm - 1 to avoid exceeding hard limits. */
  maxZMm?: number
  /** Enable curvature-adaptive angular refinement (default: false).
   *  When enabled, high-curvature regions receive additional midpoint passes
   *  for better surface quality without wasting time on smooth areas. */
  adaptiveRefinement?: boolean
}

/**
 * Generate 4-axis cylindrical toolpath using heightmap-based approach.
 *
 * Algorithm:
 * 1. Auto-center the mesh on the rotation axis
 * 2. Compute depth levels from stock OD to mesh surface
 * 3. Build cylindrical heightmap by ray-casting mesh
 * 4. Apply tool-radius compensation
 * 5. For each radial depth level (roughing):
 *    a. For each angular position, generate continuous X-axis passes
 *    b. Extend past material edges by overcut distance
 *    c. Cut at the deeper of (current depth level) or (compensated surface)
 *    d. Skip air regions where no material exists
 * 6. Finishing pass: follow the compensated surface at fine stepover
 */
export function generateCylindricalMeshRasterLines(p: CylindricalRasterParams): string[] {
  const stockR = Math.max(1e-6, p.cylinderDiameterMm / 2)
  const rawClearZ = stockR + p.safeZMm
  const clearZ = p.maxZMm != null ? Math.min(rawClearZ, p.maxZMm - 1) : rawClearZ
  const toolD = p.toolDiameterMm ?? 3.175
  const toolR = toolD / 2
  const overcutMm = p.overcutMm ?? toolD
  const stepA = Math.max(0.5, Math.min(90, p.stepoverDeg))

  // Step 0: Auto-center the mesh on the rotation axis
  const { centered, offsetY, offsetZ, meshRadialMax } = centerTrianglesOnRotationAxis(p.triangles)

  // Pre-generation safety: clamp machinable X span to stock bounds
  const machXStartClamped = Math.max(0, p.machXStartMm)
  const machXEndClamped = Math.max(machXStartClamped + 0.1, p.machXEndMm)

  // Extend machinable range by overcut on each side.
  // SAFETY: extXStart must never go below 0 — X=0 is the chuck face,
  // negative X would drive the tool into the chuck/jaws.
  const extXStart = Math.max(0, machXStartClamped - overcutMm)
  const extXEnd = machXEndClamped + overcutMm
  const extSpanX = extXEnd - extXStart

  const targetStepX = Math.max(0.1, p.stepXMm)
  let nx = Math.max(10, Math.ceil(extSpanX / targetStepX) + 1)
  let na = Math.max(36, Math.ceil(360 / stepA))
  const maxCells = Math.max(1000, Math.min(500_000, p.maxCells ?? 250_000))
  while (nx * na > maxCells && nx > 10) nx--
  while (nx * na > maxCells && na > 36) na--

  const allowance = Math.max(0, p.finishAllowanceMm ?? 0)

  const lines: string[] = []
  const actualStepADeg = 360 / na
  const actualDx = extSpanX / Math.max(1, nx - 1)

  // Step 1: Build cylindrical heightmap from CENTERED triangles
  // Use adaptive refinement: if initial pass has poor coverage, double resolution and retry.
  let hm = buildCylindricalHeightmap(
    centered, stockR, extXStart, extXEnd, nx, na
  )

  // Verify we got hits and find min/max mesh radii
  let hitCount = 0
  let meshRadialMin = Infinity
  for (let i = 0; i < hm.radii.length; i++) {
    if (hm.radii[i]! !== NO_HIT) {
      hitCount++
      if (hm.radii[i]! < meshRadialMin) meshRadialMin = hm.radii[i]!
    }
  }

  // Adaptive refinement: if hit rate is below 60% and we have room for more cells, retry
  const hitRate = hm.radii.length > 0 ? hitCount / hm.radii.length : 0
  if (hitRate > 0 && hitRate < 0.6 && nx * na < maxCells * 0.6) {
    const refineNx = Math.min(Math.ceil(nx * 1.8), Math.ceil(Math.sqrt(maxCells * (extSpanX / 360))))
    const refineNa = Math.min(Math.ceil(na * 1.8), Math.ceil(Math.sqrt(maxCells * (360 / Math.max(1, extSpanX)))))
    if (refineNx * refineNa <= maxCells && (refineNx > nx || refineNa > na)) {
      nx = refineNx
      na = refineNa
      hm = buildCylindricalHeightmap(centered, stockR, extXStart, extXEnd, nx, na)
      hitCount = 0
      meshRadialMin = Infinity
      for (let i = 0; i < hm.radii.length; i++) {
        if (hm.radii[i]! !== NO_HIT) {
          hitCount++
          if (hm.radii[i]! < meshRadialMin) meshRadialMin = hm.radii[i]!
        }
      }
    }
  }

  if (meshRadialMin === Infinity) meshRadialMin = stockR

  // Step 2: Apply tool radius compensation
  const compensated = applyToolRadiusCompensation(hm, toolR, stockR)

  // Find minimum compensated radius (deepest point the tool center must reach)
  let minCompR = Infinity
  for (let i = 0; i < compensated.length; i++) {
    if (compensated[i]! !== NO_HIT && compensated[i]! < minCompR) {
      minCompR = compensated[i]!
    }
  }
  if (minCompR === Infinity) minCompR = meshRadialMin

  // Step 3: Compute mesh-aware depth levels using the DEEPEST mesh point
  const providedStep = p.zDepthsMm.length >= 2
    ? Math.abs(p.zDepthsMm[0]! - p.zDepthsMm[1]!)
    : 0
  const userZPass = Math.min(...p.zDepthsMm) // deepest requested depth
  const zStepMm = providedStep > 0.1 ? providedStep : 2

  let allDepths: number[]
  if (meshRadialMin < stockR - 0.1 && hitCount > 0) {
    // Use minCompR (deepest compensated point) so depths reach the full mesh
    allDepths = computeMeshAwareDepths(minCompR, stockR, zStepMm, userZPass)
  } else {
    // Fallback: use provided depths
    allDepths = [...p.zDepthsMm].sort((a, b) => b - a)
  }

  lines.push(
    `; 4-axis cylindrical MESH raster — R=${stockR.toFixed(1)}mm (Ø${(stockR * 2).toFixed(1)}), ` +
    `X=[${p.machXStartMm.toFixed(2)}..${p.machXEndMm.toFixed(2)}] +overcut ${overcutMm.toFixed(1)}mm, ` +
    `A step≈${actualStepADeg.toFixed(2)}° (grid ${nx}×${na}), Z levels=${allDepths.length}, ` +
    `tool Ø${toolD.toFixed(2)}mm`
  )
  lines.push(
    `; Auto-centered mesh: offset Y=${offsetY.toFixed(2)} Z=${offsetZ.toFixed(2)}, ` +
    `mesh radial range=${meshRadialMin.toFixed(2)}..${meshRadialMax.toFixed(2)}mm, ` +
    `min compensated R=${minCompR.toFixed(2)}mm`
  )
  lines.push(`; Depth levels: ${allDepths.map(d => d.toFixed(2)).join(', ')}`)
  lines.push('; Algorithm: cylindrical heightmap + tool-radius compensation + surface-offset roughing')
  lines.push('; VERIFY: cylinder diameter; A home')
  lines.push(`; Heightmap: ${hitCount}/${hm.radii.length} cells hit (${(hitCount / hm.radii.length * 100).toFixed(1)}%)`)
  if (meshRadialMax > stockR + 1e-3) {
    lines.push(
      `; WARNING: mesh radial max ${meshRadialMax.toFixed(2)} mm exceeds stock radius ${stockR.toFixed(2)} mm — ` +
      `mesh extends ${(meshRadialMax - stockR).toFixed(2)} mm past stock OD after centering. Confirm stock diameter and mesh alignment.`
    )
  }

  // Step 4a: Curvature-adaptive angular refinement
  // When enabled, compute per-angle curvature and build a non-uniform angle
  // list that inserts midpoint passes in high-curvature regions.
  const useAdaptive = p.adaptiveRefinement === true
  let roughPassAngles: number[]
  if (useAdaptive) {
    const curvature = computeAngularCurvature(hm, stockR)
    const maxExtra = Math.min(Math.ceil(na * 0.3), Math.floor((maxCells / nx) - na))
    roughPassAngles = buildAdaptiveAngles(actualStepADeg, na, curvature, Math.max(0, maxExtra))
    lines.push(
      `; Adaptive refinement: ${roughPassAngles.length} angular passes ` +
      `(base ${na}, +${roughPassAngles.length - na} in high-curvature regions)`
    )
  } else {
    roughPassAngles = Array.from({ length: na }, (_, i) => i * actualStepADeg)
  }

  // Step 4b: Compute per-angle X extents with overcut (used for finishing only)
  const overcutCells = Math.max(1, Math.ceil(overcutMm / actualDx))
  const xExtents = computePerAngleXExtents(hm, overcutCells)

  // Separate into roughing and finishing
  const enableFinish = p.enableFinishPass === true || (p.enableFinishPass !== false && allDepths.length > 1)
  const roughingDepths = enableFinish ? allDepths.slice(0, -1) : allDepths
  const finishDepth = enableFinish ? allDepths[allDepths.length - 1]! : null

  let passNum = 0

  // ── Roughing: Safe waterline passes with retract between angles ─────────
  //
  // Each roughing layer uses a HYBRID strategy:
  //   - Where mesh EXISTS: surface-offset cuts that follow the model shape,
  //     progressively approaching the mesh surface with each layer.
  //   - Where NO mesh exists (within the part's X span): waterline cuts at
  //     the current depth level to clear stock around the model.
  //
  // SAFETY: Between angular passes, the tool retracts to a stepover clearance
  // height before rotating to the new angle. This prevents the tool from
  // sweeping through protruding geometry while at cutting depth — the
  // INDUSTRY STANDARD approach for rotary waterline roughing.
  //
  // Motion pattern per angular pass:
  //   1. Retract Z to stepover clearance
  //   2. Rapid rotate to new A angle
  //   3. Rapid X to pass start position
  //   4. Plunge to cut depth
  //   5. Cut along X at depth
  //
  // Between depth levels, a full retract to clearZ is performed for safety.

  // Initial rapid to start position — include Y0 to center tool on rotation axis.
  // The post template header should also command G0 Y0, but repeating here is
  // defense-in-depth: if the toolpath is pasted into a different wrapper, the
  // tool still gets centered before cutting begins.
  lines.push(`G0 Z${clearZ.toFixed(3)} Y0`)
  let firstRoughPass = true

  for (let di = 0; di < roughingDepths.length; di++) {
    const zd = roughingDepths[di]!
    const targetCutR = stockR + zd // radial position to cut (zd is negative)
    if (targetCutR < 0.05) continue

    // SAFETY: Retract to clearZ between depth levels to avoid crashing
    // into features that protrude at different radii at different angles.
    if (!firstRoughPass) {
      lines.push(`G0 Z${clearZ.toFixed(3)}`)
      firstRoughPass = true // force proper rapid positioning for new depth level
    }

    lines.push(`; ─── Roughing: depth ${zd.toFixed(3)}mm (waterline R=${targetCutR.toFixed(3)}mm) ───`)

    // SAFETY: Stepover clearance height — above current depth level by at
    // least 2mm or one tool diameter, whichever is larger. This prevents
    // the tool from plowing through protruding geometry when rotating
    // between angular positions. Clamped to clearZ as upper bound.
    const stepoverClearZ = Math.min(clearZ, targetCutR + Math.max(2, toolD))

    for (const aDeg of roughPassAngles) {
      // Determine if this angle falls on a grid point or is an interpolated midpoint
      const iaFloat = aDeg / actualStepADeg
      const isOnGrid = Math.abs(iaFloat - Math.round(iaFloat)) < 1e-6
      const ia = isOnGrid ? Math.round(iaFloat) % na : -1

      const passPoints: Array<{ x: number; cutZ: number }> = []

      for (let ix = 0; ix < nx; ix++) {
        const x = extXStart + ix * actualDx

        // Sample the compensated heightmap — either directly or via interpolation
        let compR: number
        if (ia >= 0) {
          compR = compensated[ix * na + ia]!
        } else {
          compR = sampleHeightmapAtAngle(hm, compensated, ix, aDeg)
        }

        let cutZ: number
        if (compR === NO_HIT || compR <= 0) {
          // No mesh at this position — cut at waterline depth to clear stock
          cutZ = targetCutR
        } else {
          // Waterline roughing: cut to the current depth level, but never
          // deeper than the compensated mesh surface (+ finish allowance).
          // This correctly reveals the mesh shape layer by layer.
          const surfaceLimit = compR + allowance
          cutZ = Math.max(surfaceLimit, targetCutR)
        }

        if (cutZ < 0.05) continue
        if (cutZ >= stockR - 0.05) continue  // skip: too close to stock surface (< 0.05mm depth)

        passPoints.push({ x, cutZ })
      }

      if (passPoints.length < 2) continue

      passNum++
      if (passNum % 2 === 0) passPoints.reverse()

      lines.push(`; Pass ${passNum}: A=${aDeg.toFixed(1)}° rough waterline R=${targetCutR.toFixed(2)}`)

      const firstPt = passPoints[0]!

      if (firstRoughPass) {
        // Very first pass of this depth level: rapid position then plunge
        lines.push(`G0 A${aDeg.toFixed(3)}`)
        lines.push(`G0 X${firstPt.x.toFixed(3)}`)
        lines.push(`G1 Z${firstPt.cutZ.toFixed(3)} F${p.plungeMmMin.toFixed(0)}`)
        firstRoughPass = false
      } else {
        // SAFETY: Retract, rotate, reposition, plunge — never rotate at depth.
        // Rotating at cutting depth sweeps the tool through all geometry between
        // the old angle and new angle, which can plow through protruding features.
        lines.push(`G0 Z${stepoverClearZ.toFixed(3)}`)
        lines.push(`G0 A${aDeg.toFixed(3)}`)
        lines.push(`G0 X${firstPt.x.toFixed(3)}`)
        lines.push(`G1 Z${firstPt.cutZ.toFixed(3)} F${p.plungeMmMin.toFixed(0)}`)
      }

      for (let i = 1; i < passPoints.length; i++) {
        const pt = passPoints[i]!
        const prev = passPoints[i - 1]!
        const zChange = Math.abs(pt.cutZ - prev.cutZ)
        if (zChange > 0.5 && pt.cutZ < prev.cutZ) {
          // SAFETY: Going deeper — use plunge feed rate, not cutting feed rate.
          // Plunging at full cutting feed can break the tool or stall the spindle.
          lines.push(`G1 X${pt.x.toFixed(3)} Z${pt.cutZ.toFixed(3)} F${p.plungeMmMin.toFixed(0)}`)
        } else if (zChange > 0.005) {
          lines.push(`G1 X${pt.x.toFixed(3)} Z${pt.cutZ.toFixed(3)} F${p.feedMmMin.toFixed(0)}`)
        } else {
          lines.push(`G1 X${pt.x.toFixed(3)} F${p.feedMmMin.toFixed(0)}`)
        }
      }
    }
  }

  // ── Finishing pass ──────────────────────────────────────────────────────

  if (finishDepth != null) {
    const finishTargetR = stockR + finishDepth
    if (finishTargetR >= 0.05) {
      const finishStepDeg = Math.max(0.5, p.finishStepoverDeg ?? stepA / 2)
      const finishNa = Math.max(36, Math.ceil(360 / finishStepDeg))
      const finishDaDeg = 360 / finishNa

      lines.push(
        `; ─── Finishing pass: target R=${finishTargetR.toFixed(3)}mm, ` +
        `A step=${finishDaDeg.toFixed(2)}° (${finishNa} passes) ───`
      )

      // Rebuild heightmap at finer angular resolution if needed
      let finishHm = hm
      let finishComp = compensated
      let finishNaActual = na
      if (finishNa > na) {
        let finishNx = nx
        const finishMaxCells = Math.max(maxCells, 80_000)
        while (finishNx * finishNa > finishMaxCells && finishNx > 10) finishNx--
        finishHm = buildCylindricalHeightmap(
          centered, stockR, extXStart, extXEnd, finishNx, finishNa
        )
        finishComp = applyToolRadiusCompensation(finishHm, toolR, stockR)
        finishNaActual = finishNa
      } else {
        finishNaActual = na
      }

      const finishExtents = computePerAngleXExtents(finishHm, overcutCells)

      // Build adaptive angle list for finishing (benefits most from refinement)
      let finishPassAngles: number[]
      if (useAdaptive) {
        const finishCurvature = computeAngularCurvature(finishHm, stockR)
        const finishNx = finishHm.nx
        const finishMaxExtra = Math.min(
          Math.ceil(finishNaActual * 0.3),
          Math.floor((maxCells / finishNx) - finishNaActual)
        )
        finishPassAngles = buildAdaptiveAngles(
          360 / finishNaActual, finishNaActual, finishCurvature, Math.max(0, finishMaxExtra)
        )
        lines.push(
          `; Finish adaptive: ${finishPassAngles.length} angular passes ` +
          `(base ${finishNaActual}, +${finishPassAngles.length - finishNaActual} refined)`
        )
      } else {
        finishPassAngles = Array.from({ length: finishNaActual }, (_, i) => i * (360 / finishNaActual))
      }

      // SAFETY: Retract to clearZ before starting finishing pass.
      // Finishing uses the same safe retract-rotate-plunge pattern as roughing
      // to prevent the tool from sweeping through protruding geometry.
      // Include Y0 to re-confirm tool is centered on rotation axis.
      lines.push(`G0 Z${clearZ.toFixed(3)} Y0`)
      let firstFinishPass = true

      // SAFETY: Stepover clearance for finishing — above the finish target
      // by at least 2mm or one tool diameter, to clear protruding features
      // when rotating between angular positions.
      const finishStepoverClearZ = Math.min(clearZ, finishTargetR + Math.max(2, toolD))

      for (const aDeg of finishPassAngles) {
        // Determine if this angle falls on a finishing grid point or is interpolated
        const finishDaDeg = 360 / finishNaActual
        const finIaFloat = aDeg / finishDaDeg
        const finIsOnGrid = Math.abs(finIaFloat - Math.round(finIaFloat)) < 1e-6
        const finIa = finIsOnGrid ? Math.round(finIaFloat) % finishNaActual : -1

        // Look up X extents from nearest grid angle
        const nearestIa = Math.round(finIaFloat) % finishNaActual
        const [xIdxStart, xIdxEnd] = finishExtents[nearestIa]!
        if (xIdxStart === -1) continue

        const passPoints: Array<{ x: number; cutZ: number }> = []

        for (let ix = xIdxStart; ix <= xIdxEnd; ix++) {
          const x = finishHm.xStart + ix * finishHm.dx

          // Sample compensated heightmap — directly or via interpolation
          let compR: number
          if (finIa >= 0) {
            compR = finishComp[ix * finishNaActual + finIa]!
          } else {
            compR = sampleHeightmapAtAngle(finishHm, finishComp, ix, aDeg)
          }

          let cutZ: number
          if (compR === NO_HIT || compR <= 0) {
            cutZ = finishTargetR
          } else {
            // Follow the actual compensated mesh surface — no floor clamp.
            // The compensated value already accounts for tool radius, so cutting
            // here gives the correct surface finish at any depth.
            cutZ = compR
          }

          if (cutZ < 0.05) continue
          if (cutZ >= stockR - 0.05) continue  // skip: too close to stock surface (< 0.05mm depth)

          passPoints.push({ x, cutZ })
        }

        if (passPoints.length < 2) continue

        passNum++
        if (passNum % 2 === 0) passPoints.reverse()

        lines.push(`; Finish ${passNum}: A=${aDeg.toFixed(1)}°`)

        const firstPt = passPoints[0]!
        if (firstFinishPass) {
          // First finish pass: rapid position then plunge
          lines.push(`G0 A${aDeg.toFixed(3)}`)
          lines.push(`G0 X${firstPt.x.toFixed(3)}`)
          lines.push(`G1 Z${firstPt.cutZ.toFixed(3)} F${p.plungeMmMin.toFixed(0)}`)
          firstFinishPass = false
        } else {
          // SAFETY: Retract, rotate, reposition, plunge — never rotate at depth.
          // Same pattern as roughing: prevents sweeping through protrusions.
          lines.push(`G0 Z${finishStepoverClearZ.toFixed(3)}`)
          lines.push(`G0 A${aDeg.toFixed(3)}`)
          lines.push(`G0 X${firstPt.x.toFixed(3)}`)
          lines.push(`G1 Z${firstPt.cutZ.toFixed(3)} F${p.plungeMmMin.toFixed(0)}`)
        }

        for (let i = 1; i < passPoints.length; i++) {
          const pt = passPoints[i]!
          const prev = passPoints[i - 1]!
          const zChange = Math.abs(pt.cutZ - prev.cutZ)
          if (zChange > 0.5 && pt.cutZ < prev.cutZ) {
            // SAFETY: Going deeper — use plunge feed rate
            lines.push(`G1 X${pt.x.toFixed(3)} Z${pt.cutZ.toFixed(3)} F${p.plungeMmMin.toFixed(0)}`)
          } else if (zChange > 0.005) {
            lines.push(`G1 X${pt.x.toFixed(3)} Z${pt.cutZ.toFixed(3)} F${p.feedMmMin.toFixed(0)}`)
          } else {
            lines.push(`G1 X${pt.x.toFixed(3)} F${p.feedMmMin.toFixed(0)}`)
          }
        }
      }
    }
  }

  lines.push(`G0 Z${clearZ.toFixed(3)} Y0`)
  lines.push('G0 A0 ; return A to home')
  return lines
}

// ─── Contour wrapping (2D XY → cylindrical X/A) ──────────────────────────────

/**
 * Wraps a 2D contour (X, linear_Y_mm) onto the cylinder surface as X/A moves.
 * Y is converted to A degrees: A = (Y / (π·D)) × 360.
 * X is clamped to the machinable span.
 */
export function generateContourWrappingLines(p: {
  contourPoints: [number, number][]
  cylinderDiameterMm: number
  machXStartMm: number
  machXEndMm: number
  zDepthsMm: number[]
  feedMmMin: number
  plungeMmMin: number
  safeZMm: number
  /** Machine maximum Z travel (mm). clearZ is clamped to maxZMm - 1 to avoid exceeding hard limits. */
  maxZMm?: number
}): string[] {
  const radius = p.cylinderDiameterMm / 2
  const rawClearZ = radius + p.safeZMm
  const clearZ = p.maxZMm != null ? Math.min(rawClearZ, p.maxZMm - 1) : rawClearZ
  const circumference = Math.PI * p.cylinderDiameterMm

  const lines: string[] = []
  lines.push(
    `; 4-axis contour wrapping — D=${p.cylinderDiameterMm.toFixed(1)}mm, ` +
    `${p.contourPoints.length} pts, X clamp [${p.machXStartMm.toFixed(2)}..${p.machXEndMm.toFixed(2)}], ` +
    `Z levels=${p.zDepthsMm.length}`
  )
  lines.push(`G0 Z${clearZ.toFixed(3)} Y0  ; safe clearance, center on rotation axis`)

  if (p.contourPoints.length === 0) return lines

  function linearToA(yMm: number): number {
    if (circumference <= 0) return 0
    return (yMm / circumference) * 360
  }

  function clampX(x: number): number {
    return Math.max(p.machXStartMm, Math.min(p.machXEndMm, x))
  }

  for (const zd of p.zDepthsMm) {
    const cutZ = radius + zd
    lines.push(`; --- contour at Z_pass=${zd.toFixed(3)} ---`)

    const [firstX, firstY] = p.contourPoints[0]!
    const cx0 = clampX(firstX)
    const a0 = linearToA(firstY)
    lines.push(`G0 X${cx0.toFixed(3)} A${a0.toFixed(3)}  ; rapid to contour start`)
    lines.push(`G1 Z${cutZ.toFixed(3)} F${p.plungeMmMin.toFixed(0)}  ; plunge to cut depth`)

    for (let i = 1; i < p.contourPoints.length; i++) {
      const [xMm, yMm] = p.contourPoints[i]!
      const cx = clampX(xMm)
      const aDeg = linearToA(yMm)
      lines.push(`G1 X${cx.toFixed(3)} A${aDeg.toFixed(3)} F${p.feedMmMin.toFixed(0)}`)
    }

    lines.push(`G0 Z${clearZ.toFixed(3)}`)
  }

  lines.push('G0 A0 ; return A to home')
  return lines
}

// ─── Indexed passes (face at discrete A angles) ──────────────────────────────

/**
 * At each angle in a list, face along X at each depth level.
 * Alternates X direction for efficient zigzag.
 */
export function generateIndexedPassLines(p: {
  indexAnglesDeg: number[]
  cylinderDiameterMm: number
  machXStartMm: number
  machXEndMm: number
  zDepthsMm: number[]
  feedMmMin: number
  plungeMmMin: number
  safeZMm: number
  toolDiameterMm?: number
  overcutMm?: number
  /** Machine maximum Z travel (mm). clearZ is clamped to maxZMm - 1 to avoid exceeding hard limits. */
  maxZMm?: number
}): string[] {
  const radius = p.cylinderDiameterMm / 2
  const rawClearZ = radius + p.safeZMm
  const clearZ = p.maxZMm != null ? Math.min(rawClearZ, p.maxZMm - 1) : rawClearZ
  const ocMm = p.overcutMm ?? (p.toolDiameterMm ?? 3.175)
  const extXStart = Math.max(0, p.machXStartMm - ocMm)
  const extXEnd = p.machXEndMm + ocMm

  const lines: string[] = []
  lines.push(
    `; 4-axis indexed — ${p.indexAnglesDeg.length} angles, ` +
    `X=[${p.machXStartMm.toFixed(2)}..${p.machXEndMm.toFixed(2)}] +overcut ${ocMm.toFixed(1)}mm, ` +
    `Z levels=${p.zDepthsMm.length}`
  )
  lines.push(`; D=${p.cylinderDiameterMm.toFixed(1)}mm`)
  lines.push('; VERIFY: A zero, stock zero, each index angle before running')
  lines.push(`G0 Z${clearZ.toFixed(3)} Y0  ; safe clearance, center on rotation axis`)

  let direction = 1
  for (const zd of p.zDepthsMm) {
    const cutZ = radius + zd
    if (cutZ < 0.05) continue
    lines.push(`; --- indexed passes at Z_pass=${zd.toFixed(3)} ---`)

    for (let i = 0; i < p.indexAnglesDeg.length; i++) {
      const angle = p.indexAnglesDeg[i]!
      const xs = direction === 1 ? extXStart : extXEnd
      const xe = direction === 1 ? extXEnd : extXStart
      lines.push(`; Index ${i + 1}/${p.indexAnglesDeg.length}  A=${angle.toFixed(2)}°  Z=${zd.toFixed(3)}`)
      lines.push(`G0 Z${clearZ.toFixed(3)}`)
      lines.push(`G0 A${angle.toFixed(3)}`)
      lines.push(`G0 X${xs.toFixed(3)}`)
      lines.push(`G1 Z${cutZ.toFixed(3)} F${p.plungeMmMin.toFixed(0)}`)
      lines.push(`G1 X${xe.toFixed(3)} F${p.feedMmMin.toFixed(0)}`)
      lines.push(`G0 Z${clearZ.toFixed(3)}`)
      direction *= -1
    }
  }

  lines.push('G0 A0 ; return A to home position')
  return lines
}

// ─── Pattern-based parallel (no STL fallback) ────────────────────────────────

/**
 * Simple pattern-based parallel passes without mesh data.
 * Used when STL is unavailable: zigzag X at each A angle, for each Z depth.
 */
export function generatePatternParallelLines(p: {
  cylinderDiameterMm: number
  machXStartMm: number
  machXEndMm: number
  zDepthsMm: number[]
  stepoverDeg: number
  feedMmMin: number
  plungeMmMin: number
  safeZMm: number
  toolDiameterMm?: number
  overcutMm?: number
  /** Machine maximum Z travel (mm). clearZ is clamped to maxZMm - 1 to avoid exceeding hard limits. */
  maxZMm?: number
}): string[] {
  const radius = p.cylinderDiameterMm / 2
  const rawClearZ = radius + p.safeZMm
  const clearZ = p.maxZMm != null ? Math.min(rawClearZ, p.maxZMm - 1) : rawClearZ
  const ocMm = p.overcutMm ?? (p.toolDiameterMm ?? 3.175)
  const extXStart = Math.max(0, p.machXStartMm - ocMm)
  const extXEnd = p.machXEndMm + ocMm
  const step = p.stepoverDeg

  const lines: string[] = []
  lines.push(
    `; 4-axis cylindrical parallel (pattern) — D=${p.cylinderDiameterMm.toFixed(1)}mm, ` +
    `X=[${p.machXStartMm.toFixed(2)}..${p.machXEndMm.toFixed(2)}] +overcut ${ocMm.toFixed(1)}mm, ` +
    `Z levels=${p.zDepthsMm.length}, A step=${step.toFixed(1)}°`
  )
  lines.push('; VERIFY: cylinder diameter, stock zero, A WCS home, chuck bounds')
  lines.push(`G0 Z${clearZ.toFixed(3)} Y0  ; safe clearance, center on rotation axis`)

  let passNum = 0
  let direction = 1
  for (const zd of p.zDepthsMm) {
    const cutZ = radius + zd
    if (cutZ < 0.05) continue
    lines.push(`; --- Z depth ${zd.toFixed(3)} mm (radial cut Z=${cutZ.toFixed(3)}) ---`)

    let aAngle = 0
    while (aAngle <= 360 + 1e-6) {
      passNum++
      const xs = direction === 1 ? extXStart : extXEnd
      const xe = direction === 1 ? extXEnd : extXStart
      lines.push(`; Pass ${passNum}  A=${aAngle.toFixed(2)}°  Z_pass=${zd.toFixed(3)}`)
      lines.push(`G0 Z${clearZ.toFixed(3)}`)
      lines.push(`G0 A${aAngle.toFixed(3)}`)
      lines.push(`G0 X${xs.toFixed(3)}`)
      lines.push(`G1 Z${cutZ.toFixed(3)} F${p.plungeMmMin.toFixed(0)}`)
      lines.push(`G1 X${xe.toFixed(3)} F${p.feedMmMin.toFixed(0)}`)
      lines.push(`G0 Z${clearZ.toFixed(3)}`)
      aAngle += step
      direction *= -1
    }
  }

  lines.push(`G0 Z${clearZ.toFixed(3)}`)
  lines.push('G0 A0 ; return A to home')
  return lines
}
