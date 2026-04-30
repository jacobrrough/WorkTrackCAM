/**
 * MyShopDrawer — slide-over wrapper around `MyShopPanel` for use as a
 * first-class "My Shop" tab surface in the brand bar. Mirrors
 * `LibraryDrawer` / `SettingsDrawer` so ShopApp can host it with the same
 * open/close plumbing.
 *
 * Parent wires `onLaunchPreset` to its existing `resolveQuickSwitchMachine`
 * + session-switch path so presets honour the same variant-memory /
 * missing-machine rules the brand-bar env buttons use.
 */
import { useEffect, useRef, type ReactElement } from 'react'
import type { MachineProfile } from '../../shared/machine-schema'
import { MyShopPanel } from '../src/environments/MyShopPanel'
import type {
  MyShopMachineId,
  MyShopPreset
} from '../src/environments/my-shop-presets'

type Props = {
  open: boolean
  onClose: () => void
  machines: readonly MachineProfile[]
  currentMachineId: string | null
  onLaunchPreset: (preset: MyShopPreset) => void
  onInstallMachine: (machineId: MyShopMachineId) => void
}

export function MyShopDrawer({
  open,
  onClose,
  machines,
  currentMachineId,
  onLaunchPreset,
  onInstallMachine
}: Props): ReactElement | null {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  // Wrap the parent's launch callback so the drawer auto-closes after a
  // preset is picked — matches the "brand-bar env button" UX where
  // clicking a control switches context and hides the overlay.
  const handleLaunchPreset = (preset: MyShopPreset): void => {
    onLaunchPreset(preset)
    onClose()
  }

  const handleInstallMachine = (machineId: MyShopMachineId): void => {
    onInstallMachine(machineId)
    onClose()
  }

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside
        ref={ref}
        className="drawer drawer--right"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="My Shop"
      >
        <div className="drawer__header">
          <h2 className="drawer__title">My Shop</h2>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon"
            onClick={onClose}
            aria-label="Close"
          >
            {'\u2715'}
          </button>
        </div>
        <div className="drawer__body">
          <MyShopPanel
            machines={machines}
            currentMachineId={currentMachineId}
            onLaunchPreset={handleLaunchPreset}
            onInstallMachine={handleInstallMachine}
          />
        </div>
      </aside>
    </div>
  )
}
