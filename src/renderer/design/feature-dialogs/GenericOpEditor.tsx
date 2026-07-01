/**
 * FEATURE RE-EDIT · Generic kernel-op parameter editor — the fallback surface
 * for timeline ops whose bespoke dialog cannot faithfully pre-fill (picked-id
 * fillets, labeled datums, profile/path ops) or that have no dialog at all
 * (`sheet_fold`, `thicken_scale`, …). Guarantees EVERY op kind in the timeline
 * is editable.
 *
 * Contract:
 *   - Primitive fields (number / boolean / string) render as editable inputs
 *     seeded from the op's CURRENT values. `kind` is fixed (changing an op's
 *     kind is a delete + re-add, not an edit) and `suppressed` is excluded
 *     (enable/disable state belongs to the timeline's suppress toggle; the
 *     session's update path preserves it).
 *   - Non-primitive fields (arrays / tuples like `pathPoints`, `pickedEdgeIds`,
 *     `rails`) render READ-ONLY as JSON and are re-emitted VERBATIM — the
 *     editor never fabricates a geometry-editing capability it doesn't have.
 *   - Apply reconstructs the op and validates it through the REAL
 *     `kernelPostSolidOpSchema`; a rejection surfaces the schema's first issue
 *     inline and nothing is emitted (the kernel is sacred, Safety Rule 1).
 *
 * Presentational + props-driven like every other dialog in this folder: the
 * caller owns what `onApply` does with the validated op (the edit host routes
 * it to `updateKernelOpAt`).
 */

import { useMemo, useState, type ChangeEvent, type JSX } from 'react'
import {
  kernelPostSolidOpSchema,
  type KernelPostSolidOp
} from '../../../shared/part-features-schema'
import { DialogApplyRow, FeatureDialogCard } from './FeatureDialogKit'

/** How a single op field is edited (or honestly not). */
export type GenericOpFieldKind = 'number' | 'boolean' | 'string' | 'readonly'

export interface GenericOpField {
  readonly name: string
  readonly kind: GenericOpFieldKind
  /** The op's current value for the field (drives the seeded input). */
  readonly value: unknown
}

/**
 * Derive the editable field list for an op: one entry per own key, excluding
 * the fixed `kind` discriminator and the timeline-owned `suppressed` flag.
 * Primitives are editable; everything else is a read-only preserve-verbatim
 * row. Pure + exported so the node-suite test can prove every op kind yields
 * a workable field set (and that an identity rebuild re-validates).
 */
export function genericFieldsForOp(op: KernelPostSolidOp): GenericOpField[] {
  const record = op as Record<string, unknown>
  const fields: GenericOpField[] = []
  for (const [name, value] of Object.entries(record)) {
    if (name === 'kind' || name === 'suppressed') continue
    if (typeof value === 'number') fields.push({ name, kind: 'number', value })
    else if (typeof value === 'boolean') fields.push({ name, kind: 'boolean', value })
    else if (typeof value === 'string') fields.push({ name, kind: 'string', value })
    else fields.push({ name, kind: 'readonly', value })
  }
  return fields
}

/**
 * Rebuild the candidate op from the original + the operator's drafts, then
 * validate through the REAL schema. Pure + exported for the node-suite test.
 * Draft values: numbers arrive as raw strings (parsed here), booleans as
 * booleans, strings as strings. Fields without a draft keep their current
 * value; read-only fields (+ `kind` + `suppressed`) are copied verbatim.
 */
export function buildGenericOpCandidate(
  op: KernelPostSolidOp,
  drafts: Readonly<Record<string, string | boolean>>
): { readonly ok: true; readonly op: KernelPostSolidOp } | { readonly ok: false; readonly error: string } {
  const candidate: Record<string, unknown> = { ...(op as Record<string, unknown>) }
  for (const field of genericFieldsForOp(op)) {
    if (!Object.prototype.hasOwnProperty.call(drafts, field.name)) continue
    const draft = drafts[field.name]
    switch (field.kind) {
      case 'number': {
        const parsed = Number.parseFloat(String(draft))
        if (!Number.isFinite(parsed)) {
          return { ok: false, error: `${field.name} must be a finite number.` }
        }
        candidate[field.name] = parsed
        break
      }
      case 'boolean':
        candidate[field.name] = draft === true
        break
      case 'string':
        candidate[field.name] = String(draft)
        break
      case 'readonly':
        break
    }
  }
  const parsed = kernelPostSolidOpSchema.safeParse(candidate)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    const path = first && first.path.length > 0 ? `${first.path.join('.')}: ` : ''
    return { ok: false, error: `${path}${first?.message ?? 'invalid op'}` }
  }
  return { ok: true, op: parsed.data }
}

export interface GenericOpEditorProps {
  /** The persisted timeline op being edited (seeds every field). */
  readonly op: KernelPostSolidOp
  /** Receives the schema-validated replacement op on Apply. */
  readonly onApply: (op: KernelPostSolidOp) => void
  /** In-flight flag forwarded to the Apply button. */
  readonly busy?: boolean
  /** No-project flag — renders a disabled Apply with an honest hint. */
  readonly disabled?: boolean
}

export function GenericOpEditor({ op, onApply, busy, disabled }: GenericOpEditorProps): JSX.Element {
  const fields = useMemo(() => genericFieldsForOp(op), [op])
  // Draft buffer seeded lazily from the op's current values; numbers are kept
  // as raw strings so partial input ("-", "1.") never fights the operator.
  const [drafts, setDrafts] = useState<Record<string, string | boolean>>(() => {
    const seed: Record<string, string | boolean> = {}
    for (const f of fields) {
      if (f.kind === 'number' || f.kind === 'string') seed[f.name] = String(f.value)
      else if (f.kind === 'boolean') seed[f.name] = f.value === true
    }
    return seed
  })
  const [applyError, setApplyError] = useState<string | null>(null)

  const handleTextChange = (name: string) => (e: ChangeEvent<HTMLInputElement>): void => {
    const raw = e.target.value
    setDrafts((d) => ({ ...d, [name]: raw }))
  }
  const handleBooleanChange = (name: string) => (e: ChangeEvent<HTMLInputElement>): void => {
    const checked = e.target.checked
    setDrafts((d) => ({ ...d, [name]: checked }))
  }

  const handleApply = (): void => {
    const result = buildGenericOpCandidate(op, drafts)
    if (!result.ok) {
      setApplyError(result.error)
      return
    }
    setApplyError(null)
    onApply(result.op)
  }

  return (
    <FeatureDialogCard title={`Edit ${op.kind}`} testId="fd-generic-edit">
      {fields.map((field) => {
        const inputId = `fd-generic-${field.name}`
        return (
          <div className="fd-field" key={field.name} data-testid={`fd-generic-field-${field.name}`}>
            <label className="fd-field__label" htmlFor={inputId}>
              {field.name}
            </label>
            {field.kind === 'number' && (
              <input
                id={inputId}
                className="fd-field__input"
                data-testid={`fd-generic-input-${field.name}`}
                type="number"
                step="any"
                value={typeof drafts[field.name] === 'string' ? (drafts[field.name] as string) : ''}
                disabled={disabled}
                onChange={handleTextChange(field.name)}
              />
            )}
            {field.kind === 'string' && (
              <input
                id={inputId}
                className="fd-field__input"
                data-testid={`fd-generic-input-${field.name}`}
                type="text"
                value={typeof drafts[field.name] === 'string' ? (drafts[field.name] as string) : ''}
                disabled={disabled}
                onChange={handleTextChange(field.name)}
              />
            )}
            {field.kind === 'boolean' && (
              <input
                id={inputId}
                className="fd-field__input"
                data-testid={`fd-generic-input-${field.name}`}
                type="checkbox"
                checked={drafts[field.name] === true}
                disabled={disabled}
                onChange={handleBooleanChange(field.name)}
              />
            )}
            {field.kind === 'readonly' && (
              <code
                className="fd-field__suffix"
                data-testid={`fd-generic-readonly-${field.name}`}
                title="Structured value — preserved as-is (not editable here)"
              >
                {JSON.stringify(field.value)}
              </code>
            )}
          </div>
        )
      })}
      {applyError !== null && (
        <div className="fd-selection__note" role="alert" data-testid="fd-generic-error">
          {applyError}
        </div>
      )}
      <DialogApplyRow
        label="Update op"
        onApply={handleApply}
        canApply={disabled !== true}
        busy={busy}
        hint={disabled === true ? 'Open a project and build a model first.' : undefined}
        testId="fd-generic-apply"
      />
    </FeatureDialogCard>
  )
}

export default GenericOpEditor
