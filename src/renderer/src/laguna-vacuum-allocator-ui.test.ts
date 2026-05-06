/**
 * Tests for `laguna-vacuum-allocator-ui` -- Cycle 100 ui-polish [ID-0020].
 *
 * Pinned contract surface (paired-pin: each helper has both a positive
 * and a negative-path test, plus regression-style invariants that link
 * the helper to the underlying `LagunaVacuumZoneAllocation`).
 *
 * Strategy: run the shared `allocateLagunaVacuumZonesForSheet` to get
 * REAL allocations for the three planforms (full / half / quarter), then
 * verify the renderer-side helpers produce the byte-stable strings and
 * 0..1 unit-square coordinates that the React surface depends on.
 */
import { describe, expect, it } from 'vitest'
import {
  LAGUNA_VACUUM_ZONES,
  LAGUNA_VACUUM_ZONE_COLUMNS,
  LAGUNA_VACUUM_ZONE_COUNT,
  LAGUNA_VACUUM_ZONE_ROWS,
  allocateLagunaVacuumZones,
  allocateLagunaVacuumZonesForSheet,
  type LagunaVacuumZoneAllocation,
  type LagunaVacuumZoneOverlap
} from '../../shared/laguna-vacuum-allocator'
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

const FULL_SHEET = allocateLagunaVacuumZonesForSheet('full-sheet-48x96')
const HALF_SHEET = allocateLagunaVacuumZonesForSheet('half-sheet-48x48')
const QUARTER_SHEET = allocateLagunaVacuumZonesForSheet('quarter-sheet-24x48')

if (FULL_SHEET === null || HALF_SHEET === null || QUARTER_SHEET === null) {
  throw new Error('test setup: planform lookups must not return null')
}

const FULL_ALLOC: LagunaVacuumZoneAllocation = FULL_SHEET.allocation
const HALF_ALLOC: LagunaVacuumZoneAllocation = HALF_SHEET.allocation
const QUARTER_ALLOC: LagunaVacuumZoneAllocation = QUARTER_SHEET.allocation

describe('laguna-vacuum-allocator-ui -- pinned status string constants', () => {
  it('LAGUNA_VACUUM_ZONE_TILE_STATUS_ENGAGED is the literal "engaged"', () => {
    expect(LAGUNA_VACUUM_ZONE_TILE_STATUS_ENGAGED).toBe('engaged')
  })

  it('LAGUNA_VACUUM_ZONE_TILE_STATUS_IDLE is the literal "idle"', () => {
    expect(LAGUNA_VACUUM_ZONE_TILE_STATUS_IDLE).toBe('idle')
  })

  it('panel noun is "zones" and panel verb is "engaged"', () => {
    expect(LAGUNA_VACUUM_PANEL_NOUN).toBe('zones')
    expect(LAGUNA_VACUUM_PANEL_VERB).toBe('engaged')
  })

  it('outside-envelope banner mentions "off the bed" and "in-bounds"', () => {
    expect(LAGUNA_OUTSIDE_ENVELOPE_BANNER).toMatch(/off the bed/)
    expect(LAGUNA_OUTSIDE_ENVELOPE_BANNER).toMatch(/in-bounds/)
  })
})

describe('lagunaZoneUnitSquareLayout', () => {
  const layout = lagunaZoneUnitSquareLayout()

  it('returns one cell per registry zone, preserving registry order', () => {
    expect(layout).toHaveLength(LAGUNA_VACUUM_ZONES.length)
    for (let i = 0; i < layout.length; i += 1) {
      expect(layout[i].id).toBe(LAGUNA_VACUUM_ZONES[i].id)
      expect(layout[i].column).toBe(LAGUNA_VACUUM_ZONES[i].column)
      expect(layout[i].row).toBe(LAGUNA_VACUUM_ZONES[i].row)
    }
  })

  it('width is 1/columns and height is 1/rows for every cell', () => {
    const expectedWidth = 1 / LAGUNA_VACUUM_ZONE_COLUMNS
    const expectedHeight = 1 / LAGUNA_VACUUM_ZONE_ROWS
    for (const cell of layout) {
      expect(cell.widthUnit).toBeCloseTo(expectedWidth, 12)
      expect(cell.heightUnit).toBeCloseTo(expectedHeight, 12)
    }
  })

  it('xUnit + widthUnit and yUnit + heightUnit each fit within [0, 1]', () => {
    for (const cell of layout) {
      expect(cell.xUnit).toBeGreaterThanOrEqual(0)
      expect(cell.yUnit).toBeGreaterThanOrEqual(0)
      expect(cell.xUnit + cell.widthUnit).toBeLessThanOrEqual(1 + 1e-12)
      expect(cell.yUnit + cell.heightUnit).toBeLessThanOrEqual(1 + 1e-12)
    }
  })

  it('Y is FLIPPED so machine row 0 lands at the BOTTOM of the SVG (yUnit highest)', () => {
    const row0Cells = layout.filter((c) => c.row === 0)
    const row2Cells = layout.filter((c) => c.row === 2)
    expect(row0Cells).toHaveLength(2)
    expect(row2Cells).toHaveLength(2)
    // Row 0 (machine-back) -> bottom of SVG -> yUnit ~ 2/3
    for (const c of row0Cells) expect(c.yUnit).toBeCloseTo(2 / 3, 9)
    // Row 2 (machine-front) -> top of SVG -> yUnit ~ 0
    for (const c of row2Cells) expect(c.yUnit).toBeCloseTo(0, 9)
  })

  it('column 0 cells land at xUnit = 0 and column 1 cells land at xUnit = 1/2', () => {
    for (const cell of layout) {
      if (cell.column === 0) expect(cell.xUnit).toBeCloseTo(0, 12)
      else expect(cell.xUnit).toBeCloseTo(0.5, 12)
    }
  })

  it('the six tiles cover the unit square exactly with zero gaps and zero overlap', () => {
    let totalArea = 0
    for (const cell of layout) totalArea += cell.widthUnit * cell.heightUnit
    expect(totalArea).toBeCloseTo(1, 12)
  })
})

describe('formatLagunaZoneTileLabel', () => {
  it('returns "100%" for a fully-covered zone', () => {
    const fullyCovered: LagunaVacuumZoneOverlap = {
      id: 'X0Y0',
      engaged: true,
      overlapAreaMm2: 762 * 1016,
      zoneCoverageFraction: 1
    }
    expect(formatLagunaZoneTileLabel(fullyCovered)).toBe('100%')
  })

  it('returns "50%" for a half-covered engaged zone', () => {
    const half: LagunaVacuumZoneOverlap = {
      id: 'X0Y1',
      engaged: true,
      overlapAreaMm2: 0,
      zoneCoverageFraction: 0.5
    }
    expect(formatLagunaZoneTileLabel(half)).toBe('50%')
  })

  it('returns the em-dash glyph for an idle zone', () => {
    const idle: LagunaVacuumZoneOverlap = {
      id: 'X1Y2',
      engaged: false,
      overlapAreaMm2: 0,
      zoneCoverageFraction: 0
    }
    expect(formatLagunaZoneTileLabel(idle)).toBe('—')
  })

  it('floors engaged-but-near-zero coverage to "1%" so SR users never hear "engaged at 0%"', () => {
    const tiny: LagunaVacuumZoneOverlap = {
      id: 'X1Y0',
      engaged: true,
      overlapAreaMm2: 1,
      zoneCoverageFraction: 1e-6
    }
    expect(formatLagunaZoneTileLabel(tiny)).toBe('1%')
  })

  it('caps coverage at "100%" when the fraction exceeds 1 (defensive)', () => {
    const over: LagunaVacuumZoneOverlap = {
      id: 'X0Y0',
      engaged: true,
      overlapAreaMm2: 0,
      zoneCoverageFraction: 1.5
    }
    expect(formatLagunaZoneTileLabel(over)).toBe('100%')
  })

  it('treats NaN coverage on an engaged zone as "1%" (defensive)', () => {
    const nanCover: LagunaVacuumZoneOverlap = {
      id: 'X0Y0',
      engaged: true,
      overlapAreaMm2: 0,
      zoneCoverageFraction: NaN
    }
    expect(formatLagunaZoneTileLabel(nanCover)).toBe('1%')
  })
})

describe('formatLagunaZoneTileTitle', () => {
  it('engaged zone shows "engage" + percent of zone covered', () => {
    const zone = LAGUNA_VACUUM_ZONES[0] // X0Y0 back-left
    const overlap = FULL_ALLOC.zones[0]
    const title = formatLagunaZoneTileTitle(zone, overlap)
    expect(title).toContain('Zone X0/Y0 (back-left)')
    expect(title).toContain('engage')
    expect(title).toMatch(/\d+% of zone covered/)
  })

  it('idle zone shows "leave idle" instead of "engage"', () => {
    const zone = LAGUNA_VACUUM_ZONES[2] // X0Y2 back-right
    const overlap = HALF_ALLOC.zones[2]
    expect(overlap.engaged).toBe(false)
    const title = formatLagunaZoneTileTitle(zone, overlap)
    expect(title).toContain('leave idle')
    expect(title).not.toContain('-- engage (')
  })
})

describe('formatLagunaZoneTileAriaLabel', () => {
  it('engaged zone aria label includes id, corner, action, percent', () => {
    const zone = LAGUNA_VACUUM_ZONES[0] // X0Y0 back-left
    const overlap = FULL_ALLOC.zones[0]
    const aria = formatLagunaZoneTileAriaLabel(zone, overlap)
    expect(aria).toContain('Vacuum zone X0Y0')
    expect(aria).toContain('back-left')
    expect(aria).toContain('engage')
    expect(aria).toMatch(/\d+ percent of zone covered/)
  })

  it('idle zone aria label says "leave idle, no stock above zone"', () => {
    const zone = LAGUNA_VACUUM_ZONES[2] // X0Y2 back-right
    const overlap = HALF_ALLOC.zones[2]
    expect(overlap.engaged).toBe(false)
    const aria = formatLagunaZoneTileAriaLabel(zone, overlap)
    expect(aria).toContain('Vacuum zone X0Y2')
    expect(aria).toContain('back-right')
    expect(aria).toContain('leave idle')
    expect(aria).toContain('no stock above zone')
  })

  it('engaged-zone aria label never contains a literal "%" character (SR users hear "percent")', () => {
    const zone = LAGUNA_VACUUM_ZONES[0]
    const overlap = FULL_ALLOC.zones[0]
    const aria = formatLagunaZoneTileAriaLabel(zone, overlap)
    expect(aria).not.toContain('%')
  })
})

describe('formatLagunaVacuumPanelHeadline', () => {
  it('full sheet -> "6 of 6 zones engaged"', () => {
    expect(formatLagunaVacuumPanelHeadline(FULL_ALLOC)).toBe('6 of 6 zones engaged')
  })

  it('half sheet -> "4 of 6 zones engaged"', () => {
    expect(formatLagunaVacuumPanelHeadline(HALF_ALLOC)).toBe('4 of 6 zones engaged')
  })

  it('quarter sheet -> "2 of 6 zones engaged"', () => {
    expect(formatLagunaVacuumPanelHeadline(QUARTER_ALLOC)).toBe('2 of 6 zones engaged')
  })

  it('handles zero-engagement allocations defensively', () => {
    const empty = allocateLagunaVacuumZones(0, 0, 0, 0)
    expect(formatLagunaVacuumPanelHeadline(empty)).toBe('0 of 6 zones engaged')
  })

  it('clamps engagedCount to [0, LAGUNA_VACUUM_ZONE_COUNT] (defensive)', () => {
    // Hand-crafted allocation with bogus engagedCount
    const bogus: LagunaVacuumZoneAllocation = {
      ...FULL_ALLOC,
      engagedCount: 999
    }
    expect(formatLagunaVacuumPanelHeadline(bogus)).toBe('6 of 6 zones engaged')
    const negBogus: LagunaVacuumZoneAllocation = {
      ...FULL_ALLOC,
      engagedCount: -5
    }
    expect(formatLagunaVacuumPanelHeadline(negBogus)).toBe('0 of 6 zones engaged')
  })

  it('treats NaN engagedCount as 0', () => {
    const nanAlloc: LagunaVacuumZoneAllocation = {
      ...FULL_ALLOC,
      engagedCount: NaN
    }
    expect(formatLagunaVacuumPanelHeadline(nanAlloc)).toBe('0 of 6 zones engaged')
  })
})

describe('formatLagunaBedCoverageSummary', () => {
  it('full sheet (1219.2 x 2438.4) -> ~64% of bed covered', () => {
    // 1219.2 * 2438.4 = 2972908.8 mm^2; bed = 1524 * 3048 = 4645152.0; ratio = 0.64 exact
    const text = formatLagunaBedCoverageSummary(FULL_ALLOC)
    expect(text).toBe('64% of bed covered')
  })

  it('half sheet (1219.2 x 1219.2) -> ~32% of bed covered', () => {
    // 1219.2 * 1219.2 = 1486454.4 mm^2 / 4645152 = 0.32 exact
    const text = formatLagunaBedCoverageSummary(HALF_ALLOC)
    expect(text).toBe('32% of bed covered')
  })

  it('quarter sheet (609.6 x 1219.2) -> ~16% of bed covered', () => {
    // 609.6 * 1219.2 = 743227.2 mm^2 / 4645152 = 0.16 exact
    const text = formatLagunaBedCoverageSummary(QUARTER_ALLOC)
    expect(text).toBe('16% of bed covered')
  })

  it('renders a 1-decimal value when the rounded result is non-integer', () => {
    // Construct an allocation with bedCoverageFraction ~ 0.533 (53.3%)
    const alloc: LagunaVacuumZoneAllocation = {
      ...FULL_ALLOC,
      bedCoverageFraction: 0.533
    }
    expect(formatLagunaBedCoverageSummary(alloc)).toBe('53.3% of bed covered')
  })

  it('treats NaN bedCoverageFraction as 0%', () => {
    const alloc: LagunaVacuumZoneAllocation = {
      ...FULL_ALLOC,
      bedCoverageFraction: NaN
    }
    expect(formatLagunaBedCoverageSummary(alloc)).toBe('0% of bed covered')
  })

  it('clamps fractions > 1 to 100% (defensive)', () => {
    const alloc: LagunaVacuumZoneAllocation = {
      ...FULL_ALLOC,
      bedCoverageFraction: 1.7
    }
    expect(formatLagunaBedCoverageSummary(alloc)).toBe('100% of bed covered')
  })

  it('clamps negative fractions to 0% (defensive)', () => {
    const alloc: LagunaVacuumZoneAllocation = {
      ...FULL_ALLOC,
      bedCoverageFraction: -0.1
    }
    expect(formatLagunaBedCoverageSummary(alloc)).toBe('0% of bed covered')
  })
})

describe('formatLagunaOutsideEnvelopeWarning', () => {
  it('returns null when stock fits within the envelope', () => {
    expect(formatLagunaOutsideEnvelopeWarning(FULL_ALLOC)).toBeNull()
    expect(formatLagunaOutsideEnvelopeWarning(HALF_ALLOC)).toBeNull()
    expect(formatLagunaOutsideEnvelopeWarning(QUARTER_ALLOC)).toBeNull()
  })

  it('returns the banner string when stock hangs off the bed', () => {
    // Place a sheet at origin (0,0) but oversized: 2000 x 4000 mm overruns
    const oversize = allocateLagunaVacuumZones(0, 0, 2000, 4000)
    expect(oversize.outsideEnvelope).toBe(true)
    expect(formatLagunaOutsideEnvelopeWarning(oversize)).toBe(LAGUNA_OUTSIDE_ENVELOPE_BANNER)
  })
})

describe('formatLagunaEngagedZoneList', () => {
  it('full sheet -> all six zone ids in registry order', () => {
    expect(formatLagunaEngagedZoneList(FULL_ALLOC)).toBe(
      'X0Y0, X0Y1, X0Y2, X1Y0, X1Y1, X1Y2'
    )
  })

  it('half sheet at default origin -> first four zones in registry order', () => {
    // 48x48 in = 1219.2 x 1219.2 mm; only X0Y0, X0Y1, X1Y0, X1Y1 have positive overlap
    expect(formatLagunaEngagedZoneList(HALF_ALLOC)).toBe('X0Y0, X0Y1, X1Y0, X1Y1')
  })

  it('quarter sheet at default origin -> column 0 only (X0Y0, X0Y1)', () => {
    // 24x48 in = 609.6 x 1219.2 mm; column 0 only
    expect(formatLagunaEngagedZoneList(QUARTER_ALLOC)).toBe('X0Y0, X0Y1')
  })

  it('zero-engagement allocation -> "(none)"', () => {
    const empty = allocateLagunaVacuumZones(0, 0, 0, 0)
    expect(formatLagunaEngagedZoneList(empty)).toBe('(none)')
  })
})

describe('formatLagunaOperatorClipboard', () => {
  it('full sheet clipboard contains headline, engage list, bed coverage; omits idle line', () => {
    const text = formatLagunaOperatorClipboard(FULL_ALLOC)
    const lines = text.split('\n')
    expect(lines[0]).toBe('Laguna Swift 5x10 vacuum panel -- 6 of 6 zones engaged')
    expect(lines[1]).toBe('Engage: X0Y0, X0Y1, X0Y2, X1Y0, X1Y1, X1Y2')
    expect(lines[2]).toBe('Bed coverage: 64%')
    // No "Leave idle" line because every zone is engaged.
    expect(lines.find((l) => l.startsWith('Leave idle:'))).toBeUndefined()
    // No WARNING line because the sheet fits.
    expect(lines.find((l) => l.startsWith('WARNING:'))).toBeUndefined()
    expect(lines).toHaveLength(3)
  })

  it('half sheet clipboard includes a "Leave idle:" line', () => {
    const text = formatLagunaOperatorClipboard(HALF_ALLOC)
    const lines = text.split('\n')
    expect(lines[0]).toBe('Laguna Swift 5x10 vacuum panel -- 4 of 6 zones engaged')
    expect(lines[1]).toBe('Engage: X0Y0, X0Y1, X1Y0, X1Y1')
    expect(lines[2]).toBe('Leave idle: X0Y2, X1Y2')
    expect(lines[3]).toBe('Bed coverage: 32%')
    expect(lines).toHaveLength(4)
  })

  it('quarter sheet clipboard pins exact byte content', () => {
    const text = formatLagunaOperatorClipboard(QUARTER_ALLOC)
    expect(text).toBe(
      [
        'Laguna Swift 5x10 vacuum panel -- 2 of 6 zones engaged',
        'Engage: X0Y0, X0Y1',
        'Leave idle: X0Y2, X1Y0, X1Y1, X1Y2',
        'Bed coverage: 16%'
      ].join('\n')
    )
  })

  it('clipboard appends a WARNING line when stock hangs off the bed', () => {
    const oversize = allocateLagunaVacuumZones(0, 0, 2000, 4000)
    const text = formatLagunaOperatorClipboard(oversize)
    const lines = text.split('\n')
    expect(lines[lines.length - 1]).toBe(`WARNING: ${LAGUNA_OUTSIDE_ENVELOPE_BANNER}`)
  })

  it('zero-engagement allocation -> headline, "(none)", "Leave idle: <all six>", coverage 0%', () => {
    const empty = allocateLagunaVacuumZones(0, 0, 0, 0)
    const text = formatLagunaOperatorClipboard(empty)
    const lines = text.split('\n')
    expect(lines[0]).toBe('Laguna Swift 5x10 vacuum panel -- 0 of 6 zones engaged')
    expect(lines[1]).toBe('Engage: (none)')
    expect(lines[2]).toBe('Leave idle: X0Y0, X0Y1, X0Y2, X1Y0, X1Y1, X1Y2')
    expect(lines[3]).toBe('Bed coverage: 0%')
  })
})

describe('cross-helper invariants', () => {
  it('headline engaged count exactly equals engaged zone list length', () => {
    for (const alloc of [FULL_ALLOC, HALF_ALLOC, QUARTER_ALLOC]) {
      const headline = formatLagunaVacuumPanelHeadline(alloc)
      const m = headline.match(/^(\d+) of 6 zones engaged$/)
      expect(m).not.toBeNull()
      const headlineCount = m === null ? -1 : parseInt(m[1], 10)
      const list = formatLagunaEngagedZoneList(alloc)
      const listCount = list === '(none)' ? 0 : list.split(', ').length
      expect(headlineCount).toBe(listCount)
    }
  })

  it('clipboard headline + engage line + bed coverage line are byte-equal to the per-helper formatters', () => {
    for (const alloc of [FULL_ALLOC, HALF_ALLOC, QUARTER_ALLOC]) {
      const text = formatLagunaOperatorClipboard(alloc)
      const lines = text.split('\n')
      expect(lines[0]).toBe(`Laguna Swift 5x10 vacuum panel -- ${formatLagunaVacuumPanelHeadline(alloc)}`)
      expect(lines[1]).toBe(`Engage: ${formatLagunaEngagedZoneList(alloc)}`)
      const coverageLine = lines.find((l) => l.startsWith('Bed coverage: '))
      expect(coverageLine).toBeDefined()
      // Coverage line strips " of bed covered" suffix.
      expect(coverageLine).toBe(
        `Bed coverage: ${formatLagunaBedCoverageSummary(alloc).replace(' of bed covered', '')}`
      )
    }
  })

  it('the zone-tile aria label percent matches the tile label percent for engaged zones', () => {
    for (let i = 0; i < LAGUNA_VACUUM_ZONES.length; i += 1) {
      const zone = LAGUNA_VACUUM_ZONES[i]
      const overlap = FULL_ALLOC.zones[i]
      if (!overlap.engaged) continue
      const label = formatLagunaZoneTileLabel(overlap) // e.g. "100%"
      const aria = formatLagunaZoneTileAriaLabel(zone, overlap)
      const labelPct = label.replace('%', '')
      expect(aria).toContain(`${labelPct} percent`)
    }
  })

  it('layout cell count and registry zone count are both LAGUNA_VACUUM_ZONE_COUNT', () => {
    expect(LAGUNA_VACUUM_ZONES.length).toBe(LAGUNA_VACUUM_ZONE_COUNT)
    expect(lagunaZoneUnitSquareLayout().length).toBe(LAGUNA_VACUUM_ZONE_COUNT)
  })

  it('layout cells preserve column / row indices identical to the registry', () => {
    const layout = lagunaZoneUnitSquareLayout()
    for (let i = 0; i < LAGUNA_VACUUM_ZONES.length; i += 1) {
      expect(layout[i].column).toBe(LAGUNA_VACUUM_ZONES[i].column)
      expect(layout[i].row).toBe(LAGUNA_VACUUM_ZONES[i].row)
    }
  })
})

describe('JSDoc paired-pin -- module-level contract claims', () => {
  it('the renderer-side helpers do NOT import LAGUNA_SWIFT_WORK_AREA_MM', async () => {
    // Read the file as text and verify the IMPORT BLOCK does not name the bed envelope
    // (a JSDoc mention is fine -- the contract is that the runtime helpers don't depend
    // on the bed envelope, since the unit-square coordinates are dimensionless).
    const fs = await import('fs')
    const path = await import('path')
    const src = fs.readFileSync(
      path.resolve(__dirname, 'laguna-vacuum-allocator-ui.ts'),
      'utf8'
    )
    // Extract the literal import block (lines starting with import / from / closing brace).
    const importBlockMatch = src.match(/import\s*\{[\s\S]*?\}\s*from\s*'[^']+'/g)
    expect(importBlockMatch).not.toBeNull()
    const allImports = (importBlockMatch ?? []).join('\n')
    expect(allImports).not.toContain('LAGUNA_SWIFT_WORK_AREA_MM')
  })

  it('the module emits NO G-code text or post-template tokens (Safety Rule 1)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const src = fs.readFileSync(
      path.resolve(__dirname, 'laguna-vacuum-allocator-ui.ts'),
      'utf8'
    )
    // Common G-code / Handlebars markers absent.
    expect(src).not.toMatch(/\bM\d{2,3}\b/) // M3, M5, M7, M30
    expect(src).not.toMatch(/\bG\d{1,3}\b/) // G0, G17, G21, G54
    expect(src).not.toMatch(/\{\{[^}]*\}\}/) // Handlebars expressions
  })
})
