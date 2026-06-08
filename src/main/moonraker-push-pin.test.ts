/**
 * Co-located paired-pin contract for `src/main/moonraker-push.ts`.
 *
 * Cycle 311 [ID-0389] cam-engine paired-pin (rotation OFF docs-and-dx
 * per CLAUDE.md "never repeat the same area back-to-back" -- C310 was
 * docs-and-dx [ID-0388] [ID-0067-data-v45] EDIT-WORKFLOW.md ledger
 * refresh, C311 picks slot #2 cam-engine on a NEW unpinned target per
 * the C310 hand-off; cooled 5 cycles since C306's stock-simulation-pin
 * land. moonraker-push is the first-class Moonraker HTTP push pipeline
 * for the Creality K2 Plus FDM printer per CLAUDE.md "Direct G-code
 * upload via Moonraker API is native and preferred (implement
 * first-class)" -- the highest-leverage K2 Plus integration surface
 * in the project).
 *
 * `moonraker-push.ts` (522L / 18869 bytes UTF-8) is the Electron-main
 * Moonraker REST helper module that owns the K2 Plus push (upload +
 * optionally start), status query, cancel, pause, and resume methods.
 * The Laguna Swift 5x10 RichAuto A-series CNC and Makera Carvera
 * 4-axis routes are EXPLICITLY OUT-OF-SCOPE (CNC machines do NOT use
 * Moonraker; their push pipelines are file-write-only via the
 * carvera-cli-run path or operator-side USB transfer for the Laguna).
 *
 * Existing coverage: `src/main/moonraker-push.test.ts` (201L / 25 it()
 * across 4 describe groups; covers parseMoonrakerStatusBody +
 * parseUploadedPath behavioral invariants + the moonrakerPause +
 * moonrakerResume unreachable-host wall-clock bounds [ID-0082] +
 * [ID-0105]). `src/main/moonraker-push-e2e.test.ts` (781L) covers
 * end-to-end push semantics with mocked HTTP servers.
 *
 * This paired-pin extends coverage with STRUCTURAL invariants:
 *   (A) Module shape -- runtime-export inventory + arity + Function.name.
 *   (B) SOURCE-text purity (no `:any`, no CRLF, byte-size invariant,
 *       LF-only, single trailing newline, helper function inventory).
 *   (C) Type-export contracts (4 type-only exports: payload + result +
 *       status + parsed status; structural shape sentinels via cast).
 *   (D) Parse-helper literal stability (parseMoonrakerStatusBody return
 *       fallback, parseUploadedPath fallback chain).
 *   (E) Endpoint URL literal pins (5 Moonraker REST endpoints; any
 *       rename here breaks the K2 Plus push pipeline).
 *   (F) Default-timeout literal pins (15_000 ms push budget,
 *       8_000 ms status / cancel / pause / resume budgets).
 *   (G) moonrakerPush early-error paths (missing local file +
 *       unreachable host wall-clock bound).
 *   (H) Status / cancel wall-clock bound regression net (matching the
 *       [ID-0082] AbortController + [ID-0105] tightening on Pause /
 *       Resume from the existing test file).
 *   (I) Three-machine impact realism (K2 Plus DIRECT cross-cut via
 *       integration with FdmCapabilityFields temp-ceiling validator;
 *       Laguna 5x10 + Carvera 4-axis EXPLICITLY OUT-OF-SCOPE).
 *   (J) On-disk source provenance + SOURCE-text purity sentinel.
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as M from './moonraker-push'
import {
  parseMoonrakerStatusBody,
  parseUploadedPath,
  moonrakerPush,
  moonrakerStatus,
  moonrakerCancel,
  moonrakerPause,
  moonrakerResume
} from './moonraker-push'

const SOURCE_PATH = join(process.cwd(), 'src/main/moonraker-push.ts')
const SOURCE_TEXT = readFileSync(SOURCE_PATH, 'utf-8')
const SOURCE_BYTES = Buffer.byteLength(SOURCE_TEXT, 'utf-8')
const SOURCE_LINES = SOURCE_TEXT.split('\n')

// Wall-clock bound matching the existing src/main/moonraker-push.test.ts
// [ID-0082] / [ID-0105] convention: 100 ms timeout / 600 ms (6x) budget
// against the non-routable 192.0.2.1 sink (TEST-NET-1 per RFC 5737).
const UNREACHABLE_HOST = 'http://192.0.2.1:7125'
const UNREACHABLE_TIMEOUT_MS = 100
const UNREACHABLE_BUDGET_MS = 600

// ─── A. Module shape ─────────────────────────────────────────────────

describe('moonraker-push PIN A -- module shape', () => {
  it('A1: namespace exposes exactly 8 runtime exports', () => {
    // Updated post-CFS-v1: `buildUploadUrlForK2Cfs` is a pure URL-shape
    // helper exported alongside the legacy parser helpers so a renderer
    // test can verify the K2 CFS slot wire shape without booting the
    // mock-Moonraker harness. See `moonraker-push.test.ts` "buildUploadUrlForK2Cfs".
    const runtime = Object.keys(M).sort()
    expect(runtime).toEqual([
      'buildUploadUrlForK2Cfs',
      'moonrakerCancel',
      'moonrakerPause',
      'moonrakerPush',
      'moonrakerResume',
      'moonrakerStatus',
      'parseMoonrakerStatusBody',
      'parseUploadedPath'
    ])
  })
  it('A2: every runtime export is a function', () => {
    for (const k of Object.keys(M)) {
      expect(typeof (M as Record<string, unknown>)[k]).toBe('function')
    }
  })
  it('A3: parseMoonrakerStatusBody.length === 1', () => {
    expect(parseMoonrakerStatusBody.length).toBe(1)
  })
  it('A4: parseUploadedPath.length === 2', () => {
    expect(parseUploadedPath.length).toBe(2)
  })
  it('A5: moonrakerPush.length === 1 (single payload arg)', () => {
    expect(moonrakerPush.length).toBe(1)
  })
  it('A6: moonrakerStatus.length === 1 (timeoutMs has default)', () => {
    expect(moonrakerStatus.length).toBe(1)
  })
  it('A7: moonrakerCancel.length === 1 (timeoutMs has default)', () => {
    expect(moonrakerCancel.length).toBe(1)
  })
  it('A8: moonrakerPause.length === 1 (timeoutMs has default)', () => {
    expect(moonrakerPause.length).toBe(1)
  })
  it('A9: moonrakerResume.length === 1 (timeoutMs has default)', () => {
    expect(moonrakerResume.length).toBe(1)
  })
  it('A10: function names pin (regression net for renames)', () => {
    expect(parseMoonrakerStatusBody.name).toBe('parseMoonrakerStatusBody')
    expect(parseUploadedPath.name).toBe('parseUploadedPath')
    expect(moonrakerPush.name).toBe('moonrakerPush')
    expect(moonrakerStatus.name).toBe('moonrakerStatus')
    expect(moonrakerCancel.name).toBe('moonrakerCancel')
    expect(moonrakerPause.name).toBe('moonrakerPause')
    expect(moonrakerResume.name).toBe('moonrakerResume')
    // CFS v1: pure URL-shape helper for the K2 Plus CFS slot wire.
    expect(M.buildUploadUrlForK2Cfs.name).toBe('buildUploadUrlForK2Cfs')
  })
  it('A11: namespace has no `default` export', () => {
    expect((M as Record<string, unknown>).default).toBeUndefined()
  })
  it('A12: namespace size is exactly 8', () => {
    // Updated post-CFS-v1: namespace size grew by 1 with the addition of
    // `buildUploadUrlForK2Cfs`. See A1 for the full key set.
    expect(Object.keys(M).length).toBe(8)
  })
  it('A13: namespace key-set is stable across consecutive Object.keys calls', () => {
    const a = Object.keys(M).sort()
    const b = Object.keys(M).sort()
    expect(a).toEqual(b)
  })
  it('A14: namespace has no numeric / Set / Map / Date / Symbol runtime exports', () => {
    for (const k of Object.keys(M)) {
      const v = (M as Record<string, unknown>)[k]
      expect(typeof v === 'number').toBe(false)
      expect(typeof v === 'symbol').toBe(false)
      expect(v instanceof Set).toBe(false)
      expect(v instanceof Map).toBe(false)
      expect(v instanceof Date).toBe(false)
    }
  })
})

// ─── B. SOURCE-text purity ───────────────────────────────────────────

describe('moonraker-push PIN B -- SOURCE-text purity', () => {
  it('B1: SOURCE byte-size is exactly 25772', () => {
    // Updated post-CFS-v1 (+ Klipper PLR / adaptive-probing advisory
    // warnings): file grew with the new `cfsSlotId` payload field, the
    // pure `buildUploadUrlForK2Cfs` helper, the threading through
    // `uploadFileMultipart` + `moonrakerPush`, and the two new advisory
    // warning paths driven by `checkGcodeHeaderHealth.fields.has*`.
    // 2026-06-08: +338 B for the normalizeMoonrakerUrl import + scheme-default
    // at the `new URL(...)` boundary (the bare-IP "printer URL invalid" fix).
    expect(SOURCE_BYTES).toBe(25772)
  })
  it('B2: SOURCE UTF-16 length (.length) is exactly 25460', () => {
    // Updated post-CFS-v1 + the 2026-06-08 moonraker-url fix. See B1 for context.
    expect(SOURCE_TEXT.length).toBe(25460)
  })
  it('B3: SOURCE_LINES split-by-LF length matches the on-disk line count (post CFS-v1 + PLR/probe advisory additions)', () => {
    // Updated post-CFS-v1 / PLR / adaptive-probing: file now carries
    // the K2 CFS slot URL helper + the two new advisory warnings.
    // Reflect the new shape so any FUTURE drift is still pinned.
    expect(SOURCE_LINES).toHaveLength(684)
    expect(SOURCE_LINES[SOURCE_LINES.length - 1]).toBe('')
  })
  it('B4: SOURCE has zero CRLF sequences (LF-only line endings)', () => {
    expect(SOURCE_TEXT.includes('\r\n')).toBe(false)
    expect(SOURCE_TEXT.includes('\r')).toBe(false)
  })
  it('B5: SOURCE ends with a single trailing LF (not two)', () => {
    expect(SOURCE_TEXT.endsWith('\n')).toBe(true)
    expect(SOURCE_TEXT.endsWith('\n\n')).toBe(false)
  })
  it('B6: SOURCE has zero `: any` annotations', () => {
    expect(SOURCE_TEXT.match(/: any\b/g)).toBeNull()
  })
  it('B7: SOURCE has zero `as any` casts', () => {
    expect(SOURCE_TEXT.includes('as any')).toBe(false)
  })
  it('B8: SOURCE has zero @ts-ignore comments', () => {
    expect(SOURCE_TEXT.includes('@ts-ignore')).toBe(false)
  })
  it('B9: SOURCE has zero @ts-expect-error comments', () => {
    expect(SOURCE_TEXT.includes('@ts-expect-error')).toBe(false)
  })
  it('B10: SOURCE has exactly 12 top-level `\\nexport ` markers (4 types + 8 functions)', () => {
    // Updated post-CFS-v1: added `buildUploadUrlForK2Cfs` (pure URL
    // helper), bringing the export count from 11 to 12.
    const matches = SOURCE_TEXT.match(/\nexport /g)
    expect(matches).not.toBeNull()
    expect(matches?.length).toBe(12)
  })
  it('B11: SOURCE has exactly 4 `export type ` declarations', () => {
    const matches = SOURCE_TEXT.match(/^export type /gm)
    expect(matches?.length).toBe(4)
  })
  it('B12: SOURCE has exactly 5 `export async function ` declarations', () => {
    const matches = SOURCE_TEXT.match(/^export async function /gm)
    expect(matches?.length).toBe(5)
  })
  it('B13: SOURCE has exactly 3 non-async `export function ` declarations (the parser helpers + CFS URL builder are sync)', () => {
    // Updated post-CFS-v1: added `buildUploadUrlForK2Cfs` -- a pure
    // synchronous URL helper -- bringing the sync export count from 2
    // (parseMoonrakerStatusBody + parseUploadedPath) to 3.
    const allFn = (SOURCE_TEXT.match(/^export function /gm) ?? []).length
    expect(allFn).toBe(3)
  })
  it('B14: SOURCE has exactly 1 internal helper `function makeRequest(`', () => {
    const matches = SOURCE_TEXT.match(/^function makeRequest\(/gm)
    expect(matches?.length).toBe(1)
  })
  it('B15: SOURCE has exactly 1 internal helper `async function uploadFileMultipart(`', () => {
    const matches = SOURCE_TEXT.match(/^async function uploadFileMultipart\(/gm)
    expect(matches?.length).toBe(1)
  })
  it('B16: SOURCE references AbortController exactly 3 times (node connect-phase bound per [ID-0082])', () => {
    const occurs = SOURCE_TEXT.split('AbortController').length - 1
    expect(occurs).toBe(3)
  })
  it('B17: SOURCE has zero TODO / FIXME / HACK / XXX markers', () => {
    expect(SOURCE_TEXT.match(/\bTODO\b/g)).toBeNull()
    expect(SOURCE_TEXT.match(/\bFIXME\b/g)).toBeNull()
    expect(SOURCE_TEXT.match(/\bHACK\b/g)).toBeNull()
    expect(SOURCE_TEXT.match(/\bXXX\b/g)).toBeNull()
  })
})

// ─── C. Type-export contracts ────────────────────────────────────────

describe('moonraker-push PIN C -- type-export contracts', () => {
  it('C1: MoonrakerPushPayload required fields gcodePath + printerUrl compile', () => {
    const pl: M.MoonrakerPushPayload = { gcodePath: '/tmp/x.gcode', printerUrl: 'http://k2:7125' }
    expect(pl.gcodePath).toBe('/tmp/x.gcode')
    expect(pl.printerUrl).toBe('http://k2:7125')
  })
  it('C2: MoonrakerPushPayload optional fields all type-check', () => {
    const pl: M.MoonrakerPushPayload = {
      gcodePath: '/tmp/x.gcode',
      printerUrl: 'http://k2:7125',
      uploadPath: 'gcodes',
      startAfterUpload: true,
      timeoutMs: 30_000,
      machineCapabilities: null
    }
    expect(pl.startAfterUpload).toBe(true)
    expect(pl.timeoutMs).toBe(30_000)
    expect(pl.machineCapabilities).toBeNull()
  })
  it('C3: MoonrakerPushResult ok=true discriminator carries filename + uploadedPath + printStarted + printerUrl', () => {
    const r: M.MoonrakerPushResult = {
      ok: true,
      filename: 'a.gcode',
      uploadedPath: 'gcodes/a.gcode',
      printStarted: false,
      printerUrl: 'http://k2:7125'
    }
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.filename).toBe('a.gcode')
      expect(r.uploadedPath).toBe('gcodes/a.gcode')
      expect(r.printStarted).toBe(false)
      expect(r.printerUrl).toBe('http://k2:7125')
    }
  })
  it('C4: MoonrakerPushResult ok=false discriminator carries error + optional detail/tempValidation', () => {
    const r: M.MoonrakerPushResult = { ok: false, error: 'boom', detail: 'why' }
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe('boom')
      expect(r.detail).toBe('why')
      expect(r.tempValidation).toBeUndefined()
    }
  })
  it('C5: MoonrakerStatusResult ok=true known states union compiles', () => {
    const states: Array<'standby' | 'printing' | 'paused' | 'complete' | 'cancelled' | 'error' | 'unknown'> = [
      'standby',
      'printing',
      'paused',
      'complete',
      'cancelled',
      'error',
      'unknown'
    ]
    for (const state of states) {
      const r: M.MoonrakerStatusResult = { ok: true, state }
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.state).toBe(state)
    }
  })
  it('C6: MoonrakerStatusResult ok=true optional fields filename/progress/etaSeconds/rawState compile', () => {
    const r: M.MoonrakerStatusResult = {
      ok: true,
      state: 'printing',
      filename: 'p.gcode',
      progress: 0.5,
      etaSeconds: 60,
      rawState: 'printing'
    }
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.progress).toBe(0.5)
      expect(r.etaSeconds).toBe(60)
    }
  })
  it('C7: MoonrakerStatusResult ok=false discriminator narrows', () => {
    const r: M.MoonrakerStatusResult = { ok: false, error: 'boom' }
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('boom')
  })
  it('C8: MoonrakerStatusParsed shape pins (rawState always present, others optional)', () => {
    const p: M.MoonrakerStatusParsed = { rawState: 'unknown' }
    expect(p.rawState).toBe('unknown')
    expect(p.filename).toBeUndefined()
    expect(p.progress).toBeUndefined()
    expect(p.etaSeconds).toBeUndefined()
  })
})

// ─── D. parseMoonrakerStatusBody literal stability ───────────────────

describe('moonraker-push PIN D -- parseMoonrakerStatusBody literal stability', () => {
  it('D1: returns exactly { rawState: "unknown" } for empty string', () => {
    expect(parseMoonrakerStatusBody('')).toEqual({ rawState: 'unknown' })
  })
  it('D2: returns exactly { rawState: "unknown" } for malformed JSON', () => {
    expect(parseMoonrakerStatusBody('{not-json}')).toEqual({ rawState: 'unknown' })
  })
  it('D3: rawState falls back to literal "unknown" when stats.state is non-string', () => {
    const body = JSON.stringify({ result: { status: { print_stats: { state: 42 } } } })
    expect(parseMoonrakerStatusBody(body).rawState).toBe('unknown')
  })
  it('D4: rawState preserves arbitrary string verbatim (caller normalizes)', () => {
    const body = JSON.stringify({ result: { status: { print_stats: { state: 'pre_warmup_xyz' } } } })
    expect(parseMoonrakerStatusBody(body).rawState).toBe('pre_warmup_xyz')
  })
  it('D5: handles missing result root by returning rawState unknown', () => {
    expect(parseMoonrakerStatusBody('{}').rawState).toBe('unknown')
  })
  it('D6: ETA branch-1 fires on print_duration > 0 + progress > 0', () => {
    // print_duration=600, progress=0.4 -> total=1500 -> ETA = 900
    const body = JSON.stringify({
      result: { status: { print_stats: { state: 'printing', progress: 0.4, print_duration: 600 } } }
    })
    expect(parseMoonrakerStatusBody(body).etaSeconds).toBe(900)
  })
  it('D7: ETA branch-1 returns 0 (Math.max guard) when remaining would be negative', () => {
    const body = JSON.stringify({
      result: { status: { print_stats: { state: 'printing', progress: 0.999, print_duration: 1 } } }
    })
    expect(parseMoonrakerStatusBody(body).etaSeconds).toBe(0)
  })
  it('D8: ETA returns undefined when only total_duration is present (branch-2 needs print_duration too)', () => {
    const body = JSON.stringify({
      result: { status: { print_stats: { state: 'printing', progress: 0.5, total_duration: 1000 } } }
    })
    expect(parseMoonrakerStatusBody(body).etaSeconds).toBeUndefined()
  })
  it('D9: ETA branch-2 fires when print_duration is 0 + progress > 0 + total_duration present', () => {
    const body = JSON.stringify({
      result: {
        status: {
          print_stats: { state: 'printing', progress: 0.25, print_duration: 0, total_duration: 800 }
        }
      }
    })
    // 800 * (1 - 0.25) = 600
    expect(parseMoonrakerStatusBody(body).etaSeconds).toBe(600)
  })
  it('D10: ETA returns undefined when progress is 0', () => {
    const body = JSON.stringify({
      result: {
        status: {
          print_stats: { state: 'printing', progress: 0, print_duration: 100, total_duration: 200 }
        }
      }
    })
    expect(parseMoonrakerStatusBody(body).etaSeconds).toBeUndefined()
  })
})

// ─── E. parseUploadedPath fallback chain ─────────────────────────────

describe('moonraker-push PIN E -- parseUploadedPath fallback chain', () => {
  it('E1: returns item.path when item.path is a string', () => {
    expect(parseUploadedPath('{"item":{"path":"gcodes/a.gcode"}}', 'fb.gcode')).toBe('gcodes/a.gcode')
  })
  it('E2: prefers item.path over top-level path when both present', () => {
    const body = '{"item":{"path":"item-path.gcode"},"path":"top-path.gcode"}'
    expect(parseUploadedPath(body, 'fb.gcode')).toBe('item-path.gcode')
  })
  it('E3: falls through to top-level path when item.path is non-string', () => {
    const body = '{"item":{"path":99},"path":"top-path.gcode"}'
    expect(parseUploadedPath(body, 'fb.gcode')).toBe('top-path.gcode')
  })
  it('E4: falls through to top-level path when item is absent entirely', () => {
    expect(parseUploadedPath('{"path":"top.gcode"}', 'fb.gcode')).toBe('top.gcode')
  })
  it('E5: returns fallback when both item.path and top-level path are absent', () => {
    expect(parseUploadedPath('{"item":{}}', 'fallback.gcode')).toBe('fallback.gcode')
  })
  it('E6: returns fallback for malformed JSON', () => {
    expect(parseUploadedPath('not-json', 'mypart.gcode')).toBe('mypart.gcode')
  })
  it('E7: returns fallback for empty string', () => {
    expect(parseUploadedPath('', 'fb.gcode')).toBe('fb.gcode')
  })
  it('E8: returns fallback when top-level path is non-string', () => {
    expect(parseUploadedPath('{"path":42}', 'fb.gcode')).toBe('fb.gcode')
  })
})

// ─── F. Default-timeout literal pins ─────────────────────────────────

describe('moonraker-push PIN F -- default-timeout literal pins', () => {
  it('F1: SOURCE has exactly one `timeoutMs = 15_000` default (push budget)', () => {
    const matches = SOURCE_TEXT.match(/timeoutMs = 15_000/g)
    expect(matches?.length).toBe(1)
  })
  it('F2: SOURCE has exactly four `timeoutMs = 8_000` defaults (status / cancel / pause / resume)', () => {
    const matches = SOURCE_TEXT.match(/timeoutMs = 8_000/g)
    expect(matches?.length).toBe(4)
  })
  it('F3: SOURCE has exactly one `timeoutMs ?? 15_000` fallback inside makeRequest', () => {
    const matches = SOURCE_TEXT.match(/timeoutMs \?\? 15_000/g)
    expect(matches?.length).toBe(1)
  })
  it('F4: SOURCE pins the AbortError detection literal (`AbortError` and `ABORT_ERR`)', () => {
    expect(SOURCE_TEXT.includes("'AbortError'")).toBe(true)
    expect(SOURCE_TEXT.includes("'ABORT_ERR'")).toBe(true)
  })
  it('F5: SOURCE pins the multipart boundary prefix literal `----MoonrakerFormBoundary`', () => {
    expect(SOURCE_TEXT.includes('----MoonrakerFormBoundary')).toBe(true)
  })
  it('F6: SOURCE pins the multipart Content-Type literal', () => {
    expect(SOURCE_TEXT.includes('multipart/form-data; boundary=')).toBe(true)
  })
  it('F7: SOURCE pins the multipart name="file" disposition literal', () => {
    expect(SOURCE_TEXT.includes('name="file"')).toBe(true)
  })
})

// ─── G. Endpoint URL literal pins ────────────────────────────────────

describe('moonraker-push PIN G -- endpoint URL literal pins', () => {
  it('G1: pins POST /server/files/upload (Moonraker virtual SD upload)', () => {
    // Updated post-CFS-v1: `buildUploadUrlForK2Cfs` adds 4 more
    // occurrences (helper docstring + helper body + caller comments)
    // on top of the original 4 (uploadFileMultipart docs + body +
    // moonrakerPush docs + parseUploadedPath docs).
    const matches = SOURCE_TEXT.match(/\/server\/files\/upload/g)
    expect(matches?.length).toBe(8)
  })
  it('G2: pins POST /printer/print/start (start endpoint)', () => {
    const matches = SOURCE_TEXT.match(/\/printer\/print\/start/g)
    expect(matches?.length).toBe(2)
  })
  it('G3: pins POST /printer/print/cancel (cancel endpoint)', () => {
    const matches = SOURCE_TEXT.match(/\/printer\/print\/cancel/g)
    expect(matches?.length).toBe(2)
  })
  it('G4: pins POST /printer/print/pause (pause endpoint)', () => {
    const matches = SOURCE_TEXT.match(/\/printer\/print\/pause/g)
    expect(matches?.length).toBe(2)
  })
  it('G5: pins POST /printer/print/resume (resume endpoint)', () => {
    const matches = SOURCE_TEXT.match(/\/printer\/print\/resume/g)
    expect(matches?.length).toBe(2)
  })
  it('G6: pins GET /printer/objects/query?print_stats (status endpoint)', () => {
    const matches = SOURCE_TEXT.match(/\/printer\/objects\/query\?print_stats/g)
    expect(matches?.length).toBe(3)
  })
  it('G7: pins the trailing-slash strip pattern `replace(/\\/$/, "")` used by every URL builder', () => {
    const matches = SOURCE_TEXT.match(/replace\(\/\\\/\$\//g)
    expect(matches).not.toBeNull()
    expect((matches?.length ?? 0) >= 5).toBe(true)
  })
})

// ─── H. moonrakerPush early-error paths ──────────────────────────────

describe('moonraker-push PIN H -- moonrakerPush early-error paths', () => {
  it('H1: returns ok=false with "G-code file not found." when local path does not exist', async () => {
    const r = await moonrakerPush({
      gcodePath: '/definitely/does/not/exist/c311.gcode',
      printerUrl: 'http://k2plus.local:7125'
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe('G-code file not found.')
      expect(r.detail).toContain('/definitely/does/not/exist/c311.gcode')
      expect(r.detail).toContain('Manufacture')
    }
  })
  it('H2: missing-file path mentions the full failing path in detail (no path-stripping)', async () => {
    const r = await moonrakerPush({
      gcodePath: '/zzzz/c311-pin-missing.gcode',
      printerUrl: 'http://k2plus.local:7125'
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.detail).toContain('/zzzz/c311-pin-missing.gcode')
  })
  it('H3: existing-file + unreachable-host returns ok=false with upload-failed error within wall-clock bound', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'c311-moonraker-pin-'))
    const path = join(dir, 'h3.gcode')
    writeFileSync(path, ';C311 [ID-0389] paired-pin upload sentinel\nG28\nG1 Z5\n')
    const t0 = Date.now()
    try {
      const r = await moonrakerPush({
        gcodePath: path,
        printerUrl: UNREACHABLE_HOST,
        timeoutMs: UNREACHABLE_TIMEOUT_MS
      })
      const elapsed = Date.now() - t0
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.error).toBe('Upload failed -- could not connect to printer.'.replace('--', '—'))
      }
      expect(elapsed).toBeLessThan(UNREACHABLE_BUDGET_MS)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('H4: missing-file branch fires SYNCHRONOUSLY before any network attempt (no host hit)', async () => {
    const t0 = Date.now()
    const r = await moonrakerPush({
      gcodePath: '/zzz/c311-h4-still-missing.gcode',
      printerUrl: UNREACHABLE_HOST,
      timeoutMs: UNREACHABLE_TIMEOUT_MS
    })
    const elapsed = Date.now() - t0
    expect(r.ok).toBe(false)
    // Must finish well under the network budget; statSync rejection is immediate.
    expect(elapsed).toBeLessThan(UNREACHABLE_BUDGET_MS / 4)
  })
})

// ─── I. Status / cancel wall-clock bound regression net ──────────────

describe('moonraker-push PIN I -- status / cancel wall-clock bound', () => {
  it('I1: moonrakerStatus against unreachable host returns ok=false within wall-clock budget', async () => {
    const t0 = Date.now()
    const r = await moonrakerStatus(UNREACHABLE_HOST, UNREACHABLE_TIMEOUT_MS)
    const elapsed = Date.now() - t0
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBeDefined()
    expect(elapsed).toBeLessThan(UNREACHABLE_BUDGET_MS)
  })
  it('I2: moonrakerStatus surfaces an error string AND optional detail object', async () => {
    const r = await moonrakerStatus(UNREACHABLE_HOST, UNREACHABLE_TIMEOUT_MS)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(typeof r.error).toBe('string')
      expect(r.error.length > 0).toBe(true)
    }
  })
  it('I3: moonrakerCancel against unreachable host returns ok=false within wall-clock budget', async () => {
    const t0 = Date.now()
    const r = await moonrakerCancel(UNREACHABLE_HOST, UNREACHABLE_TIMEOUT_MS)
    const elapsed = Date.now() - t0
    expect(r.ok).toBe(false)
    expect(r.error).toBeDefined()
    expect(elapsed).toBeLessThan(UNREACHABLE_BUDGET_MS)
  })
  it('I4: moonrakerPause against unreachable host returns ok=false within wall-clock budget', async () => {
    const t0 = Date.now()
    const r = await moonrakerPause(UNREACHABLE_HOST, UNREACHABLE_TIMEOUT_MS)
    const elapsed = Date.now() - t0
    expect(r.ok).toBe(false)
    expect(r.error).toBeDefined()
    expect(elapsed).toBeLessThan(UNREACHABLE_BUDGET_MS)
  })
  it('I5: moonrakerResume against unreachable host returns ok=false within wall-clock budget', async () => {
    const t0 = Date.now()
    const r = await moonrakerResume(UNREACHABLE_HOST, UNREACHABLE_TIMEOUT_MS)
    const elapsed = Date.now() - t0
    expect(r.ok).toBe(false)
    expect(r.error).toBeDefined()
    expect(elapsed).toBeLessThan(UNREACHABLE_BUDGET_MS)
  })
  it('I6: every helper resolves (does not reject) when the host is unreachable', async () => {
    // Co-locate as one assertion to keep the wall-clock cost low; each call gets
    // its own UNREACHABLE_TIMEOUT_MS and we sum the bounds against a 5x ceiling.
    const t0 = Date.now()
    const results = await Promise.all([
      moonrakerStatus(UNREACHABLE_HOST, UNREACHABLE_TIMEOUT_MS),
      moonrakerCancel(UNREACHABLE_HOST, UNREACHABLE_TIMEOUT_MS),
      moonrakerPause(UNREACHABLE_HOST, UNREACHABLE_TIMEOUT_MS),
      moonrakerResume(UNREACHABLE_HOST, UNREACHABLE_TIMEOUT_MS)
    ])
    const elapsed = Date.now() - t0
    for (const r of results) expect(r.ok).toBe(false)
    // 4 parallel requests should still finish within ~2x budget on most hosts;
    // give 5x for sandbox cold-cache noise headroom.
    expect(elapsed).toBeLessThan(UNREACHABLE_BUDGET_MS * 5)
  })
})

// ─── J. Three-machine impact realism ─────────────────────────────────

describe('moonraker-push PIN J -- three-machine impact realism', () => {
  it('J1: SOURCE explicitly names the Creality K2 Plus (the only target FDM machine)', () => {
    expect(SOURCE_TEXT.includes('Creality K2 Plus')).toBe(true)
    expect(SOURCE_TEXT.includes('K2 Plus')).toBe(true)
  })
  it('J2: SOURCE explicitly names the Klipper firmware family (K2 Plus runs Creality Klipper-OS)', () => {
    expect(SOURCE_TEXT.includes('Klipper')).toBe(true)
  })
  it('J3: SOURCE has zero RichAuto / Laguna identifiers (Laguna 5x10 is OUT-OF-SCOPE)', () => {
    expect(SOURCE_TEXT.includes('RichAuto')).toBe(false)
    expect(SOURCE_TEXT.includes('Laguna')).toBe(false)
  })
  it('J4: SOURCE has zero Carvera / Makera identifiers (Carvera 4-axis is OUT-OF-SCOPE)', () => {
    expect(SOURCE_TEXT.includes('Carvera')).toBe(false)
    expect(SOURCE_TEXT.includes('Makera')).toBe(false)
  })
  it('J5: SOURCE imports the FdmCapabilityFields type used for K2 Plus pre-upload temp validation', () => {
    // Post-2026-05-27 foundation pivot: FdmCapabilityFields moved from the
    // deleted `../shared/cura-slice-defaults` (CuraEngine bundle) into the
    // `../shared/gcode-temp-validator` module, which is the new home for
    // K2 Plus temp-ceiling validation.
    expect(SOURCE_TEXT.includes("import type { FdmCapabilityFields } from '../shared/gcode-temp-validator'")).toBe(true)
  })
  it('J6: SOURCE wires readGcodeHeaderText for the [ID-0075] bounded 128 KiB header read', () => {
    expect(SOURCE_TEXT.includes("import { readGcodeHeaderText } from './gcode-header-read'")).toBe(true)
  })
  it('J7: SOURCE wires validateGcodeFileTemps for the [ID-0073] pre-upload temp ceiling check', () => {
    expect(SOURCE_TEXT.includes('validateGcodeFileTemps')).toBe(true)
    expect(SOURCE_TEXT.includes('summarizeTempViolations')).toBe(true)
  })
  it('J8: SOURCE references the `[ID-0073]` ticket for the pre-upload temp gate (audit trail)', () => {
    expect(SOURCE_TEXT.includes('[ID-0073]')).toBe(true)
  })
  it('J9: SOURCE references the `[ID-0075]` ticket for the bounded header read (audit trail)', () => {
    expect(SOURCE_TEXT.includes('[ID-0075]')).toBe(true)
  })
  it('J10: SOURCE references the `[ID-0082]` ticket for the AbortController connect-phase bound', () => {
    expect(SOURCE_TEXT.includes('[ID-0082]')).toBe(true)
  })
  it('J11: missing-file early-error against a K2-Plus-shaped URL still rejects without hitting the network', async () => {
    const t0 = Date.now()
    const r = await moonrakerPush({
      gcodePath: '/nope/c311-k2-plus-pin.gcode',
      printerUrl: 'http://k2plus.local:7125',
      timeoutMs: 50
    })
    const elapsed = Date.now() - t0
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('G-code file not found.')
    // Statsync rejection is sub-millisecond; budget 5x sandbox jitter.
    expect(elapsed).toBeLessThan(UNREACHABLE_BUDGET_MS / 4)
  })
  it('J12: existing-file + unreachable K2 host with machineCapabilities=null preserves pre-[ID-0073] behavior', async () => {
    // Safety Rule 2: when machineCapabilities is omitted/null, behavior matches
    // the original pre-[ID-0073] upload path -- file existence check, then
    // network. A null cap MUST NOT short-circuit with a temp-validation error.
    const dir = mkdtempSync(join(tmpdir(), 'c311-moonraker-j12-'))
    const path = join(dir, 'j12.gcode')
    writeFileSync(path, ';C311 [ID-0389] paired-pin J12 sentinel\nM104 S210\nM190 S60\nG28\n')
    try {
      const r = await moonrakerPush({
        gcodePath: path,
        printerUrl: UNREACHABLE_HOST,
        timeoutMs: UNREACHABLE_TIMEOUT_MS,
        machineCapabilities: null
      })
      expect(r.ok).toBe(false)
      if (!r.ok) {
        // Must NOT be a temp-validation failure -- it must be the network path.
        expect(r.tempValidation).toBeUndefined()
        expect(r.error.toLowerCase()).not.toContain('temperature')
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ─── K. On-disk source provenance + sentinel ─────────────────────────

describe('moonraker-push PIN K -- on-disk source provenance + sentinel', () => {
  it('K1: SOURCE_PATH points inside the expected src/main/ directory', () => {
    expect(SOURCE_PATH.endsWith('/src/main/moonraker-push.ts') || SOURCE_PATH.endsWith('\\src\\main\\moonraker-push.ts')).toBe(true)
  })
  it('K2: SOURCE_TEXT first non-empty line is the JSDoc opener', () => {
    const lines = SOURCE_TEXT.split('\n')
    let i = 0
    while (i < lines.length && lines[i].trim() === '') i += 1
    expect(lines[i]).toBe('/**')
  })
  it('K3: SOURCE_TEXT JSDoc names the Creality K2 Plus on its first content line', () => {
    expect(SOURCE_LINES[1]).toContain('Creality K2 Plus')
  })
  it('K4: SOURCE_TEXT references moonraker.readthedocs.io (canonical Moonraker docs URL)', () => {
    expect(SOURCE_TEXT.includes('moonraker.readthedocs.io')).toBe(true)
  })
  it('K5: SOURCE_BYTES is exactly 25772 (regression net for any silent byte drift)', () => {
    // Updated post-CFS-v1 + the 2026-06-08 moonraker-url fix. See B1 docstring.
    expect(SOURCE_BYTES).toBe(25772)
  })
  it('K6: SOURCE has 156 non-ASCII chars total (147 box-drawing + 8 em-dash + 1 arrow)', () => {
    let count = 0
    for (let i = 0; i < SOURCE_TEXT.length; i += 1) {
      if (SOURCE_TEXT.charCodeAt(i) > 127) count += 1
    }
    expect(count).toBe(156)
  })
  it('K7: SOURCE has exactly 147 box-drawing U+2500 chars (header banners)', () => {
    let count = 0
    for (let i = 0; i < SOURCE_TEXT.length; i += 1) {
      if (SOURCE_TEXT.charCodeAt(i) === 0x2500) count += 1
    }
    expect(count).toBe(147)
  })
  it('K8: SOURCE has exactly 8 U+2014 em-dashes', () => {
    let count = 0
    for (let i = 0; i < SOURCE_TEXT.length; i += 1) {
      if (SOURCE_TEXT.charCodeAt(i) === 0x2014) count += 1
    }
    expect(count).toBe(8)
  })
  it('K9: SOURCE has exactly 1 U+2192 right-arrow (used in error-detail copy)', () => {
    let count = 0
    for (let i = 0; i < SOURCE_TEXT.length; i += 1) {
      if (SOURCE_TEXT.charCodeAt(i) === 0x2192) count += 1
    }
    expect(count).toBe(1)
  })
  it('K10: SOURCE imports node:http and node:https (no third-party HTTP libs)', () => {
    expect(SOURCE_TEXT.includes("import http from 'node:http'")).toBe(true)
    expect(SOURCE_TEXT.includes("import https from 'node:https'")).toBe(true)
  })
  it('K11: SOURCE imports node:fs / node:os / node:path / node:url only (zero third-party)', () => {
    // Pin the import style; the only third-party-shaped lines are the local
    // ../shared/* + ./gcode-header-read which are project-internal modules.
    expect(SOURCE_TEXT.includes("from 'node:fs'")).toBe(true)
    expect(SOURCE_TEXT.includes("from 'node:path'")).toBe(true)
    expect(SOURCE_TEXT.includes("from 'node:url'")).toBe(true)
    expect(SOURCE_TEXT.includes("import('node:fs/promises')")).toBe(true) // dynamic import inside uploadFileMultipart
    // No bare-package imports (no `from 'axios'`, etc.)
    // No bare-package imports: every `from '...'` must start with `node:`, `..`, or `.`
    const importLines = SOURCE_TEXT.match(/^import .*?from '([^']+)'/gm) ?? []
    for (const ln of importLines) {
      const path = ln.match(/from '([^']+)'/)?.[1] ?? ''
      expect(
        path.startsWith('node:') || path.startsWith('../') || path.startsWith('./')
      ).toBe(true)
    }
  })
  it('K12: SOURCE provenance sentinel -- exact (lines, bytes, utf16Length) tuple', () => {
    // Triple sentinel: any silent rewrite that preserves byte-count but shifts
    // line-count or utf16-length will fail at least one of these.
    // Updated post-CFS-v1. See B1 docstring for the additions.
    expect(SOURCE_LINES.length).toBe(684)
    expect(SOURCE_BYTES).toBe(25772)
    expect(SOURCE_TEXT.length).toBe(25460)
  })
})
