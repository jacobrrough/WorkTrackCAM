/**
 * Sketch S5.1 — the conflict-AWARE DOF badge gating + the dead-CSS cleanups.
 *
 * Three contracts, split the repo's node-SSR way (renderToStaticMarkup; no jsdom,
 * no pointer events, no state flush):
 *
 *  1. BADGE GATING (source pins). The badge upgrades to a residual-detected
 *     'conflicting' verdict ONLY when the live design is SETTLED (came out of a
 *     solve-bearing edit). SSR can't drive the `designSettled` state machine, so
 *     the gating WIRING is pinned as source text on SketchSurface.tsx:
 *       - the badge reads `analyzeSketchDofSettled(design, designSettled)`;
 *       - ONLY the two re-solving handlers mark the result settled
 *         (`applyDesignEdit(..., true)`); every other mutation clears it;
 *       - undo/redo + the raw mutation paths reset the settled gate.
 *     The pure gating LOGIC itself is unit-tested in sketch-dof-seam.test.ts.
 *
 *  2. BADGE RENDER (per count-driven status). The count-only verdicts
 *     (empty/under/fully/over) are pure-derived from the `design` prop and render
 *     at the surface's resting `designSettled === false`, so each is
 *     render-pinnable. Critically, a CONSTRAINT-FREE design NEVER renders
 *     'conflicting' (the honesty bar) — proven at the component level here.
 *
 *  3. CSS CLEANUPS (class-exists pins). The new `.sketch-surface__dof--conflicting`
 *     modifier exists + is warn-keyed; and the previously-DEAD `.label--inline-flex-6`
 *     class (referenced by Sketch2DCanvas, defined in no stylesheet) is now a real
 *     inline-flex utility.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SketchSurface } from '../SketchSurface'
import { emptyDesign, type DesignFileV2 } from '../../../shared/design-schema'

// ── window shim (matches the sibling SketchSurface tests) ────────────────────
const gAsRecord = globalThis as unknown as Record<string, unknown>
if (gAsRecord['window'] === undefined) gAsRecord['window'] = globalThis
if (gAsRecord['fab'] === undefined) gAsRecord['fab'] = { cad: {} }

const noop = (): void => undefined

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const SURFACE_SRC = readFileSync(join(__dirname, '..', 'SketchSurface.tsx'), 'utf8')
const SEAM_SRC = readFileSync(join(__dirname, '..', 'sketch-dof-seam.ts'), 'utf8')
const CANVAS_SRC = readFileSync(join(__dirname, '..', 'Sketch2DCanvas.tsx'), 'utf8')
const COCKPIT_CSS = readFileSync(
  join(__dirname, '..', '..', 'styles', 'shell', 'design-cockpit.css'),
  'utf8'
)

function render(design: DesignFileV2): string {
  return renderToStaticMarkup(createElement(SketchSurface, { design, onDesignChange: noop }))
}

/** Two free points joined by an open polyline (4 DOF, no constraints). */
function twoFreePoints(): DesignFileV2 {
  return {
    ...emptyDesign(),
    points: { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
    entities: [{ id: 'l', kind: 'polyline', pointIds: ['a', 'b'], closed: false }]
  }
}

/**
 * A segment carrying two CONFLICTING distance constraints (10 and 80) — the
 * count reads 'under', but the geometry can't satisfy both, so a SETTLED read
 * would flag 'conflicting'. At the surface's resting (unsettled) state it must
 * read the count-only 'under' (the honesty bar).
 */
function conflictingDistances(): DesignFileV2 {
  return {
    ...twoFreePoints(),
    parameters: { lenA: 10, lenB: 80 },
    constraints: [
      { id: 'dA', type: 'distance', a: { pointId: 'a' }, b: { pointId: 'b' }, parameterKey: 'lenA' },
      { id: 'dB', type: 'distance', a: { pointId: 'a' }, b: { pointId: 'b' }, parameterKey: 'lenB' }
    ]
  }
}

// ── 1. Badge gating — source pins (SSR cannot drive the settled state) ────────

describe('S5.1 — conflict-aware DOF badge gating (SketchSurface source pins)', () => {
  it('the badge reads the SETTLED-gated seam, not the count-only one', () => {
    expect(SURFACE_SRC).toContain("import { analyzeSketchDofSettled } from './sketch-dof-seam'")
    expect(SURFACE_SRC).toContain('analyzeSketchDofSettled(design, designSettled)')
    // The count-only export must NOT be what the badge reads anymore.
    expect(SURFACE_SRC).not.toContain('useMemo(() => analyzeSketchDof(design)')
  })

  it('only the two re-solving handlers mark the result SETTLED', () => {
    // Constraint apply + dimension-value edit both re-solve (solveSketchToTolerance
    // / applyDimensionValue) and pass solved=true — exactly once each, and no
    // other call site claims settled.
    expect(
      SURFACE_SRC.match(/applyDesignEdit\(solveSketchToTolerance\(withConstraint\), true\)/g) ?? []
    ).toHaveLength(1)
    expect(SURFACE_SRC.match(/applyDesignEdit\(next, true\)/g) ?? []).toHaveLength(1)
    // No OTHER `applyDesignEdit(..., true)` settled apply exists: the only call
    // sites passing the solved flag as `true` are those two. (Counted as the two
    // literal forms above; any third settled apply would be a new literal here.)
    const settledCalls = [
      ...(SURFACE_SRC.match(/applyDesignEdit\(solveSketchToTolerance\(withConstraint\), true\)/g) ??
        []),
      ...(SURFACE_SRC.match(/applyDesignEdit\(next, true\)/g) ?? [])
    ]
    expect(settledCalls).toHaveLength(2)
  })

  it('applyDesignEdit defaults to UNSETTLED (solved=false) and sets the gate', () => {
    expect(SURFACE_SRC).toContain('function applyDesignEdit(next: DesignFileV2, solved = false): void')
    expect(SURFACE_SRC).toContain('setDesignSettled(solved)')
  })

  it('undo / redo drop the settled gate (a restored snapshot is not a fresh solve)', () => {
    const undoBody = SURFACE_SRC.slice(
      SURFACE_SRC.indexOf('function performUndo'),
      SURFACE_SRC.indexOf('function handleEntityPick')
    )
    // both performUndo and performRedo live in this slice and each clear settled.
    expect(undoBody.match(/setDesignSettled\(false\)/g) ?? []).toHaveLength(2)
  })

  it('every non-solving mutation path clears the settled gate', () => {
    // move / delete-selected / node move / node insert / node delete / DXF import
    // all reset settled to false so a prior solved state never lingers.
    // 2 (undo+redo) + 6 (non-solving mutations) = 8 explicit clears total.
    expect(SURFACE_SRC.match(/setDesignSettled\(false\)/g) ?? []).toHaveLength(8)
  })

  it('the badge still hides itself on the empty verdict', () => {
    expect(SURFACE_SRC).toContain("dofReport.status !== 'empty'")
  })

  it('the conflicting verdict gets a residual-conflict title that keeps the "approx" qualifier', () => {
    const badgeBlock = SURFACE_SRC.slice(
      SURFACE_SRC.indexOf('data-testid="sketch-surface-dof-badge"'),
      SURFACE_SRC.indexOf('sketch-surface__count')
    )
    expect(badgeBlock).toContain("dofReport.status === 'conflicting'")
    // both title branches carry the honesty qualifier.
    expect(badgeBlock).toContain('(approx')
  })
})

// ── 2. Badge render — per count-driven status (the honesty bar) ───────────────

describe('S5.1 — DOF badge render (count-driven verdicts at the resting state)', () => {
  it('a CONSTRAINT-FREE design NEVER renders "conflicting" (reads under)', () => {
    const html = render(twoFreePoints())
    expect(html).toContain('data-dof-status="under"')
    expect(html).not.toContain('data-dof-status="conflicting"')
    expect(html).not.toContain('Conflicting')
  })

  it('a conflict design at the resting (unsettled) state reads count-only "under", NOT conflicting', () => {
    // The surface mounts with designSettled === false, so even a genuinely
    // conflicting design must fall back to the honest count verdict until a
    // solve-bearing edit settles it.
    const html = render(conflictingDistances())
    expect(html).toContain('data-dof-status="under"')
    expect(html).not.toContain('data-dof-status="conflicting"')
  })

  it('a count-over design still renders "over" (count-visible, settled-independent)', () => {
    const d: DesignFileV2 = {
      ...twoFreePoints(),
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

  it('an empty sketch renders no badge', () => {
    expect(render(emptyDesign())).not.toContain('data-testid="sketch-surface-dof-badge"')
  })
})

// ── 3. CSS cleanups — class-exists pins ──────────────────────────────────────

describe('S5.1 — CSS cleanups (design-cockpit.css)', () => {
  it('the conflicting DOF badge modifier exists and is warn-keyed (distinct from over/danger)', () => {
    expect(COCKPIT_CSS).toContain('.sketch-surface__dof--conflicting')
    const block = COCKPIT_CSS.slice(
      COCKPIT_CSS.indexOf('.sketch-surface__dof--conflicting'),
      COCKPIT_CSS.indexOf('.sketch-surface__dof--conflicting') + 220
    )
    expect(block).toContain('var(--warn')
    // It must NOT reuse the structural-over danger token.
    expect(block).not.toContain('var(--danger')
  })

  it('every DOF status the seam can emit has a colour modifier', () => {
    for (const mod of ['fully', 'under', 'over', 'conflicting']) {
      expect(COCKPIT_CSS, mod).toContain(`.sketch-surface__dof--${mod}`)
    }
  })

  it('the previously-DEAD .label--inline-flex-6 class is now a real inline-flex utility', () => {
    expect(COCKPIT_CSS).toContain('.label--inline-flex-6')
    const block = COCKPIT_CSS.slice(
      COCKPIT_CSS.indexOf('.label--inline-flex-6 {'),
      COCKPIT_CSS.indexOf('.label--inline-flex-6 {') + 160
    )
    expect(block).toContain('display: inline-flex')
    expect(block).toContain('align-items: center')
    // "6" names the gap → var(--sp-3) (6px).
    expect(block).toContain('gap: var(--sp-3)')
  })

  it('Sketch2DCanvas still references the class (the cleanup DEFINED it, did not remove usage)', () => {
    expect(CANVAS_SRC).toContain('label--inline-flex-6')
  })
})

// ── seam wiring sanity (the new export the badge depends on) ──────────────────

describe('S5.1 — seam exposes the conflict-aware analyzer', () => {
  it('sketch-dof-seam exports analyzeSketchDofSettled and the conflicting verdict', () => {
    expect(SEAM_SRC).toContain('export function analyzeSketchDofSettled(')
    expect(SEAM_SRC).toContain("case 'conflicting':")
    expect(SEAM_SRC).toContain("'fully' | 'under' | 'over' | 'conflicting' | 'empty'")
    // The plain count-only analyzer is kept intact (additive, not replaced).
    expect(SEAM_SRC).toContain('export function analyzeSketchDof(')
  })
})
