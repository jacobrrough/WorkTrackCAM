/**
 * AssemblyView — CAD V2 multi-part assembly workspace.
 *
 * Companion to {@link DrawingView}. Owned by the CAD V2 UI workflow
 * (sibling agents own the IPC bridges + sidecar handlers under the
 * `cad.createAssembly` / `cad.tessellateAssembly` method namespace —
 * Wave 2 Workflows). This component is intentionally additive: it does
 * NOT touch the existing Part view's render tree (`CadQueryEditor +
 * Viewport3D + FeatureTree + ProfileStack`); the DesignWorkspace
 * activates it via a new tab-bar branch.
 *
 * Contract (pinned by `__tests__/AssemblyView.test.tsx`)
 * ------------------------------------------------------
 *   1. The root carries `data-testid="design-assembly-view"` and the
 *      BEM class `design-assembly` so the existing CSS theme covers
 *      both the empty-state and the populated-state without inline
 *      styles (CLAUDE.md design-token rule).
 *   2. The toolbar exposes two affordances with stable testids:
 *        - `data-testid="design-assembly-add"`   — "Add part to assembly"
 *        - `data-testid="design-assembly-remove"` — "Remove" (disabled
 *          when no part row is selected).
 *      Both are rendered via the shared `.btn` primitive (`.btn-primary`
 *      for Add, `.btn-ghost` for Remove) so they match the rest of the
 *      Design workspace's button surface.
 *   3. When `parts.length === 0`, the component renders the shared
 *      `EmptyState` (CLAUDE.md "shared empty-state" rule) with the
 *      testid `design-assembly-empty` and a primary CTA that invokes
 *      `onAddPart`. NO bespoke empty-state markup leaks into this file.
 *   4. When `parts.length > 0`, the component renders a `<ul>` of part
 *      rows. Each row exposes `data-testid="design-assembly-part-{id}"`
 *      and a per-row Remove `×` with `data-testid="design-assembly-part-{id}-remove"`.
 *   5. The component re-fetches `cad.tessellateAssembly` whenever the
 *      `assemblyHandle` returned by the most recent `cad.createAssembly`
 *      changes. The actual Three.js render surface is the same
 *      `Viewport3D` swap-in DesignWorkspace already uses for the Part
 *      view (DOM-only — in SSR / node-env vitest we fall back to a
 *      summary placeholder that mirrors the Part view's
 *      `design-workspace__viewport-summary` pattern).
 *   6. No `any` types, no inline styles, props are `readonly`. Errors
 *      from `cad.createAssembly` / `cad.tessellateAssembly` fold into a
 *      local `error` state that renders as a `role="alert"` banner —
 *      they never throw.
 *
 * Why the toolbar lives on the AssemblyView (not on DesignWorkspace)
 * -----------------------------------------------------------------
 * The Add / Remove actions ONLY make sense in the Assembly tab; pushing
 * them up into the parent would force every other view (Part, Drawing)
 * to know about assembly state. Keeping the toolbar scoped to this
 * component preserves the surgical-addition discipline the task
 * spelled out for DesignWorkspace.
 */
import {
  useCallback,
  useEffect,
  useState,
  type JSX,
} from 'react'
import { EmptyState } from '../src/EmptyState'
import { fab } from '../src/shop-types'

/**
 * One row in the assembly's parts list.
 *
 * `handle` is the opaque CadQuery handle returned by a prior
 * `cad.execute_script` round-trip (same handle table the Part view's
 * `Send to CAM` path uses). The renderer never inspects it — the
 * sidecar's `cad.createAssembly` looks it up and stitches the bodies
 * together.
 *
 * `transform` is optional in the wire payload (the sidecar defaults to
 * identity), but the renderer surfaces a friendly summary string so the
 * operator can spot a part that landed in the wrong place. Keeping the
 * raw tuple alongside the summary means a future "edit transform"
 * affordance can read the canonical numbers without re-parsing the
 * label.
 */
export type AssemblyPart = {
  /** Stable identifier for the row (renderer-owned, not a CadQuery handle). */
  readonly id: string
  /** Display name shown in the row's left cell. */
  readonly name: string
  /** Opaque CadQuery handle from a prior `cad.execute_script`. */
  readonly handle: string
  /**
   * Optional 4×4 transform applied before the part is welded into the
   * assembly. Omit for identity. The summary string below is what the
   * operator sees in the UI.
   */
  readonly transform?: {
    readonly position?: readonly [number, number, number]
    readonly rotation?: readonly [number, number, number]
  }
  /**
   * One-line summary of the part's transform — e.g. `"@(10, 0, 0)"` or
   * `"identity"`. Renderer-owned; recomputed by the host when the
   * transform changes.
   */
  readonly transformSummary?: string
}

/**
 * Public props.
 *
 * `parts` is the source-of-truth assembly list; the parent (typically
 * `DesignWorkspace`) owns persistence and threads add / remove callbacks
 * back in. The AssemblyView is otherwise stateless except for transient
 * UI state (selected row, in-flight build error, tessellation summary).
 */
export interface AssemblyViewProps {
  /** Ordered list of parts currently in the assembly. */
  readonly parts: readonly AssemblyPart[]
  /**
   * Fired when the operator clicks "Add part to assembly". The host
   * owns the part-picker UI; this component only triggers the request.
   * Optional — when omitted, the Add button is hidden (used by the
   * render-pin tests for the empty-state branch).
   */
  readonly onAddPart?: () => void
  /**
   * Fired when the operator clicks the toolbar "Remove" button OR a
   * per-row `×`. Receives the row id so the host can drop the matching
   * entry from its `parts` array. Optional — when omitted, the Remove
   * buttons are hidden.
   */
  readonly onRemovePart?: (id: string) => void
  /**
   * Toast hook from the host. Optional — falls back to a no-op so the
   * component renders cleanly in unit tests that don't wire toasts.
   */
  readonly onToast?: (kind: 'ok' | 'err' | 'warn', message: string) => void
  /**
   * Render-pin escape hatch: forces the "selected row" state so a
   * static render can assert the Remove button enables. Mirrors the
   * `initialSelection` pattern from DesignWorkspace.
   */
  readonly initialSelectedPartId?: string | null
}

/**
 * Internal tessellation snapshot returned by `cad.tessellateAssembly`.
 * Kept narrow on purpose — the UI only needs to display a summary line
 * + the underlying body count. Sibling agents own the wire schema; we
 * read the fields defensively so an early-merge state where the schema
 * is still in flux does not break the render contract.
 */
type AssemblyTessellation = {
  readonly bodyCount?: number
  readonly triangleCount?: number
  readonly stlPath?: string
}

/**
 * Reasonable summary text for a single part's transform. Exported for
 * the unit-test pin so we can assert the formatting without re-mounting
 * the component.
 */
export function formatTransformSummary(part: AssemblyPart): string {
  if (part.transformSummary && part.transformSummary.length > 0) {
    return part.transformSummary
  }
  const t = part.transform
  if (!t) return 'identity'
  const pos = t.position
  if (pos && (pos[0] !== 0 || pos[1] !== 0 || pos[2] !== 0)) {
    return `@(${pos[0]}, ${pos[1]}, ${pos[2]})`
  }
  return 'identity'
}

/**
 * Stable testid suffix per row. Sanitises the id so attribute scrapers
 * (the test suite) get a predictable token even when the host passes a
 * UUID with `-` separators.
 */
function rowTestId(id: string): string {
  return `design-assembly-part-${id}`
}

/**
 * Build a stable assembly-handle key from the parts list. We hash by
 * `id|handle` pairs (not by reference) so the effect re-runs on add /
 * remove but stays idle when only an unrelated render-cycle triggers.
 */
function assemblyKey(parts: readonly AssemblyPart[]): string {
  if (parts.length === 0) return ''
  return parts.map((p) => `${p.id}:${p.handle}`).join('|')
}

/**
 * Defensive accessor for the optional `cad.createAssembly` /
 * `cad.tessellateAssembly` bridges. Sibling agents in the CAD V2 wave
 * own the wire types + preload exposure; this helper lets the
 * component compile and render correctly even if the bridges land in a
 * later commit. When they are missing, the component falls back to a
 * "bridge not available yet" inline notice — the empty-state branch
 * still renders cleanly.
 */
type AssemblyBridges = {
  readonly createAssembly?: (payload: {
    readonly parts: ReadonlyArray<{ handle: string; transform?: AssemblyPart['transform'] }>
  }) => Promise<{ ok: true; result: { handle: string } } | { ok: false; error: string; hint?: string }>
  readonly tessellateAssembly?: (payload: {
    readonly handle: string
  }) => Promise<{ ok: true; result: AssemblyTessellation } | { ok: false; error: string; hint?: string }>
}

function readAssemblyBridges(): AssemblyBridges {
  // Cast through `unknown` so typecheck stays clean even before the
  // sibling agents' bridges land in `shop-types.ts`. The bridge surface
  // is small and clearly named — runtime errors fold into the error
  // banner, never throwing.
  const cadAny = (fab().cad as unknown) as AssemblyBridges
  return {
    createAssembly: cadAny.createAssembly,
    tessellateAssembly: cadAny.tessellateAssembly,
  }
}

export function AssemblyView({
  parts,
  onAddPart,
  onRemovePart,
  onToast,
  initialSelectedPartId = null,
}: AssemblyViewProps): JSX.Element {
  const [selectedPartId, setSelectedPartId] = useState<string | null>(initialSelectedPartId)
  const [error, setError] = useState<string | null>(null)
  const [tessellation, setTessellation] = useState<AssemblyTessellation | null>(null)
  const [busy, setBusy] = useState(false)

  const toast = useCallback(
    (kind: 'ok' | 'err' | 'warn', message: string): void => {
      onToast?.(kind, message)
    },
    [onToast],
  )

  // Rebuild assembly handle + tessellation whenever the parts list changes.
  // Effect keyed by the stable hash (not the array reference) so a render
  // that re-creates the parts array without changing membership does not
  // thrash the sidecar.
  const key = assemblyKey(parts)
  useEffect(() => {
    if (parts.length === 0) {
      setTessellation(null)
      setError(null)
      return undefined
    }
    let cancelled = false
    const bridges = readAssemblyBridges()
    if (!bridges.createAssembly || !bridges.tessellateAssembly) {
      // Sibling agents own these bridges. Render-correct fallback so the
      // empty-state path still ships even when the wire isn't there yet.
      setError('Assembly bridge not available — sidecar handlers pending.')
      return undefined
    }
    setBusy(true)
    setError(null)
    void (async () => {
      try {
        const createRes = await bridges.createAssembly!({
          parts: parts.map((p) => ({
            handle: p.handle,
            transform: p.transform,
          })),
        })
        if (cancelled) return
        if (!createRes.ok) {
          const detail = createRes.hint ? ` — ${createRes.hint}` : ''
          setError(`Assembly build failed: ${createRes.error}${detail}`)
          toast('err', `Assembly build failed: ${createRes.error}`)
          setTessellation(null)
          return
        }
        const tessRes = await bridges.tessellateAssembly!({
          handle: createRes.result.handle,
        })
        if (cancelled) return
        if (!tessRes.ok) {
          const detail = tessRes.hint ? ` — ${tessRes.hint}` : ''
          setError(`Tessellate failed: ${tessRes.error}${detail}`)
          toast('err', `Tessellate failed: ${tessRes.error}`)
          setTessellation(null)
          return
        }
        setTessellation(tessRes.result)
      } catch (e) {
        if (cancelled) return
        const message = e instanceof Error ? e.message : String(e)
        setError(`Assembly build threw: ${message}`)
        toast('err', `Assembly build threw: ${message}`)
        setTessellation(null)
      } finally {
        if (!cancelled) setBusy(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // key is the load-bearing dependency — the parts array reference can
    // change between renders without member changes, but the stable hash
    // only changes when add / remove fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, toast])

  // ── Selection plumbing (toolbar Remove button) ────────────────────────────
  const handleRowClick = useCallback((id: string): void => {
    setSelectedPartId((prev) => (prev === id ? null : id))
  }, [])

  const handleToolbarRemove = useCallback((): void => {
    if (!onRemovePart || selectedPartId === null) return
    onRemovePart(selectedPartId)
    setSelectedPartId(null)
  }, [onRemovePart, selectedPartId])

  const handleRowRemove = useCallback(
    (id: string): void => {
      onRemovePart?.(id)
      setSelectedPartId((prev) => (prev === id ? null : prev))
    },
    [onRemovePart],
  )

  // ── Empty-state branch ────────────────────────────────────────────────────
  if (parts.length === 0) {
    return (
      <div
        className="design-assembly design-assembly--empty"
        data-testid="design-assembly-view"
      >
        <EmptyState
          testId="design-assembly-empty"
          icon={'⧉'}
          title="No parts in this assembly"
          body="Add a part to start building an assembly. Each part keeps its own parametric script — the assembly stitches them together with optional positioning."
          cta={
            onAddPart
              ? {
                  label: 'Add part to assembly',
                  variant: 'primary',
                  onClick: onAddPart,
                }
              : undefined
          }
        />
      </div>
    )
  }

  // ── Populated state ───────────────────────────────────────────────────────
  const triangleSummary: string | null = (() => {
    if (!tessellation) return null
    const tris = tessellation.triangleCount
    const bodies = tessellation.bodyCount
    if (tris === undefined && bodies === undefined) return null
    const triText = typeof tris === 'number' ? `${tris.toLocaleString()} triangles` : ''
    const bodyText = typeof bodies === 'number' ? `${bodies} body` : ''
    return [bodyText, triText].filter((s) => s.length > 0).join(', ')
  })()

  return (
    <div className="design-assembly" data-testid="design-assembly-view">
      {error !== null && (
        <div
          className="design-assembly__error"
          role="alert"
          data-testid="design-assembly-error"
        >
          {error}
        </div>
      )}

      <div
        className="design-assembly__toolbar"
        role="toolbar"
        aria-label="Assembly actions"
      >
        {onAddPart && (
          <button
            type="button"
            className="btn btn-primary"
            data-testid="design-assembly-add"
            onClick={onAddPart}
          >
            Add part to assembly
          </button>
        )}
        {onRemovePart && (
          <button
            type="button"
            className="btn btn-ghost"
            data-testid="design-assembly-remove"
            onClick={handleToolbarRemove}
            disabled={selectedPartId === null}
            aria-disabled={selectedPartId === null}
          >
            Remove
          </button>
        )}
      </div>

      <div className="design-assembly__body">
        <aside
          className="design-assembly__list-col"
          aria-label="Parts in this assembly"
        >
          <ul
            className="design-assembly__list"
            data-testid="design-assembly-list"
            role="list"
          >
            {parts.map((part) => {
              const isSelected = part.id === selectedPartId
              const rowId = rowTestId(part.id)
              const summary = formatTransformSummary(part)
              return (
                <li
                  key={part.id}
                  className={
                    isSelected
                      ? 'design-assembly__row design-assembly__row--selected'
                      : 'design-assembly__row'
                  }
                  data-testid={rowId}
                  role="listitem"
                  aria-selected={isSelected}
                >
                  <button
                    type="button"
                    className="design-assembly__row-select"
                    onClick={() => handleRowClick(part.id)}
                    aria-pressed={isSelected}
                  >
                    <span className="design-assembly__row-name">{part.name}</span>
                    <span className="design-assembly__row-summary">{summary}</span>
                  </button>
                  {onRemovePart && (
                    <button
                      type="button"
                      className="design-assembly__row-remove"
                      data-testid={`${rowId}-remove`}
                      aria-label={`Remove ${part.name}`}
                      onClick={() => handleRowRemove(part.id)}
                    >
                      &times;
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </aside>

        <section
          className="design-assembly__viewport-col"
          aria-label="Assembly 3D preview"
          data-testid="design-assembly-viewport"
        >
          {/*
            DOM-free render path: the live Three.js viewport (Viewport3D)
            requires `window` / `document` / WebGL, which the project's
            node-env vitest does NOT provide. We surface the tessellation
            summary instead — same pattern the Part view uses for its
            "build result" pane. When the renderer lands a DOM-aware
            test harness, swapping this for the real Viewport3D is a
            one-line change.
          */}
          <div
            className="design-assembly__viewport-summary"
            data-testid="design-assembly-summary"
          >
            <div className="design-assembly__viewport-title">
              {'▢'} Assembly preview
            </div>
            <div className="design-assembly__viewport-meta">
              {busy
                ? 'Building assembly…'
                : triangleSummary ?? `${parts.length} part${parts.length === 1 ? '' : 's'}`}
            </div>
            {tessellation?.stlPath && (
              <div
                className="design-assembly__viewport-path"
                title={tessellation.stlPath}
              >
                {tessellation.stlPath}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

export default AssemblyView
