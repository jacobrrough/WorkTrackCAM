/**
 * WorkshopHost — new-shell host for the consolidated Workshop dashboard.
 *
 * Mounts the existing `WorkshopDashboard` (per-machine status, last
 * outcome, one quick action per machine) inside the WorkTrack3D shell.
 * Props are sourced from the shared contexts:
 *   - `currentMachineId` ← `useMachineSession().sessionMachine?.id`
 *   - quick-action handlers toast via `useToast().pushToast`
 *
 * The new shell has no CAM job list yet, so `jobs` is passed empty and
 * `moonrakerUrl` is `null`. With those inputs the dashboard renders its
 * own idle/empty cards gracefully (the K2 card simply skips the live
 * Moonraker poll when the URL is null, and the Laguna/Carvera cards fall
 * back to their job-derived idle state). Wiring live job data + the
 * configured Moonraker URL into this host is a follow-up increment.
 *
 * No `any` types; props are readonly; no inline styles (layout lives in
 * the `.wt-workspace-host` CSS class).
 */
import type { ReactElement } from 'react'
import type { Job } from '../src/shop-types'
import { WorkshopDashboard } from '../dashboard/WorkshopDashboard'
import { useMachineSession } from '../contexts/MachineSessionContext'
import { useToast } from '../contexts/ToastContext'

/** New shell has no CAM jobs yet — the dashboard renders its empty state. */
const NO_JOBS: readonly Job[] = []

export function WorkshopHost(): ReactElement {
  const { sessionMachine } = useMachineSession()
  const { pushToast } = useToast()

  return (
    <div className="wt-workspace-host">
      <WorkshopDashboard
        jobs={NO_JOBS}
        moonrakerUrl={null}
        currentMachineId={sessionMachine?.id ?? null}
        onSendLatestSlice={() => {
          // No CAM jobs exist in the new shell yet, so there is no slice
          // to route to the K2 send-to-printer flow. Point the operator
          // at the Manufacture workspace where slicing + Send live.
          pushToast('warn', 'Slice a job in Manufacture first, then Send it to the K2 Plus from there.')
        }}
        onOpenSetupSheet={() => {
          // Setup-sheet generation reads from an active CAM job; none
          // exist in the new shell yet.
          pushToast('warn', 'Open a job in Manufacture to generate its Laguna setup sheet.')
        }}
        onSendToCarvera={() => {
          // Carvera upload requires a connection-mode pick that lives in
          // the Makera CAM Manufacture panel — mirror the classic shell's
          // advisory rather than duplicating the picker here.
          pushToast(
            'warn',
            'Send to Carvera: open the Makera CAM environment → Manufacture → CAM panel to pick the connection (auto / wifi / usb) and upload.'
          )
        }}
      />
    </div>
  )
}

export default WorkshopHost
