/**
 * kernel-placement-parity-pin.test.ts -- [ID-0238] Cycle 166 test-coverage paired-pin
 *
 * Co-located paired-pin contract for `src/main/cad/kernel-placement-parity.ts`
 * (49 lines, 1380 bytes; one exported pure function
 * `comparePlacementParityFromBounds(preview, kernel, toleranceMm?)` and
 * one exported type `PlacementParity`).
 *
 * The function is the lightweight AABB-extents-and-centers smoke check
 * the renderer uses to confirm a kernel-built STL agrees with the
 * placement-preview STL the user staged. It's NOT a topology identity
 * check -- it just diffs (max - min) per axis and (min + max) / 2 per
 * axis between the two STL bounds and reports the worst absolute delta
 * vs a tolerance (default 0.2 mm). Used in main-process at
 * `src/main/ipc-modeling.ts:180` (the only production call-site,
 * verified via grep). The tolerance default is the contract:
 * 0.2 mm matches the precision of the K2 Plus 0.4 mm nozzle, the
 * Carvera 200 W spindle finishing accuracy, and the Laguna Swift
 * router pocket tolerance for plywood.
 *
 * Per CLAUDE.md "USER CONTEXT -- TARGET MACHINES" this helper is
 * cross-cutting across the THREE target machines: every kernel-built
 * STL parity check rendered in the main-process IPC layer flows
 * through this comparator BEFORE the result is shown to the user as
 * a "placed STL matches kernel STL" badge. A regression that swapped
 * extent vs center, or that lost the abs() wrapper, would pass
 * mismatched STLs as "ok" and let the operator load a wrongly-placed
 * model into a CAM job:
 *
 *   - **Creality K2 Plus** (FDM): a wrong-placement STL would print
 *     centered on the wrong region of the 350 x 350 mm bed.
 *   - **Laguna Swift 5x10** (CNC router, RichAuto A-series): full-
 *     sheet pocketing would mill the wrong region of a 48 x 96 in
 *     plywood blank -- expensive failure mode.
 *   - **Makera Carvera + 4th Axis**: 4-axis rotary alignment would
 *     be off the headstock origin (X-offset to rotary), turning a
 *     simultaneous job into a tool-crash.
 *
 * Sister cycles (post-Cycle-127 paired-pin chain, newest-first):
 *   - 165 [ID-0237] path-join (renderer-side companion)
 *   - 164 [ID-0236] EDIT-WORKFLOW.md docs refresh
 *   - 163 [ID-0235] machine-post-template-hints
 *   - 162 [ID-0234] cam-progress
 *   - 161 [ID-0233] shellLayoutStorage
 *   - 160 [ID-0223] cam-runtime-telemetry
 *   - 159 [ID-0232] laguna-vacuum-postlude
 *   - 154 [ID-0227] drawing-project-model-views
 *   - 152 [ID-0224] cam-heightfield-cylindrical
 *   - 149 [ID-0225] useShellResizableColumns
 *   - 147 [ID-0222] cam-engine-adapter
 *   - 145 [ID-0218] laguna-vacuum-allocator
 *   - 142 [ID-0216] cam-domain
 *   - 140 [ID-0215] setup-sheet
 *   - 137 [ID-0213] post-domain
 *   - 136 [ID-0212] fdm-gcode-layer-summary
 *
 * Pinned surfaces:
 *   (A) Module shape -- exact runtime export inventory
 *       (`comparePlacementParityFromBounds` only at runtime; the
 *       `PlacementParity` type is type-only and erased).
 *   (B) Function signature pin -- name, arity 3, native Function,
 *       string-or-string-typed-as-detail return.
 *   (C) Default tolerance contract -- omitted toleranceMm defaults to
 *       0.2 mm (matches K2 0.4mm nozzle precision, Carvera 200W
 *       spindle finishing, Laguna router pocket tolerance).
 *   (D) Identical-bounds happy path -- parity 'ok', maxDeltaMm 0,
 *       detail formatted as "max delta 0.000 mm".
 *   (E) Sub-tolerance drift -- maxDeltaMm > 0 but <= tol -> 'ok'.
 *   (F) Above-tolerance drift -- maxDeltaMm > tol -> 'mismatch',
 *       detail includes both delta AND the tolerance value with 3
 *       decimal places.
 *   (G) Algorithm coverage: extent-only drift (matched centers, off
 *       extents); center-only drift (matched extents, off centers);
 *       multi-axis worst-of-six selection.
 *   (H) Per-axis isolation -- X / Y / Z drifts each detected
 *       independently in extent and center channels.
 *   (I) Sign + abs() invariance -- positive vs negative deltas are
 *       treated symmetrically (Math.abs, not raw subtract).
 *   (J) Tolerance boundary -- tol == delta is 'ok' (<=); tol < delta
 *       by epsilon is 'mismatch'. Custom tolerances honored end-to-end.
 *   (K) Three-machine path realism -- explicit fixtures sized for
 *       the K2 Plus (350 mm cube), Laguna Swift 5x10 (48 in / 1219
 *       mm sheet), and Carvera 4-axis (240 mm rotary) build volumes.
 *   (L) Pure-function invariants -- same input -> same output across
 *       N=20 calls; no this-binding leakage; no input mutation; no
 *       throw on documented input shapes.
 *
 * NEW file (no prior coverage). Add-only -- no production code is
 * touched in Cycle 166.
 */
import { describe, expect, it } from 'vitest'
import * as PlacementParityModule from './kernel-placement-parity'
import { comparePlacementParityFromBounds } from './kernel-placement-parity'
import type { StlBounds } from '../stl'

function bounds(
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
  triangleCount = 12
): StlBounds {
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    triangleCount
  }
}

describe('[ID-0238] kernel-placement-parity.ts -- (A) module shape pin', () => {
  it('exports exactly { comparePlacementParityFromBounds } at runtime (PlacementParity is type-only)', () => {
    const keys = Object.keys(PlacementParityModule).sort()
    expect(keys).toEqual(['comparePlacementParityFromBounds'])
  })

  it('module namespace has only the standard Symbol.toStringTag', () => {
    const syms = Object.getOwnPropertySymbols(PlacementParityModule)
    expect(syms).toHaveLength(1)
    expect(syms[0]).toBe(Symbol.toStringTag)
    expect(
      (PlacementParityModule as unknown as Record<symbol, unknown>)[Symbol.toStringTag]
    ).toBe('Module')
  })

  it('comparePlacementParityFromBounds is the same reference via namespace and named import', () => {
    expect(PlacementParityModule.comparePlacementParityFromBounds).toBe(
      comparePlacementParityFromBounds
    )
  })
})

describe('[ID-0238] kernel-placement-parity.ts -- (B) function signature pin', () => {
  it('comparePlacementParityFromBounds is a native function', () => {
    expect(typeof comparePlacementParityFromBounds).toBe('function')
  })

  it('comparePlacementParityFromBounds.name === "comparePlacementParityFromBounds"', () => {
    expect(comparePlacementParityFromBounds.name).toBe('comparePlacementParityFromBounds')
  })

  it('comparePlacementParityFromBounds has arity 2 (preview, kernel) -- toleranceMm has a default and is NOT counted', () => {
    // .length excludes parameters with default values.
    expect(comparePlacementParityFromBounds.length).toBe(2)
  })

  it('return value has shape { parity: "ok"|"mismatch", detail: string, maxDeltaMm: number }', () => {
    const out = comparePlacementParityFromBounds(
      bounds(0, 0, 0, 1, 1, 1),
      bounds(0, 0, 0, 1, 1, 1)
    )
    expect(Object.keys(out).sort()).toEqual(['detail', 'maxDeltaMm', 'parity'])
    expect(out.parity).toBe('ok')
    expect(typeof out.detail).toBe('string')
    expect(typeof out.maxDeltaMm).toBe('number')
  })

  it('comparePlacementParityFromBounds is NOT an AsyncFunction', () => {
    const ctorName = (
      comparePlacementParityFromBounds as unknown as { constructor: { name: string } }
    ).constructor.name
    expect(ctorName).toBe('Function')
  })
})

describe('[ID-0238] kernel-placement-parity.ts -- (C) default tolerance contract', () => {
  it('omitted toleranceMm defaults to 0.2 mm -- a 0.2 mm delta is "ok"', () => {
    const preview = bounds(0, 0, 0, 10, 10, 10)
    // Inflate kernel max X by 0.2 -> extent delta 0.2; center delta 0.1.
    const kernel = bounds(0, 0, 0, 10.2, 10, 10)
    const out = comparePlacementParityFromBounds(preview, kernel)
    expect(out.parity).toBe('ok')
    // maxDeltaMm picks the LARGER of the six diffs (extent X=0.2, center X=0.1, others 0)
    expect(out.maxDeltaMm).toBeCloseTo(0.2, 10)
  })

  it('omitted toleranceMm defaults to 0.2 mm -- a 0.21 mm delta is "mismatch"', () => {
    const preview = bounds(0, 0, 0, 10, 10, 10)
    const kernel = bounds(0, 0, 0, 10.21, 10, 10)
    const out = comparePlacementParityFromBounds(preview, kernel)
    expect(out.parity).toBe('mismatch')
    expect(out.maxDeltaMm).toBeCloseTo(0.21, 10)
  })

  it('detail string for "ok" path uses 3-decimal-place formatting "max delta X.XXX mm"', () => {
    const out = comparePlacementParityFromBounds(
      bounds(0, 0, 0, 10, 10, 10),
      bounds(0, 0, 0, 10, 10, 10)
    )
    expect(out.detail).toBe('max delta 0.000 mm')
  })

  it('detail string for "mismatch" path includes BOTH delta AND tol with 3 decimal places', () => {
    const out = comparePlacementParityFromBounds(
      bounds(0, 0, 0, 10, 10, 10),
      bounds(0, 0, 0, 11, 10, 10)
    )
    expect(out.detail).toBe('max delta 1.000 mm (tol 0.200 mm)')
  })
})

describe('[ID-0238] kernel-placement-parity.ts -- (D) identical-bounds happy path', () => {
  it('two identical unit cubes -> ok / 0 / "max delta 0.000 mm"', () => {
    const out = comparePlacementParityFromBounds(
      bounds(-0.5, -0.5, -0.5, 0.5, 0.5, 0.5),
      bounds(-0.5, -0.5, -0.5, 0.5, 0.5, 0.5)
    )
    expect(out).toEqual({ parity: 'ok', detail: 'max delta 0.000 mm', maxDeltaMm: 0 })
  })

  it('two identical large cubes (K2 build volume 350 mm) -> ok / 0', () => {
    const out = comparePlacementParityFromBounds(
      bounds(0, 0, 0, 350, 350, 350),
      bounds(0, 0, 0, 350, 350, 350)
    )
    expect(out.parity).toBe('ok')
    expect(out.maxDeltaMm).toBe(0)
  })
})

describe('[ID-0238] kernel-placement-parity.ts -- (E) sub-tolerance drift', () => {
  it('extent drift exactly at tolerance -> ok (<=)', () => {
    const preview = bounds(0, 0, 0, 10, 10, 10)
    const kernel = bounds(0, 0, 0, 10.5, 10, 10) // extent X delta 0.5
    const out = comparePlacementParityFromBounds(preview, kernel, 0.5)
    expect(out.parity).toBe('ok')
    expect(out.maxDeltaMm).toBeCloseTo(0.5, 10)
  })

  it('extent drift just under tolerance -> ok', () => {
    const preview = bounds(0, 0, 0, 10, 10, 10)
    const kernel = bounds(0, 0, 0, 10.49, 10, 10)
    const out = comparePlacementParityFromBounds(preview, kernel, 0.5)
    expect(out.parity).toBe('ok')
  })

  it('center drift exactly at tolerance -> ok (<=)', () => {
    // Shift kernel +1 in X without changing extent (min and max both +1)
    const preview = bounds(0, 0, 0, 10, 10, 10)
    const kernel = bounds(1, 0, 0, 11, 10, 10) // extent X same, center X delta = 1
    const out = comparePlacementParityFromBounds(preview, kernel, 1.0)
    expect(out.parity).toBe('ok')
    expect(out.maxDeltaMm).toBeCloseTo(1.0, 10)
  })
})

describe('[ID-0238] kernel-placement-parity.ts -- (F) above-tolerance drift', () => {
  it('extent drift just over default tolerance -> mismatch', () => {
    const out = comparePlacementParityFromBounds(
      bounds(0, 0, 0, 10, 10, 10),
      bounds(0, 0, 0, 10.21, 10, 10)
    )
    expect(out.parity).toBe('mismatch')
    expect(out.detail).toMatch(/^max delta 0\.210 mm \(tol 0\.200 mm\)$/)
  })

  it('center drift well over tolerance -> mismatch with verbatim formatted detail', () => {
    const out = comparePlacementParityFromBounds(
      bounds(0, 0, 0, 10, 10, 10),
      bounds(5, 0, 0, 15, 10, 10), // extent same, center X delta 5
      0.5
    )
    expect(out.parity).toBe('mismatch')
    expect(out.maxDeltaMm).toBeCloseTo(5.0, 10)
    expect(out.detail).toBe('max delta 5.000 mm (tol 0.500 mm)')
  })

  it('mismatch detail string format is exactly "max delta D.DDD mm (tol T.TTT mm)" with no trailing period', () => {
    const out = comparePlacementParityFromBounds(
      bounds(0, 0, 0, 10, 10, 10),
      bounds(0, 0, 0, 11.234, 10, 10),
      0.123
    )
    expect(out.parity).toBe('mismatch')
    expect(out.detail).toBe('max delta 1.234 mm (tol 0.123 mm)')
    expect(out.detail.endsWith('.')).toBe(false)
  })
})

describe('[ID-0238] kernel-placement-parity.ts -- (G) algorithm coverage', () => {
  it('extent-only drift (centers matched) is detected', () => {
    // Symmetric extent expansion: shift min by -d/2 and max by +d/2.
    // This expands extent by d, but center stays put.
    const preview = bounds(0, 0, 0, 10, 10, 10) // center 5,5,5; extent 10,10,10
    const kernel = bounds(-0.5, 0, 0, 10.5, 10, 10) // center 5,5,5; extent 11,10,10
    const out = comparePlacementParityFromBounds(preview, kernel, 0.5)
    expect(out.parity).toBe('mismatch')
    expect(out.maxDeltaMm).toBeCloseTo(1.0, 10)
  })

  it('center-only drift (extents matched) is detected', () => {
    const preview = bounds(0, 0, 0, 10, 10, 10) // center 5,5,5; extent 10,10,10
    const kernel = bounds(2, 0, 0, 12, 10, 10) // center 7,5,5; extent 10,10,10 -- center X delta 2
    const out = comparePlacementParityFromBounds(preview, kernel, 1.0)
    expect(out.parity).toBe('mismatch')
    expect(out.maxDeltaMm).toBeCloseTo(2.0, 10)
  })

  it('multi-axis drift -- worst-of-six max() correctly selected', () => {
    const preview = bounds(0, 0, 0, 10, 10, 10) // center 5,5,5; extent 10,10,10
    // Drift extent X by 1, extent Y by 2, center Z by 3 -- max should be 3.
    const kernel = bounds(0, 0, -3, 11, 12, 7)
    // extent: x=11 (d=1), y=12 (d=2), z=10 (d=0)
    // center: x=5.5 (d=0.5), y=6 (d=1), z=2 (d=3)
    const out = comparePlacementParityFromBounds(preview, kernel, 0.5)
    expect(out.parity).toBe('mismatch')
    expect(out.maxDeltaMm).toBeCloseTo(3.0, 10)
  })
})

describe('[ID-0238] kernel-placement-parity.ts -- (H) per-axis isolation', () => {
  const baseline = bounds(0, 0, 0, 10, 10, 10)

  it('X extent drift detected (Y, Z untouched)', () => {
    const out = comparePlacementParityFromBounds(baseline, bounds(0, 0, 0, 11, 10, 10), 0.5)
    expect(out.parity).toBe('mismatch')
    expect(out.maxDeltaMm).toBeCloseTo(1.0, 10)
  })

  it('Y extent drift detected (X, Z untouched)', () => {
    const out = comparePlacementParityFromBounds(baseline, bounds(0, 0, 0, 10, 11, 10), 0.5)
    expect(out.parity).toBe('mismatch')
    expect(out.maxDeltaMm).toBeCloseTo(1.0, 10)
  })

  it('Z extent drift detected (X, Y untouched)', () => {
    const out = comparePlacementParityFromBounds(baseline, bounds(0, 0, 0, 10, 10, 11), 0.5)
    expect(out.parity).toBe('mismatch')
    expect(out.maxDeltaMm).toBeCloseTo(1.0, 10)
  })

  it('X center drift detected (Y, Z untouched)', () => {
    const out = comparePlacementParityFromBounds(baseline, bounds(1, 0, 0, 11, 10, 10), 0.5)
    expect(out.parity).toBe('mismatch')
    expect(out.maxDeltaMm).toBeCloseTo(1.0, 10)
  })

  it('Y center drift detected (X, Z untouched)', () => {
    const out = comparePlacementParityFromBounds(baseline, bounds(0, 1, 0, 10, 11, 10), 0.5)
    expect(out.parity).toBe('mismatch')
    expect(out.maxDeltaMm).toBeCloseTo(1.0, 10)
  })

  it('Z center drift detected (X, Y untouched)', () => {
    const out = comparePlacementParityFromBounds(baseline, bounds(0, 0, 1, 10, 10, 11), 0.5)
    expect(out.parity).toBe('mismatch')
    expect(out.maxDeltaMm).toBeCloseTo(1.0, 10)
  })
})

describe('[ID-0238] kernel-placement-parity.ts -- (I) sign + abs() invariance', () => {
  it('NEGATIVE-extent drift treated identically to POSITIVE-extent drift', () => {
    // Shrink kernel extent by 1 (preview - kernel = +1 -- abs irrelevant) -> max delta 0.5
    const out = comparePlacementParityFromBounds(
      bounds(0, 0, 0, 10, 10, 10),
      bounds(0, 0, 0, 9, 10, 10),
      0.5
    )
    expect(out.parity).toBe('mismatch')
    expect(out.maxDeltaMm).toBeCloseTo(1.0, 10)
  })

  it('NEGATIVE-center drift (kernel shifted -X) treated identically to POSITIVE shift', () => {
    const out = comparePlacementParityFromBounds(
      bounds(0, 0, 0, 10, 10, 10), // center 5
      bounds(-2, 0, 0, 8, 10, 10), // center 3, extent same
      0.5
    )
    expect(out.parity).toBe('mismatch')
    expect(out.maxDeltaMm).toBeCloseTo(2.0, 10)
  })
})

describe('[ID-0238] kernel-placement-parity.ts -- (J) tolerance boundary contract', () => {
  it('delta == tol exactly -> "ok" (boundary is inclusive via <=)', () => {
    const out = comparePlacementParityFromBounds(
      bounds(0, 0, 0, 10, 10, 10),
      bounds(0, 0, 0, 10.7, 10, 10),
      0.7
    )
    expect(out.parity).toBe('ok')
    expect(out.maxDeltaMm).toBeCloseTo(0.7, 10)
  })

  it('delta = tol + epsilon -> "mismatch"', () => {
    const out = comparePlacementParityFromBounds(
      bounds(0, 0, 0, 10, 10, 10),
      bounds(0, 0, 0, 10.7000001, 10, 10),
      0.7
    )
    expect(out.parity).toBe('mismatch')
  })

  it('custom tolerance 0 mm -> any non-zero delta is mismatch', () => {
    const out = comparePlacementParityFromBounds(
      bounds(0, 0, 0, 10, 10, 10),
      bounds(0, 0, 0, 10.000001, 10, 10),
      0
    )
    expect(out.parity).toBe('mismatch')
    expect(out.detail).toMatch(/^max delta 0\.000 mm \(tol 0\.000 mm\)$/)
  })

  it('custom tolerance 0 mm + EXACT match -> "ok" (delta 0 <= tol 0)', () => {
    const out = comparePlacementParityFromBounds(
      bounds(0, 0, 0, 10, 10, 10),
      bounds(0, 0, 0, 10, 10, 10),
      0
    )
    expect(out.parity).toBe('ok')
    expect(out.maxDeltaMm).toBe(0)
  })

  it('large custom tolerance (10 mm) tolerates a 5 mm extent drift', () => {
    const out = comparePlacementParityFromBounds(
      bounds(0, 0, 0, 10, 10, 10),
      bounds(0, 0, 0, 15, 10, 10),
      10
    )
    expect(out.parity).toBe('ok')
    expect(out.maxDeltaMm).toBeCloseTo(5.0, 10)
  })
})

describe('[ID-0238] kernel-placement-parity.ts -- (K) three-machine path realism', () => {
  it('K2 Plus (FDM) -- 100mm cube: identical preview vs kernel at default tol -> ok', () => {
    // Typical user-staged 100mm calibration cube on K2 Plus 350x350x350 bed.
    const preview = bounds(125, 125, 0, 225, 225, 100)
    const kernel = bounds(125, 125, 0, 225, 225, 100)
    const out = comparePlacementParityFromBounds(preview, kernel)
    expect(out.parity).toBe('ok')
  })

  it('K2 Plus (FDM) -- 100mm cube placed 0.15mm off in Z -> within default 0.2mm tol', () => {
    // 0.15 mm Z extent drift; well within K2 0.4mm nozzle precision.
    const preview = bounds(125, 125, 0, 225, 225, 100)
    const kernel = bounds(125, 125, 0, 225, 225, 100.15)
    const out = comparePlacementParityFromBounds(preview, kernel)
    expect(out.parity).toBe('ok')
    expect(out.maxDeltaMm).toBeCloseTo(0.15, 10)
  })

  it('Laguna Swift 5x10 -- 1219mm (48in) plywood blank: identical bounds -> ok', () => {
    // 48 in x 24 in x 0.75 in plywood blank in mm.
    const preview = bounds(0, 0, 0, 1219.2, 609.6, 19.05)
    const kernel = bounds(0, 0, 0, 1219.2, 609.6, 19.05)
    const out = comparePlacementParityFromBounds(preview, kernel)
    expect(out.parity).toBe('ok')
    expect(out.maxDeltaMm).toBe(0)
  })

  it('Laguna Swift 5x10 -- 1219mm plywood with 0.5mm pocket extent drift -> mismatch (above 0.2 default)', () => {
    const preview = bounds(0, 0, 0, 1219.2, 609.6, 19.05)
    const kernel = bounds(0, 0, 0, 1219.7, 609.6, 19.05) // 0.5 extent drift
    const out = comparePlacementParityFromBounds(preview, kernel)
    expect(out.parity).toBe('mismatch')
    expect(out.maxDeltaMm).toBeCloseTo(0.5, 10)
  })

  it('Carvera 4-axis -- 240mm rotary part: identical bounds -> ok', () => {
    // 92 mm dia x 240 mm length cylinder bounds.
    const preview = bounds(-46, -46, 0, 46, 46, 240)
    const kernel = bounds(-46, -46, 0, 46, 46, 240)
    const out = comparePlacementParityFromBounds(preview, kernel)
    expect(out.parity).toBe('ok')
  })

  it('Carvera 4-axis -- rotary X-headstock offset of 5mm flagged as mismatch', () => {
    // Carvera 4-axis posts require X offset to rotary headstock; if
    // the kernel STL didn't apply that offset, the placement check
    // catches it at +5 mm shift -> center delta 5 mm, well above
    // default 0.2 mm tol.
    const preview = bounds(-46, -46, 0, 46, 46, 240)
    const kernel = bounds(-41, -46, 0, 51, 46, 240) // shifted +5 in X
    const out = comparePlacementParityFromBounds(preview, kernel)
    expect(out.parity).toBe('mismatch')
    expect(out.maxDeltaMm).toBeCloseTo(5.0, 10)
  })
})

describe('[ID-0238] kernel-placement-parity.ts -- (L) pure-function invariants', () => {
  const preview = bounds(0, 0, 0, 10, 10, 10)
  const kernel = bounds(0, 0, 0, 10, 10, 10)

  it('same inputs -> same output across N=20 calls (no internal state)', () => {
    for (let i = 0; i < 20; i++) {
      const out = comparePlacementParityFromBounds(preview, kernel)
      expect(out).toEqual({ parity: 'ok', detail: 'max delta 0.000 mm', maxDeltaMm: 0 })
    }
  })

  it('does not mutate either input bounds object', () => {
    const p = bounds(0, 0, 0, 10, 10, 10)
    const k = bounds(1, 1, 1, 11, 11, 11)
    const beforeP = JSON.stringify(p)
    const beforeK = JSON.stringify(k)
    comparePlacementParityFromBounds(p, k)
    expect(JSON.stringify(p)).toBe(beforeP)
    expect(JSON.stringify(k)).toBe(beforeK)
  })

  it('does not depend on `this` (call-site binding does not leak)', () => {
    const detached = comparePlacementParityFromBounds
    expect(detached(preview, kernel).parity).toBe('ok')
  })

  it('does not throw on standard input shapes', () => {
    expect(() => comparePlacementParityFromBounds(preview, kernel)).not.toThrow()
    expect(() =>
      comparePlacementParityFromBounds(preview, kernel, 0)
    ).not.toThrow()
    expect(() =>
      comparePlacementParityFromBounds(preview, kernel, 1e6)
    ).not.toThrow()
  })

  it('triangleCount field is IGNORED (function only consumes min/max)', () => {
    const p = bounds(0, 0, 0, 10, 10, 10, 12)
    const k = bounds(0, 0, 0, 10, 10, 10, 99_999_999)
    const out = comparePlacementParityFromBounds(p, k)
    expect(out.parity).toBe('ok')
    expect(out.maxDeltaMm).toBe(0)
  })

  it('maxDeltaMm is always >= 0 (Math.abs invariant)', () => {
    const fixtures: Array<[StlBounds, StlBounds]> = [
      [bounds(0, 0, 0, 1, 1, 1), bounds(0, 0, 0, 1, 1, 1)],
      [bounds(0, 0, 0, 10, 10, 10), bounds(0, 0, 0, 9, 10, 10)],
      [bounds(0, 0, 0, 10, 10, 10), bounds(-5, 0, 0, 5, 10, 10)],
      [bounds(-100, -100, -100, 100, 100, 100), bounds(-99, -100, -100, 100, 100, 100)]
    ]
    for (const [p, k] of fixtures) {
      const out = comparePlacementParityFromBounds(p, k)
      expect(out.maxDeltaMm).toBeGreaterThanOrEqual(0)
    }
  })
})
