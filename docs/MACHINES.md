# Machines — profile reference & safety notes

> **Audience.** Operators about to run WorkTrackCAM-generated G-code on a real machine. Before you bolt the part in, read the section for your machine.

Machine profiles live in [`resources/machines/`](../resources/machines/) as JSON files. Each profile pins down the work envelope, spindle range, axis count, A-axis orientation (if rotary), post-process dialect, and which Handlebars template renders the final G-code. Profiles are validated at load time against [`src/shared/machine-schema.ts`](../src/shared/machine-schema.ts); an invalid profile is rejected before any toolpath runs. **All numeric fields are millimeters or mm/min** — there is no inch variant.

You almost never edit these files by hand. Use the **Library** drawer in-app to add or override a profile; user profiles live in `{userData}/machines/` and win over bundled ones with the same `id`.

## Bundled profiles

WorkTrackCAM ships four production profiles — one per supported environment. Every field listed below is enforced by the runtime validator and fed into the post processor for the header, WCS block, spindle dialect, and envelope checks.

### `makera-carvera-3axis` — Makera Carvera (3-axis mode)

The standard Carvera envelope with the 3-axis post. Uses the ATC (automatic tool changer) and the wireless probe. Smoothieware controller.

- **Work area:** 360 × 240 × 140 mm (X × Y × Z)
- **Spindle:** 6,000 – 15,000 RPM
- **Feed cap:** machine default (no artificial clamp in the profile)
- **Dialect:** `grbl` — emits `M3 Snnnn` / `M5` from [`post-process-dialects.ts`](../src/main/post-process-dialects.ts)
- **Post template:** [`carvera_3axis.hbs`](../resources/posts/carvera_3axis.hbs)
- **Program end:** `M2` (see *Smoothieware quirks* below — **not M30**)
- **ATC:** available. `M6 Tn` for slot `n`, `G43 Hn` for tool length comp. Profile pins `atcSlotCount: 6` (T1-T6 cutting tools) and `atcProbeSlot: 0` (T0 wireless probe), matching CLAUDE.md USER CONTEXT #3. The post-processor consumes these fields via [`deriveAtcCapability`](../src/shared/post-process-atc-capability.ts) -- a discriminated-union helper that returns `{ supported: true, slotCount: 6, probeSlot: 0 }` for this machine. See roadmap [ID-0093].

### `makera-carvera-4axis` — Makera Carvera with 4th Axis HD attachment

Same base machine as the 3-axis profile, but the 4th Axis HD rotary attachment has been installed on the table. The rotary chuck occupies the ATC zone, so **ATC is disabled in 4-axis mode** -- tool changes are manual. The bundled `makera-carvera-4axis.json` profile intentionally OMITS both `atcSlotCount` and `atcProbeSlot`, which makes [`deriveAtcCapability`](../src/shared/post-process-atc-capability.ts) return `{ supported: false, reason: 'no-atc-slots' }` for this machine without any axis-count special case (the profile JSON is the single source of truth). See roadmap [ID-0093].

- **Work area:** 240 × 92 × 46 mm (X × Y × Z, reduced from the 3-axis envelope because the rotary fixture consumes table real estate)
- **A-axis range:** effectively continuous (profile encodes `aAxisRangeDeg: 99999` as a sentinel for "no soft limit")
- **A-axis orientation:** rotates around X (stock is clamped horizontally along the X axis)
- **Max rotary speed:** 6 RPM (this is the physical rotary speed limit, not spindle)
- **Spindle:** 6,000 – 15,000 RPM (same as 3-axis)
- **Feed cap:** 2,400 mm/min (conservative; the post-compile envelope check enforces this)
- **Dialect:** `grbl_4axis` — emits `M3 S12000` / `M5` defaults; job overrides spindle via post input
- **Post template:** [`carvera_4axis.hbs`](../resources/posts/carvera_4axis.hbs)
- **Program end:** `M2`
- **Stock origin convention:** Z=0 is the rotation axis (stock center), **not the stock surface**. This is non-negotiable for rotary work; the post header calls it out explicitly.
- **Rotary chuck outer radius:** `rotaryChuckOuterRadiusMm: 46` — half the 92 mm HD module diameter from CLAUDE.md. This is the conservative radial clearance floor used by the on-by-default rotary-collision sweep in [`src/main/cam-axis4/index.ts`](../src/main/cam-axis4/index.ts) when a job does not supply an explicit `rotaryFixture`. Absent → sweep stays opt-in; present → every 4-axis job is swept for chuck-body collisions automatically (see roadmap [ID-0008]).

### `laguna-swift-5x10` — Laguna Swift 5×10 (VCarve Pro environment)

Large flat-bed router. Used through VCarve Pro toolpaths; WorkTrackCAM emits Mach3 dialect.

- **Work area:** ~1,524 × 3,048 mm table (profile `workAreaMm.z: 203` mm — gantry under-clearance)
- **Dialect:** `mach3` — the Laguna Swift's RichAuto A-series handheld accepts Mach3 G-code as a strict superset (`G21`, `G90`, `G17`, `G0`/`G1`/`G2`/`G3`, `M3`/`M5`, `S`, `F`, `M7`/`M9`, `M30`, and `%` tape markers are all honored). See the [`vcarve_mach3.hbs`](../resources/posts/vcarve_mach3.hbs) preamble for the per-feature rationale; roadmap [ID-0004] / [ID-0063] track the decision history.
- **Post template:** [`vcarve_mach3.hbs`](../resources/posts/vcarve_mach3.hbs)
- **Spindle:** 8,000 – 18,000 RPM (clamped by the post template; out-of-range RPM emits a warning and is clipped before the header)
- **Spindle HP variant:** `spindleVariantHp: 3` — the bundled profile pins the 3 HP liquid-cooled spindle. Set to `6` in a user override for the 6 HP variant. Schema accepts only the literal union `3 | 6` — any other value is rejected at load. See roadmap [ID-0005].
- **Vacuum zone count:** `vacuumZoneCount: 6` — six-zone hold-down table typical for the 5×10 Swift. The bundled profile value is the source of truth for downstream code; the 6-zone allocator landed in Cycle 98 as [`laguna-vacuum-allocator.ts`](../src/shared/laguna-vacuum-allocator.ts) ([ID-0014b]). The renderer-side allocator UI ([ID-0020]) is still on the NEXT-UP queue.
- **Sheet stock presets:** [`laguna-full-sheet-stock.ts`](../src/shared/laguna-full-sheet-stock.ts) ([ID-0014]) exposes three planforms — full sheet (48 × 96 in), half sheet (48 × 48 in), and quarter sheet (24 × 48 in) — plus four common thicknesses (1/4, 1/2, 3/4, 1 in) and two materials (plywood, MDF). `resolveLagunaFullSheet(planformId, thicknessId, options)` is the one-shot helper that returns `{stock, fit, originMm}`.
- **6-zone vacuum allocator:** [`laguna-vacuum-allocator.ts`](../src/shared/laguna-vacuum-allocator.ts) ([ID-0014b]) computes per-zone engagement for a placed sheet. Default-origin (margin = 0) engagement: full sheet → all 6 zones, half sheet → 4 zones (back + mid rows of both columns), quarter sheet → 2 zones (back-left + mid-left only). `allocateLagunaVacuumZonesForSheet(planformId, options)` is the one-shot helper bundling stock + fit + origin + allocation.
- **Safe retract Z:** `safeRetractZMm: 25` — conservative rapid-plane height (mm) the post processor rapids to before lateral moves, tool changes, and program end. Post templates still fall back to `workAreaMm.z` when this field is absent; present value overrides. See roadmap [ID-0005].
- **Dust collection:** `dustCollection?: boolean` job flag (per-job, not per-machine). Unset → post emits commented reminder lines (`; M7 / ; M9`). Set → real `M7` is emitted after spindle warm-up and `M9` before spindle cool-down. See roadmap [ID-0004] / [ID-0064].

### `creality-k2-plus` — Creality K2 Plus (FDM environment)

3D printer profile. No CAM is generated for this — the FDM path runs slicer output through a passthrough template so the rest of the pipeline stays consistent.

- **Kind:** `fdm` (not `cnc`)
- **Work area:** 350 × 350 × 350 mm (matches bed size; any larger slicer `machine_*` value would crash the gantry on first print — see roadmap [ID-0006])
- **Max feed:** 18,000 mm/min
- **Post template:** [`fdm_passthrough.hbs`](../resources/posts/fdm_passthrough.hbs)
- **Dialect:** `generic_mm`

#### FDM capability fields (CLAUDE.md USER CONTEXT #1)

All seven fields are **optional** — absent fields fall back to slicer-definition defaults, preserving Safety Rule 2 for pre-existing saved projects. The bundled K2 profile sets every field.

| Field | K2 value | Units / type | Consumer |
|---|---|---|---|
| `maxNozzleTempC` | `350` | positive number, °C | Slicer profile + pre-upload validator ([`gcode-temp-validator.ts`](../src/shared/gcode-temp-validator.ts)). Any `M104`/`M109` target above this rejects the upload. |
| `maxBedTempC` | `120` | positive number, °C | Slicer profile + pre-upload validator. Any `M140`/`M190` target above this rejects the upload. |
| `chamberTempC` | `60` | positive number, °C | Slicer profile (sets CuraEngine `machine_heated_build_volume=true` + `build_volume_temperature`) + pre-upload validator for `M141` / Klipper `SET_HEATER_TEMPERATURE HEATER=chamber`. Absent → machine treated as having no heated chamber. |
| `inputShapingPresets` | `["ZV","MZV","EI","2HUMP_EI","3HUMP_EI"]` | non-empty string[] | Slicer UI preset picker. Each entry must be a non-empty trimmed string. |
| `rfidFilamentSupport` | `true` | boolean | UI filament picker surface (RFID spool auto-detect). |
| `cfsMultiColorEnabled` | `true` | boolean | UI multi-extruder / multi-color assignment surface (Creality CFS). |
| `powerLossRecovery` | `true` | boolean | Slicer-generated resume metadata (firmware capability advertisement). |

#### Moonraker upload safety pipeline (K2 Plus)

The K2 Plus ships Creality Klipper + Moonraker + Fluidd, so WorkTrackCAM pushes sliced G-code directly via the Moonraker HTTP API. Two guard layers sit in front of the upload and both are enforced automatically when an FDM profile declares the ceilings above:

1. **Pre-upload temperature validation.** Before the multipart upload starts, [`src/main/moonraker-push.ts`](../src/main/moonraker-push.ts) reads the G-code header (bounded to 128 KiB via [`src/main/gcode-header-read.ts`](../src/main/gcode-header-read.ts) — see roadmap [ID-0075]), parses every `M104`/`M109`/`M140`/`M141`/`M190` and Klipper `SET_HEATER_TEMPERATURE HEATER=chamber TARGET=…` command, and cross-checks each target against the active machine profile's declared ceilings. On any violation the function returns early with `ok: false`, attaches a structured `tempValidation` result, and **no bytes cross the network**. On the `startAfterUpload: true` path the `/printer/print/start` POST is also skipped. See roadmap [ID-0070] / [ID-0071] / [ID-0073].
2. **IPC-layer capability resolution.** The renderer only has to pass `machineId` to the `moonraker:push` IPC handler; [`src/main/ipc-fabrication.ts`](../src/main/ipc-fabrication.ts) resolves the machine profile, extracts the FDM capability subset, and threads it into `moonrakerPush`. Explicit `machineCapabilities` on the payload still wins (including explicit `null` to opt out). See roadmap [ID-0078].

Equality at the ceiling passes (firmware accepts temp equal to the limit). Absent ceilings are pass-through (the upload proceeds exactly as it did pre-[ID-0073]). The upload stream itself is unaffected — the bounded header read is used only for validation, the multipart body still transmits the full file byte-for-byte.

## ATC capability (per-machine summary)

The ATC (automatic tool changer) capability is derived from the active machine profile by [`deriveAtcCapability`](../src/shared/post-process-atc-capability.ts) -- a pure helper in `src/shared/` so every consumer (post-process renderer, sequencing helper, future renderer UI hint) agrees on the same answer. The helper returns a discriminated union (`{ supported: false, reason } | { supported: true, slotCount, probeSlot? }`) so call sites can pattern-match on `.supported` and only access slot details on the supported branch (Safety Rule 3: zero `any`).

The two new schema fields landed in Cycle 55 [ID-0093]:

- `atcSlotCount?: number` -- Optional positive integer. Number of *cutting* tool slots (T1..T`atcSlotCount`). Absent or `undefined` means the machine has no ATC.
- `atcProbeSlot?: number` -- Optional non-negative integer. ATC slot reserved for the wireless tool-length probe (Carvera convention: `0` = T0). When undefined, callers must not emit a probe-driven tool-length compensation step.

Per-machine capability summary for the three target machines (CLAUDE.md USER CONTEXT):

| Machine | `atcSlotCount` | `atcProbeSlot` | `deriveAtcCapability` result | Reason |
|---|---|---|---|---|
| `creality-k2-plus` | (n/a) | (n/a) | `{ supported: false, reason: 'fdm' }` | FDM printer; no tool changer concept. The helper short-circuits on `kind === 'fdm'` before reading the ATC fields. |
| `laguna-swift-5x10` | (absent) | (absent) | `{ supported: false, reason: 'no-atc-slots' }` | Manual ER-20 collet change. The bundled profile leaves both fields unset. |
| `makera-carvera-3axis` | `6` | `0` | `{ supported: true, slotCount: 6, probeSlot: 0 }` | Six cutting slots T1-T6 plus the T0 wireless probe. |
| `makera-carvera-4axis` | (absent) | (absent) | `{ supported: false, reason: 'no-atc-slots' }` | Same base machine as the 3-axis profile, but the 4th Axis HD rotary attachment occupies the ATC bay. The profile JSON is the single source of truth -- no `axisCount`-driven branch in the helper. |

**M-code emission lands in a follow-up cycle.** Cycle 55 is the FIRST half of [ID-0093] -- the *flag + test fixtures* land in `src/shared/machine-schema.ts` + the bundled profile JSONs + the `deriveAtcCapability` helper, all under tests. The Carvera 3-axis Handlebars template will plumb the helper through behind a job flag in a follow-up post-processing cycle, once profile coverage is complete (Safety Rule 1: G-code is sacred -- ship the read-side schema/helper plumbing under tests before the write side touches a single template).

## Smoothieware quirks (Carvera)

The Carvera runs Smoothieware firmware, which deviates from standard Fanuc/GRBL in two places that matter for job safety.

1. **Never emit `M30`.** On Smoothieware, `M30` has historically been interpreted as "delete the file from the SD card" rather than "program end." Both Carvera posts end programs with `M2` instead. The post templates hard-code this and the dialect-safety test suite asserts no `M30` appears in any Carvera-dialect output. If you roll your own template, do the same.
2. **Spindle dwell after `M3`.** The spindle is a DC motor that takes a couple seconds to reach commanded RPM. Both Carvera posts insert `G4 P2` (2-second dwell) after spindle-on and before the first feed move. Skip this at your peril — first-pass chatter and carbide chipping result.

Beyond those two, the 4-axis post adds a third rule: the initial motion block parks `Y0` before any feed move, because the rotary attachment places the workpiece centerline on the Y=0 plane. Any motion with `Y ≠ 0` during a 4-axis job either collides with the chuck or cuts where you didn't intend.

## Dialect reference

`dialect` picks the default spindle snippet and units line used by the post. Defined in [`src/main/post-process-dialects.ts`](../src/main/post-process-dialects.ts). All dialects emit `G21` millimeters.

| Dialect | Default spindle on | Notes |
|---|---|---|
| `grbl` | `M3 S12000` | Carvera 3-axis. |
| `grbl_4axis` | `M3 S12000` | Carvera 4-axis. Job RPM overrides at post time. |
| `mach3` | `M3` | No S-word default; VCarve supplies it. |
| `mach3_4axis` | `M3 S12000` | |
| `fanuc` | `M3 S10000` | |
| `fanuc_4axis` | `M3 S10000` | |
| `siemens` | `M3 S10000` | |
| `siemens_4axis` | `M3 S10000` | |
| `heidenhain` | `M3 S10000` | |
| `heidenhain_4axis` | `M3 S10000` | |
| `linuxcnc_4axis` | `M3 S12000` | |
| `generic_mm` | `M3 S10000` | Passthrough/FDM. |

If your controller is not on this list, copy the closest dialect, change the profile's `id`, and exercise [`post-process-dialect-safety.test.ts`](../src/main/post-process-dialect-safety.test.ts) against it before running a real cut.

## Emergency Stop (E-stop)

WorkTrackCAM hosts a red **E-stop** button in the **AppHeader** (top-right of the window, **always visible** regardless of which workspace you are in -- Design, Manufacture, Workshop, Settings). It is the single in-app affordance for "stop the active machine right now." This section is the architecture summary; the per-machine **bench drills** live in the SMOKE docs cross-referenced below.

### Architecture in one paragraph

The AppHeader button is a renderer-side component. Clicking it pops a **native confirm dialog** (browser/Electron `confirm()`) before any IPC fires -- this is the load-bearing guard against an accidental mouse click halting a real machine. On confirm, the renderer dispatches the **`fab:estop` IPC** (search [`src/main/ipc-fabrication.ts`](../src/main/ipc-fabrication.ts)). The main process resolves the **active machine** from the project state, looks at the machine's `kind` + `dialect` + transport fields, and picks the correct per-machine handler. There is exactly **one** AppHeader button and **one** IPC entry point; the per-machine branching happens server-side so the renderer never has to know which transport applies.

### Per-machine E-stop summary

| Machine | Path | Confirms first? | Recovery | Primary path |
|---|---|---|---|---|
| `creality-k2-plus` | **Network** -- `POST /printer/emergency_stop` (Moonraker) -> Klipper `M112` firmware halt | Yes (native confirm) | **Power-cycle required** -- `M112` is not resumable | In-app button is **safe to use as primary** (deterministic, observable, well-tested upstream) |
| `makera-carvera-3axis` / `makera-carvera-4axis` | **Partial** -- spawn `carvera-cli` with an abort subcommand. CLI abort support is **not fully verified** across CLI versions | Yes (native confirm) | Depends on CLI outcome: success -> Carvera reports aborted; silent failure -> spindle keeps running and operator must hit physical e-stop | **Physical e-stop on the Carvera bezel** is the primary path. The in-app button is a backup that may or may not succeed |
| `laguna-swift-5x10` | **None** -- no remote abort path exists by design. The RichAuto A-series pendant has no network abort API | Yes (native confirm) | n/a -- pendant or control-box E-stop required | **Physical pendant E-stop** (or control-box E-stop) is the only abort. The in-app button shows a reminder toast pointing the operator at the physical controls; **no bytes leave the workstation** |

### Confirm-before-fire rule

Every machine's E-stop path goes through the native confirm dialog **before** the IPC fires. The confirm wording is **machine-specific**: it tells the operator what is about to happen and what the recovery posture is. For the K2 the wording mentions the M112 halt and the power-cycle. For the Carvera the wording warns that the CLI abort is not fully verified and recommends the physical e-stop. For the Laguna the wording tells the operator there is no network abort path and points them at the pendant. This wording lives in the renderer-side button component, NOT in a per-machine string table, because the operator is reading it under stress and the words have to match exactly what the IPC is about to do.

The confirm dialog cannot be bypassed. There is intentionally no keyboard shortcut for E-stop -- a typo on the keyboard during a 12-hour print or a 4-axis rotary cycle is exactly the kind of accident the confirm guard exists to prevent.

### Why three different paths?

The three machines have **three fundamentally different abort architectures** that WorkTrackCAM intentionally surfaces honestly rather than abstracting over:

- **K2 Plus** ships an open, documented network API (Moonraker) that exposes a clean firmware-halt endpoint. The community ecosystem has used `M112`-over-Moonraker in production for years. WorkTrackCAM can safely target this as a first-class abort path.
- **Carvera** ships a closed first-party desktop app (Makera Controller) that has no headless mode. The community CLI we use for uploads (`carvera-cli`) **also** offers an abort subcommand, but its abort path has not stabilized across the CLI version history. WorkTrackCAM exposes the partial path while being explicit that the **physical e-stop is the primary**.
- **Laguna** runs through a closed pendant (RichAuto A-series) with no documented remote-abort API. The bytes leave WorkTrackCAM on a USB stick and the workstation has no path to the running cycle at all. Adding a fake remote abort would be **dangerous** (the operator might be misled into believing a network stop was in flight); a reminder toast is the safest possible behavior.

Pretending all three machines have the same E-stop story would be a safety lie. The docs and the UI both call out the difference so the operator knows what they actually have.

### Per-machine bench drills

Each SMOKE doc has a dedicated **E-stop / abort** sub-step that the operator runs on hardware before treating the in-app button as load-bearing:

- **K2 Plus**: [`docs/SMOKE-K2-MOONRAKER.md`](SMOKE-K2-MOONRAKER.md) -- "E-stop / abort (K2 Plus)" section. Includes a live-cycle drill that proves the M112 halt and the power-cycle recovery.
- **Carvera**: [`docs/SMOKE-CARVERA-CLI.md`](SMOKE-CARVERA-CLI.md) -- "5a. E-stop / abort (Carvera)" section. Includes a CLI-abort drill that explicitly records which CLI version supports the abort path on the operator's machine.
- **Laguna Swift 5x10**: [`docs/SMOKE-LAGUNA-RICHAUTO.md`](SMOKE-LAGUNA-RICHAUTO.md) -- "E-stop / abort (Laguna)" section. Includes a tabletop drill verifying the reminder toast wording and the physical E-stop reachability.

Operators must run the relevant sub-step **once per machine** before relying on the AppHeader button.

### Cross-references

- AppHeader location: search `AppHeader` in [`src/renderer/src/`](../src/renderer/src/) -- the button is rendered at the top-right.
- IPC entry point: `'machine:estop'` in [`src/main/ipc-machine.ts`](../src/main/ipc-machine.ts).
- K2 transport: Moonraker `POST /printer/emergency_stop` -- documented at <https://moonraker.readthedocs.io/en/latest/web_api/#emergency-stop>; Klipper M112 documented at <https://www.klipper3d.org/G-Codes.html#m112-emergency-stop>.
- Carvera transport: [`src/main/carvera-cli-run.ts`](../src/main/carvera-cli-run.ts) spawn helper, same path the upload pipeline uses.
- Laguna transport: none (by design). The in-app button shows a toast and returns.

## Safety — verifying posted G-code

Every G-code file WorkTrackCAM posts is **unverified** until you prove it out on your control. The post templates say so in the header comments. Do this every time, especially after a profile or post-template change.

1. **Open the `.nc` file and read the first 20 lines.** Confirm units (`G21`), absolute mode (`G90`), the right WCS (`G54`–`G59` per your fixture), spindle-on M-code, and safe Z retract are present in that order.
2. **Scan the last 10 lines.** The program end should be `M2` for Carvera, `M30` for most other controllers. Spindle should be `M5`, coolant should be off (`M9`), and the machine should park somewhere safe.
3. **Run the machine envelope check.** The posted G-code already carries an "envelope hint" in the CAM result (visible in the CAM panel). If it warns, do not run the job. Double-check stock dimensions and WCS against the actual fixture.
4. **Air-cut before chips.** Spindle off, Z raised by at least one full stock thickness, feed override at 10%. Watch the full cycle through. For 4-axis, watch rotary excursions at each tool change and at program start (the home `A0` move can sweep through fixtures on some setups).
5. **Compare to a known-good Makera CAM file.** For Carvera users coming from Makera CAM, keep one working `.nc` file from the old tool as a reference for spindle blocks, WCS, and program end. The Carvera 4-axis post's header comments recommend this explicitly.

## Adding a custom profile

If you run a machine WorkTrackCAM doesn't bundle, add a profile via the Library drawer (preferred) or drop a JSON file into `{userData}/machines/`.

Minimum fields — required by the schema:

- `id` — unique string, used by `project.json` as `activeMachineId`
- `name` — display name
- `kind` — `"cnc"` or `"fdm"`
- `workAreaMm` — `{x, y, z}` in mm
- `postTemplate` — filename in [`resources/posts/`](../resources/posts/)
- `dialect` — from the table above

For 4-axis machines, also set:

- `axisCount: 4`
- `aAxisOrientation` — `"x"` or `"y"` (the axis the rotary rotates around)
- `aAxisRangeDeg` — soft travel limit in degrees, or a large sentinel for continuous rotation
- `maxRotaryRpm` — physical rotary speed cap

Exercise [`machine-schema.test.ts`](../src/shared/machine-schema.test.ts) against any new profile before running a cut — a typo in `dialect` or `axisCount` will break the post silently if you skip validation.

## Related docs

- [`CAM_4TH_AXIS_REFERENCE.md`](./CAM_4TH_AXIS_REFERENCE.md) — end-to-end runbook for the first wrapped job on the Carvera 4th axis
- [`resources/machines/README.md`](../resources/machines/README.md) — quick profile summary
- [`resources/posts/README.md`](../resources/posts/README.md) — post template context reference
