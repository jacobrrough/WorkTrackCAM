import { useCallback, useState } from 'react'
import type { ReactElement } from 'react'
import DesignWorkspace, { STARTER_SCRIPT } from '../design/DesignWorkspace'
import { EmptyState } from '../src/EmptyState'
import { useToast } from '../contexts/ToastContext'
import { WorkshopHost } from './WorkshopHost'
import { UtilitiesHost } from './UtilitiesHost'
import type { WorkspaceId } from './useWorkspaceRouter'

/**
 * Renders exactly one workspace for the active route.
 *
 * Design / Assemble / Drawings all resolve to the CAD `DesignWorkspace`, which
 * already hosts Part / Assembly / Drawing as internal tabs. Manufacture,
 * Workshop, and Utilities are EmptyState placeholders for now — they get wired
 * into the new shell in the next P3 increment (the legacy shell, still the
 * default build, retains full CAM until then).
 */
export function WorkspaceHost({
  active,
  onNavigate
}: {
  active: WorkspaceId
  onNavigate: (w: WorkspaceId) => void
}): ReactElement {
  const { pushToast } = useToast()
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
        <DesignWorkspace
          initialScript={designScript}
          onSave={(script) => {
            setDesignScript(script)
            pushToast('ok', 'Design script saved to session.')
          }}
          onSendToCam={handleSendToCam}
          onToast={pushToast}
        />
      )
    case 'manufacture':
      return (
        <div className="wt-placeholder">
          <EmptyState
            icon="🛠"
            title="Manufacture"
            body="The CAM workspace (toolpaths, slicing, simulation, post) is being wired into the new shell. The classic shell — still the default build — has full CAM until the next increment."
          />
        </div>
      )
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
