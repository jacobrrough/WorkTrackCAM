/**
 * plate-thumbnail-worker -- Web Worker entry point that owns the
 * offscreen Three.js render for plate thumbnails. Moves the WebGL +
 * BufferGeometry work off the main renderer thread so the plate-strip
 * refresh (~6-12 thumbnails on a typical project) does not stall the
 * React tree or block the 3D viewport.
 *
 * Wire protocol
 * -------------
 *   Inbound (renderer -> worker):
 *     {
 *       kind: 'render-plate-thumbnail'
 *       id: string            -- correlation id (the renderer maps back to a Promise)
 *       cacheKey: string      -- pre-computed FNV-1a hash + size suffix (cache lives on main)
 *       widthPx: number
 *       heightPx: number
 *       positions: Float32Array   -- transferred (.buffer is in transfer list)
 *       indices?: Uint32Array     -- optional transferred index buffer
 *       hasIndex: boolean
 *     }
 *
 *   Outbound (worker -> renderer):
 *     {
 *       kind: 'render-plate-thumbnail-result'
 *       id: string
 *       cacheKey: string
 *       dataUrl: string | null
 *       reason?: 'no-offscreen-canvas' | 'no-webgl-context' | 'empty-bounding-box'
 *                | 'renderer-threw' | 'no-geometry'
 *     }
 *
 * The cache itself stays on the main thread (plate-thumbnail.ts) so a
 * second consumer asking for the same key does NOT pay another worker
 * round-trip. We just compute the dataURL here and ship it back.
 *
 * Fallback contract: if the renderer ever spawns this worker in an
 * environment without OffscreenCanvas/WebGL (e.g. a future jsdom test),
 * we still emit a structured result with `reason: 'no-offscreen-canvas'`
 * so the renderer can hand off to the synchronous fallback path. The
 * worker NEVER throws across the postMessage boundary -- every failure
 * mode is reported via the result message.
 *
 * STRICT 3-machine scope (CLAUDE.md): the worker is geometry-only and
 * never touches G-code, Moonraker upload, or post-processors. It serves
 * K2 Plus, Laguna Swift, and Carvera plates identically.
 */

import * as THREE from 'three'

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
 * Failure reasons the worker can report back. Mirrors
 * `PlateThumbnailFailureReason` in `plate-thumbnail.ts` so callers can
 * surface a single union type for both sync + async paths.
 */
export type PlateThumbnailWorkerFailureReason =
  | 'no-geometry'
  | 'no-offscreen-canvas'
  | 'no-webgl-context'
  | 'empty-bounding-box'
  | 'renderer-threw'

/**
 * Inbound message contract -- exported so the renderer side can type
 * its `postMessage` call against the same shape.
 */
export interface PlateThumbnailWorkerRequest {
  kind: 'render-plate-thumbnail'
  id: string
  cacheKey: string
  widthPx: number
  heightPx: number
  positions: Float32Array
  indices?: Uint32Array
  hasIndex: boolean
}

/**
 * Outbound message contract -- exported for the renderer's typed
 * `onmessage` handler.
 */
export interface PlateThumbnailWorkerResponse {
  kind: 'render-plate-thumbnail-result'
  id: string
  cacheKey: string
  dataUrl: string | null
  reason?: PlateThumbnailWorkerFailureReason
}

/**
 * Pure helper: frame an OrthographicCamera so it sees the entire
 * bounding box with the documented padding. Duplicated from
 * `plate-thumbnail.ts` because workers cannot share module-level state
 * with the main bundle (separate import graph + execution context).
 * Kept byte-identical to the main-thread implementation so the two
 * paths are interchangeable for callers.
 */
export function fitCameraToBoundsInWorker(
  camera: THREE.OrthographicCamera,
  bbox: THREE.Box3,
  widthPx: number,
  heightPx: number
): void {
  const size = new THREE.Vector3()
  bbox.getSize(size)
  const center = new THREE.Vector3()
  bbox.getCenter(center)

  const extent = Math.max(size.x, size.y, size.z)
  const padded = extent * (1 + FRAME_PADDING_FRACTION * 2)
  const aspect = widthPx / heightPx

  const halfH = padded / 2
  const halfW = halfH * aspect
  camera.left = -halfW
  camera.right = halfW
  camera.top = halfH
  camera.bottom = -halfH
  camera.near = 0.1
  camera.far = padded * 8 + 100

  const dist = padded * 2 + 10
  camera.position.copy(center).addScaledVector(CAMERA_DIRECTION, dist)
  camera.lookAt(center)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld()
}

/**
 * Pure helper: do the offscreen render. Exposed (rather than inlined
 * into the `onmessage` handler) so the unit tests can drive it directly
 * with a hand-crafted request payload. Returns a structured result
 * mirroring the wire response (minus the `kind` discriminant + id).
 */
export function renderInWorker(
  request: PlateThumbnailWorkerRequest
): { dataUrl: string | null; reason?: PlateThumbnailWorkerFailureReason } {
  const { positions, indices, hasIndex, widthPx, heightPx } = request

  if (!positions || positions.length === 0) {
    return { dataUrl: null, reason: 'no-geometry' }
  }
  if (typeof OffscreenCanvas === 'undefined') {
    return { dataUrl: null, reason: 'no-offscreen-canvas' }
  }

  // Reassemble the geometry from the transferred buffers.
  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  if (hasIndex && indices) {
    geom.setIndex(new THREE.BufferAttribute(indices, 1))
  }
  geom.computeBoundingBox()
  const bbox = geom.boundingBox
  if (!bbox || !Number.isFinite(bbox.min.x) || !Number.isFinite(bbox.max.x)) {
    geom.dispose()
    return { dataUrl: null, reason: 'empty-bounding-box' }
  }
  if (!Number.isFinite(bbox.min.y) || !Number.isFinite(bbox.max.y)) {
    geom.dispose()
    return { dataUrl: null, reason: 'empty-bounding-box' }
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

    // Three-point lighting matches the main-thread renderer so the
    // worker output is visually identical.
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
    fitCameraToBoundsInWorker(camera, bbox, widthPx, heightPx)

    renderer.render(scene, camera)

    const canvasAsHTML = canvas as unknown as {
      toDataURL?: (mime: string) => string
    }
    let dataUrl: string | null = null
    if (typeof canvasAsHTML.toDataURL === 'function') {
      dataUrl = canvasAsHTML.toDataURL('image/png')
    }

    material.dispose()
    renderer.dispose()
    geom.dispose() // the worker owns this geometry; safe to dispose

    if (!dataUrl) {
      return { dataUrl: null, reason: 'no-webgl-context' }
    }
    return { dataUrl }
  } catch {
    geom.dispose()
    return { dataUrl: null, reason: 'renderer-threw' }
  }
}

/**
 * Type guard for inbound messages. Workers receive untyped data over
 * postMessage; the guard lets the handler reject malformed payloads
 * without throwing across the wire.
 */
export function isPlateThumbnailWorkerRequest(
  msg: unknown
): msg is PlateThumbnailWorkerRequest {
  if (!msg || typeof msg !== 'object') return false
  const m = msg as Record<string, unknown>
  if (m['kind'] !== 'render-plate-thumbnail') return false
  if (typeof m['id'] !== 'string') return false
  if (typeof m['cacheKey'] !== 'string') return false
  if (typeof m['widthPx'] !== 'number') return false
  if (typeof m['heightPx'] !== 'number') return false
  if (!(m['positions'] instanceof Float32Array)) return false
  if (typeof m['hasIndex'] !== 'boolean') return false
  if (m['hasIndex'] && !(m['indices'] instanceof Uint32Array)) return false
  return true
}

/**
 * Wire up the worker's message handler. Exported as a function (rather
 * than executed at import time) so the tests can import the helpers
 * without spinning up a global `onmessage` binding in the vitest node
 * env. The build-time entry point at the bottom of this file invokes
 * `installWorkerMessageHandler()` automatically when running inside a
 * real Web Worker context.
 */
export function installWorkerMessageHandler(
  workerScope: {
    addEventListener: (
      type: 'message',
      listener: (ev: MessageEvent<unknown>) => void
    ) => void
    postMessage: (msg: PlateThumbnailWorkerResponse) => void
  }
): void {
  workerScope.addEventListener('message', (ev) => {
    const msg = ev.data
    if (!isPlateThumbnailWorkerRequest(msg)) {
      // Malformed payload: nothing to correlate, so emit nothing.
      // Renderer's request will time out on its side -- we surface that
      // via the in-flight Promise's reject path.
      return
    }
    const result = renderInWorker(msg)
    workerScope.postMessage({
      kind: 'render-plate-thumbnail-result',
      id: msg.id,
      cacheKey: msg.cacheKey,
      dataUrl: result.dataUrl,
      reason: result.reason
    })
  })
}

// Auto-install the handler when running inside a real Web Worker
// (DedicatedWorkerGlobalScope). The `self` reference exists in both
// browser/window AND worker contexts, so we feature-test for the
// worker-specific shape (no `window`, has `postMessage` + `addEventListener`).
// In the vitest `node` env neither `self` nor `WorkerGlobalScope` exist;
// the import simply registers the exported helpers without side effects.
declare const self: unknown
if (
  typeof self !== 'undefined' &&
  typeof (self as { postMessage?: unknown }).postMessage === 'function' &&
  typeof (self as { addEventListener?: unknown }).addEventListener === 'function' &&
  typeof (globalThis as { window?: unknown }).window === 'undefined'
) {
  installWorkerMessageHandler(
    self as unknown as Parameters<typeof installWorkerMessageHandler>[0]
  )
}
