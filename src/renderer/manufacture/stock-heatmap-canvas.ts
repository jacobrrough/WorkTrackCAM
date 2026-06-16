/**
 * stock-heatmap-canvas — render a {@link StockHeightGrid} (top-down remaining
 * stock heights) to a flat PNG data-URL heatmap. Used by the CNC "Simulate"
 * stage to show a cheap voxel-approximation of remaining stock without spinning
 * up a Three.js / WebGL context.
 *
 * Runtime contract (mirrors `plate-thumbnail.ts`):
 *   - Uses an `OffscreenCanvas` 2D context so it can run off the React render
 *     path. On node/vitest (no `OffscreenCanvas`) it returns `null` and the
 *     caller falls back to the numeric stat summary — exactly the documented
 *     null-fallback pattern the repo already uses for plate thumbnails.
 *   - Pure data → data-URL: no DOM mutation, no React. The only side effect is
 *     allocating + disposing an offscreen canvas.
 *
 * The colour ramp maps cut DEPTH (how far below the original stock top a column
 * was carved) so the operator reads "where did the tool remove material":
 *   - uncut surface (height == topZ)  → pale / near-transparent
 *   - deepest cut    (height == floorZ) → saturated accent
 */

import type { StockHeightGrid } from '../../shared/stock-simulation'

/** Why {@link renderStockHeatmapDataUrl} returned `null`. */
export type StockHeatmapFailureReason =
  | 'empty-grid'
  | 'no-offscreen-canvas'
  | 'no-2d-context'
  | 'no-data-url'
  | 'renderer-threw'

/** Options for {@link renderStockHeatmapDataUrl}. */
export type StockHeatmapRenderOptions = {
  /** Output width in device pixels. Default 240. */
  widthPx?: number
  /** Output height in device pixels. Default 160. */
  heightPx?: number
  /** Optional out-param sink for the failure reason (mirrors plate-thumbnail). */
  failure?: { reason?: StockHeatmapFailureReason }
}

/** Default heatmap width in CSS pixels. */
export const STOCK_HEATMAP_WIDTH_PX = 240

/** Default heatmap height in CSS pixels. */
export const STOCK_HEATMAP_HEIGHT_PX = 160

/** Feature test for the offscreen-render path (exported for tests). */
export function stockHeatmapRenderingAvailable(): boolean {
  return typeof OffscreenCanvas !== 'undefined'
}

/**
 * Map a normalised cut depth (0 = uncut surface, 1 = deepest cut) to an
 * `rgba()` string. Pure + exported so the ramp can be unit-tested without a
 * canvas. Pale low-alpha at the surface → saturated accent at full depth, so
 * un-machined stock stays quiet and removed regions pop.
 */
export function depthToHeatColor(depth01: number): string {
  const t = Math.min(1, Math.max(0, depth01))
  // Blue→cyan accent ramp (matches the app accent family) with alpha rising
  // from a faint surface wash to fully opaque at the deepest cut.
  const r = Math.round(40 + t * 20)
  const g = Math.round(90 + t * 130)
  const b = Math.round(150 + t * 90)
  const a = (0.12 + t * 0.83).toFixed(3)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

/**
 * Render the height grid to a PNG data-URL heatmap, or `null` when the
 * environment cannot render (node/vitest, or a missing 2D context). The image
 * is drawn with the stock's +Y running UP the canvas (CAM convention) so it
 * matches the toolpath/3D-panel orientation.
 */
export function renderStockHeatmapDataUrl(
  grid: StockHeightGrid,
  options?: StockHeatmapRenderOptions
): string | null {
  const failureSink = options?.failure
  if (grid.cols <= 0 || grid.rows <= 0 || grid.heights.length === 0) {
    if (failureSink) failureSink.reason = 'empty-grid'
    return null
  }
  if (!stockHeatmapRenderingAvailable()) {
    if (failureSink) failureSink.reason = 'no-offscreen-canvas'
    return null
  }

  const widthPx = options?.widthPx ?? STOCK_HEATMAP_WIDTH_PX
  const heightPx = options?.heightPx ?? STOCK_HEATMAP_HEIGHT_PX

  // Cut-depth range: floorZ (deepest) .. topZ (surface). Guard a zero/negative
  // span (e.g. degenerate single-layer stock) so we never divide by zero.
  const span = grid.topZ - grid.floorZ
  const safeSpan = span > 1e-9 ? span : 1

  try {
    const canvas = new OffscreenCanvas(widthPx, heightPx)
    const ctxUnknown = (canvas as unknown as {
      getContext: (id: string) => unknown
    }).getContext('2d')
    if (!ctxUnknown) {
      if (failureSink) failureSink.reason = 'no-2d-context'
      return null
    }
    const ctx = ctxUnknown as OffscreenCanvasRenderingContext2D

    const cellW = widthPx / grid.cols
    const cellH = heightPx / grid.rows

    for (let j = 0; j < grid.rows; j++) {
      for (let i = 0; i < grid.cols; i++) {
        const height = grid.heights[j * grid.cols + i] ?? grid.topZ
        // depth01: 0 at the surface, 1 at the floor.
        const depth01 = (grid.topZ - height) / safeSpan
        ctx.fillStyle = depthToHeatColor(depth01)
        // Flip Y so +Y (back of stock) is at the TOP of the image.
        const py = heightPx - (j + 1) * cellH
        // +1px overdraw avoids hairline seams between cells.
        ctx.fillRect(i * cellW, py, cellW + 1, cellH + 1)
      }
    }

    const canvasAsHtml = canvas as unknown as { toDataURL?: (mime: string) => string }
    let dataUrl: string | null = null
    if (typeof canvasAsHtml.toDataURL === 'function') {
      dataUrl = canvasAsHtml.toDataURL('image/png')
    }
    if (!dataUrl) {
      if (failureSink) failureSink.reason = 'no-data-url'
      return null
    }
    return dataUrl
  } catch {
    if (failureSink) failureSink.reason = 'renderer-threw'
    return null
  }
}
