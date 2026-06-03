# WorkTrack3D — Competitive Gap Analysis

**Date:** 2026-05-27
**Scope:** Research-only. No production code touched. Benchmark targets are Fusion 360 Manufacture, Mastercam 2026, VCarve Pro, OrcaSlicer, Bambu Studio, and the modern professional-desktop-app UX baseline. Findings are constrained by `CLAUDE.md` **My-Shop-Only Mode** — every gap below directly benefits Creality K2 Plus, Laguna Swift 5x10, or Makera Carvera (3- or 4-axis).

---

## 1. Current state summary

WorkTrack3D today is a surprisingly broad foundation. The Manufacture pipeline covers **30+ operation kinds** (`src/shared/manufacture-schema.ts` lines 175-367) including 2D contour/pocket/drill/chamfer, 3D adaptive/waterline/raster/scallop/spiral/morph/trochoidal/steep-shallow, 4-axis roughing/finishing/contour/indexed/continuous, 5-axis contour/swarf/flowline, probing (5 cycle types), thread-mill, laser, PCB iso/drill/contour, and FDM slice. Three target machine profiles ship (`resources/machines/*.json`), plus 7 Handlebars post-processors (`resources/posts/`). The backend has been pivoted post-2026-05-27 to a CadQuery + OpenCAMLib + OrcaSlicer Python sidecar (`engines/sidecar/main.py`, `src/main/sidecar/python-bridge.ts`, `src/main/slicer/orca-wrapper.ts`).

UX scaffolding is already in place but thin: an `OnboardingOverlay` (4 static cards), a `HelpPanel` (shortcuts/glossary/operations/tips), a command palette (`src/renderer/commands/CommandPalette.tsx`), a 152-entry Fusion-style command catalog (87 implemented / 45 partial / 16 planned — `src/shared/fusion-style-command-catalog.ts`), a working undo/redo manager (`src/renderer/src/undo-manager.ts`), 398 `aria-*` attributes across 67 files, and a sketch canvas (`Sketch2DCanvas.tsx`) covering lines, arcs, splines, fillet/chamfer, trim, pattern, mirror. The Settings view is **two fields long** (`SettingsView.tsx`: Python path + CuraEngine path) — that is the single biggest visible UX shortfall today. OrcaSlicer profiles for K2 Plus (standard + high-speed) exist (`resources/orca-slicer/profiles/`), and Moonraker direct upload is wired (`src/main/moonraker-push.ts`). Mesh import handles STL/STEP/IGES/OBJ/PLY/GLTF/3MF/OFF/DAE/FBX/DXF (`src/shared/mesh-import-formats.ts`).

What's **missing** vs. mature competitors is mostly polish, library breadth, and FDM-workflow surfaces — not core engine capability.

---

## 2. Competitor feature scan

### Fusion 360 Manufacture
| Capability | Has it | WorkTrack3D status |
|---|---|---|
| Setup wizard with Model/Stock/Post tabs and 5 WCS-orientation modes | Yes ([source](https://www.autodesk.com/support/technical/article/caas/sfdcarticles/sfdcarticles/Defining-Work-Coordinate-Systems-in-the-Fusion-360-CAM-Workspace.html)) | Have WcsOriginPicker (10 points) and MultiSetupWizard, but no guided "new setup" wizard with model-orientation pick modes |
| Tool library import (Fusion .tools ZIP, HSMWorks CSV) | Yes | Yes — `src/main/tools-import.ts` handles both, plus generic CSV/JSON |
| Toolpath simulation (material removal, collision) | Yes | Partial — `cam-simulation-preview.ts` exists; ManufactureCamSimulationPanel renders it |
| Adaptive clearing | Yes | Yes (`cnc_adaptive`) |
| 3+2 (indexed) machining | Yes | Yes (`cnc_4axis_indexed`) |
| Multi-axis simultaneous | Yes | Yes (5-axis contour / swarf / flowline) |
| Probing (single surface, bore/boss, corner, Z-touch) | Yes | Yes — 5 cycle types in `src/shared/probing-cycles.ts` |
| Post library | 100s of community posts | 7 posts ship; no post browser/picker UI |

### Mastercam 2026
| Capability | Has it | WorkTrack3D status |
|---|---|---|
| 2D, 3D, 4-, 5-axis, turning, Swiss, wire-EDM ([source](https://www.gmccs.de/downloads/pdf/mastercam/WhatsNew.pdf)) | Yes | Mill yes; turning is **planning-only** (`cnc_lathe_turn`); no Swiss / EDM (out of scope) |
| Critical Depths feature (machine flat areas inside a 3D pass) | New in 2026 | Not implemented |
| Deburr toolpath with asymmetric edge option | Yes | Not implemented |
| Blade Expert (turbomachinery) | Yes | Out of scope |

### VCarve Pro (Laguna Swift 5x10 environment)
| Capability | Has it | WorkTrack3D status |
|---|---|---|
| True-shape nesting of vectors and components | Yes ([source](https://www.vectric.com/products/vcarve/)) | **Not implemented** — no nesting engine anywhere in `src/` |
| V-carving + prism carving + fluting + texturing | Yes | V-carving via `cnc_chamfer` exists; prism/fluting/texturing not implemented |
| Inlay toolpath (auto-creates male + female with mirror) | Yes | Not implemented |
| 2.5D sign-making workflow with vector libraries | Yes | Partial — sketch canvas can produce profiles, no clip-art / font-to-vector wizard |
| Sheet job set-up sheets | Yes | Yes — `src/renderer/src/setup-sheet.ts` |

### OrcaSlicer
| Capability | Has it | WorkTrack3D status |
|---|---|---|
| Calibration suite: temp tower, max volumetric, pressure advance, adaptive PA, flow ratio, retraction, tolerance, cornering (jerk/junction-dev), input shaping, VFA ([source](https://github.com/SoftFever/OrcaSlicer/wiki/Calibration)) | Yes (10 calibration tests) | **Not implemented** — no calibration UI; we just call Orca for slicing |
| Seam painter ([source](https://www.orcaslicer.com/wiki/print_prepare/prepare_seam_painting)) | Yes | Not implemented |
| Support painter / paint-on supports | Yes | Not implemented |
| Multi-plate management | Yes | Not implemented — single mesh, single plate |
| Auto-arrange on plate | Yes | Not implemented |
| Cloud profile sync (community profiles) | Yes | Not implemented (out of scope) |

### Bambu Studio
| Capability | Has it | WorkTrack3D status |
|---|---|---|
| Auto-orient (overhang area + bottom area + convex hull heuristic) ([source](https://wiki.bambulab.com/en/software/bambu-studio/auto-orientation)) | Yes | **Not implemented** |
| Auto-arrange on plate | Yes | Not implemented |
| AMS 16-color integration | Yes | Not applicable — K2 Plus uses Creality CFS not AMS |
| Plates Management (multiple plates per project, batch slice) | Yes | Not implemented |
| In-app camera/timelapse view | Yes | Not implemented (Moonraker upload exists, but no live preview) |
| MakerWorld profile browser | Yes | Out of scope |

### Klipper / Moonraker ecosystem (K2 Plus targets this)
| Capability | Has it | WorkTrack3D status |
|---|---|---|
| Embedded thumbnail PNG in G-code (read by Mainsail/Fluidd file list) ([source](https://docs.mainsail.xyz/overview/features/thumbnails)) | Yes (industry standard) | **Not implemented** — Orca itself emits one but our pipeline doesn't verify or surface it |
| Moonraker direct upload | Yes | Yes — `src/main/moonraker-push.ts` |
| Job-progress polling | Yes | Partial — `MoonrakerPreviewBanner` shows job state |
| Power-loss recovery G-code blocks | K2 supports | K2 profile has the flag; passthrough post emits a comment but no validation |

### Desktop UX baseline
| Capability | Has it | WorkTrack3D status |
|---|---|---|
| Command palette (Ctrl+K) | Modern norm | Yes |
| Undo/redo (Ctrl+Z / Ctrl+Y) | Modern norm | Engine yes (`undo-manager.ts`); not registered in keyboard shortcut table (`app-keyboard-shortcuts.ts`) — confirmed absent |
| First-launch wizard that creates a starter project | Modern norm | Partial — `OnboardingOverlay` is informational only; no project bootstrap |
| Robust Settings (theme, units, paths, network, defaults) | Modern norm | **Two fields**, no theme / units / network / defaults / shortcuts customization |
| Recent projects list | Modern norm | Partial — `lastProjectPath` in app settings but no MRU list |
| Drag-and-drop file open | Modern norm | Yes (`ShopModelViewer` drop handling) |
| Live job progress | Modern norm | Yes (CAM progress bar) |
| Crash report / log download | Modern norm | Not visible — would need to confirm in `ErrorBoundary` |

---

## 3. Top 10 prioritized gaps

Ranked by impact-to-effort. Effort: S (1–3 h), M (1–2 days), L (1–2 weeks), XL (multi-week).

| # | Gap | Why it matters | Effort | Three-machine relevance | Suggested implementation surface |
|---|---|---|---|---|---|
| **1** | **Real Settings view (theme, units, default machine, Moonraker URL, paths, post defaults)** | Owner opens Settings expecting a polished surface; currently 2 fields. Every user, every install. | S–M | CROSS-CUT | Rewrite `src/renderer/src/SettingsView.tsx`; extend `appSettingsSchema` in `src/shared/project-schema.ts` for `theme`, `units`, `defaultMachineId`, `moonrakerUrl`, `moonrakerApiKey` |
| **2** | **Embedded thumbnail PNG in K2 Plus G-code** | Mainsail/Fluidd file pickers show thumbnails; without it K2 jobs look like raw filenames. Every print, every K2 user. Confirms upload reached the printer at-a-glance. | S | DIRECT K2 | `src/main/slicer/orca-wrapper.ts` — verify Orca's `thumbnails` setting is in `creality-k2-plus.ini`; add post-slice verification in `moonraker-push.ts` |
| **3** | **First-launch project wizard (pick machine, pick environment, optional starter STL)** | `OnboardingOverlay` is just 4 info cards — no actual project gets created. New users land in an empty shell. | M | CROSS-CUT | Replace `OnboardingOverlay` with a 3-step wizard that calls `project:create` IPC with the chosen machine ID; add a "starter projects" sample folder under `resources/samples/` |
| **4** | **Calibration test generator for K2 Plus (temp tower, flow, max-vol, pressure advance, retraction)** | OrcaSlicer's standout feature. Without calibration, our K2 high-speed preset is theoretical; with it, the owner can dial the printer in for any new spool. | M–L | DIRECT K2 | New `src/main/calibration/k2-plus-tests.ts` that emits parametric test G-code via Orca's `--calibration` flags or via STL-template + override pipeline; new `CalibrationPanel.tsx` in `src/renderer/manufacture/` |
| **5** | **Auto-orient for FDM (overhang + bottom-area + convex-hull heuristic, like Bambu Studio)** | Hand-orienting every part for FDM is tedious and error-prone. One click vs five drags every print. | M | DIRECT K2 | New `src/shared/auto-orient.ts` (pure math on triangle list — re-use existing `stl-vec3.ts` helpers); wire into `ShopModelViewer` toolbar; persist `meshes[].transform` per-mesh on the project |
| **6** | **Tool library UI parity with Fusion (search, filter by Ø/type/material, multi-material presets, ATC slot assignment grid)** | Tool record schema is rich (material presets, ATC slot, wear life — see `tool-schema.ts`) but the UI almost certainly doesn't expose all of it. Fusion users will compare. | M | CROSS-CUT (Laguna + Carvera heavily) | `src/renderer/src/ToolLibraryPanel.tsx` — enrich; add search input, filters, an ATC slot grid (Carvera = 6 slots), wear-life badge integration with existing `ToolWearBadge.tsx` |
| **7** | **Multi-plate / multi-job project (queue multiple slices or CAM jobs in one project)** | Both OrcaSlicer and Bambu Studio center on this. For a one-person shop running batches, switching projects between jobs is friction. | L | CROSS-CUT | `project-schema.ts` add `plates: Plate[]`; new `PlateTabs` in `ManufactureWorkspace`; multi-setup partly exists (`MultiSetupWizard.tsx`) but not at plate-level |
| **8** | **Klipper preview-image + max-Z + estimated-time header validation on slice output** | The Klipper `;` header lines (`PRINT_TIME`, `FILAMENT_USED`, layer count, etc.) feed Moonraker's job listing. We comment-emit some K2 capability flags but don't validate Orca actually emitted PRINT_TIME / time-estimate / thumbnails. Silent UX regression. | S | DIRECT K2 | Extend `src/main/gcode-header-read.ts` to assert presence of `;TIME:`, `;Filament used:`, `;thumbnail begin`; surface "header health" badge in renderer before push |
| **9** | **True-shape nesting for Laguna sheet jobs (VCarve Pro parity)** — **v1 SHIPPED 2026-05-27** | Laguna Swift's whole purpose is full-sheet plywood/MDF. Without nesting, the owner re-arranges by hand and wastes material. Cuts cost per sheet meaningfully. | L | DIRECT Laguna | v1: `src/main/nesting/true-shape-v1.ts` (bottom-left-fill with axis-aligned bounding-box overlap, from-scratch — no external libs), IPC `nesting:nest-polygons`, Laguna-only renderer panel `src/renderer/manufacture/LagunaNestingPanel.tsx`. v2 planned: swap BLF for true NFP + genetic-algorithm meta-optimizer (port from MIT-licensed SVGnest / Deepnest); see "v2 upgrade path" comment block at the bottom of `src/main/nesting/true-shape-v1.ts`. |
| **10** | **Workshop dashboard / "Run Queue" panel showing K2 push status, Carvera Carbide CLI status, Laguna setup sheet** | Today these are scattered: Moonraker banner is in `ShopApp.tsx`, Carvera CLI is in a Makera panel, Laguna's setup sheet is a button. Pro apps consolidate "what is each machine doing right now". | M | CROSS-CUT | New `src/renderer/dashboard/WorkshopDashboard.tsx` (subscribe to existing IPC channels — no new backend) |

---

## 4. Quick wins (S-effort, high-impact)

1. **K2 G-code thumbnail verification** (Gap #2). Confirm OrcaSlicer's `thumbnails` key is set in `resources/orca-slicer/profiles/machines/creality-k2-plus.ini`; add a post-slice assertion in `moonraker-push.ts` that the file contains a `; thumbnail begin` block; warn the user if not. One afternoon.
2. **Wire undo/redo into the keyboard shortcut table** (`src/shared/app-keyboard-shortcuts.ts`). The `UndoManager` engine works; it has no Ctrl+Z global binding registered in the table or `matchesUndo()` helper. Add Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z, wire to `useUndo` in `ShopApp.tsx`. 1–2 hours.
3. **Recent-projects MRU list on splash** (`EnvironmentSplash.tsx`). `lastProjectPath` already persists; add an MRU-of-5 in `appSettingsSchema` and render as clickable cards. 2–3 hours.
4. **Klipper G-code header validation** (Gap #8). Extend `gcode-header-read.ts`. Tests already exist; new test plus tiny IPC return field plus toast in the renderer.
5. **Settings → "Network & Printers" subsection** with Moonraker URL + API-key + "Test connection" button (calls existing `moonraker:status`). 2–3 hours; massively improves first-run UX for K2.

---

## 5. Big bets (L/XL effort that close the gap)

1. **Full K2 Plus calibration suite (Gap #4)**. Ship the five Orca calibration tests as one-click jobs in a new "Calibrate" sub-tab under Manufacture. The G-code is parametric (start/end temps, step, etc.) so this is mostly UI + parameter forms feeding Orca CLI with bundled test STLs. **Impact**: makes WorkTrack3D the *only* desktop CAM+slicer that does this for the K2 Plus. **Effort**: 1–2 weeks.
2. **True-shape nesting for Laguna sheet jobs (Gap #9)** — **v1 SHIPPED 2026-05-27**. v1 is a from-scratch bottom-left-fill (BLF) routine in `src/main/nesting/true-shape-v1.ts` with axis-aligned bounding-box overlap (no external libs ported, no license risk). It's exposed as the `nesting:nest-polygons` IPC and a Laguna-only "Nest parts on stock" button in `LagunaNestingPanel.tsx`. Honest v1 limitations: BLF over-reserves space for non-rectangular parts and ships only 0°/90° rotations. **v2 plan**: port SVGnest / Deepnest (MIT) NFP+GA into the existing module while keeping the `NestResult` / `Placement` contract stable; add a `nestVersion: 'v1' | 'v2'` field so renderer can A/B diff. **v2 effort**: 1–2 weeks port.

---

## 6. Out-of-scope reminders (rejected per CLAUDE.md My-Shop-Only mode)

Each of these is a real competitor feature but is **explicitly out of scope** until the owner says otherwise. Logging here so future sessions don't accidentally reintroduce them.

- **Lathe / turning toolpaths beyond planning**. Mastercam and Fusion ship full turning. None of the three target machines turn. `cnc_lathe_turn` is intentionally planning-only (`manufacture-schema.ts:364`).
- **5-axis simultaneous post-processors for Fanuc / Siemens / Heidenhain**. We have the *strategies* (`cnc_5axis_contour/swarf/flowline`) for future hardware, but the existing `cnc_5axis_fanuc.hbs` and `cnc_5axis_siemens.hbs` posts cover machines none of the three target shops own. Do not add Mazak, Okuma, etc.
- **Swiss-style machining, wire-EDM, water-jet, plasma, additive metal (DED/LPBF), turn-mill**. All Mastercam capabilities. None apply.
- **Cloud profile sync, community gallery, MakerWorld-style model marketplace**. Bambu/Orca have it. Not requested.
- **AMS-specific UI** (only K2's CFS matters here — Bambu's AMS is a different protocol).
- **Generic "any FDM printer" machine support**. The K2 Plus is the only FDM target. Don't widen the machine selector.
- **Generic "any CNC controller" post**. Per CLAUDE.md "Stay strictly inside these three machines for every cycle." Mach3/RichAuto (Laguna), Smoothie/Carvera-Controller (Carvera), Klipper/Moonraker (K2) are the only ones that must work flawlessly.
- **Mobile / tablet UI**. Out of scope; this is a desktop Electron app.
- **Multi-user / cloud collaboration / version control integration**. Out of scope.

---

## Appendix: research sources

- Fusion 360 CAM strategies & WCS — [Autodesk: Defining Work Coordinate Systems](https://www.autodesk.com/support/technical/article/caas/sfdcarticles/sfdcarticles/Defining-Work-Coordinate-Systems-in-the-Fusion-360-CAM-Workspace.html); [Autodesk: Machining Fundamentals — Toolpaths](https://www.autodesk.com/products/fusion-360/blog/machining-fundamentals-toolpaths/)
- Mastercam 2026 features — [GMCCS PDF: What's New in Mastercam 2026](https://www.gmccs.de/downloads/pdf/mastercam/WhatsNew.pdf); [Mastercam: 5 Multiaxis Concepts](https://www.mastercam.com/news/blog/5-mastercam-multiaxis-concepts-you-need-to-know/)
- VCarve Pro — [Vectric: VCarve product page](https://www.vectric.com/products/vcarve/); [Vectric VCarve docs: Inlay Toolpath](https://docs.vectric.com/docs/V12.0/VCarvePro/ENU/Help/form/Create%20Inlay%20Toolpath/index.html)
- OrcaSlicer calibration — [GitHub: OrcaSlicer Calibration wiki](https://github.com/SoftFever/OrcaSlicer/wiki/Calibration); [Obico: OrcaSlicer Calibration Deep Dive](https://www.obico.io/blog/orcaslicer-3d-printer-calibration/)
- OrcaSlicer seam painter — [OrcaSlicer Wiki: Seam Painting](https://www.orcaslicer.com/wiki/print_prepare/prepare_seam_painting)
- Bambu Studio auto-orient — [Bambu Lab Wiki: Auto Orientation](https://wiki.bambulab.com/en/software/bambu-studio/auto-orientation)
- Bambu Studio plates — [Bambu Lab Wiki: Plates Management](https://wiki.bambulab.com/en/software/bambu-studio/plates_management)
- Orca vs Bambu vs Prusa — [Obico: Orca vs Bambu vs Prusa](https://www.obico.io/blog/orca-slicer-vs-bambu-studio-detailed-review-features-comparison/); [Zbotic: 2026 comparison](https://zbotic.in/orcaslicer-vs-bambu-studio-vs-prusaslicer-best-slicer-2026/)
- Klipper thumbnails — [Mainsail Docs: Thumbnails](https://docs.mainsail.xyz/overview/features/thumbnails)
