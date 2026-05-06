/**
 * Post-process ATC capability helper -- roadmap [ID-0093].
 *
 * Derives whether a `MachineProfile` supports the automatic tool changer
 * (ATC) M6 macro that a follow-on post-processing cycle will plumb into
 * the Carvera 4-axis Handlebars template behind a job flag. This module
 * is the FIRST half of [ID-0093] -- the *flag* + *test fixtures* land
 * here; the M-code emission lands in a follow-up cycle once profile
 * coverage is complete (Safety Rule 1: G-code is sacred -- ship the
 * read-side schema/helper plumbing under tests before the write side
 * touches a single template).
 *
 * Pure: no I/O, no logging, no clock; the same input produces the same
 * output. Lives under `src/shared/` because every transitive consumer
 * (post-process renderer, sequencing helper, renderer surface that may
 * eventually drive a UI hint) must agree on the same answer.
 *
 * Decision rules per CLAUDE.md USER CONTEXT:
 *   - Creality K2 Plus (FDM):              never supports ATC.
 *   - Laguna Swift 5x10 (CNC, manual ER-20): never supports ATC.
 *   - Makera Carvera 3-axis (CNC, T1-T6 + T0 probe): supports ATC.
 *   - Makera Carvera 4-axis (CNC, rotary occupies ATC bay): does NOT
 *     support ATC. The bundled `makera-carvera-4axis.json` profile
 *     intentionally omits `atcSlotCount` so this helper returns false
 *     for it without any extra special-case branch.
 *
 * The return type is a discriminated structure so callers can pattern-
 * match on `.supported` and only access `.slotCount` / `.probeSlot` on
 * the supported branch (Safety Rule 3: zero `any`).
 */
import type { MachineProfile } from './machine-schema'

/**
 * Result of deriving ATC capability from a `MachineProfile`.
 *
 * - `supported: false` -- the machine has no ATC; the post-processor
 *   MUST NOT emit M6 macros and any caller-side multi-tool sequencer
 *   must run with `supportsToolChange: false` (operator-initiated tool
 *   changes only).
 * - `supported: true` -- ATC is available. `slotCount` is the number of
 *   *cutting* tool slots (T1..TslotCount); `probeSlot` is the optional
 *   ATC slot reserved for the wireless tool-length probe (Carvera: 0
 *   = T0). When `probeSlot` is undefined, callers should not emit a
 *   probe-driven tool-length compensation step.
 */
export type AtcCapability =
  | {
      readonly supported: false
      readonly reason: 'fdm' | 'no-atc-slots'
    }
  | {
      readonly supported: true
      readonly slotCount: number
      readonly probeSlot?: number
    }

/**
 * Derive ATC capability from a machine profile.
 *
 * Returns `{ supported: false, reason: 'fdm' }` for FDM machines, and
 * `{ supported: false, reason: 'no-atc-slots' }` for CNC machines that
 * leave `atcSlotCount` unset. A non-undefined `atcSlotCount` is required
 * to be a positive integer by `machineProfileSchema`, so when this
 * helper sees a CNC machine with `atcSlotCount` defined, it can safely
 * trust the value without re-validating it.
 *
 * The helper does NOT consult `axisCount` because the bundled Carvera
 * 4-axis profile already encodes "no ATC in 4-axis mode" by omitting
 * `atcSlotCount` -- adding an axisCount-driven branch here would be
 * speculative and would make the helper behave differently from the
 * profile JSON in ways that are hard to audit. Profile JSON is the
 * single source of truth.
 */
export function deriveAtcCapability(
  machine: Pick<MachineProfile, 'kind' | 'atcSlotCount' | 'atcProbeSlot'>
): AtcCapability {
  if (machine.kind === 'fdm') {
    return { supported: false, reason: 'fdm' }
  }
  const slotCount = machine.atcSlotCount
  if (slotCount === undefined || slotCount <= 0) {
    return { supported: false, reason: 'no-atc-slots' }
  }
  if (machine.atcProbeSlot !== undefined) {
    return {
      supported: true,
      slotCount,
      probeSlot: machine.atcProbeSlot
    }
  }
  return { supported: true, slotCount }
}

/**
 * Convenience predicate for callers that only care about the boolean.
 * Equivalent to `deriveAtcCapability(machine).supported` but keeps the
 * call site readable when no slot-count details are needed.
 */
export function machineSupportsAtc(
  machine: Pick<MachineProfile, 'kind' | 'atcSlotCount' | 'atcProbeSlot'>
): boolean {
  return deriveAtcCapability(machine).supported
}
