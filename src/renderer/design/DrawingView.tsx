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
  buildAngularDimension,
  buildDiameterDimension,
  buildLinearDimension,
  buildRadialDimension,
  reanchorDimensions,
  type FreshSnapPoint,
  type ResolvedClick,
} from './drawing-annotation-model'
import {
  buildGdtFrame,
  gdtFramesToSpecs,
  reanchorGdtFrames,
} from './drawing-gdt-model'
import type {
  DrawingBomRow,
  DrawingDimension,
  GdtCharacteristic,
  GdtFeatureControlFrame,
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
 * fetch. Ordinate / baseline / chain dimensions render as their underlying
 * point-to-point measurement (the handler has no ordinate primitive yet), so
 * they degrade to a `distance` overlay using their two governing anchors.
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

  // -- CAD V2 placement state -----------------------------------------------

  /**
   * Interactive placement state machine. null = idle.
   * Non-null = operator clicked a dimension button and is placing p1/p2.
   */
  const [placementState, setPlacementState] = useState<DimensionPlacementState>(null)

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
      clientY: number
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
      const snap = resolveSnap(svgCoord, snapPoints, snapTolerance, altHeld)
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
      if (placementState === null && toolMode === null) {
        setHoveredSnap(null)
        return
      }
      const { snap } = resolveCursorSvg(e.clientX, e.clientY)
      setHoveredSnap(snap)
    },
    [placementState, toolMode, resolveCursorSvg]
  )

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>): void => {
      if (e.button !== 0) return
      const { svgCoord, snap, sourceId } = resolveCursorSvg(e.clientX, e.clientY)
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
    [placementState, toolMode, resolveCursorSvg, commitPlacement, commitGdtFrame, runDetail]
  )

  /**
   * Start interactive dimension placement for the given kind. Cancels any active
   * GD&T / detail tool so a click is never ambiguous between the two pipelines.
   */
  const startPlacement = useCallback((kind: DrawingDimensionKind): void => {
    setToolMode(null)
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
    clickHistoryRef.current = []
    setHoveredSnap(null)
  }, [controlled, onPersistDimensions])

  /** Remove every GD&T frame overlay (controlled mode only). */
  const clearGdt = useCallback((): void => {
    onPersistGdt?.([])
    setToolMode(null)
    setHoveredSnap(null)
  }, [onPersistGdt])

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
      return (persistedDimensions ?? []).map(persistedDimensionToSpec)
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
  /** Whether the Detail tool is armed (either step). */
  const detailPlacing = toolMode !== null && toolMode.tool === 'detail'

  /** Status line for the GD&T / detail tool area. */
  const toolStatusLabel: string | null = gdtPlacing
    ? `Placing ${GDT_CHARACTERISTIC_LABELS[gdtCharacteristic]} frame -- click the feature`
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
              placementState !== null || toolMode !== null
                ? 'design-drawing__svg-host design-drawing__svg-host--placing'
                : 'design-drawing__svg-host'
            }
            data-testid="design-drawing-svg"
            data-placement-active={placementState !== null || toolMode !== null ? 'true' : undefined}
            // eslint-disable-next-line react/no-danger -- sidecar-trusted SVG; see file-header rationale
            dangerouslySetInnerHTML={{ __html: svg }}
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
          Projected views are mesh-edge previews, not certified hidden-line
          removal (HLR). Verify critical dimensions against the model.
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
