# WorkTrack3D — Security Posture & Dependency Advisory Tracking

**Last updated**: 2026-06-15
**Owner**: dependency-security workflow (DEP stack)

This doc is the source of truth for WorkTrack3D's security posture: which
published advisories are **closed**, which are **knowingly deferred** (with
the reason and the conditions under which they would be re-evaluated), and
the cadence we run security gates on. If you bump a dep, run `npm audit`,
and a new entry appears, decide here whether to fix or defer it.

The live source of truth for *open* advisories is the GitHub Dependabot
dashboard for this repo:

  https://github.com/jacobrrough/WorkTrack3D/security/dependabot

The numbers in this file are a snapshot in time; the dashboard is real-time.

---

## TL;DR — Current State (2026-06-15 snapshot)

| Severity | Open (full tree) | Notes |
|----------|-----:|-------|
| Critical |    0 | vitest CVE GHSA-5xrq-8626-4rwp closed (vitest 3 → 4.1.8) in a prior wave. |
| High     |    4 | **dev-only, deferred** — the esbuild ≤0.24.2 dev-server CORS advisory (GHSA-67mh-4wv8-2f99) via the `vite` / `electron-vite` / `@vitejs/plugin-react` build chain. Fixing needs `npm audit fix --force` (vite major bump) — breaking, NOT shipped to users. See "Deferred" below. |
| Moderate |    0 | **js-yaml quadratic-DoS GHSA-h67p-54hq-rp68 closed 2026-06-15** via `npm audit fix` (non-breaking lockfile bump); DOMPurify still forced via `overrides`. |
| Low      |    0 | `@tootallnate/once` closed in a prior wave. |
| **Total**| **4** | `npm audit --omit=dev` reports **0** (the release gate is GREEN); full `npm audit` reports **4 high**, all dev-only build tooling. |

**Runtime / user-shipping advisory count: 0 (release gate GREEN). Full dev+prod advisory count: 4 (all dev-only esbuild/vite chain, deferred).**

The 2026-06-15 sketch campaign merge to `main` surfaced (via the GitHub push hook) a runtime
`js-yaml` moderate (quadratic-complexity DoS in merge-key handling) — **closed same day** with a
non-breaking `npm audit fix` (only `package-lock.json` changed; full suite 16,617/0 + typecheck
re-verified clean). The 4 remaining high advisories are the esbuild dev-server CORS chain and are
knowingly deferred (dev-only, breaking to fix) — see below.

The 2026-06-08 Text-engine wave added `opentype.js@^2.0.0` (runtime, MIT) +
`@types/opentype.js@^1.3.10` (dev). `npm install` added **one** package; both
`npm audit` and `npm audit --omit=dev` stayed at **0** advisories (verified
2026-06-08). See "Clean dependency additions" below.

The 2026-06-09 Offset+Boolean sketch-engine wave added `clipper-lib@^6.4.2`
(runtime, **Boost Software License** — permissive MIT/BSD-class). `npm install`
added **one** package; both `npm audit` and `npm audit --omit=dev` stayed at **0**
advisories (verified 2026-06-09). Types via a local ambient `.d.ts` (no `@types`
package exists). See "Clean dependency additions" below.

The electron-builder 26.8.1 bump (this wave) closed the last open chain — the
dev-only `tar`/`cacache` path that electron-builder 25 pulled in transitively.
`npm audit` now reports a clean tree across dev **and** prod.

---

## Deferred advisories

### High — esbuild ≤0.24.2 dev-server CORS (GHSA-67mh-4wv8-2f99) — DEV-ONLY, DEFERRED
- **Chain**: `esbuild` → `vite` (4.2.0-beta.0 – 8.0.3) → `electron-vite` + `@vitejs/plugin-react`.
  Reported as 4 high entries (one per node in the chain) by full `npm audit`.
- **Why high / why it does NOT ship**: the advisory is that esbuild's **dev server** lets any
  web page send it cross-origin requests and read the response. It affects `npm run dev` only —
  the esbuild/vite dev server is **never** part of the packaged Electron app (`electron-vite
  build` produces static bundles; no dev server runs in production). `npm audit --omit=dev`
  reports **0**, confirming nothing in the shipped tree is affected.
- **Why deferred, not fixed**: the only fix `npm audit` offers is `npm audit fix --force`, which
  bumps `vite` across a major (4/5 → 8) and pulls `electron-vite` + `@vitejs/plugin-react` majors
  with it — a breaking change to the entire build/test toolchain. Not worth the regression risk
  for a dev-server-only advisory with zero runtime exposure.
- **Re-evaluation trigger**: do the major bump as its own dedicated wave (own branch, full
  build + 16,600-test re-verify, signed-installer smoke) — NOT bundled into a feature cycle.
- **Status**: **DEFERRED** (dev-only). The runtime release gate (`npm audit --omit=dev` = 0) is
  unaffected and remains the hard gate before any release build.

## Closed advisories (recent)

### Moderate — js-yaml quadratic-complexity DoS GHSA-h67p-54hq-rp68 (closed 2026-06-15)
- **Bump**: `js-yaml` transitive bump via a non-breaking `npm audit fix` (only
  `package-lock.json` changed — 103 insertions / 90 deletions; `package.json` untouched).
- **Why moderate**: js-yaml's merge-key (`<<`) handling had quadratic complexity on repeated
  aliases — a crafted YAML document could pin CPU. It sat in the **runtime** dependency tree, so
  it counted against `npm audit --omit=dev`.
- **Validation**: `npm audit --omit=dev` → **0 vulnerabilities**; full suite **16,617 passed / 1
  skipped / 0 failed**; `tsc --noEmit` clean — all re-verified after the bump.
- **Status**: **CLOSED**. Runtime release gate restored to GREEN (0).

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
  v26 toolchain still produces a working `WorkTrack3D-0.1.0-Setup.exe`.
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

## Clean dependency additions (no advisory)

### opentype.js — Text → machinable vectors engine (2026-06-08)
- **Added**: `opentype.js@^2.0.0` (runtime dependency, **MIT** license) +
  `@types/opentype.js@^1.3.10` (devDependency, types only).
- **Why**: powers `src/shared/text-to-vectors.ts`, which flattens TrueType glyph
  outlines into closed sketch contours for sign / lettering CAM
  (docs/plans/catalog/vcarve-laguna.md). Pure JS, no native bindings.
- **Bundled asset**: `resources/fonts/Roboto-Regular.ttf` (**Apache-2.0**,
  Google) ships inside the app so the engine runs with **no network at runtime**.
  Licensing documented in `resources/fonts/README.md`. The font is packed via
  `build.extraResources` (lands at `process.resourcesPath/resources/fonts`,
  resolved by `paths.ts → getResourcesRoot()` — same pattern as OrcaSlicer).
- **Audit**: `npm install` added **1** package; `npm audit` → **0** and
  `npm audit --omit=dev` → **0** (verified 2026-06-08). No transitive runtime
  deps of concern (opentype.js 2.x is dependency-light pure JS).
- **Security note**: the engine performs no file/network I/O itself — it takes an
  already-parsed font or a byte buffer and runs deterministic geometry. Font
  parsing of an attacker-controlled `.ttf` is out of scope today (only the
  bundled, trusted Roboto face is shipped); if user-supplied fonts are added
  later, validate/limit the buffer before `opentype.parse`.
- **Renderer read path (added 2026-06-08, Text-dialog wave)**: the Text dialog
  reaches the bundled bytes via a read-only IPC `font:read`
  (`src/main/ipc-core.ts`, mirrors `wizard:readCadSample`). The request carries a
  **fixed font id** from `src/shared/bundled-font-contract.ts` (`BUNDLED_FONT_IDS`)
  that maps to a known filename under `getResourcesRoot()/fonts` — never a
  caller-supplied path — so it cannot be coerced into filesystem traversal. It
  reads under `resources/` only and touches no project directory or G-code path.
  Re-running `npm audit` + `npm audit --omit=dev` on this wave (no dep change
  beyond the already-recorded opentype.js) → **0 / 0** (verified 2026-06-08).
- **Status**: **CLEAN** — no advisory opened.

### clipper-lib — Offset + Boolean sketch-geometry engine (2026-06-09)
- **Added**: `clipper-lib@^6.4.2` (runtime dependency, **Boost Software License
  1.0** — a permissive MIT/BSD-class license, allowed by the dependency policy).
  No `@types` package exists; the typed surface is a local ambient declaration
  `src/shared/clipper-lib.d.ts` (no `any`).
- **Why**: powers `src/shared/sketch-boolean-offset.ts`, the pure
  offset (`offsetSketchEntities`) + boolean (`booleanSketchEntities`) engine that
  closes the "Vectors · Edit → Offset / Boolean (weld)" P1 gap in
  docs/plans/catalog/vcarve-laguna.md for the Laguna sign / cabinet workflow.
  Clipper is the CAM-standard polygon library and does BOTH boolean ops and
  `ClipperOffset`. Pure JS, no native bindings, no file/network I/O.
- **Audit**: `npm install` added **1** package (481 audited); `npm audit` → **0**
  and `npm audit --omit=dev` → **0** (verified 2026-06-09). clipper-lib 6.4.2 is a
  dependency-free single-file JS translation of Angus Johnson's C# Clipper.
- **Import shape (Wave-3f build lesson)**: `clipper-lib` is a CommonJS module
  (`module.exports = ClipperLib`), so the namespace object lands on `.default`
  under both Node ESM interop and the electron-vite (Rollup) production build —
  hence a **default** import (`import ClipperLib from 'clipper-lib'`), the OPPOSITE
  of opentype.js (an ESM, named-only package that needed `import * as`). Verified
  by a **production build smoke**: `electron-vite build` bundled the engine into
  the renderer (803 modules, `ClipperOffset` + clipper enums present in
  `out/renderer/assets/index-*.js`) with no ESM/CJS Rollup error. A green
  `tsc`+`vitest` alone is NOT sufficient proof — the bundler smoke is required.
- **Security note**: the engine performs no file/network I/O — it takes a
  `DesignFileV2` (or a bare entity list) and runs deterministic integer-scaled
  polygon math (mm → int via `CLIPPER_SCALE` 1e4). No attacker-controlled parsing
  surface is added. It never emits, mutates, or posts a toolpath (G-code stays
  downstream in cam-local → cam-runner-2d → vcarve_mach3.hbs, untouched).
- **Status**: **CLEAN** — no advisory opened.

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
  produces a working `WorkTrack3D-0.1.0-Setup.exe` and that the K2 / Laguna /
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

If you find a security issue in WorkTrack3D itself (not a transitive dep —
those go through the npm-audit flow above), open a **private** advisory on
the repository:

  https://github.com/jacobrrough/WorkTrack3D/security/advisories/new

Do NOT file a public issue. The maintainer (Jacob Rough) will acknowledge
within a few days, validate the report, and coordinate a fix and a
coordinated disclosure window before merging anything to `main`.

Common categories that DO belong here:

- G-code generated by WorkTrack3D that crashes a real machine (CAM safety
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
