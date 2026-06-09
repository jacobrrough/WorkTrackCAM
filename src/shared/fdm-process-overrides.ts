/**
 * FDM process overrides — pure UI-shape ⇆ OrcaSlicer override-key mapping.
 *
 * Wave-3b (K2-Plus FDM) wires the formerly-inert Process editor + Supports
 * toggle in the Manufacture workspace into the real slice call. The slice
 * IPC (`slice:orca`) already accepts an `overrides: Record<string, string |
 * number>` map that the main-process {@link planOrcaOverrides} routes into
 * process / filament overlay JSON (clamping temperatures to the K2 ceiling).
 * This module is the framework-agnostic bridge between the renderer's
 * editable process form and those Orca-flavour override keys.
 *
 * WHY A SHARED PURE MODULE
 * ------------------------
 * The Process panel is React, but the field-to-key translation + the
 * input-side temperature guard must be unit-testable in the `node` vitest env
 * without mounting a component. Keeping it pure (no React, no DOM, no
 * `window`) lets `fdm-process-overrides.test.ts` assert the exact override
 * map a given form state produces — the load-bearing contract that the real
 * `M104`/`M140` OrcaSlicer emits stay inside the K2 firmware ceiling.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * G-CODE SAFETY (read before changing the temperature handling)
 * ──────────────────────────────────────────────────────────────────────────
 * Temperatures are DOUBLE-GUARDED, defence-in-depth:
 *   1. INPUT side (here): {@link buildFdmSliceOverrides} clamps any nozzle/bed
 *      override to {@link FDM_TEMP_CEILINGS} before it ever leaves the
 *      renderer, and records a warning. A non-finite / out-of-range value is
 *      dropped (never forwarded), so the slicer can never even be ASKED to
 *      emit an over-ceiling target. The ceilings mirror
 *      `resources/machines/creality-k2-plus.json` (nozzle ≤ 350 °C, bed ≤
 *      120 °C) and CLAUDE.md §1.
 *   2. OUTPUT side (main process): `planOrcaOverrides` clamps again, and the
 *      pre-upload `validateGcodeFileTemps` gate rejects any produced G-code
 *      that still exceeds the ceiling before the Moonraker push.
 * This module NEVER emits G-code and NEVER comment-encodes a heater command —
 * it only produces the small key/value override map the proven slice path
 * already understands. The `fdm_passthrough` post + the temp-validator gate
 * are untouched.
 *
 * The OrcaSlicer 2.3.x process/filament keys this maps onto:
 *   - `layer_height`            (process scalar, mm)
 *   - `sparse_infill_density`   (process scalar, percent — Orca stores "15%")
 *   - `wall_loops`              (process scalar, integer wall count)
 *   - process speed keys        (`outer_wall_speed` / `inner_wall_speed` /
 *                                `sparse_infill_speed` / `internal_solid_infill_speed`,
 *                                mm/s — one Speed field drives all four)
 *   - `enable_support`          (process scalar, "0" | "1")
 *   - `support_type`            (process scalar, "normal(auto)" | "tree(auto)")
 *   - `nozzle_temperature` +    (FILAMENT keys, routed by `planOrcaOverrides`;
 *     `nozzle_temperature_initial_layer`   clamped to nozzle ceiling)
 *   - `hot_plate_temp` +        (FILAMENT keys; clamped to bed ceiling)
 *     `hot_plate_temp_initial_layer`
 */

/**
 * K2 Plus firmware temperature ceilings (deg C). Mirrors
 * `K2_OVERRIDE_TEMP_CEILINGS` in `src/main/slicer/orca-wrapper.ts`,
 * `K2_PLUS_HARDWARE_CEILINGS` in `src/shared/k2-plus-slice-presets.ts`,
 * `resources/machines/creality-k2-plus.json` (`maxNozzleTempC` /
 * `maxBedTempC`), and CLAUDE.md "USER CONTEXT — TARGET MACHINES" §1.
 *
 * Safety Rule 1 (G-code is sacred): editing these requires editing the
 * machine profile JSON AND CLAUDE.md §1 AND the two sibling constants in the
 * same change — they are intentionally duplicated so each layer of the
 * pipeline can guard independently.
 */
export const FDM_TEMP_CEILINGS = {
  /** Max nozzle target in deg C. */
  nozzleC: 350,
  /** Max bed / build-plate target in deg C. */
  bedC: 120
} as const

/** The two support styles the K2 Plus / OrcaSlicer offers. */
export const FDM_SUPPORT_TYPES = ['normal', 'tree'] as const
export type FdmSupportType = (typeof FDM_SUPPORT_TYPES)[number]

/**
 * The editable process state owned by the Process panel. Every field is
 * optional: an absent / blank field means "do not override — use the
 * resolved quality preset's value". This is the renderer-facing shape; it is
 * NOT persisted verbatim (it round-trips through {@link AppSettings}'s
 * `k2ProcessOverridesJson` string).
 *
 * Units:
 *   - `layerHeightMm`     mm   (e.g. 0.2)
 *   - `infillDensityPct`  %    (0..100, e.g. 15)
 *   - `wallLoops`         int  (wall/perimeter count, e.g. 3)
 *   - `printSpeedMmS`     mm/s (drives the wall + infill speed keys)
 *   - `nozzleTempC`       °C   (clamped to the nozzle ceiling on the way out)
 *   - `bedTempC`          °C   (clamped to the bed ceiling on the way out)
 *   - `supportEnabled`    bool (emits `enable_support`)
 *   - `supportType`       'normal' | 'tree' (emits `support_type`, only when
 *                          `supportEnabled` is true)
 */
export interface FdmProcessOverrides {
  layerHeightMm?: number
  infillDensityPct?: number
  wallLoops?: number
  printSpeedMmS?: number
  nozzleTempC?: number
  bedTempC?: number
  supportEnabled?: boolean
  supportType?: FdmSupportType
}

/** Empty (no-override) process state — every field absent. */
export const EMPTY_FDM_PROCESS_OVERRIDES: FdmProcessOverrides = {}

/** Result of {@link buildFdmSliceOverrides}. */
export interface FdmSliceOverridesPlan {
  /**
   * The Orca-flavour override map to pass as the `slice:orca` `overrides`
   * field. `null` when the process state is empty (no key was set) so the
   * caller can omit the field entirely and keep the slice argv byte-identical
   * to a no-override run.
   */
  overrides: Record<string, string | number> | null
  /**
   * Operator-facing warnings produced while building the map — most
   * importantly the input-side temperature-clamp notices. Empty when nothing
   * was clamped or dropped.
   */
  warnings: string[]
}

/** True for a finite number strictly greater than zero. */
function isPositiveFinite(n: number | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0
}

/**
 * Clamp a temperature override to its ceiling, pushing a warning when the
 * requested value is reduced. Returns the clamped value, or `null` when the
 * input is not a usable temperature (non-finite or ≤ 0) — in which case it is
 * dropped with a warning so a malformed target never reaches the slicer.
 */
function clampTemp(
  requested: number | undefined,
  ceiling: number,
  label: string,
  warnings: string[]
): number | null {
  if (requested === undefined) return null
  if (!Number.isFinite(requested) || requested <= 0) {
    warnings.push(
      `Ignored ${label} override "${String(requested)}": not a valid temperature; the quality preset value will be used.`
    )
    return null
  }
  if (requested > ceiling) {
    warnings.push(
      `Clamped ${label} from ${requested} °C to the K2 Plus ceiling of ${ceiling} °C.`
    )
    return ceiling
  }
  return requested
}

/**
 * Build the OrcaSlicer override map (+ warnings) from the editable process
 * state. Pure: no FS, no subprocess, no React.
 *
 * Mapping rules (only SET fields produce keys — an absent field is omitted so
 * the quality preset's value wins):
 *   - `layerHeightMm`    → `layer_height` (string mm).
 *   - `infillDensityPct` → `sparse_infill_density` as an Orca percent string
 *     ("15%"). Clamped to 0..100.
 *   - `wallLoops`        → `wall_loops` (rounded, ≥ 1).
 *   - `printSpeedMmS`    → `outer_wall_speed`, `inner_wall_speed`,
 *     `sparse_infill_speed`, `internal_solid_infill_speed` (one field drives
 *     all four so the panel stays a single Speed knob).
 *   - `nozzleTempC`      → `nozzle_temperature` + `nozzle_temperature_initial_layer`
 *     (filament keys; CLAMPED to the nozzle ceiling).
 *   - `bedTempC`         → `hot_plate_temp` + `hot_plate_temp_initial_layer`
 *     (filament keys; CLAMPED to the bed ceiling).
 *   - `supportEnabled`   → `enable_support` ("0" | "1"). When true, also emits
 *     `support_type` from `supportType` (defaulting to `normal`). When false,
 *     emits `enable_support: "0"` and NO `support_type` (the slicer ignores
 *     the style when support is off).
 *
 * Temperature keys are intentionally emitted as numbers/strings the
 * main-process {@link planOrcaOverrides} re-routes into the filament overlay
 * and clamps AGAIN — the input-side clamp here is the first of the two
 * guards (see the G-CODE SAFETY note above).
 */
export function buildFdmSliceOverrides(state: FdmProcessOverrides): FdmSliceOverridesPlan {
  const warnings: string[] = []
  const overrides: Record<string, string | number> = {}

  if (isPositiveFinite(state.layerHeightMm)) {
    overrides.layer_height = String(state.layerHeightMm)
  }

  if (typeof state.infillDensityPct === 'number' && Number.isFinite(state.infillDensityPct)) {
    const pct = Math.max(0, Math.min(100, Math.round(state.infillDensityPct)))
    // OrcaSlicer stores sparse_infill_density as a percent string, e.g. "15%".
    overrides.sparse_infill_density = `${pct}%`
  }

  if (isPositiveFinite(state.wallLoops)) {
    overrides.wall_loops = String(Math.max(1, Math.round(state.wallLoops)))
  }

  if (isPositiveFinite(state.printSpeedMmS)) {
    const speed = String(state.printSpeedMmS)
    overrides.outer_wall_speed = speed
    overrides.inner_wall_speed = speed
    overrides.sparse_infill_speed = speed
    overrides.internal_solid_infill_speed = speed
  }

  const nozzle = clampTemp(state.nozzleTempC, FDM_TEMP_CEILINGS.nozzleC, 'nozzle temperature', warnings)
  if (nozzle !== null) {
    overrides.nozzle_temperature = String(nozzle)
    overrides.nozzle_temperature_initial_layer = String(nozzle)
  }

  const bed = clampTemp(state.bedTempC, FDM_TEMP_CEILINGS.bedC, 'bed temperature', warnings)
  if (bed !== null) {
    overrides.hot_plate_temp = String(bed)
    overrides.hot_plate_temp_initial_layer = String(bed)
  }

  if (state.supportEnabled !== undefined) {
    overrides.enable_support = state.supportEnabled ? '1' : '0'
    if (state.supportEnabled) {
      const style: FdmSupportType = state.supportType ?? 'normal'
      // Orca's support_type enum: tree(auto) / normal(auto).
      overrides.support_type = style === 'tree' ? 'tree(auto)' : 'normal(auto)'
    }
  }

  return {
    overrides: Object.keys(overrides).length > 0 ? overrides : null,
    warnings
  }
}

/**
 * Serialize the process state to a compact JSON string for persistence in
 * {@link AppSettings} (`k2ProcessOverridesJson`). Drops `undefined` fields so
 * the stored object stays minimal. Returns `null` when the state is empty so
 * the caller can clear the setting rather than store `"{}"`.
 */
export function serializeFdmProcessOverrides(state: FdmProcessOverrides): string | null {
  const compact: FdmProcessOverrides = {}
  if (state.layerHeightMm !== undefined) compact.layerHeightMm = state.layerHeightMm
  if (state.infillDensityPct !== undefined) compact.infillDensityPct = state.infillDensityPct
  if (state.wallLoops !== undefined) compact.wallLoops = state.wallLoops
  if (state.printSpeedMmS !== undefined) compact.printSpeedMmS = state.printSpeedMmS
  if (state.nozzleTempC !== undefined) compact.nozzleTempC = state.nozzleTempC
  if (state.bedTempC !== undefined) compact.bedTempC = state.bedTempC
  if (state.supportEnabled !== undefined) compact.supportEnabled = state.supportEnabled
  if (state.supportType !== undefined) compact.supportType = state.supportType
  if (Object.keys(compact).length === 0) return null
  return JSON.stringify(compact)
}

/**
 * Parse a persisted process-override JSON string back into the editable
 * state, tolerating malformed / partial input (every unknown or wrong-typed
 * field is dropped). Never throws — returns {@link EMPTY_FDM_PROCESS_OVERRIDES}
 * for `null` / blank / unparseable input so a corrupt settings value can
 * never crash the Process panel.
 */
export function parseFdmProcessOverrides(raw: string | null | undefined): FdmProcessOverrides {
  if (typeof raw !== 'string' || raw.trim().length === 0) return { ...EMPTY_FDM_PROCESS_OVERRIDES }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ...EMPTY_FDM_PROCESS_OVERRIDES }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ...EMPTY_FDM_PROCESS_OVERRIDES }
  }
  const obj = parsed as Record<string, unknown>
  const out: FdmProcessOverrides = {}
  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? v : undefined
  if (num(obj.layerHeightMm) !== undefined) out.layerHeightMm = obj.layerHeightMm as number
  if (num(obj.infillDensityPct) !== undefined) out.infillDensityPct = obj.infillDensityPct as number
  if (num(obj.wallLoops) !== undefined) out.wallLoops = obj.wallLoops as number
  if (num(obj.printSpeedMmS) !== undefined) out.printSpeedMmS = obj.printSpeedMmS as number
  if (num(obj.nozzleTempC) !== undefined) out.nozzleTempC = obj.nozzleTempC as number
  if (num(obj.bedTempC) !== undefined) out.bedTempC = obj.bedTempC as number
  if (typeof obj.supportEnabled === 'boolean') out.supportEnabled = obj.supportEnabled
  if (obj.supportType === 'normal' || obj.supportType === 'tree') out.supportType = obj.supportType
  return out
}
