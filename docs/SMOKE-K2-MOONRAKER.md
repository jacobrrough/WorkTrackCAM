# Creality K2 Plus -- Moonraker push smoke checklist

**Phase 2 deliverable**: `[P2-K2-PUSH]` (CLAUDE.md `PHASE 2 -- END-TO-END INTEGRATION`).
**Roadmap**: closes the "real-machine smoke checklist Jacob can run" line of [P2-K2-PUSH] (the mock-Moonraker harness already lives at `src/main/moonraker-push-e2e.test.ts` + `src/main/k2-moonraker-upload-contract.test.ts`).
**Last updated**: 2026-05-05 (Cycle 336).

This document is the bench procedure Jacob runs to verify, on his actual K2 Plus, that the Moonraker push pipeline implemented in `src/main/moonraker-push.ts` works end-to-end. The `*-e2e.test.ts` and `k2-moonraker-upload-contract.test.ts` mock harness pin the wire-protocol invariants in CI; this file pins the **machine-side** invariants that no mock can verify (the printer actually heats up, actually moves, actually prints).

> **Safety posture (read first)**: this checklist *does* heat the printer and *does* push real `.gcode`. Do not run unattended. Step 4 (auto-start) is gated on the Step 3 (upload-only) test passing. The first real upload is a 20-line air-print, not a real benchy.

## Prerequisites

| Item | Required value | Where to set |
| --- | --- | --- |
| K2 Plus on same LAN as the workstation | yes | router DHCP table |
| Moonraker reachable from a browser | `http://<ip-or-hostname>` returns Fluidd UI | n/a |
| K2 Plus firmware | Klipper-based + Moonraker (stock K2 Plus OS) | `Settings -> About` on the touchscreen |
| WorkTrackCAM build | `npm run build` clean from a Phase 2 commit | terminal |
| Test G-code file | a Cura-sliced `.gcode` <= 5 MiB targeting K2 Plus | external Cura with profile `creality_k2_plus.def.json` |

Do NOT run this against a stranger printer or a printer you do not physically control. The push API does not authenticate by default on a stock K2 Plus; the safety net is your LAN, not the protocol.

## Finding the K2 Plus on your LAN (do this before Step 0)

Everything below uses `<printer-host>` as a placeholder. You need to resolve that to a real address before you can curl anything or type a URL into WorkTrackCAM. There are three ways to find the K2 Plus on your LAN, in order of reliability:

1. **Router DHCP table (most reliable).** Log in to your router's admin page (commonly `http://192.168.1.1` or `http://192.168.0.1`), open the DHCP / connected-clients / device-list page, and look for a hostname like `K2Plus`, `CrealityK2`, or a MAC vendor of `Creality`. Note the IPv4 address (e.g. `192.168.1.42`). **Strongly recommended**: while you are in the router UI, set a **DHCP reservation** for that MAC -- this pins the IP across reboots and means every URL in this checklist keeps working forever.
2. **K2 Plus touchscreen.** On the printer, tap `Settings -> Network -> WiFi` (or `Settings -> Network -> Ethernet` if wired). The current IPv4 address is displayed on the network status screen. Use this if you cannot reach the router UI -- but remember the IP can change at the next DHCP lease renewal unless you set a reservation per (1).
3. **mDNS (`k2plus.local`).** Stock Creality K2 Plus OS advertises itself on mDNS. From the workstation, `ping k2plus.local` (or `ping K2Plus.local` -- case sometimes matters on Linux). If it resolves, you can use `http://k2plus.local:7125` everywhere `<printer-host>` appears. **Caveat**: mDNS is convenient but flaky -- it stops working on guest VLANs, networks with mDNS reflection disabled, some VPN configurations, and occasionally just at random. Use it as a fallback, not as the primary.

### Hostname vs IP -- which to use in WorkTrackCAM

| Form | Pros | Cons | When to use |
| --- | --- | --- | --- |
| IPv4 (`192.168.1.42`) | Reliable, no resolver, fastest | Breaks if DHCP hands out a new lease | Production -- pair with a router DHCP reservation |
| mDNS (`k2plus.local`) | Stable across IP changes; readable | Flaky on some networks, slow first resolve, sometimes silently breaks | Quick bench tests; fallback if IP changes |

The recommended setup is **DHCP-reserved IPv4**: stable like a static IP, but you configure it in one place (the router) instead of on the printer.

### Moonraker port

Stock K2 Plus OS exposes Moonraker (and the Fluidd web UI) on **TCP port 7125**. The Fluidd UI is the visual confirmation -- open the URL in any browser; you should see the Fluidd dashboard (printer state, temperature gauges, file list). If you see that, Moonraker is up and reachable; if you do not, fix the network or firmware before continuing.

### Example URLs (use one of these as `<printer-host>` everywhere below)

```
http://192.168.1.42:7125      # IPv4 form (recommended -- pair with DHCP reservation)
http://k2plus.local:7125      # mDNS form (fallback; flaky on some networks)
```

Once one of those URLs loads Fluidd in a browser, substitute that exact origin (scheme + host + port) for every `<printer-host>` in this document, and use it for the **Moonraker** field in Step 2.

## Step 0 -- pre-flight

1. From the workstation, in a terminal:
   ```
   curl -sS -m 5 http://<printer-host>/server/info | head -c 400
   ```
   Expected: a JSON body that includes `"klippy_state":"ready"` (or `"startup"` shortly after a power-cycle). If you get a connection error, fix the network before going further.
2. From the workstation, in a terminal:
   ```
   curl -sS -m 5 http://<printer-host>/printer/objects/query?print_stats | head -c 400
   ```
   Expected: a JSON body whose `result.status.print_stats.state` is one of `standby`, `ready`, `printing`, `paused`, `complete`, `cancelled`, `error`. Anything else (raw HTML, `404`, empty body) means Moonraker is not the layer that answered, and the rest of this checklist will not work.
3. On the K2 Plus touchscreen, clear the print queue if anything is queued, and confirm the bed is empty.

If any of (1)-(3) fails, STOP and resolve the network / firmware issue before continuing.

## Step 1 -- mock-server sanity (workstation only, printer not used)

Confirm the local build can hit a mock Moonraker. This is a sanity check that the binary you are about to point at the real printer is the one whose unit tests already pass.

1. ```
   npx vitest run src/main/moonraker-push-e2e.test.ts src/main/k2-moonraker-upload-contract.test.ts
   ```
2. Both files must report all `it()` blocks green. The mock harness binds `127.0.0.1` on a random port and never touches the LAN.

If either file is red, FIX THE BUILD before pointing it at hardware. A mock failure means the real printer will fault in a way the test surface does not catch.

## Step 2 -- launch and configure WorkTrackCAM

1. Start the desktop app: `npm run dev` (or run the packaged build).
2. Open the **My Shop** quick-select; pick **Creality K2 Plus**.
3. Open the manufacture / fabrication panel; in the **Moonraker** field, enter the printer base URL using the address you resolved in "Finding the K2 Plus on your LAN" above (e.g. `http://192.168.1.42:7125` or `http://k2plus.local:7125`). On stock K2 Plus OS Moonraker is on port `7125` -- always include the port.
4. Confirm the active machine card shows: `K2 Plus`, `350 x 350 x 350 mm`, `nozzle <= 350 C`, `bed <= 120 C`, `chamber <= 60 C`.
5. The active machine resolves the FDM capability fields (`maxNozzleTempC`, `maxBedTempC`, `chamberTempC`) via the `moonraker:push` IPC handler -- they ARE checked against the slicer output BEFORE any byte crosses the network (see `src/main/moonraker-push.ts` `[ID-0073]` block).

## Step 3 -- upload-only test (heats nothing, prints nothing)

The objective: prove the multipart upload reaches `/server/files/upload` and the file shows up in Fluidd's queue, WITHOUT starting a print.

1. Pick a tiny pre-sliced test file. A 20-line air-print is included as `tests/fixtures/k2-airprint-20lines.gcode` if available; otherwise slice a 5x5x1 mm cube in Cura with the K2 Plus profile and save it.
2. In WorkTrackCAM, click **Push to printer** with **Start after upload = OFF**.
3. Expected app behavior:
   - Status toast / banner: `Uploaded <filename> to K2 Plus`.
   - No spinner over `printer/print/start` (because we did not start).
4. Expected printer behavior:
   - Heat-bed and hot-end stay at room temperature.
   - The K2 Plus touchscreen / Fluidd file list shows the new `.gcode` in `gcodes/` (or `gcodes/<uploadPath>` if a sub-directory was specified).
5. From a workstation terminal, verify directly:
   ```
   curl -sS -m 5 http://<printer-host>/server/files/list?root=gcodes | head -c 400
   ```
   The new filename should appear with a size that matches the local file's `wc -c` byte count exactly.

If the file does not appear in Fluidd's listing, check:
- The filename ends in `.gcode` (Fluidd filters out `.g` / `.nc`). The push helper preserves the local basename, so this is a CLIENT problem if the local file is misnamed.
- The `root` field in the multipart body is `gcodes`. The current code does NOT explicitly set `root`; Moonraker defaults it to `gcodes`. If a future change adds an explicit `root` field, ensure it is `gcodes` (per `.claude/skills/gcode-safety/references/k2-plus-fdm.md`).

Sign-off line for Jacob:
- [ ] Step 3 PASS  /  signed _________________  /  date __________

## Step 4 -- upload + start a 5-minute air-print (heats nothing, moves only)

The objective: prove `POST /printer/print/start?filename=<...>` lights up the print job, and that the URL-encoding of the filename matches what Moonraker expects when the path contains a sub-directory or a space.

ONLY proceed if Step 3 passed. Use a slicer-emitted "air-print" gcode that homes, then runs G1 moves with the extruder OFF and the heaters OFF. Do NOT use a real benchy yet.

1. In WorkTrackCAM, push the air-print with **Start after upload = ON**.
2. Expected app behavior:
   - Status toast: `Print started: <filename>`.
   - The printer status panel polls `/printer/objects/query?print_stats` and shows `printing -> progress -> complete` over the run.
3. Expected printer behavior:
   - Touchscreen flips to the print screen.
   - Hot-end target stays at 0 C (or whatever the slicer's start macro set it to -- the air-print profile should set 0).
   - Bed target stays at 0 C.
   - Print head homes, then runs the air moves.
4. After completion, confirm:
   - Touchscreen returns to idle.
   - `curl http://<printer-host>/printer/objects/query?print_stats` reports `state: "complete"`.

Sign-off line for Jacob:
- [ ] Step 4 PASS  /  signed _________________  /  date __________

## Step 5 -- pause / resume / cancel

The objective: prove the live-control endpoints reach the printer.

The three endpoints exercised in this step (used by `moonrakerPause`, `moonrakerResume`, and `moonrakerCancel` in `src/main/moonraker-push.ts`):

- `POST /printer/print/pause`
- `POST /printer/print/resume`
- `POST /printer/print/cancel`

Procedure:

1. Push a 10-minute air-print with start.
2. Two minutes in, click **Pause** in WorkTrackCAM. Expected: touchscreen reports paused; `print_stats.state` -> `paused`. (Wire: `POST /printer/print/pause`.)
3. Click **Resume**. Expected: touchscreen reports printing; `print_stats.state` -> `printing`. (Wire: `POST /printer/print/resume`.)
4. One minute later, click **Cancel**. Expected: print stops, head homes, `print_stats.state` -> `cancelled`. (Wire: `POST /printer/print/cancel`.)
5. Optional curl confirmation if the WorkTrackCAM UI buttons are not yet wired:
   ```
   curl -sS -m 5 -X POST http://<printer-host>/printer/print/pause
   curl -sS -m 5 -X POST http://<printer-host>/printer/print/resume
   curl -sS -m 5 -X POST http://<printer-host>/printer/print/cancel
   ```

Sign-off line for Jacob:
- [ ] Step 5 PASS  /  signed _________________  /  date __________

## E-stop / abort (K2 Plus)

The K2 Plus is the ONE machine in the My-Shop fleet that has a **clean network E-stop path**: the firmware exposes `POST /printer/emergency_stop` over Moonraker, and Klipper turns that into an `M112` firmware halt. WorkTrackCAM's red **E-stop** button in the AppHeader (top-right, always visible) targets this endpoint whenever the active machine is `creality-k2-plus`.

### What the button does

1. **Confirms first.** Clicking the AppHeader E-stop button pops a native confirm dialog (`Stop the K2 Plus now? This will halt the printer firmware (M112). Recovery requires power-cycling the printer.`). The dialog exists so a stray mouse click does not nuke a 12-hour print. There is intentionally no keyboard shortcut on the button -- you must aim and confirm.
2. **Dispatches the IPC.** On confirm, the renderer fires the E-stop IPC; the main process resolves the active machine, looks up its `kind` and dialect, and selects the K2 transport: a POST to `http://<printer-host>:7125/printer/emergency_stop`. The Moonraker URL is the same one in **Settings -> Moonraker** that the upload pipeline already uses; there is NO separate E-stop URL field.
3. **Server-side: Moonraker -> Klipper -> M112.** Moonraker translates the HTTP POST into the Klipper `EMERGENCY_STOP` command, which is the firmware-level `M112` halt. From the printer's point of view this is the **same code path** as the operator pressing M112 on the touchscreen.
4. **What `M112` does on the K2 Plus**:
   - All steppers de-energize immediately (gantry can be moved by hand from this point on, including the heavy CoreXY assembly -- support it before powering down if it is mid-air).
   - All heaters shut off (nozzle, bed, chamber).
   - The Klipper process enters a **`shutdown` state**; every subsequent G-code command in the queue is dropped.
   - The touchscreen reports `Printer is shutdown` in red.

### Recovery is power-cycle ONLY

`M112` is **not resumable**. Per Klipper's docs, after a `shutdown` the only way back to a `ready` state is:

1. Toggle the K2 Plus power switch OFF, wait 10 seconds, then ON.
2. Wait for the touchscreen to come back to the Fluidd home screen and for `klippy_state` to report `ready`.
3. Re-home the printer before any further moves (the M112 halt loses the homed position).

You **cannot** just click `Firmware Restart` in Fluidd and resume mid-print -- the print job state is gone with the shutdown. If you needed to **pause** instead of E-stop, use the **Pause** button (Step 5 above), which is the resumable path. The AppHeader red button is the **halt-the-machine-right-now** path; the toolbar **Pause** button is the **fix-something-and-come-back** path.

### What to verify on the bench

Run this sub-step at the END of Step 5, before signing off on Step 5:

1. Push a 10-minute air-print with start. Two minutes in, click the AppHeader **E-stop** button (NOT the Pause button). Confirm the native dialog.
2. Expected within 1-2 seconds:
   - The K2 Plus stops moving mid-line. Stepper torque drops audibly (faint click).
   - Touchscreen flips to red `Printer is shutdown` state.
   - `curl http://<printer-host>:7125/server/info` reports `"klippy_state":"shutdown"`.
3. Expected app behavior: a toast `E-stop sent to K2 Plus. Power-cycle the printer to recover.` and no further status polling (the renderer drops the print job from the active panel).
4. Power-cycle the printer. Confirm `klippy_state` returns to `ready` and the file list in Fluidd still contains the air-print (it was uploaded, only the run was aborted).

Sign-off line for Jacob:
- [ ] E-stop sub-step PASS (M112 halt observed, power-cycle recovered) / signed _________________ / date __________

### Cross-references

- IPC target: search `'fab:estop'` in [`src/main/ipc-fabrication.ts`](../src/main/ipc-fabrication.ts).
- Moonraker endpoint: `POST /printer/emergency_stop` (documented at <https://moonraker.readthedocs.io/en/latest/web_api/#emergency-stop>).
- Klipper `M112` reference: <https://www.klipper3d.org/G-Codes.html#m112-emergency-stop>.
- Higher-level architecture summary: [`docs/MACHINES.md`](MACHINES.md) "Emergency Stop (E-stop)" section.

## Step 6 -- failure-mode dry runs (NO printer interaction)

The objective: prove the error paths surface readable messages instead of silent hangs. Keep the printer powered on but do these from the workstation only.

| Sub-step | What to do | Expected error message contains |
| --- | --- | --- |
| 6.1 | Set the Moonraker URL to `http://192.0.2.1` (TEST-NET-1) and click Push | `could not connect` |
| 6.2 | Set the Moonraker URL to `http://<real-printer>:99` (port nothing listens on) and click Push | `could not connect` |
| 6.3 | Power off the printer, wait 10 s, click Push | `could not connect` (NOT a 5-minute hang -- the AbortController bound is `timeoutMs` per `[ID-0082]`) |
| 6.4 | Slice a hypothetical exotic-filament gcode with `M109 S400` and click Push | `Upload blocked` and `nozzle` and `400` |
| 6.5 | Set bed to `M190 S150` in a hand-edited gcode and click Push | `Upload blocked` and `bed` and `150` |
| 6.6 | Push a missing path | `not found` |

(6.4) and (6.5) are pre-upload temperature ceiling checks (`[ID-0073]`) -- they MUST short-circuit before the multipart request, which is the load-bearing safety guarantee: the doomed job never crosses the wire and the printer never wastes heat-up time.

Sign-off line for Jacob:
- [ ] Step 6 PASS (all six sub-steps)  /  signed _________________  /  date __________

## Step 7 -- the real benchy (only after 3-6 are green)

Slice a real 20x20x10 mm calibration cube (NOT a benchy yet -- a benchy is the *next* test, after the cube proves the pipeline) with the K2 Plus profile, push with **Start after upload = ON**, and watch the print. This is the END-TO-END acceptance gate for `[P2-K2-PUSH]`.

Sign-off line for Jacob:
- [ ] Calibration cube printed via WorkTrackCAM Moonraker push  /  signed _________________  /  date __________

When this line is signed, `[P2-K2-PUSH]` is DONE for the K2 Plus Definition-of-Done in CLAUDE.md PHASE 2.

## What is NOT in this checklist

- The slicer integration (`[P2-K2-SLICE]`) is a separate Phase 2 item and is currently BLOCKED on Jacob's sign-off in `docs/SLICING.md`. While it is blocked, the smoke checklist assumes the operator slices in external Cura with `resources/slicer/creality_k2_plus.def.json`. After `[P2-K2-SLICE]` lands, this checklist will be augmented with a Step 2.5 ("slice via WorkTrackCAM") and Step 7 will become the load-and-slice-and-push-and-watch single-click flow that the K2 Plus Definition-of-Done in CLAUDE.md actually requires.
- Multi-color (CFS) verification. Single-extruder first; CFS after.
- RFID filament tag verification. Out of scope for the push pipeline; the slicer profile owns it.

## Cross-references

- Wire-protocol pins: `src/main/moonraker-push-e2e.test.ts` (30 it() blocks, mock-server harness).
- Doc-tied invariant pins: `src/main/k2-moonraker-upload-contract.test.ts` (23 it() blocks, paired with `.claude/skills/gcode-safety/references/k2-plus-fdm.md`).
- Paired-pin coverage: `src/main/moonraker-push-pin.test.ts` (Cycle 311 [ID-0389]).
- Renderer payload pins: `src/renderer/src/moonraker-push-payload-pin.test.ts`.
- IPC handler: `src/main/ipc-fabrication.ts` -- search `'moonraker:push'`, `'moonraker:status'`, `'moonraker:cancel'`, `'moonraker:pause'`, `'moonraker:resume'`.
- Helper module: `src/main/moonraker-push.ts`.
- Phase 2 directive: `CLAUDE.md` `PHASE 2 -- END-TO-END INTEGRATION`.
- Sister doc: `docs/SLICING.md` (slicer integration decision; required for the full K2 Plus Definition-of-Done).
