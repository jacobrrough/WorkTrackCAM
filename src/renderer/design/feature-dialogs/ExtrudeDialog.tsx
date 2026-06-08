/**
 * FG-5b · Extrude property dialog.
 *
 * Honest scope: there is **no `extrude` variant** in `kernelPostSolidOpSchema`
 * — that union holds only *post-base* ops (fillet/chamfer/shell/pattern/…). The
 * base solid is produced by the CadQuery script (`cq.Workplane(...).extrude(...)`
 * or `.box(...)`), and the starter script exposes its depth as a top-level
 * parameter. So this dialog drives the **script parameter** the operator already
 * has, flowing through `DesignWorkspace.handleParamsChange` →
 * `cad.execute({ buildParameters })`. It does NOT fabricate a kernelOp.
 *
 * What the operator controls here:
 *   - **Depth** → the numeric script param (default key `extrudeDepthMm`, but
 *     the host can point it at whatever the active script declares).
 *   - **Direction** (symmetric / one-side) and **operation** (new / cut / join)
 *     are surfaced as honest, disabled placeholders with a note, because the
 *     current script path only exposes the single depth value — pretending the
 *     dropdowns did anything would violate "do not fake capability." They are
 *     rendered so the dialog reads as a real Fusion-style extrude and so a
 *     later cycle that teaches the script multi-direction extrude can light
 *     them up without reshaping the UI.
 */

import { useState, type JSX } from 'react'
import {
  DialogApplyRow,
  DialogNumberField,
  DialogSelectField,
  FeatureDialogCard
} from './FeatureDialogKit'
import {
  parsePositiveMm,
  type FeatureDialogBaseProps
} from './feature-dialog-types'

/** Default script-parameter key the Extrude depth maps onto. */
export const DEFAULT_EXTRUDE_DEPTH_PARAM = 'extrudeDepthMm'

export interface ExtrudeDialogParams {
  /** Current depth (mm) shown when the dialog opens. */
  readonly depthMm: number
  /**
   * Which script parameter the depth writes to. Defaults to
   * {@link DEFAULT_EXTRUDE_DEPTH_PARAM}; the host passes the actual declared
   * name when the active script uses a different identifier.
   */
  readonly depthParamKey?: string
}

export interface ExtrudeDialogProps extends FeatureDialogBaseProps {
  readonly params: ExtrudeDialogParams
}

export function ExtrudeDialog({
  params,
  selectionInfo: _selectionInfo,
  onApply,
  busy,
  disabled
}: ExtrudeDialogProps): JSX.Element {
  void _selectionInfo // selection is not required to set a depth value
  const paramKey = params.depthParamKey ?? DEFAULT_EXTRUDE_DEPTH_PARAM
  const [depthRaw, setDepthRaw] = useState(String(params.depthMm))

  const depth = parsePositiveMm(depthRaw)
  const canApply = depth !== null && disabled !== true

  const handleApply = (): void => {
    if (depth === null) return
    onApply({ target: 'scriptParams', params: { [paramKey]: depth } })
  }

  return (
    <FeatureDialogCard title="Extrude" testId="fd-extrude">
      <DialogNumberField
        label="Depth"
        value={depthRaw}
        onChange={setDepthRaw}
        testId="fd-extrude-depth"
        min={0}
        suffix="mm"
        disabled={disabled}
      />
      {/*
        Direction + operation are honest placeholders: the script path exposes a
        single depth value only. They render disabled so the dialog reads as a
        real extrude without claiming behavior the kernel/script can't deliver.
      */}
      <DialogSelectField
        label="Direction"
        value="one-side"
        options={[
          { value: 'one-side', label: 'One side' },
          { value: 'symmetric', label: 'Symmetric (script support pending)' }
        ]}
        onChange={() => undefined}
        testId="fd-extrude-direction"
        disabled
      />
      <DialogSelectField
        label="Operation"
        value="new"
        options={[
          { value: 'new', label: 'New body' },
          { value: 'cut', label: 'Cut (use a boolean op)' },
          { value: 'join', label: 'Join (use a boolean op)' }
        ]}
        onChange={() => undefined}
        testId="fd-extrude-operation"
        disabled
      />
      <p className="fd-note" data-testid="fd-extrude-note">
        Drives the script parameter <code>{paramKey}</code> and rebuilds. Cut /
        join and symmetric extrude are not yet exposed by the script path — use a
        boolean op for cut/join today.
      </p>
      <DialogApplyRow
        label="Apply extrude"
        onApply={handleApply}
        canApply={canApply}
        busy={busy}
        hint={
          disabled === true
            ? 'Open a project and build a model first.'
            : depth === null
              ? 'Enter a positive depth in millimetres.'
              : undefined
        }
        testId="fd-extrude-apply"
      />
    </FeatureDialogCard>
  )
}

export default ExtrudeDialog
