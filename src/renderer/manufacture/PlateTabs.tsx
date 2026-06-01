import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { Plate } from '../../shared/manufacture-schema'

/**
 * PlateTabs -- UX Move 8: multi-plate thumbnail strip with status pills + split
 * Slice button (Bambu Studio / OrcaSlicer pattern).
 *
 * The strip replaces the original small text-tab layout with a row of tile-
 * shaped plate "thumbs" (120x80) each carrying:
 *   - a thumbnail preview area (placeholder colored rect in MVP - real
 *     thumbnail rendering lands in V2),
 *   - the plate name (truncated),
 *   - a status pill ("Idle" / "Slicing..." / "Done" / "Error") sourced from
 *     the optional `plateStatuses` prop (`undefined` -> "Idle"),
 *   - a top-right close button (preserved behavior: only renders when more
 *     than one plate exists).
 *
 * After the strip a trailing dashed-border "+" tile (`.plate-thumb-add`)
 * adds a new plate, and on the right a primary SPLIT button posts the
 * active plate to the slicer with a dropdown caret for "Slice all plates".
 *
 * The CSS for these classes (`.plate-thumb-strip`, `.plate-thumb`,
 * `.plate-thumb--active`, `.plate-thumb__preview`, `.plate-thumb__name`,
 * `.plate-thumb__status`, `.plate-thumb__close`, `.plate-thumb-add`,
 * `.plate-slice-split-btn`) is owned by the design-system CSS agent - this
 * file emits the markup only.
 *
 * Active-state, inline-rename, keyboard navigation (Arrow / Home / End),
 * and the close-when-len>1 invariant all carry over from the v1 tab strip.
 *
 * IPC: NONE. Plates live in `manufacture.json` saved via `manufacture:save`.
 * Slice IPC routes through the optional `onSlicePlate` / `onSliceAllPlates`
 * callbacks passed by `ManufactureWorkspace`.
 */

/**
 * Status of a plate for the purpose of the strip's status pill.
 * Mirrors the four states the parent slice/CAM pipeline can advertise.
 */
export type PlateStatus = 'idle' | 'slicing' | 'done' | 'error'

const PLATE_STATUS_LABEL: Record<PlateStatus, string> = {
  idle: 'Idle',
  slicing: 'Slicing…',
  done: 'Done',
  error: 'Error'
}

export type PlateTabsProps = {
  /** All plates currently in the manufacture file. */
  plates: readonly Plate[]
  /** id of the currently active plate (must exist in `plates` when `plates.length > 0`). */
  activePlateId: string | null
  /**
   * Optional per-plate status used to render the status pill. Missing entries
   * fall back to `'idle'`. Provided by `ManufactureWorkspace` once the slice
   * pipeline is wired through; the strip works fine without it.
   */
  plateStatuses?: Readonly<Record<string, PlateStatus>>
  /** Called when the user selects a different plate. */
  onSelectPlate: (plateId: string) => void
  /** Called when the user clicks the "+" tile to add a new plate. */
  onAddPlate: () => void
  /** Called when the user clicks the x on a plate. Only invoked when plates.length > 1. */
  onRemovePlate: (plateId: string) => void
  /** Called when the user finishes inline-renaming a plate. */
  onRenamePlate: (plateId: string, newLabel: string) => void
  /**
   * Optional: slice a single plate. Wired by `ManufactureWorkspace`. The split
   * button's primary action calls this with the active plate id. When omitted
   * the button still renders but is disabled (visual affordance for V2).
   */
  onSlicePlate?: (plateId: string) => void
  /**
   * Optional: slice all plates. The dropdown caret on the split button calls
   * this. MVP semantics from the workflow brief: sequentially invoke
   * `onSlicePlate` for each plate. When omitted, the strip falls back to
   * iterating `onSlicePlate` over each plate; if both are absent the menu
   * item is disabled.
   */
  onSliceAllPlates?: () => void
}

/**
 * Pick a deterministic, design-token-friendly preview color for the thumbnail
 * placeholder so neighbouring plates don't all look identical. Uses a small
 * palette of accent hues from `tokens.css` (`--accent`, `--accent-2`, etc.)
 * via the CSS classes `plate-thumb__preview--hue-N`. The hash is stable per
 * plate id so the color survives re-renders.
 */
function previewHueClass(plateId: string): string {
  let h = 0
  for (let i = 0; i < plateId.length; i++) {
    h = (h * 31 + plateId.charCodeAt(i)) >>> 0
  }
  // 6 hue slots - matches the CSS palette Agent 1 ships under
  // `.plate-thumb__preview--hue-{0..5}`.
  return `plate-thumb__preview--hue-${h % 6}`
}

export function PlateTabs({
  plates,
  activePlateId,
  plateStatuses,
  onSelectPlate,
  onAddPlate,
  onRemovePlate,
  onRenamePlate,
  onSlicePlate,
  onSliceAllPlates
}: PlateTabsProps) {
  const [editingPlateId, setEditingPlateId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<string>('')
  const [sliceMenuOpen, setSliceMenuOpen] = useState(false)
  const editInputRef = useRef<HTMLInputElement | null>(null)
  const sliceMenuRef = useRef<HTMLDivElement | null>(null)

  // Focus the input when entering edit mode
  useEffect(() => {
    if (editingPlateId && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editingPlateId])

  // Close the split-button dropdown on outside click / Escape so we don't
  // trap focus inside a hidden menu.
  useEffect(() => {
    if (!sliceMenuOpen) return
    const onDocClick = (e: MouseEvent): void => {
      if (!sliceMenuRef.current) return
      if (!sliceMenuRef.current.contains(e.target as Node)) setSliceMenuOpen(false)
    }
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') setSliceMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [sliceMenuOpen])

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

  const handleSliceActive = useCallback(() => {
    if (!onSlicePlate || !activePlateId) return
    onSlicePlate(activePlateId)
  }, [onSlicePlate, activePlateId])

  const handleSliceAll = useCallback(() => {
    setSliceMenuOpen(false)
    if (onSliceAllPlates) {
      onSliceAllPlates()
      return
    }
    // Fallback (MVP brief): sequentially invoke `onSlicePlate` for each plate.
    if (!onSlicePlate) return
    for (const plate of plates) {
      onSlicePlate(plate.id)
    }
  }, [onSliceAllPlates, onSlicePlate, plates])

  // -- Empty-strip branch --
  if (plates.length === 0) {
    // Defensive: no plates at all -> show an empty strip with just the add tile.
    return (
      <div className="utility-strip-outer plate-tabs-strip-outer">
        <div
          className="utility-strip plate-tabs-strip plate-thumb-strip"
          role="tablist"
          aria-label="Manufacture plates"
        >
          <button
            type="button"
            className="plate-thumb-add"
            title="Add a new plate to this project"
            aria-label="Add new plate"
            onClick={onAddPlate}
          >
            <span aria-hidden="true" className="plate-thumb-add__icon">+</span>
            <span className="plate-thumb-add__label">New plate</span>
          </button>
        </div>
      </div>
    )
  }

  const canClose = plates.length > 1
  const sliceDisabled = !onSlicePlate || !activePlateId

  // -- Main strip --
  return (
    <div className="utility-strip-outer plate-tabs-strip-outer">
      <div className="plate-thumb-strip-row">
        <div
          className="utility-strip plate-tabs-strip plate-thumb-strip"
          role="tablist"
          aria-label="Manufacture plates"
          aria-orientation="horizontal"
          aria-describedby="plate-tabs-kbd-hint"
        >
          {plates.map((plate, index) => {
            const isActive = plate.id === activePlateId
            const isEditing = plate.id === editingPlateId
            const status: PlateStatus = plateStatuses?.[plate.id] ?? 'idle'
            const statusLabel = PLATE_STATUS_LABEL[status]
            const thumbClass = [
              'plate-thumb',
              isActive ? 'plate-thumb--active' : '',
              `plate-thumb--status-${status}`
            ]
              .filter(Boolean)
              .join(' ')
            return (
              <div
                key={plate.id}
                className={`plate-thumb-wrap${isActive ? ' plate-thumb-wrap--active' : ''}`}
              >
                {isEditing ? (
                  <div className={thumbClass}>
                    <div
                      className={`plate-thumb__preview ${previewHueClass(plate.id)}`}
                      aria-hidden="true"
                    />
                    <input
                      ref={editInputRef}
                      type="text"
                      className="plate-thumb__edit-input"
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={handleEditKeyDown}
                      aria-label={`Rename plate (currently ${plate.label})`}
                    />
                    <span
                      className={`plate-thumb__status plate-thumb__status--${status}`}
                      aria-hidden="true"
                    >
                      {statusLabel}
                    </span>
                  </div>
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
                    className={thumbClass}
                    title={`${plate.label} - status: ${statusLabel} (double-click to rename)`}
                    onClick={() => onSelectPlate(plate.id)}
                    onDoubleClick={() => beginEdit(plate)}
                    onKeyDown={(e) => onTabKeyDown(e, plate.id)}
                  >
                    <span
                      className={`plate-thumb__preview ${previewHueClass(plate.id)}`}
                      aria-hidden="true"
                    />
                    <span className="plate-thumb__name">{plate.label}</span>
                    <span
                      className={`plate-thumb__status plate-thumb__status--${status}`}
                      role="status"
                      aria-label={`Plate status: ${statusLabel}`}
                    >
                      {statusLabel}
                    </span>
                  </button>
                )}
                {canClose && !isEditing ? (
                  <button
                    type="button"
                    className="plate-thumb__close"
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
            className="plate-thumb-add"
            title="Add a new plate to this project"
            aria-label="Add new plate"
            onClick={onAddPlate}
          >
            <span aria-hidden="true" className="plate-thumb-add__icon">+</span>
            <span className="plate-thumb-add__label">New plate</span>
          </button>
        </div>

        {/* -- Split SLICE button -- */}
        <div
          ref={sliceMenuRef}
          className="plate-slice-split-btn"
          role="group"
          aria-label="Slice plates"
        >
          <button
            type="button"
            className="plate-slice-split-btn__primary"
            disabled={sliceDisabled}
            title={
              sliceDisabled
                ? 'No active plate to slice'
                : 'Slice the active plate'
            }
            aria-label="Slice this plate"
            onClick={handleSliceActive}
          >
            <span aria-hidden="true" className="plate-slice-split-btn__icon">
              {/* arrow-right glyph - Agent 1 may replace with an SVG icon */}
              &#9655;
            </span>
            <span className="plate-slice-split-btn__label">Slice this plate</span>
          </button>
          <button
            type="button"
            className="plate-slice-split-btn__caret"
            aria-haspopup="menu"
            aria-expanded={sliceMenuOpen}
            aria-label="Slice all plates"
            title="Slice all plates"
            disabled={sliceDisabled}
            onClick={() => setSliceMenuOpen((v) => !v)}
          >
            <span aria-hidden="true">&#9662;</span>
          </button>
          {sliceMenuOpen ? (
            <div className="plate-slice-split-btn__menu" role="menu">
              <button
                type="button"
                role="menuitem"
                className="plate-slice-split-btn__menu-item"
                onClick={handleSliceAll}
                disabled={sliceDisabled}
              >
                Slice all plates ({plates.length})
              </button>
            </div>
          ) : null}
        </div>
      </div>
      <p id="plate-tabs-kbd-hint" className="sr-only">
        Plates strip: arrow keys move focus and selection. Double-click a plate to
        rename. The plus tile at the end adds a new plate; the x button removes one
        (disabled when only one plate remains). The Slice button slices the active
        plate; its dropdown caret slices every plate sequentially.
      </p>
    </div>
  )
}
