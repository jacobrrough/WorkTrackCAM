import type { ReactElement } from 'react'
import type { WorkspaceId } from './useWorkspaceRouter'

const WORKSPACE_LABEL: Record<WorkspaceId, string> = {
  design: 'Design',
  assemble: 'Assemble',
  manufacture: 'Manufacture',
  drawings: 'Drawings',
  workshop: 'Workshop',
  utilities: 'Utilities'
}

export function StatusBar({
  machineName,
  units,
  activeWorkspace
}: {
  machineName: string | null
  units: 'mm' | 'inch'
  activeWorkspace: WorkspaceId
}): ReactElement {
  return (
    <footer className="wt-status" role="contentinfo">
      <span className="wt-status__item">
        <span className="wt-status__dot wt-status__dot--ok" />
        Sidecar <b>ready</b>
      </span>
      <span className="wt-status__item">
        Units <b>{units}</b>
      </span>
      <span className="wt-status__item">
        Workspace <b>{WORKSPACE_LABEL[activeWorkspace]}</b>
      </span>
      <span className="wt-status__spacer" />
      <span className="wt-status__item">
        X <b>0.00</b>
      </span>
      <span className="wt-status__item">
        Y <b>0.00</b>
      </span>
      <span className="wt-status__item">
        Z <b>0.00</b>
      </span>
      <span className="wt-status__item wt-status__item--machine">{machineName ?? 'No machine'}</span>
    </footer>
  )
}
