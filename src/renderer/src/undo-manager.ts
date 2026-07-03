/**
 * UndoManager — framework-agnostic command-pattern undo/redo engine.
 *
 * Design:
 *  - Fixed-size history stack (configurable, default 50)
 *  - Command coalescing: rapid edits to the same field within a time window
 *    merge into a single undo step (e.g. typing in a numeric input)
 *  - Event emitter for state changes so UI layers can subscribe
 *  - No React dependency — consumed by useUndo.ts hook
 */

// ── UndoableCommand interface ────────────────────────────────────────────────

/**
 * Any action that can be executed, undone, and described.
 * Implementations hold the before/after state needed to reverse the change.
 */
export interface UndoableCommand {
  /** Apply the change. */
  execute(): void
  /** Reverse the change. */
  undo(): void
  /** Human-readable label for the history list (e.g. "Edit feed rate"). */
  describe(): string
  /**
   * Optional coalescing key. If a new command has the same coalesceKey as the
   * most recent history entry, AND the time gap is within the coalesce window,
   * the commands are merged (the old undo + the new execute).
   */
  coalesceKey?: string
}

// ── Concrete command types ───────────────────────────────────────────────────

/** Generic property-edit command (covers tool edits, setup changes, stock changes). */
export class PropertyEditCommand<T> implements UndoableCommand {
  coalesceKey?: string
  private _newValue: T
  constructor(
    private readonly target: { get(): T; set(v: T): void },
    private readonly oldValue: T,
    newValue: T,
    private readonly label: string,
    coalesceKey?: string,
  ) {
    this._newValue = newValue
    this.coalesceKey = coalesceKey
  }
  execute(): void { this.target.set(this._newValue) }
  undo(): void { this.target.set(this.oldValue) }
  describe(): string { return this.label }
  /** Read the current new-value (for coalescing). */
  getNewValue(): T { return this._newValue }
  /** Replace the new-value end while keeping the original old-value. */
  updateNewValue(v: T): void { this._newValue = v }
}

/** Add an item to a list (operation, tool, etc.). */
export class AddItemCommand<T> implements UndoableCommand {
  constructor(
    private readonly list: { get(): T[]; set(v: T[]): void },
    private readonly item: T,
    private readonly label: string,
  ) {}
  execute(): void { this.list.set([...this.list.get(), this.item]) }
  undo(): void {
    const cur = this.list.get()
    this.list.set(cur.slice(0, cur.length - 1))
  }
  describe(): string { return this.label }
}

/** Delete an item from a list by index. */
export class DeleteItemCommand<T> implements UndoableCommand {
  private readonly index: number
  private readonly item: T
  constructor(
    private readonly list: { get(): T[]; set(v: T[]): void },
    index: number,
    private readonly label: string,
  ) {
    this.index = index
    this.item = this.list.get()[index]
  }
  execute(): void {
    const cur = this.list.get()
    this.list.set([...cur.slice(0, this.index), ...cur.slice(this.index + 1)])
  }
  undo(): void {
    const cur = this.list.get()
    this.list.set([...cur.slice(0, this.index), this.item, ...cur.slice(this.index)])
  }
  describe(): string { return this.label }
}

/** Reorder an item in a list (move from one index to another). */
export class MoveItemCommand<T> implements UndoableCommand {
  constructor(
    private readonly list: { get(): T[]; set(v: T[]): void },
    private readonly fromIndex: number,
    private readonly toIndex: number,
    private readonly label: string,
  ) {}
  execute(): void { this.applyMove(this.fromIndex, this.toIndex) }
  undo(): void { this.applyMove(this.toIndex, this.fromIndex) }
  describe(): string { return this.label }
  private applyMove(from: number, to: number): void {
    const arr = [...this.list.get()]
    const [item] = arr.splice(from, 1)
    arr.splice(to, 0, item)
    this.list.set(arr)
  }
}

/**
 * ReplayCommand — a command whose forward and inverse sides are THUNKS that
 * replay a mutation through an external validated commit chain (e.g. the
 * design session's `commitKernelFeatures` fold + persist + debounced-rebuild
 * path) and report whether the chain actually committed. Built for mutations
 * that are EXECUTED FIRST by their caller (which learns the outcome) and then
 * RECORDED via {@link UndoManager.record} — never re-executed on push.
 *
 * Coalescing: {@link mergeNewer} adopts the newer command's forward end while
 * keeping THIS command's inverse end, so a rapid burst of edits (e.g. a
 * dialog spinner re-applying the same timeline index) undoes back to the
 * state before the FIRST edit and redoes forward to the LATEST — mirroring
 * the PropertyEditCommand merge in {@link UndoManager.execute}.
 */
export class ReplayCommand implements UndoableCommand {
  coalesceKey?: string
  private forwardFn: () => boolean
  private readonly inverseFn: () => boolean
  private readonly label: string
  constructor(
    forward: () => boolean,
    inverse: () => boolean,
    label: string,
    coalesceKey?: string,
  ) {
    this.forwardFn = forward
    this.inverseFn = inverse
    this.label = label
    this.coalesceKey = coalesceKey
  }
  execute(): void { this.forwardFn() }
  undo(): void { this.inverseFn() }
  describe(): string { return this.label }
  /** Run the forward mutation NOW and report whether it committed. */
  runForward(): boolean { return this.forwardFn() }
  /** Coalesce: keep this command's inverse (first "before"), adopt the newer forward (latest "after"). */
  mergeNewer(newer: ReplayCommand): void { this.forwardFn = newer.forwardFn }
}

// ── History entry ────────────────────────────────────────────────────────────

export interface HistoryEntry {
  command: UndoableCommand
  timestamp: number
}

// ── Event types ──────────────────────────────────────────────────────────────

export type UndoManagerEvent = 'change'
export type UndoManagerListener = () => void

// ── UndoManager ──────────────────────────────────────────────────────────────

export class UndoManager {
  private undoStack: HistoryEntry[] = []
  private redoStack: HistoryEntry[] = []
  private readonly listeners = new Set<UndoManagerListener>()
  /** Monotonically increasing version counter — bumped on every mutation. */
  private _version = 0
  /** Cached readonly copy of undoStack, invalidated by version change. */
  private _cachedHistory: readonly HistoryEntry[] = []
  private _cachedHistoryVersion = -1

  /** Maximum undo steps retained. Older entries are discarded. */
  readonly maxHistory: number
  /** Time window (ms) for coalescing commands with the same key. */
  readonly coalesceWindowMs: number

  constructor(opts?: { maxHistory?: number; coalesceWindowMs?: number }) {
    this.maxHistory = opts?.maxHistory ?? 50
    this.coalesceWindowMs = opts?.coalesceWindowMs ?? 1000
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /** Execute a command and push it onto the undo stack. */
  execute(command: UndoableCommand): void {
    // Attempt coalescing with the top of the undo stack
    if (command.coalesceKey && this.undoStack.length > 0) {
      const top = this.undoStack[this.undoStack.length - 1]
      if (
        top.command.coalesceKey === command.coalesceKey &&
        Date.now() - top.timestamp < this.coalesceWindowMs
      ) {
        // Merge: keep top's undo, update its execute target
        if (top.command instanceof PropertyEditCommand && command instanceof PropertyEditCommand) {
          ;(top.command as PropertyEditCommand<unknown>).updateNewValue(
            (command as PropertyEditCommand<unknown>).getNewValue()
          )
          top.timestamp = Date.now()
          // Execute the new value
          command.execute()
          this.emit()
          return
        }
      }
    }

    command.execute()
    this.undoStack.push({ command, timestamp: Date.now() })

    // Trim oldest if over limit
    while (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift()
    }

    // New action invalidates redo history
    this.redoStack = []
    this.emit()
  }

  /**
   * Push an ALREADY-EXECUTED command onto the undo stack WITHOUT re-executing
   * it — for callers that must run the mutation first to learn whether it
   * actually committed (a rejected / no-op gesture is never recorded).
   * Applies the same time-window coalescing contract as {@link execute}, but
   * for {@link ReplayCommand} pairs: the resident entry keeps its inverse
   * (the FIRST before-state) and adopts the newer forward (the LATEST
   * after-state). Like any new action, recording invalidates redo history.
   */
  record(command: UndoableCommand): void {
    if (command.coalesceKey && this.undoStack.length > 0) {
      const top = this.undoStack[this.undoStack.length - 1]
      if (
        top.command.coalesceKey === command.coalesceKey &&
        Date.now() - top.timestamp < this.coalesceWindowMs &&
        top.command instanceof ReplayCommand &&
        command instanceof ReplayCommand
      ) {
        top.command.mergeNewer(command)
        top.timestamp = Date.now()
        this.redoStack = []
        this.emit()
        return
      }
    }

    this.undoStack.push({ command, timestamp: Date.now() })
    while (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift()
    }
    this.redoStack = []
    this.emit()
  }

  /** Undo the most recent command. No-op if nothing to undo. */
  undo(): void {
    const entry = this.undoStack.pop()
    if (!entry) return
    entry.command.undo()
    this.redoStack.push(entry)
    this.emit()
  }

  /** Redo the most recently undone command. No-op if nothing to redo. */
  redo(): void {
    const entry = this.redoStack.pop()
    if (!entry) return
    entry.command.execute()
    this.undoStack.push(entry)
    this.emit()
  }

  get canUndo(): boolean { return this.undoStack.length > 0 }
  get canRedo(): boolean { return this.redoStack.length > 0 }

  /** Monotonically increasing version — changes on every mutation. */
  get version(): number { return this._version }

  /** Undo history (most recent last). Cached — safe for reference equality checks. */
  get history(): readonly HistoryEntry[] {
    if (this._cachedHistoryVersion !== this._version) {
      this._cachedHistory = [...this.undoStack]
      this._cachedHistoryVersion = this._version
    }
    return this._cachedHistory
  }

  /** Redo history (most recent last). Read-only snapshot. */
  get redoHistory(): readonly HistoryEntry[] { return [...this.redoStack] }

  /** Discard all history (both undo and redo). */
  clear(): void {
    this.undoStack = []
    this.redoStack = []
    this.emit()
  }

  // ── Event emitter ────────────────────────────────────────────────────────

  on(_event: UndoManagerEvent, fn: UndoManagerListener): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  private emit(): void {
    this._version++
    for (const fn of this.listeners) fn()
  }
}
