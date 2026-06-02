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
 * Runtime contract (V3, post-worker migration):
 *   - On a real renderer (Chromium / Electron) we now prefer the Web
 *     Worker dispatch path (`requestPlateThumbnail`) -- the offscreen
 *     WebGL render happens on a background thread, so the main thread
 *     does not stall on plate-strip refreshes. The cache stays here on
 *     the main thread so a second consumer with the same key is an
 *     O(1) lookup -- no worker round-trip.
 *   - The legacy synchronous `renderPlateThumbnail` is preserved for
 *     callers that need a same-tick result (and for the test suite,
 *     which exercises the deterministic null-return branch). It is
 *     also the documented fallback when the Worker constructor is
 *     unavailable (node/vitest env, or future environments that
 *     restrict Workers).
 *
 * STRICT 3-machine scope (CLAUDE.md): the thumbnail is purely a UI
 * affordance; it never emits G-code, touches the Moonraker upload
 * path, or hits the Carvera 4th-axis post. The same helper renders
 * meshes destined for K2 Plus FDM, Laguna Swift 5x10 routing, and
 * Carvera 3-axis + 4-axis CNC equally -- it's geometry-only.
 */

import * as THREE from 'three'
import type {
  PlateThumbnailWorkerRequest,
  PlateThumbnailWorkerResponse
} from './plate-thumbnail-worker'

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
  | 'worker-unavailable'
  | 'worker-timeout'
  | 'worker-threw'

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
 * Feature test: is the Web Worker constructor available in this
 * environment? The vitest `node` env exposes a stub-ish Worker class
 * via undici under some Node versions, so we ALSO require the renderer
 * "window" global to be present -- the worker pattern is only useful
 * on the main thread of a real renderer process.
 */
export function plateThumbnailWorkerAvailable(): boolean {
  if (typeof Worker === 'undefined') return false
  if (typeof window === 'undefined') return false
  // The renderer must support `URL` + `import.meta` to load the worker
  // entry; both are universally present in modern Chromium/Electron.
  return true
}

/**
 * Cache from geometry hash -> data-URL. Keyed by a stable string so a
 * V3 Web-Worker migration only needs to swap the hashing function.
 *
 * Cache is shared between the sync + async paths so callers never
 * round-trip the worker twice for the same key.
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
 * Pre-seed the cache with a known data-URL. Used by the async dispatch
 * path to populate the cache from worker responses before resolving the
 * outer Promise. Exposed for tests so they can assert hot-path behavior
 * without firing a real worker.
 */
export function _setPlateThumbnailCacheForTests(key: string, dataUrl: string): void {
  thumbnailCache.set(key, dataUrl)
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

// ──────────────────────────────────────────────────────────────────────────
//  Async / Web-Worker dispatch path
// ──────────────────────────────────────────────────────────────────────────

/**
 * Result type for the async dispatch. Mirrors the synchronous return
 * shape (`string | null`) but as a Promise + structured failure reason
 * so callers can render a loading spinner -> thumbnail -> placeholder
 * state machine without a parallel error channel.
 */
export interface PlateThumbnailAsyncResult {
  dataUrl: string | null
  reason?: PlateThumbnailFailureReason
  /** True when the worker path served the request (vs the sync fallback). */
  servedByWorker: boolean
}

/**
 * Default timeout for a single worker round-trip. A 120x80 render with
 * three-point lighting takes <10 ms on a 5 year old laptop; 5 s is
 * generous-enough headroom that we never spuriously kill a slow start.
 */
export const PLATE_THUMBNAIL_WORKER_TIMEOUT_MS = 5000

/** Internal: outstanding worker request, keyed by correlation id. */
interface PendingWorkerRequest {
  resolve: (result: PlateThumbnailAsyncResult) => void
  cacheKey: string
  timer: ReturnType<typeof setTimeout>
}

/**
 * Lazy worker singleton. Spun up on first async request, reused for
 * every subsequent call. We intentionally do NOT auto-terminate when
 * idle -- the WebGL context inside the worker is expensive to bring
 * up, so keeping the worker alive across a session is a net win even
 * if a long idle period passes between plate switches.
 */
interface PlateThumbnailWorkerHandle {
  postMessage: (msg: PlateThumbnailWorkerRequest, transfer?: Transferable[]) => void
  terminate: () => void
  addEventListener: (
    type: 'message' | 'error' | 'messageerror',
    listener: (ev: MessageEvent<unknown> | ErrorEvent) => void
  ) => void
}

let workerSingleton: PlateThumbnailWorkerHandle | null = null
const pendingRequests = new Map<string, PendingWorkerRequest>()
let correlationCounter = 0

/**
 * Override the worker factory (used by tests + by callers that want to
 * inject a fake worker). When set, `requestPlateThumbnail` uses this
 * factory instead of `new Worker(new URL(...))`. The factory must
 * return an object that quacks like a Web Worker.
 */
let workerFactoryOverride: (() => PlateThumbnailWorkerHandle) | null = null

/**
 * Install a custom worker factory. Pass `null` to restore the default
 * `new Worker(new URL(...))` behavior. Exposed for tests; production
 * code should never need to call this.
 */
export function _setPlateThumbnailWorkerFactoryForTests(
  factory: (() => PlateThumbnailWorkerHandle) | null
): void {
  workerFactoryOverride = factory
  // Reset the singleton so the next request picks up the override.
  if (workerSingleton) {
    try {
      workerSingleton.terminate()
    } catch {
      /* swallow: stub factories may not implement terminate */
    }
    workerSingleton = null
  }
  // Cancel any in-flight requests so they don't leak across tests.
  for (const [, pending] of pendingRequests) {
    clearTimeout(pending.timer)
    pending.resolve({ dataUrl: null, reason: 'worker-threw', servedByWorker: false })
  }
  pendingRequests.clear()
}

function defaultWorkerFactory(): PlateThumbnailWorkerHandle {
  // Vite + electron-vite resolve `new Worker(new URL(...))` at build
  // time; the `{ type: 'module' }` option preserves ES module imports
  // (Three.js is ESM in the renderer bundle).
  const worker = new Worker(new URL('./plate-thumbnail-worker.ts', import.meta.url), {
    type: 'module'
  })
  return worker as unknown as PlateThumbnailWorkerHandle
}

function ensureWorker(): PlateThumbnailWorkerHandle | null {
  if (workerSingleton) return workerSingleton
  const factory = workerFactoryOverride ?? defaultWorkerFactory
  try {
    const w = factory()
    w.addEventListener('message', (ev) => {
      const data = (ev as MessageEvent<unknown>).data
      handleWorkerResponse(data)
    })
    w.addEventListener('error', () => {
      // Any thrown error in the worker is fatal for in-flight requests;
      // resolve them with `worker-threw` so callers fall through to the
      // placeholder. The worker is NOT torn down -- a subsequent request
      // gets a fresh attempt.
      for (const [, pending] of pendingRequests) {
        clearTimeout(pending.timer)
        pending.resolve({ dataUrl: null, reason: 'worker-threw', servedByWorker: false })
      }
      pendingRequests.clear()
    })
    workerSingleton = w
    return w
  } catch {
    return null
  }
}

function handleWorkerResponse(data: unknown): void {
  if (!data || typeof data !== 'object') return
  const m = data as Partial<PlateThumbnailWorkerResponse>
  if (m.kind !== 'render-plate-thumbnail-result') return
  if (typeof m.id !== 'string') return
  const pending = pendingRequests.get(m.id)
  if (!pending) return
  pendingRequests.delete(m.id)
  clearTimeout(pending.timer)
  if (m.dataUrl) {
    thumbnailCache.set(pending.cacheKey, m.dataUrl)
    pending.resolve({ dataUrl: m.dataUrl, servedByWorker: true })
  } else {
    pending.resolve({
      dataUrl: null,
      reason: (m.reason as PlateThumbnailFailureReason) ?? 'worker-threw',
      servedByWorker: true
    })
  }
}

/**
 * Internal: pull a Float32Array of positions out of a BufferGeometry
 * for transfer to the worker. Cloning into a fresh ArrayBuffer means
 * the original geometry on the main thread is untouched -- the worker
 * is free to dispose its copy without affecting the renderer viewport.
 */
function snapshotGeometryForTransfer(geom: THREE.BufferGeometry): {
  positions: Float32Array
  indices?: Uint32Array
} {
  const posAttr = geom.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!posAttr) {
    return { positions: new Float32Array(0) }
  }
  // Copy into a fresh Float32Array so the main-thread geometry survives
  // the transfer. (Transferring the underlying ArrayBuffer would
  // neuter the original.)
  const positions = new Float32Array(posAttr.array as ArrayLike<number>)
  const idxAttr = geom.getIndex()
  if (idxAttr) {
    const indices = new Uint32Array(idxAttr.array as ArrayLike<number>)
    return { positions, indices }
  }
  return { positions }
}

/**
 * Async dispatch entry point. Returns a Promise that resolves with the
 * rendered data-URL (or a structured failure reason). The cache is
 * shared with the sync path -- a cache hit short-circuits without
 * round-tripping the worker.
 *
 * Fallback behavior: if `plateThumbnailWorkerAvailable()` is false (no
 * Worker constructor, or we're in the node/vitest env), the call
 * synchronously delegates to `renderPlateThumbnail` and wraps the
 * result in the async shape. This preserves the "always returns
 * SOMETHING usable" contract callers rely on.
 */
export function requestPlateThumbnail(
  src: PlateThumbnailSource,
  opts?: { cacheKey?: string; widthPx?: number; heightPx?: number; timeoutMs?: number }
): Promise<PlateThumbnailAsyncResult> {
  const geom = geometryFromSource(src)
  if (!geom) {
    return Promise.resolve({ dataUrl: null, reason: 'no-geometry', servedByWorker: false })
  }

  const widthPx = opts?.widthPx ?? THUMBNAIL_WIDTH_PX
  const heightPx = opts?.heightPx ?? THUMBNAIL_HEIGHT_PX
  const cacheKey = opts?.cacheKey ?? `${hashGeometryForCache(geom)}-${widthPx}x${heightPx}`

  // Cache hit short-circuits before we even consider the worker.
  const cached = thumbnailCache.get(cacheKey)
  if (cached) {
    return Promise.resolve({ dataUrl: cached, servedByWorker: false })
  }

  // No worker available -> synchronous fallback. The sync render writes
  // into the same cache so a follow-up call hits the fast path.
  if (!plateThumbnailWorkerAvailable() && !workerFactoryOverride) {
    const failure: { reason?: PlateThumbnailFailureReason } = {}
    const dataUrl = renderPlateThumbnail(src, { cacheKey, widthPx, heightPx, failure })
    if (dataUrl) {
      return Promise.resolve({ dataUrl, servedByWorker: false })
    }
    return Promise.resolve({
      dataUrl: null,
      reason: failure.reason ?? 'worker-unavailable',
      servedByWorker: false
    })
  }

  const worker = ensureWorker()
  if (!worker) {
    // Worker spin-up failed -> sync fallback for graceful degradation.
    const failure: { reason?: PlateThumbnailFailureReason } = {}
    const dataUrl = renderPlateThumbnail(src, { cacheKey, widthPx, heightPx, failure })
    if (dataUrl) {
      return Promise.resolve({ dataUrl, servedByWorker: false })
    }
    return Promise.resolve({
      dataUrl: null,
      reason: failure.reason ?? 'worker-unavailable',
      servedByWorker: false
    })
  }

  const { positions, indices } = snapshotGeometryForTransfer(geom)
  if (positions.length === 0) {
    return Promise.resolve({ dataUrl: null, reason: 'no-geometry', servedByWorker: false })
  }

  const id = `plate-thumb-${++correlationCounter}`
  const timeoutMs = opts?.timeoutMs ?? PLATE_THUMBNAIL_WORKER_TIMEOUT_MS

  return new Promise<PlateThumbnailAsyncResult>((resolve) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(id)
      resolve({ dataUrl: null, reason: 'worker-timeout', servedByWorker: true })
    }, timeoutMs)
    pendingRequests.set(id, { resolve, cacheKey, timer })

    const request: PlateThumbnailWorkerRequest = {
      kind: 'render-plate-thumbnail',
      id,
      cacheKey,
      widthPx,
      heightPx,
      positions,
      indices,
      hasIndex: indices !== undefined
    }
    // Transfer the underlying ArrayBuffers so we avoid a structured-clone
    // copy of (potentially) hundreds of KB of vertex data per request.
    const transfer: Transferable[] = [positions.buffer]
    if (indices) transfer.push(indices.buffer)
    try {
      worker.postMessage(request, transfer)
    } catch {
      pendingRequests.delete(id)
      clearTimeout(timer)
      resolve({ dataUrl: null, reason: 'worker-threw', servedByWorker: true })
    }
  })
}

/** Diagnostic: count of in-flight worker requests (used by tests). */
export function pendingPlateThumbnailRequestCount(): number {
  return pendingRequests.size
}

/**
 * Forcefully tear down the worker singleton and reject every in-flight
 * request. Exposed for tests so they can isolate per-case worker state.
 * Production code should rely on the lazy lifecycle.
 */
export function _terminatePlateThumbnailWorkerForTests(): void {
  if (workerSingleton) {
    try {
      workerSingleton.terminate()
    } catch {
      /* swallow: stub factories may not implement terminate */
    }
    workerSingleton = null
  }
  for (const [, pending] of pendingRequests) {
    clearTimeout(pending.timer)
    pending.resolve({ dataUrl: null, reason: 'worker-threw', servedByWorker: false })
  }
  pendingRequests.clear()
}
