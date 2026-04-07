/**
 * Startup Python dependency checker.
 *
 * Spawns `check_deps.py` and parses the structured JSON output.
 * Surfaces a structured result that can be sent to the renderer
 * via IPC so the UI can display a friendly warning banner when
 * required Python packages are missing.
 */
import { spawnBounded } from './subprocess-bounded'
import { getEnginesRoot } from './paths'
import { join } from 'node:path'

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
 * Run `check_deps.py` with the given Python executable and parse the JSON output.
 * Returns a structured outcome; never throws.
 */
export async function checkPythonDeps(pythonPath: string): Promise<PythonDepCheckOutcome> {
  const enginesRoot = getEnginesRoot()
  const scriptPath = join(enginesRoot, 'cam', 'toolpath_engine', 'check_deps.py')

  try {
    const r = await spawnBounded(pythonPath, [scriptPath], {
      cwd: enginesRoot,
      timeoutMs: 15_000
    })

    // check_deps.py exits 1 when required deps are missing but still emits JSON to stdout
    const stdout = r.stdout.trim()
    if (!stdout) {
      return {
        checked: false,
        error: `Python dependency check produced no output (exit code ${r.code}). stderr: ${r.stderr.slice(0, 500)}`
      }
    }

    const parsed = JSON.parse(stdout) as Record<string, unknown>

    const result: PythonDepCheckResult = {
      ok: Boolean(parsed.ok),
      pythonOk: Boolean(parsed.python_ok),
      pythonVersion: String(parsed.python_version ?? 'unknown'),
      pythonMin: String(parsed.python_min ?? '3.9'),
      required: Array.isArray(parsed.required) ? parsed.required.map(mapDepStatus) : [],
      optional: Array.isArray(parsed.optional) ? parsed.optional.map(mapDepStatus) : [],
      missingRequired: Array.isArray(parsed.missing_required)
        ? (parsed.missing_required as string[])
        : []
    }

    return { checked: true, result }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)

    // Distinguish "python not found" from other errors
    if (isSpawnNotFound(err)) {
      return {
        checked: false,
        error: `Python executable '${pythonPath}' was not found. Install Python 3.9+ or set the correct path in Utilities > Settings > Paths.`
      }
    }

    return {
      checked: false,
      error: `Python dependency check failed: ${msg}`
    }
  }
}

function mapDepStatus(raw: unknown): DepStatus {
  if (raw === null || typeof raw !== 'object') {
    return { name: 'unknown', available: false, version: null, note: '' }
  }
  const obj = raw as Record<string, unknown>
  return {
    name: String(obj.name ?? 'unknown'),
    available: Boolean(obj.available),
    version: obj.version != null ? String(obj.version) : null,
    note: String(obj.note ?? '')
  }
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
