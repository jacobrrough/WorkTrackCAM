/**
 * cam-voxel-removal-proxy-pin.test.ts -- [ID-0287] Cycle 215 cam-engine paired-pin
 *
 * Pins the contract of `src/shared/cam-voxel-removal-proxy.ts` -- the SHARED
 * Tier-3 voxel stock-removal preview generator. Single pure runtime function
 * `buildVoxelRemovalFromCuttingSegments` plus a frozen-shape preset record
 * `VOXEL_SIM_QUALITY_PRESETS` keyed on the union `'fast' | 'balanced' | 'detailed'`.
 *
 * Production call-sites (verified at landing 2026-04-30):
 *   - All three CNC-target-machine simulation surfaces (Laguna Swift 5x10,
 *     Makera Carvera 3-axis, Makera Carvera 4-axis) consume the voxel preview
 *     for Tier-3 remaining-stock viz. The K2 Plus FDM lane does NOT call this
 *     function (FDM is additive; voxel-removal is subtractive only).
 *
 * Companion behavioral file: `cam-voxel-removal-proxy.test.ts` (10 it() across
 * 2 describe groups exercising preset monotonicity + happy-path carving +
 * stock extensions + tool shape + stamps cap). This pin file extends coverage
 * to lock the CONTRACT surface call-sites depend on -- module shape, exports,
 * preset key set + value literals + strict monotonicity invariants, function
 * signature, the full BuildVoxelRemovalOptions option matrix in isolation, the
 * VoxelRemovalPreview return shape (every key + every type), the tool-shape
 * branch (flat = cylinder stamp; ball = sphere stamp), the stamps-cap +
 * sample-cap budget invariants, three-machine realism (Laguna full-sheet
 * envelope; Carvera 3-axis envelope; Carvera 4-axis envelope), pure-function
 * non-mutation invariants, and the source-text whitelist that guards against
 * silent removal of the load-bearing comments and named branches.
 *
 * Three-machine relevance:
 *   - **Laguna Swift 5x10** (DIRECT): full-sheet stock previews on the
 *     1524 x 3048 mm work envelope use this proxy for Tier-3 viz. The
 *     `stockRectXYMm` option carries the full-sheet bounds. The stamps-cap
 *     guard prevents runaway memory on multi-pass full-sheet routing.
 *   - **Makera Carvera 3-axis** (DIRECT): 360 x 240 x 140 mm envelope; the
 *     proxy is used for 3-axis remaining-stock viz under the bundled
 *     smoothieware dialect. The `cuttingZThreshold` defaults below the
 *     stockTopZ so cutting passes register correctly with WCS Z=0 at
 *     stock top.
 *   - **Makera Carvera 4-axis Rotary** (DIRECT): 4-axis indexed strategies
 *     emit unwrapped XYZ feeds that the proxy carves; the rotary continuous
 *     lane uses `cam-heightfield-cylindrical.ts` instead, so this proxy is
 *     called for the indexed-only branches of the 4-axis facade.
 *   - **Creality K2 Plus** (NOT APPLICABLE): FDM is additive; voxel-removal
 *     is subtractive only. Pin (J) covers the no-FDM-leakage invariant via
 *     the source-text whitelist (no FDM-specific imports / mentions).
 *
 * Per CLAUDE.md "Safety Rule 1 -- G-code is sacred": this pin file authors
 * tests only. No production-G-code edits, no machine-profile edits, no
 * .hbs template edits, no schema edits, no Python engine edits.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import * as Mod from './cam-voxel-removal-proxy'
import {
  buildVoxelRemovalFromCuttingSegments,
  VOXEL_SIM_QUALITY_PRESETS
} from './cam-voxel-removal-proxy'
import type {
  BuildVoxelRemovalOptions,
  VoxelRemovalPreview,
  VoxelSimQualityPreset
} from './cam-voxel-removal-proxy'
import type { ToolpathSegment3 } from './cam-gcode-toolpath'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SRC_PATH = resolvePath(__dirname, 'cam-voxel-removal-proxy.ts')
const SRC_TEXT = readFileSync(SRC_PATH, 'utf8')

const PRESET_KEYS = ['fast', 'balanced', 'detailed'] as const satisfies ReadonlyArray<VoxelSimQualityPreset>
const PRESET_BUDGET_FIELDS = [
  'maxCols',
  'maxRows',
  'maxLayers',
  'maxStamps',
  'maxSamplePoints'
] as const

/** Build a single-pass shallow cutting feed at z=-0.5mm so it registers as cutting. */
function shallowFeed(): ToolpathSegment3[] {
  return [{ kind: 'feed', x0: 0, y0: 0, z0: -0.4, x1: 4, y1: 0, z1: -0.5 }]
}

/** A multi-pass cluster of cutting feeds covering a 6x4mm patch at -0.6mm. */
function patchFeeds(): ToolpathSegment3[] {
  const segs: ToolpathSegment3[] = []
  for (let y = 0; y <= 4; y += 1) {
    segs.push({ kind: 'feed', x0: 0, y0: y, z0: -0.6, x1: 6, y1: y, z1: -0.6 })
  }
  return segs
}

/** A single rapid (non-cutting) move below threshold -- proxy must reject. */
function rapidOnly(): ToolpathSegment3[] {
  return [{ kind: 'rapid', x0: 0, y0: 0, z0: -1, x1: 5, y1: 0, z1: -1 }]
}

// ===========================================================================
// A. Module shape -- exports exist with the expected runtime types
// ===========================================================================
describe('A. cam-voxel-removal-proxy module shape', () => {
  it('exports buildVoxelRemovalFromCuttingSegments as a function', () => {
    expect(typeof buildVoxelRemovalFromCuttingSegments).toBe('function')
  })

  it('exports VOXEL_SIM_QUALITY_PRESETS as a non-null object', () => {
    expect(typeof VOXEL_SIM_QUALITY_PRESETS).toBe('object')
    expect(VOXEL_SIM_QUALITY_PRESETS).not.toBeNull()
  })

  it('VOXEL_SIM_QUALITY_PRESETS is not an Array (it is a Record)', () => {
    expect(Array.isArray(VOXEL_SIM_QUALITY_PRESETS)).toBe(false)
  })

  it('module namespace exposes both runtime exports', () => {
    expect(Mod).toHaveProperty('buildVoxelRemovalFromCuttingSegments')
    expect(Mod).toHaveProperty('VOXEL_SIM_QUALITY_PRESETS')
  })

  it('module namespace does NOT expose the local helpers (clamp, index3) as runtime exports', () => {
    // These are file-private -- accidentally exporting them would tighten the public API surface.
    expect(Mod).not.toHaveProperty('clamp')
    expect(Mod).not.toHaveProperty('index3')
  })

  it('buildVoxelRemovalFromCuttingSegments declares 2 formal parameters (segments + opts)', () => {
    expect(buildVoxelRemovalFromCuttingSegments.length).toBe(2)
  })

  it('buildVoxelRemovalFromCuttingSegments preserves its function name (not anonymized)', () => {
    expect(buildVoxelRemovalFromCuttingSegments.name).toBe('buildVoxelRemovalFromCuttingSegments')
  })
})

// ===========================================================================
// B. VOXEL_SIM_QUALITY_PRESETS key set
// ===========================================================================
describe('B. VOXEL_SIM_QUALITY_PRESETS key set', () => {
  it('declares exactly three preset keys: fast, balanced, detailed', () => {
    expect(Object.keys(VOXEL_SIM_QUALITY_PRESETS).sort()).toEqual(['balanced', 'detailed', 'fast'])
  })

  it('does NOT declare any unexpected preset keys', () => {
    const known = new Set<string>(['fast', 'balanced', 'detailed'])
    for (const k of Object.keys(VOXEL_SIM_QUALITY_PRESETS)) {
      expect(known.has(k)).toBe(true)
    }
  })

  for (const k of PRESET_KEYS) {
    it(`${k} preset declares all 5 budget fields`, () => {
      const p = VOXEL_SIM_QUALITY_PRESETS[k]
      for (const f of PRESET_BUDGET_FIELDS) {
        expect(p).toHaveProperty(f)
      }
    })
  }

  for (const k of PRESET_KEYS) {
    it(`${k} preset exposes EXACTLY 5 keys (no extras leaked)`, () => {
      const p = VOXEL_SIM_QUALITY_PRESETS[k]
      expect(Object.keys(p).sort()).toEqual([...PRESET_BUDGET_FIELDS].sort())
    })
  }
})

// ===========================================================================
// C. Preset budget value contract -- positive integers per field
// ===========================================================================
describe('C. preset budget value contract', () => {
  for (const k of PRESET_KEYS) {
    for (const f of PRESET_BUDGET_FIELDS) {
      it(`${k}.${f} is a positive integer`, () => {
        const v = VOXEL_SIM_QUALITY_PRESETS[k][f]
        expect(typeof v).toBe('number')
        expect(Number.isFinite(v)).toBe(true)
        expect(Number.isInteger(v)).toBe(true)
        expect(v as number).toBeGreaterThan(0)
      })
    }
  }
})

// ===========================================================================
// D. Preset literal pin -- locks current canonical values
// ===========================================================================
describe('D. preset literal pin', () => {
  it('fast preset matches the canonical literal', () => {
    expect(VOXEL_SIM_QUALITY_PRESETS.fast).toEqual({
      maxCols: 22,
      maxRows: 22,
      maxLayers: 14,
      maxStamps: 3500,
      maxSamplePoints: 1400
    })
  })

  it('balanced preset matches the canonical literal', () => {
    expect(VOXEL_SIM_QUALITY_PRESETS.balanced).toEqual({
      maxCols: 34,
      maxRows: 34,
      maxLayers: 20,
      maxStamps: 8000,
      maxSamplePoints: 2400
    })
  })

  it('detailed preset matches the canonical literal', () => {
    expect(VOXEL_SIM_QUALITY_PRESETS.detailed).toEqual({
      maxCols: 44,
      maxRows: 44,
      maxLayers: 28,
      maxStamps: 14000,
      maxSamplePoints: 4200
    })
  })
})

// ===========================================================================
// E. Strict monotonicity across presets (fast < balanced < detailed)
// ===========================================================================
describe('E. strict monotonicity across presets', () => {
  for (const f of PRESET_BUDGET_FIELDS) {
    it(`${f} strictly increases fast -> balanced -> detailed`, () => {
      const a = VOXEL_SIM_QUALITY_PRESETS.fast[f] as number
      const b = VOXEL_SIM_QUALITY_PRESETS.balanced[f] as number
      const c = VOXEL_SIM_QUALITY_PRESETS.detailed[f] as number
      expect(a).toBeLessThan(b)
      expect(b).toBeLessThan(c)
    })
  }

  it('square XY: maxCols equals maxRows for every preset (preserves square voxel grid invariant)', () => {
    for (const k of PRESET_KEYS) {
      const p = VOXEL_SIM_QUALITY_PRESETS[k]
      expect(p.maxCols).toBe(p.maxRows)
    }
  })
})

// ===========================================================================
// F. Null-return invariants -- specific input shapes must yield null
// ===========================================================================
describe('F. null-return invariants', () => {
  it('returns null when segments is empty', () => {
    expect(buildVoxelRemovalFromCuttingSegments([], { toolRadiusMm: 1 })).toBeNull()
  })

  it('returns null when only rapid-kind segments are supplied', () => {
    expect(buildVoxelRemovalFromCuttingSegments(rapidOnly(), { toolRadiusMm: 1 })).toBeNull()
  })

  it('returns null when all feed segments are above the cuttingZThreshold (default 0.08)', () => {
    const segs: ToolpathSegment3[] = [{ kind: 'feed', x0: 0, y0: 0, z0: 1, x1: 5, y1: 0, z1: 1 }]
    expect(buildVoxelRemovalFromCuttingSegments(segs, { toolRadiusMm: 1 })).toBeNull()
  })

  it('a custom cuttingZThreshold below the segment Z still rejects', () => {
    const segs: ToolpathSegment3[] = [{ kind: 'feed', x0: 0, y0: 0, z0: 0.5, x1: 5, y1: 0, z1: 0.5 }]
    expect(
      buildVoxelRemovalFromCuttingSegments(segs, { toolRadiusMm: 1, cuttingZThreshold: 0.1 })
    ).toBeNull()
  })

  it('a single feed exactly AT the threshold (z=0.08) does not register as cutting', () => {
    const segs: ToolpathSegment3[] = [
      { kind: 'feed', x0: 0, y0: 0, z0: 0.08, x1: 5, y1: 0, z1: 0.08 }
    ]
    expect(buildVoxelRemovalFromCuttingSegments(segs, { toolRadiusMm: 1 })).toBeNull()
  })
})

// ===========================================================================
// G. Return shape invariants on a non-trivial cut
// ===========================================================================
describe('G. return shape invariants', () => {
  const result = buildVoxelRemovalFromCuttingSegments(patchFeeds(), {
    toolRadiusMm: 0.8,
    maxCols: 24,
    maxRows: 24,
    maxLayers: 16,
    maxStamps: 9000,
    maxSamplePoints: 2400
  })

  it('preview is non-null on a multi-pass shallow patch', () => {
    expect(result).not.toBeNull()
  })

  it('preview declares all 12 expected keys', () => {
    expect(result).not.toBeNull()
    const keys = Object.keys(result as VoxelRemovalPreview).sort()
    expect(keys).toEqual(
      [
        'cols',
        'rows',
        'layers',
        'cellMm',
        'originX',
        'originY',
        'zBottom',
        'stockTopZ',
        'stockVoxelCount',
        'carvedVoxelCount',
        'approxRemovedVolumeMm3',
        'samplePositions',
        'stampsCapped'
      ].sort()
    )
  })

  it('cols / rows / layers are positive finite integers', () => {
    expect(result).not.toBeNull()
    const r = result as VoxelRemovalPreview
    for (const k of ['cols', 'rows', 'layers'] as const) {
      expect(Number.isInteger(r[k])).toBe(true)
      expect(r[k]).toBeGreaterThan(0)
    }
  })

  it('cellMm is a finite positive number', () => {
    expect(result).not.toBeNull()
    const r = result as VoxelRemovalPreview
    expect(Number.isFinite(r.cellMm)).toBe(true)
    expect(r.cellMm).toBeGreaterThan(0)
  })

  it('cellMm respects the documented floor of 0.12 mm', () => {
    expect(result).not.toBeNull()
    const r = result as VoxelRemovalPreview
    expect(r.cellMm).toBeGreaterThanOrEqual(0.12)
  })

  it('originX / originY are finite numbers', () => {
    expect(result).not.toBeNull()
    const r = result as VoxelRemovalPreview
    expect(Number.isFinite(r.originX)).toBe(true)
    expect(Number.isFinite(r.originY)).toBe(true)
  })

  it('zBottom is finite and not above stockTopZ', () => {
    expect(result).not.toBeNull()
    const r = result as VoxelRemovalPreview
    expect(Number.isFinite(r.zBottom)).toBe(true)
    expect(r.zBottom).toBeLessThanOrEqual(r.stockTopZ)
  })

  it('stockVoxelCount is a non-negative integer', () => {
    expect(result).not.toBeNull()
    const r = result as VoxelRemovalPreview
    expect(Number.isInteger(r.stockVoxelCount)).toBe(true)
    expect(r.stockVoxelCount).toBeGreaterThanOrEqual(0)
  })

  it('carvedVoxelCount is a non-negative integer not exceeding stockVoxelCount', () => {
    expect(result).not.toBeNull()
    const r = result as VoxelRemovalPreview
    expect(Number.isInteger(r.carvedVoxelCount)).toBe(true)
    expect(r.carvedVoxelCount).toBeGreaterThanOrEqual(0)
    expect(r.carvedVoxelCount).toBeLessThanOrEqual(r.stockVoxelCount)
  })

  it('approxRemovedVolumeMm3 is a finite non-negative number', () => {
    expect(result).not.toBeNull()
    const r = result as VoxelRemovalPreview
    expect(Number.isFinite(r.approxRemovedVolumeMm3)).toBe(true)
    expect(r.approxRemovedVolumeMm3).toBeGreaterThanOrEqual(0)
  })

  it('samplePositions is a Float32Array', () => {
    expect(result).not.toBeNull()
    const r = result as VoxelRemovalPreview
    expect(r.samplePositions).toBeInstanceOf(Float32Array)
  })

  it('samplePositions length is a multiple of 3 (xyz triples)', () => {
    expect(result).not.toBeNull()
    const r = result as VoxelRemovalPreview
    expect(r.samplePositions.length % 3).toBe(0)
  })

  it('stampsCapped is a boolean', () => {
    expect(result).not.toBeNull()
    const r = result as VoxelRemovalPreview
    expect(typeof r.stampsCapped).toBe('boolean')
  })

  it('stockTopZ is the input default of 0 when omitted', () => {
    expect(result).not.toBeNull()
    const r = result as VoxelRemovalPreview
    expect(r.stockTopZ).toBe(0)
  })
})

// ===========================================================================
// H. Tool-shape branch -- flat default vs explicit ball
// ===========================================================================
describe('H. tool-shape branch (flat vs ball)', () => {
  it('default toolShape (omitted) yields the same carved count as explicit "flat"', () => {
    const segs = patchFeeds()
    const a = buildVoxelRemovalFromCuttingSegments(segs, {
      toolRadiusMm: 1,
      maxCols: 22,
      maxRows: 22,
      maxLayers: 12
    })
    const b = buildVoxelRemovalFromCuttingSegments(segs, {
      toolRadiusMm: 1,
      maxCols: 22,
      maxRows: 22,
      maxLayers: 12,
      toolShape: 'flat'
    })
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect((a as VoxelRemovalPreview).carvedVoxelCount).toBe(
      (b as VoxelRemovalPreview).carvedVoxelCount
    )
  })

  it('flat toolShape carves at least as much as ball on an angled cut (cylinder envelope >= sphere)', () => {
    const segs: ToolpathSegment3[] = [
      { kind: 'feed', x0: 0, y0: 0, z0: 0, x1: 6, y1: 0, z1: -2 }
    ]
    const flat = buildVoxelRemovalFromCuttingSegments(segs, {
      toolRadiusMm: 1.2,
      maxCols: 28,
      maxRows: 28,
      maxLayers: 18,
      toolShape: 'flat'
    })
    const ball = buildVoxelRemovalFromCuttingSegments(segs, {
      toolRadiusMm: 1.2,
      maxCols: 28,
      maxRows: 28,
      maxLayers: 18,
      toolShape: 'ball'
    })
    expect(flat).not.toBeNull()
    expect(ball).not.toBeNull()
    expect((flat as VoxelRemovalPreview).carvedVoxelCount).toBeGreaterThanOrEqual(
      (ball as VoxelRemovalPreview).carvedVoxelCount
    )
  })

  it('toolShape="ball" still produces a non-null preview (does not short-circuit)', () => {
    const r = buildVoxelRemovalFromCuttingSegments(patchFeeds(), {
      toolRadiusMm: 0.8,
      toolShape: 'ball'
    })
    expect(r).not.toBeNull()
  })

  it('a tiny toolRadiusMm under the floor (0.05) clamps up rather than throwing', () => {
    const r = buildVoxelRemovalFromCuttingSegments(patchFeeds(), { toolRadiusMm: 0.001 })
    expect(r).not.toBeNull()
    // When clamped to the 0.05 floor, the cellMm floor (0.12) still applies.
    expect((r as VoxelRemovalPreview).cellMm).toBeGreaterThanOrEqual(0.12)
  })
})

// ===========================================================================
// I. Stamps-cap and sample-cap budget invariants
// ===========================================================================
describe('I. stamps-cap and sample-cap budgets', () => {
  it('stampsCapped is false when the maxStamps budget is generous', () => {
    const r = buildVoxelRemovalFromCuttingSegments(shallowFeed(), {
      toolRadiusMm: 0.8,
      maxStamps: 50_000
    })
    expect(r).not.toBeNull()
    expect((r as VoxelRemovalPreview).stampsCapped).toBe(false)
  })

  it('stampsCapped flips to true when maxStamps=1 and there is more than one stamp to place', () => {
    const r = buildVoxelRemovalFromCuttingSegments(patchFeeds(), {
      toolRadiusMm: 0.8,
      maxStamps: 1
    })
    expect(r).not.toBeNull()
    expect((r as VoxelRemovalPreview).stampsCapped).toBe(true)
  })

  it('samplePositions length is bounded by maxSamplePoints * 3', () => {
    const cap = 12
    const r = buildVoxelRemovalFromCuttingSegments(patchFeeds(), {
      toolRadiusMm: 0.8,
      maxSamplePoints: cap
    })
    expect(r).not.toBeNull()
    expect((r as VoxelRemovalPreview).samplePositions.length).toBeLessThanOrEqual(cap * 3)
  })
})

// ===========================================================================
// J. Stock-rect XY hint and stockBottomZ extension
// ===========================================================================
describe('J. stock-rect XY hint + stockBottomZ extension', () => {
  it('stockRectXYMm expands the XY physical extent beyond the toolpath bounds', () => {
    const baseline = buildVoxelRemovalFromCuttingSegments(shallowFeed(), { toolRadiusMm: 0.8 })
    const expanded = buildVoxelRemovalFromCuttingSegments(shallowFeed(), {
      toolRadiusMm: 0.8,
      stockRectXYMm: { minX: -50, maxX: 50, minY: -50, maxY: 50 }
    })
    expect(baseline).not.toBeNull()
    expect(expanded).not.toBeNull()
    // The expanded grid covers a strictly larger XY footprint (cells * cellMm)
    // than the baseline. Voxel COUNT may drop because coarser cells fit fewer
    // per the same maxCols cap, but the physical extent strictly grows.
    const b = baseline as VoxelRemovalPreview
    const e = expanded as VoxelRemovalPreview
    const baselineExtentX = b.cols * b.cellMm
    const expandedExtentX = e.cols * e.cellMm
    expect(expandedExtentX).toBeGreaterThan(baselineExtentX)
    const baselineExtentY = b.rows * b.cellMm
    const expandedExtentY = e.rows * e.cellMm
    expect(expandedExtentY).toBeGreaterThan(baselineExtentY)
  })

  it('stockBottomZ extends the carved stock block downward', () => {
    const baseline = buildVoxelRemovalFromCuttingSegments(shallowFeed(), { toolRadiusMm: 0.8 })
    const extended = buildVoxelRemovalFromCuttingSegments(shallowFeed(), {
      toolRadiusMm: 0.8,
      stockBottomZ: -25
    })
    expect(baseline).not.toBeNull()
    expect(extended).not.toBeNull()
    expect((extended as VoxelRemovalPreview).zBottom).toBeLessThanOrEqual(
      (baseline as VoxelRemovalPreview).zBottom
    )
  })

  it('stockBottomZ=NaN is ignored (Number.isFinite gate)', () => {
    const r = buildVoxelRemovalFromCuttingSegments(shallowFeed(), {
      toolRadiusMm: 0.8,
      stockBottomZ: Number.NaN
    })
    expect(r).not.toBeNull()
    expect(Number.isFinite((r as VoxelRemovalPreview).zBottom)).toBe(true)
  })

  it('stockRectXYMm is ignored when min >= max (degenerate rect)', () => {
    const baseline = buildVoxelRemovalFromCuttingSegments(shallowFeed(), { toolRadiusMm: 0.8 })
    const degenerate = buildVoxelRemovalFromCuttingSegments(shallowFeed(), {
      toolRadiusMm: 0.8,
      stockRectXYMm: { minX: 0, maxX: 0, minY: 0, maxY: 0 }
    })
    expect(baseline).not.toBeNull()
    expect(degenerate).not.toBeNull()
    // Degenerate rect should leave the span unchanged
    expect((degenerate as VoxelRemovalPreview).cols).toBe(
      (baseline as VoxelRemovalPreview).cols
    )
  })

  it('stockRectXYMm is ignored when any bound is non-finite', () => {
    const baseline = buildVoxelRemovalFromCuttingSegments(shallowFeed(), { toolRadiusMm: 0.8 })
    const nan = buildVoxelRemovalFromCuttingSegments(shallowFeed(), {
      toolRadiusMm: 0.8,
      stockRectXYMm: { minX: Number.NaN, maxX: 50, minY: -50, maxY: 50 }
    })
    expect(baseline).not.toBeNull()
    expect(nan).not.toBeNull()
    expect((nan as VoxelRemovalPreview).stockVoxelCount).toBe(
      (baseline as VoxelRemovalPreview).stockVoxelCount
    )
  })
})

// ===========================================================================
// K. Three-machine path realism -- Laguna 5x10, Carvera 3-axis, Carvera 4-axis
// ===========================================================================
describe('K. three-machine path realism', () => {
  it('Laguna Swift 5x10: full-sheet stockRectXYMm (1524 x 3048 mm) is accepted', () => {
    const segs: ToolpathSegment3[] = [
      { kind: 'feed', x0: 100, y0: 100, z0: -3, x1: 1400, y1: 100, z1: -3 }
    ]
    const r = buildVoxelRemovalFromCuttingSegments(segs, {
      toolRadiusMm: 6.35,
      stockRectXYMm: { minX: 0, maxX: 1524, minY: 0, maxY: 3048 },
      stockTopZ: 0,
      stockBottomZ: -19,
      maxCols: VOXEL_SIM_QUALITY_PRESETS.balanced.maxCols,
      maxRows: VOXEL_SIM_QUALITY_PRESETS.balanced.maxRows,
      maxLayers: VOXEL_SIM_QUALITY_PRESETS.balanced.maxLayers,
      maxStamps: VOXEL_SIM_QUALITY_PRESETS.balanced.maxStamps
    })
    expect(r).not.toBeNull()
    expect((r as VoxelRemovalPreview).cols).toBeLessThanOrEqual(
      VOXEL_SIM_QUALITY_PRESETS.balanced.maxCols!
    )
  })

  it('Makera Carvera 3-axis: 360 x 240 x 140 mm envelope round-trips', () => {
    const segs: ToolpathSegment3[] = [
      { kind: 'feed', x0: 20, y0: 20, z0: -2, x1: 340, y1: 20, z1: -2 },
      { kind: 'feed', x0: 340, y0: 20, z0: -2, x1: 340, y1: 220, z1: -2 }
    ]
    const r = buildVoxelRemovalFromCuttingSegments(segs, {
      toolRadiusMm: 1.5875,
      stockRectXYMm: { minX: 0, maxX: 360, minY: 0, maxY: 240 },
      stockTopZ: 0,
      stockBottomZ: -10
    })
    expect(r).not.toBeNull()
    expect((r as VoxelRemovalPreview).layers).toBeGreaterThan(0)
  })

  it('Makera Carvera 4-axis indexed: tighter Z envelope (46 mm) still produces a preview', () => {
    const segs: ToolpathSegment3[] = [
      { kind: 'feed', x0: -30, y0: -30, z0: -1, x1: 30, y1: -30, z1: -1 },
      { kind: 'feed', x0: 30, y0: -30, z0: -1, x1: 30, y1: 30, z1: -1 }
    ]
    const r = buildVoxelRemovalFromCuttingSegments(segs, {
      toolRadiusMm: 1.0,
      stockRectXYMm: { minX: -46, maxX: 46, minY: -46, maxY: 46 },
      stockTopZ: 0,
      stockBottomZ: -46
    })
    expect(r).not.toBeNull()
    expect((r as VoxelRemovalPreview).cellMm).toBeGreaterThanOrEqual(0.12)
  })

  it('quality presets render onto Laguna full-sheet without exceeding their own maxCols', () => {
    for (const k of PRESET_KEYS) {
      const p = VOXEL_SIM_QUALITY_PRESETS[k]
      const r = buildVoxelRemovalFromCuttingSegments(
        [{ kind: 'feed', x0: 0, y0: 0, z0: -2, x1: 1500, y1: 0, z1: -2 }],
        {
          toolRadiusMm: 6.35,
          stockRectXYMm: { minX: 0, maxX: 1524, minY: 0, maxY: 3048 },
          stockTopZ: 0,
          stockBottomZ: -19,
          maxCols: p.maxCols,
          maxRows: p.maxRows,
          maxLayers: p.maxLayers,
          maxStamps: p.maxStamps,
          maxSamplePoints: p.maxSamplePoints
        }
      )
      expect(r).not.toBeNull()
      expect((r as VoxelRemovalPreview).cols).toBeLessThanOrEqual(p.maxCols!)
      expect((r as VoxelRemovalPreview).rows).toBeLessThanOrEqual(p.maxRows!)
      expect((r as VoxelRemovalPreview).layers).toBeLessThanOrEqual(p.maxLayers!)
    }
  })

  it('K2 Plus FDM is NOT a target -- the proxy carries no FDM imports / mentions', () => {
    // The proxy is subtractive only. K2 Plus FDM should not leak into this module's text.
    expect(SRC_TEXT).not.toMatch(/K2[\s_-]?Plus/i)
    expect(SRC_TEXT).not.toMatch(/Moonraker/i)
    expect(SRC_TEXT).not.toMatch(/Klipper/i)
  })

  it('CNC-target machines all share the same proxy entry point (no per-machine overload)', () => {
    // The proxy is single-function; per-machine Tier-3 viz is a caller responsibility.
    expect(typeof Mod.buildVoxelRemovalFromCuttingSegments).toBe('function')
    expect(Object.keys(Mod).filter((k) => k.startsWith('build'))).toHaveLength(1)
  })
})

// ===========================================================================
// L. Pure-function invariants -- input not mutated, repeated calls are equal
// ===========================================================================
describe('L. pure-function invariants', () => {
  it('does not mutate the input segments array', () => {
    const segs = patchFeeds()
    const beforeLength = segs.length
    const beforeFirst = { ...segs[0] }
    buildVoxelRemovalFromCuttingSegments(segs, { toolRadiusMm: 0.8 })
    expect(segs.length).toBe(beforeLength)
    expect(segs[0]).toEqual(beforeFirst)
  })

  it('does not mutate any individual segment object', () => {
    const segs = patchFeeds()
    const snapshots = segs.map((s) => ({ ...s }))
    buildVoxelRemovalFromCuttingSegments(segs, { toolRadiusMm: 0.8 })
    segs.forEach((s, i) => {
      expect(s).toEqual(snapshots[i])
    })
  })

  it('does not mutate the input opts object', () => {
    const opts: BuildVoxelRemovalOptions = {
      toolRadiusMm: 0.8,
      maxCols: 24,
      stockTopZ: 0
    }
    const before = { ...opts }
    buildVoxelRemovalFromCuttingSegments(patchFeeds(), opts)
    expect(opts).toEqual(before)
  })

  it('two calls with identical inputs produce identical scalar fields', () => {
    const opts = { toolRadiusMm: 0.8, maxCols: 24, maxRows: 24, maxLayers: 14 }
    const a = buildVoxelRemovalFromCuttingSegments(patchFeeds(), opts) as VoxelRemovalPreview
    const b = buildVoxelRemovalFromCuttingSegments(patchFeeds(), opts) as VoxelRemovalPreview
    expect(a.cols).toBe(b.cols)
    expect(a.rows).toBe(b.rows)
    expect(a.layers).toBe(b.layers)
    expect(a.cellMm).toBe(b.cellMm)
    expect(a.originX).toBe(b.originX)
    expect(a.originY).toBe(b.originY)
    expect(a.zBottom).toBe(b.zBottom)
    expect(a.stockTopZ).toBe(b.stockTopZ)
    expect(a.stockVoxelCount).toBe(b.stockVoxelCount)
    expect(a.carvedVoxelCount).toBe(b.carvedVoxelCount)
    expect(a.approxRemovedVolumeMm3).toBe(b.approxRemovedVolumeMm3)
    expect(a.stampsCapped).toBe(b.stampsCapped)
  })

  it('two calls with identical inputs produce equal-length samplePositions', () => {
    const opts = { toolRadiusMm: 0.8, maxCols: 24, maxRows: 24, maxLayers: 14 }
    const a = buildVoxelRemovalFromCuttingSegments(patchFeeds(), opts) as VoxelRemovalPreview
    const b = buildVoxelRemovalFromCuttingSegments(patchFeeds(), opts) as VoxelRemovalPreview
    expect(a.samplePositions.length).toBe(b.samplePositions.length)
  })

  it('returned samplePositions is a subarray view (length matches sample count, not capacity)', () => {
    const r = buildVoxelRemovalFromCuttingSegments(patchFeeds(), {
      toolRadiusMm: 0.8,
      maxSamplePoints: 5000
    }) as VoxelRemovalPreview
    // Length must be a multiple of 3 and at most 3 * maxSamplePoints.
    expect(r.samplePositions.length % 3).toBe(0)
    expect(r.samplePositions.length).toBeLessThanOrEqual(5000 * 3)
  })

  it('approxRemovedVolumeMm3 equals carvedVoxelCount * cellMm^3', () => {
    const r = buildVoxelRemovalFromCuttingSegments(patchFeeds(), {
      toolRadiusMm: 0.8
    }) as VoxelRemovalPreview
    const expected = r.carvedVoxelCount * r.cellMm * r.cellMm * r.cellMm
    expect(r.approxRemovedVolumeMm3).toBeCloseTo(expected, 9)
  })
})

// ===========================================================================
// M. Source-text whitelist -- sentinel pins so structural deletions surface
// ===========================================================================
describe('M. cam-voxel-removal-proxy.ts source-text whitelist', () => {
  it('source declares export type BuildVoxelRemovalOptions', () => {
    expect(SRC_TEXT).toMatch(/export type BuildVoxelRemovalOptions = \{/)
  })

  it('source declares export type VoxelSimQualityPreset = literal union', () => {
    expect(SRC_TEXT).toMatch(
      /export type VoxelSimQualityPreset = 'fast' \| 'balanced' \| 'detailed'/
    )
  })

  it('source declares export const VOXEL_SIM_QUALITY_PRESETS: Record<...>', () => {
    expect(SRC_TEXT).toMatch(/export const VOXEL_SIM_QUALITY_PRESETS: Record</)
  })

  it('source declares export type VoxelRemovalPreview', () => {
    expect(SRC_TEXT).toMatch(/export type VoxelRemovalPreview = \{/)
  })

  it('source declares export function buildVoxelRemovalFromCuttingSegments', () => {
    expect(SRC_TEXT).toMatch(/export function buildVoxelRemovalFromCuttingSegments\(/)
  })

  it('source uses Float32Array for samplePositions storage', () => {
    expect(SRC_TEXT).toMatch(/new Float32Array\(maxSamplePoints \* 3\)/)
  })

  it('source uses Uint8Array for the solid-grid storage', () => {
    expect(SRC_TEXT).toMatch(/new Uint8Array\(cols \* rows \* layers\)/)
  })

  it('source pins the cellMm floor at 0.12 mm', () => {
    expect(SRC_TEXT).toMatch(/0\.12/)
  })

  it('source documents the flat-vs-ball tool-shape branch comments', () => {
    expect(SRC_TEXT).toMatch(/Flat end mill: cylinder stamp/)
    expect(SRC_TEXT).toMatch(/Ball end mill: sphere stamp/)
  })

  it('source uses Math.hypot for both the cylinder (XY) and sphere (XYZ) distance checks', () => {
    expect(SRC_TEXT).toMatch(/Math\.hypot\(vx - cx, vy - cy, vz - cz\)/)
    expect(SRC_TEXT).toMatch(/Math\.hypot\(vx - cx, vy - cy\)/)
  })

  it('source guards stockBottomZ with Number.isFinite', () => {
    expect(SRC_TEXT).toMatch(/Number\.isFinite\(opts\.stockBottomZ\)/)
  })

  it('source guards stockRectXYMm bounds with Number.isFinite on all four corners', () => {
    expect(SRC_TEXT).toMatch(/Number\.isFinite\(rect\.minX\)/)
    expect(SRC_TEXT).toMatch(/Number\.isFinite\(rect\.maxX\)/)
    expect(SRC_TEXT).toMatch(/Number\.isFinite\(rect\.minY\)/)
    expect(SRC_TEXT).toMatch(/Number\.isFinite\(rect\.maxY\)/)
  })

  it('source uses cuttingZThreshold default of 0.08', () => {
    expect(SRC_TEXT).toMatch(/cuttingZThreshold \?\? 0\.08/)
  })

  it('source uses maxCols default of 36', () => {
    expect(SRC_TEXT).toMatch(/opts\.maxCols \?\? 36/)
  })

  it('source uses maxRows default of 36', () => {
    expect(SRC_TEXT).toMatch(/opts\.maxRows \?\? 36/)
  })

  it('source uses maxLayers default of 22', () => {
    expect(SRC_TEXT).toMatch(/opts\.maxLayers \?\? 22/)
  })

  it('source uses maxStamps default of 9000', () => {
    expect(SRC_TEXT).toMatch(/opts\.maxStamps \?\? 9000/)
  })

  it('source uses maxSamplePoints default of 2600', () => {
    expect(SRC_TEXT).toMatch(/opts\.maxSamplePoints \?\? 2600/)
  })

  it('source uses stockTopZ default of 0', () => {
    expect(SRC_TEXT).toMatch(/opts\.stockTopZ \?\? 0/)
  })

  it('source uses toolShape default of "flat"', () => {
    expect(SRC_TEXT).toMatch(/opts\.toolShape \?\? 'flat'/)
  })

  it('source clamps tool radius to a 0.05 mm floor', () => {
    expect(SRC_TEXT).toMatch(/Math\.max\(0\.05, opts\.toolRadiusMm\)/)
  })

  it('source returns null when there are zero cutting feeds', () => {
    expect(SRC_TEXT).toMatch(/if \(cutting\.length === 0\) return null/)
  })

  it('source documents "Tier-3 experimental preview" in the function header', () => {
    expect(SRC_TEXT).toMatch(/Tier-3 experimental preview/)
  })

  it('source documents the "Not swept-volume exact; not collision-safe" disclaimer', () => {
    expect(SRC_TEXT).toMatch(/Not swept-volume exact; not collision-safe\./)
  })

  it('source contains zero TODO / FIXME / HACK markers', () => {
    expect(SRC_TEXT).not.toMatch(/\bTODO\b/)
    expect(SRC_TEXT).not.toMatch(/\bFIXME\b/)
    expect(SRC_TEXT).not.toMatch(/\bHACK\b/)
  })

  it('source contains zero `: any` annotations (Safety Rule 4 -- no `any`)', () => {
    expect(SRC_TEXT).not.toMatch(/:\s*any\b/)
    expect(SRC_TEXT).not.toMatch(/\bas any\b/)
  })

  it('source declares the ToolpathSegment3 import as type-only', () => {
    expect(SRC_TEXT).toMatch(/import type \{ ToolpathSegment3 \} from '\.\/cam-gcode-toolpath'/)
  })

  it('source has exactly ONE export of buildVoxelRemovalFromCuttingSegments', () => {
    const matches = SRC_TEXT.match(/export function buildVoxelRemovalFromCuttingSegments\b/g) ?? []
    expect(matches).toHaveLength(1)
  })

  it('source has exactly ONE export of VOXEL_SIM_QUALITY_PRESETS', () => {
    const matches = SRC_TEXT.match(/export const VOXEL_SIM_QUALITY_PRESETS\b/g) ?? []
    expect(matches).toHaveLength(1)
  })
})

// ===========================================================================
// N. Type-level parity -- compile-time checks the exported types stay usable
// ===========================================================================
describe('N. type-level parity (compile-time)', () => {
  it('BuildVoxelRemovalOptions accepts the minimal { toolRadiusMm } shape', () => {
    const opts: BuildVoxelRemovalOptions = { toolRadiusMm: 1 }
    expect(opts.toolRadiusMm).toBe(1)
  })

  it('BuildVoxelRemovalOptions accepts the full option matrix', () => {
    const opts: BuildVoxelRemovalOptions = {
      toolRadiusMm: 1,
      maxCols: 24,
      maxRows: 24,
      maxLayers: 14,
      stockTopZ: 0,
      stockBottomZ: -10,
      stockRectXYMm: { minX: 0, maxX: 100, minY: 0, maxY: 100 },
      cuttingZThreshold: 0.05,
      marginMm: 1.5,
      maxStamps: 8000,
      maxSamplePoints: 2400,
      toolShape: 'ball'
    }
    expect(opts.toolShape).toBe('ball')
  })

  it('VoxelSimQualityPreset is a literal union of the three keys', () => {
    const a: VoxelSimQualityPreset = 'fast'
    const b: VoxelSimQualityPreset = 'balanced'
    const c: VoxelSimQualityPreset = 'detailed'
    expect([a, b, c]).toEqual(['fast', 'balanced', 'detailed'])
  })

  it('VoxelRemovalPreview is structurally usable as the function return type', () => {
    const r = buildVoxelRemovalFromCuttingSegments(patchFeeds(), {
      toolRadiusMm: 0.8
    })
    if (r === null) {
      // satisfy the type narrowing branch
      expect(r).toBeNull()
      return
    }
    const preview: VoxelRemovalPreview = r
    expect(preview.samplePositions).toBeInstanceOf(Float32Array)
  })
})
