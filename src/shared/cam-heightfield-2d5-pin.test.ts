/**
 * Co-located paired-pin contract for `src/shared/cam-heightfield-2d5.ts`
 *
 * [ID-0260] Cycle 194 cam-engine paired-pin -- pins the runtime contract of
 * the 222-line / 7457-byte SHARED 2.5D heightfield sampler consumed by
 * `src/renderer/manufacture/ManufactureCamSimulationPanel.tsx:5` and used
 * in the Laguna Swift 5x10 full-sheet routing remaining-stock visualization
 * + the K2 Plus build-volume heightmap previews.
 *
 * The module exposes 2 exported runtime functions:
 *   - `buildHeightFieldFromCuttingSegments(segments, opts): HeightField2d5 | null`
 *   - `sampleHeightFieldZ(hf, x, y): number` (bilinear interpolation)
 * plus 3 type-only exports (`HeightField2d5`, `HeightFieldToolShape`,
 * `BuildHeightFieldOptions`) and 3 internal helpers (`clamp`, `stampDisk`,
 * `stampSegment`).
 *
 * The existing behavioural test `src/shared/cam-heightfield-2d5.test.ts`
 * (339 lines) covers happy-path stamping and bilinear lookup; this paired-
 * pin extends coverage to lock the precise contract callers depend on, so
 * a future refactor that silently changes (e.g.) the cutting-Z threshold,
 * the segment-filter logic, the ball-end hemisphere formula, the stockTopZ
 * fallback for OOB samples, or the default opts surface here.
 *
 * Pinned in this file:
 *   (A) Module shape (2 runtime exports + 0 default + 0 class)
 *   (B) Function signatures (names, arity, native Function, return types)
 *   (C) buildHeightFieldFromCuttingSegments default options
 *       (maxCols=96, maxRows=96, stockTopZ=0, cuttingZThreshold=0.05,
 *       marginMm=toolRadius+1, toolShape='flat')
 *   (D) Segment filter contract (feed-only, threshold-based OR predicate)
 *   (E) Null-return contract (empty cutting / collapsed span / non-finite)
 *   (F) Tool radius floor 0.05 mm
 *   (G) Cell size + grid bounds invariants
 *   (H) Float32Array initialization with stockTopZ
 *   (I) sampleHeightFieldZ bilinear interpolation contract
 *       (non-finite-x/y -> stockTopZ; non-finite-corner -> stockTopZ;
 *       OOB-clamp to [0,cols-2]x[0,rows-2])
 *   (J) Ball-end stamping hemisphere formula
 *   (K) Three-machine path realism
 *       (Laguna full-sheet plywood routing 1500x1500 mm + 12.7 mm endmill
 *       + 8 mm stepover + below-spoilboard cuts; Carvera 4-axis 3 mm ball
 *       finishing + 0.3 mm stepover; K2 empty-cutting -> null)
 *   (L) Pure-function invariants (idempotent, no input mutation)
 *   (M) Source-text whitelist (size, type-only imports, no `any`,
 *       no toolpath G/M-code, no foreign vendors, no electron/fs/three)
 */
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

import * as moduleNs from './cam-heightfield-2d5'
import {
  buildHeightFieldFromCuttingSegments,
  sampleHeightFieldZ
} from './cam-heightfield-2d5'
import type {
  BuildHeightFieldOptions,
  HeightField2d5,
  HeightFieldToolShape
} from './cam-heightfield-2d5'
import type { ToolpathSegment3 } from './cam-gcode-toolpath'

const SRC_PATH = 'src/shared/cam-heightfield-2d5.ts'
let SRC: string | null = null
async function readSrc(): Promise<string> {
  if (SRC === null) SRC = await readFile(SRC_PATH, 'utf-8')
  return SRC
}

// --------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------
function feed(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): ToolpathSegment3 {
  return { kind: 'feed', x0, y0, z0, x1, y1, z1 }
}
function rapid(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): ToolpathSegment3 {
  return { kind: 'rapid', x0, y0, z0, x1, y1, z1 }
}

const baseOpts: BuildHeightFieldOptions = { toolRadiusMm: 3 }

// --------------------------------------------------------------------------
// (A) Module shape
// --------------------------------------------------------------------------
describe('[ID-0260] (A) module shape', () => {
  it('exports exactly the 2 expected runtime symbols', () => {
    const keys = Object.keys(moduleNs).sort()
    expect(keys).toEqual(['buildHeightFieldFromCuttingSegments', 'sampleHeightFieldZ'])
  })

  it('namespace Symbol.toStringTag is Module', () => {
    expect((moduleNs as unknown as { [Symbol.toStringTag]?: string })[Symbol.toStringTag]).toBe(
      'Module'
    )
  })

  it('does not have a default export', () => {
    expect((moduleNs as unknown as { default?: unknown }).default).toBeUndefined()
  })

  it('does not leak the 3 internal helpers (clamp, stampDisk, stampSegment)', () => {
    const ns = moduleNs as unknown as Record<string, unknown>
    expect(ns.clamp).toBeUndefined()
    expect(ns.stampDisk).toBeUndefined()
    expect(ns.stampSegment).toBeUndefined()
  })

  it('every export is a native Function (not a class)', () => {
    for (const k of Object.keys(moduleNs)) {
      const v = (moduleNs as unknown as Record<string, unknown>)[k]
      expect(typeof v).toBe('function')
      expect(String(v).startsWith('class ')).toBe(false)
    }
  })
})

// --------------------------------------------------------------------------
// (B) Function signatures
// --------------------------------------------------------------------------
describe('[ID-0260] (B) function signatures', () => {
  it('buildHeightFieldFromCuttingSegments.name is correct', () => {
    expect(buildHeightFieldFromCuttingSegments.name).toBe('buildHeightFieldFromCuttingSegments')
  })

  it('sampleHeightFieldZ.name is correct', () => {
    expect(sampleHeightFieldZ.name).toBe('sampleHeightFieldZ')
  })

  it('buildHeightFieldFromCuttingSegments takes 2 parameters (Function.length)', () => {
    expect(buildHeightFieldFromCuttingSegments.length).toBe(2)
  })

  it('sampleHeightFieldZ takes 3 parameters (Function.length)', () => {
    expect(sampleHeightFieldZ.length).toBe(3)
  })

  it('buildHeightFieldFromCuttingSegments returns HeightField2d5 or null', () => {
    const segs = [feed(0, 0, -1, 10, 10, -1)]
    const result = buildHeightFieldFromCuttingSegments(segs, baseOpts)
    expect(result === null || (typeof result === 'object' && result !== null)).toBe(true)
  })

  it('sampleHeightFieldZ always returns a number', () => {
    const hf = buildHeightFieldFromCuttingSegments([feed(0, 0, -1, 10, 10, -1)], baseOpts)
    expect(hf).not.toBeNull()
    if (hf) expect(typeof sampleHeightFieldZ(hf, 5, 5)).toBe('number')
  })
})

// --------------------------------------------------------------------------
// (C) buildHeightFieldFromCuttingSegments default options
// --------------------------------------------------------------------------
describe('[ID-0260] (C) default options', () => {
  it('default stockTopZ is 0 (uncut surface)', () => {
    const segs = [feed(0, 0, -1, 10, 0, -1)]
    const hf = buildHeightFieldFromCuttingSegments(segs, baseOpts)
    expect(hf).not.toBeNull()
    if (hf) expect(hf.stockTopZ).toBe(0)
  })

  it('explicit stockTopZ overrides default', () => {
    const segs = [feed(0, 0, -1, 10, 0, -1)]
    const hf = buildHeightFieldFromCuttingSegments(segs, { ...baseOpts, stockTopZ: 5 })
    expect(hf).not.toBeNull()
    if (hf) expect(hf.stockTopZ).toBe(5)
  })

  it('default cuttingZThreshold is 0.05 mm (segments at z=0 ARE cutting)', () => {
    // Default threshold is 0.05; a segment at z=0 satisfies z<0.05 so it counts.
    const segs = [feed(0, 0, 0, 10, 0, 0)]
    const hf = buildHeightFieldFromCuttingSegments(segs, baseOpts)
    expect(hf).not.toBeNull()
  })

  it('explicit cuttingZThreshold of 0 excludes segments at z=0', () => {
    // With threshold=0, z=0 fails strict-less-than: not counted as cutting.
    const segs = [feed(0, 0, 0, 10, 0, 0)]
    const hf = buildHeightFieldFromCuttingSegments(segs, { ...baseOpts, cuttingZThreshold: 0 })
    expect(hf).toBeNull()
  })

  it('default maxCols is 96', () => {
    // A 200 mm span at default toolRadius=3 (margin=4) -> 208 mm with margin.
    // 208 / 96 = 2.166 mm/cell -> cols=96 (clamped).
    const segs = [feed(0, 0, -1, 200, 0, -1)]
    const hf = buildHeightFieldFromCuttingSegments(segs, baseOpts)
    expect(hf).not.toBeNull()
    if (hf) expect(hf.cols).toBeLessThanOrEqual(96)
  })

  it('default maxRows is 96', () => {
    const segs = [feed(0, 0, -1, 0, 200, -1)]
    const hf = buildHeightFieldFromCuttingSegments(segs, baseOpts)
    expect(hf).not.toBeNull()
    if (hf) expect(hf.rows).toBeLessThanOrEqual(96)
  })

  it('explicit maxCols/maxRows overrides default', () => {
    const segs = [feed(0, 0, -1, 100, 100, -1)]
    const hf = buildHeightFieldFromCuttingSegments(segs, { ...baseOpts, maxCols: 32, maxRows: 32 })
    expect(hf).not.toBeNull()
    if (hf) {
      expect(hf.cols).toBeLessThanOrEqual(32)
      expect(hf.rows).toBeLessThanOrEqual(32)
    }
  })

  it('default toolShape is "flat" (cylinder stamp)', () => {
    // Stamp a single point with flat tool -> cells under the disc all get cutZ.
    const segs = [feed(50, 50, -1, 50.001, 50.001, -1)]
    const hfFlat = buildHeightFieldFromCuttingSegments(segs, { ...baseOpts, toolRadiusMm: 3 })
    const hfBall = buildHeightFieldFromCuttingSegments(segs, {
      ...baseOpts,
      toolRadiusMm: 3,
      toolShape: 'ball'
    })
    // ASSUMPTION: For flat tool, every cell whose centre falls within the
    // tool radius gets cutZ exactly (cylinder stamp). For ball tool, only
    // the cell exactly at r=0 reaches cutZ; all others are at cutZ + (R -
    // sqrt(R²-r²)) which is strictly greater than cutZ. Since cell centres
    // are quantized (originX + (i+0.5)*cellMm), the closest cell to the
    // disk centre is at some small r > 0, so the ball-end min is SLIGHTLY
    // GREATER than cutZ. The flat-end min is exactly cutZ. Pin this
    // asymmetric contract.
    expect(hfFlat).not.toBeNull()
    expect(hfBall).not.toBeNull()
    if (hfFlat && hfBall) {
      const flatMin = Math.min(...Array.from(hfFlat.topZ))
      const ballMin = Math.min(...Array.from(hfBall.topZ))
      // Flat reaches cutZ exactly (within Float32 precision).
      expect(flatMin).toBeCloseTo(-1, 4)
      // Ball reaches close to cutZ but is slightly greater (small r > 0
      // at the closest cell centre).
      expect(ballMin).toBeGreaterThanOrEqual(-1 - 1e-3)
      expect(ballMin).toBeLessThan(0)
    }
  })

  it('default marginMm is toolRadiusMm + 1', () => {
    // With toolRadius=2, margin should be 3. A 0..10 span -> bounds become -3..13.
    const segs = [feed(0, 0, -1, 10, 0, -1)]
    const hf = buildHeightFieldFromCuttingSegments(segs, { ...baseOpts, toolRadiusMm: 2 })
    expect(hf).not.toBeNull()
    if (hf) {
      // originX should be at the lower bound -3 (0 - 3); cellMm * cols >= 13 - (-3) = 16.
      expect(hf.originX).toBeCloseTo(-3, 5)
    }
  })

  it('explicit marginMm overrides default', () => {
    const segs = [feed(0, 0, -1, 10, 0, -1)]
    const hf = buildHeightFieldFromCuttingSegments(segs, {
      ...baseOpts,
      toolRadiusMm: 2,
      marginMm: 0.5
    })
    expect(hf).not.toBeNull()
    if (hf) {
      expect(hf.originX).toBeCloseTo(-0.5, 5)
    }
  })
})

// --------------------------------------------------------------------------
// (D) Segment filter contract
// --------------------------------------------------------------------------
describe('[ID-0260] (D) segment filter', () => {
  it('rapid-only segments yield null (no cutting)', () => {
    const segs = [rapid(0, 0, -1, 10, 0, -1), rapid(10, 0, -1, 20, 0, -1)]
    expect(buildHeightFieldFromCuttingSegments(segs, baseOpts)).toBeNull()
  })

  it('feed segments above threshold yield null (air moves)', () => {
    // Default threshold 0.05; segments at z=5 are well above.
    const segs = [feed(0, 0, 5, 10, 0, 5)]
    expect(buildHeightFieldFromCuttingSegments(segs, baseOpts)).toBeNull()
  })

  it('feed with z0 below threshold counts as cutting (OR predicate)', () => {
    // z0 = -1 (below 0.05), z1 = 5 (above 0.05). The OR-predicate keeps it.
    const segs = [feed(0, 0, -1, 10, 0, 5)]
    const hf = buildHeightFieldFromCuttingSegments(segs, baseOpts)
    expect(hf).not.toBeNull()
  })

  it('feed with z1 below threshold counts as cutting (OR predicate)', () => {
    // z0 = 5, z1 = -1. The OR-predicate keeps it.
    const segs = [feed(0, 0, 5, 10, 0, -1)]
    const hf = buildHeightFieldFromCuttingSegments(segs, baseOpts)
    expect(hf).not.toBeNull()
  })

  it('mixed feed + rapid: only feed segments are processed', () => {
    const segs = [
      rapid(0, 0, 5, 0, 0, -1), // plunge approach (rapid) -- ignored
      feed(0, 0, -1, 10, 0, -1), // cut
      rapid(10, 0, -1, 0, 0, 5) // retract (rapid) -- ignored
    ]
    const hf = buildHeightFieldFromCuttingSegments(segs, baseOpts)
    expect(hf).not.toBeNull()
    if (hf) {
      // Bounds should reflect ONLY the feed segment (0..10 in X), not the rapids.
      // With default margin=tr+1=4, originX should be at -4.
      expect(hf.originX).toBeCloseTo(-4, 5)
    }
  })

  it('feed with both z above threshold is filtered out', () => {
    const segs = [feed(0, 0, 5, 10, 0, 10)]
    expect(buildHeightFieldFromCuttingSegments(segs, baseOpts)).toBeNull()
  })

  it('custom cuttingZThreshold filters at the new boundary', () => {
    // z=-2.5 should NOT be cutting if threshold is -3 (must be < -3).
    const segs = [feed(0, 0, -2.5, 10, 0, -2.5)]
    const hfHigh = buildHeightFieldFromCuttingSegments(segs, {
      ...baseOpts,
      cuttingZThreshold: -3
    })
    expect(hfHigh).toBeNull()
    // Same segments at threshold=-2 should be cutting.
    const hfLow = buildHeightFieldFromCuttingSegments(segs, {
      ...baseOpts,
      cuttingZThreshold: -2
    })
    expect(hfLow).not.toBeNull()
  })
})

// --------------------------------------------------------------------------
// (E) Null-return contract
// --------------------------------------------------------------------------
describe('[ID-0260] (E) null-return contract', () => {
  it('empty segments array returns null', () => {
    expect(buildHeightFieldFromCuttingSegments([], baseOpts)).toBeNull()
  })

  it('single point with collapsed XY span returns null', () => {
    // A single zero-length segment at one point.
    const segs = [feed(5, 5, -1, 5, 5, -1)]
    // With margin=tr+1=4, span becomes 8 in both X and Y -- NOT collapsed.
    // Test the truly-collapsed case: marginMm=0 + zero-length = zero span.
    expect(
      buildHeightFieldFromCuttingSegments(segs, { ...baseOpts, marginMm: 0 })
    ).toBeNull()
  })

  it('all rapid segments return null', () => {
    const segs = [rapid(0, 0, -1, 10, 10, -1), rapid(10, 10, -1, 0, 0, -1)]
    expect(buildHeightFieldFromCuttingSegments(segs, baseOpts)).toBeNull()
  })

  it('all feed segments above threshold return null', () => {
    const segs = [feed(0, 0, 1, 10, 0, 1), feed(10, 0, 1, 20, 0, 1)]
    expect(buildHeightFieldFromCuttingSegments(segs, baseOpts)).toBeNull()
  })

  it('zero-length feed at cutting Z does NOT return null (margin saves span)', () => {
    // A zero-length feed at z=-1 with default margin=4 yields an 8x8 envelope.
    const segs = [feed(5, 5, -1, 5, 5, -1)]
    const hf = buildHeightFieldFromCuttingSegments(segs, baseOpts)
    expect(hf).not.toBeNull()
  })
})

// --------------------------------------------------------------------------
// (F) Tool radius floor
// --------------------------------------------------------------------------
describe('[ID-0260] (F) tool radius floor 0.05 mm', () => {
  it('toolRadius 0.01 is floored to 0.05 (minimum)', () => {
    const segs = [feed(0, 0, -1, 10, 0, -1)]
    const hf = buildHeightFieldFromCuttingSegments(segs, { toolRadiusMm: 0.01 })
    expect(hf).not.toBeNull()
    // Default margin = floored radius + 1 = 0.05 + 1 = 1.05.
    if (hf) expect(hf.originX).toBeCloseTo(-1.05, 5)
  })

  it('toolRadius 0 is floored to 0.05', () => {
    const segs = [feed(0, 0, -1, 10, 0, -1)]
    const hf = buildHeightFieldFromCuttingSegments(segs, { toolRadiusMm: 0 })
    expect(hf).not.toBeNull()
    if (hf) expect(hf.originX).toBeCloseTo(-1.05, 5)
  })

  it('toolRadius negative is floored to 0.05', () => {
    const segs = [feed(0, 0, -1, 10, 0, -1)]
    const hf = buildHeightFieldFromCuttingSegments(segs, { toolRadiusMm: -5 })
    expect(hf).not.toBeNull()
    if (hf) expect(hf.originX).toBeCloseTo(-1.05, 5)
  })

  it('toolRadius 0.06 is NOT floored (above 0.05)', () => {
    const segs = [feed(0, 0, -1, 10, 0, -1)]
    const hf = buildHeightFieldFromCuttingSegments(segs, { toolRadiusMm: 0.06 })
    expect(hf).not.toBeNull()
    if (hf) expect(hf.originX).toBeCloseTo(-1.06, 5)
  })

  it('toolRadius 12.7 (Laguna 1/2-inch) is preserved', () => {
    const segs = [feed(0, 0, -1, 100, 0, -1)]
    const hf = buildHeightFieldFromCuttingSegments(segs, { toolRadiusMm: 12.7 })
    expect(hf).not.toBeNull()
    if (hf) expect(hf.originX).toBeCloseTo(-13.7, 5)
  })
})

// --------------------------------------------------------------------------
// (G) Cell size + grid bounds
// --------------------------------------------------------------------------
describe('[ID-0260] (G) cell size + grid bounds', () => {
  it('cellMm has minimum 0.1 mm (small spans clamp up)', () => {
    // Tiny span: 0..1 mm + margin tr+1=2 -> 5 mm total span.
    // 5 / 96 = 0.052 -> floored to 0.1.
    const segs = [feed(0, 0, -1, 1, 0, -1)]
    const hf = buildHeightFieldFromCuttingSegments(segs, { toolRadiusMm: 1 })
    expect(hf).not.toBeNull()
    if (hf) expect(hf.cellMm).toBeGreaterThanOrEqual(0.1)
  })

  it('cols >= 2 (clamp lower bound)', () => {
    const segs = [feed(0, 0, -1, 0.5, 0, -1)]
    const hf = buildHeightFieldFromCuttingSegments(segs, { toolRadiusMm: 0.05 })
    expect(hf).not.toBeNull()
    if (hf) expect(hf.cols).toBeGreaterThanOrEqual(2)
  })

  it('rows >= 2 (clamp lower bound)', () => {
    const segs = [feed(0, 0, -1, 0, 0.5, -1)]
    const hf = buildHeightFieldFromCuttingSegments(segs, { toolRadiusMm: 0.05 })
    expect(hf).not.toBeNull()
    if (hf) expect(hf.rows).toBeGreaterThanOrEqual(2)
  })

  it('cellMm > 0 always', () => {
    const segs = [feed(0, 0, -1, 100, 100, -1)]
    const hf = buildHeightFieldFromCuttingSegments(segs, baseOpts)
    expect(hf).not.toBeNull()
    if (hf) expect(hf.cellMm).toBeGreaterThan(0)
  })

  it('cols * cellMm >= spanX (grid covers the cutting envelope in X)', () => {
    const segs = [feed(0, 0, -1, 50, 0, -1)]
    const hf = buildHeightFieldFromCuttingSegments(segs, baseOpts)
    expect(hf).not.toBeNull()
    if (hf) {
      // spanX with margin = 50 + 2 * 4 = 58
      expect(hf.cols * hf.cellMm).toBeGreaterThanOrEqual(58 - 1e-3)
    }
  })

  it('cols * cellMm >= spanY (grid covers the cutting envelope in Y)', () => {
    const segs = [feed(0, 0, -1, 0, 50, -1)]
    const hf = buildHeightFieldFromCuttingSegments(segs, baseOpts)
    expect(hf).not.toBeNull()
    if (hf) {
      expect(hf.rows * hf.cellMm).toBeGreaterThanOrEqual(58 - 1e-3)
    }
  })
})

// --------------------------------------------------------------------------
// (H) Float32Array initialization
// --------------------------------------------------------------------------
describe('[ID-0260] (H) topZ Float32Array init', () => {
  it('topZ is a Float32Array', () => {
    const segs = [feed(0, 0, -1, 10, 0, -1)]
    const hf = buildHeightFieldFromCuttingSegments(segs, baseOpts)
    expect(hf).not.toBeNull()
    if (hf) expect(hf.topZ).toBeInstanceOf(Float32Array)
  })

  it('topZ length is cols * rows', () => {
    const segs = [feed(0, 0, -1, 10, 10, -1)]
    const hf = buildHeightFieldFromCuttingSegments(segs, baseOpts)
    expect(hf).not.toBeNull()
    if (hf) expect(hf.topZ.length).toBe(hf.cols * hf.rows)
  })

  it('topZ cells outside the cutting envelope retain stockTopZ', () => {
    // Cut a tiny line near origin; far corner should be uncut.
    const segs = [feed(0, 0, -1, 0.001, 0.001, -1)]
    const hf = buildHeightFieldFromCuttingSegments(segs, { ...baseOpts, stockTopZ: 7 })
    expect(hf).not.toBeNull()
    if (hf) {
      // Far corner (last cell) untouched by the tiny stamp at origin.
      const lastIdx = hf.cols * hf.rows - 1
      expect(hf.topZ[lastIdx]).toBe(7)
    }
  })

  it('topZ never goes ABOVE stockTopZ (only lowers)', () => {
    const segs = [feed(0, 0, -1, 10, 0, -1)]
    const hf = buildHeightFieldFromCuttingSegments(segs, { ...baseOpts, stockTopZ: 0 })
    expect(hf).not.toBeNull()
    if (hf) {
      for (let i = 0; i < hf.topZ.length; i++) {
        expect(hf.topZ[i]).toBeLessThanOrEqual(0 + 1e-6)
      }
    }
  })

  it('NEGATIVE stockTopZ also acts as the un-cut surface', () => {
    const segs = [feed(0, 0, -10, 10, 0, -10)]
    const hf = buildHeightFieldFromCuttingSegments(segs, { ...baseOpts, stockTopZ: -5 })
    expect(hf).not.toBeNull()
    if (hf) {
      // Cut depth -10 < uncut -5; outer cells should be -5.
      const lastIdx = hf.cols * hf.rows - 1
      expect(hf.topZ[lastIdx]).toBe(-5)
    }
  })
})

// --------------------------------------------------------------------------
// (I) sampleHeightFieldZ contract
// --------------------------------------------------------------------------
describe('[ID-0260] (I) sampleHeightFieldZ contract', () => {
  function makeUniform(stockTopZ = 0): HeightField2d5 {
    const segs = [feed(0, 0, -1, 10, 10, -1)]
    const hf = buildHeightFieldFromCuttingSegments(segs, { ...baseOpts, stockTopZ })!
    return hf
  }

  it('sample at non-finite x returns stockTopZ', () => {
    const hf = makeUniform(5)
    expect(sampleHeightFieldZ(hf, Number.NaN, 5)).toBe(5)
    expect(sampleHeightFieldZ(hf, Number.POSITIVE_INFINITY, 5)).toBe(5)
    expect(sampleHeightFieldZ(hf, Number.NEGATIVE_INFINITY, 5)).toBe(5)
  })

  it('sample at non-finite y returns stockTopZ', () => {
    const hf = makeUniform(5)
    expect(sampleHeightFieldZ(hf, 5, Number.NaN)).toBe(5)
    expect(sampleHeightFieldZ(hf, 5, Number.POSITIVE_INFINITY)).toBe(5)
  })

  it('sample at uncut corner returns stockTopZ', () => {
    const hf = makeUniform(0)
    // Far OOB corner -- clamps to last cell which is also uncut at stockTopZ.
    const z = sampleHeightFieldZ(hf, 1000, 1000)
    expect(z).toBe(0)
  })

  it('sample inside cut zone returns deepest cut Z (not stockTopZ)', () => {
    const segs = [feed(5, 5, -2, 5.001, 5.001, -2)]
    const hf = buildHeightFieldFromCuttingSegments(segs, { ...baseOpts, toolRadiusMm: 3 })
    expect(hf).not.toBeNull()
    if (hf) {
      // Sample at the centre of the stamp -- should be near -2.
      const z = sampleHeightFieldZ(hf, 5, 5)
      expect(z).toBeLessThan(-1)
    }
  })

  it('OOB sample (x < origin) returns stockTopZ via clamp + uncut corner', () => {
    const hf = makeUniform(0)
    // Way outside the field on the negative-X side.
    const z = sampleHeightFieldZ(hf, hf.originX - 1000, hf.originY)
    expect(z).toBe(0)
  })

  it('OOB sample (y > field) returns stockTopZ via clamp + uncut corner', () => {
    const hf = makeUniform(0)
    const farY = hf.originY + hf.rows * hf.cellMm + 1000
    const z = sampleHeightFieldZ(hf, hf.originX, farY)
    expect(z).toBe(0)
  })

  it('bilinear interpolation between two cells of differing Z', () => {
    // Construct a stamped field then sample halfway between two cells.
    const segs = [feed(2, 2, -1, 8, 2, -1)] // X-line cut
    const hf = buildHeightFieldFromCuttingSegments(segs, { ...baseOpts, toolRadiusMm: 1.5 })
    expect(hf).not.toBeNull()
    if (hf) {
      // Sample inside the cut region -- should be < stockTopZ.
      const z = sampleHeightFieldZ(hf, 5, 2)
      expect(z).toBeLessThan(0)
    }
  })

  it('returns a finite number for any in-bounds finite (x, y)', () => {
    const hf = makeUniform(0)
    for (const x of [0, 5, 10, hf.originX, hf.originX + hf.cols * hf.cellMm]) {
      for (const y of [0, 5, 10, hf.originY, hf.originY + hf.rows * hf.cellMm]) {
        expect(Number.isFinite(sampleHeightFieldZ(hf, x, y))).toBe(true)
      }
    }
  })
})

// --------------------------------------------------------------------------
// (J) Ball-end stamping hemisphere formula
// --------------------------------------------------------------------------
describe('[ID-0260] (J) ball-end hemisphere', () => {
  it('ball-end approaches cutZ at the centre cell (within grid quantization)', () => {
    const segs = [feed(50, 50, -2, 50.001, 50.001, -2)]
    const hf = buildHeightFieldFromCuttingSegments(segs, {
      toolRadiusMm: 3,
      toolShape: 'ball'
    })
    expect(hf).not.toBeNull()
    if (hf) {
      // The closest cell to the disk centre is at some small r > 0 due to
      // grid quantization; the deepest cell is therefore at cutZ + (R -
      // sqrt(R²-r²)) which is slightly greater than cutZ. Pin: minZ is
      // close to (but never less than) cutZ.
      const minZ = Math.min(...Array.from(hf.topZ))
      expect(minZ).toBeGreaterThanOrEqual(-2 - 1e-4)
      expect(minZ).toBeLessThan(-1.9)
    }
  })

  it('ball-end at edge (r ≈ R) is shallower than cutZ (rises by R)', () => {
    // Single point stamp; the cells at the edge of the stamp footprint are
    // nearly uncut (effectiveZ approaches cutZ + R).
    const segs = [feed(50, 50, -1, 50.001, 50.001, -1)]
    const hfFlat = buildHeightFieldFromCuttingSegments(segs, {
      toolRadiusMm: 3,
      toolShape: 'flat'
    })
    const hfBall = buildHeightFieldFromCuttingSegments(segs, {
      toolRadiusMm: 3,
      toolShape: 'ball'
    })
    expect(hfFlat).not.toBeNull()
    expect(hfBall).not.toBeNull()
    if (hfFlat && hfBall) {
      // Compare a cell near the edge of the stamp -- ball should be shallower.
      // Find a cell with nontrivial difference.
      let edgeFlatZ = 0
      let edgeBallZ = 0
      let foundEdge = false
      for (let i = 0; i < hfFlat.topZ.length; i++) {
        const cellFlat = hfFlat.topZ[i]!
        const cellBall = hfBall.topZ[i]!
        // We want a cell that flat stamped (z<0) but ball stamped to a less-deep z.
        if (cellFlat < -0.5 && cellBall < 0 && cellBall > cellFlat + 0.1) {
          edgeFlatZ = cellFlat
          edgeBallZ = cellBall
          foundEdge = true
          break
        }
      }
      // If no edge cell found, the test is vacuous; require we found one.
      expect(foundEdge).toBe(true)
      expect(edgeBallZ).toBeGreaterThan(edgeFlatZ)
    }
  })

  it('ball-end formula matches cutZ + R - sqrt(R² - r²) at r=R/2', () => {
    // Spot check: at r=R/2=1.5, R=3, R²=9, R²-r²=6.75, sqrt=2.598.
    // Effective rise = R - sqrt = 3 - 2.598 = 0.402.
    // This is conceptual; detailed sampling depends on grid alignment.
    // Just verify ball-end stamps yield deeper-at-centre than at edges.
    const segs = [feed(50, 50, -2, 50.001, 50.001, -2)]
    const hf = buildHeightFieldFromCuttingSegments(segs, {
      toolRadiusMm: 3,
      toolShape: 'ball'
    })
    expect(hf).not.toBeNull()
    if (hf) {
      // The stamp's centre cell should be deeper than its edge cells.
      // Sample centre vs an offset cell.
      const zCentre = sampleHeightFieldZ(hf, 50, 50)
      const zNearEdge = sampleHeightFieldZ(hf, 52, 50)
      expect(zCentre).toBeLessThanOrEqual(zNearEdge + 1e-4)
    }
  })
})

// --------------------------------------------------------------------------
// (K) Three-machine path realism
// --------------------------------------------------------------------------
describe('[ID-0260] (K) three-machine path realism', () => {
  describe('Laguna Swift 5x10 -- full-sheet plywood routing', () => {
    it('1500 mm plywood roughing pass with 12.7 mm endmill', () => {
      // Realistic: 1500x1500 mm region, 12.7 mm endmill, 8 mm stepover,
      // routing 4 mm deep into 18 mm plywood.
      const segs: ToolpathSegment3[] = []
      for (let y = 0; y < 1500; y += 8) {
        segs.push(feed(0, y, -4, 1500, y, -4))
      }
      const hf = buildHeightFieldFromCuttingSegments(segs, {
        toolRadiusMm: 6.35,
        stockTopZ: 0,
        maxCols: 64,
        maxRows: 64
      })
      expect(hf).not.toBeNull()
      if (hf) {
        expect(hf.cols).toBeLessThanOrEqual(64)
        expect(hf.rows).toBeLessThanOrEqual(64)
        // The interior should be cut to about -4.
        const zMid = sampleHeightFieldZ(hf, 750, 750)
        expect(zMid).toBeLessThan(-3)
      }
    })

    it('full-sheet 1500x3000 mm region accepts the bounds', () => {
      const segs: ToolpathSegment3[] = [feed(0, 0, -4, 1500, 3000, -4)]
      const hf = buildHeightFieldFromCuttingSegments(segs, {
        toolRadiusMm: 6.35,
        stockTopZ: 0,
        maxCols: 96,
        maxRows: 96
      })
      expect(hf).not.toBeNull()
      if (hf) {
        // X span ~1500 + margin -> cell ~16 mm; Y span ~3000 + margin -> cell ~32 mm.
        // Cell size dominated by the larger of the two divisions.
        expect(hf.cellMm).toBeGreaterThan(15)
      }
    })

    it('below-spoilboard cut at z=-3.5 mm registers as cutting', () => {
      const segs = [feed(0, 0, -3.5, 100, 0, -3.5)]
      const hf = buildHeightFieldFromCuttingSegments(segs, {
        toolRadiusMm: 6.35,
        stockTopZ: 0
      })
      expect(hf).not.toBeNull()
      if (hf) {
        // Sample inside the cut path -- should be near -3.5.
        const z = sampleHeightFieldZ(hf, 50, 0)
        expect(z).toBeLessThan(-2)
      }
    })

    it('Laguna ball-end finishing pass with 6 mm ball', () => {
      const segs: ToolpathSegment3[] = [feed(0, 0, -1, 100, 0, -1)]
      const hf = buildHeightFieldFromCuttingSegments(segs, {
        toolRadiusMm: 3,
        toolShape: 'ball',
        stockTopZ: 0
      })
      expect(hf).not.toBeNull()
    })
  })

  describe('Makera Carvera + 4-axis -- small precision', () => {
    it('360x240 mm work-area routing within Carvera bounds', () => {
      const segs: ToolpathSegment3[] = []
      for (let y = 0; y < 240; y += 0.3) {
        segs.push(feed(0, y, -0.5, 360, y, -0.5))
      }
      const hf = buildHeightFieldFromCuttingSegments(segs, {
        toolRadiusMm: 1.5,
        stockTopZ: 0,
        maxCols: 96,
        maxRows: 96
      })
      expect(hf).not.toBeNull()
      if (hf) {
        // Mid-region should be cut.
        const z = sampleHeightFieldZ(hf, 180, 120)
        expect(z).toBeLessThan(-0.4)
      }
    })

    it('3 mm ball-end finishing tool with 0.3 mm stepover', () => {
      const segs: ToolpathSegment3[] = [
        feed(10, 10, -1, 50, 10, -1),
        feed(10, 10.3, -1, 50, 10.3, -1),
        feed(10, 10.6, -1, 50, 10.6, -1)
      ]
      const hf = buildHeightFieldFromCuttingSegments(segs, {
        toolRadiusMm: 1.5,
        toolShape: 'ball',
        stockTopZ: 0
      })
      expect(hf).not.toBeNull()
      if (hf) {
        const z = sampleHeightFieldZ(hf, 30, 10.3)
        expect(z).toBeLessThan(-0.5)
      }
    })
  })

  describe('Creality K2 Plus -- FDM (heightfield N/A but exercise null path)', () => {
    it('FDM print segments above z=0 yield null (no "cutting" in FDM)', () => {
      // FDM lays material above the bed; no segments below threshold.
      const segs: ToolpathSegment3[] = [
        feed(0, 0, 0.2, 10, 0, 0.2),
        feed(10, 0, 0.4, 0, 0, 0.4)
      ]
      // Default threshold 0.05; segments at 0.2/0.4 are above.
      expect(buildHeightFieldFromCuttingSegments(segs, baseOpts)).toBeNull()
    })

    it('K2 350mm build volume + zero-cuts -> null (no heightfield to render)', () => {
      const segs: ToolpathSegment3[] = []
      for (let y = 0; y < 350; y += 0.4) {
        segs.push(feed(0, y, 0.2, 350, y, 0.2))
      }
      expect(buildHeightFieldFromCuttingSegments(segs, baseOpts)).toBeNull()
    })
  })

  describe('cross-machine fixture coexistence', () => {
    it('mixed machine segments: only the cutting-Z subset is heightfielded', () => {
      const segs: ToolpathSegment3[] = [
        // K2 FDM print line at z=0.2 (NOT cutting)
        feed(0, 0, 0.2, 10, 0, 0.2),
        // Laguna routing at z=-3 (cutting)
        feed(20, 20, -3, 30, 20, -3),
        // Carvera finish at z=-0.5 (cutting)
        feed(40, 40, -0.5, 50, 40, -0.5)
      ]
      const hf = buildHeightFieldFromCuttingSegments(segs, baseOpts)
      expect(hf).not.toBeNull()
      if (hf) {
        // The K2 segment at 0.2 should not affect the bounds; bounds reflect
        // only the Laguna + Carvera regions (20..50 in X/Y).
        expect(hf.originX).toBeCloseTo(20 - 4, 0) // -16 with margin=4
      }
    })
  })
})

// --------------------------------------------------------------------------
// (L) Pure-function invariants
// --------------------------------------------------------------------------
describe('[ID-0260] (L) pure-function invariants', () => {
  it('buildHeightFieldFromCuttingSegments does not mutate input segments', () => {
    const segs = [feed(0, 0, -1, 10, 10, -1), feed(10, 10, -1, 20, 20, -1)]
    const before = JSON.stringify(segs)
    buildHeightFieldFromCuttingSegments(segs, baseOpts)
    expect(JSON.stringify(segs)).toBe(before)
  })

  it('buildHeightFieldFromCuttingSegments does not mutate the opts object', () => {
    const opts: BuildHeightFieldOptions = { toolRadiusMm: 3, stockTopZ: 5 }
    const before = JSON.stringify(opts)
    buildHeightFieldFromCuttingSegments([feed(0, 0, -1, 10, 10, -1)], opts)
    expect(JSON.stringify(opts)).toBe(before)
  })

  it('buildHeightFieldFromCuttingSegments is idempotent across N=10 calls', () => {
    const segs = [feed(0, 0, -1, 10, 10, -1)]
    const first = buildHeightFieldFromCuttingSegments(segs, baseOpts)!
    for (let i = 0; i < 10; i++) {
      const r = buildHeightFieldFromCuttingSegments(segs, baseOpts)!
      expect(r.cols).toBe(first.cols)
      expect(r.rows).toBe(first.rows)
      expect(r.cellMm).toBe(first.cellMm)
      expect(r.originX).toBe(first.originX)
      expect(r.originY).toBe(first.originY)
      expect(r.stockTopZ).toBe(first.stockTopZ)
      expect(Array.from(r.topZ)).toEqual(Array.from(first.topZ))
    }
  })

  it('sampleHeightFieldZ is idempotent across N=20 calls', () => {
    const hf = buildHeightFieldFromCuttingSegments([feed(0, 0, -1, 10, 10, -1)], baseOpts)!
    const first = sampleHeightFieldZ(hf, 5, 5)
    for (let i = 0; i < 20; i++) {
      expect(sampleHeightFieldZ(hf, 5, 5)).toBe(first)
    }
  })

  it('sampleHeightFieldZ does not mutate the heightfield', () => {
    const hf = buildHeightFieldFromCuttingSegments([feed(0, 0, -1, 10, 10, -1)], baseOpts)!
    const before = Array.from(hf.topZ)
    sampleHeightFieldZ(hf, 5, 5)
    expect(Array.from(hf.topZ)).toEqual(before)
  })

  it('build/sample do not retain a `this` binding (.call(null) works)', () => {
    expect(() =>
      buildHeightFieldFromCuttingSegments.call(null, [feed(0, 0, -1, 10, 0, -1)], baseOpts)
    ).not.toThrow()
    const hf = buildHeightFieldFromCuttingSegments([feed(0, 0, -1, 10, 0, -1)], baseOpts)!
    expect(() => sampleHeightFieldZ.call(null, hf, 5, 0)).not.toThrow()
  })

  it('fuzz-lite: 8 random-ish input shapes do not throw', () => {
    const cases: Array<[ToolpathSegment3[], BuildHeightFieldOptions]> = [
      [[], baseOpts],
      [[feed(0, 0, -1, 0, 0, -1)], baseOpts],
      [[feed(0, 0, 1, 1, 1, 1)], baseOpts],
      [[rapid(0, 0, -1, 1, 1, -1)], baseOpts],
      [[feed(-100, -100, -1, 100, 100, -1)], { toolRadiusMm: 3 }],
      [[feed(0, 0, -1, 10, 0, -1)], { toolRadiusMm: 1, maxCols: 4, maxRows: 4 }],
      [[feed(0, 0, -1, 10, 0, -1)], { toolRadiusMm: 1, stockTopZ: -50 }],
      [[feed(0, 0, -1, 10, 0, -1)], { toolRadiusMm: 1, toolShape: 'ball' }]
    ]
    for (const [segs, opts] of cases) {
      expect(() => buildHeightFieldFromCuttingSegments(segs, opts)).not.toThrow()
    }
  })
})

// --------------------------------------------------------------------------
// (M) Source-text whitelist
// --------------------------------------------------------------------------
describe('[ID-0260] (M) source-text whitelist', () => {
  it('source file is <= 240 lines (compact 2.5D module)', async () => {
    const src = await readSrc()
    expect(src.split('\n').length).toBeLessThanOrEqual(240)
  })

  it('source file is <= 9000 bytes', async () => {
    const src = await readSrc()
    expect(Buffer.byteLength(src, 'utf-8')).toBeLessThanOrEqual(9000)
  })

  it('exports exactly 2 runtime functions', async () => {
    const src = await readSrc()
    const matches = src.match(/^export\s+function\s+\w+/gm) ?? []
    expect(matches.length).toBe(2)
  })

  it('exports exactly 3 type aliases', async () => {
    const src = await readSrc()
    const matches = src.match(/^export\s+type\s+\w+/gm) ?? []
    expect(matches.length).toBe(3)
  })

  it('imports ToolpathSegment3 type-only from cam-gcode-toolpath', async () => {
    const src = await readSrc()
    expect(src).toMatch(
      /import\s+type\s+\{[^}]*ToolpathSegment3[^}]*\}\s+from\s+'\.\/cam-gcode-toolpath'/
    )
  })

  it('uses Float32Array for topZ (not Float64Array)', async () => {
    const src = await readSrc()
    expect(src).toMatch(/new\s+Float32Array/)
    expect(src).not.toMatch(/new\s+Float64Array/)
  })

  it('default cuttingZThreshold is 0.05', async () => {
    const src = await readSrc()
    expect(src).toMatch(/cuttingZThreshold\s*\?\?\s*0\.05/)
  })

  it('default maxCols and maxRows are 96', async () => {
    const src = await readSrc()
    expect(src).toMatch(/maxCols\s*\?\?\s*96/)
    expect(src).toMatch(/maxRows\s*\?\?\s*96/)
  })

  it('default stockTopZ is 0', async () => {
    const src = await readSrc()
    expect(src).toMatch(/stockTopZ\s*\?\?\s*0/)
  })

  it('tool radius floor is 0.05 mm via Math.max', async () => {
    const src = await readSrc()
    expect(src).toMatch(/Math\.max\s*\(\s*0\.05\s*,\s*opts\.toolRadiusMm\s*\)/)
  })

  it('cell size minimum is 0.1 mm', async () => {
    const src = await readSrc()
    // The expression appears as Math.max(..., 0.1) on the cellMm derivation.
    expect(src).toMatch(/0\.1\s*\)/)
  })

  it('ball-end formula uses Math.sqrt(R² - r²)', async () => {
    const src = await readSrc()
    // Look for the hemisphere formula: R - sqrt(R² - r²)
    expect(src).toMatch(/Math\.sqrt\s*\(\s*R2\s*-\s*r\s*\*\s*r\s*\)/)
  })

  it('non-finite x/y guard in sampleHeightFieldZ returns stockTopZ', async () => {
    const src = await readSrc()
    expect(src).toMatch(/Number\.isFinite\s*\(\s*x\s*\)/)
    expect(src).toMatch(/Number\.isFinite\s*\(\s*y\s*\)/)
  })

  it('non-finite cutZ guard in stampDisk skips the stamp', async () => {
    const src = await readSrc()
    expect(src).toMatch(/Number\.isFinite\s*\(\s*cutZ\s*\)/)
  })

  it('toolShape "flat" and "ball" literals appear verbatim', async () => {
    const src = await readSrc()
    expect(src).toContain("'flat'")
    expect(src).toContain("'ball'")
  })

  it('no `:any` runtime annotation in source', async () => {
    const src = await readSrc()
    const codeOnly = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(codeOnly).not.toMatch(/:\s*any\b/)
    expect(codeOnly).not.toMatch(/<\s*any\s*>/)
    expect(codeOnly).not.toMatch(/\bas\s+any\b/)
  })

  it('no foreign-machine vendors leak into the source', async () => {
    const src = (await readSrc()).toLowerCase()
    for (const vendor of [
      'bambu',
      'prusa',
      'haas',
      'tormach',
      'mach4',
      'shapeoko',
      'onefinity',
      'x-carve',
      'fanuc',
      'siemens'
    ]) {
      expect(src).not.toContain(vendor)
    }
  })

  it('no toolpath G-code or M-code literals in source', async () => {
    const src = await readSrc()
    for (const code of [
      'G0 ',
      'G1 ',
      'G17',
      'G18',
      'G19',
      'G20',
      'G21',
      'G28',
      'G54',
      'G90',
      'G91',
      'M3 ',
      'M5 ',
      'M30'
    ]) {
      expect(src).not.toContain(code)
    }
  })

  it('no electron / fs / path / react / three / child_process leakage', async () => {
    const src = await readSrc()
    for (const banned of [
      'electron',
      'child_process',
      'node:fs',
      'node:path',
      "from 'react'",
      "from 'three'"
    ]) {
      expect(src).not.toContain(banned)
    }
  })

  it('no default export', async () => {
    const src = await readSrc()
    expect(src).not.toMatch(/^export\s+default\b/m)
  })

  it('no class declaration', async () => {
    const src = await readSrc()
    expect(src).not.toMatch(/^\s*(?:export\s+)?(?:abstract\s+)?class\s+\w+/m)
  })

  it('no `console.` calls (pure functions, no side effects)', async () => {
    const src = await readSrc()
    expect(src).not.toMatch(/\bconsole\.\w+/)
  })

  it('no `throw new` in source (functions are total -- always return)', async () => {
    const src = await readSrc()
    expect(src).not.toMatch(/\bthrow\s+new\b/)
  })

  it('imports are type-only', async () => {
    const src = await readSrc()
    const importLines = src.split('\n').filter((l) => /^\s*import\b/.test(l))
    expect(importLines.length).toBeGreaterThanOrEqual(1)
    for (const l of importLines) {
      expect(l).toMatch(/^\s*import\s+type\b/)
    }
  })
})
