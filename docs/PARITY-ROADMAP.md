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
- [ ] **Autosave + crash recovery (M)** — periodic design-session snapshot + restore-on-launch offer.
  (Deferred from wave 1: touches DesignSessionContext concurrently with feature re-edit.)

### Phase 2 — Selection & viewport depth
- [ ] **Window/box select (L)** — drag-rectangle → frustum test → multi-face selection. The #1
  batch-operation friction.
- [ ] **Edge + vertex picking (L)** — sidecar `tessellate_with_ids` must emit per-edge polylines +
  stable edge ids (faceIds pattern exists); then fillet/chamfer pick edges in-viewport.
- [ ] **Right-click context menu in viewport (M)** — selection-aware shortcut menu (sketch-on-face,
  fillet, shell…); command handlers already exist in design-commands.ts.
- [ ] **Sketch over-constraint conflict naming (M)** — solver already rank-detects; surface WHICH
  constraint conflicts (highlight + HUD).

### Phase 3 — Parametric depth
- [ ] **User parameters + expressions (L)** — named params + `d1*2` evaluator feeding dialogs and
  sketch dims. Design-intent capture.
- [ ] **Hole wizard (M)** — counterbore/countersink/tap designation on hole_from_profile; kernel
  geometry in build_part.py.
- [ ] **Feature-timeline undo/redo (M)** — route append/remove/move/suppress through the existing
  undo-manager command classes.
- [ ] **Project model edges into sketch (L)** — face/edge extraction → plane projection → snappable
  reference geometry. ~25% faster complex sketches.
- [ ] **Multi-format design export (M)** — STEP/3MF/OBJ export beyond STL (sidecar exporters exist).

### Phase 4 — Assembly UX
- [ ] **Motion-study playback (M)** — assembly:simulate poses already computed; apply to viewport
  with a timeline slider.
- [ ] **Mate list/edit/delete panel (M)** — persisted mateConstraints are invisible today.
- [ ] **Joint limits authoring UI (S)** — schema + solver clamps done; needs min/max fields.
- [ ] **Copy/mirror component + visibility toggles (M)**.
- [ ] **External STEP part import as component (L)** — vendor hardware in assemblies.
- [ ] **Free-body SE(3) rotation (L)** — deferred from Cycle 276; destabilization risk documented.

### Phase 5 — Drawings output
- [ ] **Ordinate/baseline/chain toolbar (M)** — schema-ready; needs set-based pickers.
- [ ] **Centerlines + center marks (S-M)** — detect arcs/circles in projection.
- [ ] **HLR for orthographic export (M)** — cadquery_hlr.py pipeline exists; add includeHlr to
  cad.project_drawing + UI toggle.
- [ ] **Real DXF export (L)** — dimensions/GD&T/notes as DXF entities (currently frame + mesh only).
  Highest shop ROI in this phase: DXF feeds lasers/other CAM.
- [ ] **Hole table (M)** — topology scan for bored holes.

### Phase 6 — CAM frontier (already strongest; polish last)
- [ ] **G2/G3 arcs at adaptive source (M)** — today post-side arc-fitting only.
- [ ] **True waterline/adaptive via OCL in bundled venv (env/M)** — install into the 3.11 sidecar
  venv; fallback chain already honest.
- [ ] **True gouge detection (L)** — SDF/BVH toolpath-vs-model check (voxel approximation today).
- [ ] **Helical/orbital entry for face/pocket (M)** — tool-life win on Laguna sheet work.

### Explicitly out of scope (do not build)
5-axis, turning, thread-mill + scallop engines (dead-engine gated), 3D sketch, surface/NURBS
workbench, render/sim/generative — per CLAUDE.md machine scope and the 2026-05-27 pivot.

## Verification bar (unchanged)
"Wired" claims require: typecheck + full node suite green, a DOM interaction spec for any new
dialog/tool (`npm run test:dom`), and honest logging in `.claude/improvement-log.md`. G-code-adjacent
changes invoke the gcode-safety skill. The operator hands-on pass on real hardware remains the
final gate before "ready."
