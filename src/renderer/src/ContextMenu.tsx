import React, { useEffect, useRef } from 'react'

export interface ContextMenuItem {
  id: string
  label: string
  icon?: string
  shortcut?: string
  danger?: boolean
  disabled?: boolean
  action: () => void
}

export interface ContextMenuSeparator {
  separator: true
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator

function isSeparator(e: ContextMenuEntry): e is ContextMenuSeparator {
  return 'separator' in e && e.separator
}

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuEntry[]
  onClose: () => void
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps): React.ReactElement {
  const menuRef = useRef<HTMLDivElement>(null)

  // Clamp position so the menu doesn't overflow the viewport
  useEffect(() => {
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    if (rect.right > vw) el.style.left = `${vw - rect.width - 4}px`
    if (rect.bottom > vh) el.style.top = `${vh - rect.height - 4}px`
  }, [x, y])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <>
      <div className="ctx-menu-overlay" onClick={onClose} onContextMenu={e => { e.preventDefault(); onClose() }} />
      <div
        ref={menuRef}
        className="ctx-menu"
        role="menu"
        style={{ left: x, top: y }}
      >
        {items.map((entry, i) => {
          if (isSeparator(entry)) {
            return <div key={`sep-${i}`} className="ctx-menu__sep" role="separator" />
          }
          const cls = [
            'ctx-menu__item',
            entry.danger ? 'ctx-menu__item--danger' : '',
            entry.disabled ? 'ctx-menu__item--disabled' : ''
          ].filter(Boolean).join(' ')
          return (
            <div
              key={entry.id}
              className={cls}
              role="menuitem"
              onClick={() => { entry.action(); onClose() }}
            >
              {entry.icon && <span className="ctx-menu__icon">{entry.icon}</span>}
              <span className="ctx-menu__label">{entry.label}</span>
              {entry.shortcut && <span className="ctx-menu__shortcut">{entry.shortcut}</span>}
            </div>
          )
        })}
      </div>
    </>
  )
}
