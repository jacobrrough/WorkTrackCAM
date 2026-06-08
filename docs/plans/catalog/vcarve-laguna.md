# VCarve / 2.5D (Laguna Swift 5×10) — Tool Catalog & Codebase Gap Audit

**Environment:** VCarve Pro (`vcarve_pro`) → Laguna Swift 5×10 CNC router (3-axis, RichAuto A-series / Mach3 dialect, 1524 × 3048 mm bed, 6-zone vacuum).
**Reference apps cataloged:** Vectric **VCarve Pro** + **Aspire**, **Carveco** (Maker/Maker+/Carveco).
**Date:** 2026-06-08 · **Scope:** read-only audit; this file is the only artifact written.

This matrix enumerates the meaningful tools/buttons/commands the reference apps expose for a 2D/2.5D sign-and-cabinet wood-routing workflow, grouped by the natural Vectric/Carveco ribbon panels (Drawing/Vectors · Modeling (relief) · Toolpaths · Job/Nesting · Layout · Preview/Simulation · Shell). For each we record our status (`have` = implemented + reachable in the live shell, `partial` = works but limited, `stub` = declared/UI-present but non-functional or geometry-only, `missing` = absent), where it is reachable today, an access recommendation, and a priority.

**Key architecture facts that shape this audit**
- The live shell is `src/renderer/app/` (WorkTrack3DApp). The CAD-first **Design** workspace (`DesignWorkspace.tsx`) currently renders only Part / Assembly / Drawing views — **the rich 2D vector editor `Sketch2DCanvas.tsx` is NOT mounted anywhere in the live shell** (only referenced by its own helpers + `__tests__/MvpSketchCanvas.test.tsx`). So almost all *vector authoring* is "stub/unreachable" from the running app even though the drawing primitives exist as code.
- 2.5D **toolpath generation** is real and reachable: `src/main/cam-local.ts` (contour/pocket/chamfer/drill) → `src/main/cam-runner-2d.ts` → `resources/posts/vcarve_mach3.hbs`, driven from `ManufactureWorkspace.tsx` (hosted live by `src/renderer/app/ManufactureHost.tsx`). The VCarve Pro env exposes exactly four op kinds: `cnc_pocket`, `cnc_contour`, `cnc_drill`, `cnc_chamfer` (`src/renderer/src/environments/registry.ts:53`).
- The geometry feeding those toolpaths is derived from sketch entities via `src/shared/cam-2d-derive.ts` (`deriveContourPointsFromDesign` / `deriveDrillPointsFromDesign`) — but the only authoring surface that *produces* those entities (`Sketch2DCanvas`) is unreachable, so in practice contour/drill geometry must arrive via JSON paste or a CAD-derived STL.
- **There is no true V-carve / prismatic toolpath** despite the env being named "VCarve Pro." `cnc_chamfer` (`generateChamfer2dLines`, cam-local.ts:1121) does a single-offset bevel along one contour at a fixed depth — it does NOT do medial-axis / variable-depth carving between an inner+outer vector pair. The "Sign / lettering V-carve" My-Shop preset (`my-shop-presets.ts:107`) maps to `cnc_chamfer`, confirming the gap.
- DXF import exists at the IPC layer (`dxf:import` in `src/main/ipc-fabrication.ts:1076`, parser `src/shared/dxf-parser.ts`) and is typed on the bridge (`fab().dxfImport`, shop-types.ts:190) but **no live UI calls it** → unreachable.
- True-shape **nesting** is wired live for Laguna only (`LagunaNestingPanel.tsx`, mounted at `ManufactureWorkspace.tsx:1672`) but the engine (`src/main/nesting/true-shape-v1.ts`) is **bounding-box BLF**, not polygon-NFP.

---

## Vectors — Create (Drawing tab)

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Vectors·Create | Draw Line / Polyline | Continuous line+arc polyline with tangent/length/angle typed entry | `stub` | `Sketch2DCanvas` `line`/`polyline` tools exist (Sketch2DCanvas.tsx:770,862) but canvas unmounted in live shell | Mount a 2D sketch surface in Design "Sketch" stage (ViewportChrome already has the stage tab) | P0 |
| Vectors·Create | Draw Rectangle (+ corner radius) | Rect by drag or W×H typed; optional fillet/chamfer corners | `partial` | `Sketch2DCanvas` `rect` + numeric popover (Sketch2DCanvas.tsx:866,1173); no corner-radius option | Same sketch surface; add corner-radius field | P0 |
| Vectors·Create | Draw Circle (center+radius / 2pt / 3pt) | Circle by radius, diameter, or 3 points | `partial` | `circle`, `circle_2pt`, `circle_3pt` (Sketch2DCanvas.tsx:870,783,791) | Sketch surface | P0 |
| Vectors·Create | Draw Ellipse | Center + 2 axes ellipse | `partial` | `ellipse` tool (Sketch2DCanvas.tsx:815) | Sketch surface | P1 |
| Vectors·Create | Draw Arc (3-tangent / center) | Arc by 3 points, center, or tangent | `partial` | `arc`, `arc_center` (Sketch2DCanvas.tsx:874,882) | Sketch surface | P1 |
| Vectors·Create | Draw Polygon / Star | N-sided regular polygon and star | `partial` | `polygon` tool with side count (Sketch2DCanvas.tsx:735); **no star** | Sketch surface; add star variant | P1 |
| Vectors·Create | Draw Curve / Bézier spline | Fit-point + control-point splines, editable nodes | `partial` | `spline_fit`, `spline_cp` (Sketch2DCanvas.tsx:828,832) | Sketch surface; add node-edit handles | P1 |
| Vectors·Create | Slot / Dogbone | Rounded slot (center-to-center or overall) | `partial` (slot) / `missing` (dogbone) | `slot_center`, `slot_overall` (Sketch2DCanvas.tsx:744,757); no dogbone/T-bone for inside corners | Sketch surface; add dogbone fillet for pocketing relief | P1 |
| Vectors·Create | Draw Point / Polyline point array | Construction points; bolt-circle point arrays | `partial` | `point` tool (Sketch2DCanvas.tsx:725); no bolt-circle generator | Sketch surface; bolt-circle macro | P2 |
| Vectors·Create | Dimensions (drawing) | Linear/angular/radial dimension annotations | `partial` | DrawingView dimensions exist for the *Drawing* view (DesignWorkspace drawing tab) but not on the 2D sketch | Reuse DrawingView dimension engine on sketch | P2 |

## Vectors — Transform & Edit (Drawing tab)

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Vectors·Edit | Move / Set Position | Translate by delta or to absolute XY | `partial` | `move_sk` (Sketch2DCanvas.tsx:837) | Sketch surface | P0 |
| Vectors·Edit | Rotate | Rotate about anchor by angle | `partial` | `rotate_sk` + degree field (Sketch2DCanvas.tsx:843) | Sketch surface | P1 |
| Vectors·Edit | Scale / Set Size | Uniform/non-uniform scale; set exact size | `partial` | `scale_sk` factor (Sketch2DCanvas.tsx:849); uniform only | Sketch surface; add non-uniform + set-size | P1 |
| Vectors·Edit | Mirror | Mirror about axis, keep or copy | `partial` | `mirror_sk` (Sketch2DCanvas.tsx:855) | Sketch surface | P1 |
| Vectors·Edit | Array / Copy (grid, circular) | Rectangular + circular copy arrays | `missing` | none | Sketch surface "Array" tool | P1 |
| Vectors·Edit | Trim / Scissors | Trim vector to nearest intersections | `partial` | `trim` tool (Sketch2DCanvas.tsx:693) | Sketch surface | P1 |
| Vectors·Edit | Split / Break (at point) | Break a vector at a clicked node | `partial` | `split`, `break` (Sketch2DCanvas.tsx:702,709) | Sketch surface | P2 |
| Vectors·Edit | Extend | Extend vector to a boundary | `partial` | `extend` (Sketch2DCanvas.tsx:716) | Sketch surface | P2 |
| Vectors·Edit | Fillet / Round corners | Radius corner between two vectors | `partial` | `fillet` with radius (Sketch2DCanvas.tsx:675) | Sketch surface | P1 |
| Vectors·Edit | Chamfer corners | Bevel corner between two vectors | `partial` | `chamfer` with leg length (Sketch2DCanvas.tsx:684) | Sketch surface | P2 |
| Vectors·Edit | Node editing (insert/delete/smooth) | Drag/insert/delete/cusp-smooth nodes; convert line↔arc | `missing` | none (entities are immutable after creation) | Sketch surface node-edit mode | P1 |
| Vectors·Edit | Join / Close open vectors | Join near endpoints; close to make machinable loop | `partial` | polyline "Close loop" (Sketch2DCanvas.tsx:967); no general join-by-tolerance | Sketch surface "Join vectors" + tolerance | P0 |
| Vectors·Edit | Offset (inset/outset) | Offset vector inward/outward by distance | `missing` | none (CAM offsets internally, but no standalone vector offset) | Sketch surface "Offset" tool | P1 |
| Vectors·Edit | Weld / Boolean (union/subtract/intersect) | Boolean combine of closed vectors | `missing` | none | Sketch surface vector-boolean | P1 |
| Vectors·Edit | Fit vectors to bitmap / vectorize (trace) | Auto-trace a raster image to vectors | `missing` | none | Bitmap-trace import dialog | P2 |
| Vectors·Edit | Measure tool | Distance/angle/area inspector | `partial` | `MeasurementTool` exists for 3D (design/MeasurementTool.tsx); not on 2D sketch | Reuse on sketch surface | P2 |

## Vectors — Text & Clipart (Drawing tab)

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Text/Clipart | Create Text (TrueType) | Font-rendered text as machinable vectors | `missing` | none | "Text" tool emitting closed vectors from a font | P0 |
| Text/Clipart | Text on a Curve / Arc | Wrap text along a guide vector | `missing` | none | Text-on-path option | P1 |
| Text/Clipart | Text in a box / auto-fit | Bound + wrap text to a rectangle | `missing` | none | Text-box layout | P2 |
| Text/Clipart | Clipart / vector art library | Drag-drop royalty-free vector art | `missing` | none | Bundled clipart palette | P2 |
| Text/Clipart | Import bitmap / set as relief source | Place raster image for tracing or relief | `missing` | none | Image import (also feeds relief, see Modeling) | P2 |

## Modeling (Relief / 2.5D component shapes — Aspire / Carveco)

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Modeling | Create component from vector (flat/round/ramp) | Build a height-relief "component" from a closed vector | `missing` | none (we have parametric B-rep via CadQuery, not a relief modeler) | Out of 2.5D scope; defer — STL path covers true 3D | P2 |
| Modeling | Sculpt / smooth / blend relief | Brush-sculpt the composite relief | `missing` | none | Defer | P2 |
| Modeling | Two-rail sweep / extrude / spin (relief) | Generate relief by sweep/extrude/spin profiles | `missing` | none (CadQuery covers true solids) | Defer (use CAD workspace + Send to CAM) | P2 |
| Modeling | Component tree / combine modes (add/merge/low) | Layer & combine relief components | `missing` | none | Defer | P2 |
| Modeling | Texture / weave / fluting toolpath source | Decorative relief textures | `missing` | none | Defer | P2 |

## Toolpaths — 2D / 2.5D Profiling

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Toolpaths·2D | Profile / Contour (on/inside/outside) | Cut on, inside, or outside a vector with tool comp | `have` | `cnc_contour` → `generateContour2dLines` (cam-local.ts:847); ManufactureWorkspace op list. Side via `contourSide` climb/conventional | Manufacture → Toolpaths stage; promote to a "2D" ribbon group | P0 |
| Toolpaths·2D | Tabs / bridges (auto + manual) | Hold-down tabs spaced by count or interval | `have` | `tabParams` count/interval (cam-local.ts:1149; injected at :1196) | Manufacture op params; add interactive tab placement on canvas | P0 |
| Toolpaths·2D | Lead-in / lead-out (line & arc) | Tangential lead moves to hide entry marks | `have` | `leadInMode`/`leadOutMode` linear/arc (cam-local.ts:872,958) | Manufacture op params | P1 |
| Toolpaths·2D | Ramp entry (linear / helix / plunge) | Gentle Z entry to protect cutter | `have` | `rampType` plunge/linear/helix (cam-local.ts:773,877) | Manufacture op params | P1 |
| Toolpaths·2D | Multi-pass depth stepping | Step a profile to depth in passes | `have` | `computeNegativeZDepthPasses` + `zStepMm` (cam-runner-2d.ts:99) | Manufacture op params | P0 |
| Toolpaths·2D | Climb vs conventional toggle | Cut direction control | `have` | `contourSide` (cam-local.ts:860) | Manufacture op params | P1 |
| Toolpaths·2D | Cutter compensation (machine G41/G42) | Emit controller-side comp codes | `missing` | none — comp is computed in path geometry; no G41/G42 emitted | Optional post flag for RichAuto comp | P2 |
| Toolpaths·2D | Corner overcut / dogbone for fit | Relieve inside corners so panels seat | `missing` | none (no dogbone in sketch or path) | Pair with sketch dogbone tool | P1 |
| Toolpaths·2D | Start-point / order control | Pick profile start node + ordering | `missing` | none (start = ring[0], implicit) | Add start-point pick + reorder | P2 |

## Toolpaths — Pocketing & Area Clearance

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Toolpaths·Pocket | Pocket (offset / raster) | Clear a closed area, offset or zig-zag, wall stock | `partial` | `cnc_pocket` → `generatePocket2dLines` (cam-local.ts:977) — **raster zig-zag only**, no spiral/offset clearing | Manufacture op params; add offset-spiral strategy | P0 |
| Toolpaths·Pocket | Final wall finish pass | Separate finishing contour at walls | `have` | `finishPass` + `shouldAppendFinalPocketFinishPass` (cam-runner-2d.ts:142) | Manufacture op params | P1 |
| Toolpaths·Pocket | Wall stock / allowance | Leave radial stock for finish | `have` | `wallStockMm` (cam-local.ts:551; inset via `horizontalSegmentsInsideInsetRing`) | Manufacture op params | P1 |
| Toolpaths·Pocket | Pocket ramp / plunge entry | Ramp into pocket to spare plunge | `have` | `entryMode` plunge/ramp + `rampMaxAngleDeg` (cam-local.ts:986,1010) | Manufacture op params | P1 |
| Toolpaths·Pocket | Per-depth finish | Finish contour at each Z step | `have` | `finishEachDepth` (cam-local.ts:1032) | Manufacture op params | P2 |
| Toolpaths·Pocket | Islands / pocket-with-holes | Respect interior islands inside the pocket | `missing` | none — single outer ring only (`ringBounds`/even-odd on one ring) | Multi-ring pocket (outer + island vectors) | P1 |
| Toolpaths·Pocket | Adaptive / trochoidal clearing (HSM) | Constant-engagement high-feed clearing | `stub` | `cnc_adaptive`/`cnc_trochoidal_hsm` exist in schema but **not in VCARVE_PRO_OPS** and route to OCL/Python or parallel fallback | Add to Laguna op set once an offset/HSM 2D engine lands | P1 |
| Toolpaths·Pocket | Rest machining (2nd tool) | Clear only what a bigger tool left | `missing` | none for 2D (3D rest exists via raster rest stock only) | 2D rest-area from prior tool | P2 |

## Toolpaths — V-Carving / Engraving / Prism (the headline gap)

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Toolpaths·VCarve | **V-Carve / V-Bit carving** | Variable-depth medial-axis carve between inner+outer vectors (true sign lettering) | **`missing`** | none — `cnc_chamfer` is a single-offset bevel at fixed depth, not a medial-axis carve | **New `cnc_vcarve` op: medial-axis solver + V-bit depth-from-width** | **P0** |
| Toolpaths·VCarve | Flat-bottom / prism carving (with clearance tool) | V-carve walls + flat floor cleared by an endmill | `missing` | none | Pair vcarve with a flat clearance pass | P1 |
| Toolpaths·VCarve | Bevel / chamfer edge | Constant-angle bevel along a vector | `partial` | `cnc_chamfer` → `generateChamfer2dLines` (cam-local.ts:1121) — single offset, fixed depth/angle | Keep as chamfer; rename to avoid implying V-carve | P1 |
| Toolpaths·VCarve | Engrave (on-line / fill) | Center-line engrave or area-fill with V/engraving bit | `missing` | none (closest is `cnc_contour` at depth) | New engrave op (on-line + hatch fill) | P1 |
| Toolpaths·VCarve | Inlay (male/female with glue gap) | Paired vcarve pocket + plug with fit allowance | `missing` | none | Inlay wizard atop vcarve | P2 |
| Toolpaths·VCarve | Texture / fluting toolpath | Decorative grooves/flutes along curves | `missing` | none | Defer (relief-dependent) | P2 |

## Toolpaths — Drilling

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Toolpaths·Drill | Drill at points | Peck/standard canned drill cycles at vector points | `have` | `cnc_drill` → `generateDrill2dLines` (cam-local.ts:1061); G81/G82/G83/G73/expanded | Manufacture op; reachable | P0 |
| Toolpaths·Drill | Peck / chip-break | G83 / G73 peck cycles | `have` | `peckMm` + cycleMode g73/g83 (cam-local.ts:1077) | Manufacture op params | P1 |
| Toolpaths·Drill | Dwell at bottom | G82 dwell | `have` | `dwellMs` + g82 (cam-local.ts:1085) | Manufacture op params | P2 |
| Toolpaths·Drill | Drill points from circles/holes | Auto-pick drill targets from closed circles | `partial` | `deriveDrillPointsFromDesign` maps circles→points (cam-2d-derive.ts:116) but only reachable via "Derive" in op list when a sketch exists (and sketch authoring is unreachable) | Wire once sketch surface is live; also derive from DXF circles | P1 |
| Toolpaths·Drill | Bore / helical hole (interpolate) | Helical-mill a hole larger than the tool | `missing` | none (helix exists only as a contour ramp entry) | New bore op (helical) | P2 |
| Toolpaths·Drill | Thread mill | Helical thread cut | `stub` | `cnc_thread_mill` in schema (manufacture-schema.ts:254) but no generator + not in Laguna op set | Defer for wood router | P2 |

## Job / Nesting / Material

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Job | Set Job Size / material thickness / XY datum | Define stock W×H×T and origin corner | `partial` | Setup `stock` (box) + `wcsOriginPoint` 10-pt (manufacture-schema.ts:76,100) via `ManufactureSetupList`/`WcsOriginPicker` | Manufacture Setup stage; add an explicit "Job Setup" sheet | P0 |
| Job | Z-zero (top of material / table) | Choose Z datum reference | `partial` | `wcsNote`/origin point cover intent; no explicit top-vs-table toggle | Add Z-datum toggle to setup | P1 |
| Job | Modeling resolution / units | Job units + relief grid resolution | `partial` | Units come from machine dialect (G21); no relief grid | Units already mm-locked; fine for now | P2 |
| Nesting | True-shape nesting on sheet | Polygon NFP nest of many parts, rotations, utilization | `partial` | `LagunaNestingPanel` (mounted ManufactureWorkspace.tsx:1672) → `nesting:nestPolygons` → `true-shape-v1.ts` — **bounding-box BLF, not polygon NFP**; rotations 0/90 only | Keep panel; upgrade engine to polygon NFP (v2 noted in source) | P1 |
| Nesting | Apply nest layout back to parts | Write placements back onto cut ops | `have` | `applyNestingPlacements` writes `placement*` params (ManufactureWorkspace.tsx:1039) | Reachable on Laguna | P1 |
| Nesting | Multi-sheet nesting | Overflow parts onto additional sheets | `missing` | none (single sheet; unplaced reported) | Multi-sheet output | P2 |
| Nesting | Common-line / grain direction constraints | Share cut lines; lock rotation for grain | `missing` | none | v2 nesting constraints | P2 |
| Material | 6-zone vacuum table awareness | Map part placement to vacuum zones | `partial` | `vacuumZoneCount: 6` in profile + `laguna-vacuum-postlude.ts`; not visualized in nesting | Show zones in nest preview | P2 |
| Material | Sheet/stock library + cost | Saved stock sizes, sheet cost/utilization | `missing` | none | Stock-library quick-pick | P2 |
| Material | Feeds & speeds by material | Auto feed/RPM from material+tool | `partial` | `FeedsCalcModal` + `material-reference-data.ts`; reachable in retired ShopApp LeftPanel, not clearly in new shell op editor | Surface F&S in Manufacture op editor | P1 |

## Import / Export / Interop

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Import | Import DXF (vectors) | Bring in 2D CAD vectors, layer mapping | `stub` | IPC `dxf:import` (ipc-fabrication.ts:1076) + parser (dxf-parser.ts) typed on `fab().dxfImport`, **no live UI caller** → unreachable | Add "Import Vectors (DXF)" in Design/Manufacture that lands entities into the sketch | P0 |
| Import | Import SVG / EPS / PDF / AI | Bring in vector art | `missing` | none | SVG importer next after DXF | P1 |
| Import | Import bitmap (PNG/JPG) | Place raster for trace/relief | `missing` | none | Image import | P2 |
| Import | Import STL / model for machining | 3D model → toolpaths | `have` | mesh-import registry (STL/STEP/IGES/OBJ/3MF) + CAD "Send to CAM" (DesignWorkspace.tsx:638) | Reachable | P1 |
| Export | Save toolpaths (post to G-code/.nc) | Post all/selected toolpaths to controller file | `have` | `cam:run` → `renderPost` → `vcarve_mach3.hbs`; writes `output/cam.nc` | Manufacture Send stage | P0 |
| Export | Export vectors (DXF/SVG/EPS) | Round-trip vectors out | `missing` | none (Drawing view exports PDF/SVG of *drawings*, not 2D sketch vectors) | Vector export | P2 |
| Export | Setup sheet / job report | Printable op list, tools, times | `have` | `setup-sheet.ts` (+ pin tests); ProfileStack SetupSheetRow | Manufacture device panel | P2 |

## Layout / Alignment helpers (Drawing tab)

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Layout | Align objects (edges/centers) | Align selected vectors to each other / job | `missing` | none | Align toolbar on sketch surface | P1 |
| Layout | Distribute / space evenly | Even spacing of selected vectors | `missing` | none | Distribute toolbar | P2 |
| Layout | Snapping (grid / object / guides) | Snap to grid, endpoints, intersections, guide lines | `partial` | grid snap in sketch (`snap`, Sketch2DCanvas.tsx) + vertex/edge constraint picks; no guide lines/object-snap menu | Snap settings on sketch surface | P1 |
| Layout | Group / Ungroup | Group vectors for batch transform | `missing` | none (transform supports multi-vertex selection only) | Group concept on sketch | P2 |
| Layout | Layers panel | Organize/show/hide/lock by layer | `missing` | none (DXF parser reads layers but nowhere to view them) | Layer panel tied to DXF import | P2 |
| Layout | Constraints / dimensions (parametric) | Coincident/parallel/equal + driving dims | `partial` | sketch solver `solver2d.ts` + constraint picks (Sketch2DCanvas.tsx:639) + DOF badge; unreachable in live shell | Expose once sketch surface mounts | P1 |

## Preview / Simulation

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Preview | Toolpath preview (3D paths) | Render computed toolpaths over the job | `partial` | `ManufactureCamSimulationPanel` + `cam-gcode-toolpath` segment extraction; Manufacture Simulate stage | Manufacture Simulate stage | P1 |
| Preview | Material simulation (rendered cut) | Photoreal rendered removal on stock | `partial` | In-process stock model (Stack A; `StockSimulationOverlay`/`StockSimulationToggle`) — coarse, not photoreal | Manufacture Simulate stage | P2 |
| Preview | Estimated machining time | Per-toolpath + total time estimate | `partial` | time fields in setup sheet / ProfileStack; not a live cut-time simulator | Add cycle-time estimate to op list | P2 |
| Preview | Solid/transparent stock toggle | Toggle stock visibility in sim | `have` | `StockSimulationToggle.tsx` | Manufacture Simulate stage | P2 |
| Preview | Gouge / collision check | Warn on holder/gouge collisions | `partial` | `fixture:checkCollision` (ipc-fabrication.ts:1101) for fixtures; no holder-gouge on path | Extend collision to tool/holder | P2 |

## Post-processor / Machine (Laguna Swift 5×10 specifics)

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Post | Select post-processor | Pick controller dialect | `have` | `postTemplate: vcarve_mach3.hbs` + `dialect: mach3` (laguna-swift-5x10.json) pinned by superset test | Library → Posts | P0 |
| Post | Mach3 / RichAuto A-series dialect | `%` tape markers, G21/G90/G17, G0-3, M3/M5, M30 | `have` | `vcarve_mach3.hbs` (RichAuto = Mach3 superset, documented in template header) | n/a | P0 |
| Post | Spindle warm-up / cool-down | Dwell after M3; ramp before retract | `have` | `vcarve_mach3.hbs` G4 P2 after M3, M5+G4 P3 before retract | n/a | P1 |
| Post | Dust collection M-codes | M7/M9 gated on flag | `have` | `dustCollection` flag → M7/M9 (vcarve_mach3.hbs:59,71) | Manufacture post options | P1 |
| Post | 6-zone vacuum hold preamble | Vacuum-on macro per zone | `partial` | `laguna-vacuum-postlude.ts` exists; per-zone selection not surfaced | Vacuum-zone picker → post preamble | P2 |
| Post | Safe Z retracts + program end | Clearance retract; M30 end | `have` | pre-cut safe-Z lift + end-program invariants (post tests) | n/a | P0 |
| Post | Tool change / ATC | Multi-tool program with tool changes | `partial` | single-tool by default (template note); `ToolChangeTimeline` shows changes but Laguna post is single-tool | Multi-tool post if ATC wired | P2 |
| Post | Tool-number / work-offset output | Tn + G54–G59 selection | `have` | `toolNumber` + `workCoordinateIndex`→`wcsLine` in post | Manufacture setup | P1 |
| Post | G-code safety validation | Verify envelope/feeds/retracts before run | `have` | `gcode-safety` skill + post-process invariants test-suite | Runs on post change | P0 |

## Shell / UX mechanics

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Shell | Ribbon / tabbed command bar | Drawing · Modeling · Toolpaths tabs | `partial` | New shell has `WorkspaceNav` (Design/Assemble/Manufacture/Drawings/Workshop/Utilities) + Manufacture `WorkflowStageTabs`; no Vectric-style per-tool ribbon groups | Add 2D/2.5D ribbon groups under Manufacture | P1 |
| Shell | Toolpath list / tree with on/off | List, reorder, toggle, recalc toolpaths | `have` | `ManufactureOperationList` (setup-rooted tree, status icons, reorder, suppress) | Manufacture Toolpaths stage | P0 |
| Shell | 2D drawing canvas with rulers/grid | Pan/zoom 2D view with grid + rulers | `stub` | `Sketch2DCanvas` has grid+pan+zoom but is unmounted in live shell | Mount sketch surface (see P0 items) | P0 |
| Shell | Viewport nav (pan/zoom/2D↔3D) | 2D plan + 3D preview toggle | `partial` | 3D `Viewport3D` + ViewCube/triad in Design; 2D plan view not live | Wire 2D plan view | P1 |
| Shell | Command palette / search | Quick command search | `have` | `NewShellCommandPalette` + command-palette-search (Ctrl+K) | Ctrl+K | P2 |
| Shell | Keyboard shortcuts | Tool hotkeys | `partial` | `app-keyboard-shortcuts.ts` (1–6 nav, Ctrl+K, F1, Ctrl+Shift+D); no per-sketch-tool hotkeys | Add sketch tool hotkeys when surface mounts | P2 |
| Shell | Properties / parameter panel | Edit selected object/toolpath params | `have` | `PropertyPanel` + Manufacture op param editors + DesignWorkspace Properties | Reachable | P1 |
| Shell | Undo / Redo | History for vectors + toolpaths | `partial` | sketch reducer supports edits; no global undo across Manufacture ops | Global undo stack | P1 |
| Shell | Tool library / database | Saved tools with geometry + feeds | `have` | `tool-schema.ts` + Library → Tools + `tools-import.ts` | Library | P1 |
| Shell | Job/project save-open | Persist job + toolpaths | `have` | project-schema (designModels + manufacture plates), `manufacture:save` | File → Open/Save | P0 |

---

## Top gaps (highest impact for the VCarve/Laguna workflow)

- **No true V-carve / prism toolpath (P0).** The flagship feature of the named "VCarve Pro" environment is absent. `cnc_chamfer` is a single-offset bevel, not a medial-axis variable-depth carve. A real `cnc_vcarve` op (medial-axis between inner+outer vectors, depth-from-half-width for a known V-bit angle, optional flat-bottom clearance pass) is the single biggest gap. Evidence: `cam-local.ts:1121`, preset maps V-carve→chamfer at `my-shop-presets.ts:107`.
- **Vector authoring is unreachable from the live shell (P0).** `Sketch2DCanvas.tsx` implements lines/rect/circle/ellipse/arc/polygon/slot/spline/trim/extend/fillet/chamfer/transform/constraints — but it is mounted nowhere in `src/renderer/app/`. The Design "Sketch" stage tab exists in `ViewportChrome` yet the viewport body only renders a build summary (DesignWorkspace.tsx:1027). Until this surface is mounted, nearly the entire Vectors ribbon is "stub."
- **No Text / TrueType-font tool and no clipart (P0/P1).** Sign work is impossible without machinable text vectors. Nothing in the codebase renders fonts to vectors.
- **DXF import is plumbed but unreachable (P0).** `dxf:import` IPC + ASCII parser exist and convert to mm, but no UI calls `fab().dxfImport`, and parsed entities have no landing surface (no sketch mount). Wiring "Import Vectors (DXF) → sketch" unlocks the most common real-world Laguna input path.
- **Pocketing is raster-only with no islands or offset/HSM clearing (P0/P1).** `generatePocket2dLines` is a single-ring zig-zag; no interior islands, no spiral/offset clearance, and the adaptive/trochoidal kinds (`cnc_adaptive`, `cnc_trochoidal_hsm`) are not in the Laguna op set and lack a 2D engine.
- **Nesting is bounding-box BLF, not polygon NFP, single-sheet (P1).** `true-shape-v1.ts` over-reserves area on non-rectangular parts and rotates only 0/90; multi-sheet overflow and grain/common-line constraints are missing. The UI panel and apply-placement path are solid — only the engine needs upgrading.
- **No vector Offset / Boolean / Array / Align / node-editing (P1).** Core CAD-prep editing operations VCarve users rely on daily are absent (offset is computed only inside CAM, never exposed as a standalone vector op), and existing transforms can't array or boolean.
- **No relief/2.5D component modeler (P2, intentionally deferred).** Aspire/Carveco's sculpted-relief workflow is out of scope for a router that should lean on the CadQuery CAD workspace + STL "Send to CAM" for genuine 3D; flagged for completeness, not prioritized.
