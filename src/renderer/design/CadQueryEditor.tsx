/**
 * CadQueryEditor — code editor pane for the parametric Design workspace
 * (BUILD 4, Cycle 233 CAD MVP).
 *
 * MVP intentionally uses a plain controlled `<textarea>` with the
 * monospace font tokens from `src/renderer/styles/tokens.css`. Full
 * syntax-highlighting (Monaco / CodeMirror) is deferred to v1 to keep
 * the Electron bundle size sane and avoid an Electron CSP fight.
 *
 * Contract (pinned by `CadQueryEditor.test.tsx`):
 *   1. The component is fully controlled: `value` flows in, `onChange`
 *      flows out. The editor never owns the script text -- the parent
 *      DesignWorkspace owns it and writes through to the active
 *      DesignModel on blur.
 *   2. `onRun` fires when the user clicks the Run button OR presses
 *      Ctrl+Enter / Cmd+Enter while focused in the textarea. This
 *      matches the keyboard-first muscle memory CAM operators expect.
 *   3. When `busy === true` the Run button is disabled and the
 *      textarea remains editable so the user can keep typing while
 *      the previous run is still in flight.
 *   4. Reuses the `.btn` + `.btn-primary` primitives from
 *      `src/renderer/styles/primitives.css` -- no custom button
 *      styling. The Spinner primitive renders inline next to the
 *      button label when busy so screen readers announce the
 *      progress state via the existing `role="status"` markup.
 *   5. `data-testid` attributes pin the interactive surfaces for the
 *      DesignWorkspace integration tests:
 *        - `cad-editor-textarea` -- the script `<textarea>`
 *        - `cad-editor-run`      -- the Run button
 *        - `cad-editor-root`     -- the root wrapper (lets callers
 *          scope-select the editor when multiple editors mount in a
 *          tabbed surface later).
 *
 * No `any` types, no inline styles -- all visuals come from the
 * existing `cad-editor*` classes in `src/renderer/styles/components.css`
 * (owned by Agent 6 / CSS agent). This component is pure presentation.
 */

import { type ChangeEvent, type JSX, type KeyboardEvent } from 'react'

export interface CadQueryEditorProps {
  /** Current script text. The editor is fully controlled. */
  readonly value: string
  /** Fires on every keystroke with the new full script body. */
  readonly onChange: (next: string) => void
  /**
   * Fires when the operator wants to execute the script -- either by
   * clicking the Run button or pressing Ctrl+Enter / Cmd+Enter inside
   * the textarea.
   */
  readonly onRun: () => void
  /**
   * True while a `cad.execute_script` call is in flight. Disables the
   * Run button (so the operator cannot fire a second request before
   * the first resolves) and surfaces an inline Spinner next to the
   * button label.
   */
  readonly busy: boolean
}

function isRunShortcut(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
  // Ctrl+Enter (Windows / Linux) or Cmd+Enter (mac). We deliberately
  // do NOT trigger on plain Enter -- this is a multi-line script
  // editor, Enter must insert a newline.
  if (event.key !== 'Enter') return false
  return event.ctrlKey || event.metaKey
}

export function CadQueryEditor(props: CadQueryEditorProps): JSX.Element {
  const { value, onChange, onRun, busy } = props

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    onChange(event.target.value)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (isRunShortcut(event)) {
      event.preventDefault()
      // Ctrl+Enter while a run is already in flight is a no-op so the
      // sidecar never sees two overlapping execute_script calls from
      // a single editor surface.
      if (!busy) onRun()
    }
  }

  return (
    <div
      className="cad-editor"
      data-testid="cad-editor-root"
      aria-busy={busy ? 'true' : 'false'}
    >
      <div className="cad-editor__toolbar">
        <button
          type="button"
          className="btn btn-primary"
          data-testid="cad-editor-run"
          onClick={onRun}
          disabled={busy}
          aria-label={busy ? 'Running script' : 'Run script'}
        >
          {busy ? 'Running…' : 'Run'}
        </button>
        <span className="cad-editor__hint" aria-hidden="true">
          Ctrl+Enter to run
        </span>
      </div>
      <textarea
        className="cad-editor__textarea"
        data-testid="cad-editor-textarea"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        // CadQuery scripts are Python; surface that to assistive tech
        // so screen readers can pick the right pronunciation profile.
        aria-label="CadQuery Python script"
      />
    </div>
  )
}

export default CadQueryEditor
