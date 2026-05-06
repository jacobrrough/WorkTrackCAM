/**
 * Co-located paired-pin contract for `src/main/posts-manager.ts`
 *
 * [ID-0255] Cycle 183 post-processing paired-pin -- pins the runtime contract
 * of the 99-line / 3231-byte SHARED main-process post-processor (.hbs template)
 * manager. Three exported async functions:
 *   - listAllPosts(): Promise<PostEntry[]>
 *       Enumerate user + bundled .hbs templates with user precedence on
 *       same-filename collisions; result sorted by filename.
 *   - saveUserPost(filename, content): Promise<PostEntry>
 *       Write a new user post; reject non-.hbs filenames; basename-strip
 *       traversal; mkdir-recursive userData/posts.
 *   - readPostContent(filename): Promise<string>
 *       User-first read with bundled fallback; basename-strip traversal.
 *
 * Production call-sites:
 *   - `src/main/ipc-fabrication.ts:9` -- `posts:list` / `posts:save` /
 *     `posts:read` IPC handlers consumed by the renderer Library +
 *     Settings drawers (the user surface for managing post-processors).
 *
 * Three target machines are gated by exactly four bundled posts:
 *   - `fdm_passthrough.hbs`  -> Creality K2 Plus       (FDM, Klipper/Moonraker)
 *   - `vcarve_mach3.hbs`     -> Laguna Swift 5x10      (RichAuto A-series)
 *   - `carvera_3axis.hbs`    -> Makera Carvera 3-axis  (Smoothieware)
 *   - `carvera_4axis.hbs`    -> Makera Carvera 4-axis  (Smoothieware + rotary)
 *
 * Existing coverage: `src/main/posts-manager.test.ts` (15 it() / 156 lines)
 * covers the behavioral happy paths via fully-mocked node:fs/promises +
 * node:fs + electron. This paired-pin extends to lock the contract using
 * REAL filesystem operations against mkdtempSync tmpdirs (per the established
 * `cam-pipeline-integration.test.ts` vi.hoisted(require) pattern), pins the
 * exact module shape + function arity + AsyncFunction nature, source-text
 * whitelist (no foreign vendors, no toolpath G/M-code emission, no `:any`,
 * no electron-store/electron-builder leakage), and cross-cuts the three
 * target machines via four-post round-trip realism.
 *
 * Pinned in this file:
 *   (A) Module shape -- exact 3-runtime-export inventory + Symbol.toStringTag.
 *   (B) Function signatures -- arity / .name / AsyncFunction nature.
 *   (C) listAllPosts -- directory state matrix (none/user/bundled/both).
 *   (D) listAllPosts -- filter (.hbs only), sort (alpha asc), preview filter.
 *   (E) saveUserPost -- happy path + extension gate + basename + mkdir.
 *   (F) saveUserPost -- preview-line filter (comments + empty + 3-line cap).
 *   (G) readPostContent -- user-first then bundled fallback + basename strip.
 *   (H) Three-machine fixture realism (K2 Plus / Laguna / Carvera-3 / -4).
 *   (I) Source-text whitelist (size, imports, no `any`, no foreign vendors).
 *   (J) Pure-ish invariants (idempotence, distinct array instances, no throw).
 *   (K) PostEntry shape (4-key contract: filename / path / source / preview).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// ---- Hoisted real-fs scratch dirs ---------------------------------------
// Per `cam-pipeline-integration.test.ts` precedent: vi.hoisted runs BEFORE
// vi.mock factories AND before module-level imports, so we use require()
// to allocate real tmp dirs whose paths can be closed-over by the
// vi.mock('electron', ...) and vi.mock('./paths', ...) factories below.
const { USER_DATA_ROOT, RESOURCES_ROOT } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted before imports
  const nodeFs = require('node:fs') as typeof import('node:fs')
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted before imports
  const nodePath = require('node:path') as typeof import('node:path')
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted before imports
  const nodeOs = require('node:os') as typeof import('node:os')
  return {
    USER_DATA_ROOT: nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'posts-mgr-pin-ud-')),
    RESOURCES_ROOT: nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'posts-mgr-pin-res-'))
  }
})

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue(USER_DATA_ROOT)
  }
}))

vi.mock('./paths', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./paths')>()
  return {
    ...actual,
    getResourcesRoot: vi.fn().mockReturnValue(RESOURCES_ROOT)
  }
})

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { readFile as realReadFile } from 'node:fs/promises'
import { join, sep } from 'node:path'

import * as moduleNs from './posts-manager'
import { listAllPosts, readPostContent, saveUserPost, type PostEntry } from './posts-manager'

const USER_POSTS = join(USER_DATA_ROOT, 'posts')
const BUNDLED_POSTS = join(RESOURCES_ROOT, 'posts')

// ---- Lifecycle ------------------------------------------------------------

beforeAll(() => {
  // Defensive: every scratch dir must live under tmpdir() to avoid stomping
  // any project source if the hoisted block is mis-evaluated.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require('node:os') as typeof import('node:os')
  expect(USER_DATA_ROOT.startsWith(os.tmpdir())).toBe(true)
  expect(RESOURCES_ROOT.startsWith(os.tmpdir())).toBe(true)
})

afterAll(() => {
  rmSync(USER_DATA_ROOT, { recursive: true, force: true })
  rmSync(RESOURCES_ROOT, { recursive: true, force: true })
})

beforeEach(() => {
  // Wipe both posts subdirs so each test sets its own state.
  rmSync(USER_POSTS, { recursive: true, force: true })
  rmSync(BUNDLED_POSTS, { recursive: true, force: true })
})

// ---- (A) Module shape -----------------------------------------------------

describe('[ID-0255] (A) module shape', () => {
  it('exports exactly three runtime symbols (sorted): listAllPosts, readPostContent, saveUserPost', () => {
    const keys = Object.keys(moduleNs).sort()
    expect(keys).toEqual(['listAllPosts', 'readPostContent', 'saveUserPost'])
  })

  it('namespace Symbol.toStringTag is "Module"', () => {
    expect(
      (moduleNs as unknown as { [Symbol.toStringTag]?: string })[Symbol.toStringTag]
    ).toBe('Module')
  })

  it('does not have a default export', () => {
    expect((moduleNs as unknown as { default?: unknown }).default).toBeUndefined()
  })

  it('runtime key count is exactly 3 (no leakage of getUserPostsDir / previewLines etc.)', () => {
    expect(Object.keys(moduleNs)).toHaveLength(3)
  })

  it('listAllPosts is a Function', () => {
    expect(typeof listAllPosts).toBe('function')
  })

  it('saveUserPost is a Function', () => {
    expect(typeof saveUserPost).toBe('function')
  })

  it('readPostContent is a Function', () => {
    expect(typeof readPostContent).toBe('function')
  })

  it('does not leak getUserPostsDir helper', () => {
    expect((moduleNs as Record<string, unknown>).getUserPostsDir).toBeUndefined()
  })

  it('does not leak getBundledPostsDir helper', () => {
    expect((moduleNs as Record<string, unknown>).getBundledPostsDir).toBeUndefined()
  })

  it('does not leak previewLines helper', () => {
    expect((moduleNs as Record<string, unknown>).previewLines).toBeUndefined()
  })
})

// ---- (B) Function signatures ----------------------------------------------

describe('[ID-0255] (B) function signatures', () => {
  it('listAllPosts.name is "listAllPosts"', () => {
    expect(listAllPosts.name).toBe('listAllPosts')
  })

  it('saveUserPost.name is "saveUserPost"', () => {
    expect(saveUserPost.name).toBe('saveUserPost')
  })

  it('readPostContent.name is "readPostContent"', () => {
    expect(readPostContent.name).toBe('readPostContent')
  })

  it('listAllPosts.length is 0 (no required parameters)', () => {
    expect(listAllPosts.length).toBe(0)
  })

  it('saveUserPost.length is 2 (filename, content)', () => {
    expect(saveUserPost.length).toBe(2)
  })

  it('readPostContent.length is 1 (filename)', () => {
    expect(readPostContent.length).toBe(1)
  })

  it('listAllPosts is AsyncFunction', () => {
    expect(listAllPosts.constructor.name).toBe('AsyncFunction')
  })

  it('saveUserPost is AsyncFunction', () => {
    expect(saveUserPost.constructor.name).toBe('AsyncFunction')
  })

  it('readPostContent is AsyncFunction', () => {
    expect(readPostContent.constructor.name).toBe('AsyncFunction')
  })
})

// ---- (C) listAllPosts -- directory state ---------------------------------

describe('[ID-0255] (C) listAllPosts -- directory state matrix', () => {
  it('returns empty array when neither user nor bundled posts dir exists', async () => {
    const r = await listAllPosts()
    expect(r).toEqual([])
  })

  it('returns Array always (even with both dirs absent)', async () => {
    const r = await listAllPosts()
    expect(Array.isArray(r)).toBe(true)
  })

  it('returns bundled-only entries when only bundled posts dir exists', async () => {
    mkdirSync(BUNDLED_POSTS, { recursive: true })
    writeFileSync(join(BUNDLED_POSTS, 'fdm_passthrough.hbs'), 'G21\nG90\nG28')
    const r = await listAllPosts()
    expect(r).toHaveLength(1)
    expect(r[0]!.filename).toBe('fdm_passthrough.hbs')
    expect(r[0]!.source).toBe('bundled')
    expect(r[0]!.path).toBe(join(BUNDLED_POSTS, 'fdm_passthrough.hbs'))
  })

  it('returns user-only entries when only user posts dir exists', async () => {
    mkdirSync(USER_POSTS, { recursive: true })
    writeFileSync(join(USER_POSTS, 'my-custom.hbs'), 'M3 S18000\nG21')
    const r = await listAllPosts()
    expect(r).toHaveLength(1)
    expect(r[0]!.source).toBe('user')
    expect(r[0]!.path).toBe(join(USER_POSTS, 'my-custom.hbs'))
  })

  it('user posts override bundled posts with same filename (single entry, source: user)', async () => {
    mkdirSync(USER_POSTS, { recursive: true })
    mkdirSync(BUNDLED_POSTS, { recursive: true })
    writeFileSync(join(USER_POSTS, 'fdm_passthrough.hbs'), 'user-version')
    writeFileSync(join(BUNDLED_POSTS, 'fdm_passthrough.hbs'), 'bundled-version')
    const r = await listAllPosts()
    expect(r).toHaveLength(1)
    expect(r[0]!.source).toBe('user')
    expect(r[0]!.path).toBe(join(USER_POSTS, 'fdm_passthrough.hbs'))
  })

  it('returns both when filenames are distinct (user wins for own name, bundled for own name)', async () => {
    mkdirSync(USER_POSTS, { recursive: true })
    mkdirSync(BUNDLED_POSTS, { recursive: true })
    writeFileSync(join(USER_POSTS, 'a-custom.hbs'), 'a')
    writeFileSync(join(BUNDLED_POSTS, 'b-bundled.hbs'), 'b')
    const r = await listAllPosts()
    expect(r.map((p) => p.filename)).toEqual(['a-custom.hbs', 'b-bundled.hbs'])
    expect(r.find((p) => p.filename === 'a-custom.hbs')!.source).toBe('user')
    expect(r.find((p) => p.filename === 'b-bundled.hbs')!.source).toBe('bundled')
  })

  it('does not throw when only user dir exists with no .hbs content', async () => {
    mkdirSync(USER_POSTS, { recursive: true })
    const r = await listAllPosts()
    expect(r).toEqual([])
  })

  it('does not throw when only bundled dir exists with no .hbs content', async () => {
    mkdirSync(BUNDLED_POSTS, { recursive: true })
    const r = await listAllPosts()
    expect(r).toEqual([])
  })
})

// ---- (D) listAllPosts -- filter, sort, preview --------------------------

describe('[ID-0255] (D) listAllPosts -- filter / sort / preview', () => {
  it('filters out non-.hbs files (.txt, .json, .gcode)', async () => {
    mkdirSync(BUNDLED_POSTS, { recursive: true })
    writeFileSync(join(BUNDLED_POSTS, 'a.hbs'), 'G21')
    writeFileSync(join(BUNDLED_POSTS, 'readme.txt'), 'not a template')
    writeFileSync(join(BUNDLED_POSTS, 'config.json'), '{}')
    writeFileSync(join(BUNDLED_POSTS, 'output.gcode'), 'G0 X0')
    const r = await listAllPosts()
    expect(r).toHaveLength(1)
    expect(r[0]!.filename).toBe('a.hbs')
  })

  it('result sorted by filename (case-sensitive ascending)', async () => {
    mkdirSync(BUNDLED_POSTS, { recursive: true })
    for (const f of ['z-tail.hbs', 'a-head.hbs', 'm-mid.hbs']) {
      writeFileSync(join(BUNDLED_POSTS, f), 'x')
    }
    const r = await listAllPosts()
    expect(r.map((p) => p.filename)).toEqual(['a-head.hbs', 'm-mid.hbs', 'z-tail.hbs'])
  })

  it('user-source entries sort interleaved with bundled in result', async () => {
    mkdirSync(USER_POSTS, { recursive: true })
    mkdirSync(BUNDLED_POSTS, { recursive: true })
    writeFileSync(join(USER_POSTS, 'm-user.hbs'), 'm')
    writeFileSync(join(BUNDLED_POSTS, 'a-bundled.hbs'), 'a')
    writeFileSync(join(BUNDLED_POSTS, 'z-bundled.hbs'), 'z')
    const r = await listAllPosts()
    expect(r.map((p) => p.filename)).toEqual(['a-bundled.hbs', 'm-user.hbs', 'z-bundled.hbs'])
  })

  it('preview is the first 3 non-empty non-comment lines joined by \\n', async () => {
    mkdirSync(BUNDLED_POSTS, { recursive: true })
    writeFileSync(join(BUNDLED_POSTS, 'p.hbs'), 'G28\nG21\nG90\nG17\nM3 S18000')
    const r = await listAllPosts()
    expect(r[0]!.preview).toBe('G28\nG21\nG90')
  })

  it('preview filters lines whose trimmed start matches "{{!--"', async () => {
    mkdirSync(BUNDLED_POSTS, { recursive: true })
    writeFileSync(join(BUNDLED_POSTS, 'p.hbs'), '{{!-- header --}}\nG21\nG90\nG28')
    const r = await listAllPosts()
    expect(r[0]!.preview).toBe('G21\nG90\nG28')
  })

  it('preview filters lines whose trimmed start matches "--}}"', async () => {
    mkdirSync(BUNDLED_POSTS, { recursive: true })
    writeFileSync(join(BUNDLED_POSTS, 'p.hbs'), '--}} stray\nG21\nG90\nG28')
    const r = await listAllPosts()
    expect(r[0]!.preview).toBe('G21\nG90\nG28')
  })

  it('preview filters empty / whitespace-only lines', async () => {
    mkdirSync(BUNDLED_POSTS, { recursive: true })
    writeFileSync(join(BUNDLED_POSTS, 'p.hbs'), '\n   \n\t\nG21\nG90')
    const r = await listAllPosts()
    expect(r[0]!.preview).toBe('G21\nG90')
  })

  it('preview is a 3-line slice (separated by exactly two newlines)', async () => {
    mkdirSync(BUNDLED_POSTS, { recursive: true })
    writeFileSync(join(BUNDLED_POSTS, 'p.hbs'), 'a\nb\nc\nd')
    const r = await listAllPosts()
    expect(r[0]!.preview).toBe('a\nb\nc')
    expect(r[0]!.preview.split('\n')).toHaveLength(3)
  })

  it('preview is empty string for 0-byte file (no readable lines)', async () => {
    mkdirSync(BUNDLED_POSTS, { recursive: true })
    writeFileSync(join(BUNDLED_POSTS, 'empty.hbs'), '')
    const r = await listAllPosts()
    expect(r[0]!.preview).toBe('')
  })

  it('preview empty string for content that is comments-only', async () => {
    mkdirSync(BUNDLED_POSTS, { recursive: true })
    writeFileSync(join(BUNDLED_POSTS, 'c.hbs'), '{{!-- one --}}\n--}}\n{{!-- two --}}')
    const r = await listAllPosts()
    expect(r[0]!.preview).toBe('')
  })
})

// ---- (E) saveUserPost -- happy path + gates ------------------------------

describe('[ID-0255] (E) saveUserPost -- happy path + extension gate', () => {
  it('returns PostEntry with source: "user"', async () => {
    const entry = await saveUserPost('grbl.hbs', 'G21\nG90\nG28')
    expect(entry.filename).toBe('grbl.hbs')
    expect(entry.source).toBe('user')
    expect(entry.path).toBe(join(USER_POSTS, 'grbl.hbs'))
  })

  it('writes utf-8 file content to disk at <userData>/posts/<filename>', async () => {
    await saveUserPost('grbl.hbs', 'G21\nG90')
    const onDisk = await realReadFile(join(USER_POSTS, 'grbl.hbs'), 'utf-8')
    expect(onDisk).toBe('G21\nG90')
  })

  it('throws for filename without .hbs extension (rejects ".txt")', async () => {
    await expect(saveUserPost('template.txt', 'x')).rejects.toThrow(/\.hbs/)
  })

  it('throws for filename with no extension', async () => {
    await expect(saveUserPost('template', 'x')).rejects.toThrow(/\.hbs/)
  })

  it('throws for filename ending in similar-but-different extension (.hb)', async () => {
    await expect(saveUserPost('template.hb', 'x')).rejects.toThrow(/\.hbs/)
  })

  it('strips path traversal via basename ("../../evil.hbs" -> "evil.hbs")', async () => {
    const entry = await saveUserPost('../../evil.hbs', 'x')
    expect(entry.filename).toBe('evil.hbs')
    expect(existsSync(join(USER_POSTS, 'evil.hbs'))).toBe(true)
    // No file should escape into USER_DATA_ROOT itself or above.
    expect(existsSync(join(USER_DATA_ROOT, 'evil.hbs'))).toBe(false)
  })

  it('strips traversal across multiple separators ("a/b/c/safe.hbs" -> "safe.hbs")', async () => {
    const entry = await saveUserPost(`a${sep}b${sep}c${sep}safe.hbs`, 'x')
    expect(entry.filename).toBe('safe.hbs')
  })

  it('creates user posts dir if absent (mkdir recursive)', async () => {
    rmSync(USER_POSTS, { recursive: true, force: true })
    await saveUserPost('new.hbs', 'x')
    expect(existsSync(USER_POSTS)).toBe(true)
  })

  it('idempotent on second call (no error if dir already exists)', async () => {
    await saveUserPost('a.hbs', 'a')
    await saveUserPost('b.hbs', 'b')
    expect(existsSync(join(USER_POSTS, 'a.hbs'))).toBe(true)
    expect(existsSync(join(USER_POSTS, 'b.hbs'))).toBe(true)
  })

  it('overwrites existing user file with same name', async () => {
    await saveUserPost('a.hbs', 'first')
    await saveUserPost('a.hbs', 'second')
    const onDisk = await realReadFile(join(USER_POSTS, 'a.hbs'), 'utf-8')
    expect(onDisk).toBe('second')
  })
})

// ---- (F) saveUserPost -- preview-line filter -----------------------------

describe('[ID-0255] (F) saveUserPost -- preview-line filter', () => {
  it('preview filters {{!-- comments from input', async () => {
    const entry = await saveUserPost('t.hbs', '{{!-- header --}}\nG21\nG90\nG28')
    expect(entry.preview).not.toContain('{{!--')
    expect(entry.preview).toContain('G21')
  })

  it('preview limited to 3 non-empty non-comment lines', async () => {
    const entry = await saveUserPost('t.hbs', 'a\nb\nc\nd\ne')
    expect(entry.preview.split('\n')).toHaveLength(3)
    expect(entry.preview).toBe('a\nb\nc')
  })

  it('preview is empty when content is only handlebars comments', async () => {
    const entry = await saveUserPost('t.hbs', '{{!-- one --}}\n--}}\n{{!-- two --}}')
    expect(entry.preview).toBe('')
  })

  it('preview is empty when content is whitespace only', async () => {
    const entry = await saveUserPost('t.hbs', '   \n\n\t')
    expect(entry.preview).toBe('')
  })

  it('preview skips empty lines but keeps non-empty lines after them', async () => {
    const entry = await saveUserPost('t.hbs', '\nG21\n\nG90\n\nG28')
    expect(entry.preview).toBe('G21\nG90\nG28')
  })
})

// ---- (G) readPostContent -- user-first fallback -------------------------

describe('[ID-0255] (G) readPostContent -- user-first then bundled fallback', () => {
  it('reads from user dir when file exists there', async () => {
    mkdirSync(USER_POSTS, { recursive: true })
    mkdirSync(BUNDLED_POSTS, { recursive: true })
    writeFileSync(join(USER_POSTS, 'foo.hbs'), 'user-content')
    writeFileSync(join(BUNDLED_POSTS, 'foo.hbs'), 'bundled-content')
    const r = await readPostContent('foo.hbs')
    expect(r).toBe('user-content')
  })

  it('falls back to bundled when not in user dir', async () => {
    mkdirSync(BUNDLED_POSTS, { recursive: true })
    writeFileSync(join(BUNDLED_POSTS, 'foo.hbs'), 'bundled-content')
    const r = await readPostContent('foo.hbs')
    expect(r).toBe('bundled-content')
  })

  it('strips path traversal via basename', async () => {
    mkdirSync(BUNDLED_POSTS, { recursive: true })
    writeFileSync(join(BUNDLED_POSTS, 'safe.hbs'), 'safe-content')
    const r = await readPostContent('../../safe.hbs')
    expect(r).toBe('safe-content')
  })

  it('returns string (not Buffer)', async () => {
    mkdirSync(BUNDLED_POSTS, { recursive: true })
    writeFileSync(join(BUNDLED_POSTS, 'f.hbs'), 'content')
    const r = await readPostContent('f.hbs')
    expect(typeof r).toBe('string')
  })

  it('rejects when neither dir contains the file', async () => {
    await expect(readPostContent('missing.hbs')).rejects.toThrow()
  })

  it('returns content with utf-8 encoding (multi-byte char preserved)', async () => {
    mkdirSync(BUNDLED_POSTS, { recursive: true })
    writeFileSync(join(BUNDLED_POSTS, 'utf.hbs'), '; rotación A\nG21')
    const r = await readPostContent('utf.hbs')
    expect(r).toBe('; rotación A\nG21')
  })
})

// ---- (H) Three-machine fixture realism ----------------------------------

describe('[ID-0255] (H) three-machine fixture realism', () => {
  it('K2 Plus: fdm_passthrough.hbs accepts FDM-style header + round-trips', async () => {
    const fdm = 'M104 S220 ; nozzle\nM140 S60 ; bed\nG28\nG21\nG90\n; layer 1\n'
    await saveUserPost('fdm_passthrough.hbs', fdm)
    const back = await readPostContent('fdm_passthrough.hbs')
    expect(back).toBe(fdm)
  })

  it('Laguna Swift 5x10: vcarve_mach3.hbs accepts RichAuto-A G-code + round-trips', async () => {
    const mach3 = 'G21\nG90\nG17\nM3 S18000\n; full-sheet plywood 1219x2438\nG0 Z25\nM5\nM30\n'
    await saveUserPost('vcarve_mach3.hbs', mach3)
    const back = await readPostContent('vcarve_mach3.hbs')
    expect(back).toBe(mach3)
  })

  it('Carvera 3-axis: carvera_3axis.hbs accepts ATC + Smoothieware seq + round-trips', async () => {
    const car3 = 'G21\nG90\nG17\nM6 T1 ; ATC\nM3 S15000\nG0 X0 Y0 Z5\nM5\nM30\n'
    await saveUserPost('carvera_3axis.hbs', car3)
    const back = await readPostContent('carvera_3axis.hbs')
    expect(back).toBe(car3)
  })

  it('Carvera 4-axis: carvera_4axis.hbs accepts A-axis word + headstock-origin + round-trips', async () => {
    const car4 =
      'G21\nG90\nG17\nM6 T1\nM3 S15000\nG0 X0 Y0 A0 ; rotary origin at headstock\nA90\nM5\nM30\n'
    await saveUserPost('carvera_4axis.hbs', car4)
    const back = await readPostContent('carvera_4axis.hbs')
    expect(back).toBe(car4)
  })

  it('all four bundled-post filenames coexist in listAllPosts (sorted)', async () => {
    mkdirSync(BUNDLED_POSTS, { recursive: true })
    for (const f of [
      'fdm_passthrough.hbs',
      'vcarve_mach3.hbs',
      'carvera_3axis.hbs',
      'carvera_4axis.hbs'
    ]) {
      writeFileSync(join(BUNDLED_POSTS, f), 'x')
    }
    const r = await listAllPosts()
    expect(r.map((p) => p.filename)).toEqual([
      'carvera_3axis.hbs',
      'carvera_4axis.hbs',
      'fdm_passthrough.hbs',
      'vcarve_mach3.hbs'
    ])
    for (const e of r) expect(e.source).toBe('bundled')
  })

  it('user override applies per-machine slot independently (K2 user, Laguna bundled)', async () => {
    mkdirSync(USER_POSTS, { recursive: true })
    mkdirSync(BUNDLED_POSTS, { recursive: true })
    // K2 user override
    writeFileSync(join(USER_POSTS, 'fdm_passthrough.hbs'), 'user-fdm')
    writeFileSync(join(BUNDLED_POSTS, 'fdm_passthrough.hbs'), 'bundled-fdm')
    // Laguna bundled-only
    writeFileSync(join(BUNDLED_POSTS, 'vcarve_mach3.hbs'), 'bundled-laguna')
    const r = await listAllPosts()
    const k2 = r.find((p) => p.filename === 'fdm_passthrough.hbs')!
    const laguna = r.find((p) => p.filename === 'vcarve_mach3.hbs')!
    expect(k2.source).toBe('user')
    expect(laguna.source).toBe('bundled')
  })

  it('all three target machines coexist in a single listAllPosts call (no cross-machine bleed)', async () => {
    mkdirSync(BUNDLED_POSTS, { recursive: true })
    writeFileSync(join(BUNDLED_POSTS, 'fdm_passthrough.hbs'), 'k2')
    writeFileSync(join(BUNDLED_POSTS, 'vcarve_mach3.hbs'), 'laguna')
    writeFileSync(join(BUNDLED_POSTS, 'carvera_4axis.hbs'), 'carvera')
    const r = await listAllPosts()
    const filenames = r.map((p) => p.filename)
    expect(filenames).toContain('fdm_passthrough.hbs')
    expect(filenames).toContain('vcarve_mach3.hbs')
    expect(filenames).toContain('carvera_4axis.hbs')
    expect(filenames).toHaveLength(3)
  })
})

// ---- (I) Source-text whitelist -------------------------------------------

describe('[ID-0255] (I) source-text whitelist', () => {
  let src = ''
  beforeAll(async () => {
    src = await realReadFile('src/main/posts-manager.ts', 'utf-8')
  })

  it('source size <= 5000 bytes (small, focused helper)', () => {
    expect(Buffer.byteLength(src, 'utf-8')).toBeLessThanOrEqual(5000)
  })

  it('source size is non-empty (>= 500 bytes)', () => {
    expect(Buffer.byteLength(src, 'utf-8')).toBeGreaterThanOrEqual(500)
  })

  it('source line count <= 120', () => {
    expect(src.split('\n').length).toBeLessThanOrEqual(120)
  })

  it('exports listAllPosts via "export async function" form', () => {
    expect(src).toMatch(/export\s+async\s+function\s+listAllPosts/)
  })

  it('exports saveUserPost via "export async function" form', () => {
    expect(src).toMatch(/export\s+async\s+function\s+saveUserPost/)
  })

  it('exports readPostContent via "export async function" form', () => {
    expect(src).toMatch(/export\s+async\s+function\s+readPostContent/)
  })

  it('exports PostEntry type', () => {
    expect(src).toMatch(/export\s+type\s+PostEntry/)
  })

  it('imports app from electron', () => {
    expect(src).toMatch(/from\s+'electron'/)
  })

  it('imports from node:fs/promises (not bare fs/promises)', () => {
    expect(src).toMatch(/from\s+'node:fs\/promises'/)
  })

  it('imports existsSync from node:fs', () => {
    expect(src).toMatch(/existsSync.*from\s+'node:fs'/)
  })

  it('imports getResourcesRoot from ./paths', () => {
    expect(src).toMatch(/getResourcesRoot.*from\s+'\.\/paths'/)
  })

  it('uses ".hbs" extension literal (lowercase)', () => {
    expect(src).toContain('.hbs')
  })

  it("uses 'bundled' source literal", () => {
    expect(src).toMatch(/source:\s*'bundled'/)
  })

  it("uses 'user' source literal", () => {
    expect(src).toMatch(/source:\s*'user'/)
  })

  it('contains no `: any` type annotation in production source', () => {
    expect(src).not.toMatch(/:\s*any\b/)
  })

  it('contains no `as any` cast in production source', () => {
    expect(src).not.toMatch(/\bas\s+any\b/)
  })

  it('contains no React imports (this is main-process only)', () => {
    expect(src).not.toMatch(/from\s+'react'/)
  })

  it('contains no three.js imports (this is main-process only)', () => {
    expect(src).not.toMatch(/from\s+'three'/)
  })

  it('does not import electron-store / electron-builder', () => {
    expect(src).not.toMatch(/electron-store/)
    expect(src).not.toMatch(/electron-builder/)
  })

  it('does not emit toolpath G-code literals (G28/G91/M3/M104/M140 etc.)', () => {
    // The helper is a file-system manager, NOT a post-processor — it must not
    // contain G/M-code emission strings. This guards against accidental
    // post-processor logic creep into the manager.
    expect(src).not.toMatch(/['"]G28\b/)
    expect(src).not.toMatch(/['"]G91\b/)
    expect(src).not.toMatch(/['"]M104\b/)
    expect(src).not.toMatch(/['"]M140\b/)
    expect(src).not.toMatch(/['"]M3\s+S/)
  })

  it('does not name foreign machine vendors (My-Shop-Only Mode)', () => {
    for (const vendor of ['Haas', 'Mazak', 'Tormach', 'Okuma', 'DMG-Mori', 'DMG Mori']) {
      expect(src).not.toContain(vendor)
    }
  })

  it('uses basename() for path-traversal safety', () => {
    expect(src).toMatch(/\bbasename\(/)
  })

  it('mkdir uses recursive: true', () => {
    expect(src).toMatch(/recursive:\s*true/)
  })

  it('readFile uses utf-8 encoding', () => {
    expect(src).toMatch(/readFile\([^)]+,\s*'utf-8'/)
  })

  it('writeFile uses utf-8 encoding', () => {
    expect(src).toMatch(/writeFile\([^)]+,\s*[^,]+,\s*'utf-8'/)
  })

  it('uses extname for extension check (not endsWith for .hbs in listAllPosts filter)', () => {
    expect(src).toMatch(/extname\(/)
  })

  it('uses endsWith(".hbs") for the saveUserPost extension gate', () => {
    expect(src).toMatch(/endsWith\(['"]\.hbs['"]/)
  })
})

// ---- (J) Pure-ish invariants ---------------------------------------------

describe('[ID-0255] (J) pure-ish invariants', () => {
  it('listAllPosts is idempotent under fixed inputs (3 calls -> equal arrays)', async () => {
    mkdirSync(BUNDLED_POSTS, { recursive: true })
    writeFileSync(join(BUNDLED_POSTS, 'a.hbs'), 'x')
    writeFileSync(join(BUNDLED_POSTS, 'b.hbs'), 'y')
    const a = await listAllPosts()
    const b = await listAllPosts()
    const c = await listAllPosts()
    expect(a).toEqual(b)
    expect(b).toEqual(c)
  })

  it('listAllPosts returns distinct array instances per call (no shared mutable state)', async () => {
    mkdirSync(BUNDLED_POSTS, { recursive: true })
    writeFileSync(join(BUNDLED_POSTS, 'a.hbs'), 'x')
    const a = await listAllPosts()
    const b = await listAllPosts()
    expect(a).not.toBe(b)
  })

  it('listAllPosts always returns Array, never null/undefined', async () => {
    const r = await listAllPosts()
    expect(Array.isArray(r)).toBe(true)
    expect(r).not.toBeNull()
    expect(r).not.toBeUndefined()
  })

  it('listAllPosts never throws across the 4-cell directory presence matrix', async () => {
    // (none, none)
    await expect(listAllPosts()).resolves.toBeInstanceOf(Array)
    // (user, none)
    mkdirSync(USER_POSTS, { recursive: true })
    await expect(listAllPosts()).resolves.toBeInstanceOf(Array)
    rmSync(USER_POSTS, { recursive: true, force: true })
    // (none, bundled)
    mkdirSync(BUNDLED_POSTS, { recursive: true })
    await expect(listAllPosts()).resolves.toBeInstanceOf(Array)
    // (user, bundled)
    mkdirSync(USER_POSTS, { recursive: true })
    await expect(listAllPosts()).resolves.toBeInstanceOf(Array)
  })

  it('saveUserPost preview matches subsequent listAllPosts preview for the same file', async () => {
    const entry = await saveUserPost('p.hbs', 'G21\nG90\nG28\nG17')
    const r = await listAllPosts()
    const found = r.find((e) => e.filename === 'p.hbs')!
    expect(found.preview).toBe(entry.preview)
  })

  it('saveUserPost result -> readPostContent round-trips exact utf-8 content', async () => {
    const content = 'G21\nG90\n; comment with rotación A\nG28\nM30\n'
    await saveUserPost('rt.hbs', content)
    const r = await readPostContent('rt.hbs')
    expect(r).toBe(content)
  })
})

// ---- (K) PostEntry shape -------------------------------------------------

describe('[ID-0255] (K) PostEntry shape (4-key contract)', () => {
  it('PostEntry has filename: string', async () => {
    mkdirSync(BUNDLED_POSTS, { recursive: true })
    writeFileSync(join(BUNDLED_POSTS, 'a.hbs'), 'x')
    const r = await listAllPosts()
    expect(typeof r[0]!.filename).toBe('string')
    expect(r[0]!.filename.length).toBeGreaterThan(0)
  })

  it('PostEntry has path: string (non-empty)', async () => {
    mkdirSync(BUNDLED_POSTS, { recursive: true })
    writeFileSync(join(BUNDLED_POSTS, 'a.hbs'), 'x')
    const r = await listAllPosts()
    expect(typeof r[0]!.path).toBe('string')
    expect(r[0]!.path.length).toBeGreaterThan(0)
  })

  it('PostEntry.path ends with the .filename', async () => {
    mkdirSync(BUNDLED_POSTS, { recursive: true })
    writeFileSync(join(BUNDLED_POSTS, 'fdm_passthrough.hbs'), 'x')
    const r = await listAllPosts()
    expect(r[0]!.path.endsWith(r[0]!.filename)).toBe(true)
  })

  it("PostEntry.source is one of 'bundled' | 'user'", async () => {
    mkdirSync(BUNDLED_POSTS, { recursive: true })
    writeFileSync(join(BUNDLED_POSTS, 'a.hbs'), 'x')
    const r = await listAllPosts()
    expect(['bundled', 'user']).toContain(r[0]!.source)
  })

  it('PostEntry has preview: string (always set, may be empty)', async () => {
    mkdirSync(BUNDLED_POSTS, { recursive: true })
    writeFileSync(join(BUNDLED_POSTS, 'a.hbs'), '')
    const r = await listAllPosts()
    expect(typeof r[0]!.preview).toBe('string')
  })

  it('PostEntry has exactly 4 keys (filename, path, source, preview) -- no extras', async () => {
    mkdirSync(BUNDLED_POSTS, { recursive: true })
    writeFileSync(join(BUNDLED_POSTS, 'a.hbs'), 'x')
    const r = await listAllPosts()
    expect(Object.keys(r[0]!).sort()).toEqual(['filename', 'path', 'preview', 'source'])
  })

  it('PostEntry shape is type-asserted (TypeScript compile + runtime equivalence)', async () => {
    mkdirSync(BUNDLED_POSTS, { recursive: true })
    writeFileSync(join(BUNDLED_POSTS, 'a.hbs'), 'x')
    const r = await listAllPosts()
    // Type assertion at compile time + runtime cross-check.
    const e: PostEntry = r[0]!
    expect(e).toBe(r[0]!)
  })
})
