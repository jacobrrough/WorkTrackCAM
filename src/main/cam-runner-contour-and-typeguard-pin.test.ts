/**
 * Paired-pin contract for three exported helpers in `src/main/cam-runner.ts`
 * that, prior to Cycle 106, had ZERO direct test coverage:
 *
 *   1. `isOclToolpathFile`      — runtime type guard for the JSON payload
 *                                  written by `engines/cam/ocl_toolpath.py`.
 *                                  Replaces unsafe `JSON.parse(raw) as
 *                                  OclToolpathFile` casts.
 *   2. `resolveContourRampOptions` — parses contour ramp-entry parameters
 *                                  (rampType + rampAngleDeg) from raw
 *                                  `operationParams` with clamping and
 *                                  finite-number defense.
 *   3. `resolveContourTabParams` — parses contour holding-tab parameters
 *                                  with floors and rounding (tabCount must
 *                                  be a positive integer; widths/heights
 *                                  have minimum positive floors).
 *
 * Every helper here is a *pure* parameter-resolution / type-narrowing helper
 * — exactly the kind of contract that callers (the contour 2D pipeline, the
 *   OCL fallback parser, etc.) silently depend on. Without a paired-pin, a
 *   future "small clean-up" refactor could quietly weaken a clamp or change
 *   a default and only show up as a downstream G-code regression in CI.
 *
 * Cycle 106 [ID-0188] — cam-engine rotation.
 */
import { describe, expect, it } from 'vitest'
import {
  isOclToolpathFile,
  resolveContourRampOptions,
  resolveContourTabParams
} from './cam-runner'

// ---------------------------------------------------------------------------
// 1. isOclToolpathFile — runtime type guard
// ---------------------------------------------------------------------------

describe('isOclToolpathFile (cam-runner.ts)', () => {
  it('rejects non-object primitives', () => {
    expect(isOclToolpathFile(null)).toBe(false)
    expect(isOclToolpathFile(undefined)).toBe(false)
    expect(isOclToolpathFile(0)).toBe(false)
    expect(isOclToolpathFile('')).toBe(false)
    expect(isOclToolpathFile('{"ok":true}')).toBe(false)
    expect(isOclToolpathFile(true)).toBe(false)
    expect(isOclToolpathFile(false)).toBe(false)
  })

  it('rejects arrays (object-but-not-record)', () => {
    expect(isOclToolpathFile([])).toBe(false)
    expect(isOclToolpathFile([{ ok: true }])).toBe(false)
  })

  it('accepts the empty object (all fields are optional)', () => {
    expect(isOclToolpathFile({})).toBe(true)
  })

  it('accepts a well-formed full payload', () => {
    const v = {
      ok: true,
      toolpathLines: ['G0 X0 Y0', 'G1 Z-1 F300'],
      strategy: 'waterline'
    }
    expect(isOclToolpathFile(v)).toBe(true)
  })

  it('accepts a partially-populated payload (any subset of fields present)', () => {
    expect(isOclToolpathFile({ ok: false })).toBe(true)
    expect(isOclToolpathFile({ toolpathLines: [] })).toBe(true)
    expect(isOclToolpathFile({ strategy: 'adaptive_waterline' })).toBe(true)
    expect(isOclToolpathFile({ ok: true, toolpathLines: [] })).toBe(true)
  })

  it('rejects malformed ok (must be boolean when present)', () => {
    expect(isOclToolpathFile({ ok: 1 })).toBe(false)
    expect(isOclToolpathFile({ ok: 'true' })).toBe(false)
    expect(isOclToolpathFile({ ok: null })).toBe(false)
  })

  it('rejects malformed toolpathLines (must be array when present)', () => {
    expect(isOclToolpathFile({ toolpathLines: 'G0 X0 Y0' })).toBe(false)
    expect(isOclToolpathFile({ toolpathLines: { 0: 'G0' } })).toBe(false)
    expect(isOclToolpathFile({ toolpathLines: null })).toBe(false)
  })

  it('rejects malformed strategy (must be string when present)', () => {
    expect(isOclToolpathFile({ strategy: 42 })).toBe(false)
    expect(isOclToolpathFile({ strategy: ['waterline'] })).toBe(false)
    expect(isOclToolpathFile({ strategy: null })).toBe(false)
  })

  it('tolerates extra unknown keys (forward-compat)', () => {
    expect(isOclToolpathFile({ ok: true, fallback: 'bounds_only' })).toBe(true)
    expect(isOclToolpathFile({ futureField: 'whatever' })).toBe(true)
  })

  it('does not throw on prototype-less objects (Object.create(null))', () => {
    // The guard uses property-presence checks; a null-prototype record must
    // still be treated as a plain object payload, not as a hostile input.
    expect(() => isOclToolpathFile(Object.create(null))).not.toThrow()
    expect(isOclToolpathFile(Object.create(null))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 2. resolveContourRampOptions
// ---------------------------------------------------------------------------

describe('resolveContourRampOptions (cam-runner.ts)', () => {
  it('returns the documented defaults when called with no arg', () => {
    expect(resolveContourRampOptions()).toEqual({
      rampType: 'plunge',
      rampAngleDeg: 3
    })
  })

  it('returns the documented defaults when called with empty params', () => {
    expect(resolveContourRampOptions({})).toEqual({
      rampType: 'plunge',
      rampAngleDeg: 3
    })
  })

  it('passes through valid rampType values: linear, helix', () => {
    expect(resolveContourRampOptions({ rampType: 'linear' }).rampType).toBe('linear')
    expect(resolveContourRampOptions({ rampType: 'helix' }).rampType).toBe('helix')
  })

  it('coerces unknown rampType strings to plunge (no narrowing surprises)', () => {
    expect(resolveContourRampOptions({ rampType: 'arc' }).rampType).toBe('plunge')
    expect(resolveContourRampOptions({ rampType: 'whatever' }).rampType).toBe('plunge')
    expect(resolveContourRampOptions({ rampType: 42 }).rampType).toBe('plunge')
    expect(resolveContourRampOptions({ rampType: null }).rampType).toBe('plunge')
  })

  it('passes through a sensible mid-range angle unchanged', () => {
    expect(resolveContourRampOptions({ rampAngleDeg: 7.5 }).rampAngleDeg).toBe(7.5)
    expect(resolveContourRampOptions({ rampAngleDeg: 30 }).rampAngleDeg).toBe(30)
  })

  it('clamps rampAngleDeg below the floor (0.5°) to prevent infinite-ramp G-code', () => {
    // Below 0.5 the helical ramp gets impractically long; the helper floors it.
    expect(resolveContourRampOptions({ rampAngleDeg: 0 }).rampAngleDeg).toBe(0.5)
    expect(resolveContourRampOptions({ rampAngleDeg: 0.1 }).rampAngleDeg).toBe(0.5)
    expect(resolveContourRampOptions({ rampAngleDeg: -10 }).rampAngleDeg).toBe(0.5)
  })

  it('clamps rampAngleDeg above the ceiling (89°) to avoid degenerate near-vertical ramp', () => {
    expect(resolveContourRampOptions({ rampAngleDeg: 90 }).rampAngleDeg).toBe(89)
    expect(resolveContourRampOptions({ rampAngleDeg: 180 }).rampAngleDeg).toBe(89)
    expect(resolveContourRampOptions({ rampAngleDeg: 1e9 }).rampAngleDeg).toBe(89)
  })

  it('rejects non-finite rampAngleDeg values (default to 3°)', () => {
    expect(resolveContourRampOptions({ rampAngleDeg: NaN }).rampAngleDeg).toBe(3)
    expect(resolveContourRampOptions({ rampAngleDeg: Infinity }).rampAngleDeg).toBe(3)
    expect(resolveContourRampOptions({ rampAngleDeg: -Infinity }).rampAngleDeg).toBe(3)
    expect(resolveContourRampOptions({ rampAngleDeg: '7' }).rampAngleDeg).toBe(3)
    expect(resolveContourRampOptions({ rampAngleDeg: null }).rampAngleDeg).toBe(3)
  })

  it('combines rampType and rampAngleDeg independently', () => {
    expect(resolveContourRampOptions({ rampType: 'helix', rampAngleDeg: 12 })).toEqual({
      rampType: 'helix',
      rampAngleDeg: 12
    })
    // Garbage rampType + clamped angle still produces a usable shape
    expect(resolveContourRampOptions({ rampType: 999, rampAngleDeg: 9999 })).toEqual({
      rampType: 'plunge',
      rampAngleDeg: 89
    })
  })
})

// ---------------------------------------------------------------------------
// 3. resolveContourTabParams
// ---------------------------------------------------------------------------

describe('resolveContourTabParams (cam-runner.ts)', () => {
  it('returns undefined when tabsMode is absent (no tabs configured)', () => {
    expect(resolveContourTabParams()).toBeUndefined()
    expect(resolveContourTabParams({})).toBeUndefined()
    expect(resolveContourTabParams({ tabsMode: undefined })).toBeUndefined()
  })

  it('returns undefined when tabsMode is not one of the two supported modes', () => {
    expect(resolveContourTabParams({ tabsMode: 'auto' })).toBeUndefined()
    expect(resolveContourTabParams({ tabsMode: 0 })).toBeUndefined()
    expect(resolveContourTabParams({ tabsMode: null })).toBeUndefined()
  })

  it('returns documented defaults for tabsMode = "count"', () => {
    expect(resolveContourTabParams({ tabsMode: 'count' })).toEqual({
      tabsMode: 'count',
      tabCount: 4,
      tabIntervalMm: 50,
      tabWidthMm: 3,
      tabHeightMm: 1.5
    })
  })

  it('returns documented defaults for tabsMode = "interval"', () => {
    expect(resolveContourTabParams({ tabsMode: 'interval' })).toEqual({
      tabsMode: 'interval',
      tabCount: 4,
      tabIntervalMm: 50,
      tabWidthMm: 3,
      tabHeightMm: 1.5
    })
  })

  it('rounds tabCount and floors at 1 (no zero/negative tab counts)', () => {
    expect(resolveContourTabParams({ tabsMode: 'count', tabCount: 0 })?.tabCount).toBe(1)
    expect(resolveContourTabParams({ tabsMode: 'count', tabCount: -7 })?.tabCount).toBe(1)
    expect(resolveContourTabParams({ tabsMode: 'count', tabCount: 1.4 })?.tabCount).toBe(1)
    expect(resolveContourTabParams({ tabsMode: 'count', tabCount: 5.7 })?.tabCount).toBe(6)
    expect(resolveContourTabParams({ tabsMode: 'count', tabCount: 12 })?.tabCount).toBe(12)
  })

  it('floors tabIntervalMm at 1 mm (prevents zero-spacing infinite tab loop)', () => {
    expect(resolveContourTabParams({ tabsMode: 'interval', tabIntervalMm: 0 })?.tabIntervalMm).toBe(1)
    expect(resolveContourTabParams({ tabsMode: 'interval', tabIntervalMm: 0.5 })?.tabIntervalMm).toBe(1)
    expect(resolveContourTabParams({ tabsMode: 'interval', tabIntervalMm: -10 })?.tabIntervalMm).toBe(1)
    expect(resolveContourTabParams({ tabsMode: 'interval', tabIntervalMm: 25 })?.tabIntervalMm).toBe(25)
  })

  it('floors tabWidthMm at 0.5 mm (Carvera/Laguna minimum holding tab width)', () => {
    expect(resolveContourTabParams({ tabsMode: 'count', tabWidthMm: 0 })?.tabWidthMm).toBe(0.5)
    expect(resolveContourTabParams({ tabsMode: 'count', tabWidthMm: 0.1 })?.tabWidthMm).toBe(0.5)
    expect(resolveContourTabParams({ tabsMode: 'count', tabWidthMm: -2 })?.tabWidthMm).toBe(0.5)
    expect(resolveContourTabParams({ tabsMode: 'count', tabWidthMm: 4 })?.tabWidthMm).toBe(4)
  })

  it('floors tabHeightMm at 0.1 mm (prevents zero-height tabs that disappear on round-off)', () => {
    expect(resolveContourTabParams({ tabsMode: 'count', tabHeightMm: 0 })?.tabHeightMm).toBe(0.1)
    expect(resolveContourTabParams({ tabsMode: 'count', tabHeightMm: -1 })?.tabHeightMm).toBe(0.1)
    expect(resolveContourTabParams({ tabsMode: 'count', tabHeightMm: 0.05 })?.tabHeightMm).toBe(0.1)
    expect(resolveContourTabParams({ tabsMode: 'count', tabHeightMm: 2.25 })?.tabHeightMm).toBe(2.25)
  })

  it('rejects non-finite numerics and falls back to documented defaults', () => {
    const r = resolveContourTabParams({
      tabsMode: 'count',
      tabCount: NaN,
      tabIntervalMm: Infinity,
      tabWidthMm: -Infinity,
      tabHeightMm: '1.5'
    })
    expect(r).toEqual({
      tabsMode: 'count',
      tabCount: 4,
      tabIntervalMm: 50,
      tabWidthMm: 3,
      tabHeightMm: 1.5
    })
  })

  it('preserves tabsMode in the returned object (no mode coercion)', () => {
    expect(resolveContourTabParams({ tabsMode: 'count' })?.tabsMode).toBe('count')
    expect(resolveContourTabParams({ tabsMode: 'interval' })?.tabsMode).toBe('interval')
  })

  it('combines all overrides into a single coherent payload', () => {
    const r = resolveContourTabParams({
      tabsMode: 'interval',
      tabCount: 8,
      tabIntervalMm: 80,
      tabWidthMm: 5,
      tabHeightMm: 2
    })
    expect(r).toEqual({
      tabsMode: 'interval',
      tabCount: 8,
      tabIntervalMm: 80,
      tabWidthMm: 5,
      tabHeightMm: 2
    })
  })
})

// ---------------------------------------------------------------------------
// JSDoc / arity paired-pin — guards against accidental signature changes
// during a "small clean-up" refactor.
// ---------------------------------------------------------------------------

describe('cam-runner contour/type-guard helpers — function arity pin', () => {
  it('isOclToolpathFile takes exactly 1 argument', () => {
    expect(isOclToolpathFile.length).toBe(1)
  })

  it('resolveContourRampOptions takes exactly 1 (optional) argument', () => {
    // `Function.length` counts parameters up to the first one with a
    // *default value* (not optional types). Both helpers declare the
    // parameter as `?: T` rather than `= {}`, so .length === 1. Pin the
    // actual value so a future change to two args / required signature is
    // caught.
    expect(resolveContourRampOptions.length).toBe(1)
  })

  it('resolveContourTabParams takes exactly 1 (optional) argument', () => {
    expect(resolveContourTabParams.length).toBe(1)
  })
})
