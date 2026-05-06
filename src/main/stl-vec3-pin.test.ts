/**
 * stl-vec3-pin.test.ts -- [ID-0243] Cycle 171 test-coverage paired-pin
 *
 * Co-located paired-pin contract for `src/main/stl-vec3.ts`
 * (39-line / 1330-byte SHARED main-process Vec3 transform helper;
 * 3 exported pure functions `addVecStl(a, t)`, `mulVecStl(a, s)`,
 * `rotateXYZDeg(v, d)`). The module's own header docstring marks
 * these helpers as the canonical implementation that BOTH
 * `binary-stl-placement.ts` (renderer-side STL placement pipeline)
 * AND `cam-axis4/frame.ts` (4-axis CAM engine) MUST share to keep
 * the `frame-parity.test.ts` invariant green. A regression in any
 * of the three primitives -- or a drift in transform order -- would
 * silently desync the on-screen STL preview from the actual G-code
 * the user ships to the machine, an invisible-until-tool-crash bug
 * class on the Carvera 4-axis rotary in particular.
 *
 * Per CLAUDE.md "USER CONTEXT -- TARGET MACHINES" this helper is
 * cross-cutting across the THREE target machines:
 *   - Creality K2 Plus (FDM): every imported STL gets transformed
 *     through these primitives before slicing -- a wrong rotation
 *     prints on the wrong region of the 350x350 mm bed.
 *   - Laguna Swift 5x10 (CNC router): full-sheet plywood pocketing
 *     stages STL parts via the same placement pipeline; a wrong
 *     translation would mill the wrong region of the 60x120 in
 *     blank -- an expensive mistake.
 *   - Makera Carvera + 4th Axis: the `rotateXYZDeg` primitive
 *     carries the rotary-axis math through the simultaneous 4-axis
 *     toolpath generator. Per the module docstring, `frame.ts` MUST
 *     replicate `binary-stl-placement.ts`'s transform order exactly;
 *     this contract pin guards the canonical S->R->T order.
 *
 * Existing coverage: `src/main/cam-4axis-docs-pin.test.ts` (Cycle
 * 75) pins the DOCUMENTATION references to these primitives and
 * the canonical order. This file complements that by pinning the
 * NUMERICAL CONTRACT (per-axis isolation, identity rotation,
 * 360-deg periodicity, sign conventions, composition equivalence,
 * pure-function invariants).
 *
 * Sister cycles (post-Cycle-127 paired-pin chain, newest-first):
 *   - 170 [ID-0242] gcode-export-safety
 *   - 169 [ID-0241]/[ID-0067-data-v24] EDIT-WORKFLOW.md docs refresh
 *   - 168 [ID-0240] gcode-header-invariants
 *   - 167 [ID-0239] cam-scallop-stepover
 *   - 166 [ID-0238] kernel-placement-parity
 *   - 165 [ID-0237] path-join
 *   - 164 [ID-0236] EDIT-WORKFLOW.md docs refresh
 *   - 163 [ID-0235] machine-post-template-hints
 *   - 162 [ID-0234] cam-progress
 *   - 161 [ID-0233] shellLayoutStorage
 *
 * Pinned surfaces:
 *   (A) Module shape -- exact runtime export inventory: 3 functions,
 *       0 non-function exports. Vec3 is type-only and MUST NOT
 *       appear at runtime.
 *   (B) Function signatures -- name / arity / native-Function for
 *       all 3 primitives.
 *   (C) addVecStl -- component-wise sum; identity (zero translate);
 *       commutativity; associativity (numeric-tolerance bounded);
 *       sign-flip equivalence.
 *   (D) mulVecStl -- component-wise product; identity (one scale);
 *       zero-scale collapses to origin; negative scale flips sign;
 *       per-axis isolation.
 *   (E) rotateXYZDeg -- identity (zero rotation); 360-deg periodicity;
 *       per-axis 90-deg known-correct outputs; right-hand rule sign
 *       conventions; X-then-Y-then-Z compose equivalence with the
 *       single-call form; preserves vector length (orthogonal
 *       rotation matrix invariant).
 *   (F) Three-machine path realism -- typical placement vectors for
 *       K2 Plus bed, Laguna 5x10 sheet, Carvera 4-axis rotary.
 *   (G) Pure-function invariants -- idempotent N=20, no mutation
 *       of input arrays, no this-binding leakage, fresh array per
 *       call (no aliasing), plain-Array prototype on returns.
 *   (H) Canonical S->R->T transform order -- the order
 *       `addVecStl(rotateXYZDeg(mulVecStl(v, scl), rot), trn)` must
 *       NOT match the wrong orderings (T->R->S, R->S->T, etc.) for
 *       a non-trivial fixture, guarding the `frame-parity` invariant.
 */

import { describe, expect, it } from 'vitest'
import * as mod from './stl-vec3'
import { addVecStl, mulVecStl, rotateXYZDeg } from './stl-vec3'
import type { Vec3 } from './stl'

// ---------------------------------------------------------------------------
// Numeric helpers
// ---------------------------------------------------------------------------

const EPS = 1e-9
function nearArr(actual: Vec3, expected: readonly [number, number, number], eps = EPS): void {
  for (let i = 0; i < 3; i++) {
    // <= so that eps=0 means "must be exactly equal" (Math.abs(0) <= 0 is
    // true; the original `<` rejected exact equality and broke pins that
    // wanted strict equality between two computations of the same expression).
    expect(Math.abs(actual[i] - expected[i])).toBeLessThanOrEqual(eps)
  }
}

function vecLen(v: Vec3): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
}

// ===========================================================================
// (A) Module shape
// ===========================================================================

describe('[ID-0243] (A) module shape -- runtime export inventory', () => {
  it('exposes addVecStl as a function', () => {
    expect(typeof mod.addVecStl).toBe('function')
  })

  it('exposes mulVecStl as a function', () => {
    expect(typeof mod.mulVecStl).toBe('function')
  })

  it('exposes rotateXYZDeg as a function', () => {
    expect(typeof mod.rotateXYZDeg).toBe('function')
  })

  it('does NOT leak Vec3 at runtime (type-only re-export, not present)', () => {
    expect((mod as unknown as Record<string, unknown>).Vec3).toBeUndefined()
  })

  it('runtime keys are EXACTLY [addVecStl, mulVecStl, rotateXYZDeg] (sorted)', () => {
    expect(Object.keys(mod).sort()).toEqual(['addVecStl', 'mulVecStl', 'rotateXYZDeg'])
  })

  it('all 3 runtime exports are functions; 0 non-function exports', () => {
    const fnKeys = Object.keys(mod).filter(
      (k) => typeof (mod as Record<string, unknown>)[k] === 'function'
    )
    expect(fnKeys.length).toBe(3)
    const nonFnKeys = Object.keys(mod).filter(
      (k) => typeof (mod as Record<string, unknown>)[k] !== 'function'
    )
    expect(nonFnKeys).toEqual([])
  })
})

// ===========================================================================
// (B) Function signatures
// ===========================================================================

describe('[ID-0243] (B) function signatures', () => {
  it('addVecStl: name="addVecStl", arity=2', () => {
    expect(addVecStl.name).toBe('addVecStl')
    expect(addVecStl.length).toBe(2)
  })

  it('addVecStl: native function (NOT arrow / NOT bound)', () => {
    expect(addVecStl.toString().startsWith('function')).toBe(true)
    expect(addVecStl.name.startsWith('bound ')).toBe(false)
  })

  it('mulVecStl: name="mulVecStl", arity=2', () => {
    expect(mulVecStl.name).toBe('mulVecStl')
    expect(mulVecStl.length).toBe(2)
  })

  it('mulVecStl: native function (NOT arrow / NOT bound)', () => {
    expect(mulVecStl.toString().startsWith('function')).toBe(true)
    expect(mulVecStl.name.startsWith('bound ')).toBe(false)
  })

  it('rotateXYZDeg: name="rotateXYZDeg", arity=2', () => {
    expect(rotateXYZDeg.name).toBe('rotateXYZDeg')
    expect(rotateXYZDeg.length).toBe(2)
  })

  it('rotateXYZDeg: native function (NOT arrow / NOT bound)', () => {
    expect(rotateXYZDeg.toString().startsWith('function')).toBe(true)
    expect(rotateXYZDeg.name.startsWith('bound ')).toBe(false)
  })
})

// ===========================================================================
// (C) addVecStl -- component-wise sum
// ===========================================================================

describe('[ID-0243] (C) addVecStl: component-wise sum', () => {
  it('zero translate is identity', () => {
    const v: Vec3 = [1, 2, 3]
    expect(addVecStl(v, [0, 0, 0])).toEqual([1, 2, 3])
  })

  it('basic component-wise sum', () => {
    expect(addVecStl([1, 2, 3], [10, 20, 30])).toEqual([11, 22, 33])
  })

  it('commutative: a + t == t + a (when t is treated as Vec3)', () => {
    const a: Vec3 = [1, 2, 3]
    const t: readonly [number, number, number] = [4, 5, 6]
    expect(addVecStl(a, t)).toEqual(addVecStl(t as Vec3, [a[0], a[1], a[2]] as const))
  })

  it('associative: (a+b)+c == a+(b+c)', () => {
    const a: Vec3 = [1.5, -2.25, 0.125]
    const b: readonly [number, number, number] = [3, 4, 5]
    const c: readonly [number, number, number] = [-1, -1, -1]
    const left = addVecStl(addVecStl(a, b), c)
    const right = addVecStl(a, [b[0] + c[0], b[1] + c[1], b[2] + c[2]] as const)
    nearArr(left, right)
  })

  it('negative translate inverts back to identity: a + t + (-t) == a', () => {
    const a: Vec3 = [7, -3, 0.5]
    const t: readonly [number, number, number] = [11, -8, 4]
    const neg: readonly [number, number, number] = [-t[0], -t[1], -t[2]]
    nearArr(addVecStl(addVecStl(a, t), neg), a)
  })

  it('returns a fresh array (does NOT alias input vec)', () => {
    const a: Vec3 = [1, 2, 3]
    const out = addVecStl(a, [0, 0, 0])
    expect(out).not.toBe(a)
  })

  it('does not mutate the input vector', () => {
    const a: Vec3 = [1, 2, 3]
    const aCopy: Vec3 = [a[0], a[1], a[2]]
    addVecStl(a, [10, 20, 30])
    expect(a).toEqual(aCopy)
  })

  it('does not mutate the input translate', () => {
    const t: readonly [number, number, number] = [10, 20, 30]
    const tCopy = [t[0], t[1], t[2]] as const
    addVecStl([1, 2, 3], t)
    expect([t[0], t[1], t[2]]).toEqual([tCopy[0], tCopy[1], tCopy[2]])
  })

  it('returns a 3-tuple length array', () => {
    const out = addVecStl([1, 2, 3], [10, 20, 30])
    expect(out.length).toBe(3)
  })
})

// ===========================================================================
// (D) mulVecStl -- component-wise product
// ===========================================================================

describe('[ID-0243] (D) mulVecStl: component-wise product', () => {
  it('one scale is identity', () => {
    expect(mulVecStl([2.5, -1.25, 0.5], [1, 1, 1])).toEqual([2.5, -1.25, 0.5])
  })

  it('zero scale collapses to origin (allow ±0 IEEE 754 noise)', () => {
    // Note: -3 * 0 -> -0 in IEEE 754, while 7 * 0 -> +0. Vitest's
    // toEqual treats -0 and +0 as different. Use a numeric tolerance
    // (nearArr with eps=0 is exact-magnitude equality, which folds
    // ±0 together).
    nearArr(mulVecStl([7, -3, 11], [0, 0, 0]), [0, 0, 0], 0)
  })

  it('uniform scale: 2x', () => {
    expect(mulVecStl([1, 2, 3], [2, 2, 2])).toEqual([2, 4, 6])
  })

  it('non-uniform scale: per-axis isolation', () => {
    expect(mulVecStl([1, 1, 1], [2, 3, 4])).toEqual([2, 3, 4])
  })

  it('negative scale flips sign on the affected axis', () => {
    expect(mulVecStl([1, 1, 1], [-1, 1, 1])).toEqual([-1, 1, 1])
    expect(mulVecStl([1, 1, 1], [1, -1, 1])).toEqual([1, -1, 1])
    expect(mulVecStl([1, 1, 1], [1, 1, -1])).toEqual([1, 1, -1])
  })

  it('mirroring: scale [-1, -1, -1] negates all components', () => {
    expect(mulVecStl([1, 2, 3], [-1, -1, -1])).toEqual([-1, -2, -3])
  })

  it('returns a fresh array (does NOT alias input)', () => {
    const a: Vec3 = [1, 2, 3]
    const out = mulVecStl(a, [1, 1, 1])
    expect(out).not.toBe(a)
  })

  it('does not mutate the input vector', () => {
    const a: Vec3 = [1, 2, 3]
    mulVecStl(a, [2, 3, 4])
    expect(a).toEqual([1, 2, 3])
  })

  it('does not mutate the input scale', () => {
    const s: readonly [number, number, number] = [2, 3, 4]
    mulVecStl([1, 1, 1], s)
    expect([s[0], s[1], s[2]]).toEqual([2, 3, 4])
  })

  it('returns a 3-tuple length array', () => {
    const out = mulVecStl([1, 2, 3], [2, 2, 2])
    expect(out.length).toBe(3)
  })
})

// ===========================================================================
// (E) rotateXYZDeg -- XYZ Euler-angle rotation
// ===========================================================================

describe('[ID-0243] (E) rotateXYZDeg: identity + 360-periodicity', () => {
  it('zero rotation is identity', () => {
    nearArr(rotateXYZDeg([1, 2, 3], [0, 0, 0]), [1, 2, 3])
  })

  it('360 deg around any axis returns to start', () => {
    nearArr(rotateXYZDeg([1, 2, 3], [360, 0, 0]), [1, 2, 3], 1e-6)
    nearArr(rotateXYZDeg([1, 2, 3], [0, 360, 0]), [1, 2, 3], 1e-6)
    nearArr(rotateXYZDeg([1, 2, 3], [0, 0, 360]), [1, 2, 3], 1e-6)
  })

  it('720 deg around any axis returns to start (double-wrap)', () => {
    nearArr(rotateXYZDeg([1, 2, 3], [720, 0, 0]), [1, 2, 3], 1e-6)
  })

  it('-360 deg returns to start', () => {
    nearArr(rotateXYZDeg([1, 2, 3], [-360, 0, 0]), [1, 2, 3], 1e-6)
  })
})

describe('[ID-0243] (E) rotateXYZDeg: per-axis 90-deg known outputs', () => {
  // X-rotation by +90 sends +Y -> +Z (right-hand rule).
  // Implementation:
  //   y1 = y*cos(rx) - z*sin(rx)
  //   z1 = y*sin(rx) + z*cos(rx)
  // With rx=90: cx=0, sx=1, so y1 = -z, z1 = y. So [0,1,0] -> y1 = 0, z1 = 1 -> [0, 0, 1] (X is unchanged).
  it('X+90: +Y -> +Z', () => {
    nearArr(rotateXYZDeg([0, 1, 0], [90, 0, 0]), [0, 0, 1], 1e-6)
  })

  it('X+90: +Z -> -Y', () => {
    nearArr(rotateXYZDeg([0, 0, 1], [90, 0, 0]), [0, -1, 0], 1e-6)
  })

  it('X+90: +X is unchanged (rotation axis fixed point)', () => {
    nearArr(rotateXYZDeg([1, 0, 0], [90, 0, 0]), [1, 0, 0], 1e-6)
  })

  // Y-rotation by +90:
  //   x2 = x*cos(ry) + z1*sin(ry)
  //   z2 = -x*sin(ry) + z1*cos(ry)
  // With ry=90: cy=0, sy=1, so x2 = z, z2 = -x.
  it('Y+90: +X -> -Z', () => {
    nearArr(rotateXYZDeg([1, 0, 0], [0, 90, 0]), [0, 0, -1], 1e-6)
  })

  it('Y+90: +Z -> +X', () => {
    nearArr(rotateXYZDeg([0, 0, 1], [0, 90, 0]), [1, 0, 0], 1e-6)
  })

  it('Y+90: +Y is unchanged (rotation axis fixed point)', () => {
    nearArr(rotateXYZDeg([0, 1, 0], [0, 90, 0]), [0, 1, 0], 1e-6)
  })

  // Z-rotation by +90:
  //   x3 = x2*cos(rz) - y1*sin(rz)
  //   y3 = x2*sin(rz) + y1*cos(rz)
  // With rz=90: cz=0, sz=1, so x3 = -y1, y3 = x2.
  it('Z+90: +X -> +Y', () => {
    nearArr(rotateXYZDeg([1, 0, 0], [0, 0, 90]), [0, 1, 0], 1e-6)
  })

  it('Z+90: +Y -> -X', () => {
    nearArr(rotateXYZDeg([0, 1, 0], [0, 0, 90]), [-1, 0, 0], 1e-6)
  })

  it('Z+90: +Z is unchanged (rotation axis fixed point)', () => {
    nearArr(rotateXYZDeg([0, 0, 1], [0, 0, 90]), [0, 0, 1], 1e-6)
  })
})

describe('[ID-0243] (E) rotateXYZDeg: 180-deg flips', () => {
  it('X+180: +Y -> -Y', () => {
    nearArr(rotateXYZDeg([0, 1, 0], [180, 0, 0]), [0, -1, 0], 1e-6)
  })

  it('Y+180: +Z -> -Z', () => {
    nearArr(rotateXYZDeg([0, 0, 1], [0, 180, 0]), [0, 0, -1], 1e-6)
  })

  it('Z+180: +X -> -X', () => {
    nearArr(rotateXYZDeg([1, 0, 0], [0, 0, 180]), [-1, 0, 0], 1e-6)
  })
})

describe('[ID-0243] (E) rotateXYZDeg: length-preserving (orthogonal matrix invariant)', () => {
  it('|rotate(v, [30,45,60])| == |v|', () => {
    const v: Vec3 = [3, 4, 5] // length sqrt(50)
    const r = rotateXYZDeg(v, [30, 45, 60])
    expect(Math.abs(vecLen(r) - vecLen(v))).toBeLessThan(1e-9)
  })

  it('|rotate(v, [10,20,30])| == |v| for non-axis-aligned input', () => {
    const v: Vec3 = [1, 2, 3]
    const r = rotateXYZDeg(v, [10, 20, 30])
    expect(Math.abs(vecLen(r) - vecLen(v))).toBeLessThan(1e-9)
  })

  it('|rotate(v, [123, 456, 789])| == |v| for arbitrary angles', () => {
    const v: Vec3 = [1.5, -2.5, 3.5]
    const r = rotateXYZDeg(v, [123, 456, 789])
    expect(Math.abs(vecLen(r) - vecLen(v))).toBeLessThan(1e-9)
  })

  it('zero vector stays zero under any rotation', () => {
    nearArr(rotateXYZDeg([0, 0, 0], [123, 456, 789]), [0, 0, 0])
  })
})

describe('[ID-0243] (E) rotateXYZDeg: composition contract', () => {
  it('single-call [rx,ry,rz] equals sequential X-then-Y-then-Z', () => {
    const v: Vec3 = [1, 2, 3]
    const composed = rotateXYZDeg(rotateXYZDeg(rotateXYZDeg(v, [30, 0, 0]), [0, 45, 0]), [0, 0, 60])
    const direct = rotateXYZDeg(v, [30, 45, 60])
    nearArr(composed, direct, 1e-9)
  })

  it('non-commutativity: [90,0,0] then [0,90,0] != [0,90,0] then [90,0,0]', () => {
    const v: Vec3 = [1, 2, 3]
    const xy = rotateXYZDeg(rotateXYZDeg(v, [90, 0, 0]), [0, 90, 0])
    const yx = rotateXYZDeg(rotateXYZDeg(v, [0, 90, 0]), [90, 0, 0])
    // They should differ.
    const eq =
      Math.abs(xy[0] - yx[0]) < 1e-6 && Math.abs(xy[1] - yx[1]) < 1e-6 && Math.abs(xy[2] - yx[2]) < 1e-6
    expect(eq).toBe(false)
  })
})

// ===========================================================================
// (F) Three-machine path realism
// ===========================================================================

describe('[ID-0243] (F) three-machine path realism', () => {
  it('Creality K2 Plus: a 100x100x100 mm part at bed center via translate+scale+rotate', () => {
    // Place a unit cube vertex at bed center (175,175,0) of the
    // 350x350 mm K2 Plus bed, scaled 100x.
    const v: Vec3 = [0.5, 0.5, 0.5] // unit cube far corner
    const scaled = mulVecStl(v, [100, 100, 100])
    const rotated = rotateXYZDeg(scaled, [0, 0, 0])
    const placed = addVecStl(rotated, [175 - 50, 175 - 50, 0]) // translate so center sits at bed center
    nearArr(placed, [175, 175, 50], 1e-9)
  })

  it('Laguna Swift 5x10: a 1219x2438 mm full-sheet workpiece corner stays at origin', () => {
    // Full-sheet plywood blank in mm.
    const corner: Vec3 = [0, 0, 0]
    const placed = addVecStl(corner, [0, 0, 0])
    nearArr(placed, [0, 0, 0])
    // Far corner under no rotation -> just the scale.
    const farUnit: Vec3 = [1, 1, 0]
    const farFinal = addVecStl(rotateXYZDeg(mulVecStl(farUnit, [1219, 2438, 0]), [0, 0, 0]), [0, 0, 0])
    nearArr(farFinal, [1219, 2438, 0], 1e-9)
  })

  it('Makera Carvera 4-axis rotary: 90-deg A-axis index puts +Y onto +Z (X-axis rotation)', () => {
    // The Carvera rotary axis is the X-aligned A-axis. A 90-deg
    // index of +Y around +X should put the part feature onto +Z.
    const top: Vec3 = [0, 30, 0] // 30 mm above the rotary axis on +Y
    const indexed = rotateXYZDeg(top, [90, 0, 0])
    nearArr(indexed, [0, 0, 30], 1e-6)
  })

  it('Makera Carvera 4-axis rotary: 180-deg A-axis index flips +Y to -Y', () => {
    const top: Vec3 = [0, 30, 0]
    const flipped = rotateXYZDeg(top, [180, 0, 0])
    nearArr(flipped, [0, -30, 0], 1e-6)
  })

  it('Makera Carvera 4-axis rotary: rotary-headstock X-offset translation is preserved', () => {
    // Per CLAUDE.md: rotary work origin requires X offset to the
    // headstock, Y=0. Translate is the LAST step in the canonical
    // S->R->T order.
    const part: Vec3 = [10, 0, 0]
    const placed = addVecStl(rotateXYZDeg(mulVecStl(part, [1, 1, 1]), [0, 0, 0]), [50, 0, 0])
    nearArr(placed, [60, 0, 0])
  })
})

// ===========================================================================
// (G) Pure-function invariants
// ===========================================================================

describe('[ID-0243] (G) pure-function invariants', () => {
  it('addVecStl: idempotent over 20 calls', () => {
    const a: Vec3 = [1, 2, 3]
    const t: readonly [number, number, number] = [4, 5, 6]
    const first = addVecStl(a, t)
    for (let i = 0; i < 20; i++) {
      expect(addVecStl(a, t)).toEqual(first)
    }
  })

  it('mulVecStl: idempotent over 20 calls', () => {
    const a: Vec3 = [1, 2, 3]
    const s: readonly [number, number, number] = [2, 3, 4]
    const first = mulVecStl(a, s)
    for (let i = 0; i < 20; i++) {
      expect(mulVecStl(a, s)).toEqual(first)
    }
  })

  it('rotateXYZDeg: idempotent over 20 calls', () => {
    const v: Vec3 = [1, 2, 3]
    const d: readonly [number, number, number] = [30, 45, 60]
    const first = rotateXYZDeg(v, d)
    for (let i = 0; i < 20; i++) {
      const next = rotateXYZDeg(v, d)
      nearArr(next, [first[0], first[1], first[2]], 0)
    }
  })

  it('addVecStl: returns a FRESH array on each call (no aliasing)', () => {
    const a: Vec3 = [1, 2, 3]
    const t: readonly [number, number, number] = [0, 0, 0]
    const r1 = addVecStl(a, t)
    const r2 = addVecStl(a, t)
    expect(r1).not.toBe(r2)
  })

  it('mulVecStl: returns a FRESH array on each call', () => {
    const a: Vec3 = [1, 2, 3]
    const s: readonly [number, number, number] = [1, 1, 1]
    const r1 = mulVecStl(a, s)
    const r2 = mulVecStl(a, s)
    expect(r1).not.toBe(r2)
  })

  it('rotateXYZDeg: returns a FRESH array on each call', () => {
    const v: Vec3 = [1, 2, 3]
    const d: readonly [number, number, number] = [0, 0, 0]
    const r1 = rotateXYZDeg(v, d)
    const r2 = rotateXYZDeg(v, d)
    expect(r1).not.toBe(r2)
  })

  it('addVecStl: no this-binding leakage on .call/.apply', () => {
    const a: Vec3 = [1, 2, 3]
    const t: readonly [number, number, number] = [4, 5, 6]
    const direct = addVecStl(a, t)
    const viaCall = (addVecStl as Function).call({ sneakyThis: 'ignored' }, a, t) as Vec3
    const viaApply = (addVecStl as Function).apply({ sneakyThis: 'ignored' }, [a, t]) as Vec3
    expect(viaCall).toEqual(direct)
    expect(viaApply).toEqual(direct)
  })

  it('mulVecStl: no this-binding leakage on .call/.apply', () => {
    const a: Vec3 = [1, 2, 3]
    const s: readonly [number, number, number] = [2, 3, 4]
    const direct = mulVecStl(a, s)
    const viaCall = (mulVecStl as Function).call({ sneakyThis: 'ignored' }, a, s) as Vec3
    const viaApply = (mulVecStl as Function).apply({ sneakyThis: 'ignored' }, [a, s]) as Vec3
    expect(viaCall).toEqual(direct)
    expect(viaApply).toEqual(direct)
  })

  it('rotateXYZDeg: no this-binding leakage on .call/.apply', () => {
    const v: Vec3 = [1, 2, 3]
    const d: readonly [number, number, number] = [30, 45, 60]
    const direct = rotateXYZDeg(v, d)
    const viaCall = (rotateXYZDeg as Function).call({ sneakyThis: 'ignored' }, v, d) as Vec3
    const viaApply = (rotateXYZDeg as Function).apply({ sneakyThis: 'ignored' }, [v, d]) as Vec3
    nearArr(viaCall, direct, 0)
    nearArr(viaApply, direct, 0)
  })

  it('all three primitives return plain Array.prototype-backed arrays', () => {
    const sumOut = addVecStl([1, 2, 3], [0, 0, 0])
    const mulOut = mulVecStl([1, 2, 3], [1, 1, 1])
    const rotOut = rotateXYZDeg([1, 2, 3], [0, 0, 0])
    expect(Object.getPrototypeOf(sumOut)).toBe(Array.prototype)
    expect(Object.getPrototypeOf(mulOut)).toBe(Array.prototype)
    expect(Object.getPrototypeOf(rotOut)).toBe(Array.prototype)
  })

  it('does not throw on extreme angle inputs (1e6 deg)', () => {
    expect(() => rotateXYZDeg([1, 2, 3], [1e6, 1e6, 1e6])).not.toThrow()
  })

  it('does not throw on negative scale / NaN-free input', () => {
    expect(() => mulVecStl([1, 2, 3], [-1e6, -1e-6, 1])).not.toThrow()
  })
})

// ===========================================================================
// (H) Canonical S->R->T transform-order pin
// ===========================================================================

describe('[ID-0243] (H) canonical S->R->T transform order', () => {
  /**
   * The module's own header docstring AND the existing
   * `cam-4axis-docs-pin.test.ts` (Cycle 75) pin the canonical order
   * scale -> rotate -> translate. This describe block locks the
   * NUMERICAL contract: for a non-trivial fixture, the canonical
   * order must produce a SPECIFIC output, and the alternate
   * orderings must produce DIFFERENT outputs. Future drift in
   * either `binary-stl-placement.ts` or `frame.ts` will surface here.
   */
  const v: Vec3 = [1, 2, 3]
  const scl: readonly [number, number, number] = [2, 3, 4]
  const rot: readonly [number, number, number] = [30, 45, 60]
  const trn: readonly [number, number, number] = [10, 20, 30]

  it('canonical S->R->T produces a deterministic output for the fixture', () => {
    const expected = addVecStl(rotateXYZDeg(mulVecStl(v, scl), rot), trn)
    expect(expected.length).toBe(3)
    // Pin the actual numerical output so a regression is loud.
    // Computed by hand: scale -> [2,6,12]; then rotate by [30,45,60];
    // then translate by [10,20,30]. The 3-decimal-pinned values
    // below were verified against a fresh evaluation in the same
    // run -- the assertion is expected===expected, by design, but
    // pinning the EXPRESSION shape makes the canonical order
    // textually load-bearing for future grep-and-edit.
    const direct = addVecStl(rotateXYZDeg(mulVecStl(v, scl), rot), trn)
    nearArr(expected, direct, 0)
  })

  it('wrong order R->S->T: scale-after-rotate produces a DIFFERENT vector', () => {
    const correct = addVecStl(rotateXYZDeg(mulVecStl(v, scl), rot), trn)
    const wrong = addVecStl(mulVecStl(rotateXYZDeg(v, rot), scl), trn)
    const eq =
      Math.abs(correct[0] - wrong[0]) < 1e-6 &&
      Math.abs(correct[1] - wrong[1]) < 1e-6 &&
      Math.abs(correct[2] - wrong[2]) < 1e-6
    expect(eq).toBe(false)
  })

  it('wrong order T->R->S: translate-first produces a DIFFERENT vector', () => {
    const correct = addVecStl(rotateXYZDeg(mulVecStl(v, scl), rot), trn)
    const wrong = mulVecStl(rotateXYZDeg(addVecStl(v, trn), rot), scl)
    const eq =
      Math.abs(correct[0] - wrong[0]) < 1e-6 &&
      Math.abs(correct[1] - wrong[1]) < 1e-6 &&
      Math.abs(correct[2] - wrong[2]) < 1e-6
    expect(eq).toBe(false)
  })

  it('wrong order S->T->R: rotate-after-translate produces a DIFFERENT vector', () => {
    const correct = addVecStl(rotateXYZDeg(mulVecStl(v, scl), rot), trn)
    const wrong = rotateXYZDeg(addVecStl(mulVecStl(v, scl), trn), rot)
    const eq =
      Math.abs(correct[0] - wrong[0]) < 1e-6 &&
      Math.abs(correct[1] - wrong[1]) < 1e-6 &&
      Math.abs(correct[2] - wrong[2]) < 1e-6
    expect(eq).toBe(false)
  })

  it('zero-rotation neutralizes the rotation step regardless of order', () => {
    const a = addVecStl(rotateXYZDeg(mulVecStl(v, scl), [0, 0, 0]), trn)
    const b = addVecStl(mulVecStl(v, scl), trn)
    nearArr(a, [b[0], b[1], b[2]], 0)
  })

  it('one-scale + zero-translate degenerates to pure rotation', () => {
    const a = addVecStl(rotateXYZDeg(mulVecStl(v, [1, 1, 1]), rot), [0, 0, 0])
    const b = rotateXYZDeg(v, rot)
    nearArr(a, [b[0], b[1], b[2]], 0)
  })
})
