import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { applyStandardView } from './Viewport3D'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'

/**
 * Minimal OrbitControlsImpl stub — only the fields `applyStandardView` reads/writes.
 */
function makeControls(
  camPos: [number, number, number] = [120, 90, 120],
  target: [number, number, number] = [0, 0, 0]
): OrbitControlsImpl {
  const camera = new THREE.PerspectiveCamera()
  camera.position.set(...camPos)
  camera.up.set(0, 1, 0)

  const targetVec = new THREE.Vector3(...target)
  let updateCalled = false

  return {
    object: camera,
    target: targetVec,
    update: () => { updateCalled = true; void updateCalled }
  } as unknown as OrbitControlsImpl
}

const DIST_TOLERANCE = 1e-4
const DIR_TOLERANCE = 1e-4

describe('applyStandardView', () => {
  it('top view: positions camera above target with -Z up', () => {
    const controls = makeControls([120, 90, 120], [0, 0, 0])
    applyStandardView(controls, 'top')
    const cam = controls.object as THREE.PerspectiveCamera
    // Camera should be directly above the target on Y axis
    expect(Math.abs(cam.position.x - controls.target.x)).toBeLessThan(DIST_TOLERANCE)
    expect(Math.abs(cam.position.z - controls.target.z)).toBeLessThan(DIST_TOLERANCE)
    expect(cam.position.y).toBeGreaterThan(controls.target.y)
    // Up vector for top view is -Z (to maintain right-hand orientation)
    expect(Math.abs(cam.up.x)).toBeLessThan(DIR_TOLERANCE)
    expect(Math.abs(cam.up.y)).toBeLessThan(DIR_TOLERANCE)
    expect(cam.up.z).toBeCloseTo(-1, 5)
  })

  it('front view: positions camera in front of target (+Z), Y up', () => {
    const controls = makeControls([120, 90, 120], [0, 0, 0])
    applyStandardView(controls, 'front')
    const cam = controls.object as THREE.PerspectiveCamera
    expect(Math.abs(cam.position.x - controls.target.x)).toBeLessThan(DIST_TOLERANCE)
    expect(Math.abs(cam.position.y - controls.target.y)).toBeLessThan(DIST_TOLERANCE)
    expect(cam.position.z).toBeGreaterThan(controls.target.z)
    expect(cam.up.y).toBeCloseTo(1, 5)
  })

  it('back view: positions camera behind target (-Z), Y up', () => {
    const controls = makeControls([120, 90, 120], [0, 0, 0])
    applyStandardView(controls, 'back')
    const cam = controls.object as THREE.PerspectiveCamera
    expect(Math.abs(cam.position.x - controls.target.x)).toBeLessThan(DIST_TOLERANCE)
    expect(Math.abs(cam.position.y - controls.target.y)).toBeLessThan(DIST_TOLERANCE)
    expect(cam.position.z).toBeLessThan(controls.target.z)
  })

  it('right view: positions camera to the right of target (+X), Y up', () => {
    const controls = makeControls([120, 90, 120], [0, 0, 0])
    applyStandardView(controls, 'right')
    const cam = controls.object as THREE.PerspectiveCamera
    expect(cam.position.x).toBeGreaterThan(controls.target.x)
    expect(Math.abs(cam.position.y - controls.target.y)).toBeLessThan(DIST_TOLERANCE)
    expect(Math.abs(cam.position.z - controls.target.z)).toBeLessThan(DIST_TOLERANCE)
  })

  it('left view: positions camera to the left of target (-X), Y up', () => {
    const controls = makeControls([120, 90, 120], [0, 0, 0])
    applyStandardView(controls, 'left')
    const cam = controls.object as THREE.PerspectiveCamera
    expect(cam.position.x).toBeLessThan(controls.target.x)
    expect(Math.abs(cam.position.y - controls.target.y)).toBeLessThan(DIST_TOLERANCE)
    expect(Math.abs(cam.position.z - controls.target.z)).toBeLessThan(DIST_TOLERANCE)
  })

  it('iso view: positions camera at equal positive X/Z offset and positive Y, Y up', () => {
    const controls = makeControls([120, 90, 120], [0, 0, 0])
    applyStandardView(controls, 'iso')
    const cam = controls.object as THREE.PerspectiveCamera
    expect(cam.position.x).toBeGreaterThan(0)
    expect(cam.position.y).toBeGreaterThan(0)
    expect(cam.position.z).toBeGreaterThan(0)
    expect(cam.up.y).toBeCloseTo(1, 5)
  })

  it('iso view: camera distance from target is preserved', () => {
    const startPos: [number, number, number] = [120, 90, 120]
    const controls = makeControls(startPos, [0, 0, 0])
    const cam = controls.object as THREE.PerspectiveCamera
    const originalDist = cam.position.distanceTo(controls.target)
    applyStandardView(controls, 'iso')
    const newDist = cam.position.distanceTo(controls.target)
    expect(Math.abs(newDist - originalDist)).toBeLessThan(DIST_TOLERANCE)
  })

  it('front view: camera distance from target is preserved', () => {
    const controls = makeControls([120, 90, 120], [0, 0, 0])
    const cam = controls.object as THREE.PerspectiveCamera
    const originalDist = cam.position.distanceTo(controls.target)
    applyStandardView(controls, 'front')
    const newDist = cam.position.distanceTo(controls.target)
    expect(Math.abs(newDist - originalDist)).toBeLessThan(DIST_TOLERANCE)
  })

  it('top view: camera distance from target is preserved', () => {
    const controls = makeControls([120, 90, 120], [0, 0, 0])
    const cam = controls.object as THREE.PerspectiveCamera
    const originalDist = cam.position.distanceTo(controls.target)
    applyStandardView(controls, 'top')
    const newDist = cam.position.distanceTo(controls.target)
    expect(Math.abs(newDist - originalDist)).toBeLessThan(DIST_TOLERANCE)
  })

  it('works correctly when target is offset from origin', () => {
    const controls = makeControls([50, 20, 50], [10, 5, 10])
    applyStandardView(controls, 'right')
    const cam = controls.object as THREE.PerspectiveCamera
    // Camera should be to the right of the non-zero target
    expect(cam.position.x).toBeGreaterThan(controls.target.x)
    expect(Math.abs(cam.position.z - controls.target.z)).toBeLessThan(DIST_TOLERANCE)
  })

  it('enforces minimum distance of 80mm when camera is very close', () => {
    // Place camera very close (dist < 80 → should be clamped to 80)
    const controls = makeControls([5, 0, 0], [0, 0, 0])
    applyStandardView(controls, 'front')
    const cam = controls.object as THREE.PerspectiveCamera
    const dist = cam.position.distanceTo(controls.target)
    expect(dist).toBeGreaterThanOrEqual(80 - DIST_TOLERANCE)
  })
})
