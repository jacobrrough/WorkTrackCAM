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

import { useMemo, useState, type ChangeEvent, type JSX } from 'react'
import { EmptyState } from '../src/EmptyState'

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

export function FeatureTree(props: FeatureTreeProps): JSX.Element {
  const {
    operations,
    onLineClick,
    parameters,
    paramOverrides,
    onParamsChange,
  } = props

  const editable = onParamsChange != null
  const hasParameters = parameters != null && parameters.length > 0

  // The empty-state pin: empty operations AND no parameters fall back
  // to the canonical EmptyState. When parameters are present we keep
  // the param section visible even when operations are empty so the
  // operator can still edit defaults (a script that defines params but
  // has no ops yet — typical first edit state).
  if (operations.length === 0 && !hasParameters) {
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
    </div>
  )
}

export default FeatureTree
