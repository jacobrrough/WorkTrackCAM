/**
 * Pin tests for the Laguna nesting UI/IPC wiring (Gap #9 v1).
 *
 * These tests read the source files directly and assert the load-bearing
 * lines stay in place. They catch regressions in:
 *  1. The My-Shop-Only Laguna gate on the renderer panel.
 *  2. The IPC handler registration string + plumbing.
 *  3. The preload bridge being declared.
 *  4. The renderer Apply-Layout writing back onto `params.placement`.
 *
 * Style mirrors `src/main/calibration/calibration-ipc-pin.test.ts`.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPO_ROOT = resolve(__dirname, '..', '..', '..')

const PANEL_SRC = readFileSync(
  resolve(REPO_ROOT, 'src', 'renderer', 'manufacture', 'LagunaNestingPanel.tsx'),
  'utf-8'
)
const WORKSPACE_SRC = readFileSync(
  resolve(REPO_ROOT, 'src', 'renderer', 'manufacture', 'ManufactureWorkspace.tsx'),
  'utf-8'
)
const IPC_SRC = readFileSync(
  resolve(REPO_ROOT, 'src', 'main', 'ipc-fabrication.ts'),
  'utf-8'
)
const PRELOAD_SRC = readFileSync(
  resolve(REPO_ROOT, 'src', 'preload', 'index.ts'),
  'utf-8'
)
const SHOP_TYPES_SRC = readFileSync(
  resolve(REPO_ROOT, 'src', 'renderer', 'src', 'shop-types.ts'),
  'utf-8'
)
const MODULE_SRC = readFileSync(
  resolve(REPO_ROOT, 'src', 'main', 'nesting', 'true-shape-v1.ts'),
  'utf-8'
)

describe('Schema compatibility: nested placement fields parse under the existing manufacture schema', () => {
  it('manufactureFileSchema accepts cnc_contour params with scalar placement* fields', async () => {
    const { manufactureFileSchema } = await import('../../shared/manufacture-schema')
    const payload = {
      version: 1 as const,
      setups: [],
      operations: [
        {
          id: 'op-1',
          kind: 'cnc_contour' as const,
          label: 'Contour with placement',
          sourceMesh: 'assets/p.stl',
          params: {
            contourPoints: [[0, 0], [10, 0], [10, 10], [0, 10]],
            placementXMm: 25,
            placementYMm: 40,
            placementRotationDeg: 90,
            placementNestVersion: 'v1'
          }
        }
      ]
    }
    expect(() => manufactureFileSchema.parse(payload)).not.toThrow()
  })
})

describe('A. Nesting module integrity (Gap #9 v1)', () => {
  it('A1: exports nestPolygonsOnSheet + Polygon + SheetSpec + NestResult + Placement', () => {
    expect(MODULE_SRC).toMatch(/export\s+function\s+nestPolygonsOnSheet\b/)
    expect(MODULE_SRC).toMatch(/export\s+interface\s+Polygon\b/)
    expect(MODULE_SRC).toMatch(/export\s+interface\s+SheetSpec\b/)
    expect(MODULE_SRC).toMatch(/export\s+interface\s+NestResult\b/)
    expect(MODULE_SRC).toMatch(/export\s+interface\s+Placement\b/)
  })

  it('A2: documents v1 honesty + v2 upgrade path (no library port = no license risk)', () => {
    expect(MODULE_SRC).toMatch(/v1/i)
    expect(MODULE_SRC).toMatch(/v2/i)
    expect(MODULE_SRC).toMatch(/bottom-left-fill|BLF/i)
    expect(MODULE_SRC).toMatch(/Deepnest|SVGnest|NFP/)
    // Explicit "written from scratch" license note guarding against silent ports.
    expect(MODULE_SRC).toMatch(/written from scratch|no external library|no upstream/i)
  })

  it('A3: explicitly invokes Safety Rule 1 — placements only, never G-code', () => {
    expect(MODULE_SRC).toMatch(/G-code is sacred|placements only|no G-code|emits no G-code/i)
  })
})

describe('B. IPC handler registration (nesting:nest-polygons)', () => {
  it('B1: registers the channel', () => {
    expect(IPC_SRC).toContain("'nesting:nest-polygons'")
  })

  it('B2: imports the nesting module', () => {
    expect(IPC_SRC).toContain("from './nesting/true-shape-v1'")
    expect(IPC_SRC).toContain('nestPolygonsOnSheet')
  })

  it('B3: validates payload shape and reports specific error codes', () => {
    expect(IPC_SRC).toContain('invalid_payload')
    expect(IPC_SRC).toContain('invalid_parts')
    expect(IPC_SRC).toContain('invalid_sheet')
    expect(IPC_SRC).toContain('nesting_failed')
  })
})

describe('C. Preload bridge + shop-types declaration', () => {
  it('C1: preload declares nestingNestPolygons + invokes the channel', () => {
    expect(PRELOAD_SRC).toContain('nestingNestPolygons')
    expect(PRELOAD_SRC).toContain("ipcRenderer.invoke('nesting:nest-polygons'")
  })

  it('C2: shop-types declares the typed bridge for the renderer', () => {
    expect(SHOP_TYPES_SRC).toContain('nestingNestPolygons')
    expect(SHOP_TYPES_SRC).toContain('rotationDeg')
  })
})

describe('D. LagunaNestingPanel renderer wiring', () => {
  it('D1: ManufactureWorkspace imports LagunaNestingPanel', () => {
    expect(WORKSPACE_SRC).toContain("from './LagunaNestingPanel'")
    expect(WORKSPACE_SRC).toContain('LagunaNestingPanel')
  })

  it('D2: panel is gated by My-Shop-Only Laguna check (hard constraint)', () => {
    // Laguna machine id must be present.
    expect(PANEL_SRC).toContain("'laguna-swift-5x10'")
    // The component must early-return for any other machine.
    expect(PANEL_SRC).toMatch(/activeMachineId\s*!==\s*LAGUNA_MACHINE_ID/)
    expect(PANEL_SRC).toMatch(/return\s+null/)
  })

  it('D3: panel renders the "Nest parts on stock" button', () => {
    expect(PANEL_SRC).toContain('Nest parts on stock')
  })

  it('D4: panel renders the Apply layout button + utilisation summary', () => {
    expect(PANEL_SRC).toContain('Apply layout')
    expect(PANEL_SRC).toMatch(/utilization/i)
    expect(PANEL_SRC).toMatch(/Placed:/)
    expect(PANEL_SRC).toMatch(/Unplaced:/)
  })

  it('D5: panel calls window.fab.nestingNestPolygons', () => {
    expect(PANEL_SRC).toContain('nestingNestPolygons')
  })

  it('D6: workspace defines applyNestingPlacements writing scalar placement* fields on params', () => {
    expect(WORKSPACE_SRC).toContain('applyNestingPlacements')
    // Scalar fields chosen to stay inside the JsonSafeValue contract — no
    // schema migration needed and existing manufacture.json files parse cleanly.
    expect(WORKSPACE_SRC).toMatch(/placementXMm/)
    expect(WORKSPACE_SRC).toMatch(/placementYMm/)
    expect(WORKSPACE_SRC).toMatch(/placementRotationDeg/)
    // The v1 nest version stamp lets future v2 layouts diff cleanly.
    expect(WORKSPACE_SRC).toMatch(/placementNestVersion\s*=\s*['"]v1['"]/)
    // Must only mutate cnc_contour ops (Safety Rule 1: don't touch other op kinds).
    expect(WORKSPACE_SRC).toMatch(/op\.kind\s*!==?\s*['"]cnc_contour['"]/)
  })

  it('D7: workspace derives the sheet size from the Laguna setup stock (with default fallback)', () => {
    expect(WORKSPACE_SRC).toContain('lagunaSheetSizeMm')
    expect(WORKSPACE_SRC).toMatch(/sheetWidthMm=\{lagunaSheetSizeMm\.widthMm\}/)
    expect(WORKSPACE_SRC).toMatch(/sheetHeightMm=\{lagunaSheetSizeMm\.heightMm\}/)
  })
})
