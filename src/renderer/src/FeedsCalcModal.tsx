/**
 * FeedsCalcModal -- Feeds & Speeds Calculator modal dialog.
 * Extracted from ShopApp.tsx (pure refactoring).
 */
import React, { useState } from 'react'
import type { MaterialRecord, ToolRecord } from './shop-types'
import { calcCutParams } from '../../shared/material-schema'
import { useFocusTrap } from './useFocusTrap'

export interface FeedsCalcModalProps {
  materials: MaterialRecord[]
  tools: ToolRecord[]
  onApplyToOp: (params: Record<string, unknown>) => void
  onApplyToAll: (params: Record<string, unknown>) => void
  onClose: () => void
}

export function FeedsCalcModal({
  materials, tools, onApplyToOp, onApplyToAll, onClose
}: FeedsCalcModalProps): React.ReactElement {
  const trapRef = useFocusTrap<HTMLDivElement>()
  const [matId,     setMatId]     = useState(materials[0]?.id ?? '')
  const [toolDiam,  setToolDiam]  = useState(6)
  const [fluteCount, setFluteCount] = useState(2)
  const [toolType,  setToolType]  = useState<'endmill' | 'ball' | 'vbit' | 'drill' | 'default'>('endmill')
  const [customSS,  setCustomSS]  = useState('')   // surface speed override
  const [customCL,  setCustomCL]  = useState('')   // chipload override

  const mat = materials.find(m => m.id === matId)
  const cp = mat?.cutParams?.[toolType] ?? mat?.cutParams?.['default'] ?? null

  // If user typed overrides, apply them on top of the material record
  const effectiveMat = mat && (customSS || customCL) ? {
    ...mat,
    cutParams: {
      ...mat.cutParams,
      [toolType]: {
        ...(cp ?? { docFactor: 0.5, stepoverFactor: 0.45, plungeFactor: 0.3, surfaceSpeedMMin: 100, chiploadMm: 0.03 }),
        ...(customSS ? { surfaceSpeedMMin: +customSS } : {}),
        ...(customCL ? { chiploadMm: +customCL } : {})
      }
    }
  } : mat

  const calc = effectiveMat ? calcCutParams(effectiveMat, toolDiam, fluteCount, toolType) : null

  // Effective chip load per tooth (mm/tooth)
  const effectiveChiploadMm = calc && calc.rpm > 0 && fluteCount > 0
    ? calc.feedMmMin / (calc.rpm * fluteCount)
    : null

  // DOC safety classification relative to tool diameter
  const docSafetyClass = (calc && toolDiam > 0)
    ? (Math.abs(calc.zPassMm) > toolDiam * 1.2 ? 'stat-card--danger'
      : Math.abs(calc.zPassMm) > toolDiam * 0.6 ? 'stat-card--warn'
      : 'stat-card--ok')
    : ''

  const paramsFromCalc = calc ? {
    feedMmMin:   calc.feedMmMin,
    plungeMmMin: calc.plungeMmMin,
    stepoverMm:  calc.stepoverMm,
    zPassMm:     calc.zPassMm,
    toolDiameterMm: toolDiam,
  } : null

  // Sync from tool library selection
  const applyTool = (tid: string): void => {
    const t = tools.find(t => t.id === tid)
    if (!t) return
    setToolDiam(t.diameterMm)
    if (t.fluteCount) setFluteCount(t.fluteCount)
    if (t.type && t.type !== 'other') setToolType(t.type as typeof toolType)
    if (t.surfaceSpeedMMin) setCustomSS(String(t.surfaceSpeedMMin))
    if (t.chiploadMm) setCustomCL(String(t.chiploadMm))
  }

  return (
    <div className="modal-overlay"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={trapRef} className="modal-dialog modal-dialog--md">
        {/* Header */}
        <div className="modal-header">
          <span className="modal-header-title">{'\u2699'} Feeds & Speeds Calculator</span>
          <div className="flex-spacer" />
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose}>{'\u2715'}</button>
        </div>

        <div className="modal-body">
          {/* Inputs */}
          <div className="grid-2 mb-14">
            <div className="form-group grid-full">
              <label>Material</label>
              <select value={matId} onChange={e => { setMatId(e.target.value); setCustomSS(''); setCustomCL('') }}>
                {materials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            {tools.length > 0 && (
              <div className="form-group grid-full">
                <label>Tool from Library</label>
                <select defaultValue="" onChange={e => applyTool(e.target.value)}>
                  <option value="">{'\u2014'} pick to fill fields {'\u2014'}</option>
                  {tools.map(t => <option key={t.id} value={t.id}>{t.diameterMm}mm {t.type}{t.name ? ` \u2014 ${t.name}` : ''}</option>)}
                </select>
              </div>
            )}
            <div className="form-group">
              <label>Tool {'\u00D8'} (mm)</label>
              <input type="number" value={toolDiam} min={0.1} step={0.1}
                onChange={e => setToolDiam(+e.target.value)} />
            </div>
            <div className="form-group">
              <label>Flutes (#)</label>
              <input type="number" value={fluteCount} min={1} max={12} step={1}
                onChange={e => setFluteCount(+e.target.value)} />
            </div>
            <div className="form-group">
              <label>Tool Type</label>
              <select value={toolType} onChange={e => setToolType(e.target.value as typeof toolType)}>
                <option value="endmill">Flat Endmill</option>
                <option value="ball">Ball Nose</option>
                <option value="vbit">V-Bit</option>
                <option value="drill">Drill</option>
                <option value="default">Default</option>
              </select>
            </div>
          </div>

          {/* Override row */}
          <div className="inset-panel mb-14">
            <div className="section-label">
              Override (leave blank to use material defaults)
            </div>
            <div className="grid-2">
              <div className="form-group">
                <label>Surface Speed (m/min)</label>
                <input type="number" placeholder={cp ? String(cp.surfaceSpeedMMin) : '\u2014'} value={customSS}
                  onChange={e => setCustomSS(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Chipload (mm/tooth)</label>
                <input type="number" placeholder={cp ? String(cp.chiploadMm) : '\u2014'} value={customCL} step="0.001"
                  onChange={e => setCustomCL(e.target.value)} />
              </div>
            </div>
          </div>

          {/* Results panel */}
          {calc ? (
            <div className="results-panel mb-14">
              <div className="section-label section-label--accent mb-10">
                Calculated Parameters
              </div>
              <div className="grid-3">
                <div className="stat-card">
                  <div className="stat-card-label">RPM</div>
                  <div className="stat-card-value">{calc.rpm.toLocaleString()}<span className="data-unit">rpm</span></div>
                </div>
                <div className="stat-card">
                  <div className="stat-card-label">Feed</div>
                  <div className="stat-card-value">{calc.feedMmMin.toLocaleString()}<span className="data-unit">mm/min</span></div>
                </div>
                <div className="stat-card">
                  <div className="stat-card-label">Plunge</div>
                  <div className="stat-card-value">{calc.plungeMmMin.toLocaleString()}<span className="data-unit">mm/min</span></div>
                </div>
                <div className={`stat-card ${docSafetyClass}`}>
                  <div className="stat-card-label">DOC{docSafetyClass === 'stat-card--danger' ? ' \u26A0' : docSafetyClass === 'stat-card--warn' ? ' !' : ''}</div>
                  <div className="stat-card-value">{Math.abs(calc.zPassMm).toLocaleString()}<span className="data-unit">mm</span></div>
                </div>
                <div className="stat-card">
                  <div className="stat-card-label">Stepover</div>
                  <div className="stat-card-value">{calc.stepoverMm.toLocaleString()}<span className="data-unit">mm</span></div>
                </div>
                {effectiveChiploadMm !== null && (
                  <div className="stat-card">
                    <div className="stat-card-label">Chip Load</div>
                    <div className="stat-card-value">{effectiveChiploadMm.toFixed(4)}<span className="data-unit">mm/tooth</span></div>
                  </div>
                )}
              </div>
              {calc.feedClampedToFloor ? (
                <p className="text-sm text-muted mt-10 mb-0">
                  Recommended feed {Math.round(calc.recommendedFeedMmMin)} mm/min is below the CAM guardrail floor; using{' '}
                  {calc.feedMmMin} mm/min for operations.
                </p>
              ) : null}
              {docSafetyClass === 'stat-card--danger' && (
                <p className="text-sm text-danger mt-8 mb-0">
                  DOC exceeds tool diameter {'\u2014'} risk of tool breakage. Reduce depth of cut.
                </p>
              )}
              {docSafetyClass === 'stat-card--warn' && (
                <p className="text-sm text-warn mt-8 mb-0">
                  DOC is above 60% of tool diameter {'\u2014'} use conservative feeds or full slotting is not recommended.
                </p>
              )}
            </div>
          ) : (
            <div className="empty-state mb-14">
              Select a material with cut parameters to see calculations
            </div>
          )}

          {/* Action row */}
          <div className="modal-footer p-0">
            <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
            <button className="btn btn-secondary btn-sm" disabled={!paramsFromCalc}
              onClick={() => { if (paramsFromCalc) { onApplyToAll(paramsFromCalc); onClose() } }}>
              Apply to All Ops
            </button>
            <button className="btn btn-primary btn-sm" disabled={!paramsFromCalc}
              onClick={() => { if (paramsFromCalc) { onApplyToOp(paramsFromCalc); onClose() } }}>
              Apply to Selected Op
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
