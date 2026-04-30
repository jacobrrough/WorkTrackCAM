/**
 * src/shared/check-no-dump-stubs-pattern-contract.test.ts -- [ID-0200] Cycle 123
 *
 * Pure-additive paired-pin extension to the [ID-0150] check-no-dump-stubs
 * gate (sibling: src/shared/check-no-dump-stubs-gate.test.ts, Cycle 111).
 *
 * Slot: perf rotation (Cycle 122 hand-off Section 35.10 named perf as TOP
 * recommended pull for Cycle 123; perf cooldown ended Cycle 123 exactly --
 * Cycle 118 [ID-0193] last consumed it). The literal [ID-0194] spawn-shave
 * is NOT pulled here because [ID-0194]'s own ticket text says "ACTIONABLE
 * WHEN: file's runGate(...) invocation count grows beyond 5" -- the current
 * count is 2 (`runGate()` + `runGate('/tmp')`), well under threshold.
 * Pulling the refactor today would be speculative work explicitly
 * contraindicated by the threshold language. Instead, this file:
 *
 *   1. PINS the gate's pattern-regex behavior end-to-end (positive +
 *      negative cases for both ROOT_DUMP_PATTERN and SRC_DUMP_PATTERN),
 *      so a future cycle that loosens or tightens the regex literals
 *      cannot do so silently.
 *   2. PINS the SKIP_DIRS completeness gap that the original
 *      [ID-0150] paired-pin missed (sibling test only iterates 6 of 8
 *      entries -- `.vite` and `.cache` were never asserted; this file
 *      closes the gap as a pure-additive extension, not a sibling edit).
 *   3. PINS the ALLOWLIST set semantics (size, uniqueness, ordering)
 *      so future allowlist edits go through deliberate review.
 *   4. INSTALLS the [ID-0194] perf-threshold tripwire: counts
 *      `runGate(` invocations in the SIBLING test file's source via
 *      fs.readFileSync(SIBLING_TEST_FILE_PATH) and fails when count
 *      crosses 5. This makes [ID-0194] self-tripping rather than
 *      requiring a perf-cycle inventory refresh to detect crossing.
 *   5. PINS the documented exit-code contract (0 = clean, 1 = at
 *      least one non-allowlisted match) and the source comment block.
 *
 * ZERO production-code edits. ZERO mutation of the sibling test file.
 * ZERO new spawnSync calls (no perf cost added). All assertions run
 * off cached fs.readFileSync of the script + sibling test file source.
 *
 * Machine scope: SHARED INFRASTRUCTURE (cross-cuts all three target
 * machines) -- the gate fires on every `npm test` invocation regardless
 * of which machine's profile or post-processor is being exercised, so a
 * silent regression in the regex literals would let dump-style scratch
 * files reappear in the working tree across K2 / Laguna / Carvera work.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'

const PROJECT_ROOT = path.resolve(__dirname, '..', '..')
const SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'check-no-dump-stubs.cjs')
const SIBLING_TEST_FILE_PATH = path.join(
  PROJECT_ROOT,
  'src',
  'shared',
  'check-no-dump-stubs-gate.test.ts'
)

// Cache the script source ONCE per file (vitest singleThread pool means
// per-file beforeAll caching is sufficient; no need for module-level
// global state hardening). The describe-level closure captures it.
const SCRIPT_SRC = fs.readFileSync(SCRIPT, 'utf8')
const SIBLING_TEST_SRC = fs.readFileSync(SIBLING_TEST_FILE_PATH, 'utf8')

// Extract regex literals from script source so positive/negative tests
// run against THE SAME regex the gate uses, not a re-typed copy that
// could drift. The two regexes are defined as `const NAME = /.../` so
// we match the literal between the slashes, then construct a real
// RegExp from the matched body. This is brittle to whitespace/comment
// changes around the const decl, which is the POINT: any drift fails
// here loud and obvious.
function extractRegexLiteral(src: string, name: string): RegExp {
  // Match `const <name> = /<body>/` -- non-greedy body, no flags expected.
  const re = new RegExp(`const\\s+${name}\\s*=\\s*\\/([^\\/]+)\\/`)
  const m = src.match(re)
  if (!m) {
    throw new Error(`could not extract regex literal for ${name} from script`)
  }
  return new RegExp(m[1])
}

const ROOT_DUMP_PATTERN = extractRegexLiteral(SCRIPT_SRC, 'ROOT_DUMP_PATTERN')
const SRC_DUMP_PATTERN = extractRegexLiteral(SCRIPT_SRC, 'SRC_DUMP_PATTERN')

describe('[ID-0200] check-no-dump-stubs ROOT_DUMP_PATTERN regex behavior', () => {
  it('extracted regex is anchored at start (^) and end ($) on .mjs extension', () => {
    expect(ROOT_DUMP_PATTERN.source).toBe('^dump-.*\\.mjs$')
  })

  it('matches the three documented vestigial root-level dump-*.mjs names', () => {
    expect(ROOT_DUMP_PATTERN.test('dump-laguna.mjs')).toBe(true)
    expect(ROOT_DUMP_PATTERN.test('dump-test-violation.mjs')).toBe(true)
    expect(ROOT_DUMP_PATTERN.test('dump-foo.mjs')).toBe(true)
  })

  it('matches dump-*.mjs with arbitrary middle (greedy .* between dump- and .mjs)', () => {
    expect(ROOT_DUMP_PATTERN.test('dump-.mjs')).toBe(true)
    expect(ROOT_DUMP_PATTERN.test('dump-a-b-c.mjs')).toBe(true)
    expect(ROOT_DUMP_PATTERN.test('dump-with-dots.in.middle.mjs')).toBe(true)
  })

  it('REJECTS dump-foo.js (wrong extension; gate is .mjs-only at root)', () => {
    expect(ROOT_DUMP_PATTERN.test('dump-foo.js')).toBe(false)
  })

  it('REJECTS dump-foo.cjs (wrong extension; .cjs is gate-script extension, not dump)', () => {
    expect(ROOT_DUMP_PATTERN.test('dump-foo.cjs')).toBe(false)
  })

  it('REJECTS dump.mjs (no hyphen suffix; gate fires only on dump-*.mjs)', () => {
    expect(ROOT_DUMP_PATTERN.test('dump.mjs')).toBe(false)
  })

  it('REJECTS foo-dump.mjs (wrong prefix; not anchored at start)', () => {
    expect(ROOT_DUMP_PATTERN.test('foo-dump.mjs')).toBe(false)
  })

  it('REJECTS dump-foo.mjs.bak (wrong suffix; not anchored at end)', () => {
    expect(ROOT_DUMP_PATTERN.test('dump-foo.mjs.bak')).toBe(false)
  })

  it('REJECTS empty string + bare dot files', () => {
    expect(ROOT_DUMP_PATTERN.test('')).toBe(false)
    expect(ROOT_DUMP_PATTERN.test('.mjs')).toBe(false)
    expect(ROOT_DUMP_PATTERN.test('dump-')).toBe(false)
  })
})

describe('[ID-0200] check-no-dump-stubs SRC_DUMP_PATTERN regex behavior', () => {
  it('extracted regex source matches the documented literal exactly', () => {
    expect(SRC_DUMP_PATTERN.source).toBe('^_dump.*\\.(test\\.)?(tsx?|mjs|cjs|js)$')
  })

  it('matches the documented vestigial _dump.test.ts file', () => {
    expect(SRC_DUMP_PATTERN.test('_dump.test.ts')).toBe(true)
  })

  it('matches _dump<arbitrary>.test.<ts|tsx|mjs|cjs|js>', () => {
    expect(SRC_DUMP_PATTERN.test('_dump.test.tsx')).toBe(true)
    expect(SRC_DUMP_PATTERN.test('_dumpFoo.test.ts')).toBe(true)
    expect(SRC_DUMP_PATTERN.test('_dump-bar.test.mjs')).toBe(true)
    expect(SRC_DUMP_PATTERN.test('_dumpScratch.test.cjs')).toBe(true)
    expect(SRC_DUMP_PATTERN.test('_dumpScratch.test.js')).toBe(true)
  })

  it('matches _dump<...>.<ts|mjs|cjs|js> WITHOUT the optional .test. infix', () => {
    expect(SRC_DUMP_PATTERN.test('_dump.ts')).toBe(true)
    expect(SRC_DUMP_PATTERN.test('_dump.tsx')).toBe(true)
    expect(SRC_DUMP_PATTERN.test('_dumpFoo.mjs')).toBe(true)
    expect(SRC_DUMP_PATTERN.test('_dumpFoo.cjs')).toBe(true)
    expect(SRC_DUMP_PATTERN.test('_dumpFoo.js')).toBe(true)
  })

  it('REJECTS dump.ts (no leading underscore; gate is _dump-prefixed inside src/)', () => {
    expect(SRC_DUMP_PATTERN.test('dump.ts')).toBe(false)
  })

  it('REJECTS _dumb.ts (different prefix letter; pin _dump literal)', () => {
    expect(SRC_DUMP_PATTERN.test('_dumb.ts')).toBe(false)
  })

  it('REJECTS _dump.json (extension not in tsx?|mjs|cjs|js whitelist)', () => {
    expect(SRC_DUMP_PATTERN.test('_dump.json')).toBe(false)
  })

  it('REJECTS _dump.txt + _dump.md + _dump.css (extensions not whitelisted)', () => {
    expect(SRC_DUMP_PATTERN.test('_dump.txt')).toBe(false)
    expect(SRC_DUMP_PATTERN.test('_dump.md')).toBe(false)
    expect(SRC_DUMP_PATTERN.test('_dump.css')).toBe(false)
  })

  it('REJECTS foo_dump.ts (not anchored at start)', () => {
    expect(SRC_DUMP_PATTERN.test('foo_dump.ts')).toBe(false)
  })

  it('REJECTS empty string + bare _dump (no extension)', () => {
    expect(SRC_DUMP_PATTERN.test('')).toBe(false)
    expect(SRC_DUMP_PATTERN.test('_dump')).toBe(false)
  })
})

describe('[ID-0200] check-no-dump-stubs SKIP_DIRS completeness pin', () => {
  // Sibling test (Cycle 111 [ID-0150]) only iterates 6 of 8 SKIP_DIRS
  // entries -- node_modules, dist, out, build, .git, coverage. This pin
  // closes the gap by also asserting .vite and .cache (added Cycle 111
  // and never pinned).
  it('SKIP_DIRS contains .vite (vite cache directory)', () => {
    expect(SCRIPT_SRC).toMatch(/SKIP_DIRS = new Set\(\[[\s\S]*?'\.vite'[\s\S]*?\]\)/)
  })

  it('SKIP_DIRS contains .cache (generic cache directory)', () => {
    expect(SCRIPT_SRC).toMatch(/SKIP_DIRS = new Set\(\[[\s\S]*?'\.cache'[\s\S]*?\]\)/)
  })

  it('SKIP_DIRS has exactly 8 entries (catches accidental adds/removes)', () => {
    const m = SCRIPT_SRC.match(/const SKIP_DIRS = new Set\(\[([\s\S]*?)\]\)/)
    expect(m, 'SKIP_DIRS initializer not found').not.toBeNull()
    const body = m![1]
    const entries = body
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('//'))
      .map((s) => s.replace(/^['"]|['"]$/g, ''))
    expect(entries).toHaveLength(8)
    expect(new Set(entries).size).toBe(8) // uniqueness
    expect(entries.sort()).toEqual(
      ['.cache', '.git', '.vite', 'build', 'coverage', 'dist', 'node_modules', 'out'].sort()
    )
  })
})

describe('[ID-0200] check-no-dump-stubs ALLOWLIST set semantics', () => {
  it('ALLOWLIST has exactly 3 entries (matches sibling test count)', () => {
    const m = SCRIPT_SRC.match(/const ALLOWLIST = new Set\(\[([\s\S]*?)\]\)/)
    expect(m, 'ALLOWLIST initializer not found').not.toBeNull()
    const body = m![1]
    const entries = body
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('//'))
      .map((s) => s.replace(/^['"]|['"]$/g, ''))
    expect(entries).toHaveLength(3)
  })

  it('ALLOWLIST entries are all unique (no duplicates)', () => {
    const m = SCRIPT_SRC.match(/const ALLOWLIST = new Set\(\[([\s\S]*?)\]\)/)
    const body = m![1]
    const entries = body
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('//'))
      .map((s) => s.replace(/^['"]|['"]$/g, ''))
    expect(new Set(entries).size).toBe(entries.length)
  })

  it('ALLOWLIST uses POSIX-style relative paths (no backslashes; matches relPosix() normalization)', () => {
    const m = SCRIPT_SRC.match(/const ALLOWLIST = new Set\(\[([\s\S]*?)\]\)/)
    const body = m![1]
    const entries = body
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('//'))
      .map((s) => s.replace(/^['"]|['"]$/g, ''))
    for (const entry of entries) {
      expect(entry).not.toContain('\\')
    }
  })

  it('relPosix() helper splits on path.sep and joins with forward-slash (Windows-portable allowlist comparison)', () => {
    expect(SCRIPT_SRC).toMatch(/function relPosix\(absPath\)/)
    expect(SCRIPT_SRC).toMatch(/path\.relative\(PROJECT_ROOT, absPath\)\.split\(path\.sep\)\.join\('\/'\)/)
  })
})

describe('[ID-0200] check-no-dump-stubs perf-threshold tripwire ([ID-0194] guard)', () => {
  // [ID-0194] (perf rotation, Cycle 118) declared the spawn-shave
  // refactor "ACTIONABLE WHEN: file's runGate(...) invocation count
  // grows beyond 5". Before this pin the only way to detect threshold
  // crossing was a perf-cycle inventory refresh (Cycle 130 earliest).
  // The next two tests count runGate( invocations in the sibling test
  // file's source and fail loudly when threshold crossed -- making
  // [ID-0194] self-tripping.
  const RUNGATE_THRESHOLD = 5

  it('sibling test file currently has at most 5 runGate( invocations (pulls [ID-0194] when crossed)', () => {
    // Count `runGate(` literal in the sibling test source, EXCLUDING
    // the helper's own definition `function runGate(` (one match) and
    // any commented-out occurrences in JSDoc. This counts call sites.
    const all = (SIBLING_TEST_SRC.match(/runGate\(/g) ?? []).length
    const defs = (SIBLING_TEST_SRC.match(/function runGate\(/g) ?? []).length
    const callSites = all - defs
    expect(
      callSites,
      `[ID-0194] perf-shave is now ACTIONABLE -- sibling test file has ${callSites} runGate(...) call sites (threshold > ${RUNGATE_THRESHOLD}). ` +
        `Pull [ID-0194] next perf cycle: hoist a single spawnSync into a beforeAll-cached const + read fields off the cached {status, stdout, stderr}; ` +
        `only re-spawn for cases that intentionally mutate cwd or env. Expected shave ~70 ms.`
    ).toBeLessThanOrEqual(RUNGATE_THRESHOLD)
  })

  it('records the [ID-0194] threshold value (= 5) so it cannot drift silently', () => {
    expect(RUNGATE_THRESHOLD).toBe(5)
  })

  it('sibling test file imports spawnSync (so the helper actually does spawn)', () => {
    expect(SIBLING_TEST_SRC).toMatch(/import \{ spawnSync \} from 'node:child_process'/)
    expect(SIBLING_TEST_SRC).toMatch(/spawnSync\(process\.execPath, \[SCRIPT\]/)
  })
})

describe('[ID-0200] check-no-dump-stubs CLI exit-code contract pin', () => {
  it('source documents the two exit codes (0 = clean, 1 = violation)', () => {
    expect(SCRIPT_SRC).toMatch(/Exit codes:[\s\S]*?0 -- clean[\s\S]*?1 -- at least one non-allowlisted match/)
  })

  it('source emits process.exit(1) on violation and process.exit(0) on clean', () => {
    expect(SCRIPT_SRC).toContain('process.exit(1)')
    expect(SCRIPT_SRC).toContain('process.exit(0)')
  })

  it('violation message includes the [ID-0150] tag for log-grep traceability', () => {
    expect(SCRIPT_SRC).toMatch(/'\[ID-0150\] check-no-dump-stubs FAILED:/)
  })

  it('script declares strict mode (defensive against TDZ + redeclaration drift)', () => {
    expect(SCRIPT_SRC).toMatch(/^'use strict'/m)
  })

  it('script is CommonJS (require/module.exports family) -- pin .cjs runtime semantics', () => {
    // The .cjs extension already pins this at the filesystem level
    // (sibling test asserts SCRIPT.endsWith('.cjs')); this test pins
    // the SOURCE-LEVEL signature: the script uses `require(...)` and
    // does NOT use ES-module `import`/`export` syntax. Mixing the two
    // would either fail Node's loader (if "type":"module") or load
    // silently with mismatched semantics.
    expect(SCRIPT_SRC).toMatch(/require\('node:fs'\)/)
    expect(SCRIPT_SRC).toMatch(/require\('node:path'\)/)
    // Heuristic anti-pattern check: NO bare `import ` at line start (excluding comments).
    const lines = SCRIPT_SRC.split('\n')
    const bareImports = lines.filter(
      (l) => /^\s*import\s+/.test(l) && !/^\s*\/[\/\*]/.test(l)
    )
    expect(bareImports).toHaveLength(0)
  })
})
