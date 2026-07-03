/**
 * DesignWorkspace — Save affordance + Ctrl+S wiring (Wave 6 script-persist handoff).
 *
 * Two contracts protected here:
 *
 *   (A) RENDER PINS — the Save button reflects the on-disk truth via the new
 *       `savedScript` prop:
 *         - clean (savedScript === scriptText): DISABLED, label "Save",
 *           title "Script saved";
 *         - dirty (savedScript !== scriptText): ENABLED, label "● Save"
 *           (leading dot affordance), title "Save script (unsaved changes)";
 *         - the default `savedScript` is '' so a mount with a non-empty
 *           initialScript and NO savedScript reads dirty (nothing persisted yet).
 *
 *   (B) SOURCE PINS — the two behaviours the static renderer cannot fire:
 *         - `handleSave` no longer fires a LOCAL `toast('ok', 'Script saved.')`.
 *           The host's onSave (WorkspaceHost.handleDesignScriptSave) awaits the
 *           real disk write and fires the ONE honest outcome toast; a local
 *           optimistic toast here double-toasted against it. This is the
 *           NO-DOUBLE-TOAST pin.
 *         - the document-level Ctrl+S effect matches `matchesSaveProject`,
 *           preventDefaults, calls `handleSave`, and is gated so it fires from
 *           the script editor (`cad-editor-root`) OR any non-typable surface,
 *           but NOT from another typable field.
 *
 * Render pins use `renderToStaticMarkup` (the node-env idiom — the component
 * uses hooks + a WebGL viewport that cannot mount in node vitest). Source pins
 * read the component text directly (same idiom as AssemblyView.motion-playback).
 */

import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DesignWorkspace, STARTER_SCRIPT } from '../DesignWorkspace'

// window.fab shim (matches the sibling DesignWorkspace render-pin tests).
const g = globalThis as unknown as Record<string, unknown>
if (g['window'] === undefined) g['window'] = globalThis
if (g['fab'] === undefined) g['fab'] = { cad: {} }

/** The Save button's opening tag + label, sliced out of the full markup. */
function saveButtonMarkup(html: string): string {
  const idx = html.indexOf('data-testid="design-workspace-save"')
  expect(idx).toBeGreaterThan(-1)
  // Back up to the opening <button and forward through the closing </button>.
  const start = html.lastIndexOf('<button', idx)
  const end = html.indexOf('</button>', idx)
  return html.slice(start, end + '</button>'.length)
}

describe('DesignWorkspace — Save affordance (savedScript)', () => {
  it('clean: savedScript === scriptText → DISABLED "Save" with the saved title', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        savedScript: STARTER_SCRIPT,
        onSave: vi.fn()
      })
    )
    const btn = saveButtonMarkup(html)
    expect(btn).toContain('disabled')
    expect(btn).toContain('title="Script saved"')
    expect(btn).toContain('>Save</button>')
    // No dirty dot in the clean state.
    expect(btn).not.toContain('● Save')
  })

  it('dirty: savedScript !== scriptText → ENABLED "● Save" with the unsaved title', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        savedScript: '# a different, already-persisted script',
        onSave: vi.fn()
      })
    )
    const btn = saveButtonMarkup(html)
    expect(btn).not.toContain('disabled')
    expect(btn).toContain('title="Save script (unsaved changes)"')
    expect(btn).toContain('● Save')
  })

  it('default savedScript is "" → a mount with a non-empty script reads dirty', () => {
    const html = renderToStaticMarkup(
      // No savedScript prop at all → defaults to '' → differs from STARTER_SCRIPT.
      createElement(DesignWorkspace, { initialScript: STARTER_SCRIPT, onSave: vi.fn() })
    )
    const btn = saveButtonMarkup(html)
    expect(btn).not.toContain('disabled')
    expect(btn).toContain('● Save')
  })

  it('a persisted non-empty script that matches the buffer reads clean (nothing to save)', () => {
    // A non-whitespace script keeps the part view mounted (the empty-state
    // branch only owns a blank buffer); matching savedScript → clean + disabled.
    const script = 'result = cq.Workplane("XY").box(1, 1, 1)'
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: script,
        savedScript: script,
        onSave: vi.fn()
      })
    )
    const btn = saveButtonMarkup(html)
    expect(btn).toContain('disabled')
    expect(btn).toContain('>Save</button>')
  })
})

describe('DesignWorkspace — Save/Ctrl+S source wiring', () => {
  const SRC = readFileSync(join(__dirname, '..', 'DesignWorkspace.tsx'), 'utf-8')

  it('NO-DOUBLE-TOAST: handleSave does not fire a local "Script saved." toast', () => {
    // The host owns the honest disk-outcome toast; a local optimistic toast
    // here double-toasted. It must be gone from the whole component.
    expect(SRC).not.toContain("'Script saved.'")
    // Guard the handleSave body specifically: it calls onSave but no toast().
    const start = SRC.indexOf('const handleSave = useCallback')
    expect(start).toBeGreaterThan(-1)
    const body = SRC.slice(start, start + 400)
    expect(body).toContain('onSave(scriptText)')
    expect(body).not.toContain("toast('ok'")
  })

  it('the Ctrl+S effect matches the save chord, preventDefaults, and calls handleSave', () => {
    expect(SRC).toContain('matchesSaveProject')
    // Gated to the editor scope OR a non-typable surface.
    expect(SRC).toContain('cad-editor-root')
    expect(SRC).toContain('isTypableKeyboardTarget(target)')
    // The handler suppresses the browser save dialog and routes to handleSave.
    const evtStart = SRC.indexOf('if (!matchesSaveProject(e)) return')
    expect(evtStart).toBeGreaterThan(-1)
    const handler = SRC.slice(evtStart, evtStart + 400)
    expect(handler).toContain('e.preventDefault()')
    expect(handler).toContain('handleSave()')
  })

  it('the Ctrl+S effect binds only when onSave is wired', () => {
    // The effect early-returns without a save target so it never steals Ctrl+S
    // from the browser when the workspace mounts read-only (splash / SSR pins).
    const effIdx = SRC.indexOf('if (!matchesSaveProject(e)) return')
    // The guard sits just BEFORE the handler; the listener registration sits
    // just AFTER it — pin both around the effect body.
    const preamble = SRC.slice(effIdx - 300, effIdx)
    expect(preamble).toContain('if (!onSave) return')
    const tail = SRC.slice(effIdx, effIdx + 500)
    expect(tail).toContain("document.addEventListener('keydown', onKey)")
    expect(tail).toContain("document.removeEventListener('keydown', onKey)")
  })
})
