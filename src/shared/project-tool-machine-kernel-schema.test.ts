import { describe, expect, it } from 'vitest'
import { emptyKernelManifest, kernelManifestSchema } from './kernel-manifest-schema'
import { machineProfileSchema } from './machine-schema'
import { appSettingsSchema, projectSchema } from './project-schema'
import { toolLibraryFileSchema, toolRecordSchema } from './tool-schema'

describe('project-schema', () => {
  it('parses minimal project.json', () => {
    const p = projectSchema.parse({
      version: 1,
      name: 'Demo',
      updatedAt: '2025-01-01T00:00:00.000Z',
      activeMachineId: 'm1'
    })
    expect(p.meshes).toEqual([])
    expect(p.importHistory).toEqual([])
  })

  it('parses optional physicalMaterial and appearanceNotes', () => {
    const p = projectSchema.parse({
      version: 1,
      name: 'Demo',
      updatedAt: '2025-01-01T00:00:00.000Z',
      activeMachineId: 'm1',
      physicalMaterial: { name: 'PLA', densityKgM3: 1250 },
      appearanceNotes: 'Matte black'
    })
    expect(p.physicalMaterial?.name).toBe('PLA')
    expect(p.physicalMaterial?.densityKgM3).toBe(1250)
    expect(p.appearanceNotes).toBe('Matte black')
  })

  it('trims name and activeMachineId', () => {
    const p = projectSchema.parse({
      version: 1,
      name: '  Job  ',
      updatedAt: '2025-01-01T00:00:00.000Z',
      activeMachineId: '  mid  '
    })
    expect(p.name).toBe('Job')
    expect(p.activeMachineId).toBe('mid')
  })

  it('rejects empty or whitespace-only name', () => {
    expect(() =>
      projectSchema.parse({
        version: 1,
        name: '   ',
        updatedAt: '2025-01-01T00:00:00.000Z',
        activeMachineId: 'm1'
      })
    ).toThrow()
  })

  it('rejects empty or whitespace-only activeMachineId', () => {
    expect(() =>
      projectSchema.parse({
        version: 1,
        name: 'X',
        updatedAt: '2025-01-01T00:00:00.000Z',
        activeMachineId: ''
      })
    ).toThrow()
  })

  it('appSettingsSchema defaults theme to dark', () => {
    expect(appSettingsSchema.parse({}).theme).toBe('dark')
  })

  it('appSettingsSchema defaults recentProjectPaths to empty', () => {
    expect(appSettingsSchema.parse({}).recentProjectPaths).toEqual([])
  })
})

describe('tool-schema', () => {
  it('parses tool record and library file', () => {
    const tool = toolRecordSchema.parse({
      id: 't1',
      name: '6mm',
      type: 'endmill',
      diameterMm: 6
    })
    expect(tool.id).toBe('t1')
    const lib = toolLibraryFileSchema.parse({ version: 1, tools: [tool] })
    expect(lib.tools).toHaveLength(1)
  })

  it('trims id and name', () => {
    const tool = toolRecordSchema.parse({
      id: '  t1  ',
      name: '  6mm  ',
      type: 'endmill',
      diameterMm: 6
    })
    expect(tool.id).toBe('t1')
    expect(tool.name).toBe('6mm')
  })

  it('rejects empty id or name after trim', () => {
    expect(() =>
      toolRecordSchema.parse({
        id: '',
        name: 'x',
        type: 'endmill',
        diameterMm: 1
      })
    ).toThrow()
    expect(() =>
      toolRecordSchema.parse({
        id: 'x',
        name: '  ',
        type: 'endmill',
        diameterMm: 1
      })
    ).toThrow()
  })
})

describe('machine-schema', () => {
  it('parses CNC profile', () => {
    const m = machineProfileSchema.parse({
      id: 'cnc1',
      name: 'Bench',
      kind: 'cnc',
      workAreaMm: { x: 200, y: 200, z: 50 },
      maxFeedMmMin: 3000,
      postTemplate: 'grbl_mm.hbs',
      dialect: 'grbl'
    })
    expect(m.kind).toBe('cnc')
  })
})

describe('kernel-manifest-schema', () => {
  it('emptyKernelManifest matches schema', () => {
    const m = emptyKernelManifest()
    expect(kernelManifestSchema.parse(m)).toMatchObject({
      version: 1,
      ok: false,
      error: 'never_built'
    })
  })

  it('parses success manifest with optional fields', () => {
    const m = kernelManifestSchema.parse({
      version: 1,
      builtAt: '2025-01-01T00:00:00.000Z',
      ok: true,
      stepPath: 'part/out.step',
      payloadVersion: 3,
      loftStrategy: 'smooth+align'
    })
    expect(m.ok).toBe(true)
  })
})
