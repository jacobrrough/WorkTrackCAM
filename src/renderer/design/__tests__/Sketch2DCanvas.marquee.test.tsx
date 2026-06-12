/**
 * Sketch S3 -- render + source contracts for the marquee box-select gesture
 * on the session-wired Sketch2DCanvas (plain press on EMPTY canvas + drag).
 *
 * Repo tests are node-SSR (renderToStaticMarkup; no jsdom, no pointer
 * events), so per the S1/S2 convention this file pins:
 *   - the box resolver as PURE units (sketch2d-marquee.test.ts);
 *   - the DOM-visible half as markup (NO marquee chrome at rest -- the
 *     rubber band is canvas-drawn and gesture-driven; the S1/S2 absent-prop
 *     byte-identity is re-asserted with S3 in the tree);
 *   - the gesture halves SSR cannot drag as source text (arm on empty press,
 *     S1 threshold, live window/crossing mode flip, Shift-at-release add vs
 *     plain replace, no-drag clear, Escape cancel, pan gestures untouched).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { DesignFileV2 } from '../../../shared/design-schema'
import { emptyDesign } from '../../../shared/design-schema'
import { Sketch2DCanvas } from '../Sketch2DCanvas'

type CanvasProps = ComponentProps<typeof Sketch2DCanvas>

function fixtureDesign(): DesignFileV2 {
  return {
    ...emptyDesign(),
    entities: [
      { id: 'r1', kind: 'rect', cx: 0, cy: 0, w: 20, h: 10, rotation: 0 },
      { id: 'c1', kind: 'circle', cx: 30, cy: 0, r: 5 }
    ]
  }
}

function markup(extra: Partial<CanvasProps> = {}): string {
  const props: CanvasProps = {
    width: 800,
    height: 600,
    design: fixtureDesign(),
    onDesignChange: () => undefined,
    activeTool: 'line',
    gridMm: 5,
    ...extra
  }
  return renderToStaticMarkup(createElement(Sketch2DCanvas, props))
}

/** The S1 selection callbacks, wired with no-ops. */
function wired(): Partial<CanvasProps> {
  return {
    onEntityPick: () => undefined,
    onMoveSelected: () => undefined,
    onDeleteSelected: () => undefined
  }
}

describe('Sketch2DCanvas marquee -- render contract (node-SSR)', () => {
  it('S1 absent-prop byte-identity STILL holds with the marquee gesture in the tree', () => {
    const baseline = markup()
    const withProps = markup({ ...wired(), selectedEntityIds: new Set(['r1']) })
    expect(withProps).toBe(baseline)
  })

  it('no marquee chrome at rest: the data-marquee flag only exists mid-drag', () => {
    expect(markup()).not.toContain('data-marquee')
    expect(markup({ activeTool: 'select', ...wired() })).not.toContain('data-marquee')
    expect(
      markup({ activeTool: 'select', ...wired(), selectedEntityIds: new Set(['r1', 'c1']) })
    ).not.toContain('data-marquee')
  })

  it('select chrome itself is unchanged by S3 (toolbar + focusable canvas intact)', () => {
    const html = markup({ activeTool: 'select', ...wired(), selectedEntityIds: new Set(['r1']) })
    expect(html).toContain('data-testid="sketch-select-toolbar"')
    expect(html).toContain('data-selected-count="1"')
    expect(html).toContain('tabindex="0"')
  })
})

const SRC = readFileSync(resolve(__dirname, '../Sketch2DCanvas.tsx'), 'utf-8')
const DRAW = readFileSync(resolve(__dirname, '../sketch2d-draw.ts'), 'utf-8')
const CSS = readFileSync(resolve(__dirname, '../../styles/shell/design-cockpit.css'), 'utf-8')

describe('Sketch2DCanvas marquee -- source pins (gesture halves SSR cannot drag)', () => {
  it('a plain empty press ARMS the marquee; the clear moved to the no-drag release', () => {
    expect(SRC).toMatch(
      /\} else \{[\s\S]{0,420}?marqueeRef\.current = \{ startWorld: \[raw\[0\], raw\[1\]\], moved: false \}/
    )
  })

  it('the rubber band waits for the SAME S1 drag threshold before appearing', () => {
    expect(SRC).toContain(
      'if (!mq.moved && dragExceedsThreshold(mq.startWorld, raw, scale)) mq.moved = true'
    )
  })

  it('the live overlay mode flips with the horizontal drag direction (AutoCAD)', () => {
    expect(SRC).toMatch(
      /setMarqueeRect\(\{\s*a: mq\.startWorld,\s*b: \[raw\[0\], raw\[1\]\],\s*mode: marqueeModeForDrag\(mq\.startWorld, raw\)\s*\}\)/
    )
  })

  it('release resolves through the PURE entitiesInBox at the release point', () => {
    expect(SRC).toMatch(
      /const ids = entitiesInBox\(\{\s*design,\s*box: marqueeBoxFromCorners\(mq\.startWorld, mraw\),\s*mode: marqueeModeForDrag\(mq\.startWorld, mraw\)\s*\}\)/
    )
    expect(SRC).toContain('applyMarqueeSelection(ids, ev.shiftKey)')
  })

  it('Shift ADDS (already-selected ids skipped, never toggled off); plain REPLACES', () => {
    expect(SRC).toContain('if (!selectedEntityIds?.has(id)) onEntityPick(id, true)')
    expect(SRC).toContain('onEntityPick(ids[0]!, false)')
    expect(SRC).toContain('for (let i = 1; i < ids.length; i++) onEntityPick(ids[i]!, true)')
  })

  it("a NO-DRAG release keeps today's empty-click clear", () => {
    expect(SRC).toMatch(/\} else if \(!mq\.moved\) \{\s*\n\s*onEntityPick\?\.\(null, false\)/)
  })

  it('Escape cancels via a gesture-scoped window CAPTURE listener (canvas keydown untouched)', () => {
    expect(SRC).toContain("window.addEventListener('keydown', onMarqueeKey, true)")
    expect(SRC).toContain(
      "return () => window.removeEventListener('keydown', onMarqueeKey, true)"
    )
    expect(SRC).toMatch(
      /const onMarqueeKey = \(ev: KeyboardEvent\): void => \{\s*\n\s*if \(ev\.key !== 'Escape'\) return\s*\n\s*marqueeRef\.current = null\s*\n\s*setMarqueeRect\(null\)/
    )
    // The listener is gesture-scoped: registered only while the band is live.
    expect(SRC).toMatch(/if \(!marqueeActive\) return\s*\n\s*const onMarqueeKey/)
  })

  it('pan gestures are untouched: middle-drag always pans, Shift+empty still pans', () => {
    expect(SRC).toContain('if (ev.button === 1 || (ev.button === 0 && ev.shiftKey)) {')
    expect(SRC).toContain('panRef.current = { sx: ev.clientX, sy: ev.clientY, ox, oy }')
  })

  it('tool switch and pointer-leave tear the marquee down without selecting', () => {
    expect(SRC).toMatch(
      /useEffect\(\(\) => \{\s*\n\s*if \(activeTool !== 'select'\) \{\s*\n\s*marqueeRef\.current = null\s*\n\s*setMarqueeRect\(null\)\s*\n\s*\}\s*\n\s*\}, \[activeTool\]\)/
    )
    expect(SRC).toMatch(
      /likewise cancel an in-flight marquee[\s\S]{0,120}?marqueeRef\.current = null\s*\n\s*setMarqueeRect\(null\)/
    )
  })

  it('the canvas threads the overlay into drawSketch2D + flags the live mode on the DOM', () => {
    expect(SRC).toMatch(/nodeEditOverlay,\s*\n\s*marquee: marqueeRect,/)
    expect(SRC).toContain('data-marquee={marqueeRect ? marqueeRect.mode : undefined}')
  })

  it('the S1/S2 gesture precedence is preserved: node drag, then select drag, then marquee', () => {
    const nd = SRC.indexOf('const nd = nodeDragRef.current')
    const sd = SRC.indexOf('const sd = selectDragRef.current')
    const mq = SRC.indexOf('const mq = marqueeRef.current')
    expect(nd).toBeGreaterThan(-1)
    expect(sd).toBeGreaterThan(nd)
    expect(mq).toBeGreaterThan(sd)
  })

  it('the MVP variant is untouched by S3 (zero marquee references below its banner)', () => {
    const banner = '// MvpSketchCanvas (CAD V1 MVP sketcher)'
    expect(SRC).toContain(banner)
    expect(/marquee/i.test(SRC.slice(SRC.indexOf(banner)))).toBe(false)
    expect(SRC).toContain('sketch-mvp-cursor-readout')
  })

  it('no `any` types in the LIVE canvas component (CLAUDE.md rule; MVP region out of scope)', () => {
    const live = SRC.slice(0, SRC.indexOf('// MvpSketchCanvas (CAD V1 MVP sketcher)'))
    expect(live.length).toBeGreaterThan(1000)
    expect(live).not.toMatch(/: any\b/)
    expect(live).not.toMatch(/as any\b/)
  })
})

describe('sketch2d-draw -- marquee rubber-band rendering pins (additive param)', () => {
  it('the param is optional + additive (absent = no change)', () => {
    expect(DRAW).toMatch(
      /marquee\?: \{\s*\n\s*a: readonly \[number, number\]\s*\n\s*b: readonly \[number, number\]\s*\n\s*mode: MarqueeMode\s*\n\s*\} \| null/
    )
  })

  it('window draws SOLID, crossing draws DASHED (the AutoCAD visual split)', () => {
    expect(DRAW).toContain("const isWindowBox = marquee.mode === 'window'")
    expect(DRAW).toContain('ctx.setLineDash(isWindowBox ? [] : [5, 4])')
  })

  it('tints resolve through the marquee CSS vars with literal fallbacks', () => {
    expect(DRAW).toContain("marqueeToken('--sketch-marquee-window', '#60a5fa')")
    expect(DRAW).toContain("marqueeToken('--sketch-marquee-crossing', '#4ade80')")
    expect(DRAW).toContain("'--sketch-marquee-window-fill'")
    expect(DRAW).toContain("'--sketch-marquee-crossing-fill'")
    expect(DRAW).toMatch(/typeof window !== 'undefined' \? window\.getComputedStyle\(c\) : null/)
  })

  it('the S2 osnap marker still draws AFTER the marquee (marker stays on top)', () => {
    const marqueeAt = DRAW.indexOf('if (marquee) {')
    const markerAt = DRAW.indexOf('if (osnapMarker) {')
    expect(marqueeAt).toBeGreaterThan(-1)
    expect(markerAt).toBeGreaterThan(marqueeAt)
  })
})

describe('design-cockpit.css -- the marquee CSS vars exist for every canvas mount', () => {
  it('defines all four tints on the canvas wrap itself', () => {
    expect(CSS).toMatch(/\.sketch-wrap \{[\s\S]{0,400}?--sketch-marquee-window:/)
    expect(CSS).toContain('--sketch-marquee-window: #60a5fa;')
    expect(CSS).toContain('--sketch-marquee-window-fill: rgba(96, 165, 250, 0.14);')
    expect(CSS).toContain('--sketch-marquee-crossing: #4ade80;')
    expect(CSS).toContain('--sketch-marquee-crossing-fill: rgba(74, 222, 128, 0.12);')
  })
})
