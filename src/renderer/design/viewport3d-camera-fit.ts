/**
 * Pure projection-toggle + fit-to-view math for the Design 3D viewport.
 *
 * Two professional-CAD table-stakes features live here:
 *
 * 1. ORTHOGRAPHIC ⇄ PERSPECTIVE equivalence — when the operator toggles
 *    projection the geometry must NOT jump in apparent size. With the
 *    react-three-fiber default orthographic frustum (left/right/top/bottom
 *    = ±viewport-px/2) the visible world height is `heightPx / zoom`; with a
 *    perspective camera at distance `d` and vertical fov `θ` it is
 *    `2·d·tan(θ/2)`. Equating the two gives the zoom⇄distance pair below —
 *    an exact round-trip (see `viewport3d-camera-fit.test.ts`).
 *
 * 2. FIT-TO-VIEW (zoom to extents) — frame the current geometry's bounding
 *    sphere along the CURRENT view direction (never a reset to home). In
 *    perspective the camera backs off to `paddedRadius / sin(halfAngle)`
 *    using the tighter of the vertical/horizontal half-angles; in
 *    orthographic the camera keeps its distance and the ZOOM is computed so
 *    the sphere fits the smaller viewport dimension.
 *
 * Everything here is pure (no React, no R3F) so the node vitest suite can
 * verify the math without a DOM. The sibling animation module
 * `viewport3d-camera-animate.ts` is intentionally untouched — its public
 * surface is pinned by [ID-0302]; this module only IMPORTS `smoothstep`
 * from it and adds an independent zoom-animation state for the
 * orthographic fit (position/up/target still animate through the existing
 * `CameraAnimationState`).
 */
import * as THREE from 'three'
import { smoothstep } from './viewport3d-camera-animate'

/** The two projection modes the Design viewport camera can be in. */
export type ProjectionMode = 'perspective' | 'orthographic'

/** Bounding sphere (world mm) of the currently displayed geometry. */
export interface FitBounds {
  center: THREE.Vector3
  radius: number
}

/** Padding factor applied to the bounding-sphere radius when framing. */
export const DEFAULT_FIT_MARGIN = 1.25

/**
 * Perspective fit-distance clamp (mm) — mirrors the OrbitControls
 * minDistance/maxDistance props in `Viewport3D.tsx` so a fit never parks
 * the camera somewhere the controls would immediately snap it out of.
 */
export const MIN_FIT_DISTANCE_MM = 6
export const MAX_FIT_DISTANCE_MM = 6000

/**
 * Orthographic camera clip planes (mm). Near is NEGATIVE (CAD convention):
 * geometry "behind" the camera plane still renders, so a projection swap at
 * close range never clips the model. Far matches the perspective far plane.
 */
export const ORTHO_CAMERA_NEAR_MM = -8000
export const ORTHO_CAMERA_FAR_MM = 8000

/** Defensive fov clamp — keeps tan() away from 0/∞ on garbage input. */
function clampFovDeg(fovDeg: number): number {
  if (!Number.isFinite(fovDeg)) return 45
  return Math.min(175, Math.max(1, fovDeg))
}

/**
 * Read the bounding sphere of the displayed geometry (world mm — the
 * Design viewport geometry is already world-placed). Returns `null` for a
 * missing geometry or a degenerate/non-finite sphere (empty scene, single
 * point, NaN vertices) so the caller can fall back to the home pose.
 */
export function readFitBounds(
  geometry: THREE.BufferGeometry | null | undefined
): FitBounds | null {
  if (!geometry) return null
  geometry.computeBoundingSphere()
  const sphere = geometry.boundingSphere
  if (!sphere) return null
  const r = sphere.radius
  if (!Number.isFinite(r) || r < 1e-6) return null
  const c = sphere.center
  if (!Number.isFinite(c.x) || !Number.isFinite(c.y) || !Number.isFinite(c.z)) return null
  return { center: c.clone(), radius: r }
}

/**
 * Orthographic zoom that reproduces the apparent scale of a perspective
 * camera at `distanceMm` with vertical `fovDeg`, for an R3F default ortho
 * frustum sized in viewport pixels: `zoom = heightPx / (2·d·tan(fov/2))`.
 */
export function orthoZoomForPerspectiveDistance(
  distanceMm: number,
  fovDeg: number,
  viewportHeightPx: number
): number {
  const d = Number.isFinite(distanceMm) && distanceMm > 1e-6 ? distanceMm : 1
  const h = Number.isFinite(viewportHeightPx) && viewportHeightPx > 0 ? viewportHeightPx : 1
  const halfFovRad = THREE.MathUtils.degToRad(clampFovDeg(fovDeg)) / 2
  return h / (2 * d * Math.tan(halfFovRad))
}

/**
 * Inverse of {@link orthoZoomForPerspectiveDistance}: the perspective
 * camera distance that reproduces the apparent scale of an orthographic
 * camera at `zoom`. Exact round-trip: `d → zoom → d`.
 */
export function perspectiveDistanceForOrthoZoom(
  zoom: number,
  fovDeg: number,
  viewportHeightPx: number
): number {
  const z = Number.isFinite(zoom) && zoom > 1e-9 ? zoom : 1
  const h = Number.isFinite(viewportHeightPx) && viewportHeightPx > 0 ? viewportHeightPx : 1
  const halfFovRad = THREE.MathUtils.degToRad(clampFovDeg(fovDeg)) / 2
  return h / (2 * z * Math.tan(halfFovRad))
}

/**
 * Orthographic zoom that fits a padded bounding-sphere radius (mm) into the
 * SMALLER viewport dimension: `zoom = heightPx · min(1, aspect) / (2·R)`.
 * (Visible world height is `heightPx / zoom`; width is `aspect·heightPx / zoom`.)
 */
export function orthoZoomToFitRadius(
  paddedRadiusMm: number,
  viewportHeightPx: number,
  aspect: number
): number {
  const r = Number.isFinite(paddedRadiusMm) && paddedRadiusMm > 1e-6 ? paddedRadiusMm : 1
  const h = Number.isFinite(viewportHeightPx) && viewportHeightPx > 0 ? viewportHeightPx : 1
  const a = Number.isFinite(aspect) && aspect > 1e-3 ? aspect : 1
  return (h * Math.min(1, a)) / (2 * r)
}

/** Everything the fit computation needs to know about the viewport. */
export interface FitViewOptions {
  projection: ProjectionMode
  /** Vertical fov (deg) of the perspective camera (used in perspective mode + the ortho home fallback). */
  fovDeg: number
  /** Viewport width / height. */
  aspect: number
  viewportHeightPx: number
  /** Home camera position — the empty-scene fallback pose. */
  homePosition: THREE.Vector3
  /** Bounding-sphere padding factor (default {@link DEFAULT_FIT_MARGIN}). */
  marginFactor?: number
}

/**
 * A camera pose goal plus an optional orthographic zoom. The
 * position/up/target trio is shape-compatible with the animate module's
 * `CameraGoal`, so it feeds `startCameraAnimation` directly; `zoom` is
 * `null` in perspective mode (camera.zoom untouched).
 */
export interface FitViewGoal {
  position: THREE.Vector3
  up: THREE.Vector3
  target: THREE.Vector3
  zoom: number | null
}

/**
 * Compute the fit-to-view camera goal: frame `bounds` along the CURRENT
 * view direction with sensible margin. Empty/degenerate bounds fall back to
 * the home pose (target at origin, Y up). Pure — the caller animates
 * toward the returned goal.
 */
export function computeFitViewGoal(
  bounds: FitBounds | null,
  currentPos: THREE.Vector3,
  currentUp: THREE.Vector3,
  currentTarget: THREE.Vector3,
  opts: FitViewOptions
): FitViewGoal {
  const margin =
    opts.marginFactor !== undefined && Number.isFinite(opts.marginFactor) && opts.marginFactor >= 1
      ? opts.marginFactor
      : DEFAULT_FIT_MARGIN

  if (!bounds) {
    // Empty scene → home pose. In ortho mode the zoom is chosen so the
    // apparent scale matches a perspective camera at the home distance.
    const home = opts.homePosition.clone()
    const homeDist = Math.max(home.length(), MIN_FIT_DISTANCE_MM)
    const zoom =
      opts.projection === 'orthographic'
        ? orthoZoomForPerspectiveDistance(homeDist, opts.fovDeg, opts.viewportHeightPx)
        : null
    return { position: home, up: new THREE.Vector3(0, 1, 0), target: new THREE.Vector3(0, 0, 0), zoom }
  }

  // Preserve the CURRENT view direction (never a reset to home).
  const dir = currentPos.clone().sub(currentTarget)
  if (dir.lengthSq() < 1e-10) dir.set(1, 0.75, 1) // degenerate pose → iso-ish direction
  dir.normalize()

  const up = currentUp.lengthSq() > 1e-12 ? currentUp.clone().normalize() : new THREE.Vector3(0, 1, 0)
  const center = bounds.center.clone()
  const paddedRadius = bounds.radius * margin
  const aspect = Number.isFinite(opts.aspect) && opts.aspect > 1e-3 ? opts.aspect : 1

  if (opts.projection === 'orthographic') {
    // Ortho image scale is zoom-driven — keep the current stand-off distance
    // (clamped to the controls' dolly range) and fit via zoom.
    const dist = Math.min(
      MAX_FIT_DISTANCE_MM,
      Math.max(currentPos.distanceTo(currentTarget), MIN_FIT_DISTANCE_MM)
    )
    return {
      position: center.clone().addScaledVector(dir, dist),
      up,
      target: center,
      zoom: orthoZoomToFitRadius(paddedRadius, opts.viewportHeightPx, aspect)
    }
  }

  // Perspective: back off far enough that the padded sphere fits the TIGHTER
  // of the vertical/horizontal half-angles (sin, not tan — spheres graze the
  // frustum planes, they don't sit on the target plane).
  const vHalf = THREE.MathUtils.degToRad(clampFovDeg(opts.fovDeg)) / 2
  const hHalf = Math.atan(Math.tan(vHalf) * aspect)
  const halfAngle = Math.min(vHalf, hHalf)
  const dist = Math.min(
    MAX_FIT_DISTANCE_MM,
    Math.max(paddedRadius / Math.sin(halfAngle), MIN_FIT_DISTANCE_MM)
  )
  return { position: center.clone().addScaledVector(dir, dist), up, target: center, zoom: null }
}

/**
 * Independent zoom animation for the orthographic fit — position/up/target
 * ride the existing `CameraAnimationState`; this state slerps `camera.zoom`
 * on the same 400 ms smoothstep clock. Stored in a ref, mutated in place.
 */
export interface ZoomAnimationState {
  active: boolean
  startTime: number
  durationMs: number
  fromZoom: number
  toZoom: number
}

export function createInactiveZoomAnimation(): ZoomAnimationState {
  return { active: false, startTime: 0, durationMs: 400, fromZoom: 1, toZoom: 1 }
}

/** Start a zoom animation. Mutates `state` in place (it lives in a ref). */
export function startZoomAnimation(
  state: ZoomAnimationState,
  fromZoom: number,
  toZoom: number,
  durationMs: number = 400
): void {
  state.active = true
  state.startTime = performance.now()
  state.durationMs = durationMs
  state.fromZoom = Number.isFinite(fromZoom) && fromZoom > 1e-9 ? fromZoom : 1
  state.toZoom = Number.isFinite(toZoom) && toZoom > 1e-9 ? toZoom : 1
}

/**
 * Tick the zoom animation. Returns the zoom to apply this frame, or `null`
 * when idle. On completion returns the exact goal zoom once and flips the
 * state inactive (subsequent ticks return `null`).
 */
export function tickZoomAnimation(state: ZoomAnimationState, now: number): number | null {
  if (!state.active) return null
  const rawT = state.durationMs > 0 ? (now - state.startTime) / state.durationMs : 1
  if (rawT >= 1) {
    state.active = false
    return state.toZoom
  }
  const t = smoothstep(rawT)
  return state.fromZoom + (state.toZoom - state.fromZoom) * t
}
