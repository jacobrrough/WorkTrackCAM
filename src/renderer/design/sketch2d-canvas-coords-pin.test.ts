/**
 * Paired-pin contract for `src/renderer/design/sketch2d-canvas-coords.ts`
 * -- the 61-line RENDERER-side pure coordinate / geometry helper module
 * shared by `Sketch2DCanvas` render and pointer handlers across all
 * three target machines' shop environments.
 *
 * The module exports five runtime symbols:
 *
 * - `screenToWorld(sx, sy, w, h, scale, ox, oy)` -- pixel-to-world
 *   transform with Y-axis flip (screen Y goes down, world Y goes up).
 * - `clientToCanvasLocal(clientX, clientY, canvas)` -- DOM client-coord
 *   to canvas-local-coord remap via getBoundingClientRect().
 * - `snap(v, step)` -- snap-to-grid with `step <= 0` = passthrough.
 * - `niceStepMm(stepMm)` -- 1/2/5/10 ladder choice for grid spacing.
 * - `distSqPointSegment(px, py, ax, ay, bx, by)` -- squared distance
 *   from point P to segment AB (parameter clamped to [0, 1]; degenerate
 *   AB returns squared point-to-A distance).
 *
 * Three-machine impact: INDIRECT cross-cut on the renderer-side 2D
 * sketch authoring surface shared across all three target machines'
 * shop environments. Every K2 Plus FDM, Laguna 5x10, Carvera 3-axis,
 * and Carvera 4-axis Rotary quick-switch delegates 2D sketch authoring
 * to `Sketch2DCanvas`, which uses these pure helpers for pointer
 * hit-tests, snap-to-grid, and grid-spacing decisions. A regression in
 * any of these would silently break sketch interaction across all four
 * shop-environment quick-switches.
 *
 * This pin co-locates with the existing behavioral test
 * `sketch2d-canvas-coords.test.ts`. The pin is exhaustive against the
 * Y-flip transform, the niceStepMm ladder breakpoints, the segment-
 * clamp invariants, and the source-text whitelist.
 *
 * Roadmap ID: [ID-0298] / Cycle 225 (ui-polish rotation slot).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as M from './sketch2d-canvas-coords'
import {
  clientToCanvasLocal,
  distSqPointSegment,
  niceStepMm,
  screenToWorld,
  snap
} from './sketch2d-canvas-coords'

const SOURCE_PATH = resolve(__dirname, 'sketch2d-canvas-coords.ts')
const SOURCE = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// A. Module shape
// ---------------------------------------------------------------------------
describe('A. Module shape -- src/renderer/design/sketch2d-canvas-coords.ts', () => {
  it('exports exactly the five-symbol public surface', () => {
    expect(Object.keys(M).sort()).toEqual([
      'clientToCanvasLocal',
      'distSqPointSegment',
      'niceStepMm',
      'screenToWorld',
      'snap'
    ])
  })

  it('all five exports are functions', () => {
    expect(typeof screenToWorld).toBe('function')
    expect(typeof clientToCanvasLocal).toBe('function')
    expect(typeof snap).toBe('function')
    expect(typeof niceStepMm).toBe('function')
    expect(typeof distSqPointSegment).toBe('function')
  })

  it('arities match the documented signatures', () => {
    expect(screenToWorld.length).toBe(7)
    expect(clientToCanvasLocal.length).toBe(3)
    expect(snap.length).toBe(2)
    expect(niceStepMm.length).toBe(1)
    expect(distSqPointSegment.length).toBe(6)
  })
})

// ---------------------------------------------------------------------------
// B. screenToWorld -- Y-flip transform + scale + offset
// ---------------------------------------------------------------------------
describe('B. screenToWorld -- pixel-to-world with Y-flip', () => {
  it('the canvas center maps to (ox, oy) at scale=1 with no offset', () => {
    const [wx, wy] = screenToWorld(400, 300, 800, 600, 1, 0, 0)
    expect(wx).toBeCloseTo(0, 5)
    expect(wy).toBeCloseTo(0, 5)
  })

  it('Y axis is flipped (screen Y down -> world Y up)', () => {
    // Top of the canvas (sy = 0) should map to a positive world Y.
    const [, wyTop] = screenToWorld(400, 0, 800, 600, 1, 0, 0)
    const [, wyBottom] = screenToWorld(400, 600, 800, 600, 1, 0, 0)
    expect(wyTop).toBeGreaterThan(0)
    expect(wyBottom).toBeLessThan(0)
    // And |wyTop| === |wyBottom| since they are equidistant from cy.
    expect(wyTop).toBeCloseTo(-wyBottom, 5)
  })

  it('X axis is NOT flipped (screen X right -> world X positive)', () => {
    const [wxLeft] = screenToWorld(0, 300, 800, 600, 1, 0, 0)
    const [wxRight] = screenToWorld(800, 300, 800, 600, 1, 0, 0)
    expect(wxLeft).toBeLessThan(0)
    expect(wxRight).toBeGreaterThan(0)
    expect(wxLeft).toBeCloseTo(-wxRight, 5)
  })

  it('scale > 1 zooms IN (smaller world span per pixel)', () => {
    const atScale1 = screenToWorld(800, 300, 800, 600, 1, 0, 0)[0]
    const atScale2 = screenToWorld(800, 300, 800, 600, 2, 0, 0)[0]
    expect(Math.abs(atScale2)).toBeLessThan(Math.abs(atScale1))
    expect(atScale2 * 2).toBeCloseTo(atScale1, 5)
  })

  it('offset (ox, oy) shifts the world origin -- center maps to (ox, oy) directly', () => {
    const [wx, wy] = screenToWorld(400, 300, 800, 600, 1, 100, 200)
    expect(wx).toBeCloseTo(100, 5)
    expect(wy).toBeCloseTo(200, 5)
  })

  it('round-trip: pixel -> world at scale=2.5 with offset (50, 75) is reversible', () => {
    const w = 1024
    const h = 768
    const scale = 2.5
    const ox = 50
    const oy = 75
    const sx = 600
    const sy = 200
    const [wx, wy] = screenToWorld(sx, sy, w, h, scale, ox, oy)
    // The inverse transform is documented but not exported; we hand-roll it.
    const sxBack = (wx - ox) * scale + w / 2
    const syBack = -(wy - oy) * scale + h / 2
    expect(sxBack).toBeCloseTo(sx, 5)
    expect(syBack).toBeCloseTo(sy, 5)
  })

  it('returns a fresh tuple on every call (no shared cache)', () => {
    const a = screenToWorld(0, 0, 100, 100, 1, 0, 0)
    const b = screenToWorld(0, 0, 100, 100, 1, 0, 0)
    expect(a).not.toBe(b)
    expect(a).toEqual(b)
  })
})

// ---------------------------------------------------------------------------
// C. clientToCanvasLocal -- DOM remap
// ---------------------------------------------------------------------------
describe('C. clientToCanvasLocal -- DOM client-to-canvas remap', () => {
  function fakeCanvas(rect: { left: number; top: number; width?: number; height?: number }): HTMLCanvasElement {
    const r = { ...rect, width: rect.width ?? 800, height: rect.height ?? 600 }
    return {
      getBoundingClientRect: () => ({
        left: r.left,
        top: r.top,
        right: r.left + r.width,
        bottom: r.top + r.height,
        width: r.width,
        height: r.height,
        x: r.left,
        y: r.top,
        toJSON: () => ({})
      })
    } as unknown as HTMLCanvasElement
  }

  it('subtracts rect.left and rect.top from clientX/clientY', () => {
    const canvas = fakeCanvas({ left: 100, top: 50 })
    const [x, y] = clientToCanvasLocal(150, 100, canvas)
    expect(x).toBe(50)
    expect(y).toBe(50)
  })

  it('handles a canvas whose bounding rect is at (0, 0)', () => {
    const canvas = fakeCanvas({ left: 0, top: 0 })
    const [x, y] = clientToCanvasLocal(123, 456, canvas)
    expect(x).toBe(123)
    expect(y).toBe(456)
  })

  it('handles negative client coordinates (pointer outside the canvas)', () => {
    const canvas = fakeCanvas({ left: 100, top: 100 })
    const [x, y] = clientToCanvasLocal(50, 50, canvas)
    expect(x).toBe(-50)
    expect(y).toBe(-50)
  })

  it('returns a fresh tuple on every call', () => {
    const canvas = fakeCanvas({ left: 0, top: 0 })
    const a = clientToCanvasLocal(10, 20, canvas)
    const b = clientToCanvasLocal(10, 20, canvas)
    expect(a).not.toBe(b)
    expect(a).toEqual(b)
  })
})

// ---------------------------------------------------------------------------
// D. snap -- snap-to-grid
// ---------------------------------------------------------------------------
describe('D. snap -- snap-to-grid with passthrough on step <= 0', () => {
  it('step = 1 rounds to the nearest integer', () => {
    expect(snap(1.4, 1)).toBe(1)
    expect(snap(1.5, 1)).toBe(2)
    expect(snap(-1.4, 1)).toBe(-1)
    expect(snap(-1.5, 1)).toBe(-1) // Math.round half-toward-+infinity
  })

  it('step = 0.5 rounds to the nearest 0.5', () => {
    expect(snap(0.7, 0.5)).toBeCloseTo(0.5, 10)
    expect(snap(0.8, 0.5)).toBeCloseTo(1.0, 10)
    expect(snap(0.25, 0.5)).toBeCloseTo(0.5, 10)
  })

  it('step = 5 rounds to the nearest multiple of 5', () => {
    expect(snap(7, 5)).toBe(5)
    expect(snap(8, 5)).toBe(10)
    expect(snap(-7, 5)).toBe(-5)
  })

  it('step = 0 passes through (no snap)', () => {
    expect(snap(3.14, 0)).toBe(3.14)
    expect(snap(-99.9, 0)).toBe(-99.9)
  })

  it('step < 0 passes through (no snap)', () => {
    expect(snap(3.14, -1)).toBe(3.14)
    expect(snap(7, -0.5)).toBe(7)
  })

  it('snap(0, anything > 0) returns 0', () => {
    expect(snap(0, 1)).toBe(0)
    expect(snap(0, 0.5)).toBe(0)
    expect(snap(0, 5)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// E. niceStepMm -- 1/2/5/10 ladder
// ---------------------------------------------------------------------------
describe('E. niceStepMm -- 1/2/5 ladder choice for grid spacing', () => {
  it('returns 1 for non-finite or non-positive input (defensive default)', () => {
    expect(niceStepMm(0)).toBe(1)
    expect(niceStepMm(-1)).toBe(1)
    expect(niceStepMm(Number.NaN)).toBe(1)
    expect(niceStepMm(Infinity)).toBe(1)
    expect(niceStepMm(-Infinity)).toBe(1)
  })

  it('inputs in [0+, 1] map to a 1/2/5 sub-decade pick', () => {
    // 0.001 mm: p = 0.001, n = 1, base = 1 -> 0.001.
    expect(niceStepMm(0.001)).toBeCloseTo(0.001, 10)
    // 0.5 mm: p = 0.1, n = 5, base = 5 -> 0.5.
    expect(niceStepMm(0.5)).toBeCloseTo(0.5, 10)
    // 1 mm: p = 1, n = 1, base = 1 -> 1.
    expect(niceStepMm(1)).toBeCloseTo(1, 10)
  })

  it('inputs in (1, 2] map to 2', () => {
    expect(niceStepMm(1.5)).toBe(2)
    expect(niceStepMm(2)).toBe(2)
  })

  it('inputs in (2, 5] map to 5', () => {
    expect(niceStepMm(3)).toBe(5)
    expect(niceStepMm(4.5)).toBe(5)
    expect(niceStepMm(5)).toBe(5)
  })

  it('inputs in (5, 10] map to 10', () => {
    expect(niceStepMm(7)).toBe(10)
    expect(niceStepMm(9.9)).toBe(10)
    expect(niceStepMm(10)).toBe(10)
  })

  it('the ladder repeats per decade', () => {
    expect(niceStepMm(15)).toBe(20)
    expect(niceStepMm(30)).toBe(50)
    expect(niceStepMm(70)).toBe(100)
    expect(niceStepMm(150)).toBe(200)
  })

  it('always returns a positive number for any positive finite input', () => {
    for (const v of [0.01, 0.1, 1, 1.5, 3.14, 7, 12.5, 99, 1234]) {
      const r = niceStepMm(v)
      expect(r).toBeGreaterThan(0)
      expect(Number.isFinite(r)).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// F. distSqPointSegment -- segment hit-test geometry
// ---------------------------------------------------------------------------
describe('F. distSqPointSegment -- squared distance from P to segment AB', () => {
  it('point ON the segment returns 0', () => {
    expect(distSqPointSegment(5, 0, 0, 0, 10, 0)).toBeCloseTo(0, 10)
    expect(distSqPointSegment(0, 5, 0, 0, 0, 10)).toBeCloseTo(0, 10)
    expect(distSqPointSegment(3, 3, 0, 0, 6, 6)).toBeCloseTo(0, 10)
  })

  it('point perpendicular to the segment midpoint returns the perpendicular distance squared', () => {
    // Segment along +X from (0,0) to (10,0); point at (5, 4).
    // Perpendicular distance is 4, squared = 16.
    expect(distSqPointSegment(5, 4, 0, 0, 10, 0)).toBeCloseTo(16, 10)
  })

  it('point past A (parameter < 0) clamps to A and returns squared distance to A', () => {
    // Segment from (0,0) to (10,0); point at (-5, 0). Closest = A.
    expect(distSqPointSegment(-5, 0, 0, 0, 10, 0)).toBeCloseTo(25, 10)
    // (-5, 3) -> closest still A, distance sqrt(25 + 9) -> squared 34.
    expect(distSqPointSegment(-5, 3, 0, 0, 10, 0)).toBeCloseTo(34, 10)
  })

  it('point past B (parameter > 1) clamps to B and returns squared distance to B', () => {
    // Segment from (0,0) to (10,0); point at (15, 0). Closest = B.
    expect(distSqPointSegment(15, 0, 0, 0, 10, 0)).toBeCloseTo(25, 10)
    // (15, 4) -> closest still B, squared 25 + 16 = 41.
    expect(distSqPointSegment(15, 4, 0, 0, 10, 0)).toBeCloseTo(41, 10)
  })

  it('degenerate segment (A === B) returns squared distance from P to A', () => {
    // Degenerate segment at (5, 5); point at (8, 9). Squared = 9 + 16 = 25.
    expect(distSqPointSegment(8, 9, 5, 5, 5, 5)).toBeCloseTo(25, 10)
    // P === A === B returns 0.
    expect(distSqPointSegment(5, 5, 5, 5, 5, 5)).toBeCloseTo(0, 10)
  })

  it('uses the documented 1e-18 epsilon for the degenerate-segment check', () => {
    // Source-text scan: a tighter epsilon would change behavior on
    // near-degenerate segments at sub-nm precision; pin via source.
    expect(SOURCE).toMatch(/ab2\s*<\s*1e-18/)
  })

  it('always returns a non-negative number', () => {
    const cases: Array<[number, number, number, number, number, number]> = [
      [0, 0, 0, 0, 1, 0],
      [10, 10, 0, 0, 1, 1],
      [-5, -5, 0, 0, 10, 10],
      [3.14, 2.71, 1, 1, 4, 4]
    ]
    for (const c of cases) {
      const d = distSqPointSegment(...c)
      expect(d).toBeGreaterThanOrEqual(0)
      expect(Number.isFinite(d)).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// G. Pure-function invariants
// ---------------------------------------------------------------------------
describe('G. Pure-function invariants -- determinism + no side effects', () => {
  it('screenToWorld is deterministic', () => {
    expect(screenToWorld(100, 200, 800, 600, 1.5, 10, 20)).toEqual(
      screenToWorld(100, 200, 800, 600, 1.5, 10, 20)
    )
  })

  it('snap is deterministic', () => {
    expect(snap(3.14159, 0.5)).toBe(snap(3.14159, 0.5))
  })

  it('niceStepMm is deterministic', () => {
    expect(niceStepMm(7.5)).toBe(niceStepMm(7.5))
  })

  it('distSqPointSegment is deterministic', () => {
    expect(distSqPointSegment(1, 2, 3, 4, 5, 6)).toBe(distSqPointSegment(1, 2, 3, 4, 5, 6))
  })
})

// ---------------------------------------------------------------------------
// H. Source-text whitelist + safety
// ---------------------------------------------------------------------------
describe('H. Source-text whitelist + safety', () => {
  it('has zero imports (pure helpers, no runtime deps)', () => {
    const stripped = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    const importLines = stripped.split('\n').filter((l) => /^\s*import\s/.test(l))
    expect(importLines.length).toBe(0)
  })

  it('does not contain `any` casts', () => {
    const stripped = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    expect(stripped).not.toMatch(/\bas any\b/)
    expect(stripped).not.toMatch(/:\s*any\b/)
  })

  it('does not call eval / new Function', () => {
    expect(SOURCE).not.toMatch(/\beval\s*\(/)
    expect(SOURCE).not.toMatch(/\bnew\s+Function\s*\(/)
  })

  it('declares the documented Y-flip in screenToWorld (negation of (sy - cy))', () => {
    expect(SOURCE).toMatch(/wy\s*=\s*-\(sy\s*-\s*cy\)\s*\/\s*scale\s*\+\s*oy/)
  })

  it('niceStepMm uses the 1/2/5/10 ladder breakpoints exactly', () => {
    // Source-text scan confirms the ladder constants.
    expect(SOURCE).toMatch(/n\s*<=\s*1\s*\?\s*1\s*:\s*n\s*<=\s*2\s*\?\s*2\s*:\s*n\s*<=\s*5\s*\?\s*5\s*:\s*10/)
  })

  it('all five exports are declared with the `export function` keyword (not export const = arrow)', () => {
    expect(SOURCE).toMatch(/export function screenToWorld\(/)
    expect(SOURCE).toMatch(/export function clientToCanvasLocal\(/)
    expect(SOURCE).toMatch(/export function snap\(/)
    expect(SOURCE).toMatch(/export function niceStepMm\(/)
    expect(SOURCE).toMatch(/export function distSqPointSegment\(/)
  })
})

// ---------------------------------------------------------------------------
// I. Three-machine cross-cut realism (renderer-side shared)
// ---------------------------------------------------------------------------
describe('I. Three-machine cross-cut realism (renderer shared)', () => {
  it('niceStepMm returns sensible grid steps for typical machine ranges', () => {
    // K2 Plus 350 mm cube: a quarter-sized grid is 87.5 mm -> nice 100.
    expect(niceStepMm(87.5)).toBe(100)
    // Laguna Swift 5x10: ~1500 mm -> nice 2000 (decade boundary, 1500 / 1000 = 1.5, n=1.5, base=2, base * 1000 = 2000).
    expect(niceStepMm(1500)).toBe(2000)
    // Carvera bar 100 mm -> nice 100.
    expect(niceStepMm(100)).toBe(100)
    // Carvera 4-axis bar diameter 50 mm -> nice 50.
    expect(niceStepMm(50)).toBe(50)
  })

  it('snap supports common machine snap grids (0.1 / 0.5 / 1 / 5 / 10 mm)', () => {
    expect(snap(1.234, 0.1)).toBeCloseTo(1.2, 10)
    expect(snap(1.234, 0.5)).toBeCloseTo(1, 10)
    expect(snap(1.234, 1)).toBe(1)
    expect(snap(7.6, 5)).toBe(10)
    expect(snap(15, 10)).toBe(20)
  })

  it('distSqPointSegment hit-test accepts large-stock segment endpoints (Laguna 1524x3048)', () => {
    // Pointer at (762, 1524) (sheet center) tested against the long-edge segment.
    const d = distSqPointSegment(762, 1524, 0, 0, 1524, 0)
    // Closest = (762, 0); squared = 1524^2.
    expect(d).toBeCloseTo(1524 * 1524, 5)
  })

  it('screenToWorld at high-DPR (scale=2) at canvas center maps to (ox, oy)', () => {
    const [wx, wy] = screenToWorld(800, 600, 1600, 1200, 2, 0, 0)
    expect(wx).toBeCloseTo(0, 5)
    expect(wy).toBeCloseTo(0, 5)
  })
})

// ---------------------------------------------------------------------------
// J. Type-level parity
// ---------------------------------------------------------------------------
describe('J. Type-level parity -- return shapes', () => {
  it('screenToWorld returns a [number, number] tuple (length 2)', () => {
    const r = screenToWorld(0, 0, 100, 100, 1, 0, 0)
    expect(r.length).toBe(2)
    expect(typeof r[0]).toBe('number')
    expect(typeof r[1]).toBe('number')
  })

  it('clientToCanvasLocal returns a [number, number] tuple (length 2)', () => {
    const canvas = {
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) })
    } as unknown as HTMLCanvasElement
    const r = clientToCanvasLocal(0, 0, canvas)
    expect(r.length).toBe(2)
  })

  it('snap returns a number', () => {
    expect(typeof snap(1, 0.5)).toBe('number')
  })

  it('niceStepMm returns a number', () => {
    expect(typeof niceStepMm(1)).toBe('number')
  })

  it('distSqPointSegment returns a number (always non-negative)', () => {
    const r = distSqPointSegment(0, 0, 1, 0, 0, 1)
    expect(typeof r).toBe('number')
  })

  it('source declares all exports with explicit return type annotations', () => {
    expect(SOURCE).toMatch(/screenToWorld\([\s\S]*?\):\s*\[number,\s*number\]/)
    expect(SOURCE).toMatch(/clientToCanvasLocal\([\s\S]*?\):\s*\[number,\s*number\]/)
    expect(SOURCE).toMatch(/snap\(\s*v:\s*number,\s*step:\s*number\s*\):\s*number/)
    expect(SOURCE).toMatch(/niceStepMm\(\s*stepMm:\s*number\s*\):\s*number/)
    expect(SOURCE).toMatch(/distSqPointSegment\([\s\S]*?\):\s*number/)
  })
})
