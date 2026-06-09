import { useCallback, useState } from 'react'
import type { ReactElement } from 'react'
import { STARTER_SCRIPT, type DesignViewMode } from '../design/DesignWorkspace'
import { DesignSessionProvider } from '../design/DesignSessionContext'
import { DesignWorkspaceHost } from './DesignWorkspaceHost'
import { EmptyState } from '../src/EmptyState'
import { useToast } from '../contexts/ToastContext'
import { useProjectSession } from './useProjectSession'
import { useMachineSession } from '../contexts/MachineSessionContext'
import { useCamHandoff } from './CamHandoffContext'
import { fab } from '../src/shop-types'
import { runSendToCam, runPersistMate } from './workspace-host-handoff'
import { WorkshopHost } from './WorkshopHost'
import { UtilitiesHost } from './UtilitiesHost'
import { ManufactureHost } from './ManufactureHost'
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

export function WorkspaceHost({
  active,
  onNavigate
}: {
  active: WorkspaceId
  onNavigate: (w: WorkspaceId) => void
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
      void (async () => {
        const outcome = await runPersistMate({
          mate,
          projectDir,
          loadAssembly: (dir) => fab().assemblyLoad(dir),
          saveAssembly: (dir, json) => fab().assemblySave(dir, json)
        })
        pushToast(outcome.toast.kind, outcome.toast.message)
      })()
    },
    [projectDir, pushToast]
  )

  switch (active) {
    case 'design':
    case 'assemble':
    case 'drawings':
      return (
        <DesignSessionProvider projectDir={projectDir} onStatus={(m) => pushToast('ok', m)}>
          <DesignWorkspaceHost
            initialScript={designScript}
            initialViewMode={routeToViewMode(active)}
            onSave={(script) => {
              setDesignScript(script)
              pushToast('ok', 'Design script saved to session.')
            }}
            onSendToCam={handleSendToCam}
            onMateAdded={handleMateAdded}
            onToast={pushToast}
          />
        </DesignSessionProvider>
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
