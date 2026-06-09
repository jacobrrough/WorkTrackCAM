/**
 * RotaryOrientGizmo — presentational 3-axis part-orientation control for the
 * Makera Carvera 4-axis rotary setup (tool-catalog §2.4, Carvera priority #1).
 *
 * WHAT IT IS
 * ----------
 * A self-contained panel that lets the operator orient a real-world STL into
 * rotary WCS and emits the resulting {@link Placement} via `onChange`. It is the
 * UI half of the P0 gap from `docs/plans/catalog/carvera-4axis.md`:
 * `run-cam-for-op.ts` hard-codes `identityTransform`, while `frame.ts` already
 * accepts a `Placement` — so the only missing piece is a control that produces a
 * real one. This component produces it; the *Integrate* phase wires `onChange`
 * into `run-cam-for-op` / `ManufactureWorkspace` (NOT done here, by design).
 *
 * CONTROLS
 * --------
 *   - Three numeric rotation fields (about viewer X / Y / Z, in degrees).
 *   - Quick-set buttons:
 *       • "X = rotation axis" — spin the part's long axis onto X.
 *       • "Lay flat"          — seat the part's short axis radial-up.
 *       • "Center on chuck"   — axial-shift the part onto the chuck face.
 *       • "Reset"             — back to the identity placement.
 *   - A live numeric read-out of the emitted placement (rotation °, axial X mm)
 *     plus, when part bounds are supplied, an estimated max radial extent with a
 *     "fits Ø / exceeds Ø" hint mirroring the engine's `meshRadialMax` guard.
 *
 * G-CODE SAFETY
 * -------------
 * All orientation math lives in the pure, unit-tested {@link rotary-placement}
 * helper, which only ever emits axis-quadrant rotations (0 / ±90 / 180) and
 * axial-only translations so the placement maps EXACTLY onto `frame.ts`'s
 * transform (see that module's header). This component therefore cannot invent a
 * skew that would land a toolpath on the wrong topology — it just renders the
 * helper's output and forwards it. The authoritative radial/clamp validation
 * still runs in the engine (`cam-axis4/validation.ts`) at generate time; the
 * radial hint here is advisory only.
 *
 * STATE MODEL
 * -----------
 * Controlled-or-uncontrolled: pass `value` to drive it from the host, or omit it
 * and let the component own the placement internally (seeded by `defaultValue`).
 * Either way every change calls `onChange(next)` so the host can persist it. This
 * mirrors the controlled/uncontrolled split used elsewhere in the shell.
 *
 * STRICT TYPING (CLAUDE.md): all props `readonly`, no `any`, every `<button>`
 * carries an explicit `type="button"`.
 */
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import {
  type Axis,
  type PartBounds,
  type Placement,
  type RotaryQuickSet,
  estimateRadialMax,
  identityPlacement,
  placementForQuickSet,
  withRotationAxis
} from './rotary-placement'

// ── Public props ─────────────────────────────────────────────────────────────

export interface RotaryOrientGizmoProps {
  /**
   * Controlled placement. When provided, the component renders exactly this and
   * never keeps its own copy — the host owns the state and must update `value`
   * in response to `onChange`. Omit for uncontrolled mode.
   */
  readonly value?: Placement
  /**
   * Initial placement for uncontrolled mode. Defaults to the identity placement
   * (which equals today's hard-coded behavior). Ignored when `value` is set.
   */
  readonly defaultValue?: Placement
  /**
   * Fired on every placement change with the FULL next placement. This is the
   * single seam the Integrate phase wires into `run-cam-for-op`'s `placement`.
   */
  readonly onChange: (placement: Placement) => void
  /**
   * Optional AABB of the raw part in viewer space. When present it powers the
   * long-axis / lay-flat / center-on-chuck quick-sets and the radial-extent
   * hint. Absent → those quick-sets degrade to a safe no-op (identity).
   */
  readonly partBounds?: PartBounds
  /**
   * Optional rotary stock diameter (mm). When supplied alongside `partBounds`
   * the read-out shows whether the oriented part fits inside the stock OD — the
   * same constraint `cam-axis4/validation.ts` enforces. Advisory only.
   */
  readonly stockDiameterMm?: number
  /** Disable every control (e.g. while a generate is in flight). */
  readonly disabled?: boolean
  /** Optional test id override (defaults to `rotary-orient-gizmo`). */
  readonly testId?: string
}

// ── Local presentation helpers ───────────────────────────────────────────────

const ROTATION_AXES: ReadonlyArray<{ axis: Axis; label: string; hint: string }> = [
  { axis: 'x', label: 'X', hint: 'Spin about the rotation axis (axial roll)' },
  { axis: 'y', label: 'Y', hint: 'Tilt about the viewer depth axis' },
  { axis: 'z', label: 'Z', hint: 'Tilt about the radial-up axis' }
]

const QUICK_SETS: ReadonlyArray<{ id: RotaryQuickSet; label: string; hint: string }> = [
  {
    id: 'x_is_rotation_axis',
    label: 'X = rotation axis',
    hint: "Orient the part's longest dimension along the rotation axis"
  },
  { id: 'lay_flat', label: 'Lay flat', hint: "Seat the part's shortest dimension radial-up" },
  { id: 'center_on_chuck', label: 'Center on chuck', hint: 'Shift the part axially onto the chuck face' }
]

/** Round for display without trailing float noise (e.g. -0 → 0, 90.0000001 → 90). */
function fmtDeg(v: number): string {
  const r = Math.round(v * 1000) / 1000
  return `${Object.is(r, -0) ? 0 : r}°`
}

function fmtMm(v: number): string {
  const r = Math.round(v * 1000) / 1000
  return `${Object.is(r, -0) ? 0 : r} mm`
}

/** Parse a number field, returning the previous value on an unparseable entry. */
function parseDegInput(raw: string, prev: number): number {
  if (raw.trim() === '' || raw.trim() === '-') return prev
  const n = Number(raw)
  return Number.isFinite(n) ? n : prev
}

// ── Component ────────────────────────────────────────────────────────────────

export function RotaryOrientGizmo({
  value,
  defaultValue,
  onChange,
  partBounds,
  stockDiameterMm,
  disabled = false,
  testId = 'rotary-orient-gizmo'
}: RotaryOrientGizmoProps): ReactNode {
  // Controlled when `value` is supplied; otherwise own the placement internally.
  const isControlled = value !== undefined
  const [internal, setInternal] = useState<Placement>(() => defaultValue ?? identityPlacement())
  const placement = isControlled ? value : internal

  const emit = useCallback(
    (next: Placement) => {
      if (!isControlled) setInternal(next)
      onChange(next)
    },
    [isControlled, onChange]
  )

  const onRotationAxisChange = useCallback(
    (axis: Axis, raw: string) => {
      const deg = parseDegInput(raw, placement.rotation[axis])
      emit(withRotationAxis(placement, axis, deg))
    },
    [emit, placement]
  )

  const onQuickSet = useCallback(
    (quickSet: RotaryQuickSet) => {
      emit(placementForQuickSet(quickSet, placement, partBounds))
    },
    [emit, placement, partBounds]
  )

  const onReset = useCallback(() => emit(identityPlacement()), [emit])

  // Radial-extent read-out (advisory mirror of the engine's meshRadialMax guard).
  const radialMax = useMemo(() => estimateRadialMax(placement, partBounds), [placement, partBounds])
  const stockRadius = typeof stockDiameterMm === 'number' && stockDiameterMm > 0 ? stockDiameterMm / 2 : null
  const fitsStock =
    radialMax !== null && stockRadius !== null ? radialMax <= stockRadius + 1e-6 : null

  return (
    <section
      className="rotary-orient-gizmo"
      data-testid={testId}
      aria-label="Rotary part orientation"
      aria-disabled={disabled ? 'true' : undefined}
    >
      <header className="rotary-orient-gizmo__head">
        <h3 className="rotary-orient-gizmo__title">Part orientation</h3>
        <p className="rotary-orient-gizmo__subtitle">
          Align the model to the rotary axis (X). Quick-sets need part bounds.
        </p>
      </header>

      {/* ── Numeric rotation fields ── */}
      <div
        className="rotary-orient-gizmo__rotations"
        role="group"
        aria-label="Rotation (degrees)"
        data-testid={`${testId}-rotations`}
      >
        {ROTATION_AXES.map(({ axis, label, hint }) => {
          const inputId = `${testId}-rot-${axis}`
          return (
            <label key={axis} className="rotary-orient-gizmo__field" htmlFor={inputId} title={hint}>
              <span className={`rotary-orient-gizmo__axis rotary-orient-gizmo__axis--${axis}`}>{label}</span>
              <input
                id={inputId}
                className="rotary-orient-gizmo__num"
                data-testid={inputId}
                type="number"
                inputMode="decimal"
                step={15}
                value={placement.rotation[axis]}
                disabled={disabled}
                onChange={(e) => onRotationAxisChange(axis, e.target.value)}
                aria-label={`Rotation about ${label} in degrees`}
              />
              <span className="rotary-orient-gizmo__unit">deg</span>
            </label>
          )
        })}
      </div>

      {/* ── Axis-align quick-sets ── */}
      <div
        className="rotary-orient-gizmo__quicksets"
        role="group"
        aria-label="Axis-align quick-sets"
        data-testid={`${testId}-quicksets`}
      >
        {QUICK_SETS.map(({ id, label, hint }) => {
          // Every quick-set needs part bounds to compute a non-identity result
          // (x_is_rotation_axis / lay_flat pick the long/short axis; center_on
          // _chuck needs the X extent), so all three are honestly disabled when
          // bounds are absent rather than silently no-op-ing. Reset (below) never
          // needs bounds.
          const quickSetDisabled = disabled || partBounds === undefined
          return (
            <button
              key={id}
              type="button"
              className="rotary-orient-gizmo__quickset secondary"
              data-testid={`${testId}-quickset-${id}`}
              disabled={quickSetDisabled}
              title={partBounds === undefined ? `${hint} (needs part bounds)` : hint}
              onClick={() => onQuickSet(id)}
            >
              {label}
            </button>
          )
        })}
        <button
          type="button"
          className="rotary-orient-gizmo__quickset rotary-orient-gizmo__quickset--reset secondary"
          data-testid={`${testId}-reset`}
          disabled={disabled}
          title="Reset to no transform (identity placement)"
          onClick={onReset}
        >
          Reset
        </button>
      </div>

      {/* ── Live placement read-out ── */}
      <dl className="rotary-orient-gizmo__readout" data-testid={`${testId}-readout`}>
        <div className="rotary-orient-gizmo__readout-item">
          <dt>Rotation</dt>
          <dd data-testid={`${testId}-readout-rotation`}>
            {fmtDeg(placement.rotation.x)} · {fmtDeg(placement.rotation.y)} · {fmtDeg(placement.rotation.z)}
          </dd>
        </div>
        <div className="rotary-orient-gizmo__readout-item">
          <dt>Axial offset (X)</dt>
          <dd data-testid={`${testId}-readout-axial`}>{fmtMm(placement.position.x)}</dd>
        </div>
        <div className="rotary-orient-gizmo__readout-item">
          <dt>Max radial</dt>
          <dd data-testid={`${testId}-readout-radial`}>
            {radialMax === null ? '—' : fmtMm(radialMax)}
            {fitsStock === null ? null : (
              <span
                className={`rotary-orient-gizmo__fit rotary-orient-gizmo__fit--${fitsStock ? 'ok' : 'over'}`}
                data-testid={`${testId}-readout-fit`}
              >
                {fitsStock ? 'fits Ø' : 'exceeds Ø'}
              </span>
            )}
          </dd>
        </div>
      </dl>
    </section>
  )
}

export default RotaryOrientGizmo
