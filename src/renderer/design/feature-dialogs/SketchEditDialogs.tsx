/**
 * Wave 3g · Sketch vector-edit dialogs — Offset · Boolean · Array.
 *
 * The reachable front doors for the three pure sketch-geometry engines that
 * close the P1 "Vectors — Transform & Edit" daily-use gaps in
 * docs/plans/catalog/vcarve-laguna.md (Offset / Boolean / Array all `missing`):
 *   - {@link OffsetSketchDialog}  → `offsetSketchEntities`  (src/shared/sketch-boolean-offset.ts)
 *   - {@link BooleanSketchDialog} → `booleanSketchEntities` (same)
 *   - {@link ArraySketchDialog}   → `rectangularArray` / `circularArray` (src/shared/sketch-array.ts)
 *
 * Each dialog operates on the CLOSED loop(s) the operator has selected on the
 * live sketch surface (the `selectedIds` prop — entity ids from the session
 * {@link DesignFileV2}). On Apply it calls the matching pure engine, which
 * ADDITIVELY merges the result into the design (outer CCW + holes CW — the
 * `cam-2d-derive` polygon-with-holes contract; never mutates the base) and hands
 * the merged design back through {@link onApply}. The host wires `onApply` to the
 * session's `onDesignChange`, so the result persists like any other sketch edit
 * and becomes derivable profile / pocket / V-carve toolpaths downstream — exactly
 * like a DXF import or inserted text.
 *
 * These dialogs are PRESENTATIONAL + pure-call: no I/O, no `window`, no canvas.
 * They unit-test in the node vitest env via `renderToStaticMarkup`, and the
 * engines they call are already proven by their own suites. Styling reuses the
 * shared {@link FeatureDialogKit} (`.fd-*`) — no inline styles, no `any`, every
 * interactive element a real `<button type="button">` / native control.
 */

import { useCallback, useMemo, useState, type JSX } from 'react'
import {
  DialogApplyRow,
  DialogNumberField,
  DialogSelectField,
  FeatureDialogCard
} from './FeatureDialogKit'
import type { DesignFileV2 } from '../../../shared/design-schema'
import {
  booleanSketchEntities,
  closedLoopEntityIds,
  offsetSketchEntities,
  type OffsetJoinType,
  type SketchBooleanOp,
  type SketchOpResult
} from '../../../shared/sketch-boolean-offset'
import {
  circularArray,
  rectangularArray,
  type SketchArrayResult
} from '../../../shared/sketch-array'

/** Default signed offset distance (mm) — a small outset, the common sign-prep move. */
export const DEFAULT_OFFSET_DISTANCE_MM = 3
/** Default rectangular array grid (incl. the original). */
export const DEFAULT_ARRAY_COLS = 3
export const DEFAULT_ARRAY_ROWS = 1
/** Default rectangular array spacing (mm). */
export const DEFAULT_ARRAY_DX_MM = 25
export const DEFAULT_ARRAY_DY_MM = 25
/** Default circular array (incl. the original) over a full revolution. */
export const DEFAULT_ARRAY_COUNT = 6
export const DEFAULT_ARRAY_TOTAL_DEG = 360

/** Shared props: the live design + which closed entities are selected + the sinks. */
interface SketchEditDialogCommonProps {
  /** The live session sketch model the op reads + additively merges into. */
  readonly design: DesignFileV2
  /**
   * The entity ids the operator has selected on the surface. The dialog narrows
   * these to the ones that actually bound a closed loop (via
   * {@link closedLoopEntityIds}) so an open polyline in the selection can't break
   * the op. When empty (or none are closed) the Apply button is disabled with an
   * honest hint.
   */
  readonly selectedIds: readonly string[]
  /** Apply the merged design (base + result loops/copies). Wired to `onDesignChange`. */
  readonly onApply: (next: DesignFileV2) => void
  /** Close / dismiss the dialog (Cancel, or after a successful apply). */
  readonly onClose?: () => void
  /** Transient one-line status (apply summary, empty-result note, errors). */
  readonly onHint?: (msg: string) => void
}

/** The selected ids that actually bound a closed loop (the op's real inputs). */
function useClosedSelection(
  design: DesignFileV2,
  selectedIds: readonly string[]
): string[] {
  return useMemo(() => {
    const closed = new Set(closedLoopEntityIds(design))
    // Preserve selection order; drop ids that aren't closed loops or aren't in the design.
    return selectedIds.filter((id) => closed.has(id))
  }, [design, selectedIds])
}

/** Cancel / Apply action row shared by all three dialogs (Cancel + DialogApplyRow). */
function DialogActions({
  applyLabel,
  onApply,
  canApply,
  hint,
  onClose,
  testId
}: {
  readonly applyLabel: string
  readonly onApply: () => void
  readonly canApply: boolean
  readonly hint?: string
  readonly onClose?: () => void
  readonly testId: string
}): JSX.Element {
  return (
    <div className="fd-text__actions">
      {onClose && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          data-testid={`${testId}-cancel`}
          onClick={onClose}
        >
          Cancel
        </button>
      )}
      <DialogApplyRow
        label={applyLabel}
        onApply={onApply}
        canApply={canApply}
        hint={hint}
        testId={`${testId}-apply`}
      />
    </div>
  )
}

/** One-line operator summary for an offset / boolean result. */
function summarizeOpResult(verb: string, result: SketchOpResult): string {
  if (result.empty) return `${verb} produced no geometry (the offset/clip removed everything).`
  const holes = result.loops.filter((l) => l.isHole).length
  const solids = result.loops.length - holes
  const holeBit = holes > 0 ? ` (${solids} solid · ${holes} hole${holes === 1 ? '' : 's'})` : ''
  return `${verb}: ${result.loops.length} loop${result.loops.length === 1 ? '' : 's'}${holeBit}.`
}

// ── Offset ───────────────────────────────────────────────────────────────────

const OFFSET_JOIN_OPTIONS: ReadonlyArray<{ value: OffsetJoinType; label: string }> = [
  { value: 'miter', label: 'Miter (sharp)' },
  { value: 'round', label: 'Round' },
  { value: 'square', label: 'Square' }
]

export function OffsetSketchDialog({
  design,
  selectedIds,
  onApply,
  onClose,
  onHint
}: SketchEditDialogCommonProps): JSX.Element {
  const [distanceRaw, setDistanceRaw] = useState(String(DEFAULT_OFFSET_DISTANCE_MM))
  const [joinType, setJoinType] = useState<OffsetJoinType>('miter')

  const closed = useClosedSelection(design, selectedIds)
  const distance = Number.parseFloat(distanceRaw)
  const distanceValid = Number.isFinite(distance) && distance !== 0
  const canApply = closed.length > 0 && distanceValid

  const handleApply = useCallback((): void => {
    if (!canApply) return
    const result = offsetSketchEntities({
      design,
      entityIds: closed,
      distanceMm: distance,
      joinType
    })
    onApply(result.design)
    onHint?.(summarizeOpResult('Offset', result))
    onClose?.()
  }, [canApply, design, closed, distance, joinType, onApply, onHint, onClose])

  const hint =
    closed.length === 0
      ? 'Select one or more closed loops to offset.'
      : !distanceValid
        ? 'Enter a non-zero distance (+ outsets, − insets).'
        : undefined

  return (
    <FeatureDialogCard title="Offset" testId="fd-sk-offset">
      <p className="fd-note" data-testid="fd-sk-offset-selection">
        {closed.length > 0
          ? `${closed.length} closed loop${closed.length === 1 ? '' : 's'} selected.`
          : 'No closed loop selected.'}
      </p>
      <DialogNumberField
        label="Distance"
        value={distanceRaw}
        onChange={setDistanceRaw}
        testId="fd-sk-offset-distance"
        suffix="mm"
      />
      <DialogSelectField
        label="Corners"
        value={joinType}
        options={OFFSET_JOIN_OPTIONS}
        onChange={setJoinType}
        testId="fd-sk-offset-join"
      />
      <p className="fd-note">
        Positive distance grows the loop outward; negative shrinks it inward (an
        inset that collapses the shape simply yields nothing). The offset copy is
        added to the sketch — ready for profile, pocket, or V-carve toolpaths.
      </p>
      <DialogActions
        applyLabel="Offset"
        onApply={handleApply}
        canApply={canApply}
        hint={hint}
        onClose={onClose}
        testId="fd-sk-offset"
      />
    </FeatureDialogCard>
  )
}

// ── Boolean ──────────────────────────────────────────────────────────────────

const BOOLEAN_OP_OPTIONS: ReadonlyArray<{ value: SketchBooleanOp; label: string }> = [
  { value: 'union', label: 'Union (weld)' },
  { value: 'difference', label: 'Subtract (first − rest)' },
  { value: 'intersection', label: 'Intersect (overlap)' }
]

export function BooleanSketchDialog({
  design,
  selectedIds,
  onApply,
  onClose,
  onHint
}: SketchEditDialogCommonProps): JSX.Element {
  const [op, setOp] = useState<SketchBooleanOp>('union')

  const closed = useClosedSelection(design, selectedIds)
  // Boolean needs at least two closed loops. For difference/intersection the
  // FIRST selected loop is the subject and the REST are the clip tools; for
  // union every loop is a subject (merged together).
  const canApply = closed.length >= 2

  const handleApply = useCallback((): void => {
    if (!canApply) return
    const [first, ...rest] = closed
    const subjectIds = op === 'union' ? closed : [first as string]
    const clipIds = op === 'union' ? [] : rest
    const result = booleanSketchEntities({ design, subjectIds, clipIds, op })
    onApply(result.design)
    onHint?.(summarizeOpResult('Boolean', result))
    onClose?.()
  }, [canApply, closed, op, design, onApply, onHint, onClose])

  const hint =
    closed.length < 2 ? 'Select two or more closed loops to combine.' : undefined

  return (
    <FeatureDialogCard title="Boolean" testId="fd-sk-boolean">
      <p className="fd-note" data-testid="fd-sk-boolean-selection">
        {closed.length >= 2
          ? `${closed.length} closed loops selected.`
          : `${closed.length} closed loop${closed.length === 1 ? '' : 's'} selected (need ≥ 2).`}
      </p>
      <DialogSelectField
        label="Operation"
        value={op}
        options={BOOLEAN_OP_OPTIONS}
        onChange={setOp}
        testId="fd-sk-boolean-op"
      />
      <p className="fd-note">
        Union welds every selected loop into one outline. Subtract removes the
        other loops from the first selected loop. Intersect keeps only the
        overlap. Holes are preserved (outer CCW, inner CW) for clean toolpaths.
      </p>
      <DialogActions
        applyLabel="Combine"
        onApply={handleApply}
        canApply={canApply}
        hint={hint}
        onClose={onClose}
        testId="fd-sk-boolean"
      />
    </FeatureDialogCard>
  )
}

// ── Array (rectangular + circular) ────────────────────────────────────────────

type ArrayMode = 'rectangular' | 'circular'

const ARRAY_MODE_OPTIONS: ReadonlyArray<{ value: ArrayMode; label: string }> = [
  { value: 'rectangular', label: 'Rectangular (grid)' },
  { value: 'circular', label: 'Circular (polar)' }
]

/** One-line operator summary for an array result. */
function summarizeArrayResult(result: SketchArrayResult): string {
  const noteBit = result.notes.length > 0 ? ` (${result.notes.join(' ')})` : ''
  return `Array: ${result.copyCount} cop${result.copyCount === 1 ? 'y' : 'ies'} added.${noteBit}`
}

export function ArraySketchDialog({
  design,
  selectedIds,
  onApply,
  onClose,
  onHint
}: SketchEditDialogCommonProps): JSX.Element {
  const [mode, setMode] = useState<ArrayMode>('rectangular')
  // Rectangular params.
  const [colsRaw, setColsRaw] = useState(String(DEFAULT_ARRAY_COLS))
  const [rowsRaw, setRowsRaw] = useState(String(DEFAULT_ARRAY_ROWS))
  const [dxRaw, setDxRaw] = useState(String(DEFAULT_ARRAY_DX_MM))
  const [dyRaw, setDyRaw] = useState(String(DEFAULT_ARRAY_DY_MM))
  // Circular params.
  const [countRaw, setCountRaw] = useState(String(DEFAULT_ARRAY_COUNT))
  const [totalDegRaw, setTotalDegRaw] = useState(String(DEFAULT_ARRAY_TOTAL_DEG))
  const [centerXRaw, setCenterXRaw] = useState('0')
  const [centerYRaw, setCenterYRaw] = useState('0')
  const [rotateCopies, setRotateCopies] = useState(true)

  // Array can pattern ANY selected entity (open polylines, points, …), not just
  // closed loops — copies of an open guide curve are still useful geometry. So
  // the input is the raw selection narrowed only to ids present in the design.
  const sources = useMemo(() => {
    const present = new Set(design.entities.map((e) => e.id))
    return selectedIds.filter((id) => present.has(id))
  }, [design, selectedIds])

  const cols = Number.parseInt(colsRaw, 10)
  const rows = Number.parseInt(rowsRaw, 10)
  const dx = Number.parseFloat(dxRaw)
  const dy = Number.parseFloat(dyRaw)
  const count = Number.parseInt(countRaw, 10)
  const totalDeg = Number.parseFloat(totalDegRaw)
  const centerX = Number.parseFloat(centerXRaw)
  const centerY = Number.parseFloat(centerYRaw)

  const rectValid =
    Number.isFinite(cols) &&
    Number.isFinite(rows) &&
    cols >= 1 &&
    rows >= 1 &&
    cols * rows >= 2 &&
    Number.isFinite(dx) &&
    Number.isFinite(dy)
  const circValid =
    Number.isFinite(count) &&
    count >= 2 &&
    Number.isFinite(totalDeg) &&
    Number.isFinite(centerX) &&
    Number.isFinite(centerY)
  const paramsValid = mode === 'rectangular' ? rectValid : circValid
  const canApply = sources.length > 0 && paramsValid

  const handleApply = useCallback((): void => {
    if (!canApply) return
    const result: SketchArrayResult =
      mode === 'rectangular'
        ? rectangularArray({ design, sourceIds: sources, cols, rows, dxMm: dx, dyMm: dy })
        : circularArray({
            design,
            sourceIds: sources,
            count,
            centerXY: [centerX, centerY],
            totalAngleDeg: totalDeg,
            rotateCopies
          })
    onApply(result.design)
    onHint?.(summarizeArrayResult(result))
    onClose?.()
  }, [
    canApply,
    mode,
    design,
    sources,
    cols,
    rows,
    dx,
    dy,
    count,
    centerX,
    centerY,
    totalDeg,
    rotateCopies,
    onApply,
    onHint,
    onClose
  ])

  const hint =
    sources.length === 0
      ? 'Select one or more entities to pattern.'
      : !paramsValid
        ? mode === 'rectangular'
          ? 'Set columns × rows ≥ 2 and finite spacing.'
          : 'Set a count ≥ 2 and a finite angle + center.'
        : undefined

  return (
    <FeatureDialogCard title="Array" testId="fd-sk-array">
      <p className="fd-note" data-testid="fd-sk-array-selection">
        {sources.length > 0
          ? `${sources.length} entit${sources.length === 1 ? 'y' : 'ies'} selected.`
          : 'No entity selected.'}
      </p>
      <DialogSelectField
        label="Pattern"
        value={mode}
        options={ARRAY_MODE_OPTIONS}
        onChange={setMode}
        testId="fd-sk-array-mode"
      />
      {mode === 'rectangular' ? (
        <div data-testid="fd-sk-array-rect-params">
          <DialogNumberField
            label="Columns (incl. original)"
            value={colsRaw}
            onChange={setColsRaw}
            testId="fd-sk-array-cols"
            min={1}
            step="1"
          />
          <DialogNumberField
            label="Rows (incl. original)"
            value={rowsRaw}
            onChange={setRowsRaw}
            testId="fd-sk-array-rows"
            min={1}
            step="1"
          />
          <DialogNumberField
            label="Column spacing"
            value={dxRaw}
            onChange={setDxRaw}
            testId="fd-sk-array-dx"
            suffix="mm"
          />
          <DialogNumberField
            label="Row spacing"
            value={dyRaw}
            onChange={setDyRaw}
            testId="fd-sk-array-dy"
            suffix="mm"
          />
        </div>
      ) : (
        <div data-testid="fd-sk-array-circ-params">
          <DialogNumberField
            label="Count (incl. original)"
            value={countRaw}
            onChange={setCountRaw}
            testId="fd-sk-array-count"
            min={1}
            step="1"
          />
          <DialogNumberField
            label="Total angle"
            value={totalDegRaw}
            onChange={setTotalDegRaw}
            testId="fd-sk-array-total-deg"
            suffix="°"
          />
          <DialogNumberField
            label="Center X"
            value={centerXRaw}
            onChange={setCenterXRaw}
            testId="fd-sk-array-center-x"
            suffix="mm"
          />
          <DialogNumberField
            label="Center Y"
            value={centerYRaw}
            onChange={setCenterYRaw}
            testId="fd-sk-array-center-y"
            suffix="mm"
          />
          <label className="fd-field fd-sk-array__rotate" data-testid="fd-sk-array-rotate-field">
            <input
              type="checkbox"
              data-testid="fd-sk-array-rotate"
              checked={rotateCopies}
              onChange={(e) => setRotateCopies(e.target.checked)}
            />
            Rotate copies to follow the orbit
          </label>
        </div>
      )}
      <DialogActions
        applyLabel="Create array"
        onApply={handleApply}
        canApply={canApply}
        hint={hint}
        onClose={onClose}
        testId="fd-sk-array"
      />
    </FeatureDialogCard>
  )
}

/** The three sketch-edit dialog kinds the surface can open. */
export type SketchEditDialogKind = 'offset' | 'boolean' | 'array'

/**
 * Map a ribbon-armed catalog id (`sk_offset` / `sk_boolean` / `sk_array_rect` /
 * `sk_array_circular`) to the dialog it opens, or `null` when the id is not a
 * sketch-edit op. Both array ids open the single Array dialog (it has the
 * rectangular ↔ circular mode toggle). Pure + the single source of truth shared
 * by the surface and the command-classification test.
 */
export function sketchEditDialogForCommand(commandId: string): SketchEditDialogKind | null {
  switch (commandId) {
    case 'sk_offset':
      return 'offset'
    case 'sk_boolean':
      return 'boolean'
    case 'sk_array_rect':
    case 'sk_array_circular':
      return 'array'
    default:
      return null
  }
}

/** Every catalog id that arms a sketch-edit dialog (for command registration). */
export const SKETCH_EDIT_COMMAND_IDS: readonly string[] = [
  'sk_offset',
  'sk_boolean',
  'sk_array_rect',
  'sk_array_circular'
]
