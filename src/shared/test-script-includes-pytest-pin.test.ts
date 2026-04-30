/**
 * [ID-0057] -- npm test default gate now chains pytest (Cycle 113 bonus pull).
 *
 * Cycle 4 Task 4.3 (2026-04-22) landed `npm run test:python` as a separate
 * script + Quality-Gate riders in `.claude/commands/improve.md`. The
 * follow-up [ID-0057] tracked promoting that into the default `npm test`
 * gate so non-`cam-engine` cycles catch Python regressions automatically.
 *
 * This file is the paired-pin contract for the Cycle 113 close-out:
 *   - `npm test` script chains `vitest run` AND `python3 -m pytest
 *     engines/cam/advanced/tests/ -q`.
 *   - Chaining is `&&` short-circuit: pytest does NOT run if vitest fails;
 *     pytest's exit status determines the overall exit status when vitest
 *     passes.
 *   - The legacy `npm run test:python` script is preserved (some workflows
 *     still want to run only the Python tests, and the `cam-engine` Quality
 *     Gate riders in `.claude/commands/improve.md` reference it by name).
 *   - The chained pytest target is the same path as `test:python` (single
 *     source of truth -- if either drifts it must drift together).
 *
 * Why a NEW file rather than appending to `check-no-dump-stubs-gate.test.ts`
 * (Cycle 111): that file is scoped to the `[ID-0150]` stale-write detection
 * gate. The `[ID-0057]` pin is a separate invariant about the test runner
 * composition and deserves its own file so the failure message is
 * unambiguous about which roadmap entry regressed.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'

const PROJECT_ROOT = path.resolve(__dirname, '..', '..')
const PKG_JSON = path.join(PROJECT_ROOT, 'package.json')

const PYTEST_TARGET = 'engines/cam/advanced/tests/'
// [ID-0147-cleared] (2026-04-30): chained gate now indirects through
// `npm run test:python` so the `pretest:python` bootstrap hook
// (sandbox-bootstrap.mjs, installs pytest if missing) runs as part of
// the default gate. The literal pytest invocation moved into
// `scripts.test:python`; `scripts.test` now reads `vitest run && npm
// run test:python`.
const EXPECTED_TEST_VALUE = 'vitest run && npm run test:python'
const EXPECTED_TEST_PYTHON_VALUE =
  'python3 -m pytest engines/cam/advanced/tests/ -p no:cacheprovider -q'

describe('[ID-0057] npm test default gate chains pytest', () => {
  it('package.json scripts.test exactly matches the documented chained value', () => {
    const pkg = JSON.parse(fs.readFileSync(PKG_JSON, 'utf8'))
    // Exact-string pin: any drift (whitespace, flag order, target path)
    // fails this gate before a future cycle ships a subtly broken
    // chained command. The roadmap entry's verbatim wording is the
    // contract.
    expect(pkg.scripts.test).toBe(EXPECTED_TEST_VALUE)
  })

  it('the chained command begins with `vitest run` so pretest hooks still apply', () => {
    const pkg = JSON.parse(fs.readFileSync(PKG_JSON, 'utf8'))
    // npm runs `pretest` -> `test` -> `posttest` in order. Because the
    // pretest hook (Cycle 111 [ID-0150] check-no-dump-stubs.cjs) is
    // wired against `pretest`, prepending anything before `vitest run`
    // would not break the hook -- but a future change that swapped the
    // order to `python3 -m pytest ... && vitest run` would mean a JS-side
    // regression is masked behind a working Python suite. Pin the order.
    expect(pkg.scripts.test.startsWith('vitest run')).toBe(true)
  })

  it('the chain uses `&&` short-circuit (not `;` or `&`)', () => {
    const pkg = JSON.parse(fs.readFileSync(PKG_JSON, 'utf8'))
    // `;` would run pytest even if vitest fails (waste of CI minutes,
    // confused failure attribution). `&` would fork pytest into the
    // background (zero correctness signal). `&&` is the only correct
    // operator for a sequential gate that aborts on first failure.
    // Post-[ID-0147-cleared] the chain is `vitest run && npm run
    // test:python` (indirection through the test:python script so the
    // pretest:python bootstrap fires).
    expect(pkg.scripts.test).toMatch(/vitest\s+run\s*&&\s*npm\s+run\s+test:python/)
    // Negative pins: must not contain stand-alone `;` or single `&`
    // outside the `&&` form.
    expect(pkg.scripts.test).not.toMatch(/vitest\s+run\s*;/)
    expect(pkg.scripts.test).not.toMatch(/vitest\s+run\s*&(?!&)/)
  })

  it('the chained pytest invocation targets engines/cam/advanced/tests/', () => {
    const pkg = JSON.parse(fs.readFileSync(PKG_JSON, 'utf8'))
    // The pytest target must be the same path the bundled Python
    // engine tests live at. A future restructure of `engines/cam/`
    // that moves the test directory must also update this string.
    // Post-[ID-0147-cleared] the literal pytest invocation lives in
    // `scripts.test:python` (chained via `npm run test:python`).
    expect(pkg.scripts['test:python']).toContain(PYTEST_TARGET)
  })

  it('the chained pytest invocation passes the `-q` quiet flag', () => {
    const pkg = JSON.parse(fs.readFileSync(PKG_JSON, 'utf8'))
    // `-q` keeps the CI log slim; pytest still reports failures with
    // full tracebacks even with `-q`. Pinned against `test:python`
    // (the literal pytest invocation) post-[ID-0147-cleared].
    expect(pkg.scripts['test:python']).toMatch(/python3\s+-m\s+pytest\s+\S+.*\s-q\b/)
  })

  it('`test:python` script exists with the -p no:cacheprovider sandbox-safety flag', () => {
    const pkg = JSON.parse(fs.readFileSync(PKG_JSON, 'utf8'))
    // `.claude/commands/improve.md` Quality Gate riders for the
    // `cam-engine` focus area reference `npm run test:python` by name.
    // [ID-0147-cleared] (2026-04-30): added `-p no:cacheprovider` to
    // sidestep the sandbox tempdir-cleanup recursion bug that surfaces
    // when pytest's default cacheprovider plugin tries to chmod a path
    // it can't follow. The flag is harmless on hosts without that bug.
    expect(pkg.scripts['test:python']).toBe(EXPECTED_TEST_PYTHON_VALUE)
  })

  it('test:python is wrapped by a pretest:python sandbox-bootstrap hook', () => {
    const pkg = JSON.parse(fs.readFileSync(PKG_JSON, 'utf8'))
    // [ID-0147-cleared]: npm runs `pre<script>` automatically before
    // `<script>`. The bootstrap hook (`scripts/sandbox-bootstrap.mjs`)
    // installs pytest into the sandbox user-site if it isn't already
    // importable -- making the autonomous-improvement workflow's
    // Safety Rule 5 (real-STL Python validation) able to run cold from
    // a fresh sandbox session. Idempotent: short-circuits on
    // already-importable.
    expect(pkg.scripts['pretest:python']).toBe('node scripts/sandbox-bootstrap.mjs')
    expect(pkg.scripts['bootstrap:python']).toBe('node scripts/sandbox-bootstrap.mjs')
  })

  it('chained `test` invokes test:python (single source of truth for the pytest invocation)', () => {
    const pkg = JSON.parse(fs.readFileSync(PKG_JSON, 'utf8'))
    // Single source of truth: post-[ID-0147-cleared] the chained
    // command no longer inlines pytest; instead it calls
    // `npm run test:python`. Any future cycle that adds a flag to one
    // but not the other is impossible by construction since the chain
    // delegates.
    const chainedTest = pkg.scripts.test as string
    expect(chainedTest).toContain('npm run test:python')
  })

  it('the chained pytest path resolves to a real directory on disk', () => {
    // Belt-and-braces: the pin asserts the string in package.json
    // matches a directory that actually exists. A future cycle that
    // mistypes the path would otherwise pass the string check above
    // but fail the live pytest run.
    const target = path.join(PROJECT_ROOT, 'engines', 'cam', 'advanced', 'tests')
    expect(fs.existsSync(target)).toBe(true)
    expect(fs.statSync(target).isDirectory()).toBe(true)
  })

  it('typecheck script is unchanged (tsc --noEmit, not chained with anything)', () => {
    // [ID-0057] only promotes `test:python` into `test`. `typecheck`
    // remains a JS-side-only gate. If a future cycle wants to chain
    // mypy or a Python type-checker into typecheck, that is a
    // separate roadmap entry and a separate pin.
    const pkg = JSON.parse(fs.readFileSync(PKG_JSON, 'utf8'))
    expect(pkg.scripts.typecheck).toBe('tsc --noEmit')
  })
})
