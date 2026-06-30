/**
 * AppShell — "My Shop" quick-select wiring pins.
 *
 * CLAUDE.md (UI Requirements) mandates a one-click "My Shop" quick-select that
 * shows ONLY Jacob's three machines + their real-world presets. The
 * `MyShopDrawer` / `MyShopPanel` existed + were tested but were mounted
 * NOWHERE; this cycle mounts the drawer from the TopBar trigger.
 *
 * AppShell stands up the full provider chain (machine session, toast, UI,
 * command context), impractical under the node-env `renderToStaticMarkup`
 * harness — so, exactly like the sibling `AppShell.nav-guard.test.ts`, the
 * WIRING is source-pinned here while the runtime behaviour is proven by the
 * PURE seams it delegates to (`composePresetLaunchPlan` →
 * preset-launch-plan.test.ts, `resolveQuickSwitchMachine` → quick-switch.test.ts)
 * and by the drawer's own render pins (MyShopDrawer.test.tsx).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = readFileSync(join(__dirname, '..', 'AppShell.tsx'), 'utf-8')

describe('AppShell — My Shop quick-select seam wiring', () => {
  it('imports the drawer + the pure launch-plan seam (not an ad-hoc resolver)', () => {
    expect(SRC).toContain("import { MyShopDrawer } from '../shell/MyShopDrawer'")
    expect(SRC).toContain(
      "import { composePresetLaunchPlan } from '../src/environments/preset-launch-plan'"
    )
    expect(SRC).toContain("import { ENVIRONMENTS, type EnvironmentId, isEnvironmentId } from '../src/environments/registry'")
  })

  it('owns drawer open/close state and feeds the TopBar trigger', () => {
    expect(SRC).toContain('const [myShopOpen, setMyShopOpen] = useState(false)')
    expect(SRC).toContain('onOpenMyShop={() => setMyShopOpen(true)}')
  })

  it('renders the MyShopDrawer with the live machine list + active machine', () => {
    expect(SRC).toContain('<MyShopDrawer')
    expect(SRC).toContain('open={myShopOpen}')
    expect(SRC).toContain('onClose={() => setMyShopOpen(false)}')
    expect(SRC).toContain('machines={machines}')
    expect(SRC).toContain('currentMachineId={sessionMachine?.id ?? null}')
    expect(SRC).toContain('onLaunchPreset={handleLaunchMyShopPreset}')
    expect(SRC).toContain('onInstallMachine={handleInstallMyShopMachine}')
  })

  it('Escape also closes the My Shop drawer (matches the other overlays)', () => {
    expect(SRC).toContain('setMyShopOpen(false)')
  })

  it('launch handler composes the plan via the shared resolver + env registry', () => {
    expect(SRC).toContain('const handleLaunchMyShopPreset = useCallback(')
    expect(SRC).toContain('const plan = composePresetLaunchPlan(')
    expect(SRC).toContain('ENVIRONMENTS,')
    expect(SRC).toContain('machines,')
    expect(SRC).toContain('lastVariantByEnvId,')
    expect(SRC).toContain('sessionMachine?.id ?? null')
  })

  it('dispatches exactly one branch per plan kind (switch persists + activates)', () => {
    expect(SRC).toContain("case 'env-not-found':")
    expect(SRC).toContain("case 'no-machine-installed':")
    expect(SRC).toContain("case 'already-active':")
    expect(SRC).toContain("case 'switch': {")
    // The switch branch must persist variant memory, activate the machine,
    // persist lastMachineId, and reload that machine's tools.
    expect(SRC).toContain('setLastVariantByEnvId(plan.updatedVariantMap)')
    expect(SRC).toContain('setSessionMachine(plan.next)')
    expect(SRC).toContain('setLastMachineId(plan.next.id)')
    expect(SRC).toContain('void fab().settingsSet({ lastMachineId: plan.next.id })')
    expect(SRC).toContain('void loadToolsForMachine(plan.next.id)')
  })

  it('shares the EnvSwitcher variant-memory key (one memory across both surfaces)', () => {
    expect(SRC).toContain("const LAST_VARIANT_STORAGE_KEY = 'fab-env-last-variant-v1'")
    expect(SRC).toContain('localStorage.setItem(LAST_VARIANT_STORAGE_KEY, JSON.stringify(plan.updatedVariantMap))')
  })

  it('install affordance routes to Settings rather than silently no-op (no Library yet)', () => {
    expect(SRC).toContain('const handleInstallMyShopMachine = useCallback(')
    expect(SRC).toContain('setSettingsOpen(true)')
  })
})
