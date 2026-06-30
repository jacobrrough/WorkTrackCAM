import { useCallback, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { MachineProfile } from '../../shared/machine-schema'
import { useMachineSession } from '../contexts/MachineSessionContext'
import { useToast } from '../contexts/ToastContext'
import { useUI } from '../contexts/UIContext'
import { getEnvironmentForMachine } from '../src/environments/env-routing'
import { ENVIRONMENTS, type EnvironmentId, isEnvironmentId } from '../src/environments/registry'
import { composePresetLaunchPlan } from '../src/environments/preset-launch-plan'
import type { MyShopMachineId, MyShopPreset } from '../src/environments/my-shop-presets'
import { fab } from '../src/shop-types'
import { useWorkspaceRouter, type WorkspaceId } from './useWorkspaceRouter'
import { TopBar } from './TopBar'
import { Ribbon } from './Ribbon'
import { WorkspaceNav } from './WorkspaceNav'
import { WorkspaceHost } from './WorkspaceHost'
import { StatusBar } from './StatusBar'
import { SettingsDrawer } from '../shell/SettingsDrawer'
import { MyShopDrawer } from '../shell/MyShopDrawer'
import { FirstRunOnboarding, type OnboardingDesignStarter } from './FirstRunOnboarding'
import { HelpPanel } from '../src/HelpPanel'
import { NewShellCommandPalette } from './NewShellCommandPalette'
import { KeyboardShortcutsDialog } from '../src/KeyboardShortcutsDialog'
import { ConfirmDialog } from '../src/ConfirmDialog'
import { CommandContextProvider, registerStarterCommands } from '../commands'
import { NavigationGuardProvider, useNavigationGuard } from './NavigationGuardContext'
import { resolveNavIntent } from './navigation-guard'
import { applyTheme } from '../theme/useTheme'
import type { ThemeId } from '../theme/theme-registry'
import {
  isTypableKeyboardTarget,
  matchesCommandPaletteToggle,
  matchesKeyboardShortcutsReference
} from '../../shared/app-keyboard-shortcuts'

/**
 * Per-environment "last used machine" variant-memory key. Identical to
 * {@link EnvSwitcher}'s key so the TopBar env triad and the My Shop drawer
 * share one memory (e.g. the Makera 3-axis vs 4-axis choice survives across
 * both surfaces). Both write through the pure `composePresetLaunchPlan` /
 * `resolveQuickSwitchMachine` resolver, so the rules stay in lock-step.
 */
const LAST_VARIANT_STORAGE_KEY = 'fab-env-last-variant-v1'

/**
 * Read + validate the per-env variant map from localStorage. Guarded against
 * disabled storage (throws on access) and malformed / legacy JSON. Mirrors the
 * reader in {@link EnvSwitcher}; only keeps entries whose key is a known
 * `EnvironmentId` and whose value is a non-empty machine id.
 */
function readLastVariantByEnvId(): Partial<Record<EnvironmentId, string>> {
  try {
    const raw = localStorage.getItem(LAST_VARIANT_STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Partial<Record<EnvironmentId, string>> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (isEnvironmentId(k) && typeof v === 'string' && v.length > 0) {
        out[k] = v
      }
    }
    return out
  } catch {
    return {}
  }
}

/**
 * The new WorkTrack3D shell frame: a CSS grid of TopBar / WorkspaceNav /
 * WorkspaceHost / StatusBar. Reuses the existing contexts (machine session,
 * toast, UI) and the SettingsDrawer (which carries the 10-theme picker), so the
 * theme can be changed live from the new shell. Machine/CAM env selection runs
 * through the TopBar env triad and the {@link MyShopDrawer} quick-select; the
 * command palette / help overlays are wired alongside.
 *
 * Thin wrapper: provides the {@link NavigationGuardProvider} so the shell body
 * (and every workspace under it) shares one dirty-probe registry, then renders
 * {@link AppShellBody}. The body lives UNDER the provider so its `guardedNavigate`
 * can read `hasUnsavedChanges()` synchronously at click time.
 */
export function AppShell(): ReactElement {
  return (
    <NavigationGuardProvider>
      <AppShellBody />
    </NavigationGuardProvider>
  )
}

function AppShellBody(): ReactElement {
  const {
    sessionMachine,
    setSessionMachine,
    machines,
    lastMachineId,
    setLastMachineId,
    loadToolsForMachine
  } = useMachineSession()
  const { setCmdOpen, showShortcuts, setShowShortcuts, helpOpen, setHelpOpen } = useUI()
  const { pushToast } = useToast()
  const { activeWorkspace, setActiveWorkspace } = useWorkspaceRouter('design')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [myShopOpen, setMyShopOpen] = useState(false)
  // First-run onboarding gate. `null` until `settings:get` resolves (so the
  // modal never flashes before we know whether the operator already onboarded);
  // `true` shows the {@link FirstRunOnboarding} picker; `false` hides it. The
  // deleted FirstLaunchWizard's `hasCompletedOnboarding` flag is the source of
  // truth — every onboarding exit path persists it, then flips this to `false`.
  const [needsOnboarding, setNeedsOnboarding] = useState<boolean | null>(null)
  // Onboarding "Start a parametric design" seed. When the operator picks that
  // card, FirstRunOnboarding has already READ the machine-specific bundled CAD
  // sample (`wizard:readCadSample`); we stash its `scriptText` here so the
  // WorkspaceHost can inject it into the Design editor when the (CAD-first /
  // inert) session mounts. `null` once consumed (or when no design was seeded),
  // so a later manual edit is never clobbered. SAFETY: a CAD script string only —
  // no G-code, no machine-profile write.
  const [seedDesignScript, setSeedDesignScript] = useState<string | null>(null)
  // Per-env "last used machine" memory, seeded from localStorage and shared
  // with the TopBar EnvSwitcher (same key). Kept in state so a My Shop preset
  // launch updates the remembered variant immediately.
  const [lastVariantByEnvId, setLastVariantByEnvId] =
    useState<Partial<Record<EnvironmentId, string>>>(readLastVariantByEnvId)
  // Unsaved-changes navigation guard. `guardedNavigate` wraps EVERY nav path
  // (nav rail, keyboard 1–6, ribbon, command palette — all funnel through the
  // command registry / WorkspaceNav / WorkspaceHost into here). When a
  // registered workspace (today: ManufactureWorkspace) reports unsaved changes,
  // an attempted route switch is parked in `pendingNav` and the leave-confirm
  // is shown instead of unmounting the workspace (which would destroy its
  // in-memory plan). Confirm → commit; cancel → stay. Re-selecting the active
  // workspace never confirms (pure `resolveNavIntent`).
  const navGuard = useNavigationGuard()
  const [pendingNav, setPendingNav] = useState<WorkspaceId | null>(null)

  const guardedNavigate = useCallback(
    (target: WorkspaceId): void => {
      const intent = resolveNavIntent({
        active: activeWorkspace,
        target,
        hasUnsavedChanges: navGuard.hasUnsavedChanges()
      })
      if (intent === 'confirm') {
        setPendingNav(target)
        return
      }
      setActiveWorkspace(target)
    },
    [activeWorkspace, navGuard, setActiveWorkspace]
  )

  // My Shop preset launch. Routes through the pure `composePresetLaunchPlan`
  // seam so a preset honours the SAME variant-memory / idempotent /
  // default-machine rules the TopBar env triad uses. Match on the plan's
  // discriminant and dispatch exactly one branch:
  //   - 'switch'             → persist the variant memory, activate the
  //                            machine, persist `lastMachineId`, reload tools.
  //   - 'already-active'     → idempotent: just acknowledge.
  //   - 'no-machine-installed' / 'env-not-found' → toast the hint (the new
  //                            shell has no Library drawer yet; Settings hosts
  //                            machine management).
  // SAFETY: machine-session + settings writes only; no G-code.
  const handleLaunchMyShopPreset = useCallback(
    (preset: MyShopPreset): void => {
      const plan = composePresetLaunchPlan(
        preset,
        ENVIRONMENTS,
        machines,
        lastVariantByEnvId,
        sessionMachine?.id ?? null
      )
      switch (plan.kind) {
        case 'env-not-found':
          pushToast('err', `Preset "${preset.label}" points at an unknown environment.`)
          return
        case 'no-machine-installed':
          pushToast('warn', plan.toastMessage)
          return
        case 'already-active':
          pushToast('ok', plan.toastMessage)
          return
        case 'switch': {
          setLastVariantByEnvId(plan.updatedVariantMap)
          try {
            localStorage.setItem(LAST_VARIANT_STORAGE_KEY, JSON.stringify(plan.updatedVariantMap))
          } catch {
            /* quota / disabled storage — variant memory stays in-session only */
          }
          setSessionMachine(plan.next)
          setLastMachineId(plan.next.id)
          void fab().settingsSet({ lastMachineId: plan.next.id })
          void loadToolsForMachine(plan.next.id)
          pushToast('ok', plan.toastMessage)
          return
        }
      }
    },
    [
      machines,
      lastVariantByEnvId,
      sessionMachine,
      setSessionMachine,
      setLastMachineId,
      loadToolsForMachine,
      pushToast
    ]
  )

  // "Install machine" affordance for an uninstalled My Shop card. The new shell
  // has no Library drawer yet (machine management lives in Settings), so this
  // surfaces an honest hint + opens Settings rather than silently no-op'ing.
  const handleInstallMyShopMachine = useCallback(
    (machineId: MyShopMachineId): void => {
      pushToast(
        'warn',
        `${machineId} isn't installed yet — add it from Settings to enable its presets.`
      )
      setSettingsOpen(true)
    },
    [pushToast]
  )

  // Global shortcuts: Ctrl/Cmd+K command palette, Ctrl/Cmd+Shift+? shortcuts
  // reference, F1 help, Escape closes overlays. Reuses the shared matchers so
  // the bindings stay identical to the legacy shell.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isTypableKeyboardTarget(e.target)) return
      if (matchesCommandPaletteToggle(e)) {
        e.preventDefault()
        setCmdOpen((x) => !x)
      } else if (matchesKeyboardShortcutsReference(e)) {
        e.preventDefault()
        setShowShortcuts((x) => !x)
      } else if (e.key === 'F1' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        setHelpOpen((x) => !x)
      } else if (e.key === 'Escape') {
        setCmdOpen(false)
        setShowShortcuts(false)
        setHelpOpen(false)
        setSettingsOpen(false)
        setMyShopOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setCmdOpen, setShowShortcuts, setHelpOpen])

  // CAD-first: there is no splash machine-picker. Once the machine library has
  // loaded (MachineSessionProvider fetches it on mount), adopt the operator's
  // last machine — or the first installed — in the background, so machine status
  // and CAM work without forcing a choice up front. The operator can change it
  // later from the (forthcoming) machine switcher / My Shop drawer.
  useEffect(() => {
    if (sessionMachine || machines.length === 0) return
    const preferred =
      (lastMachineId ? machines.find((m) => m.id === lastMachineId) : undefined) ?? machines[0]
    if (preferred) {
      setSessionMachine(preferred)
      void loadToolsForMachine(preferred.id)
    }
  }, [sessionMachine, machines, lastMachineId, setSessionMachine, loadToolsForMachine])

  // First-run gate: read `hasCompletedOnboarding` once on mount. The
  // FirstLaunchWizard backend (the `wizard:*` IPC + this settings flag) survived
  // the P5 cutover but lost its renderer; this re-mounts the picker for any
  // operator who has not completed (or skipped) onboarding. A settings-read
  // failure errs toward NOT nagging (treat as already-onboarded) so a transient
  // IPC hiccup can never wedge the operator behind a modal.
  useEffect(() => {
    let cancelled = false
    void fab()
      .settingsGet()
      .then((s) => {
        if (!cancelled) setNeedsOnboarding(s.hasCompletedOnboarding !== true)
      })
      .catch(() => {
        if (!cancelled) setNeedsOnboarding(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Onboarding → machine pick. The picker already persisted
  // `hasCompletedOnboarding`; here we switch the session to the chosen machine
  // (same writes the My Shop `'switch'` branch + the background-adopt effect
  // make: activate, persist `lastMachineId`, reload its tools) and dismiss.
  // SAFETY: machine-session + settings writes only; no G-code.
  const handleOnboardingSelectMachine = useCallback(
    (machine: MachineProfile): void => {
      setSessionMachine(machine)
      setLastMachineId(machine.id)
      void fab().settingsSet({ lastMachineId: machine.id })
      void loadToolsForMachine(machine.id)
      setNeedsOnboarding(false)
      pushToast('ok', `${machine.name} is your active machine.`)
    },
    [setSessionMachine, setLastMachineId, loadToolsForMachine, pushToast]
  )

  // Onboarding → "Start a parametric design". The picker already read the
  // bundled CadQuery starter (via `wizard:readCadSample`) and persisted the
  // flag; the new shell is CAD-first (Design is the default route), so we route
  // there and acknowledge the loaded starter. Seeding the script into the live
  // editor is the WorkspaceHost's job (it owns the design-session script state):
  // we stash the starter's `scriptText` in `seedDesignScript` and hand it down so
  // the host injects THAT machine's sample when the inert CAD session mounts
  // (instead of the generic default). SAFETY: a CAD script string only — no G-code.
  const handleOnboardingStartDesign = useCallback(
    (starter: OnboardingDesignStarter): void => {
      setSeedDesignScript(starter.scriptText)
      setNeedsOnboarding(false)
      guardedNavigate('design')
      pushToast('ok', `Loaded the “${starter.designName}” starter — opening Design.`)
    },
    [guardedNavigate, pushToast]
  )

  // Onboarding dismissed (Skip / Escape). The picker already persisted the flag;
  // just stop rendering the modal.
  const handleOnboardingDismiss = useCallback((): void => {
    setNeedsOnboarding(false)
  }, [])

  // FG-1 · register the shell-level starter commands (workspace navigation,
  // Settings/Help/Palette, theme switching) on the shared command registry so
  // the engine is live: the palette (and the forthcoming ribbon/menus) all
  // dispatch these by `command.id`. The disposer unregisters on unmount so a
  // shell remount never double-registers. `navigate` is `guardedNavigate` (NOT
  // the raw setter) so the keyboard 1–6 / ribbon / palette nav paths all go
  // through the unsaved-changes confirm. `guardedNavigate` re-identities when
  // the active workspace changes; the disposer unregisters the prior closure
  // first, so the registry always holds the freshest guard.
  useEffect(() => {
    return registerStarterCommands({
      navigate: guardedNavigate,
      openSettings: () => setSettingsOpen(true),
      openHelp: () => setHelpOpen(true),
      openCommandPalette: () => setCmdOpen(true),
      applyTheme: (theme: ThemeId) => {
        applyTheme(theme)
      }
    })
  }, [guardedNavigate, setHelpOpen, setCmdOpen])

  // Layer the active machine's environment accent over the theme (themes.css
  // [data-environment] overrides). Null while no machine is selected → the
  // theme's own accent (Titanium steel-blue by default) is used.
  const env = getEnvironmentForMachine(sessionMachine?.id ?? null)

  return (
    <CommandContextProvider workspace={activeWorkspace} onNavigate={guardedNavigate}>
      <div className="wt-shell" data-environment={env?.id}>
        <TopBar
          machine={sessionMachine}
          projectName="Untitled project"
          onOpenCommand={() => setCmdOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenHelp={() => setHelpOpen((x) => !x)}
          onOpenMyShop={() => setMyShopOpen(true)}
        />
        {/*
          FG-4a · the contextual command ribbon, directly below the TopBar and
          above the nav rail / workspace body. It reads the live FG-1 context
          (this `CommandContextProvider` is its ancestor: workspace from the
          AppShell-owned router, machineKind derived inside the provider from the
          active machine, selection/sketch from the pushed-up surface) and renders
          the tabs/panels for the active (workspace × machineKind), dispatching
          every button through the one shared command registry. It spans both grid
          columns (`grid-area: ribbon`) so the nav rail starts beneath it.
        */}
        <Ribbon />
        <WorkspaceNav active={activeWorkspace} onSelect={guardedNavigate} />
        <main className="wt-main">
          <WorkspaceHost
            active={activeWorkspace}
            onNavigate={guardedNavigate}
            // Onboarding "Start a parametric design" seed: the machine-specific
            // bundled CAD sample text, injected into the Design editor when the
            // inert CAD-first session mounts. Cleared once the host consumes it so
            // a manual edit is never re-clobbered.
            seedDesignScript={seedDesignScript}
            onSeedDesignConsumed={() => setSeedDesignScript(null)}
          />
        </main>
        <StatusBar machineName={sessionMachine?.name ?? null} units="mm" activeWorkspace={activeWorkspace} />

        <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} onToast={pushToast} />
        {/*
          CLAUDE.md UI Requirement — the one-click "My Shop" quick-select. Shows
          ONLY Jacob's three target machines + their real-world presets. Opened
          from the TopBar trigger; preset launches route through
          `handleLaunchMyShopPreset` (the same variant-memory resolver the env
          triad uses), and the uninstalled-card affordance routes to Settings.
        */}
        <MyShopDrawer
          open={myShopOpen}
          onClose={() => setMyShopOpen(false)}
          machines={machines}
          currentMachineId={sessionMachine?.id ?? null}
          onLaunchPreset={handleLaunchMyShopPreset}
          onInstallMachine={handleInstallMyShopMachine}
        />
        {helpOpen ? <HelpPanel onClose={() => setHelpOpen(false)} /> : null}
        {showShortcuts ? <KeyboardShortcutsDialog onClose={() => setShowShortcuts(false)} /> : null}
        <NewShellCommandPalette />

        {/*
          First-run onboarding picker. Gated on the `hasCompletedOnboarding`
          settings flag (read on mount): shown ONLY to an operator who has not
          completed or skipped onboarding. Restores the deleted FirstLaunchWizard's
          first-run step in the CAD-first shell — four starter choices (the three
          target machines + "Start a parametric design"), wired to the surviving
          wizard IPC. Every exit path persists the flag, so it shows at most once.
        */}
        {needsOnboarding === true ? (
          <FirstRunOnboarding
            machines={machines}
            onSelectMachine={handleOnboardingSelectMachine}
            onStartDesign={handleOnboardingStartDesign}
            onDismiss={handleOnboardingDismiss}
          />
        ) : null}

        {/*
          Unsaved-changes leave-confirm. Shown only when a guarded navigation was
          parked (a registered workspace reported dirty). Confirm commits the
          parked route (unmounting the workspace + losing its unsaved plan was
          the operator's explicit choice); cancel clears the parked route and
          stays put. Reuses the in-app ConfirmDialog (testable, focus-trapped,
          Escape-cancels) rather than window.confirm.
        */}
        <ConfirmDialog
          open={pendingNav !== null}
          title="Unsaved CAM changes"
          message="Leave Manufacture without saving? Your unsaved setups/operations will be lost."
          confirmLabel="Leave without saving"
          cancelLabel="Stay"
          danger
          onConfirm={() => {
            if (pendingNav !== null) setActiveWorkspace(pendingNav)
            setPendingNav(null)
          }}
          onCancel={() => setPendingNav(null)}
        />
      </div>
    </CommandContextProvider>
  )
}
