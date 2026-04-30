#!/usr/bin/env node
// scripts/sandbox-bootstrap.mjs
//
// Idempotent sandbox bootstrap for the autonomous-improvement workflow.
//
// Resolves the [ID-0147] (`engineering` plugin daily-inventory worker found
// `python3 -m pytest` unavailable in the hourly-task sandbox) limitation by
// installing pytest into the sandbox user-site on demand. Safe to run
// repeatedly — exits early when pytest is already importable.
//
// Why this script exists:
//   - The autonomous workers (`worktrackcam-daily-inventory-plan` +
//     `worktrackcam-hourly-implementation`) run inside Cowork sandboxes
//     where pytest is NOT pre-installed. Without it, Safety Rule 5
//     (real-STL Python engine validation) can't run, leaving Python
//     CAM engine edits effectively un-gated.
//   - Each sandbox session is ephemeral: pytest installed in one session
//     does not persist into the next. The fix is to make installation
//     a no-cost pre-flight step rather than a manual setup ritual.
//   - On hosts where pytest is already on PATH (developer machines,
//     CI runners), this script is a 200ms importability check + exit.
//
// What it does:
//   1. Tries `python3 -c "import pytest"`. If exit 0, prints version + exits.
//   2. Otherwise, runs `python3 -m pip install --user --quiet pytest`. If
//      that fails with EXTERNALLY-MANAGED (PEP 668), retries with the
//      `--break-system-packages` escape hatch — the sandbox is single-tenant
//      so PEP 668 isolation has no value here.
//   3. Re-verifies import works post-install. Fails loud if it doesn't.
//
// Usage:
//   npm run bootstrap:python
//   (or directly: node scripts/sandbox-bootstrap.mjs)

import { spawnSync } from 'node:child_process'

const PYTHON = process.env.PYTHON || 'python3'

function checkImport() {
  const result = spawnSync(PYTHON, ['-c', 'import pytest, sys; sys.stdout.write(pytest.__version__)'], {
    encoding: 'utf8',
  })
  if (result.status === 0) {
    return result.stdout.trim()
  }
  return null
}

function tryPipInstall(extraFlags) {
  const args = ['-m', 'pip', 'install', '--user', '--quiet', 'pytest', ...extraFlags]
  const result = spawnSync(PYTHON, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  }
}

function main() {
  const existing = checkImport()
  if (existing) {
    process.stdout.write(`[sandbox-bootstrap] pytest ${existing} already importable -- skipping install.\n`)
    return 0
  }

  process.stdout.write('[sandbox-bootstrap] pytest not importable. Installing into user-site...\n')

  // First attempt: vanilla --user install. Works on most hosts.
  let install = tryPipInstall([])
  if (install.status !== 0) {
    const externallyManaged =
      install.stderr.includes('externally-managed-environment') ||
      install.stderr.includes('externally managed') ||
      install.stderr.includes('PEP 668')
    if (externallyManaged) {
      process.stdout.write('[sandbox-bootstrap] PEP 668 externally-managed -- retrying with --break-system-packages.\n')
      install = tryPipInstall(['--break-system-packages'])
    }
  }

  if (install.status !== 0) {
    process.stderr.write('[sandbox-bootstrap] pip install pytest FAILED.\n')
    process.stderr.write(install.stderr || '(no stderr)\n')
    return install.status ?? 1
  }

  const verified = checkImport()
  if (!verified) {
    process.stderr.write('[sandbox-bootstrap] post-install import check FAILED -- pytest still not importable.\n')
    return 2
  }

  process.stdout.write(`[sandbox-bootstrap] pytest ${verified} installed and verified.\n`)
  return 0
}

process.exit(main())
