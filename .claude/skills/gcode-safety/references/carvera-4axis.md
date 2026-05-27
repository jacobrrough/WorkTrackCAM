# Makera Carvera (4-axis rotary) -- G-code safety reference

**Machine identity**: Makera Carvera with the **Harmonic-drive rotary module** is a desktop 4-axis CNC with a 240 x 92 x 46 mm work envelope (X/Y/Z), continuous A-axis rotation around X, 200 W spindle (6000-15000 RPM), and Smoothieware-family firmware. The rotary attachment occupies the ATC's work zone, so there is no automatic tool changer in 4-axis mode.

> Read this before touching `resources/posts/carvera_4axis.hbs`, `resources/machines/makera-carvera-4axis.json`, or any code path that emits 4-axis rotary G-code. The "Y MUST be 0" and "Z=0 is at stock CENTER" invariants are not optional -- violating either crashes the bit into the chuck or the rotary attachment.

---

## Bundled assets

- Machine profile: `resources/machines/makera-carvera-4axis.json`
- Post template: `resources/posts/carvera_4axis.hbs`
- Contract pins: `src/main/post-process-carvera-4axis-contract.test.ts`

---

## Architecture note (rotary kinematics)

- A-axis rotates around **X** -- in the profile this is `aAxisOrientation: "x"`. The A word in G-code drives the rotary stage; X/Y/Z drive the linear gantry.
- A-axis is continuous via `aAxisRangeDeg: 99999` (placeholder sentinel for "no soft limit applied at the post layer" -- the firmware enforces its own).
- Post template is `carvera_4axis.hbs`. Dialect is `grbl_4axis` (the schema enum entry that signals "GRBL-flavored Smoothieware + an A axis"; same M2-vs-M30 rules apply as 3-axis).

---

## Hard envelope limits (from `resources/machines/makera-carvera-4axis.json`)

| Spec | Value | Source field |
| --- | --- | --- |
| Work envelope | 240 x 92 x 46 mm | `workAreaMm` (note: Z is only **46 mm** -- the rotary attachment reduces clearance vs the 140 mm 3-axis Z) |
| Max feed | 2400 mm/min | `maxFeedMmMin` |
| Min spindle | 6000 RPM | `minSpindleRpm` |
| Max spindle | 15000 RPM | `maxSpindleRpm` |
| Max rotary RPM | 6 | `maxRotaryRpm` |
| Rotary chuck outer radius | 46 mm | `rotaryChuckOuterRadiusMm` |
| A range | continuous (sentinel 99999) | `aAxisRangeDeg` |
| A orientation | rotates around X | `aAxisOrientation` |
| Axis count | 4 | `axisCount` |

---

## Header invariants (in order)

The first three header codes are:

1. `G21` -- **millimeter** units. Always explicit.
2. `G90` -- **absolute** distance mode.
3. `G17` -- **XY plane** for G2/G3 arcs.

Then the optional WCS line (`G54..G59` when `workCoordinateIndex` is set), then the optional Carvera probing block, then:

4. **Safe Z retract** emitted as `G0 Z<workAreaZ>` -- this is `G0 Z46` (**46 mm** Z envelope -- LESS than the 3-axis 140 mm because of the rotary attachment).
5. **`G0 Y0`** -- **critical centering on rotation axis**. **Y MUST be 0 throughout a 4-axis program** because A rotates around X and the tool must stay on the rotation plane. Any header Y word other than `Y0` is a defect.
6. Spindle on (dialect snippet -- emits `M3 S<rpm>`) followed by `G4 P2` -- **2 second spindle dwell** so the spindle reaches commanded RPM before the first cutting move.

Z=0 is at **stock CENTER** (rotation axis), NOT surface. The template emits this as an operator-visible safety comment: `; [4] Z=0 is at stock CENTER (rotation axis), NOT surface`. Do not remove or modify this comment.

---

## G93 / G94 inverse-time feed balance

For continuous-rotation 4-axis moves where the path length is dominated by A rotation, the post can opt into G93 inverse-time feed via the `inverseTimeFeed: true` PostContext flag. When enabled:

- `G93` is emitted BEFORE the toolpath block.
- `G94` is emitted AFTER the toolpath block to restore **feed-per-minute** mode.

These two MUST be matched. Emitting G93 without G94 leaves the next program in inverse-time mode and the operator's hand-typed jog feeds will be misinterpreted. The default (`inverseTimeFeed: false`) emits NEITHER G93 nor G94.

---

## Footer invariants (in order)

After the last toolpath line:

1. **Spindle off** via the dialect snippet (emits `M5`).
2. **G0 Z<workAreaZ>** -- safe-Z retract (46 mm).
3. **G0 A0** -- **return rotary to zero**.
4. **G0 X0 Y0** -- park X, re-center Y on rotation axis.
5. **M9** -- coolant/vacuum off.
6. **M2** -- program end. **NOT M30** -- M30 may delete the file from the SD card on Smoothieware community firmware.

---

## Anti-patterns (forbidden emissions)

- **Emitting M6** -- Breaks the "no ATC in 4-axis" invariant (the rotary attachment physically occupies the ATC's work zone). Do NOT emit `M6` in 4-axis output even if `toolNumber` is set. Tool changes are manual -- use `M0` / `M1` operator pause for a manual change between tools.
- **Omitting `G0 Y0` from the header** -- the bit will plunge into the chuck instead of the stock centerline. Pure programmer's error and a top three job-killer on this machine.
- **Y stays at 0** -- if a toolpath line emits a non-zero Y, it's a red flag. The 4-axis template is for indexed or simultaneous rotation around X; Y motion is not part of the kinematic model.
- **Removing the "Z=0 is at stock CENTER" comment** -- if the operator sets Z=0 at stock surface instead of rotation axis, the first plunge cut goes through the stock and into the chuck.
- **Emitting M30 instead of M2** -- same Smoothieware "delete-the-file" gotcha as the 3-axis post.

---

## Pre-run safety checklist

1. Rotary attachment secured to table.
2. Stock centered in chuck, tailstock engaged.
3. Stock diameter matches CAM setup (Y dimension).
4. Z=0 is at stock CENTER (rotation axis), NOT surface.
5. A=0 set via controller or `G28.3 A0`.
6. Air-cut first: spindle off, Z raised, 10% feed override.
7. If `enableSimultaneous4Axis` is on, the operator has confirmed firmware supports XYZ + A blended motion in a single G1 block; a 5-minute verification window on first cut.

---

## Cross-references

- 3-axis sibling reference: `.claude/skills/gcode-safety/references/carvera-3axis.md`
- Post template: `resources/posts/carvera_4axis.hbs`
- Machine profile: `resources/machines/makera-carvera-4axis.json`
- Contract pins: `src/main/post-process-carvera-4axis-contract.test.ts`
- 4-axis integration test: `src/main/post-process-4axis-integration.test.ts` (covers `cnc_4axis_grbl.hbs` against synthetic baseMachine)
- Dialect resolver: `src/main/post-process-dialects.ts`
