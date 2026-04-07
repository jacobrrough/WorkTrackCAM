/**
 * Smooth camera transition utility for the 3D viewport.
 *
 * Instead of instantly snapping, the camera position/target/up are interpolated
 * over `durationMs` using spherical-linear-interpolation (slerp for orientation)
 * and vector lerp (for position), giving a smooth Fusion-360-style fly-to effect.
 */
import * as THREE from 'three'

export type StandardView = 'top' | 'front' | 'back' | 'right' | 'left' | 'bottom' | 'iso'

export interface CameraGoal {
  position: THREE.Vector3
  up: THREE.Vector3
  target: THREE.Vector3
}

/**
 * Compute the final camera pose for a given standard view preset.
 * Pure function — no side effects; caller animates toward the returned goal.
 */
export function computeStandardViewGoal(
  currentPos: THREE.Vector3,
  currentTarget: THREE.Vector3,
  preset: StandardView
): CameraGoal {
  const dist = Math.max(80, currentPos.distanceTo(currentTarget))
  const t = currentTarget.clone()

  const goal: CameraGoal = {
    position: new THREE.Vector3(),
    up: new THREE.Vector3(0, 1, 0),
    target: t
  }

  switch (preset) {
    case 'top':
      goal.position.set(t.x, t.y + dist, t.z)
      goal.up.set(0, 0, -1)
      break
    case 'bottom':
      goal.position.set(t.x, t.y - dist, t.z)
      goal.up.set(0, 0, 1)
      break
    case 'front':
      goal.position.set(t.x, t.y, t.z + dist)
      break
    case 'back':
      goal.position.set(t.x, t.y, t.z - dist)
      break
    case 'right':
      goal.position.set(t.x + dist, t.y, t.z)
      break
    case 'left':
      goal.position.set(t.x - dist, t.y, t.z)
      break
    case 'iso': {
      const d = new THREE.Vector3(1, 0.75, 1).normalize().multiplyScalar(dist)
      goal.position.set(t.x + d.x, t.y + d.y, t.z + d.z)
      break
    }
  }

  return goal
}

/** Active animation state — stored as a ref in the React component. */
export interface CameraAnimationState {
  active: boolean
  startTime: number
  durationMs: number
  fromPos: THREE.Vector3
  fromUp: THREE.Vector3
  fromTarget: THREE.Vector3
  toPos: THREE.Vector3
  toUp: THREE.Vector3
  toTarget: THREE.Vector3
}

export function createInactiveAnimation(): CameraAnimationState {
  return {
    active: false,
    startTime: 0,
    durationMs: 400,
    fromPos: new THREE.Vector3(),
    fromUp: new THREE.Vector3(0, 1, 0),
    fromTarget: new THREE.Vector3(),
    toPos: new THREE.Vector3(),
    toUp: new THREE.Vector3(0, 1, 0),
    toTarget: new THREE.Vector3()
  }
}

/**
 * Start a new fly-to animation.
 * Mutates `state` in place (it's stored as a ref).
 */
export function startCameraAnimation(
  state: CameraAnimationState,
  currentPos: THREE.Vector3,
  currentUp: THREE.Vector3,
  currentTarget: THREE.Vector3,
  goal: CameraGoal,
  durationMs: number = 400
): void {
  state.active = true
  state.startTime = performance.now()
  state.durationMs = durationMs
  state.fromPos.copy(currentPos)
  state.fromUp.copy(currentUp)
  state.fromTarget.copy(currentTarget)
  state.toPos.copy(goal.position)
  state.toUp.copy(goal.up)
  state.toTarget.copy(goal.target)
}

/**
 * Smooth ease-in-out curve (cubic Hermite / smoothstep).
 */
export function smoothstep(t: number): number {
  const c = Math.max(0, Math.min(1, t))
  return c * c * (3 - 2 * c)
}

/**
 * Tick the animation forward.  Returns `true` while the animation is still active.
 * Writes directly into `outPos`, `outUp`, `outTarget`.
 */
export function tickCameraAnimation(
  state: CameraAnimationState,
  now: number,
  outPos: THREE.Vector3,
  outUp: THREE.Vector3,
  outTarget: THREE.Vector3
): boolean {
  if (!state.active) return false

  const elapsed = now - state.startTime
  const rawT = state.durationMs > 0 ? elapsed / state.durationMs : 1
  const t = smoothstep(Math.min(1, rawT))

  outPos.lerpVectors(state.fromPos, state.toPos, t)
  outUp.lerpVectors(state.fromUp, state.toUp, t).normalize()
  outTarget.lerpVectors(state.fromTarget, state.toTarget, t)

  if (rawT >= 1) {
    state.active = false
    outPos.copy(state.toPos)
    outUp.copy(state.toUp).normalize()
    outTarget.copy(state.toTarget)
  }

  return true
}
