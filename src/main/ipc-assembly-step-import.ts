/**
 * EXTERNAL STEP IMPORT AS ASSEMBLY COMPONENT — main-process IPC (`assembly:importStepPart`).
 *
 * Phase-4 of the parity roadmap: "Insert from file". The renderer's Assembly
 * flow picks an external vendor STEP (fastener / motor / bracket) and calls this
 * channel with the absolute path. The handler:
 *
 *   1. Validates the path (IO: exists; lexical: `.step` / `.stp` whitelist, no
 *      null bytes, no `..` traversal, size cap ~100 MB) — all through the shared
 *      pure {@link validateStepImportPath} + a `stat` for existence/size.
 *   2. Spawns ONE `PythonBridge` and runs `cad.import_step` → then
 *      `cad.tessellate_with_ids` on the SAME bridge (the sidecar handle table is
 *      process-local, so both calls MUST share one process).
 *   3. Shapes the result via the shared pure {@link buildStepImportPart} into an
 *      AssemblyPart-shaped envelope: `{ id, name, handle, geometrySource, mesh }`
 *      where `geometrySource` durably records `{ kind:'step', stepPath,
 *      cachedBounds, cachedDims }` so the row survives reload (and renders an
 *      honest dangling badge when the file later moves).
 *
 * Posture mirrors `ipc-design-script.ts` (never throws — every failure is a
 * structured `{ ok:false, error, hint }` envelope) and `ipc-cad.ts` (one-shot
 * bridge lifecycle, `isPythonPathSafe` guard, `mapBridgeError`). Registered in
 * `src/main/index.ts` inside `app.whenReady()` BEFORE `createWindow()` next to
 * the other `register*Ipc` calls (the IPC ordering invariant), so a cold-start
 * renderer can never hit "No handler registered".
 *
 * SAFETY: Rule 1 — this handler emits NO G-code. It produces an in-memory mesh
 * (via the degenerate-filtered CadQuery tessellator) the viewport consumes; the
 * durable persistence is JSON only. Rule 4 — the path is null-byte + traversal +
 * extension + size validated before any sidecar spawn; `pythonPath` is run
 * through `isPythonPathSafe`.
 */
import { app, ipcMain } from 'electron'
import { stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import type { MainIpcWindowContext } from './ipc-context'
import { isPythonPathSafe } from './path-security'
import { loadSettings } from './settings-store'
import { PythonBridge, type PythonBridgeError } from './sidecar/python-bridge'
import { mapBridgeError, coerceTessellateWithIdsResult } from './ipc-cad'
import {
  buildStepImportPart,
  validateStepImportPath,
  type StepImportBridge,
  type StepImportBridgeImportResult,
  type StepImportOutcome,
  type StepImportPartResult
} from '../shared/assembly-step-import'
import type { CadImportStepResult } from '../shared/sidecar-protocol'

/**
 * Success envelope: the AssemblyPart-shaped result the renderer folds onto a new
 * row. Failure envelope carries a stable `error` code + operator `hint`.
 */
export type AssemblyImportStepPartResponse =
  | { ok: true; result: StepImportPartResult }
  | { ok: false; error: string; hint: string }

/** Import timeout (ms). STEP import + tessellation of a dense vendor body can be slow. */
const IMPORT_STEP_TIMEOUT_MS = 300_000
/** Tessellation timeout (ms). Second phase on an already-imported body. */
const TESSELLATE_TIMEOUT_MS = 120_000

/**
 * Adapt a live `PythonBridge` into the shared {@link StepImportBridge} two-call
 * surface `buildStepImportPart` drives. `importStep` returns the raw sidecar
 * handle + bbox; `tessellateWithIds` runs the shape coercer so a malformed
 * sidecar envelope surfaces as a rejection (not `undefined` in the mesh).
 */
function bridgeAdapter(bridge: PythonBridge): StepImportBridge {
  return {
    async importStep(path: string): Promise<StepImportBridgeImportResult> {
      const r = await bridge.call<CadImportStepResult>(
        'cad.import_step',
        { path },
        { timeoutMs: IMPORT_STEP_TIMEOUT_MS }
      )
      return { handle: r.handle, bbox: r.bbox }
    },
    async tessellateWithIds(handle: string) {
      const raw = await bridge.call<Record<string, unknown>>(
        'cad.tessellate_with_ids',
        { handle },
        { timeoutMs: TESSELLATE_TIMEOUT_MS }
      )
      const coerced = coerceTessellateWithIdsResult(raw)
      if (!coerced) {
        // Surface as a rejection so buildStepImportPart folds it into a clean
        // error envelope (same shape as a sidecar_error), not a malformed mesh.
        const err: PythonBridgeError = {
          code: 'bad_response',
          message: 'cad.tessellate_with_ids returned a malformed vertices/indices/faceIds envelope'
        }
        throw err
      }
      return {
        vertices: coerced.vertices,
        indices: coerced.indices,
        faceIds: coerced.faceIds,
        triangleCount: coerced.triangleCount,
        bbox: coerced.bbox
      }
    }
  }
}

/**
 * Run the validated import pipeline against a one-shot sidecar. Exported so a
 * test can drive the exact production sequence with an injected python path /
 * app root (no Electron mock needed for the core logic). The path MUST already
 * exist + pass validation — the IPC handler owns that gate.
 */
export async function runStepImportPipeline(params: {
  path: string
  pythonPath: string
  appRoot: string
  id: string
}): Promise<StepImportOutcome> {
  const bridge = PythonBridge.start({ pythonPath: params.pythonPath, appRoot: params.appRoot })
  try {
    return await buildStepImportPart(params.path, params.id, bridgeAdapter(bridge))
  } catch (e) {
    // buildStepImportPart already folds bridge rejections; this catch only
    // covers a spawn-time throw (python_spawn_failed) before the first call.
    const mapped = mapBridgeError(e as PythonBridgeError)
    return { ok: false, error: mapped.error, hint: mapped.hint }
  } finally {
    await bridge.stop().catch(() => {
      // Already closed (timeout / crash). The failure was already reported.
    })
  }
}

export function registerAssemblyStepImportIpc(_ctx: MainIpcWindowContext): void {
  void _ctx
  ipcMain.handle(
    'assembly:importStepPart',
    async (_e, rawPath: unknown): Promise<AssemblyImportStepPartResponse> => {
      // 1. Lexical validation FIRST (null byte / extension / traversal) — fails
      //    fast before any filesystem touch.
      const lexical = validateStepImportPath(rawPath)
      if (!lexical.ok) {
        return { ok: false, error: lexical.reason, hint: lexical.hint }
      }
      const path = (rawPath as string).trim()

      // 2. Existence + size (IO). A missing file is an honest rejection; the
      //    size cap re-runs the SAME validator with the stat'd size so the
      //    100 MB rule lives in one place.
      let sizeBytes: number
      try {
        const st = await stat(path)
        if (!st.isFile()) {
          return {
            ok: false,
            error: 'not_a_file',
            hint: 'The selected path is not a regular file.'
          }
        }
        sizeBytes = st.size
      } catch {
        return {
          ok: false,
          error: 'file_not_found',
          hint: 'The STEP file could not be found. It may have been moved or deleted.'
        }
      }
      const sized = validateStepImportPath(path, sizeBytes)
      if (!sized.ok) {
        return { ok: false, error: sized.reason, hint: sized.hint }
      }

      // 3. Resolve the Python executable (with the shell-metachar guard).
      const settings = await loadSettings()
      const pythonPath = settings.pythonPath?.trim() || 'python'
      if (!isPythonPathSafe(pythonPath)) {
        return {
          ok: false,
          error: 'invalid_python_path',
          hint: 'The configured Python path contains invalid shell metacharacters. Check Settings → Paths.'
        }
      }

      // 4. Run the import → tessellate pipeline on ONE bridge. `id` is minted
      //    here (main-side) so the pure helper stays deterministic + clockless.
      return runStepImportPipeline({
        path,
        pythonPath,
        appRoot: app.getAppPath(),
        id: randomUUID()
      })
    }
  )
}
