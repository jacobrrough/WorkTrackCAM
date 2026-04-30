/**
 * laguna-vacuum-allocator-pin.test.ts -- [ID-0218] Cycle 145 post-processing paired-pin
 *
 * Pins the contract of `src/shared/laguna-vacuum-allocator.ts` -- the 6-zone
 * vacuum allocator for the Laguna Swift 5x10 sheet bed ([ID-0014b]).
 *
 * LAGUNA-SWIFT-SPECIFIC -- the Laguna Swift 5x10 is the only target machine
 * with a 6-zone vacuum bed; the Creality K2 Plus has a magnetic flexible
 * build plate (no zoned vacuum) and the Makera Carvera + 4th Axis has a
 * T-slot hold-down (no zoned vacuum). The renderer-side companion
 * `src/renderer/src/laguna-vacuum-allocator-ui.ts` was paired-pinned at
 * Cycle 139 [ID-0214]; THIS file pins the shared kernel that builds the
 * underlying `LagunaVacuumZoneAllocation` value consumed by that UI surface
 * AND by the post-processor wrapper `wrapLagunaToolpathWithVacuumBlocks`.
 *
 * Sister cycles in the post-Cycle-127-reset clean-streak chain that this
 * pin extends: 119 [ID-0196] / 124 [ID-0201] / 129 [ID-0206] / 130 [ID-0207]
 * / 131 [ID-0208] / 132 [ID-0209] / 134 [ID-0210] / 135 [ID-0211] /
 * 136 [ID-0212] / 137 [ID-0213] / 139 [ID-0214] / 140 [ID-0215] /
 * 142 [ID-0216] / 144 [ID-0217].
 *
 * The existing `laguna-vacuum-allocator.test.ts` (~451 lines) covers the
 * runtime BEHAVIOUR of the allocator across the three Laguna sheet
 * planforms. THIS pin file does NOT duplicate that coverage; instead it
 * pins:
 *   (A) module shape -- exact named-export inventory, arities, ESM
 *       namespace Symbol-key invariants, no default export,
 *   (B) constant byte-equality + cross-cuts (1524/2, 3048/3, area =
 *       width * length, count = columns * rows),
 *   (C) `LAGUNA_VACUUM_ZONES` registry contract -- 6 entries, column-major
 *       order, per-zone bounds, no overlap, gap-free tiling,
 *   (D) `allocateLagunaVacuumZones` return-shape contract,
 *   (E) defensive coercion against NaN / +-Infinity / negative inputs,
 *   (F) bed-coverage edge cases (zero-size, off-bed, full-sheet engages
 *       all 6, registry-order preserved across engaged + idle),
 *   (G) purity & determinism -- N=10 stability, frozen-input safety,
 *       no-input-mutation, fresh-output-per-call,
 *   (H) `allocateLagunaVacuumZonesForSheet` dispatcher contract +
 *       3-4 thickness default,
 *   (I) source-text whitelist -- [ID-0014b] provenance, Safety-Rule-1
 *       no-G-code-emit framing, no foreign-machine constants, no
 *       React/DOM/electron imports, no `any`.
 *
 * ZERO production-code edits. Pure paired-pin (mirrors prior chain).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as M from './laguna-vacuum-allocator'
import {
  LAGUNA_VACUUM_ZONES,
  LAGUNA_VACUUM_ZONE_AREA_MM2,
  LAGUNA_VACUUM_ZONE_COLUMNS,
  LAGUNA_VACUUM_ZONE_COUNT,
  LAGUNA_VACUUM_ZONE_LENGTH_MM,
  LAGUNA_VACUUM_ZONE_ROWS,
  LAGUNA_VACUUM_ZONE_WIDTH_MM,
  allocateLagunaVacuumZones,
  allocateLagunaVacuumZonesForSheet
} from './laguna-vacuum-allocator'
import { LAGUNA_SWIFT_WORK_AREA_MM } from './laguna-full-sheet-stock'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const SRC_PATH = join(__dirname, 'laguna-vacuum-allocator.ts')
const SRC = readFileSync(SRC_PATH, 'utf8')

// ---------------------------------------------------------------------------
// A) Module shape
// ---------------------------------------------------------------------------

describe('[ID-0218] A) module shape', () => {
  it('exports exactly the documented runtime named symbols', () => {
    const stringKeys = Object.keys(M).sort()
    expect(stringKeys).toEqual(
      [
        'LAGUNA_VACUUM_ZONES',
        'LAGUNA_VACUUM_ZONE_AREA_MM2',
        'LAGUNA_VACUUM_ZONE_COLUMNS',
        'LAGUNA_VACUUM_ZONE_COUNT',
        'LAGUNA_VACUUM_ZONE_LENGTH_MM',
        'LAGUNA_VACUUM_ZONE_ROWS',
        'LAGUNA_VACUUM_ZONE_WIDTH_MM',
        'allocateLagunaVacuumZones',
        'allocateLagunaVacuumZonesForSheet'
      ].sort()
    )
  })

  it('does NOT expose a default export', () => {
    expect((M as Record<string, unknown>).default).toBeUndefined()
  })

  it('only carries Symbol.toStringTag among Symbol-keyed properties', () => {
    const symbolKeys = Object.getOwnPropertySymbols(M)
    expect(symbolKeys).toEqual([Symbol.toStringTag])
  })

  it('has a null prototype on the ESM namespace object', () => {
    expect(Object.getPrototypeOf(M)).toBeNull()
  })

  it('declares Function.length === 4 for allocateLagunaVacuumZones (no defaults on positional args)', () => {
    expect(allocateLagunaVacuumZones.length).toBe(4)
  })

  it('declares Function.length === 1 for allocateLagunaVacuumZonesForSheet (options arg has default)', () => {
    expect(allocateLagunaVacuumZonesForSheet.length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// B) Constants byte-equality + cross-cuts
// ---------------------------------------------------------------------------

describe('[ID-0218] B) constants byte-equality + cross-cuts', () => {
  it('LAGUNA_VACUUM_ZONE_COUNT === 6 (CLAUDE.md §2 USER CONTEXT)', () => {
    expect(LAGUNA_VACUUM_ZONE_COUNT).toBe(6)
  })

  it('LAGUNA_VACUUM_ZONE_COLUMNS === 2 (X axis, short)', () => {
    expect(LAGUNA_VACUUM_ZONE_COLUMNS).toBe(2)
  })

  it('LAGUNA_VACUUM_ZONE_ROWS === 3 (Y axis, long)', () => {
    expect(LAGUNA_VACUUM_ZONE_ROWS).toBe(3)
  })

  it('LAGUNA_VACUUM_ZONE_WIDTH_MM === 762 (1524 / 2)', () => {
    expect(LAGUNA_VACUUM_ZONE_WIDTH_MM).toBe(762)
  })

  it('LAGUNA_VACUUM_ZONE_LENGTH_MM === 1016 (3048 / 3)', () => {
    expect(LAGUNA_VACUUM_ZONE_LENGTH_MM).toBe(1016)
  })

  it('LAGUNA_VACUUM_ZONE_AREA_MM2 === width * length (774192)', () => {
    expect(LAGUNA_VACUUM_ZONE_AREA_MM2).toBe(762 * 1016)
    expect(LAGUNA_VACUUM_ZONE_AREA_MM2).toBe(774192)
  })

  it('count === columns * rows (lock-step invariant)', () => {
    expect(LAGUNA_VACUUM_ZONE_COUNT).toBe(
      LAGUNA_VACUUM_ZONE_COLUMNS * LAGUNA_VACUUM_ZONE_ROWS
    )
  })

  it('width derives from LAGUNA_SWIFT_WORK_AREA_MM.x / columns', () => {
    expect(LAGUNA_VACUUM_ZONE_WIDTH_MM).toBe(
      LAGUNA_SWIFT_WORK_AREA_MM.x / LAGUNA_VACUUM_ZONE_COLUMNS
    )
  })

  it('length derives from LAGUNA_SWIFT_WORK_AREA_MM.y / rows', () => {
    expect(LAGUNA_VACUUM_ZONE_LENGTH_MM).toBe(
      LAGUNA_SWIFT_WORK_AREA_MM.y / LAGUNA_VACUUM_ZONE_ROWS
    )
  })

  it('total bed area === count * zone area', () => {
    const bedAreaMm2 = LAGUNA_SWIFT_WORK_AREA_MM.x * LAGUNA_SWIFT_WORK_AREA_MM.y
    expect(bedAreaMm2).toBe(LAGUNA_VACUUM_ZONE_AREA_MM2 * LAGUNA_VACUUM_ZONE_COUNT)
  })
})

// ---------------------------------------------------------------------------
// C) LAGUNA_VACUUM_ZONES registry contract
// ---------------------------------------------------------------------------

describe('[ID-0218] C) LAGUNA_VACUUM_ZONES registry', () => {
  it('contains exactly 6 zones', () => {
    expect(LAGUNA_VACUUM_ZONES).toHaveLength(6)
  })

  it('orders zones column-major (X0Y0, X0Y1, X0Y2, X1Y0, X1Y1, X1Y2)', () => {
    expect(LAGUNA_VACUUM_ZONES.map((z) => z.id)).toEqual([
      'X0Y0',
      'X0Y1',
      'X0Y2',
      'X1Y0',
      'X1Y1',
      'X1Y2'
    ])
  })

  it('zone ids are unique', () => {
    const ids = LAGUNA_VACUUM_ZONES.map((z) => z.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every zone declares all 8 documented readonly fields', () => {
    for (const z of LAGUNA_VACUUM_ZONES) {
      expect(Object.keys(z).sort()).toEqual(
        [
          'id',
          'label',
          'column',
          'row',
          'xMinMm',
          'xMaxMm',
          'yMinMm',
          'yMaxMm'
        ].sort()
      )
    }
  })

  it('column ∈ {0, 1} and row ∈ {0, 1, 2}', () => {
    for (const z of LAGUNA_VACUUM_ZONES) {
      expect([0, 1]).toContain(z.column)
      expect([0, 1, 2]).toContain(z.row)
    }
  })

  it('every zone has xMaxMm - xMinMm === LAGUNA_VACUUM_ZONE_WIDTH_MM', () => {
    for (const z of LAGUNA_VACUUM_ZONES) {
      expect(z.xMaxMm - z.xMinMm).toBe(LAGUNA_VACUUM_ZONE_WIDTH_MM)
    }
  })

  it('every zone has yMaxMm - yMinMm === LAGUNA_VACUUM_ZONE_LENGTH_MM', () => {
    for (const z of LAGUNA_VACUUM_ZONES) {
      expect(z.yMaxMm - z.yMinMm).toBe(LAGUNA_VACUUM_ZONE_LENGTH_MM)
    }
  })

  it('column 0 zones span x ∈ [0, 762)', () => {
    for (const z of LAGUNA_VACUUM_ZONES.filter((z) => z.column === 0)) {
      expect(z.xMinMm).toBe(0)
      expect(z.xMaxMm).toBe(762)
    }
  })

  it('column 1 zones span x ∈ [762, 1524)', () => {
    for (const z of LAGUNA_VACUUM_ZONES.filter((z) => z.column === 1)) {
      expect(z.xMinMm).toBe(762)
      expect(z.xMaxMm).toBe(1524)
    }
  })

  it('row 0/1/2 zones span y ∈ [0,1016) / [1016,2032) / [2032,3048)', () => {
    const byRow = (r: 0 | 1 | 2): { lo: number; hi: number }[] =>
      LAGUNA_VACUUM_ZONES.filter((z) => z.row === r).map((z) => ({
        lo: z.yMinMm,
        hi: z.yMaxMm
      }))
    for (const { lo, hi } of byRow(0)) {
      expect(lo).toBe(0)
      expect(hi).toBe(1016)
    }
    for (const { lo, hi } of byRow(1)) {
      expect(lo).toBe(1016)
      expect(hi).toBe(2032)
    }
    for (const { lo, hi } of byRow(2)) {
      expect(lo).toBe(2032)
      expect(hi).toBe(3048)
    }
  })

  it('zone labels include corner naming (back/front × left/mid/right)', () => {
    const labels = LAGUNA_VACUUM_ZONES.map((z) => z.label)
    expect(labels).toContain('Zone X0/Y0 (back-left)')
    expect(labels).toContain('Zone X0/Y1 (back-mid)')
    expect(labels).toContain('Zone X0/Y2 (back-right)')
    expect(labels).toContain('Zone X1/Y0 (front-left)')
    expect(labels).toContain('Zone X1/Y1 (front-mid)')
    expect(labels).toContain('Zone X1/Y2 (front-right)')
  })

  it('registry is a stable singleton (referential identity across imports)', () => {
    expect(M.LAGUNA_VACUUM_ZONES).toBe(LAGUNA_VACUUM_ZONES)
  })
})

// ---------------------------------------------------------------------------
// D) allocateLagunaVacuumZones return-shape contract
// ---------------------------------------------------------------------------

describe('[ID-0218] D) allocateLagunaVacuumZones return shape', () => {
  it('returns exactly 8 documented top-level keys', () => {
    const a = allocateLagunaVacuumZones(0, 0, 1524, 3048)
    expect(Object.keys(a).sort()).toEqual(
      [
        'engaged',
        'idle',
        'engagedCount',
        'totalOverlapMm2',
        'bedCoverageFraction',
        'fullBedEngaged',
        'outsideEnvelope',
        'zones'
      ].sort()
    )
  })

  it('engagedCount === engaged.length (always 0..6)', () => {
    const a = allocateLagunaVacuumZones(0, 0, 800, 2400)
    expect(a.engagedCount).toBe(a.engaged.length)
    expect(a.engagedCount).toBeGreaterThanOrEqual(0)
    expect(a.engagedCount).toBeLessThanOrEqual(6)
  })

  it('engaged + idle partition the 6 zone ids', () => {
    const a = allocateLagunaVacuumZones(0, 0, 600, 600)
    const allIds = LAGUNA_VACUUM_ZONES.map((z) => z.id)
    expect([...a.engaged, ...a.idle].sort()).toEqual([...allIds].sort())
  })

  it('zones array is exactly 6 entries in registry order', () => {
    const a = allocateLagunaVacuumZones(0, 0, 1, 1)
    expect(a.zones).toHaveLength(6)
    expect(a.zones.map((z) => z.id)).toEqual(
      LAGUNA_VACUUM_ZONES.map((z) => z.id)
    )
  })

  it('every per-zone descriptor has 4 documented fields', () => {
    const a = allocateLagunaVacuumZones(0, 0, 1, 1)
    for (const z of a.zones) {
      expect(Object.keys(z).sort()).toEqual(
        ['id', 'engaged', 'overlapAreaMm2', 'zoneCoverageFraction'].sort()
      )
    }
  })

  it('engaged === overlapAreaMm2 > 0 strictly', () => {
    const a = allocateLagunaVacuumZones(0, 0, 1524, 3048)
    for (const z of a.zones) {
      expect(z.engaged).toBe(z.overlapAreaMm2 > 0)
    }
  })

  it('zoneCoverageFraction === overlapAreaMm2 / LAGUNA_VACUUM_ZONE_AREA_MM2', () => {
    const a = allocateLagunaVacuumZones(0, 0, 762, 1016)
    for (const z of a.zones) {
      expect(z.zoneCoverageFraction).toBe(
        z.overlapAreaMm2 / LAGUNA_VACUUM_ZONE_AREA_MM2
      )
    }
  })

  it('totalOverlapMm2 === sum of per-zone overlaps', () => {
    const a = allocateLagunaVacuumZones(0, 0, 800, 2400)
    const summed = a.zones.reduce((acc, z) => acc + z.overlapAreaMm2, 0)
    expect(a.totalOverlapMm2).toBe(summed)
  })

  it('bedCoverageFraction === totalOverlapMm2 / (zone area * 6)', () => {
    const a = allocateLagunaVacuumZones(0, 0, 762, 1016)
    expect(a.bedCoverageFraction).toBe(
      a.totalOverlapMm2 / (LAGUNA_VACUUM_ZONE_AREA_MM2 * 6)
    )
  })

  it('fullBedEngaged iff engaged.length === 6', () => {
    const all = allocateLagunaVacuumZones(0, 0, 1524, 3048)
    expect(all.fullBedEngaged).toBe(true)
    const partial = allocateLagunaVacuumZones(0, 0, 100, 100)
    expect(partial.fullBedEngaged).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// E) Defensive coercion against NaN / Infinity / negative inputs
// ---------------------------------------------------------------------------

describe('[ID-0218] E) defensive input coercion', () => {
  it('NaN origin collapses to 0 (no engagement off-bed)', () => {
    const a = allocateLagunaVacuumZones(Number.NaN, Number.NaN, 100, 100)
    expect(a.engagedCount).toBe(1)
    expect(a.engaged[0]).toBe('X0Y0')
  })

  it('+Infinity origin collapses to 0 (treated as not finite)', () => {
    const a = allocateLagunaVacuumZones(
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      100,
      100
    )
    expect(a.engagedCount).toBe(1)
    expect(a.engaged[0]).toBe('X0Y0')
  })

  it('-Infinity origin collapses to 0', () => {
    const a = allocateLagunaVacuumZones(
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      100,
      100
    )
    expect(a.engagedCount).toBe(1)
  })

  it('negative origin collapses to 0', () => {
    const a = allocateLagunaVacuumZones(-50, -50, 100, 100)
    expect(a.engaged).toEqual(['X0Y0'])
  })

  it('NaN size collapses to 0 (zero engagement)', () => {
    const a = allocateLagunaVacuumZones(0, 0, Number.NaN, Number.NaN)
    expect(a.engagedCount).toBe(0)
    expect(a.totalOverlapMm2).toBe(0)
  })

  it('non-positive size (0 or negative) yields zero engagement', () => {
    expect(allocateLagunaVacuumZones(0, 0, 0, 0).engagedCount).toBe(0)
    expect(allocateLagunaVacuumZones(0, 0, -100, -100).engagedCount).toBe(0)
  })

  it('+Infinity size collapses to 0 (not finite)', () => {
    const a = allocateLagunaVacuumZones(
      0,
      0,
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY
    )
    expect(a.engagedCount).toBe(0)
  })

  it('zero-size stock produces 0 totalOverlapMm2 and 0 bedCoverageFraction', () => {
    const a = allocateLagunaVacuumZones(100, 100, 0, 0)
    expect(a.totalOverlapMm2).toBe(0)
    expect(a.bedCoverageFraction).toBe(0)
    expect(a.fullBedEngaged).toBe(false)
  })

  it('origin === 0 is treated as 0 (NOT collapsed via the > 0 fast path)', () => {
    const a = allocateLagunaVacuumZones(0, 0, 100, 100)
    expect(a.engaged).toEqual(['X0Y0'])
  })
})

// ---------------------------------------------------------------------------
// F) Bed-coverage edge cases
// ---------------------------------------------------------------------------

describe('[ID-0218] F) bed-coverage edge cases', () => {
  it('full-sheet at origin engages all 6 zones', () => {
    const a = allocateLagunaVacuumZones(0, 0, 1524, 3048)
    expect(a.engaged).toHaveLength(6)
    expect(a.fullBedEngaged).toBe(true)
    expect(a.idle).toEqual([])
    expect(a.outsideEnvelope).toBe(false)
  })

  it('48x96 in (1219.2 x 2438.4 mm) sheet at origin engages all 6 zones', () => {
    const a = allocateLagunaVacuumZones(0, 0, 1219.2, 2438.4)
    expect(a.engagedCount).toBe(6)
    expect(a.outsideEnvelope).toBe(false)
  })

  it('tiny stock at origin engages only X0Y0', () => {
    const a = allocateLagunaVacuumZones(0, 0, 1, 1)
    expect(a.engaged).toEqual(['X0Y0'])
    expect(a.idle).toEqual(['X0Y1', 'X0Y2', 'X1Y0', 'X1Y1', 'X1Y2'])
  })

  it('edge-only touching at x=762 boundary does NOT engage column 1', () => {
    // Stock right edge sits exactly at column-split; zero-area overlap.
    const a = allocateLagunaVacuumZones(0, 0, 762, 100)
    expect(a.engaged).toEqual(['X0Y0'])
  })

  it('edge-only touching at y=1016 boundary does NOT engage row 1', () => {
    const a = allocateLagunaVacuumZones(0, 0, 100, 1016)
    expect(a.engaged).toEqual(['X0Y0'])
  })

  it('stock straddling x=762 by 1 mm engages BOTH columns of row 0', () => {
    const a = allocateLagunaVacuumZones(761, 0, 2, 100)
    expect(a.engaged).toEqual(['X0Y0', 'X1Y0'])
  })

  it('out-of-bed stock raises outsideEnvelope flag', () => {
    const a = allocateLagunaVacuumZones(0, 0, 2000, 4000)
    expect(a.outsideEnvelope).toBe(true)
  })

  it('out-of-bed stock still engages real zones via clipped overlap', () => {
    const a = allocateLagunaVacuumZones(0, 0, 2000, 4000)
    expect(a.engagedCount).toBe(6)
    // Clipped overlap CANNOT exceed the bed area.
    expect(a.totalOverlapMm2).toBeLessThanOrEqual(
      LAGUNA_VACUUM_ZONE_AREA_MM2 * 6
    )
  })

  it('engaged + idle preserve registry order (no shuffling)', () => {
    const a = allocateLagunaVacuumZones(0, 0, 600, 1500)
    const registryOrder = LAGUNA_VACUUM_ZONES.map((z) => z.id)
    const reconstructed = registryOrder.filter(
      (id) => a.engaged.includes(id) || a.idle.includes(id)
    )
    expect(reconstructed).toEqual(registryOrder)
  })

  it('exact-fit single-zone stock at zone origin produces zoneCoverageFraction === 1', () => {
    const a = allocateLagunaVacuumZones(0, 0, 762, 1016)
    const zone = a.zones.find((z) => z.id === 'X0Y0')
    expect(zone?.zoneCoverageFraction).toBe(1)
  })

  it('stock placed deep inside row 1 column 1 engages exactly X1Y1', () => {
    const a = allocateLagunaVacuumZones(900, 1200, 100, 100)
    expect(a.engaged).toEqual(['X1Y1'])
  })

  it('quarter-sheet 24x48 in (609.6 x 1219.2 mm) at origin engages X0Y0 + X0Y1', () => {
    const a = allocateLagunaVacuumZones(0, 0, 609.6, 1219.2)
    expect(a.engaged).toEqual(['X0Y0', 'X0Y1'])
  })
})

// ---------------------------------------------------------------------------
// G) Purity & determinism
// ---------------------------------------------------------------------------

describe('[ID-0218] G) purity & determinism', () => {
  it('allocateLagunaVacuumZones returns fresh objects on every call', () => {
    const a1 = allocateLagunaVacuumZones(0, 0, 100, 100)
    const a2 = allocateLagunaVacuumZones(0, 0, 100, 100)
    expect(a1).not.toBe(a2)
    expect(a1.engaged).not.toBe(a2.engaged)
    expect(a1.idle).not.toBe(a2.idle)
    expect(a1.zones).not.toBe(a2.zones)
  })

  it('caller mutation of engaged[] does not poison subsequent calls', () => {
    const a1 = allocateLagunaVacuumZones(0, 0, 100, 100)
    ;(a1.engaged as string[]).push('GHOST')
    const a2 = allocateLagunaVacuumZones(0, 0, 100, 100)
    expect(a2.engaged).not.toContain('GHOST')
  })

  it('N=10 stability -- byte-equal results across repeated calls', () => {
    const ref = allocateLagunaVacuumZones(0, 0, 1219.2, 2438.4)
    for (let i = 0; i < 10; i += 1) {
      const next = allocateLagunaVacuumZones(0, 0, 1219.2, 2438.4)
      expect(next).toEqual(ref)
    }
  })

  it('does not mutate LAGUNA_VACUUM_ZONES registry', () => {
    const before = JSON.stringify(LAGUNA_VACUUM_ZONES)
    allocateLagunaVacuumZones(0, 0, 1524, 3048)
    expect(JSON.stringify(LAGUNA_VACUUM_ZONES)).toBe(before)
  })

  it('frozen-input safe -- accepts NaN/Infinity arguments without throwing', () => {
    expect(() =>
      allocateLagunaVacuumZones(
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        Number.NaN
      )
    ).not.toThrow()
  })

  it('zone descriptors are plain {id, engaged, overlapAreaMm2, zoneCoverageFraction} objects', () => {
    const a = allocateLagunaVacuumZones(0, 0, 100, 100)
    for (const z of a.zones) {
      expect(typeof z.id).toBe('string')
      expect(typeof z.engaged).toBe('boolean')
      expect(typeof z.overlapAreaMm2).toBe('number')
      expect(typeof z.zoneCoverageFraction).toBe('number')
      expect(Number.isFinite(z.overlapAreaMm2)).toBe(true)
      expect(Number.isFinite(z.zoneCoverageFraction)).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// H) allocateLagunaVacuumZonesForSheet dispatcher
// ---------------------------------------------------------------------------

describe('[ID-0218] H) allocateLagunaVacuumZonesForSheet dispatcher', () => {
  it('returns null on unknown planform id', () => {
    expect(allocateLagunaVacuumZonesForSheet('not-a-real-id')).toBeNull()
  })

  it('returns null on unknown thickness id', () => {
    expect(
      allocateLagunaVacuumZonesForSheet('full-sheet-48x96', {
        thicknessId: 'unknown-thickness'
      })
    ).toBeNull()
  })

  it('defaults thicknessId to "3-4" (3/4 in / 19.05 mm)', () => {
    const r = allocateLagunaVacuumZonesForSheet('full-sheet-48x96')
    expect(r).not.toBeNull()
    // 3/4 in = 19.05 mm.
    expect(r?.stock.z).toBeCloseTo(19.05, 5)
  })

  it('full-sheet 48x96 in resolves to a 4-key result with allocation engaging all 6 zones', () => {
    const r = allocateLagunaVacuumZonesForSheet('full-sheet-48x96')
    expect(r).not.toBeNull()
    expect(Object.keys(r ?? {}).sort()).toEqual(
      ['stock', 'fit', 'originMm', 'allocation'].sort()
    )
    expect(r?.allocation.fullBedEngaged).toBe(true)
  })

  it('quarter-sheet 24x48 in resolves and engages a strict subset of 6 zones', () => {
    const r = allocateLagunaVacuumZonesForSheet('quarter-sheet-24x48')
    expect(r).not.toBeNull()
    expect(r?.allocation.fullBedEngaged).toBe(false)
    expect(r?.allocation.engagedCount).toBeGreaterThan(0)
    expect(r?.allocation.engagedCount).toBeLessThanOrEqual(6)
  })

  it('forwards fixtureMarginMm to the fixture-aware origin', () => {
    const r0 = allocateLagunaVacuumZonesForSheet('quarter-sheet-24x48', {
      fixtureMarginMm: 0
    })
    const r50 = allocateLagunaVacuumZonesForSheet('quarter-sheet-24x48', {
      fixtureMarginMm: 50
    })
    expect(r0).not.toBeNull()
    expect(r50).not.toBeNull()
    // A non-zero fixture margin shifts the origin OR engages a different
    // zone subset. Either way the two results must NOT byte-match.
    expect(r0).not.toEqual(r50)
  })

  it('result is fresh per call (no aliasing)', () => {
    const a = allocateLagunaVacuumZonesForSheet('full-sheet-48x96')
    const b = allocateLagunaVacuumZonesForSheet('full-sheet-48x96')
    expect(a).not.toBe(b)
    expect(a?.allocation).not.toBe(b?.allocation)
  })
})

// ---------------------------------------------------------------------------
// I) Source-text whitelist
// ---------------------------------------------------------------------------

describe('[ID-0218] I) source-text whitelist', () => {
  it('declares [ID-0014b] provenance in the JSDoc header', () => {
    expect(SRC).toContain('[ID-0014b]')
  })

  it('Safety Rule 1 framing is present (UNTOUCHED post template / no G-code emit)', () => {
    expect(SRC).toContain('Safety Rule 1')
    expect(SRC).toContain('emits')
    expect(SRC).toContain('NO G-code')
  })

  it('declares the per-machine PRIMARY/UNAFFECTED three-machine framing', () => {
    expect(SRC).toContain('PRIMARY = Laguna Swift')
    expect(SRC).toContain('UNAFFECTED = Creality K2 Plus')
    expect(SRC).toContain('Makera Carvera + 4th Axis')
  })

  it('imports LAGUNA_SWIFT_WORK_AREA_MM as a value (not a type-only import)', () => {
    expect(SRC).toMatch(/^\s*LAGUNA_SWIFT_WORK_AREA_MM\s*[,\n]/m)
  })

  it('does NOT import any React / DOM / electron modules', () => {
    expect(SRC).not.toMatch(/from ['"]react['"]/)
    expect(SRC).not.toMatch(/from ['"]react\/jsx-runtime['"]/)
    expect(SRC).not.toMatch(/from ['"]electron['"]/)
    expect(SRC).not.toMatch(/document\./)
    expect(SRC).not.toMatch(/window\./)
    expect(SRC).not.toMatch(/localStorage/)
  })

  it('does NOT contain any G-code or M-code emit literals', () => {
    expect(SRC).not.toMatch(/\bM6[45]\b/) // M64 / M65 vacuum on/off
    expect(SRC).not.toMatch(/\bG0\d?\b/)
    expect(SRC).not.toMatch(/\bG1\d?\b/)
    expect(SRC).not.toMatch(/\{\{[^}]+\}\}/) // Handlebars tokens
  })

  it('does NOT reference foreign-machine constants (K2 / Carvera)', () => {
    expect(SRC).not.toMatch(/CREALITY_/)
    expect(SRC).not.toMatch(/K2_/)
    expect(SRC).not.toMatch(/CARVERA_/)
    expect(SRC).not.toMatch(/MAKERA_/)
  })

  it('contains zero `any` types (Safety Rule 3)', () => {
    expect(SRC).not.toMatch(/:\s*any\b/)
    expect(SRC).not.toMatch(/\bas\s+any\b/)
    expect(SRC).not.toMatch(/<any>/)
  })

  it('exports exactly 2 functions and exactly 4 interfaces', () => {
    expect(SRC.match(/^export function /gm)?.length).toBe(2)
    expect(SRC.match(/^export interface /gm)?.length).toBe(4)
  })

  it('declares the column-major zone-id template `X${col}Y${r}`', () => {
    expect(SRC).toContain('`X${col}Y${r}`')
  })

  it('declares the strict-positive-area engagement rule (`overlapAreaMm2 > 0`)', () => {
    expect(SRC).toContain('overlapAreaMm2 > 0')
  })

  it('declares the bed-area derivation as zone area * count', () => {
    expect(SRC).toContain('LAGUNA_VACUUM_ZONE_AREA_MM2 * LAGUNA_VACUUM_ZONE_COUNT')
  })

  it('declares the documented "3-4" thickness default in the dispatcher', () => {
    expect(SRC).toContain("options.thicknessId ?? '3-4'")
  })

  it('uses Number.isFinite for defensive coercion (NOT typeof === "number")', () => {
    const finiteCount = (SRC.match(/Number\.isFinite\(/g) ?? []).length
    expect(finiteCount).toBeGreaterThanOrEqual(4)
    expect(SRC).not.toMatch(/typeof\s+\w+\s*===\s*['"]number['"]/)
  })

  it('declares the column-major iteration order (column outer, row inner)', () => {
    // Outer loop is column, inner loop is row.
    const colIdx = SRC.indexOf('let column = 0; column <')
    const rowIdx = SRC.indexOf('let row = 0; row <')
    expect(colIdx).toBeGreaterThan(0)
    expect(rowIdx).toBeGreaterThan(colIdx)
  })

  it('declares the readonly-array LAGUNA_VACUUM_ZONES type signature', () => {
    expect(SRC).toContain('readonly LagunaVacuumZone[]')
  })

  it('does NOT contain top-level `let` declarations (constants only at module scope)', () => {
    expect(SRC).not.toMatch(/^let /m)
  })

  it('declares the closed-on-min / open-on-max bound convention in JSDoc', () => {
    expect(SRC).toContain('CLOSED on the')
    expect(SRC).toContain('OPEN on the')
  })

  it('declares the Cycle 97 [ID-0014] companion framing (sheet-stock slice 1 of 2)', () => {
    expect(SRC).toContain('laguna-full-sheet-stock')
  })
})
