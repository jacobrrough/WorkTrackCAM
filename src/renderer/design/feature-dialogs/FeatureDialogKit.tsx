/**
 * FG-5b · Shared presentational kit for the per-feature property dialogs.
 *
 * Small, dependency-free building blocks every dialog composes:
 *   - {@link FeatureDialogCard}      — the `.dc-prop-card` wrapper + title.
 *   - {@link DialogNumberField}      — a labelled numeric input (mm / count / °).
 *   - {@link DialogSelectField}      — a labelled `<select>` for enum params.
 *   - {@link EdgeDirectionPicker}    — the axis-bucket (±X/±Y/±Z) chooser the
 *     kernel's `*_select` ops actually consume.
 *   - {@link SelectionContextBanner} — honest read-out of the operator's pick.
 *   - {@link DialogApplyRow}         — the bottom Apply button + optional hint.
 *
 * Styling: reuses the mockup `.dc-prop-card` look (sunken surface, border,
 * radius) from `styles/shell/design-cockpit.css` and adds a thin set of
 * `.fd-*` (feature-dialog) classes — all themed via tokens, no inline styles,
 * no hard-coded colors. New `.fd-*` rules live in the same cockpit CSS file.
 *
 * Every interactive element is a `<button type="button">` or a native control;
 * no `any` types; labels are associated to inputs via `htmlFor` for a11y.
 */

import { useId, type JSX, type ReactNode } from 'react'
import {
  EDGE_DIRECTION_LABELS,
  EDGE_DIRECTION_OPTIONS,
  type EdgeDirection,
  type FeatureDialogSelectionInfo
} from './feature-dialog-types'

/** The `.dc-prop-card` wrapper used by every dialog (matches the mockup). */
export function FeatureDialogCard({
  title,
  testId,
  children
}: {
  readonly title: string
  readonly testId: string
  readonly children: ReactNode
}): JSX.Element {
  return (
    <section
      className="dc-prop-card fd-dialog"
      data-testid={testId}
      aria-label={`${title} properties`}
    >
      <h3 className="dc-prop-card-title fd-dialog__title">{title}</h3>
      <div className="fd-dialog__body">{children}</div>
    </section>
  )
}

/** A labelled numeric input. Reports the raw string so the parent can parse. */
export function DialogNumberField({
  label,
  value,
  onChange,
  testId,
  step = 'any',
  min,
  suffix,
  disabled
}: {
  readonly label: string
  readonly value: string
  readonly onChange: (raw: string) => void
  readonly testId: string
  readonly step?: string
  readonly min?: number
  /** Unit hint shown after the input (e.g. "mm", "°"). Presentational only. */
  readonly suffix?: string
  readonly disabled?: boolean
}): JSX.Element {
  const id = useId()
  return (
    <div className="fd-field" data-testid={`${testId}-field`}>
      <label className="fd-field__label" htmlFor={id}>
        {label}
      </label>
      <div className="fd-field__control">
        <input
          id={id}
          className="fd-field__input"
          data-testid={testId}
          type="number"
          step={step}
          min={min}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
        {suffix !== undefined && (
          <span className="fd-field__suffix" aria-hidden="true">
            {suffix}
          </span>
        )}
      </div>
    </div>
  )
}

/** A labelled `<select>` for enum-valued params (mode, side, …). */
export function DialogSelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  testId,
  disabled
}: {
  readonly label: string
  readonly value: T
  readonly options: ReadonlyArray<{ readonly value: T; readonly label: string }>
  readonly onChange: (value: T) => void
  readonly testId: string
  readonly disabled?: boolean
}): JSX.Element {
  const id = useId()
  return (
    <div className="fd-field" data-testid={`${testId}-field`}>
      <label className="fd-field__label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="fd-field__select"
        data-testid={testId}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}

/**
 * The axis-bucket direction chooser. This is the targeting the kernel's
 * `fillet_select` / `chamfer_select` / `shell_inward` ops genuinely consume —
 * a coarse ±X/±Y/±Z bucket, NOT a picked edge. Rendered as a 2×3 grid of
 * toggle buttons so the operator sees all six at once.
 */
export function EdgeDirectionPicker({
  value,
  onChange,
  testId,
  disabled
}: {
  readonly value: EdgeDirection
  readonly onChange: (dir: EdgeDirection) => void
  readonly testId: string
  readonly disabled?: boolean
}): JSX.Element {
  return (
    <div
      className="fd-field fd-dir-picker"
      data-testid={`${testId}-field`}
      role="group"
      aria-label="Edge direction (axis bucket)"
    >
      <span className="fd-field__label">Edge direction (axis bucket)</span>
      <div className="fd-dir-picker__grid">
        {EDGE_DIRECTION_OPTIONS.map((dir) => {
          const active = dir === value
          return (
            <button
              key={dir}
              type="button"
              className={
                active
                  ? 'btn btn-primary btn-sm fd-dir-picker__btn fd-dir-picker__btn--active'
                  : 'btn btn-ghost btn-sm fd-dir-picker__btn'
              }
              data-testid={`${testId}-${dir}`}
              data-active={active ? 'true' : 'false'}
              aria-pressed={active}
              disabled={disabled}
              onClick={() => onChange(dir)}
            >
              {EDGE_DIRECTION_LABELS[dir]}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Honest read-out of the operator's current 3D pick. When a face/edge is
 * picked it shows the friendly label; otherwise it prompts the operator to pick
 * one. The `note` slot is where a dialog states an honest capability limit
 * (e.g. "picked-edge fillet needs new kernel support — applying by axis
 * bucket"), so the limitation is always visible, never hidden.
 */
export function SelectionContextBanner({
  selectionInfo,
  emptyPrompt,
  note,
  testId
}: {
  readonly selectionInfo: FeatureDialogSelectionInfo
  readonly emptyPrompt: string
  readonly note?: string
  readonly testId: string
}): JSX.Element {
  const { selection, label } = selectionInfo
  return (
    <div className="fd-selection" data-testid={testId} role="status" aria-live="polite">
      {selection !== null ? (
        <span className="fd-selection__label" data-testid={`${testId}-label`}>
          Selected: {label ?? `${selection.kind} ${selection.faceId}`}
        </span>
      ) : (
        <span className="fd-selection__empty" data-testid={`${testId}-empty`}>
          {emptyPrompt}
        </span>
      )}
      {note !== undefined && (
        <span className="fd-selection__note" data-testid={`${testId}-note`}>
          {note}
        </span>
      )}
    </div>
  )
}

/**
 * Bottom Apply row. `canApply` gates the button (invalid values, no project);
 * `busy` shows the in-flight state; `hint` carries an honest reason the button
 * is disabled (so the operator isn't left guessing). The label is dialog-
 * supplied (e.g. "Add fillet", "Apply extrude").
 */
export function DialogApplyRow({
  label,
  onApply,
  canApply,
  busy,
  hint,
  testId
}: {
  readonly label: string
  readonly onApply: () => void
  readonly canApply: boolean
  readonly busy?: boolean
  readonly hint?: string
  readonly testId: string
}): JSX.Element {
  return (
    <div className="fd-apply-row">
      {hint !== undefined && (
        <span className="fd-apply-row__hint" data-testid={`${testId}-hint`}>
          {hint}
        </span>
      )}
      <button
        type="button"
        className="btn btn-primary btn-sm fd-apply-row__btn"
        data-testid={testId}
        disabled={!canApply || busy === true}
        aria-busy={busy === true}
        onClick={onApply}
      >
        {busy === true ? 'Applying…' : label}
      </button>
    </div>
  )
}
