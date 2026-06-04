import type { ReactElement } from 'react'
import DesignWorkspace from '../design/DesignWorkspace'
import { useDesignSession } from '../design/DesignSessionContext'
import type { CadExecuteScriptMesh } from '../../shared/sidecar-protocol'

/**
 * Bridge between the new-shell `WorkspaceHost` and the prop-driven
 * `DesignWorkspace`.
 *
 * This is the ONLY new-shell code that reads `useDesignSession()`. It must be
 * rendered INSIDE a `DesignSessionProvider` (WorkspaceHost mounts that around
 * the `design`/`assemble`/`drawings` route). Keeping the `useDesignSession()`
 * call here — rather than inside `DesignWorkspace` — preserves DesignWorkspace
 * as a pure, provider-less component so the legacy ShopApp path, the splash
 * preview, and every existing render-pin test keep rendering it without a
 * context (the additive/backward-compat rule).
 *
 * It threads the session's editable kernel-op timeline (`features.kernelOps` +
 * the reorder / move / suppress / roll-back handlers) into DesignWorkspace,
 * which forwards them to the FeatureTree's KernelTimeline. When no project is
 * open the provider is inert (`projectDir == null` -> `features == null`), so
 * `kernelOps` is `undefined` and the timeline simply does not render — exactly
 * the required "timeline just doesn't show" fallback.
 */
export function DesignWorkspaceHost({
  initialScript,
  onSave,
  onSendToCam,
  onToast
}: {
  readonly initialScript: string
  readonly onSave: (script: string) => void
  readonly onSendToCam: (payload: { readonly stlPath: string; readonly mesh: CadExecuteScriptMesh }) => void
  readonly onToast: (kind: 'ok' | 'err' | 'warn', message: string) => void
}): ReactElement {
  const session = useDesignSession()

  return (
    <DesignWorkspace
      initialScript={initialScript}
      onSave={onSave}
      onSendToCam={onSendToCam}
      onToast={onToast}
      kernelOps={session.features?.kernelOps}
      rolledBackTo={session.features?.rolledBackTo}
      onKernelMove={(index, delta) => {
        void session.moveKernelOp(index, delta)
      }}
      onKernelReorder={(from, to) => {
        void session.reorderKernelOps(from, to)
      }}
      onKernelSuppressToggle={(index, suppressed) => {
        void session.setKernelOpSuppressedAt(index, suppressed)
      }}
      onKernelSetRollback={(index) => {
        void session.setKernelRollbackMarker(index)
      }}
      onKernelClearRollback={() => {
        void session.setKernelRollbackMarker(null)
      }}
    />
  )
}

export default DesignWorkspaceHost
