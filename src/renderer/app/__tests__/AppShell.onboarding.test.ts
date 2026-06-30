/**
 * AppShell — first-run onboarding wiring pins.
 *
 * The deleted FirstLaunchWizard's BACKEND (the `wizard:*` IPC + the
 * `appSettings.hasCompletedOnboarding` flag) survived the P5 cutover but no
 * renderer mounted it, so a fresh install got no first-run walkthrough. This
 * cycle mounts {@link FirstRunOnboarding} from AppShell, gated on the flag.
 *
 * AppShell stands up the full provider chain (machine session, toast, UI,
 * command context), impractical under the node-env `renderToStaticMarkup`
 * harness — so, exactly like the sibling `AppShell.my-shop.test.ts` /
 * `AppShell.nav-guard.test.ts`, the WIRING is source-pinned here while the
 * picker's own render + pure seams are proven in `FirstRunOnboarding.test.tsx`.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = readFileSync(join(__dirname, '..', 'AppShell.tsx'), 'utf-8')

describe('AppShell — first-run onboarding seam wiring', () => {
  it('imports the picker + its design-starter type', () => {
    expect(SRC).toContain(
      "import { FirstRunOnboarding, type OnboardingDesignStarter } from './FirstRunOnboarding'"
    )
  })

  it('owns a tri-state onboarding gate (null until settings:get resolves)', () => {
    expect(SRC).toContain('const [needsOnboarding, setNeedsOnboarding] = useState<boolean | null>(null)')
  })

  it('reads hasCompletedOnboarding on mount and errs toward NOT nagging on failure', () => {
    expect(SRC).toContain('.settingsGet()')
    expect(SRC).toContain('setNeedsOnboarding(s.hasCompletedOnboarding !== true)')
    // A settings-read failure must not wedge the operator behind the modal.
    expect(SRC).toContain('setNeedsOnboarding(false)')
  })

  it('renders the picker ONLY when needsOnboarding === true (no flash before the read)', () => {
    expect(SRC).toContain('{needsOnboarding === true ? (')
    expect(SRC).toContain('<FirstRunOnboarding')
    expect(SRC).toContain('machines={machines}')
    expect(SRC).toContain('onSelectMachine={handleOnboardingSelectMachine}')
    expect(SRC).toContain('onStartDesign={handleOnboardingStartDesign}')
    expect(SRC).toContain('onDismiss={handleOnboardingDismiss}')
  })

  it('machine pick switches the session (activate + persist lastMachineId + reload tools)', () => {
    expect(SRC).toContain('const handleOnboardingSelectMachine = useCallback(')
    expect(SRC).toContain('(machine: MachineProfile): void => {')
    expect(SRC).toContain('setSessionMachine(machine)')
    expect(SRC).toContain('setLastMachineId(machine.id)')
    expect(SRC).toContain('void fab().settingsSet({ lastMachineId: machine.id })')
    expect(SRC).toContain('void loadToolsForMachine(machine.id)')
    expect(SRC).toContain('setNeedsOnboarding(false)')
  })

  it('design pick routes to Design through the SAME guardedNavigate (not the raw setter)', () => {
    expect(SRC).toContain('const handleOnboardingStartDesign = useCallback(')
    expect(SRC).toContain('(starter: OnboardingDesignStarter): void => {')
    expect(SRC).toContain("guardedNavigate('design')")
  })

  it('design pick stashes the starter script as the one-shot Design seed', () => {
    // The machine-specific bundled sample (already read by the picker) is stashed
    // so the WorkspaceHost can inject it into the Design editor on mount.
    expect(SRC).toContain('const [seedDesignScript, setSeedDesignScript] = useState<string | null>(null)')
    expect(SRC).toContain('setSeedDesignScript(starter.scriptText)')
  })

  it('threads the seed + its consume-ack into the WorkspaceHost', () => {
    expect(SRC).toContain('seedDesignScript={seedDesignScript}')
    expect(SRC).toContain('onSeedDesignConsumed={() => setSeedDesignScript(null)}')
  })

  it('dismiss just hides the modal (the picker already persisted the flag)', () => {
    expect(SRC).toContain('const handleOnboardingDismiss = useCallback((): void => {')
    expect(SRC).toContain('setNeedsOnboarding(false)')
  })
})
