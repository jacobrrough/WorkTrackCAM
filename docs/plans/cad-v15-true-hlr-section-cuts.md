# Plan — CAD V1.5: true hidden-line removal at section cut planes

> **Stack:** C (CAD V1.5 polish) · **Status:** ✅ Ready · **Effort:** L
> **Machines:** CAD design (all) · **Created:** 2026-06-02 · **Owner:** Jacob · **Mode:** plan-only

Replace the 3D viewport's **half-space clip** section view with a true engineering section: the model cut at
a plane, a filled **cap face** at the cut, and remaining geometry rendered with **correct visible/hidden edge
styling** computed by real hidden-line removal. The HLR is computed in the CadQuery/OCCT sidecar
(`HLRBRep_Algo`) — the same kernel the 2D drawing pipeline already uses.

---

## 1. Current state

- **The 3D "section" is pure GPU clipping, not HLR.** `Viewport3D.tsx:60–61` accepts `sectionClipY?: number`
  (Y-axis only). `:699–702` builds a `THREE.Plane(new Vector3(0,1,0), -sectionClipY)`; `:204–205` feeds it as
  `clippingPlanes`; `:308–315` + `:318–325` apply it to the mesh material and the edge overlay; `:723` sets
  `localClippingEnabled`. Result: fragments above the plane are discarded — **no cap face, no section profile,
  no hidden/visible edge distinction** (the `EdgesGeometry` at 15° is from the uncut mesh and just gets clipped).
- **True HLR already exists for 2D drawings.** `engines/cad/cadquery_drawing.py:758–885` `section_drawing()`
  does a half-space box cut then re-runs `cq.exporters.getSVG()`, which internally uses OCCT HLR. Exposed via
  `cad.section_drawing` (`cad_handlers.py:827–836`, `sidecar-protocol.ts:875–910`). The **3D viewport is fully
  disconnected** from this.
- **OCP is available in the sidecar.** `engines/occt/step_to_stl.py:77–81` already imports OCP; CadQuery wraps
  OCP, so `HLRBRep_Algo`, `HLRBRep_HLRToShape`, `BRepAlgoAPI_Section`, `BRepMesh_IncrementalMesh`, etc. are present.
- **Handle registry:** `engines/cad/cadquery_import.py` `_HANDLES: dict[str, StepDocument]`; `tessellate_with_face_ids`
  already resolves a handle and walks `doc.workplane.findSolid()`.
- **IPC surface:** `window.fab.cad` (`shop-types.ts:323–425`) has `execute`, `export`, `tessellateWithIds`,
  `sectionDrawing`, etc. A new `hlrSection` method threads through `ipc-cad.ts`, preload, and `cad_handlers.py`.

## 2. Goal (definition of done)

1. Section view in the 3D viewport at an arbitrary plane (V1.5: front/top/right axis-aligned at a chosen offset).
2. A filled **cap face** (section profile, optional hatch) at the cut.
3. **Visible vs hidden** edge classification: visible solid, hidden dashed/dimmed — B-rep correct, from OCCT
   topology, not a screen-space heuristic.
4. Acceptable perf: typical part (< 200 faces) < 3 s; large parts show a loading state.
5. Result cached by `(handle, planeNormal, planeOffset, viewDir)`.
6. New wire types in `sidecar-protocol.ts` with `isSidecarResponse` kept in sync; no `any`.

## 3. Approach

**Recommended — (a) sidecar HLR via OCP `HLRBRep_Algo`.** An edge is "hidden" because the solid's B-rep
occludes it from a view direction; only B-rep topology gives correct results (the kernel behind CATIA/STEP
drawing export). Pipeline: resolve handle → `BRepAlgoAPI_Section` for the cap profile + cut the solid →
configure `HLRBRep_Algo` with an `HLRAlgo_Projector` from the view dir → `Update()`/`Hide()` → extract via
`HLRBRep_HLRToShape` (`VCompound`/`VisOutLine` visible, `HCompound`/`HidOutLine` hidden) → discretize each
compound to polylines (`GCPnts_QuasiUniformDeflection`) → return polylines + cap-face triangles + outline.

- **(b) renderer/screen-space** edges: cheap/interactive but cannot produce a cap face and gets curved-surface
  silhouettes wrong. Rejected for an engineering section view.

**View-direction model:** static section view (like AutoCAD `FLATSHOT` / CATIA drawing views), not per-frame
HLR. The operator locks a plane + view dir (front/top/right/iso); a "Recompute" button (or auto-recompute past
N° of camera drift) re-triggers. Sharp/crease edges stay stable across moderate orbit; silhouettes are
view-dependent (documented limitation).

**Cap face:** `BRepAlgoAPI_Section` → wire(s) → `BRepBuilderAPI_MakeFace(plane, wire)` → `BRepMesh_IncrementalMesh`
(coarse 0.5 mm) → triangles in the existing tessellation format. Degenerate/non-planar wire → empty cap +
warning, edges still returned.

**Caching:** module-level LRU (cap 8) in `cadquery_hlr.py`, key rounded to 3 sig figs.

## 4. Touchpoints

**Create**
- `engines/cad/cadquery_hlr.py` (~300 lines) — `hlr_section(handle, plane_normal, plane_offset, view_dir, tol)`
  → `{visibleEdges, hiddenEdges, capFaceTriangles, capFaceOutline, bbox}`; uses `_HANDLES` + OCP; LRU cache;
  must **not** weaken `BANNED_TOKENS` or touch `execute_script`.
- `engines/cad/cadquery_hlr_test.py` (~200 lines).
- `src/renderer/design/viewport3d-hlr-section.ts` (~150 lines) — `HlrSectionState` union + pure
  `buildHlrSectionGeometry(result)` → Three.js `BufferGeometry`s.
- `src/renderer/design/viewport3d-hlr-section.test.ts` (~100 lines).

**Modify** *(all > 800-line files use Python-via-bash)*
- `engines/sidecar/cad_handlers.py` — add `hlr_section` handler + `HANDLERS` entry (~line 851); import core.
- `src/shared/sidecar-protocol.ts` — add `CadHlrSectionParams`, `CadHlrEdgePolyline`, `CadHlrSectionResult`;
  add `'cad.hlr_section'` to the `SidecarMethod` union; extend `isSidecarResponse` coverage.
- `src/main/ipc-cad.ts` — payload/response types, validator, `registerHlrSectionHandler` in `registerCadIpc`.
- `src/renderer/src/shop-types.ts` — `hlrSection` on `window.fab.cad`.
- `src/preload/index.ts` — wire `cad:hlrSection`.
- `src/renderer/design/Viewport3D.tsx` — `HlrSection` sub-component (visible `lineSegments` solid; hidden
  `lineSegments` dashed via `LineDashedMaterial` + `computeLineDistances()`; cap-face `mesh`); new
  `hlrSectionState` + `sectionPlane` props; keep `sectionClipY` for backward-compat fallback.
- `src/renderer/design/DesignWorkspace.tsx` — section state + toolbar control + `fab().cad.hlrSection`
  loading→ready state machine; thread state into `Viewport3D`.

## 5. Risks & mitigations

- **Perf** (`HLRBRep_Algo` ~O(E·F)): loading spinner; coarse discretization tol (0.5 mm); LRU cache;
  optional "simplified HLR" (visible + cap only); `maxEdgeCount` (default 10k) with decimation + warning.
- **View dependence:** static section view + explicit recompute; sharp edges stable, silhouettes documented.
- **Cap triangulation of arbitrary/hollow sections:** `MakeFace` then mesh; multi-loop (annulus) supported;
  degenerate → empty cap + warning, edges still returned.
- **OCP binding drift:** defensive import; raise `ocp_hlr_not_available` so renderer falls back to GPU clip + toast.
- **Wire size:** complex solids can yield 50k+ points (~1.5 MB JSON) — `maxEdgeCount` + coarse tol cap it.

## 6. Test strategy

- **Python** (`cadquery_hlr_test.py`): cube front view → ≥4 visible edges, empty cap; 20 mm cube section at
  Z=0 → 1 cap outline loop + cap triangles + `bbox.min.z==0`; cache hit (dict len 1); invalid handle →
  `invalid_handle`; OCP missing → `ocp_hlr_not_available`; hollow tube section → 2 cap loops.
- **Vitest** (`viewport3d-hlr-section.test.ts`): `buildHlrSectionGeometry` builds position attrs of the right
  length; empty cap → null geometry; type guards compile without `any`.
- **Protocol** (`sidecar-protocol.test.ts`): `isSidecarResponse` accepts a `cad.hlr_section` envelope; union
  includes the method (compile-time `satisfies`); add a pin asserting `"hlr_section"` appears in `cad_handlers.py`.
- **Render pin** (`DesignWorkspace`): "Section" toolbar button present; click → `kind:'loading'`.

## 7. Sequencing

1. Python core + tests (isolated; validates OCP availability + discretization).
2. Protocol types + union + `isSidecarResponse` test.
3. Sidecar handler + `HANDLERS` (Python-via-bash on `cad_handlers.py`).
4. IPC layer (Python-via-bash on `ipc-cad.ts`).
5. Preload + shop-types.
6. Renderer geometry helper + tests (new file).
7. `Viewport3D` integration (keep `sectionClipY` fallback).
8. `DesignWorkspace` state + toolbar.
9. Post-flight gates + improvement-log.

## Effort & open questions

**Effort: L** (~5 days: Python core+tests ~1.5 d; wire/IPC across 5 large files ~1 d; renderer ~1 d;
DesignWorkspace ~0.5 d; OCP edge-cases ~1 d).

1. Which OCP version ships with the pinned CadQuery — `OCP.HLRBRep.HLRBRep_Algo` vs `OCC.Core...`? Verify.
2. Cap-face style: solid gray fill (simple) vs 45° crosshatch shader (CAD-conventional). V1.5 → gray + outline.
3. Arbitrary plane normal: V1.5 ships front/top/right at an offset; arbitrary-normal picking → V2.
4. Section controls UI location: HUD vs FeatureTree vs floating panel (recommend a collapsible HUD panel).
5. Hidden-edge dashes: `LineDashedMaterial` + `computeLineDistances()` (recommended) vs custom GLSL.
