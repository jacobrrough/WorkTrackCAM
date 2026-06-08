# Shell / Context engine / access — Tool catalog & gap audit

**Environment:** Shell / Context engine / access (ribbon + command palette + viewport/nav chrome + browser + properties + shortcuts)
**Reference apps surveyed:** Autodesk Fusion 360 (workspace ribbon, ViewCube, Navigation Bar, marking menu, Browser, search/`S`-key Toolbox), VS Code (command palette mechanics), generic pro-CAD shell conventions.
**Repo:** `C:\Users\jrrou\3d software\WorkTrackCAM\.claude\worktrees\vigorous-ptolemy-568bae`
**Audited:** 2026-06-08 — read-only wave. Evidence cited as `path:line`.

This matrix catalogs the *shell scaffolding* that a Fusion-360-class app exposes — not the CAD/CAM tools themselves (those live in the sibling catalogs), but the chrome that makes tools reachable: the per-workspace ribbon with tabs/panels/overflow, the global command palette/search, the ViewCube + Navigation Bar + marking menu in the viewport, the Browser (model tree) and Properties/Inspector, the status bar, and the keyboard-shortcut system. Status legend: **have** = implemented + reachable in our running shell; **partial** = works but limited; **stub** = declared / UI-present but non-functional or decorative; **missing** = not present.

## How our shell is wired today (orientation)

- The sole shell is `WorkTrack3DApp` → `AppShell` (`src/renderer/app/AppShell.tsx`): a CSS grid of `TopBar` / `WorkspaceNav` / `WorkspaceHost` / `StatusBar`. The legacy ShopApp was retired at P5.
- **There is NO ribbon.** Navigation is a 6-item left rail (`WorkspaceNav.tsx`: Design · Assemble · Make · Drawings · Workshop · Utilities) that swaps the whole workspace body — not a tabbed ribbon of command buttons. The per-workspace *tool* surfaces (sketch/solid ribbon, CAM op list) live inside each workspace component (e.g. `DesignWorkspace.tsx`), not in a unified shell ribbon.
- **Two command palettes exist and they diverge.** The *live* one in the new shell is `NewShellCommandPalette.tsx` — it inlines a private copy of the palette and exposes only ~17 commands (6 nav + Settings + Help + 11 theme rows). The *catalog* palette `src/renderer/commands/CommandPalette.tsx` renders the 152-entry `FUSION_STYLE_COMMAND_CATALOG` with status badges / workspace / ribbon filters / recent-first — but it is **not mounted in the new shell** (`onPick` has zero production callers; only tests + `CommandCatalogPanel` reference it). So the rich catalog is effectively orphaned from the running app.
- **The functional 3D viewport is orphaned.** `src/renderer/design/Viewport3D.tsx` is a complete live viewport (drei `OrbitControls` + `GizmoViewcube`, an HTML ViewCube with ISO/Top/Front/Right/Home, a nav-mode strip Orbit/Pan/Zoom, Center/Snap/Lay-flat placement tools, animated standard-view fly-to) — but `<Viewport3D …>` is **never instantiated** anywhere (`grep` for the JSX tag returns no matches). The Design cockpit instead renders the *decorative* `ViewportChrome.tsx`, whose orbit/pan/zoom/section/measure buttons and viewcube/triad are explicitly "decorative placeholders (no handlers)" (`ViewportChrome.tsx:7-9`).
- Env theming works: `AppShell` sets `data-environment` and `themes.css:461-481` layers per-env accent over the active theme; 11 themes via `NewShellCommandPalette` theme rows + `SettingsDrawer`.

---

## Category: Ribbon mechanics (workspace-switching, tabs, panels, overflow)

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Ribbon mechanics | Workspace switcher (Design/Render/Animation/Sim/Manufacture/Drawing) | Fusion's top-left dropdown swaps the entire ribbon tab-set per workspace | **partial** | `WorkspaceNav.tsx` left rail (6 items: design/assemble/manufacture/drawings/workshop/utilities) | Keep rail; it is the workspace switcher. Add a ribbon *below* TopBar that reflects the active workspace | P0 |
| Ribbon mechanics | Ribbon tab strip (per-workspace tabs: Solid / Surface / Mesh / Sheet Metal / Plastic / Tools) | Horizontal tabs within a workspace, each revealing a different panel set | **missing** | none (workspaces render bespoke bodies; no shared ribbon component) | Build a `Ribbon` shell component driven by `CommandRibbonGroup`; tabs = ribbon groups for the active workspace | P0 |
| Ribbon mechanics | Ribbon panels (named groups: CREATE, MODIFY, ASSEMBLE, CONSTRUCT, INSPECT) | Labeled button clusters inside a tab; the org unit users learn | **partial** | `fusion-style-command-catalog.ts` *models* groups (`CommandRibbonGroup`, `fusionRibbon` hint) but no UI renders them as panels in the shell | Render catalog rows grouped by `ribbon` into panels; reuse `COMMAND_CATALOG_RIBBON_FILTER_OPTIONS` labels | P0 |
| Ribbon mechanics | Large vs. small button sizing / icon+label | Fusion uses one large primary button per panel + small stacked buttons | **missing** | none | Ribbon button component with `size: 'lg'|'sm'` variant | P2 |
| Ribbon mechanics | Split/dropdown buttons (e.g. Fillet ▸ Chamfer; Hole ▸ Thread) | A button with a caret that flyouts related commands | **stub** | `PlateTabs.tsx` has a split Slice button (Slice this / Slice all) — pattern exists but isolated to one panel | Generalize the split-button into the ribbon button kit | P1 |
| Ribbon mechanics | Panel overflow / "More" chevron | When a panel can't fit, Fusion collapses extras under a chevron | **missing** | none | Ribbon responsive overflow on resize | P2 |
| Ribbon mechanics | Contextual ribbon tab (sketch mode shows a green Sketch tab; selection shows a contextual tab) | A transient tab appears for the current modal context (Sketch, Form, CAM toolpath edit) | **missing** | none — sketch tools live in `DesignWorkspace`'s own strip, not a contextual ribbon tab | Drive a contextual tab off the active "stage" / modal command | P1 |
| Ribbon mechanics | Stage/sub-mode tabs (Model / Sketch / Inspect) | Fusion shows a Sketch contextual environment; mode strip | **stub** | `ViewportChrome.tsx:189` stage-tabs (Model/Sketch/Inspect) render but are "presentational selection state … body does not yet branch on them" (`ViewportChrome.tsx:14-18`) | Wire stage tabs to actually swap the center body / active tool set | P1 |
| Ribbon mechanics | Workflow-stage tabs (Prepare/Preview/Device or Setup/Toolpaths/Simulate/Send) | Slicers/CAM swap a stage strip per phase | **have** | `ManufactureWorkspace.tsx` `WorkflowStageTabs` (FDM: Prepare/Preview/Device; CNC: Setup/Toolpaths/Simulate/Send), roving tabindex | Keep; this is the closest thing to a ribbon we ship | P1 |
| Ribbon mechanics | Ribbon "File" app menu (New/Open/Save/Export/Recover) | Fusion's File menu at ribbon-left | **partial** | `TopBar.tsx` has New/Open/Save via shortcuts + `UtilitiesHost`→File; no single ribbon File menu | Add a File menu button in TopBar/ribbon collecting `ut_open/ut_new/ut_save/ut_import_3d/ut_export_stl` | P1 |
| Ribbon mechanics | Quick Access Toolbar (always-visible Save/Undo/Redo) | Fusion's tiny QAT above the ribbon | **partial** | Undo/Redo exist as shortcuts (`app-keyboard-shortcuts.ts:258-278`) but no visible QAT buttons in `TopBar` | Add Save/Undo/Redo icon buttons to TopBar (next to command/settings/help) | P1 |
| Ribbon mechanics | Ribbon display toggle (full / minimized / auto-hide) | Right-click ribbon → collapse | **missing** | none | Low priority until ribbon exists | P2 |
| Ribbon mechanics | Per-environment ribbon content (machine-aware tool set) | N/A in Fusion; our My-Shop need | **partial** | `registry.ts` `availableOpKinds` per env intersect `OPS_BY_MODE` in `LeftPanel.tsx` (legacy); new shell doesn't gate ribbon by env yet | When ribbon ships, filter ribbon groups by active `EnvironmentId` | P1 |

---

## Category: Command palette / search

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Command palette | Global palette open (Ctrl/Cmd+K) | VS Code Ctrl+Shift+P; Fusion has search; toggle modal | **have** | `AppShell.tsx:43` `matchesCommandPaletteToggle` → `setCmdOpen`; `TopBar` command icon | Keep | P0 |
| Command palette | Fuzzy search over ALL commands | VS Code/Fusion search every command by name | **partial** | Live palette (`NewShellCommandPalette.tsx:62`) filters only its ~17 nav/theme/app rows — NOT the 152-entry catalog | Feed `FUSION_STYLE_COMMAND_CATALOG` into the live palette (or mount the catalog palette) | **P0** |
| Command palette | Catalog palette over 152 commands w/ status badges + filters | Rich searchable command index | **stub** | `commands/CommandPalette.tsx` is fully built (status pill, workspace/ribbon filters, recent-first, PgUp/PgDn, Home/End, Tab-trap) but has **no production mount** — `onPick` never called outside tests | Mount it in the shell and route `onPick` → command dispatch | **P0** |
| Command palette | Recent commands first (empty query) | VS Code shows recently used | **partial** | Catalog palette implements it (`command-palette-memory` recentIds) but that palette isn't live; live palette has no recency | Bring recency to the live palette | P1 |
| Command palette | Keyboard nav inside palette (↑↓ / Home / End / PgUp / PgDn / Enter / Esc) | Standard | **partial** | Catalog palette: full set (`CommandPalette.tsx:160-200`). Live palette: only ↑↓/Enter/Esc (`NewShellCommandPalette.tsx:83-97`) | Unify on the catalog palette's keyboard model | P1 |
| Command palette | Workspace / ribbon-group filters in palette | VS Code category filter; Fusion none | **stub** | Built in catalog palette (`CommandPalette.tsx:226-268`) + `CommandCatalogPanel`; not reachable in shell | Surface filters when catalog palette is mounted | P2 |
| Command palette | Run command → actually executes the tool | Palette dispatches the command | **missing** | Live palette only navigates/themes; catalog rows in `CommandCatalogPanel.tsx:222` just emit a status string ("Use the matching workspace ribbon") | Build a command-dispatch registry mapping `command.id` → handler; this is the Context Engine's core | **P0** |
| Command palette | Command result shows keybinding + category meta | VS Code shows the hotkey on the right | **partial** | Catalog palette shows `workspace · fusionRibbon` meta (`CommandPalette.tsx:305`); no keybinding column | Add keybinding hint column sourced from `app-keyboard-shortcuts.ts` | P2 |
| Command palette | Command categories ("Go to", "Theme", "App") grouping | VS Code groups; section labels | **have** | Live palette groups by `group` (`NewShellCommandPalette.tsx:73-81`, `146`) | Keep grouping when expanding to full catalog | P1 |
| Command palette | Quick "Go to Workspace" entries | App-nav shortcuts in palette | **have** | `NewShellCommandPalette.tsx:223-234` one row per workspace | Keep | P1 |
| Command palette | Theme switch from palette | App-level setting via palette | **have** | `NewShellCommandPalette.tsx:259-270` one row per `THEMES` entry | Keep | P2 |
| Command palette | Settings / Help from palette | App actions | **have** | `NewShellCommandPalette.tsx:237-256` | Keep | P2 |
| Command palette | `S`-key / contextual toolbox search (Fusion) | Press `S` → searchable, pinnable command shortcut box near cursor | **missing** | none | Optional: a cursor-anchored quick-pick variant of the palette | P2 |
| Command palette | "Open recent file" in palette | VS Code recent files | **missing** | none (recent projects live elsewhere, not palette) | Add recent-projects rows once project session exposes a list | P2 |
| Command palette | Highlight matched substring in results | VS Code bolds the match | **have** | Live palette `hl()` `<mark>` (`NewShellCommandPalette.tsx:99-110`) | Keep | P2 |
| Command palette | Catalog discoverability panel (Utilities → Commands) | A browsable, filterable command index page | **stub** | `CommandCatalogPanel.tsx` exists + persists filters but is **not mounted** in `UtilitiesHost` (which mounts only `LibraryView`) | Add a Commands tab to `UtilitiesHost` rendering `CommandCatalogPanel` | P1 |

---

## Category: Viewport navigation & view controls (ViewCube + Navigation Bar)

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Viewport nav | Live 3D viewport with orbit/pan/zoom | The core CAD canvas | **stub** | Built in `Viewport3D.tsx` (drei `OrbitControls`, `Bounds`, `Grid`) but **never mounted** in the cockpit; `DesignWorkspace` shows a build-summary placeholder + decorative `ViewportChrome` | Mount `Viewport3D` in the Design cockpit center pane | **P0** |
| Viewport nav | ViewCube (faces/edges/corners snap to standard views) | Fusion top-right cube; click face/edge/corner → snap | **stub** | `Viewport3D.tsx:2` imports drei `GizmoViewcube` (functional, unmounted); `ViewportChrome.tsx:214` draws a *decorative* SVG viewcube (no handlers) | Use the live `GizmoViewcube`; delete the decorative one | **P0** |
| Viewport nav | Standard-view buttons (Top/Front/Right/Iso/Home) | Navigation bar / ViewCube faces | **stub** | `Viewport3D.tsx:532` HTML viewcube (ISO/T/F/R/Home) with `applyStandardViewAnimated` — fully built but unmounted; `ViewportChrome` has none | Surface via mounted `Viewport3D` HUD | **P0** |
| Viewport nav | Animated fly-to standard view | Smooth camera transition | **partial** | `applyStandardViewAnimated` + `Viewport3DCameraAnimator` exist (`Viewport3D.tsx:474-501`) but unmounted | Live once Viewport3D is mounted | P1 |
| Viewport nav | Orbit / Pan / Zoom mode toggle (Navigation Bar) | Fusion nav bar lets you pick a drag mode | **stub** | `Viewport3D.tsx:573` nav-mode strip (Orbit/Pan/Zoom, `aria-pressed`) — built, unmounted; `ViewportChrome.tsx:77-125` has decorative orbit/pan/zoom buttons (no handlers) | Mount the real nav strip; remove decorative buttons | **P0** |
| Viewport nav | Fit / Zoom-to-fit (F) | Frame all visible geometry | **stub** | drei `Bounds` wraps content in `Viewport3D` (fit capable) but unmounted; `ViewportChrome` "Zoom fit" button is decorative | Wire Fit to `Bounds` API + `F` shortcut | P0 |
| Viewport nav | Zoom window / box-zoom | Drag a rectangle to zoom | **missing** | none | Add to nav bar after viewport mounts | P2 |
| Viewport nav | Look-At (orient camera normal to a face/edge) | Fusion right-click → Look At; align to sketch plane | **missing** | `Viewport3D` has face-pick (`facePickMode`/`onPickFace`) but no Look-At camera align | Add Look-At using picked face normal | P1 |
| Viewport nav | Free-orbit vs. constrained orbit | Nav bar orbit submodes | **missing** | only single OrbitControls mode | Low priority | P2 |
| Viewport nav | Home view / reset camera | Nav bar home icon | **stub** | `Viewport3D.tsx:545-570` Home button (built, unmounted) | Live via mounted Viewport3D | P0 |
| Viewport nav | Axis triad / orientation gizmo (bottom-left) | Shows current XYZ orientation | **stub** | `ViewportChrome.tsx:269` decorative SVG triad (static, `aria-hidden`); `Viewport3D` `GizmoHelper` is the real one (unmounted) | Use `GizmoHelper`; drop decorative triad | P1 |
| Viewport nav | Perspective / orthographic toggle | Camera projection switch | **missing** | `Viewport3D` uses a PerspectiveCamera only | Add ortho/persp toggle to nav bar | P1 |
| Viewport nav | Camera roll / set-current-view-as-front | ViewCube context menu | **missing** | none | P2 |
| Viewport nav | Standard-view keyboard cube (numpad-style) | Some CAD bind 1–6 to views | **missing** | numbers 1–6 are bound to workspace nav (`app-keyboard-shortcuts.ts:70-106`), not views | Reserve a different chord for views to avoid collision | P2 |
| Viewport nav | Center-on-bed / Snap-to-bed / Lay-on-face (FDM/CAM placement) | Slicer/Bambu placement tools | **stub** | `Viewport3D.tsx:606-631` placement toolstrip (Center/Snap/Lay Flat) built; unmounted | Live once Viewport3D mounts in Manufacture/Design | P1 |

---

## Category: Viewport display / visual style

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Display | Visual style (Shaded / Shaded+Edges / Wireframe) | Fusion display-settings flyout | **missing** | `Viewport3D` renders shaded mesh only | Add display-settings menu to viewport HUD | P1 |
| Display | Ground plane / grid toggle | Fusion grid + ground reflections | **partial** | `Viewport3D.tsx:2` drei `Grid` always on (unmounted); no toggle | Add grid toggle when mounted | P2 |
| Display | Visibility toggle per body/component | Browser eye-icon | **missing** | FeatureTree shows ops, not visibility toggles | Add visibility column to Browser | P1 |
| Display | Isolate / hide-others | Right-click → Isolate | **missing** | none | P2 |
| Display | Section analysis (live clip plane) | Fusion Inspect → Section | **partial** | `ut_section` (`fusion-style-command-catalog.ts:966`) Y-clip via `sectionClipY` in `Viewport3D`; works when viewport mounted, but cockpit viewport is unmounted so currently unreachable in new shell | Mount viewport; expose Section in Inspect group | P1 |
| Display | Ground shadows / ambient occlusion / environment | Render-quality toggles | **missing** | none | P2 |
| Display | Camera / lighting presets | Render workspace | **missing** | none (no Render workspace) | P2 |
| Display | Selection highlight / hover pre-highlight | Faces highlight on hover, select tints | **partial** | `Viewport3D` `highlightedFaceId` + `selection-raycast.ts` face select exist; only live when viewport mounted | Mount viewport | P1 |

---

## Category: Marking menu / context menus

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Context menu | Radial marking menu (right-click, angle-based) | Fusion's signature right-click radial; non-customizable, position-memorized | **missing** | none — no radial menu anywhere | Build a radial marking-menu component for the viewport (context-sensitive by selection) | P1 |
| Context menu | Linear right-click context menu | Right-click row/canvas → list menu | **partial** | `ContextMenu.tsx` (full: items, separators, icons, shortcuts, danger, Esc, viewport-clamp) used in `LeftPanel`, `ToolLibraryPanel`, `LibraryView` (legacy/side panels) | Reuse `ContextMenu` for Browser + viewport selection menus in the new shell | P1 |
| Context menu | Viewport selection context menu (Edit/Delete/Suppress/Measure) | Right-click a body → contextual actions | **missing** | `Viewport3D` has no `onContextMenu` wiring | Wire `ContextMenu` to viewport raycast selection | P1 |
| Context menu | Browser/tree context menu (rename, suppress, roll-back, delete) | Right-click feature node | **partial** | FeatureTree has reorder/suppress/roll-back controls but not via a right-click menu | Add `ContextMenu` to FeatureTree nodes | P2 |
| Context menu | Marking-menu overflow → full list | Center of marking menu opens full menu | **missing** | none | Pair radial with `ContextMenu` fallback | P2 |
| Context menu | Repeat-last-command / recent commands on right-click | Fusion top of marking menu = recent | **missing** | recency tracked for palette only | Surface recent commands in the marking menu | P2 |

---

## Category: Browser / model tree (left panel)

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Browser | Document/feature tree (Origin, Bodies, Sketches, Components, Construction) | Fusion Browser — the canonical model tree | **partial** | `DesignWorkspace.tsx:1000` `FeatureTree` (operations + kernel timeline) in the cockpit left pane; not a full Origin/Bodies/Sketches hierarchy | Expand FeatureTree into folder groups (Origin/Sketches/Bodies/Construction) | P1 |
| Browser | Editable feature timeline (reorder / suppress / roll-back) | Fusion's bottom timeline + browser edits | **have** | `DesignWorkspaceHost.tsx:65-82` threads `kernelOps` + move/reorder/suppress/rollback into FeatureTree | Keep; strong differentiator | P1 |
| Browser | Visibility (eye) toggles per node | Show/hide bodies & sketches | **missing** | none in FeatureTree | Add eye column | P1 |
| Browser | Rename / activate / isolate node | Browser right-click | **missing** | none | Add via FeatureTree `ContextMenu` | P2 |
| Browser | Component/assembly tree with instances | Fusion assembly browser | **partial** | Assembly view exists (assemble route → assembly tab) with rows; not a unified browser | Unify assembly + part browser | P2 |
| Browser | Search/filter within browser | Filter the tree | **partial** | `ManufactureOperationList.tsx` has a filter bar for the op tree; FeatureTree has none | Add a filter input to FeatureTree | P2 |
| Browser | Drag-reorder in the tree | Drag features/components | **partial** | FeatureTree reorder is via move handlers (buttons), not HTML5 drag | Add pointer drag-reorder | P2 |
| Browser | Origin / datum planes node | Fusion Origin folder (XY/XZ/YZ) | **partial** | `Viewport3DDatumPlanes` + datum-pick exist in viewport; no Origin node in browser | Add Origin folder exposing datum planes | P2 |

---

## Category: Properties / Inspector panel

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Properties | Properties / parameter panel (right pane) | Fusion's right-side properties + Parameters dialog | **partial** | `DesignWorkspace` cockpit right pane `dc-props` = editable parameters as prop-cards + Save/Send-to-CAM (`DesignWorkspace.tsx:974`) | Keep; broaden beyond parameters to selection properties | P1 |
| Properties | Parameters table (user params, equations, units) | Fusion Modify → Change Parameters | **have** | `ut_parameters` (`fusion-style-command-catalog.ts:1002`) — Design ribbon Parameters group; export/merge `design-parameters.json` | Keep | P1 |
| Properties | Selection inspector (picked face/edge/body details) | Properties reflect current selection | **partial** | `selection-state.ts` + status badge + `selectionLabel` exist; `ViewportChrome` accepts `selectionLabel` for "a future toolbar read-out" (`ViewportChrome.tsx:37-42`) but doesn't render it | Render selection details in Properties when viewport mounted | P1 |
| Properties | Measure read-out (distance/angle/area) | Fusion Inspect → Measure | **partial** | `ut_measure` (`:957`) Shift+click two points; works only when viewport mounted (cockpit viewport unmounted) | Mount viewport; show measure in Properties/Inspect | P1 |
| Properties | Physical material / appearance assignment | Fusion Modify → Physical Material / Appearance | **partial** | `ut_material`/`ut_appearance` (`:984`,`:993`) are File→Project notes (name/density/finish), not true material assignment | Keep as notes for now (My-Shop scope) | P2 |
| Properties | Mass properties / bounding box read-out | Fusion Inspect → Properties | **missing** | none surfaced in shell | Add to Inspect/Properties | P2 |
| Properties | Inline edit-in-canvas dimensions (double-click) | Edit a value on the model | **missing** | none (dims edited in panel) | P2 |

---

## Category: Status bar / global chrome

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Status bar | Bottom status bar (units / coords / progress) | Fusion bottom bar; cursor coords | **partial** | `StatusBar.tsx` shows sidecar-ready / units / workspace / X/Y/Z + machine; **X/Y/Z are hard-coded `0.00`** (`StatusBar.tsx:36-43`) | Bind X/Y/Z to live cursor/selection once viewport mounts; bind sidecar status to real health | P1 |
| Status bar | Units selector (mm / inch) | Toggle document units | **stub** | `StatusBar` displays `units` prop but `AppShell.tsx:96` passes a literal `"mm"` — not switchable | Add a units toggle wired to project settings | P1 |
| Status bar | Live sidecar / engine health indicator | Connection/health dot | **stub** | `StatusBar.tsx:25` always shows "Sidecar ready" (static) | Bind to `python-bridge` health / heartbeat | P1 |
| Status bar | Progress / job activity (slicing, CAM, build) | Progress bar in status bar | **missing** | toasts only; no status-bar progress | Add a progress slot | P2 |
| Status bar | Machine status + E-stop | App-specific (our My-Shop need) | **have** | `TopBar.tsx:78-89` machine dot + name + E-STOP → `window.fab.machine.estop` | Keep | P0 |
| Status bar | Environment quick-switch (3 machines) | App-specific | **have** | `EnvSwitcher.tsx` 3-button (VCarve/Creality/Makera) in TopBar, variant memory | Keep | P0 |
| Status bar | Notifications / toasts | Transient feedback | **have** | `ToastContext` (`pushToast`) used throughout | Keep | P1 |
| Status bar | Title bar / project name + dirty indicator | Shows file + unsaved `*` | **partial** | `TopBar.tsx:70` shows `projectName` but `AppShell.tsx:88` hard-codes `"Untitled project"` — no real binding, no dirty flag | Bind to project session + add `*` dirty marker | P1 |
| Status bar | Online/account / sync status | Fusion Teams/cloud indicator | **missing** (intentional) | N/A — offline app | Out of scope | — |

---

## Category: Keyboard shortcuts & input

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Shortcuts | Global shortcut layer (palette, new/open/save, undo/redo, generate) | Standard app hotkeys | **have** | `app-keyboard-shortcuts.ts` matchers; wired in `AppShell.tsx:40-61` (palette/shortcuts/help/Esc) + workspace handlers | Keep | P0 |
| Shortcuts | Shortcuts reference dialog | VS Code/Fusion keyboard-shortcuts viewer | **have** | `KeyboardShortcutsDialog` via Ctrl+Shift+? (`AppShell.tsx:46`); `APP_KEYBOARD_SHORTCUT_GROUPS` data | Keep | P1 |
| Shortcuts | Workspace nav 1–6 | App-specific quick-switch | **have** | `app-keyboard-shortcuts.ts:70-106` — **NOTE the data still says "Jobs/Tools/Workshop/My Shop/Library/Settings" (legacy ShopApp labels), not the new Design/Assemble/Make/Drawings/Workshop/Utilities rail** | Update shortcut-group rows to match `WorkspaceNav` labels | P1 |
| Shortcuts | Editable/customizable keybindings | Fusion File→Keyboard Shortcuts; VS Code keybindings.json | **missing** | shortcuts are hard-coded matchers; no remapping UI | Add a keybinding editor (post-foundation) | P2 |
| Shortcuts | Undo / Redo | Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z | **partial** | matchers exist (`:258-278`); wired in some surfaces but no visible buttons + coverage varies by workspace | Centralize undo/redo via Context Engine + add QAT buttons | P1 |
| Shortcuts | Esc cancels active tool / clears picks | Universal | **have** | `AppShell.tsx:52` closes overlays; `Design` Esc clears measure/section/constraint (`app-keyboard-shortcuts.ts:184-195`) | Keep | P1 |
| Shortcuts | Generate / Slice (F5 / Ctrl+Enter) | Run the job | **partial** | `matchesGenerate` (`:247`) — "Jobs view only"; jobs view is legacy, so binding may be dormant in new shell | Re-point to Manufacture stage | P1 |
| Shortcuts | Design env switch (Ctrl+Shift+D) | App-specific | **have** | `matchesDesignEnvSwitch` (`:287`) | Keep | P2 |
| Shortcuts | Tab-strip arrow/Home/End roving focus | Accessible tab navigation | **have** | File + Manufacture tab strips (`app-keyboard-shortcuts.ts:132-167`) + `WorkflowStageTabs` | Keep | P2 |
| Shortcuts | Per-tool single-key hotkeys (L=Line, E=Extrude, D=Dimension) | Fusion sketch/solid hotkeys | **missing** | catalog has no per-command key bindings | Add a hotkey field to catalog commands; wire via Context Engine | P1 |
| Shortcuts | Numeric input / "press = to confirm" in-canvas | Fusion command dialogs accept typed values | **partial** | dialog inputs exist per tool; no canonical in-canvas numeric entry | Standardize a command-input convention | P2 |

---

## Category: Overlays / drawers / panels (shell windowing)

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Overlays | Settings/Preferences drawer | Fusion Preferences | **have** | `SettingsDrawer` (`AppShell.tsx:98`) — carries 10-theme picker | Keep | P1 |
| Overlays | Help panel | Fusion Help / Learning | **have** | `HelpPanel` via F1 (`AppShell.tsx:49,99`) | Keep | P2 |
| Overlays | Slide-over code drawer (CadQuery editor) | App-specific (text-CAD) | **have** | `DesignWorkspace` Code drawer toggled by `ViewportChrome` Code button (`ViewportChrome.tsx:164-185`, wired) | Keep | P1 |
| Overlays | Confirm / modal dialogs | Standard | **partial** | `TopBar` uses native `window.confirm` for E-stop (`TopBar.tsx:36`); `ConfirmDialog` exists elsewhere | Prefer in-app `ConfirmDialog` for consistency | P2 |
| Overlays | Dockable / resizable panels (drag splitters) | Fusion panels resize; pin/unpin | **missing** | grid panes are fixed-width; no splitters | Add resizable splitters to the cockpit grid | P2 |
| Overlays | Multi-document tabs (open several files) | Fusion document tabs | **missing** | single-project model | P2 |
| Overlays | First-run / welcome / onboarding | New-user splash | **partial** | `FirstLaunchWizard` exists (legacy); new shell is CAD-first with no splash (`AppShell.tsx:63-66`) | Decide whether to surface wizard in new shell | P2 |
| Overlays | Floating mini-toolbar near selection | Fusion's in-canvas toolbar on select | **missing** | none | Pairs with marking menu | P2 |

---

## Category: Context engine (the dispatch backbone)

| Category | Tool | What ref apps do | Our status | Reachable from | Access recommendation | Priority |
|---|---|---|---|---|---|---|
| Context engine | Single command registry (id → handler) feeding ribbon + palette + menus | One source of truth so a button, palette row, hotkey, and menu all run the same command | **missing** | `FUSION_STYLE_COMMAND_CATALOG` is **metadata only** (no `action`/handler field); ribbon (none), live palette (own 17 actions), `CommandCatalogPanel` (status string only), `DESIGN_RIBBON_COMMAND_IDS` set hints intent but nothing dispatches by id | Build a `CommandContext` registry: `{ id, run(ctx), enabled(ctx), keybinding }`; have palette/ribbon/menus all dispatch by id | **P0** |
| Context engine | Command enablement / context predicates | Commands grey out when not applicable (no selection, wrong workspace) | **missing** | no enablement model; catalog `status` ≠ runtime enablement | Add `enabled(ctx)` per command driven by selection/workspace/machine | P0 |
| Context engine | Active-context awareness (selection, workspace, machine, mode) | The app knows "a face is selected in Design on the K2" and routes accordingly | **partial** | selection (`selection-state.ts`), workspace (`useWorkspaceRouter`), machine (`MachineSessionContext`) exist as **separate** contexts; not unified into one command-context | Aggregate into a `useCommandContext()` the engine reads | **P0** |
| Context engine | Command → correct surface routing (deep-link to workspace + tool) | Palette "Extrude" jumps to Design and arms Extrude | **stub** | `DESIGN_RIBBON_COMMAND_IDS` (`fusion-style-command-catalog.ts:1087`) enumerates which ids should arm a Design tool, but no router consumes it in the new shell | Implement a dispatcher: id ∈ set → navigate(design) + arm tool | **P0** |
| Context engine | Repeat-last-command | Press Enter/G to repeat | **missing** | none | Track last command in engine | P1 |
| Context engine | Command history / undo integration | Each command is undoable | **partial** | undo/redo matchers exist but no command-journal | Route commands through an undoable journal | P1 |
| Context engine | Telemetry of unimplemented commands (honest "planned" UX) | N/A; our honesty rule | **partial** | catalog `status` (implemented/partial/planned) + `CommandCatalogPanel` badges communicate it, but only on the unmounted panel | When dispatching a `planned` command, show an honest toast | P1 |

---

## Top gaps

- **P0 — Mount the real viewport.** `Viewport3D.tsx` (live OrbitControls + drei `GizmoViewcube` + `GizmoHelper` triad + HTML ViewCube ISO/Top/Front/Right/Home + Orbit/Pan/Zoom nav strip + Center/Snap/Lay-flat + animated standard views) is fully built but **never instantiated** (`<Viewport3D>` has zero JSX call sites). The Design cockpit instead shows the *decorative* `ViewportChrome.tsx` whose nav/viewcube/triad buttons are explicit no-op placeholders. This one wiring change lights up the entire Viewport-nav and Display categories at once and removes a duplicate (two viewcubes, two triads, two orbit/pan/zoom sets).
- **P0 — Build the Context Engine command registry.** `FUSION_STYLE_COMMAND_CATALOG` (152 entries) is metadata with **no handler field**; nothing dispatches by `command.id`. The live palette has its own 17 hand-written actions; `CommandCatalogPanel` rows just print a status string ("Use the matching workspace ribbon when available"). Without a `{ id → run(ctx) }` registry + `enabled(ctx)` predicates + a unified `useCommandContext()` (selection ∪ workspace ∪ machine ∪ mode), the ribbon/palette/menus can never share commands. This is the keystone of the whole environment.
- **P0 — Reconcile the two command palettes; make the 152-entry catalog reachable & runnable.** The rich catalog palette (`commands/CommandPalette.tsx`: status badges, workspace/ribbon filters, recency, full keyboard model, Tab-trap) is **not mounted** (`onPick` has no production caller). The live `NewShellCommandPalette` searches only its own 17 rows. Mount one palette, feed it the full catalog, and route `onPick` → the Context Engine.
- **P0 — There is no ribbon at all.** `WorkspaceNav` swaps whole bodies; per-workspace tool buttons live inside bespoke workspace components. Fusion-parity needs a shell `Ribbon` (tabs = `CommandRibbonGroup`, panels = CREATE/MODIFY/… clusters, large/split buttons, overflow, contextual tabs) driven by the catalog + Context Engine. `COMMAND_CATALOG_RIBBON_FILTER_OPTIONS` already provides the group labels.
- **P1 — Marking menu + viewport/Browser context menus.** A full `ContextMenu.tsx` exists (used only in legacy side panels); the viewport has no `onContextMenu`. Fusion's signature radial marking menu is entirely absent. Wire `ContextMenu` into the (mounted) viewport selection + FeatureTree, then add a radial marking-menu component.
- **P1 — Status bar & title bar are faked.** `StatusBar` hard-codes X/Y/Z `0.00`, always-"Sidecar ready", and a literal `"mm"`; `TopBar` hard-codes `"Untitled project"` with no dirty flag. Bind these to live cursor/selection, sidecar health, project session, and units.
- **P1 — Mount `CommandCatalogPanel` in Utilities.** The browsable command index persists its filters but `UtilitiesHost` mounts only `LibraryView`; add a Commands tab so the catalog is discoverable in-app.
- **P1 — Shortcut data is stale.** `APP_KEYBOARD_SHORTCUT_GROUPS` "Navigation rail" rows still list the retired ShopApp labels (Jobs/Tools/My Shop/Library/Settings) instead of the new Design/Assemble/Make/Drawings/Workshop/Utilities rail; `matchesGenerate` is gated to the dormant "Jobs view". Per-tool single-key hotkeys (L/E/D…) and customizable keybindings are missing.
- **P1 — Browser lacks visibility toggles & Origin/Bodies/Sketches grouping.** `FeatureTree` shows ops + the (strong) editable kernel timeline, but no eye-icon show/hide, no Origin/datum node, no rename/isolate context actions — all standard Browser affordances.
