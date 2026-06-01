/**
 * IPC layer for machine-control safety commands.
 *
 * Today this module exposes a single channel:
 *
 *   - `machine:estop` — emergency-stop dispatch keyed on machineId.
 *
 * The renderer's red "STOP" button in the AppHeader wires straight to this
 * surface. Each of the three target machines has a different abort path:
 *
 *   1. Creality K2 Plus  → POST <moonrakerUrl>/printer/emergency_stop
 *      (Moonraker's documented Klipper M112 endpoint; the firmware shuts
 *       heaters down and requires `firmware_restart` to recover).
 *      Docs: https://moonraker.readthedocs.io/en/latest/web_api/#emergency-stop
 *
 *   2. Makera Carvera (3-axis / 4-axis) → spawn carvera-cli abort. The
 *      community CLI does NOT currently expose a documented abort verb;
 *      we surface a structured `{ ok: false, error: 'no_cli_abort' }` so
 *      the renderer can toast "physical e-stop required". A real M5 +
 *      safety stop has to come from the physical Carvera button.
 *
 *   3. Laguna Swift 5x10 → no network abort path exists (the RichAuto
 *      A-series pendant's red mushroom button is the ONLY abort channel).
 *      Returns `{ ok: false, error: 'no_remote_abort' }` so the renderer
 *      shows an explanatory toast.
 *
 * Safety-critical surface — E-stop must NEVER throw. Every error path folds
 * into the structured response envelope so the operator UI can render an
 * advisory toast without try/catch ceremony in the renderer.
 *
 * IPC ordering invariant: registered inside `app.whenReady()` BEFORE
 * `createWindow()` (see src/main/index.ts header comment).
 *
 * Safety Rules touched
 * --------------------
 *   - Rule 1 (G-code is sacred): the K2 path emits M112 via Moonraker's
 *     documented abort endpoint. No `.hbs` post template or CAM emission
 *     path is modified by this module.
 *   - Rule 3 (no `any` types): payload validation uses discriminated
 *     literals + type guards.
 *   - Rule 4 (no security vulns): machineId is whitelisted against a
 *     known set; the Moonraker URL is run through `URL()` to reject
 *     malformed values BEFORE fetch; the Carvera path uses the existing
 *     spawn-bounded helper.
 */
import { ipcMain } from 'electron'
import type { MainIpcWindowContext } from './ipc-context'
import { loadSettings } from './settings-store'

// ── Public envelopes ────────────────────────────────────────────────────────

export type MachineEstopPayload = {
  machineId: string
}

export type MachineEstopResult = {
  ok: boolean
  error?: string
  hint?: string
}

// ── Known machine IDs (whitelist; the three-machine cohort) ────────────────

export const KNOWN_MACHINE_IDS = [
  'creality-k2-plus',
  'laguna-swift-5x10',
  'makera-carvera-3axis',
  'makera-carvera-4axis'
] as const

export type KnownMachineId = (typeof KNOWN_MACHINE_IDS)[number]

export function isKnownMachineId(id: string): id is KnownMachineId {
  return (KNOWN_MACHINE_IDS as readonly string[]).includes(id)
}

// ── Payload validation ──────────────────────────────────────────────────────

export function validateEstopPayload(
  raw: unknown
):
  | { ok: true; payload: { machineId: KnownMachineId } }
  | { ok: false; error: string } {
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, error: 'invalid_payload' }
  }
  const obj = raw as Record<string, unknown>
  const machineId = obj.machineId
  if (typeof machineId !== 'string' || machineId.length === 0) {
    return { ok: false, error: 'invalid_payload' }
  }
  if (!isKnownMachineId(machineId)) {
    return { ok: false, error: 'unknown_machine' }
  }
  return { ok: true, payload: { machineId } }
}

// ── Moonraker abort helper ─────────────────────────────────────────────────

/**
 * POST Moonraker's `/printer/emergency_stop` endpoint. This is the
 * canonical Klipper abort path (invokes the firmware M112 sequence) and
 * is documented at
 * https://moonraker.readthedocs.io/en/latest/web_api/#emergency-stop.
 *
 * Exposed for unit tests; folds every failure into the structured envelope.
 * AbortSignal.timeout caps the total request budget so a doomed printer
 * cannot hang the renderer's STOP click.
 */
export async function postMoonrakerEmergencyStop(
  moonrakerUrl: string,
  timeoutMs = 3_000
): Promise<MachineEstopResult> {
  let parsed: URL
  try {
    parsed = new URL(moonrakerUrl)
  } catch {
    return {
      ok: false,
      error: 'invalid_moonraker_url',
      hint: 'Set a valid Moonraker URL in Settings, e.g. http://192.168.1.50:7125'
    }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      ok: false,
      error: 'invalid_moonraker_url',
      hint: 'Only http: and https: URLs are accepted for Moonraker.'
    }
  }
  const base = `${parsed.origin}`
  const url = `${base}/printer/emergency_stop`
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (!res.ok) {
      return {
        ok: false,
        error: `moonraker_http_${res.status}`,
        hint: `Moonraker returned HTTP ${res.status}. Try the physical printer power switch.`
      }
    }
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const isAbort =
      (e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError')) ||
      /abort|timed? ?out/i.test(msg)
    if (isAbort) {
      return {
        ok: false,
        error: 'moonraker_timeout',
        hint:
          'Moonraker did not respond in time. The K2 may be offline — use the physical power switch.'
      }
    }
    return {
      ok: false,
      error: 'moonraker_network_error',
      hint:
        'Could not reach the K2 Plus over the network. Use the physical power switch on the printer.'
    }
  }
}

// ── Carvera abort helper ────────────────────────────────────────────────────

/**
 * Carvera-cli does not currently expose a documented abort verb (the
 * community wrapper is upload-focused; M5 + safety stop come from the
 * physical machine). This helper folds the situation into a structured
 * response so the renderer toasts the operator with the safe path.
 *
 * Exported for unit tests; a future PR can replace the body with a real
 * spawn once an upstream abort flag lands.
 */
export function carveraAbortFallback(): MachineEstopResult {
  return {
    ok: false,
    error: 'no_cli_abort',
    hint:
      'Carvera abort wired but the CLI does not expose an abort command; physically e-stop the machine.'
  }
}

// ── Laguna abort helper ─────────────────────────────────────────────────────

/**
 * The Laguna Swift 5x10's RichAuto A-series controller has no network
 * abort path. The operator must use the pendant's red mushroom E-stop
 * button. Surface that fact to the renderer so the toast is actionable.
 */
export function lagunaNoRemoteAbort(): MachineEstopResult {
  return {
    ok: false,
    error: 'no_remote_abort',
    hint:
      'Use the RichAuto pendant E-stop button — there is no network abort path for this machine.'
  }
}

// ── Core dispatch (pure; exported for unit tests) ───────────────────────────

/**
 * Dispatch the abort path based on machineId. `loadSettings` is injected
 * so the unit tests can stub the Moonraker URL without booting Electron.
 */
export async function dispatchEstop(
  machineId: KnownMachineId,
  opts: {
    loadSettingsFn: () => Promise<{ moonrakerUrl?: string }>
    timeoutMs?: number
  }
): Promise<MachineEstopResult> {
  if (machineId === 'creality-k2-plus') {
    const settings = await opts.loadSettingsFn()
    const url = settings.moonrakerUrl?.trim()
    if (!url) {
      return {
        ok: false,
        error: 'no_moonraker_url',
        hint:
          'Set the K2 Plus Moonraker URL under Settings → Network & Printers before using the STOP button.'
      }
    }
    return postMoonrakerEmergencyStop(url, opts.timeoutMs)
  }
  if (machineId === 'makera-carvera-3axis' || machineId === 'makera-carvera-4axis') {
    // P0 follow-up: real abort requires upstream carvera-cli support. For now,
    // emit the structured fallback + a console warning so the operator's
    // muscle memory ("press STOP") still gets a UI-side acknowledgement.
    console.warn(
      '[machine:estop] Carvera abort requested but carvera-cli does not expose an abort verb yet — operator must use the physical e-stop.'
    )
    return carveraAbortFallback()
  }
  if (machineId === 'laguna-swift-5x10') {
    return lagunaNoRemoteAbort()
  }
  // Exhaustive: every branch of the union is covered above.
  const _exhaustive: never = machineId
  void _exhaustive
  return { ok: false, error: 'unknown_machine' }
}

// ── IPC registration ────────────────────────────────────────────────────────

export function registerMachineIpc(ctx: MainIpcWindowContext): void {
  // `ctx` is accepted for parity with the other `register*Ipc` functions.
  // Future progress-event hooks (e.g. streaming an "aborting…" toast back
  // to the renderer) will reach for `ctx.getMainWindow()`. Keep the
  // signature.
  void ctx

  ipcMain.handle(
    'machine:estop',
    async (_e, raw: unknown): Promise<MachineEstopResult> => {
      const v = validateEstopPayload(raw)
      if (!v.ok) {
        return { ok: false, error: v.error }
      }
      return dispatchEstop(v.payload.machineId, {
        loadSettingsFn: loadSettings
      })
    }
  )
}
