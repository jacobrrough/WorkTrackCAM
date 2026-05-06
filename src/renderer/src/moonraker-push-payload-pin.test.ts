/**
 * moonraker-push-payload-pin.test.ts -- [ID-0211] Cycle 135 cam-engine paired-pin
 *
 * Companion to the behavior-test file `moonraker-push-payload.test.ts`
 * (508 lines, ~80 it()) that exercises the four exports' happy + edge
 * paths. THIS pin file additionally pins the contract of
 * `src/renderer/src/moonraker-push-payload.ts` -- the renderer-side
 * Moonraker push payload builder + failure-message formatters that
 * thread `machineId` into the K2 Plus pre-upload temperature guard
 * (see [ID-0078]/[ID-0080] in `src/main/ipc-fabrication.ts` +
 * `src/main/moonraker-push.ts` for the IPC half). K2-PLUS-SPECIFIC --
 * the Cycle 134 hand-off named this as one of the LAST under-pinned
 * helpers gated to a single target machine.
 *
 * Sister cycles (renderer pure-helper paired-pin chain post-Cycle-127):
 *   - 119 [ID-0196] derive-features
 *   - 124 [ID-0201] viewport3d-bounds
 *   - 129 [ID-0206] design-viewport-interaction
 *   - 130 [ID-0207] shop-stock-bounds
 *   - 131 [ID-0208] command-palette-memory
 *   - 132 [ID-0209] post-process-dialects
 *   - 134 [ID-0210] brand-bar-machine-badge
 *   - 135 [ID-0211] moonraker-push-payload (THIS FILE)
 *
 * Pinned surfaces:
 *   (A) Module shape -- exact named exports + arities + no symbol/proto leak.
 *   (B) Type contracts -- the five exported types compile through canonical
 *       fixtures and reject the documented "missing/empty -> drop" branches.
 *   (C) buildMoonrakerPushPayload purity + immutability + freshness +
 *       byte-identical output for the pre-[ID-0080] inline shape.
 *   (D) formatMoonrakerPushFailure determinism + idempotence + em-dash
 *       join character pin + Send-failed fallback identity.
 *   (E) splitMoonrakerPushFailureForToast freshness + dual-dash convention
 *       (legacy uses em dash; split uses ASCII double-hyphen) + Safety
 *       Rule 2 round-trip identity covering the preview suffix.
 *   (F) buildMoonrakerPushFailureClipboardText reconstructs legacy.
 *   (G) Source-text whitelist -- header docs, [ID-XXXX] tag counts,
 *       Safety-Rule-2 framing count, em-dash counts, "moonraker:push"
 *       string count, no top-level TypeScript `any` type, no React/DOM/
 *       electron imports, [ID-0072] formatFdmTempPreview wiring.
 *
 * ZERO production-code edits. Pure paired-pin (mirrors Cycles 119/124/129/
 * 130/131/132/134). Per `docs/EDIT-WORKFLOW.md` R1 the Python-via-bash
 * mandate covers EXISTING files >800 lines and `.claude/` log files only;
 * this is a NEW file < 800 lines so the Write tool is safe.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as M from './moonraker-push-payload'
import {
  buildMoonrakerPushFailureClipboardText,
  buildMoonrakerPushPayload,
  formatMoonrakerPushFailure,
  splitMoonrakerPushFailureForToast,
  type MoonrakerPushFailureToastParts,
  type MoonrakerPushOptions,
  type MoonrakerPushPayload,
  type MoonrakerPushResult,
  type ShopJobForPush
} from './moonraker-push-payload'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC_PATH = join(HERE, 'moonraker-push-payload.ts')
const SRC = readFileSync(SRC_PATH, 'utf-8')

// Canonical K2 Plus job fixture used across the pin file.
const K2_JOB: ShopJobForPush = {
  gcodeOut: '/home/me/WorkTrackCAM/out/part.gcode',
  printerUrl: 'http://192.168.1.50:7125',
  machineId: 'creality-k2-plus'
}

// ---------------------------------------------------------------------------
// (A) Module shape
// ---------------------------------------------------------------------------

describe('[ID-0211] moonraker-push-payload module shape', () => {
  it('exports buildMoonrakerPushPayload as a function', () => {
    expect(typeof buildMoonrakerPushPayload).toBe('function')
  })

  it('exports formatMoonrakerPushFailure as a function', () => {
    expect(typeof formatMoonrakerPushFailure).toBe('function')
  })

  it('exports splitMoonrakerPushFailureForToast as a function', () => {
    expect(typeof splitMoonrakerPushFailureForToast).toBe('function')
  })

  it('exports buildMoonrakerPushFailureClipboardText as a function', () => {
    expect(typeof buildMoonrakerPushFailureClipboardText).toBe('function')
  })

  it('buildMoonrakerPushPayload arity is exactly 2 (job + opts)', () => {
    expect(buildMoonrakerPushPayload.length).toBe(2)
  })

  it('formatMoonrakerPushFailure arity is exactly 1', () => {
    expect(formatMoonrakerPushFailure.length).toBe(1)
  })

  it('splitMoonrakerPushFailureForToast arity is exactly 1', () => {
    expect(splitMoonrakerPushFailureForToast.length).toBe(1)
  })

  it('buildMoonrakerPushFailureClipboardText arity is exactly 1', () => {
    expect(buildMoonrakerPushFailureClipboardText.length).toBe(1)
  })

  it('runtime-keys whitelist: only the four documented value exports', () => {
    // Types are erased at runtime so they never appear in M's enumerable
    // keys. If a stray helper sneaks in (e.g., a debug print) this pin
    // catches it before it ships. Sorted to keep diff stable.
    const keys = Object.keys(M).sort()
    expect(keys).toEqual([
      'buildMoonrakerPushFailureClipboardText',
      'buildMoonrakerPushPayload',
      'formatMoonrakerPushFailure',
      'splitMoonrakerPushFailureForToast'
    ])
  })

  it('module-namespace has only the four documented string-keyed value exports (Symbol.toStringTag is the only allowed Symbol key)', () => {
    const keys = Reflect.ownKeys(M)
    const stringKeys = keys.filter((k): k is string => typeof k === 'string').sort()
    const symbolKeys = keys.filter((k): k is symbol => typeof k === 'symbol')
    // String keys are exactly the four value exports.
    expect(stringKeys).toEqual([
      'buildMoonrakerPushFailureClipboardText',
      'buildMoonrakerPushPayload',
      'formatMoonrakerPushFailure',
      'splitMoonrakerPushFailureForToast'
    ])
    // The only Symbol key allowed is the spec-mandated Symbol.toStringTag
    // ("Module") that every ESM namespace object carries.
    for (const s of symbolKeys) {
      expect(s).toBe(Symbol.toStringTag)
    }
    // ESM module namespace objects have null prototypes per spec.
    expect(Object.getPrototypeOf(M)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// (B) Type contracts (compile-through pins)
// ---------------------------------------------------------------------------

describe('[ID-0211] type contracts compile through canonical fixtures', () => {
  it('MoonrakerPushPayload accepts the full K2 Plus shape', () => {
    const p: MoonrakerPushPayload = {
      gcodePath: '/a.gcode',
      printerUrl: 'http://k2.local',
      uploadPath: 'subdir/x.gcode',
      startAfterUpload: true,
      timeoutMs: 15_000,
      machineId: 'creality-k2-plus'
    }
    expect(p.gcodePath).toBe('/a.gcode')
  })

  it('MoonrakerPushPayload tolerates an optional-only minimum (gcodePath + printerUrl)', () => {
    const p: MoonrakerPushPayload = {
      gcodePath: '/a.gcode',
      printerUrl: 'http://k2.local'
    }
    // All five optional fields can be omitted; helper honors that.
    expect('machineId' in p).toBe(false)
  })

  it('ShopJobForPush accepts all three machineId-variants the runtime drops to "absent"', () => {
    const j1: ShopJobForPush = { gcodeOut: '/a', printerUrl: 'http://k', machineId: null }
    const j2: ShopJobForPush = { gcodeOut: '/a', printerUrl: 'http://k', machineId: undefined }
    const j3: ShopJobForPush = { gcodeOut: '/a', printerUrl: 'http://k', machineId: '' }
    // Behavioral pin: all three must produce a payload WITHOUT machineId.
    for (const j of [j1, j2, j3]) {
      expect('machineId' in buildMoonrakerPushPayload(j)).toBe(false)
    }
  })

  it('MoonrakerPushOptions has only the three documented keys (compile pin)', () => {
    const o: MoonrakerPushOptions = {
      startAfterUpload: false,
      uploadPath: 'sub',
      timeoutMs: 5000
    }
    // Runtime probe: the type alias only exposes those three keys, so a
    // round-trip preserves them.
    expect(Object.keys(o).sort()).toEqual(['startAfterUpload', 'timeoutMs', 'uploadPath'])
  })

  it('MoonrakerPushResult.tempValidation.samples is a readonly array of GcodeTempSample', () => {
    // Compile-time pin: TS rejects a non-readonly assignment if the
    // contract widens. Runtime pin: empty array is a valid input.
    const r: MoonrakerPushResult = {
      ok: false,
      tempValidation: { samples: [] as const }
    }
    expect(r.tempValidation?.samples?.length).toBe(0)
  })

  it('MoonrakerPushFailureToastParts: title is string, detail is string|null', () => {
    const a: MoonrakerPushFailureToastParts = { title: 'x', detail: 'y' }
    const b: MoonrakerPushFailureToastParts = { title: 'x', detail: null }
    expect(typeof a.title).toBe('string')
    expect(b.detail).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// (C) buildMoonrakerPushPayload purity + immutability + freshness
// ---------------------------------------------------------------------------

describe('[ID-0211] buildMoonrakerPushPayload purity & freshness', () => {
  it('does not mutate the input job', () => {
    const job: ShopJobForPush = { ...K2_JOB }
    const before = JSON.stringify(job)
    buildMoonrakerPushPayload(job, { startAfterUpload: false, uploadPath: 'x', timeoutMs: 1 })
    expect(JSON.stringify(job)).toBe(before)
  })

  it('does not mutate the opts argument', () => {
    const opts: MoonrakerPushOptions = { startAfterUpload: false, uploadPath: 'x', timeoutMs: 1 }
    const before = JSON.stringify(opts)
    buildMoonrakerPushPayload(K2_JOB, opts)
    expect(JSON.stringify(opts)).toBe(before)
  })

  it('returns a fresh object every call (no shared reference)', () => {
    const a = buildMoonrakerPushPayload(K2_JOB)
    const b = buildMoonrakerPushPayload(K2_JOB)
    expect(a).not.toBe(b)
    expect(a).toEqual(b)
  })

  it('output is mutable by the caller without affecting the next call', () => {
    const a = buildMoonrakerPushPayload(K2_JOB)
    a.gcodePath = '/clobbered'
    const b = buildMoonrakerPushPayload(K2_JOB)
    expect(b.gcodePath).toBe('/home/me/WorkTrackCAM/out/part.gcode')
  })

  it('safe against a frozen input job (no in-place writes to job)', () => {
    const frozen = Object.freeze({ ...K2_JOB })
    expect(() => buildMoonrakerPushPayload(frozen)).not.toThrow()
  })

  it('safe against a frozen opts object', () => {
    const frozen = Object.freeze({ startAfterUpload: false, uploadPath: 'x', timeoutMs: 1 })
    expect(() => buildMoonrakerPushPayload(K2_JOB, frozen)).not.toThrow()
  })

  it('determinism: N=10 calls with the same fixture produce structurally equal output', () => {
    const out0 = buildMoonrakerPushPayload(K2_JOB, { startAfterUpload: true })
    for (let i = 0; i < 10; i++) {
      expect(buildMoonrakerPushPayload(K2_JOB, { startAfterUpload: true })).toEqual(out0)
    }
  })

  it('output object has no extra keys beyond the documented six', () => {
    const out = buildMoonrakerPushPayload(K2_JOB, {
      startAfterUpload: true,
      uploadPath: 'sub/x.gcode',
      timeoutMs: 9000
    })
    const allowed = ['gcodePath', 'printerUrl', 'startAfterUpload', 'machineId', 'uploadPath', 'timeoutMs']
    for (const k of Object.keys(out)) {
      expect(allowed).toContain(k)
    }
  })

  it('-Infinity is dropped from timeoutMs (defensive non-finite branch)', () => {
    const out = buildMoonrakerPushPayload(K2_JOB, { timeoutMs: Number.NEGATIVE_INFINITY })
    expect('timeoutMs' in out).toBe(false)
  })

  it('preserves a whitespace-only uploadPath (string-length > 0 by spec)', () => {
    // The runtime contract is `length > 0`, so a single-space upload
    // path IS preserved. Pin this so a future cycle does not silently
    // tighten the gate to a `.trim().length > 0` check without updating
    // the [ID-0080] documentation.
    const out = buildMoonrakerPushPayload(K2_JOB, { uploadPath: ' ' })
    expect(out.uploadPath).toBe(' ')
  })

  it('preserves a non-ASCII gcodePath (renderer should not coerce)', () => {
    const out = buildMoonrakerPushPayload({
      ...K2_JOB,
      gcodeOut: '/Users/me/3d_print/part_テスト.gcode'
    })
    expect(out.gcodePath).toBe('/Users/me/3d_print/part_テスト.gcode')
  })

  it('rejects a non-string opts.uploadPath -> dropped from output', () => {
    // Defensive: if a caller passes the wrong type, the helper drops it
    // rather than forwarding garbage to the IPC handler.
    const out = buildMoonrakerPushPayload(K2_JOB, {
      // @ts-expect-error -- intentionally wrong type for runtime-defense pin
      uploadPath: 42
    })
    expect('uploadPath' in out).toBe(false)
  })

  it('rejects a non-string job.machineId -> dropped from output', () => {
    const out = buildMoonrakerPushPayload({
      gcodeOut: '/a',
      printerUrl: 'http://k',
      // @ts-expect-error -- intentionally wrong type for runtime-defense pin
      machineId: 42
    })
    expect('machineId' in out).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// (D) formatMoonrakerPushFailure determinism + idempotence
// ---------------------------------------------------------------------------

describe('[ID-0211] formatMoonrakerPushFailure determinism & idempotence', () => {
  it('is pure: same input N=10 -> same output every time', () => {
    const r: MoonrakerPushResult = { ok: false, error: 'X', detail: 'Y' }
    const out0 = formatMoonrakerPushFailure(r)
    for (let i = 0; i < 10; i++) {
      expect(formatMoonrakerPushFailure(r)).toBe(out0)
    }
  })

  it('does not mutate the input result', () => {
    const r: MoonrakerPushResult = {
      ok: false,
      error: 'X',
      detail: 'Y',
      tempValidation: {
        samples: [{ lineNumber: 1, command: 'M104', kind: 'nozzle', targetC: 215, raw: 'M104 S215' }]
      }
    }
    const before = JSON.stringify(r)
    formatMoonrakerPushFailure(r)
    expect(JSON.stringify(r)).toBe(before)
  })

  it('joins error + detail with ASCII ": " (NOT em dash) -- that is the legacy join character', () => {
    const out = formatMoonrakerPushFailure({ ok: false, error: 'A', detail: 'B' })
    // Pin the ASCII colon-space join. Em dash is reserved for the
    // [ID-0072] "will heat:" preview suffix.
    expect(out).toBe('A: B')
    expect(out).not.toContain('—')
  })

  it('preview suffix is joined with em dash space "— will heat:"', () => {
    const out = formatMoonrakerPushFailure({
      ok: false,
      error: 'X',
      tempValidation: {
        samples: [{ lineNumber: 1, command: 'M104', kind: 'nozzle', targetC: 240, raw: 'M104 S240' }]
      }
    })
    expect(out).toContain(' — will heat: ')
  })

  it('"Send failed" fallback is byte-identical for both missing-fields shapes', () => {
    const a = formatMoonrakerPushFailure({ ok: false })
    const b = formatMoonrakerPushFailure({ ok: false, error: '', detail: '' })
    expect(a).toBe('Send failed')
    expect(b).toBe('Send failed')
    expect(a).toBe(b)
  })

  it('handles result with extra unrelated keys without touching them', () => {
    // Defensive: the renderer cast may include keys that were dropped
    // from the IPC contract. Helper must be stable against a wider
    // shape than its declared input type.
    const r = {
      ok: false,
      error: 'X',
      detail: 'Y',
      legacyField: 'should be ignored'
    } as unknown as MoonrakerPushResult
    expect(formatMoonrakerPushFailure(r)).toBe('X: Y')
  })
})

// ---------------------------------------------------------------------------
// (E) splitMoonrakerPushFailureForToast freshness + dual-dash convention
// ---------------------------------------------------------------------------

describe('[ID-0211] splitMoonrakerPushFailureForToast freshness & dual-dash convention', () => {
  it('returns a fresh object every call (no shared reference)', () => {
    const r: MoonrakerPushResult = { ok: false, error: 'X', detail: 'Y' }
    const a = splitMoonrakerPushFailureForToast(r)
    const b = splitMoonrakerPushFailureForToast(r)
    expect(a).not.toBe(b)
    expect(a).toEqual(b)
  })

  it('does not mutate the input result', () => {
    const r: MoonrakerPushResult = {
      ok: false,
      error: 'X',
      detail: 'Y',
      tempValidation: {
        samples: [{ lineNumber: 1, command: 'M140', kind: 'bed', targetC: 60, raw: 'M140 S60' }]
      }
    }
    const before = JSON.stringify(r)
    splitMoonrakerPushFailureForToast(r)
    expect(JSON.stringify(r)).toBe(before)
  })

  it('detail-slot uses ASCII " -- " join (NOT em dash) -- explicit dual-dash convention', () => {
    // Cycle 14/16/[ID-0088] convention: the legacy single-line shape
    // uses em dash; the multi-line split's detail uses ASCII double-
    // hyphen because the toast renderer sometimes ships in fonts that
    // render em dash poorly. Pin both shapes explicitly.
    const out = splitMoonrakerPushFailureForToast({
      ok: false,
      error: 'X',
      detail: 'Y',
      tempValidation: {
        samples: [{ lineNumber: 1, command: 'M104', kind: 'nozzle', targetC: 240, raw: 'M104 S240' }]
      }
    })
    expect(out.detail).toBe('Y -- will heat: Nozzle: 240 C')
    expect(out.detail).not.toContain('—')
  })

  it('Safety Rule 2 round-trip: legacy = `${title}: ${detail}` for typical rejection (no preview)', () => {
    const r: MoonrakerPushResult = {
      ok: false,
      error: 'Upload blocked.',
      detail: 'M109 targets 400 C, ceiling 350 C. (+2 more)'
    }
    const split = splitMoonrakerPushFailureForToast(r)
    const legacy = formatMoonrakerPushFailure(r)
    const reconstructed = split.detail !== null ? `${split.title}: ${split.detail}` : split.title
    expect(reconstructed).toBe(legacy)
  })

  it('Safety Rule 2 round-trip: title-only fallback path (no detail, no preview) reconstructs legacy', () => {
    const r: MoonrakerPushResult = { ok: false, error: 'HTTP 500' }
    const split = splitMoonrakerPushFailureForToast(r)
    const legacy = formatMoonrakerPushFailure(r)
    const reconstructed = split.detail !== null ? `${split.title}: ${split.detail}` : split.title
    expect(reconstructed).toBe(legacy)
  })

  it('always returns a non-empty title string (operator-visible label invariant)', () => {
    const cases: MoonrakerPushResult[] = [
      { ok: false },
      { ok: false, error: '', detail: '' },
      { ok: false, error: 'A' },
      { ok: false, detail: 'B' },
      { ok: false, error: 'A', detail: 'B' },
      { ok: false, tempValidation: { samples: [] } }
    ]
    for (const r of cases) {
      const out = splitMoonrakerPushFailureForToast(r)
      expect(typeof out.title).toBe('string')
      expect(out.title.length).toBeGreaterThan(0)
    }
  })

  it('determinism: N=10 calls with the same fixture produce structurally equal output', () => {
    const r: MoonrakerPushResult = {
      ok: false,
      error: 'Upload blocked.',
      detail: 'D',
      tempValidation: {
        samples: [{ lineNumber: 1, command: 'M104', kind: 'nozzle', targetC: 250, raw: 'M104 S250' }]
      }
    }
    const out0 = splitMoonrakerPushFailureForToast(r)
    for (let i = 0; i < 10; i++) {
      expect(splitMoonrakerPushFailureForToast(r)).toEqual(out0)
    }
  })
})

// ---------------------------------------------------------------------------
// (F) buildMoonrakerPushFailureClipboardText reconstructs legacy
// ---------------------------------------------------------------------------

describe('[ID-0211] buildMoonrakerPushFailureClipboardText round-trips legacy single-line', () => {
  it('idempotent over the typical rejection path', () => {
    const r: MoonrakerPushResult = {
      ok: false,
      error: 'Upload blocked.',
      detail: 'M109 targets 400 C, ceiling 350 C. (+2 more)'
    }
    const split = splitMoonrakerPushFailureForToast(r)
    const clipboard = buildMoonrakerPushFailureClipboardText(split)
    expect(clipboard).toBe(formatMoonrakerPushFailure(r))
  })

  it('idempotent over the title-only path', () => {
    const r: MoonrakerPushResult = { ok: false, error: 'HTTP 500' }
    const split = splitMoonrakerPushFailureForToast(r)
    const clipboard = buildMoonrakerPushFailureClipboardText(split)
    expect(clipboard).toBe(formatMoonrakerPushFailure(r))
  })

  it('idempotent over the Send-failed fallback path', () => {
    const r: MoonrakerPushResult = { ok: false }
    const split = splitMoonrakerPushFailureForToast(r)
    const clipboard = buildMoonrakerPushFailureClipboardText(split)
    expect(clipboard).toBe('Send failed')
    expect(clipboard).toBe(formatMoonrakerPushFailure(r))
  })

  it('does not mutate the parts argument', () => {
    const parts: MoonrakerPushFailureToastParts = { title: 'A', detail: 'B' }
    const before = JSON.stringify(parts)
    buildMoonrakerPushFailureClipboardText(parts)
    expect(JSON.stringify(parts)).toBe(before)
  })

  it('determinism: N=10 calls with the same fixture produce identical output', () => {
    const parts: MoonrakerPushFailureToastParts = { title: 'A', detail: 'B' }
    const out0 = buildMoonrakerPushFailureClipboardText(parts)
    for (let i = 0; i < 10; i++) {
      expect(buildMoonrakerPushFailureClipboardText(parts)).toBe(out0)
    }
  })

  it('NOTE: clipboard preview-augmented case differs from the legacy em-dash join by design (split uses ASCII --)', () => {
    // This is the ONE case where clipboard != legacy formatter output:
    // when a temp preview is present with both error AND detail, the
    // legacy formatter joins with em dash, but the clipboard uses the
    // split's ASCII " -- " convention. Pin the divergence so a future
    // cycle does not "fix" one without the other.
    const r: MoonrakerPushResult = {
      ok: false,
      error: 'Upload blocked.',
      detail: 'D',
      tempValidation: {
        samples: [{ lineNumber: 1, command: 'M140', kind: 'bed', targetC: 130, raw: 'M140 S130' }]
      }
    }
    const split = splitMoonrakerPushFailureForToast(r)
    const clipboard = buildMoonrakerPushFailureClipboardText(split)
    const legacy = formatMoonrakerPushFailure(r)
    expect(clipboard).toBe('Upload blocked.: D -- will heat: Bed: 130 C')
    expect(legacy).toBe('Upload blocked.: D — will heat: Bed: 130 C')
    expect(clipboard).not.toBe(legacy) // dual-dash divergence is intentional
  })
})

// ---------------------------------------------------------------------------
// (G) Source-text whitelist
// ---------------------------------------------------------------------------

describe('[ID-0211] source-text whitelist', () => {
  it('header documents the [ID-0080] machineId-threading provenance', () => {
    expect(SRC).toContain('[ID-0080]')
    expect(SRC).toContain('machineId')
    expect(SRC).toContain('moonrakerPush')
  })

  it('header references the K2 Plus pre-upload temperature-guard chain (Cycles 8-14)', () => {
    expect(SRC).toContain('[ID-0012]')
    expect(SRC).toContain('[ID-0068]')
    expect(SRC).toContain('[ID-0070]')
    expect(SRC).toContain('[ID-0071]')
    expect(SRC).toContain('[ID-0073]')
    expect(SRC).toContain('[ID-0075]')
    expect(SRC).toContain('[ID-0078]')
  })

  it('[ID-0072] "will heat" preview wiring exists (formatFdmTempPreview import + 3 call-sites)', () => {
    expect(SRC).toContain("import { formatFdmTempPreview } from '../../shared/fdm-temp-preview'")
    // 1 import + 3 call-sites = 4 total occurrences. If a future cycle
    // adds another formatter that also calls formatFdmTempPreview, this
    // pin will need a bump -- which IS the desired tripwire.
    const matches = SRC.match(/formatFdmTempPreview/g)
    expect(matches).not.toBeNull()
    expect(matches!.length).toBe(4)
  })

  it('[ID-0088] two-line toast split lineage is present', () => {
    expect(SRC).toContain('[ID-0088]')
    const matches = SRC.match(/\[ID-0088\]/g)
    expect(matches).not.toBeNull()
    // 2 occurrences -- splitMoonrakerPushFailureForToast block-comment +
    // buildMoonrakerPushFailureClipboardText block-comment.
    expect(matches!.length).toBe(2)
  })

  it('Safety-Rule-2 framing appears in the headers of all four functions (or shared types)', () => {
    const matches = SRC.match(/Safety Rule 2/g)
    expect(matches).not.toBeNull()
    // 4 explicit "Safety Rule 2" mentions across the file -- one in
    // build-payload, one in [ID-0072] preview-append, one in [ID-0088]
    // split header, one in legacy round-trip framing.
    expect(matches!.length).toBe(4)
  })

  it('ID-0080 tag appears exactly 3 times (1 file header + 1 type header + 1 helper header)', () => {
    const matches = SRC.match(/\[ID-0080\]/g)
    expect(matches).not.toBeNull()
    expect(matches!.length).toBe(3)
  })

  it('"moonraker:push" IPC channel literal appears at least 4 times in the file (channel-bound docs)', () => {
    const matches = SRC.match(/moonraker:push/g)
    expect(matches).not.toBeNull()
    expect(matches!.length).toBeGreaterThanOrEqual(4)
  })

  it('em dash "—" appears in the runtime template literal (line ~190) AND header docs', () => {
    const matches = SRC.match(/—/g)
    expect(matches).not.toBeNull()
    // 5 em-dash occurrences total: 4 in block comments + 1 in the
    // formatMoonrakerPushFailure runtime template literal.
    expect(matches!.length).toBe(5)
    // Pin the runtime template literal byte-for-byte. Any drift in the
    // join character is the operator-visible canary.
    expect(SRC).toContain("`${base} — will heat: ${preview}`")
  })

  it('split helper uses ASCII " -- " join NOT em dash (paired with [ID-0088] dual-dash convention)', () => {
    expect(SRC).toContain("parts.join(' -- ')")
    expect(SRC).toContain('`will heat: ${preview}`')
  })

  it('"Send failed" literal appears exactly 6 times (2 runtime fallbacks + 4 doc/inline-comment references)', () => {
    // Breakdown: 1 in formatMoonrakerPushFailure runtime fallback (line ~189),
    // 1 in splitMoonrakerPushFailureForToast runtime fallback (line ~249),
    // 1 in formatMoonrakerPushFailure header doc, 1 in [ID-0088] header
    // doc, 2 in splitMoonrakerPushFailureForToast inline comments.
    const matches = SRC.match(/Send failed/g)
    expect(matches).not.toBeNull()
    expect(matches!.length).toBe(6)
  })

  it('clipboard helper uses ": " join (NOT " -- ") to reconstruct the legacy single-line shape', () => {
    expect(SRC).toContain('`${parts.title}: ${parts.detail}`')
  })

  it('uses the `??` nullish-coalescing operator exactly once (startAfterUpload default)', () => {
    const matches = SRC.match(/ \?\? /g)
    expect(matches).not.toBeNull()
    expect(matches!.length).toBe(1)
    expect(SRC).toContain('opts?.startAfterUpload ?? true')
  })

  it('no top-level TypeScript `any` type leaks (only the word "any" in a comment is allowed)', () => {
    // No type-position `: any`, no `as any`, no `Array<any>`, no
    // `Record<string, any>`. The only `any` allowed is in prose.
    expect(SRC).not.toMatch(/:\s*any\b/)
    expect(SRC).not.toMatch(/\bas any\b/)
    expect(SRC).not.toMatch(/<any>/)
  })

  it('imports only the two narrow shared modules (no React, no DOM, no electron)', () => {
    // Production guarantee: this helper is pure and renderer-agnostic.
    // Pulling in React/DOM/electron would defeat the unit-testability
    // promise of [ID-0080].
    expect(SRC).not.toMatch(/from ['"]react['"]/)
    expect(SRC).not.toMatch(/from ['"]electron['"]/)
    expect(SRC).not.toContain("from '@electron")
    expect(SRC).not.toContain('window.')
    expect(SRC).not.toContain('document.')
    // The two legitimate imports.
    expect(SRC).toContain("import type { GcodeTempSample } from '../../shared/gcode-temp-validator'")
    expect(SRC).toContain("import { formatFdmTempPreview } from '../../shared/fdm-temp-preview'")
  })

  it('exports exactly four `export function` declarations + five `export type` declarations', () => {
    const fns = SRC.match(/^export function /gm)
    expect(fns).not.toBeNull()
    expect(fns!.length).toBe(4)
    const types = SRC.match(/^export type /gm)
    expect(types).not.toBeNull()
    expect(types!.length).toBe(5)
  })

  it('exports the four helpers and the five types with the canonical names', () => {
    expect(SRC).toContain('export function buildMoonrakerPushPayload(')
    expect(SRC).toContain('export function formatMoonrakerPushFailure(')
    expect(SRC).toContain('export function splitMoonrakerPushFailureForToast(')
    expect(SRC).toContain('export function buildMoonrakerPushFailureClipboardText(')
    expect(SRC).toContain('export type MoonrakerPushPayload =')
    expect(SRC).toContain('export type MoonrakerPushResult =')
    expect(SRC).toContain('export type ShopJobForPush =')
    expect(SRC).toContain('export type MoonrakerPushOptions =')
    expect(SRC).toContain('export type MoonrakerPushFailureToastParts =')
  })

  it('build-payload contract pins: machineId-string-non-empty, finite-positive timeoutMs, default startAfterUpload=true', () => {
    expect(SRC).toContain("typeof job.machineId === 'string' && job.machineId.length > 0")
    expect(SRC).toContain('Number.isFinite(opts.timeoutMs)')
    expect(SRC).toContain('opts.timeoutMs > 0')
    expect(SRC).toContain('opts?.startAfterUpload ?? true')
  })
})
