import { describe, expect, it } from 'vitest'
import {
  MESH_IMPORT_FILE_EXTENSIONS,
  MESH_PYTHON_EXTENSIONS,
  STEP_IGES_EXTENSIONS,
  type MeshImportFileExtension
} from './mesh-import-formats'

describe('MESH_IMPORT_FILE_EXTENSIONS', () => {
  it('is a non-empty readonly array', () => {
    expect(Array.isArray(MESH_IMPORT_FILE_EXTENSIONS)).toBe(true)
    expect(MESH_IMPORT_FILE_EXTENSIONS.length).toBeGreaterThan(0)
  })

  it('every entry is a lowercase non-empty string', () => {
    for (const ext of MESH_IMPORT_FILE_EXTENSIONS) {
      expect(typeof ext).toBe('string')
      expect(ext.length).toBeGreaterThan(0)
      expect(ext).toBe(ext.toLowerCase())
    }
  })

  it('includes tier A formats (stl, step/stp, iges/igs, obj, ply, gltf, glb, 3mf)', () => {
    expect(MESH_IMPORT_FILE_EXTENSIONS).toContain('stl')
    expect(MESH_IMPORT_FILE_EXTENSIONS).toContain('step')
    expect(MESH_IMPORT_FILE_EXTENSIONS).toContain('stp')
    expect(MESH_IMPORT_FILE_EXTENSIONS).toContain('iges')
    expect(MESH_IMPORT_FILE_EXTENSIONS).toContain('igs')
    expect(MESH_IMPORT_FILE_EXTENSIONS).toContain('obj')
    expect(MESH_IMPORT_FILE_EXTENSIONS).toContain('ply')
    expect(MESH_IMPORT_FILE_EXTENSIONS).toContain('gltf')
    expect(MESH_IMPORT_FILE_EXTENSIONS).toContain('glb')
    expect(MESH_IMPORT_FILE_EXTENSIONS).toContain('3mf')
  })

  it('includes tier B formats (off, dae)', () => {
    expect(MESH_IMPORT_FILE_EXTENSIONS).toContain('off')
    expect(MESH_IMPORT_FILE_EXTENSIONS).toContain('dae')
  })

  it('includes fbx and dxf formats', () => {
    expect(MESH_IMPORT_FILE_EXTENSIONS).toContain('fbx')
    expect(MESH_IMPORT_FILE_EXTENSIONS).toContain('dxf')
  })

  it('has no duplicate entries', () => {
    const unique = new Set(MESH_IMPORT_FILE_EXTENSIONS)
    expect(unique.size).toBe(MESH_IMPORT_FILE_EXTENSIONS.length)
  })

  it('does not contain dots in extensions', () => {
    for (const ext of MESH_IMPORT_FILE_EXTENSIONS) {
      expect(ext).not.toContain('.')
    }
  })
})

describe('MESH_PYTHON_EXTENSIONS', () => {
  it('is a Set', () => {
    expect(MESH_PYTHON_EXTENSIONS).toBeInstanceOf(Set)
  })

  it('is non-empty', () => {
    expect(MESH_PYTHON_EXTENSIONS.size).toBeGreaterThan(0)
  })

  it('contains formats that need Python conversion', () => {
    expect(MESH_PYTHON_EXTENSIONS.has('obj')).toBe(true)
    expect(MESH_PYTHON_EXTENSIONS.has('ply')).toBe(true)
    expect(MESH_PYTHON_EXTENSIONS.has('gltf')).toBe(true)
    expect(MESH_PYTHON_EXTENSIONS.has('glb')).toBe(true)
    expect(MESH_PYTHON_EXTENSIONS.has('3mf')).toBe(true)
    expect(MESH_PYTHON_EXTENSIONS.has('off')).toBe(true)
    expect(MESH_PYTHON_EXTENSIONS.has('dae')).toBe(true)
    expect(MESH_PYTHON_EXTENSIONS.has('fbx')).toBe(true)
  })

  it('does NOT contain stl (no conversion needed)', () => {
    expect(MESH_PYTHON_EXTENSIONS.has('stl')).toBe(false)
  })

  it('does NOT contain step/stp/iges/igs (handled by OCCT, not trimesh)', () => {
    expect(MESH_PYTHON_EXTENSIONS.has('step')).toBe(false)
    expect(MESH_PYTHON_EXTENSIONS.has('stp')).toBe(false)
    expect(MESH_PYTHON_EXTENSIONS.has('iges')).toBe(false)
    expect(MESH_PYTHON_EXTENSIONS.has('igs')).toBe(false)
  })

  it('does NOT contain dxf (2D import, not mesh)', () => {
    expect(MESH_PYTHON_EXTENSIONS.has('dxf')).toBe(false)
  })

  it('every Python extension is also in the main import extensions array', () => {
    for (const ext of MESH_PYTHON_EXTENSIONS) {
      expect(MESH_IMPORT_FILE_EXTENSIONS).toContain(ext as MeshImportFileExtension)
    }
  })
})

describe('STEP_IGES_EXTENSIONS', () => {
  it('is a Set', () => {
    expect(STEP_IGES_EXTENSIONS).toBeInstanceOf(Set)
  })

  it('contains all STEP and IGES extensions', () => {
    expect(STEP_IGES_EXTENSIONS.has('step')).toBe(true)
    expect(STEP_IGES_EXTENSIONS.has('stp')).toBe(true)
    expect(STEP_IGES_EXTENSIONS.has('iges')).toBe(true)
    expect(STEP_IGES_EXTENSIONS.has('igs')).toBe(true)
  })

  it('has exactly 4 entries', () => {
    expect(STEP_IGES_EXTENSIONS.size).toBe(4)
  })

  it('does NOT contain non-CAD formats', () => {
    expect(STEP_IGES_EXTENSIONS.has('stl')).toBe(false)
    expect(STEP_IGES_EXTENSIONS.has('obj')).toBe(false)
    expect(STEP_IGES_EXTENSIONS.has('dxf')).toBe(false)
  })

  it('every STEP/IGES extension is also in the main import extensions array', () => {
    for (const ext of STEP_IGES_EXTENSIONS) {
      expect(MESH_IMPORT_FILE_EXTENSIONS).toContain(ext as MeshImportFileExtension)
    }
  })

  it('has no overlap with MESH_PYTHON_EXTENSIONS', () => {
    for (const ext of STEP_IGES_EXTENSIONS) {
      expect(MESH_PYTHON_EXTENSIONS.has(ext)).toBe(false)
    }
  })
})
