/**
 * brand-bar-machine-badge-pin.test.ts -- [ID-0210] Cycle 134 ui-polish paired-pin
 *
 * Pins the contract of `src/renderer/src/brand-bar-machine-badge.ts` -- the
 * pure label helpers for the ShopApp brand-bar machine-badge button. Cross-
 * cuts ALL three target machines via the `MachineUIMode` union:
 *   - Creality K2 Plus FDM       -> mode 'fdm'        -> "FDM Printer"
 *   - Laguna Swift 5x10 (3-axis) -> mode 'cnc_2d'/'cnc_3d' -> "CNC Standard" / "CNC 3D"
 *   - Makera Carvera + 4th Axis  -> mode 'cnc_4axis'  -> "CNC 4-Axis"
 *
 * Sister cycles: 119 [ID-0196] derive-features, 124 [ID-0201] viewport3d-bounds,
 * 129 [ID-0206] design-viewport-interaction, 130 [ID-0207] shop-stock-bounds,
 * 131 [ID-0208] command-palette-memory, 132 [ID-0209] post-process-dialects.
 *
 * The existing `brand-bar-machine-badge.test.ts` (207 lines, ~25 it()) exercises
 * the runtime fallback contract and Safety-Rule-2 byte-identical hover-text
 * parity. THIS pin file additionally pins:
 *   (A) module shape -- exact named-export inventory, no incidental leaks,
 *   (B) the two constants `MACHINE_BADGE_NAME_FALLBACK` / `MACHINE_BADGE_TITLE_FALLBACK`
 *       byte-equality + intentional asymmetry between visible badge ("No machine")
 *       and tooltip ("None"),
 *   (C) `formatMachineBadgeLabel` cross-cuts: idempotence, length bounds, no
 *       wrapping decoration, U+2014 / U+2013 absence,
 *   (D) `formatMachineBadgeTitle` cross-cuts: exact prefix / suffix anchor,
 *       em-dash byte position, mode-independence proven via 5-mode it.each,
 *   (E) `formatMachineBadgeAriaLabel` cross-cuts: action-verb partition,
 *       MODE_LABELS-driven mode suffix mapping for ALL 5 modes incl. the
 *       three target machines, no MODE_ICONS glyph leakage,
 *   (F) cross-cutting invariants: pure-function determinism, no DOM access,
 *       no React import, MODE_LABELS dependency only,
 *   (G) source-text whitelist -- header provenance, MODE_LABELS import,
 *       em-dash literal U+2014 byte count, fallback string literals,
 *       no React/DOM imports, no `any` types.
 *
 * ZERO production-code edits. Pure paired-pin (mirrors Cycle 119 / 124 / 129 /
 * 130 / 131 / 132 / 133 chain).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as M from './brand-bar-machine-badge'
import {
  formatMachineBadgeAriaLabel,
  formatMachineBadgeLabel,
  formatMachineBadgeTitle,
  MACHINE_BADGE_NAME_FALLBACK,
  MACHINE_BADGE_TITLE_FALLBACK
} from './brand-bar-machine-badge'
import { MODE_LABELS, type MachineUIMode } from './shop-types'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC_PATH = join(HERE, 'brand-bar-machine-badge.ts')
const SRC = readFileSync(SRC_PATH, 'utf-8')

const ALL_MODES: ReadonlyArray<MachineUIMode> = [
  'fdm',
  'cnc_2d',
  'cnc_3d',
  'cnc_4axis',
  'cnc_5axis'
]

const TARGET_MACHINES: ReadonlyArray<{ name: string; mode: MachineUIMode }> = [
  { name: 'Creality K2 Plus', mode: 'fdm' },
  { name: 'Laguna Swift 5x10', mode: 'cnc_2d' },
  { name: 'Makera Carvera', mode: 'cnc_4axis' }
]

// ---------------------------------------------------------------------------
// (A) Module shape
// ---------------------------------------------------------------------------

describe('[ID-0210] brand-bar-machine-badge module shape', () => {
  it('exports MACHINE_BADGE_NAME_FALLBACK as a string constant', () => {
    expect(Object.prototype.hasOwnProperty.call(M, 'MACHINE_BADGE_NAME_FALLBACK')).toBe(true)
    expect(typeof MACHINE_BADGE_NAME_FALLBACK).toBe('string')
  })

  it('exports MACHINE_BADGE_TITLE_FALLBACK as a string constant', () => {
    expect(Object.prototype.hasOwnProperty.call(M, 'MACHINE_BADGE_TITLE_FALLBACK')).toBe(true)
    expect(typeof MACHINE_BADGE_TITLE_FALLBACK).toBe('string')
  })

  it('exports formatMachineBadgeLabel as a function', () => {
    expect(typeof formatMachineBadgeLabel).toBe('function')
  })

  it('exports formatMachineBadgeTitle as a function', () => {
    expect(typeof formatMachineBadgeTitle).toBe('function')
  })

  it('exports formatMachineBadgeAriaLabel as a function', () => {
    expect(typeof formatMachineBadgeAriaLabel).toBe('function')
  })

  it('exposes exactly the 5 documented runtime exports (no incidental leaks)', () => {
    // Type aliases (MachineBadgeFormatInput) are erased at runtime so they
    // are not enumerable on the namespace object.
    const keys = Object.keys(M).filter((k) => k !== 'default').sort()
    expect(keys).toEqual([
      'MACHINE_BADGE_NAME_FALLBACK',
      'MACHINE_BADGE_TITLE_FALLBACK',
      'formatMachineBadgeAriaLabel',
      'formatMachineBadgeLabel',
      'formatMachineBadgeTitle'
    ])
  })

  it('all three formatter functions accept a single argument by their .length', () => {
    expect(formatMachineBadgeLabel.length).toBe(1)
    expect(formatMachineBadgeTitle.length).toBe(1)
    expect(formatMachineBadgeAriaLabel.length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// (B) Constants byte-equality + asymmetry
// ---------------------------------------------------------------------------

describe('[ID-0210] fallback constants byte-equality', () => {
  it('MACHINE_BADGE_NAME_FALLBACK === "No machine" byte-for-byte', () => {
    expect(MACHINE_BADGE_NAME_FALLBACK).toBe('No machine')
    // Defensive: ensure no trailing whitespace, no zero-width chars, no
    // smart-punctuation drift introduced by an editor auto-fixer.
    expect(MACHINE_BADGE_NAME_FALLBACK.length).toBe('No machine'.length)
    expect(MACHINE_BADGE_NAME_FALLBACK).toMatch(/^[A-Za-z ]+$/)
  })

  it('MACHINE_BADGE_TITLE_FALLBACK === "None" byte-for-byte', () => {
    expect(MACHINE_BADGE_TITLE_FALLBACK).toBe('None')
    expect(MACHINE_BADGE_TITLE_FALLBACK.length).toBe(4)
    expect(MACHINE_BADGE_TITLE_FALLBACK).toMatch(/^[A-Za-z]+$/)
  })

  it('the two fallbacks are intentionally distinct (badge "No machine" vs tooltip "None")', () => {
    // Pinned asymmetry: pre-Cycle-61 ShopApp.tsx used `?? 'No machine'` for
    // the visible button text but `?? 'None'` inside the tooltip template
    // literal. Reuniting them would silently shift the tooltip text and
    // break the Safety Rule 2 byte-identical compatibility promise.
    expect(MACHINE_BADGE_NAME_FALLBACK).not.toBe(MACHINE_BADGE_TITLE_FALLBACK)
  })

  it('neither fallback contains an em-dash, en-dash, or hyphen-minus separator', () => {
    // Separators belong in the templates, not in the fallback names. Drift
    // here would put a stray em-dash in the empty-state badge text.
    for (const c of [MACHINE_BADGE_NAME_FALLBACK, MACHINE_BADGE_TITLE_FALLBACK]) {
      expect(c).not.toContain('—')
      expect(c).not.toContain('–')
      expect(c).not.toContain(' - ')
    }
  })
})

// ---------------------------------------------------------------------------
// (C) formatMachineBadgeLabel cross-cuts beyond existing test
// ---------------------------------------------------------------------------

describe('[ID-0210] formatMachineBadgeLabel cross-cutting invariants', () => {
  it('is idempotent: f(f(name)) === f(name) for all live machine names', () => {
    for (const tm of TARGET_MACHINES) {
      const once = formatMachineBadgeLabel(tm.name)
      const twice = formatMachineBadgeLabel(once)
      expect(twice).toBe(once)
    }
  })

  it('output length never exceeds the input length when input is a string (trim-only)', () => {
    for (const raw of ['Creality K2 Plus', '  Laguna Swift 5x10  ', '\tMakera\t']) {
      const out = formatMachineBadgeLabel(raw)
      expect(out.length).toBeLessThanOrEqual(raw.length)
      // Trim semantics: output never starts/ends with whitespace.
      expect(out).toBe(out.trim())
    }
  })

  it('does NOT wrap the name in quotes, brackets, or markdown', () => {
    const out = formatMachineBadgeLabel('Creality K2 Plus')
    expect(out.startsWith('"')).toBe(false)
    expect(out.startsWith("'")).toBe(false)
    expect(out.startsWith('[')).toBe(false)
    expect(out.startsWith('`')).toBe(false)
    expect(out.startsWith('**')).toBe(false)
  })

  it('returns the SAME-INSTANCE fallback constant on null/undefined/empty (no allocation churn)', () => {
    // All three null-ish branches must hand back the *exported* constant so
    // React reconciliation can short-circuit on referential equality.
    expect(formatMachineBadgeLabel(null)).toBe(MACHINE_BADGE_NAME_FALLBACK)
    expect(formatMachineBadgeLabel(undefined)).toBe(MACHINE_BADGE_NAME_FALLBACK)
    expect(formatMachineBadgeLabel('')).toBe(MACHINE_BADGE_NAME_FALLBACK)
    expect(formatMachineBadgeLabel('   ')).toBe(MACHINE_BADGE_NAME_FALLBACK)
  })

  it.each(TARGET_MACHINES)(
    'preserves the exact display name for target machine %s',
    (tm) => {
      expect(formatMachineBadgeLabel(tm.name)).toBe(tm.name)
    }
  )
})

// ---------------------------------------------------------------------------
// (D) formatMachineBadgeTitle cross-cuts beyond existing test
// ---------------------------------------------------------------------------

describe('[ID-0210] formatMachineBadgeTitle cross-cutting invariants', () => {
  it('every result starts with the exact prefix "Current machine: "', () => {
    for (const tm of TARGET_MACHINES) {
      const out = formatMachineBadgeTitle({ machineName: tm.name, mode: tm.mode })
      expect(out.startsWith('Current machine: ')).toBe(true)
    }
    // Also pin the empty-state branch.
    expect(
      formatMachineBadgeTitle({ machineName: null, mode: 'fdm' }).startsWith('Current machine: ')
    ).toBe(true)
  })

  it('every result ends with the exact suffix "— Click to change"', () => {
    for (const tm of TARGET_MACHINES) {
      const out = formatMachineBadgeTitle({ machineName: tm.name, mode: tm.mode })
      expect(out.endsWith('— Click to change')).toBe(true)
    }
  })

  it('contains exactly one U+2014 EM DASH (the separator)', () => {
    for (const tm of TARGET_MACHINES) {
      const out = formatMachineBadgeTitle({ machineName: tm.name, mode: tm.mode })
      const dashes = out.split('—')
      expect(dashes.length - 1).toBe(1)
    }
  })

  it.each(ALL_MODES)(
    'is mode-invariant: same machine name yields same title across mode %s',
    (mode) => {
      const baseline = formatMachineBadgeTitle({ machineName: 'Anvil', mode: 'fdm' })
      expect(formatMachineBadgeTitle({ machineName: 'Anvil', mode })).toBe(baseline)
    }
  )

  it('embeds the trimmed machine name verbatim between prefix and separator', () => {
    const out = formatMachineBadgeTitle({ machineName: '  Carvera  ', mode: 'cnc_4axis' })
    expect(out).toBe('Current machine: Carvera — Click to change')
  })

  it('uses the TITLE fallback ("None") -- not the BADGE fallback ("No machine") -- on empty', () => {
    const out = formatMachineBadgeTitle({ machineName: '', mode: 'fdm' })
    expect(out).toContain('None ')
    expect(out).not.toContain('No machine')
  })
})

// ---------------------------------------------------------------------------
// (E) formatMachineBadgeAriaLabel cross-cuts beyond existing test
// ---------------------------------------------------------------------------

describe('[ID-0210] formatMachineBadgeAriaLabel cross-cutting invariants', () => {
  it('partitions cleanly by machine-name presence into "Change " / "Set " action verbs', () => {
    for (const tm of TARGET_MACHINES) {
      expect(formatMachineBadgeAriaLabel({ machineName: tm.name, mode: tm.mode })).toMatch(/^Change /)
    }
    for (const mode of ALL_MODES) {
      expect(formatMachineBadgeAriaLabel({ machineName: null, mode })).toMatch(/^Set /)
      expect(formatMachineBadgeAriaLabel({ machineName: undefined, mode })).toMatch(/^Set /)
      expect(formatMachineBadgeAriaLabel({ machineName: '', mode })).toMatch(/^Set /)
      expect(formatMachineBadgeAriaLabel({ machineName: '   ', mode })).toMatch(/^Set /)
    }
  })

  it.each(ALL_MODES)(
    'embeds MODE_LABELS[%s] verbatim in both the with-name and empty-state forms',
    (mode) => {
      const expected = MODE_LABELS[mode]
      const withName = formatMachineBadgeAriaLabel({ machineName: 'm', mode })
      const empty = formatMachineBadgeAriaLabel({ machineName: null, mode })
      // With-name form uses parentheses; empty-state form uses " mode" suffix.
      expect(withName).toContain(`(${expected})`)
      expect(empty).toContain(`${expected} mode`)
    }
  )

  it('emits the canonical strings for every (target machine, mode) tuple', () => {
    expect(
      formatMachineBadgeAriaLabel({ machineName: 'Creality K2 Plus', mode: 'fdm' })
    ).toBe('Change active machine — currently Creality K2 Plus (FDM Printer)')
    expect(
      formatMachineBadgeAriaLabel({ machineName: 'Laguna Swift 5x10', mode: 'cnc_2d' })
    ).toBe('Change active machine — currently Laguna Swift 5x10 (CNC Standard)')
    expect(
      formatMachineBadgeAriaLabel({ machineName: 'Makera Carvera', mode: 'cnc_4axis' })
    ).toBe('Change active machine — currently Makera Carvera (CNC 4-Axis)')
  })

  it('never leaks any MODE_ICONS glyph -- only MODE_LABELS strings', () => {
    // The MODE_ICONS glyphs are decorative (aria-hidden in the rendered span);
    // surfacing them in the aria-label would announce the codepoint name to
    // SR users instead of the human-readable mode label.
    const decorativeGlyphs = ['\u{1F5A8}', '⊞', '⬡', '↻', '✦']
    for (const tm of TARGET_MACHINES) {
      const out = formatMachineBadgeAriaLabel({ machineName: tm.name, mode: tm.mode })
      for (const glyph of decorativeGlyphs) {
        expect(out).not.toContain(glyph)
      }
    }
    for (const mode of ALL_MODES) {
      const out = formatMachineBadgeAriaLabel({ machineName: null, mode })
      for (const glyph of decorativeGlyphs) {
        expect(out).not.toContain(glyph)
      }
    }
  })

  it('contains exactly one U+2014 EM DASH in the with-name form', () => {
    for (const tm of TARGET_MACHINES) {
      const out = formatMachineBadgeAriaLabel({ machineName: tm.name, mode: tm.mode })
      expect(out.split('—').length - 1).toBe(1)
    }
  })

  it('contains exactly one U+2014 EM DASH in the empty-state form', () => {
    for (const mode of ALL_MODES) {
      const out = formatMachineBadgeAriaLabel({ machineName: null, mode })
      expect(out.split('—').length - 1).toBe(1)
    }
  })

  it('trims the machine name verbatim between "currently " and the parenthesised mode', () => {
    const out = formatMachineBadgeAriaLabel({
      machineName: '\t  My Machine  \t',
      mode: 'cnc_3d'
    })
    expect(out).toBe('Change active machine — currently My Machine (CNC 3D)')
  })
})

// ---------------------------------------------------------------------------
// (F) Cross-cutting purity & determinism invariants
// ---------------------------------------------------------------------------

describe('[ID-0210] purity & determinism invariants', () => {
  it('all three formatters are deterministic across N=10 successive calls', () => {
    for (let i = 0; i < 10; i++) {
      expect(formatMachineBadgeLabel('Creality K2 Plus')).toBe('Creality K2 Plus')
      expect(formatMachineBadgeTitle({ machineName: 'Creality K2 Plus', mode: 'fdm' })).toBe(
        'Current machine: Creality K2 Plus — Click to change'
      )
      expect(formatMachineBadgeAriaLabel({ machineName: 'Creality K2 Plus', mode: 'fdm' })).toBe(
        'Change active machine — currently Creality K2 Plus (FDM Printer)'
      )
    }
  })

  it('does not mutate its input record (frozen-input safe)', () => {
    const input = Object.freeze({
      machineName: 'Laguna Swift 5x10',
      mode: 'cnc_2d' as MachineUIMode
    })
    expect(() => formatMachineBadgeTitle(input)).not.toThrow()
    expect(() => formatMachineBadgeAriaLabel(input)).not.toThrow()
    expect(input.machineName).toBe('Laguna Swift 5x10')
    expect(input.mode).toBe('cnc_2d')
  })

  it('does not consult globalThis / window / document during evaluation', () => {
    // Pure function smoke test: temporarily redefine `window` to throw on
    // any property access, then call all three formatters. If any of them
    // touched a DOM global the property-access trap would surface.
    const realWindow = (globalThis as unknown as { window?: unknown }).window
    const realDocument = (globalThis as unknown as { document?: unknown }).document
    const trap = new Proxy({}, {
      get() {
        throw new Error('formatter touched a DOM global')
      }
    })
    try {
      ;(globalThis as unknown as { window: unknown }).window = trap
      ;(globalThis as unknown as { document: unknown }).document = trap
      formatMachineBadgeLabel('K')
      formatMachineBadgeTitle({ machineName: 'K', mode: 'fdm' })
      formatMachineBadgeAriaLabel({ machineName: 'K', mode: 'fdm' })
    } finally {
      ;(globalThis as unknown as { window: unknown }).window = realWindow
      ;(globalThis as unknown as { document: unknown }).document = realDocument
    }
  })
})

// ---------------------------------------------------------------------------
// (G) Source-text whitelist
// ---------------------------------------------------------------------------

describe('[ID-0210] source-text whitelist', () => {
  it('header carries the Cycle 61 ui-polish [ID-0152] provenance', () => {
    expect(SRC).toContain('Cycle 61 ui-polish [ID-0152]')
  })

  it('imports MODE_LABELS and MachineUIMode from ./shop-types', () => {
    expect(SRC).toContain("import { MODE_LABELS, type MachineUIMode } from './shop-types'")
  })

  it('does NOT import from React, ReactDOM, or any ./React surface', () => {
    expect(SRC).not.toMatch(/from ['"]react['"]/)
    expect(SRC).not.toMatch(/from ['"]react-dom['"]/)
  })

  it('does NOT touch DOM globals (window, document, localStorage)', () => {
    expect(SRC).not.toMatch(/\bwindow\./)
    expect(SRC).not.toMatch(/\bdocument\./)
    expect(SRC).not.toMatch(/\blocalStorage\b/)
  })

  it('does NOT import electron or any main-process module', () => {
    expect(SRC).not.toMatch(/from ['"]electron['"]/)
    expect(SRC).not.toMatch(/\.\.\/(?:\.\.\/)?main\//)
  })

  it('declares MACHINE_BADGE_NAME_FALLBACK as the literal "No machine"', () => {
    expect(SRC).toContain("export const MACHINE_BADGE_NAME_FALLBACK = 'No machine'")
  })

  it('declares MACHINE_BADGE_TITLE_FALLBACK as the literal "None"', () => {
    expect(SRC).toContain("export const MACHINE_BADGE_TITLE_FALLBACK = 'None'")
  })

  it('emits the tooltip template literal with U+2014 EM DASH', () => {
    expect(SRC).toContain('`Current machine: ${name} — Click to change`')
  })

  it('emits the aria-label "Change " template literal with U+2014 EM DASH and parenthesised mode', () => {
    expect(SRC).toContain('`Change active machine — currently ${trimmed} (${modeLabel})`')
  })

  it('emits the aria-label "Set " empty-state template literal with U+2014 EM DASH and " mode" suffix', () => {
    expect(SRC).toContain('`Set active machine — ${modeLabel} mode`')
  })

  it('contains exactly three U+2014 EM DASH characters in source (1 tooltip + 2 aria-label templates)', () => {
    // If a future edit drops one of the three or smuggles in a fourth
    // (e.g. a mojibake "—-" double-dash) this gate trips before the
    // visible-string pin tests do.
    const dashes = SRC.split('—')
    expect(dashes.length - 1).toBe(3)
  })

  it('contains zero U+2013 EN DASH characters (separator must be em-dash everywhere)', () => {
    expect(SRC).not.toContain('–')
  })

  it('declares MachineBadgeFormatInput as a `type =` alias (NOT an interface)', () => {
    // The module's type alias is intentionally a structural `type` rather
    // than an `interface` so consumers can pass a plain Pick<...> shape.
    expect(SRC).toContain('export type MachineBadgeFormatInput = {')
    expect(SRC).not.toMatch(/export\s+interface\s+MachineBadgeFormatInput\b/)
  })

  it('declares the input shape with `readonly` modifiers on both fields', () => {
    expect(SRC).toContain('readonly machineName: string | null | undefined')
    expect(SRC).toContain('readonly mode: MachineUIMode')
  })

  it('uses the `?? fallback` style (NOT `||`) for null-coalescing in resolveBadgeName', () => {
    // `||` would falsely treat a non-empty string starting with "0" as
    // missing; the helper relies on explicit type/length checks.
    expect(SRC).not.toMatch(/raw\s*\|\|\s*fallback/)
  })

  it('contains zero `: any` annotations (project-wide rule)', () => {
    expect(SRC).not.toMatch(/:\s*any\b/)
  })

  it('contains the Safety-Rule-2 byte-identical compatibility framing in the JSDoc', () => {
    expect(SRC).toContain('byte-identical compatibility')
  })

  it('contains the docs/EDIT-WORKFLOW.md R1.5 trigger reference (multi-byte UTF-8 character note)', () => {
    expect(SRC).toContain('docs/EDIT-WORKFLOW.md')
    expect(SRC).toContain('R1.5 trigger #1')
  })
})
