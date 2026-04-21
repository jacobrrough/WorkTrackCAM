/**
 * 4-Axis Mesh → Machine-Frame Transform
 *
 * THIS IS THE SINGLE SOURCE OF TRUTH for converting raw STL triangles into the
 * machine frame the CAM engine expects. The renderer's `mapGcodeToThreeEndpoints`
 * (in `gcode-toolpath-parse.ts`) already expects G-code in this frame, so getting
 * `frame.ts` right means the toolpath visibly overlays the displayed mesh — no
 * renderer changes are required.
 *
 * Frame contract (matches the renderer convention):
 *   X = axial position along the rotation axis, in `[0, stockLengthMm]`
 *       (X=0 is the chuck face)
 *   Y = perpendicular component (the Three.js viewer "depth" axis after the
 *       Y↔Z swap baked in by `ipc-fabrication.ts:137-139`)
 *   Z = perpendicular component aligned with the renderer's "A=0 radial up"
 *       direction (Three.js viewer "up" after the Y↔Z swap)
 *   A = rotation about +X (degrees), measured such that:
 *       A=0   → radial direction = +Z (renderer's `viewerY = axisY + r*cos(0)`)
 *       A=90° → radial direction = +Y (renderer's `viewerZ = axisZ + y + r*sin(90)`)
 *
 * Transform pipeline (must replicate `binary-stl-placement.ts` order):
 *   1. center_origin   — translate raw triangles so bbox is centered at origin
 *   2. scale           — apply user gizmo scale (with Y↔Z swap)
 *   3. rotate          — apply user gizmo Euler rotation (with Y↔Z swap)
 *   4. translate       — apply user gizmo position (with Y↔Z swap)
 *   5. machine X shift — add stock.lengthMm/2 so X spans `[0, stockLengthMm]`
 *
 * The Y↔Z swap is the same swap `ipc-fabrication.ts` makes when calling
 * `transformBinaryStlWithPlacement`: it passes the gizmo's Three.js Z component
 * as the STL Y component and vice-versa, because the viewer maps STL Y→Three.js Z
 * and STL Z→Three.js Y.
 *
 * `frame-parity.test.ts` asserts that this function reproduces the bake's output
 * modulo the axial X shift, for any input mesh and placement.
 */
import { rotateXYZDeg } from '../stl-vec3'
import type { Vec3 } from '../stl'

export type Triangle = readonly [Vec3, Vec3, Vec3]

/** Three.js viewer-space placement of the mesh from the user's gizmo. */
export type Placement = {
  position: { x: number; y: number; z: number }
  rotation: { x: number; y: number; z: number }
  scale: { x: number; y: number; z: number }
}

/** Stock cylinder geometry (rotary). */
export type Stock = {
  lengthMm: number
  diameterMm: number
}

export type Aabb = {
  min: Vec3
  max: Vec3
}

export type MeshFrameResult = {
  /** Transformed triangles in machine frame (X ∈ [0, stockLengthMm], Y/Z perpendicular). */
  triangles: Triangle[]
  /** AABB of transformed triangles in machine frame. */
  bbox: Aabb
  /** Maximum radial distance √(Y² + Z²) of any vertex from the rotation axis. */
  meshRadialMax: number
  /** Minimum radial distance √(Y² + Z²) (= 0 if mesh straddles or includes the axis). */
  meshRadialMin: number
  /** Non-fatal observations (e.g. degenerate input clamped to fallback). */
  warnings: string[]
}

const IDENTITY_PLACEMENT: Placement = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 }
}

/** Identity placement (no user transform). Use when reading an already-baked file. */
export function identityPlacement(): Placement {
  return {
    position: { ...IDENTITY_PLACEMENT.position },
    rotation: { ...IDENTITY_PLACEMENT.rotation },
    scale: { ...IDENTITY_PLACEMENT.scale }
  }
}

function bboxOf(triangles: Triangle[]): Aabb {
  if (triangles.length === 0) {
    return { min: [0, 0, 0], max: [0, 0, 0] }
  }
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (const tri of triangles) {
    for (const p of tri) {
      if (p[0] < minX) minX = p[0]
      if (p[1] < minY) minY = p[1]
      if (p[2] < minZ) minZ = p[2]
      if (p[0] > maxX) maxX = p[0]
      if (p[1] > maxY) maxY = p[1]
      if (p[2] > maxZ) maxZ = p[2]
    }
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Transform raw STL triangles into the CAM engine's machine frame.
 *
 * The pipeline must match `transformBinaryStlWithPlacement` in
 * `binary-stl-placement.ts`, with the Y↔Z swap that `ipc-fabrication.ts:137-139`
 * applies when calling that function. After that bake, an additional axial X
 * shift of `stock.lengthMm/2` is applied so the result is in machine frame
 * (X ∈ [0, stockLengthMm], chuck face at X=0).
 *
 * No silent re-centering is performed in Y or Z — the user's gizmo position is
 * the source of truth. Callers that want to detect "mesh extends past stock OD"
 * should consult `meshRadialMax` and reject in `validation.ts` rather than
 * clamping silently here.
 */
export function meshToMachineFrame(
  rawTriangles: Triangle[],
  placement: Placement,
  stock: Stock
): MeshFrameResult {
  const warnings: string[] = []

  if (rawTriangles.length === 0) {
    warnings.push('frame: input mesh has zero triangles')
    return {
      triangles: [],
      bbox: { min: [0, 0, 0], max: [0, 0, 0] },
      meshRadialMax: 0,
      meshRadialMin: 0,
      warnings
    }
  }

  // Step 1: bbox of raw triangles → translation that centers them at origin.
  const rawBbox = bboxOf(rawTriangles)
  const cx = (rawBbox.min[0] + rawBbox.max[0]) / 2
  const cy = (rawBbox.min[1] + rawBbox.max[1]) / 2
  const cz = (rawBbox.min[2] + rawBbox.max[2]) / 2

  // Steps 2-4 are encoded in this gizmo→STL mapping (Y↔Z swap matches
  // `ipc-fabrication.ts:137-139`):
  //   STL X ← gizmo X    (axial)
  //   STL Y ← gizmo Z    (Three.js viewer depth)
  //   STL Z ← gizmo Y    (Three.js viewer up — also "A=0 radial" in renderer)
  const sclX = placement.scale.x
  const sclY = placement.scale.z
  const sclZ = placement.scale.y
  const rotDeg: [number, number, number] = [
    placement.rotation.x,
    placement.rotation.z,
    placement.rotation.y
  ]
  const trnX = placement.position.x
  const trnY = placement.position.z
  const trnZ = placement.position.y

  // Step 5: machine-frame axial X shift.
  const halfLen = stock.lengthMm / 2

  const hasRot =
    Math.abs(rotDeg[0]) > 1e-6 ||
    Math.abs(rotDeg[1]) > 1e-6 ||
    Math.abs(rotDeg[2]) > 1e-6
  const hasScl =
    Math.abs(sclX - 1) > 1e-6 || Math.abs(sclY - 1) > 1e-6 || Math.abs(sclZ - 1) > 1e-6

  const out: Triangle[] = new Array(rawTriangles.length)
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  let radialMax = 0
  let radialMin = Infinity

  for (let i = 0; i < rawTriangles.length; i++) {
    const tri = rawTriangles[i]!
    const transformed: [Vec3, Vec3, Vec3] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
    for (let v = 0; v < 3; v++) {
      const p = tri[v]!
      // Center origin
      let x = p[0] - cx
      let y = p[1] - cy
      let z = p[2] - cz
      // Scale
      if (hasScl) {
        x *= sclX
        y *= sclY
        z *= sclZ
      }
      // Rotate
      if (hasRot) {
        const [rx, ry, rz] = rotateXYZDeg([x, y, z], rotDeg)
        x = rx
        y = ry
        z = rz
      }
      // Translate (gizmo translation, with Y↔Z swap already applied above)
      x += trnX
      y += trnY
      z += trnZ
      // Machine-frame axial shift
      x += halfLen
      transformed[v] = [x, y, z]
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (z < minZ) minZ = z
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
      if (z > maxZ) maxZ = z
      const r = Math.hypot(y, z)
      if (r > radialMax) radialMax = r
      if (r < radialMin) radialMin = r
    }
    out[i] = transformed
  }

  if (radialMin === Infinity) radialMin = 0

  return {
    triangles: out,
    bbox: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
    meshRadialMax: radialMax,
    meshRadialMin: radialMin,
    warnings
  }
}
