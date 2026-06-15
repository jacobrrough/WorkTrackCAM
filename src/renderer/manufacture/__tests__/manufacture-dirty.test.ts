/**
 * Unit pins for the PURE manufacture dirty-tracking primitives that back the
 * unsaved-changes navigation guard.
 *
 *   - `manufacturePlanFingerprint(mfg)` — a stable, key-order-independent string
 *     of the PERSISTED plan shape (version/setups/operations/plates).
 *   - `isManufacturePlanDirty(current, baseline)` — a plain fingerprint compare.
 *
 * The workspace records the baseline at load / empty / post-save; any later edit
 * changes the live fingerprint and flips `dirty` true. Pure ⇒ node-env.
 */
import { describe, expect, it } from 'vitest'
import {
  manufacturePlanFingerprint,
  isManufacturePlanDirty
} from '../manufacture-dirty'
import {
  emptyManufacture,
  type ManufactureFile,
  type ManufactureOperation,
  type ManufactureSetup,
  type Plate
} from '../../../shared/manufacture-schema'

function op(over: Partial<ManufactureOperation> = {}): ManufactureOperation {
  return { id: 'op-1', kind: 'cnc_pocket', label: 'Pocket 1', ...over }
}
function setup(over: Partial<ManufactureSetup> = {}): ManufactureSetup {
  return { id: 'setup-1', label: 'Setup 1', machineId: 'makera-carvera-3axis', ...over }
}
function plate(over: Partial<Plate> = {}): Plate {
  return { id: 'plate-1', label: 'Plate 1', setups: [], operations: [], ...over }
}

describe('manufacturePlanFingerprint + isManufacturePlanDirty', () => {
  it('identical plans → identical fingerprint → CLEAN', () => {
    const a = emptyManufacture()
    const b = emptyManufacture()
    expect(manufacturePlanFingerprint(a)).toBe(manufacturePlanFingerprint(b))
    expect(isManufacturePlanDirty(manufacturePlanFingerprint(a), manufacturePlanFingerprint(b))).toBe(false)
  })

  it('empty-vs-empty is clean (the load / no-project baseline case)', () => {
    const baseline = manufacturePlanFingerprint(emptyManufacture())
    const current = manufacturePlanFingerprint(emptyManufacture())
    expect(isManufacturePlanDirty(current, baseline)).toBe(false)
  })

  it('adding a SETUP makes the plan dirty', () => {
    const baseline = manufacturePlanFingerprint(emptyManufacture())
    const withSetup: ManufactureFile = {
      ...emptyManufacture(),
      plates: [plate({ setups: [setup()] })]
    }
    expect(isManufacturePlanDirty(manufacturePlanFingerprint(withSetup), baseline)).toBe(true)
  })

  it('adding an OPERATION makes the plan dirty', () => {
    const baseline = manufacturePlanFingerprint(emptyManufacture())
    const withOp: ManufactureFile = {
      ...emptyManufacture(),
      plates: [plate({ operations: [op()] })]
    }
    expect(isManufacturePlanDirty(manufacturePlanFingerprint(withOp), baseline)).toBe(true)
  })

  it('adding a PLATE makes the plan dirty', () => {
    const base = emptyManufacture()
    const baseline = manufacturePlanFingerprint(base)
    const withPlate: ManufactureFile = {
      ...base,
      plates: [...(base.plates ?? []), plate({ id: 'plate-2', label: 'Plate 2' })]
    }
    expect(isManufacturePlanDirty(manufacturePlanFingerprint(withPlate), baseline)).toBe(true)
  })

  it('editing a PERSISTED field of an op (not adding one) makes the plan dirty', () => {
    const before: ManufactureFile = { ...emptyManufacture(), plates: [plate({ operations: [op({ label: 'A' })] })] }
    const after: ManufactureFile = { ...emptyManufacture(), plates: [plate({ operations: [op({ label: 'B' })] })] }
    expect(
      isManufacturePlanDirty(manufacturePlanFingerprint(after), manufacturePlanFingerprint(before))
    ).toBe(true)
  })

  it('is KEY-ORDER independent: a re-keyed but value-equal plan stays clean', () => {
    // A React state update or a Zod re-parse can reorder object keys without
    // changing the persisted meaning; the fingerprint must not flip on that.
    const ordered: ManufactureFile = {
      version: 2,
      setups: [],
      operations: [],
      plates: [{ id: 'p1', label: 'P', setups: [], operations: [op({ id: 'x', kind: 'cnc_pocket', label: 'L' })] }]
    }
    // Same content, keys inserted in a different order at every level.
    const reordered: ManufactureFile = {
      plates: [{ operations: [{ label: 'L', kind: 'cnc_pocket', id: 'x' }], setups: [], label: 'P', id: 'p1' }],
      operations: [],
      setups: [],
      version: 2
    } as ManufactureFile
    expect(manufacturePlanFingerprint(ordered)).toBe(manufacturePlanFingerprint(reordered))
    expect(
      isManufacturePlanDirty(manufacturePlanFingerprint(reordered), manufacturePlanFingerprint(ordered))
    ).toBe(false)
  })

  it('array ORDER is significant: swapping two operations is dirty (order is meaningful)', () => {
    const a: ManufactureFile = {
      ...emptyManufacture(),
      plates: [plate({ operations: [op({ id: '1', label: 'one' }), op({ id: '2', label: 'two' })] })]
    }
    const swapped: ManufactureFile = {
      ...emptyManufacture(),
      plates: [plate({ operations: [op({ id: '2', label: 'two' }), op({ id: '1', label: 'one' })] })]
    }
    expect(
      isManufacturePlanDirty(manufacturePlanFingerprint(swapped), manufacturePlanFingerprint(a))
    ).toBe(true)
  })

  it('does not mutate the input plan', () => {
    const mfg = emptyManufacture()
    const snapshot = JSON.stringify(mfg)
    manufacturePlanFingerprint(mfg)
    expect(JSON.stringify(mfg)).toBe(snapshot)
  })

  it('ignores transient non-persisted keys (only version/setups/operations/plates count)', () => {
    const base = emptyManufacture()
    // Attach a stray UI-ish key the persisted projection must drop.
    const withJunk = { ...base, __selectedOpIndex: 3 } as unknown as ManufactureFile
    expect(manufacturePlanFingerprint(withJunk)).toBe(manufacturePlanFingerprint(base))
  })
})
