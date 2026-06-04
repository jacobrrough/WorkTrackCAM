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
import type { DrawingDimension } from '../../shared/drawing-annotation-schema'

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
  }
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
}: DrawingViewProps): JSX.Element {
  const [activeView, setActiveView] = useState<DrawingViewAxis>(initialView)
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
  const [titleBlock, setTitleBlock] = useState<DrawingTitleBlock>(
    initialTitleBlock ?? defaultTitleBlock(),
  )

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

  // -- Pointer handlers -----------------------------------------------------

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>): void => {
      if (placementState === null) {
        setHoveredSnap(null)
        return
      }
      const { snap } = resolveCursorSvg(e.clientX, e.clientY)
      setHoveredSnap(snap)
    },
    [placementState, resolveCursorSvg]
  )

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>): void => {
      if (placementState === null) return
      if (e.button !== 0) return
      const { svgCoord, snap, sourceId } = resolveCursorSvg(e.clientX, e.clientY)
      const clickSvg = snap ?? svgCoord
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
    [placementState, resolveCursorSvg, commitPlacement]
  )

  /**
   * Start interactive placement for the given kind.
   */
  const startPlacement = useCallback((kind: DrawingDimensionKind): void => {
    setPlacementState(startDimensionPlacement(kind))
    clickHistoryRef.current = []
    setHoveredSnap(null)
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

  const toggleSection = useCallback((): void => {
    setSectionEnabled((prev) => !prev)
  }, [])

  const updateSectionAxis = useCallback((axis: DrawingSectionAxis): void => {
    setSectionPlane((prev) => ({ ...prev, axis }))
  }, [])

  const updateSectionOffset = useCallback((offset: number): void => {
    if (!Number.isFinite(offset)) return
    setSectionPlane((prev) => ({ ...prev, offset }))
  }, [])

  const updateTitleField = useCallback(
    (field: keyof DrawingTitleBlock, value: string): void => {
      setTitleBlock((prev) => ({ ...prev, [field]: value }))
    },
    [],
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
    void (async () => {
      try {
        let svgText: string | null = null
        // Stage 1: base projection (section or plain).
        if (sectionEnabled && bridge.sectionDrawing) {
          const res = await bridge.sectionDrawing({
            handle: partHandle,
            view: activeView,
            plane: sectionPlane,
          })
          if (cancelled) return
          if (!res.ok) {
            const detail = res.hint ? ` -- ${res.hint}` : ''
            setError(`Section projection failed: ${res.error}${detail}`)
            toast('err', `Section projection failed: ${res.error}`)
            setSvg(null)
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
    dimensionsRef,
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
          {TOOLBAR_ORDER.map((view) => {
            const isActive = view === activeView
            return (
              <button
                key={view}
                type="button"
                className={
                  isActive
                    ? 'btn btn-primary design-drawing__view-btn design-drawing__view-btn--active'
                    : 'btn btn-secondary design-drawing__view-btn'
                }
                data-testid={drawingViewTestId(view)}
                aria-pressed={isActive}
                onClick={() => setActiveView(view)}
              >
                {DRAWING_VIEW_LABELS[view]}
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
              placementState !== null
                ? 'design-drawing__svg-host design-drawing__svg-host--placing'
                : 'design-drawing__svg-host'
            }
            data-testid="design-drawing-svg"
            data-placement-active={placementState !== null ? 'true' : undefined}
            // eslint-disable-next-line react/no-danger -- sidecar-trusted SVG; see file-header rationale
            dangerouslySetInnerHTML={{ __html: svg }}
            onPointerMove={handlePointerMove}
            onPointerDown={handlePointerDown}
          />
        ) : (
          <div
            className="design-drawing__placeholder"
            data-testid="design-drawing-placeholder"
          >
            {busy
              ? `Projecting ${DRAWING_VIEW_LABELS[activeView]} view...`
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
    </div>
  )
}

export default DrawingView
