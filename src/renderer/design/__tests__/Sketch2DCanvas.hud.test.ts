/**
 * Heads-up numeric entry — pure resolver pin.
 *
 * The sketch canvas's always-on cursor read-out becomes editable for the polyline
 * tool: the operator types exact X/Y and Enter places the next vertex. The
 * placement target is computed by the pure {@link resolveHudTargetPoint} (a typed
 * field wins; a blank/invalid field falls back to the live snap-resolved cursor),
 * unit-tested here in node-env since the click/keydown path needs a DOM.
 */

import { describe, expect, it } from 'vitest'
import { resolveHudTargetPoint, resolvePolarEntryPoint } from '../Sketch2DCanvas'

describe('resolveHudTargetPoint — HUD numeric entry', () => {
  it('uses the typed X and Y when both parse to finite numbers', () => {
    expect(resolveHudTargetPoint('12.5', '-3', [0, 0])).toEqual([12.5, -3])
  })

  it('falls back to the live cursor coordinate for a blank or non-numeric field', () => {
    expect(resolveHudTargetPoint('', '5', [7, 8])).toEqual([7, 5])
    expect(resolveHudTargetPoint('abc', '', [1, 2])).toEqual([1, 2])
  })

  it('treats a typed 0 as a real value, not a fallback', () => {
    expect(resolveHudTargetPoint('0', '0', [9, 9])).toEqual([0, 0])
  })
})

describe('resolvePolarEntryPoint — HUD polar (length / angle) entry', () => {
  it('places anchor + (len ∠ angDeg) for a typed length and angle', () => {
    expect(resolvePolarEntryPoint('10', '0', [0, 0], [99, 99])).toEqual([10, 0])
    const p = resolvePolarEntryPoint('10', '45', [0, 0], [99, 99])
    expect(p[0]).toBeCloseTo(Math.SQRT1_2 * 10, 9)
    expect(p[1]).toBeCloseTo(Math.SQRT1_2 * 10, 9)
  })

  it('falls back PER FIELD to the live segment (type only Length, keep the live angle)', () => {
    // Live segment is the 3-4-5 triangle (length 5 at ~53.13°). Typing only Length keeps that angle.
    const onlyLen = resolvePolarEntryPoint('10', '', [0, 0], [3, 4])
    expect(onlyLen[0]).toBeCloseTo(6, 9) // 10 * 3/5
    expect(onlyLen[1]).toBeCloseTo(8, 9) // 10 * 4/5
    // ...and typing only Angle keeps the live length (5).
    const onlyAng = resolvePolarEntryPoint('', '90', [0, 0], [3, 4])
    expect(onlyAng[0]).toBeCloseTo(0, 9)
    expect(onlyAng[1]).toBeCloseTo(5, 9)
  })

  it('both fields blank → the live cursor point unchanged', () => {
    const p = resolvePolarEntryPoint('', '', [1, 1], [4, 5])
    expect(p[0]).toBeCloseTo(4, 9)
    expect(p[1]).toBeCloseTo(5, 9)
  })

  it('treats a typed 0 length as the anchor itself, not a fallback', () => {
    expect(resolvePolarEntryPoint('0', '45', [2, 2], [99, 99])).toEqual([2, 2])
  })

  it('honours a non-zero anchor offset', () => {
    expect(resolvePolarEntryPoint('5', '0', [10, 20], [0, 0])).toEqual([15, 20])
  })
})
