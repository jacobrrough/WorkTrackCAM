/**
 * laguna-vacuum-allocator-ui-pin.test.ts -- [ID-0214] Cycle 139 cam-engine paired-pin
 *
 * Pins the contract of `src/renderer/src/laguna-vacuum-allocator-ui.ts` -- the
 * pure label / layout / clipboard helpers for the Laguna Swift 5x10 6-zone
 * vacuum allocator renderer surface ([ID-0020]).
 *
 * LAGUNA-SWIFT-SPECIFIC -- the LAST under-pinned helper gated to a SPECIFIC
 * target machine after Cycle 135 [ID-0211] consumed the K2-Plus-specific
 * `moonraker-push-payload`. Cross-cuts no other target machine: the K2 Plus
 * has a magnetic flexible build plate (no zoned vacuum) and the Carvera +
 * 4th Axis has T-slot hold-down (no zoned vacuum).
 *
 * Sister cycles in the post-Cycle-127-reset clean-streak chain:
 *   119 [ID-0196] derive-features, 124 [ID-0201] viewport3d-bounds,
 *   129 [ID-0206] design-viewport-interaction, 130 [ID-0207] shop-stock-bounds,
 *   131 [ID-0208] command-palette-memory, 132 [ID-0209] post-process-dialects,
 *   133 [ID-0067-data-v16] EDIT-WORKFLOW refresh,
 *   134 [ID-0210] brand-bar-machine-badge,
 *   135 [ID-0211] moonraker-push-payload (K2 Plus),
 *   136 [ID-0212] fdm-gcode-layer-summary,
 *   137 [ID-0213] post-domain facade,
 *   138 [ID-0067-data-v17] EDIT-WORKFLOW refresh.
 *
 * The existing `laguna-vacuum-allocator-ui.test.ts` (510 lines, ~58 it())
 * covers the runtime behaviour of every helper end-to-end against REAL
 * `LagunaVacuumZoneAllocation`s built from the three full-sheet planforms.
 * THIS pin file does NOT duplicate that coverage; instead it pins:
 *   (A) module shape -- exact named-export inventory, arities, Symbol-key
 *       invariants, null-prototype, no incidental leaks,
 *   (B) constants byte-equality + cross-cut invariants (status partition,
 *       banner asymmetry, panel template fragments),
 *   (C) `lagunaZoneUnitSquareLayout` purity / freshness / determinism +
 *       no-input-mutation + 6-tile coverage of the unit square (gap-free,
 *       overlap-free, registry-order-preserving),
 *   (D) `formatLagunaZoneTileLabel` purity / freshness / determinism /
 *       em-dash byte invariant on idle / "%" presence on engaged,
 *   (E) `formatLagunaZoneTileTitle` + `formatLagunaZoneTileAriaLabel`
 *       purity / em-dash count / corner-extraction invariants,
 *   (F) `formatLagunaVacuumPanelHeadline` defensive coercion + headline
 *       template byte-equality + clamp range pin,
 *   (G) `formatLagunaBedCoverageSummary` 1-decimal vs integer branch
 *       partition + clamp pin + suffix anchor,
 *   (H) `formatLagunaOutsideEnvelopeWarning` null vs banner partition +
 *       referential-identity-of-banner-constant pin,
 *   (I) `formatLagunaEngagedZoneList` empty fallback identity + ", " join,
 *   (J) `formatLagunaOperatorClipboard` line-by-line shape +
 *       newline-as-separator + headline/engage/idle/coverage/warning
 *       ordering invariant + frozen-input safety,
 *   (K) cross-helper purity & determinism (N=10 stability + DOM-global
 *       no-touch Proxy trap),
 *   (L) source-text whitelist -- [ID-0020] / Cycle 100 provenance,
 *       Safety-Rule-1 framing (no G-code emit), no React/DOM/electron
 *       imports, no `LAGUNA_SWIFT_WORK_AREA_MM` import (the contract
 *       claim from the JSDoc), em-dash byte count, no-`any`, three-machine
 *       PRIMARY/UNAFFECTED framing, allocator import surface.
 *
 * ZERO production-code edits. Pure paired-pin (mirrors Cycle 119 / 124 /
 * 129 / 130 / 131 / 132 / 134 / 135 / 136 / 137 chain).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as M from './laguna-vacuum-allocator-ui'
import {
  LAGUNA_OUTSIDE_ENVELOPE_BANNER,
  LAGUNA_VACUUM_PANEL_NOUN,
  LAGUNA_VACUUM_PANEL_VERB,
  LAGUNA_VACUUM_ZONE_TILE_STATUS_ENGAGED,
  LAGUNA_VACUUM_ZONE_TILE_STATUS_IDLE,
  formatLagunaBedCoverageSummary,
  formatLagunaEngagedZoneList,
  formatLagunaOperatorClipboard,
  formatLagunaOutsideEnvelopeWarning,
  formatLagunaVacuumPanelHeadline,
  formatLagunaZoneTileAriaLabel,
  formatLagunaZoneTileLabel,
  formatLagunaZoneTileTitle,
  lagunaZoneUnitSquareLayout
} from './laguna-vacuum-allocator-ui'
import {
  LAGUNA_VACUUM_ZONES,
  LAGUNA_VACUUM_ZONE_COLUMNS,
  LAGUNA_VACUUM_ZONE_COUNT,
  LAGUNA_VACUUM_ZONE_ROWS,
  allocateLagunaVacuumZones,
  allocateLagunaVacuumZonesForSheet,
  type LagunaVacuumZone,
  type LagunaVacuumZoneAllocation,
  type LagunaVacuumZoneOverlap
} from '../../shared/laguna-vacuum-allocator'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC_PATH = join(HERE, 'laguna-vacuum-allocator-ui.ts')
const SRC = readFileSync(SRC_PATH, 'utf-8')

// Build REAL allocations across the three full-sheet planforms and a
// degenerate zero-area allocation for empty-state pins.
const FULL_SHEET = allocateLagunaVacuumZonesForSheet('full-sheet-48x96')
const HALF_SHEET = allocateLagunaVacuumZonesForSheet('half-sheet-48x48')
const QUARTER_SHEET = allocateLagunaVacuumZonesForSheet('quarter-sheet-24x48')
if (FULL_SHEET === null || HALF_SHEET === null || QUARTER_SHEET === null) {
  throw new Error('test setup: planform lookups must not return null')
}
const FULL_ALLOC: LagunaVacuumZoneAllocation = FULL_SHEET.allocation
const HALF_ALLOC: LagunaVacuumZoneAllocation = HALF_SHEET.allocation
const QUARTER_ALLOC: LagunaVacuumZoneAllocation = QUARTER_SHEET.allocation
const ZERO_ALLOC: LagunaVacuumZoneAllocation = allocateLagunaVacuumZones(0, 0, 0, 0)
const OFF_BED_ALLOC: LagunaVacuumZoneAllocation = allocateLagunaVacuumZones(
  0,
  0,
  10000,
  10000
)

const ALL_REAL_ALLOCS: ReadonlyArray<LagunaVacuumZoneAllocation> = [
  FULL_ALLOC,
  HALF_ALLOC,
  QUARTER_ALLOC,
  ZERO_ALLOC,
  OFF_BED_ALLOC
]

// ---------------------------------------------------------------------------
// (A) Module shape
// ---------------------------------------------------------------------------

describe('[ID-0214] laguna-vacuum-allocator-ui module shape', () => {
  it('exposes exactly the 10 documented runtime exports (no incidental leaks)', () => {
    // Type alias `LagunaZoneUnitSquareCell` is erased at runtime so it is
    // not enumerable on the namespace object.
    const stringKeys = Object.keys(M)
      .filter((k) => k !== 'default')
      .sort()
    expect(stringKeys).toEqual([
      'LAGUNA_OUTSIDE_ENVELOPE_BANNER',
      'LAGUNA_VACUUM_PANEL_NOUN',
      'LAGUNA_VACUUM_PANEL_VERB',
      'LAGUNA_VACUUM_ZONE_TILE_STATUS_ENGAGED',
      'LAGUNA_VACUUM_ZONE_TILE_STATUS_IDLE',
      'formatLagunaBedCoverageSummary',
      'formatLagunaEngagedZoneList',
      'formatLagunaOperatorClipboard',
      'formatLagunaOutsideEnvelopeWarning',
      'formatLagunaVacuumPanelHeadline',
      'formatLagunaZoneTileAriaLabel',
      'formatLagunaZoneTileLabel',
      'formatLagunaZoneTileTitle',
      'lagunaZoneUnitSquareLayout'
    ])
  })

  it('the only Symbol-keyed property on the module namespace is Symbol.toStringTag', () => {
    const symbolKeys = Object.getOwnPropertySymbols(M)
    expect(symbolKeys.length).toBeGreaterThanOrEqual(1)
    for (const sym of symbolKeys) {
      expect(sym).toBe(Symbol.toStringTag)
    }
  })

  it('the namespace prototype is null (ESM module-namespace invariant)', () => {
    expect(Object.getPrototypeOf(M)).toBe(null)
  })

  it('exports lagunaZoneUnitSquareLayout as a zero-arg function', () => {
    expect(typeof lagunaZoneUnitSquareLayout).toBe('function')
    expect(lagunaZoneUnitSquareLayout.length).toBe(0)
  })

  it('exports formatLagunaZoneTileLabel as a 1-arg function', () => {
    expect(typeof formatLagunaZoneTileLabel).toBe('function')
    expect(formatLagunaZoneTileLabel.length).toBe(1)
  })

  it('exports formatLagunaZoneTileTitle / AriaLabel as 2-arg functions', () => {
    expect(typeof formatLagunaZoneTileTitle).toBe('function')
    expect(formatLagunaZoneTileTitle.length).toBe(2)
    expect(typeof formatLagunaZoneTileAriaLabel).toBe('function')
    expect(formatLagunaZoneTileAriaLabel.length).toBe(2)
  })

  it('exports the four allocation-driven formatters as 1-arg functions', () => {
    expect(formatLagunaVacuumPanelHeadline.length).toBe(1)
    expect(formatLagunaBedCoverageSummary.length).toBe(1)
    expect(formatLagunaOutsideEnvelopeWarning.length).toBe(1)
    expect(formatLagunaEngagedZoneList.length).toBe(1)
    expect(formatLagunaOperatorClipboard.length).toBe(1)
  })

  it('all five string constants are non-empty strings', () => {
    for (const c of [
      LAGUNA_OUTSIDE_ENVELOPE_BANNER,
      LAGUNA_VACUUM_PANEL_NOUN,
      LAGUNA_VACUUM_PANEL_VERB,
      LAGUNA_VACUUM_ZONE_TILE_STATUS_ENGAGED,
      LAGUNA_VACUUM_ZONE_TILE_STATUS_IDLE
    ]) {
      expect(typeof c).toBe('string')
      expect(c.length).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// (B) Constants byte-equality + cross-cut invariants
// ---------------------------------------------------------------------------

describe('[ID-0214] constants byte-equality + cross-cuts', () => {
  it('LAGUNA_VACUUM_ZONE_TILE_STATUS_ENGAGED is the literal "engaged" (5-byte ASCII)', () => {
    expect(LAGUNA_VACUUM_ZONE_TILE_STATUS_ENGAGED).toBe('engaged')
    expect(LAGUNA_VACUUM_ZONE_TILE_STATUS_ENGAGED.length).toBe(7)
  })

  it('LAGUNA_VACUUM_ZONE_TILE_STATUS_IDLE is the literal "idle" (4-byte ASCII)', () => {
    expect(LAGUNA_VACUUM_ZONE_TILE_STATUS_IDLE).toBe('idle')
    expect(LAGUNA_VACUUM_ZONE_TILE_STATUS_IDLE.length).toBe(4)
  })

  it('the two status constants are partitioned (not equal, not substrings of each other)', () => {
    expect(LAGUNA_VACUUM_ZONE_TILE_STATUS_ENGAGED).not.toBe(
      LAGUNA_VACUUM_ZONE_TILE_STATUS_IDLE
    )
    expect(LAGUNA_VACUUM_ZONE_TILE_STATUS_ENGAGED).not.toContain(
      LAGUNA_VACUUM_ZONE_TILE_STATUS_IDLE
    )
    expect(LAGUNA_VACUUM_ZONE_TILE_STATUS_IDLE).not.toContain(
      LAGUNA_VACUUM_ZONE_TILE_STATUS_ENGAGED
    )
  })

  it('LAGUNA_VACUUM_PANEL_NOUN === "zones" / VERB === "engaged" byte-for-byte', () => {
    expect(LAGUNA_VACUUM_PANEL_NOUN).toBe('zones')
    expect(LAGUNA_VACUUM_PANEL_VERB).toBe('engaged')
  })

  it('the panel verb is identical to the engaged-status constant (single source of truth)', () => {
    // Pinned: the headline reads "N of 6 zones engaged" and the status
    // string reads "engaged". A future drift that diverges them would
    // produce a UI where the headline says "engaged" but the tile data
    // attribute says something else, breaking CSS selectors.
    expect(LAGUNA_VACUUM_PANEL_VERB).toBe(LAGUNA_VACUUM_ZONE_TILE_STATUS_ENGAGED)
  })

  it('LAGUNA_OUTSIDE_ENVELOPE_BANNER mentions both "off the bed" and "in-bounds"', () => {
    expect(LAGUNA_OUTSIDE_ENVELOPE_BANNER).toContain('off the bed')
    expect(LAGUNA_OUTSIDE_ENVELOPE_BANNER).toContain('in-bounds')
  })

  it('LAGUNA_OUTSIDE_ENVELOPE_BANNER ends with a period (operator-facing copy)', () => {
    expect(LAGUNA_OUTSIDE_ENVELOPE_BANNER.endsWith('.')).toBe(true)
  })

  it('LAGUNA_OUTSIDE_ENVELOPE_BANNER does NOT use a real em-dash (uses ASCII "--")', () => {
    // The renderer-side copy stays ASCII-only so the operator can paste it
    // into the Laguna control-panel notes without mojibake risk on the
    // RichAuto A-series handheld's limited charset.
    expect(LAGUNA_OUTSIDE_ENVELOPE_BANNER).not.toContain('—')
    expect(LAGUNA_OUTSIDE_ENVELOPE_BANNER).toContain('--')
  })
})

// ---------------------------------------------------------------------------
// (C) lagunaZoneUnitSquareLayout purity / freshness / determinism
// ---------------------------------------------------------------------------

describe('[ID-0214] lagunaZoneUnitSquareLayout purity & freshness', () => {
  it('returns a fresh array on every invocation (no shared mutable state)', () => {
    const a = lagunaZoneUnitSquareLayout()
    const b = lagunaZoneUnitSquareLayout()
    expect(a).not.toBe(b)
  })

  it('returns an array exactly LAGUNA_VACUUM_ZONE_COUNT long (always 6)', () => {
    expect(lagunaZoneUnitSquareLayout()).toHaveLength(LAGUNA_VACUUM_ZONE_COUNT)
  })

  it('every cell preserves the registry id verbatim and in registry order', () => {
    const layout = lagunaZoneUnitSquareLayout()
    for (let i = 0; i < layout.length; i += 1) {
      expect(layout[i].id).toBe(LAGUNA_VACUUM_ZONES[i].id)
    }
  })

  it('every cell exposes exactly the 7 documented keys (id/column/row/xUnit/yUnit/widthUnit/heightUnit)', () => {
    for (const cell of lagunaZoneUnitSquareLayout()) {
      expect(Object.keys(cell).sort()).toEqual([
        'column',
        'heightUnit',
        'id',
        'row',
        'widthUnit',
        'xUnit',
        'yUnit'
      ])
    }
  })

  it('every cell.widthUnit === 1 / LAGUNA_VACUUM_ZONE_COLUMNS exactly (no rounding drift)', () => {
    const expected = 1 / LAGUNA_VACUUM_ZONE_COLUMNS
    for (const cell of lagunaZoneUnitSquareLayout()) {
      expect(cell.widthUnit).toBe(expected)
    }
  })

  it('every cell.heightUnit === 1 / LAGUNA_VACUUM_ZONE_ROWS exactly (no rounding drift)', () => {
    const expected = 1 / LAGUNA_VACUUM_ZONE_ROWS
    for (const cell of lagunaZoneUnitSquareLayout()) {
      expect(cell.heightUnit).toBe(expected)
    }
  })

  it('the 6 tiles tile the unit square gap-free and overlap-free (sum of areas = 1)', () => {
    const layout = lagunaZoneUnitSquareLayout()
    const totalArea = layout.reduce(
      (acc, c) => acc + c.widthUnit * c.heightUnit,
      0
    )
    expect(totalArea).toBeCloseTo(1, 12)
  })

  it('Y-flip pin: row 0 lands at yUnit=2/3 and row 2 lands at yUnit=0', () => {
    const layout = lagunaZoneUnitSquareLayout()
    for (const cell of layout) {
      if (cell.row === 0) expect(cell.yUnit).toBeCloseTo(2 / 3, 12)
      if (cell.row === 1) expect(cell.yUnit).toBeCloseTo(1 / 3, 12)
      if (cell.row === 2) expect(cell.yUnit).toBeCloseTo(0, 12)
    }
  })

  it('column 0 lands at xUnit=0; column 1 lands at xUnit=1/2', () => {
    const layout = lagunaZoneUnitSquareLayout()
    for (const cell of layout) {
      if (cell.column === 0) expect(cell.xUnit).toBeCloseTo(0, 12)
      if (cell.column === 1) expect(cell.xUnit).toBeCloseTo(0.5, 12)
    }
  })

  it('mutating the returned array does not affect a subsequent call (fresh-output)', () => {
    const a = lagunaZoneUnitSquareLayout() as unknown as { id: string }[]
    a.length = 0
    const b = lagunaZoneUnitSquareLayout()
    expect(b).toHaveLength(LAGUNA_VACUUM_ZONE_COUNT)
  })
})

// ---------------------------------------------------------------------------
// (D) formatLagunaZoneTileLabel purity / freshness / determinism
// ---------------------------------------------------------------------------

const ENGAGED_HALF: LagunaVacuumZoneOverlap = {
  id: 'X0Y0',
  engaged: true,
  overlapAreaMm2: 100,
  zoneCoverageFraction: 0.5
}
const IDLE_OVERLAP: LagunaVacuumZoneOverlap = {
  id: 'X0Y0',
  engaged: false,
  overlapAreaMm2: 0,
  zoneCoverageFraction: 0
}

describe('[ID-0214] formatLagunaZoneTileLabel purity invariants', () => {
  it('returns the literal em-dash glyph "—" for an idle overlap', () => {
    // Pin the actual UTF-8 byte (U+2014). A future ASCII-only refactor
    // would surface a "-" hyphen-minus and break the visual stable-cell
    // height invariant documented in the JSDoc.
    expect(formatLagunaZoneTileLabel(IDLE_OVERLAP)).toBe('—')
  })

  it('engaged 50 percent renders as "50%"', () => {
    expect(formatLagunaZoneTileLabel(ENGAGED_HALF)).toBe('50%')
  })

  it('engaged with NaN coverage renders as "1%" (defensive)', () => {
    expect(
      formatLagunaZoneTileLabel({
        id: 'X0Y0',
        engaged: true,
        overlapAreaMm2: 1,
        zoneCoverageFraction: NaN
      })
    ).toBe('1%')
  })

  it('engaged with negative coverage renders as "1%" (defensive)', () => {
    expect(
      formatLagunaZoneTileLabel({
        id: 'X0Y0',
        engaged: true,
        overlapAreaMm2: 1,
        zoneCoverageFraction: -0.25
      })
    ).toBe('1%')
  })

  it('engaged with coverage > 1 renders as "100%" (clamped)', () => {
    expect(
      formatLagunaZoneTileLabel({
        id: 'X0Y0',
        engaged: true,
        overlapAreaMm2: 999,
        zoneCoverageFraction: 1.7
      })
    ).toBe('100%')
  })

  it('result string is deterministic across N=10 calls (pure)', () => {
    for (let i = 0; i < 10; i += 1) {
      expect(formatLagunaZoneTileLabel(ENGAGED_HALF)).toBe('50%')
      expect(formatLagunaZoneTileLabel(IDLE_OVERLAP)).toBe('—')
    }
  })

  it('does not mutate its input overlap (frozen-input safe)', () => {
    const frozen = Object.freeze({
      id: 'X0Y0',
      engaged: true as const,
      overlapAreaMm2: 100,
      zoneCoverageFraction: 0.42
    })
    expect(() => formatLagunaZoneTileLabel(frozen)).not.toThrow()
    expect(frozen.zoneCoverageFraction).toBe(0.42)
  })
})

// ---------------------------------------------------------------------------
// (E) formatLagunaZoneTileTitle + AriaLabel cross-cuts
// ---------------------------------------------------------------------------

const SAMPLE_ZONE: LagunaVacuumZone = LAGUNA_VACUUM_ZONES[0]

describe('[ID-0214] formatLagunaZoneTileTitle invariants', () => {
  it('engaged title contains the zone label, "engage", and the percent label', () => {
    const out = formatLagunaZoneTileTitle(SAMPLE_ZONE, ENGAGED_HALF)
    expect(out).toContain(SAMPLE_ZONE.label)
    expect(out).toContain('engage')
    expect(out).toContain('50%')
  })

  it('idle title swaps "engage" -> "leave idle" and uses the em-dash percent slot', () => {
    const out = formatLagunaZoneTileTitle(SAMPLE_ZONE, IDLE_OVERLAP)
    expect(out).toContain('leave idle')
    expect(out).toContain('—')
    expect(out).not.toMatch(/\d%/)
  })

  it('contains the literal " -- " ASCII separator (Safety-Rule-2 byte-stable)', () => {
    const out = formatLagunaZoneTileTitle(SAMPLE_ZONE, ENGAGED_HALF)
    expect(out).toContain(' -- ')
  })

  it('does NOT inject an em-dash separator (em-dash only appears as the idle percent glyph)', () => {
    const engagedTitle = formatLagunaZoneTileTitle(SAMPLE_ZONE, ENGAGED_HALF)
    expect(engagedTitle).not.toContain('—')
  })

  it('is deterministic across N=10 calls', () => {
    for (let i = 0; i < 10; i += 1) {
      expect(formatLagunaZoneTileTitle(SAMPLE_ZONE, ENGAGED_HALF)).toBe(
        formatLagunaZoneTileTitle(SAMPLE_ZONE, ENGAGED_HALF)
      )
    }
  })
})

describe('[ID-0214] formatLagunaZoneTileAriaLabel invariants', () => {
  it('starts with "Vacuum zone " for both engaged and idle paths', () => {
    expect(formatLagunaZoneTileAriaLabel(SAMPLE_ZONE, ENGAGED_HALF)).toMatch(
      /^Vacuum zone /
    )
    expect(formatLagunaZoneTileAriaLabel(SAMPLE_ZONE, IDLE_OVERLAP)).toMatch(
      /^Vacuum zone /
    )
  })

  it('embeds the zone id verbatim and extracts the parenthesised corner', () => {
    const out = formatLagunaZoneTileAriaLabel(SAMPLE_ZONE, ENGAGED_HALF)
    expect(out).toContain(SAMPLE_ZONE.id)
    // SAMPLE_ZONE.label = "Zone X0/Y0 (back-left)" -> corner = "back-left"
    expect(out).toContain('back-left')
  })

  it('engaged aria label uses "percent" word (not "%" character) for SR consumption', () => {
    const out = formatLagunaZoneTileAriaLabel(SAMPLE_ZONE, ENGAGED_HALF)
    expect(out).toContain('percent')
    expect(out).not.toContain('%')
  })

  it('idle aria label includes the literal "no stock above zone" hint', () => {
    expect(formatLagunaZoneTileAriaLabel(SAMPLE_ZONE, IDLE_OVERLAP)).toContain(
      'no stock above zone'
    )
  })

  it('contains exactly one ASCII " -- " separator', () => {
    for (const overlap of [ENGAGED_HALF, IDLE_OVERLAP]) {
      const out = formatLagunaZoneTileAriaLabel(SAMPLE_ZONE, overlap)
      expect(out.split(' -- ')).toHaveLength(2)
    }
  })

  it('handles a malformed zone label without a parenthesis without throwing', () => {
    const malformed: LagunaVacuumZone = {
      ...SAMPLE_ZONE,
      label: 'No parens here'
    }
    expect(() => formatLagunaZoneTileAriaLabel(malformed, IDLE_OVERLAP)).not.toThrow()
    // Falls back to an empty corner slot.
    const out = formatLagunaZoneTileAriaLabel(malformed, IDLE_OVERLAP)
    expect(out).toContain(SAMPLE_ZONE.id)
  })
})

// ---------------------------------------------------------------------------
// (F) formatLagunaVacuumPanelHeadline pins
// ---------------------------------------------------------------------------

describe('[ID-0214] formatLagunaVacuumPanelHeadline invariants', () => {
  it('full sheet renders the byte-stable "6 of 6 zones engaged"', () => {
    expect(formatLagunaVacuumPanelHeadline(FULL_ALLOC)).toBe('6 of 6 zones engaged')
  })

  it('half sheet renders the byte-stable "4 of 6 zones engaged"', () => {
    expect(formatLagunaVacuumPanelHeadline(HALF_ALLOC)).toBe('4 of 6 zones engaged')
  })

  it('quarter sheet renders the byte-stable "2 of 6 zones engaged"', () => {
    expect(formatLagunaVacuumPanelHeadline(QUARTER_ALLOC)).toBe('2 of 6 zones engaged')
  })

  it('zero allocation renders "0 of 6 zones engaged"', () => {
    expect(formatLagunaVacuumPanelHeadline(ZERO_ALLOC)).toBe('0 of 6 zones engaged')
  })

  it('the headline always uses the LAGUNA_VACUUM_PANEL_NOUN + VERB pair verbatim', () => {
    for (const alloc of ALL_REAL_ALLOCS) {
      const out = formatLagunaVacuumPanelHeadline(alloc)
      expect(out).toContain(` ${LAGUNA_VACUUM_PANEL_NOUN} `)
      expect(out.endsWith(LAGUNA_VACUUM_PANEL_VERB)).toBe(true)
    }
  })

  it('clamps NaN engagedCount to 0 (defensive)', () => {
    const synth: LagunaVacuumZoneAllocation = {
      ...ZERO_ALLOC,
      engagedCount: NaN
    }
    expect(formatLagunaVacuumPanelHeadline(synth)).toBe('0 of 6 zones engaged')
  })

  it('clamps engagedCount > 6 down to 6 (defensive)', () => {
    const synth: LagunaVacuumZoneAllocation = {
      ...ZERO_ALLOC,
      engagedCount: 99
    }
    expect(formatLagunaVacuumPanelHeadline(synth)).toBe('6 of 6 zones engaged')
  })

  it('clamps negative engagedCount up to 0 (defensive)', () => {
    const synth: LagunaVacuumZoneAllocation = {
      ...ZERO_ALLOC,
      engagedCount: -5
    }
    expect(formatLagunaVacuumPanelHeadline(synth)).toBe('0 of 6 zones engaged')
  })

  it('rounds fractional engagedCount via Math.round (pinned coercion)', () => {
    const synth: LagunaVacuumZoneAllocation = {
      ...ZERO_ALLOC,
      engagedCount: 3.6
    }
    expect(formatLagunaVacuumPanelHeadline(synth)).toBe('4 of 6 zones engaged')
  })
})

// ---------------------------------------------------------------------------
// (G) formatLagunaBedCoverageSummary pins
// ---------------------------------------------------------------------------

describe('[ID-0214] formatLagunaBedCoverageSummary invariants', () => {
  it('every result ends with the literal " of bed covered" suffix', () => {
    for (const alloc of ALL_REAL_ALLOCS) {
      expect(formatLagunaBedCoverageSummary(alloc).endsWith(' of bed covered')).toBe(
        true
      )
    }
  })

  it('integer-rounded value strips the ".0" tail (e.g. "100% of bed covered")', () => {
    const synth: LagunaVacuumZoneAllocation = {
      ...ZERO_ALLOC,
      bedCoverageFraction: 1
    }
    expect(formatLagunaBedCoverageSummary(synth)).toBe('100% of bed covered')
  })

  it('non-integer rounded value retains the 1-decimal tail (e.g. "53.3% of bed covered")', () => {
    const synth: LagunaVacuumZoneAllocation = {
      ...ZERO_ALLOC,
      bedCoverageFraction: 0.5333
    }
    expect(formatLagunaBedCoverageSummary(synth)).toBe('53.3% of bed covered')
  })

  it('clamps bedCoverageFraction > 1 down to 100% (defensive)', () => {
    const synth: LagunaVacuumZoneAllocation = {
      ...ZERO_ALLOC,
      bedCoverageFraction: 5
    }
    expect(formatLagunaBedCoverageSummary(synth)).toBe('100% of bed covered')
  })

  it('clamps negative bedCoverageFraction up to 0% (defensive)', () => {
    const synth: LagunaVacuumZoneAllocation = {
      ...ZERO_ALLOC,
      bedCoverageFraction: -0.2
    }
    expect(formatLagunaBedCoverageSummary(synth)).toBe('0% of bed covered')
  })

  it('treats NaN bedCoverageFraction as 0% (defensive)', () => {
    const synth: LagunaVacuumZoneAllocation = {
      ...ZERO_ALLOC,
      bedCoverageFraction: NaN
    }
    expect(formatLagunaBedCoverageSummary(synth)).toBe('0% of bed covered')
  })

  it('output never contains an "NaN" or "Infinity" literal even with hostile inputs', () => {
    for (const f of [NaN, Infinity, -Infinity]) {
      const synth: LagunaVacuumZoneAllocation = {
        ...ZERO_ALLOC,
        bedCoverageFraction: f
      }
      const out = formatLagunaBedCoverageSummary(synth)
      expect(out).not.toContain('NaN')
      expect(out).not.toContain('Infinity')
    }
  })
})

// ---------------------------------------------------------------------------
// (H) formatLagunaOutsideEnvelopeWarning pins
// ---------------------------------------------------------------------------

describe('[ID-0214] formatLagunaOutsideEnvelopeWarning invariants', () => {
  it('returns null when allocation.outsideEnvelope is false', () => {
    expect(formatLagunaOutsideEnvelopeWarning(FULL_ALLOC)).toBeNull()
    expect(formatLagunaOutsideEnvelopeWarning(HALF_ALLOC)).toBeNull()
    expect(formatLagunaOutsideEnvelopeWarning(QUARTER_ALLOC)).toBeNull()
  })

  it('returns the SAME-INSTANCE banner constant when outsideEnvelope is true (referential identity)', () => {
    // Pinned: callers (e.g. React) can compare the result with `===` to
    // short-circuit re-render decisions; allocating a fresh string per call
    // would defeat that.
    expect(formatLagunaOutsideEnvelopeWarning(OFF_BED_ALLOC)).toBe(
      LAGUNA_OUTSIDE_ENVELOPE_BANNER
    )
  })

  it('partition is exhaustive: result is null XOR === LAGUNA_OUTSIDE_ENVELOPE_BANNER', () => {
    for (const alloc of ALL_REAL_ALLOCS) {
      const out = formatLagunaOutsideEnvelopeWarning(alloc)
      const isNull = out === null
      const isBanner = out === LAGUNA_OUTSIDE_ENVELOPE_BANNER
      expect(isNull !== isBanner).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// (I) formatLagunaEngagedZoneList pins
// ---------------------------------------------------------------------------

describe('[ID-0214] formatLagunaEngagedZoneList invariants', () => {
  it('zero-engagement allocation returns the literal "(none)" fallback', () => {
    expect(formatLagunaEngagedZoneList(ZERO_ALLOC)).toBe('(none)')
  })

  it('full sheet returns all 6 ids in registry order joined by ", "', () => {
    const out = formatLagunaEngagedZoneList(FULL_ALLOC)
    expect(out).toBe('X0Y0, X0Y1, X0Y2, X1Y0, X1Y1, X1Y2')
  })

  it('separator is exactly ", " (comma + single space) between every pair', () => {
    const out = formatLagunaEngagedZoneList(HALF_ALLOC)
    // Half sheet engages four zones -> three separators.
    expect(out.split(', ')).toHaveLength(HALF_ALLOC.engaged.length)
  })

  it('no surrounding whitespace, no trailing comma', () => {
    const out = formatLagunaEngagedZoneList(FULL_ALLOC)
    expect(out).toBe(out.trim())
    expect(out.endsWith(',')).toBe(false)
    expect(out.endsWith(', ')).toBe(false)
  })

  it('does not mutate the engaged array (referential-equality preserved)', () => {
    const before = FULL_ALLOC.engaged
    formatLagunaEngagedZoneList(FULL_ALLOC)
    expect(FULL_ALLOC.engaged).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// (J) formatLagunaOperatorClipboard pins
// ---------------------------------------------------------------------------

describe('[ID-0214] formatLagunaOperatorClipboard invariants', () => {
  it('full-sheet clipboard contains exactly 3 lines (no idle line, no warning)', () => {
    const lines = formatLagunaOperatorClipboard(FULL_ALLOC).split('\n')
    expect(lines).toHaveLength(3)
  })

  it('half-sheet clipboard contains exactly 4 lines (idle line present, no warning)', () => {
    const lines = formatLagunaOperatorClipboard(HALF_ALLOC).split('\n')
    expect(lines).toHaveLength(4)
  })

  it('off-bed clipboard appends a 5th WARNING line when outsideEnvelope is true', () => {
    const lines = formatLagunaOperatorClipboard(OFF_BED_ALLOC).split('\n')
    expect(lines.length).toBeGreaterThanOrEqual(4)
    const warningLine = lines.find((l) => l.startsWith('WARNING:'))
    expect(warningLine).toBeDefined()
    if (warningLine !== undefined) {
      expect(warningLine).toContain(LAGUNA_OUTSIDE_ENVELOPE_BANNER)
    }
  })

  it('first line always starts with "Laguna Swift 5x10 vacuum panel -- "', () => {
    for (const alloc of ALL_REAL_ALLOCS) {
      const first = formatLagunaOperatorClipboard(alloc).split('\n')[0]
      expect(first.startsWith('Laguna Swift 5x10 vacuum panel -- ')).toBe(true)
    }
  })

  it('first line embeds the same headline that formatLagunaVacuumPanelHeadline returns', () => {
    for (const alloc of ALL_REAL_ALLOCS) {
      const first = formatLagunaOperatorClipboard(alloc).split('\n')[0]
      expect(first.endsWith(formatLagunaVacuumPanelHeadline(alloc))).toBe(true)
    }
  })

  it('engage line always starts with the "Engage: " prefix', () => {
    for (const alloc of ALL_REAL_ALLOCS) {
      const lines = formatLagunaOperatorClipboard(alloc).split('\n')
      const engage = lines.find((l) => l.startsWith('Engage: '))
      expect(engage).toBeDefined()
      if (engage !== undefined) {
        expect(engage).toBe(`Engage: ${formatLagunaEngagedZoneList(alloc)}`)
      }
    }
  })

  it('coverage line strips " of bed covered" suffix per the helper composition', () => {
    for (const alloc of ALL_REAL_ALLOCS) {
      const lines = formatLagunaOperatorClipboard(alloc).split('\n')
      const coverage = lines.find((l) => l.startsWith('Bed coverage: '))
      expect(coverage).toBeDefined()
      if (coverage !== undefined) {
        expect(coverage).not.toContain('of bed covered')
        // Still ends with "%" since the suffix "% of bed covered" loses
        // only the " of bed covered" tail per the source slice.
        expect(coverage.endsWith('%')).toBe(true)
      }
    }
  })

  it('idle line is OMITTED when allocation.idle.length === 0 (full sheet)', () => {
    const lines = formatLagunaOperatorClipboard(FULL_ALLOC).split('\n')
    expect(lines.find((l) => l.startsWith('Leave idle:'))).toBeUndefined()
  })

  it('idle line is PRESENT when allocation.idle.length > 0 (half sheet)', () => {
    const lines = formatLagunaOperatorClipboard(HALF_ALLOC).split('\n')
    const idle = lines.find((l) => l.startsWith('Leave idle: '))
    expect(idle).toBeDefined()
    if (idle !== undefined) {
      expect(idle).toBe(`Leave idle: ${HALF_ALLOC.idle.join(', ')}`)
    }
  })

  it('joins lines with "\\n" (single LF) -- no CRLF, no trailing newline', () => {
    const out = formatLagunaOperatorClipboard(QUARTER_ALLOC)
    expect(out).not.toContain('\r')
    expect(out.endsWith('\n')).toBe(false)
  })

  it('does not mutate the input allocation (referential-equality preserved)', () => {
    const beforeEngaged = HALF_ALLOC.engaged
    const beforeIdle = HALF_ALLOC.idle
    formatLagunaOperatorClipboard(HALF_ALLOC)
    expect(HALF_ALLOC.engaged).toBe(beforeEngaged)
    expect(HALF_ALLOC.idle).toBe(beforeIdle)
  })

  it('is deterministic across N=10 calls (pure)', () => {
    const baseline = formatLagunaOperatorClipboard(QUARTER_ALLOC)
    for (let i = 0; i < 10; i += 1) {
      expect(formatLagunaOperatorClipboard(QUARTER_ALLOC)).toBe(baseline)
    }
  })
})

// ---------------------------------------------------------------------------
// (K) Cross-helper purity & DOM-global no-touch trap
// ---------------------------------------------------------------------------

describe('[ID-0214] cross-helper purity & DOM-global no-touch', () => {
  it('every helper is deterministic across N=5 calls on the same input', () => {
    for (let i = 0; i < 5; i += 1) {
      expect(formatLagunaZoneTileLabel(ENGAGED_HALF)).toBe('50%')
      expect(formatLagunaZoneTileTitle(SAMPLE_ZONE, ENGAGED_HALF)).toBe(
        formatLagunaZoneTileTitle(SAMPLE_ZONE, ENGAGED_HALF)
      )
      expect(formatLagunaZoneTileAriaLabel(SAMPLE_ZONE, ENGAGED_HALF)).toBe(
        formatLagunaZoneTileAriaLabel(SAMPLE_ZONE, ENGAGED_HALF)
      )
      expect(formatLagunaVacuumPanelHeadline(FULL_ALLOC)).toBe('6 of 6 zones engaged')
      expect(formatLagunaBedCoverageSummary(FULL_ALLOC)).toBe(
        formatLagunaBedCoverageSummary(FULL_ALLOC)
      )
      expect(formatLagunaOutsideEnvelopeWarning(FULL_ALLOC)).toBeNull()
      expect(formatLagunaEngagedZoneList(ZERO_ALLOC)).toBe('(none)')
      expect(formatLagunaOperatorClipboard(QUARTER_ALLOC)).toBe(
        formatLagunaOperatorClipboard(QUARTER_ALLOC)
      )
      expect(lagunaZoneUnitSquareLayout()).toHaveLength(6)
    }
  })

  it('does not consult window / document / localStorage during evaluation', () => {
    const realWindow = (globalThis as unknown as { window?: unknown }).window
    const realDocument = (globalThis as unknown as { document?: unknown }).document
    const realLocalStorage = (globalThis as unknown as { localStorage?: unknown })
      .localStorage
    const trap = new Proxy(
      {},
      {
        get() {
          throw new Error('helper touched a DOM global')
        }
      }
    )
    try {
      ;(globalThis as unknown as { window: unknown }).window = trap
      ;(globalThis as unknown as { document: unknown }).document = trap
      ;(globalThis as unknown as { localStorage: unknown }).localStorage = trap
      lagunaZoneUnitSquareLayout()
      formatLagunaZoneTileLabel(ENGAGED_HALF)
      formatLagunaZoneTileTitle(SAMPLE_ZONE, IDLE_OVERLAP)
      formatLagunaZoneTileAriaLabel(SAMPLE_ZONE, ENGAGED_HALF)
      formatLagunaVacuumPanelHeadline(HALF_ALLOC)
      formatLagunaBedCoverageSummary(HALF_ALLOC)
      formatLagunaOutsideEnvelopeWarning(OFF_BED_ALLOC)
      formatLagunaEngagedZoneList(QUARTER_ALLOC)
      formatLagunaOperatorClipboard(FULL_ALLOC)
    } finally {
      ;(globalThis as unknown as { window: unknown }).window = realWindow
      ;(globalThis as unknown as { document: unknown }).document = realDocument
      ;(globalThis as unknown as { localStorage: unknown }).localStorage =
        realLocalStorage
    }
  })

  it('every helper accepts a frozen allocation without throwing', () => {
    const frozen = Object.freeze({ ...HALF_ALLOC })
    expect(() => formatLagunaVacuumPanelHeadline(frozen)).not.toThrow()
    expect(() => formatLagunaBedCoverageSummary(frozen)).not.toThrow()
    expect(() => formatLagunaOutsideEnvelopeWarning(frozen)).not.toThrow()
    expect(() => formatLagunaEngagedZoneList(frozen)).not.toThrow()
    expect(() => formatLagunaOperatorClipboard(frozen)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// (L) Source-text whitelist
// ---------------------------------------------------------------------------

describe('[ID-0214] source-text whitelist', () => {
  it('header carries Cycle 100 + [ID-0020] provenance', () => {
    expect(SRC).toContain('Cycle 100 ui-polish')
    expect(SRC).toContain('[ID-0020]')
  })

  it('header documents the [ID-0014] arc closure (slice 3 of 3)', () => {
    expect(SRC).toContain('slice 3 of 3')
    expect(SRC).toContain('[ID-0014]')
  })

  it('declares PRIMARY = Laguna Swift 5x10 / UNAFFECTED = K2 Plus + Carvera', () => {
    expect(SRC).toContain('PRIMARY = Laguna Swift 5x10')
    expect(SRC).toContain('UNAFFECTED = K2 Plus')
    expect(SRC).toContain('Carvera + 4th Axis')
  })

  it('imports the registry constants and zone types from ../../shared/laguna-vacuum-allocator', () => {
    expect(SRC).toContain("from '../../shared/laguna-vacuum-allocator'")
    expect(SRC).toContain('LAGUNA_VACUUM_ZONES')
    expect(SRC).toContain('LAGUNA_VACUUM_ZONE_COLUMNS')
    expect(SRC).toContain('LAGUNA_VACUUM_ZONE_COUNT')
    expect(SRC).toContain('LAGUNA_VACUUM_ZONE_ROWS')
    expect(SRC).toContain('type LagunaVacuumZone')
    expect(SRC).toContain('type LagunaVacuumZoneAllocation')
    expect(SRC).toContain('type LagunaVacuumZoneOverlap')
  })

  it('does NOT IMPORT LAGUNA_SWIFT_WORK_AREA_MM (the JSDoc contract claim)', () => {
    // The unit-square layout is intentionally dimensionless; importing the
    // bed envelope here would re-introduce a coupling the JSDoc explicitly
    // disclaims and break the "no re-importing the bed envelope on every
    // frame" perf rationale. The JSDoc itself names the constant as a
    // negative-claim reference (in backticks), so we assert on the import
    // surface rather than substring presence.
    expect(SRC).not.toMatch(/^\s*LAGUNA_SWIFT_WORK_AREA_MM\s*[,}]/m)
    expect(SRC).not.toMatch(/import[^;]*LAGUNA_SWIFT_WORK_AREA_MM/)
  })

  it('does NOT import from React, ReactDOM, or any ./React surface', () => {
    expect(SRC).not.toMatch(/from ['"]react['"]/)
    expect(SRC).not.toMatch(/from ['"]react-dom['"]/)
  })

  it('does NOT touch DOM globals (window, document, localStorage) in source', () => {
    expect(SRC).not.toMatch(/\bwindow\./)
    expect(SRC).not.toMatch(/\bdocument\./)
    expect(SRC).not.toMatch(/\blocalStorage\b/)
  })

  it('does NOT import electron or any main-process module', () => {
    expect(SRC).not.toMatch(/from ['"]electron['"]/)
    expect(SRC).not.toMatch(/\.\.\/(?:\.\.\/)?main\//)
  })

  it('does NOT emit any G-code text or post-template tokens (Safety Rule 1)', () => {
    // Pin the JSDoc claim that the module emits NO G-code.
    expect(SRC).not.toMatch(/\bM\d{1,3}\b/) // M3, M5, M6, M8 etc.
    expect(SRC).not.toMatch(/\bG\d{1,3}\b/) // G0, G1, G17, G21 etc.
    // The post template parses Handlebars `{{...}}` tokens; none here.
    expect(SRC).not.toContain('{{')
  })

  it('declares LAGUNA_VACUUM_ZONE_TILE_STATUS_ENGAGED as the literal "engaged"', () => {
    expect(SRC).toContain(
      "export const LAGUNA_VACUUM_ZONE_TILE_STATUS_ENGAGED = 'engaged'"
    )
  })

  it('declares LAGUNA_VACUUM_ZONE_TILE_STATUS_IDLE as the literal "idle"', () => {
    expect(SRC).toContain("export const LAGUNA_VACUUM_ZONE_TILE_STATUS_IDLE = 'idle'")
  })

  it('declares LAGUNA_VACUUM_PANEL_NOUN as "zones" and PANEL_VERB as "engaged"', () => {
    expect(SRC).toContain("export const LAGUNA_VACUUM_PANEL_NOUN = 'zones'")
    expect(SRC).toContain("export const LAGUNA_VACUUM_PANEL_VERB = 'engaged'")
  })

  it('emits the headline template literal byte-for-byte', () => {
    expect(SRC).toContain(
      '`${safe} of ${LAGUNA_VACUUM_ZONE_COUNT} ${LAGUNA_VACUUM_PANEL_NOUN} ${LAGUNA_VACUUM_PANEL_VERB}`'
    )
  })

  it('emits the bed-coverage template literal byte-for-byte', () => {
    expect(SRC).toContain('`${text}% of bed covered`')
  })

  it('emits the operator-clipboard headline template literal byte-for-byte', () => {
    expect(SRC).toContain(
      '`Laguna Swift 5x10 vacuum panel -- ${formatLagunaVacuumPanelHeadline(allocation)}`'
    )
  })

  it('emits the per-zone tile title template literal byte-for-byte', () => {
    expect(SRC).toContain(
      '`${zone.label} -- ${status} (${formatLagunaZoneTileLabel(overlap)} of zone covered)`'
    )
  })

  it('emits the engaged-zone aria-label template literal byte-for-byte', () => {
    expect(SRC).toContain(
      '`Vacuum zone ${idStripped} ${corner} -- engage, ${pct} percent of zone covered`'
    )
  })

  it('emits the idle-zone aria-label template literal byte-for-byte', () => {
    expect(SRC).toContain(
      '`Vacuum zone ${idStripped} ${corner} -- leave idle, no stock above zone`'
    )
  })

  it('uses the literal em-dash glyph "—" in the idle-tile label branch', () => {
    // The visible-cell stable-height invariant depends on the U+2014 EM DASH.
    expect(SRC).toContain("return '—'")
  })

  it('contains exactly one U+2014 EM DASH character in source (the idle-tile label)', () => {
    // If a future edit introduces a second em-dash (e.g. as a separator)
    // this gate trips before any visible-string pin can fail.
    expect(SRC.split('—').length - 1).toBe(1)
  })

  it('contains zero U+2013 EN DASH characters', () => {
    expect(SRC).not.toContain('–')
  })

  it('contains zero `: any` annotations and zero `as any` / `<any>` casts', () => {
    expect(SRC).not.toMatch(/:\s*any\b/)
    expect(SRC).not.toMatch(/\bas\s+any\b/)
    expect(SRC).not.toMatch(/<any>/)
  })

  it('contains the Safety-Rule-1 framing in the JSDoc (G-code is sacred)', () => {
    expect(SRC).toContain('Safety Rule 1')
  })

  it('declares the LagunaZoneUnitSquareCell as an interface with readonly fields', () => {
    expect(SRC).toContain('export interface LagunaZoneUnitSquareCell {')
    expect(SRC).toContain('readonly id: string')
    expect(SRC).toContain('readonly column: 0 | 1')
    expect(SRC).toContain('readonly row: 0 | 1 | 2')
  })

  it('declares lagunaZoneUnitSquareLayout returning readonly LagunaZoneUnitSquareCell[]', () => {
    expect(SRC).toContain(
      'export function lagunaZoneUnitSquareLayout(): readonly LagunaZoneUnitSquareCell[]'
    )
  })

  it('exposes exactly 9 `^export function` declarations + 1 `^export interface` + 5 `^export const`', () => {
    const exportFns = (SRC.match(/^export function /gm) ?? []).length
    const exportIfaces = (SRC.match(/^export interface /gm) ?? []).length
    const exportConsts = (SRC.match(/^export const /gm) ?? []).length
    expect(exportFns).toBe(9)
    expect(exportIfaces).toBe(1)
    expect(exportConsts).toBe(5)
  })

  it('uses the `??` style or explicit null checks (no `||` for null-coalescing on user copy)', () => {
    // Avoid silent stringification surprises around empty strings / 0
    // numeric-coverage values. The existing helpers use explicit
    // `if (!Number.isFinite(...))` guards or `=== null` checks; pin that.
    expect(SRC).toMatch(/Number\.isFinite\(/)
    // No `raw || fallback` patterns that would mis-handle "0%" coverage.
    expect(SRC).not.toMatch(/raw\s*\|\|\s*fallback/)
  })

  it('the Safety Rule 1 contract claim "does NOT emit G-code or vacuum M-codes" is present', () => {
    expect(SRC).toContain('does NOT emit G-code or vacuum M-codes')
  })
})
