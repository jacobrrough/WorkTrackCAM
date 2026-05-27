import { describe, expect, it } from 'vitest'
import {
  buildUploadUrlForK2Cfs,
  moonrakerPause,
  moonrakerResume,
  parseMoonrakerStatusBody,
  parseUploadedPath,
} from './moonraker-push'

// ─── parseMoonrakerStatusBody ──────────────────────────────────────────────────

describe('parseMoonrakerStatusBody', () => {
  function makeBody(stats: Record<string, unknown>): string {
    return JSON.stringify({ result: { status: { print_stats: stats } } })
  }

  it('returns rawState unknown for malformed JSON', () => {
    expect(parseMoonrakerStatusBody('not json')).toEqual({ rawState: 'unknown' })
  })

  it('returns rawState unknown for empty string', () => {
    expect(parseMoonrakerStatusBody('')).toEqual({ rawState: 'unknown' })
  })

  it('returns rawState unknown when print_stats is absent', () => {
    const body = JSON.stringify({ result: {} })
    expect(parseMoonrakerStatusBody(body).rawState).toBe('unknown')
  })

  it.each([
    'standby',
    'printing',
    'paused',
    'complete',
    'cancelled',
    'error'
  ])('preserves known state: %s', (state) => {
    const body = makeBody({ state })
    expect(parseMoonrakerStatusBody(body).rawState).toBe(state)
  })

  it('preserves unrecognized state string verbatim (normalization happens in caller)', () => {
    const body = makeBody({ state: 'firmware_restart' })
    expect(parseMoonrakerStatusBody(body).rawState).toBe('firmware_restart')
  })

  it('extracts filename when present', () => {
    const body = makeBody({ state: 'printing', filename: 'mypart.gcode' })
    expect(parseMoonrakerStatusBody(body).filename).toBe('mypart.gcode')
  })

  it('returns undefined filename for empty string filename', () => {
    const body = makeBody({ state: 'printing', filename: '' })
    expect(parseMoonrakerStatusBody(body).filename).toBeUndefined()
  })

  it('returns undefined filename when field absent', () => {
    const body = makeBody({ state: 'printing' })
    expect(parseMoonrakerStatusBody(body).filename).toBeUndefined()
  })

  it('extracts progress as number when present', () => {
    const body = makeBody({ state: 'printing', progress: 0.42 })
    expect(parseMoonrakerStatusBody(body).progress).toBeCloseTo(0.42)
  })

  it('returns undefined progress when field absent', () => {
    const body = makeBody({ state: 'printing' })
    expect(parseMoonrakerStatusBody(body).progress).toBeUndefined()
  })

  it('ignores progress field when not a number', () => {
    const body = makeBody({ state: 'printing', progress: '50%' })
    expect(parseMoonrakerStatusBody(body).progress).toBeUndefined()
  })

  // ── ETA calculation ─────────────────────────────────────────────────────────

  it('computes ETA from print_duration / progress (branch 1)', () => {
    // print_duration=300s, progress=0.5 → totalEstimate=600s, ETA=300s
    const body = makeBody({ state: 'printing', progress: 0.5, print_duration: 300 })
    expect(parseMoonrakerStatusBody(body).etaSeconds).toBe(300)
  })

  it('ETA is 0 when remaining time would be negative (Math.max guard)', () => {
    // progress=0.99 and print_duration only 10s → totalEstimate≈10.1s, remaining≈0.1s → 0
    const body = makeBody({ state: 'printing', progress: 0.99, print_duration: 9.9 })
    const { etaSeconds } = parseMoonrakerStatusBody(body)
    expect(etaSeconds).toBe(0)
  })

  it('returns undefined ETA when print_duration is absent (branch 2 requires it non-null)', () => {
    // Branch 2 condition: totalDuration != null && printDuration != null
    // When print_duration field is entirely missing, printDuration is undefined — neither branch fires.
    const body = makeBody({ state: 'printing', progress: 0.5, total_duration: 600 })
    expect(parseMoonrakerStatusBody(body).etaSeconds).toBeUndefined()
  })

  it('uses total_duration fallback branch when print_duration is zero (branch 2)', () => {
    // print_duration=0 fails branch-1 guard; total_duration=600 → branch 2 fires
    const body = makeBody({ state: 'printing', progress: 0.25, print_duration: 0, total_duration: 600 })
    // branch 2: 600 * (1 - 0.25) = 450
    expect(parseMoonrakerStatusBody(body).etaSeconds).toBe(450)
  })

  it('returns undefined ETA when progress is 0 (neither ETA branch fires)', () => {
    const body = makeBody({ state: 'printing', progress: 0, print_duration: 300, total_duration: 600 })
    expect(parseMoonrakerStatusBody(body).etaSeconds).toBeUndefined()
  })

  it('returns undefined ETA when progress is absent', () => {
    const body = makeBody({ state: 'printing', print_duration: 300 })
    expect(parseMoonrakerStatusBody(body).etaSeconds).toBeUndefined()
  })

  it('returns undefined ETA when both duration fields absent and progress > 0', () => {
    const body = makeBody({ state: 'printing', progress: 0.5 })
    expect(parseMoonrakerStatusBody(body).etaSeconds).toBeUndefined()
  })
})

// ─── parseUploadedPath ─────────────────────────────────────────────────────────

describe('parseUploadedPath', () => {
  it('prefers item.path when present', () => {
    const body = JSON.stringify({ item: { path: 'gcodes/mypart.gcode' }, path: 'other.gcode' })
    expect(parseUploadedPath(body, 'fallback.gcode')).toBe('gcodes/mypart.gcode')
  })

  it('falls back to top-level path when item.path absent', () => {
    const body = JSON.stringify({ path: 'toplevel/mypart.gcode' })
    expect(parseUploadedPath(body, 'fallback.gcode')).toBe('toplevel/mypart.gcode')
  })

  it('falls back to item without path property', () => {
    const body = JSON.stringify({ item: { name: 'mypart.gcode' }, path: 'toplevel/mypart.gcode' })
    expect(parseUploadedPath(body, 'fallback.gcode')).toBe('toplevel/mypart.gcode')
  })

  it('falls back to fallbackFilename when both paths absent', () => {
    const body = JSON.stringify({ result: 'ok' })
    expect(parseUploadedPath(body, 'fallback.gcode')).toBe('fallback.gcode')
  })

  it('falls back to fallbackFilename for malformed JSON', () => {
    expect(parseUploadedPath('not json', 'fallback.gcode')).toBe('fallback.gcode')
  })

  it('falls back to fallbackFilename for empty body', () => {
    expect(parseUploadedPath('', 'fallback.gcode')).toBe('fallback.gcode')
  })

  it('falls back to fallbackFilename when item.path is not a string', () => {
    const body = JSON.stringify({ item: { path: 42 }, path: 'correct.gcode' })
    // item.path is number, skips to top-level path
    expect(parseUploadedPath(body, 'fallback.gcode')).toBe('correct.gcode')
  })
})

// ─── moonrakerPause ─────────────────────────────────────────────────────────

describe('moonrakerPause', () => {
  it('is a function', () => {
    expect(typeof moonrakerPause).toBe('function')
  })

  it('returns error when printer URL is unreachable', async () => {
    // Use a non-routable IP to ensure connection failure without hitting a real printer.
    // [ID-0082] (Cycle 18 / perf) + [ID-0105] (Cycle 41 / perf): pin the wall-clock
    // bound so a future regression in `makeRequest`'s AbortController wiring is caught
    // here instead of re-inflating the whole src/main/ sweep past the 45-s sandbox
    // timeout. Cycle 18 set the bound at 500 ms timeout / 1500 ms budget (3x). Cycle
    // 41 dropped the timeout to 100 ms and tightened the budget to 600 ms (6x) -- the
    // 6x ceiling preserves the abort-fired-correctly assertion (a regression that
    // ignores `timeoutMs` blows past 600 ms easily on a non-routable IP) while
    // shaving ~400 ms per test. Per-perf-inventory: 1012 ms file pre-Cycle-41 was
    // dominated by 505+501 ms here.
    const t0 = Date.now()
    const result = await moonrakerPause('http://192.0.2.1:7125', 100)
    const elapsed = Date.now() - t0
    expect(result.ok).toBe(false)
    expect(result.error).toBeDefined()
    expect(elapsed).toBeLessThan(600)
  })
})

// ─── moonrakerResume ────────────────────────────────────────────────────────

describe('moonrakerResume', () => {
  it('is a function', () => {
    expect(typeof moonrakerResume).toBe('function')
  })

  it('returns error when printer URL is unreachable', async () => {
    // Use a non-routable IP to ensure connection failure without hitting a real printer.
    // [ID-0082] (Cycle 18 / perf) + [ID-0105] (Cycle 41 / perf): wall-clock bound
    // assertion -- see the matching comment on the moonrakerPause test above. Cycle
    // 41 dropped the timeout 500 -> 100 ms and the budget 1500 -> 600 ms (6x ceiling)
    // for the same reasons.
    const t0 = Date.now()
    const result = await moonrakerResume('http://192.0.2.1:7125', 100)
    const elapsed = Date.now() - t0
    expect(result.ok).toBe(false)
    expect(result.error).toBeDefined()
    expect(elapsed).toBeLessThan(600)
  })
})

// ─── buildUploadUrlForK2Cfs ─────────────────────────────────────────────────
//
// Pure URL-shape contract. Lock down the exact form so a renderer test
// can verify the wire shape without booting the mock-Moonraker harness.
// Safety Rule 1: the slot id ONLY travels on the URL -- never on the
// G-code bytes. Stock Moonraker ignores unknown query params on
// `/server/files/upload`, so this is forward-compatible.

describe('buildUploadUrlForK2Cfs', () => {
  it('returns the base URL when cfsSlotId is undefined', () => {
    expect(buildUploadUrlForK2Cfs('http://k2plus.local')).toBe(
      'http://k2plus.local/server/files/upload',
    )
  })

  it('appends ?cfs_slot=0 when slot 0 is picked', () => {
    expect(buildUploadUrlForK2Cfs('http://k2plus.local', 0)).toBe(
      'http://k2plus.local/server/files/upload?cfs_slot=0',
    )
  })

  it('appends ?cfs_slot=3 (max valid slot in a 4-spool CFS)', () => {
    expect(buildUploadUrlForK2Cfs('http://k2plus.local', 3)).toBe(
      'http://k2plus.local/server/files/upload?cfs_slot=3',
    )
  })

  it('strips a trailing slash from the printer URL before composing', () => {
    expect(buildUploadUrlForK2Cfs('http://k2plus.local/', 1)).toBe(
      'http://k2plus.local/server/files/upload?cfs_slot=1',
    )
  })

  it('preserves an explicit port', () => {
    expect(buildUploadUrlForK2Cfs('http://192.168.1.50:7125', 2)).toBe(
      'http://192.168.1.50:7125/server/files/upload?cfs_slot=2',
    )
  })

  it('omits the query param when slot is out of range (above)', () => {
    expect(buildUploadUrlForK2Cfs('http://k2plus.local', 4)).toBe(
      'http://k2plus.local/server/files/upload',
    )
  })

  it('omits the query param when slot is negative', () => {
    expect(buildUploadUrlForK2Cfs('http://k2plus.local', -1)).toBe(
      'http://k2plus.local/server/files/upload',
    )
  })

  it('omits the query param when slot is non-integer', () => {
    expect(buildUploadUrlForK2Cfs('http://k2plus.local', 1.5)).toBe(
      'http://k2plus.local/server/files/upload',
    )
  })

  it('omits the query param when slot is NaN', () => {
    expect(buildUploadUrlForK2Cfs('http://k2plus.local', Number.NaN)).toBe(
      'http://k2plus.local/server/files/upload',
    )
  })

  it('omits the query param when slot is Infinity', () => {
    expect(
      buildUploadUrlForK2Cfs('http://k2plus.local', Number.POSITIVE_INFINITY),
    ).toBe('http://k2plus.local/server/files/upload')
  })

  it('Safety Rule 2: pre-CFS URL shape is byte-identical when slot is absent', () => {
    // Pre-CFS shape pin -- guarantees existing call sites that never
    // pass a slot id see zero behavior change.
    expect(buildUploadUrlForK2Cfs('http://192.168.1.50')).toBe(
      'http://192.168.1.50/server/files/upload',
    )
  })

  it('every valid slot 0..3 produces a distinct URL', () => {
    const seen = new Set<string>()
    for (const slot of [0, 1, 2, 3]) {
      seen.add(buildUploadUrlForK2Cfs('http://k2plus.local', slot))
    }
    expect(seen.size).toBe(4)
  })
})
