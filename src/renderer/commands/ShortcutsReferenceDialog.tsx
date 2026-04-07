import { useEffect } from 'react'
import { KeyboardShortcutsPanel } from './KeyboardShortcutsPanel'

type Props = {
  open: boolean
  onClose: () => void
}

export function ShortcutsReferenceDialog({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="shortcuts-reference-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="shortcuts-reference-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="keyboard-shortcuts-heading"
      >
        <div className="shortcuts-reference-head">
          <span className="shortcuts-reference-head-spacer" aria-hidden />
          <button type="button" className="secondary" onClick={onClose} autoFocus>
            Close
          </button>
        </div>
        <div className="shortcuts-reference-body">
          <KeyboardShortcutsPanel />
        </div>
      </div>
    </div>
  )
}
