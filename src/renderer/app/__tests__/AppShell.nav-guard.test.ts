/**
 * AppShell unsaved-changes navigation-guard wiring — source pins.
 *
 * AppShell mounts the full shell provider chain (machine session, toast, UI,
 * command context), which is impractical to stand up under the node-env
 * `renderToStaticMarkup` harness. So — exactly as the Cycle-249
 * `manufacture-load-guard` reload-guard pins do — the WIRING is source-pinned:
 * the runtime behaviour is proven by the PURE `resolveNavIntent` unit tests +
 * the `NavigationGuardContext` registry tests; this file proves AppShell is
 * actually plumbed to them.
 *
 * The load-bearing invariant: EVERY nav sink must receive `guardedNavigate`,
 * never the raw `setActiveWorkspace`. The audit found four sinks — the command
 * registry's `navigate`, CommandContextProvider `onNavigate`, WorkspaceNav
 * `onSelect`, WorkspaceHost `onNavigate` — all funnel through here, so wrapping
 * the one `setActiveWorkspace` catches keyboard 1–6, the ribbon, the palette,
 * and the nav rail alike.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = readFileSync(join(__dirname, '..', 'AppShell.tsx'), 'utf-8')

describe('AppShell — navigation-guard seam wiring', () => {
  it('wraps the shell body in a NavigationGuardProvider', () => {
    expect(SRC).toContain("import { NavigationGuardProvider, useNavigationGuard } from './NavigationGuardContext'")
    expect(SRC).toContain('<NavigationGuardProvider>')
    expect(SRC).toContain('<AppShellBody />')
  })

  it('reads the guard registry and builds guardedNavigate via the pure resolveNavIntent', () => {
    expect(SRC).toContain("import { resolveNavIntent } from './navigation-guard'")
    expect(SRC).toContain('const navGuard = useNavigationGuard()')
    expect(SRC).toContain('const guardedNavigate = useCallback(')
    expect(SRC).toContain('const intent = resolveNavIntent({')
    expect(SRC).toContain('hasUnsavedChanges: navGuard.hasUnsavedChanges()')
  })

  it('parks the target in pendingNav on a confirm intent (does NOT navigate yet)', () => {
    expect(SRC).toContain('const [pendingNav, setPendingNav] = useState<WorkspaceId | null>(null)')
    expect(SRC).toContain("if (intent === 'confirm') {")
    expect(SRC).toContain('setPendingNav(target)')
  })

  it('navigates immediately on a navigate intent', () => {
    // After the confirm-early-return, the fall-through commits the route.
    expect(SRC).toContain('setActiveWorkspace(target)')
  })

  it('passes guardedNavigate to ALL FOUR nav sinks (never the raw setter)', () => {
    // 1. the command registry navigate (keyboard 1–6 / ribbon / palette)
    expect(SRC).toContain('navigate: guardedNavigate,')
    // 2. CommandContextProvider onNavigate
    expect(SRC).toContain('<CommandContextProvider workspace={activeWorkspace} onNavigate={guardedNavigate}>')
    // 3. WorkspaceNav onSelect
    expect(SRC).toContain('<WorkspaceNav active={activeWorkspace} onSelect={guardedNavigate} />')
    // 4. WorkspaceHost onNavigate
    expect(SRC).toContain('<WorkspaceHost active={activeWorkspace} onNavigate={guardedNavigate} />')
  })

  it('does NOT hand the raw setActiveWorkspace to any nav sink anymore', () => {
    // The raw setter must appear ONLY inside guardedNavigate + the confirm
    // handler — never directly as a sink prop. These exact raw-wiring strings
    // (the pre-guard shapes) must be gone.
    expect(SRC).not.toContain('onNavigate={setActiveWorkspace}')
    expect(SRC).not.toContain('onSelect={setActiveWorkspace}')
    expect(SRC).not.toContain('navigate: setActiveWorkspace,')
  })

  it('renders the ConfirmDialog gated on pendingNav with the exact leave-confirm copy', () => {
    expect(SRC).toContain("import { ConfirmDialog } from '../src/ConfirmDialog'")
    expect(SRC).toContain('open={pendingNav !== null}')
    expect(SRC).toContain('title="Unsaved CAM changes"')
    expect(SRC).toContain(
      'message="Leave Manufacture without saving? Your unsaved setups/operations will be lost."'
    )
    expect(SRC).toContain('confirmLabel="Leave without saving"')
    expect(SRC).toContain('cancelLabel="Stay"')
  })

  it('confirm commits the parked route + clears it; cancel only clears (stays put)', () => {
    expect(SRC).toContain('if (pendingNav !== null) setActiveWorkspace(pendingNav)')
    expect(SRC).toContain('setPendingNav(null)')
    expect(SRC).toContain('onCancel={() => setPendingNav(null)}')
  })
})
