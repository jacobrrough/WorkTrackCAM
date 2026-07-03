/**
 * [P2-K2-PUSH]/Cycle 358 -- byte-identity + progress-callback coverage
 * for the chunked Moonraker upload path.
 *
 * The Cycle 358 feature streams the multipart request body to the printer
 * in `MOONRAKER_UPLOAD_CHUNK_BYTES` (64 KiB) slices instead of a single
 * `req.write`, firing `onProgress(sentBytes, totalBytes)` after each slice
 * so the renderer can drive a live progress meter. Safety Rule 1 (G-code
 * is sacred): the bytes the printer receives MUST be byte-identical to the
 * whole-file write -- a single wrong byte corrupts a real print.
 *
 * These tests boot the shared mock-Moonraker harness (which captures every
 * request body verbatim as a Buffer) and prove:
 *
 *   1. A chunked upload (onProgress supplied) captures a request body that
 *      is byte-identical to the whole-write upload (onProgress absent),
 *      after normalising the time-based multipart boundary token.
 *   2. `onProgress` fires monotonically, ends exactly at
 *      `sentBytes === totalBytes`, and `totalBytes` is constant across
 *      every tick.
 *   3. A file larger than one 64 KiB chunk produces MULTIPLE ticks (proves
 *      the write really is chunked, not a single-shot with one final tick).
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { moonrakerPush } from './moonraker-push'
import {
  freshMockMoonrakerState,
  resetMockMoonrakerState,
  startMockMoonraker,
  stopMockMoonraker,
  type MockMoonrakerState
} from './__mocks__/moonraker-fake'

const fixtureDir = mkdtempSync(join(tmpdir(), 'moonraker-chunked-'))
// A >64 KiB pure-ASCII fixture so the body spans MULTIPLE 64 KiB chunks
// (200 KiB here => 4 chunks) and the byte-identity assertion crosses chunk
// seams. Pure ASCII keeps the latin-1 boundary decode unambiguous.
const fixtureGcode = join(fixtureDir, 'big-cube.gcode')
const fixtureGcodeBody =
  '; K2 Plus chunked-upload byte-identity fixture\n' +
  'G1 X1 Y1 Z0.2 F1500\n'.repeat(10_000)
writeFileSync(fixtureGcode, fixtureGcodeBody)

const CHUNK = 64 * 1024

/**
 * The multipart boundary embeds `Date.now().toString(16)` so two uploads
 * of the same file differ only in that token. Normalise it to a constant
 * so the byte-identity comparison isolates the payload, not the clock.
 */
function normaliseBoundary(body: Buffer): Buffer {
  const text = body.toString('latin1')
  const normalised = text.replace(/----MoonrakerFormBoundary[0-9a-f]+/g, '----MoonrakerFormBoundaryX')
  return Buffer.from(normalised, 'latin1')
}

describe('moonrakerPush chunked upload -- [P2-K2-PUSH]/Cycle 358', () => {
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

  it('chunked upload sends byte-identical content to the whole-write upload', async () => {
    // Whole-write: no onProgress -> single req.write.
    resetMockMoonrakerState(state)
    await moonrakerPush({ gcodePath: fixtureGcode, printerUrl: baseUrl, startAfterUpload: false })
    expect(state.captured.length).toBe(1)
    const wholeBody = state.captured[0]!.body

    // Chunked: onProgress supplied -> 64 KiB slices with back-pressure.
    resetMockMoonrakerState(state)
    const ticks: Array<{ sent: number; total: number }> = []
    await moonrakerPush({
      gcodePath: fixtureGcode,
      printerUrl: baseUrl,
      startAfterUpload: false,
      onProgress: (sent, total) => ticks.push({ sent, total })
    })
    expect(state.captured.length).toBe(1)
    const chunkedBody = state.captured[0]!.body

    // Same total length AND byte-for-byte identical payload (boundary token
    // normalised). This is the load-bearing safety assertion.
    expect(chunkedBody.length).toBe(wholeBody.length)
    expect(normaliseBoundary(chunkedBody).equals(normaliseBoundary(wholeBody))).toBe(true)
    // At least one progress tick fired.
    expect(ticks.length).toBeGreaterThan(0)
  })

  it('fires onProgress monotonically, ending exactly at sentBytes === totalBytes', async () => {
    resetMockMoonrakerState(state)
    const ticks: Array<{ sent: number; total: number }> = []
    await moonrakerPush({
      gcodePath: fixtureGcode,
      printerUrl: baseUrl,
      startAfterUpload: false,
      onProgress: (sent, total) => ticks.push({ sent, total })
    })

    expect(ticks.length).toBeGreaterThan(0)
    // totalBytes is constant across every tick.
    const total = ticks[0]!.total
    for (const t of ticks) expect(t.total).toBe(total)
    // sentBytes is strictly increasing.
    for (let i = 1; i < ticks.length; i += 1) {
      expect(ticks[i]!.sent).toBeGreaterThan(ticks[i - 1]!.sent)
    }
    // The final tick reports the whole body uploaded.
    expect(ticks[ticks.length - 1]!.sent).toBe(total)
    // No tick ever over-reports.
    for (const t of ticks) expect(t.sent).toBeLessThanOrEqual(total)
  })

  it('a >64 KiB file produces MULTIPLE ticks (proves the write is chunked)', async () => {
    resetMockMoonrakerState(state)
    const ticks: number[] = []
    await moonrakerPush({
      gcodePath: fixtureGcode,
      printerUrl: baseUrl,
      startAfterUpload: false,
      onProgress: (sent) => ticks.push(sent)
    })
    // The multipart body is > 64 KiB, so it MUST take at least two 64 KiB
    // chunks -> at least two ticks. A single-shot regression would report
    // exactly one tick.
    expect(ticks.length).toBeGreaterThanOrEqual(2)
    // The first tick reports no more than one chunk's worth of bytes.
    expect(ticks[0]!).toBeLessThanOrEqual(CHUNK)
  })

  it('a renderer-thrown onProgress error does not corrupt the upload', async () => {
    resetMockMoonrakerState(state)
    // A callback that throws on every tick must NOT abort the upload; the
    // request still completes and the body is still byte-identical.
    const wholeUpload = async (): Promise<Buffer> => {
      resetMockMoonrakerState(state)
      await moonrakerPush({ gcodePath: fixtureGcode, printerUrl: baseUrl, startAfterUpload: false })
      return state.captured[0]!.body
    }
    const wholeBody = await wholeUpload()

    resetMockMoonrakerState(state)
    const result = await moonrakerPush({
      gcodePath: fixtureGcode,
      printerUrl: baseUrl,
      startAfterUpload: false,
      onProgress: () => {
        throw new Error('renderer bug')
      }
    })
    expect(result.ok).toBe(true)
    expect(state.captured.length).toBe(1)
    const chunkedBody = state.captured[0]!.body
    expect(normaliseBoundary(chunkedBody).equals(normaliseBoundary(wholeBody))).toBe(true)
  })
})
