/**
 * Behavioral coverage for the keystroke -> undo/redo wiring in
 * `useUndo.ts`. The hook itself cannot be rendered without a React tree
 * (testing-library is not a project dep per [ID-0226]), so this file
 * exercises the matcher contract that the hook now consumes -- proving
 * that the Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z keystrokes the user issues do
 * route to `UndoManager.undo()` / `UndoManager.redo()` once paired with
 * `isTypableKeyboardTarget` (the same skip filter `useUndo` applies).
 *
 * Runs in the project default node environment -- no jsdom dependency
 * (the typable-target unit tests in `app-keyboard-shortcuts.test.ts`
 * cover the `isTypableKeyboardTarget` branch separately under node).
 *
 * Quick-win bundle (undo/redo + K2 thumbnail + Klipper header).
 */
import { describe, expect, it, vi } from 'vitest'
import {
  isTypableKeyboardTarget,
  matchesRedo,
  matchesUndo,
} from '../../shared/app-keyboard-shortcuts'
import {
  UndoManager,
  PropertyEditCommand,
} from './undo-manager'

/**
 * Re-implements the body of the `useUndo` keyboard handler so we can
 * exercise it end-to-end without booting React. If the production hook
 * changes its dispatch shape (e.g. drops a matcher), this file ALSO has
 * to change -- failure here is a flag that the keyboard wiring drifted.
 */
function makeHandler(mgr: UndoManager): (e: KeyboardEvent) => void {
  return (e) => {
    if (isTypableKeyboardTarget(e.target)) return
    if (matchesUndo(e)) {
      e.preventDefault()
      mgr.undo()
    } else if (matchesRedo(e)) {
      e.preventDefault()
      mgr.redo()
    }
  }
}

function makeKbEvent(opts: Partial<KeyboardEvent> & { key: string }): KeyboardEvent {
  return {
    key: opts.key,
    ctrlKey: opts.ctrlKey ?? false,
    metaKey: opts.metaKey ?? false,
    shiftKey: opts.shiftKey ?? false,
    altKey: opts.altKey ?? false,
    target: opts.target ?? null,
    preventDefault: opts.preventDefault ?? ((): void => undefined),
  } as unknown as KeyboardEvent
}

describe('useUndo keyboard wiring (quick-win bundle)', () => {
  it('Ctrl+Z keystroke routes to UndoManager.undo()', () => {
    const mgr = new UndoManager()
    let v = 0
    const target = { get: () => v, set: (x: number) => { v = x } }
    mgr.execute(new PropertyEditCommand(target, 0, 42, 'set v'))
    expect(v).toBe(42)
    const handler = makeHandler(mgr)
    const preventDefault = vi.fn()
    handler(makeKbEvent({ key: 'z', ctrlKey: true, preventDefault }))
    expect(v).toBe(0) // undo restored
    expect(preventDefault).toHaveBeenCalledOnce()
  })

  it('Cmd+Z keystroke (macOS) routes to UndoManager.undo()', () => {
    const mgr = new UndoManager()
    let v = 0
    const target = { get: () => v, set: (x: number) => { v = x } }
    mgr.execute(new PropertyEditCommand(target, 0, 99, 'set v'))
    const handler = makeHandler(mgr)
    handler(makeKbEvent({ key: 'z', metaKey: true }))
    expect(v).toBe(0)
  })

  it('Ctrl+Y keystroke routes to UndoManager.redo()', () => {
    const mgr = new UndoManager()
    let v = 0
    const target = { get: () => v, set: (x: number) => { v = x } }
    mgr.execute(new PropertyEditCommand(target, 0, 7, 'set v'))
    mgr.undo()
    expect(v).toBe(0)
    const handler = makeHandler(mgr)
    handler(makeKbEvent({ key: 'y', ctrlKey: true }))
    expect(v).toBe(7) // redo re-applied
  })

  it('Ctrl+Shift+Z keystroke also routes to UndoManager.redo() (alt redo binding)', () => {
    const mgr = new UndoManager()
    let v = 0
    const target = { get: () => v, set: (x: number) => { v = x } }
    mgr.execute(new PropertyEditCommand(target, 0, 7, 'set v'))
    mgr.undo()
    const handler = makeHandler(mgr)
    handler(makeKbEvent({ key: 'z', ctrlKey: true, shiftKey: true }))
    expect(v).toBe(7)
  })

  it('Ctrl+Z with null target still routes to undo (no typable element to skip)', () => {
    // Validates that the handler runs when the target is non-DOM (the
    // typable-skip is unit-tested separately in
    // src/shared/app-keyboard-shortcuts.test.ts where we cover
    // `isTypableKeyboardTarget(null)` and the `instanceof HTMLElement`
    // branches without booting jsdom).
    const mgr = new UndoManager()
    const undoSpy = vi.spyOn(mgr, 'undo')
    const handler = makeHandler(mgr)
    handler(makeKbEvent({ key: 'z', ctrlKey: true, target: null }))
    expect(undoSpy).toHaveBeenCalledOnce()
  })

  it('Ctrl+S (save) is NOT swallowed by the undo handler', () => {
    const mgr = new UndoManager()
    const undoSpy = vi.spyOn(mgr, 'undo')
    const redoSpy = vi.spyOn(mgr, 'redo')
    const handler = makeHandler(mgr)
    handler(makeKbEvent({ key: 's', ctrlKey: true }))
    expect(undoSpy).not.toHaveBeenCalled()
    expect(redoSpy).not.toHaveBeenCalled()
  })
})
