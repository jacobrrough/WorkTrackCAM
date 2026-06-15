/**
 * Sketch S5 — render + source contracts for the SketchSurface constraints
 * toolbar + the honest DOF badge.
 *
 * Repo renderer tests are node-SSR (`renderToStaticMarkup`, no jsdom / pointer
 * events). The selection state lives in the surface and SSR cannot flush a
 * click that selects, so:
 *   - RENDER: the toolbar buttons are all present + DISABLED at rest (empty
 *     selection), each is a type="button"; the DOF badge renders the right
 *     verdict for a given DESIGN PROP (the badge is pure-derived from `design`,
 *     so every status is render-pinnable without state);
 *   - SOURCE: the enablement wiring (`applicableConstraintKinds.has(kind)`), the
 *     one-undo-step routing (`applyDesignEdit(solveSketchToTolerance(...))`),
 *     and the seam consumption.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SketchSurface } from '../SketchSurface'
import { TOOLBAR_CONSTRAINT_KINDS } from '../sketch-constraint-apply'
import { emptyDesign, type DesignFileV2 } from '../../../shared/design-schema'

// ── window shim (matches the sibling SketchSurface tests) ────────────────────
const gAsRecord = globalThis as unknown as Record<string, unknown>
if (gAsRecord['window'] === undefined) gAsRecord['window'] = globalThis
if (gAsRecord['fab'] === undefined) gAsRecord['fab'] = { cad: {} }

const noop = (): void => undefined

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const SRC = readFileSync(join(__dirname, '..', 'SketchSurface.tsx'), 'utf8')

function render(design: DesignFileV2): string {
  return renderToStaticMarkup(createElement(SketchSurface, { design, onDesignChange: noop }))
}

// ── Constraints toolbar — render ─────────────────────────────────────────────

describe('SketchSurface — S5 constraints toolbar (render)', () => {
  it('renders the constraints toolbar with one button per toolbar kind', () => {
    const html = render(emptyDesign())
    expect(html).toContain('data-testid="sketch-surface-constraints"')
    for (const kind of TOOLBAR_CONSTRAINT_KINDS) {
      expect(html).toContain(`data-testid="sketch-surface-constraint-${kind}"`)
    }
  })

  it('every constraint button is disabled at rest (empty selection)', () => {
    const html = render(emptyDesign())
    for (const kind of TOOLBAR_CONSTRAINT_KINDS) {
      const tag =
        (html.match(new RegExp(`<button[^>]*data-testid="sketch-surface-constraint-${kind}"[^>]*>`)) ??
          [])[0] ?? ''
      expect(tag, kind).not.toBe('')
      expect(tag, kind).toContain('type="button"')
      expect(tag, kind).toContain('disabled')
      expect(tag, kind).toContain('data-constraint-enabled="false"')
    }
  })

  it('the toolbar is a role="toolbar" labelled region', () => {
    const html = render(emptyDesign())
    expect(html).toMatch(
      /data-testid="sketch-surface-constraints"[^>]*role="toolbar"|role="toolbar"[^>]*data-testid="sketch-surface-constraints"/
    )
    expect(html).toContain('aria-label="Sketch constraints"')
  })
})

// ── DOF badge — render (pure-derived from the design prop) ────────────────────

describe('SketchSurface — S5 DOF badge (render, per status)', () => {
  it('empty sketch → NO badge (status "empty")', () => {
    const html = render(emptyDesign())
    expect(html).not.toContain('data-testid="sketch-surface-dof-badge"')
  })

  it('points + no constraints → under-constrained badge with the DoF count', () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      points: { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
      entities: [{ id: 'l', kind: 'polyline', pointIds: ['a', 'b'], closed: false }]
    }
    const html = render(d)
    expect(html).toContain('data-testid="sketch-surface-dof-badge"')
    expect(html).toContain('data-dof-status="under"')
    expect(html).toContain('4 DoF (approx)')
  })

  it('exactly constrained → "Fully constrained (approx)" — never a bare claim', () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      points: { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
      entities: [{ id: 'l', kind: 'polyline', pointIds: ['a', 'b'], closed: false }],
      constraints: [
        { id: 'f1', type: 'fix', pointId: 'a' },
        { id: 'f2', type: 'fix', pointId: 'b' }
      ]
    }
    const html = render(d)
    expect(html).toContain('data-dof-status="fully"')
    expect(html).toContain('Fully constrained (approx)')
    expect(html).not.toContain('>Fully constrained<')
  })

  it('over-constrained → "Over-constrained (approx)"', () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      points: { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
      entities: [{ id: 'l', kind: 'polyline', pointIds: ['a', 'b'], closed: false }],
      constraints: [
        { id: 'f1', type: 'fix', pointId: 'a' },
        { id: 'f2', type: 'fix', pointId: 'b' },
        { id: 'h1', type: 'horizontal', a: { pointId: 'a' }, b: { pointId: 'b' } }
      ]
    }
    const html = render(d)
    expect(html).toContain('data-dof-status="over"')
    expect(html).toContain('Over-constrained (approx)')
  })

  it("the badge's title flags it as an approximate estimate (honesty)", () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      points: { a: { x: 0, y: 0 } },
      entities: []
    }
    const html = render(d)
    const tag =
      (html.match(/<span[^>]*data-testid="sketch-surface-dof-badge"[^>]*>/) ?? [])[0] ?? ''
    expect(tag).toContain('aria-live="polite"')
    expect(tag.toLowerCase()).toContain('approximate')
  })
})

// ── Source pins — the wiring SSR cannot exercise ─────────────────────────────

describe('SketchSurface — S5 constraint-apply + DOF source pins', () => {
  it('each button enablement reflects the live selection via applicableConstraints', () => {
    expect(SRC).toContain("from './sketch-constraint-apply'")
    expect(SRC).toContain('applicableConstraints(design, selectedIdSet)')
    expect(SRC).toContain('const enabled = applicableConstraintKinds.has(kind)')
    expect(SRC).toContain('disabled={!enabled}')
  })

  it('applying a constraint routes through applyDesignEdit + re-solve as ONE step', () => {
    const body = SRC.slice(
      SRC.indexOf('function handleApplyConstraint'),
      SRC.indexOf('honest, conflict-AWARE DOF read-out')
    )
    expect(body).toContain('addConstraintFromSelection(cur, selectedIdSet, kind)')
    // a null result is a no-op (no undo step).
    expect(body).toContain('if (!withConstraint) {')
    // the success path: re-solve to tolerance, then ONE applyDesignEdit. S5.1:
    // the apply is marked SETTLED (solved=true) so the conflict-aware badge may
    // consult the post-solve residual.
    expect(body).toContain('applyDesignEdit(solveSketchToTolerance(withConstraint), true)')
    expect(body.match(/applyDesignEdit\(/g) ?? []).toHaveLength(1)
  })

  it('the surface does NOT call solveSketch directly (re-solve lives in the pure module)', () => {
    // The exact-landing re-solve is `solveSketchToTolerance` (pure module); the
    // surface must never reach into the raw solver.
    expect(SRC).not.toContain('solveSketch(')
  })

  it('the DOF badge consumes the typed seam (S5.1 conflict-aware analyzeSketchDofSettled)', () => {
    expect(SRC).toContain("from './sketch-dof-seam'")
    // S5.1: the badge reads the conflict-aware, SETTLED-gated seam (folds in the
    // post-solve residual under a strict gate) rather than the count-only one.
    expect(SRC).toContain('analyzeSketchDofSettled(design, designSettled)')
    // the badge hides itself on the empty verdict.
    expect(SRC).toContain("dofReport.status !== 'empty'")
  })

  it('no `any` types added to the surface (CLAUDE.md rule)', () => {
    expect(SRC).not.toMatch(/:\s*any\b/)
    expect(SRC).not.toMatch(/as any\b/)
    expect(SRC).not.toMatch(/<any[,>]/)
  })
})
