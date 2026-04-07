import { describe, expect, it } from 'vitest'
import type { ManufactureSetup } from './manufacture-schema'
import {
  autoAssignWcsOffsets,
  computeStockTransfer,
  extractStockBounds,
  suggestFlipSetup,
  validateSetupSequence,
  wcsIndexToCode,
  WCS_CODES,
  MAX_WCS_OFFSETS
} from './multi-setup-utils'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSetup(overrides: Partial<ManufactureSetup> & { id: string }): ManufactureSetup {
  return {
    label: overrides.label ?? `Setup ${overrides.id}`,
    machineId: overrides.machineId ?? 'mill-1',
    ...overrides
  }
}

// ---------------------------------------------------------------------------
// autoAssignWcsOffsets
// ---------------------------------------------------------------------------

describe('autoAssignWcsOffsets', () => {
  it('assigns G54/G55/G56 to 3 empty setups', () => {
    const setups = [makeSetup({ id: 's1' }), makeSetup({ id: 's2' }), makeSetup({ id: 's3' })]
    const result = autoAssignWcsOffsets(setups)
    expect(result).toHaveLength(3)
    expect(result[0]!.workCoordinateIndex).toBe(1) // G54
    expect(result[1]!.workCoordinateIndex).toBe(2) // G55
    expect(result[2]!.workCoordinateIndex).toBe(3) // G56
  })

  it('preserves existing WCS assignments', () => {
    const setups = [
      makeSetup({ id: 's1', workCoordinateIndex: 3 }),
      makeSetup({ id: 's2' }),
      makeSetup({ id: 's3' })
    ]
    const result = autoAssignWcsOffsets(setups)
    expect(result[0]!.workCoordinateIndex).toBe(3) // kept
    expect(result[1]!.workCoordinateIndex).toBe(1) // first available
    expect(result[2]!.workCoordinateIndex).toBe(2) // second available
  })

  it('fills gaps around existing assignments', () => {
    const setups = [
      makeSetup({ id: 's1', workCoordinateIndex: 2 }),
      makeSetup({ id: 's2', workCoordinateIndex: 4 }),
      makeSetup({ id: 's3' })
    ]
    const result = autoAssignWcsOffsets(setups)
    expect(result[2]!.workCoordinateIndex).toBe(1) // first gap
  })

  it('returns empty array for empty input', () => {
    expect(autoAssignWcsOffsets([])).toEqual([])
  })

  it('handles a single setup', () => {
    const result = autoAssignWcsOffsets([makeSetup({ id: 's1' })])
    expect(result[0]!.workCoordinateIndex).toBe(1)
  })

  it('assigns all 6 offsets to 6 setups', () => {
    const setups = Array.from({ length: 6 }, (_, i) => makeSetup({ id: `s${i + 1}` }))
    const result = autoAssignWcsOffsets(setups)
    for (let i = 0; i < 6; i++) {
      expect(result[i]!.workCoordinateIndex).toBe(i + 1)
    }
  })

  it('throws when more than 6 unassigned setups need offsets', () => {
    const setups = Array.from({ length: 7 }, (_, i) => makeSetup({ id: `s${i + 1}` }))
    expect(() => autoAssignWcsOffsets(setups)).toThrow(/all 6 offsets/)
  })

  it('does not mutate input array', () => {
    const original = makeSetup({ id: 's1' })
    const setups = [original]
    autoAssignWcsOffsets(setups)
    expect(original.workCoordinateIndex).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// wcsIndexToCode
// ---------------------------------------------------------------------------

describe('wcsIndexToCode', () => {
  it('maps 1–6 to G54–G59', () => {
    expect(wcsIndexToCode(1)).toBe('G54')
    expect(wcsIndexToCode(2)).toBe('G55')
    expect(wcsIndexToCode(3)).toBe('G56')
    expect(wcsIndexToCode(4)).toBe('G57')
    expect(wcsIndexToCode(5)).toBe('G58')
    expect(wcsIndexToCode(6)).toBe('G59')
  })

  it('returns undefined for out-of-range values', () => {
    expect(wcsIndexToCode(0)).toBeUndefined()
    expect(wcsIndexToCode(7)).toBeUndefined()
    expect(wcsIndexToCode(-1)).toBeUndefined()
    expect(wcsIndexToCode(1.5)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// validateSetupSequence
// ---------------------------------------------------------------------------

describe('validateSetupSequence', () => {
  it('returns valid for empty sequence', () => {
    const result = validateSetupSequence([])
    expect(result.valid).toBe(true)
    expect(result.issues).toHaveLength(0)
  })

  it('returns valid for a clean single setup', () => {
    const setups = [
      makeSetup({
        id: 's1',
        workCoordinateIndex: 1,
        stock: { kind: 'box', x: 100, y: 100, z: 50 }
      })
    ]
    const result = validateSetupSequence(setups)
    expect(result.valid).toBe(true)
    expect(result.issues).toHaveLength(0)
  })

  it('detects duplicate WCS offsets', () => {
    const setups = [
      makeSetup({ id: 's1', workCoordinateIndex: 1, stock: { kind: 'box', x: 100, y: 80, z: 30 } }),
      makeSetup({ id: 's2', workCoordinateIndex: 1, stock: { kind: 'box', x: 100, y: 80, z: 30 } })
    ]
    const result = validateSetupSequence(setups)
    expect(result.valid).toBe(false)
    const errors = result.issues.filter((i) => i.severity === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0]!.setupId).toBe('s2')
    expect(errors[0]!.message).toContain('Duplicate WCS offset G54')
  })

  it('detects multiple duplicate WCS offsets', () => {
    const setups = [
      makeSetup({ id: 's1', workCoordinateIndex: 2 }),
      makeSetup({ id: 's2', workCoordinateIndex: 2 }),
      makeSetup({ id: 's3', workCoordinateIndex: 2 })
    ]
    const result = validateSetupSequence(setups)
    expect(result.valid).toBe(false)
    // s2 and s3 both conflict with s1
    expect(result.issues.filter((i) => i.severity === 'error')).toHaveLength(2)
  })

  it('warns about missing stock definitions', () => {
    const setups = [makeSetup({ id: 's1' })]
    const result = validateSetupSequence(setups)
    expect(result.valid).toBe(true) // warnings don't make it invalid
    const stockWarning = result.issues.find((i) => i.message.includes('No stock definition'))
    expect(stockWarning).toBeDefined()
    expect(stockWarning!.severity).toBe('warning')
  })

  it('warns when consecutive same-machine setups lack notes', () => {
    const setups = [
      makeSetup({
        id: 's1',
        machineId: 'mill-1',
        stock: { kind: 'box', x: 100, y: 100, z: 50 }
      }),
      makeSetup({
        id: 's2',
        machineId: 'mill-1',
        stock: { kind: 'box', x: 100, y: 100, z: 25 }
      })
    ]
    const result = validateSetupSequence(setups)
    const transferWarning = result.issues.find((i) => i.message.includes('Follows setup'))
    expect(transferWarning).toBeDefined()
    expect(transferWarning!.setupId).toBe('s2')
  })

  it('does not warn about consecutive setups on different machines', () => {
    const setups = [
      makeSetup({
        id: 's1',
        machineId: 'mill-1',
        stock: { kind: 'box', x: 100, y: 100, z: 50 }
      }),
      makeSetup({
        id: 's2',
        machineId: 'lathe-1',
        stock: { kind: 'cylinder', x: 100, z: 50 }
      })
    ]
    const result = validateSetupSequence(setups)
    const transferWarning = result.issues.find((i) => i.message.includes('Follows setup'))
    expect(transferWarning).toBeUndefined()
  })

  it('does not warn when consecutive setup has wcsNote', () => {
    const setups = [
      makeSetup({
        id: 's1',
        machineId: 'mill-1',
        stock: { kind: 'box', x: 100, y: 100, z: 50 }
      }),
      makeSetup({
        id: 's2',
        machineId: 'mill-1',
        stock: { kind: 'box', x: 100, y: 100, z: 25 },
        wcsNote: 'Flip part, touch off Z on bottom face'
      })
    ]
    const result = validateSetupSequence(setups)
    const transferWarning = result.issues.find((i) => i.message.includes('Follows setup'))
    expect(transferWarning).toBeUndefined()
  })

  it('flags more than 6 setups', () => {
    const setups = Array.from({ length: 7 }, (_, i) =>
      makeSetup({ id: `s${i + 1}`, workCoordinateIndex: i < 6 ? i + 1 : undefined })
    )
    const result = validateSetupSequence(setups)
    expect(result.valid).toBe(false)
    const limitError = result.issues.find((i) => i.message.includes('More than 6'))
    expect(limitError).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// extractStockBounds
// ---------------------------------------------------------------------------

describe('extractStockBounds', () => {
  it('extracts box stock dimensions', () => {
    const setup = makeSetup({
      id: 's1',
      stock: { kind: 'box', x: 100, y: 80, z: 30 }
    })
    expect(extractStockBounds(setup)).toEqual({ x: 100, y: 80, z: 30 })
  })

  it('extracts fromExtents stock dimensions', () => {
    const setup = makeSetup({
      id: 's1',
      stock: { kind: 'fromExtents', x: 150, y: 120, z: 40 }
    })
    expect(extractStockBounds(setup)).toEqual({ x: 150, y: 120, z: 40 })
  })

  it('extracts cylinder stock as enclosing box', () => {
    const setup = makeSetup({
      id: 's1',
      stock: { kind: 'cylinder', x: 200, z: 60 }
    })
    // Cylinder: length=200, diameter=60 → box 200 × 60 × 60
    expect(extractStockBounds(setup)).toEqual({ x: 200, y: 60, z: 60 })
  })

  it('returns null for missing stock', () => {
    expect(extractStockBounds(makeSetup({ id: 's1' }))).toBeNull()
  })

  it('returns null for box stock with missing dimensions', () => {
    const setup = makeSetup({
      id: 's1',
      stock: { kind: 'box', x: 100 } // missing y, z
    })
    expect(extractStockBounds(setup)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// computeStockTransfer
// ---------------------------------------------------------------------------

describe('computeStockTransfer', () => {
  it('reduces Z by the cut depth', () => {
    const prev = makeSetup({
      id: 's1',
      stock: { kind: 'box', x: 100, y: 80, z: 30 }
    })
    const next = makeSetup({ id: 's2' })
    const result = computeStockTransfer(prev, next, 10)
    expect(result).toEqual({ x: 100, y: 80, z: 20 })
  })

  it('defaults to 50% Z removal when no cut depth given', () => {
    const prev = makeSetup({
      id: 's1',
      stock: { kind: 'box', x: 100, y: 80, z: 30 }
    })
    const next = makeSetup({ id: 's2' })
    const result = computeStockTransfer(prev, next)
    expect(result).toEqual({ x: 100, y: 80, z: 15 })
  })

  it('clamps remaining Z to zero for deep cuts', () => {
    const prev = makeSetup({
      id: 's1',
      stock: { kind: 'box', x: 100, y: 80, z: 30 }
    })
    const next = makeSetup({ id: 's2' })
    const result = computeStockTransfer(prev, next, 50) // deeper than stock
    expect(result).toEqual({ x: 100, y: 80, z: 0 })
  })

  it('preserves X and Y dimensions', () => {
    const prev = makeSetup({
      id: 's1',
      stock: { kind: 'box', x: 200, y: 150, z: 40 }
    })
    const next = makeSetup({ id: 's2' })
    const result = computeStockTransfer(prev, next, 20)
    expect(result!.x).toBe(200)
    expect(result!.y).toBe(150)
  })

  it('returns null when previous setup has no stock', () => {
    const prev = makeSetup({ id: 's1' })
    const next = makeSetup({ id: 's2' })
    expect(computeStockTransfer(prev, next, 10)).toBeNull()
  })

  it('works with cylinder stock', () => {
    const prev = makeSetup({
      id: 's1',
      stock: { kind: 'cylinder', x: 200, z: 60 }
    })
    const next = makeSetup({ id: 's2' })
    const result = computeStockTransfer(prev, next, 10)
    // Cylinder enclosing box: 200 × 60 × 60, cut 10 from Z
    expect(result).toEqual({ x: 200, y: 60, z: 50 })
  })
})

// ---------------------------------------------------------------------------
// suggestFlipSetup
// ---------------------------------------------------------------------------

describe('suggestFlipSetup', () => {
  it('generates a flip setup with next available WCS', () => {
    const current = makeSetup({
      id: 's1',
      label: 'Op1',
      workCoordinateIndex: 1,
      stock: { kind: 'box', x: 100, y: 80, z: 30 },
      wcsOriginPoint: 'top-center'
    })
    const result = suggestFlipSetup(current, [current])
    expect(result.flipAxis).toBe('X')
    expect(result.setup.workCoordinateIndex).toBe(2) // G55
    expect(result.setup.wcsOriginPoint).toBe('bottom-center')
    expect(result.setup.label).toContain('Flip X')
    expect(result.setup.machineId).toBe(current.machineId)
  })

  it('flips around Y axis when requested', () => {
    const current = makeSetup({
      id: 's1',
      label: 'Op1',
      workCoordinateIndex: 1
    })
    const result = suggestFlipSetup(current, [current], 'Y')
    expect(result.flipAxis).toBe('Y')
    expect(result.setup.id).toContain('flip-y')
    expect(result.setup.label).toContain('Flip Y')
  })

  it('sets WCS origin to top-center when flipping from bottom-center', () => {
    const current = makeSetup({
      id: 's1',
      workCoordinateIndex: 1,
      wcsOriginPoint: 'bottom-center'
    })
    const result = suggestFlipSetup(current, [current])
    expect(result.setup.wcsOriginPoint).toBe('top-center')
  })

  it('preserves stock and fixture info', () => {
    const current = makeSetup({
      id: 's1',
      workCoordinateIndex: 1,
      stock: { kind: 'box', x: 100, y: 80, z: 30, materialType: 'aluminum' },
      fixtureNote: '6" vise, 10mm parallels',
      axisMode: '3axis'
    })
    const result = suggestFlipSetup(current, [current])
    expect(result.setup.stock).toEqual(current.stock)
    expect(result.setup.fixtureNote).toBe('6" vise, 10mm parallels')
    expect(result.setup.axisMode).toBe('3axis')
  })

  it('skips used WCS indices from other setups', () => {
    const s1 = makeSetup({ id: 's1', workCoordinateIndex: 1 })
    const s2 = makeSetup({ id: 's2', workCoordinateIndex: 2 })
    const result = suggestFlipSetup(s1, [s1, s2])
    expect(result.setup.workCoordinateIndex).toBe(3) // G56, skipping 1 and 2
  })

  it('handles all WCS offsets used', () => {
    const setups = Array.from({ length: 6 }, (_, i) =>
      makeSetup({ id: `s${i + 1}`, workCoordinateIndex: i + 1 })
    )
    const result = suggestFlipSetup(setups[0]!, setups)
    expect(result.setup.workCoordinateIndex).toBeUndefined() // none available
  })

  it('includes descriptive WCS note', () => {
    const current = makeSetup({ id: 's1', label: 'Top Face', workCoordinateIndex: 1 })
    const result = suggestFlipSetup(current, [current])
    expect(result.setup.wcsNote).toContain('Flipped 180°')
    expect(result.setup.wcsNote).toContain('Top Face')
  })
})

// ---------------------------------------------------------------------------
// Module constants
// ---------------------------------------------------------------------------

describe('module constants', () => {
  it('WCS_CODES has 6 entries G54–G59', () => {
    expect(WCS_CODES).toHaveLength(6)
    expect(WCS_CODES[0]).toBe('G54')
    expect(WCS_CODES[5]).toBe('G59')
  })

  it('MAX_WCS_OFFSETS is 6', () => {
    expect(MAX_WCS_OFFSETS).toBe(6)
  })
})
