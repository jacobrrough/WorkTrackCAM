# Makera Carvera (3-axis) -- G-code safety reference

**Machine identity**: Makera Carvera in 3-axis mode is a 360 x 240 x 140 mm desktop CNC with a 200 W spindle (6000-15000 RPM), 6-slot automatic tool changer, and Smoothieware-family firmware accessed over the Makera Controller.

> Read this before touching `resources/posts/carvera_3axis.hbs`, `resources/machines/makera-carvera-3axis.json`, or any code path that emits G-code for the 3-axis Carvera. Bad G-code crashes the spindle into the ATC and (worse) **M30 may delete the file from the SD card** -- this is the single most burned-by gotcha on this machine.

---

## Bundled assets

- Machine profile: `resources/machines/makera-carvera-3axis.json`
- Post template: `resources/posts/carvera_3axis.hbs`
- Contract pins: `src/main/post-process-carvera-3axis-contract.test.ts`

---

## Architecture note (Smoothieware ATC -- "grbl" label is a misnomer)

The machine profile labels the dialect as `smoothieware` (Cycle 68 [ID-0160]). Dialect heritage: historically labeled `grbl` because Smoothieware's M-code/G-code surface is GRBL-flavored; that **"grbl" label is a misnomer** -- the firmware is Smoothieware-family, not true GRBL, and several invariants depend on the distinction:

- True GRBL does NOT support G43/G49 tool-length compensation; Smoothieware does. The 3-axis Carvera REQUIRES G43/G49 around the ATC tool-change block.
- True GRBL uses `M2` for program end; Smoothieware accepts both `M2` and `M30`, but **M30 may delete the file from the SD card** on Carvera community firmware builds. Always emit `M2`.

The Post template `carvera_3axis.hbs` and the profile `makera-carvera-3axis.json` are wired together: `postTemplate = "carvera_3axis.hbs"`, `dialect = "smoothieware"`, `axisCount = 3`. The dialect snippet resolver in `src/main/post-process-dialects.ts` produces byte-identical output for both `"grbl"` and `"smoothieware"` so the profile flip is safe; the dialect-compliance validator branch (`checkSmoothieware()`) is what changes between the two.

---

## Hard envelope limits (from `resources/machines/makera-carvera-3axis.json`)

| Spec | Value | Source field |
| --- | --- | --- |
| Work envelope | 360 x 240 x 140 mm | `workAreaMm` |
| Max feed | **Max feed is 2400 mm/min** | `maxFeedMmMin` |
| Min spindle | 6000 RPM | `minSpindleRpm` |
| Max spindle | 15000 RPM | `maxSpindleRpm` |
| ATC capacity | 6 cutting slots | `atcSlotCount` |
| ATC probe slot | T0 (`wireless probe`) | `atcProbeSlot` |

**Reminder**: don't copy Laguna feeds into Carvera jobs. The Laguna Swift's 12000 mm/min ceiling will sail through a Carvera schema check (the profile gate is local to the machine) but will instantly stall the 200 W spindle. Stay inside 2400 mm/min on the Carvera.

---

## Header invariants (in order)

The first three header codes are:

1. `G21` -- **millimeter** units. Always explicit; never trust controller defaults.
2. `G90` -- **absolute** distance mode.
3. `G17` -- **XY plane** for G2/G3 arcs.

Then the optional WCS line (`G54..G59` when `workCoordinateIndex` is set), then the optional Carvera probing block (`carveraProbingBlock`), then the ATC tool-change block:

4. **Safe Z retract** emitted as `G0 Z<workAreaZ>` -- this is `G0 Z140` for the 3-axis Carvera (**140 mm** Z envelope from the profile). Sets a known clearance regardless of where the previous job left Z.
5. **Tool-change block** -- `M6 Tn` followed by `G43 Hn` (auto-probes length, then applies tool-length compensation). Default tool is T1. `manualToolChange: true` opts out and emits a `[ID-0013-integration]` operator-visible block instead.
6. Spindle on (dialect snippet -- emits `M3 S<rpm>`) followed by `G4 P2` -- **2 second dwell** so the spindle reaches commanded RPM before the first cutting move.

T0 is the **wireless probe** -- **do not use for cutting**. T-1 is "no tool". Cutting tools live in T1-T6.

---

## Footer invariants (in order)

After the last toolpath line:

1. **Spindle off** via the dialect snippet (emits **M5**).
2. **G49** -- **cancel tool length compensation**. Mandatory before retract so TLC does not leak into the next program.
3. **G0 Z<workAreaZ>** -- **safe-Z retract** (140 mm).
4. **G0 X0 Y0** -- **park at origin**.
5. **M9** -- **coolant/vacuum off**.
6. **M2** -- **program end** -- **NOT M30** -- (M30 may delete the file from the SD card on Smoothieware community firmware).

No `%` tape markers -- Smoothieware doesn't use them. (The Laguna post DOES use them; do not cross-contaminate.)

---

## Anti-patterns (forbidden emissions)

- **M30 in the footer** -- delete-the-program-from-the-SD-card gotcha; the single most burned-by gotcha. Always emit `M2`.
- **Missing G49** -- leaves tool-length compensation active across programs; the next program's coordinates will be wrong by the tool-length offset.
- **Inch units (G20)** -- Don't emit G20. The Carvera profile is metric; mixing in a stray G20 will scale every following coordinate by 25.4.
- **Skipping M6 when changing tools** -- just updates the register, won't actually change the tool. Always pair the tool-number update with a real `M6 Tn` so the ATC physically swaps.
- **3-axis bleeding A-words** -- the 3-axis post must not emit any `A<number>` token. Pure 3-axis output.

---

## Pre-run safety checklist

1. Workpiece securely clamped to the table.
2. Correct tool loaded in the ATC slot (T1-T6).
3. Work coordinate system (WCS) zeroed -- use `G10 L20 P1` or controller UI.
4. Air-cut first: spindle off, Z raised, 10% feed override.
5. Compare a short program to a known-good file from Makera CAM if you changed the post.

---

## Cross-references

- 4-axis sibling reference: `.claude/skills/gcode-safety/references/carvera-4axis.md`
- Post template: `resources/posts/carvera_3axis.hbs`
- Machine profile: `resources/machines/makera-carvera-3axis.json`
- Contract pins: `src/main/post-process-carvera-3axis-contract.test.ts`
- Dialect resolver: `src/main/post-process-dialects.ts`
- Dialect-compliance validator: `src/shared/gcode-dialect-compliance.ts` (`checkSmoothieware()`)
