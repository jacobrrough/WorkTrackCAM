# Laguna Swift 5x10 -- RichAuto A-series transfer smoke checklist

**Audience**: Jacob (Palmdale, CA shop) running G-code emitted by WorkTrackCAM on the **Laguna Swift 5x10** through its **RichAuto A-series handheld pendant** for the first time. This is the bench procedure to verify the post-process pipeline reaches the controller, the controller accepts the file, and the spindle behaves the way the post header advertises.

**Last updated**: 2026-06-01.

**Companion docs**:
- Mach3/RichAuto dialect reference: [`.claude/skills/gcode-safety/references/laguna-swift.md`](../.claude/skills/gcode-safety/references/laguna-swift.md)
- Machine profile reference: [`docs/MACHINES.md`](MACHINES.md)
- Sister smoke checklist (K2 Plus): [`docs/SMOKE-K2-MOONRAKER.md`](SMOKE-K2-MOONRAKER.md)

> **Safety posture (read first)**: this checklist runs a real spindle on real stock. The Laguna has **no machine-side guards** -- no soft limits on the pendant in the same way Mach3 enforces them, no kill on the post side once the file is on the USB. The post-flight Step 3 spindle warm-up + 1% feed override air-cut is the only safety net before a production cut. Do NOT skip it.

## Prerequisites

| Item | Required state | Where to check |
| --- | --- | --- |
| Main breaker + control panel powered | ON | wall disconnect, then pendant LCD lit |
| E-stop reachable from operator position | physical mushroom button untwisted | pendant + control box |
| Dust collection | wired, hose seated on the spindle shroud, dust gate to the correct branch OPEN | shop dust manifold |
| Vacuum pump (if using the 6-zone table) | primed, zone valves at the pendant set to OFF before cycle start | RichAuto pendant + bed manifold |
| Spindle warm-up state | spindle has run at least 60-120 s at 6,000 RPM no-load if it has been idle >24 h | manual jog from pendant |
| Tool installed and length-set | V-bit at sharp tip / end mill at flute bottom / drill at tip, runout checked | dial indicator at the spindle nose |
| Stock | clamped flat to spoilboard, no warps under the bit path; vacuum zones armed only where stock covers (CLAUDE.md USER CONTEXT #2 -- 6-zone bed, controlled from the pendant, NOT G-code) | bed |
| USB stick | FAT32 formatted, <16 GiB recommended, no spaces or non-ASCII in filenames | workstation file explorer |

Do NOT run this on a machine someone else is wiring into or working under. The Laguna's 60" x 120" envelope (CLAUDE.md USER CONTEXT #2 -- `workAreaMm` 1524 x 3048 x 203 mm) means the gantry sweeps a large body of air at full feed; clear the keep-out zone before cycle start.

## Step 1 -- post and export from WorkTrackCAM

The objective: emit a `.nc` (or `.mmg` / `.prg` if your saved jobs use those extensions) file with the right Mach3-superset header for the RichAuto A-series.

1. In WorkTrackCAM, open the **My Shop** quick-select and pick **Laguna Swift 5x10**.
2. Confirm the active machine card shows:
   - Work envelope: `1524 x 3048 x 203 mm` (60" x 120" x ~8")
   - Spindle range: `8000-18000 RPM` (CLAUDE.md USER CONTEXT #2 documents the 6,000-24,000 RPM hardware ceiling; the bundled 3 HP profile clamps to 8000-18000 RPM -- if you need to run a 6 HP variant outside that band, duplicate the profile in the Library drawer rather than editing the bundled one)
   - Post template: `vcarve_mach3.hbs` (this is the production post for VCarve Pro / Mach3-class output -- the RichAuto A-series accepts Mach3 G-code as a strict superset per [`.claude/skills/gcode-safety/references/laguna-swift.md`](../.claude/skills/gcode-safety/references/laguna-swift.md))
   - Dialect: `mach3`
3. If your job is a 2D wood-routing program for the VCarve Pro environment, keep `vcarve_mach3.hbs`. If you have hand-authored a generic 3-axis program that needs neither `%` tape markers nor the spindle cool-down ramp, you may swap to `cnc_generic_mm.hbs` in the post-template field -- but the default and recommended template for the Laguna is `vcarve_mach3.hbs`.
4. In the manufacture / fabrication panel, set:
   - **Spindle RPM**: within the 8000-18000 band the profile pins. Wood routing: 12000-18000 typical.
   - **Dust collection**: ON if your dust hood is wired to the M7/M9 digital output (the post will emit `M7` after the warm-up dwell and `M9` before the cool-down ramp). If your dust hood is on a manual switch, leave this OFF and operate the hood by hand at cycle start.
   - **WCS**: pick the G54-G59 offset that matches the fixture zero you set at the stock corner.
5. Click **Post and export**. The file extension follows your project preference -- the post itself emits standard G-code that the RichAuto A-series accepts regardless of extension (`.nc` is the conventional default for wood routing; `.mmg` / `.prg` are also accepted -- the controller dispatches by file contents, not extension).
6. Save directly to the root of the USB stick or into a single sub-directory (see Step 2 for the depth limit).
7. **Sanity-check the file before unplugging the USB**:
   - First non-blank line: `%` (Mach3 program tape start marker).
   - Within the first 10 lines: `G21`, `G90`, `G17`, `G94` (units / absolute / XY plane / feed-per-min -- header invariants from [`.claude/skills/gcode-safety/references/laguna-swift.md`](../.claude/skills/gcode-safety/references/laguna-swift.md)).
   - Spindle-on block: `M3 S<rpm>` followed by `G4 P2.0` (2-second warm-up dwell).
   - If dust collection was ON: an `M7` line after the dwell and an `M9` line before the spindle-off block.
   - Footer: `M5`, `G4 P3.0` (3-second cool-down dwell), `G0 Z203`, `G0 X0 Y0`, `M30`, `%`.
   - The terminator MUST be `M30`, NOT `M2`. `M2` is the Carvera's terminator and will leave the RichAuto in an undefined state.

Sign-off line:
- [ ] Step 1 PASS  /  signed _________________  /  date __________

## Step 2 -- physical transfer to the pendant

The objective: get the file onto a USB stick the RichAuto A-series can read.

1. Eject the USB stick from the workstation cleanly (avoid mid-write corruption).
2. Plug the USB stick into the **USB-A port on the RichAuto A-series pendant** (NOT into the control box -- the control box port is for firmware updates, not G-code).
3. Sub-directory depth: keep G-code in the root of the USB or in **one** sub-directory (e.g. `/laguna/job-001.nc`). Deeper trees are sometimes truncated by the pendant's file browser; if a file does not appear after Step 3.1, flatten the directory tree and re-insert.
4. Filename: ASCII only, no spaces, no quotes, <32 characters before the extension. The RichAuto pendant truncates long filenames in the LCD and will silently use the truncated name for status messages, which makes "wrong file selected" easy to do.

## Step 3 -- pendant operation (air cut)

The objective: prove the file selection, manual home, dust-collection M-code, and spindle warm-up work end-to-end with the bit safely above the stock.

1. On the pendant, navigate to the **USB / File** menu and select the file you just saved. Confirm the filename on the LCD matches what you exported.
2. **Manual home check**: jog X, Y, Z to confirm each axis moves the right direction with the correct sign. Reference the WCS origin you set in Step 1.4 (G54-G59). If you fixture-zeroed at the stock corner with X+ pointing right and Y+ pointing away from the operator, jogging X+ on the pendant should move the spindle right.
3. **Lift Z high** (manually jog to at least 150 mm above the stock surface, well below the 203 mm safe-Z that the post header retracts to but well above any clamp).
4. **Dust collection**: if your dust hood is on the M7/M9 digital output and `dustCollection` was ON in Step 1.4, the program will trigger the hood on its own after the warm-up dwell. If your hood is on a manual switch, switch it ON now.
5. **Spindle warm-up**: even though the post emits `M3 S<rpm>` followed by `G4 P2.0` (2-second warm-up dwell), a cold spindle benefits from a manual ramp BEFORE the program starts. From the pendant MDI:
   - `M3 S6000` -- start the spindle low.
   - Wait 30-60 s.
   - `M3 S12000` -- ramp to mid-RPM. Wait 30 s.
   - `M5` -- stop. The bearings are now at temperature for the program's commanded RPM.
6. **Feed override to 1%**: on the pendant, dial the feed-rate override down to 1% (or the lowest setting your A-series supports -- some firmware revs floor at 10%). This makes every G1 move so slow that an XY collision into a clamp or vacuum hose during the air cut is reversible.
7. **Start the program**. The bit should NOT touch the stock -- you lifted Z high in Step 3.3. Watch the gantry move through the toolpath shape in the air for at least the first 10-20 lines.
8. **Pause and reset**: pendant `Pause` / `Stop`, then return to file menu. The air cut proved the file is readable, the spindle ramp works, and the toolpath has the right XY shape.

Sign-off line:
- [ ] Step 3 PASS (air cut at 1% feed override, spindle ramped, no collisions)  /  signed _________________  /  date __________

## Step 4 -- production run

ONLY proceed if Step 3 passed. This is the first cut into real stock.

1. **Vacuum table** (6-zone): arm only the zones the stock physically covers. Per [`.claude/skills/gcode-safety/references/laguna-swift.md`](../.claude/skills/gcode-safety/references/laguna-swift.md), the post does NOT emit zone-on / zone-off M-codes -- vacuum is controlled from the RichAuto pendant, NOT from G-code. Arming a zone that the stock does not cover leaks the manifold and can drop hold-down pressure on the active zones.
2. **Full-sheet plywood overrides**: for a 4' x 8' plywood sheet that fills most of the 60" x 120" envelope, expect feed overrides at 80-100% for the body of the cut and 50-75% for the lead-in plunge. Cap the spindle at 18000 RPM per the bundled profile (CLAUDE.md USER CONTEXT #2 -- the hardware allows up to 24000 RPM, but the bundled 3 HP profile pins 18000 RPM as the production ceiling).
3. **Surfacing pass guidance**: when running a surfacing program over the spoilboard or a fresh MDF panel, take 0.5-1.0 mm depth per pass with a 50-100 mm flycutter. The Laguna's helical rack-and-pinion X/Y allows aggressive feeds (the profile pins `maxFeedMmMin: 12000`), but a surfacing pass typically runs 4000-8000 mm/min to leave a clean finish. The 3-second cool-down dwell in the footer matters here -- the spindle decelerates before the final Z retract so a coasting bit cannot fling loose when it brushes a part edge during the rapid.
4. **Watch the first 30 seconds of the cut**. If you hear chatter, see the dust hose lift off the shroud, or notice the gantry stutter, hit pause from the pendant immediately. The 1% air-cut in Step 3 cannot catch chatter or hold-down issues that only appear under cut load.
5. After the cut completes, confirm the pendant LCD reports the program ended cleanly. The post emits `M30` at the end, which returns the RichAuto to its idle state.

Sign-off line:
- [ ] Step 4 PASS (first production cut completed, no chatter, vacuum held, no terminator surprises)  /  signed _________________  /  date __________

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| **File not found on pendant** | Saved deeper than 1 sub-directory, or used a non-ASCII / spaced filename | Flatten the directory tree to root or one sub-directory; rename to ASCII-no-spaces; re-insert the USB |
| **Pendant displays the file but reports "format error"** | USB stick is NTFS or exFAT (some A-series revs only accept FAT32) | Reformat the USB to FAT32 on the workstation; re-export and re-insert |
| **Coordinates come out 25.4x too small** | Controller booted in inches (G20) and the post header's `G21` did not register (rare, but possible if the program tape `%` marker was stripped) | Confirm Step 1.7 -- the first non-blank line MUST be `%`. Re-export if missing |
| **Decimal-comma mistakes** -- coordinates like `X1,524` or `Y3,048` rejected | Workstation locale wrote a comma as the decimal separator in a hand-edited file | Open the `.nc` in a text editor and replace `,` with `.` -- the post never emits comma-decimal output; this is only a risk if the file was hand-edited on a non-English locale workstation |
| **Pendant reports "unsupported G-code" mid-program** | A line from a custom post or hand-edit uses syntax outside the Mach3 superset (e.g. canned drilling cycles G81/G83 from a Fanuc post pasted in) | Re-export from WorkTrackCAM using the bundled `vcarve_mach3.hbs` template -- it emits only G0/G1/G2/G3/G4 + M3/M5/M7/M9/M30, all in the A-series accepted set |
| **Spindle does not start** -- toolpath runs in the air with the spindle silent | Spindle-on M-code stripped, OR the VFD is in a fault state from a prior overcurrent | Confirm the `.nc` contains `M3 S<rpm>` BEFORE the first G1. Check the VFD panel for a fault code; clear and re-arm before re-running |
| **Dust hood does not fire when `dustCollection` was ON** | The hood is wired to a different M-code (some Laguna installs use M8 or a custom M-code) | Either wire the hood to the M7 output, OR re-export with `dustCollection: false` and switch the hood manually at cycle start |
| **Program ends but pendant stays in "running" state** | Footer terminator is `M2` instead of `M30` (cross-contamination from a Carvera template) | Re-export -- the `vcarve_mach3.hbs` template always emits `M30`. If you see `M2`, the wrong template was used |

## Safety

- **Dust collection mandatory**: wood routing without dust collection puts respirable particulate into the shop air and packs the spindle bearings with fines, killing the spindle prematurely. The post emits `M7` / `M9` when `dustCollection` is ON; if your hood is on a manual switch, switch it on at the start of every cut.
- **RPM ramp**: never start a cold spindle directly at 18000 RPM. Use the Step 3.5 manual ramp (6000 -> 12000 -> commanded RPM with 30-60 s dwells) before the first cut of the day. The post's `G4 P2.0` in-program dwell is for in-program steady-state, NOT for a cold start.
- **E-stop location**: confirm the operator can reach the pendant's E-stop AND the control-box E-stop without moving feet. The 60" x 120" envelope means the gantry can be 10 feet away from the pendant at the far end of a sheet -- a misjudged distance from the E-stop is a real hazard during a runaway.
- **Spindle direction**: M3 only on wood bits (clockwise). M4 reverses the spindle, which chips the cutting edge on a wood bit and can grab the workpiece. The bundled post emits `M3` exclusively via the `mach3` dialect snippet ([`src/main/post-process-dialects.ts`](../src/main/post-process-dialects.ts)).
- **Z retract on the 5x10 envelope**: the post retracts to `Z203` (the full `workAreaMm.z` from the profile) so the spindle nose clears every clamp and vacuum hose during XY rapids. Never hand-edit the safe-Z to a lower value for a "faster" run -- a low-Z retract on a 5x10 job risks the spindle nose colliding with a hold-down during a 12000 mm/min rapid.
- **Vacuum-only hold-down on small parts**: the 6-zone vacuum table is intended for sheet stock. Small parts (<150 x 150 mm) should be screwed or clamped to the spoilboard -- vacuum hold-down alone is not reliable for parts smaller than a single zone footprint.

## What is NOT in this checklist

- Vacuum-zone digital-output emission (`M64` / `M65` per zone) -- this is opt-in via `enableMach3DigitalOutputs: true` in [`src/shared/laguna-vacuum-postlude.ts`](../src/shared/laguna-vacuum-postlude.ts) and is OFF by default. The bundled `vcarve_mach3.hbs` template does NOT emit these lines; vacuum is controlled from the pendant until the operator explicitly opts in after confirming the digital-output wiring with a multimeter.
- Automatic tool change (ATC) -- the Laguna Swift's RichAuto A-series does NOT support ATC. All tool changes are manual. The post does not emit `M6`.
- Probing cycles -- the bundled post emits no probing G-code for the Laguna. Tool-length zeroing is manual at the spindle nose.
- 6 HP spindle variant -- the bundled profile pins the 3 HP variant (`spindleVariantHp: 3`). If you swap in a 6 HP spindle, duplicate the profile in the Library drawer rather than editing the bundled one.

## Cross-references

- Machine profile: [`resources/machines/laguna-swift-5x10.json`](../resources/machines/laguna-swift-5x10.json)
- Post template: [`resources/posts/vcarve_mach3.hbs`](../resources/posts/vcarve_mach3.hbs)
- Dialect resolver: [`src/main/post-process-dialects.ts`](../src/main/post-process-dialects.ts) (case `'mach3'` returns `{ on: 'M3', off: 'M5' }`)
- Mach3/RichAuto dialect reference: [`.claude/skills/gcode-safety/references/laguna-swift.md`](../.claude/skills/gcode-safety/references/laguna-swift.md)
- Contract pins: [`src/main/post-process-laguna-swift-contract.test.ts`](../src/main/post-process-laguna-swift-contract.test.ts), [`src/main/post-process-laguna-richauto.test.ts`](../src/main/post-process-laguna-richauto.test.ts)
- Vacuum zone helpers: [`src/shared/laguna-vacuum-postlude.ts`](../src/shared/laguna-vacuum-postlude.ts), [`src/shared/laguna-vacuum-allocator.ts`](../src/shared/laguna-vacuum-allocator.ts)
- Sister doc (K2 Plus Moonraker smoke): [`docs/SMOKE-K2-MOONRAKER.md`](SMOKE-K2-MOONRAKER.md)
- Machine reference: [`docs/MACHINES.md`](MACHINES.md)
- CLAUDE.md USER CONTEXT #2 (60"x120" envelope, 6,000-24,000 RPM hardware ceiling, RichAuto A-series controller)
