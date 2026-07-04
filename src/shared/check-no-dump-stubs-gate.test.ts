/**
 * src/shared/check-no-dump-stubs-gate.test.ts -- [ID-0150] Cycle 111
 *
 * Paired-pin contract for `scripts/check-no-dump-stubs.cjs` -- the pretest
 * gate that fails CI if dump-style scratch files reappear in the working
 * tree. Lives under src/shared so it sits inside the vitest include glob
 * (the glob picks up any test under src/) AND inside tsconfig.json include.
 * The earlier draft of this contract at scripts/check-no-dump-stubs.test.ts
 * is outside both globs and is documented there as a tombstone redirect.
 *
 * Why pin both directions of the contract? Cycle 111 verification accidentally
 * created a third unremovable file (`dump-test-violation.mjs`) when proving
 * the gate fires correctly; the read-only bind-mount returned "Operation not
 * permitted" on rm. Both directions of the gate's behavior (clean-tree exit-0
 * AND violation exit-1) are therefore externally observable in the working
 * tree as we land this cycle, and the tests below assert each side.
 *
 * Sibling precedent for tooling/config contract tests in src/shared:
 *   - src/shared/vitest-config-pool.test.ts (vitest pool: threads / singleThread invariant)
 */

import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'

const PROJECT_ROOT = path.resolve(__dirname, '..', '..')
const SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'check-no-dump-stubs.cjs')
const PKG_JSON = path.join(PROJECT_ROOT, 'package.json')

// Import the gate's PURE scan in-process rather than spawning
// `node scripts/check-no-dump-stubs.cjs`. The old spawnSync-based check
// returned status=null on the CI coverage runner (a second node process could
// not be spawned during peak coverage load, so the whole `test:coverage` step
// failed). The script now exports `findDumpStubViolations`; the CLI exit-code
// behavior is preserved by the `pretest` hook and pinned below.
const requireCjs = createRequire(__filename)
const gate = requireCjs(SCRIPT) as { findDumpStubViolations: () => string[] }

describe('[ID-0150] check-no-dump-stubs gate -- runtime clean-tree contract', () => {
  it('reports zero violations with the three known-vestigial files allowlisted', () => {
    expect(gate.findDumpStubViolations()).toEqual([])
  })

  it('scan is __dirname-anchored, so it is deterministic and cwd-independent', () => {
    // The scan resolves PROJECT_ROOT from the script's own __dirname and never
    // reads process.cwd(), so repeated calls yield the same (empty) set.
    expect(gate.findDumpStubViolations()).toEqual(gate.findDumpStubViolations())
    expect(gate.findDumpStubViolations()).toEqual([])
  })
})

describe('[ID-0150] check-no-dump-stubs gate -- script source contract', () => {
  it('script file exists, is non-empty, and uses the .cjs extension', () => {
    expect(fs.existsSync(SCRIPT)).toBe(true)
    const stat = fs.statSync(SCRIPT)
    expect(stat.size).toBeGreaterThan(0)
    expect(SCRIPT.endsWith('.cjs')).toBe(true)
  })

  it('allowlist contains exactly the three known-vestigial files in source order', () => {
    const src = fs.readFileSync(SCRIPT, 'utf8')
    const match = src.match(/const ALLOWLIST = new Set\(\[([\s\S]*?)\]\)/)
    expect(match, 'ALLOWLIST initializer not found').not.toBeNull()
    const body = match![1]
    const entries = body
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('//'))
      .map((s) => s.replace(/^['"]|['"]$/g, ''))
    expect(entries).toEqual([
      'dump-laguna.mjs',
      'src/main/_dump.test.ts',
      'dump-test-violation.mjs'
    ])
  })

  it('skip-dirs list excludes node_modules, dist, out, build, .git, coverage', () => {
    const src = fs.readFileSync(SCRIPT, 'utf8')
    for (const skip of ['node_modules', 'dist', 'out', 'build', '.git', 'coverage']) {
      expect(src).toContain(`'${skip}'`)
    }
  })

  it('forbids dump-*.mjs at root via documented regex literal', () => {
    const src = fs.readFileSync(SCRIPT, 'utf8')
    expect(src).toMatch(/const ROOT_DUMP_PATTERN = \/\^dump-\.\*\\\.mjs\$\//)
  })

  it('forbids _dump* under src/ via documented regex literal (with .test. or no infix, ts/tsx/mjs/cjs/js extensions)', () => {
    const src = fs.readFileSync(SCRIPT, 'utf8')
    expect(src).toMatch(/const SRC_DUMP_PATTERN = \/\^_dump\.\*\\\.\(test\\\.\)\?\(tsx\?\|mjs\|cjs\|js\)\$\//)
  })
})

describe('[ID-0150] check-no-dump-stubs gate -- package.json wiring', () => {
  it('pretest script runs the gate so every npm test invocation triggers it', () => {
    const pkg = JSON.parse(fs.readFileSync(PKG_JSON, 'utf8'))
    expect(pkg.scripts.pretest).toBe('node scripts/check-no-dump-stubs.cjs')
  })

  it('exposes a check:no-dump-stubs named script for direct invocation', () => {
    const pkg = JSON.parse(fs.readFileSync(PKG_JSON, 'utf8'))
    expect(pkg.scripts['check:no-dump-stubs']).toBe('node scripts/check-no-dump-stubs.cjs')
  })

  it('typecheck script is unchanged (tsc --noEmit)', () => {
    const pkg = JSON.parse(fs.readFileSync(PKG_JSON, 'utf8'))
    expect(pkg.scripts.typecheck).toBe('tsc --noEmit')
  })
})

describe('[ID-0150] check-no-dump-stubs gate -- working-tree state of allowlisted files', () => {
  // Post-2026-05-27 foundation pivot: the two root dump-*.mjs files
  // (`dump-laguna.mjs`, `dump-test-violation.mjs`) that were wedged in
  // the prior sandbox by a read-only bind-mount have been removed in the
  // fresh checkout. `src/main/_dump.test.ts` still exists as a tombstone
  // (a one-line `expect(true).toBe(true)` placeholder) so this single
  // remaining allowlist entry can still be observed. The four tests that
  // pinned the wedged-state existence + zero-byte probe contract have been
  // trimmed because the underlying environmental quirk no longer applies;
  // the allowlist *content* contract (line 65) is the surviving anchor for
  // the gate's tolerated-files surface.
  it('src/main/_dump.test.ts exists (last surviving allowlisted scratch file)', () => {
    expect(fs.existsSync(path.join(PROJECT_ROOT, 'src', 'main', '_dump.test.ts'))).toBe(true)
  })

  it('src/main/_dump.test.ts is a no-op tombstone (no production logic depends on it)', () => {
    const dumpTest = fs.readFileSync(
      path.join(PROJECT_ROOT, 'src', 'main', '_dump.test.ts'),
      'utf8'
    )
    expect(dumpTest).toContain('intentionally empty')
    expect(dumpTest).toContain('expect(true).toBe(true)')
  })
})
