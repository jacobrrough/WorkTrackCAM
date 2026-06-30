import { useEffect } from 'react'
import {
  isTypableKeyboardTarget,
  matchesCommandPaletteToggle,
  matchesKeyboardShortcutsReference
} from '../../shared/app-keyboard-shortcuts'

type Args = {
  commandPaletteOpen: boolean
  onToggleCommandPalette: () => void
  onOpenShortcutsReference: () => void
  /**
   * Optional command-keybinding dispatcher — the runtime side of the
   * `CommandHandler.keybinding` field. The consumer wires this to
   * `dispatchKeybinding(e, ctx)` against the live {@link CommandContext} (via the
   * `CommandContextProvider`'s engine handle). It must return the id of the
   * command that fired, or `null` when nothing matched. The seam calls it LAST —
   * only after the reserved app shortcuts (palette toggle, shortcuts reference)
   * and the typing/focus guard — so a command hotkey can never hijack a text
   * field or shadow a global shell shortcut. When the dispatcher fires a
   * command, the keystroke is consumed (`preventDefault`).
   *
   * Absent ⇒ command keybindings are not wired (back-compat: the hook behaves
   * exactly as it did when it only owned the palette + reference shortcuts).
   */
  onCommandKeybinding?: (e: KeyboardEvent) => string | null
}

/**
 * Global shell shortcuts: command palette (Ctrl+K / ⌘K), shortcuts reference
 * (Ctrl+Shift+? / ⌘⇧?), and — when `onCommandKeybinding` is supplied — the
 * registered command keybindings (the `CommandHandler.keybinding` hotkey layer).
 *
 * Precedence, highest first:
 *   1. Command palette toggle (works even while the palette is open, to close).
 *   2. (palette closed only) shortcuts reference.
 *   3. (palette closed, not typing) registered command keybindings.
 *
 * The typing guard (`isTypableKeyboardTarget`) gates 2 + 3 so single-key
 * command hotkeys (`L`, `R`, …) never fire while focus is in an input/textarea/
 * contenteditable — matching the existing convention in `app-keyboard-shortcuts`.
 */
export function useShellKeyboardShortcuts({
  commandPaletteOpen,
  onToggleCommandPalette,
  onOpenShortcutsReference,
  onCommandKeybinding
}: Args): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (matchesCommandPaletteToggle(e)) {
        e.preventDefault()
        onToggleCommandPalette()
        return
      }
      if (commandPaletteOpen) return
      if (isTypableKeyboardTarget(document.activeElement)) return
      if (matchesKeyboardShortcutsReference(e)) {
        e.preventDefault()
        onOpenShortcutsReference()
        return
      }
      // Last: registered command keybindings. Only reached for a keystroke that
      // is not a reserved app shortcut, the palette is closed, and focus is not
      // in a typable control — so a command hotkey can't hijack typing or shadow
      // the palette/reference shortcuts. Consume the event only if a command
      // actually fired (enabled + matched), so an unbound key still bubbles.
      if (onCommandKeybinding && onCommandKeybinding(e) !== null) {
        e.preventDefault()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [commandPaletteOpen, onToggleCommandPalette, onOpenShortcutsReference, onCommandKeybinding])
}
