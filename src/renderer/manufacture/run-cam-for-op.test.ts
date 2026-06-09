/**
 * run-cam-for-op.test.ts — Wave 3a placement + rotary-fixture wiring pins.
 *
 * Before Wave 3a, `runCamForOp` hard-coded an identity placement for every
 * 4-axis op (so a real-world STL not authored in rotary WCS was silently
 * mis-machined) and never supplied a `rotaryFixture` (so the tailstock arm of
 * `checkRotaryFixtureCollision` was unreachable). This suite pins the wiring:
 *
 *   1. A 4-axis op on a setup with `rotaryPlacement` sends that REAL placement
 *      to `fab().camRun` — NOT identity.
 *   2. A 4-axis op with no `rotaryPlacement` sends identity (back-compat:
 *      equals the historical hard-coded transform).
 *   3. Setup tailstock + chuck-radius fields are assembled into a
 *      `rotaryFixture` (chuck + tailstock) and forwarded.
 *   4. A setup with no chuck/tailstock override sends NO `rotaryFixture`
 *      (the engine then runs its machine-default chuck-only sweep).
 *   5. 3-axis ops never carry `placement`/`rotaryFixture` (the gizmo/fixture
 *      are rotary-only — sending them would be meaningless topology).
 *
 * SAFETY (G-code is sacred): this test asserts the CAM *inputs*, not emitted
 * G-code. The placement feeds the engine's pre-gen frame+radial validator and
 * the fixture feeds the advisory collision sweep; neither alters the post. The
 * full end-to-end post contract is pinned by
 * `src/main/cam-axis4/__tests__/carvera-pipeline.test.ts`.
 *
 * `runCamForOp` calls `fab()` (= `globalThis.window.fab`), so the test installs
 * a `window.fab` stub capturing the `camRun` payload. Runs in the `node` vitest
 * env (no DOM needed — `runCamForOp` is a pure async mapper).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runCamForOp, type RunCamForOpArgs } from './run-cam-for-op'
import type { ManufactureFile, ManufactureSetup, ManufactureOperation } from '../../shared/manufacture-schema'

// ── window.fab stub ──────────────────────────────────────────────────────────

type CamRunCapture = Record<string, unknown>

const camRunMock = vi.fn<(payload: CamRunCapture) => Promise<{ ok: true; gcode: string }>>()
const stlTransformForCamMock = vi.fn<(args: { stlPath: string }) => Promise<string>>()

function installFab(): void {
  const g = globalThis as unknown as Record<string, unknown>
  g['window'] = {
    fab: {
      camRun: camRunMock,
      stlTransformForCam: stlTransformForCamMock,
      readTextFile: vi.fn().mockResolvedValue('')
    }
  }
}

beforeEach(() => {
  camRunMock.mockReset().mockResolvedValue({ ok: true, gcode: 'G21\nM2\n' })
  // 3-axis bake passthrough: return the same path it was handed.
  stlTransformForCamMock.mockReset().mockImplementation(async (a) => a.stlPath)
  installFab()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeMfg(op: ManufactureOperation, setup: ManufactureSetup): ManufactureFile {
  return {
    version: 2,
    setups: [setup],
    operations: [op],
    plates: [{ id: 'p1', label: 'P1', setups: [setup], operations: [op] }]
  }
}

/** Baseline args; outPath uses the host `<dir>/output/cam.nc` convention. */
function baseArgs(mfg: ManufactureFile): RunCamForOpArgs {
  return {
    mfg,
    selectedOpIndex: 0,
    machineId: 'makera-carvera-4axis',
    materials: [],
    tools: null,
    pythonPath: 'python',
    outPath: '/proj/output/cam.nc'
  }
}

const ROTARY_SETUP_BASE: ManufactureSetup = {
  id: 's1',
  label: 'Rotary',
  machineId: 'makera-carvera-4axis',
  axisMode: '4axis',
  stock: { kind: 'cylinder', x: 80, z: 30 },
  rotaryChuckDepthMm: 15,
  rotaryClampOffsetMm: 2
}

function rotaryOp(kind: ManufactureOperation['kind'] = 'cnc_4axis_roughing'): ManufactureOperation {
  return { id: 'op1', kind, label: '4ax', sourceMesh: 'assets/part.stl' }
}

/** Pull the single captured camRun payload. */
function captured(): CamRunCapture {
  expect(camRunMock).toHaveBeenCalledTimes(1)
  return camRunMock.mock.calls[0]![0]
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('runCamForOp — 4-axis placement wiring (Wave 3a)', () => {
  it('sends the setup.rotaryPlacement (NOT identity) for a 4-axis op', async () => {
    const placement = {
      position: { x: 12, y: 0, z: 0 },
      rotation: { x: 0, y: 90, z: 0 },
      scale: { x: 1, y: 1, z: 1 }
    }
    const setup: ManufactureSetup = { ...ROTARY_SETUP_BASE, rotaryPlacement: placement }
    const r = await runCamForOp(baseArgs(makeMfg(rotaryOp(), setup)))
    expect(r.ok).toBe(true)
    const payload = captured()
    expect(payload['placement']).toEqual(placement)
  })

  it('normalizes a non-finite placement axis to a safe value (scale never 0)', async () => {
    // Half-typed numeric fields can leave NaN on disk; buildPlacement coerces.
    const setup: ManufactureSetup = {
      ...ROTARY_SETUP_BASE,
      rotaryPlacement: {
        position: { x: Number.NaN, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 0, y: 1, z: 1 } // 0 scale would degenerate the mesh
      }
    }
    await runCamForOp(baseArgs(makeMfg(rotaryOp(), setup)))
    const p = captured()['placement'] as {
      position: { x: number }
      scale: { x: number }
    }
    expect(p.position.x).toBe(0) // NaN → 0
    expect(p.scale.x).toBe(1) // 0 → 1
  })

  it('sends identity placement when the setup has no rotaryPlacement (back-compat)', async () => {
    await runCamForOp(baseArgs(makeMfg(rotaryOp(), { ...ROTARY_SETUP_BASE })))
    expect(captured()['placement']).toEqual({
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 }
    })
  })
})

describe('runCamForOp — rotary fixture (chuck + tailstock) wiring (Wave 3a)', () => {
  it('assembles a chuck+tailstock RotaryFixtureConfig from setup fields', async () => {
    const setup: ManufactureSetup = {
      ...ROTARY_SETUP_BASE,
      rotaryChuckOuterRadiusMm: 40,
      rotaryTailstockStartXMm: 70,
      rotaryTailstockOuterRadiusMm: 12
    }
    await runCamForOp(baseArgs(makeMfg(rotaryOp(), setup)))
    expect(captured()['rotaryFixture']).toEqual({
      // chuck axial extent = chuckDepth(15) + clampOffset(2)
      chuckDepthMm: 17,
      chuckOuterRadiusMm: 40,
      tailstockStartXMm: 70,
      tailstockOuterRadiusMm: 12
    })
  })

  it('sends a chuck-only fixture when only the chuck-radius override is set', async () => {
    const setup: ManufactureSetup = { ...ROTARY_SETUP_BASE, rotaryChuckOuterRadiusMm: 46 }
    await runCamForOp(baseArgs(makeMfg(rotaryOp(), setup)))
    const fx = captured()['rotaryFixture'] as Record<string, unknown>
    expect(fx).toEqual({ chuckDepthMm: 17, chuckOuterRadiusMm: 46 })
    expect(fx['tailstockStartXMm']).toBeUndefined()
  })

  it('sends a tailstock-only fixture (chuck radius 0 = defer chuck to engine) when only tailstock is set', async () => {
    const setup: ManufactureSetup = {
      ...ROTARY_SETUP_BASE,
      rotaryTailstockStartXMm: 75,
      rotaryTailstockOuterRadiusMm: 10
    }
    await runCamForOp(baseArgs(makeMfg(rotaryOp(), setup)))
    expect(captured()['rotaryFixture']).toEqual({
      chuckDepthMm: 17,
      chuckOuterRadiusMm: 0,
      tailstockStartXMm: 75,
      tailstockOuterRadiusMm: 10
    })
  })

  it('omits rotaryFixture entirely when the setup supplies neither chuck override nor tailstock', async () => {
    await runCamForOp(baseArgs(makeMfg(rotaryOp(), { ...ROTARY_SETUP_BASE })))
    expect(captured()['rotaryFixture']).toBeUndefined()
  })
})

describe('runCamForOp — 3-axis ops never carry rotary inputs', () => {
  it('omits placement AND rotaryFixture for a 3-axis op even if the setup has rotary fields', async () => {
    const setup: ManufactureSetup = {
      ...ROTARY_SETUP_BASE,
      stock: { kind: 'box', x: 100, y: 100, z: 25 },
      rotaryChuckOuterRadiusMm: 40,
      rotaryTailstockStartXMm: 70,
      rotaryTailstockOuterRadiusMm: 12,
      rotaryPlacement: {
        position: { x: 5, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 }
      }
    }
    const op = rotaryOp('cnc_parallel') // 3-axis
    await runCamForOp(baseArgs(makeMfg(op, setup)))
    const payload = captured()
    expect(payload['placement']).toBeUndefined()
    expect(payload['rotaryFixture']).toBeUndefined()
  })
})
