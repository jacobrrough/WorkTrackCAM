/**
 * UtilitiesHost — new-shell host for the Utilities surface.
 *
 * Mounts the existing, self-contained `LibraryView` (machines / tools /
 * materials / post-processors, each with import + export affordances).
 * It is the cleanest reusable utilities component in the renderer and
 * takes only two props, both sourced from shared contexts:
 *   - `onToast`          ← `useToast().pushToast` (signatures match:
 *                           `(kind, msg) => void` over `'ok'|'err'|'warn'`)
 *   - `onMachinesChanged` ← `useMachineSession().reloadMachines`, so an
 *                           import/edit/delete in the Library refreshes the
 *                           shared machine list the rest of the shell reads.
 *
 * No `any` types; the wrapper carries no inline styles (layout lives in
 * the `.wt-workspace-host` CSS class).
 */
import type { ReactElement } from 'react'
import { LibraryView } from '../src/LibraryView'
import { useMachineSession } from '../contexts/MachineSessionContext'
import { useToast } from '../contexts/ToastContext'

export function UtilitiesHost(): ReactElement {
  const { reloadMachines } = useMachineSession()
  const { pushToast } = useToast()

  return (
    <div className="wt-workspace-host">
      <LibraryView
        onToast={pushToast}
        onMachinesChanged={() => {
          void reloadMachines()
        }}
      />
    </div>
  )
}

export default UtilitiesHost
