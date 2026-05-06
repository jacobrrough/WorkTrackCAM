/**
 * [ID-0196] Cycle 119 -- ui-polish paired-pin contract for the single
 * pure helper exported from `derive-features.ts`. The module is
 * load-bearing for the Design-tab Fusion-style browser tree:
 *
 *   `DesignSessionContext.tsx` calls `derivePartFeatures(design, prev)`
 *   from THREE places (the post-load reconcile path at line 424 plus
 *   two save-side reconciles at 631 and 650/669). Drift in this helper
 *   silently corrupts the on-screen feature list -- e.g. the Extrude row
 *   could lose its `depthMm` param, or a `sheet_*` follow-up `Sheet ...`
 *   row could be appended for a `pattern_*` last op.
 *
 * Because the same function feeds the renderer's tree across all three
 * target machines (Creality K2 Plus FDM, Laguna Swift 5x10 router,
 * Makera Carvera + 4-axis), this pin freezes the EXACT branch and
 * append behavior across all paths:
 *
 *   - sketch1 row is ALWAYS items[0] (every solidKind branch).
 *   - solidKind === 'extrude' appends ex1/Extrude1/extrude with
 *     params.depthMm = d.extrudeDepthMm.
 *   - solidKind === 'revolve' appends rv1/Revolve1/revolve with
 *     params { angleDeg, axisX } from d.revolve.
 *   - solidKind === 'loft' appends lf1/Loft1/loft with params
 *     { separationMm, profileCount }; profileCount is undefined when
 *     extractKernelProfiles returns null (no closed profiles).
 *   - prev?.kernelOps undefined -> no kernelOps key on result; items
 *     length is exactly 2.
 *   - prev.kernelOps empty array -> kernelOps preserved as []; no
 *     follow-up item appended; items length stays 2.
 *   - prev.kernelOps last.kind starts with 'sheet_' -> appends
 *     { id: `sm${len}`, kind: 'sheet', label: `Sheet ${last.kind}` }.
 *   - prev.kernelOps last.kind starts with 'plastic_' -> appends
 *     { id: `pl${len}`, kind: 'plastic', label: `Plastic ${last.kind}` }.
 *   - All other prefixes (pattern_, boolean_, mirror_, transform_,
 *     fillet_, chamfer_, thread_, etc.) leave items at 2 BUT still
 *     spread kernelOps from prev onto the result.
 *   - kernelOps is preserved by reference (same array, not a copy),
 *     mirroring the explicit `{ ...base, kernelOps: prev.kernelOps }`
 *     in the source.
 *
 * Mirrors the [ID-0186] Cycle 104 sketch2d-canvas-coords-pin and the
 * [ID-0190] Cycle 108 sketch-preview-placement-pin convention: a
 * paired-pin contract test added with ZERO production-code edits.
 */

import { describe, expect, it } from 'vitest'
import { derivePartFeatures } from './derive-features'
import { emptyDesign } from '../../shared/design-schema'
import type { DesignFileV2 } from '../../shared/design-schema'
import { partFeaturesFileSchema } from '../../shared/part-features-schema'
import type { PartFeaturesFile, KernelPostSolidOp } from '../../shared/part-features-schema'

function extrudeDesign(extrudeDepthMm = 10): DesignFileV2 {
  return { ...emptyDesign(), solidKind: 'extrude', extrudeDepthMm }
}

function revolveDesign(angleDeg = 360, axisX = 0): DesignFileV2 {
  return {
    ...emptyDesign(),
    solidKind: 'revolve',
    revolve: { angleDeg, axisX }
  }
}

function loftDesign(loftSeparationMm = 20, circles: { cx: number; cy: number; r: number }[] = []): DesignFileV2 {
  const d = emptyDesign()
  d.solidKind = 'loft'
  d.loftSeparationMm = loftSeparationMm
  d.entities = circles.map((c, i) => ({
    id: `c${i}`,
    kind: 'circle' as const,
    cx: c.cx,
    cy: c.cy,
    r: c.r
  }))
  return d
}

function tabUnionOp(centerXMm = 0, centerYMm = 0): KernelPostSolidOp {
  return {
    kind: 'sheet_tab_union',
    centerXMm,
    centerYMm,
    zBaseMm: 0,
    lengthMm: 5,
    widthMm: 3,
    heightMm: 2
  }
}

function plasticBossOp(): KernelPostSolidOp {
  return {
    kind: 'plastic_boss',
    centerXMm: 0,
    centerYMm: 0,
    zBaseMm: 0,
    outerRadiusMm: 4,
    heightMm: 5,
    draftDeg: 1
  }
}

describe('[ID-0196] derivePartFeatures -- A. sketch1 row is always items[0]', () => {
  it('extrude design starts with sk1/Sketch1/sketch', () => {
    const out = derivePartFeatures(extrudeDesign())
    expect(out.items[0]).toEqual({ id: 'sk1', kind: 'sketch', label: 'Sketch1' })
  })

  it('revolve design starts with sk1/Sketch1/sketch', () => {
    const out = derivePartFeatures(revolveDesign())
    expect(out.items[0]).toEqual({ id: 'sk1', kind: 'sketch', label: 'Sketch1' })
  })

  it('loft design (no profiles) starts with sk1/Sketch1/sketch', () => {
    const out = derivePartFeatures(loftDesign())
    expect(out.items[0]).toEqual({ id: 'sk1', kind: 'sketch', label: 'Sketch1' })
  })

  it('extrude with prev kernelOps still keeps sk1 at index 0', () => {
    const prev: PartFeaturesFile = {
      version: 1,
      items: [],
      kernelOps: [tabUnionOp()]
    }
    const out = derivePartFeatures(extrudeDesign(), prev)
    expect(out.items[0]).toEqual({ id: 'sk1', kind: 'sketch', label: 'Sketch1' })
  })

  it('all three solidKind branches share the IDENTICAL sketch row literal', () => {
    const a = derivePartFeatures(extrudeDesign()).items[0]
    const b = derivePartFeatures(revolveDesign()).items[0]
    const c = derivePartFeatures(loftDesign()).items[0]
    expect(a).toEqual(b)
    expect(b).toEqual(c)
  })
})

describe('[ID-0196] derivePartFeatures -- B. solidKind === extrude branch', () => {
  it('default extrudeDepthMm=10 produces ex1/Extrude1/extrude with params.depthMm=10', () => {
    const out = derivePartFeatures(extrudeDesign(10))
    expect(out.items[1]).toEqual({
      id: 'ex1',
      kind: 'extrude',
      label: 'Extrude1',
      params: { depthMm: 10 }
    })
  })

  it('custom extrudeDepthMm=25 propagates into params.depthMm', () => {
    const out = derivePartFeatures(extrudeDesign(25))
    expect(out.items[1]?.params).toEqual({ depthMm: 25 })
  })

  it('very small positive extrudeDepthMm=0.001 propagates without rounding', () => {
    const out = derivePartFeatures(extrudeDesign(0.001))
    expect(out.items[1]?.params).toEqual({ depthMm: 0.001 })
  })

  it('items.length is exactly 2 (sk + ex) when no prev kernelOps', () => {
    const out = derivePartFeatures(extrudeDesign())
    expect(out.items).toHaveLength(2)
  })

  it('extrude params keys are exactly { depthMm } (no leakage of revolve/loft params)', () => {
    const out = derivePartFeatures(extrudeDesign(7))
    expect(Object.keys(out.items[1]?.params ?? {}).sort()).toEqual(['depthMm'])
  })
})

describe('[ID-0196] derivePartFeatures -- C. solidKind === revolve branch', () => {
  it('default revolve produces rv1/Revolve1/revolve with params { angleDeg:360, axisX:0 }', () => {
    const out = derivePartFeatures(revolveDesign())
    expect(out.items[1]).toEqual({
      id: 'rv1',
      kind: 'revolve',
      label: 'Revolve1',
      params: { angleDeg: 360, axisX: 0 }
    })
  })

  it('custom revolve angleDeg=180 / axisX=12 propagates into params', () => {
    const out = derivePartFeatures(revolveDesign(180, 12))
    expect(out.items[1]?.params).toEqual({ angleDeg: 180, axisX: 12 })
  })

  it('revolve negative axisX=-7 propagates as a finite number (sign preserved)', () => {
    const out = derivePartFeatures(revolveDesign(45, -7))
    expect(out.items[1]?.params).toEqual({ angleDeg: 45, axisX: -7 })
  })

  it('items[1].id/kind/label match rv1/revolve/Revolve1 exactly', () => {
    const out = derivePartFeatures(revolveDesign(90, 1))
    expect(out.items[1]?.id).toBe('rv1')
    expect(out.items[1]?.kind).toBe('revolve')
    expect(out.items[1]?.label).toBe('Revolve1')
  })

  it('revolve params keys are exactly { angleDeg, axisX } (sorted)', () => {
    const out = derivePartFeatures(revolveDesign(90, 1))
    expect(Object.keys(out.items[1]?.params ?? {}).sort()).toEqual(['angleDeg', 'axisX'])
  })
})

describe('[ID-0196] derivePartFeatures -- D. solidKind === loft branch', () => {
  it('loft no profiles -> params { separationMm, profileCount: undefined }', () => {
    const out = derivePartFeatures(loftDesign(20))
    expect(out.items[1]).toEqual({
      id: 'lf1',
      kind: 'loft',
      label: 'Loft1',
      params: { separationMm: 20, profileCount: undefined }
    })
  })

  it('loft custom separationMm=50 propagates into params.separationMm', () => {
    const out = derivePartFeatures(loftDesign(50))
    expect(out.items[1]?.params?.separationMm).toBe(50)
  })

  it('loft with 1 closed circle -> profileCount === 1', () => {
    const out = derivePartFeatures(loftDesign(20, [{ cx: 0, cy: 0, r: 5 }]))
    expect(out.items[1]?.params?.profileCount).toBe(1)
  })

  it('loft with 2 circles -> profileCount === 2', () => {
    const out = derivePartFeatures(
      loftDesign(20, [
        { cx: 0, cy: 0, r: 5 },
        { cx: 10, cy: 10, r: 3 }
      ])
    )
    expect(out.items[1]?.params?.profileCount).toBe(2)
  })

  it('loft with 5 circles -> profileCount === 5', () => {
    const circles = Array.from({ length: 5 }, (_, i) => ({ cx: i * 10, cy: 0, r: 1 + i }))
    const out = derivePartFeatures(loftDesign(20, circles))
    expect(out.items[1]?.params?.profileCount).toBe(5)
  })

  it('loft items[1] id/kind/label fixed at lf1/loft/Loft1', () => {
    const out = derivePartFeatures(loftDesign(20))
    expect(out.items[1]?.id).toBe('lf1')
    expect(out.items[1]?.kind).toBe('loft')
    expect(out.items[1]?.label).toBe('Loft1')
  })

  it('loft params keys are exactly { separationMm, profileCount } (sorted)', () => {
    const out = derivePartFeatures(loftDesign(20, [{ cx: 0, cy: 0, r: 5 }]))
    expect(Object.keys(out.items[1]?.params ?? {}).sort()).toEqual(['profileCount', 'separationMm'])
  })

  it('loft items.length is exactly 2 (sk + lf) when no prev kernelOps', () => {
    const out = derivePartFeatures(loftDesign(20, [{ cx: 0, cy: 0, r: 5 }]))
    expect(out.items).toHaveLength(2)
  })
})

describe('[ID-0196] derivePartFeatures -- E. prev null/undefined / prev.kernelOps undefined', () => {
  it('prev omitted -> result has NO kernelOps key', () => {
    const out = derivePartFeatures(extrudeDesign())
    expect('kernelOps' in out).toBe(false)
  })

  it('prev=null -> result has NO kernelOps key', () => {
    const out = derivePartFeatures(extrudeDesign(), null)
    expect('kernelOps' in out).toBe(false)
  })

  it('prev defined but kernelOps undefined -> result has NO kernelOps key', () => {
    const prev: PartFeaturesFile = { version: 1, items: [] }
    const out = derivePartFeatures(extrudeDesign(), prev)
    expect('kernelOps' in out).toBe(false)
  })

  it('prev.kernelOps undefined -> items.length is exactly 2 (sk + solid)', () => {
    const prev: PartFeaturesFile = { version: 1, items: [] }
    const out = derivePartFeatures(extrudeDesign(), prev)
    expect(out.items).toHaveLength(2)
  })

  it('prev.kernelOps undefined -> result keys are exactly { version, items }', () => {
    const out = derivePartFeatures(extrudeDesign())
    expect(Object.keys(out).sort()).toEqual(['items', 'version'])
  })
})

describe('[ID-0196] derivePartFeatures -- F. prev.kernelOps empty array', () => {
  it('empty kernelOps array -> result.kernelOps preserved as empty array', () => {
    const prev: PartFeaturesFile = { version: 1, items: [], kernelOps: [] }
    const out = derivePartFeatures(extrudeDesign(), prev)
    expect(out.kernelOps).toEqual([])
  })

  it('empty kernelOps array -> NO follow-up item appended; items.length stays 2', () => {
    const prev: PartFeaturesFile = { version: 1, items: [], kernelOps: [] }
    const out = derivePartFeatures(extrudeDesign(), prev)
    expect(out.items).toHaveLength(2)
  })

  it('empty kernelOps preserved by REFERENCE (same array instance)', () => {
    const empty: KernelPostSolidOp[] = []
    const prev: PartFeaturesFile = { version: 1, items: [], kernelOps: empty }
    const out = derivePartFeatures(extrudeDesign(), prev)
    expect(out.kernelOps).toBe(empty)
  })
})

describe('[ID-0196] derivePartFeatures -- G. sheet_* last op appends Sheet row', () => {
  it('last sheet_tab_union -> appends { id:sm1, kind:sheet, label:"Sheet sheet_tab_union" }', () => {
    const prev: PartFeaturesFile = { version: 1, items: [], kernelOps: [tabUnionOp()] }
    const out = derivePartFeatures(extrudeDesign(), prev)
    expect(out.items[2]).toEqual({
      id: 'sm1',
      kind: 'sheet',
      label: 'Sheet sheet_tab_union'
    })
  })

  it('last sheet_fold -> label is "Sheet sheet_fold"', () => {
    const prev: PartFeaturesFile = {
      version: 1,
      items: [],
      kernelOps: [
        {
          kind: 'sheet_fold',
          bendLineYMm: 0,
          bendRadiusMm: 1,
          bendAngleDeg: 90,
          kFactor: 0.44,
          bendAllowanceMode: 'k_factor'
        }
      ]
    }
    const out = derivePartFeatures(extrudeDesign(), prev)
    expect(out.items[2]?.label).toBe('Sheet sheet_fold')
  })

  it('last sheet_flat_pattern -> label is "Sheet sheet_flat_pattern"', () => {
    const prev: PartFeaturesFile = {
      version: 1,
      items: [],
      kernelOps: [{ kind: 'sheet_flat_pattern', includeBendLines: true }]
    }
    const out = derivePartFeatures(extrudeDesign(), prev)
    expect(out.items[2]?.label).toBe('Sheet sheet_flat_pattern')
  })

  it('kernelOps length 3 with sheet last -> id is sm3', () => {
    const prev: PartFeaturesFile = {
      version: 1,
      items: [],
      kernelOps: [
        { kind: 'sheet_flat_pattern', includeBendLines: true },
        { kind: 'sheet_flat_pattern', includeBendLines: false },
        tabUnionOp()
      ]
    }
    const out = derivePartFeatures(extrudeDesign(), prev)
    expect(out.items[2]?.id).toBe('sm3')
  })

  it('kernelOps length 7 with sheet last -> id is sm7', () => {
    const fillerOps: KernelPostSolidOp[] = Array.from({ length: 6 }, () => ({
      kind: 'sheet_flat_pattern',
      includeBendLines: true
    }))
    const prev: PartFeaturesFile = {
      version: 1,
      items: [],
      kernelOps: [...fillerOps, tabUnionOp()]
    }
    const out = derivePartFeatures(extrudeDesign(), prev)
    expect(out.items[2]?.id).toBe('sm7')
  })

  it('sheet last -> kernelOps still preserved on output (full array)', () => {
    const ops: KernelPostSolidOp[] = [tabUnionOp()]
    const prev: PartFeaturesFile = { version: 1, items: [], kernelOps: ops }
    const out = derivePartFeatures(extrudeDesign(), prev)
    expect(out.kernelOps).toEqual(ops)
  })

  it('sheet last -> items.length === 3 (sk + ex + sm)', () => {
    const prev: PartFeaturesFile = { version: 1, items: [], kernelOps: [tabUnionOp()] }
    const out = derivePartFeatures(extrudeDesign(), prev)
    expect(out.items).toHaveLength(3)
  })

  it('only LAST kernelOp inspected: [boolean, sheet_*] still appends Sheet (penultimate ignored)', () => {
    const prev: PartFeaturesFile = {
      version: 1,
      items: [],
      kernelOps: [
        {
          kind: 'boolean_subtract_box',
          xMinMm: 0,
          xMaxMm: 1,
          yMinMm: 0,
          yMaxMm: 1,
          zMinMm: 0,
          zMaxMm: 1
        },
        tabUnionOp()
      ]
    }
    const out = derivePartFeatures(extrudeDesign(), prev)
    expect(out.items[2]?.kind).toBe('sheet')
    expect(out.items[2]?.id).toBe('sm2')
  })
})

describe('[ID-0196] derivePartFeatures -- H. plastic_* last op appends Plastic row', () => {
  it('last plastic_boss -> appends { id:pl1, kind:plastic, label:"Plastic plastic_boss" }', () => {
    const prev: PartFeaturesFile = { version: 1, items: [], kernelOps: [plasticBossOp()] }
    const out = derivePartFeatures(extrudeDesign(), prev)
    expect(out.items[2]).toEqual({
      id: 'pl1',
      kind: 'plastic',
      label: 'Plastic plastic_boss'
    })
  })

  it('last plastic_rule_fillet -> label is "Plastic plastic_rule_fillet"', () => {
    const prev: PartFeaturesFile = {
      version: 1,
      items: [],
      kernelOps: [{ kind: 'plastic_rule_fillet', radiusMm: 2 }]
    }
    const out = derivePartFeatures(extrudeDesign(), prev)
    expect(out.items[2]?.label).toBe('Plastic plastic_rule_fillet')
  })

  it('last plastic_lip_groove -> label is "Plastic plastic_lip_groove"', () => {
    const prev: PartFeaturesFile = {
      version: 1,
      items: [],
      kernelOps: [
        {
          kind: 'plastic_lip_groove',
          mode: 'lip',
          xMinMm: 0,
          xMaxMm: 5,
          yMinMm: 0,
          yMaxMm: 5,
          zBaseMm: 0,
          depthMm: 1
        }
      ]
    }
    const out = derivePartFeatures(extrudeDesign(), prev)
    expect(out.items[2]?.label).toBe('Plastic plastic_lip_groove')
  })

  it('plastic id format is pl<n> where n=kernelOps.length', () => {
    const ops: KernelPostSolidOp[] = [
      { kind: 'plastic_rule_fillet', radiusMm: 1 },
      { kind: 'plastic_rule_fillet', radiusMm: 2 },
      { kind: 'plastic_rule_fillet', radiusMm: 3 },
      plasticBossOp()
    ]
    const prev: PartFeaturesFile = { version: 1, items: [], kernelOps: ops }
    const out = derivePartFeatures(extrudeDesign(), prev)
    expect(out.items[2]?.id).toBe('pl4')
  })

  it('only LAST inspected: [sheet, plastic] -> Plastic appended (sheet penultimate ignored)', () => {
    const prev: PartFeaturesFile = {
      version: 1,
      items: [],
      kernelOps: [tabUnionOp(), plasticBossOp()]
    }
    const out = derivePartFeatures(extrudeDesign(), prev)
    expect(out.items[2]?.kind).toBe('plastic')
    expect(out.items[2]?.id).toBe('pl2')
  })
})

describe('[ID-0196] derivePartFeatures -- I. other prefix last ops do NOT append but DO preserve kernelOps', () => {
  it('last pattern_rectangular -> NO follow-up item, kernelOps still preserved', () => {
    const prev: PartFeaturesFile = {
      version: 1,
      items: [],
      kernelOps: [
        {
          kind: 'pattern_rectangular',
          countX: 2,
          countY: 2,
          spacingXMm: 5,
          spacingYMm: 5
        }
      ]
    }
    const out = derivePartFeatures(extrudeDesign(), prev)
    expect(out.items).toHaveLength(2)
    expect(out.kernelOps).toEqual(prev.kernelOps)
  })

  it('last boolean_subtract_box -> NO follow-up; items length stays 2', () => {
    const prev: PartFeaturesFile = {
      version: 1,
      items: [],
      kernelOps: [
        {
          kind: 'boolean_subtract_box',
          xMinMm: 0,
          xMaxMm: 1,
          yMinMm: 0,
          yMaxMm: 1,
          zMinMm: 0,
          zMaxMm: 1
        }
      ]
    }
    const out = derivePartFeatures(extrudeDesign(), prev)
    expect(out.items).toHaveLength(2)
  })

  it('last mirror_union_plane -> NO follow-up appended', () => {
    const prev: PartFeaturesFile = {
      version: 1,
      items: [],
      kernelOps: [
        { kind: 'mirror_union_plane', plane: 'XZ', originXMm: 0, originYMm: 0, originZMm: 0 }
      ]
    }
    const out = derivePartFeatures(extrudeDesign(), prev)
    expect(out.items).toHaveLength(2)
  })

  it('last transform_translate -> NO follow-up appended', () => {
    const prev: PartFeaturesFile = {
      version: 1,
      items: [],
      kernelOps: [
        { kind: 'transform_translate', dxMm: 1, dyMm: 0, dzMm: 0, keepOriginal: false }
      ]
    }
    const out = derivePartFeatures(extrudeDesign(), prev)
    expect(out.items).toHaveLength(2)
  })

  it('last fillet_all -> NO follow-up appended (kind starts with "fillet_", NOT "sheet_"/"plastic_")', () => {
    const prev: PartFeaturesFile = {
      version: 1,
      items: [],
      kernelOps: [{ kind: 'fillet_all', radiusMm: 1 }]
    }
    const out = derivePartFeatures(extrudeDesign(), prev)
    expect(out.items).toHaveLength(2)
  })

  it('last thread_wizard -> NO follow-up appended', () => {
    const prev: PartFeaturesFile = {
      version: 1,
      items: [],
      kernelOps: [
        {
          kind: 'thread_wizard',
          centerXMm: 0,
          centerYMm: 0,
          majorRadiusMm: 3,
          pitchMm: 1,
          lengthMm: 5,
          depthMm: 0.5,
          zStartMm: 0,
          hand: 'right',
          mode: 'cosmetic',
          standard: 'ISO',
          designation: 'M',
          class: '6g',
          starts: 1
        }
      ]
    }
    const out = derivePartFeatures(extrudeDesign(), prev)
    expect(out.items).toHaveLength(2)
  })

  it('non-sheet/plastic last -> kernelOps still set on output (NOT dropped)', () => {
    const prev: PartFeaturesFile = {
      version: 1,
      items: [],
      kernelOps: [{ kind: 'fillet_all', radiusMm: 1 }]
    }
    const out = derivePartFeatures(extrudeDesign(), prev)
    expect(out.kernelOps).toBeDefined()
    expect(out.kernelOps).toHaveLength(1)
  })

  it('non-sheet/plastic last -> result keys are exactly { version, items, kernelOps }', () => {
    const prev: PartFeaturesFile = {
      version: 1,
      items: [],
      kernelOps: [{ kind: 'fillet_all', radiusMm: 1 }]
    }
    const out = derivePartFeatures(extrudeDesign(), prev)
    expect(Object.keys(out).sort()).toEqual(['items', 'kernelOps', 'version'])
  })
})

describe('[ID-0196] derivePartFeatures -- J. kernelOps reference identity + non-mutation', () => {
  it('result.kernelOps === prev.kernelOps (same array reference, no copy)', () => {
    const ops: KernelPostSolidOp[] = [tabUnionOp()]
    const prev: PartFeaturesFile = { version: 1, items: [], kernelOps: ops }
    const out = derivePartFeatures(extrudeDesign(), prev)
    expect(out.kernelOps).toBe(ops)
  })

  it('does NOT mutate prev.items', () => {
    const prevItems: PartFeaturesFile['items'] = [
      { id: 'pre1', kind: 'sketch', label: 'PreSketch' }
    ]
    const prev: PartFeaturesFile = { version: 1, items: prevItems, kernelOps: [tabUnionOp()] }
    const before = JSON.stringify(prevItems)
    derivePartFeatures(extrudeDesign(), prev)
    expect(JSON.stringify(prevItems)).toBe(before)
  })

  it('does NOT mutate prev.kernelOps array length', () => {
    const ops: KernelPostSolidOp[] = [tabUnionOp(), plasticBossOp()]
    const prev: PartFeaturesFile = { version: 1, items: [], kernelOps: ops }
    derivePartFeatures(extrudeDesign(), prev)
    expect(ops).toHaveLength(2)
  })
})

describe('[ID-0196] derivePartFeatures -- K. result shape sanity + schema validation', () => {
  it('result.version is literal 1', () => {
    const out = derivePartFeatures(extrudeDesign())
    expect(out.version).toBe(1)
  })

  it('result.items is an Array', () => {
    const out = derivePartFeatures(extrudeDesign())
    expect(Array.isArray(out.items)).toBe(true)
  })

  it('extrude branch passes partFeaturesFileSchema.parse', () => {
    const out = derivePartFeatures(extrudeDesign())
    const parsed = partFeaturesFileSchema.parse(out)
    expect(parsed.version).toBe(1)
  })

  it('revolve branch passes partFeaturesFileSchema.parse', () => {
    const out = derivePartFeatures(revolveDesign(180, 5))
    const parsed = partFeaturesFileSchema.parse(out)
    expect(parsed.items[1]?.kind).toBe('revolve')
  })

  it('loft branch with profileCount NUMBER passes partFeaturesFileSchema.parse', () => {
    // ASSUMPTION: when there are no profiles, derivePartFeatures emits
    // `params.profileCount = undefined`, which the params record schema
    // (z.record(z.string(), jsonSafeValueSchema)) rejects. JSON.stringify
    // would drop the key on disk; this in-memory shape is therefore only
    // schema-valid when at least one profile exists. Pinned via a
    // non-empty loft to lock the well-typed branch.
    const out = derivePartFeatures(loftDesign(20, [{ cx: 0, cy: 0, r: 5 }]))
    const parsed = partFeaturesFileSchema.parse(out)
    expect(parsed.items[1]?.kind).toBe('loft')
    expect(parsed.items[1]?.params?.profileCount).toBe(1)
  })

  it('sheet follow-up branch passes partFeaturesFileSchema.parse', () => {
    const prev: PartFeaturesFile = { version: 1, items: [], kernelOps: [tabUnionOp()] }
    const out = derivePartFeatures(extrudeDesign(), prev)
    const parsed = partFeaturesFileSchema.parse(out)
    expect(parsed.items).toHaveLength(3)
    expect(parsed.items[2]?.kind).toBe('sheet')
  })

  it('plastic follow-up branch passes partFeaturesFileSchema.parse', () => {
    const prev: PartFeaturesFile = { version: 1, items: [], kernelOps: [plasticBossOp()] }
    const out = derivePartFeatures(extrudeDesign(), prev)
    const parsed = partFeaturesFileSchema.parse(out)
    expect(parsed.items[2]?.kind).toBe('plastic')
  })
})

describe('[ID-0196] derivePartFeatures -- L. solid-branch x kernelOps interactions', () => {
  it('loft + sheet last -> items=[sk1, lf1, sm1]; loft params intact', () => {
    const prev: PartFeaturesFile = { version: 1, items: [], kernelOps: [tabUnionOp()] }
    const out = derivePartFeatures(loftDesign(15, [{ cx: 0, cy: 0, r: 5 }]), prev)
    expect(out.items.map((i) => i.id)).toEqual(['sk1', 'lf1', 'sm1'])
    expect(out.items[1]?.params).toEqual({ separationMm: 15, profileCount: 1 })
  })

  it('loft + plastic last -> items=[sk1, lf1, pl1]', () => {
    const prev: PartFeaturesFile = { version: 1, items: [], kernelOps: [plasticBossOp()] }
    const out = derivePartFeatures(loftDesign(15), prev)
    expect(out.items.map((i) => i.id)).toEqual(['sk1', 'lf1', 'pl1'])
  })

  it('loft + pattern last -> items=[sk1, lf1] only (pattern not in sheet/plastic prefix set)', () => {
    const prev: PartFeaturesFile = {
      version: 1,
      items: [],
      kernelOps: [
        {
          kind: 'pattern_rectangular',
          countX: 2,
          countY: 2,
          spacingXMm: 5,
          spacingYMm: 5
        }
      ]
    }
    const out = derivePartFeatures(loftDesign(15), prev)
    expect(out.items.map((i) => i.id)).toEqual(['sk1', 'lf1'])
  })

  it('revolve + sheet last -> items=[sk1, rv1, sm1]; revolve params intact', () => {
    const prev: PartFeaturesFile = { version: 1, items: [], kernelOps: [tabUnionOp()] }
    const out = derivePartFeatures(revolveDesign(120, 3), prev)
    expect(out.items.map((i) => i.id)).toEqual(['sk1', 'rv1', 'sm1'])
    expect(out.items[1]?.params).toEqual({ angleDeg: 120, axisX: 3 })
  })

  it('revolve + plastic last -> items=[sk1, rv1, pl1]', () => {
    const prev: PartFeaturesFile = { version: 1, items: [], kernelOps: [plasticBossOp()] }
    const out = derivePartFeatures(revolveDesign(), prev)
    expect(out.items.map((i) => i.id)).toEqual(['sk1', 'rv1', 'pl1'])
  })
})
