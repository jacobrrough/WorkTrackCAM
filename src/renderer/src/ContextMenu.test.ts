import { describe, expect, it } from 'vitest'
import type { ContextMenuEntry, ContextMenuItem, ContextMenuSeparator } from './ContextMenu'

/**
 * Unit tests for ContextMenu types and entry utilities.
 * Component rendering tests require a DOM environment, so these focus on
 * the type contracts and entry structure used by all context menu builders.
 */
describe('ContextMenu entry contracts', () => {
  it('ContextMenuItem has required fields', () => {
    const item: ContextMenuItem = {
      id: 'edit',
      label: 'Edit',
      action: () => {}
    }
    expect(item.id).toBe('edit')
    expect(item.label).toBe('Edit')
    expect(typeof item.action).toBe('function')
  })

  it('ContextMenuItem supports optional fields', () => {
    const item: ContextMenuItem = {
      id: 'delete',
      label: 'Delete',
      icon: '🗑',
      shortcut: 'Del',
      danger: true,
      disabled: false,
      action: () => {}
    }
    expect(item.icon).toBe('🗑')
    expect(item.shortcut).toBe('Del')
    expect(item.danger).toBe(true)
    expect(item.disabled).toBe(false)
  })

  it('ContextMenuSeparator has separator: true', () => {
    const sep: ContextMenuSeparator = { separator: true }
    expect(sep.separator).toBe(true)
  })

  it('ContextMenuEntry array can mix items and separators', () => {
    const entries: ContextMenuEntry[] = [
      { id: 'edit', label: 'Edit', action: () => {} },
      { separator: true },
      { id: 'delete', label: 'Delete', danger: true, action: () => {} }
    ]
    expect(entries).toHaveLength(3)

    // Type discrimination
    const isSep = (e: ContextMenuEntry): e is ContextMenuSeparator =>
      'separator' in e && (e as ContextMenuSeparator).separator
    expect(isSep(entries[0])).toBe(false)
    expect(isSep(entries[1])).toBe(true)
    expect(isSep(entries[2])).toBe(false)
  })

  it('operation context menu pattern produces valid entries', () => {
    // Simulate the pattern used by buildOpContextMenu
    const idx: number = 2
    const totalOps: number = 5
    const buildOpCtx = (i: number, total: number): ContextMenuEntry[] => [
      { id: 'rename', label: 'Rename', icon: '✏', action: () => {} },
      { id: 'duplicate', label: 'Duplicate', icon: '⧉', shortcut: 'Ctrl+D', action: () => {} },
      { separator: true },
      { id: 'move_up', label: 'Move Up', icon: '↑', disabled: i === 0, action: () => {} },
      { id: 'move_down', label: 'Move Down', icon: '↓', disabled: i === total - 1, action: () => {} },
      { separator: true },
      { id: 'remove', label: 'Remove', icon: '🗑', danger: true, action: () => {} },
    ]
    const items = buildOpCtx(idx, totalOps)
    expect(items.length).toBe(7)
    // Move up should not be disabled at index 2
    const moveUp = items[3] as ContextMenuItem
    expect(moveUp.disabled).toBe(false)
    // Move down should not be disabled when not at last index
    const moveDown = items[4] as ContextMenuItem
    expect(moveDown.disabled).toBe(false)
    // Move up at index 0 should be disabled
    const first = buildOpCtx(0, totalOps)
    expect((first[3] as ContextMenuItem).disabled).toBe(true)
    // Move down at last index should be disabled
    const last = buildOpCtx(totalOps - 1, totalOps)
    expect((last[4] as ContextMenuItem).disabled).toBe(true)
  })

  it('job context menu pattern produces valid entries', () => {
    const buildJobCtx = (activeId: string, targetId: string): ContextMenuEntry[] => [
      { id: 'select', label: 'Select', icon: '▸', disabled: targetId === activeId, action: () => {} },
      { separator: true },
      { id: 'delete', label: 'Delete', icon: '🗑', danger: true, action: () => {} },
    ]
    const items = buildJobCtx('job-1', 'job-2')
    expect(items).toHaveLength(3)
    // Select should not be disabled when different job
    expect((items[0] as ContextMenuItem).disabled).toBe(false)
    // Select should be disabled for same job
    const same = buildJobCtx('job-1', 'job-1')
    expect((same[0] as ContextMenuItem).disabled).toBe(true)
  })

  it('machine context menu includes edit and conditional delete', () => {
    const isUserMachine = true
    const items: ContextMenuEntry[] = [
      { id: 'edit', label: 'Edit', icon: '✏', action: () => {} },
      { id: 'export', label: 'Export JSON…', icon: '↗', action: () => {} },
    ]
    if (isUserMachine) {
      items.push({ separator: true })
      items.push({ id: 'delete', label: 'Delete', icon: '🗑', danger: true, action: () => {} })
    }
    expect(items).toHaveLength(4)
    expect((items[3] as ContextMenuItem).danger).toBe(true)
  })

  it('material context menu omits delete for bundled materials', () => {
    const isBundled = true
    const items: ContextMenuEntry[] = [
      { id: 'edit', label: 'Edit', icon: '✏', action: () => {} },
    ]
    if (!isBundled) {
      items.push({ separator: true })
      items.push({ id: 'delete', label: 'Delete', icon: '🗑', danger: true, action: () => {} })
    }
    // Bundled: only edit
    expect(items).toHaveLength(1)
  })
})
