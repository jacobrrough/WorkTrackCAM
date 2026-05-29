# Real-World Testing Guide

How to take WorkTrackCAM from a dev checkout to a real cut / real print on the
three shop machines: **Creality K2 Plus** (FDM), **Laguna Swift 5×10** (CNC
router), and **Makera Carvera** (3-axis + 4th-axis rotary).

> **Safety first.** CNC G-code drives real spindles into real stock. Every CNC
> section below ends in an **air-cut / dry-run** step *before* you let a tool
> touch material. Do not skip it. Keep a hand on the feed-hold / E-stop on the
> first run of any new program.

Deeper per-topic references (read alongside this guide):
- [`MACHINES.md`](MACHINES.md) — full per-machine specs, dialects, limits
- [`SLICING.md`](SLICING.md) — FDM slicing internals
- [`SMOKE-K2-MOONRAKER.md`](SMOKE-K2-MOONRAKER.md) — Moonraker push smoke test
- [`CAM_4TH_AXIS_REFERENCE.md`](CAM_4TH_AXIS_REFERENCE.md) — Carvera 4-axis math

---

## 0. One-time setup (all machines)

| Need | How | Verify |
| --- | --- | --- |
| Node deps | `npm install` | `npm test` is green |
| Python engine (CAD + CAM) | `pip install -r engines/requirements.txt` (Python ≥ 3.9) | `python -c "import cadquery, ocl"` exits 0 |
| OrcaSlicer (K2 only) | Install **OrcaSlicer 2.3.x** from the [official releases](https://github.com/SoftFever/OrcaSlicer/releases) | Settings → Paths shows **OrcaSlicer: Found** |

Launch the app in dev mode:

```bash
npm run dev
```

For a real installer instead of dev mode: `npm run build` (produces an NSIS
installer under `dist/`). The build bundles the Python `engines/` and the
OrcaSlicer profile tree; the OrcaSlicer **binary** is only bundled if it is
present under `resources/orca-slicer/win32-x64/` at build time (see §1.1).

### 0.1 Pre-flight inside the app

1. **Settings → Paths**
   - **Python**: blank uses the system `python`; set an explicit path if you
     installed the engine deps into a specific interpreter / venv.
   - **OrcaSlicer**: should read **Found (system install)** with the resolved
     path once OrcaSlicer 2.3.x is installed. If it reads **Not found**, see
     §1.1.
2. **Settings → Slicing / Moonraker**: set the **Moonraker URL** for the K2
   (e.g. `http://<k2-ip>` or `http://k2plus.local`). Click **Test connection**
   — it should report the printer state and live bed/nozzle temps.

---

## 1. Creality K2 Plus — FDM print

**Goal:** model → sliced G-code → printer, via OrcaSlicer + Moonraker.

### 1.1 Make sure OrcaSlicer is resolvable

WorkTrackCAM finds the OrcaSlicer CLI in this order (first hit wins):

1. **`WORKTRACKCAM_ORCA_BIN`** environment variable — full path to
   `orca-slicer.exe`. Use this if your install is in a non-standard location.
2. **Bundled** binary under `resources/orca-slicer/win32-x64/orca-slicer.exe`.
3. **System install** — the standard installer location
   (`%PROGRAMFILES%\OrcaSlicer\OrcaSlicer.exe`, plus the `%LOCALAPPDATA%`
   per-user location).

So a normal OrcaSlicer 2.3.x install is detected with **zero configuration**.
If Settings shows **Not found**, either install OrcaSlicer to the default
location, or set the env var before launching:

```powershell
# PowerShell — point WorkTrackCAM at a custom OrcaSlicer install
$env:WORKTRACKCAM_ORCA_BIN = "D:\Tools\OrcaSlicer\orca-slicer.exe"
npm run dev
```

### 1.2 Slice and send

1. **Import** your model (STL / STEP / 3MF).
2. Select **Creality K2 Plus** as the active machine.
3. In the FDM slice panel pick a **filament** (e.g. `pla-generic`) and a
   **quality preset** (`standard` or `high_speed`).
4. **Slice.** WorkTrackCAM runs OrcaSlicer headless with the bundled K2 Plus
   machine + process + filament JSON profiles and produces a `.gcode` file.
5. Confirm the G-code looks sane — the app validates the header (temps within
   the K2 ceilings: nozzle ≤ 350 °C, bed ≤ 120 °C) before any upload.
6. **Send to K2 Plus** (dashboard or slice panel). This pushes the file over
   the Moonraker API and starts the job. The button is disabled until a slice
   exists *and* the Moonraker URL is set.

**Fallback if Moonraker is unreachable:** the produced `.gcode` is a normal
file — upload it through the printer's Fluidd web UI manually.

### 1.3 First-print checklist
- Watch the **first layer** — adhesion is the #1 failure mode.
- Confirm chamber/bed reach target before extrusion.
- Have the Fluidd UI open so you can pause/cancel independently of the app.

---

## 2. Laguna Swift 5×10 — CNC router

**Goal:** model → toolpath → posted G-code (`.nc`) → RichAuto A-series → cut.

Work envelope is **60″ × 120″** (1524 × 3048 mm), ~7.5–8″ Z. The post emits
standard RichAuto-A-series-compatible G-code with explicit units and safe
retracts.

### 2.1 Set up the job
1. **Import** the part / sheet layout.
2. Select **Laguna Swift 5×10**.
3. **CAM setup:**
   - Define **stock** (full sheet or offcut) — must fit the envelope; the
     pipeline **rejects** (does not silently clamp) toolpaths that exceed the
     work span, so you'll get a clear error rather than a crash.
   - Set the **work origin / WCS** and **Z zero** (top of stock vs. spoilboard).
   - Pick tool, feeds & speeds, and the operation (profile / pocket / drill).
4. **Generate the toolpath** (OpenCAMLib runs in the Python sidecar).
5. **Post-process** → writes a `.nc` G-code file to disk.

### 2.2 Verify before cutting
1. Open the posted `.nc` and skim the header: correct **units (G21)**, a safe
   **Z retract**, **spindle warm-up**, and **cool-down** at the end.
2. Load onto the **RichAuto A-series** pendant.
3. Set the workpiece origin on the controller to match the WCS you used.

### 2.3 Air-cut, then cut (do not skip)
1. **Dry run in the air:** raise Z by ~1″ (or jog the gantry over an empty
   area) and run the whole program once. Watch travels, plunge points, and
   retracts.
2. Engage **dust collection** and confirm **hold-downs / vacuum zones** are
   holding the stock.
3. Re-zero Z to the real surface, do a **spindle warm-up**, then run for real
   with a hand on feed-hold.

---

## 3. Makera Carvera — desktop CNC (3-axis + 4-axis)

Controller is **Smoothieware-family** (Makera Controller). The post handles the
Smoothieware dialect quirks (program-end `M2`, dwell `G4 P…`, no `M6` in the
4-axis path). 3-axis work area is **360 × 240 × 140 mm**; the rotary takes
stock up to ~**Ø92 × 240 mm**.

### 3.1 Carvera 3-axis
1. **Import** → select **Makera Carvera (3-Axis)**.
2. CAM setup (stock, WCS, tool, operation) → **generate** → **post** to G-code.
3. Load via the **Makera Controller**; use **auto-probe / auto-level** to set
   Z and (if enabled) the **ATC** for tool changes. To run a single tool with
   a manual change instead, enable **Manual tool change** on the operation.
4. **Air-cut first**, confirm dust collection, then cut.

### 3.2 Carvera 4th-axis (rotary)
The rotary headstock changes the origin model — get this right or the part is
scrap (or the tool hits the chuck):

1. **Import** → select **Makera Carvera (4th Axis HD)**.
2. **Origin:** work origin needs an **X offset to the rotary headstock** with
   **Y = 0** (parts are centered on the rotary axis). Confirm the
   **rotation direction** matches the headstock — the post is rotation-aware,
   but your physical mounting must agree.
3. Default 4-axis output is **indexed** (rotate, then cut a face). If you opt
   into **Simultaneous 4-axis**, note the post emits a prominent
   **UNVERIFIED** warning header — treat simultaneous output as experimental
   and dry-run it thoroughly. See [`CAM_4TH_AXIS_REFERENCE.md`](CAM_4TH_AXIS_REFERENCE.md).
4. **Dry-run with the rotary turning in the air** (no stock, or oversized
   clearance) and watch a full rotation cycle before committing to stock.

---

## 4. Troubleshooting

| Symptom | Fix |
| --- | --- |
| Settings → OrcaSlicer **Not found** | Install OrcaSlicer 2.3.x to the default location, or set `WORKTRACKCAM_ORCA_BIN` to the full `orca-slicer.exe` path, then relaunch. |
| Slice fails with `orca_unavailable` | Same as above — the CLI couldn't be located. The error hint lists every path checked. |
| Slice fails with `orca_slice_failed` | OrcaSlicer ran but rejected the job; the hint carries its stderr. Usually a bad profile or an unsuitable mesh. |
| `not_fdm_machine` when slicing | A CNC machine is active. Select **Creality K2 Plus** before slicing. |
| Moonraker push fails | Re-check the Moonraker URL and **Test connection** in Settings; confirm the K2 is on the network and Moonraker is reachable. See [`SMOKE-K2-MOONRAKER.md`](SMOKE-K2-MOONRAKER.md). |
| CAM generate errors / Python not found | Set the **Python path** in Settings and confirm `pip install -r engines/requirements.txt` ran for that interpreter. |
| Toolpath rejected as out-of-bounds | The stock/contour exceeds the machine envelope — this is intentional, not a bug. Shrink the job or re-zero the stock. |

---

## 5. Quick reference — what each machine produces

| Machine | Kind | Output | Delivery |
| --- | --- | --- | --- |
| Creality K2 Plus | FDM | `.gcode` (OrcaSlicer) | Moonraker push (or Fluidd upload) |
| Laguna Swift 5×10 | CNC | `.nc` (RichAuto A-series dialect) | Load on RichAuto pendant |
| Makera Carvera 3-axis | CNC | G-code (Smoothieware dialect) | Makera Controller |
| Makera Carvera 4-axis | CNC | G-code (rotary, indexed by default) | Makera Controller |
