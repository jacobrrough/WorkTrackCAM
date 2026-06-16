import { describe, expect, it } from 'vitest'
import type { StockHeightGrid } from '../../shared/stock-simulation'
import {
  depthToHeatColor,
  renderStockHeatmapDataUrl,
  stockHeatmapRenderingAvailable,
  type StockHeatmapFailureReason
} from './stock-heatmap-canvas'

function makeGrid(over?: Partial<StockHeightGrid>): StockHeightGrid {
  return {
    cols: 2,
    rows: 2,
    cellMm: 1,
    topZ: 0,
    floorZ: -4,
    heights: new Float32Array([0, -2, -4, 0]),
    ...over
  }
}

describe('depthToHeatColor', () => {
  it('returns a valid rgba string', () => {
    expect(depthToHeatColor(0)).toMatch(/^rgba\(\d+, \d+, \d+, [\d.]+\)$/)
    expect(depthToHeatColor(1)).toMatch(/^rgba\(\d+, \d+, \d+, [\d.]+\)$/)
  })

  it('is more opaque at deeper cuts than at the surface', () => {
    const surface = depthToHeatColor(0)
    const deep = depthToHeatColor(1)
    const alphaOf = (s: string): number => Number(s.slice(s.lastIndexOf(',') + 1, -1).trim())
    expect(alphaOf(deep)).toBeGreaterThan(alphaOf(surface))
  })

  it('clamps out-of-range depth without throwing', () => {
    expect(() => depthToHeatColor(-5)).not.toThrow()
    expect(() => depthToHeatColor(99)).not.toThrow()
    expect(depthToHeatColor(-5)).toBe(depthToHeatColor(0))
    expect(depthToHeatColor(99)).toBe(depthToHeatColor(1))
  })
})

describe('renderStockHeatmapDataUrl', () => {
  it('returns null with empty-grid reason for a zero-size grid', () => {
    const failure: { reason?: StockHeatmapFailureReason } = {}
    const url = renderStockHeatmapDataUrl(
      makeGrid({ cols: 0, rows: 0, heights: new Float32Array(0) }),
      { failure }
    )
    expect(url).toBeNull()
    expect(failure.reason).toBe('empty-grid')
  })

  it('falls back gracefully when OffscreenCanvas is unavailable (node env)', () => {
    // The vitest node env has no OffscreenCanvas, so we exercise the documented
    // null-fallback branch — mirroring plate-thumbnail.ts.
    const failure: { reason?: StockHeatmapFailureReason } = {}
    const url = renderStockHeatmapDataUrl(makeGrid(), { failure })
    if (!stockHeatmapRenderingAvailable()) {
      expect(url).toBeNull()
      expect(failure.reason).toBe('no-offscreen-canvas')
    } else {
      // If a future env DOES provide OffscreenCanvas, we should get a data-URL.
      expect(url == null || url.startsWith('data:image/')).toBe(true)
    }
  })
})
