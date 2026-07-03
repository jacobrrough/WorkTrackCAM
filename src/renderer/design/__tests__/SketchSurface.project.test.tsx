/**
 * PROJECT MODEL EDGES — the SketchSurface "Project" button (Fusion's Project / P).
 *
 * Repo renderer tests are node-SSR (`renderToStaticMarkup`, no jsdom / pointer
 * events). The projected-edge apply mutates surface-owned selection/history
 * state that SSR cannot flush via a click, so this file pins:
 *   - RENDER: the Project button appears in the palette Modify group ONLY when
 *     `projectableEdges` is present + non-empty; it is ABSENT with no edges (so
 *     the splash preview + every existing render-pin test render unchanged);
 *   - SOURCE: the click routes the pure `projectEdgesOntoSketch` through the
 *     `applyDesignEdit` history seam (ONE undo step), guards the empty-edges
 *     case, and emits a count toast via `onSketchHint`.
 *
 * Env: `node` + `renderToStaticMarkup` — matches the sibling SketchSurface tests.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SketchSurface } from '../SketchSurface'
import type { ProjectableEdge } from '../sketch-project-edges'
import { emptyDesign, type DesignFileV2 } from '../../../shared/design-schema'

// ── window shim (matches the sibling SketchSurface tests) ────────────────────
const gAsRecord = globalThis as unknown as Record<string, unknown>
if (gAsRecord['window'] === undefined) gAsRecord['window'] = globalThis
if (gAsRecord['fab'] === undefined) gAsRecord['fab'] = { cad: {} }

const noop = (): void => undefined

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const SRC = readFileSync(join(__dirname, '..', 'SketchSurface.tsx'), 'utf8')

const EDGES: ProjectableEdge[] = [
  { id: 'e:1', points: [[0, 0, 0], [10, 0, 5]] },
  { id: 'e:2', points: [[0, 0, 0], [0, 0, 10]] }
]

function render(design: DesignFileV2, edges?: ProjectableEdge[]): string {
  return renderToStaticMarkup(
    createElement(SketchSurface, { design, onDesignChange: noop, projectableEdges: edges })
  )
}

// ── Render — presence gated on projectableEdges ──────────────────────────────

describe('SketchSurface — Project button (render)', () => {
  it('renders the Project button when model edges are available', () => {
    const html = render(emptyDesign(), EDGES)
    const tag =
      (html.match(/<button[^>]*data-testid="sketch-surface-project"[^>]*>/) ?? [])[0] ?? ''
    expect(tag).not.toBe('')
    expect(tag).toContain('type="button"')
  })

  it('does NOT render the Project button with no edges (undefined prop)', () => {
    const html = render(emptyDesign())
    expect(html).not.toContain('data-testid="sketch-surface-project"')
  })

  it('does NOT render the Project button with an EMPTY edges array', () => {
    const html = render(emptyDesign(), [])
    expect(html).not.toContain('data-testid="sketch-surface-project"')
  })

  it('the Project button sits inside the palette (Modify group), not the status row', () => {
    const html = render(emptyDesign(), EDGES)
    const paletteStart = html.indexOf('data-testid="sketch-surface-palette"')
    const statusStart = html.indexOf('data-testid="sketch-surface-status"')
    const btn = html.indexOf('data-testid="sketch-surface-project"')
    expect(btn).toBeGreaterThan(paletteStart)
    expect(btn).toBeLessThan(statusStart)
  })
})

// ── Source — wiring the pure projection through the history seam ─────────────

describe('SketchSurface — Project button (source pins)', () => {
  it('SOURCE: the handler routes projectEdgesOntoSketch through applyDesignEdit (one undo step)', () => {
    const body = SRC.slice(
      SRC.indexOf('function handleProjectEdges'),
      SRC.indexOf('// Surface-level keyboard seam')
    )
    expect(body).toContain('projectEdgesOntoSketch(cur, edges)')
    expect(body).toContain('applyDesignEdit(result.design)')
    // Guards the no-edges case before doing anything (no wasted undo step).
    expect(body).toContain("if (edges.length === 0)")
    // Only records a step when something projected (projected === 0 early-returns).
    expect(body).toContain('if (result.projected === 0)')
    // A count toast reports projected + skipped + deduped.
    expect(body).toContain('onSketchHint?.(')
    expect(body).toMatch(/Projected \$\{result\.projected\}/)
  })

  it('SOURCE: the button is gated on projectableEdges length and lives in the Modify group', () => {
    expect(SRC).toContain("{group === 'Modify' && projectableEdges && projectableEdges.length > 0 && (")
    expect(SRC).toMatch(
      /data-testid="sketch-surface-project"[\s\S]{0,600}?onClick=\{handleProjectEdges\}/
    )
  })

  it('SOURCE: the prop is optional + additive (ReadonlyArray<ProjectableEdge>)', () => {
    expect(SRC).toContain('readonly projectableEdges?: ReadonlyArray<ProjectableEdge>')
  })
})
