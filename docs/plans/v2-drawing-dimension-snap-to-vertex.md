# Plan — V2: drawing dimension snap-to-vertex

> **Stack:** G (V2-era) · **Status:** 🔮 V2-era · **Effort:** L (S first slice)
> **Machines:** CAD design · **Created:** 2026-06-02 · **Owner:** Jacob · **Mode:** plan-only

When placing a dimension in a 2D drawing/section view, snap the cursor to projected model vertices (then edge
endpoints/midpoints/arc centers) with a visible snap indicator and a pixel tolerance, plus a hold-key override.
Snap logic is pure and DOM-free; the first valuable slice also adds the interactive two-click placement that the
drawing view lacks entirely today.

---

## 1. Current state

- **`src/renderer/design/DrawingView.tsx`** (829 lines → Python-via-bash) is the only 2D drawing UI.
  Dimension placement is **free, non-interactive**: `addDimension` (`:362`) appends a
  `makeDefaultDimensionSpec` with hard-coded coords (`p1{0,0}`, `p2{30,0}`). **No** click-to-place, pointer-move,
  SVG hit-testing, or coordinate capture. The SVG is injected via `dangerouslySetInnerHTML` into
  `div.design-drawing__svg-host` (`:735–739`) with **no ref and no pointer events**.
- **Dimension specs store raw frozen 2D coords** (`DrawingDimensionSpec`, `:209–235`, e.g. `p1{x,y}`) — no
  vertex/edge geometric reference.
- **No snap infrastructure** in this path. The only `snap` in the repo is a grid-snap scalar for the sketch
  canvas (`sketch2d-canvas-coords.ts:33`), unrelated.
- **Two projection pipelines produce different geometry:**
  - **A (feeds DrawingView):** `cadquery_drawing.py` `project_to_drawing()` → `cq.exporters.getSVG(...)`
    (`:194`, opts `width=800 height=600 marginLeft/Top=10`) → **opaque SVG string**, no vertex list.
  - **B (PDF/DXF export):** `drawing-project-model-views.ts` → `engines/occt/project_views.py` →
    `ProjectedSegment[]{x1,y1,x2,y2}` (`:7–14`). Not used by the live canvas.
- **Anchor storage:** `CadDimensionPoint2D` (`sidecar-protocol.ts:799`) + specs hold only `{x,y}` — no
  `vertexId`/`edgeId` anywhere.

**Gap:** DrawingView has no structured geometry to snap to; the pipeline feeding it returns only SVG.

## 2. Goal (definition of done)

1. A "place dimension" mode: click a dimension button → interactive placement.
2. Cursor over the canvas shows a snap indicator at the nearest vertex/endpoint/midpoint/center within tolerance
   (default 12 px); hold `Alt` to disable snap.
3. First click locks `p1` (snapped), second locks `p2`; the dimension is appended with resolved coords.
4. Anchor stored as a **frozen coordinate** in the existing spec (see Approach) — plus an optional
   `snapSource?: {kind}` metadata tag.
5. A new `cad.extract_drawing_snap_points` sidecar method returns the snap list per handle+view; renderer caches it.
6. All snap logic in pure, DOM-free, unit-tested functions.

## 3. Approach

**Recommended — frozen-coordinate anchor.** Specs already hold only coords; the only schema touch is an optional
`snapSource?: {kind}` metadata tag (no structural change, no migration; old `.wtcam` parse unchanged). On model
edit the operator re-places dimensions (Fusion-style "dangling dimension") — acceptable for a V2 first slice.

- **Alt — stable vertex-ID anchor:** survives model edits but needs a topology-id sidecar method, a
  re-resolve method, a `drawing-sheet-schema.ts` version bump (`z.literal(1)`→`2`) + migration, and IPC for
  re-resolution — 3–4× the complexity. Upgrade path is additive later (`p1Ref?` alongside `p1`).

**`resolveSnap` (pure):** `resolveSnap(cursorSvg, snapPoints, toleranceSvgUnits, override) → SnapResult | null`.
Override→null; squared-distance to each point; nearest within tolerance²; tie-break priority
`vertex > endpoint > center > midpoint`, then stable array index. Caller copies `SnapResult.{x,y}` into the spec.

**Coords:** CadQuery `getSVG` emits mm at the 800×600 canvas scale; `clientToSvgCoord(clientX, clientY, svgEl)`
maps pointer→SVG units via `getScreenCTM().inverse()`. Sidecar snap points are in the same SVG mm space → no
extra scaling.

## 4. Touchpoints

**Create**
- `src/renderer/design/drawing-snap.ts` (~120 lines) — `SnapPointKind`, `SnapPoint`, `SnapResult`,
  `SNAP_KIND_PRIORITY` (vertex 0…midpoint 3), `DEFAULT_SNAP_TOLERANCE_PX=12`, `resolveSnap(...)`,
  `clientToSvgCoord(...)` (null-guarded).
- `src/renderer/design/drawing-snap.test.ts` (~200 lines) + `drawing-snap-pin.test.ts` (~60 lines).

**Modify** *(all four large files → Python-via-bash)*
- `engines/cad/cadquery_drawing.py` (1061) — `extract_snap_points(handle, view)`: `_resolve_handle` +
  `_validate_view`, project `Vertices()`/`Edges()` (endpoints, line midpoints, arc midpoints, circle/arc
  centers) into the same SVG mm space `getSVG` uses; wire `{snapPoints[{x,y,kind,sourceId}], view, count}`;
  errors `bad_params`/`invalid_handle`/`cadquery_not_installed`/`snap_extract_error`.
- `engines/sidecar/cad_handlers.py` (~900) — thin `extract_snap_points` handler + dispatch entry.
- `src/shared/sidecar-protocol.ts` (~900) — `'cad.extract_snap_points'` in `SidecarMethod`;
  `CadSnapPointKind`, `CadSnapPoint`, `CadExtractSnapPointsParams`, `CadExtractSnapPointsResult`.
- `src/main/ipc-cad.ts` (2401) — payload type, validator, coercer, `cad:extractSnapPoints` handler (20 s timeout).
- `src/preload/index.ts` (~900) — `extractSnapPoints` type + `ipcRenderer.invoke` bridge.
- `src/renderer/src/shop-types.ts` — `extractSnapPoints` on `fab.cad`.
- `src/renderer/design/DrawingView.tsx` (829) — placement-mode state machine (`{kind, step, p1?}`); cached
  `snapPoints` (per handle+view via `useRef`); `hoveredSnap`; `altHeld` (window key listeners); `svgHostRef`;
  `onPointerMove`→`clientToSvgCoord`→`resolveSnap`; `onPointerDown` locks p1/p2; dimension buttons enter
  placement instead of immediate add; absolutely-positioned `<svg>` snap-indicator overlay; `useEffect`
  fetching `fab.cad.extractSnapPoints` on handle/view change (graceful empty on failure); optional
  `snapTolerance?` prop for tests.

**Tests:** `__tests__/DrawingView.test.tsx` (+placement-mode render pins); `test_cad_drawing_handlers.py`
(+`TestExtractSnapPoints`).

## 5. Risks & mitigations

- **R1 — projecting `Vertices()`/`Edges()` into `getSVG` space is the main uncertainty.** `getSVG` uses OCCT HLR
  internally; the 3D→SVG affine isn't documented. Implement `_project_point_to_svg_space(...)` (rotate to view
  plane, scale to canvas, Y-flip), validate against known bbox-corner SVG coords; **fallback**: parse
  `<circle cx cy>` / `<line x1 y1 x2 y2>` from the SVG string to harvest snap points actually drawn.
- **R2 — cursor mapping vs CSS transforms:** `getScreenCTM().inverse()` handles scale/DPR; assert finite result
  in `[-1,width+1]×[-1,height+1]`; require any ancestor `transform` to live on `design-drawing__svg-host`.
- **R3/R4 — large-file edits** (`DrawingView.tsx` 829, `ipc-cad.ts` 2401): Python-via-bash; new handler ~50 lines, additive.
- **R5 — CadQuery missing:** handler raises `cadquery_not_installed`; renderer swallows non-ok → free-click still works.
- **R6 — schema:** optional `snapSource` tag is additive (Zod strips unknowns by default); no migration; a future
  `vertexRef` would need one.

## 6. Test strategy (pure functions)

`drawing-snap.test.ts` matrix for `resolveSnap`: zero points → null; in-tolerance match; out-of-tolerance → null;
boundary (dist=tol match, dist=tol+ε null); tie-break by kind (vertex beats midpoint); tie-break by stable index;
override → null; nearest-wins; nearest-out-but-second-in → second. `clientToSvgCoord` with a mock SVGSVGElement
(identity CTM). Pin test: exported symbols, `SNAP_KIND_PRIORITY` has all four kinds with `vertex` lowest, default
tolerance = 12.

## 7. Sequencing

1. **Step 1 (S, ~30 min):** `drawing-snap.ts` + tests + pin — fully self-contained.
2. **Step 2 (~90 min):** sidecar `extract_snap_points` + dispatch + protocol + IPC + preload + shop-types +
   Python tests (additive, Python-via-bash per large file).
3. **Step 3 (~60 min):** DrawingView placement state machine + snap fetch + pointer handlers + override + indicator;
   placement-mode render pins.
4. **Step 4:** integration smoke (no regressions, clean `tsc`, indicator appears against a simple box).

**Smallest valuable first slice:** Step 1 + the free-cursor two-click placement half of Step 3 (no sidecar snap
yet) — delivers interactive dimension placement, which is missing entirely today. Sidecar snap follows as PR 2.

## Effort & open questions

**Effort: L** (~3–4 d; the OCCT projection alignment in R1 is the main risk, +1 d if the SVG-parse fallback is needed).
**S** slice: `drawing-snap.ts` + tests + free-click placement (~1 d).

1. Does `getSVG` preserve the `width=800 height=600` scale or normalize to a viewBox? (Affects px↔SVG conversion.)
2. Does `workplane.val().Vertices()` return OCCT `gp_Pnt` or CadQuery `Vector`? (Attribute-access path.)
3. Snap tolerance: persist in `appSettingsSchema` (user pref) or compile-time default + test prop? (Plan: latter.)
4. Arc/circle center via `Edge.geomType()=='CIRCLE'/'ARC'` + `Edge.arcCenter()` — confirm pinned CadQuery API.
5. The stable-vertex-ID path (regeneration on edit) is deferred → coordinate with a `drawing-sheet-schema.ts`
   `z.literal(1)`→`2` bump + `schema-migration.ts` entry when it lands.
