import { describe, expect, it } from 'vitest'
import { evaluateManufactureReadiness } from './manufacture-readiness'
import type { ManufactureFile } from './manufacture-schema'
import type { ProjectFile } from './project-schema'

function mkProject(): ProjectFile {
  return {
    version: 1,
    name: 'T',
    updatedAt: new Date().toISOString(),
    activeMachineId: 'm1',
    meshes: ['assets/a.stl'],
    importHistory: []
  }
}

function mkMfg(kind: 'cnc_parallel' | 'fdm_slice'): ManufactureFile {
  return {
    version: 1,
    setups: [],
    operations: [{ id: 'o1', label: 'Op', kind, suppressed: false }]
  }
}

describe('evaluateManufactureReadiness', () => {
  it('reports slice/cam readiness when requirements are met', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject(),
      settings: { recentProjectPaths: [], theme: 'dark', curaEnginePath: 'cura.exe' },
      machines: [
        {
          id: 'm1',
          name: 'CNC',
          kind: 'cnc',
          workAreaMm: { x: 1, y: 1, z: 1 },
          maxFeedMmMin: 1,
          postTemplate: 'a',
          dialect: 'grbl'
        }
      ],
      manufacture: mkMfg('cnc_parallel')
    })
    expect(r.canSlice).toBe(true)
    expect(r.canCam).toBe(true)
  })

  it('blocks cam when first operation is non-cnc', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject(),
      settings: { recentProjectPaths: [], theme: 'dark', curaEnginePath: 'cura.exe' },
      machines: [
        {
          id: 'm1',
          name: 'CNC',
          kind: 'cnc',
          workAreaMm: { x: 1, y: 1, z: 1 },
          maxFeedMmMin: 1,
          postTemplate: 'a',
          dialect: 'grbl'
        }
      ],
      manufacture: mkMfg('fdm_slice')
    })
    expect(r.canCam).toBe(false)
    expect(r.issues.some((i) => i.id === 'cam_non_cnc_first_op')).toBe(true)
  })

  it('reports project_missing when project is null', () => {
    const r = evaluateManufactureReadiness({
      project: null,
      settings: null,
      machines: [],
      manufacture: null
    })
    expect(r.canSlice).toBe(false)
    expect(r.canCam).toBe(false)
    expect(r.issues.some((i) => i.id === 'project_missing')).toBe(true)
  })

  it('reports settings_cura_missing when curaEnginePath is absent', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject(),
      settings: { recentProjectPaths: [], theme: 'dark', curaEnginePath: '' },
      machines: [{ id: 'm1', name: 'CNC', kind: 'cnc', workAreaMm: { x: 1, y: 1, z: 1 }, maxFeedMmMin: 1, postTemplate: 'a', dialect: 'grbl' }],
      manufacture: null
    })
    expect(r.canSlice).toBe(false)
    expect(r.issues.some((i) => i.id === 'settings_cura_missing')).toBe(true)
  })

  it('reports machine_missing when activeMachineId does not match any profile', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject(), // activeMachineId = 'm1'
      settings: null,
      machines: [{ id: 'other', name: 'CNC', kind: 'cnc', workAreaMm: { x: 1, y: 1, z: 1 }, maxFeedMmMin: 1, postTemplate: 'a', dialect: 'grbl' }],
      manufacture: null
    })
    expect(r.issues.some((i) => i.id === 'machine_missing')).toBe(true)
  })

  it('reports cam_cnc_machine_missing when machines list has no cnc profile', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject(),
      settings: null,
      machines: [],
      manufacture: null
    })
    expect(r.canCam).toBe(false)
    expect(r.issues.some((i) => i.id === 'cam_cnc_machine_missing')).toBe(true)
  })

  it('reports source_mesh_missing when project has no meshes', () => {
    const proj: ProjectFile = { ...mkProject(), meshes: [] }
    const r = evaluateManufactureReadiness({
      project: proj,
      settings: null,
      machines: [{ id: 'm1', name: 'CNC', kind: 'cnc', workAreaMm: { x: 1, y: 1, z: 1 }, maxFeedMmMin: 1, postTemplate: 'a', dialect: 'grbl' }],
      manufacture: null
    })
    expect(r.issues.some((i) => i.id === 'source_mesh_missing')).toBe(true)
  })

  it('skips suppressed operations when determining first op kind', () => {
    const mfg: ManufactureFile = {
      version: 1,
      setups: [],
      operations: [
        { id: 'o1', label: 'FDM', kind: 'fdm_slice', suppressed: true },
        { id: 'o2', label: 'CNC', kind: 'cnc_parallel', suppressed: false }
      ]
    }
    const r = evaluateManufactureReadiness({
      project: mkProject(),
      settings: { recentProjectPaths: [], theme: 'dark', curaEnginePath: 'cura.exe' },
      machines: [{ id: 'm1', name: 'CNC', kind: 'cnc', workAreaMm: { x: 1, y: 1, z: 1 }, maxFeedMmMin: 1, postTemplate: 'a', dialect: 'grbl' }],
      manufacture: mfg
    })
    expect(r.canCam).toBe(true)
    expect(r.issues.some((i) => i.id === 'cam_non_cnc_first_op')).toBe(false)
  })

  it('canCam is true when all operations are suppressed (no first op)', () => {
    const mfg: ManufactureFile = {
      version: 1,
      setups: [],
      operations: [{ id: 'o1', label: 'FDM', kind: 'fdm_slice', suppressed: true }]
    }
    const r = evaluateManufactureReadiness({
      project: mkProject(),
      settings: null,
      machines: [{ id: 'm1', name: 'CNC', kind: 'cnc', workAreaMm: { x: 1, y: 1, z: 1 }, maxFeedMmMin: 1, postTemplate: 'a', dialect: 'grbl' }],
      manufacture: mfg
    })
    expect(r.canCam).toBe(true)
  })
})
