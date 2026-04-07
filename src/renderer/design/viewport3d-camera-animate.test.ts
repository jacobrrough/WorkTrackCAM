import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  computeStandardViewGoal,
  createInactiveAnimation,
  smoothstep,
  startCameraAnimation,
  tickCameraAnimation,
  type CameraAnimationState,
  type CameraGoal
} from './viewport3d-camera-animate'

const TOLERANCE = 1e-4

// ── computeStandardViewGoal ──────────────────────────────────────────────────

describe('computeStandardViewGoal', () => {
  const origin = new THREE.Vector3(0, 0, 0)
  const startPos = new THREE.Vector3(120, 90, 120)

  it('top: places camera directly above target with -Z up', () => {
    const g = computeStandardViewGoal(startPos, origin, 'top')
    expect(Math.abs(g.position.x - origin.x)).toBeLessThan(TOLERANCE)
    expect(g.position.y).toBeGreaterThan(origin.y)
    expect(Math.abs(g.position.z - origin.z)).toBeLessThan(TOLERANCE)
    expect(g.up.z).toBeCloseTo(-1, 5)
  })

  it('bottom: places camera directly below target with +Z up', () => {
    const g = computeStandardViewGoal(startPos, origin, 'bottom')
    expect(Math.abs(g.position.x - origin.x)).toBeLessThan(TOLERANCE)
    expect(g.position.y).toBeLessThan(origin.y)
    expect(Math.abs(g.position.z - origin.z)).toBeLessThan(TOLERANCE)
    expect(g.up.z).toBeCloseTo(1, 5)
  })

  it('front: places camera on +Z axis, Y up', () => {
    const g = computeStandardViewGoal(startPos, origin, 'front')
    expect(Math.abs(g.position.x)).toBeLessThan(TOLERANCE)
    expect(Math.abs(g.position.y)).toBeLessThan(TOLERANCE)
    expect(g.position.z).toBeGreaterThan(0)
    expect(g.up.y).toBeCloseTo(1, 5)
  })

  it('back: places camera on -Z axis, Y up', () => {
    const g = computeStandardViewGoal(startPos, origin, 'back')
    expect(Math.abs(g.position.x)).toBeLessThan(TOLERANCE)
    expect(Math.abs(g.position.y)).toBeLessThan(TOLERANCE)
    expect(g.position.z).toBeLessThan(0)
    expect(g.up.y).toBeCloseTo(1, 5)
  })

  it('right: places camera on +X axis, Y up', () => {
    const g = computeStandardViewGoal(startPos, origin, 'right')
    expect(g.position.x).toBeGreaterThan(0)
    expect(Math.abs(g.position.y)).toBeLessThan(TOLERANCE)
    expect(Math.abs(g.position.z)).toBeLessThan(TOLERANCE)
    expect(g.up.y).toBeCloseTo(1, 5)
  })

  it('left: places camera on -X axis, Y up', () => {
    const g = computeStandardViewGoal(startPos, origin, 'left')
    expect(g.position.x).toBeLessThan(0)
    expect(Math.abs(g.position.y)).toBeLessThan(TOLERANCE)
    expect(Math.abs(g.position.z)).toBeLessThan(TOLERANCE)
    expect(g.up.y).toBeCloseTo(1, 5)
  })

  it('iso: places camera at positive X/Y/Z', () => {
    const g = computeStandardViewGoal(startPos, origin, 'iso')
    expect(g.position.x).toBeGreaterThan(0)
    expect(g.position.y).toBeGreaterThan(0)
    expect(g.position.z).toBeGreaterThan(0)
    expect(g.up.y).toBeCloseTo(1, 5)
  })

  it('preserves distance from camera to target', () => {
    const dist = startPos.distanceTo(origin)
    for (const preset of ['top', 'front', 'back', 'right', 'left', 'iso', 'bottom'] as const) {
      const g = computeStandardViewGoal(startPos, origin, preset)
      const goalDist = g.position.distanceTo(g.target)
      expect(Math.abs(goalDist - dist)).toBeLessThan(TOLERANCE)
    }
  })

  it('enforces minimum distance of 80', () => {
    const closePos = new THREE.Vector3(5, 0, 0)
    const g = computeStandardViewGoal(closePos, origin, 'front')
    const dist = g.position.distanceTo(g.target)
    expect(dist).toBeGreaterThanOrEqual(80 - TOLERANCE)
  })

  it('works with non-zero target', () => {
    const target = new THREE.Vector3(10, 5, -3)
    const pos = new THREE.Vector3(50, 20, 30)
    const g = computeStandardViewGoal(pos, target, 'right')
    expect(g.position.x).toBeGreaterThan(target.x)
    expect(Math.abs(g.position.y - target.y)).toBeLessThan(TOLERANCE)
    expect(Math.abs(g.position.z - target.z)).toBeLessThan(TOLERANCE)
    expect(g.target.x).toBeCloseTo(target.x, 5)
    expect(g.target.y).toBeCloseTo(target.y, 5)
    expect(g.target.z).toBeCloseTo(target.z, 5)
  })
})

// ── smoothstep ───────────────────────────────────────────────────────────────

describe('smoothstep', () => {
  it('returns 0 at t=0', () => {
    expect(smoothstep(0)).toBeCloseTo(0, 10)
  })

  it('returns 1 at t=1', () => {
    expect(smoothstep(1)).toBeCloseTo(1, 10)
  })

  it('returns 0.5 at t=0.5', () => {
    expect(smoothstep(0.5)).toBeCloseTo(0.5, 10)
  })

  it('clamps negative values to 0', () => {
    expect(smoothstep(-0.5)).toBeCloseTo(0, 10)
  })

  it('clamps values > 1 to 1', () => {
    expect(smoothstep(1.5)).toBeCloseTo(1, 10)
  })

  it('is monotonically increasing between 0 and 1', () => {
    let prev = smoothstep(0)
    for (let t = 0.01; t <= 1.0; t += 0.01) {
      const cur = smoothstep(t)
      expect(cur).toBeGreaterThanOrEqual(prev - 1e-10)
      prev = cur
    }
  })
})

// ── Animation lifecycle ──────────────────────────────────────────────────────

describe('CameraAnimationState lifecycle', () => {
  it('createInactiveAnimation returns an inactive state', () => {
    const s = createInactiveAnimation()
    expect(s.active).toBe(false)
  })

  it('startCameraAnimation activates the state', () => {
    const s = createInactiveAnimation()
    const from = new THREE.Vector3(100, 50, 100)
    const up = new THREE.Vector3(0, 1, 0)
    const target = new THREE.Vector3(0, 0, 0)
    const goal: CameraGoal = {
      position: new THREE.Vector3(0, 100, 0),
      up: new THREE.Vector3(0, 0, -1),
      target: new THREE.Vector3(0, 0, 0)
    }
    startCameraAnimation(s, from, up, target, goal, 500)
    expect(s.active).toBe(true)
    expect(s.durationMs).toBe(500)
    expect(s.toPos.y).toBeCloseTo(100, 5)
    expect(s.toUp.z).toBeCloseTo(-1, 5)
  })

  it('tickCameraAnimation returns false when inactive', () => {
    const s = createInactiveAnimation()
    const pos = new THREE.Vector3()
    const up = new THREE.Vector3()
    const target = new THREE.Vector3()
    expect(tickCameraAnimation(s, 0, pos, up, target)).toBe(false)
  })
})

describe('tickCameraAnimation interpolation', () => {
  function makeAnim(): CameraAnimationState {
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
      1000
    )
    return s
  }

  it('interpolates position at midpoint', () => {
    const s = makeAnim()
    const t0 = s.startTime
    const pos = new THREE.Vector3()
    const up = new THREE.Vector3()
    const target = new THREE.Vector3()

    tickCameraAnimation(s, t0 + 500, pos, up, target)
    // At t=0.5, smoothstep(0.5) = 0.5 — halfway between (0,0,100) and (0,100,0)
    expect(pos.y).toBeCloseTo(50, 0)
    expect(pos.z).toBeCloseTo(50, 0)
    expect(s.active).toBe(true)
  })

  it('snaps to goal position when animation completes', () => {
    const s = makeAnim()
    const t0 = s.startTime
    const pos = new THREE.Vector3()
    const up = new THREE.Vector3()
    const target = new THREE.Vector3()

    tickCameraAnimation(s, t0 + 1100, pos, up, target)
    // Past duration — should snap to goal
    expect(pos.x).toBeCloseTo(0, 5)
    expect(pos.y).toBeCloseTo(100, 5)
    expect(pos.z).toBeCloseTo(0, 5)
    expect(up.z).toBeCloseTo(-1, 1)
    expect(s.active).toBe(false)
  })

  it('returns true while animation is running', () => {
    const s = makeAnim()
    const t0 = s.startTime
    const pos = new THREE.Vector3()
    const up = new THREE.Vector3()
    const target = new THREE.Vector3()

    expect(tickCameraAnimation(s, t0 + 100, pos, up, target)).toBe(true)
    expect(tickCameraAnimation(s, t0 + 500, pos, up, target)).toBe(true)
    // Complete it
    tickCameraAnimation(s, t0 + 1100, pos, up, target)
    // Now inactive — should return false
    expect(tickCameraAnimation(s, t0 + 2000, pos, up, target)).toBe(false)
  })

  it('at t=0 output equals fromPos', () => {
    const s = makeAnim()
    const t0 = s.startTime
    const pos = new THREE.Vector3()
    const up = new THREE.Vector3()
    const target = new THREE.Vector3()

    tickCameraAnimation(s, t0, pos, up, target)
    expect(pos.x).toBeCloseTo(0, 5)
    expect(pos.y).toBeCloseTo(0, 5)
    expect(pos.z).toBeCloseTo(100, 5)
  })

  it('handles zero duration (instant snap)', () => {
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
      0
    )
    const pos = new THREE.Vector3()
    const up = new THREE.Vector3()
    const target = new THREE.Vector3()

    tickCameraAnimation(s, s.startTime, pos, up, target)
    expect(pos.y).toBeCloseTo(100, 5)
    expect(s.active).toBe(false)
  })
})
