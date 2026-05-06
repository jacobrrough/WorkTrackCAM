/**
 * Creality K2 Plus -- Moonraker upload contract pins -- [ID-0007b-followup]
 *
 * Cycle 64 test-coverage. Pins the 5 documented Moonraker upload invariants
 * from `.claude/skills/gcode-safety/references/k2-plus-fdm.md` against the
 * production behavior of `moonrakerPush()` in `src/main/moonraker-push.ts`.
 *
 * Each invariant gets paired pins: a doc-text pin (the reference file must
 * still document the invariant in load-bearing wording) and a code-behavior
 * pin (the production helper must still implement it on the wire). If
 * either pin fails, the next docs-and-dx cycle (or the next code change)
 * has to reconcile the drift before merging.
 *
 * Sibling-file precedent:
 *   - `src/main/moonraker-push-e2e.test.ts` exercises the wire-level happy
 *     path / error paths / temperature validator. This file complements
 *     that with doc-tied invariant pins (a different failure mode: doc-vs-
 *     -code drift, not wire-protocol regression).
 *   - `src/shared/edit-workflow-docs-pin.test.ts` is the shape this file
 *     follows: doc-text pins keep the reference doc honest while code-
 *     behavior pins keep the implementation honest.
 *
 * Safety posture:
 *   - Safety Rule 1 (G-code is sacred): no G-code emitted; pure delivery-
 *     mechanism contract.
 *   - Safety Rule 2 (additive/optional): no schema changes; new test file
 *     only, references the existing `moonrakerPush` public surface.
 *   - Safety Rule 4 (no security vulnerabilities): mock server binds to
 *     127.0.0.1 ephemeral port; no real printer contacted.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { moonrakerPush } from './moonraker-push'

// ─── Reference doc (single source of truth for invariant wording) ────────────

const REFERENCE_PATH = join(
  process.cwd(),
  '.claude',
  'skills',
  'gcode-safety',
  'references',
  'k2-plus-fdm.md'
)
const referenceText = readFileSync(REFERENCE_PATH, 'utf-8')

// ─── Mock Moonraker server ────────────────────────────────────────────────────

type CapturedRequest = {
  method: string
  path: string
  contentType: string | undefined
  body: Buffer
}

type ServerControl = {
  captured: CapturedRequest[]
  uploadStatus: number
  uploadBody: string
  startStatus: number
  startBody: string
}

let server: Server
let baseUrl: string
const ctl: ServerControl = {
  captured: [],
  uploadStatus: 201,
  uploadBody: JSON.stringify({ item: { path: 'cube.gcode' } }),
  startStatus: 200,
  startBody: JSON.stringify({ result: 'ok' }),
}

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      ctl.captured.push({
        method: req.method ?? '',
        path: req.url ?? '',
        contentType: req.headers['content-type'],
        body: Buffer.concat(chunks),
      })
      const path = req.url ?? ''
      const method = req.method ?? ''
      if (method === 'POST' && path === '/server/files/upload') {
        res.writeHead(ctl.uploadStatus, { 'Content-Type': 'application/json' })
        res.end(ctl.uploadBody)
        return
      }
      if (method === 'POST' && path.startsWith('/printer/print/start')) {
        res.writeHead(ctl.startStatus, { 'Content-Type': 'application/json' })
        res.end(ctl.startBody)
        return
      }
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: `no mock route for ${method} ${path}` }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const addr = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${addr.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

function reset(): void {
  ctl.captured.length = 0
  ctl.uploadStatus = 201
  ctl.uploadBody = JSON.stringify({ item: { path: 'cube.gcode' } })
  ctl.startStatus = 200
  ctl.startBody = JSON.stringify({ result: 'ok' })
}

// ─── Fixture (pure-ASCII so multipart byte assertions are stable) ────────────

const fixtureDir = mkdtempSync(join(tmpdir(), 'k2-moonraker-contract-'))
const gcodeFile = join(fixtureDir, 'cube.gcode')
const gcodeBody =
  '; K2 Plus contract pin fixture\nG28\nM104 S210\nM140 S60\nG1 X10 Y10 Z0.3 F3000\n'
writeFileSync(gcodeFile, gcodeBody)

// ─── Invariant 1: endpoint is /server/files/upload (multipart/form-data) ─────

describe('K2 Plus Moonraker upload contract -- endpoint [ID-0007b-followup]', () => {
  it('reference doc still names /server/files/upload as the canonical endpoint', () => {
    expect(referenceText).toMatch(/Endpoint is `\/server\/files\/upload`/)
  })

  it('reference doc still names multipart/form-data as the upload encoding', () => {
    expect(referenceText).toMatch(/multipart\/form-data/)
  })

  it('moonrakerPush POSTs to /server/files/upload with multipart/form-data body', async () => {
    reset()
    await moonrakerPush({
      gcodePath: gcodeFile,
      printerUrl: baseUrl,
      startAfterUpload: false,
    })
    expect(ctl.captured).toHaveLength(1)
    const req = ctl.captured[0]!
    expect(req.method).toBe('POST')
    expect(req.path).toBe('/server/files/upload')
    expect(req.contentType ?? '').toMatch(/^multipart\/form-data; boundary=/)
  })

  it('moonrakerPush builds the upload URL by appending /server/files/upload to the printerUrl base (handles trailing-slash normalization)', async () => {
    reset()
    // Trailing-slash on printerUrl must NOT yield a double-slash on the wire.
    await moonrakerPush({
      gcodePath: gcodeFile,
      printerUrl: `${baseUrl}/`,
      startAfterUpload: false,
    })
    expect(ctl.captured).toHaveLength(1)
    expect(ctl.captured[0]!.path).toBe('/server/files/upload')
  })
})

// ─── Invariant 2: root form field is `gcodes` (Moonraker default) ────────────

describe('K2 Plus Moonraker upload contract -- gcodes root [ID-0007b-followup]', () => {
  it('reference doc still requires the file land under the gcodes root for Fluidd visibility', () => {
    expect(referenceText).toMatch(/`root` form field must be `gcodes`/)
    expect(referenceText).toMatch(/Fluidd lists the file/)
  })

  it('moonrakerPush relies on Moonraker default root by NOT emitting an explicit name="root" form field (Moonraker defaults to gcodes when root is omitted)', async () => {
    reset()
    await moonrakerPush({
      gcodePath: gcodeFile,
      printerUrl: baseUrl,
      startAfterUpload: false,
    })
    const bodyStr = ctl.captured[0]!.body.toString('binary')
    // ASSUMPTION: Moonraker's documented behavior is that without an
    // explicit `root` form field, it places uploads under `gcodes`
    // (the only writable root on a stock K2 Plus). The contract pin is
    // that we DO NOT override the default to anything else (e.g. `config`,
    // `gcodes_ssd`). If a future change starts emitting `name="root"`,
    // this pin fails -- the next docs-and-dx pass needs to reconcile
    // the doc + post.
    expect(bodyStr).not.toMatch(/Content-Disposition:\s*form-data;\s*name="root"/i)
  })

  it('moonrakerPush also omits the path form field when uploadPath is empty (delegates root selection to Moonraker default)', async () => {
    reset()
    await moonrakerPush({
      gcodePath: gcodeFile,
      printerUrl: baseUrl,
      startAfterUpload: false,
      uploadPath: '',
    })
    const bodyStr = ctl.captured[0]!.body.toString('binary')
    expect(bodyStr).not.toContain('name="path"')
  })

  it('moonrakerPush emits the path form field BEFORE the file part when uploadPath is set (Moonraker requires path-then-file ordering)', async () => {
    reset()
    await moonrakerPush({
      gcodePath: gcodeFile,
      printerUrl: baseUrl,
      startAfterUpload: false,
      uploadPath: 'k2-jobs',
    })
    const bodyStr = ctl.captured[0]!.body.toString('binary')
    const pathIdx = bodyStr.indexOf('name="path"')
    const fileIdx = bodyStr.indexOf('name="file"')
    expect(pathIdx).toBeGreaterThan(-1)
    expect(fileIdx).toBeGreaterThan(-1)
    expect(pathIdx).toBeLessThan(fileIdx)
  })
})

// ─── Invariant 3: filename ends in .gcode ────────────────────────────────────

describe('K2 Plus Moonraker upload contract -- .gcode filename [ID-0007b-followup]', () => {
  it('reference doc still requires the filename end in .gcode (not .g or .nc)', () => {
    expect(referenceText).toMatch(/filename must end in `\.gcode`/)
    expect(referenceText).toMatch(/not `\.g` or `\.nc`/)
    expect(referenceText).toMatch(/Fluidd's listing filters these out/)
  })

  it('moonrakerPush preserves the .gcode extension end-to-end via basename(gcodePath)', async () => {
    reset()
    await moonrakerPush({
      gcodePath: gcodeFile,
      printerUrl: baseUrl,
      startAfterUpload: false,
    })
    const bodyStr = ctl.captured[0]!.body.toString('binary')
    expect(bodyStr).toMatch(
      /Content-Disposition: form-data; name="file"; filename="cube\.gcode"/
    )
  })

  it('moonrakerPush surfaces a non-.gcode filename verbatim (helper is a transport, NOT a validator -- extension contract is upstream slicer responsibility)', async () => {
    // ASSUMPTION: moonrakerPush is a transport, not a validator. The
    // .gcode extension contract is enforced upstream (slicer output naming
    // + the Manufacture pipeline's file-export step). This pin documents
    // that moonrakerPush itself does not silently mutate the extension --
    // a future change that auto-suffixes .gcode would break this assertion
    // and force an explicit doc update on `references/k2-plus-fdm.md`.
    reset()
    const odd = join(fixtureDir, 'odd-extension.g')
    writeFileSync(odd, gcodeBody)
    await moonrakerPush({
      gcodePath: odd,
      printerUrl: baseUrl,
      startAfterUpload: false,
    })
    const bodyStr = ctl.captured[0]!.body.toString('binary')
    expect(bodyStr).toMatch(/filename="odd-extension\.g"/)
  })
})

// ─── Invariant 4: HTTP 201 success / 4xx-5xx surfaces error body ─────────────

describe('K2 Plus Moonraker upload contract -- HTTP status handling [ID-0007b-followup]', () => {
  it('reference doc still names HTTP 201 as the canonical success status', () => {
    expect(referenceText).toMatch(/HTTP status 201 on success/)
  })

  it('reference doc still requires 4xx/5xx surface the error body rather than silent failure', () => {
    expect(referenceText).toMatch(/4xx\/5xx, surface the error body/)
    expect(referenceText).toMatch(/rather than silently failing/)
  })

  it('moonrakerPush accepts HTTP 201 (canonical Moonraker success) as ok=true', async () => {
    reset()
    ctl.uploadStatus = 201
    ctl.uploadBody = JSON.stringify({ item: { path: 'cube.gcode' } })
    const result = await moonrakerPush({
      gcodePath: gcodeFile,
      printerUrl: baseUrl,
      startAfterUpload: false,
    })
    expect(result.ok).toBe(true)
  })

  it('moonrakerPush surfaces HTTP 4xx body via .detail (not silent failure)', async () => {
    reset()
    ctl.uploadStatus = 413
    ctl.uploadBody = JSON.stringify({ error: 'file too large' })
    const result = await moonrakerPush({
      gcodePath: gcodeFile,
      printerUrl: baseUrl,
      startAfterUpload: false,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/HTTP 413/)
    expect(result.detail).toBe('file too large')
  })

  it('moonrakerPush surfaces HTTP 5xx body via .detail (not silent failure)', async () => {
    reset()
    ctl.uploadStatus = 503
    ctl.uploadBody = 'Service Unavailable -- printer rebooting'
    const result = await moonrakerPush({
      gcodePath: gcodeFile,
      printerUrl: baseUrl,
      startAfterUpload: false,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/HTTP 503/)
    expect(result.detail).toContain('Service Unavailable')
  })

  it('moonrakerPush surfaces a non-JSON error body as raw .detail (slicing the first 300 chars to keep error toasts compact)', async () => {
    reset()
    ctl.uploadStatus = 502
    ctl.uploadBody = 'Bad Gateway -- nginx upstream timeout'
    const result = await moonrakerPush({
      gcodePath: gcodeFile,
      printerUrl: baseUrl,
      startAfterUpload: false,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/HTTP 502/)
    expect(result.detail).toContain('Bad Gateway')
  })
})

// ─── Invariant 5: do NOT auto-start the print ────────────────────────────────

describe('K2 Plus Moonraker upload contract -- operator-confirms-start [ID-0007b-followup]', () => {
  it('reference doc still requires the operator confirm the print on the machine (no auto-start)', () => {
    expect(referenceText).toMatch(/Do NOT auto-start the print after upload/)
    expect(referenceText).toMatch(/operator confirms on the machine/)
    expect(referenceText).toMatch(/Upload only\./)
  })

  it('moonrakerPush leaves startAfterUpload defaulted to false (only POST /server/files/upload is hit, no /printer/print/start)', async () => {
    reset()
    await moonrakerPush({
      gcodePath: gcodeFile,
      printerUrl: baseUrl,
      // startAfterUpload omitted -- contract pin
    })
    expect(ctl.captured).toHaveLength(1)
    expect(ctl.captured[0]!.path).toBe('/server/files/upload')
  })

  it('result.printStarted is false on a default upload (no auto-start)', async () => {
    reset()
    const result = await moonrakerPush({
      gcodePath: gcodeFile,
      printerUrl: baseUrl,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.printStarted).toBe(false)
  })

  it('moonrakerPush only hits /printer/print/start when startAfterUpload is EXPLICITLY true (escape hatch documented for trusted-operator workflows)', async () => {
    reset()
    await moonrakerPush({
      gcodePath: gcodeFile,
      printerUrl: baseUrl,
      startAfterUpload: true,
    })
    expect(ctl.captured).toHaveLength(2)
    expect(ctl.captured[1]!.path).toMatch(/^\/printer\/print\/start\?filename=/)
  })
})

// ─── Cross-cutting pin: machine scope (CLAUDE.md My-Shop-Only Mode) ─────────

describe('K2 Plus Moonraker upload contract -- machine scope [ID-0007b-followup]', () => {
  it('reference doc carries the K2 Plus machine identifier and Klipper/Moonraker firmware tag in its preamble', () => {
    expect(referenceText).toMatch(/Creality K2 Plus/)
    expect(referenceText).toMatch(/Klipper-based OS with Moonraker/)
  })

  it('reference doc names the bundled machine profile and post template by path', () => {
    expect(referenceText).toMatch(/`resources\/machines\/creality-k2-plus\.json`/)
    expect(referenceText).toMatch(/`resources\/posts\/fdm_passthrough\.hbs`/)
  })
})
