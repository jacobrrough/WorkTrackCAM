/**
 * plate-thumbnail-worker.test.ts -- unit tests for the Web Worker
 * dispatch path added in the UX V1.5 worker-thumbnails wave.
 *
 * Scope of this test file (per parent-workflow contract):
 *   - The async dispatch API (`requestPlateThumbnail`) -- worker spin-up,
 *     cache hot-path, transferable buffer plumbing, timeout, fallback.
 *   - The worker entry's pure helpers (`renderInWorker`,
 *     `isPlateThumbnailWorkerRequest`, `fitCameraToBoundsInWorker`).
 *   - The cache shared with the existing synchronous path.
 *
 * Out of scope (covered by `PlateTabs.test.tsx`):
 *   - The legacy synchronous `renderPlateThumbnail` contract.
 *   - The thumbnail->placeholder fallback inside `PlateTabs.tsx`.
 *
 * CLAUDE.md (My-Shop-Only) cross-machine pin: the dispatch + cache are
 * geometry-only and machine-agnostic. We pin that via fixtures for all
 * three target machines (K2 Plus / Laguna Swift / Carvera 4-axis).
 *
 * The vitest `node` env exposes neither `Worker` nor `OffscreenCanvas`,
 * so most paths exercise the SYNC FALLBACK or use a stub Worker factory
 * to simulate the round-trip. This is the documented happy path for
 * tests; future jsdom/Chromium harnesses will exercise the real worker.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  _clearPlateThumbnailCacheForTests,
  _setPlateThumbnailCacheForTests,
  _setPlateThumbnailWorkerFactoryForTests,
  _terminatePlateThumbnailWorkerForTests,
  hashGeometryForCache,
  pendingPlateThumbnailRequestCount,
  plateThumbnailCacheSize,
  plateThumbnailWorkerAvailable,
  PLATE_THUMBNAIL_WORKER_TIMEOUT_MS,
  requestPlateThumbnail,
  THUMBNAIL_HEIGHT_PX,
  THUMBNAIL_WIDTH_PX,
  type PlateThumbnailAsyncResult,
  type PlateThumbnailFailureReason
} from './plate-thumbnail'
import {
  fitCameraToBoundsInWorker,
  isPlateThumbnailWorkerRequest,
  renderInWorker,
  type PlateThumbnailWorkerRequest,
  type PlateThumbnailWorkerResponse
} from './plate-thumbnail-worker'

// ── Stub worker factory ────────────────────────────────────────────────────
//
// A minimal Worker-shaped object that records every postMessage call
// and lets the test drive responses back into the dispatch handler via
// the registered 'message' listener. Mirrors just the surface area
// `plate-thumbnail.ts` consumes (postMessage, terminate, addEventListener).
interface StubWorker {
  postMessage: (msg: PlateThumbnailWorkerRequest, transfer?: Transferable[]) => void
  terminate: () => void
  addEventListener: (
    type: 'message' | 'error' | 'messageerror',
    listener: (ev: MessageEvent<unknown> | ErrorEvent) => void
  ) => void
  // Test instrumentation
  posted: { msg: PlateThumbnailWorkerRequest; transfer?: Transferable[] }[]
  fireMessage: (data: PlateThumbnailWorkerResponse) => void
  fireError: () => void
  terminated: boolean
}

function makeStubWorker(): StubWorker {
  const posted: StubWorker['posted'] = []
  let messageListener:
    | ((ev: MessageEvent<unknown> | ErrorEvent) => void)
    | null = null
  let errorListener:
    | ((ev: MessageEvent<unknown> | ErrorEvent) => void)
    | null = null
  return {
    posted,
    terminated: false,
    postMessage(msg, transfer) {
      posted.push({ msg, transfer })
    },
    terminate() {
      this.terminated = true
    },
    addEventListener(type, listener) {
      if (type === 'message') messageListener = listener
      if (type === 'error') errorListener = listener
    },
    fireMessage(data) {
      if (messageListener) {
        messageListener({ data } as MessageEvent<unknown>)
      }
    },
    fireError() {
      if (errorListener) {
        errorListener({} as ErrorEvent)
      }
    }
  }
}

// ── Setup / teardown ───────────────────────────────────────────────────────

beforeEach(() => {
  _clearPlateThumbnailCacheForTests()
  _setPlateThumbnailWorkerFactoryForTests(null)
  _terminatePlateThumbnailWorkerForTests()
})

afterEach(() => {
  _setPlateThumbnailWorkerFactoryForTests(null)
  _terminatePlateThumbnailWorkerForTests()
  _clearPlateThumbnailCacheForTests()
})

// ── Worker pure-helper tests ───────────────────────────────────────────────

describe('plate-thumbnail-worker pure helpers', () => {
  it('fitCameraToBoundsInWorker matches the main-thread camera framing', () => {
    const camera = new THREE.OrthographicCamera()
    const bbox = new THREE.Box3(
      new THREE.Vector3(-50, -50, -50),
      new THREE.Vector3(50, 50, 50)
    )
    fitCameraToBoundsInWorker(camera, bbox, 120, 80)
    const aspect = (camera.right - camera.left) / (camera.top - camera.bottom)
    expect(aspect).toBeCloseTo(120 / 80, 5)
    expect(camera.near).toBeGreaterThan(0)
    expect(camera.far).toBeGreaterThan(camera.near)
    expect(camera.left).toBeLessThan(0)
    expect(camera.right).toBeGreaterThan(0)
  })

  it('isPlateThumbnailWorkerRequest accepts a fully-formed request', () => {
    const req: PlateThumbnailWorkerRequest = {
      kind: 'render-plate-thumbnail',
      id: 'plate-thumb-1',
      cacheKey: 'g123-abc',
      widthPx: 120,
      heightPx: 80,
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      hasIndex: false
    }
    expect(isPlateThumbnailWorkerRequest(req)).toBe(true)
  })

  it('isPlateThumbnailWorkerRequest rejects malformed payloads', () => {
    expect(isPlateThumbnailWorkerRequest(null)).toBe(false)
    expect(isPlateThumbnailWorkerRequest(undefined)).toBe(false)
    expect(isPlateThumbnailWorkerRequest('string')).toBe(false)
    expect(isPlateThumbnailWorkerRequest({})).toBe(false)
    expect(
      isPlateThumbnailWorkerRequest({
        kind: 'render-plate-thumbnail',
        id: 'a',
        cacheKey: 'k',
        widthPx: 120,
        heightPx: 80
        // positions missing
      })
    ).toBe(false)
    // hasIndex true but no indices array
    expect(
      isPlateThumbnailWorkerRequest({
        kind: 'render-plate-thumbnail',
        id: 'a',
        cacheKey: 'k',
        widthPx: 120,
        heightPx: 80,
        positions: new Float32Array([0, 0, 0]),
        hasIndex: true
      })
    ).toBe(false)
  })

  it('renderInWorker returns no-offscreen-canvas in the vitest node env', () => {
    const req: PlateThumbnailWorkerRequest = {
      kind: 'render-plate-thumbnail',
      id: 't1',
      cacheKey: 'k1',
      widthPx: 120,
      heightPx: 80,
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      hasIndex: false
    }
    const out = renderInWorker(req)
    expect(out.dataUrl).toBeNull()
    // node env: OffscreenCanvas is undefined
    expect(out.reason).toBe('no-offscreen-canvas')
  })

  it('renderInWorker reports no-geometry for an empty positions array', () => {
    const req: PlateThumbnailWorkerRequest = {
      kind: 'render-plate-thumbnail',
      id: 't1',
      cacheKey: 'k1',
      widthPx: 120,
      heightPx: 80,
      positions: new Float32Array(0),
      hasIndex: false
    }
    const out = renderInWorker(req)
    expect(out.dataUrl).toBeNull()
    expect(out.reason).toBe('no-geometry')
  })
})

// ── Async dispatch path ────────────────────────────────────────────────────

describe('requestPlateThumbnail -- async dispatch', () => {
  it('falls back to the sync path when the Worker constructor is unavailable', async () => {
    // node env: no Worker, no OffscreenCanvas. The sync fallback runs
    // renderPlateThumbnail, which returns null in the node env.
    expect(plateThumbnailWorkerAvailable()).toBe(false)
    const geom = new THREE.BoxGeometry(10, 10, 10)
    const result = await requestPlateThumbnail(geom)
    expect(result.dataUrl).toBeNull()
    expect(result.servedByWorker).toBe(false)
    // The sync path could not render either (no OffscreenCanvas), so the
    // failure reason flows through.
    const allowed: PlateThumbnailFailureReason[] = [
      'no-offscreen-canvas',
      'worker-unavailable'
    ]
    expect(allowed).toContain(result.reason)
  })

  it('returns no-geometry for null sources without spawning the worker', async () => {
    const result = await requestPlateThumbnail(null)
    expect(result.dataUrl).toBeNull()
    expect(result.reason).toBe('no-geometry')
    expect(result.servedByWorker).toBe(false)
  })

  it('hits the cache without round-tripping the worker', async () => {
    const geom = new THREE.BoxGeometry(10, 10, 10)
    const key = `${hashGeometryForCache(geom)}-${THUMBNAIL_WIDTH_PX}x${THUMBNAIL_HEIGHT_PX}`
    _setPlateThumbnailCacheForTests(key, 'data:image/png;base64,AAAA')

    let workerSpawned = false
    _setPlateThumbnailWorkerFactoryForTests(() => {
      workerSpawned = true
      return makeStubWorker()
    })

    const result = await requestPlateThumbnail(geom)
    expect(result.dataUrl).toBe('data:image/png;base64,AAAA')
    expect(result.servedByWorker).toBe(false)
    expect(workerSpawned).toBe(false)
  })

  it('posts a properly-formed transferable request to the worker stub', async () => {
    const stub = makeStubWorker()
    _setPlateThumbnailWorkerFactoryForTests(() => stub)

    const geom = new THREE.BoxGeometry(10, 10, 10)
    const promise = requestPlateThumbnail(geom)
    // One outstanding request right after the synchronous postMessage
    expect(pendingPlateThumbnailRequestCount()).toBe(1)
    expect(stub.posted).toHaveLength(1)
    const posted = stub.posted[0]!
    expect(posted.msg.kind).toBe('render-plate-thumbnail')
    expect(posted.msg.widthPx).toBe(THUMBNAIL_WIDTH_PX)
    expect(posted.msg.heightPx).toBe(THUMBNAIL_HEIGHT_PX)
    expect(posted.msg.positions).toBeInstanceOf(Float32Array)
    expect(posted.msg.positions.length).toBeGreaterThan(0)
    // BoxGeometry has an index buffer
    expect(posted.msg.hasIndex).toBe(true)
    expect(posted.msg.indices).toBeInstanceOf(Uint32Array)
    // Transfer list mirrors the typed-array buffers
    expect(posted.transfer).toBeDefined()
    expect(posted.transfer!.length).toBeGreaterThanOrEqual(1)
    expect(posted.transfer).toContain(posted.msg.positions.buffer)

    // Fake the worker reply
    stub.fireMessage({
      kind: 'render-plate-thumbnail-result',
      id: posted.msg.id,
      cacheKey: posted.msg.cacheKey,
      dataUrl: 'data:image/png;base64,WORKER_REPLY'
    })

    const result = await promise
    expect(result.dataUrl).toBe('data:image/png;base64,WORKER_REPLY')
    expect(result.servedByWorker).toBe(true)
    expect(pendingPlateThumbnailRequestCount()).toBe(0)
    // Cache populated by worker reply -> a second call short-circuits.
    expect(plateThumbnailCacheSize()).toBe(1)
    const cached = await requestPlateThumbnail(geom)
    expect(cached.dataUrl).toBe('data:image/png;base64,WORKER_REPLY')
    expect(cached.servedByWorker).toBe(false) // served from cache, not worker
    // Still only ONE postMessage emitted (no second round-trip)
    expect(stub.posted).toHaveLength(1)
  })

  it('passes through structured failure reasons from worker replies', async () => {
    const stub = makeStubWorker()
    _setPlateThumbnailWorkerFactoryForTests(() => stub)

    const geom = new THREE.BoxGeometry(10, 10, 10)
    const promise = requestPlateThumbnail(geom)
    const posted = stub.posted[0]!
    stub.fireMessage({
      kind: 'render-plate-thumbnail-result',
      id: posted.msg.id,
      cacheKey: posted.msg.cacheKey,
      dataUrl: null,
      reason: 'no-webgl-context'
    })

    const result = await promise
    expect(result.dataUrl).toBeNull()
    expect(result.reason).toBe('no-webgl-context')
    expect(result.servedByWorker).toBe(true)
    // Failure replies do NOT populate the cache.
    expect(plateThumbnailCacheSize()).toBe(0)
  })

  it('times out long-running worker requests', async () => {
    const stub = makeStubWorker()
    _setPlateThumbnailWorkerFactoryForTests(() => stub)

    const geom = new THREE.BoxGeometry(10, 10, 10)
    const result = await requestPlateThumbnail(geom, { timeoutMs: 5 })
    expect(result.dataUrl).toBeNull()
    expect(result.reason).toBe('worker-timeout')
    expect(result.servedByWorker).toBe(true)
    // Pending registry cleared so the next request gets a clean id
    expect(pendingPlateThumbnailRequestCount()).toBe(0)
  })

  it('rejects in-flight requests when the worker fires an error event', async () => {
    const stub = makeStubWorker()
    _setPlateThumbnailWorkerFactoryForTests(() => stub)

    const geom = new THREE.BoxGeometry(10, 10, 10)
    const promise = requestPlateThumbnail(geom)
    expect(pendingPlateThumbnailRequestCount()).toBe(1)
    stub.fireError()
    const result = await promise
    expect(result.dataUrl).toBeNull()
    expect(result.reason).toBe('worker-threw')
    expect(pendingPlateThumbnailRequestCount()).toBe(0)
  })

  it('handles a postMessage throw by resolving with worker-threw', async () => {
    const stub = makeStubWorker()
    stub.postMessage = () => {
      throw new Error('synthetic-postMessage-failure')
    }
    _setPlateThumbnailWorkerFactoryForTests(() => stub)

    const geom = new THREE.BoxGeometry(10, 10, 10)
    const result = await requestPlateThumbnail(geom)
    expect(result.dataUrl).toBeNull()
    expect(result.reason).toBe('worker-threw')
    expect(pendingPlateThumbnailRequestCount()).toBe(0)
  })

  it('reuses a single worker across multiple requests (lazy singleton)', async () => {
    let spawnCount = 0
    const stub = makeStubWorker()
    _setPlateThumbnailWorkerFactoryForTests(() => {
      spawnCount += 1
      return stub
    })

    // Two distinct geometries -> two distinct cache keys -> two
    // postMessage calls, but only ONE worker spawn.
    const g1 = new THREE.BoxGeometry(10, 10, 10)
    const g2 = new THREE.BoxGeometry(20, 20, 20)
    const p1 = requestPlateThumbnail(g1)
    const p2 = requestPlateThumbnail(g2)

    expect(spawnCount).toBe(1)
    expect(stub.posted).toHaveLength(2)
    expect(pendingPlateThumbnailRequestCount()).toBe(2)

    // Reply to both
    stub.fireMessage({
      kind: 'render-plate-thumbnail-result',
      id: stub.posted[0]!.msg.id,
      cacheKey: stub.posted[0]!.msg.cacheKey,
      dataUrl: 'data:image/png;base64,A'
    })
    stub.fireMessage({
      kind: 'render-plate-thumbnail-result',
      id: stub.posted[1]!.msg.id,
      cacheKey: stub.posted[1]!.msg.cacheKey,
      dataUrl: 'data:image/png;base64,B'
    })

    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1.dataUrl).toBe('data:image/png;base64,A')
    expect(r2.dataUrl).toBe('data:image/png;base64,B')
    expect(spawnCount).toBe(1)
    expect(plateThumbnailCacheSize()).toBe(2)
  })

  it('ignores worker messages that do not correlate to a pending request', async () => {
    const stub = makeStubWorker()
    _setPlateThumbnailWorkerFactoryForTests(() => stub)

    const geom = new THREE.BoxGeometry(10, 10, 10)
    const promise = requestPlateThumbnail(geom)
    const posted = stub.posted[0]!

    // Fire a spurious message with a non-matching id BEFORE the real reply.
    stub.fireMessage({
      kind: 'render-plate-thumbnail-result',
      id: 'unknown-correlation-id',
      cacheKey: 'k-unknown',
      dataUrl: 'data:image/png;base64,SPURIOUS'
    })
    expect(pendingPlateThumbnailRequestCount()).toBe(1)

    // Real reply
    stub.fireMessage({
      kind: 'render-plate-thumbnail-result',
      id: posted.msg.id,
      cacheKey: posted.msg.cacheKey,
      dataUrl: 'data:image/png;base64,REAL'
    })

    const result = await promise
    expect(result.dataUrl).toBe('data:image/png;base64,REAL')
    // Only the REAL key is cached; the spurious one is dropped.
    expect(plateThumbnailCacheSize()).toBe(1)
  })

  it('ignores worker messages with wrong discriminator (kind)', async () => {
    const stub = makeStubWorker()
    _setPlateThumbnailWorkerFactoryForTests(() => stub)

    const geom = new THREE.BoxGeometry(10, 10, 10)
    const promise = requestPlateThumbnail(geom)
    const posted = stub.posted[0]!

    // Wrong kind -- handler should ignore.
    // We cast through unknown so this stays type-safe at the boundary.
    const malformed = {
      kind: 'some-other-message',
      id: posted.msg.id,
      cacheKey: posted.msg.cacheKey,
      dataUrl: 'data:image/png;base64,XXX'
    } as unknown as PlateThumbnailWorkerResponse
    stub.fireMessage(malformed)
    expect(pendingPlateThumbnailRequestCount()).toBe(1)

    // Real reply
    stub.fireMessage({
      kind: 'render-plate-thumbnail-result',
      id: posted.msg.id,
      cacheKey: posted.msg.cacheKey,
      dataUrl: 'data:image/png;base64,REAL'
    })
    const result = await promise
    expect(result.dataUrl).toBe('data:image/png;base64,REAL')
  })

  it('accepts a Three.js Mesh in addition to a BufferGeometry', async () => {
    const stub = makeStubWorker()
    _setPlateThumbnailWorkerFactoryForTests(() => stub)

    const geom = new THREE.BoxGeometry(10, 10, 10)
    const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial())
    const promise = requestPlateThumbnail(mesh)
    expect(stub.posted).toHaveLength(1)
    const posted = stub.posted[0]!
    expect(posted.msg.positions.length).toBeGreaterThan(0)

    stub.fireMessage({
      kind: 'render-plate-thumbnail-result',
      id: posted.msg.id,
      cacheKey: posted.msg.cacheKey,
      dataUrl: 'data:image/png;base64,MESH'
    })
    const result = await promise
    expect(result.dataUrl).toBe('data:image/png;base64,MESH')
    expect(result.servedByWorker).toBe(true)
  })

  it('honors a custom cacheKey supplied by the caller', async () => {
    const stub = makeStubWorker()
    _setPlateThumbnailWorkerFactoryForTests(() => stub)

    const geom = new THREE.BoxGeometry(10, 10, 10)
    const promise = requestPlateThumbnail(geom, { cacheKey: 'custom-plate-key-p1' })
    const posted = stub.posted[0]!
    expect(posted.msg.cacheKey).toBe('custom-plate-key-p1')
    stub.fireMessage({
      kind: 'render-plate-thumbnail-result',
      id: posted.msg.id,
      cacheKey: 'custom-plate-key-p1',
      dataUrl: 'data:image/png;base64,CUSTOM'
    })
    await promise
    // Cache key is the custom one verbatim
    expect(plateThumbnailCacheSize()).toBe(1)
  })

  it('terminates the worker singleton on teardown', () => {
    const stub = makeStubWorker()
    _setPlateThumbnailWorkerFactoryForTests(() => stub)
    const geom = new THREE.BoxGeometry(10, 10, 10)
    void requestPlateThumbnail(geom)
    expect(stub.terminated).toBe(false)
    _terminatePlateThumbnailWorkerForTests()
    expect(stub.terminated).toBe(true)
    expect(pendingPlateThumbnailRequestCount()).toBe(0)
  })
})

describe('plate-thumbnail-worker -- module constants', () => {
  it('PLATE_THUMBNAIL_WORKER_TIMEOUT_MS is a sensible default', () => {
    expect(PLATE_THUMBNAIL_WORKER_TIMEOUT_MS).toBeGreaterThan(0)
    // 60 s is too generous; 100 ms is too tight. We want something in
    // the 1-10 s range.
    expect(PLATE_THUMBNAIL_WORKER_TIMEOUT_MS).toBeGreaterThanOrEqual(1000)
    expect(PLATE_THUMBNAIL_WORKER_TIMEOUT_MS).toBeLessThanOrEqual(10_000)
  })

  it('plateThumbnailWorkerAvailable is a stable boolean', () => {
    const out: boolean = plateThumbnailWorkerAvailable()
    expect(typeof out).toBe('boolean')
    // In the vitest node env we expect false (no window global)
    expect(out).toBe(false)
  })
})

// ── Cross-machine pin (CLAUDE.md My-Shop-Only) ─────────────────────────────
//
// The worker dispatch is geometry-only and MUST behave identically
// across all three target machines. We exercise the dispatch with
// fixtures sized roughly to each machine's typical part envelope
// (K2 Plus 350x350x350 bed-corner part, Laguna 60x120-in full sheet,
// Carvera 92mm-dia x 240mm cylinder) and pin the result shape.
describe('requestPlateThumbnail -- cross-machine pin (My-Shop-Only)', () => {
  interface MachineFixture {
    id: string
    name: string
    bbox: { min: [number, number, number]; max: [number, number, number] }
  }
  const MACHINES: MachineFixture[] = [
    {
      id: 'creality-k2-plus',
      name: 'Creality K2 Plus',
      bbox: { min: [0, 0, 0], max: [60, 60, 40] }
    },
    {
      id: 'laguna-swift-5x10',
      name: 'Laguna Swift 5x10',
      bbox: { min: [0, 0, 0], max: [1524, 3048, 25] }
    },
    {
      id: 'makera-carvera-4axis',
      name: 'Makera Carvera (4-axis)',
      bbox: { min: [-46, -46, 0], max: [46, 46, 240] }
    }
  ]

  for (const machine of MACHINES) {
    it(`dispatches a request for a ${machine.name} part identically`, async () => {
      const stub = makeStubWorker()
      _setPlateThumbnailWorkerFactoryForTests(() => stub)

      const size: [number, number, number] = [
        machine.bbox.max[0] - machine.bbox.min[0],
        machine.bbox.max[1] - machine.bbox.min[1],
        machine.bbox.max[2] - machine.bbox.min[2]
      ]
      const geom = new THREE.BoxGeometry(size[0], size[1], size[2])
      const promise = requestPlateThumbnail(geom, { cacheKey: `${machine.id}-pin` })
      const posted = stub.posted[0]!

      // Request structure is machine-agnostic
      expect(posted.msg.kind).toBe('render-plate-thumbnail')
      expect(posted.msg.widthPx).toBe(THUMBNAIL_WIDTH_PX)
      expect(posted.msg.heightPx).toBe(THUMBNAIL_HEIGHT_PX)
      // No machine-id leaks into the wire payload
      expect(JSON.stringify(posted.msg)).not.toContain(machine.name)

      stub.fireMessage({
        kind: 'render-plate-thumbnail-result',
        id: posted.msg.id,
        cacheKey: posted.msg.cacheKey,
        dataUrl: `data:image/png;base64,${machine.id}`
      })
      const result: PlateThumbnailAsyncResult = await promise
      expect(result.servedByWorker).toBe(true)
      expect(result.dataUrl).toBe(`data:image/png;base64,${machine.id}`)
    })
  }
})
