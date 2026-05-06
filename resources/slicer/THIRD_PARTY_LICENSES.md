# Bundled third-party binaries — license attribution

> **Phase 2 [P2-K2-SLICE]/Cycle 2 — Option A approved 2026-05-05.**
> This file is the canonical license attribution for binaries vendored under `resources/slicer/bin/` and definitions vendored under `resources/slicer/definitions/`.

## CuraEngine

- **Upstream:** [Ultimaker/CuraEngine](https://github.com/Ultimaker/CuraEngine)
- **License:** **AGPLv3** ([full text](https://www.gnu.org/licenses/agpl-3.0.txt) / mirrored under `LICENSES/AGPLv3.txt` once the binary is vendored)
- **Pinned release tag:** `5.12.1` (UltiMaker Cura release 2026-04-09; CuraEngine is bundled inside the Cura desktop installer rather than published as a standalone release — see `docs/SLICING.md` "Bundled binary provenance").
- **Use pattern:** WorkTrackCAM spawns CuraEngine as a **separate subprocess** via `spawnBounded` in `src/main/slicer.ts`. CuraEngine is **not** statically linked into the Electron main process or the renderer bundle. This matches the way Ultimaker's own Cura desktop app uses CuraEngine.
- **AGPL compliance posture:**
  1. **License text** — a copy of the AGPLv3 license is shipped alongside the binary in `resources/slicer/LICENSES/AGPLv3.txt` (vendored 2026-05-05 alongside the win32-x64 binary set).
  2. **Source availability** — the corresponding source for the bundled binary is available at the upstream GitHub release tag pinned above. We do not modify the binary; the pinned tag IS the corresponding source.
  3. **No static linkage** — see "Use pattern" above.
  4. **Network distribution** — AGPL specifically governs network distribution. WorkTrackCAM runs CuraEngine locally on the user's machine; no network distribution of CuraEngine output occurs from a WorkTrackCAM-hosted server. The K2 Plus's own Moonraker HTTP server is operated by the end user, not by WorkTrackCAM, so the AGPL §13 "remote network interaction" clause does not attach to us.
- **Per-platform binaries:**
  - `bin/win32-x64/CuraEngine.exe` — **VENDORED 2026-05-05** (21,397,592 bytes; alongside 60 MSVC/UCRT/CuraEngine support DLLs from the Cura 5.12.1 installer; total vendored 49,550,896 bytes / 47.3 MB).
  - `bin/darwin-arm64/CuraEngine` — pending (extract from `UltiMaker-Cura-5.12.1-macos-ARM64.dmg`).
  - `bin/darwin-x64/CuraEngine` — pending (extract from `UltiMaker-Cura-5.12.1-macos-X64.dmg`).
  - `bin/linux-x64/CuraEngine` — pending (extract from `UltiMaker-Cura-5.12.1-linux-X64.AppImage`).
- **SHA256 checksums (win32-x64 vendored 2026-05-05):**
  - `bin/win32-x64/CuraEngine.exe`: `18c76ae4f43a44996f0216a6d6156d9cbf397ffed4a63ba223f8d7b7b03c1842`
  - `definitions/fdmprinter.def.json`: `c219f9d2319fe926752f671457f48b265ec56daf7c50e0a45307c17a9b1ed23b`
  - `definitions/fdmextruder.def.json`: `b062b42d0f18042884511fce27d595e3d7cc4395464a3dd33f72c3f09b5f2ce2`
  - DLL set sourced from the same Cura 5.12.1 win64 installer payload — provenance: file `UltiMaker-Cura-5.12.1-win64-X64.exe` SHA256 from upstream GitHub release: `3a8d3b34d3fc7aafd495630a0ad07cfc19badb50a2a99c22597d4adb971c78da`.

The Cycle-2 wiring code (`src/main/cura-bundled-paths.ts`) does **not** verify these SHA256s at runtime today — the integrity check is a follow-on cycle.

## CuraEngine definitions tree

- **Upstream:** [Ultimaker/Cura/resources/definitions](https://github.com/Ultimaker/Cura/tree/main/resources/definitions)
- **License:** **AGPLv3** (same as CuraEngine — these JSON files ship with Ultimaker Cura under the same license).
- **Pinned release tag:** same as CuraEngine.
- **Files vendored:**
  - `definitions/fdmprinter.def.json` — the inheritance root for **all** FDM machine profiles.
  - `definitions/fdmextruder.def.json` — the inheritance root for the extruder block.
- **Why only these two:** the K2 Plus stub at `resources/slicer/creality_k2_plus.def.json` declares `inherits: "fdmprinter"` and the extruder block resolves to `fdmextruder`. Vendoring the full Ultimaker definitions tree (~50 MB / hundreds of community-maintained printers) would inflate the installer for zero benefit since WorkTrackCAM only targets one FDM machine.
- **Audit gate:** the `src/main/slicer-bundled.test.ts` env-gated smoke test ([`WTC_BUNDLED_SLICER_TEST=1`](../../docs/SLICING.md)) runs `CuraEngine slice -j creality_k2_plus.def.json -l <tiny.stl> -o /tmp/x.gcode` with `CURA_ENGINE_SEARCH_PATH=resources/slicer/definitions`. If the inheritance chain cannot be resolved entirely inside the vendored tree, that test fails with a non-zero CuraEngine exit code.

## Other third-party assets

This project also depends on several open-source libraries via `package.json` (Electron, Three.js, React, Vitest, Handlebars, etc.). Their licenses are tracked by `electron-builder` during the packaging step — see the generated `licenses.json` in the packaged `Resources/` folder of release builds. This document covers only the binaries vendored directly into the source tree under `resources/`.

## How to update

When the CuraEngine pinned tag bumps:

1. Update `docs/SLICING.md` "Bundled binary provenance" section with the new tag + new SHA256s.
2. Update the "Pinned release tag" lines above to match.
3. Re-run `WTC_BUNDLED_SLICER_TEST=1 npx vitest run src/main/slicer-bundled.test.ts` against the new binary on at least one platform.
4. Commit the new binaries + this updated file in the same change.

## Reverting Option A

The Phase 2 [P2-K2-SLICE]/Cycle 2 change is reversible by design:

1. Delete `resources/slicer/bin/` and `resources/slicer/definitions/`.
2. The bundled-path resolver (`src/main/cura-bundled-paths.ts`) returns `{ ok: false, reason: 'binary-not-vendored' }`.
3. `resolveSliceEnginePaths` falls through to the user-supplied path (the existing Option B behavior).
4. Operators see the original "Configure CuraEngine path under File → Settings" message in the renderer (the slicer surfaces a friendly error string via `r.stderr` from `sliceWithCuraEngine`).

In short: removing the vendored blobs reverts WorkTrackCAM to the pre-Cycle-2 Option B behavior with no code changes.
