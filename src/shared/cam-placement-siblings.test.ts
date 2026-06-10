/**
 * Wave 3l — planner tests for `cam-placement-siblings.ts`.
 *
 * The ASSOCIATION RULE under test (module header of the implementation):
 * a companion op (cnc_pocket / cnc_vcarve / cnc_chamfer / cnc_drill, not
 * itself nested) inherits a nested contour op's placement iff it shares the
 * setup AND every parseable 2D point lies inside-or-on EXACTLY ONE nested
 * outline in the shared sketch frame. Companion stamps carry the part
 * outline's rotated-bbox-min anchor so the dispatcher reproduces the part's
 * exact rigid transform (parity pinned in cam-placement-transform.test.ts).
 */
import { describe, expect, it } from 'vitest'
import {
  COMPANION_2D_OP_KINDS,
  planNestingPlacementStamps,
  type NestedPlacementInput
} from './cam-placement-siblings'
import { rigidTransformForPlacement, rotatePointCcwDeg } from './cam-placement-transform'
import type { ManufactureOperation } from './manufacture-schema'

function makeOp(overrides: Partial<ManufactureOperation> & { id: string }): ManufactureOperation {
  return {
    kind: 'cnc_contour',
    label: overrides.id,
    ...overrides
  }
}

/** Part A: 100×100 outline at the sketch origin. */
const OUTLINE_A: number[][] = [
  [0, 0],
  [100, 0],
  [100, 100],
  [0, 100]
]
/** Part B: 100×100 outline drawn 200 mm to the right of part A. */
const OUTLINE_B: number[][] = [
  [200, 0],
  [300, 0],
  [300, 100],
  [200, 100]
]

const PLACE_A: NestedPlacementInput = { partId: 'contour-a', xMm: 500, yMm: 700, rotationDeg: 90 }
const PLACE_B: NestedPlacementInput = { partId: 'contour-b', xMm: 20, yMm: 10, rotationDeg: 0 }

/** The standard multi-op part-A family used across the tests. */
function partAFamily(): ManufactureOperation[] {
  return [
    makeOp({ id: 'contour-a', kind: 'cnc_contour', params: { contourPoints: OUTLINE_A } }),
    makeOp({
      id: 'pocket-a',
      kind: 'cnc_pocket',
      params: {
        contourPoints: [
          [20, 20],
          [40, 20],
          [40, 40],
          [20, 40]
        ],
        islandRings: [
          [
            [25, 25],
            [30, 25],
            [30, 30]
          ]
        ]
      }
    }),
    makeOp({
      id: 'vcarve-a',
      kind: 'cnc_vcarve',
      params: {
        contourPoints: [
          [10, 60],
          [30, 60],
          [30, 80],
          [10, 80]
        ]
      }
    }),
    // The chamfer traces the part outline ITSELF — on-edge must associate.
    makeOp({ id: 'chamfer-a', kind: 'cnc_chamfer', params: { contourPoints: OUTLINE_A } }),
    makeOp({
      id: 'drill-a',
      kind: 'cnc_drill',
      params: {
        drillPoints: [
          [50, 50],
          [60, 60]
        ]
      }
    })
  ]
}

describe('planNestingPlacementStamps — direct contour stamps', () => {
  it('plans a viaSibling:false entry (no anchor) for every placed contour op', () => {
    const ops = [makeOp({ id: 'contour-a', params: { contourPoints: OUTLINE_A } })]
    const plan = planNestingPlacementStamps(ops, [PLACE_A])
    const entry = plan.get('contour-a')
    expect(entry).toBeDefined()
    expect(entry!.viaSibling).toBe(false)
    expect(entry!.placement).toEqual(PLACE_A)
    expect(entry!.anchorMinXMm).toBeUndefined()
    expect(entry!.anchorMinYMm).toBeUndefined()
  })

  it('ignores a direct placement keyed to a NON-contour op id (the nest only places outlines)', () => {
    const ops = [
      makeOp({
        id: 'pocket-only',
        kind: 'cnc_pocket',
        params: { contourPoints: OUTLINE_A }
      })
    ]
    const plan = planNestingPlacementStamps(ops, [
      { partId: 'pocket-only', xMm: 5, yMm: 5, rotationDeg: 0 }
    ])
    expect(plan.size).toBe(0)
  })

  it('returns an empty plan for empty placements', () => {
    expect(planNestingPlacementStamps(partAFamily(), []).size).toBe(0)
  })
})

describe('planNestingPlacementStamps — companion association (the Wave 3l rule)', () => {
  it('stamps pocket + v-carve + chamfer + drill of the SAME part with the SAME placement', () => {
    const plan = planNestingPlacementStamps(partAFamily(), [PLACE_A])
    for (const id of ['pocket-a', 'vcarve-a', 'chamfer-a', 'drill-a']) {
      const entry = plan.get(id)
      expect(entry, id).toBeDefined()
      expect(entry!.viaSibling, id).toBe(true)
      expect(entry!.placement, id).toEqual(PLACE_A)
    }
    // All four carry the IDENTICAL anchor — the part outline's rotated bbox min.
    const anchors = ['pocket-a', 'vcarve-a', 'chamfer-a', 'drill-a'].map((id) => [
      plan.get(id)!.anchorMinXMm,
      plan.get(id)!.anchorMinYMm
    ])
    for (const a of anchors) expect(a).toEqual(anchors[0])
  })

  it('the companion anchor equals the contour transform: anchorMin = (xMm - dxMm, yMm - dyMm)', () => {
    const plan = planNestingPlacementStamps(partAFamily(), [PLACE_A])
    const t = rigidTransformForPlacement(
      OUTLINE_A.map((p) => [p[0]!, p[1]!] as [number, number]),
      { xMm: PLACE_A.xMm, yMm: PLACE_A.yMm, rotationDeg: PLACE_A.rotationDeg }
    )
    expect(t).not.toBeNull()
    const entry = plan.get('pocket-a')!
    expect(entry.anchorMinXMm).toBeCloseTo(PLACE_A.xMm - t!.dxMm, 9)
    expect(entry.anchorMinYMm).toBeCloseTo(PLACE_A.yMm - t!.dyMm, 9)
    // And it matches a hand-rotated bbox: 90° CCW of [0,100]² has min (-100, 0).
    const rotated = OUTLINE_A.map((p) => rotatePointCcwDeg(p[0]!, p[1]!, 90))
    expect(entry.anchorMinXMm).toBeCloseTo(Math.min(...rotated.map((p) => p[0])), 12)
    expect(entry.anchorMinYMm).toBeCloseTo(Math.min(...rotated.map((p) => p[1])), 12)
  })

  it('ops of ANOTHER part are untouched (geometry outside the nested outline)', () => {
    const ops = [...partAFamily(), ...[
      makeOp({ id: 'contour-b', kind: 'cnc_contour', params: { contourPoints: OUTLINE_B } }),
      makeOp({
        id: 'pocket-b',
        kind: 'cnc_pocket',
        params: {
          contourPoints: [
            [220, 20],
            [240, 20],
            [240, 40]
          ]
        }
      })
    ]]
    // Only part A is nested in this pass — part B's ops must not move.
    const plan = planNestingPlacementStamps(ops, [PLACE_A])
    expect(plan.has('contour-b')).toBe(false)
    expect(plan.has('pocket-b')).toBe(false)
    // Nest BOTH parts and each pocket follows ITS OWN outline's placement.
    const planBoth = planNestingPlacementStamps(ops, [PLACE_A, PLACE_B])
    expect(planBoth.get('pocket-a')!.placement).toEqual(PLACE_A)
    expect(planBoth.get('pocket-b')!.placement).toEqual(PLACE_B)
  })

  it('a drill op spanning TWO nested parts is never stamped (one transform cannot place both)', () => {
    const ops = [
      makeOp({ id: 'contour-a', params: { contourPoints: OUTLINE_A } }),
      makeOp({ id: 'contour-b', params: { contourPoints: OUTLINE_B } }),
      makeOp({
        id: 'drill-both',
        kind: 'cnc_drill',
        params: {
          drillPoints: [
            [50, 50],
            [250, 50]
          ]
        }
      })
    ]
    const plan = planNestingPlacementStamps(ops, [PLACE_A, PLACE_B])
    expect(plan.has('drill-both')).toBe(false)
  })

  it('AMBIGUOUS containment (inside two nested outlines) is never guessed', () => {
    // Two outlines drawn around the same origin region — the pocket sits
    // inside BOTH. The planner must refuse rather than pick one.
    const overlappingOutline: number[][] = [
      [-10, -10],
      [110, -10],
      [110, 110],
      [-10, 110]
    ]
    const ops = [
      makeOp({ id: 'contour-a', params: { contourPoints: OUTLINE_A } }),
      makeOp({ id: 'contour-c', params: { contourPoints: overlappingOutline } }),
      makeOp({
        id: 'pocket-a',
        kind: 'cnc_pocket',
        params: {
          contourPoints: [
            [20, 20],
            [40, 20],
            [40, 40]
          ]
        }
      })
    ]
    const plan = planNestingPlacementStamps(ops, [
      PLACE_A,
      { partId: 'contour-c', xMm: 800, yMm: 900, rotationDeg: 0 }
    ])
    expect(plan.has('pocket-a')).toBe(false)
  })

  it('setup mismatch blocks association even when geometry is contained', () => {
    const ops = [
      makeOp({
        id: 'contour-a',
        params: { contourPoints: OUTLINE_A, setupId: 'setup-1' }
      }),
      makeOp({
        id: 'pocket-other-setup',
        kind: 'cnc_pocket',
        params: {
          contourPoints: [
            [20, 20],
            [40, 20],
            [40, 40]
          ],
          setupId: 'setup-2'
        }
      })
    ]
    expect(planNestingPlacementStamps(ops, [PLACE_A]).has('pocket-other-setup')).toBe(false)
  })

  it('setupId matching mirrors getOpSetupId: trimmed, blank counts as unassigned', () => {
    const ops = [
      makeOp({
        id: 'contour-a',
        params: { contourPoints: OUTLINE_A, setupId: '  s-7  ' }
      }),
      makeOp({
        id: 'pocket-trim',
        kind: 'cnc_pocket',
        params: {
          contourPoints: [
            [20, 20],
            [40, 20],
            [40, 40]
          ],
          setupId: 's-7'
        }
      }),
      makeOp({
        id: 'pocket-blank',
        kind: 'cnc_pocket',
        params: {
          contourPoints: [
            [60, 60],
            [80, 60],
            [80, 80]
          ],
          setupId: '   '
        }
      })
    ]
    const plan = planNestingPlacementStamps(ops, [PLACE_A])
    expect(plan.has('pocket-trim')).toBe(true) // '  s-7  ' trims to 's-7'
    expect(plan.has('pocket-blank')).toBe(false) // blank = unassigned ≠ 's-7'
  })

  it('companions with NO parseable 2D geometry are never stamped', () => {
    const ops = [
      makeOp({ id: 'contour-a', params: { contourPoints: OUTLINE_A } }),
      makeOp({ id: 'pocket-empty', kind: 'cnc_pocket', params: { toolDiameterMm: 6 } }),
      makeOp({ id: 'drill-empty', kind: 'cnc_drill' })
    ]
    const plan = planNestingPlacementStamps(ops, [PLACE_A])
    expect(plan.has('pocket-empty')).toBe(false)
    expect(plan.has('drill-empty')).toBe(false)
  })

  it('non-companion kinds never inherit (cnc_parallel, fdm_slice, cnc_pcb_drill, cnc_laser)', () => {
    const inside: number[][] = [
      [20, 20],
      [40, 20],
      [40, 40]
    ]
    const ops = [
      makeOp({ id: 'contour-a', params: { contourPoints: OUTLINE_A } }),
      makeOp({ id: 'op-parallel', kind: 'cnc_parallel', params: { contourPoints: inside } }),
      makeOp({ id: 'op-fdm', kind: 'fdm_slice', params: { contourPoints: inside } }),
      makeOp({ id: 'op-pcb', kind: 'cnc_pcb_drill', params: { drillPoints: inside } }),
      makeOp({ id: 'op-laser', kind: 'cnc_laser', params: { contourPoints: inside } })
    ]
    const plan = planNestingPlacementStamps(ops, [PLACE_A])
    expect([...plan.keys()]).toEqual(['contour-a'])
  })

  it('overflow parts (sheetIndex > 0) plan entries for contour AND companions (executor strips them)', () => {
    const overflow: NestedPlacementInput = {
      partId: 'contour-a',
      xMm: 5,
      yMm: 5,
      rotationDeg: 0,
      sheetIndex: 1
    }
    const plan = planNestingPlacementStamps(partAFamily(), [overflow])
    expect(plan.get('contour-a')!.placement.sheetIndex).toBe(1)
    expect(plan.get('pocket-a')!.placement.sheetIndex).toBe(1)
    expect(plan.get('drill-a')!.viaSibling).toBe(true)
  })

  it('a contour anchor with fewer than 3 valid outline points cannot adopt companions', () => {
    const ops = [
      makeOp({
        id: 'contour-a',
        params: {
          contourPoints: [
            [0, 0],
            [100, 0]
          ]
        }
      }),
      makeOp({
        id: 'pocket-a',
        kind: 'cnc_pocket',
        params: {
          contourPoints: [
            [20, 20],
            [40, 20],
            [40, 40]
          ]
        }
      })
    ]
    const plan = planNestingPlacementStamps(ops, [PLACE_A])
    expect(plan.has('contour-a')).toBe(true) // direct stamp still applies
    expect(plan.has('pocket-a')).toBe(false) // but no containment anchor exists
  })

  it('does not mutate operations or placements', () => {
    const ops = partAFamily()
    const placements = [PLACE_A]
    const opsSnapshot = JSON.parse(JSON.stringify(ops)) as unknown
    const placementsSnapshot = JSON.parse(JSON.stringify(placements)) as unknown
    planNestingPlacementStamps(ops, placements)
    expect(ops).toEqual(opsSnapshot)
    expect(placements).toEqual(placementsSnapshot)
  })
})

describe('COMPANION_2D_OP_KINDS — the exact Wave 3l companion set', () => {
  it('is exactly pocket + vcarve + chamfer + drill (PCB + contour excluded by design)', () => {
    expect([...COMPANION_2D_OP_KINDS]).toEqual([
      'cnc_pocket',
      'cnc_vcarve',
      'cnc_chamfer',
      'cnc_drill'
    ])
  })
})
