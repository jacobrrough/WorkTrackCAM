# Fusion-Parity Roadmap

Grounded scorecard from a **6-area parallel code audit (2026-07-01)** — sketch, solid, assembly,
drawings, CAM, core UX — each verified against the live shell (reachable ≠ merely built).
Supersedes the 2026-06-25 5-area survey.

## Scorecard (2026-07-01)

| Area | Parity | One-line verdict |
|---|---:|---|
| Manufacture (CAM) | ~87% | Strongest. All 2D/3D/4-axis strategies real + posted; gaps are deliberate (thread-mill/scallop blocked) or frontier (true gouge check, G2/G3 at source). |
| Sketch | ~65–75% | Production-ready for 2D profiles: all entities, 15 constraints, driving dims, inference. Gaps: construction geo, project-model-edges, conflict naming. |
| Drawings | ~60–70% | Solid foundation + associativity. Notes/ordinate/baseline/chain are schema-ready with NO toolbar. HLR exists in sidecar but unused for export. DXF is a stub. |
| Solid modeling | ~55–60% | 21 wired dialogs + timeline (reorder/suppress/rollback/delete). **NO feature re-edit** — the core parametric gap. No user params/expressions, no hole wizard. |
| Assemble | ~40% | Real solver (all joints, 6 mate kinds, limits, over-constraint gating). Thin UX: no mate list/edit UI, motion poses computed but never animated, no limits form. |
| Core UX | — | Undo/redo, palette, themes, onboarding done. Missing: window-select, ortho toggle, autosave/crash recovery, edge/vertex pick (sidecar gap), right-click menus. |

**Overall:** ~60% code / ~50% reachable within intended scope (design → drawing → CAM for the
3 shop machines). The engine remains ahead of the UI; most parity is still *surfacing*, not building.

## Master plan — phased, parity-per-effort, shop-weighted

Rule of engagement: each improvement cycle takes 2–4 items from the **lowest unfinished phase**,
runs the full gates, and checks items off here. Effort: S(<1d) M(1–3d) L(3d+).

### Phase 1 — "Feels professional" (highest value ÷ effort)
- ✅ **Feature re-edit (M-L)** — ✎ on timeline rows opens the REAL dialogs pre-filled for 24 op
  kinds (`featureDialogSpecForOp`), schema-gated `GenericOpEditor` covers the rest (picked-id /
  profile-path / sheet ops — deliberate, so ids never silently drop). `updateKernelOpAt` +
  `update` TimelineAction, replace-in-place, DOM-spec-proven. *(done 2026-07-01, wave 1)*
- ✅ **Ortho ⇄ perspective toggle + fit-to-view (S)** — CameraRig camera swap with exact
  scale-preserving zoom⇄distance math (viewport3d-camera-fit.ts); fit frames the bounding sphere
  along the current view direction. *(done 2026-07-01, wave 1)*
- ✅ **Drawings: notes + leaders toolbar (S)** — one-click place (snap → leader note, free → float),
  edit/delete/clear, re-anchor + dangling badge, client-side SVG with escaping trust boundary.
  Persistence threaded through DesignWorkspace → drawing.json. *(done 2026-07-01, wave 1;
  aligned-dimension orientation UI deferred)*
- ✅ **Sketch: construction-geometry toggle (M) + collinear toolbar button (S)** — optional
  `construction` flag, dashed render, excluded at all 3 derivation sources (kernel profiles,
  cam-2d-derive contour/drill, preview mesh) — gcode-safety-verified remove-only. Collinear
  resolves 2 line-like selections → two 3-point constraints. *(done 2026-07-01, wave 1; X-key
  shortcut deferred)*
- ✅ **Autosave + crash recovery (M)** — the sketch design model was the fully-volatile piece
  (lost even on route switch); now 2s-debounced + 30s-floor snapshots to userData/recovery/
  (atomic, hashed name, Zod-gated), with a strictly-gated restore BANNER (newer-than +
  content-differs; never auto-applied — Cycle-249 lesson pinned). *(done 2026-07-01, wave 2)*
- ✅ **CadQuery script buffer disk persistence (S-M)** — Save now writes `design/script.cq.py`
  (atomic, path-contained, 2MB cap) via new `designScript:*` IPC; project-open seeds from disk
  (pristine-buffer gate — Cycle-249 safe); crash recovery snapshots + Restore/Discard offer reuse
  the wave-2 recovery pattern. *(done 2026-07-02, wave 4)*
- ✅ **Save polish (S)** — dirty-state Save button (disabled when saved, dot+title when dirty; the
  double-toast removed), Ctrl+S/Cmd+S wired + documented in the shortcuts dialog, hole summaries
  enriched (cbore/csink/tap in the timeline). *(done 2026-07-02, wave 6 — PHASE 1 COMPLETE)*

### Phase 2 — Selection & viewport depth
- ✅ **Window/box select (L)** — Shift+left-drag rectangle (capture-phase, OrbitControls untouched),
  crossing semantics, both projections, Ctrl/Cmd-click toggles; multi-face selection normalizes to
  the classic single shape so all consumers held. Batch kernel ops on the full set are a follow-up
  (dialogs act on the primary pick). *(done 2026-07-01, wave 3)*
- ✅ **Sidecar edge emission (engine half)** — stable per-edge polylines (`e:<fnv1a64>` ids,
  sagitta-bound sampling at face tolerance, 20k-point cap with honest `edgesTruncated`) ride
  tessellate_with_ids AND execute_script; protocol guards + typed bridge; validated on real
  geometry in the 3.11 venv. *(done 2026-07-01, wave 3)*
- ✅ **Edge picking in viewport (renderer half, M-L)** — edge polylines render as raycastable
  LineSegments (edge mode only, never steal face clicks); click → stable edge id; Ctrl/Cmd
  accumulates a multi-edge set; Fillet/Chamfer consume ALL accumulated edges via the tiered
  `resolvePickedEdgeIds` (Tier-2 signature recovery + honest lost-count); `edgesTruncated`
  surfaces a toast. *(done 2026-07-02, wave 4)*
- ✅ **Right-click context menu in viewport (M)** — selection-aware (face → sketch-on-face/shell/
  press-pull, edge → fillet/chamfer, camera section always), items derive from the SHARED command
  registry (`deriveViewportContextMenuItems` + `runCommand`), 5px drag threshold preserves
  right-drag pan, full menu a11y. *(done 2026-07-01, wave 2)*
- ✅ **Sketch over-constraint conflict naming (M)** — leave-one-out Jacobian-rank blame
  (newest-first, ≤200-constraint cap, honest `unresolved`/`too-large` verdicts), HUD names the
  culprit + one-click Remove (single undo step), err-styled canvas glyph, auto-constraint skip
  hints name the blocker. *(done 2026-07-01, wave 3)*

### Phase 3 — Parametric depth
- ✅ **User parameters + expressions (L)** — hand-rolled tokenizer/parser/evaluator (no eval;
  errors-as-values; cycle detection naming the chain), additive `userParameters` on the design,
  FeatureTree Parameters panel (add/rename-cascade/edit/delete-blocked-when-referenced), sketch
  dims re-resolve + re-solve on param edit; last-good cache so a typo never zeroes geometry.
  Threaded through host -> Properties pane. *(done 2026-07-02, wave 5)*
- ✅ **Hole wizard (M)** — holeType simple/counterbore/countersink (+ tapDesignation metadata) on
  hole_from_profile; real kernel recess geometry in build_part.py (guards: recess dia > hole dia,
  warn + straight-bore fallback, never crash); dialog works in create AND wave-1 edit mode;
  analytic-volume Python tests + byte-identical legacy STL pin. *(done 2026-07-02, wave 5)*
- ✅ **Feature-timeline undo/redo (M)** — timeline-scoped UndoManager in DesignSessionProvider;
  all 7 timeline editors route through `undoableCommit` (inverse folds replay through the SAME
  validated commitKernelFeatures chain — never a raw state poke; single-write race pins hold);
  per-index update coalescing; Ctrl+Z routing yields to the sketch surface when mounted.
  *(done 2026-07-02, wave 4)*
- ✅ **Project model edges into sketch (L)** — Fusion's Project (P): model edge polylines project
  onto the active sketch plane (reusing the face-sketch placement math) as construction reference
  geometry (snappable/dimensionable, never cut geometry); idempotent re-projection via
  deterministic proj_<edgeId> ids; one undo step. Static copies (no live associativity — honest
  limit; manual re-Project refreshes). *(done 2026-07-02, wave 6 — PHASE 3 COMPLETE)*
- ✅ **Multi-format design export (M)** — STEP/3MF (+ formats the exporter really has) beside STL;
  STEP writes true B-rep (round-trip re-import proven: volume + bbox), 3MF structure-checked;
  format whitelist + path validation (Rule 4); Send-to-CAM STL path untouched.
  *(done 2026-07-02, wave 5)*

### Phase 4 — Assembly UX
- ✅ **Motion-study playback (M)** — scrub slider + play/pause + joint-scalar readout; interpolated
  poses (shortest-path angle lerp) as a view-only overlay, never persisted. Also FIXED the
  simulate input dropping the joint kind (poses were all identical). CAVEAT: AssemblyView has no
  live 3D mesh viewport yet — playback animates row placements/readouts; `playbackOverlay` is the
  ready transform source when a real assembly viewport lands. *(done 2026-07-01, wave 2)*
- ✅ **Assembly 3D viewport (M-L)** — real R3F scene: per-part transforms, motion playback
  ANIMATES the parts (consumes the wave-2 playbackOverlay contract), interference pairs tint err,
  explode slider, grounded styling, row↔viewport highlight sync; node-env guard degrades to the
  summary placeholder (all pins held). HONEST LIMIT: parts render as labeled nominal schematic
  boxes, not real meshes. *(done 2026-07-02, wave 6)*
- ✅ **Assembly viewport real meshes (M)** — per-part geometry descriptors (real mesh / true AABB /
  nominal-box fallback, tiered with a 200k-triangle budget + honest HUD "N of M schematic" count),
  threaded from the live tessellation's per-handle bbox (view-only memo, auto-prunes); the
  transform/playback/interference pipeline is tier-independent (pinned). *(done 2026-07-03, wave 7)*
- ✅ **Mate list/edit/delete panel (M)** — Mates section in AssemblyView: kind/parts/scalar rows,
  DELETE + scalar EDIT + SUPPRESS (solver skips suppressed — proven via save->load->solve residuals),
  dangling flags, shared EmptyState; persists through the same serialized mate chain authoring
  uses. *(done 2026-07-02, wave 5)*
- ✅ **Joint limits authoring UI (S)** — per-DOF min/max editor on limitable joint rows
  (validated, clear-to-unlimited), persisted through the solve seam; authored limits now thread
  into BOTH assembly:solve clamps and assembly:simulate sweeps (the "LIMIT COUPLING" gap closed —
  motion playback sweeps the real authored range). *(done 2026-07-02, wave 4)*
- ✅ **Copy/mirror component + visibility toggles (M)** — per-row Copy (distinct instance, offset,
  shared body), Mirror-position across XY/XZ/YZ (honestly position-only — full geometric mirror
  needs a reflected mesh, filed), and an eye toggle (view-only, distinct from suppress: hidden
  stays in solve/BOM). Persists through the same setAssemblyParts seam add uses. *(done 2026-07-03,
  wave 7)*
- ✅ **External STEP part import as component (L)** — "Import STEP…" → file dialog →
  path-validated (traversal/null-byte/ext/size-cap) `assembly:importStepPart` IPC → cad.import_step
  → tessellate → distinct component carrying the durable stepPath. In-session reachable + persists
  its path. Wave 8 completed the round-trip: durable geometrySourceRef (stepPath + cachedBounds)
  now persists→hydrates, a new `assembly:fileExists` IPC drives an honest dangling badge on reload,
  and per-part visibility persists. *(done 2026-07-03, waves 7–8)*
- ✅ **Free-body SE(3) rotation (L)** — a free (no-joint) body carries full SE(3): 3 rotational DOF
  wired ONLY when an orientation mate constrains it, so an angle/tangent mate on a free body now
  converges while an unconstrained body provably stays at identity (zero spurious spin — every
  prior converging solve is byte-identical). Wave 8 added the explicit stability-proof test layer
  the deferral demanded. *(done 2026-07-03, wave 8 — PHASE 4 COMPLETE)*

### Phase 5 — Drawings output
- ✅ **Ordinate/baseline/chain toolbar (M)** — run-style placement (prime datum, then click-click
  minting), origin reuse across axis switch, setId stacking, proper client-side callout rendering
  (replaced the degraded sidecar-distance fallback), plus a NEW per-item delete list covering all
  7 dimension kinds. *(done 2026-07-01, wave 3)*
- ✅ **Centerlines + center marks (S-M)** — one-click center mark (center-kind snap priority),
  two-click centerline (chain dash, extended past anchors), associative re-anchor + dangling,
  lossless drawing.json round-trip. *(done 2026-07-01, wave 2)*
- ✅ **HLR for orthographic projections (M)** — includeHlr on cad.project_drawing runs the true
  HLRBRep pipeline (visible solid / hidden dashed layer); false path byte-identical (test-pinned);
  DrawingView "Hidden lines" toggle + state-aware fidelity caveat. Orchestrator reconciled the
  cad:projectDrawing IPC (single-view {handle,view,includeHlr} variant added beside the sheet
  envelope) so the toggle is live end-to-end. *(done 2026-07-02, wave 6)*
- ✅ **Real DXF export (L)** — R12 ASCII DXF now carries the drawing's real annotation content:
  projection LINE/LWPOLYLINE (+ HIDDEN layer), notes/GD&T/dimension read-outs as TEXT, dimensions
  as exploded primitives (honest — not associative DIMENSION entities), center marks/centerlines as
  CENTER-linetype LINEs; proper layers + linetype table + mm units header; escaped, byte-stable.
  Surface-finish glyphs omitted (no faithful R12 primitive — honest). *(done 2026-07-03, wave 7 —
  the top shop-ROI drawing item; feeds lasers/other CAM)*
- ✅ **Hole table (M)** — sidecar cylindrical-face scan (axis ∥ view → circle), coaxial grouping
  (counterbore tabled once), projected into the view's frame so tags land on the holes; deterministic
  tags; persisted + on-sheet table + tag markers; venv-verified against the real HLR projection.
  *(done 2026-07-03, wave 8 — PHASE 5 COMPLETE)*
- ✅ **Surface-finish in DXF (S)** — the wave-7 honest omission closed: ISO 1302 check-mark as real
  LINE/CIRCLE composite + Ra/lay TEXT on the ANNOTATIONS layer; byte-stable (no-finish docs
  unchanged). *(done 2026-07-03, wave 8)*

### Phase 6 — CAM frontier (already strongest; polish last)
- ✅ **G2/G3 arcs at adaptive source (M)** — trochoid loops emit native G3 semicircles (G17 I/J, no
  R-word, planar); the ~6 arc-blind geometric SAFETY audits were rewritten to interpolate the arcs
  (mutation-proven non-vacuous: they catch island/engagement/containment violations on the arc
  points); byte-identical outside the trochoid loops; gcode-safety SAFE for Laguna + Carvera-3.
  *(done 2026-07-03, Phase 6 Change 1)*
- [ ] **True waterline/adaptive via OCL in bundled venv (env/M)** — install into the 3.11 sidecar
  venv; fallback chain already honest. NOTE: an ENV/bundling step (pip install, may fail on-platform), not a code change — an operator action, not autonomous-appropriate.
- [ ] **True gouge detection (L)** — SDF/BVH toolpath-vs-model check (voxel approximation today).
- ✅ **Helical/orbital entry for POCKET (M)** — offset-spiral + adaptive delegate entry to the proven
  region-clamped, never-degrade `buildEntryMoves` helix (the adaptive fully-buried region core no
  longer straight-plunges); byte-identical for non-helix entry; gcode-safety SAFE for Laguna +
  Carvera-3. Face descoped (no containment ring — filed). *(done 2026-07-03, Phase 6 Change 2)*

### Explicitly out of scope (do not build)
5-axis, turning, thread-mill + scallop engines (dead-engine gated), 3D sketch, surface/NURBS
workbench, render/sim/generative — per CLAUDE.md machine scope and the 2026-05-27 pivot.

## Verification bar (unchanged)
"Wired" claims require: typecheck + full node suite green, a DOM interaction spec for any new
dialog/tool (`npm run test:dom`), and honest logging in `.claude/improvement-log.md`. G-code-adjacent
changes invoke the gcode-safety skill. The operator hands-on pass on real hardware remains the
final gate before "ready."
