/**
 * Tests for src/main/moonraker-info.ts
 *
 * Coverage:
 *   - Pure parsers handle valid bodies, malformed bodies, missing fields,
 *     and unexpected types without throwing.
 *   - moonrakerInfo() returns structured errors (no exceptions) for:
 *       - empty URL
 *       - unreachable host (with wall-clock bound)
 *       - 200 OK + non-JSON body
 *       - HTTP error status
 *   - moonrakerInfo() against a mocked HTTP server returns the parsed
 *     hostname / firmwareVersion / state and heater temps.
 *   - The probe NEVER throws — every failure path is folded into
 *     `{ ok: false, error, detail }`.
 */
import { describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  moonrakerInfo,
  parsePrinterHeatersBody,
  parsePrinterInfoBody
} from './moonraker-info'

// Non-routable test-net sink for unreachable-host tests. Matches the
// pattern used by `src/main/moonraker-push-pin.test.ts`.
const UNREACHABLE_HOST = 'http://192.0.2.1:7125'
const UNREACHABLE_TIMEOUT_MS = 100
const UNREACHABLE_BUDGET_MS = 600

// ─── Pure parser tests ───────────────────────────────────────────────────

describe('parsePrinterInfoBody', () => {
  it('extracts hostname, firmware version, and state from a typical Moonraker body', () => {
    const body = JSON.stringify({
      result: {
        state: 'ready',
        hostname: 'k2plus',
        software_version: 'v0.12.0-185-gabcdef'
      }
    })
    expect(parsePrinterInfoBody(body)).toEqual({
      hostname: 'k2plus',
      firmwareVersion: 'v0.12.0-185-gabcdef',
      state: 'ready'
    })
  })

  it('returns empty object for malformed JSON', () => {
    expect(parsePrinterInfoBody('{not-json}')).toEqual({})
  })

  it('returns empty object for empty body', () => {
    expect(parsePrinterInfoBody('')).toEqual({})
  })

  it('returns empty object when result is missing', () => {
    expect(parsePrinterInfoBody('{}')).toEqual({})
  })

  it('ignores non-string hostname / firmware fields', () => {
    const body = JSON.stringify({
      result: {
        state: 'ready',
        hostname: 42,
        software_version: { major: 0 }
      }
    })
    expect(parsePrinterInfoBody(body)).toEqual({ state: 'ready' })
  })

  it('treats empty-string fields as absent', () => {
    const body = JSON.stringify({
      result: { state: '', hostname: '', software_version: '' }
    })
    expect(parsePrinterInfoBody(body)).toEqual({})
  })
})

describe('parsePrinterHeatersBody', () => {
  it('extracts bed + nozzle present and target temps', () => {
    const body = JSON.stringify({
      result: {
        status: {
          extruder: { temperature: 24.5, target: 0 },
          heater_bed: { temperature: 22.1, target: 60 }
        }
      }
    })
    expect(parsePrinterHeatersBody(body)).toEqual({
      bed: { presentC: 22.1, targetC: 60 },
      nozzle: { presentC: 24.5, targetC: 0 }
    })
  })

  it('returns empty object for malformed JSON', () => {
    expect(parsePrinterHeatersBody('not json')).toEqual({})
  })

  it('returns empty object when status is missing', () => {
    expect(parsePrinterHeatersBody('{"result":{}}')).toEqual({})
  })

  it('omits missing heaters', () => {
    const body = JSON.stringify({
      result: { status: { extruder: { temperature: 24.5, target: 0 } } }
    })
    expect(parsePrinterHeatersBody(body)).toEqual({
      nozzle: { presentC: 24.5, targetC: 0 }
    })
  })

  it('omits non-number temperature / target fields', () => {
    const body = JSON.stringify({
      result: {
        status: {
          extruder: { temperature: '24.5', target: 'hot' }
        }
      }
    })
    expect(parsePrinterHeatersBody(body)).toEqual({})
  })

  it('preserves a heater with only one field present', () => {
    const body = JSON.stringify({
      result: {
        status: { heater_bed: { temperature: 22.1 } }
      }
    })
    expect(parsePrinterHeatersBody(body)).toEqual({
      bed: { presentC: 22.1 }
    })
  })

  it('treats a null heater entry as absent', () => {
    const body = JSON.stringify({
      result: { status: { extruder: null } }
    })
    expect(parsePrinterHeatersBody(body)).toEqual({})
  })
})

// ─── moonrakerInfo: error paths (no network) ─────────────────────────────

describe('moonrakerInfo error handling', () => {
  it('rejects empty URL without touching the network', async () => {
    const t0 = Date.now()
    const r = await moonrakerInfo('')
    const elapsed = Date.now() - t0
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.toLowerCase()).toContain('empty')
      expect(r.detail).toBeDefined()
    }
    expect(elapsed).toBeLessThan(50)
  })

  it('rejects whitespace-only URL', async () => {
    const r = await moonrakerInfo('   ')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.toLowerCase()).toContain('empty')
  })

  it('returns ok:false on unreachable host within wall-clock budget', async () => {
    const t0 = Date.now()
    const r = await moonrakerInfo(UNREACHABLE_HOST, UNREACHABLE_TIMEOUT_MS)
    const elapsed = Date.now() - t0
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe('Could not reach printer.')
      expect(typeof r.detail).toBe('string')
    }
    expect(elapsed).toBeLessThan(UNREACHABLE_BUDGET_MS)
  })

  it('NEVER throws on bad input', async () => {
    // Two extra-defensive cases: a syntactically-bogus URL and a host
    // that resolves to localhost on an unbound port. Both must be folded
    // into ok:false without surfacing an exception.
    const cases = [
      'not://valid::url',
      'http://127.0.0.1:1/' // port 1 is reserved + unbound
    ]
    for (const url of cases) {
      const r = await moonrakerInfo(url, 100)
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(typeof r.error).toBe('string')
        expect(r.error.length).toBeGreaterThan(0)
      }
    }
  })
})

// ─── moonrakerInfo: full round-trip against a mock Moonraker server ─────

describe('moonrakerInfo full round-trip (mocked server)', () => {
  function withMockServer<T>(
    handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void,
    fn: (baseUrl: string) => Promise<T>
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const server = createServer(handler)
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo
        const baseUrl = `http://127.0.0.1:${addr.port}`
        fn(baseUrl)
          .then((v) => {
            server.close(() => resolve(v))
          })
          .catch((e) => {
            server.close(() => reject(e))
          })
      })
      server.on('error', reject)
    })
  }

  it('returns hostname + firmwareVersion + state + temps when both endpoints succeed', async () => {
    const result = await withMockServer(
      (req, res) => {
        res.setHeader('Content-Type', 'application/json')
        if (req.url === '/printer/info') {
          res.statusCode = 200
          res.end(
            JSON.stringify({
              result: {
                state: 'ready',
                hostname: 'k2plus',
                software_version: 'v0.12.0-test'
              }
            })
          )
        } else if (
          req.url === '/printer/objects/query?extruder&heater_bed'
        ) {
          res.statusCode = 200
          res.end(
            JSON.stringify({
              result: {
                status: {
                  extruder: { temperature: 27.3, target: 220 },
                  heater_bed: { temperature: 24.1, target: 60 }
                }
              }
            })
          )
        } else {
          res.statusCode = 404
          res.end('not found')
        }
      },
      (baseUrl) => moonrakerInfo(baseUrl, 3_000)
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.hostname).toBe('k2plus')
      expect(result.firmwareVersion).toBe('v0.12.0-test')
      expect(result.state).toBe('ready')
      expect(result.nozzle).toEqual({ presentC: 27.3, targetC: 220 })
      expect(result.bed).toEqual({ presentC: 24.1, targetC: 60 })
    }
  })

  it('still returns ok:true when /printer/info works but heaters endpoint fails', async () => {
    const result = await withMockServer(
      (req, res) => {
        if (req.url === '/printer/info') {
          res.setHeader('Content-Type', 'application/json')
          res.statusCode = 200
          res.end(
            JSON.stringify({
              result: { state: 'ready', hostname: 'k2plus', software_version: 'v1' }
            })
          )
        } else {
          res.statusCode = 500
          res.end('heater service offline')
        }
      },
      (baseUrl) => moonrakerInfo(baseUrl, 3_000)
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.hostname).toBe('k2plus')
      expect(result.bed).toBeUndefined()
      expect(result.nozzle).toBeUndefined()
    }
  })

  it('returns ok:false when /printer/info returns 4xx', async () => {
    const result = await withMockServer(
      (_req, res) => {
        res.statusCode = 404
        res.end('not found')
      },
      (baseUrl) => moonrakerInfo(baseUrl, 3_000)
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('404')
    }
  })

  it('returns ok:false when /printer/info returns 200 but a non-JSON body (captive portal sniff)', async () => {
    const result = await withMockServer(
      (_req, res) => {
        res.statusCode = 200
        res.setHeader('Content-Type', 'text/html')
        res.end('<html><body>Captive portal — sign in</body></html>')
      },
      (baseUrl) => moonrakerInfo(baseUrl, 3_000)
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.toLowerCase()).toContain('not moonraker json')
    }
  })

  it('strips trailing slashes from the base URL before composing endpoints', async () => {
    const seenPaths: string[] = []
    const result = await withMockServer(
      (req, res) => {
        seenPaths.push(req.url ?? '')
        if (req.url === '/printer/info') {
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(
            JSON.stringify({
              result: { state: 'ready', hostname: 'k2plus', software_version: 'v1' }
            })
          )
        } else {
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ result: { status: {} } }))
        }
      },
      (baseUrl) => moonrakerInfo(`${baseUrl}/`, 3_000)
    )
    expect(result.ok).toBe(true)
    // If we forgot to strip the slash, the request URL would have started
    // with `//printer/info`. Verify every observed path begins with a
    // single leading slash, no double slash.
    for (const p of seenPaths) {
      expect(p.startsWith('/')).toBe(true)
      expect(p.startsWith('//')).toBe(false)
    }
    expect(seenPaths).toContain('/printer/info')
  })
})
