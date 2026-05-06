/**
 * Paired-pin contract for `src/renderer/design/viewport3d-camera-animate.ts`
 * -- the 154-line RENDERER-side smooth-camera fly-to module shared by the
 * 3D viewport across all three target machines' shop environments.
 *
 * The module exports five runtime symbols:
 *
 * - `computeStandardViewGoal(currentPos, currentTarget, preset)` -- pure
 *   pose-target computer for the seven standard view presets
 *   (top/bottom/front/back/right/left/iso) with a minimum-distance floor of
 *   80 (mm) and a Y-up-by-default convention except for top (-Z up) and
 *   bottom (+Z up).
 * - `createInactiveAnimation()` -- returns a fresh `CameraAnimationState`
 *   in the inactive state (durationMs default = 400, fromUp default
 *   (0, 1, 0)).
 * - `startCameraAnimation(state, fromPos, fromUp, fromTarget, goal, ms?)`
 *   -- in-place mutator that activates the state, copies in the from/to
 *   poses, and stamps `performance.now()` as the start time.
 * - `smoothstep(t)` -- cubic Hermite ease-in-out (3t^2 - 2t^3) clamped to
 *   [0, 1].
 * - `tickCameraAnimation(state, now, outPos, outUp, outTarget)` -- ticks
 *   the active animation forward by interpolating the from/to poses
 *   through `smoothstep`, snapping to the goal when `now - startTime >=
 *   durationMs` and flipping `state.active` to false. Returns `true`
 *   while the animation is still considered "active during this tick"
 *   (even on the snap tick) and `false` only when the state was already
 *   inactive on entry.
 *
 * The module also exports two type-only symbols (`StandardView`,
 * `CameraGoal`, and the runtime-shaped `CameraAnimationState`).
 *
 * Three-machine impact: INDIRECT cross-cut on the renderer-side 3D
 * viewport camera fly-to surface shared across all three target machines'
 * shop environments. Every K2 Plus FDM bed view, Laguna 5x10 sheet view,
 * Carvera 3-axis stock view, and Carvera 4-axis rotary view delegates the
 * "press T / press F / press iso" standard-view fly-to to this module.
 * A regression in any of these would silently break view-preset hot-keys
 * across all four shop-environment quick-switches. The minimum-distance
 * floor of 80 prevents the camera from being placed inside the 4-axis
 * 50-mm-bar rotary-stock envelope when a user re-targets a small part.
 *
 * This pin co-locates with the existing behavioral test
 * `viewport3d-camera-animate.test.ts`. The pin is exhaustive against the
 * preset switch-table, the min-distance floor, the smoothstep boundaries,
 * the lifecycle invariants, the in-place mutation contract, the
 * source-text whitelist, and the three-machine cross-cut realism.
 *
 * Roadmap ID: [ID-0302] / Cycle 229 (ui-polish rotation slot, 16:42Z).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as THREE from 'three'
import * as M from './viewport3d-camera-animate'
import {
  computeStandardViewGoal,
  createInactiveAnimation,
  smoothstep,
  startCameraAnimation,
  tickCameraAnimation,
  type CameraAnimationState,
  type CameraGoal,
  type StandardView
} from './viewport3d-camera-animate'

const SOURCE_PATH = resolve(__dirname, 'viewport3d-camera-animate.ts')
const SOURCE = readFileSync(SOURCE_PATH, 'utf-8')

const ALL_PRESETS: readonly StandardView[] = [
  'top',
  'bottom',
  'front',
  'back',
  'right',
  'left',
  'iso'
] as const

// ---------------------------------------------------------------------------
// A. Module shape -- exactly five runtime exports; arities; THREE-backed.
// ---------------------------------------------------------------------------
describe('A. Module shape -- src/renderer/design/viewport3d-camera-animate.ts', () => {
  it('exports exactly the five-symbol public RUNTIME surface', () => {
    expect(Object.keys(M).sort()).toEqual([
      'computeStandardViewGoal',
      'createInactiveAnimation',
      'smoothstep',
      'startCameraAnimation',
      'tickCameraAnimation'
    ])
  })

  it('all five exports are functions', () => {
    expect(typeof computeStandardViewGoal).toBe('function')
    expect(typeof createInactiveAnimation).toBe('function')
    expect(typeof startCameraAnimation).toBe('function')
    expect(typeof smoothstep).toBe('function')
    expect(typeof tickCameraAnimation).toBe('function')
  })

  it('arities match the documented signatures', () => {
    expect(computeStandardViewGoal.length).toBe(3)
    expect(createInactiveAnimation.length).toBe(0)
    // startCameraAnimation has an optional 6th argument with default 400
    // -> the .length skips trailing optionals, so it reports 5.
    expect(startCameraAnimation.length).toBe(5)
    expect(smoothstep.length).toBe(1)
    expect(tickCameraAnimation.length).toBe(5)
  })

  it('does NOT export a class constructor at module level', () => {
    for (const v of Object.values(M)) {
      // Plain functions; no class shape exposed publicly.
      if (typeof v === 'function') {
        // A class constructor would have a non-empty prototype map.
        const proto = (v as { prototype?: object }).prototype
        if (proto && typeof proto === 'object') {
          // Permitted: function .prototype with only `constructor`.
          const ownNames = Object.getOwnPropertyNames(proto).filter((n) => n !== 'constructor')
          expect(ownNames).toEqual([])
        }
      }
    }
  })
})

// ---------------------------------------------------------------------------
// B. computeStandardViewGoal -- preset switch table + axis directions
// ---------------------------------------------------------------------------
describe('B. computeStandardViewGoal -- preset switch table', () => {
  const startPos = new THREE.Vector3(120, 90, 120)
  const origin = new THREE.Vector3(0, 0, 0)

  it('top preset places camera on +Y axis above target with up = (0, 0, -1)', () => {
    const g = computeStandardViewGoal(startPos, origin, 'top')
    expect(g.position.y).toBeGreaterThan(origin.y)
    expect(g.up.x).toBeCloseTo(0, 5)
    expect(g.up.y).toBeCloseTo(0, 5)
    expect(g.up.z).toBeCloseTo(-1, 5)
  })

  it('bottom preset places camera on -Y axis below target with up = (0, 0, +1)', () => {
    const g = computeStandardViewGoal(startPos, origin, 'bottom')
    expect(g.position.y).toBeLessThan(origin.y)
    expect(g.up.x).toBeCloseTo(0, 5)
    expect(g.up.y).toBeCloseTo(0, 5)
    expect(g.up.z).toBeCloseTo(1, 5)
  })

  it('front preset places camera on +Z axis with default up = (0, 1, 0)', () => {
    const g = computeStandardViewGoal(startPos, origin, 'front')
    expect(g.position.z).toBeGreaterThan(0)
    expect(g.up.y).toBeCloseTo(1, 5)
    expect(g.up.x).toBeCloseTo(0, 5)
    expect(g.up.z).toBeCloseTo(0, 5)
  })

  it('back preset places camera on -Z axis with default up = (0, 1, 0)', () => {
    const g = computeStandardViewGoal(startPos, origin, 'back')
    expect(g.position.z).toBeLessThan(0)
    expect(g.up.y).toBeCloseTo(1, 5)
  })

  it('right preset places camera on +X axis with default up = (0, 1, 0)', () => {
    const g = computeStandardViewGoal(startPos, origin, 'right')
    expect(g.position.x).toBeGreaterThan(0)
    expect(g.up.y).toBeCloseTo(1, 5)
  })

  it('left preset places camera on -X axis with default up = (0, 1, 0)', () => {
    const g = computeStandardViewGoal(startPos, origin, 'left')
    expect(g.position.x).toBeLessThan(0)
    expect(g.up.y).toBeCloseTo(1, 5)
  })

  it('iso preset places camera in the +X / +Y / +Z octant with default up', () => {
    const g = computeStandardViewGoal(startPos, origin, 'iso')
    expect(g.position.x).toBeGreaterThan(0)
    expect(g.position.y).toBeGreaterThan(0)
    expect(g.position.z).toBeGreaterThan(0)
    expect(g.up.y).toBeCloseTo(1, 5)
  })

  it('the goal target is a clone of the input target (separate Vector3 instance)', () => {
    const target = new THREE.Vector3(7, 8, 9)
    const g = computeStandardViewGoal(startPos, target, 'iso')
    expect(g.target).not.toBe(target)
    expect(g.target.x).toBeCloseTo(7, 5)
    expect(g.target.y).toBeCloseTo(8, 5)
    expect(g.target.z).toBeCloseTo(9, 5)
  })

  it('goal.position and goal.up are fresh THREE.Vector3 instances (not shared with input)', () => {
    const g = computeStandardViewGoal(startPos, origin, 'top')
    expect(g.position).not.toBe(startPos)
    expect(g.up).not.toBe(origin)
    expect(g.position).toBeInstanceOf(THREE.Vector3)
    expect(g.up).toBeInstanceOf(THREE.Vector3)
    expect(g.target).toBeInstanceOf(THREE.Vector3)
  })

  it('iso preset uses the documented (1, 0.75, 1) direction (Y under X/Z by 0.75 ratio)', () => {
    const g = computeStandardViewGoal(startPos, origin, 'iso')
    // Direction normalized -> components ratio: y/x = 0.75, z/x = 1.
    expect(g.position.y / g.position.x).toBeCloseTo(0.75, 5)
    expect(g.position.z / g.position.x).toBeCloseTo(1, 5)
  })
})

// ---------------------------------------------------------------------------
// C. computeStandardViewGoal -- distance preservation + min-floor of 80
// ---------------------------------------------------------------------------
describe('C. computeStandardViewGoal -- distance contract', () => {
  it('preserves the camera-to-target distance for ALL seven presets when distance >= 80', () => {
    const target = new THREE.Vector3(0, 0, 0)
    const farPos = new THREE.Vector3(150, 100, 150)
    const dist = farPos.distanceTo(target)
    expect(dist).toBeGreaterThan(80)
    for (const p of ALL_PRESETS) {
      const g = computeStandardViewGoal(farPos, target, p)
      expect(Math.abs(g.position.distanceTo(g.target) - dist)).toBeLessThan(1e-3)
    }
  })

  it('clamps the goal distance to a minimum of 80 when the camera is closer than 80', () => {
    const target = new THREE.Vector3(0, 0, 0)
    const closePos = new THREE.Vector3(5, 0, 0)
    for (const p of ALL_PRESETS) {
      const g = computeStandardViewGoal(closePos, target, p)
      expect(g.position.distanceTo(g.target)).toBeGreaterThanOrEqual(80 - 1e-6)
    }
  })

  it('the min-distance floor of 80 is documented in source as Math.max(80, ...)', () => {
    // Pin via source-text scan -- the floor is the safety invariant that
    // prevents the camera from being placed inside small rotary stock.
    expect(SOURCE).toMatch(/Math\.max\(\s*80\s*,/)
  })

  it('does not modify the input position or input target Vector3 instances', () => {
    const pos = new THREE.Vector3(10, 20, 30)
    const target = new THREE.Vector3(1, 2, 3)
    const posBefore = pos.clone()
    const targetBefore = target.clone()
    computeStandardViewGoal(pos, target, 'iso')
    expect(pos.x).toBe(posBefore.x)
    expect(pos.y).toBe(posBefore.y)
    expect(pos.z).toBe(posBefore.z)
    expect(target.x).toBe(targetBefore.x)
    expect(target.y).toBe(targetBefore.y)
    expect(target.z).toBe(targetBefore.z)
  })

  it('respects a non-zero target -- camera position offsets are RELATIVE to target', () => {
    const target = new THREE.Vector3(100, 50, -25)
    const pos = new THREE.Vector3(200, 150, 75) // distance ~= 161
    const g = computeStandardViewGoal(pos, target, 'right')
    // For 'right' the camera is on +X relative to target with same Y/Z.
    expect(g.position.x).toBeGreaterThan(target.x)
    expect(Math.abs(g.position.y - target.y)).toBeLessThan(1e-3)
    expect(Math.abs(g.position.z - target.z)).toBeLessThan(1e-3)
  })
})

// ---------------------------------------------------------------------------
// D. smoothstep -- cubic Hermite + clamp
// ---------------------------------------------------------------------------
describe('D. smoothstep -- cubic Hermite ease-in-out clamped to [0, 1]', () => {
  it('returns 0 at t = 0 and 1 at t = 1', () => {
    expect(smoothstep(0)).toBeCloseTo(0, 12)
    expect(smoothstep(1)).toBeCloseTo(1, 12)
  })

  it('returns 0.5 at t = 0.5 (the curve passes through the midpoint exactly)', () => {
    expect(smoothstep(0.5)).toBeCloseTo(0.5, 12)
  })

  it('matches the documented 3t^2 - 2t^3 polynomial at sampled points', () => {
    for (const t of [0.1, 0.25, 0.4, 0.6, 0.75, 0.9]) {
      const expected = t * t * (3 - 2 * t)
      expect(smoothstep(t)).toBeCloseTo(expected, 12)
    }
  })

  it('clamps negative input to 0', () => {
    expect(smoothstep(-1)).toBe(0)
    expect(smoothstep(-1e6)).toBe(0)
    expect(smoothstep(-0.0001)).toBe(0)
  })

  it('clamps input > 1 to 1', () => {
    expect(smoothstep(1.0001)).toBe(1)
    expect(smoothstep(2)).toBe(1)
    expect(smoothstep(1e6)).toBe(1)
  })

  it('is monotonically increasing on [0, 1]', () => {
    let prev = smoothstep(0)
    for (let t = 0.01; t <= 1; t += 0.01) {
      const cur = smoothstep(t)
      expect(cur).toBeGreaterThanOrEqual(prev - 1e-12)
      prev = cur
    }
  })

  it('has zero derivative at endpoints (ease-in-out shape) -- approximation via finite difference', () => {
    const eps = 1e-4
    const slopeAt0 = (smoothstep(eps) - smoothstep(0)) / eps
    const slopeAt1 = (smoothstep(1) - smoothstep(1 - eps)) / eps
    // For 3t^2 - 2t^3 derivative is 6t - 6t^2 -> 0 at t=0 and t=1.
    expect(slopeAt0).toBeLessThan(0.01)
    expect(slopeAt1).toBeLessThan(0.01)
  })

  it('is deterministic (pure function)', () => {
    expect(smoothstep(0.42)).toBe(smoothstep(0.42))
  })
})

// ---------------------------------------------------------------------------
// E. createInactiveAnimation -- shape pin
// ---------------------------------------------------------------------------
describe('E. createInactiveAnimation -- inactive default state shape', () => {
  it('returns a CameraAnimationState with active=false', () => {
    const s = createInactiveAnimation()
    expect(s.active).toBe(false)
  })

  it('uses durationMs default = 400', () => {
    expect(createInactiveAnimation().durationMs).toBe(400)
  })

  it('uses fromUp default = (0, 1, 0) and toUp default = (0, 1, 0)', () => {
    const s = createInactiveAnimation()
    expect(s.fromUp.x).toBe(0)
    expect(s.fromUp.y).toBe(1)
    expect(s.fromUp.z).toBe(0)
    expect(s.toUp.x).toBe(0)
    expect(s.toUp.y).toBe(1)
    expect(s.toUp.z).toBe(0)
  })

  it('uses startTime default = 0 and zero from/to position + target', () => {
    const s = createInactiveAnimation()
    expect(s.startTime).toBe(0)
    expect(s.fromPos.length()).toBe(0)
    expect(s.toPos.length()).toBe(0)
    expect(s.fromTarget.length()).toBe(0)
    expect(s.toTarget.length()).toBe(0)
  })

  it('returns a fresh state (no shared instance leakage between calls)', () => {
    const a = createInactiveAnimation()
    const b = createInactiveAnimation()
    expect(a).not.toBe(b)
    expect(a.fromPos).not.toBe(b.fromPos)
    expect(a.toUp).not.toBe(b.toUp)
  })

  it('has all eight expected runtime keys', () => {
    const s = createInactiveAnimation()
    expect(Object.keys(s).sort()).toEqual([
      'active',
      'durationMs',
      'fromPos',
      'fromTarget',
      'fromUp',
      'startTime',
      'toPos',
      'toTarget',
      'toUp'
    ])
  })

  it('all six Vector3 fields are THREE.Vector3 instances', () => {
    const s = createInactiveAnimation()
    expect(s.fromPos).toBeInstanceOf(THREE.Vector3)
    expect(s.fromUp).toBeInstanceOf(THREE.Vector3)
    expect(s.fromTarget).toBeInstanceOf(THREE.Vector3)
    expect(s.toPos).toBeInstanceOf(THREE.Vector3)
    expect(s.toUp).toBeInstanceOf(THREE.Vector3)
    expect(s.toTarget).toBeInstanceOf(THREE.Vector3)
  })
})

// ---------------------------------------------------------------------------
// F. startCameraAnimation -- in-place mutator contract
// ---------------------------------------------------------------------------
describe('F. startCameraAnimation -- in-place mutation contract', () => {
  function buildGoal(): CameraGoal {
    return {
      position: new THREE.Vector3(0, 100, 0),
      up: new THREE.Vector3(0, 0, -1),
      target: new THREE.Vector3(0, 0, 0)
    }
  }

  it('flips state.active from false to true', () => {
    const s = createInactiveAnimation()
    expect(s.active).toBe(false)
    startCameraAnimation(
      s,
      new THREE.Vector3(100, 50, 100),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 0),
      buildGoal(),
      500
    )
    expect(s.active).toBe(true)
  })

  it('writes durationMs from the explicit argument', () => {
    const s = createInactiveAnimation()
    startCameraAnimation(
      s,
      new THREE.Vector3(),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(),
      buildGoal(),
      750
    )
    expect(s.durationMs).toBe(750)
  })

  it('defaults durationMs to 400 when the argument is omitted', () => {
    const s = createInactiveAnimation()
    startCameraAnimation(
      s,
      new THREE.Vector3(),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(),
      buildGoal()
    )
    expect(s.durationMs).toBe(400)
  })

  it('records performance.now() into startTime (within a tight bound of the call)', () => {
    const s = createInactiveAnimation()
    const before = performance.now()
    startCameraAnimation(
      s,
      new THREE.Vector3(),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(),
      buildGoal(),
      400
    )
    const after = performance.now()
    expect(s.startTime).toBeGreaterThanOrEqual(before - 1e-3)
    expect(s.startTime).toBeLessThanOrEqual(after + 1e-3)
  })

  it('copies the from/to vectors INTO the state (does not store the input references)', () => {
    const s = createInactiveAnimation()
    const fromPos = new THREE.Vector3(11, 22, 33)
    const fromUp = new THREE.Vector3(0, 1, 0)
    const fromTarget = new THREE.Vector3(7, 8, 9)
    const goal = buildGoal()
    startCameraAnimation(s, fromPos, fromUp, fromTarget, goal, 400)
    // The state's vectors must be SEPARATE instances (or .copy() preserves
    // the SAME reference but with the input values copied; the contract is
    // that mutating the input afterward must NOT bleed into the state).
    fromPos.set(999, 999, 999)
    expect(s.fromPos.x).toBe(11)
    expect(s.fromPos.y).toBe(22)
    expect(s.fromPos.z).toBe(33)
    fromTarget.set(0, 0, 0)
    expect(s.fromTarget.x).toBe(7)
    expect(s.fromTarget.y).toBe(8)
    expect(s.fromTarget.z).toBe(9)
  })

  it('copies the goal vectors -- mutating the goal afterward does not change state.toPos', () => {
    const s = createInactiveAnimation()
    const goal = buildGoal()
    startCameraAnimation(
      s,
      new THREE.Vector3(),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(),
      goal,
      400
    )
    goal.position.set(-1, -2, -3)
    expect(s.toPos.x).toBe(0)
    expect(s.toPos.y).toBe(100)
    expect(s.toPos.z).toBe(0)
  })

  it('preserves the SAME state Vector3 references across calls (in-place .copy())', () => {
    const s = createInactiveAnimation()
    const fromPosRef = s.fromPos
    const toPosRef = s.toPos
    startCameraAnimation(
      s,
      new THREE.Vector3(1, 2, 3),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(),
      buildGoal(),
      400
    )
    expect(s.fromPos).toBe(fromPosRef)
    expect(s.toPos).toBe(toPosRef)
  })
})

// ---------------------------------------------------------------------------
// G. tickCameraAnimation -- interpolation + completion
// ---------------------------------------------------------------------------
describe('G. tickCameraAnimation -- interpolation + completion lifecycle', () => {
  function activeAnim(durationMs = 1000): CameraAnimationState {
    const s = createInactiveAnimation()
    startCameraAnimation(
      s,
      new THREE.Vector3(0, 0, 100),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 0),
      {
        position: new THREE.Vector3(0, 100, 0),
        up: new THREE.Vector3(0, 0, -1),
        target: new THREE.Vector3(0, 0, 0)
      },
      durationMs
    )
    return s
  }

  it('returns false (and does not mutate outputs) when state is inactive on entry', () => {
    const s = createInactiveAnimation()
    const pos = new THREE.Vector3(123, 456, 789)
    const up = new THREE.Vector3(0, 1, 0)
    const target = new THREE.Vector3(1, 2, 3)
    const ret = tickCameraAnimation(s, 0, pos, up, target)
    expect(ret).toBe(false)
    // outputs untouched
    expect(pos.x).toBe(123)
    expect(pos.y).toBe(456)
    expect(pos.z).toBe(789)
    expect(target.x).toBe(1)
  })

  it('at now = startTime, output equals fromPos (smoothstep(0) = 0)', () => {
    const s = activeAnim()
    const pos = new THREE.Vector3()
    const up = new THREE.Vector3()
    const target = new THREE.Vector3()
    tickCameraAnimation(s, s.startTime, pos, up, target)
    expect(pos.x).toBeCloseTo(0, 5)
    expect(pos.y).toBeCloseTo(0, 5)
    expect(pos.z).toBeCloseTo(100, 5)
  })

  it('at midpoint smoothstep(0.5) = 0.5 -> position lerps halfway', () => {
    const s = activeAnim()
    const pos = new THREE.Vector3()
    const up = new THREE.Vector3()
    const target = new THREE.Vector3()
    tickCameraAnimation(s, s.startTime + 500, pos, up, target)
    expect(pos.y).toBeCloseTo(50, 1)
    expect(pos.z).toBeCloseTo(50, 1)
    expect(s.active).toBe(true)
  })

  it('beyond duration snaps exactly to the goal pose AND deactivates the state', () => {
    const s = activeAnim()
    const pos = new THREE.Vector3()
    const up = new THREE.Vector3()
    const target = new THREE.Vector3()
    tickCameraAnimation(s, s.startTime + 1100, pos, up, target)
    expect(pos.x).toBeCloseTo(0, 6)
    expect(pos.y).toBeCloseTo(100, 6)
    expect(pos.z).toBeCloseTo(0, 6)
    // up snapped to (0, 0, -1) and renormalized
    expect(up.x).toBeCloseTo(0, 6)
    expect(up.y).toBeCloseTo(0, 6)
    expect(up.z).toBeCloseTo(-1, 6)
    expect(s.active).toBe(false)
  })

  it('returns true on the snap (final) tick even though it deactivates the state', () => {
    const s = activeAnim()
    const pos = new THREE.Vector3()
    const up = new THREE.Vector3()
    const target = new THREE.Vector3()
    const ret = tickCameraAnimation(s, s.startTime + 1100, pos, up, target)
    expect(ret).toBe(true)
    expect(s.active).toBe(false)
  })

  it('subsequent tick after completion returns false', () => {
    const s = activeAnim()
    const pos = new THREE.Vector3()
    const up = new THREE.Vector3()
    const target = new THREE.Vector3()
    tickCameraAnimation(s, s.startTime + 1100, pos, up, target)
    expect(tickCameraAnimation(s, s.startTime + 2000, pos, up, target)).toBe(false)
  })

  it('output up vector is renormalized to unit length on every tick (lerpVectors -> normalize)', () => {
    const s = activeAnim()
    const pos = new THREE.Vector3()
    const up = new THREE.Vector3()
    const target = new THREE.Vector3()
    for (const dt of [0, 100, 250, 500, 750, 999]) {
      tickCameraAnimation(s, s.startTime + dt, pos, up, target)
      expect(up.length()).toBeCloseTo(1, 5)
    }
  })

  it('output target lerps from fromTarget to toTarget (here both are origin -> stays at origin)', () => {
    const s = activeAnim()
    const pos = new THREE.Vector3()
    const up = new THREE.Vector3()
    const target = new THREE.Vector3()
    tickCameraAnimation(s, s.startTime + 500, pos, up, target)
    expect(target.x).toBeCloseTo(0, 5)
    expect(target.y).toBeCloseTo(0, 5)
    expect(target.z).toBeCloseTo(0, 5)
  })

  it('handles durationMs = 0 by snapping to goal on the first tick', () => {
    const s = activeAnim(0)
    const pos = new THREE.Vector3()
    const up = new THREE.Vector3()
    const target = new THREE.Vector3()
    tickCameraAnimation(s, s.startTime, pos, up, target)
    expect(pos.y).toBeCloseTo(100, 5)
    expect(pos.z).toBeCloseTo(0, 5)
    expect(s.active).toBe(false)
  })

  it('writes into the caller-supplied output Vector3s (does not allocate a new one)', () => {
    const s = activeAnim()
    const pos = new THREE.Vector3()
    const up = new THREE.Vector3()
    const target = new THREE.Vector3()
    const posRef = pos
    const upRef = up
    const targetRef = target
    tickCameraAnimation(s, s.startTime + 250, pos, up, target)
    // The same instances must still be addressed (not replaced).
    expect(pos).toBe(posRef)
    expect(up).toBe(upRef)
    expect(target).toBe(targetRef)
  })
})

// ---------------------------------------------------------------------------
// H. Source-text whitelist -- imports, safety, dialect pins
// ---------------------------------------------------------------------------
describe('H. Source-text whitelist + safety', () => {
  function stripped(): string {
    return SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  }

  it("imports * as THREE from 'three' (the only runtime import)", () => {
    expect(SOURCE).toMatch(/import\s+\*\s+as\s+THREE\s+from\s+'three'/)
    const importLines = stripped()
      .split('\n')
      .filter((l) => /^\s*import\s/.test(l))
    expect(importLines.length).toBe(1)
  })

  it('does not contain `:any` annotations or `as any` casts', () => {
    const code = stripped()
    expect(code).not.toMatch(/\bas\s+any\b/)
    expect(code).not.toMatch(/:\s*any\b/)
  })

  it('does not call eval / new Function', () => {
    expect(SOURCE).not.toMatch(/\beval\s*\(/)
    expect(SOURCE).not.toMatch(/\bnew\s+Function\s*\(/)
  })

  it('does not import any node:* / electron / fs / path module (renderer-side hygiene)', () => {
    expect(SOURCE).not.toMatch(/from\s+'node:[^']+'/)
    expect(SOURCE).not.toMatch(/from\s+'electron'/)
    expect(SOURCE).not.toMatch(/from\s+'fs'/)
    expect(SOURCE).not.toMatch(/from\s+'path'/)
    expect(SOURCE).not.toMatch(/from\s+'child_process'/)
  })

  it('declares Math.max(80, ...) as the min-distance floor', () => {
    expect(SOURCE).toMatch(/Math\.max\(\s*80\s*,\s*currentPos\.distanceTo\(\s*currentTarget\s*\)\s*\)/)
  })

  it('declares the seven-preset switch table covering top/bottom/front/back/right/left/iso', () => {
    expect(SOURCE).toMatch(/case 'top':/)
    expect(SOURCE).toMatch(/case 'bottom':/)
    expect(SOURCE).toMatch(/case 'front':/)
    expect(SOURCE).toMatch(/case 'back':/)
    expect(SOURCE).toMatch(/case 'right':/)
    expect(SOURCE).toMatch(/case 'left':/)
    expect(SOURCE).toMatch(/case 'iso':/)
  })

  it('declares the documented (1, 0.75, 1) iso direction vector', () => {
    expect(SOURCE).toMatch(/new THREE\.Vector3\(\s*1\s*,\s*0\.75\s*,\s*1\s*\)/)
  })

  it('uses performance.now() (not Date.now()) for animation start-time', () => {
    expect(SOURCE).toMatch(/performance\.now\s*\(\s*\)/)
    expect(SOURCE).not.toMatch(/Date\.now\s*\(\s*\)/)
  })

  it('tickCameraAnimation uses lerpVectors on position + up + target (all three lerped)', () => {
    expect(SOURCE).toMatch(/outPos\.lerpVectors\(/)
    expect(SOURCE).toMatch(/outUp\.lerpVectors\([^)]*\)\.normalize\(\)/)
    expect(SOURCE).toMatch(/outTarget\.lerpVectors\(/)
  })

  it('smoothstep is documented as cubic Hermite / smoothstep (3t^2 - 2t^3)', () => {
    expect(SOURCE).toMatch(/c\s*\*\s*c\s*\*\s*\(\s*3\s*-\s*2\s*\*\s*c\s*\)/)
  })

  it('declares all five exports with the `export function` keyword (or `export type`)', () => {
    expect(SOURCE).toMatch(/export function computeStandardViewGoal\(/)
    expect(SOURCE).toMatch(/export function createInactiveAnimation\(/)
    expect(SOURCE).toMatch(/export function startCameraAnimation\(/)
    expect(SOURCE).toMatch(/export function smoothstep\(/)
    expect(SOURCE).toMatch(/export function tickCameraAnimation\(/)
  })

  it('exports the three documented type symbols (StandardView, CameraGoal, CameraAnimationState)', () => {
    expect(SOURCE).toMatch(/export type StandardView\b/)
    expect(SOURCE).toMatch(/export interface CameraGoal\b/)
    expect(SOURCE).toMatch(/export interface CameraAnimationState\b/)
  })

  it('does NOT emit any G-code / M-code / spindle-control text (renderer-side, no machine output)', () => {
    expect(SOURCE).not.toMatch(/\bG0[0-9]\b/)
    expect(SOURCE).not.toMatch(/\bM0[0-9]\b/)
    expect(SOURCE).not.toMatch(/spindle/i)
  })

  it('source file is under 200 lines (the ui-polish slot expects compact pure helpers)', () => {
    const lineCount = SOURCE.split('\n').length
    expect(lineCount).toBeLessThan(200)
  })

  it('contains no TODO / FIXME / HACK markers (clean surface)', () => {
    expect(SOURCE).not.toMatch(/\bTODO\b/)
    expect(SOURCE).not.toMatch(/\bFIXME\b/)
    expect(SOURCE).not.toMatch(/\bHACK\b/)
  })
})

// ---------------------------------------------------------------------------
// I. Three-machine cross-cut realism
// ---------------------------------------------------------------------------
describe('I. Three-machine cross-cut realism (renderer shared)', () => {
  it('K2 Plus 350 mm cube top-down view: camera floor of 80 mm clears the heated bed', () => {
    // K2 Plus build envelope is 350x350x350; user re-targets a small object
    // at the bed center -> the camera must NOT collide with the bed.
    const target = new THREE.Vector3(175, 0, 175)
    const closePos = new THREE.Vector3(175, 5, 175)
    const g = computeStandardViewGoal(closePos, target, 'top')
    const dist = g.position.distanceTo(g.target)
    expect(dist).toBeGreaterThanOrEqual(80 - 1e-6)
    expect(g.up.z).toBeCloseTo(-1, 5)
  })

  it('Laguna Swift 5x10 sheet 1524x3048 mm: iso camera lands at +X / +Y / +Z corner', () => {
    const target = new THREE.Vector3(762, 0, 1524) // sheet center
    const farPos = new THREE.Vector3(2000, 1500, 3000)
    const g = computeStandardViewGoal(farPos, target, 'iso')
    expect(g.position.x).toBeGreaterThan(target.x)
    expect(g.position.y).toBeGreaterThan(target.y)
    expect(g.position.z).toBeGreaterThan(target.z)
    expect(g.up.y).toBeCloseTo(1, 5)
  })

  it('Carvera 3-axis 360x240 stock: front view camera lands on +Z relative to part center', () => {
    const target = new THREE.Vector3(180, 0, 120)
    const startPos = new THREE.Vector3(0, 200, 500)
    const g = computeStandardViewGoal(startPos, target, 'front')
    expect(g.position.z).toBeGreaterThan(target.z)
    expect(Math.abs(g.position.x - target.x)).toBeLessThan(1e-3)
    expect(Math.abs(g.position.y - target.y)).toBeLessThan(1e-3)
  })

  it('Carvera 4-axis 50 mm rotary bar: min-distance floor of 80 protects from camera-inside-stock', () => {
    // 4-axis rotary bar diameter ~50 mm; if the user clicks "right" with the
    // camera 10 mm from the part axis the floor MUST kick in.
    const target = new THREE.Vector3(100, 0, 0)
    const closePos = new THREE.Vector3(110, 0, 0) // 10 mm from target
    const g = computeStandardViewGoal(closePos, target, 'right')
    const dist = g.position.distanceTo(g.target)
    expect(dist).toBeGreaterThanOrEqual(80 - 1e-6)
  })

  it('view-preset hot-keys produce reproducible poses across all three target machines', () => {
    // Determinism across ALL seven presets at three representative shop scales.
    const setups: Array<[THREE.Vector3, THREE.Vector3, string]> = [
      [new THREE.Vector3(0, 200, 500), new THREE.Vector3(175, 0, 175), 'K2 Plus'],
      [new THREE.Vector3(2000, 1500, 3000), new THREE.Vector3(762, 0, 1524), 'Laguna 5x10'],
      [new THREE.Vector3(0, 200, 500), new THREE.Vector3(180, 0, 120), 'Carvera 3-axis']
    ]
    for (const [pos, target] of setups) {
      for (const p of ALL_PRESETS) {
        const a = computeStandardViewGoal(pos, target, p)
        const b = computeStandardViewGoal(pos, target, p)
        expect(a.position.x).toBeCloseTo(b.position.x, 8)
        expect(a.position.y).toBeCloseTo(b.position.y, 8)
        expect(a.position.z).toBeCloseTo(b.position.z, 8)
        expect(a.up.x).toBeCloseTo(b.up.x, 8)
        expect(a.up.y).toBeCloseTo(b.up.y, 8)
        expect(a.up.z).toBeCloseTo(b.up.z, 8)
      }
    }
  })

  it('animation duration default of 400 ms matches the documented Fusion-360-style fly-to', () => {
    // Default animation duration is sized for a smooth ~6 frames at 60 Hz +
    // a couple ease-out frames. Locking the default here protects against
    // accidental "feels different" UX regressions across the four shop
    // environment quick-switches.
    const s = createInactiveAnimation()
    expect(s.durationMs).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// J. Type-level parity -- compile-time type pins
// ---------------------------------------------------------------------------
describe('J. Type-level parity -- compile-time type pins', () => {
  it('StandardView is the seven-string union (compile-time pin)', () => {
    const presets: StandardView[] = ['top', 'bottom', 'front', 'back', 'right', 'left', 'iso']
    expect(presets.length).toBe(7)
    // Each value must round-trip through the function without a TS error.
    for (const p of presets) {
      expect(typeof computeStandardViewGoal(
        new THREE.Vector3(100, 100, 100),
        new THREE.Vector3(),
        p
      )).toBe('object')
    }
  })

  it('CameraGoal is { position, up, target } each Vector3', () => {
    const g: CameraGoal = computeStandardViewGoal(
      new THREE.Vector3(100, 100, 100),
      new THREE.Vector3(0, 0, 0),
      'iso'
    )
    expect(g.position).toBeInstanceOf(THREE.Vector3)
    expect(g.up).toBeInstanceOf(THREE.Vector3)
    expect(g.target).toBeInstanceOf(THREE.Vector3)
    expect(Object.keys(g).sort()).toEqual(['position', 'target', 'up'])
  })

  it('CameraAnimationState shape matches createInactiveAnimation()', () => {
    const s: CameraAnimationState = createInactiveAnimation()
    expect(typeof s.active).toBe('boolean')
    expect(typeof s.startTime).toBe('number')
    expect(typeof s.durationMs).toBe('number')
    expect(s.fromPos).toBeInstanceOf(THREE.Vector3)
    expect(s.fromUp).toBeInstanceOf(THREE.Vector3)
    expect(s.fromTarget).toBeInstanceOf(THREE.Vector3)
    expect(s.toPos).toBeInstanceOf(THREE.Vector3)
    expect(s.toUp).toBeInstanceOf(THREE.Vector3)
    expect(s.toTarget).toBeInstanceOf(THREE.Vector3)
  })

  it('tickCameraAnimation returns boolean (not void / undefined)', () => {
    const s = createInactiveAnimation()
    const ret = tickCameraAnimation(
      s,
      0,
      new THREE.Vector3(),
      new THREE.Vector3(),
      new THREE.Vector3()
    )
    expect(typeof ret).toBe('boolean')
  })

  it('smoothstep returns a number', () => {
    expect(typeof smoothstep(0.5)).toBe('number')
  })

  it('source declares CameraGoal as an interface (not a type alias)', () => {
    expect(SOURCE).toMatch(/export interface CameraGoal\s*\{/)
    expect(SOURCE).toMatch(/export interface CameraAnimationState\s*\{/)
  })
})
