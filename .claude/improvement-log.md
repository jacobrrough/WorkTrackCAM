# WorkTrackCAM Improvement Log

This file is the source of truth for the autonomous improvement workflow. CLAUDE.md mandates that every cycle append an entry here with: cycle number, date, focus area, baseline metrics, changes made, tests added, results, and next-cycle recommendations.

---

## Cycle 0 — Audit follow-up (2026-04-21)
- **Focus**: Repo hygiene + public-facing docs (bootstrap cycle, not part of the regular rotation).
- **Baseline**: `npm test` → 2953 passed, 1 skipped (150 files). `npm run typecheck` → clean.
- **Changes**:
  - Restored accidentally-deleted `CLAUDE.md` from HEAD.
  - Created `README.md` (public-facing project overview).
  - Created `LICENSE` (MIT, © 2026 Jacob Rough).
  - Created `.claude/improvement-log.md` (this file) and `.claude/commands/improve.md` (playbook).
  - Added regression test for the `.cam-aligned` suffix-dedup regex at `src/main/ipc-fabrication.ts:148`.
- **Tests added**: 3 assertions in a new `describe('stl:transformForCam output path', ...)` block in `src/main/ipc-fabrication.test.ts` (base append, single-collapse, triple-collapse).
- **Results**: `npm test` → 2957 passed, 1 skipped (151 files); `npm run typecheck` → clean. Pre→post delta: +4 passed tests (3 intentional regression tests plus 1 previously-unresolved file pickup). No regressions.
- **Next cycle**: First real rotation entry. Pick `ui-polish` (next in rotation per `.claude/commands/improve.md`). Focus areas to consider: the `src/renderer/src/` drawer-based shell, design-token consistency, accessibility pass on the new brand bar.

### Notes for future cycles
- 4-axis code is being **consolidated** into `engines/cam/advanced/`, not removed. The staged deletions of `src/main/cam-axis4-*.ts` and `resources/posts/cnc_4axis_*.hbs` are intentional — `engines/cam/advanced/strategies/adaptive_clear.py` and companions now carry that logic. Update README's "4-axis" language only if this consolidation is later reversed.
- Asset filename corruption (`.cam-aligned.cam-aligned...`) was a real bug that landed in commits before this cycle. The fix (regex strip) lives at `src/main/ipc-fabrication.ts:148`. The new regression test pins it. Do **not** remove that test without a conscious decision.
