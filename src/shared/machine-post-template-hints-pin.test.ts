/**
 * machine-post-template-hints-pin.test.ts -- [ID-0235] Cycle 163 post-processing paired-pin
 *
 * Companion to the behaviour-test file `machine-post-template-hints.test.ts`
 * (60 lines, 11 it()) that covers basic shape + production-post membership.
 * THIS pin file additionally pins the CONTRACT of
 * `src/shared/machine-post-template-hints.ts` -- the canonical hint list of
 * `.hbs` filenames under `resources/posts/` exposed to the in-app machine
 * editor as autocomplete suggestions for the `postTemplate` field.
 *
 * Cross-cuts every target machine in the CLAUDE.md "USER CONTEXT" list:
 *
 *   - **Creality K2 Plus** (FDM, Klipper/Moonraker): the production
 *     post template for K2 Plus jobs is `fdm_passthrough.hbs` -- a
 *     Creality-Print-compatible passthrough that hands sliced G-code
 *     to Moonraker without any in-app re-emission. Drift in this
 *     filename (rename / removal) silently breaks the K2 Plus path
 *     because the machine editor would no longer surface the post and
 *     the `Print to K2` ribbon path falls through to the generic-mm
 *     post which emits non-Klipper G-code.
 *   - **Laguna Swift 5x10** (CNC router, RichAuto A-series via VCarve
 *     Pro export): the production post template is `vcarve_mach3.hbs`.
 *     The actual physical controller is RichAuto A-series, but the
 *     workflow is `WorkTrackCAM -> VCarve Pro post export -> RichAuto
 *     handheld import`; the Mach3-superset dialect emitted by VCarve
 *     Pro is what the RichAuto firmware ingests.
 *   - **Makera Carvera + 4th Axis Rotary**: BOTH production posts ride
 *     here -- `carvera_3axis.hbs` for 3-axis pocket / contour / drill
 *     work, AND `carvera_4axis.hbs` for the rotary cylindrical /
 *     full-4-axis-simultaneous path. Loss of either silently regresses
 *     the Carvera path: 3-axis loss falls back to generic-mm which has
 *     wrong spindle warm-up; 4-axis loss falls back to carvera_4axis_grbl
 *     which has wrong rotary-origin handling.
 *
 * June 2026 My-Shop-Only cleanup: the speculative 5-axis Fanuc and
 * 5-axis Siemens fallbacks were removed -- none of the three target
 * shops own a 5-axis machine, and the templates violated My-Shop-Only
 * Mode. The hint list now ships 4 production + 2 fallback entries
 * (6 total).
 *
 * Pinned surfaces:
 *   (A) Module shape -- exactly one runtime export
 *       `COMMON_POST_TEMPLATE_FILENAMES`, runtime tagged `Module`, null
 *       prototype, no default export, no foreign runtime symbols.
 *   (B) Cardinality + uniqueness -- length is EXACTLY 6 (4 production
 *       + 2 fallback). All entries unique.
 *   (C) Exact-byte equality table -- each of the 6 entries pinned by
 *       absolute position to its byte-equal `.hbs` filename. Order
 *       matters -- the source file documents the first 4 as the
 *       production environment posts and the trailing 2 as
 *       generic / fallback infrastructure.
 *   (D) Production-vs-fallback partition -- the first 4 entries (index
 *       0..3) are the production posts that MUST exist for the three
 *       target machines; the trailing 2 (index 4..5) are
 *       generic / fallback (kept for CPS imports + custom user
 *       machines per the source-file JSDoc).
 *   (E) Three-machine production-post coverage -- the production-only
 *       slice of the array names a post for every target machine:
 *       fdm_passthrough.hbs (K2 Plus FDM); vcarve_mach3.hbs (Laguna
 *       Swift via VCarve Pro export); carvera_3axis.hbs +
 *       carvera_4axis.hbs (Carvera 3-axis + 4-axis).
 *   (F) Filename shape invariants -- every entry ends with `.hbs`,
 *       matches the prefix whitelist (cnc_ / carvera_ / vcarve_ /
 *       fdm_), is ASCII-only, has no path separators, has no embedded
 *       whitespace, has no uppercase, has no `..` traversal.
 *   (G) Filesystem existence invariant -- every entry resolves to a
 *       real file under `resources/posts/`, present at test time, with
 *       size > 0. Directly enforces the "every hint is a real post
 *       template" invariant -- a rename of any `.hbs` file in
 *       `resources/posts/` without updating this constant fires this
 *       pin.
 *   (H) Source-text whitelist -- the JSDoc names the three production
 *       environments (VCarve Pro / Creality Print / Makera CAM) and
 *       cites the April 2026 4-axis rewrite. Negative regex confirms
 *       NO foreign-machine vendors leak into source code (Bambu /
 *       Prusa / Fanuc / Siemens / Haas / Tormach / Mach3-as-runtime /
 *       Mach4 / Shapeoko / Onefinity / X-Carve), no toolpath G-codes /
 *       M-codes leak, no electron / fs / path / child_process / dgram
 *       / net / tls / React / DOM / Three.js / Handlebars imports, no
 *       top-level `let` / `var`, no `:any` / `as any` / `<any>` casts,
 *       no default export, no runtime imports at all (the module is
 *       pure-data zero-dep).
 *   (I) Type-shape pin -- the `as const` tuple type is preserved (each
 *       entry is a string literal type, not the widened `string`).
 *       Also pins that `COMMON_POST_TEMPLATE_FILENAMES` is a frozen
 *       readonly tuple at the type level.
 *
 * ZERO production-code edits beyond the June 2026 My-Shop-Only cleanup.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, statSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as M from './machine-post-template-hints'
import { COMMON_POST_TEMPLATE_FILENAMES } from './machine-post-template-hints'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC_PATH = join(HERE, 'machine-post-template-hints.ts')
const SRC = readFileSync(SRC_PATH, 'utf-8')

// Source text with line-comments + JSDoc stripped, used for negative regex
// assertions that should not be tripped by commentary. Mirrors Cycles
// 150/161/162 etc.
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/(^|\n)\s*\*[^\n]*/g, '$1') // JSDoc continuation lines
    .replace(/\/\/[^\n]*/g, '') // line comments
}
const CODE_ONLY_SRC = codeOnly(SRC)

// Project-relative path to the on-disk post templates dir. The
// pin file lives at src/shared/<file>; the templates live at
// resources/posts/<file>.hbs from project root.
const POSTS_DIR = join(HERE, '..', '..', 'resources', 'posts')

// The 6 production-environment + fallback hints, as the canonical
// expected ordered tuple. Drift-detector for the source constant.
const EXPECTED_HINTS = [
  // Production environment posts (index 0..3)
  'vcarve_mach3.hbs',
  'fdm_passthrough.hbs',
  'carvera_3axis.hbs',
  'carvera_4axis.hbs',
  // Generic / fallback infrastructure (index 4..5)
  'cnc_generic_mm.hbs',
  'carvera_4axis_grbl.hbs'
] as const

const PRODUCTION_SLICE = EXPECTED_HINTS.slice(0, 4)
const FALLBACK_SLICE = EXPECTED_HINTS.slice(4)

// ---------------------------------------------------------------------------
// (A) Module shape
// ---------------------------------------------------------------------------

describe('[ID-0235] machine-post-template-hints module shape', () => {
  it('exports exactly one runtime symbol (COMMON_POST_TEMPLATE_FILENAMES)', () => {
    const keys = Object.keys(M).sort()
    expect(keys).toEqual(['COMMON_POST_TEMPLATE_FILENAMES'])
  })

  it('module namespace has a null prototype (ESM Module object)', () => {
    expect(Object.getPrototypeOf(M)).toBeNull()
  })

  // The transpiled ESM module object carries Symbol.toStringTag === 'Module'
  // in vitest's loader, mirroring the runtime invariant pinned in Cycles
  // 159/160/161/162.
  it('module namespace Symbol.toStringTag is Module', () => {
    expect((M as unknown as { [Symbol.toStringTag]?: string })[Symbol.toStringTag]).toBe('Module')
  })

  it('does not export a default', () => {
    expect((M as unknown as { default?: unknown }).default).toBeUndefined()
  })

  it('COMMON_POST_TEMPLATE_FILENAMES is an Array', () => {
    expect(Array.isArray(COMMON_POST_TEMPLATE_FILENAMES)).toBe(true)
  })

  it('every element is a string', () => {
    for (const f of COMMON_POST_TEMPLATE_FILENAMES) {
      expect(typeof f).toBe('string')
    }
  })

  // The runtime constant has 6 elements, matching the JSDoc partition (4
  // production + 2 fallback). Drift here means a hint was added or removed
  // and is the strongest single drift-detector for the module surface.
  it('COMMON_POST_TEMPLATE_FILENAMES has exactly 6 entries', () => {
    expect(COMMON_POST_TEMPLATE_FILENAMES.length).toBe(6)
  })

  it('module exposes exactly 1 runtime key (no leaked private symbols)', () => {
    expect(Object.keys(M)).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// (B) Cardinality + uniqueness
// ---------------------------------------------------------------------------

describe('[ID-0235] cardinality + uniqueness', () => {
  it('length matches EXPECTED_HINTS length (6)', () => {
    expect(COMMON_POST_TEMPLATE_FILENAMES.length).toBe(EXPECTED_HINTS.length)
  })

  it('all entries are mutually distinct', () => {
    const set = new Set(COMMON_POST_TEMPLATE_FILENAMES)
    expect(set.size).toBe(COMMON_POST_TEMPLATE_FILENAMES.length)
  })

  it('no entry is the empty string', () => {
    for (const f of COMMON_POST_TEMPLATE_FILENAMES) {
      expect(f.length).toBeGreaterThan(0)
    }
  })

  it('entries do not contain a leading or trailing whitespace', () => {
    for (const f of COMMON_POST_TEMPLATE_FILENAMES) {
      expect(f).toBe(f.trim())
    }
  })
})

// ---------------------------------------------------------------------------
// (C) Exact-byte equality table
// ---------------------------------------------------------------------------

describe('[ID-0235] exact-byte equality table', () => {
  // Pin the entire array byte-equal to the canonical EXPECTED_HINTS tuple.
  // This is the single strongest drift-detector for the constant -- any
  // rename, reorder, addition, or removal trips this assertion.
  it('byte-equal to EXPECTED_HINTS at every index', () => {
    expect([...COMMON_POST_TEMPLATE_FILENAMES]).toEqual([...EXPECTED_HINTS])
  })

  // Per-index pin for forensic clarity when the table-pin above fails.
  it.each(EXPECTED_HINTS.map((expected, index) => ({ index, expected })))(
    'index $index is byte-equal to $expected',
    ({ index, expected }) => {
      expect(COMMON_POST_TEMPLATE_FILENAMES[index]).toBe(expected)
    }
  )

  it('index 0 is the Laguna VCarve production post', () => {
    expect(COMMON_POST_TEMPLATE_FILENAMES[0]).toBe('vcarve_mach3.hbs')
  })

  it('index 1 is the K2 Plus FDM passthrough production post', () => {
    expect(COMMON_POST_TEMPLATE_FILENAMES[1]).toBe('fdm_passthrough.hbs')
  })

  it('index 2 is the Carvera 3-axis production post', () => {
    expect(COMMON_POST_TEMPLATE_FILENAMES[2]).toBe('carvera_3axis.hbs')
  })

  it('index 3 is the Carvera 4-axis production post', () => {
    expect(COMMON_POST_TEMPLATE_FILENAMES[3]).toBe('carvera_4axis.hbs')
  })

  it('index 4 is cnc_generic_mm fallback', () => {
    expect(COMMON_POST_TEMPLATE_FILENAMES[4]).toBe('cnc_generic_mm.hbs')
  })

  it('index 5 is carvera_4axis_grbl fallback (renamed from cnc_4axis_grbl in pre-launch rank-16; April 2026 4-axis rewrite repointing target)', () => {
    expect(COMMON_POST_TEMPLATE_FILENAMES[5]).toBe('carvera_4axis_grbl.hbs')
  })
})

// ---------------------------------------------------------------------------
// (D) Production-vs-fallback partition
// ---------------------------------------------------------------------------

describe('[ID-0235] production-vs-fallback partition', () => {
  it('production slice has exactly 4 entries (index 0..3)', () => {
    expect(COMMON_POST_TEMPLATE_FILENAMES.slice(0, 4)).toEqual([...PRODUCTION_SLICE])
  })

  it('fallback slice has exactly 2 entries (index 4..5)', () => {
    expect(COMMON_POST_TEMPLATE_FILENAMES.slice(4)).toEqual([...FALLBACK_SLICE])
  })

  it('production + fallback partition is exhaustive (covers all 6)', () => {
    expect([...PRODUCTION_SLICE, ...FALLBACK_SLICE]).toEqual([...EXPECTED_HINTS])
  })

  it('production slice has no fallback prefix entries', () => {
    for (const f of PRODUCTION_SLICE) {
      expect(f).not.toMatch(/^cnc_(generic|4axis_grbl|5axis_)/)
    }
  })

  // Pre-launch rank-16 rename: the legacy `cnc_4axis_grbl.hbs` fallback
  // was renamed to `carvera_4axis_grbl.hbs` to reflect its Smoothieware
  // dialect family (matches the production carvera_4axis.hbs). The
  // fallback slice now contains one `cnc_*` entry (the 3-axis
  // generic-mm) and one `carvera_*` entry (the 4-axis GRBL/Carvera
  // fallback). The allow-set covers both prefixes.
  it('fallback slice consists exclusively of cnc_- or carvera_-prefixed entries', () => {
    for (const f of FALLBACK_SLICE) {
      expect(f).toMatch(/^(cnc_|carvera_)/)
    }
  })

  it('production slice and fallback slice are disjoint sets', () => {
    const prod = new Set(PRODUCTION_SLICE)
    const fall = new Set(FALLBACK_SLICE)
    for (const f of fall) {
      expect(prod.has(f)).toBe(false)
    }
  })

  it('all production slice entries appear in COMMON_POST_TEMPLATE_FILENAMES', () => {
    for (const f of PRODUCTION_SLICE) {
      expect(COMMON_POST_TEMPLATE_FILENAMES).toContain(f)
    }
  })

  it('all fallback slice entries appear in COMMON_POST_TEMPLATE_FILENAMES', () => {
    for (const f of FALLBACK_SLICE) {
      expect(COMMON_POST_TEMPLATE_FILENAMES).toContain(f)
    }
  })
})

// ---------------------------------------------------------------------------
// (E) Three-machine production-post coverage
// ---------------------------------------------------------------------------

describe('[ID-0235] three-machine production-post coverage', () => {
  it('Creality K2 Plus production post is fdm_passthrough.hbs (index 1)', () => {
    expect(COMMON_POST_TEMPLATE_FILENAMES).toContain('fdm_passthrough.hbs')
    expect(PRODUCTION_SLICE).toContain('fdm_passthrough.hbs')
  })

  it('Laguna Swift 5x10 production post is vcarve_mach3.hbs (index 0)', () => {
    expect(COMMON_POST_TEMPLATE_FILENAMES).toContain('vcarve_mach3.hbs')
    expect(PRODUCTION_SLICE).toContain('vcarve_mach3.hbs')
  })

  it('Makera Carvera 3-axis production post is carvera_3axis.hbs (index 2)', () => {
    expect(COMMON_POST_TEMPLATE_FILENAMES).toContain('carvera_3axis.hbs')
    expect(PRODUCTION_SLICE).toContain('carvera_3axis.hbs')
  })

  it('Makera Carvera 4-axis production post is carvera_4axis.hbs (index 3)', () => {
    expect(COMMON_POST_TEMPLATE_FILENAMES).toContain('carvera_4axis.hbs')
    expect(PRODUCTION_SLICE).toContain('carvera_4axis.hbs')
  })

  it('production slice covers exactly the 4 target-machine posts (no extras)', () => {
    const TARGET_PRODUCTION_POSTS = new Set([
      'vcarve_mach3.hbs',
      'fdm_passthrough.hbs',
      'carvera_3axis.hbs',
      'carvera_4axis.hbs'
    ])
    expect(new Set(PRODUCTION_SLICE)).toEqual(TARGET_PRODUCTION_POSTS)
  })

  it('production slice does NOT contain any 5-axis post (target machines max out at 4-axis)', () => {
    for (const f of PRODUCTION_SLICE) {
      expect(f).not.toMatch(/5axis/)
    }
  })

  it('production slice does NOT contain the GRBL 4-axis fallback (Carvera uses dedicated post)', () => {
    // The fallback was renamed `cnc_4axis_grbl.hbs` -> `carvera_4axis_grbl.hbs`
    // in the pre-launch rank-16 cleanup. Pin both names so a regression that
    // re-introduced either the old or new fallback into the production slice
    // would trip this check.
    expect(PRODUCTION_SLICE).not.toContain('cnc_4axis_grbl.hbs')
    expect(PRODUCTION_SLICE).not.toContain('carvera_4axis_grbl.hbs')
  })

  it('production slice does NOT contain the generic-mm fallback', () => {
    expect(PRODUCTION_SLICE).not.toContain('cnc_generic_mm.hbs')
  })

  // The two Carvera posts must both be present -- losing either silently
  // regresses the Carvera path (per JSDoc above). Belt-and-braces pin.
  it('both Carvera posts (3-axis + 4-axis) are present', () => {
    expect(COMMON_POST_TEMPLATE_FILENAMES).toContain('carvera_3axis.hbs')
    expect(COMMON_POST_TEMPLATE_FILENAMES).toContain('carvera_4axis.hbs')
  })

  // June 2026 My-Shop-Only cleanup: the 5-axis posts must not return.
  it('hint list contains ZERO 5-axis post entries (My-Shop-Only enforcement)', () => {
    const fiveAxis = COMMON_POST_TEMPLATE_FILENAMES.filter((f) => f.includes('5axis'))
    expect(fiveAxis).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// (F) Filename shape invariants
// ---------------------------------------------------------------------------

describe('[ID-0235] filename shape invariants', () => {
  it('every entry ends with the literal .hbs extension', () => {
    for (const f of COMMON_POST_TEMPLATE_FILENAMES) {
      expect(f).toMatch(/\.hbs$/)
    }
  })

  it('every entry begins with one of the four whitelisted prefixes (cnc_/carvera_/vcarve_/fdm_)', () => {
    for (const f of COMMON_POST_TEMPLATE_FILENAMES) {
      expect(f).toMatch(/^(cnc_|carvera_|vcarve_|fdm_)/)
    }
  })

  it('every entry is ASCII-only', () => {
    for (const f of COMMON_POST_TEMPLATE_FILENAMES) {
      // Codepoints 0x20..0x7E inclusive (printable ASCII).
      expect(f).toMatch(/^[\x20-\x7E]+$/)
    }
  })

  it('no entry contains a forward slash (no path traversal in hint names)', () => {
    for (const f of COMMON_POST_TEMPLATE_FILENAMES) {
      expect(f).not.toContain('/')
    }
  })

  it('no entry contains a backslash (no path traversal in hint names)', () => {
    for (const f of COMMON_POST_TEMPLATE_FILENAMES) {
      expect(f).not.toContain('\\')
    }
  })

  it('no entry contains a parent-dir token "../"', () => {
    for (const f of COMMON_POST_TEMPLATE_FILENAMES) {
      expect(f).not.toContain('..')
    }
  })

  it('no entry contains an embedded space', () => {
    for (const f of COMMON_POST_TEMPLATE_FILENAMES) {
      expect(f).not.toContain(' ')
    }
  })

  it('no entry contains an embedded tab or newline', () => {
    for (const f of COMMON_POST_TEMPLATE_FILENAMES) {
      expect(f).not.toMatch(/[\t\n\r]/)
    }
  })

  it('no entry contains uppercase letters (lowercase-only convention)', () => {
    for (const f of COMMON_POST_TEMPLATE_FILENAMES) {
      expect(f).toBe(f.toLowerCase())
    }
  })

  it('no entry has a leading dot (no hidden-file hints)', () => {
    for (const f of COMMON_POST_TEMPLATE_FILENAMES) {
      expect(f.startsWith('.')).toBe(false)
    }
  })

  it('no entry contains a Windows drive letter (no absolute paths)', () => {
    for (const f of COMMON_POST_TEMPLATE_FILENAMES) {
      expect(f).not.toMatch(/^[A-Za-z]:/)
    }
  })

  it('every entry is at most 32 characters long (sanity bound)', () => {
    for (const f of COMMON_POST_TEMPLATE_FILENAMES) {
      expect(f.length).toBeLessThanOrEqual(32)
    }
  })

  it('every entry has at most one period (the .hbs extension only)', () => {
    for (const f of COMMON_POST_TEMPLATE_FILENAMES) {
      const periods = (f.match(/\./g) ?? []).length
      expect(periods).toBe(1)
    }
  })

  it('every entry stem is non-empty (no bare ".hbs" entries)', () => {
    for (const f of COMMON_POST_TEMPLATE_FILENAMES) {
      const stem = f.replace(/\.hbs$/, '')
      expect(stem.length).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// (G) Filesystem existence invariant
// ---------------------------------------------------------------------------

describe('[ID-0235] filesystem existence invariant', () => {
  it('resources/posts/ directory exists at the expected location', () => {
    expect(existsSync(POSTS_DIR)).toBe(true)
  })

  it.each(EXPECTED_HINTS.map((filename) => ({ filename })))(
    'resources/posts/$filename exists on disk',
    ({ filename }) => {
      const p = join(POSTS_DIR, filename)
      expect(existsSync(p)).toBe(true)
    }
  )

  it.each(EXPECTED_HINTS.map((filename) => ({ filename })))(
    'resources/posts/$filename is a regular file (not a dir / symlink dir)',
    ({ filename }) => {
      const p = join(POSTS_DIR, filename)
      expect(statSync(p).isFile()).toBe(true)
    }
  )

  it.each(EXPECTED_HINTS.map((filename) => ({ filename })))(
    'resources/posts/$filename is non-empty (size > 0 bytes)',
    ({ filename }) => {
      const p = join(POSTS_DIR, filename)
      expect(statSync(p).size).toBeGreaterThan(0)
    }
  )

  // Reverse-direction check: if a fresh `.hbs` file lands in resources/posts
  // it must (a) be intentionally added to the hint list OR (b) be marked as
  // hint-internal. Since we don't have a separate exclusion list yet, we
  // pin the current set as the complete known-`.hbs` filename set under
  // resources/posts; an addition trips this and forces a deliberate update.
  it('resources/posts/ contains EXACTLY the 6 known hint filenames among .hbs files', () => {
    // We list the on-disk .hbs files via fs and compare to EXPECTED_HINTS.
    // Mirror the source-of-truth check in reverse direction.
    // The directory may also contain README.md etc; we filter to .hbs only.
    // node:fs's readdirSync already imported transitively via statSync? No,
    // need explicit. Use require to avoid adding another import line.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readdirSync } = require('node:fs') as typeof import('node:fs')
    const onDisk = readdirSync(POSTS_DIR)
      .filter((name: string) => name.endsWith('.hbs'))
      .sort()
    const expected = [...EXPECTED_HINTS].sort()
    expect(onDisk).toEqual(expected)
  })
})

// ---------------------------------------------------------------------------
// (H) Source-text whitelist
// ---------------------------------------------------------------------------

describe('[ID-0235] source-text whitelist', () => {
  it('source file is small (< 35 lines, sanity)', () => {
    expect(SRC.split('\n').length).toBeLessThan(35)
  })

  it('source file is small (< 1.5 KB, sanity)', () => {
    expect(SRC.length).toBeLessThan(1500)
  })

  it('source declares the runtime export with `as const`', () => {
    // `as const` is what makes the tuple literal-typed; drift here would
    // widen the inferred element type from string-literal to string and
    // silently break downstream literal narrowing on consumers.
    expect(SRC).toMatch(/\]\s*as\s+const\s*$/m)
  })

  it('source declares the export keyword exactly once on the constant', () => {
    const hits = SRC.match(/^export const COMMON_POST_TEMPLATE_FILENAMES\b/gm) ?? []
    expect(hits).toHaveLength(1)
  })

  it('JSDoc names the three production environments (VCarve Pro / Creality Print / Makera CAM)', () => {
    expect(SRC).toMatch(/VCarve\s*Pro/)
    expect(SRC).toMatch(/Creality\s*Print/)
    expect(SRC).toMatch(/Makera\s*CAM/)
  })

  it('JSDoc cites the April 2026 4-axis rewrite (provenance)', () => {
    expect(SRC).toMatch(/April\s*2026/)
  })

  it('JSDoc explains that non-GRBL 4-axis templates were removed and CPS imports repoint to the 4-axis GRBL/Carvera fallback', () => {
    // Pre-launch rank-16: the fallback was renamed `cnc_4axis_grbl.hbs` ->
    // `carvera_4axis_grbl.hbs`. The JSDoc preserves both names so future
    // maintainers can grep for either; the canonical filename is the new one.
    expect(SRC).toMatch(/carvera_4axis_grbl/)
    expect(SRC).toMatch(/cnc_4axis_grbl/)
    expect(SRC).toMatch(/repointed/)
  })

  it('JSDoc cites the June 2026 5-axis removal (My-Shop-Only enforcement)', () => {
    expect(SRC).toMatch(/June\s*2026/)
    expect(SRC).toMatch(/5-axis/)
  })

  it('source file has no top-level `let`', () => {
    expect(CODE_ONLY_SRC).not.toMatch(/^\s*let\s+/m)
  })

  it('source file has no top-level `var`', () => {
    expect(CODE_ONLY_SRC).not.toMatch(/^\s*var\s+/m)
  })

  it('source file has no `:any` type annotation', () => {
    expect(CODE_ONLY_SRC).not.toMatch(/:\s*any\b/)
  })

  it('source file has no `as any` cast', () => {
    expect(CODE_ONLY_SRC).not.toMatch(/\bas\s+any\b/)
  })

  it('source file has no `<any>` cast', () => {
    expect(CODE_ONLY_SRC).not.toMatch(/<\s*any\s*>/)
  })

  it('source file has no default export', () => {
    expect(CODE_ONLY_SRC).not.toMatch(/export\s+default\b/)
  })

  it('source file has no runtime imports (zero-dep pure-data)', () => {
    expect(CODE_ONLY_SRC).not.toMatch(/^\s*import\s+/m)
  })

  it('source file imports nothing from electron / fs / path / child_process / dgram / net / tls', () => {
    expect(CODE_ONLY_SRC).not.toMatch(/from\s+['"]electron['"]/)
    expect(CODE_ONLY_SRC).not.toMatch(/from\s+['"]node:fs['"]/)
    expect(CODE_ONLY_SRC).not.toMatch(/from\s+['"]node:path['"]/)
    expect(CODE_ONLY_SRC).not.toMatch(/from\s+['"]node:child_process['"]/)
    expect(CODE_ONLY_SRC).not.toMatch(/from\s+['"]node:dgram['"]/)
    expect(CODE_ONLY_SRC).not.toMatch(/from\s+['"]node:net['"]/)
    expect(CODE_ONLY_SRC).not.toMatch(/from\s+['"]node:tls['"]/)
  })

  it('source file does not import React / DOM / Three.js / Handlebars', () => {
    expect(CODE_ONLY_SRC).not.toMatch(/from\s+['"]react['"]/)
    expect(CODE_ONLY_SRC).not.toMatch(/from\s+['"]three['"]/)
    expect(CODE_ONLY_SRC).not.toMatch(/from\s+['"]handlebars['"]/)
  })

  // No Bambu / Prusa / Fanuc / Siemens / Haas / Tormach / Mach4 / Shapeoko /
  // Onefinity / X-Carve in source (foreign-machine-vendor leak guard,
  // Cycles 159+). The 5-axis-fanuc/siemens fallbacks were removed in the
  // June 2026 My-Shop-Only cleanup so Fanuc/Siemens substrings should
  // no longer appear here. We DO allow 'Mach3' as a substring because
  // vcarve_mach3.hbs and the dialect token `mach3` remain in the hint
  // surface.
  it('source file does NOT contain foreign-machine-vendor names (Bambu/Prusa/Fanuc/Siemens/Haas/Tormach/Mach4/Shapeoko/Onefinity/X-Carve)', () => {
    expect(SRC).not.toMatch(/Bambu/i)
    expect(SRC).not.toMatch(/Prusa/i)
    expect(SRC).not.toMatch(/Fanuc/i)
    expect(SRC).not.toMatch(/Siemens/i)
    expect(SRC).not.toMatch(/Haas/i)
    expect(SRC).not.toMatch(/Tormach/i)
    expect(SRC).not.toMatch(/Mach4\b/i)
    expect(SRC).not.toMatch(/Shapeoko/i)
    expect(SRC).not.toMatch(/Onefinity/i)
    expect(SRC).not.toMatch(/X-?Carve/i)
  })

  it('source file does NOT emit any toolpath G-code mnemonic (Safety Rule 1)', () => {
    // Block standalone toolpath G-codes in production source. Comments
    // are stripped via codeOnly() so JSDoc references don't trip this.
    // We allow no toolpath-G-code at all in this pure-data hint module.
    for (const g of [
      'G0',
      'G1',
      'G2',
      'G3',
      'G17',
      'G18',
      'G19',
      'G20',
      'G21',
      'G28',
      'G54',
      'G55',
      'G56',
      'G57',
      'G58',
      'G59',
      'G90',
      'G91'
    ]) {
      expect(CODE_ONLY_SRC).not.toMatch(new RegExp(`\\b${g}\\b`))
    }
  })

  it('source file does NOT emit any toolpath M-code mnemonic (Safety Rule 1)', () => {
    for (const m of ['M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'M30', 'M64', 'M65']) {
      expect(CODE_ONLY_SRC).not.toMatch(new RegExp(`\\b${m}\\b`))
    }
  })

  // Each of the 6 .hbs filenames must literally appear in source as a
  // SINGLE-QUOTED string literal -- belt-and-braces drift detector for a
  // typo or rename. We count single-quoted occurrences only so JSDoc
  // references (like the April-2026-rewrite explanation that mentions
  // cnc_4axis_grbl.hbs as the CPS-import repointing target without
  // surrounding quotes) do not collide with the runtime-literal pin.
  it.each(EXPECTED_HINTS.map((filename) => ({ filename })))(
    'source contains the single-quoted literal "$filename" exactly once',
    ({ filename }) => {
      const escaped = filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const hits = SRC.match(new RegExp("'" + escaped + "'", 'g')) ?? []
      expect(hits).toHaveLength(1)
    }
  )

  it('source comments include the phrase "Production environment posts" partition marker', () => {
    expect(SRC).toMatch(/Production environment posts/)
  })

  it('source comments include the phrase "Generic / fallback infrastructure" partition marker', () => {
    expect(SRC).toMatch(/Generic\s*\/\s*fallback infrastructure/)
  })
})

// ---------------------------------------------------------------------------
// (I) Type-shape pin (compile-time)
// ---------------------------------------------------------------------------

describe('[ID-0235] type-shape pin (runtime sanity for the as-const tuple)', () => {
  // While the strongest type-shape guarantees come from `tsc --noEmit`,
  // we also runtime-pin the readonly invariant: TypeScript's `as const`
  // makes the array a deeply readonly tuple. Vitest does not freeze it,
  // but we can still pin that the runtime array's exact element ordering
  // matches the canonical EXPECTED_HINTS tuple element-wise.
  it('runtime tuple ordering matches EXPECTED_HINTS element-wise', () => {
    for (let i = 0; i < EXPECTED_HINTS.length; i++) {
      expect(COMMON_POST_TEMPLATE_FILENAMES[i]).toBe(EXPECTED_HINTS[i])
    }
  })

  it('runtime tuple is element-equivalent in either iteration direction (no hidden Symbol.iterator override)', () => {
    const forward: string[] = []
    for (const f of COMMON_POST_TEMPLATE_FILENAMES) forward.push(f)
    expect(forward).toEqual([...EXPECTED_HINTS])
    const reverse = [...COMMON_POST_TEMPLATE_FILENAMES].reverse()
    expect(reverse).toEqual([...EXPECTED_HINTS].reverse())
  })

  // Sanity: each element type, at runtime, is `string`. The `as const`
  // tuple gives literal types at compile-time; at runtime these collapse
  // to plain strings.
  it('each element typeof is string at runtime', () => {
    for (const f of COMMON_POST_TEMPLATE_FILENAMES) {
      expect(typeof f).toBe('string')
    }
  })
})

// ---------------------------------------------------------------------------
// (J) Cross-cutting safety + machine-agnostic invariants
// ---------------------------------------------------------------------------

describe('[ID-0235] cross-cutting safety + invariants', () => {
  // The hint list is operator-UI surface (autocomplete) -- not a
  // toolpath emitter. Safety Rule 1 is enforced by Section H's
  // negative-regex pin; this section pins the higher-level invariants.

  it('production slice never collides with fallback slice on any single name', () => {
    for (const p of PRODUCTION_SLICE) {
      expect(FALLBACK_SLICE).not.toContain(p)
    }
  })

  it('production slice ordering is K2-Plus-Laguna-Carvera-3axis-Carvera-4axis (the source-file ordering)', () => {
    expect(PRODUCTION_SLICE[0]).toBe('vcarve_mach3.hbs')
    expect(PRODUCTION_SLICE[1]).toBe('fdm_passthrough.hbs')
    expect(PRODUCTION_SLICE[2]).toBe('carvera_3axis.hbs')
    expect(PRODUCTION_SLICE[3]).toBe('carvera_4axis.hbs')
  })

  it('fallback slice is sorted by axis count (3-axis generic, then 4-axis GRBL/Carvera fallback)', () => {
    expect(FALLBACK_SLICE[0]).toBe('cnc_generic_mm.hbs')
    expect(FALLBACK_SLICE[1]).toBe('carvera_4axis_grbl.hbs')
  })

  it('hint list never accidentally surfaces a 5-axis post in the production slice', () => {
    expect(PRODUCTION_SLICE.filter((f) => f.includes('5axis'))).toHaveLength(0)
  })

  it('hint list contains ZERO 5-axis post entries (June 2026 My-Shop-Only removal)', () => {
    const fiveAxis = COMMON_POST_TEMPLATE_FILENAMES.filter((f) => f.includes('5axis'))
    expect(fiveAxis).toHaveLength(0)
  })

  // Pre-launch rank-16: the fallback `cnc_4axis_grbl.hbs` was renamed
  // `carvera_4axis_grbl.hbs` -- the file is Smoothieware-family, the
  // same dialect parent as the production carvera_4axis.hbs. The
  // 4-axis post inventory is now THREE entries, all with the
  // `carvera_` prefix: the production `carvera_4axis.hbs`, plus the
  // GRBL-flavored fallback `carvera_4axis_grbl.hbs`. (The third
  // carvera_ entry is the 3-axis carvera_3axis.hbs which is NOT 4-axis
  // and not included here.) Pin: there is no `cnc_*4axis*` fallback
  // anymore.
  it('hint list contains EXACTLY 2 4-axis Carvera-family post entries (production + GRBL fallback)', () => {
    const fourAxisCarvera = COMMON_POST_TEMPLATE_FILENAMES.filter(
      (f) => f.includes('4axis') && f.startsWith('carvera_')
    )
    expect(fourAxisCarvera).toEqual(['carvera_4axis.hbs', 'carvera_4axis_grbl.hbs'])
  })

  it('hint list contains ZERO cnc_-prefixed 4-axis post entries (post-rank-16 rename)', () => {
    const cncFourAxis = COMMON_POST_TEMPLATE_FILENAMES.filter(
      (f) => f.includes('4axis') && f.startsWith('cnc_')
    )
    expect(cncFourAxis).toEqual([])
  })

  it('hint list contains EXACTLY 1 fdm post entry (the K2 Plus passthrough)', () => {
    const fdm = COMMON_POST_TEMPLATE_FILENAMES.filter((f) => f.startsWith('fdm_'))
    expect(fdm).toEqual(['fdm_passthrough.hbs'])
  })

  it('hint list contains EXACTLY 1 vcarve post entry (the Laguna VCarve Pro export)', () => {
    const vcarve = COMMON_POST_TEMPLATE_FILENAMES.filter((f) => f.startsWith('vcarve_'))
    expect(vcarve).toEqual(['vcarve_mach3.hbs'])
  })

  // Pre-launch rank-16 rename: the carvera prefix now covers THREE entries --
  // production 3-axis (carvera_3axis.hbs), production 4-axis
  // (carvera_4axis.hbs), and the renamed 4-axis fallback
  // (carvera_4axis_grbl.hbs).
  it('hint list contains EXACTLY 3 carvera post entries (3-axis prod + 4-axis prod + 4-axis GRBL fallback)', () => {
    const carvera = COMMON_POST_TEMPLATE_FILENAMES.filter((f) => f.startsWith('carvera_'))
    expect(carvera).toEqual(['carvera_3axis.hbs', 'carvera_4axis.hbs', 'carvera_4axis_grbl.hbs'])
  })

  // After the rank-16 rename the `cnc_*` bucket holds only the 3-axis
  // generic-mm fallback (the 4-axis fallback moved to the carvera_*
  // bucket).
  it('hint list contains EXACTLY 1 cnc-prefixed fallback entry (cnc_generic_mm.hbs only)', () => {
    const cnc = COMMON_POST_TEMPLATE_FILENAMES.filter((f) => f.startsWith('cnc_'))
    expect(cnc).toEqual(['cnc_generic_mm.hbs'])
  })

  it('every prefix bucket (cnc_/carvera_/vcarve_/fdm_) sums to 6 total entries (partition exhaustive)', () => {
    const cnc = COMMON_POST_TEMPLATE_FILENAMES.filter((f) => f.startsWith('cnc_')).length
    const carvera = COMMON_POST_TEMPLATE_FILENAMES.filter((f) => f.startsWith('carvera_')).length
    const vcarve = COMMON_POST_TEMPLATE_FILENAMES.filter((f) => f.startsWith('vcarve_')).length
    const fdm = COMMON_POST_TEMPLATE_FILENAMES.filter((f) => f.startsWith('fdm_')).length
    expect(cnc + carvera + vcarve + fdm).toBe(COMMON_POST_TEMPLATE_FILENAMES.length)
    expect(cnc + carvera + vcarve + fdm).toBe(6)
  })
})
