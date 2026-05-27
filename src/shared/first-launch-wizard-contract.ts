/**
 * First-launch project wizard — wire contract shared between the
 * renderer (`FirstLaunchWizard.tsx`) and the main process
 * (`ipc-core.ts` handlers `samples:list` and `wizard:copySample`).
 *
 * The wizard replaces the legacy informational `OnboardingOverlay` with a
 * 3-step flow that creates a real project on Finish:
 *   1. Welcome     — name + parent folder + recent-projects MRU
 *   2. Pick machine — exactly the three target machines (CLAUDE.md
 *                     My-Shop-Only mode); the Carvera card carries a
 *                     3-axis / 4-axis sub-toggle since the registry has
 *                     two profile IDs for it (matches `EnvironmentSplash`)
 *   3. Starter content — empty / sample STL / import existing
 *
 * The contract here is intentionally tiny and additive — the wizard
 * still funnels through the existing `project:create` IPC (no new
 * project schema). Only the *sample bundle* and *availability check*
 * needs a new IPC because the renderer can't touch `resources/samples/`
 * directly from the sandbox.
 */

/** Machine IDs that the wizard offers as starter cards. */
export type WizardStarterMachineId =
  | 'creality-k2-plus'
  | 'laguna-swift-5x10'
  | 'makera-carvera-3axis'
  | 'makera-carvera-4axis'

/** Sample STL filename convention under `resources/samples/<machineId>/`. */
export const WIZARD_MACHINE_TO_SAMPLE_FILE: Readonly<
  Record<WizardStarterMachineId, string>
> = {
  'creality-k2-plus': 'calibration-cube.stl',
  'laguna-swift-5x10': 'sign-board.stl',
  'makera-carvera-3axis': 'small-part.stl',
  'makera-carvera-4axis': 'rotary-part.stl'
}

/** Result of `samples:list` — which machines currently have a bundled sample. */
export interface WizardSamplesAvailability {
  readonly availableMachineIds: readonly WizardStarterMachineId[]
}

/** Payload for `wizard:copySample` — copy bundled sample to project assets. */
export interface WizardCopySampleRequest {
  /** Absolute path to the freshly-created project directory. */
  readonly projectDir: string
  /** Machine ID whose sample bundle should be copied. */
  readonly machineId: WizardStarterMachineId
}

/** Result of `wizard:copySample`. */
export type WizardCopySampleResult =
  | { ok: true; /** Path relative to project dir, POSIX-style. */ assetRelativePath: string }
  | { ok: false; error: string }

/** Returns true when the given machine id is one of the four wizard cards. */
export function isWizardStarterMachineId(
  value: unknown
): value is WizardStarterMachineId {
  return (
    value === 'creality-k2-plus' ||
    value === 'laguna-swift-5x10' ||
    value === 'makera-carvera-3axis' ||
    value === 'makera-carvera-4axis'
  )
}
