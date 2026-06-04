/**
 * run-slice-for-op — thin, typed wrapper around the `slice:orca` IPC bridge.
 *
 * WHY THIS EXISTS
 * ----------------
 * `ManufactureWorkspace.runFdmSliceFromOp` (src/renderer/manufacture/
 * ManufactureWorkspace.tsx:887) wires the FDM Send/Device stage straight to
 * `window.fab.sliceOrca(...)`. The new WorkTrack3D shell's `ManufactureHost`
 * (onRunSlice, task #9) needs the same call from outside the workspace
 * component — but without re-implementing the success/failure plumbing or
 * leaking the slicer's wire envelope (`outputGcodePath` / `stdout` / `stderr`)
 * into UI code. This helper is the single, reusable seam for "slice one FDM op
 * and tell me, in plain terms, whether it worked and where the G-code landed".
 *
 * CONTRACT
 * --------
 *   - Reuses `window.fab.sliceOrca` ONLY. No new slicing logic, no new IPC,
 *     no profile resolution — the main-process `slice:orca` handler still
 *     resolves machine/process/filament profile JSON from
 *     `resources/orca-slicer/profiles/{machines,process,filament}/<id>.json`.
 *   - `outPath` is supplied by the caller (the workspace derives it as
 *     `${projectDir}/output/slice.gcode`); this helper does NOT invent paths.
 *   - Normalizes the slicer's discriminated-union result into the small,
 *     UI-friendly shape `{ ok, gcodePath?, error?, hint? }`. On success the
 *     slicer's `outputGcodePath` is surfaced as `gcodePath` (the value the
 *     workspace records via `setLastSliceGcodePath` for the Send-to-K2 push +
 *     per-layer breakdown). `stdout`/`stderr` are intentionally dropped — call
 *     `window.fab.sliceOrca` directly if you need the raw streams.
 *   - Never throws for a slice failure: a failed slice returns
 *     `{ ok: false, error, hint? }`. Only a thrown IPC/transport error
 *     (bridge missing, channel rejected) is caught and folded into the same
 *     envelope so callers have exactly one code path to handle.
 *
 * `window.fab` is globally typed as `Api` via src/renderer/src/vite-env.d.ts
 * (`interface Window { fab: Api }`), so this file needs no import and no `any`.
 */

/**
 * Arguments accepted by {@link runSliceForOp}.
 *
 * Mirrors the subset of the `slice:orca` payload that the FDM-op slice path
 * actually uses (`overrides` is deliberately omitted — there is no op-level or
 * per-job override today; quality/filament come from app-global AppSettings).
 */
export interface RunSliceForOpArgs {
  /** Absolute path to the source STL on disk (e.g. `${projectDir}/${op.sourceMesh}`). */
  stlPath: string
  /** Target FDM machine profile id (e.g. `creality-k2-plus`). Must be an FDM machine. */
  machineId: string
  /** Absolute destination for the sliced G-code (e.g. `${projectDir}/output/slice.gcode`). */
  outPath: string
  /** OrcaSlicer process preset. Defaults to `standard` in the main handler when omitted. */
  qualityPresetId?: 'standard' | 'high_speed'
  /** Filament profile id. Defaults to `pla-generic` in the main handler when omitted. */
  filamentId?: string
}

/**
 * Normalized result of {@link runSliceForOp}.
 *
 *   - `ok: true`  → `gcodePath` is the absolute path to the written G-code.
 *   - `ok: false` → `error` is a machine-readable code; `hint` (when present)
 *     is the operator-facing detail (e.g. trimmed OrcaSlicer stderr).
 */
export interface RunSliceForOpResult {
  ok: boolean
  gcodePath?: string
  error?: string
  hint?: string
}

/**
 * Slice a single FDM operation's STL to G-code via the bundled OrcaSlicer CLI.
 *
 * @example
 * const r = await runSliceForOp({
 *   stlPath: `${projectDir}/${op.sourceMesh}`,
 *   outPath: `${projectDir}/output/slice.gcode`,
 *   machineId: activeMachineId,
 *   qualityPresetId: settings?.k2QualityPresetId,
 *   filamentId: settings?.activeFilamentId,
 * })
 * if (r.ok) setLastSliceGcodePath(r.gcodePath!)
 * else onStatus?.(`Slice failed (${r.error})${r.hint ? `: ${r.hint}` : ''}`)
 */
export async function runSliceForOp(args: RunSliceForOpArgs): Promise<RunSliceForOpResult> {
  try {
    const res = await window.fab.sliceOrca({
      stlPath: args.stlPath,
      outPath: args.outPath,
      machineId: args.machineId,
      ...(args.qualityPresetId !== undefined ? { qualityPresetId: args.qualityPresetId } : {}),
      ...(args.filamentId !== undefined ? { filamentId: args.filamentId } : {})
    })

    if (res.ok) {
      // The slicer's `outputGcodePath` echoes the `outPath` we passed in; it is
      // the canonical on-disk location callers thread to Send-to-K2 / layer
      // breakdown.
      return { ok: true, gcodePath: res.outputGcodePath }
    }

    // Failed slice — fold the wire envelope into the normalized shape. `hint`
    // is optional on the wire, so only include the key when it is present.
    return {
      ok: false,
      error: res.error,
      ...(res.hint !== undefined ? { hint: res.hint } : {})
    }
  } catch (e) {
    // Thrown IPC/transport failure (bridge unavailable, channel rejected).
    // Never let it escape — callers handle exactly one envelope shape.
    const message = e instanceof Error ? e.message : String(e)
    return { ok: false, error: 'slice_ipc_error', hint: message }
  }
}
