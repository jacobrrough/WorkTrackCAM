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
  type SnapResult,
} from './drawing-snap'

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
}

function readDrawingBridge(): DrawingBridge {
  const cadAny = (fab().cad as unknown) as DrawingBridge
  return {
    projectDrawing: cadAny.projectDrawing,
    dimensionDrawing: cadAny.dimensionDrawing,
    sectionDrawing: cadAny.sectionDrawing,
    attachTitleBlock: cadAny.attachTitleBlock,
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
}: DrawingViewProps): JSX.Element {
  const [activeView, setActiveView] = useState<DrawingViewAxis>(initialView)
  const [svg, setSvg] = useState<string | null>(previewSvg ?? null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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
   * Snap points list.
   *
   * DEFERRED HOOK: currently always []. A future PR will wire
   * `fab.cad.extractSnapPoints({ handle, view })` here via a useEffect.
   * When populated, resolveSnap snaps to the nearest projected geometry
   * within `snapTolerance` SVG units. For now, free-cursor placement.
   */
  const [snapPoints] = useState<readonly SnapPoint[]>([])

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

  // -- Snap helpers ---------------------------------------------------------

  /**
   * Resolve pointer client coords to SVG space and run snap resolution.
   */
  const resolveCursorSvg = useCallback(
    (
      clientX: number,
      clientY: number
    ): { svgCoord: { x: number; y: number }; snap: SnapResult | null } => {
      const host = svgHostRef.current
      const svgEl = host ? host.querySelector('svg') : null
      if (svgEl === null) {
        return { svgCoord: { x: clientX, y: clientY }, snap: null }
      }
      const svgCoord = clientToSvgCoord(clientX, clientY, svgEl as SVGSVGElement)
      const snap = resolveSnap(svgCoord, snapPoints, snapTolerance, altHeld)
      return { svgCoord, snap }
    },
    [snapPoints, snapTolerance, altHeld]
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
      const { svgCoord, snap } = resolveCursorSvg(e.clientX, e.clientY)
      const clickSvg = snap ?? svgCoord
      const { next, completed } = advanceDimensionPlacement(placementState, clickSvg)
      setPlacementState(next)
      if (completed !== undefined) {
        setHoveredSnap(null)
        const spec = makePlacedDimensionSpec(completed.kind, completed.p1, completed.p2)
        setDimensions((prev) => [...prev, spec])
      }
    },
    [placementState, resolveCursorSvg]
  )

  // -- Existing callbacks ---------------------------------------------------

  const toast = useCallback(
    (kind: 'ok' | 'err' | 'warn', message: string): void => {
      onToast?.(kind, message)
    },
    [onToast],
  )

  /**
   * Start interactive placement for the given kind.
   */
  const startPlacement = useCallback((kind: DrawingDimensionKind): void => {
    setPlacementState(startDimensionPlacement(kind))
    setHoveredSnap(null)
  }, [])

  const clearDimensions = useCallback((): void => {
    setDimensions([])
    setPlacementState(null)
    setHoveredSnap(null)
  }, [])

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

  // Memoize the dimensions array so the effect below doesn't re-fire on
  // every render of the parent.
  const dimensionsRef = useMemo(() => dimensions, [dimensions])

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
          {dimensions.length > 0 && (
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
        </div>
        <div
          className="design-drawing__dim-count"
          data-testid="design-drawing-dim-count"
          aria-live="polite"
        >
          {placementLabel !== null
            ? placementLabel
            : dimensions.length === 0
              ? 'No dimensions added'
              : `${dimensions.length} dimension${dimensions.length === 1 ? '' : 's'}`}
        </div>
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
