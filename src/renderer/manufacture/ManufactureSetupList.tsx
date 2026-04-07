/**
 * ManufactureSetupList — setup rows in the plan sidebar.
 * Extracted from ManufactureWorkspace.tsx (pure refactoring).
 */
import type { ManufactureSetup } from '../../shared/manufacture-schema'
import type { MachineProfile } from '../../shared/machine-schema'
import { FixturePickerPanel } from './FixturePickerPanel'

type Props = {
  setups: ManufactureSetup[]
  machines: MachineProfile[]
  onUpdateSetup: (i: number, patch: Partial<ManufactureSetup>) => void
  onUpdateSetupStock: (i: number, patch: Partial<NonNullable<ManufactureSetup['stock']>>) => void
  onRemoveSetup: (i: number) => void
}

export function ManufactureSetupList({
  setups,
  machines,
  onUpdateSetup,
  onUpdateSetupStock,
  onRemoveSetup
}: Props): React.ReactElement {
  return (
    <>
      <h3 className="subh">Setups</h3>
      <ul className="tools entity-list entity-list--stack">
        {setups.map((s, si) => (
          <li key={s.id}>
            <div className="row">
              <label>
                Label
                <input value={s.label} onChange={(e) => onUpdateSetup(si, { label: e.target.value })} />
              </label>
              <label>
                Machine
                <select
                  value={s.machineId}
                  onChange={(e) => onUpdateSetup(si, { machineId: e.target.value })}
                >
                  {machines.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                WCS note
                <input
                  value={s.wcsNote ?? ''}
                  onChange={(e) => onUpdateSetup(si, { wcsNote: e.target.value || undefined })}
                  placeholder="e.g. Z0 on top of stock"
                />
              </label>
              <label>
                Fixture note
                <input
                  value={s.fixtureNote ?? ''}
                  onChange={(e) => onUpdateSetup(si, { fixtureNote: e.target.value || undefined })}
                  placeholder="e.g. soft jaws, pin against Y+"
                />
              </label>
              <FixturePickerPanel
                selectedFixtureId={s.fixtureNote?.startsWith('[fixture:') ? s.fixtureNote.slice(9, -1) : null}
                onSelectFixture={(fixtureId, fixtureName) => {
                  if (fixtureId && fixtureName) {
                    onUpdateSetup(si, { fixtureNote: `[fixture:${fixtureId}] ${fixtureName}` })
                  } else {
                    onUpdateSetup(si, { fixtureNote: undefined })
                  }
                }}
              />
              <label>
                Work offset
                <select
                  value={String(s.workCoordinateIndex ?? 1)}
                  onChange={(e) =>
                    onUpdateSetup(si, { workCoordinateIndex: Number.parseInt(e.target.value, 10) as 1 | 2 | 3 | 4 | 5 | 6 })
                  }
                >
                  <option value="1">G54 (1)</option>
                  <option value="2">G55 (2)</option>
                  <option value="3">G56 (3)</option>
                  <option value="4">G57 (4)</option>
                  <option value="5">G58 (5)</option>
                  <option value="6">G59 (6)</option>
                </select>
              </label>
              <button type="button" className="secondary" onClick={() => onRemoveSetup(si)} aria-label={`Remove setup ${s.label}`}>
                Remove setup
              </button>
            </div>
            <div className="row">
              <label>
                Stock kind
                <select
                  value={s.stock?.kind ?? 'box'}
                  onChange={(e) =>
                    onUpdateSetupStock(si, { kind: e.target.value as 'box' | 'cylinder' | 'fromExtents' })
                  }
                >
                  <option value="box">Box</option>
                  <option value="cylinder">Cylinder</option>
                  <option value="fromExtents">From extents</option>
                </select>
              </label>
              <label>
                Stock X (mm)
                <input
                  type="number"
                  min={0.01}
                  step={0.1}
                  value={s.stock?.x ?? ''}
                  onChange={(e) => onUpdateSetupStock(si, { x: e.target.value ? Number(e.target.value) : undefined })}
                />
              </label>
              <label>
                Stock Y (mm)
                <input
                  type="number"
                  min={0.01}
                  step={0.1}
                  value={s.stock?.y ?? ''}
                  onChange={(e) => onUpdateSetupStock(si, { y: e.target.value ? Number(e.target.value) : undefined })}
                />
              </label>
              <label>
                Stock Z (mm)
                <input
                  type="number"
                  min={0.01}
                  step={0.1}
                  value={s.stock?.z ?? ''}
                  onChange={(e) => onUpdateSetupStock(si, { z: e.target.value ? Number(e.target.value) : undefined })}
                />
              </label>
              <label>
                Allowance (mm)
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={s.stock?.allowanceMm ?? ''}
                  onChange={(e) =>
                    onUpdateSetupStock(si, { allowanceMm: e.target.value ? Number(e.target.value) : undefined })
                  }
                  placeholder="roughing"
                />
              </label>
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}
