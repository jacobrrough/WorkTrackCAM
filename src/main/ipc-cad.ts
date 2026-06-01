/**
 * IPC layer for the parametric CAD Design workspace (BUILD 2 + CAD V1
 * selection foundation).
 *
 * This module bridges the renderer's Design workspace to the Python sidecar's
 * `cad.execute_script` / `cad.export` / `cad.list_operations` /
 * `cad.tessellate_with_ids` handlers (in `engines/sidecar/cad_handlers.py`).
 * It follows the same dispatch pattern as `ipc-fabrication.ts` /
 * `ipc-core.ts` / `ipc-modeling.ts`:
 *
 *   - `registerCadIpc(ctx)` is called from `src/main/index.ts` inside
 *     `app.whenReady()` BEFORE `createWindow()` (IPC ordering invariant).
 *   - Each handler validates the payload at the IPC boundary (Safety Rule 4)
 *     before spawning a sidecar process, then delegates to the typed
 *     `PythonBridge.call(method, params)` client.
 *   - Errors are surfaced as a stable `{ ok: false, error, hint? }` envelope
 *     so the renderer never sees raw Python tracebacks.
 *
 * Why a fresh `PythonBridge` per call (not a long-lived singleton)?
 *
 *   - Mirrors the existing `runCamDomain` pattern in `ipc-fabrication.ts`,
 *     which spawns + tears down Python per CAM run. Cold-start cost is
 *     dominated by the CadQuery import (~1 s); compared to the cost of
 *     running `cqgi.parse(...).build(...)` itself, the spawn is in the noise.
 *   - Avoids cross-call handle-leak / stale-import-cache issues if the user
 *     reloads CadQuery or the sidecar crashes mid-build.
 *   - The renderer debounces `cad:listOperations` so the spawn rate stays
 *     in the single-digits-per-second range during normal editing.
 *
 * Safety Rules touched by this file
 * ---------------------------------
 *  - Rule 1 (G-code is sacred): NONE of these handlers emit G-code. They DO
 *    produce STL via the sidecar's existing `tessellate_body()` core, which
 *    filters degenerate triangles. The downstream `cam:run` handler
 *    (`ipc-fabrication.ts`) is the only G-code-emitting surface.
 *  - Rule 3 (no `any` types): the wire types in `sidecar-protocol.ts` are
 *    the source of truth; this module re-exports them in the response.
 *  - Rule 4 (no security vulns): every path is null-byte filtered; the
 *    script length is capped; `pythonPath` is run through `isPythonPathSafe`.
 */
import { app, ipcMain } from 'electron'
import type {
  CadDeclaredParameter,
  CadExecuteScriptMesh,
  CadExecuteScriptResult,
  CadExportFormat,
  CadExportResult,
  CadFaceMapEntry,
  CadListOperationsResult,
  CadOperationSummary,
  CadParseError,
  CadScriptError,
  CadScriptParamValue,
  CadTessellateWithIdsResult,
} from '../shared/sidecar-protocol'
import { PythonBridge, type PythonBridgeError } from './sidecar/python-bridge'
import { isPythonPathSafe } from './path-security'
import { loadSettings } from './settings-store'
import type { MainIpcWindowContext } from './ipc-context'

// ── Public envelopes (consumed by preload + renderer) ───────────────────────
//
// Errors NEVER throw -- every failure path folds into the response envelope
// so the renderer can render an inline error without try/catch ceremony.

export type CadExecuteResponse =
  | { ok: true; result: CadExecuteScriptResult }
  | { ok: false; error: string; hint?: string }

export type CadExportResponse =
  | { ok: true; result: CadExportResult }
  | { ok: false; error: string; hint?: string }

export type CadListOperationsResponse =
  | { ok: true; result: CadListOperationsResult }
  | { ok: false; error: string; hint?: string }

export type CadTessellateWithIdsResponse =
  | { ok: true; result: CadTessellateWithIdsResult }
  | { ok: false; error: string; hint?: string }

// ── Payload contracts (cross-checked in ipc-cad.test.ts) ────────────────────

export type CadExecutePayload = {
  script: string
  buildParameters?: Record<string, CadScriptParamValue>
}

export type CadExportPayload = {
  handle: string
  outPath: string
  format: CadExportFormat
  toleranceMm?: number
}

export type CadListOperationsPayload = { script: string }

export type CadTessellateWithIdsPayload = {
  handle: string
  toleranceMm?: number
}

// ── Validation constants ────────────────────────────────────────────────────

/**
 * Maximum accepted script length, in bytes (UTF-8). 100 KB is enough room
 * for any hand-written CadQuery script the MVP will produce -- the entire
 * `engines/cad/cadquery_import.py` reference is under 30 KB. We REJECT
 * anything bigger at the IPC boundary so a runaway renderer cannot funnel
 * a gigabyte of text through the JSON-RPC pipe.
 */
export const CAD_SCRIPT_MAX_BYTES = 100 * 1024 // 100 KB

/** Whitelist of export formats. Mirrors `CadExportFormat` -- kept in sync via the test. */
export const CAD_EXPORT_FORMATS: readonly CadExportFormat[] = ['step', 'stl', 'dxf'] as const

// ── Pure validators (exported for ipc-cad.test.ts) ──────────────────────────

/**
 * Validate a payload for the `cad:execute` IPC handler.
 *
 * Returns `null` on success, a structured `CadExecuteResponse` failure on
 * any violation. Pure -- no FS, no spawn, no electron globals. Safe to
 * call in unit tests.
 */
export function validateExecutePayload(
  raw: unknown,
): { ok: true; payload: CadExecutePayload } | CadExecuteResponse {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'invalid_payload', hint: 'cad:execute requires { script, buildParameters? }' }
  }
  const p = raw as { script?: unknown; buildParameters?: unknown }
  if (typeof p.script !== 'string' || p.script.length === 0) {
    return { ok: false, error: 'missing_script', hint: 'script must be a non-empty string' }
  }
  // UTF-8 byte length cap. `Buffer.byteLength` matches what the JSON-RPC
  // payload will actually weigh on the wire.
  if (Buffer.byteLength(p.script, 'utf8') > CAD_SCRIPT_MAX_BYTES) {
    return {
      ok: false,
      error: 'script_too_large',
      hint: `script exceeds ${CAD_SCRIPT_MAX_BYTES} bytes -- split into multiple files or trim comments`,
    }
  }
  // buildParameters is optional. When present, every value MUST be a
  // primitive scalar (number / boolean / string). This matches the wire
  // type `CadScriptParamValue` and what cqgi BuildResult.build expects.
  let buildParameters: Record<string, CadScriptParamValue> | undefined
  if (p.buildParameters !== undefined) {
    if (!p.buildParameters || typeof p.buildParameters !== 'object' || Array.isArray(p.buildParameters)) {
      return {
        ok: false,
        error: 'invalid_build_parameters',
        hint: 'buildParameters must be an object mapping name -> number | boolean | string',
      }
    }
    const out: Record<string, CadScriptParamValue> = {}
    for (const [k, v] of Object.entries(p.buildParameters as Record<string, unknown>)) {
      if (typeof v === 'number') {
        if (!Number.isFinite(v)) {
          return {
            ok: false,
            error: 'invalid_build_parameters',
            hint: `buildParameters[${JSON.stringify(k)}] must be a finite number`,
          }
        }
        out[k] = v
      } else if (typeof v === 'boolean' || typeof v === 'string') {
        out[k] = v
      } else {
        return {
          ok: false,
          error: 'invalid_build_parameters',
          hint: `buildParameters[${JSON.stringify(k)}] must be number | boolean | string`,
        }
      }
    }
    buildParameters = out
  }
  return { ok: true, payload: { script: p.script, ...(buildParameters !== undefined ? { buildParameters } : {}) } }
}

/**
 * Validate a payload for the `cad:export` IPC handler.
 *
 * Pure -- mirrors the validator shape used in ipc-fabrication.ts (e.g.
 * the `slice:orca` and `calibration:generate` validators).
 */
export function validateExportPayload(
  raw: unknown,
): { ok: true; payload: CadExportPayload } | CadExportResponse {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'invalid_payload', hint: 'cad:export requires { handle, outPath, format, toleranceMm? }' }
  }
  const p = raw as { handle?: unknown; outPath?: unknown; format?: unknown; toleranceMm?: unknown }
  if (typeof p.handle !== 'string' || p.handle.length === 0) {
    return { ok: false, error: 'missing_handle' }
  }
  if (typeof p.outPath !== 'string' || p.outPath.length === 0) {
    return { ok: false, error: 'missing_out_path' }
  }
  // Null-byte rejection -- same pattern as `slice:orca` / `fs:readBase64`.
  // A null byte in the path defeats every downstream path-safety check.
  if (p.outPath.includes('\0')) {
    return { ok: false, error: 'invalid_path', hint: 'outPath contains a null byte' }
  }
  if (typeof p.format !== 'string' || !(CAD_EXPORT_FORMATS as readonly string[]).includes(p.format)) {
    return {
      ok: false,
      error: 'invalid_format',
      hint: `format must be one of: ${CAD_EXPORT_FORMATS.join(', ')}`,
    }
  }
  let toleranceMm: number | undefined
  if (p.toleranceMm !== undefined) {
    if (typeof p.toleranceMm !== 'number' || !Number.isFinite(p.toleranceMm) || p.toleranceMm <= 0) {
      return {
        ok: false,
        error: 'invalid_tolerance',
        hint: 'toleranceMm must be a positive finite number',
      }
    }
    toleranceMm = p.toleranceMm
  }
  return {
    ok: true,
    payload: {
      handle: p.handle,
      outPath: p.outPath,
      format: p.format as CadExportFormat,
      ...(toleranceMm !== undefined ? { toleranceMm } : {}),
    },
  }
}

/**
 * Validate a payload for the `cad:listOperations` IPC handler.
 *
 * This one is the cheapest: it only checks the script length cap. The
 * sidecar does the AST + cqgi.parse work and is responsible for the rest.
 */
export function validateListOperationsPayload(
  raw: unknown,
): { ok: true; payload: CadListOperationsPayload } | CadListOperationsResponse {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'invalid_payload', hint: 'cad:listOperations requires { script }' }
  }
  const p = raw as { script?: unknown }
  if (typeof p.script !== 'string' || p.script.length === 0) {
    return { ok: false, error: 'missing_script' }
  }
  if (Buffer.byteLength(p.script, 'utf8') > CAD_SCRIPT_MAX_BYTES) {
    return {
      ok: false,
      error: 'script_too_large',
      hint: `script exceeds ${CAD_SCRIPT_MAX_BYTES} bytes -- split into multiple files or trim comments`,
    }
  }
  return { ok: true, payload: { script: p.script } }
}

/**
 * Validate a payload for the `cad:tessellateWithIds` IPC handler.
 *
 * `handle` is the only REQUIRED field -- the Design viewport's selection
 * call site only knows the handle from a prior `cad:execute` (or
 * `cad:import-step`) round-trip. `toleranceMm` is optional; the sidecar
 * defaults to 0.1 mm to match the bake in `cad.execute_script`. Mesh data
 * is returned in-memory (no `outPath`) because the renderer wants direct
 * buffer geometry input, not another file-IO round trip.
 *
 * Mirrors the validator pattern in `validateExportPayload` -- pure, no
 * FS / spawn / electron globals, so the unit test can exercise every
 * branch without standing up a sidecar.
 */
export function validateTessellateWithIdsPayload(
  raw: unknown,
): { ok: true; payload: CadTessellateWithIdsPayload } | CadTessellateWithIdsResponse {
  if (!raw || typeof raw !== 'object') {
    return {
      ok: false,
      error: 'invalid_payload',
      hint: 'cad:tessellateWithIds requires { handle, toleranceMm? }',
    }
  }
  const p = raw as { handle?: unknown; toleranceMm?: unknown }
  if (typeof p.handle !== 'string' || p.handle.length === 0) {
    return { ok: false, error: 'missing_handle' }
  }
  let toleranceMm: number | undefined
  if (p.toleranceMm !== undefined) {
    if (typeof p.toleranceMm !== 'number' || !Number.isFinite(p.toleranceMm) || p.toleranceMm <= 0) {
      return {
        ok: false,
        error: 'invalid_tolerance',
        hint: 'toleranceMm must be a positive finite number',
      }
    }
    toleranceMm = p.toleranceMm
  }
  return {
    ok: true,
    payload: {
      handle: p.handle,
      ...(toleranceMm !== undefined ? { toleranceMm } : {}),
    },
  }
}

// ── Error mapping helpers (pure, exported for tests) ────────────────────────

/**
 * Map a `PythonBridgeError` into a stable `{ error, hint }` envelope. The
 * renderer keys off `error` for retry behavior and shows `hint` to the
 * operator -- so both fields MUST be deterministic for a given bridge
 * failure mode.
 */
export function mapBridgeError(err: PythonBridgeError): { error: string; hint: string } {
  switch (err.code) {
    case 'python_spawn_failed':
      return {
        error: 'python_spawn_failed',
        hint:
          err.message ||
          'Failed to launch Python -- check Settings -> Paths and verify the configured Python 3 executable exists.',
      }
    case 'bridge_closed':
      return {
        error: 'sidecar_closed',
        hint: err.message || 'The Python sidecar exited unexpectedly. Check the developer console for the crash log.',
      }
    case 'bridge_timeout':
      return {
        error: 'sidecar_timeout',
        hint: err.message || 'The CadQuery operation took too long. Simplify the script or raise the timeout.',
      }
    case 'sidecar_error':
      // Pass through the sidecar's structured code so the renderer can branch
      // on `unsafe_script` / `script_exec_error` / `cadquery_not_installed`
      // / `invalid_handle` / `invalid_path` / `unsupported_format` etc.
      return { error: err.sidecarCode || 'sidecar_error', hint: err.message || '' }
    case 'bad_response':
      return { error: 'sidecar_protocol_error', hint: err.message || 'The sidecar returned a malformed response.' }
    default:
      return { error: 'sidecar_error', hint: 'Unknown sidecar failure.' }
  }
}

// ── Bridge helper ───────────────────────────────────────────────────────────

/**
 * Resolve the configured Python executable (with `isPythonPathSafe` guard)
 * and the app root. Centralized so all three handlers share one source of
 * truth -- if `pythonPath` is unsafe, we short-circuit BEFORE spawning.
 */
async function resolvePythonContext(): Promise<
  | { ok: true; pythonPath: string; appRoot: string }
  | { ok: false; error: string; hint: string }
> {
  const settings = await loadSettings()
  const pythonPath = settings.pythonPath?.trim() || 'python'
  if (!isPythonPathSafe(pythonPath)) {
    return {
      ok: false,
      error: 'invalid_python_path',
      hint: 'The configured Python path contains invalid shell metacharacters. Check Settings -> Paths.',
    }
  }
  return { ok: true, pythonPath, appRoot: app.getAppPath() }
}

/**
 * Spawn a fresh PythonBridge, run a single typed call, then stop the bridge.
 * Mirrors the test pattern in `cad-import-step.test.ts` -- the production
 * surface gets the same one-shot lifecycle so a sidecar crash on one
 * Design action cannot poison the next.
 */
async function callSidecar<TResult extends Record<string, unknown>>(
  method: string,
  params: Record<string, unknown>,
  ctx: { pythonPath: string; appRoot: string },
  timeoutMs: number,
): Promise<{ ok: true; result: TResult } | { ok: false; error: string; hint: string }> {
  const bridge = PythonBridge.start({ pythonPath: ctx.pythonPath, appRoot: ctx.appRoot })
  try {
    const result = await bridge.call<TResult>(method, params, { timeoutMs })
    return { ok: true, result }
  } catch (e) {
    const err = e as PythonBridgeError
    return { ok: false, ...mapBridgeError(err) }
  } finally {
    await bridge.stop().catch(() => {
      // Already closed (timeout / abort path). Swallow -- the failure has
      // already been reported through the call() rejection above.
    })
  }
}

// ── Result shape guards ─────────────────────────────────────────────────────
//
// Defense-in-depth: the sidecar should always honor the wire types, but if
// a future Python refactor drifts we surface a deterministic error code
// instead of letting `undefined` propagate into the renderer.

function looksLikeMesh(value: unknown): value is CadExecuteScriptMesh {
  if (!value || typeof value !== 'object') return false
  const m = value as Record<string, unknown>
  if (typeof m.handle !== 'string') return false
  if (typeof m.stlPath !== 'string') return false
  if (typeof m.triangleCount !== 'number') return false
  if (!m.bbox || typeof m.bbox !== 'object') return false
  const b = m.bbox as Record<string, unknown>
  return Array.isArray(b.min) && Array.isArray(b.max) && b.min.length === 3 && b.max.length === 3
}

function looksLikeParameter(value: unknown): value is CadDeclaredParameter {
  if (!value || typeof value !== 'object') return false
  const p = value as Record<string, unknown>
  if (typeof p.name !== 'string') return false
  if (p.kind !== 'number' && p.kind !== 'boolean' && p.kind !== 'string') return false
  return (
    typeof p.value === 'number' ||
    typeof p.value === 'boolean' ||
    typeof p.value === 'string'
  )
}

function looksLikeOperation(value: unknown): value is CadOperationSummary {
  if (!value || typeof value !== 'object') return false
  const o = value as Record<string, unknown>
  return (
    typeof o.index === 'number' &&
    typeof o.kind === 'string' &&
    typeof o.line === 'number' &&
    typeof o.summary === 'string'
  )
}

function looksLikeScriptError(value: unknown): value is CadScriptError {
  if (!value || typeof value !== 'object') return false
  const e = value as Record<string, unknown>
  return typeof e.code === 'string' && typeof e.message === 'string'
}

function looksLikeParseError(value: unknown): value is CadParseError {
  if (!value || typeof value !== 'object') return false
  const e = value as Record<string, unknown>
  return typeof e.line === 'number' && typeof e.message === 'string'
}

/**
 * Coerce the raw sidecar payload into the strongly-typed
 * `CadExecuteScriptResult` shape. Fields that come back malformed are
 * dropped rather than throwing so the renderer can still surface
 * whatever the sidecar did produce (typical case: error envelope but
 * empty meshes array).
 */
export function coerceExecuteResult(raw: Record<string, unknown>): CadExecuteScriptResult {
  const rawMeshes = Array.isArray(raw.meshes) ? raw.meshes : []
  const meshes: CadExecuteScriptMesh[] = rawMeshes.filter(looksLikeMesh)
  const faceCount = typeof raw.faceCount === 'number' && Number.isFinite(raw.faceCount) ? raw.faceCount : 0
  const log = Array.isArray(raw.log) ? raw.log.filter((l): l is string => typeof l === 'string') : []
  const error = looksLikeScriptError(raw.error) ? raw.error : undefined
  return error ? { meshes, faceCount, log, error } : { meshes, faceCount, log }
}

/** Same idea for `cad.list_operations`. */
export function coerceListOperationsResult(raw: Record<string, unknown>): CadListOperationsResult {
  const rawParams = Array.isArray(raw.parameters) ? raw.parameters : []
  const parameters: CadDeclaredParameter[] = rawParams.filter(looksLikeParameter)
  const rawOps = Array.isArray(raw.operations) ? raw.operations : []
  const operations: CadOperationSummary[] = rawOps.filter(looksLikeOperation)
  const parseError = looksLikeParseError(raw.parseError) ? raw.parseError : undefined
  return parseError ? { parameters, operations, parseError } : { parameters, operations }
}

/**
 * Result shape guard for a single `faceMap` entry. The sidecar may bin
 * malformed entries (e.g. ``occtHash`` missing on a binding mismatch) so we
 * mirror its defaults at the IPC boundary instead of trusting Python.
 */
function looksLikeFaceMapEntry(value: unknown): value is CadFaceMapEntry {
  if (!value || typeof value !== 'object') return false
  const e = value as Record<string, unknown>
  if (e.kind !== 'face') return false
  if (typeof e.occtHash !== 'number' || !Number.isFinite(e.occtHash)) return false
  return true
}

function looksLikeBbox(value: unknown): value is {
  min: [number, number, number]
  max: [number, number, number]
} {
  if (!value || typeof value !== 'object') return false
  const b = value as Record<string, unknown>
  return (
    Array.isArray(b.min) &&
    Array.isArray(b.max) &&
    b.min.length === 3 &&
    b.max.length === 3 &&
    b.min.every((v) => typeof v === 'number' && Number.isFinite(v)) &&
    b.max.every((v) => typeof v === 'number' && Number.isFinite(v))
  )
}

/**
 * Coerce the raw sidecar response for `cad.tessellate_with_ids` into the
 * strongly-typed `CadTessellateWithIdsResult`.
 *
 * Returns `null` when the response is structurally unusable (e.g. missing
 * `vertices` / `indices` / `faceIds`) -- the handler folds that into a
 * deterministic `sidecar_protocol_error` envelope so the renderer never
 * sees `undefined`.
 *
 * Defense-in-depth: malformed `faceMap` entries are dropped silently
 * rather than throwing; the renderer can still raycast with a sparse map
 * (it falls back to the generic `kind: 'face'` default for unknown ids).
 */
export function coerceTessellateWithIdsResult(
  raw: Record<string, unknown>,
): CadTessellateWithIdsResult | null {
  if (!Array.isArray(raw.vertices)) return null
  if (!Array.isArray(raw.indices)) return null
  if (!Array.isArray(raw.faceIds)) return null
  if (!looksLikeBbox(raw.bbox)) return null

  // Coerce numeric arrays. Anything non-finite collapses to 0 (vertices /
  // indices) or -1 (faceIds sentinel) to keep the array shape contract:
  // length divisible by 3 for vertices/indices, parallel to indices/3 for
  // faceIds. We do NOT silently trim because the renderer's BufferAttribute
  // relies on the exact lengths.
  const vertices: number[] = raw.vertices.map((v) =>
    typeof v === 'number' && Number.isFinite(v) ? v : 0,
  )
  const indices: number[] = raw.indices.map((v) =>
    typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v >= 0 ? v : 0,
  )
  const faceIds: number[] = raw.faceIds.map((v) =>
    typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v >= 0 ? v : -1,
  )

  const triangleCount =
    typeof raw.triangleCount === 'number' && Number.isFinite(raw.triangleCount)
      ? raw.triangleCount
      : faceIds.length

  // Coerce the faceMap dict. Each id key is preserved as-is (string) but
  // the entry must pass the shape guard; failures drop without throwing.
  const rawFaceMap = raw.faceMap && typeof raw.faceMap === 'object' && !Array.isArray(raw.faceMap)
    ? (raw.faceMap as Record<string, unknown>)
    : {}
  const faceMap: Record<string, CadFaceMapEntry> = {}
  for (const [id, entry] of Object.entries(rawFaceMap)) {
    if (looksLikeFaceMapEntry(entry)) {
      // Re-pick just the documented fields so an upstream sidecar that
      // adds extras doesn't leak them through to the renderer.
      const out: CadFaceMapEntry = { kind: 'face', occtHash: entry.occtHash }
      if (typeof entry.area === 'number' && Number.isFinite(entry.area)) out.area = entry.area
      if (typeof entry.error === 'string') out.error = entry.error
      faceMap[id] = out
    }
  }

  return {
    vertices,
    indices,
    faceIds,
    triangleCount,
    bbox: raw.bbox,
    faceMap,
  }
}

// ── Registration ────────────────────────────────────────────────────────────

export function registerCadIpc(_ctx: MainIpcWindowContext): void {
  // The `ctx` is accepted for parity with the other `register*Ipc` functions
  // -- none of the four handlers need a BrowserWindow today, but future
  // progress-event hooks (e.g. streaming `debug()` lines back to the
  // renderer) will reach for `ctx.getMainWindow()`. Keep the signature.
  void _ctx

  // cad:execute -- run a CadQuery script and tessellate each show_object body.
  ipcMain.handle('cad:execute', async (_e, raw: unknown): Promise<CadExecuteResponse> => {
    const v = validateExecutePayload(raw)
    if (!('payload' in v)) return v
    const pyCtx = await resolvePythonContext()
    if (!pyCtx.ok) return { ok: false, error: pyCtx.error, hint: pyCtx.hint }
    // Build is the slow path (CadQuery import + cqgi parse + tessellate).
    // 5-minute ceiling matches the longest-running CAM jobs in cam-runner.
    const r = await callSidecar<Record<string, unknown>>(
      'cad.execute_script',
      v.payload.buildParameters !== undefined
        ? { script: v.payload.script, buildParameters: v.payload.buildParameters }
        : { script: v.payload.script },
      pyCtx,
      300_000,
    )
    if (!r.ok) return { ok: false, error: r.error, hint: r.hint }
    return { ok: true, result: coerceExecuteResult(r.result) }
  })

  // cad:export -- write the body referenced by `handle` to STEP/STL/DXF.
  ipcMain.handle('cad:export', async (_e, raw: unknown): Promise<CadExportResponse> => {
    const v = validateExportPayload(raw)
    if (!('payload' in v)) return v
    const pyCtx = await resolvePythonContext()
    if (!pyCtx.ok) return { ok: false, error: pyCtx.error, hint: pyCtx.hint }
    const r = await callSidecar<Record<string, unknown>>(
      'cad.export',
      {
        handle: v.payload.handle,
        outPath: v.payload.outPath,
        format: v.payload.format,
        ...(v.payload.toleranceMm !== undefined ? { toleranceMm: v.payload.toleranceMm } : {}),
      },
      pyCtx,
      120_000,
    )
    if (!r.ok) return { ok: false, error: r.error, hint: r.hint }
    const outPath = typeof r.result.outPath === 'string' ? r.result.outPath : v.payload.outPath
    const bytesWritten =
      typeof r.result.bytesWritten === 'number' && Number.isFinite(r.result.bytesWritten)
        ? r.result.bytesWritten
        : 0
    return { ok: true, result: { outPath, bytesWritten } }
  })

  // cad:listOperations -- static introspection (AST + cqgi.parse); the
  // renderer calls this on every keystroke (debounced) so the FeatureTree
  // can update without executing the script.
  ipcMain.handle('cad:listOperations', async (_e, raw: unknown): Promise<CadListOperationsResponse> => {
    const v = validateListOperationsPayload(raw)
    if (!('payload' in v)) return v
    const pyCtx = await resolvePythonContext()
    if (!pyCtx.ok) return { ok: false, error: pyCtx.error, hint: pyCtx.hint }
    // Static parse is cheap -- 15 s is more than enough for any reasonable
    // script under the 100 KB cap (real-world scripts parse in <50 ms).
    const r = await callSidecar<Record<string, unknown>>(
      'cad.list_operations',
      { script: v.payload.script },
      pyCtx,
      15_000,
    )
    if (!r.ok) return { ok: false, error: r.error, hint: r.hint }
    return { ok: true, result: coerceListOperationsResult(r.result) }
  })

  // cad:tessellateWithIds -- selection-grade tessellation. Returns the same
  // mesh shape `cad:execute` emits, plus a per-triangle source-face id array
  // so the Design viewport can ray-pick a triangle and map it back to the
  // B-rep face. The renderer calls this once per execute-result body when
  // the user enables face selection; it does NOT run on every keystroke.
  ipcMain.handle(
    'cad:tessellateWithIds',
    async (_e, raw: unknown): Promise<CadTessellateWithIdsResponse> => {
      const v = validateTessellateWithIdsPayload(raw)
      if (!('payload' in v)) return v
      const pyCtx = await resolvePythonContext()
      if (!pyCtx.ok) return { ok: false, error: pyCtx.error, hint: pyCtx.hint }
      // 60 s ceiling -- a tessellation pass on the largest realistic body
      // (Laguna full-sheet) stays comfortably below that even at fine
      // tolerances, while still letting the renderer surface a sidecar
      // hang to the operator instead of waiting forever.
      const r = await callSidecar<Record<string, unknown>>(
        'cad.tessellate_with_ids',
        {
          handle: v.payload.handle,
          ...(v.payload.toleranceMm !== undefined ? { toleranceMm: v.payload.toleranceMm } : {}),
        },
        pyCtx,
        60_000,
      )
      if (!r.ok) return { ok: false, error: r.error, hint: r.hint }
      const coerced = coerceTessellateWithIdsResult(r.result)
      if (!coerced) {
        return {
          ok: false,
          error: 'sidecar_protocol_error',
          hint: 'cad.tessellate_with_ids returned a malformed vertices/indices/faceIds envelope',
        }
      }
      return { ok: true, result: coerced }
    },
  )
}
