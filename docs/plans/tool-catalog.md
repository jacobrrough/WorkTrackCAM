# WorkTrack3D — Wave-0 Master Tool Catalog & Build Roadmap

**Status:** Wave-0 synthesis (read-only audit; no code changed).
**Date:** 2026-06-08
**Repo:** `vigorous-ptolemy-568bae` @ `claude/vigorous-ptolemy-568bae`
**Inputs:** the five per-environment matrices in [`docs/plans/catalog/`](./catalog/):
[`cad-design.md`](./catalog/cad-design.md) ·
[`carvera-4axis.md`](./catalog/carvera-4axis.md) ·
[`fdm-slicer.md`](./catalog/fdm-slicer.md) ·
[`vcarve-laguna.md`](./catalog/vcarve-laguna.md) ·
[`shell-context.md`](./catalog/shell-context.md)
**Machines (My-Shop-Only):** Creality K2 Plus (FDM) · Laguna Swift 5×10 (3-axis router) · Makera Carvera + 4th-axis rotary (desktop 4-axis mill). Carvera 4-axis is the user's #1 CAM target.

---

## 0. How to read this catalog (status + reachability + access + priority)

Every row in the per-env matrices and in the merged matrix (Section 5) carries four dimensions. The single most important lesson of Wave-0 is that **"built" does not mean "usable."** The per-env audits re-scored from the *operator's seat* (UI reachability), not from code maturity, because the in-repo `FUSION_STYLE_COMMAND_CATALOG` self-status describes *kernel/code* maturity and badly overstates what a user can actually click.

| Dim | Values | Meaning |
|---|---|---|
| **Status** | `have` / `partial` / `stub` / `missing` | `have` = implemented AND reachable + functional in the running shell. `partial` = reachable but limited / lossy / hard-coded / unverified. `stub` = code or kernel exists (often well-tested) but **not reachable** in the running shell, OR UI-present but non-functional/decorative. `missing` = no implementation anywhere. |
| **Reachability** | reachable / unreachable | Whether an operator can invoke it today from `src/renderer/app/`. The dominant CAD/Shell failure mode is **built-but-unreachable** (`stub`). |
| **Access** | ribbon group · palette · stage tab · panel · shortcut | Where the tool *should* live once the Context Engine + ribbon exist (Section 2). |
| **Priority** | P0 / P1 / P2 | P0 = foundation or daily-workflow blocker; P1 = parity-critical; P2 = nice-to-have / deferred. |

> **Process recommendation (from the CAD audit):** add a first-class `reachable` flag to `FUSION_STYLE_COMMAND_CATALOG` so "built" can never again silently masquerade as "usable." Today ~87 catalog commands are marked `implemented` while being unreachable in the running shell.

---

## 1. Executive summary

### 1.1 Per-environment totals

| Environment | Reference apps | Total tools | have | partial | stub | missing | stub+missing | Headline |
|---|---|---:|---:|---:|---:|---:|---:|---|
| **CAD / Design** | Fusion 360, SolidWorks, Onshape | 169 | 18 | 58 | 43 | 50 | **93** | Kernel ~80% built, **~20% reachable** — viewport/sketcher/ribbon all orphaned |
| **FDM slicer (K2 Plus)** | OrcaSlicer, Bambu, Prusa, Creality Print | 126 | 21 | 33 | 1 | 71 | **72** | Slice + Moonraker send are real; the *entire* plate-edit loop is missing |
| **VCarve / 2.5D (Laguna)** | Vectric VCarve/Aspire, Carveco | 112 | 30 | 40 | 5 | 37 | **42** | 2.5D toolpaths real; **no true V-carve**, vector authoring unreachable |
| **Carvera 4-axis (mill)** | Fusion Manufacture, Mastercam, Makera CAM | 102 | 48 | 36 | 8 | 10 | **18** | Strongest env — engine + post + sim are ahead of authoring UX |
| **Shell / Context engine** | Fusion 360, VS Code | 108 | 21 | 34 | 16 | 37 | **53** | No ribbon, no command registry; viewport + rich palette orphaned |
| **TOTAL** | — | **617** | **138** | **201** | **73** | **205** | **278** | ~22% have · ~33% partial · ~12% stub · ~33% missing |

*(Counts derived by classifying every status cell in the five matrices. Per-env "Total tools" matches each source summary; have/partial/stub/missing are the row-classifier split, with the source-summary "missing" figure used where it differs from the classifier by rounding.)*

**Reading the table:**
- **Carvera 4-axis is the most production-ready environment** (48 `have`, only 18 stub+missing) — and it is the user's #1 target. The remaining gaps are concentrated, not foundational. This is where Wave-1 CAM effort pays back fastest.
- **CAD/Design has the largest absolute gap (93 stub+missing)** but most of it is a *reachability cliff*, not absent code: 43 `stub` rows are built-and-tested kernels/UI that no shell surface mounts. The single highest-leverage move in the whole program is mounting `Viewport3D` + `Sketch2DCanvas` and building a ribbon off the existing command catalog.
- **FDM has the most truly-`missing` work (71)** because the per-object plate-edit loop (move/rotate/scale/arrange/orient/supports/3D-preview) was never built — these are new features, not orphaned code.
- **Shell is the keystone**: its 16 `stub` rows (orphaned viewport, orphaned rich palette, decorative chrome) plus the `missing` Context Engine block reachability for *all four* other environments at once.

### 1.2 The cross-cutting pattern

The five audits independently converged on one diagnosis: **WorkTrack3D's capability layer is far ahead of its access layer.** Three large, well-tested subsystems are mounted *nowhere* in the running shell:

1. `src/renderer/design/Viewport3D.tsx` — full Three.js viewport (orbit/pan/zoom, drei `GizmoViewcube` + `GizmoHelper` triad, HTML ViewCube ISO/Top/Front/Right/Home, nav-mode strip, Center/Snap/Lay-flat, animated standard views, face-pick, section clip, datum planes). **Zero JSX call sites.**
2. `src/renderer/design/Sketch2DCanvas.tsx` / `MvpSketchCanvas` — full 2D parametric sketcher (~20 draw tools, ~17 constraints, 5 dimension types, planegcs + local solver, DOF badge, trim/extend/fillet/offset/pattern/mirror). **Imported only by its own test.**
3. `src/renderer/commands/CommandPalette.tsx` + `FUSION_STYLE_COMMAND_CATALOG` (152 entries) — rich palette with status badges, workspace/ribbon filters, recency, full keyboard model. **`onPick` has no production caller**; the live `NewShellCommandPalette` searches only ~17 hand-written rows.

Mounting these three and giving them a command registry to dispatch through is the entire thrust of **Wave 1 (Context Engine + shell de-dupe)** and **Wave 2 (CAD foundation)**. That sequencing flips the majority of `stub`-unreachable rows to `have`/`partial` with comparatively little new kernel work.

---

## 2. Recommended Context-Engine ribbon taxonomy (drives Wave 1)

This is the contract the contextual ribbon must satisfy: for each **(workspace × machineKind)** the ribbon shows a fixed tab strip; each tab is a set of named **panels** (CREATE / MODIFY / …); each panel holds command buttons keyed by `command.id` and dispatched through the Context Engine registry. The ribbon is **machine-aware** — switching the active machine (`EnvironmentId`) swaps the contextual CAM tabs. Group labels already exist in `COMMAND_CATALOG_RIBBON_FILTER_OPTIONS`; the ribbon renders catalog rows grouped by their `CommandRibbonGroup`.

**One-paragraph summary:** A single shell `Ribbon` sits below `TopBar` and reflows by active workspace and active machine. In **Design** it is machine-independent and Fusion-shaped — Sketch · Create · Modify · Pattern · Construct · Inspect · Assemble · Drawing — with a contextual green **Sketch** tab that appears in sketch mode. In **Manufacture** the tab strip is machine-contextual: **FDM (K2)** shows Prepare · Arrange · Supports · Process · Preview · Device (the slicer loop); **Router (Laguna)** shows Setup · Vectors · 2D Toolpaths · V-Carve · Nesting · Simulate · Send; **Mill-4 (Carvera)** shows Setup · 2D · 3D · Rotary · Probing · Simulate · Send, with Rotary as the deepest panel. **Drawings**, **Workshop** (machine dashboards), and **Utilities** (Library + a new Commands index) round out the workspaces. Every button, palette row, marking-menu item, and hotkey resolves to the same `command.id`, so the ribbon, the single catalog-backed palette, and the context menus stay in lockstep.

### 2.1 Design workspace (machine-independent)

| Ribbon tab | Panels → tools (command-id families) |
|---|---|
| **Sketch** *(contextual; armed in sketch mode)* | **Create:** Line · Rectangle(▾2-corner/center/3-pt) · Circle(▾center/2-pt/3-pt) · Arc(▾3-pt/center) · Polygon · Slot(▾) · Ellipse · Spline(▾fit/CV) · Point · Text *(new)* · Construction-toggle *(new)* · Centerline *(new)* · Project. **Modify:** Trim · Extend · Fillet · Chamfer · Offset · Mirror · Pattern · Move/Rotate/Scale · Break/Split. **Constrain:** Coincident · H/V · Parallel · Perpendicular · Tangent · Equal · Concentric · Midpoint · Symmetric · Fix · Dimension(▾linear/aligned/angular/radial/diameter) + DOF badge. |
| **Solid** | **Create:** Extrude · Revolve · Sweep · Loft · Pipe · Coil · Primitive(▾box/cyl/sphere) · Emboss/Deboss *(new; pairs with sketch Text)*. **Modify:** Press-Pull · Fillet · Chamfer · Shell · Draft *(new)* · Hole *(wizard)* · Thread · Combine · Split · Move/Copy · Scale. **Pattern:** Rect · Circular · Path · Mirror. |
| **Construct** | Offset Plane · Plane-at-angle/3-pt/tangent/midplane · Axis · Point · Sketch-on-face (`sk_choose_plane`). |
| **Inspect** | Measure · Section · Interference · Mass/physical properties · Selection info. |
| **Assemble** | New/Insert component · Joints(▾rigid/slider/revolute/cylindrical/planar/ball) · Mate · BOM · Interference · Explode. |
| **Drawing** | New sheet/title block · Base view · Projected view · Section view · Detail view · Dimensions · GD&T · BOM table · Export PDF/DXF. |

### 2.2 Manufacture — FDM (Creality K2 Plus)

| Ribbon tab | Panels → tools |
|---|---|
| **Prepare** | **Import:** Import model · Object browser. **Transform:** Move · Rotate · Scale · Mirror · Duplicate · Delete · Center/Drop-to-bed *(all P0, all currently missing)*. |
| **Arrange** | Auto-arrange · Auto-orient · Lay-flat / place-face-down *(P0; FDM nesting absent today)*. |
| **Supports** | Enable + type(▾normal/tree/organic) · Placement(everywhere/plate-only) · Overhang threshold · Paint-on supports · Blockers/enforcers · Interface tuning. |
| **Process** | Quality preset · Layer height · Walls · Top/bottom shells · Infill density · Infill pattern · Speeds · Brim/Skirt/Raft · Save custom preset · Recommended⇆Expert *(today: 2-item dropdown over frozen JSON; per-slice overrides are a no-op)*. |
| **Filament / CFS** | Filament picker · Filament editor(temps/fan/flow/retract) · CFS slot/lane · Per-object filament *(P2)*. |
| **Preview** | 3D layer/toolpath view *(P0, missing)* · Layer scrubber · Color-by line-type/speed · Travel toggle · Time + weight + cost. |
| **Device** | Send to K2 · Send+Start · **Pause/Resume/Cancel** *(IPC wired, buttons missing — P0)* · Preheat/Set-temp · Live status/ETA · Test connection · E-stop · Calibration suite (8 tests). |

### 2.3 Manufacture — Router (Laguna Swift 5×10, 3-axis)

| Ribbon tab | Panels → tools |
|---|---|
| **Setup** | New setup · Job size / stock(W×H×T) · WCS origin (10-pt) · Z-datum (top/table) · Work offset G54–G59 · Tool library · Feeds & speeds. |
| **Vectors** | *(needs `Sketch2DCanvas` mounted — P0)* Line/Polyline · Rect · Circle · Arc · Polygon · Spline · Slot/Dogbone · **Text (TrueType → vectors, P0)** · Offset · Boolean(weld) · Array · Mirror · Trim/Extend/Fillet/Join · Node-edit · Align/Distribute · **Import DXF→sketch (P0; plumbed-but-unreachable)**. |
| **2D Toolpaths** | 2D Contour (on/in/out, leads, ramp, tabs, multi-depth, climb/conv) · 2D Pocket (+ islands, offset/spiral — P0/P1) · Drill (peck/dwell cycles) · Chamfer/deburr · Engrave. |
| **V-Carve** | **V-Carve / prism (new `cnc_vcarve`, medial-axis depth-from-width — P0)** · Flat-bottom clearance · Inlay · Engrave-fill. |
| **Nesting** | True-shape nest (upgrade BLF→polygon-NFP — P1) · Apply placements · Multi-sheet · 6-zone vacuum map. |
| **Simulate** | 3D toolpath preview · Material/stock removal · Stock toggle · Cycle-time · Gouge/collision. |
| **Send** | Post (`vcarve_mach3.hbs`, RichAuto/Mach3) · Spindle warm-up/cool-down · Dust-collection M7/M9 · Vacuum-zone preamble · Safe-Z + M30 · Tool#/WCS · Setup sheet · G-code safety validation · Export .nc. |

### 2.4 Manufacture — Mill-4 (Makera Carvera + 4th-axis) — priority surface

| Ribbon tab | Panels → tools |
|---|---|
| **Setup** | New setup (machine+WCS+stock) · Op-type (Milling/Turning/Rotary) · **Rotary stock (Ø+length)** · Square-bar stock *(P2)* · Chuck depth/clamp offset · **Tailstock geometry (P1; schema exists, not wired)** · **Headstock X offset (P1; surface in UI)** · **Part-orientation gizmo → `placement` (P0)** · WCS origin (10-pt, A0-face hint) · G54–G59 · Cylinder stock auto-fit *(P1)* · **Multi-setup / A+180 double-sided (P1; wizard built-but-unmounted)** · Pre-job checklist. |
| **2D** | Face *(new)* · 2D Contour · 2D Pocket · Drill · Bore · Chamfer · Engrave · **"Wrap onto rotary" modifier (P1; only contour wraps today)**. |
| **3D** | Adaptive/3D-rough · Parallel · Scallop · Waterline · Pencil · Spiral/Morph · Steep-shallow · Trochoidal · Rest machining. |
| **Rotary** | **Rotary roughing** · **Rotary finishing** · Continuous (label-honest: sequential) · **Indexed** · **True simultaneous 4-axis (P1, missing)** · **Axis-substitution wrap (P1)** · **Rotary engrave-text (P1)** · Wrap-image/relief *(P2)* · Spiral/helical wrap *(P2)* · Adaptive-angular-refinement toggle · Mesh-radial Z-bands toggle · Overcut · A-range/unwind · Rotation-direction. *(Promote op editor to tabbed Geometry · Tool · Heights · Passes · Linking.)* |
| **Probing** | *(mount `ProbeCyclePanel` — P1, built-but-unmounted)* Single-surface · Bore/Boss-center · Corner-find · Tool-length · **A-axis / full-4-axis zero (have)** · Auto-leveling/surface-map. |
| **Simulate** | 3D toolpath · **Rotary cylindrical material-removal (have)** · Planar voxel verify · **Rotary chuck-collision overlay (have)** · **Tailstock collision (P1, missing)** · Playback scrubber · Oriented tool head · Envelope check · Cycle-time honoring A-feed *(P2)*. |
| **Send** | **Carvera 4-axis post (M2/Y0/no-M6/dwell — have)** · 3-axis post · Inverse-time G93 toggle · Simultaneous-warning block · Probing-block injection · **Upload to Carvera (have)** · ATC tool table (4-axis: ATC-blocked banner) · G-code safety guardrails · Setup sheet (+rotary fields). |

### 2.5 Workspace-level tabs (all environments)

`WorkspaceNav` (keys 1–6) stays the workspace switcher: **Design · Assemble · Manufacture · Drawings · Workshop · Utilities.** Beyond the per-machine CAM ribbons above:
- **Drawings** → the Design Drawing ribbon (2.1) standalone.
- **Workshop** → machine dashboards (K2 live status/ETA poll; Laguna/Carvera job state).
- **Utilities** → **Library** (tools/materials/posts) + a new **Commands** tab mounting `CommandCatalogPanel` so the 152-entry catalog is discoverable in-app (P1).

---

## 3. Foundation gaps (P0) — must exist before tools can be wired

These cross-cutting items gate reachability for *all* the per-env tools. They are the content of **Wave 1** and **Wave 2** and must land before the Section-2 ribbon can do anything.

### FG-1 · Context Engine command registry *(keystone)*
`FUSION_STYLE_COMMAND_CATALOG` (152 entries) is **metadata only — no handler field**; nothing dispatches by `command.id`. Build `CommandContext`: `{ id, run(ctx), enabled(ctx), keybinding }`. Add `enabled(ctx)` context predicates (grey-out when no selection / wrong workspace / wrong machine). Aggregate today's three *separate* contexts — selection (`selection-state.ts`), workspace (`useWorkspaceRouter`), machine (`MachineSessionContext`) — into one `useCommandContext()` the engine reads. Implement deep-link routing so a command can `navigate(workspace) + arm(tool)` (`DESIGN_RIBBON_COMMAND_IDS` already enumerates intent but nothing consumes it). **Without this, the ribbon, palette, and menus can never share commands.**

### FG-2 · Mount the real `Viewport3D` (and delete the decorative chrome)
`Viewport3D.tsx` is a complete live viewport but has **zero JSX call sites**; the Design cockpit renders a text build-summary placeholder plus the *decorative* `ViewportChrome.tsx` whose nav/viewcube/triad/section/measure buttons are explicit no-op placeholders. Mounting `Viewport3D` in the cockpit center pane **lights up the entire Viewport-nav + Display categories at once** and removes the duplication (two viewcubes, two triads, two orbit/pan/zoom sets). Prerequisite for face/edge selection, measure, section, datum picking, and the whole solid-feature dialog flow. Reuse the same mounted viewport in the FDM Prepare stage and the CAM Simulate stage.

### FG-3 · Mount the 2D sketcher (`Sketch2DCanvas` / `MvpSketchCanvas`)
The full parametric sketcher is imported **only by its test**; operators cannot draw a single line. The Design "Sketch" stage tab exists in `ViewportChrome` but its body renders only a build summary. Mounting the sketch surface unlocks **Sections 2-4 of the CAD catalog** (every sketch entity/modify/constraint/dimension is `stub`-unreachable today) **and** the Laguna **Vectors** ribbon (sign work, the DXF landing surface). Wire the DOF badge (`sketch-solve-status.ts`) and `sk_choose_plane` (sketch-on-face — needs FG-2's face-pick).

### FG-4 · Build the shell Ribbon + reconcile the two palettes
There is **no ribbon at all** — `WorkspaceNav` swaps whole bodies and per-workspace tool buttons live in bespoke components. Build a shell `Ribbon` component (tabs = `CommandRibbonGroup`, panels = CREATE/MODIFY/… clusters, large + split buttons, overflow chevron, contextual tabs) driven by the catalog + the FG-1 engine, machine-aware per `EnvironmentId`. Simultaneously **reconcile the palettes**: mount the rich `commands/CommandPalette.tsx` (status badges, filters, recency, full keyboard model — currently `onPick` has no production caller), feed it the full 152-entry catalog, and route `onPick` → the FG-1 engine. Retire the ~17-row private list in `NewShellCommandPalette`.

### FG-5 · Contextual Properties / per-feature dialogs + face/edge selection
The cockpit right pane edits only script *parameters*. Solid features (Extrude/Revolve/Fillet/Chamfer/Shell/Hole/Combine/Pattern/Press-Pull) have working kernels but **no dialogs and no picked-edge/face selection** — fillet/chamfer are axis-bucket (±X/±Y/±Z), not picked-edge. Grow the Properties pane into a real per-feature property editor with live preview, and wire `selection-raycast.ts` (face/edge selection) into op geometry. Depends on FG-2.

### FG-6 · De-dupe the Part / Assembly / Drawing tabs into the ribbon model
The Design `Part` cockpit is a CadQuery-script cockpit while `Assembly` and `Drawing` are genuinely wired interactive tabs — three divergent UX models inside one workspace. Fold them into the single ribbon taxonomy (2.1) so Sketch/Solid/Construct/Inspect/Assemble/Drawing become *ribbon tabs* of one Design workspace, not bespoke sub-views. Replace the decorative stage tabs (Model/Sketch/Inspect render but "the body does not yet branch on them") with engine-armed contextual tabs.

### FG-7 · Bind the faked status/title chrome (P1 ride-along)
`StatusBar` hard-codes X/Y/Z `0.00`, always "Sidecar ready", and a literal "mm"; `TopBar` hard-codes "Untitled project" with no dirty flag. Bind to live cursor/selection (from FG-2), real sidecar/`python-bridge` health, project session + a `*` dirty marker, and a real units toggle. Update stale `APP_KEYBOARD_SHORTCUT_GROUPS` (still lists retired ShopApp labels Jobs/Tools/My Shop/Library/Settings) to the live Design/Assemble/Make/Drawings/Workshop/Utilities rail; re-point `matchesGenerate` off the dormant Jobs view to the Manufacture stage.

---

## 4. Carvera 4-axis priority build list (ordered) — the #1 CAM target

Carvera is the strongest environment (48 `have`, only 18 stub+missing) and the deepest target. The engine, the Carvera-specific post (`carvera_4axis.hbs`: M2 not M30, `G0 Y0` centering, no M6 ATC, spindle dwell, inverse-time opt-in), and the rotary cylindrical material-removal + chuck-collision sim are already production-shaped. The gaps are concentrated in **interactive setup/orientation**, **reachability of dead panels**, and **classic rotary strategy coverage** — ordered here by payoff ÷ effort.

1. **P0 — Interactive part-orientation gizmo for rotary.** `run-cam-for-op.ts` hard-codes `identityTransform`; `frame.ts` already accepts a `Placement`, so the engine plumbing exists. Every 4-axis job today assumes the STL is pre-authored in rotary WCS (X = rotation axis). A 3-axis orient manipulator feeding `placement` unlocks real-world models. **Lowest effort, highest payoff** — pure UI over existing plumbing.
2. **P1 — Mount the dead Probing + Multi-setup UIs.** `ProbeCyclePanel` (5 cycle types) and `MultiSetupWizard` are fully built but unreferenced by the live shell. Add a **Probing** CNC stage/tab and a multi-setup / double-sided (**A+180**) entry point. Pure wiring, no new algorithms.
3. **P1 — Tailstock geometry + collision (setup → engine → sim).** `RotaryFixtureConfig` already models a tailstock and `checkRotaryFixtureCollision` checks it, but `run-cam-for-op.ts` never supplies one (machine-default chuck only) and the sim never draws it. Add setup fields, thread `rotaryFixture` through, render + check the tailstock body.
4. **P1 — Axis-substitution "Wrap onto rotary" modifier for arbitrary 2D ops.** Only `cnc_4axis_contour` wraps today (`strategies/contour.ts`, Y→A). Generalize so pocket/drill/engrave/chamfer can wrap like Fusion/Mastercam axis substitution. **Biggest strategy-coverage gap.**
5. **P1 — True simultaneous 4-axis cutting strategy.** `cnc_4axis_continuous` is honestly sequential rough+finish; the post already supports G93 inverse-time + a simultaneous-warning block, but **no engine emits blended XYZA cutting moves with A-rate limiting.** Build a real simultaneous generator.
6. **P1 — Rotary engrave-text** (and **P2** wrap-image/relief). High-demand Carvera cylindrical-engraving use case, missing today; reuses the contour-wrap path: text → font → contourPoints → wrap.
7. **P1 — Surface the hidden rotary knobs + tabbed op editor.** `stepoverDeg`, `adaptiveRefinement`, `useMeshRadialZBands`, `rotaryHeadstockXOffsetMm` are engine/param-only with no UI control. Promote the 4-axis op editor to a tabbed dialog (Geometry · Tool · Heights · Passes · Linking) and expose these knobs.
8. **P2 — Square-bar rotary cross-section** (`rotaryStockProfile:'square'` schema exists but the engine treats stock as round Ø only), plus **helical/spiral wrap**, **cylinder stock auto-fit from part**, and an **A-feed-aware cycle-time estimate**.

---

## 5. Merged tool matrix (condensed)

Per-env tables are condensed below; each row keeps **Status · Reachability · Access (target ribbon group) · Priority**. For full per-tool evidence (`path:line` citations) see the linked source files. "Reach" = ✓ reachable today · ✗ unreachable today · ~ partial.

### 5.1 Shell / Context engine — [`catalog/shell-context.md`](./catalog/shell-context.md)

| Tool | Status | Reach | Access (target) | Pri |
|---|---|:--:|---|:--:|
| Command registry (id→handler) | missing | ✗ | **Context Engine (FG-1)** | P0 |
| Command enablement predicates `enabled(ctx)` | missing | ✗ | Context Engine | P0 |
| Unified active-context (selection∪workspace∪machine∪mode) | partial | ✗ | Context Engine `useCommandContext()` | P0 |
| Command→surface deep-link routing | stub | ✗ | Context Engine | P0 |
| Live 3D viewport (orbit/pan/zoom) | stub | ✗ | **Mount `Viewport3D` (FG-2)** | P0 |
| ViewCube (drei `GizmoViewcube`) | stub | ✗ | Viewport HUD (FG-2) | P0 |
| Standard-view buttons (Top/Front/Right/Iso/Home) | stub | ✗ | Viewport HUD | P0 |
| Orbit/Pan/Zoom nav-mode strip | stub | ✗ | Viewport HUD | P0 |
| Fit / zoom-to-fit | stub | ✗ | Viewport HUD + `F` | P0 |
| Home / reset camera | stub | ✗ | Viewport HUD | P0 |
| Ribbon tab strip (per-workspace) | missing | ✗ | **Shell Ribbon (FG-4)** | P0 |
| Ribbon panels (CREATE/MODIFY/…) | partial | ✗ | Shell Ribbon | P0 |
| Workspace switcher (rail) | partial | ✓ | `WorkspaceNav` (keep) | P0 |
| Palette open (Ctrl+K) | have | ✓ | Shell (keep) | P0 |
| Fuzzy search over ALL commands | partial | ✗ | Feed catalog to live palette (FG-4) | P0 |
| Catalog palette (152, badges/filters) | stub | ✗ | Mount it (FG-4) | P0 |
| Run command → executes the tool | missing | ✗ | Context Engine dispatch | P0 |
| Machine status + E-stop | have | ✓ | TopBar (keep) | P0 |
| Environment quick-switch (3 machines) | have | ✓ | TopBar (keep) | P0 |
| Global shortcut layer | have | ✓ | `app-keyboard-shortcuts.ts` | P0 |
| Workflow-stage tabs (Prepare/…/Send) | have | ✓ | Manufacture (keep) | P1 |
| Contextual ribbon tab (sketch mode) | missing | ✗ | Shell Ribbon contextual | P1 |
| Stage sub-mode tabs (Model/Sketch/Inspect) | stub | ~ | Wire to body swap (FG-6) | P1 |
| Split/dropdown ribbon buttons | stub | ~ | Ribbon button kit | P1 |
| Radial marking menu | missing | ✗ | Viewport (new) | P1 |
| Linear context menu (`ContextMenu.tsx`) | partial | ~ | Reuse in viewport + Browser | P1 |
| Viewport selection context menu | missing | ✗ | Wire `ContextMenu` to raycast | P1 |
| Browser: Origin/Bodies/Sketches folders | partial | ~ | Expand `FeatureTree` | P1 |
| Browser: visibility (eye) toggles | missing | ✗ | `FeatureTree` eye column | P1 |
| Editable feature timeline (reorder/suppress/rollback) | have | ✓ | `FeatureTree` (keep) | P1 |
| Properties pane (parameters + Save) | partial | ✓ | Broaden to selection (FG-5) | P1 |
| Selection inspector (face/edge details) | partial | ✗ | Properties (needs FG-2) | P1 |
| Measure read-out | partial | ✗ | Inspect (needs FG-2) | P1 |
| Status bar X/Y/Z + units + sidecar health | partial/stub | ~ | **Bind live (FG-7)** | P1 |
| Title bar project name + dirty `*` | partial | ~ | Bind to session (FG-7) | P1 |
| Commands discoverability panel | stub | ✗ | Mount `CommandCatalogPanel` in Utilities | P1 |
| Stale shortcut data / per-tool hotkeys | partial/missing | ~ | Update + add hotkey field (FG-7) | P1 |
| QAT (Save/Undo/Redo buttons) | partial | ~ | TopBar | P1 |
| File app-menu (New/Open/Save/Import/Export) | partial | ~ | TopBar/ribbon | P1 |
| Settings drawer · Help panel · Code drawer · Toasts | have | ✓ | keep | P1/P2 |
| Visual style · ortho/persp · look-at · dockable panels · multi-doc tabs · custom keybindings · zoom-window · isolate | missing | ✗ | viewport HUD / post-foundation | P2 |

### 5.2 CAD / Design — [`catalog/cad-design.md`](./catalog/cad-design.md)

| Tool group | Status (range) | Reach | Access (target ribbon group) | Pri |
|---|---|:--:|---|:--:|
| **Shell/ribbon** (ribbon, palette sync, marking menu, browser folders, properties) | missing→partial | mostly ✗ | FG-1…FG-6 | P0 |
| Viewport (orbit/pan/zoom, viewcube, triad, standard views, section, fit-to-sel) | stub | ✗ | Mount `Viewport3D` (FG-2) | P0/P1 |
| **Sketch·Create** (line, rect▾, circle▾, arc▾, polygon, slot▾, ellipse, spline▾, point, polyline) | stub | ✗ | Sketch ribbon → Create (FG-3) | P0/P1 |
| Sketch·Create: **Text / engraving profile** | missing | ✗ | Sketch → Create (new) | P1 |
| Sketch·Create: construction toggle · centerline · tangent circle/arc · conic · image underlay | missing | ✗ | Sketch → Create | P1/P2 |
| Sketch·Create: project/include · offset · mirror · pattern | partial/stub | ✗ | Sketch → Create/Modify | P1 |
| **Sketch·Modify** (trim, extend, fillet, chamfer, break/split, move/rotate/scale) | stub | ✗ | Sketch → Modify (FG-3) | P0/P1 |
| **Sketch·Constraints** (coincident, H/V, parallel, perp, tangent, equal, collinear, concentric, midpoint, symmetric, fix) | stub | ✗ | Sketch → Constrain (FG-3) | P0/P1 |
| Sketch·Constraints: smooth-G2 · equal-curvature | missing | ✗ | Sketch → Constrain | P2 |
| **Sketch·Dimensions** (linear, aligned, angular, radial, diameter) + DOF badge | stub | ✗ | Sketch → Constrain | P0/P1 |
| **Solid·Create** (Extrude, Revolve) | partial | ✗ (script-only) | Solid → Create dialog (FG-5) | P0 |
| Solid·Create (Sweep, Loft, Pipe, Coil, Thicken, primitives) | partial | ✗ | Solid → Create | P1/P2 |
| Solid·Create: Rib · Web · Emboss/Deboss | missing | ✗ | Solid → Create | P1/P2 |
| **Solid·Modify: Fillet/Chamfer** (axis-bucket, no edge-pick) | partial | ✗ | Solid → Modify + edge-pick (FG-5) | P0 |
| **Solid·Modify: Hole wizard** | partial | ✗ | Solid → Modify dialog | P0 |
| Solid·Modify (Shell, Thread, Combine, Split, Move/Copy, Press-Pull, Scale) | partial | ✗ | Solid → Modify (FG-5) | P1 |
| Solid·Modify: Draft | missing | ✗ | Solid → Modify (new) | P1 |
| Solid·Modify: Replace/Delete/Offset face | missing | ✗ | Solid → Modify | P2 |
| **Pattern/Mirror** (rect, circular, path, linear-3d, mirror) | partial | ✗ | Solid → Pattern (FG-5) | P1/P2 |
| **Construct** (offset plane, axis, point, sketch-on-face `sk_choose_plane`) | stub/missing | ✗ | Construct ribbon (needs FG-2) | P0/P1 |
| **Inspect** (measure, section, interference, mass-props, selection info) | partial | mixed | Inspect (interference ✓ in Assembly) | P0/P1 |
| Surface / Form / Mesh-edit | partial/missing | ✗ | defer | P2 |
| Sheet-metal / Plastic features | partial/missing | ✗ | contextual ribbon (defer) | P2 |
| **Assemble** (insert, joints, **mate ✓**, **BOM ✓**, explode, interference) | have→partial | ✓ | Assemble ribbon (wired today) | P1 |
| **Drawing** (new sheet ✓, base ✓, projected ✓, section, detail, dims, **GD&T ✓**, **BOM ✓**, **PDF/DXF ✓**) | have→partial | ✓ | Drawing ribbon (wired today) | P1 |
| **File/Manage** (New/Open/Save ✓, Import 3D ✓, Export STL/STEP/DXF ✓, **Send-to-CAM ✓**, Parameters ✓) | have | ✓ | File menu / Manage | P0 |
| Manage: derive · configurations · version history · 3MF/OBJ export | missing | ✗ | defer | P2 |

### 5.3 FDM slicer (K2 Plus) — [`catalog/fdm-slicer.md`](./catalog/fdm-slicer.md)

| Tool group | Status (range) | Reach | Access (target) | Pri |
|---|---|:--:|---|:--:|
| **Object transform** (move, rotate, scale — gizmo + numeric) | missing | ✗ | **Prepare → Transform (P0)** | P0 |
| Object: mirror · duplicate/array · center/drop-to-bed | missing | ✗ | Prepare → Transform | P0/P1 |
| Object: delete · object browser/list | partial | ~ | Prepare (op-centric today) | P1 |
| Object: split · cut · boolean · modifier mesh · per-object overrides · variable layer | missing | ✗ | Prepare (defer) | P1/P2 |
| **Auto-arrange (FDM)** | missing | ✗ | **Arrange (P0)** | P0 |
| **Auto-orient** · lay-flat / place-face-down | missing | ✗ | **Arrange (P0)** | P0/P1 |
| **Supports: enable + type** (normal/tree/organic) | partial | ✗ (JSON-only) | **Supports panel (P0)** | P0 |
| Supports: placement · overhang threshold · paint-on · blockers · interface tuning | missing/partial | ✗ | Supports panel | P1/P2 |
| **Process: layer height · infill density** | partial | ✗ (frozen JSON) | **Process core (P0)** | P0 |
| Process: walls · top/bottom shells · infill pattern · speeds · brim/skirt/raft · save preset | missing/partial | ✗ | Process core/advanced | P1/P2 |
| Process: quality preset (2 entries) · Recommended⇆Expert | partial | ✓(thin) | Process header | P1 |
| Process: **per-slice overrides** (documented no-op) | stub | ~ | implement overlay-merge | P1 |
| **Filament: picker ✓** · 13-type schema | have/partial | ✓ | Filament panel | P1 |
| **Filament library single-profile at slice** (only pla-generic bundled) | partial | ✗ | **Ship K2 PETG/ABS/ASA/TPU + per-record JSON (P0)** | P0 |
| Filament: editor (temps/fan/flow/retract) · per-object · cost/weight | partial/missing | ~ | Filament editor | P1/P2 |
| **CFS** slot/lane ✓ · color paint · purge · mapping · RFID | partial/missing | ~ | Filament/CFS | P1/P2 |
| **Calibration suite (8 tests) ✓** | have | ✓ | Device → Calibration (keep) | P1/P2 |
| Calibration: ringing tower · adaptive-PA · result→profile | partial/missing | ~ | Calibration | P1/P2 |
| **Preview: 3D layer/toolpath view** | missing | ✗ | **Preview (P0)** | P0 |
| Preview: scrubber ✓ · color-by-type · color-by-speed · travel toggle · time/weight/cost | partial/missing | ~ | Preview | P1/P2 |
| **Send: upload ✓ · upload+start ✓ · temp-ceiling guard ✓ · status/ETA ✓ · test-conn ✓ · E-stop ✓** | have | ✓ | Device (keep — strong) | P0/P1 |
| **Send: Pause/Resume/Cancel** (IPC wired, no buttons) | partial | ✗ | **Device buttons (P0)** | P0 |
| Send: preheat/set-temp · webcam · job queue · jog/home · console · bed-mesh · SD browser | missing/partial | ~ | Device advanced | P1/P2 |
| **Plate: add/remove/rename ✓** · thumbnails | have/partial | ✓/~ | `PlateTabs` (keep) | P1 |
| **Plate: Slice this/all (split button inert)** | partial | ✗ | **Wire onSlice* handlers (P0/P1)** | P0/P1 |
| Plate: type/surface picker · per-plate override · sequence | missing | ✗ | Process/Plate | P2 |
| **Shell: stage tabs ✓ · ProfileStack ✓ · machine quick-switch ✓** | have | ✓ | keep | P1 |
| Shell: Prepare tool-rail · view-cube · fit-to-plate · bed/350³ box · undo/redo · drag-drop · single Slice CTA | missing/partial | ~ | Prepare chrome (P0 rail/CTA) | P0/P1 |

### 5.4 VCarve / 2.5D (Laguna) — [`catalog/vcarve-laguna.md`](./catalog/vcarve-laguna.md)

| Tool group | Status (range) | Reach | Access (target) | Pri |
|---|---|:--:|---|:--:|
| **Vectors·Create** (line/polyline, rect, circle, ellipse, arc, polygon, spline, slot, point) | partial/stub | ✗ | **Mount sketch → Vectors (FG-3, P0)** | P0/P1 |
| **Vectors: Text (TrueType → vectors)** + text-on-curve | missing | ✗ | **Vectors → Text (P0)** | P0/P1 |
| Vectors: clipart · bitmap-trace | missing | ✗ | Vectors (defer) | P2 |
| **Vectors·Edit** (move, rotate, scale, mirror, trim, split, extend, fillet, chamfer) | partial | ✗ | Vectors (needs FG-3) | P0/P1 |
| **Vectors: Offset** · Boolean/weld · Array · node-editing · join-by-tolerance | missing/partial | ✗ | Vectors (P1) | P0/P1 |
| Layout: align · distribute · group · layers · snapping · constraints | missing/partial | ✗ | Vectors/Layout | P1/P2 |
| Modeling (relief components, sculpt, sweep-relief) | missing | ✗ | defer (use CAD + Send-to-CAM) | P2 |
| **2D Profiling** (contour on/in/out ✓, tabs ✓, leads ✓, ramp ✓, multi-depth ✓, climb/conv ✓) | have | ✓ | **2D Toolpaths (keep)** | P0/P1 |
| 2D Profiling: cutter-comp G41/G42 · corner-overcut/dogbone · start-point | missing | ✗ | 2D Toolpaths / Vectors | P1/P2 |
| **Pocketing** (raster ✓, finish-pass ✓, wall-stock ✓, ramp ✓, per-depth ✓) | have/partial | ✓ | 2D Toolpaths | P0/P1 |
| **Pocketing: islands** · offset/spiral clearing · adaptive/trochoidal · rest | missing/stub | ✗ | 2D Toolpaths (P1) | P0/P1 |
| **V-Carve / prism (`cnc_vcarve`)** — medial-axis variable-depth | **missing** | ✗ | **V-Carve panel (new, P0)** | P0 |
| V-Carve: flat-bottom clearance · engrave (on-line/fill) · inlay · texture | missing/partial | ~ | V-Carve panel | P1/P2 |
| **Drilling** (at points ✓, peck ✓, dwell ✓) · from-circles | have/partial | ✓/~ | 2D Toolpaths | P0/P1 |
| Drilling: bore/helical · thread-mill | missing/stub | ✗ | defer | P2 |
| **Job/Setup** (job size, WCS 10-pt) | partial | ✓ | Setup (keep) | P0 |
| Job: Z-datum top/table toggle | partial | ~ | Setup | P1 |
| **Nesting: true-shape ✓ (BLF) · apply-placements ✓** | partial/have | ✓ | **Nesting (upgrade BLF→NFP, P1)** | P1 |
| Nesting: multi-sheet · grain/common-line · vacuum-zone viz | missing/partial | ✗ | Nesting | P2 |
| Material: 6-zone vacuum ✓(profile) · feeds&speeds | partial | ~ | Setup / Send | P1/P2 |
| **Import: DXF (plumbed, no UI caller)** | stub | ✗ | **Vectors → Import DXF (P0)** | P0 |
| Import: SVG/EPS/PDF · bitmap · **STL ✓** | missing/have | ~ | Vectors / File | P1 |
| **Export: post to .nc ✓** · setup sheet ✓ | have | ✓ | **Send (keep)** | P0/P2 |
| Export: vectors (DXF/SVG) | missing | ✗ | Vectors | P2 |
| **Post (Laguna):** `vcarve_mach3.hbs` ✓ · Mach3/RichAuto ✓ · warm-up/cool-down ✓ · dust M7/M9 ✓ · safe-Z+M30 ✓ · tool#/WCS ✓ · **safety-validate ✓** | have | ✓ | Send (keep) | P0/P1 |
| Post: 6-zone vacuum preamble · ATC multi-tool | partial | ~ | Send | P2 |
| **Shell** (op tree ✓, properties ✓, palette ✓, save/open ✓, tool library ✓) | have | ✓ | keep | P0/P1 |
| Shell: 2D plan view · sketch-tool hotkeys · global undo | partial/stub | ~ | needs FG-3 | P1 |

### 5.5 Carvera 4-axis (Mill-4) — [`catalog/carvera-4axis.md`](./catalog/carvera-4axis.md) *(priority surface)*

| Tool group | Status (range) | Reach | Access (target) | Pri |
|---|---|:--:|---|:--:|
| **Shell** (workspace switcher ✓, op-tree ✓, palette ✓, E-stop ✓) | have | ✓ | keep | P0 |
| Shell: contextual CAM ribbon · tabbed op-editor dialog · viewcube on sim | partial | ~ | Mill-4 ribbon (FG-4) | P1/P2 |
| **Setup** (new ✓, rotary stock Ø+len ✓, chuck depth/clamp ✓, WCS 10-pt ✓, G54–59 ✓, pre-job checklist ✓) | have | ✓ | **Setup (keep)** | P0/P1 |
| **Setup: part-orientation gizmo → `placement`** (engine plumbed, no UI) | stub | ✗ | **Setup (P0 — #1)** | P0 |
| **Setup: tailstock geometry + collision** (schema exists, not wired) | stub | ✗ | Setup → engine → sim (P1 — #3) | P1 |
| **Setup: multi-setup / A+180 wizard** (built, unmounted) | stub | ✗ | Setup entry point (P1 — #2) | P1 |
| Setup: headstock-X-offset surface · op-type (mill/turn/rotary) · cylinder auto-fit | partial | ~ | Setup | P1 |
| Setup: square-bar stock · fixture-collision-geometry | partial/stub | ✗ | Setup | P2 |
| **2D toolpaths** (contour ✓, pocket ✓, drill ✓, chamfer ✓) | have | ✓ | 2D (keep) | P0/P1 |
| 2D: face · bore | missing/partial | ~ | 2D (new) | P2 |
| **2D: "wrap onto rotary" modifier** (only contour wraps) | partial | ✗ | **2D + Rotary (P1 — #4)** | P1 |
| **3D toolpaths** (adaptive/3D-rough ✓, parallel ✓, waterline ✓) | have | ✓ | 3D (keep) | P0/P1 |
| 3D: scallop · pencil · spiral/morph · steep-shallow · trochoidal · rest | partial | ~(Python) | 3D | P1/P2 |
| 3D: double-sided machining | stub | ✗ | (mount multi-setup wizard, #2) | P1 |
| **Rotary: roughing ✓ · finishing ✓ · indexed ✓ · pattern-fallback ✓** | have | ✓ | **Rotary (keep)** | P0 |
| **Rotary: continuous** (honestly sequential) | partial | ✓ | Rotary (label-honest) | P1 |
| **Rotary: true simultaneous 4-axis** (post ready, no engine) | missing | ✗ | **Rotary (P1 — #5)** | P1 |
| **Rotary: axis-substitution wrap (arbitrary ops)** | partial | ✗ | **Rotary (P1 — #4)** | P1 |
| **Rotary: engrave-text** | missing | ✗ | **Rotary (P1 — #6)** | P1 |
| Rotary: wrap-image/relief · spiral/helical wrap · square-bar section | missing/stub | ✗ | Rotary (P2 — #8) | P2 |
| Rotary: adaptive-angular ✓ · mesh-radial-Z ✓ · overcut ✓ (all param-only; surface toggles, #7) | have | ✓(no UI) | Rotary op editor (P2) | P2 |
| Rotary: A-range/unwind · rotation-direction | partial | ~ | Rotary/Send | P2 |
| Multi-axis (5-axis contour/swarf/flow) | partial | ✗ | (not Carvera) | P2 |
| **Probing: A-axis / full-4-axis zero ✓** | have | ✓ | Probing (keep) | P0 |
| **Probing: single-surface/bore/boss/corner/tool-length** (`ProbeCyclePanel` unmounted) | partial/stub | ✗ | **Mount Probing tab (P1 — #2)** | P1 |
| Probing: auto-leveling/surface-map import · inspect report | partial/missing | ~ | Probing | P2 |
| **Tooling** (library ✓, material presets ✓, 4-axis no-M6 handling ✓) | have | ✓ | Tool library (keep) | P0/P1 |
| Tooling: Carvera ATC table (read-only, 4-axis blocked banner) · wear · holder-collision | partial/missing | ~ | Tools / sim | P1/P2 |
| **Sim: 3D toolpath ✓ · rotary cylindrical removal ✓ · chuck-collision overlay ✓ · playback ✓ · envelope ✓** | have | ✓ | **Simulate (keep — strong)** | P0/P1 |
| **Sim: tailstock/fixture collision** | stub | ✗ | Simulate (P1 — #3) | P1 |
| Sim: gouge/rest-stock diff · cycle-time honoring A-feed | partial | ~ | Simulate | P2 |
| **Post/Send: Carvera 4-axis post ✓ · 3-axis post ✓ · inverse-time-G93 ✓ · sim-warn block ✓ · probing-block ✓ · upload-to-Carvera ✓ · safety-guardrails ✓** | have | ✓ | **Send (keep — strong)** | P0/P1 |
| Post/Send: foreign-dialect fallback · setup-sheet (+rotary fields) · post-options dialog | partial | ~ | Send | P1/P2 |
| **Geom inputs** (import STL/STEP ✓, derive contour ✓, derive drill ✓) | have | ✓ | Setup/2D (keep) | P0/P1 |
| Geom: face/edge selection → op geometry · sketch-on-cylinder | partial/missing | ✗ | (needs FG-2/FG-5) | P2 |

---

## 6. Wave sequencing (how this catalog feeds the program)

| Wave | Theme | Delivers | Unlocks |
|---|---|---|---|
| **Wave 0** *(this)* | Tool catalog + gap audit | This master + 5 per-env matrices; ribbon taxonomy; foundation-gap list; Carvera priority order | The build plan |
| **Wave 1** | Context Engine + shell de-dupe | FG-1 (registry + `useCommandContext`), FG-4 (ribbon + single palette), FG-7 (status/title binding); mount `CommandCatalogPanel` | Every ribbon button can dispatch; palette covers all 152 commands |
| **Wave 2** | CAD foundation | FG-2 (mount `Viewport3D`, delete decorative chrome), FG-3 (mount sketcher), FG-5 (per-feature dialogs + face/edge selection), FG-6 (de-dupe Part/Assembly/Drawing) | Flips the majority of CAD `stub`-unreachable rows (5.2 §Sketch/Solid/Construct/Inspect) and the Laguna **Vectors** ribbon to `have`/`partial` |
| **Wave 3+** | Per-machine tool build | Carvera priority list (Section 4) on the Mill-4 ribbon; FDM plate-edit loop (transform/arrange/orient/supports/3D-preview/job-controls); Laguna `cnc_vcarve` + Text + DXF-import + NFP nesting | Production parity per machine |

**Bottom line:** the program is access-layer-bound, not capability-bound. Wave 1 + Wave 2 (the FG-1…FG-7 foundation) convert the largest block of already-built-but-unreachable code into usable tools; Carvera (Section 4) is the highest-readiness machine and should lead the per-machine build in Wave 3.
