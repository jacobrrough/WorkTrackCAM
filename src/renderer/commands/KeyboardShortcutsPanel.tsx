import { APP_KEYBOARD_SHORTCUT_GROUPS } from '../../shared/app-keyboard-shortcuts'

/**
 * Keyboard shortcuts reference (Ctrl+Shift+? / ⌘⇧? opens as a dialog).
 */
export function KeyboardShortcutsPanel() {
  function openCommandPalette(): void {
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'k',
        ctrlKey: true,
        bubbles: true
      })
    )
  }

  return (
    <section className="panel workspace-util-panel keyboard-shortcuts-panel" aria-labelledby="keyboard-shortcuts-heading">
      <h2 id="keyboard-shortcuts-heading">Keyboard shortcuts</h2>
      <p className="msg util-panel-intro">
        Reference for <strong>app-level</strong> shortcuts. Modeling tools mostly use ribbon buttons; the command palette (
        <kbd className="kbd-chip">Ctrl+K</kbd> / <kbd className="kbd-chip">⌘K</kbd>) jumps to catalog entries that sync
        with Design when applicable.
      </p>
      <p className="msg keyboard-shortcuts-doc">
        Offline copy: <code>docs/KEYBOARD_SHORTCUTS.md</code> (kept in sync with{' '}
        <code>src/shared/app-keyboard-shortcuts.ts</code>).
      </p>
      <div className="row keyboard-shortcuts-actions" role="group" aria-label="Shortcut actions">
        <button type="button" className="secondary" onClick={openCommandPalette}>
          Open command palette (Ctrl+K / ⌘K)
        </button>
      </div>

      <h3 className="subh util-section-heading" id="keyboard-shortcuts-by-category-heading">
        By category
      </h3>
      <div
        className="keyboard-shortcuts-tables"
        role="region"
        aria-labelledby="keyboard-shortcuts-by-category-heading"
      >
        {APP_KEYBOARD_SHORTCUT_GROUPS.map((g) => (
          <div key={g.id} className="keyboard-shortcuts-group">
            <h4 className="keyboard-shortcuts-group-title">{g.title}</h4>
            <table className="keyboard-shortcuts-table" aria-label={`${g.title} shortcuts`}>
              <caption className="sr-only">
                {g.title} — keyboard shortcuts
              </caption>
              <thead>
                <tr>
                  <th scope="col">Action</th>
                  <th scope="col">Windows / Linux</th>
                  <th scope="col">macOS</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((row) => (
                  <tr key={row.action}>
                    <td>
                      {row.action}
                      {row.context ? <span className="keyboard-shortcuts-context"> — {row.context}</span> : null}
                    </td>
                    <td>
                      <kbd className="kbd-chip">{row.keysWin}</kbd>
                    </td>
                    <td>
                      <kbd className="kbd-chip">{row.keysMac}</kbd>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </section>
  )
}
