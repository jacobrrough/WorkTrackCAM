/**
 * Wave 3i — nested-ring grouping for 2.5D CAM derivation.
 *
 * Pins the even-odd containment classifier that turns the FLAT closed-loop
 * candidate list (cam-2d-derive) into `{ outer, holes[] }` region groups for
 * pocket islands and V-carve hole rings:
 *   - a loop inside an ODD number of others is a hole of its INNERMOST container
 *   - every EVEN-depth loop (top-level, or island-inside-a-hole) starts its own group
 *   - `deriveContourRingGroupFromDesign` mirrors `deriveContourPointsFromDesign`
 *     selection exactly (sourceId match, else first candidate), so the workspace
 *     derive sets `contourPoints` and `islandRings` from the SAME outer loop.
 */
import { describe, expect, it } from 'vitest'
import { deriveContourPointsFromDesign, type DerivedContourCandidate } from './cam-2d-derive'
import { deriveContourRingGroupFromDesign, groupContourCandidatesByContainment } from './cam-2d-nesting'
import { emptyDesign, type DesignFileV2 } from './design-schema'

function cand(sourceId: string, points: [number, number][]): DerivedContourCandidate {
  return { sourceId, label: sourceId, points, signature: sourceId }
}

/** Axis-aligned square loop (CCW) centred at (cx, cy) with half-size `half`. */
function sq(cx: number, cy: number, half: number): [number, number][] {
  return [
    [cx - half, cy - half],
    [cx + half, cy - half],
    [cx + half, cy + half],
    [cx - half, cy + half]
  ]
}

/** A rect-with-inner-circle sign design: 60x40 plate, r=8 hole, both centred at (30,20). */
function plateWithHoleDesign(): DesignFileV2 {
  return {
    ...emptyDesign(),
    entities: [
      { id: 'plate', kind: 'rect', cx: 30, cy: 20, w: 60, h: 40, rotation: 0 },
      { id: 'hole', kind: 'circle', cx: 30, cy: 20, r: 8 }
    ]
  }
}

describe('groupContourCandidatesByContainment — even-odd nesting classifier', () => {
  it('disjoint sibling loops each form their own group with no holes', () => {
    const groups = groupContourCandidatesByContainment([cand('a', sq(0, 0, 5)), cand('b', sq(100, 0, 5))])
    expect(groups.map((g) => g.outer.sourceId)).toEqual(['a', 'b'])
    expect(groups.every((g) => g.holes.length === 0)).toBe(true)
  })

  it('a loop inside one other loop becomes a hole of that loop', () => {
    const groups = groupContourCandidatesByContainment([cand('outer', sq(0, 0, 10)), cand('inner', sq(0, 0, 3))])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.outer.sourceId).toBe('outer')
    expect(groups[0]!.holes.map((h) => h.sourceId)).toEqual(['inner'])
  })

  it('an island standing inside a hole (depth 2) starts its OWN group (even-odd)', () => {
    const groups = groupContourCandidatesByContainment([
      cand('outer', sq(0, 0, 20)),
      cand('hole', sq(0, 0, 10)),
      cand('island', sq(0, 0, 4))
    ])
    expect(groups.map((g) => g.outer.sourceId)).toEqual(['outer', 'island'])
    const outerGroup = groups.find((g) => g.outer.sourceId === 'outer')!
    expect(outerGroup.holes.map((h) => h.sourceId)).toEqual(['hole'])
    const islandGroup = groups.find((g) => g.outer.sourceId === 'island')!
    expect(islandGroup.holes).toEqual([])
  })

  it('a depth-3 loop attaches to its INNERMOST container, not the outermost', () => {
    const groups = groupContourCandidatesByContainment([
      cand('outer', sq(0, 0, 40)),
      cand('hole1', sq(0, 0, 30)),
      cand('island', sq(0, 0, 20)),
      cand('hole2', sq(0, 0, 10))
    ])
    expect(groups.map((g) => g.outer.sourceId)).toEqual(['outer', 'island'])
    expect(groups.find((g) => g.outer.sourceId === 'outer')!.holes.map((h) => h.sourceId)).toEqual(['hole1'])
    expect(groups.find((g) => g.outer.sourceId === 'island')!.holes.map((h) => h.sourceId)).toEqual(['hole2'])
  })

  it('two separate parents each keep their own hole (no cross-attachment)', () => {
    const groups = groupContourCandidatesByContainment([
      cand('parentA', sq(0, 0, 10)),
      cand('parentB', sq(100, 0, 10)),
      cand('holeA', sq(0, 0, 3)),
      cand('holeB', sq(100, 0, 3))
    ])
    expect(groups.map((g) => g.outer.sourceId)).toEqual(['parentA', 'parentB'])
    expect(groups.find((g) => g.outer.sourceId === 'parentA')!.holes.map((h) => h.sourceId)).toEqual(['holeA'])
    expect(groups.find((g) => g.outer.sourceId === 'parentB')!.holes.map((h) => h.sourceId)).toEqual(['holeB'])
  })

  it('degenerate (<3 point) candidates never contain anything and never become holes of nothing', () => {
    const groups = groupContourCandidatesByContainment([
      cand('outer', sq(0, 0, 10)),
      cand('line', [
        [0, 0],
        [1, 1]
      ])
    ])
    // The 2-point "loop" sits inside outer (odd depth) -> hole of outer; it can
    // never act as a container itself.
    expect(groups).toHaveLength(1)
    expect(groups[0]!.outer.sourceId).toBe('outer')
    expect(groups[0]!.holes.map((h) => h.sourceId)).toEqual(['line'])
  })

  it('empty input yields no groups', () => {
    expect(groupContourCandidatesByContainment([])).toEqual([])
  })
})

describe('deriveContourRingGroupFromDesign — design-level grouped derive', () => {
  it('rect plate with an inner circle: outer = plate, holes = [circle ring]', () => {
    const group = deriveContourRingGroupFromDesign(plateWithHoleDesign())
    expect(group).not.toBeNull()
    expect(group!.outer.sourceId).toBe('plate')
    expect(group!.holes.map((h) => h.sourceId)).toEqual(['hole'])
    expect(group!.holes[0]!.points.length).toBeGreaterThanOrEqual(16)
  })

  it('outer points equal what deriveContourPointsFromDesign returns for the same args', () => {
    const d = plateWithHoleDesign()
    expect(deriveContourRingGroupFromDesign(d)!.outer.points).toEqual(deriveContourPointsFromDesign(d))
    expect(deriveContourRingGroupFromDesign(d, 'hole')!.outer.points).toEqual(deriveContourPointsFromDesign(d, 'hole'))
  })

  it('picking the HOLE as the op profile returns it with no holes (machine inside it)', () => {
    const group = deriveContourRingGroupFromDesign(plateWithHoleDesign(), 'hole')
    expect(group!.outer.sourceId).toBe('hole')
    expect(group!.holes).toEqual([])
  })

  it('unknown sourceId falls back to the first candidate (mirrors the points derive)', () => {
    const group = deriveContourRingGroupFromDesign(plateWithHoleDesign(), 'nope')
    expect(group!.outer.sourceId).toBe('plate')
    expect(group!.holes.map((h) => h.sourceId)).toEqual(['hole'])
  })

  it('a design with no closed profiles returns null', () => {
    expect(deriveContourRingGroupFromDesign(emptyDesign())).toBeNull()
  })

  it('concentric closed polylines (the DXF-ring shape) group as outer + hole', () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      entities: [
        { id: 'ring-outer', kind: 'polyline', pointIds: ['a', 'b', 'c', 'd'], closed: true },
        { id: 'ring-inner', kind: 'polyline', pointIds: ['e', 'f', 'g', 'h'], closed: true }
      ],
      points: {
        a: { x: 0, y: 0 },
        b: { x: 40, y: 0 },
        c: { x: 40, y: 40 },
        d: { x: 0, y: 40 },
        e: { x: 15, y: 15 },
        f: { x: 25, y: 15 },
        g: { x: 25, y: 25 },
        h: { x: 15, y: 25 }
      }
    }
    const group = deriveContourRingGroupFromDesign(d)
    expect(group!.outer.sourceId).toBe('ring-outer')
    expect(group!.holes.map((h) => h.sourceId)).toEqual(['ring-inner'])
  })
})
