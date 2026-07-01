/**
 * ViewportContextMenu — the right-click shortcut menu for the Design 3D
 * viewport (Fusion / SolidWorks muscle memory).
 *
 * Self-contained presentation + focus management:
 *   - Renders `role="menu"` with `role="menuitem"` buttons, positioned at the
 *     cursor anchor and CLAMPED to its positioned ancestor (the viewport
 *     pane), so the menu never spills outside the viewport bounds.
 *   - Focus moves INTO the menu on open (first entry), roves with
 *     ArrowUp/ArrowDown (wrapping) + Home/End, and the parent's `onClose` is
 *     expected to return focus to the viewport.
 *   - Closes on ESC, on Tab (WAI-ARIA menu pattern), on click-away
 *     (document-level `pointerdown` outside the menu), and after activating
 *     an entry (the parent closes in `onActivate`).
 *   - Disabled entries render greyed with `aria-disabled` and stay focusable
 *     (WAI-ARIA menu guidance) but never activate — the same "shows but
 *     greyed" honesty contract the ribbon uses.
 *
 * The menu is a pure VIEW: entry derivation lives in
 * `viewport-context-menu-items.ts`; dispatch lives in the parent
 * (`DesignWorkspace`). Token-based styling in `styles/workspace.css`
 * (`.viewport-context-menu*`).
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { JSX, KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { ViewportContextMenuEntry } from './viewport-context-menu-items'

/** Keep the clamped menu this many px inside the host pane's edges. */
const CLAMP_MARGIN_PX = 4

export interface ViewportContextMenuProps {
  /**
   * Cursor anchor in the coordinate space of the menu's positioned ancestor
   * (the viewport pane — `.design-workspace__viewport-col`).
   */
  readonly anchor: { readonly x: number; readonly y: number }
  /** Ordered entries from `deriveViewportContextMenuItems`. Never empty. */
  readonly entries: readonly ViewportContextMenuEntry[]
  /** An enabled entry was chosen. The parent dispatches AND closes the menu. */
  readonly onActivate: (entry: ViewportContextMenuEntry) => void
  /** Dismiss without activating (ESC / Tab / click-away). */
  readonly onClose: () => void
}

export function ViewportContextMenu({
  anchor,
  entries,
  onActivate,
  onClose
}: ViewportContextMenuProps): JSX.Element {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [activeIndex, setActiveIndex] = useState(0)
  /** Anchor, clamped to the offsetParent bounds after first measure. */
  const [position, setPosition] = useState<{ left: number; top: number }>({
    left: anchor.x,
    top: anchor.y
  })

  /* Clamp to the positioned ancestor so the menu stays inside the viewport
     pane even when opened near its right/bottom edge. Runs before paint. */
  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const host = menu.offsetParent
    if (!(host instanceof HTMLElement)) return
    const maxLeft = host.clientWidth - menu.offsetWidth - CLAMP_MARGIN_PX
    const maxTop = host.clientHeight - menu.offsetHeight - CLAMP_MARGIN_PX
    setPosition({
      left: Math.max(CLAMP_MARGIN_PX, Math.min(anchor.x, maxLeft)),
      top: Math.max(CLAMP_MARGIN_PX, Math.min(anchor.y, maxTop))
    })
  }, [anchor.x, anchor.y])

  /* Focus moves into the menu on open, then follows the roving index. */
  useEffect(() => {
    itemRefs.current[activeIndex]?.focus()
  }, [activeIndex])

  /* Click-away: any pointerdown outside the menu dismisses it. Registered on
     `document` so clicks on the canvas / other panes count. */
  useEffect(() => {
    const onDocPointerDown = (e: PointerEvent): void => {
      const menu = menuRef.current
      if (menu && e.target instanceof Node && menu.contains(e.target)) return
      onClose()
    }
    document.addEventListener('pointerdown', onDocPointerDown)
    return () => {
      document.removeEventListener('pointerdown', onDocPointerDown)
    }
  }, [onClose])

  const moveActive = useCallback(
    (delta: number): void => {
      setActiveIndex((prev) => {
        const count = entries.length
        if (count === 0) return prev
        return (prev + delta + count) % count
      })
    },
    [entries.length]
  )

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>): void => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          e.stopPropagation()
          moveActive(1)
          return
        case 'ArrowUp':
          e.preventDefault()
          e.stopPropagation()
          moveActive(-1)
          return
        case 'Home':
          e.preventDefault()
          e.stopPropagation()
          setActiveIndex(0)
          return
        case 'End':
          e.preventDefault()
          e.stopPropagation()
          setActiveIndex(Math.max(0, entries.length - 1))
          return
        case 'Escape':
          // stopPropagation keeps the workspace's document-level ESC handler
          // (clear selection) from ALSO firing on the same keystroke.
          e.preventDefault()
          e.stopPropagation()
          onClose()
          return
        case 'Tab':
          // WAI-ARIA menu pattern: Tab dismisses rather than tabbing within.
          e.preventDefault()
          e.stopPropagation()
          onClose()
          return
        default:
      }
    },
    [entries.length, moveActive, onClose]
  )

  return (
    <div
      ref={menuRef}
      className="viewport-context-menu"
      role="menu"
      aria-label="Viewport context menu"
      data-testid="viewport-context-menu"
      style={{ left: position.left, top: position.top }}
      onKeyDown={handleKeyDown}
      // A right-click ON the menu must not re-open the native menu either.
      onContextMenu={(e) => {
        e.preventDefault()
      }}
    >
      {entries.map((entry, index) => (
        <div key={entry.id} className="viewport-context-menu__row">
          {entry.separatorBefore && (
            <div role="separator" className="viewport-context-menu__separator" />
          )}
          <button
            ref={(el) => {
              itemRefs.current[index] = el
            }}
            type="button"
            role="menuitem"
            className="viewport-context-menu__item"
            data-testid={`viewport-context-menu-item-${entry.id}`}
            tabIndex={index === activeIndex ? 0 : -1}
            aria-disabled={entry.disabled || undefined}
            onPointerEnter={() => setActiveIndex(index)}
            onClick={() => {
              if (entry.disabled) return
              onActivate(entry)
            }}
          >
            {entry.label}
          </button>
        </div>
      ))}
    </div>
  )
}
