import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  UndoManager,
  PropertyEditCommand,
  AddItemCommand,
  DeleteItemCommand,
  MoveItemCommand,
} from './undo-manager'
import type { UndoableCommand } from './undo-manager'

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Simple mutable cell for testing property commands. */
function cell<T>(init: T): { value: T; get(): T; set(v: T): void } {
  const c = {
    value: init,
    get() { return c.value },
    set(v: T) { c.value = v },
  }
  return c
}

/** Simple mutable list cell for testing list commands. */
function listCell<T>(init: T[]): { items: T[]; get(): T[]; set(v: T[]): void } {
  const c = {
    items: [...init],
    get() { return c.items },
    set(v: T[]) { c.items = v },
  }
  return c
}

/** Minimal command for basic tests. */
function simpleCmd(opts: { exec: () => void; undo: () => void; desc?: string; coalesceKey?: string }): UndoableCommand {
  return {
    execute: opts.exec,
    undo: opts.undo,
    describe: () => opts.desc ?? 'test',
    coalesceKey: opts.coalesceKey,
  }
}

// ── UndoManager core ─────────────────────────────────────────────────────────

describe('UndoManager', () => {
  let mgr: UndoManager

  beforeEach(() => {
    mgr = new UndoManager()
  })

  it('starts with empty stacks', () => {
    expect(mgr.canUndo).toBe(false)
    expect(mgr.canRedo).toBe(false)
    expect(mgr.history).toEqual([])
    expect(mgr.redoHistory).toEqual([])
  })

  it('executes a command and pushes to undo stack', () => {
    const fn = vi.fn()
    mgr.execute(simpleCmd({ exec: fn, undo: vi.fn() }))
    expect(fn).toHaveBeenCalledOnce()
    expect(mgr.canUndo).toBe(true)
    expect(mgr.canRedo).toBe(false)
    expect(mgr.history).toHaveLength(1)
  })

  it('undo reverses a command and enables redo', () => {
    const undoFn = vi.fn()
    mgr.execute(simpleCmd({ exec: vi.fn(), undo: undoFn }))
    mgr.undo()
    expect(undoFn).toHaveBeenCalledOnce()
    expect(mgr.canUndo).toBe(false)
    expect(mgr.canRedo).toBe(true)
  })

  it('redo re-applies a command', () => {
    const execFn = vi.fn()
    mgr.execute(simpleCmd({ exec: execFn, undo: vi.fn() }))
    mgr.undo()
    mgr.redo()
    expect(execFn).toHaveBeenCalledTimes(2) // initial execute + redo
    expect(mgr.canUndo).toBe(true)
    expect(mgr.canRedo).toBe(false)
  })

  it('new execute after undo clears redo stack', () => {
    mgr.execute(simpleCmd({ exec: vi.fn(), undo: vi.fn(), desc: 'A' }))
    mgr.execute(simpleCmd({ exec: vi.fn(), undo: vi.fn(), desc: 'B' }))
    mgr.undo() // undo B
    expect(mgr.canRedo).toBe(true)
    mgr.execute(simpleCmd({ exec: vi.fn(), undo: vi.fn(), desc: 'C' }))
    expect(mgr.canRedo).toBe(false)
    expect(mgr.history).toHaveLength(2) // A + C
  })

  it('undo is no-op when stack is empty', () => {
    expect(() => mgr.undo()).not.toThrow()
    expect(mgr.canUndo).toBe(false)
  })

  it('redo is no-op when stack is empty', () => {
    expect(() => mgr.redo()).not.toThrow()
    expect(mgr.canRedo).toBe(false)
  })

  it('multi-step undo/redo cycle', () => {
    const c = cell(0)
    const makeCmd = (from: number, to: number): UndoableCommand =>
      simpleCmd({ exec: () => { c.value = to }, undo: () => { c.value = from }, desc: `${from}->${to}` })
    mgr.execute(makeCmd(0, 1))
    mgr.execute(makeCmd(1, 2))
    mgr.execute(makeCmd(2, 3))
    expect(c.value).toBe(3)
    mgr.undo() // 3 -> 2
    expect(c.value).toBe(2)
    mgr.undo() // 2 -> 1
    expect(c.value).toBe(1)
    mgr.redo() // 1 -> 2
    expect(c.value).toBe(2)
    mgr.redo() // 2 -> 3
    expect(c.value).toBe(3)
  })
})

// ── History overflow ─────────────────────────────────────────────────────────

describe('UndoManager history overflow', () => {
  it('trims oldest entries when exceeding maxHistory', () => {
    const mgr = new UndoManager({ maxHistory: 3 })
    for (let i = 0; i < 5; i++) {
      mgr.execute(simpleCmd({ exec: vi.fn(), undo: vi.fn(), desc: `cmd-${i}` }))
    }
    expect(mgr.history).toHaveLength(3)
    // Only the last 3 remain
    const descs = mgr.history.map(e => e.command.describe())
    expect(descs).toEqual(['cmd-2', 'cmd-3', 'cmd-4'])
  })

  it('maxHistory of 1 keeps only the most recent', () => {
    const mgr = new UndoManager({ maxHistory: 1 })
    mgr.execute(simpleCmd({ exec: vi.fn(), undo: vi.fn(), desc: 'first' }))
    mgr.execute(simpleCmd({ exec: vi.fn(), undo: vi.fn(), desc: 'second' }))
    expect(mgr.history).toHaveLength(1)
    expect(mgr.history[0].command.describe()).toBe('second')
  })

  it('uses default maxHistory of 50', () => {
    const mgr = new UndoManager()
    expect(mgr.maxHistory).toBe(50)
  })
})

// ── Clear ────────────────────────────────────────────────────────────────────

describe('UndoManager clear', () => {
  it('clears both undo and redo stacks', () => {
    const mgr = new UndoManager()
    mgr.execute(simpleCmd({ exec: vi.fn(), undo: vi.fn() }))
    mgr.execute(simpleCmd({ exec: vi.fn(), undo: vi.fn() }))
    mgr.undo()
    expect(mgr.canUndo).toBe(true)
    expect(mgr.canRedo).toBe(true)
    mgr.clear()
    expect(mgr.canUndo).toBe(false)
    expect(mgr.canRedo).toBe(false)
    expect(mgr.history).toEqual([])
    expect(mgr.redoHistory).toEqual([])
  })
})

// ── Event emitter ────────────────────────────────────────────────────────────

describe('UndoManager events', () => {
  it('emits change on execute', () => {
    const mgr = new UndoManager()
    const fn = vi.fn()
    mgr.on('change', fn)
    mgr.execute(simpleCmd({ exec: vi.fn(), undo: vi.fn() }))
    expect(fn).toHaveBeenCalledOnce()
  })

  it('emits change on undo', () => {
    const mgr = new UndoManager()
    const fn = vi.fn()
    mgr.execute(simpleCmd({ exec: vi.fn(), undo: vi.fn() }))
    mgr.on('change', fn)
    mgr.undo()
    expect(fn).toHaveBeenCalledOnce()
  })

  it('emits change on redo', () => {
    const mgr = new UndoManager()
    mgr.execute(simpleCmd({ exec: vi.fn(), undo: vi.fn() }))
    mgr.undo()
    const fn = vi.fn()
    mgr.on('change', fn)
    mgr.redo()
    expect(fn).toHaveBeenCalledOnce()
  })

  it('emits change on clear', () => {
    const mgr = new UndoManager()
    mgr.execute(simpleCmd({ exec: vi.fn(), undo: vi.fn() }))
    const fn = vi.fn()
    mgr.on('change', fn)
    mgr.clear()
    expect(fn).toHaveBeenCalledOnce()
  })

  it('unsubscribe stops notifications', () => {
    const mgr = new UndoManager()
    const fn = vi.fn()
    const unsub = mgr.on('change', fn)
    unsub()
    mgr.execute(simpleCmd({ exec: vi.fn(), undo: vi.fn() }))
    expect(fn).not.toHaveBeenCalled()
  })

  it('supports multiple listeners', () => {
    const mgr = new UndoManager()
    const fn1 = vi.fn()
    const fn2 = vi.fn()
    mgr.on('change', fn1)
    mgr.on('change', fn2)
    mgr.execute(simpleCmd({ exec: vi.fn(), undo: vi.fn() }))
    expect(fn1).toHaveBeenCalledOnce()
    expect(fn2).toHaveBeenCalledOnce()
  })
})

// ── Command coalescing ───────────────────────────────────────────────────────

describe('UndoManager command coalescing', () => {
  it('coalesces PropertyEditCommands with same key within window', () => {
    const mgr = new UndoManager({ coalesceWindowMs: 5000 })
    const c = cell(0)
    const target = { get: () => c.value, set: (v: number) => { c.value = v } }

    mgr.execute(new PropertyEditCommand(target, 0, 10, 'edit val', 'field-x'))
    expect(c.value).toBe(10)
    expect(mgr.history).toHaveLength(1)

    mgr.execute(new PropertyEditCommand(target, 10, 20, 'edit val', 'field-x'))
    expect(c.value).toBe(20)
    // Coalesced — still just 1 entry
    expect(mgr.history).toHaveLength(1)

    // Undo goes all the way back to 0 (original old value)
    mgr.undo()
    expect(c.value).toBe(0)
  })

  it('does not coalesce when keys differ', () => {
    const mgr = new UndoManager({ coalesceWindowMs: 5000 })
    const c = cell(0)
    const target = { get: () => c.value, set: (v: number) => { c.value = v } }

    mgr.execute(new PropertyEditCommand(target, 0, 10, 'field A', 'field-a'))
    mgr.execute(new PropertyEditCommand(target, 10, 20, 'field B', 'field-b'))
    expect(mgr.history).toHaveLength(2)
  })

  it('does not coalesce when outside time window', () => {
    const mgr = new UndoManager({ coalesceWindowMs: 100 })
    const c = cell(0)
    const target = { get: () => c.value, set: (v: number) => { c.value = v } }

    // Manually set a very old timestamp
    mgr.execute(new PropertyEditCommand(target, 0, 10, 'edit', 'k'))
    const top = mgr.history[mgr.history.length - 1]
    // Overwrite timestamp to simulate old entry (reach into the internals)
    ;(top as { timestamp: number }).timestamp = Date.now() - 200

    mgr.execute(new PropertyEditCommand(target, 10, 20, 'edit', 'k'))
    expect(mgr.history).toHaveLength(2)
  })

  it('does not coalesce commands without coalesceKey', () => {
    const mgr = new UndoManager()
    const c = cell(0)
    const target = { get: () => c.value, set: (v: number) => { c.value = v } }

    mgr.execute(new PropertyEditCommand(target, 0, 10, 'edit'))
    mgr.execute(new PropertyEditCommand(target, 10, 20, 'edit'))
    expect(mgr.history).toHaveLength(2)
  })
})

// ── PropertyEditCommand ──────────────────────────────────────────────────────

describe('PropertyEditCommand', () => {
  it('executes and undoes a value change', () => {
    const c = cell('hello')
    const target = { get: () => c.value, set: (v: string) => { c.value = v } }
    const cmd = new PropertyEditCommand(target, 'hello', 'world', 'Change text')

    cmd.execute()
    expect(c.value).toBe('world')

    cmd.undo()
    expect(c.value).toBe('hello')
  })

  it('describes itself', () => {
    const target = { get: () => 0, set: () => {} }
    const cmd = new PropertyEditCommand(target, 0, 1, 'Edit feed rate')
    expect(cmd.describe()).toBe('Edit feed rate')
  })
})

// ── AddItemCommand ───────────────────────────────────────────────────────────

describe('AddItemCommand', () => {
  it('adds and removes an item', () => {
    const lc = listCell(['a', 'b'])
    const cmd = new AddItemCommand(lc, 'c', 'Add item')

    cmd.execute()
    expect(lc.items).toEqual(['a', 'b', 'c'])

    cmd.undo()
    expect(lc.items).toEqual(['a', 'b'])
  })

  it('works with empty lists', () => {
    const lc = listCell<string>([])
    const cmd = new AddItemCommand(lc, 'first', 'Add first')

    cmd.execute()
    expect(lc.items).toEqual(['first'])

    cmd.undo()
    expect(lc.items).toEqual([])
  })
})

// ── DeleteItemCommand ────────────────────────────────────────────────────────

describe('DeleteItemCommand', () => {
  it('deletes and restores an item at correct index', () => {
    const lc = listCell(['a', 'b', 'c'])
    const cmd = new DeleteItemCommand(lc, 1, 'Delete b')

    cmd.execute()
    expect(lc.items).toEqual(['a', 'c'])

    cmd.undo()
    expect(lc.items).toEqual(['a', 'b', 'c'])
  })

  it('handles deletion of first item', () => {
    const lc = listCell(['x', 'y'])
    const cmd = new DeleteItemCommand(lc, 0, 'Delete first')

    cmd.execute()
    expect(lc.items).toEqual(['y'])

    cmd.undo()
    expect(lc.items).toEqual(['x', 'y'])
  })

  it('handles deletion of last item', () => {
    const lc = listCell(['x', 'y'])
    const cmd = new DeleteItemCommand(lc, 1, 'Delete last')

    cmd.execute()
    expect(lc.items).toEqual(['x'])

    cmd.undo()
    expect(lc.items).toEqual(['x', 'y'])
  })
})

// ── MoveItemCommand ──────────────────────────────────────────────────────────

describe('MoveItemCommand', () => {
  it('moves an item forward and back', () => {
    const lc = listCell(['a', 'b', 'c', 'd'])
    const cmd = new MoveItemCommand(lc, 0, 2, 'Move a after c')

    cmd.execute()
    expect(lc.items).toEqual(['b', 'c', 'a', 'd'])

    cmd.undo()
    expect(lc.items).toEqual(['a', 'b', 'c', 'd'])
  })

  it('moves an item backward', () => {
    const lc = listCell(['a', 'b', 'c'])
    const cmd = new MoveItemCommand(lc, 2, 0, 'Move c to front')

    cmd.execute()
    expect(lc.items).toEqual(['c', 'a', 'b'])

    cmd.undo()
    expect(lc.items).toEqual(['a', 'b', 'c'])
  })
})

// ── Integration: full command lifecycle through UndoManager ──────────────────

describe('UndoManager + concrete commands integration', () => {
  it('property edit: full execute/undo/redo cycle', () => {
    const mgr = new UndoManager()
    const c = cell(100)
    const target = { get: () => c.value, set: (v: number) => { c.value = v } }

    mgr.execute(new PropertyEditCommand(target, 100, 200, 'Change stock X'))
    expect(c.value).toBe(200)

    mgr.undo()
    expect(c.value).toBe(100)

    mgr.redo()
    expect(c.value).toBe(200)
  })

  it('add + delete: undo chain restores original state', () => {
    const mgr = new UndoManager()
    const lc = listCell(['op1', 'op2'])

    // Add op3
    mgr.execute(new AddItemCommand(lc, 'op3', 'Add op3'))
    expect(lc.items).toEqual(['op1', 'op2', 'op3'])

    // Delete op1
    mgr.execute(new DeleteItemCommand(lc, 0, 'Delete op1'))
    expect(lc.items).toEqual(['op2', 'op3'])

    // Undo delete
    mgr.undo()
    expect(lc.items).toEqual(['op1', 'op2', 'op3'])

    // Undo add
    mgr.undo()
    expect(lc.items).toEqual(['op1', 'op2'])
  })

  it('mixed commands: interleaved edits and list operations', () => {
    const mgr = new UndoManager()
    const c = cell('oak')
    const lc = listCell([10, 20])

    const target = { get: () => c.value, set: (v: string) => { c.value = v } }

    mgr.execute(new PropertyEditCommand(target, 'oak', 'maple', 'Change material'))
    mgr.execute(new AddItemCommand(lc, 30, 'Add feedrate'))
    mgr.execute(new PropertyEditCommand(target, 'maple', 'birch', 'Change material again'))

    expect(c.value).toBe('birch')
    expect(lc.items).toEqual([10, 20, 30])

    mgr.undo() // birch -> maple
    expect(c.value).toBe('maple')

    mgr.undo() // remove 30
    expect(lc.items).toEqual([10, 20])

    mgr.undo() // maple -> oak
    expect(c.value).toBe('oak')

    // Redo all
    mgr.redo()
    mgr.redo()
    mgr.redo()
    expect(c.value).toBe('birch')
    expect(lc.items).toEqual([10, 20, 30])
  })

  it('move + undo returns to original order', () => {
    const mgr = new UndoManager()
    const lc = listCell(['pocket', 'contour', 'drill'])

    mgr.execute(new MoveItemCommand(lc, 2, 0, 'Move drill to top'))
    expect(lc.items).toEqual(['drill', 'pocket', 'contour'])

    mgr.undo()
    expect(lc.items).toEqual(['pocket', 'contour', 'drill'])
  })
})

// ── Edge cases ───────────────────────────────────────────────────────────────

describe('UndoManager edge cases', () => {
  it('rapid undo/redo on single entry', () => {
    const mgr = new UndoManager()
    mgr.execute(simpleCmd({ exec: vi.fn(), undo: vi.fn() }))
    mgr.undo()
    mgr.redo()
    mgr.undo()
    mgr.redo()
    expect(mgr.canUndo).toBe(true)
    expect(mgr.canRedo).toBe(false)
  })

  it('undo after clear is no-op', () => {
    const mgr = new UndoManager()
    mgr.execute(simpleCmd({ exec: vi.fn(), undo: vi.fn() }))
    mgr.clear()
    mgr.undo()
    expect(mgr.canUndo).toBe(false)
  })

  it('history returns a snapshot, not a live reference', () => {
    const mgr = new UndoManager()
    const snap1 = mgr.history
    mgr.execute(simpleCmd({ exec: vi.fn(), undo: vi.fn() }))
    const snap2 = mgr.history
    // snap1 was taken before execute — it should still be empty
    expect(snap1).toHaveLength(0)
    expect(snap2).toHaveLength(1)
  })

  it('timestamps are recorded', () => {
    const mgr = new UndoManager()
    const before = Date.now()
    mgr.execute(simpleCmd({ exec: vi.fn(), undo: vi.fn() }))
    const after = Date.now()
    const ts = mgr.history[0].timestamp
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(after)
  })

  it('describe() returns the label from each command', () => {
    const mgr = new UndoManager()
    mgr.execute(simpleCmd({ exec: vi.fn(), undo: vi.fn(), desc: 'Add pocket op' }))
    mgr.execute(simpleCmd({ exec: vi.fn(), undo: vi.fn(), desc: 'Change feed rate' }))
    const labels = mgr.history.map(e => e.command.describe())
    expect(labels).toEqual(['Add pocket op', 'Change feed rate'])
  })
})
