import React, { useState } from 'react'

export type NavSection = 'jobs' | 'tools' | 'workshop' | 'library' | 'settings' | 'myshop' | null

interface NavRailProps {
  active: NavSection
  onSelect: (s: NavSection) => void
  jobCount: number
  opCount: number
}

const ITEMS: { id: NavSection; icon: string; label: string; shortcut?: string }[] = [
  { id: 'jobs',     icon: '\u{1F4CB}', label: 'Jobs',     shortcut: '1' },
  { id: 'tools',    icon: '\u{1F527}', label: 'Tools',    shortcut: '2' },
  // Workshop dashboard (Gap #10) — consolidates per-machine status,
  // last outcome, and quick action for the three target machines into
  // one top-level view reachable in a single click from anywhere.
  { id: 'workshop', icon: '\u{1F4CA}', label: 'Workshop', shortcut: '3' },
  { id: 'myshop',   icon: '\u{1F3ED}', label: 'My Shop',  shortcut: '4' },
  { id: 'library',  icon: '\u{1F4DA}', label: 'Library',  shortcut: '5' },
  { id: 'settings', icon: '⚙',    label: 'Settings',  shortcut: '6' },
]

export function NavRail({ active, onSelect, jobCount, opCount }: NavRailProps): React.ReactElement {
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  return (
    <nav className="nav-rail" role="tablist" aria-label="Main navigation">
      {ITEMS.map((item) => {
        const isActive = active === item.id
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-label={item.label}
            title={`${item.label}${item.shortcut ? ` (${item.shortcut})` : ''}`}
            className={`nav-rail__btn${isActive ? ' nav-rail__btn--active' : ''}`}
            onClick={() => onSelect(isActive ? null : item.id)}
            onMouseEnter={() => setHoveredId(item.id)}
            onMouseLeave={() => setHoveredId(null)}
          >
            <span className="nav-rail__icon" aria-hidden="true">{item.icon}</span>
            {item.id === 'jobs' && jobCount > 0 && (
              <span className="nav-rail__badge">{jobCount}</span>
            )}
            {isActive && <span className="nav-rail__indicator" />}
          </button>
        )
      })}
      <div className="nav-rail__spacer" />
      <button
        type="button"
        className="nav-rail__btn nav-rail__btn--bottom"
        aria-label="Help (F1)"
        title="Help (F1)"
      >
        <span className="nav-rail__icon" aria-hidden="true">?</span>
      </button>
    </nav>
  )
}
