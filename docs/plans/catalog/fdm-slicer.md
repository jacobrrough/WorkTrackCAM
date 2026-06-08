# FDM Slicer (Creality K2 Plus) — Tool/Button Catalog + Codebase Gap Audit

**Environment:** FDM slicer for the Creality K2 Plus (Klipper/Moonraker/Fluidd, 350×350×350 mm CoreXY, 0.4 mm nozzle, CFS multi-color).
**Reference apps catalogued:** Creality Print, OrcaSlicer, Bambu Studio, PrusaSlicer.
**Our backend:** bundled OrcaSlicer CLI (`resources/orca-slicer/`) invoked one-shot per slice via `src/main/slicer/orca-wrapper.ts`; K2 profiles in `resources/orca-slicer/profiles/{machines,process,filament}/`; Moonraker HTTP push/status in `src/main/moonraker-push.ts` + `moonraker-info.ts`; UI in `src/renderer/manufacture/`.

This matrix enumerates every meaningful tool/button/command those four apps expose for an FDM-prep workflow, grouped by the panels those apps use (Plate · Object/Arrange · Orientation · Supports · Process/Print Settings · Filament/Material · Multi-material/CFS · Calibration · Preview · Send/Device · Shell/Viewport/Nav). For each, our status is one of:

- **have** — implemented and reachable in the UI today.
- **partial** — works but limited vs. reference.
- **stub** — declared / UI-present but non-functional or hard-errors.
- **missing** — not present.

> Headline: our **slicing engine is real** (OrcaSlicer is bundled and wired end-to-end: STL → `slice:orca` → G-code → Moonraker push), the **calibration suite is strong** (8 parametric tests), and **Send/Device over Moonraker is genuinely good**. The deep gaps are everything *between import and slice* that the reference apps make their core loop: **per-object plate manipulation (move/rotate/scale/orient/arrange/duplicate), support tooling (auto + paint + manual editors), and an in-app process-parameter editor** (we expose only a 2-item quality dropdown over otherwise-frozen JSON profiles). There is also **no 3D layer/toolpath preview** for FDM — only a stats table + a 2D layer scrubber.

---

## Category: Plate / Build-plate management

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Plate | Add plate | New empty build plate (multi-plate project) | **have** | `PlateTabs.tsx` "+ Add plate" tile; `ManufactureWorkspace.handleAddPlate` | Keep in plate strip | P1 |
| Plate | Remove plate | Delete a plate (guard last) | **have** | `PlateTabs` × button (only when >1) | Keep | P1 |
| Plate | Rename plate | Inline rename | **have** | `PlateTabs` double-click → `onRenamePlate` | Keep | P2 |
| Plate | Plate thumbnails | Live 3D thumbnail per plate tile | **partial** | `PlateTabs` + `plate-thumbnail.ts` (OffscreenCanvas); falls back to colored rect; parent doesn't yet feed `plateThumbnails` map in `ManufactureWorkspace` | Wire `plateThumbnails`/`plateThumbnailsLoading` from real plate meshes | P1 |
| Plate | Slice this plate / Slice all plates | Split button: active plate + dropdown all | **partial** | `PlateTabs` split button renders, but `onSlicePlate`/`onSliceAllPlates` are NOT passed by `ManufactureWorkspace` → button disabled | Wire to `runFdmSliceFromOp`/per-plate slice | P0 |
| Plate | Plate-type / build-surface picker (textured PEI, smooth, engineering) | Per-plate bed surface + bed-temp coupling | **missing** | none (`support_multi_bed_types:1` exists in machine JSON but no UI) | Process panel → "Plate type" select | P2 |
| Plate | Bed/exclude regions, partial-plate print | OrcaSlicer "skirt/brim exclusion", print-region | **missing** | none | P2 (post-MVP) | P2 |
| Plate | Plate settings (per-plate process override, plate name in G-code) | Per-plate process + first-layer print sequence | **missing** | none | P2 | P2 |
| Plate | Arrange-all / Auto-arrange on plate | One-click nest of all objects with spacing | **missing** (FDM) | none — `LagunaNestingPanel` nests CNC contours only, not FDM plate objects | New "Arrange" toolbar button on Prepare viewport → packing on plate | **P0** |
| Plate | Plate orientation lock / sequence print order | "By object / by layer" sequence + collision check | **missing** | none | P2 | P2 |

## Category: Object / Arrange (per-object manipulation)

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Object | Import model (STL/OBJ/3MF/STEP) | Drag-drop / file dialog into plate | **partial** | `ManufactureWorkspace.importMeshForSelectedOp` via `assets:importMesh`; binds STL to an operation (no free-floating plate objects). 3MF/STEP import lives in CAD side; FDM plate import is STL-centric | Prepare stage "Import" toolbar; allow plate objects independent of ops | P1 |
| Object | Move / translate (gizmo + numeric XYZ) | Drag on plate + sidebar X/Y/Z fields | **missing** | none — Manufacture viewport (`ManufactureCamSimulationPanel`) is a read-only backplot; no `TransformControls` | Prepare viewport gizmo + Object properties panel | **P0** |
| Object | Rotate (gizmo + numeric, snap angles) | Rotate handles + 90°/45° snaps | **missing** | none | Prepare viewport gizmo | **P0** |
| Object | Scale (uniform + per-axis + to-size + %) | Scale handles + numeric mm / % | **missing** | none | Object properties | **P0** |
| Object | Mirror | Mirror across X/Y/Z | **missing** | none | Object context menu | P1 |
| Object | Duplicate / clone (+ array/grid) | Copy object, fill plate | **missing** | none | Object context menu | P1 |
| Object | Delete object | Remove from plate | **partial** | only via removing an operation (`removeOp`) | Object context menu + Del key | P1 |
| Object | Center on plate / drop to bed (Z=0) | Snap object to bed, center | **missing** | none | Prepare toolbar | P1 |
| Object | Split to objects / split to parts | Split a multi-shell mesh | **missing** | none | P2 | P2 |
| Object | Cut / plane cut (with caps + keep-upper/lower) | Plane-cut tool | **missing** | none | P2 (CAD has none either) | P2 |
| Object | Boolean (union/diff/intersect of plate objects) | Mesh boolean on plate | **missing** | none | P2 | P2 |
| Object | Assemble / merge into single object | Combine objects | **missing** | none | P2 | P2 |
| Object | Per-object settings (object-level process override) | Right-click → per-object infill/walls/etc | **missing** | none | Object properties → overrides | P1 |
| Object | Modifier mesh / negative-volume part | Add region with different settings | **missing** | none | P2 | P2 |
| Object | Variable layer height (per-object) | Adaptive/variable layer paint | **missing** | none | Process | P2 |
| Object | Object list / "Objects" browser tree | Hierarchical object+settings tree | **partial** | `ManufactureOperationList` is op-centric (CAM tree), not an FDM object tree | New FDM Objects panel for Prepare stage | P1 |

## Category: Orientation

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Orientation | Auto-orient (overhang/area/support-minimizing) | One-click best-orientation heuristic | **missing** | none | Prepare toolbar "Auto-orient" | **P0** |
| Orientation | Place face on bed (pick-face-down) | Click a face → lay flat | **missing** | none | Object context menu + face pick | P1 |
| Orientation | Lay flat / drop to bed | Snap lowest face to bed | **missing** | none | Prepare toolbar | P1 |
| Orientation | Orientation presets (by axis, named) | Quick 90° rotations | **missing** | none | Object properties | P2 |

## Category: Supports

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Supports | Enable supports + type (normal/tree/organic) | Toggle + tree/normal selector | **partial** | Only baked into process JSON (`enable_support`, `support_type`, `tree_support_*`); standard.json ships `enable_support:0`. NO UI toggle | Process panel "Support" group with type select | **P0** |
| Supports | Support placement (everywhere / build-plate-only / none) | Radio in print settings | **missing (UI)** | profile field `support_on_build_plate_only` only | Process panel | P1 |
| Supports | Overhang threshold angle | Numeric ° | **missing (UI)** | profile field `support_threshold_angle` only | Process panel | P1 |
| Supports | Paint-on supports (support painter) | Brush supports onto model | **missing** | none (confirmed gap in `docs/COMPETITIVE-GAP-ANALYSIS.md`) | Prepare viewport paint mode | P1 |
| Supports | Support blockers / enforcers (modifier paint) | Add/remove support regions | **missing** | none | Prepare viewport paint mode | P2 |
| Supports | Support interface (top/bottom layers, spacing, Z-gap) | Numeric tuning | **missing (UI)** | profile fields only (`support_interface_*`, `support_top_z_distance`) | Process panel advanced | P2 |
| Supports | Manual support editor (add/remove cylinders) | Place individual support pillars | **missing** | none | P2 | P2 |
| Supports | Tree/organic branch tuning (diameter, angle) | Numeric branch params | **missing (UI)** | profile fields `tree_support_branch_*` only | Process advanced | P2 |

## Category: Process / Print settings (quality, walls, infill, speed, adhesion)

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Process | Quality preset picker | Dropdown of process presets (0.08–0.28 mm etc.) | **partial** | `ProfileStack.QualityRow` + `SliceManufacturePanel` K2 picker — only **2** entries (Standard / High-Speed) from `K2_PLUS_SLICE_PRESETS` | Expand presets + surface as ribbon "Quality" | P1 |
| Process | Layer height / first-layer height | Numeric mm | **missing (UI)** | fixed in `process/standard.json` (`layer_height:0.2`); no editor | Process panel core | **P0** |
| Process | Line width (per-feature) | Numeric mm | **missing (UI)** | profile fields only | Process advanced | P2 |
| Process | Wall loops / count | Numeric | **missing (UI)** | profile `wall_loops:3` only | Process core | P1 |
| Process | Wall ordering / seam position | Inner-outer + seam mode | **missing (UI)** | profile `seam_position`, `wall_infill_order` only | Process advanced | P2 |
| Process | Top/bottom shell layers + thickness + pattern | Numeric + pattern select | **missing (UI)** | profile `top_shell_layers`, patterns only | Process core | P1 |
| Process | Infill density | Numeric % slider | **missing (UI)** | profile `sparse_infill_density:20%` only | Process core | **P0** |
| Process | Infill pattern (grid/gyroid/honeycomb/…) | Pattern dropdown | **missing (UI)** | profile `sparse_infill_pattern` only | Process core | P1 |
| Process | Infill direction / anchor / overlap | Numeric | **missing (UI)** | profile fields only | Process advanced | P2 |
| Process | Speeds (per-feature: outer/inner/infill/travel) | Numeric mm/s table | **missing (UI)** | profile `outer_wall_speed` etc. only; presets differ but uneditable | Process speed group | P1 |
| Process | Acceleration / jerk (SCV) control | Numeric | **missing (UI)** | profile + ceilings in `k2-plus-slice-presets.ts` only | Process advanced | P2 |
| Process | Brim (type / width / gap) | Type + width | **missing (UI)** | profile `brim_width:0` only | Adhesion group | P1 |
| Process | Skirt (loops / distance / height) | Numeric | **missing (UI)** | profile `skirt_*` only | Adhesion group | P2 |
| Process | Raft (layers / contact) | Toggle + layers | **missing (UI)** | profile `raft_layers:0` only | Adhesion group | P2 |
| Process | Elephant-foot compensation | Numeric mm | **missing (UI)** | profile field only | Process advanced | P2 |
| Process | Ironing (type / flow / spacing / speed) | Toggle + tuning | **missing (UI)** | profile `ironing_*` only | Process advanced | P2 |
| Process | Prime/wipe tower (enable / width) | Toggle | **missing (UI)** | profile `enable_prime_tower:0` only | Multi-material group | P2 |
| Process | Fuzzy skin | Toggle + params | **missing** | none | Process advanced | P2 |
| Process | Z-hop / retraction tuning | Numeric | **missing (UI)** | machine JSON `z_hop`, `retraction_*` only | Process advanced | P2 |
| Process | Adaptive / variable layer height | Auto + manual paint | **missing** | none | Process | P2 |
| Process | XY hole/contour compensation | Numeric mm | **missing (UI)** | profile fields only | Process advanced | P2 |
| Process | Save / create custom process preset | "Save as" user preset | **missing** | none (presets are frozen module constants) | Process panel header | P1 |
| Process | Recommended ⇆ Expert mode toggle | Density toggle hides advanced | **partial** | `ProfileStack` Recommended/Pro pill exists but gates almost nothing (no editable params behind it) | Reuse for real param density | P1 |
| Process | Per-slice overrides | Inline override of any key | **stub** | `OrcaSliceConfig.overrides` field exists but `buildOrcaArgs` **ignores it** (documented no-op in `orca-wrapper.ts`) | Implement overlay-JSON merge so overrides flow | P1 |

## Category: Filament / Material

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Filament | Filament picker (active material) | Chips/dropdown grouped by type | **have** | `FilamentPicker.tsx` (grouped Standard/Engineering/Support/Other); in `ProfileStack` + `SliceManufacturePanel`; over-temp chips disabled vs machine ceiling | Keep; surface in Prepare | P1 |
| Filament | Filament library (PLA/PETG/ABS/ASA/TPU/PA/PC/CF…) | Large vendor library | **partial** | `filament-schema.ts` supports 13 types; bundled set is `pla-generic` only (`profiles/filament/pla-generic.json`) | Ship K2 PETG/ABS/ASA/TPU profiles | P1 |
| Filament | Edit filament (temps/fan/flow/retract) | Full filament settings editor | **partial** | schema has fields (`nozzleTempC`, `bedTempC`, `chamberTempC`, `fanSpeedPercent`, `maxVolFlowMm3PerSec`, retraction); `filaments:save` IPC exists; no rich editor UI (import-only) | Filament editor dialog | P1 |
| Filament | Import filament profile (.json/.ini) | Import vendor profile | **partial** | via `filamentsSave`/Settings; the active-slice filament JSON is the fixed `pla-generic.json` regardless of picker (slice handler maps `filamentId`→`profiles/filament/<id>.json` but only one file exists) | Generate one Orca filament JSON per library record | **P0** |
| Filament | Per-object / per-region filament assignment | Multi-material paint | **missing** | none | Multi-material group | P2 |
| Filament | Filament cost / weight estimate | g + $ readout | **partial** | layer breakdown reports filament mm/length; no weight/cost rollup | Add to Preview summary | P2 |
| Filament | Max volumetric speed (per filament) | Numeric mm³/s | **partial (UI elsewhere)** | calibration test exists; schema field exists; not in filament editor | Filament editor | P2 |
| Filament | Flow ratio / pressure-advance per filament | Numeric | **partial** | calibration tests produce values but no per-filament persistence binding | Filament editor "Advanced" | P2 |

## Category: Multi-material / CFS (Creality Filament System)

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| CFS | Slot/lane assignment (which spool) | AMS/CFS lane mapper | **partial** | `SliceManufacturePanel` CFS slot picker (0–3) → `?cfs_slot=N` on Moonraker upload URL; persisted `cfsSlotId`. No per-object color mapping | Keep; extend to per-object later | P1 |
| CFS | Color painting / per-triangle color | Paint colors on model | **missing** | none | P2 | P2 |
| CFS | Flush/purge volumes between colors | Matrix of purge volumes | **missing (UI)** | Orca ships `flush_data_*` resources; not surfaced | P2 | P2 |
| CFS | Filament mapping preview (which lane prints what) | Mapping table | **missing** | none | P2 | P2 |
| CFS | RFID / spool auto-detect | Read spool RFID | **missing** | none (CLAUDE.md lists "RFID filament support" as a K2 capability target) | P2 | P2 |

## Category: Calibration

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Calibration | Temperature tower | Parametric temp-tower G-code | **have** | `CalibrationPanel` (K2-only) → `calibration:generate` → Send to K2 | Keep | P1 |
| Calibration | Flow rate / flow ratio | Single-wall flow cube | **have** | `CalibrationPanel` flow-rate card | Keep | P1 |
| Calibration | Pressure advance (Klipper) | PA sweep | **have** | `CalibrationPanel` PA card | Keep | P1 |
| Calibration | Retraction tower | Retraction sweep | **have** | `CalibrationPanel` retraction card | Keep | P2 |
| Calibration | Max volumetric flow | mm³/s sweep | **have** | `CalibrationPanel` max-vol-flow card | Keep | P2 |
| Calibration | Tolerance / dimensional | Peg-hole clearance test | **have** | `CalibrationPanel` tolerance card | Keep | P2 |
| Calibration | Cornering / SCV (square_corner_velocity) | SCV sweep | **have** | `CalibrationPanel` cornering card | Keep | P2 |
| Calibration | VFA (vertical fine artifacts) | Resonance/banding test | **have** | `CalibrationPanel` VFA card | Keep | P2 |
| Calibration | Input-shaping / ringing tower | Resonance tower (ADXL) | **partial** | VFA covers visual artifacts; no dedicated ringing tower / accel-data flow (Orca ships `input_shaping/*.drc`) | Add ringing-tower card | P2 |
| Calibration | Adaptive PA (pattern) | Auto-PA pattern model | **missing** | none (Orca ships `auto_pa_line_*.3mf`) | Calibration card | P2 |
| Calibration | Calibration result → save back to profile | Auto-apply measured value | **missing** | none — generates G-code only; operator hand-edits profile | "Apply to filament/process" action | P1 |

## Category: Preview / Layer view

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Preview | Layer scrubber (vertical slider) | Drag layers up/down in 3D | **partial** | `LayerPreviewBody` has a horizontal range slider + per-layer table (real per-layer stats via streaming `slice:layerBreakdown`) | Pair with a 3D layer view | P1 |
| Preview | 3D toolpath / layer color view | Color-by-feature 3D render of paths | **missing (FDM)** | none — FDM preview is a stats table only; the 3D backplot (`ManufactureCamSimulationPanel`) is CNC G-code only | Render G-code paths in Preview viewport | **P0** |
| Preview | Color-by line type (wall/infill/support/travel) | Legend + per-type color | **partial** | `LayerPreviewBody` shows per-layer line-type *counts* (text), no color render | Add to 3D preview | P1 |
| Preview | Color-by speed / flow / fan / temp / layer-time | Heatmap modes | **missing** | none | Preview view-mode dropdown | P2 |
| Preview | Travel-moves toggle | Show/hide travels | **missing** | none | Preview toolbar | P2 |
| Preview | Range slider (show layer span) | Two-thumb layer band | **missing** | single-value slider only | Preview | P2 |
| Preview | Per-layer / total time + filament estimate | Time + g + $ summary | **partial** | per-layer + total time & filament length from header/parser; no weight/$ | Add weight + cost | P1 |
| Preview | Sequential-print collision preview | Visualize print order + clearance | **missing** | none | P2 | P2 |
| Preview | Layer-time / speed graph | Per-layer time chart | **partial** | per-layer table has time column; no graph | Add chart | P2 |

## Category: Send / Device (Moonraker / Klipper)

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Send | Upload G-code to printer | Push to printer over network | **have** | `SliceManufacturePanel` "Send to K2 Plus" + `ProfileStack` send → `moonraker:push` (`buildMoonrakerPushPayload`) | Keep; primary CTA | P0 |
| Send | Upload + start print | Send then start | **have** | `moonrakerPush({startAfterUpload:true})` | Keep | P0 |
| Send | Pre-upload temp-ceiling guard | (WorkTrack3D-specific safety) | **have** | `moonraker-push.ts` `validateGcodeFileTemps` blocks over-ceiling jobs before bytes cross network | Keep — strong safety win | P0 |
| Send | Embedded thumbnail in G-code | Mainsail/Fluidd file thumbnail | **partial** | K2 machine JSON sets `thumbnails:[300x300,96x96]`; push warns (non-fatal) if `; thumbnail begin` missing via `hasThumbnailBlock` | Verify Orca emits it; keep warning | P1 |
| Send | Test connection (printer info) | Ping + firmware/host/temps | **have** | Settings → Network & Printers "Test connection" → `moonraker:status` + `moonraker:info` (`moonraker-info.ts`) | Keep | P1 |
| Send | Live print status (state/progress/ETA) | Status banner | **have** | `WorkshopDashboard` 5 s poll of `moonraker:status` (filename/progress/ETA) | Keep | P1 |
| Send | Pause / Resume / Cancel print | Job controls | **partial** | IPC fully wired (`moonraker:pause/resume/cancel`, preload bridges) but no UI buttons surface them | Add controls to Device stage + dashboard K2 card | **P0** |
| Send | E-stop / emergency stop | Halt printer now | **have** | TopBar E-stop → `machine:estop` → K2 Moonraker `/printer/emergency_stop` (`ipc-machine.ts`) | Keep | P0 |
| Send | Preheat / set nozzle+bed+chamber temp | Manual heater set-points | **missing** | `moonraker-info.ts` *reads* temps; no set/preheat command | Device stage "Preheat" controls | P1 |
| Send | Webcam / camera feed | Live print camera | **missing** | none | Device stage embed | P2 |
| Send | Print queue / job queue | Queue multiple jobs | **missing** | none (Moonraker has a job-queue API) | Dashboard "Run queue" | P1 |
| Send | Move axes / home / jog | Manual motion panel | **missing** | none | Device "Manual control" (advanced) | P2 |
| Send | Console / send G-code command | Klipper console | **missing** | none | Device advanced | P2 |
| Send | Bed mesh / auto-level trigger | Run `BED_MESH_CALIBRATE` | **missing** | push warns if no adaptive-probing sentinel; no trigger button | Device "Calibrate bed" | P2 |
| Send | Power-loss-recovery awareness | PLR resume support | **partial** | push emits non-fatal warning if no Klipper PLR sentinel; K2 profile flags it | Keep advisory | P2 |
| Send | SD / virtual-SD file browser | Browse/delete printer files | **missing** | none | Device file list | P2 |
| Send | Export G-code to file / removable media | Save .gcode | **partial** | slice writes `output/slice.gcode`; no explicit "Export/Save As" affordance in FDM (exists conceptually for CNC) | Add "Export G-code" button | P2 |
| Send | RFID / CFS spool sync to printer | Sync spool data | **partial** | CFS slot rides on upload URL only; no spool data sync | P2 | P2 |

## Category: Shell / Viewport / Navigation (slicer chrome)

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Shell | Workflow stage tabs (Prepare / Preview / Device) | Top segmented Prepare/Preview/Device | **have** | `WorkflowStageTabs` (FDM: Prepare/Preview/Device) with roving tabindex | Keep | P1 |
| Shell | Right-side device/profile stack | Settings + Send column | **have** | `ProfileStack` (mode pill, filament, quality, temps, Send) | Keep | P1 |
| Shell | Orient/move/scale/arrange viewport toolbar | Left toolbar of plate-edit tools | **missing** | none on Manufacture viewport | Prepare viewport tool rail | **P0** |
| Shell | View cube / standard views (top/front/iso) | Orientation cube + view presets | **partial** | exists in CAD `Viewport3D`/`ViewportChrome`; Manufacture backplot has limited camera, no cube | Reuse view cube in Prepare | P1 |
| Shell | Fit / zoom-to-plate, pan/orbit | Camera nav | **partial** | backplot supports orbit/zoom; no explicit fit-to-plate button | Add fit button | P2 |
| Shell | Grid / bed render with print-volume box | 350³ build box + grid | **partial** | CAM sim panel renders stock box + envelope, not an FDM bed/volume in Prepare | Render K2 bed + 350³ box in Prepare | P1 |
| Shell | Object browser / list panel | Left tree of plate objects | **partial** | op-centric `ManufactureOperationList`, not an FDM object list | New FDM objects panel | P1 |
| Shell | Global settings dialog (machine/process/filament tabs) | Tabbed preset manager | **partial** | `SettingsView` covers paths/network/python; no preset-tree manager | Preset manager tab | P1 |
| Shell | Undo / redo on plate edits | Edit history | **missing** | none for plate/object edits | Wire once object transforms exist | P1 |
| Shell | Keyboard shortcuts (move/rotate/del/arrange) | Hotkeys for plate ops | **partial** | shell shortcuts exist (`app-keyboard-shortcuts.ts`); no plate-edit hotkeys | Add once tools exist | P2 |
| Shell | Drag-drop import onto plate | Drop file → plate | **partial** | `useAppDragDrop` exists app-wide; FDM-plate drop binding not explicit | Wire drop → plate import | P2 |
| Shell | Slice button (primary, with progress) | Big "Slice" + progress | **partial** | slice runs from op list `onRunFdmSlice` + plate split button (disabled); `CamProgressBar` is CAM-only | Promote a single FDM Slice CTA + progress | **P0** |
| Shell | Machine quick-switch / "My Shop" | Switch active machine | **have** | `ManufactureSetupStrip` + My Shop presets | Keep | P1 |

---

## Top gaps (highest impact, FDM)

- **No per-object plate manipulation** — there is no move/rotate/scale/mirror/duplicate/orient gizmo or numeric transform anywhere in the Manufacture viewport (it is a read-only backplot). This is the single biggest divergence from OrcaSlicer/Bambu/Prusa/Creality Print, where plate editing *is* the core loop. **(P0)**
- **No auto-arrange and no auto-orient for FDM** — every part must be positioned by editing operations; competitors do both in one click. (`LagunaNestingPanel` nests CNC contours, not FDM plate objects.) **(P0)**
- **No in-app process-parameter editor** — we expose a 2-item quality dropdown over otherwise-frozen JSON profiles (`process/standard.json`, `high_speed.json`). Layer height, infill density/pattern, walls, speeds, brim/raft, supports are all uneditable from the UI, and `OrcaSliceConfig.overrides` is a documented no-op in `buildOrcaArgs`. **(P0)**
- **Supports are profile-flags-only** — no enable/type toggle, no overhang-threshold control, no paint-on supports or blockers/enforcers. `standard.json` ships `enable_support:0` with no way to turn it on without editing JSON. **(P0/P1)**
- **Filament library is effectively single-profile at slice time** — the picker and 13-type schema exist, but only `pla-generic.json` is bundled, so the active-slice filament JSON is PLA regardless of selection. Need one Orca filament JSON per library record (and a "save filament back from calibration" path). **(P0)**
- **No 3D layer/toolpath preview for FDM** — Preview is a stats table + 2D scrubber with line-type *counts*; there is no color-by-feature 3D path render (the existing 3D backplot is CNC-only). **(P0)**
- **Printer job controls exist in IPC but are not surfaced** — `moonraker:pause/resume/cancel` are fully wired through the preload but have no buttons; no preheat/set-temp, no webcam, no Moonraker job-queue. Send/upload/start/status/E-stop are solid. **(P0 for pause/resume/cancel buttons.)**
- **Plate "Slice this/all plates" split button is inert** — `PlateTabs` renders it but `ManufactureWorkspace` never passes `onSlicePlate`/`onSliceAllPlates`, so it is disabled; plate thumbnails also aren't fed real meshes yet. **(P0/P1)**

### Strengths to preserve
- OrcaSlicer is genuinely bundled and the slice pipeline works end-to-end (STL → `slice:orca` → G-code → Moonraker), with a pre-upload temperature-ceiling safety guard that the reference apps do **not** have.
- The K2 calibration suite (8 parametric tests, all Send-to-K2 wired) already exceeds the 5-test bar noted in `docs/COMPETITIVE-GAP-ANALYSIS.md`.
- Moonraker Send/Device coverage (upload, start, status/ETA poll, test-connection with firmware+temps, E-stop, CFS slot, thumbnail/PLR/adaptive-probing advisories) is strong and well-tested.
