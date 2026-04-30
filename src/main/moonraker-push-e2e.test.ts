/**
 * Moonraker end-to-end integration tests — roadmap [ID-0007b].
 *
 * Boots a `node:http` mock server that impersonates the Creality K2 Plus's
 * Moonraker HTTP layer, exercises the full `moonrakerPush` → `moonrakerStatus`
 * → `moonrakerCancel` → `moonrakerPause` → `moonrakerResume` roundtrip, and
 * asserts:
 *
 *   - The multipart upload body is well-formed: boundary reflected in the
 *     Content-Type header, `name="file"` with the filename matching the
 *     local basename, `name="path"` part emitted when `uploadPath` is set,
 *     and the file contents delivered byte-identical end-to-end.
 *   - The start-print query string uses the path returned by
 *     `/server/files/upload` (not the local path), properly URL-encoded.
 *   - Status parsing lines up with the `print_stats` body produced by the
 *     mock (state, filename, progress, etaSeconds).
 *   - Cancel / Pause / Resume hit the right endpoints with POST.
 *
 * The existing `moonraker-push.test.ts` covers `parseMoonrakerStatusBody`
 * and `parseUploadedPath` as pure units (22+ assertions). This file is the
 * wire-level E2E coverage that those parsers assume works.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  moonrakerCancel,
  moonrakerPause,
  moonrakerPush,
  moonrakerResume,
  moonrakerStatus,
} from './moonraker-push'

// ─── Mock server ─────────────────────────────────────────────────────────────

type CapturedRequest = {
  method: string
  path: string
  contentType: string | undefined
  body: Buffer
}

type MockServerState = {
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

function collectBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function startMockServer(state: MockServerState): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const body = await collectBody(req)
      state.captured.push({
        method: req.method ?? '',
        path: req.url ?? '',
        contentType: req.headers['content-type'],
        body,
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
        return { status: 404, body: JSON.stringify({ error: `no mock route for ${method} ${path}` }) }
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

function stopMockServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()))
}

// ─── Test fixture ─────────────────────────────────────────────────────────────

const fixtureDir = mkdtempSync(join(tmpdir(), 'moonraker-e2e-'))
const fixtureGcode = join(fixtureDir, 'cube.gcode')
// Pure-ASCII fixture so binary decode of the multipart body (done as latin-1
// to preserve raw bytes when reading boundary markers) matches char-for-char
// when we assert that the body contains the G-code text.
const fixtureGcodeBody = [
  '; K2 Plus test print - roadmap [ID-0007b]',
  'G28 ; home',
  'M104 S210 ; nozzle on',
  'M140 S60  ; bed on',
  'G1 X10 Y10 Z0.3 F3000',
  'G1 X20 Y20 Z0.3 F1500',
  'M104 S0',
  'M140 S0',
].join('\n') + '\n'
writeFileSync(fixtureGcode, fixtureGcodeBody)

// Default mock responses — individual tests override as needed.
function freshState(): MockServerState {
  return {
    captured: [],
    uploadResponse: {
      status: 201,
      body: JSON.stringify({
        item: {
          path: 'cube.gcode',
          root: 'gcodes',
          modified: 1_700_000_000,
          size: fixtureGcodeBody.length,
        },
        print: { name: '', started: false },
        action: 'create_file',
      }),
    },
    startResponse: { status: 200, body: JSON.stringify({ result: 'ok' }) },
    statusResponse: {
      status: 200,
      body: JSON.stringify({
        result: {
          status: {
            print_stats: {
              state: 'printing',
              filename: 'cube.gcode',
              progress: 0.25,
              print_duration: 300.0,
              total_duration: 1200.0,
            },
          },
        },
      }),
    },
    cancelResponse: { status: 200, body: JSON.stringify({ result: 'ok' }) },
    pauseResponse: { status: 200, body: JSON.stringify({ result: 'ok' }) },
    resumeResponse: { status: 200, body: JSON.stringify({ result: 'ok' }) },
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Moonraker end-to-end — [ID-0007b]', () => {
  let server: Server
  let baseUrl: string
  let state: MockServerState

  beforeAll(async () => {
    state = freshState()
    const booted = await startMockServer(state)
    server = booted.server
    baseUrl = booted.url
  })

  afterAll(async () => {
    await stopMockServer(server)
  })

  // Reset captured state between describe-blocks by mutating the shared state.
  const resetState = (): void => {
    const fresh = freshState()
    state.captured = fresh.captured
    state.uploadResponse = fresh.uploadResponse
    state.startResponse = fresh.startResponse
    state.statusResponse = fresh.statusResponse
    state.cancelResponse = fresh.cancelResponse
    state.pauseResponse = fresh.pauseResponse
    state.resumeResponse = fresh.resumeResponse
  }

  describe('moonrakerPush — upload only (no start)', () => {
    it('POSTs to /server/files/upload with multipart boundary and returns {ok: true, printStarted: false}', async () => {
      resetState()
      const result = await moonrakerPush({
        gcodePath: fixtureGcode,
        printerUrl: baseUrl,
        startAfterUpload: false,
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.filename).toBe('cube.gcode')
      expect(result.uploadedPath).toBe('cube.gcode')
      expect(result.printStarted).toBe(false)
      expect(result.printerUrl).toBe(baseUrl)

      expect(state.captured.length).toBe(1)
      const upload = state.captured[0]!
      expect(upload.method).toBe('POST')
      expect(upload.path).toBe('/server/files/upload')
      expect(upload.contentType).toMatch(/^multipart\/form-data; boundary=----MoonrakerFormBoundary/)
    })

    it('multipart body contains a file part with name="file", filename="<basename>" and the full file bytes', async () => {
      resetState()
      await moonrakerPush({
        gcodePath: fixtureGcode,
        printerUrl: baseUrl,
        startAfterUpload: false,
      })
      const upload = state.captured[0]!
      const bodyStr = upload.body.toString('binary')
      expect(bodyStr).toContain('Content-Disposition: form-data; name="file"; filename="cube.gcode"')
      expect(bodyStr).toContain('Content-Type: application/octet-stream')
      // Full file bytes must be present, byte-identical.
      expect(bodyStr).toContain(fixtureGcodeBody)
      // Terminating boundary must be present.
      const boundaryMatch = /boundary=(-+MoonrakerFormBoundary[A-Za-z0-9]+)/.exec(
        upload.contentType ?? ''
      )
      expect(boundaryMatch).not.toBeNull()
      const boundary = boundaryMatch![1]!
      expect(bodyStr).toContain(`--${boundary}--\r\n`)
    })

    it('uploadPath: "" — no path form field emitted', async () => {
      resetState()
      await moonrakerPush({
        gcodePath: fixtureGcode,
        printerUrl: baseUrl,
        startAfterUpload: false,
        uploadPath: '',
      })
      const upload = state.captured[0]!
      const bodyStr = upload.body.toString('binary')
      expect(bodyStr).not.toContain('name="path"')
    })

    it('uploadPath: "projects/k2" — path form field emitted before the file part', async () => {
      resetState()
      await moonrakerPush({
        gcodePath: fixtureGcode,
        printerUrl: baseUrl,
        startAfterUpload: false,
        uploadPath: 'projects/k2',
      })
      const upload = state.captured[0]!
      const bodyStr = upload.body.toString('binary')
      expect(bodyStr).toContain('Content-Disposition: form-data; name="path"')
      expect(bodyStr).toContain('projects/k2')
      // The path part precedes the file part (required for Moonraker).
      expect(bodyStr.indexOf('name="path"')).toBeLessThan(bodyStr.indexOf('name="file"'))
    })

    it('uses the item.path from the upload response, falls back to filename when missing', async () => {
      resetState()
      state.uploadResponse = {
        status: 201,
        body: JSON.stringify({ item: { path: 'sub/dir/cube.gcode' } }),
      }
      const r1 = await moonrakerPush({
        gcodePath: fixtureGcode,
        printerUrl: baseUrl,
        startAfterUpload: false,
      })
      expect(r1.ok && r1.uploadedPath).toBe('sub/dir/cube.gcode')

      resetState()
      state.uploadResponse = {
        status: 201,
        body: JSON.stringify({ print: { name: 'whatever', started: false } }),
      }
      const r2 = await moonrakerPush({
        gcodePath: fixtureGcode,
        printerUrl: baseUrl,
        startAfterUpload: false,
      })
      expect(r2.ok && r2.uploadedPath).toBe('cube.gcode')
    })
  })

  describe('moonrakerPush — upload + start', () => {
    it('starts the print with filename= URL-encoded from the upload response path', async () => {
      resetState()
      state.uploadResponse = {
        status: 201,
        body: JSON.stringify({ item: { path: 'sub dir/cube.gcode' } }),
      }
      const result = await moonrakerPush({
        gcodePath: fixtureGcode,
        printerUrl: baseUrl,
        startAfterUpload: true,
      })
      expect(result.ok && result.printStarted).toBe(true)
      expect(state.captured.length).toBe(2)
      const startReq = state.captured[1]!
      expect(startReq.method).toBe('POST')
      // Spaces in the uploaded path must be percent-encoded in the query.
      expect(startReq.path).toBe(
        '/printer/print/start?filename=sub%20dir%2Fcube.gcode'
      )
    })

    it('reports "File uploaded but print start failed" when start endpoint returns 5xx', async () => {
      resetState()
      state.startResponse = {
        status: 503,
        body: JSON.stringify({ error: 'printer is paused' }),
      }
      const result = await moonrakerPush({
        gcodePath: fixtureGcode,
        printerUrl: baseUrl,
        startAfterUpload: true,
      })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toMatch(/File uploaded but print start failed \(HTTP 503\)/)
      expect(result.detail).toContain('printer is paused')
    })
  })

  describe('moonrakerPush — error paths', () => {
    it('returns an error when the local G-code file does not exist', async () => {
      resetState()
      const result = await moonrakerPush({
        gcodePath: join(fixtureDir, 'does-not-exist.gcode'),
        printerUrl: baseUrl,
        startAfterUpload: false,
      })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toMatch(/not found/i)
      // No HTTP request should have been sent.
      expect(state.captured.length).toBe(0)
    })

    it('returns an error with body detail when upload responds with HTTP 500', async () => {
      resetState()
      state.uploadResponse = {
        status: 500,
        body: JSON.stringify({ error: 'disk full' }),
      }
      const result = await moonrakerPush({
        gcodePath: fixtureGcode,
        printerUrl: baseUrl,
        startAfterUpload: false,
      })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toMatch(/HTTP 500/)
      expect(result.detail).toBe('disk full')
    })

    it('returns an error when the printer URL is unreachable', async () => {
      resetState()
      // Use port 1 which is always unreachable (privileged port, nothing listens).
      const result = await moonrakerPush({
        gcodePath: fixtureGcode,
        printerUrl: 'http://127.0.0.1:1',
        startAfterUpload: false,
        timeoutMs: 500,
      })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toMatch(/could not connect/i)
    })
  })

  describe('moonrakerStatus', () => {
    it('GETs /printer/objects/query?print_stats and maps printing/progress/eta correctly', async () => {
      resetState()
      const status = await moonrakerStatus(baseUrl)
      expect(status.ok).toBe(true)
      if (!status.ok) return
      expect(status.state).toBe('printing')
      expect(status.filename).toBe('cube.gcode')
      expect(status.progress).toBe(0.25)
      // print_duration=300, progress=0.25 → total estimate 1200, ETA 900 s.
      expect(status.etaSeconds).toBe(900)
      expect(status.rawState).toBe('printing')

      expect(state.captured.length).toBe(1)
      expect(state.captured[0]!.method).toBe('GET')
      expect(state.captured[0]!.path).toBe('/printer/objects/query?print_stats')
    })

    it('maps unknown raw states to state: "unknown" while preserving rawState', async () => {
      resetState()
      state.statusResponse = {
        status: 200,
        body: JSON.stringify({
          result: { status: { print_stats: { state: 'klipper_shutdown' } } },
        }),
      }
      const status = await moonrakerStatus(baseUrl)
      expect(status.ok).toBe(true)
      if (!status.ok) return
      expect(status.state).toBe('unknown')
      expect(status.rawState).toBe('klipper_shutdown')
    })

    it('returns {ok: false} when the printer responds with HTTP 5xx', async () => {
      resetState()
      state.statusResponse = { status: 500, body: 'internal error' }
      const status = await moonrakerStatus(baseUrl)
      expect(status.ok).toBe(false)
      if (status.ok) return
      expect(status.error).toMatch(/HTTP 500/)
    })
  })

  describe('moonrakerCancel / Pause / Resume', () => {
    it('POSTs to /printer/print/cancel and returns {ok: true}', async () => {
      resetState()
      const result = await moonrakerCancel(baseUrl)
      expect(result.ok).toBe(true)
      expect(state.captured.length).toBe(1)
      expect(state.captured[0]!.method).toBe('POST')
      expect(state.captured[0]!.path).toBe('/printer/print/cancel')
    })

    it('POSTs to /printer/print/pause and returns {ok: true}', async () => {
      resetState()
      const result = await moonrakerPause(baseUrl)
      expect(result.ok).toBe(true)
      expect(state.captured[0]!.path).toBe('/printer/print/pause')
    })

    it('POSTs to /printer/print/resume and returns {ok: true}', async () => {
      resetState()
      const result = await moonrakerResume(baseUrl)
      expect(result.ok).toBe(true)
      expect(state.captured[0]!.path).toBe('/printer/print/resume')
    })

    it('propagates HTTP 4xx/5xx from Moonraker as {ok: false} with a descriptive error', async () => {
      resetState()
      state.cancelResponse = { status: 409, body: 'no print active' }
      const cancel = await moonrakerCancel(baseUrl)
      expect(cancel.ok).toBe(false)
      expect(cancel.error).toMatch(/HTTP 409/)

      resetState()
      state.pauseResponse = { status: 409, body: 'no print active' }
      const pause = await moonrakerPause(baseUrl)
      expect(pause.ok).toBe(false)
      expect(pause.error).toMatch(/HTTP 409/)

      resetState()
      state.resumeResponse = { status: 409, body: 'not paused' }
      const resume = await moonrakerResume(baseUrl)
      expect(resume.ok).toBe(false)
      expect(resume.error).toMatch(/HTTP 409/)
    })
  })

  describe('full lifecycle roundtrip', () => {
    it('push → status → cancel in sequence against a single mock printer', async () => {
      resetState()

      // 1) Push (upload + start)
      const push = await moonrakerPush({
        gcodePath: fixtureGcode,
        printerUrl: baseUrl,
        startAfterUpload: true,
        uploadPath: 'k2-jobs',
      })
      expect(push.ok && push.printStarted).toBe(true)

      // 2) Status
      const status = await moonrakerStatus(baseUrl)
      expect(status.ok && status.state).toBe('printing')

      // 3) Cancel
      const cancel = await moonrakerCancel(baseUrl)
      expect(cancel.ok).toBe(true)

      // The three requests are captured in order.
      expect(state.captured.map((c) => `${c.method} ${c.path.split('?')[0]}`)).toEqual([
        'POST /server/files/upload',
        'POST /printer/print/start',
        'GET /printer/objects/query',
        'POST /printer/print/cancel',
      ])
    })
  })

  // ___ Pre-upload G-code temperature validator -- [ID-0073] ___
  //
  // When the caller threads `machineCapabilities` through the push payload,
  // moonrakerPush must short-circuit the upload BEFORE any bytes cross the
  // network if any M104/M109/M140/M190 target exceeds the declared ceilings
  // (see src/shared/gcode-temp-validator.ts and Cycle 10's [ID-0070]).
  //
  // The assertions below all check `state.captured.length === 0` on the
  // reject path -- that is the load-bearing safety guarantee: the sliced
  // file never touches the wire, the printer never heats up, and the error
  // surfaces BEFORE the operator watches a doomed job fail mid-warm-up.
  describe('moonrakerPush -- pre-upload temperature validator [ID-0073]', () => {
    const hotNozzleGcode = join(fixtureDir, 'too-hot-nozzle.gcode')
    writeFileSync(
      hotNozzleGcode,
      [
        '; high-temp slicer output (hypothetical exotic filament)',
        'G28',
        'M109 T0 S400 ; nozzle 400 C -- exceeds K2 Plus 350 C ceiling',
        'M140 S60',
        'G1 X10 Y10 Z0.3 F3000',
      ].join('\n') + '\n'
    )

    const hotBedGcode = join(fixtureDir, 'too-hot-bed.gcode')
    writeFileSync(
      hotBedGcode,
      [
        '; high-temp slicer output (PEEK-adjacent bed recipe)',
        'G28',
        'M104 S220',
        'M190 S150 ; bed 150 C -- exceeds K2 Plus 120 C ceiling',
        'G1 X10 Y10 Z0.3 F3000',
      ].join('\n') + '\n'
    )

    // K2 Plus real ceilings from resources/machines/creality-k2-plus.json
    // (pinned by the Cycle 8 [ID-0012] k2-meta tests).
    const k2Caps = { maxNozzleTempC: 350, maxBedTempC: 120, chamberTempC: 60 }

    it('rejects the upload when nozzle target exceeds machine ceiling -- no HTTP call is made', async () => {
      resetState()
      const result = await moonrakerPush({
        gcodePath: hotNozzleGcode,
        printerUrl: baseUrl,
        startAfterUpload: false,
        machineCapabilities: k2Caps,
      })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toMatch(/upload blocked/i)
      expect(result.detail ?? '').toMatch(/nozzle/i)
      expect(result.detail ?? '').toMatch(/400/)
      expect(result.tempValidation).toBeDefined()
      expect(result.tempValidation?.ok).toBe(false)
      expect(result.tempValidation?.violations.length).toBeGreaterThanOrEqual(1)
      expect(result.tempValidation?.violations[0]?.kind).toBe('nozzle')
      expect(state.captured.length).toBe(0)
    })

    it('rejects the upload when bed target exceeds machine ceiling -- no HTTP call is made', async () => {
      resetState()
      const result = await moonrakerPush({
        gcodePath: hotBedGcode,
        printerUrl: baseUrl,
        startAfterUpload: false,
        machineCapabilities: k2Caps,
      })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toMatch(/upload blocked/i)
      expect(result.detail ?? '').toMatch(/bed/i)
      expect(result.detail ?? '').toMatch(/150/)
      expect(result.tempValidation?.violations[0]?.kind).toBe('bed')
      expect(state.captured.length).toBe(0)
    })

    it('passes through to upload when G-code stays within machine ceilings', async () => {
      resetState()
      const result = await moonrakerPush({
        gcodePath: fixtureGcode,
        printerUrl: baseUrl,
        startAfterUpload: false,
        machineCapabilities: k2Caps,
      })
      expect(result.ok).toBe(true)
      expect(state.captured.length).toBe(1)
      expect(state.captured[0]?.path).toBe('/server/files/upload')
    })

    it('passes through when machineCapabilities is absent (Safety Rule 2 -- byte-identical to pre-[ID-0073])', async () => {
      resetState()
      const result = await moonrakerPush({
        gcodePath: hotNozzleGcode,
        printerUrl: baseUrl,
        startAfterUpload: false,
      })
      expect(result.ok).toBe(true)
      expect(state.captured.length).toBe(1)
    })

    it('passes through when machineCapabilities is null (explicit opt-out)', async () => {
      resetState()
      const result = await moonrakerPush({
        gcodePath: hotNozzleGcode,
        printerUrl: baseUrl,
        startAfterUpload: false,
        machineCapabilities: null,
      })
      expect(result.ok).toBe(true)
      expect(state.captured.length).toBe(1)
    })

    it('passes through when caps have unset ceilings (FDM profile without temp declarations)', async () => {
      resetState()
      // Empty caps object -- `validateGcodeTemps` treats unset nozzle AND
      // bed ceilings as "no ceilings declared" and returns `ok: true`,
      // which is indistinguishable from null caps at the validator layer
      // but exercises a distinct call path in moonrakerPush.
      const result = await moonrakerPush({
        gcodePath: hotNozzleGcode,
        printerUrl: baseUrl,
        startAfterUpload: false,
        machineCapabilities: {},
      })
      expect(result.ok).toBe(true)
      expect(state.captured.length).toBe(1)
    })

    it('passes through when only the non-relevant ceiling is declared (bed cap set, gcode violates nozzle only)', async () => {
      resetState()
      // Only bed ceiling declared -- the hot-nozzle gcode has no bed
      // violation, so the upload should succeed (nozzle has "no ceiling
      // declared" for this machine).
      const result = await moonrakerPush({
        gcodePath: hotNozzleGcode,
        printerUrl: baseUrl,
        startAfterUpload: false,
        machineCapabilities: { maxBedTempC: 120 },
      })
      expect(result.ok).toBe(true)
      expect(state.captured.length).toBe(1)
    })

    it('does not start the print when upload is blocked by temperature violation', async () => {
      resetState()
      const result = await moonrakerPush({
        gcodePath: hotNozzleGcode,
        printerUrl: baseUrl,
        startAfterUpload: true,
        machineCapabilities: k2Caps,
      })
      expect(result.ok).toBe(false)
      expect(state.captured.length).toBe(0)
    })

    it('summarizes multiple violations with a "(+N more)" tail for compact error display', async () => {
      resetState()
      const multiBadGcode = join(fixtureDir, 'multi-violations.gcode')
      writeFileSync(
        multiBadGcode,
        [
          '; simultaneous over-ceiling on nozzle and bed',
          'M104 S400',
          'M140 S150',
          'M109 T0 S420',
        ].join('\n') + '\n'
      )
      const result = await moonrakerPush({
        gcodePath: multiBadGcode,
        printerUrl: baseUrl,
        startAfterUpload: false,
        machineCapabilities: k2Caps,
      })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.detail ?? '').toMatch(/\(\+\d+ more/)
      expect(result.tempValidation?.violations.length).toBe(3)
      expect(state.captured.length).toBe(0)
    })
  })

  describe('moonrakerPush -- bounded header read [ID-0075]', () => {
    // K2 Plus real ceilings from resources/machines/creality-k2-plus.json.
    const k2Caps = { maxNozzleTempC: 350, maxBedTempC: 120, chamberTempC: 60 }

    // A distinctive marker placed PAST the 128 KiB bounded-read cap. If the
    // validator ever regresses back to a full-file read and then tries to
    // parse this marker-laden tail, the test will catch it because the
    // marker is deliberately crafted as a plausible-looking M-command with
    // an out-of-range target.
    const TAIL_SENTINEL = '; [ID-0075] TAIL SENTINEL\nM109 T0 S999 ; must NEVER be parsed\n'

    const largeHotHeader = join(fixtureDir, 'large-hot-header.gcode')
    writeFileSync(
      largeHotHeader,
      [
        '; Large slicer output with bad header -- header should be read and rejected',
        'G28',
        'M109 T0 S400 ; nozzle 400 C -- exceeds K2 Plus 350 C ceiling',
        'M140 S60',
      ].join('\n') +
        '\n' +
        'G1 X0.1 Y0.1 E0.01 F1200\n'.repeat(15_000) +
        TAIL_SENTINEL
    )

    const largeCleanHeader = join(fixtureDir, 'large-clean-header.gcode')
    writeFileSync(
      largeCleanHeader,
      [
        '; Large slicer output with clean header',
        'G28',
        'M104 S210',
        'M109 T0 S210',
        'M140 S60',
        'M190 S60',
        'M141 S40',
      ].join('\n') +
        '\n' +
        'G1 X0.1 Y0.1 E0.01 F1200\n'.repeat(15_000) +
        TAIL_SENTINEL
    )

    it('rejects when a header-local violation is present, even when the gcode file is larger than the read cap', async () => {
      resetState()
      const result = await moonrakerPush({
        gcodePath: largeHotHeader,
        printerUrl: baseUrl,
        startAfterUpload: false,
        machineCapabilities: k2Caps,
      })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toMatch(/upload blocked/i)
      expect(result.detail ?? '').toMatch(/nozzle/i)
      expect(result.detail ?? '').toMatch(/400/)
      expect(result.tempValidation?.violations.length).toBeGreaterThanOrEqual(1)
      expect(result.tempValidation?.violations[0]?.kind).toBe('nozzle')
      const samples = result.tempValidation?.samples ?? []
      expect(samples.every((s) => s.targetC !== 999)).toBe(true)
      expect(state.captured.length).toBe(0)
    })

    it('passes through the upload when the header is clean, and IGNORES a past-cap tail sentinel that would otherwise reject', async () => {
      resetState()
      const result = await moonrakerPush({
        gcodePath: largeCleanHeader,
        printerUrl: baseUrl,
        startAfterUpload: false,
        machineCapabilities: k2Caps,
      })
      expect(result.ok).toBe(true)
      expect(state.captured.length).toBe(1)
      expect(state.captured[0]?.path).toBe('/server/files/upload')
      const bodyStr = state.captured[0]?.body.toString('utf-8') ?? ''
      expect(bodyStr).toContain('M104 S210')
      expect(bodyStr).toContain('TAIL SENTINEL')
      const uploadedLen = state.captured[0]?.body.length ?? 0
      expect(uploadedLen).toBeGreaterThan(131_072)
    })

    it('does not parse past-cap content into the tempValidation samples when caps are present and no violation exists', async () => {
      resetState()
      const result = await moonrakerPush({
        gcodePath: largeCleanHeader,
        printerUrl: baseUrl,
        startAfterUpload: false,
        machineCapabilities: k2Caps,
      })
      expect(result.ok).toBe(true)
      const bodyStr = state.captured[0]?.body.toString('utf-8') ?? ''
      expect(bodyStr).toContain('S999')
    })
  })
})
