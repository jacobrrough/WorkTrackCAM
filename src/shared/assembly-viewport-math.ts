import { Euler, Quaternion, Vector3 } from 'three'

import type {
  AssemblyComponent,
  AssemblyExplodeViewMetadata,
  AssemblyKinematicAxisFrame,
  AssemblyWorldAxis
} from './assembly-schema'

export type { AssemblyWorldAxis }

/** 6-DoF placement used after kinematic preview (revolute / slider stubs). */
export type AssemblyTransform6 = {
  x: number
  y: number
  z: number
  rxDeg: number
  ryDeg: number
  rzDeg: number
}

function cloneTransform(t: AssemblyComponent['transform']): AssemblyTransform6 {
  return {
    x: t.x,
    y: t.y,
    z: t.z,
    rxDeg: t.rxDeg,
    ryDeg: t.ryDeg,
    rzDeg: t.rzDeg
  }
}

/** Rotate a point around a pivot in the world XY plane (axis +Z). */
export function rotatePointWorldZ(
  x: number,
  y: number,
  z: number,
  px: number,
  py: number,
  pz: number,
  deg: number
): [number, number, number] {
  const dx = x - px
  const dy = y - py
  const dz = z - pz
  const rad = (deg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return [px + dx * cos - dy * sin, py + dx * sin + dy * cos, pz + dz]
}

/**
 * Right-handed rotation of a point about a **world** axis through the pivot (degrees).
 * **x:** YZ plane; **y:** ZX plane; **z:** XY plane (same as `rotatePointWorldZ`).
 */
export function rotatePointWorldAxis(
  axis: AssemblyWorldAxis,
  x: number,
  y: number,
  z: number,
  px: number,
  py: number,
  pz: number,
  deg: number
): [number, number, number] {
  if (axis === 'z') return rotatePointWorldZ(x, y, z, px, py, pz, deg)
  const rad = (deg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = x - px
  const dy = y - py
  const dz = z - pz
  if (axis === 'x') {
    return [px + dx, py + dy * cos - dz * sin, pz + dy * sin + dz * cos]
  }
  return [px + dz * sin + dx * cos, py + dy, pz + dz * cos - dx * sin]
}

/** All instance ids in the subtree rooted at `rootId` (includes `rootId`), using active `parentId` links only. */
export function collectDescendantIds(rootId: string, active: AssemblyComponent[]): Set<string> {
  const children = new Map<string, string[]>()
  for (const c of active) {
    if (!c.parentId) continue
    const list = children.get(c.parentId) ?? []
    list.push(c.id)
    children.set(c.parentId, list)
  }
  const out = new Set<string>()
  const walk = (id: string) => {
    out.add(id)
    for (const ch of children.get(id) ?? []) walk(ch)
  }
  walk(rootId)
  return out
}

function depthFromRoot(id: string, byId: Map<string, AssemblyComponent>): number {
  let d = 0
  let cur: string | undefined = id
  const seen = new Set<string>()
  while (cur && seen.size < byId.size + 3) {
    if (seen.has(cur)) break
    seen.add(cur)
    const c = byId.get(cur)
    if (!c?.parentId || !byId.has(c.parentId)) break
    cur = c.parentId
    d++
  }
  return d
}

/**
 * Parent **local** +X/+Y/+Z as a unit vector in **world** space from the parent’s stored `transform` Euler (ZYX).
 * Used for **parent**-frame revolute/slider preview stubs only.
 */
export function worldAxisUnitFromParentEuler(
  rxDeg: number,
  ryDeg: number,
  rzDeg: number,
  ax: AssemblyWorldAxis
): [number, number, number] {
  const v = new Vector3(ax === 'x' ? 1 : 0, ax === 'y' ? 1 : 0, ax === 'z' ? 1 : 0)
  const e = new Euler(
    (rxDeg * Math.PI) / 180,
    (ryDeg * Math.PI) / 180,
    (rzDeg * Math.PI) / 180,
    'ZYX'
  )
  const q = new Quaternion().setFromEuler(e)
  v.applyQuaternion(q)
  return [v.x, v.y, v.z]
}

/** Right-handed rotation of a point about a **unit** axis through the pivot (degrees). */
export function rotatePointAboutUnitAxis(
  px: number,
  py: number,
  pz: number,
  x: number,
  y: number,
  z: number,
  ux: number,
  uy: number,
  uz: number,
  deg: number
): [number, number, number] {
  const len = Math.hypot(ux, uy, uz)
  if (len < 1e-12) return [x, y, z]
  const kx = ux / len
  const ky = uy / len
  const kz = uz / len
  const rad = (deg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = x - px
  const dy = y - py
  const dz = z - pz
  const dot = dx * kx + dy * ky + dz * kz
  const cx = ky * dz - kz * dy
  const cy = kz * dx - kx * dz
  const cz = kx * dy - ky * dx
  const c2 = 1 - cos
  return [
    px + dx * cos + cx * sin + kx * dot * c2,
    py + dy * cos + cy * sin + ky * dot * c2,
    pz + dz * cos + cz * sin + kz * dot * c2
  ]
}

/** Apply a rotation of `deg` about world unit axis (ux,uy,uz) to an Euler-ZYX triple (degrees). */
export function rotateEulerZYXByUnitAxisDeg(
  rxDeg: number,
  ryDeg: number,
  rzDeg: number,
  ux: number,
  uy: number,
  uz: number,
  deg: number
): { rxDeg: number; ryDeg: number; rzDeg: number } {
  const e = new Euler(
    (rxDeg * Math.PI) / 180,
    (ryDeg * Math.PI) / 180,
    (rzDeg * Math.PI) / 180,
    'ZYX'
  )
  const q = new Quaternion().setFromEuler(e)
  const axis = new Vector3(ux, uy, uz)
  if (axis.lengthSq() < 1e-18) {
    return { rxDeg, ryDeg, rzDeg }
  }
  axis.normalize()
  const qd = new Quaternion().setFromAxisAngle(axis, (deg * Math.PI) / 180)
  q.premultiply(qd)
  const e2 = new Euler().setFromQuaternion(q, 'ZYX')
  return {
    rxDeg: (e2.x * 180) / Math.PI,
    ryDeg: (e2.y * 180) / Math.PI,
    rzDeg: (e2.z * 180) / Math.PI
  }
}

function previewAxisWorldUnit(
  frame: AssemblyKinematicAxisFrame | undefined,
  axis: AssemblyWorldAxis | undefined,
  parentId: string | undefined,
  byId: Map<string, AssemblyComponent>
): [number, number, number] {
  const ax = axis ?? 'z'
  const cardinal = (): [number, number, number] =>
    ax === 'x' ? [1, 0, 0] : ax === 'y' ? [0, 1, 0] : [0, 0, 1]

  if ((frame ?? 'world') === 'world') return cardinal()

  const pid = parentId
  const parent = pid ? byId.get(pid) : undefined
  if (!parent) return cardinal()

  const t = parent.transform
  const [vx, vy, vz] = worldAxisUnitFromParentEuler(t.rxDeg, t.ryDeg, t.rzDeg, ax)
  const len = Math.hypot(vx, vy, vz)
  if (len < 1e-12) return cardinal()
  return [vx / len, vy / len, vz / len]
}

/**
 * Orthonormal in-plane basis **U**, **V** for a plane with unit normal **N** (right-handed: **N** × **U** = **V**).
 * Uses a world up reference with a singularity fallback when **N** is parallel to up.
 */
export function planarPreviewBasisFromNormalUnit(
  nx: number,
  ny: number,
  nz: number
): [[number, number, number], [number, number, number]] {
  const len = Math.hypot(nx, ny, nz)
  if (len < 1e-12) {
    return [
      [1, 0, 0],
      [0, 1, 0]
    ]
  }
  const nnx = nx / len
  const nny = ny / len
  const nnz = nz / len
  let upx = 0
  let upy = 1
  let upz = 0
  if (Math.abs(nny) > 0.95) {
    upx = 0
    upy = 0
    upz = 1
  }
  let ux = upy * nnz - upz * nny
  let uy = upz * nnx - upx * nnz
  let uz = upx * nny - upy * nnx
  let ulen = Math.hypot(ux, uy, uz)
  if (ulen < 1e-12) {
    upx = 1
    upy = 0
    upz = 0
    ux = upy * nnz - upz * nny
    uy = upz * nnx - upx * nnz
    uz = upx * nny - upy * nnx
    ulen = Math.hypot(ux, uy, uz)
  }
  if (ulen < 1e-12) {
    return [
      [1, 0, 0],
      [0, 1, 0]
    ]
  }
  ux /= ulen
  uy /= ulen
  uz /= ulen
  let vx = nny * uz - nnz * uy
  let vy = nnz * ux - nnx * uz
  let vz = nnx * uy - nny * ux
  const vlen = Math.hypot(vx, vy, vz)
  if (vlen < 1e-12) {
    return [
      [ux, uy, uz],
      [0, 1, 0]
    ]
  }
  vx /= vlen
  vy /= vlen
  vz /= vlen
  return [
    [ux, uy, uz],
    [vx, vy, vz]
  ]
}

function planarPreviewBasisWorldUnits(
  frame: AssemblyKinematicAxisFrame | undefined,
  normalAxis: AssemblyWorldAxis | undefined,
  parentId: string | undefined,
  byId: Map<string, AssemblyComponent>
): [[number, number, number], [number, number, number]] {
  const [nx, ny, nz] = previewAxisWorldUnit(frame, normalAxis ?? 'z', parentId, byId)
  return planarPreviewBasisFromNormalUnit(nx, ny, nz)
}

/**
 * World-space transforms for viewport preview: `slider` / `planar` translate subtrees; `revolute` and higher joints
 * rotate per stub order (see implementation). Shallow joints first; preview-only.
 */
export function computeAssemblyKinematicPreviewTransforms(
  active: AssemblyComponent[]
): Map<string, AssemblyTransform6> {
  const byId = new Map(active.map((c) => [c.id, c]))
  const transforms = new Map<string, AssemblyTransform6>()
  for (const c of active) {
    transforms.set(c.id, cloneTransform(c.transform))
  }

  const sliderNodes = active
    .filter((c) => c.joint === 'slider')
    .sort((a, b) => depthFromRoot(a.id, byId) - depthFromRoot(b.id, byId))

  for (const s of sliderNodes) {
    const mmRaw = s.jointState?.scalarMm ?? s.sliderPreviewMm
    if (mmRaw == null || !Number.isFinite(mmRaw)) continue
    const minM = s.jointLimits?.scalarMinMm ?? s.sliderPreviewMinMm ?? -1e6
    const maxM = s.jointLimits?.scalarMaxMm ?? s.sliderPreviewMaxMm ?? 1e6
    const lo = Math.min(minM, maxM)
    const hi = Math.max(minM, maxM)
    const mm = Math.max(lo, Math.min(hi, mmRaw))
    const [ux, uy, uz] = previewAxisWorldUnit(
      s.sliderPreviewAxisFrame,
      s.sliderPreviewAxis,
      s.parentId,
      byId
    )
    const tx = ux * mm
    const ty = uy * mm
    const tz = uz * mm

    const subtree = collectDescendantIds(s.id, active)
    for (const id of subtree) {
      const t = transforms.get(id)
      if (!t) continue
      transforms.set(id, {
        ...t,
        x: t.x + tx,
        y: t.y + ty,
        z: t.z + tz
      })
    }
  }

  const planarNodes = active
    .filter((c) => c.joint === 'planar')
    .sort((a, b) => depthFromRoot(a.id, byId) - depthFromRoot(b.id, byId))

  for (const pl of planarNodes) {
    const uRaw = pl.jointState?.uMm ?? pl.planarPreviewUMm
    const vRaw = pl.jointState?.vMm ?? pl.planarPreviewVMm
    if (uRaw == null && vRaw == null) continue
    const minU = pl.jointLimits?.uMinMm ?? pl.planarPreviewUMinMm ?? -1e6
    const maxU = pl.jointLimits?.uMaxMm ?? pl.planarPreviewUMaxMm ?? 1e6
    const loU = Math.min(minU, maxU)
    const hiU = Math.max(minU, maxU)
    const minV = pl.jointLimits?.vMinMm ?? pl.planarPreviewVMinMm ?? -1e6
    const maxV = pl.jointLimits?.vMaxMm ?? pl.planarPreviewVMaxMm ?? 1e6
    const loV = Math.min(minV, maxV)
    const hiV = Math.max(minV, maxV)
    const uMm =
      uRaw != null && Number.isFinite(uRaw) ? Math.max(loU, Math.min(hiU, uRaw)) : 0
    const vMm =
      vRaw != null && Number.isFinite(vRaw) ? Math.max(loV, Math.min(hiV, vRaw)) : 0

    if (uMm === 0 && vMm === 0) continue

    const [[ux, uy, uz], [vx, vy, vz]] = planarPreviewBasisWorldUnits(
      pl.planarPreviewNormalFrame,
      pl.planarPreviewNormalAxis,
      pl.parentId,
      byId
    )
    const tx = ux * uMm + vx * vMm
    const ty = uy * uMm + vy * vMm
    const tz = uz * uMm + vz * vMm

    const subtree = collectDescendantIds(pl.id, active)
    for (const id of subtree) {
      const t = transforms.get(id)
      if (!t) continue
      transforms.set(id, {
        ...t,
        x: t.x + tx,
        y: t.y + ty,
        z: t.z + tz
      })
    }
  }

  const revoluteNodes = active
    .filter((c) => c.joint === 'revolute')
    .sort((a, b) => depthFromRoot(a.id, byId) - depthFromRoot(b.id, byId))

  for (const r of revoluteNodes) {
    const degRaw = r.jointState?.scalarDeg ?? r.revolutePreviewAngleDeg
    if (degRaw == null || !Number.isFinite(degRaw)) continue
    const minD = r.jointLimits?.scalarMinDeg ?? r.revolutePreviewMinDeg ?? -180
    const maxD = r.jointLimits?.scalarMaxDeg ?? r.revolutePreviewMaxDeg ?? 180
    const lo = Math.min(minD, maxD)
    const hi = Math.max(minD, maxD)
    const deg = Math.max(lo, Math.min(hi, degRaw))
    const [ux, uy, uz] = previewAxisWorldUnit(
      r.revolutePreviewAxisFrame,
      r.revolutePreviewAxis,
      r.parentId,
      byId
    )

    const subtree = collectDescendantIds(r.id, active)
    const pivot = transforms.get(r.id)
    if (!pivot) continue
    const { x: px, y: py, z: pz } = pivot

    for (const id of subtree) {
      const t = transforms.get(id)
      if (!t) continue
      const [nx, ny, nz] = rotatePointAboutUnitAxis(px, py, pz, t.x, t.y, t.z, ux, uy, uz, deg)
      const e2 = rotateEulerZYXByUnitAxisDeg(t.rxDeg, t.ryDeg, t.rzDeg, ux, uy, uz, deg)
      transforms.set(id, {
        ...t,
        x: nx,
        y: ny,
        z: nz,
        rxDeg: e2.rxDeg,
        ryDeg: e2.ryDeg,
        rzDeg: e2.rzDeg
      })
    }
  }

  const universalNodes = active
    .filter((c) => c.joint === 'universal')
    .sort((a, b) => depthFromRoot(a.id, byId) - depthFromRoot(b.id, byId))

  for (const u of universalNodes) {
    const raw1 = u.jointState?.angle1Deg ?? u.universalPreviewAngle1Deg
    const raw2 = u.jointState?.angle2Deg ?? u.universalPreviewAngle2Deg
    if (raw1 == null && raw2 == null) continue
    const min1 = u.jointLimits?.angle1MinDeg ?? u.universalPreviewAngle1MinDeg ?? -180
    const max1 = u.jointLimits?.angle1MaxDeg ?? u.universalPreviewAngle1MaxDeg ?? 180
    const lo1 = Math.min(min1, max1)
    const hi1 = Math.max(min1, max1)
    const deg1 = raw1 != null && Number.isFinite(raw1) ? Math.max(lo1, Math.min(hi1, raw1)) : 0
    const min2 = u.jointLimits?.angle2MinDeg ?? u.universalPreviewAngle2MinDeg ?? -180
    const max2 = u.jointLimits?.angle2MaxDeg ?? u.universalPreviewAngle2MaxDeg ?? 180
    const lo2 = Math.min(min2, max2)
    const hi2 = Math.max(min2, max2)
    const deg2 = raw2 != null && Number.isFinite(raw2) ? Math.max(lo2, Math.min(hi2, raw2)) : 0

    const [ux1, uy1, uz1] = previewAxisWorldUnit(
      u.universalPreviewAxis1Frame,
      u.universalPreviewAxis1 ?? 'z',
      u.parentId,
      byId
    )
    const [ux2, uy2, uz2] = previewAxisWorldUnit(
      u.universalPreviewAxis2Frame,
      u.universalPreviewAxis2 ?? 'x',
      u.parentId,
      byId
    )
    const subtree = collectDescendantIds(u.id, active)
    const pivot = transforms.get(u.id)
    if (!pivot) continue
    const { x: px, y: py, z: pz } = pivot

    for (const id of subtree) {
      const t = transforms.get(id)
      if (!t) continue
      let [nx, ny, nz] = rotatePointAboutUnitAxis(px, py, pz, t.x, t.y, t.z, ux1, uy1, uz1, deg1)
      let e = rotateEulerZYXByUnitAxisDeg(t.rxDeg, t.ryDeg, t.rzDeg, ux1, uy1, uz1, deg1)
      ;[nx, ny, nz] = rotatePointAboutUnitAxis(px, py, pz, nx, ny, nz, ux2, uy2, uz2, deg2)
      e = rotateEulerZYXByUnitAxisDeg(e.rxDeg, e.ryDeg, e.rzDeg, ux2, uy2, uz2, deg2)
      transforms.set(id, {
        ...t,
        x: nx,
        y: ny,
        z: nz,
        rxDeg: e.rxDeg,
        ryDeg: e.ryDeg,
        rzDeg: e.rzDeg
      })
    }
  }

  const cylindricalNodes = active
    .filter((c) => c.joint === 'cylindrical')
    .sort((a, b) => depthFromRoot(a.id, byId) - depthFromRoot(b.id, byId))

  for (const cy of cylindricalNodes) {
    const mmRaw = cy.jointState?.slideMm ?? cy.cylindricalPreviewSlideMm
    const spinRaw = cy.jointState?.spinDeg ?? cy.cylindricalPreviewSpinDeg
    if (
      (mmRaw == null || !Number.isFinite(mmRaw)) &&
      (spinRaw == null || !Number.isFinite(spinRaw))
    ) {
      continue
    }
    const minM = cy.jointLimits?.slideMinMm ?? cy.cylindricalPreviewSlideMinMm ?? -1e6
    const maxM = cy.jointLimits?.slideMaxMm ?? cy.cylindricalPreviewSlideMaxMm ?? 1e6
    const loM = Math.min(minM, maxM)
    const hiM = Math.max(minM, maxM)
    const mm = mmRaw != null && Number.isFinite(mmRaw) ? Math.max(loM, Math.min(hiM, mmRaw)) : 0
    const minS = cy.jointLimits?.spinMinDeg ?? cy.cylindricalPreviewSpinMinDeg ?? -180
    const maxS = cy.jointLimits?.spinMaxDeg ?? cy.cylindricalPreviewSpinMaxDeg ?? 180
    const loS = Math.min(minS, maxS)
    const hiS = Math.max(minS, maxS)
    const spinDeg =
      spinRaw != null && Number.isFinite(spinRaw) ? Math.max(loS, Math.min(hiS, spinRaw)) : 0

    const [ux, uy, uz] = previewAxisWorldUnit(
      cy.cylindricalPreviewAxisFrame,
      cy.cylindricalPreviewAxis ?? 'z',
      cy.parentId,
      byId
    )
    const subtree = collectDescendantIds(cy.id, active)
    const pivot0 = transforms.get(cy.id)
    if (!pivot0) continue

    for (const id of subtree) {
      const t = transforms.get(id)
      if (!t) continue
      transforms.set(id, {
        ...t,
        x: t.x + ux * mm,
        y: t.y + uy * mm,
        z: t.z + uz * mm
      })
    }

    if (spinDeg === 0) continue

    const pAfter = transforms.get(cy.id)
    if (!pAfter) continue
    const px = pAfter.x
    const py = pAfter.y
    const pz = pAfter.z

    for (const id of subtree) {
      const t = transforms.get(id)
      if (!t) continue
      const [nx, ny, nz] = rotatePointAboutUnitAxis(px, py, pz, t.x, t.y, t.z, ux, uy, uz, spinDeg)
      const e2 = rotateEulerZYXByUnitAxisDeg(t.rxDeg, t.ryDeg, t.rzDeg, ux, uy, uz, spinDeg)
      transforms.set(id, {
        ...t,
        x: nx,
        y: ny,
        z: nz,
        rxDeg: e2.rxDeg,
        ryDeg: e2.ryDeg,
        rzDeg: e2.rzDeg
      })
    }
  }

  const ballNodes = active
    .filter((c) => c.joint === 'ball')
    .sort((a, b) => depthFromRoot(a.id, byId) - depthFromRoot(b.id, byId))

  for (const bl of ballNodes) {
    const rawX = bl.jointState?.rxDeg ?? bl.ballPreviewRxDeg
    const rawY = bl.jointState?.ryDeg ?? bl.ballPreviewRyDeg
    const rawZ = bl.jointState?.rzDeg ?? bl.ballPreviewRzDeg
    if (rawX == null && rawY == null && rawZ == null) continue

    const clampAxis = (
      raw: number | undefined,
      minD: number | undefined,
      maxD: number | undefined
    ): number => {
      if (raw == null || !Number.isFinite(raw)) return 0
      const lo = Math.min(minD ?? -180, maxD ?? 180)
      const hi = Math.max(minD ?? -180, maxD ?? 180)
      return Math.max(lo, Math.min(hi, raw))
    }

    const rx = clampAxis(rawX, bl.jointLimits?.rxMinDeg ?? bl.ballPreviewRxMinDeg, bl.jointLimits?.rxMaxDeg ?? bl.ballPreviewRxMaxDeg)
    const ry = clampAxis(rawY, bl.jointLimits?.ryMinDeg ?? bl.ballPreviewRyMinDeg, bl.jointLimits?.ryMaxDeg ?? bl.ballPreviewRyMaxDeg)
    const rz = clampAxis(rawZ, bl.jointLimits?.rzMinDeg ?? bl.ballPreviewRzMinDeg, bl.jointLimits?.rzMaxDeg ?? bl.ballPreviewRzMaxDeg)

    if (rx === 0 && ry === 0 && rz === 0) continue

    const subtree = collectDescendantIds(bl.id, active)
    const pivot = transforms.get(bl.id)
    if (!pivot) continue
    const { x: px, y: py, z: pz } = pivot

    for (const id of subtree) {
      const t = transforms.get(id)
      if (!t) continue
      let [nx, ny, nz] = rotatePointAboutUnitAxis(px, py, pz, t.x, t.y, t.z, 1, 0, 0, rx)
      let e = rotateEulerZYXByUnitAxisDeg(t.rxDeg, t.ryDeg, t.rzDeg, 1, 0, 0, rx)
      ;[nx, ny, nz] = rotatePointAboutUnitAxis(px, py, pz, nx, ny, nz, 0, 1, 0, ry)
      e = rotateEulerZYXByUnitAxisDeg(e.rxDeg, e.ryDeg, e.rzDeg, 0, 1, 0, ry)
      ;[nx, ny, nz] = rotatePointAboutUnitAxis(px, py, pz, nx, ny, nz, 0, 0, 1, rz)
      e = rotateEulerZYXByUnitAxisDeg(e.rxDeg, e.ryDeg, e.rzDeg, 0, 0, 1, rz)
      transforms.set(id, {
        ...t,
        x: nx,
        y: ny,
        z: nz,
        rxDeg: e.rxDeg,
        ryDeg: e.ryDeg,
        rzDeg: e.rzDeg
      })
    }
  }

  return transforms
}

/** World-space translation (mm) for explode: `index * stepMm * factor` along `axis` (+X / +Y / +Z). */
export function explodeOffsetMm(
  axis: AssemblyExplodeViewMetadata['axis'],
  stepMm: number,
  activeRowIndex: number,
  factor: number
): [number, number, number] {
  const f = Math.max(0, Math.min(1, factor))
  const d = activeRowIndex * stepMm * f
  if (axis === 'x') return [d, 0, 0]
  if (axis === 'y') return [0, d, 0]
  return [0, 0, d]
}

/** One sample after parsing `motionStudy.keyframesJson` for viewport playback. */
export type AssemblyMotionRzSample = { t: number; rzDeg: number }

/**
 * Minimal keyframe format (JSON array, ≥2 items):
 * `[{ "t": 0, "rzDeg": 0 }, { "t": 1, "rzDeg": 45 }]` — `t` is unitless time; `rzDeg` is extra world +Y rotation in degrees for the whole assembly preview.
 * Legacy: `deg` is accepted as an alias for `rzDeg`.
 */
export function parseAssemblyMotionRzKeyframes(json: string | undefined | null): AssemblyMotionRzSample[] | null {
  if (json == null || json.trim() === '') return null
  let raw: unknown
  try {
    raw = JSON.parse(json) as unknown
  } catch {
    return null
  }
  if (!Array.isArray(raw) || raw.length < 2) return null
  const out: AssemblyMotionRzSample[] = []
  for (const item of raw) {
    if (item == null || typeof item !== 'object') continue
    const o = item as { t?: unknown; rzDeg?: unknown; deg?: unknown }
    const t = Number(o.t)
    const rzRaw = o.rzDeg ?? o.deg
    const rzDeg = Number(rzRaw)
    if (!Number.isFinite(t)) continue
    out.push({ t, rzDeg: Number.isFinite(rzDeg) ? rzDeg : 0 })
  }
  if (out.length < 2) return null
  out.sort((a, b) => a.t - b.t)
  return out
}

/** Map playback parameter `u` in [0,1] across the first/last keyframe `t` range, then lerp `rzDeg`. */
export function lerpMotionRzDeg(samples: AssemblyMotionRzSample[], u: number): number {
  if (samples.length === 0) return 0
  const uu = Math.max(0, Math.min(1, u))
  const t0 = samples[0]!.t
  const t1 = samples[samples.length - 1]!.t
  const span = t1 - t0 || 1
  const tv = t0 + uu * span
  let i = 0
  while (i < samples.length - 1 && samples[i + 1]!.t < tv) i++
  const a = samples[i]!
  const b = samples[Math.min(i + 1, samples.length - 1)]!
  const seg = b.t - a.t || 1e-9
  const w = (tv - a.t) / seg
  return a.rzDeg + w * (b.rzDeg - a.rzDeg)
}
