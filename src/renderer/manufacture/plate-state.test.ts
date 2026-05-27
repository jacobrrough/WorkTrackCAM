/**
 * Gap #7 v1 -- pure plate-state reducer tests.
 *
 * Covers add / remove / rename + viewMfgAsActivePlate + updateActivePlate.
 * No DOM, no IPC -- these are the reducers powering `ManufactureWorkspace`\'s
 * PlateTabs handlers.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_PLATE_ID, emptyManufacture, type ManufactureFile, type Plate } from '../../shared/manufacture-schema'
import {
  addPlate,
  getActivePlate,
  getPlates,
  removePlate,
  renamePlate,
  updateActivePlate,
  viewMfgAsActivePlate
} from './plate-state'

/** Build a fresh mfg with N plates, each with the given setup/op counts. */
function mfgWithPlates(plateSpecs: Array<{ id?: string; label?: string; setupIds?: string[]; opIds?: string[] }>): ManufactureFile {
  const plates: Plate[] = plateSpecs.map((spec, i) => ({
    id: spec.id ?? `plate-${i + 1}`,
    label: spec.label ?? `Plate ${i + 1}`,
    setups: (spec.setupIds ?? []).map((sid) => ({ id: sid, label: sid, machineId: 'creality-k2-plus' })),
    operations: (spec.opIds ?? []).map((oid) => ({ id: oid, kind: 'fdm_slice' as const, label: oid }))
  }))
  return { version: 2, setups: [], operations: [], plates }
}

describe('getPlates', () => {
  it('returns mfg.plates when present and non-empty', () => {
    const mfg = mfgWithPlates([{}, {}, {}])
    expect(getPlates(mfg)).toHaveLength(3)
  })

  it('synthesizes a single Default plate from legacy top-level when plates missing', () => {
    const legacy: ManufactureFile = {
      version: 1,
      setups: [{ id: 's-legacy', label: 'S', machineId: 'mill-1' }],
      operations: [{ id: 'op-legacy', kind: 'cnc_parallel', label: 'O' }]
    }
    const plates = getPlates(legacy)
    expect(plates).toHaveLength(1)
    expect(plates[0]!.id).toBe(DEFAULT_PLATE_ID)
    expect(plates[0]!.label).toBe('Default plate')
    expect(plates[0]!.setups[0]!.id).toBe('s-legacy')
    expect(plates[0]!.operations[0]!.id).toBe('op-legacy')
  })

  it('synthesizes a single Default plate when plates is an empty array', () => {
    const mfg: ManufactureFile = { version: 2, setups: [], operations: [], plates: [] }
    expect(getPlates(mfg)).toHaveLength(1)
  })
})

describe('getActivePlate', () => {
  it('returns the plate matching activePlateId when found', () => {
    const mfg = mfgWithPlates([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }])
    expect(getActivePlate(mfg, 'p2').id).toBe('p2')
  })

  it('falls back to plates[0] when activePlateId is null', () => {
    const mfg = mfgWithPlates([{ id: 'p1' }, { id: 'p2' }])
    expect(getActivePlate(mfg, null).id).toBe('p1')
  })

  it('falls back to plates[0] when activePlateId is not in the list', () => {
    const mfg = mfgWithPlates([{ id: 'p1' }, { id: 'p2' }])
    expect(getActivePlate(mfg, 'p-ghost').id).toBe('p1')
  })
})

describe('viewMfgAsActivePlate', () => {
  it('projects the active plate setups/ops onto the top-level for downstream consumers', () => {
    const mfg = mfgWithPlates([
      { id: 'p1', setupIds: ['s-a'], opIds: ['op-a'] },
      { id: 'p2', setupIds: ['s-b', 's-c'], opIds: ['op-b'] }
    ])
    const view = viewMfgAsActivePlate(mfg, 'p2')
    expect(view.setups.map((s) => s.id)).toEqual(['s-b', 's-c'])
    expect(view.operations.map((o) => o.id)).toEqual(['op-b'])
    // Original mfg untouched
    expect(mfg.setups).toEqual([])
    expect(mfg.plates![0]!.setups[0]!.id).toBe('s-a')
  })

  it('preserves version and plates fields on the projected view', () => {
    const mfg = mfgWithPlates([{ id: 'p1' }])
    const view = viewMfgAsActivePlate(mfg, 'p1')
    expect(view.version).toBe(2)
    expect(view.plates).toHaveLength(1)
  })
})

describe('updateActivePlate', () => {
  it('applies the updater to only the active plate', () => {
    const mfg = mfgWithPlates([
      { id: 'p1', setupIds: ['s-a'] },
      { id: 'p2', setupIds: ['s-b'] }
    ])
    const next = updateActivePlate(mfg, 'p2', (plate) => ({
      ...plate,
      setups: [...plate.setups, { id: 's-new', label: 'S new', machineId: 'creality-k2-plus' }]
    }))
    expect(next.plates![0]!.setups.map((s) => s.id)).toEqual(['s-a'])
    expect(next.plates![1]!.setups.map((s) => s.id)).toEqual(['s-b', 's-new'])
  })

  it('targets plates[0] when activePlateId is null', () => {
    const mfg = mfgWithPlates([{ id: 'p1' }, { id: 'p2' }])
    const next = updateActivePlate(mfg, null, (plate) => ({ ...plate, label: 'changed' }))
    expect(next.plates![0]!.label).toBe('changed')
    expect(next.plates![1]!.label).toBe('Plate 2')
  })

  it('clears top-level setups/operations on every update (v2 invariant)', () => {
    const mfg: ManufactureFile = {
      version: 2,
      // legacy top-level data that should be wiped on plate writes
      setups: [{ id: 's-legacy', label: 'L', machineId: 'mill-1' }],
      operations: [{ id: 'op-legacy', kind: 'cnc_parallel', label: 'L' }],
      plates: [{ id: 'p1', label: 'P1', setups: [], operations: [] }]
    }
    const next = updateActivePlate(mfg, 'p1', (p) => p)
    expect(next.setups).toEqual([])
    expect(next.operations).toEqual([])
  })
})

describe('addPlate', () => {
  it('appends a new plate and returns its id', () => {
    const mfg = mfgWithPlates([{ id: 'p1' }])
    const { mfg: next, newPlateId } = addPlate(mfg)
    expect(next.plates).toHaveLength(2)
    expect(newPlateId).toBe(next.plates![1]!.id)
    expect(newPlateId).not.toBe('p1')
  })

  it('auto-numbers the label as "Plate N"', () => {
    const mfg = mfgWithPlates([{}, {}, {}])
    const { mfg: next } = addPlate(mfg)
    expect(next.plates![3]!.label).toBe('Plate 4')
  })

  it('adds a plate even when the input has no plates field (back-compat)', () => {
    const legacy: ManufactureFile = { version: 1, setups: [], operations: [] }
    const { mfg: next, newPlateId } = addPlate(legacy)
    // getPlates synthesizes one Default plate, then addPlate appends -- total 2.
    expect(next.plates).toHaveLength(2)
    expect(newPlateId).toBe(next.plates![1]!.id)
  })

  it('stamps createdAt on the new plate', () => {
    const { mfg } = addPlate(mfgWithPlates([{ id: 'p1' }]))
    const created = mfg.plates![1]!.createdAt
    expect(created).toBeDefined()
    expect(() => new Date(created!).toISOString()).not.toThrow()
  })
})

describe('removePlate', () => {
  it('removes the plate with the given id and returns the next-active plate id', () => {
    const mfg = mfgWithPlates([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }])
    const { mfg: next, nextActivePlateId } = removePlate(mfg, 'p2')
    expect(next.plates).toHaveLength(2)
    expect(next.plates!.map((p) => p.id)).toEqual(['p1', 'p3'])
    // Biases to previous index (p1)
    expect(nextActivePlateId).toBe('p1')
  })

  it('refuses to remove the last plate (returns mfg unchanged)', () => {
    const mfg = mfgWithPlates([{ id: 'p-only' }])
    const { mfg: next, nextActivePlateId } = removePlate(mfg, 'p-only')
    expect(next).toBe(mfg)
    expect(nextActivePlateId).toBe('p-only')
  })

  it('is a no-op when the plate id is unknown', () => {
    const mfg = mfgWithPlates([{ id: 'p1' }, { id: 'p2' }])
    const { mfg: next, nextActivePlateId } = removePlate(mfg, 'p-ghost')
    expect(next).toBe(mfg)
    expect(nextActivePlateId).toBe('p1')
  })

  it('clears top-level setups/operations on remove (v2 invariant)', () => {
    const mfg: ManufactureFile = {
      version: 2,
      setups: [{ id: 's-legacy', label: 'L', machineId: 'mill-1' }],
      operations: [],
      plates: [
        { id: 'p1', label: 'P1', setups: [], operations: [] },
        { id: 'p2', label: 'P2', setups: [], operations: [] }
      ]
    }
    const { mfg: next } = removePlate(mfg, 'p2')
    expect(next.setups).toEqual([])
    expect(next.operations).toEqual([])
  })
})

describe('renamePlate', () => {
  it('renames the matching plate', () => {
    const mfg = mfgWithPlates([{ id: 'p1' }, { id: 'p2' }])
    const next = renamePlate(mfg, 'p2', 'K2 calibration tower')
    expect(next.plates![0]!.label).toBe('Plate 1')
    expect(next.plates![1]!.label).toBe('K2 calibration tower')
  })

  it('trims whitespace from the new label', () => {
    const mfg = mfgWithPlates([{ id: 'p1' }])
    const next = renamePlate(mfg, 'p1', '   trimmed  ')
    expect(next.plates![0]!.label).toBe('trimmed')
  })

  it('ignores whitespace-only labels (defensive)', () => {
    const mfg = mfgWithPlates([{ id: 'p1' }])
    const next = renamePlate(mfg, 'p1', '   ')
    expect(next).toBe(mfg)
  })

  it('is a no-op when the plate id is unknown (returns a new file but same plates content)', () => {
    const mfg = mfgWithPlates([{ id: 'p1' }])
    const next = renamePlate(mfg, 'p-ghost', 'no effect')
    expect(next.plates![0]!.label).toBe('Plate 1')
  })
})

describe('integration with emptyManufacture', () => {
  it('starts with one default plate that is the only choice', () => {
    const mfg = emptyManufacture()
    expect(getPlates(mfg)).toHaveLength(1)
    expect(getActivePlate(mfg, null).id).toBe(DEFAULT_PLATE_ID)
  })

  it('addPlate from emptyManufacture leaves the default plate untouched', () => {
    const { mfg: next, newPlateId } = addPlate(emptyManufacture())
    expect(next.plates).toHaveLength(2)
    expect(next.plates![0]!.id).toBe(DEFAULT_PLATE_ID)
    expect(newPlateId).not.toBe(DEFAULT_PLATE_ID)
  })
})
