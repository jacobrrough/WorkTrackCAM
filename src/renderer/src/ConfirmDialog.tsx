import React, { useEffect } from 'react'
import { useFocusTrap } from './useFocusTrap'

export type ConfirmDialogProps = {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  /** Optional middle button (e.g. "Don't Save" in save/don't-save/cancel flows). */
  secondaryLabel?: string
  onSecondary?: () => void
  /** When true, the confirm button uses danger styling (red). */
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  secondaryLabel,
  onSecondary,
  danger = false,
  onConfirm,
  onCancel
}: ConfirmDialogProps): React.ReactElement | null {
  const trapRef = useFocusTrap<HTMLDivElement>()

  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-dialog modal-dialog--sm" ref={trapRef}>
        <div className="modal-header">
          <span className="modal-header-title">{title}</span>
        </div>
        <div className="modal-body">
          <p style={{ margin: 0, whiteSpace: 'pre-line' }}>{message}</p>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onCancel}>
            {cancelLabel}
          </button>
          {secondaryLabel && onSecondary && (
            <button className="btn" onClick={onSecondary}>
              {secondaryLabel}
            </button>
          )}
          <button
            className={danger ? 'btn btn-danger' : 'btn btn-primary'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
