/**
 * Feeds & Speeds reference card — a self-contained operator widget that turns the
 * shared `computeFeedsAndSpeeds` engine into a live recommendation for the active
 * CNC machine. Pick material + tool + diameter; it shows spindle RPM, cutting feed,
 * and plunge clamped to THIS machine's spindle/feed limits, with honest advisories.
 *
 * Self-contained on purpose (own local pickers) so it drops into the CNC manufacture
 * aux panel without threading op/setup state — machinists use a feeds/speeds calc as
 * a quick reference, not as op state. The numbers are advisory (never emitted); the
 * engine clamps to the machine profile and surfaces every clamp in the notes.
 *
 * Apply-to-op (Wave C): when the host supplies `onApplyToActiveOp`, the card grows a
 * one-click "Apply to op" button that writes the computed spindle RPM + cutting feed
 * onto the currently-selected operation (so the operator no longer hand-copies them).
 * The values handed back are the ALREADY-machine-clamped engine outputs (the engine's
 * whole safety posture is to clamp RPM/feed to the active machine's spindle/feed
 * envelope and surface every clamp in `notes`), so no further clamping is needed at the
 * apply boundary. The button is omitted entirely when the callback is absent — the
 * legacy standalone mounts stay a pure advisory reference.
 */

import { useMemo, useState, type ReactNode } from 'react'
import { SURFACE_SPEED_REFERENCE, type AuditToolType } from '../../shared/material-reference-data'
import { computeFeedsAndSpeeds, type FeedsSpeedsAggressiveness } from '../../shared/feeds-and-speeds'

const MATERIAL_KEYS = Object.keys(SURFACE_SPEED_REFERENCE).sort()

const TOOL_TYPES: ReadonlyArray<{ value: AuditToolType; label: string }> = [
  { value: 'endmill_2f', label: 'End mill · 2-flute' },
  { value: 'endmill_4f', label: 'End mill · 4-flute' },
  { value: 'ball', label: 'Ball nose' },
  { value: 'drill', label: 'Drill' }
]

const AGGRESSIVENESS: ReadonlyArray<FeedsSpeedsAggressiveness> = ['conservative', 'nominal', 'aggressive']

/** Machine limits the card clamps against (subset of MachineProfile). */
export interface FeedsSpeedsCardMachine {
  readonly name?: string
  readonly maxFeedMmMin: number
  readonly minSpindleRpm?: number
  readonly maxSpindleRpm?: number
}

/**
 * Machine-clamped feeds & speeds the card hands to `onApplyToActiveOp`. Both values
 * are the engine outputs already clamped to the active machine's spindle/feed
 * envelope — the consumer writes them straight onto the op (`spindleRpm` /
 * `feedMmMin` op params) without re-clamping.
 */
export interface AppliedFeedsSpeeds {
  readonly spindleRpm: number
  readonly feedMmMin: number
}

export interface FeedsSpeedsCardProps {
  readonly machine: FeedsSpeedsCardMachine
  /** Initial selections (optional — for tests / presets). */
  readonly initialMaterialKey?: string
  readonly initialToolType?: AuditToolType
  readonly initialToolDiameterMm?: number
  /**
   * Optional "Apply to op" hook. When supplied, the card renders an "Apply to op"
   * button that calls this with the machine-clamped spindle RPM + cutting feed for
   * the host to write onto the currently-selected operation. Absent ⇒ the button is
   * not rendered (advisory-only, the legacy behavior).
   */
  readonly onApplyToActiveOp?: (applied: AppliedFeedsSpeeds) => void
  /**
   * Operator-facing label for the currently-selected op (e.g. "Op 2 · Contour"),
   * used in the apply button's helper text. Absent ⇒ a generic "the selected
   * operation" phrasing. Only meaningful when `onApplyToActiveOp` is supplied.
   */
  readonly activeOpLabel?: string
}

export function FeedsSpeedsCard({
  machine,
  initialMaterialKey = 'plywood',
  initialToolType = 'endmill_2f',
  initialToolDiameterMm = 6,
  onApplyToActiveOp,
  activeOpLabel
}: FeedsSpeedsCardProps): ReactNode {
  const [materialKey, setMaterialKey] = useState(initialMaterialKey)
  const [toolType, setToolType] = useState<AuditToolType>(initialToolType)
  const [toolDiameterMm, setToolDiameterMm] = useState(initialToolDiameterMm)
  const [aggressiveness, setAggressiveness] = useState<FeedsSpeedsAggressiveness>('nominal')

  const result = useMemo(
    () =>
      computeFeedsAndSpeeds({
        materialKey,
        toolType,
        toolDiameterMm,
        machine: {
          maxFeedMmMin: machine.maxFeedMmMin,
          minSpindleRpm: machine.minSpindleRpm,
          maxSpindleRpm: machine.maxSpindleRpm
        },
        aggressiveness
      }),
    [materialKey, toolType, toolDiameterMm, machine, aggressiveness]
  )

  return (
    <section className="panel workspace-util-panel util-fs-card" aria-labelledby="mfg-fs-heading" data-testid="feeds-speeds-card">
      <h3 className="subh util-section-heading" id="mfg-fs-heading">
        Feeds &amp; Speeds
      </h3>
      <p className="msg msg--muted util-panel-intro">
        Carbide reference for {machine.name ?? 'this machine'}, clamped to its spindle &amp; feed limits. Advisory — confirm
        against your exact tool, holder, and rigidity.
      </p>

      <div className="row util-fs-controls">
        <label className="util-panel-control">
          Material
          <select
            value={materialKey}
            onChange={(e) => setMaterialKey(e.target.value)}
            data-testid="fs-material"
          >
            {MATERIAL_KEYS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <label className="util-panel-control">
          Tool
          <select
            value={toolType}
            onChange={(e) => setToolType(e.target.value as AuditToolType)}
            data-testid="fs-tool"
          >
            {TOOL_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="util-panel-control">
          Ø&nbsp;mm
          <input
            type="number"
            min={0.1}
            step={0.1}
            value={toolDiameterMm}
            onChange={(e) => setToolDiameterMm(Number(e.target.value))}
            data-testid="fs-dia"
          />
        </label>
      </div>

      <div className="row util-fs-aggr" role="group" aria-label="Cut aggressiveness">
        {AGGRESSIVENESS.map((a) => (
          <button
            key={a}
            type="button"
            className="btn util-fs-aggr-btn"
            aria-pressed={a === aggressiveness}
            onClick={() => setAggressiveness(a)}
          >
            {a}
          </button>
        ))}
      </div>

      {result.ok ? (
        <>
          <dl className="util-fs-readout" data-testid="fs-readout">
            <div className="util-fs-row">
              <dt>Spindle</dt>
              <dd data-testid="fs-rpm">
                {result.spindleRpm.toLocaleString()} RPM
                {result.rpmClamp !== 'none' ? ' · clamped' : ''}
              </dd>
            </div>
            <div className="util-fs-row">
              <dt>Feed</dt>
              <dd data-testid="fs-feed">
                {result.feedMmMin.toLocaleString()} mm/min
                {result.feedClampedToMax ? ' · at max' : ''}
              </dd>
            </div>
            <div className="util-fs-row">
              <dt>Plunge</dt>
              <dd>{result.plungeMmMin.toLocaleString()} mm/min</dd>
            </div>
            <div className="util-fs-row">
              <dt>Surface speed</dt>
              <dd>{result.surfaceSpeedMMin} m/min</dd>
            </div>
            <div className="util-fs-row">
              <dt>Chip load</dt>
              <dd>
                {result.chipLoadMm} mm/tooth · {result.fluteCount}F
              </dd>
            </div>
          </dl>
          {result.notes.length > 0 && (
            <ul className="util-fs-notes" data-testid="fs-notes">
              {result.notes.map((n, i) => (
                <li key={i} className="msg msg--muted">
                  {n}
                </li>
              ))}
            </ul>
          )}
          {onApplyToActiveOp ? (
            <div className="util-fs-apply" data-testid="fs-apply">
              <button
                type="button"
                className="btn primary util-fs-apply-btn"
                data-testid="fs-apply-button"
                onClick={() =>
                  onApplyToActiveOp({
                    spindleRpm: result.spindleRpm,
                    feedMmMin: result.feedMmMin
                  })
                }
              >
                Apply to op
              </button>
              <p className="msg msg--muted util-fs-apply-hint" role="status">
                {`Writes ${result.spindleRpm.toLocaleString()} RPM + ${result.feedMmMin.toLocaleString()} mm/min onto ${
                  activeOpLabel ?? 'the selected operation'
                } (already clamped to ${machine.name ?? 'this machine'}). Plunge stays op-controlled.`}
              </p>
            </div>
          ) : null}
        </>
      ) : (
        <p className="msg msg--muted" role="status" data-testid="fs-unavailable">
          No carbide reference for this material + tool combination — pick another.
        </p>
      )}
    </section>
  )
}

export default FeedsSpeedsCard
