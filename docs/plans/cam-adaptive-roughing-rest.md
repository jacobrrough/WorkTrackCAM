# CAM Phase — Adaptive/HSM Roughing + Rest Machining

**Status:** in progress (2026-06-08). Agent-orchestrated, executed as 4 sequential "stacks"
(Map → Build → Wire → Verify), full quality gates + the `gcode-safety` skill between G-code stacks.

## Why this phase

A 3-agent map of the CAM engine found that of ~30 advertised operation kinds, only ~17 are real:

- **Dead stubs that hard-error** (the v4.0 `toolpath_engine` was deleted in the 2026-05-27 pivot but
  the UI still offers them): `cnc_trochoidal_hsm`, `cnc_spiral_finish`, `cnc_morphing_finish`,
  `cnc_steep_shallow`, `cnc_scallop_finish`, `cnc_5axis_*` (×3), `cnc_auto_select` → all route to
  `tryToolpathEngine()` ([cam-runner.ts:745](../../src/main/cam-runner.ts)) which always fails.
- **Strategies that silently fake it**: `cnc_adaptive` advertises "constant-engagement adaptive
  clearing" but actually runs OCL **AdaptiveWaterline** (Z-level waterline). `cnc_pencil` claims
  "Laplacian curvature" but is OCL raster with a tighter stepover. `cnc_3d_finish` scallop is just
  stepover arithmetic.
- **Solid:** all 2D paths, the entire 4-axis Carvera engine (`src/main/cam-axis4/`), all 3 machine
  posts. Rest machining is a 2.5D heuristic (re-reads prior G-code) — not a real stock model.

The #1 Fusion/Mastercam gap for the in-scope **3-axis machines (Laguna Swift, Carvera 3-axis)** is
**real adaptive/HSM roughing** + **rest machining**. They share an in-process stock model, so they
pair naturally.

## Architecture decision

- **Pure TypeScript**, mirroring the gold-standard `src/main/cam-axis4/` module. Reviving the deleted
  Python CAM engines (`engines/cam/advanced`, `toolpath_engine`) is **off-limits** per CLAUDE.md.
- Stock model lives in `src/shared/` (pure, no I/O — matches `cam-heightfield-2d5.ts`,
  `stock-simulation.ts`). The roughing/rest **engine** lives in `src/main/cam-adaptive/` (does file
  I/O + `renderPost`, like `cam-axis4/`).
- G-code flows through the existing `renderPost` pipeline + its header/end-program/safe-Z validators.

## Stacks

| Stack | Deliverable | Module | G-code | Status |
|---|---|---|---|---|
| **A** | In-process stock model (IPW) — queryable remaining-stock, reuses `cam-heightfield-2d5` primitives | `src/shared/cam-stock-model.ts` + `cam-stock-part-section.ts` | none | building |
| **B** | Adaptive/HSM roughing — engagement-bounded clearing + trochoidal corner relief + helical/ramp entry; replaces fake `cnc_adaptive`, real engine for `cnc_3d_rough` / `cnc_trochoidal_hsm` | `src/main/cam-adaptive/` | **yes** | blocked on A |
| **C** | Rest machining — leftover detection on the stock model after a larger-tool op; upgrades the `usePriorPostedGcodeRest` heuristic | `src/main/cam-adaptive/rest.ts` | **yes** | blocked on A,B |
| **D** | Honesty (hard-block out-of-scope 5-axis ×3 + auto-select so they stop hard-erroring; truth-align hints) + wire new params into Manufacture UI + simulation + docs/log | policy, UI, docs | low | blocked on B,C |

## Stack B reuse map (so the engine reuses, not reinvents)

**Reusable as-is:**
- Per-Z inset slicing: `horizontalSegmentsInsideInsetRing` (cam-local.ts:717), `ringBounds` (591),
  `pointInRing2d` (631), `minDistanceToRingEdges` (654), `distancePointToSegment2d` (643)
- Entry moves: `generateRampEntryLines` (cam-local.ts:773, linear+helix), `minRampRunForMaxAngleDeg` (573)
- Mesh part-floor sampling: `heightAtXyFromTriangles` (cam-local.ts:100), `buildTriangleBucketGrid`
  (165) + `heightAtXyFromBucketGrid` (222), `zOnTrianglePlane` (82), `pointInTriangle2d` (63)
- Depth sequencing: `computeNegativeZDepthPasses` (cam-local.ts:750)
- G-code emit: `Emitter` class (cam-axis4/emit.ts:46) — strip A-axis for 3-axis; 3-decimal fixed,
  modal F, safe-Z rapid → plunge
- Stock carving input: `ToolpathSegment3` + `extractToolpathSegmentsFromGcode` (cam-gcode-toolpath.ts:122)
- Post: `renderPost` (post-process.ts)
- Types: `CamPoint2d` (cam-local.ts:492), `Vec3` (stl.ts:79)

**Must implement (the actual new IP):**
1. Engagement-bounded peel ordering — order inset rings; switch to trochoidal relief where cutter
   engagement would exceed the limit.
2. Trochoidal corner-relief loops (circular/cycloid motion in tight corners / full-width slots).
3. Chip-thinning feed scaling — adjust feed when radial engagement drops (no reverse-scallop helper
   exists today; note `chipThinningAdjustedFeedMmMin` is referenced in cam-runner.ts — locate/reuse).
4. (Optional) arc synthesis for smooth offset-to-offset transitions.

**Licensing:** all geometry is custom inline TS; no vendored clipper/CGAL — no copyleft risk.

## Safety gates (every stack)

- Pre/post `npm test` + `npm run typecheck`; no regression in pass count (baseline 14,854 pass / 2 skip).
- Stacks B & C: run the **`gcode-safety` skill** against emitted G-code for Laguna + Carvera before
  marking done (finite coords, feeds on cut moves, safe-Z retracts, bounded plunge angle, no XY rapid
  at cut depth). Verify against known-good post output.
- Schema changes need migrations (operation `params` are already an open record — additive only).
