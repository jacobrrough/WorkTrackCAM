# Slicing — OrcaSlicer integration

WorkTrack3D ships the Creality K2 Plus FDM pipeline by bundling the
**OrcaSlicer** CLI and driving it from the Electron main process.

## Why OrcaSlicer

The 2026-05-27 foundation pivot replaced the deleted CuraEngine bundle
with OrcaSlicer (https://github.com/OrcaSlicer/OrcaSlicer) because:

- Maintained upstream with first-class Klipper / Bambu / K2-class
  profiles, including chamber heater + input shaping.
- Sane PrusaSlicer-derived CLI surface: `--load <ini> --load <ini> --load <ini> --output <gcode> -g <stl>`.
- AGPL but invoked as a subprocess — clean separation from our app code.

## Code layout

| Path | Purpose |
| --- | --- |
| `src/main/slicer/orca-wrapper.ts` | Pure `buildOrcaArgs` + `runOrcaSlice` that spawns the bundled binary. Throws a clear error via `resolveOrcaInstall()` when the binary is missing. |
| `src/main/ipc-fabrication.ts` (`slice:orca`) | IPC handler the renderer calls; resolves machine/process/filament `.ini` files and forwards to `runOrcaSlice`. |
| `resources/orca-slicer/profiles/{machines,process,filament}/*.ini` | Source-tracked K2 Plus + (future) other machine profiles. |
| `resources/orca-slicer/<platform-dir>/` | Bundled binary tree, NOT source-tracked. Produced by the bundling script and shipped via electron-builder. |

## OrcaSlicer binary bundling

The OrcaSlicer Windows portable build is ~150 MB extracted, so it lives
outside git. Two pieces of infrastructure materialize it:

1. **`scripts/bundle-orca-slicer.ps1`** — a one-shot PowerShell script
   Jacob runs ONCE on his Windows dev box. It downloads a SHA256-pinned
   release zip from GitHub, verifies the hash, extracts it, and renames
   `OrcaSlicer.exe` to `orca-slicer.exe` so the path layout matches
   `resolveOrcaInstall()` in the wrapper. It is idempotent (re-runs are
   no-ops unless `-Force` is passed) and refuses to leave a
   half-extracted tree on any failure.

   Usage:

   ```powershell
   # From the repo root
   powershell -ExecutionPolicy Bypass -File ./scripts/bundle-orca-slicer.ps1            # first run (or upgrades)
   powershell -ExecutionPolicy Bypass -File ./scripts/bundle-orca-slicer.ps1 -Force     # force re-download
   ```

   On success it leaves:

   ```
   resources/orca-slicer/win32-x64/
     orca-slicer.exe         <- renamed from OrcaSlicer.exe
     VERSION                  <- pinned tag, e.g. "v2.3.2"
     *.dll, resources/, ...   <- everything else from the portable zip
   ```

   To bump the pinned version, edit `$OrcaVersion`, `$OrcaZipName`, and
   `$OrcaZipSha256` at the top of the script — the bump procedure is
   spelled out in the script's leading comment block.

2. **electron-builder `extraResources`** — `package.json` declares two
   `extraResources` entries:

   - `resources/orca-slicer/win32-x64 -> resources/orca-slicer/win32-x64`
   - `resources/orca-slicer/profiles  -> resources/orca-slicer/profiles`

   These ship the binary tree and `.ini` profiles UNPACKED beside the
   asar archive (a binary inside the asar cannot be spawned). The
   `files` block correspondingly excludes the platform binary dirs from
   the asar to avoid double-packing the ~150 MB tree.

### Day-zero checklist on a fresh Windows clone

```powershell
git clone https://github.com/jacobrrough/WorkTrack3D.git
cd WorkTrack3D
npm install
powershell -ExecutionPolicy Bypass -File ./scripts/bundle-orca-slicer.ps1   # downloads + extracts OrcaSlicer
npm run build                            # electron-builder packs it
```

If the script is skipped, every call into the `slice:orca` IPC handler
returns `orca_unavailable` with a hint pointing back at the bundling
script — the wrapper deliberately fails loud rather than silently
spawning whatever else might exist on the user's PATH.
