/**
 * ManufactureHost wiring pins — the two "coming soon" stubs are now wired to
 * real, existing surfaces:
 *
 *   1. Tool import — `handleImportTools` / `handleImportToolLibraryFromFile`
 *      now drive the SAME import pipeline Utilities → Library uses
 *      (`dialog:openFile` → `tools:importFile` / `machineTools:importFile`),
 *      not a "coming soon" toast.
 *   2. Auto-arrange — `arrange` now runs the host's `handleArrangeParts`, which
 *      drives the EXISTING true-shape nesting engine (`nesting:nestPolygons`,
 *      the same engine the LagunaNestingPanel uses) over the active plate's
 *      nestable contour ops, not a toast.
 *
 * This file pins:
 *   - the PURE `extractNestableParts` behavior (its own unit suite — the
 *     polygon collection that feeds the nesting engine), and
 *   - the WIRING (source pins, mirroring nesting-placement-stamps.test.ts):
 *     the host source no longer toasts a "coming soon" advisory for tool
 *     import or auto-arrange, and instead calls the real IPCs.
 *
 * Auto-orient is DELIBERATELY left as an honest advisory: FDM auto-orient
 * needs overhang-minimizing mesh analysis the host cannot do without new,
 * un-tested mesh code (the rotary `placementLayFlat` helper needs a part AABB
 * the FDM plate part does not carry). The pin below asserts that honest state.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { extractNestableParts, type NestablePart } from '../ManufactureHost'
import type { ManufactureOperation } from '../../../shared/manufacture-schema'

const HOST_SRC = readFileSync(
  resolve(__dirname, '..', 'ManufactureHost.tsx'),
  'utf-8'
)

function op(over: Partial<ManufactureOperation> = {}): ManufactureOperation {
  return { id: 'op-1', kind: 'cnc_contour', label: 'Contour 1', ...over }
}

const SQUARE: Array<[number, number]> = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10]
]

describe('extractNestableParts (pure nesting-input collector)', () => {
  it('collects one polygon per cnc_contour op with a closed contourPoints loop', () => {
    const parts = extractNestableParts([
      op({ id: 'a', params: { contourPoints: SQUARE } }),
      op({ id: 'b', params: { contourPoints: SQUARE } })
    ])
    expect(parts.map((p) => p.id)).toEqual(['a', 'b'])
    expect(parts[0]!.points).toHaveLength(4)
  })

  it('keys each part by the op id so placements map back unambiguously', () => {
    const parts = extractNestableParts([op({ id: 'contour-xyz', params: { contourPoints: SQUARE } })])
    expect(parts).toHaveLength(1)
    expect(parts[0]!.id).toBe('contour-xyz')
  })

  it('ignores non-cnc_contour ops (mesh / pocket / slice carry no contour outline)', () => {
    const parts = extractNestableParts([
      op({ id: 'pocket', kind: 'cnc_pocket', params: { contourPoints: SQUARE } }),
      op({ id: 'slice', kind: 'fdm_slice', sourceMesh: 'assets/x.stl' }),
      op({ id: 'contour', kind: 'cnc_contour', params: { contourPoints: SQUARE } })
    ])
    expect(parts.map((p) => p.id)).toEqual(['contour'])
  })

  it('skips suppressed contour ops', () => {
    const parts = extractNestableParts([
      op({ id: 'on', params: { contourPoints: SQUARE } }),
      op({ id: 'off', suppressed: true, params: { contourPoints: SQUARE } })
    ])
    expect(parts.map((p) => p.id)).toEqual(['on'])
  })

  it('skips contours with fewer than 3 points (not a closed loop)', () => {
    const parts = extractNestableParts([
      op({ id: 'line', params: { contourPoints: [[0, 0], [10, 0]] } }),
      op({ id: 'tri', params: { contourPoints: [[0, 0], [10, 0], [5, 8]] } })
    ])
    expect(parts.map((p) => p.id)).toEqual(['tri'])
  })

  it('drops malformed point entries but keeps the valid ones (>=3 survive)', () => {
    const parts = extractNestableParts([
      op({
        id: 'mixed',
        params: {
          contourPoints: [
            [0, 0],
            ['bad', 1],
            [10, 0],
            [10, 10],
            null,
            [0, 10]
          ]
        }
      })
    ])
    expect(parts).toHaveLength(1)
    // The 4 well-formed [number, number] entries survive.
    expect(parts[0]!.points).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10]
    ])
  })

  it('returns an empty list when there are no nestable parts', () => {
    const empty: NestablePart[] = extractNestableParts([
      op({ id: 'slice', kind: 'fdm_slice', sourceMesh: 'assets/x.stl' })
    ])
    expect(empty).toEqual([])
  })
})

describe('Tool import is wired to the real Library import IPC (no "coming soon")', () => {
  it('removed the "coming soon" tool-import advisory entirely', () => {
    expect(HOST_SRC).not.toContain('TOOL_IMPORT_ADVISORY')
    expect(HOST_SRC).not.toContain('Tool import from the new shell is coming')
  })

  it('opens the same tool-library file picker the Library view uses', () => {
    expect(HOST_SRC).toContain('TOOL_LIBRARY_FILE_FILTERS')
    expect(HOST_SRC).toContain("{ name: 'Tool Libraries', extensions: ['json', 'csv', 'tools'] }")
    expect(HOST_SRC).toMatch(/fab\(\)\.dialogOpenFile\(\[\.\.\.TOOL_LIBRARY_FILE_FILTERS\]\)/)
  })

  it('imports through tools:importFile (global) or machineTools:importFile (per-machine)', () => {
    expect(HOST_SRC).toMatch(/fab\(\)\.machineToolsImportFile\(cncMachineId, path\)/)
    expect(HOST_SRC).toMatch(/fab\(\)\.toolsImportFile\('default', path\)/)
  })

  it('both workspace tool-import entry points map onto the single reused pipeline', () => {
    expect(HOST_SRC).toContain('const handleImportTools = importToolLibrary')
    expect(HOST_SRC).toContain('const handleImportToolLibraryFromFile = importToolLibrary')
  })
})

describe('Auto-arrange is wired to the existing nesting engine (no "coming soon")', () => {
  it('removed the "Auto-arrange is coming" advisory', () => {
    expect(HOST_SRC).not.toContain('Auto-arrange is coming')
  })

  it('the FDM arrange action calls the host arrange routine, not a toast', () => {
    expect(HOST_SRC).toMatch(/arrange: \(\) => handleArrangeParts\(\)/)
  })

  it('handleArrangeParts feeds extractNestableParts into the real nesting IPC', () => {
    expect(HOST_SRC).toContain('const parts = extractNestableParts(plate.operations)')
    expect(HOST_SRC).toMatch(/fab\(\)\.nestingNestPolygons\(/)
    // Drives the same NFP true-shape engine the LagunaNestingPanel uses.
    expect(HOST_SRC).toContain("engine: 'nfp'")
  })

  it('reports placed/utilization from the engine result (placements, not a stub)', () => {
    expect(HOST_SRC).toContain('const placed = r.placements.length')
    expect(HOST_SRC).toContain('r.utilizationPct')
  })
})

describe('Auto-orient is deliberately deferred (honest advisory retained)', () => {
  it('still surfaces the honest "Auto-orient is coming" advisory (no un-tested mesh code)', () => {
    expect(HOST_SRC).toContain('Auto-orient is coming')
    expect(HOST_SRC).toMatch(/autoOrient: \(\) => pushToast\('warn', 'Auto-orient is coming/)
  })
})
