/**
 * DrawingView -- CAD V2 drawing-projection workspace.
 *
 * Companion to {@link AssemblyView}. Renders the inline SVG returned by
 * the sidecar's `cad.projectDrawing` handler (sibling agents own the
 * wire types + preload bridge -- Wave 2 Workflows). The component is
 * additive: it does NOT touch the existing Part view's render tree or
 * the AssemblyView's body; the DesignWorkspace activates it via the
 * new tab-bar branch.
 *
 * Contract (pinned by `__tests__/DrawingView.test.tsx`)
 * -----------------------------------------------------
 *   1. The root carries `data-testid="design-drawing-view"` and the
 *      BEM class `design-drawing` so the existing CSS theme covers
 *      both empty and populated states without inline styles
 *      (CLAUDE.md design-token rule).
 *   2. The toolbar exposes five affordances with stable testids:
 *        - `data-testid="design-drawing-view-front"` -- "Front"
 *        - `data-testid="design-drawing-view-top"`   -- "Top"
 *        - `data-testid="design-drawing-view-right"` -- "Right"
 *        - `data-testid="design-drawing-view-iso"`   -- "Iso"
 *        - `data-testid="design-drawing-export"`     -- "Export PDF/SVG"
 *      The view buttons use `.btn .btn-secondary` (`btn-primary` on the
 *      active view) so the styling matches the rest of the workspace.
 *   3. When `partHandle === null`, the component renders the shared
 *      `EmptyState` (CLAUDE.md "shared empty-state" rule) with the
 *      testid `design-drawing-empty`.
 *   4. The component re-fetches `cad.projectDrawing` whenever
 *      `partHandle` OR the active view changes. The returned SVG
 *      string is rendered inline via `dangerouslySetInnerHTML` (safe
 *      by virtue of being produced by CadQuery's own exporter -- the
 *      sidecar is the trust boundary; the renderer never accepts a
 *      user-supplied SVG string into this surface).
 *   5. Errors from `cad.projectDrawing` fold into a local `error`
 *      state and render as a `role="alert"` banner -- they never throw.
 *   6. No `any` types, no inline styles, props are `readonly`.
 *
 * Why inline SVG (not an <img src="data:image/svg+xml;..."/>)?
 * -----------------------------------------------------------
 * Inline SVG lets the operator zoom into the drawing with the browser's
 * native scaling, supports text selection on dimension labels, and
 * sidesteps the data-URL length limits some Electron builds enforce.
 * The trust boundary is the sidecar -- the SVG never carries user
 * scripts (CadQuery's exporter emits a static `<svg>` tree, not a
 * `<script>` payload).
 *
 * Dimension placement (CAD V2 snap-to-vertex slice -- Step 3):
 * ------------------------------------------------------------
 * Clicking a dimension toolbar button now enters interactive two-click
 * placement mode (state machine in `dimension-placement.ts`). The SVG
 * host div gains pointer handlers:
 *   onPointerMove  -> clientToSvgCoord -> resolveSnap -> hoveredSnap
 *   onPointerDown  -> clientToSvgCoord -> advanceDimensionPlacement
 *                  -> on completion: append dimension spec with p1/p2
 *
 * snapPoints state defaults to [] (DEFERRED: sidecar fetch via
 * cad.extract_drawing_snap_points will populate this in a follow-up
 * PR; for now resolveSnap always returns null -> free-cursor placement).
 * altHeld disables snap (hold Alt to override).
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type JSX,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { EmptyState } from '../src/EmptyState'
import { fab } from '../src/shop-types'
import {
  startDimensionPlacement,
  advanceDimensionPlacement,
  type DimensionPlacementState,
} from './dimension-placement'
import {
  clientToSvgCoord,
  resolveSnap,
  DEFAULT_SNAP_TOLERANCE_PX,
  type SnapPoint,
  type SnapPointKind,
  type SnapResult,
} from './drawing-snap'
import {
  advanceDimensionRun,
  buildAngularDimension,
  buildCenterMark,
  buildCenterline,
  buildDiameterDimension,
  buildDrawingNote,
  buildLinearDimension,
  buildRadialDimension,
  composeCenterMarksIntoSvg,
  composeCenterlinesIntoSvg,
  composeDimensionSetsIntoSvg,
  composeNotesIntoSvg,
  DEFAULT_CENTER_MARK_SIZE_MM,
  reanchorCenterMarks,
  reanchorCenterlines,
  reanchorDimensions,
  reanchorNotes,
  removeCenterMark,
  removeCenterline,
  removeDimension,
  removeNote,
  startBaselineRun,
  startChainRun,
  startOrdinateRun,
  updateNoteText,
  type DimensionRunState,
  type FreshSnapPoint,
  type OrdinateAxis,
  type ResolvedClick,
} from './drawing-annotation-model'
import {
  buildGdtFrame,
  gdtFramesToSpecs,
  reanchorGdtFrames,
} from './drawing-gdt-model'
import {
  buildSurfaceFinish,
  composeSurfaceFinishIntoSvg,
  reanchorSurfaceFinishes,
  SURFACE_FINISH_LAY_LABELS,
} from './drawing-surface-finish-model'
import type {
  DrawingBomRow,
  DrawingCenterMark,
  DrawingCenterline,
  DrawingDimension,
  DrawingNote,
  GdtCharacteristic,
  GdtFeatureControlFrame,
  SurfaceFinishLay,
  SurfaceFinishMaterial,
  SurfaceFinishSymbol,
} from '../../shared/drawing-annotation-schema'

/**
 * Standard projection axes exposed in the toolbar. Each maps to the
 * sidecar's `cad.projectDrawing` `view` parameter. Keep the union
 * narrow -- adding new views means adding a button, which is a
 * deliberate UX decision (not an accidental render variant).
 */
export type DrawingViewAxis = 'front' | 'top' | 'right' | 'iso'

/**
 * Export targets the toolbar can request from the sidecar. Both formats
 * round-trip through the same `cad.exportDrawing` bridge owned by the
 * sibling agents.
 */
export type DrawingExportFormat = 'pdf' | 'svg'

/** Display label for each axis. Exported for the unit-test pin. */
export const DRAWING_VIEW_LABELS: Record<DrawingViewAxis, string> = {
  front: 'Front',
  top: 'Top',
  right: 'Right',
  iso: 'Iso',
}

/** Stable testid suffix per axis. Exported for the unit-test pin. */
export function drawingViewTestId(view: DrawingViewAxis): string {
  return `design-drawing-view-${view}`
}

/**
 * Public props.
 *
 * `partHandle` is the opaque CadQuery handle from a prior
 * `cad.execute_script` round-trip -- the same handle table the Part
 * view's `Send to CAM` flow uses. `null` means "no part selected" and
 * triggers the empty-state branch.
 */
export interface DrawingViewProps {
  /** Opaque CadQuery handle of the part to project, or null for empty-state. */
  readonly partHandle: string | null
  /**
   * Optional initial view axis. Defaults to `'front'`. Render-pin tests
   * thread this in to assert the active-state styling without driving
   * a click handler.
   */
  readonly initialView?: DrawingViewAxis
  /**
   * Wave 6 (HLR) — optional initial "Hidden lines" toggle state. Defaults to
   * `false` (mesh-edge preview). When true, the component starts with the true
   * hidden-line-removal projection ON, threading `includeHlr: true` into the
   * `cad.projectDrawing` bridge. Render-pin tests thread this in to assert the
   * toggle's ON styling without driving a click handler.
   *
   * Persistence note: the toggle lives in COMPONENT STATE only. There is no
   * per-sheet settings home in `drawing-sheet-schema.ts` today, so the choice
   * is not persisted across sheet switches / reloads (honest limitation — a
   * schema+session change is out of scope for this wave).
   */
  readonly initialHlr?: boolean
  /**
   * Optional handler fired when the operator clicks "Export PDF/SVG".
   * The host owns the file-picker UI (and the choice between PDF /
   * SVG); this component only signals intent. When omitted, the
   * Export button is hidden.
   */
  readonly onExport?: (format: DrawingExportFormat) => void
  /**
   * Toast hook from the host. Optional -- falls back to a no-op so the
   * component renders cleanly in unit tests.
   */
  readonly onToast?: (kind: 'ok' | 'err' | 'warn', message: string) => void
  /**
   * Render-pin escape hatch: when set, the component skips the live
   * `cad.projectDrawing` round-trip and renders this SVG string
   * directly. Used by tests so the static-render assertion does not
   * depend on the IPC bridge being available in the node-env vitest
   * worker.
   */
  readonly previewSvg?: string
  /**
   * CAD V1.5 -- Optional initial dimension list. Render-pin tests use
   * this to assert the dimension-row tally on the toolbar without
   * driving click handlers.
   */
  readonly initialDimensions?: readonly DrawingDimensionSpec[]
  /**
   * CAD V1.5 -- Optional initial section-plane spec. When supplied the
   * Sections toggle starts in the ON state with these values. Render-
   * pin tests use this to assert the Section panel renders correctly.
   */
  readonly initialSectionPlane?: DrawingSectionPlane
  /**
   * CAD V1.5 -- Optional initial title-block metadata. Defaults to the
   * built-in template (name empty, scale "1:1", sheet "1 of 1").
   */
  readonly initialTitleBlock?: DrawingTitleBlock
  /**
   * CAD V2 snap -- Optional snap tolerance override (SVG units).
   * Defaults to DEFAULT_SNAP_TOLERANCE_PX. Used by tests to exercise
   * snap resolution without needing to mock large coordinate spreads.
   */
  readonly snapTolerance?: number
  /**
   * CAD V2 persistence -- the persisted, associative dimensions for this sheet
   * (`sheet.annotations.dimensions`). When supplied, the component renders
   * THESE through the `cad.dimension_drawing` SVG path and re-resolves every
   * anchor's `refId` against fresh geometry on each projection (badging any
   * dimension whose anchor link is gone as `dangling`). When omitted the
   * component falls back to ephemeral, in-state placement (legacy behaviour).
   */
  readonly persistedDimensions?: readonly DrawingDimension[]
  /**
   * CAD V2 persistence -- called whenever the persisted dimension list changes
   * (a new dimension placed, or anchors refreshed / flagged dangling after a
   * geometry re-projection). The host writes the result into
   * `sheet.annotations.dimensions`. Only fired when `persistedDimensions` is
   * supplied (controlled mode).
   */
  readonly onPersistDimensions?: (next: readonly DrawingDimension[]) => void
  /**
   * CAD V2 BOM -- rows the assembly model provides for the "BOM table"
   * affordance. When non-empty, a "BOM table" button appears that stamps these
   * rows into the current SVG via `cad.drawing_bom_table`. The handler renders
   * them verbatim (it does NOT recompute the BOM).
   */
  readonly bomRows?: readonly DrawingBomTableRow[]
  /**
   * CAD V2 BOM -- optional column set for the BOM table (render order).
   * Defaults to `['item', 'partName', 'quantity']` in the sidecar.
   */
  readonly bomColumns?: readonly DrawingBomColumn[]
  /**
   * CAD V1.5 GD&T -- the persisted, associative feature control frames for this
   * sheet (`sheet.annotations.featureControlFrames`). When supplied (controlled
   * mode), the GD&T tool is enabled: a one-click anchored placement mints a
   * `GdtFeatureControlFrame` pushed up via {@link onPersistGdt}, and the frames
   * compose onto the projection via `cad.annotateGdt`. Each anchor's `refId` is
   * re-resolved against fresh geometry on every re-projection (dangling badge).
   */
  readonly persistedGdtFrames?: readonly GdtFeatureControlFrame[]
  /**
   * CAD V1.5 GD&T -- called whenever the persisted GD&T frame list changes (a
   * new frame placed, the list cleared, or anchors refreshed / flagged dangling
   * after a re-projection). The host writes the result into
   * `sheet.annotations.featureControlFrames`. Optional + readonly (additive):
   * when omitted the GD&T toolbar still renders but placement is inert.
   */
  readonly onPersistGdt?: (next: readonly GdtFeatureControlFrame[]) => void
  /**
   * CAD V1.5 Surface finish -- the persisted, associative ISO 1302 / ASME Y14.36
   * surface-texture symbols for this sheet (`sheet.annotations.surfaceFinishes`).
   * When supplied (controlled mode), the surface-finish tool is enabled: a
   * one-click anchored placement mints a `SurfaceFinishSymbol` pushed up via
   * {@link onPersistSurfaceFinishes}, and the symbols compose onto the projection
   * client-side (a pure SVG `<g>` overlay -- no sidecar round-trip, unlike GD&T).
   * Each anchor's `refId` is re-resolved against fresh geometry on every
   * re-projection (dangling badge), mirroring the GD&T frame path exactly.
   */
  readonly persistedSurfaceFinishes?: readonly SurfaceFinishSymbol[]
  /**
   * CAD V1.5 Surface finish -- called whenever the persisted surface-finish list
   * changes (a new symbol placed, the list cleared, or anchors refreshed /
   * flagged dangling after a re-projection). The host writes the result into
   * `sheet.annotations.surfaceFinishes`. Optional + readonly (additive): when
   * omitted the surface-finish toolbar still renders but placement is inert
   * (mirrors `onPersistGdt`).
   */
  readonly onPersistSurfaceFinishes?: (next: readonly SurfaceFinishSymbol[]) => void
  /**
   * CAD V1.5 Notes -- the persisted free-text notes for this sheet
   * (`sheet.annotations.notes`). When supplied (controlled mode), the Note tool
   * is enabled: a one-click placement mints a `DrawingNote` pushed up via
   * {@link onPersistNotes}, and the notes compose onto the projection
   * client-side (a pure SVG `<g>` overlay -- no sidecar round-trip, exactly
   * like surface finishes; the note text is entity-escaped by the pure emitter
   * in `drawing-annotation-model.ts`, the client-side trust boundary). A click
   * that lands on a snap point records the feature as the note's LEADER anchor
   * (re-resolved on every re-projection, dangling badge); a free click places a
   * free-floating note block.
   */
  readonly persistedNotes?: readonly DrawingNote[]
  /**
   * CAD V1.5 Notes -- called whenever the persisted note list changes (a new
   * note placed, a note's text edited, a note deleted, the list cleared, or
   * leader anchors refreshed / flagged dangling after a re-projection). The
   * host writes the result into `sheet.annotations.notes`. Optional + readonly
   * (additive): when omitted the Note toolbar still renders but placement is
   * inert (mirrors `onPersistSurfaceFinishes`).
   */
  readonly onPersistNotes?: (next: readonly DrawingNote[]) => void
  /**
   * CAD V1.5 Center marks -- the persisted center-mark (+) annotations for this
   * sheet (`sheet.annotations.centerMarks`). When supplied (controlled mode),
   * the Center mark tool is enabled: a one-click anchored placement (snapping
   * `center`-kind points FIRST, then the honest nearest snap) mints a
   * `DrawingCenterMark` pushed up via {@link onPersistCenterMarks}, and the
   * marks compose onto the projection client-side (pure SVG `<g>` overlay, no
   * sidecar round-trip -- exactly like notes / surface finishes). Each anchor's
   * `refId` is re-resolved against fresh geometry on every re-projection
   * (dangling badge). No free text -- no Safety-Rule-4 escaping surface.
   */
  readonly persistedCenterMarks?: readonly DrawingCenterMark[]
  /**
   * CAD V1.5 Center marks -- called whenever the persisted center-mark list
   * changes (a mark placed / deleted / cleared, or anchors refreshed / flagged
   * dangling after a re-projection). The host writes the result into
   * `sheet.annotations.centerMarks`. Optional + readonly (additive): when
   * omitted the tool still renders but placement is inert (mirrors
   * `onPersistNotes`).
   */
  readonly onPersistCenterMarks?: (next: readonly DrawingCenterMark[]) => void
  /**
   * CAD V1.5 Centerlines -- the persisted chain-dashed centerlines for this
   * sheet (`sheet.annotations.centerlines`). When supplied (controlled mode),
   * the Centerline tool is enabled: a TWO-click placement (start feature, then
   * end feature -- the Detail tool's step-carrying intermediate-state shape)
   * mints a `DrawingCenterline` pushed up via {@link onPersistCenterlines}; the
   * lines compose onto the projection client-side and BOTH anchors re-resolve
   * on every re-projection (dangling badge when either endpoint's feature is
   * gone).
   */
  readonly persistedCenterlines?: readonly DrawingCenterline[]
  /**
   * CAD V1.5 Centerlines -- persist seam for {@link persistedCenterlines}
   * (mirrors {@link onPersistCenterMarks}).
   */
  readonly onPersistCenterlines?: (next: readonly DrawingCenterline[]) => void
  /**
   * CAD V1.5 Detail -- called when a detail (crop) view is produced. The host
   * owns what to do with the magnified crop SVG (open in a new sheet, export,
   * etc.); this component only generates it via `cad.detailDrawing` and signals
   * the result. When omitted the Detail tool is hidden.
   */
  readonly onDetail?: (result: {
    readonly svg: string
    readonly center: { readonly x: number; readonly y: number }
    readonly radiusMm: number
    readonly label: string
  }) => void
  /**
   * CAD V2 persistence -- called whenever the title-block metadata changes (any
   * field edited in the Title Block panel). The host writes the result into
   * `sheet.titleBlock`. Optional + readonly (additive): when omitted the title
   * block still edits locally but the change is not persisted (the legacy
   * write-only-to-memory behaviour). The seam mirrors `onPersistDimensions` /
   * `onPersistGdt`; the title block is seeded from {@link initialTitleBlock} (so
   * a host that re-keys this component on project-open lands the hydrated value).
   */
  readonly onPersistTitleBlock?: (next: DrawingTitleBlock) => void
  // -- Drawings RENDERER half: sheet tabs / section view / BOM table seams ----
  /**
   * Multi-sheet tab strip (CONTROLLED). When supplied, the tab strip renders
   * one tab per entry and reports add / rename / delete / switch INTENT up via
   * the callbacks below; the host owns the persisted sheet list (folded through
   * the Cycle-259 `onDrawing` seam) and re-points the single-sheet `persisted*`
   * props at the active sheet so per-sheet content swaps on switch. When OMITTED
   * the component shows ONE implicit fallback tab (the legacy single-sheet
   * behaviour) so the strip is always present but inert beyond display.
   */
  readonly sheets?: readonly DrawingSheetTab[]
  /** Active sheet id (controlled). Falls back to the first sheet when unmatched. */
  readonly activeSheetId?: string
  /** Switch to a different sheet. Host re-points the per-sheet content props. */
  readonly onSelectSheet?: (sheetId: string) => void
  /** Add a new sheet. The host mints the id + default name and persists it. */
  readonly onAddSheet?: () => void
  /** Rename a sheet (trimmed, non-empty enforced before this fires). */
  readonly onRenameSheet?: (sheetId: string, name: string) => void
  /**
   * Delete a sheet. The host enforces the "never delete the last sheet"
   * invariant; the strip hides the delete affordance when only one sheet exists.
   */
  readonly onDeleteSheet?: (sheetId: string) => void
  /**
   * Placeable BOM table rows (CONTROLLED display). Rows the host derived via the
   * engine `deriveDrawingBom` seam (qty / name / source roll-up). When supplied
   * a BOM panel renders these as a table; when the array is empty an honest
   * empty state renders; when the prop is OMITTED the panel does not render at
   * all (the host opts in only when a part/assembly is available). This is the
   * placeable on-sheet table, distinct from the existing `bomRows` SVG-stamp
   * path which composes a table layer into the exported drawing.
   */
  readonly bomLines?: readonly DrawingBomLine[]
}

/**
 * Defensive accessor for the optional `cad.projectDrawing` bridge.
 * Sibling agents in the CAD V2 wave own the wire types + preload
 * exposure; this helper lets the component compile and render
 * correctly even if the bridge lands in a later commit. When it is
 * missing, the component falls back to an inline notice -- the
 * empty-state path still renders cleanly.
 */
type DrawingBridge = {
  readonly projectDrawing?: (payload: {
    readonly handle: string
    readonly view: DrawingViewAxis
    /**
     * Wave 6 (HLR) — request true hidden-line removal. Additive + optional;
     * omitted / false keeps the byte-identical mesh-edge projection. The
     * permissive `cad:*` IPC envelope forwards this straight to the sidecar's
     * `cad.project_drawing` `includeHlr` param.
     */
    readonly includeHlr?: boolean
  }) => Promise<
    | { ok: true; result: { svg: string } }
    | { ok: false; error: string; hint?: string }
  >
  // CAD V1.5 -- optional bridges for dimension overlay, section view, and
  // title-block stamp.
  readonly dimensionDrawing?: (payload: {
    readonly handle: string
    readonly view: DrawingViewAxis
    readonly dimensions: readonly DrawingDimensionSpec[]
  }) => Promise<
    | { ok: true; result: { svg: string; dimensionCount: number } }
    | { ok: false; error: string; hint?: string }
  >
  readonly sectionDrawing?: (payload: {
    readonly handle: string
    readonly view: DrawingViewAxis
    readonly plane: DrawingSectionPlane
    /** Optional cutting-plane label ("A-A"). Sidecar escapes it (Safety Rule 4). */
    readonly label?: string
  }) => Promise<
    | { ok: true; result: { svg: string } }
    | { ok: false; error: string; hint?: string }
  >
  readonly attachTitleBlock?: (payload: {
    readonly svg: string
    readonly metadata: DrawingTitleBlock
  }) => Promise<
    | { ok: true; result: { svg: string } }
    | { ok: false; error: string; hint?: string }
  >
  // CAD V2 -- associative-dimension geometry fetch. Returns projected
  // vertices / edges / snap points WITH stable ids so a placed dimension can
  // record the snapped feature's `sourceId` (the anchor `refId`).
  readonly extractDrawingGeometry?: (payload: {
    readonly handle: string
    readonly view: DrawingViewAxis
  }) => Promise<
    | { ok: true; result: Record<string, unknown> }
    | { ok: false; error: string; hint?: string }
  >
  // CAD V1.5 -- BOM table stamp. Pure SVG composition; renders the rows the
  // assembly already provides (does NOT recompute).
  readonly drawingBomTable?: (payload: {
    readonly svg: string
    readonly rows: readonly DrawingBomTableRow[]
    readonly columns?: readonly DrawingBomColumn[]
    readonly title?: string
  }) => Promise<
    | { ok: true; result: Record<string, unknown> }
    | { ok: false; error: string; hint?: string }
  >
  // CAD V1.5 -- GD&T feature-control-frame stamp. Pure SVG composition; the
  // sidecar renders the supplied frames verbatim and entity-escapes every datum
  // cell + the optional label before injection (Safety Rule 4).
  readonly annotateGdt?: (payload: {
    readonly svg: string
    readonly frames: readonly GdtAnnotateFrame[]
  }) => Promise<
    | { ok: true; result: { svg: string; frameCount?: number } }
    | { ok: false; error: string; hint?: string }
  >
  // CAD V1.5 -- detail (crop) view. Projects the parent ONCE, then re-frames a
  // circular crop magnified by `scale`. The sidecar escapes `label` (Safety
  // Rule 4) before any <text> node.
  readonly detailDrawing?: (payload: {
    readonly handle: string
    readonly view: DrawingViewAxis
    readonly center: { readonly x: number; readonly y: number }
    readonly radiusMm: number
    readonly scale?: number
    readonly label?: string
  }) => Promise<
    | { ok: true; result: { svg: string } }
    | { ok: false; error: string; hint?: string }
  >
}

/**
 * Wire-spec shape for one feature control frame passed to `cad.annotateGdt`
 * (mirrors `CadGdtFrameSpec`). Built from a persisted, anchored
 * {@link GdtFeatureControlFrame} via `gdtFramesToSpecs`. Datums / label are the
 * operator's verbatim free-text — the sidecar escapes them (Safety Rule 4).
 */
type GdtAnnotateFrame = {
  readonly characteristic: GdtCharacteristic
  readonly toleranceMm: number
  readonly placement: { readonly x: number; readonly y: number }
  readonly datums?: readonly string[]
  readonly label?: string
}

function readDrawingBridge(): DrawingBridge {
  const cadAny = (fab().cad as unknown) as DrawingBridge
  return {
    projectDrawing: cadAny.projectDrawing,
    dimensionDrawing: cadAny.dimensionDrawing,
    sectionDrawing: cadAny.sectionDrawing,
    attachTitleBlock: cadAny.attachTitleBlock,
    extractDrawingGeometry: cadAny.extractDrawingGeometry,
    drawingBomTable: cadAny.drawingBomTable,
    annotateGdt: cadAny.annotateGdt,
    detailDrawing: cadAny.detailDrawing,
  }
}

/** GD&T characteristic ids in the toolbar dropdown order (ASME Y14.5). Mirrors
 * `gdtCharacteristicSchema`. Exported for the model-level test pin. */
export const GDT_CHARACTERISTIC_ORDER: readonly GdtCharacteristic[] = [
  'straightness',
  'flatness',
  'circularity',
  'cylindricity',
  'profile_of_a_line',
  'profile_of_a_surface',
  'perpendicularity',
  'angularity',
  'parallelism',
  'position',
  'concentricity',
  'symmetry',
  'circular_runout',
  'total_runout',
] as const

/** Human labels for the GD&T characteristic dropdown. */
export const GDT_CHARACTERISTIC_LABELS: Record<GdtCharacteristic, string> = {
  straightness: 'Straightness',
  flatness: 'Flatness',
  circularity: 'Circularity',
  cylindricity: 'Cylindricity',
  profile_of_a_line: 'Profile of a Line',
  profile_of_a_surface: 'Profile of a Surface',
  perpendicularity: 'Perpendicularity',
  angularity: 'Angularity',
  parallelism: 'Parallelism',
  position: 'Position',
  concentricity: 'Concentricity',
  symmetry: 'Symmetry',
  circular_runout: 'Circular Runout',
  total_runout: 'Total Runout',
}

/**
 * Surface-finish material-removal variants in the toolbar dropdown order
 * (ISO 1302 / ASME Y14.36). Mirrors `surfaceFinishMaterialSchema`. Exported for
 * the model-level test pin.
 */
export const SURFACE_FINISH_MATERIAL_ORDER: readonly SurfaceFinishMaterial[] = [
  'any',
  'required',
  'prohibited',
] as const

/** Human labels for the surface-finish material dropdown. */
export const SURFACE_FINISH_MATERIAL_LABELS: Record<SurfaceFinishMaterial, string> = {
  any: 'Any process',
  required: 'Removal required',
  prohibited: 'Removal prohibited',
}

/** Surface-finish lay-direction ids in the toolbar dropdown order (after "none"). */
export const SURFACE_FINISH_LAY_ORDER: readonly SurfaceFinishLay[] = [
  'parallel',
  'perpendicular',
  'crossed',
  'multidirectional',
  'circular',
  'radial',
  'particulate',
] as const

/** Sentinel select value meaning "no lay specified". */
export const SURFACE_FINISH_LAY_NONE = 'none'

/**
 * Parse the operator's datum free-text field into an ordered, de-duplicated,
 * capped (≤3) list of non-empty datum letters. Accepts comma / whitespace
 * separation ("A, B C" → ["A","B","C"]). The strings are NOT escaped here — the
 * sidecar is the escaping trust boundary (Safety Rule 4). Pure; exported for the
 * test pin.
 */
export function parseDatumField(raw: string): string[] {
  const parts = raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of parts) {
    if (seen.has(p)) continue
    seen.add(p)
    out.push(p)
    if (out.length === 3) break
  }
  return out
}

// -- CAD V1.5 -- Dimension / Section / Title-block types ----------------

/**
 * Dimension kinds the V1.5 toolbar can build. Mirrors
 * ``CadDimensionKind`` in the sidecar protocol. Kept as a string union so
 * the renderer can render each entry's controls without a sidecar round-
 * trip.
 */
export type DrawingDimensionKind = 'distance' | 'radius' | 'diameter' | 'angle'

/** Discriminated dimension spec, mirroring ``CadDimensionSpec``. */
export type DrawingDimensionSpec =
  | {
      readonly kind: 'distance'
      readonly p1: { readonly x: number; readonly y: number }
      readonly p2: { readonly x: number; readonly y: number }
      readonly offset?: number
      readonly label?: string
    }
  | {
      readonly kind: 'radius'
      readonly center: { readonly x: number; readonly y: number }
      readonly edge: { readonly x: number; readonly y: number }
      readonly label?: string
    }
  | {
      readonly kind: 'diameter'
      readonly center: { readonly x: number; readonly y: number }
      readonly edge: { readonly x: number; readonly y: number }
      readonly label?: string
    }
  | {
      readonly kind: 'angle'
      readonly vertex: { readonly x: number; readonly y: number }
      readonly arm1: { readonly x: number; readonly y: number }
      readonly arm2: { readonly x: number; readonly y: number }
      readonly label?: string
    }

/** Section-plane axis vocabulary, mirroring ``CadSectionAxis``. */
export type DrawingSectionAxis = 'x' | 'y' | 'z'

/** Section-plane spec, mirroring ``CadSectionPlane``. */
export type DrawingSectionPlane = {
  readonly axis: DrawingSectionAxis
  readonly offset: number
  readonly keepSide?: 'positive' | 'negative'
}

/** Title-block metadata fields. */
export type DrawingTitleBlock = {
  readonly name: string
  readonly scale: string
  readonly author: string
  readonly date: string
  readonly sheet: string
}

/** Default title-block values. Pure helper exported for the test pin. */
export function defaultTitleBlock(): DrawingTitleBlock {
  return { name: '', scale: '1:1', author: '', date: '', sheet: '1 of 1' }
}

/**
 * Build a fresh dimension spec for a given kind with sensible default
 * coordinates. Exported for the test pin so the test can stand up a typed
 * spec without copy-pasting the literal shape.
 */
export function makeDefaultDimensionSpec(kind: DrawingDimensionKind): DrawingDimensionSpec {
  if (kind === 'distance') {
    return {
      kind: 'distance',
      p1: { x: 0, y: 0 },
      p2: { x: 30, y: 0 },
      offset: 8,
    }
  }
  if (kind === 'radius' || kind === 'diameter') {
    return {
      kind,
      center: { x: 0, y: 0 },
      edge: { x: 10, y: 0 },
    }
  }
  return {
    kind: 'angle',
    vertex: { x: 0, y: 0 },
    arm1: { x: 10, y: 0 },
    arm2: { x: 0, y: 10 },
  }
}

/** Dimension toolbar button order. Stable across renders for the test pin. */
export const DIMENSION_TOOL_ORDER: readonly DrawingDimensionKind[] = [
  'distance',
  'radius',
  'diameter',
  'angle',
] as const

/** Dimension button labels. */
export const DIMENSION_LABELS: Record<DrawingDimensionKind, string> = {
  distance: 'Point-to-point',
  radius: 'Radius',
  diameter: 'Diameter',
  angle: 'Angle',
}

/** Stable testid generator for the dimension buttons. */
export function dimensionToolTestId(kind: DrawingDimensionKind): string {
  return `design-drawing-dim-${kind}`
}

// -- CAD V2.5 -- Set-based dimension run tools (ordinate / baseline / chain) --

/**
 * The four set-based run tools in the dimension toolbar. Ordinate is split
 * into per-axis buttons (rather than an axis toggle field) because the
 * dimension group is a flat button row -- a pressed button IS the armed
 * state, so `aria-pressed` per axis keeps the armed axis unambiguous.
 */
export type DimensionRunKind = 'ordinate-x' | 'ordinate-y' | 'baseline' | 'chain'

/** Run-tool button order. Stable across renders for the test pin. */
export const DIMENSION_RUN_TOOL_ORDER: readonly DimensionRunKind[] = [
  'ordinate-x',
  'ordinate-y',
  'baseline',
  'chain',
] as const

/** Run-tool button labels. */
export const DIMENSION_RUN_LABELS: Record<DimensionRunKind, string> = {
  'ordinate-x': 'Ordinate X',
  'ordinate-y': 'Ordinate Y',
  baseline: 'Baseline',
  chain: 'Chain',
}

/** Stable testid generator for the run-tool buttons. */
export function dimensionRunToolTestId(kind: DimensionRunKind): string {
  return `design-drawing-dim-${kind}`
}

/** Idle-state tooltip per run tool. */
const DIMENSION_RUN_TITLES: Record<DimensionRunKind, string> = {
  'ordinate-x': 'Click the 0-datum origin, then each feature to add X ordinate read-outs',
  'ordinate-y': 'Click the 0-datum origin, then each feature to add Y ordinate read-outs',
  baseline: 'Click the base feature, then each feature to stack baseline dimensions',
  chain: 'Click from point to point to chain dimensions end-to-end',
}

/** Map an armed run state back to its toolbar button kind (null when idle). */
function runStateToKind(state: DimensionRunState | null): DimensionRunKind | null {
  if (state === null) return null
  if (state.kind === 'ordinate') return state.axis === 'x' ? 'ordinate-x' : 'ordinate-y'
  return state.kind
}

/**
 * One-line list label for a persisted dimension (the per-item delete rows).
 * Pure; exported for the test pin.
 */
export function dimensionRowLabel(dim: DrawingDimension): string {
  const v = dim.value.toFixed(1)
  switch (dim.kind) {
    case 'linear':
      return `Distance ${v}`
    case 'radial':
      return `Radius ${v}`
    case 'diameter':
      return `Diameter ${v}`
    case 'angular':
      return `Angle ${v} deg`
    case 'ordinate':
      return `Ordinate ${dim.axis.toUpperCase()} ${v}`
    case 'baseline':
      return `Baseline ${v}`
    case 'chain':
      return `Chain ${v}`
  }
}

/**
 * Build a DrawingDimensionSpec from completed placement coordinates.
 * For kinds with two-point placement (distance), p1/p2 map directly.
 * For radius/diameter/angle the two captured points are used as
 * center+edge / center+edge / vertex+arm2 respectively.
 */
function makePlacedDimensionSpec(
  kind: DrawingDimensionKind,
  p1: { readonly x: number; readonly y: number },
  p2: { readonly x: number; readonly y: number }
): DrawingDimensionSpec {
  if (kind === 'distance') {
    return { kind: 'distance', p1, p2, offset: 8 }
  }
  if (kind === 'radius') {
    return { kind: 'radius', center: p1, edge: p2 }
  }
  if (kind === 'diameter') {
    return { kind: 'diameter', center: p1, edge: p2 }
  }
  // angle: vertex = p1, arm1 along +x from p1, arm2 = p2
  return {
    kind: 'angle',
    vertex: p1,
    arm1: { x: p1.x + 10, y: p1.y },
    arm2: p2,
  }
}

// -- CAD V2 -- BOM table column / row wire shapes (mirror the frozen
// `cad.drawing_bom_table` contract). -------------------------------------------

/** BOM column keys the table affordance can request, in render order. */
export type DrawingBomColumn =
  | 'item'
  | 'partName'
  | 'quantity'
  | 'partNumber'
  | 'material'
  | 'vendor'
  | 'notes'

/** One BOM row passed to `cad.drawing_bom_table` (rendered verbatim). */
export type DrawingBomTableRow = {
  readonly item: string
  readonly partName: string
  readonly quantity: number
  readonly partNumber?: string
  readonly material?: string
  readonly vendor?: string
  readonly notes?: string
}

// -- Drawings RENDERER half (gold-standard enhancement) -- sheet tabs, section
// view option, and a placeable BOM table. Every export below is an ADDITIVE,
// typed seam: the engine agent's matching shared modules (multi-sheet
// hydrate / sheet ops / deriveDrawingBom / section-view spec) are consumed
// through the OPTIONAL props declared on {@link DrawingViewProps}. When a prop
// is absent at build time the renderer degrades to an honest fallback (a single
// implicit sheet / a placeholder / an empty state), so the existing render-pins
// stay green and the Integrate phase only has to wire the props through. ------

/**
 * One sheet entry the tab strip renders. A deliberately MINIMAL structural
 * shape (id + display name) so it is compatible-by-structure with the engine
 * agent's persisted `DrawingSheet` (a superset) without importing it -- keeping
 * this module's only shared-schema dependency the annotation types it already
 * uses. The host maps its persisted sheet list down to this shape and re-points
 * the existing single-sheet `persisted*` props at the active sheet, so per-sheet
 * edits keep flowing through the Cycle-259 `onDrawing` persist seam (this
 * component never owns the sheet bytes -- it reports intent up).
 */
export type DrawingSheetTab = {
  readonly id: string
  readonly name: string
}

/** Stable testid generator for a sheet tab. Exported for the unit-test pin. */
export function drawingSheetTabTestId(id: string): string {
  return `design-drawing-sheet-tab-${id}`
}

/**
 * The implicit single-sheet fallback used when the host does NOT supply a
 * `sheets` prop (uncontrolled mode). Mirrors the persistence layer's
 * `PRIMARY_DRAWING_SHEET_ID` / name so the visible tab matches the one logical
 * sheet the legacy single-sheet persist seam writes -- declared locally (not
 * imported) to keep the design domain disjoint from the shared module the
 * engine agent owns.
 */
const FALLBACK_SHEET_ID = 'sheet-primary'
const FALLBACK_SHEET_NAME = 'Drawing'

/**
 * One row rendered in the placeable BOM table. This is the engine
 * {@link DrawingBomRow} shape verbatim (`item` / `qty` / `partNumber` /
 * `description`) -- the EXACT return type of the shared `deriveDrawingBom`
 * helper, so the host threads `deriveDrawingBom(...)` straight into the
 * `bomLines` prop with no adapter. Re-exported under this name so the renderer's
 * typed-seam surface is self-describing (the rows it paints are persistable BOM
 * rows). `item` is the 1-based find-number; `description` is the part name;
 * `partNumber` is the durable identifier shown in the Source column.
 */
export type DrawingBomLine = DrawingBomRow

/**
 * UI-level view selection. Extends the projection {@link DrawingViewAxis} with a
 * `'section'` pseudo-view so "Section" sits in the toolbar ALONGSIDE
 * Front/Top/Right/Iso (the task requirement) WITHOUT widening the bridge `view`
 * parameter (which stays a real orthographic/iso axis). When `'section'` is
 * active the component drives the section projection path using the section
 * plane for the cut and renders an honest "section preview not available"
 * placeholder if the projector yields nothing.
 */
export type DrawingUiView = DrawingViewAxis | 'section'

/** Toolbar order including the Section pseudo-view (after the four real axes). */
const UI_TOOLBAR_ORDER: readonly DrawingUiView[] = [
  'front',
  'top',
  'right',
  'iso',
  'section',
] as const

/** Display label for the Section pseudo-view button. */
const SECTION_VIEW_LABEL = 'Section'

/** Human axis labels for the section honest-placeholder copy. */
const SECTION_AXIS_LABEL: Record<DrawingSectionAxis, string> = {
  x: 'X',
  y: 'Y',
  z: 'Z',
}

/** Stable testid for the Section view button (parallels {@link drawingViewTestId}). */
export const DRAWING_SECTION_VIEW_TESTID = 'design-drawing-view-section'

/**
 * Coerce one raw snap point from the `cad.extract_drawing_geometry` result
 * into the renderer's typed FreshSnapPoint. The IPC coercer already guarantees
 * the wire shape (`{ id, x, y, kind, sourceId }`), but the bridge envelope is
 * permissive (`Record<string, unknown>`), so this re-checks defensively.
 * Returns null on a malformed entry (it drops, never throws).
 */
function coerceFreshSnapPoint(value: unknown): (FreshSnapPoint & { kind: SnapPointKind }) | null {
  if (!value || typeof value !== 'object') return null
  const s = value as Record<string, unknown>
  if (typeof s.id !== 'string' || s.id.length === 0) return null
  if (typeof s.x !== 'number' || !Number.isFinite(s.x)) return null
  if (typeof s.y !== 'number' || !Number.isFinite(s.y)) return null
  const kind = s.kind
  if (kind !== 'vertex' && kind !== 'endpoint' && kind !== 'midpoint' && kind !== 'center') {
    return null
  }
  // `sourceId` is the live anchor link. Fall back to the snap point's own id
  // when the sidecar omitted it (older payloads), so the anchor still resolves.
  const sourceId =
    typeof s.sourceId === 'string' && s.sourceId.length > 0 ? s.sourceId : s.id
  return { id: s.id, x: s.x, y: s.y, sourceId, kind }
}

/**
 * Pull the `snapPoints` array out of a raw `cad.extract_drawing_geometry`
 * result envelope, coercing each entry. Malformed entries drop. Returns [] when
 * the field is missing or not an array.
 */
function readSnapPointsFromGeometry(
  result: Record<string, unknown>
): Array<FreshSnapPoint & { kind: SnapPointKind }> {
  const raw = result.snapPoints
  if (!Array.isArray(raw)) return []
  const out: Array<FreshSnapPoint & { kind: SnapPointKind }> = []
  for (const entry of raw) {
    const c = coerceFreshSnapPoint(entry)
    if (c) out.push(c)
  }
  return out
}

/**
 * Map a persisted (associative) {@link DrawingDimension} back into the
 * `DrawingDimensionSpec` shape the existing `cad.dimension_drawing` SVG path
 * consumes. The dimension-drawing handler is coordinate-driven (it does NOT
 * understand anchors), so we feed it each anchor's `cachedPoint` -- which is
 * always present and was refreshed by the re-anchor pass on the last geometry
 * fetch. Ordinate / baseline / chain members are FILTERED OUT before this
 * mapper runs (they paint client-side via the pure dimension-set emitters in
 * `drawing-annotation-model.ts`); the fallback cases below keep the mapper
 * total over the union should one ever slip through (degrading to a
 * `distance` overlay from the member's two governing anchors).
 */
function persistedDimensionToSpec(dim: DrawingDimension): DrawingDimensionSpec {
  switch (dim.kind) {
    case 'linear':
      return {
        kind: 'distance',
        p1: { x: dim.start.cachedPoint.x, y: dim.start.cachedPoint.y },
        p2: { x: dim.end.cachedPoint.x, y: dim.end.cachedPoint.y },
        offset: 8,
        ...(dim.label !== undefined ? { label: dim.label } : {}),
      }
    case 'radial':
      return {
        kind: 'radius',
        center: { x: dim.center.cachedPoint.x, y: dim.center.cachedPoint.y },
        edge: { x: dim.on.cachedPoint.x, y: dim.on.cachedPoint.y },
        ...(dim.label !== undefined ? { label: dim.label } : {}),
      }
    case 'diameter':
      return {
        kind: 'diameter',
        center: { x: dim.center.cachedPoint.x, y: dim.center.cachedPoint.y },
        edge: { x: dim.on.cachedPoint.x, y: dim.on.cachedPoint.y },
        ...(dim.label !== undefined ? { label: dim.label } : {}),
      }
    case 'angular':
      return {
        kind: 'angle',
        vertex: { x: dim.vertex.cachedPoint.x, y: dim.vertex.cachedPoint.y },
        arm1: { x: dim.arm1.cachedPoint.x, y: dim.arm1.cachedPoint.y },
        arm2: { x: dim.arm2.cachedPoint.x, y: dim.arm2.cachedPoint.y },
        ...(dim.label !== undefined ? { label: dim.label } : {}),
      }
    case 'ordinate':
    case 'baseline':
      // origin → feature read-out renders as a distance overlay.
      return {
        kind: 'distance',
        p1: { x: dim.origin.cachedPoint.x, y: dim.origin.cachedPoint.y },
        p2: { x: dim.feature.cachedPoint.x, y: dim.feature.cachedPoint.y },
        offset: 8,
        ...(dim.label !== undefined ? { label: dim.label } : {}),
      }
    case 'chain':
      return {
        kind: 'distance',
        p1: { x: dim.start.cachedPoint.x, y: dim.start.cachedPoint.y },
        p2: { x: dim.end.cachedPoint.x, y: dim.end.cachedPoint.y },
        offset: 8,
        ...(dim.label !== undefined ? { label: dim.label } : {}),
      }
  }
}

/**
 * Build an anchored {@link DrawingDimension} from the placement-machine's two
 * captured clicks. The toolbar kinds are the legacy
 * `distance|radius|diameter|angle` union; they map onto the schema kinds
 * `linear|radial|diameter|angular`. `angle` only captures two clicks, so the
 * first arm is synthesized along +x from the vertex (mirroring the legacy
 * `makePlacedDimensionSpec` behaviour), as a FREE (non-associative) anchor.
 */
function buildAnchoredDimension(
  kind: DrawingDimensionKind,
  click1: ResolvedClick,
  click2: ResolvedClick
): DrawingDimension {
  if (kind === 'distance') {
    return buildLinearDimension(click1, click2)
  }
  if (kind === 'radius') {
    return buildRadialDimension(click1, click2)
  }
  if (kind === 'diameter') {
    return buildDiameterDimension(click1, click2)
  }
  // angle: vertex = click1, arm1 = free point +x from the vertex, arm2 = click2.
  const syntheticArm1: ResolvedClick = {
    point: { x: click1.point.x + 10, y: click1.point.y },
    sourceId: null,
  }
  return buildAngularDimension(click1, syntheticArm1, click2)
}

/**
 * GD&T / Detail single-or-two-click tool placement mode. Mutually exclusive
 * with the dimension placement machine (`DimensionPlacementState`): starting a
 * tool clears any active dimension placement and vice-versa, so a click is never
 * ambiguous between the two pipelines.
 *
 * `null`                              — no tool active.
 * `{ tool: 'gdt' }`                   — next click anchors a feature control frame
 *                                       (one-click placement).
 * `{ tool: 'detail', step: 0 }`       — next click is the crop centre.
 * `{ tool: 'detail', step: 1, center}`— next click defines the radius (centre→click).
 */
type ToolMode =
  | null
  | { readonly tool: 'gdt' }
  | { readonly tool: 'surface-finish' }
  | { readonly tool: 'note' }
  | { readonly tool: 'center-mark' }
  | { readonly tool: 'centerline'; readonly step: 0 }
  | { readonly tool: 'centerline'; readonly step: 1; readonly start: ResolvedClick }
  | { readonly tool: 'detail'; readonly step: 0 }
  | { readonly tool: 'detail'; readonly step: 1; readonly center: { readonly x: number; readonly y: number } }

/**
 * Order of buttons in the toolbar. Front-Top-Right-Iso matches the
 * mechanical-drawing convention engineers expect (three orthographic
 * + one perspective).
 */
const TOOLBAR_ORDER: readonly DrawingViewAxis[] = [
  'front',
  'top',
  'right',
  'iso',
] as const

export function DrawingView({
  partHandle,
  initialView = 'front',
  initialHlr = false,
  onExport,
  onToast,
  previewSvg,
  initialDimensions,
  initialSectionPlane,
  initialTitleBlock,
  snapTolerance = DEFAULT_SNAP_TOLERANCE_PX,
  persistedDimensions,
  onPersistDimensions,
  bomRows,
  bomColumns,
  persistedGdtFrames,
  onPersistGdt,
  persistedSurfaceFinishes,
  onPersistSurfaceFinishes,
  persistedNotes,
  onPersistNotes,
  persistedCenterMarks,
  onPersistCenterMarks,
  persistedCenterlines,
  onPersistCenterlines,
  onDetail,
  onPersistTitleBlock,
  sheets,
  activeSheetId,
  onSelectSheet,
  onAddSheet,
  onRenameSheet,
  onDeleteSheet,
  bomLines,
}: DrawingViewProps): JSX.Element {
  const [activeView, setActiveView] = useState<DrawingViewAxis>(initialView)
  /**
   * UI-level view selection (Front/Top/Right/Iso/Section). Separate from
   * `activeView` (the real projection axis the bridge consumes): selecting
   * Section flips this to `'section'` while `activeView` keeps the orthographic
   * axis used to orient the cut. Seeded from `initialSectionPlane` so a render
   * pin can land the component directly in the Section view.
   */
  const [uiView, setUiView] = useState<DrawingUiView>(
    initialSectionPlane !== undefined ? 'section' : initialView,
  )
  const [svg, setSvg] = useState<string | null>(previewSvg ?? null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /**
   * Wave 6 (HLR) — "Hidden lines" toggle. When ON, the base projection is
   * fetched with `includeHlr: true` so the sidecar returns true
   * hidden-line-removal linework (visible solid + hidden dashed, distinct
   * classes). Toggling flips this flag, which is in the projection effect's
   * dep array, so the drawing re-projects on the same async/busy path. Held in
   * component state only (see `initialHlr` for the persistence caveat).
   */
  const [hlrEnabled, setHlrEnabled] = useState<boolean>(initialHlr)

  /**
   * Whether this instance is in CONTROLLED (persisted) dimension mode. When the
   * host threads `persistedDimensions`, every placed dimension is an anchored
   * `DrawingDimension` pushed up via `onPersistDimensions`; the legacy ephemeral
   * `dimensions` state is bypassed. When omitted, the legacy in-state flow runs.
   */
  const controlled = persistedDimensions !== undefined

  // V1.5 state: dimensions, section toggle, and title-block metadata.
  const [dimensions, setDimensions] = useState<DrawingDimensionSpec[]>(
    initialDimensions ? [...initialDimensions] : [],
  )
  const [sectionEnabled, setSectionEnabled] = useState<boolean>(
    initialSectionPlane !== undefined,
  )
  const [sectionPlane, setSectionPlane] = useState<DrawingSectionPlane>(
    initialSectionPlane ?? { axis: 'z', offset: 0, keepSide: 'positive' },
  )
  /**
   * Cutting-plane label threaded to the section path (`cad.section_drawing`'s
   * `label`). Defaults to "A-A". The sidecar normalizes + entity-escapes it
   * before any `<text>` node (Safety Rule 4) -- the renderer passes the operator
   * string through verbatim (never escapes here, which would mask a regression).
   */
  const [sectionLabel, setSectionLabel] = useState<string>('A-A')
  /**
   * True when the Section pseudo-view is active but the projector produced NO
   * geometry (handler returned an error, or the section bridge is absent). Drives
   * the honest "section preview not available" placeholder -- we NEVER fabricate
   * section linework, so an unsupported part shows an honest message instead.
   */
  const [sectionUnavailable, setSectionUnavailable] = useState<boolean>(false)
  const [titleBlock, setTitleBlock] = useState<DrawingTitleBlock>(
    initialTitleBlock ?? defaultTitleBlock(),
  )

  // -- CAD V1.5 GD&T form + tool state --------------------------------------

  /** Whether this instance is in CONTROLLED (persisted) GD&T mode. */
  const gdtControlled = persistedGdtFrames !== undefined

  /** The characteristic the next placed frame will carry. */
  const [gdtCharacteristic, setGdtCharacteristic] = useState<GdtCharacteristic>('position')
  /** Tolerance-zone size (mm) for the next placed frame. */
  const [gdtTolerance, setGdtTolerance] = useState<number>(0.1)
  /**
   * Datum free-text field (e.g. "A B C"). Parsed into ≤3 ordered datum letters
   * at placement time. Operator free-text -- NOT escaped here (the sidecar is the
   * escaping boundary, Safety Rule 4).
   */
  const [gdtDatums, setGdtDatums] = useState<string>('')

  /**
   * Tool placement mode -- mutually exclusive with the dimension `placementState`.
   * `null`              -- no GD&T / detail tool active.
   * `{ tool: 'gdt' }`   -- next click anchors a feature control frame.
   * detail step 0       -- next click is the crop centre.
   * detail step 1       -- next click defines the crop radius (centre→click).
   */
  const [toolMode, setToolMode] = useState<ToolMode>(null)

  /** Detail-view magnification (e.g. 2 => 2:1). */
  const [detailScale, setDetailScale] = useState<number>(2)
  /** Detail-view label ("DETAIL A"). Operator free-text; escaped sidecar-side. */
  const [detailLabel, setDetailLabel] = useState<string>('DETAIL A')

  /**
   * Ids of persisted GD&T frames whose anchor link no longer resolves against
   * the latest fetched geometry (badged `dangling`). Recomputed on every fetch.
   */
  const [gdtDanglingIds, setGdtDanglingIds] = useState<ReadonlySet<string>>(new Set())

  // -- CAD V1.5 Surface-finish form + tool state ----------------------------

  /** Whether this instance is in CONTROLLED (persisted) surface-finish mode. */
  const surfaceFinishControlled = persistedSurfaceFinishes !== undefined

  /** Material-removal variant the next placed symbol will carry (ISO 1302). */
  const [surfaceFinishMaterial, setSurfaceFinishMaterial] =
    useState<SurfaceFinishMaterial>('required')
  /** Primary roughness value Ra (µm) for the next placed symbol. */
  const [surfaceFinishRa, setSurfaceFinishRa] = useState<number>(1.6)
  /** Optional machining-allowance value (mm) for the next placed symbol. */
  const [surfaceFinishAllowance, setSurfaceFinishAllowance] = useState<number>(0)
  /** Optional lay-direction symbol for the next placed symbol (`null` = none). */
  const [surfaceFinishLay, setSurfaceFinishLay] = useState<SurfaceFinishLay | null>(null)

  /**
   * Ids of persisted surface-finish symbols whose anchor link no longer resolves
   * against the latest fetched geometry (badged `dangling`). Recomputed on every
   * fetch (mirrors `gdtDanglingIds`).
   */
  const [surfaceFinishDanglingIds, setSurfaceFinishDanglingIds] =
    useState<ReadonlySet<string>>(new Set())

  // -- CAD V1.5 Note form + tool state ---------------------------------------

  /** Whether this instance is in CONTROLLED (persisted) notes mode. */
  const noteControlled = persistedNotes !== undefined

  /**
   * Draft text for the NEXT placed note. Operator free-text -- entity-escaped
   * by the client-side SVG emitter (`noteToSvg` in the pure model module), the
   * escaping trust boundary for this annotation (Safety Rule 4).
   */
  const [noteDraft, setNoteDraft] = useState<string>('')

  /**
   * Ids of persisted notes whose leader anchor no longer resolves against the
   * latest fetched geometry (badged `dangling`). Recomputed on every fetch
   * (mirrors `surfaceFinishDanglingIds`).
   */
  const [noteDanglingIds, setNoteDanglingIds] = useState<ReadonlySet<string>>(new Set())

  // -- CAD V1.5 Center-mark + centerline form + tool state --------------------

  /** Whether this instance is in CONTROLLED (persisted) center-mark mode. */
  const centerMarkControlled = persistedCenterMarks !== undefined
  /** Whether this instance is in CONTROLLED (persisted) centerline mode. */
  const centerlineControlled = persistedCenterlines !== undefined

  /** Crosshair half-extent (SVG-mm) for the NEXT placed center mark. */
  const [centerMarkSize, setCenterMarkSize] = useState<number>(DEFAULT_CENTER_MARK_SIZE_MM)

  /**
   * Ids of persisted center marks whose anchor no longer resolves against the
   * latest fetched geometry (badged `dangling`). Recomputed on every fetch
   * (mirrors `noteDanglingIds`).
   */
  const [centerMarkDanglingIds, setCenterMarkDanglingIds] =
    useState<ReadonlySet<string>>(new Set())
  /** Ids of persisted centerlines with at least one dangling endpoint anchor. */
  const [centerlineDanglingIds, setCenterlineDanglingIds] =
    useState<ReadonlySet<string>>(new Set())

  // -- CAD V2 placement state -----------------------------------------------

  /**
   * Interactive placement state machine. null = idle.
   * Non-null = operator clicked a dimension button and is placing p1/p2.
   */
  const [placementState, setPlacementState] = useState<DimensionPlacementState>(null)

  /**
   * Set-based dimension RUN state (ordinate / baseline / chain -- the pure
   * machine in `drawing-annotation-model.ts`). Mutually exclusive with both
   * the two-click `placementState` machine and the GD&T / detail `toolMode`:
   * arming any pipeline clears the others so a click is never ambiguous.
   * `null` = no run armed. Esc or re-clicking the armed button ends a run.
   */
  const [runState, setRunState] = useState<DimensionRunState | null>(null)

  /**
   * Per-click history for the IN-PROGRESS placement. Parallel to the placement
   * machine's step count: each entry is a {@link ResolvedClick} carrying the
   * resolved SVG-mm coordinate AND the `sourceId` of the snap target it landed
   * on (`null` for a free click). On completion these become the dimension's
   * associative anchors. A ref (not state) because it is mutable accumulation
   * that never drives a render -- the placement machine owns the visible step
   * count -- and so committing from it stays out of a state updater (no impure
   * side effect during render). Reset whenever placement starts/ends.
   */
  const clickHistoryRef = useRef<ResolvedClick[]>([])

  /**
   * Snap points list (resolver shape). Populated by the geometry-fetch effect
   * from `cad.extract_drawing_geometry`. `resolveSnap` snaps the cursor to the
   * nearest projected vertex / edge endpoint / midpoint / arc-center within
   * `snapTolerance` SVG units. Empty until the first successful fetch (then
   * free-cursor placement).
   */
  const [snapPoints, setSnapPoints] = useState<readonly SnapPoint[]>([])

  /**
   * Parallel snap-point list carrying the stable wire ids (`id` + `sourceId`).
   * `snapPoints` (above) drops the ids for the resolver; this list keeps them so
   * (a) a snapped click can record the right anchor `refId`, and (b) the
   * re-anchor pass can refresh / dangle-flag persisted dimensions. Same length
   * and order as `snapPoints`.
   */
  const [freshSnapPoints, setFreshSnapPoints] = useState<readonly FreshSnapPoint[]>([])

  /**
   * Ids of persisted dimensions whose anchor link no longer resolves against
   * the latest fetched geometry (badged `dangling` in the UI). Recomputed by
   * the re-anchor pass on every geometry fetch.
   */
  const [danglingIds, setDanglingIds] = useState<ReadonlySet<string>>(new Set())

  /**
   * Whether a geometry projection has actually completed for the current
   * handle/view. Gates the dangling computation: before the first fetch lands
   * (or while a re-fetch is in flight after a handle/view change) we must NOT
   * flag every associative dimension dangling just because `freshSnapPoints`
   * is still empty -- that would be a false-positive flash. Reset to false on
   * each handle/view change, set true once a fetch resolves (even with zero
   * points, which is a legitimate "nothing projected" answer).
   */
  const [geometryLoaded, setGeometryLoaded] = useState(false)

  /** Whether Alt is held (disables snap). */
  const [altHeld, setAltHeld] = useState(false)

  /** Currently hovered snap candidate (null when snapPoints is empty). */
  const [hoveredSnap, setHoveredSnap] = useState<SnapResult | null>(null)

  /** Ref to the SVG host div -- used to locate the inner <svg> for coord mapping. */
  const svgHostRef = useRef<HTMLDivElement>(null)

  // -- Sheet-tab strip state (inline rename) --------------------------------

  /** id of the sheet currently being inline-renamed, or null. */
  const [editingSheetId, setEditingSheetId] = useState<string | null>(null)
  /** Draft text for the in-progress sheet rename. */
  const [sheetNameDraft, setSheetNameDraft] = useState<string>('')
  /** Focus ref for the sheet-rename input. */
  const sheetRenameInputRef = useRef<HTMLInputElement>(null)

  // -- Controlled title-block mirror ----------------------------------------
  //
  // In controlled mode (onPersistTitleBlock supplied), sync local titleBlock to
  // an externally-changed `initialTitleBlock` (project-open hydration that lands
  // after mount). Value-guarded so it is a no-op when the value already matches
  // (the user-edit round-trip), so it never clobbers an in-progress edit.
  useEffect(() => {
    if (onPersistTitleBlock === undefined || initialTitleBlock === undefined) return
    setTitleBlock((prev) =>
      JSON.stringify(prev) === JSON.stringify(initialTitleBlock) ? prev : initialTitleBlock,
    )
  }, [onPersistTitleBlock, initialTitleBlock])

  // -- Alt key tracking -----------------------------------------------------

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Alt') setAltHeld(true)
      if (e.key === 'Escape') {
        // End any in-progress placement: the two-click dimension machine, the
        // GD&T / note / center / detail tools, and set-based dimension runs.
        setPlacementState(null)
        setToolMode(null)
        setRunState(null)
        setHoveredSnap(null)
        clickHistoryRef.current = []
      }
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key === 'Alt') setAltHeld(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  // -- Existing callbacks ---------------------------------------------------

  const toast = useCallback(
    (kind: 'ok' | 'err' | 'warn', message: string): void => {
      onToast?.(kind, message)
    },
    [onToast],
  )

  // -- Snap helpers ---------------------------------------------------------

  /**
   * Resolve pointer client coords to SVG space and run snap resolution.
   * Returns the free SVG coordinate, the snap result (or null), and the
   * `sourceId` of the snapped geometry (or null when free) -- the latter is the
   * associative anchor `refId` recorded on a placed dimension.
   */
  const resolveCursorSvg = useCallback(
    (
      clientX: number,
      clientY: number,
      preferKind?: SnapPointKind
    ): {
      svgCoord: { x: number; y: number }
      snap: SnapResult | null
      sourceId: string | null
    } => {
      const host = svgHostRef.current
      const svgEl = host ? host.querySelector('svg') : null
      if (svgEl === null) {
        return { svgCoord: { x: clientX, y: clientY }, snap: null, sourceId: null }
      }
      const svgCoord = clientToSvgCoord(clientX, clientY, svgEl as SVGSVGElement)
      // Kind-preferring resolution: when the active tool targets a specific
      // snap kind (center marks -> 'center'), try that kind ALONE first, then
      // fall back to the honest nearest-any-kind snap.
      let snap: SnapResult | null = null
      if (preferKind !== undefined) {
        snap = resolveSnap(
          svgCoord,
          snapPoints.filter((sp) => sp.kind === preferKind),
          snapTolerance,
          altHeld
        )
      }
      if (snap === null) {
        snap = resolveSnap(svgCoord, snapPoints, snapTolerance, altHeld)
      }
      const sourceId = snap?.sourceId ?? null
      return { svgCoord, snap, sourceId }
    },
    [snapPoints, snapTolerance, altHeld]
  )

  /**
   * Commit a completed two-click placement. In controlled (persisted) mode this
   * mints an anchored {@link DrawingDimension} from the captured clicks and
   * pushes it up via `onPersistDimensions`; otherwise it appends the legacy
   * ephemeral {@link DrawingDimensionSpec}.
   */
  const commitPlacement = useCallback(
    (kind: DrawingDimensionKind, clicks: readonly ResolvedClick[]): void => {
      const click1 = clicks[0]
      const click2 = clicks[1]
      if (click1 === undefined || click2 === undefined) return
      if (controlled) {
        const dim = buildAnchoredDimension(kind, click1, click2)
        onPersistDimensions?.([...(persistedDimensions ?? []), dim])
        toast('ok', `${DIMENSION_LABELS[kind]} dimension added.`)
        return
      }
      const spec = makePlacedDimensionSpec(kind, click1.point, click2.point)
      setDimensions((prev) => [...prev, spec])
    },
    [controlled, onPersistDimensions, persistedDimensions, toast]
  )

  /**
   * Persist one dimension minted by an armed set-based run (ordinate /
   * baseline / chain). Runs exist only in CONTROLLED mode -- the legacy
   * ephemeral spec union has no set-based kinds -- so an uncontrolled host
   * gets the standard "no persistence host" warning instead.
   */
  const commitRunDimension = useCallback(
    (dim: DrawingDimension): void => {
      if (!controlled) {
        toast('warn', 'Dimension placement is unavailable -- no persistence host wired.')
        return
      }
      onPersistDimensions?.([...(persistedDimensions ?? []), dim])
      toast('ok', `${dimensionRowLabel(dim)} added.`)
    },
    [controlled, onPersistDimensions, persistedDimensions, toast]
  )

  /**
   * Arm (or toggle off) a set-based dimension run. Re-clicking the armed
   * button ends the run; switching ordinate axis mid-run REUSES the picked
   * 0-datum origin. Cancels the two-click machine and any GD&T / detail tool
   * so a click is never ambiguous between pipelines. Esc also ends a run
   * (see the keydown effect above).
   */
  const armRun = useCallback((kind: DimensionRunKind): void => {
    setPlacementState(null)
    setToolMode(null)
    clickHistoryRef.current = []
    setHoveredSnap(null)
    setRunState((prev) => {
      if (runStateToKind(prev) === kind) return null
      if (kind === 'ordinate-x' || kind === 'ordinate-y') {
        const axis: OrdinateAxis = kind === 'ordinate-x' ? 'x' : 'y'
        const carriedOrigin = prev !== null && prev.kind === 'ordinate' ? prev.origin : null
        return startOrdinateRun(axis, carriedOrigin)
      }
      return kind === 'baseline' ? startBaselineRun() : startChainRun()
    })
  }, [])

  /** Delete one persisted dimension (per-item delete affordance). */
  const deleteDimension = useCallback(
    (id: string): void => {
      onPersistDimensions?.(removeDimension(persistedDimensions ?? [], id))
    },
    [onPersistDimensions, persistedDimensions]
  )

  /**
   * Commit a GD&T frame from a single resolved click. Mints an anchored
   * {@link GdtFeatureControlFrame} (reusing the same snap machinery dimensions
   * use) carrying the current characteristic / tolerance / parsed datums, then
   * pushes it onto the persisted list. Datums flow through verbatim -- the
   * sidecar escapes them (Safety Rule 4). No-op when GD&T is not controlled.
   */
  const commitGdtFrame = useCallback(
    (click: ResolvedClick): void => {
      if (!gdtControlled) {
        toast('warn', 'GD&T placement is unavailable -- no persistence host wired.')
        return
      }
      const frame = buildGdtFrame(click, {
        characteristic: gdtCharacteristic,
        toleranceMm: Number.isFinite(gdtTolerance) && gdtTolerance >= 0 ? gdtTolerance : 0,
        datums: parseDatumField(gdtDatums),
      })
      onPersistGdt?.([...(persistedGdtFrames ?? []), frame])
      toast('ok', `${GDT_CHARACTERISTIC_LABELS[gdtCharacteristic]} frame added.`)
    },
    [
      gdtControlled,
      gdtCharacteristic,
      gdtTolerance,
      gdtDatums,
      onPersistGdt,
      persistedGdtFrames,
      toast,
    ]
  )

  /**
   * Commit a surface-finish symbol from a single resolved click. Mints an
   * anchored {@link SurfaceFinishSymbol} (reusing the same snap machinery GD&T
   * frames use) carrying the current material / Ra / allowance / lay, then pushes
   * it onto the persisted list. Every field is a number or a closed enum -- there
   * is no operator free-text, so (unlike GD&T datums) there is no escaping
   * surface. No-op when surface-finish is not controlled.
   */
  const commitSurfaceFinish = useCallback(
    (click: ResolvedClick): void => {
      if (!surfaceFinishControlled) {
        toast('warn', 'Surface-finish placement is unavailable -- no persistence host wired.')
        return
      }
      const symbol = buildSurfaceFinish(click, {
        material: surfaceFinishMaterial,
        ra: Number.isFinite(surfaceFinishRa) && surfaceFinishRa >= 0 ? surfaceFinishRa : undefined,
        machiningAllowanceMm:
          Number.isFinite(surfaceFinishAllowance) && surfaceFinishAllowance > 0
            ? surfaceFinishAllowance
            : undefined,
        ...(surfaceFinishLay !== null ? { lay: surfaceFinishLay } : {}),
      })
      onPersistSurfaceFinishes?.([...(persistedSurfaceFinishes ?? []), symbol])
      toast('ok', `${SURFACE_FINISH_MATERIAL_LABELS[surfaceFinishMaterial]} surface finish added.`)
    },
    [
      surfaceFinishControlled,
      surfaceFinishMaterial,
      surfaceFinishRa,
      surfaceFinishAllowance,
      surfaceFinishLay,
      onPersistSurfaceFinishes,
      persistedSurfaceFinishes,
      toast,
    ]
  )

  /**
   * Commit a free-text note from a single resolved click. Mints a
   * {@link DrawingNote} carrying the toolbar draft text: a snapped click records
   * the feature as the note's LEADER anchor (associative, dangling-badged on
   * rebuild); a free click places a free-floating note block. The text flows
   * through VERBATIM -- it is entity-escaped client-side by the pure SVG emitter
   * (`noteToSvg`), the escaping trust boundary for this annotation (no sidecar
   * round-trip, Safety Rule 4). No-op when notes are not controlled.
   */
  const commitNote = useCallback(
    (click: ResolvedClick): void => {
      if (!noteControlled) {
        toast('warn', 'Note placement is unavailable -- no persistence host wired.')
        return
      }
      const text = noteDraft.trim()
      if (text.length === 0) {
        toast('warn', 'Type the note text before placing it.')
        return
      }
      const note = buildDrawingNote(click, text)
      onPersistNotes?.([...(persistedNotes ?? []), note])
      setNoteDraft('')
      toast('ok', note.leader !== undefined ? 'Leader note added.' : 'Note added.')
    },
    [noteControlled, noteDraft, onPersistNotes, persistedNotes, toast]
  )

  /**
   * Commit a center mark from a single resolved click. Mints an anchored
   * {@link DrawingCenterMark} carrying the toolbar mark size, then pushes it
   * onto the persisted list. No free text -- nothing to escape (Safety
   * Rule 4). No-op when center marks are not controlled.
   */
  const commitCenterMark = useCallback(
    (click: ResolvedClick): void => {
      if (!centerMarkControlled) {
        toast('warn', 'Center-mark placement is unavailable -- no persistence host wired.')
        return
      }
      const mark = buildCenterMark(click, { sizeMm: centerMarkSize })
      onPersistCenterMarks?.([...(persistedCenterMarks ?? []), mark])
      toast('ok', 'Center mark added.')
    },
    [centerMarkControlled, centerMarkSize, onPersistCenterMarks, persistedCenterMarks, toast]
  )

  /**
   * Commit a centerline from the two resolved clicks of the two-click flow
   * (start feature, then end feature -- the same step-carrying intermediate
   * state the Detail tool uses, but keeping the FULL ResolvedClick so the
   * first anchor stays associative). No-op when centerlines are not
   * controlled.
   */
  const commitCenterline = useCallback(
    (start: ResolvedClick, end: ResolvedClick): void => {
      if (!centerlineControlled) {
        toast('warn', 'Centerline placement is unavailable -- no persistence host wired.')
        return
      }
      const line = buildCenterline(start, end)
      onPersistCenterlines?.([...(persistedCenterlines ?? []), line])
      toast('ok', 'Centerline added.')
    },
    [centerlineControlled, onPersistCenterlines, persistedCenterlines, toast]
  )

  /**
   * Run a detail (crop) view from a centre + radius via `cad.detailDrawing`. The
   * sidecar projects the parent ONCE, crops the circular window, magnifies it by
   * `detailScale`, and stamps the escaped `detailLabel`. The resulting SVG is
   * handed to the host `onDetail` callback (this component does not host the
   * crop itself -- the host decides where it lands). No-op without a part handle
   * or the bridge.
   */
  const runDetail = useCallback(
    (center: { readonly x: number; readonly y: number }, radiusMm: number): void => {
      if (partHandle === null) return
      if (!(radiusMm > 0)) {
        toast('warn', 'Detail radius must be greater than zero -- click farther from the centre.')
        return
      }
      const bridge = readDrawingBridge()
      if (!bridge.detailDrawing) {
        toast('err', 'Detail-view bridge not available -- sidecar handler pending.')
        return
      }
      const scale = Number.isFinite(detailScale) && detailScale > 0 ? detailScale : 2
      void (async () => {
        try {
          const res = await bridge.detailDrawing!({
            handle: partHandle,
            view: activeView,
            center: { x: center.x, y: center.y },
            radiusMm,
            scale,
            // Operator free-text; escaped sidecar-side (Safety Rule 4).
            label: detailLabel,
          })
          if (!res.ok) {
            const detail = res.hint ? ` -- ${res.hint}` : ''
            toast('err', `Detail view failed: ${res.error}${detail}`)
            return
          }
          const nextSvg = res.result.svg
          if (typeof nextSvg === 'string' && nextSvg.length > 0) {
            onDetail?.({ svg: nextSvg, center: { x: center.x, y: center.y }, radiusMm, label: detailLabel })
            toast('ok', `Detail view created (${scale}:1).`)
          }
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e)
          toast('err', `Detail view threw: ${message}`)
        }
      })()
    },
    [partHandle, activeView, detailScale, detailLabel, onDetail, toast]
  )

  // -- Pointer handlers -----------------------------------------------------

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>): void => {
      // Hover-snap feedback is active during dimension placement OR a GD&T /
      // detail tool (all reuse the same anchored-snap machinery).
      if (placementState === null && toolMode === null && runState === null) {
        setHoveredSnap(null)
        return
      }
      const preferKind: SnapPointKind | undefined =
        toolMode !== null && toolMode.tool === 'center-mark' ? 'center' : undefined
      const { snap } = resolveCursorSvg(e.clientX, e.clientY, preferKind)
      setHoveredSnap(snap)
    },
    [placementState, toolMode, runState, resolveCursorSvg]
  )

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>): void => {
      if (e.button !== 0) return
      const preferKind: SnapPointKind | undefined =
        toolMode !== null && toolMode.tool === 'center-mark' ? 'center' : undefined
      const { svgCoord, snap, sourceId } = resolveCursorSvg(e.clientX, e.clientY, preferKind)
      const clickSvg = snap ?? svgCoord

      // -- GD&T / detail tool clicks (mutually exclusive with dimension placement).
      if (toolMode !== null) {
        if (toolMode.tool === 'gdt') {
          // One-click anchored placement.
          const resolvedClick: ResolvedClick = {
            point: { x: clickSvg.x, y: clickSvg.y },
            sourceId,
          }
          setToolMode(null)
          setHoveredSnap(null)
          commitGdtFrame(resolvedClick)
          return
        }
        if (toolMode.tool === 'surface-finish') {
          // One-click anchored placement (mirrors the GD&T tool).
          const resolvedClick: ResolvedClick = {
            point: { x: clickSvg.x, y: clickSvg.y },
            sourceId,
          }
          setToolMode(null)
          setHoveredSnap(null)
          commitSurfaceFinish(resolvedClick)
          return
        }
        if (toolMode.tool === 'note') {
          // One-click placement (mirrors the surface-finish tool). A snapped
          // click becomes the note's leader anchor; a free click is a floating
          // note block.
          const resolvedClick: ResolvedClick = {
            point: { x: clickSvg.x, y: clickSvg.y },
            sourceId,
          }
          setToolMode(null)
          setHoveredSnap(null)
          commitNote(resolvedClick)
          return
        }
        if (toolMode.tool === 'center-mark') {
          // One-click anchored placement (center-kind snaps preferred).
          const resolvedClick: ResolvedClick = {
            point: { x: clickSvg.x, y: clickSvg.y },
            sourceId,
          }
          setToolMode(null)
          setHoveredSnap(null)
          commitCenterMark(resolvedClick)
          return
        }
        if (toolMode.tool === 'centerline') {
          // Two clicks -- start feature, then end feature (mirrors the Detail
          // tool's step-carrying intermediate state, but keeps the FULL
          // ResolvedClick so the first anchor stays associative).
          const resolvedClick: ResolvedClick = {
            point: { x: clickSvg.x, y: clickSvg.y },
            sourceId,
          }
          if (toolMode.step === 0) {
            setToolMode({ tool: 'centerline', step: 1, start: resolvedClick })
            return
          }
          const start = toolMode.start
          setToolMode(null)
          setHoveredSnap(null)
          commitCenterline(start, resolvedClick)
          return
        }
        // detail: two clicks -- centre, then a point defining the radius.
        if (toolMode.step === 0) {
          setToolMode({ tool: 'detail', step: 1, center: { x: clickSvg.x, y: clickSvg.y } })
          return
        }
        const center = toolMode.center
        const radiusMm = Math.hypot(clickSvg.x - center.x, clickSvg.y - center.y)
        setToolMode(null)
        setHoveredSnap(null)
        runDetail(center, radiusMm)
        return
      }

      // -- Set-based dimension runs (ordinate / baseline / chain). A priming
      // click stores the run's datum; every later click mints one persisted
      // dimension. The run stays armed until Esc / re-clicking its button.
      if (runState !== null) {
        const resolvedClick: ResolvedClick = {
          point: { x: clickSvg.x, y: clickSvg.y },
          sourceId,
        }
        const { next, minted } = advanceDimensionRun(runState, resolvedClick)
        setRunState(next)
        if (minted !== null) commitRunDimension(minted)
        return
      }

      // -- Dimension placement (legacy two-click machine).
      if (placementState === null) return
      const resolvedClick: ResolvedClick = {
        point: { x: clickSvg.x, y: clickSvg.y },
        sourceId,
      }
      const { next, completed } = advanceDimensionPlacement(placementState, clickSvg)
      // Accumulate this click before committing/continuing.
      clickHistoryRef.current = [...clickHistoryRef.current, resolvedClick]
      setPlacementState(next)
      if (completed !== undefined) {
        // Final click: commit from the accumulated history, then reset it.
        setHoveredSnap(null)
        const clicks = clickHistoryRef.current
        clickHistoryRef.current = []
        commitPlacement(completed.kind, clicks)
      }
    },
    [
      placementState,
      toolMode,
      runState,
      resolveCursorSvg,
      commitPlacement,
      commitRunDimension,
      commitGdtFrame,
      commitSurfaceFinish,
      commitNote,
      commitCenterMark,
      commitCenterline,
      runDetail,
    ]
  )

  /**
   * Start interactive dimension placement for the given kind. Cancels any active
   * GD&T / detail tool so a click is never ambiguous between the two pipelines.
   */
  const startPlacement = useCallback((kind: DrawingDimensionKind): void => {
    setToolMode(null)
    setRunState(null)
    setPlacementState(startDimensionPlacement(kind))
    clickHistoryRef.current = []
    setHoveredSnap(null)
  }, [])

  /**
   * Start the GD&T one-click anchored placement. Cancels any dimension placement.
   * Toggling the active GD&T tool off returns to idle.
   */
  const startGdt = useCallback((): void => {
    setPlacementState(null)
    setRunState(null)
    clickHistoryRef.current = []
    setHoveredSnap(null)
    setToolMode((prev) => (prev !== null && prev.tool === 'gdt' ? null : { tool: 'gdt' }))
  }, [])

  /**
   * Start the Detail two-click (centre → radius) tool. Cancels any dimension
   * placement. Toggling the active Detail tool off returns to idle.
   */
  const startDetail = useCallback((): void => {
    setPlacementState(null)
    setRunState(null)
    clickHistoryRef.current = []
    setHoveredSnap(null)
    setToolMode((prev) => (prev !== null && prev.tool === 'detail' ? null : { tool: 'detail', step: 0 }))
  }, [])

  const clearDimensions = useCallback((): void => {
    if (controlled) {
      onPersistDimensions?.([])
    } else {
      setDimensions([])
    }
    setPlacementState(null)
    setRunState(null)
    clickHistoryRef.current = []
    setHoveredSnap(null)
  }, [controlled, onPersistDimensions])

  /** Remove every GD&T frame overlay (controlled mode only). */
  const clearGdt = useCallback((): void => {
    onPersistGdt?.([])
    setToolMode(null)
    setHoveredSnap(null)
  }, [onPersistGdt])

  /**
   * Start the surface-finish one-click anchored placement. Cancels any dimension
   * placement (mirrors {@link startGdt}). Toggling the active surface-finish tool
   * off returns to idle.
   */
  const startSurfaceFinish = useCallback((): void => {
    setPlacementState(null)
    setRunState(null)
    clickHistoryRef.current = []
    setHoveredSnap(null)
    setToolMode((prev) =>
      prev !== null && prev.tool === 'surface-finish' ? null : { tool: 'surface-finish' },
    )
  }, [])

  /** Remove every surface-finish symbol overlay (controlled mode only). */
  const clearSurfaceFinish = useCallback((): void => {
    onPersistSurfaceFinishes?.([])
    setToolMode(null)
    setHoveredSnap(null)
  }, [onPersistSurfaceFinishes])

  /**
   * Start the note one-click placement. Cancels any dimension placement (mirrors
   * {@link startSurfaceFinish}). Toggling the active Note tool off returns to
   * idle. Arming requires non-empty draft text so an armed click always has
   * content to place.
   */
  const startNote = useCallback((): void => {
    const arming = toolMode === null || toolMode.tool !== 'note'
    if (arming && noteDraft.trim().length === 0) {
      toast('warn', 'Type the note text first, then click Place note.')
      return
    }
    setPlacementState(null)
    setRunState(null)
    clickHistoryRef.current = []
    setHoveredSnap(null)
    setToolMode((prev) => (prev !== null && prev.tool === 'note' ? null : { tool: 'note' }))
  }, [toolMode, noteDraft, toast])

  /** Remove every note overlay (controlled mode only). */
  const clearNotes = useCallback((): void => {
    onPersistNotes?.([])
    setToolMode(null)
    setHoveredSnap(null)
  }, [onPersistNotes])

  /** Persist an edited note text (per-note edit affordance). */
  const editNoteText = useCallback(
    (id: string, text: string): void => {
      onPersistNotes?.(updateNoteText(persistedNotes ?? [], id, text))
    },
    [onPersistNotes, persistedNotes]
  )

  /** Delete one note (per-note delete affordance). */
  const deleteNote = useCallback(
    (id: string): void => {
      onPersistNotes?.(removeNote(persistedNotes ?? [], id))
    },
    [onPersistNotes, persistedNotes]
  )

  /**
   * Start the center-mark one-click placement (center-kind snaps preferred).
   * Cancels any dimension placement (mirrors {@link startSurfaceFinish}).
   * Toggling the active tool off returns to idle.
   */
  const startCenterMark = useCallback((): void => {
    setPlacementState(null)
    setRunState(null)
    clickHistoryRef.current = []
    setHoveredSnap(null)
    setToolMode((prev) =>
      prev !== null && prev.tool === 'center-mark' ? null : { tool: 'center-mark' },
    )
  }, [])

  /**
   * Start the centerline TWO-click placement (start feature, then end
   * feature). Cancels any dimension placement. Toggling the active tool off
   * (at either step) returns to idle.
   */
  const startCenterline = useCallback((): void => {
    setPlacementState(null)
    setRunState(null)
    clickHistoryRef.current = []
    setHoveredSnap(null)
    setToolMode((prev) =>
      prev !== null && prev.tool === 'centerline' ? null : { tool: 'centerline', step: 0 },
    )
  }, [])

  /** Remove every center-mark overlay (controlled mode only). */
  const clearCenterMarks = useCallback((): void => {
    onPersistCenterMarks?.([])
    setToolMode(null)
    setHoveredSnap(null)
  }, [onPersistCenterMarks])

  /** Remove every centerline overlay (controlled mode only). */
  const clearCenterlines = useCallback((): void => {
    onPersistCenterlines?.([])
    setToolMode(null)
    setHoveredSnap(null)
  }, [onPersistCenterlines])

  /** Delete one center mark (per-item delete affordance). */
  const deleteCenterMark = useCallback(
    (id: string): void => {
      onPersistCenterMarks?.(removeCenterMark(persistedCenterMarks ?? [], id))
    },
    [onPersistCenterMarks, persistedCenterMarks]
  )

  /** Delete one centerline (per-item delete affordance). */
  const deleteCenterline = useCallback(
    (id: string): void => {
      onPersistCenterlines?.(removeCenterline(persistedCenterlines ?? [], id))
    },
    [onPersistCenterlines, persistedCenterlines]
  )

  const toggleSection = useCallback((): void => {
    setSectionEnabled((prev) => {
      const next = !prev
      // Keep the toolbar pseudo-view in lock-step: turning the section path on
      // selects the Section view; turning it off drops back to the real axis.
      setUiView((cur) => {
        if (next) return 'section'
        return cur === 'section' ? activeView : cur
      })
      return next
    })
  }, [activeView])

  /**
   * Wave 6 (HLR) — flip the "Hidden lines" toggle. `hlrEnabled` is in the
   * projection effect's dep array, so this triggers a re-projection through the
   * SAME async/busy path (the canvas shows "Projecting ... view..." and
   * `aria-busy` flips) — HLR is slower than the mesh-edge projection, so the
   * existing busy affordance covers the extra latency.
   */
  const toggleHlr = useCallback((): void => {
    setHlrEnabled((prev) => !prev)
  }, [])

  const updateSectionAxis = useCallback((axis: DrawingSectionAxis): void => {
    setSectionPlane((prev) => ({ ...prev, axis }))
  }, [])

  const updateSectionOffset = useCallback((offset: number): void => {
    if (!Number.isFinite(offset)) return
    setSectionPlane((prev) => ({ ...prev, offset }))
  }, [])

  // -- Sheet-tab model + handlers -------------------------------------------
  //
  // CONTROLLED multi-sheet mode: `sheets` is supplied and the strip drives the
  // host's add/rename/delete/switch callbacks. UNCONTROLLED: one implicit
  // fallback tab so the strip always renders (the legacy single-sheet shape).

  /** Whether the host wired the multi-sheet controlled seam. */
  const sheetsControlled = sheets !== undefined

  /** The sheet list actually rendered (controlled list, or the fallback tab). */
  const effectiveSheets = useMemo<readonly DrawingSheetTab[]>(() => {
    if (sheets !== undefined && sheets.length > 0) return sheets
    return [{ id: FALLBACK_SHEET_ID, name: FALLBACK_SHEET_NAME }]
  }, [sheets])

  /**
   * The active sheet id. In controlled mode honour `activeSheetId` when it
   * matches a known sheet, else fall back to the first sheet (defensive: a stale
   * active id never blanks the strip). In uncontrolled mode it is the fallback.
   */
  const effectiveActiveSheetId = useMemo<string>(() => {
    const first = effectiveSheets[0]
    const firstId = first ? first.id : FALLBACK_SHEET_ID
    if (activeSheetId === undefined) return firstId
    return effectiveSheets.some((s) => s.id === activeSheetId) ? activeSheetId : firstId
  }, [effectiveSheets, activeSheetId])

  const handleSelectSheet = useCallback(
    (sheetId: string): void => {
      if (sheetId === effectiveActiveSheetId) return
      onSelectSheet?.(sheetId)
    },
    [effectiveActiveSheetId, onSelectSheet],
  )

  const handleAddSheet = useCallback((): void => {
    onAddSheet?.()
  }, [onAddSheet])

  const beginSheetRename = useCallback((sheet: DrawingSheetTab): void => {
    setEditingSheetId(sheet.id)
    setSheetNameDraft(sheet.name)
  }, [])

  const commitSheetRename = useCallback((): void => {
    setEditingSheetId((current) => {
      if (current !== null) {
        const trimmed = sheetNameDraft.trim()
        if (trimmed.length > 0) onRenameSheet?.(current, trimmed)
      }
      return null
    })
    setSheetNameDraft('')
  }, [sheetNameDraft, onRenameSheet])

  const cancelSheetRename = useCallback((): void => {
    setEditingSheetId(null)
    setSheetNameDraft('')
  }, [])

  const handleDeleteSheet = useCallback(
    (sheetId: string): void => {
      // The strip hides this affordance when only one sheet exists; this guard
      // is belt-and-braces so a programmatic call can never orphan the view.
      if (effectiveSheets.length <= 1) return
      onDeleteSheet?.(sheetId)
    },
    [effectiveSheets, onDeleteSheet],
  )

  // Focus the rename input when entering edit mode.
  useEffect(() => {
    if (editingSheetId !== null && sheetRenameInputRef.current !== null) {
      sheetRenameInputRef.current.focus()
      sheetRenameInputRef.current.select()
    }
  }, [editingSheetId])

  // -- Section pseudo-view <-> section path wiring ---------------------------
  //
  // The toolbar's `'section'` button is the UI-level selection; the actual
  // section projection is driven by `sectionEnabled` + `sectionPlane` (the
  // existing Stage-1 `cad.section_drawing` path). Selecting `'section'` enables
  // the section path; selecting any orthographic axis disables it and threads
  // the chosen axis to the bridge. Kept as one handler so the two states never
  // drift (you can never be on the Section button with the section path off).
  const selectUiView = useCallback((view: DrawingUiView): void => {
    setUiView(view)
    if (view === 'section') {
      setSectionEnabled(true)
      return
    }
    setActiveView(view)
    setSectionEnabled(false)
  }, [])

  /** True when the Section pseudo-view is the active toolbar selection. */
  const sectionViewActive = uiView === 'section'

  const updateTitleField = useCallback(
    (field: keyof DrawingTitleBlock, value: string): void => {
      setTitleBlock((prev) => {
        const next = { ...prev, [field]: value }
        // Persist the COMPUTED next block (not the stale `titleBlock` closure) so
        // a rapid edit burst always reports the latest value up to the host's
        // debounced save -- no eager-updater capture (Cycle-256).
        onPersistTitleBlock?.(next)
        return next
      })
    },
    [onPersistTitleBlock],
  )

  /**
   * Stamp the supplied BOM rows into the current SVG via
   * `cad.drawing_bom_table`. Pure SVG composition on the sidecar side -- it
   * renders the rows verbatim (no recompute) and is idempotent (re-stamping
   * replaces the existing table layer). No-op when there is no SVG yet or no
   * rows to render.
   */
  const handleBomTable = useCallback((): void => {
    if (svg === null) {
      toast('warn', 'Generate a drawing view before stamping the BOM table.')
      return
    }
    if (bomRows === undefined || bomRows.length === 0) {
      toast('warn', 'No BOM rows to stamp.')
      return
    }
    const bridge = readDrawingBridge()
    if (!bridge.drawingBomTable) {
      toast('err', 'BOM-table bridge not available -- sidecar handler pending.')
      return
    }
    void (async () => {
      try {
        const res = await bridge.drawingBomTable!({
          svg,
          rows: bomRows,
          ...(bomColumns !== undefined ? { columns: bomColumns } : {}),
        })
        if (!res.ok) {
          const detail = res.hint ? ` -- ${res.hint}` : ''
          toast('err', `BOM table failed: ${res.error}${detail}`)
          return
        }
        const nextSvg = res.result.svg
        if (typeof nextSvg === 'string' && nextSvg.length > 0) {
          setSvg(nextSvg)
          toast('ok', `BOM table stamped (${bomRows.length} rows).`)
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        toast('err', `BOM table threw: ${message}`)
      }
    })()
  }, [svg, bomRows, bomColumns, toast])

  /**
   * The dimension specs that actually get drawn through the
   * `cad.dimension_drawing` SVG path. In controlled mode these are the
   * persisted, associative dimensions mapped back to the handler's coordinate
   * shape (drawn from each anchor's refreshed `cachedPoint`); otherwise the
   * legacy ephemeral in-state specs. Memoized so the projection effect below
   * doesn't re-fire on every render of the parent.
   */
  const dimensionsRef = useMemo<DrawingDimensionSpec[]>(() => {
    if (controlled) {
      // Ordinate / baseline / chain members paint CLIENT-SIDE via the pure
      // dimension-set emitters (composed into displaySvg below); only the
      // four sidecar-native kinds round-trip through `cad.dimension_drawing`.
      return (persistedDimensions ?? [])
        .filter(
          (dim) =>
            dim.kind === 'linear' ||
            dim.kind === 'radial' ||
            dim.kind === 'diameter' ||
            dim.kind === 'angular'
        )
        .map(persistedDimensionToSpec)
    }
    return dimensions
  }, [controlled, persistedDimensions, dimensions])

  /**
   * The GD&T frame specs composed onto the projection through `cad.annotateGdt`.
   * Derived from the persisted, anchored frames (drawn from each anchor's
   * refreshed `cachedPoint`). Datums / label flow through verbatim -- the sidecar
   * escapes them (Safety Rule 4). Memoized so the projection effect doesn't
   * re-fire on every parent render. Empty when no persisted frames.
   */
  const gdtSpecs = useMemo<GdtAnnotateFrame[]>(() => {
    if (persistedGdtFrames === undefined || persistedGdtFrames.length === 0) return []
    return gdtFramesToSpecs(persistedGdtFrames)
  }, [persistedGdtFrames])

  /**
   * The SVG actually painted into the canvas: the base projection (`svg`) with
   * the surface-finish symbols AND the free-text notes composed in CLIENT-SIDE
   * as pure `<g>` overlays. Unlike GD&T (which composes through the
   * `cad.annotateGdt` sidecar in the async projection effect), both layers are
   * fully deterministic, so they are composed synchronously at render time --
   * this keeps a surface-finish / note edit from re-firing the whole async
   * projection pipeline and matches the "documentation overlays only" Safety
   * Rule 1 (no sidecar / G-code touch). Note text is entity-escaped inside
   * `noteToSvg` (the client-side trust boundary, Safety Rule 4). When there are
   * no symbols, notes, center marks, or centerlines (or no base SVG) this is
   * `svg` verbatim. Center marks + centerlines compose AFTER notes.
   */
  const displaySvg = useMemo<string | null>(() => {
    if (svg === null) return null
    let composed = svg
    if (persistedSurfaceFinishes !== undefined && persistedSurfaceFinishes.length > 0) {
      composed = composeSurfaceFinishIntoSvg(
        composed,
        persistedSurfaceFinishes,
        surfaceFinishDanglingIds,
      )
    }
    if (persistedNotes !== undefined && persistedNotes.length > 0) {
      composed = composeNotesIntoSvg(composed, persistedNotes, noteDanglingIds)
    }
    if (persistedCenterMarks !== undefined && persistedCenterMarks.length > 0) {
      composed = composeCenterMarksIntoSvg(composed, persistedCenterMarks, centerMarkDanglingIds)
    }
    if (persistedCenterlines !== undefined && persistedCenterlines.length > 0) {
      composed = composeCenterlinesIntoSvg(composed, persistedCenterlines, centerlineDanglingIds)
    }
    if (persistedDimensions !== undefined && persistedDimensions.length > 0) {
      // Set-based dimensions (ordinate / baseline / chain) -- the layer helper
      // skips the four sidecar-native kinds, so this is a no-op for a list of
      // plain linear / radial / diameter / angular dimensions.
      composed = composeDimensionSetsIntoSvg(composed, persistedDimensions, danglingIds)
    }
    return composed
  }, [
    svg,
    persistedSurfaceFinishes,
    surfaceFinishDanglingIds,
    persistedNotes,
    noteDanglingIds,
    persistedCenterMarks,
    centerMarkDanglingIds,
    persistedCenterlines,
    centerlineDanglingIds,
    persistedDimensions,
    danglingIds,
  ])

  // Re-project whenever `partHandle` or the active view changes.
  useEffect(() => {
    if (previewSvg !== undefined) {
      setSvg(previewSvg)
      setError(null)
      return undefined
    }
    if (partHandle === null) {
      setSvg(null)
      setError(null)
      return undefined
    }
    const bridge = readDrawingBridge()
    if (!bridge.projectDrawing) {
      setError('Drawing bridge not available -- sidecar handler pending.')
      return undefined
    }
    let cancelled = false
    setBusy(true)
    setError(null)
    // Optimistic reset: assume the section will render. The section branch sets
    // this back to true on a failed/absent section projection.
    setSectionUnavailable(false)
    void (async () => {
      try {
        let svgText: string | null = null
        // Stage 1: base projection (section or plain).
        if (sectionEnabled && !bridge.sectionDrawing) {
          // Section requested but the section bridge has not landed: honest
          // placeholder, no fabricated geometry.
          if (cancelled) return
          setSvg(null)
          setSectionUnavailable(true)
          return
        }
        if (sectionEnabled && bridge.sectionDrawing) {
          const res = await bridge.sectionDrawing({
            handle: partHandle,
            view: activeView,
            plane: sectionPlane,
            // Pass the operator label through verbatim; the sidecar normalizes +
            // entity-escapes it (Safety Rule 4). Blank falls back to "A-A".
            label: sectionLabel,
          })
          if (cancelled) return
          if (!res.ok) {
            const detail = res.hint ? ` -- ${res.hint}` : ''
            setError(`Section projection failed: ${res.error}${detail}`)
            toast('err', `Section projection failed: ${res.error}`)
            setSvg(null)
            // Honest fallback: the projector could not section this part. Show the
            // "section preview not available" placeholder rather than blank.
            setSectionUnavailable(true)
            return
          }
          svgText = res.result.svg
        } else if (dimensionsRef.length > 0 && bridge.dimensionDrawing) {
          const res = await bridge.dimensionDrawing({
            handle: partHandle,
            view: activeView,
            dimensions: dimensionsRef,
          })
          if (cancelled) return
          if (!res.ok) {
            const detail = res.hint ? ` -- ${res.hint}` : ''
            setError(`Dimensioned projection failed: ${res.error}${detail}`)
            toast('err', `Dimensioned projection failed: ${res.error}`)
            setSvg(null)
            return
          }
          svgText = res.result.svg
        } else {
          const res = await bridge.projectDrawing!({
            handle: partHandle,
            view: activeView,
            includeHlr: hlrEnabled,
          })
          if (cancelled) return
          if (!res.ok) {
            const detail = res.hint ? ` -- ${res.hint}` : ''
            setError(`Drawing projection failed: ${res.error}${detail}`)
            toast('err', `Drawing projection failed: ${res.error}`)
            setSvg(null)
            return
          }
          svgText = res.result.svg
        }

        // Stage 2: overlay dimensions on top of section view.
        if (
          svgText !== null &&
          sectionEnabled &&
          dimensionsRef.length > 0 &&
          bridge.dimensionDrawing
        ) {
          const res = await bridge.dimensionDrawing({
            handle: partHandle,
            view: activeView,
            dimensions: dimensionsRef,
          })
          if (cancelled) return
          if (res.ok) {
            svgText = res.result.svg
          }
        }

        // Stage 3: stamp title block.
        if (svgText !== null && bridge.attachTitleBlock) {
          const res = await bridge.attachTitleBlock({
            svg: svgText,
            metadata: titleBlock,
          })
          if (cancelled) return
          if (res.ok) {
            svgText = res.result.svg
          }
        }

        // Stage 4: compose GD&T feature control frames. Pure SVG composition --
        // the sidecar renders the supplied frames verbatim and entity-escapes
        // every datum cell + the optional label before injection (Safety Rule 4).
        if (svgText !== null && gdtSpecs.length > 0 && bridge.annotateGdt) {
          const res = await bridge.annotateGdt({
            svg: svgText,
            frames: gdtSpecs,
          })
          if (cancelled) return
          if (res.ok) {
            svgText = res.result.svg
          } else {
            // Non-fatal: keep the (un-annotated) drawing usable, warn the operator.
            toast('warn', `GD&T overlay failed: ${res.error}`)
          }
        }

        setSvg(svgText)
      } catch (e) {
        if (cancelled) return
        const message = e instanceof Error ? e.message : String(e)
        setError(`Drawing projection threw: ${message}`)
        toast('err', `Drawing projection threw: ${message}`)
        setSvg(null)
      } finally {
        if (!cancelled) setBusy(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [
    partHandle,
    activeView,
    previewSvg,
    hlrEnabled,
    sectionEnabled,
    sectionPlane,
    sectionLabel,
    dimensionsRef,
    gdtSpecs,
    titleBlock,
    toast,
  ])

  // -- CAD V2 -- geometry fetch --------------------------------------------
  //
  // Fetch the projected vertices / edges / snap points for the active view so
  // two-click placement can snap to real geometry AND persisted dimensions can
  // re-resolve their anchors. Runs ONLY when the part handle or the active view
  // changes (NOT when the dimension list changes -- that would re-fetch on
  // every placement). The re-anchor pass below consumes `freshSnapPoints`.
  // Decoupled from the SVG-projection effect so a snap-fetch failure never
  // blanks the drawing.
  useEffect(() => {
    // A handle/view change invalidates the previous projection: reset the
    // loaded flag so the re-anchor pass holds off dangling judgement until the
    // fresh fetch lands.
    setGeometryLoaded(false)
    if (partHandle === null) {
      setSnapPoints([])
      setFreshSnapPoints([])
      return undefined
    }
    const bridge = readDrawingBridge()
    if (!bridge.extractDrawingGeometry) {
      // Geometry bridge not present (older build): fall back to free-cursor
      // placement; persisted dimensions still render from their cachedPoints
      // but are never flagged dangling (we never learned the real geometry).
      setSnapPoints([])
      setFreshSnapPoints([])
      return undefined
    }
    let cancelled = false
    void (async () => {
      try {
        const res = await bridge.extractDrawingGeometry!({
          handle: partHandle,
          view: activeView,
        })
        if (cancelled) return
        if (!res.ok) {
          // Snap fetch failed -- keep the drawing usable with free placement.
          // Do NOT mark geometry loaded: a failed fetch is not evidence a
          // feature is gone, so we must not dangle-flag on it.
          setSnapPoints([])
          setFreshSnapPoints([])
          return
        }
        const fresh = readSnapPointsFromGeometry(res.result)
        // Resolver shape: drop the ids but KEEP sourceId so a snapped click
        // records the right anchor refId.
        const resolverPoints: SnapPoint[] = fresh.map((sp) => ({
          x: sp.x,
          y: sp.y,
          kind: sp.kind,
          sourceId: sp.sourceId,
        }))
        setSnapPoints(resolverPoints)
        setFreshSnapPoints(fresh)
        // A successful projection (even an empty one) is authoritative: now the
        // re-anchor pass may judge which anchors are gone.
        setGeometryLoaded(true)
      } catch {
        if (cancelled) return
        setSnapPoints([])
        setFreshSnapPoints([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [partHandle, activeView])

  // -- CAD V2 -- re-anchor persisted dimensions against fresh geometry ------
  //
  // Whenever a fresh projection lands (`freshSnapPoints`) or the persisted list
  // changes, re-resolve every anchor: refresh resolved cachedPoints and badge
  // dimensions whose anchor link is gone as `dangling`. Pushes the refreshed
  // list back up ONLY when a cachedPoint actually moved (guarded by a deep
  // equality check) so a placement→re-render→re-resolve cycle converges instead
  // of looping.
  useEffect(() => {
    if (persistedDimensions === undefined) return
    // Hold off until a real projection has landed -- otherwise an empty
    // `freshSnapPoints` (pre-fetch / failed fetch) would dangle-flag everything.
    if (!geometryLoaded) {
      setDanglingIds(new Set())
      return
    }
    const { dimensions: reanchored, danglingIds: nextDangling } = reanchorDimensions(
      persistedDimensions,
      freshSnapPoints
    )
    setDanglingIds(nextDangling)
    if (
      onPersistDimensions !== undefined &&
      JSON.stringify(reanchored) !== JSON.stringify(persistedDimensions)
    ) {
      onPersistDimensions(reanchored)
    }
  }, [geometryLoaded, freshSnapPoints, persistedDimensions, onPersistDimensions])

  // -- CAD V1.5 GD&T -- re-anchor persisted frames against fresh geometry ----
  //
  // Mirror of the dimension re-anchor pass: whenever a fresh projection lands or
  // the persisted frame list changes, re-resolve every frame's anchor (refresh
  // its cachedPoint + placement, badge a vanished anchor `dangling`). Push the
  // refreshed list up only when a frame actually moved (deep-equality guard) so
  // a placement→re-render→re-resolve cycle converges instead of looping.
  useEffect(() => {
    if (persistedGdtFrames === undefined) return
    if (!geometryLoaded) {
      setGdtDanglingIds(new Set())
      return
    }
    const { frames: reanchored, danglingIds: nextDangling } = reanchorGdtFrames(
      persistedGdtFrames,
      freshSnapPoints,
    )
    setGdtDanglingIds(nextDangling)
    if (
      onPersistGdt !== undefined &&
      JSON.stringify(reanchored) !== JSON.stringify(persistedGdtFrames)
    ) {
      onPersistGdt(reanchored)
    }
  }, [geometryLoaded, freshSnapPoints, persistedGdtFrames, onPersistGdt])

  // -- CAD V1.5 Surface-finish -- re-anchor persisted symbols against fresh geometry
  //
  // Mirror of the GD&T re-anchor pass: whenever a fresh projection lands or the
  // persisted symbol list changes, re-resolve every symbol's anchor (refresh its
  // cachedPoint + placement, badge a vanished anchor `dangling`). Push the
  // refreshed list up only when a symbol actually moved (deep-equality guard) so
  // a placement->re-render->re-resolve cycle converges instead of looping.
  useEffect(() => {
    if (persistedSurfaceFinishes === undefined) return
    if (!geometryLoaded) {
      setSurfaceFinishDanglingIds(new Set())
      return
    }
    const { symbols: reanchored, danglingIds: nextDangling } = reanchorSurfaceFinishes(
      persistedSurfaceFinishes,
      freshSnapPoints,
    )
    setSurfaceFinishDanglingIds(nextDangling)
    if (
      onPersistSurfaceFinishes !== undefined &&
      JSON.stringify(reanchored) !== JSON.stringify(persistedSurfaceFinishes)
    ) {
      onPersistSurfaceFinishes(reanchored)
    }
  }, [geometryLoaded, freshSnapPoints, persistedSurfaceFinishes, onPersistSurfaceFinishes])

  // -- CAD V1.5 Notes -- re-anchor persisted note leaders against fresh geometry
  //
  // Mirror of the surface-finish re-anchor pass: whenever a fresh projection
  // lands or the persisted note list changes, re-resolve every note's LEADER
  // anchor (refresh its cachedPoint and translate the text block by the same
  // delta so the operator's offset is preserved; badge a vanished leader
  // `dangling`). Leaderless notes pass through untouched and never dangle. Push
  // the refreshed list up only when a note actually moved (deep-equality guard)
  // so a placement->re-render->re-resolve cycle converges instead of looping.
  useEffect(() => {
    if (persistedNotes === undefined) return
    if (!geometryLoaded) {
      setNoteDanglingIds(new Set())
      return
    }
    const { notes: reanchored, danglingIds: nextDangling } = reanchorNotes(
      persistedNotes,
      freshSnapPoints,
    )
    setNoteDanglingIds(nextDangling)
    if (
      onPersistNotes !== undefined &&
      JSON.stringify(reanchored) !== JSON.stringify(persistedNotes)
    ) {
      onPersistNotes(reanchored)
    }
  }, [geometryLoaded, freshSnapPoints, persistedNotes, onPersistNotes])

  // -- CAD V1.5 Center marks / centerlines -- re-anchor against fresh geometry
  //
  // Mirrors the notes re-anchor pass (same converge guard): refresh resolved
  // anchor cachedPoints, badge vanished anchors `dangling`, and push the
  // refreshed list up only when something actually moved (deep-equality guard)
  // so a placement->re-render->re-resolve cycle converges instead of looping.
  useEffect(() => {
    if (persistedCenterMarks === undefined) return
    if (!geometryLoaded) {
      setCenterMarkDanglingIds(new Set())
      return
    }
    const { centerMarks: reanchored, danglingIds: nextDangling } = reanchorCenterMarks(
      persistedCenterMarks,
      freshSnapPoints,
    )
    setCenterMarkDanglingIds(nextDangling)
    if (
      onPersistCenterMarks !== undefined &&
      JSON.stringify(reanchored) !== JSON.stringify(persistedCenterMarks)
    ) {
      onPersistCenterMarks(reanchored)
    }
  }, [geometryLoaded, freshSnapPoints, persistedCenterMarks, onPersistCenterMarks])

  useEffect(() => {
    if (persistedCenterlines === undefined) return
    if (!geometryLoaded) {
      setCenterlineDanglingIds(new Set())
      return
    }
    const { centerlines: reanchored, danglingIds: nextDangling } = reanchorCenterlines(
      persistedCenterlines,
      freshSnapPoints,
    )
    setCenterlineDanglingIds(nextDangling)
    if (
      onPersistCenterlines !== undefined &&
      JSON.stringify(reanchored) !== JSON.stringify(persistedCenterlines)
    ) {
      onPersistCenterlines(reanchored)
    }
  }, [geometryLoaded, freshSnapPoints, persistedCenterlines, onPersistCenterlines])

  // -- Empty-state branch ---------------------------------------------------
  if (partHandle === null) {
    return (
      <div
        className="design-drawing design-drawing--empty"
        data-testid="design-drawing-view"
      >
        <EmptyState
          testId="design-drawing-empty"
          icon={'\u25ad'}
          title="No part selected"
          body="Build a part with the Part view, then come back here to generate Front / Top / Right / Iso drawings ready to export as PDF or SVG."
        />
      </div>
    )
  }

  // -- Populated state ------------------------------------------------------

  /** Label shown in the dim-count area during active placement. */
  const placementLabel: string | null =
    placementState !== null
      ? placementState.step === 0
        ? `Placing ${DIMENSION_LABELS[placementState.kind]} -- click p1`
        : `Placing ${DIMENSION_LABELS[placementState.kind]} -- click p2`
      : null

  /** Status line for an armed set-based dimension run (ordinate / baseline / chain). */
  const runStatusLabel: string | null =
    runState === null
      ? null
      : runState.kind === 'ordinate'
        ? runState.origin === null
          ? `Ordinate ${runState.axis.toUpperCase()} -- click the 0-datum origin`
          : `Ordinate ${runState.axis.toUpperCase()} -- click features to add read-outs (Esc ends)`
        : runState.kind === 'baseline'
          ? runState.origin === null
            ? 'Baseline -- click the base feature'
            : 'Baseline -- click features to stack dimensions (Esc ends)'
          : runState.prev === null
            ? 'Chain -- click the first feature'
            : 'Chain -- click the next feature (Esc ends)'

  /** The toolbar run-button kind currently armed (null when idle). */
  const armedRunKind = runStateToKind(runState)

  /**
   * Effective placed-dimension count -- the persisted list in controlled mode,
   * otherwise the legacy ephemeral list. Drives the Clear button + the count
   * readout.
   */
  const effectiveDimCount = controlled
    ? (persistedDimensions ?? []).length
    : dimensions.length

  /** How many persisted dimensions are currently dangling (lost their anchor). */
  const danglingCount = danglingIds.size

  /** Whether the BOM-table affordance should render. */
  const showBomTable = bomRows !== undefined && bomRows.length > 0

  /**
   * The placeable BOM-panel rows. When the host supplies `bomLines` (rows it
   * derived through the `deriveDrawingBom` seam) the panel renders. The panel is
   * present whenever the prop is supplied -- an EMPTY array renders the honest
   * empty state (vs. OMITTED, which hides the panel entirely).
   */
  const showBomPanel = bomLines !== undefined
  const effectiveBomLines: readonly DrawingBomLine[] = bomLines ?? []

  /** Persisted GD&T frame count (controlled mode). Drives the count readout + Clear. */
  const gdtFrameCount = (persistedGdtFrames ?? []).length
  /** How many GD&T frames are currently dangling. */
  const gdtDanglingCount = gdtDanglingIds.size
  /** Whether the GD&T one-click tool is armed. */
  const gdtPlacing = toolMode !== null && toolMode.tool === 'gdt'
  /** Whether the surface-finish one-click tool is armed. */
  const surfaceFinishPlacing = toolMode !== null && toolMode.tool === 'surface-finish'
  /** Whether the Detail tool is armed (either step). */
  const detailPlacing = toolMode !== null && toolMode.tool === 'detail'

  /** Persisted surface-finish count (controlled mode). Drives the count readout + Clear. */
  const surfaceFinishCount = (persistedSurfaceFinishes ?? []).length
  /** How many surface-finish symbols are currently dangling. */
  const surfaceFinishDanglingCount = surfaceFinishDanglingIds.size

  /** Persisted note count (controlled mode). Drives the count readout + Clear. */
  const noteCount = (persistedNotes ?? []).length
  /** How many notes are currently dangling (lost their leader anchor). */
  const noteDanglingCount = noteDanglingIds.size
  /** Whether the note one-click tool is armed. */
  const notePlacing = toolMode !== null && toolMode.tool === 'note'

  /** Persisted center-mark count (controlled mode). Drives the count readout + Clear. */
  const centerMarkCount = (persistedCenterMarks ?? []).length
  /** Persisted centerline count (controlled mode). */
  const centerlineCount = (persistedCenterlines ?? []).length
  /** How many center marks are currently dangling (lost their anchor). */
  const centerMarkDanglingCount = centerMarkDanglingIds.size
  /** How many centerlines are currently dangling (either endpoint lost). */
  const centerlineDanglingCount = centerlineDanglingIds.size
  /** Whether the center-mark one-click tool is armed. */
  const centerMarkPlacing = toolMode !== null && toolMode.tool === 'center-mark'
  /** Whether the centerline two-click tool is armed (either step). */
  const centerlinePlacing = toolMode !== null && toolMode.tool === 'centerline'
  /** Whether the armed centerline tool is waiting for its SECOND click. */
  const centerlineAtStep1 =
    toolMode !== null && toolMode.tool === 'centerline' && toolMode.step === 1

  /** Status line for the GD&T / surface-finish / note / detail tool area. */
  const toolStatusLabel: string | null = gdtPlacing
    ? `Placing ${GDT_CHARACTERISTIC_LABELS[gdtCharacteristic]} frame -- click the feature`
    : surfaceFinishPlacing
      ? `Placing ${SURFACE_FINISH_MATERIAL_LABELS[surfaceFinishMaterial]} finish -- click the feature`
      : notePlacing
        ? 'Placing note -- click the sheet (snap to a feature to attach a leader)'
        : centerMarkPlacing
          ? 'Placing center mark -- click a hole or arc centre'
          : centerlinePlacing
            ? centerlineAtStep1
              ? 'Placing centerline -- click the second feature'
              : 'Placing centerline -- click the first feature'
            : detailPlacing
              ? toolMode !== null && toolMode.tool === 'detail' && toolMode.step === 0
                ? 'Detail view -- click the crop centre'
                : 'Detail view -- click to set the crop radius'
              : null

  return (
    <div className="design-drawing" data-testid="design-drawing-view">
      {error !== null && (
        <div
          className="design-drawing__error"
          role="alert"
          data-testid="design-drawing-error"
        >
          {error}
        </div>
      )}

      {/* Sheet-tab strip -- add / rename / delete / switch sheets. */}
      <div
        className="design-drawing__sheet-tabs"
        role="tablist"
        aria-label="Drawing sheets"
        data-testid="design-drawing-sheet-tabs"
      >
        {effectiveSheets.map((sheet) => {
          const isActive = sheet.id === effectiveActiveSheetId
          const isEditing = sheet.id === editingSheetId
          return (
            <span
              key={sheet.id}
              className={
                isActive
                  ? 'design-drawing__sheet-tab design-drawing__sheet-tab--active'
                  : 'design-drawing__sheet-tab'
              }
            >
              {isEditing ? (
                <input
                  ref={sheetRenameInputRef}
                  type="text"
                  className="design-drawing__sheet-rename-input"
                  data-testid="design-drawing-sheet-rename-input"
                  value={sheetNameDraft}
                  maxLength={80}
                  aria-label={`Rename sheet (currently ${sheet.name})`}
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    setSheetNameDraft(e.target.value)
                  }
                  onBlur={commitSheetRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      commitSheetRename()
                    } else if (e.key === 'Escape') {
                      e.preventDefault()
                      cancelSheetRename()
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className="design-drawing__sheet-tab-btn"
                  data-testid={drawingSheetTabTestId(sheet.id)}
                  title={`${sheet.name} (double-click to rename)`}
                  onClick={() => handleSelectSheet(sheet.id)}
                  onDoubleClick={() => beginSheetRename(sheet)}
                >
                  {sheet.name}
                </button>
              )}
              {effectiveSheets.length > 1 && !isEditing && (
                <button
                  type="button"
                  className="design-drawing__sheet-close"
                  data-testid={`design-drawing-sheet-close-${sheet.id}`}
                  title={`Delete sheet "${sheet.name}"`}
                  aria-label={`Delete sheet ${sheet.name}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDeleteSheet(sheet.id)
                  }}
                >
                  <span aria-hidden="true">x</span>
                </button>
              )}
            </span>
          )
        })}
        <button
          type="button"
          className="design-drawing__sheet-add"
          data-testid="design-drawing-sheet-add"
          title="Add a new drawing sheet"
          aria-label="Add new sheet"
          disabled={!sheetsControlled}
          aria-disabled={!sheetsControlled}
          onClick={handleAddSheet}
        >
          <span aria-hidden="true">+</span> Sheet
        </button>
      </div>

      <div
        className="design-drawing__toolbar"
        role="toolbar"
        aria-label="Drawing views"
      >
        <div
          className="design-drawing__view-group"
          role="group"
          aria-label="Projection view"
        >
          {UI_TOOLBAR_ORDER.map((view) => {
            const isSection = view === 'section'
            const isActive = isSection ? sectionViewActive : uiView === view
            const label = isSection ? SECTION_VIEW_LABEL : DRAWING_VIEW_LABELS[view]
            const testid = isSection ? DRAWING_SECTION_VIEW_TESTID : drawingViewTestId(view)
            return (
              <button
                key={view}
                type="button"
                className={
                  isActive
                    ? 'btn btn-primary design-drawing__view-btn design-drawing__view-btn--active'
                    : 'btn btn-secondary design-drawing__view-btn'
                }
                data-testid={testid}
                aria-pressed={isActive}
                onClick={() => selectUiView(view)}
              >
                {label}
              </button>
            )
          })}
        </div>

        <div
          className="design-drawing__hlr-group"
          role="group"
          aria-label="Hidden-line removal"
        >
          <button
            type="button"
            className={
              hlrEnabled
                ? 'btn btn-primary design-drawing__hlr-toggle design-drawing__hlr-toggle--on'
                : 'btn btn-secondary design-drawing__hlr-toggle'
            }
            data-testid="design-drawing-hlr-toggle"
            aria-pressed={hlrEnabled}
            onClick={toggleHlr}
            title="Toggle true hidden-line removal: visible edges solid, hidden edges dashed"
          >
            {hlrEnabled ? 'Hidden lines: ON' : 'Hidden lines: OFF'}
          </button>
        </div>

        {onExport && (
          <div className="design-drawing__export-group" role="group" aria-label="Export drawing">
            <button
              type="button"
              className="btn btn-ghost"
              data-testid="design-drawing-export"
              onClick={() => onExport('svg')}
              disabled={svg === null}
              aria-disabled={svg === null}
              title="Export the current drawing as SVG or PDF"
            >
              Export PDF/SVG
            </button>
          </div>
        )}
      </div>

      {/* CAD V1.5 -- Dimensions toolbar */}
      <div
        className="design-drawing__dim-toolbar"
        role="toolbar"
        aria-label="Drawing dimensions"
        data-testid="design-drawing-dim-toolbar"
      >
        <div
          className="design-drawing__dim-group"
          role="group"
          aria-label="Add dimension"
        >
          {DIMENSION_TOOL_ORDER.map((kind) => {
            const isActivePlacement =
              placementState !== null && placementState.kind === kind
            return (
              <button
                key={kind}
                type="button"
                className={
                  isActivePlacement
                    ? 'btn btn-primary design-drawing__dim-btn design-drawing__dim-btn--placing'
                    : 'btn btn-secondary design-drawing__dim-btn'
                }
                data-testid={dimensionToolTestId(kind)}
                onClick={() => startPlacement(kind)}
                title={
                  isActivePlacement
                    ? `Cancel ${DIMENSION_LABELS[kind].toLowerCase()} placement`
                    : `Place a ${DIMENSION_LABELS[kind].toLowerCase()} dimension`
                }
                aria-pressed={isActivePlacement}
              >
                {DIMENSION_LABELS[kind]}
              </button>
            )
          })}
          {DIMENSION_RUN_TOOL_ORDER.map((kind) => {
            const isArmed = armedRunKind === kind
            return (
              <button
                key={kind}
                type="button"
                className={
                  isArmed
                    ? 'btn btn-primary design-drawing__dim-btn design-drawing__dim-btn--placing'
                    : 'btn btn-secondary design-drawing__dim-btn'
                }
                data-testid={dimensionRunToolTestId(kind)}
                onClick={() => armRun(kind)}
                title={
                  isArmed
                    ? `End the ${DIMENSION_RUN_LABELS[kind].toLowerCase()} run (Esc)`
                    : DIMENSION_RUN_TITLES[kind]
                }
                aria-pressed={isArmed}
              >
                {DIMENSION_RUN_LABELS[kind]}
              </button>
            )
          })}
          {effectiveDimCount > 0 && (
            <button
              type="button"
              className="btn btn-ghost design-drawing__dim-clear"
              data-testid="design-drawing-dim-clear"
              onClick={clearDimensions}
              title="Remove every dimension overlay"
            >
              Clear
            </button>
          )}
          {showBomTable && (
            <button
              type="button"
              className="btn btn-ghost design-drawing__bom-btn"
              data-testid="design-drawing-bom-table"
              onClick={handleBomTable}
              disabled={svg === null}
              aria-disabled={svg === null}
              title="Stamp the assembly bill-of-materials table onto the drawing"
            >
              BOM table
            </button>
          )}
        </div>
        <div
          className="design-drawing__dim-count"
          data-testid="design-drawing-dim-count"
          aria-live="polite"
        >
          {placementLabel !== null
            ? placementLabel
            : runStatusLabel !== null
              ? runStatusLabel
              : effectiveDimCount === 0
                ? 'No dimensions added'
                : `${effectiveDimCount} dimension${effectiveDimCount === 1 ? '' : 's'}`}
        </div>
        {danglingCount > 0 && (
          <div
            className="design-drawing__dim-dangling"
            data-testid="design-drawing-dim-dangling"
            role="status"
            title="These dimensions lost their anchored feature on rebuild and are drawn from the last-known position."
          >
            {`${danglingCount} dangling`}
          </div>
        )}
        {controlled && effectiveDimCount > 0 && (
          <ul
            className="design-drawing__note-list design-drawing__dim-list"
            data-testid="design-drawing-dim-list"
            aria-label="Placed dimensions"
          >
            {(persistedDimensions ?? []).map((dim) => (
              <li key={dim.id} className="design-drawing__note-row">
                <span className="design-drawing__centermark-row-label">
                  {dimensionRowLabel(dim)}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost design-drawing__note-delete"
                  data-testid={`design-drawing-dim-delete-${dim.id}`}
                  aria-label="Delete dimension"
                  title="Delete this dimension"
                  onClick={() => deleteDimension(dim.id)}
                >
                  <span aria-hidden="true">x</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* CAD V1.5 -- GD&T feature-control-frame toolbar */}
      <div
        className="design-drawing__gdt-toolbar"
        role="toolbar"
        aria-label="GD and T feature control frames"
        data-testid="design-drawing-gdt-toolbar"
      >
        <div
          className="design-drawing__gdt-group"
          role="group"
          aria-label="Place a feature control frame"
        >
          <label className="design-drawing__gdt-field">
            Symbol:
            <select
              className="design-drawing__gdt-characteristic"
              data-testid="design-drawing-gdt-characteristic"
              value={gdtCharacteristic}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => {
                const next = e.target.value as GdtCharacteristic
                if ((GDT_CHARACTERISTIC_ORDER as readonly string[]).includes(next)) {
                  setGdtCharacteristic(next)
                }
              }}
            >
              {GDT_CHARACTERISTIC_ORDER.map((c) => (
                <option key={c} value={c}>
                  {GDT_CHARACTERISTIC_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="design-drawing__gdt-field">
            Tol (mm):
            <input
              type="number"
              className="design-drawing__gdt-tolerance"
              data-testid="design-drawing-gdt-tolerance"
              value={gdtTolerance}
              min={0}
              step={0.01}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                const next = parseFloat(e.target.value)
                if (Number.isFinite(next) && next >= 0) setGdtTolerance(next)
              }}
            />
          </label>
          <label className="design-drawing__gdt-field">
            Datums:
            <input
              type="text"
              className="design-drawing__gdt-datums"
              data-testid="design-drawing-gdt-datums"
              value={gdtDatums}
              maxLength={40}
              placeholder="A B C"
              onChange={(e: ChangeEvent<HTMLInputElement>) => setGdtDatums(e.target.value)}
            />
          </label>
          <button
            type="button"
            className={
              gdtPlacing
                ? 'btn btn-primary design-drawing__gdt-btn design-drawing__gdt-btn--placing'
                : 'btn btn-secondary design-drawing__gdt-btn'
            }
            data-testid="design-drawing-gdt-place"
            aria-pressed={gdtPlacing}
            onClick={startGdt}
            title={
              gdtControlled
                ? 'Click, then click a feature to anchor a GD&T frame there'
                : 'GD&T placement needs a persistence host'
            }
          >
            {gdtPlacing ? 'Click feature...' : 'GD&T frame'}
          </button>
          {gdtFrameCount > 0 && (
            <button
              type="button"
              className="btn btn-ghost design-drawing__gdt-clear"
              data-testid="design-drawing-gdt-clear"
              onClick={clearGdt}
              title="Remove every GD&T frame overlay"
            >
              Clear
            </button>
          )}
        </div>
        <div
          className="design-drawing__gdt-count"
          data-testid="design-drawing-gdt-count"
          aria-live="polite"
        >
          {toolStatusLabel !== null && gdtPlacing
            ? toolStatusLabel
            : gdtFrameCount === 0
              ? 'No GD&T frames'
              : `${gdtFrameCount} GD&T frame${gdtFrameCount === 1 ? '' : 's'}`}
        </div>
        {gdtDanglingCount > 0 && (
          <div
            className="design-drawing__gdt-dangling"
            data-testid="design-drawing-gdt-dangling"
            role="status"
            title="These frames lost their anchored feature on rebuild and are drawn from the last-known position."
          >
            {`${gdtDanglingCount} dangling`}
          </div>
        )}
      </div>

      {/* CAD V1.5 -- Surface-finish (ISO 1302 / ASME Y14.36) toolbar */}
      <div
        className="design-drawing__gdt-toolbar design-drawing__surface-finish-toolbar"
        role="toolbar"
        aria-label="Surface finish symbols"
        data-testid="design-drawing-surface-finish-toolbar"
      >
        <div
          className="design-drawing__gdt-group"
          role="group"
          aria-label="Place a surface-finish symbol"
        >
          <label className="design-drawing__gdt-field">
            Finish:
            <select
              className="design-drawing__gdt-characteristic"
              data-testid="design-drawing-surface-finish-material"
              value={surfaceFinishMaterial}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => {
                const next = e.target.value as SurfaceFinishMaterial
                if ((SURFACE_FINISH_MATERIAL_ORDER as readonly string[]).includes(next)) {
                  setSurfaceFinishMaterial(next)
                }
              }}
            >
              {SURFACE_FINISH_MATERIAL_ORDER.map((m) => (
                <option key={m} value={m}>
                  {SURFACE_FINISH_MATERIAL_LABELS[m]}
                </option>
              ))}
            </select>
          </label>
          <label className="design-drawing__gdt-field">
            Ra (um):
            <input
              type="number"
              className="design-drawing__gdt-tolerance"
              data-testid="design-drawing-surface-finish-ra"
              value={surfaceFinishRa}
              min={0}
              step={0.1}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                const next = parseFloat(e.target.value)
                if (Number.isFinite(next) && next >= 0) setSurfaceFinishRa(next)
              }}
            />
          </label>
          <label className="design-drawing__gdt-field">
            Allow (mm):
            <input
              type="number"
              className="design-drawing__gdt-tolerance"
              data-testid="design-drawing-surface-finish-allowance"
              value={surfaceFinishAllowance}
              min={0}
              step={0.1}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                const next = parseFloat(e.target.value)
                if (Number.isFinite(next) && next >= 0) setSurfaceFinishAllowance(next)
              }}
            />
          </label>
          <label className="design-drawing__gdt-field">
            Lay:
            <select
              className="design-drawing__gdt-characteristic"
              data-testid="design-drawing-surface-finish-lay"
              value={surfaceFinishLay ?? SURFACE_FINISH_LAY_NONE}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => {
                const next = e.target.value
                if (next === SURFACE_FINISH_LAY_NONE) {
                  setSurfaceFinishLay(null)
                } else if ((SURFACE_FINISH_LAY_ORDER as readonly string[]).includes(next)) {
                  setSurfaceFinishLay(next as SurfaceFinishLay)
                }
              }}
            >
              <option value={SURFACE_FINISH_LAY_NONE}>None</option>
              {SURFACE_FINISH_LAY_ORDER.map((l) => (
                <option key={l} value={l}>
                  {SURFACE_FINISH_LAY_LABELS[l]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={
              surfaceFinishPlacing
                ? 'btn btn-primary design-drawing__gdt-btn design-drawing__gdt-btn--placing'
                : 'btn btn-secondary design-drawing__gdt-btn'
            }
            data-testid="design-drawing-surface-finish-place"
            aria-pressed={surfaceFinishPlacing}
            onClick={startSurfaceFinish}
            title={
              surfaceFinishControlled
                ? 'Click, then click a feature to anchor a surface-finish symbol there'
                : 'Surface-finish placement needs a persistence host'
            }
          >
            {surfaceFinishPlacing ? 'Click feature...' : 'Surface finish'}
          </button>
          {surfaceFinishCount > 0 && (
            <button
              type="button"
              className="btn btn-ghost design-drawing__gdt-clear"
              data-testid="design-drawing-surface-finish-clear"
              onClick={clearSurfaceFinish}
              title="Remove every surface-finish symbol overlay"
            >
              Clear
            </button>
          )}
        </div>
        <div
          className="design-drawing__gdt-count"
          data-testid="design-drawing-surface-finish-count"
          aria-live="polite"
        >
          {toolStatusLabel !== null && surfaceFinishPlacing
            ? toolStatusLabel
            : surfaceFinishCount === 0
              ? 'No surface finishes'
              : `${surfaceFinishCount} surface finish${surfaceFinishCount === 1 ? '' : 'es'}`}
        </div>
        {surfaceFinishDanglingCount > 0 && (
          <div
            className="design-drawing__gdt-dangling"
            data-testid="design-drawing-surface-finish-dangling"
            role="status"
            title="These symbols lost their anchored feature on rebuild and are drawn from the last-known position."
          >
            {`${surfaceFinishDanglingCount} dangling`}
          </div>
        )}
      </div>

      {/* CAD V1.5 -- Free-text notes toolbar */}
      <div
        className="design-drawing__gdt-toolbar design-drawing__note-toolbar"
        role="toolbar"
        aria-label="Drawing notes"
        data-testid="design-drawing-note-toolbar"
      >
        <div
          className="design-drawing__gdt-group"
          role="group"
          aria-label="Place a note"
        >
          <label className="design-drawing__gdt-field design-drawing__note-field">
            Note:
            <textarea
              className="design-drawing__note-text"
              data-testid="design-drawing-note-text"
              value={noteDraft}
              rows={2}
              maxLength={500}
              placeholder="e.g. DEBURR ALL EDGES"
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setNoteDraft(e.target.value)}
            />
          </label>
          <button
            type="button"
            className={
              notePlacing
                ? 'btn btn-primary design-drawing__gdt-btn design-drawing__gdt-btn--placing'
                : 'btn btn-secondary design-drawing__gdt-btn'
            }
            data-testid="design-drawing-note-place"
            aria-pressed={notePlacing}
            onClick={startNote}
            title={
              noteControlled
                ? 'Click, then click the sheet to place the note (snap to a feature to attach a leader)'
                : 'Note placement needs a persistence host'
            }
          >
            {notePlacing ? 'Click sheet...' : 'Place note'}
          </button>
          {noteCount > 0 && (
            <button
              type="button"
              className="btn btn-ghost design-drawing__gdt-clear"
              data-testid="design-drawing-note-clear"
              onClick={clearNotes}
              title="Remove every note overlay"
            >
              Clear
            </button>
          )}
        </div>
        <div
          className="design-drawing__gdt-count"
          data-testid="design-drawing-note-count"
          aria-live="polite"
        >
          {toolStatusLabel !== null && notePlacing
            ? toolStatusLabel
            : noteCount === 0
              ? 'No notes'
              : `${noteCount} note${noteCount === 1 ? '' : 's'}`}
        </div>
        {noteDanglingCount > 0 && (
          <div
            className="design-drawing__gdt-dangling"
            data-testid="design-drawing-note-dangling"
            role="status"
            title="These notes lost their leader's anchored feature on rebuild and are drawn from the last-known position."
          >
            {`${noteDanglingCount} dangling`}
          </div>
        )}
        {noteCount > 0 && (
          <ul
            className="design-drawing__note-list"
            data-testid="design-drawing-note-list"
            aria-label="Placed notes"
          >
            {(persistedNotes ?? []).map((note) => (
              <li key={note.id} className="design-drawing__note-row">
                <textarea
                  className="design-drawing__note-edit"
                  data-testid={`design-drawing-note-edit-${note.id}`}
                  value={note.text}
                  rows={1}
                  maxLength={500}
                  aria-label="Edit note text"
                  onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                    editNoteText(note.id, e.target.value)
                  }
                />
                <button
                  type="button"
                  className="btn btn-ghost design-drawing__note-delete"
                  data-testid={`design-drawing-note-delete-${note.id}`}
                  aria-label="Delete note"
                  title="Delete this note"
                  onClick={() => deleteNote(note.id)}
                >
                  <span aria-hidden="true">x</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* CAD V1.5 -- Center mark + centerline toolbar */}
      <div
        className="design-drawing__gdt-toolbar design-drawing__centermark-toolbar"
        role="toolbar"
        aria-label="Center marks and centerlines"
        data-testid="design-drawing-centermark-toolbar"
      >
        <div
          className="design-drawing__gdt-group"
          role="group"
          aria-label="Place center marks and centerlines"
        >
          <label className="design-drawing__gdt-field">
            Mark size (mm):
            <input
              type="number"
              className="design-drawing__gdt-tolerance"
              data-testid="design-drawing-centermark-size"
              value={centerMarkSize}
              min={0.5}
              step={0.5}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                const next = parseFloat(e.target.value)
                if (Number.isFinite(next) && next > 0) setCenterMarkSize(next)
              }}
            />
          </label>
          <button
            type="button"
            className={
              centerMarkPlacing
                ? 'btn btn-primary design-drawing__gdt-btn design-drawing__gdt-btn--placing'
                : 'btn btn-secondary design-drawing__gdt-btn'
            }
            data-testid="design-drawing-centermark-place"
            aria-pressed={centerMarkPlacing}
            onClick={startCenterMark}
            title={
              centerMarkControlled
                ? 'Click, then click a hole or arc centre to stamp a center mark'
                : 'Center-mark placement needs a persistence host'
            }
          >
            {centerMarkPlacing ? 'Click centre...' : 'Center mark'}
          </button>
          <button
            type="button"
            className={
              centerlinePlacing
                ? 'btn btn-primary design-drawing__gdt-btn design-drawing__gdt-btn--placing'
                : 'btn btn-secondary design-drawing__gdt-btn'
            }
            data-testid="design-drawing-centerline-place"
            aria-pressed={centerlinePlacing}
            onClick={startCenterline}
            title={
              centerlineControlled
                ? 'Click, then click two features to draw a chain-dashed centerline between them'
                : 'Centerline placement needs a persistence host'
            }
          >
            {centerlinePlacing ? (centerlineAtStep1 ? 'Click p2...' : 'Click p1...') : 'Centerline'}
          </button>
          {centerMarkCount > 0 && (
            <button
              type="button"
              className="btn btn-ghost design-drawing__gdt-clear"
              data-testid="design-drawing-centermark-clear"
              onClick={clearCenterMarks}
              title="Remove every center-mark overlay"
            >
              Clear marks
            </button>
          )}
          {centerlineCount > 0 && (
            <button
              type="button"
              className="btn btn-ghost design-drawing__gdt-clear"
              data-testid="design-drawing-centerline-clear"
              onClick={clearCenterlines}
              title="Remove every centerline overlay"
            >
              Clear lines
            </button>
          )}
        </div>
        <div
          className="design-drawing__gdt-count"
          data-testid="design-drawing-centermark-count"
          aria-live="polite"
        >
          {toolStatusLabel !== null && (centerMarkPlacing || centerlinePlacing)
            ? toolStatusLabel
            : centerMarkCount === 0 && centerlineCount === 0
              ? 'No center marks'
              : `${centerMarkCount} center mark${centerMarkCount === 1 ? '' : 's'}, ${centerlineCount} centerline${centerlineCount === 1 ? '' : 's'}`}
        </div>
        {centerMarkDanglingCount + centerlineDanglingCount > 0 && (
          <div
            className="design-drawing__gdt-dangling"
            data-testid="design-drawing-centermark-dangling"
            role="status"
            title="These center marks / centerlines lost their anchored feature on rebuild and are drawn from the last-known position."
          >
            {`${centerMarkDanglingCount + centerlineDanglingCount} dangling`}
          </div>
        )}
        {(centerMarkCount > 0 || centerlineCount > 0) && (
          <ul
            className="design-drawing__note-list design-drawing__centermark-list"
            data-testid="design-drawing-centermark-list"
            aria-label="Placed center marks and centerlines"
          >
            {(persistedCenterMarks ?? []).map((mark) => (
              <li key={mark.id} className="design-drawing__note-row">
                <span className="design-drawing__centermark-row-label">
                  {`Center mark @ (${mark.anchor.cachedPoint.x.toFixed(1)}, ${mark.anchor.cachedPoint.y.toFixed(1)})`}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost design-drawing__note-delete"
                  data-testid={`design-drawing-centermark-delete-${mark.id}`}
                  aria-label="Delete center mark"
                  title="Delete this center mark"
                  onClick={() => deleteCenterMark(mark.id)}
                >
                  <span aria-hidden="true">x</span>
                </button>
              </li>
            ))}
            {(persistedCenterlines ?? []).map((line) => (
              <li key={line.id} className="design-drawing__note-row">
                <span className="design-drawing__centermark-row-label">
                  {`Centerline (${line.start.cachedPoint.x.toFixed(1)}, ${line.start.cachedPoint.y.toFixed(1)}) -- (${line.end.cachedPoint.x.toFixed(1)}, ${line.end.cachedPoint.y.toFixed(1)})`}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost design-drawing__note-delete"
                  data-testid={`design-drawing-centerline-delete-${line.id}`}
                  aria-label="Delete centerline"
                  title="Delete this centerline"
                  onClick={() => deleteCenterline(line.id)}
                >
                  <span aria-hidden="true">x</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* CAD V1.5 -- Detail (crop) view tool */}
      {onDetail && (
        <div
          className="design-drawing__detail-toolbar"
          role="toolbar"
          aria-label="Detail view"
          data-testid="design-drawing-detail-toolbar"
        >
          <button
            type="button"
            className={
              detailPlacing
                ? 'btn btn-primary design-drawing__detail-btn design-drawing__detail-btn--placing'
                : 'btn btn-secondary design-drawing__detail-btn'
            }
            data-testid="design-drawing-detail-place"
            aria-pressed={detailPlacing}
            onClick={startDetail}
            disabled={svg === null}
            aria-disabled={svg === null}
            title="Click a centre, then a point to set the crop radius for a magnified detail view"
          >
            {detailPlacing ? 'Click crop...' : 'Detail view'}
          </button>
          <label className="design-drawing__detail-field">
            Scale:
            <input
              type="number"
              className="design-drawing__detail-scale"
              data-testid="design-drawing-detail-scale"
              value={detailScale}
              min={0.1}
              step={0.5}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                const next = parseFloat(e.target.value)
                if (Number.isFinite(next) && next > 0) setDetailScale(next)
              }}
            />
          </label>
          <label className="design-drawing__detail-field">
            Label:
            <input
              type="text"
              className="design-drawing__detail-label"
              data-testid="design-drawing-detail-label"
              value={detailLabel}
              maxLength={40}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setDetailLabel(e.target.value)}
            />
          </label>
          {toolStatusLabel !== null && detailPlacing && (
            <span
              className="design-drawing__detail-status"
              data-testid="design-drawing-detail-status"
              aria-live="polite"
            >
              {toolStatusLabel}
            </span>
          )}
        </div>
      )}

      {/* CAD V1.5 -- Sections toggle */}
      <div
        className="design-drawing__section-toolbar"
        role="toolbar"
        aria-label="Section view"
        data-testid="design-drawing-section-toolbar"
      >
        <button
          type="button"
          className={
            sectionEnabled
              ? 'btn btn-primary design-drawing__section-toggle design-drawing__section-toggle--on'
              : 'btn btn-secondary design-drawing__section-toggle'
          }
          data-testid="design-drawing-section-toggle"
          aria-pressed={sectionEnabled}
          onClick={toggleSection}
          title="Toggle the section view on or off"
        >
          {sectionEnabled ? 'Section: ON' : 'Section: OFF'}
        </button>
        {sectionEnabled && (
          <div
            className="design-drawing__section-controls"
            data-testid="design-drawing-section-controls"
          >
            <label className="design-drawing__section-label">
              Axis:
              <select
                className="design-drawing__section-axis"
                data-testid="design-drawing-section-axis"
                value={sectionPlane.axis}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => {
                  const next = e.target.value
                  if (next === 'x' || next === 'y' || next === 'z') {
                    updateSectionAxis(next)
                  }
                }}
              >
                <option value="x">X</option>
                <option value="y">Y</option>
                <option value="z">Z</option>
              </select>
            </label>
            <label className="design-drawing__section-label">
              Offset (mm):
              <input
                type="number"
                className="design-drawing__section-offset"
                data-testid="design-drawing-section-offset"
                value={sectionPlane.offset}
                step={0.5}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  const next = parseFloat(e.target.value)
                  updateSectionOffset(next)
                }}
              />
            </label>
            <label className="design-drawing__section-label">
              Label:
              <input
                type="text"
                className="design-drawing__section-label-input"
                data-testid="design-drawing-section-label"
                value={sectionLabel}
                maxLength={24}
                placeholder="A-A"
                onChange={(e: ChangeEvent<HTMLInputElement>) => setSectionLabel(e.target.value)}
                title="Cutting-plane label (e.g. A-A). Escaped before it reaches the drawing."
              />
            </label>
          </div>
        )}
      </div>

      <div
        className="design-drawing__canvas"
        data-testid="design-drawing-canvas"
        aria-label={`${DRAWING_VIEW_LABELS[activeView]} drawing`}
        aria-busy={busy}
      >
        {svg !== null ? (
          // Inline SVG render -- trusted because the sidecar is the trust
          // boundary (see file-header rationale).
          <div
            ref={svgHostRef}
            className={
              placementState !== null || toolMode !== null || runState !== null
                ? 'design-drawing__svg-host design-drawing__svg-host--placing'
                : 'design-drawing__svg-host'
            }
            data-testid="design-drawing-svg"
            data-placement-active={
              placementState !== null || toolMode !== null || runState !== null
                ? 'true'
                : undefined
            }
            // eslint-disable-next-line react/no-danger -- sidecar-trusted SVG + client-composed surface-finish layer (markup-safe by construction); see file-header rationale
            dangerouslySetInnerHTML={{ __html: displaySvg ?? svg }}
            onPointerMove={handlePointerMove}
            onPointerDown={handlePointerDown}
          />
        ) : sectionViewActive && sectionUnavailable && !busy ? (
          // Honest placeholder: the projector could not produce a section for
          // this part (handler error or section bridge absent). We never draw
          // fabricated section geometry.
          <div
            className="design-drawing__placeholder design-drawing__placeholder--section-unavailable"
            data-testid="design-drawing-section-unavailable"
            role="note"
          >
            Section preview not available -- this part could not be sectioned on
            the {SECTION_AXIS_LABEL[sectionPlane.axis]} plane. Adjust the cut
            plane or pick another view.
          </div>
        ) : (
          <div
            className="design-drawing__placeholder"
            data-testid="design-drawing-placeholder"
          >
            {busy
              ? `Projecting ${sectionViewActive ? 'Section' : DRAWING_VIEW_LABELS[activeView]} view...`
              : 'No drawing yet -- pick a view above.'}
          </div>
        )}

        {/* Snap indicator overlay -- wired but inert until snapPoints is populated */}
        {hoveredSnap !== null && (
          <div
            className="design-drawing__snap-indicator"
            data-testid="design-drawing-snap-indicator"
            data-snap-kind={hoveredSnap.kind}
            aria-hidden="true"
          />
        )}
      </div>

      {/* CAD V1.5 -- Title-block side panel (always visible) */}
      <aside
        className="design-drawing__title-panel"
        aria-label="Drawing title block"
        data-testid="design-drawing-title-panel"
      >
        <h3 className="design-drawing__title-panel-heading">Title Block</h3>
        <p
          className="design-drawing__projection-caveat"
          data-testid="design-drawing-projection-caveat"
          role="note"
        >
          {hlrEnabled
            ? 'True hidden-line removal is ON: visible edges are solid, hidden edges dashed. Verify critical dimensions against the model.'
            : 'Projected views are mesh-edge previews. Enable "Hidden lines" above for true hidden-line removal. Verify critical dimensions against the model.'}
        </p>
        <label className="design-drawing__title-row">
          <span className="design-drawing__title-label">Name</span>
          <input
            type="text"
            className="design-drawing__title-input"
            data-testid="design-drawing-title-name"
            value={titleBlock.name}
            maxLength={80}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              updateTitleField('name', e.target.value)
            }
          />
        </label>
        <label className="design-drawing__title-row">
          <span className="design-drawing__title-label">Scale</span>
          <input
            type="text"
            className="design-drawing__title-input"
            data-testid="design-drawing-title-scale"
            value={titleBlock.scale}
            maxLength={80}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              updateTitleField('scale', e.target.value)
            }
          />
        </label>
        <label className="design-drawing__title-row">
          <span className="design-drawing__title-label">Author</span>
          <input
            type="text"
            className="design-drawing__title-input"
            data-testid="design-drawing-title-author"
            value={titleBlock.author}
            maxLength={80}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              updateTitleField('author', e.target.value)
            }
          />
        </label>
        <label className="design-drawing__title-row">
          <span className="design-drawing__title-label">Date</span>
          <input
            type="text"
            className="design-drawing__title-input"
            data-testid="design-drawing-title-date"
            value={titleBlock.date}
            maxLength={80}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              updateTitleField('date', e.target.value)
            }
          />
        </label>
        <label className="design-drawing__title-row">
          <span className="design-drawing__title-label">Sheet</span>
          <input
            type="text"
            className="design-drawing__title-input"
            data-testid="design-drawing-title-sheet"
            value={titleBlock.sheet}
            maxLength={80}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              updateTitleField('sheet', e.target.value)
            }
          />
        </label>
      </aside>

      {/*
        Placeable BOM table -- qty / name / source rows from the engine
        `deriveDrawingBom` seam (rendered as rows the host already rolled up;
        this panel does NOT recompute). Renders only when the host opts in by
        supplying `bomLines`; an empty array shows the honest empty state.
      */}
      {showBomPanel && (
        <aside
          className="design-drawing__bom"
          data-testid="design-drawing-bom"
          aria-label="Drawing bill of materials"
        >
          <div className="design-drawing__bom-header">
            <span className="design-drawing__bom-title">Bill of materials</span>
            <span
              className="design-drawing__bom-count"
              data-testid="design-drawing-bom-count"
            >
              {`${effectiveBomLines.length} line${effectiveBomLines.length === 1 ? '' : 's'}`}
            </span>
          </div>
          {effectiveBomLines.length === 0 ? (
            <EmptyState
              testId="design-drawing-bom-empty"
              title="No parts to list"
              body="Add parts to the assembly (or build a part) to populate this drawing bill of materials."
            />
          ) : (
            <table
              className="data-table design-drawing__bom-table"
              data-testid="design-drawing-bom-grid"
            >
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Qty</th>
                  <th scope="col">Name</th>
                  <th scope="col">Source</th>
                </tr>
              </thead>
              <tbody>
                {effectiveBomLines.map((row) => (
                  <tr
                    key={row.item}
                    className="design-drawing__bom-row"
                    data-testid={`design-drawing-bom-row-${row.item}`}
                  >
                    <td className="design-drawing__bom-cell-item">{row.item}</td>
                    <td className="design-drawing__bom-cell-qty">{row.qty}</td>
                    <td className="design-drawing__bom-cell-name">{row.description}</td>
                    <td
                      className="design-drawing__bom-cell-source"
                      title={row.partNumber}
                    >
                      {row.partNumber.length > 0 ? row.partNumber : '--'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </aside>
      )}
    </div>
  )
}

export default DrawingView
