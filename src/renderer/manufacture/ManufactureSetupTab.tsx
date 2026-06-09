/**
 * ManufactureSetupTab — the "Setup" sub-tab content (stock, material, WCS origin).
 * Extracted from ManufactureWorkspace.tsx (pure refactoring).
 *
 * Wave 3a (Carvera 4-axis): when the selected setup is in 4-axis mode this tab
 * additionally mounts:
 *   - {@link RotaryOrientGizmo} — produces the `rotaryPlacement` the engine uses
 *     to align a real-world STL to the rotation axis (replaces the historical
 *     hard-coded identity transform in `run-cam-for-op.ts`).
 *   - Tailstock geometry fields — fed into the `RotaryFixtureConfig` collision
 *     sweep (chuck + tailstock) via `run-cam-for-op.ts`.
 *   - {@link MultiSetupWizard} — auto-WCS / validate-sequence / duplicate-at-A180
 *     for double-sided rotary jobs (previously dead, unmounted code).
 */
import type { ManufactureFile, ManufactureSetup } from '../../shared/manufacture-schema'
import type { StockMaterialType, WcsOriginPoint } from '../../shared/manufacture-schema'
import type { MachineProfile } from '../../shared/machine-schema'
import { StockMaterialPanel } from './StockMaterialPanel'
import { RotaryOrientGizmo } from './RotaryOrientGizmo'
import type { Placement } from './rotary-placement'
import { MultiSetupWizard } from './MultiSetupWizard'

type Props = {
  projectDir: string | null
  mfg: ManufactureFile
  machines: MachineProfile[]
  selectedSetupIndex: number
  selectedOpIndex: number
  fitStockPadMm: number
  assetStlOptions: string[]
  onSetSelectedSetupIndex: (i: number) => void
  onAddSetup: () => void
  onRemoveSetup: (i: number) => void
  onUpdateSetup: (i: number, patch: Partial<ManufactureSetup>) => void
  onUpdateSetupStock: (i: number, patch: Partial<NonNullable<ManufactureSetup['stock']>>) => void
  onUpdateSetupMaterialType: (si: number, mat: StockMaterialType | undefined) => void
  onUpdateSetupWcsOrigin: (si: number, point: WcsOriginPoint) => void
  onUpdateSetupAxisMode: (si: number, mode: '3axis' | '4axis' | '5axis') => void
  onFitStockPadChange: (v: number) => void
  onFitStockFromPart: (setupIndex: number) => void
  onSave: () => void
  /** Wave 3a — persist the 4-axis orient-gizmo placement on the setup. */
  onUpdateSetupRotaryPlacement: (si: number, placement: Placement) => void
  /** Wave 3a — replace the entire setups array (Multi-Setup Wizard auto-assign WCS). */
  onReplaceSetups: (setups: ManufactureSetup[]) => void
  /** Wave 3a — append a new setup (Multi-Setup Wizard flip suggestion). */
  onAppendSetup: (setup: ManufactureSetup) => void
  /** Status-bar passthrough for the Multi-Setup Wizard. */
  onStatus?: (msg: string) => void
}

export function ManufactureSetupTab({
  projectDir,
  mfg,
  machines,
  selectedSetupIndex,
  selectedOpIndex,
  fitStockPadMm,
  assetStlOptions,
  onSetSelectedSetupIndex,
  onAddSetup,
  onRemoveSetup,
  onUpdateSetup,
  onUpdateSetupStock,
  onUpdateSetupMaterialType,
  onUpdateSetupWcsOrigin,
  onUpdateSetupAxisMode,
  onFitStockPadChange,
  onFitStockFromPart,
  onSave,
  onUpdateSetupRotaryPlacement,
  onReplaceSetups,
  onAppendSetup,
  onStatus
}: Props): React.ReactElement {
  const selectedSetup = mfg.setups[selectedSetupIndex]
  const is4Axis = selectedSetup?.axisMode === '4axis'
  // Rotary stock diameter (cylinder stock encodes Ø as `z`); feeds the gizmo's
  // advisory "fits Ø / exceeds Ø" radial hint. Box/fromExtents stock has no Ø.
  const rotaryStockDiameterMm =
    selectedSetup?.stock?.kind === 'cylinder' && typeof selectedSetup.stock.z === 'number'
      ? selectedSetup.stock.z
      : undefined
  return (
    <section className="panel workspace-util-panel makera-setup-panel" aria-labelledby="mfg-setup-tab-heading">
      <h2 id="mfg-setup-tab-heading">Stock Parameters</h2>
      {!projectDir ? (
        <p className="msg">No project is open. Use <strong>File &gt; Open Project</strong> to load a project folder before configuring stock parameters.</p>
      ) : mfg.setups.length === 0 ? (
        <div className="msg">
          <p>No setups yet. Add a setup to define the machine, work offset, and stock dimensions for your manufacture plan.</p>
          <button type="button" className="primary" onClick={onAddSetup} aria-label="Add first manufacture setup">Add setup</button>
        </div>
      ) : (
        <>
          {/* Setup selector */}
          <div className="makera-setup-tab-selector" role="tablist" aria-label="Select setup">
            {mfg.setups.map((s, si) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={si === selectedSetupIndex}
                className={`secondary${si === selectedSetupIndex ? ' active' : ''}`}
                onClick={() => onSetSelectedSetupIndex(si)}
              >
                {s.label}
              </button>
            ))}
            <button type="button" className="secondary" onClick={onAddSetup} aria-label="Add new manufacture setup">+ Add</button>
          </div>
          {/* Machine + WCS offset row */}
          {mfg.setups[selectedSetupIndex] ? (
            <>
              <div className="row">
                <label>
                  Setup label
                  <input
                    value={mfg.setups[selectedSetupIndex]!.label}
                    onChange={(e) => onUpdateSetup(selectedSetupIndex, { label: e.target.value })}
                  />
                </label>
                <label>
                  Machine
                  <select
                    value={mfg.setups[selectedSetupIndex]!.machineId}
                    onChange={(e) => onUpdateSetup(selectedSetupIndex, { machineId: e.target.value })}
                  >
                    {machines.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Work offset
                  <select
                    value={String(mfg.setups[selectedSetupIndex]!.workCoordinateIndex ?? 1)}
                    onChange={(e) => onUpdateSetup(selectedSetupIndex, { workCoordinateIndex: Number.parseInt(e.target.value, 10) as 1|2|3|4|5|6 })}
                  >
                    <option value="1">G54 (1)</option>
                    <option value="2">G55 (2)</option>
                    <option value="3">G56 (3)</option>
                    <option value="4">G57 (4)</option>
                    <option value="5">G58 (5)</option>
                    <option value="6">G59 (6)</option>
                  </select>
                </label>
                <label>
                  WCS note
                  <input
                    value={mfg.setups[selectedSetupIndex]!.wcsNote ?? ''}
                    onChange={(e) => onUpdateSetup(selectedSetupIndex, { wcsNote: e.target.value || undefined })}
                    placeholder="e.g. Z0 on top of stock"
                  />
                </label>
              </div>
              <StockMaterialPanel
                setup={mfg.setups[selectedSetupIndex]!}
                setupIndex={selectedSetupIndex}
                fitStockPadMm={fitStockPadMm}
                assetStlPaths={assetStlOptions}
                currentSourceMesh={mfg.operations[selectedOpIndex]?.sourceMesh?.trim()}
                onFitStockPadChange={onFitStockPadChange}
                onFitFromPart={onFitStockFromPart}
                onStockKindChange={(kind) => onUpdateSetupStock(selectedSetupIndex, { kind })}
                onStockDimChange={(field, value) => onUpdateSetupStock(selectedSetupIndex, { [field]: value })}
                onMaterialTypeChange={(mat) => onUpdateSetupMaterialType(selectedSetupIndex, mat)}
                onWcsOriginChange={(pt) => onUpdateSetupWcsOrigin(selectedSetupIndex, pt)}
                onAxisModeChange={(mode) => onUpdateSetupAxisMode(selectedSetupIndex, mode)}
                onRotaryChuckDepthMmChange={(mm) =>
                  onUpdateSetup(selectedSetupIndex, { rotaryChuckDepthMm: mm })
                }
                onRotaryClampOffsetMmChange={(mm) =>
                  onUpdateSetup(selectedSetupIndex, { rotaryClampOffsetMm: mm })
                }
                onRotaryStockProfileChange={(profile) =>
                  onUpdateSetup(selectedSetupIndex, { rotaryStockProfile: profile })
                }
              />
              {is4Axis ? (
                <section
                  className="panel panel--nested rotary-setup-section"
                  aria-label="4-axis rotary setup"
                  data-testid="rotary-setup-section"
                >
                  {/* ── Part orientation gizmo (catalog Carvera P0) ── */}
                  <RotaryOrientGizmo
                    value={selectedSetup?.rotaryPlacement ?? undefined}
                    stockDiameterMm={rotaryStockDiameterMm}
                    onChange={(placement) =>
                      onUpdateSetupRotaryPlacement(selectedSetupIndex, placement)
                    }
                  />

                  {/* ── Tailstock geometry (catalog Carvera P1) ── */}
                  <fieldset className="rotary-tailstock" data-testid="rotary-tailstock-fields">
                    <legend>Tailstock (collision sweep)</legend>
                    <p className="msg msg--muted msg--xs">
                      Set both fields to include the tailstock body in the 4-axis collision check.
                      Advisory only — surfaces clearance warnings; never changes the toolpath.
                    </p>
                    <div className="row">
                      <label title="Outer radius of the rotary chuck body (mm). Overrides the machine-profile default in the collision sweep.">
                        Chuck Ø radius (mm)
                        <input
                          type="number"
                          min={0}
                          step={1}
                          data-testid="rotary-chuck-outer-radius"
                          value={
                            typeof selectedSetup?.rotaryChuckOuterRadiusMm === 'number'
                              ? String(selectedSetup.rotaryChuckOuterRadiusMm)
                              : ''
                          }
                          onChange={(e) => {
                            const v = e.target.value.trim()
                            const n = v === '' ? undefined : Number.parseFloat(v)
                            onUpdateSetup(selectedSetupIndex, {
                              rotaryChuckOuterRadiusMm:
                                typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined
                            })
                          }}
                          placeholder="profile default"
                        />
                      </label>
                      <label title="Axial X where the tailstock body begins (mm), measured along the rotation axis.">
                        Tailstock start X (mm)
                        <input
                          type="number"
                          min={0}
                          step={1}
                          data-testid="rotary-tailstock-start-x"
                          value={
                            typeof selectedSetup?.rotaryTailstockStartXMm === 'number'
                              ? String(selectedSetup.rotaryTailstockStartXMm)
                              : ''
                          }
                          onChange={(e) => {
                            const v = e.target.value.trim()
                            const n = v === '' ? undefined : Number.parseFloat(v)
                            onUpdateSetup(selectedSetupIndex, {
                              rotaryTailstockStartXMm:
                                typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : undefined
                            })
                          }}
                          placeholder="disabled"
                        />
                      </label>
                      <label title="Outer radius of the tailstock body (mm).">
                        Tailstock Ø radius (mm)
                        <input
                          type="number"
                          min={0}
                          step={1}
                          data-testid="rotary-tailstock-outer-radius"
                          value={
                            typeof selectedSetup?.rotaryTailstockOuterRadiusMm === 'number'
                              ? String(selectedSetup.rotaryTailstockOuterRadiusMm)
                              : ''
                          }
                          onChange={(e) => {
                            const v = e.target.value.trim()
                            const n = v === '' ? undefined : Number.parseFloat(v)
                            onUpdateSetup(selectedSetupIndex, {
                              rotaryTailstockOuterRadiusMm:
                                typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined
                            })
                          }}
                          placeholder="disabled"
                        />
                      </label>
                    </div>
                  </fieldset>

                  {/* ── Multi-setup / double-sided wizard (catalog Carvera P1) ── */}
                  <MultiSetupWizard
                    setups={mfg.setups}
                    selectedSetupIndex={selectedSetupIndex}
                    onSetupsChange={onReplaceSetups}
                    onAddSetup={onAppendSetup}
                    onStatus={onStatus}
                  />
                </section>
              ) : null}
              <div className="row mfg-action-row">
                <button type="button" className="primary" onClick={onSave} aria-label="Save manufacture plan">Save</button>
                <button type="button" className="secondary" onClick={() => onRemoveSetup(selectedSetupIndex)} disabled={mfg.setups.length <= 1} aria-label={`Remove setup ${mfg.setups[selectedSetupIndex]?.label ?? ''}`}>Remove setup</button>
              </div>
            </>
          ) : null}
        </>
      )}
    </section>
  )
}
