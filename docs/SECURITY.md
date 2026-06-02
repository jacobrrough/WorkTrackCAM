# WorkTrackCAM — Security Posture & Dependency Advisory Tracking

**Last updated**: 2026-06-02
**Owner**: dependency-security workflow (DEP stack)

This doc is the source of truth for WorkTrackCAM's security posture: which
published advisories are **closed**, which are **knowingly deferred** (with
the reason and the conditions under which they would be re-evaluated), and
the cadence we run security gates on. If you bump a dep, run `npm audit`,
and a new entry appears, decide here whether to fix or defer it.

The live source of truth for *open* advisories is the GitHub Dependabot
dashboard for this repo:

  https://github.com/jacobrrough/WorkTrackCAM/security/dependabot

The numbers in this file are a snapshot in time; the dashboard is real-time.

---

## TL;DR — Current State (2026-06-02 snapshot)

| Severity | Open | Notes |
|----------|-----:|-------|
| Critical |    0 | vitest CVE GHSA-5xrq-8626-4rwp closed (vitest 3 → 4.1.8) in a prior wave. |
| High     |    0 | **electron-builder 25.1.8 → 26.8.1** dropped the dev-only `tar`/`cacache` subtree (−141 packages); the high chain is closed. |
| Moderate |    0 | DOMPurify forced via `overrides`; the prior Monaco/bundler advisories are no longer reported by the current lockfile. |
| Low      |    0 | `@tootallnate/once` closed in a prior wave. |
| **Total**| **0** | `npm audit` **and** `npm audit --omit=dev` both report **0 vulnerabilities** (verified 2026-06-02). |

**Runtime / user-shipping advisory count: 0. Full dev+prod advisory count: 0.**

The electron-builder 26.8.1 bump (this wave) closed the last open chain — the
dev-only `tar`/`cacache` path that electron-builder 25 pulled in transitively.
`npm audit` now reports a clean tree across dev **and** prod.

---

## Closed advisories (recent)

### Critical — vitest GHSA-5xrq-8626-4rwp (closed in commit 61fb5fa)
- **Bump**: vitest `^3.0.0` → `^4.1.8`, plus `@vitest/coverage-v8 ^4.1.8`.
- **Why critical**: vitest 3.x exposed a remote code execution path through
  its dev server (`vite-node`) when the test harness was reachable on a
  non-localhost interface. Anyone running `npm run test` in a network-
  reachable container would have been vulnerable.
- **Validation**: 14000+ vitest cases re-ran clean after the major-version
  bump; only a handful of `expect.toEqual` signature changes (4.x is
  stricter on optional fields) needed to be reconciled, and those edits
  are visible in the commit.
- **Status**: **CLOSED**. No further action.

### High — electron-builder / tar chain (closed via the 26.8.1 bump)
- **Bump**: `electron-builder` `^25.1.8` → `^26.8.1` (devDependency).
- **Why high**: electron-builder 25 pulled a deprecated transitive `tar` /
  `cacache` subtree (via `@electron/rebuild` → node-gyp → tar,
  `app-builder-lib`, `make-fetch-happen` → cacache) carrying path-traversal
  and symlink-poisoning advisories. The attack surface was **dev-only** (an
  attacker would have to control a `tar` archive extracted on the build host
  during `npm run build`); none of it shipped in the packaged installer.
- **What changed**: `npm install` on v26 **removed 141 packages**, added 31,
  changed 43 (478 total). The deprecated tar/cacache chain is gone.
- **Validation**: `npm audit` → **0**; `npm audit --omit=dev` → **0**
  (2026-06-02). On the current `main` base the bump alone was sufficient — no
  `fast-check` declaration or `overrides` entry was needed (contrary to an
  earlier exploratory branch built off an older base). electron-builder is a
  build tool, not imported by app/test code, so the full vitest suite (14427)
  + `tsc` are unaffected.
- **Every v26 breaking change maps to config this repo does not use**: Windows
  signing moved to `win.signtoolOptions` (repo is unsigned), `linux.desktop`
  object form (repo has icon only), macOS notarization env vars (icon only),
  ASAR-integrity defaults (fuse not enabled). `minimatch@10` glob semantics are
  the only live risk → verified the `files`/`extraResources` globs still pack
  `engines/` + `resources/orca-slicer/win32-x64`.
- **Regression guard**: `src/main/electron-builder-config-pin.test.ts` pins the
  `"build"` block shape and the `^26.` devDep floor.
- **Remaining step (owner)**: run `npm run build` on Windows 11 to confirm the
  v26 toolchain still produces a working `WorkTrackCAM-0.1.0-Setup.exe`.
- **Status**: **CLOSED** (advisories). NSIS installer smoke is pending the
  owner's build run — the only piece that needs the Windows host.

### Moderate — DOMPurify (closed in prior wave via npm overrides)
- **Bump**: forced `dompurify@^3.4.7` via the `overrides` block in
  `package.json` to cover 7 advisories (GHSA-v2wj-7wpq-c8vv,
  GHSA-cjmm-f4jc-qw8r, GHSA-cj63-jhhr-wcxv, GHSA-39q2-94rc-95cp,
  GHSA-h7mw-gpvr-xq4m, GHSA-crv5-9vww-q3g8, GHSA-v9jr-rg53-9pgp,
  GHSA-h8r8-wccr-v5f2). Monaco 0.55.1 declares `dompurify@3.2.7`; the
  override forces every resolution to 3.4.7+ without downgrading Monaco.
- **Validation**: `npm ls dompurify --all` confirms the resolution.
- **Status**: **CLOSED** (override stays until Monaco ships a release that
  declares dompurify ≥ 3.4.0 directly).

### Moderate / Low — safe transitive bumps (prior wave)
`npm audit fix` (no `--force`) rolled these forward as lockfile-only diffs:

| Package              | Before  | After   | Advisory(s) closed |
|----------------------|---------|---------|--------------------|
| `@tootallnate/once`  | 2.0.0   | 2.0.1   | GHSA-vpq2-c234-7xj6 (low) |
| `@xmldom/xmldom`     | 0.8.12  | 0.8.13  | 4× high (transitive of electron-builder) |
| `brace-expansion`    | 5.0.5   | 5.0.6   | GHSA-jxxr-4gwj-5jf2 (moderate) |
| `ip-address`         | 10.1.0  | 10.2.0  | (moderate) |
| `nanoid`             | 3.3.11  | 3.3.12  | (transitive via postcss) |
| `postcss`            | 8.5.8   | 8.5.15  | (moderate) |
| `tmp`                | 0.2.5   | 0.2.7   | GHSA-ph9p-34f9-6g65 (high — path traversal) |

`package.json` was untouched for these. Verify with `git diff package-lock.json`.

---

## Deferred advisories — and why

**None currently open.** `npm audit` reports a clean tree (dev + prod) as of
2026-06-02. The two long-standing deferrals are now resolved:

- **electron-builder / tar chain (was 9–10 high, dev-only)** — CLOSED by the
  26.8.1 bump (see the Closed section above). The previous deferral rationale
  ("don't bump the build tool right before pre-launch") no longer applies now
  that pre-launch hardening is underway; the bump landed with `npm audit` == 0
  and the installer smoke deferred to the owner's Windows build run.
- **Monaco editor bundler chain (was moderate, dev-only)** — no longer reported
  by the current lockfile (resolved by transitive bumps during prior installs).
  The `dompurify@^3.4.7` override remains in place as a **preventive** measure
  so an incidental Monaco bump cannot silently regress the DOMPurify advisories
  (see the Closed section + Lockfile notes).

If a future `npm audit` surfaces a new advisory, document the fix-or-defer
decision here before the cycle ends — do NOT leave a fresh advisory
undocumented across cycles.

---

## Gate cadence — when we run security checks

| Gate | Command | When |
|------|---------|------|
| Inline | `npm audit` | Every improvement cycle that touches `package.json` or `package-lock.json` (per CLAUDE.md scope rule). |
| Release | `npm audit --omit=dev` (runtime-only) | Before every release build (`npm run build` → installer). MUST return zero advisories — the gate fails the release otherwise. |
| Continuous | Dependabot dashboard | GitHub auto-checks on every push to `main` and on a weekly schedule. New advisories surface as alerts on the Dependabot dashboard linked above. |
| Per-cycle | `npm run verify:release-gate` | Pre-release script that runs `npm audit --omit=dev --audit-level=low` (step 0), then `npm run typecheck`, `npm run test:coverage`, `npm run build`, and the OCL smoke. |

A new advisory shows up → the next cycle to touch the affected area MUST
either close it or document the deferral here. Do NOT leave a fresh
advisory undocumented across cycles.

---

## How to verify the current state

```powershell
# Top-line summary (dev + runtime)
npm audit

# Runtime-only — MUST be 0 advisories before a release
npm audit --omit=dev

# Detailed metadata
npm audit --json | ConvertFrom-Json | Select-Object -ExpandProperty metadata | ConvertTo-Json -Depth 3

# Confirm dompurify resolution (must show 3.4.7 or newer)
npm ls dompurify --all

# Confirm vitest 4.x resolution (must show 4.x, NOT 3.x)
npm ls vitest --all

# Confirm electron-builder is on the audited-clean v26 tree
npm ls electron-builder
```

Expected output today (2026-06-02):

- `npm audit` reports **0 vulnerabilities** (0 critical / 0 high / 0 moderate / 0 low).
- `npm audit --omit=dev` reports **0 advisories** (release gate green).
- `npm ls dompurify` shows `dompurify@3.4.7` (or newer) under `monaco-editor@0.55.x`.
- `npm ls vitest` shows `vitest@4.1.8` (or newer) — confirms the CVE fix.
- `npm ls electron-builder` shows `electron-builder@26.8.1` (or newer in `^26`).

---

## Lockfile resolution notes

The following entries in `package-lock.json` are pinned by the `overrides`
block in `package.json` and will stay stable across `npm install` runs even
if a parent's `package.json` keeps declaring a vulnerable range:

- `dompurify@^3.4.7` — forced by `overrides`. Every transitive resolution
  (currently only via `monaco-editor`) lands on 3.4.7.

If a future dep introduces a separate dompurify range that conflicts with
`^3.4.7`, npm will error at install time — that is the desired behavior,
because it forces a manual review before silently regressing.

---

## Future dep waves — TODO

- [x] **Electron-builder 26.x upgrade** — DONE (2026-06-02). Bumped to
  `^26.8.1`; `npm audit` and `npm audit --omit=dev` both 0. Remaining: the
  owner runs `npm run build` on Windows 11 to confirm the v26 toolchain
  produces a working `WorkTrackCAM-0.1.0-Setup.exe` and that the K2 / Laguna /
  Carvera smoke checks still pass against the packaged binary.
- [ ] **Monaco editor minor/patch bumps** — once Monaco ships a release that
  depends on dompurify ≥ 3.4.0 directly, the `overrides` block becomes
  redundant (keep the override until then to prevent regressions during
  incidental bumps).
- [ ] **Electron itself** — currently `^39.8.5`. Track Chromium security
  advisories on the Electron security feed; bump when a security release
  ships. (No open advisories against the current pin.)
- [ ] **Vitest 4.x patch tracking** — stay on the latest 4.x. The major bump
  closed the critical CVE; minor releases are watched for further
  hardening on the dev server path.

---

## Reporting a vulnerability

If you find a security issue in WorkTrackCAM itself (not a transitive dep —
those go through the npm-audit flow above), open a **private** advisory on
the repository:

  https://github.com/jacobrrough/WorkTrackCAM/security/advisories/new

Do NOT file a public issue. The maintainer (Jacob Rough) will acknowledge
within a few days, validate the report, and coordinate a fix and a
coordinated disclosure window before merging anything to `main`.

Common categories that DO belong here:

- G-code generated by WorkTrackCAM that crashes a real machine (CAM safety
  is treated as a security issue — see the `gcode-safety` skill and
  `docs/MACHINES.md`).
- Path-traversal, command-injection, or sandbox-escape paths in the
  Electron main process, the Python sidecar, or the OrcaSlicer CLI
  wrapper.
- IPC handlers that accept un-validated input from the renderer.
- Project-file (`.wtcam`) parsers that crash, escape Zod validation, or
  execute attacker-controlled content.

Common categories that do NOT belong here (file a normal issue instead):

- "Dependabot is flagging X" → already tracked above; no need to file.
- "Tests are failing" → normal bug report, not a security report.
