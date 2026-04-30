/**
 * Paired-pin contract set for `src/shared/cam-source-stale.ts` -- pins both
 * the doc-string surface and the runtime contract of the two exported
 * helpers `listStaleSourceMeshesVersusGcode` + `isOperationSourceMeshStale`,
 * the design-CAM associativity hint helpers consumed by:
 *   - `src/main/ipc-fabrication.ts` (main process: stat-mtime collection +
 *     stale-set computation feeds the project state IPC payload)
 *   - `src/renderer/manufacture/ManufactureOperationList.tsx` (renderer:
 *     surfaces the per-operation "source mesh newer than posted G-code"
 *     badge in the manufacture view)
 *
 * Roadmap: [ID-0249] (cam-engine, Cycle 177). Cross-cuts ALL THREE target
 * machines uniformly per CLAUDE.md "USER CONTEXT -- TARGET MACHINES":
 *   - Creality K2 Plus (FDM, Klipper/Moonraker): every imported FDM STL
 *     and every posted slicer .gcode flows through this comparator before
 *     the operator sees the "source mesh newer" banner.
 *   - Laguna Swift 5x10 (RichAuto A-series): full-sheet plywood routing
 *     STL + posted .nc -- a regression that silently waved through stale
 *     posts would mill yesterday's geometry on today's stock.
 *   - Makera Carvera + 4th Axis: 4-axis indexed pocketing imports STL
 *     parts via the same path -- a stale-detection regression on the
 *     rotary frame would crash the tool against re-positioned features.
 *
 * Pure helper-level unit tests: NO machine profile, NO production-code
 * edits this cycle, NO post-template invocation, NO fs/path/electron
 * imports. The fixtures are direct CamSourceMeshMtime literals so the
 * comparator math is the only thing under test.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  isOperationSourceMeshStale,
  listStaleSourceMeshesVersusGcode,
  type CamSourceMeshMtime,
} from './cam-source-stale'

const SOURCE_PATH = resolve(__dirname, 'cam-source-stale.ts')
const SOURCE_TEXT = readFileSync(SOURCE_PATH, 'utf8')

const mod = { isOperationSourceMeshStale, listStaleSourceMeshesVersusGcode }

// ─── (A) Module shape ───────────────────────────────────────────────────────

describe('[ID-0249] (A) module shape', () => {
  it('exports exactly 2 runtime symbols', () => {
    const keys = Object.keys(mod).sort()
    expect(keys).toEqual(['isOperationSourceMeshStale', 'listStaleSourceMeshesVersusGcode'])
  })

  it('both runtime exports are functions', () => {
    expect(typeof listStaleSourceMeshesVersusGcode).toBe('function')
    expect(typeof isOperationSourceMeshStale).toBe('function')
  })

  it('listStaleSourceMeshesVersusGcode is a native Function (not bound/proxy)', () => {
    expect(Object.getPrototypeOf(listStaleSourceMeshesVersusGcode)).toBe(Function.prototype)
  })

  it('isOperationSourceMeshStale is a native Function (not bound/proxy)', () => {
    expect(Object.getPrototypeOf(isOperationSourceMeshStale)).toBe(Function.prototype)
  })

  it('module surface has no default export', () => {
    expect(SOURCE_TEXT).not.toMatch(/^\s*export\s+default\b/m)
  })
})

// ─── (B) Function signatures ────────────────────────────────────────────────

describe('[ID-0249] (B) function signatures', () => {
  it('listStaleSourceMeshesVersusGcode .name === "listStaleSourceMeshesVersusGcode"', () => {
    expect(listStaleSourceMeshesVersusGcode.name).toBe('listStaleSourceMeshesVersusGcode')
  })

  it('listStaleSourceMeshesVersusGcode .length === 2 (gcodeMtimeMs + meshes)', () => {
    expect(listStaleSourceMeshesVersusGcode.length).toBe(2)
  })

  it('isOperationSourceMeshStale .name === "isOperationSourceMeshStale"', () => {
    expect(isOperationSourceMeshStale.name).toBe('isOperationSourceMeshStale')
  })

  it('isOperationSourceMeshStale .length === 2 (sourceMesh + staleRelativePaths)', () => {
    expect(isOperationSourceMeshStale.length).toBe(2)
  })

  it('listStaleSourceMeshesVersusGcode returns a plain Object literal (not Map/Set/Array)', () => {
    const out = listStaleSourceMeshesVersusGcode(null, [])
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype)
    expect(Array.isArray(out)).toBe(false)
  })

  it('listStaleSourceMeshesVersusGcode return shape has exactly 2 keys', () => {
    const out = listStaleSourceMeshesVersusGcode(null, [])
    expect(Object.keys(out).sort()).toEqual(['noGcode', 'staleRelativePaths'])
  })

  it('listStaleSourceMeshesVersusGcode return.staleRelativePaths is a plain Array', () => {
    const out = listStaleSourceMeshesVersusGcode(100, [])
    expect(Array.isArray(out.staleRelativePaths)).toBe(true)
    expect(Object.getPrototypeOf(out.staleRelativePaths)).toBe(Array.prototype)
  })

  it('isOperationSourceMeshStale returns a plain boolean (not truthy proxy)', () => {
    const out = isOperationSourceMeshStale('a.stl', ['a.stl'])
    expect(typeof out).toBe('boolean')
    expect(out).toBe(true)
  })
})

// ─── (C) listStaleSourceMeshesVersusGcode null-gcode contract ──────────────

describe('[ID-0249] (C) listStaleSourceMeshesVersusGcode null-gcode contract', () => {
  it('null gcodeMtimeMs returns noGcode:true + empty staleRelativePaths', () => {
    const r = listStaleSourceMeshesVersusGcode(null, [{ relativePath: 'a.stl', mtimeMs: 999 }])
    expect(r.noGcode).toBe(true)
    expect(r.staleRelativePaths).toEqual([])
  })

  it('NaN gcodeMtimeMs returns noGcode:true (non-finite guard)', () => {
    const r = listStaleSourceMeshesVersusGcode(NaN, [{ relativePath: 'a.stl', mtimeMs: 999 }])
    expect(r.noGcode).toBe(true)
    expect(r.staleRelativePaths).toEqual([])
  })

  it('+Infinity gcodeMtimeMs returns noGcode:true (non-finite guard)', () => {
    const r = listStaleSourceMeshesVersusGcode(Infinity, [{ relativePath: 'a.stl', mtimeMs: 999 }])
    expect(r.noGcode).toBe(true)
    expect(r.staleRelativePaths).toEqual([])
  })

  it('-Infinity gcodeMtimeMs returns noGcode:true (non-finite guard)', () => {
    const r = listStaleSourceMeshesVersusGcode(-Infinity, [{ relativePath: 'a.stl', mtimeMs: 999 }])
    expect(r.noGcode).toBe(true)
    expect(r.staleRelativePaths).toEqual([])
  })

  it('finite gcodeMtimeMs (including 0) flips noGcode to false', () => {
    const r = listStaleSourceMeshesVersusGcode(0, [])
    expect(r.noGcode).toBe(false)
    expect(r.staleRelativePaths).toEqual([])
  })

  it('negative finite gcodeMtimeMs is still treated as a real timestamp', () => {
    // Defensive: no clamp on negative finite values; the contract is "finite".
    const r = listStaleSourceMeshesVersusGcode(-1000, [{ relativePath: 'a.stl', mtimeMs: 0 }])
    expect(r.noGcode).toBe(false)
    expect(r.staleRelativePaths).toEqual(['a.stl'])
  })
})

// ─── (D) listStaleSourceMeshesVersusGcode strict-greater comparison ────────

describe('[ID-0249] (D) listStaleSourceMeshesVersusGcode strict-greater', () => {
  it('mesh older than gcode is NOT stale', () => {
    const r = listStaleSourceMeshesVersusGcode(1000, [{ relativePath: 'a.stl', mtimeMs: 500 }])
    expect(r.staleRelativePaths).toEqual([])
  })

  it('mesh equal to gcode is NOT stale (strict greater-than)', () => {
    const r = listStaleSourceMeshesVersusGcode(1000, [{ relativePath: 'a.stl', mtimeMs: 1000 }])
    expect(r.staleRelativePaths).toEqual([])
  })

  it('mesh strictly newer than gcode IS stale', () => {
    const r = listStaleSourceMeshesVersusGcode(1000, [{ relativePath: 'a.stl', mtimeMs: 1001 }])
    expect(r.staleRelativePaths).toEqual(['a.stl'])
  })

  it('mixed older/equal/newer keeps only the strictly-newer ones', () => {
    const r = listStaleSourceMeshesVersusGcode(1000, [
      { relativePath: 'old.stl', mtimeMs: 999 },
      { relativePath: 'same.stl', mtimeMs: 1000 },
      { relativePath: 'new.stl', mtimeMs: 1001 },
    ])
    expect(r.staleRelativePaths).toEqual(['new.stl'])
  })

  it('1-millisecond newer mesh is stale (no slop)', () => {
    const r = listStaleSourceMeshesVersusGcode(1_700_000_000_000, [
      { relativePath: 'fresh.stl', mtimeMs: 1_700_000_000_001 },
    ])
    expect(r.staleRelativePaths).toEqual(['fresh.stl'])
  })

  it('noGcode stays false even when nothing is stale', () => {
    const r = listStaleSourceMeshesVersusGcode(1000, [{ relativePath: 'a.stl', mtimeMs: 999 }])
    expect(r.noGcode).toBe(false)
  })
})

// ─── (E) listStaleSourceMeshesVersusGcode mesh-side filtering ──────────────

describe('[ID-0249] (E) listStaleSourceMeshesVersusGcode mesh-side filtering', () => {
  it('null mesh mtimeMs is ignored (not stale)', () => {
    const r = listStaleSourceMeshesVersusGcode(1000, [{ relativePath: 'a.stl', mtimeMs: null }])
    expect(r.staleRelativePaths).toEqual([])
    expect(r.noGcode).toBe(false)
  })

  it('NaN mesh mtimeMs is ignored (non-finite guard)', () => {
    const r = listStaleSourceMeshesVersusGcode(1000, [{ relativePath: 'a.stl', mtimeMs: NaN }])
    expect(r.staleRelativePaths).toEqual([])
  })

  it('+Infinity mesh mtimeMs is ignored (non-finite guard)', () => {
    const r = listStaleSourceMeshesVersusGcode(1000, [{ relativePath: 'a.stl', mtimeMs: Infinity }])
    expect(r.staleRelativePaths).toEqual([])
  })

  it('-Infinity mesh mtimeMs is ignored (non-finite guard)', () => {
    const r = listStaleSourceMeshesVersusGcode(1000, [{ relativePath: 'a.stl', mtimeMs: -Infinity }])
    expect(r.staleRelativePaths).toEqual([])
  })

  it('finite-mtime mesh alongside null-mtime mesh keeps only the finite one', () => {
    const r = listStaleSourceMeshesVersusGcode(100, [
      { relativePath: 'has-mtime.stl', mtimeMs: 200 },
      { relativePath: 'no-mtime.stl', mtimeMs: null },
    ])
    expect(r.staleRelativePaths).toEqual(['has-mtime.stl'])
  })

  it('empty meshes array returns noGcode:false + empty staleRelativePaths', () => {
    const r = listStaleSourceMeshesVersusGcode(1000, [])
    expect(r.noGcode).toBe(false)
    expect(r.staleRelativePaths).toEqual([])
  })
})

// ─── (F) listStaleSourceMeshesVersusGcode path normalization ───────────────

describe('[ID-0249] (F) listStaleSourceMeshesVersusGcode path normalization', () => {
  it('leading forward slash is stripped', () => {
    const r = listStaleSourceMeshesVersusGcode(100, [{ relativePath: '/assets/a.stl', mtimeMs: 200 }])
    expect(r.staleRelativePaths).toEqual(['assets/a.stl'])
  })

  it('leading backslash is stripped', () => {
    const r = listStaleSourceMeshesVersusGcode(100, [{ relativePath: '\\assets\\a.stl', mtimeMs: 200 }])
    expect(r.staleRelativePaths).toEqual(['assets\\a.stl'])
  })

  it('multiple leading forward slashes are all stripped', () => {
    const r = listStaleSourceMeshesVersusGcode(100, [{ relativePath: '///a.stl', mtimeMs: 200 }])
    expect(r.staleRelativePaths).toEqual(['a.stl'])
  })

  it('multiple leading backslashes are all stripped', () => {
    const r = listStaleSourceMeshesVersusGcode(100, [{ relativePath: '\\\\\\a.stl', mtimeMs: 200 }])
    expect(r.staleRelativePaths).toEqual(['a.stl'])
  })

  it('mixed leading slash + backslash run is all stripped (single regex sweep)', () => {
    const r = listStaleSourceMeshesVersusGcode(100, [{ relativePath: '/\\/a.stl', mtimeMs: 200 }])
    expect(r.staleRelativePaths).toEqual(['a.stl'])
  })

  it('whitespace around path is trimmed before slash strip', () => {
    const r = listStaleSourceMeshesVersusGcode(100, [{ relativePath: '  /assets/a.stl  ', mtimeMs: 200 }])
    expect(r.staleRelativePaths).toEqual(['assets/a.stl'])
  })

  it('non-leading slashes are preserved (only LEADING runs are stripped)', () => {
    const r = listStaleSourceMeshesVersusGcode(100, [
      { relativePath: 'assets/sub/a.stl', mtimeMs: 200 },
    ])
    expect(r.staleRelativePaths).toEqual(['assets/sub/a.stl'])
  })

  it('trailing slashes are NOT stripped (only leading is normalized)', () => {
    const r = listStaleSourceMeshesVersusGcode(100, [
      { relativePath: 'assets/a.stl/', mtimeMs: 200 },
    ])
    expect(r.staleRelativePaths).toEqual(['assets/a.stl/'])
  })
})

// ─── (G) listStaleSourceMeshesVersusGcode empty-after-strip filtering ──────

describe('[ID-0249] (G) listStaleSourceMeshesVersusGcode empty-after-strip', () => {
  it('empty-string relativePath is dropped', () => {
    const r = listStaleSourceMeshesVersusGcode(100, [{ relativePath: '', mtimeMs: 200 }])
    expect(r.staleRelativePaths).toEqual([])
  })

  it('whitespace-only relativePath is dropped', () => {
    const r = listStaleSourceMeshesVersusGcode(100, [{ relativePath: '   \t\n', mtimeMs: 200 }])
    expect(r.staleRelativePaths).toEqual([])
  })

  it('slashes-only relativePath is dropped after slash-strip', () => {
    const r = listStaleSourceMeshesVersusGcode(100, [{ relativePath: '////', mtimeMs: 200 }])
    expect(r.staleRelativePaths).toEqual([])
  })

  it('backslashes-only relativePath is dropped after backslash-strip', () => {
    const r = listStaleSourceMeshesVersusGcode(100, [{ relativePath: '\\\\\\\\', mtimeMs: 200 }])
    expect(r.staleRelativePaths).toEqual([])
  })

  it('whitespace + slashes only relativePath is dropped (trim then strip)', () => {
    const r = listStaleSourceMeshesVersusGcode(100, [{ relativePath: '   //  ', mtimeMs: 200 }])
    // Trim runs first, then leading slash regex; after trim "//" is left,
    // slash regex strips both, and the empty-after-strip filter drops it.
    expect(r.staleRelativePaths).toEqual([])
  })
})

// ─── (H) listStaleSourceMeshesVersusGcode dedup + sort ─────────────────────

describe('[ID-0249] (H) listStaleSourceMeshesVersusGcode dedup + sort', () => {
  it('duplicate stale paths are deduped via Set', () => {
    const r = listStaleSourceMeshesVersusGcode(100, [
      { relativePath: 'a.stl', mtimeMs: 200 },
      { relativePath: 'a.stl', mtimeMs: 300 },
    ])
    expect(r.staleRelativePaths).toEqual(['a.stl'])
  })

  it('paths that normalize to the same value are deduped (after slash-strip)', () => {
    const r = listStaleSourceMeshesVersusGcode(100, [
      { relativePath: '/a.stl', mtimeMs: 200 },
      { relativePath: 'a.stl', mtimeMs: 300 },
    ])
    expect(r.staleRelativePaths).toEqual(['a.stl'])
  })

  it('output is sorted in ASCII / lexicographic order', () => {
    const r = listStaleSourceMeshesVersusGcode(100, [
      { relativePath: 'b.stl', mtimeMs: 200 },
      { relativePath: 'a.stl', mtimeMs: 200 },
      { relativePath: 'c.stl', mtimeMs: 200 },
    ])
    expect(r.staleRelativePaths).toEqual(['a.stl', 'b.stl', 'c.stl'])
  })

  it('uppercase sorts before lowercase (default ASCII sort)', () => {
    const r = listStaleSourceMeshesVersusGcode(100, [
      { relativePath: 'b.stl', mtimeMs: 200 },
      { relativePath: 'A.stl', mtimeMs: 200 },
    ])
    expect(r.staleRelativePaths).toEqual(['A.stl', 'b.stl'])
  })

  it('three-deep dedup across two identical normalizations + one distinct', () => {
    const r = listStaleSourceMeshesVersusGcode(100, [
      { relativePath: '/foo/bar.stl', mtimeMs: 200 },
      { relativePath: 'foo/bar.stl', mtimeMs: 300 },
      { relativePath: '/foo/baz.stl', mtimeMs: 400 },
    ])
    expect(r.staleRelativePaths).toEqual(['foo/bar.stl', 'foo/baz.stl'])
  })

  it('output array is fresh per call (no shared/cached array)', () => {
    const r1 = listStaleSourceMeshesVersusGcode(100, [{ relativePath: 'a.stl', mtimeMs: 200 }])
    const r2 = listStaleSourceMeshesVersusGcode(100, [{ relativePath: 'a.stl', mtimeMs: 200 }])
    expect(r1.staleRelativePaths).not.toBe(r2.staleRelativePaths)
    expect(r1).not.toBe(r2)
  })
})

// ─── (I) isOperationSourceMeshStale empty-input contract ───────────────────

describe('[ID-0249] (I) isOperationSourceMeshStale empty-input contract', () => {
  it('null sourceMesh returns false', () => {
    expect(isOperationSourceMeshStale(null, ['a.stl'])).toBe(false)
  })

  it('undefined sourceMesh returns false', () => {
    expect(isOperationSourceMeshStale(undefined, ['a.stl'])).toBe(false)
  })

  it('empty-string sourceMesh returns false', () => {
    expect(isOperationSourceMeshStale('', ['a.stl'])).toBe(false)
  })

  it('whitespace-only sourceMesh returns false', () => {
    expect(isOperationSourceMeshStale('   \t\n', ['a.stl'])).toBe(false)
  })

  it('slashes-only sourceMesh returns false (empty after strip)', () => {
    expect(isOperationSourceMeshStale('////', ['a.stl'])).toBe(false)
  })

  it('backslashes-only sourceMesh returns false (empty after strip)', () => {
    expect(isOperationSourceMeshStale('\\\\\\\\', ['a.stl'])).toBe(false)
  })

  it('non-empty sourceMesh against empty stale set returns false', () => {
    expect(isOperationSourceMeshStale('a.stl', [])).toBe(false)
  })
})

// ─── (J) isOperationSourceMeshStale path normalization ─────────────────────

describe('[ID-0249] (J) isOperationSourceMeshStale path normalization', () => {
  it('leading forward slash is stripped before compare', () => {
    expect(isOperationSourceMeshStale('/assets/x.stl', ['assets/x.stl'])).toBe(true)
  })

  it('leading backslash is stripped before compare', () => {
    expect(isOperationSourceMeshStale('\\assets\\x.stl', ['assets\\x.stl'])).toBe(true)
  })

  it('multiple leading slashes are all stripped before compare', () => {
    expect(isOperationSourceMeshStale('///assets/x.stl', ['assets/x.stl'])).toBe(true)
  })

  it('whitespace around sourceMesh is trimmed before compare', () => {
    expect(isOperationSourceMeshStale('  assets/x.stl  ', ['assets/x.stl'])).toBe(true)
  })

  it('whitespace + leading slash is trimmed + stripped before compare', () => {
    expect(isOperationSourceMeshStale('  /assets/x.stl  ', ['assets/x.stl'])).toBe(true)
  })

  it('un-normalized sourceMesh matches a normalized entry in the set', () => {
    expect(isOperationSourceMeshStale('/x.stl', ['x.stl'])).toBe(true)
  })

  it('but the staleRelativePaths set is NOT normalized by this function -- caller must pass normalized', () => {
    // The function only normalizes the SOURCE side; the set is consulted as-is.
    expect(isOperationSourceMeshStale('a.stl', ['/a.stl'])).toBe(false)
  })
})

// ─── (K) isOperationSourceMeshStale exact-match contract ───────────────────

describe('[ID-0249] (K) isOperationSourceMeshStale exact-match contract', () => {
  it('case-sensitive compare: differing case returns false', () => {
    expect(isOperationSourceMeshStale('A.stl', ['a.stl'])).toBe(false)
  })

  it('substring is NOT a match (no fuzzy includes)', () => {
    expect(isOperationSourceMeshStale('a.stl', ['my-a.stl-backup'])).toBe(false)
  })

  it('extension difference returns false', () => {
    expect(isOperationSourceMeshStale('a.STL', ['a.stl'])).toBe(false)
  })

  it('directory-only prefix returns false (full path required)', () => {
    expect(isOperationSourceMeshStale('assets', ['assets/a.stl'])).toBe(false)
  })

  it('exact match in middle of array returns true', () => {
    expect(isOperationSourceMeshStale('b.stl', ['a.stl', 'b.stl', 'c.stl'])).toBe(true)
  })

  it('exact match at index 0 returns true', () => {
    expect(isOperationSourceMeshStale('a.stl', ['a.stl', 'b.stl'])).toBe(true)
  })

  it('exact match at last index returns true', () => {
    expect(isOperationSourceMeshStale('c.stl', ['a.stl', 'b.stl', 'c.stl'])).toBe(true)
  })
})

// ─── (L) Three-machine path realism ────────────────────────────────────────

describe('[ID-0249] (L) three-machine path realism', () => {
  it('K2 Plus FDM: posted .gcode older than imported STL flags the cube as stale', () => {
    const POSTED = 1_700_000_000_000
    const r = listStaleSourceMeshesVersusGcode(POSTED, [
      { relativePath: 'assets/k2-cube.stl', mtimeMs: POSTED + 5_000 },
    ])
    expect(r.noGcode).toBe(false)
    expect(r.staleRelativePaths).toEqual(['assets/k2-cube.stl'])
    expect(isOperationSourceMeshStale('assets/k2-cube.stl', r.staleRelativePaths)).toBe(true)
  })

  it('K2 Plus FDM: missing posted .gcode returns noGcode banner (pre-print first slice)', () => {
    const r = listStaleSourceMeshesVersusGcode(null, [
      { relativePath: 'assets/k2-cube.stl', mtimeMs: 1_700_000_000_000 },
    ])
    expect(r.noGcode).toBe(true)
    expect(r.staleRelativePaths).toEqual([])
  })

  it('Laguna Swift 5x10: full-sheet plywood STL re-touched after posting fires stale', () => {
    const POSTED = 1_700_000_000_000
    const r = listStaleSourceMeshesVersusGcode(POSTED, [
      { relativePath: 'assets/laguna-full-sheet-1524x3048.stl', mtimeMs: POSTED + 60_000 },
      { relativePath: 'assets/laguna-spoilboard.stl', mtimeMs: POSTED - 60_000 },
    ])
    expect(r.staleRelativePaths).toEqual(['assets/laguna-full-sheet-1524x3048.stl'])
    expect(isOperationSourceMeshStale('assets/laguna-full-sheet-1524x3048.stl', r.staleRelativePaths)).toBe(true)
    expect(isOperationSourceMeshStale('assets/laguna-spoilboard.stl', r.staleRelativePaths)).toBe(false)
  })

  it('Laguna Swift 5x10: leading-slash op sourceMesh still matches the normalized stale set', () => {
    const r = listStaleSourceMeshesVersusGcode(100, [
      { relativePath: 'assets/laguna-pocket.stl', mtimeMs: 200 },
    ])
    expect(isOperationSourceMeshStale('/assets/laguna-pocket.stl', r.staleRelativePaths)).toBe(true)
  })

  it('Carvera 4-axis: rotary part STL re-saved after posting fires stale', () => {
    const POSTED = 1_700_000_000_000
    const r = listStaleSourceMeshesVersusGcode(POSTED, [
      { relativePath: 'assets/carvera-rotary-92mm.stl', mtimeMs: POSTED + 1 },
    ])
    expect(r.staleRelativePaths).toEqual(['assets/carvera-rotary-92mm.stl'])
  })

  it('Carvera 4-axis: indexed-pocket multi-mesh project flags only the touched mesh', () => {
    const POSTED = 1_700_000_000_000
    const r = listStaleSourceMeshesVersusGcode(POSTED, [
      { relativePath: 'assets/carvera-side-A.stl', mtimeMs: POSTED + 100 },
      { relativePath: 'assets/carvera-side-B.stl', mtimeMs: POSTED - 100 },
      { relativePath: 'assets/carvera-fixture.stl', mtimeMs: POSTED },
    ])
    expect(r.staleRelativePaths).toEqual(['assets/carvera-side-A.stl'])
  })

  it('mixed three-machine project: one stale mesh per machine flagged independently', () => {
    const POSTED = 1_700_000_000_000
    const r = listStaleSourceMeshesVersusGcode(POSTED, [
      { relativePath: 'assets/k2-cube.stl', mtimeMs: POSTED + 1 },
      { relativePath: 'assets/laguna-sheet.stl', mtimeMs: POSTED + 2 },
      { relativePath: 'assets/carvera-rotary.stl', mtimeMs: POSTED + 3 },
      { relativePath: 'assets/never-touched.stl', mtimeMs: POSTED - 999 },
    ])
    expect(r.staleRelativePaths).toEqual([
      'assets/carvera-rotary.stl',
      'assets/k2-cube.stl',
      'assets/laguna-sheet.stl',
    ])
  })
})

// ─── (M) Pure-function invariants ──────────────────────────────────────────

describe('[ID-0249] (M) pure-function invariants', () => {
  const SAMPLE_MESHES: readonly CamSourceMeshMtime[] = Object.freeze([
    Object.freeze({ relativePath: '/a.stl', mtimeMs: 200 }),
    Object.freeze({ relativePath: 'b.stl', mtimeMs: 50 }),
    Object.freeze({ relativePath: 'a.stl', mtimeMs: 300 }),
    Object.freeze({ relativePath: '\\c.stl', mtimeMs: 250 }),
    Object.freeze({ relativePath: '   ', mtimeMs: 999 }),
  ]) as readonly CamSourceMeshMtime[]

  it('listStaleSourceMeshesVersusGcode is idempotent across N=20 calls (same inputs => same output)', () => {
    const baseline = listStaleSourceMeshesVersusGcode(100, SAMPLE_MESHES)
    for (let n = 0; n < 20; n++) {
      const r = listStaleSourceMeshesVersusGcode(100, SAMPLE_MESHES)
      expect(r).toEqual(baseline)
    }
  })

  it('listStaleSourceMeshesVersusGcode does not mutate the meshes input array', () => {
    const meshes: CamSourceMeshMtime[] = [
      { relativePath: '/a.stl', mtimeMs: 200 },
      { relativePath: 'b.stl', mtimeMs: 300 },
    ]
    const snapshot = JSON.parse(JSON.stringify(meshes))
    listStaleSourceMeshesVersusGcode(100, meshes)
    expect(meshes).toEqual(snapshot)
  })

  it('listStaleSourceMeshesVersusGcode does not mutate individual mesh objects', () => {
    const mesh: CamSourceMeshMtime = { relativePath: '/a.stl', mtimeMs: 200 }
    const snapshot = { ...mesh }
    listStaleSourceMeshesVersusGcode(100, [mesh])
    expect(mesh).toEqual(snapshot)
  })

  it('listStaleSourceMeshesVersusGcode returns a fresh result object per call', () => {
    const r1 = listStaleSourceMeshesVersusGcode(100, SAMPLE_MESHES)
    const r2 = listStaleSourceMeshesVersusGcode(100, SAMPLE_MESHES)
    expect(r1).not.toBe(r2)
    expect(r1.staleRelativePaths).not.toBe(r2.staleRelativePaths)
  })

  it('listStaleSourceMeshesVersusGcode does not bind `this` (call/apply with arbitrary thisArg works)', () => {
    const fn = listStaleSourceMeshesVersusGcode
    const a = fn.call(undefined, 100, [{ relativePath: 'a.stl', mtimeMs: 200 }])
    const b = fn.apply(null, [100, [{ relativePath: 'a.stl', mtimeMs: 200 }]])
    expect(a).toEqual({ staleRelativePaths: ['a.stl'], noGcode: false })
    expect(b).toEqual({ staleRelativePaths: ['a.stl'], noGcode: false })
  })

  it('isOperationSourceMeshStale is idempotent across N=20 calls', () => {
    const stale = ['a.stl', 'b.stl', 'c.stl']
    for (let n = 0; n < 20; n++) {
      expect(isOperationSourceMeshStale('/b.stl', stale)).toBe(true)
      expect(isOperationSourceMeshStale('/d.stl', stale)).toBe(false)
    }
  })

  it('isOperationSourceMeshStale does not mutate the staleRelativePaths array', () => {
    const stale = ['a.stl', 'b.stl']
    const snapshot = [...stale]
    isOperationSourceMeshStale('a.stl', stale)
    isOperationSourceMeshStale('z.stl', stale)
    expect(stale).toEqual(snapshot)
  })

  it('isOperationSourceMeshStale does not bind `this`', () => {
    const fn = isOperationSourceMeshStale
    expect(fn.call(undefined, 'a.stl', ['a.stl'])).toBe(true)
    expect(fn.apply(null, ['a.stl', ['a.stl']])).toBe(true)
  })

  it('listStaleSourceMeshesVersusGcode does not throw on documented inputs (null + non-finite + empty)', () => {
    expect(() => listStaleSourceMeshesVersusGcode(null, [])).not.toThrow()
    expect(() => listStaleSourceMeshesVersusGcode(NaN, [])).not.toThrow()
    expect(() => listStaleSourceMeshesVersusGcode(0, [{ relativePath: '', mtimeMs: NaN }])).not.toThrow()
    expect(() => listStaleSourceMeshesVersusGcode(Number.MAX_SAFE_INTEGER, [])).not.toThrow()
  })

  it('isOperationSourceMeshStale does not throw on documented inputs', () => {
    expect(() => isOperationSourceMeshStale(null, [])).not.toThrow()
    expect(() => isOperationSourceMeshStale(undefined, ['a.stl'])).not.toThrow()
    expect(() => isOperationSourceMeshStale('', ['a.stl'])).not.toThrow()
    expect(() => isOperationSourceMeshStale('   ', ['a.stl'])).not.toThrow()
  })
})

// ─── (N) Source-text whitelist ─────────────────────────────────────────────

describe('[ID-0249] (N) source-text whitelist', () => {
  // Strip both /* ... */ and // line comments so whitelist regexes only run
  // against executable code. JSDoc references like "associativity" must be
  // free to live in comments without flagging the no-foreign-vendor checks.
  const codeOnly = SOURCE_TEXT
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')

  it('source file has fewer than 50 lines', () => {
    expect(SOURCE_TEXT.split('\n').length).toBeLessThan(50)
  })

  it('source file is smaller than 2 KB', () => {
    expect(Buffer.byteLength(SOURCE_TEXT, 'utf8')).toBeLessThan(2048)
  })

  it('source has no default export', () => {
    expect(codeOnly).not.toMatch(/^\s*export\s+default\b/m)
  })

  it('source has exactly 2 named exports (functions)', () => {
    const matches = codeOnly.match(/\bexport\s+function\s+\w+/g) ?? []
    expect(matches.length).toBe(2)
  })

  it('source has exactly 1 exported type (CamSourceMeshMtime)', () => {
    const matches = codeOnly.match(/\bexport\s+type\s+\w+/g) ?? []
    expect(matches.length).toBe(1)
    expect(codeOnly).toMatch(/\bexport\s+type\s+CamSourceMeshMtime\b/)
  })

  it('source has zero runtime imports (pure leaf module)', () => {
    expect(codeOnly).not.toMatch(/\bimport\s+[^;]+\s+from\s+['"][^'"]+['"]/)
  })

  it('source has no `:any` annotation', () => {
    expect(codeOnly).not.toMatch(/:\s*any\b/)
  })

  it('source has no `as any` cast', () => {
    expect(codeOnly).not.toMatch(/\bas\s+any\b/)
  })

  it('source has no `<any>` cast', () => {
    expect(codeOnly).not.toMatch(/<\s*any\s*>/)
  })

  it('source has no fs / path / electron imports', () => {
    expect(codeOnly).not.toMatch(/\bfrom\s+['"](node:)?(fs|path|electron|child_process|os|net|tls|dgram)['"]/)
  })

  it('source has no React / three / Handlebars imports', () => {
    expect(codeOnly).not.toMatch(/\bfrom\s+['"](react|three|handlebars)['"]/)
  })

  it('source has no toolpath G-code literals (G0..G91)', () => {
    expect(codeOnly).not.toMatch(/\b[Gg]0?[0-9]\b/)
    expect(codeOnly).not.toMatch(/\b[Gg]1[7-9]\b/)
    expect(codeOnly).not.toMatch(/\b[Gg]2[018]\b/)
    expect(codeOnly).not.toMatch(/\b[Gg]5[4-9]\b/)
    expect(codeOnly).not.toMatch(/\b[Gg]9[01]\b/)
  })

  it('source has no toolpath M-code literals (M3..M65)', () => {
    expect(codeOnly).not.toMatch(/\b[Mm][2-9]\b/)
    expect(codeOnly).not.toMatch(/\b[Mm]30\b/)
    expect(codeOnly).not.toMatch(/\b[Mm]6[0-9]\b/)
    expect(codeOnly).not.toMatch(/\b[Mm]84\b/)
  })

  it('source mentions no foreign-machine vendors', () => {
    expect(codeOnly).not.toMatch(/\b(Bambu|Prusa|Haas|Tormach|Mach4|Shapeoko|Onefinity|X-Carve|Snapmaker|Roland)\b/i)
  })

  it('source mentions all three target machines in JSDoc OR is generic-cross-cutting (no target-machine references in code is OK)', () => {
    // The helper is generic across machines; the JSDoc says "Main process supplies
    // mtimes from `stat`; renderer uses results for banners and op badges". This
    // pin asserts the generic surface (no machine-specific opcodes in code) which
    // already passes via the no-G-code / no-M-code / no-vendor checks above.
    expect(codeOnly).not.toMatch(/\bk2[\s\-_]?plus\b/i)
    expect(codeOnly).not.toMatch(/\bcarvera\b/i)
    expect(codeOnly).not.toMatch(/\blaguna\b/i)
  })

  it('source has the strict-greater-than comparator literal (no `>=` slop)', () => {
    expect(codeOnly).toMatch(/\bt\s*>\s*gcodeMtimeMs\b/)
    expect(codeOnly).not.toMatch(/\bt\s*>=\s*gcodeMtimeMs\b/)
  })

  it('source uses Set + sort for dedup + ordering (the documented invariant)', () => {
    expect(codeOnly).toMatch(/new\s+Set\b/)
    expect(codeOnly).toMatch(/\.sort\(\)/)
  })

  it('source uses Number.isFinite for non-finite guards (no isNaN-only check)', () => {
    expect(codeOnly).toMatch(/Number\.isFinite\b/)
  })

  it('source strips ONLY leading slashes/backslashes (not trailing)', () => {
    // Regex literal /^[\\/]+/ in source -- "leading run of \ or /".
    expect(codeOnly).toMatch(/\/\^\[\\\\\/\]\+\//)
  })
})
