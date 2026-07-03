import { describe, expect, it } from 'vitest'
import type {
  KernelPostSolidOp,
  PartFeatureItem,
  PartFeaturesFile
} from '../../shared/part-features-schema'
import {
  applyTimelineAction,
  deleteFeature,
  effectiveOpsForState,
  invertAppendKernelOp,
  invertMoveKernelOp,
  invertRemoveKernelOpAt,
  invertReorderKernelOps,
  invertSetKernelOpSuppressedAt,
  invertSetKernelRollbackMarker,
  invertUpdateKernelOpAt,
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

describe('applyTimelineAction / update (feature re-edit, in place)', () => {
  it('replaces the op at the SAME index — no append, no reorder', () => {
    const state: TimelineState = { kernelOps: [unionBox(), filletAll(2)] }
    const r = applyTimelineAction(state, { type: 'update', index: 1, op: filletAll(7) })
    expect(r.changed).toBe(true)
    if (r.changed) {
      expect(r.state.kernelOps).toHaveLength(2)
      expect(r.state.kernelOps[1]).toEqual({ kind: 'fillet_all', radiusMm: 7 })
      expect(r.state.kernelOps[0]).toEqual(unionBox())
      expect(r.status).toMatch(/updated/i)
    }
  })

  it('rejects an update out of range (unchanged state, same reference)', () => {
    const state: TimelineState = { kernelOps: [unionBox()] }
    for (const index of [-1, 1, 99]) {
      const r = applyTimelineAction(state, { type: 'update', index, op: filletAll(1) })
      expect(r.changed).toBe(false)
      if (!r.changed) expect(r.reason).toMatch(/range/i)
      expect(r.state).toBe(state)
    }
  })

  it('preserves suppressed:true when the replacement omits the flag', () => {
    const state: TimelineState = {
      kernelOps: [unionBox(), { ...filletAll(2), suppressed: true }]
    }
    const r = applyTimelineAction(state, { type: 'update', index: 1, op: filletAll(9) })
    expect(r.changed).toBe(true)
    if (r.changed) {
      expect(r.state.kernelOps[1]).toEqual({
        kind: 'fillet_all',
        radiusMm: 9,
        suppressed: true
      })
    }
  })

  it('an explicit suppressed:false in the replacement wins (and DROPS the key)', () => {
    const state: TimelineState = { kernelOps: [{ ...filletAll(2), suppressed: true }] }
    const r = applyTimelineAction(state, {
      type: 'update',
      index: 0,
      op: { ...filletAll(2), suppressed: false }
    })
    expect(r.changed).toBe(true)
    if (r.changed) {
      expect('suppressed' in r.state.kernelOps[0]!).toBe(false)
      expect(r.state.kernelOps[0]).toEqual(filletAll(2))
    }
  })

  it('is a no-op when the merged op deep-equals the current one', () => {
    const state: TimelineState = {
      kernelOps: [unionBox(), { ...filletAll(2), suppressed: true }]
    }
    // Replacement omits `suppressed`, so the merge re-inherits it -> identical.
    const r = applyTimelineAction(state, { type: 'update', index: 1, op: filletAll(2) })
    expect(r.changed).toBe(false)
    if (!r.changed) expect(r.reason).toMatch(/unchanged/i)
    expect(r.state).toBe(state)
  })

  it('rejects a kind change that lands a finishing op before a create op', () => {
    const state: TimelineState = { kernelOps: [unionBox(), patternRect()] }
    const r = applyTimelineAction(state, { type: 'update', index: 0, op: filletAll(1) })
    expect(r.changed).toBe(false)
    if (!r.changed) expect(r.reason).toMatch(/finishing/i)
    expect(r.state).toBe(state)
  })

  it('keeps the roll-back marker where it is (list length unchanged)', () => {
    const state: TimelineState = {
      kernelOps: [unionBox(), patternRect(), filletAll(2)],
      rolledBackTo: 1
    }
    const r = applyTimelineAction(state, { type: 'update', index: 2, op: filletAll(4) })
    expect(r.changed).toBe(true)
    if (r.changed) expect(r.state.rolledBackTo).toBe(1)
  })

  it('does not mutate the input state or its ops array', () => {
    const state: TimelineState = { kernelOps: [unionBox(), filletAll(2)] }
    const snapshot = JSON.parse(JSON.stringify(state))
    applyTimelineAction(state, { type: 'update', index: 1, op: filletAll(6) })
    expect(JSON.parse(JSON.stringify(state))).toEqual(snapshot)
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

// ── FEATURE-TIMELINE UNDO/REDO — inverse-fold round-trips ────────────────────
//
// These prove each pure inverse fold restores the EXACT pre-mutation
// `PartFeaturesFile` produced by the session's forward gesture. The forward
// shapes here mirror `DesignSessionContext`'s editors (append/remove/move/
// reorder/update/suppress/rollback); applying the matching inverse to the
// forward result must reproduce the original base byte-for-byte (JSON-equal).

/** A features base with an ordered kernel timeline. */
const baseFile = (
  ops: KernelPostSolidOp[],
  rolledBackTo?: number
): PartFeaturesFile =>
  rolledBackTo === undefined
    ? ({ version: 1, kernelOps: ops } as unknown as PartFeaturesFile)
    : ({ version: 1, kernelOps: ops, rolledBackTo } as unknown as PartFeaturesFile)

const applyFold = (
  fold: ReturnType<typeof invertAppendKernelOp>,
  base: PartFeaturesFile
): PartFeaturesFile => {
  const r = fold(base)
  expect(r).not.toBeNull()
  // Range-checked folds return { next, status } on success.
  return (r as { next: PartFeaturesFile }).next
}

describe('invertAppendKernelOp — round-trip', () => {
  it('undo of an append removes the op that landed at the end', () => {
    const before = baseFile([unionBox()])
    // Forward: append a fillet (lands at index 1).
    const after = baseFile([unionBox(), filletAll(3)])
    // Inverse captured the PRE-append length (1) → remove index 1.
    const restored = applyFold(invertAppendKernelOp(before.kernelOps!.length), after)
    // Empty-key normalization: a 1-op list, not `undefined`.
    expect(restored.kernelOps).toEqual([unionBox()])
  })

  it('undo of the FIRST append drops the kernelOps key (empty list → undefined)', () => {
    const after = baseFile([filletAll(3)])
    const restored = applyFold(invertAppendKernelOp(0), after)
    expect(restored.kernelOps).toBeUndefined()
  })

  it('is a silent no-op (null) when the index is out of range', () => {
    const after = baseFile([unionBox()])
    expect(invertAppendKernelOp(5)(after)).toBeNull()
  })
})

describe('invertRemoveKernelOpAt — round-trip (index + suppressed intact)', () => {
  it('restores the removed op AT its original index', () => {
    const removed = { ...patternRect(), suppressed: true as const }
    const before = baseFile([unionBox(), removed, filletAll()])
    // Forward: remove index 1.
    const after = baseFile([unionBox(), filletAll()])
    const restored = applyFold(invertRemoveKernelOpAt(1, removed), after)
    expect(restored.kernelOps).toEqual(before.kernelOps)
    // Suppressed flag survived byte-for-byte.
    expect(restored.kernelOps![1]).toMatchObject({ kind: 'pattern_rectangular', suppressed: true })
  })

  it('re-inserting at the tail index is allowed (index === length)', () => {
    const removed = filletAll(2)
    const after = baseFile([unionBox()])
    const restored = applyFold(invertRemoveKernelOpAt(1, removed), after)
    expect(restored.kernelOps).toEqual([unionBox(), filletAll(2)])
  })
})

describe('invertMoveKernelOp — round-trip (swap is its own inverse)', () => {
  it('undo of a down-move swaps the pair back', () => {
    const before = baseFile([unionBox(), patternRect()])
    // Forward move(index 0, +1) → [pattern, union].
    const after = baseFile([patternRect(), unionBox()])
    const restored = applyFold(invertMoveKernelOp(0, 1), after)
    expect(restored.kernelOps).toEqual(before.kernelOps)
  })

  it('undo of an up-move restores order even when the forward rule would block it', () => {
    // A finishing op FIRST is legal in a loaded file. Moving a create op UP over
    // it is allowed forward, but the reverse swap would be rejected by the order
    // rule — the inverse skips that re-check and restores anyway.
    const before = baseFile([filletAll(), unionBox()])
    // Forward move(index 1, -1) → [union, fillet].
    const after = baseFile([unionBox(), filletAll()])
    const restored = applyFold(invertMoveKernelOp(1, -1), after)
    expect(restored.kernelOps).toEqual(before.kernelOps)
  })

  it('is null when the swap index is out of range', () => {
    const after = baseFile([unionBox()])
    expect(invertMoveKernelOp(0, 1)(after)).toBeNull()
  })
})

describe('invertReorderKernelOps — round-trip (order + marker restored)', () => {
  it('restores the pre-drag order and the pre-drag roll-back marker', () => {
    const before = baseFile([unionBox(), patternRect(), subtractBox()], 1)
    // Forward reorder(0 → 2): [pattern, subtract, union]. Marker survives (still
    // a non-last row), but the inverse restores it explicitly regardless.
    const fwd = applyTimelineAction(
      { kernelOps: before.kernelOps!, rolledBackTo: before.rolledBackTo },
      { type: 'reorder', from: 0, to: 2 }
    )
    expect(fwd.changed).toBe(true)
    const after = baseFile(
      (fwd.changed ? fwd.state.kernelOps : []) as KernelPostSolidOp[],
      fwd.changed ? fwd.state.rolledBackTo : undefined
    )
    const restored = applyFold(
      invertReorderKernelOps(before.kernelOps!, before.rolledBackTo),
      after
    )
    expect(restored.kernelOps).toEqual(before.kernelOps)
    expect(restored.rolledBackTo).toBe(1)
  })

  it('a previous marker of undefined restores to "build all" (key dropped)', () => {
    const before = baseFile([unionBox(), patternRect()])
    const after = baseFile([patternRect(), unionBox()], 0)
    const restored = applyFold(invertReorderKernelOps(before.kernelOps!, undefined), after)
    expect('rolledBackTo' in restored).toBe(false)
  })
})

describe('invertUpdateKernelOpAt — round-trip', () => {
  it('puts the captured previous op back at index', () => {
    const previous = filletAll(2)
    const before = baseFile([unionBox(), previous])
    // Forward update(index 1) → fillet radius 7.
    const after = baseFile([unionBox(), filletAll(7)])
    const restored = applyFold(invertUpdateKernelOpAt(1, previous), after)
    expect(restored.kernelOps).toEqual(before.kernelOps)
  })

  it('restores a previous op that carried suppressed:true', () => {
    const previous = { ...filletAll(2), suppressed: true as const }
    const after = baseFile([unionBox(), filletAll(7)])
    const restored = applyFold(invertUpdateKernelOpAt(1, previous), after)
    expect(restored.kernelOps![1]).toMatchObject({ radiusMm: 2, suppressed: true })
  })

  it('is null when the index is out of range', () => {
    const after = baseFile([unionBox()])
    expect(invertUpdateKernelOpAt(9, filletAll(1))(after)).toBeNull()
  })
})

describe('invertSetKernelOpSuppressedAt — round-trip', () => {
  it('undo of a suppress restores the op to active (key dropped)', () => {
    // Forward suppressed index 1 → true.
    const after = baseFile([unionBox(), { ...filletAll(), suppressed: true }])
    // Inverse captured previousSuppressed = false.
    const restored = applyFold(invertSetKernelOpSuppressedAt(1, false), after)
    expect('suppressed' in restored.kernelOps![1]!).toBe(false)
  })

  it('undo of an un-suppress restores suppressed:true', () => {
    // Forward un-suppressed index 1 (dropped the key).
    const after = baseFile([unionBox(), filletAll()])
    const restored = applyFold(invertSetKernelOpSuppressedAt(1, true), after)
    expect(restored.kernelOps![1]).toMatchObject({ suppressed: true })
  })
})

describe('invertSetKernelRollbackMarker — round-trip', () => {
  it('restores a captured previous marker index', () => {
    const after = baseFile([unionBox(), patternRect(), subtractBox()], 0)
    const restored = applyFold(invertSetKernelRollbackMarker(1), after) as PartFeaturesFile
    expect(restored.rolledBackTo).toBe(1)
  })

  it('a previous undefined marker restores "build all" (key dropped)', () => {
    const after = baseFile([unionBox(), patternRect()], 0)
    const restored = invertSetKernelRollbackMarker(undefined)(after) as { next: PartFeaturesFile }
    expect('rolledBackTo' in restored.next).toBe(false)
  })

  it('a previous marker of -1 also restores "build all"', () => {
    const after = baseFile([unionBox(), patternRect()], 0)
    const restored = invertSetKernelRollbackMarker(-1)(after) as { next: PartFeaturesFile }
    expect('rolledBackTo' in restored.next).toBe(false)
  })
})

describe('append → undo → redo full cycle (fold composition)', () => {
  it('append then undo restores the original; redo re-appends', () => {
    const original = baseFile([unionBox()])
    // Forward append.
    const afterAppend = baseFile([unionBox(), filletAll(3)])
    // Undo.
    const afterUndo = applyFold(invertAppendKernelOp(original.kernelOps!.length), afterAppend)
    expect(afterUndo.kernelOps).toEqual(original.kernelOps)
    // Redo = re-run the forward (append fillet again).
    const afterRedo = baseFile([...(afterUndo.kernelOps ?? []), filletAll(3)])
    expect(afterRedo.kernelOps).toEqual(afterAppend.kernelOps)
  })
})
