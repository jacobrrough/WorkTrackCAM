# Output Comparison Test — WorkTrack3D vs VCarve vs Carvera CAM

**Date**: 2026-06-16
**Purpose**: Run ONE known reference part through WorkTrack3D and the commercial tools you already
trust (Vectric **VCarve** for the Laguna; the **Carvera CAM** app for the Makera), then compare the
posted G-code. This is the closest thing to bench-truth short of cutting material — it cross-checks
our toolpaths against the industry-standard tools on identical geometry.

> **Read this first — what "match" means.** WorkTrack3D, VCarve, and Carvera each use *different*
> toolpath algorithms (our v-carve is a distance-field medial-axis; VCarve has its own). So the
> G-code will **not** be byte-identical, and that is expected and fine. You are checking
> **behavioral equivalence**, not a diff-match: same cut depths at the same places, same part
> bounds, same feeds/speeds, correct dialect (M30 vs M2), safe retracts. Think "do they agree on
> what to cut," not "are the files the same."

---

## The reference part

| File | What it is | Use for |
|---|---|---|
| `resources/test-fixtures/comparison/reference-part.dxf` | 2D: a 120×80 rectangle + a Ø36 circle @ (35,40) + a triangle (apex at (90,55)) | **V-carve (Laguna)** + 2D pocket/profile (Carvera) |
| `resources/test-fixtures/comparison/reference-block.cq.py` | 3D: a 60×40×15 stepped block + a Ø20×5 pocket | Optional 3D **3-axis (Carvera)** comparison |

The 2D part is deliberately pure geometry (no text — text vectorizes differently per app/font,
which would poison the comparison). The three shapes each probe something:
- **Rectangle** — a clean closed profile (offset/contour + arc-corner behavior).
- **Circle** — should post as arcs (G2/G3) in VCarve; in WorkTrack3D enable "Output arcs" to compare.
- **Triangle** — the v-carve depth-modulation test: the carve must get **deeper toward the wide
  base and shallower toward the sharp apex**. This is the single most important thing to compare.

---

## Use the SAME settings in every app (this is what makes it apples-to-apples)

If any of these differ, the comparison is meaningless. Write them down and set them identically:

| Setting | Value |
|---|---|
| Units | **mm** |
| Stock | 120 × 80 × 12 mm (2D) / the block's bounds (3D) |
| Work zero (WCS) | bottom-left corner, **Z=0 at the top surface** |
| V-bit (for v-carve) | **60° included angle**, e.g. a 1/2" 60° V |
| Flat / max carve depth | **6 mm** |
| End mill (for pocket/profile) | **6 mm flat** |
| Cut feed | **2000 mm/min** |
| Plunge feed | **600 mm/min** |
| Spindle | **18000 RPM** (Laguna) / **13000 RPM** (Carvera — its floor) |
| Pass depth (pocket) | **2 mm** |

---

## Comparison A — V-carve on the Laguna (WorkTrack3D ↔ VCarve)

**WorkTrack3D:**
1. Open/create a project, go to **Design → Sketch**, **Import DXF** → `reference-part.dxf`.
2. **Manufacture** (machine = **Laguna Swift 5x10**) → add a Setup → add a **V-carve** op on the
   three loops; set the V-bit + depth + feeds + spindle above.
3. Post → **Export for Laguna** (`vcarve_mach3.hbs` → RichAuto/Mach3 `.nc`). Save it as
   `wt3d-laguna-vcarve.nc`.

**VCarve:**
1. New job, 120×80×12 mm, mm, Z-zero at top. **Import vectors** → the same `reference-part.dxf`.
2. **V-Carve / Engraving toolpath**, same 60° V-bit, same flat depth, same feeds/spindle.
3. Save toolpath with your **Mach3/RichAuto** post → `vcarve-laguna.nc`.

**Compare the two `.nc` files** against the checklist below.

---

## Comparison B — Pocket/profile on the Carvera (WorkTrack3D ↔ Carvera CAM)

Use either the 2D DXF (a pocket of the circle + a profile of the rectangle) or the 3D block.

**WorkTrack3D:** import the DXF (or build `reference-block.cq.py` then **Export → STEP/STL**);
Manufacture (machine = **Makera Carvera**) → **Pocket** the circle + **Profile** the rectangle,
6 mm end mill, 2 mm passes, feeds/spindle above; post (`carvera_3axis.hbs` → Smoothieware). Save
`wt3d-carvera.nc`.

**Carvera CAM app:** load the **same** DXF (or the same STEP/STL export), set the same pocket +
profile with identical tool/feeds, post its Smoothieware G-code → `carvera-cam.nc`.

---

## The comparison checklist

### MUST match (a difference here is a real bug — tell me)
- [ ] **Units / modes header** — both emit `G21` (mm), `G90` (absolute), `G17` (XY plane), and a
  work offset (**G54** — WorkTrack3D now always emits it).
- [ ] **Part bounds** — every X is within 0–120 and every Y within 0–80 (2D). Nothing cuts outside
  the stock. (For the block: X 0–60, Y 0–40.)
- [ ] **V-carve depth behavior** — the deepest Z is near the triangle base / circle interior; the
  carve tapers to ~0 at the triangle apex and the thin edges. Both apps should agree on *where it
  gets deep*. (Exact Z values may differ slightly by sampling; the **pattern** must match.)
- [ ] **Feeds & spindle** — the `F` words and the `S` (spindle) match what you set, in both files.
- [ ] **Terminator** — Laguna files end with **`M30`**; Carvera files end with **`M2`** (never the
  other way — `M30` on the Carvera can delete the file from the SD card).
- [ ] **Spindle/coolant off at end** — `M5` (and `M9` if coolant was on) before the end.
- [ ] **Safe retracts** — Z lifts to clearance before every rapid (`G0`) move between cuts; no
  rapid traverse at cutting depth.
- [ ] **Carvera tool change** — `M6`/`G43` present for the Carvera pocket; **no `M6`** on a 4-axis
  Carvera job.

### May legitimately differ (NOT bugs)
- Total line count, point density, and the exact ordering of cuts (different algorithms).
- Whether curves are arcs (`G2/G3`) or short line segments — VCarve emits arcs; WorkTrack3D emits
  arcs only when you enable **"Output arcs (G2/G3)"** on the op (otherwise a fine line chain that
  is geometrically equivalent within tolerance). Turn it on to compare arc-for-arc.
- Comments, line numbers (`N…`), timestamps, and header banners.
- Lead-in/lead-out style and ramp/helix entry details.

---

## How to read the result

- **Everything in "MUST match" matches** → WorkTrack3D agrees with the trusted tool on the safety-
  and geometry-critical output. That is a strong green light for a first supervised cut (still do
  the air-cut + 1–10% feed first — see `docs/FIRST-CUT-RUNBOOK.md`).
- **A "MUST match" item differs** → capture all three files + the settings you used and send them
  back. That is exactly the kind of discrepancy this test exists to catch, and I will root-cause it.

> Honest scope: this validates the **posted G-code** against trusted CAM. It does **not** replace
> the physical first cut — a controller can still surprise you (backlash, tool runout, work-holding).
> But if our output and VCarve's agree on the same part, the largest software unknown is closed.
