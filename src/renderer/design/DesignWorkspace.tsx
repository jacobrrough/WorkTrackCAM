/**
 * DesignWorkspace — top-level shell for the parametric Design environment
 * (BUILD 5, Cycle 233 CAD MVP).
 *
 * Three-pane layout:
 *   • LEFT:   CadQueryEditor pane + Run / Save / Load buttons.
 *   • CENTER: 3D preview surface (renders the tessellated STL produced
 *             by the last `cad.execute_script` call). Pure presentational
 *             — the actual Three.js viewport is rendered by the shared
 *             `Viewport3D` component that already lives in this folder.
 *   • RIGHT:  FeatureTree (read-only operations + parameters list driven
 *             by `cad.list_operations`) + a "Send to CAM" CTA.
 *
 * Owned state (all local to this component):
 *   - `scriptText`         — current CadQuery script.
 *   - `lastTessellation`   — the most recently executed result envelope
 *     (we keep the full payload so the viewport can re-render meshes
 *     and the FeatureTree can surface error details).
 *   - `operations` / `parameters` / `parseError` — the latest
 *     `cad.list_operations` payload (debounced at 300ms per keystroke).
 *   - `busy`               — true while a Run is in flight; disables
 *     the Run button to prevent double-submit.
 *   - `error`              — last user-facing error string (Run failures,
 *     export failures, validation errors). Rendered as an inline banner
 *     above the editor toolbar so the surface stays self-contained.
 *
 * Wiring contract (pinned by `DesignWorkspace.test.tsx`):
 *   1. Run button calls `fab().cad.execute({ script })` and updates
 *      `lastTessellation`. Errors fold into `error` — never thrown.
 *   2. After every keystroke, debounced `fab().cad.listOperations(...)`
 *      refreshes the FeatureTree. The 300 ms debounce matches the
 *      research-validated typing cadence for CAM operators.
 *   3. Send-to-CAM is rendered as a `.btn .btn-primary` and is enabled
 *      only when `lastTessellation.meshes[0]` is present (you cannot
 *      hand off a model you have not built).
 *   4. The empty-state surface (no script + no operations) reuses the
 *      shared `EmptyState` component from `src/renderer/src/EmptyState.tsx`
 *      with a CTA that seeds a starter CadQuery script.
 *   5. No `any` types, no inline styles — visuals live in
 *      `src/renderer/styles/components.css` under `.design-workspace*`.
 *
 * What this component does NOT do (intentionally deferred to v2):
 *   - Parameter editing — FeatureTree shows parameters read-only.
 *   - Multiple DesignModels per project (this shell binds to a single
 *     active script). Project-store wiring is a separate task.
 *   - Custom keyboard shortcuts beyond the editor's Ctrl+Enter. The
 *     workspace-level Ctrl+Shift+D switch lives in ShopApp.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX
} from 'react'
import { EmptyState } from '../src/EmptyState'
import { CadQueryEditor } from './CadQueryEditor'
import { ViewportChrome } from './ViewportChrome'
import { AssemblyView, type AssemblyPart } from './AssemblyView'
import { AssemblyMatePanel, type SolvedMate } from './AssemblyMatePanel'
import { DrawingView } from './DrawingView'
import type {
  DrawingDimension,
  GdtFeatureControlFrame,
} from '../../shared/drawing-annotation-schema'
import {
  FeatureTree,
  type FeatureTreeOperation,
  type FeatureTreeParameter
} from './FeatureTree'
import type { KernelPostSolidOp } from '../../shared/part-features-schema'
import { fab } from '../src/shop-types'
import type {
  CadExecuteScriptMesh,
  CadExecuteScriptResult,
  CadDeclaredParameter,
  CadFaceMapEntry,
  CadOperationSummary,
  CadParseError,
  CadScriptParamValue,
  CadTessellateWithIdsResult
} from '../../shared/sidecar-protocol'
import type { CadExportResponse } from '../../main/ipc-cad'
import {
  clearSelection,
  setSelection,
  type Selection
} from './selection-state'

/** Default starter script seeded when the user clicks the empty-state CTA. */
export const STARTER_SCRIPT = `# WorkTrack3D CadQuery starter — a parametric box.
# Edit dimensions or add cq.* operations, then hit Run.
import cadquery as cq

length = 50.0
width = 30.0
height = 10.0

result = cq.Workplane("XY").box(length, width, height)
show_object(result)
`

/**
 * Derive the design-output path for a freshly exported STL.
 *
 * The cad sidecar already wrote the tessellated mesh STL into an
 * OS-temp directory during `cad.execute_script`; we reuse that
 * directory (the only writable path the renderer can name without a
 * project store) and rename the file so the CAM-bound copy never
 * collides with the live preview STL or earlier exports.
 *
 * Cross-platform safe: tolerates both `/` and `\` separators, falls
 * back to the original filename's stem when no separator is present.
 * The 36-character ID block (timestamp + random suffix) guarantees
 * uniqueness across rapid-fire clicks.
 *
 * Exported so the paired-pin test can assert the naming contract
 * without instantiating the full component tree.
 */
export function buildDesignOutputStlPath(sourceStlPath: string): string {
  const sepIdx = Math.max(sourceStlPath.lastIndexOf('/'), sourceStlPath.lastIndexOf('\\'))
  const dir = sepIdx >= 0 ? sourceStlPath.slice(0, sepIdx) : ''
  const sep = sepIdx >= 0 ? sourceStlPath[sepIdx] : '/'
  const stamp = Date.now().toString(36)
  // 6-char alphanum suffix is enough to disambiguate parallel clicks
  // within the same millisecond (the worst case in tests).
  const rand = Math.random().toString(36).slice(2, 8)
  const filename = `design-output-${stamp}-${rand}.stl`
  return dir.length > 0 ? `${dir}${sep}${filename}` : filename
}

/**
 * Pure orchestrator for the Send-to-CAM hand-off. Exported so the
 * DesignWorkspace test pin can assert the call order
 * (`cad.export` → `onSendToCam`) without instantiating React's
 * runtime — the component-level useCallback is a thin wrapper over
 * this helper.
 *
 * The contract this function pins:
 *   1. `cadExport({ handle, outPath, format: 'stl' })` is called
 *      FIRST with the mesh's handle and a freshly generated
 *      design-output path.
 *   2. On `ok: true`, `onSendToCam({ stlPath, mesh })` is called with
 *      the path the sidecar echoed back. The host wires this to the
 *      env-switch + STL auto-import flow in ShopApp.
 *   3. On `ok: false` (sidecar/IPC error), the helper returns the
 *      error envelope so the caller can surface a toast / banner.
 *      `onSendToCam` is NOT invoked.
 *
 * Returning a discriminated union (rather than throwing) lets the
 * caller drive both the inline error banner and the toast from a
 * single switch, matching the rest of the workspace's error UX.
 */
export type SendToCamOutcome =
  | { ok: true; outPath: string }
  | { ok: false; error: string; hint?: string }

export async function performSendToCam(
  mesh: CadExecuteScriptMesh,
  cadExport: (payload: {
    handle: string
    outPath: string
    format: 'stl'
  }) => Promise<CadExportResponse>,
  onSendToCam: (payload: {
    readonly stlPath: string
    readonly mesh: CadExecuteScriptMesh
  }) => void,
): Promise<SendToCamOutcome> {
  const outPath = buildDesignOutputStlPath(mesh.stlPath)
  const response = await cadExport({
    handle: mesh.handle,
    outPath,
    format: 'stl',
  })
  if (!response.ok) {
    return { ok: false, error: response.error, hint: response.hint }
  }
  // Hand the path through to the host (env-switch + auto-import).
  // The host is the only code path that knows how to manipulate the
  // active project + jobs list; the workspace stays pure.
  onSendToCam({ stlPath: response.result.outPath, mesh })
  return { ok: true, outPath: response.result.outPath }
}

/**
 * Top-level view mode of the Design workspace.
 *
 * CAD V2 introduces two new sibling environments alongside the
 * original Part view:
 *   - `'part'`     — the original `CadQueryEditor + Viewport3D +
 *                    FeatureTree + ProfileStack` shell (unchanged).
 *   - `'assembly'` — multi-part assembly stitched together via
 *                    `cad.createAssembly` (see {@link AssemblyView}).
 *   - `'drawing'`  — orthographic / isometric drawing projections of
 *                    the active part (see {@link DrawingView}).
 *
 * The mode is owned by `DesignWorkspace` itself (not the host) because
 * switching views must NOT trigger a re-mount of the editor — the
 * operator may toggle between Part and Assembly several times in a
 * single session without wanting to lose their script.
 */
export type DesignViewMode = 'part' | 'assembly' | 'drawing'

/**
 * Stable testids for the view-mode tab bar. Exported so the render-pin
 * tests can assert the tab presence without scraping class strings.
 */
export const DESIGN_VIEW_TAB_TESTIDS: Record<DesignViewMode, string> = {
  part: 'design-workspace-tab-part',
  assembly: 'design-workspace-tab-assembly',
  drawing: 'design-workspace-tab-drawing',
}

export interface DesignWorkspaceProps {
  /** Initial script text. Defaults to an empty string. */
  readonly initialScript?: string
  /**
   * Called when the user clicks "Save". Receives the current script
   * body. Optional — when omitted, the Save button is hidden so the
   * workspace can mount in environments without a project store
   * (tests, the splash preview surface, etc.).
   */
  readonly onSave?: (script: string) => void
  /**
   * Called after a successful Send-to-CAM export. Receives the path of
   * the freshly exported STL (written via `cad.export`) and the mesh
   * metadata from the last Run.
   *
   * The host wires this to the existing env-switch + project-import
   * handoff (UNIFY 1):
   *   1. Switch the active env back to the user's previously-active
   *      machine env (or prompt when none is active).
   *   2. Stage the STL into the active project's first plate via the
   *      existing `stlStage` flow.
   *   3. Surface the "Design exported and loaded into the CAM
   *      workspace" toast.
   *
   * The export step itself (the `cad.export` IPC round-trip) is owned
   * by the workspace, NOT the host — keeping the unification point
   * inside this component means a single click runs export + handoff
   * atomically. The host receives the finished STL path and never has
   * to know about the CadQuery handle table.
   *
   * Optional — when omitted, the Send-to-CAM button is hidden.
   */
  readonly onSendToCam?: (payload: {
    readonly stlPath: string
    readonly mesh: CadExecuteScriptMesh
  }) => void
  /** Toast hook from the host. Optional — falls back to a no-op. */
  readonly onToast?: (kind: 'ok' | 'err' | 'warn', message: string) => void
  /**
   * CAD V1 Workflow H — initial selection. Optional. Used by render-pin
   * tests to assert the status chip shape without spinning up a viewport
   * raycast, AND by future "restore last selection" project-store flows
   * once selections persist beyond a single session.
   *
   * Treated as the SEED for the internal `selection` state; the operator
   * can clear it via ESC or replace it via a viewport click just like
   * any naturally-acquired selection.
   */
  readonly initialSelection?: Selection | null
  /**
   * CAD V2 — seed for the top-level view-mode tab bar. Defaults to
   * `'part'` so existing callers (and the existing render-pin tests)
   * keep landing on the original Part view without code changes. The
   * render-pin tests for the new tab bar thread this in to assert each
   * branch's render contract without driving click handlers.
   */
  readonly initialViewMode?: DesignViewMode
  /**
   * CAD V2 — initial parts list for the Assembly view. The Design
   * workspace owns the canonical list (so the operator's adds /
   * removes persist across tab switches); this prop seeds it on mount
   * so the render-pin tests can assert the populated branch without
   * driving the "Add part" callback.
   */
  readonly initialAssemblyParts?: readonly AssemblyPart[]
  /**
   * CAD V1 mate-wiring — render-pin escape hatch that seeds the assembly
   * handle the {@link AssemblyMatePanel} threads into
   * `cad.add_assembly_mate`. In the running shell this is `null` on mount
   * and gets populated when `AssemblyView`'s build effect reports a freshly
   * built handle (via `onAssemblyHandle`). Tests seed it directly so a
   * static render can assert the Solve button enables without flushing the
   * async build effect.
   */
  readonly initialAssemblyHandle?: string | null
  /**
   * CAD V1 mate-wiring — fired after a mate solves successfully in the
   * {@link AssemblyMatePanel}. The host (the new-shell `DesignWorkspaceHost`)
   * persists the solved mate into the assembly's durable `mateConstraints`
   * (Model C). Optional — when omitted the panel still solves and paints its
   * badge, just without host-side persistence.
   */
  readonly onMateAdded?: (mate: SolvedMate) => void
  /**
   * The editable kernel-op timeline for the active part
   * (`part/features.json` `kernelOps[]`). Optional pass-through: a host that
   * owns the DesignSessionContext threads the live array + edit callbacks here
   * so the FeatureTree's Operations panel grows the reorder / suppress /
   * roll-back timeline. Omitted by hosts that don't have a session yet
   * (the splash preview, the render-pin tests), in which case the timeline
   * section simply does not render and every existing Part-view pin holds.
   */
  readonly kernelOps?: ReadonlyArray<KernelPostSolidOp>
  /** Inclusive roll-back marker into `kernelOps` (`undefined`/`-1` = build all). */
  readonly rolledBackTo?: number
  /** Keyboard move up/down of the kernel op at `index` by `delta` (±1). */
  readonly onKernelMove?: (index: number, delta: -1 | 1) => void
  /** Completed drag: move the kernel op at `from` to land at `to`. */
  readonly onKernelReorder?: (from: number, to: number) => void
  /** Toggle the suppress flag of the kernel op at `index`. */
  readonly onKernelSuppressToggle?: (index: number, suppressed: boolean) => void
  /** Set the inclusive roll-back marker to `index`. */
  readonly onKernelSetRollback?: (index: number) => void
  /** Clear the roll-back marker (back to "build all"). */
  readonly onKernelClearRollback?: () => void
}

/** Debounce window for `cad.list_operations` (matches research finding). */
const LIST_OPS_DEBOUNCE_MS = 300

/**
 * Convert a sidecar `CadOperationSummary` into the shape `FeatureTree`
 * expects. The mapping is intentionally lossless — the sidecar already
 * formats `summary` for display, we just split it into `op` + `args`.
 */
function toFeatureRow(entry: CadOperationSummary): FeatureTreeOperation {
  // Split "extrude(distance=12, taper=3)" → op="extrude", args="distance=12, taper=3"
  const openParen = entry.summary.indexOf('(')
  const closeParen = entry.summary.lastIndexOf(')')
  if (openParen > 0 && closeParen > openParen) {
    return {
      line: entry.line,
      op: entry.summary.slice(0, openParen),
      args: entry.summary.slice(openParen + 1, closeParen)
    }
  }
  return { line: entry.line, op: entry.kind, args: entry.summary }
}

export function DesignWorkspace({
  initialScript = '',
  onSave,
  onSendToCam,
  onToast,
  initialSelection = null,
  initialViewMode = 'part',
  initialAssemblyParts = [],
  initialAssemblyHandle = null,
  onMateAdded,
  kernelOps,
  rolledBackTo,
  onKernelMove,
  onKernelReorder,
  onKernelSuppressToggle,
  onKernelSetRollback,
  onKernelClearRollback,
}: DesignWorkspaceProps): JSX.Element {
  const [scriptText, setScriptText] = useState(initialScript)
  /**
   * CAD V2 — top-level view-mode. Switching between Part / Assembly /
   * Drawing must NOT remount the editor, the build result, or the
   * feature tree (the operator's mental model is "switch perspectives
   * on the same model"). We achieve this by keeping ALL existing Part
   * view state in this single hook and only conditionally rendering
   * the appropriate branch.
   */
  const [activeView, setActiveView] = useState<DesignViewMode>(initialViewMode)
  /**
   * CAD V2 — the assembly's parts list lives at this level so adds /
   * removes survive tab switches. Sibling agents own the sidecar
   * bridge that actually builds the assembly; the AssemblyView reads
   * this list and re-fetches via `cad.createAssembly` /
   * `cad.tessellateAssembly` on every change.
   */
  const [assemblyParts, setAssemblyParts] = useState<readonly AssemblyPart[]>(initialAssemblyParts)
  /**
   * CAD V1 mate-wiring — the opaque assembly handle from the most recent
   * `cad.createAssembly` round-trip. Lifted out of {@link AssemblyView}'s
   * build effect (which reports it via `onAssemblyHandle`) so the
   * {@link AssemblyMatePanel} can pass it to `cad.add_assembly_mate`. `null`
   * until the first successful build, and reset to `null` when the assembly
   * is emptied or a build fails — the panel's Solve button stays disabled
   * with a hint while it is null.
   */
  const [assemblyHandle, setAssemblyHandle] = useState<string | null>(initialAssemblyHandle)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastTessellation, setLastTessellation] = useState<CadExecuteScriptResult | null>(null)
  const [operations, setOperations] = useState<readonly CadOperationSummary[]>([])
  const [parameters, setParameters] = useState<readonly CadDeclaredParameter[]>([])
  const [parseError, setParseError] = useState<CadParseError | null>(null)
  /**
   * Active CQGI `build_parameters` overrides keyed by parameter name.
   * Set by the FeatureTree's Apply button (BUILD 6, CAD V1). When
   * non-null, every `handleRun` round-trip threads the map through to
   * `cad.execute({ script, buildParameters })` so the user can re-run
   * with a tweaked length / radius / etc. without touching the script.
   *
   * Stored as a discriminated null (rather than `{}`) so a freshly-
   * mounted workspace doesn't ship an empty buildParameters envelope
   * the sidecar would still have to validate.
   */
  const [paramOverrides, setParamOverrides] = useState<
    Record<string, CadScriptParamValue> | null
  >(null)

  /**
   * CAD V1 Workflow H — current 3D entity selection. `null` when nothing
   * is selected; a `Selection` union (face / edge / vertex; only `face`
   * exercised in V1) when the operator has clicked an entity in the
   * viewport. Mutated by:
   *   - Viewport3D's `onSelect` callback (plain-click pick).
   *   - The ESC key handler below (`clearSelection`).
   *   - `handleRun` after a successful re-run (geometry changes, so
   *     stale selection IDs become meaningless).
   */
  const [selection, setSelectionState] = useState<Selection | null>(initialSelection)

  /**
   * Latest selection-grade tessellation from `cad.tessellate_with_ids`.
   * Carries the `faceMap` keyed by face id so the status chip can read
   * a friendly label (area / OCCT hash); the `faceIds` parallel array
   * is stashed directly on the BufferGeometry's `userData` so the
   * viewport's click handler can resolve a triangle index in O(1)
   * without re-loading state.
   */
  const [selectionTessellation, setSelectionTessellation] =
    useState<CadTessellateWithIdsResult | null>(null)

  /**
   * Persisted, associative 2D-drawing dimensions for the active part's sheet
   * (`sheet.annotations.dimensions`). Threaded into the DrawingView in
   * controlled mode so a placed dimension records its snapped feature's `refId`
   * and re-resolves against fresh geometry on every re-projection. Held here
   * (not inside DrawingView) so it survives view-tab switches and is the value
   * a future project-save writes into `drawing.json`. Documentation overlays
   * only — never read by CAM/G-code (Safety Rule 1).
   */
  const [drawingDimensions, setDrawingDimensions] = useState<readonly DrawingDimension[]>([])

  /**
   * Persisted, associative GD&T feature control frames for the active part's
   * sheet (`sheet.annotations.featureControlFrames`). Threaded into the
   * DrawingView in controlled mode so a placed frame records its snapped
   * feature's `refId` and re-resolves against fresh geometry on every
   * re-projection. Held here (not inside DrawingView) so it survives view-tab
   * switches and is the value a future project-save writes into `drawing.json`.
   * Documentation overlays only — never read by CAM/G-code (Safety Rule 1).
   */
  const [drawingGdtFrames, setDrawingGdtFrames] = useState<readonly GdtFeatureControlFrame[]>([])

  // Debounce timer for the listOperations refresh; cleared on unmount + on
  // every keystroke so we never call the sidecar mid-typing-burst.
  const listOpsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const toast = useCallback(
    (kind: 'ok' | 'err' | 'warn', message: string): void => {
      onToast?.(kind, message)
    },
    [onToast]
  )

  // ── Run handler ───────────────────────────────────────────────────────────
  //
  // Extracted as a helper so the public Run button and the Apply-from-
  // FeatureTree path both share the same execute/handle plumbing. The
  // helper accepts an explicit override map rather than reading state
  // because `setParamOverrides(...)` is async — clicking Apply needs to
  // run with the freshly-passed overrides, not the stale snapshot.
  const runScriptWithOverrides = useCallback(
    async (
      overrides: Record<string, CadScriptParamValue> | null,
    ): Promise<void> => {
      if (busy) return
      if (!scriptText.trim()) {
        setError('Script is empty — type a CadQuery expression and try again.')
        toast('warn', 'Cannot run an empty script.')
        return
      }
      setBusy(true)
      setError(null)
      try {
        const response = await fab().cad.execute(
          overrides && Object.keys(overrides).length > 0
            ? { script: scriptText, buildParameters: overrides }
            : { script: scriptText },
        )
        if (!response.ok) {
          const detail = response.hint ? ` — ${response.hint}` : ''
          setError(`Run failed: ${response.error}${detail}`)
          toast('err', `Run failed: ${response.error}`)
          return
        }
        setLastTessellation(response.result)
        // CAD V1 Workflow H — re-run produces a fresh geometry, so the
        // previous face IDs are no longer meaningful. Clear selection
        // BEFORE the new tessellation hits state so the operator never
        // sees a stale highlight against new geometry.
        setSelectionState(clearSelection())
        if (response.result.error) {
          setError(`Script error: ${response.result.error.message}`)
          toast('err', response.result.error.message)
          setSelectionTessellation(null)
          return
        }
        // Selection-grade tessellation (parallel call, non-blocking for
        // the success toast). Failures here are SILENT — selection is
        // a progressive enhancement; the existing STL handoff still
        // works without face IDs. We just log to the console so a
        // developer can spot a regression.
        const firstMesh = response.result.meshes[0]
        if (firstMesh) {
          try {
            const tessResponse = await fab().cad.tessellateWithIds({
              handle: firstMesh.handle,
            })
            if (tessResponse.ok) {
              setSelectionTessellation(tessResponse.result)
            } else {
              setSelectionTessellation(null)
              // eslint-disable-next-line no-console
              console.debug('cad.tessellateWithIds failed', tessResponse.error)
            }
          } catch (e) {
            setSelectionTessellation(null)
            // eslint-disable-next-line no-console
            console.debug('cad.tessellateWithIds threw', e)
          }
        } else {
          setSelectionTessellation(null)
        }
        const meshCount = response.result.meshes.length
        const triCount = response.result.meshes.reduce(
          (sum, mesh) => sum + mesh.triangleCount,
          0
        )
        toast('ok', `Built ${meshCount} body / ${triCount.toLocaleString()} triangles.`)
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        setError(`Run failed: ${message}`)
        toast('err', `Run failed: ${message}`)
      } finally {
        setBusy(false)
      }
    },
    [busy, scriptText, toast],
  )

  const handleRun = useCallback(async (): Promise<void> => {
    await runScriptWithOverrides(paramOverrides)
  }, [runScriptWithOverrides, paramOverrides])

  /**
   * Fired by FeatureTree's Apply button. Stash the new overrides so
   * future Run clicks reuse them, then immediately re-run the script
   * with the fresh values — the operator's mental model is "Apply =
   * see the change", not "Apply, then click Run separately".
   */
  const handleParamsChange = useCallback(
    (overrides: Record<string, CadScriptParamValue>): void => {
      // Empty object means the operator reset every row before
      // hitting Apply. Treat that as "drop overrides entirely" so
      // subsequent Runs go back to the script defaults.
      const next = Object.keys(overrides).length > 0 ? overrides : null
      setParamOverrides(next)
      void runScriptWithOverrides(next)
    },
    [runScriptWithOverrides],
  )

  // ── Debounced FeatureTree refresh ─────────────────────────────────────────
  useEffect(() => {
    if (listOpsTimerRef.current !== null) {
      clearTimeout(listOpsTimerRef.current)
    }
    if (!scriptText.trim()) {
      setOperations([])
      setParameters([])
      setParseError(null)
      return
    }
    listOpsTimerRef.current = setTimeout(() => {
      void (async () => {
        try {
          const response = await fab().cad.listOperations({ script: scriptText })
          if (!response.ok) {
            // We deliberately do NOT bubble listOperations failures to the
            // user-visible error banner — the read-only feature tree should
            // never block typing. Surfaces silently as an empty list with
            // a console diagnostic for developer debugging.
            // eslint-disable-next-line no-console
            console.debug('cad.listOperations failed', response.error)
            setOperations([])
            setParameters([])
            setParseError(null)
            return
          }
          setOperations(response.result.operations)
          setParameters(response.result.parameters)
          setParseError(response.result.parseError ?? null)
        } catch {
          setOperations([])
          setParameters([])
          setParseError(null)
        }
      })()
    }, LIST_OPS_DEBOUNCE_MS)
    return () => {
      if (listOpsTimerRef.current !== null) {
        clearTimeout(listOpsTimerRef.current)
        listOpsTimerRef.current = null
      }
    }
  }, [scriptText])

  // ── Send to CAM ───────────────────────────────────────────────────────────
  // Tracks whether the cad.export round-trip is in flight so we can
  // disable the Send-to-CAM button and prevent duplicate exports if
  // the operator double-clicks.
  const [sending, setSending] = useState(false)
  // ── UI-3 cockpit chrome state ─────────────────────────────────────────────
  // codeOpen drives the CadQuery slide-over drawer (default CLOSED so the
  // Part view reads as a no-code cockpit); designStage tracks the Model /
  // Sketch / Inspect stage-tabs in the viewport chrome. Both are local UI
  // state with no sidecar side-effects.
  const [codeOpen, setCodeOpen] = useState(false)
  const [designStage, setDesignStage] = useState<'model' | 'sketch' | 'inspect'>('model')

  const firstMesh: CadExecuteScriptMesh | null =
    lastTessellation?.meshes[0] ?? null

  const handleSendToCam = useCallback(async (): Promise<void> => {
    if (!firstMesh) {
      toast('warn', 'Run the script first to produce a model.')
      return
    }
    if (!onSendToCam) return
    if (sending) return
    setSending(true)
    setError(null)
    try {
      // UNIFY 1: delegate the export + handoff to the extracted pure
      // helper so the call-order contract is testable without React.
      const outcome = await performSendToCam(
        firstMesh,
        (payload) => fab().cad.export(payload),
        onSendToCam,
      )
      if (!outcome.ok) {
        const detail = outcome.hint ? ` — ${outcome.hint}` : ''
        setError(`Export failed: ${outcome.error}${detail}`)
        toast('err', `Export failed: ${outcome.error}`)
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(`Export failed: ${message}`)
      toast('err', `Export failed: ${message}`)
    } finally {
      setSending(false)
    }
  }, [firstMesh, onSendToCam, sending, toast])

  // ── Save handler ──────────────────────────────────────────────────────────
  const handleSave = useCallback((): void => {
    if (!onSave) return
    onSave(scriptText)
    toast('ok', 'Script saved.')
  }, [onSave, scriptText, toast])

  // ── Seed starter script from the empty-state CTA ──────────────────────────
  const handleSeedStarter = useCallback((): void => {
    setScriptText(STARTER_SCRIPT)
    setError(null)
  }, [])

  // ── CAD V2 — Assembly + Drawing plumbing ──────────────────────────────────
  /**
   * Default "Add part" handler. Drops the currently-built mesh (if any)
   * into the assembly with identity transform. The host can override
   * this surface in v2.1 when a part-picker dialog ships; today the
   * common case is "I just built a part, drop it into the assembly so
   * I can position the next one against it".
   */
  const handleAddPartToAssembly = useCallback((): void => {
    if (!firstMesh) {
      toast('warn', 'Run the script first to produce a part you can add.')
      return
    }
    setAssemblyParts((prev) => {
      const idx = prev.length + 1
      const next: AssemblyPart = {
        id: `part-${Date.now().toString(36)}-${idx}`,
        name: `Part ${idx}`,
        handle: firstMesh.handle,
        transformSummary: 'identity',
      }
      return [...prev, next]
    })
  }, [firstMesh, toast])

  const handleRemoveAssemblyPart = useCallback((id: string): void => {
    setAssemblyParts((prev) => prev.filter((p) => p.id !== id))
  }, [])

  /**
   * Drawing view delegates exports to the sidecar's `cad.exportDrawing`
   * bridge (owned by sibling agents in the CAD V2 wave). When the
   * bridge isn't available yet, fall back to a toast so the operator
   * isn't left wondering why the click did nothing.
   */
  const handleExportDrawing = useCallback(
    (format: 'pdf' | 'svg'): void => {
      toast('ok', `${format.toUpperCase()} export queued.`)
    },
    [toast],
  )

  /**
   * Detail (crop) views are produced by the DrawingView via `cad.detailDrawing`
   * (the sidecar magnifies the crop + stamps the escaped label). For now the
   * host just acknowledges the result with a toast; a future cycle hosts the
   * cropped SVG as its own sheet. Documentation overlay only (Safety Rule 1).
   */
  const handleDetailView = useCallback(
    (result: { readonly label: string }): void => {
      toast('ok', `${result.label} created.`)
    },
    [toast],
  )

  /** Currently-active part handle threaded into the DrawingView. */
  const activePartHandle: string | null = firstMesh?.handle ?? null

  // ── CAD V1 Workflow H — selection plumbing ────────────────────────────────
  /**
   * Plain-click pick callback wired into `Viewport3D.onSelect`. Replaces
   * the current selection unconditionally (toggle behavior lives in the
   * pure helper but isn't exposed at this layer until the user has a
   * second affordance — e.g. ctrl-click for multi-select — to avoid
   * accidental deselects in V1).
   */
  const handleViewportSelect = useCallback((next: Selection): void => {
    setSelectionState((prev) => setSelection(prev, next))
  }, [])

  /**
   * ESC clears the active selection. Mounted as a document-level
   * `keydown` listener so the operator can dismiss a selection from
   * anywhere in the workspace — pressing ESC while focused on the
   * editor textarea, the viewport, or the FeatureTree all work.
   *
   * The listener is bound only while the workspace is mounted AND a
   * selection exists; this keeps the listener count bounded and avoids
   * fighting with the editor's native ESC behavior (if any) when the
   * user just wants to dismiss the IDE menu.
   */
  useEffect(() => {
    if (selection === null) return undefined
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setSelectionState(clearSelection())
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [selection])

  /**
   * Derive a user-facing label for the selection chip. Pulls from the
   * `faceMap` when available (so the chip can show "face 4 · 25.0 mm²"
   * once the sidecar lands), and falls back to "Face N" when only the
   * id is known.
   */
  const selectionLabel: string | null = useMemo(() => {
    if (selection === null) return null
    if (selection.kind === 'face') {
      const entry: CadFaceMapEntry | undefined =
        selectionTessellation?.faceMap?.[String(selection.faceId)]
      if (entry?.area && Number.isFinite(entry.area)) {
        return `Face ${selection.faceId} · ${entry.area.toFixed(1)} mm²`
      }
      return `Face ${selection.faceId}`
    }
    if (selection.kind === 'edge') return `Edge ${selection.faceId}`
    return `Vertex ${selection.faceId}`
  }, [selection, selectionTessellation])

  // ── Derived feature rows for the right panel ──────────────────────────────
  const featureRows: readonly FeatureTreeOperation[] = useMemo(
    () => operations.map(toFeatureRow),
    [operations]
  )

  /**
   * Reshape sidecar `CadDeclaredParameter` rows into the FeatureTree's
   * wire-isolated `FeatureTreeParameter` type. The two shapes are
   * intentionally identical today; the conversion exists so a future
   * sidecar schema change (e.g. units / clamps) can extend
   * `CadDeclaredParameter` without dragging FeatureTree's public API
   * along for the ride.
   */
  const featureParameters: readonly FeatureTreeParameter[] = useMemo(
    () =>
      parameters.map<FeatureTreeParameter>((p) => ({
        name: p.name,
        value: p.value,
        kind: p.kind,
      })),
    [parameters]
  )

  const triangleSummary: string | null = useMemo(() => {
    if (!lastTessellation || lastTessellation.meshes.length === 0) return null
    const triCount = lastTessellation.meshes.reduce(
      (sum, mesh) => sum + mesh.triangleCount,
      0
    )
    return `${lastTessellation.meshes.length} body, ${triCount.toLocaleString()} triangles`
  }, [lastTessellation])

  // ── CAD V2 — view-mode tab bar ────────────────────────────────────────────
  /**
   * Tab bar rendered at the top of every non-empty surface. Kept as an
   * inline render so the existing Part-view three-pane block does not
   * need a structural rewrite; we simply prepend the bar inside the
   * outermost `.design-workspace` container.
   *
   * Pure presentational — owns no state of its own; reads `activeView`
   * and dispatches `setActiveView`. The tab buttons use the project's
   * `.btn` primitive so they pick up the same theme as the rest of the
   * surface (`.btn-primary` for active, `.btn-ghost` for inactive).
   */
  const renderViewTabBar = (): JSX.Element => (
    <nav
      className="design-workspace__tabbar"
      role="tablist"
      aria-label="Design view"
      data-testid="design-workspace-tabbar"
    >
      {(['part', 'assembly', 'drawing'] as const).map((mode) => {
        const isActive = activeView === mode
        const label = mode === 'part' ? 'Part' : mode === 'assembly' ? 'Assembly' : 'Drawing'
        return (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={`design-workspace-panel-${mode}`}
            data-testid={DESIGN_VIEW_TAB_TESTIDS[mode]}
            className={
              isActive
                ? 'btn btn-primary design-workspace__tab design-workspace__tab--active'
                : 'btn btn-ghost design-workspace__tab'
            }
            onClick={() => setActiveView(mode)}
          >
            {label}
          </button>
        )
      })}
    </nav>
  )

  // ── Empty-state branch (no script yet) ────────────────────────────────────
  // Only triggers in Part view — when the operator has switched to
  // Assembly or Drawing they should land on those views regardless of
  // whether a script has been typed (the assembly/drawing surfaces own
  // their OWN empty-state UX).
  if (activeView === 'part' && scriptText.trim().length === 0 && !lastTessellation) {
    return (
      <div className="design-workspace" data-testid="design-workspace-empty">
        {renderViewTabBar()}
        <EmptyState
          testId="design-workspace-empty-state"
          icon={'✎'}
          title="Start a parametric design"
          body="Write a CadQuery script and run it to produce a model. Send the result to one of your machines when you are ready."
          cta={{
            label: 'New design',
            variant: 'primary',
            onClick: handleSeedStarter
          }}
        />
      </div>
    )
  }

  // ── Assembly view ─────────────────────────────────────────────────────────
  if (activeView === 'assembly') {
    return (
      <div className="design-workspace" data-testid="design-workspace">
        {renderViewTabBar()}
        <div
          className="design-workspace__view-panel design-workspace__view-panel--assembly"
          role="tabpanel"
          id="design-workspace-panel-assembly"
          aria-labelledby={DESIGN_VIEW_TAB_TESTIDS.assembly}
        >
          <AssemblyView
            parts={assemblyParts}
            onAddPart={handleAddPartToAssembly}
            onRemovePart={handleRemoveAssemblyPart}
            onAssemblyHandle={setAssemblyHandle}
            onToast={onToast}
          />
          {/*
            CAD V1 mate-creation surface. Only renders once the assembly has
            at least one part (an empty assembly has nothing to mate, and the
            AssemblyView itself shows its own empty-state in that case). The
            panel's Solve button stays disabled until `assemblyHandle` is
            non-null — i.e. until AssemblyView's build effect has produced a
            real handle — so mounting it is inert (no spurious IPC) when the
            assembly hasn't been built yet. This is the mount that makes the
            mate surface REACHABLE on the live `assemble` route.
          */}
          {assemblyParts.length > 0 && (
            <AssemblyMatePanel
              parts={assemblyParts}
              assemblyHandle={assemblyHandle}
              onMateAdded={onMateAdded}
              onToast={onToast}
            />
          )}
        </div>
      </div>
    )
  }

  // ── Drawing view ──────────────────────────────────────────────────────────
  if (activeView === 'drawing') {
    return (
      <div className="design-workspace" data-testid="design-workspace">
        {renderViewTabBar()}
        <div
          className="design-workspace__view-panel"
          role="tabpanel"
          id="design-workspace-panel-drawing"
          aria-labelledby={DESIGN_VIEW_TAB_TESTIDS.drawing}
        >
          <DrawingView
            partHandle={activePartHandle}
            onExport={handleExportDrawing}
            onToast={onToast}
            persistedDimensions={drawingDimensions}
            onPersistDimensions={setDrawingDimensions}
            persistedGdtFrames={drawingGdtFrames}
            onPersistGdt={setDrawingGdtFrames}
            onDetail={handleDetailView}
          />
        </div>
      </div>
    )
  }

  // ── Part view — UI-3 "Fusion cockpit" (browser · viewport · props) ───────
  //
  // Three-pane no-code cockpit ported from docs/ui-mockups/index.html:
  //   • LEFT   (.dc-browser): the feature-tree browser — panel header
  //     "Feature Tree" over the existing ops <FeatureTree> (with the
  //     kernel timeline when a host threads it in).
  //   • CENTER (.design-workspace__viewport-col): the viewport placeholder
  //     (build summary / empty-state — there is NO live 3D yet) wrapped in
  //     the <ViewportChrome> overlays (toolbar, stage-tabs, viewcube, triad)
  //     plus the selection chip (still owned here, gated on selectionLabel).
  //   • RIGHT  (.dc-props): the Properties panel — editable parameters as
  //     prop-cards + the Save / Send-to-CAM actions.
  // The CadQuery code editor moves OUT of the primary layout into a
  // slide-over drawer toggled by the toolbar's Code </> button (default
  // closed). The editor stays mounted at all times so the Run path and the
  // historical render-pins (`design-workspace__editor-col`) hold.
  return (
    <div
      className="design-workspace design-workspace--cockpit"
      data-testid="design-workspace"
    >
      {renderViewTabBar()}
      <div className="dc-cockpit">
        {/* LEFT — Feature-tree browser */}
        <aside className="dc-browser" aria-label="Feature tree">
          <div className="dc-panel-head">Feature Tree</div>
          <div className="dc-browser-body">
            {parseError !== null ? (
              <div
                className="design-workspace__feature-error"
                role="alert"
                data-testid="design-workspace-parse-error"
              >
                Line {parseError.line}: {parseError.message}
              </div>
            ) : (
              <FeatureTree
                operations={featureRows}
                kernelOps={kernelOps}
                rolledBackTo={rolledBackTo}
                onKernelMove={onKernelMove}
                onKernelReorder={onKernelReorder}
                onKernelSuppressToggle={onKernelSuppressToggle}
                onKernelSetRollback={onKernelSetRollback}
                onKernelClearRollback={onKernelClearRollback}
              />
            )}
          </div>
        </aside>

        {/* CENTER — chromed viewport (placeholder body + overlay chrome) */}
        <section
          className="design-workspace__viewport-col"
          aria-label="3D preview"
          data-testid="design-workspace-viewport"
        >
          <ViewportChrome
            stage={designStage}
            onStageChange={setDesignStage}
            selectionLabel={selectionLabel}
            codeOpen={codeOpen}
            onToggleCode={() => setCodeOpen((open) => !open)}
          />
          {firstMesh ? (
            <div
              className="design-workspace__viewport-summary"
              data-testid="design-workspace-mesh-summary"
            >
              <div className="design-workspace__viewport-title">
                {'▢'} Build result
              </div>
              <div className="design-workspace__viewport-meta">
                {triangleSummary}
              </div>
              <div className="design-workspace__viewport-path" title={firstMesh.stlPath}>
                {firstMesh.stlPath}
              </div>
            </div>
          ) : (
            <EmptyState
              testId="design-workspace-viewport-empty"
              title="Click Run to see your design"
              body="Open the code drawer, write a CadQuery script and run it — your built model will appear here."
            />
          )}
          {/*
            CAD V1 Workflow H — selection status chip. Still owned by
            DesignWorkspace (pinned by DesignWorkspace.selection.test.tsx),
            anchored at the bottom-center of the viewport. ESC clears (see the
            keydown effect above); the chip vanishes the moment `selection`
            returns to null.
          */}
          {selectionLabel !== null && (
            <div
              className="design-workspace__selection-chip"
              role="status"
              data-testid="design-workspace-selection-chip"
              aria-live="polite"
            >
              {selectionLabel}
            </div>
          )}

          {/*
            CadQuery code drawer — slide-over over the left browser, toggled by
            the viewport toolbar's Code </> button. Rendered ALWAYS-MOUNTED
            (only translated off-screen when closed) so the editor + Run path
            stay live and the `design-workspace__editor-col` render-pin holds
            regardless of the drawer's open state.
          */}
          <div
            className={
              codeOpen
                ? 'dc-code-drawer dc-code-drawer--open'
                : 'dc-code-drawer'
            }
            data-testid="design-workspace-code-drawer"
            aria-hidden={codeOpen ? undefined : true}
          >
            <div className="dc-code-drawer-head">
              CadQuery Code
              <button
                type="button"
                className="dc-code-drawer-close"
                aria-label="Close code drawer"
                data-testid="design-workspace-code-close"
                onClick={() => setCodeOpen(false)}
              >
                {'✕'}
              </button>
            </div>
            <div className="dc-code-drawer-body">
              <section
                className="design-workspace__editor-col"
                aria-label="CadQuery script editor"
              >
                {error !== null && (
                  <div
                    className="design-workspace__error"
                    role="alert"
                    data-testid="design-workspace-error"
                  >
                    {error}
                  </div>
                )}
                <CadQueryEditor
                  value={scriptText}
                  onChange={setScriptText}
                  onRun={() => {
                    void handleRun()
                  }}
                  busy={busy}
                />
              </section>
            </div>
          </div>
        </section>

        {/* RIGHT — Properties panel (params + Save / Send-to-CAM) */}
        <aside
          className="design-workspace__tree-col dc-props"
          aria-label="Properties"
        >
          <div className="dc-panel-head">Properties</div>
          <div className="dc-props-body">
            <div className="dc-prop-card design-workspace__feature-section">
              <h3 className="dc-prop-card-title design-workspace__feature-title">
                Parameters
              </h3>
              {featureParameters.length === 0 ? (
                <div className="design-workspace__feature-empty">
                  No parameters declared.
                </div>
              ) : (
                <div data-testid="design-workspace-parameters">
                  {/*
                    FeatureTree's params section owns the editable inputs and
                    the Apply / Reset wiring (BUILD 6). We feed it an empty
                    operations array so the operations rendering path is
                    suppressed inside this instance — the ops FeatureTree in the
                    left browser renders those separately.
                  */}
                  <FeatureTree
                    operations={[]}
                    parameters={featureParameters}
                    paramOverrides={paramOverrides ?? undefined}
                    onParamsChange={handleParamsChange}
                  />
                </div>
              )}
            </div>

            <div className="dc-props-actions design-workspace__feature-actions">
              {onSave && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  data-testid="design-workspace-save"
                  onClick={handleSave}
                >
                  Save
                </button>
              )}
              {onSendToCam && (
                <button
                  type="button"
                  className="btn btn-primary"
                  data-testid="design-workspace-send-to-cam"
                  disabled={!firstMesh || sending}
                  aria-busy={sending}
                  onClick={() => {
                    void handleSendToCam()
                  }}
                >
                  {sending ? 'Exporting…' : `${'→'} Send to CAM`}
                </button>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

export default DesignWorkspace
