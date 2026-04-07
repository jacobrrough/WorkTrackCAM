import { describe, expect, it } from 'vitest'
import { parseMoonrakerStatusBody, parseUploadedPath, moonrakerPause, moonrakerResume } from './moonraker-push'

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
    // Use a non-routable IP to ensure connection failure without hitting a real printer
    const result = await moonrakerPause('http://192.0.2.1:7125', 500)
    expect(result.ok).toBe(false)
    expect(result.error).toBeDefined()
  })
})

// ─── moonrakerResume ────────────────────────────────────────────────────────

describe('moonrakerResume', () => {
  it('is a function', () => {
    expect(typeof moonrakerResume).toBe('function')
  })

  it('returns error when printer URL is unreachable', async () => {
    // Use a non-routable IP to ensure connection failure without hitting a real printer
    const result = await moonrakerResume('http://192.0.2.1:7125', 500)
    expect(result.ok).toBe(false)
    expect(result.error).toBeDefined()
  })
})
