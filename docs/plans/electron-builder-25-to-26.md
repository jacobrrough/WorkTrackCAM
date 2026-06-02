# Plan — electron-builder 25 → 26 major bump

> **Stack:** A (build tooling) · **Status:** ✅ Ready · **Effort:** S
> **Machines:** all (build/packaging only — no shop-floor behavior changes)
> **Created:** 2026-06-02 · **Owner:** Jacob · **Mode:** plan-only (no code changed)

Bump `electron-builder` from `^25.1.8` to `^26.x`. It is a `devDependency`; the app binary, G-code,
posts, and profiles are untouched. The main payoff is closing the 10 high (dev-only) advisories the
v25 tar/cacache chain carries. Every v26 breaking change lands on config keys this repo does not use.

---

## 1. Current state

| Package | Resolved (v25 tree) | Where |
|---|---|---|
| `electron-builder` | `25.1.8` | `package.json:42` (devDep `^25.1.8`) |
| `electron` | `39.8.5` | `package.json:41` |
| `electron-updater` | `6.8.3` | `package.json:24` (prod dep, resolves its own `builder-util-runtime`) |
| `app-builder-bin` | `5.0.0-alpha.10` | lockfile (already on v5 alpha) |
| `resedit` | `1.7.2` | lockfile (v26 uses this for Windows EXE resource editing) |

- **Build script:** `package.json:9` → `electron-vite build && electron-builder`.
- **Build config:** inline `"build"` key, `package.json:54–118`. No standalone `electron-builder.yml/.json`.
  - Windows `nsis` is the only real target (`win.target` = string `"nsis"`, `package.json:92`).
  - `mac`/`linux` carry **icons only** — no targets, no signing, no notarization.
  - `extraResources` packs `engines/**`, `resources/orca-slicer/win32-x64`, `resources/orca-slicer/profiles`.
  - `files` excludes the non-win32 OrcaSlicer platforms; `.wtcam` fileAssociation defined.
- **No code-signing config anywhere** — unsigned build (no `win.signtoolOptions`, no `CSC_*`).
- **`build/` dir does not exist on disk** yet (`buildResources: "build"`, icon ref `build/icons/icon.ico`).
- **Security baseline (`docs/SECURITY.md`):** 10 high / 10 moderate / 1 low open advisories, all dev-only;
  `npm audit --omit=dev` already returns **0**. The 10 highs are the electron-builder/tar chain. The doc
  explicitly defers the v26 bump as a future wave.
- **`scripts/verify-release-gate.mjs`:** runs typecheck → test:coverage → build → python smoke. It does
  **not** yet run `npm audit --omit=dev` — that gap is closed here.

## 2. Goal (definition of done)

1. `package.json` declares `"electron-builder": "^26.x"` (latest stable; confirm at install time).
2. `npm install` succeeds; `package-lock.json` regenerated.
3. `npm run build` produces a working `dist/WorkTrackCAM-0.1.0-Setup.exe` NSIS installer on Windows 11.
4. `npm run typecheck` + `npm test` green, zero regressions.
5. `npm audit --omit=dev` returns **0**; the 10 high dev-only advisories close (or are re-documented).
6. `scripts/verify-release-gate.mjs` gains the audit step and passes all stages.
7. `docs/SECURITY.md` updated: move the closed advisories, record any new ones, mark the v26 TODO done.

## 3. Approach

**Recommended — targeted bump + immediate validation.** electron-builder is dev-only and the v26 API
does not touch the config keys this repo uses. Target a known-stable `^26.x` (avoid the unstable early
`26.0.4–26.0.12` node-modules-collector regressions, issue #8842). Run `npm info electron-builder version`
at execution time and pin to the current stable.

- **Alt A — exact pin (`26.x.y`, no caret):** more conservative; blocks silent re-resolution to a bad
  patch. Low friction here since `npm install` only runs at intentional dev setup. Reasonable given the
  owner's "verify before release" discipline.
- **Alt B — stay on v25 + targeted `npm audit fix --force`:** keeps the 10 highs open. Rejected — closing
  them is the point of the cycle, and the deferral condition (pre-launch testing underway) is now satisfied.

## 4. v26 breaking changes → mapped to this repo

| # | v26 change | Applies here? |
|---|---|---|
| BC-1 | Windows signing moved to `win.signtoolOptions` / `win.azureSignOptions` | **No** — `win` has only `target`/`publisherName`/`icon`; unsigned. |
| BC-2 | `linux.desktop` must be an object, not a string | **No** — `linux` has only `icon`. |
| BC-3 | macOS notarization removed from `mac` config → env vars | **No** — `mac` has only `icon`. |
| BC-4 | `minimatch` 9 → 10 (stricter glob edges; early-26 ESM `brace-expansion` regression, fixed by ~26.0.3) | **Low** — all `files`/`extraResources` patterns are simple `**/*` / negations. Verify packed trees post-build. |
| BC-5 | HFS+ DMG removed on non-ARM64 Macs | **No** — Windows-primary. |
| BC-6 | `app-builder-bin` → stable v5; Windows EXE editing via `resedit` (already at 1.7.2) | **Neutral** — functionally identical to rcedit. Risk only if `icon.ico` missing (see R). |
| BC-7 | Node-module collector rewrite (regressions in 26.0.4–26.0.12) | **No** if targeting late `^26.x`; repo uses npm (lockfile v3). |
| BC-8 | `disableAsarIntegrity` key; `extraResources` ASAR files now in integrity hash (fix #8660) | **No** — repo doesn't flip `EnableEmbeddedAsarIntegrityValidation` fuse. |
| BC-9 | `electron-updater` (prod dep) unchanged at `^6.8.3` | **Neutral** — resolves its own `builder-util-runtime`; verify no peer conflict. |
| BC-10 | NSIS template `SYSTEMROOT`→`SYSDIR`; makensis stderr + installer-size validation (26.13.x) | **No** config change — net-positive failure detection. |
| BC-11 | `@electron/osx-sign` ≥ 1.3.3 required (lockfile has 1.3.1) | **No** impact — auto-upgraded by `npm install`; unsigned. |

## 5. Touchpoints

- **`package.json:42`** — `"^25.1.8"` → `"^26.x"`. Recheck the `overrides` (`dompurify`) still apply via
  `npm ls dompurify --all`. The `"build"` block needs **no** changes.
- **`package-lock.json`** — regenerated by `npm install` (do not hand-edit).
- **`scripts/verify-release-gate.mjs`** — prepend an `npm audit --omit=dev --audit-level=low` step (~3 lines).
- **`docs/SECURITY.md`** — TL;DR counts, move electron-builder/tar advisories to "closed", record any new,
  mark the v26 TODO done, bump "last updated". (Has em-dashes/UTF-8 → Python-via-bash edit.)
- **`src/main/electron-builder-config-pin.test.ts`** *(new)* — pins the `"build"` block shape + the `^26.`
  devDep prefix (style after the existing `src/main/auto-updater-pin.test.ts`).
- **`build/icons/icon.ico`** — not strictly required for the bump, but absent on disk; see R below.

## 6. Risks & mitigations

| Risk | L | Impact | Mitigation |
|---|---|---|---|
| `minimatch` v10 glob regression drops packed files | Low | High | Verify `engines/` + `resources/orca-slicer/win32-x64` present in installed `Resources/`. |
| `resedit` errors without `build/icons/icon.ico` | Med | Low | Provide a valid `.ico` **or** set `win.signAndEditExecutable: false` as a temporary fallback. |
| PowerShell `$PROFILE` stdout pollutes the node-module collector JSON | Low | Med | Build in a clean shell; targeting late `^26.x` avoids the worst window. |
| New **production** advisory from the v26 tree | Very low | High | `npm audit --omit=dev` MUST be 0 before building for distribution. |
| `electron-updater` peer-dep conflict | Low | Med | `npm ls builder-util-runtime --all`; add an `overrides` entry if needed. |
| **Shop-floor / G-code / `.wtcam` impact** | — | **None** | Pure dev-dep bump; no schema, post, profile, or toolpath changes. gcode-safety skill **not** required. |

## 7. Test strategy

- No new runtime tests needed for the bump itself. The new pin test (`electron-builder-config-pin.test.ts`)
  guards the `"build"` block: `productName`/`appId`/`artifactName`, `win.target === 'nsis'`,
  `nsis.{oneClick:false, perMachine:false, allowToChangeInstallationDirectory:true}`,
  `fileAssociations[0].ext === 'wtcam'`, the three `extraResources.from` entries, the darwin/linux
  exclusion patterns, and a `^26.` devDep regression guard.
- The `npm audit --omit=dev` gate in `verify-release-gate.mjs` is the automated security test.
- Manual smoke (Windows 11): installer runs, installs, makes shortcuts, `.wtcam` association opens the app,
  packed `engines/` + `orca-slicer/win32-x64` present, app reaches main window.

## 8. Sequencing

1. Pre-flight gates (`npm test` + `npm run typecheck`) — record baseline.
2. Bump `package.json:42`; `npm install` (regenerates lockfile).
3. `npm audit` + `npm audit --omit=dev` — document, must be 0 for the latter.
4. `npm run build` on Windows 11; watch for minimatch/`resedit`/collector/makensis errors.
5. Smoke the installer (§7).
6. Post-flight gates (typecheck + test) — zero regressions.
7. Add the audit step to `verify-release-gate.mjs`.
8. Add `electron-builder-config-pin.test.ts`; run it.
9. Update `docs/SECURITY.md` (Python-via-bash).
10. Stage `package.json`, `package-lock.json`, the two test/script files, `docs/SECURITY.md`. Never stage `dist/`.

## Effort & open questions

**Effort: S** (~1–2 h with Windows build access; +1–2 h buffer for the icon/collector risks).

1. Latest stable version — run `npm info electron-builder version` before pinning.
2. Is there a committed `icon.ico` anywhere? If truly absent, supply one or set `signAndEditExecutable:false`.
3. `win.target` string vs array — string is fine; convert to array only if a second Windows target is added.
4. `electron-builder-squirrel-windows` is a passive dep (no Squirrel target configured) — no action unless
   auto-update via Squirrel is ever desired.
5. Confirm empirically that the v26 tree resolves patched `tar`/`cacache` so the 10 highs actually close.
