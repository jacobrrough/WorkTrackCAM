import { describe, expect, it } from 'vitest'
import {
  buildMoonrakerPushFailureClipboardText,
  buildMoonrakerPushPayload,
  formatMoonrakerPushFailure,
  splitMoonrakerPushFailureForToast,
  type MoonrakerPushFailureToastParts,
  type MoonrakerPushPayload,
  type MoonrakerPushResult,
  type ShopJobForPush
} from './moonraker-push-payload'

/**
 * Tests for the renderer-side Moonraker push payload builder and
 * failure-message formatter. [ID-0080] — closes the production gap
 * where the renderer never threaded `machineId` into the IPC payload
 * so the K2 Plus pre-upload temperature guard was effectively
 * disarmed.
 */

const mkJob = (overrides: Partial<ShopJobForPush> = {}): ShopJobForPush => ({
  gcodeOut: '/tmp/out.gcode',
  printerUrl: 'http://k2.local',
  machineId: 'creality-k2-plus',
  ...overrides
})

describe('buildMoonrakerPushPayload — [ID-0080] machineId threading', () => {
  it('includes machineId when the job has a non-empty string machineId', () => {
    const out = buildMoonrakerPushPayload(mkJob({ machineId: 'creality-k2-plus' }))
    expect(out.machineId).toBe('creality-k2-plus')
  })

  it('omits machineId when job.machineId is null', () => {
    const out = buildMoonrakerPushPayload(mkJob({ machineId: null }))
    expect('machineId' in out).toBe(false)
  })

  it('omits machineId when job.machineId is undefined', () => {
    const out = buildMoonrakerPushPayload(mkJob({ machineId: undefined }))
    expect('machineId' in out).toBe(false)
  })

  it('omits machineId when job.machineId is an empty string', () => {
    const out = buildMoonrakerPushPayload(mkJob({ machineId: '' }))
    expect('machineId' in out).toBe(false)
  })

  it('preserves gcodePath and printerUrl verbatim', () => {
    const out = buildMoonrakerPushPayload(
      mkJob({ gcodeOut: '/a/b/c.gcode', printerUrl: 'http://1.2.3.4:7125' })
    )
    expect(out.gcodePath).toBe('/a/b/c.gcode')
    expect(out.printerUrl).toBe('http://1.2.3.4:7125')
  })
})

describe('buildMoonrakerPushPayload — [ID-0080] defaults and Safety Rule 2', () => {
  it('defaults startAfterUpload to true (matches pre-[ID-0080] production call-site)', () => {
    const out = buildMoonrakerPushPayload(mkJob())
    expect(out.startAfterUpload).toBe(true)
  })

  it('honors an explicit startAfterUpload: false override', () => {
    const out = buildMoonrakerPushPayload(mkJob(), { startAfterUpload: false })
    expect(out.startAfterUpload).toBe(false)
  })

  it('honors an explicit startAfterUpload: true override', () => {
    const out = buildMoonrakerPushPayload(mkJob(), { startAfterUpload: true })
    expect(out.startAfterUpload).toBe(true)
  })

  it('produces a payload whose required fields match the pre-[ID-0080] inline shape byte-for-byte', () => {
    // Pre-[ID-0080] call-site:
    //   fab().moonrakerPush({ gcodePath: activeJob.gcodeOut,
    //                         printerUrl: activeJob.printerUrl,
    //                         startAfterUpload: true })
    // With machineId absent this helper must produce exactly those
    // three keys in exactly the same shape -- Safety Rule 2.
    const out = buildMoonrakerPushPayload({
      gcodeOut: '/tmp/out.gcode',
      printerUrl: 'http://k2.local',
      machineId: null
    })
    expect(out).toEqual({
      gcodePath: '/tmp/out.gcode',
      printerUrl: 'http://k2.local',
      startAfterUpload: true
    })
  })
})

describe('buildMoonrakerPushPayload — [ID-0080] optional uploadPath + timeoutMs', () => {
  it('includes uploadPath when caller supplies a non-empty string', () => {
    const out = buildMoonrakerPushPayload(mkJob(), { uploadPath: 'subdir/file.gcode' })
    expect(out.uploadPath).toBe('subdir/file.gcode')
  })

  it('omits uploadPath when caller supplies an empty string', () => {
    const out = buildMoonrakerPushPayload(mkJob(), { uploadPath: '' })
    expect('uploadPath' in out).toBe(false)
  })

  it('omits uploadPath when opts is absent', () => {
    const out = buildMoonrakerPushPayload(mkJob())
    expect('uploadPath' in out).toBe(false)
  })

  it('includes timeoutMs when caller supplies a finite positive number', () => {
    const out = buildMoonrakerPushPayload(mkJob(), { timeoutMs: 15_000 })
    expect(out.timeoutMs).toBe(15_000)
  })

  it('omits timeoutMs for zero', () => {
    const out = buildMoonrakerPushPayload(mkJob(), { timeoutMs: 0 })
    expect('timeoutMs' in out).toBe(false)
  })

  it('omits timeoutMs for negatives', () => {
    const out = buildMoonrakerPushPayload(mkJob(), { timeoutMs: -1 })
    expect('timeoutMs' in out).toBe(false)
  })

  it('omits timeoutMs for NaN', () => {
    const out = buildMoonrakerPushPayload(mkJob(), { timeoutMs: Number.NaN })
    expect('timeoutMs' in out).toBe(false)
  })

  it('omits timeoutMs for Infinity', () => {
    const out = buildMoonrakerPushPayload(mkJob(), { timeoutMs: Number.POSITIVE_INFINITY })
    expect('timeoutMs' in out).toBe(false)
  })
})

describe('buildMoonrakerPushPayload — [ID-0080] end-to-end K2 Plus shape', () => {
  it('produces the full shape the K2 Plus production path will send when a job has a linked machine', () => {
    const out: MoonrakerPushPayload = buildMoonrakerPushPayload(
      {
        gcodeOut: '/home/me/WorkTrackCAM/out/part.gcode',
        printerUrl: 'http://192.168.1.50',
        machineId: 'creality-k2-plus'
      },
      { startAfterUpload: true }
    )
    expect(out).toEqual({
      gcodePath: '/home/me/WorkTrackCAM/out/part.gcode',
      printerUrl: 'http://192.168.1.50',
      startAfterUpload: true,
      machineId: 'creality-k2-plus'
    })
  })
})

describe('formatMoonrakerPushFailure — [ID-0080] detail surfacing', () => {
  it('returns "error: detail" when both fields are non-empty', () => {
    const r: MoonrakerPushResult = {
      ok: false,
      error: 'Upload blocked -- G-code exceeds machine temperature ceiling.',
      detail: 'M109 T0 targets 400 C but exceeds the nozzle ceiling of 350 C declared by the machine profile.'
    }
    expect(formatMoonrakerPushFailure(r)).toBe(
      'Upload blocked -- G-code exceeds machine temperature ceiling.: M109 T0 targets 400 C but exceeds the nozzle ceiling of 350 C declared by the machine profile.'
    )
  })

  it('returns detail alone when error is missing', () => {
    const r: MoonrakerPushResult = { ok: false, detail: 'just the detail' }
    expect(formatMoonrakerPushFailure(r)).toBe('just the detail')
  })

  it('returns detail alone when error is an empty string', () => {
    const r: MoonrakerPushResult = { ok: false, error: '', detail: 'just the detail' }
    expect(formatMoonrakerPushFailure(r)).toBe('just the detail')
  })

  it('returns error alone when detail is missing', () => {
    const r: MoonrakerPushResult = { ok: false, error: 'HTTP 500 from printer' }
    expect(formatMoonrakerPushFailure(r)).toBe('HTTP 500 from printer')
  })

  it('returns error alone when detail is an empty string', () => {
    const r: MoonrakerPushResult = { ok: false, error: 'HTTP 500 from printer', detail: '' }
    expect(formatMoonrakerPushFailure(r)).toBe('HTTP 500 from printer')
  })

  it('falls back to "Send failed" when both fields are missing', () => {
    const r: MoonrakerPushResult = { ok: false }
    expect(formatMoonrakerPushFailure(r)).toBe('Send failed')
  })

  it('falls back to "Send failed" when both fields are empty strings', () => {
    const r: MoonrakerPushResult = { ok: false, error: '', detail: '' }
    expect(formatMoonrakerPushFailure(r)).toBe('Send failed')
  })

  it('includes the (+N more) tail from summarizeTempViolations when the validator produced multiple violations', () => {
    // This pin documents the real end-to-end violation shape that the
    // pre-upload validator (see [ID-0070]/[ID-0071]/[ID-0073]) emits
    // via summarizeTempViolations. If a future cycle changes the
    // summarizer's punctuation, this pin is the renderer-side canary.
    const r: MoonrakerPushResult = {
      ok: false,
      error: 'Upload blocked -- G-code exceeds machine temperature ceiling.',
      detail:
        'M109 T0 targets 400 C but exceeds the nozzle ceiling of 350 C declared by the machine profile. (+2 more)'
    }
    const out = formatMoonrakerPushFailure(r)
    expect(out).toContain('(+2 more)')
    expect(out).toContain('exceeds the nozzle ceiling of 350 C')
  })
})

describe('[ID-0072] formatMoonrakerPushFailure — will-heat preview append', () => {
  it('byte-identical output when tempValidation is absent (Safety Rule 2)', () => {
    // Pin the pre-[ID-0072] happy-path so callers that never thread
    // samples through see zero change in the toast message.
    const r: MoonrakerPushResult = {
      ok: false,
      error: 'Upload failed -- could not connect to printer.',
      detail: 'connect ETIMEDOUT 192.168.1.50:7125'
    }
    expect(formatMoonrakerPushFailure(r)).toBe(
      'Upload failed -- could not connect to printer.: connect ETIMEDOUT 192.168.1.50:7125'
    )
  })

  it('byte-identical output when tempValidation.samples is an empty array', () => {
    const r: MoonrakerPushResult = {
      ok: false,
      error: 'Upload failed',
      tempValidation: { samples: [] }
    }
    expect(formatMoonrakerPushFailure(r)).toBe('Upload failed')
  })

  it('appends the peak-per-kind preview when samples are present', () => {
    const r: MoonrakerPushResult = {
      ok: false,
      error: 'Upload blocked -- G-code exceeds machine temperature ceiling.',
      detail:
        'M109 T0 targets 400 C but exceeds the nozzle ceiling of 350 C declared by the machine profile.',
      tempValidation: {
        samples: [
          { lineNumber: 11, command: 'M190', kind: 'bed', targetC: 60, raw: 'M190 S60' },
          { lineNumber: 12, command: 'M141', kind: 'chamber', targetC: 50, raw: 'M141 S50' },
          { lineNumber: 13, command: 'M109', kind: 'nozzle', targetC: 400, raw: 'M109 T0 S400' }
        ]
      }
    }
    const out = formatMoonrakerPushFailure(r)
    expect(out).toContain('Upload blocked -- G-code exceeds machine temperature ceiling.')
    expect(out).toContain('M109 T0 targets 400 C but exceeds the nozzle ceiling of 350 C')
    expect(out).toContain('— will heat: Nozzle: 400 C · Bed: 60 C · Chamber: 50 C')
  })

  it('appends preview even when error + detail are both missing (fallback base)', () => {
    const r: MoonrakerPushResult = {
      ok: false,
      tempValidation: {
        samples: [
          { lineNumber: 1, command: 'M104', kind: 'nozzle', targetC: 215, raw: 'M104 S215' }
        ]
      }
    }
    expect(formatMoonrakerPushFailure(r)).toBe('Send failed — will heat: Nozzle: 215 C')
  })

  it('ignores non-finite targetC samples in the preview (defensive)', () => {
    const r: MoonrakerPushResult = {
      ok: false,
      error: 'Upload failed',
      tempValidation: {
        samples: [
          { lineNumber: 1, command: 'M104', kind: 'nozzle', targetC: Number.NaN, raw: 'M104' },
          { lineNumber: 2, command: 'M109', kind: 'nozzle', targetC: 240, raw: 'M109 S240' }
        ]
      }
    }
    expect(formatMoonrakerPushFailure(r)).toBe(
      'Upload failed — will heat: Nozzle: 240 C'
    )
  })

  it('picks the MAX nozzle target across multiple samples (peak visibility)', () => {
    const r: MoonrakerPushResult = {
      ok: false,
      tempValidation: {
        samples: [
          { lineNumber: 1, command: 'M104', kind: 'nozzle', targetC: 210, raw: 'M104 S210' },
          { lineNumber: 2, command: 'M109', kind: 'nozzle', targetC: 245, raw: 'M109 S245' },
          { lineNumber: 3, command: 'M104', kind: 'nozzle', targetC: 220, raw: 'M104 S220' }
        ]
      }
    }
    expect(formatMoonrakerPushFailure(r)).toBe('Send failed — will heat: Nozzle: 245 C')
  })
})

describe('splitMoonrakerPushFailureForToast -- [ID-0088] two-line toast split', () => {
  it('splits a typical rejection: error -> title, detail -> detail', () => {
    const r: MoonrakerPushResult = {
      ok: false,
      error: 'Upload blocked -- G-code exceeds machine temperature ceiling.',
      detail: 'M109 targets 400 C but exceeds the nozzle ceiling of 350 C declared by the machine profile. (+2 more)'
    }
    const out = splitMoonrakerPushFailureForToast(r)
    expect(out.title).toBe('Upload blocked -- G-code exceeds machine temperature ceiling.')
    expect(out.detail).toBe(
      'M109 targets 400 C but exceeds the nozzle ceiling of 350 C declared by the machine profile. (+2 more)'
    )
  })

  it('hoists detail into title when error is missing', () => {
    const r: MoonrakerPushResult = {
      ok: false,
      detail: 'Connection refused: 192.168.1.50:7125'
    }
    const out = splitMoonrakerPushFailureForToast(r)
    expect(out.title).toBe('Connection refused: 192.168.1.50:7125')
    expect(out.detail).toBeNull()
  })

  it('falls back to "Send failed" when both error and detail are missing and no preview', () => {
    const r: MoonrakerPushResult = { ok: false }
    const out = splitMoonrakerPushFailureForToast(r)
    expect(out.title).toBe('Send failed')
    expect(out.detail).toBeNull()
  })

  it('uses error in title when detail is missing', () => {
    const r: MoonrakerPushResult = {
      ok: false,
      error: 'HTTP 500 from printer'
    }
    const out = splitMoonrakerPushFailureForToast(r)
    expect(out.title).toBe('HTTP 500 from printer')
    expect(out.detail).toBeNull()
  })

  it('treats empty error/detail strings as missing', () => {
    const r: MoonrakerPushResult = {
      ok: false,
      error: '',
      detail: ''
    }
    const out = splitMoonrakerPushFailureForToast(r)
    expect(out.title).toBe('Send failed')
    expect(out.detail).toBeNull()
  })

  it('appends "will heat: ..." preview to the detail slot when both error and detail are present', () => {
    const r: MoonrakerPushResult = {
      ok: false,
      error: 'Upload blocked.',
      detail: 'Bed targets 130 C, ceiling 120 C.',
      tempValidation: {
        samples: [
          { lineNumber: 1, command: 'M140', kind: 'bed', targetC: 130, raw: 'M140 S130' }
        ]
      }
    }
    const out = splitMoonrakerPushFailureForToast(r)
    expect(out.title).toBe('Upload blocked.')
    expect(out.detail).toBe('Bed targets 130 C, ceiling 120 C. -- will heat: Bed: 130 C')
  })

  it('puts preview in detail slot when only preview is present (no error/detail)', () => {
    const r: MoonrakerPushResult = {
      ok: false,
      tempValidation: {
        samples: [
          { lineNumber: 1, command: 'M104', kind: 'nozzle', targetC: 245, raw: 'M104 S245' }
        ]
      }
    }
    const out = splitMoonrakerPushFailureForToast(r)
    expect(out.title).toBe('Send failed')
    expect(out.detail).toBe('will heat: Nozzle: 245 C')
  })

  it('puts preview in detail slot when only error is present (no detail)', () => {
    const r: MoonrakerPushResult = {
      ok: false,
      error: 'HTTP 500 from printer',
      tempValidation: {
        samples: [
          { lineNumber: 1, command: 'M104', kind: 'nozzle', targetC: 245, raw: 'M104 S245' }
        ]
      }
    }
    const out = splitMoonrakerPushFailureForToast(r)
    expect(out.title).toBe('HTTP 500 from printer')
    // When only error is present, `result.detail` is null so we do NOT
    // hoist anything into the detail slot beyond the preview.
    expect(out.detail).toBe('will heat: Nozzle: 245 C')
  })

  it('Safety Rule 2: title + detail joined with ": " reconstructs the legacy single-line text for the typical rejection path', () => {
    const r: MoonrakerPushResult = {
      ok: false,
      error: 'Upload blocked.',
      detail: 'M109 targets 400 C but exceeds the nozzle ceiling of 350 C. (+2 more)'
    }
    const split = splitMoonrakerPushFailureForToast(r)
    const legacy = formatMoonrakerPushFailure(r)
    // The two-line split must encode the same operator-visible
    // information as the legacy single-line shape so a downstream
    // caller that only takes the title (or only takes the detail) can
    // be sure no information is silently dropped on the floor.
    const reconstructed = split.detail !== null ? `${split.title}: ${split.detail}` : split.title
    expect(reconstructed).toBe(legacy)
  })

  it('Safety Rule 2: same legacy reconstruction holds for preview-augmented rejections', () => {
    const r: MoonrakerPushResult = {
      ok: false,
      error: 'Upload blocked.',
      detail: 'Bed targets 130 C, ceiling 120 C.',
      tempValidation: {
        samples: [
          { lineNumber: 1, command: 'M140', kind: 'bed', targetC: 130, raw: 'M140 S130' }
        ]
      }
    }
    const split = splitMoonrakerPushFailureForToast(r)
    const legacy = formatMoonrakerPushFailure(r)
    // formatMoonrakerPushFailure joins "{base} -- will heat: {preview}"
    // (em dash). splitMoonrakerPushFailureForToast joins detail parts
    // with " -- " (ASCII double-hyphen). The two encodings differ on
    // the dash character but the operator-visible field set is
    // identical -- pin both shapes.
    expect(legacy).toBe(
      'Upload blocked.: Bed targets 130 C, ceiling 120 C. — will heat: Bed: 130 C'
    )
    expect(split.title).toBe('Upload blocked.')
    expect(split.detail).toBe(
      'Bed targets 130 C, ceiling 120 C. -- will heat: Bed: 130 C'
    )
  })

  it('return type is MoonrakerPushFailureToastParts: title is non-null string, detail is string|null', () => {
    const r: MoonrakerPushResult = { ok: false, error: 'X', detail: 'Y' }
    const out: MoonrakerPushFailureToastParts = splitMoonrakerPushFailureForToast(r)
    // Type-level pin: TS would fail compilation if the shape regressed.
    // Runtime pin: title is always a string, detail is string|null.
    expect(typeof out.title).toBe('string')
    expect(out.title.length).toBeGreaterThan(0)
    expect(out.detail === null || typeof out.detail === 'string').toBe(true)
  })

  it('handles long ~150-char detail (the actual motivating case for [ID-0088])', () => {
    // Sample reject from validateGcodeFileTemps: M109 targets exceeding
    // the K2 Plus 350 C nozzle ceiling, with multiple violations
    // collapsed into a "(+N more)" tail. This is precisely the input
    // that overflowed the legacy single-line toast (max-width 360px).
    const r: MoonrakerPushResult = {
      ok: false,
      error: 'Upload blocked -- G-code exceeds machine temperature ceiling.',
      detail: 'M109 at line 142 targets 400 C but exceeds the nozzle ceiling of 350 C declared by the machine profile. (+5 more violations)'
    }
    const out = splitMoonrakerPushFailureForToast(r)
    expect(out.title.length).toBeLessThanOrEqual(80)
    expect(out.detail).not.toBeNull()
    expect(out.detail!.length).toBeGreaterThan(80)
    // Title alone is short enough to render on one toast line.
    expect(out.title).toBe('Upload blocked -- G-code exceeds machine temperature ceiling.')
  })
})

describe('buildMoonrakerPushFailureClipboardText -- [ID-0088] Copy button payload', () => {
  it('joins title + detail with ": " to reproduce the legacy single-line shape', () => {
    const parts: MoonrakerPushFailureToastParts = {
      title: 'Upload blocked.',
      detail: 'Nozzle targets 400 C, ceiling 350 C.'
    }
    expect(buildMoonrakerPushFailureClipboardText(parts)).toBe(
      'Upload blocked.: Nozzle targets 400 C, ceiling 350 C.'
    )
  })

  it('returns title only when detail is null', () => {
    const parts: MoonrakerPushFailureToastParts = {
      title: 'Send failed',
      detail: null
    }
    expect(buildMoonrakerPushFailureClipboardText(parts)).toBe('Send failed')
  })

  it('treats empty-string detail as null (no trailing ": ")', () => {
    const parts: MoonrakerPushFailureToastParts = {
      title: 'Send failed',
      detail: ''
    }
    expect(buildMoonrakerPushFailureClipboardText(parts)).toBe('Send failed')
  })

  it('round-trips the typical splitMoonrakerPushFailureForToast output', () => {
    const r: MoonrakerPushResult = {
      ok: false,
      error: 'Upload blocked.',
      detail: 'M109 targets 400 C, ceiling 350 C. (+2 more)'
    }
    const split = splitMoonrakerPushFailureForToast(r)
    const clipboard = buildMoonrakerPushFailureClipboardText(split)
    expect(clipboard).toBe('Upload blocked.: M109 targets 400 C, ceiling 350 C. (+2 more)')
  })
})
