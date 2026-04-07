/**
 * useUndo — React hook wrapping the framework-agnostic UndoManager.
 *
 * Provides Ctrl+Z / Ctrl+Shift+Z keyboard bindings and re-renders
 * whenever the undo/redo state changes.
 */
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { UndoManager } from './undo-manager'
import type { UndoableCommand, HistoryEntry } from './undo-manager'

export interface UseUndoReturn {
  /** The shared UndoManager instance (for executing commands). */
  manager: UndoManager
  /** Undo the most recent action. */
  undo: () => void
  /** Redo the most recently undone action. */
  redo: () => void
  /** Whether there is anything to undo. */
  canUndo: boolean
  /** Whether there is anything to redo. */
  canRedo: boolean
  /** Undo history (most recent last). */
  history: readonly HistoryEntry[]
  /** Execute a command through the manager. */
  execute: (cmd: UndoableCommand) => void
}

/** Singleton instance shared across all hook consumers. */
let sharedManager: UndoManager | null = null

function getSharedManager(): UndoManager {
  if (!sharedManager) sharedManager = new UndoManager()
  return sharedManager
}

/**
 * Override the shared manager (useful for tests or custom config).
 * Must be called before any component mounts.
 */
export function setSharedUndoManager(m: UndoManager): void {
  sharedManager = m
}

/** Snapshot type for useSyncExternalStore. */
interface UndoSnapshot {
  version: number
  canUndo: boolean
  canRedo: boolean
  history: readonly HistoryEntry[]
}

/**
 * React hook for undo/redo with built-in Ctrl+Z / Ctrl+Shift+Z bindings.
 */
export function useUndo(): UseUndoReturn {
  const mgr = useMemo(() => getSharedManager(), [])

  // Use useSyncExternalStore for tear-free reads.
  // CRITICAL: getSnapshot MUST return a cached reference when values haven't
  // changed, otherwise useSyncExternalStore triggers an infinite render loop.
  // We compare the manager's monotonic version counter to decide staleness.
  const cachedSnap = useRef<UndoSnapshot>({ version: -1, canUndo: false, canRedo: false, history: [] })

  const subscribe = useCallback(
    (onStoreChange: () => void) => mgr.on('change', onStoreChange),
    [mgr],
  )
  const getSnapshot = useCallback((): UndoSnapshot => {
    const v = mgr.version
    if (cachedSnap.current.version === v) return cachedSnap.current
    const next: UndoSnapshot = { version: v, canUndo: mgr.canUndo, canRedo: mgr.canRedo, history: mgr.history }
    cachedSnap.current = next
    return next
  }, [mgr])

  const snap = useSyncExternalStore(subscribe, getSnapshot)

  // Keyboard bindings
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      // Skip when user is typing in an input/textarea/contenteditable
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if ((e.target as HTMLElement)?.isContentEditable) return

      const mod = e.ctrlKey || e.metaKey
      if (!mod) return

      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        mgr.undo()
      } else if ((e.key === 'z' && e.shiftKey) || (e.key === 'y')) {
        e.preventDefault()
        mgr.redo()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [mgr])

  const undo = useCallback(() => mgr.undo(), [mgr])
  const redo = useCallback(() => mgr.redo(), [mgr])
  const execute = useCallback((cmd: UndoableCommand) => mgr.execute(cmd), [mgr])

  return {
    manager: mgr,
    undo,
    redo,
    canUndo: snap.canUndo,
    canRedo: snap.canRedo,
    history: snap.history,
    execute,
  }
}
