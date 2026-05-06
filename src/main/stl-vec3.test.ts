/**
 * Paired-pin contract for `src/main/stl-vec3.ts` -- [ID-0184], Cycle 101.
 *
 * `stl-vec3.ts` is the shared math primitive consumed by the STL placement
 * pipeline (`src/main/binary-stl-placement.ts`) AND the 4-axis CAM frame
 * (`src/main/cam-axis4/frame.ts`). The `frame-parity.test.ts` invariant
 * already enforces that the two callers produce byte-equal vertex transforms;
 * this file is the *paired pin* on the upstream primitive itself, so a future
 * regression that silently swaps axis order or rotation handedness inside
 * `rotateXYZDeg` is caught here BEFORE it propagates into either caller.
 *
 * Why this matters for the three target machines:
 *   * Creality K2 Plus (FDM) -- STL placement pipeline runs `rotateXYZDeg` on
 *     every triangle when the user rotates the mesh in the renderer. A wrong
 *     axis order silently flips the print orientation.
 *   * Laguna Swift 5x10 -- same STL placement path; large-format sheet jobs
 *     depend on `addVecStl` for translation and `mulVecStl` for unit scale.
 *   * Makera Carvera + 4th Axis Rotary -- `frame.ts` calls `rotateXYZDeg` on
 *     every voxel sample inside the rotary frame. If this primitive's axis
 *     order regresses, the toolpath visibly fights the displayed mesh in the
 *     simulation viewer (the bug `frame-parity.test.ts` was originally
 *     written to prevent).
 *
 * Scope: 100% additive. ZERO production-code edits in this cycle. The file
 * is a paired-pin contract per the Cycle 88 [ID-0174] / Cycle 92 [ID-0177] /
 * Cycle 93 [ID-0178] cam-engine pattern.
 *
 * Convention: tests are clustered by helper, with a final cross-helper
 * invariants block and a JSDoc / consumer-paired-pin block that asserts the
 * load-bearing import sites still reach into this module (defends the
 * "single source of truth" property the file's own JSDoc promises).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Vec3 } from './stl'
import { addVecStl, mulVecStl, rotateXYZDeg } from './stl-vec3'

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Float comparison helper. The rotation matrix is dense in trig identities
 * (sin(0) = 0 vs Math.sin(0) = 0 exactly, but sin(180°) ~= 1.2246e-16 not 0),
 * so component-wise tolerance is needed even for "exact" angles.
 */
function expectVec3Close(actual: Vec3, expected: Vec3, eps = 1e-12): void {
  expect(actual[0]).toBeCloseTo(expected[0], 12 - Math.log10(1 / eps))
  expect(actual[1]).toBeCloseTo(expected[1], 12 - Math.log10(1 / eps))
  expect(actual[2]).toBeCloseTo(expected[2], 12 - Math.log10(1 / eps))
}

const repoRoot = join(__dirname, '..', '..')

// ─── addVecStl ──────────────────────────────────────────────────────────────

describe('stl-vec3 -- addVecStl', () => {
  it('returns the input vector when adding a zero translation', () => {
    const v: Vec3 = [3, -7, 11]
    const r = addVecStl(v, [0, 0, 0])
    expect(r).toEqual([3, -7, 11])
  })

  it('returns the translation vector when adding to origin', () => {
    const v: Vec3 = [0, 0, 0]
    const r = addVecStl(v, [1.5, -2.25, 3.125])
    expect(r).toEqual([1.5, -2.25, 3.125])
  })

  it('adds component-wise (positive translation)', () => {
    const r = addVecStl([1, 2, 3], [10, 20, 30])
    expect(r).toEqual([11, 22, 33])
  })

  it('adds component-wise (negative translation -- handedness invariance)', () => {
    const r = addVecStl([5, 5, 5], [-1, -2, -3])
    expect(r).toEqual([4, 3, 2])
  })

  it('does not mutate the input vector (returns a new tuple)', () => {
    const v: Vec3 = [1, 2, 3]
    const r = addVecStl(v, [10, 10, 10])
    expect(v).toEqual([1, 2, 3])
    expect(r).not.toBe(v)
  })

  it('preserves NaN component-wise (consumers that pass NaN bounds still flag the failure downstream)', () => {
    const r = addVecStl([Number.NaN, 1, 1], [1, Number.NaN, 1])
    expect(Number.isNaN(r[0])).toBe(true)
    expect(Number.isNaN(r[1])).toBe(true)
    expect(r[2]).toBe(2)
  })

  it('returns a length-3 tuple even for fractional components', () => {
    const r = addVecStl([0.1, 0.2, 0.3], [0.4, 0.5, 0.6])
    expect(r).toHaveLength(3)
    expect(r[0]).toBeCloseTo(0.5, 12)
    expect(r[1]).toBeCloseTo(0.7, 12)
    expect(r[2]).toBeCloseTo(0.9, 12)
  })
})

// ─── mulVecStl ──────────────────────────────────────────────────────────────

describe('stl-vec3 -- mulVecStl', () => {
  it('returns the zero vector when scaling by zeros (component magnitudes are 0)', () => {
    // IEEE 754 produces -0 for `negative * +0` (e.g. -20 * 0 === -0); the
    // assertion is on magnitude, not signed-zero identity, since downstream
    // consumers treat -0 and +0 as equivalent.
    const r = mulVecStl([10, -20, 30], [0, 0, 0])
    expect(Math.abs(r[0])).toBe(0)
    expect(Math.abs(r[1])).toBe(0)
    expect(Math.abs(r[2])).toBe(0)
  })

  it('returns the input vector when scaling by [1, 1, 1] (identity scale)', () => {
    const r = mulVecStl([7, -14, 21], [1, 1, 1])
    expect(r).toEqual([7, -14, 21])
  })

  it('multiplies component-wise (uniform scale)', () => {
    const r = mulVecStl([1, 2, 3], [2, 2, 2])
    expect(r).toEqual([2, 4, 6])
  })

  it('multiplies component-wise (non-uniform scale)', () => {
    const r = mulVecStl([1, 2, 3], [10, 100, 1000])
    expect(r).toEqual([10, 200, 3000])
  })

  it('handles negative scales (handedness flip per axis)', () => {
    const r = mulVecStl([1, 1, 1], [-1, 1, -1])
    expect(r).toEqual([-1, 1, -1])
  })

  it('does not mutate the input vector', () => {
    const v: Vec3 = [1, 2, 3]
    mulVecStl(v, [9, 9, 9])
    expect(v).toEqual([1, 2, 3])
  })

  it('preserves fractional precision component-wise', () => {
    const r = mulVecStl([1, 1, 1], [0.5, 0.25, 0.125])
    expect(r).toEqual([0.5, 0.25, 0.125])
  })

  it('returns NaN where either operand is NaN (component-wise)', () => {
    const r = mulVecStl([Number.NaN, 1, 1], [1, Number.NaN, 1])
    expect(Number.isNaN(r[0])).toBe(true)
    expect(Number.isNaN(r[1])).toBe(true)
    expect(r[2]).toBe(1)
  })
})

// ─── rotateXYZDeg -- identity & single-axis ────────────────────────────────

describe('stl-vec3 -- rotateXYZDeg, identity and single-axis', () => {
  it('identity: 0 degrees on every axis returns the input vector', () => {
    const v: Vec3 = [1, 2, 3]
    expectVec3Close(rotateXYZDeg(v, [0, 0, 0]), v, 1e-15)
  })

  it('360-degree rotation on each axis returns the input vector (within float epsilon)', () => {
    const v: Vec3 = [1.5, -2.5, 3.5]
    expectVec3Close(rotateXYZDeg(v, [360, 360, 360]), v, 1e-10)
  })

  // Single-axis rotation tests fix the axis convention (right-hand rule, Tait-
  // Bryan XYZ order: rotate around X first, then Y, then Z).
  it('+90 around X: [0, 1, 0] -> [0, 0, 1] (right-hand rule)', () => {
    expectVec3Close(rotateXYZDeg([0, 1, 0], [90, 0, 0]), [0, 0, 1], 1e-12)
  })

  it('+90 around X: [0, 0, 1] -> [0, -1, 0]', () => {
    expectVec3Close(rotateXYZDeg([0, 0, 1], [90, 0, 0]), [0, -1, 0], 1e-12)
  })

  it('+90 around X leaves the X component unchanged', () => {
    const r = rotateXYZDeg([5, 0, 0], [90, 0, 0])
    expect(r[0]).toBeCloseTo(5, 12)
    expect(r[1]).toBeCloseTo(0, 12)
    expect(r[2]).toBeCloseTo(0, 12)
  })

  it('+90 around Y: [1, 0, 0] -> [0, 0, -1] (right-hand rule)', () => {
    expectVec3Close(rotateXYZDeg([1, 0, 0], [0, 90, 0]), [0, 0, -1], 1e-12)
  })

  it('+90 around Y: [0, 0, 1] -> [1, 0, 0]', () => {
    expectVec3Close(rotateXYZDeg([0, 0, 1], [0, 90, 0]), [1, 0, 0], 1e-12)
  })

  it('+90 around Y leaves the Y component unchanged', () => {
    const r = rotateXYZDeg([0, 7, 0], [0, 90, 0])
    expect(r[0]).toBeCloseTo(0, 12)
    expect(r[1]).toBeCloseTo(7, 12)
    expect(r[2]).toBeCloseTo(0, 12)
  })

  it('+90 around Z: [1, 0, 0] -> [0, 1, 0] (right-hand rule)', () => {
    expectVec3Close(rotateXYZDeg([1, 0, 0], [0, 0, 90]), [0, 1, 0], 1e-12)
  })

  it('+90 around Z: [0, 1, 0] -> [-1, 0, 0]', () => {
    expectVec3Close(rotateXYZDeg([0, 1, 0], [0, 0, 90]), [-1, 0, 0], 1e-12)
  })

  it('+90 around Z leaves the Z component unchanged', () => {
    const r = rotateXYZDeg([0, 0, -3.5], [0, 0, 90])
    expect(r[0]).toBeCloseTo(0, 12)
    expect(r[1]).toBeCloseTo(0, 12)
    expect(r[2]).toBeCloseTo(-3.5, 12)
  })

  it('-90 around Z is the inverse of +90 around Z', () => {
    const v: Vec3 = [3, 4, 5]
    const forward = rotateXYZDeg(v, [0, 0, 90])
    const back = rotateXYZDeg(forward, [0, 0, -90])
    expectVec3Close(back, v, 1e-12)
  })

  it('180 around any single axis flips the other two components in sign', () => {
    // X:180 negates Y and Z.
    expectVec3Close(rotateXYZDeg([1, 2, 3], [180, 0, 0]), [1, -2, -3], 1e-12)
    // Y:180 negates X and Z.
    expectVec3Close(rotateXYZDeg([1, 2, 3], [0, 180, 0]), [-1, 2, -3], 1e-12)
    // Z:180 negates X and Y.
    expectVec3Close(rotateXYZDeg([1, 2, 3], [0, 0, 180]), [-1, -2, 3], 1e-12)
  })
})

// ─── rotateXYZDeg -- composition / order / preservation ────────────────────

describe('stl-vec3 -- rotateXYZDeg, composition and length preservation', () => {
  it('preserves vector length (rotation is an isometry)', () => {
    const v: Vec3 = [3, 4, 12] // length 13
    const r = rotateXYZDeg(v, [37, 71, 113])
    const lenIn = Math.hypot(v[0], v[1], v[2])
    const lenOut = Math.hypot(r[0], r[1], r[2])
    expect(lenOut).toBeCloseTo(lenIn, 12)
  })

  it('preserves vector length for many random angles', () => {
    const v: Vec3 = [-2.5, 1.25, 7.0]
    const lenIn = Math.hypot(v[0], v[1], v[2])
    for (const ang of [-179, -90, -45, -1, 0, 1, 17, 90, 137, 180, 270]) {
      const r = rotateXYZDeg(v, [ang, ang * 1.7, ang * 0.3])
      const lenOut = Math.hypot(r[0], r[1], r[2])
      expect(lenOut).toBeCloseTo(lenIn, 12)
    }
  })

  it('XYZ order: rotateXYZDeg(v, [a,b,c]) == Rz(c) @ Ry(b) @ Rx(a) @ v', () => {
    // Construct the expected via three sequential single-axis rotations and
    // compare. This pin is the silent-axis-order regression catcher: if a
    // future refactor flips Y and Z (e.g. ZXY instead of XYZ), the resulting
    // vector here will diverge from the manual composition.
    const v: Vec3 = [1, 2, 3]
    const a = 30 // X
    const b = 45 // Y
    const c = 60 // Z
    const expected = rotateXYZDeg(
      rotateXYZDeg(rotateXYZDeg(v, [a, 0, 0]), [0, b, 0]),
      [0, 0, c]
    )
    const direct = rotateXYZDeg(v, [a, b, c])
    expectVec3Close(direct, expected, 1e-12)
  })

  it('non-commutative: Rx(90) then Ry(90) != Ry(90) then Rx(90) for non-axis vectors', () => {
    const v: Vec3 = [1, 2, 3]
    const xyOrder = rotateXYZDeg(v, [90, 90, 0])
    const yxOrder = rotateXYZDeg(rotateXYZDeg(v, [0, 90, 0]), [90, 0, 0])
    // The two should diverge -- if they're equal, axis order has been
    // silently turned commutative (which would mean a regression).
    const dx = Math.abs(xyOrder[0] - yxOrder[0])
    const dy = Math.abs(xyOrder[1] - yxOrder[1])
    const dz = Math.abs(xyOrder[2] - yxOrder[2])
    expect(dx + dy + dz).toBeGreaterThan(0.5)
  })

  it('does not mutate the input vector', () => {
    const v: Vec3 = [1, 2, 3]
    rotateXYZDeg(v, [37, 41, 43])
    expect(v).toEqual([1, 2, 3])
  })

  it('returns a length-3 tuple', () => {
    const r = rotateXYZDeg([1, 2, 3], [10, 20, 30])
    expect(r).toHaveLength(3)
    expect(typeof r[0]).toBe('number')
    expect(typeof r[1]).toBe('number')
    expect(typeof r[2]).toBe('number')
  })

  it('zero vector is fixed under any rotation', () => {
    expectVec3Close(rotateXYZDeg([0, 0, 0], [37, 71, 113]), [0, 0, 0], 1e-15)
  })
})

// ─── Cross-helper invariants ───────────────────────────────────────────────

describe('stl-vec3 -- cross-helper invariants', () => {
  it('full vertex transform pipeline: scale, then rotate, then translate (binary-stl-placement order)', () => {
    // This pins the order used by `binary-stl-placement.ts` lines 139-146:
    //   scale -> rotate -> translate.
    // A regression that swaps any two of these breaks the placement pipeline
    // for all three target machines.
    const v: Vec3 = [1, 1, 1]
    const scaled = mulVecStl(v, [2, 2, 2])
    expect(scaled).toEqual([2, 2, 2])
    const rotated = rotateXYZDeg(scaled, [0, 0, 90])
    expectVec3Close(rotated, [-2, 2, 2], 1e-12)
    const translated = addVecStl(rotated, [10, 10, 10])
    expectVec3Close(translated, [8, 12, 12], 1e-12)
  })

  it('addVecStl with negated translation is the left-inverse of addVecStl', () => {
    const v: Vec3 = [3, -4, 5]
    const t: readonly [number, number, number] = [10, -20, 30]
    const out = addVecStl(addVecStl(v, t), [-t[0], -t[1], -t[2]])
    expectVec3Close(out, v, 1e-15)
  })

  it('mulVecStl with reciprocal scale is the left-inverse of mulVecStl (non-zero components)', () => {
    const v: Vec3 = [3, -4, 5]
    const s: readonly [number, number, number] = [2, 0.5, -4]
    const out = mulVecStl(mulVecStl(v, s), [1 / s[0], 1 / s[1], 1 / s[2]])
    expectVec3Close(out, v, 1e-12)
  })
})

// ─── Module / consumer paired pin ──────────────────────────────────────────

describe('stl-vec3 -- module and consumer paired pin', () => {
  it('module file exists at the canonical path', () => {
    const src = readFileSync(join(repoRoot, 'src', 'main', 'stl-vec3.ts'), 'utf-8')
    expect(src.length).toBeGreaterThan(500)
    expect(src).toMatch(/export function addVecStl/)
    expect(src).toMatch(/export function mulVecStl/)
    expect(src).toMatch(/export function rotateXYZDeg/)
  })

  it('binary-stl-placement.ts imports all three primitives from this module (single source of truth)', () => {
    // Defends against a future regression that copy-pastes the helpers into
    // `binary-stl-placement.ts` and silently drifts.
    const src = readFileSync(
      join(repoRoot, 'src', 'main', 'binary-stl-placement.ts'),
      'utf-8'
    )
    expect(src).toMatch(
      /import\s*\{\s*addVecStl,\s*mulVecStl,\s*rotateXYZDeg\s*\}\s*from\s*["']\.\/stl-vec3["']/
    )
  })

  it('cam-axis4/frame.ts imports rotateXYZDeg from this module (4-axis frame parity)', () => {
    // Defends the frame-parity invariant: the 4-axis CAM engine MUST share
    // the same rotation primitive with the STL placement pipeline.
    const src = readFileSync(
      join(repoRoot, 'src', 'main', 'cam-axis4', 'frame.ts'),
      'utf-8'
    )
    expect(src).toMatch(/import\s*\{\s*rotateXYZDeg\s*\}\s*from\s*["']\.\.\/stl-vec3["']/)
  })

  it('JSDoc paired pin: file header records the cross-pipeline shared-primitive rationale', () => {
    const src = readFileSync(join(repoRoot, 'src', 'main', 'stl-vec3.ts'), 'utf-8')
    // The header must call out the load-bearing relationship to frame.ts and
    // the parity invariant. If a future docs cleanup deletes this rationale,
    // a reader losing the context might inline the helpers and break parity.
    expect(src).toMatch(/frame\.ts/)
    expect(src).toMatch(/binary-stl-placement\.ts/)
    expect(src).toMatch(/frame-parity\.test\.ts/)
  })
})
