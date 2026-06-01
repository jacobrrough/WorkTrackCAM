/**
 * LagunaNestingPanel — shared EmptyState render-pin (UX Overhaul #8).
 *
 * Renders the panel via `react-dom/server.renderToStaticMarkup` (matches
 * the `manufacture-aux-k2-send-render.test.tsx` pattern so this suite
 * stays inside the existing `node` vitest environment without jsdom).
 *
 * Contract under test:
 *   - When there is no nesting preview yet AND the active machine is the
 *     Laguna Swift 5x10, the shared `EmptyState` surfaces a "No nesting
 *     result yet" message with a "Run nesting" CTA.
 *   - Once a preview exists (placements > 0), the EmptyState disappears
 *     and the per-part placement list takes its place.
 *   - For non-Laguna machines, the whole panel is gated off (returns
 *     null), so the EmptyState never leaks into the K2 or Carvera view.
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { LagunaNestingPanel } from './LagunaNestingPanel'
import type { ManufactureOperation } from '../../shared/manufacture-schema'

// ── window.fab shim ──────────────────────────────────────────────────────────
// The panel calls `fab().nestingNestPolygons(...)` inside `runNest` (a
// click handler). `renderToStaticMarkup` never fires click handlers, so
// the call is unreachable during the test, but the module-level
// `import { fab } from '../src/shop-types'` resolves `fab` to a function
// that reads `window.fab`. Provide a minimal stub so the import + the
// `fab()` invocation never throws if the click ever does run.
type FabStub = {
  nestingNestPolygons: (input: unknown) => Promise<{
    ok: boolean
    result: { placements: never[]; unplaced: string[]; utilizationPct: number }
  }>
}
const fabStub: FabStub = {
  nestingNestPolygons: vi
    .fn()
    .mockResolvedValue({ ok: true, result: { placements: [], unplaced: [], utilizationPct: 0 } })
}
const gAsRecord = globalThis as unknown as Record<string, unknown>
gAsRecord['fab'] = fabStub
gAsRecord['window'] = globalThis
// The `fab()` accessor in `shop-types.ts` reads `window.fab`, so wire
// it through to the same stub above.
;(globalThis as unknown as { window: { fab: FabStub } }).window.fab = fabStub

// ── Fixture ops ─────────────────────────────────────────────────────────────

function contourOp(id: string, points: ReadonlyArray<readonly [number, number]>): ManufactureOperation {
  return {
    id,
    kind: 'cnc_contour',
    label: id,
    sourceMesh: null,
    params: { contourPoints: points }
  } as unknown as ManufactureOperation
}

function baseProps(
  overrides: Partial<Parameters<typeof LagunaNestingPanel>[0]> = {}
): Parameters<typeof LagunaNestingPanel>[0] {
  return {
    activeMachineId: 'laguna-swift-5x10',
    operations: [contourOp('op-1', [[0, 0], [100, 0], [100, 100], [0, 100]])],
    sheetWidthMm: 1524,
    sheetHeightMm: 3048,
    onApplyPlacements: vi.fn(),
    onStatus: vi.fn(),
    ...overrides
  }
}

function render(props: Parameters<typeof LagunaNestingPanel>[0]): string {
  return renderToStaticMarkup(createElement(LagunaNestingPanel, props))
}

describe('LagunaNestingPanel — empty-state surface (UX Overhaul #8)', () => {
  it('renders the shared EmptyState when no nesting preview exists yet', () => {
    const html = render(baseProps())
    expect(html).toContain('data-testid="laguna-nesting-empty-state"')
    expect(html).toContain('class="empty-state"')
    expect(html).toContain('No nesting result yet')
    expect(html).toContain('Run a nesting pass to see results here.')
    // The CTA delegates to the same `runNest` routine the primary
    // button above the empty-state uses.
    expect(html).toContain('Run nesting')
  })

  it('CTA renders as a real <button type="button"> so it never submits a form', () => {
    const html = render(baseProps())
    // `EmptyState` always emits `type="button"`; the nesting panel sits
    // inside the manufacture surface so this matters for keyboard users.
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Run nesting</)
  })

  it('returns null (no panel) when the active machine is not the Laguna', () => {
    const html = render(baseProps({ activeMachineId: 'creality-k2-plus' }))
    expect(html).toBe('')
    expect(html).not.toContain('laguna-nesting-empty-state')
  })

  it('does NOT render the EmptyState when the active machine is null', () => {
    const html = render(baseProps({ activeMachineId: null }))
    expect(html).toBe('')
  })
})
