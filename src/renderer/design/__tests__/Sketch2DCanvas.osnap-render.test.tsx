/**
 * Sketch S2 -- render + source contracts for the object-snap canvas
 * integration (session-wired Sketch2DCanvas only; the MVP variant is
 * untouched by S2).
 *
 * Repo tests are node-SSR (renderToStaticMarkup; no jsdom, no pointer
 * events), so per the S1 convention:
 *   - the resolution engine is PURE and unit-tested in sketch2d-osnap.test.ts;
 *   - the DOM-visible half is pinned as markup (the OSNAP toggle chip,
 *     additive byte-identity preserved, no marker chrome in static markup --
 *     the marker is canvas-drawn and cursor-driven);
 *   - the pointer halves SSR cannot move are pinned as source text, mirroring
 *     Sketch2DCanvas.select-render.test.tsx.
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

describe('Sketch2DCanvas OSNAP toggle -- render contract (node-SSR)', () => {
  it('renders on every session-canvas mount, default ON, as a real button', () => {
    const html = markup()
    expect(html).toContain('data-testid="sketch-osnap-toggle"')
    expect(html).toContain('data-osnap="on"')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('OSNAP on')
    expect(html).toMatch(/<button type="button"[^>]*data-testid="sketch-osnap-toggle"/)
  })

  it('S1 additive byte-identity STILL holds with the toggle present on both sides', () => {
    const baseline = markup()
    const withProps = markup({
      onEntityPick: () => undefined,
      onMoveSelected: () => undefined,
      onDeleteSelected: () => undefined,
      selectedEntityIds: new Set(['r1'])
    })
    expect(withProps).toBe(baseline)
    expect(baseline).toContain('data-testid="sketch-osnap-toggle"')
  })

  it('the toggle is mode chrome, not tool chrome: present in select mode and on unwired mounts', () => {
    expect(markup({ activeTool: 'select' })).toContain('data-testid="sketch-osnap-toggle"')
    expect(markup({ activeTool: 'circle' })).toContain('data-testid="sketch-osnap-toggle"')
  })

  it('no marker chrome in static markup -- the marker is canvas-drawn, cursor-driven', () => {
    const html = markup()
    expect(html).not.toContain('sketch-osnap-marker')
    expect(html).not.toContain('Endpoint')
    expect(html).not.toContain('Intersection')
  })

  it('both snap systems stay independent: the toggle never reads gridMm', () => {
    // Grid pitch changes do not alter the OSNAP chip markup.
    const a = markup({ gridMm: 5 })
    const b = markup({ gridMm: 0.01 })
    const chip = /<button type="button"[^>]*data-testid="sketch-osnap-toggle"[^>]*>/
    expect(a.match(chip)?.[0]).toBe(b.match(chip)?.[0])
  })
})

const SRC = readFileSync(resolve(__dirname, '../Sketch2DCanvas.tsx'), 'utf-8')
const DRAW = readFileSync(resolve(__dirname, '../sketch2d-draw.ts'), 'utf-8')

describe('Sketch2DCanvas osnap -- source pins (pointer halves SSR cannot move)', () => {
  it('the ONE pointer-resolution path: both mousedown and mousemove run resolvePointerPlacement', () => {
    expect(SRC).toContain('const placement = resolvePointerPlacement(raw)')
    expect(SRC).toContain('inferDrawPoint(placement.point, placement.snapped != null).point')
    expect(SRC).toContain('const res = resolvePointerPlacement(raw)')
    expect(SRC).toContain('const p: [number, number] = inferred.point')
    // The bare lattice call is GONE from the pointer path (typed-dimension
    // fields still snap their numeric input to the grid -- that is not the
    // pointer path).
    expect(SRC).not.toContain('[snap(raw[0], gridMm), snap(raw[1], gridMm)]')
  })

  it('the resolver routes through the pure engine with both toggles independent', () => {
    expect(SRC).toMatch(
      /resolveSnappedPoint\(\{\s*raw,\s*candidates: osnapCandidates,\s*gridMm,\s*gridEnabled: true,\s*osnapEnabled,\s*toleranceMm: osnapToleranceMm\(scale\)/
    )
    expect(SRC).toContain('const [osnapEnabled, setOsnapEnabled] = useState(true)')
  })

  it('candidates are memoized per design revision (recompute on design change only)', () => {
    // Sketch S3 intended drift: the per-design memo now runs the DETAILED
    // collector so the truncation flag rides the same single collect; the
    // resolver still consumes the identical candidate array.
    expect(SRC).toContain(
      'const osnapCollect = useMemo(() => collectOsnapCandidatesDetailed({ design }), [design])'
    )
    expect(SRC).toContain('const osnapCandidates = osnapCollect.candidates')
  })

  it('drag-move resolves through the same engine with the MOVING selection excluded', () => {
    expect(SRC).toContain('collectOsnapCandidates({ design, excludeEntityIds: moving })')
    expect(SRC).toContain('moving.add(entityId)')
    expect(SRC).toContain('osnapCandidates: gestureCandidates')
    expect(SRC).toMatch(/resolveDragDeltaWithOsnap\(\{\s*startWorld: sd\.startWorld/)
  })

  it('ghost == commit: the live ghost and the release emit come from the SAME call shape', () => {
    expect(SRC).toContain('const dragRes = resolveSelectDragDelta(sd, raw)')
    expect(SRC).toContain('setSelectGhostOffset(dragRes.deltaMm)')
    expect(SRC).toContain('const [dxMm, dyMm] = resolveSelectDragDelta(sd, raw).deltaMm')
  })

  it('marker present when snapped, absent otherwise (placement + drag paths)', () => {
    expect(SRC).toContain('setOsnapHover(markerEligible ? res.snapped : null)')
    expect(SRC).toContain('setOsnapHover(dragRes.snapped)')
  })

  it('marker clears on toggle-off, Escape drag-cancel, drag release, and pointer leave', () => {
    const clears = SRC.match(/setOsnapHover\(null\)/g) ?? []
    expect(clears.length).toBeGreaterThanOrEqual(4)
    expect(SRC).toMatch(/if \(!osnapEnabled\) setOsnapHover\(null\)/)
  })

  it('onCursorWorld keeps emitting the FINAL resolved point (Wave 3n threading intact)', () => {
    expect(SRC).toMatch(
      /const p: \[number, number\] = inferred\.point[\s\S]{0,250}?onCursorWorld\?\.\(p\)/
    )
  })

  it('toggle states: ON/OFF flips the class, the data attribute, and the label', () => {
    expect(SRC).toContain(
      "osnapEnabled ? 'sketch-osnap-toggle sketch-osnap-toggle--on' : 'sketch-osnap-toggle'"
    )
    expect(SRC).toContain("data-osnap={osnapEnabled ? 'on' : 'off'}")
    expect(SRC).toContain("{osnapEnabled ? 'OSNAP on' : 'OSNAP off'}")
    expect(SRC).toContain('onClick={() => setOsnapEnabled((v) => !v)}')
  })

  it('the marker feeds the draw module as an additive param', () => {
    expect(SRC).toContain('osnapMarker: osnapHover,')
  })

  it('the MVP variant is untouched by S2 (zero osnap references below its banner)', () => {
    const banner = '// MvpSketchCanvas (CAD V1 MVP sketcher)'
    expect(SRC).toContain(banner)
    const mvpTail = SRC.slice(SRC.indexOf(banner))
    expect(/osnap/i.test(mvpTail)).toBe(false)
    expect(SRC).toContain('sketch-mvp-cursor-readout')
  })
})

describe('sketch2d-draw -- osnap marker rendering pins (additive param)', () => {
  it('the param is optional + additive (absent = no change)', () => {
    expect(DRAW).toContain(
      'osnapMarker?: { kind: OsnapKind; point: readonly [number, number] } | null'
    )
  })

  it('draws a distinct glyph per kind with an exhaustive never-guard', () => {
    expect(DRAW).toMatch(/if \(osnapMarker\) \{[\s\S]{0,2600}?osnapKindLabel\(osnapMarker\.kind\)/)
    expect(DRAW).toMatch(/switch \(osnapMarker\.kind\) \{/)
    expect(DRAW).toContain('const _exhaustive: never = osnapMarker.kind')
  })

  it('renders the kind label chip near the snapped point (fillText readout idiom)', () => {
    expect(DRAW).toContain('const chip = osnapKindLabel(osnapMarker.kind)')
    expect(DRAW).toContain('ctx.fillText(chip, chipX + 5, chipY + 1)')
  })
})
