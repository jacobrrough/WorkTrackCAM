/**
 * Sketch S3 -- canvas hotkeys + the S2 cosmetic fixes (session-wired
 * Sketch2DCanvas only; the MVP variant is untouched).
 *
 * Repo tests are node-SSR (renderToStaticMarkup; no jsdom, no key events), so
 * per the S1/S2 convention the contract splits:
 *   - the hotkey DECISION is pure (`matchesSketchCanvasHotkey`; unit matrix in
 *     src/shared/app-keyboard-shortcuts.test.ts) -- here the canvas-side
 *     GATING (typable-target bail + wrap hover/focus scope) and the dispatch
 *     into the EXISTING tool-arming / toggle state are pinned as source text;
 *   - the S2 cosmetic (a) readout==ghost fix is proven through the PURE
 *     resolution path with a fixture where the full vs gesture-excluded
 *     candidate sets disagree, plus source pins on the override emits;
 *   - the S2 cosmetic (b) truncation flag is unit-tested on the pure detailed
 *     collector and pinned as badge markup (the collect runs in render, so
 *     SSR genuinely renders the badge on a crowded sketch).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { DesignFileV2, SketchEntity, SketchPoint } from '../../../shared/design-schema'
import { emptyDesign } from '../../../shared/design-schema'
import { APP_KEYBOARD_SHORTCUT_GROUPS } from '../../../shared/app-keyboard-shortcuts'
import { Sketch2DCanvas } from '../Sketch2DCanvas'
import {
  collectOsnapCandidates,
  collectOsnapCandidatesDetailed,
  osnapToleranceMm,
  resolveDragDeltaWithOsnap,
  resolveSnappedPoint
} from '../sketch2d-osnap'

type CanvasProps = ComponentProps<typeof Sketch2DCanvas>

function designWith(
  entities: SketchEntity[],
  points: Record<string, SketchPoint> = {}
): DesignFileV2 {
  return { ...emptyDesign(), entities, points }
}

function fixtureDesign(): DesignFileV2 {
  return designWith([
    { id: 'r1', kind: 'rect', cx: 0, cy: 0, w: 20, h: 10, rotation: 0 },
    { id: 'c1', kind: 'circle', cx: 30, cy: 0, r: 5 }
  ])
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

const SRC = readFileSync(resolve(__dirname, '../Sketch2DCanvas.tsx'), 'utf-8')
const SURFACE = readFileSync(resolve(__dirname, '../SketchSurface.tsx'), 'utf-8')
const OSNAP_SRC = readFileSync(resolve(__dirname, '../sketch2d-osnap.ts'), 'utf-8')
const MVP_BANNER = '// MvpSketchCanvas (CAD V1 MVP sketcher)'
const LIVE = SRC.slice(0, SRC.indexOf(MVP_BANNER))

describe('S3 hotkeys -- canvas-scoped gating (source pins; SSR cannot press keys)', () => {
  it('gating order: typable-target bail, then wrap hover/focus, then the pure matcher', () => {
    expect(LIVE).toMatch(
      /const onHotkeyDown = \(e: KeyboardEvent\): void => \{\s*\n\s*if \(isTypableKeyboardTarget\(e\.target\)\) return\s*\n\s*const focusInside = wrap\.contains\(document\.activeElement\)\s*\n\s*if \(!wrapHoverRef\.current && !focusInside\) return\s*\n\s*const action = matchesSketchCanvasHotkey\(e\)/
    )
  })

  it('hover scope is tracked on the canvas WRAP element (ref + enter/leave pair, both removed)', () => {
    expect(LIVE).toContain('<div className="sketch-wrap" ref={sketchWrapRef}>')
    expect(LIVE).toContain("wrap.addEventListener('pointerenter', onWrapPointerEnter)")
    expect(LIVE).toContain("wrap.addEventListener('pointerleave', onWrapPointerLeave)")
    expect(LIVE).toContain("wrap.removeEventListener('pointerenter', onWrapPointerEnter)")
    expect(LIVE).toContain("wrap.removeEventListener('pointerleave', onWrapPointerLeave)")
    expect(LIVE).toContain("window.removeEventListener('keydown', onHotkeyDown)")
  })

  it('tool keys dispatch into the EXISTING upstream arming -- the canvas holds NO tool state', () => {
    expect(LIVE).toMatch(
      /if \(hotkeyHandlersRef\.current\.onToolHotkey\) \{\s*\n\s*hotkeyHandlersRef\.current\.onToolHotkey\(action\.tool\)\s*\n\s*e\.preventDefault\(\)/
    )
    expect(LIVE).not.toMatch(/useState<SketchTool>/)
  })

  it('F3 flips the EXISTING osnap toggle (the same setter the chip click uses)', () => {
    expect(LIVE).toMatch(
      /action\.kind === 'toggleOsnap'\) \{\s*\n\s*setOsnapEnabled\(\(v\) => !v\)\s*\n\s*e\.preventDefault\(\)/
    )
    // The chip onClick + the F3 branch: exactly two flips of ONE state.
    expect(LIVE.match(/setOsnapEnabled\(\(v\) => !v\)/g) ?? []).toHaveLength(2)
  })

  it('G routes to the surface grid-snap toggle; unwired mounts swallow nothing', () => {
    expect(LIVE).toMatch(
      /if \(hotkeyHandlersRef\.current\.onGridSnapToggle\) \{\s*\n\s*hotkeyHandlersRef\.current\.onGridSnapToggle\(\)\s*\n\s*e\.preventDefault\(\)/
    )
  })

  it('the new props are optional + additive', () => {
    expect(LIVE).toContain('onToolHotkey?: (tool: SketchTool) => void')
    expect(LIVE).toContain('onGridSnapToggle?: () => void')
  })

  it('hotkey props wired produce byte-identical markup (render chrome untouched)', () => {
    const baseline = markup()
    const withHotkeys = markup({
      onToolHotkey: () => undefined,
      onGridSnapToggle: () => undefined
    })
    expect(withHotkeys).toBe(baseline)
  })

  it('the MVP variant gains no hotkey wiring (fence intact)', () => {
    const mvpTail = SRC.slice(SRC.indexOf(MVP_BANNER))
    expect(mvpTail).not.toContain('matchesSketchCanvasHotkey')
    expect(mvpTail).not.toContain('onToolHotkey')
    expect(mvpTail).not.toContain('onGridSnapToggle')
  })
})

describe('S3 hotkeys -- SketchSurface maps keys onto the EXISTING state (source pins)', () => {
  it('tool hotkeys arm the SAME state the palette buttons set', () => {
    expect(SURFACE).toContain('onToolHotkey={setActiveTool}')
    expect(SURFACE).toContain('onClick={() => setActiveTool(t.id)}')
  })

  it('G flips the SAME snap state the Snap button flips (no parallel state)', () => {
    expect(SURFACE).toContain('onGridSnapToggle={() => setSnapEnabled((s) => !s)}')
    // The Snap button + the hotkey route: exactly two flips of ONE setter.
    expect(SURFACE.match(/setSnapEnabled\(\(s\) => !s\)/g) ?? []).toHaveLength(2)
  })

  it('the shortcut source-of-truth documents the sketch-canvas keys in S/L/R/C/A/E/F3/G order', () => {
    const group = APP_KEYBOARD_SHORTCUT_GROUPS.find((g) => g.id === 'sketch_canvas')
    expect(group).toBeDefined()
    expect(group!.rows.map((r) => r.keysWin)).toEqual(['S', 'L', 'R', 'C', 'A', 'E', 'F3', 'G'])
  })
})

describe('S2 cosmetic (a) -- mid-drag readout resolves over the SAME excluded set as the ghost', () => {
  it('node-drag branch overrides the full-set emit with the gesture-scoped point', () => {
    expect(LIVE).toMatch(
      /setOsnapHover\(nodeRes\.snapped\)[\s\S]{0,460}?onCursorWorld\?\.\(nodeRes\.point\)/
    )
  })

  it('select-drag branch emits startWorld + deltaMm (the resolved drag end the ghost shows)', () => {
    expect(LIVE).toContain(
      'onCursorWorld?.([sd.startWorld[0] + dragRes.deltaMm[0], sd.startWorld[1] + dragRes.deltaMm[1]])'
    )
  })

  it('the Wave 3n general emit stays intact for the non-drag paths (pins still hold)', () => {
    expect(LIVE).toMatch(
      /const p: \[number, number\] = inferred\.point[\s\S]{0,250}?onCursorWorld\?\.\(p\)/
    )
  })

  it('PURE proof: full vs excluded sets disagree -- the readout follows the excluded set', () => {
    // r1's corner sits at (10, 5); r2 is far away. Dragging r1, the gesture
    // set excludes r1, so r1's own corner must NOT attract the readout even
    // though the raw pointer is well inside its aperture.
    const design = designWith([
      { id: 'r1', kind: 'rect', cx: 0, cy: 0, w: 20, h: 10, rotation: 0 },
      { id: 'r2', kind: 'rect', cx: 40, cy: 0, w: 20, h: 10, rotation: 0 }
    ])
    const tol = osnapToleranceMm(2.5) // 4 mm aperture
    const gridMm = 2
    const rawEnd = [11.4, 6.3] as const
    // FULL set (what the pre-S3 readout used mid-drag): snaps to r1's corner.
    const fullRes = resolveSnappedPoint({
      raw: rawEnd,
      candidates: collectOsnapCandidates({ design }),
      gridMm,
      gridEnabled: true,
      osnapEnabled: true,
      toleranceMm: tol
    })
    expect(fullRes.snapped?.sourceEntityIds).toEqual(['r1'])
    expect(fullRes.point).toEqual([10, 5])
    // EXCLUDED set (the gesture set): r1 cannot snap to ITSELF -> S1 lattice.
    const startWorld = [1, 1] as const
    const dragRes = resolveDragDeltaWithOsnap({
      startWorld,
      rawEndWorld: rawEnd,
      candidates: collectOsnapCandidates({ design, excludeEntityIds: ['r1'] }),
      gridMm,
      osnapEnabled: true,
      toleranceMm: tol
    })
    expect(dragRes.snapped).toBeNull()
    const readout = [startWorld[0] + dragRes.deltaMm[0], startWorld[1] + dragRes.deltaMm[1]]
    // The S3 readout (start + delta) IS the ghost end -- and it disagrees with
    // the full-set resolution, which is exactly the flicker S3 removes.
    expect(readout).toEqual([11, 7])
    expect(readout).not.toEqual(fullRes.point)
  })

  it('node-drag flavor: the excluded-set placement differs from the full-set placement', () => {
    const design = designWith([
      { id: 'r1', kind: 'rect', cx: 0, cy: 0, w: 20, h: 10, rotation: 0 },
      { id: 'r2', kind: 'rect', cx: 40, cy: 0, w: 20, h: 10, rotation: 0 }
    ])
    const tol = osnapToleranceMm(2.5)
    const gridMm = 2
    const rawEnd = [11.4, 6.3] as const
    // The node-drag resolution shape: same engine, entity-excluded, grid on.
    const excludedRes = resolveSnappedPoint({
      raw: rawEnd,
      candidates: collectOsnapCandidates({ design, excludeEntityIds: ['r1'] }),
      gridMm,
      gridEnabled: true,
      osnapEnabled: true,
      toleranceMm: tol
    })
    expect(excludedRes.snapped).toBeNull()
    expect(excludedRes.point).toEqual([12, 6]) // lattice, NOT r1's own corner
    const fullRes = resolveSnappedPoint({
      raw: rawEnd,
      candidates: collectOsnapCandidates({ design }),
      gridMm,
      gridEnabled: true,
      osnapEnabled: true,
      toleranceMm: tol
    })
    expect(fullRes.point).toEqual([10, 5])
    expect(excludedRes.point).not.toEqual(fullRes.point)
  })
})

describe('S2 cosmetic (b) -- intersection-cap truncation exposure (pure units)', () => {
  /** Three segments crossing pairwise -> exactly 3 AABB-surviving pairs. */
  function crossingDesign(): DesignFileV2 {
    return designWith(
      [
        { id: 'h', kind: 'polyline', pointIds: ['h1', 'h2'], closed: false },
        { id: 'v', kind: 'polyline', pointIds: ['v1', 'v2'], closed: false },
        { id: 'd', kind: 'polyline', pointIds: ['d1', 'd2'], closed: false }
      ],
      {
        h1: { x: -10, y: 1 },
        h2: { x: 10, y: 1 },
        v1: { x: 0, y: -10 },
        v2: { x: 0, y: 10 },
        d1: { x: -10, y: -8 },
        d2: { x: 10, y: 8 }
      }
    )
  }

  it('cap hit -> truncated: true, and ONLY the post-cap crossings are missing', () => {
    const res = collectOsnapCandidatesDetailed({
      design: crossingDesign(),
      intersectionPairCap: 1
    })
    expect(res.truncated).toBe(true)
    expect(res.candidates.filter((c) => c.kind === 'intersection')).toHaveLength(1)
    // Locals are NEVER truncated: 3 open 2-pt polylines -> 6 endpoints + 3 midpoints.
    expect(res.candidates.filter((c) => c.kind === 'endpoint')).toHaveLength(6)
    expect(res.candidates.filter((c) => c.kind === 'midpoint')).toHaveLength(3)
  })

  it('under the cap -> truncated: false with every crossing present (default cap too)', () => {
    const res = collectOsnapCandidatesDetailed({
      design: crossingDesign(),
      intersectionPairCap: 3
    })
    expect(res.truncated).toBe(false)
    expect(res.candidates.filter((c) => c.kind === 'intersection')).toHaveLength(3)
    expect(collectOsnapCandidatesDetailed({ design: crossingDesign() }).truncated).toBe(false)
  })

  it('the legacy signature stays byte-compatible: same candidates, same order, by delegation', () => {
    const design = crossingDesign()
    const legacy = collectOsnapCandidates({ design, intersectionPairCap: 1 })
    const detailed = collectOsnapCandidatesDetailed({ design, intersectionPairCap: 1 })
    expect(legacy).toEqual(detailed.candidates)
    // Source pin: the old export is a thin delegate (one collector, no fork).
    expect(OSNAP_SRC).toContain('return collectOsnapCandidatesDetailed(input).candidates')
  })
})

describe('S2 cosmetic (b) -- "snap simplified" badge (render + source pins)', () => {
  /** 60 mutually-overlapping rect AABBs -> C(60,2) = 1770 pairs > the 1500 cap. */
  function crowdedDesign(): DesignFileV2 {
    const entities: SketchEntity[] = []
    for (let i = 0; i < 60; i++) {
      entities.push({
        id: `cr${i}`,
        kind: 'rect',
        cx: 0,
        cy: 0,
        w: 20 + i * 0.5,
        h: 10 + i * 0.5,
        rotation: 0
      })
    }
    return designWith(entities)
  }

  it('fixture honesty: the DEFAULT-cap collect on the crowded sketch truly truncates', () => {
    expect(collectOsnapCandidatesDetailed({ design: crowdedDesign() }).truncated).toBe(true)
  })

  it('truncated collect -> the badge renders beside the OSNAP toggle (SSR markup)', () => {
    const html = markup({ design: crowdedDesign() })
    expect(html).toContain('data-testid="sketch-osnap-simplified"')
    expect(html).toContain('snap simplified')
    expect(html).toMatch(/sketch-osnap-toggle[\s\S]*?sketch-osnap-simplified-badge/)
  })

  it('an ordinary sketch renders NO badge (non-blocking; only on real truncation)', () => {
    expect(markup()).not.toContain('sketch-osnap-simplified')
  })

  it('the badge is gated on BOTH the flag and the OSNAP toggle being on', () => {
    expect(LIVE).toContain('{osnapEnabled && osnapTruncated && (')
  })

  it('S1/S2/S3 additive byte-identity still holds on the crowded fixture', () => {
    const a = markup({ design: crowdedDesign() })
    const b = markup({
      design: crowdedDesign(),
      onEntityPick: () => undefined,
      onMoveSelected: () => undefined,
      onDeleteSelected: () => undefined,
      onToolHotkey: () => undefined,
      onGridSnapToggle: () => undefined,
      selectedEntityIds: new Set(['cr1'])
    })
    expect(b).toBe(a)
  })
})
