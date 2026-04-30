/**
 * shop-stock-bounds-pin.test.ts -- [ID-0207] Cycle 130 cam-engine paired-pin
 *
 * Pins the contract of `src/renderer/src/shop-stock-bounds.ts` -- the renderer-side
 * pure-helper module that decides whether a model fits inside the stock for ALL
 * three target machines (Creality K2 Plus FDM, Laguna Swift 5x10 CNC 3-axis,
 * Makera Carvera + 4th Axis Rotary). Sister cycles: 119 [ID-0196] derive-features,
 * 124 [ID-0201] viewport3d-bounds, 129 [ID-0206] design-viewport-interaction.
 *
 * Cross-cuts every machine -- the Y - Z swap convention is load-bearing for all
 * three (matches `frame.ts` machine-frame contract for Carvera 4-axis, the FDM
 * stock cube for K2, and the flat plate for Laguna). Any drift in the corner-
 * projection or fit-test branches will surface here BEFORE the next visual
 * regression in the Shop tab.
 *
 * The existing `shop-stock-bounds.test.ts` (94 lines, 5 it()) exercises high-
 * level fit/refit roundtrips. THIS pin file additionally pins:
 *   (A) module shape -- exported names + types,
 *   (B) the public `CARVERA_AXIS_Y = 0` constant (origin-centered convention),
 *   (C) `computeModelCornerWorldPointsInThreeJS` per-corner ordering + Y - Z swap,
 *   (D) `computeModelBoundsInThreeJS` derived from the 8 corners,
 *   (E) `modelFitsInStock` flat-stock branch (FDM / cnc_2d / cnc_3d) including
 *       FIT_EPS = 0.5 boundary tolerance,
 *   (F) `modelFitsInStock` rotary-cylinder branch (cnc_4axis / cnc_5axis) +
 *       chuck/clamp axial deduction,
 *   (G) `modelFitsInStock` rotary-square-bar branch,
 *   (H) `fitModelToStock` dispatch matrix,
 *   (I) source-text whitelist pinning header docs, MachineUIMode union,
 *       FIT_EPS literal, Y - Z swap arithmetic, and the
 *       "Fusion 360 / Mastercam" provenance note.
 *
 * ZERO production-code edits. Pure paired-pin (mirrors Cycle 119 / 124 / 129).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { ModelTransform } from './ShopModelViewer'
import * as M from './shop-stock-bounds'
import {
  CARVERA_AXIS_Y,
  computeModelBoundsInThreeJS,
  computeModelCornerWorldPointsInThreeJS,
  fitModelToStock,
  modelFitsInStock,
  type MachineUIMode
} from './shop-stock-bounds'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC_PATH = join(HERE, 'shop-stock-bounds.ts')
const SRC = readFileSync(SRC_PATH, 'utf-8')

function identityTransform(): ModelTransform {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 }
  }
}

const ALL_MODES: ReadonlyArray<MachineUIMode> = [
  'fdm',
  'cnc_2d',
  'cnc_3d',
  'cnc_4axis',
  'cnc_5axis'
]

// ---------------------------------------------------------------------------
// (A) Module shape
// ---------------------------------------------------------------------------

describe('[ID-0207] shop-stock-bounds module shape', () => {
  it('exports CARVERA_AXIS_Y', () => {
    expect(Object.prototype.hasOwnProperty.call(M, 'CARVERA_AXIS_Y')).toBe(true)
    expect(typeof CARVERA_AXIS_Y).toBe('number')
  })

  it('exports computeModelCornerWorldPointsInThreeJS as a function', () => {
    expect(typeof computeModelCornerWorldPointsInThreeJS).toBe('function')
  })

  it('exports computeModelBoundsInThreeJS as a function', () => {
    expect(typeof computeModelBoundsInThreeJS).toBe('function')
  })

  it('exports modelFitsInStock as a function', () => {
    expect(typeof modelFitsInStock).toBe('function')
  })

  it('exports fitModelToStock as a function', () => {
    expect(typeof fitModelToStock).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// (B) CARVERA_AXIS_Y constant
// ---------------------------------------------------------------------------

describe('[ID-0207] CARVERA_AXIS_Y constant', () => {
  it('is exactly 0 (origin-centered convention)', () => {
    expect(Object.is(CARVERA_AXIS_Y, 0)).toBe(true)
  })

  it('is a finite number (not NaN, not Infinity)', () => {
    expect(Number.isFinite(CARVERA_AXIS_Y)).toBe(true)
  })

  it('source documents it as origin-centered (matches Fusion 360 / Mastercam convention)', () => {
    expect(SRC).toContain('CARVERA_AXIS_Y')
    expect(SRC).toMatch(/Origin-centered/i)
    expect(SRC).toContain('Fusion 360 / Mastercam')
  })
})

// ---------------------------------------------------------------------------
// (C) computeModelCornerWorldPointsInThreeJS
// ---------------------------------------------------------------------------

describe('[ID-0207] computeModelCornerWorldPointsInThreeJS', () => {
  it('returns exactly 8 corners', () => {
    const corners = computeModelCornerWorldPointsInThreeJS(
      { x: 10, y: 20, z: 30 },
      identityTransform()
    )
    expect(corners.length).toBe(8)
  })

  it('each corner is a 3-tuple of finite numbers', () => {
    const corners = computeModelCornerWorldPointsInThreeJS(
      { x: 10, y: 20, z: 30 },
      identityTransform()
    )
    for (const c of corners) {
      expect(c.length).toBe(3)
      expect(Number.isFinite(c[0])).toBe(true)
      expect(Number.isFinite(c[1])).toBe(true)
      expect(Number.isFinite(c[2])).toBe(true)
    }
  })

  it('identity transform on (10, 20, 30) yields the 8 +/- (5, 10, 15) corners with model coords carried through 1:1', () => {
    // The Y - Z swap in shop-stock-bounds is on the SCALE/POSITION inputs
    // (scY = t.scale.z, fy = ... + t.position.z) -- NOT on the model extents.
    // At identity, the corner array carries (model X, model Y, model Z) 1:1
    // into Three.js (X, Y, Z). The swap only appears when t.scale or t.position
    // are non-default.
    const corners = computeModelCornerWorldPointsInThreeJS(
      { x: 10, y: 20, z: 30 },
      identityTransform()
    )
    // Corner 0: model (-5, -10, -15) -> Three.js (-5, -10, -15)
    expect(corners[0]![0]).toBeCloseTo(-5, 9)
    expect(corners[0]![1]).toBeCloseTo(-10, 9)
    expect(corners[0]![2]).toBeCloseTo(-15, 9)
    // Corner 7: model (+5, +10, +15) -> Three.js (+5, +10, +15)
    expect(corners[7]![0]).toBeCloseTo(5, 9)
    expect(corners[7]![1]).toBeCloseTo(10, 9)
    expect(corners[7]![2]).toBeCloseTo(15, 9)
  })

  it('translation: t.position.z lands on Three.js Y; t.position.y lands on Three.js Z (the swap)', () => {
    const t: ModelTransform = {
      position: { x: 100, y: 200, z: 300 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 }
    }
    const corners = computeModelCornerWorldPointsInThreeJS({ x: 0, y: 0, z: 0 }, t)
    // All 8 corners collapse to the same point at (position.x, position.z, position.y).
    for (const c of corners) {
      expect(c[0]).toBeCloseTo(100, 9)
      expect(c[1]).toBeCloseTo(300, 9) // t.position.z
      expect(c[2]).toBeCloseTo(200, 9) // t.position.y
    }
  })

  it('scale: t.scale.z drives Three.js Y extent; t.scale.y drives Three.js Z extent (the swap)', () => {
    const t: ModelTransform = {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 7, z: 11 } // y -> Three.js Z, z -> Three.js Y
    }
    const corners = computeModelCornerWorldPointsInThreeJS({ x: 2, y: 2, z: 2 }, t)
    let maxThreeY = -Infinity
    let maxThreeZ = -Infinity
    for (const c of corners) {
      if (c[1] > maxThreeY) maxThreeY = c[1]
      if (c[2] > maxThreeZ) maxThreeZ = c[2]
    }
    expect(maxThreeY).toBeCloseTo(11, 9) // half-extent 1 * scale.z 11
    expect(maxThreeZ).toBeCloseTo(7, 9) // half-extent 1 * scale.y 7
  })

  it('returns a fresh array on each invocation (pure, not memoized)', () => {
    const a = computeModelCornerWorldPointsInThreeJS(
      { x: 1, y: 1, z: 1 },
      identityTransform()
    )
    const b = computeModelCornerWorldPointsInThreeJS(
      { x: 1, y: 1, z: 1 },
      identityTransform()
    )
    expect(a).not.toBe(b)
    expect(a.length).toBe(b.length)
  })

  it('rotates t.rotation.x as the model X axis (degrees, not radians)', () => {
    const t: ModelTransform = {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 90, y: 0, z: 0 }, // 90 deg in DEGREES
      scale: { x: 1, y: 1, z: 1 }
    }
    const corners = computeModelCornerWorldPointsInThreeJS({ x: 0, y: 0, z: 2 }, t)
    // Model size (0, 0, 2) is a degenerate slab along Z (hz=1). At identity
    // it lives along Three.js Z with extent +/-1. A 90 deg rotation about
    // model X swings the Z extent onto Y: y3 = -z * sin(pi/2) = -+/-1, while
    // z3 collapses to ~0.
    let maxAbsThreeY = 0
    let maxAbsThreeZ = 0
    for (const c of corners) {
      if (Math.abs(c[1]) > maxAbsThreeY) maxAbsThreeY = Math.abs(c[1])
      if (Math.abs(c[2]) > maxAbsThreeZ) maxAbsThreeZ = Math.abs(c[2])
    }
    expect(maxAbsThreeY).toBeCloseTo(1, 6) // rotation moved extent into Y
    expect(maxAbsThreeZ).toBeLessThan(1e-6) // and out of Z
  })
})

// ---------------------------------------------------------------------------
// (D) computeModelBoundsInThreeJS
// ---------------------------------------------------------------------------

describe('[ID-0207] computeModelBoundsInThreeJS', () => {
  it('identity transform on a unit cube yields +/-0.5 bounds', () => {
    const b = computeModelBoundsInThreeJS({ x: 1, y: 1, z: 1 }, identityTransform())
    expect(b.loX).toBeCloseTo(-0.5, 9)
    expect(b.hiX).toBeCloseTo(0.5, 9)
    expect(b.loY).toBeCloseTo(-0.5, 9)
    expect(b.hiY).toBeCloseTo(0.5, 9)
    expect(b.loZ).toBeCloseTo(-0.5, 9)
    expect(b.hiZ).toBeCloseTo(0.5, 9)
  })

  it('identity transform on (80, 60, 12) yields per-axis bounds (model coords carried 1:1)', () => {
    const b = computeModelBoundsInThreeJS({ x: 80, y: 60, z: 12 }, identityTransform())
    expect(b.loX).toBeCloseTo(-40, 9)
    expect(b.hiX).toBeCloseTo(40, 9)
    expect(b.loY).toBeCloseTo(-30, 9) // model Y = 60 -> Three.js Y half = 30
    expect(b.hiY).toBeCloseTo(30, 9)
    expect(b.loZ).toBeCloseTo(-6, 9) // model Z = 12 -> Three.js Z half = 6
    expect(b.hiZ).toBeCloseTo(6, 9)
  })

  it('translation shifts bounds 1:1 (with the Y - Z swap on position)', () => {
    const t: ModelTransform = {
      position: { x: 100, y: 200, z: 300 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 }
    }
    const b = computeModelBoundsInThreeJS({ x: 10, y: 10, z: 10 }, t)
    expect(b.loX).toBeCloseTo(95, 9)
    expect(b.hiX).toBeCloseTo(105, 9)
    expect(b.loY).toBeCloseTo(295, 9) // t.position.z
    expect(b.hiY).toBeCloseTo(305, 9)
    expect(b.loZ).toBeCloseTo(195, 9) // t.position.y
    expect(b.hiZ).toBeCloseTo(205, 9)
  })

  it('zero-size model collapses to a point at origin under identity transform', () => {
    const b = computeModelBoundsInThreeJS({ x: 0, y: 0, z: 0 }, identityTransform())
    expect(b.loX).toBe(0)
    expect(b.hiX).toBe(0)
    expect(b.loY).toBe(0)
    expect(b.hiY).toBe(0)
    expect(b.loZ).toBe(0)
    expect(b.hiZ).toBe(0)
  })

  it('bounds derive from the same 8 corners as computeModelCornerWorldPointsInThreeJS', () => {
    const sz = { x: 13, y: 17, z: 19 }
    const t: ModelTransform = {
      position: { x: 1, y: 2, z: 3 },
      rotation: { x: 11, y: 22, z: 33 },
      scale: { x: 1.5, y: 0.5, z: 2.0 }
    }
    const corners = computeModelCornerWorldPointsInThreeJS(sz, t)
    const expectedBounds = corners.reduce(
      (acc, c) => {
        if (c[0]! < acc.loX) acc.loX = c[0]!
        if (c[0]! > acc.hiX) acc.hiX = c[0]!
        if (c[1]! < acc.loY) acc.loY = c[1]!
        if (c[1]! > acc.hiY) acc.hiY = c[1]!
        if (c[2]! < acc.loZ) acc.loZ = c[2]!
        if (c[2]! > acc.hiZ) acc.hiZ = c[2]!
        return acc
      },
      { loX: Infinity, hiX: -Infinity, loY: Infinity, hiY: -Infinity, loZ: Infinity, hiZ: -Infinity }
    )
    const got = computeModelBoundsInThreeJS(sz, t)
    expect(got.loX).toBeCloseTo(expectedBounds.loX, 9)
    expect(got.hiX).toBeCloseTo(expectedBounds.hiX, 9)
    expect(got.loY).toBeCloseTo(expectedBounds.loY, 9)
    expect(got.hiY).toBeCloseTo(expectedBounds.hiY, 9)
    expect(got.loZ).toBeCloseTo(expectedBounds.loZ, 9)
    expect(got.hiZ).toBeCloseTo(expectedBounds.hiZ, 9)
  })
})

// ---------------------------------------------------------------------------
// (E) modelFitsInStock -- flat path (FDM / cnc_2d / cnc_3d)
// ---------------------------------------------------------------------------

describe('[ID-0207] modelFitsInStock -- flat-stock branch', () => {
  // Flat stock convention: Three.js Y range is [0, stock.z] (bed at Y=0).
  // Model must be lifted via t.position.z so its Three.js Y bounds clear 0.
  // Note: per the Y - Z swap in the source, Three.js Y receives model Y
  // (not model Z) plus t.position.z; so the lift = model half-Y, not half-Z.
  function liftedFlatTransform(modelHalfY: number): ModelTransform {
    return {
      position: { x: 0, y: 0, z: modelHalfY }, // t.position.z -> Three.js Y offset
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 }
    }
  }

  it('fdm: small lifted model fits in larger stock', () => {
    // Model y=10 -> half-y=5; lifted to position.z=5 -> Three.js Y in [0,10].
    expect(
      modelFitsInStock(
        { x: 10, y: 10, z: 5 },
        liftedFlatTransform(5),
        { x: 100, y: 100, z: 20 },
        'fdm'
      )
    ).toBe(true)
  })

  it('cnc_2d: same flat semantics as fdm', () => {
    expect(
      modelFitsInStock(
        { x: 10, y: 10, z: 5 },
        liftedFlatTransform(5),
        { x: 100, y: 100, z: 20 },
        'cnc_2d'
      )
    ).toBe(true)
  })

  it('cnc_3d: same flat semantics as fdm', () => {
    expect(
      modelFitsInStock(
        { x: 10, y: 10, z: 5 },
        liftedFlatTransform(5),
        { x: 100, y: 100, z: 20 },
        'cnc_3d'
      )
    ).toBe(true)
  })

  it('flat stock Y axis is [0, stock.z] (not centered) -- model below Y=0 fails', () => {
    // Place a 10x10x10 model centered at origin (Three.js Y bounds = +/-5).
    // Flat stock Y is [0, stock.z=20] -- the model dips to Y=-5 which is < 0,
    // so the fit must reject (within a 0.5 mm tolerance).
    const t = identityTransform()
    expect(
      modelFitsInStock({ x: 10, y: 10, z: 10 }, t, { x: 100, y: 100, z: 20 }, 'fdm')
    ).toBe(false)
  })

  it('flat tolerance: model 0.4 mm outside stock half-X still fits (FIT_EPS = 0.5)', () => {
    // Half-X of stock = 50. Half-X of model after shift = 50.4. Within 0.5 mm
    // tolerance the fit must still return true. position.z lifts the model
    // above the bed (Three.js Y >= 0); model half-z = 5, so position.z = 5.
    const t: ModelTransform = {
      position: { x: 0.4, y: 0, z: 5 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 }
    }
    // Model size 100 along X means half-X = 50, shifted by 0.4 -> max = 50.4.
    // Stock half-X = 50. Excess = 0.4 mm < FIT_EPS (0.5).
    expect(
      modelFitsInStock({ x: 100, y: 10, z: 10 }, t, { x: 100, y: 100, z: 20 }, 'fdm')
    ).toBe(true)
  })

  it('flat tolerance: model 0.6 mm outside stock half-X fails (exceeds FIT_EPS = 0.5)', () => {
    const t: ModelTransform = {
      position: { x: 0.6, y: 0, z: 5 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 }
    }
    expect(
      modelFitsInStock({ x: 100, y: 10, z: 10 }, t, { x: 100, y: 100, z: 20 }, 'fdm')
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// (F) modelFitsInStock -- rotary cylinder branch (cnc_4axis / cnc_5axis)
// ---------------------------------------------------------------------------

describe('[ID-0207] modelFitsInStock -- rotary cylinder branch', () => {
  it('cnc_4axis: model within cylinder radius (sqrt(y^2+z^2) <= R) fits', () => {
    // Stock cylinder: lengthX=100, radius=15. Model size (10, 10, 10) at origin
    // -> Three.js corners at (+/-5, +/-5, +/-5). Diagonal of (5,5) cross-section
    // = 7.07 < 15 + 0.5. Fits.
    expect(
      modelFitsInStock(
        { x: 10, y: 10, z: 10 },
        identityTransform(),
        { x: 100, y: 30, z: 0 },
        'cnc_4axis'
      )
    ).toBe(true)
  })

  it('cnc_4axis: corner outside cylinder radius fails', () => {
    // Stock radius = 5 (stock.y=10). Model (10, 10, 10) corners at (+/-5, +/-5, +/-5).
    // Diagonal sqrt(5^2+5^2) = 7.07 > 5 + 0.5 -> fails.
    expect(
      modelFitsInStock(
        { x: 10, y: 10, z: 10 },
        identityTransform(),
        { x: 100, y: 10, z: 0 },
        'cnc_4axis'
      )
    ).toBe(false)
  })

  it('cnc_5axis: same rotary cylinder semantics as cnc_4axis', () => {
    expect(
      modelFitsInStock(
        { x: 10, y: 10, z: 10 },
        identityTransform(),
        { x: 100, y: 30, z: 0 },
        'cnc_5axis'
      )
    ).toBe(true)
    expect(
      modelFitsInStock(
        { x: 10, y: 10, z: 10 },
        identityTransform(),
        { x: 100, y: 10, z: 0 },
        'cnc_5axis'
      )
    ).toBe(false)
  })

  it('chuck depth deduction: model at chuck-side X fails when inside the unusable zone', () => {
    // Stock length 100 -> machinable X starts at -50 + chuck (10) = -40.
    // Model (5, 10, 10) shifted to position.x = -45 has corners at -47.5..-42.5;
    // -47.5 < -40 - 0.5 -> fails.
    const t: ModelTransform = {
      position: { x: -45, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 }
    }
    expect(
      modelFitsInStock({ x: 5, y: 10, z: 10 }, t, { x: 100, y: 30, z: 0 }, 'cnc_4axis', {
        chuckDepthMm: 10,
        clampOffsetMm: 0
      })
    ).toBe(false)
  })

  it('clamp offset adds to the unusable zone (chuckDepth + clampOffset)', () => {
    // chuckDepth = 5, clampOffset = 5 -> machinable X starts at -50 + 10 = -40.
    // Same model at X = -45 -> fails.
    const t: ModelTransform = {
      position: { x: -45, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 }
    }
    expect(
      modelFitsInStock({ x: 5, y: 10, z: 10 }, t, { x: 100, y: 30, z: 0 }, 'cnc_4axis', {
        chuckDepthMm: 5,
        clampOffsetMm: 5
      })
    ).toBe(false)
  })

  it('rotary stock is origin-centered (Y=0, Z=0): model dipping below Y=0 still fits if within radius', () => {
    // Unlike flat, rotary allows Y < 0. A small model at origin has corners
    // at (+/-r, +/-r, +/-r) which are all within radius.
    expect(
      modelFitsInStock(
        { x: 10, y: 4, z: 4 },
        identityTransform(),
        { x: 100, y: 30, z: 0 },
        'cnc_4axis'
      )
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// (G) modelFitsInStock -- rotary square-bar branch
// ---------------------------------------------------------------------------

describe('[ID-0207] modelFitsInStock -- rotary square-bar branch', () => {
  it('square bar accepts corners with |fy|, |fz| <= halfSide even if diagonal > radius', () => {
    // Stock side = 30 (stock.y=30). Half-side = 15. Cylinder radius = 15.
    // Model (10, 28, 28) -> half-extent (5, 14, 14). Three.js Y carries z=14,
    // Three.js Z carries y=14. Both <= 15 + 0.5 -> square fits.
    // Diagonal sqrt(14^2 + 14^2) = 19.8 > 15 + 0.5 -> cylinder would fail.
    expect(
      modelFitsInStock(
        { x: 10, y: 28, z: 28 },
        identityTransform(),
        { x: 100, y: 30, z: 0 },
        'cnc_4axis',
        { stockProfile: 'square' }
      )
    ).toBe(true)
    // Same model under cylinder profile fails:
    expect(
      modelFitsInStock(
        { x: 10, y: 28, z: 28 },
        identityTransform(),
        { x: 100, y: 30, z: 0 },
        'cnc_4axis'
      )
    ).toBe(false)
  })

  it('square bar same X-clipping semantics as cylinder (chuck/clamp)', () => {
    const t: ModelTransform = {
      position: { x: -45, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 }
    }
    expect(
      modelFitsInStock({ x: 5, y: 10, z: 10 }, t, { x: 100, y: 30, z: 0 }, 'cnc_4axis', {
        chuckDepthMm: 10,
        clampOffsetMm: 0,
        stockProfile: 'square'
      })
    ).toBe(false)
  })

  it('square bar: corner outside |fy| or |fz| half-side fails', () => {
    // Stock half-side = 5. Model (10, 20, 20) -> half-extent (5, 10, 10).
    // |fy|=10 > 5 + 0.5 -> fails.
    expect(
      modelFitsInStock(
        { x: 10, y: 20, z: 20 },
        identityTransform(),
        { x: 100, y: 10, z: 0 },
        'cnc_4axis',
        { stockProfile: 'square' }
      )
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// (H) fitModelToStock dispatch matrix
// ---------------------------------------------------------------------------

describe('[ID-0207] fitModelToStock dispatch matrix', () => {
  it('returns position / rotation / scale on every mode', () => {
    for (const mode of ALL_MODES) {
      const fit = fitModelToStock({ x: 20, y: 20, z: 20 }, { x: 100, y: 100, z: 50 }, mode)
      expect(typeof fit.position.x).toBe('number')
      expect(typeof fit.rotation.x).toBe('number')
      expect(typeof fit.scale.x).toBe('number')
      expect(Number.isFinite(fit.scale.x)).toBe(true)
    }
  })

  it("undefined mode falls through to flat (fitFlat) -- doesn't throw", () => {
    const fit = fitModelToStock({ x: 20, y: 20, z: 20 }, { x: 100, y: 100, z: 50 })
    const t = { ...identityTransform(), ...fit }
    expect(modelFitsInStock({ x: 20, y: 20, z: 20 }, t, { x: 100, y: 100, z: 50 }, 'fdm')).toBe(true)
  })

  it('cnc_4axis with stockProfile=square uses fitSquareBar (larger fitScale than cylinder for same stock)', () => {
    const cyl = fitModelToStock({ x: 20, y: 20, z: 20 }, { x: 100, y: 30, z: 0 }, 'cnc_4axis', {
      chuckDepthMm: 0,
      clampOffsetMm: 0
    })
    const sq = fitModelToStock({ x: 20, y: 20, z: 20 }, { x: 100, y: 30, z: 0 }, 'cnc_4axis', {
      chuckDepthMm: 0,
      clampOffsetMm: 0,
      stockProfile: 'square'
    })
    expect(sq.scale.x).toBeGreaterThan(cyl.scale.x)
  })

  it('cnc_5axis dispatches to the same rotary engine as cnc_4axis (cylinder)', () => {
    const a = fitModelToStock({ x: 20, y: 20, z: 20 }, { x: 100, y: 30, z: 0 }, 'cnc_4axis')
    const b = fitModelToStock({ x: 20, y: 20, z: 20 }, { x: 100, y: 30, z: 0 }, 'cnc_5axis')
    // Both should produce equivalent fits (the engine selection is identical
    // for the cylindrical branch); compare the final scale to within 1e-9.
    expect(b.scale.x).toBeCloseTo(a.scale.x, 9)
  })

  it('fitModelToStock fits are non-degenerate (scale > 0) for all modes on a (20, 20, 20) model', () => {
    for (const mode of ALL_MODES) {
      const fit = fitModelToStock({ x: 20, y: 20, z: 20 }, { x: 100, y: 100, z: 50 }, mode)
      expect(fit.scale.x).toBeGreaterThan(0)
      expect(fit.scale.y).toBeGreaterThan(0)
      expect(fit.scale.z).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// (I) Source-text whitelist
// ---------------------------------------------------------------------------

describe('[ID-0207] shop-stock-bounds source-text whitelist', () => {
  it('header documents the Y - Z swap is aligned with applyTransform in ShopModelViewer.tsx', () => {
    expect(SRC).toMatch(/applyTransform in ShopModelViewer\.tsx/)
  })

  it('exports MachineUIMode as a 5-member string-literal union (fdm | cnc_2d | cnc_3d | cnc_4axis | cnc_5axis)', () => {
    // The literal type alias declaration -- pinned exactly to catch any
    // accidental reordering or removal/addition of a mode.
    expect(SRC).toContain(
      "export type MachineUIMode = 'fdm' | 'cnc_2d' | 'cnc_3d' | 'cnc_4axis' | 'cnc_5axis'"
    )
  })

  it('imports fitCylindrical, fitFlat, fitSquareBar, and StockFitResult type from stock-fit-engine', () => {
    expect(SRC).toContain('fitCylindrical')
    expect(SRC).toContain('fitFlat')
    expect(SRC).toContain('fitSquareBar')
    expect(SRC).toContain('type StockFitResult')
    expect(SRC).toContain("from './stock-fit-engine'")
  })

  it('FIT_EPS = 0.5 (tolerance literal pinned)', () => {
    expect(SRC).toContain('const FIT_EPS = 0.5')
  })

  it('source applies the Y - Z swap on scale (scY = t.scale.z, scZ = t.scale.y)', () => {
    expect(SRC).toContain('const scY = t.scale.z')
    expect(SRC).toContain('const scZ = t.scale.y')
  })

  it('source applies the Y - Z swap on translation (fy from t.position.z, fz from t.position.y)', () => {
    expect(SRC).toContain('y3 * scY + t.position.z')
    expect(SRC).toContain('z3 * scZ + t.position.y')
  })

  it('source documents "matches Fusion 360 / Mastercam convention" provenance for CARVERA_AXIS_Y', () => {
    expect(SRC).toContain('Fusion 360 / Mastercam convention')
  })

  it('source documents that 4/5-axis cylinder stock has axis at origin (Y=0, Z=0)', () => {
    expect(SRC).toMatch(/axis at origin/i)
    expect(SRC).toMatch(/Y=0/)
    expect(SRC).toMatch(/Z=0/)
  })

  it('source declares CARVERA_AXIS_Y as an exported numeric constant', () => {
    expect(SRC).toContain('export const CARVERA_AXIS_Y = 0')
  })

  it('source documents the rotary stock is origin-centered (matches CARVERA_AXIS_Y = 0)', () => {
    expect(SRC).toMatch(/Origin-centered/i)
  })
})
