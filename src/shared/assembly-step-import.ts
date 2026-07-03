/**
 * assembly-step-import — the PURE core of "Insert from file": importing an
 * external vendor STEP (fasteners / motors / brackets) as an assembly component.
 *
 * Phase-4 of the parity roadmap. Fusion's "Insert → Insert from file" is a
 * first-class verb; before this pass every assembly part had to come from the
 * project's own CadQuery script. This module owns the framework-agnostic half of
 * that verb so both the main-process IPC handler (`ipc-assembly-step-import.ts`)
 * and the renderer helper (`buildStepImportPart`) share ONE validation + shaping
 * contract with no drift:
 *
 *   1. {@link validateStepImportPath} — the lexical path-validation MATRIX:
 *        - reject null bytes (defeats every downstream path-safety check),
 *        - reject a wrong extension (whitelist `.step` / `.stp`, case-insensitive),
 *        - reject `..` traversal segments (keep the pick honest),
 *        - reject an oversize file (a ~100 MB cap; a runaway STEP would OOM the
 *          sidecar + freeze the UI).
 *      Existence is an IO concern (the main handler `stat`s the file); this pure
 *      function takes the already-`stat`ed `sizeBytes` so the SAME size rule is
 *      unit-testable without a filesystem.
 *
 *   2. {@link buildStepImportPart} — run the import → tessellate pipeline through
 *      a caller-supplied {@link StepImportBridge} (the real one wraps
 *      `cad.import_step` + `cad.tessellate_with_ids`; tests pass a mock) and shape
 *      the result into an {@link StepImportPartResult}: the AssemblyPart-shaped
 *      fields (name from the filename, handle, geometrySource recording
 *      `{kind:'step', stepPath, cachedBounds, cachedDims}`) PLUS the mesh + bbox
 *      the viewport + interference need.
 *
 *   3. {@link stepImportSourceIsDangling} — hydrate-honesty predicate: given a
 *      persisted external-STEP `geometrySource` and whether its `stepPath` still
 *      resolves on disk, report whether the row should render a DANGLING badge.
 *
 * Pure: no React, no DOM, no IPC, no `fs`, no clock. The caller supplies the
 * bridge, the id, and the on-disk facts (size / existence). Safety Rule 1: this
 * module never emits G-code; the STL it produces flows into the same
 * degenerate-filtered writer the rest of the CAD pipeline uses.
 */

import type { AssemblyGeometrySource, AssemblyCachedBounds } from './assembly-schema'

// ── Path validation matrix ────────────────────────────────────────────────────

/** Extensions the STEP importer accepts (case-insensitive). */
export const STEP_IMPORT_EXTENSIONS = ['.step', '.stp'] as const

/**
 * Maximum accepted STEP file size, in bytes. ~100 MB — big enough for a dense
 * vendor assembly STEP, small enough that a runaway file cannot OOM the sidecar
 * or freeze the UI mid-tessellation. Mirrors the "cap the wire payload" posture
 * of `CAD_SCRIPT_MAX_BYTES` in `ipc-cad.ts`, scaled for binary geometry.
 */
export const STEP_IMPORT_MAX_BYTES = 100 * 1024 * 1024

/** Stable reason codes for a rejected import path (surfaced as an operator hint). */
export type StepImportPathReason =
  | 'empty_path'
  | 'null_byte'
  | 'bad_extension'
  | 'path_traversal'
  | 'file_too_large'

export type StepImportPathValidation =
  | { ok: true; ext: (typeof STEP_IMPORT_EXTENSIONS)[number] }
  | { ok: false; reason: StepImportPathReason; hint: string }

/** Lowercase extension (including the leading dot) of a path, or '' when none. */
function extensionOf(path: string): string {
  const base = path.replace(/\\/g, '/').split('/').pop() ?? ''
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return '' // no dot, or a dotfile with no extension
  return base.slice(dot).toLowerCase()
}

/**
 * Validate an external STEP import path LEXICALLY (+ the size rule when
 * `sizeBytes` is supplied). Pure: no filesystem access. The caller is expected
 * to have already confirmed the file EXISTS (IO) and to pass its `stat().size`
 * as `sizeBytes` so the identical size cap is enforced in one place and remains
 * unit-testable. Omit `sizeBytes` to run only the lexical checks.
 *
 * Order is deliberate: null byte first (it defeats every later check), then
 * extension (fail fast before touching size), then traversal, then size.
 */
export function validateStepImportPath(
  path: unknown,
  sizeBytes?: number
): StepImportPathValidation {
  if (typeof path !== 'string' || path.trim().length === 0) {
    return { ok: false, reason: 'empty_path', hint: 'Pick a .step or .stp file to import.' }
  }
  if (path.includes('\0')) {
    return {
      ok: false,
      reason: 'null_byte',
      hint: 'The file path contains a null byte and was rejected.'
    }
  }
  const ext = extensionOf(path)
  const allowed = STEP_IMPORT_EXTENSIONS.find((e) => e === ext)
  if (!allowed) {
    return {
      ok: false,
      reason: 'bad_extension',
      hint: `Only ${STEP_IMPORT_EXTENSIONS.join(' / ')} files can be inserted from file (got ${ext || 'no extension'}).`
    }
  }
  // Reject `..` traversal segments (guard both separators). A vendor STEP path
  // may be absolute + outside the project, which is allowed, but a `..` segment
  // is a red flag we refuse rather than normalize.
  const segments = path.split(/[/\\]/)
  if (segments.includes('..')) {
    return {
      ok: false,
      reason: 'path_traversal',
      hint: 'The file path contains ".." segments and was rejected.'
    }
  }
  if (sizeBytes !== undefined) {
    if (!Number.isFinite(sizeBytes) || sizeBytes < 0) {
      return {
        ok: false,
        reason: 'file_too_large',
        hint: 'Could not determine the file size; the import was rejected.'
      }
    }
    if (sizeBytes > STEP_IMPORT_MAX_BYTES) {
      const mb = (STEP_IMPORT_MAX_BYTES / (1024 * 1024)).toFixed(0)
      return {
        ok: false,
        reason: 'file_too_large',
        hint: `The STEP file exceeds the ${mb} MB import limit.`
      }
    }
  }
  return { ok: true, ext: allowed }
}

// ── Filename → part name ──────────────────────────────────────────────────────

/**
 * Derive a display name from a STEP file path: the basename with its extension
 * stripped. Falls back to `'Imported part'` for an empty / extension-only
 * basename so the AssemblyPart never gets a blank name (the schema requires a
 * non-empty name).
 */
export function stepImportPartName(path: string): string {
  const base = path.replace(/\\/g, '/').split('/').pop() ?? ''
  const stripped = base.replace(/\.(step|stp)$/i, '').trim()
  return stripped.length > 0 ? stripped : 'Imported part'
}

// ── import → tessellate pipeline (bridge-shaped) ──────────────────────────────

/** Axis-aligned bbox as the sidecar returns it (mm). */
export type StepImportBbox = {
  min: [number, number, number]
  max: [number, number, number]
}

/** Result of `cad.import_step` (a handle + bbox). */
export type StepImportBridgeImportResult = {
  handle: string
  bbox: StepImportBbox
}

/**
 * Subset of `cad.tessellate_with_ids`'s result the importer needs: the mesh
 * buffers + face ids (so edges/faces ride along) and the bbox. Extra fields
 * (faceMap / edgeMap / edges) are permitted but not required here.
 */
export type StepImportBridgeTessellateResult = {
  vertices: number[]
  indices: number[]
  faceIds: number[]
  triangleCount: number
  bbox: StepImportBbox
}

/**
 * The two-call surface `buildStepImportPart` drives. The real bridge wraps a
 * one-shot `PythonBridge` (`cad.import_step` then `cad.tessellate_with_ids`);
 * tests pass a mock. Each call resolves the raw sidecar result or REJECTS with
 * an error carrying an optional `sidecarCode` the shaper maps to a hint.
 */
export type StepImportBridge = {
  importStep(path: string): Promise<StepImportBridgeImportResult>
  tessellateWithIds(handle: string): Promise<StepImportBridgeTessellateResult>
}

/** Mesh payload handed to the viewport / interference (flat buffers + bbox). */
export type StepImportMesh = {
  vertices: number[]
  indices: number[]
  faceIds: number[]
  triangleCount: number
  bbox: StepImportBbox
}

/**
 * The AssemblyPart-shaped success payload. The renderer's `onAddPart` handler
 * folds `id` / `name` / `handle` / `geometrySource` straight onto a new
 * `AssemblyPart` row and feeds `mesh` into the viewport. `geometrySource` is the
 * DURABLE record persisted on the component (external STEP path + cached bounds)
 * so the row survives reload even when the source file later moves.
 */
export type StepImportPartResult = {
  /** Stable, caller-supplied row id (NOT the CadQuery handle). */
  id: string
  /** Display name derived from the filename. */
  name: string
  /** Live in-session CadQuery handle from `cad.import_step` (ephemeral). */
  handle: string
  /** Durable geometry source recording the external STEP path + cached bounds. */
  geometrySource: AssemblyGeometrySource
  /** Mesh + bbox for the viewport + interference (never persisted verbatim). */
  mesh: StepImportMesh
}

export type StepImportError = {
  ok: false
  error: string
  hint: string
}

export type StepImportOutcome = { ok: true; result: StepImportPartResult } | StepImportError

/** Overall dimensions (mm) = max - min per axis. */
export function bboxDimensions(bbox: StepImportBbox): [number, number, number] {
  return [bbox.max[0] - bbox.min[0], bbox.max[1] - bbox.min[1], bbox.max[2] - bbox.min[2]]
}

function cachedBoundsFromBbox(bbox: StepImportBbox): AssemblyCachedBounds {
  return { min: [...bbox.min], max: [...bbox.max] }
}

/**
 * Run the import → tessellate pipeline through `bridge` and shape the result
 * into an {@link StepImportPartResult}. Assumes the path already passed
 * {@link validateStepImportPath} (the caller validates BEFORE spawning a
 * sidecar). Any bridge rejection folds into an honest `{ ok:false, error, hint }`
 * envelope — this never throws, so both the IPC handler and a renderer caller
 * can treat it as best-effort.
 *
 * @param path      validated `.step` / `.stp` path (recorded on the source)
 * @param id        stable, caller-owned row id (the caller mints it; keeps this pure)
 * @param bridge    the two-call import + tessellate surface
 */
export async function buildStepImportPart(
  path: string,
  id: string,
  bridge: StepImportBridge
): Promise<StepImportOutcome> {
  let imported: StepImportBridgeImportResult
  try {
    imported = await bridge.importStep(path)
  } catch (e) {
    return mapBridgeReject(e, 'step_import_failed', 'Could not import the STEP file.')
  }
  if (!imported || typeof imported.handle !== 'string' || imported.handle.length === 0) {
    return {
      ok: false,
      error: 'step_import_bad_response',
      hint: 'The importer did not return a usable body handle.'
    }
  }

  let tess: StepImportBridgeTessellateResult
  try {
    tess = await bridge.tessellateWithIds(imported.handle)
  } catch (e) {
    return mapBridgeReject(e, 'step_tessellate_failed', 'Could not tessellate the imported STEP body.')
  }
  if (!tess || !Array.isArray(tess.vertices) || !Array.isArray(tess.indices)) {
    return {
      ok: false,
      error: 'step_tessellate_bad_response',
      hint: 'The tessellator returned a malformed mesh envelope.'
    }
  }

  // Prefer the tessellation bbox (it reflects the actual meshed extent); fall
  // back to the import bbox if the tessellator omitted one.
  const bbox = isFiniteBbox(tess.bbox) ? tess.bbox : imported.bbox
  const geometrySource: AssemblyGeometrySource = {
    kind: 'step',
    stepPath: path,
    handle: imported.handle,
    cachedBounds: cachedBoundsFromBbox(bbox),
    cachedDims: bboxDimensions(bbox)
  }

  return {
    ok: true,
    result: {
      id,
      name: stepImportPartName(path),
      handle: imported.handle,
      geometrySource,
      mesh: {
        vertices: tess.vertices,
        indices: tess.indices,
        faceIds: Array.isArray(tess.faceIds) ? tess.faceIds : [],
        triangleCount:
          typeof tess.triangleCount === 'number' && Number.isFinite(tess.triangleCount)
            ? tess.triangleCount
            : Math.floor(tess.indices.length / 3),
        bbox
      }
    }
  }
}

function isFiniteBbox(bbox: StepImportBbox | undefined): bbox is StepImportBbox {
  if (!bbox || !Array.isArray(bbox.min) || !Array.isArray(bbox.max)) return false
  if (bbox.min.length !== 3 || bbox.max.length !== 3) return false
  return [...bbox.min, ...bbox.max].every((v) => typeof v === 'number' && Number.isFinite(v))
}

/**
 * Fold a bridge rejection into a stable error envelope. When the rejection
 * carries a `sidecarCode` (the sidecar's structured error, e.g.
 * `step_read_error` / `cadquery_not_installed`), prefer it so the renderer can
 * branch on the same vocabulary the rest of the CAD pipeline uses.
 */
function mapBridgeReject(e: unknown, fallbackError: string, fallbackHint: string): StepImportError {
  const err = e as { sidecarCode?: unknown; message?: unknown }
  const code =
    typeof err?.sidecarCode === 'string' && err.sidecarCode.length > 0 ? err.sidecarCode : fallbackError
  const hint = typeof err?.message === 'string' && err.message.length > 0 ? err.message : fallbackHint
  return { ok: false, error: code, hint }
}

// ── Hydrate honesty ───────────────────────────────────────────────────────────

/**
 * Is this geometry source an EXTERNAL STEP import (Phase-4)? True when either the
 * `kind` discriminator is `'step'` or a `stepPath` is recorded (belt-and-braces:
 * a source written by an older importer might carry `stepPath` without `kind`).
 */
export function isExternalStepSource(
  source: AssemblyGeometrySource | undefined
): source is AssemblyGeometrySource & { stepPath: string } {
  if (!source) return false
  return source.kind === 'step' || (typeof source.stepPath === 'string' && source.stepPath.length > 0)
}

/**
 * Hydrate-honesty predicate: should this row render a DANGLING badge?
 *
 * `true` only for an external STEP source whose `stepPath` no longer resolves on
 * disk (`fileExists === false`). An internal source, or an external source whose
 * file still exists, is NOT dangling. The caller supplies `fileExists` (an IO
 * fact); this stays pure. A source with `kind:'step'` but a MISSING `stepPath`
 * is treated as dangling too — it can never resolve.
 */
export function stepImportSourceIsDangling(
  source: AssemblyGeometrySource | undefined,
  fileExists: boolean
): boolean {
  if (!isExternalStepSource(source)) return false
  if (typeof source.stepPath !== 'string' || source.stepPath.length === 0) return true
  return !fileExists
}
