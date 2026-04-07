import { describe, expect, it } from 'vitest'
import {
  classifyDroppedFile,
  MESH_EXTENSIONS,
  GCODE_EXTENSIONS,
  ALL_DROP_EXTENSIONS,
} from './useAppDragDrop'

describe('useAppDragDrop utilities', () => {
  describe('classifyDroppedFile', () => {
    it('classifies STL as mesh', () => {
      expect(classifyDroppedFile('model.stl')).toBe('mesh')
      expect(classifyDroppedFile('MODEL.STL')).toBe('mesh')
      expect(classifyDroppedFile('my part.STL')).toBe('mesh')
    })

    it('classifies STEP/STP as mesh', () => {
      expect(classifyDroppedFile('part.step')).toBe('mesh')
      expect(classifyDroppedFile('part.stp')).toBe('mesh')
      expect(classifyDroppedFile('PART.STEP')).toBe('mesh')
    })

    it('classifies IGES/IGS as mesh', () => {
      expect(classifyDroppedFile('part.iges')).toBe('mesh')
      expect(classifyDroppedFile('part.igs')).toBe('mesh')
      expect(classifyDroppedFile('PART.IGES')).toBe('mesh')
      expect(classifyDroppedFile('PART.IGS')).toBe('mesh')
    })

    it('classifies OBJ as mesh', () => {
      expect(classifyDroppedFile('mesh.obj')).toBe('mesh')
    })

    it('classifies 3MF as mesh', () => {
      expect(classifyDroppedFile('model.3mf')).toBe('mesh')
    })

    it('classifies PLY as mesh', () => {
      expect(classifyDroppedFile('scan.ply')).toBe('mesh')
    })

    it('classifies GLB as mesh', () => {
      expect(classifyDroppedFile('asset.glb')).toBe('mesh')
    })

    it('classifies .gcode as gcode', () => {
      expect(classifyDroppedFile('output.gcode')).toBe('gcode')
      expect(classifyDroppedFile('test.GCODE')).toBe('gcode')
    })

    it('classifies .nc as gcode', () => {
      expect(classifyDroppedFile('toolpath.nc')).toBe('gcode')
    })

    it('classifies .ngc as gcode', () => {
      expect(classifyDroppedFile('job.ngc')).toBe('gcode')
    })

    it('classifies .tap as gcode', () => {
      expect(classifyDroppedFile('program.tap')).toBe('gcode')
    })

    it('returns unknown for unsupported extensions', () => {
      expect(classifyDroppedFile('document.pdf')).toBe('unknown')
      expect(classifyDroppedFile('image.png')).toBe('unknown')
      expect(classifyDroppedFile('archive.zip')).toBe('unknown')
      expect(classifyDroppedFile('readme.txt')).toBe('unknown')
    })

    it('returns unknown for files with no extension', () => {
      expect(classifyDroppedFile('Makefile')).toBe('unknown')
    })
  })

  describe('extension sets', () => {
    it('MESH_EXTENSIONS contains expected formats', () => {
      expect(MESH_EXTENSIONS.has('stl')).toBe(true)
      expect(MESH_EXTENSIONS.has('step')).toBe(true)
      expect(MESH_EXTENSIONS.has('stp')).toBe(true)
      expect(MESH_EXTENSIONS.has('iges')).toBe(true)
      expect(MESH_EXTENSIONS.has('igs')).toBe(true)
      expect(MESH_EXTENSIONS.has('obj')).toBe(true)
      expect(MESH_EXTENSIONS.has('3mf')).toBe(true)
      expect(MESH_EXTENSIONS.has('ply')).toBe(true)
      expect(MESH_EXTENSIONS.has('glb')).toBe(true)
    })

    it('GCODE_EXTENSIONS contains expected formats', () => {
      expect(GCODE_EXTENSIONS.has('gcode')).toBe(true)
      expect(GCODE_EXTENSIONS.has('nc')).toBe(true)
      expect(GCODE_EXTENSIONS.has('ngc')).toBe(true)
      expect(GCODE_EXTENSIONS.has('tap')).toBe(true)
    })

    it('ALL_DROP_EXTENSIONS is the union of mesh + gcode', () => {
      for (const ext of MESH_EXTENSIONS) {
        expect(ALL_DROP_EXTENSIONS.has(ext)).toBe(true)
      }
      for (const ext of GCODE_EXTENSIONS) {
        expect(ALL_DROP_EXTENSIONS.has(ext)).toBe(true)
      }
      expect(ALL_DROP_EXTENSIONS.size).toBe(MESH_EXTENSIONS.size + GCODE_EXTENSIONS.size)
    })
  })
})
