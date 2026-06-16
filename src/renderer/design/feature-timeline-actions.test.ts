import { describe, expect, it } from 'vitest'
import type { KernelPostSolidOp, PartFeatureItem } from '../../shared/part-features-schema'
import {
  applyTimelineAction,
  deleteFeature,
  effectiveOpsForState,
  moveFeatureDown,
  moveFeatureUp,
  toggleSuppress,
  type TimelineState
} from './feature-timeline-actions'

// ── Fixtures: schema-faithful minimal op variants ──────────────────────────
const unionBox = (): KernelPostSolidOp => ({
  kind: 'boolean_union_box',
  xMinMm: 0,
  xMaxMm: 10,
  yMinMm: 0,
  yMaxMm: 10,
  zMinMm: 0,
  zMaxMm: 5
})
const patternRect = (): KernelPostSolidOp => ({
  kind: 'pattern_rectangular',
  countX: 2,
  countY: 1,
  spacingXMm: 30,
  spacingYMm: 0
})
const filletAll = (radiusMm = 0.5): KernelPostSolidOp => ({ kind: 'fillet_all', radiusMm })
const chamferAll = (lengthMm = 0.2): KernelPostSolidOp => ({ kind: 'chamfer_all', lengthMm })
// A second NON-finishing op so a create op can legally land after it.
const subtractBox = (): KernelPostSolidOp => ({
  kind: 'boolean_subtract_box',
  xMinMm: 1,
  xMaxMm: 4,
  yMinMm: 1,
  yMaxMm: 4,
  zMinMm: 0,
  zMaxMm: 3
})

const kinds = (ops: ReadonlyArray<KernelPostSolidOp>): string[] => ops.map((o) => o.kind)

describe('applyTimelineAction / move (keyboard up/down)', () => {
  it('moves an op down by one and reports a change', () => {
    const state: TimelineState = { kernelOps: [unionBox(), patternRect(), filletAll()] }
    const r = applyTimelineAction(state, { type: 'move', index: 0, delta: 1 })
    expect(r.changed).toBe(true)
    if (r.changed) {
      expect(kinds(r.state.kernelOps)).toEqual([
        'pattern_rectangular',
        'boolean_union_box',
        'fillet_all'
      ])
      expect(r.status).toMatch(/order/i)
    }
  })

  it('moves an op up by one', () => {
    const state: TimelineState = { kernelOps: [unionBox(), patternRect(), filletAll()] }
    const r = applyTimelineAction(state, { type: 'move', index: 1, delta: -1 })
    expect(r.changed).toBe(true)
    if (r.changed) {
      expect(kinds(r.state.kernelOps)).toEqual([
        'pattern_rectangular',
        'boolean_union_box',
        'fillet_all'
      ])
    }
  })

  it('rejects a move out of range (no change, unchanged state)', () => {
    const state: TimelineState = { kernelOps: [unionBox(), filletAll()] }
    const r = applyTimelineAction(state, { type: 'move', index: 1, delta: 1 })
    expect(r.changed).toBe(false)
    if (!r.changed) expect(r.reason).toMatch(/range/i)
    expect(r.state).toBe(state) // referentially unchanged
  })

  it('rejects moving a finishing op above a create/boolean op (finishing-op rule)', () => {
    const state: TimelineState = { kernelOps: [unionBox(), filletAll()] }
    // Move the fillet (index 1) up to index 0 -> fillet before the union box.
    const r = applyTimelineAction(state, { type: 'move', index: 1, delta: -1 })
    expect(r.changed).toBe(false)
    if (!r.changed) expect(r.reason).toMatch(/finishing/i)
  })

  it('preserves the suppressed flag across a move (order ≠ suppress)', () => {
    const state: TimelineState = {
      kernelOps: [unionBox(), { ...patternRect(), suppressed: true }, filletAll()]
    }
    const r = applyTimelineAction(state, { type: 'move', index: 1, delta: -1 })
    expect(r.changed).toBe(true)
    if (r.changed) {
      // pattern moved to front and KEEPS suppressed:true.
      expect(r.state.kernelOps[0]).toMatchObject({ kind: 'pattern_rectangular', suppressed: true })
    }
  })
})

describe('applyTimelineAction / reorder (drag)', () => {
  it('drags an op from front to back', () => {
    const state: TimelineState = { kernelOps: [unionBox(), patternRect(), subtractBox()] }
    const r = applyTimelineAction(state, { type: 'reorder', from: 0, to: 2 })
    expect(r.changed).toBe(true)
    if (r.changed) {
      expect(kinds(r.state.kernelOps)).toEqual([
        'pattern_rectangular',
        'boolean_subtract_box',
        'boolean_union_box'
      ])
    }
  })

  it('is a no-op when from === to', () => {
    const state: TimelineState = { kernelOps: [unionBox(), patternRect()] }
    const r = applyTimelineAction(state, { type: 'reorder', from: 1, to: 1 })
    expect(r.changed).toBe(false)
    expect(r.state).toBe(state)
  })

  it('rejects a drag that lands a finishing op before a create op', () => {
    const state: TimelineState = { kernelOps: [unionBox(), patternRect(), filletAll()] }
    // Drag the fillet (2) to the very front -> fillet precedes both creates.
    const r = applyTimelineAction(state, { type: 'reorder', from: 2, to: 0 })
    expect(r.changed).toBe(false)
    if (!r.changed) expect(r.reason).toMatch(/finishing/i)
  })

  it('allows reordering two create ops freely', () => {
    const state: TimelineState = { kernelOps: [unionBox(), patternRect()] }
    const r = applyTimelineAction(state, { type: 'reorder', from: 0, to: 1 })
    expect(r.changed).toBe(true)
    if (r.changed) expect(kinds(r.state.kernelOps)).toEqual(['pattern_rectangular', 'boolean_union_box'])
  })

  it('does not mutate the input state or its ops array', () => {
    const state: TimelineState = { kernelOps: [unionBox(), patternRect(), subtractBox()] }
    const snapshot = JSON.parse(JSON.stringify(state))
    applyTimelineAction(state, { type: 'reorder', from: 0, to: 2 })
    expect(JSON.parse(JSON.stringify(state))).toEqual(snapshot)
  })
})

describe('applyTimelineAction / suppress', () => {
  it('suppresses an op by setting suppressed:true', () => {
    const state: TimelineState = { kernelOps: [unionBox(), filletAll()] }
    const r = applyTimelineAction(state, { type: 'suppress', index: 1, suppressed: true })
    expect(r.changed).toBe(true)
    if (r.changed) {
      expect(r.state.kernelOps[1]).toMatchObject({ kind: 'fillet_all', suppressed: true })
      expect(r.status).toMatch(/suppress/i)
    }
  })

  it('un-suppresses an op by DROPPING the key (not writing false)', () => {
    const state: TimelineState = { kernelOps: [unionBox(), { ...filletAll(), suppressed: true }] }
    const r = applyTimelineAction(state, { type: 'suppress', index: 1, suppressed: false })
    expect(r.changed).toBe(true)
    if (r.changed) {
      expect('suppressed' in r.state.kernelOps[1]!).toBe(false)
      expect(r.status).toMatch(/active/i)
    }
  })

  it('is a no-op when suppress state already matches', () => {
    const state: TimelineState = { kernelOps: [unionBox(), { ...filletAll(), suppressed: true }] }
    const r = applyTimelineAction(state, { type: 'suppress', index: 1, suppressed: true })
    expect(r.changed).toBe(false)
    expect(r.state).toBe(state)
  })

  it('rejects suppress out of range', () => {
    const state: TimelineState = { kernelOps: [unionBox()] }
    const r = applyTimelineAction(state, { type: 'suppress', index: 5, suppressed: true })
    expect(r.changed).toBe(false)
    if (!r.changed) expect(r.reason).toMatch(/range/i)
  })

  it('leaves the persisted op order untouched (suppress ≠ reorder)', () => {
    const state: TimelineState = { kernelOps: [unionBox(), patternRect(), filletAll()] }
    const r = applyTimelineAction(state, { type: 'suppress', index: 0, suppressed: true })
    expect(r.changed).toBe(true)
    if (r.changed) {
      expect(kinds(r.state.kernelOps)).toEqual([
        'boolean_union_box',
        'pattern_rectangular',
        'fillet_all'
      ])
    }
  })
})

describe('applyTimelineAction / rollback marker', () => {
  it('sets an inclusive roll-back marker', () => {
    const state: TimelineState = { kernelOps: [unionBox(), patternRect(), filletAll()] }
    const r = applyTimelineAction(state, { type: 'setRollback', index: 1 })
    expect(r.changed).toBe(true)
    if (r.changed) {
      expect(r.state.rolledBackTo).toBe(1)
      expect(r.status).toMatch(/op 2 of 3/i)
    }
  })

  it('normalizes a marker on the LAST row to "build all" (undefined)', () => {
    const state: TimelineState = { kernelOps: [unionBox(), patternRect(), filletAll()] }
    const r = applyTimelineAction(state, { type: 'setRollback', index: 2 })
    // Marker at last row is a no-op cut -> normalized to "build all".
    expect(r.changed).toBe(false)
    if (!r.changed) expect(r.reason).toMatch(/unchanged/i)
    expect(r.state.rolledBackTo).toBeUndefined()
  })

  it('rejects a roll-back target out of range', () => {
    const state: TimelineState = { kernelOps: [unionBox(), filletAll()] }
    const r = applyTimelineAction(state, { type: 'setRollback', index: 9 })
    expect(r.changed).toBe(false)
    if (!r.changed) expect(r.reason).toMatch(/range/i)
  })

  it('clears the roll-back marker', () => {
    const state: TimelineState = { kernelOps: [unionBox(), patternRect(), filletAll()], rolledBackTo: 0 }
    const r = applyTimelineAction(state, { type: 'clearRollback' })
    expect(r.changed).toBe(true)
    if (r.changed) {
      expect(r.state.rolledBackTo).toBeUndefined()
      expect('rolledBackTo' in r.state).toBe(false)
    }
  })

  it('is a no-op to clear when no marker is set', () => {
    const state: TimelineState = { kernelOps: [unionBox(), filletAll()] }
    const r = applyTimelineAction(state, { type: 'clearRollback' })
    expect(r.changed).toBe(false)
    expect(r.state).toBe(state)
  })

  it('keeps an in-range marker after a reorder (marker addresses a position, not an op)', () => {
    // Marker at resolved index 1 of a 3-op list. A reorder that keeps 3 ops
    // leaves the marker addressing a non-last position, so it survives.
    const state: TimelineState = { kernelOps: [unionBox(), patternRect(), subtractBox()], rolledBackTo: 1 }
    const r = applyTimelineAction(state, { type: 'reorder', from: 0, to: 2 })
    expect(r.changed).toBe(true)
    if (r.changed) {
      // Still a 3-op list, marker index 1 still addresses a non-last row.
      expect(r.state.rolledBackTo).toBe(1)
    }
  })
})

describe('effectiveOpsForState (preview wrapper)', () => {
  it('drops suppressed ops AND honors the roll-back cut', () => {
    const state: TimelineState = {
      kernelOps: [unionBox(), { ...patternRect(), suppressed: true }, chamferAll(), filletAll()],
      rolledBackTo: 2
    }
    // Roll back through index 2 -> [union, pattern(suppressed), chamfer];
    // suppressed pattern drops -> [union, chamfer].
    expect(kinds(effectiveOpsForState(state))).toEqual(['boolean_union_box', 'chamfer_all'])
  })

  it('returns the full active list when no marker and nothing suppressed', () => {
    const state: TimelineState = { kernelOps: [unionBox(), filletAll()] }
    expect(kinds(effectiveOpsForState(state))).toEqual(['boolean_union_box', 'fillet_all'])
  })

  it('strips the suppressed key from the effective (replay-ready) list', () => {
    const state: TimelineState = { kernelOps: [{ ...unionBox(), suppressed: false }] }
    const out = effectiveOpsForState(state)
    expect('suppressed' in out[0]!).toBe(false)
  })
})

describe('applyTimelineAction / additive-state integrity', () => {
  it('never emits rolledBackTo when there is no marker (canonical absence)', () => {
    const state: TimelineState = { kernelOps: [unionBox(), patternRect()] }
    const r = applyTimelineAction(state, { type: 'reorder', from: 0, to: 1 })
    expect(r.changed).toBe(true)
    if (r.changed) expect('rolledBackTo' in r.state).toBe(false)
  })

  it('round-trips an unedited-shaped state through a no-op without adding fields', () => {
    const state: TimelineState = { kernelOps: [unionBox()] }
    // A single op cannot move down; expect a clean no-op with the same object.
    const r = applyTimelineAction(state, { type: 'move', index: 0, delta: 1 })
    expect(r.changed).toBe(false)
    expect(r.state).toBe(state)
  })
})

// ── Feature-browser (`items[]`) by-id ops ───────────────────────────────────
const sketch = (id = 'sk1'): PartFeatureItem => ({ id, kind: 'sketch', label: 'Sketch1' })
const extrude = (id = 'ex1'): PartFeatureItem => ({
  id,
  kind: 'extrude',
  label: 'Extrude1',
  params: { depthMm: 12 }
})
const fillet = (id = 'fl1'): PartFeatureItem => ({ id, kind: 'fillet', label: 'Fillet1' })
const ids = (items: ReadonlyArray<PartFeatureItem>): string[] => items.map((i) => i.id)

describe('moveFeatureUp / moveFeatureDown (by id)', () => {
  it('moveFeatureDown moves a feature one slot later, returning a NEW array', () => {
    const items = [sketch(), extrude(), fillet()]
    const out = moveFeatureDown(items, 'sk1')
    expect(ids(out)).toEqual(['ex1', 'sk1', 'fl1'])
    expect(out).not.toBe(items) // new array
    expect(ids(items)).toEqual(['sk1', 'ex1', 'fl1']) // input untouched
  })

  it('moveFeatureUp moves a feature one slot earlier', () => {
    const items = [sketch(), extrude(), fillet()]
    expect(ids(moveFeatureUp(items, 'fl1'))).toEqual(['sk1', 'fl1', 'ex1'])
  })

  it('moveFeatureUp / moveFeatureDown are inverse operations', () => {
    const items = [sketch(), extrude(), fillet()]
    expect(ids(moveFeatureUp(moveFeatureDown(items, 'sk1'), 'sk1'))).toEqual(ids(items))
  })

  it('moveFeatureUp on the first feature is a no-op (same reference, no wrap)', () => {
    const items = [sketch(), extrude()]
    expect(moveFeatureUp(items, 'sk1')).toBe(items)
  })

  it('moveFeatureDown on the last feature is a no-op (same reference, no wrap)', () => {
    const items = [sketch(), extrude()]
    expect(moveFeatureDown(items, 'ex1')).toBe(items)
  })

  it('an unknown id is a no-op (same reference) for both directions', () => {
    const items = [sketch(), extrude()]
    expect(moveFeatureUp(items, 'nope')).toBe(items)
    expect(moveFeatureDown(items, 'nope')).toBe(items)
  })

  it('preserves the full item body (params, label) across a move', () => {
    const items = [sketch(), extrude()]
    const out = moveFeatureDown(items, 'sk1')
    expect(out[0]).toEqual(extrude())
    expect(out[1]).toEqual(sketch())
  })
})

describe('toggleSuppress (by id)', () => {
  it('flips an unsuppressed feature to suppressed: true', () => {
    const items = [sketch(), extrude()]
    const out = toggleSuppress(items, 'ex1')
    expect(out[1]).toEqual({ ...extrude(), suppressed: true })
    expect(out).not.toBe(items)
    expect(items[1]?.suppressed).toBeUndefined() // input untouched
  })

  it('un-suppressing DROPS the key entirely (not suppressed: false)', () => {
    const items = [sketch(), { ...extrude(), suppressed: true }]
    const out = toggleSuppress(items, 'ex1')
    expect('suppressed' in out[1]!).toBe(false)
    expect(out[1]).toEqual(extrude())
  })

  it('double toggle returns an equal (key-free) item', () => {
    const items = [extrude()]
    expect(toggleSuppress(toggleSuppress(items, 'ex1'), 'ex1')[0]).toEqual(extrude())
  })

  it('only the targeted feature is changed; siblings keep identity', () => {
    const items = [sketch(), extrude(), fillet()]
    const out = toggleSuppress(items, 'ex1')
    expect(out[0]).toBe(items[0]) // untouched rows keep referential identity
    expect(out[2]).toBe(items[2])
  })

  it('an unknown id is a no-op (same reference)', () => {
    const items = [sketch(), extrude()]
    expect(toggleSuppress(items, 'nope')).toBe(items)
  })
})

describe('deleteFeature (by id)', () => {
  it('removes the targeted feature, returning a NEW shorter array', () => {
    const items = [sketch(), extrude(), fillet()]
    const out = deleteFeature(items, 'ex1')
    expect(ids(out)).toEqual(['sk1', 'fl1'])
    expect(out).not.toBe(items)
    expect(ids(items)).toEqual(['sk1', 'ex1', 'fl1']) // input untouched
  })

  it('can delete the first and the last feature', () => {
    const items = [sketch(), extrude(), fillet()]
    expect(ids(deleteFeature(items, 'sk1'))).toEqual(['ex1', 'fl1'])
    expect(ids(deleteFeature(items, 'fl1'))).toEqual(['sk1', 'ex1'])
  })

  it('deleting the only feature yields an empty array', () => {
    expect(deleteFeature([sketch()], 'sk1')).toEqual([])
  })

  it('an unknown id is a no-op (same reference)', () => {
    const items = [sketch(), extrude()]
    expect(deleteFeature(items, 'nope')).toBe(items)
  })
})
