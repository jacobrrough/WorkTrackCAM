/**
 * KeyboardShortcutsDialog -- WorkTrack3D
 *
 * Keyboard Shortcuts Reference Dialog. Extracted from ShopApp so that multiple
 * shells can share the same modal. Pure presentation: renders the shared
 * APP_KEYBOARD_SHORTCUT_GROUPS table inside a focus-trapped modal overlay.
 */
import React from 'react'
import { APP_KEYBOARD_SHORTCUT_GROUPS } from '../../shared/app-keyboard-shortcuts'
import { useFocusTrap } from './useFocusTrap'

// ── Keyboard Shortcuts Reference Dialog ──────────────────────────────────────
export function KeyboardShortcutsDialog({ onClose }: { onClose: () => void }): React.ReactElement {
  const trapRef = useFocusTrap<HTMLDivElement>()
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" onClick={onClose}>
      <div ref={trapRef} className="modal-dialog modal-dialog--md shortcuts-dialog" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span id="shortcuts-title" className="modal-title">Keyboard Shortcuts</span>
          <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={onClose} aria-label="Close">{'\u2715'}</button>
        </div>
        <div className="modal-body shortcuts-dialog__body">
          {APP_KEYBOARD_SHORTCUT_GROUPS.map(group => (
            <section key={group.id} className="shortcuts-group">
              <h3 className="shortcuts-group__title">{group.title}</h3>
              <table className="shortcuts-table">
                <tbody>
                  {group.rows.map((row, i) => (
                    <tr key={i} className="shortcuts-table__row">
                      <td className="shortcuts-table__action">{row.action}</td>
                      <td className="shortcuts-table__keys">
                        <kbd className="shortcuts-kbd">{row.keysWin}</kbd>
                      </td>
                      {row.context && (
                        <td className="shortcuts-table__context">{row.context}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
