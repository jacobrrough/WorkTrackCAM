/**
 * Construction (reference) geometry — the PROFILE-DERIVATION EXCLUSION contract.
 *
 * A `construction: true` sketch entity is dashed guide geometry: it exists for
 * constraints / dimensions / snapping and must NEVER become part of the built
 * solid or a CAM contour / drill point. The exclusion lives at the derivation
 * SOURCES and is provably conservative (entities are only ever REMOVED from
 * derivation, never added):
 *
 *   - `extractKernelProfiles` (src/shared/sketch-profile.ts) — the single
 *     closed-profile source for the kernel build (`buildKernelBuildPayload` →
 *     engines/occt/build_part.py) and the feature-dialog profile pickers.
 *   - `listContourCandidatesFromDesign` / `deriveDrillPointsFromDesign`
 *     (src/shared/cam-2d-derive.ts) — the 2D contour + drill derivation behind
 *     every CNC contour/pocket/drill op (Laguna Swift 5x10, Carvera 3/4-axis).
 *
 * THE test: a sketch with one closed normal rectangle + a construction line +
 * a construction circle produces the IDENTICAL profile set as the same sketch
 * without the construction entities.
 */

import { describe, expect, it } from 'vitest'
import { emptyDesign, type DesignFileV2 } from './design-schema'
import { buildKernelBuildPayload, extractKernelProfiles } from './sketch-profile'
import {
  deriveContourPointsFromDesign,
  deriveDrillPointsFromDesign,
  listContourCandidatesFromDesign
} from './cam-2d-derive'

/** One closed rect + one closed circle — the "real" part geometry. */
function normalEntities(): DesignFileV2 {
  return {
    ...emptyDesign(),
    points: {
      la: { x: -50, y: -50 },
      lb: { x: 50, y: 50 }
    },
    entities: [
      { id: 'r1', kind: 'rect', cx: 0, cy: 0, w: 40, h: 20, rotation: 0 },
      { id: 'c1', kind: 'circle', cx: 0, cy: 0, r: 5 }
    ]
  }
}

/** The same design PLUS a construction line and a construction circle. */
function withConstruction(): DesignFileV2 {
  const d = normalEntities()
  return {
    ...d,
    entities: [
      ...d.entities,
      // A construction "line" (2-vertex open polyline — the line tool's output).
      { id: 'guide1', kind: 'polyline', pointIds: ['la', 'lb'], closed: false, construction: true },
      // A construction circle — a layout guide (e.g. a bolt-circle diameter).
      { id: 'guide2', kind: 'circle', cx: 10, cy: 10, r: 30, construction: true }
    ]
  }
}

describe('extractKernelProfiles — construction exclusion (kernel build source)', () => {
  it('construction line + circle change NOTHING: profile set identical to the plain design', () => {
    const plain = extractKernelProfiles(normalEntities())
    const withGuides = extractKernelProfiles(withConstruction())
    expect(withGuides).toEqual(plain)
    // And the plain set is the rect loop + the circle — the guides never appear.
    expect(withGuides).not.toBeNull()
    expect(withGuides!).toHaveLength(2)
    expect(withGuides!.some((p) => p.type === 'circle' && p.r === 30)).toBe(false)
  })

  it('a CLOSED construction entity is still excluded (closed ≠ buildable when construction)', () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      entities: [
        { id: 'r1', kind: 'rect', cx: 0, cy: 0, w: 40, h: 20, rotation: 0 },
        { id: 'g1', kind: 'rect', cx: 100, cy: 0, w: 10, h: 10, rotation: 0, construction: true }
      ]
    }
    const profiles = extractKernelProfiles(d)
    expect(profiles).toHaveLength(1)
  })

  it('a construction-ONLY sketch has no buildable profile (null, honest empty)', () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      entities: [{ id: 'g1', kind: 'circle', cx: 0, cy: 0, r: 10, construction: true }]
    }
    expect(extractKernelProfiles(d)).toBeNull()
  })

  it('buildKernelBuildPayload inherits the exclusion (construction-only → no_closed_profile)', () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      entities: [{ id: 'g1', kind: 'circle', cx: 0, cy: 0, r: 10, construction: true }]
    }
    const res = buildKernelBuildPayload(d)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('no_closed_profile')
  })

  it('construction: false / absent behaves exactly like today (no behavior change)', () => {
    const d = normalEntities()
    d.entities = d.entities.map((e) => ({ ...e, construction: false }))
    expect(extractKernelProfiles(d)).toEqual(extractKernelProfiles(normalEntities()))
  })
})

describe('cam-2d-derive — construction exclusion (CNC contour + drill source)', () => {
  it('contour candidates: construction entities never derive (identical to the plain design)', () => {
    const plain = listContourCandidatesFromDesign(normalEntities())
    const withGuides = listContourCandidatesFromDesign(withConstruction())
    expect(withGuides.map((c) => c.sourceId)).toEqual(plain.map((c) => c.sourceId))
    expect(withGuides.map((c) => c.signature)).toEqual(plain.map((c) => c.signature))
    expect(withGuides.some((c) => c.sourceId === 'guide2')).toBe(false)
  })

  it('deriveContourPointsFromDesign never resolves a construction sourceId', () => {
    const d = withConstruction()
    // Asking for the construction circle by id falls back to the first REAL candidate.
    const pts = deriveContourPointsFromDesign(d, 'guide2')
    expect(pts).toEqual(deriveContourPointsFromDesign(normalEntities()))
  })

  it('drill points: a construction circle is a layout guide, never a hole', () => {
    const d = withConstruction()
    const drills = deriveDrillPointsFromDesign(d)
    // Only the REAL circle at (0,0) — the r=30 guide at (10,10) must not drill.
    expect(drills).toEqual([[0, 0]])
  })
})
