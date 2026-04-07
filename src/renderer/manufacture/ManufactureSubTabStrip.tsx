import { useCallback, type KeyboardEvent } from 'react'
import type { ManufacturePanelTab } from '../shell/workspaceMemory'

/**
 * Manufacture sub-tab strip — Makera CAM-style tab ordering.
 * Plan → Setup → CAM → Simulate → Slice → Tools
 */
const TABS: { id: ManufacturePanelTab; label: string; icon: string; title: string }[] = [
  { id: 'plan', label: 'Plan', icon: '≡', title: 'Job plan — WCS setups and operation list' },
  { id: 'setup', label: 'Setup', icon: '▣', title: 'Stock parameters, material type, WCS origin' },
  { id: 'cam', label: 'CAM', icon: '⚙', title: 'Generate G-code toolpaths' },
  { id: 'simulate', label: 'Simulate', icon: '▶', title: '3D toolpath simulation viewer' },
  { id: 'slice', label: 'Slice', icon: '⊟', title: 'FDM slicer (CuraEngine)' },
  { id: 'tools', label: 'Tools', icon: '🔧', title: 'Tool library import and management' }
]

function tabA11yLabel(tab: { label: string }, index: number): string {
  return `${tab.label} tab (${index + 1} of ${TABS.length})`
}

type Props = {
  tab: ManufacturePanelTab
  onChange: (t: ManufacturePanelTab) => void
}

export function ManufactureSubTabStrip({ tab, onChange }: Props) {
  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, tabId: ManufacturePanelTab) => {
      const idx = TABS.findIndex((x) => x.id === tabId)
      if (idx < 0) return
      let nextIdx = -1
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault()
        nextIdx = (idx + 1) % TABS.length
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault()
        nextIdx = (idx - 1 + TABS.length) % TABS.length
      } else if (e.key === 'Home') {
        e.preventDefault()
        nextIdx = 0
      } else if (e.key === 'End') {
        e.preventDefault()
        nextIdx = TABS.length - 1
      }
      if (nextIdx < 0) return
      const next = TABS[nextIdx]!
      onChange(next.id)
      queueMicrotask(() => document.getElementById(`mfg-subtab-${next.id}`)?.focus())
    },
    [onChange]
  )

  return (
    <div className="utility-strip-outer">
      <div
        className="utility-strip manufacture-subtab-strip"
        role="tablist"
        aria-label="Manufacture workspace tabs"
        aria-orientation="horizontal"
        aria-describedby="mfg-subtab-kbd-hint mfg-subtab-visible-hint"
      >
        {TABS.map((t, index) => (
          <button
            key={t.id}
            id={`mfg-subtab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls="manufacture-workspace-panel"
            aria-label={tabA11yLabel(t, index)}
            aria-posinset={index + 1}
            aria-setsize={TABS.length}
            tabIndex={tab === t.id ? 0 : -1}
            className={tab === t.id ? 'active' : ''}
            title={t.title}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKeyDown(e, t.id)}
          >
            <span className="mfg-subtab-icon" aria-hidden="true">{t.icon}</span>
            <span className="mfg-subtab-label">{t.label}</span>
          </button>
        ))}
      </div>
      <p id="mfg-subtab-visible-hint" className="utility-strip-hint msg sr-only">
        Manufacture tabs: arrow keys move focus and selection, Home/End jump.
      </p>
      <p id="mfg-subtab-kbd-hint" className="sr-only">
        With a tab focused, use Left/Right or Up/Down arrows to move between tabs. Home and End jump to the first or last tab.
      </p>
    </div>
  )
}
