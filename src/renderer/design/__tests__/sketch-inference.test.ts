/**
 * Live constraint inference core (Phase A of the sketch rebuild) — pure unit pins.
 *
 * Node-env (no DOM), matching the sketcher's pure-core test convention. Proves the brain that
 * makes drawing feel like CAD: near-horizontal/vertical segments lock to the axis, the cursor snaps
 * coincident onto nearby points (priority over axis), and a free angle is left untouched.
 */

import { describe, expect, it } from 'vitest'
import { inferDrawConstraints } from '../sketch-inference'

describe('inferDrawConstraints — live sketch constraint inference', () => {
  it('locks a near-horizontal segment to exact horizontal and hints it', () => {
    const r = inferDrawConstraints([0, 0], [10, 0.2], [])
    expect(r.point).toEqual([10, 0])
    expect(r.hints).toEqual(['horizontal'])
    expect(r.coincidentIndex).toBe(-1)
  })

  it('locks a near-vertical segment to exact vertical', () => {
    const r = inferDrawConstraints([0, 0], [0.2, 10], [])
    expect(r.point).toEqual([0, 10])
    expect(r.hints).toEqual(['vertical'])
  })

  it('snaps coincident onto a nearby point, taking priority over the axis lock', () => {
    // Cursor is both near the snap point AND near-horizontal; coincident must win.
    const r = inferDrawConstraints([0, 0], [5.5, 0.3], [[5, 0]])
    expect(r.point).toEqual([5, 0])
    expect(r.hints).toEqual(['coincident'])
    expect(r.coincidentIndex).toBe(0)
  })

  it('picks the nearest snap point when several are in range', () => {
    const r = inferDrawConstraints([0, 0], [9.4, 9.6], [
      [0, 0],
      [10, 10],
    ])
    expect(r.point).toEqual([10, 10])
    expect(r.coincidentIndex).toBe(1)
  })

  it('leaves a free-angle segment untouched (no hints)', () => {
    const r = inferDrawConstraints([0, 0], [10, 7], [])
    expect(r.point).toEqual([10, 7])
    expect(r.hints).toEqual([])
  })

  it('still snaps coincident with no anchor (placing the first point)', () => {
    const r = inferDrawConstraints(null, [3.2, 4.1], [[3, 4]])
    expect(r.point).toEqual([3, 4])
    expect(r.hints).toEqual(['coincident'])
  })

  it('respects a custom axis tolerance', () => {
    // 8.5° off horizontal: outside the default 2° cone, inside a 10° cone.
    const offAxis: [number, number] = [10, 1.5]
    expect(inferDrawConstraints([0, 0], offAxis, []).hints).toEqual([])
    expect(inferDrawConstraints([0, 0], offAxis, [], { axisToleranceDeg: 10 }).hints).toEqual([
      'horizontal',
    ])
  })

  it('locks parallel to a reference edge direction and reports its index', () => {
    // Reference edge at 30°; cursor ~31° → parallel, projected onto the 30° line through the anchor.
    const r = inferDrawConstraints([0, 0], [10, 6.1], [], {}, [Math.PI / 6])
    expect(r.hints).toEqual(['parallel'])
    expect(r.referenceIndex).toBe(0)
    expect(r.point[1] / r.point[0]).toBeCloseTo(Math.tan(Math.PI / 6), 4)
  })

  it('locks perpendicular to a reference edge direction', () => {
    // Reference edge at 30°; cursor ~119° → perpendicular (the 120° line).
    const r = inferDrawConstraints([0, 0], [-5, 9], [], {}, [Math.PI / 6])
    expect(r.hints).toEqual(['perpendicular'])
    expect(r.referenceIndex).toBe(0)
  })

  it('prefers horizontal/vertical over a perpendicular that lands on the same angle', () => {
    // A near-vertical cursor against a horizontal reference could read vertical OR perpendicular;
    // the tie must resolve to the more fundamental "vertical".
    const r = inferDrawConstraints([0, 0], [0.2, 10], [], {}, [0])
    expect(r.hints).toEqual(['vertical'])
  })

  it('keeps the point-snap radius INDEPENDENT of the axis tolerance (separate knobs)', () => {
    // Snap point 5 mm from a free-angle cursor, so only the point radius decides the lock.
    const anchor: [number, number] = [0, 0]
    const cursor: [number, number] = [10, 10]
    const snap: ReadonlyArray<readonly [number, number]> = [[10, 5]]
    // Default 2 mm point radius → 5 mm is out of range...
    expect(inferDrawConstraints(anchor, cursor, snap).hints).toEqual([])
    // ...and widening the ANGLE tolerance must NOT widen the point radius.
    expect(inferDrawConstraints(anchor, cursor, snap, { axisToleranceDeg: 12 }).hints).toEqual([])
    // Only widening the POINT tolerance itself locks it.
    expect(inferDrawConstraints(anchor, cursor, snap, { coincidentToleranceMm: 9 }).hints).toEqual([
      'coincident',
    ])
  })
})
