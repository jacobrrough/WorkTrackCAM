/**
 * Reusable mock-Moonraker harness for integration tests — Phase 2
 * [P2-K2-PUSH] / Cycle 349.
 *
 * Originally inlined in `src/main/moonraker-push-e2e.test.ts`. Extracted
 * here so multiple test surfaces can boot the same fake printer without
 * duplicating the request-capture machinery:
 *
 *   - `src/main/moonraker-push-e2e.test.ts` — the existing 47-test
 *     wire-level coverage (preserved unchanged behaviorally; now imports
 *     from this module).
 *   - Future cycles can spin up the same fake to assert renderer/IPC
 *     orchestration end-to-end without an extra mock per test file.
 *
 * Boots a `node:http` server that impersonates the Creality K2 Plus's
 * Moonraker REST surface. Captures every request the test sent
 * (method + path + content-type + raw body) on `state.captured` so
 * tests can inspect the multipart upload, the `start_print` query
 * string, and the lifecycle ordering. Each route's response is
 * swappable via the `*Response` fields on `MockMoonrakerState` so a
 * single shared server can exercise success, 4xx, and 5xx paths.
 *
 * The K2 Plus's real Moonraker exposes additional endpoints
 * (websocket, Fluidd, Klipper macros, etc.); this harness covers
 * exactly the seven HTTP routes that `moonraker-push.ts` calls today:
 *
 *   POST /server/files/upload          — multipart G-code upload
 *   POST /printer/print/start          — kicks off the print
 *   POST /printer/print/cancel         — abort
 *   POST /printer/print/pause          — pause
 *   POST /printer/print/resume         — resume
 *   GET  /printer/objects/query        — print_stats poll
 *   (everything else returns 404 with a JSON `{error: ...}` body so
 *   tests can assert "no surprise route was hit".)
 *
 * Safety: this is a **test-only** module. It listens on
 * `127.0.0.1:0` (kernel-assigned ephemeral port) so it never binds
 * publicly, and it never persists captured request bodies — all
 * state is in-memory and dies with the test runner.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * One captured HTTP request, recorded in arrival order on
 * `MockMoonrakerState.captured`. The body is preserved verbatim as a
 * `Buffer` so multipart-uploads can be inspected byte-for-byte
 * (boundary + filename + file payload all matter for Moonraker
 * compatibility).
 */
export type CapturedRequest = {
  method: string
  path: string
  contentType: string | undefined
  body: Buffer
}

/**
 * Mutable state for a running fake Moonraker. Tests reset this
 * between assertions via `resetMockMoonrakerState(state)` and
 * override individual `*Response` fields to exercise specific HTTP
 * status codes / bodies.
 */
export type MockMoonrakerState = {
  /** Every request the test sent, in order — primary inspection surface. */
  captured: CapturedRequest[]
  /** What `/server/files/upload` responds with — swappable per-test. */
  uploadResponse: { status: number; body: string }
  /** What `/printer/print/start` responds with. */
  startResponse: { status: number; body: string }
  /** What `/printer/objects/query?print_stats` responds with. */
  statusResponse: { status: number; body: string }
  /** What `/printer/print/cancel` responds with. */
  cancelResponse: { status: number; body: string }
  /** What `/printer/print/pause` responds with. */
  pauseResponse: { status: number; body: string }
  /** What `/printer/print/resume` responds with. */
  resumeResponse: { status: number; body: string }
}

/**
 * Default `print_stats` body the fake returns on
 * `GET /printer/objects/query?print_stats` when the test does not
 * override it. Mirrors the real K2 Plus shape (state, filename,
 * progress, durations) closely enough that
 * `parseMoonrakerStatusBody` ([src/main/moonraker-push.ts](../moonraker-push.ts))
 * computes a non-zero ETA from it.
 */
const DEFAULT_PRINT_STATS_BODY = JSON.stringify({
  result: {
    status: {
      print_stats: {
        state: 'printing',
        filename: 'cube.gcode',
        progress: 0.25,
        print_duration: 300.0,
        total_duration: 1200.0
      }
    }
  }
})

/**
 * Default `/server/files/upload` response the fake returns when the
 * test does not override it. Mirrors the real K2 Plus shape — the
 * `item.path` field is what `parseUploadedPath` reads to thread
 * through to `start_print`'s `?filename=...` query.
 */
const DEFAULT_UPLOAD_BODY = JSON.stringify({
  item: {
    path: 'cube.gcode',
    root: 'gcodes',
    modified: 1_700_000_000,
    size: 256
  },
  print: { name: '', started: false },
  action: 'create_file'
})

/**
 * Build a fresh, baseline-success `MockMoonrakerState`. Every route
 * returns 2xx with a plausible JSON body. Tests override fields
 * before calling the production helper to exercise edge cases.
 */
export function freshMockMoonrakerState(): MockMoonrakerState {
  return {
    captured: [],
    uploadResponse: { status: 201, body: DEFAULT_UPLOAD_BODY },
    startResponse: { status: 200, body: JSON.stringify({ result: 'ok' }) },
    statusResponse: { status: 200, body: DEFAULT_PRINT_STATS_BODY },
    cancelResponse: { status: 200, body: JSON.stringify({ result: 'ok' }) },
    pauseResponse: { status: 200, body: JSON.stringify({ result: 'ok' }) },
    resumeResponse: { status: 200, body: JSON.stringify({ result: 'ok' }) }
  }
}

/**
 * Reset a shared `state` to defaults in-place. Useful when a single
 * `beforeAll`/`afterAll` test pair shares one server across many
 * `it(...)` blocks — `resetMockMoonrakerState(state)` clears the
 * captured request history without rebinding the port.
 */
export function resetMockMoonrakerState(state: MockMoonrakerState): void {
  const fresh = freshMockMoonrakerState()
  state.captured = fresh.captured
  state.uploadResponse = fresh.uploadResponse
  state.startResponse = fresh.startResponse
  state.statusResponse = fresh.statusResponse
  state.cancelResponse = fresh.cancelResponse
  state.pauseResponse = fresh.pauseResponse
  state.resumeResponse = fresh.resumeResponse
}

function collectBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/**
 * Boot a fake Moonraker on `127.0.0.1` on a kernel-assigned port.
 * Returns `{server, url}` — pass `url` directly as `printerUrl` to
 * `moonrakerPush(...)` etc.
 *
 * Caller MUST eventually call `stopMockMoonraker(server)` (typically
 * in `afterAll`) so the test runner's event loop can drain.
 */
export function startMockMoonraker(
  state: MockMoonrakerState
): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const body = await collectBody(req)
      state.captured.push({
        method: req.method ?? '',
        path: req.url ?? '',
        contentType: req.headers['content-type'],
        body
      })

      const path = req.url ?? ''
      const method = req.method ?? ''

      const pick = (): { status: number; body: string } => {
        if (method === 'POST' && path === '/server/files/upload') return state.uploadResponse
        if (method === 'POST' && path.startsWith('/printer/print/start')) return state.startResponse
        if (method === 'GET' && path.startsWith('/printer/objects/query')) return state.statusResponse
        if (method === 'POST' && path === '/printer/print/cancel') return state.cancelResponse
        if (method === 'POST' && path === '/printer/print/pause') return state.pauseResponse
        if (method === 'POST' && path === '/printer/print/resume') return state.resumeResponse
        return {
          status: 404,
          body: JSON.stringify({ error: `no mock route for ${method} ${path}` })
        }
      }

      const resp = pick()
      res.writeHead(resp.status, { 'Content-Type': 'application/json' })
      res.end(resp.body)
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo
      resolve({ server, url: `http://127.0.0.1:${addr.port}` })
    })
  })
}

/** Close a fake Moonraker started by `startMockMoonraker`. */
export function stopMockMoonraker(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()))
}
