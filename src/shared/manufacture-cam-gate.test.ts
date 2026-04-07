import { describe, expect, it } from 'vitest'
import { getManufactureCamRunBlock, isManufactureKindBlockedFromCam } from './manufacture-cam-gate'

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
    expect(f!.hint).toMatch(/Slice|Cura/i)
    const e = getManufactureCamRunBlock('export_stl')
    expect(e).not.toBeNull()
    expect(e!.hint).toMatch(/assets|planning/i)
    const lathe = getManufactureCamRunBlock('cnc_lathe_turn')
    expect(lathe).not.toBeNull()
    expect(lathe!.error).toMatch(/lathe|turning/i)
  })
})
