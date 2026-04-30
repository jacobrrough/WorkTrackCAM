/**
 * stock-fit-engine-pin.test.ts -- [ID-0217] Cycle 144 cam-engine paired-pin
 *
 * Companion to the behavior-test file `stock-fit-engine.test.ts` (166 lines,
 * 22 it()) that covers happy-path orientation/scale outputs across the three
 * fit modes. THIS pin file additionally pins the CONTRACT of
 * `src/renderer/src/stock-fit-engine.ts` -- the Stock Fit Engine that
 * computes optimal orientation and uniform scale for placing a model inside
 * stock geometry. Pinned surfaces beyond the existing behaviour test:
 * module shape, StockFitResult shape contract, fitScale floor, default-arg
 * values, position/rotation invariants, purity & determinism (N=10 +
 * frozen-input safety), three-machine cross-cuts, and source-text whitelist
 * pinning ROT_STEP/FLAT_STEP/DEG_TO_RAD/epsilon literal/etc.
 *
 * Cross-cuts every target machine in the CLAUDE.md "USER CONTEXT" list:
 *
 *   - **Creality K2 Plus** (FDM, Klipper/Moonraker): 350 x 350 x 350 mm
 *     build volume uses `fitFlat` for rectangular flat stock; the
 *     position.z = stock.z / 2 invariant places the model centered in
 *     the bed-Y (Three.js Y) axis for FDM slicing.
 *   - **Laguna Swift 5x10** (CNC router, RichAuto A-series): 1524 x 3048 mm
 *     full-sheet plywood/MDF stock uses `fitFlat` for 3-axis subtractive
 *     jobs; the same position.z = stock.z / 2 places the model centered
 *     above the spoilboard in Three.js Y.
 *   - **Makera Carvera + 4th Axis Rotary**: ~92 mm diameter x 240 mm
 *     length rotary stock uses `fitCylindrical` (round bar) and
 *     `fitSquareBar` (square bar) with chuck/clamp deductions; position.x
 *     = (chuckDepth + clampOffset) / 2 places the model centered in the
 *     usable axial extent away from the rotary headstock.
 *
 * Sister cycles (post-Cycle-127 paired-pin chain):
 *   - 119 [ID-0196] derive-features
 *   - 124 [ID-0201] viewport3d-bounds
 *   - 129 [ID-0206] design-viewport-interaction
 *   - 130 [ID-0207] shop-stock-bounds
 *   - 131 [ID-0208] command-palette-memory
 *   - 132 [ID-0209] post-process-dialects
 *   - 134 [ID-0210] brand-bar-machine-badge
 *   - 135 [ID-0211] moonraker-push-payload
 *   - 136 [ID-0212] fdm-gcode-layer-summary
 *   - 137 [ID-0213] post-domain
 *   - 139 [ID-0214] laguna-vacuum-allocator-ui
 *   - 140 [ID-0215] setup-sheet
 *   - 142 [ID-0216] cam-domain
 *   - 144 [ID-0217] stock-fit-engine (THIS FILE)
 *
 * ZERO production-code edits. Pure paired-pin. NEW file targeted under 600
 * lines so the Write tool is safe per Cycle 143 [ID-0067-data-v19] revised
 * threshold (multi-line block-replace mandatory-territory at >600 lines).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as M from './stock-fit-engine'
import {
  fitCylindrical,
  fitFlat,
  fitSquareBar,
  type StockFitResult
} from './stock-fit-engine'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC_PATH = join(HERE, 'stock-fit-engine.ts')
const SRC = readFileSync(SRC_PATH, 'utf-8')

// ── Section A: module shape ────────────────────────────────────────────

describe('[A] stock-fit-engine module shape', () => {
  it('A.1 exports exactly 3 runtime symbols (string keys)', () => {
    const stringKeys = Object.keys(M).sort()
    expect(stringKeys).toEqual(['fitCylindrical', 'fitFlat', 'fitSquareBar'])
  })

  it('A.2 has only Symbol.toStringTag for ESM symbol-keys', () => {
    const symbolKeys = Object.getOwnPropertySymbols(M)
    // Vite/esbuild ESM namespaces ship Symbol.toStringTag === "Module".
    // No other symbol keys are allowed (would indicate accidental decorator
    // metadata or a private brand leaking out).
    expect(symbolKeys.length).toBeLessThanOrEqual(1)
    if (symbolKeys.length === 1) {
      expect(symbolKeys[0]).toBe(Symbol.toStringTag)
    }
  })

  it('A.3 ESM namespace has null prototype', () => {
    expect(Object.getPrototypeOf(M)).toBeNull()
  })

  it('A.4 fitCylindrical is a function', () => {
    expect(typeof fitCylindrical).toBe('function')
  })

  it('A.5 fitSquareBar is a function', () => {
    expect(typeof fitSquareBar).toBe('function')
  })

  it('A.6 fitFlat is a function', () => {
    expect(typeof fitFlat).toBe('function')
  })

  it('A.7 fitCylindrical declared arity is 3 (2 trailing defaults not counted)', () => {
    // Function.prototype.length excludes parameters with default values
    // and any after the first defaulted one. Required: modelSz, stockLenMm,
    // stockDiaMm. Optional defaults: chuckDepthMm=0, clampOffsetMm=0.
    expect(fitCylindrical.length).toBe(3)
  })

  it('A.8 fitSquareBar declared arity is 3 (2 trailing defaults not counted)', () => {
    expect(fitSquareBar.length).toBe(3)
  })

  it('A.9 fitFlat declared arity is 2', () => {
    expect(fitFlat.length).toBe(2)
  })

  it('A.10 no default export', () => {
    expect((M as Record<string, unknown>).default).toBeUndefined()
  })
})

// ── Section B: StockFitResult shape contract ───────────────────────────

describe('[B] StockFitResult shape contract', () => {
  const sample = (): StockFitResult => fitFlat({ x: 50, y: 50, z: 10 }, { x: 100, y: 100, z: 20 })

  it('B.1 result has exactly the 4 documented keys', () => {
    const r = sample()
    expect(Object.keys(r).sort()).toEqual(['fitScale', 'position', 'rotation', 'scale'])
  })

  it('B.2 position has exactly { x, y, z } keys', () => {
    const r = sample()
    expect(Object.keys(r.position).sort()).toEqual(['x', 'y', 'z'])
  })

  it('B.3 rotation has exactly { x, y, z } keys', () => {
    const r = sample()
    expect(Object.keys(r.rotation).sort()).toEqual(['x', 'y', 'z'])
  })

  it('B.4 scale has exactly { x, y, z } keys', () => {
    const r = sample()
    expect(Object.keys(r.scale).sort()).toEqual(['x', 'y', 'z'])
  })

  it('B.5 every numeric field is a finite number', () => {
    const r = sample()
    for (const v of [
      r.position.x, r.position.y, r.position.z,
      r.rotation.x, r.rotation.y, r.rotation.z,
      r.scale.x, r.scale.y, r.scale.z,
      r.fitScale
    ]) {
      expect(typeof v).toBe('number')
      expect(Number.isFinite(v)).toBe(true)
    }
  })

  it('B.6 scale.x === scale.y === scale.z === fitScale (uniform scale invariant)', () => {
    const r = sample()
    expect(r.scale.x).toBe(r.fitScale)
    expect(r.scale.y).toBe(r.fitScale)
    expect(r.scale.z).toBe(r.fitScale)
  })
})

// ── Section C: fitCylindrical contract ─────────────────────────────────

describe('[C] fitCylindrical contract', () => {
  it('C.1 returns positive fitScale for typical Carvera-rotary input', () => {
    // Carvera 4th-axis stock: 240 mm length x 92 mm diameter
    const r = fitCylindrical({ x: 50, y: 30, z: 30 }, 240, 92)
    expect(r.fitScale).toBeGreaterThan(0)
  })

  it('C.2 position.y is exactly 0 (rotary axis runs along X)', () => {
    const r = fitCylindrical({ x: 50, y: 30, z: 30 }, 240, 92)
    expect(r.position.y).toBe(0)
  })

  it('C.3 position.z is exactly 0 (rotary axis runs along X)', () => {
    const r = fitCylindrical({ x: 50, y: 30, z: 30 }, 240, 92)
    expect(r.position.z).toBe(0)
  })

  it('C.4 position.x = (chuckDepthMm + clampOffsetMm) / 2', () => {
    const r = fitCylindrical({ x: 50, y: 20, z: 20 }, 240, 50, 12, 8)
    expect(r.position.x).toBeCloseTo((12 + 8) / 2)
  })

  it('C.5 rotation.x is always 0 (cylinder is rotationally symmetric)', () => {
    const r = fitCylindrical({ x: 200, y: 10, z: 10 }, 240, 92)
    expect(r.rotation.x).toBe(0)
  })

  it('C.6 rotation.y is in [0, 90] degrees', () => {
    const r = fitCylindrical({ x: 50, y: 30, z: 30 }, 240, 92)
    expect(r.rotation.y).toBeGreaterThanOrEqual(0)
    expect(r.rotation.y).toBeLessThanOrEqual(90)
  })

  it('C.7 rotation.z is in [0, 90] degrees', () => {
    const r = fitCylindrical({ x: 50, y: 30, z: 30 }, 240, 92)
    expect(r.rotation.z).toBeGreaterThanOrEqual(0)
    expect(r.rotation.z).toBeLessThanOrEqual(90)
  })

  it('C.8 default chuckDepthMm = 0 and clampOffsetMm = 0', () => {
    const explicit = fitCylindrical({ x: 50, y: 20, z: 20 }, 240, 50, 0, 0)
    const defaulted = fitCylindrical({ x: 50, y: 20, z: 20 }, 240, 50)
    expect(defaulted.fitScale).toBeCloseTo(explicit.fitScale)
    expect(defaulted.position.x).toBe(0)
  })

  it('C.9 fitScale floor at 0.001 even on degenerate input', () => {
    // Degenerate model size: all corners at origin -> rotated extents = 0,
    // bestScale stays at -1, the floor `Math.max(0.001, bestScale)` clamps.
    const r = fitCylindrical({ x: 0, y: 0, z: 0 }, 240, 92)
    expect(r.fitScale).toBe(0.001)
  })

  it('C.10 chuck increases position.x and decreases fitScale', () => {
    const base = fitCylindrical({ x: 200, y: 10, z: 10 }, 250, 40)
    const withChuck = fitCylindrical({ x: 200, y: 10, z: 10 }, 250, 40, 50)
    expect(withChuck.position.x).toBeCloseTo(25)
    expect(withChuck.fitScale).toBeLessThan(base.fitScale)
  })

  it('C.11 long-axis-aligned model achieves scale dominated by length', () => {
    // 200 mm long, 10 mm cross-section in 250 mm long, 40 mm dia stock.
    // Best alignment puts the long axis along X (cylinder axis).
    const r = fitCylindrical({ x: 200, y: 10, z: 10 }, 250, 40)
    // Length-bound: 250 / 200 = 1.25.
    expect(r.fitScale).toBeCloseTo(1.25, 1)
  })

  it('C.12 result rotation values are integer multiples of ROT_STEP=5', () => {
    const r = fitCylindrical({ x: 50, y: 30, z: 20 }, 240, 92)
    // ROT_STEP = 5 deg. Search step is exact, so result angles must be
    // exact multiples of 5.
    expect(r.rotation.y % 5).toBe(0)
    expect(r.rotation.z % 5).toBe(0)
  })
})

// ── Section D: fitSquareBar contract ───────────────────────────────────

describe('[D] fitSquareBar contract', () => {
  it('D.1 returns positive fitScale for typical Carvera-square-bar input', () => {
    const r = fitSquareBar({ x: 50, y: 30, z: 30 }, 240, 92)
    expect(r.fitScale).toBeGreaterThan(0)
  })

  it('D.2 position is identical formula to fitCylindrical', () => {
    const r = fitSquareBar({ x: 50, y: 20, z: 20 }, 240, 50, 12, 8)
    expect(r.position.x).toBeCloseTo((12 + 8) / 2)
    expect(r.position.y).toBe(0)
    expect(r.position.z).toBe(0)
  })

  it('D.3 rotation.x sweeps in [0, 45] (square is NOT rotationally symmetric)', () => {
    // Square cross-section is NOT rotationally symmetric, so rx CAN be > 0.
    // Sweep is 0..45 deg by ROT_STEP (45 deg covers the full 90-deg quadrant
    // by symmetry of the 4-fold square).
    const r = fitSquareBar({ x: 30, y: 30, z: 30 }, 100, 30)
    expect(r.rotation.x).toBeGreaterThanOrEqual(0)
    expect(r.rotation.x).toBeLessThanOrEqual(45)
    expect(r.rotation.x % 5).toBe(0)
  })

  it('D.4 default chuck and clamp are 0', () => {
    const explicit = fitSquareBar({ x: 50, y: 20, z: 20 }, 240, 50, 0, 0)
    const defaulted = fitSquareBar({ x: 50, y: 20, z: 20 }, 240, 50)
    expect(defaulted.fitScale).toBeCloseTo(explicit.fitScale)
    expect(defaulted.position.x).toBe(0)
  })

  it('D.5 fitScale floor at 0.001 on degenerate input', () => {
    const r = fitSquareBar({ x: 0, y: 0, z: 0 }, 240, 92)
    expect(r.fitScale).toBe(0.001)
  })

  it('D.6 a cube model fits LARGER in a square bar than in a round bar', () => {
    // Square corners are NOT wasted: halfSide = side/2 vs cylinder
    // R = side/2 -> square allows max(|Y|, |Z|) = side/2 vs cylinder
    // sqrt(Y^2 + Z^2) <= side/2.
    const cube = { x: 20, y: 20, z: 20 }
    const cyl = fitCylindrical(cube, 100, 30)
    const sq = fitSquareBar(cube, 100, 30)
    expect(sq.fitScale).toBeGreaterThan(cyl.fitScale)
  })

  it('D.7 chuck reduces fitScale and shifts position.x', () => {
    const base = fitSquareBar({ x: 80, y: 20, z: 20 }, 100, 40)
    const withChuck = fitSquareBar({ x: 80, y: 20, z: 20 }, 100, 40, 30)
    expect(withChuck.fitScale).toBeLessThan(base.fitScale)
    expect(withChuck.position.x).toBeCloseTo(15)
  })

  it('D.8 rotation.y and rotation.z are in [0, 90]', () => {
    const r = fitSquareBar({ x: 50, y: 30, z: 30 }, 240, 92)
    expect(r.rotation.y).toBeGreaterThanOrEqual(0)
    expect(r.rotation.y).toBeLessThanOrEqual(90)
    expect(r.rotation.y % 5).toBe(0)
    expect(r.rotation.z).toBeGreaterThanOrEqual(0)
    expect(r.rotation.z).toBeLessThanOrEqual(90)
    expect(r.rotation.z % 5).toBe(0)
  })
})

// ── Section E: fitFlat contract ────────────────────────────────────────

describe('[E] fitFlat contract', () => {
  it('E.1 returns positive fitScale for typical input', () => {
    const r = fitFlat({ x: 80, y: 60, z: 12 }, { x: 100, y: 100, z: 20 })
    expect(r.fitScale).toBeGreaterThan(0)
  })

  it('E.2 position.x is exactly 0 (model centered in stock X)', () => {
    const r = fitFlat({ x: 50, y: 50, z: 10 }, { x: 100, y: 100, z: 30 })
    expect(r.position.x).toBe(0)
  })

  it('E.3 position.y is exactly 0 (model centered in stock Z, Three.js Z = model Y)', () => {
    const r = fitFlat({ x: 50, y: 50, z: 10 }, { x: 100, y: 100, z: 30 })
    expect(r.position.y).toBe(0)
  })

  it('E.4 position.z = stock.z / 2 (Three.js Y bottom-at-origin convention)', () => {
    const r = fitFlat({ x: 50, y: 50, z: 10 }, { x: 100, y: 100, z: 30 })
    expect(r.position.z).toBeCloseTo(15)
  })

  it('E.5 rotation values are integer multiples of FLAT_STEP=15', () => {
    const r = fitFlat({ x: 80, y: 60, z: 12 }, { x: 100, y: 100, z: 20 })
    expect(r.rotation.x % 15).toBe(0)
    expect(r.rotation.y % 15).toBe(0)
    expect(r.rotation.z % 15).toBe(0)
  })

  it('E.6 rotations are in [0, 90] degrees', () => {
    const r = fitFlat({ x: 80, y: 60, z: 12 }, { x: 100, y: 100, z: 20 })
    for (const a of [r.rotation.x, r.rotation.y, r.rotation.z]) {
      expect(a).toBeGreaterThanOrEqual(0)
      expect(a).toBeLessThanOrEqual(90)
    }
  })

  it('E.7 fitScale floor at 0.001 on degenerate input', () => {
    const r = fitFlat({ x: 0, y: 0, z: 0 }, { x: 100, y: 100, z: 20 })
    expect(r.fitScale).toBe(0.001)
  })

  it('E.8 model exactly the size of stock yields fitScale ~ 1.0', () => {
    const r = fitFlat({ x: 100, y: 100, z: 20 }, { x: 100, y: 100, z: 20 })
    expect(r.fitScale).toBeCloseTo(1.0, 1)
  })

  it('E.9 model larger than stock yields fitScale < 1.0', () => {
    const r = fitFlat({ x: 200, y: 100, z: 20 }, { x: 100, y: 100, z: 20 })
    expect(r.fitScale).toBeLessThan(1.0)
  })

  it('E.10 model smaller than stock yields fitScale > 1.0', () => {
    const r = fitFlat({ x: 10, y: 10, z: 5 }, { x: 100, y: 100, z: 20 })
    expect(r.fitScale).toBeGreaterThan(1.0)
  })
})

// ── Section F: cross-helper purity & determinism ───────────────────────

describe('[F] cross-helper purity & determinism', () => {
  it('F.1 fitFlat is deterministic across N=10 calls (same fitScale)', () => {
    const samples: number[] = []
    for (let i = 0; i < 10; i += 1) {
      samples.push(fitFlat({ x: 80, y: 60, z: 12 }, { x: 100, y: 100, z: 20 }).fitScale)
    }
    for (const s of samples) {
      expect(s).toBe(samples[0])
    }
  })

  it('F.2 fitCylindrical is deterministic across N=10 calls', () => {
    const samples: number[] = []
    for (let i = 0; i < 10; i += 1) {
      samples.push(fitCylindrical({ x: 50, y: 30, z: 30 }, 240, 92).fitScale)
    }
    for (const s of samples) {
      expect(s).toBe(samples[0])
    }
  })

  it('F.3 fitSquareBar is deterministic across N=10 calls', () => {
    const samples: number[] = []
    for (let i = 0; i < 10; i += 1) {
      samples.push(fitSquareBar({ x: 50, y: 30, z: 30 }, 240, 92).fitScale)
    }
    for (const s of samples) {
      expect(s).toBe(samples[0])
    }
  })

  it('F.4 fitFlat does not mutate input model size or stock size', () => {
    const model = { x: 80, y: 60, z: 12 }
    const stock = { x: 100, y: 100, z: 20 }
    const modelSnap = JSON.stringify(model)
    const stockSnap = JSON.stringify(stock)
    fitFlat(model, stock)
    expect(JSON.stringify(model)).toBe(modelSnap)
    expect(JSON.stringify(stock)).toBe(stockSnap)
  })

  it('F.5 fitCylindrical does not mutate input model size', () => {
    const model = { x: 50, y: 30, z: 30 }
    const snap = JSON.stringify(model)
    fitCylindrical(model, 240, 92, 12, 8)
    expect(JSON.stringify(model)).toBe(snap)
  })

  it('F.6 fitSquareBar does not mutate input model size', () => {
    const model = { x: 50, y: 30, z: 30 }
    const snap = JSON.stringify(model)
    fitSquareBar(model, 240, 92, 12, 8)
    expect(JSON.stringify(model)).toBe(snap)
  })

  it('F.7 fitFlat is safe on Object.frozen inputs', () => {
    const model = Object.freeze({ x: 80, y: 60, z: 12 })
    const stock = Object.freeze({ x: 100, y: 100, z: 20 })
    expect(() => fitFlat(model, stock)).not.toThrow()
  })

  it('F.8 fitCylindrical is safe on Object.frozen input', () => {
    const model = Object.freeze({ x: 50, y: 30, z: 30 })
    expect(() => fitCylindrical(model, 240, 92)).not.toThrow()
  })

  it('F.9 fitSquareBar is safe on Object.frozen input', () => {
    const model = Object.freeze({ x: 50, y: 30, z: 30 })
    expect(() => fitSquareBar(model, 240, 92)).not.toThrow()
  })

  it('F.10 each call returns a fresh result object (no aliasing across calls)', () => {
    const a = fitFlat({ x: 80, y: 60, z: 12 }, { x: 100, y: 100, z: 20 })
    const b = fitFlat({ x: 80, y: 60, z: 12 }, { x: 100, y: 100, z: 20 })
    expect(a).not.toBe(b)
    expect(a.position).not.toBe(b.position)
    expect(a.rotation).not.toBe(b.rotation)
    expect(a.scale).not.toBe(b.scale)
  })
})

// ── Section G: three-machine cross-cuts ────────────────────────────────

describe('[G] three-machine cross-cuts', () => {
  // CLAUDE.md USER CONTEXT specs:
  //   K2 Plus: 350 x 350 x 350 mm build volume (FDM flat)
  //   Laguna Swift 5x10: 1524 x 3048 mm sheet, ~190 mm Z clearance
  //   Carvera + 4th Axis: ~92 mm dia x 240 mm length rotary

  it('G.1 K2 Plus build envelope: 100x100x50 model fits with scale > 1', () => {
    const r = fitFlat({ x: 100, y: 100, z: 50 }, { x: 350, y: 350, z: 350 })
    expect(r.fitScale).toBeGreaterThan(1.0)
    expect(r.position.z).toBeCloseTo(175) // bed-Y center, half of stock.z=350
  })

  it('G.2 K2 Plus build envelope: model exactly 350x350x350 yields ~1.0', () => {
    const r = fitFlat({ x: 350, y: 350, z: 350 }, { x: 350, y: 350, z: 350 })
    expect(r.fitScale).toBeCloseTo(1.0, 1)
  })

  it('G.3 Laguna full-sheet: small 200x300x10 part on 1524x3048 sheet has positive fitScale', () => {
    const r = fitFlat({ x: 200, y: 300, z: 10 }, { x: 1524, y: 3048, z: 19 })
    expect(r.fitScale).toBeGreaterThan(1.0)
    expect(r.position.z).toBeCloseTo(19 / 2) // spoilboard-relative center
  })

  it('G.4 Laguna full-sheet: position.x and position.y are 0 (centered)', () => {
    const r = fitFlat({ x: 200, y: 300, z: 10 }, { x: 1524, y: 3048, z: 19 })
    expect(r.position.x).toBe(0)
    expect(r.position.y).toBe(0)
  })

  it('G.5 Carvera rotary cyl: 92mm dia x 240mm L stock with 12mm chuck, model fits', () => {
    const r = fitCylindrical({ x: 100, y: 50, z: 50 }, 240, 92, 12, 0)
    expect(r.fitScale).toBeGreaterThan(0)
    expect(r.position.x).toBeCloseTo(6) // (12 + 0) / 2
  })

  it('G.6 Carvera rotary square-bar: 92mm side x 240mm L with chuck+clamp, model fits', () => {
    const r = fitSquareBar({ x: 100, y: 50, z: 50 }, 240, 92, 12, 5)
    expect(r.fitScale).toBeGreaterThan(0)
    expect(r.position.x).toBeCloseTo(8.5) // (12 + 5) / 2
  })

  it('G.7 Carvera rotary cyl: chuck+clamp = stock length still produces non-negative fitScale (usableLen floor at 1)', () => {
    // Edge: chuck + clamp == stockLen -> usableLen would be 0, but the
    // engine clamps `usableLen = Math.max(1, ...)`. Result must still be
    // a finite positive fitScale.
    const r = fitCylindrical({ x: 50, y: 20, z: 20 }, 30, 40, 20, 10)
    expect(r.fitScale).toBeGreaterThan(0)
    expect(Number.isFinite(r.fitScale)).toBe(true)
  })
})

// ── Section H: source-text whitelist ───────────────────────────────────

describe('[H] source-text whitelist', () => {
  it('H.1 ROT_STEP constant is declared as 5', () => {
    expect(SRC).toMatch(/^const ROT_STEP = 5$/m)
  })

  it('H.2 FLAT_STEP constant is declared as 15', () => {
    expect(SRC).toMatch(/^const FLAT_STEP = 15$/m)
  })

  it('H.3 DEG_TO_RAD literal is Math.PI / 180', () => {
    expect(SRC).toMatch(/const DEG_TO_RAD = Math\.PI \/ 180/)
  })

  it('H.4 epsilon literal 1e-9 is used for degenerate-extent guard', () => {
    expect(SRC.includes('1e-9')).toBe(true)
  })

  it('H.5 0.001 fitScale floor is wired via Math.max(0.001, bestScale)', () => {
    // Three call sites: one per public function.
    const matches = SRC.match(/Math\.max\(0\.001, bestScale\)/g)
    expect(matches).not.toBeNull()
    expect(matches!.length).toBe(3)
  })

  it('H.6 exactly 3 export function declarations', () => {
    const matches = SRC.match(/^export function /gm)
    expect(matches).not.toBeNull()
    expect(matches!.length).toBe(3)
  })

  it('H.7 exactly 1 export interface (StockFitResult)', () => {
    const matches = SRC.match(/^export interface /gm)
    expect(matches).not.toBeNull()
    expect(matches!.length).toBe(1)
    expect(SRC).toContain('export interface StockFitResult')
  })

  it('H.8 fitCylindrical sweeps ry in [0, 90] step ROT_STEP', () => {
    expect(SRC).toMatch(/for \(let ry = 0; ry <= 90; ry \+= ROT_STEP\)/)
  })

  it('H.9 fitSquareBar sweeps rx in [0, 45] step ROT_STEP', () => {
    expect(SRC).toMatch(/for \(let rx = 0; rx <= 45; rx \+= ROT_STEP\)/)
  })

  it('H.10 fitFlat sweeps rx in [0, 90] step FLAT_STEP', () => {
    expect(SRC).toMatch(/for \(let rx = 0; rx <= 90; rx \+= FLAT_STEP\)/)
  })

  it('H.11 chuck/clamp default values are spelled `= 0`', () => {
    // Two functions each take `chuckDepthMm = 0, clampOffsetMm = 0`.
    expect(SRC).toMatch(/chuckDepthMm = 0/)
    expect(SRC).toMatch(/clampOffsetMm = 0/)
  })

  it('H.12 8-corner sign-product loops use the [-1, 1] tuple convention', () => {
    // Three nested `for (const signX of [-1, 1] as const)` loops are the
    // canonical 8-corner enumeration.
    const matches = SRC.match(/for \(const sign[XYZ] of \[-1, 1\] as const\)/g)
    expect(matches).not.toBeNull()
    expect(matches!.length).toBe(3)
  })

  it('H.13 xCenter formula uses unusable / 2 (NOT just chuckDepthMm / 2)', () => {
    const matches = SRC.match(/const xCenter = unusable \/ 2/g)
    expect(matches).not.toBeNull()
    expect(matches!.length).toBe(2) // cyl + square
  })

  it('H.14 usableLen has a Math.max(1, ...) floor', () => {
    const matches = SRC.match(/const usableLen = Math\.max\(1, stockLenMm - unusable\)/g)
    expect(matches).not.toBeNull()
    expect(matches!.length).toBe(2) // cyl + square
  })

  it('H.15 fitFlat positions z at stock.z / 2', () => {
    expect(SRC).toMatch(/position: \{ x: 0, y: 0, z: stock\.z \/ 2 \}/)
  })

  it('H.16 fitCylindrical and fitSquareBar position at xCenter, y=0, z=0', () => {
    const matches = SRC.match(/position: \{ x: xCenter, y: 0, z: 0 \}/g)
    expect(matches).not.toBeNull()
    expect(matches!.length).toBe(2)
  })

  it('H.17 module imports nothing (pure helper)', () => {
    // No import statement at any indentation level. The module is purely
    // self-contained; if a future refactor adds React, DOM, electron, fs,
    // path, or three.js coupling here, this trip-wire fires.
    expect(SRC).not.toMatch(/^import /m)
  })

  it('H.18 no DOM globals referenced', () => {
    expect(SRC).not.toMatch(/\bwindow\b/)
    expect(SRC).not.toMatch(/\bdocument\b/)
    expect(SRC).not.toMatch(/\blocalStorage\b/)
  })

  it('H.19 zero TypeScript `any` (any of the 3 forms)', () => {
    expect(SRC).not.toMatch(/: any\b/)
    expect(SRC).not.toMatch(/ as any\b/)
    expect(SRC).not.toMatch(/<any>/)
  })

  it('H.20 zero top-level `let` (only `const` for module-scoped state)', () => {
    // `let` may appear inside function bodies (sweep loops) but never at
    // the module top level.
    expect(SRC).not.toMatch(/^let /m)
  })

  it('H.21 Three.js coordinate convention is documented in header', () => {
    // Pin the Y/Z swap convention (Three.js Y = model Z; Three.js Z = model Y)
    // referenced by ShopModelViewer applyTransform. Drift here would
    // silently break the viewport.
    expect(SRC).toContain('Three.js X = model X')
    expect(SRC).toContain('Three.js Y = model Z')
    expect(SRC).toContain('Three.js Z = model Y')
  })

  it('H.22 4-axis convention noted (rotation axis = Three.js X)', () => {
    expect(SRC).toContain('rotation axis runs along Three.js X')
  })

  it('H.23 ZYX intrinsic Euler order is documented', () => {
    // Z then Y then X intrinsic rotation. Critical for matching
    // computeModelCornerWorldPointsInThreeJS in the renderer viewport.
    expect(SRC).toMatch(/Z\s*[→>-]+\s*Y\s*[→>-]+\s*X intrinsic/)
  })

  it('H.24 supports flat / cylindrical / square-bar modes per JSDoc', () => {
    // Triggers a smoke trip-wire on rename/removal of any of the three
    // documented modes -- they map 1:1 to the three target machines.
    expect(SRC).toContain('Flat rectangular stock')
    expect(SRC).toContain('Cylindrical rotary stock')
    expect(SRC).toContain('Square-bar rotary stock')
  })

  it('H.25 cylindrical radial constraint is documented as max corner distance from X axis', () => {
    expect(SRC).toMatch(/Radial constraint: max corner distance from X axis/)
  })

  it('H.26 square-bar radial constraint is documented as independent Y/Z (NOT inscribed circle)', () => {
    expect(SRC).toMatch(/independently[\s\S]*stay within/)
    expect(SRC).toContain('not inscribed circle')
  })

  it('H.27 stock-to-ThreeJS axis mapping is documented for fitFlat', () => {
    // stock.x -> Three X, stock.y -> Three Z, stock.z -> Three Y.
    // Any drift here breaks ShopModelViewer pose. (Use → for the
    // rightwards arrow so the regex matches the actual unicode glyph.)
    expect(SRC).toMatch(/stock\.x → Three X extent/)
    expect(SRC).toMatch(/stock\.y → Three Z extent/)
    expect(SRC).toMatch(/stock\.z → Three Y extent/)
  })

  it('H.28 ROT_STEP=5 yields 19x19=361 cylinder orientations as documented', () => {
    expect(SRC).toMatch(/19[×x\*]19 = 361 orientations/)
  })

  it('H.29 FLAT_STEP=15 yields 7x7x7=343 flat orientations as documented', () => {
    expect(SRC).toMatch(/7[×x\*]7[×x\*]7 = 343 orientations/)
  })

  it('H.30 rotatedBoxExtrema returns the 4 documented extents', () => {
    // maxAbsX, maxAbsY, maxAbsZ, maxRadSq are the 4-tuple returned.
    expect(SRC).toMatch(/maxAbsX: number; maxAbsY: number; maxAbsZ: number; maxRadSq: number/)
  })
})
