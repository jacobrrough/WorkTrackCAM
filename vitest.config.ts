import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: {
    __APP_PRODUCT__: JSON.stringify('unified'),
    __APP_SHELL__: JSON.stringify('legacy')
  },
  test: {
    environment: 'node',
    // [ID-0072-followup] Cycle 50 -- broaden to .test.tsx so renderer
    // component tests (e.g. MoonrakerPreviewBanner.test.tsx) are picked
    // up alongside the existing .test.ts suites. No existing .test.tsx
    // files; this is purely additive.
    include: ['src/**/*.test.{ts,tsx}'],
    testTimeout: 15000,
    // [ID-0153] Cycle 75 -- vitest worker-pool tuning. The default fork
    // pool spins a fresh Node worker per file, so a 189-file suite paid
    // ~16 s of "prepare" overhead per directory-scoped sweep (33.5 s on
    // src/shared, 5+ s prepare visible in vitest --reporter=basic
    // output). Cumulative cost pushed full npm test past the 45-s
    // sandbox budget that [ID-0066] flagged. Switching to the threads
    // pool with singleThread: true reuses one worker across all files,
    // dropping the prepare cost to ~230 ms and the full 4007-test
    // suite from >45 s to 8.3 s wall-clock (-81%) with ZERO test
    // regressions. Risk: shared module-level state can leak across
    // files within the single thread, so any future test that mutates
    // a process-global (env vars, module singletons, fs cwd) MUST
    // clean up in afterEach/afterAll. The full Cycle 75 sweep
    // (4007 / 1 skipped, 188 / 1 skipped / 189 files) confirmed no
    // existing test relies on isolation between files; the perf-cycle
    // pin in src/shared/vitest-config-pool.test.ts guards against
    // accidental config drift.
    //
    // [Vitest 4 migration, 2026-06-01] poolOptions was flattened in
    // Vitest 4 — the previous `poolOptions.threads.singleThread: true`
    // is now expressed as `fileParallelism: false`, which the v4
    // docstring guarantees "will override maxWorkers option to 1".
    // Net effect identical: single worker reused across the whole
    // suite. CVE GHSA-5xrq-8626-4rwp (CVSS 9.8) was the driver for
    // the v3 → v4 upgrade.
    pool: 'threads',
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text', 'text-summary', 'html', 'lcov'],
      include: ['src/shared/**/*.ts', 'src/main/**/*.ts'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/*.d.ts']
    }
  }
})
