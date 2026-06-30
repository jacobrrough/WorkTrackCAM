/**
 * FirstRunOnboarding — the WorkTrack3D new-shell first-run picker.
 *
 * The legacy `FirstLaunchWizard` + `OnboardingOverlay` were deleted in the P5
 * cutover, leaving the wizard BACKEND (the `samples:list` / `wizard:copySample`
 * / `wizard:readCadSample` IPC, the preload bridge, and the
 * `appSettings.hasCompletedOnboarding` flag) with NO renderer that mounts it —
 * so a fresh install dropped the operator straight into an empty CAD-first
 * shell with no machine-pick walkthrough and no starter content. This component
 * restores that first-run step in the new shell.
 *
 * Per CLAUDE.md "My-Shop-Only Mode" the picker offers EXACTLY the four starter
 * choices the deleted wizard did — the three target machines plus "Start a
 * parametric design":
 *
 *   1. Creality K2 Plus     → switch the session to the FDM env.
 *   2. Laguna Swift 5×10     → switch the session to the large-format CNC env.
 *   3. Makera Carvera (4-axis HD) → switch the session to the 4-axis CNC env.
 *   4. Start a parametric design  → read the bundled CadQuery starter
 *                                  (`wizard:readCadSample`) and open the Design
 *                                  workspace.
 *
 * It is a thin, focused single-screen modal (NOT the old 3-step flow): the new
 * shell is CAD-first and never forces a project-folder dialog up front, so this
 * picker only routes the operator to the right starting surface and persists the
 * completion flag. The heavyweight "create a project + seed assets" path stays
 * available behind the File menu / command palette as before.
 *
 * It CONSUMES the wizard contract/IPC — it does NOT reimplement any backend.
 *
 * Accessibility: a focus-trapping modal MUST have an escape route (WCAG 2.1.2).
 * Both a visible "Skip for now" control AND a bare Escape key persist the flag
 * and dismiss, mirroring the `ConfirmDialog` / deleted-wizard pattern.
 *
 * SAFETY (CLAUDE.md Rule 1): this picker NEVER touches G-code, post-processor
 * templates, or machine-profile JSON. It selects a machine in-session, reads a
 * bundled CAD sample, and writes one settings flag — nothing more.
 */
import { useCallback, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { MachineProfile } from '../../shared/machine-schema'
import {
  WIZARD_MACHINE_TO_CAD_SAMPLE,
  type WizardReadCadSampleResult,
  type WizardStarterMachineId
} from '../../shared/first-launch-wizard-contract'
import { fab } from '../src/shop-types'

// ── Public types ────────────────────────────────────────────────────────────

/**
 * The bundled CadQuery starter the "Start a parametric design" option loaded.
 * Handed to {@link FirstRunOnboardingProps.onStartDesign} so the host can open
 * the Design workspace with the script preloaded. Mirrors the success shape of
 * the `wizard:readCadSample` contract result.
 */
export interface OnboardingDesignStarter {
  readonly machineId: WizardStarterMachineId
  readonly designName: string
  readonly fileName: string
  readonly scriptText: string
}

export interface FirstRunOnboardingProps {
  /**
   * All installed machine profiles (from the machine session). A machine card is
   * only actionable when its profile is present; the matching card is otherwise
   * shown disabled with a hint, so a half-seeded library never dead-ends.
   */
  readonly machines: readonly MachineProfile[]
  /**
   * Operator picked one of the three machines. The host switches the session /
   * CAM env to it (same path the TopBar env triad uses). The completion flag is
   * already persisted by the time this fires.
   */
  readonly onSelectMachine: (machine: MachineProfile) => void
  /**
   * Operator picked "Start a parametric design". The bundled CadQuery starter
   * has already been read; the host opens the Design workspace (optionally
   * seeding the returned script). The completion flag is already persisted.
   */
  readonly onStartDesign: (starter: OnboardingDesignStarter) => void
  /**
   * Operator dismissed the picker (Skip control or Escape). The completion flag
   * is already persisted; the host simply stops rendering the modal.
   */
  readonly onDismiss: () => void
}

// ── Option model (locked to the four starter choices) ──────────────────────

/**
 * A first-run starter option. `kind: 'machine'` cards resolve a
 * {@link MachineProfile} from the installed list via {@link resolveOnboardingMachine};
 * the single `kind: 'design'` card reads the bundled CadQuery starter for its
 * `machineId` (the K2 bracket, per `WIZARD_MACHINE_TO_CAD_SAMPLE`).
 */
export type OnboardingOption =
  | {
      readonly kind: 'machine'
      /** Wizard machine id — also the registry profile id. */
      readonly machineId: WizardStarterMachineId
      readonly title: string
      readonly subtitle: string
      readonly glyph: string
    }
  | {
      readonly kind: 'design'
      /** Which bundled CAD starter to read (the K2 L-bracket is the default). */
      readonly machineId: WizardStarterMachineId
      readonly title: string
      readonly subtitle: string
      readonly glyph: string
    }

/**
 * The four starter cards, in stable display order. The machine ids match the
 * `first-launch-wizard-contract` exactly (My-Shop-Only mode): Creality K2 Plus,
 * Laguna Swift 5×10, Makera Carvera 4-axis HD, then the parametric-design card
 * (which reads the K2 bracket starter — the simplest extrude+holes sample).
 *
 * Exported so a node-env pin can assert the option set never drifts from the
 * three target machines + the design choice.
 */
export const ONBOARDING_OPTIONS: readonly OnboardingOption[] = [
  {
    kind: 'machine',
    machineId: 'creality-k2-plus',
    title: 'Creality K2 Plus',
    subtitle: 'FDM 3D Printer · 350 × 350 × 350 mm',
    glyph: '\u{1F5A8}'
  },
  {
    kind: 'machine',
    machineId: 'laguna-swift-5x10',
    title: 'Laguna Swift 5×10',
    subtitle: 'CNC Router · 60" × 120" full sheet',
    glyph: '\u{1FAB5}'
  },
  {
    kind: 'machine',
    machineId: 'makera-carvera-4axis',
    title: 'Makera Carvera',
    subtitle: 'Desktop CNC + 4th-axis rotary · ATC',
    glyph: '✦'
  },
  {
    kind: 'design',
    machineId: 'creality-k2-plus',
    title: 'Start a parametric design',
    subtitle: 'Open the CAD editor with a starter script',
    glyph: '✎'
  }
] as const

// ── Pure helpers (node-env testable; click handlers can't fire in SSR) ──────

/**
 * Resolve a wizard machine id to its installed {@link MachineProfile}, or `null`
 * when that machine is not in the library. Pure — the component uses it at click
 * time; a unit test pins the option→profile mapping without booting React.
 */
export function resolveOnboardingMachine(
  machineId: WizardStarterMachineId,
  machines: readonly MachineProfile[]
): MachineProfile | null {
  return machines.find((m) => m.id === machineId) ?? null
}

/**
 * Pure factory for the Escape-to-dismiss keydown handler. WCAG 2.1.2 forbids a
 * focus trap with no escape route; a bare Escape (no Ctrl/Meta/Shift/Alt — so it
 * doesn't fight other accelerators) dismisses exactly like the visible Skip
 * control. Mirrors the deleted wizard's `wizardEscapeKeydownHandler` precedent
 * and `ConfirmDialog`'s document-level keydown pattern. Exported so the keyboard
 * wiring is exercised by a vitest unit without a DOM.
 */
export function onboardingEscapeKeydownHandler(
  onEscape: () => void
): (e: KeyboardEvent) => void {
  return (e) => {
    if (e.key !== 'Escape') return
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return
    onEscape()
  }
}

/**
 * Persist `hasCompletedOnboarding = true` so the picker never re-opens on the
 * next launch. Best-effort: a settings write failure must NOT trap the operator
 * in the modal, so the promise rejection is swallowed (the dismiss/route still
 * happens). Shared by every exit path (machine pick, design, skip, Escape).
 */
async function persistOnboardingComplete(): Promise<void> {
  try {
    await fab().settingsSet({ hasCompletedOnboarding: true })
  } catch {
    /* best-effort — never block the operator on a settings write */
  }
}

// ── Component ──────────────────────────────────────────────────────────────

export function FirstRunOnboarding({
  machines,
  onSelectMachine,
  onStartDesign,
  onDismiss
}: FirstRunOnboardingProps): ReactElement {
  // While a design starter is being read (the only async exit path) the cards
  // lock so a double-click can't fire two `wizard:readCadSample` reads or race
  // the dismiss. Machine picks are synchronous, so they only read this to stay
  // disabled during an in-flight design read.
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Dismiss (Skip control OR Escape): persist the flag, then hand back to the
  // host. Gated on `busy` so a mid-read Escape can't drop the operator out from
  // under an in-flight design-sample load.
  const handleDismiss = useCallback((): void => {
    if (busy) return
    void persistOnboardingComplete()
    onDismiss()
  }, [busy, onDismiss])

  // A machine card: resolve its profile, persist the flag, switch the session.
  // Resolution can only fail if the library is half-seeded (the card is disabled
  // in that case), but we guard anyway and surface an honest hint.
  const handlePickMachine = useCallback(
    (machineId: WizardStarterMachineId): void => {
      if (busy) return
      const machine = resolveOnboardingMachine(machineId, machines)
      if (!machine) {
        setError(`${machineId} isn't installed yet — add it from Settings, then reopen this picker.`)
        return
      }
      void persistOnboardingComplete()
      onSelectMachine(machine)
    },
    [busy, machines, onSelectMachine]
  )

  // The parametric-design card: read the bundled CadQuery starter for the chosen
  // machine (CONSUMING `wizard:readCadSample` — no reimplementation), persist the
  // flag, then hand the script to the host to open Design. A read failure is
  // surfaced inline and the modal stays open so the operator can pick another
  // option (the flag is NOT persisted on the failure path — they haven't started).
  const handleStartDesign = useCallback(
    (machineId: WizardStarterMachineId): void => {
      if (busy) return
      setBusy(true)
      setError(null)
      void (async () => {
        let res: WizardReadCadSampleResult
        try {
          res = await fab().wizardReadCadSample({ machineId })
        } catch (e) {
          setError(`Couldn't load the starter design: ${e instanceof Error ? e.message : String(e)}`)
          setBusy(false)
          return
        }
        if (!res.ok) {
          setError(`Couldn't load the starter design: ${res.error}`)
          setBusy(false)
          return
        }
        await persistOnboardingComplete()
        onStartDesign({
          machineId,
          designName: res.designName,
          fileName: res.fileName,
          scriptText: res.scriptText
        })
      })()
    },
    [busy, onStartDesign]
  )

  // Escape-to-dismiss (WCAG 2.1.2). Document-level listener, same as the deleted
  // wizard + ConfirmDialog. Re-subscribes when `handleDismiss` re-identities
  // (its `busy` dep) so a mid-read Escape stays a no-op.
  useEffect(() => {
    const handler = onboardingEscapeKeydownHandler(handleDismiss)
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [handleDismiss])

  return (
    <div
      className="onboarding-overlay fro-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="fro-title"
      data-testid="first-run-onboarding"
    >
      <div className="onboarding-card fro-card">
        <header className="onboarding-header">
          <h1 id="fro-title" className="onboarding-title">
            Welcome to WorkTrack3D
          </h1>
          <p className="onboarding-subtitle">
            Pick a machine to start manufacturing, or jump straight into a parametric design.
          </p>
        </header>

        <div className="fro-grid" role="list">
          {ONBOARDING_OPTIONS.map((opt) => {
            const installed =
              opt.kind === 'design' ||
              resolveOnboardingMachine(opt.machineId, machines) !== null
            const disabled = busy || !installed
            const onClick =
              opt.kind === 'design'
                ? () => handleStartDesign(opt.machineId)
                : () => handlePickMachine(opt.machineId)
            return (
              <button
                key={`${opt.kind}-${opt.machineId}-${opt.title}`}
                type="button"
                role="listitem"
                className={`fro-option fro-option--${opt.kind}${disabled ? ' fro-option--disabled' : ''}`}
                onClick={onClick}
                disabled={disabled}
                title={
                  installed
                    ? opt.subtitle
                    : `${opt.title} isn't installed yet — add it from Settings.`
                }
                data-testid={`fro-option-${opt.machineId}-${opt.kind}`}
              >
                <span className="fro-option__glyph" aria-hidden="true">
                  {opt.glyph}
                </span>
                <span className="fro-option__title">{opt.title}</span>
                <span className="fro-option__subtitle">
                  {installed ? opt.subtitle : 'Not installed — add it from Settings'}
                </span>
                {opt.kind === 'design' ? (
                  <span className="fro-option__hint">
                    Loads the bundled “{WIZARD_MACHINE_TO_CAD_SAMPLE[opt.machineId].designName}” script
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>

        {error ? (
          <div className="fro-error" role="alert">
            {error}
          </div>
        ) : null}

        <footer className="onboarding-footer fro-footer">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={handleDismiss}
            disabled={busy}
            data-testid="fro-skip"
          >
            Skip for now
          </button>
          <div className="fro-footer__spacer" />
          <span className="fro-footer__note">You can change machines anytime from My Shop.</span>
        </footer>
      </div>
    </div>
  )
}

export default FirstRunOnboarding
