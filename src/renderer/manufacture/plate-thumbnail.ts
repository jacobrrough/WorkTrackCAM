/**
 * plate-thumbnail -- pure helpers that turn a Three.js Mesh (or
 * BufferGeometry) into a 120x80 PNG data-URL, used by `PlateTabs.tsx`
 * to replace the original colored-rect placeholder strip with real
 * 3D-preview thumbnails (UX Move #7).
 *
 * Why a separate module:
 *   - Keeping the offscreen-render logic out of the React component
 *     means `PlateTabs` stays declarative and easy to render-pin.
 *   - The parent (`ManufactureWorkspace`) is free to compute, cache,
 *     and pass the data-URL down without forcing a re-render storm.
 *
 * Runtime contract:
 *   - On a real renderer (Chromium / Electron) we synthesize an
 *     `OffscreenCanvas`-backed `WebGLRenderer` + `OrthographicCamera`
 *     scene, frame the mesh bounds, draw it once, snapshot via
 *     `toDataURL('image/png')`, and dispose everything.
 *   - In the vitest `node` environment `OffscreenCanvas` and WebGL
 *     are unavailable. The helper detects this via a feature-test
 *     and returns `null` with a documented reason, so the test
 *     suite is deterministic and the parent component shows its
 *     placeholder fallback. Most of the test coverage lives in
 *     `PlateTabs.test.tsx` exercising that fallback path.
 *
 * V3 follow-up: move the offscreen render into a Web Worker so the
 * main renderer thread never blocks on plate-strip refreshes. The
 * cache keys here are already worker-safe (string hashes), so the
 * migration is mechanical.
 *
 * STRICT 3-machine scope (CLAUDE.md): the thumbnail is purely a UI
 * affordance; it never emits G-code, touches the Moonraker upload
 * path, or hits the Carvera 4th-axis post. The same helper renders
 * meshes destined for K2 Plus FDM, Laguna Swift 5x10 routing, and
 * Carvera 3-axis + 4-axis CNC equally -- it's geometry-only.
 */

import * as THREE from 'three'

/** Output thumbnail width in CSS pixels (matches `.plate-thumb__preview`). */
export const THUMBNAIL_WIDTH_PX = 120

/** Output thumbnail height in CSS pixels (matches `.plate-thumb__preview`). */
export const THUMBNAIL_HEIGHT_PX = 80

/** Padding around the framed mesh as a fraction of bounding-box size. */
const FRAME_PADDING_FRACTION = 0.15

/** Camera direction (isometric-ish) so all 3 dimensions show up. */
const CAMERA_DIRECTION = new THREE.Vector3(1, 1, 1).normalize()

/** Mesh diffuse color (matches `--accent` from `tokens.css`). */
const MESH_COLOR = 0x3b82f6

/** Background clear color (matches `--surface-0` from `tokens.css`). */
const BG_COLOR = 0x1a1a1f

/** Background clear alpha (transparent so CSS gradient bleeds through). */
const BG_ALPHA = 0

/**
 * Reason `renderPlateThumbnail` returned `null`. Surfaced for the
 * unit tests and (eventually) renderer-side telemetry.
 */
export type PlateThumbnailFailureReason =
  | 'no-geometry'
  | 'no-offscreen-canvas'
  | 'no-webgl-context'
  | 'empty-bounding-box'
  | 'renderer-threw'

/**
 * Inputs accepted by `renderPlateThumbnail`. The plate state can hold
 * either a Three.js `Mesh` (preferred) or a bare `BufferGeometry`; we
 * normalise both.
 */
export type PlateThumbnailSource = THREE.Mesh | THREE.BufferGeometry | null | undefined

/**
 * Stable feature-test for the offscreen-render path. Exported so
 * tests can assert the documented branch.
 */
export function offscreenRenderingAvailable(): boolean {
  return typeof OffscreenCanvas !== 'undefined'
}

/**
 * Cache from geometry hash -> data-URL. Keyed by a stable string so a
 * V3 Web-Worker migration only needs to swap the hashing function.
 */
const thumbnailCache = new Map<string, string>()

/** Internal: drop the cache (used by tests). */
export function _clearPlateThumbnailCacheForTests(): void {
  thumbnailCache.clear()
}

/** Current cache size for diagnostics. */
export function plateThumbnailCacheSize(): number {
  return thumbnailCache.size
}

/**
 * Build a stable, cheap hash of a BufferGeometry by sampling the
 * position attribute. Full-mesh hashing is not required (a 60x120"
 * plywood preview can carry hundreds of thousands of vertices); a
 * 32-sample fingerprint is enough to disambiguate plate switches.
 */
export function hashGeometryForCache(geom: THREE.BufferGeometry): string {
  const pos = geom.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!pos) return 'no-position'
  const arr = pos.array as ArrayLike<number>
  const count = arr.length
  if (count === 0) return 'empty'
  const sampleCount = Math.min(32, count)
  const stride = Math.max(1, Math.floor(count / sampleCount))
  let h = 2166136261 // FNV-1a 32-bit offset basis
  for (let i = 0; i < count; i += stride) {
    // Round to 4 decimal places (mm precision is overkill for cache disambiguation).
    const v = Math.round((arr[i] ?? 0) * 1e4)
    h ^= v
    h = Math.imul(h, 16777619)
  }
  // Mix in vertex count + index count so two different meshes that
  // share the same sampled prefix don't collide.
  h ^= count
  h = Math.imul(h, 16777619)
  const index = geom.getIndex()
  if (index) {
    h ^= index.count
    h = Math.imul(h, 16777619)
  }
  return `g${(h >>> 0).toString(36)}-${count}`
}

/** Normalise input to a BufferGeometry, or null. */
function geometryFromSource(src: PlateThumbnailSource): THREE.BufferGeometry | null {
  if (!src) return null
  if (src instanceof THREE.BufferGeometry) return src
  if (src instanceof THREE.Mesh) {
    const g = src.geometry
    if (g instanceof THREE.BufferGeometry) return g
  }
  return null
}

/**
 * Frame an OrthographicCamera so it sees the entire bounding box with
 * the documented padding. Mutates the camera in-place.
 */
export function fitCameraToBounds(
  camera: THREE.OrthographicCamera,
  bbox: THREE.Box3,
  widthPx: number,
  heightPx: number
): void {
  const size = new THREE.Vector3()
  bbox.getSize(size)
  const center = new THREE.Vector3()
  bbox.getCenter(center)

  // Project onto the camera plane: the diagonal of the bbox is the
  // worst-case extent we need to fit.
  const extent = Math.max(size.x, size.y, size.z)
  const padded = extent * (1 + FRAME_PADDING_FRACTION * 2)
  const aspect = widthPx / heightPx

  // Symmetric ortho frustum centred on the bbox.
  const halfH = padded / 2
  const halfW = halfH * aspect
  camera.left = -halfW
  camera.right = halfW
  camera.top = halfH
  camera.bottom = -halfH
  camera.near = 0.1
  camera.far = padded * 8 + 100

  // Position the camera back along CAMERA_DIRECTION far enough to
  // clear the far plane while keeping the bbox centred.
  const dist = padded * 2 + 10
  camera.position.copy(center).addScaledVector(CAMERA_DIRECTION, dist)
  camera.lookAt(center)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld()
}

/**
 * Render the supplied mesh/geometry to a 120x80 PNG data-URL.
 *
 * Returns `null` (with the failure reason in `failure` when supplied)
 * if the environment cannot render -- the parent component falls back
 * to the colored-rect placeholder. Cached by sampled geometry hash so
 * re-renders on plate switches are O(1) lookups.
 *
 * @param src     Three.js Mesh OR BufferGeometry (whichever the plate state holds).
 * @param opts    Optional override of cache key (for non-geometry-keyed callers).
 */
export function renderPlateThumbnail(
  src: PlateThumbnailSource,
  opts?: { cacheKey?: string; widthPx?: number; heightPx?: number; failure?: { reason?: PlateThumbnailFailureReason } }
): string | null {
  const failureSink = opts?.failure
  const geom = geometryFromSource(src)
  if (!geom) {
    if (failureSink) failureSink.reason = 'no-geometry'
    return null
  }
  if (!offscreenRenderingAvailable()) {
    if (failureSink) failureSink.reason = 'no-offscreen-canvas'
    return null
  }

  const widthPx = opts?.widthPx ?? THUMBNAIL_WIDTH_PX
  const heightPx = opts?.heightPx ?? THUMBNAIL_HEIGHT_PX
  const cacheKey = opts?.cacheKey ?? `${hashGeometryForCache(geom)}-${widthPx}x${heightPx}`
  const cached = thumbnailCache.get(cacheKey)
  if (cached) return cached

  geom.computeBoundingBox()
  const bbox = geom.boundingBox
  if (!bbox || !Number.isFinite(bbox.min.x) || !Number.isFinite(bbox.max.x)) {
    if (failureSink) failureSink.reason = 'empty-bounding-box'
    return null
  }

  try {
    const canvas = new OffscreenCanvas(widthPx, heightPx)
    const renderer = new THREE.WebGLRenderer({
      canvas: canvas as unknown as HTMLCanvasElement,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true
    })
    renderer.setSize(widthPx, heightPx, false)
    renderer.setClearColor(BG_COLOR, BG_ALPHA)

    const scene = new THREE.Scene()

    // Three-point lighting so the mesh has visible shading at any
    // orientation. Cheap to evaluate per frame.
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.2)
    keyLight.position.set(1, 2, 2)
    scene.add(keyLight)
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.6)
    fillLight.position.set(-2, -1, 1)
    scene.add(fillLight)
    const ambient = new THREE.AmbientLight(0xffffff, 0.3)
    scene.add(ambient)

    const material = new THREE.MeshStandardMaterial({
      color: MESH_COLOR,
      roughness: 0.6,
      metalness: 0.1,
      flatShading: false
    })
    const mesh = new THREE.Mesh(geom, material)
    scene.add(mesh)

    const camera = new THREE.OrthographicCamera()
    fitCameraToBounds(camera, bbox, widthPx, heightPx)

    renderer.render(scene, camera)

    // `convertToBlob` is preferred but async; we want a synchronous
    // dataURL so the React parent can hand it straight to <img src>.
    // Most modern Chromium/Electron releases support `toDataURL` on
    // OffscreenCanvas via the 2D context path; if it's missing, fall
    // back to a transferable image-bitmap blob URL is overkill for a
    // 120x80 thumbnail, so we just return null and let the placeholder
    // handle the rare miss.
    const canvasAsHTML = canvas as unknown as { toDataURL?: (mime: string) => string }
    let dataUrl: string | null = null
    if (typeof canvasAsHTML.toDataURL === 'function') {
      dataUrl = canvasAsHTML.toDataURL('image/png')
    }

    // Dispose everything to avoid leaking GL contexts across plate switches.
    material.dispose()
    renderer.dispose()
    // We intentionally do NOT dispose `geom` -- it belongs to the caller
    // and may still be rendered in the main viewport.

    if (!dataUrl) {
      if (failureSink) failureSink.reason = 'no-webgl-context'
      return null
    }

    thumbnailCache.set(cacheKey, dataUrl)
    return dataUrl
  } catch {
    if (failureSink) failureSink.reason = 'renderer-threw'
    return null
  }
}
