import { describe, expect, it } from 'vitest'
import {
  DEAD_ENGINE_CAM_KINDS,
  OFFERED_CAM_OP_KINDS,
  getManufactureCamRunBlock,
  isManufactureKindBlockedFromCam
} from './manufacture-cam-gate'

describe('manufacture-cam-gate', () => {
  it('blocks non-runner kinds including laser and lathe planning rows', () => {
    expect(isManufactureKindBlockedFromCam(undefined)).toBe(false)
    expect(isManufactureKindBlockedFromCam('')).toBe(false)
    expect(isManufactureKindBlockedFromCam('cnc_parallel')).toBe(false)
    expect(isManufactureKindBlockedFromCam('fdm_slice')).toBe(true)
    expect(isManufactureKindBlockedFromCam('export_stl')).toBe(true)
    expect(isManufactureKindBlockedFromCam('cnc_laser')).toBe(true)
    expect(isManufactureKindBlockedFromCam('cnc_lathe_turn')).toBe(true)
  })

  it('returns structured messages for blocked kinds', () => {
    expect(getManufactureCamRunBlock('cnc_waterline')).toBeNull()
    const f = getManufactureCamRunBlock('fdm_slice')
    expect(f).not.toBeNull()
    expect(f!.error).toMatch(/FDM|Generate CAM/i)
    // Post-pivot: the FDM path is OrcaSlicer (the CuraEngine bundle was deleted).
    expect(f!.hint).toMatch(/OrcaSlicer/i)
    expect(f!.hint).not.toMatch(/CuraEngine/i)
    const e = getManufactureCamRunBlock('export_stl')
    expect(e).not.toBeNull()
    expect(e!.hint).toMatch(/assets|planning/i)
    const lathe = getManufactureCamRunBlock('cnc_lathe_turn')
    expect(lathe).not.toBeNull()
    expect(lathe!.error).toMatch(/lathe|turning/i)
  })

  it('blocks every dead-engine CAM kind (capability honesty)', () => {
    for (const kind of DEAD_ENGINE_CAM_KINDS) {
      expect(isManufactureKindBlockedFromCam(kind), `${kind} not blocked by predicate`).toBe(true)
      const block = getManufactureCamRunBlock(kind)
      expect(block, `${kind} returned no block`).not.toBeNull()
      expect((block!.error ?? '').length).toBeGreaterThan(0)
      expect((block!.hint ?? '').length).toBeGreaterThan(0)
    }
  })

  it('gives the deleted freeform finishes an honest redirect to a runnable finish', () => {
    for (const kind of ['cnc_spiral_finish', 'cnc_morphing_finish', 'cnc_steep_shallow', 'cnc_scallop_finish', 'cnc_auto_select']) {
      const block = getManufactureCamRunBlock(kind)
      expect(block).not.toBeNull()
      expect(block!.hint).toMatch(/cnc_waterline|cnc_raster|cnc_pencil|cnc_3d_finish/)
    }
  })

  it('thread milling block warns it would emit a flat finish, not a thread', () => {
    const block = getManufactureCamRunBlock('cnc_thread_mill')
    expect(block).not.toBeNull()
    expect(block!.error).toMatch(/thread/i)
    expect(block!.hint).toMatch(/not a thread|flat parallel finish/i)
  })

  it('OFFERED_CAM_OP_KINDS is the SSOT: NO offered kind is a dead-engine kind', () => {
    const dead = new Set<string>(DEAD_ENGINE_CAM_KINDS)
    expect(OFFERED_CAM_OP_KINDS.length).toBeGreaterThan(0)
    for (const { kind } of OFFERED_CAM_OP_KINDS) {
      expect(dead.has(kind), `${kind} is offered but dead`).toBe(false)
    }
  })

  it('every offered CNC kind is runnable through cam:run (the two non-CAM rows route elsewhere)', () => {
    // fdm_slice (OrcaSlicer) and export_stl (mesh export) are legitimately
    // offered planning rows that are honestly blocked from cam:run.
    const nonCam = new Set(['fdm_slice', 'export_stl'])
    for (const { kind } of OFFERED_CAM_OP_KINDS) {
      if (nonCam.has(kind)) {
        expect(getManufactureCamRunBlock(kind), `${kind} non-CAM row should be blocked`).not.toBeNull()
        continue
      }
      expect(isManufactureKindBlockedFromCam(kind), `${kind} is offered as CNC but blocked`).toBe(false)
      expect(getManufactureCamRunBlock(kind), `${kind} is offered as CNC but has a run block`).toBeNull()
    }
  })
})
