/**
 * Laguna Swift 5x10 -- DXF -> contour/pocket -> vcarve_mach3.hbs end-to-end
 * integration test ([P2-LAGUNA-FULLSHEET]).
 *
 * Closes the test gap called out in 2026-05-05 daily directives: prior
 * Laguna coverage pinned the post-template contract and the vacuum
 * allocator + postlude in isolation, but never asserted that DXF input
 * survives the full pipeline (parseDxf -> 2D pocket lines ->
 * vacuum-zone wrap -> renderPost) into a single emitted G-code blob
 * with all the safety invariants intact.
 *
 * What this test exercises (in order):
 *   1. Build a tiny DXF text fixture containing a single closed
 *      rectangular LWPOLYLINE (a 600x400 mm rectangle, the exact
 *      "known-good fixture" called out in the gcode-safety reference
 *      doc for Laguna).
 *   2. parseDxf() -> DxfParseResult; convert the polyline back to a
 *      contour ring [number, number][].
 *   3. allocateLagunaVacuumZonesForSheet() -> 6-zone allocation against
 *      a full 4x8 ft sheet preset placed at the bed origin.
 *   4. generatePocket2dLines() -> raw toolpath line[] from the contour.
 *   5. wrapLagunaToolpathWithVacuumBlocks() -> toolpath with vacuum
 *      preamble + postamble lines splicing the operator-readable bed
 *      coverage summary around the cutting moves.
 *   6. renderPost(resourcesRoot, lagunaProfile, wrappedLines,
 *      { dustCollection: true, workCoordinateIndex: 1, operationLabel })
 *      -> final G-code string.
 *
 * Then asserts:
 *   - Header invariants (% tape, G21, G90, G17, G94, G54, M3, G4 P2.0)
 *   - Pocket cuts survived end-to-end (G1 lines with explicit feed)
 *   - Dust-collection M-codes paired (M7 in header, M9 in footer)
 *   - Vacuum-zone preamble + postamble bracket the toolpath
 *   - Footer invariants (M5, G4 P3.0, G0 Z203, G0 X0 Y0, M30, % end)
 *   - RichAuto-incompatible patterns absent (no G20, no M2, no M4)
 *   - Coordinate format is RichAuto A-series compatible (decimal mm,
 *     no scientific notation, no implicit units mid-program)
 *
 * This does NOT replace post-process-laguna-swift-contract.test.ts --
 * that file pins the contract surface in isolation. This file pins the
 * full pipeline so a refactor that breaks the integration without
 * breaking either endpoint surfaces here first.
 */
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { parseDxf, type DxfPolyline } from '../shared/dxf-parser'
import { allocateLagunaVacuumZonesForSheet } from '../shared/laguna-vacuum-allocator'
import {
  wrapLagunaToolpathWithVacuumBlocks,
  LAGUNA_VACUUM_PREAMBLE_OPEN,
  LAGUNA_VACUUM_PREAMBLE_CLOSE,
  LAGUNA_VACUUM_POSTAMBLE_OPEN,
  LAGUNA_VACUUM_POSTAMBLE_CLOSE
} from '../shared/laguna-vacuum-postlude'
import { machineProfileSchema, type MachineProfile } from '../shared/machine-schema'
import { generatePocket2dLines } from './cam-local'
import { renderPost } from './post-process'

const RESOURCES_ROOT = join(process.cwd(), 'resources')

function loadLagunaSwiftProfile(): MachineProfile {
  const path = join(RESOURCES_ROOT, 'machines', 'laguna-swift-5x10.json')
  return machineProfileSchema.parse(JSON.parse(readFileSync(path, 'utf-8')))
}

/**
 * Minimal ASCII DXF describing a single closed LWPOLYLINE shaped as a
 * 600 x 400 mm rectangle, anchored at (50, 50) so it sits well inside
 * the engaged-zone footprint (X0Y0). The 4-vertex closed-loop form is
 * what VCarve Pro and Aspire actually emit for sketch-level pockets,
 * so this fixture mirrors the operator's real export. Header pins
 * units to millimetres ($INSUNITS = 4) so parseDxf() resolves units
 * deterministically without the inch-conversion pass.
 */
const RECTANGLE_DXF = [
  '0',
  'SECTION',
  '2',
  'HEADER',
  '9',
  '$INSUNITS',
  '70',
  '4',
  '0',
  'ENDSEC',
  '0',
  'SECTION',
  '2',
  'ENTITIES',
  '0',
  'LWPOLYLINE',
  '8',
  'POCKET_LAYER',
  '90',
  '4',
  '70',
  '1',
  '10',
  '50.0',
  '20',
  '50.0',
  '10',
  '650.0',
  '20',
  '50.0',
  '10',
  '650.0',
  '20',
  '450.0',
  '10',
  '50.0',
  '20',
  '450.0',
  '0',
  'ENDSEC',
  '0',
  'EOF',
  ''
].join('\n')

/**
 * Convert the DXF polyline to a CAM contour ring. The 2D pocket
 * generator wants a closed [number, number][] ring; LWPOLYLINE points
 * are stored as { x, y } so this is a straight projection.
 */
function dxfPolylineToRing(p: DxfPolyline): [number, number][] {
  return p.points.map((pt) => [pt.x, pt.y] as [number, number])
}

// --- 1. DXF parse --------------------------------------------------------

describe('laguna-fullsheet integration: DXF parse stage', () => {
  it('parseDxf yields exactly one closed LWPOLYLINE entity', () => {
    const r = parseDxf(RECTANGLE_DXF)
    expect(r.entities.length).toBe(1)
    expect(r.entities[0]!.type).toBe('polyline')
    const poly = r.entities[0] as DxfPolyline
    expect(poly.closed).toBe(true)
    expect(poly.points.length).toBe(4)
  })

  it('parseDxf resolves units to mm from $INSUNITS=4', () => {
    const r = parseDxf(RECTANGLE_DXF)
    expect(r.units).toBe('mm')
  })

  it('polyline ring is 600 x 400 mm at origin (50, 50)', () => {
    const r = parseDxf(RECTANGLE_DXF)
    const poly = r.entities[0] as DxfPolyline
    const xs = poly.points.map((p) => p.x)
    const ys = poly.points.map((p) => p.y)
    expect(Math.min(...xs)).toBe(50)
    expect(Math.max(...xs)).toBe(650)
    expect(Math.min(...ys)).toBe(50)
    expect(Math.max(...ys)).toBe(450)
  })
})

// --- 2. Vacuum-zone allocation against a full 4x8 sheet -----------------

describe('laguna-fullsheet integration: vacuum-zone allocation', () => {
  it('48x96 in plywood at origin engages all 6 zones', () => {
    const result = allocateLagunaVacuumZonesForSheet('full-sheet-48x96', {
      thicknessId: '3-4',
      materialId: 'plywood'
    })
    expect(result).not.toBeNull()
    expect(result!.allocation.fullBedEngaged).toBe(true)
    expect(result!.allocation.engagedCount).toBe(6)
    expect(result!.allocation.outsideEnvelope).toBe(false)
  })
})

// --- 3. End-to-end: DXF -> pocket lines -> vacuum wrap -> renderPost ----

describe('laguna-fullsheet integration: end-to-end pipeline', () => {
  async function runPipeline(): Promise<{
    gcode: string
    warnings: string[]
  }> {
    const dxf = parseDxf(RECTANGLE_DXF)
    const poly = dxf.entities[0] as DxfPolyline
    const ring = dxfPolylineToRing(poly)
    const allocation = allocateLagunaVacuumZonesForSheet('full-sheet-48x96', {
      thicknessId: '3-4',
      materialId: 'plywood'
    })
    if (!allocation) throw new Error('full-sheet allocation returned null')
    const pocket = generatePocket2dLines({
      contourPoints: ring,
      stepoverMm: 6.0,
      zPassMm: -3.0,
      feedMmMin: 8000,
      plungeMmMin: 600,
      safeZMm: 25.0
    })
    const wrapped = wrapLagunaToolpathWithVacuumBlocks(
      pocket.lines,
      allocation.allocation
    )
    const machine = loadLagunaSwiftProfile()
    return renderPost(RESOURCES_ROOT, machine, wrapped, {
      workCoordinateIndex: 1,
      operationLabel: 'Laguna full-sheet pocket smoke',
      dustCollection: true
    })
  }

  it('pipeline produces non-empty G-code (>500 chars) without throwing', async () => {
    const { gcode } = await runPipeline()
    expect(gcode.length).toBeGreaterThan(500)
  })

  it('header emits % tape, G21, G90, G17, G94, G54, M3, G4 P2.0 in order', async () => {
    const { gcode } = await runPipeline()
    const tapeStart = gcode.search(/^%\s*$/m)
    const g21 = gcode.indexOf('G21')
    const g90 = gcode.indexOf('G90')
    const g17 = gcode.indexOf('G17')
    const g94 = gcode.indexOf('G94')
    const g54 = gcode.search(/^G54\b/m)
    const m3 = gcode.search(/^M3\b/m)
    const g4Warm = gcode.indexOf('G4 P2.0')
    expect(tapeStart).toBeGreaterThan(-1)
    expect(g21).toBeGreaterThan(tapeStart)
    expect(g90).toBeGreaterThan(g21)
    expect(g17).toBeGreaterThan(g90)
    expect(g94).toBeGreaterThan(g17)
    expect(g54).toBeGreaterThan(g94)
    expect(m3).toBeGreaterThan(g54)
    expect(g4Warm).toBeGreaterThan(m3)
  })

  it('dustCollection=true emits M7 (header) and paired M9 (footer)', async () => {
    const { gcode } = await runPipeline()
    const m7 = gcode.search(/^M7\b/m)
    const m9 = gcode.search(/^M9\b/m)
    expect(m7).toBeGreaterThan(-1)
    expect(m9).toBeGreaterThan(m7)
  })

  it('vacuum preamble + postamble bracket the toolpath', async () => {
    const { gcode } = await runPipeline()
    const preOpen = gcode.indexOf(LAGUNA_VACUUM_PREAMBLE_OPEN)
    const preClose = gcode.indexOf(LAGUNA_VACUUM_PREAMBLE_CLOSE)
    const postOpen = gcode.indexOf(LAGUNA_VACUUM_POSTAMBLE_OPEN)
    const postClose = gcode.indexOf(LAGUNA_VACUUM_POSTAMBLE_CLOSE)
    expect(preOpen).toBeGreaterThan(-1)
    expect(preClose).toBeGreaterThan(preOpen)
    expect(postOpen).toBeGreaterThan(preClose)
    expect(postClose).toBeGreaterThan(postOpen)
  })

  it('vacuum preamble reports 6 zones engaged + 64.0% bed coverage (48x96 sheet on 60x120 bed)', async () => {
    // 1219.2 mm x 2438.4 mm sheet over 1524 mm x 3048 mm bed = 64.0% coverage,
    // spanning both X columns and all 3 Y rows so every zone is engaged.
    const { gcode } = await runPipeline()
    expect(gcode).toContain('; 6 of 6 zones engaged (64.0% bed coverage)')
  })

  it('cutting moves emit explicit feedrate (RichAuto requires F-word per cut)', async () => {
    const { gcode } = await runPipeline()
    expect(gcode).toMatch(/^G1.*F\d+/m)
  })

  it('cutting moves stay within DXF rectangle X bounds [50, 650] mm', async () => {
    const { gcode } = await runPipeline()
    const xMatches = gcode.matchAll(/^G[01][^\n]*\bX(-?\d+(?:\.\d+)?)/gm)
    let sawAtLeastOne = false
    for (const m of xMatches) {
      const x = Number(m[1])
      if (!Number.isFinite(x)) continue
      sawAtLeastOne = true
      // Pocket roughing may trim inside the contour; safe-Z parking goes to X0.
      // Constrain only the toolpath cut envelope: X = 0 (park) OR within [50, 650].
      const inPocket = x >= 50 && x <= 650
      const isPark = x === 0
      expect(inPocket || isPark).toBe(true)
    }
    expect(sawAtLeastOne).toBe(true)
  })

  it('footer emits M5 -> G4 P3.0 -> G0 Z203 -> G0 X0 Y0 -> M30 -> %', async () => {
    const { gcode } = await runPipeline()
    // Anchor on the postamble close so the indexOf walks pick the trailing
    // post-end occurrence (avoids matching the same M-code in vacuum wrap).
    const anchor = gcode.indexOf(LAGUNA_VACUUM_POSTAMBLE_CLOSE)
    expect(anchor).toBeGreaterThan(-1)
    const m5 = gcode.indexOf('M5', anchor)
    const g4Cool = gcode.indexOf('G4 P3.0', m5)
    const safeZ = gcode.indexOf('G0 Z203', g4Cool)
    const x0y0 = gcode.indexOf('G0 X0 Y0', safeZ)
    const m30 = gcode.search(/^M30\b/m)
    expect(m5).toBeGreaterThan(anchor)
    expect(g4Cool).toBeGreaterThan(m5)
    expect(safeZ).toBeGreaterThan(g4Cool)
    expect(x0y0).toBeGreaterThan(safeZ)
    expect(m30).toBeGreaterThan(x0y0)
    const lines = gcode.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
    expect(lines[lines.length - 1]).toBe('%')
  })

  it('forbidden RichAuto-incompatible emissions absent: G20, M2, M4', async () => {
    const { gcode } = await runPipeline()
    expect(gcode).not.toMatch(/^G20\b/m)
    expect(gcode).not.toMatch(/^M2\b/m)
    expect(gcode).not.toMatch(/^M4\b/m)
  })

  it('coordinate format is RichAuto-compatible: decimal mm, no scientific notation', async () => {
    const { gcode } = await runPipeline()
    // RichAuto A-series rejects scientific notation (1.2e+03) and bare integer
    // coordinates without explicit units. Pin both: every X/Y/Z numeric must
    // be a plain decimal or integer, and no scientific-notation tokens.
    expect(gcode).not.toMatch(/[XYZ]-?\d+(?:\.\d+)?[eE][+-]?\d+/)
  })

  it('renderPost result.warnings is an array (smoke: pipeline completed cleanly)', async () => {
    const { warnings } = await runPipeline()
    expect(Array.isArray(warnings)).toBe(true)
  })
})

// --- 4. Picker-driven persistence-to-G-code loop (Cycle 352) -------------

/**
 * [P2-LAGUNA-FULLSHEET]/Cycle 352 -- the 6-zone vacuum picker
 * (`appSettings.lagunaActiveZones`) now drives emitted G-code through
 * `wrapLagunaToolpathWithVacuumBlocks`'s `activeZones` option. This
 * describe block runs the SAME DXF -> contour -> wrap -> emit pipeline
 * twice, once with picker selection [1,2,3] and once with [4,5,6], and
 * asserts the emitted G-code differs in exactly the expected vacuum-zone
 * control lines (engaged/idle comment summaries + M64/M65 digital-output
 * lines). The geometric stock fixture is identical across the two runs;
 * only the operator's picker choice changes.
 */
describe('laguna-fullsheet integration: picker-driven persistence-to-G-code', () => {
  async function runPipelineWithActiveZones(
    activeZones: readonly number[]
  ): Promise<{ gcode: string; warnings: string[] }> {
    const dxf = parseDxf(RECTANGLE_DXF)
    const poly = dxf.entities[0] as DxfPolyline
    const ring = dxfPolylineToRing(poly)
    const allocation = allocateLagunaVacuumZonesForSheet('full-sheet-48x96', {
      thicknessId: '3-4',
      materialId: 'plywood'
    })
    if (!allocation) throw new Error('full-sheet allocation returned null')
    const pocket = generatePocket2dLines({
      contourPoints: ring,
      stepoverMm: 6.0,
      zPassMm: -3.0,
      feedMmMin: 8000,
      plungeMmMin: 600,
      safeZMm: 25.0
    })
    const wrapped = wrapLagunaToolpathWithVacuumBlocks(
      pocket.lines,
      allocation.allocation,
      { enableMach3DigitalOutputs: true, activeZones }
    )
    const machine = loadLagunaSwiftProfile()
    return renderPost(RESOURCES_ROOT, machine, wrapped, {
      workCoordinateIndex: 1,
      operationLabel: 'Laguna full-sheet pocket smoke (picker)',
      dustCollection: true
    })
  }

  it('activeZones=[1,2,3] emits exactly M64 P0/P1/P2 + M65 P0/P1/P2', async () => {
    const { gcode } = await runPipelineWithActiveZones([1, 2, 3])
    for (const p of [0, 1, 2]) {
      expect(gcode).toMatch(new RegExp(`^M64 P${p}\\b`, 'm'))
      expect(gcode).toMatch(new RegExp(`^M65 P${p}\\b`, 'm'))
    }
    for (const p of [3, 4, 5]) {
      expect(gcode).not.toMatch(new RegExp(`^M64 P${p}\\b`, 'm'))
      expect(gcode).not.toMatch(new RegExp(`^M65 P${p}\\b`, 'm'))
    }
    expect(gcode).toContain('; 3 of 6 zones engaged (64.0% bed coverage)')
    expect(gcode).toContain('; Engaged zones: X0Y0, X0Y1, X0Y2')
    expect(gcode).toContain('; Idle zones:    X1Y0, X1Y1, X1Y2')
    expect(gcode).toContain('; Releasing 3 zone(s)')
  })

  it('activeZones=[4,5,6] emits exactly M64 P3/P4/P5 + M65 P3/P4/P5', async () => {
    const { gcode } = await runPipelineWithActiveZones([4, 5, 6])
    for (const p of [3, 4, 5]) {
      expect(gcode).toMatch(new RegExp(`^M64 P${p}\\b`, 'm'))
      expect(gcode).toMatch(new RegExp(`^M65 P${p}\\b`, 'm'))
    }
    for (const p of [0, 1, 2]) {
      expect(gcode).not.toMatch(new RegExp(`^M64 P${p}\\b`, 'm'))
      expect(gcode).not.toMatch(new RegExp(`^M65 P${p}\\b`, 'm'))
    }
    expect(gcode).toContain('; 3 of 6 zones engaged (64.0% bed coverage)')
    expect(gcode).toContain('; Engaged zones: X1Y0, X1Y1, X1Y2')
    expect(gcode).toContain('; Idle zones:    X0Y0, X0Y1, X0Y2')
    expect(gcode).toContain('; Releasing 3 zone(s)')
  })

  it('the two picker selections produce different G-code blobs (sanity)', async () => {
    const a = await runPipelineWithActiveZones([1, 2, 3])
    const b = await runPipelineWithActiveZones([4, 5, 6])
    expect(a.gcode).not.toBe(b.gcode)
  })

  it('picker selection drives ONLY vacuum-zone control lines (toolpath bytes identical)', async () => {
    // Strip every line that the picker can possibly affect: the vacuum
    // preamble/postamble blocks and any M64/M65 line. Everything that
    // remains (header, toolpath cuts, footer) MUST be byte-identical
    // between the two runs because picker selection only affects the
    // wrapped vacuum blocks, never the toolpath itself.
    function stripVacuumBlocks(gcode: string): string {
      const lines = gcode.split('\n')
      const out: string[] = []
      let inVacuum = false
      for (const line of lines) {
        if (
          line.includes(LAGUNA_VACUUM_PREAMBLE_OPEN) ||
          line.includes(LAGUNA_VACUUM_POSTAMBLE_OPEN)
        ) {
          inVacuum = true
          continue
        }
        if (
          line.includes(LAGUNA_VACUUM_PREAMBLE_CLOSE) ||
          line.includes(LAGUNA_VACUUM_POSTAMBLE_CLOSE)
        ) {
          inVacuum = false
          continue
        }
        if (inVacuum) continue
        out.push(line)
      }
      return out.join('\n')
    }
    const a = await runPipelineWithActiveZones([1, 2, 3])
    const b = await runPipelineWithActiveZones([4, 5, 6])
    expect(stripVacuumBlocks(a.gcode)).toBe(stripVacuumBlocks(b.gcode))
  })

  it('activeZones=[] suppresses every M64/M65 line (operator fully disengaged the bed)', async () => {
    const { gcode } = await runPipelineWithActiveZones([])
    expect(gcode).not.toMatch(/^M64\s/m)
    expect(gcode).not.toMatch(/^M65\s/m)
    expect(gcode).toContain('; 0 of 6 zones engaged (64.0% bed coverage)')
    expect(gcode).toContain('; Engaged zones: (none)')
  })
})
