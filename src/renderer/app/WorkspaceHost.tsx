import { useCallback, useState } from 'react'
import type { ReactElement } from 'react'
import { STARTER_SCRIPT, type DesignViewMode } from '../design/DesignWorkspace'
import { DesignSessionProvider } from '../design/DesignSessionContext'
import { DesignWorkspaceHost } from './DesignWorkspaceHost'
import { EmptyState } from '../src/EmptyState'
import { useToast } from '../contexts/ToastContext'
import { useProjectSession } from './useProjectSession'
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
 * instead of always opening on the Part editor. Manufacture, Workshop, and
 * Utilities are EmptyState placeholders for now — they get wired into the new
 * shell in the next P3 increment (the legacy shell, still the default build,
 * retains full CAM until then).
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
  const [designScript, setDesignScript] = useState<string>(STARTER_SCRIPT)

  const handleSendToCam = useCallback(
    (_payload: { stlPath: string }): void => {
      pushToast('ok', 'Design exported. Wiring the CAM hand-off into the new shell is in progress.')
      onNavigate('manufacture')
    },
    [pushToast, onNavigate]
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
            onMateAdded={(mate) => {
              // V1: acknowledge the solved mate. Durable persistence into the
              // assembly's Model-C `mateConstraints` (assembly.json) is the
              // explicit follow-up — see DesignWorkspace.onMateAdded.
              pushToast('ok', `Mate solved (${mate.draft.kind}). Saving mates to the project is coming next.`)
            }}
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
