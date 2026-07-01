/**
 * AppShell command-keybinding live-seam — behavioral + source-pin.
 *
 * The renderer suite runs under the `node` vitest env (no jsdom), so mounting
 * the full shell provider chain and dispatching real DOM keyboard events is
 * impractical (mirrors the AppShell.nav-guard source-pin rationale). Instead the
 * dispatch DECISION is extracted into two pure, exported helpers —
 * {@link isReservedShellKey} + {@link decideCommandKeybinding} — which encode the
 * load-bearing guards. This file exercises those directly (no DOM), plus pins
 * that AppShell actually mounts the `ShellCommandKeybindings` bridge under the
 * command provider.
 *
 * Load-bearing invariant proven here: Ctrl+K (the ONLY command that declares a
 * keybinding today) is a reserved shell key, so the command layer NEVER
 * dispatches it — the palette toggle fires exactly once via AppShellBody's own
 * `onKey`. The seam is otherwise live: a non-reserved key, when not typing and
 * with the palette closed, reaches `dispatchKeybinding(e, ctx)`.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { decideCommandKeybinding, isReservedShellKey } from '../AppShell'

const SRC = readFileSync(join(__dirname, '..', 'AppShell.tsx'), 'utf-8')

/** Minimal KeyboardEvent stub (node env has no real KeyboardEvent ctor we need). */
const ev = (o: Partial<KeyboardEvent>): KeyboardEvent =>
  ({ ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, key: '', ...o }) as KeyboardEvent

describe('isReservedShellKey — keys the shell owns (no double-fire)', () => {
  it('treats Ctrl+K (command palette toggle) as reserved', () => {
    expect(isReservedShellKey(ev({ key: 'k', ctrlKey: true }))).toBe(true)
    // ⌘K on mac is the same reserved gesture.
    expect(isReservedShellKey(ev({ key: 'k', metaKey: true }))).toBe(true)
  })

  it('treats Ctrl+Shift+? (shortcuts reference), F1, and Escape as reserved', () => {
    expect(isReservedShellKey(ev({ key: '?', ctrlKey: true, shiftKey: true }))).toBe(true)
    expect(isReservedShellKey(ev({ key: 'F1' }))).toBe(true)
    expect(isReservedShellKey(ev({ key: 'Escape' }))).toBe(true)
  })

  it('treats bare workspace-nav digits 1–6 as reserved', () => {
    for (const d of ['1', '2', '3', '4', '5', '6']) {
      expect(isReservedShellKey(ev({ key: d }))).toBe(true)
    }
    // A digit with a modifier is NOT a nav gesture → not reserved here.
    expect(isReservedShellKey(ev({ key: '1', ctrlKey: true }))).toBe(false)
    // 7+ are not nav digits.
    expect(isReservedShellKey(ev({ key: '7' }))).toBe(false)
  })

  it('does NOT reserve ordinary tool-hotkey keys (L, R, plain letters)', () => {
    expect(isReservedShellKey(ev({ key: 'l' }))).toBe(false)
    expect(isReservedShellKey(ev({ key: 'r' }))).toBe(false)
  })
})

describe('decideCommandKeybinding — guard order', () => {
  it('dispatches a non-reserved key when not typing and palette closed', () => {
    const dispatch = vi.fn().mockReturnValue('sk_line')
    const fired = decideCommandKeybinding({
      e: ev({ key: 'l' }),
      paletteOpen: false,
      typing: false,
      dispatch
    })
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(fired).toBe('sk_line')
  })

  it('does NOT dispatch Ctrl+K (reserved) — the palette toggle is not double-fired', () => {
    const dispatch = vi.fn().mockReturnValue('openCommandPalette')
    const fired = decideCommandKeybinding({
      e: ev({ key: 'k', ctrlKey: true }),
      paletteOpen: false,
      typing: false,
      dispatch
    })
    // Guard short-circuits BEFORE the dispatcher is ever consulted.
    expect(dispatch).not.toHaveBeenCalled()
    expect(fired).toBeNull()
  })

  it('suppresses command dispatch while typing in an input', () => {
    const dispatch = vi.fn().mockReturnValue('sk_line')
    const fired = decideCommandKeybinding({
      e: ev({ key: 'l' }),
      paletteOpen: false,
      typing: true,
      dispatch
    })
    expect(dispatch).not.toHaveBeenCalled()
    expect(fired).toBeNull()
  })

  it('suppresses command dispatch while the command palette is open', () => {
    const dispatch = vi.fn().mockReturnValue('sk_line')
    const fired = decideCommandKeybinding({
      e: ev({ key: 'l' }),
      paletteOpen: true,
      typing: false,
      dispatch
    })
    expect(dispatch).not.toHaveBeenCalled()
    expect(fired).toBeNull()
  })

  it('returns null (bubbles) when a non-reserved key matches no enabled command', () => {
    const dispatch = vi.fn().mockReturnValue(null)
    const fired = decideCommandKeybinding({
      e: ev({ key: 'q' }),
      paletteOpen: false,
      typing: false,
      dispatch
    })
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(fired).toBeNull()
  })
})

describe('AppShell — command-keybinding bridge wiring (source pins)', () => {
  it('imports the live engine hook + free dispatchKeybinding from the commands barrel', () => {
    expect(SRC).toContain('useCommandEngine')
    expect(SRC).toContain('dispatchKeybinding')
  })

  it('mounts ShellCommandKeybindings UNDER the CommandContextProvider, fed the palette-open flag', () => {
    expect(SRC).toContain('<CommandContextProvider workspace={activeWorkspace} onNavigate={guardedNavigate}>')
    expect(SRC).toContain('<ShellCommandKeybindings paletteOpen={cmdOpen} />')
  })

  it('the bridge dispatches through dispatchKeybinding against the live engine context', () => {
    expect(SRC).toContain('const engine = useCommandEngine()')
    expect(SRC).toContain('dispatch: (ev) => dispatchKeybinding(ev, ctxRef.current)')
    expect(SRC).toContain('if (fired !== null) e.preventDefault()')
  })
})
