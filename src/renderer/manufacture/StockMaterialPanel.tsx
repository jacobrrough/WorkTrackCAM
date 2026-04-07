import type { ReactNode } from 'react'
import {
  STOCK_MATERIAL_LABELS,
  STOCK_MATERIAL_TYPES,
  type ManufactureSetup,
  type StockMaterialType,
  type WcsOriginPoint
} from '../../shared/manufacture-schema'
import { WcsOriginPicker } from './WcsOriginPicker'

type Props = {
  setup: ManufactureSetup
  setupIndex: number
  fitStockPadMm: number
  assetStlPaths: string[]
  currentSourceMesh: string | undefined
  onFitStockPadChange: (mm: number) => void
  onFitFromPart: (setupIndex: number) => void
  onStockKindChange: (kind: 'box' | 'cylinder' | 'fromExtents') => void
  onStockDimChange: (field: 'x' | 'y' | 'z' | 'allowanceMm', value: number | undefined) => void
  onMaterialTypeChange: (mat: StockMaterialType | undefined) => void
  onWcsOriginChange: (point: WcsOriginPoint) => void
  onAxisModeChange: (mode: '3axis' | '4axis' | '5axis') => void
  onRotaryChuckDepthMmChange?: (mm: number | undefined) => void
  onRotaryClampOffsetMmChange?: (mm: number | undefined) => void
  onRotaryStockProfileChange?: (profile: 'cylinder' | 'square') => void
}

export function StockMaterialPanel({
  setup,
  setupIndex,
  fitStockPadMm,
  assetStlPaths,
  currentSourceMesh,
  onFitStockPadChange,
  onFitFromPart,
  onStockKindChange,
  onStockDimChange,
  onMaterialTypeChange,
  onWcsOriginChange,
  onAxisModeChange,
  onRotaryChuckDepthMmChange,
  onRotaryClampOffsetMmChange,
  onRotaryStockProfileChange
}: Props): ReactNode {
  const stock = setup.stock
  const matType = stock?.materialType

  return (
    <div className="stock-material-panel">
      {/* ── AXIS MODE ── */}
      <div className="stock-material-panel__section">
        <div className="stock-material-panel__section-label">Axis Mode</div>
        <div className="stock-material-panel__axis-toggle" role="group" aria-label="Axis mode">
          {(['3axis', '4axis', '5axis'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`stock-material-panel__axis-btn${setup.axisMode === mode || (!setup.axisMode && mode === '3axis') ? ' stock-material-panel__axis-btn--active' : ''}`}
              onClick={() => onAxisModeChange(mode)}
            >
              {mode === '3axis' ? '3-Axis' : mode === '4axis' ? '4-Axis' : '5-Axis'}
            </button>
          ))}
        </div>
      </div>

      {setup.axisMode === '4axis' ? (
        <div className="stock-material-panel__section">
          <div className="stock-material-panel__section-label">4-axis rotary (CAM)</div>
          <div className="stock-material-panel__dims-row">
            <label className="stock-material-panel__field-group">
              <span className="stock-material-panel__field-label">Stock profile</span>
              <select
                value={setup.rotaryStockProfile ?? 'cylinder'}
                onChange={(e) => onRotaryStockProfileChange?.(e.target.value as 'cylinder' | 'square')}
                className="stock-material-panel__select"
              >
                <option value="cylinder">{'\u25CB'} Cylinder (round bar)</option>
                <option value="square">{'\u25A1'} Square (square bar)</option>
              </select>
            </label>
          </div>
          <div className="stock-material-panel__dims-row">
            <label className="stock-material-panel__field-group">
              <span className="stock-material-panel__field-label">Chuck depth (mm)</span>
              <input
                type="number"
                min={0}
                step={0.5}
                className="stock-material-panel__input"
                value={setup.rotaryChuckDepthMm ?? ''}
                onChange={(e) =>
                  onRotaryChuckDepthMmChange?.(
                    e.target.value === '' ? undefined : Math.max(0, Number.parseFloat(e.target.value) || 0)
                  )
                }
                placeholder="0"
              />
            </label>
            <label className="stock-material-panel__field-group">
              <span className="stock-material-panel__field-label">Clamp offset (mm)</span>
              <input
                type="number"
                min={0}
                step={0.5}
                className="stock-material-panel__input"
                value={setup.rotaryClampOffsetMm ?? ''}
                onChange={(e) =>
                  onRotaryClampOffsetMmChange?.(
                    e.target.value === '' ? undefined : Math.max(0, Number.parseFloat(e.target.value) || 0)
                  )
                }
                placeholder="0"
              />
            </label>
          </div>
          <p className="text-hint mt-6">
            In-chuck zone + buffer reduce machinable X along the bar — see docs/CAM_4TH_AXIS_REFERENCE.md.
          </p>
        </div>
      ) : null}

      {/* ── MATERIAL TYPE ── */}
      <div className="stock-material-panel__section">
        <div className="stock-material-panel__section-label">Material</div>
        <div className="stock-material-panel__material-grid" role="list" aria-label="Stock material type">
          {STOCK_MATERIAL_TYPES.map((mat) => (
            <button
              key={mat}
              type="button"
              role="listitem"
              aria-pressed={matType === mat}
              className={`stock-material-panel__mat-chip${matType === mat ? ' stock-material-panel__mat-chip--active' : ''}`}
              onClick={() => onMaterialTypeChange(matType === mat ? undefined : mat)}
              title={STOCK_MATERIAL_LABELS[mat]}
            >
              {STOCK_MATERIAL_LABELS[mat]}
            </button>
          ))}
        </div>
      </div>

      {/* ── STOCK SHAPE & DIMENSIONS ── */}
      <div className="stock-material-panel__section">
        <div className="stock-material-panel__section-label">Stock</div>
        <div className="stock-material-panel__dims-row">
          <label className="stock-material-panel__field-group">
            <span className="stock-material-panel__field-label">Shape</span>
            <select
              value={stock?.kind ?? 'box'}
              onChange={(e) => onStockKindChange(e.target.value as 'box' | 'cylinder' | 'fromExtents')}
              className="stock-material-panel__select"
            >
              <option value="box">Box</option>
              <option value="cylinder">Cylinder</option>
              <option value="fromExtents">From extents</option>
            </select>
          </label>

          {(stock?.kind === 'box' || !stock?.kind) && (
            <>
              <label className="stock-material-panel__field-group">
                <span className="stock-material-panel__field-label">X (mm)</span>
                <input
                  type="number"
                  min={0.01}
                  step={0.5}
                  className="stock-material-panel__input"
                  value={stock?.x ?? ''}
                  onChange={(e) => onStockDimChange('x', e.target.value ? Number(e.target.value) : undefined)}
                  placeholder="200"
                />
              </label>
              <label className="stock-material-panel__field-group">
                <span className="stock-material-panel__field-label">Y (mm)</span>
                <input
                  type="number"
                  min={0.01}
                  step={0.5}
                  className="stock-material-panel__input"
                  value={stock?.y ?? ''}
                  onChange={(e) => onStockDimChange('y', e.target.value ? Number(e.target.value) : undefined)}
                  placeholder="200"
                />
              </label>
              <label className="stock-material-panel__field-group">
                <span className="stock-material-panel__field-label">Z (mm)</span>
                <input
                  type="number"
                  min={0.01}
                  step={0.1}
                  className="stock-material-panel__input"
                  value={stock?.z ?? ''}
                  onChange={(e) => onStockDimChange('z', e.target.value ? Number(e.target.value) : undefined)}
                  placeholder="25"
                />
              </label>
              <label className="stock-material-panel__field-group">
                <span className="stock-material-panel__field-label">Allowance</span>
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  className="stock-material-panel__input"
                  value={stock?.allowanceMm ?? ''}
                  onChange={(e) => onStockDimChange('allowanceMm', e.target.value ? Number(e.target.value) : undefined)}
                  placeholder="0"
                />
              </label>
            </>
          )}
        </div>

        {/* Stock summary pill */}
        {stock?.kind === 'box' && stock.x != null && stock.y != null && stock.z != null && (
          <div className="stock-material-panel__stock-summary">
            <span className="stock-material-panel__stock-pill">
              ▣ {stock.x}×{stock.y}×{stock.z} mm
              {stock.allowanceMm ? ` +${stock.allowanceMm}mm` : ''}
            </span>
            {matType && (
              <span className="stock-material-panel__mat-pill">
                {STOCK_MATERIAL_LABELS[matType]}
              </span>
            )}
          </div>
        )}

        {/* Fit from part */}
        <div className="stock-material-panel__fit-row">
          <label className="stock-material-panel__field-group">
            <span className="stock-material-panel__field-label">Pad (mm)</span>
            <input
              type="number"
              min={0}
              step={0.5}
              className="stock-material-panel__input stock-material-panel__input--sm"
              value={fitStockPadMm}
              onChange={(e) => onFitStockPadChange(Number.parseFloat(e.target.value) || 0)}
            />
          </label>
          <button
            type="button"
            className="stock-material-panel__fit-btn"
            onClick={() => onFitFromPart(setupIndex)}
            title="Set stock dimensions from selected operation's STL bounding box"
          >
            Fit stock from part
          </button>
        </div>
      </div>

      {/* ── WCS ORIGIN PICKER ── */}
      <div className="stock-material-panel__section">
        <WcsOriginPicker
          value={setup.wcsOriginPoint}
          onChange={onWcsOriginChange}
        />
      </div>
    </div>
  )
}
