# Makera Carvera -- carvera-cli upload smoke checklist

**Audience.** Jacob (and anyone else physically in front of a Carvera) verifying that WorkTrackCAM can hand a freshly-posted `.nc` file off to a Carvera over WiFi or USB without first opening the Makera Controller.

This document is the bench procedure for the **`Send to Carvera`** quick-action surfaced on the [WorkshopDashboard](../src/renderer/dashboard/WorkshopDashboard.tsx) and the per-job Carvera upload row in the Manufacture panel ([`ManufactureAuxPanels.tsx`](../src/renderer/manufacture/ManufactureAuxPanels.tsx)). The upload itself is implemented in [`src/main/carvera-cli-run.ts`](../src/main/carvera-cli-run.ts) and pinned by [`carvera-cli-run-pin.test.ts`](../src/main/carvera-cli-run-pin.test.ts).

> **Safety posture (read first).** The Carvera will start whatever it receives the moment the operator presses Run on the touchscreen. Do NOT push a toolpath you have not simulated. The smoke procedure below uploads a known safe **air-cut** NC file the first time; only after that pass do you push a real cutting job.

## 1. What is `carvera-cli` and why do we use it?

[`carvera-cli`](https://github.com/hagmonk/carvera-cli) is a community-maintained **third-party Python tool** that talks the Carvera's Smoothieware upload protocol over WiFi or USB. We use it because:

- The **Makera Controller** desktop app is the *only first-party* way to push files to the Carvera, and it is GUI-only -- there is no headless / scriptable mode that WorkTrackCAM can call from its main process.
- `carvera-cli` is a thin, well-scoped Python package that wraps the same wire protocol. It exposes a CLI WorkTrackCAM can spawn the same way it spawns OrcaSlicer or the Python sidecar.
- It is **not bundled** with WorkTrackCAM -- the user installs it once, then points WorkTrackCAM at the executable under **File -> Settings -> External tool paths**.

The CLI is third-party and AGPL-incompatible to bundle, so the install step is on the operator. WorkTrackCAM's runtime only knows the absolute path the user pasted into Settings; everything else (argv, timeout, ENOENT recovery hint) is unit-test-pinned in [`carvera-cli-run-pin.test.ts`](../src/main/carvera-cli-run-pin.test.ts).

## 2. Install `carvera-cli`

We **strongly recommend** doing the install inside a Python virtualenv so that the Carvera CLI's dependency tree never leaks into the system Python the WorkTrackCAM sidecar uses. The CLI is pure Python and works on every platform Python supports.

### Windows (PowerShell)

```powershell
# 1. Create a dedicated virtualenv for the CLI
python -m venv $env:LOCALAPPDATA\WorkTrackCAM\venvs\carvera

# 2. Activate it for this terminal
& "$env:LOCALAPPDATA\WorkTrackCAM\venvs\carvera\Scripts\Activate.ps1"

# 3. Install the CLI
pip install carvera-cli

# 4. Note the absolute path -- you will paste this into Settings later
# Typical: %LOCALAPPDATA%\WorkTrackCAM\venvs\carvera\Scripts\carvera-cli.exe
(Get-Command carvera-cli).Source
```

### macOS

```bash
python3 -m venv ~/.local/share/worktrackcam/venvs/carvera
source ~/.local/share/worktrackcam/venvs/carvera/bin/activate
pip install carvera-cli
which carvera-cli
# Typical: ~/.local/share/worktrackcam/venvs/carvera/bin/carvera-cli
```

### Linux

```bash
python3 -m venv ~/.local/share/worktrackcam/venvs/carvera
source ~/.local/share/worktrackcam/venvs/carvera/bin/activate
pip install carvera-cli
which carvera-cli
# Typical: ~/.local/share/worktrackcam/venvs/carvera/bin/carvera-cli
# If the Carvera is on USB you may also need to be a member of the dialout (Debian/Ubuntu)
# or uucp (Arch) group to claim the serial device without sudo.
```

If you cannot use a virtualenv, `pip install --user carvera-cli` works too -- just be aware that `pip` upgrades elsewhere on the system could later pull dependencies out from under it. The advantage of the virtualenv is that the CLI never breaks because something *else* on the machine was upgraded.

## 3. Verify the install

Run the version flag in the same terminal where you installed it:

```
carvera-cli --version
```

Expected: a single line printing the installed version (e.g. `carvera-cli 0.4.x`). Anything else -- "command not found", a Python traceback, a `pip` warning -- means the install did not land cleanly. Fix that before moving on.

## 4. Configure the CLI path in WorkTrackCAM

WorkTrackCAM does not assume `carvera-cli` is on `PATH`. You give it the absolute path to the executable once, and the main process resolves it every time it spawns an upload.

1. Open **File -> Settings -> External tool paths** (this is a NEW section -- if you don't see it, you are on an old build; pull `main` and rebuild).
2. In the **Carvera CLI path** field, paste the absolute path you noted in Step 2:
   - Windows example: `C:\Users\jacob\AppData\Local\WorkTrackCAM\venvs\carvera\Scripts\carvera-cli.exe`
   - macOS / Linux example: `/home/jacob/.local/share/worktrackcam/venvs/carvera/bin/carvera-cli`
3. (Optional, advanced.) If you are invoking the CLI via a Python interpreter (`python.exe -m carvera_cli ...` instead of the script wrapper), paste the **interpreter** in **Carvera CLI path** and put `["-m","carvera_cli"]` in **Carvera CLI extra args (JSON)**. The argv builder in [`buildCarveraUploadArgs`](../src/main/carvera-cli-run.ts) prepends the extra args before the subcommand. This is the path pinned by [`carvera-cli-run-pin.test.ts`](../src/main/carvera-cli-run-pin.test.ts) `[ID-0256] (C)`.
4. Click **Save**. The path is stored in the WorkTrackCAM `AppSettings` schema field `carveraCliPath` (see [`src/shared/project-schema.ts`](../src/shared/project-schema.ts)).

If you leave **Carvera CLI path** empty, WorkTrackCAM falls back to the literal string `"carvera-cli"` and relies on the OS resolving it via `PATH`. That works on a developer workstation but is fragile on a fresh shop machine -- prefer the absolute path.

## 5. Send a test job

The objective: prove the spawn path, argv shape, and Carvera ACK all work, **without cutting anything**.

1. In WorkTrackCAM, generate or open a job whose machine is `makera-carvera-3axis` (or `makera-carvera-4axis`).
2. Run **Manufacture -> Generate toolpath** so `output/cam.nc` exists. Use a known **air-cut** NC for the first run -- a 30-second G0/G1 sweep above the stock with the spindle commanded off. If you are not sure what to use, hand-edit a copy of `output/cam.nc` to remove `M3` lines and add 50 mm to every `Z` value, then save it as `output/airtest.nc`.
3. Trigger the upload one of two ways:
   - **WorkshopDashboard -> Send to Carvera** (the `data-action="send-to-carvera"` button on the Carvera card). This sends the latest emitted `.nc` for the current job.
   - **Manufacture panel -> Carvera upload row.** Set **Connection** to `Auto`, `WiFi`, or `USB` to match how the Carvera is reachable; optionally fill **Device** with the IP or COM port.
4. Expected app behavior:
   - A spinner appears on the action button while the upload is in flight.
   - On success: a success toast / banner -- typically `Uploaded <filename> to Carvera`.
   - On failure: an error toast carrying both the CLI's exit code and the trailing stderr (truncated to ~4000 chars per [`carvera-cli-run.ts`](../src/main/carvera-cli-run.ts)).
5. Expected machine behavior:
   - The Carvera touchscreen file list refreshes and shows the new `.nc`. **The machine does NOT start cutting** -- starting is a manual operator action on the touchscreen.
   - If you set a `remoteDirectory` (or `--remote-path`), the file lands in that subdirectory of `/sd/gcodes/` on the Carvera SD card.
6. Touch the file on the Carvera screen, confirm the preview, then -- and only then -- press Run.

After the first air-cut pass, repeat with a real (small, simulated) cutting job. Once that succeeds, you have signed off on the upload path for production use.

Sign-off line for Jacob:
- [ ] Step 5 air-cut PASS  /  signed _________________  /  date __________
- [ ] Step 5 real-cut PASS  /  signed _________________  /  date __________

## 6. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Error toast contains `ENOENT` or `spawn` or `not find` | The path in **Settings -> External tool paths** is wrong, or the file was renamed, or the virtualenv was deleted. WorkTrackCAM's spawn helper surfaces this with the hint: `"Check Carvera CLI path under File -> Settings -> External tool paths (or install carvera-cli on PATH)."` (see [`carvera-cli-run.ts`](../src/main/carvera-cli-run.ts) lines 109-118 -- pinned by [`carvera-cli-run-pin.test.ts`](../src/main/carvera-cli-run-pin.test.ts) `ENOENT hint surfaces External tool paths Settings`). | Re-run `carvera-cli --version` in a terminal to confirm the CLI still works, then update the path in Settings. |
| CLI runs but exits non-zero with a permission error on Linux/macOS over USB | The serial device (e.g. `/dev/ttyACM0`) is owned by a group your user is not in. The Carvera presents itself as a USB CDC ACM device, and the OS guards write access. | Add yourself to the right group (`sudo usermod -a -G dialout $USER` on Debian/Ubuntu, `sudo usermod -a -G uucp $USER` on Arch), then log out and back in. Alternatively, switch the **Connection** field to **WiFi** if your Carvera is on the LAN -- no USB claim needed. |
| CLI runs but exits non-zero with a permission error on Windows | A WiFi router blocked the upload, or COM-port handle is being held by an open Makera Controller window. | Close the Makera Controller, unplug + replug the Carvera USB cable (Windows re-enumerates the COM port), then retry the upload. |
| Upload times out at exactly the configured timeout (default 120 s) | The Carvera is offline, the WiFi IP changed (DHCP), or the file is huge over a slow link. The spawn is bounded via [`spawnBounded`](../src/main/subprocess-bounded.ts) and surfaces the timeout instead of hanging forever. | Confirm Carvera connectivity (`ping` the device, or look at the touchscreen). If you intentionally need a longer cap, bump the `timeoutMs` payload when wiring the action, but never disable the timeout outright. |
| Error toast quotes a generic non-zero exit code with no useful stderr | The CLI failed before printing anything (most often Python import error inside a half-broken venv). | Re-run `carvera-cli --version` from a terminal -- the traceback you see there is the real failure. Re-install if needed. |
| The file uploads but the Carvera reports a syntax error when you press Run | Almost always a post-processor problem, not a CLI problem. The CLI never modifies bytes -- it streams them as-is. | Open `output/cam.nc` in a text editor and check the offending line. If the dialect looks wrong, that is a job for the [`gcode-safety` skill](../.claude/skills/gcode-safety/) -- run it against the generated G-code before re-uploading. |

## 7. What is NOT in this checklist

- **The Carvera 4-axis (rotary) post.** That uses [`carvera_4axis.hbs`](../resources/posts/carvera_4axis.hbs) and is covered in [`docs/CAM_4TH_AXIS_REFERENCE.md`](./CAM_4TH_AXIS_REFERENCE.md). The upload path itself (this doc) is identical for 3-axis and 4-axis jobs.
- **Probing.** WorkTrackCAM does not (yet) drive the Carvera wireless probe over the CLI -- probing is still a touchscreen operation. The smoke checklist here proves the upload path only.
- **ATC tool management.** Tool slot configuration lives on the machine. WorkTrackCAM only emits `M6 Tn` / `G43 Hn` per [`docs/MACHINES.md`](./MACHINES.md) and trusts the Carvera to honor it; this smoke checklist does not exercise an actual tool change.

## 8. Cross-references

- Spawn helper: [`src/main/carvera-cli-run.ts`](../src/main/carvera-cli-run.ts)
- Argv + ENOENT-hint pins: [`src/main/carvera-cli-run-pin.test.ts`](../src/main/carvera-cli-run-pin.test.ts) (`[ID-0256]` block)
- Behavior contract: [`src/main/carvera-cli-run.test.ts`](../src/main/carvera-cli-run.test.ts)
- IPC handler: [`src/main/ipc-fabrication.ts`](../src/main/ipc-fabrication.ts) -- search `'carvera:'`
- Renderer entry points: [`src/renderer/dashboard/WorkshopDashboard.tsx`](../src/renderer/dashboard/WorkshopDashboard.tsx) (`Send to Carvera` quick-action), [`src/renderer/manufacture/ManufactureAuxPanels.tsx`](../src/renderer/manufacture/ManufactureAuxPanels.tsx) (Carvera upload row)
- Settings schema field: [`src/shared/project-schema.ts`](../src/shared/project-schema.ts) -- `carveraCliPath`, `carveraCliExtraArgsJson`
- Machine context: [`docs/MACHINES.md`](./MACHINES.md) -- `makera-carvera-3axis` and `makera-carvera-4axis` sections
- Upstream CLI: <https://github.com/hagmonk/carvera-cli>
