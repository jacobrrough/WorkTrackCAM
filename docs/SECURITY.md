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

| Severity | Open | Closed (recent waves) | Notes |
|----------|-----:|----------------------:|-------|
| Critical |    0 |                     1 | vitest CVE GHSA-5xrq-8626-4rwp closed (vitest 3 → 4.1.8). |
| High     |   10 |                     1 | All 10 open advisories are dev-only (electron-builder + tar chain). |
| Moderate |   10 |                     7 | DOMPurify + brace-expansion + ip-address + postcss closed in prior wave. |
| Low      |    1 |                     1 | `@tootallnate/once` closed in prior wave. |
| **Total**| **21** |                  **10** | Dependabot dashboard view. |

**Runtime / user-shipping advisory count: 0.**

Every remaining advisory is reached through a `devDependencies` path — most
through Monaco Editor's transitive chain (installed in the Monaco wave) and
electron-builder's transitive chain. None of them ship to the user's
machine in the packaged Electron app.

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

### 10 high in the electron-builder / tar chain (dev-only)
All open high-severity advisories are reached *only* through
`electron-builder@25.1.8` and its transitive deps:

```
electron-builder@25.1.8 (devDependency)
├── @electron/rebuild        → node-gyp → tar     (path-traversal, hardlink)
├── app-builder-lib          → dmg-builder         (cascading)
├── electron-builder-squirrel-windows              (cascading)
├── cacache                  → tar                 (path-traversal)
└── make-fetch-happen        → cacache             (cascading)
```

The advisories are real (path traversal and symlink poisoning in `tar`),
but **the attack surface is dev-only**: an attacker would need to control
the contents of a `tar` archive that the build host extracts during
`npm run build`. None of this code ships in the packaged installer
(`out/main`, `out/preload`, `out/renderer`, plus the `engines/` and
`resources/` snapshots are the only artifacts that reach the user).

#### Why we are NOT bumping electron-builder to 26.x yet
`npm audit fix --force` would install `electron-builder@26.8.1`, a major
bump that introduces:

- `minimatch@10` — changed glob semantics. Risk of `files`/`extraResources`
  globs silently excluding files from the installer.
- `@electron/universal@v2` — macOS universal binary tool (on the roadmap,
  but not the current pre-launch focus).
- ASAR integrity resources on Windows — new behavior that needs validation
  against the NSIS installer flow used for the K2 Plus / Laguna / Carvera
  shop targets.
- `app-builder-bin@5.0` — internal binary, churn risk during pre-launch.

Bumping the build tool right before pre-launch real-world testing (see
`docs/PRE-LAUNCH-READINESS.md`) is the wrong trade. The mitigation is:

1. The vulnerabilities are dev-only.
2. We control the dev environment.
3. The post-pre-launch wave will land electron-builder 26.x with full
   end-to-end NSIS-installer verification.

### 10 moderate in the Monaco editor chain (dev-only, low-impact)
Monaco's transitive deps account for the open moderate advisories. The DOMPurify
ones are already closed via `overrides`; the remaining 10 are bundler/build
plumbing (`vite-plugin-monaco-editor` pulls older `webpack` plumbing for
worker bundling). None of them are reachable at runtime — Monaco ships as
pre-compiled JS in the renderer bundle, and the bundler plumbing only runs
during `npm run dev` / `npm run build`.

Status: deferred until Monaco's next major (which is expected to drop the
older bundler plumbing). Tracked in the Future TODO list below.

### 1 low — Dependabot's own minor advisories
One remaining low-severity entry is a tooling advisory (no user impact). Left
in place until a clean transitive bump becomes available.

---

## Gate cadence — when we run security checks

| Gate | Command | When |
|------|---------|------|
| Inline | `npm audit` | Every improvement cycle that touches `package.json` or `package-lock.json` (per CLAUDE.md scope rule). |
| Release | `npm audit --omit=dev` (runtime-only) | Before every release build (`npm run build` → installer). MUST return zero advisories — the gate fails the release otherwise. |
| Continuous | Dependabot dashboard | GitHub auto-checks on every push to `main` and on a weekly schedule. New advisories surface as alerts on the Dependabot dashboard linked above. |
| Per-cycle | `npm run verify:release-gate` | A pre-release script that combines `npm audit --omit=dev`, `npm test`, `npm run typecheck`, and the no-dump-stubs check. |

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
```

Expected output today (2026-06-02):

- `npm audit` reports **10 high**, **10 moderate**, **1 low**, **0 critical**.
- `npm audit --omit=dev` reports **0 advisories** (release gate green).
- `npm ls dompurify` shows `dompurify@3.4.7` (or newer) under
  `monaco-editor@0.55.x`.
- `npm ls vitest` shows `vitest@4.1.8` (or newer) — confirms the CVE fix.

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

- [ ] **Electron-builder 26.x upgrade** — close the 10 remaining high
  advisories. Validate against the NSIS installer flow before merging.
  Must verify `npm run build` produces a working
  `WorkTrackCAM-0.1.0-Setup.exe` and that the K2 / Laguna / Carvera
  smoke tests still pass against the packaged binary.
- [ ] **Monaco editor minor/patch bumps** — once Monaco ships a release that
  depends on dompurify ≥ 3.4.0 directly AND drops the older bundler
  plumbing, the 10 moderate advisories close and the `overrides` block
  becomes redundant (keep the override until then to prevent regressions
  during incidental bumps).
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
