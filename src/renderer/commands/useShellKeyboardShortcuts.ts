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
}

/**
 * Global shell shortcuts: command palette (Ctrl+K / ⌘K) and shortcuts reference (Ctrl+Shift+? / ⌘⇧?).
 */
export function useShellKeyboardShortcuts({
  commandPaletteOpen,
  onToggleCommandPalette,
  onOpenShortcutsReference
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
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [commandPaletteOpen, onToggleCommandPalette, onOpenShortcutsReference])
}
