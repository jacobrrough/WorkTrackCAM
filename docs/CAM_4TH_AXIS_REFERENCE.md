# 4th-Axis CAM — reference & first-job runbook

> **Audience.** Operators running the Makera Carvera with the 4th Axis HD rotary attachment (or any other 4-axis rotary machine WorkTrackCAM supports). Read this before generating your first rotary G-code.

This document has two parts. Part 1 is the **concept primer** — how the 4-axis engine represents a rotary job, which strategy does what, and the coordinate conventions the post follows. Part 2 is the **first-job runbook** — a concrete end-to-end walkthrough that cuts a simple groove around a round bar on the Carvera, from STL-less setup to verified air cut.

If you only have 15 minutes, skip to Part 2. Come back for Part 1 when a parameter surprises you.

---

## Part 1 — concept primer

### Coordinate frame

WorkTrackCAM's 4-axis engine uses one coordinate convention throughout. All posts, validators, and simulators share it; you should too.

- **X** is the axial position along the rotation axis — the length of the stock. `X = 0` is the chuck face, `X > 0` is toward the tailstock. Negative X is a bug: the validator rejects it, and the post-compile envelope check flags it.
- **Y** is **always zero** in the output G-code. The rotary attachment centers the workpiece on the Y=0 plane; any non-zero Y would miss the part or hit the chuck.
- **Z** is the **radial** distance from the rotation axis. `Z = stockRadius` is the outer surface of the stock. `Z = 0` is the center of the stock, **not the surface**. This is the Carvera convention and is non-negotiable — zeroing Z to the surface causes every cut to plunge past the center of the part.
- **A** is the rotary angle in degrees. Direction is controller-dependent; verify on your machine before assuming CCW-positive.
- The part (STL) is sampled in machine-frame X axial / A angular / Z radial. The user gizmo transform in the viewer is mapped into this frame by `src/main/cam-axis4/frame.ts`.

### Mesh transform pipeline

Both the STL placement pipeline and the 4-axis frame mapper apply the user gizmo transform through the same three primitives, defined in [`src/main/stl-vec3.ts`](../src/main/stl-vec3.ts):

- `mulVecStl(v, scale)` — per-axis scale.
- `rotateXYZDeg(v, [rx, ry, rz])` — Tait‑Bryan XYZ rotation, applied in **X then Y then Z** order with right-hand rule conventions:
  - `X:+90°` sends `[0, 1, 0]` → `[0, 0, 1]`
  - `Y:+90°` sends `[1, 0, 0]` → `[0, 0, -1]`
  - `Z:+90°` sends `[1, 0, 0]` → `[0, 1, 0]`
- `addVecStl(v, translate)` — additive offset.

The vertex pipeline order is **scale → rotate → translate** (see [`src/main/binary-stl-placement.ts`](../src/main/binary-stl-placement.ts) lines 139–146). The 4-axis frame mapper at [`src/main/cam-axis4/frame.ts`](../src/main/cam-axis4/frame.ts) consumes the rotation step only (the mesh is already in machine frame at that point). The `frame-parity.test.ts` invariant pins the byte-equal output of both callers; the `stl-vec3.test.ts` unit tests pin the rotation conventions above.

Why this matters: any future change that swaps the rotation axis order (e.g. ZYX instead of XYZ), or flips the right-hand rule on a single axis, will silently rotate every imported STL and every 4-axis A/X mapping in the wrong direction. The unit + parity tests catch this before posted G-code reaches the machine.

### Stock model

The stock is a cylinder, parameterized as:

- `rotaryStockLengthMm` — length along X
- `rotaryStockDiameterMm` — diameter (not radius; stock radius is derived)
- `rotaryChuckDepthMm` — how far along X the chuck grips the stock. The engine deducts this span from the machinable X range so the toolpath never drives into the chuck jaws.
- `rotaryClampOffsetMm` — additional safety margin beyond the chuck depth; useful when you're clamped far up the stock to leave the part proud of the chuck.

Machinable X span ≈ `[chuckDepthMm + clampOffsetMm, stockLengthMm - clampOffsetMm]`. The engine enforces this; you don't have to do the math in your head.

### Strategies

| Operation kind | What it does | Needs an STL? | Key params |
|---|---|---|---|
| `cnc_4axis_roughing` | Waterline roughing of a mesh wrapped onto the cylinder. Removes bulk material radially inward in passes. | Yes | `zPassMm` (total radial depth), `zStepMm` (per-pass), `stepoverMm` (axial), angular stepover derived |
| `cnc_4axis_finishing` | Single-pass angular finishing at `zPassMm`. Typically runs after roughing. | Yes | `finishStepoverDeg`, `rotaryFinishAllowanceMm` |
| `cnc_4axis_continuous` | Continuous spiral finishing — reduces stop-start marks. Uses inverse-time feed (G93). | Yes | `zPassMm`, `finishStepoverDeg` |
| `cnc_4axis_contour` | Wraps a 2D contour (`[[x_axial, y_circumferential], …]`) onto the cylinder as X / A moves. Best for text engraving, chip-breaker grooves, decorative bands. | No | `contourPoints` (from a sketch or JSON) |
| `cnc_4axis_indexed` | Runs the same contour at several A angles (e.g. `[0, 90, 180, 270]`). Good for hex-from-round or symmetric features. | Yes (mesh sampled per angle) | `indexAnglesDeg` |

All five dispatch to [`src/main/cam-axis4/`](../src/main/cam-axis4/). The validator rejects impossible jobs (mesh outside stock, indexed without angles, contour without points) **before** any G-code is generated — when it fails, it names the field that needs fixing.

### Contour unwrap

For `cnc_4axis_contour`, the input is a list of 2D points `[x, y]`:

- `x` is **axial position in mm** (along the rotation axis). Clamped to the machinable X span.
- `y` is **circumferential distance in mm** (arc length on the stock surface, not an angle).

The engine converts `y` to A degrees as `A = (y / (π · D)) × 360`, where `D` is the stock diameter. So on a 30 mm diameter rod, `y = 5 mm` becomes `A ≈ 19.1°`. One full wrap of the rod is `y = π · 30 ≈ 94.25 mm`. Keep this in mind when paste-importing contour JSON.

### CAM-runner contour & toolpath safety helpers

A small group of pure parameter-resolvers in [`src/main/cam-runner.ts`](../src/main/cam-runner.ts) sits between operator-supplied parameters and the G-code emitters. They are exported so paired-pin tests can lock down their clamps; the clamps themselves prevent specific bad-G-code failure modes that would otherwise reach the machine.

- **`isOclToolpathFile(v)`** — runtime type guard for the JSON payload written by [`engines/cam/ocl_toolpath.py`](../engines/cam/ocl_toolpath.py). Rejects non-object primitives, arrays, and objects with malformed `ok` / `toolpathLines` / `strategy` fields; tolerates the empty object and unknown extra keys for forward compatibility. Replaces unsafe `JSON.parse(raw) as OclToolpathFile` casts at the two payload-load sites in `cam-runner.ts`. Failure mode prevented: a corrupt or partially-written OCL JSON file is silently consumed and the engine emits half-formed toolpath lines as G-code.
- **`resolveContourRampOptions(operationParams)`** — parses contour ramp-entry parameters. Returns `{ rampType, rampAngleDeg }` with `rampType` ∈ `'plunge' | 'linear' | 'helix'` (default `'plunge'`) and `rampAngleDeg` clamped to **0.5°..89°** with default **3°**. Non-finite or non-number values fall back to the default. Failure mode prevented: a stray `0`, `NaN`, or `Infinity` ramp angle produces an infinite-ramp G-code segment that reaches Z stock-far-below before the first lateral move; a `>=90°` ramp angle degenerates to a vertical plunge that defeats the purpose of ramp entry on hard materials.
- **`resolveContourTabParams(operationParams)`** — parses contour holding-tab (bridge) parameters. Returns `undefined` when `tabsMode` is not `'count'` or `'interval'`. When tabs are configured, applies floors: `tabCount ≥ 1` (rounded), `tabIntervalMm ≥ 1`, `tabWidthMm ≥ 0.5`, `tabHeightMm ≥ 0.1` — defaults `4 / 50 / 3 / 1.5` mm. Failure mode prevented: a zero `tabIntervalMm` triggers a divide-or-loop hazard in the tab placement pass; a zero `tabHeightMm` produces tabs that disappear under round-off and let the part fly free; a sub-0.5 mm `tabWidthMm` produces tabs too thin to survive cutting forces.

The clamps are pinned by [`src/main/cam-runner-contour-and-typeguard-pin.test.ts`](../src/main/cam-runner-contour-and-typeguard-pin.test.ts) (Cycle 106 [ID-0188]). Any future relaxation of these floors, or any change to the `0.5..89` ramp window, will trip the pin before the change reaches a posted G-code file. All three target machines benefit: K2 Plus (FDM contour-mode prints share the ramp logic), Laguna Swift 5x10 (large-format sheet contouring is the primary tab-using workflow), Makera Carvera (rotary contours and 3-axis ATC pockets both consume the OCL JSON guard).

### Post template

The Carvera 4-axis post lives at [`resources/posts/carvera_4axis.hbs`](../resources/posts/carvera_4axis.hbs) and is selected automatically when the active machine profile is `makera-carvera-4axis`. It does three Carvera-specific things that matter:

1. Parks `Y0` before any feed move (the rotary attachment requires it).
2. Inserts `G4 P2` after `M3` so the spindle reaches commanded RPM before cutting.
3. Ends the program with `M2`, never `M30`. On Smoothieware, `M30` has historically meant "delete the file from the SD card" rather than "program end."

It also optionally emits `G93` inverse-time feed around the toolpath for continuous-mode jobs, restoring `G94` at the end.

---

## Part 2 — first-job runbook: groove around a round bar

This job cuts a single decorative groove around a 30 mm diameter aluminum round bar. No STL is required — we supply the contour as two points. It's the simplest possible 4-axis job and exercises every link in the pipeline: stock config, contour strategy, validation, post, envelope check, simulation, and the Carvera-specific post rules.

Total time: about 10 minutes at the computer, plus the air cut.

### What you need

**Machine:**
- Makera Carvera with the 4th Axis HD rotary attachment installed on the table and aligned.
- Wireless probe paired (for Z zeroing, optional — you can touch off manually).
- Spindle and dust collection wired up.

**Stock:**
- 30 mm × ~80 mm aluminum (6061) or wood round bar. Length can be longer; we machine in the middle.
- Clamped in the rotary chuck with at least 15 mm of grip depth. Tailstock engaged if you have one, otherwise verify the stock runout by spinning it by hand.

**Tool:**
- 3 mm (or 1/8″ = 3.175 mm) two-flute flat end mill. Slot one of the ATC carousel; but since ATC is disabled in 4-axis mode, this is a **manual tool change** — load the tool by hand into the ER11 collet and tighten.

**In-app prep:**
- Open WorkTrackCAM and create a new project.
- Pick the **Makera Carvera (4th Axis HD)** environment from the environment switcher. This loads the `makera-carvera-4axis` machine profile and forces the 4-axis UI.

### Step 1 — configure stock

In the **Manufacture** tab, go to the **Stock & Material** panel.

1. Set the axis mode to **4-Axis**. The panel rearranges to show rotary-specific fields.
2. Rotary stock profile: **Cylinder (round bar)**.
3. Stock length: **80 mm** (X axial).
4. Stock diameter: **30 mm**.
5. Chuck depth: **15 mm** — the part the chuck grips. The engine will forbid any toolpath motion in that span.
6. Clamp offset: **2 mm** — extra safety margin. Total protected zone is now `X ∈ [0, 17]`.
7. Material: **Aluminum 6061** (for feed/speed defaults) or **Wood — hardwood** if using wood.

### Step 2 — add a contour operation

In the **Operations** panel, click **Add operation** and pick **4-axis contour (rotary)**.

1. Label it `groove-test`.
2. **Contour points JSON:** paste this exact string —

   ```
   [[40, 0], [40, 94.25]]
   ```

   Two points: both at axial X = 40 mm (middle of the machinable span), circumferentially from 0 to 94.25 mm, which is one full wrap of a 30 mm diameter bar. The engine will rotate the bar one full turn while the tool sits at X = 40 and cuts at the target depth.
3. Tool diameter: **3.0 mm**.
4. Z pass (radial depth): **-0.5 mm**. Shallow — we want a decorative groove, not a parting cut.
5. Feed: **400 mm/min**, Plunge: **120 mm/min**, Spindle: **12,000 RPM**. Conservative.
6. Safe Z: **25 mm** (well clear of the stock max radius of 15 mm).
7. Leave **Clamp X to STL** checked (default).

The panel will show a 4-axis reminder pointing to this document and [`MACHINES.md`](./MACHINES.md).

### Step 3 — preview in simulation

Open the **CAM Simulation** panel.

Expected visuals:

- A translucent cylinder 30 mm in diameter and 80 mm long, aligned along the X axis.
- A yellow-cyan toolpath starting at safe Z, rapiding in, plunging to radial depth, wrapping around the cylinder once, and retracting.
- The protected chuck zone `X ∈ [0, 17]` has no motion.
- The tool icon orients radially inward (flute pointing toward the rotation axis).

If the simulation shows the toolpath drifting outside the cylinder, or the tool orientation looks like it's standing vertically instead of radial, stop — something is misconfigured. Check that the machine profile is the **4th Axis HD** variant (not 3-axis) and that axis mode is 4-Axis.

### Step 4 — post and inspect the G-code

Click **Post G-code**. A `.nc` file is written to the project directory with a name like `groove-test.nc`.

Open it in a text editor and verify the following:

**Header (first ~15 lines):**
- `; Makera Carvera — 4-Axis Rotary G-code` — the identifier.
- Comments listing the 6-step safety checklist (rotary attachment secured, stock centered, Z=0 at stock center, etc.).
- `G21` (millimeters), `G90` (absolute), `G17` (XY plane).
- A WCS line (`G54` by default).
- `G0 Z<something large>` (safe Z retract) and `G0 Y0` (centering — **required**).
- `M3 S12000` (or similar), then `G4 P2` (the spindle dwell — **required**).

**Body:**
- Lines with `X`, `Z`, and `A` words. `Y` should always be `0` or absent.
- Every X value inside `[17, 78]` — the machinable span after chuck and clamp deductions.
- No line with a negative X.
- For our single-point groove, you'll see one X/Z/plunge combo and then a single `G1` that sweeps A from 0 to 360° (approximately) at feed `F400`.

**Footer (last ~6 lines):**
- `M5` (spindle off).
- `G0 Z<safe>` (retract).
- `G0 A0` (return rotary to zero).
- `G0 X0 Y0` (park — Y stays 0 because rotary).
- `M9` (coolant/vacuum off).
- `M2` (program end). **Not `M30`.** If you see `M30`, stop — your post template is wrong.

If any of those fail, fix before going further. The `docs/MACHINES.md` *Safety* section has more detail on what to check.

### Step 5 — air cut

Load the `.nc` file onto the Carvera.

1. **Home the machine** (`$H` on the Carvera console or the Home button in the UI).
2. **Zero the rotary.** Use the CarveraSetupPanel's "Zero A-Axis" mode to set the current chuck orientation as `A = 0`. Orientation only matters if your contour is asymmetric; for a full-wrap groove it's cosmetic.
3. **Zero Z to stock center.** This is the step that catches new users. You cannot probe the center directly; instead, measure the stock diameter with calipers, probe the top of the stock, then offset Z by the stock radius (15 mm in this example). The 4-axis post header calls this out in its comment block.
4. **Zero X and Y.** `X = 0` is the chuck face; set it by touching off the tool on the chuck face and zeroing X. `Y = 0` is the rotation axis; it should already be correct from machine setup — verify by spinning the stock and confirming the tool tip runs flat to the surface at Y=0.
5. **Raise Z by one stock thickness (30 mm).** This is your air cut height.
6. **Feed override to 10%.** On the Carvera console.
7. **Spindle OFF for the first run.** Hard safety rule.
8. **Run the program.** Watch the full cycle. You're confirming that motion stays in the machinable span, the rotary moves smoothly, and the tool returns home without collisions.

If the air cut looks wrong — motion into the chuck, unexpected Y movement, rotary stalling, axis faults — stop and re-verify. Don't "just try it once" with the spindle on.

### Step 6 — real cut

1. Drop Z back to the correct zero height.
2. Feed override back to 100%.
3. Spindle **on** (the file already has `M3`; you're just confirming the override isn't set to 0).
4. Run.

You should see a shallow 0.5 mm deep groove at X = 40 mm, running all the way around the bar. Total cycle time for this job is under a minute.

### Post-cut

Measure the groove depth with calipers (or a depth micrometer). If it's deeper than 0.5 mm, your Z zero is below stock center — re-read Step 5.3. If it's shallower or missing, your Z zero is above the surface — same fix.

Once this job runs clean, you've validated every link in the chain. The Carvera post, the envelope check, the validator, the contour strategy, the simulation, your Z zeroing procedure. More complex jobs — text engraving (a sketch with multiple contours), full waterline roughing on an STL, indexed flats — layer on from here without touching the infrastructure.

---

## Troubleshooting

### "4-axis engine v1 only supports A-axis around X" error

The machine profile has `aAxisOrientation: "y"` or is missing the field. The v1 engine is X-rotation only. Edit the profile or switch to the `makera-carvera-4axis` profile which has `aAxisOrientation: "x"`.

### "requires a machine with axisCount ≥ 4" error

The active machine profile is set to a 3-axis machine. Switch environments to **Makera Carvera (4th Axis HD)** in the UI.

### "4-axis toolpath is empty" error

Usually means the contour points are all outside the machinable span, or `zPassMm` is zero, or the mesh sits entirely inside the stock radius so no surface is cut. Double-check the contour points and stock dimensions.

### Simulation shows toolpath floating above the stock

Z zeroing convention mismatch. In the 4-axis frame, `Z = stockRadius` is the surface. If the toolpath's cut Z is near stock radius but the stock rendering has its surface at Z = 0, the sim is probably in 3-axis mode — verify **4-Axis** is selected in Stock & Material.

### Posted G-code has `M30` at the end

You've somehow ended up using a non-Carvera post template. The Carvera machine profiles pin `postTemplate` to `carvera_3axis.hbs` or `carvera_4axis.hbs`. If you imported a CPS file or custom machine, check its `postTemplate` field.

### Rotary stalls or faults during the cut

The machine's `maxRotaryRpm` is too high for the angular feed rate the engine emitted. For continuous mode, the engine uses G93 inverse-time feed which can spike rotary speed at low X positions (small effective radius). Drop the feed rate, reduce the angular stepover, or switch from continuous to finishing+contour. The post-compile envelope hint warns when rotary speed looks out of range — read it.

### "Stock center Z = 0" is unintuitive

It is, yes. Every other CAM system zeroes Z to the stock surface. The Carvera rotary convention zeros to the rotation axis because the surface Z changes as the stock rotates (it's a cylinder, not a plate). The post header comments call this out explicitly; tape a note to your monitor.

## Related docs

- [`MACHINES.md`](./MACHINES.md) — machine profile reference, post dialect table, Smoothieware quirks
- [`resources/posts/README.md`](../resources/posts/README.md) — post template context & custom templates
- [`src/main/cam-axis4/`](../src/main/cam-axis4/) — engine source (validation.ts is especially readable)
