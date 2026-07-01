/**
 * FEATURE RE-EDIT · Edit-in-place host for one kernel timeline op.
 *
 * Mounted by the workspace when the operator clicks a timeline row's ✎ button.
 * Chooses the editing surface:
 *   1. When {@link featureDialogSpecForOp} can faithfully map the op onto an
 *      existing feature dialog, it mounts the REAL {@link FeatureDialogHost}
 *      with that spec — so the operator edits a fillet in the same FilletDialog
 *      they created it with, pre-filled with the op's current radius / mode /
 *      axis bucket.
 *   2. Otherwise it mounts the {@link GenericOpEditor} (primitive fields
 *      editable, structured fields preserved verbatim) so EVERY op kind is
 *      editable.
 *
 * Either way, the dialog's Apply is routed to `onUpdateKernelOp(index, op)` —
 * NOT to append — which the live host wires to the session's
 * `updateKernelOpAt` (validate → replace in place → persist → rebuild).
 *
 * `key`ing on `index` + `kind` in the caller (or remounting this component)
 * re-seeds the dialog's internal draft state when the edit target changes —
 * the dialogs seed their `useState` from `params` on mount.
 */

import { useMemo, type JSX } from 'react'
import type { KernelPostSolidOp } from '../../../shared/part-features-schema'
import { FeatureDialogHost } from './FeatureDialogHost'
import type { FeatureDialogSelectionInfo } from './feature-dialog-types'
import type { PathOption, ProfileOption } from './profile-path-options'
import { featureDialogSpecForOp } from './kernel-op-edit'
import { GenericOpEditor } from './GenericOpEditor'

export interface EditKernelOpDialogProps {
  /** Timeline position of the op being edited (the update target). */
  readonly index: number
  /** The op's CURRENT persisted state (drives the pre-fill). */
  readonly op: KernelPostSolidOp
  /** Live selection context, forwarded to the bespoke dialogs unchanged. */
  readonly selectionInfo: FeatureDialogSelectionInfo
  /** Replace the op at `index` in place (session `updateKernelOpAt`). */
  readonly onUpdateKernelOp: (index: number, op: KernelPostSolidOp) => void
  /** In-flight flag forwarded to the dialog's Apply button. */
  readonly busy?: boolean
  /** No-project flag forwarded to the dialog. */
  readonly disabled?: boolean
  /** Sketch profile options for profile-picking dialogs (host-threaded). */
  readonly sketchProfiles?: readonly ProfileOption[]
  /** Sketch path options for path-picking dialogs (host-threaded). */
  readonly sketchPaths?: readonly PathOption[]
}

export const EDIT_KERNEL_OP_DIALOG_TESTID = 'fd-edit-host'

export function EditKernelOpDialog({
  index,
  op,
  selectionInfo,
  onUpdateKernelOp,
  busy,
  disabled,
  sketchProfiles = [],
  sketchPaths = []
}: EditKernelOpDialogProps): JSX.Element {
  const spec = useMemo(() => featureDialogSpecForOp(op), [op])

  const handleUpdate = (next: KernelPostSolidOp): void => {
    onUpdateKernelOp(index, next)
  }

  return (
    <div
      className="fd-host"
      data-testid={EDIT_KERNEL_OP_DIALOG_TESTID}
      data-fd-edit-index={index}
      data-fd-edit-kind={op.kind}
    >
      <div
        className="fd-selection__note"
        role="note"
        data-testid="fd-edit-note"
        aria-live="polite"
      >
        Editing timeline op {index + 1} — Apply replaces it in place (no new op is added).
      </div>
      {spec !== null ? (
        <FeatureDialogHost
          // Remount when the edit target changes so the dialog's internal
          // draft state re-seeds from the (new) op's params.
          key={`${index}:${op.kind}`}
          spec={spec}
          selectionInfo={selectionInfo}
          onAppendKernelOp={handleUpdate}
          // The mapper only ever returns kernelOp-target dialogs (never
          // extrude/revolve), so the scriptParams sink is unreachable here.
          // Wired to a no-op rather than faking a script rebuild.
          onScriptParams={IGNORED_SCRIPT_PARAMS}
          busy={busy}
          disabled={disabled}
          sketchProfiles={sketchProfiles}
          sketchPaths={sketchPaths}
        />
      ) : (
        <GenericOpEditor
          key={`${index}:${op.kind}`}
          op={op}
          onApply={handleUpdate}
          busy={busy}
          disabled={disabled}
        />
      )}
    </div>
  )
}

/** Stable no-op — see the `onScriptParams` note above. */
function IGNORED_SCRIPT_PARAMS(): void {
  // unreachable by construction: featureDialogSpecForOp never maps to the
  // extrude/revolve (scriptParams-target) dialogs.
}

export default EditKernelOpDialog
