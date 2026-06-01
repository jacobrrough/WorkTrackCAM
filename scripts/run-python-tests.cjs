#!/usr/bin/env node
/**
 * Cross-platform Python test runner for WorkTrackCAM.
 *
 * Re-adds `npm run test:python` (removed during the 2026-05-27 pivot
 * away from the FreeCAD addon path). Runs pytest against:
 *   - engines/sidecar/__tests__/        (CadQuery JSON-RPC handlers)
 *   - engines/cam/advanced/tests/       (OpenCAMLib strategies, if present)
 *
 * Behavior:
 *   1. Detect the Python interpreter (python3 → python → py -3 on Windows).
 *   2. Probe for pytest. If missing, attempt one bootstrap install:
 *      `python -m pip install pytest --break-system-packages` (matches the
 *      Cycle 5 [ID-0147-cleared] pattern from .claude/improvement-log.md).
 *      If install also fails, print a clear remediation line and exit 1.
 *   3. Run pytest with `-q` and propagate the exit code so CI can gate on it.
 *
 * No third-party Node deps — child_process only — so this script is safe
 * to invoke from any npm-scripts context.
 */

'use strict'

const { spawnSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

const REPO_ROOT = path.resolve(__dirname, '..')

/** Resolve a Python interpreter that exists on PATH. */
function findPython() {
  // On Windows the canonical launcher is `py -3`, but `python` usually also
  // resolves to a Python 3 install. On POSIX `python3` is preferred and
  // `python` may not exist at all. Probe in this order.
  const candidates =
    process.platform === 'win32'
      ? [
          { cmd: 'python', args: [] },
          { cmd: 'py', args: ['-3'] },
          { cmd: 'python3', args: [] }
        ]
      : [
          { cmd: 'python3', args: [] },
          { cmd: 'python', args: [] }
        ]

  for (const candidate of candidates) {
    const probe = spawnSync(candidate.cmd, [...candidate.args, '--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
    if (probe.status === 0) {
      const versionLine = (probe.stdout || probe.stderr || '').trim()
      return { ...candidate, version: versionLine }
    }
  }
  return null
}

/** Probe whether pytest is importable under the resolved interpreter. */
function hasPytest(py) {
  const probe = spawnSync(
    py.cmd,
    [...py.args, '-c', 'import pytest, sys; sys.stdout.write(pytest.__version__)'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  )
  if (probe.status !== 0) return null
  return (probe.stdout || '').trim() || 'unknown'
}

/**
 * Bootstrap pytest if missing. Matches the [ID-0147-cleared] Cycle 5
 * sandbox pattern. Returns `true` on success, `false` if install failed.
 */
function bootstrapPytest(py) {
  process.stderr.write(
    '[test:python] pytest not found — attempting one-shot bootstrap via ' +
      `\`${py.cmd} -m pip install pytest --break-system-packages\`.\n`
  )
  const install = spawnSync(
    py.cmd,
    [...py.args, '-m', 'pip', 'install', '--quiet', 'pytest', '--break-system-packages'],
    { encoding: 'utf8', stdio: 'inherit' }
  )
  if (install.status !== 0) {
    // Retry once without --break-system-packages for environments (older
    // pip / venv) that reject the flag.
    const retry = spawnSync(
      py.cmd,
      [...py.args, '-m', 'pip', 'install', '--quiet', 'pytest'],
      { encoding: 'utf8', stdio: 'inherit' }
    )
    if (retry.status !== 0) {
      return false
    }
  }
  return hasPytest(py) !== null
}

function main() {
  const py = findPython()
  if (!py) {
    process.stderr.write(
      '[test:python] No Python interpreter found on PATH. Install Python 3.10+ ' +
        '(https://www.python.org/downloads/) and re-run.\n'
    )
    process.exit(1)
  }

  let pytestVersion = hasPytest(py)
  if (pytestVersion === null) {
    const ok = bootstrapPytest(py)
    if (!ok) {
      process.stderr.write(
        '[test:python] Could not install pytest automatically. Run manually:\n' +
          `  ${py.cmd} -m pip install pytest --break-system-packages\n` +
          'Then re-run `npm run test:python`.\n'
      )
      process.exit(1)
    }
    pytestVersion = hasPytest(py)
  }

  // Build the list of test directories that actually exist on disk. The
  // 2026-05-27 pivot deleted engines/cam/advanced/tests/, so we only
  // include it if it's still present (defensive — the cam-engine cycles
  // may restore it later).
  const candidates = [
    path.join(REPO_ROOT, 'engines', 'sidecar', '__tests__'),
    path.join(REPO_ROOT, 'engines', 'cam', 'advanced', 'tests')
  ]
  const targets = candidates.filter((p) => {
    try {
      return fs.statSync(p).isDirectory()
    } catch {
      return false
    }
  })

  if (targets.length === 0) {
    process.stderr.write(
      '[test:python] No Python test directories found under engines/. Nothing to run.\n'
    )
    process.exit(0)
  }

  process.stdout.write(
    `[test:python] ${py.version}, pytest ${pytestVersion}\n` +
      `[test:python] running: pytest -q ${targets
        .map((t) => path.relative(REPO_ROOT, t).replace(/\\/g, '/'))
        .join(' ')}\n`
  )

  const result = spawnSync(py.cmd, [...py.args, '-m', 'pytest', '-q', ...targets], {
    cwd: REPO_ROOT,
    stdio: 'inherit'
  })

  // Propagate pytest's exit code so CI / npm-scripts can gate on it.
  process.exit(result.status === null ? 1 : result.status)
}

main()
