/**
 * DrawingView ordinate / baseline / chain dimension RUNS -- model + render pins
 * (node-env).
 *
 * Sibling of `DrawingView.centermarks.test.tsx` (the template this mirrors).
 * The renderer test environment is `node` (no jsdom, no @testing-library), so
 * the interactive click->persist->re-resolve path in `DrawingView.tsx` cannot
 * be driven through a rendered component. All of that logic lives in the pure
 * run machine + emitters in `drawing-annotation-model.ts`, which IS
 * unit-testable; the component's static surface is pinned with
 * `renderToStaticMarkup`, and the click-pipeline wiring is source-pinned (the
 * drawings-persistence-wiring convention). This suite covers:
 *
 *   1. RUN MACHINE -- a priming click stores the run datum (ordinate 0-datum
 *      origin / baseline base / first chain point) and mints NOTHING; every
 *      later click mints one persisted dimension. Ordinate reuses the SHARED
 *      origin (including across an axis switch); baseline members share one
 *      setId and stack one step further out per member; chain members share
 *      one setId and thread `prev -> click`. Runs never self-terminate (Esc /
 *      re-click ends them -- component-side, source-pinned).
 *   2. BUILDERS -- buildBaselineDimension memberIndex stacking,
 *      buildChainDimension, and the buildOrdinateDimension leader placement
 *      (perpendicular to the measured axis).
 *   3. EMITTER pins -- ordinate callout (origin marker + feature dot + leader
 *      + read-out), baseline/chain linear paint (extension lines + dimension
 *      line + oblique ticks + read-out), label escaping (Safety Rule 4),
 *      dangling badging, the layer group + compose splice.
 *   4. RE-ANCHOR + DANGLING -- the kind-agnostic reanchorDimensions pass
 *      refreshes resolved anchors and dangles vanished ones for all three
 *      kinds (no special-casing).
 *   5. DELETE -- the pure removeDimension helper.
 *   6. SCHEMA back-compat -- a legacy annotations payload parses unchanged;
 *      hand-written ordinate/baseline/chain JSON round-trips byte-faithfully.
 *   7. The DrawingView AFFORDANCE -- the four run buttons render; persisted
 *      set-dimensions compose into the canvas SVG; the per-item delete list
 *      renders every kind; ESC-ends-run + pipeline exclusivity + the
 *      sidecar-kind filter are source-pinned.
 *
 * Safety Rule 1: documentation overlays only -- no G-code / STL touched.
 * Safety Rule 3: no `any`. The only free text reaching these emitters is the
 * optional label, entity-escaped at the emitter (Safety Rule 4).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  advanceDimensionRun,
  baselineDimensionToSvg,
  buildBaselineDimension,
  buildChainDimension,
  buildOrdinateDimension,
  chainDimensionToSvg,
  composeDimensionSetsIntoSvg,
  dimensionSetsLayerSvg,
  ordinateDimensionToSvg,
  reanchorDimensions,
  removeDimension,
  startBaselineRun,
  startChainRun,
  startOrdinateRun,
  DEFAULT_DIMENSION_OFFSET,
  FREE_ANCHOR_REF_ID,
  type FreshSnapPoint,
  type ResolvedClick,
} from '../drawing-annotation-model'
import {
  DrawingView,
  DIMENSION_RUN_LABELS,
  DIMENSION_RUN_TOOL_ORDER,
  dimensionRowLabel,
  dimensionRunToolTestId,
} from '../DrawingView'
import {
  drawingSheetAnnotationsSchema,
  type DrawingDimension,
} from '../../../shared/drawing-annotation-schema'

// -- window.fab shim (see DrawingView.test.tsx for rationale) ------------------
const gAsRecord = globalThis as unknown as Record<string, unknown>
if (gAsRecord['window'] === undefined) {
  gAsRecord['window'] = globalThis
}
if (gAsRecord['fab'] === undefined) {
  gAsRecord['fab'] = { cad: {} }
}

// -- Fixtures ------------------------------------------------------------------

function snapClick(sourceId: string, x: number, y: number): ResolvedClick {
  return { sourceId, point: { x, y } }
}
function freeClick(x: number, y: number): ResolvedClick {
  return { sourceId: null, point: { x, y } }
}
function snapPoint(id: string, sourceId: string, x: number, y: number): FreshSnapPoint {
  return { id, sourceId, x, y }
}

const DRAWING_VIEW_SRC = readFileSync(join(__dirname, '..', 'DrawingView.tsx'), 'utf-8')

// -- (A) Run machine -- placement flows ------------------------------------------

describe('ordinate run -- priming origin + shared-origin read-outs', () => {
  it('the priming click stores the 0-datum origin and mints nothing', () => {
    const armed = startOrdinateRun('x')
    const { next, minted } = advanceDimensionRun(armed, snapClick('v:o', 5, 5))
    expect(minted).toBeNull()
    expect(next.kind).toBe('ordinate')
    if (next.kind === 'ordinate') {
      expect(next.axis).toBe('x')
      expect(next.origin?.sourceId).toBe('v:o')
    }
  })

  it('every later click mints one ordinate read-out from the SHARED origin', () => {
    const primed = advanceDimensionRun(startOrdinateRun('x'), snapClick('v:o', 5, 5)).next
    const r1 = advanceDimensionRun(primed, snapClick('v:f1', 40, 100))
    const r2 = advanceDimensionRun(r1.next, snapClick('v:f2', 65, 30))
    expect(r1.minted).not.toBeNull()
    expect(r2.minted).not.toBeNull()
    if (r1.minted?.kind === 'ordinate' && r2.minted?.kind === 'ordinate') {
      // Both read from the same origin anchor (refId AND coordinate).
      expect(r1.minted.origin.refId).toBe('v:o')
      expect(r2.minted.origin.refId).toBe('v:o')
      expect(r2.minted.origin.cachedPoint).toEqual({ x: 5, y: 5 })
      expect(r1.minted.axis).toBe('x')
      expect(r1.minted.value).toBeCloseTo(35)
      expect(r2.minted.value).toBeCloseTo(60)
    }
    // The run stays armed with the origin intact (never self-terminates).
    expect(r2.next.kind).toBe('ordinate')
    if (r2.next.kind === 'ordinate') {
      expect(r2.next.origin?.sourceId).toBe('v:o')
    }
  })

  it('switching axis mid-run REUSES the picked origin (no re-priming click)', () => {
    const primed = advanceDimensionRun(startOrdinateRun('x'), snapClick('v:o', 5, 5)).next
    if (primed.kind !== 'ordinate') throw new Error('expected ordinate run')
    const switched = startOrdinateRun('y', primed.origin)
    // First click after the switch MINTS immediately -- the origin carried over.
    const { minted } = advanceDimensionRun(switched, snapClick('v:f', 40, 100))
    expect(minted).not.toBeNull()
    if (minted?.kind === 'ordinate') {
      expect(minted.axis).toBe('y')
      expect(minted.origin.refId).toBe('v:o')
      expect(minted.value).toBeCloseTo(95)
    }
  })

  it('a free priming click yields a free (never-dangling) origin anchor', () => {
    const primed = advanceDimensionRun(startOrdinateRun('x'), freeClick(0, 0)).next
    const { minted } = advanceDimensionRun(primed, snapClick('v:f', 12, 0))
    if (minted?.kind === 'ordinate') {
      expect(minted.origin.refId).toBe(FREE_ANCHOR_REF_ID)
      expect(minted.feature.refId).toBe('v:f')
    }
  })
})

describe('baseline run -- shared setId + stacked placement', () => {
  it('members share one setId, read from the shared base, and stack one step out per member', () => {
    const primed = advanceDimensionRun(startBaselineRun(), snapClick('v:0', 0, 0))
    expect(primed.minted).toBeNull()
    const r1 = advanceDimensionRun(primed.next, snapClick('v:1', 10, 0))
    const r2 = advanceDimensionRun(r1.next, snapClick('v:2', 25, 0))
    const r3 = advanceDimensionRun(r2.next, snapClick('v:3', 40, 0))
    const minted = [r1.minted, r2.minted, r3.minted]
    expect(minted.every((m) => m !== null && m.kind === 'baseline')).toBe(true)
    const members = minted.filter(
      (m): m is Extract<DrawingDimension, { kind: 'baseline' }> =>
        m !== null && m.kind === 'baseline',
    )
    // One shared setId, one shared origin.
    expect(new Set(members.map((m) => m.setId)).size).toBe(1)
    expect(members.every((m) => m.origin.refId === 'v:0')).toBe(true)
    expect(members.map((m) => m.value.toFixed(0))).toEqual(['10', '25', '40'])
    // Standard offset stacking: each dimension line one DEFAULT_DIMENSION_OFFSET further out.
    expect(members[0].placement.y).toBeCloseTo(-DEFAULT_DIMENSION_OFFSET)
    expect(members[1].placement.y).toBeCloseTo(-2 * DEFAULT_DIMENSION_OFFSET)
    expect(members[2].placement.y).toBeCloseTo(-3 * DEFAULT_DIMENSION_OFFSET)
    // Unique member ids.
    expect(new Set(members.map((m) => m.id)).size).toBe(3)
  })
})

describe('chain run -- prev -> click threading', () => {
  it('mints dim(A,B) then dim(B,C) then dim(C,D) with one shared setId', () => {
    const primed = advanceDimensionRun(startChainRun(), snapClick('v:a', 0, 0))
    expect(primed.minted).toBeNull()
    const r1 = advanceDimensionRun(primed.next, snapClick('v:b', 10, 0))
    const r2 = advanceDimensionRun(r1.next, snapClick('v:c', 30, 0))
    const r3 = advanceDimensionRun(r2.next, snapClick('v:d', 45, 0))
    const members = [r1.minted, r2.minted, r3.minted].filter(
      (m): m is Extract<DrawingDimension, { kind: 'chain' }> =>
        m !== null && m.kind === 'chain',
    )
    expect(members).toHaveLength(3)
    expect(new Set(members.map((m) => m.setId)).size).toBe(1)
    expect(members[0].start.refId).toBe('v:a')
    expect(members[0].end.refId).toBe('v:b')
    expect(members[1].start.refId).toBe('v:b')
    expect(members[1].end.refId).toBe('v:c')
    expect(members[2].start.refId).toBe('v:c')
    expect(members[2].end.refId).toBe('v:d')
    expect(members.map((m) => m.value)).toEqual([10, 20, 15])
    // prev advanced to the last click; the run stays armed.
    expect(r3.next.kind).toBe('chain')
    if (r3.next.kind === 'chain') {
      expect(r3.next.prev?.sourceId).toBe('v:d')
    }
  })

  it('every run-minted member parses into the persistence schema', () => {
    const oPrimed = advanceDimensionRun(startOrdinateRun('x'), snapClick('v:o', 0, 0)).next
    const bPrimed = advanceDimensionRun(startBaselineRun(), snapClick('v:0', 0, 0)).next
    const cPrimed = advanceDimensionRun(startChainRun(), snapClick('v:a', 0, 0)).next
    const dims = [
      advanceDimensionRun(oPrimed, snapClick('v:f', 12, 0)).minted,
      advanceDimensionRun(bPrimed, snapClick('v:1', 10, 0)).minted,
      advanceDimensionRun(cPrimed, snapClick('v:b', 5, 0)).minted,
    ].filter((m): m is DrawingDimension => m !== null)
    const parsed = drawingSheetAnnotationsSchema.parse({ dimensions: dims })
    expect(parsed.dimensions).toHaveLength(3)
    expect(parsed.dimensions).toEqual(dims)
  })
})

// -- (B) Builders ----------------------------------------------------------------

describe('buildBaselineDimension / buildChainDimension / ordinate placement', () => {
  it('buildBaselineDimension stacks by memberIndex and mints a fresh setId by default', () => {
    const m0 = buildBaselineDimension(snapClick('v:0', 0, 0), snapClick('v:1', 10, 0))
    expect(m0.placement.y).toBeCloseTo(-DEFAULT_DIMENSION_OFFSET)
    const m3 = buildBaselineDimension(snapClick('v:0', 0, 0), snapClick('v:1', 10, 0), {
      memberIndex: 3,
      stepMm: 5,
    })
    expect(m3.placement.y).toBeCloseTo(-20)
    expect(m0.setId).not.toBe(m3.setId)
    const shared = buildBaselineDimension(snapClick('v:0', 0, 0), snapClick('v:1', 10, 0), {
      setId: 'set:baseline:x:1',
    })
    expect(shared.setId).toBe('set:baseline:x:1')
  })

  it('buildChainDimension records both anchors, the segment length, and the label', () => {
    const dim = buildChainDimension(snapClick('v:a', 0, 0), snapClick('v:b', 30, 0), {
      setId: 'set:chain:x:1',
      label: '30 +/-0.1',
    })
    expect(dim.start.refId).toBe('v:a')
    expect(dim.end.refId).toBe('v:b')
    expect(dim.setId).toBe('set:chain:x:1')
    expect(dim.value).toBeCloseTo(30)
    expect(dim.label).toBe('30 +/-0.1')
  })

  it('buildOrdinateDimension places the leader perpendicular to the measured axis', () => {
    const x = buildOrdinateDimension(snapClick('v:o', 0, 0), snapClick('v:f', 35, 10), 'x')
    // X read-out: vertical leader (placement offset in -y from the feature).
    expect(x.placement).toEqual({ x: 35, y: 10 - DEFAULT_DIMENSION_OFFSET })
    const y = buildOrdinateDimension(snapClick('v:o', 0, 0), snapClick('v:f', 35, 10), 'y')
    // Y read-out: horizontal leader (placement offset in +x from the feature).
    expect(y.placement).toEqual({ x: 35 + DEFAULT_DIMENSION_OFFSET, y: 10 })
  })
})

// -- (C) Emitter pins --------------------------------------------------------------

const ORD: Extract<DrawingDimension, { kind: 'ordinate' }> = {
  kind: 'ordinate',
  id: 'dim-ord-1',
  origin: { refId: 'v:o', cachedPoint: { x: 0, y: 0 } },
  feature: { refId: 'v:f', cachedPoint: { x: 35, y: 10 } },
  axis: 'x',
  value: 35,
  placement: { x: 35, y: 2 },
}

const BASE: Extract<DrawingDimension, { kind: 'baseline' }> = {
  kind: 'baseline',
  id: 'dim-base-1',
  origin: { refId: 'v:o', cachedPoint: { x: 0, y: 0 } },
  feature: { refId: 'v:b', cachedPoint: { x: 30, y: 0 } },
  setId: 'set:baseline:t:1',
  value: 30,
  placement: { x: 30, y: -8 },
}

const CHAIN: Extract<DrawingDimension, { kind: 'chain' }> = {
  kind: 'chain',
  id: 'dim-chain-1',
  start: { refId: 'v:b', cachedPoint: { x: 30, y: 0 } },
  end: { refId: 'v:c', cachedPoint: { x: 45, y: 0 } },
  setId: 'set:chain:t:1',
  value: 15,
  placement: { x: 37.5, y: -8 },
}

describe('ordinateDimensionToSvg -- coordinate read-out emitter', () => {
  it('emits origin marker + feature dot + leader + read-out text', () => {
    const svg = ordinateDimensionToSvg(ORD)
    // 0-datum origin marker circle.
    expect(svg).toContain('cx="0" cy="0" r="1"')
    // Feature dot.
    expect(svg).toContain('cx="35" cy="10" r="0.6"')
    // Short leader from the feature to the placement point.
    expect(svg).toContain('x1="35" y1="10" x2="35" y2="2"')
    // Read-out = distance from the origin along the axis, at the leader end.
    expect(svg).toContain('>35</text>')
    expect(svg).toContain('x="35" y="1"')
    expect(svg).toContain('stroke="currentColor"')
    expect(svg).toContain('class="drawing-dim-set drawing-dim-set--ordinate"')
    expect(svg).toContain('data-dim-id="dim-ord-1"')
    expect(svg).toContain('data-dim-kind="ordinate"')
    expect(svg).toContain('data-dim-axis="x"')
    expect(svg).not.toContain('stroke-opacity')
  })

  it('entity-escapes the label override (Safety Rule 4)', () => {
    const hostile = { ...ORD, label: '</text><script>alert(1)</script>' }
    const svg = ordinateDimensionToSvg(hostile)
    expect(svg).toContain('&lt;/text&gt;&lt;script&gt;')
    expect(svg).not.toContain('<script>')
  })

  it('flags dangling with the modifier class + data attr + reduced opacity', () => {
    const svg = ordinateDimensionToSvg(ORD, { dangling: true })
    expect(svg).toContain('drawing-dim-set--dangling')
    expect(svg).toContain('data-dim-dangling="true"')
    expect(svg).toContain('stroke-opacity="0.5"')
    expect(svg).toContain('stroke-dasharray="1.5 1"')
  })

  it('is pure: same input -> byte-identical output', () => {
    expect(ordinateDimensionToSvg(ORD)).toBe(ordinateDimensionToSvg(ORD))
  })
})

describe('baselineDimensionToSvg / chainDimensionToSvg -- linear paint', () => {
  it('baseline: extension lines + dimension line on the placement row + ticks + read-out', () => {
    const svg = baselineDimensionToSvg(BASE)
    // Extension lines from origin / feature out to the y=-8 row.
    expect(svg).toContain('x1="0" y1="0" x2="0" y2="-8"')
    expect(svg).toContain('x1="30" y1="0" x2="30" y2="-8"')
    // The dimension line itself along the row.
    expect(svg).toContain('x1="0" y1="-8" x2="30" y2="-8"')
    // Read-out text nudged off the line on the placement side.
    expect(svg).toContain('x="15" y="-9.5"')
    expect(svg).toContain('>30</text>')
    // 2 extension + 1 dimension + 2 oblique ticks = 5 lines.
    expect(svg.match(/<line /g) ?? []).toHaveLength(5)
    expect(svg).toContain('class="drawing-dim-set drawing-dim-set--baseline"')
    expect(svg).toContain('data-dim-id="dim-base-1"')
    expect(svg).toContain('data-dim-kind="baseline"')
    expect(svg).toContain('data-dim-set="set:baseline:t:1"')
  })

  it('chain: same linear paint with the chain kind + setId attrs', () => {
    const svg = chainDimensionToSvg(CHAIN)
    expect(svg).toContain('x1="30" y1="-8" x2="45" y2="-8"')
    expect(svg).toContain('>15</text>')
    expect(svg).toContain('class="drawing-dim-set drawing-dim-set--chain"')
    expect(svg).toContain('data-dim-kind="chain"')
    expect(svg).toContain('data-dim-set="set:chain:t:1"')
  })

  it('flags dangling with the modifier class + data attr + reduced opacity', () => {
    const svg = baselineDimensionToSvg(BASE, { dangling: true })
    expect(svg).toContain('drawing-dim-set--dangling')
    expect(svg).toContain('data-dim-dangling="true"')
    expect(svg).toContain('stroke-opacity="0.5"')
    const chainSvg = chainDimensionToSvg(CHAIN, { dangling: true })
    expect(chainSvg).toContain('drawing-dim-set--dangling')
  })
})

describe('dimensionSetsLayerSvg / composeDimensionSetsIntoSvg', () => {
  it('wraps set members in the layer group, badging danglers', () => {
    const layer = dimensionSetsLayerSvg([ORD, BASE, CHAIN], new Set([BASE.id]))
    expect(layer).toContain('class="drawing-dim-set-layer"')
    expect(layer).toContain('data-testid="design-drawing-dim-set-layer"')
    expect(layer.match(/data-dim-id=/g) ?? []).toHaveLength(3)
    expect(layer.match(/data-dim-dangling="true"/g) ?? []).toHaveLength(1)
  })

  it('SKIPS the four sidecar-native kinds (no second render system)', () => {
    const linear: DrawingDimension = {
      kind: 'linear',
      id: 'dim-lin-1',
      orientation: 'aligned',
      start: { refId: 'v:a', cachedPoint: { x: 0, y: 0 } },
      end: { refId: 'v:b', cachedPoint: { x: 30, y: 0 } },
      value: 30,
      placement: { x: 15, y: -8 },
    }
    expect(dimensionSetsLayerSvg([linear])).toBe('')
    // A mixed list only paints the set-based members.
    const layer = dimensionSetsLayerSvg([linear, ORD])
    expect(layer.match(/data-dim-id=/g) ?? []).toHaveLength(1)
    expect(layer).toContain('data-dim-id="dim-ord-1"')
  })

  it('splices the layer in just before </svg>; input unchanged when nothing to paint', () => {
    const base = '<svg width="800" height="600"><rect/></svg>'
    const composed = composeDimensionSetsIntoSvg(base, [ORD])
    const rectIdx = composed.indexOf('<rect/>')
    const layerIdx = composed.indexOf('drawing-dim-set-layer')
    const closeIdx = composed.indexOf('</svg>')
    expect(layerIdx).toBeGreaterThan(rectIdx)
    expect(closeIdx).toBeGreaterThan(layerIdx)
    expect(composeDimensionSetsIntoSvg(base, [])).toBe(base)
  })
})

// -- (D) removeDimension -- pure per-item delete -----------------------------------

describe('removeDimension', () => {
  it('removes exactly the matching dimension (inputs untouched)', () => {
    const dims: DrawingDimension[] = [ORD, BASE, CHAIN]
    const next = removeDimension(dims, BASE.id)
    expect(next).toHaveLength(2)
    expect(next.map((d) => d.id)).toEqual([ORD.id, CHAIN.id])
    expect(dims).toHaveLength(3)
  })

  it('is a no-op for an unknown id', () => {
    expect(removeDimension([ORD], 'nope')).toHaveLength(1)
  })
})

// -- (E) re-anchor + dangling (kind-agnostic pass) ----------------------------------

describe('reanchorDimensions covers ordinate / baseline / chain (no special-casing)', () => {
  it('refreshes resolved anchors on all three kinds', () => {
    const fresh = [
      snapPoint('s:1', 'v:o', 2, 2),
      snapPoint('s:2', 'v:f', 40, 12),
      snapPoint('s:3', 'v:b', 33, 2),
      snapPoint('s:4', 'v:c', 48, 2),
    ]
    const { dimensions, danglingIds } = reanchorDimensions([ORD, BASE, CHAIN], fresh)
    expect(danglingIds.size).toBe(0)
    const [ord, base, chain] = dimensions
    if (ord.kind === 'ordinate') {
      expect(ord.origin.cachedPoint).toEqual({ x: 2, y: 2 })
      expect(ord.feature.cachedPoint).toEqual({ x: 40, y: 12 })
    }
    if (base.kind === 'baseline') {
      expect(base.origin.cachedPoint).toEqual({ x: 2, y: 2 })
      expect(base.feature.cachedPoint).toEqual({ x: 33, y: 2 })
    }
    if (chain.kind === 'chain') {
      expect(chain.start.cachedPoint).toEqual({ x: 33, y: 2 })
      expect(chain.end.cachedPoint).toEqual({ x: 48, y: 2 })
    }
    // Inputs never mutated.
    expect(ORD.origin.cachedPoint).toEqual({ x: 0, y: 0 })
  })

  it('flags a member dangling when its feature vanished (stale point kept)', () => {
    // Only the ordinate origin survives; every feature anchor is gone.
    const fresh = [snapPoint('s:1', 'v:o', 0, 0)]
    const { dimensions, danglingIds } = reanchorDimensions([ORD, BASE, CHAIN], fresh)
    expect(danglingIds.has(ORD.id)).toBe(true)
    expect(danglingIds.has(BASE.id)).toBe(true)
    expect(danglingIds.has(CHAIN.id)).toBe(true)
    const ord = dimensions[0]
    if (ord.kind === 'ordinate') {
      // Graceful fallback: the stale feature coordinate still draws.
      expect(ord.feature.cachedPoint).toEqual({ x: 35, y: 10 })
    }
  })
})

// -- (F) Schema back-compat (Safety Rule 2) ------------------------------------------

describe('drawingSheetAnnotationsSchema -- legacy parse unchanged', () => {
  it('a legacy payload without dimensions defaults to []', () => {
    const parsed = drawingSheetAnnotationsSchema.parse({})
    expect(parsed.dimensions).toEqual([])
  })

  it('hand-written ordinate/baseline/chain JSON (a legacy drawing.json) round-trips byte-faithfully', () => {
    // Exactly what an operator-era drawing.json could already contain -- the
    // kinds were schema'd long before this toolbar existed.
    const legacy = {
      dimensions: [
        {
          kind: 'ordinate',
          id: 'legacy-ord',
          origin: { refId: 'v:0', cachedPoint: { x: 0, y: 0 } },
          feature: { refId: 'v:9', cachedPoint: { x: 12, y: 3 } },
          axis: 'y',
          value: 3,
          placement: { x: 12, y: 3 },
        },
        {
          kind: 'baseline',
          id: 'legacy-base',
          origin: { refId: 'v:0', cachedPoint: { x: 0, y: 0 } },
          feature: { refId: 'v:7', cachedPoint: { x: 20, y: 0 } },
          setId: 'legacy-set-1',
          value: 20,
          placement: { x: 20, y: -8 },
          label: '20 REF',
        },
        {
          kind: 'chain',
          id: 'legacy-chain',
          start: { refId: 'v:7', cachedPoint: { x: 20, y: 0 } },
          end: { refId: 'v:8', cachedPoint: { x: 35, y: 0 } },
          setId: 'legacy-set-2',
          value: 15,
          placement: { x: 27.5, y: -8 },
        },
      ],
    }
    const parsed = drawingSheetAnnotationsSchema.parse(legacy)
    expect(parsed.dimensions).toEqual(legacy.dimensions)
  })
})

// -- (G) DrawingView affordance + render pins ----------------------------------------

describe('DrawingView -- run-tool toolbar + set-dimension render contract', () => {
  it('renders all four run buttons with stable testids and labels', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: 'script:abc',
        previewSvg: '<svg></svg>',
      }),
    )
    for (const kind of DIMENSION_RUN_TOOL_ORDER) {
      expect(html).toContain(`data-testid="${dimensionRunToolTestId(kind)}"`)
      expect(html).toContain(DIMENSION_RUN_LABELS[kind])
    }
    // Idle: nothing armed.
    const dimSection = html.slice(html.indexOf('design-drawing-dim-toolbar'))
    expect(dimSection).not.toContain('design-drawing__dim-btn--placing')
  })

  it('testid generator is stable (design-drawing-dim-{kind})', () => {
    expect(dimensionRunToolTestId('ordinate-x')).toBe('design-drawing-dim-ordinate-x')
    expect(dimensionRunToolTestId('baseline')).toBe('design-drawing-dim-baseline')
    expect(dimensionRunToolTestId('chain')).toBe('design-drawing-dim-chain')
  })

  it('composes persisted set-dimensions into the canvas SVG + counts them', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: 'script:abc',
        previewSvg: '<svg width="800" height="600"><rect/></svg>',
        persistedDimensions: [ORD, BASE, CHAIN],
      }),
    )
    expect(html).toContain('data-testid="design-drawing-svg"')
    expect(html).toContain('drawing-dim-set-layer')
    expect(html).toContain('data-dim-kind="ordinate"')
    expect(html).toContain('data-dim-kind="baseline"')
    expect(html).toContain('data-dim-kind="chain"')
    expect(html).toContain('3 dimensions')
  })

  it('renders the per-item delete list covering every kind', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: 'script:abc',
        previewSvg: '<svg><rect/></svg>',
        persistedDimensions: [ORD, BASE, CHAIN],
      }),
    )
    expect(html).toContain('data-testid="design-drawing-dim-list"')
    expect(html).toContain(`data-testid="design-drawing-dim-delete-${ORD.id}"`)
    expect(html).toContain(`data-testid="design-drawing-dim-delete-${BASE.id}"`)
    expect(html).toContain(`data-testid="design-drawing-dim-delete-${CHAIN.id}"`)
    expect(html).toContain('Ordinate X 35.0')
    expect(html).toContain('Baseline 30.0')
    expect(html).toContain('Chain 15.0')
  })

  it('dimensionRowLabel covers every dimension kind', () => {
    expect(dimensionRowLabel(ORD)).toBe('Ordinate X 35.0')
    expect(dimensionRowLabel(BASE)).toBe('Baseline 30.0')
    expect(dimensionRowLabel(CHAIN)).toBe('Chain 15.0')
    const linear: DrawingDimension = {
      kind: 'linear',
      id: 'l1',
      orientation: 'aligned',
      start: { refId: '', cachedPoint: { x: 0, y: 0 } },
      end: { refId: '', cachedPoint: { x: 30, y: 0 } },
      value: 30,
      placement: { x: 15, y: -8 },
    }
    expect(dimensionRowLabel(linear)).toBe('Distance 30.0')
  })

  it('renders fine WITHOUT persisted dimensions (back-compat: no layer, no list)', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: 'script:abc',
        previewSvg: '<svg><circle/></svg>',
      }),
    )
    expect(html).toContain('data-testid="design-drawing-svg"')
    expect(html).not.toContain('drawing-dim-set-layer')
    expect(html).not.toContain('data-testid="design-drawing-dim-list"')
  })
})

// -- (H) Click pipeline + exclusivity + Esc (source pins) -----------------------------

describe('DrawingView -- run pipeline wiring (source pins)', () => {
  it('pointer-down feeds resolved clicks through the pure run machine', () => {
    expect(DRAWING_VIEW_SRC).toContain(
      'const { next, minted } = advanceDimensionRun(runState, resolvedClick)',
    )
    expect(DRAWING_VIEW_SRC).toContain('if (minted !== null) commitRunDimension(minted)')
  })

  it('Esc ends a run (and every other placement pipeline)', () => {
    expect(DRAWING_VIEW_SRC).toContain("if (e.key === 'Escape') {")
    const escBlock = DRAWING_VIEW_SRC.slice(
      DRAWING_VIEW_SRC.indexOf("if (e.key === 'Escape') {"),
    )
    expect(escBlock.slice(0, 400)).toContain('setRunState(null)')
    expect(escBlock.slice(0, 400)).toContain('setPlacementState(null)')
    expect(escBlock.slice(0, 400)).toContain('setToolMode(null)')
  })

  it('re-clicking the armed button ends the run; axis switch reuses the origin', () => {
    expect(DRAWING_VIEW_SRC).toContain('if (runStateToKind(prev) === kind) return null')
    expect(DRAWING_VIEW_SRC).toContain(
      "const carriedOrigin = prev !== null && prev.kind === 'ordinate' ? prev.origin : null",
    )
  })

  it('arming any other tool clears the run state (pipeline exclusivity)', () => {
    // Every start* pipeline entry also clears the run machine.
    expect(
      (DRAWING_VIEW_SRC.match(/setRunState\(null\)/g) ?? []).length,
    ).toBeGreaterThanOrEqual(9)
  })

  it('set-based kinds are filtered OUT of the sidecar dimension path (no double render)', () => {
    const filterIdx = DRAWING_VIEW_SRC.indexOf("dim.kind === 'linear' ||")
    expect(filterIdx).toBeGreaterThan(-1)
    expect(DRAWING_VIEW_SRC).toContain('.map(persistedDimensionToSpec)')
  })

  it('the set-dimension layer composes into displaySvg AFTER centerlines', () => {
    const linesIdx = DRAWING_VIEW_SRC.indexOf('composeCenterlinesIntoSvg(composed')
    const setsIdx = DRAWING_VIEW_SRC.indexOf('composeDimensionSetsIntoSvg(composed')
    expect(linesIdx).toBeGreaterThan(-1)
    expect(setsIdx).toBeGreaterThan(linesIdx)
  })
})
