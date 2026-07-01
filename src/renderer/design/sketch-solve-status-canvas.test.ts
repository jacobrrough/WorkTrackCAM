/**
 * sketch-solve-status-canvas.test.ts — the canvas-wiring helpers (CAD V1).
 *
 * Covers the pure pieces ``Sketch2DCanvas`` / ``MvpSketchCanvas`` lean on to
 * turn a sidecar solve result into (a) the entity colour the canvas paints and
 * (b) the DOF-badge text it shows. No React or DOM: every helper is pure, so a
 * regression points straight at the broken mapping rather than at a render.
 *
 * The base diagnosis → UI-flag mapping itself is pinned in
 * ``sketch-solve-status.test.ts``; this file pins the additive wiring layer:
 *   - ``adaptSolveResultToDiagnosis`` (bridge wire shape → normalised diagnosis,
 *     including the four-valued ``'conflicting'`` → three-valued ``'over'`` fold),
 *   - ``entityStrokeToken`` (entity flags → theme colour token),
 *   - ``sketchStatusBadgeModifier`` (status → BEM/data-status suffix), and
 *   - the DOF-badge text selection (``sketchStatusBadgeLabel`` over a map built
 *     from an adapted bridge result — the exact path the ribbon badge renders).
 */

import { describe, expect, it } from 'vitest'
import {
  adaptSolveResultToDiagnosis,
  entityStrokeToken,
  mapSolveDiagnosisToStatus,
  selectDofBadgeView,
  sketchStatusBadgeLabel,
  sketchStatusBadgeModifier,
  type EntityUiFlags
} from './sketch-solve-status'
import { initialSketchState, sketchReducer, type Sketch } from './sketch-state'

/** A one-line sketch with a horizontal constraint (id ``h1`` over line ``L1``). */
function lineWithHorizontal(): Sketch {
  let s = initialSketchState()
  s = sketchReducer(s, {
    type: 'addLine',
    id: 'L1',
    start: { id: 'a', x: 0, y: 0 },
    end: { id: 'b', x: 10, y: 1 }
  })
  s = sketchReducer(s, {
    type: 'addConstraint',
    constraint: { id: 'h1', kind: 'horizontal', aId: 'a', bId: 'b' }
  })
  return s.sketch
}

describe('adaptSolveResultToDiagnosis — bridge wire shape → normalised diagnosis', () => {
  it('passes dof + id lists straight through', () => {
    const d = adaptSolveResultToDiagnosis({
      dof: 3,
      status: 'under',
      conflictingConstraintIds: ['x'],
      redundantConstraintIds: ['y']
    })
    expect(d.dof).toBe(3)
    expect(d.status).toBe('under')
    expect(d.conflictingConstraintIds).toEqual(['x'])
    expect(d.redundantConstraintIds).toEqual(['y'])
  })

  it('folds the four-valued wire "conflicting" onto the three-valued "over"', () => {
    const d = adaptSolveResultToDiagnosis({ dof: 0, status: 'conflicting' })
    expect(d.status).toBe('over')
  })

  it('maps fully / under / over verbatim', () => {
    expect(adaptSolveResultToDiagnosis({ status: 'fully' }).status).toBe('fully')
    expect(adaptSolveResultToDiagnosis({ status: 'under' }).status).toBe('under')
    expect(adaptSolveResultToDiagnosis({ status: 'over' }).status).toBe('over')
  })

  it('leaves status undefined when the bridge omitted it (mapper derives from dof)', () => {
    const d = adaptSolveResultToDiagnosis({ dof: 2 })
    expect(d.status).toBeUndefined()
    // Threading through the mapper, a positive dof + no status → under.
    expect(mapSolveDiagnosisToStatus(lineWithHorizontal(), d).sketchStatus).toBe('under')
  })
})

describe('entityStrokeToken — entity flags → theme colour token', () => {
  const flags = (over: Partial<EntityUiFlags>): EntityUiFlags => ({
    status: 'fully',
    conflicting: false,
    ...over
  })

  it('conflicting entity → err token regardless of status', () => {
    expect(entityStrokeToken(flags({ status: 'fully', conflicting: true }))).toBe('var(--err)')
    expect(entityStrokeToken(flags({ status: 'under', conflicting: true }))).toBe('var(--err)')
  })

  it('under-constrained (non-conflicting) → accent (blue)', () => {
    expect(entityStrokeToken(flags({ status: 'under' }))).toBe('var(--accent)')
  })

  it('fully constrained → txt0 (defined geometry)', () => {
    expect(entityStrokeToken(flags({ status: 'fully' }))).toBe('var(--txt0)')
  })

  it('over-constrained sketch tint → err even without a direct conflict ref', () => {
    expect(entityStrokeToken(flags({ status: 'over', conflicting: false }))).toBe('var(--err)')
  })

  it('every token returned is a CSS var reference (no raw literals)', () => {
    for (const s of ['under', 'fully', 'over'] as const) {
      for (const conflicting of [true, false]) {
        expect(entityStrokeToken({ status: s, conflicting })).toMatch(/^var\(--[a-z0-9-]+\)$/)
      }
    }
  })
})

describe('sketchStatusBadgeModifier — status → data-status / BEM suffix', () => {
  it('returns the status verbatim for all three UI states', () => {
    expect(sketchStatusBadgeModifier('fully')).toBe('fully')
    expect(sketchStatusBadgeModifier('under')).toBe('under')
    expect(sketchStatusBadgeModifier('over')).toBe('over')
  })
})

describe('DOF-badge text selection (the ribbon badge render path)', () => {
  /**
   * Mirror the component: adapt the bridge result, map it against the live
   * sketch, then pick the badge label — pinning the exact string the operator
   * reads for each solver verdict.
   */
  const badgeFor = (sketch: Sketch, result: Parameters<typeof adaptSolveResultToDiagnosis>[0]): string =>
    sketchStatusBadgeLabel(mapSolveDiagnosisToStatus(sketch, adaptSolveResultToDiagnosis(result)))

  it('fully constrained → "Fully constrained"', () => {
    expect(badgeFor(lineWithHorizontal(), { dof: 0, status: 'fully' })).toBe('Fully constrained')
  })

  it('under-constrained → "Under-constrained: N DOF" with the live dof count', () => {
    expect(badgeFor(lineWithHorizontal(), { dof: 4, status: 'under' })).toBe('Under-constrained: 4 DOF')
  })

  it('over-constrained from wire "conflicting" NAMES the culprit (kind + id) with the removal hint', () => {
    expect(
      badgeFor(lineWithHorizontal(), { dof: 0, status: 'conflicting', conflictingConstraintIds: ['h1'] })
    ).toBe('Over-constrained — Horizontal h1 conflicts; remove it or another constraint on these entities')
  })

  it('over-constrained from negative dof falls back to the bare label', () => {
    expect(badgeFor(lineWithHorizontal(), { dof: -1, status: 'over' })).toBe('Over-constrained')
  })

  it('stale conflicting ids the sketch no longer holds are dropped from the label', () => {
    // ``ghost`` is not a live constraint id → filtered out; only ``h1`` shows.
    expect(
      badgeFor(lineWithHorizontal(), {
        status: 'conflicting',
        conflictingConstraintIds: ['ghost', 'h1']
      })
    ).toBe('Over-constrained — Horizontal h1 conflicts; remove it or another constraint on these entities')
  })
})

describe('canvas tint integration — adapted result drives per-entity colour', () => {
  it('an over-constrained conflict on h1 paints the owning line red', () => {
    const sketch = lineWithHorizontal()
    const map = mapSolveDiagnosisToStatus(
      sketch,
      adaptSolveResultToDiagnosis({ status: 'conflicting', conflictingConstraintIds: ['h1'] })
    )
    const lineFlags = map.entityFlags.get('L1')
    expect(lineFlags).toBeDefined()
    expect(entityStrokeToken(lineFlags!)).toBe('var(--err)')
  })

  it('a clean under-constrained solve paints the line accent-blue', () => {
    const sketch = lineWithHorizontal()
    const map = mapSolveDiagnosisToStatus(sketch, adaptSolveResultToDiagnosis({ dof: 4, status: 'under' }))
    expect(entityStrokeToken(map.entityFlags.get('L1')!)).toBe('var(--accent)')
  })

  it('a fully constrained solve paints the line as defined geometry (txt0)', () => {
    const sketch = lineWithHorizontal()
    const map = mapSolveDiagnosisToStatus(sketch, adaptSolveResultToDiagnosis({ dof: 0, status: 'fully' }))
    expect(entityStrokeToken(map.entityFlags.get('L1')!)).toBe('var(--txt0)')
  })
})

describe('selectDofBadgeView — the badge honesty contract', () => {
  const sketch = lineWithHorizontal()
  // A statusMap that, if trusted, would read "Fully constrained".
  const fullyMap = mapSolveDiagnosisToStatus(
    sketch,
    adaptSolveResultToDiagnosis({ dof: 0, status: 'fully' })
  )
  // A statusMap that would read "Under-constrained: 3 DOF".
  const underMap = mapSolveDiagnosisToStatus(
    sketch,
    adaptSolveResultToDiagnosis({ dof: 3, status: 'under' })
  )

  it('no diagnosis yet → "Not solved"', () => {
    expect(selectDofBadgeView(null, false, fullyMap)).toEqual({
      label: 'Not solved',
      status: 'not-solved'
    })
  })

  it('no diagnosis dominates the authoritative flag → still "Not solved"', () => {
    expect(selectDofBadgeView(null, true, fullyMap).status).toBe('not-solved')
  })

  it('local (non-authoritative) solve → neutral "Solved", NEVER a verdict', () => {
    // The whole point: even though ``fullyMap.sketchStatus === 'fully'``, a
    // non-authoritative (local energy) solve must not claim "Fully constrained".
    const v = selectDofBadgeView({ dof: 0, status: 'fully' }, false, fullyMap)
    expect(v).toEqual({ label: 'Solved', status: 'solved' })
    expect(v.label).not.toBe('Fully constrained')
  })

  it('local solve over an actually-under-constrained sketch still reads "Solved" (no false "Fully")', () => {
    // The exact operator-misleading failure mode being guarded: an
    // under-constrained sketch solved locally must NOT read "Fully constrained".
    const v = selectDofBadgeView({ status: 'fully' }, false, underMap)
    expect(v.label).toBe('Solved')
    expect(v.status).toBe('solved')
  })

  it('authoritative fully → the real "Fully constrained" verdict', () => {
    expect(selectDofBadgeView({ dof: 0, status: 'fully' }, true, fullyMap)).toEqual({
      label: 'Fully constrained',
      status: 'fully'
    })
  })

  it('authoritative under → "Under-constrained: N DOF" with the live count', () => {
    expect(selectDofBadgeView({ dof: 3, status: 'under' }, true, underMap)).toEqual({
      label: 'Under-constrained: 3 DOF',
      status: 'under'
    })
  })

  it('authoritative over → "Over-constrained — <named culprit>"', () => {
    const overMap = mapSolveDiagnosisToStatus(
      sketch,
      adaptSolveResultToDiagnosis({ status: 'conflicting', conflictingConstraintIds: ['h1'] })
    )
    const v = selectDofBadgeView({ status: 'over', conflictingConstraintIds: ['h1'] }, true, overMap)
    expect(v.status).toBe('over')
    expect(v.label).toBe(
      'Over-constrained — Horizontal h1 conflicts; remove it or another constraint on these entities'
    )
  })

  it('authoritative view agrees with the underlying label + modifier helpers', () => {
    const v = selectDofBadgeView({ dof: 3, status: 'under' }, true, underMap)
    expect(v.label).toBe(sketchStatusBadgeLabel(underMap))
    expect(v.status).toBe(sketchStatusBadgeModifier(underMap.sketchStatus))
  })
})
