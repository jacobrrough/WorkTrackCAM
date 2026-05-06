/**
 * .claude/perf-inventory.md -- Cycle 105 refresh pin [ID-0187] (Cycle 105,
 * perf, 2026-04-27).
 *
 * Pins the Cycle 105 perf-inventory refresh section so the post-Cycle-104
 * re-baseline numbers (214 files / 4666 tests / 8.94 s wall-clock), the
 * Cycle 81 -> Cycle 105 evolution table, and the bucket-preservation
 * conclusion cannot silently drift if the file is later edited. Mirrors
 * the existing `perf-inventory-docs-pin.test.ts` paired-pin shape from
 * Cycle 81.
 *
 * Scope (per CLAUDE.md "My-Shop-Only Mode"):
 *   The perf-inventory is suite-wide infrastructure; it is machine-agnostic
 *   in that it covers all three target machines transparently. The Cycle 105
 *   refresh confirms the Cycle 86 [ID-0169] (carvera-pipeline `beforeAll`
 *   hoist) and Cycle 94 [ID-0181] (ipc-contract.test.ts hoist) shaves are
 *   both durable across +20 test files / +548 tests of growth.
 *
 * Failure modes this pin catches:
 *   1. Cycle 105 closure section deleted/renamed.
 *   2. Headline numbers (214 / 4666 / 8.94 s) drift without re-measurement.
 *   3. The "bucket distribution exactly preserved" / "zero new perf
 *      regressions" conclusion is rewritten without re-measuring.
 *   4. The Cycle 105 reproducer artifacts disappear from .claude/perf-tmp/.
 *   5. The [ID-0187] status line drifts.
 *
 * No production code is touched. No machine profile / post template /
 * G-code is touched. Pure documentation pin.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = join(__dirname, '..', '..')

function loadPerfInventory(): string {
  return readFileSync(join(repoRoot, '.claude', 'perf-inventory.md'), 'utf-8')
}

describe('.claude/perf-inventory.md -- Cycle 105 refresh pin [ID-0187]', () => {
  describe('file presence and structure', () => {
    it('Cycle 105 refresh section anchor exists', () => {
      const doc = loadPerfInventory()
      expect(doc).toMatch(
        /^## Cycle 105 refresh \(2026-04-27T11:48:00Z\) -- post-Cycle-81 inventory re-baseline \[ID-0187\]/m
      )
    })

    it('section preserves the Cycle 81 -> Cycle 105 framing', () => {
      const doc = loadPerfInventory()
      expect(doc).toContain('post-Cycle-81 inventory re-baseline')
      expect(doc).toContain('Cycle 75')
      expect(doc).toContain('Cycle 81')
    })
  })

  describe('Cycle 81 -> Cycle 105 headline numbers (paired pin)', () => {
    it('total test files row documents 194 -> 214 growth', () => {
      const doc = loadPerfInventory()
      expect(doc).toContain('| Total test files | 194 | **214** | +20 (+10.3%) |')
    })

    it('total tests row documents 4118 -> 4666 growth', () => {
      const doc = loadPerfInventory()
      expect(doc).toContain('| Total tests | 4118 | **4666** | +548 (+13.3%) |')
    })

    it('sum-per-file ms row documents +0.06% drift (essentially flat)', () => {
      const doc = loadPerfInventory()
      expect(doc).toContain(
        '| Sum per-file ms (parallel-overlapped) | 3169 | **3171** | +2 (+0.06%) |'
      )
    })

    it('mean-per-file row documents the -9.2% improvement', () => {
      const doc = loadPerfInventory()
      expect(doc).toContain('| Mean per-file ms | 16.3 | **14.8** | -1.5 (-9.2%) |')
    })

    it('p99 row documents the -23.9% tail-shrinkage', () => {
      const doc = loadPerfInventory()
      expect(doc).toContain('| p99 per-file ms | 276 | **210** | -66 (-23.9%) |')
    })

    it('full-suite wall-clock row documents 8.54 s -> 8.94 s under the [ID-0066] budget', () => {
      const doc = loadPerfInventory()
      expect(doc).toContain(
        '| Full `npm test` wall-clock | 8.54 s | **8.94 s** ([ID-0066] resolved) | +0.40 s (+4.7%) |'
      )
    })
  })

  describe('threshold buckets (paired pin against Cycle 81)', () => {
    it('all five bucket rows show zero net change', () => {
      const doc = loadPerfInventory()
      expect(doc).toContain('| > 1.0 s   | 0 | **0** | 0 |')
      expect(doc).toContain('| > 500 ms  | 1 | **1** | 0 |')
      expect(doc).toContain('| > 250 ms  | 3 | **3** | 0 |')
      expect(doc).toContain('| > 100 ms  | 7 | **7** | 0 |')
      expect(doc).toContain('| > 50 ms   | 9 | **9** | 0 |')
    })
  })

  describe('Cycle 105 top-25 ranking integrity', () => {
    it('rank 1 is still carvera-pipeline.test.ts (now 567 ms)', () => {
      const doc = loadPerfInventory()
      expect(doc).toContain(
        '| 1 | 567 | 16 | 35.4 | `src/main/cam-axis4/__tests__/carvera-pipeline.test.ts` |'
      )
    })

    it('rank 2 is still subprocess-bounded.test.ts (now 289 ms)', () => {
      const doc = loadPerfInventory()
      expect(doc).toContain(
        '| 2 | 289 | 11 | 26.2 | `src/main/subprocess-bounded.test.ts` |'
      )
    })

    it('rank 3 is the cam-axis4 integration test (now 283 ms)', () => {
      const doc = loadPerfInventory()
      expect(doc).toContain(
        '| 3 | 283 | 5 | 56.6 | `src/main/cam-axis4/__tests__/integration.test.ts` |'
      )
    })
  })

  describe('Cycle 81 -> Cycle 105 evolution table integrity', () => {
    it('carvera-pipeline row documents the Cycle 86 [ID-0169] shave (-22 ms)', () => {
      const doc = loadPerfInventory()
      expect(doc).toContain(
        '| `cam-axis4/__tests__/carvera-pipeline.test.ts` | 589 | **567** | -22 (-3.7%) | Cycle 86 [ID-0169] machine-profile `beforeAll` hoist |'
      )
    })

    it('ipc-contract.test.ts row documents the Cycle 94 [ID-0181] hoist exit from top-25', () => {
      const doc = loadPerfInventory()
      expect(doc).toContain('Cycle 94 [ID-0181]')
      expect(doc).toContain('out of top 25')
    })

    it('flat-status conclusion is preserved for the rank-2/3/4/5 files', () => {
      const doc = loadPerfInventory()
      // The ±1.0 % framing is what justifies the no-new-fix conclusion --
      // future cycles should not rewrite it without re-measuring.
      expect(doc).toContain('within ±1.0 % of their Cycle 81 baseline -- statistically flat')
    })
  })

  describe('no-new-fix conclusion + status line', () => {
    it('Cycle 105 conclusion is healthy steady-state', () => {
      const doc = loadPerfInventory()
      expect(doc).toContain('healthy steady-state perf regime')
      expect(doc).toContain('zero new perf regressions')
    })

    it('Cycle 105 [ID-0187] status line emits BACKLOG -> COMPLETED', () => {
      const doc = loadPerfInventory()
      expect(doc).toMatch(
        /Status: \*\*\[ID-0187\] BACKLOG -> COMPLETED\*\* on this cycle \(perf-inventory refresh deliverable\)/
      )
    })

    it('Cycle 105 section explicitly NOT-files a new shave ID', () => {
      const doc = loadPerfInventory()
      expect(doc).toContain('No new [ID]-grade fix filed this cycle')
    })
  })

  describe('Cycle 105 reproducer artifacts exist on disk', () => {
    it('cycle105-aggregate.json reproducer exists', () => {
      const path = join(repoRoot, '.claude/perf-tmp/cycle105-aggregate.json')
      expect(existsSync(path)).toBe(true)
      // Non-trivial size -- vitest --reporter=json output for ~4666 tests
      // is north of 100 KB.
      expect(statSync(path).size).toBeGreaterThan(100_000)
    })

    it('cycle105-aggregate.tsv reproducer exists with the expected header', () => {
      const path = join(repoRoot, '.claude/perf-tmp/cycle105-aggregate.tsv')
      expect(existsSync(path)).toBe(true)
      const head = readFileSync(path, 'utf-8').split('\n')[0]
      expect(head).toBe('rank\tms\ttests\tms_per_test\tfile')
    })

    it('cycle105-aggregate.tsv has 214 data rows (matching the file count headline)', () => {
      const path = join(repoRoot, '.claude/perf-tmp/cycle105-aggregate.tsv')
      const lines = readFileSync(path, 'utf-8').split('\n').filter((l) => l.length > 0)
      // 1 header + 214 file rows = 215 lines
      expect(lines.length).toBe(215)
    })
  })
})
