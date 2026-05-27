/**
 * Startup Python dependency checker.
 *
 * Probes the bundled Python sidecar (`engines/sidecar/main.py`) via a single
 * `ping` JSON-RPC call to confirm Python is reachable and the sidecar's
 * required imports (CadQuery, OpenCAMLib, numpy, trimesh) resolve at module
 * load. Surfaces a structured result that can be sent to the renderer via
 * IPC so the UI can display a friendly warning banner when required Python
 * packages are missing.
 *
 * History: prior to the 2026-05-27 foundation pivot this module spawned
 * `engines/cam/toolpath_engine/check_deps.py`, which emitted a JSON dep
 * inventory. That script was deleted with the rest of the custom CAM
 * toolpath engine; the sidecar's load-time import check is now the
 * authoritative "are Python deps usable" signal. If the sidecar's
 * `import` statements at the top of `main.py` / `cad_handlers.py` /
 * `cam_handlers.py` fail, the `ping` round-trip will fail too -- we
 * surface that to the renderer as a `pythonOk=false` outcome so the
 * banner can prompt the user to install `engines/requirements.txt`.
 */
import { spawn } from 'node:child_process'
import { getEnginesRoot } from './paths'
import { dirname } from 'node:path'

export type DepStatus = {
  name: string
  available: boolean
  version: string | null
  note: string
}

export type PythonDepCheckResult = {
  ok: boolean
  pythonOk: boolean
  pythonVersion: string
  pythonMin: string
  required: DepStatus[]
  optional: DepStatus[]
  missingRequired: string[]
}

export type PythonDepCheckOutcome =
  | { checked: true; result: PythonDepCheckResult }
  | { checked: false; error: string }

/**
 * Probe the bundled Python sidecar with a single `ping` JSON-RPC round-trip.
 *
 * Strategy: spawn `<pythonPath> -m engines.sidecar.main`, write one ping
 * request to stdin, read one response line from stdout, then close stdin
 * so the sidecar exits cleanly (its loop exits on EOF per `main.py` docs).
 * Success means Python is reachable AND every top-level import inside
 * `engines/sidecar/main.py`, `cad_handlers.py`, and `cam_handlers.py`
 * resolved -- i.e. CadQuery + OpenCAMLib + numpy + trimesh are usable.
 *
 * If the spawn fails or the sidecar exits non-zero before responding, we
 * return a `checked:false` outcome whose error string is suitable for the
 * renderer's startup banner. Never throws.
 *
 * Timeout: 15s wall-clock for the spawn + ping round-trip. CadQuery's
 * first import can be slow (~3-5s on cold disk caches); 15s is a generous
 * ceiling that still surfaces a hang in finite time.
 */
export async function checkPythonDeps(pythonPath: string): Promise<PythonDepCheckOutcome> {
  const enginesRoot = getEnginesRoot()
  // The sidecar package lives at <enginesRoot>/sidecar; we invoke it as
  // `python -m engines.sidecar.main` from the parent directory so the
  // package import resolves against the repo's `engines/__init__.py`.
  const cwd = dirname(enginesRoot)

  return new Promise<PythonDepCheckOutcome>((resolve) => {
    let settled = false
    const settle = (outcome: PythonDepCheckOutcome): void => {
      if (settled) return
      settled = true
      try {
        child.kill()
      } catch {
        // child may already have exited; ignore
      }
      resolve(outcome)
    }

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(pythonPath, ['-m', 'engines.sidecar.main'], {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe']
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      resolve({ checked: false, error: `Failed to spawn '${pythonPath}': ${msg}` })
      return
    }

    let stdoutBuf = ''
    let stderrBuf = ''

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString('utf-8')
      // Sidecar protocol is one JSON object per line on stdout.
      const newlineIdx = stdoutBuf.indexOf('\n')
      if (newlineIdx === -1) return
      const line = stdoutBuf.slice(0, newlineIdx).trim()
      if (!line) return
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>
        const ok = parsed.ok === true
        const result: PythonDepCheckResult = {
          ok,
          pythonOk: ok,
          // We don't ask Python for its version (the sidecar only echoes
          // its own protocol version). Report the executable's resolved
          // path instead so the renderer banner has SOMETHING actionable.
          pythonVersion: ok ? 'bundled sidecar reachable' : 'unknown',
          pythonMin: '3.9',
          required: [],
          optional: [],
          missingRequired: ok ? [] : ['engines.sidecar']
        }
        settle({ checked: true, result })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        settle({
          checked: false,
          error: `Sidecar emitted unparseable response: ${msg}. Raw line (first 200 chars): ${line.slice(0, 200)}`
        })
      }
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString('utf-8')
    })

    child.on('error', (err) => {
      if (isSpawnNotFound(err)) {
        settle({
          checked: false,
          error: `Python executable '${pythonPath}' was not found. Install Python 3.9+ or set the correct path in Utilities > Settings > Paths.`
        })
        return
      }
      settle({
        checked: false,
        error: `Python dependency check failed: ${err.message}`
      })
    })

    child.on('exit', (code, signal) => {
      // Only matters if we exited BEFORE the stdout handler resolved.
      if (settled) return
      const reason =
        code != null
          ? `sidecar exited with code ${code}`
          : `sidecar killed by signal ${signal ?? 'unknown'}`
      settle({
        checked: false,
        error: `${reason} before responding. stderr: ${stderrBuf.slice(0, 500)}`
      })
    })

    // Send a single ping request, then close stdin so the sidecar exits
    // on EOF after replying (its dispatch loop exits gracefully on EOF).
    const ping = JSON.stringify({ id: 'startup-ping', method: 'ping', params: {} }) + '\n'
    try {
      child.stdin?.write(ping)
      child.stdin?.end()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      settle({ checked: false, error: `Failed to write ping to sidecar stdin: ${msg}` })
      return
    }

    // Wall-clock timeout net.
    const timeoutMs = 15_000
    const timer = setTimeout(() => {
      settle({
        checked: false,
        error: `Sidecar ping timed out after ${timeoutMs}ms. stderr: ${stderrBuf.slice(0, 500)}`
      })
    }, timeoutMs)
    // Don't keep the event loop alive for this timer (Electron main process
    // is long-lived; the timer should be a passive net not a wakeup).
    timer.unref()
  })
}

/** Detect ENOENT from spawn (python executable not on PATH). */
function isSpawnNotFound(err: unknown): boolean {
  if (err instanceof Error) {
    // Node spawn ENOENT
    if ('code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') return true
    // Some Windows errors
    if (err.message.includes('ENOENT')) return true
  }
  return false
}

/**
 * Build a user-friendly summary message for the renderer from a dep check outcome.
 * Returns `null` when everything is fine (no message needed).
 */
export function buildDepCheckWarning(outcome: PythonDepCheckOutcome): string | null {
  if (!outcome.checked) {
    return outcome.error
  }
  const r = outcome.result
  if (r.ok) return null

  const parts: string[] = []

  if (!r.pythonOk) {
    parts.push(
      `Python ${r.pythonMin}+ is required but found ${r.pythonVersion}.`
    )
  }

  if (r.missingRequired.length > 0) {
    parts.push(
      `Missing required packages: ${r.missingRequired.join(', ')}. ` +
        `Install with: pip install ${r.missingRequired.join(' ')}`
    )
  }

  return parts.join(' ') || null
}

/** Optional packages for mesh import and STEP/IGES — shown when core CAM deps are OK. */
export function buildOptionalPythonDepsHint(outcome: PythonDepCheckOutcome): string | null {
  if (!outcome.checked || !outcome.result.ok || !outcome.result.pythonOk) return null
  const hints: string[] = []
  for (const o of outcome.result.optional) {
    if (o.available) continue
    if (o.name === 'trimesh') {
      hints.push('Mesh import (OBJ/PLY/GLB/…): install trimesh — pip install trimesh')
    } else if (o.name === 'cadquery') {
      hints.push('STEP/IGES import: install cadquery (or cadquery-ocp) for engines/occt/step_to_stl.py')
    } else if (o.name === 'OCP') {
      hints.push('STEP/IGES fallback (OCP): often bundled with cadquery-ocp if CadQuery alone is not used')
    }
  }
  return hints.length ? hints.join(' ') : null
}

/** Critical dep warnings plus optional mesh/STEP hints for Settings / startup banner. */
export function buildPythonDepsUserMessage(outcome: PythonDepCheckOutcome): string | null {
  if (!outcome.checked) return outcome.error
  const parts = [buildDepCheckWarning(outcome), buildOptionalPythonDepsHint(outcome)].filter(Boolean)
  return parts.length ? parts.join(' ') : null
}
