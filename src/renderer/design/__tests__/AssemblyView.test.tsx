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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  AssemblyView,
  applySolvedTransforms,
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

// ── (G) CAD foundation: durable mate constraints + hydrated-row honesty ──────
//
// The reload surface (#9) feeds the AssemblyView a `mateConstraints` array
// (durable Model-C constraints hydrated from assembly.json). These pins prove:
//   - the constraints are surfaced (a visible "N mates positioning parts"
//     readout), so a SAVED assembly demonstrably shows its mates;
//   - the prop is additive — omitting it leaves the legacy render untouched;
//   - a part hydrated from disk (blank `handle`) renders an honest
//     "geometry not loaded" placeholder rather than crashing or faking a body.

describe('AssemblyView — durable mate constraints (reload surface feed)', () => {
  const parts: readonly AssemblyPart[] = [
    samplePart({ id: 'p1', name: 'Bracket' }),
    samplePart({ id: 'p2', name: 'Plate' }),
  ]
  const mateConstraints = [
    {
      id: 'm1',
      kind: 'coincident' as const,
      part1Id: 'p1',
      feature1: { x: 0, y: 0, z: 0 },
      part2Id: 'p2',
      feature2: { x: 0, y: 0, z: 0 },
    },
  ]

  it('surfaces a mate-count readout when durable mateConstraints are present', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, { parts, mateConstraints }),
    )
    expect(html).toContain('data-testid="design-assembly-mate-count"')
    expect(html).toContain('1 mate positioning parts')
  })

  it('pluralizes the mate-count readout', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, {
        parts,
        mateConstraints: [
          mateConstraints[0]!,
          { ...mateConstraints[0]!, id: 'm2' },
        ],
      }),
    )
    expect(html).toContain('2 mates positioning parts')
  })

  it('omits the mate-count readout entirely when no mateConstraints are supplied (additive)', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, { parts }),
    )
    expect(html).not.toContain('data-testid="design-assembly-mate-count"')
  })

  it('the solve-input component mapping includes partPath (else parseAssemblyFile rejects it)', () => {
    // Source pin: `assembly:solve` re-parses the input through parseAssemblyFile,
    // whose component schema requires a non-empty partPath. handleSolve must
    // carry it so feeding real mateConstraints actually reaches the solver
    // instead of throwing a ZodError. A refactor that drops partPath here would
    // silently break "mates position parts" — pin it.
    const src = readFileSync(join(__dirname, '..', 'AssemblyView.tsx'), 'utf-8')
    expect(src).toContain('partPath: partPathForRow(part)')
  })
})

// ── (G) Solver apply-back: solved poses are forwarded + mapped onto part rows ──
//
// GAP fix: the `assembly:solve` IPC returns the solved per-component poses, but the
// renderer previously read ONLY the convergence report and dropped `res.transforms`,
// so parts never moved after a solve. `applySolvedTransforms` is the pure apply-back
// (node-env unit-testable, mirroring the form-logic split); a source pin guards the
// `handleSolve` forwarding wiring (the click handler never fires under SSR).

describe('applySolvedTransforms — maps solved poses back onto part rows', () => {
  const parts: readonly AssemblyPart[] = [
    {
      id: 'a',
      name: 'A',
      handle: 'script:a',
      transform: { position: [1, 2, 3], rotation: [0, 0, 0] },
      transformSummary: '@(1, 2, 3)',
    },
    { id: 'b', name: 'B', handle: 'script:b' },
  ]

  it('updates a matched row transform + recomputes its summary; leaves unmatched rows by reference', () => {
    const next = applySolvedTransforms(parts, [
      { id: 'a', transform: { x: 5, y: 0, z: 0, rxDeg: 0, ryDeg: 90, rzDeg: 0 } },
    ])
    const a = next.find((p) => p.id === 'a')!
    expect(a.transform?.position).toEqual([5, 0, 0])
    expect(a.transform?.rotation).toEqual([0, 90, 0])
    // Summary recomputed from the SOLVED position, not the stale '@(1, 2, 3)'.
    expect(a.transformSummary).toBe('@(5, 0, 0)')
    // The unmatched row is returned untouched (same reference — no spurious churn).
    expect(next.find((p) => p.id === 'b')).toBe(parts[1])
  })

  it('returns the input list unchanged (same reference) when there are no solved poses', () => {
    expect(applySolvedTransforms(parts, [])).toBe(parts)
  })

  it('collapses the summary to "identity" when a part solves back to the origin', () => {
    const next = applySolvedTransforms(parts, [
      { id: 'a', transform: { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 } },
    ])
    expect(next.find((p) => p.id === 'a')!.transformSummary).toBe('identity')
  })

  it('source pin: handleSolve forwards res.transforms to onSolvedTransforms (the discard-gap fix)', () => {
    // The Solve click handler never fires under renderToStaticMarkup, so pin the wiring at source.
    const src = readFileSync(join(__dirname, '..', 'AssemblyView.tsx'), 'utf-8')
    expect(src).toContain('onSolvedTransforms?.(res.transforms)')
  })
})

describe('AssemblyView — hydrated-row honesty (geometry not loaded)', () => {
  it('renders an honest placeholder for a row with a blank handle', () => {
    // A row hydrated from disk carries an empty handle until its source is
    // rebuilt; the view must say so, not pretend the body is in memory.
    const parts: readonly AssemblyPart[] = [
      { id: 'h1', name: 'FromDisk', handle: '', geometrySource: 'design/x.json' },
    ]
    const html = renderToStaticMarkup(createElement(AssemblyView, { parts }))
    expect(html).toContain('data-testid="design-assembly-part-h1-nogeo"')
    expect(html).toContain('geometry not loaded')
  })

  it('does NOT render the placeholder for a row carrying a live handle', () => {
    const parts: readonly AssemblyPart[] = [
      { id: 'live1', name: 'Live', handle: 'script:abc' },
    ]
    const html = renderToStaticMarkup(createElement(AssemblyView, { parts }))
    expect(html).not.toContain('data-testid="design-assembly-part-live1-nogeo"')
  })

  it('does not emit console errors rendering a hydrated (blank-handle) assembly', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* swallow */ })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { /* swallow */ })
    try {
      renderToStaticMarkup(
        createElement(AssemblyView, {
          parts: [
            { id: 'h1', name: 'FromDisk', handle: '', geometrySource: 'design/x.json' },
            { id: 'h2', name: 'FromDisk2', handle: '', geometrySource: 'design/y.json' },
          ],
          mateConstraints: [
            {
              id: 'm1',
              kind: 'coincident' as const,
              part1Id: 'h1',
              feature1: { x: 0, y: 0, z: 0 },
              part2Id: 'h2',
              feature2: { x: 0, y: 0, z: 0 },
            },
          ],
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

// ── (H) Interference (bbox-level clash list + row highlight) ─────────────────
//
// The AssemblyView derives a bbox-level clash report from the parts' placements
// (nominal extents) and surfaces it as a clash list + a per-row highlight. These
// pins prove: the panel + honest fidelity label always render; an overlapping
// fixture produces a clash row AND tints the offending part rows; a spaced-out
// fixture reports "clear".

describe('AssemblyView — interference (bbox-level)', () => {
  it('renders the interference panel with an honest bbox-level fidelity label', () => {
    const parts: readonly AssemblyPart[] = [
      samplePart({ id: 'p1', name: 'Bracket', transform: { position: [0, 0, 0] } }),
      samplePart({ id: 'p2', name: 'Plate', transform: { position: [500, 0, 0] } }),
    ]
    const html = renderToStaticMarkup(createElement(AssemblyView, { parts }))
    expect(html).toContain('data-testid="design-assembly-interference"')
    expect(html).toContain('data-testid="design-assembly-interference-fidelity"')
    expect(html).toContain('bbox-level')
  })

  it('reports "no interferences" for parts spaced apart', () => {
    const parts: readonly AssemblyPart[] = [
      samplePart({ id: 'p1', name: 'Bracket', transform: { position: [0, 0, 0] } }),
      samplePart({ id: 'p2', name: 'Plate', transform: { position: [500, 0, 0] } }),
    ]
    const html = renderToStaticMarkup(createElement(AssemblyView, { parts }))
    expect(html).toContain('data-testid="design-assembly-interference-clear"')
    expect(html).toContain('No interferences detected.')
    expect(html).not.toContain('data-testid="design-assembly-interference-list"')
  })

  it('lists a clash row for two parts at the same placement', () => {
    const parts: readonly AssemblyPart[] = [
      samplePart({ id: 'p1', name: 'Bracket', transform: { position: [0, 0, 0] } }),
      samplePart({ id: 'p2', name: 'Plate', transform: { position: [0, 0, 0] } }),
    ]
    const html = renderToStaticMarkup(createElement(AssemblyView, { parts }))
    expect(html).toContain('data-testid="design-assembly-interference-list"')
    // The clash row carries a deterministic id-pair testid + both part names.
    expect(html).toContain('data-testid="design-assembly-clash-p1--p2"')
    expect(html).toContain('Bracket')
    expect(html).toContain('Plate')
    // The "clear" placeholder must NOT be present when a clash exists.
    expect(html).not.toContain('data-testid="design-assembly-interference-clear"')
  })

  it('highlights the clashing part rows (--clash modifier + clash flag)', () => {
    const parts: readonly AssemblyPart[] = [
      samplePart({ id: 'p1', name: 'Bracket', transform: { position: [0, 0, 0] } }),
      samplePart({ id: 'p2', name: 'Plate', transform: { position: [0, 0, 0] } }),
    ]
    const html = renderToStaticMarkup(createElement(AssemblyView, { parts }))
    // Both rows carry the clash highlight modifier + the per-row clash flag.
    const p1Row = html.match(/<li[^>]*data-testid="design-assembly-part-p1"[^>]*>/)?.[0] ?? ''
    const p2Row = html.match(/<li[^>]*data-testid="design-assembly-part-p2"[^>]*>/)?.[0] ?? ''
    expect(p1Row).toContain('design-assembly__row--clash')
    expect(p2Row).toContain('design-assembly__row--clash')
    expect(html).toContain('data-testid="design-assembly-part-p1-clash"')
    expect(html).toContain('data-testid="design-assembly-part-p2-clash"')
  })

  it('does NOT highlight a non-clashing row', () => {
    const parts: readonly AssemblyPart[] = [
      samplePart({ id: 'p1', name: 'Bracket', transform: { position: [0, 0, 0] } }),
      samplePart({ id: 'p2', name: 'Plate', transform: { position: [500, 0, 0] } }),
    ]
    const html = renderToStaticMarkup(createElement(AssemblyView, { parts }))
    const p1Row = html.match(/<li[^>]*data-testid="design-assembly-part-p1"[^>]*>/)?.[0] ?? ''
    expect(p1Row).not.toContain('design-assembly__row--clash')
    expect(html).not.toContain('data-testid="design-assembly-part-p1-clash"')
  })
})

// ── (I) BOM table (qty / name / source) ──────────────────────────────────────
//
// The AssemblyView rolls the parts up into a source-keyed BOM table. These pins
// prove: the table renders one row per distinct source with a quantity; two
// instances of the same body collapse to qty 2; and a sourced/hydrated row still
// produces a line (never silently empty for a real part).

describe('AssemblyView — BOM table', () => {
  it('renders the BOM table with a header + one row per part source', () => {
    const parts: readonly AssemblyPart[] = [
      samplePart({ id: 'p1', name: 'Bracket', geometrySource: 'design/bracket.step' }),
      samplePart({ id: 'p2', name: 'Plate', geometrySource: 'design/plate.step' }),
    ]
    const html = renderToStaticMarkup(createElement(AssemblyView, { parts }))
    expect(html).toContain('data-testid="design-assembly-bom"')
    expect(html).toContain('data-testid="design-assembly-bom-table"')
    expect(html).toContain('Bill of materials')
    // One <tr> per distinct source, keyed by representative partId.
    expect(html).toContain('data-testid="design-assembly-bom-row-p1"')
    expect(html).toContain('data-testid="design-assembly-bom-row-p2"')
    expect(html).toContain('design/bracket.step')
    expect(html).toContain('2 lines')
  })

  it('collapses two instances of the same body into one line (qty 2)', () => {
    const parts: readonly AssemblyPart[] = [
      samplePart({ id: 'i1', name: 'Bolt', geometrySource: 'design/bolt.step' }),
      samplePart({ id: 'i2', name: 'Bolt', geometrySource: 'design/bolt.step' }),
    ]
    const html = renderToStaticMarkup(createElement(AssemblyView, { parts }))
    expect(html).toContain('1 line')
    // The single rolled-up row shows quantity 2 in the qty cell.
    const row = html.match(/<tr[^>]*data-testid="design-assembly-bom-row-i1"[\s\S]*?<\/tr>/)?.[0] ?? ''
    expect(row).toContain('design-assembly__bom-cell-qty')
    expect(row).toContain('>2<')
  })

  it('shows a BOM line even for a hydrated (blank-handle) row', () => {
    // A reloaded row with a durable geometrySource still rolls up, so the BOM is
    // never silently empty for a real part.
    const parts: readonly AssemblyPart[] = [
      { id: 'h1', name: 'FromDisk', handle: '', geometrySource: 'design/x.json' },
    ]
    const html = renderToStaticMarkup(createElement(AssemblyView, { parts }))
    expect(html).toContain('data-testid="design-assembly-bom-table"')
    expect(html).toContain('FromDisk')
    expect(html).toContain('1 line')
  })

  it('does not emit console errors rendering the interference + BOM surfaces', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* swallow */ })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { /* swallow */ })
    try {
      renderToStaticMarkup(
        createElement(AssemblyView, {
          parts: [
            samplePart({ id: 'p1', name: 'Bracket', transform: { position: [0, 0, 0] }, geometrySource: 'a.step' }),
            samplePart({ id: 'p2', name: 'Plate', transform: { position: [0, 0, 0] }, geometrySource: 'b.step' }),
          ],
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
