/**
 * Modal — centered dialog rendered through a portal on `document.body`.
 *
 * Because it portals out of the app subtree, it re-establishes the `.ds` scope
 * on its own wrapper so the `.ds-*` recipes + `--c-*` tokens still apply. The
 * tokens inherit from `<html data-theme>` (the app's single source of truth), so
 * unlike upstream — which re-read theme context and stamped data-theme itself —
 * this port needs no theme context at all.
 *
 * Faithful to the upstream behaviour: Esc-to-close and overlay-click-to-close
 * are both opt-outable. The dialog surface is a `.ds-card`.
 */
import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cx } from './cx'

export interface ModalProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  /** id of the element that labels the dialog (`aria-labelledby`). */
  labelledBy?: string
  /** Close when the backdrop is clicked (default true). */
  closeOnOverlay?: boolean
  /** Close when Escape is pressed (default true). */
  closeOnEsc?: boolean
  /** Extra classes on the dialog card. */
  className?: string
}

export function Modal({
  open,
  onClose,
  children,
  labelledBy,
  closeOnOverlay = true,
  closeOnEsc = true,
  className
}: ModalProps): React.ReactPortal | null {
  useEffect(() => {
    if (!open || !closeOnEsc) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, closeOnEsc, onClose])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div className="ds">
      <div
        className="ds-modal-backdrop"
        style={{ zIndex: 100, padding: '1rem' }}
        onClick={closeOnOverlay ? onClose : undefined}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelledBy}
          className={cx('ds-card', className)}
          style={{ width: '100%', maxWidth: '28rem', padding: '1.25rem' }}
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body
  )
}

export default Modal
