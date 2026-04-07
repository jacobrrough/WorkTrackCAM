# Slicer definitions (CuraEngine)

Parallel agent lane: **Stream L** — [`docs/agents/STREAM-L-cura-slicer.md`](../../docs/agents/STREAM-L-cura-slicer.md) (slicer-only; broader bundled work → **Stream F**). Merge-ready pasteable: **Aggressive — Stream L**; narrow scope: **MICRO-SPRINT (attach to Stream L)** in [`docs/agents/PARALLEL_PASTABLES.md`](../../docs/agents/PARALLEL_PASTABLES.md).

This folder ships a **machine definition stub** used when Unified Fab Studio runs **CuraEngine** from **Utilities → Slice**. The app passes the JSON path on the CLI; CuraEngine still needs Ultimaker-style **base definitions** on disk (not bundled here).

## Files

| File | Role |
|------|------|
| `creality_k2_plus.def.json` | Minimal **Creality K2 Plus** profile. **`inherits`: `fdmprinter`** — CuraEngine must resolve `fdmprinter.def.json` via the definitions search path. Bed size and head polygon are **starting values**; tune for your machine and firmware. **Default** definition when the app does not pass a custom path ([`src/main/slicer.ts`](../../src/main/slicer.ts) → `buildCuraSliceArgs`). **CLI `-s` defaults** (`layer_height`, `line_width`, etc.) are centralized in [`src/shared/cura-slice-defaults.ts`](../../src/shared/cura-slice-defaults.ts). |
| `generic_fdm_250.def.json` | **250×250×250 mm** generic Cartesian stub (same inherit chain). Use when you override **definition path** in **Utilities → Slice** to test a smaller envelope without editing the K2 stub. |

### Bundled defs vs Cura’s definitions folder

- **This folder** (`resources/slicer/` in the repo, or `slicer/` under the app **resources** root at runtime) holds **only** the JSON we ship. It is **not** a substitute for **`CURA_ENGINE_SEARCH_PATH`**.
- **`CURA_ENGINE_SEARCH_PATH`** must still be Ultimaker Cura’s **`definitions`** directory (the folder that contains **`fdmprinter.def.json`**). CuraEngine resolves **`inherits`** from there; our files are extra machine defs passed with **`-j`**.

### POSIX / macOS / Linux (examples)

Replace the path with the directory that contains **`fdmprinter.def.json`** on your system:

```bash
export CURA_ENGINE_SEARCH_PATH="/usr/share/cura/resources/definitions"
# or a local AppImage / Flatpak mount — locate fdmprinter.def.json first:
# find / -name fdmprinter.def.json 2>/dev/null | head -1
```

Then run CuraEngine from a terminal with the same environment, or rely on **Utilities → Settings → Paths** (the app sets the variable for the slice subprocess when the field is filled).

Repo layout (for docs and agents):

- Definition stub: `unified-fab-studio/resources/slicer/creality_k2_plus.def.json`
- Runtime resolution: bundled under the app **resources root** as `slicer/creality_k2_plus.def.json` (see `src/main/slicer.ts` → `buildCuraSliceArgs`).

## Definitions path (required)

CuraEngine looks up inherited definitions using **`CURA_ENGINE_SEARCH_PATH`**. That value must be the **folder that directly contains** `fdmprinter.def.json` (Ultimaker Cura’s `definitions` directory), not the `resources` parent and not a single `.def.json` file.

### In the app (recommended)

**Utilities → Settings → Paths**

1. **CuraEngine.exe** — path to the CuraEngine binary from your Cura install or build.
2. **Cura definitions folder (contains fdmprinter.def.json)** — same directory you would use as the definitions root. When you slice, the main process sets `CURA_ENGINE_SEARCH_PATH` to this path for the CuraEngine child process (equivalent to setting the variable globally).

### Optional: system / user environment

You can set **`CURA_ENGINE_SEARCH_PATH`** in Windows **User** or **System** environment variables to the same folder. The in-app field still overrides for the slice subprocess when filled in (see `src/main/slicer.ts`).

## Windows path examples

Paths vary by **Cura version** and **install type**. Adjust the version folder to match what you installed.

**Typical per-machine install (Program Files)**

- Definitions (search path target):  
  `C:\Program Files\Ultimaker Cura 5.8.0\share\cura\resources\definitions`
- CuraEngine (common sibling):  
  `C:\Program Files\Ultimaker Cura 5.8.0\CuraEngine.exe`

**Typical per-user install (Local Programs)**

- Definitions:  
  `C:\Users\YourName\AppData\Local\Programs\Ultimaker Cura 5.8.0\share\cura\resources\definitions`
- CuraEngine:  
  `C:\Users\YourName\AppData\Local\Programs\Ultimaker Cura 5.8.0\CuraEngine.exe`

**Tip:** In File Explorer, open your Cura install folder and search for **`fdmprinter.def.json`**. The directory that contains that file is what you paste into **Cura definitions folder**.

**Path syntax:** You may use **backslashes** (`C:\…`) or **forward slashes** (`C:/…`) in the app; Node resolves both on Windows.

## Verify before slicing

In PowerShell (replace the path):

```powershell
Test-Path 'C:\Program Files\Ultimaker Cura 5.8.0\share\cura\resources\definitions\fdmprinter.def.json'
```

Should print `True`.

## Troubleshooting

| Symptom | What to check |
|--------|----------------|
| “Could not find definition” / inherits errors | Definitions path must be the **`definitions`** folder containing `fdmprinter.def.json`, and must match the **Cura major version** your `CuraEngine.exe` came from. |
| Confusion: “why isn’t `CURA_ENGINE_SEARCH_PATH` this repo’s `resources/slicer`?” | **Search path** = Cura install **definitions** root only. **Bundled stubs** (`creality_k2_plus.def.json`, `generic_fdm_250.def.json`) are referenced by **absolute path** on the CLI (`-j`); they still **inherit** keys from defs found via **`CURA_ENGINE_SEARCH_PATH`**. |
| Slice works in Cura GUI but not in the app | GUI and CLI may use different installs — point both fields at the **same** Cura install root (same version). |
| Microsoft Store / unusual installs | Locate `fdmprinter.def.json` under the Store app package if exposed, or install the **desktop** Cura build for predictable paths. |

## Safety

Slicer output is **not guaranteed safe** for your printer until you verify temperatures, limits, and start/end G-code against your firmware. See **`docs/MACHINES.md`**.
