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
  useMemo,
  useRef,
  useState,
  type JSX,
} from 'react'
import { EmptyState } from '../src/EmptyState'
import { fab } from '../src/shop-types'
import { partHasLiveGeometry, partPathForRow } from './assembly-part-bridge'
import type { AssemblyMateConstraint } from '../../shared/assembly-mate-schema'
import {
  bomForParts,
  bomRowSourceLabel,
  clashingPartIds,
  interferencesForParts,
  type BomRow,
  type InterferenceReport,
} from './assembly-render-seam'

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
  /**
   * Opaque CadQuery handle from a prior `cad.execute_script`. Live-session only —
   * NOT durable. A row hydrated from disk (after reload) carries an empty handle
   * (`''`) until the operator rebuilds / re-sends the part; the view renders an
   * honest "geometry not loaded" placeholder for those rather than aliasing
   * another body or crashing. Use {@link geometrySource} for the durable identity.
   */
  readonly handle: string
  /**
   * Durable, renderer-owned token naming WHICH geometry source this instance
   * references (a design-model / mesh id), persisted as the component's
   * `partPath`. Distinct from the per-instance `id`: two instances of the SAME
   * source share one `geometrySource` but keep distinct ids + transforms (so
   * adding a second part is never a silent alias of one body — #11). Optional +
   * additive: when omitted the persistence seam derives a stable token from the
   * row id so the instance still round-trips as a distinct row.
   */
  readonly geometrySource?: string
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
  /**
   * CAD V1 mate-wiring: report the opaque assembly handle produced by the
   * most recent `cad.createAssembly` round-trip back up to the host. Fires
   * with the new handle string on a successful build, and with `null` when
   * the assembly is emptied or the build fails (so a stale handle never
   * survives a part removal). Optional — when omitted the AssemblyView's
   * build effect is unchanged (every existing pin holds); when wired, the
   * host (DesignWorkspace) can thread the handle into the
   * {@link AssemblyMatePanel} so the operator can actually solve a mate.
   *
   * Why surface it here instead of having the host call createAssembly
   * itself? The build effect already runs inside this component (keyed on
   * the parts hash so it stays idle between unrelated renders); duplicating
   * that round-trip in the host would double the sidecar calls. Reporting
   * the handle keeps a single build path.
   */
  readonly onAssemblyHandle?: (handle: string | null) => void
  // ── CAD V1.5 mate constraints (additive surface) ─────────────────────
  /**
   * Source-of-truth mate list. Owned by the host (typically
   * `DesignWorkspace`) so persistence + undo apply uniformly across mates
   * and the parts list. When undefined, the Mates panel still renders but
   * with an empty list and no "Define mate" affordance — keeps the
   * V1.5 features opt-in for callers that haven't wired persistence yet.
   *
   * HONESTY / DEAD-SURFACE WARNING (Model+Assembly audit): the LIVE `assemble`
   * route mounts `<AssemblyView>` WITHOUT `mates` / `onAddMate` / `onRemoveMate`
   * (see DesignWorkspace.tsx), so this whole Mates panel + the modal below are
   * UNREACHABLE in the running app — only the test suite passes them. The
   * reachable mate surface is the SEPARATE {@link AssemblyMatePanel}, which
   * models a mate as 3-VECTORS (point/axis/plane). This panel instead models a
   * mate as integer FACE IDS ({@link AssemblyMate} `feature1/feature2: number`),
   * a DIVERGENT shape the durable persistence path (`runPersistMate`, which
   * expects a `SolvedMate` 3-vector draft) does NOT consume. Do NOT wire this
   * surface as-is to "turn mates on" — its `onAddMate` would emit a face-id mate
   * that silently no-ops into persistence. Either delete this panel or unify the
   * two mate models first.
   */
  readonly mates?: readonly AssemblyMate[]
  /**
   * Fired when the operator confirms a new mate in the modal. The host
   * persists the mate (typically by calling `window.fab.cad.addAssemblyMate`
   * and stashing the result into its mates state). Optional — when
   * omitted, the "Define mate" button is hidden so the Mates panel
   * becomes read-only.
   */
  readonly onAddMate?: (mate: AssemblyMate) => void
  /**
   * Fired when the operator removes a mate. Receives the mate id so the
   * host can drop the matching entry. Optional — when omitted, the
   * per-row remove button is hidden.
   */
  readonly onRemoveMate?: (id: string) => void
  /**
   * Render-pin escape hatch: forces the modal open in a static render so
   * the test suite can assert the modal markup without simulating a click.
   * Defaults to false.
   */
  readonly initialMateModalOpen?: boolean
  // ── Phase 3 (UI): solver-status badge + Solve button ─────────────────
  /**
   * Render-pin escape hatch: seeds the solver-status badge with a known
   * convergence report so static render-pin tests can assert the badge
   * text without calling `window.fab.assemblySolve`. When omitted the badge
   * shows "Not solved" (gray) until the operator clicks "Solve".
   */
  readonly initialConvergenceReport?: ConvergenceReport | null
  /**
   * CAD foundation — durable mate constraints (Model C; `assembly.json`
   * `mateConstraints`) the host hydrates from disk. Fed straight into the
   * `assembly:solve` IPC input so the iterative `solveMateConstraints` solver
   * actually positions the parts (the solver runs whenever this is non-empty —
   * see `solveAssemblyKinematics`). Optional + additive: defaults to `[]`, in
   * which case the solve input carries no constraints exactly as before — every
   * existing Phase-3 render-pin holds. (The `assembly:solve` handler also filters
   * suppressed components + ignores unknown part refs, so a stale constraint is
   * harmless.)
   */
  readonly mateConstraints?: readonly AssemblyMateConstraint[]
}

/**
 * Solver convergence status returned by `assembly:solve` via Phase 2 IPC.
 * Mirrored here to keep AssemblyView self-contained (the canonical definition
 * lives in `src/shared/assembly-solver-core.ts` but is not imported directly by
 * the renderer to avoid pulling main-process deps into the renderer bundle).
 */
type SolverStatus =
  | 'converged'
  | 'max_iterations_reached'
  | 'diverged'
  | 'over_constrained'
  | 'under_constrained'
  | 'not_solved'

type ConvergenceReport = {
  readonly converged: boolean
  readonly iterations: number
  readonly finalResidual: number
  readonly perConstraintResiduals: ReadonlyArray<{ constraintId: string; residual: number }>
  readonly status: SolverStatus
  readonly conflictingConstraintIds?: readonly string[]
  readonly freeVariableCount?: number
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


// ── CAD V1.5: Assembly mate constraints (Wave 3) ─────────────────────────
//
// Three mate kinds — point / axis / plane — back the new Mates panel +
// modal on the AssemblyView. Each mate references two parts (by stable row
// id, NOT by CadQuery child name — the renderer translates to the sidecar's
// child names via the AssemblyPart.name at the IPC boundary) plus a feature
// identifier per part:
//
//   * Point mate: ``feature1`` / ``feature2`` are integer face ids returned
//                 by ``cad.tessellate_with_ids`` (the same ids the existing
//                 selection state in ``selection-state.ts`` exposes).
//   * Axis mate:  ``feature1`` / ``feature2`` are face ids — the sidecar
//                 derives an axis (the face's normal at its centroid) from
//                 each face.
//   * Plane mate: ``feature1`` / ``feature2`` are face ids — the sidecar
//                 derives a plane (origin + normal) from each face.
//
// Why face ids (not raw 3-D vectors) at the renderer layer? The operator
// picks faces in the viewport; deriving the (point, axis, normal) from a
// face is a sidecar concern. The renderer stays pure UI — same posture as
// the existing `selection-state.ts` module.

/** A mate definition the renderer surfaces in the Mates panel + modal. */
export type AssemblyMate = {
  /** Stable mate id (renderer-owned). */
  readonly id: string
  /** Discriminated mate kind. */
  readonly kind: 'point' | 'axis' | 'plane'
  /** AssemblyPart.id (the row id, NOT the CadQuery child name). */
  readonly part1Id: string
  /** Face id from the existing tessellate-with-ids selection state. */
  readonly feature1: number
  /** AssemblyPart.id (must differ from part1Id). */
  readonly part2Id: string
  /** Face id from the existing tessellate-with-ids selection state. */
  readonly feature2: number
}

/** Stable testid suffix per mate row. Mirrors `rowTestId` for parts. */
function mateRowTestId(id: string): string {
  return `design-assembly-mate-${id}`
}

/**
 * Human-readable label for a mate kind in the row + modal. Pulled out so a
 * future i18n pass can swap in localized strings without touching the
 * render path.
 */
const MATE_KIND_LABELS: Record<AssemblyMate['kind'], string> = {
  point: 'Point',
  axis: 'Axis',
  plane: 'Plane',
}

/** Iteration helper for the kind picker — keeps the modal's select options
 * in declaration order without relying on Object.entries' enumeration. */
const MATE_KINDS: ReadonlyArray<AssemblyMate['kind']> = ['point', 'axis', 'plane']

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
  /**
   * Optional V1.5 mate bridge — when the host wires it, the modal's
   * confirm button will push the new mate to the sidecar before the host
   * persists it in `onAddMate`. When absent, `onAddMate` still fires and
   * the host owns the round-trip (e.g. for offline / test scenarios).
   */
  readonly addAssemblyMate?: (payload: Record<string, unknown>) => Promise<
    | { ok: true; result: Record<string, unknown> }
    | { ok: false; error: string; hint?: string }
  >
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
    addAssemblyMate: cadAny.addAssemblyMate,
  }
}

export function AssemblyView({
  parts,
  onAddPart,
  onRemovePart,
  onToast,
  initialSelectedPartId = null,
  onAssemblyHandle,
  mates,
  onAddMate,
  onRemoveMate,
  initialMateModalOpen = false,
  initialConvergenceReport = null,
  mateConstraints = [],
}: AssemblyViewProps): JSX.Element {
  const [selectedPartId, setSelectedPartId] = useState<string | null>(initialSelectedPartId)
  const [error, setError] = useState<string | null>(null)
  const [tessellation, setTessellation] = useState<AssemblyTessellation | null>(null)
  const [busy, setBusy] = useState(false)
  // Phase 3 — solver-status badge state.
  const [convergenceReport, setConvergenceReport] = useState<ConvergenceReport | null>(initialConvergenceReport)
  const [solving, setSolving] = useState(false)

  // V1.5 mate modal state. Kept local — the host owns the canonical mates
  // list via the `mates` / `onAddMate` props. The modal is closed unless
  // `initialMateModalOpen` seeds it open for render-pin tests.
  const [mateModalOpen, setMateModalOpen] = useState<boolean>(initialMateModalOpen)
  const [mateDraftKind, setMateDraftKind] = useState<AssemblyMate['kind']>('point')
  const [mateDraftPart1, setMateDraftPart1] = useState<string>(parts[0]?.id ?? '')
  const [mateDraftFeature1, setMateDraftFeature1] = useState<string>('0')
  const [mateDraftPart2, setMateDraftPart2] = useState<string>(parts[1]?.id ?? parts[0]?.id ?? '')
  const [mateDraftFeature2, setMateDraftFeature2] = useState<string>('0')
  const [mateError, setMateError] = useState<string | null>(null)

  // Stable mate list reference for the render path. Defaulting to `[]` here
  // (rather than `undefined`) keeps the JSX branches simple — same posture
  // as the existing `parts` array.
  const mateList: readonly AssemblyMate[] = mates ?? []

  // Mapping of part id → display name so the mate rows can show
  // `Bracket → Plate` instead of opaque ids. Pre-compute via useMemo so
  // a re-render with the same parts/mates does not re-walk the list.
  const partNameById = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {}
    for (const p of parts) out[p.id] = p.name
    return out
  }, [parts])

  // ── Interference (bbox-level clash) ────────────────────────────────────────
  // Recomputed whenever the parts list changes (membership OR a transform move —
  // the host re-creates the parts array with new positions after a solve) AND
  // whenever the durable mateConstraints change (a new mate can move a part on
  // the next solve). useMemo keys on both so the clash list + row highlights
  // stay in sync without an effect/timer. Pure + synchronous (no IPC) — backed by
  // the shared engine `detectInterferences` via the seam.
  const interferenceReport = useMemo<InterferenceReport>(
    () => interferencesForParts(parts),
    // mateConstraints is a recompute trigger (a mate changes future placement);
    // the bodies themselves derive from `parts` transforms.
    [parts, mateConstraints],
  )
  const clashIds = useMemo<ReadonlySet<string>>(
    () => clashingPartIds(interferenceReport),
    [interferenceReport],
  )

  // ── BOM roll-up (qty / name / source) ──────────────────────────────────────
  // Updates with the components: a re-render with a new parts list re-rolls the
  // table (shared engine `deriveBom` via the seam). Pure + synchronous.
  const bomRows = useMemo<BomRow[]>(() => bomForParts(parts).rows, [parts])

  const toast = useCallback(
    (kind: 'ok' | 'err' | 'warn', message: string): void => {
      onToast?.(kind, message)
    },
    [onToast],
  )

  // Stable ref to the handle-report callback so the build effect can notify the
  // host WITHOUT adding `onAssemblyHandle` to the effect deps (callbacks are not
  // referentially stable, and re-running the build on every render would thrash
  // the sidecar). The ref is refreshed each render; the effect reads `.current`.
  const onAssemblyHandleRef = useRef(onAssemblyHandle)
  onAssemblyHandleRef.current = onAssemblyHandle
  const reportAssemblyHandle = useCallback((handle: string | null): void => {
    onAssemblyHandleRef.current?.(handle)
  }, [])

  // Rebuild assembly handle + tessellation whenever the parts list changes.
  // Effect keyed by the stable hash (not the array reference) so a render
  // that re-creates the parts array without changing membership does not
  // thrash the sidecar.
  const key = assemblyKey(parts)
  useEffect(() => {
    if (parts.length === 0) {
      setTessellation(null)
      setError(null)
      // No parts → no assembly → drop any stale handle the host was holding.
      reportAssemblyHandle(null)
      return undefined
    }
    let cancelled = false
    const bridges = readAssemblyBridges()
    if (!bridges.createAssembly || !bridges.tessellateAssembly) {
      // Sibling agents own these bridges. Render-correct fallback so the
      // empty-state path still ships even when the wire isn't there yet.
      setError('Assembly bridge not available — sidecar handlers pending.')
      reportAssemblyHandle(null)
      return undefined
    }
    setBusy(true)
    setError(null)
    void (async () => {
      try {
        const createRes = await bridges.createAssembly!({
          parts: parts.map((p) => ({
            handle: p.handle,
            // Send the renderer part id as the assembly child name so a mate's
            // part1Id/part2Id (which the panel emits as AssemblyPart.id) match
            // the sidecar child names (else _apply_mate_constraint rejects the
            // mate as "not a child of this assembly"). build_assembly_from_parts
            // honours ``name`` and only falls back to ``part_<index>`` when absent.
            name: p.id,
            transform: p.transform,
          })),
        })
        if (cancelled) return
        if (!createRes.ok) {
          const detail = createRes.hint ? ` — ${createRes.hint}` : ''
          setError(`Assembly build failed: ${createRes.error}${detail}`)
          toast('err', `Assembly build failed: ${createRes.error}`)
          setTessellation(null)
          reportAssemblyHandle(null)
          return
        }
        // Surface the freshly-built handle to the host as soon as the
        // assembly exists — even before tessellation — so the mate panel
        // can enable Solve. Tessellation is only the preview; the handle is
        // what `cad.add_assembly_mate` operates on.
        reportAssemblyHandle(createRes.result.handle)
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
        // Build threw — the assembly state is indeterminate, so the host
        // must not keep a handle it can no longer trust.
        reportAssemblyHandle(null)
      } finally {
        if (!cancelled) setBusy(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // key is the load-bearing dependency — the parts array reference can
    // change between renders without member changes, but the stable hash
    // only changes when add / remove fires. reportAssemblyHandle is stable
    // (a useCallback over a ref) so it never re-triggers the build.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, toast, reportAssemblyHandle])

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

  // ── V1.5 mate modal handlers ───────────────────────────────────────────
  // Pure UI plumbing: open / close / commit + per-mate row remove. The
  // host's `onAddMate` / `onRemoveMate` props own persistence; this
  // component only handles the modal's local draft state and surfaces a
  // structured error when the draft is malformed (e.g. same part on both
  // sides).
  const openMateModal = useCallback((): void => {
    setMateError(null)
    setMateDraftKind('point')
    // Seed the draft with the first two distinct parts so the operator
    // does not have to pick from scratch on every open. When the assembly
    // only has one part, the modal still renders but the confirm button
    // stays disabled with a hint.
    const first = parts[0]?.id ?? ''
    const second = parts.find((p) => p.id !== first)?.id ?? ''
    setMateDraftPart1(first)
    setMateDraftPart2(second)
    setMateDraftFeature1('0')
    setMateDraftFeature2('0')
    setMateModalOpen(true)
  }, [parts])

  const closeMateModal = useCallback((): void => {
    setMateModalOpen(false)
    setMateError(null)
  }, [])

  const handleMateConfirm = useCallback((): void => {
    if (!onAddMate) {
      // No host listener wired -- closing without persisting is the only
      // safe outcome. Same posture as the parts toolbar when onAddPart is
      // absent.
      setMateModalOpen(false)
      return
    }
    if (!mateDraftPart1 || !mateDraftPart2) {
      setMateError('Select a part on both sides of the mate.')
      return
    }
    if (mateDraftPart1 === mateDraftPart2) {
      setMateError('A mate must connect two different parts.')
      return
    }
    const feature1 = Number.parseInt(mateDraftFeature1, 10)
    const feature2 = Number.parseInt(mateDraftFeature2, 10)
    if (!Number.isFinite(feature1) || feature1 < 0) {
      setMateError('Feature 1 must be a non-negative face id.')
      return
    }
    if (!Number.isFinite(feature2) || feature2 < 0) {
      setMateError('Feature 2 must be a non-negative face id.')
      return
    }
    // Renderer-owned id. UUID-ish — uses random + timestamp so two rapid
    // confirms cannot collide on the same key.
    const id = `mate-${Date.now().toString(36)}-${Math.floor(Math.random() * 1_000_000).toString(36)}`
    const mate: AssemblyMate = {
      id,
      kind: mateDraftKind,
      part1Id: mateDraftPart1,
      feature1,
      part2Id: mateDraftPart2,
      feature2,
    }
    onAddMate(mate)
    setMateModalOpen(false)
    setMateError(null)
  }, [
    onAddMate,
    mateDraftKind,
    mateDraftPart1,
    mateDraftPart2,
    mateDraftFeature1,
    mateDraftFeature2,
  ])

  const handleMateRemove = useCallback(
    (id: string): void => {
      onRemoveMate?.(id)
    },
    [onRemoveMate],
  )

  // ── Phase 3: Solve callback ─────────────────────────────────────────────
  // Calls window.fab.assemblySolve with the current assembly state and updates
  // the convergenceReport badge. Errors fold into the existing error banner
  // (never thrown). Disabled when the assembly is empty or a solve is in flight.
  const handleSolve = useCallback((): void => {
    if (parts.length === 0 || solving) return
    const assemblyBridgeAny = (fab() as unknown) as {
      assemblySolve?: (input: unknown) => Promise<{
        ok: boolean
        convergenceReport?: ConvergenceReport
        diagnostics?: { convergenceReport?: ConvergenceReport }
      }>
    }
    const bridge = assemblyBridgeAny.assemblySolve
    if (!bridge) {
      setError('assemblySolve bridge not available — IPC handler pending.')
      return
    }
    setSolving(true)
    setError(null)
    const assemblyInput = {
      version: 2,
      name: '',
      components: parts.map((part) => ({
        id: part.id,
        name: part.name,
        // `assembly:solve` re-parses this through `parseAssemblyFile`, whose
        // component schema requires a non-empty `partPath`; derive the durable
        // geometry token so the solve round-trip reaches the mate solver.
        partPath: partPathForRow(part),
        grounded: false,
        transform: {
          x: part.transform?.position?.[0] ?? 0,
          y: part.transform?.position?.[1] ?? 0,
          z: part.transform?.position?.[2] ?? 0,
          rxDeg: part.transform?.rotation?.[0] ?? 0,
          ryDeg: part.transform?.rotation?.[1] ?? 0,
          rzDeg: part.transform?.rotation?.[2] ?? 0,
        }
      })),
      // #9 — feed the hydrated durable constraints so the solver positions the
      // parts. Empty by default (legacy single-pass FK path runs); non-empty
      // triggers the iterative solveMateConstraints solver in the main process.
      mateConstraints,
    }
    void bridge(assemblyInput).then((res) => {
      setSolving(false)
      if (!res.ok) return
      const report = res.convergenceReport ?? res.diagnostics?.convergenceReport ?? null
      setConvergenceReport(report)
    }).catch((e: unknown) => {
      setSolving(false)
      const message = e instanceof Error ? e.message : String(e)
      setError(`Solve threw: ${message}`)
    })
  }, [parts, solving, mateConstraints])

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
        {/* Phase 3: Solve button triggers assembly:solve IPC round-trip */}
        <button
          type="button"
          className="btn btn-ghost"
          data-testid="design-assembly-solve"
          onClick={handleSolve}
          disabled={parts.length === 0 || solving}
          aria-disabled={parts.length === 0 || solving}
        >
          {solving ? 'Solving…' : 'Solve'}
        </button>
        {/* Phase 3: Solver-status badge */}
        {convergenceReport === null ? (
          <span
            className="design-assembly__solver-badge design-assembly__solver-badge--not-solved"
            data-testid="design-assembly-solver-badge"
          >
            Not solved
          </span>
        ) : convergenceReport.status === 'converged' ? (
          <span
            className="design-assembly__solver-badge design-assembly__solver-badge--converged"
            data-testid="design-assembly-solver-badge"
          >
            {`Converged in ${convergenceReport.iterations} (residual ${convergenceReport.finalResidual.toExponential(2)})`}
          </span>
        ) : convergenceReport.status === 'under_constrained' ? (
          <span
            className="design-assembly__solver-badge design-assembly__solver-badge--under-constrained"
            data-testid="design-assembly-solver-badge"
          >
            {`Under-constrained: ${convergenceReport.freeVariableCount ?? 0} DOF free`}
          </span>
        ) : convergenceReport.status === 'over_constrained' ? (
          <span
            className="design-assembly__solver-badge design-assembly__solver-badge--over-constrained"
            data-testid="design-assembly-solver-badge"
          >
            {`Over-constrained${(convergenceReport.conflictingConstraintIds ?? []).length > 0 ? ' — ' + convergenceReport.conflictingConstraintIds!.join(', ') : ''}`}
          </span>
        ) : (
          <span
            className="design-assembly__solver-badge design-assembly__solver-badge--error"
            data-testid="design-assembly-solver-badge"
          >
            {convergenceReport.status.replace(/_/g, ' ')}
          </span>
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
              const isClashing = clashIds.has(part.id)
              const rowId = rowTestId(part.id)
              const summary = formatTransformSummary(part)
              const rowClass = [
                'design-assembly__row',
                isSelected ? 'design-assembly__row--selected' : '',
                // Highlight idiom (mirrors --selected): a clashing row gets a
                // --clash modifier so the theme can tint it, matching the clash
                // list below. Reuses the existing row-highlight mechanism rather
                // than a bespoke overlay.
                isClashing ? 'design-assembly__row--clash' : '',
              ]
                .filter((c) => c.length > 0)
                .join(' ')
              return (
                <li
                  key={part.id}
                  className={rowClass}
                  data-testid={rowId}
                  data-clash={isClashing ? 'true' : undefined}
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
                    {isClashing && (
                      <span
                        className="design-assembly__row-clash-flag"
                        data-testid={`${rowId}-clash`}
                        title="This part's bounding box overlaps another part (bbox-level — see the Interference list)."
                      >
                        clash
                      </span>
                    )}
                    {!partHasLiveGeometry(part) && (
                      <span
                        className="design-assembly__row-nogeo"
                        data-testid={`${rowId}-nogeo`}
                        title="This part was loaded from a saved assembly. Re-run or re-send its source model to rebuild its geometry; its placement and mates are preserved."
                      >
                        geometry not loaded
                      </span>
                    )}
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

          {/*
            V1.5 Mates panel — only renders when the host wires `mates`.
            Sits directly under the parts list so the operator can scan
            "what parts are in this assembly" and "what mates pin them
            together" in one column. Keeping it inside the same `<aside>`
            (rather than a sibling column) mirrors the Fusion 360
            information-density baseline.
          */}
          {mates !== undefined && (
            <div
              className="design-assembly__mates"
              data-testid="design-assembly-mates"
              aria-label="Assembly mates"
            >
              <div className="design-assembly__mates-header">
                <span className="design-assembly__mates-title">Mates</span>
                {onAddMate && (
                  <button
                    type="button"
                    className="btn btn-ghost design-assembly__mates-add"
                    data-testid="design-assembly-mate-add"
                    onClick={openMateModal}
                    disabled={parts.length < 2}
                    aria-disabled={parts.length < 2}
                    title={parts.length < 2 ? 'Add a second part before defining a mate.' : 'Define a new mate'}
                  >
                    Define mate
                  </button>
                )}
              </div>
              {mateList.length === 0 ? (
                <div
                  className="design-assembly__mates-empty"
                  data-testid="design-assembly-mates-empty"
                >
                  No mates defined yet.
                </div>
              ) : (
                <ul
                  className="design-assembly__mates-list"
                  data-testid="design-assembly-mates-list"
                  role="list"
                >
                  {mateList.map((mate) => {
                    const part1Label = partNameById[mate.part1Id] ?? mate.part1Id
                    const part2Label = partNameById[mate.part2Id] ?? mate.part2Id
                    const rowId = mateRowTestId(mate.id)
                    return (
                      <li
                        key={mate.id}
                        className="design-assembly__mate-row"
                        data-testid={rowId}
                        role="listitem"
                      >
                        <span
                          className="design-assembly__mate-kind"
                          data-testid={`${rowId}-kind`}
                        >
                          {MATE_KIND_LABELS[mate.kind]}
                        </span>
                        <span
                          className="design-assembly__mate-summary"
                          data-testid={`${rowId}-summary`}
                        >
                          {part1Label} (#{mate.feature1}) ↔ {part2Label} (#{mate.feature2})
                        </span>
                        {onRemoveMate && (
                          <button
                            type="button"
                            className="design-assembly__mate-remove"
                            data-testid={`${rowId}-remove`}
                            aria-label={`Remove mate ${mate.id}`}
                            onClick={() => handleMateRemove(mate.id)}
                          >
                            &times;
                          </button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}

          {/*
            Interference panel — bbox-level clash list. Sits under the parts +
            mates so the operator scans "what's here / how it's pinned / does it
            clash" top-to-bottom. HONESTY: the sub-label states this is a
            bounding-box check (the engine returns fidelity:'bbox'), and the part
            boxes are nominal extents (the renderer carries no real geometry size
            yet) — a reported clash is "worth a look", not a certified collision.
            Recomputes with parts/mates via the useMemo above.
          */}
          <div
            className="design-assembly__interference"
            data-testid="design-assembly-interference"
            aria-label="Assembly interference"
          >
            <div className="design-assembly__interference-header">
              <span className="design-assembly__interference-title">Interference</span>
              <span
                className="design-assembly__interference-fidelity"
                data-testid="design-assembly-interference-fidelity"
                title="Axis-aligned bounding-box overlap on nominal part extents — a coarse clash filter, not a certified solid-intersection check."
              >
                bbox-level
              </span>
            </div>
            {interferenceReport.clashingPairs.length === 0 ? (
              <div
                className="design-assembly__interference-clear"
                data-testid="design-assembly-interference-clear"
              >
                No interferences detected.
              </div>
            ) : (
              <ul
                className="design-assembly__interference-list"
                data-testid="design-assembly-interference-list"
                role="list"
              >
                {interferenceReport.clashingPairs.map((pair) => {
                  const aLabel = partNameById[pair.aId] ?? pair.aId
                  const bLabel = partNameById[pair.bId] ?? pair.bId
                  const pairId = `${pair.aId}--${pair.bId}`
                  return (
                    <li
                      key={pairId}
                      className="design-assembly__interference-row"
                      data-testid={`design-assembly-clash-${pairId}`}
                      role="listitem"
                    >
                      <span className="design-assembly__interference-icon" aria-hidden="true">
                        {'⚠'}
                      </span>
                      <span className="design-assembly__interference-pair">
                        {aLabel} ↔ {bLabel}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {/*
            BOM table — qty / name / source roll-up (shared engine deriveBom).
            Identical (name, durable source) instances collapse into one line
            with a summed quantity. Updates with the components.
          */}
          <div
            className="design-assembly__bom"
            data-testid="design-assembly-bom"
            aria-label="Bill of materials"
          >
            <div className="design-assembly__bom-header">
              <span className="design-assembly__bom-title">Bill of materials</span>
              <span className="design-assembly__bom-count" data-testid="design-assembly-bom-count">
                {`${bomRows.length} line${bomRows.length === 1 ? '' : 's'}`}
              </span>
            </div>
            {bomRows.length === 0 ? (
              <EmptyState
                testId="design-assembly-bom-empty"
                title="No BOM lines yet"
                body="Add a part with a geometry source to populate the bill of materials."
              />
            ) : (
              <table className="data-table design-assembly__bom-table" data-testid="design-assembly-bom-table">
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">Qty</th>
                    <th scope="col">Name</th>
                    <th scope="col">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {bomRows.map((row, idx) => (
                    <tr
                      key={row.source.key}
                      className="design-assembly__bom-row"
                      data-testid={`design-assembly-bom-row-${row.partId}`}
                    >
                      <td className="design-assembly__bom-cell-item">{idx + 1}</td>
                      <td className="design-assembly__bom-cell-qty">{row.qty}</td>
                      <td className="design-assembly__bom-cell-name">{row.name}</td>
                      <td
                        className="design-assembly__bom-cell-source"
                        title={`${row.source.kind}: ${row.source.ref}`}
                      >
                        {bomRowSourceLabel(row)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
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
            {mateConstraints.length > 0 && (
              <div
                className="design-assembly__viewport-mates"
                data-testid="design-assembly-mate-count"
              >
                {`${mateConstraints.length} mate${mateConstraints.length === 1 ? '' : 's'} positioning parts`}
              </div>
            )}
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

      {/*
        V1.5 mate modal — lives outside the body grid so the modal can
        overlay both columns. We render it inline (instead of teleporting
        via a portal) because the project's render-pin tests use
        `renderToStaticMarkup`, which does NOT execute portals. Inline
        rendering keeps the testid coverage uniform across the static and
        future jsdom-based suites.
      */}
      {mateModalOpen && onAddMate && (
        <div
          className="design-assembly__mate-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="design-assembly-mate-modal-title"
          data-testid="design-assembly-mate-modal"
        >
          <div className="design-assembly__mate-modal-inner">
            <h2
              className="design-assembly__mate-modal-title"
              id="design-assembly-mate-modal-title"
            >
              Define mate
            </h2>
            {mateError !== null && (
              <div
                className="design-assembly__mate-modal-error"
                role="alert"
                data-testid="design-assembly-mate-modal-error"
              >
                {mateError}
              </div>
            )}
            <div className="design-assembly__mate-modal-field">
              <label
                className="design-assembly__mate-modal-label"
                htmlFor="design-assembly-mate-kind"
              >
                Mate kind
              </label>
              <select
                id="design-assembly-mate-kind"
                className="design-assembly__mate-modal-select"
                data-testid="design-assembly-mate-modal-kind"
                value={mateDraftKind}
                onChange={(e) => setMateDraftKind(e.target.value as AssemblyMate['kind'])}
              >
                {MATE_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {MATE_KIND_LABELS[kind]}
                  </option>
                ))}
              </select>
            </div>
            <div className="design-assembly__mate-modal-field">
              <label
                className="design-assembly__mate-modal-label"
                htmlFor="design-assembly-mate-part1"
              >
                Part 1
              </label>
              <select
                id="design-assembly-mate-part1"
                className="design-assembly__mate-modal-select"
                data-testid="design-assembly-mate-modal-part1"
                value={mateDraftPart1}
                onChange={(e) => setMateDraftPart1(e.target.value)}
              >
                {parts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <label
                className="design-assembly__mate-modal-label design-assembly__mate-modal-label--inline"
                htmlFor="design-assembly-mate-feature1"
              >
                Feature 1 (face id)
              </label>
              <input
                id="design-assembly-mate-feature1"
                className="design-assembly__mate-modal-input"
                data-testid="design-assembly-mate-modal-feature1"
                type="number"
                min={0}
                value={mateDraftFeature1}
                onChange={(e) => setMateDraftFeature1(e.target.value)}
              />
            </div>
            <div className="design-assembly__mate-modal-field">
              <label
                className="design-assembly__mate-modal-label"
                htmlFor="design-assembly-mate-part2"
              >
                Part 2
              </label>
              <select
                id="design-assembly-mate-part2"
                className="design-assembly__mate-modal-select"
                data-testid="design-assembly-mate-modal-part2"
                value={mateDraftPart2}
                onChange={(e) => setMateDraftPart2(e.target.value)}
              >
                {parts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <label
                className="design-assembly__mate-modal-label design-assembly__mate-modal-label--inline"
                htmlFor="design-assembly-mate-feature2"
              >
                Feature 2 (face id)
              </label>
              <input
                id="design-assembly-mate-feature2"
                className="design-assembly__mate-modal-input"
                data-testid="design-assembly-mate-modal-feature2"
                type="number"
                min={0}
                value={mateDraftFeature2}
                onChange={(e) => setMateDraftFeature2(e.target.value)}
              />
            </div>
            <div className="design-assembly__mate-modal-actions">
              <button
                type="button"
                className="btn btn-ghost"
                data-testid="design-assembly-mate-modal-cancel"
                onClick={closeMateModal}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                data-testid="design-assembly-mate-modal-confirm"
                onClick={handleMateConfirm}
                disabled={parts.length < 2}
                aria-disabled={parts.length < 2}
              >
                Confirm mate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default AssemblyView
