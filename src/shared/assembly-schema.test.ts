import { describe, expect, it } from 'vitest'
import {
  ASSEMBLY_BOM_CSV_HEADER,
  activeAssemblyParentGraphHasCycle,
  assemblyFileSchema,
  buildAssemblyBomCsvLines,
  buildAssemblySummaryReport,
  buildBomHierarchy,
  buildBomHierarchyJsonText,
  buildHierarchicalBomText,
  countActiveParentSelfRefs,
  countActiveSameTransformPairs,
  emptyAssembly,
  meshPathLintIssues,
  parseAssemblyFile,
  rollActiveAssemblyStats
} from './assembly-schema'

describe('parseAssemblyFile', () => {
  it('trims component id, name, and partPath', () => {
    const a = parseAssemblyFile({
      version: 2,
      name: 'A',
      components: [
        {
          id: '  c1  ',
          name: '  Foot  ',
          partPath: '  design/sketch.json  ',
          transform: {},
          grounded: true
        }
      ]
    })
    expect(a.components[0]).toMatchObject({
      id: 'c1',
      name: 'Foot',
      partPath: 'design/sketch.json'
    })
  })

  it('rejects empty component id, name, or partPath', () => {
    expect(() =>
      parseAssemblyFile({
        version: 2,
        name: 'A',
        components: [{ id: '', name: 'N', partPath: 'p', transform: {} }]
      })
    ).toThrow()
    expect(() =>
      parseAssemblyFile({
        version: 2,
        name: 'A',
        components: [{ id: 'i', name: '  ', partPath: 'p', transform: {} }]
      })
    ).toThrow()
  })

  it('uses default Assembly name when root name is blank or whitespace', () => {
    expect(parseAssemblyFile({ version: 2, name: '', components: [] }).name).toBe('Assembly')
    expect(parseAssemblyFile({ version: 2, name: '   ', components: [] }).name).toBe('Assembly')
  })

  it('trims root assembly name', () => {
    expect(parseAssemblyFile({ version: 2, name: '  LegAssy  ', components: [] }).name).toBe('LegAssy')
  })

  it('migrates v1 to v2', () => {
    const a = parseAssemblyFile({
      version: 1,
      name: 'LegAssy',
      components: [
        {
          id: 'c1',
          name: 'Foot',
          partPath: 'design/sketch.json',
          transform: {},
          grounded: true,
          joint: 'revolute'
        }
      ]
    })
    expect(a.version).toBe(2)
    expect(a.components[0]!.joint).toBe('revolute')
    expect(a.components[0]!.suppressed).toBe(false)
    expect(a.components[0]!.bomQuantity).toBe(1)
    expect(a.components[0]!.motionIsolated).toBe(false)
    expect(a.components[0]!.partNumber).toBeUndefined()
  })

  it('defaults missing version to v2 output', () => {
    const a = parseAssemblyFile({
      name: 'X',
      components: []
    })
    expect(a.version).toBe(2)
    expect(a.name).toBe('X')
  })

  it('accepts planar joint and reference fields', () => {
    const a = parseAssemblyFile({
      version: 2,
      name: 'A',
      components: [
        {
          id: 'a',
          name: 'Plate',
          partPath: 'parts/p1/design/sketch.json',
          transform: { x: 1, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 },
          grounded: false,
          parentId: 'root',
          joint: 'planar',
          referenceTag: 'DWG-12',
          suppressed: true
        }
      ]
    })
    expect(assemblyFileSchema.parse(a).components[0]!.referenceTag).toBe('DWG-12')
    expect(assemblyFileSchema.parse(a).components[0]!.bomQuantity).toBe(1)
  })

  it('defaults bomQuantity when omitted (legacy files)', () => {
    const a = parseAssemblyFile({
      version: 2,
      name: 'Legacy',
      components: [
        {
          id: 'only',
          name: 'Sole',
          partPath: 'design/sketch.json',
          transform: {},
          grounded: true
        }
      ]
    })
    expect(a.components[0]!.bomQuantity).toBe(1)
  })

  it('defaults motionIsolated when omitted (legacy rows)', () => {
    const a = parseAssemblyFile({
      version: 2,
      name: 'Iso',
      components: [
        {
          id: 'x',
          name: 'X',
          partPath: 'design/sketch.json',
          transform: {},
          grounded: true
        }
      ]
    })
    expect(a.components[0]!.motionIsolated).toBe(false)
  })

  it('accepts optional meshPath for STL interference', () => {
    const a = parseAssemblyFile({
      version: 2,
      name: 'Meshy',
      components: [
        {
          id: 'm',
          name: 'Body',
          partPath: 'design/sketch.json',
          transform: {},
          grounded: true,
          meshPath: 'output/part.stl'
        }
      ]
    })
    expect(a.components[0]!.meshPath).toBe('output/part.stl')
    expect(assemblyFileSchema.parse(a).components[0]!.meshPath).toBe('output/part.stl')
  })

  it('accepts ball joint, partNumber, and motionIsolated', () => {
    const a = parseAssemblyFile({
      version: 2,
      name: 'Socket',
      components: [
        {
          id: 's',
          name: 'BallStud',
          partPath: 'parts/stud/sketch.json',
          transform: {},
          grounded: false,
          parentId: 'housing',
          joint: 'ball',
          partNumber: 'PN-9001',
          bomQuantity: 2,
          motionIsolated: true
        }
      ]
    })
    expect(a.components[0]!.joint).toBe('ball')
    expect(a.components[0]!.partNumber).toBe('PN-9001')
    expect(a.components[0]!.motionIsolated).toBe(true)
    expect(assemblyFileSchema.parse(a).components[0]!.joint).toBe('ball')
  })

  it('accepts externalComponentRef and bomNotes', () => {
    const a = parseAssemblyFile({
      version: 2,
      name: 'Refs',
      components: [
        {
          id: 'e',
          name: 'ERP',
          partPath: 'design/sketch.json',
          transform: {},
          grounded: true,
          externalComponentRef: 'PDM-88',
          bomNotes: 'Paint before install'
        }
      ]
    })
    expect(a.components[0]!.externalComponentRef).toBe('PDM-88')
    expect(a.components[0]!.bomNotes).toBe('Paint before install')
    expect(assemblyFileSchema.parse(a).components[0]!.bomNotes).toBe('Paint before install')
  })

  it('accepts cylindrical joint and explicit bomQuantity', () => {
    const a = parseAssemblyFile({
      version: 2,
      name: 'Cyl',
      components: [
        {
          id: 'pin',
          name: 'Pin',
          partPath: 'parts/pin/design/sketch.json',
          transform: {},
          grounded: false,
          parentId: 'base',
          joint: 'cylindrical',
          bomQuantity: 4
        }
      ]
    })
    expect(a.components[0]!.joint).toBe('cylindrical')
    expect(a.components[0]!.bomQuantity).toBe(4)
    expect(assemblyFileSchema.parse(a).components[0]!.bomQuantity).toBe(4)
  })

  it('accepts universal (Cardan) joint', () => {
    const a = parseAssemblyFile({
      version: 2,
      name: 'U',
      components: [
        {
          id: 'shaft',
          name: 'Shaft',
          partPath: 'parts/shaft/design/sketch.json',
          transform: {},
          grounded: false,
          parentId: 'engine',
          joint: 'universal'
        }
      ]
    })
    expect(a.components[0]!.joint).toBe('universal')
    expect(assemblyFileSchema.parse(a).components[0]!.joint).toBe('universal')
  })

  it('accepts planar joint with optional planar preview mm fields', () => {
    const a = parseAssemblyFile({
      version: 2,
      name: 'Pl',
      components: [
        {
          id: 'table',
          name: 'Table',
          partPath: 'parts/t/design/sketch.json',
          transform: {},
          grounded: true,
          joint: 'planar',
          planarPreviewNormalAxis: 'z',
          planarPreviewUMm: 3,
          planarPreviewVMaxMm: 100
        }
      ]
    })
    expect(a.components[0]!.joint).toBe('planar')
    expect(a.components[0]!.planarPreviewUMm).toBe(3)
    const parsed = assemblyFileSchema.parse(a)
    expect(parsed.components[0]!.planarPreviewVMaxMm).toBe(100)
  })

  it('accepts ball joint with optional preview euler fields', () => {
    const a = parseAssemblyFile({
      version: 2,
      name: 'Ball',
      components: [
        {
          id: 'socket',
          name: 'Socket',
          partPath: 'parts/s/design/sketch.json',
          transform: {},
          grounded: true,
          joint: 'ball',
          ballPreviewRxDeg: 12,
          ballPreviewRyMinDeg: -45,
          ballPreviewRyMaxDeg: 45
        }
      ]
    })
    expect(a.components[0]!.joint).toBe('ball')
    expect(a.components[0]!.ballPreviewRxDeg).toBe(12)
    const parsed = assemblyFileSchema.parse(a)
    expect(parsed.components[0]!.ballPreviewRyMinDeg).toBe(-45)
    expect(parsed.components[0]!.ballPreviewRyMaxDeg).toBe(45)
  })

  it('migrates legacy preview state/limits into jointState/jointLimits', () => {
    const a = parseAssemblyFile({
      version: 2,
      name: 'LegacyKinematics',
      components: [
        {
          id: 'r',
          name: 'R',
          partPath: 'r.json',
          transform: {},
          joint: 'revolute',
          revolutePreviewAngleDeg: 33,
          revolutePreviewMinDeg: -10,
          revolutePreviewMaxDeg: 40
        },
        {
          id: 'p',
          name: 'P',
          partPath: 'p.json',
          transform: {},
          joint: 'planar',
          planarPreviewUMm: 2,
          planarPreviewVMm: -3,
          planarPreviewUMinMm: -4,
          planarPreviewUMaxMm: 5,
          planarPreviewVMinMm: -6,
          planarPreviewVMaxMm: 7
        }
      ]
    })
    expect(a.components[0]!.jointState).toEqual({ scalarDeg: 33 })
    expect(a.components[0]!.jointLimits).toEqual({ scalarMinDeg: -10, scalarMaxDeg: 40 })
    expect(a.components[1]!.jointState).toEqual({ uMm: 2, vMm: -3 })
    expect(a.components[1]!.jointLimits).toEqual({
      uMinMm: -4,
      uMaxMm: 5,
      vMinMm: -6,
      vMaxMm: 7
    })
  })

  it('preserves explicit jointState/jointLimits when provided', () => {
    const a = parseAssemblyFile({
      version: 2,
      name: 'ExplicitKinematics',
      components: [
        {
          id: 's',
          name: 'S',
          partPath: 's.json',
          transform: {},
          joint: 'slider',
          sliderPreviewMm: 12,
          sliderPreviewMinMm: -100,
          sliderPreviewMaxMm: 100,
          jointState: { scalarMm: 7 },
          jointLimits: { scalarMinMm: -3, scalarMaxMm: 9 }
        }
      ]
    })
    expect(a.components[0]!.jointState).toEqual({ scalarMm: 7 })
    expect(a.components[0]!.jointLimits).toEqual({ scalarMinMm: -3, scalarMaxMm: 9 })
  })

  it('accepts motion link stub fields (linkedInstanceId + motionLinkKind)', () => {
    const a = parseAssemblyFile({
      version: 2,
      name: 'Links',
      components: [
        {
          id: 'base',
          name: 'Base',
          partPath: 'design/base.json',
          transform: {},
          grounded: true
        },
        {
          id: 'lid',
          name: 'Lid',
          partPath: 'design/lid.json',
          transform: {},
          parentId: 'base',
          linkedInstanceId: 'base',
          motionLinkKind: 'mate'
        }
      ]
    })
    expect(a.components[1]!.linkedInstanceId).toBe('base')
    expect(a.components[1]!.motionLinkKind).toBe('mate')
    expect(assemblyFileSchema.parse(a).components[1]!.motionLinkKind).toBe('mate')
  })

  it('accepts explodeView and motionStudy metadata and round-trips through assemblyFileSchema', () => {
    const raw = {
      version: 2,
      name: 'Meta',
      components: [],
      explodeView: { axis: 'x' as const, stepMm: 5, notes: 'Drawing A1' },
      motionStudy: {
        name: 'Lift',
        dofHint: 'planar2d' as const,
        keyframesJson: '[{"t":0}]',
        notes: 'stub'
      }
    }
    const a = parseAssemblyFile(raw)
    expect(a.explodeView?.axis).toBe('x')
    expect(a.explodeView?.stepMm).toBe(5)
    expect(a.motionStudy?.dofHint).toBe('planar2d')
    const again = assemblyFileSchema.parse(a)
    expect(again.explodeView?.notes).toBe('Drawing A1')
    expect(again.motionStudy?.keyframesJson).toBe('[{"t":0}]')
    const s = buildAssemblySummaryReport(a)
    expect(s.hasExplodeViewMetadata).toBe(true)
    expect(s.hasMotionStudyStub).toBe(true)
  })
})

describe('parent graph helpers', () => {
  it('counts self-parent and treats it as a cycle', () => {
    const asm = parseAssemblyFile({
      version: 2,
      name: 'S',
      components: [
        { id: 'a', name: 'A', partPath: 'a.json', transform: {}, parentId: 'a' },
        { id: 'b', name: 'B', partPath: 'b.json', transform: {} }
      ]
    })
    const active = asm.components.filter((c) => !c.suppressed)
    expect(countActiveParentSelfRefs(active)).toBe(1)
    expect(activeAssemblyParentGraphHasCycle(active)).toBe(true)
    const s = buildAssemblySummaryReport(asm)
    expect(s.activeParentSelfRefCount).toBe(1)
    expect(s.activeParentGraphHasCycle).toBe(true)
  })

  it('detects two-node parent cycle among active', () => {
    const asm = parseAssemblyFile({
      version: 2,
      name: 'C',
      components: [
        { id: 'x', name: 'X', partPath: 'x.json', transform: {}, parentId: 'y' },
        { id: 'y', name: 'Y', partPath: 'y.json', transform: {}, parentId: 'x' }
      ]
    })
    const active = asm.components.filter((c) => !c.suppressed)
    expect(countActiveParentSelfRefs(active)).toBe(0)
    expect(activeAssemblyParentGraphHasCycle(active)).toBe(true)
  })

  it('has no cycle for a simple parent chain', () => {
    const asm = parseAssemblyFile({
      version: 2,
      name: 'T',
      components: [
        { id: 'p', name: 'P', partPath: 'p.json', transform: {} },
        { id: 'c', name: 'C', partPath: 'c.json', transform: {}, parentId: 'p' }
      ]
    })
    const active = asm.components.filter((c) => !c.suppressed)
    expect(activeAssemblyParentGraphHasCycle(active)).toBe(false)
    expect(countActiveParentSelfRefs(active)).toBe(0)
  })
})

describe('buildBomHierarchyJsonText', () => {
  it('serializes assemblyName, generatedAt, and tree', () => {
    const at = '2020-01-01T00:00:00.000Z'
    const asm = parseAssemblyFile({
      version: 2,
      name: 'J',
      components: [{ id: 'r', name: 'R', partPath: 'r.json', transform: {} }]
    })
    const o = JSON.parse(buildBomHierarchyJsonText(asm, at)) as {
      assemblyName: string
      generatedAt: string
      tree: unknown[]
    }
    expect(o.assemblyName).toBe('J')
    expect(o.generatedAt).toBe(at)
    expect(o.tree).toHaveLength(1)
  })
})

describe('buildAssemblyBomCsvLines', () => {
  it('includes motion link stub columns after motionIsolated', () => {
    expect(ASSEMBLY_BOM_CSV_HEADER).toContain('bomUnit')
    expect(ASSEMBLY_BOM_CSV_HEADER).toContain('bomVendor')
    expect(ASSEMBLY_BOM_CSV_HEADER).toContain('bomCostEach')
    expect(ASSEMBLY_BOM_CSV_HEADER).toContain('linkedInstanceId')
    expect(ASSEMBLY_BOM_CSV_HEADER).toContain('motionLinkKind')
    const asm = parseAssemblyFile({
      version: 2,
      name: 'Csv',
      components: [
        {
          id: 'x',
          name: 'X',
          partPath: 'p.json',
          transform: {},
          grounded: true,
          linkedInstanceId: 'y',
          motionLinkKind: 'mate'
        }
      ]
    })
    const lines = buildAssemblyBomCsvLines(asm)
    expect(lines[0]).toBe(ASSEMBLY_BOM_CSV_HEADER)
    expect(lines[1]).toContain('y')
    expect(lines[1]).toContain('mate')
  })

  it('escapes quotes/commas and normalizes CRLF to LF for reliable CSV preview/export', () => {
    const asm = parseAssemblyFile({
      version: 2,
      name: 'Csv',
      components: [
        {
          id: 'c1',
          name: 'Plate, "Top"',
          partPath: 'design/top.json',
          transform: {},
          grounded: false,
          meshPath: 'output\\top.stl',
          referenceTag: 'DWG,01',
          partNumber: 'PN-"A"',
          externalComponentRef: 'ERP,42',
          bomNotes: 'line1\r\nline2, "quoted"',
          bomQuantity: 3,
          bomUnit: 'ea',
          bomVendor: 'Acme, Inc.',
          bomCostEach: '12.50',
          suppressed: true,
          motionIsolated: true
        }
      ]
    })
    const lines = buildAssemblyBomCsvLines(asm)
    expect(lines[1]).toBe(
      '"Plate, ""Top""","design/top.json","output\\top.stl","false","","","DWG,01","PN-""A""","ERP,42","line1\nline2, ""quoted""","3","ea","Acme, Inc.","12.50","true","true","","","c1"'
    )
  })
})

describe('emptyAssembly', () => {
  it('is v2', () => {
    expect(emptyAssembly().version).toBe(2)
  })
})

describe('buildAssemblySummaryReport', () => {
  it('zeros external ref and BOM-note roll-ups when absent', () => {
    const s = buildAssemblySummaryReport(emptyAssembly())
    expect(s.externalComponentRefCounts).toEqual({})
    expect(s.distinctActiveExternalRefs).toEqual([])
    expect(s.activeWithBomNotesCount).toBe(0)
    expect(s.activeParentSelfRefCount).toBe(0)
    expect(s.activeParentGraphHasCycle).toBe(false)
    expect(s.activePartPathsWithMultipleRows).toBe(0)
    expect(s.activePartNumbersWithMultipleRows).toBe(0)
    expect(s.multipleActiveGrounded).toBe(false)
    expect(s.activeWithLinkedInstanceCount).toBe(0)
    expect(s.invalidLinkedInstanceRefActiveCount).toBe(0)
    expect(s.activeMotionLinkStubCount).toBe(0)
    expect(s.activeMotionLinkIncompleteCount).toBe(0)
    expect(s.motionLinkKindCounts).toEqual({})
  })

  it('rolls up BOM by part path, tree shape, and flags invalid parent ids', () => {
    const asm = parseAssemblyFile({
      version: 2,
      name: 'Demo',
      components: [
        {
          id: 'a',
          name: 'Base',
          partPath: 'design/sketch.json',
          transform: { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 },
          grounded: true,
          bomQuantity: 1,
          partNumber: ' PN-1 ',
          referenceTag: 'DWG-1',
          externalComponentRef: 'ACME-1'
        },
        {
          id: 'b',
          name: 'Dup',
          partPath: 'design/sketch.json',
          transform: { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 },
          parentId: 'a',
          joint: 'rigid',
          bomQuantity: 2,
          partNumber: 'PN-1',
          referenceTag: 'DWG-1',
          externalComponentRef: 'ACME-1'
        },
        {
          id: 'c',
          name: 'Orphan',
          partPath: 'parts/x/sketch.json',
          transform: { x: 5, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 },
          parentId: 'missing',
          bomQuantity: 1,
          externalComponentRef: 'ACME-2',
          bomNotes: 'Include washer'
        },
        {
          id: 'd',
          name: 'Off',
          partPath: 'parts/y/sketch.json',
          transform: {},
          suppressed: true
        }
      ]
    })
    const s = buildAssemblySummaryReport(asm)
    expect(s.componentCount).toBe(4)
    expect(s.activeComponentCount).toBe(3)
    expect(s.suppressedCount).toBe(1)
    expect(s.bomQuantityByPartPath['design/sketch.json']).toBe(3)
    expect(s.bomQuantityByPartPath['parts/x/sketch.json']).toBe(1)
    expect(s.groundedActiveCount).toBe(1)
    expect(s.rootActiveCount).toBe(1)
    expect(s.childActiveCount).toBe(2)
    expect(s.invalidParentRefActiveCount).toBe(1)
    expect(s.sameTransformActivePairCount).toBe(1)
    expect(s.referenceTagCounts['DWG-1']).toBe(2)
    expect(s.externalComponentRefCounts['ACME-1']).toBe(2)
    expect(s.externalComponentRefCounts['ACME-2']).toBe(1)
    expect(s.distinctActiveExternalRefs).toEqual(['ACME-1', 'ACME-2'])
    expect(s.activeWithBomNotesCount).toBe(1)
    expect(s.distinctActivePartNumbers).toEqual(['PN-1'])
    expect(s.uniquePartPaths).toEqual(
      expect.arrayContaining(['design/sketch.json', 'parts/x/sketch.json', 'parts/y/sketch.json'])
    )
    expect(s.uniquePartPaths.length).toBe(3)
    expect(s.activeWithMeshPathCount).toBe(0)
    expect(s.hasExplodeViewMetadata).toBe(false)
    expect(s.hasMotionStudyStub).toBe(false)
    expect(s.activeParentSelfRefCount).toBe(0)
    expect(s.activeParentGraphHasCycle).toBe(false)
    expect(s.activePartPathsWithMultipleRows).toBe(1)
    expect(s.activePartNumbersWithMultipleRows).toBe(1)
    expect(s.multipleActiveGrounded).toBe(false)
  })

  it('flags multiple grounded active rows', () => {
    const asm = parseAssemblyFile({
      version: 2,
      name: 'G',
      components: [
        { id: 'a', name: 'A', partPath: 'a.json', transform: {}, grounded: true },
        { id: 'b', name: 'B', partPath: 'b.json', transform: {}, grounded: true }
      ]
    })
    const s = buildAssemblySummaryReport(asm)
    expect(s.groundedActiveCount).toBe(2)
    expect(s.multipleActiveGrounded).toBe(true)
    expect(s.activePartPathsWithMultipleRows).toBe(0)
    expect(s.activePartNumbersWithMultipleRows).toBe(0)
  })

  it('counts active rows with meshPath in summary', () => {
    const asm = parseAssemblyFile({
      version: 2,
      name: 'Mesh',
      components: [
        {
          id: 'a',
          name: 'A',
          partPath: 'a.json',
          transform: {},
          meshPath: 'out/a.stl'
        },
        {
          id: 'b',
          name: 'B',
          partPath: 'b.json',
          transform: {},
          suppressed: true,
          meshPath: 'out/b.stl'
        },
        {
          id: 'c',
          name: 'C',
          partPath: 'c.json',
          transform: {}
        }
      ]
    })
    expect(buildAssemblySummaryReport(asm).activeWithMeshPathCount).toBe(1)
  })

  it('rolls up motion link stubs, invalid peer refs, and incomplete rows', () => {
    const asm = parseAssemblyFile({
      version: 2,
      name: 'ML',
      components: [
        {
          id: 'a',
          name: 'A',
          partPath: 'a.json',
          transform: {},
          grounded: true,
          linkedInstanceId: 'b',
          motionLinkKind: 'contact'
        },
        {
          id: 'b',
          name: 'B',
          partPath: 'b.json',
          transform: {},
          motionLinkKind: 'align'
        },
        {
          id: 'c',
          name: 'C',
          partPath: 'c.json',
          transform: {},
          linkedInstanceId: 'ghost',
          motionLinkKind: 'mate'
        },
        {
          id: 'd',
          name: 'D',
          partPath: 'd.json',
          transform: {},
          suppressed: true,
          linkedInstanceId: 'a',
          motionLinkKind: 'mate'
        },
        {
          id: 'e',
          name: 'E',
          partPath: 'e.json',
          transform: {},
          linkedInstanceId: 'd',
          motionLinkKind: 'mate'
        }
      ]
    })
    const s = buildAssemblySummaryReport(asm)
    expect(s.activeWithLinkedInstanceCount).toBe(3)
    expect(s.invalidLinkedInstanceRefActiveCount).toBe(2)
    expect(s.activeMotionLinkIncompleteCount).toBe(1)
    expect(s.activeMotionLinkStubCount).toBe(1)
    expect(s.motionLinkKindCounts.contact).toBe(1)
    expect(s.motionLinkKindCounts.align).toBe(1)
    expect(s.motionLinkKindCounts.mate).toBe(2)
  })

  it('counts no same-transform pairs when placements differ', () => {
    const asm = parseAssemblyFile({
      version: 2,
      name: 'Spread',
      components: [
        {
          id: 'p',
          name: 'P',
          partPath: 'design/sketch.json',
          transform: { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 },
          grounded: true
        },
        {
          id: 'q',
          name: 'Q',
          partPath: 'design/sketch.json',
          transform: { x: 1, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 },
          grounded: false
        }
      ]
    })
    expect(countActiveSameTransformPairs(asm.components.filter((c) => !c.suppressed))).toBe(0)
    expect(buildAssemblySummaryReport(asm).sameTransformActivePairCount).toBe(0)
  })
})

describe('meshPathLintIssues', () => {
  it('returns no issues for empty paths', () => {
    expect(meshPathLintIssues(undefined)).toEqual([])
    expect(meshPathLintIssues('')).toEqual([])
    expect(meshPathLintIssues('   ')).toEqual([])
  })

  it('flags absolute and non-stl patterns', () => {
    expect(meshPathLintIssues('/abs/part.stl').length).toBeGreaterThan(0)
    expect(meshPathLintIssues('C:\\x\\y.stl').some((m) => m.includes('drive'))).toBe(true)
    expect(meshPathLintIssues('out/mesh.obj').some((m) => m.includes('.stl'))).toBe(true)
    expect(meshPathLintIssues('output/ok.stl')).toEqual([])
  })

  it('flags backslashes, doubled separators, control chars, length, and untrimmed paths', () => {
    expect(meshPathLintIssues('output\\\\part.stl').some((m) => m.includes('doubled'))).toBe(true)
    expect(meshPathLintIssues('output\\part.stl').some((m) => m.includes('forward slashes'))).toBe(true)
    expect(meshPathLintIssues('out//x.stl').some((m) => m.includes('doubled'))).toBe(true)
    expect(meshPathLintIssues('out/x\n.stl').some((m) => m.includes('control'))).toBe(true)
    expect(meshPathLintIssues(`out/${'p'.repeat(520)}.stl`).some((m) => m.includes('very long'))).toBe(true)
    expect(meshPathLintIssues('  out/x.stl  ').some((m) => m.includes('Trim'))).toBe(true)
  })
})

describe('rollActiveAssemblyStats', () => {
  it('tallies joints and motion-isolated among active only', () => {
    const asm = parseAssemblyFile({
      version: 2,
      name: 'T',
      components: [
        {
          id: '1',
          name: 'A',
          partPath: 'a.json',
          transform: {},
          joint: 'ball',
          motionIsolated: true,
          bomQuantity: 2
        },
        {
          id: '2',
          name: 'B',
          partPath: 'b.json',
          transform: {},
          suppressed: true,
          joint: 'rigid',
          bomQuantity: 99
        }
      ]
    })
    const active = asm.components.filter((c) => !c.suppressed)
    const st = rollActiveAssemblyStats(active)
    expect(st.totalBomQuantity).toBe(2)
    expect(st.motionIsolatedCount).toBe(1)
    expect(st.jointCounts.ball).toBe(1)
    expect(st.jointCounts.rigid).toBeUndefined()
  })
})

describe('buildBomHierarchy', () => {
  it('nests active children under parent (suppressed excluded)', () => {
    const asm = parseAssemblyFile({
      version: 2,
      name: 'A',
      components: [
        {
          id: 'p',
          name: 'Plate',
          partPath: 'p.json',
          transform: {},
          bomQuantity: 1,
          suppressed: false
        },
        {
          id: 'b',
          name: 'Bolt',
          partPath: 'b.json',
          transform: {},
          parentId: 'p',
          bomQuantity: 4
        },
        {
          id: 'x',
          name: 'Hidden',
          partPath: 'x.json',
          transform: {},
          parentId: 'p',
          bomQuantity: 1,
          suppressed: true
        }
      ]
    })
    const tree = buildBomHierarchy(asm)
    expect(tree).toHaveLength(1)
    expect(tree[0]!.name).toBe('Plate')
    expect(tree[0]!.children).toHaveLength(1)
    expect(tree[0]!.children[0]!.name).toBe('Bolt')
  })

  it('carries BOM reference fields and motionIsolated on nodes', () => {
    const asm = parseAssemblyFile({
      version: 2,
      name: 'A',
      components: [
        {
          id: 'p',
          name: 'Plate',
          partPath: 'p.json',
          transform: {},
          bomQuantity: 1,
          partNumber: 'PN-1',
          referenceTag: 'DWG-A',
          motionIsolated: true
        },
        {
          id: 'b',
          name: 'Bolt',
          partPath: 'b.json',
          transform: {},
          parentId: 'p',
          bomQuantity: 4,
          externalComponentRef: 'ERP-9'
        }
      ]
    })
    const tree = buildBomHierarchy(asm)
    expect(tree[0]!.partNumber).toBe('PN-1')
    expect(tree[0]!.referenceTag).toBe('DWG-A')
    expect(tree[0]!.motionIsolated).toBe(true)
    expect(tree[0]!.children[0]!.externalComponentRef).toBe('ERP-9')
    expect(tree[0]!.children[0]!.motionIsolated).toBe(false)
  })

  it('carries motion link stub fields on nodes', () => {
    const asm = parseAssemblyFile({
      version: 2,
      name: 'L',
      components: [
        {
          id: 'p',
          name: 'Plate',
          partPath: 'p.json',
          transform: {},
          bomQuantity: 1,
          linkedInstanceId: 'b',
          motionLinkKind: 'contact'
        },
        {
          id: 'b',
          name: 'Bracket',
          partPath: 'b.json',
          transform: {},
          parentId: 'p',
          bomQuantity: 1
        }
      ]
    })
    const tree = buildBomHierarchy(asm)
    expect(tree[0]!.linkedInstanceId).toBe('b')
    expect(tree[0]!.motionLinkKind).toBe('contact')
    expect(tree[0]!.children[0]!.linkedInstanceId).toBeUndefined()
  })
})

describe('buildHierarchicalBomText', () => {
  it('appends PN / ref / ext / note metadata when present', () => {
    const asm = parseAssemblyFile({
      version: 2,
      name: 'R',
      components: [
        {
          id: 'p',
          name: 'Plate',
          partPath: 'design/plate.json',
          transform: {},
          bomQuantity: 1,
          partNumber: 'PN-22',
          referenceTag: 'DWG-1',
          externalComponentRef: 'PDM-7',
          bomNotes: 'Short'
        }
      ]
    })
    const t = buildHierarchicalBomText(asm)
    expect(t).toContain('Plate ×1')
    expect(t).toContain('PN-22')
    expect(t).toContain('DWG-1')
    expect(t).toContain('PDM-7')
    expect(t).toContain('Note Short')
  })

  it('appends motion link stub metadata when present', () => {
    const asm = parseAssemblyFile({
      version: 2,
      name: 'L',
      components: [
        {
          id: 'p',
          name: 'Plate',
          partPath: 'design/plate.json',
          transform: {},
          bomQuantity: 1,
          linkedInstanceId: 'other',
          motionLinkKind: 'align'
        }
      ]
    })
    const t = buildHierarchicalBomText(asm)
    expect(t).toContain('Link→other')
    expect(t).toContain('LinkKind align')
  })

  it('indents children by parentId', () => {
    const asm = parseAssemblyFile({
      version: 2,
      name: 'RootAssy',
      components: [
        {
          id: 'p',
          name: 'Plate',
          partPath: 'design/plate.json',
          transform: {},
          bomQuantity: 1
        },
        {
          id: 'b',
          name: 'Bolt',
          partPath: 'parts/bolt.json',
          transform: {},
          parentId: 'p',
          bomQuantity: 4
        }
      ]
    })
    const t = buildHierarchicalBomText(asm)
    expect(t).toContain('Plate ×1')
    expect(t).toContain('  Bolt ×4')
  })

  it('lists cyclic parent chains under Unattached', () => {
    const asm = parseAssemblyFile({
      version: 2,
      name: 'C',
      components: [
        { id: 'a', name: 'A', partPath: 'a.json', transform: {}, parentId: 'b', bomQuantity: 1 },
        { id: 'b', name: 'B', partPath: 'b.json', transform: {}, parentId: 'a', bomQuantity: 1 }
      ]
    })
    const t = buildHierarchicalBomText(asm)
    expect(t).toContain('# Unattached')
  })
})
