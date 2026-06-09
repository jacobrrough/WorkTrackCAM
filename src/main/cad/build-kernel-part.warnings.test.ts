/**
 * build-kernel-part — warnings propagation pin (no-code build→render loop).
 *
 * When `build_part.py` finishes a SUCCESSFUL build that skipped one or more bad
 * post-solid ops (the sacred kernel: a bad op never aborts the build, it is
 * skipped with a non-fatal warning), it returns a `warnings: string[]` on its
 * final JSON line. `buildKernelPartFromProject` must surface those on the
 * success result so the Design cockpit can toast them honestly rather than
 * faking a clean build.
 *
 * These pins lock the additive `KernelBuildResult.warnings` field added for the
 * build→render wiring:
 *   1. warnings present  → echoed verbatim on the success result.
 *   2. warnings absent   → the key is omitted (no empty array).
 *   3. non-string / empty entries are dropped (never poison the toast).
 *
 * The real shared layer (`sketch-profile`, `design-schema`,
 * `part-features-schema`, `kernel-manifest-schema`) runs unmocked — only fs, the
 * python runner, and the engines-root resolver are stubbed. This exercises the
 * exact payload→spawn→result path the running IPC handler uses.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

// A valid design sketch: one closed rect on datum XY, extrude depth 10 — so
// `buildKernelBuildPayload` produces a buildable extrude payload.
const DESIGN_FIXTURE = JSON.stringify({
  version: 2,
  units: 'mm',
  extrudeDepthMm: 10,
  solidKind: 'extrude',
  loftSeparationMm: 20,
  revolve: { angleDeg: 360, axisX: 0 },
  parameters: {},
  points: {},
  entities: [{ id: 'r1', kind: 'rect', cx: 0, cy: 0, w: 50, h: 30, rotation: 0 }],
  constraints: [],
  sketchPlane: { kind: 'datum', datum: 'XY' }
})

// A features file carrying ONE kernel op (a fillet_all). The op set drives the
// payloadVersion bump and is what would produce a build warning if it failed.
const FEATURES_FIXTURE = JSON.stringify({
  version: 1,
  items: [],
  kernelOps: [{ kind: 'fillet_all', radiusMm: 2 }]
})

const writeFileMock = vi.fn().mockResolvedValue(undefined)
const runPythonJsonMock = vi.fn()

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: (...args: unknown[]) => writeFileMock(...args),
  readFile: vi.fn((p: string) =>
    Promise.resolve(String(p).includes('features') ? FEATURES_FIXTURE : DESIGN_FIXTURE)
  )
}))

vi.mock('../paths', () => ({
  getEnginesRoot: vi.fn().mockReturnValue('/mock/engines')
}))

vi.mock('./occt-import', () => ({
  runPythonJson: (...args: unknown[]) => runPythonJsonMock(...args)
}))

import { buildKernelPartFromProject } from './build-kernel-part'

const PARAMS = { projectDir: '/proj', pythonPath: 'python', appRoot: '/app' }

beforeEach(() => {
  writeFileMock.mockClear()
  runPythonJsonMock.mockReset()
})

describe('buildKernelPartFromProject — warnings propagation', () => {
  it('echoes build_part.py warnings on the success result', async () => {
    runPythonJsonMock.mockResolvedValue({
      code: 0,
      json: {
        ok: true,
        stepPath: '/proj/output/kernel-part.step',
        stlPath: '/proj/output/kernel-part.stl',
        warnings: ['op[0] fillet_all failed (radius 2): no edges (left unchanged)']
      }
    })
    const res = await buildKernelPartFromProject(PARAMS)
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('expected ok')
    expect(res.warnings).toEqual(['op[0] fillet_all failed (radius 2): no edges (left unchanged)'])
    expect(res.stlPath).toBe('/proj/output/kernel-part.stl')
  })

  it('omits the warnings key when build_part.py reports none', async () => {
    runPythonJsonMock.mockResolvedValue({
      code: 0,
      json: {
        ok: true,
        stepPath: '/proj/output/kernel-part.step',
        stlPath: '/proj/output/kernel-part.stl'
      }
    })
    const res = await buildKernelPartFromProject(PARAMS)
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('expected ok')
    expect(res.warnings).toBeUndefined()
  })

  it('drops non-string / empty warning entries', async () => {
    runPythonJsonMock.mockResolvedValue({
      code: 0,
      json: {
        ok: true,
        stepPath: '/proj/output/kernel-part.step',
        stlPath: '/proj/output/kernel-part.stl',
        warnings: ['real warning', '', '   ', 42, null, { not: 'a string' }]
      }
    })
    const res = await buildKernelPartFromProject(PARAMS)
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('expected ok')
    expect(res.warnings).toEqual(['real warning'])
  })

  it('passes build_part.py the payload path + output dir + base, spawning the script unchanged', async () => {
    runPythonJsonMock.mockResolvedValue({
      code: 0,
      json: {
        ok: true,
        stepPath: '/proj/output/kernel-part.step',
        stlPath: '/proj/output/kernel-part.stl'
      }
    })
    await buildKernelPartFromProject(PARAMS)
    expect(runPythonJsonMock).toHaveBeenCalledTimes(1)
    const [py, args, appRoot] = runPythonJsonMock.mock.calls[0]!
    expect(py).toBe('python')
    expect(appRoot).toBe('/app')
    // args = [script, payloadPath, outputDir, base] — the documented CLI contract.
    expect(args[0]).toContain('build_part.py')
    expect(args[1]).toContain('.kernel-build-payload.json')
    expect(args[2]).toContain('output')
    expect(args[3]).toBe('kernel-part')
  })
})
