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
import { resolveHudTargetPoint } from '../Sketch2DCanvas'

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
