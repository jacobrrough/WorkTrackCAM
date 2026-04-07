import { describe, it, expect } from 'vitest'
import {
  cncOp,
  contourPointsStats,
  formatDerivedAt,
  toolDiameterFieldValue,
  cutParamFieldValue,
  geometryJsonFieldValue,
  contourDriftState,
  opReadiness,
  opStatusForPanel,
  filterButtonClass,
  resolveManufactureCamMachine
} from './manufacture-op-helpers'
import type { ManufactureOperation, ManufactureFile } from '../../shared/manufacture-schema'
import type { MachineProfile } from '../../shared/machine-schema'
import type { DerivedContourCandidate } from '../../shared/cam-2d-derive'

function makeOp(overrides: Partial<ManufactureOperation> = {}): ManufactureOperation {
  return {
    id: 'op-1',
    kind: 'cnc_parallel',
    label: 'Test Op',
    ...overrides
  }
}

describe('cncOp', () => {
  it('returns true for cnc_ prefixed kinds', () => {
    expect(cncOp('cnc_parallel')).toBe(true)
    expect(cncOp('cnc_contour')).toBe(true)
    expect(cncOp('cnc_drill')).toBe(true)
    expect(cncOp('cnc_adaptive')).toBe(true)
  })

  it('returns false for non-cnc kinds', () => {
    expect(cncOp('fdm_slice')).toBe(false)
    expect(cncOp('export_stl')).toBe(false)
  })
})

describe('contourPointsStats', () => {
  it('returns null for empty arrays', () => {
    expect(contourPointsStats([])).toBeNull()
  })

  it('returns null for arrays with fewer than 3 valid points', () => {
    expect(contourPointsStats([[0, 0], [1, 1]])).toBeNull()
  })

  it('returns stats string for valid contour points', () => {
    const pts = [[0, 0], [10, 0], [10, 20], [0, 20]]
    const result = contourPointsStats(pts)
    expect(result).toContain('4 vertices')
    expect(result).toContain('XY bbox')
  })

  it('returns null for non-array input', () => {
    expect(contourPointsStats(null)).toBeNull()
    expect(contourPointsStats('string')).toBeNull()
    expect(contourPointsStats(42)).toBeNull()
  })
})

describe('formatDerivedAt', () => {
  it('formats a recent timestamp as "just now"', () => {
    const now = Date.now()
    const iso = new Date(now - 3000).toISOString()
    const result = formatDerivedAt(iso, now)
    expect(result).toContain('just now')
  })

  it('formats a 30-second-old timestamp with seconds', () => {
    const now = Date.now()
    const iso = new Date(now - 30000).toISOString()
    const result = formatDerivedAt(iso, now)
    expect(result).toContain('30s ago')
  })

  it('formats a 5-minute-old timestamp with minutes', () => {
    const now = Date.now()
    const iso = new Date(now - 300_000).toISOString()
    const result = formatDerivedAt(iso, now)
    expect(result).toContain('5m ago')
  })

  it('returns raw string for invalid dates', () => {
    expect(formatDerivedAt('not-a-date', Date.now())).toBe('not-a-date')
  })
})

describe('toolDiameterFieldValue', () => {
  it('returns numeric value as string', () => {
    const op = makeOp({ params: { toolDiameterMm: 6 } })
    expect(toolDiameterFieldValue(op)).toBe('6')
  })

  it('returns empty string when no tool diameter', () => {
    const op = makeOp()
    expect(toolDiameterFieldValue(op)).toBe('')
  })

  it('returns string value when stored as string', () => {
    const op = makeOp({ params: { toolDiameterMm: '3.175' } })
    expect(toolDiameterFieldValue(op)).toBe('3.175')
  })
})

describe('cutParamFieldValue', () => {
  it('returns numeric param as string', () => {
    const op = makeOp({ params: { feedMmMin: 1200 } })
    expect(cutParamFieldValue(op, 'feedMmMin')).toBe('1200')
  })

  it('returns empty string for missing param', () => {
    const op = makeOp()
    expect(cutParamFieldValue(op, 'feedMmMin')).toBe('')
  })
})

describe('geometryJsonFieldValue', () => {
  it('returns JSON string for array params', () => {
    const op = makeOp({ params: { contourPoints: [[0, 0], [10, 0], [10, 10]] } })
    expect(geometryJsonFieldValue(op, 'contourPoints')).toBe('[[0,0],[10,0],[10,10]]')
  })

  it('returns empty string when param is not an array', () => {
    const op = makeOp()
    expect(geometryJsonFieldValue(op, 'contourPoints')).toBe('')
  })
})

describe('contourDriftState', () => {
  const candidates: DerivedContourCandidate[] = [
    { sourceId: 'src-1', label: 'Profile 1', signature: 'sig-abc', points: [[0, 0], [10, 0], [10, 10]] }
  ]

  it('returns "unknown" for non-contour ops', () => {
    const op = makeOp({ kind: 'cnc_parallel' })
    expect(contourDriftState(op, candidates)).toBe('unknown')
  })

  it('returns "unknown" when no sourceId/signature', () => {
    const op = makeOp({ kind: 'cnc_contour' })
    expect(contourDriftState(op, candidates)).toBe('unknown')
  })

  it('returns "ok" when signature matches', () => {
    const op = makeOp({
      kind: 'cnc_contour',
      params: { contourSourceId: 'src-1', contourSourceSignature: 'sig-abc' }
    })
    expect(contourDriftState(op, candidates)).toBe('ok')
  })

  it('returns "changed" when signature differs', () => {
    const op = makeOp({
      kind: 'cnc_contour',
      params: { contourSourceId: 'src-1', contourSourceSignature: 'sig-old' }
    })
    expect(contourDriftState(op, candidates)).toBe('changed')
  })

  it('returns "missing" when sourceId not in candidates', () => {
    const op = makeOp({
      kind: 'cnc_contour',
      params: { contourSourceId: 'src-999', contourSourceSignature: 'sig-abc' }
    })
    expect(contourDriftState(op, candidates)).toBe('missing')
  })
})

describe('opReadiness', () => {
  const candidates: DerivedContourCandidate[] = []

  it('returns "suppressed" for suppressed ops', () => {
    const op = makeOp({ suppressed: true })
    expect(opReadiness(op, candidates).label).toBe('suppressed')
  })

  it('returns "non-cam" for fdm_slice', () => {
    const op = makeOp({ kind: 'fdm_slice' })
    expect(opReadiness(op, candidates).label).toBe('non-cam')
  })

  it('returns "ready" for cnc_parallel', () => {
    const op = makeOp({ kind: 'cnc_parallel' })
    expect(opReadiness(op, candidates).label).toBe('ready')
  })

  it('returns "missing geometry" for contour without points', () => {
    const op = makeOp({ kind: 'cnc_contour' })
    expect(opReadiness(op, candidates).label).toBe('missing geometry')
  })

  it('returns "ready" for contour with valid points', () => {
    const op = makeOp({
      kind: 'cnc_contour',
      params: { contourPoints: [[0, 0], [10, 0], [10, 10]] }
    })
    expect(opReadiness(op, candidates).label).toBe('ready')
  })

  it('returns "missing geometry" for drill without points', () => {
    const op = makeOp({ kind: 'cnc_drill' })
    expect(opReadiness(op, candidates).label).toBe('missing geometry')
  })

  it('returns "ready" for drill with valid points', () => {
    const op = makeOp({
      kind: 'cnc_drill',
      params: { drillPoints: [[5, 5]] }
    })
    expect(opReadiness(op, candidates).label).toBe('ready')
  })
})

describe('opStatusForPanel', () => {
  const candidates: DerivedContourCandidate[] = []

  it('maps missing geometry to "missing"', () => {
    expect(opStatusForPanel(makeOp({ kind: 'cnc_contour' }), candidates)).toBe('missing')
  })

  it('maps ready to "ready"', () => {
    expect(opStatusForPanel(makeOp({ kind: 'cnc_parallel' }), candidates)).toBe('ready')
  })
})

describe('filterButtonClass', () => {
  it('returns active class when active', () => {
    expect(filterButtonClass(true)).toBe('secondary filter-btn--active')
  })

  it('returns secondary class when not active', () => {
    expect(filterButtonClass(false)).toBe('secondary')
  })
})

describe('resolveManufactureCamMachine', () => {
  const cncMachine = {
    id: 'cnc-1',
    kind: 'cnc',
    name: 'Test CNC',
    dialect: 'grbl',
    workAreaMm: { x: 300, y: 300, z: 100 },
    maxFeedMmMin: 5000,
    postTemplate: 'grbl-mm',
    maxSpindleRpm: 24000,
    spindleRange: [8000, 24000],
    coolant: false,
    homeSequence: 'G28',
    toolChangePolicy: 'manual'
  } as unknown as MachineProfile

  const fdmMachine = {
    id: 'fdm-1',
    kind: 'fdm',
    name: 'Test FDM'
  } as unknown as MachineProfile

  it('returns undefined when no CNC machines', () => {
    const mfg: ManufactureFile = { version: 1, setups: [], operations: [] }
    expect(resolveManufactureCamMachine(mfg, [fdmMachine])).toBeUndefined()
  })

  it('returns first CNC machine when no setup match', () => {
    const mfg: ManufactureFile = { version: 1, setups: [], operations: [] }
    expect(resolveManufactureCamMachine(mfg, [fdmMachine, cncMachine])).toBe(cncMachine)
  })

  it('returns matching CNC machine from setup', () => {
    const mfg: ManufactureFile = {
      version: 1,
      setups: [{ id: 's1', label: 'S1', machineId: 'cnc-1', workCoordinateIndex: 1, stock: { kind: 'box', x: 100, y: 100, z: 25 } }],
      operations: []
    }
    expect(resolveManufactureCamMachine(mfg, [fdmMachine, cncMachine])).toBe(cncMachine)
  })
})
