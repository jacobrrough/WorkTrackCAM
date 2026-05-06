/**
 * .claude/perf-inventory.md -- docs-drift guard [ID-0168-pin] (Cycle 81,
 * perf, 2026-04-26).
 *
 * Pins the Cycle-81 perf-inventory refresh against the file content so the
 * Cycle 25 -> Cycle 81 evolution table, the Cycle 81 headline numbers, and
 * the [ID-0169] carvera-pipeline follow-up cannot silently drift if the
 * file is later edited. This is the same paired-pin shape used by:
 *
 *   - `src/shared/edit-workflow-docs-pin.test.ts` ([ID-0089]/[ID-0095],
 *     Cycle 20) -- pins `docs/EDIT-WORKFLOW.md` against the playbook
 *     references in CLAUDE.md and `.claude/commands/improve.md`.
 *   - `src/shared/machines-docs-pin.test.ts` ([ID-0083], Cycle 15) --
 *     pins `docs/MACHINES.md` against the bundled machine profiles.
 *
 * Scope (per CLAUDE.md "My-Shop-Only Mode"):
 *   The perf-inventory is suite-wide infrastructure; it is machine-agnostic
 *   in that it covers all three target machines' test files transparently.
 *   The new top hotspot identified by Cycle 81 (`carvera-pipeline.test.ts`)
 *   IS Carvera-4-axis-specific, so this pin verifies the file referenced
 *   actually exists -- otherwise [ID-0169] is filed against a moved file.
 *
 * Failure modes this pin catches:
 *   1. Cycle 81 closure section deleted/renamed.
 *   2. Headline numbers (4118 tests / 194 files / 8.54 s) drift without
 *      being re-measured.
 *   3. The [ID-0169] follow-up reference is removed before Cycle 86 picks
 *      it up.
 *   4. The named top-hotspot file moves or is renamed.
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

describe('.claude/perf-inventory.md -- Cycle 81 refresh pin [ID-0168]', () => {
  describe('file presence and structure', () => {
    it('perf-inventory.md exists and is non-trivial', () => {
      const doc = loadPerfInventory()
      // Set a floor (not a ceiling) so future cycles can append more
      // sections without churning this pin.
      expect(doc.length).toBeGreaterThan(20000)
    })

    it('headline carries the Cycle 25 [ID-0090] origin reference', () => {
      // The file's identity stays anchored to Cycle 25 so future readers
      // know the inventory was originally seeded by [ID-0090]; later
      // cycles append refresh sections rather than rewrite the head.
      const doc = loadPerfInventory()
      expect(doc).toMatch(/^# Vitest Perf Inventory .+Cycle 25/m)
      expect(doc).toContain('[ID-0090]')
    })

    it('contains the Cycle 75 [ID-0153] closure section anchor', () => {
      // Cycle 75 was the worker-pool tuning win that the Cycle 81 refresh
      // measures the durability of. If the Cycle 75 anchor disappears,
      // the side-by-side table in the Cycle 81 section loses its
      // baseline reference.
      const doc = loadPerfInventory()
      expect(doc).toMatch(/^## Cycle 75 closure .+\[ID-0153\] vitest worker-pool tuning/m)
    })

    it('contains the Cycle 81 refresh closure section anchor', () => {
      const doc = loadPerfInventory()
      expect(doc).toMatch(
        /^## Cycle 81 refresh \(2026-04-26T12:40:00Z\) -- post-Cycle-75 inventory re-baseline/m
      )
    })
  })

  describe('Cycle 81 headline numbers (paired pin against Cycle 25 baseline)', () => {
    it('side-by-side table documents Cycle 25 -> Cycle 81 totals', () => {
      const doc = loadPerfInventory()
      // The headline-metrics table row identifying the file-count and
      // test-count growth -- if the suite shape changes substantively the
      // row must be updated in the same cycle.
      expect(doc).toContain('| Total test files | 166 | **194** | +28 (+16.9%) |')
      expect(doc).toContain('| Total tests | 3378 | **4118** | +740 (+21.9%) |')
    })

    it('side-by-side table documents per-file wall-clock evolution', () => {
      const doc = loadPerfInventory()
      // Sum of per-file ms (parallel-overlapped) and mean per-file ms.
      expect(doc).toContain(
        '| Sum per-file ms (parallel-overlapped) | 5808 | **3169** | -2639 (-45.4%) |'
      )
      expect(doc).toContain('| Mean per-file ms | 35.0 | **16.3** | -18.7 (-53.4%) |')
    })

    it('side-by-side table documents tail-percentile shrinkage', () => {
      const doc = loadPerfInventory()
      expect(doc).toContain('| p50 per-file ms | 5 | **2** | -3 (-60.0%) |')
      expect(doc).toContain('| p90 per-file ms | 52 | **25** | -27 (-51.9%) |')
      expect(doc).toContain('| p99 per-file ms | 902 | **276** | -626 (-69.4%) |')
    })

    it('side-by-side table documents full-suite [ID-0066] resolution', () => {
      const doc = loadPerfInventory()
      // The headline 8.54 s wall-clock is the post-Cycle-75 amortized
      // baseline. The [ID-0066] reference must remain visible because
      // it's how Cycle 75 closed the sandbox-budget overrun.
      expect(doc).toContain(
        '| Full `npm test` wall-clock | >45 s ([ID-0066] cap) | **8.54 s** ([ID-0066] resolved) | -36 s+ (-81%+) |'
      )
    })

    it('threshold buckets table documents the >500 ms reduction', () => {
      const doc = loadPerfInventory()
      // Cycle 25 had 3 files >500 ms; Cycle 81 has 1 (the new top
      // hotspot). The >1.0 s bucket emptied entirely.
      expect(doc).toContain('| > 1.0 s   | 1 | **0** | -1')
      expect(doc).toContain('| > 500 ms  | 3 | **1** | -2 |')
      expect(doc).toContain('| > 250 ms  | 5 | **3** | -2 |')
      expect(doc).toContain('| > 100 ms  | 11 | **7** | -4 |')
    })
  })

  describe('Cycle 81 top-25 ranking integrity', () => {
    it('rank 1 is carvera-pipeline.test.ts at 589 ms (the new top hotspot)', () => {
      const doc = loadPerfInventory()
      // Exact rank-1 row signature so a re-rank that doesn't update the
      // table fails this assertion.
      expect(doc).toContain(
        '| 1 | 589 | 16 | 36.8 | `src/main/cam-axis4/__tests__/carvera-pipeline.test.ts` |'
      )
    })

    it('rank 2 is subprocess-bounded.test.ts at 286 ms', () => {
      const doc = loadPerfInventory()
      expect(doc).toContain(
        '| 2 | 286 | 11 | 26.0 | `src/main/subprocess-bounded.test.ts` |'
      )
    })

    it('rank 3 is the cam-axis4 integration test at 276 ms', () => {
      const doc = loadPerfInventory()
      expect(doc).toContain(
        '| 3 | 276 | 5 | 55.2 | `src/main/cam-axis4/__tests__/integration.test.ts` |'
      )
    })

    it('Cycle 25 hotspot evolution table tracks all five tracked files', () => {
      const doc = loadPerfInventory()
      // The "How Cycle 25 hotspots evolved" table holds the historical
      // shave breadcrumbs (Cycle 41 / 46 / 54 / 75). Removing any row
      // would lose the cross-cycle context.
      expect(doc).toContain('| `moonraker-push.test.ts` | 1012 | 206 | -806 (-79.6%) |')
      expect(doc).toContain(
        '| `cam-axis4/__tests__/integration.test.ts` | 902 | 276 | -626 (-69.4%) |'
      )
      expect(doc).toContain(
        '| `subprocess-bounded.test.ts` | 683 | 286 | -397 (-58.1%) |'
      )
      expect(doc).toContain(
        '| `cam-pipeline-integration.test.ts` | 275 | 211 | -64 (-23.3%) |'
      )
      expect(doc).toContain(
        '| `post-process-safety.test.ts` | 394 | 54 | -340 (-86.3%) |'
      )
    })
  })

  describe('[ID-0169] follow-up filing integrity', () => {
    it('Cycle 81 section files [ID-0169] for the carvera-pipeline shave', () => {
      const doc = loadPerfInventory()
      expect(doc).toMatch(
        /^### \[ID-0169\] FILED -- carvera-pipeline\.test\.ts shave investigation/m
      )
    })

    it('[ID-0169] body cites the documented profile-read hoist optimization', () => {
      const doc = loadPerfInventory()
      // The hoist proposal (parseMachineProfileText into beforeAll) is
      // the actionable handle the next perf-rotation cycle will pull.
      // If the proposal is removed without [ID-0169] being closed, the
      // ticket loses its actionable description.
      expect(doc).toContain('parseMachineProfileText()')
      expect(doc).toContain('beforeAll')
    })

    it('[ID-0169] body documents the estimated savings ceiling', () => {
      const doc = loadPerfInventory()
      // The "16 x ~5 ms = ~80 ms total" figure sets reader expectation
      // that this is a quick-win, not a transformational shave. Future
      // pulls should not over-invest.
      expect(doc).toContain('16 x ~5 ms = ~80 ms total file shave')
    })

    it('[ID-0169] body documents the pre-shave verification protocol', () => {
      const doc = loadPerfInventory()
      // Per CLAUDE.md Safety Rule 1 (G-code is sacred) the shave can only
      // ship if equivalence with the per-test parse holds. Pin the
      // documented protocol so future cycles don't skip it.
      expect(doc).toContain('snapshot byte-equality assertion')
      expect(doc).toContain('load-bearing per-test parse')
    })
  })

  describe('referenced files actually exist on disk', () => {
    it('rank-1 hotspot src/main/cam-axis4/__tests__/carvera-pipeline.test.ts exists', () => {
      const path = join(repoRoot, 'src/main/cam-axis4/__tests__/carvera-pipeline.test.ts')
      expect(existsSync(path)).toBe(true)
      // And it's a non-trivial file (not an empty stub left behind by a
      // refactor) -- the [ID-0169] shave investigation needs real content
      // to inspect.
      expect(statSync(path).size).toBeGreaterThan(10000)
    })

    it('rank-2 hotspot src/main/subprocess-bounded.test.ts exists', () => {
      const path = join(repoRoot, 'src/main/subprocess-bounded.test.ts')
      expect(existsSync(path)).toBe(true)
      expect(statSync(path).size).toBeGreaterThan(1000)
    })

    it('rank-3 hotspot src/main/cam-axis4/__tests__/integration.test.ts exists', () => {
      const path = join(repoRoot, 'src/main/cam-axis4/__tests__/integration.test.ts')
      expect(existsSync(path)).toBe(true)
      expect(statSync(path).size).toBeGreaterThan(1000)
    })

    it('Cycle 81 reproducer artifacts are saved under .claude/perf-tmp/', () => {
      // The four reproducer files cited in the "Reproducer (saved data)"
      // closing block. If any disappears, the inventory's "How to
      // reproduce this inventory" claim is broken.
      const tmp = join(repoRoot, '.claude/perf-tmp')
      expect(existsSync(join(tmp, 'cycle81-shared.json'))).toBe(true)
      expect(existsSync(join(tmp, 'cycle81-main.json'))).toBe(true)
      expect(existsSync(join(tmp, 'cycle81-renderer.json'))).toBe(true)
      expect(existsSync(join(tmp, 'cycle81-aggregate.tsv'))).toBe(true)
    })
  })

  describe('cross-cycle continuity', () => {
    it('Cycle 81 section still references the pre-Cycle-75 [ID-0066] sandbox-budget framing', () => {
      const doc = loadPerfInventory()
      // The sandbox-budget framing is what motivated Cycle 75's
      // worker-pool tuning. Future cycles that delete the [ID-0066]
      // anchor would lose the historical motivation.
      expect(doc).toContain('[ID-0066] 45-s sandbox budget')
    })

    it('Cycle 81 closure conclusion is healthy-steady-state', () => {
      const doc = loadPerfInventory()
      // The conclusion's tone matters: the Cycle 81 cycle is NOT a fix
      // cycle, it's a measurement cycle that confirms Cycle 75's win is
      // holding. Future cycles must not rewrite this conclusion to imply
      // urgency without re-measuring.
      expect(doc).toContain('The suite is in a healthy steady-state perf regime.')
      expect(doc).toContain('zero regression')
    })

    it('Cycle 81 status line emits the expected DISCOVERED-TODAY hand-off', () => {
      const doc = loadPerfInventory()
      // The status line must hand [ID-0168] (refresh deliverable) and [ID-0169] (carvera shave) off so
      // the daily plan / roadmap reconciler picks it up.
      expect(doc).toMatch(
        /Status: \*\*\[ID-0168\] BACKLOG -> COMPLETED\*\* on this cycle \(perf-inventory refresh deliverable\)\. \*\*\[ID-0169\] new in DISCOVERED-TODAY\*\* \(perf: carvera-pipeline\.test\.ts profile-read hoist\)/
      )
    })
  })
})
