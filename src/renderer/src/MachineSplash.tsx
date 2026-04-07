/**
 * MachineSplash -- Full-screen machine selection picker shown on every launch.
 * Extracted from ShopApp.tsx (pure refactoring).
 */
import React, { useState } from 'react'
import type { MachineProfile } from './shop-types'
import { getMachineMode, MODE_LABELS, MODE_ICONS } from './shop-types'
import type { MachineUIMode } from './shop-types'

export interface MachineSplashProps {
  machines: MachineProfile[]
  lastMachineId: string | null
  onSelect: (m: MachineProfile) => void
  onAddMachine: () => void
}

export function MachineSplash({ machines, lastMachineId, onSelect, onAddMachine }: MachineSplashProps): React.ReactElement {
  const [activeMode, setActiveMode] = useState<MachineUIMode | 'all'>('all')
  const [selectedId, setSelectedId] = useState<string | null>(lastMachineId)

  const MODES: Array<{ mode: MachineUIMode | 'all'; icon: string; label: string; sub: string }> = [
    { mode: 'all',       icon: '\u2B21', label: 'All',          sub: 'Show everything' },
    { mode: 'fdm',       icon: '\u{1F5A8}', label: 'FDM Printer',  sub: 'Slicer mode' },
    { mode: 'cnc_2d',    icon: '\u229E', label: 'CNC Standard', sub: 'VCarve style' },
    { mode: 'cnc_3d',    icon: '\u2B21', label: 'CNC 3D',       sub: '3D surfacing' },
    { mode: 'cnc_4axis', icon: '\u21BB', label: '4-Axis CNC',   sub: 'Rotary / indexed' },
    { mode: 'cnc_5axis', icon: '\u2726', label: '5-Axis CNC',   sub: 'Multi-axis' },
  ]

  const filtered = machines.filter(m => activeMode === 'all' || getMachineMode(m) === activeMode)
  const selectedMachine = machines.find(m => m.id === selectedId) ?? null

  return (
    <div className="machine-splash">
      <div className="splash-logo">{'\u2B21'}</div>
      <div className="splash-title">Unified Fab Studio</div>
      <div className="splash-subtitle">What machine are you working with today?</div>

      <div className="splash-mode-tabs">
        {MODES.map(({ mode, icon, label, sub }) => (
          <button key={mode}
            className={`splash-mode-tab${activeMode === mode ? ' splash-mode-tab--active' : ''}`}
            onClick={() => setActiveMode(mode)}>
            <span className="splash-mode-icon">{icon}</span>
            <span className="splash-mode-label">
              {label}<br />
              <span className="splash-mode-sub">{sub}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="splash-section-title">
        {activeMode === 'all' ? 'All machines' : `${MODES.find(m => m.mode === activeMode)?.label} machines`}
        {' '}({filtered.length})
      </div>

      <div className="splash-grid">
        {filtered.map(m => {
          const mmode = getMachineMode(m)
          return (
            <div key={m.id}
              className={`splash-card splash-card--${mmode}${m.id === selectedId ? ' splash-card--selected' : ''}`}
              onClick={() => setSelectedId(m.id)}>
              <div className="splash-card-badge">{MODE_LABELS[mmode]}</div>
              <div className="splash-card-name">{m.name}</div>
              <div className="splash-card-meta">
                {m.workAreaMm.x} {'\u00D7'} {m.workAreaMm.y} {'\u00D7'} {m.workAreaMm.z} mm
                {m.meta?.manufacturer ? ` \u00B7 ${m.meta.manufacturer}` : ''}
                {m.meta?.importedFromCps ? ' \u00B7 from .cps' : ''}
              </div>
            </div>
          )
        })}
        <div className="splash-add-card" onClick={onAddMachine}>
          <span className="splash-add-icon">+</span>
          <span>Add / import a machine</span>
        </div>
      </div>

      <div className="splash-cta">
        <button
          className="splash-start-btn"
          disabled={!selectedMachine}
          onClick={() => selectedMachine && onSelect(selectedMachine)}>
          {selectedMachine ? `Start with ${selectedMachine.name} \u2192` : 'Select a machine above'}
        </button>
        <span className="splash-start-hint">
          {selectedMachine
            ? `Mode: ${MODE_LABELS[getMachineMode(selectedMachine)]}  \u00B7  ${MODE_ICONS[getMachineMode(selectedMachine)]}`
            : 'Click a machine card, then press Start'}
        </span>
      </div>
    </div>
  )
}
