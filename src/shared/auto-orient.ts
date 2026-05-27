/**
 * Auto-orient (FDM): pick a rotation that flips the part so the "best" face
 * points down (-Z), minimizing overhang and maximizing bed contact.
 *
 * Pure math — no FS, no IPC, no React. Browser- and Node-safe.
 *
 * Algorithm (Tweaker-3 / Cura / Bambu Studio style):
 *  1. Build triangle list from input (raw positions OR vertices + indices).
 *  2. Build candidate "down" normals = top-area triangle face normals
 *     (a robust proxy for convex-hull face normals on closed meshes)
 *     PLUS the 6 cardinal axes ±X/±Y/±Z. Deduplicate by cosine threshold.
 *     Cap at MAX_CANDIDATES (50).
 *  3. For each candidate normal n, rotate the mesh so n points to (0,0,-1).
 *  4. Score the rotated mesh (lower is better) with a weighted sum:
 *        score =  OVERHANG_WEIGHT  * overhangArea
 *              + BOTTOM_WEIGHT    * (totalArea / (bottomArea + EPS))
 *              + COG_WEIGHT       * cogZ
 *     where:
 *       - overhangArea = sum of triangle area where triangle.normal . -Z < -cos(45°)
 *                       (i.e. the face is tilted past 45° from vertical,
 *                        pointing roughly downward — would need supports).
 *                       Bottom-resting faces (normal.z near -1) are EXCLUDED
 *                       (they rest on the bed, not overhang).
 *       - bottomArea   = sum of triangle area where every vertex has
 *                       z within BOTTOM_EPS_MM of minZ AND triangle.normal.z < 0
 *                       (flat, downward, on the build plate).
 *       - cogZ         = mean Z of every vertex of the rotated mesh
 *                       (proxy for centre-of-gravity height; lower = more stable).
 *  5. Return the rotation with the lowest score as Euler XYZ degrees.
 *
 * Bounds:
 *  - MAX_CANDIDATES = 50  (typical: 44 unique mesh normals + 6 cardinals).
 *  - Designed to score a 10K-triangle mesh in <100ms.
 */

// ── Public API types ────────────────────────────────────────────────────────

/** Non-indexed triangle list: 9 floats per triangle (v0,v1,v2 × XYZ). */
export type AutoOrientPositionInput = {
  positions: Float32Array
}

/** Indexed mesh. */
export type AutoOrientIndexedInput = {
  vertices: Float32Array
  indices: Uint32Array
}

export type AutoOrientInput = AutoOrientPositionInput | AutoOrientIndexedInput

export type AutoOrientResult = {
  /** XYZ Euler rotation in degrees to apply to the mesh transform. */
  rotationEulerDegXyz: [number, number, number]
  /** Weighted score of the chosen orientation (lower is better). */
  score: number
  /** Human-readable note about which orientation won and why. */
  reason: string
  /** Number of candidate orientations actually scored. */
  candidatesEvaluated: number
}

export type AutoOrientOptions = {
  /** Hard cap on candidate orientations to evaluate. Default 50. */
  maxCandidates?: number
  /** Cosine-similarity threshold for deduping candidate normals. Default 0.99. */
  dedupeCosTol?: number
  /** Overhang angle threshold in degrees (faces tilted past this need support). Default 45. */
  overhangAngleDeg?: number
  /** Distance from min-Z (in mm) considered "on the bed". Default 0.05 mm. */
  bottomEpsMm?: number
  /** Weight of overhang area in the score (higher = penalize overhangs more). Default 1.0. */
  overhangWeight?: number
  /** Weight of inverse-bottom-area in the score. Default 0.5. */
  bottomWeight?: number
  /** Weight of centre-of-gravity height in the score. Default 0.05. */
  cogWeight?: number
}

// ── Defaults ────────────────────────────────────────────────────────────────

const DEFAULTS = {
  maxCandidates: 50,
  dedupeCosTol: 0.99,
  overhangAngleDeg: 45,
  bottomEpsMm: 0.05,
  overhangWeight: 1.0,
  bottomWeight: 0.5,
  cogWeight: 0.05
} as const

const EPS = 1e-9

// ── Vec3 helpers (pure, no allocations beyond return) ───────────────────────

type Vec3 = readonly [number, number, number]
type MutVec3 = [number, number, number]

function vec3Sub(a: Vec3, b: Vec3): MutVec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function vec3Cross(a: Vec3, b: Vec3): MutVec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function vec3Dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function vec3Length(a: Vec3): number {
  return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2])
}

function vec3Normalize(a: Vec3): MutVec3 | null {
  const len = vec3Length(a)
  if (len < EPS) return null
  return [a[0] / len, a[1] / len, a[2] / len]
}

/** Triangle normal (unnormalized) via (v1-v0) × (v2-v0). */
function triNormalRaw(v0: Vec3, v1: Vec3, v2: Vec3): MutVec3 {
  return vec3Cross(vec3Sub(v1, v0), vec3Sub(v2, v0))
}

/** Triangle area = 0.5 * |cross|. */
function triAreaFromRawNormal(n: Vec3): number {
  return 0.5 * vec3Length(n)
}

// ── Input normalisation ─────────────────────────────────────────────────────

/** Flatten input mesh to a Float32Array of triangle positions (9 floats/triangle). */
function flattenInput(input: AutoOrientInput): Float32Array {
  if ('positions' in input) return input.positions
  const { vertices, indices } = input
  const out = new Float32Array(indices.length * 3)
  let o = 0
  for (let i = 0; i < indices.length; i++) {
    const vi = indices[i]! * 3
    out[o++] = vertices[vi]!
    out[o++] = vertices[vi + 1]!
    out[o++] = vertices[vi + 2]!
  }
  return out
}

// ── Candidate-normal selection ──────────────────────────────────────────────

type Candidate = {
  /** Unit "down" normal in mesh space. */
  n: MutVec3
  /** Cumulative triangle area whose face normal matches this candidate. */
  weightArea: number
  /** Source tag (debug / reason text). */
  source: 'mesh' | 'cardinal'
}

const CARDINAL_NORMALS: ReadonlyArray<MutVec3> = [
  [0, 0, -1],
  [0, 0, 1],
  [0, -1, 0],
  [0, 1, 0],
  [-1, 0, 0],
  [1, 0, 0]
]

/**
 * Build deduplicated candidate "down" normals from triangle face normals + cardinal axes.
 * Returns up to `maxCandidates` entries, sorted by total face area (largest first)
 * after the cardinal axes are merged in. Cardinals always survive deduping
 * (we add them last and only if no equivalent mesh normal already exists).
 */
function buildCandidateNormals(
  positions: Float32Array,
  maxCandidates: number,
  dedupeCosTol: number
): Candidate[] {
  const triCount = Math.floor(positions.length / 9)
  if (triCount < 1) return CARDINAL_NORMALS.map((n) => ({ n: [...n] as MutVec3, weightArea: 0, source: 'cardinal' as const }))

  const buckets: Candidate[] = []

  const tryMerge = (n: MutVec3, area: number, source: 'mesh' | 'cardinal'): void => {
    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i]!
      const dot = vec3Dot(b.n, n)
      if (dot >= dedupeCosTol) {
        b.weightArea += area
        return
      }
    }
    buckets.push({ n, weightArea: area, source })
  }

  for (let t = 0; t < triCount; t++) {
    const o = t * 9
    const v0: Vec3 = [positions[o]!, positions[o + 1]!, positions[o + 2]!]
    const v1: Vec3 = [positions[o + 3]!, positions[o + 4]!, positions[o + 5]!]
    const v2: Vec3 = [positions[o + 6]!, positions[o + 7]!, positions[o + 8]!]
    const raw = triNormalRaw(v0, v1, v2)
    const area = triAreaFromRawNormal(raw)
    if (area < EPS) continue
    const n = vec3Normalize(raw)
    if (!n) continue
    tryMerge(n, area, 'mesh')
  }

  // Always include cardinal axes as candidates (cheap and grounds the search).
  for (const c of CARDINAL_NORMALS) {
    tryMerge([c[0], c[1], c[2]], 0, 'cardinal')
  }

  // Sort by face area (largest first). Cardinals with 0 area drop to the back
  // but stay in the top-50 because there are only 6.
  buckets.sort((a, b) => b.weightArea - a.weightArea)
  if (buckets.length > maxCandidates) buckets.length = maxCandidates
  return buckets
}

// ── Rotation helpers ────────────────────────────────────────────────────────

type Mat3 = readonly [number, number, number, number, number, number, number, number, number]

/**
 * Build the rotation matrix R that maps `from` (unit) to `to` (unit).
 * Uses Rodrigues' formula. Handles the antipodal / aligned cases.
 */
function rotationFromTo(from: Vec3, to: Vec3): Mat3 {
  const d = vec3Dot(from, to)
  if (d > 1 - EPS) {
    // Already aligned.
    return [1, 0, 0, 0, 1, 0, 0, 0, 1]
  }
  if (d < -1 + EPS) {
    // Antipodal: 180° rotation around any axis perpendicular to `from`.
    const axisCandidate: Vec3 = Math.abs(from[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
    const axis = vec3Normalize(vec3Cross(from, axisCandidate))!
    // 180° around `axis` => R = 2 a aᵀ - I
    const [ax, ay, az] = axis
    return [
      2 * ax * ax - 1,
      2 * ax * ay,
      2 * ax * az,
      2 * ax * ay,
      2 * ay * ay - 1,
      2 * ay * az,
      2 * ax * az,
      2 * ay * az,
      2 * az * az - 1
    ]
  }
  const v = vec3Cross(from, to)
  const s = vec3Length(v)
  const c = d
  const [vx, vy, vz] = v
  // K = skew(v); R = I + K + K² * (1-c)/s²; using closed form for numerical stability.
  const k = (1 - c) / (s * s)
  return [
    1 + k * (-vz * vz - vy * vy),
    -vz + k * (vx * vy),
    vy + k * (vx * vz),
    vz + k * (vx * vy),
    1 + k * (-vz * vz - vx * vx),
    -vx + k * (vy * vz),
    -vy + k * (vx * vz),
    vx + k * (vy * vz),
    1 + k * (-vy * vy - vx * vx)
  ]
}

/** Apply 3x3 matrix to a vec3. */
function mat3MulVec3(m: Mat3, v: Vec3): MutVec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2]
  ]
}

/**
 * Extract XYZ-Euler angles (in radians) from a rotation matrix.
 * Uses the convention R = Rz * Ry * Rx (Three.js default 'XYZ' Euler order),
 * so that the returned (rx, ry, rz) reproduces R via that compose order.
 *
 * Three.js: new Euler(x, y, z, 'XYZ') => R = Rx * Ry * Rz applied right-to-left,
 * which is the same as R = Rx_left * Ry_middle * Rz_right in column-vector form.
 * Decomposition formulas below match three/src/math/Euler.js setFromRotationMatrix
 * ('XYZ' order).
 */
function eulerXyzFromMatrix(m: Mat3): MutVec3 {
  // m row-major; matches Three.js Matrix4 elements ordering convention via:
  //   m11=m[0], m12=m[1], m13=m[2], m21=m[3], m22=m[4], m23=m[5], m31=m[6], m32=m[7], m33=m[8]
  // Three.js 'XYZ': y = asin(clamp(m13, -1, 1))
  const m13 = m[2]
  const y = Math.asin(Math.max(-1, Math.min(1, m13)))
  let x: number
  let z: number
  if (Math.abs(m13) < 0.9999999) {
    x = Math.atan2(-m[5], m[8]) // -m23 / m33
    z = Math.atan2(-m[1], m[0]) // -m12 / m11
  } else {
    // Gimbal lock fallback.
    x = Math.atan2(m[7], m[4]) //  m32 / m22
    z = 0
  }
  return [x, y, z]
}

function radToDeg(r: number): number {
  return (r * 180) / Math.PI
}

// ── Scoring ─────────────────────────────────────────────────────────────────

type ScoreBreakdown = {
  score: number
  overhangArea: number
  bottomArea: number
  totalArea: number
  cogZ: number
}

/**
 * Score a candidate orientation. Returns the weighted score; lower is better.
 * The mesh is rotated in-place into a scratch buffer via the rotation matrix.
 *
 * Performance: O(triCount). No per-triangle allocation; vec3 helpers run on inlined locals.
 */
function scoreOrientation(
  positions: Float32Array,
  R: Mat3,
  opts: Required<AutoOrientOptions>
): ScoreBreakdown {
  const triCount = Math.floor(positions.length / 9)
  const overhangCosThreshold = -Math.cos((opts.overhangAngleDeg * Math.PI) / 180) // e.g. -cos(45°) ≈ -0.7071
  // First pass: find minZ of rotated mesh + accumulate sum of vertex Z for COG.
  let minZ = Infinity
  let sumZ = 0
  let vertCount = 0

  // Allocate one scratch buffer for rotated vertices.
  const rotated = new Float32Array(triCount * 9)
  for (let t = 0; t < triCount; t++) {
    const o = t * 9
    for (let v = 0; v < 3; v++) {
      const i = o + v * 3
      const x = positions[i]!
      const y = positions[i + 1]!
      const z = positions[i + 2]!
      const rx = R[0] * x + R[1] * y + R[2] * z
      const ry = R[3] * x + R[4] * y + R[5] * z
      const rz = R[6] * x + R[7] * y + R[8] * z
      rotated[i] = rx
      rotated[i + 1] = ry
      rotated[i + 2] = rz
      if (rz < minZ) minZ = rz
      sumZ += rz
      vertCount++
    }
  }
  const cogZ = vertCount > 0 ? sumZ / vertCount : 0

  // Second pass: accumulate areas in three buckets.
  let overhangArea = 0
  let bottomArea = 0
  let totalArea = 0
  const bottomCut = minZ + opts.bottomEpsMm

  for (let t = 0; t < triCount; t++) {
    const o = t * 9
    const v0x = rotated[o]!,
      v0y = rotated[o + 1]!,
      v0z = rotated[o + 2]!
    const v1x = rotated[o + 3]!,
      v1y = rotated[o + 4]!,
      v1z = rotated[o + 5]!
    const v2x = rotated[o + 6]!,
      v2y = rotated[o + 7]!,
      v2z = rotated[o + 8]!
    // Edge vectors.
    const e1x = v1x - v0x,
      e1y = v1y - v0y,
      e1z = v1z - v0z
    const e2x = v2x - v0x,
      e2y = v2y - v0y,
      e2z = v2z - v0z
    // Raw cross.
    const nx = e1y * e2z - e1z * e2y
    const ny = e1z * e2x - e1x * e2z
    const nz = e1x * e2y - e1y * e2x
    const nlen = Math.sqrt(nx * nx + ny * ny + nz * nz)
    if (nlen < EPS) continue
    const area = 0.5 * nlen
    totalArea += area
    const nzNorm = nz / nlen // unit normal Z component (post-rotation)

    // Bottom area: all three verts within bottomEpsMm of minZ AND face pointing down.
    if (nzNorm < 0 && v0z <= bottomCut && v1z <= bottomCut && v2z <= bottomCut) {
      bottomArea += area
    }
    // Overhang area: face points downward past the threshold,
    // but isn't already counted as bottom-resting.
    //
    // overhangAngleDeg = 45° → a face whose normal points "more than 45° below
    // horizontal" needs support. That is: nzNorm < -cos(45°) ≈ -0.707.
    //
    // We compare the unit-normal's z component to -cos(threshold). Faces resting
    // on the bed (nzNorm ≈ -1) are excluded so a perfectly-flat bottom isn't
    // double-penalised.
    else if (nzNorm < overhangCosThreshold) {
      overhangArea += area
    }
  }

  const totalAreaSafe = Math.max(EPS, totalArea)
  const bottomRatio = totalAreaSafe / (bottomArea + EPS)
  const score = opts.overhangWeight * overhangArea + opts.bottomWeight * bottomRatio + opts.cogWeight * cogZ
  return { score, overhangArea, bottomArea, totalArea, cogZ }
}

// ── Public entry ────────────────────────────────────────────────────────────

/**
 * Pick the best rotation for FDM printing.
 *
 * @param input Either an indexed mesh ({ vertices, indices }) or a flat
 *              triangle-positions buffer ({ positions }). See `triangulateBinaryStl`
 *              in `src/shared/stl-binary-preview.ts` for the source format.
 * @param options Optional weights / thresholds. Defaults are tuned for FDM.
 * @returns The recommended rotation as XYZ Euler in degrees plus a score and reason.
 */
export function autoOrient(input: AutoOrientInput, options: AutoOrientOptions = {}): AutoOrientResult {
  const opts: Required<AutoOrientOptions> = {
    maxCandidates: options.maxCandidates ?? DEFAULTS.maxCandidates,
    dedupeCosTol: options.dedupeCosTol ?? DEFAULTS.dedupeCosTol,
    overhangAngleDeg: options.overhangAngleDeg ?? DEFAULTS.overhangAngleDeg,
    bottomEpsMm: options.bottomEpsMm ?? DEFAULTS.bottomEpsMm,
    overhangWeight: options.overhangWeight ?? DEFAULTS.overhangWeight,
    bottomWeight: options.bottomWeight ?? DEFAULTS.bottomWeight,
    cogWeight: options.cogWeight ?? DEFAULTS.cogWeight
  }
  const positions = flattenInput(input)
  if (positions.length < 9) {
    return {
      rotationEulerDegXyz: [0, 0, 0],
      score: 0,
      reason: 'Empty mesh; no rotation applied.',
      candidatesEvaluated: 0
    }
  }
  const candidates = buildCandidateNormals(positions, opts.maxCandidates, opts.dedupeCosTol)
  if (candidates.length === 0) {
    return {
      rotationEulerDegXyz: [0, 0, 0],
      score: 0,
      reason: 'No valid candidate normals; no rotation applied.',
      candidatesEvaluated: 0
    }
  }

  let bestIdx = -1
  let bestScore = Infinity
  let bestEuler: MutVec3 = [0, 0, 0]
  let bestBreakdown: ScoreBreakdown | null = null

  // Always include the identity (no rotation) as the score baseline so we never
  // make a clearly-worse choice than the user's incoming orientation.
  const idEulerRad: MutVec3 = [0, 0, 0]
  const identityR: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]
  const idBreakdown = scoreOrientation(positions, identityR, opts)
  if (idBreakdown.score < bestScore) {
    bestScore = idBreakdown.score
    bestEuler = idEulerRad
    bestIdx = -1
    bestBreakdown = idBreakdown
  }

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!
    // Rotate so candidate normal points to -Z (mesh down).
    const R = rotationFromTo(c.n, [0, 0, -1])
    const breakdown = scoreOrientation(positions, R, opts)
    if (breakdown.score < bestScore) {
      bestScore = breakdown.score
      bestEuler = eulerXyzFromMatrix(R)
      bestIdx = i
      bestBreakdown = breakdown
    }
  }

  const rotDeg: [number, number, number] = [radToDeg(bestEuler[0]), radToDeg(bestEuler[1]), radToDeg(bestEuler[2])]
  const reason =
    bestIdx === -1
      ? `Identity orientation already optimal (overhang ${bestBreakdown!.overhangArea.toFixed(1)}mm², bottom ${bestBreakdown!.bottomArea.toFixed(1)}mm²).`
      : `Picked ${candidates[bestIdx]!.source} normal ` +
        `(${candidates[bestIdx]!.n.map((v) => v.toFixed(2)).join(',')}); ` +
        `overhang ${bestBreakdown!.overhangArea.toFixed(1)}mm², ` +
        `bottom ${bestBreakdown!.bottomArea.toFixed(1)}mm², ` +
        `cogZ ${bestBreakdown!.cogZ.toFixed(2)}mm.`

  return {
    rotationEulerDegXyz: rotDeg,
    score: bestScore,
    reason,
    // Identity isn't a candidate slot per se, but it's evaluated, so report +1.
    candidatesEvaluated: candidates.length + 1
  }
}

// ── Internal exports for unit tests only ────────────────────────────────────

/** @internal — exposed so tests can validate per-candidate scoring. */
export const __internals = {
  flattenInput,
  buildCandidateNormals,
  rotationFromTo,
  eulerXyzFromMatrix,
  scoreOrientation,
  DEFAULTS
}
