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
  copyPart,
  mirrorPartPosition,
  mirrorPositionAcrossPlane,
  ASSEMBLY_COPY_OFFSET_MM,
  MIRROR_PLANES,
  MIRROR_PLANE_LABEL,
  type AssemblyMate,
  type AssemblyPart,
  type MirrorPlane,
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

// ── (H) Phase-4 durable Mate constraints panel (list / edit / delete / suppress)
//
// The REACHABLE mate surface: one row per persisted `mateConstraints` entry with
// kind label · resolved part names · scalar (distance mm / angle deg) · suppress /
// dangling flags · Edit / Suppress / Delete actions (gated on onMateConstraintsChange)
// · shared EmptyState when empty · an inline scalar editor (initialEditingMateId).
// These are render-pins (renderToStaticMarkup) — the persist round-trip itself is
// proven in assembly-mate-persist.test.ts + workspace-host-handoff.test.ts.

describe('AssemblyView — Phase-4 Mate constraints panel', () => {
  const twoParts: readonly AssemblyPart[] = [
    samplePart({ id: 'p1', name: 'Bracket' }),
    samplePart({ id: 'p2', name: 'Plate' }),
  ]
  const distanceMate = {
    id: 'md',
    kind: 'distance' as const,
    part1Id: 'p1',
    feature1: { x: 0, y: 0, z: 0 },
    part2Id: 'p2',
    feature2: { x: 0, y: 0, z: 0 },
    value: 12,
  }
  const angleMate = {
    id: 'ma',
    kind: 'angle' as const,
    part1Id: 'p1',
    feature1: { axis: 'x' as const },
    part2Id: 'p2',
    feature2: { axis: 'x' as const },
    value: 90,
  }
  const coincidentMate = {
    id: 'mc',
    kind: 'coincident' as const,
    part1Id: 'p1',
    feature1: { x: 0, y: 0, z: 0 },
    part2Id: 'p2',
    feature2: { x: 0, y: 0, z: 0 },
  }

  it('renders the panel + shared EmptyState when no mateConstraints exist', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, { parts: twoParts }),
    )
    expect(html).toContain('data-testid="design-assembly-mate-constraints"')
    expect(html).toContain('data-testid="design-assembly-mate-constraints-empty"')
    expect(html).toContain('No mates yet')
    // Empty-state hint points the operator at the authoring panel.
    expect(html).toContain('Define mate')
    // Count reads 0.
    expect(html).toContain('0 mates')
  })

  it('lists a row per mate with kind label, resolved part names, and the count', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, {
        parts: twoParts,
        mateConstraints: [coincidentMate, distanceMate],
      }),
    )
    expect(html).toContain('data-testid="design-assembly-mate-constraints-list"')
    expect(html).toContain('data-testid="design-assembly-mate-constraint-mc"')
    expect(html).toContain('data-testid="design-assembly-mate-constraint-md"')
    // Kind labels use the SOLVER vocabulary (Coincident/Distance), resolved names.
    expect(html).toContain('Coincident')
    expect(html).toContain('Bracket')
    expect(html).toContain('Plate')
    expect(html).toContain('2 mates')
    // Empty state is gone once populated.
    expect(html).not.toContain('design-assembly-mate-constraints-empty')
  })

  it('shows the key scalar for distance (mm) and angle (deg) rows', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, {
        parts: twoParts,
        mateConstraints: [distanceMate, angleMate],
      }),
    )
    expect(html).toContain('data-testid="design-assembly-mate-constraint-md-scalar"')
    expect(html).toContain('12 mm')
    expect(html).toContain('data-testid="design-assembly-mate-constraint-ma-scalar"')
    expect(html).toContain('90°')
  })

  it('omits the scalar span for a non-scalar kind (coincident)', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, {
        parts: twoParts,
        mateConstraints: [coincidentMate],
      }),
    )
    expect(html).not.toContain('data-testid="design-assembly-mate-constraint-mc-scalar"')
  })

  it('is READ-ONLY (no row actions) when onMateConstraintsChange is absent', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, {
        parts: twoParts,
        mateConstraints: [distanceMate],
      }),
    )
    expect(html).not.toContain('data-testid="design-assembly-mate-constraint-md-remove"')
    expect(html).not.toContain('data-testid="design-assembly-mate-constraint-md-edit"')
    expect(html).not.toContain('data-testid="design-assembly-mate-constraint-md-suppress"')
  })

  it('exposes Delete + Suppress on every row and Edit only on scalar rows when wired', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, {
        parts: twoParts,
        mateConstraints: [coincidentMate, distanceMate],
        onMateConstraintsChange: vi.fn(),
      }),
    )
    // Delete + Suppress on both rows.
    expect(html).toContain('data-testid="design-assembly-mate-constraint-mc-remove"')
    expect(html).toContain('data-testid="design-assembly-mate-constraint-mc-suppress"')
    expect(html).toContain('data-testid="design-assembly-mate-constraint-md-remove"')
    expect(html).toContain('data-testid="design-assembly-mate-constraint-md-suppress"')
    // Edit ONLY on the scalar (distance) row — coincident has no editable value.
    expect(html).toContain('data-testid="design-assembly-mate-constraint-md-edit"')
    expect(html).not.toContain('data-testid="design-assembly-mate-constraint-mc-edit"')
  })

  it('flags a suppressed mate (chip + data attr) and toggles the button label to Enable', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, {
        parts: twoParts,
        mateConstraints: [{ ...distanceMate, suppress: true }],
        onMateConstraintsChange: vi.fn(),
      }),
    )
    expect(html).toContain('data-testid="design-assembly-mate-constraint-md-suppressed-flag"')
    expect(html).toContain('data-suppressed="true"')
    // Suppressed row's toggle offers re-enable.
    expect(html).toContain('>Enable<')
  })

  it('flags a dangling mate (part removed) as deletable but withholds Edit/Suppress', () => {
    // 'p2' is NOT in the parts list → the mate dangles.
    const html = renderToStaticMarkup(
      createElement(AssemblyView, {
        parts: [samplePart({ id: 'p1', name: 'Bracket' })],
        mateConstraints: [distanceMate],
        onMateConstraintsChange: vi.fn(),
      }),
    )
    expect(html).toContain('data-testid="design-assembly-mate-constraint-md-dangling-flag"')
    expect(html).toContain('data-dangling="true"')
    // Delete stays available; Edit/Suppress are withheld for a dangling row.
    expect(html).toContain('data-testid="design-assembly-mate-constraint-md-remove"')
    expect(html).not.toContain('data-testid="design-assembly-mate-constraint-md-edit"')
    expect(html).not.toContain('data-testid="design-assembly-mate-constraint-md-suppress"')
  })

  it('opens the inline scalar editor when initialEditingMateId seeds it', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, {
        parts: twoParts,
        mateConstraints: [distanceMate],
        onMateConstraintsChange: vi.fn(),
        initialEditingMateId: 'md',
      }),
    )
    expect(html).toContain('data-testid="design-assembly-mate-constraint-md-editor"')
    expect(html).toContain('data-testid="design-assembly-mate-constraint-md-editor-input"')
    expect(html).toContain('data-testid="design-assembly-mate-constraint-md-editor-apply"')
    // The input seeds from the mate's current value.
    expect(html).toMatch(/design-assembly-mate-constraint-md-editor-input"[^>]*value="12"/)
    // The distance editor labels its unit.
    expect(html).toContain('Distance (mm)')
  })

  it('does not render the inline editor when the id does not match a mate', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, {
        parts: twoParts,
        mateConstraints: [distanceMate],
        onMateConstraintsChange: vi.fn(),
        initialEditingMateId: 'nope',
      }),
    )
    expect(html).not.toContain('design-assembly-mate-constraint-md-editor"')
  })
})

// ── (K) Assembly 3D viewport wiring (AssemblyViewport3D) ────────────────────
//
// The viewport column now mounts the real R3F scene component. In node/SSR that
// component degrades to the summary placeholder (the Canvas needs WebGL), so the
// legacy `design-assembly-summary` pins keep working — these tests assert the
// column is wired to the new component AND the view-only explode slider ships.
describe('AssemblyView — 3D viewport + explode wiring', () => {
  const parts: readonly AssemblyPart[] = [
    samplePart({ id: 'p1', name: 'Bracket' }),
    samplePart({ id: 'p2', name: 'Plate', transform: { position: [25, 0, 0] } }),
  ]
  const coincidentMate = {
    id: 'mc',
    kind: 'coincident' as const,
    part1Id: 'p1',
    feature1: { x: 0, y: 0, z: 0 },
    part2Id: 'p2',
    feature2: { x: 0, y: 0, z: 0 },
  }

  it('still renders the summary fallback (Assembly preview) via the guard in node', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, { parts, onAddPart: vi.fn() }),
    )
    // The AssemblyViewport3D node-guard degrades to the SAME placeholder markup.
    expect(html).toContain('data-testid="design-assembly-viewport"')
    expect(html).toContain('data-testid="design-assembly-summary"')
    expect(html).toContain('Assembly preview')
    // The Canvas must NOT mount in node — no <canvas> element leaks.
    expect(html).not.toContain('<canvas')
  })

  it('renders the view-only explode slider with its readout', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, { parts, onAddPart: vi.fn() }),
    )
    expect(html).toContain('data-testid="design-assembly-explode"')
    expect(html).toContain('data-testid="design-assembly-explode-slider"')
    expect(html).toContain('data-testid="design-assembly-explode-readout"')
    // Default factor is 0 → the readout reads 0%.
    expect(html).toContain('0%')
  })

  it('seeds the explode slider at 0 (assembled) on mount', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, { parts, onAddPart: vi.fn() }),
    )
    // The range input value is the rounded 0..100 percentage.
    expect(html).toMatch(/data-testid="design-assembly-explode-slider"[^>]*value="0"/)
  })

  it('surfaces the mate-count line through the viewport fallback', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, {
        parts,
        mateConstraints: [coincidentMate],
      }),
    )
    // A non-empty mateConstraints list drives the mate-count caption.
    expect(html).toContain('data-testid="design-assembly-mate-count"')
    expect(html).toContain('1 mate positioning parts')
  })
})

// ── (L) Phase-4 (Assemble): Copy / Mirror position (pure folds) ──────────────
//
// copyPart / mirrorPartPosition are the node-unit-testable pure helpers (mirror
// of applySolvedTransforms): a copy duplicates an instance with a fresh id +
// non-overlapping offset; a mirror reflects the TRANSLATION across a principal
// plane (perpendicular axis negated) and preserves orientation. These prove the
// math + the mate-non-follow contract without a DOM.

describe('copyPart — duplicates an instance with a fresh id + offset', () => {
  const source: AssemblyPart = {
    id: 'src',
    name: 'Bracket',
    handle: 'script:abc',
    geometrySource: 'script:abc',
    transform: { position: [10, 20, 30], rotation: [0, 45, 0] },
    joint: 'revolute',
    grounded: false,
    jointLimits: { scalarMinDeg: -90, scalarMaxDeg: 90 },
  }

  it('gives the copy a distinct id (mates on the original do NOT follow it)', () => {
    const copy = copyPart(source, 'copy-1')
    expect(copy.id).toBe('copy-1')
    expect(copy.id).not.toBe(source.id)
  })

  it('offsets the copy +X by ASSEMBLY_COPY_OFFSET_MM so it does not z-fight', () => {
    const copy = copyPart(source, 'copy-1')
    expect(copy.transform?.position).toEqual([10 + ASSEMBLY_COPY_OFFSET_MM, 20, 30])
    // Rotation is carried unchanged (a copy is the same part, re-placed).
    expect(copy.transform?.rotation).toEqual([0, 45, 0])
  })

  it('keeps the same geometrySource (distinct instance, shared body — not a new body)', () => {
    const copy = copyPart(source, 'copy-1')
    expect(copy.geometrySource).toBe('script:abc')
    expect(copy.handle).toBe('script:abc')
  })

  it('carries joint kind + grounded + jointLimits across unchanged', () => {
    const copy = copyPart(source, 'copy-1')
    expect(copy.joint).toBe('revolute')
    expect(copy.grounded).toBe(false)
    expect(copy.jointLimits).toEqual({ scalarMinDeg: -90, scalarMaxDeg: 90 })
  })

  it('suffixes the name with " copy" and recomputes the transform summary', () => {
    const copy = copyPart(source, 'copy-1')
    expect(copy.name).toBe('Bracket copy')
    expect(copy.transformSummary).toBe(`@(${10 + ASSEMBLY_COPY_OFFSET_MM}, 20, 30)`)
  })

  it('defaults a part with no transform to identity + the +X offset', () => {
    const copy = copyPart({ id: 'x', name: 'Solo', handle: 'h' }, 'copy-2')
    expect(copy.transform?.position).toEqual([ASSEMBLY_COPY_OFFSET_MM, 0, 0])
    expect(copy.transform?.rotation).toEqual([0, 0, 0])
  })

  it('does not carry any mate reference (the copy is mate-free by construction)', () => {
    // The AssemblyPart shape has no mate field — the mate list is host-owned and
    // keyed by part id. A fresh id therefore cannot inherit the original's mates.
    const copy = copyPart(source, 'copy-3')
    expect(Object.keys(copy)).not.toContain('mates')
    expect(Object.keys(copy)).not.toContain('mateConstraints')
  })
})

describe('mirrorPositionAcrossPlane — reflects the perpendicular axis', () => {
  it('xy plane negates Z', () => {
    expect(mirrorPositionAcrossPlane([1, 2, 3], 'xy')).toEqual([1, 2, -3])
  })
  it('xz plane negates Y', () => {
    expect(mirrorPositionAcrossPlane([1, 2, 3], 'xz')).toEqual([1, -2, 3])
  })
  it('yz plane negates X', () => {
    expect(mirrorPositionAcrossPlane([1, 2, 3], 'yz')).toEqual([-1, 2, 3])
  })
  it('exposes exactly the three principal planes with labels', () => {
    expect(MIRROR_PLANES).toEqual(['xy', 'xz', 'yz'])
    expect(MIRROR_PLANE_LABEL).toEqual({ xy: 'XY', xz: 'XZ', yz: 'YZ' })
  })
})

describe('mirrorPartPosition — reflects translation, preserves orientation', () => {
  const source: AssemblyPart = {
    id: 'src',
    name: 'Bracket',
    handle: 'script:abc',
    geometrySource: 'script:abc',
    transform: { position: [10, 20, 30], rotation: [15, 0, 0] },
  }

  it('reflects across YZ (negate X) then nudges +X so it separates from the source', () => {
    const m = mirrorPartPosition(source, 'yz', 'mir-1')
    // -10 reflected, then + offset.
    expect(m.transform?.position).toEqual([-10 + ASSEMBLY_COPY_OFFSET_MM, 20, 30])
  })

  it('reflects across XY (negate Z)', () => {
    const m = mirrorPartPosition(source, 'xy', 'mir-2')
    expect(m.transform?.position).toEqual([10 + ASSEMBLY_COPY_OFFSET_MM, 20, -30])
  })

  it('reflects across XZ (negate Y)', () => {
    const m = mirrorPartPosition(source, 'xz', 'mir-3')
    expect(m.transform?.position).toEqual([10 + ASSEMBLY_COPY_OFFSET_MM, -20, 30])
  })

  it('preserves orientation (position mirror only — the documented honesty rule)', () => {
    const m = mirrorPartPosition(source, 'yz', 'mir-4')
    // Rotation is NOT reflected: a true geometric mirror needs a reflected mesh
    // the kernel does not expose, so orientation is carried across unchanged.
    expect(m.transform?.rotation).toEqual([15, 0, 0])
  })

  it('gives the mirror a fresh id + a plane-labelled name (mates do NOT follow)', () => {
    const m = mirrorPartPosition(source, 'xz', 'mir-5')
    expect(m.id).toBe('mir-5')
    expect(m.id).not.toBe(source.id)
    expect(m.name).toBe('Bracket mirror XZ')
    // Same geometry body (shared source), distinct instance.
    expect(m.geometrySource).toBe('script:abc')
  })

  MIRROR_PLANES.forEach((plane: MirrorPlane) => {
    it(`round-trips a double mirror across ${plane} back to the source translation (modulo the +X offset)`, () => {
      const once = mirrorPartPosition(source, plane, 'a')
      // Strip the offset the mirror added so a second reflection lands cleanly.
      const stripped: AssemblyPart = {
        ...once,
        transform: {
          position: [
            (once.transform!.position![0] as number) - ASSEMBLY_COPY_OFFSET_MM,
            once.transform!.position![1] as number,
            once.transform!.position![2] as number,
          ],
          rotation: once.transform!.rotation,
        },
      }
      const twice = mirrorPartPosition(stripped, plane, 'b')
      expect(twice.transform?.position).toEqual([
        10 + ASSEMBLY_COPY_OFFSET_MM,
        20,
        30,
      ])
    })
  })
})

// ── (M) Copy / Mirror / Visibility — render pins (renderToStaticMarkup) ──────
//
// The click handlers never fire under SSR, so these prove the AFFORDANCES render
// (Copy / Mirror buttons only when onPartsChange is wired; the eye toggle always;
// a view-hidden row dims + shows a pressed eye via initialHiddenPartIds).

describe('AssemblyView — Copy / Mirror row actions render contract', () => {
  const parts: readonly AssemblyPart[] = [
    samplePart({ id: 'p1', name: 'Bracket' }),
    samplePart({ id: 'p2', name: 'Plate', transform: { position: [25, 0, 0] } }),
  ]

  it('renders Copy + Mirror (three planes) per row when onPartsChange is wired', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, { parts, onPartsChange: vi.fn() }),
    )
    expect(html).toContain('data-testid="design-assembly-part-p1-copy"')
    expect(html).toContain('data-testid="design-assembly-part-p1-mirror"')
    expect(html).toContain('data-testid="design-assembly-part-p1-mirror-xy"')
    expect(html).toContain('data-testid="design-assembly-part-p1-mirror-xz"')
    expect(html).toContain('data-testid="design-assembly-part-p1-mirror-yz"')
    // The action is labelled "Mirror position" to keep the honesty contract.
    expect(html).toContain('Mirror position')
  })

  it('HIDES Copy + Mirror when onPartsChange is NOT wired (additive / read-only)', () => {
    const html = renderToStaticMarkup(createElement(AssemblyView, { parts }))
    expect(html).not.toContain('data-testid="design-assembly-part-p1-copy"')
    expect(html).not.toContain('data-testid="design-assembly-part-p1-mirror"')
  })

  it('always renders the visibility eye toggle (view-only — needs no host wiring)', () => {
    const html = renderToStaticMarkup(createElement(AssemblyView, { parts }))
    expect(html).toContain('data-testid="design-assembly-part-p1-visibility"')
    expect(html).toContain('data-testid="design-assembly-part-p2-visibility"')
  })
})

describe('AssemblyView — visibility (view-only) render contract', () => {
  const parts: readonly AssemblyPart[] = [
    samplePart({ id: 'p1', name: 'Bracket' }),
    samplePart({ id: 'p2', name: 'Plate' }),
  ]

  it('dims a view-hidden row (--hidden modifier + data-hidden) and presses its eye', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, { parts, initialHiddenPartIds: ['p1'] }),
    )
    const p1Row = html.match(/<li[^>]*data-testid="design-assembly-part-p1"[^>]*>/)?.[0] ?? ''
    const p2Row = html.match(/<li[^>]*data-testid="design-assembly-part-p2"[^>]*>/)?.[0] ?? ''
    expect(p1Row).toContain('design-assembly__row--hidden')
    expect(p1Row).toContain('data-hidden="true"')
    // The other row is NOT hidden.
    expect(p2Row).not.toContain('design-assembly__row--hidden')
    // The hidden row's eye toggle reads pressed + offers "Show".
    const eye = html.match(/data-testid="design-assembly-part-p1-visibility"[^>]*>/)?.[0] ?? ''
    expect(eye).toContain('aria-pressed="true"')
    expect(html).toMatch(/data-testid="design-assembly-part-p1-visibility"[\s\S]*?>Show</)
  })

  it('a visible row offers "Hide" and is not pressed (default: nothing hidden)', () => {
    const html = renderToStaticMarkup(createElement(AssemblyView, { parts }))
    const eye = html.match(/data-testid="design-assembly-part-p1-visibility"[^>]*>/)?.[0] ?? ''
    expect(eye).toContain('aria-pressed="false"')
    expect(html).toMatch(/data-testid="design-assembly-part-p1-visibility"[\s\S]*?>Hide</)
  })

  it('filters hidden parts out of the 3D viewport (summary fallback counts only visible)', () => {
    // In node-env the viewport degrades to the summary fallback, which reports the
    // count of the parts it was HANDED — so a hidden part drops the count by one.
    const shown = renderToStaticMarkup(createElement(AssemblyView, { parts }))
    expect(shown).toContain('2 parts')
    const oneHidden = renderToStaticMarkup(
      createElement(AssemblyView, { parts, initialHiddenPartIds: ['p1'] }),
    )
    // Only the visible part reaches the viewport → "1 part".
    expect(oneHidden).toContain('1 part')
    expect(oneHidden).not.toContain('2 parts')
  })

  it('SUPPRESS vs HIDDEN distinction: a hidden part STAYS in the BOM (hidden != suppressed)', () => {
    // Hidden is view-only. The BOM (and solve / interference) still count the
    // part — that separation is the whole point of keeping hidden distinct from
    // suppress. A hidden part therefore still produces a BOM line.
    const sourced: readonly AssemblyPart[] = [
      samplePart({ id: 'p1', name: 'Bracket', geometrySource: 'design/bracket.step' }),
    ]
    const shown = renderToStaticMarkup(createElement(AssemblyView, { parts: sourced }))
    const hidden = renderToStaticMarkup(
      createElement(AssemblyView, { parts: sourced, initialHiddenPartIds: ['p1'] }),
    )
    // The BOM row is present in BOTH renders (hiding does not drop the line).
    expect(shown).toContain('data-testid="design-assembly-bom-row-p1"')
    expect(hidden).toContain('data-testid="design-assembly-bom-row-p1"')
    expect(hidden).toContain('1 line')
  })

  it('does not emit console errors rendering copy/mirror/visibility affordances', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* swallow */ })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { /* swallow */ })
    try {
      renderToStaticMarkup(
        createElement(AssemblyView, {
          parts,
          onPartsChange: vi.fn(),
          onRemovePart: vi.fn(),
          onToast: vi.fn(),
          initialHiddenPartIds: ['p2'],
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

// ── (N) wave-8 — persisted visibility seed + dangling badge render pins ───────

describe('AssemblyView — persisted visibility seed (from parts[].hidden)', () => {
  it('seeds the hidden set from a row carrying hidden:true (no initialHiddenPartIds)', () => {
    // The reload path hands AssemblyView rows whose `hidden` flag came off disk.
    // Without the render-pin override, the mount-time seed must dim those rows.
    const parts: readonly AssemblyPart[] = [
      samplePart({ id: 'p1', name: 'Bracket', hidden: true }),
      samplePart({ id: 'p2', name: 'Plate' }),
    ]
    const html = renderToStaticMarkup(createElement(AssemblyView, { parts }))
    const p1Row = html.match(/<li[^>]*data-testid="design-assembly-part-p1"[^>]*>/)?.[0] ?? ''
    const p2Row = html.match(/<li[^>]*data-testid="design-assembly-part-p2"[^>]*>/)?.[0] ?? ''
    expect(p1Row).toContain('design-assembly__row--hidden')
    expect(p1Row).toContain('data-hidden="true"')
    expect(p2Row).not.toContain('design-assembly__row--hidden')
    // The persisted-hidden row's eye reads pressed (Show), the visible one Hide.
    expect(html).toMatch(/data-testid="design-assembly-part-p1-visibility"[\s\S]*?>Show</)
    expect(html).toMatch(/data-testid="design-assembly-part-p2-visibility"[\s\S]*?>Hide</)
  })

  it('initialHiddenPartIds OVERRIDES the row-derived seed (render-pin escape hatch)', () => {
    // A row is persisted hidden:true, but the explicit render-pin seed hides a
    // DIFFERENT row — the override wins so static tests stay deterministic.
    const parts: readonly AssemblyPart[] = [
      samplePart({ id: 'p1', name: 'Bracket', hidden: true }),
      samplePart({ id: 'p2', name: 'Plate' }),
    ]
    const html = renderToStaticMarkup(
      createElement(AssemblyView, { parts, initialHiddenPartIds: ['p2'] }),
    )
    const p1Row = html.match(/<li[^>]*data-testid="design-assembly-part-p1"[^>]*>/)?.[0] ?? ''
    const p2Row = html.match(/<li[^>]*data-testid="design-assembly-part-p2"[^>]*>/)?.[0] ?? ''
    // The explicit seed hides p2 and leaves p1 visible (override, not merge).
    expect(p2Row).toContain('design-assembly__row--hidden')
    expect(p1Row).not.toContain('design-assembly__row--hidden')
  })
})

describe('AssemblyView — dangling external-STEP badge render contract', () => {
  it('renders the dangling badge + row modifier via initialDanglingPartIds', () => {
    const parts: readonly AssemblyPart[] = [
      samplePart({ id: 'p1', name: 'M6 bolt' }),
      samplePart({ id: 'p2', name: 'Plate' }),
    ]
    const html = renderToStaticMarkup(
      createElement(AssemblyView, { parts, initialDanglingPartIds: ['p1'] }),
    )
    const p1Row = html.match(/<li[^>]*data-testid="design-assembly-part-p1"[^>]*>/)?.[0] ?? ''
    const p2Row = html.match(/<li[^>]*data-testid="design-assembly-part-p2"[^>]*>/)?.[0] ?? ''
    // The dangling row is flagged + carries the badge; the other row is clean.
    expect(p1Row).toContain('design-assembly__row--dangling')
    expect(p1Row).toContain('data-dangling="true"')
    expect(html).toContain('data-testid="design-assembly-part-p1-dangling"')
    expect(p2Row).not.toContain('design-assembly__row--dangling')
    expect(html).not.toContain('data-testid="design-assembly-part-p2-dangling"')
    // The dangling row is STILL deletable (never silently dropped) when a remove
    // handler is wired.
  })

  it('a dangling row stays deletable (remove button rendered when onRemovePart wired)', () => {
    const parts: readonly AssemblyPart[] = [samplePart({ id: 'p1', name: 'M6 bolt' })]
    const html = renderToStaticMarkup(
      createElement(AssemblyView, {
        parts,
        initialDanglingPartIds: ['p1'],
        onRemovePart: vi.fn(),
      }),
    )
    expect(html).toContain('data-testid="design-assembly-part-p1-dangling"')
    expect(html).toContain('data-testid="design-assembly-part-p1-remove"')
  })

  it('no dangling badge when nothing is flagged (default)', () => {
    const parts: readonly AssemblyPart[] = [samplePart({ id: 'p1', name: 'Bracket' })]
    const html = renderToStaticMarkup(createElement(AssemblyView, { parts }))
    expect(html).not.toContain('data-testid="design-assembly-part-p1-dangling"')
    expect(html).not.toContain('design-assembly__row--dangling')
  })
})
