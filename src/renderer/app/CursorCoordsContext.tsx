/**
 * CursorCoordsContext — Wave 3n: live cursor world-coordinates for the shell
 * StatusBar (the X/Y/Z read-out every CAD app keeps in its status strip).
 *
 * Design (mirrors `CamHandoffContext` placement + the `useOptionalCommandSurface`
 * provider-tolerance convention):
 *   - SPLIT value/setter contexts. Producers (the Design workspace host) read
 *     only the SETTER context, whose value is a stable function — so
 *     mouse-move-frequency updates re-render ONLY the value consumers (the
 *     StatusBar read-out), never the producing workspace tree or the shell.
 *   - The setter de-dupes on field equality before committing state, so a
 *     pointer wobbling inside one snap cell costs zero re-renders.
 *   - `useCursorCoords` returns `null` without a provider (it never throws):
 *     the StatusBar render-pin tests mount it bare and must keep getting the
 *     honest em-dash placeholders.
 *   - `useOptionalSetCursorCoords` degrades to a stable no-op without a
 *     provider — `DesignWorkspaceHost` is rendered provider-less by node-env
 *     SSR pins (same rationale as `useOptionalCommandSurface`).
 *
 * Sources (both threaded, never recomputed):
 *   - `sketch2d` — the mounted sketch canvas's OWN pointer→world value
 *     (`Sketch2DCanvas.onMouseMove`'s snap-resolved point, the exact value its
 *     placement/crosshair logic uses), threaded up through SketchSurface →
 *     DesignWorkspace → DesignWorkspaceHost. X/Y are SKETCH-PLANE mm (the
 *     StatusBar leaves Z blank — honest: the plane's world Z is not part of
 *     the canvas value).
 *   - `pick3d` — the LAST face/edge pick's raycast intersection point from
 *     `Viewport3D` (world mm). A per-frame hover raycast was deliberately
 *     rejected as too heavy; the honest scope is the last pick.
 *
 * Data-only: no IPC, no G-code, no persistence.
 */
import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactElement,
  type ReactNode
} from 'react'

/** One live coordinate read-out, discriminated by its producing surface. */
export type CursorCoords =
  | {
      /** 2D sketch cursor — X/Y in SKETCH-PLANE mm (no world Z available). */
      readonly kind: 'sketch2d'
      readonly xMm: number
      readonly yMm: number
    }
  | {
      /** Last viewport face/edge pick — full world-space point in mm. */
      readonly kind: 'pick3d'
      readonly xMm: number
      readonly yMm: number
      readonly zMm: number
    }

/** Publish the current coords, or `null` when the source goes inactive. */
export type SetCursorCoords = (next: CursorCoords | null) => void

/**
 * Field-equality for the setter's de-dupe bail. Exported for the unit test;
 * pure (no React).
 */
export function cursorCoordsEqual(a: CursorCoords | null, b: CursorCoords | null): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (a.kind === 'sketch2d' && b.kind === 'sketch2d') {
    return a.xMm === b.xMm && a.yMm === b.yMm
  }
  if (a.kind === 'pick3d' && b.kind === 'pick3d') {
    return a.xMm === b.xMm && a.yMm === b.yMm && a.zMm === b.zMm
  }
  return false
}

const CursorCoordsValueContext = createContext<CursorCoords | null>(null)
const CursorCoordsSetterContext = createContext<SetCursorCoords | null>(null)

export function CursorCoordsProvider({
  children,
  initialCoords = null
}: {
  readonly children: ReactNode
  /**
   * Test seam: seed the provider with a value so node-env `renderToStaticMarkup`
   * pins (where effects never run and events can't fire) can render the
   * StatusBar's "coords visible" branch. Production mounts omit it (null).
   */
  readonly initialCoords?: CursorCoords | null
}): ReactElement {
  const [coords, setCoords] = useState<CursorCoords | null>(initialCoords)
  // Stable identity + field-equality bail: a pointer wobbling inside one snap
  // cell publishes identical values and must not re-render the StatusBar.
  const publish = useCallback<SetCursorCoords>((next) => {
    setCoords((prev) => (cursorCoordsEqual(prev, next) ? prev : next))
  }, [])
  return (
    <CursorCoordsSetterContext.Provider value={publish}>
      <CursorCoordsValueContext.Provider value={coords}>
        {children}
      </CursorCoordsValueContext.Provider>
    </CursorCoordsSetterContext.Provider>
  )
}

/**
 * Read the live coords (StatusBar). `null` when no source is active OR no
 * provider is mounted — both render as the honest em-dash placeholders.
 */
export function useCursorCoords(): CursorCoords | null {
  return useContext(CursorCoordsValueContext)
}

/** Stable no-op for the provider-less branch (no identity churn). */
const NOOP_SET_CURSOR_COORDS: SetCursorCoords = (_next) => {
  void _next
}

/**
 * Producer hook: the live publish function when a {@link CursorCoordsProvider}
 * is an ancestor, else a stable no-op (provider-tolerant — mirrors
 * `useOptionalCommandSurface` for the SSR-pinned Design host).
 */
export function useOptionalSetCursorCoords(): SetCursorCoords {
  return useContext(CursorCoordsSetterContext) ?? NOOP_SET_CURSOR_COORDS
}
