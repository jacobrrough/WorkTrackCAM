# CAD / Design Environment — Tool Catalog & Codebase Gap Audit

**Environment:** Design (parametric B-rep modeling — sketch → features → bodies → assemblies → drawings)
**Reference apps:** Fusion 360 (Design workspace), SolidWorks (Part + Assembly + Drawing), Onshape (Part Studio + Assembly + Drawing)
**Repo audited:** `vigorous-ptolemy-568bae` @ `claude/vigorous-ptolemy-568bae`
**Date:** 2026-06-08
**Method:** STEP 1 catalog from domain knowledge of the three reference apps; STEP 2 audit against this codebase (`src/renderer/design/**`, `src/shared/fusion-style-command-catalog.ts`, `src/shared/part-features-schema.ts`, `engines/cad/**`, `engines/sidecar/cad_handlers.py`); STEP 3 this matrix. Read-only wave.

---

## Executive summary — the reachability cliff

WorkTrack3D has **two very different things going on**, and the catalog only makes sense once you separate them:

1. **The capability layer is broad and real.** A full 2D parametric sketcher (`Sketch2DCanvas.tsx` / `MvpSketchCanvas`) covering ~20 draw tools, ~17 constraints, 5 dimension types, a local + planegcs solver, DOF badges, trim/extend/fillet/offset/pattern/mirror. A complete Three.js viewport (`Viewport3D.tsx`) with orbit/pan/zoom, measure, section clip, datum planes, face selection, lay-on-face, machine-bed rendering. ~50 CadQuery kernel ops (`part-features-schema.ts` `kernelPostSolidOpSchema`) — extrude/revolve/sweep/loft/pipe/coil/thicken, fillet/chamfer/shell/hole/thread/combine/split/press-pull, rect/circular/path/linear-3d patterns, mirror, sheet-metal (tab/fold/flat-pattern), plastic (boss/rule-fillet/lip-groove). Working Assembly view (mates, joints, BOM, interference) and Drawing view (orthographic projection, dimensions, GD&T, section, detail, title block, PDF/DXF export). 20 sidecar CAD methods (`cad_handlers.py` `HANDLERS`).

2. **The running Design "Part" cockpit cannot reach almost any of it.** The new shell mounts `DesignWorkspaceHost` → `DesignWorkspace.tsx`. Its Part view is a **CadQuery-script-driven cockpit** with:
   - **No live 3D viewport.** The center pane renders a *text build-summary placeholder* (`design-workspace__viewport-summary`), never `Viewport3D`. Evidence: `DesignWorkspace.tsx:1027-1048`; `Viewport3D` has **zero non-test mounts** (grep: only `Sketch2DCanvas.tsx` type-import + `Viewport3DMeasurementLabels.tsx` sub-component reference it).
   - **No mounted sketcher.** `MvpSketchCanvas` is imported **only** by `__tests__/MvpSketchCanvas.test.tsx`. The Model/Sketch/Inspect stage-tabs in `ViewportChrome.tsx` are presentational and "the Part-view body does not yet branch on them" (`ViewportChrome.tsx:13-16`).
   - **Decorative-only viewport chrome.** Orbit/Pan/Zoom/Section/Measure buttons, viewcube, and triad are explicitly "decorative placeholders (no handlers)" (`ViewportChrome.tsx:7-9, 56-60`).
   - The **only functional Part-view affordances** are: the CadQuery code drawer (`CadQueryEditor`, Ctrl+Enter Run), the read-only FeatureTree + editable kernel-op timeline (reorder/suppress/roll-back), parameter override Apply, Save, and Send-to-CAM.

So the **honest status of most "implemented" sketch/solid/inspect tools is `stub` from the operator's seat**: the code works in tests, but there is no ribbon, no canvas, and no viewport in the running shell to invoke it. The `fusion-style-command-catalog.ts` self-status (`implemented`/`partial`/`planned`) describes *kernel/code* maturity, **not** UI reachability — this audit re-scores against reachability.

The **Assembly** and **Drawing** tabs are the exception: they ARE genuinely wired and interactive in the running shell (real toolbars, real sidecar round-trips) — see `DesignWorkspace.tsx:898-962`.

**Status legend** (per task rubric, scored from the operator's reachability, not code maturity):
- `have` — implemented AND reachable + functional in the running UI.
- `partial` — reachable but limited / lossy / unverified.
- `stub` — code/kernel exists (often well-tested) but **not reachable** in the running shell, OR UI-present but non-functional/decorative.
- `missing` — no implementation anywhere.

---

## 1. Shell / Ribbon mechanics, navigation, browser, properties

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation (ribbon group / palette / shortcut) | Priority |
|---|---|---|---|---|---|---|
| Shell | Ribbon / toolbar with grouped commands | Fusion: contextual ribbon (Solid/Surface/Sheet-Metal/Form/Mesh/Plastic + Sketch contextual). SolidWorks CommandManager tabs. Onshape feature toolbar. | `missing` | none — Design has a viewport-chrome icon bar (decorative) + view-mode tabs (Part/Assembly/Drawing) only | **Build a real Design ribbon** with Sketch · Create · Modify · Pattern · Construct · Inspect groups, fed by `FUSION_STYLE_COMMAND_CATALOG` (already exists, already filterable by `CommandRibbonGroup`). This is the #1 foundational gap. | P0 |
| Shell | Command search / palette | Fusion `S` search; Onshape toolbar search. | `have` | Ctrl+K `NewShellCommandPalette` (palette) + Utilities→Commands catalog | Keep; route every ribbon button through the same command IDs so palette + ribbon stay in sync. | P0 |
| Shell | Marking menu / right-click context menu | Fusion marking menu; SW context toolbar; Onshape RMB. | `missing` | none | Add a viewport context menu (selection-aware) once the live viewport lands. | P1 |
| Shell | Keyboard shortcut map + editor | All three ship customizable shortcuts. | `partial` | `app-keyboard-shortcuts.ts` (1–6 nav, F1, Ctrl+K, Ctrl+Shift+D, Ctrl+Shift+?) + shortcuts dialog | Extend the single-source map with sketch tool letters (L/C/R/T/D/X…) when the ribbon ships. | P1 |
| Browser | Feature tree / timeline browser | Fusion bottom timeline + browser tree; SW FeatureManager; Onshape feature list. | `partial` | `FeatureTree.tsx` (right "Feature Tree" pane in `DesignWorkspace`) — read-only ops list + editable `kernelOps` timeline (reorder/suppress/roll-back) | Operations rows are read-only (AST parse of script). Make tree rows clickable→edit; show sketch/body nodes, not just kernel ops. | P0 |
| Browser | Roll-back / "roll to here" bar | Fusion timeline marker; Onshape rollback bar. | `have` | `FeatureTree` kernel timeline (`rolledBackTo`, `onKernelSetRollback`) — `part-features-schema.ts:540-561` | Surface a draggable timeline scrubber once the viewport rebuilds on roll-back. | P1 |
| Browser | Suppress / unsuppress feature | All three. | `have` | kernel timeline suppress toggle (`suppressKernel` mixin; `onKernelSuppressToggle`) | — | P1 |
| Browser | Reorder feature (drag) | All three. | `have` | `onKernelReorder` / `onKernelMove` in FeatureTree | — | P1 |
| Browser | Bodies / Components / Sketches / Origin / Construction folders | Fusion browser folders; SW solid/surface bodies + planes. | `missing` | none — tree shows kernel ops only | Add browser folders (Origin planes, Sketches, Bodies, Construction) as the tree grows beyond a flat op list. | P1 |
| Browser | Rename / show-hide / isolate node | All three. | `missing` | none | Add per-node visibility + rename when bodies/sketches appear in the tree. | P2 |
| Properties | Properties / dialog panel for active command | Fusion command dialog; SW PropertyManager; Onshape dialog. | `partial` | `DesignWorkspace` right "Properties" pane shows editable **parameters** + Save/Send only | Grow into a real per-feature property editor (edit extrude depth, fillet radius, etc. with live preview). | P0 |
| Viewport | Orbit / Pan / Zoom / Zoom-fit | All three (mouse + nav bar). | `stub` (built, unreachable) | `Viewport3D.tsx` has full orbit/pan/zoom + `applyStandardView` — but NOT mounted in shell; cockpit chrome buttons are decorative (`ViewportChrome.tsx:56-60`) | **Mount `Viewport3D` in the Part cockpit center pane.** Wire the chrome buttons to its controls. | P0 |
| Viewport | ViewCube / nav corner | Fusion ViewCube; SW view orientation; Onshape view cube. | `stub` | `ViewportChrome` viewcube is a static SVG (no camera binding); `Viewport3D` has `applyStandardView('top'/'front'/…)` ready | Bind the SVG viewcube faces to `applyStandardView`. | P1 |
| Viewport | Axis triad / origin display | All three. | `stub` | `ViewportChrome` triad is static SVG | Replace with live triad from mounted `Viewport3D`. | P2 |
| Viewport | Standard views (Top/Front/Right/Iso, Home) | All three. | `stub` | `Viewport3D.applyStandardView` (tested, `Viewport3D.test.ts`) — unreachable | Expose via viewcube + keyboard once mounted. | P1 |
| Viewport | Visual style (shaded / wireframe / shaded+edges / x-ray) | Fusion display settings; SW display style; Onshape view. | `missing` | none | Add a display-style toggle on the live viewport. | P2 |
| Viewport | Section analysis (live clip) | Fusion Inspect→Section; SW section view; Onshape section. | `partial` | sidecar `cad.hlr_section` (true B-rep HLR) + `Viewport3D` `sectionClipY` exist; reachable today only as the catalog `ut_section`/`ut_measure` which target the *old* viewport not the new cockpit | Re-wire Section to the mounted viewport + HLR overlay. | P1 |
| Viewport | Camera fit-to-selection, perspective/ortho toggle | All three. | `missing` | none | Add when viewport mounts. | P2 |
| Viewport | Appearance / environment / ground shadow | Fusion appearance; SW RealView; Onshape appearance. | `partial` | `ut_appearance` = project.json finish/color notes only (no render) | Defer; not shop-critical. | P2 |

---

## 2. Sketch — Create (entities)

> All sketch tools below live in `Sketch2DCanvas.tsx` + `sketch-tools.ts` + `sketch2d-event-handlers.ts` and are mapped by `design-command-map.ts`. They are **fully built and unit-tested** but the canvas is **mounted nowhere in the running shell** (`MvpSketchCanvas` imported only by its test). Hence `stub` (unreachable) across the board, despite `implemented` self-status in `fusion-style-command-catalog.ts`.

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Sketch·Create | Line | 2-pt + chained polyline. | `stub` | `sketch-tools` `line`; cmd `sk_line` | Sketch ribbon → Create → Line (`L`). Mount the sketch canvas first. | P0 |
| Sketch·Create | Rectangle (2-corner) | Corner rectangle. | `stub` | `rect` / `sk_rect` | Sketch → Create → Rectangle (`R`). | P0 |
| Sketch·Create | Rectangle (3-point / center) | Angled + center rect. | `stub` | `rect_3pt` / `sk_rect_3pt` | Rectangle flyout. | P1 |
| Sketch·Create | Circle (center-radius) | Center circle. | `stub` | `circle` / `sk_circle_center` | Sketch → Create → Circle (`C`). | P0 |
| Sketch·Create | Circle (2-point / 3-point / tangent) | Diameter / circumscribe / TTT. | `stub` (2pt,3pt) / `missing` (tangent) | `circle_2pt`/`circle_3pt`; tangent-circle absent | Circle flyout; add tangent circle later. | P1 |
| Sketch·Create | Arc (3-point) | 3-pt arc. | `stub` | `arc` / `sk_arc_3pt` | Arc flyout (`A`). | P0 |
| Sketch·Create | Arc (center-point) | Center→start→end. | `stub` | `arc_center` / `sk_arc_center` | Arc flyout. | P1 |
| Sketch·Create | Arc (tangent) | Tangent-to-endpoint arc. | `missing` | — | Add to arc flyout. | P2 |
| Sketch·Create | Polygon (inscribed/circumscribed N-gon) | Regular polygon. | `stub` | `polygon` / `sk_polygon` (3–128 sides) | Polygon flyout. | P1 |
| Sketch·Create | Slot (center / overall / arc) | Straight + arc slots. | `stub` (center,overall) / `missing` (arc slot) | `slot_center`/`slot_overall`; arc slot absent | Slot flyout. | P1 |
| Sketch·Create | Ellipse | Center + axes. | `stub` | `ellipse` / `sk_ellipse` | Create flyout. | P1 |
| Sketch·Create | Spline (fit points) | Through-point spline. | `stub` | `spline_fit` (Catmull-Rom) | Create → Spline. Note: constraints act on knots only, no spline-specific energy. | P1 |
| Sketch·Create | Spline (control points) | CV B-spline. | `stub` | `spline_cp` (uniform cubic) | Create → Spline flyout. | P2 |
| Sketch·Create | Conic / parabola / hyperbola | Conic curve. | `missing` | — | Defer. | P2 |
| Sketch·Create | Point | Sketch point. | `stub` | `point` / `sk_point` | Create → Point. | P1 |
| Sketch·Create | Polyline (closed profile) | Mixed line/arc chain. | `stub` | `polyline` / `sk_polyline` | Create → Line (chained). | P0 |
| Sketch·Create | Text (sketch text → profile) | Editable text profile for emboss/engrave. | `missing` | — (no font→vector; noted in gap analysis) | Add sketch-text (critical for Laguna/Carvera engraving). | P1 |
| Sketch·Create | Construction-line toggle | Reference geometry. | `missing` | — | Add a construction toggle to every entity. | P1 |
| Sketch·Create | Centerline | Revolve axis / symmetry line. | `missing` | — | Add; needed for clean Revolve UX. | P1 |
| Sketch·Create | Project / Include geometry | Project edges to active sketch. | `partial` | `sk_project` (mesh-pick orthogonal projection; "not true edge topology / curve trim") | Improve to true B-rep edge projection. | P1 |
| Sketch·Create | Intersect / silhouette curve | Project body silhouette. | `missing` | — | Defer. | P2 |
| Sketch·Create | Offset | Offset entity/loop. | `stub` | `sk_offset` (closed point-ID polyline miter offset) | Create/Modify → Offset (`O`). | P1 |
| Sketch·Create | Mirror (sketch) | Mirror across line. | `stub` | `sk_mirror_sk` | Modify → Mirror. | P1 |
| Sketch·Create | Circular / rectangular / path pattern (sketch) | Pattern sketch entities. | `stub` | `sk_pattern_sk` (linear/circular/path) | Modify → Pattern. | P1 |
| Sketch·Create | Image / canvas underlay | Reference image for tracing. | `missing` | — | Defer. | P2 |

---

## 3. Sketch — Modify

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Sketch·Modify | Fillet (sketch corner) | Round corner. | `stub` | `sk_fillet_sk` (polyline + arc-arc) | Modify → Fillet. | P1 |
| Sketch·Modify | Chamfer (sketch corner) | Bevel corner. | `stub` | `sk_chamfer_sk` | Modify → Chamfer. | P1 |
| Sketch·Modify | Trim | Trim to nearest bound. | `stub` | `sk_trim` (infinite-line / full-circle cutter) | Modify → Trim (`T`). | P0 |
| Sketch·Modify | Extend | Extend to bound. | `stub` | `sk_extend` | Modify → Extend. | P1 |
| Sketch·Modify | Break / split | Split entity at point. | `stub` | `sk_break`, `sk_split` | Modify → Break / Split. | P1 |
| Sketch·Modify | Move / Copy (sketch) | Translate selection. | `stub` | `sk_move_sk` | Modify → Move. | P1 |
| Sketch·Modify | Rotate (sketch) | Rotate selection. | `stub` | `sk_rotate_sk` | Modify → Move flyout. | P1 |
| Sketch·Modify | Scale (sketch) | Scale selection. | `stub` | `sk_scale_sk` | Modify → Move flyout. | P2 |
| Sketch·Modify | Stretch / drag underconstrained | Rubber-band edit. | `partial` | canvas supports point drag + live solve, but unreachable | Inherent once canvas mounts. | P1 |
| Sketch·Modify | Delete / sketch-scale-all | Remove entities. | `partial` | reducer supports delete; unreachable | Inherent once mounted. | P1 |

---

## 4. Sketch — Constraints & Dimensions

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Sketch·Constraint | Coincident | Merge points. | `stub` | `co_coincident` (solver) | Constraints group; auto-infer on draw. | P0 |
| Sketch·Constraint | Horizontal / Vertical | Axis-lock. | `stub` | `co_horizontal`/`co_vertical` | Constraints. | P0 |
| Sketch·Constraint | Parallel / Perpendicular | Relative angle. | `stub` | `co_parallel`/`co_perpendicular` | Constraints. | P0 |
| Sketch·Constraint | Tangent | Line-arc / arc-arc tangency. | `stub` | `co_tangent` (line+arc) | Constraints. | P0 |
| Sketch·Constraint | Equal | Equal length/radius. | `stub` | `co_equal` | Constraints. | P1 |
| Sketch·Constraint | Collinear | Points on a line. | `stub` | `co_collinear` | Constraints. | P1 |
| Sketch·Constraint | Concentric | Shared center. | `stub` | `co_concentric` | Constraints. | P1 |
| Sketch·Constraint | Midpoint | Point at midpoint. | `stub` | `co_midpoint` | Constraints. | P1 |
| Sketch·Constraint | Symmetric | Mirror about axis. | `stub` | `co_symmetric` | Constraints. | P1 |
| Sketch·Constraint | Fix / Ground | Pin geometry. | `stub` | `co_fix` | Constraints. | P1 |
| Sketch·Constraint | Smooth (G2 curvature) | Curvature-continuous. | `missing` | `co_smooth` = `planned` (no solver) | Defer. | P2 |
| Sketch·Constraint | Equal-curvature / pattern constraint | — | `missing` | `co_polygon` = `planned` | Defer. | P2 |
| Sketch·Dimension | Driving dimension (linear) | Sets + drives value. | `stub` | `dim_linear` (auto distance driver + parameter) | Dimension (`D`). | P0 |
| Sketch·Dimension | Aligned dimension | Point-to-point aligned. | `stub` | `dim_aligned` | Dimension flyout. | P1 |
| Sketch·Dimension | Angular dimension | Angle between edges. | `stub` | `dim_angular` (auto angle driver) | Dimension. | P1 |
| Sketch·Dimension | Radial / Diameter | Arc/circle size. | `stub` | `dim_radial`/`dim_diameter` | Dimension. | P1 |
| Sketch·Dimension | Driven (reference) dimension | Read-only measured. | `partial` | optional `parameterKey` readout exists | Add explicit driven toggle. | P2 |
| Sketch·Dimension | DOF / fully-constrained indicator | Color + DOF count. | `stub` | `sketch-solve-status.ts` DOF badge + `cad.solve_sketch` returns `status`/`dof`/conflict ids — unreachable | Surface the DOF badge in the mounted sketch. | P1 |
| Sketch·Dimension | Auto-dimension / auto-constrain | Bulk constrain. | `missing` | — | Defer. | P2 |

---

## 5. Solid — Create

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Solid·Create | Extrude | Profile→solid (new/join/cut/intersect, taper, symmetric, to-object). | `partial` | kernel via CadQuery script (`box`/`extrude`) + `so_extrude`; **no UI dialog** — only typed in CadQuery code | Create → Extrude (`E`) dialog driving `extrudeDepthMm` param; today only via script. | P0 |
| Solid·Create | Revolve | Profile about axis (angle/full). | `partial` | `so_revolve` (axis X=const), script-only | Create → Revolve dialog. | P0 |
| Solid·Create | Sweep | Profile along path (orientation modes). | `partial` | `sweep_profile_path_true` (frenet / path-tangent-lock / fixed-normal); no UI | Create → Sweep dialog. | P1 |
| Solid·Create | Loft | Between profiles (+ rails/centerline). | `partial` | `so_loft` (2–16 profiles, union chain) + `loft_guide_rails`; no UI | Create → Loft dialog. | P1 |
| Solid·Create | Rib | Thin web from open profile. | `missing` | `so_rib` = `planned` | Add kernel + dialog. | P2 |
| Solid·Create | Web | Multi-rib network. | `missing` | `so_web` = `planned` | Defer. | P2 |
| Solid·Create | Coil / helix | Helical solid. | `partial` | `coil_cut` ("stacked ring-cut surrogate… not true helical sweep") | Improve to true helical sweep; dialog. | P2 |
| Solid·Create | Pipe | Tube along path. | `partial` | `pipe_path` (circular section, optional wall) | Create → Pipe dialog. | P2 |
| Solid·Create | Thicken (surface→solid) | Offset surface to solid. | `partial` | `thicken_offset` (true OCC offset) + legacy `thicken_scale` | Wire to a face/surface pick. | P2 |
| Solid·Create | Box / Cylinder / Sphere / Torus primitives | Direct primitives. | `partial` | CadQuery `box()` etc. via script; no primitive buttons | Add Create → Primitive buttons (fast box/cylinder). | P1 |
| Solid·Create | Emboss / Deboss (from text/sketch) | Raise/recess from profile. | `missing` | — (no sketch text either) | Pair with sketch-text for engraving. | P1 |

---

## 6. Solid — Modify

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Solid·Modify | Fillet (edge / variable / setback) | Round edges. | `partial` | `fillet_all` + directional `fillet_select` (±X/±Y/±Z) — **no edge-pick**, only axis-bucket | Needs face/edge selection UI → per-edge radius. Today axis-direction only. | P0 |
| Solid·Modify | Chamfer (edge / 2-distance / angle) | Bevel edges. | `partial` | `chamfer_all` + `chamfer_select` (axis bucket) | Same edge-pick gap as fillet. | P0 |
| Solid·Modify | Shell | Hollow with wall + open faces. | `partial` | `shell_inward` (open one axis cap, ±X..−Z) | Add face-pick for open faces. | P1 |
| Solid·Modify | Draft | Angle faces about pull dir. | `missing` | — (plastic boss has draftDeg only) | Add Modify → Draft (mold/FDM relevant). | P1 |
| Solid·Modify | Hole (wizard: simple/counterbore/countersink/tapped) | Parametric hole. | `partial` | `hole_from_profile` (profile + depth/through) — "full hole wizard semantics still planned" | Build a Hole dialog (Ø, depth, c'bore/c'sink, thread). High value. | P0 |
| Solid·Modify | Thread | Modeled / cosmetic thread. | `partial` | `thread_wizard` (modeled + cosmetic, std/designation/class/hand/starts) — kernel `implemented`, no UI | Add Thread dialog + face pick. | P1 |
| Solid·Modify | Combine (boolean join/cut/intersect) | Body booleans. | `partial` | `boolean_combine_profile` + box/cylinder boolean ops; profile-index based, no body-pick UI | Add body-pick boolean dialog. | P1 |
| Solid·Modify | Split body / Split face | Cut body by plane/surface. | `partial` | `split_keep_halfspace` (axis plane, keep ±) — "full split-body management still planned" | Add split dialog + keep-both. | P1 |
| Solid·Modify | Move / Copy body | Transform body. | `partial` | `transform_translate` (ΔX/Y/Z, keepOriginal) — translate only, no rotate | Add rotate + triad manipulator. | P1 |
| Solid·Modify | Press Pull (direct face push) | Drag face/edge. | `partial` | `press_pull_profile` (signed delta on profile) — "face-pick/direct-manipulate UX still planned" | Needs live face manipulator on the viewport. | P1 |
| Solid·Modify | Scale (body) | Uniform/non-uniform. | `partial` | `thicken_scale` is an isotropic-scale surrogate; no true Scale | Add Modify → Scale. | P2 |
| Solid·Modify | Replace face / Delete face | Heal/edit B-rep. | `missing` | — | Defer (needs OCC face ops + selection). | P2 |
| Solid·Modify | Offset face | Push face along normal. | `missing` | — | Defer. | P2 |
| Solid·Modify | Align / Physical combine | — | `missing` | — | Defer. | P2 |

---

## 7. Solid — Pattern & Mirror

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Pattern | Rectangular pattern | Grid of features/bodies. | `partial` | `pattern_rectangular` (countX/Y, spacing); no pick UI | Pattern dialog (count + spacing + direction). | P1 |
| Pattern | Circular pattern | Around axis. | `partial` | `pattern_circular` (count/total°/start°, +Z pivot) | Pattern dialog. | P1 |
| Pattern | Path pattern | Along curve. | `partial` | `pattern_path` (sampled along polyline, optional tangent align/closed) | Pattern dialog. | P2 |
| Pattern | Linear 3D pattern | Along vector in space. | `partial` | `pattern_linear_3d` (dx/dy/dz) | Pattern dialog. | P2 |
| Pattern | Mirror (body / feature) | Mirror across plane. | `partial` | `mirror_union_plane` (YZ/XZ/XY + origin) | Mirror dialog with plane pick. | P1 |
| Pattern | Pattern-on-faces / fill pattern | Fill region. | `missing` | — | Defer. | P2 |
| Pattern | Pattern table / suppress instances | Per-instance control. | `missing` | — | Defer. | P2 |

---

## 8. Surface (advanced) & Form / Freeform / Mesh

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Surface | Extrude / Revolve / Sweep surface | Open surfaces. | `partial`/`missing` | `su_loft` reuses solid loft path; `su_extrude`/`su_revolve`/`su_sweep` = `planned`; no surface body type | Defer surface workflow; not shop-critical. | P2 |
| Surface | Patch / Boundary fill | Fill bounded region. | `missing` | `su_patch` = planned | Defer. | P2 |
| Surface | Trim / Extend / Stitch / Unstitch | Surface editing. | `missing` | all `planned` | Defer. | P2 |
| Surface | Offset surface | — | `missing` | — | Defer. | P2 |
| Form | T-Spline / freeform sculpt (Fusion Form) | Push-pull organic. | `missing` | — | Out of practical scope for the three machines. | P2 |
| Mesh | Mesh insert / repair / reduce / convert BRep | Fusion Mesh tab. | `partial` | mesh **import** exists (STL/OBJ/PLY/3MF/GLTF/OFF/DAE via `ut_import_3d`, trimesh); no mesh-edit/repair/convert | Add mesh→BRep + basic repair (FDM relevant). | P2 |

---

## 9. Sheet Metal & Plastic (Fusion contextual tabs)

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Sheet Metal | Flange / Tab / base flange | Add wall with bend. | `partial` | `sheet_tab_union` ("axis-aligned boss… no bend k-factor yet") | Add real flange with bend/k-factor; dialog. | P2 |
| Sheet Metal | Fold / Unfold | Bend with allowance. | `partial` | `sheet_fold` (k-factor / allowance / deduction modes) — kernel `implemented` | Wire to bend-line pick. | P2 |
| Sheet Metal | Flat pattern + DXF export | Unfold to flat + export. | `partial` | `sheet_flat_pattern` marker + DXF flat export (outline + bend centerlines) | Improve flat-pattern fidelity. | P2 |
| Sheet Metal | Sheet-metal rules / gauge table | Material thickness library. | `missing` | — | Defer. | P2 |
| Sheet Metal | Corner relief / bend relief / hem / jog | Edge treatments. | `missing` | — | Defer. | P2 |
| Plastic | Rule fillet | Auto-fillet all edges. | `partial` | `plastic_rule_fillet` (all-edge radius) — kernel `implemented` | Dialog. | P2 |
| Plastic | Boss | Mounting boss + hole. | `partial` | `plastic_boss` (cyl boss, optional hole, draft) | Dialog + face pick. | P2 |
| Plastic | Lip / Groove | Mating lip/groove. | `partial` | `plastic_lip_groove` (rect lip union / groove cut) | Dialog. | P2 |
| Plastic | Snap-fit / vent / grill | Plastic features. | `missing` | — | Defer. | P2 |

---

## 10. Construct (datums / reference geometry)

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Construct | Offset plane | Plane parallel at distance. | `stub` | `Viewport3DDatumPlanes.tsx` + `SketchDatumId` render datum planes; pick mode exists in `Viewport3D` (`datumPlanePickMode`) — unreachable in shell | Construct → Offset Plane once viewport mounts. | P1 |
| Construct | Plane at angle / 3-point / tangent / midplane | Various plane refs. | `missing` | — (only canonical datum planes rendered) | Add plane-construction family. | P1 |
| Construct | Axis (through edge / 2 points / cyl) | Reference axis. | `missing` | — | Add for revolve/pattern axes. | P1 |
| Construct | Point (at vertex / intersection / along) | Reference point. | `missing` | — | Add. | P2 |
| Construct | Sketch-plane selection (face / origin plane) | Pick the active sketch plane. | `partial` | `sk_choose_plane` command id exists in `DESIGN_RIBBON_COMMAND_IDS`; no canvas to host it | Foundational for any sketch flow — wire on viewport face-pick. | P0 |
| Construct | UCS / coordinate system | Local CSYS. | `missing` | — | Defer (CAM uses WCS separately). | P2 |

---

## 11. Inspect / Measure / Analysis

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Inspect | Measure (distance / angle / radius) | Point/edge/face measure. | `partial` | `ut_measure` (`MeasurementTool.tsx`, Shift+click two pts) + `Viewport3D` built-in measure — wired to the *old* viewport, not the new cockpit | Re-wire Measure to mounted viewport; chrome button is decorative now. | P0 |
| Inspect | Section analysis | Live clip + HLR. | `partial` | `ut_section` + `cad.hlr_section` (true HLR) — old viewport only | Re-wire to cockpit. | P1 |
| Inspect | Interference / clash | Body overlap. | `partial` | `as_interference` (AABB + SAT, capped) reachable in **Assembly** tab; `ut_interference` redirects there | Keep in Assembly; good. | P1 |
| Inspect | Mass / physical properties | Volume/mass/COG/inertia. | `partial` | `ut_material` = density in project.json for BOM/mass notes; no live mass-props readout | Add a Properties readout (volume/mass/COG) from the kernel solid. | P1 |
| Inspect | Center of mass display | COG marker. | `missing` | — | Pair with mass-props. | P2 |
| Inspect | Curvature / zebra / draft analysis | Surface quality. | `missing` | — | Defer (not shop-critical). | P2 |
| Inspect | Component color / appearance | Visual. | `partial` | `ut_appearance` (notes only) | Defer. | P2 |
| Inspect | Selection info / entity properties | Face area, edge length. | `partial` | selection chip shows "Face N · area mm²" from `cad.tessellate_with_ids` `faceMap` (`DesignWorkspace.tsx:782-794`) — works in cockpit selection state, but no live viewport to pick from | Becomes fully usable once viewport mounts. | P1 |

---

## 12. Assemble (in-Design assembly environment)

> The **Assembly tab is genuinely wired and interactive** in the running shell (`DesignWorkspace.tsx:898-936`): `AssemblyView` (add/remove parts, build, tessellate) + `AssemblyMatePanel` (mate solve). Joint kinematics are forward-pose only (`assembly:solve`), not multibody IK. Most rows are `partial` for that reason, not unreachability.

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Assemble | New / insert component | Add components. | `partial` | `as_new_comp`, `as_insert` (duplicate row / insert-from-project); `AssemblyView` Add | Assemble tab; good baseline. | P1 |
| Assemble | External reference / linked part | Reference external file. | `partial` | `as_external_ref` (referenceTag/partNumber/externalComponentRef metadata) | — | P2 |
| Assemble | Joint: Rigid / Slider / Revolute / Cylindrical / Planar / Ball / Universal | Kinematic joints. | `partial` | `as_joint_*` (jointState + `assembly:solve` forward pose) — **not** multibody IK | Keep; document the forward-only limitation. | P1 |
| Assemble | Mate (face/edge/point coincident/offset) | Position by mating. | `have` | `AssemblyMatePanel` → `cad.add_assembly_mate` (point/axis/plane), solves + badge | Reachable + working. | P1 |
| Assemble | Motion link / gear / cam | Coupled motion. | `partial` | `as_motion_link` (metadata + validation only; "does not drive assembly:solve pose") | Defer real coupling. | P2 |
| Assemble | As-built joint / capture position | Lock current pose. | `partial` | rigid joint enum | — | P2 |
| Assemble | Explode / motion study | Animate. | `partial` | `as_explode_motion_meta` (explode + keyframe offsets on STL instances; forward-kinematics only) | — | P2 |
| Assemble | BOM / parts list export | Bill of materials. | `have` | `as_bom` (CSV + tree .txt/.json, unit/vendor/cost, thumbnails) | Reachable + working. | P1 |
| Assemble | Assembly summary | Roll-up panel. | `have` | `as_summary` (IPC `assembly:summary`) | — | P2 |
| Assemble | Contact sets / rigid groups | Physics contact. | `missing` | — | Defer. | P2 |

---

## 13. Drawings / Documentation (in-Design drawing environment)

> The **Drawing tab is wired and interactive** (`DesignWorkspace.tsx:939-962` → `DrawingView`): live SVG projection from `cad.project_drawing`, view buttons (Front/Top/Right/Iso), dimension placement, GD&T, section, detail, title block, PDF/DXF export. Sidecar coverage is strong (`cad_handlers.py` BUILD 3/7/9/10). Projection HLR is "not certified HLR" / Tier A/B/C.

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Drawing | New sheet / title block | Sheet + border + title block. | `have` | `dr_new_sheet` + `cad.attach_title_block` | — | P1 |
| Drawing | Base view from model | Place first orthographic view. | `have` | `dr_base_view` + `DrawingView` Front/Top/Right/Iso | — | P1 |
| Drawing | Projected view | Derive orthographic neighbors. | `have` | `dr_projected_view` (third-angle metadata) | — | P1 |
| Drawing | Section view | Cut + hatch. | `partial` | `cad.section_drawing` (hatch + ASME cutting line) | Reachable via DrawingView. | P1 |
| Drawing | Detail view | Magnified crop. | `partial` | `cad.detail_drawing` (circular crop + magnify) | — | P2 |
| Drawing | Auxiliary / broken / crop view | Other view types. | `missing` | — | Defer. | P2 |
| Drawing | Dimensions (associative) | Linear/angular/radial. | `partial` | `cad.dimension_drawing` + `cad.extract_drawing_geometry` (stable-id snap anchors) | — | P1 |
| Drawing | GD&T feature control frames | Tolerance frames + datums. | `have` | `cad.annotate_gdt` (characteristic/datums/tolerance, XSS-escaped) | — | P2 |
| Drawing | Surface finish / weld symbols | Annotation symbols. | `missing` | — | Defer. | P2 |
| Drawing | BOM / parts-list table on sheet | Tabular BOM. | `have` | `cad.drawing_bom_table` | — | P2 |
| Drawing | Balloons / auto-balloon | Item callouts. | `missing` | — | Defer. | P2 |
| Drawing | Centerlines / center marks | Auto centerlines. | `missing` | — | Defer. | P2 |
| Drawing | Export PDF / DXF / DWG | Drawing output. | `have` (PDF/DXF) / `missing` (DWG) | `dr_export_pdf`, `dr_export_dxf` (SVG linework when kernel STL + Python OK) | — | P1 |

---

## 14. Parameters, History, File & Data

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Manage | Parameters (user + model params, equations) | Parameter table w/ expressions. | `have` | `ut_parameters` (Design ribbon Parameters group + FeatureTree param override Apply; `output/design-parameters.json`) — note: the Parameters *edit* lives in the cockpit Properties pane; the ribbon "group" itself is not a built ribbon | Surface a real Parameters dialog with expressions/units. | P1 |
| Manage | Change parameter → rebuild | Live regen. | `partial` | `buildParameters` override re-runs the script (`runScriptWithOverrides`) | Works for script params; tie to dialog. | P1 |
| Manage | Derive / base part | Link geometry from another doc. | `missing` | `ut_derive` = `planned` | Defer. | P2 |
| Manage | Configurations / variants | Multiple configs of one part. | `missing` | — | Defer. | P2 |
| Manage | Scripts & add-ins | Python/JS API. | `partial` | `ut_scripts` = `planned`; BUT the CadQuery editor IS effectively a scripting surface (`execute_script` with BANNED_TOKENS prescan) | Position the CadQuery editor as the "script" surface. | P2 |
| File | New / Open / Save project | Document I/O. | `have` | `ut_new`/`ut_open`/`ut_save`; project schema holds `designModels[]` + CAM jobs | — | P0 |
| File | Import (STEP / STL / OBJ / mesh) | Bring in geometry. | `have` | `ut_import_3d` (STL/STEP/STP/OBJ/PLY/GLTF/GLB/3MF/OFF/DAE; STEP→CadQuery, mesh→trimesh) | — | P0 |
| File | New from 3D file | Import-to-new-project. | `have` | `ut_new_from_import` | — | P1 |
| File | Export (STEP / STL / DXF) | Geometry out. | `have` (STL/STEP/DXF via `cad.export`) | `ut_export_stl` + `cad.export` formats | — | P0 |
| File | Export IGES / SAT / 3MF / OBJ | Other formats. | `missing` | — (export limited to step/stl/dxf in `ALLOWED_EXPORT_FORMATS`) | Add 3MF/OBJ export (FDM relevant). | P2 |
| File | Send to CAM / Manufacture handoff | Cross-workspace. | `have` | `DesignWorkspace` Send-to-CAM (`cad.export` STL → env switch → auto-import) | — | P0 |
| Manage | Undo / Redo | History edit. | `partial` | `undo-manager.ts` exists app-wide; not clearly bound to Design model edits | Bind undo to sketch/feature edits once UI lands. | P1 |
| Manage | Version history / branches | PDM-style. | `missing` | — | Out of scope. | P2 |

---

## Top gaps (highest impact first)

1. **No live 3D viewport in the Design Part cockpit (P0).** `Viewport3D.tsx` is a complete, tested Three.js viewport with orbit/pan/zoom/measure/section/datum/face-pick — but it is mounted **nowhere** in the running shell. The cockpit center pane shows a text build-summary placeholder (`DesignWorkspace.tsx:1027-1048`) and the chrome buttons/viewcube/triad are decorative (`ViewportChrome.tsx:7-9`). Mounting it unlocks measure, section, selection, datum picking, and the whole sketch flow.

2. **No mounted sketcher (P0).** The full 2D parametric sketcher (`Sketch2DCanvas.tsx` / `MvpSketchCanvas`, ~20 tools, ~17 constraints, 5 dimensions, planegcs + local solver, DOF badge) is imported **only by its test**. Operators cannot draw a single line. This orphans Sections 2–4 of this catalog (every sketch tool is `stub`-unreachable despite `implemented` kernel status).

3. **No Design ribbon (P0).** There is no Create/Modify/Sketch/Construct/Inspect ribbon — only a decorative viewport-chrome icon bar and Part/Assembly/Drawing tabs. `FUSION_STYLE_COMMAND_CATALOG` (152 entries, already grouped by `CommandRibbonGroup` and filterable) is ready to back one. Without a ribbon, ~40 kernel features are reachable only by hand-writing CadQuery.

4. **Solid features have kernels but no dialogs or face/edge selection (P0/P1).** Extrude, Revolve, Fillet, Chamfer, Shell, Hole, Combine, Pattern all exist as `kernelOps` but are driven only by raw CadQuery script or axis-bucket directions (e.g. fillet by `±X/±Y/±Z`, not by picked edges). Fillet/Chamfer/Hole/Press-Pull need true face/edge selection on the viewport (gap #1) plus a property dialog (gap #1/#3).

5. **The catalog's self-reported status is code-maturity, not UI-reachability (process gap).** `fusion-style-command-catalog.ts` marks ~87 commands `implemented`, but from the operator's seat most sketch/solid/inspect commands are unreachable in the new shell. Recommend the catalog gain a `reachable` dimension so "built" ≠ "usable" stops hiding the cliff.

6. **Construct (datums/axes/points) is essentially absent (P1).** Only canonical datum planes render (`Viewport3DDatumPlanes`); offset/angle/3-point planes, reference axes, and points don't exist. `sk_choose_plane` has a command id but no host. Sketch-on-face is blocked without this + the viewport.

7. **Sketch text / engraving profiles missing (P1).** No font→vector / sketch-text, so emboss/deboss and the Laguna v-carve + Carvera engraving workflows (explicit shop machines) can't originate geometry in-app. Pairs with an Emboss/Deboss feature.

8. **Mass properties / inspect readouts thin (P1).** No live volume/mass/COG readout; `ut_material` only stores density text for BOM. Measure + Section exist in code but are bound to the retired viewport.

9. **Direct-edit & body-transform breadth (P1/P2).** Move/Copy is translate-only (no rotate/triad manipulator); Draft, true Scale, Replace/Delete/Offset-face are missing. Press-Pull exists but has no direct face manipulator.

**Net:** The Design environment is ~80% built at the kernel/code level and ~20% reachable in the running shell. The single highest-leverage program is **Wave 2 "CAD foundation: real viewport + ribbon"** — mount `Viewport3D` + `Sketch2DCanvas`, build the ribbon off the existing command catalog, and add property dialogs + face/edge selection. That one wave flips the majority of `stub`-unreachable rows in Sections 1–5, 10, 11 to `have`/`partial` with little new kernel work.
