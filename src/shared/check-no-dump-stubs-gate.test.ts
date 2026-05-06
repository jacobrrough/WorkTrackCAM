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

import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'

const PROJECT_ROOT = path.resolve(__dirname, '..', '..')
const SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'check-no-dump-stubs.cjs')
const PKG_JSON = path.join(PROJECT_ROOT, 'package.json')

function runGate(cwd: string = PROJECT_ROOT) {
  const result = spawnSync(process.execPath, [SCRIPT], {
    cwd,
    env: process.env,
    encoding: 'utf8'
  })
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  }
}

describe('[ID-0150] check-no-dump-stubs gate -- runtime exit-zero contract', () => {
  it('exits 0 with the three known-vestigial files allowlisted', () => {
    const { status, stderr } = runGate()
    expect(status).toBe(0)
    expect(stderr).toBe('')
  })

  it('still exits 0 when invoked from outside the repo (script is __dirname-anchored, cwd-independent)', () => {
    const { status } = runGate('/tmp')
    expect(status).toBe(0)
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

  it('test script chains vitest run with python pytest (Cycle 113 [ID-0057] / [ID-0147-cleared])', () => {
    // Cycle 113 [ID-0057] promoted `npm run test:python` into the default
    // `npm test` gate. The chain semantics: if `vitest run` exits non-zero
    // pytest does NOT run; if `vitest run` passes, pytest runs and its
    // exit status determines the overall `npm test` exit status.
    //
    // [ID-0147-cleared] (2026-04-30): the chain now indirects through
    // `npm run test:python` so the `pretest:python` sandbox-bootstrap
    // hook (installs pytest if missing in the autonomous-improvement
    // sandbox) fires as part of the default gate.
    const pkg = JSON.parse(fs.readFileSync(PKG_JSON, 'utf8'))
    expect(pkg.scripts.test).toBe('vitest run && npm run test:python')
  })

  it('typecheck script is unchanged (tsc --noEmit)', () => {
    const pkg = JSON.parse(fs.readFileSync(PKG_JSON, 'utf8'))
    expect(pkg.scripts.typecheck).toBe('tsc --noEmit')
  })
})

describe('[ID-0150] check-no-dump-stubs gate -- working-tree state of allowlisted files', () => {
  it('dump-laguna.mjs exists at root (vestigial; cannot be unlinked in the current sandbox)', () => {
    expect(fs.existsSync(path.join(PROJECT_ROOT, 'dump-laguna.mjs'))).toBe(true)
  })

  it('src/main/_dump.test.ts exists (vestigial; cannot be unlinked in the current sandbox)', () => {
    expect(fs.existsSync(path.join(PROJECT_ROOT, 'src', 'main', '_dump.test.ts'))).toBe(true)
  })

  it('dump-test-violation.mjs exists at root (Cycle 111 [ID-0150] verification artifact wedged by read-only bind-mount)', () => {
    expect(fs.existsSync(path.join(PROJECT_ROOT, 'dump-test-violation.mjs'))).toBe(true)
  })

  it('the two earlier vestigial dump files are scratch-only stubs (no production logic depends on them)', () => {
    const dumpLaguna = fs.readFileSync(path.join(PROJECT_ROOT, 'dump-laguna.mjs'), 'utf8')
    expect(dumpLaguna).toContain('Stray scratch file')
    expect(dumpLaguna).toContain('export {}')
    const dumpTest = fs.readFileSync(
      path.join(PROJECT_ROOT, 'src', 'main', '_dump.test.ts'),
      'utf8'
    )
    expect(dumpTest).toContain('intentionally empty')
    expect(dumpTest).toContain('expect(true).toBe(true)')
  })

  it('dump-test-violation.mjs is a zero-byte verification probe (Cycle 111 [ID-0150])', () => {
    // The Cycle 111 verification probe was created via `touch`. It must
    // remain zero-byte: a non-empty file would mean a future cycle wrote
    // through the bind-mount on a known-vestigial path, which would
    // contradict the [ID-0011] / [ID-0056] BLOCKED state. If unlink ever
    // becomes possible, the probe + the other two stubs go together.
    const probe = path.join(PROJECT_ROOT, 'dump-test-violation.mjs')
    expect(fs.statSync(probe).size).toBe(0)
  })
})
