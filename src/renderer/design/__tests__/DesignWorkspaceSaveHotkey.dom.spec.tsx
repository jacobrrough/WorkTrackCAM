/**
 * Design workspace Ctrl+S save gate — INTERACTIVE behaviour spec (happy-dom).
 *
 * The full DesignWorkspace cannot mount in happy-dom (it renders a WebGL
 * Viewport3D + a Monaco editor, neither of which happy-dom provides), so — like
 * the BoxSelect / EdgePick DOM specs — this harness reproduces the EXACT
 * document-level Ctrl+S effect the component installs (source-pinned identical
 * in DesignWorkspace.save-affordance.test.tsx) around the REAL matcher +
 * typable-gate helpers. It proves the decision boundary that only a real DOM
 * dispatching real keyboard events can exercise:
 *   - Ctrl+S from a non-typable surface saves;
 *   - Ctrl+S from inside the script editor (`cad-editor-root`) saves;
 *   - Ctrl+S from ANOTHER typable field (a parameter input) does NOT save;
 *   - the handler calls preventDefault so the browser save dialog is suppressed;
 *   - save routes through onSave exactly once (no double-fire).
 *
 * Run with `npm run test:dom` or
 * `npx vitest run --config vitest.dom.config.ts <this file>`.
 */

import { useEffect, useRef } from 'react'
import type { JSX } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  isTypableKeyboardTarget,
  matchesSaveProject
} from '../../../shared/app-keyboard-shortcuts'

/**
 * The harness mirrors DesignWorkspace's Ctrl+S effect 1:1: a document-level
 * keydown listener that fires `onSave` when the chord matches AND the target is
 * either non-typable or inside the script editor. The editor stand-in carries
 * the real `cad-editor-root` testid (a plain textarea — no Monaco needed to
 * exercise the `.closest()` scope check).
 */
function Harness({ onSave }: { onSave: () => void }): JSX.Element {
  const savedRef = useRef(onSave)
  savedRef.current = onSave
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!matchesSaveProject(e)) return
      const target = e.target
      const inEditor =
        target instanceof HTMLElement &&
        target.closest('[data-testid="cad-editor-root"]') !== null
      if (isTypableKeyboardTarget(target) && !inEditor) return
      e.preventDefault()
      savedRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div>
      <div data-testid="viewport" tabIndex={-1}>
        viewport (non-typable)
      </div>
      <div data-testid="cad-editor-root">
        <textarea data-testid="editor-textarea" defaultValue="script" />
      </div>
      <input data-testid="param-input" defaultValue="10" />
    </div>
  )
}

function pressCtrlS(el: HTMLElement): boolean {
  return fireEvent.keyDown(el, { key: 's', ctrlKey: true })
}

describe('Design Ctrl+S save gate (happy-dom)', () => {
  it('saves from a non-typable surface (the viewport)', () => {
    const onSave = vi.fn()
    render(<Harness onSave={onSave} />)
    pressCtrlS(screen.getByTestId('viewport'))
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('saves from inside the script editor (cad-editor-root scope)', () => {
    const onSave = vi.fn()
    render(<Harness onSave={onSave} />)
    // The textarea IS typable, but it sits inside cad-editor-root → saves.
    pressCtrlS(screen.getByTestId('editor-textarea'))
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('does NOT save from another typable field (a parameter input)', () => {
    const onSave = vi.fn()
    render(<Harness onSave={onSave} />)
    pressCtrlS(screen.getByTestId('param-input'))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('suppresses the browser save dialog (preventDefault) and fires exactly once', () => {
    const onSave = vi.fn()
    render(<Harness onSave={onSave} />)
    // fireEvent returns false when a handler called preventDefault.
    const notDefaulted = pressCtrlS(screen.getByTestId('viewport'))
    expect(notDefaulted).toBe(false)
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('ignores a bare S and Ctrl+Shift+S (only the plain save chord matches)', () => {
    const onSave = vi.fn()
    render(<Harness onSave={onSave} />)
    fireEvent.keyDown(screen.getByTestId('viewport'), { key: 's' })
    fireEvent.keyDown(screen.getByTestId('viewport'), { key: 's', ctrlKey: true, shiftKey: true })
    expect(onSave).not.toHaveBeenCalled()
  })
})
