import { describe, expect, it } from 'vitest'
import { isOperationSourceMeshStale, listStaleSourceMeshesVersusGcode } from './cam-source-stale'

describe('listStaleSourceMeshesVersusGcode', () => {
  it('returns noGcode when gcode mtime is null', () => {
    const r = listStaleSourceMeshesVersusGcode(null, [{ relativePath: 'a.stl', mtimeMs: 999 }])
    expect(r.noGcode).toBe(true)
    expect(r.staleRelativePaths).toEqual([])
  })

  it('lists meshes strictly newer than gcode', () => {
    const r = listStaleSourceMeshesVersusGcode(1000, [
      { relativePath: 'assets/old.stl', mtimeMs: 500 },
      { relativePath: 'assets/new.stl', mtimeMs: 2000 },
      { relativePath: 'assets/same.stl', mtimeMs: 1000 }
    ])
    expect(r.noGcode).toBe(false)
    expect(r.staleRelativePaths).toEqual(['assets/new.stl'])
  })

  it('dedupes and sorts stale paths', () => {
    const r = listStaleSourceMeshesVersusGcode(100, [
      { relativePath: 'b.stl', mtimeMs: 200 },
      { relativePath: 'a.stl', mtimeMs: 200 }
    ])
    expect(r.staleRelativePaths).toEqual(['a.stl', 'b.stl'])
  })
})

describe('isOperationSourceMeshStale', () => {
  it('matches normalized relative paths', () => {
    expect(isOperationSourceMeshStale('/assets/x.stl', ['assets/x.stl'])).toBe(true)
    expect(isOperationSourceMeshStale('assets/x.stl', ['assets/x.stl'])).toBe(true)
    expect(isOperationSourceMeshStale('assets/y.stl', ['assets/x.stl'])).toBe(false)
  })
})
