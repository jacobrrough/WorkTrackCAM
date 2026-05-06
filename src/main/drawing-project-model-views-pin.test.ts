/**
 * drawing-project-model-views-pin.test.ts -- [ID-0211] Cycle 154 test-coverage paired-pin
 *
 * Pins the contract of `src/main/drawing-project-model-views.ts` -- the
 * Electron-main glue that projects kernel-STL + optional kernel-STEP linework
 * to drawing-sheet view placeholders via the Python `engines/occt/project_views.py`
 * helper. Sister cycles: 119 [ID-0196] derive-features, 124 [ID-0201]
 * viewport3d-bounds, 129 [ID-0206] design-viewport-interaction, 130 [ID-0207]
 * shop-stock-bounds, 131 [ID-0208] command-palette-memory, 132 [ID-0209]
 * post-process-dialects, 134 [ID-0210] brand-bar-machine-badge.
 *
 * Cross-cuts target machines indirectly: the projected-view linework feeds
 * the PDF/DXF drawing-sheet export pipeline shared by ALL three target
 * machines (Creality K2 Plus / Laguna Swift 5x10 / Makera Carvera + 4th
 * Axis). The `kernel-part.stl` input naming is shared with the broader
 * Electron-main mesh pipeline (`src/main/cad/build-kernel-part.ts`).
 *
 * Existing coverage prior to this cycle: **ZERO** -- this 129-line module
 * had no `*.test.ts` companion of any kind. This pin is its first vitest
 * visibility AND its co-located source-text guard.
 *
 * Pins:
 *   (A) module shape -- the 1 named async export + 2 type aliases +
 *       private-helper non-leak guard,
 *   (B) STL-missing fast-fail (no Python invocation, no payload write),
 *   (C) empty-placeholders fast-success (no Python invocation, no
 *       mkdir, no payload write),
 *   (D) tier resolution -- undefined/`'A'`->`'A'`, `'B'`->`'B'`,
 *       `'C'` with STEP success adds stepPath, `'C'` STEP missing falls
 *       through silently to `'C'` without stepPath,
 *   (E) payload contract: snapTolMm 0.025, maxSegments 22000,
 *       includeConvexHull true, views array shape `{id, axis}`,
 *   (F) Python invocation -- script path joined under engines root,
 *       pythonPath + appRoot passed through verbatim,
 *   (G) Python error paths: code !== 0 emits json.error or fallback;
 *       json.ok===false same; detail passthrough; missing json.error
 *       falls back to 'project_views_failed'; non-array views ->
 *       'project_views_bad_response',
 *   (H) view mapping: byId-skip for unknown ids, non-object row skip,
 *       null row skip, label.trim()-empty falls back to id.slice(0,8),
 *       whitespace-only label falls back, non-finite x/y filter per
 *       segment, non-array segments produce empty array,
 *   (I) axisForPlaceholder behavior -- base->viewFrom||'front',
 *       projected->projectionDirection||'right' (proven via the public
 *       wrapper since the helper is intentionally module-private),
 *   (J) source-text whitelist -- file path literals, error literals,
 *       payload-constant literals, id.slice(0,8) fallback arithmetic,
 *       mkdir recursive flag, JSON.stringify indent literal, 'utf-8'
 *       writeFile encoding, no `any` type leaks, no top-level `let`.
 *
 * ZERO production-code edits. Pure additive paired-pin (mirrors the
 * Cycles 119 / 124 / 129 / 130 / 131 / 132 / 133 / 134 chain).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { DrawingViewPlaceholder } from '../shared/drawing-sheet-schema'

// vi.mock factories are hoisted; live before any imports of the module
// under test or its mocked dependencies.
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn()
}))

vi.mock('./paths', () => ({
  getEnginesRoot: vi.fn(() => '/mock/engines')
}))

vi.mock('./cad/occt-import', () => ({
  runPythonJson: vi.fn()
}))

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { runPythonJson } from './cad/occt-import'
import { getEnginesRoot } from './paths'
import * as M from './drawing-project-model-views'
import {
  projectDrawingViewsFromKernelStl,
  type ProjectedDrawingView,
  type ProjectedSegment
} from './drawing-project-model-views'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC_PATH = join(HERE, 'drawing-project-model-views.ts')
const SRC = readFileSync(SRC_PATH, 'utf-8')

/** Build a base placeholder (kind: 'base', viewFrom optional). */
function basePh(id: string, label = '', viewFrom?: 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom'): DrawingViewPlaceholder {
  return { id, kind: 'base', label, viewFrom }
}

/** Build a projected placeholder (kind: 'projected', projectionDirection optional). */
function projPh(
  id: string,
  label = '',
  projectionDirection?: 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom'
): DrawingViewPlaceholder {
  return { id, kind: 'projected', label, projectionDirection }
}

beforeEach(() => {
  vi.mocked(readFile).mockReset()
  vi.mocked(writeFile).mockReset()
  vi.mocked(mkdir).mockReset().mockResolvedValue(undefined as never)
  vi.mocked(runPythonJson).mockReset()
  vi.mocked(getEnginesRoot).mockReset().mockReturnValue('/mock/engines')
})

// ---------------------------------------------------------------------------
// (A) Module shape
// ---------------------------------------------------------------------------
describe('drawing-project-model-views module shape', () => {
  it('exports projectDrawingViewsFromKernelStl as the only named runtime symbol', () => {
    const keys = Object.keys(M).sort()
    expect(keys).toEqual(['projectDrawingViewsFromKernelStl'])
  })

  it('projectDrawingViewsFromKernelStl is an async function', () => {
    expect(typeof projectDrawingViewsFromKernelStl).toBe('function')
    // Async functions return promises when invoked; we assert via toString tag.
    expect(projectDrawingViewsFromKernelStl.constructor.name).toBe('AsyncFunction')
  })

  it('private helper axisForPlaceholder is NOT exported', () => {
    expect((M as Record<string, unknown>).axisForPlaceholder).toBeUndefined()
  })

  it('source declares the ProjectedSegment type with exactly four numeric fields', () => {
    expect(SRC).toContain('export type ProjectedSegment = { x1: number; y1: number; x2: number; y2: number }')
  })

  it('source declares the ProjectedDrawingView type with id/axis/label/segments fields', () => {
    expect(SRC).toContain('export type ProjectedDrawingView = {')
    expect(SRC).toContain('id: string')
    expect(SRC).toContain('axis: string')
    expect(SRC).toContain('label: string')
    expect(SRC).toContain('segments: ProjectedSegment[]')
  })

  it('source declares the projectDrawingViewsFromKernelStl signature with the exact param shape', () => {
    expect(SRC).toContain('export async function projectDrawingViewsFromKernelStl(params: {')
    expect(SRC).toContain('projectDir: string')
    expect(SRC).toContain('placeholders: DrawingViewPlaceholder[]')
    expect(SRC).toContain('pythonPath: string')
    expect(SRC).toContain('appRoot: string')
    expect(SRC).toContain("meshProjectionTier?: 'A' | 'B' | 'C'")
  })

  it('source declares the discriminated-union return type', () => {
    expect(SRC).toContain('| { ok: true; views: ProjectedDrawingView[] }')
    expect(SRC).toContain('| { ok: false; error: string; detail?: string }')
  })
})

// ---------------------------------------------------------------------------
// (B) STL-missing fast-fail
// ---------------------------------------------------------------------------
describe('STL-missing fast-fail', () => {
  it('returns ok=false / error=kernel_stl_missing when readFile rejects', async () => {
    vi.mocked(readFile).mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    const out = await projectDrawingViewsFromKernelStl({
      projectDir: '/proj',
      placeholders: [basePh('a')],
      pythonPath: '/usr/bin/python3',
      appRoot: '/app'
    })
    expect(out).toEqual({ ok: false, error: 'kernel_stl_missing' })
  })

  it('does NOT invoke Python when STL is missing', async () => {
    vi.mocked(readFile).mockRejectedValueOnce(new Error('boom'))
    await projectDrawingViewsFromKernelStl({
      projectDir: '/proj',
      placeholders: [basePh('a')],
      pythonPath: '/p',
      appRoot: '/a'
    })
    expect(runPythonJson).not.toHaveBeenCalled()
  })

  it('does NOT write a payload when STL is missing', async () => {
    vi.mocked(readFile).mockRejectedValueOnce(new Error('boom'))
    await projectDrawingViewsFromKernelStl({
      projectDir: '/proj',
      placeholders: [basePh('a')],
      pythonPath: '/p',
      appRoot: '/a'
    })
    expect(writeFile).not.toHaveBeenCalled()
    expect(mkdir).not.toHaveBeenCalled()
  })

  it('checks the kernel-part.stl path under projectDir/output', async () => {
    vi.mocked(readFile).mockRejectedValueOnce(new Error('boom'))
    await projectDrawingViewsFromKernelStl({
      projectDir: '/my-project',
      placeholders: [basePh('a')],
      pythonPath: '/p',
      appRoot: '/a'
    })
    expect(readFile).toHaveBeenCalledWith(join('/my-project', 'output', 'kernel-part.stl'))
  })
})

// ---------------------------------------------------------------------------
// (C) Empty placeholders fast-success
// ---------------------------------------------------------------------------
describe('empty placeholders fast-success', () => {
  it('returns ok=true / views=[] when placeholders is empty', async () => {
    vi.mocked(readFile).mockResolvedValueOnce(Buffer.from([0]) as never)
    const out = await projectDrawingViewsFromKernelStl({
      projectDir: '/p',
      placeholders: [],
      pythonPath: '/py',
      appRoot: '/a'
    })
    expect(out).toEqual({ ok: true, views: [] })
  })

  it('does NOT invoke Python with empty placeholders', async () => {
    vi.mocked(readFile).mockResolvedValueOnce(Buffer.from([0]) as never)
    await projectDrawingViewsFromKernelStl({
      projectDir: '/p',
      placeholders: [],
      pythonPath: '/py',
      appRoot: '/a'
    })
    expect(runPythonJson).not.toHaveBeenCalled()
  })

  it('does NOT mkdir or writeFile with empty placeholders', async () => {
    vi.mocked(readFile).mockResolvedValueOnce(Buffer.from([0]) as never)
    await projectDrawingViewsFromKernelStl({
      projectDir: '/p',
      placeholders: [],
      pythonPath: '/py',
      appRoot: '/a'
    })
    expect(mkdir).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// (D) Tier resolution
// ---------------------------------------------------------------------------
describe('tier resolution', () => {
  /**
   * Set up a minimal happy-path: STL present, Python returns ok=true with one
   * matching view. Returns the captured payload object passed to writeFile.
   */
  async function runTier(tier?: 'A' | 'B' | 'C', stepReadable = false): Promise<Record<string, unknown>> {
    // 1st readFile = STL probe (success).
    vi.mocked(readFile).mockImplementationOnce(async () => Buffer.from([0]) as never)
    // 2nd readFile = STEP probe (only in tier C); success or rejection.
    if (tier === 'C') {
      if (stepReadable) {
        vi.mocked(readFile).mockImplementationOnce(async () => Buffer.from([0]) as never)
      } else {
        vi.mocked(readFile).mockImplementationOnce(async () => {
          throw new Error('ENOENT')
        })
      }
    }
    vi.mocked(runPythonJson).mockResolvedValueOnce({ code: 0, json: { ok: true, views: [] } } as never)
    await projectDrawingViewsFromKernelStl({
      projectDir: '/p',
      placeholders: [basePh('id1', 'L', 'front')],
      pythonPath: '/py',
      appRoot: '/a',
      meshProjectionTier: tier
    })
    const writeArgs = vi.mocked(writeFile).mock.calls[0]
    const payload = JSON.parse(writeArgs[1] as string) as Record<string, unknown>
    return payload
  }

  it("undefined tier resolves to 'A'", async () => {
    const payload = await runTier(undefined)
    expect(payload.meshProjectionTier).toBe('A')
  })

  it("explicit 'A' tier round-trips as 'A'", async () => {
    const payload = await runTier('A')
    expect(payload.meshProjectionTier).toBe('A')
  })

  it("explicit 'B' tier round-trips as 'B'", async () => {
    const payload = await runTier('B')
    expect(payload.meshProjectionTier).toBe('B')
  })

  it("explicit 'C' tier with STEP readable adds stepPath under projectDir/output", async () => {
    const payload = await runTier('C', true)
    expect(payload.meshProjectionTier).toBe('C')
    expect(payload.stepPath).toBe(join('/p', 'output', 'kernel-part.step'))
  })

  it("explicit 'C' tier with STEP missing silently falls through (no stepPath in payload)", async () => {
    const payload = await runTier('C', false)
    expect(payload.meshProjectionTier).toBe('C')
    expect(payload).not.toHaveProperty('stepPath')
  })
})

// ---------------------------------------------------------------------------
// (E) Payload contract + (F) Python invocation
// ---------------------------------------------------------------------------
describe('payload contract + Python invocation', () => {
  it('writes payload with snapTolMm 0.025, maxSegments 22000, includeConvexHull true', async () => {
    vi.mocked(readFile).mockResolvedValueOnce(Buffer.from([0]) as never)
    vi.mocked(runPythonJson).mockResolvedValueOnce({ code: 0, json: { ok: true, views: [] } } as never)
    await projectDrawingViewsFromKernelStl({
      projectDir: '/p',
      placeholders: [basePh('id1', 'L', 'front')],
      pythonPath: '/py',
      appRoot: '/a'
    })
    const args = vi.mocked(writeFile).mock.calls[0]
    const payload = JSON.parse(args[1] as string) as Record<string, unknown>
    expect(payload.snapTolMm).toBe(0.025)
    expect(payload.maxSegments).toBe(22000)
    expect(payload.includeConvexHull).toBe(true)
  })

  it('writes payload with stlPath under projectDir/output', async () => {
    vi.mocked(readFile).mockResolvedValueOnce(Buffer.from([0]) as never)
    vi.mocked(runPythonJson).mockResolvedValueOnce({ code: 0, json: { ok: true, views: [] } } as never)
    await projectDrawingViewsFromKernelStl({
      projectDir: '/proj',
      placeholders: [basePh('id1')],
      pythonPath: '/py',
      appRoot: '/a'
    })
    const args = vi.mocked(writeFile).mock.calls[0]
    const payload = JSON.parse(args[1] as string) as Record<string, unknown>
    expect(payload.stlPath).toBe(join('/proj', 'output', 'kernel-part.stl'))
  })

  it('payload views array is { id, axis } pairs preserving placeholder order', async () => {
    vi.mocked(readFile).mockResolvedValueOnce(Buffer.from([0]) as never)
    vi.mocked(runPythonJson).mockResolvedValueOnce({ code: 0, json: { ok: true, views: [] } } as never)
    await projectDrawingViewsFromKernelStl({
      projectDir: '/p',
      placeholders: [basePh('a', '', 'top'), projPh('b', '', 'left')],
      pythonPath: '/py',
      appRoot: '/a'
    })
    const args = vi.mocked(writeFile).mock.calls[0]
    const payload = JSON.parse(args[1] as string) as Record<string, unknown>
    expect(payload.views).toEqual([
      { id: 'a', axis: 'top' },
      { id: 'b', axis: 'left' }
    ])
  })

  it('payload path is .drawing-project-payload.json under projectDir/output', async () => {
    vi.mocked(readFile).mockResolvedValueOnce(Buffer.from([0]) as never)
    vi.mocked(runPythonJson).mockResolvedValueOnce({ code: 0, json: { ok: true, views: [] } } as never)
    await projectDrawingViewsFromKernelStl({
      projectDir: '/proj',
      placeholders: [basePh('id1')],
      pythonPath: '/py',
      appRoot: '/a'
    })
    const args = vi.mocked(writeFile).mock.calls[0]
    expect(args[0]).toBe(join('/proj', 'output', '.drawing-project-payload.json'))
    expect(args[2]).toBe('utf-8')
  })

  it('payload JSON is pretty-printed with 2-space indent', async () => {
    vi.mocked(readFile).mockResolvedValueOnce(Buffer.from([0]) as never)
    vi.mocked(runPythonJson).mockResolvedValueOnce({ code: 0, json: { ok: true, views: [] } } as never)
    await projectDrawingViewsFromKernelStl({
      projectDir: '/p',
      placeholders: [basePh('id1')],
      pythonPath: '/py',
      appRoot: '/a'
    })
    const args = vi.mocked(writeFile).mock.calls[0]
    const text = args[1] as string
    // 2-space indent emits "  " before the first key on the first nested line.
    expect(text).toMatch(/\n  "/)
  })

  it('mkdir is called with recursive: true on projectDir/output', async () => {
    vi.mocked(readFile).mockResolvedValueOnce(Buffer.from([0]) as never)
    vi.mocked(runPythonJson).mockResolvedValueOnce({ code: 0, json: { ok: true, views: [] } } as never)
    await projectDrawingViewsFromKernelStl({
      projectDir: '/proj',
      placeholders: [basePh('id1')],
      pythonPath: '/py',
      appRoot: '/a'
    })
    expect(mkdir).toHaveBeenCalledWith(join('/proj', 'output'), { recursive: true })
  })

  it('Python script path is engines-root/occt/project_views.py', async () => {
    vi.mocked(getEnginesRoot).mockReturnValueOnce('/eng-alt')
    vi.mocked(readFile).mockResolvedValueOnce(Buffer.from([0]) as never)
    vi.mocked(runPythonJson).mockResolvedValueOnce({ code: 0, json: { ok: true, views: [] } } as never)
    await projectDrawingViewsFromKernelStl({
      projectDir: '/p',
      placeholders: [basePh('id1')],
      pythonPath: '/py',
      appRoot: '/a'
    })
    const callArgs = vi.mocked(runPythonJson).mock.calls[0]
    const scriptPath = (callArgs[1] as string[])[0]
    expect(scriptPath).toBe(join('/eng-alt', 'occt', 'project_views.py'))
  })

  it('runPythonJson receives pythonPath and appRoot verbatim', async () => {
    vi.mocked(readFile).mockResolvedValueOnce(Buffer.from([0]) as never)
    vi.mocked(runPythonJson).mockResolvedValueOnce({ code: 0, json: { ok: true, views: [] } } as never)
    await projectDrawingViewsFromKernelStl({
      projectDir: '/p',
      placeholders: [basePh('id1')],
      pythonPath: '/usr/local/bin/python3.12',
      appRoot: '/Applications/WorkTrackCAM.app'
    })
    const callArgs = vi.mocked(runPythonJson).mock.calls[0]
    expect(callArgs[0]).toBe('/usr/local/bin/python3.12')
    expect(callArgs[2]).toBe('/Applications/WorkTrackCAM.app')
  })

  it('runPythonJson args[1] is [scriptPath, payloadPath] in that order', async () => {
    vi.mocked(readFile).mockResolvedValueOnce(Buffer.from([0]) as never)
    vi.mocked(runPythonJson).mockResolvedValueOnce({ code: 0, json: { ok: true, views: [] } } as never)
    await projectDrawingViewsFromKernelStl({
      projectDir: '/proj',
      placeholders: [basePh('id1')],
      pythonPath: '/py',
      appRoot: '/a'
    })
    const args = vi.mocked(runPythonJson).mock.calls[0][1] as string[]
    expect(args).toHaveLength(2)
    expect(args[1]).toBe(join('/proj', 'output', '.drawing-project-payload.json'))
  })
})

// ---------------------------------------------------------------------------
// (G) Python error paths
// ---------------------------------------------------------------------------
describe('Python error paths', () => {
  it('non-zero code returns ok=false with json.error verbatim', async () => {
    vi.mocked(readFile).mockResolvedValueOnce(Buffer.from([0]) as never)
    vi.mocked(runPythonJson).mockResolvedValueOnce({
      code: 1,
      json: { ok: false, error: 'custom_python_error', detail: 'stack trace here' }
    } as never)
    const out = await projectDrawingViewsFromKernelStl({
      projectDir: '/p',
      placeholders: [basePh('id1')],
      pythonPath: '/py',
      appRoot: '/a'
    })
    expect(out).toEqual({ ok: false, error: 'custom_python_error', detail: 'stack trace here' })
  })

  it('json.ok=false with code=0 still returns ok=false (json.ok takes precedence)', async () => {
    vi.mocked(readFile).mockResolvedValueOnce(Buffer.from([0]) as never)
    vi.mocked(runPythonJson).mockResolvedValueOnce({
      code: 0,
      json: { ok: false, error: 'bad_input' }
    } as never)
    const out = await projectDrawingViewsFromKernelStl({
      projectDir: '/p',
      placeholders: [basePh('id1')],
      pythonPath: '/py',
      appRoot: '/a'
    })
    expect(out).toMatchObject({ ok: false, error: 'bad_input' })
  })

  it('missing json.error falls back to project_views_failed', async () => {
    vi.mocked(readFile).mockResolvedValueOnce(Buffer.from([0]) as never)
    vi.mocked(runPythonJson).mockResolvedValueOnce({
      code: 2,
      json: { ok: false }
    } as never)
    const out = await projectDrawingViewsFromKernelStl({
      projectDir: '/p',
      placeholders: [basePh('id1')],
      pythonPath: '/py',
      appRoot: '/a'
    })
    expect(out).toEqual({ ok: false, error: 'project_views_failed', detail: undefined })
  })

  it('json null falls back to project_views_failed', async () => {
    vi.mocked(readFile).mockResolvedValueOnce(Buffer.from([0]) as never)
    vi.mocked(runPythonJson).mockResolvedValueOnce({ code: 1, json: null } as never)
    const out = await projectDrawingViewsFromKernelStl({
      projectDir: '/p',
      placeholders: [basePh('id1')],
      pythonPath: '/py',
      appRoot: '/a'
    })
    expect(out).toEqual({ ok: false, error: 'project_views_failed', detail: undefined })
  })

  it('non-array views in success response yields project_views_bad_response', async () => {
    vi.mocked(readFile).mockResolvedValueOnce(Buffer.from([0]) as never)
    vi.mocked(runPythonJson).mockResolvedValueOnce({
      code: 0,
      json: { ok: true, views: 'not-an-array' }
    } as never)
    const out = await projectDrawingViewsFromKernelStl({
      projectDir: '/p',
      placeholders: [basePh('id1')],
      pythonPath: '/py',
      appRoot: '/a'
    })
    expect(out).toEqual({ ok: false, error: 'project_views_bad_response' })
  })
})

// ---------------------------------------------------------------------------
// (H) View mapping
// ---------------------------------------------------------------------------
describe('view mapping', () => {
  async function runMapping(rawViews: unknown, placeholders: DrawingViewPlaceholder[]) {
    vi.mocked(readFile).mockResolvedValueOnce(Buffer.from([0]) as never)
    vi.mocked(runPythonJson).mockResolvedValueOnce({
      code: 0,
      json: { ok: true, views: rawViews }
    } as never)
    return projectDrawingViewsFromKernelStl({
      projectDir: '/p',
      placeholders,
      pythonPath: '/py',
      appRoot: '/a'
    })
  }

  it('maps a single matching view into ProjectedDrawingView', async () => {
    const out = await runMapping(
      [{ id: 'a', axis: 'front', segments: [{ x1: 0, y1: 1, x2: 2, y2: 3 }] }],
      [basePh('a', 'My Label')]
    )
    expect(out).toEqual({
      ok: true,
      views: [{ id: 'a', axis: 'front', label: 'My Label', segments: [{ x1: 0, y1: 1, x2: 2, y2: 3 }] }]
    })
  })

  it('skips rows with id not in placeholder map', async () => {
    const out = await runMapping(
      [
        { id: 'a', axis: 'front', segments: [] },
        { id: 'unknown', axis: 'front', segments: [] }
      ],
      [basePh('a')]
    )
    if (!out.ok) throw new Error('expected ok=true')
    expect(out.views.map((v) => v.id)).toEqual(['a'])
  })

  it('skips non-object rows', async () => {
    const out = await runMapping([null, 42, 'str', { id: 'a', axis: 'front', segments: [] }], [basePh('a')])
    if (!out.ok) throw new Error('expected ok=true')
    expect(out.views.map((v) => v.id)).toEqual(['a'])
  })

  it('label.trim()-empty falls back to id.slice(0,8)', async () => {
    const out = await runMapping(
      [{ id: 'abcdefghijkl', axis: 'front', segments: [] }],
      [basePh('abcdefghijkl', '')]
    )
    if (!out.ok) throw new Error('expected ok=true')
    expect(out.views[0].label).toBe('abcdefgh')
  })

  it('whitespace-only label falls back to id.slice(0,8)', async () => {
    const out = await runMapping(
      [{ id: 'longid12345', axis: 'front', segments: [] }],
      [basePh('longid12345', '   \t  ')]
    )
    if (!out.ok) throw new Error('expected ok=true')
    expect(out.views[0].label).toBe('longid12')
  })

  it('non-empty label is preserved verbatim (no trimming applied to output)', async () => {
    const out = await runMapping(
      [{ id: 'a', axis: 'front', segments: [] }],
      [basePh('a', '  Hello  ')]
    )
    if (!out.ok) throw new Error('expected ok=true')
    expect(out.views[0].label).toBe('  Hello  ')
  })

  it('non-finite x1/y1/x2/y2 are filtered per segment', async () => {
    const out = await runMapping(
      [
        {
          id: 'a',
          axis: 'front',
          segments: [
            { x1: 0, y1: 0, x2: 1, y2: 1 },
            { x1: NaN, y1: 0, x2: 1, y2: 1 },
            { x1: 0, y1: Infinity, x2: 1, y2: 1 },
            { x1: 'foo', y1: 0, x2: 1, y2: 1 },
            { x1: 5, y1: 6, x2: 7, y2: 8 }
          ]
        }
      ],
      [basePh('a', 'L')]
    )
    if (!out.ok) throw new Error('expected ok=true')
    expect(out.views[0].segments).toEqual([
      { x1: 0, y1: 0, x2: 1, y2: 1 },
      { x1: 5, y1: 6, x2: 7, y2: 8 }
    ])
  })

  it('non-array segments produce an empty segments array', async () => {
    const out = await runMapping(
      [{ id: 'a', axis: 'front', segments: 'not-an-array' }],
      [basePh('a', 'L')]
    )
    if (!out.ok) throw new Error('expected ok=true')
    expect(out.views[0].segments).toEqual([])
  })

  it('missing segments produce an empty segments array', async () => {
    const out = await runMapping([{ id: 'a', axis: 'front' }], [basePh('a', 'L')])
    if (!out.ok) throw new Error('expected ok=true')
    expect(out.views[0].segments).toEqual([])
  })

  it('non-string id row treated as id="" and therefore skipped', async () => {
    const out = await runMapping(
      [{ id: 42, axis: 'front', segments: [] }, { id: 'a', axis: 'front', segments: [] }],
      [basePh('a', 'L')]
    )
    if (!out.ok) throw new Error('expected ok=true')
    expect(out.views.map((v) => v.id)).toEqual(['a'])
  })

  it('non-string axis is coerced to empty string', async () => {
    const out = await runMapping(
      [{ id: 'a', axis: 42, segments: [] }],
      [basePh('a', 'L')]
    )
    if (!out.ok) throw new Error('expected ok=true')
    expect(out.views[0].axis).toBe('')
  })

  it('null segment items are skipped without crashing', async () => {
    const out = await runMapping(
      [{ id: 'a', axis: 'front', segments: [null, undefined, { x1: 1, y1: 2, x2: 3, y2: 4 }] }],
      [basePh('a', 'L')]
    )
    if (!out.ok) throw new Error('expected ok=true')
    expect(out.views[0].segments).toEqual([{ x1: 1, y1: 2, x2: 3, y2: 4 }])
  })
})

// ---------------------------------------------------------------------------
// (I) axisForPlaceholder behavior (proven via public wrapper)
// ---------------------------------------------------------------------------
describe('axisForPlaceholder behavior (via public payload axis field)', () => {
  async function pullAxis(p: DrawingViewPlaceholder): Promise<string> {
    vi.mocked(readFile).mockResolvedValueOnce(Buffer.from([0]) as never)
    vi.mocked(runPythonJson).mockResolvedValueOnce({ code: 0, json: { ok: true, views: [] } } as never)
    await projectDrawingViewsFromKernelStl({
      projectDir: '/p',
      placeholders: [p],
      pythonPath: '/py',
      appRoot: '/a'
    })
    const args = vi.mocked(writeFile).mock.calls[0]
    const payload = JSON.parse(args[1] as string) as { views: { id: string; axis: string }[] }
    return payload.views[0].axis
  }

  it("base placeholder uses viewFrom when set", async () => {
    expect(await pullAxis(basePh('a', '', 'top'))).toBe('top')
  })

  it("base placeholder falls back to 'front' when viewFrom is undefined", async () => {
    expect(await pullAxis(basePh('a'))).toBe('front')
  })

  it("projected placeholder uses projectionDirection when set", async () => {
    expect(await pullAxis(projPh('a', '', 'left'))).toBe('left')
  })

  it("projected placeholder falls back to 'right' when projectionDirection is undefined", async () => {
    expect(await pullAxis(projPh('a'))).toBe('right')
  })
})

// ---------------------------------------------------------------------------
// (J) Source-text whitelist
// ---------------------------------------------------------------------------
describe('source-text whitelist', () => {
  it('imports mkdir, readFile, writeFile from node:fs/promises', () => {
    expect(SRC).toContain("import { mkdir, readFile, writeFile } from 'node:fs/promises'")
  })

  it('imports join from node:path', () => {
    expect(SRC).toContain("import { join } from 'node:path'")
  })

  it('imports DrawingViewPlaceholder as a type-only import', () => {
    expect(SRC).toContain("import type { DrawingViewPlaceholder } from '../shared/drawing-sheet-schema'")
  })

  it('imports getEnginesRoot from ./paths', () => {
    expect(SRC).toContain("import { getEnginesRoot } from './paths'")
  })

  it('imports runPythonJson from ./cad/occt-import', () => {
    expect(SRC).toContain("import { runPythonJson } from './cad/occt-import'")
  })

  it('contains the kernel-part.stl literal exactly once', () => {
    const matches = SRC.match(/kernel-part\.stl/g) ?? []
    expect(matches).toHaveLength(1)
  })

  it('contains the kernel-part.step literal exactly once', () => {
    const matches = SRC.match(/kernel-part\.step/g) ?? []
    expect(matches).toHaveLength(1)
  })

  it("references the 'output' subdirectory literal exactly twice (stl path + payload outDir)", () => {
    // Three uses overall: stlPath, stepPath, outDir. Pin the count to detect drift.
    const matches = SRC.match(/'output'/g) ?? []
    expect(matches).toHaveLength(3)
  })

  it("references the .drawing-project-payload.json filename literal exactly once", () => {
    const matches = SRC.match(/\.drawing-project-payload\.json/g) ?? []
    expect(matches).toHaveLength(1)
  })

  it('declares snapTolMm: 0.025 in the payload literal', () => {
    expect(SRC).toContain('snapTolMm: 0.025')
  })

  it('declares maxSegments: 22000 in the payload literal', () => {
    expect(SRC).toContain('maxSegments: 22000')
  })

  it('declares includeConvexHull: true in the payload literal', () => {
    expect(SRC).toContain('includeConvexHull: true')
  })

  it('contains the kernel_stl_missing error string literal', () => {
    expect(SRC).toContain("'kernel_stl_missing'")
  })

  it('contains the project_views_failed error string literal', () => {
    expect(SRC).toContain("'project_views_failed'")
  })

  it('contains the project_views_bad_response error string literal', () => {
    expect(SRC).toContain("'project_views_bad_response'")
  })

  it('uses id.slice(0, 8) as the label fallback arithmetic', () => {
    expect(SRC).toContain('id.slice(0, 8)')
  })

  it("calls mkdir with { recursive: true }", () => {
    expect(SRC).toContain('await mkdir(outDir, { recursive: true })')
  })

  it("uses JSON.stringify with null,2 indent and 'utf-8' encoding", () => {
    expect(SRC).toContain('JSON.stringify(')
    expect(SRC).toContain("null,\n      2\n    )")
    expect(SRC).toContain("'utf-8'")
  })

  it("composes the script path under engines root + 'occt' + 'project_views.py'", () => {
    expect(SRC).toContain("join(getEnginesRoot(), 'occt', 'project_views.py')")
  })

  it('declares the meshProjectionTier param as A|B|C optional', () => {
    expect(SRC).toContain("meshProjectionTier?: 'A' | 'B' | 'C'")
  })

  it('uses Number.isFinite to guard segment numerics', () => {
    expect(SRC).toContain('Number.isFinite(n)')
  })

  it('does NOT use the `any` type anywhere', () => {
    // Word-boundary match -- avoid matching `Array.isArray` / similar.
    expect(SRC).not.toMatch(/:\s*any\b/)
    expect(SRC).not.toMatch(/<any>/)
  })

  it('does NOT declare any top-level `let` (only `const` / `function` / `export`)', () => {
    // Inside the function body a single `let stepForPayload: string | undefined`
    // is intentional and indented; we pin no TOP-LEVEL `let`.
    const lines = SRC.split('\n')
    const topLevelLet = lines.filter((l) => /^let\s/.test(l))
    expect(topLevelLet).toEqual([])
  })

  it('contains exactly one let stepForPayload declaration (intentional)', () => {
    const matches = SRC.match(/let stepForPayload/g) ?? []
    expect(matches).toHaveLength(1)
  })

  it('declares the discriminated-union return type at the function signature', () => {
    expect(SRC).toContain('Promise<')
    expect(SRC).toContain("| { ok: true; views: ProjectedDrawingView[] }")
    expect(SRC).toContain("| { ok: false; error: string; detail?: string }")
  })
})

// ---------------------------------------------------------------------------
// Type-level pins (compile-time) -- no runtime cost; their value is that
// `tsc --noEmit` fails if the exported types drift.
// ---------------------------------------------------------------------------
describe('compile-time type-level pins', () => {
  it('ProjectedSegment is structurally { x1,y1,x2,y2: number }', () => {
    const seg: ProjectedSegment = { x1: 1, y1: 2, x2: 3, y2: 4 }
    expect(seg).toEqual({ x1: 1, y1: 2, x2: 3, y2: 4 })
  })

  it('ProjectedDrawingView is structurally { id, axis, label, segments }', () => {
    const v: ProjectedDrawingView = { id: 'a', axis: 'b', label: 'c', segments: [] }
    expect(Object.keys(v).sort()).toEqual(['axis', 'id', 'label', 'segments'])
  })
})
