# Tool Catalog & Gap Audit — Makera Carvera + 4th-Axis Rotary (Desktop 4-axis CNC)

**Environment:** Makera Carvera (3-axis work area 360×240×140 mm) + Harmonic-Drive 4th-axis rotary (≤92 mm Ø × 240 mm). PRIORITY environment — go deepest here.
**Reference apps catalogued:** Fusion 360 Manufacture (3-axis Milling + Multi-Axis/Rotary), Mastercam Mill (2D/3D + 4-axis rotary/axis-substitution), Makera Carvera CAM (the OEM "Makera" web/desktop CAM).
**Our code surveyed:** `src/main/cam-axis4/**` (6 strategies + facade + validation + emit + heightmap + rasterize + frame + kinematics + tool-comp), `src/main/cam-runner.ts`, `src/main/cam-operation-policy.ts`, `src/shared/manufacture-schema.ts`, `src/shared/cam-4axis-params.ts`, `src/shared/rotary-collision.ts`, `src/shared/cam-heightfield-cylindrical.ts`, `resources/machines/makera-carvera-4axis.json`, `resources/posts/carvera_4axis*.hbs`, `resources/posts/carvera_3axis.hbs`, `src/renderer/manufacture/**` (ManufactureWorkspace, ManufactureOperationList, CarveraSetupPanel, MakeraFunctionsPanel, ProbeCyclePanel, ManufactureCamSimulationPanel, ManufactureSetupTab, ManufactureAuxPanels), `src/renderer/app/**` (shell).

## How to read "Our status"
- **have** — implemented AND reachable from the live shell (`src/renderer/app/` → Manufacture workspace).
- **partial** — works but limited vs. reference apps (missing options, hard-coded defaults, no preview, or reachable but awkward).
- **stub** — declared (schema/UI/file present) but non-functional, hard-errors, dead-code (unmounted), or fallback-only.
- **missing** — nothing in our codebase.

### Headline reality check (Carvera 4-axis)
WorkTrack3D already has a genuinely strong **rotary toolpath engine**: 6 strategies (`roughing`, `finishing`, `continuous`, `contour`, `indexed`, `pattern` fallback) over a real cylindrical heightmap with tool-radius compensation, adaptive angular refinement, full-wrap segment subdivision, mesh-aware depth bands, and hard pre-gen validation (`meshRadialMax ≤ stockR`, chuck-face X clamp, `yAxisMustBeZero`, A-range). The Carvera-specific post (`carvera_4axis.hbs`) is production-shaped (M2 not M30, `G0 Y0` centering, no M6 ATC, spindle dwell, inverse-time-feed opt-in). The **3D simulation** even wraps the cylindrical material-removal heightfield around the rotation axis and overlays rotary-chuck collisions in red. So the *generators* are well ahead of the *authoring UX*: the gaps are concentrated in **(a) interactive setup/orientation** (no gizmo, no tailstock UI, no "wrap a sketch interactively"), **(b) reachability** (Probing/Multi-setup panels are dead code; A-axis is engine-only), and **(c) classic rotary strategy coverage** (no true simultaneous 4-axis, no axis-substitution of arbitrary 3-axis ops, no rotary engrave-text/wrap-image, no spiral/helical wrap, no 2-rail/multi-axis swarf).

---

## Category: Shell / Ribbon / Navigation mechanics

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Shell | Workspace switcher (Design/Manufacture/etc.) | Fusion: top-left workspace dropdown; Mastercam: function-tabbed ribbon | **have** | `src/renderer/app/WorkspaceNav.tsx` (Design·Assemble·Make·Drawings·Workshop·Utilities), keys 1–6 | keep | P0 |
| Shell | Contextual ribbon that changes per active step/op | Fusion ribbon reflows per workspace; Mastercam contextual tabs | **partial** | Manufacture uses `WorkflowStageTabs` (Setup/Toolpaths/Simulate/Send) + `ManufactureSubTabStrip`, not a true ribbon | Add a CAM ribbon grouping (2D / 3D / Rotary / Multi-Axis / Probing / Inspect) like Fusion's Milling tab | P1 |
| Shell | Command palette / search-bar ("S" in Fusion) | Fusion search box; Mastercam "find command" | **have** | `NewShellCommandPalette.tsx` (Ctrl+K) | keep; index 4-axis ops into it | P2 |
| Shell | Browser / data-panel tree (setups→ops) | Fusion Browser tree; Mastercam Toolpaths Manager + Op tree | **have** | `MakeraFunctionsPanel` (WCS tabs + Models + Tool Paths) and `ManufactureOperationList` (setup-rooted tree) | keep | P0 |
| Shell | Properties / parameters inspector for selected op | Fusion op-edit dialog tabs; Mastercam op params tree | **partial** | inline param rows in `ManufactureOperationList.tsx` (no modal "Geometry/Tool/Passes/Linking" tabs) | Promote 4-axis op editor into a tabbed dialog (Geometry · Tool · Heights · Passes · Linking) | P1 |
| Shell | Navigation cube / view orient | Fusion ViewCube; Mastercam gnomon | **partial** | OrbitControls in `ManufactureCamSimulationPanel` (no cube widget; design viewport differs) | add a viewcube overlay to the CAM sim canvas | P2 |
| Shell | E-stop / machine-status indicator | n/a (CAM apps); Carvera Controller has it | **have** | TopBar E-stop → `window.fab.machine.estop` → `ipc-machine.ts` (Carvera = advisory toast, no remote abort) | keep | P0 |
| Shell | Keyboard-shortcut map / cheat-sheet | Fusion + Mastercam customizable hotkeys | **partial** | `src/shared/app-keyboard-shortcuts.ts` (1–6, F1, Ctrl+K) — no CAM-op shortcuts | add rotary-op shortcuts | P2 |

---

## Category: Setup (Job / Stock / WCS / Rotary fixture)

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Setup | New Setup (machine + WCS + stock) | Fusion Setup dialog; Mastercam Machine Group; Makera "New Job" | **have** | `ManufactureSetupTab.tsx` + `addSetup()` in ManufactureWorkspace | keep | P0 |
| Setup | Operation type = **Milling vs Turning vs Rotary** | Fusion Setup "Operation Type" (Milling/Turning/Cutting); Mastercam Mill/Lathe/Mill-Turn | **partial** | `axisMode: 3axis/4axis/5axis` on setup; no Milling-vs-Turning toggle | add explicit op-type on setup; drives offered strategies | P1 |
| Setup | Cylinder/bar **rotary stock** (Ø + length) | Fusion "Cylinder" stock; Mastercam stock cylinder; Makera rotary stock | **have** | `stockCylinderSchema` (x=length, z=Ø) + `StockMaterialPanel` rotary fields | keep | P0 |
| Setup | Square-bar rotary stock | Fusion box-on-rotary; Mastercam | **partial** | schema `rotaryStockProfile: 'cylinder'|'square'` exists; engine treats stock as cylinder of Ø only | wire square cross-section into heightmap + collision | P2 |
| Setup | **Chuck depth / clamp offset** (machinable X span) | Fusion stock "fixed/exposed length"; Makera chuck zone | **have** | `rotaryChuckDepthMm` + `rotaryClampOffsetMm` (setup fields) → `rotaryMachinableXSpanMm` | keep | P0 |
| Setup | **Tailstock** geometry + collision | Fusion tailstock body in Setup; Mastercam tailstock | **stub** | `rotary-collision.ts` `RotaryFixtureConfig` supports `tailstock`, but `run-cam-for-op.ts` never passes one (only machine-default chuck) | add tailstock fields to setup form + thread into `rotaryFixture` | P1 |
| Setup | **Rotary headstock X offset** (work origin to headstock) | Makera 4-axis: "X offset to rotary headstock" (CLAUDE.md) | **partial** | `rotaryHeadstockXOffsetMm` required on profile + validated; **not surfaced/edited in UI** | expose on setup as read-from-profile + override | P1 |
| Setup | 10-point WCS origin picker (corner/face zero) | Makera 10-point stock origin; Fusion WCS point picker | **have** | `WcsOriginPicker.tsx` (`WCS_ORIGIN_POINTS`) | keep; add rotary-specific "A0 face" hint | P1 |
| Setup | WCS / work-offset selector (G54–G59) | All three apps | **have** | `workCoordinateIndex` 1–6 in `ManufactureSetupTab` + CarveraSetupPanel | keep | P0 |
| Setup | Interactive **part orientation gizmo** for rotary (align model to A axis) | Fusion "Model Orientation" + manipulator; Mastercam transform; Makera align-to-rotary | **stub** | `frame.ts` accepts a `Placement` transform, but `run-cam-for-op.ts` hard-codes `identityTransform` (GAP-PLACEMENT) — no gizmo in shell | add a 3-axis orient gizmo feeding `placement` | **P0** |
| Setup | Stock auto-fit from part bounds | Fusion "from box/cylinder of model" | **partial** | `fromExtents` + `fitStockFromPart` (box only; cylinder auto-fit weak) | add cylinder auto-fit (max radial extent → Ø) | P1 |
| Setup | Fixture/soft-jaw library | Fusion fixture components; Mastercam fixtures | **partial** | `FixturePickerPanel.tsx` (mounted in `ManufactureSetupList`) — note only, not collision geometry | feed fixture bodies into collision sweep | P2 |
| Setup | Multiple WCS / multi-setup wizard (op flip A180 etc.) | Fusion multiple setups; Mastercam | **stub** | `MultiSetupWizard.tsx` exists but is **unmounted dead code** (no importer) | mount it; add "duplicate setup at A+180" | P1 |
| Setup | Pre-job checklist | Makera/operator checklists | **have** | `CarveraSetupPanel` Pre-Job Checklist (`getCarveraPreflightChecklist`, critical-gated) | keep | P1 |

---

## Category: 2D / 2.5D Toolpaths (planar, then optionally wrapped)

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| 2D | Face | Fusion Face; Mastercam Facing | **missing** | — (no dedicated facing op) | add `cnc_face` | P2 |
| 2D | 2D Contour / Profile (climb/conv, lead-in/out, tabs, multi-depth) | Fusion 2D Contour; Mastercam Contour | **have** | `cnc_contour` — `ManufactureOperationList` exposes contourPoints, side, leads, ramp, tabs | keep | P0 |
| 2D | 2D Pocket (step-down, ramp, rest stock, finish pass) | Fusion 2D Pocket; Mastercam Pocket | **have** | `cnc_pocket` editor rows | keep | P0 |
| 2D | Drilling (peck/G73/G81/G82/G83, dwell) | Fusion Drill; Mastercam Drill | **have** | `cnc_drill` + `drillPoints` + cycle selector | keep | P0 |
| 2D | Bore / Circular pocket / Thread mill | Fusion Bore/Thread; Mastercam | **partial** | `cnc_thread_mill` runnable; no dedicated bore/circular | keep thread; add bore | P2 |
| 2D | 2D Chamfer / deburr edge | Fusion 2D Chamfer; Mastercam | **have** | `cnc_chamfer` (V-bit, angle, depth) | keep | P1 |
| 2D | Engrave / Trace (single-line / V-carve) | Fusion Trace/Engrave; Mastercam | **partial** | `cnc_4axis_contour` wraps a profile; flat engrave via `cnc_contour`; no true V-carve depth-by-width | add planar `cnc_engrave`/V-carve | P2 |
| 2D | Slot | Fusion Slot; Mastercam | **missing** | — | low priority for Carvera | P2 |
| 2.5D | Wrap a 2D toolpath onto cylinder ("axis substitution" for 2D) | Fusion "Tool Orientation→rotary"/Mastercam axis-substitution wraps ANY 2D op | **partial** | only `cnc_4axis_contour` wraps a *contour*; arbitrary 2D pocket/drill/engrave cannot be wrapped | add a "wrap onto rotary" toggle on 2D ops | **P1** |

---

## Category: 3D Toolpaths (planar 3-axis; relevant to Carvera 3-axis + double-sided)

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| 3D | Adaptive / pocket clearing (roughing) | Fusion Adaptive; Mastercam Dynamic | **have** (engine-dependent) | `cnc_adaptive` / `cnc_3d_rough` (Python engine → OCL → built-in fallback) | keep | P0 |
| 3D | Parallel finish | Fusion Parallel; Mastercam | **have** | `cnc_parallel` (built-in mesh-bounds) | keep | P0 |
| 3D | Scallop / Constant-stepover | Fusion Scallop; Mastercam | **partial** | `cnc_scallop_finish` (Python-only) | keep | P1 |
| 3D | Contour/Waterline (Z-level) | Fusion Contour; Mastercam Waterline | **have** | `cnc_waterline` | keep | P1 |
| 3D | Pencil / corner cleanup | Fusion Pencil; Mastercam | **partial** | `cnc_pencil` (tighter raster) | keep | P1 |
| 3D | Spiral / Morph / Radial | Fusion Spiral/Morph; Mastercam | **partial** | `cnc_spiral_finish`, `cnc_morphing_finish` (Python-only) | keep | P2 |
| 3D | Steep-and-shallow | Fusion; Mastercam Hybrid | **partial** | `cnc_steep_shallow` (Python-only) | keep | P2 |
| 3D | Trochoidal / HSM slot | Fusion; Mastercam Dynamic | **partial** | `cnc_trochoidal_hsm` (Python-only) | keep | P2 |
| 3D | Rest machining / stock-aware reference | Fusion rest material; Mastercam | **partial** | raster/3d_finish accept `usePriorPostedGcodeRest` + `rasterRestStockMm`; no true IPW stock model | wire in-process stock (Stack A/C) | P1 |
| 3D | Auto strategy selection | (closest: Fusion "Steep/Shallow auto") | **partial** | `cnc_auto_select` (Python-only) | keep | P2 |
| 3D | Double-sided machining (flip + re-zero) | Fusion 2-setup flip; Mastercam | **stub** | only via manual second setup; `MultiSetupWizard` unmounted | mount wizard + flip helper | P1 |

---

## Category: 4-Axis Rotary toolpaths (THE priority surface)

| Category | Tool | What ref apps do | Our status | Reachable from | Evidence | Access recommendation | Priority |
|---|---|---|---|---|---|---|---|
| Rotary | **Rotary roughing** (radial waterline, mesh-aware, tool-comp) | Fusion Multi-Axis rough / "Rotary"; Mastercam rotary roughing | **have** | `cnc_4axis_roughing` op in `ManufactureOperationList` (Z-step, overcut, clamp-X) | `cam-axis4/strategies/roughing.ts`; cylindrical heightmap + `applyToolRadiusCompensation`; mesh-aware depths | keep; expose stepover° in UI (currently auto from stepoverMm) | P0 |
| Rotary | **Rotary finishing** (surface-following, fine A step) | Fusion rotary finish; Mastercam | **have** | `cnc_4axis_finishing` (finish stepover°, finish allowance) | `strategies/finishing.ts` (single deepest depth, `finishStepoverDeg`) | keep | P0 |
| Rotary | **Continuous 4-axis** (rough+finish one program) | Fusion combined; Makera "4-axis 3D relief" | **partial** | `cnc_4axis_continuous` op | `strategies/continuous.ts` — **explicitly NOT true simultaneous**; emits rough+finish in sequence and warns | label honestly in UI; build true sim-4axis (below) | P1 |
| Rotary | **True simultaneous 4-axis** (X/Y/Z + A blended, normal-following) | Fusion Multi-Axis (flow/rotary simultaneous); Mastercam 4-axis simultaneous | **missing** | — (continuous is sequential; no blended-motion generator) | post supports `enableSimultaneous4Axis`/G93 inverse-time but **no engine emits XYZA blended cutting moves** | new simultaneous strategy (G93 inverse-time, A-rate limits) | **P1** |
| Rotary | **Indexed / positional 4-axis** (lock A at angles, 3-axis at each) | Fusion "Tool Orientation" indexed; Mastercam index | **have** | `cnc_4axis_indexed` (index angles comma-sep) | `strategies/indexed.ts` (zigzag X per angle per depth) | keep; let each index run a *real* 3-axis op, not just a face pass | P0→P1 |
| Rotary | **Axis substitution** — wrap ANY 2D/3D op around A | Fusion + Mastercam wrap arbitrary toolpaths | **partial** | only contour wraps (`cnc_4axis_contour`) | `strategies/contour.ts` (Y→A linear map, full-wrap subdivision at 170°) | add "Wrap" modifier usable by pocket/drill/engrave | **P1** |
| Rotary | **Rotary engrave text** (wrap text around cylinder) | Fusion engrave + wrap; Makera rotary engraving | **missing** | — | contour-wrap could host it but no text→toolpath path | text/font → contourPoints → wrap | P1 |
| Rotary | **Wrap image / relief (grayscale → depth)** on cylinder | Makera "cylindrical 3D reliefs"; Vectric rotary | **missing** | — | heightmap engine could be repurposed for height-image | image→cylindrical heightmap op | P2 |
| Rotary | **Spiral / helical wrap** (continuous helix along axis) | Fusion spiral-on-rotary; Mastercam | **missing** | — | engine emits per-angle passes, not a continuous helix | helical strategy (A advances with X) | P2 |
| Rotary | **Rotary parallel (pattern) fallback** (no mesh) | (generic) | **have** | default dispatch when no STL | `strategies/pattern.ts` (zigzag per A) | keep | P2 |
| Rotary | **Adaptive angular refinement** (denser A where curvature high) | Fusion adaptive; Mastercam | **have** | `adaptiveRefinement` flag (param-only, no UI toggle) | `rasterize.ts` `buildAdaptiveAngles`/`computeAngularCurvature` | surface a toggle in op editor | P2 |
| Rotary | **Mesh-radial Z bands** (skip empty waterlines on small parts) | Fusion stock-aware | **have** | `useMeshRadialZBands` (param-only) | `computeDepthsMm` shallow-start in `index.ts` | surface toggle | P2 |
| Rotary | **Cross-section: square bar** rotary | Fusion box-on-A; Mastercam | **stub** | `rotaryStockProfile:'square'` schema only | engine assumes round Ø | implement square heightmap | P2 |
| Rotary | **A-axis range / unwind / soft limits** | Fusion machine A-limits; Mastercam | **partial** | validated against `aAxisRangeDeg` (Carvera = 99999 ≈ continuous) | `validation.ts` A-range check | keep; add unwind/rewind G-code option | P2 |
| Rotary | **C-axis / wrap direction (CW/CCW), rotation sign** | Fusion + Mastercam configurable | **partial** | sign NOT configurable; emit always writes absolute A (audited) | ManufactureAuxPanels comment confirms fixed sign | add direction option if a job needs CCW | P2 |
| Rotary | **Overcut past part edges** | Fusion lead/extend; Mastercam | **have** | `overcutMm` (roughing UI; default = tool Ø) | `strategies/*` extend X by overcut, chuck-clamped ≥0 | keep | P1 |

---

## Category: Multi-Axis (5-axis — Carvera is 4-axis, so mostly out-of-scope/aspirational)

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Multi | 5-axis contour (normal-following) | Fusion Multi-Axis Contour | **partial** | `cnc_5axis_contour` (Python; requires `axisCount:5`) | not Carvera; keep behind 5-axis machines | P2 |
| Multi | 5-axis swarf / flank | Fusion Swarf | **partial** | `cnc_5axis_swarf` | not Carvera | P2 |
| Multi | 5-axis flowline | Fusion Flow | **partial** | `cnc_5axis_flowline` | not Carvera | P2 |
| Multi | Tool-axis control (lead/lean/from-point) | Fusion tool-axis modes | **missing** | — | defer (4-axis only has A) | P2 |

---

## Category: Probing & On-machine measurement

| Category | Tool | What ref apps do | Our status | Reachable from | Evidence | Access recommendation | Priority |
|---|---|---|---|---|---|---|---|
| Probe | Single-surface probe (set WCS axis) | Fusion WCS Probe; Mastercam | **have** | `ProbeCyclePanel` (singleSurface) **but panel is unmounted**; reachable instead via CarveraSetupPanel `z_probe` | `ProbeCyclePanel.tsx` + `probe:generate` IPC + `CarveraSetupPanel` | mount ProbeCyclePanel in a "Probing" stage/tab | **P1** |
| Probe | Bore-center / Boss-center | Fusion probe WCS; Mastercam | **stub** | only in unmounted `ProbeCyclePanel` (boreCenter/bossCenter) | `probing-cycles.ts` types | mount the panel | P1 |
| Probe | Corner find (XY origin) | Fusion; Mastercam | **stub** | unmounted `ProbeCyclePanel` (cornerFind) | same | mount | P1 |
| Probe | Tool-length probe / tool setter | Fusion tool measure; Carvera tool-length probe | **partial** | `ProbeCyclePanel.toolLength` (unmounted) + CarveraSetupPanel `z_probe` (T0 wireless probe) | `carvera-zeroing.ts` | mount + integrate with ATC tool table | P1 |
| Probe | A-axis / 4th-axis zero | Carvera-specific 4-axis zero | **have** | `CarveraSetupPanel` modes: `a_axis_zero`, `full_4axis_setup` (A-zero + Z-probe) | `CarveraSetupPanel.tsx` + `carvera:generateSetup` | keep | P0 |
| Probe | Auto-leveling / surface map | Carvera auto-probing; Makera bed scan | **partial** | Carvera has it natively; we generate setup G-code but no surface-map import | add probe-grid → height map | P2 |
| Probe | Inspect / on-machine verification report | Fusion Inspect; PowerInspect | **missing** | — | defer | P2 |

---

## Category: Tooling / Tool library / ATC

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Tool | Tool library (Ø, flutes, stickout, type, feeds) | Fusion Tool Library; Mastercam Tool Manager | **have** | `ToolLibraryPanel`; per-op `toolId`/`toolDiameterMm` picker | keep | P0 |
| Tool | Material speed/feed presets | Fusion feed/speed; Makera material presets | **have** | `STOCK_MATERIAL_TYPES` + `materialPresets`/`estimateFeedMmMinFromTool` | keep | P1 |
| Tool | **Carvera ATC tool table** (slot↔tool, T0 probe) | Carvera CAM ATC table | **partial** | `ManufactureAuxPanels` Carvera tool table (read-only; 4-axis shows "ATC blocked" banner) | keep; editing still via Tools tab | P1 |
| Tool | 4-axis tool-change handling (no M6, operator pause) | Makera 4-axis behavior | **have** | post emits no M6; banner explains operator-driven change | `carvera_4axis.hbs` + ATC banner | keep | P0 |
| Tool | Tool wear / life tracking | Mastercam tool life | **partial** | `ToolWearBadge.tsx` | keep | P2 |
| Tool | Tool-change timeline / count | Fusion op list; Mastercam | **have** | `ToolChangeTimeline.tsx` (mounted in workspace) | keep | P2 |
| Tool | Holder / collision geometry | Fusion holder library; Mastercam | **missing** | — (stickout only, no holder body) | add holder to collision sim | P2 |

---

## Category: Simulation / Verification

| Category | Tool | What ref apps do | Our status | Reachable from | Evidence | Access recommendation | Priority |
|---|---|---|---|---|---|---|---|
| Sim | 3D toolpath display (rapid/feed colored) | Fusion sim; Mastercam Backplot | **have** | `ManufactureCamSimulationPanel` (lines + tubes, amber rapid / cyan feed) | panel | keep | P0 |
| Sim | **Rotary material-removal (cylindrical heightfield)** | Fusion stock sim; Mastercam Verify | **have** | sim panel `CylindricalHeightFieldTerrain` for 4-axis | `cam-heightfield-cylindrical.ts` + panel | keep | P0 |
| Sim | Planar 2.5D material removal + voxel verify | Fusion Verify; Mastercam | **have** | sim panel tier2 (heightfield) / tier3 (voxel, quality presets) | `cam-heightfield-2d5.ts`, `cam-voxel-removal-proxy.ts` | keep | P1 |
| Sim | **Rotary chuck collision overlay** | Fusion collision; Mastercam gouge check | **have** | sim panel red `CollisionToolpathLines` (4-axis, machine chuck geom) | `collidingRawSegmentIndices` + `rotary-collision.ts` | keep | P0 |
| Sim | Playback scrubber + speed presets | Fusion timeline; Mastercam step | **have** | sim panel playback (0.25×–10×, progressive) | panel | keep | P1 |
| Sim | Animated tool head (oriented, 4-axis radial) | Fusion tool anim; Mastercam | **have** | `PlaybackToolHead` (quaternion for radial) | panel | keep | P1 |
| Sim | Feed-rate heat-map coloring | Fusion feed color; Mastercam | **have** | sim panel `feedRateColorMode:'heatmap'` | `feedRateHeatColor` | keep | P2 |
| Sim | Machine-envelope / soft-limit check | Fusion limits; Mastercam | **have** | `compareToolpathToMachineEnvelope` + `MachineEnvelopeBox` | panel | keep | P1 |
| Sim | **Tailstock / fixture body collision** in sim | Fusion full-fixture collision | **stub** | only chuck cylinder; tailstock not rendered/checked in sim | render+check tailstock | P1 |
| Sim | Gouge / rest-material excess detection | Fusion compare-to-model; Mastercam | **partial** | validation rejects gouge pre-gen; no post-sim "remaining stock" diff vs model | add stock-vs-model diff readout | P2 |
| Sim | Cycle-time estimate | Fusion machining time; Mastercam | **partial** | `gcode-toolpath-stats` motion counts/distance; no true feed-based time for rotary | add time est honoring A-feed | P2 |

---

## Category: Post-processing / Send to machine

| Category | Tool | What ref apps do | Our status | Reachable from | Evidence | Access recommendation | Priority |
|---|---|---|---|---|---|---|---|
| Post | Carvera 4-axis post (M2 end, Y0 center, no M6, dwell) | Fusion/Mastercam Carvera post | **have** | auto via `carvera_4axis.hbs` (profile `postTemplate`) | template + `post-process-carvera-4axis-contract.test.ts` | keep | P0 |
| Post | Carvera 3-axis post | OEM post | **have** | `carvera_3axis.hbs` | template | keep | P0 |
| Post | Foreign-dialect 4-axis fallback (CPS imports) | Fusion CPS library | **partial** | `carvera_4axis_grbl.hbs` (fanuc/mach3/linuxcnc/siemens/heidenhain all route here, M30) | template header notes | keep | P2 |
| Post | Inverse-time feed (G93) for rotary | Fusion/Mastercam rotary feed | **have** (opt-in) | `inverseTimeFeed` context in both 4-axis posts | templates | surface the toggle in Send UI | P1 |
| Post | Simultaneous-4axis warning block | (safety) | **have** | `enableSimultaneous4Axis` block in `carvera_4axis.hbs` | template | keep | P1 |
| Post | Probing block injection into program header | Fusion probing WCS preamble | **have** | `carveraProbingBlock` in `carvera_4axis.hbs` | template | keep | P1 |
| Send | Upload to Carvera (WiFi/USB) | Carvera Controller send | **have** | `ManufactureAuxPanels` "Upload to Carvera" + `CarveraSetupPanel` Generate&Upload → `carvera:upload` | preload `carveraUpload` | keep | P0 |
| Send | G-code safety guardrails / known-good diff | (proprietary) | **have** | `cam-toolpath-guardrails.ts` + `gcode-safety` skill (carvera-4axis ref) | skill | keep | P0 |
| Send | Setup-sheet / job sheet | Fusion Setup Sheet; Mastercam | **partial** | `setup-sheet.ts` (`generateSetupSheet`) wired via ProfileStack | keep; add rotary fields (Ø, chuck, A0) | P1 |
| Send | Post-options dialog (WCS, tool#, comments) | Fusion post dialog | **partial** | `extractPostProcessingOpts` from params; no dedicated dialog | add a Send dialog | P2 |

---

## Category: CAD / geometry inputs feeding rotary CAM

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Geom | Import STL/STEP/mesh | Fusion/Mastercam import | **have** | mesh import (`MESH_IMPORT_FILE_EXTENSIONS`); Design→Send to CAM | keep | P0 |
| Geom | Derive contour from sketch (for wrap) | Fusion sketch selection; Mastercam chaining | **have** | `deriveContourPointsFromDesign` → 4-axis contour "Derive contour" button | keep | P1 |
| Geom | Derive drill points from sketch circles | Fusion hole recognition | **have** | `deriveDrillPointsFromDesign` | keep | P1 |
| Geom | Interactive **face/edge selection** to drive a rotary op | Fusion face-driven; Mastercam | **partial** | design face-selection exists (`selection-state.ts`) but not wired to CAM op geometry | wire selection → op contour/region | P2 |
| Geom | Sketch-on-cylinder / unwrap surface | Fusion canvas-on-face; Vectric wrap | **missing** | — | defer | P2 |

---

## Top gaps (ranked build order for the Carvera 4-axis priority surface)

1. **P0 — Interactive part-orientation gizmo for rotary** (`run-cam-for-op.ts` hard-codes `identityTransform`; `frame.ts` already accepts a `Placement`). Today every 4-axis job assumes the STL is authored in rotary WCS with X = rotation axis. A 3-axis orient manipulator feeding `placement` unlocks real-world models. Lowest effort/highest payoff because the engine plumbing already exists.
2. **P1 — Mount the dead Probing + Multi-setup UIs.** `ProbeCyclePanel` (5 cycles) and `MultiSetupWizard` are fully built but unreferenced by the live shell. Add a "Probing" CNC stage/tab and a multi-setup entry point (incl. "duplicate setup at A+180" for double-sided). Pure wiring, no new algorithms.
3. **P1 — Tailstock geometry + collision (setup → engine → sim).** `RotaryFixtureConfig` already models a tailstock and `checkRotaryFixtureCollision` checks it, but the renderer never supplies one and the sim never draws it. Add setup fields, thread `rotaryFixture` through `run-cam-for-op.ts`, and render+check the tailstock body.
4. **P1 — Axis-substitution "Wrap onto rotary" modifier for arbitrary 2D ops.** Generalize the contour-wrap (`strategies/contour.ts` Y→A) so pocket/drill/engrave/chamfer can be wrapped, matching Fusion/Mastercam axis substitution. This is the single biggest *strategy-coverage* gap.
5. **P1 — True simultaneous 4-axis cutting strategy.** `continuous` is honestly sequential rough+finish; the post already supports G93 inverse-time + a simultaneous warning block, but no engine emits blended XYZA cutting moves with A-rate limiting. Build a real simultaneous generator.
6. **P1 — Rotary engrave-text + (P2) wrap-image/relief.** Text→font→contourPoints→wrap is a high-demand Carvera rotary use case (cylindrical engraving) and reuses the contour-wrap path.
7. **P1 — Surface the hidden rotary knobs in the op editor.** `stepoverDeg`, `adaptiveRefinement`, `useMeshRadialZBands`, and `rotaryHeadstockXOffsetMm` are engine/param-only with no UI control; expose them (and promote the 4-axis op editor to a tabbed dialog: Geometry · Tool · Heights · Passes · Linking).
8. **P2 — Square-bar rotary cross-section** (schema field exists, engine ignores it), **helical/spiral wrap**, **cylinder stock auto-fit from part**, and **rotary cycle-time estimate honoring A-feed**.
