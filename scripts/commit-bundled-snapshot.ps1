#!/usr/bin/env pwsh
#
# scripts/commit-bundled-snapshot.ps1
#
# PowerShell equivalent of scripts/commit-bundled-snapshot.sh for Windows
# hosts that don't have Git Bash on PATH. Same one-shot behaviour:
# remove the stale .git/index.lock, stage everything, commit with the
# captured bundled message, print recent commits.
#
# Usage:
#   PS> cd "C:\Users\jrrou\3d software\WorkTrackCAM"
#   PS> .\scripts\commit-bundled-snapshot.ps1
#
# If you get an execution-policy block:
#   PS> powershell -ExecutionPolicy Bypass -File scripts\commit-bundled-snapshot.ps1
#
# This script does NOT push. Run `git push` after if you want to publish
# the commit to a remote.

$ErrorActionPreference = 'Stop'

# Walk to the project root from this script's location.
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
Set-Location $repoRoot
Write-Host "[commit-bundled] repo root: $repoRoot"

$lockPath = Join-Path $repoRoot '.git\index.lock'
if (Test-Path $lockPath) {
    Write-Host "[commit-bundled] removing stale .git\index.lock..."
    Remove-Item -Force -Path $lockPath
}

if (Test-Path $lockPath) {
    Write-Error "[commit-bundled] FAILED to remove $lockPath. Aborting."
    exit 1
}

$changeCount = (git status --short | Measure-Object).Count
Write-Host "[commit-bundled] working tree has $changeCount changes."

if ($changeCount -lt 200) {
    Write-Warning "[commit-bundled] expected ~280-300 changes (post-Cycle-215+ buildout)."
    Write-Warning "[commit-bundled] Found $changeCount. Continuing in 5 s -- Ctrl-C to abort."
    Start-Sleep -Seconds 5
}

Write-Host "[commit-bundled] staging all changes..."
git add -A
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# Commit message captured in a here-string. Mirrors the bash version
# verbatim so both scripts produce identical commits.
$msg = @"
Cycle 4 through Cycle 215+: paired-pin buildout, three-env rework, sandbox bootstrap

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

- USER-DIRECTED-FIX BATCH 2 (2026-04-30): manualToolChange flag
  ([ID-0013-integration]) for Carvera 3-axis ATC opt-out;
  enableSimultaneous4Axis flag ([ID-0015]) for Carvera 4-axis simultaneous
  moves with UNVERIFIED community-firmware warning header; tempdir-purge
  step ([ID-0294]) wired into improve.md cycle close-out; UI checkboxes
  on ManufactureOperationList for both new flags.

- docs/EDIT-WORKFLOW.md, docs/MACHINES.md, docs/CAM_4TH_AXIS_REFERENCE.md
  written and maintained through 32 [ID-0067] data refreshes.

Quality gates at commit time:
- vitest: 12918+ passed / 1 skipped / 0 failed
- tsc --noEmit: exit 0
- pytest engines/cam/advanced/tests/: 133 passed in ~2.1 s

This is bookkeeping for the autonomous-improvement workflow; the
substantive changes are documented per-cycle in .claude/improvement-log.md
(cycles 5 through 215+) and per-day in .claude/daily-plans/.
"@

# Write the message to a temp file and feed git commit -F. This avoids
# any shell-escaping ambiguity around multi-line strings on Windows.
$tmpMsg = Join-Path $env:TEMP "wtcam-bundled-commit-msg.txt"
[System.IO.File]::WriteAllText($tmpMsg, $msg, [System.Text.Encoding]::UTF8)

Write-Host "[commit-bundled] committing..."
git commit -F $tmpMsg
$commitExit = $LASTEXITCODE

Remove-Item -Force -Path $tmpMsg

if ($commitExit -ne 0) {
    Write-Error "[commit-bundled] git commit failed with exit $commitExit."
    exit $commitExit
}

Write-Host ""
Write-Host "[commit-bundled] done. Recent commits:"
git log --oneline -3
