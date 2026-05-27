/**
 * Moonraker information probe for the Settings → Network & Printers
 * "Test connection" button on the Creality K2 Plus.
 *
 * This is the rich-info companion to `src/main/moonraker-push.ts`'s
 * `moonrakerStatus()` (which only reports print state). The Test
 * connection button needs:
 *   - confirmation the server actually speaks JSON (not just returns
 *     200 with HTML from a misconfigured router),
 *   - the printer's hostname + firmware version (so the operator knows
 *     they are talking to their K2 Plus and not a stale lab printer),
 *   - live bed + nozzle present-temperatures so a "warm-up before next
 *     job" decision can be made without the operator opening Fluidd.
 *
 * Kept in a separate module so `moonraker-push.ts` retains its
 * paired-pin test contract (exports / line count / byte count); the
 * pin test pins exactly 7 runtime exports there.
 *
 * Safety: HTTP-only, no G-code emission, no shell commands. Pure
 * read-only probe. Errors NEVER throw — every failure is folded into
 * a structured `{ ok: false, error, detail }` so the renderer can
 * surface the real reason (timeout / 4xx / 5xx / DNS / connect-reset).
 *
 * Endpoints used:
 *   GET /printer/info                      — name + firmware version
 *   GET /printer/objects/query?heaters=...&extruder&heater_bed
 *                                          — live + target temps
 */

import http from 'node:http'
import https from 'node:https'
import { URL } from 'node:url'

// ─── Types ─────────────────────────────────────────────────────────────────

/**
 * Per-heater present + target temperatures (Celsius). Returned for both
 * the active extruder and the heated bed when available; `undefined`
 * fields mean the printer did not report that heater (e.g. the
 * extruder isn't homed and Klipper hasn't initialized it yet).
 */
export type MoonrakerHeaterTemps = {
  /** Present temperature in Celsius (live reading from the sensor). */
  presentC?: number
  /** Target temperature in Celsius (commanded set-point). */
  targetC?: number
}

/**
 * Combined info+temps probe result. `ok=true` means every requested
 * endpoint returned valid JSON. Partial degradation (printer responded
 * but had no heater data) folds into `bed` / `nozzle` being `undefined`
 * rather than the entire probe failing.
 */
export type MoonrakerInfoResult =
  | {
      ok: true
      /** Printer hostname as reported by `/printer/info` (e.g. "k2plus"). */
      hostname?: string
      /** Firmware version as reported by `/printer/info` (e.g. "v0.12.0-123"). */
      firmwareVersion?: string
      /** Klipper state as reported by `/printer/info` (e.g. "ready"). */
      state?: string
      /** Bed heater present + target temperatures. */
      bed?: MoonrakerHeaterTemps
      /** Nozzle (extruder) heater present + target temperatures. */
      nozzle?: MoonrakerHeaterTemps
    }
  | { ok: false; error: string; detail?: string }

// ─── Internal HTTP helper ──────────────────────────────────────────────────

/**
 * Lightweight GET that bounds the connect phase with an AbortController
 * (same pattern as `moonraker-push.ts` [ID-0082]). Returns the parsed
 * body or rejects on transport error / timeout.
 */
function getJson(
  rawUrl: string,
  timeoutMs: number
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(rawUrl)
    const isHttps = u.protocol === 'https:'
    const lib = isHttps ? https : http
    const controller = new AbortController()
    let settled = false
    const abortTimer = setTimeout(() => {
      if (settled) return
      controller.abort()
    }, timeoutMs)
    if (typeof abortTimer.unref === 'function') abortTimer.unref()
    const settle = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(abortTimer)
      fn()
    }
    const reqOpts: http.RequestOptions = {
      method: 'GET',
      host: u.hostname,
      port: u.port ? parseInt(u.port, 10) : isHttps ? 443 : 80,
      path: u.pathname + u.search,
      signal: controller.signal
    }
    const req = lib.request(reqOpts, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (d: Buffer) => chunks.push(d))
      res.on('end', () => {
        settle(() =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf-8') })
        )
      })
      res.on('error', (err) => settle(() => reject(err)))
    })
    req.on('error', (err) => {
      const e = err as NodeJS.ErrnoException & { code?: string; name?: string }
      if (e.name === 'AbortError' || e.code === 'ABORT_ERR') {
        settle(() => reject(new Error(`Request timed out after ${timeoutMs} ms`)))
      } else {
        settle(() => reject(err))
      }
    })
    req.setTimeout(timeoutMs, () => {
      settle(() => {
        controller.abort()
        reject(new Error(`Request idle past ${timeoutMs} ms`))
      })
    })
    req.end()
  })
}

// ─── Pure parsers (exported for unit tests) ────────────────────────────────

/**
 * Parse a `/printer/info` response body into the structured fields the
 * Settings view surfaces. Returns an empty object on any parse error
 * so the caller's UI can still render the partial info.
 *
 * Expected Moonraker shape:
 *   {
 *     "result": {
 *       "state": "ready",
 *       "hostname": "k2plus",
 *       "software_version": "v0.12.0-..."
 *     }
 *   }
 */
export function parsePrinterInfoBody(bodyText: string): {
  hostname?: string
  firmwareVersion?: string
  state?: string
} {
  try {
    const parsed = JSON.parse(bodyText) as unknown
    const result = (parsed as { result?: Record<string, unknown> })?.result
    if (result === null || typeof result !== 'object') return {}
    const hostname =
      typeof result['hostname'] === 'string' && result['hostname'].length > 0
        ? result['hostname']
        : undefined
    const firmwareVersion =
      typeof result['software_version'] === 'string' && result['software_version'].length > 0
        ? result['software_version']
        : undefined
    const state =
      typeof result['state'] === 'string' && result['state'].length > 0
        ? result['state']
        : undefined
    return { hostname, firmwareVersion, state }
  } catch {
    return {}
  }
}

/**
 * Parse a `/printer/objects/query?extruder&heater_bed` response body
 * into present + target heater temps. Missing or malformed fields
 * silently degrade to `undefined` rather than throw.
 *
 * Expected Moonraker shape:
 *   {
 *     "result": {
 *       "status": {
 *         "extruder":   { "temperature": 24.5, "target": 0 },
 *         "heater_bed": { "temperature": 22.1, "target": 0 }
 *       }
 *     }
 *   }
 */
export function parsePrinterHeatersBody(bodyText: string): {
  bed?: MoonrakerHeaterTemps
  nozzle?: MoonrakerHeaterTemps
} {
  try {
    const parsed = JSON.parse(bodyText) as unknown
    const status = (parsed as { result?: { status?: Record<string, unknown> } })?.result?.status
    if (status === null || typeof status !== 'object') return {}
    const extruder = (status as Record<string, unknown>)['extruder']
    const heaterBed = (status as Record<string, unknown>)['heater_bed']
    const nozzle = extractHeaterTemps(extruder)
    const bed = extractHeaterTemps(heaterBed)
    return {
      ...(bed != null ? { bed } : {}),
      ...(nozzle != null ? { nozzle } : {})
    }
  } catch {
    return {}
  }
}

/**
 * Extract present + target temperatures from a Moonraker per-heater
 * object. Returns `undefined` if the field isn't an object at all
 * (heater absent), or `{}` if the heater is present but has neither
 * field. Pure.
 */
function extractHeaterTemps(raw: unknown): MoonrakerHeaterTemps | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const presentC = typeof r['temperature'] === 'number' ? r['temperature'] : undefined
  const targetC = typeof r['target'] === 'number' ? r['target'] : undefined
  if (presentC === undefined && targetC === undefined) return undefined
  return {
    ...(presentC !== undefined ? { presentC } : {}),
    ...(targetC !== undefined ? { targetC } : {})
  }
}

// ─── Public entry ──────────────────────────────────────────────────────────

/**
 * Fetch the printer's hostname, firmware version, and live bed + nozzle
 * temperatures from Moonraker. Designed for the Settings → Network &
 * Printers "Test connection" probe.
 *
 * Wraps two parallel GETs:
 *   GET /printer/info
 *   GET /printer/objects/query?extruder&heater_bed
 *
 * Both must respond with valid JSON for `ok: true`. If the info call
 * fails (network error / non-JSON body) the entire probe fails. If
 * info succeeds but heaters do not, we still return `ok: true` with
 * `bed`/`nozzle` undefined — the operator at least gets confirmation
 * the printer responded.
 *
 * Empty / blank `printerUrl` is rejected with a structured error
 * without touching the network. This mirrors the same belt-and-
 * suspenders guard the SettingsView already enforces on the renderer
 * side and protects against `new URL('')` throwing.
 */
export async function moonrakerInfo(
  printerUrl: string,
  timeoutMs = 8_000
): Promise<MoonrakerInfoResult> {
  if (typeof printerUrl !== 'string' || printerUrl.trim().length === 0) {
    return {
      ok: false,
      error: 'Moonraker URL is empty.',
      detail: 'Enter the printer URL in Settings → Network & Printers first.'
    }
  }
  const base = printerUrl.replace(/\/$/, '')

  // /printer/info is the must-have endpoint — if it fails, the probe fails.
  let infoBody: string
  let infoStatus = 0
  try {
    const r = await getJson(`${base}/printer/info`, timeoutMs)
    infoStatus = r.status
    infoBody = r.body
  } catch (e) {
    return {
      ok: false,
      error: 'Could not reach printer.',
      detail: e instanceof Error ? e.message : String(e)
    }
  }
  if (infoStatus < 200 || infoStatus >= 300) {
    return {
      ok: false,
      error: `Printer returned HTTP ${infoStatus}.`,
      detail: infoBody.slice(0, 200)
    }
  }
  const info = parsePrinterInfoBody(infoBody)
  // Empty parse means the server replied 200 but the body wasn't JSON
  // (e.g. a captive-portal HTML page). Treat as a probe failure since
  // the renderer's "valid JSON" precondition is unmet.
  if (
    info.hostname === undefined &&
    info.firmwareVersion === undefined &&
    info.state === undefined
  ) {
    return {
      ok: false,
      error: 'Server responded but the body was not Moonraker JSON.',
      detail: infoBody.slice(0, 200)
    }
  }

  // /printer/objects/query for heaters — optional; degrade gracefully.
  let heaterBody: string | null = null
  try {
    const r = await getJson(
      `${base}/printer/objects/query?extruder&heater_bed`,
      timeoutMs
    )
    if (r.status >= 200 && r.status < 300) {
      heaterBody = r.body
    }
  } catch {
    // Swallow — heater data is optional in the result.
  }
  const heaters = heaterBody !== null ? parsePrinterHeatersBody(heaterBody) : {}

  return {
    ok: true,
    ...(info.hostname !== undefined ? { hostname: info.hostname } : {}),
    ...(info.firmwareVersion !== undefined ? { firmwareVersion: info.firmwareVersion } : {}),
    ...(info.state !== undefined ? { state: info.state } : {}),
    ...(heaters.bed !== undefined ? { bed: heaters.bed } : {}),
    ...(heaters.nozzle !== undefined ? { nozzle: heaters.nozzle } : {})
  }
}
