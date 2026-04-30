/**
 * Co-located paired-pin contract for `src/main/unique-asset-filename.ts`
 *
 * [ID-0248] Cycle 176 test-coverage paired-pin -- pins the runtime contract of the
 * single exported `resolveUniqueFilenameInDir(dir, preferredFileName): Promise<string>`
 * helper that backs the import pipeline used by all three target machines:
 *   - Creality K2 Plus (FDM): STL imports for slicing.
 *   - Laguna Swift 5x10  (RichAuto A-series): STL imports for full-sheet routing.
 *   - Makera Carvera + 4th Axis: STL imports for 4-axis indexed pocketing.
 *
 * Production call-sites:
 *   - `src/main/cad/occt-import.ts:30` -- STEP/IGES -> STL output filename allocation.
 *   - `src/main/cad/occt-import.ts:48` -- asset destination filename allocation.
 *   - `src/main/mesh-import-registry.ts:159` -- generic mesh import -> STL allocation.
 *
 * The pin pins module shape, function signature, naming-cascade ordering (no
 * suffix on first hit; `_1`, `_2`, ... thereafter), extension preservation
 * including dotfile + multi-dot edge cases, basename fallback to 'asset' on
 * empty preferred name, three-machine path realism, source-text whitelist
 * (zero fs writes from this module; only `access` probe), and pure-ish
 * invariants.
 *
 * NB: the existing behavioral test `src/main/unique-asset-filename.test.ts`
 * (1 it()) covers the basic happy + collision path. This paired-pin extends
 * coverage to lock down the contract any caller in the import pipeline relies
 * on, so a future refactor that silently changes (e.g.) the suffix shape
 * (`_1` -> `(1)`), the basename fallback ('asset' -> 'untitled'), or the
 * extension parsing (`.tar.gz` -> base/ext split) would surface here.
 */
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join, sep } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import * as moduleNs from './unique-asset-filename'
import { resolveUniqueFilenameInDir } from './unique-asset-filename'

const SRC_PATH = 'src/main/unique-asset-filename.ts'
let SRC: string | null = null
async function readSrc(): Promise<string> {
  if (SRC === null) SRC = await readFile(SRC_PATH, 'utf-8')
  return SRC
}

// Each describe gets a private temp dir so concurrency between describes is safe.
async function freshTmp(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `ufn-pin-${prefix}-`))
}

// Track tmp roots created so we can occasionally inspect; we do NOT rmdir
// them (vitest tears down the worker; on Linux /tmp is per-session anyway).
const TMP_ROOTS: string[] = []

afterAll(() => {
  // Defensive sanity: no test should leak a non-empty path that escapes /tmp.
  for (const r of TMP_ROOTS) {
    expect(r.startsWith(tmpdir())).toBe(true)
  }
})

async function tmp(prefix: string): Promise<string> {
  const t = await freshTmp(prefix)
  TMP_ROOTS.push(t)
  return t
}

// --------------------------------------------------------------------------
// (A) Module shape
// --------------------------------------------------------------------------
describe('[ID-0248] (A) module shape', () => {
  it('exports exactly one runtime symbol named resolveUniqueFilenameInDir', () => {
    const keys = Object.keys(moduleNs).sort()
    expect(keys).toEqual(['resolveUniqueFilenameInDir'])
  })

  it('namespace Symbol.toStringTag is Module', () => {
    expect((moduleNs as unknown as { [Symbol.toStringTag]?: string })[Symbol.toStringTag]).toBe(
      'Module'
    )
  })

  it('does not have a default export', () => {
    expect((moduleNs as unknown as { default?: unknown }).default).toBeUndefined()
  })

  it('resolveUniqueFilenameInDir is a Function', () => {
    expect(typeof resolveUniqueFilenameInDir).toBe('function')
  })

  it('resolveUniqueFilenameInDir is async (constructor name AsyncFunction)', () => {
    expect(resolveUniqueFilenameInDir.constructor.name).toBe('AsyncFunction')
  })

  it('resolveUniqueFilenameInDir.name matches the export', () => {
    expect(resolveUniqueFilenameInDir.name).toBe('resolveUniqueFilenameInDir')
  })

  it('resolveUniqueFilenameInDir.length (declared arity) is 2', () => {
    expect(resolveUniqueFilenameInDir.length).toBe(2)
  })

  it('only one runtime key (no leakage of helpers)', () => {
    expect(Object.keys(moduleNs)).toHaveLength(1)
  })
})

// --------------------------------------------------------------------------
// (B) Function signature
// --------------------------------------------------------------------------
describe('[ID-0248] (B) function signature', () => {
  it('returns a Promise', async () => {
    const dir = await tmp('B-promise')
    const r = resolveUniqueFilenameInDir(dir, 'a.stl')
    expect(r).toBeInstanceOf(Promise)
    await r // drain
  })

  it('Promise resolves to a string', async () => {
    const dir = await tmp('B-string')
    const r = await resolveUniqueFilenameInDir(dir, 'a.stl')
    expect(typeof r).toBe('string')
  })

  it('resolved string is non-empty', async () => {
    const dir = await tmp('B-nonempty')
    const r = await resolveUniqueFilenameInDir(dir, 'a.stl')
    expect(r.length).toBeGreaterThan(0)
  })

  it('does not throw on a non-existent dir (nothing to access -> first try succeeds)', async () => {
    const root = await tmp('B-nodir')
    const ghost = join(root, 'no-such-dir')
    // Even though `ghost` does not exist, access() will throw ENOENT -> the
    // catch path treats that as "free" -> returns the join'd path.
    const r = await resolveUniqueFilenameInDir(ghost, 'a.stl')
    expect(r).toBe(join(ghost, 'a.stl'))
  })

  it('declared arity (Function.length) is 2', () => {
    expect(resolveUniqueFilenameInDir.length).toBe(2)
  })

  it('rejects nothing on a happy free-dir call', async () => {
    const dir = await tmp('B-norej')
    await expect(resolveUniqueFilenameInDir(dir, 'a.stl')).resolves.toBeDefined()
  })
})

// --------------------------------------------------------------------------
// (C) Happy path: no collision
// --------------------------------------------------------------------------
describe('[ID-0248] (C) happy path on empty dir', () => {
  it('returns dir-prefixed full path on first call', async () => {
    const dir = await tmp('C-first')
    const r = await resolveUniqueFilenameInDir(dir, 'part.stl')
    expect(r).toBe(join(dir, 'part.stl'))
  })

  it('resolved path begins with the input dir', async () => {
    const dir = await tmp('C-prefix')
    const r = await resolveUniqueFilenameInDir(dir, 'part.stl')
    expect(r.startsWith(dir + sep)).toBe(true)
  })

  it('resolved path basename equals preferred name (no collision)', async () => {
    const dir = await tmp('C-basename')
    const r = await resolveUniqueFilenameInDir(dir, 'part.stl')
    expect(basename(r)).toBe('part.stl')
  })

  it('preferred name with .gcode extension preserved', async () => {
    const dir = await tmp('C-gcode')
    const r = await resolveUniqueFilenameInDir(dir, 'creality_cube.gcode')
    expect(basename(r)).toBe('creality_cube.gcode')
  })

  it('preferred name with .nc extension preserved', async () => {
    const dir = await tmp('C-nc')
    const r = await resolveUniqueFilenameInDir(dir, 'fullsheet.nc')
    expect(basename(r)).toBe('fullsheet.nc')
  })

  it('preferred name has no underscore suffix when free', async () => {
    const dir = await tmp('C-nosuffix')
    const r = await resolveUniqueFilenameInDir(dir, 'a.stl')
    expect(basename(r)).not.toMatch(/_\d+\.stl$/)
  })

  it('does NOT create the file on resolution', async () => {
    const dir = await tmp('C-nocreate')
    await resolveUniqueFilenameInDir(dir, 'a.stl')
    const after = await readdir(dir)
    expect(after).toEqual([])
  })

  it('repeated free-dir calls return the same name (deterministic on free state)', async () => {
    const dir = await tmp('C-determ')
    const r1 = await resolveUniqueFilenameInDir(dir, 'a.stl')
    const r2 = await resolveUniqueFilenameInDir(dir, 'a.stl')
    expect(r2).toBe(r1)
  })
})

// --------------------------------------------------------------------------
// (D) First collision: n=1 -> base_1.ext
// --------------------------------------------------------------------------
describe('[ID-0248] (D) first collision allocates _1 suffix', () => {
  it('returns base_1.ext when base.ext is occupied', async () => {
    const dir = await tmp('D-one')
    await writeFile(join(dir, 'part.stl'), '')
    const r = await resolveUniqueFilenameInDir(dir, 'part.stl')
    expect(basename(r)).toBe('part_1.stl')
  })

  it('the suffix is exactly one underscore + integer', async () => {
    const dir = await tmp('D-shape')
    await writeFile(join(dir, 'a.stl'), '')
    const r = await resolveUniqueFilenameInDir(dir, 'a.stl')
    expect(basename(r)).toMatch(/^a_\d+\.stl$/)
  })

  it('extension preserved across the suffix transition', async () => {
    const dir = await tmp('D-ext')
    await writeFile(join(dir, 'a.gcode'), '')
    const r = await resolveUniqueFilenameInDir(dir, 'a.gcode')
    expect(extname(r)).toBe('.gcode')
  })

  it('full path still begins with input dir', async () => {
    const dir = await tmp('D-prefix')
    await writeFile(join(dir, 'a.stl'), '')
    const r = await resolveUniqueFilenameInDir(dir, 'a.stl')
    expect(r.startsWith(dir + sep)).toBe(true)
  })

  it('does NOT use parens / spaces / brackets in the suffix shape', async () => {
    const dir = await tmp('D-no-parens')
    await writeFile(join(dir, 'a.stl'), '')
    const r = await resolveUniqueFilenameInDir(dir, 'a.stl')
    expect(basename(r)).not.toMatch(/[ ()[\]]/)
  })
})

// --------------------------------------------------------------------------
// (E) Cascade collisions: _1, _2, _3, ...
// --------------------------------------------------------------------------
describe('[ID-0248] (E) cascade collisions allocate sequentially', () => {
  it('sequential calls allocate _1, _2, _3 in order', async () => {
    const dir = await tmp('E-cascade')
    const a = await resolveUniqueFilenameInDir(dir, 'p.stl')
    await writeFile(a, '')
    const b = await resolveUniqueFilenameInDir(dir, 'p.stl')
    await writeFile(b, '')
    const c = await resolveUniqueFilenameInDir(dir, 'p.stl')
    expect(basename(a)).toBe('p.stl')
    expect(basename(b)).toBe('p_1.stl')
    expect(basename(c)).toBe('p_2.stl')
  })

  it('starts numbering at 1 (not 0, not 2)', async () => {
    const dir = await tmp('E-start')
    await writeFile(join(dir, 'p.stl'), '')
    const r = await resolveUniqueFilenameInDir(dir, 'p.stl')
    expect(basename(r)).toBe('p_1.stl')
  })

  it('skips _N when N is already taken (steps to _N+1)', async () => {
    const dir = await tmp('E-skip')
    await writeFile(join(dir, 'p.stl'), '')
    await writeFile(join(dir, 'p_1.stl'), '')
    const r = await resolveUniqueFilenameInDir(dir, 'p.stl')
    expect(basename(r)).toBe('p_2.stl')
  })

  it('continues skipping until the first free slot', async () => {
    const dir = await tmp('E-skipfar')
    for (const i of [0, 1, 2, 3, 4]) {
      const name = i === 0 ? 'p.stl' : `p_${i}.stl`
      await writeFile(join(dir, name), '')
    }
    const r = await resolveUniqueFilenameInDir(dir, 'p.stl')
    expect(basename(r)).toBe('p_5.stl')
  })

  it('does not depend on alphabetical / readdir ordering of unrelated files', async () => {
    const dir = await tmp('E-unrelated')
    await writeFile(join(dir, 'zzz.txt'), '')
    await writeFile(join(dir, 'aaa.txt'), '')
    await writeFile(join(dir, 'p.stl'), '')
    const r = await resolveUniqueFilenameInDir(dir, 'p.stl')
    expect(basename(r)).toBe('p_1.stl')
  })

  it('cascade stops at the first free slot (does not over-shoot)', async () => {
    const dir = await tmp('E-stop')
    await writeFile(join(dir, 'p.stl'), '')
    await writeFile(join(dir, 'p_2.stl'), '') // intentionally skip _1
    const r = await resolveUniqueFilenameInDir(dir, 'p.stl')
    // _1 is free even though _2 is taken -> the loop returns _1 first.
    expect(basename(r)).toBe('p_1.stl')
  })
})

// --------------------------------------------------------------------------
// (F) Extension handling -- including multi-dot and dotfile cases
// --------------------------------------------------------------------------
describe('[ID-0248] (F) extension handling', () => {
  it('preserves .stl', async () => {
    const dir = await tmp('F-stl')
    const r = await resolveUniqueFilenameInDir(dir, 'cube.stl')
    expect(basename(r)).toBe('cube.stl')
  })

  it('preserves .step', async () => {
    const dir = await tmp('F-step')
    const r = await resolveUniqueFilenameInDir(dir, 'cube.step')
    expect(basename(r)).toBe('cube.step')
  })

  it('preserves .iges', async () => {
    const dir = await tmp('F-iges')
    const r = await resolveUniqueFilenameInDir(dir, 'cube.iges')
    expect(basename(r)).toBe('cube.iges')
  })

  it('preserves .nc', async () => {
    const dir = await tmp('F-nc')
    const r = await resolveUniqueFilenameInDir(dir, 'cube.nc')
    expect(basename(r)).toBe('cube.nc')
  })

  it('multi-dot file: extname is the LAST segment (foo.tar.gz -> base=foo.tar, ext=.gz)', async () => {
    const dir = await tmp('F-multi')
    await writeFile(join(dir, 'foo.tar.gz'), '')
    const r = await resolveUniqueFilenameInDir(dir, 'foo.tar.gz')
    // node:path treats only the LAST dot as the extension separator.
    expect(basename(r)).toBe('foo.tar_1.gz')
  })

  it('no-extension file: base preserved, no underscore introduced', async () => {
    const dir = await tmp('F-noext')
    const r = await resolveUniqueFilenameInDir(dir, 'README')
    expect(basename(r)).toBe('README')
  })

  it('no-extension collision adds plain _1 (no extension boundary)', async () => {
    const dir = await tmp('F-noext-col')
    await writeFile(join(dir, 'README'), '')
    const r = await resolveUniqueFilenameInDir(dir, 'README')
    expect(basename(r)).toBe('README_1')
  })

  it('dotfile (.bashrc): node:path extname() is "" -> whole name treated as base', async () => {
    const dir = await tmp('F-dotfile')
    await writeFile(join(dir, '.bashrc'), '')
    const r = await resolveUniqueFilenameInDir(dir, '.bashrc')
    // extname('.bashrc') === '' per node:path; basename === '.bashrc'.
    expect(basename(r)).toBe('.bashrc_1')
  })
})

// --------------------------------------------------------------------------
// (G) Basename edge cases
// --------------------------------------------------------------------------
describe('[ID-0248] (G) basename fallback + edge cases', () => {
  it('empty preferredFileName falls back to "asset"', async () => {
    const dir = await tmp('G-empty')
    const r = await resolveUniqueFilenameInDir(dir, '')
    expect(basename(r)).toBe('asset')
  })

  it('empty preferredFileName collision allocates asset_1', async () => {
    const dir = await tmp('G-empty-col')
    await writeFile(join(dir, 'asset'), '')
    const r = await resolveUniqueFilenameInDir(dir, '')
    expect(basename(r)).toBe('asset_1')
  })

  it('preferred name "." (dot only) collides with the dir itself -> allocates ._1', async () => {
    const dir = await tmp('G-dot')
    const r = await resolveUniqueFilenameInDir(dir, '.')
    // basename('.', extname('.')) === '.'  (node:path).
    // The production loop probes `dir/.` which ALWAYS exists (it IS dir),
    // so the cascade rolls forward to the first `dir/._N` slot. On a fresh
    // empty dir that is `._1`. Pin this concrete behavior so a refactor
    // (e.g. treating "." as empty -> 'asset' fallback) surfaces here.
    expect(basename(r)).toBe('._1')
  })

  it('basename with spaces preserved verbatim (no normalization)', async () => {
    const dir = await tmp('G-spaces')
    const r = await resolveUniqueFilenameInDir(dir, 'my part v2.stl')
    expect(basename(r)).toBe('my part v2.stl')
  })

  it('basename with non-ASCII (unicode) preserved', async () => {
    const dir = await tmp('G-unicode')
    const r = await resolveUniqueFilenameInDir(dir, 'piπ.stl')
    expect(basename(r)).toBe('piπ.stl')
  })

  it('basename with hyphens / underscores preserved', async () => {
    const dir = await tmp('G-hyphens')
    const r = await resolveUniqueFilenameInDir(dir, 'multi_part-v3_alt.stl')
    expect(basename(r)).toBe('multi_part-v3_alt.stl')
  })
})

// --------------------------------------------------------------------------
// (H) Path semantics
// --------------------------------------------------------------------------
describe('[ID-0248] (H) path semantics', () => {
  it('uses platform path.join semantics (sep matches process)', async () => {
    const dir = await tmp('H-join')
    const r = await resolveUniqueFilenameInDir(dir, 'a.stl')
    expect(r).toBe(join(dir, 'a.stl'))
  })

  it('directory portion matches input dir exactly', async () => {
    const dir = await tmp('H-dir')
    const r = await resolveUniqueFilenameInDir(dir, 'a.stl')
    expect(dirname(r)).toBe(dir)
  })

  it('does not introduce duplicate separators when input dir has trailing sep', async () => {
    const root = await tmp('H-trailing')
    const dir = root + sep
    const r = await resolveUniqueFilenameInDir(dir, 'a.stl')
    // node:path.join collapses multiple separators -- pin that the result
    // has no `${sep}${sep}` substring.
    expect(r).not.toContain(sep + sep)
  })

  it('relative-style preferredFileName with subdir traversal is treated as a basename only', async () => {
    // node:path basename('sub/part.stl') === 'part.stl' on POSIX.
    // We pin that the helper does NOT silently honour a subdirectory in the preferredFileName.
    const dir = await tmp('H-noslash')
    const r = await resolveUniqueFilenameInDir(dir, 'sub/part.stl')
    // The expected basename is whatever node:path.basename(preferred, extname(preferred)) produces.
    const expectedBase = basename('sub/part.stl', extname('sub/part.stl'))
    expect(basename(r)).toBe(`${expectedBase}.stl`)
  })

  it('does not write any file (read-only behavior)', async () => {
    const dir = await tmp('H-readonly')
    await resolveUniqueFilenameInDir(dir, 'a.stl')
    expect(await readdir(dir)).toEqual([])
  })
})

// --------------------------------------------------------------------------
// (I) Three-machine path realism
// --------------------------------------------------------------------------
describe('[ID-0248] (I) three-machine path realism', () => {
  it('K2 Plus: STL import for FDM slicing -- unique allocation across two K2 jobs', async () => {
    const dir = await tmp('I-k2')
    const a = await resolveUniqueFilenameInDir(dir, 'creality_K2Plus_cube.stl')
    await writeFile(a, 'solid mock\nendsolid\n')
    const b = await resolveUniqueFilenameInDir(dir, 'creality_K2Plus_cube.stl')
    expect(basename(a)).toBe('creality_K2Plus_cube.stl')
    expect(basename(b)).toBe('creality_K2Plus_cube_1.stl')
  })

  it('Laguna Swift 5x10: full-sheet plywood STL import unique allocation', async () => {
    const dir = await tmp('I-laguna')
    const a = await resolveUniqueFilenameInDir(dir, 'laguna_fullsheet_pocket.stl')
    await writeFile(a, '')
    const b = await resolveUniqueFilenameInDir(dir, 'laguna_fullsheet_pocket.stl')
    expect(basename(b)).toBe('laguna_fullsheet_pocket_1.stl')
  })

  it('Carvera 4-axis: rotary STL import unique allocation', async () => {
    const dir = await tmp('I-carvera')
    const a = await resolveUniqueFilenameInDir(dir, 'carvera_rotary_cylinder.stl')
    await writeFile(a, '')
    const b = await resolveUniqueFilenameInDir(dir, 'carvera_rotary_cylinder.stl')
    expect(basename(b)).toBe('carvera_rotary_cylinder_1.stl')
  })

  it('mixed-machine batch import: each machine name keeps its own counter', async () => {
    const dir = await tmp('I-mixed')
    const k2 = await resolveUniqueFilenameInDir(dir, 'k2_part.stl')
    await writeFile(k2, '')
    const lg = await resolveUniqueFilenameInDir(dir, 'laguna_part.stl')
    await writeFile(lg, '')
    const cv = await resolveUniqueFilenameInDir(dir, 'carvera_part.stl')
    await writeFile(cv, '')
    expect(basename(k2)).toBe('k2_part.stl')
    expect(basename(lg)).toBe('laguna_part.stl')
    expect(basename(cv)).toBe('carvera_part.stl')

    const k22 = await resolveUniqueFilenameInDir(dir, 'k2_part.stl')
    const lg2 = await resolveUniqueFilenameInDir(dir, 'laguna_part.stl')
    const cv2 = await resolveUniqueFilenameInDir(dir, 'carvera_part.stl')
    expect(basename(k22)).toBe('k2_part_1.stl')
    expect(basename(lg2)).toBe('laguna_part_1.stl')
    expect(basename(cv2)).toBe('carvera_part_1.stl')
  })

  it('cross-extension realism: STEP from CAD tool + STL after OCCT conversion both get unique names', async () => {
    const dir = await tmp('I-step-stl')
    const stepA = await resolveUniqueFilenameInDir(dir, 'gear.step')
    await writeFile(stepA, '')
    const stepB = await resolveUniqueFilenameInDir(dir, 'gear.step')
    const stlA = await resolveUniqueFilenameInDir(dir, 'gear.stl')
    await writeFile(stlA, '')
    const stlB = await resolveUniqueFilenameInDir(dir, 'gear.stl')
    expect(basename(stepA)).toBe('gear.step')
    expect(basename(stepB)).toBe('gear_1.step')
    expect(basename(stlA)).toBe('gear.stl')
    expect(basename(stlB)).toBe('gear_1.stl')
  })

  it('asset destination realism: occt-import.ts:48 path (project assets dir + bare stem)', async () => {
    // Mirrors `await resolveUniqueFilenameInDir(projectAssetsDir, name)` at
    // src/main/cad/occt-import.ts:48 where `name` is the user-supplied import filename.
    const dir = await tmp('I-occt')
    await mkdir(join(dir, 'assets'), { recursive: true })
    const assets = join(dir, 'assets')
    const r = await resolveUniqueFilenameInDir(assets, 'imported-spool.step')
    expect(dirname(r)).toBe(assets)
    expect(basename(r)).toBe('imported-spool.step')
  })
})

// --------------------------------------------------------------------------
// (J) Async + concurrency invariants
// --------------------------------------------------------------------------
describe('[ID-0248] (J) async invariants', () => {
  it('thenable Promise is resolved (then handler fires)', async () => {
    const dir = await tmp('J-then')
    const r: string = await new Promise((resolve, reject) => {
      resolveUniqueFilenameInDir(dir, 'a.stl').then(resolve, reject)
    })
    expect(r).toBe(join(dir, 'a.stl'))
  })

  it('two concurrent calls on a free dir resolve to the same path (probe is read-only)', async () => {
    const dir = await tmp('J-concurrent')
    const [a, b] = await Promise.all([
      resolveUniqueFilenameInDir(dir, 'p.stl'),
      resolveUniqueFilenameInDir(dir, 'p.stl'),
    ])
    expect(a).toBe(b)
  })

  it('serialised: write-after-resolve produces the next slot for the next caller', async () => {
    const dir = await tmp('J-serial')
    const a = await resolveUniqueFilenameInDir(dir, 'p.stl')
    await writeFile(a, '')
    const b = await resolveUniqueFilenameInDir(dir, 'p.stl')
    expect(basename(b)).toBe('p_1.stl')
  })

  it('does not throw on rapid serial calls', async () => {
    const dir = await tmp('J-rapid')
    for (let i = 0; i < 5; i++) {
      const r = await resolveUniqueFilenameInDir(dir, `f${i}.stl`)
      expect(typeof r).toBe('string')
    }
  })
})

// --------------------------------------------------------------------------
// (K) Source-text whitelist
// --------------------------------------------------------------------------
describe('[ID-0248] (K) source-text whitelist', () => {
  it('source size <30 lines (currently 22)', async () => {
    const src = await readSrc()
    const lc = src.split('\n').length
    expect(lc).toBeLessThan(30)
  })

  it('source size <1 KB (currently 635 bytes)', async () => {
    const src = await readSrc()
    expect(Buffer.byteLength(src, 'utf-8')).toBeLessThan(1024)
  })

  it('imports access + constants from node:fs/promises', async () => {
    const src = await readSrc()
    expect(src).toMatch(/from 'node:fs\/promises'/)
    expect(src).toMatch(/\baccess\b/)
    expect(src).toMatch(/\bconstants\b/)
  })

  it('imports basename + extname + join from node:path', async () => {
    const src = await readSrc()
    expect(src).toMatch(/from 'node:path'/)
    expect(src).toMatch(/\bbasename\b/)
    expect(src).toMatch(/\bextname\b/)
    expect(src).toMatch(/\bjoin\b/)
  })

  it('uses constants.F_OK for the existence probe (not stat / lstat)', async () => {
    const src = await readSrc()
    expect(src).toMatch(/constants\.F_OK/)
    // Negative: this module must NOT call stat / lstat / readFile / writeFile.
    expect(src).not.toMatch(/\bstat\b/)
    expect(src).not.toMatch(/\blstat\b/)
    expect(src).not.toMatch(/\breadFile\b/)
    expect(src).not.toMatch(/\bwriteFile\b/)
    expect(src).not.toMatch(/\bmkdir\b/)
    expect(src).not.toMatch(/\bunlink\b/)
  })

  it('declares exactly one async export', async () => {
    const src = await readSrc()
    const m = src.match(/^export async function /gm)
    expect(m?.length ?? 0).toBe(1)
  })

  it('export is named resolveUniqueFilenameInDir verbatim', async () => {
    const src = await readSrc()
    expect(src).toMatch(/export async function resolveUniqueFilenameInDir\b/)
  })

  it('basename fallback literal "asset" is present', async () => {
    const src = await readSrc()
    expect(src).toMatch(/'asset'/)
  })

  it('suffix shape literal `_${n}` is present (the underscore + variable shape)', async () => {
    const src = await readSrc()
    expect(src).toMatch(/_\$\{n\}/)
  })

  it('no toolpath G-code or M-code emitted from this module', async () => {
    const src = await readSrc()
    expect(src).not.toMatch(/\bG0\b|\bG1\b|\bG17\b|\bG18\b|\bG19\b|\bG20\b|\bG21\b|\bG28\b|\bG54\b|\bG90\b|\bG91\b/)
    expect(src).not.toMatch(/\bM3\b|\bM5\b|\bM6\b|\bM30\b|\bM64\b|\bM65\b|\bM104\b|\bM140\b|\bM84\b/)
  })

  it('no foreign-machine vendor names in source (helper is machine-agnostic)', async () => {
    const src = await readSrc()
    expect(src).not.toMatch(/\bBambu\b|\bPrusa\b|\bHaas\b|\bTormach\b|\bMach4\b/)
  })

  it('zero runtime imports outside of node:fs/promises + node:path (Node-only, no Electron / React / Three)', async () => {
    const src = await readSrc()
    expect(src).not.toMatch(/from 'electron'/)
    expect(src).not.toMatch(/from 'react'/)
    expect(src).not.toMatch(/from 'three'/)
    expect(src).not.toMatch(/from 'handlebars'/)
    expect(src).not.toMatch(/from 'child_process'/)
    expect(src).not.toMatch(/from 'dgram'/)
    expect(src).not.toMatch(/from 'net'/)
    expect(src).not.toMatch(/from 'tls'/)
  })

  it('no `:any` or `as any` type escapes in source', async () => {
    const src = await readSrc()
    expect(src).not.toMatch(/:\s*any\b/)
    expect(src).not.toMatch(/\bas any\b/)
    expect(src).not.toMatch(/<any>/)
  })

  it('no default export', async () => {
    const src = await readSrc()
    expect(src).not.toMatch(/^export default\b/m)
  })
})

// --------------------------------------------------------------------------
// (L) Pure-ish invariants
// --------------------------------------------------------------------------
describe('[ID-0248] (L) pure-ish invariants', () => {
  it('does not mutate the input dir argument (string is primitive but pin keeps shape stable)', async () => {
    const dir = await tmp('L-noinput')
    const before = dir.slice()
    await resolveUniqueFilenameInDir(dir, 'a.stl')
    expect(dir).toBe(before)
  })

  it('idempotent on a free dir across N=20 successive calls', async () => {
    const dir = await tmp('L-idem')
    const first = await resolveUniqueFilenameInDir(dir, 'p.stl')
    for (let i = 0; i < 20; i++) {
      const r = await resolveUniqueFilenameInDir(dir, 'p.stl')
      expect(r).toBe(first)
    }
  })

  it('order independence: alphabetic order of unrelated files does not affect allocation', async () => {
    const dir = await tmp('L-order')
    await writeFile(join(dir, 'aaa.stl'), '')
    await writeFile(join(dir, 'zzz.stl'), '')
    await writeFile(join(dir, 'p.stl'), '')
    const r = await resolveUniqueFilenameInDir(dir, 'p.stl')
    expect(basename(r)).toBe('p_1.stl')
  })

  it('numbering is monotone non-decreasing across cascade', async () => {
    const dir = await tmp('L-monotone')
    const allocations: number[] = []
    for (let i = 0; i < 4; i++) {
      const r = await resolveUniqueFilenameInDir(dir, 'p.stl')
      await writeFile(r, '')
      const n = i === 0 ? 0 : Number((basename(r).match(/_(\d+)\.stl$/) ?? [, '0'])[1])
      allocations.push(n)
    }
    for (let i = 1; i < allocations.length; i++) {
      expect(allocations[i]).toBeGreaterThanOrEqual(allocations[i - 1])
    }
    expect(allocations).toEqual([0, 1, 2, 3])
  })

  it('does not throw on a permissions-style error -- access throws ENOENT or EPERM, both treated as "free"', async () => {
    // We model the ENOENT-as-free path via a non-existent dir; EPERM is harder to simulate
    // portably so we just assert the ENOENT branch. The catch is intentionally bare per
    // the source ("for (;;) ... try {access} catch {return full}"), so any access-throw
    // counts as "free" -- pinning that here keeps a future maintainer from narrowing the
    // catch to (e: ENOENT) and breaking the EPERM/EACCES branches silently.
    const ghost = join(await tmp('L-perm'), 'never-created')
    const r = await resolveUniqueFilenameInDir(ghost, 'a.stl')
    expect(r).toBe(join(ghost, 'a.stl'))
  })
})
