import { describe, expect, it } from 'vitest'
import type { KernelPostSolidOp } from '../../shared/part-features-schema'
import { resolveTimeline, validateTimelineOrder } from './feature-timeline-resolve'

// ── Fixtures: minimal-but-valid op variants ────────────────────────────────
// Field shapes match the Zod variants in part-features-schema.ts. We never
// parse here (resolveTimeline is pure data-in/data-out), but keeping the shapes
// schema-faithful means the fixtures double as a compile-time check that the
// op type is honored.

const filletAll = (radiusMm = 0.5): KernelPostSolidOp => ({ kind: 'fillet_all', radiusMm })
const chamferAll = (lengthMm = 0.2): KernelPostSolidOp => ({ kind: 'chamfer_all', lengthMm })
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

describe('resolveTimeline / identity + edge cases', () => {
  it('returns [] for empty ops regardless of edit', () => {
    expect(resolveTimeline([])).toEqual([])
    expect(resolveTimeline([], { rollbackTo: 0, order: [], suppressedIndices: [0] })).toEqual([])
  })

  it('is the identity transform for an empty edit (but strips own suppressed key)', () => {
    const ops = [unionBox(), filletAll(0.5)]
    const out = resolveTimeline(ops)
    expect(out).toEqual(ops)
    // No suppressed key present anywhere -> structural equality, same order.
    expect(out.map((o) => o.kind)).toEqual(['boolean_union_box', 'fillet_all'])
  })

  it('does not mutate the input ops array or the ops themselves', () => {
    const ops: KernelPostSolidOp[] = [unionBox(), { ...filletAll(0.5), suppressed: true }, chamferAll(0.2)]
    const snapshot = JSON.parse(JSON.stringify(ops))
    resolveTimeline(ops, { order: [2, 1, 0], rollbackTo: 1, suppressedIndices: [0] })
    expect(ops).toEqual(snapshot)
  })

  it('strips a present suppressed:false key so the result is replay-ready', () => {
    const ops: KernelPostSolidOp[] = [{ ...unionBox(), suppressed: false }]
    const out = resolveTimeline(ops)
    expect(out).toEqual([unionBox()])
    expect('suppressed' in out[0]!).toBe(false)
  })
})

describe('resolveTimeline / reorder', () => {
  it('applies an explicit valid permutation', () => {
    const ops = [unionBox(), patternRect(), chamferAll(0.2)]
    const out = resolveTimeline(ops, { order: [2, 0, 1] })
    expect(out.map((o) => o.kind)).toEqual(['chamfer_all', 'boolean_union_box', 'pattern_rectangular'])
  })

  it('keeps positional order when order length is wrong', () => {
    const ops = [unionBox(), chamferAll(0.2)]
    const out = resolveTimeline(ops, { order: [0] }) // too short -> ignored
    expect(out.map((o) => o.kind)).toEqual(['boolean_union_box', 'chamfer_all'])
  })

  it('keeps positional order when order has a duplicate index', () => {
    const ops = [unionBox(), chamferAll(0.2), filletAll(0.5)]
    const out = resolveTimeline(ops, { order: [0, 0, 2] }) // dup 0, missing 1 -> ignored
    expect(out.map((o) => o.kind)).toEqual(['boolean_union_box', 'chamfer_all', 'fillet_all'])
  })

  it('keeps positional order when order has an out-of-range index', () => {
    const ops = [unionBox(), chamferAll(0.2)]
    const out = resolveTimeline(ops, { order: [0, 5] }) // 5 out of range -> ignored
    expect(out.map((o) => o.kind)).toEqual(['boolean_union_box', 'chamfer_all'])
  })

  it('never drops or duplicates an op even for a garbage order', () => {
    const ops = [unionBox(), chamferAll(0.2), filletAll(0.5)]
    const out = resolveTimeline(ops, { order: [9, 9, 9] })
    expect(out).toHaveLength(3)
    expect(out.map((o) => o.kind)).toEqual(['boolean_union_box', 'chamfer_all', 'fillet_all'])
  })
})

describe('resolveTimeline / suppress', () => {
  it('drops ops flagged by their own suppressed:true and strips the key', () => {
    const ops: KernelPostSolidOp[] = [{ ...filletAll(0.5), suppressed: true }, chamferAll(0.2)]
    const out = resolveTimeline(ops)
    expect(out).toEqual([chamferAll(0.2)])
  })

  it('drops ops named in edit.suppressedIndices (original positions)', () => {
    const ops = [unionBox(), chamferAll(0.2), filletAll(0.5)]
    const out = resolveTimeline(ops, { suppressedIndices: [1] })
    expect(out.map((o) => o.kind)).toEqual(['boolean_union_box', 'fillet_all'])
  })

  it('suppressedIndices address ORIGINAL positions, applied after reorder', () => {
    const ops = [unionBox(), chamferAll(0.2), filletAll(0.5)]
    // Reverse order, then suppress original index 0 (the union box).
    const out = resolveTimeline(ops, { order: [2, 1, 0], suppressedIndices: [0] })
    expect(out.map((o) => o.kind)).toEqual(['fillet_all', 'chamfer_all'])
  })

  it('union of own-flag and edit suppression; ignores out-of-range indices', () => {
    const ops: KernelPostSolidOp[] = [{ ...unionBox(), suppressed: true }, chamferAll(0.2), filletAll(0.5)]
    const out = resolveTimeline(ops, { suppressedIndices: [1, 99] })
    expect(out.map((o) => o.kind)).toEqual(['fillet_all'])
  })

  it('returns [] when every op is suppressed', () => {
    const ops: KernelPostSolidOp[] = [
      { ...unionBox(), suppressed: true },
      { ...chamferAll(0.2), suppressed: true }
    ]
    expect(resolveTimeline(ops)).toEqual([])
  })

  it('suppressing a depended-on op excludes it WITHOUT repairing dependents (documented behavior)', () => {
    // fillet_select implicitly relies on the union box's edges. Suppressing the
    // union box leaves the fillet in place; the resolver must NOT auto-drop the
    // dependent nor reorder — the rebuild surfaces any geometry error.
    const ops: KernelPostSolidOp[] = [
      unionBox(),
      { kind: 'fillet_select', radiusMm: 0.5, edgeDirection: '+Z' }
    ]
    const out = resolveTimeline(ops, { suppressedIndices: [0] })
    expect(out.map((o) => o.kind)).toEqual(['fillet_select'])
  })
})

describe('resolveTimeline / rollback', () => {
  it('keeps positions [0..rollbackTo] inclusive in resolved order', () => {
    const ops = [unionBox(), patternRect(), chamferAll(0.2), filletAll(0.5)]
    const out = resolveTimeline(ops, { rollbackTo: 1 })
    expect(out.map((o) => o.kind)).toEqual(['boolean_union_box', 'pattern_rectangular'])
  })

  it('rollbackTo applies to the RESOLVED (post-reorder) order, not original', () => {
    const ops = [unionBox(), patternRect(), chamferAll(0.2)]
    // Reverse, then keep through resolved position 1 -> chamfer + pattern.
    const out = resolveTimeline(ops, { order: [2, 1, 0], rollbackTo: 1 })
    expect(out.map((o) => o.kind)).toEqual(['chamfer_all', 'pattern_rectangular'])
  })

  it('rollbackTo = 0 keeps only the first resolved op', () => {
    const ops = [unionBox(), chamferAll(0.2), filletAll(0.5)]
    const out = resolveTimeline(ops, { rollbackTo: 0 })
    expect(out.map((o) => o.kind)).toEqual(['boolean_union_box'])
  })

  it('rollbackTo = -1 keeps the whole timeline', () => {
    const ops = [unionBox(), chamferAll(0.2)]
    const out = resolveTimeline(ops, { rollbackTo: -1 })
    expect(out.map((o) => o.kind)).toEqual(['boolean_union_box', 'chamfer_all'])
  })

  it('a stale marker beyond the end is treated as no rollback (keeps all)', () => {
    const ops = [unionBox(), chamferAll(0.2)]
    const out = resolveTimeline(ops, { rollbackTo: 7 })
    expect(out.map((o) => o.kind)).toEqual(['boolean_union_box', 'chamfer_all'])
  })

  it('a negative marker other than -1 is treated as no rollback (keeps all)', () => {
    const ops = [unionBox(), chamferAll(0.2)]
    const out = resolveTimeline(ops, { rollbackTo: -3 })
    expect(out.map((o) => o.kind)).toEqual(['boolean_union_box', 'chamfer_all'])
  })

  it('a non-integer marker is treated as no rollback (keeps all)', () => {
    const ops = [unionBox(), chamferAll(0.2)]
    const out = resolveTimeline(ops, { rollbackTo: 0.5 })
    expect(out.map((o) => o.kind)).toEqual(['boolean_union_box', 'chamfer_all'])
  })

  it('ops after the marker are excluded from replay but the input is untouched (non-destructive)', () => {
    const ops = [unionBox(), chamferAll(0.2), filletAll(0.5)]
    const before = ops.length
    const out = resolveTimeline(ops, { rollbackTo: 0 })
    expect(out).toHaveLength(1)
    expect(ops).toHaveLength(before) // nothing deleted from the source timeline
  })
})

describe('resolveTimeline / combined pipeline', () => {
  it('applies reorder -> rollback -> suppress together', () => {
    // Original: [union(0), pattern(1), chamfer(2, suppressed), fillet(3)]
    const ops: KernelPostSolidOp[] = [
      unionBox(),
      patternRect(),
      { ...chamferAll(0.2), suppressed: true },
      filletAll(0.5)
    ]
    // Reorder to [fillet(3), union(0), chamfer(2), pattern(1)], roll back through
    // resolved pos 2 -> [fillet, union, chamfer], then suppress drops the
    // own-flagged chamfer AND original index 0 (union) via the edit.
    const out = resolveTimeline(ops, {
      order: [3, 0, 2, 1],
      rollbackTo: 2,
      suppressedIndices: [0]
    })
    expect(out.map((o) => o.kind)).toEqual(['fillet_all'])
  })
})

describe('validateTimelineOrder', () => {
  it('accepts an order that keeps finishing ops last', () => {
    const ops = [unionBox(), patternRect(), filletAll(0.5)]
    expect(validateTimelineOrder(ops, [1, 0, 2])).toEqual({ ok: true })
  })

  it('rejects moving a finishing op before a create/boolean op', () => {
    const ops = [unionBox(), filletAll(0.5)]
    const r = validateTimelineOrder(ops, [1, 0]) // fillet first -> invalid
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/finishing/i)
  })

  it('rejects a non-permutation order', () => {
    const ops = [unionBox(), filletAll(0.5)]
    expect(validateTimelineOrder(ops, [0, 0]).ok).toBe(false)
    expect(validateTimelineOrder(ops, [0]).ok).toBe(false)
    expect(validateTimelineOrder(ops, [0, 1, 2]).ok).toBe(false)
  })

  it('accepts multiple finishing ops trailing a single create op', () => {
    const ops = [unionBox(), filletAll(0.5), chamferAll(0.2)]
    expect(validateTimelineOrder(ops, [0, 2, 1])).toEqual({ ok: true })
  })

  it('accepts the identity order of an all-finishing timeline', () => {
    // No create/boolean op at all -> nothing for a finishing op to precede.
    const ops = [filletAll(0.5), chamferAll(0.2)]
    expect(validateTimelineOrder(ops, [0, 1])).toEqual({ ok: true })
    expect(validateTimelineOrder(ops, [1, 0])).toEqual({ ok: true })
  })

  it('rejects a finishing op wedged between two create ops', () => {
    const ops = [unionBox(), filletAll(0.5), patternRect()]
    // Resolved order union, fillet, pattern -> fillet precedes the pattern create.
    expect(validateTimelineOrder(ops, [0, 1, 2]).ok).toBe(false)
  })
})
