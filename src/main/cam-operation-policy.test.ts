import { describe, expect, it } from 'vitest'
import { describeCamOperationKind } from './cam-operation-policy'
import {
  DEAD_ENGINE_CAM_KINDS,
  OFFERED_CAM_OP_KINDS,
  isManufactureKindBlockedFromCam
} from '../shared/manufacture-cam-gate'

describe('describeCamOperationKind', () => {
  it('allows undefined and unknown kinds without blocking', () => {
    expect(describeCamOperationKind(undefined).runnable).toBe(true)
    expect(describeCamOperationKind('nope').runnable).toBe(true)
  })

  it('blocks FDM and export-only manufacture kinds from cam:run', () => {
    const fdm = describeCamOperationKind('fdm_slice')
    expect(fdm.runnable).toBe(false)
    expect(fdm.error).toMatch(/FDM|not available|Generate CAM/i)
    expect(fdm.hint).toMatch(/Slice|Cura|manufacture/i)

    const exp = describeCamOperationKind('export_stl')
    expect(exp.runnable).toBe(false)
    expect(exp.error).toMatch(/Export STL|not.*CNC/i)
    expect(exp.hint).toMatch(/assets|planning|cam:run/i)

    const lathe = describeCamOperationKind('cnc_lathe_turn')
    expect(lathe.runnable).toBe(false)
    expect(lathe.error).toMatch(/lathe|turning/i)
  })

  it('allows parallel with STL bounds + unverified honesty', () => {
    const r = describeCamOperationKind('cnc_parallel')
    expect(r.runnable).toBe(true)
    expect(r.hint).toMatch(/parallel finish|mesh bounds/i)
    expect(r.hint).toMatch(/mtime|cam\.nc/i)
    expect(r.hint).toMatch(/MACHINES/i)
  })

  it('allows adaptive with OpenCAMLib + fallback honesty', () => {
    const r = describeCamOperationKind('cnc_adaptive')
    expect(r.runnable).toBe(true)
    expect(r.hint).toMatch(/OpenCAMLib/i)
    expect(r.hint).toMatch(/AdaptiveWaterline|adaptive/i)
    expect(r.hint).toMatch(/MACHINES/i)
  })

  it('allows waterline with OpenCAMLib + fallback honesty', () => {
    const r = describeCamOperationKind('cnc_waterline')
    expect(r.runnable).toBe(true)
    expect(r.hint).toMatch(/OpenCAMLib/i)
    expect(r.hint).toMatch(/waterline|Z-level/i)
    expect(r.hint).toMatch(/MACHINES/i)
  })

  it('hints for contour-style kinds', () => {
    for (const kind of ['cnc_contour', 'cnc_pocket', 'cnc_drill'] as const) {
      const r = describeCamOperationKind(kind)
      expect(r.runnable).toBe(true)
      expect(r.hint).toMatch(/2D paths|contourPoints|drillPoints/i)
      expect(r.hint).toMatch(/hard error|no STL parallel fallback/i)
      expect(r.hint).toMatch(/MACHINES/i)
    }
  })

  it('documents contour multi-depth zStepMm when zPassMm is negative', () => {
    const r = describeCamOperationKind('cnc_contour')
    expect(r.hint).toMatch(/multi-depth|zStepMm/i)
  })

  it('documents pocket params with explicit ramp/finish semantics', () => {
    const r = describeCamOperationKind('cnc_pocket')
    expect(r.runnable).toBe(true)
    expect(r.hint).toMatch(/zStepMm/i)
    expect(r.hint).toMatch(/entry mode|plunge|ramp/i)
    expect(r.hint).toMatch(/rampMaxAngleDeg/i)
    expect(r.hint).toMatch(/wall stock/i)
    expect(r.hint).toMatch(/finish contour pass|finishEachDepth/i)
  })

  it('allows raster with OCL / mesh fallback honesty', () => {
    const r = describeCamOperationKind('cnc_raster')
    expect(r.runnable).toBe(true)
    expect(r.hint).toMatch(/OpenCAMLib|PathDropCutter/i)
    expect(r.hint).toMatch(/mesh|height-field|orthogonal/i)
    expect(r.hint).toMatch(/MACHINES/i)
  })

  it('documents pencil as tight raster rest cleanup', () => {
    const r = describeCamOperationKind('cnc_pencil')
    expect(r.runnable).toBe(true)
    expect(r.hint).toMatch(/pencil|tight|stepover/i)
    expect(r.hint).toMatch(/OpenCAMLib|raster/i)
    expect(r.hint).toMatch(/MACHINES/i)
  })

  it('allows chamfer with V-bit doc', () => {
    const r = describeCamOperationKind('cnc_chamfer')
    expect(r.runnable).toBe(true)
    expect(r.hint).toMatch(/chamfer|V-bit/i)
    expect(r.hint).toMatch(/chamferDepthMm/i)
    expect(r.hint).toMatch(/MACHINES/i)
  })

  it('BLOCKS thread_mill (no thread-milling engine — would silently emit a flat parallel finish)', () => {
    const r = describeCamOperationKind('cnc_thread_mill')
    expect(r.runnable).toBe(false)
    expect(r.error).toMatch(/thread/i)
    expect(r.hint).toMatch(/thread/i)
  })

  it('blocks laser with actionable redirect', () => {
    const r = describeCamOperationKind('cnc_laser')
    expect(r.runnable).toBe(false)
    expect(r.error).toMatch(/laser/i)
    // Gate hint redirects to dedicated laser software (not the cam-runner laser-params hint)
    expect(r.hint).toMatch(/laser|Makera CAM/i)
  })

  it('allows all PCB operation kinds', () => {
    for (const kind of ['cnc_pcb_isolation', 'cnc_pcb_drill', 'cnc_pcb_contour'] as const) {
      const r = describeCamOperationKind(kind)
      expect(r.runnable).toBe(true)
      expect(r.hint).toMatch(/PCB|isolation|drill|contour/i)
      expect(r.hint).toMatch(/MACHINES/i)
    }
  })

  it('allows all 4-axis kinds with axisCount requirement in doc', () => {
    const kinds = ['cnc_4axis_roughing', 'cnc_4axis_finishing', 'cnc_4axis_contour', 'cnc_4axis_indexed'] as const
    for (const kind of kinds) {
      const r = describeCamOperationKind(kind)
      expect(r.runnable).toBe(true)
      expect(r.hint).toMatch(/4-axis|axisCount/i)
      expect(r.hint).toMatch(/MACHINES/i)
    }
  })

  it('BLOCKS all 5-axis kinds (no 5-axis machine in shop scope + deleted engine)', () => {
    const kinds = ['cnc_5axis_contour', 'cnc_5axis_swarf', 'cnc_5axis_flowline'] as const
    for (const kind of kinds) {
      const r = describeCamOperationKind(kind)
      expect(r.runnable).toBe(false)
      expect(r.error).toMatch(/5-axis/i)
      expect(r.hint).toMatch(/5-axis|dedicated/i)
    }
  })

  it('BLOCKS the deleted-engine freeform finishing strategies (spiral / morphing / steep-shallow / scallop / auto-select)', () => {
    const kinds = [
      'cnc_spiral_finish', 'cnc_morphing_finish',
      'cnc_steep_shallow', 'cnc_scallop_finish', 'cnc_auto_select'
    ] as const
    for (const kind of kinds) {
      const r = describeCamOperationKind(kind)
      expect(r.runnable).toBe(false)
      expect(r.error).toMatch(/removed|not available/i)
      // Honest redirect points the operator at a runnable 3D finish.
      expect(r.hint).toMatch(/cnc_waterline|cnc_raster|cnc_pencil|cnc_3d_finish/i)
    }
  })

  it('keeps the strategies with a REAL path runnable (trochoidal HSM 2D engine, 4-axis continuous TS engine)', () => {
    for (const kind of ['cnc_trochoidal_hsm', 'cnc_4axis_continuous'] as const) {
      const r = describeCamOperationKind(kind)
      expect(r.runnable).toBe(true)
      expect(r.hint).toMatch(/MACHINES/i)
    }
  })

  it('cnc_3d_rough documents stockAllowanceMm and bulk removal intent', () => {
    const r = describeCamOperationKind('cnc_3d_rough')
    expect(r.runnable).toBe(true)
    expect(r.hint).toMatch(/stockAllowanceMm|stock.*allowance/i)
    expect(r.hint).toMatch(/rough|bulk|adaptive/i)
    expect(r.hint).toMatch(/MACHINES/i)
  })

  it('cnc_3d_finish documents finishStrategy and scallop options', () => {
    const r = describeCamOperationKind('cnc_3d_finish')
    expect(r.runnable).toBe(true)
    expect(r.hint).toMatch(/finishStrategy|raster|waterline/i)
    expect(r.hint).toMatch(/finishScallopMm|scallop/i)
    expect(r.hint).toMatch(/MACHINES/i)
  })
})

// ---------------------------------------------------------------------------
// Capability-honesty single-source-of-truth (CAM ENHANCE)
//
// The op-kind picker derives its <select> from OFFERED_CAM_OP_KINDS. These pins
// keep that list and the runnable/blocked policy in lockstep so a dead-engine
// kind can never drift back into the picker advertising a capability the app
// does not have.
// ---------------------------------------------------------------------------
// The two NON-CNC rows the picker legitimately offers. They are honestly
// blocked from `cam:run` (they route through their own paths — fdm_slice →
// OrcaSlicer, export_stl → mesh export), so they are NOT a capability lie.
const OFFERED_NON_CAM_KINDS = new Set(['fdm_slice', 'export_stl'])

describe('capability honesty — offered/runnable/blocked single source of truth', () => {
  it('EVERY offered CNC kind is runnable (no dishonest toolpath options)', () => {
    for (const { kind } of OFFERED_CAM_OP_KINDS) {
      if (OFFERED_NON_CAM_KINDS.has(kind)) continue // non-CAM rows route elsewhere
      const r = describeCamOperationKind(kind)
      expect(r.runnable, `${kind} is offered as a CNC toolpath but not runnable`).toBe(true)
      expect(r.error, `${kind} is offered but carries a block error`).toBeUndefined()
    }
  })

  it('the two offered non-CAM rows are honestly blocked from cam:run (route elsewhere)', () => {
    for (const kind of OFFERED_NON_CAM_KINDS) {
      const r = describeCamOperationKind(kind)
      expect(r.runnable, `${kind} should be blocked from cam:run`).toBe(false)
      // ...but they are NOT dead-engine kinds — they have a real non-cam:run path.
      expect(DEAD_ENGINE_CAM_KINDS).not.toContain(kind)
    }
  })

  it('NO offered kind is in the dead-engine set (the dishonest-capability gate)', () => {
    const dead = new Set<string>(DEAD_ENGINE_CAM_KINDS)
    for (const { kind } of OFFERED_CAM_OP_KINDS) {
      expect(dead.has(kind), `${kind} is a dead-engine kind but offered in the picker`).toBe(false)
    }
  })

  it('EVERY dead-engine kind is blocked (runnable:false) by the policy', () => {
    for (const kind of DEAD_ENGINE_CAM_KINDS) {
      const r = describeCamOperationKind(kind)
      expect(r.runnable, `${kind} should be blocked`).toBe(false)
      expect(typeof r.error).toBe('string')
      expect((r.error ?? '').length).toBeGreaterThan(0)
      expect(typeof r.hint).toBe('string')
      expect((r.hint ?? '').length).toBeGreaterThan(0)
      expect(isManufactureKindBlockedFromCam(kind)).toBe(true)
    }
  })

  it('the exact dead-engine roster is pinned (rename/addition/removal forces a deliberate update)', () => {
    expect([...DEAD_ENGINE_CAM_KINDS].sort()).toEqual(
      [
        'cnc_5axis_contour',
        'cnc_5axis_flowline',
        'cnc_5axis_swarf',
        'cnc_auto_select',
        'cnc_morphing_finish',
        'cnc_scallop_finish',
        'cnc_spiral_finish',
        'cnc_steep_shallow',
        'cnc_thread_mill'
      ].sort()
    )
  })

  it('the picker offers the expected runnable roster (and excludes every dead kind)', () => {
    const offered = OFFERED_CAM_OP_KINDS.map((o) => o.kind)
    // FDM + the runnable CNC family + export. Order is operator-facing.
    expect(offered).toEqual([
      'fdm_slice',
      'cnc_parallel',
      'cnc_contour',
      'cnc_pocket',
      'cnc_vcarve',
      'cnc_drill',
      'cnc_adaptive',
      'cnc_waterline',
      'cnc_raster',
      'cnc_pencil',
      'cnc_trochoidal_hsm',
      'cnc_4axis_roughing',
      'cnc_4axis_finishing',
      'cnc_4axis_contour',
      'cnc_4axis_indexed',
      'cnc_4axis_continuous',
      'export_stl'
    ])
    // Belt-and-suspenders: the historically-offered dead kinds are gone.
    for (const dead of ['cnc_spiral_finish', 'cnc_morphing_finish', 'cnc_steep_shallow', 'cnc_scallop_finish', 'cnc_auto_select', 'cnc_5axis_contour', 'cnc_5axis_swarf', 'cnc_5axis_flowline']) {
      expect(offered).not.toContain(dead)
    }
  })

  it('every offered kind has a non-empty human label for the <select>', () => {
    for (const { kind, label } of OFFERED_CAM_OP_KINDS) {
      expect(typeof label, `${kind} label`).toBe('string')
      expect(label.trim().length, `${kind} label is empty`).toBeGreaterThan(0)
    }
  })
})
