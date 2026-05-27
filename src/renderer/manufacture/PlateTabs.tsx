import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { Plate } from '../../shared/manufacture-schema'

/**
 * PlateTabs -- Gap #7 v1: multi-plate / multi-job project (OrcaSlicer / Bambu Studio parity).
 *
 * A horizontal tab strip showing all plates in the current manufacture file.
 * Each tab can be selected to switch which plate is active, double-clicked to
 * rename inline, and (when more than one plate exists) closed via the x button.
 * The "+" button adds a new plate.
 *
 * Style mirrors `ManufactureSubTabStrip` -- reuses the `.utility-strip` /
 * `.utility-strip-outer` CSS classes for visual consistency. Adds plate-tab
 * specific tweaks via the `.plate-tabs-strip` modifier class (declared in
 * `src/renderer/styles/manufacture.css`).
 *
 * IPC: NONE. Plates live in `manufacture.json` saved via `manufacture:save`.
 */
export type PlateTabsProps = {
  /** All plates currently in the manufacture file. */
  plates: readonly Plate[]
  /** id of the currently active plate (must exist in `plates` when `plates.length > 0`). */
  activePlateId: string | null
  /** Called when the user selects a different plate. */
  onSelectPlate: (plateId: string) => void
  /** Called when the user clicks the "+" button to add a new plate. */
  onAddPlate: () => void
  /** Called when the user clicks the x on a plate. Only invoked when plates.length > 1. */
  onRemovePlate: (plateId: string) => void
  /** Called when the user finishes inline-renaming a plate. */
  onRenamePlate: (plateId: string, newLabel: string) => void
}

export function PlateTabs({
  plates,
  activePlateId,
  onSelectPlate,
  onAddPlate,
  onRemovePlate,
  onRenamePlate
}: PlateTabsProps) {
  const [editingPlateId, setEditingPlateId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<string>('')
  const editInputRef = useRef<HTMLInputElement | null>(null)

  // Focus the input when entering edit mode
  useEffect(() => {
    if (editingPlateId && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editingPlateId])

  const beginEdit = useCallback((plate: Plate) => {
    setEditingPlateId(plate.id)
    setEditDraft(plate.label)
  }, [])

  const commitEdit = useCallback(() => {
    if (!editingPlateId) return
    const trimmed = editDraft.trim()
    if (trimmed.length > 0) {
      onRenamePlate(editingPlateId, trimmed)
    }
    setEditingPlateId(null)
    setEditDraft('')
  }, [editingPlateId, editDraft, onRenamePlate])

  const cancelEdit = useCallback(() => {
    setEditingPlateId(null)
    setEditDraft('')
  }, [])

  const handleEditKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        commitEdit()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        cancelEdit()
      }
    },
    [commitEdit, cancelEdit]
  )

  const onTabKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, plateId: string) => {
      const idx = plates.findIndex((p) => p.id === plateId)
      if (idx < 0) return
      let nextIdx = -1
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault()
        nextIdx = (idx + 1) % plates.length
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault()
        nextIdx = (idx - 1 + plates.length) % plates.length
      } else if (e.key === 'Home') {
        e.preventDefault()
        nextIdx = 0
      } else if (e.key === 'End') {
        e.preventDefault()
        nextIdx = plates.length - 1
      }
      if (nextIdx < 0) return
      const next = plates[nextIdx]!
      onSelectPlate(next.id)
      queueMicrotask(() => document.getElementById(`plate-tab-${next.id}`)?.focus())
    },
    [plates, onSelectPlate]
  )

  if (plates.length === 0) {
    // Defensive: no plates at all -> show an empty strip with just the "+" button.
    return (
      <div className="utility-strip-outer plate-tabs-strip-outer">
        <div
          className="utility-strip plate-tabs-strip"
          role="tablist"
          aria-label="Manufacture plates"
        >
          <button
            type="button"
            className="plate-tab-add"
            title="Add a new plate to this project"
            aria-label="Add new plate"
            onClick={onAddPlate}
          >
            <span aria-hidden="true">+</span>
            <span className="plate-tab-add-label">New plate</span>
          </button>
        </div>
      </div>
    )
  }

  const canClose = plates.length > 1

  return (
    <div className="utility-strip-outer plate-tabs-strip-outer">
      <div
        className="utility-strip plate-tabs-strip"
        role="tablist"
        aria-label="Manufacture plates"
        aria-orientation="horizontal"
        aria-describedby="plate-tabs-kbd-hint"
      >
        {plates.map((plate, index) => {
          const isActive = plate.id === activePlateId
          const isEditing = plate.id === editingPlateId
          return (
            <div key={plate.id} className={`plate-tab-wrap${isActive ? ' plate-tab-wrap--active' : ''}`}>
              {isEditing ? (
                <input
                  ref={editInputRef}
                  type="text"
                  className="plate-tab-edit-input"
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={handleEditKeyDown}
                  aria-label={`Rename plate (currently ${plate.label})`}
                />
              ) : (
                <button
                  id={`plate-tab-${plate.id}`}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls="manufacture-workspace-panel"
                  aria-posinset={index + 1}
                  aria-setsize={plates.length}
                  tabIndex={isActive ? 0 : -1}
                  className={`plate-tab${isActive ? ' active' : ''}`}
                  title={`${plate.label} (double-click to rename)`}
                  onClick={() => onSelectPlate(plate.id)}
                  onDoubleClick={() => beginEdit(plate)}
                  onKeyDown={(e) => onTabKeyDown(e, plate.id)}
                >
                  <span className="plate-tab-label">{plate.label}</span>
                </button>
              )}
              {canClose && !isEditing ? (
                <button
                  type="button"
                  className="plate-tab-close"
                  title={`Remove plate "${plate.label}"`}
                  aria-label={`Remove plate ${plate.label}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemovePlate(plate.id)
                  }}
                >
                  <span aria-hidden="true">x</span>
                </button>
              ) : null}
            </div>
          )
        })}
        <button
          type="button"
          className="plate-tab-add"
          title="Add a new plate to this project"
          aria-label="Add new plate"
          onClick={onAddPlate}
        >
          <span aria-hidden="true">+</span>
        </button>
      </div>
      <p id="plate-tabs-kbd-hint" className="sr-only">
        Plates strip: arrow keys move focus and selection. Double-click a plate to rename.
        The + button adds a new plate; x removes one (disabled when only one plate remains).
      </p>
    </div>
  )
}
