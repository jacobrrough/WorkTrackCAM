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
