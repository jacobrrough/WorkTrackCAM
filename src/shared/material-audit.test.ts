import { describe, expect, it } from 'vitest'
import { auditMaterialPresets, type MaterialAuditFinding } from './material-audit'
import {
  CHIP_LOAD_REFERENCE,
  SURFACE_SPEED_REFERENCE,
  mapToolTypeToAudit
} from './material-reference-data'
import type { MaterialRecord } from './material-schema'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMaterial(
  id: string,
  category: string,
  cutParams: Record<string, {
    surfaceSpeedMMin: number
    chiploadMm: number
    docFactor: number
    stepoverFactor: number
    plungeFactor?: number
  }>
): MaterialRecord {
  return {
    id,
    name: `Test ${id}`,
    category: category as MaterialRecord['category'],
    cutParams: Object.fromEntries(
      Object.entries(cutParams).map(([k, v]) => [k, {
        surfaceSpeedMMin: v.surfaceSpeedMMin,
        chiploadMm: v.chiploadMm,
        docFactor: v.docFactor,
        stepoverFactor: v.stepoverFactor,
        plungeFactor: v.plungeFactor ?? 0.3
      }])
    )
  }
}

function findFinding(findings: MaterialAuditFinding[], materialId: string, field: string, toolType = 'default'): MaterialAuditFinding | undefined {
  return findings.find((f) => f.materialId === materialId && f.field === field && f.toolType === toolType)
}

// ---------------------------------------------------------------------------
// mapToolTypeToAudit
// ---------------------------------------------------------------------------

describe('mapToolTypeToAudit', () => {
  it('maps endmill and default to endmill_2f', () => {
    expect(mapToolTypeToAudit('endmill')).toBe('endmill_2f')
    expect(mapToolTypeToAudit('default')).toBe('endmill_2f')
  })

  it('maps ball to ball', () => {
    expect(mapToolTypeToAudit('ball')).toBe('ball')
  })

  it('maps drill to drill', () => {
    expect(mapToolTypeToAudit('drill')).toBe('drill')
  })

  it('maps vbit to endmill_2f (closest match)', () => {
    expect(mapToolTypeToAudit('vbit')).toBe('endmill_2f')
  })

  it('maps unknown types to endmill_2f', () => {
    expect(mapToolTypeToAudit('mystery')).toBe('endmill_2f')
  })
})

// ---------------------------------------------------------------------------
// Reference data integrity
// ---------------------------------------------------------------------------

describe('reference data integrity', () => {
  it('has surface speed data for key materials', () => {
    const required = ['aluminum_6061', 'steel_mild', 'stainless', 'brass', 'softwood', 'hardwood', 'acrylic', 'hdpe', 'delrin']
    for (const mat of required) {
      expect(SURFACE_SPEED_REFERENCE[mat]).toBeDefined()
      expect(SURFACE_SPEED_REFERENCE[mat].minMMin).toBeLessThan(SURFACE_SPEED_REFERENCE[mat].maxMMin)
    }
  })

  it('has chip load data for key materials', () => {
    const required = ['aluminum_6061', 'steel_mild', 'stainless', 'brass', 'softwood', 'hardwood']
    for (const mat of required) {
      expect(CHIP_LOAD_REFERENCE[mat]).toBeDefined()
      expect(CHIP_LOAD_REFERENCE[mat].endmill_2f.minMm).toBeLessThan(CHIP_LOAD_REFERENCE[mat].endmill_2f.maxMm)
      expect(CHIP_LOAD_REFERENCE[mat].ball.minMm).toBeLessThan(CHIP_LOAD_REFERENCE[mat].ball.maxMm)
      expect(CHIP_LOAD_REFERENCE[mat].drill.minMm).toBeLessThan(CHIP_LOAD_REFERENCE[mat].drill.maxMm)
    }
  })

  it('all surface speed min < max', () => {
    for (const [, range] of Object.entries(SURFACE_SPEED_REFERENCE)) {
      expect(range.minMMin).toBeLessThan(range.maxMMin)
      expect(range.minMMin).toBeGreaterThan(0)
    }
  })

  it('all chip load min < max', () => {
    for (const [, tools] of Object.entries(CHIP_LOAD_REFERENCE)) {
      for (const [, range] of Object.entries(tools)) {
        expect(range.minMm).toBeLessThan(range.maxMm)
        expect(range.minMm).toBeGreaterThan(0)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// auditMaterialPresets — ok cases
// ---------------------------------------------------------------------------

describe('auditMaterialPresets: passing presets', () => {
  it('reports no issues for well-calibrated aluminum 6061', () => {
    const mat = makeMaterial('al6061', 'aluminum_6061', {
      default: { surfaceSpeedMMin: 150, chiploadMm: 0.04, docFactor: 0.3, stepoverFactor: 0.35 }
    })
    const result = auditMaterialPresets([mat])
    const sfm = findFinding(result.allFindings, 'al6061', 'surfaceSpeed')
    expect(sfm?.severity).toBe('ok')
    const cl = findFinding(result.allFindings, 'al6061', 'chipLoad')
    expect(cl?.severity).toBe('ok')
  })

  it('reports no issues for well-calibrated steel', () => {
    const mat = makeMaterial('steel', 'steel_mild', {
      default: { surfaceSpeedMMin: 35, chiploadMm: 0.02, docFactor: 0.15, stepoverFactor: 0.25 }
    })
    const result = auditMaterialPresets([mat])
    const sfmIssues = result.issues.filter((f) => f.materialId === 'steel' && f.field === 'surfaceSpeed')
    expect(sfmIssues).toHaveLength(0)
  })

  it('plunge factor under 1.0 is ok', () => {
    const mat = makeMaterial('brass', 'brass', {
      default: { surfaceSpeedMMin: 90, chiploadMm: 0.02, docFactor: 0.3, stepoverFactor: 0.35, plungeFactor: 0.5 }
    })
    const result = auditMaterialPresets([mat])
    const pf = findFinding(result.allFindings, 'brass', 'plungeFactor')
    expect(pf?.severity).toBe('ok')
  })
})

// ---------------------------------------------------------------------------
// auditMaterialPresets — warning/danger cases
// ---------------------------------------------------------------------------

describe('auditMaterialPresets: warning and danger cases', () => {
  it('flags surface speed way above range as danger', () => {
    // Stainless max is 35 m/min; 200 m/min is absurdly high
    const mat = makeMaterial('ss-bad', 'stainless', {
      default: { surfaceSpeedMMin: 200, chiploadMm: 0.01, docFactor: 0.1, stepoverFactor: 0.2 }
    })
    const result = auditMaterialPresets([mat])
    const sfm = findFinding(result.allFindings, 'ss-bad', 'surfaceSpeed')
    expect(sfm).toBeDefined()
    expect(sfm!.severity).not.toBe('ok')
    expect(sfm!.deviationPercent).toBeGreaterThan(0)
  })

  it('flags surface speed way below range', () => {
    // Aluminum min is 100 m/min; 5 m/min is way too low
    const mat = makeMaterial('al-slow', 'aluminum_6061', {
      default: { surfaceSpeedMMin: 5, chiploadMm: 0.03, docFactor: 0.3, stepoverFactor: 0.35 }
    })
    const result = auditMaterialPresets([mat])
    const sfm = findFinding(result.allFindings, 'al-slow', 'surfaceSpeed')
    expect(sfm).toBeDefined()
    expect(sfm!.severity).not.toBe('ok')
    expect(sfm!.deviationPercent).toBeLessThan(0) // negative = below range
  })

  it('flags plunge factor exceeding 1.0 as danger', () => {
    const mat = makeMaterial('plunge-bad', 'softwood', {
      default: { surfaceSpeedMMin: 200, chiploadMm: 0.05, docFactor: 0.5, stepoverFactor: 0.45, plungeFactor: 1.5 }
    })
    const result = auditMaterialPresets([mat])
    const pf = findFinding(result.allFindings, 'plunge-bad', 'plungeFactor')
    expect(pf).toBeDefined()
    expect(pf!.severity).toBe('danger')
    expect(pf!.value).toBe(1.5)
    expect(pf!.expected).toBe(1.0)
  })

  it('flags extremely high chip load', () => {
    // Stainless max chip load is ~0.025 mm; 0.5 mm is absurd
    const mat = makeMaterial('ss-chipbad', 'stainless', {
      default: { surfaceSpeedMMin: 20, chiploadMm: 0.5, docFactor: 0.1, stepoverFactor: 0.2 }
    })
    const result = auditMaterialPresets([mat])
    const cl = findFinding(result.allFindings, 'ss-chipbad', 'chipLoad')
    expect(cl).toBeDefined()
    expect(cl!.severity).not.toBe('ok')
  })
})

// ---------------------------------------------------------------------------
// auditMaterialPresets — multiple tool types
// ---------------------------------------------------------------------------

describe('auditMaterialPresets: multiple tool types per material', () => {
  it('audits each tool type independently', () => {
    const mat = makeMaterial('multi', 'aluminum_6061', {
      default: { surfaceSpeedMMin: 120, chiploadMm: 0.025, docFactor: 0.3, stepoverFactor: 0.35 },
      endmill: { surfaceSpeedMMin: 120, chiploadMm: 0.025, docFactor: 0.3, stepoverFactor: 0.35 },
      ball:    { surfaceSpeedMMin: 100, chiploadMm: 0.018, docFactor: 0.2, stepoverFactor: 0.08 },
      drill:   { surfaceSpeedMMin: 60,  chiploadMm: 0.04,  docFactor: 2.0, stepoverFactor: 0.5  }
    })
    const result = auditMaterialPresets([mat])
    expect(result.totalChecks).toBe(4)
    // Each tool type should have surfaceSpeed, chipLoad, and plungeFactor findings
    const allFields = result.allFindings.map((f) => f.field)
    expect(allFields.filter((f) => f === 'surfaceSpeed').length).toBe(4)
    expect(allFields.filter((f) => f === 'chipLoad').length).toBe(4)
    expect(allFields.filter((f) => f === 'plungeFactor').length).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// auditMaterialPresets — unknown categories
// ---------------------------------------------------------------------------

describe('auditMaterialPresets: unknown material categories', () => {
  it('skips surface speed and chip load checks for unknown category', () => {
    const mat = makeMaterial('mystery', 'other', {
      default: { surfaceSpeedMMin: 100, chiploadMm: 0.05, docFactor: 0.3, stepoverFactor: 0.4 }
    })
    const result = auditMaterialPresets([mat])
    // No surface speed or chip load reference for 'other'
    const sfm = findFinding(result.allFindings, 'mystery', 'surfaceSpeed')
    expect(sfm).toBeUndefined()
    const cl = findFinding(result.allFindings, 'mystery', 'chipLoad')
    expect(cl).toBeUndefined()
    // Plunge factor check should still work
    const pf = findFinding(result.allFindings, 'mystery', 'plungeFactor')
    expect(pf).toBeDefined()
    expect(pf!.severity).toBe('ok')
  })
})

// ---------------------------------------------------------------------------
// auditMaterialPresets — empty input
// ---------------------------------------------------------------------------

describe('auditMaterialPresets: empty input', () => {
  it('returns zero findings for empty material array', () => {
    const result = auditMaterialPresets([])
    expect(result.totalChecks).toBe(0)
    expect(result.issues).toHaveLength(0)
    expect(result.allFindings).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Audit the bundled default-materials.json
// ---------------------------------------------------------------------------

describe('auditMaterialPresets: bundled materials sanity check', () => {
  it('bundled aluminum_6061 surface speed is within reference range', () => {
    // Values from default-materials.json
    const mat = makeMaterial('aluminum_6061', 'aluminum_6061', {
      default: { surfaceSpeedMMin: 120, chiploadMm: 0.025, docFactor: 0.3, stepoverFactor: 0.35 }
    })
    const result = auditMaterialPresets([mat])
    const sfm = findFinding(result.allFindings, 'aluminum_6061', 'surfaceSpeed')
    expect(sfm?.severity).toBe('ok')
  })

  it('bundled softwood surface speed is within reference range', () => {
    const mat = makeMaterial('softwood', 'softwood', {
      default: { surfaceSpeedMMin: 200, chiploadMm: 0.05, docFactor: 0.5, stepoverFactor: 0.45, plungeFactor: 0.35 }
    })
    const result = auditMaterialPresets([mat])
    const sfm = findFinding(result.allFindings, 'softwood', 'surfaceSpeed')
    expect(sfm?.severity).toBe('ok')
  })

  it('bundled mild steel surface speed is within reference range', () => {
    const mat = makeMaterial('steel_mild', 'steel_mild', {
      default: { surfaceSpeedMMin: 30, chiploadMm: 0.015, docFactor: 0.15, stepoverFactor: 0.25, plungeFactor: 0.2 }
    })
    const result = auditMaterialPresets([mat])
    const sfm = findFinding(result.allFindings, 'steel_mild', 'surfaceSpeed')
    expect(sfm?.severity).toBe('ok')
  })

  it('bundled stainless surface speed is within reference range', () => {
    const mat = makeMaterial('stainless', 'stainless', {
      default: { surfaceSpeedMMin: 18, chiploadMm: 0.012, docFactor: 0.12, stepoverFactor: 0.2, plungeFactor: 0.18 }
    })
    const result = auditMaterialPresets([mat])
    const sfm = findFinding(result.allFindings, 'stainless', 'surfaceSpeed')
    expect(sfm?.severity).toBe('ok')
  })

  it('no bundled material has plunge factor exceeding 1.0', () => {
    // Verify all bundled materials from default-materials.json
    const bundledMaterials: MaterialRecord[] = [
      makeMaterial('softwood', 'softwood', {
        default: { surfaceSpeedMMin: 200, chiploadMm: 0.05, docFactor: 0.5, stepoverFactor: 0.45, plungeFactor: 0.35 },
        drill: { surfaceSpeedMMin: 100, chiploadMm: 0.08, docFactor: 1.5, stepoverFactor: 0.5, plungeFactor: 0.5 }
      }),
      makeMaterial('hardwood', 'hardwood', {
        default: { surfaceSpeedMMin: 150, chiploadMm: 0.04, docFactor: 0.4, stepoverFactor: 0.4, plungeFactor: 0.3 },
        drill: { surfaceSpeedMMin: 80, chiploadMm: 0.06, docFactor: 1.2, stepoverFactor: 0.5, plungeFactor: 0.4 }
      }),
      makeMaterial('aluminum_6061', 'aluminum_6061', {
        default: { surfaceSpeedMMin: 120, chiploadMm: 0.025, docFactor: 0.3, stepoverFactor: 0.35, plungeFactor: 0.25 },
        drill: { surfaceSpeedMMin: 60, chiploadMm: 0.04, docFactor: 2.0, stepoverFactor: 0.5, plungeFactor: 0.4 }
      }),
      makeMaterial('steel_mild', 'steel_mild', {
        default: { surfaceSpeedMMin: 30, chiploadMm: 0.015, docFactor: 0.15, stepoverFactor: 0.25, plungeFactor: 0.2 },
        drill: { surfaceSpeedMMin: 20, chiploadMm: 0.025, docFactor: 2.0, stepoverFactor: 0.5, plungeFactor: 0.3 }
      }),
      makeMaterial('stainless', 'stainless', {
        default: { surfaceSpeedMMin: 18, chiploadMm: 0.012, docFactor: 0.12, stepoverFactor: 0.2, plungeFactor: 0.18 }
      }),
      makeMaterial('brass', 'brass', {
        default: { surfaceSpeedMMin: 90, chiploadMm: 0.022, docFactor: 0.28, stepoverFactor: 0.35, plungeFactor: 0.25 }
      })
    ]
    const result = auditMaterialPresets(bundledMaterials)
    const plungeIssues = result.issues.filter((f) => f.field === 'plungeFactor')
    expect(plungeIssues).toHaveLength(0)
  })
})
