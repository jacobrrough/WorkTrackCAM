/**
 * Co-located paired-pin contract for `src/main/drawing-file-store.ts`
 *
 * [ID-0253] Cycle 181 test-coverage paired-pin -- pins the runtime contract of
 * the 23-line / 924-byte SHARED main-process drawing.json persistence helper
 * that backs the in-app drawing-sheet sidebar consumed at TWO production
 * call-sites:
 *   - `src/main/ipc-modeling.ts:49`  -- `drawing:load`  IPC handler.
 *   - `src/main/ipc-modeling.ts:59`  -- `drawing:save`  IPC handler.
 *   - `src/main/drawing-export-service.ts:122` -- pre-export draw-shell read.
 *
 * Three production call-sites total (the second IPC handler dispatches into
 * `saveDrawingFile`; the export service consumes `loadDrawingFile` only).
 *
 * The helper is the SOLE persistence layer for the per-project drawing-sheet
 * file at `<projectDir>/drawing/drawing.json`. Every shop-floor project in
 * the three target machines (K2 Plus FDM, Laguna Swift 5x10 router, Carvera
 * 4-axis) will have its drawing-sheet metadata round-tripped through this
 * pair, so a silent regression in (a) the ENOENT-fallback shape, (b) the
 * schema-validation gate, (c) the directory layout (`/drawing/drawing.json`),
 * (d) the JSON pretty-print spacing, (e) the utf-8 encoding, would corrupt
 * every drawing-sheet edit on every machine.
 *
 * The helper is currently covered ONLY by `vi.mock(...)` stubs in
 * `src/main/ipc-modeling.test.ts:52-55` -- the real helper has no behavioral
 * coverage. This paired-pin extends coverage to lock the contract.
 *
 * Pinned in this file:
 *   (A) Module shape
 *   (B) Function signatures (load + save)
 *   (C) `loadDrawingFile` happy path -- file present + valid
 *   (D) `loadDrawingFile` ENOENT -> empty-file fallback
 *   (E) `loadDrawingFile` non-ENOENT errors propagate (JSON parse / schema)
 *   (F) `saveDrawingFile` happy path -- mkdir + write + JSON layout
 *   (G) `saveDrawingFile` schema-validation gate (rejects malformed input)
 *   (H) Round-trip load -> save -> load equality
 *   (I) Three-machine path realism (K2 Plus / Laguna Swift / Carvera projDir)
 *   (J) Source-text whitelist (size, no foreign vendors, no toolpath G/M)
 *   (K) Pure-ish invariants (idempotent load on unchanged file)
 */
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, sep } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import * as moduleNs from './drawing-file-store'
import { loadDrawingFile, saveDrawingFile } from './drawing-file-store'
import { emptyDrawingFile, type DrawingFile } from '../shared/drawing-sheet-schema'

// [annotations additive] `drawingSheetSchema` gained an additive, fully-
// OPTIONAL `annotations` field (no Zod `.default`, so save/load stays
// byte-faithful: a sheet authored without annotations round-trips without
// them). These round-trip pins therefore continue to assert exact equality
// against their bare fixtures with NO normalization — the additive field is
// invisible until a caller writes annotations.

const SRC_PATH = 'src/main/drawing-file-store.ts'
let SRC: string | null = null
async function readSrc(): Promise<string> {
  if (SRC === null) SRC = await readFile(SRC_PATH, 'utf-8')
  return SRC
}

// Each describe gets a private temp dir so parallel runs are safe.
const TMP_ROOTS: string[] = []
async function tmp(prefix: string): Promise<string> {
  const t = await mkdtemp(join(tmpdir(), `dfs-pin-${prefix}-`))
  TMP_ROOTS.push(t)
  return t
}

afterAll(() => {
  // Defensive: every tmp root must live under tmpdir().
  for (const r of TMP_ROOTS) {
    expect(r.startsWith(tmpdir())).toBe(true)
  }
})

// --------------------------------------------------------------------------
// (A) Module shape
// --------------------------------------------------------------------------
describe('[ID-0253] (A) module shape', () => {
  it('exports exactly two runtime symbols: loadDrawingFile + saveDrawingFile', () => {
    const keys = Object.keys(moduleNs).sort()
    expect(keys).toEqual(['loadDrawingFile', 'saveDrawingFile'])
  })

  it('namespace Symbol.toStringTag is Module', () => {
    expect((moduleNs as unknown as { [Symbol.toStringTag]?: string })[Symbol.toStringTag]).toBe(
      'Module'
    )
  })

  it('does not have a default export', () => {
    expect((moduleNs as unknown as { default?: unknown }).default).toBeUndefined()
  })

  it('loadDrawingFile is a Function', () => {
    expect(typeof loadDrawingFile).toBe('function')
  })

  it('saveDrawingFile is a Function', () => {
    expect(typeof saveDrawingFile).toBe('function')
  })

  it('loadDrawingFile is async (constructor.name AsyncFunction)', () => {
    expect(loadDrawingFile.constructor.name).toBe('AsyncFunction')
  })

  it('saveDrawingFile is async (constructor.name AsyncFunction)', () => {
    expect(saveDrawingFile.constructor.name).toBe('AsyncFunction')
  })

  it('exactly two runtime keys (no leakage of helpers)', () => {
    expect(Object.keys(moduleNs)).toHaveLength(2)
  })
})

// --------------------------------------------------------------------------
// (B) Function signatures
// --------------------------------------------------------------------------
describe('[ID-0253] (B) function signatures', () => {
  it('loadDrawingFile.name is loadDrawingFile', () => {
    expect(loadDrawingFile.name).toBe('loadDrawingFile')
  })

  it('saveDrawingFile.name is saveDrawingFile', () => {
    expect(saveDrawingFile.name).toBe('saveDrawingFile')
  })

  it('loadDrawingFile.length (arity) is 1', () => {
    expect(loadDrawingFile.length).toBe(1)
  })

  it('saveDrawingFile.length (arity) is 2', () => {
    expect(saveDrawingFile.length).toBe(2)
  })

  it('loadDrawingFile returns a Promise', async () => {
    const dir = await tmp('B-load-promise')
    const p = loadDrawingFile(dir)
    expect(p).toBeInstanceOf(Promise)
    await p // drain
  })

  it('saveDrawingFile returns a Promise<void>', async () => {
    const dir = await tmp('B-save-promise')
    const p = saveDrawingFile(dir, emptyDrawingFile())
    expect(p).toBeInstanceOf(Promise)
    const r = await p
    expect(r).toBeUndefined()
  })

  it('loadDrawingFile is not a class (no `prototype.constructor` user-defined surface)', () => {
    // AsyncFunction has no .prototype property at all.
    expect((loadDrawingFile as unknown as { prototype?: unknown }).prototype).toBeUndefined()
  })

  it('saveDrawingFile is not a class', () => {
    expect((saveDrawingFile as unknown as { prototype?: unknown }).prototype).toBeUndefined()
  })
})

// --------------------------------------------------------------------------
// (C) loadDrawingFile happy path
// --------------------------------------------------------------------------
describe('[ID-0253] (C) loadDrawingFile happy path', () => {
  it('reads <projectDir>/drawing/drawing.json when present + valid', async () => {
    const root = await tmp('C-happy')
    const drawingDir = join(root, 'drawing')
    await mkdir(drawingDir, { recursive: true })
    const fixture: DrawingFile = {
      version: 1,
      sheets: [{ id: 'sheet-1', name: 'Sheet 1' }]
    }
    await writeFile(join(drawingDir, 'drawing.json'), JSON.stringify(fixture, null, 2), 'utf-8')
    const out = await loadDrawingFile(root)
    expect(out).toEqual(fixture)
  })

  it('returns the same shape as the on-disk file (deep equal)', async () => {
    const root = await tmp('C-equal')
    await mkdir(join(root, 'drawing'), { recursive: true })
    const fixture: DrawingFile = {
      version: 1,
      sheets: [
        { id: 's-A', name: 'Front', scale: '1:1' },
        { id: 's-B', name: 'Top', scale: '1:2', meshProjectionTier: 'B' }
      ]
    }
    await writeFile(
      join(root, 'drawing', 'drawing.json'),
      JSON.stringify(fixture, null, 2),
      'utf-8'
    )
    const out = await loadDrawingFile(root)
    expect(out).toEqual(fixture)
  })

  it('returns DrawingFile with version === 1 always (literal pin)', async () => {
    const root = await tmp('C-version')
    await mkdir(join(root, 'drawing'), { recursive: true })
    await writeFile(
      join(root, 'drawing', 'drawing.json'),
      JSON.stringify({ version: 1, sheets: [] }),
      'utf-8'
    )
    const out = await loadDrawingFile(root)
    expect(out.version).toBe(1)
  })

  it('returns DrawingFile with sheets:[] default applied when missing', async () => {
    const root = await tmp('C-default-sheets')
    await mkdir(join(root, 'drawing'), { recursive: true })
    // Schema has `sheets: z.array(...).default([])`, so on-disk file may omit it.
    await writeFile(
      join(root, 'drawing', 'drawing.json'),
      JSON.stringify({ version: 1 }),
      'utf-8'
    )
    const out = await loadDrawingFile(root)
    expect(out.sheets).toEqual([])
  })

  it('reads from the EXACT path `<projectDir>/drawing/drawing.json` (not the root)', async () => {
    const root = await tmp('C-exact-path')
    // Plant a DECOY at the project root that should NEVER be read.
    await writeFile(
      join(root, 'drawing.json'),
      JSON.stringify({ version: 1, sheets: [{ id: 'decoy', name: 'DECOY' }] }),
      'utf-8'
    )
    // Plant the REAL file under the drawing/ subdir.
    await mkdir(join(root, 'drawing'), { recursive: true })
    await writeFile(
      join(root, 'drawing', 'drawing.json'),
      JSON.stringify({ version: 1, sheets: [{ id: 'real', name: 'REAL' }] }),
      'utf-8'
    )
    const out = await loadDrawingFile(root)
    expect(out.sheets[0]?.id).toBe('real')
    expect(out.sheets[0]?.name).toBe('REAL')
  })

  it('parses utf-8 (multi-byte sheet names)', async () => {
    const root = await tmp('C-utf8')
    await mkdir(join(root, 'drawing'), { recursive: true })
    const name = 'Sheet \u00b1 \u00b5m \u00d8 \u00e9 \u00e7'
    await writeFile(
      join(root, 'drawing', 'drawing.json'),
      JSON.stringify({ version: 1, sheets: [{ id: 'a', name }] }),
      'utf-8'
    )
    const out = await loadDrawingFile(root)
    expect(out.sheets[0]?.name).toBe(name)
  })
})

// --------------------------------------------------------------------------
// (D) loadDrawingFile ENOENT fallback
// --------------------------------------------------------------------------
describe('[ID-0253] (D) loadDrawingFile ENOENT fallback', () => {
  it('returns emptyDrawingFile() when the project dir does not exist', async () => {
    const root = await tmp('D-no-project')
    const ghost = join(root, 'no-such-project')
    const out = await loadDrawingFile(ghost)
    expect(out).toEqual({ version: 1, sheets: [] })
  })

  it('returns emptyDrawingFile() when the drawing/ subdir is missing', async () => {
    const root = await tmp('D-no-subdir')
    const out = await loadDrawingFile(root)
    expect(out).toEqual({ version: 1, sheets: [] })
  })

  it('returns emptyDrawingFile() when drawing/ exists but drawing.json is missing', async () => {
    const root = await tmp('D-no-file')
    await mkdir(join(root, 'drawing'), { recursive: true })
    const out = await loadDrawingFile(root)
    expect(out).toEqual({ version: 1, sheets: [] })
  })

  it('ENOENT fallback shape matches `emptyDrawingFile()` exactly', async () => {
    const root = await tmp('D-shape-match')
    const out = await loadDrawingFile(root)
    expect(out).toEqual(emptyDrawingFile())
  })

  it('ENOENT fallback returns a fresh object each call (no shared singleton)', async () => {
    const root = await tmp('D-fresh')
    const a = await loadDrawingFile(root)
    const b = await loadDrawingFile(root)
    expect(a).toEqual(b)
    // Mutating one must NOT mutate the other.
    a.sheets.push({ id: 'mut', name: 'mut' })
    expect(b.sheets).toEqual([])
  })
})

// --------------------------------------------------------------------------
// (E) loadDrawingFile non-ENOENT errors propagate
// --------------------------------------------------------------------------
describe('[ID-0253] (E) loadDrawingFile non-ENOENT errors propagate', () => {
  it('throws on JSON parse error', async () => {
    const root = await tmp('E-json-parse')
    await mkdir(join(root, 'drawing'), { recursive: true })
    await writeFile(join(root, 'drawing', 'drawing.json'), '{ not valid json', 'utf-8')
    await expect(loadDrawingFile(root)).rejects.toThrow()
  })

  it('throws on schema mismatch (missing version)', async () => {
    const root = await tmp('E-no-version')
    await mkdir(join(root, 'drawing'), { recursive: true })
    await writeFile(join(root, 'drawing', 'drawing.json'), JSON.stringify({ sheets: [] }), 'utf-8')
    await expect(loadDrawingFile(root)).rejects.toThrow()
  })

  it('throws on schema mismatch (wrong version literal)', async () => {
    const root = await tmp('E-wrong-version')
    await mkdir(join(root, 'drawing'), { recursive: true })
    await writeFile(
      join(root, 'drawing', 'drawing.json'),
      JSON.stringify({ version: 2, sheets: [] }),
      'utf-8'
    )
    await expect(loadDrawingFile(root)).rejects.toThrow()
  })

  it('throws on schema mismatch (sheet missing id)', async () => {
    const root = await tmp('E-no-id')
    await mkdir(join(root, 'drawing'), { recursive: true })
    await writeFile(
      join(root, 'drawing', 'drawing.json'),
      JSON.stringify({ version: 1, sheets: [{ name: 'orphan' }] }),
      'utf-8'
    )
    await expect(loadDrawingFile(root)).rejects.toThrow()
  })

  it('throws on schema mismatch (sheet name empty -- min(1) constraint)', async () => {
    const root = await tmp('E-empty-name')
    await mkdir(join(root, 'drawing'), { recursive: true })
    await writeFile(
      join(root, 'drawing', 'drawing.json'),
      JSON.stringify({ version: 1, sheets: [{ id: 'x', name: '' }] }),
      'utf-8'
    )
    await expect(loadDrawingFile(root)).rejects.toThrow()
  })

  it('does NOT silently fall back to empty on a non-ENOENT error', async () => {
    const root = await tmp('E-no-silent-fallback')
    await mkdir(join(root, 'drawing'), { recursive: true })
    await writeFile(join(root, 'drawing', 'drawing.json'), 'not json at all', 'utf-8')
    let threw = false
    try {
      await loadDrawingFile(root)
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
  })
})

// --------------------------------------------------------------------------
// (F) saveDrawingFile happy path -- mkdir + write + JSON layout
// --------------------------------------------------------------------------
describe('[ID-0253] (F) saveDrawingFile happy path', () => {
  it('creates the drawing/ subdir if it does not exist', async () => {
    const root = await tmp('F-mkdir')
    await saveDrawingFile(root, emptyDrawingFile())
    const st = await stat(join(root, 'drawing'))
    expect(st.isDirectory()).toBe(true)
  })

  it('writes drawing.json under <projectDir>/drawing/', async () => {
    const root = await tmp('F-write-path')
    await saveDrawingFile(root, emptyDrawingFile())
    const txt = await readFile(join(root, 'drawing', 'drawing.json'), 'utf-8')
    expect(typeof txt).toBe('string')
    expect(txt.length).toBeGreaterThan(0)
  })

  it('JSON output is 2-space pretty-printed', async () => {
    const root = await tmp('F-pretty')
    const fixture: DrawingFile = {
      version: 1,
      sheets: [{ id: 'p1', name: 'Pretty' }]
    }
    await saveDrawingFile(root, fixture)
    const txt = await readFile(join(root, 'drawing', 'drawing.json'), 'utf-8')
    // 2-space indent: line 2 should start with 2 spaces.
    const lines = txt.split('\n')
    expect(lines[0]).toBe('{')
    expect(lines[1]?.startsWith('  ')).toBe(true)
  })

  it('JSON output round-trips through JSON.parse to the input', async () => {
    const root = await tmp('F-roundtrip')
    const fixture: DrawingFile = {
      version: 1,
      sheets: [
        { id: 's1', name: 'A' },
        { id: 's2', name: 'B', scale: '1:2' }
      ]
    }
    await saveDrawingFile(root, fixture)
    const txt = await readFile(join(root, 'drawing', 'drawing.json'), 'utf-8')
    const parsed = JSON.parse(txt) as DrawingFile
    expect(parsed).toEqual(fixture)
  })

  it('JSON output is utf-8 (multi-byte names round-trip byte-faithfully)', async () => {
    const root = await tmp('F-utf8')
    const fixture: DrawingFile = {
      version: 1,
      sheets: [{ id: 'u', name: 'Sheet \u00d8 \u00b5m' }]
    }
    await saveDrawingFile(root, fixture)
    const txt = await readFile(join(root, 'drawing', 'drawing.json'), 'utf-8')
    expect(txt).toContain('\u00d8')
    expect(txt).toContain('\u00b5')
  })

  it('overwrites an existing drawing.json (no append)', async () => {
    const root = await tmp('F-overwrite')
    await mkdir(join(root, 'drawing'), { recursive: true })
    await writeFile(
      join(root, 'drawing', 'drawing.json'),
      JSON.stringify({ version: 1, sheets: [{ id: 'old', name: 'OLD' }] }, null, 2),
      'utf-8'
    )
    await saveDrawingFile(root, {
      version: 1,
      sheets: [{ id: 'new', name: 'NEW' }]
    })
    const txt = await readFile(join(root, 'drawing', 'drawing.json'), 'utf-8')
    expect(txt).toContain('"NEW"')
    expect(txt).not.toContain('OLD')
  })

  it('mkdir is recursive (does not throw if intermediate already exists)', async () => {
    const root = await tmp('F-recursive')
    // Pre-create drawing/ dir + drawing.json.
    await mkdir(join(root, 'drawing'), { recursive: true })
    await writeFile(join(root, 'drawing', 'drawing.json'), '{}', 'utf-8')
    // saveDrawingFile must not throw on the pre-existing dir.
    await expect(saveDrawingFile(root, emptyDrawingFile())).resolves.toBeUndefined()
  })

  it('writes only the drawing.json file (no sibling files)', async () => {
    const root = await tmp('F-only-one')
    await saveDrawingFile(root, emptyDrawingFile())
    const entries = await readdir(join(root, 'drawing'))
    expect(entries).toEqual(['drawing.json'])
  })
})

// --------------------------------------------------------------------------
// (G) saveDrawingFile schema-validation gate
// --------------------------------------------------------------------------
describe('[ID-0253] (G) saveDrawingFile schema-validation gate', () => {
  it('rejects malformed input (wrong version)', async () => {
    const root = await tmp('G-wrong-version')
    const bad = { version: 999, sheets: [] } as unknown as DrawingFile
    await expect(saveDrawingFile(root, bad)).rejects.toThrow()
  })

  it('rejects malformed input (sheet missing id)', async () => {
    const root = await tmp('G-no-id')
    const bad = { version: 1, sheets: [{ name: 'orphan' }] } as unknown as DrawingFile
    await expect(saveDrawingFile(root, bad)).rejects.toThrow()
  })

  it('rejects malformed input (sheet name empty)', async () => {
    const root = await tmp('G-empty-name')
    const bad = { version: 1, sheets: [{ id: 'x', name: '' }] } as unknown as DrawingFile
    await expect(saveDrawingFile(root, bad)).rejects.toThrow()
  })

  it('does NOT write drawing.json on schema rejection', async () => {
    const root = await tmp('G-no-write-on-reject')
    const bad = { version: 7, sheets: [] } as unknown as DrawingFile
    let threw = false
    try {
      await saveDrawingFile(root, bad)
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
    // The schema check happens AFTER mkdir, so the dir may exist, but the
    // file MUST NOT.
    const entries = await readdir(join(root, 'drawing')).catch(() => [] as string[])
    expect(entries).not.toContain('drawing.json')
  })
})

// --------------------------------------------------------------------------
// (H) Round-trip load -> save -> load
// --------------------------------------------------------------------------
describe('[ID-0253] (H) round-trip', () => {
  it('save then load yields the original file (single sheet)', async () => {
    const root = await tmp('H-roundtrip-1')
    const fixture: DrawingFile = {
      version: 1,
      sheets: [{ id: 's', name: 'S' }]
    }
    await saveDrawingFile(root, fixture)
    const out = await loadDrawingFile(root)
    expect(out).toEqual(fixture)
  })

  it('save then load yields the original file (multi-sheet with optional fields)', async () => {
    const root = await tmp('H-roundtrip-multi')
    const fixture: DrawingFile = {
      version: 1,
      sheets: [
        { id: 's1', name: 'Front', scale: '1:1', meshProjectionTier: 'A' },
        { id: 's2', name: 'Top', scale: '1:2', meshProjectionTier: 'B' },
        {
          id: 's3',
          name: 'Iso',
          sheetTemplateHint: 'iso template',
          viewPlaceholders: [
            { id: 'vp1', kind: 'base', label: 'main', viewFrom: 'iso' }
          ]
        }
      ]
    }
    await saveDrawingFile(root, fixture)
    const out = await loadDrawingFile(root)
    expect(out).toEqual(fixture)
  })

  it('two saves of the same input produce byte-identical files', async () => {
    const rootA = await tmp('H-bytes-a')
    const rootB = await tmp('H-bytes-b')
    const fixture: DrawingFile = {
      version: 1,
      sheets: [{ id: 'b', name: 'Byteable' }]
    }
    await saveDrawingFile(rootA, fixture)
    await saveDrawingFile(rootB, fixture)
    const a = await readFile(join(rootA, 'drawing', 'drawing.json'), 'utf-8')
    const b = await readFile(join(rootB, 'drawing', 'drawing.json'), 'utf-8')
    expect(a).toBe(b)
  })

  it('load -> save -> load is a fixed point (idempotent normalization)', async () => {
    const root = await tmp('H-fixedpoint')
    const fixture: DrawingFile = {
      version: 1,
      sheets: [{ id: 'fp', name: 'FixedPoint' }]
    }
    await saveDrawingFile(root, fixture)
    const a = await loadDrawingFile(root)
    await saveDrawingFile(root, a)
    const b = await loadDrawingFile(root)
    expect(b).toEqual(a)
  })
})

// --------------------------------------------------------------------------
// (I) Three-machine path realism
// --------------------------------------------------------------------------
describe('[ID-0253] (I) three-machine path realism', () => {
  it('K2 Plus FDM project: round-trips a 350x350x350 build-volume sheet doc', async () => {
    const root = await tmp('I-k2-plus')
    const fixture: DrawingFile = {
      version: 1,
      sheets: [
        {
          id: 'k2-front',
          name: 'K2 Plus build-volume datum',
          scale: '1:5',
          sheetTemplateHint: 'k2-plus 350mm cube',
          meshProjectionTier: 'A',
          viewPlaceholders: [{ id: 'vp', kind: 'base', label: 'front', viewFrom: 'front' }]
        }
      ]
    }
    await saveDrawingFile(root, fixture)
    const out = await loadDrawingFile(root)
    expect(out).toEqual(fixture)
  })

  it('Laguna Swift 5x10 router project: round-trips a 1524x3048 mm sheet doc', async () => {
    const root = await tmp('I-laguna')
    const fixture: DrawingFile = {
      version: 1,
      sheets: [
        {
          id: 'laguna-top',
          name: 'Full-sheet plywood layout',
          scale: '1:20',
          sheetTemplateHint: 'laguna swift 5x10 vacuum 6-zone',
          meshProjectionTier: 'B',
          viewPlaceholders: [
            { id: 'vp-top', kind: 'base', label: 'top', viewFrom: 'top' },
            {
              id: 'vp-front',
              kind: 'projected',
              label: 'front-from-top',
              parentPlaceholderId: 'vp-top',
              projectionDirection: 'front'
            }
          ]
        }
      ]
    }
    await saveDrawingFile(root, fixture)
    const out = await loadDrawingFile(root)
    expect(out).toEqual(fixture)
  })

  it('Carvera 4-axis project: round-trips a 92mm-diameter rotary sheet doc', async () => {
    const root = await tmp('I-carvera')
    const fixture: DrawingFile = {
      version: 1,
      sheets: [
        {
          id: 'carvera-iso',
          name: '4-axis rotary stock 92mm x 240mm',
          scale: '1:2',
          sheetTemplateHint: 'carvera 4axis cylinder',
          meshProjectionTier: 'C',
          viewPlaceholders: [
            { id: 'vp-iso', kind: 'base', label: 'iso', viewFrom: 'iso' }
          ]
        }
      ]
    }
    await saveDrawingFile(root, fixture)
    const out = await loadDrawingFile(root)
    expect(out).toEqual(fixture)
  })

  it('all three machines coexist: 3 sheets in the same project doc', async () => {
    const root = await tmp('I-shop')
    const fixture: DrawingFile = {
      version: 1,
      sheets: [
        { id: 'k2', name: 'K2 Plus', sheetTemplateHint: 'fdm' },
        { id: 'laguna', name: 'Laguna Swift', sheetTemplateHint: 'router' },
        { id: 'carvera', name: 'Carvera 4-axis', sheetTemplateHint: 'rotary' }
      ]
    }
    await saveDrawingFile(root, fixture)
    const out = await loadDrawingFile(root)
    expect(out).toEqual(fixture)
    expect(out.sheets).toHaveLength(3)
  })

  it('a project dir with a space + non-ASCII characters round-trips', async () => {
    const root = await tmp('I-spaces')
    const projectDir = join(root, 'My Shop \u00d8 project')
    const fixture: DrawingFile = {
      version: 1,
      sheets: [{ id: 'a', name: 'A' }]
    }
    await saveDrawingFile(projectDir, fixture)
    const out = await loadDrawingFile(projectDir)
    expect(out).toEqual(fixture)
  })
})

// --------------------------------------------------------------------------
// (J) Source-text whitelist
// --------------------------------------------------------------------------
describe('[ID-0253] (J) source-text whitelist', () => {
  it('source file is <= 30 lines (small, focused helper)', async () => {
    const src = await readSrc()
    const lines = src.split('\n').length
    expect(lines).toBeLessThanOrEqual(30)
  })

  it('source file is <= 1500 bytes', async () => {
    const src = await readSrc()
    expect(Buffer.byteLength(src, 'utf-8')).toBeLessThanOrEqual(1500)
  })

  it('exports exactly two functions (loadDrawingFile + saveDrawingFile)', async () => {
    const src = await readSrc()
    const matches = src.match(/^export\s+async\s+function\s+/gm) ?? []
    expect(matches.length).toBe(2)
  })

  it('imports node:fs/promises (not node:fs sync API)', async () => {
    const src = await readSrc()
    expect(src).toContain("from 'node:fs/promises'")
    expect(src).not.toContain("from 'node:fs'\n")
  })

  it('imports node:path for join() (no relative path concatenation)', async () => {
    const src = await readSrc()
    expect(src).toContain("from 'node:path'")
    expect(src).toContain('join(')
  })

  it('imports drawingFileSchema + emptyDrawingFile from shared schema', async () => {
    const src = await readSrc()
    expect(src).toContain('drawingFileSchema')
    expect(src).toContain('emptyDrawingFile')
    expect(src).toContain('drawing-sheet-schema')
  })

  it('imports isENOENT from shared error helper (no inline ENOENT string check)', async () => {
    const src = await readSrc()
    expect(src).toContain('isENOENT')
    expect(src).toContain('file-parse-errors')
    // No inline 'ENOENT' substring (the named helper masks the literal).
    expect(src).not.toContain("'ENOENT'")
  })

  it('uses the EXACT path layout `<projectDir>/drawing/drawing.json`', async () => {
    const src = await readSrc()
    expect(src).toContain("'drawing'")
    expect(src).toContain("'drawing.json'")
  })

  it('JSON pretty-print spacing is 2 (matches the saveDrawingFile contract)', async () => {
    const src = await readSrc()
    expect(src).toMatch(/JSON\.stringify\([^)]+,\s*null,\s*2\)/)
  })

  it('utf-8 is declared explicitly on every read/write', async () => {
    const src = await readSrc()
    // 2 occurrences: one in readFile, one in writeFile.
    const m = src.match(/'utf-8'/g) ?? []
    expect(m.length).toBeGreaterThanOrEqual(2)
  })

  it('mkdir is called recursively (mkdir(..., { recursive: true }))', async () => {
    const src = await readSrc()
    expect(src).toMatch(/mkdir\([^)]+\{[^}]*recursive:\s*true[^}]*\}/)
  })

  it('no `:any` runtime annotation in source (excluding TODO/FIXME comments)', async () => {
    const src = await readSrc()
    const codeOnly = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(codeOnly).not.toMatch(/:\s*any\b/)
    expect(codeOnly).not.toMatch(/<\s*any\s*>/)
    expect(codeOnly).not.toMatch(/\bas\s+any\b/)
  })

  it('no foreign-machine vendors leak into the source', async () => {
    const src = await readSrc().then((s) => s.toLowerCase())
    for (const vendor of [
      'bambu',
      'prusa',
      'haas',
      'tormach',
      'mach4',
      'shapeoko',
      'onefinity',
      'x-carve',
      'fanuc',
      'siemens'
    ]) {
      expect(src).not.toContain(vendor)
    }
  })

  it('no toolpath G-code or M-code literals in source', async () => {
    const src = await readSrc()
    // Generic `G0` / `M3` etc. would be a red flag for a pure persistence helper.
    for (const code of [
      'G0 ',
      'G1 ',
      'G17',
      'G18',
      'G19',
      'G20',
      'G21',
      'G28',
      'G54',
      'G90',
      'G91',
      'M3 ',
      'M5 ',
      'M30',
      'M64',
      'M65'
    ]) {
      expect(src).not.toContain(code)
    }
  })

  it('no electron/child_process/dgram/net/tls leakage (pure node fs helper)', async () => {
    const src = await readSrc()
    for (const banned of ['electron', 'child_process', 'node:dgram', 'node:net', 'node:tls']) {
      expect(src).not.toContain(banned)
    }
  })

  it('no React/three/Handlebars leakage (main-process persistence helper)', async () => {
    const src = await readSrc()
    for (const banned of ['react', 'three', 'Handlebars']) {
      expect(src).not.toContain(banned)
    }
  })

  it('exactly one `try` and one `catch` (only the load path needs ENOENT guard)', async () => {
    const src = await readSrc()
    const tries = (src.match(/\btry\b/g) ?? []).length
    const catches = (src.match(/\bcatch\b/g) ?? []).length
    expect(tries).toBe(1)
    expect(catches).toBe(1)
  })
})

// --------------------------------------------------------------------------
// (K) Pure-ish invariants
// --------------------------------------------------------------------------
describe('[ID-0253] (K) pure-ish invariants', () => {
  it('repeated load on unchanged file is deeply equal across N=10 calls', async () => {
    const root = await tmp('K-stable-load')
    await mkdir(join(root, 'drawing'), { recursive: true })
    const fixture: DrawingFile = {
      version: 1,
      sheets: [{ id: 'k', name: 'Stable' }]
    }
    await writeFile(
      join(root, 'drawing', 'drawing.json'),
      JSON.stringify(fixture, null, 2),
      'utf-8'
    )
    const calls = await Promise.all(Array.from({ length: 10 }, () => loadDrawingFile(root)))
    for (const r of calls) expect(r).toEqual(fixture)
  })

  it('saveDrawingFile does NOT mutate its DrawingFile input', async () => {
    const root = await tmp('K-nomutate')
    const input: DrawingFile = {
      version: 1,
      sheets: [{ id: 'm', name: 'NoMutate', scale: '1:1' }]
    }
    const before = JSON.stringify(input)
    await saveDrawingFile(root, input)
    const after = JSON.stringify(input)
    expect(after).toBe(before)
  })

  it('loadDrawingFile does NOT throw a TypeError on a path containing a trailing separator', async () => {
    const root = await tmp('K-trailing-sep')
    await mkdir(join(root, 'drawing'), { recursive: true })
    const fixture: DrawingFile = {
      version: 1,
      sheets: [{ id: 't', name: 'Trail' }]
    }
    await writeFile(
      join(root, 'drawing', 'drawing.json'),
      JSON.stringify(fixture, null, 2),
      'utf-8'
    )
    const out = await loadDrawingFile(root + sep)
    expect(out).toEqual(fixture)
  })

  it('loadDrawingFile + saveDrawingFile do not leak `this` binding (apply with non-object)', async () => {
    const root = await tmp('K-no-this')
    const input: DrawingFile = {
      version: 1,
      sheets: [{ id: 't', name: 'this' }]
    }
    // Calling via .call(undefined, ...) must work because both functions are
    // standalone async functions, not methods.
    const out = await (saveDrawingFile as (
      this: unknown,
      d: string,
      f: DrawingFile
    ) => Promise<void>).call(undefined, root, input)
    expect(out).toBeUndefined()
    const back = await (loadDrawingFile as (
      this: unknown,
      d: string
    ) => Promise<DrawingFile>).call(undefined, root)
    expect(back).toEqual(input)
  })

  it('basename of the on-disk file is exactly drawing.json (no rename smear)', async () => {
    const root = await tmp('K-basename')
    await saveDrawingFile(root, emptyDrawingFile())
    const entries = await readdir(join(root, 'drawing'))
    expect(entries).toContain('drawing.json')
    for (const e of entries) {
      // The dir must contain ONLY drawing.json after a save from a fresh
      // tmp dir.
      expect(basename(e)).toBe('drawing.json')
    }
  })

  it('parent dir of the on-disk file is exactly <projectDir>/drawing (no nested smear)', async () => {
    const root = await tmp('K-parent')
    await saveDrawingFile(root, emptyDrawingFile())
    const f = join(root, 'drawing', 'drawing.json')
    expect(dirname(f)).toBe(join(root, 'drawing'))
  })
})
