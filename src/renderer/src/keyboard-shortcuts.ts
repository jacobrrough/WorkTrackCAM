/**
 * Centralized keyboard shortcut registry.
 *
 * Provides `registerShortcut` / `unregister` for imperative use and
 * `useKeyboardShortcuts` React hook for declarative binding inside components.
 *
 * The existing `app-keyboard-shortcuts.ts` in `shared/` defines the *reference
 * table* (for the shortcuts dialog).  This module is the *runtime dispatcher*
 * that actually listens for key combos and fires actions.
 */

import { useEffect, useRef } from 'react'
import { isTypableKeyboardTarget } from '../../shared/app-keyboard-shortcuts'

// ── Types ────────────────────────────────────────────────────────────────────

export interface ShortcutEntry {
  /** Display string, e.g. "Ctrl+Enter" */
  combo: string
  /** Callback fired when the shortcut matches. */
  action: () => void
  /** Human-readable description for tooltip / palette. */
  description: string
  /**
   * If true the shortcut fires even when focus is inside an input / textarea.
   * Default: false (most shortcuts are suppressed while typing).
   */
  activeInInput?: boolean
}

// ── Registry (module-level singleton) ────────────────────────────────────────

const registry = new Map<string, ShortcutEntry>()

export function registerShortcut(combo: string, action: () => void, description: string, activeInInput = false): void {
  registry.set(combo, { combo, action, description, activeInInput })
}

export function unregisterShortcut(combo: string): void {
  registry.delete(combo)
}

export function getShortcutMap(): ReadonlyMap<string, ShortcutEntry> {
  return registry
}

/**
 * Return a tooltip-friendly label for a shortcut combo, e.g. "(Ctrl+Enter)".
 * Returns empty string if the combo is not registered.
 */
export function shortcutHint(combo: string): string {
  return registry.has(combo) ? `(${combo})` : ''
}

// ── Matching engine ──────────────────────────────────────────────────────────

/**
 * Parse a combo string like "Ctrl+Shift+D" into a normalized descriptor.
 * Supports Ctrl, Shift, Alt, Meta/Cmd, and a single main key.
 */
interface ParsedCombo {
  ctrl: boolean
  shift: boolean
  alt: boolean
  meta: boolean
  key: string // lower-cased
}

function parseCombo(combo: string): ParsedCombo {
  const parts = combo.split('+').map(s => s.trim().toLowerCase())
  const ctrl = parts.includes('ctrl')
  const shift = parts.includes('shift')
  const alt = parts.includes('alt')
  const meta = parts.includes('meta') || parts.includes('cmd')
  // The main key is the last non-modifier token
  const modifiers = new Set(['ctrl', 'shift', 'alt', 'meta', 'cmd'])
  const keyParts = parts.filter(p => !modifiers.has(p))
  const key = keyParts[keyParts.length - 1] ?? ''
  return { ctrl, shift, alt, meta, key }
}

function eventMatchesCombo(e: KeyboardEvent, combo: string): boolean {
  // Special-case "F5" and similar function keys that don't use modifiers
  if (combo === 'F5') return e.key === 'F5' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey
  // Special-case "Delete"
  if (combo === 'Delete') return e.key === 'Delete' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey
  // Special-case "Escape"
  if (combo === 'Escape') return e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey

  const p = parseCombo(combo)
  // Either Ctrl or Meta satisfies "Ctrl+"
  const ctrlMatch = p.ctrl ? (e.ctrlKey || e.metaKey) : (!e.ctrlKey && !e.metaKey)
  const shiftMatch = p.shift === e.shiftKey
  const altMatch = p.alt === e.altKey

  return ctrlMatch && shiftMatch && altMatch && e.key.toLowerCase() === p.key
}

/**
 * Check whether a KeyboardEvent matches *any* registered shortcut.
 * Returns the matched entry (so the caller can invoke `entry.action()`) or null.
 */
export function matchRegisteredShortcut(e: KeyboardEvent): ShortcutEntry | null {
  for (const entry of registry.values()) {
    // Some combos have alternatives separated by " or " (e.g. "F5 or Ctrl+Enter")
    const alternatives = entry.combo.split(/\s+or\s+/i)
    for (const alt of alternatives) {
      if (eventMatchesCombo(e, alt.trim())) return entry
    }
  }
  return null
}

// ── React hook ───────────────────────────────────────────────────────────────

export interface ShortcutBinding {
  combo: string
  action: () => void
  description: string
  activeInInput?: boolean
}

/**
 * Register a batch of shortcuts for the lifetime of the calling component.
 * Actions are kept in a ref so the hook never re-registers on action identity changes.
 *
 * The hook does NOT add its own `keydown` listener — it only populates the
 * registry.  The top-level listener in ShopApp dispatches via
 * `matchRegisteredShortcut`.  This keeps event handling centralized.
 */
export function useKeyboardShortcuts(bindings: ShortcutBinding[]): void {
  const bindingsRef = useRef(bindings)
  bindingsRef.current = bindings

  useEffect(() => {
    // Register all bindings
    for (const b of bindingsRef.current) {
      registerShortcut(b.combo, b.action, b.description, b.activeInInput)
    }
    return () => {
      // Unregister on unmount
      for (const b of bindingsRef.current) {
        unregisterShortcut(b.combo)
      }
    }
  // Only re-register when the combo strings change (not action refs)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bindings.map(b => b.combo).join('|')])

  // Keep action refs up-to-date without re-registering
  useEffect(() => {
    for (const b of bindingsRef.current) {
      const existing = registry.get(b.combo)
      if (existing) {
        existing.action = b.action
      }
    }
  })
}

/**
 * Utility: format a shortcut combo for display in a tooltip.
 * Appends the combo in parentheses after the base text.
 */
export function tooltipWithShortcut(baseText: string, combo: string): string {
  return `${baseText} (${combo})`
}

/**
 * Centralized keydown handler for the shortcut registry.
 * Attach this to `window` at the app level.
 */
export function handleRegisteredShortcutKeydown(e: KeyboardEvent): void {
  const entry = matchRegisteredShortcut(e)
  if (!entry) return
  if (!entry.activeInInput && isTypableKeyboardTarget(e.target)) return
  e.preventDefault()
  entry.action()
}
