# Laguna Swift 5x10 -- RichAuto A-series G-code safety reference

**Machine identity**: Laguna Swift 5x10 is a large-format 3-axis CNC router with a 1524 x 3048 x 203 mm work envelope, helical rack-and-pinion X/Y + ball-screw Z, a 3 HP (bundled) or 6 HP liquid-cooled spindle (6,000–24,000 RPM, ER-20 collet), and a RichAuto A-series handheld controller. The bundled profile is the 3 HP variant.

> Read this before touching `resources/posts/vcarve_mach3.hbs`, `resources/machines/laguna-swift-5x10.json`, or any code path that emits G-code for the Laguna Swift. The Mach3-vs-RichAuto dialect superset note is the most-burned-by source of confusion; the M30/M2 terminator mistake is the second.

---

## Bundled assets

- Machine profile: `resources/machines/laguna-swift-5x10.json`
- Post template: `resources/posts/vcarve_mach3.hbs`
- Contract pins: `src/main/post-process-laguna-swift-contract.test.ts`

---

## Architecture note (Mach3 vs RichAuto A-series)

- Post template: `vcarve_mach3.hbs`
- Dialect: `mach3`

The Laguna Swift's handheld controller is **RichAuto A-series**. RichAuto A-series accepts **Mach3-compatible** G-code as a strict superset: G21/G90/G17/G94, G0/G1/G2/G3, M3/M5, S/F, M7/M9, M30, and `%` tape markers are all honored. WorkTrackCAM uses the existing `dialect: "mach3"` enum (and the `vcarve_mach3.hbs` template) for this machine rather than introducing a new `richauto_a` enum, because there is no behavioural divergence today.

If a future post genuinely needs RichAuto-only syntax that Mach3 rejects, **add a new post template** (e.g. `richauto_a.hbs`) **rather than mutating `vcarve_mach3.hbs`** -- mutating the shared template risks corrupting other Mach3-class machines (Laguna iQ, ShopBot, etc.) that may bundle later.

---

## Hard envelope limits (from `resources/machines/laguna-swift-5x10.json`)

| Spec | Value | Source field |
| --- | --- | --- |
| Work envelope | 1524 x 3048 x 203 mm | `workAreaMm` (the 203 mm Z is the safe-Z source for the post) |
| Max feed | maxFeedMmMin (12000 mm/min ceiling) | `maxFeedMmMin` |
| Min spindle | 6000 RPM | `minSpindleRpm` |
| Max spindle | 24000 RPM | `maxSpindleRpm` |
| Spindle variant | 3 HP (bundled) | `spindleVariantHp` |
| Vacuum zones | 6 (controlled from the RichAuto pendant, not from G-code) | `vacuumZoneCount` |
| Safe retract Z (operational) | 25 mm | `safeRetractZMm` (advisory; the post uses `workAreaMm.z` for the post-loaded safe-Z lift) |

Note: the post has no zone-on/zone-off M-codes for the 6-zone vacuum table -- vacuum is controlled from the RichAuto pendant, not from G-code.

---

## Header invariants (in order)

1. `%` — program tape start marker (Mach3 requirement)
2. `G21 or G20` — units **must be explicit** (controller may persist last units across power-cycles — never trust the boot-time default). The vcarve_mach3 post emits `G21` for the metric Laguna profile.
3. `G90` — absolute distance mode
4. `G17` — XY plane for G2/G3 arcs
5. `G94` — feed in units per minute

Then the optional WCS line (`G54..G59` when `workCoordinateIndex` is set, BEFORE spindle on), then spindle on (dialect snippet -- emits `M3`), then:

6. `G4 P2.0` -- 2 second dwell for spindle ramp-up (wood router warmup)
7. Optional `M7` -- dust collection on when the `dustCollection` PostContext flag is true
8. Pre-cut safe-Z lift `G0 Z<workAreaZ>` ([ID-0110]) -- mirrors the Carvera 3/4-axis posts so the first XY/Z move executes from a known clearance regardless of where the previous job left Z, or what Z the controller booted into. For the Laguna this resolves to `G0 Z203`.

---

## Footer invariants (in order)

After the last toolpath line:

1. Spindle off via the dialect snippet — `spindleOff` emits M5.
2. `G4 P3.0` — 3 second cool-down dwell so the VFD decelerates before retract (prevents a coasting spindle from flinging a loose bit when it hits a part edge during retract).
3. `G0 Z<workAreaZ>` — safe-Z retract before XY parking (203 mm for the Laguna).
4. `G0 X0 Y0` — park at WCS origin.
5. `M30` — program end + rewind. **This is Mach3's terminator. NOT M2.** (M2 is Carvera's terminator — do not cross-contaminate.)
6. `%` — program tape end marker.

If a shop-specific post enables dust-on (the `dustCollection` flag), it MUST emit the matching dust-off (`M9`) in the footer. Paired emission of `M7` (header) and `M9` (footer) -- never one without the other.

---

## Anti-patterns (forbidden emissions)

- **M2 in the footer** -- That's Carvera's terminator, not Mach3's. Will leave the RichAuto controller in an undefined state. Always emit `M30`.
- **Missing `%` markers** -- RichAuto A-series strongly prefers the tape markers around the program body; emitting neither will work on some firmware revs and fail on others. Always emit both leading and trailing `%`.
- **Inches by default (G20)** -- controller may persist the last units across power-cycles, so an "unspecified" run could silently scale every coordinate by 25.4. Always emit `G21` explicitly in metric jobs.
- **Spindle direction mistakes** -- M4 reverses the spindle. Wood bits are M3-only (clockwise). M4 on a wood bit chips the cutting edge and can grab the workpiece.
- **Z retract too low for a 5x10 job** -- the workpiece is large; a low-Z retract risks the spindle nose colliding with a hold-down or vacuum hose during a rapid. The post pins `workAreaMm.z` = 203 mm as the safe-Z source.
- **Emitting M7/M8 unconditionally** -- Do NOT emit M7/M8 unconditionally. M8 flood-coolant on a wood router is a template bug (wood gets soggy, electronics get wet). M7 only when the operator opts in via the `dustCollection` flag.

---

## Pre-run safety checklist

1. Material clamped flat to the spoilboard, no warps under the bit path.
2. Vacuum zones armed from the RichAuto pendant before program start (zone enable is NOT in G-code).
3. Tool length set: V-bit at sharp tip, end mill at flute bottom, drill at tip.
4. WCS X0/Y0 at the workpiece corner per VCarve Pro setup; Z0 = top of stock.
5. Dust collection ON (set `dustCollection: true` to emit M7/M9, or manually start the dust hood if your controller wires different M-codes).
6. Spindle warm-up before first cut: the post's `G4 P2.0` is the in-program dwell; a long-idle spindle benefits from a manual no-load run-up to operating temperature first.
7. Cool-down before powering off: the post's `G4 P3.0` after M5 handles the in-program case; manual end-of-day shutdown should let the spindle idle 60-120 s before main power off.
8. Air-cut first: spindle off, Z high, 25-50% feed override.

---

## Known-good fixture recommendation

For snapshot tests and bench verification: a **600 x 400 mm plywood** facing pass with a **6 mm end mill** at 8000-12000 mm/min feed, 12000-18000 RPM spindle (well inside the 6000-24000 RPM hardware envelope), dustCollection on, workCoordinateIndex=1. Reuse this recipe when extending Laguna coverage rather than reinventing one.

---

## Cross-references

- Carvera 3-axis sibling (M2 terminator, no `%`): `.claude/skills/gcode-safety/references/carvera-3axis.md`
- Post template: `resources/posts/vcarve_mach3.hbs`
- Machine profile: `resources/machines/laguna-swift-5x10.json`
- Contract pins: `src/main/post-process-laguna-swift-contract.test.ts`
- Dialect resolver: `src/main/post-process-dialects.ts` (case `'mach3'` returns `{ on: 'M3', off: 'M5' }` -- spindleRpm threaded through PostContext)
