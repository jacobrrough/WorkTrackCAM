# Master Plan — Dynamic, Machine-Adaptive App (Fusion-style context engine)

**Status:** proposed (2026-06-08). Awaiting go-ahead before the build fleet launches.
**Vision:** one app whose toolset morphs by **context = (workspace × active machine × selection)**, like
Fusion 360's workspace ribbon. CAD shows modeling tools; entering Manufacture reshapes the whole app to
the **active machine**:
- **Creality K2 Plus** → a Creality-Print / OrcaSlicer-grade **FDM slicer**.
- **Laguna Swift 5x10** → a **VCarve-grade** 2.5D sign/sheet CAM.
- **Makera Carvera** → a **best-in-class 4-axis CAM** (better than what ships for it today).

Every tool reachable ≥2 intuitive ways (contextual ribbon + Ctrl-K command palette), plus browser/properties.
Constraints stay in force: **My-Shop-Only** (only the 3 machines), **gcode-safety** gate on every G-code
path, the CLAUDE.md quality gates, `docs/EDIT-WORKFLOW.md` for >800-line files, **no `any`**.

---

## A. Core architecture — the Context Engine (the keystone)

Everything hangs off one declarative mechanism, seeded from the existing
`src/shared/fusion-style-command-catalog.ts` (152 entries already):

- **Tool/Command Registry** — each tool is data:
  `{ id, label, icon, group, workspaces[], machineKinds[], component|handler, enabledWhen(ctx), accessPoints[] }`.
- **Context** = `{ workspace, machineKind ('fdm'|'router'|'mill4'), selection, projectState }`, derived from the
  active route + the TopBar machine/env switcher (which already drives `data-environment`).
- The shell renders, for the current Context:
  - **Contextual Ribbon** (top of the workspace) — tool groups + buttons that change with context.
  - **Command Palette** (Ctrl-K) — searchable over every context-available tool.
  - **Browser tree + Properties** — context-driven (Design = feature tree/feature props; CAM = setups/ops/params).
- **Machine switch re-tools + re-themes** the app. The Manufacture workspace already swaps FDM vs CNC stage
  tabs — we generalize that into a full env swap driven by the registry.

This is the first thing built, because every later tool just *registers* into it.

---

## B. The three machine environments (each its own sub-campaign)

### B1. Creality slicer dupe — K2 Plus (FDM)
Wrap the already-bundled **OrcaSlicer CLI** behind a native Creality-Print-style UI:
- Plate: add/remove plate, **auto-arrange**, multi-plate batch.
- Object: move/rotate/scale/mirror, **lay-flat / place-on-face**, **auto-orient**, plane-cut, boolean, duplicate.
- Supports: auto + **paint-on**, normal/tree, threshold/density/interface.
- Seam: **painter** + alignment.
- Process: layer height (+ adaptive), walls, top/bottom, **infill (density+pattern)**, speed, **temps
  (nozzle/bed/chamber)**, cooling, retraction, flow, brim/skirt/raft, ironing, fuzzy skin.
- Filament: type, temps, RFID, **CFS multi-color**, flush volumes.
- **Calibration suite**: temp tower, flow, pressure advance, max-vol, retraction, tolerance, VFA, input shaping.
- Preview: layer slider, color-by (speed/flow/type/layer), travel/seam, **time + filament estimate**, embedded thumbnail.
- Send: **Moonraker upload + start**, live status, power-loss recovery. (URL bug already fixed.)

### B2. VCarve dupe — Laguna Swift (2.5D sheet/sign CNC)
- Vectors: draw (line/poly/rect/circle/arc/curve/star/text), **node edit**, offset, fillet, trim/join/weld,
  mirror, array, measure; import **SVG/DXF/AI/PDF**; **trace bitmap**.
- Text & clip-art: text-on-curve, font library, clip-art.
- Toolpaths: **profile** (on/in/out + tabs + ramps + lead-in/out), **pocket** (raster/offset), **V-carve**,
  prism carving, fluting, drilling, **inlay** (male/female), texture, molding, quick-engrave.
- Sheet: **true-shape nesting** (v1 exists), material/stock, **6-zone vacuum**, sheet layout, tabs.
- 3D relief: import STL → roughing/finishing.
- Job: tool DB, feeds/speeds, origin, setup sheet, RichAuto Mach3 post (exists), simulation.

### B3. 4-axis CAM — Carvera (do it *better* than what ships)
- Setup: stock cylinder, rotary axis, **WCS (X offset to headstock, Y=0)**, tool DB + **ATC slots**, probing.
- 3-axis ops (shared CNC core): face, contour, pocket, drill, **adaptive/HSM** (CAM Stack B), parallel,
  scallop, pencil, rest (CAM Stack C).
- 4-axis ops (engine exists, `src/main/cam-axis4/`): rotary **roughing / finishing / contour-wrap / indexed
  (3+1) / continuous**, rotary engraving, spiral.
- **Wrapping**: 2D → cylinder, image/relief wrap.
- **Simulation**: 4-axis material removal + **chuck/tailstock collision** + gouge (infra exists).
- ATC tool change; probing (WCS / tool-length / rotary-center); Makera/Smoothie post (exists), setup sheet.

---

## C. Exhaustive tool catalog (seed — Phase 0 agents verify/complete)

This is the seed matrix the build fleet works from. Phase-0 research agents expand it to truly exhaustive +
audit each against our codebase (have / stubbed / missing / reachable-from-where).

**CAD / Design** — Sketch (line, rect, circle, arc, polygon, spline, ellipse, slot, point, text; constraints:
coincident/parallel/perp/tangent/equal/symmetric/horizontal/vertical/concentric/midpoint/fix; dimension; trim,
extend, offset, mirror, pattern, fillet, chamfer, project) · Create (extrude, revolve, sweep, loft, rib, web,
emboss, hole, thread, coil, pipe, primitives) · Modify (fillet, chamfer, shell, draft, scale, combine, split,
move/copy, align, press-pull, replace/offset/delete face) · Pattern (rect/circular/path/mirror) · Construct
(plane/axis/point/CSYS) · Assemble (joints: rigid/revolute/slider/cylindrical/pin-slot/planar/ball, as-built,
joint origin, rigid group, contact, motion) · Inspect (measure, interference, section, curvature, draft,
center-of-mass, properties).

**FDM slicer** — see B1 (plate, object, supports, seam, process, filament, calibration, preview, send).

**VCarve / 2.5D** — see B2 (vectors, text/clipart, 2.5D toolpaths, nesting, relief, job).

**4-axis CNC** — see B3 (setup, 3-axis, 4-axis, wrapping, simulation, ATC, probing, post).

**Shell / common** — viewport (orbit, pan, zoom, fit, **viewcube**, named views, section, measure, visual
styles, ortho/perspective, grid) · browser tree · properties · **parametric timeline** · undo/redo · units ·
snap · **command palette** · keyboard shortcuts · settings · marking/contextual menu.

---

## D. Multi-agent orchestration (the fleet)

**Orchestrator = the main loop** (me), running a sequence of **Workflows** (one per wave/sub-campaign), reading
each result and gating before the next. Each wave fans out; I run quality gates + gcode-safety between waves.

- **Wave 0 — Discover** (read-only): parallel *catalog* agents (research Fusion/Mastercam/VCarve/Orca per
  environment) + *audit* agents (map every tool to have/stub/missing/reachable in our code). → master matrix.
- **Wave 1 — Architect**: build the **Context Engine** (registry + contextual ribbon + palette wiring + env
  swap). One focused workflow; foundational.
- **Wave 2 — Build** (the "create/find tools" fleet): **one builder agent per tool or tool-group**, in
  parallel, each producing an isolated, typed, tested component/handler (no wiring yet). Worktree isolation
  where agents would touch the same files.
- **Wave 3 — Wire** (the "wire up created tools" fleet): wiring agents **register** each built tool into the
  Context Engine + palette + ribbon, set `enabledWhen`/access-points, and prove **reachability** (a tool that
  exists but can't be reached doesn't count — the project's "build + wire" rule).
- **Wave 4 — Verify**: adversarial agents — does it work, is it reachable ≥2 ways, tests green, and
  **gcode-safety** on every CAM path. Loop-until-dry on gaps.

Each of the **three CAM environments** is its own Build→Wire→Verify sub-campaign (run in sequence or
parallel per your priority). Design/CAD + the real viewport is the shared foundation, done first.

---

## E. Access & intuitiveness (non-negotiable)

- **Contextual ribbon** per workspace+machine (groups collapse/expand; icons + labels).
- **Command palette** (Ctrl-K) searches every context-available tool by name/synonym.
- **≥2 access paths per tool** (ribbon + palette; high-frequency tools also get a shortcut + viewport handle).
- Tooltips with shortcut hints; empty-states that point at the tool that fills them; the **My-Shop** quick
  machine switch. WCAG: keyboard-reachable, ARIA-labeled (the app already has ~398 aria attrs).

---

## F. Phasing & sequencing

0. **Discover** — master tool matrix + codebase gap audit (read-only fleet). *(safe to run now)*
1. **Context Engine** — registry + contextual ribbon + palette + env swap. Plus quick wins: **remove the
   redundant Part/Assembly/Drawing tabs** (nav already routes view-modes), make Properties **contextual**.
2. **Design/CAD foundation** — **mount the real `Viewport3D`** (replace the placeholder) so orbit/pan/zoom/
   viewcube/section/measure become real; wire the CAD ribbon (sketch + create + modify + inspect).
3. **CAM environments** (sub-campaigns, priority per your call): K2 slicer · Laguna VCarve · Carvera 4-axis.
4. **Cross-cut + polish** — palette/shortcuts/settings coverage, verification sweep, docs + CLAUDE.md, full gates.

**Incremental value**: each phase ships working, committed, gated. You see the app get more capable every wave.
