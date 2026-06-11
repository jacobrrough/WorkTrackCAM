/**
 * Sketch S1 — surface-level contract pins for the undo/redo seam + the lifted
 * selection state on `SketchSurface`.
 *
 * The repo's renderer tests are node-SSR (`renderToStaticMarkup`, no jsdom /
 * pointer events), so per convention this file pins:
 *   (1) RENDER — the visible Undo / Redo / Delete controls with their
 *       disabled-at-rest states (fresh history, empty selection), the
 *       `data-history-revision` hook, and the canvas still mounting;
 *   (2) SOURCE — the load-bearing wiring that SSR cannot exercise: the
 *       mutation wrapper pushes history BEFORE applying via onDesignChange,
 *       the canvas + all four dialog merge paths route through that wrapper
 *       (NOT the raw prop), the move path coalesces, the delete path records
 *       exactly one step, and the window keydown seam uses the central
 *       shortcut-catalog matchers gated by `isTypableKeyboardTarget`;
 *   (3) BRIDGE — the exact canvas prop names of the S1 selection contract
 *       (`SKETCH_CANVAS_BRIDGE_PROP_NAMES`) and the spread that delivers them.
 *
 * The history ring + the pure move/delete appliers themselves are unit-tested
 * in `sketch-history.test.ts`.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SKETCH_CANVAS_BRIDGE_PROP_NAMES, SketchSurface } from '../SketchSurface'
import { emptyDesign, type DesignFileV2, type SketchEntity } from '../../../shared/design-schema'

// ── window shim (matches the sibling SketchSurface tests) ────────────────────
const gAsRecord = globalThis as unknown as Record<string, unknown>
if (gAsRecord['window'] === undefined) {
  gAsRecord['window'] = globalThis
}
if (gAsRecord['fab'] === undefined) {
  gAsRecord['fab'] = { cad: {} }
}

const noop = (): void => undefined

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const SRC = readFileSync(join(__dirname, '..', 'SketchSurface.tsx'), 'utf8')

const RECT: SketchEntity = { id: 'r1', kind: 'rect', cx: 0, cy: 0, w: 20, h: 10, rotation: 0 }

function render(design: DesignFileV2): string {
  return renderToStaticMarkup(createElement(SketchSurface, { design, onDesignChange: noop }))
}

// ── (1) RENDER contract ──────────────────────────────────────────────────────

describe('SketchSurface — S1 history controls render contract', () => {
  it('renders Undo + Redo buttons, disabled at rest (fresh history)', () => {
    const html = render(emptyDesign())
    const undoTag = (html.match(/<button[^>]*data-testid="sketch-surface-undo"[^>]*>/) ?? [])[0] ?? ''
    const redoTag = (html.match(/<button[^>]*data-testid="sketch-surface-redo"[^>]*>/) ?? [])[0] ?? ''
    expect(undoTag).not.toBe('')
    expect(redoTag).not.toBe('')
    expect(undoTag).toContain('type="button"')
    expect(redoTag).toContain('type="button"')
    // Nothing pushed yet — both ends of the ring are empty.
    expect(undoTag).toContain('disabled')
    expect(redoTag).toContain('disabled')
    // Keyboard twins are documented on the controls.
    expect(undoTag).toContain('aria-keyshortcuts="Control+Z"')
    expect(redoTag).toContain('aria-keyshortcuts="Control+Y Control+Shift+Z"')
  })

  it('renders the Delete control disabled while the selection is empty — even with entities present', () => {
    const html = render({ ...emptyDesign(), entities: [RECT] })
    const tag =
      (html.match(/<button[^>]*data-testid="sketch-surface-delete-selected"[^>]*>/) ?? [])[0] ?? ''
    expect(tag).not.toBe('')
    expect(tag).toContain('type="button"')
    expect(tag).toContain('disabled')
    expect(tag).toContain('aria-keyshortcuts="Delete"')
  })

  it('exposes the history revision hook on the surface root (rev 0 at mount)', () => {
    const html = render(emptyDesign())
    expect(html).toContain('data-history-revision="0"')
  })

  it('still mounts the palette + canvas (no regression), with Select as the default tool', () => {
    const html = render(emptyDesign())
    expect(html).toContain('data-testid="sketch-surface-palette"')
    expect(html).toContain('class="sketch-canvas"')
    expect(html).toContain('data-testid="sketch-surface-tool-select"')
    expect(html).toContain('data-active-tool="select"')
  })
})

// ── (2) SOURCE pins — the wiring SSR cannot exercise ─────────────────────────

describe('SketchSurface — S1 mutation-seam source pins', () => {
  it('the wrapper pushes the PRE-state BEFORE applying via onDesignChange', () => {
    expect(SRC).toMatch(
      /function applyDesignEdit\(next: DesignFileV2\): void \{\s*history\.push\(liveDesignRef\.current\)[\s\S]{0,120}onDesignChange\(next\)/
    )
  })

  it('the canvas commits through the wrapper, never the raw prop', () => {
    expect(SRC).toContain('onDesignChange={applyDesignEdit}')
    expect(SRC).not.toContain('onDesignChange={onDesignChange}')
  })

  it('all three edit dialogs + the Text dialog merge through the wrapper', () => {
    const applies = SRC.match(/onApply=\{\(next\) => applyDesignEdit\(next\)\}/g) ?? []
    expect(applies).toHaveLength(3) // Offset, Boolean, Array
    expect(SRC).toMatch(/onInsert=\{\(next\) => \{\s*applyDesignEdit\(next\)/)
  })

  it('the DXF import path records ONE step only when the model changed', () => {
    expect(SRC).toMatch(
      /if \(liveDesignRef\.current !== before\) \{\s*history\.push\(before\)/
    )
  })

  it('move-selected coalesces (one undo step per drag), keyed by the selection', () => {
    expect(SRC).toMatch(/history\.pushCoalesced\(cur, `move:\$\{\[\.\.\.ids\]\.sort\(\)\.join\('\|'\)\}`\)/)
  })

  it('delete-selected records exactly one push and prunes the selection', () => {
    const body = SRC.slice(
      SRC.indexOf('function handleDeleteSelected'),
      SRC.indexOf('// Surface-level keyboard seam')
    )
    expect(body).toContain('deleteSelectedSketchEntities(cur, selectedEntityIds)')
    expect(body.match(/history\.push\(/g) ?? []).toHaveLength(1)
    expect(body).toContain('next.delete(id)')
  })

  it('undo/redo re-apply snapshots through the SAME onDesignChange path', () => {
    expect(SRC).toMatch(/history\.undo\(liveDesignRef\.current\)[\s\S]{0,160}onDesignChange\(prev\)/)
    expect(SRC).toMatch(/history\.redo\(liveDesignRef\.current\)[\s\S]{0,160}onDesignChange\(next\)/)
  })

  it('the window keydown seam uses the catalog matchers, gated off inputs, removed on unmount', () => {
    expect(SRC).toMatch(
      /from '\.\.\/\.\.\/shared\/app-keyboard-shortcuts'/
    )
    expect(SRC).toMatch(/if \(isTypableKeyboardTarget\(e\.target\)\) return/)
    expect(SRC).toMatch(/matchesUndo\(e\)[\s\S]{0,120}performUndo\(\)/)
    expect(SRC).toMatch(/matchesRedo\(e\)[\s\S]{0,120}performRedo\(\)/)
    expect(SRC).toMatch(/e\.key === 'Delete' && !e\.ctrlKey && !e\.metaKey && !e\.altKey/)
    expect(SRC).toMatch(/window\.addEventListener\('keydown', onKeyDown\)/)
    expect(SRC).toMatch(/return \(\) => window\.removeEventListener\('keydown', onKeyDown\)/)
  })

  it('no `any` types in the S1 surface code (CLAUDE.md rule)', () => {
    expect(SRC).not.toMatch(/:\s*any\b/)
    expect(SRC).not.toMatch(/as any\b/)
    expect(SRC).not.toMatch(/<any[,>]/)
  })
})

// ── (3) BRIDGE — the S1 canvas selection contract ────────────────────────────

describe('SketchSurface — S1 canvas selection bridge', () => {
  it('the contract prop names are exactly the four the canvas consumes/emits', () => {
    expect([...SKETCH_CANVAS_BRIDGE_PROP_NAMES]).toEqual([
      'selectedEntityIds',
      'onEntityPick',
      'onMoveSelected',
      'onDeleteSelected'
    ])
  })

  it('the bridge object carries all four contract props and is spread onto the canvas', () => {
    const bridgeDecl = SRC.slice(
      SRC.indexOf('const canvasSelectionBridge: SketchSurfaceCanvasBridge = {'),
      SRC.indexOf('async function handleImportDxfClick')
    )
    for (const name of SKETCH_CANVAS_BRIDGE_PROP_NAMES) {
      expect(bridgeDecl, name).toContain(name)
    }
    expect(SRC).toContain('{...canvasSelectionBridge}')
  })

  it('the checkbox loop-list is a READOUT over the same lifted state (additive toggle)', () => {
    expect(SRC).toMatch(/function toggleSelected\(id: string\): void \{\s*handleEntityPick\(id, true\)/)
  })

  it('an empty-space pick (null id) clears the selection; plain pick replaces; additive toggles', () => {
    const body = SRC.slice(
      SRC.indexOf('function handleEntityPick'),
      SRC.indexOf('function toggleSelected')
    )
    expect(body).toContain('if (id === null) return prev.size === 0 ? prev : new Set<string>()')
    expect(body).toContain('if (!additive) return new Set([id])')
    expect(body).toContain('next.delete(id)')
    expect(body).toContain('next.add(id)')
  })
})
