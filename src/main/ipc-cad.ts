/**
 * IPC layer for the parametric CAD Design workspace (BUILD 2 + CAD V1
 * selection foundation).
 *
 * This module bridges the renderer's Design workspace to the Python sidecar's
 * `cad.execute_script` / `cad.export` / `cad.list_operations` /
 * `cad.tessellate_with_ids` / `cad.solve_sketch` handlers (in
 * `engines/sidecar/cad_handlers.py`).
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
  CadAddAssemblyMateParams,
  CadAddAssemblyMateResult,
  CadAssemblyMate,
  CadAssemblyMateKind,
  CadDeclaredParameter,
  CadExecuteScriptMesh,
  CadExecuteScriptResult,
  CadExportFormat,
  CadExportResult,
  CadEdgeMapEntry,
  CadEdgePolyline,
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

// ── cad:solveSketch types (CAD V1 sketcher) ──────────────────────────────────
//
// Bridges the renderer's Sketch2DCanvas to Agent S1's sidecar method
// ``cad.solve_sketch``. The sidecar owns the deep validation (point-id
// references / parameter resolution / constraint discriminator) -- the IPC
// boundary only enforces the envelope shape so a runaway renderer cannot
// funnel garbage at the JSON-RPC pipe.
//
// Wire contract (must match Agent S1's sidecar)
// ----------------------------------------------
// Params:
//   - sketch:      REQUIRED. The full sketch state (mirrors the design-schema
//                  shape -- ``points``, ``parameters``, ``entities``).
//   - constraints: REQUIRED. Array of constraint records (discriminated by
//                  ``type`` -- ``coincident`` / ``distance`` / ... see
//                  ``shared/design-schema.ts``).
//
// Result (best-effort permissive shape):
//   - points:    Record<string, { x, y, fixed? }> -- the solved positions.
//   - residual:  Optional scalar (sum of squared constraint residuals after
//                solve), surfaced by the Diagnostics panel.
//   - iterations: Optional integer iteration count.
//   - converged: Optional boolean -- ``true`` if the solver hit the
//                convergence threshold before the iteration cap.
//   - log:       Optional array of human-readable diagnostic strings.
/**
 * Solved point map -- echoes the input ``points`` shape but with updated
 * coordinates. ``fixed`` is preserved so the renderer's gizmo can keep
 * locked points pinned after a round-trip.
 */
export type CadSolveSketchPoint = {
  x: number
  y: number
  fixed?: boolean
}

export type CadSolveSketchResult = {
  /**
   * Solved positions keyed by point id. Always present on success; may
   * echo the original positions when ``constraints`` is empty.
   */
  points: Record<string, CadSolveSketchPoint>
  /** Sum-of-squared residual after solve (smaller is better). */
  residual?: number
  /** Iteration count consumed by the sidecar solver. */
  iterations?: number
  /** ``true`` when the solver converged below its residual threshold. */
  converged?: boolean
  /** Human-readable diagnostic lines (mirrors ``cad.execute_script`` log). */
  log?: string[]
}

export type CadSolveSketchResponse =
  | { ok: true; result: CadSolveSketchResult }
  | { ok: false; error: string; hint?: string }

// ── cad:createAssembly / tessellateAssembly / exportAssembly (CAD V2) ───────
//
// Bridges the renderer's Assembly view to the sidecar's
// ``cad.create_assembly`` / ``cad.tessellate_assembly`` / ``cad.export_assembly``
// methods (Agent A1's work). The IPC boundary enforces the envelope only --
// the sidecar owns deep validation of the assembly tree (instance references,
// joint kinds, transform shapes, etc.) since that schema mirrors
// ``shared/assembly-schema.ts`` and would drift if duplicated.
//
// Why a single ``assembly: Record<string, unknown>`` blob instead of
// re-typing the full assembly DAG here?
//
//   - The renderer's assembly state is already a Zod-validated
//     ``AssemblyFile`` (see ``shared/assembly-schema.ts``); the IPC layer
//     would either re-validate (slow + duplicate maintenance burden) or
//     trust the renderer (then the type at the boundary is fiction).
//   - The sidecar will validate the same fields. One source of truth.
//   - This mirrors ``CadSolveSketchPayload``'s permissive shape -- same
//     trade-off, same precedent.

/**
 * Per-instance tessellated mesh emitted by ``cad.tessellate_assembly``. One
 * entry per visible part instance in the assembly tree. Mirrors the
 * ``CadExecuteScriptMesh`` shape with an extra ``instanceId`` so the renderer
 * can route a mesh to its corresponding row in the assembly tree.
 */
export type CadAssemblyInstanceMesh = {
  /** Stable instance id from the source ``assembly.json`` (same as the persisted shape). */
  instanceId: string
  /** Opaque per-instance handle (subordinate to the parent assembly handle). */
  handle: string
  /** Absolute path to the binary STL written by the sidecar (Safety Rule 1 degenerate filter applied). */
  stlPath: string
  /** Triangle count in the STL. */
  triangleCount: number
  /** Axis-aligned bbox in mm of THIS instance (already transformed into world space). */
  bbox: { min: [number, number, number]; max: [number, number, number] }
}

export type CadCreateAssemblyResult = {
  /** Opaque parent assembly handle -- pass back into tessellate/export. */
  handle: string
  /** Axis-aligned bbox of the whole assembly in mm (union of every instance). */
  bbox: { min: [number, number, number]; max: [number, number, number] }
  /** Instance count after resolving the tree (excludes hidden/suppressed instances). */
  instanceCount: number
}

export type CadTessellateAssemblyResult = {
  /** Per-instance meshes; renderer indexes by ``instanceId``. */
  meshes: CadAssemblyInstanceMesh[]
  /** Axis-aligned bbox of the whole assembly (echoed from ``createAssembly``). */
  bbox: { min: [number, number, number]; max: [number, number, number] }
}

export type CadExportAssemblyResult = {
  outPath: string
  bytesWritten: number
}

export type CadCreateAssemblyResponse =
  | { ok: true; result: CadCreateAssemblyResult }
  | { ok: false; error: string; hint?: string }

export type CadTessellateAssemblyResponse =
  | { ok: true; result: CadTessellateAssemblyResult }
  | { ok: false; error: string; hint?: string }

export type CadExportAssemblyResponse =
  | { ok: true; result: CadExportAssemblyResult }
  | { ok: false; error: string; hint?: string }

// ── cad:addAssemblyMate (CAD V1.5 — Wave 3 mate constraints) ────────────────
//
// Bridges the renderer's V1.5 AssemblyView Mates panel to the sidecar's
// ``cad.add_assembly_mate`` handler. Single-mate-at-a-time call matches the
// renderer's modal flow (operator picks two features → confirms → call).
//
// The payload is constrained to the typed ``CadAddAssemblyMateParams`` shape
// here (unlike the permissive ``addAssemblyMate`` placeholder on
// ``shop-types.ts``) so the IPC boundary catches structural drift between
// the renderer and the sidecar BEFORE we burn the cost of a Python spawn.
// The renderer can still cast through ``Record<string, unknown>`` if needed
// — the validator just normalizes the shape.

export type CadAddAssemblyMateResponse =
  | { ok: true; result: CadAddAssemblyMateResult }
  | { ok: false; error: string; hint?: string }

export type CadAddAssemblyMatePayload = CadAddAssemblyMateParams

// ── cad:projectDrawing / exportDrawing (CAD V2 -- 2D documentation) ─────────
//
// Bridges the renderer's Drawing view to the sidecar's
// ``cad.project_drawing`` / ``cad.export_drawing`` methods (Agent A2's
// work). The drawing pipeline takes an assembly OR a part handle plus a
// drawing-sheet description (mirrors ``shared/drawing-sheet-schema.ts``)
// and emits projected linework for each ``viewPlaceholder``.
//
// Wire contract notes:
//   - ``handle`` references a body already in the sidecar handle table
//     (from ``cad.execute_script`` / ``cad.create_assembly`` / etc.).
//   - ``sheet`` is the full ``DrawingSheet`` blob -- permissive object at
//     the IPC layer, sidecar walks the ``viewPlaceholders`` array and
//     projects each entry per its ``viewFrom`` / ``projectionDirection``.
//   - ``format`` for exportDrawing is restricted to ``pdf`` / ``dxf`` --
//     STEP / STL are part-level only.

export const CAD_DRAWING_EXPORT_FORMATS = ['pdf', 'dxf'] as const
export type CadDrawingExportFormat = (typeof CAD_DRAWING_EXPORT_FORMATS)[number]

/**
 * Projected view emitted by ``cad.project_drawing``. One entry per
 * ``DrawingViewPlaceholder`` in the source sheet. Carries the raw
 * line-segment list (``[[x0,y0],[x1,y1]]``) plus the placeholder id so the
 * renderer can route segments to the correct viewport slot.
 *
 * Segments are 2D (sheet-space mm). Hidden / dashed segments live on a
 * separate ``hiddenSegments`` array so the renderer can style them
 * differently without re-running an HLR pass.
 */
export type CadDrawingProjectedView = {
  /** Source ``DrawingViewPlaceholder.id`` -- pin to the sheet's placeholder list. */
  placeholderId: string
  /** Visible (solid) line segments in mm. Each segment is ``[[x0,y0],[x1,y1]]``. */
  segments: Array<[[number, number], [number, number]]>
  /** Hidden (dashed) line segments behind the silhouette. Always present; may be empty. */
  hiddenSegments: Array<[[number, number], [number, number]]>
  /** Bounding box of the projected linework in sheet-space mm. */
  bbox: { min: [number, number]; max: [number, number] }
}

export type CadProjectDrawingResult = {
  /** One entry per ``viewPlaceholder`` in the source sheet (best-effort -- failures bin per-view). */
  views: CadDrawingProjectedView[]
  /** Optional diagnostic log (e.g. "view 'top' fell back to mesh projection tier B"). */
  log?: string[]
}

export type CadExportDrawingResult = {
  outPath: string
  bytesWritten: number
}

/** Single-view projection result (the ``{handle, view}`` payload variant). */
export type CadProjectDrawingSingleViewResult = { svg: string }

export type CadProjectDrawingResponse =
  | { ok: true; result: CadProjectDrawingResult | CadProjectDrawingSingleViewResult }
  | { ok: false; error: string; hint?: string }

export type CadExportDrawingResponse =
  | { ok: true; result: CadExportDrawingResult }
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

/**
 * Payload for the ``cad:solveSketch`` IPC handler.
 *
 * Boundary contract only -- the sidecar owns the deep validation. We keep
 * the wire shape permissive (``Record<string, unknown>`` / ``unknown[]``)
 * because the sketch state matches the renderer's full design-schema dict
 * (points + parameters + entities) and the constraint list is the same
 * discriminated union the design-schema Zod parser owns. Defining the rich
 * shape twice (Zod here AND in Python) would drift faster than it stayed
 * useful.
 */
export type CadSolveSketchPayload = {
  /**
   * Full sketch state: typically the ``DesignFileV2`` slice the renderer
   * carries (points / parameters / entities / metadata). The sidecar
   * unpacks these into its own ``Sketch`` model.
   */
  sketch: Record<string, unknown>
  /**
   * Discriminated constraint list -- each entry carries a ``type`` field
   * and constraint-specific point references / parameter keys (see
   * ``shared/design-schema.ts``). The sidecar walks the array and routes
   * each constraint to the matching residual term.
   */
  constraints: unknown[]
}

/**
 * Payload for ``cad:createAssembly``. The renderer ships the full assembly
 * tree (mirrors ``shared/assembly-schema.ts`` -- ``parts`` / ``instances`` /
 * ``rootName`` etc.) so the sidecar can resolve part handles, joints, and
 * transforms in a single round-trip.
 *
 * Permissive at the IPC boundary -- the Zod parser on the renderer side and
 * the sidecar's own validation own the deep shape. See the rationale on the
 * ``CadSolveSketchPayload`` comment.
 */
export type CadCreateAssemblyPayload = {
  /**
   * Parts to wrap into an assembly -- each entry a body handle + optional
   * ``name`` + 4x4 ``transform`` (matches the renderer's ``AssemblyView`` call
   * and the sidecar's ``build_assembly_from_parts``). Permissive at the IPC
   * boundary; the sidecar owns deep validation.
   */
  parts: ReadonlyArray<Record<string, unknown>>
}

/**
 * Payload for ``cad:tessellateAssembly``. Mirrors
 * ``CadTessellateWithIdsPayload`` but the ``handle`` references an assembly
 * (from ``cad:createAssembly``) rather than a part. Returns one mesh per
 * visible instance so the renderer can place each STL in world space.
 */
export type CadTessellateAssemblyPayload = {
  /** Opaque handle from a prior ``cad:createAssembly`` round-trip. */
  handle: string
  /** Optional surface deviation tolerance in mm. Sidecar default 0.1 mm. */
  toleranceMm?: number
}

/**
 * Payload for ``cad:exportAssembly``. Same shape as ``cad:export`` -- the
 * sidecar wires the assembly into a single combined body (STEP) or a
 * tessellated container STL before writing. Format whitelist mirrors the
 * part-level exporter (``step`` / ``stl`` -- DXF is not meaningful for an
 * assembled multi-part body).
 */
export type CadExportAssemblyPayload = {
  handle: string
  outPath: string
  /** ``dxf`` is rejected -- DXF makes no sense for a 3D assembled body. */
  format: 'step' | 'stl'
  /** Optional STL tolerance (mm). Ignored for STEP. */
  toleranceMm?: number
}

/**
 * Payload for ``cad:projectDrawing``. The renderer ships the
 * ``DrawingSheet`` blob (mirrors ``shared/drawing-sheet-schema.ts``) along
 * with the source body's ``handle`` so the sidecar can run the projection
 * pipeline (mesh tier A/B/C, or true BRep HLR when CadQuery succeeds).
 *
 * Permissive at the IPC boundary for the same reason as
 * ``CadSolveSketchPayload`` / ``CadCreateAssemblyPayload``: the renderer's
 * Zod parser owns the schema; duplicating it here would drift.
 */
export type CadProjectDrawingPayload =
  | {
      /** Source body handle (part from ``cad:execute`` or assembly from ``cad:createAssembly``). */
      handle: string
      /** Full ``DrawingSheet`` blob -- sidecar walks ``viewPlaceholders``. */
      sheet: Record<string, unknown>
    }
  | {
      /**
       * Wave 6 (HLR) -- the single-view contract the sidecar's
       * ``cad.project_drawing`` handler ACTUALLY implements ({handle, view,
       * includeHlr?} -> {svg}). DrawingView's base projection + the
       * Hidden-lines toggle ride this variant; the ``sheet`` variant above is
       * kept for the planned sheet-walking pipeline.
       */
      handle: string
      view: string
      includeHlr?: boolean
    }

/**
 * Payload for ``cad:exportDrawing``. Renders the projected linework from
 * ``cad:projectDrawing`` into PDF or DXF on disk. Title-block metadata
 * (sheet name / scale / template hint) travels in the ``sheet`` blob so the
 * sidecar can stamp the export shell.
 */
export type CadExportDrawingPayload = {
  /** Source body handle -- same as ``cad:projectDrawing``'s ``handle``. */
  handle: string
  outPath: string
  /** Whitelisted via ``CAD_DRAWING_EXPORT_FORMATS``. */
  format: CadDrawingExportFormat
  /** Full ``DrawingSheet`` blob, including ``viewPlaceholders``. */
  sheet: Record<string, unknown>
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

/**
 * Whitelist of export formats. Mirrors `CadExportFormat` -- kept in sync via the
 * test. Phase-3 multi-format export: 'step' / 'stl' / 'dxf' (original) plus '3mf'
 * / 'amf' / 'brep' — all proven REAL against the bundled CadQuery build. This is
 * the SECURITY whitelist: `validateExportPayload` rejects any `format` not in
 * this set (Security Rule 4 — no format injection / arbitrary-exporter dispatch),
 * and the save-dialog filter set is derived from it so a chosen extension always
 * maps to a real exporter.
 */
export const CAD_EXPORT_FORMATS: readonly CadExportFormat[] = ['step', 'stl', 'dxf', '3mf', 'amf', 'brep'] as const

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

/**
 * Validate a payload for the ``cad:solveSketch`` IPC handler.
 *
 * Pure -- enforces only the envelope shape so the sidecar can do the deep
 * validation (point-id resolution, parameter lookup, constraint
 * discriminator). Both ``sketch`` and ``constraints`` are REQUIRED; we
 * keep the inner shapes permissive (object / array) so the renderer's
 * design-schema can evolve without dragging the IPC layer along.
 */
export function validateSolveSketchPayload(
  raw: unknown,
): { ok: true; payload: CadSolveSketchPayload } | CadSolveSketchResponse {
  if (!raw || typeof raw !== 'object') {
    return {
      ok: false,
      error: 'invalid_payload',
      hint: 'cad:solveSketch requires { sketch, constraints }',
    }
  }
  const p = raw as { sketch?: unknown; constraints?: unknown }
  if (!p.sketch || typeof p.sketch !== 'object' || Array.isArray(p.sketch)) {
    return {
      ok: false,
      error: 'missing_sketch',
      hint: 'sketch must be an object describing the sketch state (points / parameters / entities)',
    }
  }
  if (!Array.isArray(p.constraints)) {
    return {
      ok: false,
      error: 'missing_constraints',
      hint: 'constraints must be an array of constraint records',
    }
  }
  return {
    ok: true,
    payload: {
      sketch: p.sketch as Record<string, unknown>,
      constraints: p.constraints,
    },
  }
}

/**
 * Validate a payload for the ``cad:createAssembly`` IPC handler.
 *
 * Pure -- enforces only the envelope shape (``assembly`` must be a non-array
 * object). The sidecar owns the deep validation of the assembly tree.
 */
export function validateCreateAssemblyPayload(
  raw: unknown,
): { ok: true; payload: CadCreateAssemblyPayload } | CadCreateAssemblyResponse {
  if (!raw || typeof raw !== 'object') {
    return {
      ok: false,
      error: 'invalid_payload',
      hint: 'cad:createAssembly requires { parts }',
    }
  }
  const p = raw as { parts?: unknown }
  if (!Array.isArray(p.parts) || p.parts.length === 0) {
    return {
      ok: false,
      error: 'missing_parts',
      hint: 'parts must be a non-empty array of { handle, transform?, name? } entries',
    }
  }
  return {
    ok: true,
    payload: { parts: p.parts as ReadonlyArray<Record<string, unknown>> },
  }
}

/**
 * Validate a payload for the ``cad:tessellateAssembly`` IPC handler.
 *
 * Mirrors ``validateTessellateWithIdsPayload`` -- ``handle`` is required,
 * ``toleranceMm`` is optional but must be a finite positive number when
 * present.
 */
export function validateTessellateAssemblyPayload(
  raw: unknown,
): { ok: true; payload: CadTessellateAssemblyPayload } | CadTessellateAssemblyResponse {
  if (!raw || typeof raw !== 'object') {
    return {
      ok: false,
      error: 'invalid_payload',
      hint: 'cad:tessellateAssembly requires { handle, toleranceMm? }',
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

/**
 * Validate a payload for the ``cad:exportAssembly`` IPC handler.
 *
 * Same envelope shape as ``validateExportPayload`` but with a narrower
 * format whitelist (``step`` / ``stl`` only -- DXF rejected) and the
 * mandatory null-byte path check.
 */
export function validateExportAssemblyPayload(
  raw: unknown,
): { ok: true; payload: CadExportAssemblyPayload } | CadExportAssemblyResponse {
  if (!raw || typeof raw !== 'object') {
    return {
      ok: false,
      error: 'invalid_payload',
      hint: 'cad:exportAssembly requires { handle, outPath, format, toleranceMm? }',
    }
  }
  const p = raw as { handle?: unknown; outPath?: unknown; format?: unknown; toleranceMm?: unknown }
  if (typeof p.handle !== 'string' || p.handle.length === 0) {
    return { ok: false, error: 'missing_handle' }
  }
  if (typeof p.outPath !== 'string' || p.outPath.length === 0) {
    return { ok: false, error: 'missing_out_path' }
  }
  if (p.outPath.includes('\0')) {
    return { ok: false, error: 'invalid_path', hint: 'outPath contains a null byte' }
  }
  if (p.format !== 'step' && p.format !== 'stl') {
    return {
      ok: false,
      error: 'invalid_format',
      hint: 'format must be one of: step, stl (dxf is not supported for assembly exports)',
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
      format: p.format,
      ...(toleranceMm !== undefined ? { toleranceMm } : {}),
    },
  }
}

/**
 * Validate a payload for the ``cad:addAssemblyMate`` IPC handler.
 *
 * Pure -- enforces the typed envelope shape so the sidecar can short-circuit
 * before spawning a Python process. The deep mate validation
 * (3-vector finite-number checks, child-name resolution) lives in the
 * sidecar; this validator catches structural drift:
 *   - ``handle`` must be a non-empty assembly handle string,
 *   - ``mate.kind`` must be one of ``point`` / ``axis`` / ``plane``,
 *   - ``mate.part1Id`` / ``mate.part2Id`` must be non-empty strings, AND
 *   - per-kind feature payloads must be 3-tuples.
 *
 * Each rejected mate carries a hint that points the renderer at the
 * specific bad field so the modal can surface a precise validation error
 * BEFORE we round-trip to Python.
 */
export function validateAddAssemblyMatePayload(
  raw: unknown,
):
  | { ok: true; payload: CadAddAssemblyMatePayload }
  | CadAddAssemblyMateResponse {
  if (!raw || typeof raw !== 'object') {
    return {
      ok: false,
      error: 'invalid_payload',
      hint: 'cad:addAssemblyMate requires { handle, mate }',
    }
  }
  const p = raw as { handle?: unknown; mate?: unknown }
  if (typeof p.handle !== 'string' || p.handle.length === 0) {
    return { ok: false, error: 'missing_handle' }
  }
  if (!p.mate || typeof p.mate !== 'object' || Array.isArray(p.mate)) {
    return {
      ok: false,
      error: 'missing_mate',
      hint: 'mate must be an object with { kind, part1Id, part2Id, ...features }',
    }
  }
  const mateRaw = p.mate as Record<string, unknown>
  const kind = mateRaw.kind
  if (kind !== 'point' && kind !== 'axis' && kind !== 'plane') {
    return {
      ok: false,
      error: 'invalid_mate_kind',
      hint: 'mate.kind must be one of: point, axis, plane',
    }
  }
  const part1Id = mateRaw.part1Id
  if (typeof part1Id !== 'string' || part1Id.length === 0) {
    return { ok: false, error: 'missing_part1Id' }
  }
  const part2Id = mateRaw.part2Id
  if (typeof part2Id !== 'string' || part2Id.length === 0) {
    return { ok: false, error: 'missing_part2Id' }
  }
  if (part1Id === part2Id) {
    return {
      ok: false,
      error: 'invalid_mate',
      hint: 'mate.part1Id and mate.part2Id must reference different children',
    }
  }
  // Per-kind feature presence + shape checks. Deep finite-number checks are
  // delegated to the sidecar -- a non-finite value would be caught there
  // with a structured ``bad_params`` and surface to the operator as a
  // sidecar_error envelope, same as every other CadQuery handler.
  if (kind === 'point' || kind === 'plane') {
    if (!looks3Vector(mateRaw.point1)) {
      return {
        ok: false,
        error: 'invalid_mate',
        hint: 'mate.point1 must be a [x, y, z] tuple of numbers',
      }
    }
    if (!looks3Vector(mateRaw.point2)) {
      return {
        ok: false,
        error: 'invalid_mate',
        hint: 'mate.point2 must be a [x, y, z] tuple of numbers',
      }
    }
  }
  if (kind === 'axis') {
    if (!looks3Vector(mateRaw.axis1)) {
      return {
        ok: false,
        error: 'invalid_mate',
        hint: 'mate.axis1 must be a [x, y, z] tuple of numbers',
      }
    }
    if (!looks3Vector(mateRaw.axis2)) {
      return {
        ok: false,
        error: 'invalid_mate',
        hint: 'mate.axis2 must be a [x, y, z] tuple of numbers',
      }
    }
  }
  if (kind === 'plane') {
    if (!looks3Vector(mateRaw.normal1)) {
      return {
        ok: false,
        error: 'invalid_mate',
        hint: 'mate.normal1 must be a [x, y, z] tuple of numbers',
      }
    }
    if (!looks3Vector(mateRaw.normal2)) {
      return {
        ok: false,
        error: 'invalid_mate',
        hint: 'mate.normal2 must be a [x, y, z] tuple of numbers',
      }
    }
  }
  // Cast through ``unknown`` so the discriminated-union return type lines up.
  return {
    ok: true,
    payload: {
      handle: p.handle,
      mate: p.mate as unknown as CadAssemblyMate,
    },
  }
}

/**
 * Shape guard: is this a 3-tuple of numbers? Used by the
 * ``validateAddAssemblyMatePayload`` helper to reject malformed feature
 * payloads at the IPC boundary. Allows ``int`` / ``float`` and rejects
 * ``NaN`` / ``Infinity`` so the sidecar's stricter finite-number check
 * never sees them.
 */
function looks3Vector(value: unknown): value is [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) return false
  for (const v of value) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return false
  }
  return true
}

/**
 * Validate a payload for the ``cad:projectDrawing`` IPC handler.
 *
 * Pure -- envelope-only. The sidecar walks the ``sheet.viewPlaceholders``
 * array and projects each entry; the deep schema check is owned by the
 * renderer's ``drawingSheetSchema`` Zod parser.
 */
export function validateProjectDrawingPayload(
  raw: unknown,
): { ok: true; payload: CadProjectDrawingPayload } | CadProjectDrawingResponse {
  if (!raw || typeof raw !== 'object') {
    return {
      ok: false,
      error: 'invalid_payload',
      hint: 'cad:projectDrawing requires { handle, sheet }',
    }
  }
  const p = raw as { handle?: unknown; sheet?: unknown; view?: unknown; includeHlr?: unknown }
  if (typeof p.handle !== 'string' || p.handle.length === 0) {
    return { ok: false, error: 'missing_handle' }
  }
  // Single-view variant ({handle, view, includeHlr?}) -- the contract the
  // sidecar actually implements. Envelope-only checks; the deep view whitelist
  // lives sidecar-side (bad_params on unknown views).
  if (typeof p.view === 'string' && p.view.length > 0) {
    if (p.includeHlr !== undefined && typeof p.includeHlr !== 'boolean') {
      return {
        ok: false,
        error: 'invalid_payload',
        hint: 'includeHlr must be a boolean when present',
      }
    }
    return {
      ok: true,
      payload: {
        handle: p.handle,
        view: p.view,
        ...(p.includeHlr !== undefined ? { includeHlr: p.includeHlr } : {}),
      },
    }
  }
  if (!p.sheet || typeof p.sheet !== 'object' || Array.isArray(p.sheet)) {
    return {
      ok: false,
      error: 'missing_sheet',
      hint: 'sheet must be an object describing the drawing sheet (id, name, viewPlaceholders)',
    }
  }
  return {
    ok: true,
    payload: {
      handle: p.handle,
      sheet: p.sheet as Record<string, unknown>,
    },
  }
}

/**
 * Validate a payload for the ``cad:exportDrawing`` IPC handler.
 *
 * Combines the handle / sheet checks from ``validateProjectDrawingPayload``
 * with the out-path + format whitelist from ``validateExportPayload``.
 * Format whitelist is ``pdf`` / ``dxf`` -- ``CAD_DRAWING_EXPORT_FORMATS``.
 */
export function validateExportDrawingPayload(
  raw: unknown,
): { ok: true; payload: CadExportDrawingPayload } | CadExportDrawingResponse {
  if (!raw || typeof raw !== 'object') {
    return {
      ok: false,
      error: 'invalid_payload',
      hint: 'cad:exportDrawing requires { handle, outPath, format, sheet }',
    }
  }
  const p = raw as { handle?: unknown; outPath?: unknown; format?: unknown; sheet?: unknown }
  if (typeof p.handle !== 'string' || p.handle.length === 0) {
    return { ok: false, error: 'missing_handle' }
  }
  if (typeof p.outPath !== 'string' || p.outPath.length === 0) {
    return { ok: false, error: 'missing_out_path' }
  }
  if (p.outPath.includes('\0')) {
    return { ok: false, error: 'invalid_path', hint: 'outPath contains a null byte' }
  }
  if (typeof p.format !== 'string' || !(CAD_DRAWING_EXPORT_FORMATS as readonly string[]).includes(p.format)) {
    return {
      ok: false,
      error: 'invalid_format',
      hint: `format must be one of: ${CAD_DRAWING_EXPORT_FORMATS.join(', ')}`,
    }
  }
  if (!p.sheet || typeof p.sheet !== 'object' || Array.isArray(p.sheet)) {
    return {
      ok: false,
      error: 'missing_sheet',
      hint: 'sheet must be an object describing the drawing sheet (id, name, viewPlaceholders)',
    }
  }
  return {
    ok: true,
    payload: {
      handle: p.handle,
      outPath: p.outPath,
      format: p.format as CadDrawingExportFormat,
      sheet: p.sheet as Record<string, unknown>,
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

/**
 * FG-5b · Result shape guard for a single `edgeMap` entry. Same defensive
 * posture as {@link looksLikeFaceMapEntry}: the sidecar may bin a malformed
 * edge (length read failure → 0), so we validate the minimum shape and let the
 * coercer re-pick the documented fields.
 */
/**
 * FG-5 · Result shape guard for a single `edges` polyline entry. Validates the
 * stable id + a points array of `[x, y, z]` number triples (length >= 2). A
 * malformed polyline is dropped by the coercer (the renderer simply can't pick
 * that one edge) rather than poisoning the whole tessellation.
 */
function looksLikeEdgePolyline(value: unknown): value is CadEdgePolyline {
  if (!value || typeof value !== 'object') return false
  const e = value as Record<string, unknown>
  if (typeof e.id !== 'string' || e.id.length === 0) return false
  if (!Array.isArray(e.points) || e.points.length < 2) return false
  for (const pt of e.points) {
    if (!Array.isArray(pt) || pt.length !== 3) return false
    if (typeof pt[0] !== 'number' || !Number.isFinite(pt[0])) return false
    if (typeof pt[1] !== 'number' || !Number.isFinite(pt[1])) return false
    if (typeof pt[2] !== 'number' || !Number.isFinite(pt[2])) return false
  }
  return true
}

function looksLikeEdgeMapEntry(value: unknown): value is CadEdgeMapEntry {
  if (!value || typeof value !== 'object') return false
  const e = value as Record<string, unknown>
  if (e.kind !== 'edge') return false
  if (typeof e.occtId !== 'string' || e.occtId.length === 0) return false
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
      // FG-5b: carry the stable face handle when the sidecar emitted it
      // (single-body path always does; assembly path does not yet).
      if (typeof entry.occtId === 'string' && entry.occtId.length > 0) out.occtId = entry.occtId
      if (typeof entry.area === 'number' && Number.isFinite(entry.area)) out.area = entry.area
      if (typeof entry.error === 'string') out.error = entry.error
      faceMap[id] = out
    }
  }

  // FG-5b: coerce the edgeMap dict (keyed by stable edge id). Absent / malformed
  // entries are dropped silently — the renderer falls back to face-only picking.
  const rawEdgeMap = raw.edgeMap && typeof raw.edgeMap === 'object' && !Array.isArray(raw.edgeMap)
    ? (raw.edgeMap as Record<string, unknown>)
    : {}
  const edgeMap: Record<string, CadEdgeMapEntry> = {}
  for (const [id, entry] of Object.entries(rawEdgeMap)) {
    if (looksLikeEdgeMapEntry(entry)) {
      const out: CadEdgeMapEntry = {
        kind: 'edge',
        occtId: entry.occtId,
        occtHash: entry.occtHash,
        length:
          typeof entry.length === 'number' && Number.isFinite(entry.length) ? entry.length : 0,
      }
      edgeMap[id] = out
    }
  }

  // FG-5: coerce the edge polyline list (parallel to edgeMap). Each entry is
  // re-validated; malformed polylines drop silently so the renderer renders +
  // raycasts only the well-formed edges (face picking is unaffected either way).
  const edges: CadEdgePolyline[] = Array.isArray(raw.edges)
    ? raw.edges.filter(looksLikeEdgePolyline).map((e) => ({
        id: e.id,
        points: e.points.map(
          (p): [number, number, number] => [p[0], p[1], p[2]],
        ),
      }))
    : []

  return {
    vertices,
    indices,
    faceIds,
    triangleCount,
    bbox: raw.bbox,
    faceMap,
    edgeMap,
    edges,
  }
}

/**
 * Coerce the raw ``cad.solve_sketch`` response into the typed
 * ``CadSolveSketchResult``. Returns ``null`` when the response cannot be
 * trusted (missing or malformed ``points`` map) so the handler can fold it
 * into a ``sidecar_protocol_error`` envelope instead of letting the
 * renderer see ``undefined``.
 *
 * Defense-in-depth: per-point entries that fail the shape guard collapse
 * to ``{ x: 0, y: 0 }`` rather than dropping the key -- the renderer
 * relies on the keys to line up with its existing ``points`` dictionary,
 * so dropping silently would cause coordinate drift.
 */
export function coerceSolveSketchResult(
  raw: Record<string, unknown>,
): CadSolveSketchResult | null {
  if (!raw.points || typeof raw.points !== 'object' || Array.isArray(raw.points)) {
    return null
  }
  const rawPoints = raw.points as Record<string, unknown>
  const points: Record<string, CadSolveSketchPoint> = {}
  for (const [id, entry] of Object.entries(rawPoints)) {
    if (!entry || typeof entry !== 'object') {
      points[id] = { x: 0, y: 0 }
      continue
    }
    const pt = entry as { x?: unknown; y?: unknown; fixed?: unknown }
    const x = typeof pt.x === 'number' && Number.isFinite(pt.x) ? pt.x : 0
    const y = typeof pt.y === 'number' && Number.isFinite(pt.y) ? pt.y : 0
    const out: CadSolveSketchPoint = { x, y }
    if (typeof pt.fixed === 'boolean') out.fixed = pt.fixed
    points[id] = out
  }
  const result: CadSolveSketchResult = { points }
  if (typeof raw.residual === 'number' && Number.isFinite(raw.residual)) {
    result.residual = raw.residual
  }
  if (
    typeof raw.iterations === 'number' &&
    Number.isFinite(raw.iterations) &&
    Number.isInteger(raw.iterations) &&
    raw.iterations >= 0
  ) {
    result.iterations = raw.iterations
  }
  if (typeof raw.converged === 'boolean') {
    result.converged = raw.converged
  }
  if (Array.isArray(raw.log)) {
    result.log = raw.log.filter((l): l is string => typeof l === 'string')
  }
  return result
}

// ── Assembly / drawing result coercers (CAD V2) ─────────────────────────────

/**
 * Shape guard for an assembly instance mesh entry. Mirrors ``looksLikeMesh``
 * but adds the required ``instanceId`` field.
 */
function looksLikeAssemblyInstanceMesh(value: unknown): value is CadAssemblyInstanceMesh {
  if (!value || typeof value !== 'object') return false
  const m = value as Record<string, unknown>
  if (typeof m.instanceId !== 'string') return false
  if (typeof m.handle !== 'string') return false
  if (typeof m.stlPath !== 'string') return false
  if (typeof m.triangleCount !== 'number' || !Number.isFinite(m.triangleCount)) return false
  return looksLikeBbox(m.bbox)
}

/** Shape guard for a 2D bbox (``{ min: [x,y], max: [x,y] }``). */
function looksLike2dBbox(value: unknown): value is {
  min: [number, number]
  max: [number, number]
} {
  if (!value || typeof value !== 'object') return false
  const b = value as Record<string, unknown>
  return (
    Array.isArray(b.min) &&
    Array.isArray(b.max) &&
    b.min.length === 2 &&
    b.max.length === 2 &&
    b.min.every((v) => typeof v === 'number' && Number.isFinite(v)) &&
    b.max.every((v) => typeof v === 'number' && Number.isFinite(v))
  )
}

/** Shape guard for a 2D line segment ``[[x0,y0],[x1,y1]]``. */
function looksLike2dSegment(value: unknown): value is [[number, number], [number, number]] {
  if (!Array.isArray(value) || value.length !== 2) return false
  for (const pt of value) {
    if (!Array.isArray(pt) || pt.length !== 2) return false
    if (typeof pt[0] !== 'number' || !Number.isFinite(pt[0])) return false
    if (typeof pt[1] !== 'number' || !Number.isFinite(pt[1])) return false
  }
  return true
}

/**
 * Coerce the raw sidecar payload into the strongly-typed
 * ``CadCreateAssemblyResult``. Returns ``null`` when the response is
 * structurally unusable (missing handle / bbox) so the handler can fold it
 * into a ``sidecar_protocol_error`` envelope.
 */
export function coerceCreateAssemblyResult(
  raw: Record<string, unknown>,
): CadCreateAssemblyResult | null {
  if (typeof raw.handle !== 'string' || raw.handle.length === 0) return null
  if (!looksLikeBbox(raw.bbox)) return null
  const instanceCount =
    typeof raw.instanceCount === 'number' &&
    Number.isFinite(raw.instanceCount) &&
    Number.isInteger(raw.instanceCount) &&
    raw.instanceCount >= 0
      ? raw.instanceCount
      : 0
  return {
    handle: raw.handle,
    bbox: raw.bbox,
    instanceCount,
  }
}

/**
 * Coerce the raw sidecar payload into the strongly-typed
 * ``CadTessellateAssemblyResult``. Malformed per-instance entries drop
 * silently (defense-in-depth) -- the renderer falls back to whatever
 * instances did make it through.
 */
export function coerceTessellateAssemblyResult(
  raw: Record<string, unknown>,
): CadTessellateAssemblyResult | null {
  if (!Array.isArray(raw.meshes)) return null
  if (!looksLikeBbox(raw.bbox)) return null
  const meshes: CadAssemblyInstanceMesh[] = raw.meshes.filter(looksLikeAssemblyInstanceMesh)
  return { meshes, bbox: raw.bbox }
}

/**
 * Coerce the raw sidecar payload into the strongly-typed
 * ``CadProjectDrawingResult``. Malformed per-view entries drop silently;
 * malformed segments within a view drop silently too. Returns ``null`` only
 * if ``views`` itself is missing (then the handler folds to
 * ``sidecar_protocol_error``).
 */
export function coerceProjectDrawingResult(
  raw: Record<string, unknown>,
): CadProjectDrawingResult | null {
  if (!Array.isArray(raw.views)) return null
  const views: CadDrawingProjectedView[] = []
  for (const v of raw.views) {
    if (!v || typeof v !== 'object') continue
    const view = v as Record<string, unknown>
    if (typeof view.placeholderId !== 'string' || view.placeholderId.length === 0) continue
    if (!looksLike2dBbox(view.bbox)) continue
    const segments: Array<[[number, number], [number, number]]> = Array.isArray(view.segments)
      ? view.segments.filter(looksLike2dSegment)
      : []
    const hiddenSegments: Array<[[number, number], [number, number]]> = Array.isArray(view.hiddenSegments)
      ? view.hiddenSegments.filter(looksLike2dSegment)
      : []
    views.push({
      placeholderId: view.placeholderId,
      segments,
      hiddenSegments,
      bbox: view.bbox,
    })
  }
  const result: CadProjectDrawingResult = { views }
  if (Array.isArray(raw.log)) {
    result.log = raw.log.filter((l): l is string => typeof l === 'string')
  }
  return result
}

/**
 * Coerce the raw ``cad.add_assembly_mate`` sidecar response into the
 * strongly-typed ``CadAddAssemblyMateResult``. Returns ``null`` when the
 * envelope is structurally unusable so the handler can fold to a
 * deterministic ``sidecar_protocol_error`` instead of leaking ``undefined``
 * into the renderer.
 *
 * Mirrors the defense-in-depth pattern used by
 * ``coerceCreateAssemblyResult`` -- malformed bbox / handle drop to the
 * null branch; ``kind`` is coerced to one of the discriminated values or
 * the response is rejected entirely.
 */
export function coerceAddAssemblyMateResult(
  raw: Record<string, unknown>,
): CadAddAssemblyMateResult | null {
  if (typeof raw.handle !== 'string' || raw.handle.length === 0) return null
  if (typeof raw.part1Id !== 'string' || raw.part1Id.length === 0) return null
  if (typeof raw.part2Id !== 'string' || raw.part2Id.length === 0) return null
  if (raw.kind !== 'point' && raw.kind !== 'axis' && raw.kind !== 'plane') {
    return null
  }
  if (!looksLikeBbox(raw.bbox)) return null
  return {
    handle: raw.handle,
    kind: raw.kind as CadAssemblyMateKind,
    part1Id: raw.part1Id,
    part2Id: raw.part2Id,
    bbox: raw.bbox,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// CAD V1.5 — Drawing dimensions / sections / title block IPC layer.
// Additive section; kept diff-isolated from the BUILD 1-6 surface above so
// the V1.5 wave can land alongside the assembly-mate wave without merge
// pain. All types / validators / coercers in this section are prefixed
// with ``V15`` (or ``cad:dimensionDrawing`` / ``cad:sectionDrawing`` /
// ``cad:attachTitleBlock`` for the IPC channel names) so they are easy to
// spot in a diff.
// ────────────────────────────────────────────────────────────────────────────

import type {
  CadAttachTitleBlockParams as V15CadAttachTitleBlockParams,
  CadAttachTitleBlockResult as V15CadAttachTitleBlockResult,
  CadDimensionDrawingParams as V15CadDimensionDrawingParams,
  CadDimensionDrawingResult as V15CadDimensionDrawingResult,
  CadDimensionKind as V15CadDimensionKind,
  CadDimensionPoint2D as V15CadDimensionPoint2D,
  CadDimensionSpec as V15CadDimensionSpec,
  CadDrawingView as V15CadDrawingView,
  CadSectionAxis as V15CadSectionAxis,
  CadSectionDrawingParams as V15CadSectionDrawingParams,
  CadSectionDrawingResult as V15CadSectionDrawingResult,
  CadSectionKeepSide as V15CadSectionKeepSide,
  CadSectionPlane as V15CadSectionPlane,
  CadTitleBlockMetadata as V15CadTitleBlockMetadata,
  CadHlrSectionParams as V15CadHlrSectionParams,
  CadHlrSectionResult as V15CadHlrSectionResult,
  CadHlrEdgePolyline as V15CadHlrEdgePolyline,
  CadExtractDrawingGeometryParams as V15CadExtractDrawingGeometryParams,
  CadExtractDrawingGeometryResult as V15CadExtractDrawingGeometryResult,
  CadDrawingVertex as V15CadDrawingVertex,
  CadDrawingProjectedEdge as V15CadDrawingProjectedEdge,
  CadDrawingSnapPoint as V15CadDrawingSnapPoint,
  CadDrawingSnapKind as V15CadDrawingSnapKind,
  CadDrawingEdgeKind as V15CadDrawingEdgeKind,
  CadDrawingBomTableParams as V15CadDrawingBomTableParams,
  CadDrawingBomTableResult as V15CadDrawingBomTableResult,
  CadDrawingBomRow as V15CadDrawingBomRow,
  CadAnnotateGdtParams as V15CadAnnotateGdtParams,
  CadAnnotateGdtResult as V15CadAnnotateGdtResult,
  CadGdtCharacteristic as V15CadGdtCharacteristic,
  CadGdtFrameSpec as V15CadGdtFrameSpec,
  CadDetailDrawingParams as V15CadDetailDrawingParams,
  CadDetailDrawingResult as V15CadDetailDrawingResult,
} from '../shared/sidecar-protocol'

/** Allowed dimension kinds (V1.5). Mirrors the sidecar's vocabulary. */
export const V15_DIMENSION_KINDS: readonly V15CadDimensionKind[] = [
  'distance',
  'radius',
  'diameter',
  'angle',
] as const

/** Allowed view names (V1.5). Mirrors the BUILD-3 drawing view vocabulary. */
export const V15_DRAWING_VIEWS: readonly V15CadDrawingView[] = [
  'front',
  'top',
  'right',
  'iso',
] as const

/** Allowed section axes (V1.5). */
export const V15_SECTION_AXES: readonly V15CadSectionAxis[] = ['x', 'y', 'z'] as const

/** Allowed keep-sides for the section plane (V1.5). */
export const V15_SECTION_KEEP_SIDES: readonly V15CadSectionKeepSide[] = [
  'positive',
  'negative',
] as const

export type V15CadDimensionDrawingPayload = V15CadDimensionDrawingParams
export type V15CadSectionDrawingPayload = V15CadSectionDrawingParams
export type V15CadAttachTitleBlockPayload = V15CadAttachTitleBlockParams

export type V15CadDimensionDrawingResponse =
  | { ok: true; result: V15CadDimensionDrawingResult }
  | { ok: false; error: string; hint?: string }

export type V15CadSectionDrawingResponse =
  | { ok: true; result: V15CadSectionDrawingResult }
  | { ok: false; error: string; hint?: string }

export type V15CadAttachTitleBlockResponse =
  | { ok: true; result: V15CadAttachTitleBlockResult }
  | { ok: false; error: string; hint?: string }

/**
 * Validate a 2D point spec (``{x, y}``). Returns the same shape on success
 * (so callers can keep their typed view) or a string error.
 */
function v15ValidatePoint2D(
  raw: unknown,
  field: string,
): { ok: true; value: V15CadDimensionPoint2D } | { ok: false; error: string; hint: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'invalid_dimension', hint: `${field} must be an object with x/y numeric keys` }
  }
  const p = raw as { x?: unknown; y?: unknown }
  if (typeof p.x !== 'number' || !Number.isFinite(p.x)) {
    return { ok: false, error: 'invalid_dimension', hint: `${field}.x must be a finite number` }
  }
  if (typeof p.y !== 'number' || !Number.isFinite(p.y)) {
    return { ok: false, error: 'invalid_dimension', hint: `${field}.y must be a finite number` }
  }
  return { ok: true, value: { x: p.x, y: p.y } }
}

/**
 * Validate a single dimension spec. Returns the normalized spec or an
 * error envelope ready to fold into the response.
 */
export function v15ValidateDimensionSpec(
  raw: unknown,
  index: number,
): { ok: true; value: V15CadDimensionSpec } | { ok: false; error: string; hint: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      error: 'invalid_dimension',
      hint: `dimensions[${index}] must be an object`,
    }
  }
  const spec = raw as { kind?: unknown; label?: unknown }
  const kind = spec.kind
  if (typeof kind !== 'string' || !(V15_DIMENSION_KINDS as readonly string[]).includes(kind)) {
    return {
      ok: false,
      error: 'invalid_dimension',
      hint: `dimensions[${index}].kind must be one of: ${V15_DIMENSION_KINDS.join(', ')}`,
    }
  }
  if (spec.label !== undefined && typeof spec.label !== 'string') {
    return {
      ok: false,
      error: 'invalid_dimension',
      hint: `dimensions[${index}].label must be a string when provided`,
    }
  }
  // Per-kind validation.
  const raw2 = raw as Record<string, unknown>
  if (kind === 'distance') {
    const p1 = v15ValidatePoint2D(raw2.p1, `dimensions[${index}].p1`)
    if (!p1.ok) return p1
    const p2 = v15ValidatePoint2D(raw2.p2, `dimensions[${index}].p2`)
    if (!p2.ok) return p2
    let offset: number | undefined
    if (raw2.offset !== undefined) {
      if (typeof raw2.offset !== 'number' || !Number.isFinite(raw2.offset)) {
        return {
          ok: false,
          error: 'invalid_dimension',
          hint: `dimensions[${index}].offset must be a finite number when provided`,
        }
      }
      offset = raw2.offset
    }
    const out: V15CadDimensionSpec = {
      kind: 'distance',
      p1: p1.value,
      p2: p2.value,
      ...(offset !== undefined ? { offset } : {}),
      ...(typeof spec.label === 'string' ? { label: spec.label } : {}),
    }
    return { ok: true, value: out }
  }
  if (kind === 'radius' || kind === 'diameter') {
    const center = v15ValidatePoint2D(raw2.center, `dimensions[${index}].center`)
    if (!center.ok) return center
    const edge = v15ValidatePoint2D(raw2.edge, `dimensions[${index}].edge`)
    if (!edge.ok) return edge
    const out: V15CadDimensionSpec = {
      kind,
      center: center.value,
      edge: edge.value,
      ...(typeof spec.label === 'string' ? { label: spec.label } : {}),
    }
    return { ok: true, value: out }
  }
  // angle
  const vertex = v15ValidatePoint2D(raw2.vertex, `dimensions[${index}].vertex`)
  if (!vertex.ok) return vertex
  const arm1 = v15ValidatePoint2D(raw2.arm1, `dimensions[${index}].arm1`)
  if (!arm1.ok) return arm1
  const arm2 = v15ValidatePoint2D(raw2.arm2, `dimensions[${index}].arm2`)
  if (!arm2.ok) return arm2
  const out: V15CadDimensionSpec = {
    kind: 'angle',
    vertex: vertex.value,
    arm1: arm1.value,
    arm2: arm2.value,
    ...(typeof spec.label === 'string' ? { label: spec.label } : {}),
  }
  return { ok: true, value: out }
}

/**
 * Validate the ``cad:dimensionDrawing`` IPC payload. Pure -- no FS / spawn
 * / electron globals. Mirrors the shape of the BUILD-3 drawing validators.
 */
export function v15ValidateDimensionDrawingPayload(
  raw: unknown,
): { ok: true; payload: V15CadDimensionDrawingPayload } | V15CadDimensionDrawingResponse {
  if (!raw || typeof raw !== 'object') {
    return {
      ok: false,
      error: 'invalid_payload',
      hint: 'cad:dimensionDrawing requires { handle, view, dimensions }',
    }
  }
  const p = raw as { handle?: unknown; view?: unknown; dimensions?: unknown }
  if (typeof p.handle !== 'string' || p.handle.length === 0) {
    return { ok: false, error: 'missing_handle' }
  }
  if (typeof p.view !== 'string' || !(V15_DRAWING_VIEWS as readonly string[]).includes(p.view)) {
    return {
      ok: false,
      error: 'invalid_view',
      hint: `view must be one of: ${V15_DRAWING_VIEWS.join(', ')}`,
    }
  }
  if (!Array.isArray(p.dimensions)) {
    return {
      ok: false,
      error: 'invalid_dimensions',
      hint: 'dimensions must be an array (use [] for the bare projection)',
    }
  }
  const dimensions: V15CadDimensionSpec[] = []
  for (let i = 0; i < p.dimensions.length; i++) {
    const v = v15ValidateDimensionSpec(p.dimensions[i], i)
    if (!v.ok) return v
    dimensions.push(v.value)
  }
  return {
    ok: true,
    payload: {
      handle: p.handle,
      view: p.view as V15CadDrawingView,
      dimensions,
    },
  }
}

/**
 * Validate the ``cad:sectionDrawing`` IPC payload.
 */
export function v15ValidateSectionDrawingPayload(
  raw: unknown,
): { ok: true; payload: V15CadSectionDrawingPayload } | V15CadSectionDrawingResponse {
  if (!raw || typeof raw !== 'object') {
    return {
      ok: false,
      error: 'invalid_payload',
      hint: 'cad:sectionDrawing requires { handle, view, plane }',
    }
  }
  const p = raw as { handle?: unknown; view?: unknown; plane?: unknown; label?: unknown }
  if (typeof p.handle !== 'string' || p.handle.length === 0) {
    return { ok: false, error: 'missing_handle' }
  }
  if (typeof p.view !== 'string' || !(V15_DRAWING_VIEWS as readonly string[]).includes(p.view)) {
    return {
      ok: false,
      error: 'invalid_view',
      hint: `view must be one of: ${V15_DRAWING_VIEWS.join(', ')}`,
    }
  }
  // ``label`` is optional, additive operator free-text. Reject a non-string at
  // the wire boundary; the sidecar normalizes + entity-escapes it (Safety Rule 4).
  let sectionLabel: string | undefined
  if (p.label !== undefined && p.label !== null) {
    if (typeof p.label !== 'string') {
      return { ok: false, error: 'invalid_label', hint: 'label must be a string when provided' }
    }
    sectionLabel = p.label
  }
  if (!p.plane || typeof p.plane !== 'object' || Array.isArray(p.plane)) {
    return {
      ok: false,
      error: 'invalid_plane',
      hint: 'plane must be an object with axis / offset / keepSide? keys',
    }
  }
  const plane = p.plane as { axis?: unknown; offset?: unknown; keepSide?: unknown }
  if (typeof plane.axis !== 'string' || !(V15_SECTION_AXES as readonly string[]).includes(plane.axis)) {
    return {
      ok: false,
      error: 'invalid_plane',
      hint: `plane.axis must be one of: ${V15_SECTION_AXES.join(', ')}`,
    }
  }
  if (typeof plane.offset !== 'number' || !Number.isFinite(plane.offset)) {
    return {
      ok: false,
      error: 'invalid_plane',
      hint: 'plane.offset must be a finite number',
    }
  }
  let keepSide: V15CadSectionKeepSide | undefined
  if (plane.keepSide !== undefined) {
    if (
      typeof plane.keepSide !== 'string' ||
      !(V15_SECTION_KEEP_SIDES as readonly string[]).includes(plane.keepSide)
    ) {
      return {
        ok: false,
        error: 'invalid_plane',
        hint: `plane.keepSide must be one of: ${V15_SECTION_KEEP_SIDES.join(', ')}`,
      }
    }
    keepSide = plane.keepSide as V15CadSectionKeepSide
  }
  const out: V15CadSectionPlane = {
    axis: plane.axis as V15CadSectionAxis,
    offset: plane.offset,
    ...(keepSide !== undefined ? { keepSide } : {}),
  }
  return {
    ok: true,
    payload: {
      handle: p.handle,
      view: p.view as V15CadDrawingView,
      plane: out,
      ...(sectionLabel !== undefined ? { label: sectionLabel } : {}),
    },
  }
}

/**
 * Validate the ``cad:attachTitleBlock`` IPC payload. The metadata fields
 * are individually optional but must be strings when present.
 */
export function v15ValidateAttachTitleBlockPayload(
  raw: unknown,
): { ok: true; payload: V15CadAttachTitleBlockPayload } | V15CadAttachTitleBlockResponse {
  if (!raw || typeof raw !== 'object') {
    return {
      ok: false,
      error: 'invalid_payload',
      hint: 'cad:attachTitleBlock requires { svg, metadata }',
    }
  }
  const p = raw as { svg?: unknown; metadata?: unknown }
  if (typeof p.svg !== 'string' || p.svg.length === 0) {
    return {
      ok: false,
      error: 'missing_svg',
      hint: 'svg must be a non-empty SVG markup string',
    }
  }
  if (!p.metadata || typeof p.metadata !== 'object' || Array.isArray(p.metadata)) {
    return {
      ok: false,
      error: 'invalid_metadata',
      hint: 'metadata must be an object with title-block fields (name / scale / author / date / sheet)',
    }
  }
  const metaRaw = p.metadata as Record<string, unknown>
  const metadata: V15CadTitleBlockMetadata = {}
  for (const field of ['name', 'scale', 'author', 'date', 'sheet'] as const) {
    const v = metaRaw[field]
    if (v === undefined || v === null) continue
    if (typeof v !== 'string') {
      return {
        ok: false,
        error: 'invalid_metadata',
        hint: `metadata.${field} must be a string when provided`,
      }
    }
    metadata[field] = v
  }
  return {
    ok: true,
    payload: {
      svg: p.svg,
      metadata,
    },
  }
}

/**
 * Coerce the raw sidecar payload into ``CadDimensionDrawingResult``.
 * Returns ``null`` if the response is structurally unusable so the handler
 * can fold to ``sidecar_protocol_error``.
 */
export function v15CoerceDimensionDrawingResult(
  raw: Record<string, unknown>,
): V15CadDimensionDrawingResult | null {
  if (typeof raw.svg !== 'string') return null
  if (typeof raw.view !== 'string' || !(V15_DRAWING_VIEWS as readonly string[]).includes(raw.view)) {
    return null
  }
  const bytes =
    typeof raw.bytes === 'number' && Number.isFinite(raw.bytes)
      ? raw.bytes
      : Buffer.byteLength(raw.svg, 'utf8')
  const dimensionCount =
    typeof raw.dimensionCount === 'number' &&
    Number.isFinite(raw.dimensionCount) &&
    Number.isInteger(raw.dimensionCount) &&
    raw.dimensionCount >= 0
      ? raw.dimensionCount
      : 0
  return {
    svg: raw.svg,
    view: raw.view as V15CadDrawingView,
    bytes,
    dimensionCount,
  }
}

/** Coerce the raw sidecar payload into ``CadSectionDrawingResult``. */
export function v15CoerceSectionDrawingResult(
  raw: Record<string, unknown>,
): V15CadSectionDrawingResult | null {
  if (typeof raw.svg !== 'string') return null
  if (typeof raw.view !== 'string' || !(V15_DRAWING_VIEWS as readonly string[]).includes(raw.view)) {
    return null
  }
  if (!raw.plane || typeof raw.plane !== 'object' || Array.isArray(raw.plane)) return null
  const plane = raw.plane as Record<string, unknown>
  if (typeof plane.axis !== 'string' || !(V15_SECTION_AXES as readonly string[]).includes(plane.axis)) {
    return null
  }
  if (typeof plane.offset !== 'number' || !Number.isFinite(plane.offset)) return null
  const keepSide =
    typeof plane.keepSide === 'string' &&
    (V15_SECTION_KEEP_SIDES as readonly string[]).includes(plane.keepSide)
      ? (plane.keepSide as V15CadSectionKeepSide)
      : 'positive'
  const bytes =
    typeof raw.bytes === 'number' && Number.isFinite(raw.bytes)
      ? raw.bytes
      : Buffer.byteLength(raw.svg, 'utf8')
  return {
    svg: raw.svg,
    view: raw.view as V15CadDrawingView,
    bytes,
    plane: {
      axis: plane.axis as V15CadSectionAxis,
      offset: plane.offset,
      keepSide,
    },
  }
}

/** Coerce the raw sidecar payload into ``CadAttachTitleBlockResult``. */
export function v15CoerceAttachTitleBlockResult(
  raw: Record<string, unknown>,
): V15CadAttachTitleBlockResult | null {
  if (typeof raw.svg !== 'string') return null
  if (!raw.metadata || typeof raw.metadata !== 'object' || Array.isArray(raw.metadata)) return null
  const meta = raw.metadata as Record<string, unknown>
  const out: V15CadAttachTitleBlockResult['metadata'] = {
    name: typeof meta.name === 'string' ? meta.name : '',
    scale: typeof meta.scale === 'string' ? meta.scale : '',
    author: typeof meta.author === 'string' ? meta.author : '',
    date: typeof meta.date === 'string' ? meta.date : '',
    sheet: typeof meta.sheet === 'string' ? meta.sheet : '',
  }
  const bytes =
    typeof raw.bytes === 'number' && Number.isFinite(raw.bytes)
      ? raw.bytes
      : Buffer.byteLength(raw.svg, 'utf8')
  return {
    svg: raw.svg,
    bytes,
    metadata: out,
  }
}

// ----------------------------------------------------------------------------
// CAD V1.5 -- 3D viewport true-HLR section cut IPC layer (BUILD 8).
// Distinct from the V15 section-DRAWING surface above: this drives the 3D
// viewport's engineering section overlay, not the 2D SVG drawing. Types /
// validator / coercer are prefixed with ``V15Hlr`` (channel ``cad:hlrSection``)
// so they stay easy to spot in a diff. Reuses the module-level ``looks3Vector``
// guard for the plane-normal / view-dir checks.
// ----------------------------------------------------------------------------

export type V15HlrSectionPayload = V15CadHlrSectionParams

export type V15HlrSectionResponse =
  | { ok: true; result: V15CadHlrSectionResult }
  | { ok: false; error: string; hint?: string }

/**
 * Validate the ``cad:hlrSection`` IPC payload. Pure -- no FS / spawn / electron
 * globals. The sidecar owns the deep geometry checks (zero-length vectors,
 * degenerate planes); this gate catches structural drift before a Python
 * spawn: ``handle`` non-empty, ``planeNormal`` / ``viewDir`` finite 3-vectors,
 * ``planeOffset`` finite, optional ``toleranceMm`` positive finite.
 */
export function v15ValidateHlrSectionPayload(
  raw: unknown,
): { ok: true; payload: V15HlrSectionPayload } | V15HlrSectionResponse {
  if (!raw || typeof raw !== 'object') {
    return {
      ok: false,
      error: 'invalid_payload',
      hint: 'cad:hlrSection requires { handle, planeNormal, planeOffset, viewDir, toleranceMm? }',
    }
  }
  const p = raw as {
    handle?: unknown
    planeNormal?: unknown
    planeOffset?: unknown
    viewDir?: unknown
    toleranceMm?: unknown
  }
  if (typeof p.handle !== 'string' || p.handle.length === 0) {
    return { ok: false, error: 'missing_handle' }
  }
  if (!looks3Vector(p.planeNormal)) {
    return {
      ok: false,
      error: 'invalid_plane_normal',
      hint: 'planeNormal must be a finite [x, y, z] vector',
    }
  }
  if (typeof p.planeOffset !== 'number' || !Number.isFinite(p.planeOffset)) {
    return {
      ok: false,
      error: 'invalid_plane_offset',
      hint: 'planeOffset must be a finite number',
    }
  }
  if (!looks3Vector(p.viewDir)) {
    return {
      ok: false,
      error: 'invalid_view_dir',
      hint: 'viewDir must be a finite [x, y, z] vector',
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
      planeNormal: p.planeNormal,
      planeOffset: p.planeOffset,
      viewDir: p.viewDir,
      ...(toleranceMm !== undefined ? { toleranceMm } : {}),
    },
  }
}

/**
 * Shape guard for one HLR edge polyline (>= 2 points, each a finite 3-tuple).
 * Malformed polylines drop silently in the coercer (defense-in-depth) so a
 * single bad edge never poisons the whole overlay.
 */
function looksHlrPolyline(value: unknown): value is V15CadHlrEdgePolyline {
  if (!Array.isArray(value) || value.length < 2) return false
  for (const pt of value) {
    if (!Array.isArray(pt) || pt.length !== 3) return false
    if (typeof pt[0] !== 'number' || !Number.isFinite(pt[0])) return false
    if (typeof pt[1] !== 'number' || !Number.isFinite(pt[1])) return false
    if (typeof pt[2] !== 'number' || !Number.isFinite(pt[2])) return false
  }
  return true
}

/**
 * Coerce the raw ``cad.hlr_section`` sidecar payload into the strongly-typed
 * ``CadHlrSectionResult``. Returns ``null`` when the response is structurally
 * unusable (missing edge arrays / bbox) so the handler can fold to a
 * deterministic ``sidecar_protocol_error`` envelope. Malformed individual
 * polylines / non-finite cap floats drop silently.
 */
export function v15CoerceHlrSectionResult(
  raw: Record<string, unknown>,
): V15CadHlrSectionResult | null {
  if (!Array.isArray(raw.visibleEdges)) return null
  if (!Array.isArray(raw.hiddenEdges)) return null
  if (!Array.isArray(raw.capFaceOutline)) return null
  if (!Array.isArray(raw.capFaceTriangles)) return null
  if (!looksLikeBbox(raw.bbox)) return null

  const visibleEdges: V15CadHlrEdgePolyline[] = raw.visibleEdges.filter(looksHlrPolyline)
  const hiddenEdges: V15CadHlrEdgePolyline[] = raw.hiddenEdges.filter(looksHlrPolyline)
  const capFaceOutline: V15CadHlrEdgePolyline[] = raw.capFaceOutline.filter(looksHlrPolyline)
  const capFaceTriangles: number[] = raw.capFaceTriangles.map((v) =>
    typeof v === 'number' && Number.isFinite(v) ? v : 0,
  )

  return {
    visibleEdges,
    hiddenEdges,
    capFaceTriangles,
    capFaceOutline,
    bbox: raw.bbox,
    truncated: raw.truncated === true,
  }
}

// ----------------------------------------------------------------------------
// CAD V1.5 -- Associative-dimension geometry + BOM-table stamp IPC layer
// (BUILD 9). Two additive channels:
//   * cad:extractDrawingGeometry -- projected 2D geometry with stable ids
//     (vertices / edges / snapPoints) so the renderer's DrawingView can place
//     associative dimensions. Channel for the deferred-hook ``extractSnapPoints``
//     the renderer's DrawingView comment already names.
//   * cad:drawingBomTable -- stamp a BOM-table <g> into an SVG from the rows
//     the assembly already provides (pure composition; no recompute).
// Types / validators / coercers are prefixed ``V15Geom`` / ``V15Bom`` so they
// stay easy to spot in a diff. Mirrors the BUILD-7 drawing handler shape.
// ----------------------------------------------------------------------------

/** Allowed snap-point kinds (V1.5). Mirrors the sidecar's ``ALLOWED_SNAP_KINDS``. */
export const V15_SNAP_KINDS: readonly V15CadDrawingSnapKind[] = [
  'vertex',
  'endpoint',
  'midpoint',
  'center',
] as const

/** Allowed BOM column keys (V1.5). Mirrors the sidecar's ``BOM_TABLE_COLUMNS``. */
export const V15_BOM_COLUMNS = [
  'item',
  'partName',
  'quantity',
  'partNumber',
  'material',
  'vendor',
  'notes',
] as const
export type V15CadBomColumn = (typeof V15_BOM_COLUMNS)[number]

export type V15CadExtractDrawingGeometryPayload = V15CadExtractDrawingGeometryParams
export type V15CadDrawingBomTablePayload = V15CadDrawingBomTableParams

export type V15CadExtractDrawingGeometryResponse =
  | { ok: true; result: V15CadExtractDrawingGeometryResult }
  | { ok: false; error: string; hint?: string }

export type V15CadDrawingBomTableResponse =
  | { ok: true; result: V15CadDrawingBomTableResult }
  | { ok: false; error: string; hint?: string }

/**
 * Validate the ``cad:extractDrawingGeometry`` IPC payload. Pure -- no FS /
 * spawn / electron globals. Same envelope as the BUILD-7 drawing validators:
 * ``handle`` non-empty, ``view`` in the whitelist.
 */
export function v15ValidateExtractDrawingGeometryPayload(
  raw: unknown,
):
  | { ok: true; payload: V15CadExtractDrawingGeometryPayload }
  | V15CadExtractDrawingGeometryResponse {
  if (!raw || typeof raw !== 'object') {
    return {
      ok: false,
      error: 'invalid_payload',
      hint: 'cad:extractDrawingGeometry requires { handle, view }',
    }
  }
  const p = raw as { handle?: unknown; view?: unknown }
  if (typeof p.handle !== 'string' || p.handle.length === 0) {
    return { ok: false, error: 'missing_handle' }
  }
  if (typeof p.view !== 'string' || !(V15_DRAWING_VIEWS as readonly string[]).includes(p.view)) {
    return {
      ok: false,
      error: 'invalid_view',
      hint: `view must be one of: ${V15_DRAWING_VIEWS.join(', ')}`,
    }
  }
  return {
    ok: true,
    payload: {
      handle: p.handle,
      view: p.view as V15CadDrawingView,
    },
  }
}

/**
 * Validate a single BOM row. Returns the normalized row or an error envelope.
 * The handler does NOT recompute quantities -- it trusts the caller's values;
 * this validator only enforces the wire shape so a typo fails fast.
 */
export function v15ValidateBomRow(
  raw: unknown,
  index: number,
): { ok: true; value: V15CadDrawingBomRow } | { ok: false; error: string; hint: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      error: 'invalid_bom_row',
      hint: `rows[${index}] must be an object`,
    }
  }
  const r = raw as {
    item?: unknown
    partName?: unknown
    quantity?: unknown
    partNumber?: unknown
    material?: unknown
    vendor?: unknown
    notes?: unknown
  }
  // item -- accept string or number (the caller assigns the display index).
  let item = ''
  if (r.item !== undefined && r.item !== null) {
    if (typeof r.item === 'string') item = r.item
    else if (typeof r.item === 'number' && Number.isFinite(r.item)) item = String(r.item)
    else {
      return { ok: false, error: 'invalid_bom_row', hint: `rows[${index}].item must be a string or number` }
    }
  }
  let partName = ''
  if (r.partName !== undefined && r.partName !== null) {
    if (typeof r.partName !== 'string') {
      return { ok: false, error: 'invalid_bom_row', hint: `rows[${index}].partName must be a string` }
    }
    partName = r.partName
  }
  let quantity = 1
  if (r.quantity !== undefined && r.quantity !== null) {
    if (typeof r.quantity !== 'number' || !Number.isFinite(r.quantity)) {
      return { ok: false, error: 'invalid_bom_row', hint: `rows[${index}].quantity must be a finite number` }
    }
    quantity = r.quantity
  }
  const out: V15CadDrawingBomRow = { item, partName, quantity }
  for (const field of ['partNumber', 'material', 'vendor', 'notes'] as const) {
    const v = r[field]
    if (v === undefined || v === null) continue
    if (typeof v !== 'string') {
      return { ok: false, error: 'invalid_bom_row', hint: `rows[${index}].${field} must be a string when provided` }
    }
    out[field] = v
  }
  return { ok: true, value: out }
}

/**
 * Validate the ``cad:drawingBomTable`` IPC payload. Combines the SVG check
 * from ``v15ValidateAttachTitleBlockPayload`` with per-row validation. The
 * optional ``columns`` / ``title`` are checked but default in the sidecar.
 */
export function v15ValidateDrawingBomTablePayload(
  raw: unknown,
): { ok: true; payload: V15CadDrawingBomTablePayload } | V15CadDrawingBomTableResponse {
  if (!raw || typeof raw !== 'object') {
    return {
      ok: false,
      error: 'invalid_payload',
      hint: 'cad:drawingBomTable requires { svg, rows, columns?, title? }',
    }
  }
  const p = raw as { svg?: unknown; rows?: unknown; columns?: unknown; title?: unknown }
  if (typeof p.svg !== 'string' || p.svg.length === 0) {
    return { ok: false, error: 'missing_svg', hint: 'svg must be a non-empty SVG markup string' }
  }
  if (!Array.isArray(p.rows)) {
    return { ok: false, error: 'invalid_rows', hint: 'rows must be an array (use [] for an empty table)' }
  }
  const rows: V15CadDrawingBomRow[] = []
  for (let i = 0; i < p.rows.length; i++) {
    const v = v15ValidateBomRow(p.rows[i], i)
    if (!v.ok) return v
    rows.push(v.value)
  }
  let columns: V15CadBomColumn[] | undefined
  if (p.columns !== undefined) {
    if (!Array.isArray(p.columns)) {
      return { ok: false, error: 'invalid_columns', hint: 'columns must be an array of column keys' }
    }
    const out: V15CadBomColumn[] = []
    for (const c of p.columns) {
      if (typeof c !== 'string' || !(V15_BOM_COLUMNS as readonly string[]).includes(c)) {
        return { ok: false, error: 'invalid_columns', hint: `columns entries must be one of: ${V15_BOM_COLUMNS.join(', ')}` }
      }
      if (!out.includes(c as V15CadBomColumn)) out.push(c as V15CadBomColumn)
    }
    columns = out
  }
  let title: string | undefined
  if (p.title !== undefined) {
    if (typeof p.title !== 'string') {
      return { ok: false, error: 'invalid_title', hint: 'title must be a string when provided' }
    }
    title = p.title
  }
  return {
    ok: true,
    payload: {
      svg: p.svg,
      rows,
      ...(columns !== undefined ? { columns } : {}),
      ...(title !== undefined ? { title } : {}),
    },
  }
}

/** Shape guard for one projected ``[x, y]`` point. */
function looks2dPoint(value: unknown): value is [number, number] {
  if (!Array.isArray(value) || value.length !== 2) return false
  return (
    typeof value[0] === 'number' &&
    Number.isFinite(value[0]) &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[1])
  )
}

/** Coerce one projected vertex; returns ``null`` on a malformed entry. */
function coerceDrawingVertex(value: unknown): V15CadDrawingVertex | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (typeof v.id !== 'string' || v.id.length === 0) return null
  if (typeof v.x !== 'number' || !Number.isFinite(v.x)) return null
  if (typeof v.y !== 'number' || !Number.isFinite(v.y)) return null
  return { id: v.id, x: v.x, y: v.y }
}

/** Coerce one projected edge; returns ``null`` on a malformed entry. */
function coerceDrawingEdge(value: unknown): V15CadDrawingProjectedEdge | null {
  if (!value || typeof value !== 'object') return null
  const e = value as Record<string, unknown>
  if (typeof e.id !== 'string' || e.id.length === 0) return null
  const kindRaw = e.kind
  const kind: V15CadDrawingEdgeKind =
    kindRaw === 'line' || kindRaw === 'arc' || kindRaw === 'circle' || kindRaw === 'curve'
      ? kindRaw
      : 'curve'
  if (!Array.isArray(e.points)) return null
  const points = e.points.filter(looks2dPoint)
  if (points.length < 2) return null
  return { id: e.id, kind, points }
}

/** Coerce one snap point; returns ``null`` on a malformed entry. */
function coerceDrawingSnapPoint(value: unknown): V15CadDrawingSnapPoint | null {
  if (!value || typeof value !== 'object') return null
  const s = value as Record<string, unknown>
  if (typeof s.id !== 'string' || s.id.length === 0) return null
  if (typeof s.x !== 'number' || !Number.isFinite(s.x)) return null
  if (typeof s.y !== 'number' || !Number.isFinite(s.y)) return null
  if (typeof s.kind !== 'string' || !(V15_SNAP_KINDS as readonly string[]).includes(s.kind)) return null
  if (typeof s.sourceId !== 'string' || s.sourceId.length === 0) return null
  return {
    id: s.id,
    x: s.x,
    y: s.y,
    kind: s.kind as V15CadDrawingSnapKind,
    sourceId: s.sourceId,
  }
}

/**
 * Coerce the raw ``cad.extract_drawing_geometry`` payload into the typed
 * result. Returns ``null`` when the response is structurally unusable
 * (missing arrays / view) so the handler folds to ``sidecar_protocol_error``.
 * Malformed individual vertices / edges / snap points drop silently
 * (defense-in-depth) so one bad entry never poisons the whole projection.
 */
export function v15CoerceExtractDrawingGeometryResult(
  raw: Record<string, unknown>,
): V15CadExtractDrawingGeometryResult | null {
  if (typeof raw.view !== 'string' || !(V15_DRAWING_VIEWS as readonly string[]).includes(raw.view)) {
    return null
  }
  if (!Array.isArray(raw.vertices)) return null
  if (!Array.isArray(raw.edges)) return null
  if (!Array.isArray(raw.snapPoints)) return null
  const vertices: V15CadDrawingVertex[] = []
  for (const v of raw.vertices) {
    const c = coerceDrawingVertex(v)
    if (c) vertices.push(c)
  }
  const edges: V15CadDrawingProjectedEdge[] = []
  for (const e of raw.edges) {
    const c = coerceDrawingEdge(e)
    if (c) edges.push(c)
  }
  const snapPoints: V15CadDrawingSnapPoint[] = []
  for (const s of raw.snapPoints) {
    const c = coerceDrawingSnapPoint(s)
    if (c) snapPoints.push(c)
  }
  return {
    view: raw.view as V15CadDrawingView,
    vertices,
    edges,
    snapPoints,
  }
}

/**
 * Coerce the raw ``cad.drawing_bom_table`` payload into the typed result.
 * Returns ``null`` when the response is structurally unusable (missing svg)
 * so the handler folds to ``sidecar_protocol_error``.
 */
export function v15CoerceDrawingBomTableResult(
  raw: Record<string, unknown>,
): V15CadDrawingBomTableResult | null {
  if (typeof raw.svg !== 'string') return null
  const bytes =
    typeof raw.bytes === 'number' && Number.isFinite(raw.bytes)
      ? raw.bytes
      : Buffer.byteLength(raw.svg, 'utf8')
  const rowCount =
    typeof raw.rowCount === 'number' &&
    Number.isFinite(raw.rowCount) &&
    Number.isInteger(raw.rowCount) &&
    raw.rowCount >= 0
      ? raw.rowCount
      : 0
  return {
    svg: raw.svg,
    bytes,
    rowCount,
  }
}

// ── CAD V1.5 (GD&T feature control frames) types + validators + coercer ──────
//
// One additive IPC channel exposing the BUILD-10 sidecar surface:
//   * cad:annotateGdt -- stamp GD&T feature-control-frame(s) into an SVG. Pure
//     SVG composition; the sidecar does NOT recompute geometry. Like
//     cad:drawingBomTable / cad:attachTitleBlock it operates on an SVG string.
// Types / validators / coercers prefixed ``V15Gdt`` so they stay easy to spot
// in a diff. Mirrors the BUILD-9 BOM-table handler shape.
//
// Safety Rule 4: datums + label are operator free-text. The sidecar entity-
// escapes them; this boundary only validates the wire shape (re-serializing
// through the typed surface so a smuggled extra field never reaches the wire).

/** Allowed GD&T characteristics (V1.5). Mirrors the sidecar's vocabulary and
 * ``gdtCharacteristicSchema`` in ``src/shared/drawing-annotation-schema.ts``. */
export const V15_GDT_CHARACTERISTICS: readonly V15CadGdtCharacteristic[] = [
  'straightness',
  'flatness',
  'circularity',
  'cylindricity',
  'profile_of_a_line',
  'profile_of_a_surface',
  'perpendicularity',
  'angularity',
  'parallelism',
  'position',
  'concentricity',
  'symmetry',
  'circular_runout',
  'total_runout',
] as const

export type V15CadAnnotateGdtPayload = V15CadAnnotateGdtParams

export type V15CadAnnotateGdtResponse =
  | { ok: true; result: V15CadAnnotateGdtResult }
  | { ok: false; error: string; hint?: string }

/**
 * Validate a single GD&T feature-control-frame spec. Returns the normalized
 * frame or an error envelope. The sidecar re-validates + escapes; this only
 * enforces the wire shape so a renderer typo fails fast at the boundary.
 */
export function v15ValidateGdtFrame(
  raw: unknown,
  index: number,
): { ok: true; value: V15CadGdtFrameSpec } | { ok: false; error: string; hint: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'invalid_gdt_frame', hint: `frames[${index}] must be an object` }
  }
  const f = raw as {
    characteristic?: unknown
    toleranceMm?: unknown
    datums?: unknown
    placement?: unknown
    label?: unknown
  }
  if (
    typeof f.characteristic !== 'string' ||
    !(V15_GDT_CHARACTERISTICS as readonly string[]).includes(f.characteristic)
  ) {
    return {
      ok: false,
      error: 'invalid_gdt_frame',
      hint: `frames[${index}].characteristic must be one of: ${V15_GDT_CHARACTERISTICS.join(', ')}`,
    }
  }
  if (typeof f.toleranceMm !== 'number' || !Number.isFinite(f.toleranceMm) || f.toleranceMm < 0) {
    return {
      ok: false,
      error: 'invalid_gdt_frame',
      hint: `frames[${index}].toleranceMm must be a non-negative finite number`,
    }
  }
  const datums: string[] = []
  if (f.datums !== undefined && f.datums !== null) {
    if (!Array.isArray(f.datums)) {
      return { ok: false, error: 'invalid_gdt_frame', hint: `frames[${index}].datums must be an array of strings` }
    }
    if (f.datums.length > 3) {
      return { ok: false, error: 'invalid_gdt_frame', hint: `frames[${index}].datums references at most 3 datums` }
    }
    for (let i = 0; i < f.datums.length; i++) {
      const d = f.datums[i]
      if (typeof d !== 'string' || d.length === 0) {
        return { ok: false, error: 'invalid_gdt_frame', hint: `frames[${index}].datums[${i}] must be a non-empty string` }
      }
      datums.push(d)
    }
  }
  const pt = f.placement as { x?: unknown; y?: unknown } | undefined
  if (
    !pt ||
    typeof pt.x !== 'number' ||
    !Number.isFinite(pt.x) ||
    typeof pt.y !== 'number' ||
    !Number.isFinite(pt.y)
  ) {
    return { ok: false, error: 'invalid_gdt_frame', hint: `frames[${index}].placement must be { x, y } finite numbers` }
  }
  let label: string | undefined
  if (f.label !== undefined && f.label !== null) {
    if (typeof f.label !== 'string') {
      return { ok: false, error: 'invalid_gdt_frame', hint: `frames[${index}].label must be a string when provided` }
    }
    label = f.label
  }
  const value: V15CadGdtFrameSpec = {
    characteristic: f.characteristic as V15CadGdtCharacteristic,
    toleranceMm: f.toleranceMm,
    placement: { x: pt.x, y: pt.y },
    ...(datums.length > 0 ? { datums } : {}),
    ...(label !== undefined ? { label } : {}),
  }
  return { ok: true, value }
}

/**
 * Validate the ``cad:annotateGdt`` IPC payload. Combines the SVG check from
 * ``v15ValidateDrawingBomTablePayload`` with per-frame validation.
 */
export function v15ValidateAnnotateGdtPayload(
  raw: unknown,
): { ok: true; payload: V15CadAnnotateGdtPayload } | V15CadAnnotateGdtResponse {
  if (!raw || typeof raw !== 'object') {
    return {
      ok: false,
      error: 'invalid_payload',
      hint: 'cad:annotateGdt requires { svg, frames }',
    }
  }
  const p = raw as { svg?: unknown; frames?: unknown }
  if (typeof p.svg !== 'string' || p.svg.length === 0) {
    return { ok: false, error: 'missing_svg', hint: 'svg must be a non-empty SVG markup string' }
  }
  if (!Array.isArray(p.frames)) {
    return { ok: false, error: 'invalid_frames', hint: 'frames must be an array (use [] for no frames)' }
  }
  const frames: V15CadGdtFrameSpec[] = []
  for (let i = 0; i < p.frames.length; i++) {
    const v = v15ValidateGdtFrame(p.frames[i], i)
    if (!v.ok) return v
    frames.push(v.value)
  }
  return { ok: true, payload: { svg: p.svg, frames } }
}

/**
 * Coerce the raw ``cad.annotate_gdt`` payload into the typed result. Returns
 * ``null`` when the response is structurally unusable (missing svg) so the
 * handler folds to ``sidecar_protocol_error``.
 */
export function v15CoerceAnnotateGdtResult(
  raw: Record<string, unknown>,
): V15CadAnnotateGdtResult | null {
  if (typeof raw.svg !== 'string') return null
  const bytes =
    typeof raw.bytes === 'number' && Number.isFinite(raw.bytes)
      ? raw.bytes
      : Buffer.byteLength(raw.svg, 'utf8')
  const frameCount =
    typeof raw.frameCount === 'number' &&
    Number.isFinite(raw.frameCount) &&
    Number.isInteger(raw.frameCount) &&
    raw.frameCount >= 0
      ? raw.frameCount
      : 0
  return {
    svg: raw.svg,
    bytes,
    frameCount,
  }
}

// ── cad:detailDrawing (CAD V1.5 -- detail / crop view) ───────────────────────
//
// Crop a circular region of a parent projection and magnify it (e.g. 2:1). The
// sidecar projects ONCE then re-frames the crop into a fresh <svg> whose
// viewBox is the crop window and whose pixel size is scale x that window. The
// validator gates the wire shape; the sidecar owns the projection + escaping
// (Safety Rule 4: `label` is entity-escaped before any <text>).

export type V15CadDetailDrawingPayload = V15CadDetailDrawingParams

export type V15CadDetailDrawingResponse =
  | { ok: true; result: V15CadDetailDrawingResult }
  | { ok: false; error: string; hint?: string }

/**
 * Validate the ``cad:detailDrawing`` IPC payload. Pure -- no FS / spawn /
 * electron globals. Mirrors the dimension/section validator posture: gate the
 * envelope here, let the sidecar own the deep geometry + escaping.
 */
export function v15ValidateDetailDrawingPayload(
  raw: unknown,
): { ok: true; payload: V15CadDetailDrawingPayload } | V15CadDetailDrawingResponse {
  if (!raw || typeof raw !== 'object') {
    return {
      ok: false,
      error: 'invalid_payload',
      hint: 'cad:detailDrawing requires { handle, view, center, radiusMm, scale?, label? }',
    }
  }
  const p = raw as {
    handle?: unknown
    view?: unknown
    center?: unknown
    radiusMm?: unknown
    scale?: unknown
    label?: unknown
  }
  if (typeof p.handle !== 'string' || p.handle.length === 0) {
    return { ok: false, error: 'missing_handle' }
  }
  if (typeof p.view !== 'string' || !(V15_DRAWING_VIEWS as readonly string[]).includes(p.view)) {
    return {
      ok: false,
      error: 'invalid_view',
      hint: `view must be one of: ${V15_DRAWING_VIEWS.join(', ')}`,
    }
  }
  const center = v15ValidatePoint2D(p.center, 'center')
  if (!center.ok) {
    return { ok: false, error: center.error, hint: center.hint }
  }
  if (typeof p.radiusMm !== 'number' || !Number.isFinite(p.radiusMm) || p.radiusMm <= 0) {
    return { ok: false, error: 'invalid_radius', hint: 'radiusMm must be a finite number greater than zero' }
  }
  let scale: number | undefined
  if (p.scale !== undefined && p.scale !== null) {
    if (typeof p.scale !== 'number' || !Number.isFinite(p.scale) || p.scale <= 0) {
      return { ok: false, error: 'invalid_scale', hint: 'scale must be a finite number greater than zero when provided' }
    }
    scale = p.scale
  }
  let label: string | undefined
  if (p.label !== undefined && p.label !== null) {
    if (typeof p.label !== 'string') {
      return { ok: false, error: 'invalid_label', hint: 'label must be a string when provided' }
    }
    label = p.label
  }
  return {
    ok: true,
    payload: {
      handle: p.handle,
      view: p.view as V15CadDrawingView,
      center: center.value,
      radiusMm: p.radiusMm,
      ...(scale !== undefined ? { scale } : {}),
      ...(label !== undefined ? { label } : {}),
    },
  }
}

/**
 * Coerce the raw ``cad.detail_drawing`` payload into the typed result. Returns
 * ``null`` when the response is structurally unusable (missing svg/view) so the
 * handler folds to ``sidecar_protocol_error``. The ``label`` echoed back is the
 * sidecar's already-escaped string.
 */
export function v15CoerceDetailDrawingResult(
  raw: Record<string, unknown>,
): V15CadDetailDrawingResult | null {
  if (typeof raw.svg !== 'string') return null
  if (typeof raw.view !== 'string' || !(V15_DRAWING_VIEWS as readonly string[]).includes(raw.view)) {
    return null
  }
  if (!raw.center || typeof raw.center !== 'object' || Array.isArray(raw.center)) return null
  const c = raw.center as { x?: unknown; y?: unknown }
  if (typeof c.x !== 'number' || !Number.isFinite(c.x) || typeof c.y !== 'number' || !Number.isFinite(c.y)) {
    return null
  }
  if (typeof raw.radiusMm !== 'number' || !Number.isFinite(raw.radiusMm)) return null
  const scale =
    typeof raw.scale === 'number' && Number.isFinite(raw.scale) ? raw.scale : 2
  const bytes =
    typeof raw.bytes === 'number' && Number.isFinite(raw.bytes)
      ? raw.bytes
      : Buffer.byteLength(raw.svg, 'utf8')
  const label = typeof raw.label === 'string' ? raw.label : ''
  return {
    svg: raw.svg,
    view: raw.view as V15CadDrawingView,
    bytes,
    center: { x: c.x, y: c.y },
    radiusMm: raw.radiusMm,
    scale,
    label,
  }
}

// ── Registration ────────────────────────────────────────────────────────────

export function registerCadIpc(_ctx: MainIpcWindowContext): void {
  // The `ctx` is accepted for parity with the other `register*Ipc` functions
  // -- none of the handlers need a BrowserWindow today, but future
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

  // cad:solveSketch -- CAD V1 sketcher: run the 2D constraint solver
  // against a sketch state + constraint list. Delegates to Agent S1's
  // sidecar handler ``cad.solve_sketch``. The renderer's Sketch2DCanvas
  // dispatches this on every constraint change (debounced) so the solver
  // budget stays in the single-digit-millisecond range -- a 30 s ceiling
  // is overkill but matches the conservative budget for the other
  // CadQuery handlers.
  ipcMain.handle(
    'cad:solveSketch',
    async (_e, raw: unknown): Promise<CadSolveSketchResponse> => {
      const v = validateSolveSketchPayload(raw)
      if (!('payload' in v)) return v
      const pyCtx = await resolvePythonContext()
      if (!pyCtx.ok) return { ok: false, error: pyCtx.error, hint: pyCtx.hint }
      const r = await callSidecar<Record<string, unknown>>(
        'cad.solve_sketch',
        {
          sketch: v.payload.sketch,
          constraints: v.payload.constraints,
        },
        pyCtx,
        30_000,
      )
      if (!r.ok) return { ok: false, error: r.error, hint: r.hint }
      const coerced = coerceSolveSketchResult(r.result)
      if (!coerced) {
        return {
          ok: false,
          error: 'sidecar_protocol_error',
          hint: 'cad.solve_sketch returned a malformed points envelope',
        }
      }
      return { ok: true, result: coerced }
    },
  )

  // cad:createAssembly -- resolve an assembly tree into the sidecar handle
  // table. Returns the parent handle + a union bbox so the renderer can
  // frame the assembly before the (separate) tessellate call. Delegates to
  // Agent A1's ``cad.create_assembly``.
  ipcMain.handle(
    'cad:createAssembly',
    async (_e, raw: unknown): Promise<CadCreateAssemblyResponse> => {
      const v = validateCreateAssemblyPayload(raw)
      if (!('payload' in v)) return v
      const pyCtx = await resolvePythonContext()
      if (!pyCtx.ok) return { ok: false, error: pyCtx.error, hint: pyCtx.hint }
      // 2 min ceiling -- the slow path is resolving every sub-part STEP /
      // CadQuery handle, which scales with the deepest assembly the user
      // can stomach in the BUILD 2 UI.
      const r = await callSidecar<Record<string, unknown>>(
        'cad.create_assembly',
        { parts: v.payload.parts },
        pyCtx,
        120_000,
      )
      if (!r.ok) return { ok: false, error: r.error, hint: r.hint }
      const coerced = coerceCreateAssemblyResult(r.result)
      if (!coerced) {
        return {
          ok: false,
          error: 'sidecar_protocol_error',
          hint: 'cad.create_assembly returned a malformed handle/bbox envelope',
        }
      }
      return { ok: true, result: coerced }
    },
  )

  // cad:tessellateAssembly -- per-instance binary STL emission for the
  // renderer's Assembly view. Mirrors ``cad:tessellateWithIds`` budget-wise
  // (60 s ceiling) since per-instance tessellation is O(instances) but each
  // pass is still a single CadQuery call.
  ipcMain.handle(
    'cad:tessellateAssembly',
    async (_e, raw: unknown): Promise<CadTessellateAssemblyResponse> => {
      const v = validateTessellateAssemblyPayload(raw)
      if (!('payload' in v)) return v
      const pyCtx = await resolvePythonContext()
      if (!pyCtx.ok) return { ok: false, error: pyCtx.error, hint: pyCtx.hint }
      const r = await callSidecar<Record<string, unknown>>(
        'cad.tessellate_assembly',
        {
          handle: v.payload.handle,
          ...(v.payload.toleranceMm !== undefined ? { toleranceMm: v.payload.toleranceMm } : {}),
        },
        pyCtx,
        60_000,
      )
      if (!r.ok) return { ok: false, error: r.error, hint: r.hint }
      const coerced = coerceTessellateAssemblyResult(r.result)
      if (!coerced) {
        return {
          ok: false,
          error: 'sidecar_protocol_error',
          hint: 'cad.tessellate_assembly returned a malformed meshes/bbox envelope',
        }
      }
      return { ok: true, result: coerced }
    },
  )

  // cad:exportAssembly -- write the assembled body referenced by `handle`
  // to STEP / STL. DXF is rejected at the validator -- it makes no sense
  // for a multi-part assembled body. Path-safety mirrors `cad:export`:
  // null-byte filter at the boundary, sidecar enforces project-root prefix.
  ipcMain.handle(
    'cad:exportAssembly',
    async (_e, raw: unknown): Promise<CadExportAssemblyResponse> => {
      const v = validateExportAssemblyPayload(raw)
      if (!('payload' in v)) return v
      const pyCtx = await resolvePythonContext()
      if (!pyCtx.ok) return { ok: false, error: pyCtx.error, hint: pyCtx.hint }
      const r = await callSidecar<Record<string, unknown>>(
        'cad.export_assembly',
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
    },
  )

  // cad:projectDrawing -- run the documentation projection pipeline (Agent
  // A2's ``cad.project_drawing``). The sidecar walks the sheet's
  // ``viewPlaceholders`` and projects each entry per its ``viewFrom`` /
  // ``projectionDirection``. Renderer's DrawingView feeds this into a 2D
  // canvas; no G-code involved.
  ipcMain.handle(
    'cad:projectDrawing',
    async (_e, raw: unknown): Promise<CadProjectDrawingResponse> => {
      const v = validateProjectDrawingPayload(raw)
      if (!('payload' in v)) return v
      const pyCtx = await resolvePythonContext()
      if (!pyCtx.ok) return { ok: false, error: pyCtx.error, hint: pyCtx.hint }
      // 90 s -- projection (especially BRep HLR tier C) can scale with
      // edge count; conservative ceiling so the renderer can surface a
      // hang to the operator rather than waiting forever.
      const r = await callSidecar<Record<string, unknown>>(
        'cad.project_drawing',
        'view' in v.payload
          ? {
              handle: v.payload.handle,
              view: v.payload.view,
              ...(v.payload.includeHlr !== undefined
                ? { includeHlr: v.payload.includeHlr }
                : {}),
            }
          : {
              handle: v.payload.handle,
              sheet: v.payload.sheet,
            },
        pyCtx,
        90_000,
      )
      if (!r.ok) return { ok: false, error: r.error, hint: r.hint }
      if ('view' in v.payload) {
        // Single-view contract: the sidecar returns { svg } inline.
        if (typeof r.result.svg !== 'string' || r.result.svg.length === 0) {
          return {
            ok: false,
            error: 'sidecar_protocol_error',
            hint: 'cad.project_drawing returned no svg for the single-view payload',
          }
        }
        return { ok: true, result: { svg: r.result.svg } }
      }
      const coerced = coerceProjectDrawingResult(r.result)
      if (!coerced) {
        return {
          ok: false,
          error: 'sidecar_protocol_error',
          hint: 'cad.project_drawing returned a malformed views envelope',
        }
      }
      return { ok: true, result: coerced }
    },
  )

  // cad:exportDrawing -- render the projected linework into PDF/DXF on
  // disk. Validator enforces the ``CAD_DRAWING_EXPORT_FORMATS`` whitelist
  // and rejects null-byte paths. The sidecar stamps title-block metadata
  // from the ``sheet`` blob before writing.
  ipcMain.handle(
    'cad:exportDrawing',
    async (_e, raw: unknown): Promise<CadExportDrawingResponse> => {
      const v = validateExportDrawingPayload(raw)
      if (!('payload' in v)) return v
      const pyCtx = await resolvePythonContext()
      if (!pyCtx.ok) return { ok: false, error: pyCtx.error, hint: pyCtx.hint }
      const r = await callSidecar<Record<string, unknown>>(
        'cad.export_drawing',
        {
          handle: v.payload.handle,
          outPath: v.payload.outPath,
          format: v.payload.format,
          sheet: v.payload.sheet,
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
    },
  )

  // cad:addAssemblyMate -- CAD V1.5: attach a single mate (point / axis /
  // plane) to an existing assembly handle. Delegates to the sidecar's
  // ``cad.add_assembly_mate`` (Build 6). The validator gates structural
  // drift at the boundary so a runaway renderer cannot funnel garbage at
  // the JSON-RPC pipe -- bad mate kinds, missing feature payloads, etc.
  // surface as deterministic ``{ ok: false, error, hint }`` envelopes
  // before we burn the cost of a Python spawn.
  //
  // 60 s ceiling: a single ``cq.Assembly.constrain()`` + ``.solve()`` pass
  // is microseconds for a handful of children; the budget mirrors
  // ``cad:tessellateWithIds`` so even a pathologically over-constrained
  // assembly surfaces a hang to the operator instead of waiting forever.
  ipcMain.handle(
    'cad:addAssemblyMate',
    async (_e, raw: unknown): Promise<CadAddAssemblyMateResponse> => {
      const v = validateAddAssemblyMatePayload(raw)
      if (!('payload' in v)) return v
      const pyCtx = await resolvePythonContext()
      if (!pyCtx.ok) return { ok: false, error: pyCtx.error, hint: pyCtx.hint }
      const r = await callSidecar<Record<string, unknown>>(
        'cad.add_assembly_mate',
        {
          handle: v.payload.handle,
          // Cast back to a JSON-serializable shape -- the wire only sees
          // JSON.stringify-able objects, which the typed mate is.
          mate: v.payload.mate as unknown as Record<string, unknown>,
        },
        pyCtx,
        60_000,
      )
      if (!r.ok) return { ok: false, error: r.error, hint: r.hint }
      const coerced = coerceAddAssemblyMateResult(r.result)
      if (!coerced) {
        return {
          ok: false,
          error: 'sidecar_protocol_error',
          hint: 'cad.add_assembly_mate returned a malformed handle/bbox envelope',
        }
      }
      return { ok: true, result: coerced }
    },
  )

  // ── CAD V1.5 (Drawing dimensions / sections / title block) handlers ──────
  //
  // Three additive IPC channels exposing the BUILD-7 sidecar surface. All
  // three follow the same pattern as the BUILD-3 drawing handlers above —
  // permissive envelope validation at the boundary, the sidecar owns the
  // deep validation (dimension specs / section plane geometry / metadata
  // shape). Budgets:
  //   * dimensionDrawing — 60 s (re-projects the body, then composes SVG).
  //   * sectionDrawing   — 90 s (extra cut operation can scale with body
  //                              complexity; matches the BUILD-3 projection
  //                              ceiling).
  //   * attachTitleBlock — 15 s (pure SVG string manipulation; no CadQuery
  //                              call required).

  ipcMain.handle(
    'cad:dimensionDrawing',
    async (_e, raw: unknown): Promise<V15CadDimensionDrawingResponse> => {
      const v = v15ValidateDimensionDrawingPayload(raw)
      if (!('payload' in v)) return v
      const pyCtx = await resolvePythonContext()
      if (!pyCtx.ok) return { ok: false, error: pyCtx.error, hint: pyCtx.hint }
      const r = await callSidecar<Record<string, unknown>>(
        'cad.dimension_drawing',
        {
          handle: v.payload.handle,
          view: v.payload.view,
          // Re-serialize through the typed surface so an upstream renderer
          // that smuggled extras doesn't leak them through the wire.
          dimensions: v.payload.dimensions as unknown as Record<string, unknown>[],
        },
        pyCtx,
        60_000,
      )
      if (!r.ok) return { ok: false, error: r.error, hint: r.hint }
      const coerced = v15CoerceDimensionDrawingResult(r.result)
      if (!coerced) {
        return {
          ok: false,
          error: 'sidecar_protocol_error',
          hint: 'cad.dimension_drawing returned a malformed svg/view envelope',
        }
      }
      return { ok: true, result: coerced }
    },
  )

  ipcMain.handle(
    'cad:sectionDrawing',
    async (_e, raw: unknown): Promise<V15CadSectionDrawingResponse> => {
      const v = v15ValidateSectionDrawingPayload(raw)
      if (!('payload' in v)) return v
      const pyCtx = await resolvePythonContext()
      if (!pyCtx.ok) return { ok: false, error: pyCtx.error, hint: pyCtx.hint }
      const r = await callSidecar<Record<string, unknown>>(
        'cad.section_drawing',
        {
          handle: v.payload.handle,
          view: v.payload.view,
          plane: v.payload.plane as unknown as Record<string, unknown>,
          ...(v.payload.label !== undefined ? { label: v.payload.label } : {}),
        },
        pyCtx,
        90_000,
      )
      if (!r.ok) return { ok: false, error: r.error, hint: r.hint }
      const coerced = v15CoerceSectionDrawingResult(r.result)
      if (!coerced) {
        return {
          ok: false,
          error: 'sidecar_protocol_error',
          hint: 'cad.section_drawing returned a malformed svg/plane envelope',
        }
      }
      return { ok: true, result: coerced }
    },
  )

  // cad:hlrSection -- CAD V1.5: compute the 3D viewport's true-HLR section
  // overlay (visible/hidden edges + cap face) for a body handle. Delegates to
  // the sidecar's ``cad.hlr_section`` (BUILD 8). 90 s ceiling mirrors the
  // section-drawing budget -- HLR is O(edges * faces) and can scale with body
  // complexity, so the renderer can surface a hang to the operator rather than
  // waiting forever. The validator gates structural drift before the spawn.
  ipcMain.handle(
    'cad:hlrSection',
    async (_e, raw: unknown): Promise<V15HlrSectionResponse> => {
      const v = v15ValidateHlrSectionPayload(raw)
      if (!('payload' in v)) return v
      const pyCtx = await resolvePythonContext()
      if (!pyCtx.ok) return { ok: false, error: pyCtx.error, hint: pyCtx.hint }
      const r = await callSidecar<Record<string, unknown>>(
        'cad.hlr_section',
        {
          handle: v.payload.handle,
          planeNormal: v.payload.planeNormal,
          planeOffset: v.payload.planeOffset,
          viewDir: v.payload.viewDir,
          ...(v.payload.toleranceMm !== undefined ? { toleranceMm: v.payload.toleranceMm } : {}),
        },
        pyCtx,
        90_000,
      )
      if (!r.ok) return { ok: false, error: r.error, hint: r.hint }
      const coerced = v15CoerceHlrSectionResult(r.result)
      if (!coerced) {
        return {
          ok: false,
          error: 'sidecar_protocol_error',
          hint: 'cad.hlr_section returned a malformed edges/bbox envelope',
        }
      }
      return { ok: true, result: coerced }
    },
  )

  ipcMain.handle(
    'cad:attachTitleBlock',
    async (_e, raw: unknown): Promise<V15CadAttachTitleBlockResponse> => {
      const v = v15ValidateAttachTitleBlockPayload(raw)
      if (!('payload' in v)) return v
      const pyCtx = await resolvePythonContext()
      if (!pyCtx.ok) return { ok: false, error: pyCtx.error, hint: pyCtx.hint }
      const r = await callSidecar<Record<string, unknown>>(
        'cad.attach_title_block',
        {
          svg: v.payload.svg,
          metadata: v.payload.metadata as unknown as Record<string, unknown>,
        },
        pyCtx,
        15_000,
      )
      if (!r.ok) return { ok: false, error: r.error, hint: r.hint }
      const coerced = v15CoerceAttachTitleBlockResult(r.result)
      if (!coerced) {
        return {
          ok: false,
          error: 'sidecar_protocol_error',
          hint: 'cad.attach_title_block returned a malformed svg/metadata envelope',
        }
      }
      return { ok: true, result: coerced }
    },
  )

  // ── CAD V1.5 (Associative-dimension geometry + BOM-table) handlers ───────
  //
  // Two additive IPC channels exposing the BUILD-9 sidecar surface. Same
  // pattern as the BUILD-7 drawing handlers — envelope validation at the
  // boundary, the sidecar owns the deep geometry / row formatting. Budgets:
  //   * extractDrawingGeometry — 60 s (re-projects the body, then walks the
  //                              topology; matches the dimension-drawing
  //                              ceiling since both re-project).
  //   * drawingBomTable        — 15 s (pure SVG string manipulation; no
  //                              CadQuery call required, like attachTitleBlock).

  // cad:extractDrawingGeometry -- projected 2D geometry with stable ids so the
  // renderer's DrawingView can resolve snap points and place associative
  // dimensions. Renderer-only; no G-code involved.
  ipcMain.handle(
    'cad:extractDrawingGeometry',
    async (_e, raw: unknown): Promise<V15CadExtractDrawingGeometryResponse> => {
      const v = v15ValidateExtractDrawingGeometryPayload(raw)
      if (!('payload' in v)) return v
      const pyCtx = await resolvePythonContext()
      if (!pyCtx.ok) return { ok: false, error: pyCtx.error, hint: pyCtx.hint }
      const r = await callSidecar<Record<string, unknown>>(
        'cad.extract_drawing_geometry',
        {
          handle: v.payload.handle,
          view: v.payload.view,
        },
        pyCtx,
        60_000,
      )
      if (!r.ok) return { ok: false, error: r.error, hint: r.hint }
      const coerced = v15CoerceExtractDrawingGeometryResult(r.result)
      if (!coerced) {
        return {
          ok: false,
          error: 'sidecar_protocol_error',
          hint: 'cad.extract_drawing_geometry returned a malformed vertices/edges/snapPoints envelope',
        }
      }
      return { ok: true, result: coerced }
    },
  )

  // cad:drawingBomTable -- stamp a BOM-table <g> into an SVG from the rows the
  // assembly already provides. Pure SVG composition; the sidecar does NOT
  // recompute the BOM. Renderer-only; no G-code involved.
  ipcMain.handle(
    'cad:drawingBomTable',
    async (_e, raw: unknown): Promise<V15CadDrawingBomTableResponse> => {
      const v = v15ValidateDrawingBomTablePayload(raw)
      if (!('payload' in v)) return v
      const pyCtx = await resolvePythonContext()
      if (!pyCtx.ok) return { ok: false, error: pyCtx.error, hint: pyCtx.hint }
      const r = await callSidecar<Record<string, unknown>>(
        'cad.drawing_bom_table',
        {
          svg: v.payload.svg,
          // Re-serialize through the typed surface so an upstream renderer
          // that smuggled extras doesn't leak them through the wire.
          rows: v.payload.rows as unknown as Record<string, unknown>[],
          ...(v.payload.columns !== undefined ? { columns: v.payload.columns } : {}),
          ...(v.payload.title !== undefined ? { title: v.payload.title } : {}),
        },
        pyCtx,
        15_000,
      )
      if (!r.ok) return { ok: false, error: r.error, hint: r.hint }
      const coerced = v15CoerceDrawingBomTableResult(r.result)
      if (!coerced) {
        return {
          ok: false,
          error: 'sidecar_protocol_error',
          hint: 'cad.drawing_bom_table returned a malformed svg/rowCount envelope',
        }
      }
      return { ok: true, result: coerced }
    },
  )

  // cad:annotateGdt -- stamp GD&T feature-control-frame(s) into an SVG from the
  // caller-supplied frames. Pure SVG composition; the sidecar does NOT
  // recompute geometry. Renderer-only; no G-code involved. Budget 15 s (string
  // manipulation only, like drawingBomTable / attachTitleBlock). Safety Rule 4:
  // datums + label are entity-escaped in the sidecar before injection.
  ipcMain.handle(
    'cad:annotateGdt',
    async (_e, raw: unknown): Promise<V15CadAnnotateGdtResponse> => {
      const v = v15ValidateAnnotateGdtPayload(raw)
      if (!('payload' in v)) return v
      const pyCtx = await resolvePythonContext()
      if (!pyCtx.ok) return { ok: false, error: pyCtx.error, hint: pyCtx.hint }
      const r = await callSidecar<Record<string, unknown>>(
        'cad.annotate_gdt',
        {
          svg: v.payload.svg,
          // Re-serialize through the typed surface so an upstream renderer that
          // smuggled extras doesn't leak them through the wire.
          frames: v.payload.frames as unknown as Record<string, unknown>[],
        },
        pyCtx,
        15_000,
      )
      if (!r.ok) return { ok: false, error: r.error, hint: r.hint }
      const coerced = v15CoerceAnnotateGdtResult(r.result)
      if (!coerced) {
        return {
          ok: false,
          error: 'sidecar_protocol_error',
          hint: 'cad.annotate_gdt returned a malformed svg/frameCount envelope',
        }
      }
      return { ok: true, result: coerced }
    },
  )

  // cad:detailDrawing -- crop a circular region of a parent projection and
  // magnify it (e.g. 2:1). The sidecar projects the parent view ONCE then
  // re-frames the crop. Budget 60 s -- matches dimensionDrawing (re-projects
  // the body, then composes SVG). Safety Rule 4: `label` is entity-escaped in
  // the sidecar before injection into the <text> node. Renderer-only; no
  // G-code involved.
  ipcMain.handle(
    'cad:detailDrawing',
    async (_e, raw: unknown): Promise<V15CadDetailDrawingResponse> => {
      const v = v15ValidateDetailDrawingPayload(raw)
      if (!('payload' in v)) return v
      const pyCtx = await resolvePythonContext()
      if (!pyCtx.ok) return { ok: false, error: pyCtx.error, hint: pyCtx.hint }
      const r = await callSidecar<Record<string, unknown>>(
        'cad.detail_drawing',
        {
          handle: v.payload.handle,
          view: v.payload.view,
          center: v.payload.center as unknown as Record<string, unknown>,
          radiusMm: v.payload.radiusMm,
          ...(v.payload.scale !== undefined ? { scale: v.payload.scale } : {}),
          ...(v.payload.label !== undefined ? { label: v.payload.label } : {}),
        },
        pyCtx,
        60_000,
      )
      if (!r.ok) return { ok: false, error: r.error, hint: r.hint }
      const coerced = v15CoerceDetailDrawingResult(r.result)
      if (!coerced) {
        return {
          ok: false,
          error: 'sidecar_protocol_error',
          hint: 'cad.detail_drawing returned a malformed svg/view envelope',
        }
      }
      return { ok: true, result: coerced }
    },
  )
}
