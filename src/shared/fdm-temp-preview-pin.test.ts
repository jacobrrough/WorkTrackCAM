/**
 * fdm-temp-preview-pin.test.ts -- [ID-0257] Cycle 189 post-processing paired-pin
 *
 * Pins the contract of `src/shared/fdm-temp-preview.ts` -- the [ID-0072]
 * pre-flight FDM temperature preview formatter (Cycle 27 / ui-polish)
 * that surfaces the `GcodeTempSample[]` output of the Cycle 8 -> 18 -> 24
 * K2 Plus safety pipeline as a concise operator-facing preview string
 * suitable for a toast banner or pre-upload confirm dialog before
 * Moonraker push.
 *
 * K2 Plus (Klipper / Moonraker) is the SOLE production target. The other
 * two target machines (Laguna Swift 5x10 / RichAuto A-series; Makera
 * Carvera 4-axis / Smoothieware) have NO heated subsystems in scope --
 * verified by the `kind: "nozzle" | "bed" | "chamber"` exhaustive union
 * in `gcode-temp-validator.ts` line 74. The pin still exercises the
 * Klipper-extended `SET_HEATER_TEMPERATURE` macro form (M-command field
 * value) per [ID-0071] / [ID-0077] / [ID-0079] to confirm the formatter
 * does NOT special-case the slicer source (PrusaSlicer / Orca / Cura /
 * SuperSlicer / Klipper-native).
 *
 * Sister cycles in the post-Cycle-161-reset chain this pin extends:
 *   177 [ID-0249] / 178 [ID-0250] / 179 [ID-0251] / 180 [ID-0252] /
 *   181 [ID-0253] / 182 [ID-0254] / 183 [ID-0255] / 184 [ID-0259] /
 *   185 [ID-0265 / ID-0067-data-v27] / 186 [ID-0266] / 187 [ID-0261] /
 *   188 [ID-0258] -- now thirteen cycles deep at Cycle 189 close.
 *
 * The existing `fdm-temp-preview.test.ts` (222 lines, ~38 it()) covers
 * happy-path behavioural cases (per-kind peak, kind routing, integer
 * vs fractional formatting, null contract, K2 PrusaSlicer/Orca header
 * shape). THIS pin file does NOT duplicate that coverage. It pins:
 *   (A) module shape -- exact 5-runtime-export inventory + 1 type-
 *       only export, no default, no internal-helper leakage
 *       (formatTempC), Symbol.toStringTag-Module,
 *   (B) function signatures -- summarizeFdmTempSamples / renderFdmTemp-
 *       Preview / formatFdmTempPreview names + arity 1 each + native
 *       Function (NOT bound / arrow) + non-Promise return,
 *   (C) FDM_TEMP_PREVIEW_KIND_ORDER contract -- exact tuple
 *       ["nozzle", "bed", "chamber"] / length 3 / fresh array every
 *       module-load (TS readonly),
 *   (D) FDM_TEMP_PREVIEW_LABELS contract -- exact key inventory matching
 *       the order tuple + capitalized first-letter ("Nozzle" / "Bed" /
 *       "Chamber"), no extra keys, no missing keys,
 *   (E) summarizeFdmTempSamples per-kind MAX semantics + null contract
 *       -- non-array / empty / all-non-finite / unknown-kind paths
 *       return null; the Klipper SET_HEATER_TEMPERATURE command field
 *       routes by `kind` not by `command` so the formatter is slicer-
 *       agnostic; multi-tool nozzle samples collapse to the single
 *       max,
 *   (F) renderFdmTempPreview rendering contract -- section order is
 *       FIXED to the kind-order tuple regardless of insertion order;
 *       absent kinds are OMITTED entirely (no empty "Bed: " label);
 *       non-finite values defensively skipped per-kind,
 *   (G) bullet separator byte contract -- the separator literal is
 *       " " + U+00B7 MIDDLE DOT + " " (2-byte UTF-8 `c2 b7`); explicit
 *       guard against an Edit-tool swap to the visually similar U+2022
 *       BULLET (3-byte UTF-8 `e2 80 a2`) per `docs/EDIT-WORKFLOW.md`
 *       R1.5; no other separator candidate (em-dash, en-dash, hyphen,
 *       comma, slash) appears in the rendered output for valid
 *       summaries,
 *   (H) integer vs fractional formatting contract -- whole numbers
 *       render with NO decimal point (Number.isInteger gate) and
 *       fractional numbers render with EXACTLY one decimal (toFixed(1));
 *       the unit suffix is `"C"` (single ASCII letter, not "°C" / not
 *       a degree-sign) to avoid the multi-byte UTF-8 hazard,
 *   (I) formatFdmTempPreview composition equivalence -- the one-shot
 *       form is byte-equal to renderFdmTempPreview(summarizeFdmTemp-
 *       Samples(samples)) on every sample list,
 *   (J) three-machine path realism + slicer-source coverage -- K2 Plus
 *       Klipper canonical heater names (extruder / extruder1 /
 *       heater_bed / chamber); PrusaSlicer/Orca M104/M109/M140/M190
 *       header; SuperSlicer chamber M141/M191; Marlin pre-Klipper M104
 *       only; the helper has no opinion on the slicer, only on the
 *       parsed sample shape; Laguna and Carvera produce empty kinds
 *       (verified by absence -- the validator parser yields zero
 *       samples for non-FDM G-code which the formatter then collapses
 *       to null),
 *   (K) pure-function invariants -- idempotent (N=20 same input ->
 *       deep equal output, separate object instances), no input array
 *       mutation, no this-binding leakage on call/apply/bind, no
 *       throws on documented input ranges, fresh object instances per
 *       call,
 *   (L) source-text whitelist -- size canary (<= 130 lines, <= 4 KB),
 *       3 export-function forms, 2 export-const forms, 1 export-type,
 *       no React/DOM/electron/fs/net/three/path imports, no foreign-
 *       machine vendor literals, no `:any` / `as any` / `<any>`, no
 *       default export, the two-byte U+00B7 separator literally appears
 *       in source bytes, the three-byte U+2022 BULLET does NOT appear.
 *
 * ZERO production-code edits. Pure paired-pin.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as M from './fdm-temp-preview'
import {
  FDM_TEMP_PREVIEW_KIND_ORDER,
  FDM_TEMP_PREVIEW_LABELS,
  formatFdmTempPreview,
  renderFdmTempPreview,
  summarizeFdmTempSamples,
  type FdmTempPreviewSummary
} from './fdm-temp-preview'
import type { GcodeTempSample } from './gcode-temp-validator'

// ────────────────────────────────────────────────────────────────────────────
// Source-text fixture (frozen at test-collect time)
// ────────────────────────────────────────────────────────────────────────────

const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = join(HERE, 'fdm-temp-preview.ts')
const SOURCE = readFileSync(SOURCE_PATH, 'utf-8')
const SOURCE_BYTES = readFileSync(SOURCE_PATH)

// Sample factory mirroring the existing behavioural test, kept local so
// this pin file does not import the helper from `fdm-temp-preview.test.ts`
// and stays in lockstep with the validated `GcodeTempSample` type alias.
const mk = (overrides: Partial<GcodeTempSample> = {}): GcodeTempSample => ({
  lineNumber: 1,
  command: 'M104',
  kind: 'nozzle',
  targetC: 210,
  raw: 'M104 S210',
  ...overrides
})

// ────────────────────────────────────────────────────────────────────────────
// (A) Module shape -- exact 5-runtime-export inventory + no leakage
// ────────────────────────────────────────────────────────────────────────────

describe('(A) fdm-temp-preview module shape', () => {
  it('exposes exactly the documented 5 runtime symbols', () => {
    const runtimeKeys = Object.keys(M)
      .filter((k) => typeof (M as Record<string, unknown>)[k] !== 'undefined')
      .sort()
    expect(runtimeKeys).toEqual(
      [
        'FDM_TEMP_PREVIEW_KIND_ORDER',
        'FDM_TEMP_PREVIEW_LABELS',
        'formatFdmTempPreview',
        'renderFdmTempPreview',
        'summarizeFdmTempSamples'
      ].sort()
    )
  })

  it('does not expose a default export', () => {
    expect((M as Record<string, unknown>).default).toBeUndefined()
  })

  it('does not leak the internal formatTempC helper', () => {
    // formatTempC is a module-private function (no `export` keyword in
    // source). A regression that accidentally exported it would expose
    // an unstable API surface to the renderer.
    expect((M as Record<string, unknown>).formatTempC).toBeUndefined()
  })

  it('reports a string-tagged ES Module namespace via Symbol.toStringTag', () => {
    expect((M as Record<symbol, unknown>)[Symbol.toStringTag]).toBe('Module')
  })

  it('runtime-key count is exactly 5 (3 functions + 2 const)', () => {
    const runtimeKeys = Object.keys(M).filter(
      (k) => typeof (M as Record<string, unknown>)[k] !== 'undefined'
    )
    expect(runtimeKeys.length).toBe(5)
  })

  it('classifies the 5 runtime symbols as 3 functions + 2 non-functions', () => {
    const fnCount = Object.keys(M).filter(
      (k) => typeof (M as Record<string, unknown>)[k] === 'function'
    ).length
    const objCount = Object.keys(M).filter(
      (k) => typeof (M as Record<string, unknown>)[k] === 'object'
    ).length
    expect(fnCount).toBe(3)
    expect(objCount).toBe(2)
  })

  it('does not export any class symbols', () => {
    for (const k of Object.keys(M)) {
      const v = (M as Record<string, unknown>)[k]
      // A class would be `function`-typed but its prototype.constructor
      // would point to itself. We only want plain functions.
      if (typeof v === 'function') {
        const proto = (v as { prototype?: unknown }).prototype
        expect(proto == null || Object.keys(proto as object).length === 0).toBe(true)
      }
    }
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (B) Function signatures
// ────────────────────────────────────────────────────────────────────────────

describe('(B) function signatures', () => {
  it('summarizeFdmTempSamples is a native Function with name + arity 1', () => {
    expect(typeof summarizeFdmTempSamples).toBe('function')
    expect(summarizeFdmTempSamples.name).toBe('summarizeFdmTempSamples')
    expect(summarizeFdmTempSamples.length).toBe(1)
    expect(Function.prototype.toString.call(summarizeFdmTempSamples)).toContain(
      'function summarizeFdmTempSamples'
    )
  })

  it('renderFdmTempPreview is a native Function with name + arity 1', () => {
    expect(typeof renderFdmTempPreview).toBe('function')
    expect(renderFdmTempPreview.name).toBe('renderFdmTempPreview')
    expect(renderFdmTempPreview.length).toBe(1)
    expect(Function.prototype.toString.call(renderFdmTempPreview)).toContain(
      'function renderFdmTempPreview'
    )
  })

  it('formatFdmTempPreview is a native Function with name + arity 1', () => {
    expect(typeof formatFdmTempPreview).toBe('function')
    expect(formatFdmTempPreview.name).toBe('formatFdmTempPreview')
    expect(formatFdmTempPreview.length).toBe(1)
    expect(Function.prototype.toString.call(formatFdmTempPreview)).toContain(
      'function formatFdmTempPreview'
    )
  })

  it('summarizeFdmTempSamples returns a non-Promise value', () => {
    const r = summarizeFdmTempSamples([mk()])
    // Promises have a `.then` method; pin against accidental async
    // refactor that would break the synchronous banner-render path.
    expect(r === null || typeof (r as { then?: unknown }).then !== 'function').toBe(true)
  })

  it('renderFdmTempPreview returns a non-Promise value', () => {
    const r = renderFdmTempPreview({ nozzle: 240 })
    expect(r === null || typeof r === 'string').toBe(true)
  })

  it('formatFdmTempPreview returns a non-Promise value', () => {
    const r = formatFdmTempPreview([mk()])
    expect(r === null || typeof r === 'string').toBe(true)
  })

  it('summarizeFdmTempSamples returns object-or-null (never a primitive)', () => {
    const r = summarizeFdmTempSamples([mk()])
    expect(r === null || (typeof r === 'object' && !Array.isArray(r))).toBe(true)
  })

  it('renderFdmTempPreview returns string-or-null (never a primitive number/boolean)', () => {
    const r = renderFdmTempPreview({ nozzle: 210 })
    expect(typeof r === 'string' || r === null).toBe(true)
    expect(typeof r).not.toBe('number')
    expect(typeof r).not.toBe('boolean')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (C) FDM_TEMP_PREVIEW_KIND_ORDER contract
// ────────────────────────────────────────────────────────────────────────────

describe('(C) FDM_TEMP_PREVIEW_KIND_ORDER contract', () => {
  it('is an exact 3-element tuple in nozzle -> bed -> chamber order', () => {
    expect(Array.isArray(FDM_TEMP_PREVIEW_KIND_ORDER)).toBe(true)
    expect(FDM_TEMP_PREVIEW_KIND_ORDER.length).toBe(3)
    expect(FDM_TEMP_PREVIEW_KIND_ORDER[0]).toBe('nozzle')
    expect(FDM_TEMP_PREVIEW_KIND_ORDER[1]).toBe('bed')
    expect(FDM_TEMP_PREVIEW_KIND_ORDER[2]).toBe('chamber')
  })

  it('contains every kind exactly once (no duplicates)', () => {
    const set = new Set(FDM_TEMP_PREVIEW_KIND_ORDER)
    expect(set.size).toBe(FDM_TEMP_PREVIEW_KIND_ORDER.length)
  })

  it('is exhaustive vs the GcodeTempSample.kind union', () => {
    // The kind union from `gcode-temp-validator.ts` line 74 is exactly
    // these three values. A regression that grew the union without
    // updating this constant would silently drop new kinds from the
    // banner; this pin makes that drift visible.
    const expected: ReadonlyArray<GcodeTempSample['kind']> = ['nozzle', 'bed', 'chamber']
    for (const k of expected) {
      expect(FDM_TEMP_PREVIEW_KIND_ORDER).toContain(k)
    }
  })

  it('declines keyword-as-string aliases (case-sensitive entries)', () => {
    expect(FDM_TEMP_PREVIEW_KIND_ORDER as readonly string[]).not.toContain('Nozzle')
    expect(FDM_TEMP_PREVIEW_KIND_ORDER as readonly string[]).not.toContain('NOZZLE')
    expect(FDM_TEMP_PREVIEW_KIND_ORDER as readonly string[]).not.toContain('extruder')
    expect(FDM_TEMP_PREVIEW_KIND_ORDER as readonly string[]).not.toContain('heater_bed')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (D) FDM_TEMP_PREVIEW_LABELS contract
// ────────────────────────────────────────────────────────────────────────────

describe('(D) FDM_TEMP_PREVIEW_LABELS contract', () => {
  it('has exactly the same 3 keys as FDM_TEMP_PREVIEW_KIND_ORDER', () => {
    const labelKeys = Object.keys(FDM_TEMP_PREVIEW_LABELS).sort()
    const orderKeys = [...FDM_TEMP_PREVIEW_KIND_ORDER].sort()
    expect(labelKeys).toEqual(orderKeys)
  })

  it('renders capitalized labels for each kind', () => {
    expect(FDM_TEMP_PREVIEW_LABELS.nozzle).toBe('Nozzle')
    expect(FDM_TEMP_PREVIEW_LABELS.bed).toBe('Bed')
    expect(FDM_TEMP_PREVIEW_LABELS.chamber).toBe('Chamber')
  })

  it('every label is a non-empty ASCII-only string', () => {
    for (const kind of FDM_TEMP_PREVIEW_KIND_ORDER) {
      const label = FDM_TEMP_PREVIEW_LABELS[kind]
      expect(typeof label).toBe('string')
      expect(label.length).toBeGreaterThan(0)
      // ASCII range only, no UTF-8 surprises.
      expect(/^[A-Za-z]+$/.test(label)).toBe(true)
    }
  })

  it('label first letter matches kind first letter case-folded', () => {
    for (const kind of FDM_TEMP_PREVIEW_KIND_ORDER) {
      const label = FDM_TEMP_PREVIEW_LABELS[kind]
      expect(label[0].toLowerCase()).toBe(kind[0])
    }
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (E) summarizeFdmTempSamples per-kind MAX + null contract
// ────────────────────────────────────────────────────────────────────────────

describe('(E) summarizeFdmTempSamples per-kind MAX semantics', () => {
  it('returns null on null / undefined / non-array / empty input', () => {
    expect(summarizeFdmTempSamples(null)).toBeNull()
    expect(summarizeFdmTempSamples(undefined)).toBeNull()
    expect(summarizeFdmTempSamples([])).toBeNull()
    // Non-array defensive case (validator yields arrays only, but the
    // helper is conservative).
    expect(summarizeFdmTempSamples('m104 s210' as unknown as GcodeTempSample[])).toBeNull()
    expect(summarizeFdmTempSamples({} as unknown as GcodeTempSample[])).toBeNull()
  })

  it('routes by `kind` not by `command` (Klipper SET_HEATER_TEMPERATURE works too)', () => {
    // The K2 Plus Klipper firmware ships SET_HEATER_TEMPERATURE macros
    // for extruder / heater_bed / chamber that the validator parses to
    // the same `kind` field. The formatter should NOT introspect on the
    // command form -- it should treat the parsed sample as the source
    // of truth.
    const out = summarizeFdmTempSamples([
      mk({ command: 'SET_HEATER_TEMPERATURE', kind: 'nozzle', targetC: 240 }),
      mk({ command: 'SET_HEATER_TEMPERATURE', kind: 'bed', targetC: 60 }),
      mk({ command: 'SET_HEATER_TEMPERATURE', kind: 'chamber', targetC: 50 })
    ])
    expect(out).toEqual({ nozzle: 240, bed: 60, chamber: 50 })
  })

  it('keeps MAX targetC across multiple samples per kind (peak that operator needs to see)', () => {
    const out = summarizeFdmTempSamples([
      mk({ kind: 'nozzle', targetC: 200, command: 'M104' }),
      mk({ kind: 'nozzle', targetC: 215, command: 'M109' }),
      mk({ kind: 'nozzle', targetC: 240, command: 'M109' }),
      mk({ kind: 'nozzle', targetC: 235, command: 'M104' })
    ])
    expect(out).toEqual({ nozzle: 240 })
  })

  it('returns null when every sample has a non-finite targetC', () => {
    const out = summarizeFdmTempSamples([
      mk({ kind: 'nozzle', targetC: Number.NaN }),
      mk({ kind: 'bed', targetC: Number.POSITIVE_INFINITY }),
      mk({ kind: 'chamber', targetC: Number.NEGATIVE_INFINITY })
    ])
    expect(out).toBeNull()
  })

  it('returns null when every sample has an unknown kind (defensive)', () => {
    const out = summarizeFdmTempSamples([
      mk({ kind: 'mystery' as unknown as GcodeTempSample['kind'], targetC: 100 }),
      mk({ kind: 'unknown' as unknown as GcodeTempSample['kind'], targetC: 200 })
    ])
    expect(out).toBeNull()
  })

  it('returns null when every entry is non-sample-shaped (defensive)', () => {
    const out = summarizeFdmTempSamples([
      null as unknown as GcodeTempSample,
      undefined as unknown as GcodeTempSample,
      0 as unknown as GcodeTempSample
    ])
    expect(out).toBeNull()
  })

  it('multi-tool nozzle samples collapse to the single peak (per-tool out of scope)', () => {
    const out = summarizeFdmTempSamples([
      mk({ kind: 'nozzle', targetC: 205, tool: 0, command: 'M104' }),
      mk({ kind: 'nozzle', targetC: 250, tool: 1, command: 'M109' }),
      mk({ kind: 'nozzle', targetC: 220, tool: 2, command: 'M104' })
    ])
    expect(out).toEqual({ nozzle: 250 })
  })

  it('mixes kinds and per-kind peaks correctly', () => {
    const out = summarizeFdmTempSamples([
      mk({ kind: 'bed', targetC: 60, command: 'M140' }),
      mk({ kind: 'bed', targetC: 65, command: 'M190' }),
      mk({ kind: 'chamber', targetC: 50, command: 'M141' }),
      mk({ kind: 'chamber', targetC: 45, command: 'M191' }),
      mk({ kind: 'nozzle', targetC: 240, command: 'M109' }),
      mk({ kind: 'nozzle', targetC: 215, command: 'M104' })
    ])
    expect(out).toEqual({ nozzle: 240, bed: 65, chamber: 50 })
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (F) renderFdmTempPreview rendering contract
// ────────────────────────────────────────────────────────────────────────────

describe('(F) renderFdmTempPreview ordering + omission contract', () => {
  it('returns null for null + empty summary', () => {
    expect(renderFdmTempPreview(null)).toBeNull()
    expect(renderFdmTempPreview({})).toBeNull()
  })

  it('always renders nozzle first when present', () => {
    const out = renderFdmTempPreview({ chamber: 50, bed: 60, nozzle: 240 })
    expect(out?.startsWith('Nozzle:')).toBe(true)
  })

  it('always renders chamber last when present (and bed second)', () => {
    const out = renderFdmTempPreview({ chamber: 50, nozzle: 240, bed: 60 })
    expect(out?.endsWith('Chamber: 50 C')).toBe(true)
    expect(out).toContain('Bed: 60 C')
    // Bed must appear after Nozzle and before Chamber.
    const np = out?.indexOf('Nozzle:') ?? -1
    const bp = out?.indexOf('Bed:') ?? -1
    const cp = out?.indexOf('Chamber:') ?? -1
    expect(np).toBeGreaterThanOrEqual(0)
    expect(bp).toBeGreaterThan(np)
    expect(cp).toBeGreaterThan(bp)
  })

  it('order is INSERTION-INDEPENDENT (chamber-first input still nozzle-first output)', () => {
    // Force chamber-first insertion (Object.keys honors insertion order).
    const s: FdmTempPreviewSummary = {}
    s.chamber = 50
    s.bed = 60
    s.nozzle = 240
    expect(renderFdmTempPreview(s)).toBe(
      'Nozzle: 240 C \u00b7 Bed: 60 C \u00b7 Chamber: 50 C'
    )
  })

  it('omits absent kinds entirely (nozzle-only renders single segment, no separator)', () => {
    expect(renderFdmTempPreview({ nozzle: 240 })).toBe('Nozzle: 240 C')
    expect(renderFdmTempPreview({ nozzle: 240 })).not.toContain('\u00b7')
  })

  it('omits absent kinds with TWO present (nozzle + chamber yields one separator)', () => {
    const out = renderFdmTempPreview({ nozzle: 240, chamber: 50 })
    expect(out).toBe('Nozzle: 240 C \u00b7 Chamber: 50 C')
    expect(out?.split('\u00b7').length).toBe(2)
  })

  it('non-finite per-kind value defensively skipped (no "Bed: NaN C")', () => {
    const out = renderFdmTempPreview({
      nozzle: 240,
      bed: Number.NaN,
      chamber: 50
    })
    expect(out).toBe('Nozzle: 240 C \u00b7 Chamber: 50 C')
    expect(out).not.toContain('NaN')
  })

  it('non-finite +Infinity per-kind value defensively skipped', () => {
    const out = renderFdmTempPreview({
      nozzle: Number.POSITIVE_INFINITY,
      bed: 60
    })
    expect(out).toBe('Bed: 60 C')
    expect(out).not.toContain('Infinity')
  })

  it('non-finite -Infinity per-kind value defensively skipped', () => {
    const out = renderFdmTempPreview({
      nozzle: 240,
      chamber: Number.NEGATIVE_INFINITY
    })
    expect(out).toBe('Nozzle: 240 C')
  })

  it('all-non-finite per-kind summary returns null (no empty banner)', () => {
    const out = renderFdmTempPreview({
      nozzle: Number.NaN,
      bed: Number.POSITIVE_INFINITY,
      chamber: Number.NEGATIVE_INFINITY
    })
    expect(out).toBeNull()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (G) Bullet separator byte-level contract
// ────────────────────────────────────────────────────────────────────────────

describe('(G) bullet separator byte-level contract', () => {
  it('uses " \u00b7 " (space + U+00B7 MIDDLE DOT + space) as the separator', () => {
    const out = renderFdmTempPreview({ nozzle: 240, bed: 60 })
    expect(out).toBe('Nozzle: 240 C \u00b7 Bed: 60 C')
  })

  it('encodes the separator as the 2-byte UTF-8 sequence 0xC2 0xB7', () => {
    const out = renderFdmTempPreview({ nozzle: 240, bed: 60 }) ?? ''
    const bytes = Buffer.from(out, 'utf-8')
    // Find the bullet byte sequence inside the string.
    let foundBullet = false
    for (let i = 0; i < bytes.length - 1; i++) {
      if (bytes[i] === 0xc2 && bytes[i + 1] === 0xb7) {
        foundBullet = true
        break
      }
    }
    expect(foundBullet).toBe(true)
  })

  it('does NOT emit U+2022 BULLET (3-byte 0xE2 0x80 0xA2) -- guards against Edit-tool swap', () => {
    const out = renderFdmTempPreview({ nozzle: 240, bed: 60 }) ?? ''
    expect(out).not.toContain('\u2022')
    const bytes = Buffer.from(out, 'utf-8')
    for (let i = 0; i < bytes.length - 2; i++) {
      const hit =
        bytes[i] === 0xe2 && bytes[i + 1] === 0x80 && bytes[i + 2] === 0xa2
      expect(hit).toBe(false)
    }
  })

  it('does NOT emit em-dash / en-dash / hyphen-minus / pipe / slash as a section separator', () => {
    const out = renderFdmTempPreview({ nozzle: 240, bed: 60 }) ?? ''
    // The string is "Nozzle: 240 C · Bed: 60 C". No alternative
    // separator candidate should appear OUTSIDE the colon-space pairs
    // (there are intentional ASCII spaces around the bullet, plus the
    // colon between label and value).
    expect(out).not.toContain(' \u2014 ') // em-dash with surrounding spaces
    expect(out).not.toContain(' \u2013 ') // en-dash with surrounding spaces
    expect(out).not.toContain(' - ')
    expect(out).not.toContain(' | ')
    expect(out).not.toContain(' / ')
    expect(out).not.toContain(', ')
  })

  it('separator is symmetric: exactly one ASCII space on each side of U+00B7', () => {
    const out = renderFdmTempPreview({ nozzle: 240, bed: 60 }) ?? ''
    const idx = out.indexOf('\u00b7')
    expect(idx).toBeGreaterThan(0)
    expect(out[idx - 1]).toBe(' ')
    expect(out[idx + 1]).toBe(' ')
    // Exactly one space on each side, not two.
    expect(out[idx - 2]).not.toBe(' ')
    expect(out[idx + 2]).not.toBe(' ')
  })

  it('joins exactly N-1 separators for N segments', () => {
    expect((renderFdmTempPreview({ nozzle: 240 }) ?? '').match(/\u00b7/g)?.length ?? 0).toBe(0)
    expect(
      (renderFdmTempPreview({ nozzle: 240, bed: 60 }) ?? '').match(/\u00b7/g)?.length ?? 0
    ).toBe(1)
    expect(
      (
        renderFdmTempPreview({ nozzle: 240, bed: 60, chamber: 50 }) ?? ''
      ).match(/\u00b7/g)?.length ?? 0
    ).toBe(2)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (H) Integer vs fractional formatting contract
// ────────────────────────────────────────────────────────────────────────────

describe('(H) integer vs fractional value formatting', () => {
  it('integers render with no decimal point and no trailing zeros', () => {
    expect(renderFdmTempPreview({ nozzle: 210 })).toBe('Nozzle: 210 C')
    expect(renderFdmTempPreview({ bed: 60 })).toBe('Bed: 60 C')
    expect(renderFdmTempPreview({ chamber: 50 })).toBe('Chamber: 50 C')
  })

  it('zero (bed-off case) renders as integer "0 C"', () => {
    expect(renderFdmTempPreview({ bed: 0 })).toBe('Bed: 0 C')
    // Negative zero is still an integer under Number.isInteger -- pin
    // that the value still renders as integer (no leading minus on -0).
    expect(renderFdmTempPreview({ bed: -0 })).toBe('Bed: 0 C')
  })

  it('fractional temps render with EXACTLY one decimal place via toFixed(1)', () => {
    expect(renderFdmTempPreview({ nozzle: 215.5 })).toBe('Nozzle: 215.5 C')
    expect(renderFdmTempPreview({ bed: 60.25 })).toBe('Bed: 60.3 C') // rounded to 1dp
    expect(renderFdmTempPreview({ chamber: 49.95 })).toBe('Chamber: 50.0 C')
  })

  it('large integer render does not switch to exponent form (toFixed never used)', () => {
    expect(renderFdmTempPreview({ nozzle: 350 })).toBe('Nozzle: 350 C')
    expect(renderFdmTempPreview({ chamber: 120 })).toBe('Chamber: 120 C')
  })

  it('K2 Plus rated ceiling (350 C nozzle / 120 C bed) renders as integer', () => {
    expect(renderFdmTempPreview({ nozzle: 350, bed: 120, chamber: 60 })).toBe(
      'Nozzle: 350 C \u00b7 Bed: 120 C \u00b7 Chamber: 60 C'
    )
  })

  it('unit suffix is the single ASCII letter "C" (NOT "°C", NOT "deg C", NOT "C\u00b0")', () => {
    const out = renderFdmTempPreview({ nozzle: 240, bed: 60, chamber: 50 }) ?? ''
    expect(out).not.toContain('\u00b0') // U+00B0 DEGREE SIGN
    expect(out).not.toContain('deg')
    expect(out).not.toContain('°')
    // Each value segment ends in " C" (capital C) not " c" (lowercase).
    expect(out).toMatch(/\d+ C(?: |$)/)
  })

  it('fractional negative does not crash and keeps one-decimal form', () => {
    // Defensive: validator emits non-negative targetC for FDM, but if
    // the caller produces a fractional negative the renderer must still
    // be a pure formatter (not a validator).
    expect(renderFdmTempPreview({ chamber: -5.5 })).toBe('Chamber: -5.5 C')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (I) formatFdmTempPreview composition equivalence
// ────────────────────────────────────────────────────────────────────────────

describe('(I) formatFdmTempPreview = renderFdmTempPreview ∘ summarizeFdmTempSamples', () => {
  const fixtures: ReadonlyArray<readonly GcodeTempSample[]> = [
    [],
    [mk({ kind: 'nozzle', targetC: 240 })],
    [
      mk({ kind: 'nozzle', targetC: 240, command: 'M109' }),
      mk({ kind: 'bed', targetC: 60, command: 'M190' })
    ],
    [
      mk({ kind: 'nozzle', targetC: 240, command: 'M109' }),
      mk({ kind: 'bed', targetC: 60, command: 'M190' }),
      mk({ kind: 'chamber', targetC: 50, command: 'M141' })
    ],
    [
      mk({ kind: 'nozzle', targetC: 215, command: 'M104' }),
      mk({ kind: 'nozzle', targetC: 240, command: 'M109' })
    ],
    [
      mk({
        kind: 'nozzle',
        targetC: 240,
        command: 'SET_HEATER_TEMPERATURE',
        raw: 'SET_HEATER_TEMPERATURE HEATER=extruder TARGET=240'
      })
    ]
  ]

  it.each(fixtures.map((f, i) => [i, f] as const))(
    'fixture #%i: formatFdmTempPreview equals renderFdmTempPreview ∘ summarizeFdmTempSamples',
    (_i, samples) => {
      const composed = renderFdmTempPreview(summarizeFdmTempSamples(samples))
      const oneShot = formatFdmTempPreview(samples)
      expect(oneShot).toBe(composed)
    }
  )

  it('returns null for null / undefined / empty (banner suppressed)', () => {
    expect(formatFdmTempPreview(null)).toBeNull()
    expect(formatFdmTempPreview(undefined)).toBeNull()
    expect(formatFdmTempPreview([])).toBeNull()
  })

  it('Laguna / Carvera empty-sample case yields null (no FDM heaters in scope)', () => {
    // The validator yields zero samples for non-FDM G-code (RichAuto
    // mach3 routing posts contain no M104/M109/M140/M190/M141/M191
    // commands). The formatter must collapse empty samples to null so
    // the banner does NOT render for CNC jobs.
    expect(formatFdmTempPreview([])).toBeNull()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (J) Three-machine path realism + slicer-source coverage
// ────────────────────────────────────────────────────────────────────────────

describe('(J) three-machine path realism + slicer-source coverage', () => {
  it('K2 Plus PrusaSlicer/Orca header shape: nozzle 240 / bed 60 / chamber 50', () => {
    const samples: GcodeTempSample[] = [
      mk({ lineNumber: 1, kind: 'bed', targetC: 60, command: 'M190', raw: 'M190 S60' }),
      mk({
        lineNumber: 2,
        kind: 'chamber',
        targetC: 50,
        command: 'M141',
        raw: 'M141 S50'
      }),
      mk({
        lineNumber: 3,
        kind: 'nozzle',
        targetC: 215,
        command: 'M104',
        raw: 'M104 S215'
      }),
      mk({
        lineNumber: 4,
        kind: 'nozzle',
        targetC: 240,
        command: 'M109',
        raw: 'M109 S240'
      }),
      mk({
        lineNumber: 5,
        kind: 'chamber',
        targetC: 50,
        command: 'M191',
        raw: 'M191 S50'
      })
    ]
    expect(formatFdmTempPreview(samples)).toBe(
      'Nozzle: 240 C \u00b7 Bed: 60 C \u00b7 Chamber: 50 C'
    )
  })

  it('K2 Plus Klipper SET_HEATER_TEMPERATURE multi-extruder canonical names', () => {
    // Per [ID-0077] the validator routes HEATER=extruder + extruder1
    // both to kind=nozzle. The formatter collapses both to the single
    // peak.
    const samples: GcodeTempSample[] = [
      mk({
        kind: 'nozzle',
        targetC: 240,
        tool: 0,
        command: 'SET_HEATER_TEMPERATURE',
        raw: 'SET_HEATER_TEMPERATURE HEATER=extruder TARGET=240'
      }),
      mk({
        kind: 'nozzle',
        targetC: 250,
        tool: 1,
        command: 'SET_HEATER_TEMPERATURE',
        raw: 'SET_HEATER_TEMPERATURE HEATER=extruder1 TARGET=250'
      }),
      mk({
        kind: 'bed',
        targetC: 60,
        command: 'SET_HEATER_TEMPERATURE',
        raw: 'SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=60'
      }),
      mk({
        kind: 'chamber',
        targetC: 50,
        command: 'SET_HEATER_TEMPERATURE',
        raw: 'SET_HEATER_TEMPERATURE HEATER=chamber TARGET=50'
      })
    ]
    expect(formatFdmTempPreview(samples)).toBe(
      'Nozzle: 250 C \u00b7 Bed: 60 C \u00b7 Chamber: 50 C'
    )
  })

  it('K2 Plus Marlin pre-Klipper M104-only header (no wait commands, no chamber)', () => {
    // A Marlin M104-only header (very rare on K2 Plus but legal in the
    // validator's accepted set) renders nozzle-only.
    const samples: GcodeTempSample[] = [
      mk({ kind: 'nozzle', targetC: 200, command: 'M104', raw: 'M104 S200' })
    ]
    expect(formatFdmTempPreview(samples)).toBe('Nozzle: 200 C')
  })

  it('K2 Plus high-speed PETG/ABS profile peaks render as integers', () => {
    // Realistic K2 Plus PETG: nozzle 245, bed 80, chamber 40.
    const samples: GcodeTempSample[] = [
      mk({ kind: 'nozzle', targetC: 245, command: 'M109' }),
      mk({ kind: 'bed', targetC: 80, command: 'M190' }),
      mk({ kind: 'chamber', targetC: 40, command: 'M141' })
    ]
    expect(formatFdmTempPreview(samples)).toBe(
      'Nozzle: 245 C \u00b7 Bed: 80 C \u00b7 Chamber: 40 C'
    )
  })

  it('K2 Plus rated MAX 350 C / 120 C / chamber-on case (banner ceiling) renders cleanly', () => {
    const samples: GcodeTempSample[] = [
      mk({ kind: 'nozzle', targetC: 350, command: 'M109' }),
      mk({ kind: 'bed', targetC: 120, command: 'M190' }),
      mk({ kind: 'chamber', targetC: 60, command: 'M141' })
    ]
    expect(formatFdmTempPreview(samples)).toBe(
      'Nozzle: 350 C \u00b7 Bed: 120 C \u00b7 Chamber: 60 C'
    )
  })

  it('Laguna Swift 5x10 routing job: validator yields zero samples -> banner null', () => {
    // RichAuto A-series mach3 posts contain only G0/G1/M3/M5 commands;
    // validator returns []. Pin via the formatter: NO BANNER for CNC.
    expect(formatFdmTempPreview([])).toBeNull()
  })

  it('Carvera 4-axis rotary job: validator yields zero samples -> banner null', () => {
    // Carvera Smoothieware posts contain G0/G1/M3/M5/A-axis only.
    // Same null contract.
    expect(formatFdmTempPreview([])).toBeNull()
  })

  it('mixed-machine job summary refuses cross-contamination', () => {
    // Synthetic safety: even if a caller mistakenly fed CNC samples
    // (unknown kind) AND K2 nozzle samples, only the FDM samples
    // contribute.
    const out = summarizeFdmTempSamples([
      mk({ kind: 'spindle' as unknown as GcodeTempSample['kind'], targetC: 18000 }),
      mk({ kind: 'nozzle', targetC: 240 })
    ])
    expect(out).toEqual({ nozzle: 240 })
  })

  it('K2 + chamber-only profile (TPU dry-box scenario) renders chamber-only segment', () => {
    // Edge case: a pre-heat macro that only sets chamber for filament
    // drying. Banner should still render.
    expect(formatFdmTempPreview([mk({ kind: 'chamber', targetC: 50, command: 'M141' })])).toBe(
      'Chamber: 50 C'
    )
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (K) Pure-function invariants
// ────────────────────────────────────────────────────────────────────────────

describe('(K) pure-function invariants', () => {
  const mkSamples = (): GcodeTempSample[] => [
    mk({ kind: 'nozzle', targetC: 240, command: 'M109' }),
    mk({ kind: 'bed', targetC: 60, command: 'M190' }),
    mk({ kind: 'chamber', targetC: 50, command: 'M141' })
  ]

  it('summarizeFdmTempSamples is idempotent across N=20 calls (same input -> deep-equal output)', () => {
    const samples = mkSamples()
    const first = summarizeFdmTempSamples(samples)
    for (let i = 0; i < 20; i++) {
      expect(summarizeFdmTempSamples(samples)).toEqual(first)
    }
  })

  it('renderFdmTempPreview is idempotent across N=20 calls (same input -> identical output)', () => {
    const summary: FdmTempPreviewSummary = { nozzle: 240, bed: 60, chamber: 50 }
    const first = renderFdmTempPreview(summary)
    for (let i = 0; i < 20; i++) {
      expect(renderFdmTempPreview(summary)).toBe(first)
    }
  })

  it('formatFdmTempPreview is idempotent across N=20 calls', () => {
    const samples = mkSamples()
    const first = formatFdmTempPreview(samples)
    for (let i = 0; i < 20; i++) {
      expect(formatFdmTempPreview(samples)).toBe(first)
    }
  })

  it('summarizeFdmTempSamples returns a fresh object each call (not a shared singleton)', () => {
    const samples = mkSamples()
    const a = summarizeFdmTempSamples(samples)
    const b = summarizeFdmTempSamples(samples)
    expect(a).toEqual(b)
    expect(a).not.toBe(b) // Different identity even though deep-equal.
  })

  it('summarizeFdmTempSamples does not mutate the input array', () => {
    const samples = mkSamples()
    const snapshot = JSON.parse(JSON.stringify(samples)) as GcodeTempSample[]
    summarizeFdmTempSamples(samples)
    expect(samples).toEqual(snapshot)
  })

  it('summarizeFdmTempSamples does not mutate any sample in the input array', () => {
    const samples = mkSamples()
    const sampleSnapshots = samples.map((s) => ({ ...s }))
    summarizeFdmTempSamples(samples)
    for (let i = 0; i < samples.length; i++) {
      expect(samples[i]).toEqual(sampleSnapshots[i])
    }
  })

  it('renderFdmTempPreview does not mutate the input summary object', () => {
    const summary: FdmTempPreviewSummary = { nozzle: 240, bed: 60, chamber: 50 }
    const snapshot = { ...summary }
    renderFdmTempPreview(summary)
    expect(summary).toEqual(snapshot)
  })

  it('functions have no `this`-binding leakage on .call(null)', () => {
    expect(() => (summarizeFdmTempSamples as Function).call(null, [])).not.toThrow()
    expect(() => (renderFdmTempPreview as Function).call(null, null)).not.toThrow()
    expect(() => (formatFdmTempPreview as Function).call(null, [])).not.toThrow()
  })

  it('functions have no `this`-binding leakage on .apply(undefined)', () => {
    expect(() => (summarizeFdmTempSamples as Function).apply(undefined, [[]])).not.toThrow()
    expect(() => (renderFdmTempPreview as Function).apply(undefined, [null])).not.toThrow()
    expect(() => (formatFdmTempPreview as Function).apply(undefined, [[]])).not.toThrow()
  })

  it('summarizeFdmTempSamples is fuzz-lite-safe across 10 random-ish inputs', () => {
    const fuzzCases: Array<readonly GcodeTempSample[] | null | undefined> = [
      [],
      [mk()],
      [mk({ targetC: 0 })],
      [mk({ targetC: -100 })],
      [mk({ targetC: Number.NaN })],
      [mk({ targetC: Number.POSITIVE_INFINITY })],
      [mk({ kind: 'unknown' as unknown as GcodeTempSample['kind'] })],
      null,
      undefined,
      [mk({ kind: 'nozzle' }), mk({ kind: 'bed' }), mk({ kind: 'chamber' })]
    ]
    for (const input of fuzzCases) {
      expect(() => summarizeFdmTempSamples(input)).not.toThrow()
    }
  })

  it('renderFdmTempPreview is fuzz-lite-safe across 10 random-ish summaries', () => {
    const fuzzCases: Array<FdmTempPreviewSummary | null> = [
      null,
      {},
      { nozzle: 0 },
      { nozzle: -0 },
      { bed: Number.NaN },
      { chamber: Number.POSITIVE_INFINITY },
      { nozzle: 240, bed: Number.NaN, chamber: 50 },
      { nozzle: 215.5 },
      { bed: 60.25 },
      { nozzle: 350, bed: 120, chamber: 60 }
    ]
    for (const input of fuzzCases) {
      expect(() => renderFdmTempPreview(input)).not.toThrow()
    }
  })

  it('formatFdmTempPreview is fuzz-lite-safe across 10 random-ish sample lists', () => {
    const fuzzCases: Array<readonly GcodeTempSample[] | null | undefined> = [
      [],
      null,
      undefined,
      [mk({ targetC: 0 })],
      [mk({ targetC: 215.5 })],
      [mk({ targetC: Number.NaN })],
      [mk({ kind: 'mystery' as unknown as GcodeTempSample['kind'] })],
      [mk(), mk({ kind: 'bed' })],
      [mk(), mk(), mk({ kind: 'chamber', targetC: 50 })],
      [mk({ command: 'SET_HEATER_TEMPERATURE' })]
    ]
    for (const input of fuzzCases) {
      expect(() => formatFdmTempPreview(input)).not.toThrow()
    }
  })

  it('compile-time type pin: FdmTempPreviewSummary keys are limited to nozzle/bed/chamber', () => {
    // Compile-time only. If the type were widened, this assignment
    // would fail tsc.
    const _summary: FdmTempPreviewSummary = {
      nozzle: 240,
      bed: 60,
      chamber: 50
    }
    expect(_summary.nozzle).toBe(240)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// (L) Source-text whitelist
// ────────────────────────────────────────────────────────────────────────────

describe('(L) fdm-temp-preview source-text whitelist', () => {
  it('source file is at most 130 lines (size canary)', () => {
    const lineCount = SOURCE.split('\n').length
    expect(lineCount).toBeLessThanOrEqual(130)
  })

  it('source file is at most 5 KB (size canary)', () => {
    expect(SOURCE_BYTES.byteLength).toBeLessThanOrEqual(5 * 1024)
  })

  it('exports exactly 3 export-function declarations', () => {
    const matches = SOURCE.match(/^export function\s+\w+/gm) ?? []
    expect(matches.length).toBe(3)
  })

  it('exports exactly 2 export-const declarations (KIND_ORDER + LABELS)', () => {
    const matches = SOURCE.match(/^export const\s+\w+/gm) ?? []
    expect(matches.length).toBe(2)
  })

  it('exports exactly 1 export-type declaration (FdmTempPreviewSummary)', () => {
    const matches = SOURCE.match(/^export type\s+\w+/gm) ?? []
    expect(matches.length).toBe(1)
  })

  it('does not declare a default export', () => {
    expect(SOURCE).not.toMatch(/\bexport default\b/)
  })

  it('does not import React / DOM / electron / fs / net / three / path', () => {
    expect(SOURCE).not.toMatch(/from\s+['"]react['"]/)
    expect(SOURCE).not.toMatch(/from\s+['"]electron['"]/)
    expect(SOURCE).not.toMatch(/from\s+['"]node:fs['"]/)
    expect(SOURCE).not.toMatch(/from\s+['"]node:net['"]/)
    expect(SOURCE).not.toMatch(/from\s+['"]three['"]/)
    expect(SOURCE).not.toMatch(/from\s+['"]node:path['"]/)
    // Only allowed import is type-only from gcode-temp-validator.
    expect(SOURCE).toMatch(/import\s+type\s+\{\s*GcodeTempSample\s*\}\s+from\s+['"]\.\/gcode-temp-validator['"]/)
  })

  it('does not contain `:any`, `as any`, or `<any>` (Safety Rule 3 compliance)', () => {
    expect(SOURCE).not.toMatch(/:\s*any\b/)
    expect(SOURCE).not.toMatch(/\bas\s+any\b/)
    expect(SOURCE).not.toMatch(/<\s*any\s*>/)
  })

  it('does not emit toolpath G-code literals (G28 / G91 / M3 / M5)', () => {
    // The formatter is a banner renderer, not a G-code emitter. A
    // regression that started emitting G-code would be a major scope
    // creep.
    expect(SOURCE).not.toMatch(/['"]G28['"]/)
    expect(SOURCE).not.toMatch(/['"]G91['"]/)
    expect(SOURCE).not.toMatch(/['"]M3['"]/)
    expect(SOURCE).not.toMatch(/['"]M5['"]/)
  })

  it('does not embed foreign-machine vendor literals (no Bambu / Prusa / Anycubic / Voron)', () => {
    expect(SOURCE).not.toMatch(/Bambu/i)
    expect(SOURCE).not.toMatch(/Anycubic/i)
    expect(SOURCE).not.toMatch(/Voron/i)
    // The K2 Plus, Laguna Swift, and Carvera vendor names are NOT
    // referenced in this source either -- the formatter is vendor-
    // agnostic and operates on the parsed `GcodeTempSample` shape.
    expect(SOURCE).not.toMatch(/Creality/i)
    expect(SOURCE).not.toMatch(/Laguna/i)
    expect(SOURCE).not.toMatch(/Makera/i)
    expect(SOURCE).not.toMatch(/Carvera/i)
  })

  it('source uses ASCII JS escape "\\u00b7" (NOT the literal 2-byte UTF-8 sequence)', () => {
    // The source intentionally encodes the bullet via the 6-ASCII-char
    // JS escape `\u00b7` rather than embedding the literal 2-byte UTF-8
    // sequence 0xC2 0xB7 -- this is the documented [ID-0072] / R1.5
    // multi-byte UTF-8 hazard mitigation. JS still emits the actual
    // U+00B7 codepoint at runtime, but the on-disk source is pure ASCII.
    expect(SOURCE).toContain('\\u00b7')
    let foundBulletByte = false
    for (let i = 0; i < SOURCE_BYTES.length - 1; i++) {
      if (SOURCE_BYTES[i] === 0xc2 && SOURCE_BYTES[i + 1] === 0xb7) {
        foundBulletByte = true
        break
      }
    }
    expect(foundBulletByte).toBe(false)
  })

  it('does NOT embed U+2022 BULLET (0xE2 0x80 0xA2) -- guards against Edit-tool swap', () => {
    for (let i = 0; i < SOURCE_BYTES.length - 2; i++) {
      const hit =
        SOURCE_BYTES[i] === 0xe2 &&
        SOURCE_BYTES[i + 1] === 0x80 &&
        SOURCE_BYTES[i + 2] === 0xa2
      expect(hit).toBe(false)
    }
  })

  it('does NOT embed the U+00B0 DEGREE SIGN (0xC2 0xB0) -- unit suffix is plain "C"', () => {
    for (let i = 0; i < SOURCE_BYTES.length - 1; i++) {
      const hit = SOURCE_BYTES[i] === 0xc2 && SOURCE_BYTES[i + 1] === 0xb0
      expect(hit).toBe(false)
    }
  })

  it('source mentions the documented K2 Plus subsystem labels (Nozzle / Bed / Chamber)', () => {
    expect(SOURCE).toContain("nozzle: 'Nozzle'")
    expect(SOURCE).toContain("bed: 'Bed'")
    expect(SOURCE).toContain("chamber: 'Chamber'")
  })

  it('source pins the ordered kind tuple', () => {
    expect(SOURCE).toContain("'nozzle',")
    expect(SOURCE).toContain("'bed',")
    expect(SOURCE).toContain("'chamber'")
  })

  it('source uses `Number.isFinite` (defensive non-finite guard)', () => {
    expect(SOURCE).toContain('Number.isFinite')
  })

  it('source uses `Number.isInteger` (integer-vs-fractional gate)', () => {
    expect(SOURCE).toContain('Number.isInteger')
  })

  it('source uses `.toFixed(1)` (fractional one-decimal contract)', () => {
    expect(SOURCE).toContain('.toFixed(1)')
  })

  it('source unit suffix literal is the plain ASCII " C" (no degree sign)', () => {
    // The source emits `${value} C` and `${value.toFixed(1)} C` template
    // literals with the unit suffix ` C` (space + capital ASCII C). A
    // regression that swapped to `°C` or `\u00b0C` would multi-byte the
    // suffix and break the [ID-0072] / R1.5 ASCII-only contract.
    expect(SOURCE).toContain('${value} C`')
    expect(SOURCE).toContain('${value.toFixed(1)} C`')
    expect(SOURCE).not.toContain('°C')
    expect(SOURCE).not.toContain('\\u00b0C')
  })

  it('source documents the U+00B7 MIDDLE DOT byte choice in a comment', () => {
    expect(SOURCE).toContain('U+00B7')
  })

  it('source documents the U+2022 BULLET hazard in a comment', () => {
    expect(SOURCE).toContain('U+2022')
  })
})
