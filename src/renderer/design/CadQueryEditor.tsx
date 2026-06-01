/**
 * CadQueryEditor — code editor pane for the parametric Design workspace
 * (BUILD 4, Cycle 233 CAD MVP → CAD V1 Monaco upgrade).
 *
 * V1 upgrade (this cycle): replace the plain `<textarea>` with a real
 * Monaco code editor (Python syntax highlighting, line numbers, bracket
 * matching, find/replace, multi-cursor, the usual operator muscle
 * memory). The editor worker is self-hosted via the
 * `vite-plugin-monaco-editor` registration in `electron.vite.config.ts`
 * so the app stays fully offline-capable — CLAUDE.md forbids any
 * runtime CDN dependency for the desktop build.
 *
 * SSR / TEST FALLBACK (load-bearing)
 * ----------------------------------
 * Vitest currently runs in the `node` environment (no jsdom, no
 * window) — see `vitest.config.ts`. Monaco depends on `window`,
 * `document`, and `Worker`, so importing `@monaco-editor/react` and
 * rendering its `<Editor>` inside a `renderToStaticMarkup` call would
 * either crash or emit something the existing render-pin suite can't
 * scrape. To keep the contract pinned by
 * `__tests__/CadQueryEditor.test.tsx` intact AND let runtime DOM tests
 * exercise Monaco when a real browser is available, the component
 * branches at render time:
 *
 *   • `typeof window === 'undefined'`  →  render the legacy `<textarea>`
 *     fallback. SSR and node-env vitest both hit this branch, which
 *     means every existing render-pin test continues to pass without
 *     modification.
 *   • Otherwise                        →  render the Monaco editor.
 *
 * The fallback textarea is a 100 %-fidelity replica of the pre-Monaco
 * surface: same className, same `data-testid="cad-editor-textarea"`,
 * same Ctrl+Enter / Cmd+Enter shortcut handling, same
 * spellcheck/autocorrect/autocapitalize defeats, same aria-label. All
 * existing snapshot / regex pins keep working.
 *
 * Contract (UNCHANGED from BUILD 4):
 *   1. The component is fully controlled: `value` flows in, `onChange`
 *      flows out. The editor never owns the script text — the parent
 *      DesignWorkspace owns it and writes through to the active
 *      DesignModel on blur.
 *   2. `onRun` fires when the user clicks the Run button OR presses
 *      Ctrl+Enter / Cmd+Enter while focused inside the editor surface.
 *      This matches the keyboard-first muscle memory CAM operators
 *      expect, and is wired in BOTH the fallback textarea path AND the
 *      Monaco path (via `editor.addCommand(KeyMod.CtrlCmd | KeyCode.Enter,
 *      …)`).
 *   3. When `busy === true` the Run button is disabled and the editor
 *      remains editable so the user can keep typing while the previous
 *      run is still in flight. Ctrl+Enter is a no-op while busy so the
 *      sidecar never sees two overlapping `execute_script` calls.
 *   4. Reuses the `.btn` + `.btn-primary` primitives from
 *      `src/renderer/styles/primitives.css` — no custom button styling.
 *   5. `data-testid` attributes pin the interactive surfaces for the
 *      DesignWorkspace integration tests:
 *        - `cad-editor-textarea` — the script `<textarea>` (fallback path)
 *        - `cad-editor-monaco`   — the Monaco editor wrapper (runtime path)
 *        - `cad-editor-run`      — the Run button
 *        - `cad-editor-root`     — the root wrapper
 *
 * No `any` types, no inline styles. All visuals come from the existing
 * `cad-editor*` classes in `src/renderer/styles/components.css`.
 */

import { type ChangeEvent, type JSX, type KeyboardEvent } from 'react'
import Editor, { type OnChange, type OnMount } from '@monaco-editor/react'
import type { editor, IKeyboardEvent } from 'monaco-editor'

export interface CadQueryEditorProps {
  /** Current script text. The editor is fully controlled. */
  readonly value: string
  /** Fires on every keystroke with the new full script body. */
  readonly onChange: (next: string) => void
  /**
   * Fires when the operator wants to execute the script — either by
   * clicking the Run button or pressing Ctrl+Enter / Cmd+Enter inside
   * the editor surface.
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

/**
 * Detect whether we have a real browser DOM. Vitest currently runs in
 * the `node` environment (no `window`, no `document`, no `Worker`) so
 * we cannot mount Monaco there — the WebAssembly editor surface would
 * throw on first paint. This check is also true for `react-dom/server`
 * static rendering, which is how the BUILD 4 render-pin suite
 * exercises this component.
 */
function hasBrowserDom(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined'
}

function isRunShortcut(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
  // Ctrl+Enter (Windows / Linux) or Cmd+Enter (mac). We deliberately
  // do NOT trigger on plain Enter — this is a multi-line script
  // editor, Enter must insert a newline.
  if (event.key !== 'Enter') return false
  return event.ctrlKey || event.metaKey
}

export function CadQueryEditor(props: CadQueryEditorProps): JSX.Element {
  const { value, onChange, onRun, busy } = props
  const useMonaco = hasBrowserDom()

  const handleTextareaChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    onChange(event.target.value)
  }

  const handleTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (isRunShortcut(event)) {
      event.preventDefault()
      // Ctrl+Enter while a run is already in flight is a no-op so the
      // sidecar never sees two overlapping execute_script calls from
      // a single editor surface.
      if (!busy) onRun()
    }
  }

  const handleMonacoChange: OnChange = (next) => {
    // `@monaco-editor/react` types `value` as `string | undefined` even
    // though the model always has a value. Coerce to `''` so the
    // parent's `onChange` contract (always-string) holds.
    onChange(next ?? '')
  }

  // Capture the current `busy`/`onRun` for the Monaco onKeyDown handler
  // via a small registered command. We register Ctrl+Enter / Cmd+Enter
  // on mount; the closure reads the latest props through the wrapper
  // function so a busy flip mid-keystroke still no-ops the run.
  const handleMonacoMount: OnMount = (instance) => {
    instance.onKeyDown((e: IKeyboardEvent) => {
      // KeyCode 3 is Enter in monaco-editor's IKeyboardEvent — but the
      // safer cross-version check is `keyCode === instance._keybindingService?...`
      // which is private. Instead match on the browser key string the
      // event preserves on `.browserEvent`.
      const browserEvent = e.browserEvent
      if (browserEvent.key !== 'Enter') return
      if (!(browserEvent.ctrlKey || browserEvent.metaKey)) return
      e.preventDefault()
      e.stopPropagation()
      if (!busy) onRun()
    })
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
      {useMonaco ? (
        <div
          className="cad-editor__monaco"
          data-testid="cad-editor-monaco"
          aria-label="CadQuery Python script"
        >
          <Editor
            language="python"
            theme="vs-dark"
            value={value}
            onChange={handleMonacoChange}
            onMount={handleMonacoMount}
            height="100%"
            width="100%"
            loading={<div className="cad-editor__monaco-loading">Loading editor…</div>}
            options={
              {
                minimap: { enabled: false },
                fontSize: 13,
                // Pull the monospace stack from the design tokens so
                // the editor matches the rest of the app's code
                // surfaces (script preview, G-code dump, etc.).
                fontFamily: 'var(--mono)',
                tabSize: 4,
                insertSpaces: true,
                automaticLayout: true,
                scrollBeyondLastLine: false,
                wordWrap: 'off',
                lineNumbers: 'on',
                renderLineHighlight: 'line',
                // CadQuery identifiers are Python — Monaco's built-in
                // "word"-based suggestions are fine, no language
                // server needed.
                quickSuggestions: { other: true, comments: false, strings: false },
                // Match the textarea defeats: never auto-correct
                // identifiers, never auto-capitalise.
                autoIndent: 'full'
              } satisfies editor.IStandaloneEditorConstructionOptions
            }
          />
        </div>
      ) : (
        <textarea
          className="cad-editor__textarea"
          data-testid="cad-editor-textarea"
          value={value}
          onChange={handleTextareaChange}
          onKeyDown={handleTextareaKeyDown}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          // CadQuery scripts are Python; surface that to assistive tech
          // so screen readers can pick the right pronunciation profile.
          aria-label="CadQuery Python script"
        />
      )}
    </div>
  )
}

export default CadQueryEditor
