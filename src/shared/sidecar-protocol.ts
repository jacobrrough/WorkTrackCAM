/**
 * Wire types for the Python sidecar (engines/sidecar/main.py).
 *
 * One JSON object per line over stdin/stdout. `id` correlates request and
 * response. `method` is a dotted name (`cad.*`, `cam.*`, or top-level like
 * `ping` / `shutdown`).
 *
 * Keep this file structurally in sync with `engines/sidecar/main.py` —
 * a paired-pin test asserts the protocol shape on both sides.
 */

export type SidecarRequest = {
  id: string
  method: string
  params: Record<string, unknown>
}

export type SidecarSuccess<T = Record<string, unknown>> = {
  id: string
  ok: true
  result: T
}

export type SidecarError = {
  id: string
  ok: false
  error: {
    code: string
    message: string
    detail?: string
  }
}

export type SidecarResponse<T = Record<string, unknown>> = SidecarSuccess<T> | SidecarError

/** Known method names. Add to this union as new handlers ship. */
export type SidecarMethod =
  | 'ping'
  | 'shutdown'
  | 'cad.import_step'
  | 'cad.tessellate'
  | 'cad.tessellate_with_ids'
  | 'cad.execute_script'
  | 'cad.export'
  | 'cad.list_operations'
  | 'cam.run_toolpath'

export type PingResult = { pong: true; version: string }

export type CadImportStepParams = { path: string }
export type CadImportStepResult = {
  handle: string
  bbox: { min: [number, number, number]; max: [number, number, number] }
}

export type CadTessellateParams = {
  handle: string
  outPath: string
  toleranceMm: number
}
export type CadTessellateResult = {
  stlPath: string
  triangleCount: number
}

// ── cad.tessellate_with_ids ────────────────────────────────────────────────
//
// Selection-grade tessellator (CAD V1 Workflow H foundation): walks
// ``solid.Faces()`` and tessellates each face independently so every output
// triangle carries the 0-based face index that produced it. The renderer's
// ray-pick maps the hit triangle to the source CadQuery face via the
// parallel ``faceIds`` array; ``faceMap`` carries per-face metadata for the
// inspector panel.
//
// Why a flat ``vertices`` / ``indices`` pair and not the binary STL on disk?
// Selection needs to live in memory: the renderer feeds it straight into a
// BufferGeometry without a second file-IO round trip. The STL path
// (``cad.tessellate``) remains the source of truth for CAM downstream
// (Safety Rule 1).
//
// Wire contract
// -------------
// Params:
//   - handle:       REQUIRED. Opaque handle from a prior
//                   ``cad.execute_script`` / ``cad.import_step``.
//   - toleranceMm:  OPTIONAL. Surface deviation tolerance (default 0.1 mm
//                   to match ``cad.execute_script``'s bake).
//
// Result:
//   - vertices:      flat ``Float32``-style array, length divisible by 3
//                    (``[x0,y0,z0, x1,y1,z1, ...]``). Direct feed for
//                    ``BufferAttribute(vertices, 3)``.
//   - indices:       flat triangle index buffer, length divisible by 3.
//   - faceIds:       parallel array; ``faceIds[i]`` is the 0-based face id
//                    of triangle ``i``. ``faceIds.length === triangleCount``
//                    after the degenerate-triangle filter.
//   - triangleCount: equals ``faceIds.length`` and ``indices.length / 3``.
//   - bbox:          axis-aligned bbox in mm (echoed from the handle's
//                    cached bbox so the renderer can frame the part).
//   - faceMap:       dict keyed by face id (as a string for JSON-friendly
//                    serialization). Each entry carries ``kind`` (always
//                    ``"face"`` in V1; reserved for ``"edge"`` / ``"vertex"``
//                    in V2), ``occtHash`` (OCCT TopoDS hash for stability
//                    across CadQuery versions; 0 on binding mismatch), and
//                    an optional ``area`` in mm².
//
// Errors mirror ``cad.tessellate``'s vocabulary (``invalid_handle``,
// ``tessellation_error``, ``bad_params``, ``invalid_numeric_params``,
// ``cadquery_not_installed``).
export type CadTessellateWithIdsParams = {
  handle: string
  /** Surface deviation tolerance in mm. Defaults to 0.1 mm in the sidecar. */
  toleranceMm?: number
}

/**
 * Per-face metadata in the ``faceMap`` dict. The renderer's inspector panel
 * surfaces ``area`` and ``occtHash`` directly; ``kind`` is reserved for
 * future ``"edge"`` / ``"vertex"`` entity kinds (V2 selection).
 */
export type CadFaceMapEntry = {
  /** Reserved for future use; always ``"face"`` in V1. */
  kind: 'face'
  /**
   * OCCT TopoDS hash code for the face. Stable across re-runs of the same
   * script (same construction history → same hash). ``0`` if the OCP /
   * PythonOCC binding does not expose ``HashCode`` on this version.
   */
  occtHash: number
  /** Optional surface area in mm² (``Face.Area()``). ``0`` on failure. */
  area?: number
  /** Diagnostic; only present if a single face failed mid-tessellation. */
  error?: string
}

export type CadTessellateWithIdsResult = {
  /** Flat float array; length divisible by 3 (``x0,y0,z0, x1,y1,z1, ...``). */
  vertices: number[]
  /** Flat triangle index buffer; length divisible by 3. */
  indices: number[]
  /**
   * Parallel face-id array. ``faceIds[i]`` is the 0-based face id of
   * triangle ``i``. ``faceIds.length === triangleCount``.
   */
  faceIds: number[]
  /** Equal to ``faceIds.length`` and ``indices.length / 3``. */
  triangleCount: number
  /** Axis-aligned bounding box of the source solid (mm). */
  bbox: { min: [number, number, number]; max: [number, number, number] }
  /**
   * Per-face metadata keyed by face id (as a string for JSON-friendly
   * serialization). Renderer's selection inspector reads this.
   */
  faceMap: Record<string, CadFaceMapEntry>
}

// ── cad.execute_script ──────────────────────────────────────────────────────
//
// Runs the user's CadQuery script via cqgi.parse(script).build(...). The
// script runs inside a banned-token pre-scan so the renderer cannot reach
// the host filesystem / subprocesses / network through unsafe builtins.
//
// Each `show_object` result is tessellated to a binary STL (via the same
// degenerate-filtering writer used by cad.tessellate -- Safety Rule 1)
// and stashed in the sidecar `_HANDLES` table so `cad.export` and the
// downstream `cam.run_toolpath` strategies can reach it by handle.
export type CadScriptParamValue = number | boolean | string

export type CadExecuteScriptParams = {
  script: string
  /**
   * Optional build_parameters dict forwarded to cqgi BuildResult.build().
   * Wire shape: scalar values only (numbers, booleans, strings) to keep
   * the JSON-RPC envelope compact and predictable. Nested objects /
   * arrays are out-of-scope for the MVP.
   */
  buildParameters?: Record<string, CadScriptParamValue>
}

export type CadExecuteScriptMesh = {
  /** Opaque handle for cad.export / cam.run_toolpath. */
  handle: string
  /** Absolute path where the tessellated binary STL was written. */
  stlPath: string
  /** Triangle count in the STL (after degenerate-triangle filtering). */
  triangleCount: number
  /** Axis-aligned bounding box in mm. */
  bbox: { min: [number, number, number]; max: [number, number, number] }
  /**
   * Optional per-triangle face id array (CAD V1 selection foundation). Same
   * shape as ``cad.tessellate_with_ids``'s ``faceIds``: ``faceIds[i]`` is
   * the 0-based face id of triangle ``i``. Absent when the sidecar could not
   * build a face-tagged tessellation (e.g. CadQuery's per-face tessellate
   * raised) — the renderer's 3D viewport then falls back to whole-solid
   * picking. ``faceIds.length`` is NOT guaranteed to equal the STL's
   * ``triangleCount`` because the per-face tessellator may bin triangles
   * differently at face boundaries.
   */
  faceIds?: number[]
  /**
   * Optional per-face metadata dict (CAD V1 selection foundation). Keyed by
   * face id (as a string) — see ``CadFaceMapEntry`` for the shape. Absent
   * for the same reason ``faceIds`` is absent.
   */
  faceMap?: Record<string, CadFaceMapEntry>
}

export type CadScriptError = {
  /** Stable code -- e.g. `unsafe_script`, `script_exec_error`, `cadquery_not_installed`. */
  code: string
  message: string
}

export type CadExecuteScriptResult = {
  meshes: CadExecuteScriptMesh[]
  /** Total face count summed across every produced solid. */
  faceCount: number
  /** Build-result log lines: BuildResult exception repr + script `debug()` emissions. */
  log: string[]
  /** Present when the script tripped the banned-token pre-scan or raised. */
  error?: CadScriptError
}

// ── cad.export ──────────────────────────────────────────────────────────────
//
// Exports the body referenced by `handle` (from cad.execute_script or
// cad.import_step) to STEP / STL / DXF. The `outPath` is validated to be
// absolute and under the project root before the sidecar writes anything --
// mirroring the path-safety pattern in mesh-import-registry.
export type CadExportFormat = 'step' | 'stl' | 'dxf'

export type CadExportParams = {
  handle: string
  outPath: string
  format: CadExportFormat
  /** Required for STL; default 0.1 mm. Ignored for STEP / DXF. */
  toleranceMm?: number
}

export type CadExportResult = {
  outPath: string
  bytesWritten: number
}

// ── cad.list_operations ─────────────────────────────────────────────────────
//
// Pure AST + cqgi.parse static introspection -- does NOT execute the script.
// Safe to call on every keystroke (the renderer debounces). Returns the
// declared cqgi parameters plus the 16 MVP op call sites (workplane, rect,
// circle, polygon, extrude, revolve, sweep, loft, fillet, chamfer, shell,
// hole, cboreHole, cskHole, union/cut/intersect, text).
export type CadParameterKind = 'number' | 'boolean' | 'string'

export type CadDeclaredParameter = {
  name: string
  value: CadScriptParamValue
  kind: CadParameterKind
}

export type CadOperationSummary = {
  /** 0-based index in source order. */
  index: number
  /** Op kind -- workplane, rect, extrude, fillet, hole, cboreHole, ... */
  kind: string
  /** 1-based source line of the call expression. */
  line: number
  /** One-line summary built from the call's keyword/positional args. */
  summary: string
}

export type CadParseError = {
  /** 1-based source line of the SyntaxError. */
  line: number
  message: string
}

export type CadListOperationsParams = { script: string }

export type CadListOperationsResult = {
  parameters: CadDeclaredParameter[]
  operations: CadOperationSummary[]
  /** Present when ast.parse / cqgi.parse raised a SyntaxError. */
  parseError?: CadParseError
}

/**
 * CAM strategies the Python sidecar can dispatch via ``cam.run_toolpath``.
 *
 * Must stay in lock-step with ``engines/cam/ocl_strategies.py::STRATEGY_NAMES``
 * (paired-pin test ``sidecar-protocol.test.ts`` enforces this contract).
 *
 * - ``waterline`` / ``adaptive_waterline`` — Z-level contour finishing.
 * - ``raster`` — XY zigzag PathDropCutter with a flat-end (cylindrical) mill.
 * - ``surface_scan`` — XY zigzag PathDropCutter with a ball-end mill plus
 *   finer sampling, intended for ``cnc_3d_finish`` surface scan operations.
 */
export type CamStrategy =
  | 'waterline'
  | 'adaptive_waterline'
  | 'raster'
  | 'surface_scan'

export type CamRunToolpathParams = {
  strategy: CamStrategy
  stlPath: string
  toolDiameterMm: number
  stepoverMm: number
  feedMmMin: number
  plungeMmMin: number
  safeZMm: number
  /** Required for `waterline` and `adaptive_waterline`; ignored for raster / surface_scan. */
  zPassMm?: number
}

/**
 * Result of ``cam.run_toolpath``.
 *
 * ``toolpathLines`` are pre-formatted G-code strings (``"G0 Z..."`` /
 * ``"G1 X.. Y.. Z.. F.."`` / ``"; comment"``) ready to feed into the
 * Handlebars post-processor. Strings (NOT ``number[][]``) match what the
 * legacy ``ocl_toolpath.py`` subprocess returns and what ``cam-runner.ts``
 * consumes downstream — keeping them as strings means the sidecar can be a
 * drop-in replacement without rewriting the post-render pipeline.
 */
export type CamRunToolpathResult = {
  toolpathLines: string[]
  strategy: CamStrategy
  lineCount: number
}

/** Type guard: is this a valid sidecar response envelope? */
export function isSidecarResponse(value: unknown): value is SidecarResponse {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (typeof v.id !== 'string' || v.id.length === 0) return false
  if (v.ok === true) {
    return typeof v.result === 'object' && v.result !== null
  }
  if (v.ok === false) {
    const err = v.error as Record<string, unknown> | undefined
    return (
      typeof err === 'object' &&
      err !== null &&
      typeof err.code === 'string' &&
      typeof err.message === 'string'
    )
  }
  return false
}
