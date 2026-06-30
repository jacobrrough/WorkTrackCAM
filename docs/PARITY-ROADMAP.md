# Fusion-Parity Roadmap

Grounded scorecard from a 5-area code survey (2026-06-25). Percentages are **code-capability**;
user-**reachable** parity is materially lower because of orphaned (built-but-unwired) surfaces.

## Scorecard

| Workspace | Code parity | Note |
|---|---:|---|
| Manufacture (CAM) | ~65–70% | Strongest; near-full parity for the 3 shop machines. Gaps deliberate (no 5-axis/turning). |
| Drawings | ~60–70% | Ortho/iso/section/detail views, 7 dim types, 14 GD&T chars, title block, multi-sheet, BOM. No HLR, notes, DXF. |
| Solid modeling | ~45–55% | 30+ real kernel ops; ~15 have **no dialog**. No surface/direct-edit, no feature re-edit. |
| Sketch | ~45–50% | Inference + auto-constraints + 15 constraint types + solver. No construction geo, project, face-sketch. |
| Assemble | ~25–30% | Real 6-DOF mate solver, thin UI. No motion, bbox-only interference, one mate panel unreachable. |

**Overall:** ~50% (code) / ~40% (reachable) within the app's intended scope (design → drawing → CAM
for the 3 machines); ~25–30% against *all* of Fusion (which includes Render/Sim/Generative/Surface —
deliberately out of scope).

## The dominant theme

**The engine is consistently more capable than the UI exposes.** The expensive part (kernel, solvers,
posts) exists and works; much of the road to parity is *surfacing* capability, not creating it.

## Prioritized backlog (parity-per-effort)

### Tier 1 — Wire orphaned engine work to the UI (cheap, high reachable-parity gain)
- ✅ **DONE (16 params-only solid feature dialogs)** — Move/Copy, Mirror, Split Body, Rectangular/
  Circular/Linear Pattern, Add/Cut/Intersect Box, Cut Cylinder, Thread, Thicken, Coil, Rule Fillet,
  Boss, Lip/Groove. Each: params dialog + pure `build<Op>()` + DOM interaction test + op-builder
  schema test; reachable from the data-driven Design ribbon. Built by the `tier1-feature-dialogs`
  fan-out wave, independently verified (typecheck, test:dom 66, npm test 17415).
- ✅ **DONE (selection-heavy solid dialogs)** — press/pull, combine, pipe, pattern-along-path, sweep,
  on a reusable **profile/path picker** (`ProfileSelectField` / `PathSelectField` fed from the sketch
  via `profileOptions` / `pathOptions`): a labelled-dropdown upgrade over the blind numeric index.
  Each reachable from the ribbon; DOM + op tests per dialog. NOTE: `loft` is NOT a post-op dialog —
  it's a base-solid build mode (`loft_guide_rails` is a marker), set from the sketch profiles at base
  build, so it stays out of the feature-dialog set. A true viewport click-to-pick (highlighted profile
  selection) is the polish layer on top of the dropdowns (armSketchPlane pattern).
- ✅ **DONE (sketch offset + array) — was already wired.** The `SketchSurface` palette has the
  Offset / Boolean / Array buttons → `OffsetSketchDialog` / `ArraySketchDialog` → the pure modules
  (`offsetSketchEntities` / `rectangularArray` / `circularArray`) → `applyDesignEdit`. Now also
  DOM-interaction-tested (`SketchEditDialogs.dom.spec.tsx`); the roadmap entry was stale.
- ✅ **DONE (assembly mates) — already reachable.** The live mate surface is `AssemblyMatePanel`
  (3-vector point/axis/plane/distance mates), mounted on the assemble route, wired to `onMateAdded` →
  `runPersistMate` (assembly.json) and fed to the solver via `mateConstraints`. The V1.5 FACE-ID panel
  in `AssemblyView` is DEAD BY DESIGN (incompatible shape — its own comment says don't wire it), so the
  roadmap's "thread the V1.5 panel" was misguided. Open follow-up (not Tier-1): confirm a freshly
  persisted mate reaches the in-memory solver state without a reload.

**Tier-1 is CLEARED.** The remaining nicety is viewport **click-to-pick** for profile/path selection —
but the profiles live in the 2D SKETCH, not the 3D feature-editing view, so it's a Tier-2-sized
interaction problem; the labeled dropdowns are the functional Tier-1 answer.

### Tier 2 — Parametric depth
- **Feature re-edit** — timeline is append-only via dialogs (delete+re-add to change a fillet). Editable
  features is the core parametric-CAD expectation.
- ✅ **DONE (face-sketching)** — pick a model face → sketch on it → the solid builds on that face. The
  whole stack was already built + pinned (face-pick, `sketchPreviewPlacementMatrix`, kernel
  `_apply_placement`); the loop only broke because `DesignWorkspaceHost.onSketchPlanePicked` never
  persisted the picked plane. One-line fix (`withSketchFacePlane` + the host callback), pinned by
  `sketch-face-plane.test.ts`. Open follow-up: a "new sketch" inherits the last plane (no re-prompt).

### Tier 3 — Documentation / output
- Drawings: hidden-line removal (Tier B / OCC HLR), free-text notes, real DXF export (currently a stub).

## Verification gap (cross-cutting — see self-optimization plan)
No DOM/interaction test env and no app-driving harness, so "wired" ≠ "works." Closing this is the
precondition for trusting any Tier-1/2 work. Sidecar venv ready at `C:\Users\jrrou\wtcam-sidecar-venv`.
