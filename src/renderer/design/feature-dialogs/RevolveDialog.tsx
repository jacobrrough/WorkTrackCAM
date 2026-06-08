/**
 * FG-5b · Revolve property dialog.
 *
 * Same honesty as {@link ExtrudeDialog}: there is no `revolve` variant in
 * `kernelPostSolidOpSchema`. Revolve is produced by the CadQuery script
 * (`cq.Workplane(...).revolve(angle, axisStart, axisEnd)`), and the dialog
 * drives the script parameters the active script exposes — an **angle** (deg)
 * and an optional **axis-position** value — flowing through
 * `DesignWorkspace.handleParamsChange` → `cad.execute({ buildParameters })`.
 *
 * The kernel audit notes Revolve is "axis line X = const" (`so_revolve`), so the
 * axis-position param maps onto that constant X offset of the revolve axis when
 * the script declares it. When the script declares only an angle, the host
 * passes just `angleParamKey` and the axis field is hidden.
 */

import { useState, type JSX } from 'react'
import {
  DialogApplyRow,
  DialogNumberField,
  FeatureDialogCard
} from './FeatureDialogKit'
import type { CadScriptParamValue } from '../../../shared/sidecar-protocol'
import {
  parseFiniteMm,
  type FeatureDialogBaseProps
} from './feature-dialog-types'

/** Default script-parameter key the Revolve angle maps onto. */
export const DEFAULT_REVOLVE_ANGLE_PARAM = 'revolveAngleDeg'

export interface RevolveDialogParams {
  /** Current revolve angle (deg) shown when the dialog opens. */
  readonly angleDeg: number
  /** Script parameter the angle writes to. Defaults to {@link DEFAULT_REVOLVE_ANGLE_PARAM}. */
  readonly angleParamKey?: string
  /**
   * Optional axis-position (mm) param — the constant-X offset of the revolve
   * axis (`so_revolve` is "axis line X = const"). Present only when the active
   * script declares it; omit to hide the axis field entirely.
   */
  readonly axisXMm?: number
  /** Script parameter the axis-X writes to (required when `axisXMm` is set). */
  readonly axisXParamKey?: string
}

export interface RevolveDialogProps extends FeatureDialogBaseProps {
  readonly params: RevolveDialogParams
}

/** Clamp a revolve angle to (0, 360] degrees, or `null` when invalid. */
function parseAngleDeg(raw: string): number | null {
  if (raw.trim() === '') return null
  const n = Number.parseFloat(raw)
  if (!Number.isFinite(n) || n <= 0 || n > 360) return null
  return n
}

export function RevolveDialog({
  params,
  selectionInfo: _selectionInfo,
  onApply,
  busy,
  disabled
}: RevolveDialogProps): JSX.Element {
  void _selectionInfo
  const angleKey = params.angleParamKey ?? DEFAULT_REVOLVE_ANGLE_PARAM
  const hasAxis = params.axisXMm !== undefined && params.axisXParamKey !== undefined

  const [angleRaw, setAngleRaw] = useState(String(params.angleDeg))
  const [axisRaw, setAxisRaw] = useState(
    params.axisXMm !== undefined ? String(params.axisXMm) : ''
  )

  const angle = parseAngleDeg(angleRaw)
  const axis = hasAxis ? parseFiniteMm(axisRaw) : null
  // Axis is optional; it only blocks Apply when present AND unparseable.
  const axisValid = !hasAxis || axis !== null
  const canApply = angle !== null && axisValid && disabled !== true

  const handleApply = (): void => {
    if (angle === null) return
    const patch: Record<string, CadScriptParamValue> = { [angleKey]: angle }
    if (hasAxis && axis !== null && params.axisXParamKey) {
      patch[params.axisXParamKey] = axis
    }
    onApply({ target: 'scriptParams', params: patch })
  }

  return (
    <FeatureDialogCard title="Revolve" testId="fd-revolve">
      <DialogNumberField
        label="Angle"
        value={angleRaw}
        onChange={setAngleRaw}
        testId="fd-revolve-angle"
        min={0}
        suffix="°"
        disabled={disabled}
      />
      {hasAxis && (
        <DialogNumberField
          label="Axis position (X)"
          value={axisRaw}
          onChange={setAxisRaw}
          testId="fd-revolve-axis"
          suffix="mm"
          disabled={disabled}
        />
      )}
      <p className="fd-note" data-testid="fd-revolve-note">
        Drives the script parameter <code>{angleKey}</code>
        {hasAxis && params.axisXParamKey ? (
          <>
            {' '}
            and <code>{params.axisXParamKey}</code>
          </>
        ) : null}{' '}
        and rebuilds. Revolve geometry comes from the script (axis line X =
        const).
      </p>
      <DialogApplyRow
        label="Apply revolve"
        onApply={handleApply}
        canApply={canApply}
        busy={busy}
        hint={
          disabled === true
            ? 'Open a project and build a model first.'
            : angle === null
              ? 'Enter an angle between 0 and 360 degrees.'
              : !axisValid
                ? 'Enter a finite axis position in millimetres.'
                : undefined
        }
        testId="fd-revolve-apply"
      />
    </FeatureDialogCard>
  )
}

export default RevolveDialog
