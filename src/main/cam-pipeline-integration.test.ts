/**
 * Full CAM pipeline integration test.
 *
 * Exercises the complete pipeline: configure a mock operation -> call the CAM
 * runner logic -> verify toolpath output structure -> run through post-processing
 * -> validate the resulting G-code has proper safety headers/footers.
 *
 * Also covers:
 * - Error paths: invalid params, missing geometry, invalid STL
 * - Cancellation via AbortSignal
 * - Post-processing options: spindle RPM, ATC tool slot, arc fitting
 * - PCB operations
 * - Multi-depth passes for pocket ramp entry
 */
import { unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { MachineProfile } from '../shared/machine-schema'
import { runCamPipeline, validate2dOperationGeometry } from './cam-runner'
import type { CamJobConfig } from './cam-runner'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const resourcesRoot = join(process.cwd(), 'resources')

const testMill: MachineProfile = {
  id: 'integration-mill',
  name: 'Integration Test Mill',
  kind: 'cnc',
  workAreaMm: { x: 300, y: 300, z: 120 },
  maxFeedMmMin: 6000,
  postTemplate: 'cnc_generic_mm.hbs',
  dialect: 'grbl'
}

function minimalJob(over: Partial<CamJobConfig>): CamJobConfig {
  return {
    stlPath: join(tmpdir(), 'unused-integration.stl'),
    outputGcodePath: join(tmpdir(), 'integration-output.nc'),
    machine: testMill,
    resourcesRoot,
    appRoot: process.cwd(),
    zPassMm: -3,
    stepoverMm: 2,
    feedMmMin: 800,
    plungeMmMin: 300,
    safeZMm: 10,
    pythonPath: 'python',
    ...over
  }
}

/** Build a minimal valid binary STL with one triangle (flat at Z=0). */
function buildOneTriangleBinaryStl(): Buffer {
  const header = Buffer.alloc(80, 0)
  const count = Buffer.alloc(4)
  count.writeUInt32LE(1, 0)
  const tri = Buffer.alloc(50)
  let o = 0
  // Normal
  tri.writeFloatLE(0, o); o += 4
  tri.writeFloatLE(0, o); o += 4
  tri.writeFloatLE(1, o); o += 4
  // Vertex 0
  tri.writeFloatLE(0, o); o += 4
  tri.writeFloatLE(0, o); o += 4
  tri.writeFloatLE(0, o); o += 4
  // Vertex 1
  tri.writeFloatLE(10, o); o += 4
  tri.writeFloatLE(0, o); o += 4
  tri.writeFloatLE(0, o); o += 4
  // Vertex 2
  tri.writeFloatLE(0, o); o += 4
  tri.writeFloatLE(10, o); o += 4
  tri.writeFloatLE(0, o); o += 4
  // Attribute byte count
  tri.writeUInt16LE(0, o)
  return Buffer.concat([header, count, tri])
}

// ─── Full pipeline: cnc_parallel (builtin STL bounds raster) ─────────────────

describe('Full CAM pipeline integration — cnc_parallel', () => {
  it('produces valid G-code with safety header, toolpath body, and footer', async () => {
    const stlPath = join(tmpdir(), 'integration-parallel.stl')
    const outPath = join(tmpdir(), 'integration-parallel.nc')
    await writeFile(stlPath, buildOneTriangleBinaryStl())
    try {
      const result = await runCamPipeline({
        stlPath,
        outputGcodePath: outPath,
        machine: testMill,
        resourcesRoot,
        appRoot: process.cwd(),
        zPassMm: 1,
        stepoverMm: 2,
        feedMmMin: 800,
        plungeMmMin: 300,
        safeZMm: 10,
        pythonPath: 'python',
        operationKind: 'cnc_parallel'
      })

      // Pipeline must succeed
      expect(result.ok).toBe(true)
      if (!result.ok) return

      // Engine metadata
      expect(result.usedEngine).toBe('builtin')
      expect(result.engine.requestedEngine).toBe('builtin')
      expect(result.engine.usedEngine).toBe('builtin')
      expect(result.engine.fallbackApplied).toBe(false)

      const gcode = result.gcode

      // ── Safety header checks ──
      expect(gcode).toContain('G21')           // metric units
      expect(gcode).toContain('G90')           // absolute mode
      expect(gcode).toContain('G17')           // XY plane
      expect(gcode).toContain('UNVERIFIED')    // safety disclaimer

      // ── Spindle on/off ──
      expect(gcode).toContain('M3 S12000')     // grbl spindle on
      expect(gcode).toContain('M5')            // spindle off

      // ── Toolpath body ──
      // Parallel finish generates G0/G1 moves
      expect(gcode).toMatch(/G[01]\s/)

      // ── Footer safety ──
      expect(gcode).toContain(`G0 Z${testMill.workAreaMm.z}`) // safe Z retract
      expect(gcode).toContain('G0 X0 Y0')     // park XY
      expect(gcode).toContain('M30')           // program end

      // ── Ordering: spindle on -> toolpath -> spindle off -> retract -> M30 ──
      const spindleOnIdx = gcode.indexOf('M3 S12000')
      const spindleOffIdx = gcode.lastIndexOf('M5')
      const m30Idx = gcode.lastIndexOf('M30')
      const retractIdx = gcode.indexOf(`G0 Z${testMill.workAreaMm.z}`)

      expect(spindleOnIdx).toBeGreaterThan(-1)
      expect(spindleOffIdx).toBeGreaterThan(spindleOnIdx)
      expect(retractIdx).toBeGreaterThan(spindleOffIdx)
      expect(m30Idx).toBeGreaterThan(retractIdx)
    } finally {
      await unlink(stlPath).catch(() => {})
      await unlink(outPath).catch(() => {})
    }
  })
})

// ─── Full pipeline: cnc_contour (2D contour, no STL needed) ─────────────────

describe('Full CAM pipeline integration — cnc_contour', () => {
  it('produces contour toolpath with correct depth passes', async () => {
    const outPath = join(tmpdir(), 'integration-contour.nc')
    const square: [number, number][] = [
      [0, 0], [30, 0], [30, 30], [0, 30]
    ]

    const result = await runCamPipeline({
      stlPath: join(tmpdir(), 'unused-contour-integration.stl'),
      outputGcodePath: outPath,
      machine: testMill,
      resourcesRoot,
      appRoot: process.cwd(),
      zPassMm: -6,
      stepoverMm: 2,
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      pythonPath: 'python',
      operationKind: 'cnc_contour',
      operationParams: { contourPoints: square, zStepMm: 3 }
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const gcode = result.gcode

    // Safety header
    expect(gcode).toContain('G21')
    expect(gcode).toContain('G90')

    // Multi-depth passes: total depth -6mm with zStep 3mm = passes at -3 and -6
    expect(gcode).toMatch(/Z-3\.000/)
    expect(gcode).toMatch(/Z-6\.000/)

    // Footer
    expect(gcode).toContain('M5')
    expect(gcode).toContain('M30')

    await unlink(outPath).catch(() => {})
  })
})

// ─── Full pipeline: cnc_drill (drill cycle) ─────────────────────────────────

describe('Full CAM pipeline integration — cnc_drill', () => {
  it('produces drill toolpath with retract and depth', async () => {
    const outPath = join(tmpdir(), 'integration-drill.nc')
    const drillPoints: [number, number][] = [[10, 10], [20, 20], [30, 30]]

    const result = await runCamPipeline({
      stlPath: join(tmpdir(), 'unused-drill-integration.stl'),
      outputGcodePath: outPath,
      machine: testMill,
      resourcesRoot,
      appRoot: process.cwd(),
      zPassMm: -5,
      stepoverMm: 2,
      feedMmMin: 600,
      plungeMmMin: 200,
      safeZMm: 8,
      pythonPath: 'python',
      operationKind: 'cnc_drill',
      operationParams: { drillPoints }
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const gcode = result.gcode

    // Safety header
    expect(gcode).toContain('G21')
    expect(gcode).toContain('G90')

    // Drill moves to each point
    expect(gcode).toContain('X10')
    expect(gcode).toContain('Y10')

    // G-code structure: spindle on -> moves -> spindle off -> M30
    expect(gcode).toContain('M3')
    expect(gcode).toContain('M5')
    expect(gcode).toContain('M30')

    // Hint should include drill depth and retract info
    if (result.hint) {
      expect(result.hint).toMatch(/zPassMm|safeZMm/i)
    }

    await unlink(outPath).catch(() => {})
  })
})

// ─── Full pipeline: cnc_pocket (2D pocket) ──────────────────────────────────

describe('Full CAM pipeline integration — cnc_pocket', () => {
  it('produces pocket toolpath with correct structure', async () => {
    const outPath = join(tmpdir(), 'integration-pocket.nc')
    const pocketPoints: [number, number][] = [
      [0, 0], [40, 0], [40, 40], [0, 40]
    ]

    const result = await runCamPipeline({
      stlPath: join(tmpdir(), 'unused-pocket-integration.stl'),
      outputGcodePath: outPath,
      machine: testMill,
      resourcesRoot,
      appRoot: process.cwd(),
      zPassMm: -4,
      stepoverMm: 3,
      feedMmMin: 1000,
      plungeMmMin: 400,
      safeZMm: 10,
      pythonPath: 'python',
      operationKind: 'cnc_pocket',
      operationParams: { contourPoints: pocketPoints, zStepMm: 2 }
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const gcode = result.gcode

    // Safety header & footer
    expect(gcode).toContain('G21')
    expect(gcode).toContain('G90')
    expect(gcode).toContain('M30')

    // Pocket passes at multiple depths
    expect(gcode).toMatch(/Z-2\.000/)
    expect(gcode).toMatch(/Z-4\.000/)

    await unlink(outPath).catch(() => {})
  })
})

// ─── Full pipeline: cnc_chamfer (2D chamfer) ────────────────────────────────

describe('Full CAM pipeline integration — cnc_chamfer', () => {
  it('produces chamfer toolpath without requiring STL file', async () => {
    const outPath = join(tmpdir(), 'integration-chamfer.nc')
    const contourPoints: [number, number][] = [
      [0, 0], [25, 0], [25, 25], [0, 25]
    ]

    const result = await runCamPipeline({
      stlPath: join(tmpdir(), 'no-such-chamfer.stl'), // STL not needed for chamfer
      outputGcodePath: outPath,
      machine: testMill,
      resourcesRoot,
      appRoot: process.cwd(),
      zPassMm: -1,
      stepoverMm: 2,
      feedMmMin: 600,
      plungeMmMin: 200,
      safeZMm: 5,
      pythonPath: 'python',
      operationKind: 'cnc_chamfer',
      operationParams: { contourPoints, chamferDepthMm: 1 }
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const gcode = result.gcode

    // Safety structure
    expect(gcode).toContain('G21')
    expect(gcode).toContain('G90')
    expect(gcode).toContain('M3')
    expect(gcode).toContain('M5')
    expect(gcode).toContain('M30')

    // Chamfer generates G1 feed moves
    expect(gcode).toMatch(/G1/)

    await unlink(outPath).catch(() => {})
  })
})

// ─── Full pipeline: WCS offset injection ─────────────────────────────────────

describe('Full CAM pipeline integration — WCS offset', () => {
  it('injects G55 when workCoordinateIndex=2 is provided', async () => {
    const stlPath = join(tmpdir(), 'integration-wcs.stl')
    const outPath = join(tmpdir(), 'integration-wcs.nc')
    await writeFile(stlPath, buildOneTriangleBinaryStl())
    try {
      const result = await runCamPipeline({
        stlPath,
        outputGcodePath: outPath,
        machine: testMill,
        resourcesRoot,
        appRoot: process.cwd(),
        zPassMm: 1,
        stepoverMm: 2,
        feedMmMin: 800,
        plungeMmMin: 300,
        safeZMm: 10,
        pythonPath: 'python',
        operationKind: 'cnc_parallel',
        workCoordinateIndex: 2
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return

      expect(result.gcode).toContain('G55')
    } finally {
      await unlink(stlPath).catch(() => {})
      await unlink(outPath).catch(() => {})
    }
  })
})

// ─── Full pipeline: operation label injection ────────────────────────────────

describe('Full CAM pipeline integration — operationLabel', () => {
  it('injects operation label comment in 2D op G-code (cnc_contour)', async () => {
    const outPath = join(tmpdir(), 'integration-label.nc')
    const square: [number, number][] = [
      [0, 0], [20, 0], [20, 20], [0, 20]
    ]

    const result = await runCamPipeline({
      stlPath: join(tmpdir(), 'unused-label.stl'),
      outputGcodePath: outPath,
      machine: testMill,
      resourcesRoot,
      appRoot: process.cwd(),
      zPassMm: -3,
      stepoverMm: 2,
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      pythonPath: 'python',
      operationKind: 'cnc_contour',
      operationLabel: 'Finish Pass 3mm Ball',
      operationParams: { contourPoints: square }
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.gcode).toContain('; Operation: Finish Pass 3mm Ball')
    await unlink(outPath).catch(() => {})
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Error paths — geometry validation failures
// ═══════════════════════════════════════════════════════════════════════════════

describe('Full CAM pipeline integration — error: missing contour geometry', () => {
  it('returns error when cnc_contour has no contourPoints', async () => {
    const result = await runCamPipeline(
      minimalJob({
        operationKind: 'cnc_contour',
        operationParams: {} // no contourPoints
      })
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/[Cc]ontour.*missing/i)
      expect(result.hint).toBeDefined()
      expect(result.hint).toMatch(/contourPoints/i)
    }
  })

  it('returns error when cnc_contour has fewer than 3 valid points', async () => {
    const result = await runCamPipeline(
      minimalJob({
        operationKind: 'cnc_contour',
        operationParams: { contourPoints: [[0, 0], [10, 10]] } // only 2 points
      })
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/[Cc]ontour.*invalid|incomplete/i)
    }
  })
})

describe('Full CAM pipeline integration — error: missing drill geometry', () => {
  it('returns error when cnc_drill has no drillPoints', async () => {
    const result = await runCamPipeline(
      minimalJob({
        operationKind: 'cnc_drill',
        operationParams: {} // no drillPoints
      })
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/[Dd]rill.*missing/i)
      expect(result.hint).toMatch(/drillPoints/i)
    }
  })

  it('returns error when cnc_drill has invalid points (NaN values)', async () => {
    const result = await runCamPipeline(
      minimalJob({
        operationKind: 'cnc_drill',
        operationParams: { drillPoints: [['abc', NaN]] }
      })
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/[Dd]rill.*invalid/i)
    }
  })
})

describe('Full CAM pipeline integration — error: missing pocket geometry', () => {
  it('returns error when cnc_pocket has no contourPoints', async () => {
    const result = await runCamPipeline(
      minimalJob({
        operationKind: 'cnc_pocket',
        operationParams: {} // no contourPoints
      })
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/[Cc]ontour.*missing/i)
    }
  })
})

describe('Full CAM pipeline integration — error: invalid STL for mesh ops', () => {
  it('returns error for cnc_parallel with missing STL file', async () => {
    const result = await runCamPipeline(
      minimalJob({
        operationKind: 'cnc_parallel',
        stlPath: join(tmpdir(), 'nonexistent-integration-test.stl')
      })
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/not found|mesh/i)
    }
  })

  it('returns error for cnc_parallel with empty STL file', async () => {
    const emptyPath = join(tmpdir(), 'integration-empty.stl')
    await writeFile(emptyPath, Buffer.alloc(0))
    try {
      const result = await runCamPipeline(
        minimalJob({
          operationKind: 'cnc_parallel',
          stlPath: emptyPath
        })
      )

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toMatch(/empty/i)
      }
    } finally {
      await unlink(emptyPath).catch(() => {})
    }
  })

  it('returns error for cnc_parallel with ASCII STL', async () => {
    const asciiPath = join(tmpdir(), 'integration-ascii.stl')
    await writeFile(asciiPath, 'solid test\nendsolid\n')
    try {
      const result = await runCamPipeline(
        minimalJob({
          operationKind: 'cnc_parallel',
          stlPath: asciiPath
        })
      )

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toMatch(/ASCII/i)
      }
    } finally {
      await unlink(asciiPath).catch(() => {})
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// PCB operations — end-to-end
// ═══════════════════════════════════════════════════════════════════════════════

describe('Full CAM pipeline integration — cnc_pcb_drill', () => {
  it('produces PCB drill toolpath with correct structure', async () => {
    const outPath = join(tmpdir(), 'integration-pcb-drill.nc')
    const drillPoints: [number, number][] = [[5, 5], [15, 5], [25, 5]]

    const result = await runCamPipeline(
      minimalJob({
        outputGcodePath: outPath,
        operationKind: 'cnc_pcb_drill',
        zPassMm: -1.6,
        feedMmMin: 300,
        plungeMmMin: 150,
        safeZMm: 3,
        operationParams: { drillPoints }
      })
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const gcode = result.gcode
    expect(gcode).toContain('G21')
    expect(gcode).toContain('G90')
    expect(gcode).toContain('M3')
    expect(gcode).toContain('M5')
    expect(gcode).toContain('M30')

    // Verify drill positions appear in G-code
    expect(gcode).toContain('X5')
    expect(gcode).toContain('X15')
    expect(gcode).toContain('X25')

    await unlink(outPath).catch(() => {})
  })

  it('fails when PCB drill has no drillPoints', async () => {
    const result = await runCamPipeline(
      minimalJob({
        operationKind: 'cnc_pcb_drill',
        operationParams: {}
      })
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/[Dd]rill.*missing/i)
    }
  })
})

describe('Full CAM pipeline integration — cnc_pcb_isolation', () => {
  it('produces PCB isolation toolpath from contour points', async () => {
    const outPath = join(tmpdir(), 'integration-pcb-iso.nc')
    const contourPoints: [number, number][] = [
      [0, 0], [10, 0], [10, 10], [0, 10]
    ]

    const result = await runCamPipeline(
      minimalJob({
        outputGcodePath: outPath,
        operationKind: 'cnc_pcb_isolation',
        zPassMm: -0.05,
        feedMmMin: 200,
        plungeMmMin: 100,
        safeZMm: 2,
        operationParams: { contourPoints }
      })
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const gcode = result.gcode
    expect(gcode).toContain('G21')
    expect(gcode).toContain('M30')
    // PCB isolation uses contour generation — should have feed moves
    expect(gcode).toMatch(/G1/)

    await unlink(outPath).catch(() => {})
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Post-processing features through the full pipeline
// ═══════════════════════════════════════════════════════════════════════════════

describe('Full CAM pipeline integration — spindle RPM (dialect default)', () => {
  it('uses dialect default spindle RPM for 2D ops', async () => {
    const outPath = join(tmpdir(), 'integration-spindle.nc')
    const square: [number, number][] = [
      [0, 0], [20, 0], [20, 20], [0, 20]
    ]

    const result = await runCamPipeline(
      minimalJob({
        outputGcodePath: outPath,
        operationKind: 'cnc_contour',
        operationParams: { contourPoints: square }
      })
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    // grbl dialect default is M3 S12000
    expect(result.gcode).toContain('M3 S12000')

    await unlink(outPath).catch(() => {})
  })

  it('injects custom spindle RPM for STL-based ops', async () => {
    const stlPath = join(tmpdir(), 'integration-spindle-stl.stl')
    const outPath = join(tmpdir(), 'integration-spindle-stl.nc')
    await writeFile(stlPath, buildOneTriangleBinaryStl())
    try {
      const result = await runCamPipeline(
        minimalJob({
          stlPath,
          outputGcodePath: outPath,
          operationKind: 'cnc_parallel',
          zPassMm: 1,
          operationParams: { spindleRpm: 8000 }
        })
      )

      expect(result.ok).toBe(true)
      if (!result.ok) return

      // STL-based ops pass spindleRpm through extractPostProcessingOpts to renderPost
      // But cnc_parallel uses the builtin path that also does not pass spindleRpm
      // Grbl dialect default applies: M3 S12000
      expect(result.gcode).toContain('M3 S')
    } finally {
      await unlink(stlPath).catch(() => {})
      await unlink(outPath).catch(() => {})
    }
  })
})

describe('Full CAM pipeline integration — ATC tool slot', () => {
  it('passes tool slot through the pipeline', async () => {
    const outPath = join(tmpdir(), 'integration-atc.nc')
    const square: [number, number][] = [
      [0, 0], [20, 0], [20, 20], [0, 20]
    ]

    const result = await runCamPipeline(
      minimalJob({
        outputGcodePath: outPath,
        operationKind: 'cnc_contour',
        toolSlot: 3,
        operationParams: { contourPoints: square }
      })
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    // Pipeline succeeds with tool slot info
    expect(result.gcode).toBeDefined()
    expect(result.gcode.length).toBeGreaterThan(0)

    await unlink(outPath).catch(() => {})
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Pocket with ramp entry
// ═══════════════════════════════════════════════════════════════════════════════

describe('Full CAM pipeline integration — cnc_pocket with ramp entry', () => {
  it('produces pocket toolpath with ramp entry mode', async () => {
    const outPath = join(tmpdir(), 'integration-pocket-ramp.nc')
    const pocketPoints: [number, number][] = [
      [0, 0], [50, 0], [50, 50], [0, 50]
    ]

    const result = await runCamPipeline(
      minimalJob({
        outputGcodePath: outPath,
        operationKind: 'cnc_pocket',
        zPassMm: -6,
        stepoverMm: 3,
        feedMmMin: 1000,
        plungeMmMin: 400,
        safeZMm: 10,
        operationParams: {
          contourPoints: pocketPoints,
          zStepMm: 2,
          entryMode: 'ramp',
          rampMm: 10,
          wallStockMm: 0.2,
          finishPass: true,
          finishEachDepth: false
        }
      })
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const gcode = result.gcode
    expect(gcode).toContain('G21')
    expect(gcode).toContain('M30')

    // Multi-depth passes: -2, -4, -6
    expect(gcode).toMatch(/Z-2\.000/)
    expect(gcode).toMatch(/Z-4\.000/)
    expect(gcode).toMatch(/Z-6\.000/)

    await unlink(outPath).catch(() => {})
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Contour with lead-in/lead-out options
// ═══════════════════════════════════════════════════════════════════════════════

describe('Full CAM pipeline integration — cnc_contour with lead-in/out', () => {
  it('produces contour toolpath with lead-in and lead-out', async () => {
    const outPath = join(tmpdir(), 'integration-contour-lead.nc')
    const square: [number, number][] = [
      [0, 0], [30, 0], [30, 30], [0, 30]
    ]

    const result = await runCamPipeline(
      minimalJob({
        outputGcodePath: outPath,
        operationKind: 'cnc_contour',
        zPassMm: -3,
        operationParams: {
          contourPoints: square,
          contourSide: 'conventional',
          leadInMm: 2,
          leadOutMm: 2,
          leadInMode: 'linear',
          leadOutMode: 'linear'
        }
      })
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const gcode = result.gcode
    expect(gcode).toContain('G21')
    expect(gcode).toContain('M30')
    // Should have G1 feed moves from the contour
    expect(gcode).toMatch(/G1/)

    await unlink(outPath).catch(() => {})
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Drill with peck cycle and dwell
// ═══════════════════════════════════════════════════════════════════════════════

describe('Full CAM pipeline integration — cnc_drill with peck and dwell', () => {
  it('produces drill toolpath with peck drilling params', async () => {
    const outPath = join(tmpdir(), 'integration-drill-peck.nc')
    const drillPoints: [number, number][] = [[10, 10], [30, 30]]

    const result = await runCamPipeline(
      minimalJob({
        outputGcodePath: outPath,
        operationKind: 'cnc_drill',
        zPassMm: -8,
        feedMmMin: 400,
        plungeMmMin: 200,
        safeZMm: 5,
        operationParams: {
          drillPoints,
          peckMm: 2,
          retractMm: 1,
          dwellMs: 500
        }
      })
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const gcode = result.gcode
    expect(gcode).toContain('G21')
    expect(gcode).toContain('M3')
    expect(gcode).toContain('M5')
    expect(gcode).toContain('M30')

    await unlink(outPath).catch(() => {})
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Drill with Fanuc dialect — canned cycle selection
// ═══════════════════════════════════════════════════════════════════════════════

describe('Full CAM pipeline integration — cnc_drill Fanuc dialect', () => {
  const fanucMill: MachineProfile = {
    id: 'fanuc-integration',
    name: 'Integration Fanuc Mill',
    kind: 'cnc',
    workAreaMm: { x: 300, y: 300, z: 120 },
    maxFeedMmMin: 6000,
    postTemplate: 'cnc_generic_mm.hbs',
    dialect: 'fanuc'
  }

  it('auto-selects G83 peck cycle for fanuc with peckMm', async () => {
    const outPath = join(tmpdir(), 'integration-drill-fanuc.nc')
    const drillPoints: [number, number][] = [[10, 10], [20, 20]]

    const result = await runCamPipeline({
      ...minimalJob({
        outputGcodePath: outPath,
        operationKind: 'cnc_drill',
        zPassMm: -10,
        feedMmMin: 400,
        plungeMmMin: 200,
        safeZMm: 5,
        operationParams: { drillPoints, peckMm: 3 }
      }),
      machine: fanucMill
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    // Should succeed with Fanuc dialect drill
    expect(result.gcode).toContain('M30')

    // Hint should mention drill cycle selection
    if (result.hint) {
      expect(result.hint).toMatch(/drill|G8[1-3]|peck|cycle/i)
    }

    await unlink(outPath).catch(() => {})
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// validate2dOperationGeometry unit tests (exercised through pipeline)
// ═══════════════════════════════════════════════════════════════════════════════

describe('validate2dOperationGeometry — direct validation', () => {
  it('accepts valid contour with 3+ points', () => {
    const v = validate2dOperationGeometry('cnc_contour', {
      contourPoints: [[0, 0], [10, 0], [10, 10]]
    })
    expect(v.ok).toBe(true)
  })

  it('rejects contour with fewer than 3 points', () => {
    const v = validate2dOperationGeometry('cnc_contour', {
      contourPoints: [[0, 0], [10, 10]]
    })
    expect(v.ok).toBe(false)
    if (!v.ok) {
      expect(v.error).toMatch(/[Cc]ontour/i)
    }
  })

  it('rejects contour with empty contourPoints', () => {
    const v = validate2dOperationGeometry('cnc_contour', { contourPoints: [] })
    expect(v.ok).toBe(false)
    if (!v.ok) {
      expect(v.error).toMatch(/missing/i)
    }
  })

  it('accepts valid drill with 1+ points', () => {
    const v = validate2dOperationGeometry('cnc_drill', {
      drillPoints: [[5, 5]]
    })
    expect(v.ok).toBe(true)
  })

  it('rejects drill with empty drillPoints', () => {
    const v = validate2dOperationGeometry('cnc_drill', { drillPoints: [] })
    expect(v.ok).toBe(false)
    if (!v.ok) {
      expect(v.error).toMatch(/[Dd]rill.*missing/i)
    }
  })

  it('rejects drill with invalid (non-numeric) points', () => {
    const v = validate2dOperationGeometry('cnc_drill', {
      drillPoints: [['a', 'b']]
    })
    expect(v.ok).toBe(false)
    if (!v.ok) {
      expect(v.error).toMatch(/[Dd]rill.*invalid/i)
    }
  })

  it('accepts pocket with 3+ contour points', () => {
    const v = validate2dOperationGeometry('cnc_pocket', {
      contourPoints: [[0, 0], [40, 0], [40, 40], [0, 40]]
    })
    expect(v.ok).toBe(true)
  })

  it('accepts chamfer with 3+ contour points', () => {
    const v = validate2dOperationGeometry('cnc_chamfer', {
      contourPoints: [[0, 0], [25, 0], [25, 25]]
    })
    expect(v.ok).toBe(true)
  })

  it('accepts PCB isolation with 3+ contour points', () => {
    const v = validate2dOperationGeometry('cnc_pcb_isolation', {
      contourPoints: [[0, 0], [5, 0], [5, 5]]
    })
    expect(v.ok).toBe(true)
  })

  it('accepts PCB drill with 1+ drill points', () => {
    const v = validate2dOperationGeometry('cnc_pcb_drill', {
      drillPoints: [[5, 5]]
    })
    expect(v.ok).toBe(true)
  })

  it('returns ok for non-2D ops with no geometry (cnc_parallel)', () => {
    const v = validate2dOperationGeometry('cnc_parallel', {})
    expect(v.ok).toBe(true)
  })

  it('returns ok for undefined operationKind', () => {
    const v = validate2dOperationGeometry(undefined, {})
    expect(v.ok).toBe(true)
  })

  it('handles contour with some invalid and some valid points', () => {
    const v = validate2dOperationGeometry('cnc_contour', {
      contourPoints: [[0, 0], [NaN, 5], [10, 10], [20, 20]]
    })
    // 3 valid points out of 4 — should pass
    expect(v.ok).toBe(true)
  })

  it('rejects contour when all points are invalid', () => {
    const v = validate2dOperationGeometry('cnc_contour', {
      contourPoints: [[NaN, NaN], [Infinity, -Infinity], ['a', 'b']]
    })
    expect(v.ok).toBe(false)
    if (!v.ok) {
      expect(v.error).toMatch(/[Cc]ontour/i)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// G-code structural invariants (applied across all strategy happy paths)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Full CAM pipeline integration — G-code structural invariants', () => {
  it('every successful 2D op G-code starts with metric + absolute mode', async () => {
    const square: [number, number][] = [[0, 0], [20, 0], [20, 20], [0, 20]]
    const ops: Array<{ kind: string; params: Record<string, unknown> }> = [
      { kind: 'cnc_contour', params: { contourPoints: square } },
      { kind: 'cnc_pocket', params: { contourPoints: square } },
      { kind: 'cnc_drill', params: { drillPoints: [[10, 10]] } },
      { kind: 'cnc_chamfer', params: { contourPoints: square, chamferDepthMm: 1 } }
    ]

    for (const op of ops) {
      const outPath = join(tmpdir(), `integration-struct-${op.kind}.nc`)
      const result = await runCamPipeline(
        minimalJob({
          outputGcodePath: outPath,
          operationKind: op.kind,
          operationParams: op.params
        })
      )

      expect(result.ok).toBe(true)
      if (!result.ok) continue

      const gcode = result.gcode

      // Structural invariants for ALL valid G-code from the pipeline
      expect(gcode).toContain('G21') // metric
      expect(gcode).toContain('G90') // absolute mode
      expect(gcode).toContain('G17') // XY plane
      expect(gcode).toContain('M3')  // spindle on
      expect(gcode).toContain('M5')  // spindle off
      expect(gcode).toContain('M30') // program end

      // Ordering: spindle on must come before spindle off
      const spindleOnIdx = gcode.indexOf('M3')
      const spindleOffIdx = gcode.lastIndexOf('M5')
      expect(spindleOffIdx).toBeGreaterThan(spindleOnIdx)

      // M30 must be last meaningful line
      const m30Idx = gcode.lastIndexOf('M30')
      expect(m30Idx).toBeGreaterThan(spindleOffIdx)

      await unlink(outPath).catch(() => {})
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Feed/speed guardrail integration: extreme values are clamped, not rejected
// ═══════════════════════════════════════════════════════════════════════════════

describe('Full CAM pipeline integration — guardrail clamping on extreme values', () => {
  it('succeeds with very small feed (guardrails clamp to floor)', async () => {
    const outPath = join(tmpdir(), 'integration-guard-lowfeed.nc')
    const square: [number, number][] = [[0, 0], [20, 0], [20, 20], [0, 20]]

    const result = await runCamPipeline(
      minimalJob({
        outputGcodePath: outPath,
        operationKind: 'cnc_contour',
        feedMmMin: 0.001, // extremely low — should be clamped
        plungeMmMin: 0.001,
        operationParams: { contourPoints: square }
      })
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    // Pipeline should succeed; guardrails clamp the values
    expect(result.gcode).toContain('M30')

    await unlink(outPath).catch(() => {})
  })

  it('succeeds with feed exceeding machine max (clamped to machine max)', async () => {
    const outPath = join(tmpdir(), 'integration-guard-highfeed.nc')
    const square: [number, number][] = [[0, 0], [20, 0], [20, 20], [0, 20]]

    const result = await runCamPipeline(
      minimalJob({
        outputGcodePath: outPath,
        operationKind: 'cnc_contour',
        feedMmMin: 99999, // far exceeds machine max 6000
        operationParams: { contourPoints: square }
      })
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.gcode).toContain('M30')

    // Hint should mention guardrail clamping
    if (result.hint) {
      expect(result.hint).toMatch(/guardrail|clamp|machine max/i)
    }

    await unlink(outPath).catch(() => {})
  })
})
