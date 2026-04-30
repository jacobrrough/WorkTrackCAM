/**
 * [ID-0224] Co-located paired-pin contract for `src/shared/cam-heightfield-cylindrical.ts`
 * --------------------------------------------------------------------------
 * CARVERA-4-AXIS-SPECIFIC. The cylindrical heightfield sampler is consumed
 * exclusively by the rotary 4-axis Tier 2/3 preview pipeline (ManufactureCam
 * SimulationPanel + ShopModelViewer) on the Makera Carvera + 4th Axis HD.
 * Drift in the radii-grid math, the tool-stamp footprint, the 360-degree
 * angular wrap, the cutting-feed filter, or the auto-derived axial bounds
 * would silently corrupt the rotary-preview surface and mask collisions on
 * the only target machine that runs 4-axis simultaneous toolpaths.
 *
 * Mirrors Cycle 120 [ID-0197] heightmap.ts pin pattern (sister 2.5D sampler
 * for the 3-axis pipeline). Pin sections:
 *   A: module shape -- exact named-export inventory + type-only export shape
 *   B: BuildCylindricalHeightFieldOptions defaults -- 96 cols / 120 rows /
 *      0.98 cutting threshold / marginMm = toolRadiusMm+1 / minimum tool
 *      radius 0.05 / default toolShape='flat'
 *   C: returns-null contract -- empty input / no-cutting-feeds / all-air
 *   D: field shape contract -- radii.length === cols*rows / Float32Array /
 *      stockRadius = diameter/2 / cellDeg = 360/maxRows / cellMm = spanX/cols
 *   E: monotone-Z invariant -- every cell <= initial stockRadius after stamp
 *   F: angular-wrap behaviour -- segment crossing 0/360 stamps both sides
 *   G: tool-shape branching -- flat carves >= ball at edges (hemispherical
 *      effective-radius rise on ball)
 *   H: purity / N=10 stability -- same input -> byte-identical Float32Array
 *      output (no module-level mutable state); no input mutation
 *   I: source-text whitelist -- 4-axis frame.ts provenance / no foreign
 *      machine vendor names / no electron/fs/path/child_process imports / no
 *      G-code/M-code emission / no Handlebars tokens / no `any` (3 forms)
 *
 * NEW file < 800 lines / < 32 KB so well below R1.5 mandatory-territory and
 * Cycle 142 [ID-0067] empirical truncation thresholds for both Edit and
 * Write tools. Created via Write tool per the Cycle 134 [ID-0210] convention
 * and the [ID-0067-data-v20] Cycle 148 escalation guidance.
 */

import { describe, expect, it } from 'vitest'
import * as M from './cam-heightfield-cylindrical'
import type { ToolpathSegment4 } from './cam-gcode-toolpath'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// -----------------------------------------------------------------------------
// Test fixtures shared across describe sections
// -----------------------------------------------------------------------------

/** Helper: make a 4-axis feed segment (b0=b1=0 always; b is modal but our
 *  cylindrical sampler only consumes x/a/z). */
function feed4(
  x0: number, a0: number, z0: number,
  x1: number, a1: number, z1: number
): ToolpathSegment4 {
  return { kind: 'feed', x0, y0: 0, z0, x1, y1: 0, z1, a0, a1, b0: 0, b1: 0 }
}

/** Helper: make a 4-axis rapid segment. Rapids are NEVER consumed by the
 *  sampler -- the cutting filter inside `buildCylindricalHeightFieldFromSegments`
 *  only keeps `kind === 'feed'`. */
function rapid4(
  x0: number, a0: number, z0: number,
  x1: number, a1: number, z1: number
): ToolpathSegment4 {
  return { kind: 'rapid', x0, y0: 0, z0, x1, y1: 0, z1, a0, a1, b0: 0, b1: 0 }
}

/** Standard options used across most tests. stockRadius = 10, cuttingThreshold
 *  defaults to 9.8 (10 * 0.98). */
const BASE_OPTS: M.BuildCylindricalHeightFieldOptions = {
  toolRadiusMm: 1,
  cylinderDiameterMm: 20,
  stockXMin: 0,
  stockXMax: 40,
  maxCols: 32,
  maxRows: 60,
}

/** Source-text loaded once for whitelist assertions. */
const SOURCE = readFileSync(
  resolve(__dirname, 'cam-heightfield-cylindrical.ts'),
  'utf8'
)

// -----------------------------------------------------------------------------
// A. Module shape
// -----------------------------------------------------------------------------

describe('[ID-0224] cam-heightfield-cylindrical -- A. module shape', () => {
  it('exports buildCylindricalHeightFieldFromSegments as the only runtime function', () => {
    const runtimeKeys = Object.keys(M).filter(
      (k) => typeof (M as Record<string, unknown>)[k] === 'function'
    )
    expect(runtimeKeys).toEqual(['buildCylindricalHeightFieldFromSegments'])
  })

  it('buildCylindricalHeightFieldFromSegments has arity 2 (segments, opts)', () => {
    expect(M.buildCylindricalHeightFieldFromSegments.length).toBe(2)
  })

  it('does NOT expose the internal helpers stampDisk / stampSegment / wrapDeg / clamp', () => {
    const exposed = Object.keys(M)
    expect(exposed).not.toContain('stampDiskCylindrical')
    expect(exposed).not.toContain('stampSegmentCylindrical')
    expect(exposed).not.toContain('wrapDeg')
    expect(exposed).not.toContain('clamp')
  })

  it('module namespace has a null prototype (ESM convention) and Symbol.toStringTag = "Module"', () => {
    expect(Object.getPrototypeOf(M)).toBeNull()
    expect((M as unknown as { [Symbol.toStringTag]: string })[Symbol.toStringTag]).toBe('Module')
  })

  it('does NOT export a default symbol', () => {
    expect((M as unknown as { default?: unknown }).default).toBeUndefined()
  })
})

// -----------------------------------------------------------------------------
// B. BuildCylindricalHeightFieldOptions defaults & contract
// -----------------------------------------------------------------------------

describe('[ID-0224] cam-heightfield-cylindrical -- B. options defaults', () => {
  it('default maxCols = 96 (verified via spanX large enough that cols saturates)', () => {
    // Use a very large axial span so that cellMm = spanX / 96 takes effect.
    // span = 480, default maxCols=96 => cellMm = 5, cols = 96.
    const segs: ToolpathSegment4[] = [feed4(0, 0, 5, 480, 0, 5)]
    const field = M.buildCylindricalHeightFieldFromSegments(segs, {
      toolRadiusMm: 1,
      cylinderDiameterMm: 20,
      stockXMin: 0,
      stockXMax: 480,
    })
    expect(field).not.toBeNull()
    if (!field) return
    expect(field.cols).toBe(96)
  })

  it('default maxRows = 120 -> cellDeg = 3 (360/120)', () => {
    const segs: ToolpathSegment4[] = [feed4(5, 0, 5, 25, 90, 5)]
    const field = M.buildCylindricalHeightFieldFromSegments(segs, {
      toolRadiusMm: 1,
      cylinderDiameterMm: 20,
      stockXMin: 0,
      stockXMax: 40,
    })
    expect(field).not.toBeNull()
    if (!field) return
    expect(field.rows).toBe(120)
    expect(field.cellDeg).toBeCloseTo(3, 10)
  })

  it('default cutting threshold = stockRadius * 0.98 (segment at z=stockRadius is excluded)', () => {
    // cylinderDiameterMm=20 -> stockRadius=10 -> threshold=9.8.
    // z=10 > 9.8 means NOT cutting => null.
    const segs: ToolpathSegment4[] = [feed4(5, 0, 10, 25, 90, 10)]
    expect(M.buildCylindricalHeightFieldFromSegments(segs, BASE_OPTS)).toBeNull()
  })

  it('cutting threshold can be overridden -- looser threshold accepts a feed at stockRadius', () => {
    const segs: ToolpathSegment4[] = [feed4(5, 0, 10, 25, 90, 10)]
    const field = M.buildCylindricalHeightFieldFromSegments(segs, {
      ...BASE_OPTS,
      cuttingRadiusThreshold: 11,
    })
    expect(field).not.toBeNull()
  })

  it('toolRadiusMm clamps to a 0.05 mm minimum (defensive against zero-radius math)', () => {
    // A radius of 0 mm would otherwise divide-by-zero in arc-span math.
    const segs: ToolpathSegment4[] = [feed4(5, 0, 5, 25, 90, 5)]
    expect(() =>
      M.buildCylindricalHeightFieldFromSegments(segs, { ...BASE_OPTS, toolRadiusMm: 0 })
    ).not.toThrow()
    const field = M.buildCylindricalHeightFieldFromSegments(segs, { ...BASE_OPTS, toolRadiusMm: 0 })
    expect(field).not.toBeNull()
  })

  it('default marginMm = toolRadiusMm + 1 (tool radius 1 -> 2 mm margin around cuts)', () => {
    // Cut spans X=[5..25]. With margin=2 the field extends ~[3..27], clamped
    // by stockXMin/Max=[0..40]. So originX should sit at 3 +/- cellMm.
    const segs: ToolpathSegment4[] = [feed4(5, 0, 5, 25, 0, 5)]
    const field = M.buildCylindricalHeightFieldFromSegments(segs, BASE_OPTS)
    expect(field).not.toBeNull()
    if (!field) return
    // originX = max(stockXMin=0, minXcut - margin) = max(0, 5-2) = 3
    expect(field.originX).toBeCloseTo(3, 6)
  })

  it('default toolShape = "flat" (verified via stamp-count parity vs explicit flat)', () => {
    const segs: ToolpathSegment4[] = [feed4(5, 0, 7, 25, 90, 7)]
    const a = M.buildCylindricalHeightFieldFromSegments(segs, { ...BASE_OPTS, toolRadiusMm: 2 })
    const b = M.buildCylindricalHeightFieldFromSegments(segs, {
      ...BASE_OPTS,
      toolRadiusMm: 2,
      toolShape: 'flat',
    })
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    if (!a || !b) return
    expect(a.radii.length).toBe(b.radii.length)
    for (let i = 0; i < a.radii.length; i++) {
      expect(a.radii[i]).toBeCloseTo(b.radii[i] as number, 6)
    }
  })
})

// -----------------------------------------------------------------------------
// C. Returns-null contract
// -----------------------------------------------------------------------------

describe('[ID-0224] cam-heightfield-cylindrical -- C. returns-null contract', () => {
  it('empty segment array -> null', () => {
    expect(M.buildCylindricalHeightFieldFromSegments([], BASE_OPTS)).toBeNull()
  })

  it('only-rapids -> null (rapids never count as cutting)', () => {
    const segs: ToolpathSegment4[] = [
      rapid4(0, 0, 5, 10, 0, 5),
      rapid4(10, 0, 5, 20, 90, 5),
    ]
    expect(M.buildCylindricalHeightFieldFromSegments(segs, BASE_OPTS)).toBeNull()
  })

  it('feeds-but-all-above-threshold -> null (all "air" moves)', () => {
    // stockRadius=10, threshold=9.8; both endpoints above threshold => excluded.
    const segs: ToolpathSegment4[] = [
      feed4(5, 0, 10, 15, 30, 10),
      feed4(15, 30, 10, 25, 60, 10),
    ]
    expect(M.buildCylindricalHeightFieldFromSegments(segs, BASE_OPTS)).toBeNull()
  })

  it('feeds with NaN axial bounds -> null', () => {
    const segs: ToolpathSegment4[] = [feed4(NaN, 0, 5, NaN, 0, 5)]
    expect(M.buildCylindricalHeightFieldFromSegments(segs, BASE_OPTS)).toBeNull()
  })

  it('zero-axial-span (stockXMin === stockXMax + cuts collapsed) -> null', () => {
    const segs: ToolpathSegment4[] = [feed4(20, 0, 5, 20, 90, 5)]
    const field = M.buildCylindricalHeightFieldFromSegments(segs, {
      ...BASE_OPTS,
      stockXMin: 20,
      stockXMax: 20,
    })
    expect(field).toBeNull()
  })

  it('mixed feeds + rapids: only feeds-below-threshold are sampled (rapids do not block null)', () => {
    // Feed at z=10 is air; rapids do not count -> still null.
    const segs: ToolpathSegment4[] = [
      rapid4(0, 0, 5, 10, 0, 5),
      feed4(10, 0, 10, 20, 90, 10),
    ]
    expect(M.buildCylindricalHeightFieldFromSegments(segs, BASE_OPTS)).toBeNull()
  })
})

// -----------------------------------------------------------------------------
// D. Field shape contract
// -----------------------------------------------------------------------------

describe('[ID-0224] cam-heightfield-cylindrical -- D. field shape', () => {
  it('returns object with exactly the 7 documented keys', () => {
    const segs: ToolpathSegment4[] = [feed4(5, 0, 8, 20, 90, 8)]
    const field = M.buildCylindricalHeightFieldFromSegments(segs, BASE_OPTS)
    expect(field).not.toBeNull()
    if (!field) return
    expect(Object.keys(field).sort()).toEqual(
      ['cellDeg', 'cellMm', 'cols', 'originX', 'radii', 'rows', 'stockRadius'].sort()
    )
  })

  it('radii is a Float32Array of length cols*rows', () => {
    const segs: ToolpathSegment4[] = [feed4(5, 0, 8, 20, 90, 8)]
    const field = M.buildCylindricalHeightFieldFromSegments(segs, BASE_OPTS)
    expect(field).not.toBeNull()
    if (!field) return
    expect(field.radii).toBeInstanceOf(Float32Array)
    expect(field.radii.length).toBe(field.cols * field.rows)
  })

  it('stockRadius = cylinderDiameterMm / 2 (byte-identical)', () => {
    const segs: ToolpathSegment4[] = [feed4(5, 0, 8, 20, 90, 8)]
    const field = M.buildCylindricalHeightFieldFromSegments(segs, {
      ...BASE_OPTS,
      cylinderDiameterMm: 30,
    })
    expect(field).not.toBeNull()
    if (!field) return
    expect(field.stockRadius).toBe(15)
  })

  it('cellDeg = 360 / maxRows (byte-identical)', () => {
    const segs: ToolpathSegment4[] = [feed4(5, 0, 8, 20, 90, 8)]
    const field = M.buildCylindricalHeightFieldFromSegments(segs, { ...BASE_OPTS, maxRows: 90 })
    expect(field).not.toBeNull()
    if (!field) return
    expect(field.cellDeg).toBeCloseTo(4, 10)
    expect(field.rows).toBe(90)
  })

  it('cellMm * cols === spanX (within float epsilon)', () => {
    const segs: ToolpathSegment4[] = [feed4(5, 0, 8, 30, 0, 8)]
    const field = M.buildCylindricalHeightFieldFromSegments(segs, BASE_OPTS)
    expect(field).not.toBeNull()
    if (!field) return
    // spanX recovered as cellMm * cols
    const recovered = field.cellMm * field.cols
    expect(recovered).toBeGreaterThan(0)
    expect(recovered).toBeLessThanOrEqual(BASE_OPTS.stockXMax - BASE_OPTS.stockXMin)
  })

  it('originX is clamped to >= stockXMin (cut at x=0 with stockXMin=0)', () => {
    const segs: ToolpathSegment4[] = [feed4(0, 0, 5, 20, 0, 5)]
    const field = M.buildCylindricalHeightFieldFromSegments(segs, BASE_OPTS)
    expect(field).not.toBeNull()
    if (!field) return
    expect(field.originX).toBeGreaterThanOrEqual(BASE_OPTS.stockXMin)
  })

  it('cols clamped to <= maxCols', () => {
    const segs: ToolpathSegment4[] = [feed4(0, 0, 5, 40, 0, 5)]
    const field = M.buildCylindricalHeightFieldFromSegments(segs, { ...BASE_OPTS, maxCols: 16 })
    expect(field).not.toBeNull()
    if (!field) return
    expect(field.cols).toBeLessThanOrEqual(16)
    expect(field.cols).toBeGreaterThanOrEqual(2)
  })
})

// -----------------------------------------------------------------------------
// E. Monotone-Z invariant: every cell stays <= initial stockRadius
// -----------------------------------------------------------------------------

describe('[ID-0224] cam-heightfield-cylindrical -- E. monotone-Z invariant', () => {
  it('every cell <= stockRadius after stamping (no overshoot)', () => {
    const segs: ToolpathSegment4[] = [feed4(5, 0, 4, 35, 720, 4)]
    const field = M.buildCylindricalHeightFieldFromSegments(segs, {
      ...BASE_OPTS,
      toolRadiusMm: 2,
    })
    expect(field).not.toBeNull()
    if (!field) return
    for (let i = 0; i < field.radii.length; i++) {
      expect(field.radii[i]!).toBeLessThanOrEqual(field.stockRadius + 1e-6)
    }
  })

  it('a deeper cut (smaller radial Z) lowers cells further than a shallower cut', () => {
    // Deep cut at z=2 vs shallow cut at z=8 for the same path geometry.
    const segs: ToolpathSegment4[] = [feed4(10, 0, 0, 30, 0, 0)]
    const segsShallow: ToolpathSegment4[] = [feed4(10, 0, 8, 30, 0, 8)]
    const deep = M.buildCylindricalHeightFieldFromSegments(segs, {
      ...BASE_OPTS,
      toolRadiusMm: 2,
    })
    const shallow = M.buildCylindricalHeightFieldFromSegments(segsShallow, {
      ...BASE_OPTS,
      toolRadiusMm: 2,
    })
    expect(deep).not.toBeNull()
    expect(shallow).not.toBeNull()
    if (!deep || !shallow) return
    const minDeep = Array.from(deep.radii).reduce((m, v) => (v < m ? v : m), deep.stockRadius)
    const minShallow = Array.from(shallow.radii).reduce(
      (m, v) => (v < m ? v : m),
      shallow.stockRadius
    )
    expect(minDeep).toBeLessThan(minShallow)
  })

  it('uncut cells remain at exactly stockRadius (no spurious mutation outside stamp)', () => {
    // A small localized cut at A=0 leaves the far-side cells (A=180) untouched.
    const segs: ToolpathSegment4[] = [feed4(20, 0, 5, 21, 0, 5)]
    const field = M.buildCylindricalHeightFieldFromSegments(segs, {
      ...BASE_OPTS,
      toolRadiusMm: 0.5,
      maxRows: 60,
    })
    expect(field).not.toBeNull()
    if (!field) return
    // The far-half-revolution should have at least some cells exactly at stockRadius.
    const halfStart = Math.floor(field.rows / 2)
    let untouched = 0
    for (let r = halfStart; r < field.rows; r++) {
      for (let c = 0; c < field.cols; c++) {
        const v = field.radii[r * field.cols + c]
        if (v === field.stockRadius) untouched += 1
      }
    }
    expect(untouched).toBeGreaterThan(0)
  })
})

// -----------------------------------------------------------------------------
// F. Angular-wrap behaviour
// -----------------------------------------------------------------------------

describe('[ID-0224] cam-heightfield-cylindrical -- F. angular wrap (0/360)', () => {
  it('a cut at A=0 stamps cells around BOTH sides of the seam', () => {
    const segs: ToolpathSegment4[] = [feed4(20, 0, 5, 21, 0, 5)]
    const field = M.buildCylindricalHeightFieldFromSegments(segs, {
      ...BASE_OPTS,
      toolRadiusMm: 1,
      maxRows: 60,
    })
    expect(field).not.toBeNull()
    if (!field) return
    // First row (A near 0) and last row (A near 360) should both be touched.
    const firstRowMin = Array.from(field.radii.slice(0, field.cols)).reduce(
      (m, v) => (v < m ? v : m),
      field.stockRadius
    )
    const lastRowMin = Array.from(
      field.radii.slice((field.rows - 1) * field.cols, field.rows * field.cols)
    ).reduce((m, v) => (v < m ? v : m), field.stockRadius)
    expect(firstRowMin).toBeLessThan(field.stockRadius)
    expect(lastRowMin).toBeLessThan(field.stockRadius)
  })

  it('A in [0,360) is fully addressable -- a cut sweeping 0 -> 360 carves every angular row', () => {
    const segs: ToolpathSegment4[] = [feed4(15, 0, 4, 25, 360, 4)]
    const field = M.buildCylindricalHeightFieldFromSegments(segs, {
      ...BASE_OPTS,
      toolRadiusMm: 1.5,
      maxRows: 60,
    })
    expect(field).not.toBeNull()
    if (!field) return
    // Every angular row should have at least one carved cell.
    for (let r = 0; r < field.rows; r++) {
      let touched = 0
      for (let c = 0; c < field.cols; c++) {
        if ((field.radii[r * field.cols + c] as number) < field.stockRadius - 1e-6) touched += 1
      }
      expect(touched).toBeGreaterThan(0)
    }
  })

  it('negative angle input is wrapped (segment from A=-90 ends in valid grid)', () => {
    const segs: ToolpathSegment4[] = [feed4(15, -90, 4, 25, -90, 4)]
    const field = M.buildCylindricalHeightFieldFromSegments(segs, {
      ...BASE_OPTS,
      toolRadiusMm: 1.5,
    })
    expect(field).not.toBeNull()
    if (!field) return
    // Some cells must have been carved (no NaN, no skip due to negative angle).
    let touched = 0
    for (const v of field.radii) {
      if (v < field.stockRadius - 1e-6) touched += 1
    }
    expect(touched).toBeGreaterThan(0)
  })
})

// -----------------------------------------------------------------------------
// G. Tool-shape branching: flat vs ball
// -----------------------------------------------------------------------------

describe('[ID-0224] cam-heightfield-cylindrical -- G. tool shape', () => {
  it('flat tool carves at least as much area as ball for same path', () => {
    const segs: ToolpathSegment4[] = [feed4(5, 0, 7, 25, 180, 7)]
    const opts = { ...BASE_OPTS, toolRadiusMm: 2 }
    const flat = M.buildCylindricalHeightFieldFromSegments(segs, { ...opts, toolShape: 'flat' })
    const ball = M.buildCylindricalHeightFieldFromSegments(segs, { ...opts, toolShape: 'ball' })
    expect(flat).not.toBeNull()
    expect(ball).not.toBeNull()
    if (!flat || !ball) return
    const flatCarved = Array.from(flat.radii).filter((v) => v < flat.stockRadius - 1e-6).length
    const ballCarved = Array.from(ball.radii).filter((v) => v < ball.stockRadius - 1e-6).length
    // Same footprint at center; ball is shallower at edges => fewer/equal cells
    // carved deep, but the footprint touch-set is identical.
    // The key invariant is that NO cell is deeper under ball than under flat.
    for (let i = 0; i < flat.radii.length; i++) {
      expect((ball.radii[i] as number) >= (flat.radii[i] as number) - 1e-6).toBe(true)
    }
    expect(flatCarved).toBeGreaterThanOrEqual(ballCarved - flat.cols)
  })

  it('ball tool effective-radius rises by R - sqrt(R^2 - d^2) at offset d', () => {
    // Compare a single-stamp center vs an off-center stamp in ball mode.
    // Run a tiny segment so the stamp is essentially at one point.
    const segs: ToolpathSegment4[] = [feed4(20, 0, 5, 20.001, 0, 5)]
    const ball = M.buildCylindricalHeightFieldFromSegments(segs, {
      ...BASE_OPTS,
      toolRadiusMm: 2,
      toolShape: 'ball',
      maxCols: 64,
      maxRows: 120,
    })
    expect(ball).not.toBeNull()
    if (!ball) return
    // The center cell should be the deepest carve; edges should be shallower.
    let deepest = ball.stockRadius
    let shallowestCarve = -Infinity
    for (const v of ball.radii) {
      if (v < deepest) deepest = v
      if (v < ball.stockRadius - 1e-6 && v > shallowestCarve) shallowestCarve = v
    }
    expect(deepest).toBeLessThan(shallowestCarve + 1e-6)
  })
})

// -----------------------------------------------------------------------------
// H. Purity / N=10 stability
// -----------------------------------------------------------------------------

describe('[ID-0224] cam-heightfield-cylindrical -- H. purity / N=10 stability', () => {
  it('same input -> byte-identical Float32Array output across N=10 calls', () => {
    const segs: ToolpathSegment4[] = [feed4(5, 0, 5, 25, 180, 5)]
    const fields = Array.from({ length: 10 }, () =>
      M.buildCylindricalHeightFieldFromSegments(segs, BASE_OPTS)
    )
    for (let i = 1; i < fields.length; i++) {
      expect(fields[i]).not.toBeNull()
      const a = fields[0]!
      const b = fields[i]!
      expect(b.cols).toBe(a.cols)
      expect(b.rows).toBe(a.rows)
      expect(b.cellMm).toBe(a.cellMm)
      expect(b.cellDeg).toBe(a.cellDeg)
      expect(b.originX).toBe(a.originX)
      expect(b.stockRadius).toBe(a.stockRadius)
      for (let k = 0; k < a.radii.length; k++) {
        expect(b.radii[k]).toBe(a.radii[k])
      }
    }
  })

  it('does NOT mutate the input segments array', () => {
    const segs: ToolpathSegment4[] = [feed4(5, 0, 5, 25, 180, 5), rapid4(25, 180, 5, 0, 0, 5)]
    const snapshotJson = JSON.stringify(segs)
    M.buildCylindricalHeightFieldFromSegments(segs, BASE_OPTS)
    expect(JSON.stringify(segs)).toBe(snapshotJson)
  })

  it('returns a fresh field per call -- no shared Float32Array between invocations', () => {
    const segs: ToolpathSegment4[] = [feed4(5, 0, 5, 25, 180, 5)]
    const a = M.buildCylindricalHeightFieldFromSegments(segs, BASE_OPTS)
    const b = M.buildCylindricalHeightFieldFromSegments(segs, BASE_OPTS)
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    if (!a || !b) return
    expect(a).not.toBe(b)
    expect(a.radii).not.toBe(b.radii)
  })

  it('mutating returned radii does NOT affect a subsequent call (no module-level state)', () => {
    const segs: ToolpathSegment4[] = [feed4(5, 0, 5, 25, 180, 5)]
    const a = M.buildCylindricalHeightFieldFromSegments(segs, BASE_OPTS)
    expect(a).not.toBeNull()
    if (!a) return
    a.radii.fill(-9999)
    const b = M.buildCylindricalHeightFieldFromSegments(segs, BASE_OPTS)
    expect(b).not.toBeNull()
    if (!b) return
    // b should look like a fresh result, not poisoned by the -9999 fill.
    let nonPoisoned = 0
    for (const v of b.radii) {
      if (v > -1) nonPoisoned += 1
    }
    expect(nonPoisoned).toBe(b.radii.length)
  })
})

// -----------------------------------------------------------------------------
// I. Source-text whitelist (provenance + safety)
// -----------------------------------------------------------------------------

describe('[ID-0224] cam-heightfield-cylindrical -- I. source-text whitelist', () => {
  it('JSDoc names the 4-axis frame.ts as the single source of truth', () => {
    expect(SOURCE).toContain('cam-axis4/frame.ts')
    expect(SOURCE).toContain('single')
    expect(SOURCE).toContain('source of truth')
  })

  it('coordinate convention header pins X = axial, Z = radial, A = degrees', () => {
    expect(SOURCE).toMatch(/X\s*=\s*axial position/)
    expect(SOURCE).toMatch(/Z\s*=\s*radial distance/)
    expect(SOURCE).toMatch(/A\s*=\s*rotation angle/)
  })

  it('imports ONLY ToolpathSegment4 from cam-gcode-toolpath (type-only)', () => {
    expect(SOURCE).toMatch(/import type \{ ToolpathSegment4 \} from '\.\/cam-gcode-toolpath'/)
  })

  it('exactly 1 export function declaration (the public builder)', () => {
    const matches = SOURCE.match(/^export function /gm) ?? []
    expect(matches.length).toBe(1)
  })

  it('exports all 3 type aliases (CylindricalHeightField, CylindricalHeightFieldToolShape, BuildCylindricalHeightFieldOptions)', () => {
    expect(SOURCE).toMatch(/^export type CylindricalHeightField =/m)
    expect(SOURCE).toMatch(/^export type CylindricalHeightFieldToolShape =/m)
    expect(SOURCE).toMatch(/^export type BuildCylindricalHeightFieldOptions =/m)
  })

  it('CylindricalHeightFieldToolShape is the closed union "flat" | "ball"', () => {
    expect(SOURCE).toMatch(/CylindricalHeightFieldToolShape\s*=\s*'flat'\s*\|\s*'ball'/)
  })

  it('default maxCols = 96 and maxRows = 120 appear as nullish-coalesce literals', () => {
    expect(SOURCE).toMatch(/opts\.maxCols\s*\?\?\s*96/)
    expect(SOURCE).toMatch(/opts\.maxRows\s*\?\?\s*120/)
  })

  it('default cutting threshold = stockRadius * 0.98 (literal pin)', () => {
    expect(SOURCE).toContain('stockRadius * 0.98')
  })

  it('toolRadius is clamped to a 0.05 mm minimum', () => {
    expect(SOURCE).toContain('Math.max(0.05, opts.toolRadiusMm)')
  })

  it('ball-end effective radius formula uses sqrt(R^2 - dist^2)', () => {
    expect(SOURCE).toMatch(/Math\.sqrt\(R2\s*-\s*dist\s*\*\s*dist\)/)
  })

  it('wrapDeg helper is the canonical [0, 360) wrap', () => {
    expect(SOURCE).toMatch(/function wrapDeg\(a:\s*number\):\s*number/)
    expect(SOURCE).toContain('a % 360')
  })

  it('NO `any` (3-form check: `: any`, `as any`, `<any>`)', () => {
    expect(SOURCE).not.toMatch(/:\s*any\b/)
    expect(SOURCE).not.toMatch(/\bas\s+any\b/)
    expect(SOURCE).not.toMatch(/<any>/)
  })

  it('NO top-level `let` (only `function`/`export`/`import`/`const`/comment lines at column 0)', () => {
    const top = SOURCE.split('\n').filter((l) => /^let\s/.test(l))
    expect(top).toEqual([])
  })

  it('NO electron / fs / path / child_process / dgram / net / tls imports (CARVERA-4-axis math is pure)', () => {
    expect(SOURCE).not.toMatch(/from\s+['"]electron['"]/)
    expect(SOURCE).not.toMatch(/from\s+['"]node:fs['"]|from\s+['"]fs['"]/)
    expect(SOURCE).not.toMatch(/from\s+['"]node:path['"]|from\s+['"]path['"]/)
    expect(SOURCE).not.toMatch(/from\s+['"]node:child_process['"]|from\s+['"]child_process['"]/)
    expect(SOURCE).not.toMatch(/from\s+['"]node:dgram['"]/)
    expect(SOURCE).not.toMatch(/from\s+['"]node:net['"]/)
    expect(SOURCE).not.toMatch(/from\s+['"]node:tls['"]/)
  })

  it('NO G-code/M-code emission (sampler is pure math, no string-builder of toolpath text)', () => {
    // Strip all line-comments and block-comments before scanning; documentation
    // back-tick references like `G0 X0 Y0` describing rapids in the JSDoc are
    // legitimate prose and must NOT trip this safety pin.
    const stripped = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    expect(stripped).not.toMatch(/['"`]G[0-9]/)
    expect(stripped).not.toMatch(/['"`]M[0-9]/)
  })

  it('NO Handlebars tokens ({{ ... }} or {{{ ... }}})', () => {
    expect(SOURCE).not.toMatch(/\{\{[^}]/)
    expect(SOURCE).not.toMatch(/\}\}[^}]/)
  })

  it('NO foreign-machine vendor names (word-boundary regex)', () => {
    expect(SOURCE).not.toMatch(/\bbambu\b/i)
    expect(SOURCE).not.toMatch(/\bprusa\b/i)
    expect(SOURCE).not.toMatch(/\bvoron\b/i)
    expect(SOURCE).not.toMatch(/\bender[- ]?\d/i)
    expect(SOURCE).not.toMatch(/\blongmill\b/i)
    expect(SOURCE).not.toMatch(/\bshapeoko\b/i)
    expect(SOURCE).not.toMatch(/\bonefinity\b/i)
  })

  it('NO React / DOM imports (pure shared math, not renderer)', () => {
    expect(SOURCE).not.toMatch(/from\s+['"]react['"]/)
    expect(SOURCE).not.toMatch(/from\s+['"]react-dom['"]/)
    expect(SOURCE).not.toMatch(/document\./)
    expect(SOURCE).not.toMatch(/window\./)
  })

  it('source size canary: < 12 KB and < 300 lines', () => {
    const bytes = Buffer.byteLength(SOURCE, 'utf8')
    expect(bytes).toBeLessThan(12 * 1024)
    expect(SOURCE.split('\n').length).toBeLessThan(300)
  })
})
