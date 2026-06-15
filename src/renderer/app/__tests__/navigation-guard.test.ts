/**
 * Unit pins for the PURE navigation-guard decision helper.
 *
 * `resolveNavIntent` is the single source of truth AppShell consults before a
 * route switch: 'navigate' = proceed (unmount is safe / nothing dirty),
 * 'confirm' = raise the unsaved-changes leave-confirm first. Pure ⇒ node-env.
 */
import { describe, expect, it } from 'vitest'
import { resolveNavIntent } from '../navigation-guard'

describe('resolveNavIntent', () => {
  it('re-selecting the ACTIVE workspace always navigates (never confirms), even when dirty', () => {
    // Nothing unmounts when the target is already active, so a dirty plan must
    // not raise a spurious confirm on a no-op click.
    expect(
      resolveNavIntent({ active: 'manufacture', target: 'manufacture', hasUnsavedChanges: true })
    ).toBe('navigate')
    expect(
      resolveNavIntent({ active: 'manufacture', target: 'manufacture', hasUnsavedChanges: false })
    ).toBe('navigate')
  })

  it('switching to a DIFFERENT workspace while dirty asks for confirmation', () => {
    expect(
      resolveNavIntent({ active: 'manufacture', target: 'design', hasUnsavedChanges: true })
    ).toBe('confirm')
    expect(
      resolveNavIntent({ active: 'manufacture', target: 'utilities', hasUnsavedChanges: true })
    ).toBe('confirm')
  })

  it('switching to a DIFFERENT workspace while clean navigates immediately', () => {
    expect(
      resolveNavIntent({ active: 'manufacture', target: 'design', hasUnsavedChanges: false })
    ).toBe('navigate')
    expect(
      resolveNavIntent({ active: 'design', target: 'manufacture', hasUnsavedChanges: false })
    ).toBe('navigate')
  })

  it('a clean non-Manufacture switch (the common case) is always a plain navigate', () => {
    // The guard is generic over workspaces; only the dirty flag gates it.
    expect(
      resolveNavIntent({ active: 'design', target: 'drawings', hasUnsavedChanges: false })
    ).toBe('navigate')
  })

  it('is deterministic over its inputs (pure)', () => {
    const input = { active: 'manufacture', target: 'design', hasUnsavedChanges: true } as const
    expect(resolveNavIntent(input)).toBe(resolveNavIntent(input))
  })
})
