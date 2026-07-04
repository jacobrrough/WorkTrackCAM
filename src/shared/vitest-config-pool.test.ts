/**
 * [ID-0153] Cycle 75 -- vitest worker-pool config regression pin.
 *
 * Purpose: lock the `pool: 'threads'` + single-worker configuration into
 * `vitest.config.ts` so it does not silently drift back to the default
 * fork pool. The default pool spins a fresh Node worker per file, which
 * on this 189-file suite paid ~16 s of "prepare" overhead PER directory-
 * scoped sweep and pushed full `npm test` past the 45-s sandbox budget
 * that [ID-0066] flagged. The single-worker threads pool reuses one
 * worker across all files, dropping full-suite wall-clock from >45 s to
 * ~8 s with zero test regressions (4007 passed / 1 skipped, 188 / 1
 * skipped / 189 files at Cycle 75).
 *
 * Vitest 4 (2026-06-01) flattened `poolOptions` into top-level options.
 * The previous `poolOptions.threads.singleThread: true` was replaced
 * with `fileParallelism: false`, which the v4 docstring guarantees
 * "will override maxWorkers option to 1" — semantically identical.
 *
 * If a future cycle has a real reason to revisit the pool config (e.g.
 * a parallelizable hotspot test that benefits from multi-thread or a
 * test-isolation regression that demands per-file worker boundaries),
 * the cycle MUST update this pin AND document the trade-off in
 * `.claude/perf-inventory.md` so the rationale is preserved.
 */

import { describe, expect, it } from 'vitest'
import vitestConfig from '../../vitest.config'

// `defineConfig` is an identity helper, but its return type is a union
// (UserConfig | UserConfigFn | UserConfigExport). Narrow to the object
// shape we authored.
type ResolvedTestConfig = {
  test?: {
    pool?: string
    fileParallelism?: boolean
    include?: string[]
    testTimeout?: number
    environment?: string
  }
}

// Vitest's `defineConfig` returns `ViteUserConfig | UserConfigFn |
// Promise<...>`. Our authored config is a literal object, so a typed
// runtime narrowing is safe.
function isResolvedConfig(value: unknown): value is ResolvedTestConfig {
  return (
    typeof value === 'object' &&
    value !== null &&
    'test' in value &&
    typeof (value as { test: unknown }).test === 'object'
  )
}

describe('[ID-0153] vitest.config.ts worker-pool pin', () => {
  it('exports an object (not a function or promise) so the runtime can read it', () => {
    expect(isResolvedConfig(vitestConfig)).toBe(true)
  })

  it('uses pool: "threads" -- the fork-pool default re-introduces ~16 s prepare overhead per sweep', () => {
    if (!isResolvedConfig(vitestConfig)) {
      throw new Error('vitest config did not narrow to the authored object shape')
    }
    expect(vitestConfig.test?.pool).toBe('threads')
  })

  it('sets fileParallelism: false -- the v4 replacement for the legacy singleThread option (overrides maxWorkers to 1)', () => {
    if (!isResolvedConfig(vitestConfig)) {
      throw new Error('vitest config did not narrow to the authored object shape')
    }
    expect(vitestConfig.test?.fileParallelism).toBe(false)
  })

  it('preserves the [ID-0072-followup] include glob (renderer .test.tsx coverage)', () => {
    if (!isResolvedConfig(vitestConfig)) {
      throw new Error('vitest config did not narrow to the authored object shape')
    }
    expect(vitestConfig.test?.include).toEqual(['src/**/*.test.{ts,tsx}'])
  })

  it('keeps a >=30s testTimeout (heavy CAM-engine audits run 2-3x slower under CI coverage)', () => {
    if (!isResolvedConfig(vitestConfig)) {
      throw new Error('vitest config did not narrow to the authored object shape')
    }
    // Raised 15s -> 30s: the O(N^2) adaptive-clearing engagement audits time out
    // at 15s under coverage instrumentation on the constrained CI runner. Real
    // infinite loops are guarded at the source (cam-axis4 stepover), so a genuine
    // hang still fails well before 30s.
    expect(vitestConfig.test?.testTimeout).toBe(30000)
  })

  it('keeps environment: "node" (the suite is not a jsdom suite; renderer tests use shallow component pins)', () => {
    if (!isResolvedConfig(vitestConfig)) {
      throw new Error('vitest config did not narrow to the authored object shape')
    }
    expect(vitestConfig.test?.environment).toBe('node')
  })
})

describe('[ID-0153] worker-pool config -- belt-and-braces shape guards', () => {
  it('the pool field is a literal "threads" string, not undefined or a typo', () => {
    if (!isResolvedConfig(vitestConfig)) {
      throw new Error('vitest config did not narrow to the authored object shape')
    }
    const pool = vitestConfig.test?.pool
    expect(typeof pool).toBe('string')
    // Vitest 4 accepts: 'threads' | 'forks' | 'vmThreads' | 'vmForks'.
    // 'threads' is the only pool we measured at -81% wall-clock in Cycle 75.
    expect(pool).not.toBe('forks')
    expect(pool).not.toBe('vmThreads')
    expect(pool).not.toBe('vmForks')
  })

  it('fileParallelism is the boolean false, not a truthy string or undefined', () => {
    if (!isResolvedConfig(vitestConfig)) {
      throw new Error('vitest config did not narrow to the authored object shape')
    }
    const fileParallelism = vitestConfig.test?.fileParallelism
    expect(typeof fileParallelism).toBe('boolean')
    expect(fileParallelism).toBe(false)
  })
})
