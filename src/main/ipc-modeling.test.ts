import { describe, expect, it, vi, beforeEach } from 'vitest'

// Track registered handlers
const handlers = new Map<string, Function>()

vi.mock('electron', () => ({
  app: {
    getAppPath: vi.fn().mockReturnValue('/mock/app'),
    getPath: vi.fn().mockReturnValue('/mock/temp')
  },
  BrowserWindow: {
    getFocusedWindow: vi.fn().mockReturnValue(null),
    getAllWindows: vi.fn().mockReturnValue([])
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: Function) => {
      handlers.set(channel, handler)
    })
  }
}))

vi.mock('node:fs/promises', () => ({
  mkdtemp: vi.fn().mockResolvedValue('/tmp/ufs-mesh-preview-xyz'),
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue('{}'),
  rm: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('./assembly-mesh-interference', () => ({
  buildAssemblyInterferenceReport: vi.fn().mockResolvedValue({ ok: true, pairs: [] }),
  safeProjectMeshPath: vi.fn().mockReturnValue(null)
}))

vi.mock('./cad/build-kernel-part', () => ({
  buildKernelPartFromProject: vi.fn()
}))

vi.mock('./cad/kernel-placement-parity', () => ({
  comparePlacementParityFromBounds: vi.fn()
}))

vi.mock('./cad/occt-import', () => ({
  importStepToProjectStl: vi.fn(),
  runPythonJson: vi.fn()
}))

vi.mock('./drawing-export-service', () => ({
  runDrawingExport: vi.fn()
}))

vi.mock('./drawing-file-store', () => ({
  loadDrawingFile: vi.fn().mockResolvedValue(null),
  saveDrawingFile: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('./mesh-import-registry', () => ({
  importMeshViaRegistry: vi.fn()
}))

vi.mock('./paths', () => ({
  getEnginesRoot: vi.fn().mockReturnValue('/mock/engines')
}))

vi.mock('./stl', () => ({
  isLikelyAsciiStl: vi.fn().mockReturnValue(false),
  parseBinaryStl: vi.fn().mockReturnValue({ min: [0, 0, 0], max: [1, 1, 1], triangleCount: 1 })
}))

vi.mock('../shared/assembly-schema', () => ({
  assemblyFileSchema: { parse: vi.fn((v: unknown) => v) },
  buildAssemblyBomCsvLines: vi.fn().mockReturnValue(['Part,Qty', 'Bracket,1']),
  buildAssemblySummaryReport: vi.fn().mockReturnValue({}),
  buildBomHierarchyJsonText: vi.fn().mockReturnValue('{}'),
  buildHierarchicalBomText: vi.fn().mockReturnValue(''),
  emptyAssembly: vi.fn().mockReturnValue({ version: 1, name: '', components: [] }),
  parseAssemblyFile: vi.fn().mockReturnValue({ version: 1, name: '', components: [] })
}))

vi.mock('../shared/assembly-kinematics-core', () => ({
  solveAssemblyKinematics: vi.fn().mockReturnValue({ transforms: new Map(), diagnostics: [] })
}))

vi.mock('../shared/design-schema', () => ({
  designFileSchemaV2: { parse: vi.fn((v: unknown) => v) },
  designParametersExportSchema: { safeParse: vi.fn().mockReturnValue({ success: true, data: { parameters: {} } }) },
  emptyDesign: vi.fn().mockReturnValue({ version: 2, elements: [], parameters: {} }),
  mergeParametersIntoDesign: vi.fn().mockReturnValue({ version: 2, elements: [], parameters: {} }),
  normalizeDesign: vi.fn().mockReturnValue({ version: 2, elements: [], parameters: {} })
}))

vi.mock('../shared/drawing-sheet-schema', () => ({
  parseDrawingFile: vi.fn().mockReturnValue({ version: 1, sheets: [] })
}))

vi.mock('../shared/file-parse-errors', () => ({
  formatZodError: vi.fn().mockReturnValue('zod error'),
  isENOENT: vi.fn().mockReturnValue(false),
  parseJsonText: vi.fn((t: string) => JSON.parse(t))
}))

vi.mock('../shared/kernel-manifest-schema', () => ({
  kernelManifestSchema: {
    safeParse: vi.fn().mockReturnValue({ success: false })
  }
}))

vi.mock('../shared/part-features-schema', () => ({
  defaultPartFeatures: vi.fn().mockReturnValue({ version: 1, features: [] }),
  partFeaturesFileSchema: { parse: vi.fn((v: unknown) => v) }
}))

vi.mock('../shared/mesh-import-placement', () => ({
  parseMeshImportPlacementPayload: vi.fn().mockReturnValue({})
}))

import { registerModelingIpc } from './ipc-modeling'
import type { MainIpcWindowContext } from './ipc-context'

function createMockContext(): MainIpcWindowContext {
  return {
    getMainWindow: () => null
  }
}

describe('ipc-modeling', () => {
  beforeEach(() => {
    handlers.clear()
  })

  it('registerModelingIpc registers all expected channels', () => {
    const ctx = createMockContext()
    registerModelingIpc(ctx)

    const expectedChannels = [
      'drawing:export',
      'drawing:load',
      'drawing:save',
      'cad:importStl',
      'cad:importStep',
      'assets:importMesh',
      'mesh:previewStlBase64',
      'cad:kernelBuild',
      'cad:comparePreviewKernel',
      'design:load',
      'design:readKernelManifest',
      'design:readKernelStlBase64',
      'design:save',
      'design:exportParameters',
      'design:mergeParameters',
      'assembly:load',
      'assembly:save',
      'assembly:exportBom',
      'assembly:exportBomHierarchical',
      'assembly:exportBomHierarchyJson',
      'assembly:saveInterferenceReport',
      'assembly:interferenceCheck',
      'assembly:interferenceCheckSimulated',
      'assembly:summary',
      'assembly:solve',
      'assembly:simulate',
      'assembly:readStlBase64',
      'features:load',
      'features:save',
      'model:exportStl'
    ]

    for (const ch of expectedChannels) {
      expect(handlers.has(ch), `missing handler for channel "${ch}"`).toBe(true)
    }
  })

  it('drawing:load returns loaded drawing file', async () => {
    registerModelingIpc(createMockContext())
    const handler = handlers.get('drawing:load')!
    const result = await handler({}, '/project/dir')
    expect(result).toBeNull()
  })

  it('assembly:load returns empty assembly for missing file', async () => {
    const { isENOENT } = await import('../shared/file-parse-errors')
    vi.mocked(isENOENT).mockReturnValueOnce(true)
    const { readFile } = await import('node:fs/promises')
    vi.mocked(readFile).mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

    registerModelingIpc(createMockContext())
    const handler = handlers.get('assembly:load')!
    const result = await handler({}, '/project')
    expect(result).toHaveProperty('components')
  })

  it('assembly:solve returns transforms and diagnostics', async () => {
    registerModelingIpc(createMockContext())
    const handler = handlers.get('assembly:solve')!
    const result = await handler({}, { version: 1, name: '', components: [] })
    expect(result).toHaveProperty('ok', true)
    expect(result).toHaveProperty('transforms')
    expect(result).toHaveProperty('diagnostics')
  })

  it('assembly:simulate returns poses array', async () => {
    registerModelingIpc(createMockContext())
    const handler = handlers.get('assembly:simulate')!
    const result = await handler({}, { version: 1, name: '', components: [] }, 5)
    expect(result).toHaveProperty('ok', true)
    expect(result).toHaveProperty('sampleCount')
    expect(result).toHaveProperty('poses')
    expect(Array.isArray(result.poses)).toBe(true)
  })

  it('assembly:simulate clamps sampleCount to valid range', async () => {
    registerModelingIpc(createMockContext())
    const handler = handlers.get('assembly:simulate')!
    const result = await handler({}, { version: 1, name: '', components: [] }, 500)
    expect(result.sampleCount).toBeLessThanOrEqual(200)
  })

  it('drawing:export returns error when no window', async () => {
    registerModelingIpc(createMockContext())
    const handler = handlers.get('drawing:export')!
    const result = await handler({}, { projectDir: '/test' })
    expect(result).toHaveProperty('ok', false)
  })

  it('model:exportStl rejects invalid filenames', async () => {
    registerModelingIpc(createMockContext())
    const handler = handlers.get('model:exportStl')!

    const noStlExt = await handler({}, { projectDir: '/p', filename: 'model.obj', base64: '' })
    expect(noStlExt).toEqual({ ok: false, error: 'invalid_filename' })

    // Filenames with invalid characters are rejected
    const badChars = await handler({}, { projectDir: '/p', filename: 'bad<name>.stl', base64: '' })
    expect(badChars).toEqual({ ok: false, error: 'invalid_filename' })

    // Double-dot within the basename itself is rejected
    const dotDot = await handler({}, { projectDir: '/p', filename: '..model.stl', base64: '' })
    expect(dotDot).toEqual({ ok: false, error: 'invalid_filename' })
  })

  it('assembly:readStlBase64 returns error for unsafe path', async () => {
    registerModelingIpc(createMockContext())
    const handler = handlers.get('assembly:readStlBase64')!
    const result = await handler({}, '/project', '../../etc/passwd')
    expect(result).toEqual({ ok: false, error: 'invalid_or_unsafe_mesh_path' })
  })

  it('mesh:previewStlBase64 routes IGES files through STEP/IGES converter', async () => {
    const { importStepToProjectStl } = await import('./cad/occt-import')
    vi.mocked(importStepToProjectStl).mockResolvedValueOnce({
      ok: true,
      stlPath: '/tmp/ufs-mesh-preview-xyz/bracket.stl'
    })
    const { readFile } = await import('node:fs/promises')
    // Return a minimal binary STL buffer (84 bytes header + 0 triangles)
    const stlBuf = Buffer.alloc(84)
    vi.mocked(readFile).mockResolvedValueOnce(stlBuf as never)

    registerModelingIpc(createMockContext())
    const handler = handlers.get('mesh:previewStlBase64')!
    const result = await handler({}, '/parts/bracket.iges', 'python')
    expect(importStepToProjectStl).toHaveBeenCalled()
    expect(result).toHaveProperty('ok', true)
    expect(result).toHaveProperty('base64')
  })

  it('mesh:previewStlBase64 routes IGS files through STEP/IGES converter', async () => {
    const { importStepToProjectStl } = await import('./cad/occt-import')
    vi.mocked(importStepToProjectStl).mockResolvedValueOnce({
      ok: true,
      stlPath: '/tmp/ufs-mesh-preview-xyz/part.stl'
    })
    const { readFile } = await import('node:fs/promises')
    const stlBuf = Buffer.alloc(84)
    vi.mocked(readFile).mockResolvedValueOnce(stlBuf as never)

    registerModelingIpc(createMockContext())
    const handler = handlers.get('mesh:previewStlBase64')!
    const result = await handler({}, '/parts/part.igs', 'python')
    expect(importStepToProjectStl).toHaveBeenCalled()
    expect(result).toHaveProperty('ok', true)
  })
})
