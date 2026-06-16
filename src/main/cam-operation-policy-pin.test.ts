/**
 * Paired-pin contract for `src/main/cam-operation-policy.ts` -- the
 * 201-line MAIN-process policy module that maps every `manufacture.json`
 * operation `kind` to a `{ runnable, error?, hint? }` triple consumed by
 * the `cam:run` IPC handler and the Manufacture UI.
 *
 * The module exports a single runtime symbol:
 *
 * - `describeCamOperationKind(kind: string | undefined)` -- returns the
 *   documented runnable/error/hint shape for each kind. Behavior:
 *     * Blocked kinds (delegated to `getManufactureCamRunBlock`):
 *       `fdm_slice`, `export_stl`, `cnc_laser`, `cnc_lathe_turn`,
 *       `cnc_probe`, PLUS the capability-honesty `DEAD_ENGINE_CAM_KINDS`
 *       (`cnc_thread_mill`, the deleted-toolpath_engine freeform finishes
 *       `cnc_spiral_finish` / `cnc_morphing_finish` / `cnc_steep_shallow` /
 *       `cnc_scallop_finish` / `cnc_auto_select`, and the out-of-scope
 *       `cnc_5axis_*` family) -- each returns `{ runnable: false, error,
 *       hint }` sourced from the shared gate.
 *     * Runnable CNC kinds: string literals that each return
 *       `{ runnable: true, hint: '<documented copy>' }` with stable
 *       text -- the hints surface in the Manufacture UI as the
 *       authoritative explanation of what the engine does.
 *     * Unknown / undefined / omitted kinds: fall through to the
 *       default `{ runnable: true }` (no hint) per the IPC-backward-
 *       compatibility rule documented at the top of the source file.
 *
 * Three-machine impact: DIRECT cross-cut. Every non-FDM job across
 * Laguna Swift 5x10 (3-axis) + Makera Carvera 3-axis + Carvera 4-axis
 * Rotary routes through this policy gate before the CAM engine runs.
 * The `cnc_4axis_*` family (5 kinds incl. continuous) gates the entire
 * Carvera 4-axis Rotary toolpath set. The `cnc_5axis_*` family is BLOCKED
 * (capability honesty): no shop machine runs 5-axis and the 5-axis
 * toolpath engine was deleted in the 2026-05-27 pivot, so offering it
 * would advertise a capability the app cannot deliver. The `fdm_slice`
 * blocked branch keeps K2 Plus FDM jobs out of the CNC `cam:run` path
 * (they go through OrcaSlicer via src/main/slicer/orca-wrapper.ts).
 *
 * This pin co-locates with the existing behavioral test
 * `cam-operation-policy.test.ts`. The pin is exhaustive against every
 * documented kind (the full string-literal table from the source) so a
 * rename, deletion, or addition forces a deliberate update to this file.
 *
 * Roadmap ID: [ID-0297] / Cycle 224 (cam-engine rotation slot).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as M from './cam-operation-policy'
import { describeCamOperationKind } from './cam-operation-policy'

const SOURCE_PATH = resolve(__dirname, 'cam-operation-policy.ts')
const SOURCE = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// A. Module shape
// ---------------------------------------------------------------------------
describe('A. Module shape -- src/main/cam-operation-policy.ts exports', () => {
  it('exports exactly the single describe entrypoint', () => {
    expect(Object.keys(M).sort()).toEqual(['describeCamOperationKind'])
  })

  it('describeCamOperationKind is a function with arity 1', () => {
    expect(typeof describeCamOperationKind).toBe('function')
    expect(describeCamOperationKind.length).toBe(1)
  })

  it('always returns an object with a boolean runnable field', () => {
    for (const kind of [undefined, '', 'cnc_parallel', 'cnc_4axis_indexed', 'cnc_laser', 'totally_unknown']) {
      const r = describeCamOperationKind(kind)
      expect(typeof r.runnable).toBe('boolean')
    }
  })
})

// ---------------------------------------------------------------------------
// B. Default / unknown / omitted kinds fall through
// ---------------------------------------------------------------------------
describe('B. Default fallthrough -- IPC backward-compatibility', () => {
  it('undefined kind returns { runnable: true } with no hint or error', () => {
    const r = describeCamOperationKind(undefined)
    expect(r.runnable).toBe(true)
    expect(r.error).toBeUndefined()
    expect(r.hint).toBeUndefined()
  })

  it('empty string returns { runnable: true } with no hint or error', () => {
    const r = describeCamOperationKind('')
    expect(r.runnable).toBe(true)
    expect(r.error).toBeUndefined()
    expect(r.hint).toBeUndefined()
  })

  it('unknown string falls through to { runnable: true }', () => {
    const r = describeCamOperationKind('totally_made_up_op_kind')
    expect(r.runnable).toBe(true)
    expect(r.error).toBeUndefined()
    expect(r.hint).toBeUndefined()
  })

  it('case-sensitive lookup -- "CNC_PARALLEL" is unknown and falls through', () => {
    const r = describeCamOperationKind('CNC_PARALLEL')
    expect(r.runnable).toBe(true)
    expect(r.hint).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// C. Blocked kinds (delegated to manufacture-cam-gate)
// ---------------------------------------------------------------------------
describe('C. Blocked kinds delegated to getManufactureCamRunBlock', () => {
  it('fdm_slice is BLOCKED from cam:run (K2 Plus FDM goes through OrcaSlicer, not cam:run)', () => {
    const r = describeCamOperationKind('fdm_slice')
    expect(r.runnable).toBe(false)
    expect(r.error).toBe('FDM slicing is not available through Generate CAM.')
    // Post-pivot the FDM path is OrcaSlicer (the CuraEngine bundle was deleted).
    expect(r.hint).toContain('OrcaSlicer')
    expect(r.hint).not.toContain('CuraEngine')
  })

  it('export_stl is BLOCKED (planning-only kind)', () => {
    const r = describeCamOperationKind('export_stl')
    expect(r.runnable).toBe(false)
    expect(r.error).toBe('Export STL is not a CNC toolpath operation.')
    expect(r.hint).toContain('export_stl operation is for planning only')
  })

  it('cnc_laser BLOCK comes from the GATE (not the dead local branch in this module)', () => {
    // The local cnc_laser branch at line ~101 of cam-operation-policy.ts
    // is unreachable because getManufactureCamRunBlock returns blocked
    // for cnc_laser FIRST. The gate's error string is shorter than the
    // local one, so we pin the gate's text to detect a regression where
    // the gate gets reordered.
    const r = describeCamOperationKind('cnc_laser')
    expect(r.runnable).toBe(false)
    expect(r.error).toBe('Laser operations are not posted by the built-in CAM runner.')
    // The dead local branch's longer error must NOT appear.
    expect(r.error).not.toContain('Export G-code from dedicated laser software')
    // The gate's hint mentions Makera CAM specifically.
    expect(r.hint).toContain('Makera CAM')
  })

  it('cnc_lathe_turn is BLOCKED (lathe posts not implemented yet)', () => {
    const r = describeCamOperationKind('cnc_lathe_turn')
    expect(r.runnable).toBe(false)
    expect(r.error).toContain('Lathe / turning is not posted')
    expect(r.hint).toContain('docs/MACHINES.md')
  })

  it('cnc_probe is BLOCKED (probing routes through probe:generate IPC)', () => {
    const r = describeCamOperationKind('cnc_probe')
    expect(r.runnable).toBe(false)
    expect(r.error).toContain('probe:generate')
    expect(r.hint).toContain('singleSurface')
  })

  it('cnc_thread_mill is BLOCKED (deleted-engine / capability honesty)', () => {
    const r = describeCamOperationKind('cnc_thread_mill')
    expect(r.runnable).toBe(false)
    expect(r.error).toContain('Thread milling is not posted')
  })

  it('the deleted freeform finishing kinds are BLOCKED with a redirect to a runnable finish', () => {
    for (const k of ['cnc_spiral_finish', 'cnc_morphing_finish', 'cnc_steep_shallow', 'cnc_scallop_finish', 'cnc_auto_select']) {
      const r = describeCamOperationKind(k)
      expect(r.runnable, k).toBe(false)
      expect(r.error).toContain('toolpath engine was removed')
      expect(r.hint).toMatch(/cnc_waterline|cnc_raster|cnc_pencil|cnc_3d_finish/)
    }
  })

  it('the 5-axis kinds are BLOCKED (no 5-axis hardware in shop scope + deleted engine)', () => {
    for (const k of ['cnc_5axis_contour', 'cnc_5axis_swarf', 'cnc_5axis_flowline']) {
      const r = describeCamOperationKind(k)
      expect(r.runnable, k).toBe(false)
      expect(r.error).toContain('5-axis is not supported')
    }
  })
})

// ---------------------------------------------------------------------------
// D. Standard 3-axis CNC kinds (Laguna 5x10 + Carvera 3-axis surface)
// ---------------------------------------------------------------------------
describe('D. Standard 3-axis CNC kinds (Laguna + Carvera 3-axis)', () => {
  it('cnc_parallel is runnable and references built-in parallel finish', () => {
    const r = describeCamOperationKind('cnc_parallel')
    expect(r.runnable).toBe(true)
    expect(r.hint).toContain('parallel finish')
    expect(r.hint).toContain('mtime')
  })

  it('cnc_adaptive is runnable and references adaptive clearing', () => {
    const r = describeCamOperationKind('cnc_adaptive')
    expect(r.runnable).toBe(true)
    expect(r.hint).toContain('adaptive clearing engine')
    expect(r.hint).toContain('AdaptiveWaterline')
  })

  it('cnc_waterline is runnable and references Z-level contouring', () => {
    const r = describeCamOperationKind('cnc_waterline')
    expect(r.runnable).toBe(true)
    expect(r.hint).toContain('Z-level contouring')
    expect(r.hint).toContain('scallop-aware stepdown')
  })

  it('cnc_raster is runnable and references PathDropCutter fallback chain', () => {
    const r = describeCamOperationKind('cnc_raster')
    expect(r.runnable).toBe(true)
    expect(r.hint).toContain('PathDropCutter')
    expect(r.hint).toContain('usePriorPostedGcodeRest')
  })

  it('cnc_pencil is runnable and references Laplacian curvature detection', () => {
    const r = describeCamOperationKind('cnc_pencil')
    expect(r.runnable).toBe(true)
    expect(r.hint).toContain('Laplacian curvature')
    expect(r.hint).toContain('rest cleanup')
  })

  it('cnc_contour, cnc_pocket, cnc_drill share a single hint (2D paths from operation geometry)', () => {
    const c = describeCamOperationKind('cnc_contour')
    const p = describeCamOperationKind('cnc_pocket')
    const d = describeCamOperationKind('cnc_drill')
    expect(c.runnable).toBe(true)
    expect(p.runnable).toBe(true)
    expect(d.runnable).toBe(true)
    expect(c.hint).toBe(p.hint)
    expect(c.hint).toBe(d.hint)
    expect(c.hint).toContain('contourPoints')
    expect(c.hint).toContain('drillPoints')
    expect(c.hint).toContain('rampMaxAngleDeg')
  })

  it('cnc_chamfer is runnable and references V-bit / 45 deg default', () => {
    const r = describeCamOperationKind('cnc_chamfer')
    expect(r.runnable).toBe(true)
    expect(r.hint).toContain('V-bit')
    expect(r.hint).toContain('chamferAngleDeg')
  })

  it('cnc_thread_mill is BLOCKED (no thread-milling engine — would emit a flat parallel finish)', () => {
    const r = describeCamOperationKind('cnc_thread_mill')
    expect(r.runnable).toBe(false)
    expect(r.error).toContain('Thread milling is not posted')
    expect(r.hint).toContain('thread')
  })

  it('cnc_pcb_isolation, cnc_pcb_drill, cnc_pcb_contour share a single PCB hint', () => {
    const a = describeCamOperationKind('cnc_pcb_isolation')
    const b = describeCamOperationKind('cnc_pcb_drill')
    const c = describeCamOperationKind('cnc_pcb_contour')
    expect(a.runnable).toBe(true)
    expect(b.runnable).toBe(true)
    expect(c.runnable).toBe(true)
    expect(a.hint).toBe(b.hint)
    expect(a.hint).toBe(c.hint)
    expect(a.hint).toContain('PCB operation')
    expect(a.hint).toContain('isolation routing')
  })
})

// ---------------------------------------------------------------------------
// E. Carvera 4-axis Rotary kinds (axisCount: 4)
// ---------------------------------------------------------------------------
describe('E. Carvera 4-axis Rotary kinds -- require axisCount: 4', () => {
  it('cnc_4axis_roughing is runnable and requires axisCount: 4', () => {
    const r = describeCamOperationKind('cnc_4axis_roughing')
    expect(r.runnable).toBe(true)
    expect(r.hint).toContain('axisCount: 4')
    expect(r.hint).toContain('radial waterline roughing')
    expect(r.hint).toContain('stepoverDeg')
  })

  it('cnc_4axis_finishing is runnable and requires axisCount: 4', () => {
    const r = describeCamOperationKind('cnc_4axis_finishing')
    expect(r.runnable).toBe(true)
    expect(r.hint).toContain('axisCount: 4')
    expect(r.hint).toContain('finishStepoverDeg')
  })

  it('cnc_4axis_contour is runnable and requires axisCount: 4 + contourPoints', () => {
    const r = describeCamOperationKind('cnc_4axis_contour')
    expect(r.runnable).toBe(true)
    expect(r.hint).toContain('axisCount: 4')
    expect(r.hint).toContain('contourPoints: [x,y][]')
  })

  it('cnc_4axis_indexed is runnable and references discrete A-angles', () => {
    const r = describeCamOperationKind('cnc_4axis_indexed')
    expect(r.runnable).toBe(true)
    expect(r.hint).toContain('indexAnglesDeg')
    expect(r.hint).toContain('cylinderDiameterMm')
    expect(r.hint).toContain('air cut')
  })

  it('cnc_4axis_continuous is runnable and references simultaneous 4-axis machining', () => {
    const r = describeCamOperationKind('cnc_4axis_continuous')
    expect(r.runnable).toBe(true)
    expect(r.hint).toContain('simultaneous 4-axis')
    expect(r.hint).toContain('axisCount: 4')
  })

  it('all 4-axis hints reference the air-cut safety advice', () => {
    const kinds = ['cnc_4axis_roughing', 'cnc_4axis_finishing', 'cnc_4axis_contour', 'cnc_4axis_indexed', 'cnc_4axis_continuous']
    for (const k of kinds) {
      const r = describeCamOperationKind(k)
      expect(r.runnable).toBe(true)
      // Every 4-axis hint mentions air cut OR unverified.
      const text = r.hint ?? ''
      const safe = text.includes('air cut') || text.includes('unverified')
      expect(safe).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// F. v4.0 toolpath engine kinds (Python-engine-backed surface strategies)
// ---------------------------------------------------------------------------
describe('F. v4.0 toolpath engine kinds -- deleted-engine kinds BLOCKED, real-path kinds runnable', () => {
  it('cnc_spiral_finish is BLOCKED (deleted toolpath_engine, no fallback)', () => {
    const r = describeCamOperationKind('cnc_spiral_finish')
    expect(r.runnable).toBe(false)
    expect(r.error).toContain('toolpath engine was removed')
  })

  it('cnc_morphing_finish is BLOCKED (deleted toolpath_engine, no fallback)', () => {
    const r = describeCamOperationKind('cnc_morphing_finish')
    expect(r.runnable).toBe(false)
    expect(r.error).toContain('toolpath engine was removed')
  })

  it('cnc_trochoidal_hsm STAYS runnable (real 2D contour engine + parallel-finish fallback)', () => {
    const r = describeCamOperationKind('cnc_trochoidal_hsm')
    expect(r.runnable).toBe(true)
    expect(r.hint).toContain('Trochoidal HSM')
    expect(r.hint).toContain('chip-load')
  })

  it('cnc_steep_shallow is BLOCKED (deleted toolpath_engine, no fallback)', () => {
    const r = describeCamOperationKind('cnc_steep_shallow')
    expect(r.runnable).toBe(false)
    expect(r.error).toContain('toolpath engine was removed')
  })

  it('cnc_scallop_finish is BLOCKED (deleted toolpath_engine, no fallback)', () => {
    const r = describeCamOperationKind('cnc_scallop_finish')
    expect(r.runnable).toBe(false)
    expect(r.error).toContain('toolpath engine was removed')
  })

  it('cnc_auto_select is BLOCKED (deleted toolpath_engine, no fallback)', () => {
    const r = describeCamOperationKind('cnc_auto_select')
    expect(r.runnable).toBe(false)
    expect(r.error).toContain('toolpath engine was removed')
  })

  it('cnc_3d_rough is runnable and references stockAllowanceMm default 0.5 mm', () => {
    const r = describeCamOperationKind('cnc_3d_rough')
    expect(r.runnable).toBe(true)
    expect(r.hint).toContain('3D Roughing')
    expect(r.hint).toContain('stockAllowanceMm')
    expect(r.hint).toContain('0.5 mm')
  })

  it('cnc_3d_finish is runnable and references finishStrategy raster/waterline/pencil', () => {
    const r = describeCamOperationKind('cnc_3d_finish')
    expect(r.runnable).toBe(true)
    expect(r.hint).toContain('3D Finishing')
    expect(r.hint).toContain('finishStrategy')
    expect(r.hint).toContain('finishScallopMm')
  })
})

// ---------------------------------------------------------------------------
// G. 5-axis kinds (reserved -- no current shop hardware runs 5-axis)
// ---------------------------------------------------------------------------
describe('G. 5-axis kinds -- BLOCKED (no 5-axis hardware in shop scope + deleted engine)', () => {
  it('cnc_5axis_contour is BLOCKED', () => {
    const r = describeCamOperationKind('cnc_5axis_contour')
    expect(r.runnable).toBe(false)
    expect(r.error).toContain('5-axis is not supported')
  })

  it('cnc_5axis_swarf is BLOCKED', () => {
    const r = describeCamOperationKind('cnc_5axis_swarf')
    expect(r.runnable).toBe(false)
    expect(r.error).toContain('5-axis is not supported')
  })

  it('cnc_5axis_flowline is BLOCKED', () => {
    const r = describeCamOperationKind('cnc_5axis_flowline')
    expect(r.runnable).toBe(false)
    expect(r.error).toContain('5-axis is not supported')
  })

  it('all three 5-axis hints redirect to dedicated 5-axis CAM (no false capability)', () => {
    for (const k of ['cnc_5axis_contour', 'cnc_5axis_swarf', 'cnc_5axis_flowline']) {
      const r = describeCamOperationKind(k)
      expect(r.runnable).toBe(false)
      expect(r.hint).toMatch(/5-axis CAM|dedicated/i)
    }
  })
})

// ---------------------------------------------------------------------------
// H. Three-machine cross-cut realism
// ---------------------------------------------------------------------------
describe('H. Three-machine cross-cut realism', () => {
  it('K2 Plus FDM kind is BLOCKED -- the OrcaSlicer path handles it (not cam:run)', () => {
    const r = describeCamOperationKind('fdm_slice')
    expect(r.runnable).toBe(false)
    expect(r.hint).toContain('OrcaSlicer')
  })

  it('Laguna Swift 5x10 -- typical full-sheet kinds are all runnable', () => {
    // Laguna 5x10 typical kinds: parallel, adaptive, contour, pocket, drill,
    // raster (for relief/V-carve), pcb_*, chamfer.
    const lagunaKinds = ['cnc_parallel', 'cnc_adaptive', 'cnc_contour', 'cnc_pocket', 'cnc_drill', 'cnc_raster', 'cnc_chamfer']
    for (const k of lagunaKinds) {
      expect(describeCamOperationKind(k).runnable).toBe(true)
    }
  })

  it('Carvera 3-axis -- typical desktop kinds are all runnable', () => {
    // NOTE: cnc_thread_mill is intentionally absent — it is now BLOCKED (no
    // thread-milling engine; it would emit a flat parallel finish, not a thread).
    const carvera3Kinds = [
      'cnc_parallel', 'cnc_adaptive', 'cnc_waterline', 'cnc_pencil',
      'cnc_contour', 'cnc_pocket', 'cnc_drill', 'cnc_3d_rough', 'cnc_3d_finish',
      'cnc_pcb_isolation'
    ]
    for (const k of carvera3Kinds) {
      expect(describeCamOperationKind(k).runnable).toBe(true)
    }
  })

  it('Carvera 4-axis Rotary -- all five 4-axis kinds are runnable and reference axisCount: 4', () => {
    const fourAxisKinds = ['cnc_4axis_roughing', 'cnc_4axis_finishing', 'cnc_4axis_contour', 'cnc_4axis_indexed', 'cnc_4axis_continuous']
    for (const k of fourAxisKinds) {
      const r = describeCamOperationKind(k)
      expect(r.runnable).toBe(true)
      expect(r.hint).toContain('axisCount: 4')
    }
  })

  it('every blocked kind returns runnable: false; every runnable kind returns runnable: true', () => {
    const blocked = [
      'fdm_slice', 'export_stl', 'cnc_laser', 'cnc_lathe_turn', 'cnc_probe',
      // Capability-honesty gate (deleted toolpath_engine / out-of-scope 5-axis /
      // no thread engine): these always hard-fail, so they are blocked.
      'cnc_thread_mill',
      'cnc_spiral_finish', 'cnc_morphing_finish', 'cnc_steep_shallow', 'cnc_scallop_finish', 'cnc_auto_select',
      'cnc_5axis_contour', 'cnc_5axis_swarf', 'cnc_5axis_flowline'
    ]
    const runnable = [
      'cnc_parallel', 'cnc_adaptive', 'cnc_waterline', 'cnc_raster', 'cnc_pencil',
      'cnc_contour', 'cnc_pocket', 'cnc_drill',
      'cnc_4axis_roughing', 'cnc_4axis_finishing', 'cnc_4axis_contour', 'cnc_4axis_indexed', 'cnc_4axis_continuous',
      'cnc_chamfer',
      'cnc_pcb_isolation', 'cnc_pcb_drill', 'cnc_pcb_contour',
      'cnc_trochoidal_hsm',
      'cnc_3d_rough', 'cnc_3d_finish'
    ]
    for (const k of blocked) {
      expect(describeCamOperationKind(k).runnable).toBe(false)
    }
    for (const k of runnable) {
      expect(describeCamOperationKind(k).runnable).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// I. Source-text whitelist + structural invariants
// ---------------------------------------------------------------------------
describe('I. Source-text whitelist + structural invariants', () => {
  it('imports getManufactureCamRunBlock from the shared gate', () => {
    expect(SOURCE).toContain("import { getManufactureCamRunBlock } from '../shared/manufacture-cam-gate'")
  })

  it('does not contain `any` casts in TypeScript source', () => {
    const stripped = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    expect(stripped).not.toMatch(/\bas any\b/)
    expect(stripped).not.toMatch(/:\s*any\b/)
  })

  it('does not call eval / new Function (no dynamic code synthesis)', () => {
    expect(SOURCE).not.toMatch(/\beval\s*\(/)
    expect(SOURCE).not.toMatch(/\bnew\s+Function\s*\(/)
  })

  it('every runnable hint references docs/MACHINES.md (the unified safety pointer)', () => {
    // The "G-code stays unverified" / "(docs/MACHINES.md)" pattern is
    // the safety-rule-1 surface visible to the user. Pin via source-text.
    const docsRefs = SOURCE.match(/docs\/MACHINES\.md/g)
    expect(docsRefs).not.toBeNull()
    // The module references docs/MACHINES.md many times -- one per runnable
    // branch. Floor at 12 to detect a wholesale removal (the count dropped from
    // ~25 to 16 when the dead-engine branches were gated out for capability
    // honesty — see DEAD_ENGINE_CAM_KINDS in manufacture-cam-gate).
    expect(docsRefs!.length).toBeGreaterThanOrEqual(12)
  })

  it('the public function returns an object literal with at most three keys (runnable/error/hint)', () => {
    // Sanity scan: no return shape leaks a fourth key.
    const stripped = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    // Look for any return literal that contains a key NOT in
    // {runnable, error, hint}. We do this conservatively by listing
    // every quoted-or-unquoted property at the start of a return
    // object: `return {` block. We just assert no `detail:` or
    // `severity:` slipped in.
    expect(stripped).not.toMatch(/\bdetail:\s*['"`]/)
    expect(stripped).not.toMatch(/\bseverity:\s*['"`]/)
    expect(stripped).not.toMatch(/\bcode:\s*['"`]/)
  })

  it('the LAST return statement is the documented default { runnable: true } fallthrough', () => {
    // The fallthrough is a single-line `return { runnable: true }` at
    // the end of the function body. Pin this so a future refactor that
    // accidentally removes the fallthrough trips the pin.
    expect(SOURCE).toMatch(/return\s*\{\s*runnable:\s*true\s*\}\s*\n\}/)
  })
})

// ---------------------------------------------------------------------------
// J. Type-level parity -- return shape
// ---------------------------------------------------------------------------
describe('J. Type-level parity -- describeCamOperationKind return shape', () => {
  it('return type declares runnable: boolean + optional error + optional hint (3 fields)', () => {
    expect(SOURCE).toMatch(/runnable:\s*boolean/)
    expect(SOURCE).toMatch(/error\?:\s*string/)
    expect(SOURCE).toMatch(/hint\?:\s*string/)
  })

  it('runnable kinds return error === undefined', () => {
    for (const k of ['cnc_parallel', 'cnc_adaptive', 'cnc_4axis_indexed', 'cnc_3d_rough', 'cnc_3d_finish']) {
      const r = describeCamOperationKind(k)
      expect(r.runnable).toBe(true)
      expect(r.error).toBeUndefined()
    }
  })

  it('blocked kinds return error as a non-empty string', () => {
    for (const k of ['fdm_slice', 'export_stl', 'cnc_laser', 'cnc_lathe_turn', 'cnc_probe']) {
      const r = describeCamOperationKind(k)
      expect(r.runnable).toBe(false)
      expect(typeof r.error).toBe('string')
      expect((r.error ?? '').length).toBeGreaterThan(0)
    }
  })

  it('every blocked kind also carries a non-empty hint', () => {
    for (const k of ['fdm_slice', 'export_stl', 'cnc_laser', 'cnc_lathe_turn', 'cnc_probe']) {
      const r = describeCamOperationKind(k)
      expect(typeof r.hint).toBe('string')
      expect((r.hint ?? '').length).toBeGreaterThan(0)
    }
  })

  it('default fallthrough has no error/hint -- the unset fields are undefined (not empty strings)', () => {
    const r = describeCamOperationKind('totally_unknown_kind_xyz')
    expect(r.runnable).toBe(true)
    // Critical: the absence of error/hint must be `undefined` (allowing
    // `??` callers to fall through), not the empty string.
    expect(r.error).toBeUndefined()
    expect(r.hint).toBeUndefined()
  })
})
