/**
 * FeatureTree — kernel-op timeline render-pin.
 *
 * Pins the additive timeline section the editable feature tree grows when
 * `kernelOps` is supplied (drag-to-reorder rows, keyboard move up/down, a
 * per-op suppress toggle, a roll-back marker). The pure edit-action -> state
 * mapping is proven separately in `feature-timeline-actions.test.ts`; this
 * file pins the RENDER contract — which classes / testids / aria a given
 * `{ kernelOps, rolledBackTo }` produces.
 *
 * Why `renderToStaticMarkup`? Same rationale as the sibling
 * `DesignWorkspace.tabbar.test.tsx` — the project's node-env vitest does not
 * ship a DOM, so we assert on the server-rendered HTML string. Click / drag
 * handlers are exercised indirectly: their wiring is a thin call into the
 * props, and the props themselves are validated by the pure-action suite.
 */

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { FeatureTree, isRolledBack, kernelOpLabel } from '../FeatureTree'
import type { KernelPostSolidOp } from '../../../shared/part-features-schema'

const unionBox = (): KernelPostSolidOp => ({
  kind: 'boolean_union_box',
  xMinMm: 0,
  xMaxMm: 10,
  yMinMm: 0,
  yMaxMm: 10,
  zMinMm: 0,
  zMaxMm: 5
})
const patternRect = (): KernelPostSolidOp => ({
  kind: 'pattern_rectangular',
  countX: 2,
  countY: 1,
  spacingXMm: 30,
  spacingYMm: 0
})
const filletAll = (radiusMm = 0.5): KernelPostSolidOp => ({ kind: 'fillet_all', radiusMm })

const noop = (): void => {}
const editCallbacks = {
  onKernelMove: noop,
  onKernelReorder: noop,
  onKernelSuppressToggle: noop,
  onKernelSetRollback: noop,
  onKernelClearRollback: noop,
  onKernelDelete: noop
} as const

describe('FeatureTree timeline — presence + absence', () => {
  it('does NOT render the timeline when kernelOps is omitted', () => {
    const html = renderToStaticMarkup(createElement(FeatureTree, { operations: [] }))
    // Empty operations + no params + no kernel ops -> canonical EmptyState.
    expect(html).toContain('data-testid="cad-feature-empty-state"')
    expect(html).not.toContain('data-testid="cad-kernel-timeline"')
  })

  it('does NOT render the timeline for an empty kernelOps array', () => {
    const html = renderToStaticMarkup(
      createElement(FeatureTree, { operations: [], kernelOps: [] })
    )
    expect(html).not.toContain('data-testid="cad-kernel-timeline"')
  })

  it('renders the timeline section with one row per kernel op', () => {
    const html = renderToStaticMarkup(
      createElement(FeatureTree, {
        operations: [],
        kernelOps: [unionBox(), patternRect(), filletAll()],
        ...editCallbacks
      })
    )
    expect(html).toContain('data-testid="cad-kernel-timeline"')
    const rows = html.match(/data-testid="cad-kernel-row"/g) ?? []
    expect(rows).toHaveLength(3)
    // Friendly labels, not raw snake_case kinds.
    expect(html).toContain('Union box')
    expect(html).toContain('Rect pattern 2×1')
    expect(html).toContain('Fillet all · 0.5 mm')
  })

  it('renders the timeline even when the sidecar operations list is empty', () => {
    // A built model whose script was cleared still has a timeline worth editing.
    const html = renderToStaticMarkup(
      createElement(FeatureTree, {
        operations: [],
        kernelOps: [unionBox()],
        ...editCallbacks
      })
    )
    expect(html).not.toContain('data-testid="cad-feature-empty-state"')
    expect(html).toContain('data-testid="cad-kernel-timeline"')
  })
})

describe('FeatureTree timeline — per-op controls', () => {
  it('renders move up/down, suppress, roll-back, and delete controls per row', () => {
    const html = renderToStaticMarkup(
      createElement(FeatureTree, {
        operations: [],
        kernelOps: [unionBox(), filletAll()],
        ...editCallbacks
      })
    )
    expect((html.match(/data-testid="cad-kernel-move-up"/g) ?? []).length).toBe(2)
    expect((html.match(/data-testid="cad-kernel-move-down"/g) ?? []).length).toBe(2)
    expect((html.match(/data-testid="cad-kernel-suppress"/g) ?? []).length).toBe(2)
    expect((html.match(/data-testid="cad-kernel-rollback"/g) ?? []).length).toBe(2)
    expect((html.match(/data-testid="cad-kernel-delete"/g) ?? []).length).toBe(2)
  })

  it('the delete button is enabled when onKernelDelete is supplied', () => {
    const html = renderToStaticMarkup(
      createElement(FeatureTree, {
        operations: [],
        kernelOps: [unionBox()],
        ...editCallbacks
      })
    )
    const delBtn = html.match(/<button[^>]*data-testid="cad-kernel-delete"[^>]*>/)
    expect(delBtn).not.toBeNull()
    expect(delBtn?.[0].includes('disabled')).toBe(false)
  })

  it('disables move-up on the first row and move-down on the last row', () => {
    const html = renderToStaticMarkup(
      createElement(FeatureTree, {
        operations: [],
        kernelOps: [unionBox(), patternRect()],
        ...editCallbacks
      })
    )
    // First move-up button is disabled; first move-down is not.
    const firstUp = html.match(/<button[^>]*data-testid="cad-kernel-move-up"[^>]*>/)
    expect(firstUp?.[0].includes('disabled')).toBe(true)
  })

  it('makes rows draggable when edit callbacks are present', () => {
    const html = renderToStaticMarkup(
      createElement(FeatureTree, {
        operations: [],
        kernelOps: [unionBox(), filletAll()],
        ...editCallbacks
      })
    )
    const firstRow = html.match(/<li[^>]*data-testid="cad-kernel-row"[^>]*>/)
    expect(firstRow?.[0].includes('draggable="true"')).toBe(true)
  })
})

describe('FeatureTree timeline — suppress visuals', () => {
  it('marks a suppressed op with the --suppressed modifier + data flag', () => {
    const html = renderToStaticMarkup(
      createElement(FeatureTree, {
        operations: [],
        kernelOps: [unionBox(), { ...filletAll(), suppressed: true }],
        ...editCallbacks
      })
    )
    expect(html).toContain('cad-kernel-row--suppressed')
    // The suppressed row carries data-suppressed="true".
    expect(html).toMatch(/data-testid="cad-kernel-row"[^>]*data-suppressed="true"/)
    // Suppress button reflects aria-pressed for the suppressed row.
    expect(html).toContain('aria-pressed="true"')
  })

  it('does not apply the suppressed modifier to active ops', () => {
    const html = renderToStaticMarkup(
      createElement(FeatureTree, {
        operations: [],
        kernelOps: [unionBox()],
        ...editCallbacks
      })
    )
    expect(html).not.toContain('cad-kernel-row--suppressed')
    expect(html).toMatch(/data-suppressed="false"/)
  })
})

describe('FeatureTree timeline — roll-back visuals', () => {
  it('greys ops below the marker and shows the Clear button', () => {
    const html = renderToStaticMarkup(
      createElement(FeatureTree, {
        operations: [],
        kernelOps: [unionBox(), patternRect(), filletAll()],
        rolledBackTo: 0, // keep only op 0; ops 1 and 2 are rolled back
        ...editCallbacks
      })
    )
    // The marker row gets the --marker stripe.
    expect(html).toContain('cad-kernel-row--marker')
    // Two rows below the marker are greyed.
    expect((html.match(/cad-kernel-row--rolled-back/g) ?? []).length).toBe(2)
    expect((html.match(/data-rolled-back="true"/g) ?? []).length).toBe(2)
    // The header Clear button appears when a marker is set.
    expect(html).toContain('data-testid="cad-kernel-rollback-clear"')
  })

  it('does not render the Clear button or rolled-back rows with no marker', () => {
    const html = renderToStaticMarkup(
      createElement(FeatureTree, {
        operations: [],
        kernelOps: [unionBox(), patternRect()],
        ...editCallbacks
      })
    )
    expect(html).not.toContain('data-testid="cad-kernel-rollback-clear"')
    expect(html).not.toContain('cad-kernel-row--rolled-back')
    expect(html).not.toContain('cad-kernel-row--marker')
  })

  it('treats a -1 marker as "build all" (no greyed rows)', () => {
    const html = renderToStaticMarkup(
      createElement(FeatureTree, {
        operations: [],
        kernelOps: [unionBox(), filletAll()],
        rolledBackTo: -1,
        ...editCallbacks
      })
    )
    expect(html).not.toContain('cad-kernel-row--rolled-back')
    expect(html).not.toContain('cad-kernel-row--marker')
  })
})

describe('FeatureTree timeline — read-only (no edit callbacks)', () => {
  it('renders rows but does not make them draggable when callbacks are omitted', () => {
    const html = renderToStaticMarkup(
      createElement(FeatureTree, {
        operations: [],
        kernelOps: [unionBox(), filletAll()]
      })
    )
    expect(html).toContain('data-testid="cad-kernel-timeline"')
    const firstRow = html.match(/<li[^>]*data-testid="cad-kernel-row"[^>]*>/)
    // draggable defaults to false (React omits draggable="false" or emits it).
    expect(firstRow?.[0].includes('draggable="true"')).toBe(false)
    // Controls are present but disabled (no handler).
    const suppressBtn = html.match(/<button[^>]*data-testid="cad-kernel-suppress"[^>]*>/)
    expect(suppressBtn?.[0].includes('disabled')).toBe(true)
    const deleteBtn = html.match(/<button[^>]*data-testid="cad-kernel-delete"[^>]*>/)
    expect(deleteBtn?.[0].includes('disabled')).toBe(true)
  })
})

describe('kernelOpLabel + isRolledBack (pure helpers)', () => {
  it('kernelOpLabel maps each kind to a friendly verb + noun', () => {
    expect(kernelOpLabel(unionBox())).toBe('Union box')
    expect(kernelOpLabel(filletAll(1.5))).toBe('Fillet all · 1.5 mm')
    expect(kernelOpLabel({ kind: 'fillet_select', radiusMm: 2, edgeDirection: '+Z' })).toBe(
      'Fillet +Z · 2 mm'
    )
    expect(kernelOpLabel({ kind: 'shell_inward', thicknessMm: 2 })).toBe('Shell 2 mm')
  })

  it('isRolledBack: ops strictly after the marker are rolled back', () => {
    expect(isRolledBack(0, 1)).toBe(false)
    expect(isRolledBack(1, 1)).toBe(false) // the marker row itself is kept
    expect(isRolledBack(2, 1)).toBe(true)
    expect(isRolledBack(2, undefined)).toBe(false)
    expect(isRolledBack(2, -1)).toBe(false)
  })
})
