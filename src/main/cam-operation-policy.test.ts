import { describe, expect, it } from 'vitest'
import { describeCamOperationKind } from './cam-operation-policy'

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

  it('allows thread_mill with thread params doc', () => {
    const r = describeCamOperationKind('cnc_thread_mill')
    expect(r.runnable).toBe(true)
    expect(r.hint).toMatch(/thread/i)
    expect(r.hint).toMatch(/threadPitchMm|threadDepthMm/i)
    expect(r.hint).toMatch(/MACHINES/i)
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

  it('allows all 5-axis kinds with Python engine requirement in doc', () => {
    const kinds = ['cnc_5axis_contour', 'cnc_5axis_swarf', 'cnc_5axis_flowline'] as const
    for (const kind of kinds) {
      const r = describeCamOperationKind(kind)
      expect(r.runnable).toBe(true)
      expect(r.hint).toMatch(/5-axis|axisCount.*5/i)
      expect(r.hint).toMatch(/Python|toolpath engine/i)
      expect(r.hint).toMatch(/MACHINES/i)
    }
  })

  it('allows all v4.0 Python engine strategies', () => {
    const kinds = [
      'cnc_spiral_finish', 'cnc_morphing_finish', 'cnc_trochoidal_hsm',
      'cnc_steep_shallow', 'cnc_scallop_finish', 'cnc_4axis_continuous',
      'cnc_auto_select'
    ] as const
    for (const kind of kinds) {
      const r = describeCamOperationKind(kind)
      expect(r.runnable).toBe(true)
      expect(r.hint).toMatch(/Python|toolpath engine/i)
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
