/**
 * StockRemovalHeatmap — presentational view of a pure stock-removal simulation
 * for the CNC "Simulate" stage. Shows a top-down remaining-stock heatmap (a
 * VOXEL APPROXIMATION) plus the headline removal stats.
 *
 * Design notes:
 *   - The heavy lifting (parse G-code → carve voxels → height grid) is done by
 *     the pure `simulateStockRemovalFromGcode` helper in the SHARED layer; this
 *     component only renders its result. That keeps the voxel math fully unit-
 *     tested and this file declarative.
 *   - The heatmap image is produced by `renderStockHeatmapDataUrl`
 *     (OffscreenCanvas 2D). On node/vitest there is no `OffscreenCanvas`, so the
 *     helper returns `null` and we fall back to a labelled placeholder — the
 *     same null-fallback contract `plate-thumbnail.ts` uses. The numeric stats
 *     always render regardless of canvas support.
 *   - HONEST limitation surfaced in the UI: a flat tool removes voxels at/below
 *     its tip, so the heatmap reflects where the tool tip swept; it is not a
 *     cutter-shape-accurate or undercut-aware simulation. The full 3D voxel
 *     panel remains the higher-fidelity view.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  formatRemovedPercent,
  simulateStockRemovalFromGcode,
  type StockRemovalBox,
  type StockRemovalSimResult
} from '../../shared/stock-removal-sim'
import {
  renderStockHeatmapDataUrl,
  STOCK_HEATMAP_HEIGHT_PX,
  STOCK_HEATMAP_WIDTH_PX
} from './stock-heatmap-canvas'

export interface StockRemovalHeatmapProps {
  /** Posted G-code text (non-empty — the parent guards the empty case). */
  readonly gcode: string
  /** Active setup's rectangular stock box (mm). */
  readonly stockBox: StockRemovalBox
  /** Cutting-tool diameter (mm). */
  readonly toolDiameterMm?: number
  /** Cutting-tool shape. */
  readonly toolShape?: 'flat' | 'ball'
}

function formatMm(n: number): string {
  return `${n.toFixed(1)} mm`
}

/** Human-readable reason the sim produced no result. */
function skipMessage(result: Extract<StockRemovalSimResult, { ok: false }>): string {
  switch (result.reason) {
    case 'no-toolpath':
      return 'No machinable motion found in the posted G-code.'
    case 'invalid-stock':
      return 'Set a valid box stock (X/Y/Z) on the active setup to simulate stock removal.'
    default:
      return 'Stock-removal preview is unavailable for this toolpath.'
  }
}

export function StockRemovalHeatmap({
  gcode,
  stockBox,
  toolDiameterMm,
  toolShape
}: StockRemovalHeatmapProps): ReactNode {
  const result = useMemo(
    () =>
      simulateStockRemovalFromGcode(gcode, stockBox, {
        toolDiameterMm,
        toolShape
      }),
    [gcode, stockBox, toolDiameterMm, toolShape]
  )

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  // `null` until we know; `true`/`false` after the paint attempt so we can show
  // a fallback note only when the heatmap genuinely could not render.
  const [heatmapPainted, setHeatmapPainted] = useState<boolean | null>(null)

  useEffect(() => {
    if (!result.ok) {
      setHeatmapPainted(null)
      return
    }
    const canvas = canvasRef.current
    if (!canvas) {
      setHeatmapPainted(false)
      return
    }
    const dataUrl = renderStockHeatmapDataUrl(result.heightGrid, {
      widthPx: STOCK_HEATMAP_WIDTH_PX,
      heightPx: STOCK_HEATMAP_HEIGHT_PX
    })
    const ctx = canvas.getContext('2d')
    if (!dataUrl || !ctx) {
      setHeatmapPainted(false)
      return
    }
    const img = new Image()
    let cancelled = false
    img.onload = (): void => {
      if (cancelled) return
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      setHeatmapPainted(true)
    }
    img.onerror = (): void => {
      if (!cancelled) setHeatmapPainted(false)
    }
    img.src = dataUrl
    return (): void => {
      cancelled = true
    }
  }, [result])

  if (!result.ok) {
    return (
      <div className="stock-removal-sim" data-testid="stock-removal-sim">
        <p className="msg msg--muted" data-testid="stock-removal-sim-skip">
          {skipMessage(result)}
        </p>
      </div>
    )
  }

  const { stats, heightGrid, resolutionMm, toolDiameterMm: usedToolDia } = result

  return (
    <div className="stock-removal-sim" data-testid="stock-removal-sim">
      <h3 className="stock-removal-sim__heading">Remaining stock (voxel approximation)</h3>
      <div className="stock-removal-sim__canvas-wrap">
        <canvas
          ref={canvasRef}
          className="stock-removal-sim__canvas"
          width={STOCK_HEATMAP_WIDTH_PX}
          height={STOCK_HEATMAP_HEIGHT_PX}
          role="img"
          aria-label="Top-down heatmap of remaining stock after the toolpath"
          data-testid="stock-removal-sim-canvas"
        />
        {heatmapPainted === false ? (
          <div
            className="stock-removal-sim__canvas-fallback"
            data-testid="stock-removal-sim-canvas-fallback"
          >
            Heatmap preview unavailable in this view.
          </div>
        ) : null}
      </div>
      <dl
        className="toolpath-stats stock-removal-sim__stats"
        data-testid="stock-removal-sim-stats"
      >
        <div className="toolpath-stats__table">
          <div className="toolpath-stats__row">
            <dt className="toolpath-stats__key">Material removed</dt>
            <dd
              className="toolpath-stats__value"
              data-testid="stock-removal-sim-removed"
            >
              {formatRemovedPercent(stats.materialRemovedFraction)}
            </dd>
          </div>
          <div className="toolpath-stats__row">
            <dt className="toolpath-stats__key">Stock size</dt>
            <dd className="toolpath-stats__value" data-testid="stock-removal-sim-stock">
              {formatMm(stockBox.x)} × {formatMm(stockBox.y)} × {formatMm(stockBox.z)}
            </dd>
          </div>
          <div className="toolpath-stats__row">
            <dt className="toolpath-stats__key">Tool diameter</dt>
            <dd className="toolpath-stats__value" data-testid="stock-removal-sim-tool">
              {formatMm(usedToolDia)} {toolShape === 'ball' ? '(ball)' : '(flat)'}
            </dd>
          </div>
          <div className="toolpath-stats__row">
            <dt className="toolpath-stats__key">Voxel resolution</dt>
            <dd className="toolpath-stats__value" data-testid="stock-removal-sim-resolution">
              {resolutionMm.toFixed(2)} mm ({heightGrid.cols}×{heightGrid.rows} grid)
            </dd>
          </div>
        </div>
      </dl>
      <p className="msg msg--muted stock-removal-sim__caveat">
        Approximation only: a boolean voxel sweep of the tool envelope (flat/ball,
        no undercuts, no cutter-shape fidelity). Always verify G-code on the
        controller — use the Simulate sub-tab below for the full 3D view.
      </p>
    </div>
  )
}

export default StockRemovalHeatmap
