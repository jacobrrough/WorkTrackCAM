/**
 * ManufacturePlanToolbar — import/bind/fit/add/save action buttons in the plan sidebar.
 * Extracted from ManufactureWorkspace.tsx (pure refactoring).
 */
import type { ManufactureOperation, ManufactureSetup } from '../../shared/manufacture-schema'

type Props = {
  operations: ManufactureOperation[]
  selectedOpIndex: number
  camResolvedSetupIdx: number
  camResolvedSetup: ManufactureSetup | undefined
  camResolvedMachineName: string | undefined
  assetStlOptions: string[]
  fitStockPadMm: number
  onImportMesh: () => void
  onBindStl: (sourceMesh: string | undefined) => void
  onFitStockPadChange: (v: number) => void
  onFitStockFromPart: (setupIndex: number) => void
  onAddSetup: () => void
  onAddOp: () => void
  onSave: () => void
}

export function ManufacturePlanToolbar({
  operations,
  selectedOpIndex,
  camResolvedSetupIdx,
  camResolvedSetup,
  camResolvedMachineName,
  assetStlOptions,
  fitStockPadMm,
  onImportMesh,
  onBindStl,
  onFitStockPadChange,
  onFitStockFromPart,
  onAddSetup,
  onAddOp,
  onSave
}: Props): React.ReactElement {
  return (
    <>
      {camResolvedSetup ? (
        <section className="panel panel--nested" aria-label="CAM setup context for Make Generate CAM">
          <h3 className="subh">Setup for Make &rarr; Generate CAM</h3>
          <p className="msg msg--muted">
            Uses the manufacture setup whose machine matches the project&apos;s active CNC machine (or the first CNC
            machine). Current row: <strong>{camResolvedSetup.label}</strong>
            {camResolvedMachineName ? (
              <>
                {' '}
                &mdash; <strong>{camResolvedMachineName}</strong>
              </>
            ) : null}
            , work offset <strong>G{53 + (camResolvedSetup.workCoordinateIndex ?? 1)}</strong>
            {camResolvedSetup.wcsNote ? (
              <>
                . WCS: {camResolvedSetup.wcsNote}
              </>
            ) : null}
            {camResolvedSetup.stock?.kind === 'box' &&
            camResolvedSetup.stock.x != null &&
            camResolvedSetup.stock.y != null &&
            camResolvedSetup.stock.z != null ? (
              <>
                . Stock (box): {camResolvedSetup.stock.x}&times;{camResolvedSetup.stock.y}&times;{camResolvedSetup.stock.z} mm
              </>
            ) : camResolvedSetup.stock?.kind === 'cylinder' ? (
              <>. Stock: cylinder (see dimensions on setup)</>
            ) : camResolvedSetup.stock?.kind === 'fromExtents' ? (
              <>. Stock: from part extents (preview) &mdash; use Fit stock from part to persist a box.</>
            ) : null}
            . <code>contourPoints</code> / <code>drillPoints</code> are in this WCS.
          </p>
        </section>
      ) : null}
      <div className="row row--wrap manufacture-fab-import-row">
        <button type="button" className="secondary" onClick={onImportMesh} aria-label="Import mesh file into project assets">
          Import mesh into project&hellip;
        </button>
        <label>
          Bind STL from project
          <select
            value={operations[selectedOpIndex]?.sourceMesh ?? ''}
            onChange={(e) => {
              if (operations.length === 0) return
              onBindStl(e.target.value || undefined)
            }}
            disabled={operations.length === 0}
          >
            <option value="">&mdash;</option>
            {assetStlOptions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label>
          Fit padding (mm)
          <input
            type="number"
            min={0}
            step={0.5}
            value={fitStockPadMm}
            onChange={(e) => onFitStockPadChange(Number.parseFloat(e.target.value) || 0)}
          />
        </label>
        <button
          type="button"
          className="secondary"
          onClick={() => onFitStockFromPart(camResolvedSetupIdx)}
          title="Set CAM setup stock to axis-aligned box from selected op STL + padding"
          aria-label="Fit stock dimensions from part bounding box"
        >
          Fit stock from part
        </button>
      </div>
      <div className="row">
        <button type="button" className="secondary" onClick={onAddSetup} aria-label="Add new manufacture setup">
          Add setup
        </button>
        <button type="button" className="secondary" onClick={onAddOp} aria-label="Add new manufacture operation">
          Add operation
        </button>
        <button type="button" className="primary" onClick={onSave} aria-label="Save manufacture plan to manufacture.json">
          Save manufacture.json
        </button>
      </div>
    </>
  )
}
