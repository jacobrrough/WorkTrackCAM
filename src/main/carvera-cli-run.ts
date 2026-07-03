/**
 * Spawn community carvera-cli (https://github.com/hagmonk/carvera-cli) to upload
 * G-code/NC to a Makera Carvera over USB or WiFi. The CLI must be installed separately.
 */
import { statSync } from 'node:fs'
import type { AppSettings } from '../shared/project-schema'
import {
  detectCarveraSendPhase,
  type CarveraSendPhase
} from '../shared/carvera-send-progress-phase'
import { spawnBounded, spawnBoundedWithLineCallback } from './subprocess-bounded'

export type CarveraConnectionMode = 'auto' | 'wifi' | 'usb'

export type CarveraUploadPayload = {
  /** Absolute path to local G-code or NC file */
  gcodePath: string
  connection: CarveraConnectionMode
  /** IP (WiFi) or serial device, e.g. COM3 or /dev/ttyACM0 */
  device?: string
  /** Full remote path — passes --remote-path */
  remotePath?: string
  /** Remote directory (second positional after local file), e.g. /sd/gcodes/jobs/ */
  remoteDirectory?: string
  overwrite?: boolean
  /** Total spawn timeout in ms (default 120_000) */
  timeoutMs?: number
  /**
   * [P2-CARVERA-PUSH-MOCK]/Cycle 360 upload-phase callback. When supplied,
   * each stdout line emitted by the carvera-cli child process is matched
   * against `detectCarveraSendPhase(...)` and the callback fires WITH the
   * resolved phase whenever the phase changes (no duplicate emissions for
   * the same phase). The callback fires from the Electron main process
   * (this module never runs in the renderer). For renderer-side display,
   * the IPC handler in `src/main/ipc-fabrication.ts` injects an
   * `onProgress` shim that forwards each phase change over the
   * `carvera:upload:progress` channel to the invoking sender's
   * WebContents.
   *
   * Safety Rule 2: additive / optional. Absent callback => byte-identical
   * pre-Cycle-360 behaviour (single-shot `spawnBounded`, no line stream).
   * Callback errors are swallowed (try/catch wraps each invocation) so a
   * misbehaving renderer cannot corrupt the upload itself.
   */
  onProgress?: (phase: CarveraSendPhase) => void
}

export type CarveraUploadResult =
  | { ok: true; stdout: string; stderr: string }
  | { ok: false; error: string; detail?: string }

function parseCarveraExtraArgsJson(json: string | undefined): string[] {
  if (!json?.trim()) return []
  try {
    const v = JSON.parse(json) as unknown
    if (!Array.isArray(v)) return []
    return v.filter((x): x is string => typeof x === 'string')
  } catch {
    return []
  }
}

/** Exported for unit tests — builds argv for `carvera-cli` (or user-configured executable). */
export function buildCarveraUploadArgs(
  settings: AppSettings,
  payload: CarveraUploadPayload
): { command: string; args: string[] } {
  const cmd = settings.carveraCliPath?.trim() || 'carvera-cli'
  const extra = parseCarveraExtraArgsJson(settings.carveraCliExtraArgsJson)
  const args: string[] = [...extra]

  if (payload.connection === 'wifi') args.push('--wifi')
  else if (payload.connection === 'usb') args.push('--usb')

  if (payload.device?.trim()) {
    args.push('--device', payload.device.trim())
  }

  const timeoutMs = payload.timeoutMs ?? 120_000
  if (timeoutMs != null && timeoutMs > 0) {
    const sec = Math.max(1, Math.ceil(timeoutMs / 1000))
    args.push('--timeout', String(sec))
  }

  args.push('upload', payload.gcodePath)

  const rp = payload.remotePath?.trim()
  const rd = payload.remoteDirectory?.trim()
  if (rp) {
    args.push('--remote-path', rp)
  } else if (rd) {
    args.push(rd)
  }

  if (payload.overwrite) args.push('--overwrite')

  return { command: cmd, args }
}

export async function carveraUpload(
  settings: AppSettings,
  payload: CarveraUploadPayload
): Promise<CarveraUploadResult> {
  try {
    statSync(payload.gcodePath)
  } catch {
    return {
      ok: false,
      error: 'G-code file not found.',
      detail: `Path: ${payload.gcodePath} — run Manufacture → Generate toolpath first so output/cam.nc exists.`
    }
  }

  const { command, args } = buildCarveraUploadArgs(settings, payload)
  const spawnTimeout = payload.timeoutMs ?? 120_000

  try {
    // [P2-CARVERA-PUSH-MOCK]/Cycle 360 -- when the caller supplied an
    // onProgress callback, spawn through the line-callback variant so we
    // can stream phase events as carvera-cli emits stdout lines. Phase
    // changes are de-duplicated locally so a noisy CLI that repeats the
    // same line N times only fires the callback ONCE per phase entry.
    // Errors raised by the renderer-supplied callback are swallowed so a
    // misbehaving subscriber cannot abort the upload.
    const onProgress = payload.onProgress
    const { code, stdout, stderr } =
      onProgress != null
        ? await (() => {
            let lastPhase: CarveraSendPhase | null = null
            return spawnBoundedWithLineCallback(command, args, {
              timeoutMs: spawnTimeout > 0 ? spawnTimeout : null,
              onStdoutLine: (line) => {
                const phase = detectCarveraSendPhase(line)
                if (phase != null && phase !== lastPhase) {
                  lastPhase = phase
                  try {
                    onProgress(phase)
                  } catch {
                    /* swallow renderer-side errors */
                  }
                }
              }
            })
          })()
        : await spawnBounded(command, args, {
            timeoutMs: spawnTimeout > 0 ? spawnTimeout : null
          })
    if (code !== 0) {
      const detail = [stderr, stdout].filter(Boolean).join('\n').trim().slice(0, 4000)
      return {
        ok: false,
        error: `carvera-cli exited with code ${code ?? 'null'}.`,
        detail: detail || undefined
      }
    }
    return { ok: true, stdout, stderr }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const hint =
      /spawn|ENOENT/i.test(msg) || /not find/i.test(msg)
        ? 'Check Carvera CLI path under File → Settings → External tool paths (or install carvera-cli on PATH).'
        : undefined
    return {
      ok: false,
      error: msg,
      detail: hint
    }
  }
}
