#!/usr/bin/env bash
#
# scripts/commit-bundled-snapshot.sh
#
# One-shot helper for [ID-0011] / [ID-0056] -- the bundled commit covering
# the post-Cycle-4-through-Cycle-215+ working tree (paired-pin contract
# buildout, three-environment rework, audit follow-up, sandbox bootstrap,
# tempdir-purge wiring, and assorted docs).
#
# WHY THIS SCRIPT EXISTS:
#   The autonomous-improvement sandbox is enforcement-blocked from removing
#   `.git/index.lock` (a stale 0-byte file from 2026-04-21). The file is
#   visible to `stat` and present to git ("Another git process seems to
#   be running in this repository"), but `rm -f` returns "Operation not
#   permitted" inside the sandbox. The fix has to happen on the host.
#
# HOW TO USE:
#   1. Open a terminal on your host machine (PowerShell / Git Bash / etc.)
#   2. cd into the project root: `cd "C:\Users\jrrou\3d software\WorkTrackCAM"`
#   3. Run: `bash scripts/commit-bundled-snapshot.sh`
#      -- on Windows without bash, run the equivalent commands manually
#         from the body of this script.
#
# WHAT IT DOES (in order):
#   1. Removes .git/index.lock (must succeed on the host).
#   2. Verifies the working tree is what you expect (`git status --short` count).
#   3. Stages everything with `git add -A`.
#   4. Commits with the full bundled message captured in this script.
#   5. Prints `git log --oneline -3` so you can confirm the commit landed.
#
# WHAT IT DOES NOT DO:
#   - Push to a remote. The commit is local-only. `git push` after if you want.
#   - Sign the commit. Add `-S` to the commit invocation if you sign.
#   - Run tests. Pre-flight gates were already green at 2026-04-30T17:50Z
#     (vitest 12918/0/1, tsc 0, pytest 133/0). Re-run if you want belt-and-braces.

set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .git/index.lock ]; then
  echo "[commit-bundled] removing stale .git/index.lock..."
  rm -f .git/index.lock
fi

if [ -f .git/index.lock ]; then
  echo "[commit-bundled] FAILED to remove .git/index.lock. Aborting." >&2
  exit 1
fi

CHANGE_COUNT="$(git status --short | wc -l | tr -d ' ')"
echo "[commit-bundled] working tree has ${CHANGE_COUNT} changes."

if [ "${CHANGE_COUNT}" -lt 200 ]; then
  echo "[commit-bundled] WARNING: expected ~280-300 changes (post-Cycle-215+ buildout)." >&2
  echo "[commit-bundled] Found ${CHANGE_COUNT}. Continuing in 5 s -- Ctrl-C to abort." >&2
  sleep 5
fi

echo "[commit-bundled] staging all changes..."
git add -A

echo "[commit-bundled] committing..."
git commit -m "Cycle 4 through Cycle 215+: paired-pin buildout, three-env rework, sandbox bootstrap

This bundled commit captures the post-Cycle-4-through-Cycle-215+ working
tree from the autonomous-improvement workflow (.claude/improvement-log.md
is the cycle-by-cycle source of truth for the individual changes).

Highlights:

- 200+ paired-pin contract test files across src/shared, src/main, and
  src/renderer locking down per-machine invariants for the three target
  machines (Creality K2 Plus, Laguna Swift 5x10, Makera Carvera 3-axis +
  4th Axis Rotary). Coverage rose from ~7900 vitest assertions at the
  start of Cycle 4 to 12918 by Cycle 215 close (+5000 over 211 cycles).

- Three-environment renderer rework (VCarve Pro / Creality Print / Makera
  CAM) with quick-switch shell, brand-bar machine badge, drawer-based
  Library/Settings, and saved presets per environment.

- Safety-relevant shared modules pinned: rotary-collision, probing-cycles,
  cam-voxel-removal-proxy, gcode-safe-z-retract-invariants, gcode-dialect-
  compliance, gcode-temp-validator, and the four bundled machine
  profiles + four production posts.

- Sandbox bootstrap landed (scripts/sandbox-bootstrap.mjs, package.json
  scripts updated) so npm run test:python works cold from a fresh
  sandbox -- Safety Rule 5 (real-STL Python validation) is now executable
  by autonomous workers. Closes [ID-0147].

- docs/EDIT-WORKFLOW.md, docs/MACHINES.md, docs/CAM_4TH_AXIS_REFERENCE.md
  written and maintained through 32 [ID-0067] data refreshes.

- Tempdir-purge wired into .claude/commands/improve.md cycle close-out
  to keep sandbox /tmp pressure from pinning subsequent cycles
  ([ID-0294]).

Quality gates at commit time:
- vitest: 12918 passed / 1 skipped / 0 failed (313 files, 13.91 s)
- tsc --noEmit: exit 0
- pytest engines/cam/advanced/tests/: 133 passed in 2.11 s

This is bookkeeping for the autonomous-improvement workflow; the
substantive changes are documented per-cycle in .claude/improvement-log.md
(cycles 5 through 215+) and per-day in .claude/daily-plans/."

echo
echo "[commit-bundled] done. Recent commits:"
git log --oneline -3
