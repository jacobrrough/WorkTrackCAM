/**
 * gcode-send-gate.ts — Wave 3m: the LIVE send/export wiring for the runtime
 * export-safety gate (`assessGcodeForExportSafety`).
 *
 * Why this module exists
 * ----------------------
 * Wave 3l hardened `src/renderer/src/gcode-export-safety.ts` with the machine
 * work-area HARD gate (optional `workAreaMm` → provable X/Y over-travel
 * becomes a BLOCKING error), but the helper's 3 production call sites died
 * with `ShopApp.tsx` in the P5 cutover — the new shell shipped ZERO
 * export-time G-code safety messaging. This module is the single seam every
 * live send/export surface now routes through, so the gate runs on the EXACT
 * posted program leaving the app with `{ dialect, safeRetractZMm, workAreaMm }`
 * threaded from the ACTIVE machine profile.
 *
 * Live surfaces (Wave 3m wiring):
 *   1. `ManufactureAuxPanels.tsx` `SliceManufacturePanel.sendToK2Plus`
 *      (K2 Plus Moonraker push of the last sliced file) → `runK2PushSurface`
 *      — ADVISORY-ONLY, never blocks (see the FDM caveat below).
 *   2. `ManufactureAuxPanels.tsx` `CamManufacturePanel.uploadToCarvera`
 *      (carvera-cli upload of `output/cam.nc`) → `runCarveraUploadSurface`
 *      — HARD gate against the Carvera profile dims (360 × 240 mm 3-axis,
 *      240 × 92 mm 4-axis).
 *   3. `ManufactureWorkspace.tsx` `sendSlicedProgramToK2` (ProfileStack
 *      "Send to K2 Plus" in the FDM Device stage) → `runK2PushSurface`.
 *   4. `ManufactureWorkspace.tsx` `sendPostedProgramToCarvera` (ProfileStack
 *      "Send to Carvera" in the CNC Send stage) → `runCarveraUploadSurface`.
 *   5. `ManufactureWorkspace.tsx` `exportPostedProgramForLaguna` (ProfileStack
 *      "Export for Laguna" in the CNC Send stage — native save dialog +
 *      file drop for USB transfer to the RichAuto pendant) →
 *      `runLagunaExportSurface` with the Laguna dims (1524 × 3048 mm).
 *   6. `ManufactureWorkspace.tsx` `exportManufactureSetupSheet` — the HTML
 *      setup sheet embeds the posted program text for operator reference.
 *      The sheet is a DOCUMENT (never machine-executed), so gate failures
 *      surface via `formatSetupSheetGateNotice` as non-blocking status
 *      warnings only — the operator learns the program is unshippable
 *      BEFORE walking the sheet to the machine.
 *
 * Deliberately EXCLUDED surfaces (traced, not forgotten):
 *   - `CalibrationPanel.tsx` K2 calibration sends — those programs are
 *     app-GENERATED (k2-plus-tests.ts), not post-processed CAM output; they
 *     carry their own generator-level invariant tests, and the main-process
 *     temperature validator inside `moonraker-push.ts` (the K2's real hard
 *     gate) still guards every byte they upload. Running the CNC-shaped
 *     advisory set on them would only add noise.
 *   - `CarveraSetupPanel.tsx` zeroing/probe uploads — generated machine-setup
 *     utility macros, not posted programs; the posted-program invariants
 *     (M5 / M2-M30 / full-program shape) intentionally do not apply.
 *   - `WorkshopDashboard` quick actions — advisory toasts only; no G-code
 *     dispatch happens there (see WorkshopHost.tsx).
 *
 * CNC = HARD GATE (fail-closed)
 * -----------------------------
 * For Laguna Swift 5x10 and Makera Carvera sends/exports the gate is
 * BLOCKING: any `blockingErrors` (dialect parser errors, missing M5,
 * missing M2/M30, or a provable X/Y work-area overshoot) ABORTS the
 * dispatch and the honest message reaches the operator via `onStatus`.
 * A program we cannot even read off disk is also never dispatched
 * (`read_failed`) — G-code is sacred; unverifiable programs do not ship.
 *
 * FDM (K2 Plus) = ADVISORY-ONLY (never blocks) — the Wave 3m caveat
 * ------------------------------------------------------------------
 * The Moonraker push pre-flight calls the gate WITHOUT `workAreaMm`, and
 * nothing it returns can abort the push. Two documented reasons:
 *   1. OrcaSlicer output mixes G91 (relative) bursts — retraction/wipe
 *      sequences and the end-print park — and the gate's shared segment
 *      parser (`extractToolpathSegmentsFromGcode`) is ABSOLUTE-ONLY. Parsed
 *      X/Y extents on FDM files are therefore not trustworthy enough to
 *      hard-block on; passing the K2's 350 × 350 mm dims could false-block
 *      a perfectly legitimate print. No `workAreaMm` ⇒ the envelope gate
 *      cannot fire (pinned as legacy-identical behavior by section (N) of
 *      `gcode-export-safety-pin.test.ts`).
 *   2. The gate's `blockingErrors` (missing M5 / M2 / M30) are CNC spindle
 *      invariants that fire on EVERY legitimate slicer output — the (J)
 *      section of the pin test documents exactly this. Enforcing them here
 *      would brick the K2 daily workflow; surfacing them as warnings would
 *      train the operator to ignore the warning channel. Only the gate's
 *      advisory `warnings` flow out of `runFdmPushPreflight`.
 * The K2's REAL hard gate is unchanged: the pre-upload temperature
 * validator inside `src/main/moonraker-push.ts` (`validateGcodeFileTemps`)
 * still rejects heater targets above the machine ceilings with zero bytes
 * on the wire. Wave 3m does not touch it.
 *
 * Safety Rule 1 (G-code is sacred): this module never mutates program
 * bytes and never emits G-code — it only reads, assesses, and either
 * dispatches the caller's action verbatim or aborts it. The Laguna export
 * writes the EXACT text the gate verified (`writeTextFile(dest, programText)`),
 * so the gated bytes and the exported bytes cannot diverge.
 */
import type { MachineProfile } from '../../shared/machine-schema'
import { assessGcodeForExportSafety } from '../src/gcode-export-safety'
import { resolveSafeZClearanceMm } from '../../shared/gcode-safe-z-retract-invariants'
import {
  buildMoonrakerPushPayload,
  formatMoonrakerPushFailure,
  type MoonrakerPushPayload,
  type MoonrakerPushResult
} from '../src/moonraker-push-payload'

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * The minimal machine-profile slice the gate needs. Matches the bundled
 * profiles in `resources/machines/*.json` (My-Shop-Only: Creality K2 Plus,
 * Laguna Swift 5x10, Makera Carvera 3-axis + 4-axis).
 */
export type GateMachine = Pick<MachineProfile, 'dialect' | 'workAreaMm' | 'safeRetractZMm'>

/** Pure CNC gate verdict for one posted program against one machine. */
export type CncSendGateResult = {
  /** `true` ⇔ zero blocking errors — the program may be dispatched. */
  readonly allowed: boolean
  readonly blockingErrors: readonly string[]
  readonly warnings: readonly string[]
}

/** Advisory-only FDM pre-flight result — by construction it cannot block. */
export type FdmPushAdvisories = {
  readonly warnings: readonly string[]
}

/** Async file reader injected by callers (production: `window.fab.readTextFile`). */
export type GateIo = {
  readonly readTextFile: (filePath: string) => Promise<string>
}

/** Outcome of a gated CNC send/export attempt. */
export type GatedCncSendOutcome = 'dispatched' | 'blocked' | 'read_failed'

// ─── Profile threading ───────────────────────────────────────────────────────

/**
 * Thread the safe-retract advisory threshold from the machine profile using
 * the SAME preference order as the posted-program safe-Z validator
 * (`resolveSafeZClearanceMm`): explicit `safeRetractZMm` (Laguna ships 25),
 * else the full `workAreaMm.z` envelope (Carvera 140 / K2 350 — what every
 * bundled post emits as `G0 Z{{machine.workAreaMm.z}}`). The `0` fallback is
 * unreachable for the three bundled profiles; it exists so a malformed
 * profile degrades to a harmless `G0 Z0` advisory rather than a throw.
 */
export function gateSafeRetractZMm(machine: GateMachine): number {
  return resolveSafeZClearanceMm(machine) ?? 0
}

// ─── Pure assessments ────────────────────────────────────────────────────────

/**
 * CNC posted-program gate: full `assessGcodeForExportSafety` with the
 * machine's dialect, safe-retract threshold AND `workAreaMm` — so a
 * provable X/Y over-travel (e.g. a 1600 mm cut on the Laguna's 1524 mm X
 * axis, or X400 on the Carvera's 360 mm bed) is a BLOCKING error.
 */
export function gateCncProgramForSend(input: {
  readonly gcode: string
  readonly machine: GateMachine
}): CncSendGateResult {
  const assessment = assessGcodeForExportSafety({
    gcode: input.gcode,
    dialect: input.machine.dialect,
    safeRetractZMm: gateSafeRetractZMm(input.machine),
    workAreaMm: input.machine.workAreaMm
  })
  return {
    allowed: assessment.blockingErrors.length === 0,
    blockingErrors: assessment.blockingErrors,
    warnings: assessment.warnings
  }
}

/**
 * FDM (K2 Plus) push pre-flight: the gate runs WITHOUT `workAreaMm` — see
 * the module-header caveat for the two documented reasons (G91-mixing
 * OrcaSlicer output vs. the absolute-only segment parser; CNC-only M5/M30
 * blockers on every legitimate print). Only the advisory `warnings` are
 * returned; the result has no blocking channel AT ALL, so no caller can
 * accidentally turn this surface into a hard gate.
 */
export function adviseFdmProgramForPush(input: {
  readonly gcode: string
  readonly machine: GateMachine
}): FdmPushAdvisories {
  const assessment = assessGcodeForExportSafety({
    gcode: input.gcode,
    dialect: input.machine.dialect,
    safeRetractZMm: gateSafeRetractZMm(input.machine)
    // workAreaMm DELIBERATELY omitted — envelope blocking must be
    // impossible on the FDM path (pin (N4): absent dims ⇒ legacy-identical).
  })
  return { warnings: assessment.warnings }
}

// ─── Operator-message formatting ─────────────────────────────────────────────

/**
 * One-line abort message for the blocked-send status/toast. Leads with the
 * action so the operator knows exactly which button refused, then the first
 * (most actionable) blocking error verbatim, then an honest count of the rest.
 */
export function formatBlockedSendStatus(
  actionLabel: string,
  blockingErrors: readonly string[]
): string {
  const first = blockingErrors[0] ?? 'unknown safety violation'
  const more = blockingErrors.length > 1 ? ` (+${blockingErrors.length - 1} more)` : ''
  return `${actionLabel} blocked — posted G-code failed the export safety check: ${first}${more}`
}

/**
 * Single compact advisory line (or `null` when there is nothing to say) so
 * a send with N advisories produces ONE status line, not N toast pops.
 */
export function formatSendAdvisoriesStatus(warnings: readonly string[]): string | null {
  if (warnings.length === 0) return null
  return `Pre-flight advisories (non-blocking): ${warnings.join(' | ')}`
}

/**
 * Non-blocking notice for the SETUP-SHEET surface. The sheet is a printed
 * document, never machine-executed, so a failing gate must NOT abort the
 * export — but the operator deserves to know the program embedded in the
 * sheet would be refused at the send surfaces. Returns `null` when the
 * program is clean (no extra status noise on the happy path).
 */
export function formatSetupSheetGateNotice(gate: CncSendGateResult): string | null {
  if (!gate.allowed) {
    const first = gate.blockingErrors[0] ?? 'unknown safety violation'
    const more = gate.blockingErrors.length > 1 ? ` (+${gate.blockingErrors.length - 1} more)` : ''
    return `Setup sheet saved, but its embedded program FAILS the export safety gate: ${first}${more} — fix and re-post before sending this job to the machine.`
  }
  if (gate.warnings.length > 0) {
    return `Setup sheet program advisories (non-blocking): ${gate.warnings.join(' | ')}`
  }
  return null
}

// ─── Orchestrated flows (the seam the surfaces call) ─────────────────────────

/**
 * Gated CNC send/export flow — read the EXACT posted file, gate it, then
 * (only when allowed) run the caller's dispatch with the verified text.
 *
 *   read fails  → abort, honest message, `'read_failed'` (fail-closed:
 *                 a program we cannot verify never ships to a CNC machine).
 *   gate blocks → abort, `formatBlockedSendStatus` line + up to 3 further
 *                 blocking errors as their own status lines, `'blocked'`.
 *                 `dispatch` is NEVER invoked on this path.
 *   gate allows → one compact advisory line when warnings exist, then
 *                 `await dispatch(programText)`, `'dispatched'`.
 *
 * Dispatch errors intentionally propagate to the caller (each surface owns
 * its own busy-flag + error toast around the underlying IPC).
 */
export async function runGatedCncSendFlow(input: {
  readonly gcodePath: string
  readonly machine: GateMachine
  /** Operator-facing action name, e.g. "Send to Carvera" / "Export for Laguna". */
  readonly actionLabel: string
  readonly io: GateIo
  readonly onStatus: (msg: string) => void
  /** The actual upload/export action — receives the verified program text. */
  readonly dispatch: (programText: string) => Promise<void>
}): Promise<GatedCncSendOutcome> {
  let programText: string
  try {
    programText = await input.io.readTextFile(input.gcodePath)
  } catch (e) {
    input.onStatus(
      `${input.actionLabel} aborted — could not read ${input.gcodePath} to verify the posted program: ${
        e instanceof Error ? e.message : String(e)
      }`
    )
    return 'read_failed'
  }
  const gate = gateCncProgramForSend({ gcode: programText, machine: input.machine })
  if (!gate.allowed) {
    input.onStatus(formatBlockedSendStatus(input.actionLabel, gate.blockingErrors))
    for (const err of gate.blockingErrors.slice(1, 4)) {
      input.onStatus(err)
    }
    return 'blocked'
  }
  const advisoryLine = formatSendAdvisoriesStatus(gate.warnings)
  if (advisoryLine !== null) input.onStatus(advisoryLine)
  await input.dispatch(programText)
  return 'dispatched'
}

/**
 * FDM (K2 Plus) Moonraker push pre-flight — ADVISORY-ONLY by construction.
 *
 * Resolves ALWAYS (never throws, never blocks): a read failure is swallowed
 * because the renderer pre-flight is best-effort — the main-process push
 * handler reads the real file itself and its temperature validator (the
 * K2's actual hard gate, untouched by Wave 3m) still rejects unsafe heater
 * targets with zero bytes on the wire. At most ONE compact status line is
 * emitted (the joined advisory warnings).
 */
export async function runFdmPushPreflight(input: {
  readonly gcodePath: string
  readonly machine: GateMachine
  readonly io: GateIo
  readonly onStatus: (msg: string) => void
}): Promise<void> {
  let programText: string
  try {
    programText = await input.io.readTextFile(input.gcodePath)
  } catch {
    // Advisory-only surface: never block (or noise) the push on a renderer
    // read hiccup — moonraker-push.ts owns the authoritative file read.
    return
  }
  try {
    const advisories = adviseFdmProgramForPush({ gcode: programText, machine: input.machine })
    const advisoryLine = formatSendAdvisoriesStatus(advisories.warnings)
    if (advisoryLine !== null) input.onStatus(advisoryLine)
  } catch {
    // Defensive: an assessment throw must never abort an FDM push.
  }
}

// ─── Per-surface actions (the exact functions the buttons run) ───────────────
//
// Each live surface is a thin component closure around ONE of the exported
// actions below, with `window.fab.*` injected as the IPC boundary. Extracted
// to module level (same convention as `computeNextLagunaActiveZones`) so the
// behavioral tests can run the REAL button logic against a mocked IPC
// boundary — node-env vitest cannot click hook-bearing components.

/**
 * The renderer-allowed subset of `CarveraUploadPayload`
 * (src/main/carvera-cli-run.ts) these surfaces send. Structurally assignable
 * to the preload's `carveraUpload` parameter, so production wires
 * `(p) => window.fab.carveraUpload(p)` with zero casts.
 */
export type CarveraUploadRequest = {
  readonly gcodePath: string
  readonly connection: 'auto' | 'wifi' | 'usb'
  readonly device?: string
  readonly timeoutMs?: number
}

/**
 * Narrow structural view of `CarveraUploadResult` — the discriminated union
 * the status formatter needs. The real result's extra fields (stdout/stderr)
 * are ignored.
 */
export type CarveraUploadOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string; readonly detail?: string }

/**
 * SURFACE ACTION — "Send to Carvera" / "Upload to Carvera" (HARD gate).
 *
 * Reads the EXACT `output/cam.nc` bytes carvera-cli will ship (NOT any
 * preview prop, which can lag the file on disk), gates them against the
 * Carvera dims, and only then runs the upload IPC. Blocking errors ABORT
 * the upload (zero upload IPC) with the honest operator message.
 *
 * `gateMachine === undefined` (no Carvera profile installed at all)
 * degrades to the legacy ungated dispatch — mirrors the gate's
 * optional-dims never-false-block contract — and is reported as
 * `'dispatched_ungated'` so tests can tell the two dispatch paths apart.
 */
export async function runCarveraUploadSurface(input: {
  readonly gcodePath: string
  readonly gateMachine: GateMachine | undefined
  readonly connection: 'auto' | 'wifi' | 'usb'
  readonly device: string | undefined
  readonly timeoutMs: number
  readonly io: GateIo
  /** IPC boundary (production: `window.fab.carveraUpload`). */
  readonly carveraUpload: (payload: CarveraUploadRequest) => Promise<CarveraUploadOutcome>
  readonly onStatus: (msg: string) => void
}): Promise<GatedCncSendOutcome | 'dispatched_ungated'> {
  const dispatchUpload = async (): Promise<void> => {
    const r = await input.carveraUpload({
      gcodePath: input.gcodePath,
      connection: input.connection,
      device: input.device,
      timeoutMs: input.timeoutMs
    })
    if (r.ok) {
      input.onStatus('Carvera: file uploaded (start the job on the machine if needed).')
    } else {
      input.onStatus(`Carvera upload failed: ${r.error}${r.detail ? ` — ${r.detail}` : ''}`)
    }
  }
  if (!input.gateMachine) {
    await dispatchUpload()
    return 'dispatched_ungated'
  }
  return runGatedCncSendFlow({
    gcodePath: input.gcodePath,
    machine: input.gateMachine,
    actionLabel: 'Send to Carvera',
    io: input.io,
    onStatus: input.onStatus,
    dispatch: () => dispatchUpload()
  })
}

/** Outcome of a gated Laguna file export attempt. */
export type LagunaExportOutcome = 'exported' | 'cancelled' | 'blocked' | 'read_failed'

/**
 * SURFACE ACTION — "Export for Laguna" (HARD gate). The Laguna Swift 5x10
 * has no in-app send: the RichAuto A-series pendant takes the file via USB
 * stick. This surface reads + gates `output/cam.nc` against the Laguna dims
 * (1524 × 3048 mm), and only when the gate passes opens the native save
 * dialog and writes the VERIFIED program text to the chosen destination.
 *
 * Order matters: gate BEFORE the dialog, so the operator is never asked
 * where to save a program that can never run. The exported bytes are the
 * exact `programText` the gate assessed — not a separate file copy — so the
 * gated bytes and the shipped bytes cannot diverge (Safety Rule 1).
 */
export async function runLagunaExportSurface(input: {
  readonly gcodePath: string
  readonly gateMachine: GateMachine
  /** Suggested destination path for the save dialog (e.g. `<project>/output/<name>.nc`). */
  readonly suggestedPath: string
  readonly io: GateIo
  /** IPC boundary (production: `window.fab.dialogSaveFile`). `null` = operator cancelled. */
  readonly pickSavePath: (suggestedPath: string) => Promise<string | null>
  /** IPC boundary (production: `window.fab.fsWriteText`). */
  readonly writeTextFile: (filePath: string, content: string) => Promise<void>
  readonly onStatus: (msg: string) => void
}): Promise<LagunaExportOutcome> {
  let outcome: 'exported' | 'cancelled' = 'cancelled'
  const flow = await runGatedCncSendFlow({
    gcodePath: input.gcodePath,
    machine: input.gateMachine,
    actionLabel: 'Export for Laguna',
    io: input.io,
    onStatus: input.onStatus,
    dispatch: async (programText) => {
      const dest = await input.pickSavePath(input.suggestedPath)
      if (dest === null || dest.trim().length === 0) {
        input.onStatus('Export for Laguna cancelled — no file written.')
        return
      }
      await input.writeTextFile(dest, programText)
      input.onStatus(
        `Exported for Laguna: ${dest} — transfer to the RichAuto pendant via USB and verify WCS + tooling before running.`
      )
      outcome = 'exported'
    }
  })
  return flow === 'dispatched' ? outcome : flow
}

/** Machine slice the K2 push surface needs (`id` rides on the Moonraker payload). */
export type K2PushMachine = GateMachine & Pick<MachineProfile, 'id'>

/**
 * Narrow structural view of the `moonraker:push` IPC result. The preload's
 * full success shape carries extra fields (`uploadedPath`, `printStarted`,
 * `warnings?: readonly string[]`, ...) that this surface ignores; declaring
 * only what the status formatter consumes keeps the preload's readonly
 * arrays assignable AND keeps test fixtures small. Assignable to
 * `MoonrakerPushResult` for `formatMoonrakerPushFailure`.
 */
export type K2PushIpcResult = Pick<MoonrakerPushResult, 'tempValidation'> & {
  readonly ok: boolean
  readonly filename?: string
  readonly error?: string
  readonly detail?: string
}

/** Outcome of a K2 Moonraker push attempt (the pre-flight can never block it). */
export type K2PushOutcome = 'sent' | 'send_failed'

/**
 * SURFACE ACTION — "Send to K2 Plus" (ADVISORY-ONLY pre-flight, never blocks).
 *
 * Runs `runFdmPushPreflight` on the exact on-disk slice (at most ONE compact
 * advisory status line; nothing it finds can abort), then builds the
 * Moonraker payload via the existing `buildMoonrakerPushPayload` contract
 * (machineId threading keeps the main-process temperature validator armed —
 * the K2's REAL hard gate, untouched by Wave 3m) and runs the push IPC.
 * Status strings are byte-identical to the pre-Wave-3m send button.
 */
export async function runK2PushSurface(input: {
  readonly gcodePath: string
  readonly machine: K2PushMachine | undefined
  readonly moonrakerUrl: string
  readonly cfsSlotId: number
  readonly io: GateIo
  /** IPC boundary (production: `window.fab.moonrakerPush`). */
  readonly moonrakerPush: (payload: MoonrakerPushPayload) => Promise<K2PushIpcResult>
  readonly onStatus: (msg: string) => void
}): Promise<K2PushOutcome> {
  // Wave 3m — export-safety pre-flight on the EXACT on-disk program this
  // push uploads. ADVISORY-ONLY on the FDM path (never blocks; at most one
  // compact status line) — see the module-header caveat for the
  // OrcaSlicer-G91 / absolute-only-parser rationale.
  if (input.machine) {
    await runFdmPushPreflight({
      gcodePath: input.gcodePath,
      machine: input.machine,
      io: input.io,
      onStatus: input.onStatus
    })
  }
  const payload = buildMoonrakerPushPayload(
    {
      gcodeOut: input.gcodePath,
      printerUrl: input.moonrakerUrl,
      machineId: input.machine?.id ?? null,
      cfsSlotId: input.cfsSlotId
    },
    { startAfterUpload: true }
  )
  const r = await input.moonrakerPush(payload)
  if (r.ok) {
    input.onStatus(`Started on K2 Plus: ${r.filename ?? input.gcodePath}`)
    return 'sent'
  }
  input.onStatus(formatMoonrakerPushFailure(r))
  return 'send_failed'
}
