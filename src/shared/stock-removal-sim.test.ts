import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TOOL_DIAMETER_MM,
  formatRemovedPercent,
  resolveResolutionMm,
  simulateStockRemovalFromGcode,
  type StockRemovalBox
} from './stock-removal-sim'

/** Index into a row-major height grid. */
function heightAt(
  grid: { cols: number; heights: Float32Array },
  i: number,
  j: number
): number {
  return grid.heights[j * grid.cols + i]!
}

describe('simulateStockRemovalFromGcode', () => {
  const stock: StockRemovalBox = { x: 40, y: 40, z: 10 }

  // ------------------------------------------------------------------------
  // Core behaviour: carves where the tool passed, leaves stock elsewhere
  // ------------------------------------------------------------------------

  it('carves material where the tool passed', () => {
    // A single shallow feed straight across the middle of the stock. The parser
    // starts at the WCS origin (0,0,0), so the first move sweeps origin → its
    // endpoint, and the second move is the cut across the middle: 2 segments.
    const gcode = ['G1 X0 Y20 Z-2 F600', 'G1 X40 Y20 Z-2'].join('\n')
    const res = simulateStockRemovalFromGcode(gcode, stock, {
      toolDiameterMm: 6,
      resolutionMm: 1
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.stats.carvedCount).toBeGreaterThan(0)
    expect(res.stats.materialRemovedFraction).toBeGreaterThan(0)
    expect(res.stats.materialRemovedFraction).toBeLessThan(1)
    expect(res.segmentCount).toBe(2)
  })

  it('leaves stock untouched in columns the tool never reached', () => {
    // Plunge from the surface at (20,4) then cut along the y=4 row near the
    // front edge. The plunge sweeps the tool tip through the surface voxel so
    // the height map at that column drops; the back of the stock (high Y) is
    // never visited and must stay at full height. A flat tool carves voxels at
    // or BELOW its tip, so a plunge from Z=0 is required to remove the surface.
    const gcode = [
      'G1 X20 Y4 Z0 F300',
      'G1 X20 Y4 Z-3',
      'G1 X2 Y4 Z-3 F500',
      'G1 X38 Y4 Z-3'
    ].join('\n')
    const res = simulateStockRemovalFromGcode(gcode, stock, {
      toolDiameterMm: 4,
      resolutionMm: 1
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const grid = res.heightGrid
    // A far-back, far-side column must remain at full stock height (topZ = 0).
    const farI = grid.cols - 1
    const farJ = grid.rows - 1
    expect(heightAt(grid, farI, farJ)).toBeCloseTo(grid.topZ, 5)
    // ...while the plunged column on the cut line is carved BELOW the surface.
    const cutJ = Math.floor(4 / grid.cellMm)
    const cutI = Math.floor(20 / grid.cellMm)
    expect(heightAt(grid, cutI, cutJ)).toBeLessThan(grid.topZ)
  })

  it('removes more material with a larger tool diameter (monotonic)', () => {
    const gcode = ['G1 X2 Y20 Z-3 F500', 'G1 X38 Y20 Z-3'].join('\n')
    const small = simulateStockRemovalFromGcode(gcode, stock, {
      toolDiameterMm: 2,
      resolutionMm: 1
    })
    const large = simulateStockRemovalFromGcode(gcode, stock, {
      toolDiameterMm: 8,
      resolutionMm: 1
    })
    expect(small.ok && large.ok).toBe(true)
    if (!small.ok || !large.ok) return
    expect(large.stats.carvedCount).toBeGreaterThan(small.stats.carvedCount)
  })

  it('carves on rapids too (tool is physically present)', () => {
    const gcode = ['G0 X0 Y20 Z-2', 'G0 X40 Y20 Z-2'].join('\n')
    const res = simulateStockRemovalFromGcode(gcode, stock, {
      toolDiameterMm: 6,
      resolutionMm: 1
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.stats.carvedCount).toBeGreaterThan(0)
  })

  // ------------------------------------------------------------------------
  // Determinism
  // ------------------------------------------------------------------------

  it('is deterministic — identical inputs yield identical output', () => {
    const gcode = [
      'G1 X2 Y10 Z-3 F500',
      'G1 X38 Y10 Z-3',
      'G1 X38 Y30 Z-3',
      'G1 X2 Y30 Z-3'
    ].join('\n')
    const a = simulateStockRemovalFromGcode(gcode, stock, { resolutionMm: 1 })
    const b = simulateStockRemovalFromGcode(gcode, stock, { resolutionMm: 1 })
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    expect(a.stats.carvedCount).toBe(b.stats.carvedCount)
    expect(a.stats.materialRemovedFraction).toBe(b.stats.materialRemovedFraction)
    expect(a.heightGrid.cols).toBe(b.heightGrid.cols)
    expect(a.heightGrid.rows).toBe(b.heightGrid.rows)
    expect(Array.from(a.heightGrid.heights)).toEqual(Array.from(b.heightGrid.heights))
  })

  // ------------------------------------------------------------------------
  // Height grid semantics
  // ------------------------------------------------------------------------

  it('height grid dimensions match the stock footprint at the chosen resolution', () => {
    const res = simulateStockRemovalFromGcode(
      'G1 X0 Y20 Z-2 F600\nG1 X40 Y20 Z-2',
      stock,
      { resolutionMm: 2 }
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.heightGrid.cols).toBe(Math.ceil(stock.x / 2))
    expect(res.heightGrid.rows).toBe(Math.ceil(stock.y / 2))
    expect(res.heightGrid.cellMm).toBe(2)
    expect(res.heightGrid.topZ).toBeCloseTo(0, 5)
    expect(res.heightGrid.floorZ).toBeCloseTo(-stock.z, 5)
    expect(res.heightGrid.heights.length).toBe(res.heightGrid.cols * res.heightGrid.rows)
  })

  it('a column cut clean through the stock reports the floor height', () => {
    // Plunge a fat ball tool well past the bottom at one spot.
    const gcode = ['G1 X20 Y20 Z0 F300', 'G1 X20 Y20 Z-12'].join('\n')
    const res = simulateStockRemovalFromGcode(gcode, stock, {
      toolDiameterMm: 8,
      toolShape: 'ball',
      resolutionMm: 1
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const grid = res.heightGrid
    const ci = Math.floor(20 / grid.cellMm)
    const cj = Math.floor(20 / grid.cellMm)
    expect(heightAt(grid, ci, cj)).toBeCloseTo(grid.floorZ, 5)
  })

  it('preserves untouched columns at full height when only a corner is skimmed', () => {
    // Skim a small patch in the front-left corner (near the implicit WCS origin).
    // The far corner of the stock is never visited and must stay at full height,
    // proving the height map leaves un-machined stock intact.
    const gcode = ['G1 X0 Y0 Z-1 F400', 'G1 X4 Y0 Z-1', 'G1 X4 Y4 Z-1'].join('\n')
    const res = simulateStockRemovalFromGcode(gcode, stock, {
      toolDiameterMm: 4,
      resolutionMm: 2
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const grid = res.heightGrid
    // Far corner (max X, max Y) is untouched → full stock height.
    expect(heightAt(grid, grid.cols - 1, grid.rows - 1)).toBeCloseTo(grid.topZ, 5)
    // The majority of columns are untouched (only a small corner was skimmed).
    let atTop = 0
    for (const h of grid.heights) {
      if (Math.abs(h - grid.topZ) < 1e-5) atTop++
    }
    expect(atTop).toBeGreaterThan(grid.heights.length / 2)
  })

  // ------------------------------------------------------------------------
  // Skip reasons (discriminated failure)
  // ------------------------------------------------------------------------

  it('reports no-toolpath when the G-code has no motion', () => {
    const res = simulateStockRemovalFromGcode('; just a comment\nM3 S12000\nM5', stock)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.reason).toBe('no-toolpath')
  })

  it('reports no-toolpath for empty G-code', () => {
    const res = simulateStockRemovalFromGcode('', stock)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.reason).toBe('no-toolpath')
  })

  it('reports invalid-stock for a non-positive dimension', () => {
    const res = simulateStockRemovalFromGcode(
      'G1 X0 Y0 Z-1 F500\nG1 X10 Y0 Z-1',
      { x: 40, y: 0, z: 10 }
    )
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.reason).toBe('invalid-stock')
  })

  it('reports invalid-stock for a non-finite dimension', () => {
    const res = simulateStockRemovalFromGcode(
      'G1 X0 Y0 Z-1 F500\nG1 X10 Y0 Z-1',
      { x: Number.POSITIVE_INFINITY, y: 40, z: 10 }
    )
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.reason).toBe('invalid-stock')
  })

  // ------------------------------------------------------------------------
  // Defaults + arc support
  // ------------------------------------------------------------------------

  it('falls back to the default tool diameter when none is supplied', () => {
    const res = simulateStockRemovalFromGcode(
      'G1 X0 Y20 Z-2 F600\nG1 X40 Y20 Z-2',
      stock,
      { resolutionMm: 1 }
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.toolDiameterMm).toBe(DEFAULT_TOOL_DIAMETER_MM)
  })

  it('parses G2/G3 arcs into carving segments', () => {
    // Full-circle-ish arc — interpolated into many sub-segments by the parser.
    const gcode = ['G1 X10 Y20 Z-2 F400', 'G2 X30 Y20 Z-2 I10 J0'].join('\n')
    const res = simulateStockRemovalFromGcode(gcode, stock, {
      toolDiameterMm: 4,
      resolutionMm: 1
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    // Arc expands to >1 segment, so the total is well above the 1 explicit G1.
    expect(res.segmentCount).toBeGreaterThan(2)
    expect(res.stats.carvedCount).toBeGreaterThan(0)
  })
})

describe('resolveResolutionMm', () => {
  it('clamps tiny parts to the minimum resolution', () => {
    const r = resolveResolutionMm({ x: 2, y: 2, z: 2 })
    expect(r).toBe(0.5)
  })

  it('stays within the clamp range for a large full sheet', () => {
    // Laguna full-sheet plywood (1524 × 3048 × 18 mm).
    const r = resolveResolutionMm({ x: 1524, y: 3048, z: 18 })
    expect(r).toBeGreaterThanOrEqual(0.5)
    expect(r).toBeLessThanOrEqual(8)
  })

  it('clamps a high-volume block to the maximum resolution', () => {
    // A bulky block whose volume blows well past the budget → max-out the cell.
    const r = resolveResolutionMm({ x: 2000, y: 2000, z: 2000 })
    expect(r).toBe(8)
  })

  it('is deterministic for a given box', () => {
    const box = { x: 200, y: 150, z: 40 }
    expect(resolveResolutionMm(box)).toBe(resolveResolutionMm(box))
  })

  it('keeps the resulting grid under the engine voxel ceiling', () => {
    const box = { x: 360, y: 240, z: 140 } // Makera Carvera 3-axis envelope
    const r = resolveResolutionMm(box)
    const cells = Math.ceil(box.x / r) * Math.ceil(box.y / r) * Math.ceil(box.z / r)
    expect(cells).toBeLessThan(16_000_000)
  })
})

describe('formatRemovedPercent', () => {
  it('formats a fraction as a whole-number percent', () => {
    expect(formatRemovedPercent(0.4213)).toBe('42%')
    expect(formatRemovedPercent(0)).toBe('0%')
    expect(formatRemovedPercent(1)).toBe('100%')
  })

  it('clamps out-of-range and non-finite input', () => {
    expect(formatRemovedPercent(1.5)).toBe('100%')
    expect(formatRemovedPercent(-0.2)).toBe('0%')
    expect(formatRemovedPercent(Number.NaN)).toBe('0%')
  })
})
