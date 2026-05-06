/**
 * Cycle 88 [ID-0174] -- paired-pin contract for `dispatch2dStrategy`
 * (`src/main/cam-runner-2d.ts`).
 *
 * Pins the 2D-strategy dispatcher's contract:
 *  - geometry-validation pass-through (delegates to validate2dOperationGeometry)
 *  - success-path G-code emission via real post-processor on Laguna Swift
 *    5x10 (RichAuto A-series mach3 dialect) and Makera Carvera 3-axis
 *    (smoothieware dialect)
 *  - multi-depth contour expansion via computeNegativeZDepthPasses
 *  - engine bookkeeping always reports builtin (no Python fallback for 2D)
 *  - PCB isolation/contour fall-through to contour generator
 *
 * Pure test-only cycle: zero production-code edits. Test fixtures hit
 * `resources/machines/laguna-swift-5x10.json` and
 * `resources/machines/makera-carvera-3axis.json` -- both are CLAUDE.md
 * "USER CONTEXT -- TARGET MACHINES" entries for the 2D CNC family.
 */
import { readFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { machineProfileSchema, type MachineProfile } from '../shared/machine-schema'
import { dispatch2dStrategy } from './cam-runner-2d'
import type { CamJobConfig } from './cam-runner'

const RESOURCES_ROOT = join(process.cwd(), 'resources')
const APP_ROOT = process.cwd()

async function loadMachine(
  filename: 'laguna-swift-5x10.json' | 'makera-carvera-3axis.json'
): Promise<MachineProfile> {
  const text = await readFile(join(RESOURCES_ROOT, 'machines', filename), 'utf-8')
  return machineProfileSchema.parse(JSON.parse(text))
}

let tmpCounter = 0
function tmpGcodePath(label: string): string {
  tmpCounter += 1
  return join(tmpdir(), `ufs-cam-2d-disp-${label}-${tmpCounter}-${Date.now()}.nc`)
}

const PASS_THROUGH_GUARD_HINT = ' [test-guard]'
function envelopeHint(machine: MachineProfile, _gcode: string): string {
  return ` [test-envelope:${machine.id}]`
}

function buildJob(
  overrides: Partial<CamJobConfig> & {
    machine: MachineProfile
    outputGcodePath: string
  }
): CamJobConfig {
  // Defaults are spread first; required overrides (machine, outputGcodePath)
  // and any caller-supplied overrides win via the second spread.
  return {
    stlPath: join(tmpdir(), 'unused-2d-disp.stl'),
    resourcesRoot: RESOURCES_ROOT,
    appRoot: APP_ROOT,
    zPassMm: -1,
    stepoverMm: 2,
    feedMmMin: 1500,
    plungeMmMin: 400,
    safeZMm: 5,
    pythonPath: 'python',
    operationKind: 'cnc_contour',
    ...overrides
  }
}

const SQUARE: [number, number][] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10]
]

describe('dispatch2dStrategy -- geometry-validation pass-through', () => {
  it('cnc_contour without contourPoints returns Contour geometry missing.', async () => {
    const machine = await loadMachine('laguna-swift-5x10.json')
    const out = tmpGcodePath('cnt-missing')
    const r = await dispatch2dStrategy(
      buildJob({
        machine,
        outputGcodePath: out,
        operationKind: 'cnc_contour',
        operationParams: {}
      }),
      PASS_THROUGH_GUARD_HINT,
      envelopeHint
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe('Contour geometry missing.')
      expect(r.hint).toMatch(/contourPoints/)
    }
    await unlink(out).catch(() => {})
  })

  it('cnc_pocket with 2-point degenerate contour returns Contour geometry invalid or incomplete.', async () => {
    const machine = await loadMachine('laguna-swift-5x10.json')
    const out = tmpGcodePath('pkt-degen')
    const r = await dispatch2dStrategy(
      buildJob({
        machine,
        outputGcodePath: out,
        operationKind: 'cnc_pocket',
        operationParams: { contourPoints: [[0, 0], [10, 0]] }
      }),
      PASS_THROUGH_GUARD_HINT,
      envelopeHint
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe('Contour geometry invalid or incomplete.')
    }
    await unlink(out).catch(() => {})
  })

  it('cnc_drill without drillPoints returns Drill geometry missing.', async () => {
    const machine = await loadMachine('makera-carvera-3axis.json')
    const out = tmpGcodePath('drl-missing')
    const r = await dispatch2dStrategy(
      buildJob({
        machine,
        outputGcodePath: out,
        operationKind: 'cnc_drill',
        operationParams: {}
      }),
      PASS_THROUGH_GUARD_HINT,
      envelopeHint
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe('Drill geometry missing.')
      expect(r.hint).toMatch(/drillPoints/)
    }
    await unlink(out).catch(() => {})
  })
})

describe('dispatch2dStrategy -- success paths emit G-code via real post-processor', () => {
  it('cnc_contour on Laguna Swift 5x10 returns ok with builtin engine and writes G-code', async () => {
    const machine = await loadMachine('laguna-swift-5x10.json')
    const out = tmpGcodePath('cnt-laguna-ok')
    const r = await dispatch2dStrategy(
      buildJob({
        machine,
        outputGcodePath: out,
        operationKind: 'cnc_contour',
        operationParams: { contourPoints: SQUARE }
      }),
      PASS_THROUGH_GUARD_HINT,
      envelopeHint
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.usedEngine).toBe('builtin')
      expect(r.engine.requestedEngine).toBe('builtin')
      expect(r.engine.fallbackApplied).toBe(false)
      expect(r.gcode.length).toBeGreaterThan(0)
      expect(r.hint).toMatch(/2D path posted/)
      expect(r.hint).toContain('[test-guard]')
      expect(r.hint).toContain('[test-envelope:laguna-swift-5x10]')
      // The on-disk file written by writeFile() must equal the returned gcode.
      const onDisk = await readFile(out, 'utf-8')
      expect(onDisk).toBe(r.gcode)
    }
    await unlink(out).catch(() => {})
  })

  it('cnc_drill on Makera Carvera 3-axis returns ok and merges drill safety hints', async () => {
    const machine = await loadMachine('makera-carvera-3axis.json')
    const out = tmpGcodePath('drl-carvera-ok')
    const r = await dispatch2dStrategy(
      buildJob({
        machine,
        outputGcodePath: out,
        operationKind: 'cnc_drill',
        zPassMm: -3,
        safeZMm: 8,
        // retractMm intentionally unset so drillOperationHints emits the
        // "retract plane R uses safeZMm" hint.
        operationParams: { drillPoints: [[1, 1], [5, 5]] }
      }),
      PASS_THROUGH_GUARD_HINT,
      envelopeHint
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.engine.requestedEngine).toBe('builtin')
      expect(r.engine.fallbackApplied).toBe(false)
      expect(r.hint).toMatch(/safeZMm \(8\.0 mm\)/)
      expect(r.hint).toMatch(/zPassMm \(-3\.000 mm\)/)
      // Smoothieware defaults the cycle to expanded G0/G1 (no canned cycle).
      expect(r.hint).toMatch(/smoothieware defaulted to expanded/)
    }
    await unlink(out).catch(() => {})
  })

  it('cnc_pocket on Laguna Swift 5x10 with finishPass=false omits the appended contour finish', async () => {
    const machine = await loadMachine('laguna-swift-5x10.json')
    const outFinish = tmpGcodePath('pkt-laguna-finish')
    const outNoFinish = tmpGcodePath('pkt-laguna-no-finish')
    const baseParams = { contourPoints: SQUARE, zStepMm: 1 }
    const rFinish = await dispatch2dStrategy(
      buildJob({
        machine,
        outputGcodePath: outFinish,
        operationKind: 'cnc_pocket',
        operationParams: { ...baseParams, finishPass: true }
      }),
      PASS_THROUGH_GUARD_HINT,
      envelopeHint
    )
    const rNoFinish = await dispatch2dStrategy(
      buildJob({
        machine,
        outputGcodePath: outNoFinish,
        operationKind: 'cnc_pocket',
        operationParams: { ...baseParams, finishPass: false }
      }),
      PASS_THROUGH_GUARD_HINT,
      envelopeHint
    )
    expect(rFinish.ok).toBe(true)
    expect(rNoFinish.ok).toBe(true)
    if (rFinish.ok && rNoFinish.ok) {
      // finishPass=true appends a full contour pass on top of pocket lines;
      // finishPass=false stops after pocket lines. Strictly more output.
      expect(rFinish.gcode.length).toBeGreaterThan(rNoFinish.gcode.length)
    }
    await unlink(outFinish).catch(() => {})
    await unlink(outNoFinish).catch(() => {})
  })

  it('cnc_chamfer on Makera Carvera 3-axis returns ok and emits non-empty G-code', async () => {
    const machine = await loadMachine('makera-carvera-3axis.json')
    const out = tmpGcodePath('cha-carvera-ok')
    const r = await dispatch2dStrategy(
      buildJob({
        machine,
        outputGcodePath: out,
        operationKind: 'cnc_chamfer',
        operationParams: { contourPoints: SQUARE, chamferDepthMm: 0.5, chamferAngleDeg: 45 }
      }),
      PASS_THROUGH_GUARD_HINT,
      envelopeHint
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.gcode.length).toBeGreaterThan(0)
      expect(r.engine.requestedEngine).toBe('builtin')
      expect(r.engine.fallbackApplied).toBe(false)
    }
    await unlink(out).catch(() => {})
  })
})

describe('dispatch2dStrategy -- multi-depth contour expansion via computeNegativeZDepthPasses', () => {
  it('negative zPassMm with zStepMm produces strictly more G-code than the same job without zStepMm', async () => {
    const machine = await loadMachine('laguna-swift-5x10.json')
    const outMulti = tmpGcodePath('cnt-multi')
    const outSingle = tmpGcodePath('cnt-single')
    const rMulti = await dispatch2dStrategy(
      buildJob({
        machine,
        outputGcodePath: outMulti,
        operationKind: 'cnc_contour',
        zPassMm: -3,
        operationParams: { contourPoints: SQUARE, zStepMm: 1 }
      }),
      PASS_THROUGH_GUARD_HINT,
      envelopeHint
    )
    const rSingle = await dispatch2dStrategy(
      buildJob({
        machine,
        outputGcodePath: outSingle,
        operationKind: 'cnc_contour',
        zPassMm: -3,
        operationParams: { contourPoints: SQUARE }
      }),
      PASS_THROUGH_GUARD_HINT,
      envelopeHint
    )
    expect(rMulti.ok).toBe(true)
    expect(rSingle.ok).toBe(true)
    if (rMulti.ok && rSingle.ok) {
      expect(rMulti.gcode.length).toBeGreaterThan(rSingle.gcode.length)
    }
    await unlink(outMulti).catch(() => {})
    await unlink(outSingle).catch(() => {})
  })

  it('positive zPassMm uses a single-depth pass even when zStepMm is set (multi-depth branch is gated on zPassMm < 0)', async () => {
    const machine = await loadMachine('laguna-swift-5x10.json')
    const outPos = tmpGcodePath('cnt-pos-step')
    const outPosNoStep = tmpGcodePath('cnt-pos-nostep')
    const rPos = await dispatch2dStrategy(
      buildJob({
        machine,
        outputGcodePath: outPos,
        operationKind: 'cnc_contour',
        zPassMm: 1,
        operationParams: { contourPoints: SQUARE, zStepMm: 0.25 }
      }),
      PASS_THROUGH_GUARD_HINT,
      envelopeHint
    )
    const rPosNoStep = await dispatch2dStrategy(
      buildJob({
        machine,
        outputGcodePath: outPosNoStep,
        operationKind: 'cnc_contour',
        zPassMm: 1,
        operationParams: { contourPoints: SQUARE }
      }),
      PASS_THROUGH_GUARD_HINT,
      envelopeHint
    )
    expect(rPos.ok).toBe(true)
    expect(rPosNoStep.ok).toBe(true)
    if (rPos.ok && rPosNoStep.ok) {
      // Both runs emit a single-depth pass because the multi-depth branch
      // requires zPassMm < 0; zStepMm=0.25 alone does not trigger expansion.
      expect(rPos.gcode.length).toBe(rPosNoStep.gcode.length)
    }
    await unlink(outPos).catch(() => {})
    await unlink(outPosNoStep).catch(() => {})
  })
})

describe('dispatch2dStrategy -- engine bookkeeping always reports builtin for 2D ops', () => {
  it('cnc_contour reports requestedEngine builtin and fallbackApplied false', async () => {
    const machine = await loadMachine('laguna-swift-5x10.json')
    const out = tmpGcodePath('eng-cnt')
    const r = await dispatch2dStrategy(
      buildJob({
        machine,
        outputGcodePath: out,
        operationKind: 'cnc_contour',
        operationParams: { contourPoints: SQUARE }
      }),
      PASS_THROUGH_GUARD_HINT,
      envelopeHint
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.engine).toEqual({
        requestedEngine: 'builtin',
        usedEngine: 'builtin',
        fallbackApplied: false
      })
    }
    await unlink(out).catch(() => {})
  })

  it('cnc_pcb_drill reports requestedEngine builtin (drill family bookkeeping)', async () => {
    const machine = await loadMachine('makera-carvera-3axis.json')
    const out = tmpGcodePath('eng-pcbd')
    const r = await dispatch2dStrategy(
      buildJob({
        machine,
        outputGcodePath: out,
        operationKind: 'cnc_pcb_drill',
        operationParams: { drillPoints: [[2, 2], [4, 4]] }
      }),
      PASS_THROUGH_GUARD_HINT,
      envelopeHint
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.engine.requestedEngine).toBe('builtin')
      expect(r.engine.usedEngine).toBe('builtin')
      expect(r.engine.fallbackApplied).toBe(false)
    }
    await unlink(out).catch(() => {})
  })
})

describe('dispatch2dStrategy -- PCB family falls through to contour generator', () => {
  it('cnc_pcb_isolation produces non-empty G-code from a triangle contour', async () => {
    const machine = await loadMachine('makera-carvera-3axis.json')
    const out = tmpGcodePath('pcb-iso')
    const r = await dispatch2dStrategy(
      buildJob({
        machine,
        outputGcodePath: out,
        operationKind: 'cnc_pcb_isolation',
        zPassMm: -0.1,
        operationParams: { contourPoints: [[0, 0], [4, 0], [4, 4]] }
      }),
      PASS_THROUGH_GUARD_HINT,
      envelopeHint
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.gcode.length).toBeGreaterThan(0)
    }
    await unlink(out).catch(() => {})
  })

  it('cnc_pcb_contour produces non-empty G-code from a triangle contour', async () => {
    const machine = await loadMachine('makera-carvera-3axis.json')
    const out = tmpGcodePath('pcb-ctr')
    const r = await dispatch2dStrategy(
      buildJob({
        machine,
        outputGcodePath: out,
        operationKind: 'cnc_pcb_contour',
        zPassMm: -0.5,
        operationParams: { contourPoints: [[0, 0], [4, 0], [4, 4]] }
      }),
      PASS_THROUGH_GUARD_HINT,
      envelopeHint
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.gcode.length).toBeGreaterThan(0)
    }
    await unlink(out).catch(() => {})
  })
})
