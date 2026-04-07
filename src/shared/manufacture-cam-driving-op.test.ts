import { describe, expect, it } from 'vitest'
import { resolveManufactureCamDrivingOperation } from './manufacture-cam-driving-op'
import type { ManufactureFile } from './manufacture-schema'

function mfg(ops: ManufactureFile['operations']): ManufactureFile {
  return {
    version: 1,
    setups: [{ id: 's1', label: 'S1', machineId: 'm1' }],
    operations: ops
  }
}

describe('resolveManufactureCamDrivingOperation', () => {
  it('prefers selected runnable CNC op', () => {
    const file = mfg([
      { id: 'a', kind: 'cnc_parallel', label: 'A', suppressed: false },
      { id: 'b', kind: 'cnc_raster', label: 'B', suppressed: false }
    ])
    const r = resolveManufactureCamDrivingOperation(file, 1)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.index).toBe(1)
      expect(r.op.kind).toBe('cnc_raster')
    }
  })

  it('falls back to first runnable when selected is non-CNC', () => {
    const file = mfg([
      { id: 'a', kind: 'fdm_slice', label: 'A', suppressed: false },
      { id: 'b', kind: 'cnc_waterline', label: 'B', suppressed: false }
    ])
    const r = resolveManufactureCamDrivingOperation(file, 0)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.index).toBe(1)
      expect(r.op.kind).toBe('cnc_waterline')
    }
  })

  it('skips suppressed ops', () => {
    const file = mfg([
      { id: 'a', kind: 'cnc_parallel', label: 'A', suppressed: true },
      { id: 'b', kind: 'cnc_parallel', label: 'B', suppressed: false }
    ])
    const r = resolveManufactureCamDrivingOperation(file, 0)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.index).toBe(1)
  })

  it('errors when no runnable CNC', () => {
    const file = mfg([{ id: 'a', kind: 'fdm_slice', label: 'A', suppressed: false }])
    const r = resolveManufactureCamDrivingOperation(file, 0)
    expect(r.ok).toBe(false)
  })
})
