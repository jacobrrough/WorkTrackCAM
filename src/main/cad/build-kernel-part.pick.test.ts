/**
 * build-kernel-part — pick-file persistence pin (task_f76b39b3).
 *
 * On a SUCCESSFUL build, `buildKernelPartFromProject` must persist the
 * `pickTessellation` + `pickPlacement` pair build_part.py emits to
 * `output/kernel-part.pick.json` (so the renderer can rebuild a PICKABLE
 * no-code viewport mesh on any later project open), and must DELETE a stale
 * pick file when this build carried no usable pick data — old pick geometry
 * must never overlay a newer STL. Mirrors the warnings-propagation pin's mock
 * scaffolding (real shared layer; only fs / python runner / paths stubbed).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

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

const FEATURES_FIXTURE = JSON.stringify({
  version: 1,
  items: [],
  kernelOps: [{ kind: 'fillet_all', radiusMm: 2 }]
})

const writeFileMock = vi.fn().mockResolvedValue(undefined)
const unlinkMock = vi.fn().mockResolvedValue(undefined)
const runPythonJsonMock = vi.fn()

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: (...args: unknown[]) => writeFileMock(...args),
  unlink: (...args: unknown[]) => unlinkMock(...args),
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

const VALID_PICK_TESSELLATION = {
  vertices: [0, 0, 0, 10, 0, 0, 0, 5, 0],
  indices: [0, 1, 2],
  faceIds: [0],
  triangleCount: 1,
  bbox: { min: [0, 0, 0], max: [10, 5, 0] },
  faceMap: { '0': { kind: 'face', occtHash: 0, occtId: 'f:abc', area: 25 } },
  edgeMap: { 'e:001': { kind: 'edge', occtId: 'e:001', occtHash: 0, length: 10 } },
  edges: [{ id: 'e:001', points: [[0, 0, 0], [10, 0, 0]] }]
}

const VALID_PICK_PLACEMENT = { u: [1, 0, 0], v: [0, 0, -1], n: [0, 1, 0], origin: [0, 0, 0] }

function okBuildJson(extra: Record<string, unknown> = {}): { code: number; json: Record<string, unknown> } {
  return {
    code: 0,
    json: {
      ok: true,
      stepPath: '/proj/output/kernel-part.step',
      stlPath: '/proj/output/kernel-part.stl',
      ...extra
    }
  }
}

function pickWrites(): Array<[string, string]> {
  return writeFileMock.mock.calls
    .filter((c): c is [string, string] => String(c[0]).includes('kernel-part.pick.json'))
    .map((c) => [String(c[0]), String(c[1])])
}

beforeEach(() => {
  writeFileMock.mockClear()
  unlinkMock.mockClear()
  runPythonJsonMock.mockReset()
})

describe('buildKernelPartFromProject — pick-file persistence', () => {
  it('persists pickTessellation + pickPlacement to output/kernel-part.pick.json on success', async () => {
    runPythonJsonMock.mockResolvedValue(
      okBuildJson({ pickTessellation: VALID_PICK_TESSELLATION, pickPlacement: VALID_PICK_PLACEMENT })
    )
    const res = await buildKernelPartFromProject(PARAMS)
    expect(res.ok).toBe(true)

    const writes = pickWrites()
    expect(writes).toHaveLength(1)
    const parsed = JSON.parse(writes[0]![1]) as { tessellation: { edges: Array<{ id: string }> }; placement: unknown }
    expect(parsed.tessellation.edges[0]!.id).toBe('e:001')
    expect(parsed.placement).toEqual(VALID_PICK_PLACEMENT)
    expect(unlinkMock).not.toHaveBeenCalled()
  })

  it('a missing placement persists as null (identity), not a reject', async () => {
    runPythonJsonMock.mockResolvedValue(okBuildJson({ pickTessellation: VALID_PICK_TESSELLATION }))
    const res = await buildKernelPartFromProject(PARAMS)
    expect(res.ok).toBe(true)
    const writes = pickWrites()
    expect(writes).toHaveLength(1)
    expect((JSON.parse(writes[0]![1]) as { placement: unknown }).placement).toBeNull()
  })

  it('DELETES a stale pick file when the build carried no pick data', async () => {
    runPythonJsonMock.mockResolvedValue(okBuildJson())
    const res = await buildKernelPartFromProject(PARAMS)
    expect(res.ok).toBe(true)
    expect(pickWrites()).toHaveLength(0)
    expect(unlinkMock).toHaveBeenCalledTimes(1)
    expect(String(unlinkMock.mock.calls[0]![0])).toContain('kernel-part.pick.json')
  })

  it('DELETES rather than persists when the pick payload is structurally unusable', async () => {
    runPythonJsonMock.mockResolvedValue(
      okBuildJson({ pickTessellation: { vertices: 'garbage' }, pickPlacement: VALID_PICK_PLACEMENT })
    )
    const res = await buildKernelPartFromProject(PARAMS)
    expect(res.ok).toBe(true)
    expect(pickWrites()).toHaveLength(0)
    expect(unlinkMock).toHaveBeenCalledTimes(1)
  })

  it('a FAILED build never touches the pick file (manifest gates everything)', async () => {
    runPythonJsonMock.mockResolvedValue({ code: 1, json: { ok: false, error: 'build_failed' } })
    const res = await buildKernelPartFromProject(PARAMS)
    expect(res.ok).toBe(false)
    expect(pickWrites()).toHaveLength(0)
    expect(unlinkMock).not.toHaveBeenCalled()
  })
})
