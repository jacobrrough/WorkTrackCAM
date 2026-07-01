/**
 * Over-constraint CONFLICT NAMING — surface render pins + canvas wiring pins.
 *
 * Split the repo's node-SSR way (renderToStaticMarkup; no jsdom):
 *
 *  1. HUD MESSAGE RENDER. A count-over design (fix + fix + horizontal — the
 *     same fixture the S5.1 badge test uses) is render-reachable at the
 *     surface's resting state, so the culprit line is pinned as REAL markup:
 *     the message NAMES the blamed constraint ("Horizontal on L1") with the
 *     removal hint, and the one-click Remove button is present. A healthy
 *     design renders neither.
 *
 *  2. CANVAS GLYPH WIRING (source pins). The error-styled culprit glyph is
 *     imperative canvas paint (no SSR markup), so the wiring is pinned as
 *     source text, matching the sibling canvas pin style: the
 *     `conflictConstraintIds` prop exists + is threaded from the surface, the
 *     overlay resolves the `--err` token, and the add-time BLOCK path names
 *     its blocker via `explainRedundantAutoConstraint`.
 *
 *  3. CSS pins for the new `.sketch-surface__conflict*` classes (danger-keyed,
 *     matching the structural `--over` pill).
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
const CANVAS_SRC = readFileSync(join(__dirname, '..', 'Sketch2DCanvas.tsx'), 'utf8')
const COCKPIT_CSS = readFileSync(
  join(__dirname, '..', '..', 'styles', 'shell', 'design-cockpit.css'),
  'utf8'
)

function render(design: DesignFileV2): string {
  return renderToStaticMarkup(createElement(SketchSurface, { design, onDesignChange: noop }))
}

/**
 * Count-over fixture: both endpoints fix-pinned AND a horizontal between them.
 * The equation count reads over (−1 DOF); the blame Jacobian sees the
 * horizontal's row as all-zero (no free columns) → h1 is the named culprit.
 */
function fixedPairWithHorizontal(): DesignFileV2 {
  return {
    ...emptyDesign(),
    points: { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
    entities: [{ id: 'l', kind: 'polyline', pointIds: ['a', 'b'], closed: false }],
    constraints: [
      { id: 'f1', type: 'fix', pointId: 'a' },
      { id: 'f2', type: 'fix', pointId: 'b' },
      { id: 'h1', type: 'horizontal', a: { pointId: 'a' }, b: { pointId: 'b' } }
    ]
  }
}

/** Two free points, one honest horizontal — healthy (under-constrained). */
function healthyLine(): DesignFileV2 {
  return {
    ...emptyDesign(),
    points: { a: { x: 0, y: 0 }, b: { x: 10, y: 1 } },
    entities: [{ id: 'l', kind: 'polyline', pointIds: ['a', 'b'], closed: false }],
    constraints: [{ id: 'h1', type: 'horizontal', a: { pointId: 'a' }, b: { pointId: 'b' } }]
  }
}

// ── 1. HUD message render ─────────────────────────────────────────────────────

describe('over-constraint culprit naming — HUD render (SketchSurface)', () => {
  it('an over-constrained design NAMES the culprit with the removal hint', () => {
    const html = render(fixedPairWithHorizontal())
    expect(html).toContain('data-testid="sketch-surface-conflict-culprit"')
    expect(html).toContain('data-blame-status="culprits"')
    // The exact operator-facing sentence: named constraint + actionable hint.
    expect(html).toContain(
      'Over-constrained — Horizontal on L1 conflicts; remove it or another constraint on these entities.'
    )
  })

  it('the named culprit gets a one-click Remove button (the delete affordance)', () => {
    const html = render(fixedPairWithHorizontal())
    expect(html).toContain('data-testid="sketch-surface-conflict-remove"')
    expect(html).toContain('Delete Horizontal on L1 and re-solve (one undo step)')
  })

  it('a healthy sketch renders NO culprit line and NO remove button', () => {
    const html = render(healthyLine())
    expect(html).not.toContain('data-testid="sketch-surface-conflict-culprit"')
    expect(html).not.toContain('data-testid="sketch-surface-conflict-remove"')
  })

  it('an empty sketch renders neither (blame memo gated off)', () => {
    const html = render(emptyDesign())
    expect(html).not.toContain('sketch-surface-conflict')
  })
})

// ── 2. Canvas glyph + block-path wiring (source pins) ─────────────────────────

describe('over-constraint culprit naming — canvas wiring pins', () => {
  it('the surface threads the culprit ids into the canvas glyph prop', () => {
    expect(SURFACE_SRC).toContain('conflictConstraintIds={conflictCulpritIdSet}')
  })

  it('the canvas declares the additive conflictConstraintIds prop', () => {
    expect(CANVAS_SRC).toContain('conflictConstraintIds?: ReadonlySet<string>')
  })

  it('the culprit glyph paints in the ERROR token (live --err, literal fallback)', () => {
    const overlay = CANVAS_SRC.slice(
      CANVAS_SRC.indexOf('// Over-constraint culprit glyphs'),
      CANVAS_SRC.indexOf('// Over-constraint culprit glyphs') + 2400
    )
    expect(overlay).toContain("getPropertyValue('--err')")
    expect(overlay).toContain("'#e0726f'")
    expect(overlay).toContain('constraintAnchorWorld(design, con)')
    expect(overlay).toContain('constraintDisplayPointsWorld(design, con)')
  })

  it('the auto-constraint BLOCK path names the blocking constraint at add time', () => {
    expect(CANVAS_SRC).toContain('explainRedundantAutoConstraint(')
    expect(CANVAS_SRC).toContain('already implied by ${sketchConstraintTypeLabel(blocker.type)}')
  })

  it('the rank gate itself is untouched (exactly one keepRankIndependent call)', () => {
    expect(CANVAS_SRC.match(/keepRankIndependent\(/g) ?? []).toHaveLength(1)
  })
})

// ── 3. CSS pins ───────────────────────────────────────────────────────────────

describe('over-constraint culprit naming — CSS (design-cockpit.css)', () => {
  it('the conflict line + remove button classes exist and are danger-keyed', () => {
    expect(COCKPIT_CSS).toContain('.sketch-surface__conflict {')
    expect(COCKPIT_CSS).toContain('.sketch-surface__conflict-remove {')
    const block = COCKPIT_CSS.slice(
      COCKPIT_CSS.indexOf('.sketch-surface__conflict {'),
      COCKPIT_CSS.indexOf('.sketch-surface__conflict {') + 900
    )
    expect(block).toContain('var(--danger')
    // Distinct from the warn-keyed residual-conflict badge tint.
    expect(block).not.toContain('var(--warn')
  })
})
