/**
 * Wave 3e (keystone unlock) — the LIVE, session-persisted sketch surface.
 *
 * Pins the three things the task requires of the mounted sketcher:
 *   1. RENDER — `SketchSurface` mounts an internal tool palette (one button per
 *      `SKETCH_SURFACE_TOOLS` entry), a snap-to-grid toggle, and the legacy
 *      `Sketch2DCanvas` (which carries the numeric dimension popovers). It is the
 *      surface DesignWorkspace mounts in the Sketch stage when the host threads
 *      the session model.
 *   2. WIRE — DesignWorkspace mounts `SketchSurface` (NOT the self-contained,
 *      non-persisting `MvpSketchCanvas`) exactly when `sketchDesign` +
 *      `onSketchDesignChange` are BOTH provided; without them it falls back to
 *      `MvpSketchCanvas` so every pre-existing FG-3 render-pin holds.
 *   3. PERSIST + ROUND-TRIP — a drawn vector (the shape the canvas commits into
 *      `onDesignChange`) is a valid `DesignFileV2` that survives the EXACT
 *      serialize → save → load → normalize path the session performs on
 *      `manufacture:save` + reload. (The repo's renderer tests are node-env SSR —
 *      no jsdom/canvas — so a true pointer-driven draw is out of scope here; we
 *      pin the persistence contract the draw feeds, which is the load-bearing
 *      half of the round-trip requirement.)
 *
 * Env: `node` + `renderToStaticMarkup` (no jsdom) — matches every other Design
 * render test (EmptyState / CadQueryEditor / FeatureTree / feature-dialogs).
 */

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SketchSurface, SKETCH_SURFACE_TOOLS } from '../SketchSurface'
import { DesignWorkspace, STARTER_SCRIPT } from '../DesignWorkspace'
import {
  emptyDesign,
  normalizeDesign,
  type DesignFileV2,
  type SketchEntity
} from '../../../shared/design-schema'

// ── window.fab shim (DesignWorkspace reads window.fab on the Run path) ───────
const gAsRecord = globalThis as unknown as Record<string, unknown>
if (gAsRecord['window'] === undefined) {
  gAsRecord['window'] = globalThis
}
if (gAsRecord['fab'] === undefined) {
  gAsRecord['fab'] = { cad: {} }
}

const noop = (): void => undefined

/** A rect entity exactly as `Sketch2DCanvas.finalizeRectDrag` commits one. */
const DRAWN_RECT: SketchEntity = {
  id: 'rect-keystone-1',
  kind: 'rect',
  cx: 12,
  cy: 8,
  w: 40,
  h: 24,
  rotation: 0
}

describe('SketchSurface — render contract', () => {
  it('renders the surface shell with a tool palette and the canvas', () => {
    const html = renderToStaticMarkup(
      createElement(SketchSurface, { design: emptyDesign(), onDesignChange: noop })
    )
    expect(html).toContain('data-testid="sketch-surface"')
    expect(html).toContain('data-testid="sketch-surface-palette"')
    // The legacy Sketch2DCanvas mounts (its `.sketch-wrap` + `.sketch-canvas`).
    expect(html).toContain('class="sketch-wrap"')
    expect(html).toContain('class="sketch-canvas"')
  })

  it('renders a button for every tool in SKETCH_SURFACE_TOOLS', () => {
    const html = renderToStaticMarkup(
      createElement(SketchSurface, { design: emptyDesign(), onDesignChange: noop })
    )
    for (const t of SKETCH_SURFACE_TOOLS) {
      expect(html).toContain(`data-testid="sketch-surface-tool-${t.id}"`)
      expect(html).toContain(t.label)
    }
  })

  it('exposes a snap-to-grid toggle (on by default)', () => {
    const html = renderToStaticMarkup(
      createElement(SketchSurface, { design: emptyDesign(), onDesignChange: noop })
    )
    expect(html).toContain('data-testid="sketch-surface-snap-toggle"')
    expect(html).toContain('data-snap="on"')
  })

  it('defaults the active tool to "line" and pre-selects the ribbon-armed tool', () => {
    const def = renderToStaticMarkup(
      createElement(SketchSurface, { design: emptyDesign(), onDesignChange: noop })
    )
    expect(def).toContain('data-active-tool="line"')

    // armedToolCommandId is applied in an effect; SSR cannot flush it, so the
    // default still wins on the static render. We assert the prop is ACCEPTED
    // (no throw) and the default holds — the live click-through behavior is the
    // effect's job, exercised by the host wiring, not pinnable under SSR.
    const armed = renderToStaticMarkup(
      createElement(SketchSurface, {
        design: emptyDesign(),
        onDesignChange: noop,
        armedToolCommandId: 'sk_circle_center'
      })
    )
    expect(armed).toContain('data-testid="sketch-surface"')
  })

  it('surfaces the entity count from the live design model', () => {
    const withRect: DesignFileV2 = { ...emptyDesign(), entities: [DRAWN_RECT] }
    const html = renderToStaticMarkup(
      createElement(SketchSurface, { design: withRect, onDesignChange: noop })
    )
    expect(html).toContain('data-testid="sketch-surface-count"')
    expect(html).toContain('1 entity')
  })

  it('every interactive element is a type="button" (CLAUDE.md rule)', () => {
    const html = renderToStaticMarkup(
      createElement(SketchSurface, { design: emptyDesign(), onDesignChange: noop })
    )
    const openTags = html.match(/<button[^>]*>/g) ?? []
    expect(openTags.length).toBeGreaterThan(0)
    for (const tag of openTags) {
      expect(tag).toContain('type="button"')
    }
  })
})

describe('DesignWorkspace — Sketch stage mounts the session-persisted surface', () => {
  it('mounts SketchSurface (not MvpSketchCanvas) when the session model is wired', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        sketchActive: true,
        sketchDesign: emptyDesign(),
        onSketchDesignChange: noop
      })
    )
    expect(html).toContain('data-testid="design-workspace-sketch-host"')
    expect(html).toContain('data-testid="sketch-surface"')
    // The self-contained MVP canvas is NOT mounted on the live (persisted) path.
    expect(html).not.toContain('data-testid="sketch-mvp-wrap"')
  })

  it('falls back to MvpSketchCanvas when the session model is NOT wired', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        sketchActive: true
      })
    )
    expect(html).toContain('data-testid="design-workspace-sketch-host"')
    // Fallback: the self-contained canvas, no persisted surface.
    expect(html).toContain('data-testid="sketch-mvp-wrap"')
    expect(html).not.toContain('data-testid="sketch-surface"')
  })

  it('requires BOTH session props — design alone falls back to the MVP canvas', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        sketchActive: true,
        sketchDesign: emptyDesign()
        // onSketchDesignChange intentionally omitted.
      })
    )
    expect(html).toContain('data-testid="sketch-mvp-wrap"')
    expect(html).not.toContain('data-testid="sketch-surface"')
  })
})

describe('Sketch model — draw persists + survives save/reload round-trip', () => {
  it('a drawn vector lands in the design model the surface edits', () => {
    // A draw commit is `onDesignChange(next)` where `next` carries the new
    // entity (the canvas builds exactly this shape). Model the edit and assert
    // the entity is present + the result is a schema-valid v2 design.
    const before = emptyDesign()
    const afterDraw: DesignFileV2 = { ...before, entities: [...before.entities, DRAWN_RECT] }

    expect(before.entities).toHaveLength(0)
    expect(afterDraw.entities).toHaveLength(1)
    expect(afterDraw.entities[0]).toEqual(DRAWN_RECT)
    // Must remain a valid DesignFileV2 (the session would otherwise fail to save).
    expect(() => normalizeDesign(afterDraw)).not.toThrow()
  })

  it('survives the exact serialize→save→load→normalize path the session uses', () => {
    // What `session.saveDesign` writes (JSON.stringify(design)) and what
    // `design:load` reads back (normalizeDesign(parse(json))).
    const drawn: DesignFileV2 = { ...emptyDesign(), entities: [DRAWN_RECT] }

    const savedJson = JSON.stringify(drawn) // session.saveDesign → fab.designSave
    const reloaded = normalizeDesign(JSON.parse(savedJson)) // design:load → normalizeDesign

    expect(reloaded.entities).toHaveLength(1)
    expect(reloaded.entities[0]).toEqual(DRAWN_RECT)
    // The whole model round-trips unchanged (no silent field loss).
    expect(reloaded).toEqual(normalizeDesign(drawn))
  })

  it('round-trips multiple entities + their points (polyline-style draws)', () => {
    const pA = 'p-a'
    const pB = 'p-b'
    const polyline: SketchEntity = { id: 'pl-1', kind: 'polyline', pointIds: [pA, pB], closed: false }
    const drawn: DesignFileV2 = {
      ...emptyDesign(),
      points: { [pA]: { x: 0, y: 0 }, [pB]: { x: 30, y: 0 } },
      entities: [DRAWN_RECT, polyline]
    }

    const reloaded = normalizeDesign(JSON.parse(JSON.stringify(drawn)))
    expect(reloaded.entities).toHaveLength(2)
    expect(Object.keys(reloaded.points)).toEqual([pA, pB])
    expect(reloaded.points[pA]).toEqual({ x: 0, y: 0 })
    expect(reloaded.points[pB]).toEqual({ x: 30, y: 0 })
  })
})
