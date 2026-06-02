/**
 * AssemblyView — CAD V2 multi-part assembly render-pin.
 *
 * Pinned contracts (see file-header of `../AssemblyView.tsx` for the
 * authoritative list):
 *   1. Empty-state branch: shared `EmptyState` (CLAUDE.md rule), CTA
 *      labelled "Add part to assembly", and the canonical testid
 *      `design-assembly-empty`.
 *   2. Populated-state branch: toolbar with `data-testid="design-assembly-add"`
 *      AND `data-testid="design-assembly-remove"`; the latter is
 *      disabled until a row is selected.
 *   3. Each part row exposes `data-testid="design-assembly-part-{id}"`
 *      AND a per-row remove handle with `-remove` suffix.
 *   4. The component's root container always carries
 *      `data-testid="design-assembly-view"`.
 *   5. `formatTransformSummary` is pure and exported (so future
 *      "edit transform" surfaces can format the same way).
 *
 * Why `renderToStaticMarkup`? Matches the existing DesignWorkspace
 * render-pin convention (see `DesignWorkspace.test.tsx` header). The
 * project's node-env vitest does not ship a DOM, so we exercise the
 * static render path. `useEffect` does not run in SSR, which means the
 * `cad.createAssembly` / `cad.tessellateAssembly` bridges are never
 * touched in the test — keeping the suite hermetic.
 */

import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  AssemblyView,
  formatTransformSummary,
  type AssemblyMate,
  type AssemblyPart,
} from '../AssemblyView'

// ── window.fab shim (matches existing renderer-test convention) ────────────
//
// `AssemblyView` reads `fab().cad` ONLY inside a useEffect, which never
// runs under `renderToStaticMarkup`. We still install a shim so any
// future refactor that touches the bridge at render time fails loudly
// instead of crashing on a missing `globalThis.window`.
const gAsRecord = globalThis as unknown as Record<string, unknown>
if (gAsRecord['window'] === undefined) {
  gAsRecord['window'] = globalThis
}
if (gAsRecord['fab'] === undefined) {
  gAsRecord['fab'] = { cad: {} }
}

const samplePart = (overrides: Partial<AssemblyPart> = {}): AssemblyPart => ({
  id: 'p1',
  name: 'Bracket',
  handle: 'script:abcdef',
  ...overrides,
})

// ── (A) Module shape ───────────────────────────────────────────────────────

describe('AssemblyView — module surface', () => {
  it('exports AssemblyView and formatTransformSummary', () => {
    expect(typeof AssemblyView).toBe('function')
    expect(typeof formatTransformSummary).toBe('function')
  })

  it('formatTransformSummary returns "identity" when no transform is provided', () => {
    expect(formatTransformSummary(samplePart())).toBe('identity')
  })

  it('formatTransformSummary returns the tuple summary for a non-zero offset', () => {
    expect(
      formatTransformSummary(samplePart({ transform: { position: [10, 0, 0] } })),
    ).toBe('@(10, 0, 0)')
  })

  it('formatTransformSummary honours an explicit transformSummary override', () => {
    expect(
      formatTransformSummary(samplePart({ transformSummary: 'A1' })),
    ).toBe('A1')
  })
})

// ── (B) Empty-state branch ─────────────────────────────────────────────────

describe('AssemblyView — empty-state render contract', () => {
  it('renders the shared EmptyState with the design-assembly-empty testid', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, { parts: [], onAddPart: vi.fn() }),
    )
    expect(html).toContain('data-testid="design-assembly-view"')
    expect(html).toContain('data-testid="design-assembly-empty"')
    expect(html).toContain('No parts in this assembly')
  })

  it('shows an "Add part to assembly" CTA when onAddPart is supplied', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, { parts: [], onAddPart: vi.fn() }),
    )
    expect(html).toContain('Add part to assembly')
  })

  it('hides the CTA entirely when no onAddPart handler is wired', () => {
    const html = renderToStaticMarkup(createElement(AssemblyView, { parts: [] }))
    expect(html).toContain('design-assembly-empty')
    // EmptyState CTA wrapper class only ships when `cta` is supplied.
    expect(html).not.toContain('empty-state__cta')
  })

  it('uses the BEM-aware design-assembly--empty modifier class', () => {
    const html = renderToStaticMarkup(createElement(AssemblyView, { parts: [] }))
    expect(html).toContain('design-assembly--empty')
  })
})

// ── (C) Populated-state branch ─────────────────────────────────────────────

describe('AssemblyView — populated-state render contract', () => {
  const parts: readonly AssemblyPart[] = [
    samplePart({ id: 'p1', name: 'Bracket' }),
    samplePart({ id: 'p2', name: 'Plate', transform: { position: [25, 0, 0] } }),
  ]

  it('renders the toolbar with Add + Remove testids', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, {
        parts,
        onAddPart: vi.fn(),
        onRemovePart: vi.fn(),
      }),
    )
    expect(html).toContain('data-testid="design-assembly-add"')
    expect(html).toContain('data-testid="design-assembly-remove"')
  })

  it('disables the toolbar Remove button when no row is selected', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, {
        parts,
        onRemovePart: vi.fn(),
      }),
    )
    expect(html).toMatch(/data-testid="design-assembly-remove"[^>]*disabled/)
  })

  it('enables the toolbar Remove button when initialSelectedPartId seeds a selection', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, {
        parts,
        onRemovePart: vi.fn(),
        initialSelectedPartId: 'p1',
      }),
    )
    // The boolean `disabled` attribute is rendered bare (`disabled=""`)
    // when enabled, and absent when not — we assert by checking for
    // BOTH the canonical `disabled=""` and the boolean `disabled>` /
    // `disabled ` shapes. `aria-disabled="false"` is acceptable (matches
    // the JSX runtime convention) and does NOT count as disabled.
    const removeMatch = html.match(/data-testid="design-assembly-remove"[^>]*>/)
    expect(removeMatch).not.toBeNull()
    // Strip the aria-disabled attribute so it does not trigger the
    // substring check.
    const tagWithoutAria = removeMatch?.[0].replace(/aria-disabled="[^"]*"/, '') ?? ''
    expect(/[\s"]disabled(=|>|\s|$)/.test(tagWithoutAria)).toBe(false)
  })

  it('renders one row per part with the canonical per-row testid', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, {
        parts,
        onRemovePart: vi.fn(),
      }),
    )
    expect(html).toContain('data-testid="design-assembly-part-p1"')
    expect(html).toContain('data-testid="design-assembly-part-p2"')
    // Each row carries a remove handle.
    expect(html).toContain('data-testid="design-assembly-part-p1-remove"')
    expect(html).toContain('data-testid="design-assembly-part-p2-remove"')
  })

  it('renders the per-row transform summary inline', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, { parts, onRemovePart: vi.fn() }),
    )
    expect(html).toContain('identity')
    expect(html).toContain('@(25, 0, 0)')
  })

  it('renders the viewport-summary placeholder with the canonical testid', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, { parts, onAddPart: vi.fn() }),
    )
    expect(html).toContain('data-testid="design-assembly-viewport"')
    expect(html).toContain('data-testid="design-assembly-summary"')
    expect(html).toContain('Assembly preview')
  })

  it('marks the selected row with the BEM --selected modifier class', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, {
        parts,
        onRemovePart: vi.fn(),
        initialSelectedPartId: 'p2',
      }),
    )
    // The p2 row carries the selected modifier; p1 does NOT.
    // Match the full <li ...> tag and assert both the testid + class
    // co-occur — attribute order is JSX-runtime dependent.
    const p1Match = html.match(/<li[^>]*data-testid="design-assembly-part-p1"[^>]*>/) ??
      html.match(/<li[^>]*class="[^"]*"[^>]*data-testid="design-assembly-part-p1"[^>]*>/)
    const p2Match = html.match(/<li[^>]*data-testid="design-assembly-part-p2"[^>]*>/) ??
      html.match(/<li[^>]*class="[^"]*"[^>]*data-testid="design-assembly-part-p2"[^>]*>/)
    expect(p1Match).not.toBeNull()
    expect(p2Match).not.toBeNull()
    expect(p2Match?.[0].includes('design-assembly__row--selected')).toBe(true)
    expect(p1Match?.[0].includes('design-assembly__row--selected')).toBe(false)
  })

  it('does not produce console errors on a typical render', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* swallow */ })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { /* swallow */ })
    try {
      renderToStaticMarkup(
        createElement(AssemblyView, {
          parts,
          onAddPart: vi.fn(),
          onRemovePart: vi.fn(),
          onToast: vi.fn(),
        }),
      )
      expect(errSpy).not.toHaveBeenCalled()
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      errSpy.mockRestore()
      warnSpy.mockRestore()
    }
  })
})

// ── (D) V1.5 Mates panel render contract ────────────────────────────────
//
// New surface added by the CAD V1.5 wave. The Mates panel sits inside the
// `<aside>` parts column so the operator can scan parts + mates in one
// pass. The panel only renders when the host wires a `mates` prop;
// callers that haven't opted in get the legacy V1 surface untouched.

describe('AssemblyView — V1.5 Mates panel render contract', () => {
  const parts: readonly AssemblyPart[] = [
    samplePart({ id: 'p1', name: 'Bracket' }),
    samplePart({ id: 'p2', name: 'Plate' }),
  ]

  it('omits the Mates panel entirely when `mates` is undefined', () => {
    // Backwards compat pin: callers that haven't opted in to V1.5 must
    // not see any of the new mate testids leak into their render output.
    const html = renderToStaticMarkup(
      createElement(AssemblyView, { parts, onAddPart: vi.fn() }),
    )
    expect(html).not.toContain('data-testid="design-assembly-mates"')
    expect(html).not.toContain('data-testid="design-assembly-mate-add"')
  })

  it('renders the Mates panel with its canonical testid when mates=[] is provided', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, {
        parts,
        mates: [],
        onAddMate: vi.fn(),
      }),
    )
    expect(html).toContain('data-testid="design-assembly-mates"')
    expect(html).toContain('data-testid="design-assembly-mates-empty"')
    expect(html).toContain('No mates defined yet.')
  })

  it('hides the "Define mate" CTA entirely when onAddMate is not wired', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, {
        parts,
        mates: [],
      }),
    )
    expect(html).toContain('data-testid="design-assembly-mates"')
    expect(html).not.toContain('data-testid="design-assembly-mate-add"')
  })

  it('disables the "Define mate" CTA when fewer than two parts exist', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, {
        parts: [samplePart({ id: 'solo', name: 'Solo' })],
        mates: [],
        onAddMate: vi.fn(),
      }),
    )
    expect(html).toMatch(/data-testid="design-assembly-mate-add"[^>]*disabled/)
  })

  it('renders one row per mate with stable testids', () => {
    const mates: AssemblyMate[] = [
      {
        id: 'm-alpha',
        kind: 'point',
        part1Id: 'p1',
        feature1: 0,
        part2Id: 'p2',
        feature2: 3,
      },
      {
        id: 'm-beta',
        kind: 'axis',
        part1Id: 'p1',
        feature1: 1,
        part2Id: 'p2',
        feature2: 4,
      },
    ]
    const html = renderToStaticMarkup(
      createElement(AssemblyView, {
        parts,
        mates,
        onAddMate: vi.fn(),
        onRemoveMate: vi.fn(),
      }),
    )
    expect(html).toContain('data-testid="design-assembly-mate-m-alpha"')
    expect(html).toContain('data-testid="design-assembly-mate-m-beta"')
    // Per-row remove handles only when onRemoveMate is wired.
    expect(html).toContain('data-testid="design-assembly-mate-m-alpha-remove"')
    expect(html).toContain('data-testid="design-assembly-mate-m-beta-remove"')
  })

  it('renders the kind label + part name summary inline for each mate', () => {
    const mates: AssemblyMate[] = [
      {
        id: 'm1',
        kind: 'plane',
        part1Id: 'p1',
        feature1: 2,
        part2Id: 'p2',
        feature2: 5,
      },
    ]
    const html = renderToStaticMarkup(
      createElement(AssemblyView, {
        parts,
        mates,
        onAddMate: vi.fn(),
      }),
    )
    // Kind label uses the user-facing capitalization, not the wire enum.
    expect(html).toContain('Plane')
    // Summary contains both part display names + the feature ids.
    expect(html).toContain('Bracket')
    expect(html).toContain('Plate')
    expect(html).toContain('#2')
    expect(html).toContain('#5')
  })

  it('falls back to the part id when a mate references an unknown part', () => {
    // Defensive contract: a stale mate (part removed) renders the raw id
    // rather than crashing. This is the "host's onRemoveMate didn't fire
    // for this mate" failure mode.
    const mates: AssemblyMate[] = [
      {
        id: 'stale',
        kind: 'point',
        part1Id: 'ghost-part',
        feature1: 0,
        part2Id: 'p2',
        feature2: 0,
      },
    ]
    const html = renderToStaticMarkup(
      createElement(AssemblyView, { parts, mates, onAddMate: vi.fn() }),
    )
    expect(html).toContain('ghost-part')
  })

  it('omits the empty-state placeholder when at least one mate is present', () => {
    const mates: AssemblyMate[] = [
      {
        id: 'm1',
        kind: 'point',
        part1Id: 'p1',
        feature1: 0,
        part2Id: 'p2',
        feature2: 0,
      },
    ]
    const html = renderToStaticMarkup(
      createElement(AssemblyView, { parts, mates, onAddMate: vi.fn() }),
    )
    expect(html).not.toContain('design-assembly-mates-empty')
    expect(html).toContain('data-testid="design-assembly-mates-list"')
  })
})

// ── (E) V1.5 mate modal render contract ─────────────────────────────────
//
// The modal is closed by default. Tests use the `initialMateModalOpen`
// render-pin escape hatch to assert the markup without simulating clicks
// (renderToStaticMarkup does not run effects).

describe('AssemblyView — V1.5 mate modal render contract', () => {
  const parts: readonly AssemblyPart[] = [
    samplePart({ id: 'p1', name: 'Bracket' }),
    samplePart({ id: 'p2', name: 'Plate' }),
  ]

  it('hides the mate modal by default', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, {
        parts,
        mates: [],
        onAddMate: vi.fn(),
      }),
    )
    expect(html).not.toContain('data-testid="design-assembly-mate-modal"')
  })

  it('renders the modal when initialMateModalOpen seeds it open', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, {
        parts,
        mates: [],
        onAddMate: vi.fn(),
        initialMateModalOpen: true,
      }),
    )
    expect(html).toContain('data-testid="design-assembly-mate-modal"')
    expect(html).toContain('data-testid="design-assembly-mate-modal-confirm"')
    expect(html).toContain('data-testid="design-assembly-mate-modal-cancel"')
  })

  it('renders the kind / part / feature picker controls inside the modal', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, {
        parts,
        mates: [],
        onAddMate: vi.fn(),
        initialMateModalOpen: true,
      }),
    )
    expect(html).toContain('data-testid="design-assembly-mate-modal-kind"')
    expect(html).toContain('data-testid="design-assembly-mate-modal-part1"')
    expect(html).toContain('data-testid="design-assembly-mate-modal-feature1"')
    expect(html).toContain('data-testid="design-assembly-mate-modal-part2"')
    expect(html).toContain('data-testid="design-assembly-mate-modal-feature2"')
  })
})

// ── (F) Phase 3: Solver-status badge + Solve button render contract ────────
//
// These tests use the `initialConvergenceReport` render-pin escape hatch so
// the static `renderToStaticMarkup` path can assert badge text without
// calling `window.fab.assemblySolve` (which requires jsdom + IPC).

describe('AssemblyView — Phase 3 solver-status badge render contract', () => {
  const parts: readonly AssemblyPart[] = [
    samplePart({ id: 'p1', name: 'Bracket' }),
    samplePart({ id: 'p2', name: 'Plate' }),
  ]

  it('renders the Solve button in the populated toolbar', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, {
        parts,
        onAddPart: vi.fn(),
      }),
    )
    expect(html).toContain('data-testid="design-assembly-solve"')
    expect(html).toContain('Solve')
  })

  it('renders the Not-solved badge (gray) when no initialConvergenceReport is seeded', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, {
        parts,
        onAddPart: vi.fn(),
      }),
    )
    expect(html).toContain('data-testid="design-assembly-solver-badge"')
    expect(html).toContain('Not solved')
    expect(html).toContain('design-assembly__solver-badge--not-solved')
  })

  it('renders a green Converged badge when initialConvergenceReport has status converged', () => {
    const report = {
      converged: true,
      iterations: 7,
      finalResidual: 0.0000003,
      perConstraintResiduals: [],
      status: 'converged' as const,
    }
    const html = renderToStaticMarkup(
      createElement(AssemblyView, {
        parts,
        onAddPart: vi.fn(),
        initialConvergenceReport: report,
      }),
    )
    expect(html).toContain('design-assembly__solver-badge--converged')
    expect(html).toContain('Converged in 7')
    expect(html).toContain('3.00e-7')
  })

  it('renders a yellow Under-constrained badge with DOF count', () => {
    const report = {
      converged: false,
      iterations: 0,
      finalResidual: 0,
      perConstraintResiduals: [],
      status: 'under_constrained' as const,
      freeVariableCount: 3,
    }
    const html = renderToStaticMarkup(
      createElement(AssemblyView, {
        parts,
        onAddPart: vi.fn(),
        initialConvergenceReport: report,
      }),
    )
    expect(html).toContain('design-assembly__solver-badge--under-constrained')
    expect(html).toContain('Under-constrained: 3 DOF free')
  })

  it('renders a red Over-constrained badge with conflicting ids', () => {
    const report = {
      converged: false,
      iterations: 0,
      finalResidual: 0,
      perConstraintResiduals: [],
      status: 'over_constrained' as const,
      conflictingConstraintIds: ['m1', 'm2'],
    }
    const html = renderToStaticMarkup(
      createElement(AssemblyView, {
        parts,
        onAddPart: vi.fn(),
        initialConvergenceReport: report,
      }),
    )
    expect(html).toContain('design-assembly__solver-badge--over-constrained')
    expect(html).toContain('Over-constrained')
    expect(html).toContain('m1')
    expect(html).toContain('m2')
  })

  it('renders an error badge for max_iterations_reached', () => {
    const report = {
      converged: false,
      iterations: 100,
      finalResidual: 0.01,
      perConstraintResiduals: [],
      status: 'max_iterations_reached' as const,
    }
    const html = renderToStaticMarkup(
      createElement(AssemblyView, {
        parts,
        onAddPart: vi.fn(),
        initialConvergenceReport: report,
      }),
    )
    expect(html).toContain('design-assembly__solver-badge--error')
    expect(html).toContain('max iterations reached')
  })
})
