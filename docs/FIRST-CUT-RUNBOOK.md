# First Cut Runbook — Validating Posted G-code on Real Hardware

**Date**: 2026-06-15
**Purpose**: The single most valuable open item is that **no posted G-code has been run on the
actual K2 Plus / Laguna / Carvera** — everything is verified by tests + the gcode-safety skill,
but not on metal/wood. This runbook is the safe, low-risk procedure for that first real cut.

> **Claude cannot do this step.** Loading stock and pressing Cycle Start is the operator's job.
> This document makes that step as safe and scripted as possible. Everything *up to* the SD/USB
> handoff is verified in-app; everything *after* is hands-on-machine.

---

## Why the Laguna sign job first

Pick the **lowest-consequence** job for the first real cut. Ranked by risk:

| Job | Machine | Why first / why not |
|---|---|---|
| **V-carve a sign in MDF/plywood** | **Laguna Swift** | ✅ **DO THIS FIRST.** Soft material, 3-axis, single tool (no ATC), forgiving of WCS error, the most-exercised post (`vcarve_mach3.hbs`). A wrong move scraps a $5 board, not a part or a spindle. |
| A pocket/profile in aluminum plate | Laguna | After the sign — harder material, higher feed/spindle stakes. |
| A small 3-axis part | Carvera | After Laguna — 200 W spindle, ATC tool changes, SD-card `M2`-not-`M30` gotcha. |
| A 4-axis rotary part | Carvera + rotary | **LAST.** Rotary origin + Y=0 + chuck-span are the highest-risk; air-cut mandatory. |
| An FDM print | K2 Plus | Low physical risk but a different pipeline (Moonraker, not G-code-to-pendant). Validate separately via `docs/SMOKE-K2-MOONRAKER.md`. |

The rest of this runbook is the **Laguna sign** path.

---

## Phase 1 — In-app (everything here is verified; do it at your desk)

1. **Open/confirm a project** is loaded (the title bar shows it). The sketch/CAM live in the
   project file — if "sketches disappearing" ever recurs, that's the Cycle-249 bug class and
   should be reported, not worked around. *(That bug is fixed as of `da8ad28`.)*
2. **Author the sign vectors** in **Design → Sketch**:
   - Type the text with the **Text** tool (TrueType → closed machinable contours, letter holes
     handled), **or** **Import DXF** of an existing sign, **or** draw it.
   - Optional: dimension/constrain it now that S4/S5 are in — but for a sign, exact geometry
     isn't safety-critical.
3. **Switch to Manufacture** (the active machine must be **Laguna Swift 5x10** — check the
   machine status in the top bar).
4. **Create a Setup**, then add a **V-carve** operation (`cnc_vcarve`) on the sign loops. Set:
   - **Stock thickness** to your real board thickness (the v-carve depth caps to stock — verify
     this number is right; it's the main thing that keeps the bit from plunging through).
   - A V-bit you actually own (the included angle drives the carve width).
   - Spindle RPM **within 6,000–24,000** (the Laguna's range; out-of-range clamps with a warning).
5. **Post the G-code** (Setup → Send/Export → "Export for Laguna"). The **export-safety gate**
   runs here (fail-closed): bed-envelope, dialect, and terminator checks. If it blocks, read the
   message — it's catching something real.
6. **Review the emitted G-code** before it leaves the app. Confirm by eye:
   - Header: `G21` (mm) · `G90` (absolute) · `G17` (XY plane) · a `G54` work offset.
   - **Terminator is `M30`** (Laguna/RichAuto) — **not** `M2`.
   - **`%` markers** wrap the program (RichAuto expects them).
   - Spindle: `M3 S<rpm>` with rpm in range, a warm-up dwell (`G4 P2`) before the first cut, and
     `M5` + cool-down at the end.
   - No rapid (`G0`) moves in XY at cut depth — Z should rise before every transit.
   - `(Optional)` run the **gcode-safety skill** on `vcarve_mach3.hbs` if you changed anything.
7. **Save the file to a USB stick** with a RichAuto-legal name (short, `.nc`). See
   `docs/SMOKE-LAGUNA-RICHAUTO.md` for the format/sub-directory limits.

✅ **At this point the app's job is done and verified.** Everything below is on the machine.

---

## Phase 2 — At the machine (operator-only; this is the real test)

**Bring:** the USB stick, a scrap board of the exact stock thickness you entered, the V-bit you
selected, calipers, and a hand on the **e-stop**.

1. **Fixture the board** — clamp or vacuum it flat. A lifted board is the #1 cause of a ruined
   first cut.
2. **Insert the V-bit**, set the collet.
3. **Set work zero (WCS / G54)**:
   - **X/Y zero** at the sign's origin corner (match where the toolpath expects it — usually the
     bottom-left of the stock; confirm against the preview).
   - **Z zero** at the **top surface of the stock** (touch off with paper or a Z-plate). For
     v-carve, Z-zero-at-top + correct stock thickness is what keeps depth honest.
4. **Load the file** on the RichAuto pendant from the USB stick.
5. **Manual spindle warm-up** — ramp the spindle at the pendant (`M3 S6000`→up) before Cycle
   Start, per the post's intent.
6. **Dust collection ON** before the spindle (the post emits `M7`/`M9` only if the dust-collection
   flag was set on the job; otherwise switch it on manually).
7. **AIR CUT FIRST** — raise Z by your stock thickness (or jog the gantry off the board) and run
   the whole program **above** the material. Watch that the motion matches the sign shape and
   stays inside the board footprint. This is your free dress rehearsal.
8. **First real pass at 1–10% feed override.** Keep the override low until you've watched the bit
   enter and the first letters cut clean. Hand on the feed-hold / e-stop the entire time.
9. **Verify depth** on the first letter with calipers against your intended carve depth. Pause
   and adjust Z-zero if it's off — better to scrap one letter than the whole sign.
10. **Ramp feed to 100%** once you trust the WCS, depth, and motion.

---

## What "success" looks like (what this test actually validates)

- The posted G-code **parsed and ran** on the RichAuto pendant (dialect/terminator/`%` correct).
- The **work coordinate system** matched reality (the cut landed where the preview said).
- The **v-carve depth capped to stock** (no plunge-through) — validates the depth-cap engine.
- The spindle **warm-up/cool-down + RPM** behaved.

Report back any mismatch with: the machine profile, the input sketch, and the emitted G-code
(per `docs/PRE-LAUNCH-READINESS.md` → "What to do if something goes wrong"). A real-hardware
discrepancy is the highest-value bug report there is right now.

---

## If something goes wrong

1. **E-stop / feed-hold immediately** if motion looks wrong — don't wait to see.
2. Most failure modes have an **operator-visible warning line** in the emitted G-code
   (`UNVERIFIED`, `clamped to`, `below machine minimum`). Read the program top-to-bottom first.
3. `docs/SMOKE-LAGUNA-RICHAUTO.md` has the RichAuto-specific troubleshooting (USB format,
   sub-directory depth, vacuum zones, RPM ramp).
4. Capture the artifacts and report — do **not** hand-edit the G-code on the pendant to "fix" it
   (a hand-edited `M30`→`M2`, wrong WCS, or removed dwell is how machines get crashed).

---

## Status of the pipeline feeding this runbook (2026-06-15)

- Suite: **16,617 tests / 0 failures**; `npm run typecheck` clean.
- **Runtime security gate GREEN**: `npm audit --omit=dev` = **0** (see `docs/SECURITY.md`).
- Laguna post (`vcarve_mach3.hbs`): unchanged + contract-pinned; gcode-safety verdict SAFE.
- The export-safety gate is live on every send/export surface (fail-closed for CNC).
- **Still unproven until you run this**: the posted G-code on the physical RichAuto controller.
  That gap is exactly what this runbook closes.
