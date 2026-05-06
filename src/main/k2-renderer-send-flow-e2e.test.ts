/**
 * Phase 2 [P2-K2-PUSH]/Cycle 350 -- renderer-paired integration test
 * for the K2 Plus "Send to Printer" click flow.
 *
 * Why this file
 * -------------
 * The existing wire-level coverage in `moonraker-push-e2e.test.ts`
 * (30 tests) drives `moonrakerPush` directly with hand-built payload
 * shapes. That suite proves the main-process helper speaks the right
 * Moonraker REST dialect, but it does NOT prove that the payload the
 * renderer's `Send to K2 Plus` button builds at
 * `src/renderer/manufacture/ManufactureAuxPanels.tsx:147-154`
 * (via `buildMoonrakerPushPayload(...)`) survives the round trip
 * through `moonrakerPush` against the mock-Moonraker harness.
 *
 * The directive Priority 3 from `daily-directives.md` calls for a
 * "renderer interaction test next to the backend integration test"
 * paired with the mock-Moonraker harness. Without `jsdom` /
 * `@testing-library/react` in this repo (verified via
 * `package.json` -- only `react-dom/server.renderToStaticMarkup` is
 * available), the closest equivalent is to exercise the renderer's
 * payload-builder + `moonrakerPush` boundary as a single unit: same
 * code path the IPC handler runs, identical inputs to what the click
 * handler produces. The render-only gating tests live in
 * `src/renderer/manufacture/manufacture-aux-k2-send-render.test.tsx`
 * (9 tests, C349). This file complements them by exercising the
 * dynamic dispatch the static markup tests cannot reach.
 *
 * Cross-layer scope
 * -----------------
 * INPUT layer: renderer-shaped `ShopJobForPush` mirroring the
 * `SliceManufacturePanel`'s call site -- `gcodeOut`,
 * `printerUrl`, `machineId`. Same `{startAfterUpload: true}` opts
 * the renderer passes.
 *
 * BUILDER layer: `buildMoonrakerPushPayload` from
 * `src/renderer/src/moonraker-push-payload.ts` (the renderer's
 * payload-construction helper, paired pin C349).
 *
 * TRANSPORT layer: `moonrakerPush` from
 * `src/main/moonraker-push.ts` (the function `ipc-fabrication.ts`'s
 * `moonraker:push` handler delegates to after capability
 * resolution).
 *
 * MOCK layer: `__mocks__/moonraker-fake.ts`'s
 * `startMockMoonraker` -- captures the wire request stream so
 * assertions can pin both ordering and contents.
 *
 * Three-machine cross-cut: DIRECT on Creality K2 Plus only. Laguna
 * Swift + Carvera do not surface the Send button (gated by
 * `kind === 'fdm'`); the closure of this cycle's check would be
 * caught upstream in `manufacture-aux-k2-send-render.test.tsx`.
 *
 * Safety posture:
 *   - Safety Rule 1 (G-code is sacred): zero G-code emitted; this is
 *     a transport contract test. The fixture is a 7-line ASCII stub.
 *   - Safety Rule 2 (additive/optional): no production code changes;
 *     test-only file referencing existing public surfaces.
 *   - Safety Rule 4 (no security vulnerabilities): mock binds
 *     127.0.0.1:0 (kernel-assigned, never public); no real printer
 *     contacted.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { moonrakerPush } from './moonraker-push'
import {
  freshMockMoonrakerState,
  resetMockMoonrakerState,
  startMockMoonraker,
  stopMockMoonraker,
  type MockMoonrakerState
} from './__mocks__/moonraker-fake'
import { buildMoonrakerPushPayload } from '../renderer/src/moonraker-push-payload'

// ─── Fixture ─────────────────────────────────────────────────────────────────

const fixtureDir = mkdtempSync(join(tmpdir(), 'k2-renderer-flow-'))
const fixtureGcode = join(fixtureDir, 'cube.gcode')
const fixtureGcodeBody =
  '; K2 Plus renderer-flow fixture\n' +
  'G28\n' +
  'M104 S210\n' +
  'M140 S60\n' +
  'G1 X10 Y10 Z0.3 F3000\n' +
  'M104 S0\n' +
  'M140 S0\n'
writeFileSync(fixtureGcode, fixtureGcodeBody)

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('K2 Plus Send-to-Printer renderer-flow E2E -- [P2-K2-PUSH]', () => {
  let server: Server
  let baseUrl: string
  let state: MockMoonrakerState

  beforeAll(async () => {
    state = freshMockMoonrakerState()
    const booted = await startMockMoonraker(state)
    server = booted.server
    baseUrl = booted.url
  })

  afterAll(async () => {
    await stopMockMoonraker(server)
  })

  const reset = (): void => {
    resetMockMoonrakerState(state)
  }

  describe('happy path -- click handler payload threads through wire', () => {
    it('renderer payload + moonrakerPush hits upload then start in that exact order', async () => {
      reset()
      // Mirror the renderer's call site in
      // SliceManufacturePanel.sendToK2Plus():
      //   buildMoonrakerPushPayload(
      //     { gcodeOut, printerUrl, machineId },
      //     { startAfterUpload: true }
      //   )
      const payload = buildMoonrakerPushPayload(
        {
          gcodeOut: fixtureGcode,
          printerUrl: baseUrl,
          machineId: 'creality-k2-plus'
        },
        { startAfterUpload: true }
      )

      const result = await moonrakerPush(payload)

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.printStarted).toBe(true)
      expect(result.filename).toBe('cube.gcode')

      // Upload first, then start. Order matters -- /printer/print/start
      // before /server/files/upload would mean the printer is asked to
      // print a file it has not received yet.
      expect(state.captured.length).toBe(2)
      expect(state.captured[0]?.method).toBe('POST')
      expect(state.captured[0]?.path).toBe('/server/files/upload')
      expect(state.captured[1]?.method).toBe('POST')
      expect(state.captured[1]?.path).toMatch(/^\/printer\/print\/start\?filename=/)
    })

    it('start URL carries the uploaded path returned by Moonraker (not the local OS path)', async () => {
      reset()
      // The mock's default upload response sets `item.path = "cube.gcode"`,
      // so the start URL must use that, not the absolute fixture path.
      const payload = buildMoonrakerPushPayload(
        {
          gcodeOut: fixtureGcode,
          printerUrl: baseUrl,
          machineId: 'creality-k2-plus'
        },
        { startAfterUpload: true }
      )
      await moonrakerPush(payload)

      const startReq = state.captured[1]
      expect(startReq?.path).toBe('/printer/print/start?filename=cube.gcode')
      // Negative pin: never let an OS-absolute path leak into the URL --
      // would 404 on the printer ("file not found in gcodes root").
      expect(startReq?.path ?? '').not.toContain(fixtureDir)
    })

    it('multipart body delivers the fixture .gcode bytes verbatim', async () => {
      reset()
      const payload = buildMoonrakerPushPayload(
        { gcodeOut: fixtureGcode, printerUrl: baseUrl, machineId: 'creality-k2-plus' },
        { startAfterUpload: true }
      )
      await moonrakerPush(payload)

      const upload = state.captured[0]
      expect(upload).toBeDefined()
      const body = upload!.body.toString('binary')
      // File part with the renderer-side basename
      expect(body).toContain(
        'Content-Disposition: form-data; name="file"; filename="cube.gcode"'
      )
      // Full ASCII payload survives the round trip
      expect(body).toContain(fixtureGcodeBody)
    })

    it('renderer default (startAfterUpload omitted) still resolves to start=true via builder default', async () => {
      reset()
      // The renderer threads `{ startAfterUpload: true }` explicitly today,
      // but the builder also defaults to `true` -- if a future refactor
      // drops the explicit option, the wire behavior must NOT regress.
      const payload = buildMoonrakerPushPayload({
        gcodeOut: fixtureGcode,
        printerUrl: baseUrl,
        machineId: 'creality-k2-plus'
      })
      const result = await moonrakerPush(payload)

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.printStarted).toBe(true)
      expect(state.captured.length).toBe(2)
      expect(state.captured[1]?.path).toMatch(/^\/printer\/print\/start\?filename=/)
    })
  })

  describe('failure surfaces -- error path through the renderer click handler', () => {
    it('upload 503 -- result.ok=false, no start request, error mentions HTTP 503', async () => {
      reset()
      state.uploadResponse = {
        status: 503,
        body: 'Service Unavailable -- printer rebooting'
      }
      const payload = buildMoonrakerPushPayload(
        { gcodeOut: fixtureGcode, printerUrl: baseUrl, machineId: 'creality-k2-plus' },
        { startAfterUpload: true }
      )
      const result = await moonrakerPush(payload)

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toMatch(/HTTP 503/)
      // Failed upload must short-circuit -- never call start on a file
      // the printer never received.
      expect(state.captured.length).toBe(1)
      expect(state.captured[0]?.path).toBe('/server/files/upload')
    })

    it('upload OK but start 500 -- result.ok=false, both requests captured, error mentions start failure', async () => {
      reset()
      state.startResponse = {
        status: 500,
        body: JSON.stringify({ error: 'klipper not ready' })
      }
      const payload = buildMoonrakerPushPayload(
        { gcodeOut: fixtureGcode, printerUrl: baseUrl, machineId: 'creality-k2-plus' },
        { startAfterUpload: true }
      )
      const result = await moonrakerPush(payload)

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toMatch(/print start failed.*HTTP 500/)
      // Both requests were made -- upload landed, start was attempted.
      expect(state.captured.length).toBe(2)
      expect(state.captured[0]?.path).toBe('/server/files/upload')
      expect(state.captured[1]?.path).toMatch(/^\/printer\/print\/start/)
    })

    it('missing local file -- result.ok=false BEFORE any network request', async () => {
      reset()
      const payload = buildMoonrakerPushPayload(
        {
          gcodeOut: join(fixtureDir, 'does-not-exist.gcode'),
          printerUrl: baseUrl,
          machineId: 'creality-k2-plus'
        },
        { startAfterUpload: true }
      )
      const result = await moonrakerPush(payload)

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toMatch(/G-code file not found/)
      // Nothing on the wire -- the renderer's click should never burn
      // network round-trips on a path it hallucinated.
      expect(state.captured.length).toBe(0)
    })
  })

  describe('renderer payload contract -- machineId nullability', () => {
    it('renderer machineId=null collapses to no machineId on the wire (renderer-side absence is honored)', async () => {
      reset()
      // The renderer's call site passes
      // `p.activeMachine?.id ?? null` -- when no machine is active
      // the builder must drop the field entirely so the IPC resolver
      // takes the no-capability pass-through branch (Safety Rule 2).
      const payload = buildMoonrakerPushPayload(
        { gcodeOut: fixtureGcode, printerUrl: baseUrl, machineId: null },
        { startAfterUpload: true }
      )
      // Field drop is the renderer-side guarantee; verify here so a
      // future builder refactor that lets `null` slip through fails
      // this paired E2E.
      expect(Object.prototype.hasOwnProperty.call(payload, 'machineId')).toBe(false)

      // And the wire round-trip still works -- the temperature
      // pre-validator simply does not run, by design.
      const result = await moonrakerPush(payload)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.printStarted).toBe(true)
    })

    it('renderer machineId="creality-k2-plus" propagates onto the payload (so IPC resolver can apply temp ceilings)', () => {
      // Pure assertion on the builder output -- no wire I/O. Pinned
      // here (not just in moonraker-push-payload.test.ts) because the
      // renderer-flow E2E is the layer where a regression in the
      // builder would silently disarm the [ID-0078] temperature gate
      // for K2 Plus jobs.
      const payload = buildMoonrakerPushPayload(
        {
          gcodeOut: fixtureGcode,
          printerUrl: baseUrl,
          machineId: 'creality-k2-plus'
        },
        { startAfterUpload: true }
      )
      expect(payload.machineId).toBe('creality-k2-plus')
      expect(payload.startAfterUpload).toBe(true)
      expect(payload.gcodePath).toBe(fixtureGcode)
      expect(payload.printerUrl).toBe(baseUrl)
    })
  })
})
