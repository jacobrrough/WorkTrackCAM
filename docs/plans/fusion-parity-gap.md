# WorkTrack3D → Fusion 360 Parity — Gap Analysis & Roadmap

**Status date:** 2026-06-16
**Scope:** the three shop machines only (Creality K2 Plus FDM, Laguna Swift 5x10 router, Makera Carvera 3/4-axis). Per CLAUDE.md "My-Shop-Only Mode".
**Source:** a 5-domain audit of the *actual code + improvement log* (not the docs, which lag). Labels: **PRODUCTION** (real, tested, usable) / **PARTIAL** (works, limited) / **STUB** (scaffolding) / **MISSING**.

---

## Framing (read this first)

For the shop's real workflow — parametric CAD → CAM + FDM for these three machines — WorkTrack3D is **near parity and ahead of Fusion in several places** (FDM, 4-axis, nesting, no subscription). "Full Fusion parity across every workspace" (Render, FEA, Generative, Sculpt, PCB, cloud) is a *different and mostly irrelevant* goal for a one-operator shop. This doc tracks the gaps **that matter for the workflow**, prioritized — and the gaps Fusion has that we deliberately skip.

---

## Per-workspace status (audited)

| Area | State | One-line |
|---|---|---|
| Sketcher (entities + constraints) | ✅ strong | line/arc/circle/rect/slot + 12 constraints; live solver is a **custom 2D Newton** (not planegcs) → robustness/DOF-analysis gap |
| Part modeling | ✅ strong core | extrude/revolve/loft/fillet/chamfer/shell/holes/threads/patterns/booleans/split |
| Feature timeline | ✅ editable | move/reorder/suppress/roll-back live; **delete wired (Cycle 269)**; per-feature param-edit dialog is a follow-on |
| Surface / freeform (NURBS, T-spline/sculpt) | ❌ missing | solid + sketch only |
| Direct modeling (push/pull) | ❌ missing | all edits flow through features |
| Multi-body / configurations | ❌ missing | single body per design |
| Assembly (components, BOM, placement) | ✅ solid | instances, ground/fix, capture-position, BOM rollup |
| Assembly constraint solver | ⚠️ translation-only | point/axis/plane/distance/flush solve; **angle/tangent + revolute/slider motion need rotational DOF** |
| Interference | ⚠️ bbox-only | AABB overlap (false positives); no mesh/B-rep |
| Drawings | ◐ ~55% | views + section, full dimension set, **full GD&T (14 chars)**, BOM table, multi-sheet, PDF/DXF/SVG; HLR is silhouette-tier; detail/aux views + hole tables + surface-finish/weld symbols missing |
| **CAM 2.5D** (contour/pocket/drill/v-carve/chamfer) | ✅ **PRODUCTION** | contract-pinned + gcode-safety on all 3 machines |
| **CAM 4-axis** (indexed + continuous, Carvera) | ✅ **PRODUCTION** | contract-pinned; rotary chuck collision sweep |
| **CAM 3D finish** (parallel/raster, mesh-height) | ✅ **verified (Cycle 268)** | the always-on built-in finish is now posted-snapshot + gcode-safety pinned on both routers |
| CAM 3D — true Waterline / scallop / spiral / morphing | ⚠️/❌ | Waterline/adaptive/pencil need OpenCAMLib (absent → degrade to the verified parallel finish); scallop/spiral/morphing/trochoidal/steep-shallow were `toolpath_engine` stubs (deleted in the 2026-05-27 pivot) → clear error without an engine. **OCL scaffolding + crash-guard landed (Cycle 269)** — enable via `scripts/bundle-opencamlib.ps1` on the 3.11 venv |
| CAM verification (material-removal sim) | ✅ wired (Cycle 269) | voxel removal **heatmap in the Simulate view** from posted G-code; heatmap pixels need a hands-on Electron verify |
| Feeds & speeds, tool-holder collision, tool wear | ⚠️ stub | material library exists; no adaptive F/S calculator; holder geometry unmodeled |
| FDM / K2 (slice → Moonraker → monitor, CFS, calibration) | ✅ **PRODUCTION — exceeds Fusion** | OrcaSlicer bundled, presets, supports/infill, CFS slot, temp ceilings, direct Moonraker push + live print monitoring + calibration harness |
| Render · FEA/Simulation · Generative · Sculpt · PCB · Animation · Cloud/version-branching | ❌ absent | out of scope for a 3-machine shop |

---

## Gaps that matter for the shop (prioritized)

### Tier 1 — felt in daily use
1. **Editable feature timeline** — reorder / suppress / delete / (later) edit-and-rebuild. The #1 Fusion CAD differentiator. *(In progress.)*
2. **Verified 3D finishing** — ✅ **done (Cycle 268)** for the always-on parallel finish; true z-level Waterline + scallop remain follow-ons (need OpenCAMLib or new engines). *(OCL feasibility in progress.)*
3. ✅ **Click-to-select faces/edges** for fillet/chamfer — DONE (audit was stale): FilletDialog/ChamferDialog emit `fillet_select.pickedEdgeIds` from the live edge pick, mounted via FeatureDialogHost in DesignWorkspace.
4. **Material-removal simulation** in the CAM verify step — "simulate before you cut". *(In progress.)*

### Tier 2 — strong value, narrower
- Assembly rotational solver (angle/tangent mates + real revolute/slider motion).
- Direct push/pull editing.
- Adaptive feeds & speeds calculator (material library is already present).
- Drawings: hole tables, surface-finish + weld symbols, true HLR, detail/auxiliary views, sheet templates/sizes.
- Tool-holder / fixture collision detection (general BVH; today only Carvera rotary chuck is swept).

### Tier 3 — Fusion has it, skip unless explicitly wanted
NURBS/surface + sculpt/T-spline, FEA/simulation, render, generative design, PCB/electronics, product animation, multi-body configurations, cloud/version-branching/collaboration.

---

## Where WorkTrack3D meets or beats Fusion (for these machines)
- **FDM end-to-end**: bundled slice → direct Moonraker push → live monitoring + CFS multi-color + calibration. Fusion has **no** FDM.
- **Carvera 4-axis depth** (Fusion's rotary is generic); **Laguna true-shape nesting** (Fusion has none).
- **Per-machine gcode-safety contract pins** on every posted path (2.5D, 4-axis, and now 3D finish).
- **No subscription** (bundled CadQuery + OpenCAMLib + OrcaSlicer, all open-source).

---

## Roadmap / cycle sequence

- ✅ **Cycle 268** — 3D finish verified machine-safe + pinned (posted gcode-safety contract, both routers).
- ✅ **Cycle 269 (2026-06-16)** — parallel batch landed:
  - **Material-removal Simulate view** — voxel removal heatmap from posted G-code (`b137197`). Heatmap pixels still need a hands-on Electron verify.
  - **Editable feature timeline** — kernel-op delete wired end-to-end + pure utils (`9c68411`); move/suppress/roll-back were already live.
  - **OpenCAMLib scaffolding + AdaptiveWaterline crash-guard** (`d2db2b6`) — feasibility verified (3.7–3.11 wheels only); install script + gated smoke. NOT yet enabled for the user (manual: run the script against the 3.11 sidecar venv).
- ✅ **Cycle 271 (2026-06-16)** — feeds & speeds calculator (CNC aux panel): pure `computeFeedsAndSpeeds` over the existing reference tables, machine-clamped, self-contained card mounted in `CamManufacturePanel`.
- ⏭️ **Next candidates:** "Apply to op" for the feeds/speeds calc · drawings surface-finish symbols (mirror the GD&T model) + hole tables + detail/aux views · assembly rotational solver (foundational — translation-only solver today, and the E-vs-F heuristic refuses under-determined systems) · enable OCL on the 3.11 venv → true Waterline.

> This file is a living roadmap. Each cycle that closes a row should update the status table above and the improvement log.
