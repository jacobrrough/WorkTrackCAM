/**
 * FixturePickerPanel — Lists available fixtures (built-in presets + user JSON
 * files from resources/fixtures/) and lets the operator assign one to the
 * current setup.
 *
 * Renders inline within the manufacture workspace sidebar. Clicking a fixture
 * row selects it; click again to deselect.
 */

import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import {
  COMMON_FIXTURES,
  FIXTURE_TYPE_LABELS,
  type FixtureRecord,
  type FixtureType
} from '../../shared/fixture-schema'

// ---------------------------------------------------------------------------
// Electron bridge for loading user fixture JSON files
// ---------------------------------------------------------------------------

declare const window: Window & {
  fab: {
    fixtureList?: () => Promise<FixtureJsonEntry[]>
  }
}

/** Shape returned from resource fixture JSON files. */
interface FixtureJsonEntry {
  id: string
  name: string
  type: string
  description?: string
  boundingBox?: { xMm: number; yMm: number; zMm: number }
  notes?: string
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FixturePickerPanelProps {
  /** Currently selected fixture ID (null = none). */
  selectedFixtureId: string | null
  /** Callback when a fixture is selected or deselected. */
  onSelectFixture: (fixtureId: string | null, fixtureName: string | null) => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fixtureTypeLabel(type: string): string {
  return FIXTURE_TYPE_LABELS[type as FixtureType] ?? type
}

/** Compute overall dimensions string from AABB geometry list. */
function fixtureDimensionsLabel(fixture: FixtureRecord): string {
  if (fixture.geometry.length === 0) return ''
  let minX = Infinity, maxX = -Infinity
  let minY = Infinity, maxY = -Infinity
  let minZ = Infinity, maxZ = -Infinity
  for (const box of fixture.geometry) {
    if (box.minX < minX) minX = box.minX
    if (box.maxX > maxX) maxX = box.maxX
    if (box.minY < minY) minY = box.minY
    if (box.maxY > maxY) maxY = box.maxY
    if (box.minZ < minZ) minZ = box.minZ
    if (box.maxZ > maxZ) maxZ = box.maxZ
  }
  const w = maxX - minX
  const d = maxY - minY
  const h = maxZ - minZ
  return `${w.toFixed(0)} x ${d.toFixed(0)} x ${h.toFixed(0)} mm`
}

/** Convert a FixtureJsonEntry (from resources/fixtures/ JSON) into a FixtureRecord. */
function jsonEntryToRecord(entry: FixtureJsonEntry): FixtureRecord {
  const bb = entry.boundingBox
  const w = bb?.xMm ?? 100
  const d = bb?.yMm ?? 100
  const h = bb?.zMm ?? 25
  return {
    id: entry.id,
    name: entry.name,
    type: (entry.type === 'vacuum' ? 'plate' : entry.type) as FixtureType,
    geometry: [{ minX: 0, maxX: w, minY: 0, maxY: d, minZ: 0, maxZ: h }],
    clampingPositions: [],
    notes: entry.notes ?? entry.description
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const FixturePickerPanel = memo(function FixturePickerPanel({
  selectedFixtureId,
  onSelectFixture
}: FixturePickerPanelProps) {
  const [userFixtures, setUserFixtures] = useState<FixtureRecord[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  // Load user fixtures from resources/fixtures/ on mount
  useEffect(() => {
    let cancelled = false
    async function load(): Promise<void> {
      try {
        if (typeof window.fab.fixtureList === 'function') {
          const entries = await window.fab.fixtureList()
          if (cancelled) return
          setUserFixtures(entries.map(jsonEntryToRecord))
          setLoadError(null)
        }
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : String(e))
        }
      }
    }
    void load()
    return () => { cancelled = true }
  }, [])

  // Merge built-in presets + user fixtures, deduplicating by id
  const allFixtures = useMemo(() => {
    const builtIn: FixtureRecord[] = [...COMMON_FIXTURES]
    const builtInIds = new Set(builtIn.map((f) => f.id))
    const user = userFixtures.filter((f) => !builtInIds.has(f.id))
    return [...builtIn, ...user]
  }, [userFixtures])

  const handleClick = useCallback(
    (fixture: FixtureRecord) => {
      if (selectedFixtureId === fixture.id) {
        onSelectFixture(null, null)
      } else {
        onSelectFixture(fixture.id, fixture.name)
      }
    },
    [selectedFixtureId, onSelectFixture]
  )

  return (
    <div className="fixture-picker" role="listbox" aria-label="Fixture picker">
      <div className="fixture-picker__header">
        <span className="fixture-picker__title">Fixtures</span>
        <span className="msg msg--muted msg--xs">
          {allFixtures.length} available
        </span>
      </div>

      {loadError && (
        <p className="msg msg--warn msg--xs fixture-picker__error">
          Failed to load user fixtures: {loadError}
        </p>
      )}

      <div className="fixture-picker__list">
        {allFixtures.map((fixture) => {
          const isSelected = selectedFixtureId === fixture.id
          return (
            <div
              key={fixture.id}
              className={`fixture-picker__row${isSelected ? ' fixture-picker__row--selected' : ''}`}
              role="option"
              aria-selected={isSelected}
              onClick={() => handleClick(fixture)}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  handleClick(fixture)
                }
              }}
            >
              <div className="fixture-picker__row-icon">
                {fixtureTypeIcon(fixture.type)}
              </div>
              <div className="fixture-picker__row-info">
                <div className="fixture-picker__row-name">{fixture.name}</div>
                <div className="fixture-picker__row-meta">
                  {fixtureTypeLabel(fixture.type)}
                  {' \u00B7 '}
                  {fixtureDimensionsLabel(fixture)}
                </div>
              </div>
              {isSelected && (
                <span className="fixture-picker__check" aria-hidden="true">
                  \u2713
                </span>
              )}
            </div>
          )
        })}

        {allFixtures.length === 0 && (
          <div className="fixture-picker__empty">
            No fixtures available. Add JSON files to resources/fixtures/.
          </div>
        )}
      </div>

      {selectedFixtureId && (
        <div className="fixture-picker__selection-note">
          <span className="msg msg--muted msg--xs">
            Selected: {allFixtures.find((f) => f.id === selectedFixtureId)?.name ?? selectedFixtureId}
          </span>
        </div>
      )}
    </div>
  )
})

// ---------------------------------------------------------------------------
// Fixture type icons
// ---------------------------------------------------------------------------

function fixtureTypeIcon(type: string): string {
  switch (type) {
    case 'vise':
      return '\uD83D\uDD27' // wrench
    case 'clamp':
      return '\uD83D\uDD29' // nut and bolt
    case 'plate':
      return '\u25A3' // white square with rounded corners
    case 'custom':
      return '\u2699' // gear
    default:
      return '\u25A1' // white square
  }
}
