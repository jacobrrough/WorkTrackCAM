/**
 * FeatureTree — feature tree + parameter editor for the parametric
 * Design workspace (BUILD 4, Cycle 233 CAD MVP; BUILD 6 editable
 * params, Cycle 233 CAD V1).
 *
 * Renders two stacked sections in the right column of DesignWorkspace:
 *
 *   1. Parameters — top-level literal assignments the sidecar's
 *      `cad.list_operations` AST walker exposes (`length = 50`,
 *      `mirror = True`, `label = 'big-plate'`). When `onParamsChange`
 *      is supplied, the section renders editable inputs matched to the
 *      parameter kind (`number`, `boolean`, `string`) plus per-row
 *      Reset and a global Apply button. When omitted, the section
 *      renders read-only (the pre-V1 contract).
 *   2. Operations — the operation rows that drive the feature-tree
 *      list. Untouched by V1 — same contract pinned by the existing
 *      `FeatureTree.test.tsx` cases.
 *
 * Wiring contract for editable params (BUILD 6 / CAD V1):
 *   - The parent owns the `paramOverrides` state. FeatureTree drives
 *     local edit state until the operator clicks Apply, at which point
 *     `onParamsChange(overrides)` fires with every dirty value so the
 *     parent can re-run `cad.execute_script` with `buildParameters`.
 *   - Reset on a single row clears that row's local override back to
 *     the parameter's script-defined default.
 *   - Apply is disabled when no rows are dirty so a no-op click can't
 *     spam the sidecar.
 *
 * Implementation note — why a sub-component for the editable section?
 *
 * The editable Parameters UI owns `useState` (the local draft buffer
 * the operator types into before clicking Apply). The op-only render
 * path must remain hook-free so the legacy unit tests can call
 * `FeatureTree(props)` as a bare function for tree-walking (see the
 * `findAllByTestId` + `onLineClick` test in FeatureTree.test.tsx).
 *
 * The fix is to extract the editable Parameters section into an inner
 * component (`EditableParameters`) that React only mounts when the
 * editable mode is active. That keeps the top-level `FeatureTree`
 * function side-effect-free for the existing tests.
 *
 * Contract (pinned by `FeatureTree.test.tsx`):
 *   1. Operations contract (BUILD 4):
 *      - Empty operations + no parameters -> shared `EmptyState`.
 *      - Non-empty operations -> ordered list, line + op + args per row.
 *      - Truncation, title attribute, role="button" rules unchanged.
 *   2. Parameters contract (BUILD 6):
 *      - `parameters` prop absent or empty -> no params section.
 *      - `parameters` present + `onParamsChange` absent -> read-only
 *        list (mirrors the old DesignWorkspace markup).
 *      - `parameters` + `onParamsChange` present -> editable inputs:
 *          number  -> `<input type="number" step="any" />`
 *          boolean -> `<input type="checkbox" />`
 *          string  -> `<input type="text" />`
 *        plus per-row "Reset" + global "Apply" button.
 *      - `paramOverrides` is the controlled override state — when a
 *        row's name is in the map, its input shows the override value;
 *        otherwise it shows the script default.
 *
 * No `any` types — `parameters` is `ReadonlyArray<...>` so callers can
 * pass either a frozen array or a mutable one without the component
 * being able to mutate it.
 */

import {
  useMemo,
  useState,
  type ChangeEvent,
  type DragEvent,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { EmptyState } from '../src/EmptyState'
import type { KernelPostSolidOp } from '../../shared/part-features-schema'

export interface FeatureTreeOperation {
  /** 1-based script line number where this operation was emitted. */
  readonly line: number
  /** Op name, e.g. `extrude`, `box`, `fillet`. */
  readonly op: string
  /**
   * Pre-formatted args string, e.g. `distance=12, taper=3`. The
   * sidecar is responsible for formatting -- this component truncates
   * for display but never re-parses.
   */
  readonly args: string
}

/** Wire kinds the sidecar's `cad.list_operations` reports per parameter. */
export type FeatureTreeParameterKind = 'number' | 'boolean' | 'string'

/** Script-default parameter value reported by the sidecar. */
export type FeatureTreeParameterValue = number | boolean | string

export interface FeatureTreeParameter {
  /** Identifier as it appears in the script (`length`, `mirror`, ...). */
  readonly name: string
  /** Literal default value from the AST. */
  readonly value: FeatureTreeParameterValue
  /** Drives which `<input>` variant we render. */
  readonly kind: FeatureTreeParameterKind
}

/**
 * Human-readable label for a kernel timeline op. The `kind` discriminator is a
 * snake_case wire token (`boolean_union_box`, `fillet_select`); operators want
 * a verb + noun. Pure mapping — no geometry, no truncation.
 */
export function kernelOpLabel(op: KernelPostSolidOp): string {
  switch (op.kind) {
    case 'fillet_all':
      return `Fillet all · ${op.radiusMm} mm`
    case 'fillet_select':
      return `Fillet ${op.edgeDirection} · ${op.radiusMm} mm`
    case 'chamfer_all':
      return `Chamfer all · ${op.lengthMm} mm`
    case 'chamfer_select':
      return `Chamfer ${op.edgeDirection} · ${op.lengthMm} mm`
    case 'shell_inward':
      return `Shell ${op.thicknessMm} mm`
    case 'boolean_union_box':
      return 'Union box'
    case 'boolean_subtract_box':
      return 'Subtract box'
    case 'boolean_intersect_box':
      return 'Intersect box'
    case 'boolean_subtract_cylinder':
      return 'Subtract cylinder'
    case 'boolean_combine_profile':
      return `Combine profile (${op.mode})`
    case 'pattern_rectangular':
      return `Rect pattern ${op.countX}×${op.countY}`
    case 'pattern_circular':
      return `Circular pattern ×${op.count}`
    case 'pattern_linear_3d':
      return `Linear pattern ×${op.count}`
    case 'pattern_path':
      return `Path pattern ×${op.count}`
    case 'mirror_union_plane':
      return `Mirror union (${op.plane})`
    case 'split_keep_halfspace':
      return `Split keep ${op.keep} ${op.axis}`
    case 'hole_from_profile':
      return `Hole (${op.mode})`
    case 'transform_translate':
      return 'Move / translate'
    case 'press_pull_profile':
      return `Press-pull ${op.deltaMm} mm`
    case 'thicken_offset':
      return `Thicken ${op.distanceMm} mm`
    case 'thicken_scale':
      return `Thicken (scale) ${op.deltaMm} mm`
    case 'sheet_tab_union':
      return 'Sheet tab'
    case 'sheet_fold':
      return `Sheet fold ${op.bendAngleDeg}°`
    case 'sheet_flat_pattern':
      return 'Flat pattern'
    case 'thread_wizard':
      return `Thread ${op.designation}`
    case 'thread_cosmetic':
      return 'Thread (cosmetic)'
    case 'coil_cut':
      return `Coil cut ×${op.turns}`
    case 'sweep_profile_path':
    case 'sweep_profile_path_true':
      return 'Sweep along path'
    case 'pipe_path':
      return 'Pipe along path'
    case 'loft_guide_rails':
      return 'Loft guide rails'
    case 'plastic_rule_fillet':
      return `Plastic fillet ${op.radiusMm} mm`
    case 'plastic_boss':
      return 'Plastic boss'
    case 'plastic_lip_groove':
      return `Plastic ${op.mode}`
    default: {
      // Exhaustiveness guard: a new op kind must add a label above. Fall back
      // to the raw kind so the UI degrades gracefully rather than throwing.
      const fallback: { kind: string } = op
      return fallback.kind
    }
  }
}

export interface FeatureTreeProps {
  /** Operations to render, in script order. */
  readonly operations: ReadonlyArray<FeatureTreeOperation>
  /**
   * Optional callback when the operator clicks an operation row.
   * Wired up by DesignWorkspace to seek the CadQueryEditor cursor to
   * the matching script line. When omitted, rows are presentational.
   */
  readonly onLineClick?: (line: number) => void
  /**
   * Optional parameter list. When omitted or empty, the params
   * section is suppressed entirely (matches the pre-V1 contract for
   * tests that only exercise operations).
   */
  readonly parameters?: ReadonlyArray<FeatureTreeParameter>
  /**
   * Controlled override map keyed by parameter name. When a name is
   * present, the input shows the override; otherwise it shows the
   * script default. Pass an empty object (or omit) to start with no
   * overrides.
   */
  readonly paramOverrides?: Readonly<Record<string, FeatureTreeParameterValue>>
  /**
   * Optional callback fired when the operator clicks "Apply". The
   * payload contains every dirty parameter — i.e. every parameter
   * whose current input value differs from its script default. The
   * parent stores this as `paramOverrides` and re-runs the script
   * with `cad.execute_script({ script, buildParameters: overrides })`.
   *
   * When omitted, the params section renders read-only.
   */
  readonly onParamsChange?: (
    overrides: Record<string, FeatureTreeParameterValue>
  ) => void
  /**
   * The editable kernel-op timeline (`part/features.json` `kernelOps[]`). When
   * omitted or empty, the timeline section is suppressed entirely — existing
   * hosts (the splash preview, the DesignWorkspace Operations panel) render
   * unchanged. When present, the section renders one row per op with
   * drag-to-reorder, keyboard move up/down, a per-op suppress toggle, and a
   * roll-back marker.
   *
   * The parent owns this array (it is persisted on disk); FeatureTree is
   * presentational and reports every edit through the callbacks below. This
   * mirrors the `operations` / `parameters` contract — the component never
   * mutates the data it is handed.
   */
  readonly kernelOps?: ReadonlyArray<KernelPostSolidOp>
  /**
   * Inclusive roll-back marker index into `kernelOps` (the persisted
   * `rolledBackTo`). `undefined` or `-1` means "build all". Ops at indices
   * strictly greater than this render greyed as "rolled back".
   */
  readonly rolledBackTo?: number
  /**
   * Keyboard "move up / down" of the op at `index` by `delta` (±1). The
   * accessible alternative to a drag. Wired to the session context's
   * `moveKernelOp`. Omit (with the others) to render the timeline read-only.
   */
  readonly onKernelMove?: (index: number, delta: -1 | 1) => void
  /** Completed drag: move the op at `from` to land at `to`. */
  readonly onKernelReorder?: (from: number, to: number) => void
  /** Toggle the suppress flag of the op at `index`. */
  readonly onKernelSuppressToggle?: (index: number, suppressed: boolean) => void
  /** Set the inclusive roll-back marker to `index`. */
  readonly onKernelSetRollback?: (index: number) => void
  /** Clear the roll-back marker (back to "build all"). */
  readonly onKernelClearRollback?: () => void
  /**
   * Delete the op at `index` from the timeline. Wired to the session context's
   * `removeKernelOpAt` (persists + rebuilds). When omitted, the per-row delete
   * button renders disabled (read-only timeline).
   */
  readonly onKernelDelete?: (index: number) => void
}

/**
 * Max characters of an args string we render inline before truncating
 * with an ellipsis. Tuned against the right-panel min-width in the
 * three-pane Design workspace layout (~280 px) -- 48 chars fits a
 * single line at the tokens.css `--mono` 12 px default without
 * overflowing into the line-number gutter.
 */
const ARGS_MAX_CHARS = 48
const ELLIPSIS = '…'

function truncateArgs(args: string): string {
  if (args.length <= ARGS_MAX_CHARS) return args
  return args.slice(0, ARGS_MAX_CHARS - 1) + ELLIPSIS
}

/**
 * Resolve the value an input should currently display. Override wins
 * over default. Number/string defaults pass through unchanged; the
 * checkbox path coerces to boolean defensively in case the sidecar
 * ever drifts and sends a truthy number.
 */
function resolveDisplayValue(
  param: FeatureTreeParameter,
  overrides: Readonly<Record<string, FeatureTreeParameterValue>> | undefined,
): FeatureTreeParameterValue {
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, param.name)) {
    return overrides[param.name] as FeatureTreeParameterValue
  }
  return param.value
}

/** Has the operator changed this param's input away from the script default? */
function isDirty(
  param: FeatureTreeParameter,
  local: Readonly<Record<string, FeatureTreeParameterValue>>,
): boolean {
  if (!Object.prototype.hasOwnProperty.call(local, param.name)) return false
  return local[param.name] !== param.value
}

/**
 * Editable Parameters section — owns the local `useState` draft buffer
 * the operator types into before clicking Apply. Lives in a dedicated
 * component so the top-level `FeatureTree` stays hook-free for the
 * op-only render path (see the implementation note in the module
 * header).
 *
 * `onParamsChange` is required here — the caller MUST be ready to
 * receive an override map. The read-only path is handled separately
 * by `<ReadOnlyParameters>` so this component never has to branch on
 * "do I have a handler?".
 */
interface EditableParametersProps {
  readonly parameters: ReadonlyArray<FeatureTreeParameter>
  readonly paramOverrides:
    | Readonly<Record<string, FeatureTreeParameterValue>>
    | undefined
  readonly onParamsChange: (
    overrides: Record<string, FeatureTreeParameterValue>,
  ) => void
}

function EditableParameters({
  parameters,
  paramOverrides,
  onParamsChange,
}: EditableParametersProps): JSX.Element {
  // Local edit buffer. Seeded from `paramOverrides` so a controlled
  // parent can re-hydrate after a re-mount (e.g. when the operator
  // switches scripts). When the controlled override map changes from
  // outside, we deliberately do NOT clobber the local buffer mid-edit
  // — the parent gets the final state on Apply, not on every keystroke.
  const [localDraft, setLocalDraft] = useState<
    Record<string, FeatureTreeParameterValue>
  >(() => ({ ...(paramOverrides ?? {}) }))

  const dirtyParams = useMemo(
    () => parameters.filter((p) => isDirty(p, localDraft)),
    [parameters, localDraft],
  )

  const handleNumberChange = (name: string) =>
    (e: ChangeEvent<HTMLInputElement>): void => {
      const raw = e.target.value
      // Empty input clears the override. Non-finite results (e.g. user
      // typed "abc") are ignored so we never push NaN into the wire.
      if (raw === '') {
        setLocalDraft((d) => {
          const next = { ...d }
          delete next[name]
          return next
        })
        return
      }
      const parsed = Number.parseFloat(raw)
      if (!Number.isFinite(parsed)) return
      setLocalDraft((d) => ({ ...d, [name]: parsed }))
    }

  const handleBooleanChange = (name: string) =>
    (e: ChangeEvent<HTMLInputElement>): void => {
      setLocalDraft((d) => ({ ...d, [name]: e.target.checked }))
    }

  const handleStringChange = (name: string) =>
    (e: ChangeEvent<HTMLInputElement>): void => {
      setLocalDraft((d) => ({ ...d, [name]: e.target.value }))
    }

  const handleReset = (name: string): void => {
    setLocalDraft((d) => {
      const next = { ...d }
      delete next[name]
      return next
    })
  }

  const handleApply = (): void => {
    // Send every dirty value through. We do NOT send unchanged params
    // because cqgi's BuildResult.build merges the override dict on top
    // of script defaults — sending defaults back would be a wasted
    // round-trip and would noise up the wire log.
    const overrides: Record<string, FeatureTreeParameterValue> = {}
    for (const p of dirtyParams) {
      overrides[p.name] = localDraft[p.name] as FeatureTreeParameterValue
    }
    onParamsChange(overrides)
  }

  return (
    <section
      className="cad-feature-params"
      data-testid="cad-feature-params"
      aria-label="CadQuery parameters"
    >
      <ul className="cad-feature-params__list">
        {parameters.map((param) => {
          const displayValue = resolveDisplayValue(param, localDraft)
          const rowDirty = isDirty(param, localDraft)
          return (
            <li
              key={param.name}
              className="cad-feature-params__row"
              data-testid="cad-feature-param-row"
              data-param-name={param.name}
              data-param-kind={param.kind}
              data-param-dirty={rowDirty ? 'true' : 'false'}
            >
              <label
                className="cad-feature-params__name"
                htmlFor={`cad-param-${param.name}`}
              >
                {param.name}
              </label>
              {param.kind === 'number' && (
                <input
                  id={`cad-param-${param.name}`}
                  className="cad-feature-params__input"
                  data-testid="cad-feature-param-input"
                  type="number"
                  step="any"
                  value={
                    typeof displayValue === 'number' ? String(displayValue) : ''
                  }
                  onChange={handleNumberChange(param.name)}
                />
              )}
              {param.kind === 'boolean' && (
                <input
                  id={`cad-param-${param.name}`}
                  className="cad-feature-params__input cad-feature-params__input--checkbox"
                  data-testid="cad-feature-param-input"
                  type="checkbox"
                  checked={Boolean(displayValue)}
                  onChange={handleBooleanChange(param.name)}
                />
              )}
              {param.kind === 'string' && (
                <input
                  id={`cad-param-${param.name}`}
                  className="cad-feature-params__input"
                  data-testid="cad-feature-param-input"
                  type="text"
                  value={
                    typeof displayValue === 'string'
                      ? displayValue
                      : String(displayValue)
                  }
                  onChange={handleStringChange(param.name)}
                />
              )}
              <button
                type="button"
                className="cad-feature-params__reset btn btn-ghost btn-xs"
                data-testid="cad-feature-param-reset"
                data-param-name={param.name}
                disabled={!rowDirty}
                onClick={() => handleReset(param.name)}
                aria-label={`Reset ${param.name} to default`}
              >
                Reset
              </button>
            </li>
          )
        })}
      </ul>
      <div className="cad-feature-params__actions">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          data-testid="cad-feature-params-apply"
          disabled={dirtyParams.length === 0}
          onClick={handleApply}
        >
          Apply
        </button>
      </div>
    </section>
  )
}

/**
 * Read-only Parameters section — pure presentation, no hooks. Used
 * when the caller did NOT supply `onParamsChange` (the pre-V1 contract,
 * e.g. the splash preview or any host that can render params but does
 * not want to permit editing).
 */
interface ReadOnlyParametersProps {
  readonly parameters: ReadonlyArray<FeatureTreeParameter>
  readonly paramOverrides:
    | Readonly<Record<string, FeatureTreeParameterValue>>
    | undefined
}

function ReadOnlyParameters({
  parameters,
  paramOverrides,
}: ReadOnlyParametersProps): JSX.Element {
  return (
    <section
      className="cad-feature-params"
      data-testid="cad-feature-params"
      aria-label="CadQuery parameters"
    >
      <ul className="cad-feature-params__list">
        {parameters.map((param) => {
          const displayValue = resolveDisplayValue(param, paramOverrides)
          return (
            <li
              key={param.name}
              className="cad-feature-params__row"
              data-testid="cad-feature-param-row"
              data-param-name={param.name}
              data-param-kind={param.kind}
            >
              <span className="cad-feature-params__name">{param.name}</span>
              <span className="cad-feature-params__equals" aria-hidden="true">
                =
              </span>
              <span className="cad-feature-params__value">
                {String(displayValue)}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/**
 * Editable kernel-op timeline section (the Fusion / SolidWorks "feature
 * timeline"). Owns a small `useState` for the in-flight drag, so — like
 * `EditableParameters` — it lives in a dedicated component the top-level
 * `FeatureTree` only mounts when the timeline is present, keeping the op-only
 * render path hook-free for the legacy render-pin tests.
 *
 * Interaction model (all reported through the props; this component never
 * mutates the op array):
 *   - **Drag-to-reorder**: each row is `draggable`; drop on another row fires
 *     `onReorder(from, to)`.
 *   - **Keyboard move**: ▲ / ▼ buttons fire `onMove(index, -1 | +1)` — the
 *     accessible alternative, matching the app's roving-tabindex pattern (only
 *     the active row's controls are tabbable; ArrowUp / ArrowDown move focus,
 *     Home / End jump to the ends).
 *   - **Suppress toggle**: a per-row button fires `onSuppressToggle`. A
 *     suppressed row renders dimmed with a distinct icon.
 *   - **Roll-back marker**: a per-row "⏱" button fires `onSetRollback`; the
 *     section header carries a "Clear" button (`onClearRollback`). Ops at
 *     indices strictly greater than the marker render greyed as "rolled back".
 *   - **Delete**: a per-row "✕" button fires `onDelete(index)`, removing the op
 *     from the timeline (the parent persists + rebuilds).
 */
interface KernelTimelineProps {
  readonly kernelOps: ReadonlyArray<KernelPostSolidOp>
  readonly rolledBackTo: number | undefined
  readonly onMove: ((index: number, delta: -1 | 1) => void) | undefined
  readonly onReorder: ((from: number, to: number) => void) | undefined
  readonly onSuppressToggle: ((index: number, suppressed: boolean) => void) | undefined
  readonly onSetRollback: ((index: number) => void) | undefined
  readonly onClearRollback: (() => void) | undefined
  readonly onDelete: ((index: number) => void) | undefined
}

/**
 * Is the op at `index` past the roll-back marker (i.e. excluded from the build,
 * shown greyed)? `undefined` / `-1` marker -> nothing is rolled back.
 */
export function isRolledBack(index: number, rolledBackTo: number | undefined): boolean {
  if (rolledBackTo === undefined || rolledBackTo < 0) return false
  return index > rolledBackTo
}

function KernelTimeline({
  kernelOps,
  rolledBackTo,
  onMove,
  onReorder,
  onSuppressToggle,
  onSetRollback,
  onClearRollback,
  onDelete,
}: KernelTimelineProps): JSX.Element {
  // Index of the row currently being dragged (null when idle). Drives the
  // drop-target styling + the reorder dispatch.
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  // Roving tabindex: which row's controls are currently tabbable. Starts at 0.
  const [activeRow, setActiveRow] = useState(0)
  // Clamp against the live length so a delete that shrinks the list below the
  // stored index never strands focus with no tabbable row.
  const effectiveActiveRow = Math.min(activeRow, kernelOps.length - 1)

  const editable = onMove != null || onReorder != null

  const handleDragStart = (index: number) => (e: DragEvent<HTMLLIElement>): void => {
    setDragIndex(index)
    // Required for Firefox to initiate a drag; the payload is the source index.
    e.dataTransfer.setData('text/plain', String(index))
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: DragEvent<HTMLLIElement>): void => {
    if (dragIndex === null) return
    e.preventDefault() // allow the drop
    e.dataTransfer.dropEffect = 'move'
  }

  const handleDrop = (index: number) => (e: DragEvent<HTMLLIElement>): void => {
    e.preventDefault()
    const from = dragIndex
    setDragIndex(null)
    if (from === null || from === index) return
    onReorder?.(from, index)
  }

  const handleDragEnd = (): void => {
    setDragIndex(null)
  }

  // Roving-tabindex keyboard nav over the rows, mirroring
  // ManufactureSubTabStrip: ArrowUp/Down move focus, Home/End jump.
  const handleRowKeyDown = (index: number) => (e: ReactKeyboardEvent<HTMLLIElement>): void => {
    const last = kernelOps.length - 1
    let next: number | null = null
    if (e.key === 'ArrowDown') next = Math.min(last, index + 1)
    else if (e.key === 'ArrowUp') next = Math.max(0, index - 1)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = last
    if (next === null) return
    e.preventDefault()
    setActiveRow(next)
    // Move DOM focus to the newly active row so the keyboard user follows it.
    const root = e.currentTarget.parentElement
    const target = root?.querySelector<HTMLElement>(`[data-kernel-row="${next}"]`)
    target?.focus()
  }

  return (
    <section
      className="cad-kernel-timeline"
      data-testid="cad-kernel-timeline"
      aria-label="Kernel operation timeline"
    >
      <div className="cad-kernel-timeline__head">
        <span className="cad-kernel-timeline__title">Timeline</span>
        {rolledBackTo !== undefined && rolledBackTo >= 0 && (
          <button
            type="button"
            className="btn btn-ghost btn-xs cad-kernel-timeline__clear"
            data-testid="cad-kernel-rollback-clear"
            disabled={onClearRollback == null}
            onClick={() => onClearRollback?.()}
          >
            Clear roll-back
          </button>
        )}
      </div>
      <ol className="cad-kernel-timeline__list">
        {kernelOps.map((op, index) => {
          const suppressed = op.suppressed === true
          const rolledBack = isRolledBack(index, rolledBackTo)
          const isMarker = rolledBackTo !== undefined && rolledBackTo >= 0 && index === rolledBackTo
          const tabbable = index === effectiveActiveRow
          const classes = [
            'cad-kernel-row',
            suppressed ? 'cad-kernel-row--suppressed' : '',
            rolledBack ? 'cad-kernel-row--rolled-back' : '',
            isMarker ? 'cad-kernel-row--marker' : '',
            dragIndex === index ? 'cad-kernel-row--dragging' : '',
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <li
              key={index}
              className={classes}
              data-testid="cad-kernel-row"
              data-kernel-row={index}
              data-kernel-kind={op.kind}
              data-suppressed={suppressed ? 'true' : 'false'}
              data-rolled-back={rolledBack ? 'true' : 'false'}
              draggable={editable}
              tabIndex={tabbable ? 0 : -1}
              aria-label={`${kernelOpLabel(op)}${suppressed ? ' (suppressed)' : ''}${rolledBack ? ' (rolled back)' : ''}`}
              onFocus={() => setActiveRow(index)}
              onKeyDown={handleRowKeyDown(index)}
              onDragStart={editable ? handleDragStart(index) : undefined}
              onDragOver={editable ? handleDragOver : undefined}
              onDrop={editable ? handleDrop(index) : undefined}
              onDragEnd={editable ? handleDragEnd : undefined}
            >
              <span className="cad-kernel-row__grip" aria-hidden="true">
                {editable ? '⠿' : ''}
              </span>
              <span className="cad-kernel-row__index" aria-hidden="true">
                {index + 1}
              </span>
              <span className="cad-kernel-row__label">{kernelOpLabel(op)}</span>
              <span className="cad-kernel-row__controls">
                <button
                  type="button"
                  className="btn btn-ghost btn-xs cad-kernel-row__btn"
                  data-testid="cad-kernel-move-up"
                  tabIndex={tabbable ? 0 : -1}
                  disabled={onMove == null || index === 0}
                  aria-label={`Move ${kernelOpLabel(op)} up`}
                  onClick={() => onMove?.(index, -1)}
                >
                  {'▲'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs cad-kernel-row__btn"
                  data-testid="cad-kernel-move-down"
                  tabIndex={tabbable ? 0 : -1}
                  disabled={onMove == null || index === kernelOps.length - 1}
                  aria-label={`Move ${kernelOpLabel(op)} down`}
                  onClick={() => onMove?.(index, 1)}
                >
                  {'▼'}
                </button>
                <button
                  type="button"
                  className={
                    suppressed
                      ? 'btn btn-ghost btn-xs cad-kernel-row__btn cad-kernel-row__btn--suppressed'
                      : 'btn btn-ghost btn-xs cad-kernel-row__btn'
                  }
                  data-testid="cad-kernel-suppress"
                  tabIndex={tabbable ? 0 : -1}
                  aria-pressed={suppressed}
                  disabled={onSuppressToggle == null}
                  aria-label={
                    suppressed
                      ? `Enable ${kernelOpLabel(op)}`
                      : `Suppress ${kernelOpLabel(op)}`
                  }
                  title={suppressed ? 'Suppressed — click to enable' : 'Suppress this op'}
                  onClick={() => onSuppressToggle?.(index, !suppressed)}
                >
                  {suppressed ? '◌' : '●'}
                </button>
                <button
                  type="button"
                  className={
                    isMarker
                      ? 'btn btn-ghost btn-xs cad-kernel-row__btn cad-kernel-row__btn--marker'
                      : 'btn btn-ghost btn-xs cad-kernel-row__btn'
                  }
                  data-testid="cad-kernel-rollback"
                  tabIndex={tabbable ? 0 : -1}
                  aria-pressed={isMarker}
                  disabled={onSetRollback == null}
                  aria-label={`Roll back to ${kernelOpLabel(op)}`}
                  title="Roll back the build to this op"
                  onClick={() => onSetRollback?.(index)}
                >
                  {'⏱'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs cad-kernel-row__btn cad-kernel-row__btn--delete"
                  data-testid="cad-kernel-delete"
                  tabIndex={tabbable ? 0 : -1}
                  disabled={onDelete == null}
                  aria-label={`Delete ${kernelOpLabel(op)}`}
                  title="Delete this op"
                  onClick={() => onDelete?.(index)}
                >
                  {'✕'}
                </button>
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

export function FeatureTree(props: FeatureTreeProps): JSX.Element {
  const {
    operations,
    onLineClick,
    parameters,
    paramOverrides,
    onParamsChange,
    kernelOps,
    rolledBackTo,
    onKernelMove,
    onKernelReorder,
    onKernelSuppressToggle,
    onKernelSetRollback,
    onKernelClearRollback,
    onKernelDelete,
  } = props

  const editable = onParamsChange != null
  const hasParameters = parameters != null && parameters.length > 0
  const hasKernelOps = kernelOps != null && kernelOps.length > 0

  // The empty-state pin: empty operations, no parameters, AND no kernel
  // timeline fall back to the canonical EmptyState. When parameters or a
  // kernel timeline are present we keep those sections visible even when the
  // sidecar operations list is empty (a built model whose script has been
  // cleared still has a timeline worth editing).
  if (operations.length === 0 && !hasParameters && !hasKernelOps) {
    return (
      <EmptyState
        testId="cad-feature-empty-state"
        title="No operations yet"
        body="Write a CadQuery script and hit Run."
      />
    )
  }

  return (
    <div className="cad-feature-tree-root" data-testid="cad-feature-tree-root">
      {hasParameters && parameters != null && (
        editable ? (
          <EditableParameters
            parameters={parameters}
            paramOverrides={paramOverrides}
            onParamsChange={onParamsChange}
          />
        ) : (
          <ReadOnlyParameters
            parameters={parameters}
            paramOverrides={paramOverrides}
          />
        )
      )}

      {operations.length > 0 && (
        <ol
          className="cad-feature-tree"
          data-testid="cad-feature-tree"
          aria-label="CadQuery feature tree"
        >
          {operations.map((entry, index) => {
            const truncated = truncateArgs(entry.args)
            const isClickable = onLineClick != null
            const handleClick = isClickable
              ? (): void => onLineClick(entry.line)
              : undefined
            return (
              <li
                // Index is part of the key because the same `line` can in
                // theory appear twice if the operator splits an op across
                // multiple sidecar emissions; line + op disambiguates
                // without forcing the sidecar to mint unique IDs.
                key={`${entry.line}-${index}-${entry.op}`}
                className="cad-feature-row"
                data-testid="cad-feature-row"
                data-line={entry.line}
                data-op={entry.op}
                title={entry.args}
                // Only emit `role="button"` when there's an actual click
                // handler -- otherwise the row stays a presentational
                // `<li>` so screen readers don't announce a fake button.
                {...(isClickable
                  ? { role: 'button', tabIndex: 0, onClick: handleClick }
                  : {})}
              >
                <span className="cad-feature-row__line" aria-hidden="true">
                  {entry.line}
                </span>
                <span className="cad-feature-row__op">{entry.op}</span>
                <span className="cad-feature-row__args">{truncated}</span>
              </li>
            )
          })}
        </ol>
      )}

      {hasKernelOps && kernelOps != null && (
        <KernelTimeline
          kernelOps={kernelOps}
          rolledBackTo={rolledBackTo}
          onMove={onKernelMove}
          onReorder={onKernelReorder}
          onSuppressToggle={onKernelSuppressToggle}
          onSetRollback={onKernelSetRollback}
          onClearRollback={onKernelClearRollback}
          onDelete={onKernelDelete}
        />
      )}
    </div>
  )
}

export default FeatureTree
