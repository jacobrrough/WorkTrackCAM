/**
 * Reusable PROFILE / PATH picker fields for the selection-heavy feature dialogs.
 *
 * Each is a labelled dropdown over the sketch-derived options (`profileOptions` / `pathOptions`).
 * They render an honest empty-state note when the sketch has no matching geometry, so a dialog never
 * pretends a profile/path exists. The dialog owns the selected value + maps it to its kernel op.
 */

import type { JSX } from 'react'
import { DialogSelectField } from './FeatureDialogKit'
import type { PathOption, ProfileOption } from './profile-path-options'

export function ProfileSelectField({
  label = 'Profile',
  options,
  value,
  onChange,
  testId,
  disabled
}: {
  readonly label?: string
  readonly options: readonly ProfileOption[]
  readonly value: number | null
  readonly onChange: (index: number) => void
  readonly testId: string
  readonly disabled?: boolean
}): JSX.Element {
  if (options.length === 0) {
    return (
      <p className="fd-note" data-testid={`${testId}-empty`}>
        No closed sketch profiles found — draw a closed loop or a circle in the sketch first.
      </p>
    )
  }
  const current = value ?? options[0]!.index
  return (
    <DialogSelectField
      label={label}
      value={String(current)}
      options={options.map((o) => ({ value: String(o.index), label: o.label }))}
      onChange={(v) => onChange(Number(v))}
      testId={testId}
      disabled={disabled}
    />
  )
}

export function PathSelectField({
  label = 'Path',
  options,
  value,
  onChange,
  testId,
  disabled
}: {
  readonly label?: string
  readonly options: readonly PathOption[]
  readonly value: string | null
  readonly onChange: (id: string) => void
  readonly testId: string
  readonly disabled?: boolean
}): JSX.Element {
  if (options.length === 0) {
    return (
      <p className="fd-note" data-testid={`${testId}-empty`}>
        No open sketch polylines found — draw an open polyline to use as the path.
      </p>
    )
  }
  const current = value ?? options[0]!.id
  return (
    <DialogSelectField
      label={label}
      value={current}
      options={options.map((o) => ({ value: o.id, label: o.label }))}
      onChange={onChange}
      testId={testId}
      disabled={disabled}
    />
  )
}
