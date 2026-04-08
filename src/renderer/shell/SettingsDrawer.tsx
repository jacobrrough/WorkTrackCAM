import { Suspense, lazy, useEffect, type ReactElement } from 'react'

const SettingsView = lazy(() =>
  import('../src/SettingsView').then((m) => ({ default: m.SettingsView }))
)

type Props = {
  open: boolean
  onClose: () => void
  onToast: (kind: 'ok' | 'err' | 'warn', msg: string) => void
}

export function SettingsDrawer({ open, onClose, onToast }: Props): ReactElement | null {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside
        className="drawer drawer--right"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
      >
        <div className="drawer__header">
          <h2 className="drawer__title">Settings</h2>
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
          <Suspense fallback={
            <div className="p-16" aria-live="polite" aria-busy="true">
              <div className="skeleton skeleton--title" />
              <div className="skeleton skeleton--row" />
              <div className="skeleton skeleton--row" />
              <div className="skeleton skeleton--row" />
              <div className="skeleton skeleton--card" />
              <span className="sr-only">Loading settings</span>
            </div>
          }>
            <SettingsView onToast={onToast} />
          </Suspense>
        </div>
      </aside>
    </div>
  )
}
