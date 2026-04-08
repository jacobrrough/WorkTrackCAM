import { Suspense, lazy, useEffect, useRef, type ReactElement } from 'react'

const LibraryView = lazy(() =>
  import('../src/LibraryView').then((m) => ({ default: m.LibraryView }))
)

type Props = {
  open: boolean
  onClose: () => void
  onToast: (kind: 'ok' | 'err' | 'warn', msg: string) => void
  onMachinesChanged: () => void
}

export function LibraryDrawer({ open, onClose, onToast, onMachinesChanged }: Props): ReactElement | null {
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

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside
        ref={ref}
        className="drawer drawer--right drawer--open"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Library"
      >
        <div className="drawer__header">
          <h2 className="drawer__title">Library</h2>
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
              <div className="skeleton skeleton--text" style={{ width: '80%' }} />
              <div className="skeleton skeleton--card" />
              <div className="skeleton skeleton--row" />
              <div className="skeleton skeleton--row" />
              <div className="skeleton skeleton--row" />
              <span className="sr-only">Loading library</span>
            </div>
          }>
            <LibraryView onToast={onToast} onMachinesChanged={onMachinesChanged} />
          </Suspense>
        </div>
      </aside>
    </div>
  )
}
