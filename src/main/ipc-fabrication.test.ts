import { describe, expect, it, vi, beforeEach } from 'vitest'

// Track registered handlers
const handlers = new Map<string, Function>()

vi.mock('electron', () => ({
  app: {
    getAppPath: vi.fn().mockReturnValue('/mock/app'),
    getPath: vi.fn().mockReturnValue('/mock/userData')
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn()
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: Function) => {
      handlers.set(channel, handler)
    })
  }
}))

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue('{}'),
  writeFile: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('./cam-operation-policy', () => ({
  describeCamOperationKind: vi.fn().mockReturnValue({ runnable: true })
}))

vi.mock('./cam-runner', () => ({
  runCamPipeline: vi.fn()
}))

vi.mock('./posts-manager', () => ({
  listAllPosts: vi.fn().mockResolvedValue([]),
  saveUserPost: vi.fn().mockResolvedValue({ filename: 'test.hbs', path: '/p', source: 'user', preview: '' }),
  readPostContent: vi.fn().mockResolvedValue('template content')
}))

vi.mock('./materials-manager', () => ({
  deleteMaterial: vi.fn().mockResolvedValue(true),
  importMaterialsFile: vi.fn().mockResolvedValue([]),
  importMaterialsJson: vi.fn().mockResolvedValue([]),
  listAllMaterials: vi.fn().mockResolvedValue([]),
  saveMaterial: vi.fn().mockResolvedValue({})
}))

vi.mock('./carvera-cli-run', () => ({
  carveraUpload: vi.fn()
}))

vi.mock('../shared/carvera-zeroing', () => ({
  generateCarvera4AxisSetup: vi.fn().mockReturnValue('G28'),
  generateCarveraAAxisZero: vi.fn().mockReturnValue('G28 A0'),
  generateCarveraPreflightCheck: vi.fn().mockReturnValue('; preflight'),
  generateCarveraWcsZero: vi.fn().mockReturnValue('G10 L20'),
  generateCarveraZProbe: vi.fn().mockReturnValue('G38.2')
}))

vi.mock('./moonraker-push', () => ({
  moonrakerCancel: vi.fn(),
  moonrakerPause: vi.fn(),
  moonrakerPush: vi.fn(),
  moonrakerResume: vi.fn(),
  moonrakerStatus: vi.fn()
}))

vi.mock('./machines', () => ({
  deleteUserMachine: vi.fn(),
  getMachineById: vi.fn(),
  importMachineProfileFromFile: vi.fn(),
  loadAllMachines: vi.fn().mockResolvedValue([]),
  loadMachineCatalog: vi.fn().mockResolvedValue({ machines: [], diagnostics: [] }),
  parseMachineProfileText: vi.fn(),
  saveUserMachine: vi.fn()
}))

vi.mock('./machine-tool-library', () => ({
  loadMachineToolLibrary: vi.fn().mockResolvedValue({ version: 1, tools: [] }),
  saveMachineToolLibrary: vi.fn()
}))

vi.mock('./paths', () => ({
  getResourcesRoot: vi.fn().mockReturnValue('/mock/resources')
}))

vi.mock('./slicer', () => ({
  sliceWithCuraEngine: vi.fn(),
  stageStlForProject: vi.fn()
}))

vi.mock('./tools-import', () => ({
  inferToolRecordsFromFileBuffer: vi.fn().mockReturnValue([]),
  mergeToolLibraries: vi.fn().mockReturnValue({ version: 1, tools: [] }),
  parseFusionToolExport: vi.fn().mockReturnValue([]),
  parseFusionToolsCsv: vi.fn().mockReturnValue([]),
  parseToolsCsv: vi.fn().mockReturnValue([]),
  parseToolsJson: vi.fn().mockReturnValue({ tools: [] })
}))

vi.mock('./machine-cps-import', () => ({
  machineProfileWithSummaryFromCps: vi.fn()
}))

vi.mock('../shared/file-parse-errors', () => ({
  formatZodError: vi.fn().mockReturnValue('zod error'),
  isENOENT: vi.fn().mockReturnValue(false),
  parseJsonText: vi.fn((t: string) => JSON.parse(t))
}))

vi.mock('../shared/manufacture-schema', () => ({
  emptyManufacture: vi.fn().mockReturnValue({ version: 1, operations: [] }),
  manufactureFileSchema: { parse: vi.fn((v: unknown) => v) }
}))

vi.mock('../shared/schema-migration', () => ({
  buildMigrationPipeline: vi.fn().mockReturnValue({ migrate: (v: unknown) => v })
}))

vi.mock('../shared/tool-schema', () => ({
  toolLibraryFileSchema: { parse: vi.fn((v: unknown) => v) }
}))

vi.mock('./settings-store', () => ({
  loadSettings: vi.fn().mockResolvedValue({ theme: 'dark', recentProjectPaths: [] })
}))

vi.mock('../shared/dxf-parser', () => ({
  parseDxf: vi.fn().mockReturnValue({ entities: [{ type: 'line', layer: '0' }], layers: ['0'] }),
  convertDxfToMm: vi.fn()
}))

vi.mock('../shared/material-audit', () => ({
  auditMaterialPresets: vi.fn().mockReturnValue({ totalChecks: 0, issues: [], allFindings: [] })
}))

vi.mock('../shared/fixture-collision', () => ({
  checkFixtureCollision: vi.fn().mockReturnValue({ safe: true, collisions: [] })
}))

vi.mock('../shared/fixture-schema', () => ({}))

vi.mock('../shared/multi-setup-utils', () => ({
  autoAssignWcsOffsets: vi.fn().mockImplementation((setups: Array<{ id: string }>) =>
    setups.map((s, i) => ({ ...s, workCoordinateIndex: i + 1 }))
  ),
  validateSetupSequence: vi.fn().mockReturnValue({ valid: true, issues: [] }),
  suggestFlipSetup: vi.fn().mockReturnValue({
    setup: { id: 'flip', label: 'Flip', workCoordinateIndex: 2 },
    flipAxis: 'X',
    note: 'Flipped around X axis'
  })
}))

vi.mock('../shared/probing-cycles', () => ({
  generateProbeCycle: vi.fn().mockReturnValue('; probe cycle\nG38.2 Z-50 F100\nG10 L2 P1 Z0\nG43')
}))

import { registerFabricationIpc } from './ipc-fabrication'
import type { MainIpcWindowContext } from './ipc-context'

function createMockContext(): MainIpcWindowContext {
  return {
    getMainWindow: () => null
  }
}

describe('ipc-fabrication', () => {
  beforeEach(() => {
    handlers.clear()
  })

  it('registerFabricationIpc registers all expected channels', () => {
    const ctx = createMockContext()
    registerFabricationIpc(ctx)

    const expectedChannels = [
      'machines:list',
      'machines:catalog',
      'machines:saveUser',
      'machines:deleteUser',
      'machines:importJson',
      'machines:importFile',
      'machines:exportUser',
      'stl:stage',
      'stl:transformForCam',
      'slice:cura',
      'cam:run',
      'cam:cancel',
      'tools:read',
      'tools:save',
      'tools:import',
      'tools:importFile',
      'machineTools:read',
      'machineTools:save',
      'machineTools:import',
      'machineTools:importFile',
      'machineTools:migrateFromProject',
      'manufacture:load',
      'manufacture:save',
      'posts:list',
      'posts:save',
      'posts:read',
      'posts:uploadFile',
      'posts:pickAndUpload',
      'carvera:upload',
      'carvera:generateSetup',
      'moonraker:push',
      'moonraker:status',
      'moonraker:cancel',
      'moonraker:pause',
      'moonraker:resume',
      'materials:list',
      'materials:save',
      'materials:delete',
      'materials:importJson',
      'materials:importFile',
      'materials:pickAndImport',
      'fs:readBase64',
      'machines:importCpsFile',
      'machines:pickAndImportCps',
      'dxf:import',
      'material:audit',
      'fixture:checkCollision',
      'setup:autoAssignWcs',
      'setup:validate',
      'setup:suggestFlip',
      'probe:generate'
    ]

    for (const ch of expectedChannels) {
      expect(handlers.has(ch), `missing handler for channel "${ch}"`).toBe(true)
    }
  })

  it('machines:list returns machine list', async () => {
    registerFabricationIpc(createMockContext())
    const handler = handlers.get('machines:list')!
    const result = await handler()
    expect(Array.isArray(result)).toBe(true)
  })

  it('machines:catalog returns catalog with machines and diagnostics', async () => {
    registerFabricationIpc(createMockContext())
    const handler = handlers.get('machines:catalog')!
    const result = await handler()
    expect(result).toHaveProperty('machines')
    expect(result).toHaveProperty('diagnostics')
  })

  it('cam:cancel returns cancelled false when no active job', async () => {
    registerFabricationIpc(createMockContext())
    const handler = handlers.get('cam:cancel')!
    const result = await handler()
    expect(result).toEqual({ cancelled: false })
  })

  it('posts:list calls listAllPosts', async () => {
    registerFabricationIpc(createMockContext())
    const handler = handlers.get('posts:list')!
    const result = await handler()
    expect(Array.isArray(result)).toBe(true)
  })

  it('posts:read returns template content', async () => {
    registerFabricationIpc(createMockContext())
    const handler = handlers.get('posts:read')!
    const result = await handler({}, 'test.hbs')
    expect(result).toBe('template content')
  })

  it('materials:list returns a list', async () => {
    registerFabricationIpc(createMockContext())
    const handler = handlers.get('materials:list')!
    const result = await handler()
    expect(Array.isArray(result)).toBe(true)
  })

  it('materials:delete returns boolean', async () => {
    registerFabricationIpc(createMockContext())
    const handler = handlers.get('materials:delete')!
    const result = await handler({}, 'some-id')
    expect(typeof result).toBe('boolean')
  })

  it('machines:exportUser returns error when no window', async () => {
    registerFabricationIpc(createMockContext())
    const handler = handlers.get('machines:exportUser')!
    const result = await handler({}, 'machine-1')
    expect(result).toEqual({ ok: false, error: 'no_window' })
  })

  it('dxf:import returns parsed DXF result', async () => {
    registerFabricationIpc(createMockContext())
    const handler = handlers.get('dxf:import')!
    const result = await handler({}, '/test/file.dxf')
    expect(result.ok).toBe(true)
  })

  it('material:audit returns audit result', async () => {
    registerFabricationIpc(createMockContext())
    const handler = handlers.get('material:audit')!
    const result = await handler()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(typeof result.totalChecks).toBe('number')
      expect(Array.isArray(result.issues)).toBe(true)
    }
  })

  it('fixture:checkCollision returns result', async () => {
    registerFabricationIpc(createMockContext())
    const handler = handlers.get('fixture:checkCollision')!
    const result = await handler({}, {
      toolpath: [],
      fixture: { id: 'test', name: 'Test', type: 'vise', geometry: [], clampingPositions: [] },
      toolDiameterMm: 6
    })
    expect(result.ok).toBe(true)
  })

  it('setup:autoAssignWcs assigns WCS offsets to setups', async () => {
    registerFabricationIpc(createMockContext())
    const handler = handlers.get('setup:autoAssignWcs')!
    const setups = [
      { id: 's1', label: 'Setup 1', machineId: 'm1' },
      { id: 's2', label: 'Setup 2', machineId: 'm1' }
    ]
    const result = await handler({}, setups)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.setups).toHaveLength(2)
      expect(result.setups[0].workCoordinateIndex).toBe(1)
      expect(result.setups[1].workCoordinateIndex).toBe(2)
    }
  })

  it('setup:validate returns validation result', async () => {
    registerFabricationIpc(createMockContext())
    const handler = handlers.get('setup:validate')!
    const result = await handler({}, [])
    expect(result.ok).toBe(true)
  })

  it('setup:suggestFlip returns flip suggestion', async () => {
    registerFabricationIpc(createMockContext())
    const handler = handlers.get('setup:suggestFlip')!
    const result = await handler({}, {
      currentSetup: { id: 's1', label: 'Setup 1', machineId: 'm1', workCoordinateIndex: 1 },
      existingSetups: [],
      flipAxis: 'X'
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.setup).toBeDefined()
      expect(result.flipAxis).toBe('X')
    }
  })

  it('probe:generate returns G-code', async () => {
    registerFabricationIpc(createMockContext())
    const handler = handlers.get('probe:generate')!
    const result = await handler({}, {
      type: 'singleSurface',
      params: { probeFeedMmMin: 100, retractMm: 3, wcsIndex: 1, axis: 'z', direction: -1, maxTravelMm: 50 }
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(typeof result.gcode).toBe('string')
      expect(result.gcode.length).toBeGreaterThan(0)
    }
  })
})
