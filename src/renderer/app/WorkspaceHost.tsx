import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import { STARTER_SCRIPT, type DesignViewMode } from '../design/DesignWorkspace'
import { DesignSessionProvider } from '../design/DesignSessionContext'
import { formatRecoverySavedAt } from '../design/DesignRecoveryBanner'
import {
  runScriptProjectOpen,
  runScriptSave,
  type DesignScriptRecoverySnapshot
} from '../../shared/design-script-persistence'
import { DesignWorkspaceHost } from './DesignWorkspaceHost'
import { EmptyState } from '../src/EmptyState'
import { useToast } from '../contexts/ToastContext'
import { useProjectSession } from './useProjectSession'
import { useMachineSession } from '../contexts/MachineSessionContext'
import { useCamHandoff } from './CamHandoffContext'
import { fab } from '../src/shop-types'
import {
  runSendToCam,
  runPersistMate,
  runHydrateAssembly,
  runPersistAssemblyParts,
  runPersistMateConstraints
} from './workspace-host-handoff'
import type { AssemblyPart } from '../design/AssemblyView'
import type { AssemblyMateConstraint } from '../../shared/assembly-mate-schema'
import { WorkshopHost } from './WorkshopHost'
import { UtilitiesHost } from './UtilitiesHost'
import { ManufactureHost } from './ManufactureHost'
import { WorkspaceErrorBoundary } from '../src/WorkspaceErrorBoundary'
import type { WorkspaceId } from './useWorkspaceRouter'

/**
 * Renders exactly one workspace for the active route.
 *
 * Design / Assemble / Drawings all resolve to the CAD `DesignWorkspace`, which
 * already hosts Part / Assembly / Drawing as internal tabs. The route is
 * wrapped in a `DesignSessionProvider` (scoped to the CAD routes only) so the
 * inner `DesignWorkspaceHost` can thread the editable kernel-op timeline into
 * the FeatureTree. The provider is gated on `projectDir`: with no project open
 * (`projectDir == null`, the CAD-first boot state) it fires zero IPC and the
 * timeline simply does not render. The active route also picks which CAD
 * view-mode tab opens (`routeToViewMode`): the `assemble` route lands on the
 * Assembly tab — which mounts the AssemblyView + the mate-creation surface —
 * instead of always opening on the Part editor. Manufacture / Workshop /
 * Utilities mount their own hosts (`ManufactureHost` / `WorkshopHost` /
 * `UtilitiesHost`); only an unknown route falls back to an EmptyState.
 *
 * **Wave 3h — the two CAD↔CAM bridges go live here.** Both formerly toasted a
 * "coming soon" acknowledgment; now they do real work via the pure
 * `workspace-host-handoff` seam:
 *   - `handleSendToCam(payload)` queues the design's freshly-exported STL into
 *     the cross-workspace CAM mailbox (`useCamHandoff`) and navigates to
 *     Manufacture, where `ManufactureHost` imports it into the first plate.
 *   - `handleMateAdded(mate)` folds a solved mate into the on-disk assembly's
 *     `mateConstraints` (`assembly:load` → `persistMate` → `assembly:save`),
 *     additive + backward-compatible per Safety Rule 2.
 * Neither path emits G-code.
 */

/**
 * Map a CAD route onto the DesignWorkspace view-mode tab it should open on.
 * Non-CAD routes never reach the CAD branch, but the map is total over the
 * three CAD routes so a new CAD route cannot silently fall back to Part.
 */
function routeToViewMode(active: WorkspaceId): DesignViewMode {
  switch (active) {
    case 'assemble':
      return 'assembly'
    case 'drawings':
      return 'drawing'
    case 'design':
    default:
      return 'part'
  }
}

/**
 * Human-readable label for the active workspace, shown by the
 * {@link WorkspaceErrorBoundary} fallback ("The <label> workspace
 * encountered an unexpected error."). Total over every {@link WorkspaceId} so
 * a new route cannot silently fall through to a generic string.
 */
// ── Script crash-snapshot banner styles ─────────────────────────────────────
// Self-contained inline styles mirroring DesignRecoveryBanner (no shared-CSS
// edits). Offset BELOW the sketch recovery banner (top: 56) so both offers can
// show at once without overlap.
const scriptBannerStyle: CSSProperties = {
  position: 'fixed',
  top: 108,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 60,
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '10px 14px',
  borderRadius: 8,
  border: '1px solid var(--accent, #4f8cff)',
  background: 'var(--panel-bg, #1e2126)',
  color: 'var(--text, #e6e8eb)',
  boxShadow: '0 6px 24px rgba(0, 0, 0, 0.45)',
  fontSize: 13,
  maxWidth: 560
}

const scriptBannerButtonBase: CSSProperties = {
  fontSize: 12,
  padding: '5px 12px',
  borderRadius: 6,
  cursor: 'pointer'
}

const scriptRestoreButtonStyle: CSSProperties = {
  ...scriptBannerButtonBase,
  border: '1px solid var(--accent, #4f8cff)',
  background: 'var(--accent, #4f8cff)',
  color: '#fff',
  fontWeight: 600
}

const scriptDiscardButtonStyle: CSSProperties = {
  ...scriptBannerButtonBase,
  border: '1px solid var(--border, #3a3f46)',
  background: 'transparent',
  color: 'var(--text-dim, #9aa0a8)'
}

function workspaceLabel(active: WorkspaceId): string {
  switch (active) {
    case 'design':
      return 'Design'
    case 'assemble':
      return 'Assemble'
    case 'drawings':
      return 'Drawings'
    case 'manufacture':
      return 'Manufacture'
    case 'workshop':
      return 'Workshop'
    case 'utilities':
      return 'Utilities'
    default:
      return 'Workspace'
  }
}

export function WorkspaceHost({
  active,
  onNavigate,
  seedDesignScript = null,
  onSeedDesignConsumed
}: {
  active: WorkspaceId
  onNavigate: (w: WorkspaceId) => void
  /**
   * Onboarding "Start a parametric design" seed — the machine-specific bundled
   * CAD sample text the {@link FirstRunOnboarding} picker already read. When
   * non-null AND the CAD session is still inert (CAD-first boot: no project open,
   * the editor still on the generic {@link STARTER_SCRIPT}), the seed effect
   * injects THIS script into the Design editor (via `designScript` + a remount
   * token) so the operator lands on their chosen machine's sample. Optional —
   * omitted by callers that don't onboard; `null` is the no-seed default.
   */
  seedDesignScript?: string | null
  /**
   * Fired once the seed has been injected so the parent can clear it (so a later
   * manual edit is never re-clobbered by a stale seed). Optional.
   */
  onSeedDesignConsumed?: () => void
}): ReactElement {
  const { pushToast } = useToast()
  // Project binding for the CAD session. Mirrors `ManufactureHost`'s own
  // `useProjectSession()` call (a second independent instance — both hydrate
  // from `settings.lastProjectPath`, so they converge). `projectDir` is `null`
  // on CAD-first boot until the operator opens/creates a project, which keeps
  // the DesignSessionProvider inert (no spurious boot IPC).
  const { projectDir } = useProjectSession()
  // Active machine — only its display name is read here, for the Send-to-CAM
  // toast ("Sending <part> to <machine>…").
  const { sessionMachine } = useMachineSession()
  // Cross-workspace CAM import mailbox. Design SETS a queued STL here; the
  // Manufacture subtree CONSUMES it on mount and binds it to the first plate
  // (see {@link CamHandoffContext}). The provider lives above WorkspaceHost in
  // AppProviders, so the slot survives the route switch that unmounts Design.
  const { setPendingCamImport } = useCamHandoff()
  const [designScript, setDesignScript] = useState<string>(STARTER_SCRIPT)

  // SCRIPT DISK PERSISTENCE — mirror of `designScript` readable from effects
  // WITHOUT depending them on the churning state value (the Cycle-249 rule:
  // never key a state-replacing load effect on values that change per edit).
  const designScriptRef = useRef<string>(STARTER_SCRIPT)
  useEffect(() => {
    designScriptRef.current = designScript
  }, [designScript])
  // One disk load per opened project dir (guards re-runs on unrelated renders).
  const scriptProjectRef = useRef<string | null>(null)
  // Pending write-ahead crash snapshot offer (Restore / Discard banner).
  const [scriptRecoveryOffer, setScriptRecoveryOffer] =
    useState<DesignScriptRecoverySnapshot | null>(null)

  // CAD foundation (#9 reload surface) — the assembly's parts + durable mate
  // constraints hydrated from `<projectDir>/assembly.json` when the `assemble`
  // route is active. Seeded empty; the hydrate effect below fills them so a
  // SAVED assembly shows its parts + mates (editable) after reload, and the
  // mates flow into the solver. A `hydrateToken` bumps on each (route, project)
  // change so the DesignWorkspaceHost remounts with the fresh seed (its
  // `initialAssemblyParts` / `initialAssemblyMates` are mount-only).
  const [assemblyParts, setAssemblyParts] = useState<readonly AssemblyPart[]>([])
  const [assemblyMates, setAssemblyMates] = useState<readonly AssemblyMateConstraint[]>([])
  const [hydrateToken, setHydrateToken] = useState(0)

  // Onboarding design-seed. The "Start a parametric design" card hands the
  // machine-specific bundled CAD sample down via `seedDesignScript`; inject it
  // into the Design editor so the operator opens on THEIR machine's starter
  // rather than the generic STARTER_SCRIPT. Gated to the CAD-first boot case:
  //   - a script is actually queued (`seedDesignScript` non-null), AND
  //   - no project is open (`projectDir == null` — the session is inert; with a
  //     project the on-disk sketch is the source of truth and must NOT be
  //     overwritten by a starter), AND
  //   - the editor is still on the untouched default (`designScript ===
  //     STARTER_SCRIPT`) so a manual edit made before the seed lands is never
  //     clobbered.
  // On a match we set `designScript` and bump `hydrateToken` (the DesignWorkspaceHost
  // `key` includes it, and DesignWorkspace seeds its editor from `initialScript`
  // mount-only — so a remount is what actually loads the new script), then ack via
  // `onSeedDesignConsumed` so the parent clears the one-shot seed. SAFETY: sets a
  // CAD script string only; emits no G-code.
  useEffect(() => {
    if (seedDesignScript == null) return
    if (projectDir !== null) return
    if (designScript !== STARTER_SCRIPT) return
    setDesignScript(seedDesignScript)
    setHydrateToken((t) => t + 1)
    onSeedDesignConsumed?.()
  }, [seedDesignScript, projectDir, designScript, onSeedDesignConsumed])

  // CAD foundation (#9) — hydrate the on-disk assembly when the assemble route
  // is active. Guarded so it fires only on the assemble route + a (projectDir)
  // change (not every render); a failure folds to a toast and leaves the parts
  // empty (the AssemblyView shows its empty-state). On success it bumps
  // hydrateToken so the inner host remounts with the fresh seed.
  useEffect(() => {
    if (active !== 'assemble') return
    let cancelled = false
    void (async () => {
      const outcome = await runHydrateAssembly({
        projectDir,
        loadAssembly: (dir) => fab().assemblyLoad(dir)
      })
      if (cancelled) return
      if (!outcome.ok) {
        pushToast('err', outcome.reason)
        return
      }
      setAssemblyParts(outcome.hydrated.parts)
      setAssemblyMates(outcome.hydrated.mateConstraints)
      setHydrateToken((t) => t + 1)
    })()
    return () => {
      cancelled = true
    }
    // pushToast is stable from the toast context; projectDir + active are the
    // load-bearing deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, projectDir])

  // SCRIPT DISK PERSISTENCE — seed the editor from `design/script.cq.py` when
  // a project opens, and surface any write-ahead crash snapshot as a
  // Restore/Discard OFFER. The pure `runScriptProjectOpen` seam owns both
  // decisions:
  //   - the buffer is REPLACED only while still on the untouched
  //     STARTER_SCRIPT (a manual in-session edit is never clobbered by an
  //     older disk copy without the user acting — Cycle-249);
  //   - the snapshot is only OFFERED (banner below), never auto-applied.
  // Runs once per opened project dir (scriptProjectRef); reads the current
  // buffer through designScriptRef so the effect deps stay [projectDir] only.
  useEffect(() => {
    if (projectDir === null) return
    if (scriptProjectRef.current === projectDir) return
    scriptProjectRef.current = projectDir
    let cancelled = false
    void (async () => {
      const decision = await runScriptProjectOpen({
        projectDir,
        currentBuffer: designScriptRef.current,
        pristineBuffer: STARTER_SCRIPT,
        loadScript: (dir) => window.fab.designScriptLoad(dir),
        readRecovery: (dir) => window.fab.designScriptRecoveryRead(dir)
      })
      if (cancelled) return
      if (decision.seedScript !== null) {
        setDesignScript(decision.seedScript)
        designScriptRef.current = decision.seedScript
        setHydrateToken((t) => t + 1)
      }
      if (decision.recoveryOffer !== null) setScriptRecoveryOffer(decision.recoveryOffer)
    })()
    return () => {
      cancelled = true
    }
  }, [projectDir])

  // SCRIPT DISK PERSISTENCE — the Save gesture. Updates the session state
  // (as before) and persists to `<projectDir>/design/script.cq.py` through
  // the pure `runScriptSave` seam (write-ahead snapshot → atomic project
  // write; a successful save deletes the snapshot main-side). The outcome
  // folds to an HONEST toast — the old "saved to session" message implied a
  // durability that never existed. SAFETY: script text only; no G-code.
  const handleDesignScriptSave = useCallback(
    (script: string): void => {
      setDesignScript(script)
      designScriptRef.current = script
      void (async () => {
        const outcome = await runScriptSave({
          projectDir,
          script,
          saveScript: (dir, s) => window.fab.designScriptSave(dir, s),
          writeRecovery: (json) => window.fab.designScriptRecoveryWrite(json)
        })
        // A clean save just deleted the on-disk snapshot; drop any stale offer.
        if (outcome.persisted) setScriptRecoveryOffer(null)
        pushToast(outcome.toast.kind, outcome.toast.message)
      })()
    },
    [projectDir, pushToast]
  )

  // EXPLICIT user action — the only code path that applies a script snapshot
  // to the editor (never an effect; Cycle-249 contract). The snapshot file
  // stays on disk until a clean save deletes it (mirrors
  // restoreRecoveredDesign), so a crash before that save can offer again.
  const handleScriptRecoveryRestore = useCallback((): void => {
    const offer = scriptRecoveryOffer
    if (offer === null) return
    setDesignScript(offer.script)
    designScriptRef.current = offer.script
    setHydrateToken((t) => t + 1)
    setScriptRecoveryOffer(null)
    pushToast('ok', 'Recovered CadQuery script restored — Save to keep it.')
  }, [scriptRecoveryOffer, pushToast])

  const handleScriptRecoveryDiscard = useCallback((): void => {
    const offer = scriptRecoveryOffer
    setScriptRecoveryOffer(null)
    if (offer !== null) {
      void window.fab.designScriptRecoveryDelete(offer.projectDir).catch(() => {})
    }
  }, [scriptRecoveryOffer])

  // Serialize assembly-mate persistence. `runPersistMate` is a load→fold→save
  // over `assembly.json`, and `handleMateAdded` fires it fire-and-forget from
  // inside the AssemblyMatePanel solve callback (the Solve button re-enables the
  // instant the solve IPC resolves — BEFORE this persist's save lands). Two
  // mates solved in quick succession would otherwise each `loadAssembly` the
  // SAME on-disk constraints and the last `saveAssembly` would drop the other
  // mate (a silent lost-update; the "Mate saved" toast already claimed success).
  // Chaining each persist onto the previous one guarantees save N completes
  // before load N+1 begins, so every fold sees the prior write.
  const matePersistChainRef = useRef<Promise<void>>(Promise.resolve())

  // Stable `onStatus` for the DesignSessionProvider. An inline arrow here gave a
  // new identity every render; the session's load effect used to list onStatus
  // in its deps, so that churn re-ran the disk load and `replace`d the in-memory
  // design — wiping unsaved sketch edits. The session now reads onStatus through
  // a ref AND guards reloads by (projectDir, revision), so this is belt-and-
  // suspenders; keep it stable regardless so no future dep on it can churn.
  const handleDesignStatus = useCallback((m: string) => pushToast('ok', m), [pushToast])

  // Wave 3h — REAL Send-to-CAM hand-off. The design's STL is already exported by
  // the time this fires (`payload.stlPath`); we queue it into the CAM mailbox
  // and navigate to Manufacture, where ManufactureHost imports it into the first
  // plate via the proven `assets:importMesh` → bind → `manufacture:save` path
  // (and emits the authoritative "Part landed in CAM" toast). The pure
  // `runSendToCam` seam owns the order (mailbox first, then navigate) + the
  // honest toast text; SAFETY: no G-code here — STL hand-off only.
  const handleSendToCam = useCallback(
    (payload: { stlPath: string }): void => {
      const result = runSendToCam({
        stlPath: payload.stlPath,
        machineLabel: sessionMachine?.name ?? null,
        setPendingCamImport,
        navigateToManufacture: () => onNavigate('manufacture')
      })
      pushToast(result.toast.kind, result.toast.message)
    },
    [sessionMachine, setPendingCamImport, onNavigate, pushToast]
  )

  // Wave 3h — REAL assembly mate persistence. A solved Model-B mate is folded
  // into the on-disk assembly's Model-C `mateConstraints` and re-saved (additive;
  // Safety Rule 2 — a legacy assembly.json with no mates still loads). The pure
  // `runPersistMate` seam loads → folds (`persistMate`) → saves and returns the
  // toast. SAFETY: assembly-data write only; no G-code.
  const handleMateAdded = useCallback(
    (mate: Parameters<typeof runPersistMate>[0]['mate']): void => {
      // Chain onto the prior persist (load→fold→save) so concurrent solves can
      // never stale-base each other's `loadAssembly` — see matePersistChainRef.
      matePersistChainRef.current = matePersistChainRef.current
        .catch(() => {})
        .then(async () => {
          const outcome = await runPersistMate({
            mate,
            projectDir,
            loadAssembly: (dir) => fab().assemblyLoad(dir),
            saveAssembly: (dir, json) => fab().assemblySave(dir, json)
          })
          pushToast(outcome.toast.kind, outcome.toast.message)
          // GAP 2 (in-session stale mates) — after a SUCCESSFUL persist, refresh
          // the in-memory mate set so a "Solve" right after adding a mate sees the
          // NEW constraint in the SAME session (no route round-trip). We re-read
          // `assembly.json` through the proven hydrate path and bump hydrateToken,
          // which remounts DesignWorkspaceHost with the fresh `initialAssemblyMates`
          // seed (a mount-only prop) → DesignWorkspace state → AssemblyView's
          // `mateConstraints` (the `assembly:solve` input). This re-read runs INSIDE
          // the same matePersistChainRef link, i.e. strictly AFTER this persist's
          // save committed, so it can never read a stale base or clobber a
          // concurrent save (the chain serializes both). A null `projectDir` cannot
          // reach here: runPersistMate returns `ok:false` (warn) without writing.
          if (!outcome.ok) return
          const refreshed = await runHydrateAssembly({
            projectDir,
            loadAssembly: (dir) => fab().assemblyLoad(dir)
          })
          if (!refreshed.ok) return
          setAssemblyParts(refreshed.hydrated.parts)
          setAssemblyMates(refreshed.hydrated.mateConstraints)
          setHydrateToken((t) => t + 1)
        })
    },
    [projectDir, pushToast]
  )

  // CAD foundation (#8) — persist the parts list into `assembly.json`
  // `components` so a mate's part refs resolve against real saved components.
  // Routed through the SAME matePersistChainRef as handleMateAdded so a
  // parts-save and a mate-save can never stale-base each other's load (silent
  // lost-update). SAFETY: assembly-data write only; no G-code.
  const handleAssemblyPartsChange = useCallback(
    (parts: readonly AssemblyPart[]): void => {
      setAssemblyParts(parts)
      matePersistChainRef.current = matePersistChainRef.current
        .catch(() => {})
        .then(async () => {
          const outcome = await runPersistAssemblyParts({
            parts,
            projectDir,
            loadAssembly: (dir) => fab().assemblyLoad(dir),
            saveAssembly: (dir, json) => fab().assemblySave(dir, json)
          })
          if (!outcome.ok) pushToast('err', `Assembly not saved: ${outcome.reason}`)
        })
    },
    [projectDir, pushToast]
  )

  // Phase-4 — persist a Mates-panel edit (delete / scalar / suppress). The
  // AssemblyView already applied the pure fold and handed back the FULL desired
  // list; we mirror it into `assemblyMates` (the in-session solver input) and
  // persist through the SAME matePersistChainRef so a mate-list edit can never
  // stale-base a concurrent parts / mate-add save. `runPersistMateConstraints`
  // reloads the REAL assembly.json and swaps only `mateConstraints`, preserving
  // `components`. SAFETY: assembly-data write only; no G-code.
  const handleMateConstraintsChange = useCallback(
    (next: readonly AssemblyMateConstraint[]): void => {
      setAssemblyMates(next)
      matePersistChainRef.current = matePersistChainRef.current
        .catch(() => {})
        .then(async () => {
          const outcome = await runPersistMateConstraints({
            mateConstraints: next,
            projectDir,
            loadAssembly: (dir) => fab().assemblyLoad(dir),
            saveAssembly: (dir, json) => fab().assemblySave(dir, json)
          })
          if (!outcome.ok) pushToast('err', `Mates not saved: ${outcome.reason}`)
        })
    },
    [projectDir, pushToast]
  )

  // Render the active route's workspace. Wrapped below in a
  // WorkspaceErrorBoundary so an uncaught render/lifecycle error in ONE
  // workspace shows a recoverable in-pane fallback (Try again / Reload app)
  // instead of white-screening the whole shell. The boundary is keyed on the
  // active route so switching workspaces resets a tripped boundary — a crash on
  // Manufacture must not leave the fallback showing once the operator navigates
  // to Design.
  const renderActiveWorkspace = (): ReactElement => {
    switch (active) {
    case 'design':
    case 'assemble':
    case 'drawings':
      return (
        <>
        {/* SCRIPT DISK PERSISTENCE — non-blocking restore offer for the
            write-ahead script crash snapshot. Restore/Discard are explicit
            user actions (never an effect — Cycle-249). */}
        {scriptRecoveryOffer !== null && (
          <div
            role="status"
            aria-live="polite"
            data-testid="design-script-recovery-banner"
            style={scriptBannerStyle}
          >
            <span>
              <strong>Unsaved CadQuery script recovered</strong> (autosaved{' '}
              {formatRecoverySavedAt(scriptRecoveryOffer.savedAtMs)}). Restore it?
            </span>
            <button
              type="button"
              data-testid="design-script-recovery-restore"
              style={scriptRestoreButtonStyle}
              onClick={handleScriptRecoveryRestore}
            >
              Restore
            </button>
            <button
              type="button"
              data-testid="design-script-recovery-discard"
              style={scriptDiscardButtonStyle}
              onClick={handleScriptRecoveryDiscard}
            >
              Discard
            </button>
          </div>
        )}
        <DesignSessionProvider projectDir={projectDir} onStatus={handleDesignStatus}>
          <DesignWorkspaceHost
            // Remount with the freshly-hydrated assembly seed when the route /
            // project changes (initialAssemblyParts/Mates are mount-only props).
            key={`design-${active}-${hydrateToken}`}
            initialScript={designScript}
            savedScript={designScript}
            initialViewMode={routeToViewMode(active)}
            initialAssemblyParts={assemblyParts}
            initialAssemblyMates={assemblyMates}
            onAssemblyPartsChange={handleAssemblyPartsChange}
            onSave={handleDesignScriptSave}
            onSendToCam={handleSendToCam}
            onMateAdded={handleMateAdded}
            onMateConstraintsChange={handleMateConstraintsChange}
            onToast={pushToast}
          />
        </DesignSessionProvider>
        </>
      )
    case 'manufacture':
      return <ManufactureHost />
    case 'workshop':
      return <WorkshopHost />
    case 'utilities':
      return <UtilitiesHost />
    default:
      return (
        <div className="wt-placeholder">
          <EmptyState title="Workspace" />
        </div>
      )
    }
  }

  return (
    <WorkspaceErrorBoundary key={active} label={workspaceLabel(active)}>
      {renderActiveWorkspace()}
    </WorkspaceErrorBoundary>
  )
}
