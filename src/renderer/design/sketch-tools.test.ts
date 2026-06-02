/**
 * sketch-tools.ts — tool palette + click routing tests (CAD V1 MVP).
 *
 * Pure unit tests; the routing function is intentionally framework-free
 * so each branch can be exercised without a DOM event simulator.
 */

import { describe, expect, it } from 'vitest'
import {
  emptyDraft,
  getSketchTool,
  handleSketchToolClick,
  makeDeterministicIdFactory,
  SKETCH_TOOLS,
  type SketchPick,
  type SketchToolDraft
} from './sketch-tools'
import type { SketchEntity } from './sketch-state'

const noCtx = { entities: [] as SketchEntity[] }

function pick(x: number, y: number, opts: Partial<SketchPick> = {}): SketchPick {
  return { x, y, ...opts }
}

describe('sketch-tools — palette catalogue', () => {
  it('exposes the V1.5 tool set (5 draw + spline + 7 constraints + select)', () => {
    const ids = SKETCH_TOOLS.map((t) => t.id).sort()
    expect(ids).toEqual(
      [
        'arc',
        'circle',
        'coincidentConstraint',
        'distanceConstraint',
        'horizontalConstraint',
        'line',
        'parallelConstraint',
        'perpendicularConstraint',
        'radiusConstraint',
        'rectangle',
        'select',
        'spline',
        'verticalConstraint'
      ].sort()
    )
  })

  it('getSketchTool returns the descriptor for a valid id', () => {
    const t = getSketchTool('line')
    expect(t.kind).toBe('draw')
    expect(t.requiredPicks).toBe(2)
  })

  it('getSketchTool throws on an unknown id', () => {
    expect(() => getSketchTool('bogus' as never)).toThrow()
  })
})

describe('sketch-tools — handleSketchToolClick draw routing', () => {
  it('select tool returns noop', () => {
    const r = handleSketchToolClick('select', emptyDraft, pick(0, 0), noCtx)
    expect(r.kind).toBe('noop')
  })

  it('line tool accumulates 1 pick, commits on the second', () => {
    const factory = makeDeterministicIdFactory()
    const r1 = handleSketchToolClick('line', emptyDraft, pick(0, 0), {
      ...noCtx,
      nextId: factory
    })
    expect(r1.kind).toBe('updateDraft')
    if (r1.kind === 'updateDraft') expect(r1.draft.picks).toHaveLength(1)
    const r2 = handleSketchToolClick('line', { picks: [pick(0, 0)] }, pick(10, 0), {
      ...noCtx,
      nextId: factory
    })
    expect(r2.kind).toBe('commit')
    if (r2.kind === 'commit') {
      expect(r2.action.type).toBe('addLine')
      expect(r2.resetDraft).toBe(true)
    }
  })

  it('line tool rejects coincident endpoints', () => {
    const r = handleSketchToolClick('line', { picks: [pick(0, 0)] }, pick(0, 0), noCtx)
    expect(r.kind).toBe('error')
  })

  it('circle tool commits centre + radius from two picks', () => {
    const r = handleSketchToolClick('circle', { picks: [pick(0, 0)] }, pick(3, 4), noCtx)
    expect(r.kind).toBe('commit')
    if (r.kind === 'commit' && r.action.type === 'addCircle') {
      expect(r.action.radius).toBeCloseTo(5, 6)
    }
  })

  it('circle tool rejects a near-zero radius', () => {
    const r = handleSketchToolClick('circle', { picks: [pick(0, 0)] }, pick(0.1, 0.1), noCtx)
    expect(r.kind).toBe('error')
  })

  it('arc tool needs three picks and rejects collinear triples', () => {
    const r2 = handleSketchToolClick('arc', { picks: [pick(0, 0), pick(5, 0)] }, pick(10, 0), noCtx)
    expect(r2.kind).toBe('error')
    const rOk = handleSketchToolClick('arc', { picks: [pick(0, 0), pick(5, 3)] }, pick(10, 0), noCtx)
    expect(rOk.kind).toBe('commit')
  })

  it('rectangle commits four addLine actions sharing corner ids', () => {
    const factory = makeDeterministicIdFactory()
    const r = handleSketchToolClick(
      'rectangle',
      { picks: [pick(0, 0)] },
      pick(10, 5),
      { ...noCtx, nextId: factory }
    )
    expect(r.kind).toBe('commitMany')
    if (r.kind === 'commitMany') {
      expect(r.actions).toHaveLength(4)
      // Each action is addLine
      for (const a of r.actions) expect(a.type).toBe('addLine')
      // Verify the corners form a closed loop -- end of action[i] matches start of action[i+1].
      for (let i = 0; i < 4; i++) {
        const cur = r.actions[i]!
        const next = r.actions[(i + 1) % 4]!
        if (cur.type === 'addLine' && next.type === 'addLine') {
          expect(cur.end.id).toBe(next.start.id)
        }
      }
    }
  })

  it('rectangle rejects a zero-area drag', () => {
    const r = handleSketchToolClick('rectangle', { picks: [pick(0, 0)] }, pick(0.1, 0.1), noCtx)
    expect(r.kind).toBe('error')
  })
})

describe('sketch-tools — handleSketchToolClick constraint routing', () => {
  it('horizontal constraint requires both picks to snap to existing points', () => {
    const r1 = handleSketchToolClick(
      'horizontalConstraint',
      emptyDraft,
      pick(0, 0), // no pointId
      noCtx
    )
    expect(r1.kind).toBe('error')
  })

  it('horizontal constraint commits on two distinct point picks', () => {
    const factory = makeDeterministicIdFactory()
    const draft: SketchToolDraft = { picks: [pick(0, 0, { pointId: 'a' })] }
    const r = handleSketchToolClick('horizontalConstraint', draft, pick(5, 0, { pointId: 'b' }), {
      ...noCtx,
      nextId: factory
    })
    expect(r.kind).toBe('commit')
    if (r.kind === 'commit' && r.action.type === 'addConstraint') {
      expect(r.action.constraint.kind).toBe('horizontal')
      if (r.action.constraint.kind === 'horizontal') {
        expect(r.action.constraint.aId).toBe('a')
        expect(r.action.constraint.bId).toBe('b')
      }
    }
  })

  it('coincident constraint rejects when both picks are the same point', () => {
    const draft: SketchToolDraft = { picks: [pick(0, 0, { pointId: 'a' })] }
    const r = handleSketchToolClick('coincidentConstraint', draft, pick(0, 0, { pointId: 'a' }), noCtx)
    expect(r.kind).toBe('error')
  })

  it('distance constraint requires a positive numeric value in the draft', () => {
    const draft: SketchToolDraft = { picks: [pick(0, 0, { pointId: 'a' })] } // no numericValue
    const r = handleSketchToolClick('distanceConstraint', draft, pick(5, 0, { pointId: 'b' }), noCtx)
    expect(r.kind).toBe('error')
  })

  it('distance constraint commits with the supplied value', () => {
    const draft: SketchToolDraft = {
      picks: [pick(0, 0, { pointId: 'a' })],
      numericValue: 25
    }
    const r = handleSketchToolClick('distanceConstraint', draft, pick(5, 0, { pointId: 'b' }), noCtx)
    expect(r.kind).toBe('commit')
    if (r.kind === 'commit' && r.action.type === 'addConstraint') {
      if (r.action.constraint.kind === 'distance') {
        expect(r.action.constraint.value).toBe(25)
      }
    }
  })

  it('radius constraint targets a clicked circle entity', () => {
    const entities: SketchEntity[] = [
      { id: 'C', kind: 'circle', centerId: 'cp', radius: 5 }
    ]
    const r = handleSketchToolClick(
      'radiusConstraint',
      { picks: [], numericValue: 8 },
      pick(0, 0, { entityId: 'C' }),
      { entities }
    )
    expect(r.kind).toBe('commit')
    if (r.kind === 'commit' && r.action.type === 'addConstraint') {
      if (r.action.constraint.kind === 'radius') {
        expect(r.action.constraint.entityId).toBe('C')
        expect(r.action.constraint.value).toBe(8)
      }
    }
  })

  it('radius constraint rejects when no entity was clicked', () => {
    const r = handleSketchToolClick(
      'radiusConstraint',
      { picks: [], numericValue: 8 },
      pick(0, 0),
      noCtx
    )
    expect(r.kind).toBe('error')
  })
})

describe('sketch-tools — deterministic id factory', () => {
  it('emits prefixed monotonic ids', () => {
    const f = makeDeterministicIdFactory(0)
    expect(f('p')).toBe('p1')
    expect(f('e')).toBe('e2')
    expect(f('c')).toBe('c3')
  })

  it('seed controls the starting counter', () => {
    const f = makeDeterministicIdFactory(100)
    expect(f('p')).toBe('p101')
  })
})

// ── CAD V1.5 sketcher upgrades ──────────────────────────────────────────────
//
// New tool router branches: spline (3-pick quadratic Bézier), parallelConstraint
// + perpendicularConstraint (4-pick endpoint snapping). The existing arc tool
// (start / via / end) is reverified end-to-end since the cycle's task scoped
// the four new IDs around the same router.

describe('sketch-tools — V1.5 spline draw tool', () => {
  it('spline descriptor is a 3-pick draw tool', () => {
    const t = getSketchTool('spline')
    expect(t.kind).toBe('draw')
    expect(t.requiredPicks).toBe(3)
    expect(t.label).toBe('Spline')
  })

  it('spline accumulates two picks then commits the third as addSpline', () => {
    const factory = makeDeterministicIdFactory()
    // Pick 1: start
    const r1 = handleSketchToolClick('spline', emptyDraft, pick(0, 0), {
      ...noCtx,
      nextId: factory
    })
    expect(r1.kind).toBe('updateDraft')
    if (r1.kind === 'updateDraft') expect(r1.draft.picks).toHaveLength(1)
    // Pick 2: via
    const r2 = handleSketchToolClick('spline', { picks: [pick(0, 0)] }, pick(5, 3), {
      ...noCtx,
      nextId: factory
    })
    expect(r2.kind).toBe('updateDraft')
    if (r2.kind === 'updateDraft') expect(r2.draft.picks).toHaveLength(2)
    // Pick 3: end -- commits the curve.
    const r3 = handleSketchToolClick(
      'spline',
      { picks: [pick(0, 0), pick(5, 3)] },
      pick(10, 0),
      { ...noCtx, nextId: factory }
    )
    expect(r3.kind).toBe('commit')
    if (r3.kind === 'commit') {
      expect(r3.action.type).toBe('addSpline')
      expect(r3.resetDraft).toBe(true)
      if (r3.action.type === 'addSpline') {
        expect(r3.action.start.x).toBe(0)
        expect(r3.action.via.x).toBe(5)
        expect(r3.action.end.x).toBe(10)
      }
    }
  })

  it('spline rejects coincident start / end picks', () => {
    const r = handleSketchToolClick(
      'spline',
      { picks: [pick(0, 0), pick(5, 3)] },
      pick(0, 0),
      noCtx
    )
    expect(r.kind).toBe('error')
    if (r.kind === 'error') expect(r.message).toMatch(/coincide/)
  })
})

describe('sketch-tools — V1.5 parallel constraint tool', () => {
  it('parallelConstraint descriptor is a 4-pick constraint tool', () => {
    const t = getSketchTool('parallelConstraint')
    expect(t.kind).toBe('constraint')
    expect(t.requiredPicks).toBe(4)
    expect(t.label).toBe('Parallel')
  })

  it('parallel constraint requires every pick to snap to an existing point', () => {
    const r = handleSketchToolClick(
      'parallelConstraint',
      emptyDraft,
      pick(0, 0), // no pointId
      noCtx
    )
    expect(r.kind).toBe('error')
    if (r.kind === 'error') expect(r.message).toMatch(/Parallel/)
  })

  it('parallel constraint accumulates 3 picks before committing on the 4th', () => {
    const factory = makeDeterministicIdFactory()
    const draftAfter1: SketchToolDraft = { picks: [pick(0, 0, { pointId: 'a1' })] }
    const r2 = handleSketchToolClick(
      'parallelConstraint',
      draftAfter1,
      pick(5, 0, { pointId: 'b1' }),
      { ...noCtx, nextId: factory }
    )
    expect(r2.kind).toBe('updateDraft')
    if (r2.kind === 'updateDraft') expect(r2.draft.picks).toHaveLength(2)

    const draftAfter2: SketchToolDraft = {
      picks: [pick(0, 0, { pointId: 'a1' }), pick(5, 0, { pointId: 'b1' })]
    }
    const r3 = handleSketchToolClick(
      'parallelConstraint',
      draftAfter2,
      pick(0, 5, { pointId: 'a2' }),
      { ...noCtx, nextId: factory }
    )
    expect(r3.kind).toBe('updateDraft')
    if (r3.kind === 'updateDraft') expect(r3.draft.picks).toHaveLength(3)

    const draftAfter3: SketchToolDraft = {
      picks: [
        pick(0, 0, { pointId: 'a1' }),
        pick(5, 0, { pointId: 'b1' }),
        pick(0, 5, { pointId: 'a2' })
      ]
    }
    const r4 = handleSketchToolClick(
      'parallelConstraint',
      draftAfter3,
      pick(5, 5, { pointId: 'b2' }),
      { ...noCtx, nextId: factory }
    )
    expect(r4.kind).toBe('commit')
    if (r4.kind === 'commit' && r4.action.type === 'addConstraint') {
      expect(r4.action.constraint.kind).toBe('parallel')
      if (r4.action.constraint.kind === 'parallel') {
        expect(r4.action.constraint.a1Id).toBe('a1')
        expect(r4.action.constraint.b1Id).toBe('b1')
        expect(r4.action.constraint.a2Id).toBe('a2')
        expect(r4.action.constraint.b2Id).toBe('b2')
      }
    }
  })

  it('parallel rejects when either line collapses (a1 == b1 or a2 == b2)', () => {
    const draft: SketchToolDraft = {
      picks: [
        pick(0, 0, { pointId: 'a1' }),
        pick(5, 0, { pointId: 'a1' }), // duplicate of a1
        pick(0, 5, { pointId: 'a2' })
      ]
    }
    const r = handleSketchToolClick(
      'parallelConstraint',
      draft,
      pick(5, 5, { pointId: 'b2' }),
      noCtx
    )
    expect(r.kind).toBe('error')
    if (r.kind === 'error') expect(r.message).toMatch(/distinct endpoints/)
  })
})

describe('sketch-tools — V1.5 perpendicular constraint tool', () => {
  it('perpendicularConstraint descriptor is a 4-pick constraint tool', () => {
    const t = getSketchTool('perpendicularConstraint')
    expect(t.kind).toBe('constraint')
    expect(t.requiredPicks).toBe(4)
    expect(t.label).toBe('Perpendicular')
  })

  it('perpendicular constraint commits on four valid point picks', () => {
    const factory = makeDeterministicIdFactory()
    const draft: SketchToolDraft = {
      picks: [
        pick(0, 0, { pointId: 'a1' }),
        pick(5, 0, { pointId: 'b1' }),
        pick(0, 0, { pointId: 'a2' })
      ]
    }
    const r = handleSketchToolClick(
      'perpendicularConstraint',
      draft,
      pick(0, 5, { pointId: 'b2' }),
      { ...noCtx, nextId: factory }
    )
    expect(r.kind).toBe('commit')
    if (r.kind === 'commit' && r.action.type === 'addConstraint') {
      expect(r.action.constraint.kind).toBe('perpendicular')
      if (r.action.constraint.kind === 'perpendicular') {
        expect(r.action.constraint.a1Id).toBe('a1')
        expect(r.action.constraint.b2Id).toBe('b2')
      }
    }
  })

  it('perpendicular constraint rejects a non-snapped first pick', () => {
    const r = handleSketchToolClick(
      'perpendicularConstraint',
      emptyDraft,
      pick(0, 0), // no pointId
      noCtx
    )
    expect(r.kind).toBe('error')
    if (r.kind === 'error') expect(r.message).toMatch(/Perpendicular/)
  })

  it('perpendicular rejects when not all picks snap to existing points', () => {
    // The router enforces ``pick.pointId`` on every incoming pick (not just
    // the first). Feeding a pick with no pointId on the 4th tries fails fast.
    const draft: SketchToolDraft = {
      picks: [
        pick(0, 0, { pointId: 'a1' }),
        pick(5, 0, { pointId: 'b1' }),
        pick(0, 0, { pointId: 'a2' })
      ]
    }
    const r = handleSketchToolClick(
      'perpendicularConstraint',
      draft,
      pick(0, 5), // missing pointId
      noCtx
    )
    expect(r.kind).toBe('error')
  })
})

describe('sketch-tools — arc router (V1.5 reverification)', () => {
  it('arc descriptor is a 3-pick draw tool', () => {
    const t = getSketchTool('arc')
    expect(t.kind).toBe('draw')
    expect(t.requiredPicks).toBe(3)
  })

  it('arc commits an addArc action with deterministic ids', () => {
    const factory = makeDeterministicIdFactory(100)
    const r = handleSketchToolClick(
      'arc',
      { picks: [pick(0, 0), pick(5, 3)] },
      pick(10, 0),
      { ...noCtx, nextId: factory }
    )
    expect(r.kind).toBe('commit')
    if (r.kind === 'commit' && r.action.type === 'addArc') {
      // First call to the factory bumps from 100 → 101 with prefix 'e'.
      expect(r.action.id).toBe('e101')
    }
  })

  it('arc clears the draft on commit (resetDraft: true)', () => {
    const r = handleSketchToolClick(
      'arc',
      { picks: [pick(0, 0), pick(5, 3)] },
      pick(10, 0),
      noCtx
    )
    if (r.kind === 'commit') expect(r.resetDraft).toBe(true)
  })
})
