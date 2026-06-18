/**
 * Wave C [ID-0020] tests for the Laguna 6-zone vacuum ALLOCATOR panel.
 *
 * Two layers, matching the established renderer test patterns:
 *   1. PURE helpers (`allocatorZoneNumber`, `engagedZoneNumbers`) — the
 *      column-major registry id → 1..6 zone-number bridge the "Assign" click
 *      writes onto `appSettings.lagunaActiveZones`. Directly invoked (no render)
 *      because `renderToStaticMarkup` cannot fire the click; this pins the exact
 *      numbers the callback would receive (mirrors `computeNextLagunaActiveZones`).
 *   2. RENDER pins (`renderToStaticMarkup`, node env, no jsdom) — the 2×3 zone
 *      map, engaged/idle markup, coverage readout, oversize warning, and the
 *      Assign button's enabled/disabled state per planform.
 *
 * The allocator math itself is covered by laguna-vacuum-allocator.test.ts; these
 * tests pin the UI's faithful reflection of it.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  LagunaVacuumPanel,
  allocatorZoneNumber,
  engagedZoneNumbers
} from './LagunaVacuumPanel'
import {
  LAGUNA_VACUUM_ZONES,
  allocateLagunaVacuumZonesForSheet
} from '../../shared/laguna-vacuum-allocator'

describe('LagunaVacuumPanel — zone-number bridge helpers', () => {
  it('maps the column-major registry ids to stable 1..6 numbers', () => {
    expect(allocatorZoneNumber('X0Y0')).toBe(1)
    expect(allocatorZoneNumber('X0Y1')).toBe(2)
    expect(allocatorZoneNumber('X0Y2')).toBe(3)
    expect(allocatorZoneNumber('X1Y0')).toBe(4)
    expect(allocatorZoneNumber('X1Y1')).toBe(5)
    expect(allocatorZoneNumber('X1Y2')).toBe(6)
  })

  it('every registry zone maps to a distinct 1..6 number (no collisions)', () => {
    const nums = LAGUNA_VACUUM_ZONES.map((z) => allocatorZoneNumber(z.id))
    expect(nums).toEqual([1, 2, 3, 4, 5, 6])
    expect(new Set(nums).size).toBe(6)
  })

  it('returns 0 for an unknown zone id (defensive, never throws)', () => {
    expect(allocatorZoneNumber('X9Y9')).toBe(0)
    expect(allocatorZoneNumber('')).toBe(0)
  })

  it('engagedZoneNumbers sorts, de-dupes, and drops unknown ids', () => {
    expect(engagedZoneNumbers(['X1Y2', 'X0Y0', 'X0Y1'])).toEqual([1, 2, 6])
    expect(engagedZoneNumbers(['X0Y0', 'X0Y0'])).toEqual([1])
    expect(engagedZoneNumbers(['X0Y0', 'bogus'])).toEqual([1])
    expect(engagedZoneNumbers([])).toEqual([])
  })

  it('a full-sheet allocation engages all six zone numbers (the Assign payload)', () => {
    const r = allocateLagunaVacuumZonesForSheet('full-sheet-48x96', { thicknessId: '3-4' })
    expect(r).not.toBeNull()
    expect(engagedZoneNumbers(r!.allocation.engaged)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('a half-sheet allocation engages the four back/mid zones (1,2,4,5)', () => {
    const r = allocateLagunaVacuumZonesForSheet('half-sheet-48x48', { thicknessId: '3-4' })
    expect(engagedZoneNumbers(r!.allocation.engaged)).toEqual([1, 2, 4, 5])
  })

  it('a quarter-sheet allocation engages only zones 1 and 2', () => {
    const r = allocateLagunaVacuumZonesForSheet('quarter-sheet-24x48', { thicknessId: '3-4' })
    expect(engagedZoneNumbers(r!.allocation.engaged)).toEqual([1, 2])
  })
})

describe('LagunaVacuumPanel — render', () => {
  it('renders the allocator heading, sheet/thickness pickers and a 2×3 zone grid', () => {
    const html = renderToStaticMarkup(<LagunaVacuumPanel onAssignZones={() => {}} />)
    expect(html).toContain('data-testid="laguna-vacuum-allocator"')
    expect(html).toContain('Vacuum Zone Allocator')
    expect(html).toContain('data-testid="laguna-alloc-planform"')
    expect(html).toContain('data-testid="laguna-alloc-thickness"')
    expect(html).toContain('data-testid="laguna-alloc-grid"')
    // All six zone cells must render.
    for (const n of [1, 2, 3, 4, 5, 6]) {
      expect(html).toContain(`data-testid="laguna-alloc-zone-${n}"`)
    }
  })

  it('marks all six cells engaged for the default full-sheet selection', () => {
    const html = renderToStaticMarkup(<LagunaVacuumPanel onAssignZones={() => {}} />)
    for (const n of [1, 2, 3, 4, 5, 6]) {
      expect(html).toMatch(new RegExp(`data-testid="laguna-alloc-zone-${n}"[^>]*data-engaged="true"`))
    }
    expect(html).toContain('data-testid="laguna-alloc-engaged"')
    expect(html).toContain('6 of 6')
  })

  it('marks only zones 1,2,4,5 engaged for the half sheet (2,5 idle on the far row)', () => {
    const html = renderToStaticMarkup(
      <LagunaVacuumPanel onAssignZones={() => {}} initialPlanformId="half-sheet-48x48" />
    )
    for (const n of [1, 2, 4, 5]) {
      expect(html).toMatch(new RegExp(`data-testid="laguna-alloc-zone-${n}"[^>]*data-engaged="true"`))
    }
    // Zones 3 and 6 (the far Y2 row) have no stock above them.
    for (const n of [3, 6]) {
      expect(html).toMatch(new RegExp(`data-testid="laguna-alloc-zone-${n}"[^>]*data-engaged="false"`))
    }
    expect(html).toContain('4 of 6')
  })

  it('enables the Assign button and names the engaged zones when stock is on the bed', () => {
    const html = renderToStaticMarkup(<LagunaVacuumPanel onAssignZones={() => {}} />)
    expect(html).toContain('data-testid="laguna-alloc-assign"')
    expect(html).toContain('>Assign engaged zones<')
    // Not disabled (full sheet engages zones).
    expect(html).not.toMatch(/data-testid="laguna-alloc-assign"[^>]*disabled/)
    expect(html).toContain('Sets the zone toggles to 1, 2, 3, 4, 5, 6.')
  })

  it('does not surface an oversize warning for an on-bed sheet', () => {
    const html = renderToStaticMarkup(<LagunaVacuumPanel onAssignZones={() => {}} />)
    expect(html).not.toContain('data-testid="laguna-alloc-oversize"')
  })

  it('shows the bed-coverage percentage in the readout', () => {
    const html = renderToStaticMarkup(<LagunaVacuumPanel onAssignZones={() => {}} />)
    expect(html).toContain('data-testid="laguna-alloc-coverage"')
    // Full 48x96 sheet covers ~64% of the 60x120 bed — pin the presence of a % value.
    expect(html).toMatch(/data-testid="laguna-alloc-coverage">\d+%/)
  })
})
