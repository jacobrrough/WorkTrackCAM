/**
 * FdmProcessPanel — the editable K2 Plus PROCESS editor (Wave-3b).
 *
 * Replaces the inert two-item quality dropdown with a real editor whose
 * fields feed the `slice:orca` `overrides` map. The operator edits layer
 * height, infill density, wall loops, print speed, and the nozzle / bed
 * temperatures; a Supports section toggles support generation + the
 * normal/tree style. Every field is OPTIONAL — a blank field means "use the
 * resolved quality preset value" (the panel keeps the existing K2 quality
 * preset dropdown so the operator picks a baseline, then nudges individual
 * knobs).
 *
 * STATE OWNERSHIP
 * ---------------
 * Presentation-only: all state lives in the parent (`ManufactureWorkspace`),
 * which persists it via `onChangeProcess` → `AppSettings.k2ProcessOverridesJson`.
 * The pure field-to-key mapping + the input-side temperature clamp live in
 * `src/shared/fdm-process-overrides.ts` (`buildFdmSliceOverrides`); this file
 * only renders the form and reports edits.
 *
 * SAFETY (G-code is sacred): this panel emits NO G-code. Temperature inputs
 * carry a `max` of the K2 ceiling so the spinner UI itself discourages an
 * over-ceiling value, and `buildFdmSliceOverrides` clamps anyway on the way
 * to the slicer (with the pre-upload `validateGcodeFileTemps` gate as the
 * final backstop). The honesty contract: a value the operator types is the
 * value that drives the next slice (clamped, never silently ignored).
 */
import { type ReactNode } from 'react'
import {
  FDM_TEMP_CEILINGS,
  type FdmProcessOverrides,
  type FdmSupportType
} from '../../shared/fdm-process-overrides'
import {
  K2_PLUS_QUALITY_PRESET_IDS,
  K2_PLUS_SLICE_PRESETS,
  type K2PlusQualityPresetId
} from '../../shared/k2-plus-slice-presets'

export interface FdmProcessPanelProps {
  /** Current editable process state (parent-owned). */
  readonly value: FdmProcessOverrides
  /** Emit the next process state when any field changes. */
  readonly onChangeProcess: (next: FdmProcessOverrides) => void
  /** Active K2 quality preset id (the baseline the overrides nudge). */
  readonly qualityPresetId: K2PlusQualityPresetId
  /** Persist a new quality preset baseline. */
  readonly onChangeQualityPreset: (id: K2PlusQualityPresetId) => void
}

/**
 * Parse a numeric `<input>` value into `number | undefined`. A blank field
 * clears the override (undefined); a non-numeric entry also clears it so a
 * half-typed value never forwards a `NaN`.
 */
function parseNumField(raw: string): number | undefined {
  const t = raw.trim()
  if (t === '') return undefined
  const n = Number.parseFloat(t)
  return Number.isFinite(n) ? n : undefined
}

/** Render the numeric value for an input, or '' when the override is unset. */
function numValue(n: number | undefined): string {
  return n === undefined ? '' : String(n)
}

export function FdmProcessPanel({
  value,
  onChangeProcess,
  qualityPresetId,
  onChangeQualityPreset
}: FdmProcessPanelProps): ReactNode {
  /** Patch one field of the process state and bubble the result up. */
  function patch(part: Partial<FdmProcessOverrides>): void {
    onChangeProcess({ ...value, ...part })
  }

  const supportEnabled = value.supportEnabled === true

  return (
    <section
      className="panel workspace-util-panel fdm-process-panel"
      aria-labelledby="fdm-process-heading"
      data-testid="fdm-process-panel"
    >
      <h2 id="fdm-process-heading">Process (K2 Plus)</h2>
      <p className="msg msg--muted">
        Pick a quality baseline, then override individual settings for this job.
        Blank fields fall back to the preset. Temperatures are capped at the K2
        ceiling (nozzle {FDM_TEMP_CEILINGS.nozzleC} °C, bed {FDM_TEMP_CEILINGS.bedC} °C).
      </p>

      <label htmlFor="fdm-process-quality" className="util-panel-control">
        <span>Quality preset</span>
        <select
          id="fdm-process-quality"
          data-testid="fdm-process-quality-select"
          value={qualityPresetId}
          onChange={(e) => onChangeQualityPreset(e.target.value as K2PlusQualityPresetId)}
        >
          {K2_PLUS_QUALITY_PRESET_IDS.map((id) => (
            <option key={id} value={id} title={K2_PLUS_SLICE_PRESETS[id].description}>
              {K2_PLUS_SLICE_PRESETS[id].label}
            </option>
          ))}
        </select>
      </label>

      <div className="fdm-process-grid" data-testid="fdm-process-grid">
        <label htmlFor="fdm-process-layer-height" className="util-panel-control">
          <span>Layer height (mm)</span>
          <input
            id="fdm-process-layer-height"
            data-testid="fdm-process-layer-height"
            type="number"
            inputMode="decimal"
            min={0.04}
            max={0.6}
            step={0.02}
            placeholder="preset"
            value={numValue(value.layerHeightMm)}
            onChange={(e) => patch({ layerHeightMm: parseNumField(e.target.value) })}
          />
        </label>

        <label htmlFor="fdm-process-infill" className="util-panel-control">
          <span>Infill density (%)</span>
          <input
            id="fdm-process-infill"
            data-testid="fdm-process-infill"
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            step={5}
            placeholder="preset"
            value={numValue(value.infillDensityPct)}
            onChange={(e) => patch({ infillDensityPct: parseNumField(e.target.value) })}
          />
        </label>

        <label htmlFor="fdm-process-walls" className="util-panel-control">
          <span>Wall loops</span>
          <input
            id="fdm-process-walls"
            data-testid="fdm-process-walls"
            type="number"
            inputMode="numeric"
            min={1}
            max={10}
            step={1}
            placeholder="preset"
            value={numValue(value.wallLoops)}
            onChange={(e) => patch({ wallLoops: parseNumField(e.target.value) })}
          />
        </label>

        <label htmlFor="fdm-process-speed" className="util-panel-control">
          <span>Print speed (mm/s)</span>
          <input
            id="fdm-process-speed"
            data-testid="fdm-process-speed"
            type="number"
            inputMode="numeric"
            min={10}
            max={600}
            step={10}
            placeholder="preset"
            value={numValue(value.printSpeedMmS)}
            onChange={(e) => patch({ printSpeedMmS: parseNumField(e.target.value) })}
          />
        </label>

        <label htmlFor="fdm-process-nozzle" className="util-panel-control">
          <span>Nozzle temp (°C)</span>
          <input
            id="fdm-process-nozzle"
            data-testid="fdm-process-nozzle-temp"
            type="number"
            inputMode="numeric"
            min={150}
            max={FDM_TEMP_CEILINGS.nozzleC}
            step={5}
            placeholder="preset"
            value={numValue(value.nozzleTempC)}
            onChange={(e) => patch({ nozzleTempC: parseNumField(e.target.value) })}
          />
        </label>

        <label htmlFor="fdm-process-bed" className="util-panel-control">
          <span>Bed temp (°C)</span>
          <input
            id="fdm-process-bed"
            data-testid="fdm-process-bed-temp"
            type="number"
            inputMode="numeric"
            min={0}
            max={FDM_TEMP_CEILINGS.bedC}
            step={5}
            placeholder="preset"
            value={numValue(value.bedTempC)}
            onChange={(e) => patch({ bedTempC: parseNumField(e.target.value) })}
          />
        </label>
      </div>

      {/* -- Supports section -- */}
      <fieldset
        className="fdm-process-supports"
        data-testid="fdm-supports-fieldset"
        aria-labelledby="fdm-supports-legend"
      >
        <legend id="fdm-supports-legend">Supports</legend>
        <label htmlFor="fdm-supports-enable" className="util-panel-control fdm-supports-enable">
          <input
            id="fdm-supports-enable"
            data-testid="fdm-supports-enable"
            type="checkbox"
            checked={supportEnabled}
            onChange={(e) =>
              patch({
                supportEnabled: e.target.checked,
                // Default to 'normal' the first time supports are switched on
                // so the override map carries a concrete style.
                ...(e.target.checked && value.supportType === undefined
                  ? { supportType: 'normal' as FdmSupportType }
                  : {})
              })
            }
          />
          <span>Generate supports</span>
        </label>
        <label htmlFor="fdm-supports-type" className="util-panel-control">
          <span>Support style</span>
          <select
            id="fdm-supports-type"
            data-testid="fdm-supports-type"
            value={value.supportType ?? 'normal'}
            disabled={!supportEnabled}
            onChange={(e) => patch({ supportType: e.target.value as FdmSupportType })}
          >
            <option value="normal">Normal (auto)</option>
            <option value="tree">Tree (auto)</option>
          </select>
        </label>
        <p className="msg msg--muted">
          {supportEnabled
            ? `Supports on — ${value.supportType === 'tree' ? 'tree' : 'normal'} style. The slicer adds removable support material under overhangs.`
            : 'Supports off — overhangs print unsupported.'}
        </p>
      </fieldset>
    </section>
  )
}

export default FdmProcessPanel
