/**
 * Paired-pin contract for `src/renderer/design/drawing-snap.ts`
 * -- the pure snap-resolution module for 2D drawing dimension placement.
 *
 * This pin asserts the stable public surface, constant values, and source-text
 * invariants that downstream code depends on. It is deliberately minimal: the
 * behavioral matrix lives in `drawing-snap.test.ts`.
 *
 * Three-machine context: drawing snap is used in the Laguna Swift 5x10 and
 * Makera Carvera drawing/section-view workflows. K2 Plus FDM does not produce
 * drawing views. A change to SNAP_KIND_PRIORITY or DEFAULT_SNAP_TOLERANCE_PX
 * would silently shift snap behavior for all future dimension placements.
 *
 * Plan reference: docs/plans/v2-drawing-dimension-snap-to-vertex.md §4 + §6.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as M from './drawing-snap'
import {
  DEFAULT_SNAP_TOLERANCE_PX,
  SNAP_KIND_PRIORITY,
  clientToSvgCoord,
  resolveSnap
} from './drawing-snap'

const SOURCE_PATH = resolve(__dirname, 'drawing-snap.ts')
const SOURCE = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// A. Module shape
// ---------------------------------------------------------------------------
describe('A. Module shape -- drawing-snap.ts exported symbols', () => {
  it('exports all required runtime symbols', () => {
    // Type exports are erased at runtime; only value exports are present.
    expect(typeof SNAP_KIND_PRIORITY).toBe('object')
    expect(typeof DEFAULT_SNAP_TOLERANCE_PX).toBe('number')
    expect(typeof resolveSnap).toBe('function')
    expect(typeof clientToSvgCoord).toBe('function')
  })

  it('SNAP_KIND_PRIORITY is an object with exactly the five snap kinds', () => {
    const keys = Object.keys(SNAP_KIND_PRIORITY).sort()
    expect(keys).toEqual(['center', 'endpoint', 'midpoint', 'quadrant', 'vertex'])
  })

  it('resolveSnap and clientToSvgCoord are accessible via namespace import', () => {
    expect(typeof M.resolveSnap).toBe('function')
    expect(typeof M.clientToSvgCoord).toBe('function')
    expect(typeof M.SNAP_KIND_PRIORITY).toBe('object')
    expect(typeof M.DEFAULT_SNAP_TOLERANCE_PX).toBe('number')
  })
})

// ---------------------------------------------------------------------------
// B. SNAP_KIND_PRIORITY invariants
// ---------------------------------------------------------------------------
describe('B. SNAP_KIND_PRIORITY — value invariants', () => {
  it('vertex has the lowest (highest priority) number', () => {
    const { vertex, endpoint, midpoint, center, quadrant } = SNAP_KIND_PRIORITY
    expect(vertex).toBeLessThan(endpoint)
    expect(vertex).toBeLessThan(quadrant)
    expect(vertex).toBeLessThan(center)
    expect(vertex).toBeLessThan(midpoint)
  })

  it('quadrant is vertex-class: outranks center and midpoint', () => {
    const { quadrant, center, midpoint, endpoint } = SNAP_KIND_PRIORITY
    // Vertex-class means it sits above the curve-derived center/midpoint kinds.
    expect(quadrant).toBeLessThan(center)
    expect(quadrant).toBeLessThan(midpoint)
    // It slots right after endpoint in the total order.
    expect(quadrant).toBeGreaterThan(endpoint)
  })

  it('vertex priority value is 0', () => {
    expect(SNAP_KIND_PRIORITY.vertex).toBe(0)
  })

  it('endpoint priority value is 1', () => {
    expect(SNAP_KIND_PRIORITY.endpoint).toBe(1)
  })

  it('quadrant priority value is 2', () => {
    expect(SNAP_KIND_PRIORITY.quadrant).toBe(2)
  })

  it('center priority value is 3', () => {
    expect(SNAP_KIND_PRIORITY.center).toBe(3)
  })

  it('midpoint priority value is 4', () => {
    expect(SNAP_KIND_PRIORITY.midpoint).toBe(4)
  })

  it('all five priorities are unique non-negative integers', () => {
    const values = Object.values(SNAP_KIND_PRIORITY)
    expect(new Set(values).size).toBe(5)
    for (const v of values) {
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
    }
  })
})

// ---------------------------------------------------------------------------
// C. DEFAULT_SNAP_TOLERANCE_PX invariant
// ---------------------------------------------------------------------------
describe('C. DEFAULT_SNAP_TOLERANCE_PX', () => {
  it('equals 12', () => {
    expect(DEFAULT_SNAP_TOLERANCE_PX).toBe(12)
  })

  it('is a positive finite number', () => {
    expect(DEFAULT_SNAP_TOLERANCE_PX).toBeGreaterThan(0)
    expect(Number.isFinite(DEFAULT_SNAP_TOLERANCE_PX)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// D. Source-text whitelist
// ---------------------------------------------------------------------------
describe('D. Source-text whitelist + safety', () => {
  it('does not contain `any` type annotations', () => {
    // Strip comments to avoid false positives in doc strings.
    const stripped = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    expect(stripped).not.toMatch(/\bas any\b/)
    expect(stripped).not.toMatch(/:\s*any\b/)
  })

  it('does not call eval or new Function', () => {
    expect(SOURCE).not.toMatch(/\beval\s*\(/)
    expect(SOURCE).not.toMatch(/\bnew\s+Function\s*\(/)
  })

  it('SNAP_KIND_PRIORITY literal values 0/1/2/3/4 appear in source', () => {
    expect(SOURCE).toMatch(/vertex:\s*0/)
    expect(SOURCE).toMatch(/endpoint:\s*1/)
    expect(SOURCE).toMatch(/quadrant:\s*2/)
    expect(SOURCE).toMatch(/center:\s*3/)
    expect(SOURCE).toMatch(/midpoint:\s*4/)
  })

  it('DEFAULT_SNAP_TOLERANCE_PX is assigned 12 in source', () => {
    expect(SOURCE).toMatch(/DEFAULT_SNAP_TOLERANCE_PX\s*=\s*12/)
  })

  it('clientToSvgCoord documents the null CTM fallback', () => {
    // Confirm the null-guard branch is present in source.
    expect(SOURCE).toMatch(/getScreenCTM\(\)/)
    expect(SOURCE).toMatch(/ctm\s*===\s*null/)
  })

  it('resolveSnap checks override before any distance computation', () => {
    // The override guard must appear early: confirm it is before 'toleranceSq'.
    const overrideIdx = SOURCE.indexOf('if (override) return null')
    const toleranceIdx = SOURCE.indexOf('toleranceSq')
    expect(overrideIdx).toBeGreaterThan(-1)
    expect(toleranceIdx).toBeGreaterThan(-1)
    expect(overrideIdx).toBeLessThan(toleranceIdx)
  })
})

// ---------------------------------------------------------------------------
// E. Function arities
// ---------------------------------------------------------------------------
describe('E. Function arities', () => {
  it('resolveSnap accepts 4 parameters', () => {
    expect(resolveSnap.length).toBe(4)
  })

  it('clientToSvgCoord accepts 3 parameters', () => {
    expect(clientToSvgCoord.length).toBe(3)
  })
})
