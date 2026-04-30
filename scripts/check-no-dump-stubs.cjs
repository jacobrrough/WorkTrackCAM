#!/usr/bin/env node
// scripts/check-no-dump-stubs.cjs -- [ID-0150] Cycle 111
//
// Pretest gate. Fails CI if dump-style scratch files reappear in the working
// tree. These are stale debugging artifacts (Cycle 37 [ID-0110] originally)
// that should never persist past the cycle that created them.
//
// Forbidden patterns:
//   1. project root: ^dump-.*\.mjs$
//   2. anywhere under src/: filenames matching ^_dump.*\.(test\.)?(tsx?|mjs|js)$
//
// Allowlist -- known-vestigial files that the current sandbox cannot unlink
// (read-only bind-mount returns "Operation not permitted" on rm). They MUST
// be deleted in a future environment that allows rm; until then they're
// grandfathered in. Adding to this list requires a one-line justification
// comment naming the cycle that created the file and the cycle that will
// remove it.
//
//   - dump-laguna.mjs                 (root, Cycle 37 [ID-0110]; awaiting rm-capable env)
//   - src/main/_dump.test.ts          (Cycle 37 [ID-0110]; awaiting rm-capable env)
//   - dump-test-violation.mjs         (root, Cycle 111 [ID-0150] verification
//                                      probe -- created by `touch` to prove the
//                                      gate fires, then wedged in the tree by
//                                      the same read-only bind-mount that
//                                      blocks the other two; awaiting rm-capable env)
//
// Exit codes:
//   0 -- clean (no NEW dump stubs)
//   1 -- at least one non-allowlisted match found (with paths printed)

'use strict'

const fs = require('node:fs')
const path = require('node:path')

const PROJECT_ROOT = path.resolve(__dirname, '..')

// Paths are normalized to POSIX-style relative paths from PROJECT_ROOT for
// stable allowlist comparison across Windows/POSIX hosts.
const ALLOWLIST = new Set([
  'dump-laguna.mjs',
  'src/main/_dump.test.ts',
  'dump-test-violation.mjs'
])

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'out',
  'build',
  '.git',
  'coverage',
  '.vite',
  '.cache'
])

const ROOT_DUMP_PATTERN = /^dump-.*\.mjs$/
const SRC_DUMP_PATTERN = /^_dump.*\.(test\.)?(tsx?|mjs|cjs|js)$/

const violations = []

function relPosix(absPath) {
  return path.relative(PROJECT_ROOT, absPath).split(path.sep).join('/')
}

// 1. Project-root dump-*.mjs scan (non-recursive; only the literal root).
for (const entry of fs.readdirSync(PROJECT_ROOT, { withFileTypes: true })) {
  if (!entry.isFile()) continue
  if (!ROOT_DUMP_PATTERN.test(entry.name)) continue
  if (ALLOWLIST.has(entry.name)) continue
  violations.push(entry.name)
}

// 2. src/** _dump* recursive scan.
function walk(dir) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch (err) {
    if (err && err.code === 'ENOENT') return
    throw err
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.') continue
    if (SKIP_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full)
      continue
    }
    if (!entry.isFile()) continue
    if (!SRC_DUMP_PATTERN.test(entry.name)) continue
    const rel = relPosix(full)
    if (ALLOWLIST.has(rel)) continue
    violations.push(rel)
  }
}

const SRC_DIR = path.join(PROJECT_ROOT, 'src')
if (fs.existsSync(SRC_DIR)) walk(SRC_DIR)

if (violations.length > 0) {
  process.stderr.write('[ID-0150] check-no-dump-stubs FAILED:\n')
  for (const v of violations) {
    process.stderr.write('  - ' + v + '\n')
  }
  process.stderr.write('\n')
  process.stderr.write('Dump-style scratch files have reappeared in the working tree.\n')
  process.stderr.write('These are stale debugging artifacts that should never be committed.\n')
  process.stderr.write('Either delete them, or extend the allowlist in scripts/check-no-dump-stubs.cjs\n')
  process.stderr.write('with a justifying comment that names the cycle and the removal plan.\n')
  process.exit(1)
}

process.exit(0)
