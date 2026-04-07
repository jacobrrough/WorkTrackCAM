import { readFile } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import {
  rollActiveAssemblyStats,
  type AssemblyComponent,
  type AssemblyFile,
  type AssemblyInterferenceReport
} from '../shared/assembly-schema'
import {
  isLikelyAsciiStl,
  iterateBinaryStlTriangles,
  parseBinaryStl,
  readStlFirstTriangleVertices,
  type StlBounds,
  type Vec3
} from './stl'

/** Per-mesh triangle cap for narrow phase (memory / time). */
export const NARROW_PHASE_MAX_TRIANGLES_PER_MESH = 12_000
/** Max triangle–triangle SAT calls per component pair. */
export const NARROW_PHASE_MAX_SAT_TESTS_PER_PAIR = 400_000
/** When a triangle’s index span in any axis exceeds this, bucket it as “large” (test against every B tri). */
const LARGE_TRI_CELL_SPAN = 26
/** Cap total grid cell visits for one component-pair narrow phase (all B triangles). */
const MAX_TOTAL_CELL_VISITS = 2_000_000

export type MeshInstance = {
  id: string
  name: string
  worldMin: [number, number, number]
  worldMax: [number, number, number]
  firstTriWorld: [Vec3, Vec3, Vec3] | null
}

type WorldTri = [Vec3, Vec3, Vec3]
type TriBox = { min: [number, number, number]; max: [number, number, number] }

type ResolvedMesh = {
  component: AssemblyComponent
  mesh: MeshInstance
  buffer: Buffer
  absPath: string
}

function degToRad(d: number): number {
  return (d * Math.PI) / 180
}

/**
 * Rotation matrix (column-major layout for `matVec`) matching common XYZ Euler order: R = Rz · Ry · Rx.
 */
function rotationMatrixZyxDegrees(rxDeg: number, ryDeg: number, rzDeg: number): readonly number[] {
  const rx = degToRad(rxDeg)
  const ry = degToRad(ryDeg)
  const rz = degToRad(rzDeg)
  const cx = Math.cos(rx)
  const sx = Math.sin(rx)
  const cy = Math.cos(ry)
  const sy = Math.sin(ry)
  const cz = Math.cos(rz)
  const sz = Math.sin(rz)
  const r00 = cy * cz
  const r01 = sy * sx * cz - cx * sz
  const r02 = sy * cx * cz + sx * sz
  const r10 = cy * sz
  const r11 = sy * sx * sz + cx * cz
  const r12 = sy * cx * sz - sx * cz
  const r20 = -sy
  const r21 = cy * sx
  const r22 = cy * cx
  return [r00, r01, r02, r10, r11, r12, r20, r21, r22]
}

function matVec(m: readonly number[], v: Vec3): [number, number, number] {
  return [
    m[0]! * v[0] + m[1]! * v[1] + m[2]! * v[2],
    m[3]! * v[0] + m[4]! * v[1] + m[5]! * v[2],
    m[6]! * v[0] + m[7]! * v[1] + m[8]! * v[2]
  ]
}

/** Resolve `meshPath` under `projectDir` or return null if traversal escapes the project. */
export function safeProjectMeshPath(projectDir: string, meshPath: string): string | null {
  const trimmed = meshPath.trim().replace(/\\/g, '/')
  if (!trimmed || trimmed.includes('\0')) return null
  const root = resolve(projectDir)
  const abs = resolve(root, trimmed)
  const rel = relative(root, abs)
  if (rel === '..' || rel.startsWith(`..${sep}`)) return null
  return abs
}

function worldAabbFromLocalBounds(
  bounds: StlBounds,
  t: AssemblyComponent['transform']
): { min: [number, number, number]; max: [number, number, number] } {
  const m = rotationMatrixZyxDegrees(t.rxDeg, t.ryDeg, t.rzDeg)
  const corners: [number, number, number][] = []
  const [lx, ly, lz] = bounds.min
  const [hx, hy, hz] = bounds.max
  for (const x of [lx, hx]) {
    for (const y of [ly, hy]) {
      for (const z of [lz, hz]) {
        const w = matVec(m, [x, y, z])
        corners.push([w[0] + t.x, w[1] + t.y, w[2] + t.z])
      }
    }
  }
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity
  for (const [x, y, z] of corners) {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    minZ = Math.min(minZ, z)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
    maxZ = Math.max(maxZ, z)
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] }
}

function transformTriangleWorld(tri: [Vec3, Vec3, Vec3], t: AssemblyComponent['transform']): WorldTri {
  const m = rotationMatrixZyxDegrees(t.rxDeg, t.ryDeg, t.rzDeg)
  const map = (v: Vec3): Vec3 => {
    const w = matVec(m, v)
    return [w[0] + t.x, w[1] + t.y, w[2] + t.z]
  }
  return [map(tri[0]), map(tri[1]), map(tri[2])]
}

function aabbsOverlap(
  a: { min: [number, number, number]; max: [number, number, number] },
  b: { min: [number, number, number]; max: [number, number, number] }
): boolean {
  return (
    a.max[0] >= b.min[0] &&
    b.max[0] >= a.min[0] &&
    a.max[1] >= b.min[1] &&
    b.max[1] >= a.min[1] &&
    a.max[2] >= b.min[2] &&
    b.max[2] >= a.min[2]
  )
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function sub(a: Vec3, b: Vec3): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function cross(a: Vec3, b: Vec3): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function projectRange(verts: Vec3[], axis: Vec3): [number, number] {
  let min = dot(verts[0]!, axis)
  let max = min
  for (let i = 1; i < verts.length; i++) {
    const p = dot(verts[i]!, axis)
    min = Math.min(min, p)
    max = Math.max(max, p)
  }
  return [min, max]
}

function intervalOverlap(a: [number, number], b: [number, number]): boolean {
  return a[0] <= b[1] && b[0] <= a[1]
}

function satSeparates(ta: Vec3[], tb: Vec3[], axis: Vec3): boolean {
  const len2 = dot(axis, axis)
  if (len2 < 1e-24) return false
  const ra = projectRange(ta, axis)
  const rb = projectRange(tb, axis)
  return !intervalOverlap(ra, rb)
}

function axesForTrianglePair(t1: Vec3[], t2: Vec3[]): Vec3[] {
  const e1 = [sub(t1[1]!, t1[0]!), sub(t1[2]!, t1[1]!), sub(t1[0]!, t1[2]!)]
  const e2 = [sub(t2[1]!, t2[0]!), sub(t2[2]!, t2[1]!), sub(t2[0]!, t2[2]!)]
  const n1 = cross(sub(t1[1]!, t1[0]!), sub(t1[2]!, t1[0]!))
  const n2 = cross(sub(t2[1]!, t2[0]!), sub(t2[2]!, t2[0]!))
  const axes: Vec3[] = [n1, n2]
  for (const u of e1) {
    for (const v of e2) {
      axes.push(cross(u, v))
    }
  }
  return axes
}

/** SAT over two triangles (coplanar edge cases may glitch; adequate for mesh prototype). */
export function trianglesIntersectSatStub(ta: Vec3[], tb: Vec3[]): boolean {
  const axes = axesForTrianglePair(ta, tb)
  for (const ax of axes) {
    if (satSeparates(ta, tb, ax)) return false
  }
  return true
}

function triWorldAabb(t: WorldTri): TriBox {
  return {
    min: [
      Math.min(t[0][0], t[1][0], t[2][0]),
      Math.min(t[0][1], t[1][1], t[2][1]),
      Math.min(t[0][2], t[1][2], t[2][2])
    ],
    max: [
      Math.max(t[0][0], t[1][0], t[2][0]),
      Math.max(t[0][1], t[1][1], t[2][1]),
      Math.max(t[0][2], t[1][2], t[2][2])
    ]
  }
}

function unionWorldBox(
  a: { min: [number, number, number]; max: [number, number, number] },
  b: { min: [number, number, number]; max: [number, number, number] }
): { min: [number, number, number]; max: [number, number, number] } {
  return {
    min: [
      Math.min(a.min[0], b.min[0]),
      Math.min(a.min[1], b.min[1]),
      Math.min(a.min[2], b.min[2])
    ],
    max: [
      Math.max(a.max[0], b.max[0]),
      Math.max(a.max[1], b.max[1]),
      Math.max(a.max[2], b.max[2])
    ]
  }
}

function cellKey(ix: number, iy: number, iz: number): string {
  return `${ix},${iy},${iz}`
}

function addTriangleToGrid(
  grid: Map<string, number[]>,
  triIdx: number,
  abb: TriBox,
  origin: readonly [number, number, number],
  cellSize: number,
  largeBucket: number[]
): void {
  const inv = 1 / cellSize
  let ix0 = Math.floor((abb.min[0] - origin[0]) * inv)
  let ix1 = Math.floor((abb.max[0] - origin[0]) * inv)
  let iy0 = Math.floor((abb.min[1] - origin[1]) * inv)
  let iy1 = Math.floor((abb.max[1] - origin[1]) * inv)
  let iz0 = Math.floor((abb.min[2] - origin[2]) * inv)
  let iz1 = Math.floor((abb.max[2] - origin[2]) * inv)
  if (ix0 > ix1) [ix0, ix1] = [ix1, ix0]
  if (iy0 > iy1) [iy0, iy1] = [iy1, iy0]
  if (iz0 > iz1) [iz0, iz1] = [iz1, iz0]
  const sx = ix1 - ix0 + 1
  const sy = iy1 - iy0 + 1
  const sz = iz1 - iz0 + 1
  if (
    sx > LARGE_TRI_CELL_SPAN ||
    sy > LARGE_TRI_CELL_SPAN ||
    sz > LARGE_TRI_CELL_SPAN ||
    sx * sy * sz > 1_400
  ) {
    largeBucket.push(triIdx)
    return
  }
  for (let ix = ix0; ix <= ix1; ix++) {
    for (let iy = iy0; iy <= iy1; iy++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const k = cellKey(ix, iy, iz)
        let arr = grid.get(k)
        if (!arr) {
          arr = []
          grid.set(k, arr)
        }
        arr.push(triIdx)
      }
    }
  }
}

export type NarrowPhaseResult = {
  hit: boolean
  satTests: number
  incomplete: boolean
  note?: string
}

export function narrowPhaseMeshPair(
  trisA: WorldTri[],
  trisB: WorldTri[],
  boxA: MeshInstance,
  boxB: MeshInstance,
  opts?: { maxSatTests?: number }
): NarrowPhaseResult {
  const maxSat = opts?.maxSatTests ?? NARROW_PHASE_MAX_SAT_TESTS_PER_PAIR
  if (trisA.length === 0 || trisB.length === 0) {
    return { hit: false, satTests: 0, incomplete: true, note: 'empty triangle list' }
  }
  const union = unionWorldBox(
    { min: boxA.worldMin, max: boxA.worldMax },
    { min: boxB.worldMin, max: boxB.worldMax }
  )
  const dx = union.max[0] - union.min[0]
  const dy = union.max[1] - union.min[1]
  const dz = union.max[2] - union.min[2]
  const ext = Math.max(dx, dy, dz, 1e-9)
  const cellSize = Math.max(ext / 28, 1e-9)
  const origin = union.min

  const grid = new Map<string, number[]>()
  const largeA: number[] = []
  for (let i = 0; i < trisA.length; i++) {
    addTriangleToGrid(grid, i, triWorldAabb(trisA[i]!), origin, cellSize, largeA)
  }

  let satTests = 0
  const tested = new Set<string>()
  let cellVisits = 0
  let incomplete = false
  let note: string | undefined

  outer: for (let j = 0; j < trisB.length; j++) {
    const tb = trisB[j]!
    const abbB = triWorldAabb(tb)
    if (!aabbsOverlap(abbB, union)) continue

    const inv = 1 / cellSize
    let ix0 = Math.floor((abbB.min[0] - origin[0]) * inv)
    let ix1 = Math.floor((abbB.max[0] - origin[0]) * inv)
    let iy0 = Math.floor((abbB.min[1] - origin[1]) * inv)
    let iy1 = Math.floor((abbB.max[1] - origin[1]) * inv)
    let iz0 = Math.floor((abbB.min[2] - origin[2]) * inv)
    let iz1 = Math.floor((abbB.max[2] - origin[2]) * inv)
    if (ix0 > ix1) [ix0, ix1] = [ix1, ix0]
    if (iy0 > iy1) [iy0, iy1] = [iy1, iy0]
    if (iz0 > iz1) [iz0, iz1] = [iz1, iz0]

    const candidates = new Set<number>(largeA)
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iy = iy0; iy <= iy1; iy++) {
        for (let iz = iz0; iz <= iz1; iz++) {
          cellVisits++
          if (cellVisits > MAX_TOTAL_CELL_VISITS) {
            incomplete = true
            note = 'Spatial hash visit budget exceeded'
            break outer
          }
          const lst = grid.get(cellKey(ix, iy, iz))
          if (lst) {
            for (const ai of lst) candidates.add(ai)
          }
        }
      }
    }

    for (const ai of candidates) {
      const pkey = `${ai}_${j}`
      if (tested.has(pkey)) continue
      tested.add(pkey)
      const ta = trisA[ai]!
      if (!aabbsOverlap(triWorldAabb(ta), abbB)) continue
      satTests++
      if (satTests > maxSat) {
        incomplete = true
        note = `SAT test budget exceeded (${maxSat})`
        return { hit: false, satTests, incomplete, note }
      }
      const va: Vec3[] = [ta[0], ta[1], ta[2]]
      const vb: Vec3[] = [tb[0], tb[1], tb[2]]
      if (trianglesIntersectSatStub(va, vb)) {
        return { hit: true, satTests, incomplete: false }
      }
    }
  }

  return { hit: false, satTests, incomplete, note }
}

function extractWorldTriangles(
  buffer: Buffer,
  t: AssemblyComponent['transform'],
  maxTriangles: number
): { tris: WorldTri[]; fileTriangleCount: number; truncated: boolean } {
  const tris: WorldTri[] = []
  const res = iterateBinaryStlTriangles(buffer, maxTriangles, (v0, v1, v2) => {
    tris.push(transformTriangleWorld([v0, v1, v2], t))
  })
  return { tris, fileTriangleCount: res.fileTriangleCount, truncated: res.truncated }
}

async function tryLoadMeshBuffer(
  projectDir: string,
  c: AssemblyComponent
): Promise<
  { ok: true; buffer: Buffer; bounds: StlBounds; absPath: string } | { ok: false; warning: string }
> {
  const mp = c.meshPath?.trim()
  if (!mp) return { ok: false, warning: '' }
  const abs = safeProjectMeshPath(projectDir, mp)
  if (!abs) {
    return { ok: false, warning: `Unsafe or empty mesh path for "${c.name}" (${c.id}): ${mp}` }
  }
  let buf: Buffer
  try {
    buf = await readFile(abs)
  } catch {
    return { ok: false, warning: `Mesh not found for "${c.name}": ${mp}` }
  }
  if (isLikelyAsciiStl(buf)) {
    return { ok: false, warning: `ASCII STL not supported for "${c.name}" (${mp}); use binary STL.` }
  }
  let bounds: StlBounds
  try {
    bounds = parseBinaryStl(buf)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, warning: `Bad STL for "${c.name}" (${mp}): ${msg}` }
  }
  return { ok: true, buffer: buf, bounds, absPath: abs }
}

function meshInstanceFromLoad(
  c: AssemblyComponent,
  bounds: StlBounds,
  buffer: Buffer
): MeshInstance {
  const box = worldAabbFromLocalBounds(bounds, c.transform)
  const firstLocal = readStlFirstTriangleVertices(buffer)
  const firstTriWorld = firstLocal ? transformTriangleWorld(firstLocal, c.transform) : null
  return {
    id: c.id,
    name: c.name,
    worldMin: box.min,
    worldMax: box.max,
    firstTriWorld
  }
}

function transformKey(c: AssemblyComponent): string {
  const t = c.transform
  return `${t.x},${t.y},${t.z},${t.rxDeg},${t.ryDeg},${t.rzDeg}`
}

export async function buildAssemblyInterferenceReport(
  projectDir: string,
  asm: AssemblyFile,
  overrideTransforms?: Map<string, AssemblyComponent['transform']>
): Promise<AssemblyInterferenceReport> {
  const active = asm.components.filter((c) => !c.suppressed)
  const sameTransformPairs: { aId: string; bId: string; aName: string; bName: string }[] = []
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i]!
      const b = active[j]!
      const ta = overrideTransforms?.get(a.id) ?? a.transform
      const tb = overrideTransforms?.get(b.id) ?? b.transform
      if (
        ta.x === tb.x &&
        ta.y === tb.y &&
        ta.z === tb.z &&
        ta.rxDeg === tb.rxDeg &&
        ta.ryDeg === tb.ryDeg &&
        ta.rzDeg === tb.rzDeg
      ) {
        sameTransformPairs.push({ aId: a.id, bId: b.id, aName: a.name, bName: b.name })
      }
    }
  }

  const meshWarnings: string[] = []
  const resolved: ResolvedMesh[] = []
  for (const c of active) {
    const lr = await tryLoadMeshBuffer(projectDir, c)
    if (!lr.ok) {
      if (lr.warning) meshWarnings.push(lr.warning)
      continue
    }
    resolved.push({
      component: c,
      mesh: meshInstanceFromLoad(
        { ...c, transform: overrideTransforms?.get(c.id) ?? c.transform },
        lr.bounds,
        lr.buffer
      ),
      buffer: lr.buffer,
      absPath: lr.absPath
    })
  }

  const meshes = resolved.map((r) => r.mesh)

  const meshAabbOverlapPairs: { aId: string; bId: string; aName: string; bName: string }[] = []
  const triangleStubPairs: { aId: string; bId: string; aName: string; bName: string }[] = []
  const narrowPhaseOverlapPairs: { aId: string; bId: string; aName: string; bName: string }[] = []
  const meshNarrowPhaseNotes: string[] = []

  const triCache = new Map<string, { tris: WorldTri[]; fileTriangleCount: number; truncated: boolean }>()
  function getWorldTris(r: ResolvedMesh): { tris: WorldTri[]; fileTriangleCount: number; truncated: boolean } {
    const k = `${r.absPath}|${transformKey(r.component)}`
    let e = triCache.get(k)
    if (!e) {
      e = extractWorldTriangles(r.buffer, r.component.transform, NARROW_PHASE_MAX_TRIANGLES_PER_MESH)
      triCache.set(k, e)
      if (e.truncated && e.fileTriangleCount > e.tris.length) {
        meshNarrowPhaseNotes.push(
          `"${r.component.name}": narrow phase uses first ${e.tris.length} of ${e.fileTriangleCount} triangle(s)`
        )
      }
    }
    return e
  }

  type PairNarrow = 'hit' | 'clear' | 'incomplete' | 'skipped'
  const pairNarrow = new Map<string, PairNarrow>()

  for (let i = 0; i < resolved.length; i++) {
    for (let j = i + 1; j < resolved.length; j++) {
      const ra = resolved[i]!
      const rb = resolved[j]!
      const a = ra.mesh
      const b = rb.mesh
      const boxA = { min: a.worldMin, max: a.worldMax }
      const boxB = { min: b.worldMin, max: b.worldMax }
      if (!aabbsOverlap(boxA, boxB)) continue

      const pkey = `${a.id}\0${b.id}`
      meshAabbOverlapPairs.push({ aId: a.id, bId: b.id, aName: a.name, bName: b.name })

      const ta = a.firstTriWorld
      const tb = b.firstTriWorld
      if (ta && tb && trianglesIntersectSatStub([ta[0], ta[1], ta[2]], [tb[0], tb[1], tb[2]])) {
        triangleStubPairs.push({ aId: a.id, bId: b.id, aName: a.name, bName: b.name })
      }

      const dataA = getWorldTris(ra)
      const dataB = getWorldTris(rb)
      if (dataA.tris.length === 0 || dataB.tris.length === 0) {
        pairNarrow.set(pkey, 'skipped')
        continue
      }

      const n =
        dataA.tris.length <= dataB.tris.length
          ? narrowPhaseMeshPair(dataA.tris, dataB.tris, a, b)
          : narrowPhaseMeshPair(dataB.tris, dataA.tris, b, a)

      if (n.hit) {
        narrowPhaseOverlapPairs.push({ aId: a.id, bId: b.id, aName: a.name, bName: b.name })
        pairNarrow.set(pkey, 'hit')
      } else if (n.incomplete) {
        pairNarrow.set(pkey, 'incomplete')
        if (n.note) meshNarrowPhaseNotes.push(`Pair ${a.name}|${b.name}: ${n.note}`)
      } else {
        pairNarrow.set(pkey, 'clear')
      }
    }
  }

  const conflictingPairs: { aId: string; bId: string }[] = []
  for (const p of meshAabbOverlapPairs) {
    const pkey = `${p.aId}\0${p.bId}`
    const state = pairNarrow.get(pkey)
    if (state === 'clear') continue
    conflictingPairs.push({ aId: p.aId, bId: p.bId })
  }

  const { jointCounts, totalBomQuantity, motionIsolatedCount } = rollActiveAssemblyStats(active)
  let message = `Stub: ${active.length} non-suppressed component(s).`
  if (meshes.length > 0) {
    message += ` Mesh check: ${meshes.length} binary STL(s), ${meshAabbOverlapPairs.length} AABB-overlap pair(s)`
    if (narrowPhaseOverlapPairs.length > 0) {
      message += `; narrow-phase SAT: ${narrowPhaseOverlapPairs.length} pair(s) with triangle hit(s)`
    }
    if (triangleStubPairs.length > 0) {
      message += `; first-triangle SAT positive on ${triangleStubPairs.length} pair(s) (diagnostic)`
    }
    message += '.'
  } else {
    message += ' No usable meshPath / binary meshes — placement heuristic only.'
  }
  if (sameTransformPairs.length > 0) {
    message += ` ${sameTransformPairs.length} pair(s) share identical transforms — verify placement.`
  }

  return {
    ok: true as const,
    message,
    conflictingPairs,
    sameTransformPairs: sameTransformPairs.length ? sameTransformPairs : undefined,
    meshResolvedCount: meshes.length > 0 ? meshes.length : undefined,
    meshAabbOverlapPairs: meshAabbOverlapPairs.length ? meshAabbOverlapPairs : undefined,
    triangleStubPairs: triangleStubPairs.length ? triangleStubPairs : undefined,
    narrowPhaseOverlapPairs: narrowPhaseOverlapPairs.length ? narrowPhaseOverlapPairs : undefined,
    meshNarrowPhaseNotes: meshNarrowPhaseNotes.length ? meshNarrowPhaseNotes : undefined,
    meshWarnings: meshWarnings.length ? meshWarnings : undefined,
    assemblyStats: {
      activeComponentCount: active.length,
      totalBomQuantity,
      jointCounts,
      motionIsolatedCount: motionIsolatedCount > 0 ? motionIsolatedCount : undefined
    }
  }
}
