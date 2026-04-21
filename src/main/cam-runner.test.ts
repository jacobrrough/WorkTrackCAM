import { unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { MachineProfile } from '../shared/machine-schema'
import * as pathsMod from './paths'
import {
  builtinOclFailureHint,
  drillOperationHints,
  manufactureKindUses4AxisEngine,
  manufactureKindUsesAdvancedStrategy,
  manufactureKindUsesOclStrategy,
  manufactureKindUsesOclWaterline,
  manufactureKindUsesToolpathEngine,
  normalizeAxis4RadialZPassMm,
  readStlBufferForCam,
  resolveOclFallbackReason,
  resolveContourPathOptions,
  resolveDrillCycleDecision,
  resolveDrillCycleMode,
  runCamPipeline,
  shouldAppendFinalPocketFinishPass,
  validate2dOperationGeometry
} from './cam-runner'

const testMill: MachineProfile = {
  id: 'test-mill',
  name: 'Test mill',
  kind: 'cnc',
  workAreaMm: { x: 200, y: 200, z: 100 },
  maxFeedMmMin: 5000,
  postTemplate: 'cnc_generic_mm.hbs',
  dialect: 'grbl'
}

function buildOneTriangleBinaryStl(): Buffer {
  const header = Buffer.alloc(80, 0)
  const count = Buffer.alloc(4)
  count.writeUInt32LE(1, 0)
  const tri = Buffer.alloc(50)
  let o = 0
  tri.writeFloatLE(0, o)
  o += 4
  tri.writeFloatLE(0, o)
  o += 4
  tri.writeFloatLE(1, o)
  o += 4
  const verts: [number, number, number][] = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0]
  ]
  for (const [x, y, z] of verts) {
    tri.writeFloatLE(x, o)
    o += 4
    tri.writeFloatLE(y, o)
    o += 4
    tri.writeFloatLE(z, o)
    o += 4
  }
  tri.writeUInt16LE(0, o)
  return Buffer.concat([header, count, tri])
}

describe('readStlBufferForCam', () => {
  it('accepts a minimal binary STL', async () => {
    const p = join(tmpdir(), 'ufs-cam-binary-ok.stl')
    await writeFile(p, buildOneTriangleBinaryStl())
    try {
      const r = await readStlBufferForCam(p)
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.buf.length).toBeGreaterThan(80)
    } finally {
      await unlink(p).catch(() => {})
    }
  })

  it('rejects missing files with ENOENT-style hint', async () => {
    const r = await readStlBufferForCam(join(tmpdir(), 'ufs-cam-missing-test-file.stl'))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toMatch(/not found/i)
      expect(r.hint).toMatch(/path|STL|disk/i)
    }
  })

  it('rejects ASCII STL', async () => {
    const p = join(tmpdir(), 'ufs-cam-ascii-test.stl')
    await writeFile(p, 'solid test\nendsolid\n')
    try {
      const r = await readStlBufferForCam(p)
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.error).toMatch(/ASCII/i)
        expect(r.hint).toMatch(/binary/i)
      }
    } finally {
      await unlink(p).catch(() => {})
    }
  })
})

describe('builtinOclFailureHint', () => {
  it('covers Python OCL error tokens for waterline vs raster wording', () => {
    expect(builtinOclFailureHint('{"error":"stl_missing"}', 'cnc_waterline')).toMatch(/missing STL path/i)
    expect(builtinOclFailureHint('{"error":"stl_missing"}', 'cnc_raster')).toMatch(/mesh or orthogonal/i)
    expect(builtinOclFailureHint('{"error":"stl_missing"}', 'cnc_pencil')).toMatch(/mesh or orthogonal/i)
    expect(builtinOclFailureHint('{"error":"config_missing_keys"}', 'cnc_adaptive')).toMatch(/temp config JSON/i)
    expect(builtinOclFailureHint('invalid_numeric_params', undefined)).toMatch(/feed|tool|stepover/i)
    expect(builtinOclFailureHint('{"ok":false,"error":"stl_read_error"}', 'cnc_waterline')).toMatch(
      /could not read the STL/i
    )
  })

  it('differentiates waterline vs adaptive for OCL install and empty-toolpath fallbacks', () => {
    expect(builtinOclFailureHint('opencamlib_not_installed', 'cnc_waterline')).toMatch(/Waterline[^A]|Waterline;/)
    expect(builtinOclFailureHint('opencamlib_not_installed', 'cnc_waterline')).not.toMatch(/AdaptiveWaterline/)
    expect(builtinOclFailureHint('opencamlib_not_installed', 'cnc_adaptive')).toMatch(/AdaptiveWaterline/)
    expect(builtinOclFailureHint('ocl_empty_toolpath', 'cnc_waterline')).toMatch(/OpenCAMLib Waterline did not produce/)
    expect(builtinOclFailureHint('ocl_runtime_error', 'cnc_adaptive')).toMatch(/OpenCAMLib AdaptiveWaterline did not produce/)
    expect(builtinOclFailureHint('{"error":"stl_missing"}', 'cnc_waterline')).toMatch(/Waterline intent/)
    expect(builtinOclFailureHint('{"error":"stl_missing"}', 'cnc_adaptive')).toMatch(/Adaptive clearing intent/)
  })
})

describe('normalizeAxis4RadialZPassMm', () => {
  it('keeps negative values (into-stock convention for axis4)', () => {
    expect(normalizeAxis4RadialZPassMm(-2)).toBe(-2)
    expect(normalizeAxis4RadialZPassMm(-0.5)).toBe(-0.5)
  })
  it('negates positive depth so axis4 does not air-cut above the cylinder', () => {
    expect(normalizeAxis4RadialZPassMm(5)).toBe(-5)
    expect(normalizeAxis4RadialZPassMm(1)).toBe(-1)
  })
  it('maps zero to a safe minimal default cut depth', () => {
    expect(normalizeAxis4RadialZPassMm(0)).toBe(-0.5)
  })
  it('maps NaN to safe default (NaN comparisons are all false, falls through to -0.5)', () => {
    expect(normalizeAxis4RadialZPassMm(NaN)).toBe(-0.5)
  })
  it('negates Infinity (treats as positive depth into stock)', () => {
    expect(normalizeAxis4RadialZPassMm(Infinity)).toBe(-Infinity)
    expect(normalizeAxis4RadialZPassMm(-Infinity)).toBe(-Infinity)
  })
})

describe('resolveOclFallbackReason', () => {
  it('normalizes known OpenCAMLib failure tokens', () => {
    expect(resolveOclFallbackReason('invalid_numeric_params')).toBe('invalid_numeric_params')
    expect(resolveOclFallbackReason('stl_missing')).toBe('stl_missing')
    expect(resolveOclFallbackReason('config_missing_keys')).toBe('config_error')
    expect(resolveOclFallbackReason('stl_read_error')).toBe('stl_read_error')
    expect(resolveOclFallbackReason('opencamlib_not_installed')).toBe('opencamlib_not_installed')
    expect(resolveOclFallbackReason('ocl_runtime_error')).toBe('ocl_runtime_or_empty')
    expect(resolveOclFallbackReason('ocl_empty_toolpath')).toBe('ocl_runtime_or_empty')
    expect(resolveOclFallbackReason('python_spawn_failed')).toBe('python_spawn_failed')
    expect(resolveOclFallbackReason('unexpected_token')).toBe(undefined)
  })

  it('matches advanced_engine_spawn_failed with appended error message (error-suffix format)', () => {
    // tryAdvancedToolpath catch block now emits "advanced_engine_spawn_failed: <msg>"
    // resolveOclFallbackReason uses .includes() so the suffix must not break it
    expect(resolveOclFallbackReason('advanced_engine_spawn_failed')).toBe('advanced_engine_failed')
    expect(resolveOclFallbackReason("advanced_engine_spawn_failed: spawn python ENOENT")).toBe('advanced_engine_failed')
    expect(resolveOclFallbackReason("advanced_engine_spawn_failed: timed out after 60s")).toBe('advanced_engine_failed')
  })
})

describe('runCamPipeline', () => {
  it('returns cam_engines_bundle_missing when Python engine files are absent', async () => {
    const spy = vi.spyOn(pathsMod, 'getEnginesBundleDiagnostics').mockResolvedValue({
      enginesRoot: '/no/engines',
      directoryReadable: false,
      camBundleComplete: false,
      missingCamSentinels: ['cam/ocl_toolpath.py'],
      meshScriptPresent: false,
      occtStepScriptPresent: false
    })
    const p = join(tmpdir(), 'ufs-cam-bundle-miss.stl')
    const out = join(tmpdir(), 'ufs-cam-bundle-miss.nc')
    await writeFile(p, buildOneTriangleBinaryStl())
    try {
      const resourcesRoot = join(process.cwd(), 'resources')
      const r = await runCamPipeline({
        stlPath: p,
        outputGcodePath: out,
        machine: testMill,
        resourcesRoot,
        appRoot: process.cwd(),
        zPassMm: 1,
        stepoverMm: 2,
        feedMmMin: 500,
        plungeMmMin: 300,
        safeZMm: 5,
        pythonPath: 'python',
        operationKind: 'cnc_parallel'
      })
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.error).toBe('cam_engines_bundle_missing')
        expect(r.hint).toMatch(/cam\/ocl_toolpath\.py|engines/i)
      }
    } finally {
      spy.mockRestore()
      await unlink(p).catch(() => {})
      await unlink(out).catch(() => {})
    }
  })

  it('returns builtin hint for cnc_parallel (mesh height-field raster, unverified copy)', async () => {
    const p = join(tmpdir(), 'ufs-cam-parallel-hint.stl')
    const out = join(tmpdir(), 'ufs-cam-parallel-hint.nc')
    await writeFile(p, buildOneTriangleBinaryStl())
    try {
      const resourcesRoot = join(process.cwd(), 'resources')
      const r = await runCamPipeline({
        stlPath: p,
        outputGcodePath: out,
        machine: testMill,
        resourcesRoot,
        appRoot: process.cwd(),
        zPassMm: 1,
        stepoverMm: 2,
        feedMmMin: 500,
        plungeMmMin: 300,
        safeZMm: 5,
        pythonPath: 'python',
        operationKind: 'cnc_parallel'
      })
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.usedEngine).toBe('builtin')
        expect(r.engine.requestedEngine).toBe('builtin')
        expect(r.engine.usedEngine).toBe('builtin')
        expect(r.engine.fallbackApplied).toBe(false)
        // The builtin fallback now tries mesh height-field first (follows model
        // geometry); only fall back to orthogonal bounds zigzag when the mesh
        // has no XY samples (the one-triangle fixture may produce either path).
        expect(r.hint).toMatch(/mesh height-field|orthogonal bounds zigzag/i)
        expect(r.hint).toMatch(/unverified|MACHINES\.md/i)
      }
    } finally {
      await unlink(p).catch(() => {})
      await unlink(out).catch(() => {})
    }
  })

  it('merges drill depth/retract hints for cnc_drill', async () => {
    const out = join(tmpdir(), 'ufs-cam-drill-hint.nc')
    const mill: MachineProfile = { ...testMill, dialect: 'mach3' }
    const resourcesRoot = join(process.cwd(), 'resources')
    const r = await runCamPipeline({
      stlPath: join(tmpdir(), 'unused-drill.stl'),
      outputGcodePath: out,
      machine: mill,
      resourcesRoot,
      appRoot: process.cwd(),
      zPassMm: -4,
      stepoverMm: 2,
      feedMmMin: 500,
      plungeMmMin: 300,
      safeZMm: 10,
      pythonPath: 'python',
      operationKind: 'cnc_drill',
      operationParams: { drillPoints: [[0, 0]] }
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.engine.requestedEngine).toBe('builtin')
      expect(r.engine.fallbackApplied).toBe(false)
      expect(r.hint).toMatch(/safeZMm \(10\.0 mm\)/)
      expect(r.hint).toMatch(/zPassMm \(-4\.000 mm\)/)
    }
    await unlink(out).catch(() => {})
  })

  it('runs multi-depth cnc_contour when zPassMm is negative and zStepMm is set', async () => {
    const out = join(tmpdir(), 'ufs-cam-contour-step.nc')
    const resourcesRoot = join(process.cwd(), 'resources')
    const square: [number, number][] = [
      [0, 0],
      [20, 0],
      [20, 20],
      [0, 20]
    ]
    const r = await runCamPipeline({
      stlPath: join(tmpdir(), 'unused-contour.stl'),
      outputGcodePath: out,
      machine: testMill,
      resourcesRoot,
      appRoot: process.cwd(),
      zPassMm: -6,
      stepoverMm: 2,
      feedMmMin: 500,
      plungeMmMin: 300,
      safeZMm: 10,
      pythonPath: 'python',
      operationKind: 'cnc_contour',
      operationParams: { contourPoints: square, zStepMm: 2 }
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      const zCuts = (r.gcode.match(/G1 Z-2\.000/g) ?? []).length
      expect(zCuts).toBeGreaterThanOrEqual(1)
      expect(r.gcode).toMatch(/G1 Z-4\.000/)
      expect(r.gcode).toMatch(/G1 Z-6\.000/)
    }
    await unlink(out).catch(() => {})
  })

  it('includes ball-end-mill DOC advisory in guardHint when toolShape is ball and DOC exceeds radius', async () => {
    const p = join(tmpdir(), 'ufs-cam-ball-guard.stl')
    const out = join(tmpdir(), 'ufs-cam-ball-guard.nc')
    await writeFile(p, buildOneTriangleBinaryStl())
    try {
      const resourcesRoot = join(process.cwd(), 'resources')
      const r = await runCamPipeline({
        stlPath: p,
        outputGcodePath: out,
        machine: testMill,
        resourcesRoot,
        appRoot: process.cwd(),
        // Tool Ø 6mm → radius 3mm; zPassMm 5 > 3 should trigger ball-end-mill warning
        zPassMm: 5,
        stepoverMm: 2,
        feedMmMin: 500,
        plungeMmMin: 300,
        safeZMm: 5,
        pythonPath: 'python',
        operationKind: 'cnc_parallel',
        toolDiameterMm: 6,
        operationParams: { toolShape: 'ball' }
      })
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.hint).toMatch(/ball end mill/i)
        expect(r.hint).toMatch(/Applied guardrails/)
      }
    } finally {
      await unlink(p).catch(() => {})
      await unlink(out).catch(() => {})
    }
  })

  it('includes flute-length DOC advisory in guardHint when DOC exceeds fluteLengthMm / 2', async () => {
    const out = join(tmpdir(), 'ufs-cam-flute-guard.nc')
    const resourcesRoot = join(process.cwd(), 'resources')
    const square: [number, number][] = [
      [0, 0],
      [20, 0],
      [20, 20],
      [0, 20]
    ]
    const r = await runCamPipeline({
      stlPath: join(tmpdir(), 'unused-contour.stl'),
      outputGcodePath: out,
      machine: testMill,
      resourcesRoot,
      appRoot: process.cwd(),
      // fluteLengthMm 10 → safe limit 5mm; zPassMm -7 > 5 should trigger flute warning
      zPassMm: -7,
      stepoverMm: 2,
      feedMmMin: 500,
      plungeMmMin: 300,
      safeZMm: 10,
      pythonPath: 'python',
      operationKind: 'cnc_contour',
      operationParams: { contourPoints: square, fluteLengthMm: 10 }
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.hint).toMatch(/flute/i)
      expect(r.hint).toMatch(/Applied guardrails/)
    }
    await unlink(out).catch(() => {})
  })

  it('routes cnc_chamfer to generateChamfer2dLines (not STL parallel finish)', async () => {
    // cnc_chamfer must use the contourPoints-based chamfer generator, not fall through to STL.
    // No STL file is needed — the 2D path is computed before the STL read.
    const out = join(tmpdir(), 'ufs-cam-chamfer.nc')
    const square: [number, number][] = [
      [0, 0],
      [20, 0],
      [20, 20],
      [0, 20]
    ]
    const resourcesRoot = join(process.cwd(), 'resources')
    const r = await runCamPipeline({
      stlPath: join(tmpdir(), 'no-such-file.stl'), // STL must NOT be read for chamfer
      outputGcodePath: out,
      machine: testMill,
      resourcesRoot,
      appRoot: process.cwd(),
      zPassMm: -1,
      stepoverMm: 2,
      feedMmMin: 500,
      plungeMmMin: 300,
      safeZMm: 5,
      pythonPath: 'python',
      operationKind: 'cnc_chamfer',
      operationParams: { contourPoints: square, chamferDepthMm: 1, chamferAngleDeg: 45 }
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      // G-code should have a plunge to chamfer depth (negative Z) and feed moves
      expect(r.gcode).toMatch(/G1 Z-1\.000/i)
      expect(r.gcode).toMatch(/G1 X/i)
      // Hint must mention 2D path (not parallel finish from STL)
      expect(r.hint).toMatch(/2D path/i)
    }
    await unlink(out).catch(() => {})
  })
})

describe('drillOperationHints', () => {
  it('notes retract fallback when retractMm is unset', () => {
    const h = drillOperationHints({ drillPoints: [[0, 0]] }, { zPassMm: -3, safeZMm: 12 })
    expect(h.join(' ')).toMatch(/safeZMm \(12\.0 mm\)/)
    expect(h.join(' ')).toMatch(/zPassMm \(-3\.000 mm\)/)
  })

  it('omits retract fallback copy when retractMm is set', () => {
    const h = drillOperationHints({ drillPoints: [[0, 0]], retractMm: 8 }, { zPassMm: -2, safeZMm: 10 })
    expect(h.some((x) => x.includes('because retractMm is unset'))).toBe(false)
  })
})

describe('manufactureKindUsesOclStrategy', () => {
  it('maps waterline, adaptive, and raster', () => {
    expect(manufactureKindUsesOclStrategy('cnc_waterline')).toBe('waterline')
    expect(manufactureKindUsesOclStrategy('cnc_adaptive')).toBe('adaptive_waterline')
    expect(manufactureKindUsesOclStrategy('cnc_raster')).toBe('raster')
    expect(manufactureKindUsesOclStrategy('cnc_pencil')).toBe('raster')
    expect(manufactureKindUsesOclStrategy('cnc_parallel')).toBe(null)
    expect(manufactureKindUsesOclStrategy(undefined)).toBe(null)
  })
})

describe('manufactureKindUsesOclWaterline', () => {
  it('maps waterline and adaptive kinds only', () => {
    expect(manufactureKindUsesOclWaterline('cnc_waterline')).toBe('waterline')
    expect(manufactureKindUsesOclWaterline('cnc_adaptive')).toBe('adaptive_waterline')
    expect(manufactureKindUsesOclWaterline('cnc_raster')).toBe(null)
    expect(manufactureKindUsesOclWaterline('cnc_pencil')).toBe(null)
    expect(manufactureKindUsesOclWaterline('cnc_parallel')).toBe(null)
    expect(manufactureKindUsesOclWaterline(undefined)).toBe(null)
  })
})

describe('resolveDrillCycleMode', () => {
  it('defaults to expanded for grbl and G81 otherwise', () => {
    expect(resolveDrillCycleMode({ dialect: 'grbl' })).toBe('expanded')
    expect(resolveDrillCycleMode({ dialect: 'mach3' })).toBe('g81')
    expect(resolveDrillCycleMode({ dialect: 'generic_mm' })).toBe('g81')
  })

  it('honors explicit operation param override', () => {
    expect(resolveDrillCycleMode({ dialect: 'grbl', operationParams: { drillCycle: 'g83', peckMm: 1 } })).toBe('g83')
    expect(resolveDrillCycleMode({ dialect: 'mach3', operationParams: { drillCycle: 'g82', dwellMs: 250 } })).toBe('g82')
    expect(resolveDrillCycleMode({ dialect: 'mach3', operationParams: { drillCycle: 'expanded' } })).toBe('expanded')
    expect(resolveDrillCycleMode({ dialect: 'mach3', operationParams: { drillCycle: 'g73', peckMm: 0.5 } })).toBe('g73')
    expect(resolveDrillCycleMode({ dialect: 'grbl', operationParams: { drillCycle: 'g73', peckMm: 0.5 } })).toBe('g73')
  })

  it('infers cycle from peck/dwell params when cycle is not explicitly set', () => {
    expect(resolveDrillCycleMode({ dialect: 'mach3', operationParams: { peckMm: 1 } })).toBe('g83')
    expect(resolveDrillCycleMode({ dialect: 'mach3', operationParams: { dwellMs: 250 } })).toBe('g82')
    expect(resolveDrillCycleMode({ dialect: 'mach3', operationParams: { peckMm: 1, dwellMs: 250 } })).toBe('g83')
    // grbl keeps expanded fallback unless operator explicitly picks a canned cycle.
    expect(resolveDrillCycleMode({ dialect: 'grbl', operationParams: { peckMm: 1 } })).toBe('expanded')
  })
})

describe('resolveDrillCycleDecision', () => {
  it('returns mode plus explanatory hint', () => {
    expect(resolveDrillCycleDecision({ dialect: 'mach3', operationParams: { drillCycle: 'g82', dwellMs: 250 } })).toEqual({
      mode: 'g82',
      hint: 'Drill cycle: using explicit override (G82).'
    })
    expect(resolveDrillCycleDecision({ dialect: 'mach3', operationParams: { peckMm: 1 } })).toEqual({
      mode: 'g83',
      hint: 'Drill cycle: auto-selected G83 from peckMm (1).'
    })
    expect(resolveDrillCycleDecision({ dialect: 'grbl' })).toEqual({
      mode: 'expanded',
      hint: 'Drill cycle: grbl defaulted to expanded (G0/G1) unless you explicitly choose a canned cycle.'
    })
    expect(resolveDrillCycleDecision({ dialect: 'mach3', operationParams: { drillCycle: 'g73', peckMm: 0.5 } })).toEqual({
      mode: 'g73',
      hint: 'Drill cycle: using explicit override (G73).'
    })
  })

  it('falls back to G81 when explicit canned cycle params are missing', () => {
    expect(resolveDrillCycleDecision({ dialect: 'mach3', operationParams: { drillCycle: 'g83' } })).toEqual({
      mode: 'g81',
      hint: 'Drill cycle: requested G83 but peckMm is missing/invalid; falling back to G81.'
    })
    expect(resolveDrillCycleDecision({ dialect: 'mach3', operationParams: { drillCycle: 'g82' } })).toEqual({
      mode: 'g81',
      hint: 'Drill cycle: requested G82 but dwellMs is missing/invalid; falling back to G81.'
    })
    expect(resolveDrillCycleDecision({ dialect: 'mach3', operationParams: { drillCycle: 'g73' } })).toEqual({
      mode: 'g81',
      hint: 'Drill cycle: requested G73 but peckMm is missing/invalid; falling back to G81.'
    })
  })

  it('does not auto-select G73 (requires explicit choice)', () => {
    // Even with peckMm set, auto-selection picks G83 not G73
    expect(resolveDrillCycleDecision({ dialect: 'mach3', operationParams: { peckMm: 1 } })).toEqual({
      mode: 'g83',
      hint: 'Drill cycle: auto-selected G83 from peckMm (1).'
    })
    // G73 only available via explicit drillCycle override
    expect(resolveDrillCycleDecision({ dialect: 'mach3', operationParams: { drillCycle: 'g73', peckMm: 1 } }).mode).toBe('g73')
  })
})

describe('validate2dOperationGeometry', () => {
  it('requires contourPoints for contour/pocket', () => {
    const missing = validate2dOperationGeometry('cnc_contour', {})
    expect(missing.ok).toBe(false)
    if (!missing.ok) {
      expect(missing.error).toMatch(/missing/i)
      expect(missing.hint).toMatch(/contourPoints/i)
    }
    expect(validate2dOperationGeometry('cnc_pocket', { contourPoints: [[0, 0], [10, 0], [10, 5]] }).ok).toBe(true)
  })

  it('requires drillPoints for drill', () => {
    const missing = validate2dOperationGeometry('cnc_drill', {})
    expect(missing.ok).toBe(false)
    if (!missing.ok) {
      expect(missing.error).toMatch(/missing/i)
      expect(missing.hint).toMatch(/drillPoints/i)
    }
    expect(validate2dOperationGeometry('cnc_drill', { drillPoints: [[0, 0]] }).ok).toBe(true)
  })

  it('hard-fails invalid 2D geometry payloads with actionable hints', () => {
    const badContour = validate2dOperationGeometry('cnc_contour', { contourPoints: [['x', 0], [1, 2], [3, 4]] })
    expect(badContour.ok).toBe(false)
    if (!badContour.ok) {
      expect(badContour.error).toMatch(/invalid|incomplete/i)
      expect(badContour.hint).toMatch(/valid|numeric|points/i)
    }
    expect(validate2dOperationGeometry('cnc_pocket', { contourPoints: [[0, 0], [1], [2, 2]] }).ok).toBe(false)
    const badDrill = validate2dOperationGeometry('cnc_drill', { drillPoints: [[0, 'y']] })
    expect(badDrill.ok).toBe(false)
    if (!badDrill.ok) {
      expect(badDrill.error).toMatch(/invalid/i)
      expect(badDrill.hint).toMatch(/drillPoints/i)
    }
  })

  it('returns ok=true for non-contour/pocket/drill operation kinds', () => {
    // cnc_parallel, undefined, and other STL-based ops bypass 2D geometry validation
    expect(validate2dOperationGeometry('cnc_parallel', {}).ok).toBe(true)
    expect(validate2dOperationGeometry(undefined, {}).ok).toBe(true)
    expect(validate2dOperationGeometry('cnc_raster', {}).ok).toBe(true)
    expect(validate2dOperationGeometry('cnc_4axis_roughing', {}).ok).toBe(true)
  })

  it('fails with distinct hint when contour has exactly 2 valid points (too few, none invalid)', () => {
    // 2 valid points — rawCount == contour.length == 2, so hint differs from the "some invalid" branch
    const r = validate2dOperationGeometry('cnc_contour', { contourPoints: [[0, 0], [10, 0]] })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      // Should warn about needing at least 3, not about invalid entries
      expect(r.hint).toMatch(/at least three|three valid/i)
    }
  })
})

describe('resolveContourPathOptions', () => {
  it('defaults to climb with zero leads and linear mode', () => {
    expect(resolveContourPathOptions()).toEqual({
      contourSide: 'climb', leadInMm: 0, leadOutMm: 0,
      leadInMode: 'linear', leadOutMode: 'linear'
    })
  })

  it('parses side and clamps leads nonnegative', () => {
    expect(resolveContourPathOptions({ contourSide: 'conventional', leadInMm: 1.2, leadOutMm: -2 })).toEqual({
      contourSide: 'conventional',
      leadInMm: 1.2,
      leadOutMm: 0,
      leadInMode: 'linear',
      leadOutMode: 'linear'
    })
  })

  it('parses arc lead-in/out modes', () => {
    expect(resolveContourPathOptions({ leadInMode: 'arc', leadOutMode: 'arc', leadInMm: 3 })).toMatchObject({
      leadInMode: 'arc',
      leadOutMode: 'arc',
      leadInMm: 3
    })
  })

  it('defaults unknown lead mode strings to linear', () => {
    expect(resolveContourPathOptions({ leadInMode: 'spiral' })).toMatchObject({
      leadInMode: 'linear'
    })
  })
})

describe('shouldAppendFinalPocketFinishPass', () => {
  it('only appends a final finish pass when enabled and not finishing each depth', () => {
    expect(shouldAppendFinalPocketFinishPass({ finishPass: true, finishEachDepth: false })).toBe(true)
    expect(shouldAppendFinalPocketFinishPass({ finishPass: true, finishEachDepth: true })).toBe(false)
    expect(shouldAppendFinalPocketFinishPass({ finishPass: false, finishEachDepth: false })).toBe(false)
    expect(shouldAppendFinalPocketFinishPass({ finishPass: false, finishEachDepth: true })).toBe(false)
  })
})

describe('manufactureKindUsesAdvancedStrategy', () => {
  it('maps cnc_adaptive and cnc_3d_rough to adaptive_clear', () => {
    expect(manufactureKindUsesAdvancedStrategy('cnc_adaptive')).toBe('adaptive_clear')
    expect(manufactureKindUsesAdvancedStrategy('cnc_3d_rough')).toBe('adaptive_clear')
  })

  it('maps cnc_waterline to waterline', () => {
    expect(manufactureKindUsesAdvancedStrategy('cnc_waterline')).toBe('waterline')
  })

  it('maps cnc_raster and cnc_3d_finish to raster', () => {
    expect(manufactureKindUsesAdvancedStrategy('cnc_raster')).toBe('raster')
    expect(manufactureKindUsesAdvancedStrategy('cnc_3d_finish')).toBe('raster')
  })

  it('maps cnc_pencil to pencil', () => {
    expect(manufactureKindUsesAdvancedStrategy('cnc_pencil')).toBe('pencil')
  })

  it('returns null for cnc_parallel (uses built-in finish, no Python needed)', () => {
    expect(manufactureKindUsesAdvancedStrategy('cnc_parallel')).toBeNull()
  })

  it('returns null for unknown kinds and undefined', () => {
    expect(manufactureKindUsesAdvancedStrategy('cnc_contour')).toBeNull()
    expect(manufactureKindUsesAdvancedStrategy('cnc_pocket')).toBeNull()
    expect(manufactureKindUsesAdvancedStrategy(undefined)).toBeNull()
  })
})

describe('manufactureKindUsesToolpathEngine', () => {
  it('maps new 3-axis toolpath engine strategies', () => {
    expect(manufactureKindUsesToolpathEngine('cnc_spiral_finish')).toBe('spiral_finish')
    expect(manufactureKindUsesToolpathEngine('cnc_morphing_finish')).toBe('morphing_finish')
    expect(manufactureKindUsesToolpathEngine('cnc_trochoidal_hsm')).toBe('trochoidal_hsm')
    expect(manufactureKindUsesToolpathEngine('cnc_steep_shallow')).toBe('steep_shallow')
    expect(manufactureKindUsesToolpathEngine('cnc_scallop_finish')).toBe('scallop')
  })

  it('maps 4-axis and 5-axis toolpath engine strategies', () => {
    expect(manufactureKindUsesToolpathEngine('cnc_4axis_continuous')).toBe('4axis_continuous')
    expect(manufactureKindUsesToolpathEngine('cnc_5axis_contour')).toBe('5axis_contour')
    expect(manufactureKindUsesToolpathEngine('cnc_5axis_swarf')).toBe('5axis_swarf')
    expect(manufactureKindUsesToolpathEngine('cnc_5axis_flowline')).toBe('5axis_flowline')
    expect(manufactureKindUsesToolpathEngine('cnc_auto_select')).toBe('auto')
  })

  it('also routes legacy strategies through toolpath engine', () => {
    expect(manufactureKindUsesToolpathEngine('cnc_adaptive')).toBe('adaptive_clear')
    expect(manufactureKindUsesToolpathEngine('cnc_3d_rough')).toBe('adaptive_clear')
    expect(manufactureKindUsesToolpathEngine('cnc_waterline')).toBe('waterline')
    expect(manufactureKindUsesToolpathEngine('cnc_raster')).toBe('raster')
    expect(manufactureKindUsesToolpathEngine('cnc_pencil')).toBe('pencil')
  })

  it('returns null for non-engine kinds and undefined', () => {
    expect(manufactureKindUsesToolpathEngine('cnc_parallel')).toBeNull()
    expect(manufactureKindUsesToolpathEngine('cnc_contour')).toBeNull()
    expect(manufactureKindUsesToolpathEngine('cnc_drill')).toBeNull()
    expect(manufactureKindUsesToolpathEngine(undefined)).toBeNull()
  })
})

describe('manufactureKindUses4AxisEngine', () => {
  it('returns true for all 4-axis TS engine kinds', () => {
    expect(manufactureKindUses4AxisEngine('cnc_4axis_roughing')).toBe(true)
    expect(manufactureKindUses4AxisEngine('cnc_4axis_finishing')).toBe(true)
    expect(manufactureKindUses4AxisEngine('cnc_4axis_contour')).toBe(true)
    expect(manufactureKindUses4AxisEngine('cnc_4axis_indexed')).toBe(true)
    expect(manufactureKindUses4AxisEngine('cnc_4axis_continuous')).toBe(true)
  })

  it('returns false for non-4-axis kinds', () => {
    expect(manufactureKindUses4AxisEngine('cnc_parallel')).toBe(false)
    expect(manufactureKindUses4AxisEngine('cnc_adaptive')).toBe(false)
    expect(manufactureKindUses4AxisEngine('cnc_5axis_contour')).toBe(false)
    expect(manufactureKindUses4AxisEngine('cnc_raster')).toBe(false)
    expect(manufactureKindUses4AxisEngine(undefined)).toBe(false)
  })
})
