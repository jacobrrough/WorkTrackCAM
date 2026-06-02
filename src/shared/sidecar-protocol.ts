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
  | 'cad.project_drawing'
  | 'cad.export_drawing'
  | 'cad.solve_sketch'
  | 'cad.create_assembly'
  | 'cad.tessellate_assembly'
  | 'cad.export_assembly'
  // CAD V1.5 — additive drawing helpers (dimensions / sections / title block).
  | 'cad.dimension_drawing'
  | 'cad.section_drawing'
  | 'cad.attach_title_block'
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

// ── cad.project_drawing / cad.export_drawing ─────────────────────────────
//
// CAD V2 — Wave 2 Workflow A2 (Drawings). Projects a 3D body handle into a
// 2D SVG drawing for the renderer's Drawings panel. Two methods so the
// renderer can stream inline markup for live previews AND export to disk on
// operator click without paying for two sidecar projections.
//
// View directions match standard third-angle mechanical drafting:
//   * 'front' — viewer looks down +Y, sees XZ plane (width × height)
//   * 'top'   — viewer looks down +Z, sees XY plane (width × depth)
//   * 'right' — viewer looks down +X, sees YZ plane (depth × height)
//   * 'iso'   — isometric (1, 1, 1) corner view
//
// Errors:
//   * 'bad_params'            — empty handle, unknown view, null-byte path
//   * 'invalid_handle'        — handle not in the sidecar's table
//   * 'cadquery_not_installed' — pip dep missing
//   * 'drawing_error'         — CadQuery raised during SVG projection
//   * 'svg_write_error'       — disk write failed (export_drawing only)
//
// Safety Rule 1: this path does NOT touch STL / G-code; SVG is renderer-only.

export type CadDrawingView = 'front' | 'top' | 'right' | 'iso'

export type CadProjectDrawingParams = {
  /** Opaque handle from cad.execute_script or cad.import_step. */
  handle: string
  /** View direction; see CadDrawingView for the standard names. */
  view: CadDrawingView
}

export type CadProjectDrawingResult = {
  /** Inline SVG markup for the projection (UTF-8). */
  svg: string
  /** Echoed view name for round-trip diagnostics. */
  view: CadDrawingView
  /** Byte length of the SVG after UTF-8 encode (= svg.length in mostly-ASCII output). */
  bytes: number
}

export type CadExportDrawingParams = {
  handle: string
  view: CadDrawingView
  /** Absolute path. Null-byte is rejected by the sidecar with bad_params. */
  outPath: string
}

export type CadExportDrawingResult = {
  /** Echo of outPath (now exists on disk). */
  outPath: string
  /** Echoed view name for round-trip diagnostics. */
  view: CadDrawingView
  /** Stat() size of the written SVG file in bytes. */
  bytesWritten: number
}

// ── cad.solve_sketch ─────────────────────────────────────────────────────
//
// CAD V1 — Wave 2 Workflow Sketcher. Runs the planegcs 2D constraint solver
// over a sketch (points / lines / circles / arcs) plus a typed constraint
// list. The renderer's Sketch2DCanvas pushes a fresh payload every time the
// user adds or moves geometry and re-solves; the result feeds back into the
// canvas, which redraws the moved points.
//
// Why not pass planegcs IDs over the wire?
// The renderer keeps its own DOM-friendly string ids (`pt1`, `line_top`,
// etc.) so the user can hover / select / undo with stable handles across
// re-solves. The sidecar translates those strings into planegcs typed-ids
// internally; the wire surface stays string-keyed.
//
// Constraint kinds supported in V1:
//   * 'horizontal'    — line is horizontal (constrains a LineEntity)
//   * 'vertical'      — line is vertical
//   * 'coincident'    — two points share a location
//   * 'distance'      — point-to-point distance equals a fixed value (mm)
//   * 'radius'        — circle OR arc radius equals a fixed value (mm)
//   * 'parallel'      — two lines parallel
//   * 'perpendicular' — two lines perpendicular
//
// Error vocabulary (codes mirror the Python core's `_CadHandlerError`):
//   * 'bad_params'                — sketchState / constraintList missing or wrong type
//   * 'invalid_sketch'            — sketch shape is malformed (bad ids, NaN, etc.)
//   * 'invalid_constraint'        — references a missing entity or wrong type
//   * 'planegcs_not_installed'    — pip dep missing in the sidecar env
//   * 'solver_under_constrained'  — solve technically succeeded but dof > 0;
//                                    renderer prompts the operator to add constraints
//   * 'solver_over_constrained'   — constraints conflict; renderer highlights the
//                                    offending source ids (carried in the message)
//   * 'solver_failed'             — planegcs returned a non-convergent status

/** A 2D point in the sketch plane. `fixed` anchors the point. */
export type SketchPoint = {
  id: string
  x: number
  y: number
  /** When true the solver will not move this point. Defaults to false. */
  fixed?: boolean
}

/** A 2D line segment between two point ids in the sketch. */
export type SketchLine = {
  id: string
  /** Point ids; must reference entries in `sketch.points`. */
  p1: string
  p2: string
}

/** A 2D circle: center point id + radius (mm). */
export type SketchCircle = {
  id: string
  /** Point id of the center; must reference an entry in `sketch.points`. */
  center: string
  /** Radius in mm. Must be positive. */
  radius: number
}

/**
 * A 2D arc by center / start / end point ids and a (radius, sweep) pair.
 * Angles in radians, CCW from positive x-axis (planegcs convention).
 */
export type SketchArc = {
  id: string
  center: string
  start: string
  end: string
  /** Radius in mm. Must be positive. */
  radius: number
  /** Start angle in radians, CCW from +x. */
  startAngle: number
  /** End angle in radians, CCW from +x. */
  endAngle: number
}

export type SketchState = {
  points: SketchPoint[]
  lines: SketchLine[]
  circles: SketchCircle[]
  arcs: SketchArc[]
}

/** Discriminated union of every constraint kind supported in V1. */
export type SketchConstraint =
  | { id: string; kind: 'horizontal'; line: string }
  | { id: string; kind: 'vertical'; line: string }
  | { id: string; kind: 'coincident'; p1: string; p2: string }
  | { id: string; kind: 'distance'; p1: string; p2: string; distance: number }
  | { id: string; kind: 'radius'; entity: string; radius: number }
  | { id: string; kind: 'parallel'; l1: string; l2: string }
  | { id: string; kind: 'perpendicular'; l1: string; l2: string }

export type CadSolveSketchParams = {
  sketchState: SketchState
  constraintList: SketchConstraint[]
}

export type CadSolveSketchResult = {
  /**
   * Updated sketch with points moved to satisfy the constraints. Lines /
   * circles / arcs are echoed with the same ids; the renderer rebuilds
   * their visual geometry from the moved points. Circle / arc radii reflect
   * any radius constraint applied during the solve.
   */
  sketch: SketchState
  /**
   * Degrees of freedom remaining after the solve. Always `0` on success in
   * V1 — the handler raises `solver_under_constrained` when dof > 0 so this
   * field is informational only. A future iteration may surface partial
   * solutions and let the renderer decide whether to apply them.
   */
  dof: number
}

// ── cad.create_assembly / cad.tessellate_assembly / cad.export_assembly ──
//
// CAD V2 — Wave 2 Workflow A1 (Assemblies). Wraps multiple existing part
// handles (each from a prior cad.execute_script / cad.import_step) in a
// single cq.Assembly via per-child 4x4 transforms, then either tessellates
// the assembly into a flat-buffer mesh for the renderer or exports it to
// STEP (hierarchy-preserving) / STL (flattened-mesh) on disk.
//
// Why three methods instead of one fat call?
// The renderer needs to react to operator edits (drag a part, change a
// transform) without re-uploading the entire assembly definition. The
// create→handle→tessellate split lets the renderer:
//   1. Build the assembly once, stash the assembly handle.
//   2. Tessellate (or re-tessellate at higher tolerance) on demand.
//   3. Export to disk only when the operator clicks "Save".
//
// The wire shape of tessellate_assembly intentionally mirrors
// tessellate_with_ids so the renderer's selection logic does not need to
// fork on assembly vs. single body. The faceMap dict gains a `childName`
// field so the inspector panel can attribute selected faces to the right part.
//
// Errors mirror cad.export / cad.tessellate_with_ids vocabulary:
//   * 'bad_params'              — empty parts, malformed transform shape,
//                                   non-finite transform value, null-byte
//                                   path, unsupported format
//   * 'invalid_handle'          — a child handle (create_assembly) or the
//                                   assembly handle (tessellate / export)
//                                   is not in the sidecar's _HANDLES table
//   * 'invalid_numeric_params'  — toleranceMm non-positive / non-finite
//   * 'not_an_assembly'         — caller passed a single-body handle to a
//                                   tessellate_assembly / export_assembly
//                                   method; renderer should fall back to
//                                   cad.tessellate_with_ids / cad.export
//   * 'cadquery_not_installed'  — pip dep missing
//   * 'assembly_not_supported'  — cq.Assembly not exposed in this CadQuery
//                                   build; renderer falls back to single-body
//   * 'tessellation_error'      — CadQuery raised mid-tessellate
//   * 'export_error'            — CadQuery raised mid-export
//   * 'assembly_build_error'    — cq.Assembly construction raised (e.g.
//                                   degenerate transform matrix)
//
// Safety Rule 1: STL export from an assembly flows through the same
// degenerate-triangle filter + post-write size check used by cad.export, so
// downstream cam.run_toolpath numerics are byte-identical regardless of
// whether the source was a single body or a flattened assembly.

/** Formats supported by cad.export_assembly. DXF is excluded by design — it
 * has no assembly / component concept. STEP preserves the hierarchy via
 * cq.Assembly.save; STL flattens to a single mesh via the per-child
 * tessellation path. */
export type CadAssemblyExportFormat = 'step' | 'stl'

/**
 * A single child in an assembly. The `handle` must already be in the
 * sidecar's handle table (from a prior cad.execute_script or
 * cad.import_step); restarting the sidecar invalidates handles.
 *
 * `transform` accepts:
 *   * the literal string `'identity'` as a compact shortcut for no offset, OR
 *   * a row-major 4x4 affine matrix (last row implicitly [0,0,0,1] but the
 *     wire requires it to be passed explicitly so the shape is uniform).
 *
 * `name` is optional; the sidecar defaults to `"part_<index>"` when absent.
 * Renderer should pass a stable name (e.g. the source filename without
 * extension) so face-map entries' `childName` field stays meaningful.
 */
export type CadAssemblyChild = {
  handle: string
  name?: string
  /** Either 'identity' or a row-major 4x4 transform matrix. */
  transform: 'identity' | [
    [number, number, number, number],
    [number, number, number, number],
    [number, number, number, number],
    [number, number, number, number],
  ]
}

export type CadCreateAssemblyParams = {
  /** Must be a non-empty array. */
  parts: CadAssemblyChild[]
  /** Optional display name (defaults to "WorkTrackCAM-Assembly"). */
  name?: string
}

export type CadCreateAssemblyResult = {
  /** Opaque handle prefixed with "assembly:". */
  handle: string
  /** Number of children added to the assembly. */
  childCount: number
  /** Axis-aligned union bbox in mm. */
  bbox: { min: [number, number, number]; max: [number, number, number] }
}

/**
 * Per-face metadata in the assembly's `faceMap` dict. Extends `CadFaceMapEntry`
 * with a `childName` field so the renderer's inspector panel can attribute
 * the selected face to the right part.
 */
export type CadAssemblyFaceMapEntry = CadFaceMapEntry & {
  /**
   * The child name (set via `CadAssemblyChild.name` or defaulted to
   * `"part_<index>"`) that contributed this face. Stable across re-runs of
   * the same create_assembly + tessellate_assembly pair.
   */
  childName: string
}

export type CadTessellateAssemblyParams = {
  /** Assembly handle from cad.create_assembly. */
  handle: string
  /** Surface deviation tolerance in mm. Defaults to 0.1 mm in the sidecar. */
  toleranceMm?: number
}

export type CadTessellateAssemblyResult = {
  /** Flat float array; length divisible by 3. */
  vertices: number[]
  /** Flat triangle index buffer; length divisible by 3. */
  indices: number[]
  /** Parallel face-id array; faceIds[i] is the 0-based id of triangle i. */
  faceIds: number[]
  /** Equal to faceIds.length and indices.length / 3. */
  triangleCount: number
  /** Axis-aligned bbox of the assembly (mm). */
  bbox: { min: [number, number, number]; max: [number, number, number] }
  /**
   * Per-face metadata keyed by face id (as a string). Same shape as
   * `CadTessellateWithIdsResult.faceMap` plus a `childName` field.
   */
  faceMap: Record<string, CadAssemblyFaceMapEntry>
}

export type CadExportAssemblyParams = {
  handle: string
  outPath: string
  format: CadAssemblyExportFormat
  /** Required for STL; defaults to 0.1 mm. Ignored for STEP. */
  toleranceMm?: number
}

export type CadExportAssemblyResult = {
  outPath: string
  bytesWritten: number
}

// ── cad.add_assembly_mate (CAD V1.5 — Wave 3) ───────────────────────────
//
// Incremental mate constraints on an existing cq.Assembly handle. The
// renderer's V1.5 AssemblyView modal lets the operator pick two features
// in the viewport (a point, an axis, or a plane) on two different parts,
// then calls cad.add_assembly_mate once per confirmed mate. The sidecar
// runs cq.Assembly.constrain(...) + .solve() and updates the cached
// workplane behind the same handle.
//
// Three mate kinds:
//   * point  — weld two 3-D points (in each child's local frame) together.
//              Drops 3 translational DOFs.
//   * axis   — align two 3-D axes (parallel + co-linear). Drops 2 rotational DOFs.
//   * plane  — mate two planes face-to-face. Drops 1 translation + 2 rotation DOFs.
//
// Error vocabulary mirrors the bulk assembly path with one addition:
//   * 'mate_solve_failed' — cq.Assembly.solve() raised. Most common when
//                            the operator stacks conflicting mates
//                            (over-constrained system); the renderer
//                            should surface a "loosen a constraint" hint.

/** Discriminated mate kind. Each kind requires a different feature payload. */
export type CadAssemblyMateKind = 'point' | 'axis' | 'plane'

/**
 * Point mate: weld two 3-D points (in each child's local frame) together.
 * Reduces the relative DOF count of part2 by 3 translation DOFs.
 */
export type CadAssemblyPointMate = {
  kind: 'point'
  /** Child name in the assembly (matches CadAssemblyChild.name). */
  part1Id: string
  /** Point in part1's local frame (mm). */
  point1: [number, number, number]
  part2Id: string
  /** Point in part2's local frame (mm). */
  point2: [number, number, number]
}

/**
 * Axis mate: align two 3-D axes (direction vectors in each child's local frame).
 * Reduces the relative rotational DOF count of part2 by 2.
 */
export type CadAssemblyAxisMate = {
  kind: 'axis'
  part1Id: string
  /** Axis direction in part1's local frame (mm). Need not be unit-length. */
  axis1: [number, number, number]
  part2Id: string
  /** Axis direction in part2's local frame (mm). */
  axis2: [number, number, number]
}

/**
 * Plane mate: mate two planes face-to-face. Each plane is origin + normal in
 * the child's local frame. Reduces DOFs by 1 translation + 2 rotation.
 */
export type CadAssemblyPlaneMate = {
  kind: 'plane'
  part1Id: string
  /** Plane origin in part1's local frame (mm). */
  point1: [number, number, number]
  /** Plane normal in part1's local frame (mm). Need not be unit-length. */
  normal1: [number, number, number]
  part2Id: string
  point2: [number, number, number]
  normal2: [number, number, number]
}

/** Union of all mate kinds — what the wire accepts as the `mate` field. */
export type CadAssemblyMate =
  | CadAssemblyPointMate
  | CadAssemblyAxisMate
  | CadAssemblyPlaneMate

/**
 * Params for cad.add_assembly_mate. Single-mate-at-a-time matches the
 * renderer's incremental flow: the operator picks features in the viewport
 * and confirms one mate per modal close. Bulk callers (file load / round-trip)
 * use cad.build_assembly_with_mates instead.
 */
export type CadAddAssemblyMateParams = {
  /** Assembly handle from a prior cad.create_assembly call. */
  handle: string
  /** Mate definition (discriminated by `kind`). */
  mate: CadAssemblyMate
}

export type CadAddAssemblyMateResult = {
  /** Echo of input handle (assembly identity preserved across mate ops). */
  handle: string
  /** Echoed mate.kind so the renderer can chain on a single round-trip. */
  kind: CadAssemblyMateKind
  /** Echoed part1Id. */
  part1Id: string
  /** Echoed part2Id. */
  part2Id: string
  /**
   * Post-solve axis-aligned bbox in mm. The solver moves children, so the
   * bbox after a successful mate solve typically differs from the pre-solve
   * cache. Renderer should re-frame the viewport on this value.
   */
  bbox: { min: [number, number, number]; max: [number, number, number] }
}

// ── cad.dimension_drawing / cad.section_drawing / cad.attach_title_block ─
//
// CAD V1.5 — additive drawing extensions on top of cad.project_drawing.
// Three methods so the renderer's V1.5 DrawingView can build a real
// mechanical drawing (orthographic + dimensions + section view + title
// block) without stuffing every concern into a single fat call:
//
//   * cad.dimension_drawing  — overlay a dimension annotation layer
//                                (distance / radius / diameter / angle).
//   * cad.section_drawing    — slice the body with a half-space, then
//                                project the cut.
//   * cad.attach_title_block — stamp a title-block <g> into an SVG.
//
// All three operate on top of an existing body handle (from
// cad.execute_script or cad.import_step). attach_title_block is unique in
// that it operates on the SVG string directly — it does NOT need the
// handle table — so the renderer can stamp the same block onto a base
// projection OR a dimensioned/sectioned variant without an extra round-
// trip.
//
// Error vocabulary mirrors the BUILD-3 drawing path with two additions:
//   * 'bad_params'      — malformed dimension spec, unknown axis, etc.
//   * 'section_error'   — CadQuery raised during the cut/half-space.
//   * 'invalid_handle'  — handle missing from the table (dimension /
//                          section only; attach_title_block doesn't read
//                          the table).
//   * 'drawing_error' / 'cadquery_not_installed' — propagated.
//
// Safety Rule 1: these paths DO NOT emit G-code or STL. The annotated SVG
// is renderer-only; no downstream CAM logic ever reads it.

/** Dimension kinds supported in V1.5. */
export type CadDimensionKind = 'distance' | 'radius' | 'diameter' | 'angle'

/** Re-usable 2D point spec for dimension overlays (sheet-space mm). */
export type CadDimensionPoint2D = { x: number; y: number }

/**
 * Discriminated union of every supported dimension spec. Each variant
 * carries the geometric anchors the SVG layer needs to draw witness
 * lines, dimension lines, arrowheads, and the text label.
 *
 *   * 'distance' — measures the linear distance between two 2D points.
 *     `offset` shifts the dimension line perpendicular to the measured
 *     vector so the label sits outside the part outline; sign picks the
 *     side. Defaults to 8 mm if omitted.
 *   * 'radius' / 'diameter' — measures a circular feature. `center` is
 *     the arc/circle centre; `edge` is a point on the arc (the leader
 *     terminates here). The text label is auto-prefixed with "R" or "Ø"
 *     unless `label` is supplied.
 *   * 'angle' — measures the angle between two arms sharing a `vertex`.
 *     Auto-formatted in degrees unless `label` is supplied.
 *
 * `label` is optional on every kind; when present the renderer-supplied
 * text replaces the auto-computed measurement (useful for tolerance
 * call-outs like "30 ±0.05").
 */
export type CadDimensionSpec =
  | {
      kind: 'distance'
      p1: CadDimensionPoint2D
      p2: CadDimensionPoint2D
      /** Perpendicular offset for the dimension line in mm (default 8). */
      offset?: number
      label?: string
    }
  | {
      kind: 'radius'
      center: CadDimensionPoint2D
      edge: CadDimensionPoint2D
      label?: string
    }
  | {
      kind: 'diameter'
      center: CadDimensionPoint2D
      edge: CadDimensionPoint2D
      label?: string
    }
  | {
      kind: 'angle'
      vertex: CadDimensionPoint2D
      arm1: CadDimensionPoint2D
      arm2: CadDimensionPoint2D
      label?: string
    }

export type CadDimensionDrawingParams = {
  /** Opaque handle from cad.execute_script or cad.import_step. */
  handle: string
  /** View direction; see CadDrawingView for the standard names. */
  view: CadDrawingView
  /**
   * Dimension specs to overlay. Empty array round-trips back to the
   * bare projection — convenient for toggling the layer off without
   * two separate IPC paths.
   */
  dimensions: CadDimensionSpec[]
}

export type CadDimensionDrawingResult = {
  /** Base SVG + dimension <g> layer. */
  svg: string
  /** Echoed view name. */
  view: CadDrawingView
  /** Byte length of the SVG after UTF-8 encode. */
  bytes: number
  /** Number of dimension annotations applied (== dimensions.length). */
  dimensionCount: number
}

/** Section-plane axis vocabulary. */
export type CadSectionAxis = 'x' | 'y' | 'z'

/** Which half-space to KEEP after slicing along the plane. */
export type CadSectionKeepSide = 'positive' | 'negative'

/**
 * Section-plane spec: an axis-aligned cutting plane at `offset` along
 * `axis`. `keepSide` picks which side of the plane the renderer wants
 * to see; defaults to 'positive' (coord > offset). The unwanted half is
 * cut away by subtracting an infinite half-space box from the body.
 */
export type CadSectionPlane = {
  axis: CadSectionAxis
  /** Signed plane offset along the axis (mm). */
  offset: number
  /** Defaults to 'positive' when omitted. */
  keepSide?: CadSectionKeepSide
}

export type CadSectionDrawingParams = {
  handle: string
  view: CadDrawingView
  plane: CadSectionPlane
}

export type CadSectionDrawingResult = {
  /** SVG of the sectioned body (post-cut + projected). */
  svg: string
  view: CadDrawingView
  bytes: number
  /** Echoed normalized plane spec (keepSide defaulted if absent). */
  plane: {
    axis: CadSectionAxis
    offset: number
    keepSide: CadSectionKeepSide
  }
}

/**
 * Title-block metadata. Every field is optional on the wire; the sidecar
 * fills missing slots with empty strings so the operator can stamp a
 * partial block and finish it later. Field values are trimmed to 80
 * characters by the sidecar to fit the standard drafting block.
 */
export type CadTitleBlockMetadata = {
  /** Drawing name (left-most cell). */
  name?: string
  /** Scale string, e.g. "1:1" or "2:1". */
  scale?: string
  /** Author / drafter name. */
  author?: string
  /** Date stamp string (renderer chooses the format). */
  date?: string
  /** Sheet identifier, e.g. "1 of 1". */
  sheet?: string
}

export type CadAttachTitleBlockParams = {
  /** SVG markup to stamp into. Typically the output of cad.project_drawing
   * / cad.dimension_drawing / cad.section_drawing. */
  svg: string
  metadata: CadTitleBlockMetadata
}

export type CadAttachTitleBlockResult = {
  /** Input SVG + title-block <g> layer (idempotent when already stamped). */
  svg: string
  bytes: number
  /** Echoed normalized metadata (missing fields filled with empty string). */
  metadata: {
    name: string
    scale: string
    author: string
    date: string
    sheet: string
  }
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
