/**
 * CameraAnimator — a zero-render component placed inside the R3F Canvas
 * that drives smooth camera fly-to transitions via useFrame.
 */
import { useFrame, useThree } from '@react-three/fiber'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import * as THREE from 'three'
import type { CameraAnimationState } from './viewport3d-camera-animate'
import { tickCameraAnimation } from './viewport3d-camera-animate'

const _pos = new THREE.Vector3()
const _up = new THREE.Vector3()
const _target = new THREE.Vector3()

type Props = {
  animRef: React.RefObject<CameraAnimationState>
  controlsRef: React.RefObject<OrbitControlsImpl | null>
}

/**
 * Runs every frame.  When an animation is active it interpolates the camera
 * and orbit-controls target, then calls `controls.update()`.  When idle this
 * is effectively a no-op (the `active` check is O(1)).
 */
export function CameraAnimator({ animRef, controlsRef }: Props) {
  const { camera } = useThree()

  useFrame(() => {
    const state = animRef.current
    if (!state || !state.active) return

    const controls = controlsRef.current
    if (!controls) return

    const cam = camera as THREE.PerspectiveCamera
    const now = performance.now()

    const running = tickCameraAnimation(state, now, _pos, _up, _target)
    if (!running) return

    cam.position.copy(_pos)
    cam.up.copy(_up)
    controls.target.copy(_target)
    cam.lookAt(_target)
    controls.update()
  })

  return null
}
