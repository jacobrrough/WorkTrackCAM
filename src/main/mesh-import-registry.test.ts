import { describe, expect, it } from 'vitest'
import { meshImportRouteFromPath, MESH_IMPORT_DIALOG_EXTENSIONS } from './mesh-import-registry'

describe('meshImportRouteFromPath', () => {
  it('routes Tier A extensions', () => {
    expect(meshImportRouteFromPath('C:\\a\\m.stl')).toBe('stl')
    expect(meshImportRouteFromPath('/x/part.STEP')).toBe('step')
    expect(meshImportRouteFromPath('mesh.obj')).toBe('mesh_python')
    expect(meshImportRouteFromPath('m.ply')).toBe('mesh_python')
    expect(meshImportRouteFromPath('a.glb')).toBe('mesh_python')
    expect(meshImportRouteFromPath('b.gltf')).toBe('mesh_python')
    expect(meshImportRouteFromPath('c.3mf')).toBe('mesh_python')
    expect(meshImportRouteFromPath('m.off')).toBe('mesh_python')
    expect(meshImportRouteFromPath('collada.dae')).toBe('mesh_python')
    expect(meshImportRouteFromPath('cad.fbx')).toBe('mesh_python')
  })

  it('routes STEP extensions to step route', () => {
    expect(meshImportRouteFromPath('/parts/bracket.step')).toBe('step')
    expect(meshImportRouteFromPath('C:\\cad\\part.stp')).toBe('step')
    expect(meshImportRouteFromPath('model.STEP')).toBe('step')
    expect(meshImportRouteFromPath('model.STP')).toBe('step')
  })

  it('routes IGES extensions to step route', () => {
    expect(meshImportRouteFromPath('/parts/bracket.iges')).toBe('step')
    expect(meshImportRouteFromPath('C:\\cad\\part.igs')).toBe('step')
    expect(meshImportRouteFromPath('model.IGES')).toBe('step')
    expect(meshImportRouteFromPath('model.IGS')).toBe('step')
  })

  it('returns null for unknown extensions', () => {
    expect(meshImportRouteFromPath('x.dwg')).toBe(null)
  })
})

describe('MESH_IMPORT_DIALOG_EXTENSIONS', () => {
  it('lists unified import formats', () => {
    expect(MESH_IMPORT_DIALOG_EXTENSIONS).toContain('stl')
    expect(MESH_IMPORT_DIALOG_EXTENSIONS).toContain('step')
    expect(MESH_IMPORT_DIALOG_EXTENSIONS).toContain('obj')
    expect(MESH_IMPORT_DIALOG_EXTENSIONS).toContain('glb')
    expect(MESH_IMPORT_DIALOG_EXTENSIONS).toContain('off')
    expect(MESH_IMPORT_DIALOG_EXTENSIONS).toContain('dae')
    expect(MESH_IMPORT_DIALOG_EXTENSIONS).toContain('fbx')
  })

  it('includes IGES extensions', () => {
    expect(MESH_IMPORT_DIALOG_EXTENSIONS).toContain('iges')
    expect(MESH_IMPORT_DIALOG_EXTENSIONS).toContain('igs')
  })
})
