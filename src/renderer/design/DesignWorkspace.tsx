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
import type { BufferGeometry } from 'three'
import { EmptyState } from '../src/EmptyState'
import { CadQueryEditor } from './CadQueryEditor'
import { ViewportChrome } from './ViewportChrome'
import { Viewport3D } from './Viewport3D'
import { MvpSketchCanvas } from './Sketch2DCanvas'
import { SketchSurface } from './SketchSurface'
import { sketchToolForDesignCommand } from './design-command-map'
import type { DesignFileV2 } from '../../shared/design-schema'
import { buildViewportGeometry } from './viewport3d-geometry'
import { buildPickIndex } from '../../shared/kernel-pick-file'
import { worldYRangeFromExtrudeMeshGeometry } from './viewport3d-bounds'
import {
  AssemblyView,
  applySolvedTransforms,
  type AssemblyPart,
  type SolvedComponentTransform
} from './AssemblyView'
import type { AssemblyMateConstraint } from '../../shared/assembly-mate-schema'
import { AssemblyMatePanel, type SolvedMate } from './AssemblyMatePanel'
import {
  DrawingView,
  type DrawingBomLine,
  type DrawingSheetTab,
  type DrawingTitleBlock,
} from './DrawingView'
import {
  emptyDrawingViewState,
  type DrawingViewState,
} from '../../shared/drawing-hydrate'
import type {
  DrawingDimension,
  GdtFeatureControlFrame,
  SurfaceFinishSymbol,
} from '../../shared/drawing-annotation-schema'
import {
  FeatureTree,
  type FeatureTreeOperation,
  type FeatureTreeParameter,
  type FeatureTreeUserParameter
} from './FeatureTree'
import type { KernelPostSolidOp } from '../../shared/part-features-schema'
import {
  FeatureDialogHost,
  type FeatureDialogKind,
  type FeatureDialogSpec
} from './feature-dialogs'
import { profileOptions, pathOptions } from './feature-dialogs/profile-path-options'
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
  selectionToSurface,
  type Selection,
  type SelectionKind,
  type SelectionSurface
} from './selection-state'

/**
 * Default lateral offset (mm) between successive assembly instances of the
 * SAME body, so two parts from one source mesh do not overlap in the viewport.
 * The mate solver can still reposition them; this is only the initial spread.
 */
export const ASSEMBLY_PART_OFFSET_MM = 60

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
   * CAD foundation — seed for the Assembly view's durable mate constraints
   * (`assembly.json` `mateConstraints`, Model C). The host hydrates these from
   * disk on the `assemble` route (via `hydrateAssembly` in
   * `assembly-part-bridge`) so a SAVED assembly shows its mates after reload AND
   * the solver actually positions the parts. Optional + additive: when omitted
   * the Assembly view starts with no mates (legacy behaviour) — every existing
   * render-pin holds.
   */
  readonly initialAssemblyMates?: readonly AssemblyMateConstraint[]
  /**
   * CAD foundation — fired whenever the assembly's parts list changes (add /
   * remove). The host folds the rows into `assembly.json` `components` (via
   * `partsToComponents` in `assembly-part-bridge`) and persists, so a mate's
   * `part1Id`/`part2Id` resolve against real saved components (closes the
   * write-only #8 gap).
   * Optional — when omitted parts stay in-memory only (the splash preview, the
   * render-pin tests), so every existing pin holds.
   */
  readonly onAssemblyPartsChange?: (parts: readonly AssemblyPart[]) => void
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
  /** Delete the kernel op at `index` from `part/features.json` `kernelOps[]`. */
  readonly onKernelDelete?: (index: number) => void
  /**
   * FG-5b — append a kernel post-solid op to `part/features.json` `kernelOps[]`.
   * Threaded from the host's `DesignSessionContext.appendKernelOp`. When
   * supplied, the Properties pane shows the per-feature property dialogs
   * (Extrude / Revolve / Fillet / Chamfer / Shell / Hole); their Fillet /
   * Chamfer / Shell / Hole "Apply" emits a kernel op through THIS callback (the
   * same path the timeline editors persist through, so a Build STEP picks it up
   * identically). Extrude / Revolve apply through the existing
   * `onParamsChange` script-rebuild path instead.
   *
   * Optional + additive: omitted by hosts without a session (the splash
   * preview, the render-pin tests), in which case the feature-dialog section
   * simply does not render and every existing Properties-pane pin holds.
   */
  readonly onAppendKernelOp?: (op: KernelPostSolidOp) => void
  /**
   * FG-5b — true when no project is open / no model is built yet, so a kernel-op
   * append would early-return in the session. Forwarded to the dialogs so their
   * Apply renders disabled with an honest hint rather than silently dropping the
   * click. Optional — defaults to `false`.
   */
  readonly kernelOpsDisabled?: boolean
  /**
   * FG-3 (Wave 2 Integrate) — when `true`, the Part-view center pane mounts the
   * 2D sketcher ({@link MvpSketchCanvas}) instead of the 3D viewport, and the
   * contextual Sketch ribbon tab is requested (see {@link onCommandSurface}).
   * Driven by the host's sketch-mode state, which the Design-ribbon
   * `armSketchMode` / `armSketchTool` actions toggle. Optional + additive:
   * omitted by the splash preview and the render-pin tests, in which case the
   * viewport renders exactly as before and every existing Part-view pin holds.
   */
  readonly sketchActive?: boolean
  /**
   * FG-3 — fired when the operator leaves the sketcher from inside the Part view
   * (the "Finish sketch" affordance below the canvas). The host flips its
   * sketch-mode state off, which drops `sketchActive` back to `false`. Optional —
   * when omitted the Finish-sketch button is hidden (no host to notify).
   */
  readonly onSketchExit?: () => void
  /**
   * FG-3 — fired when the operator enters sketch mode from inside the Part
   * view (the cockpit's Sketch stage tab). The host flips its sketch-mode
   * state on, which raises `sketchActive`. This is the reachable in-cockpit
   * entry to the sketcher (the ribbon's Sketch tab is contextual — it only
   * appears ONCE sketch mode is active — so an always-visible entry is
   * required; the stage tab is it). Optional — when omitted the stage tabs
   * stay presentational (the pre-FG-3 behavior).
   */
  readonly onSketchEnter?: () => void
  /**
   * FG-3 — the catalog id of the sketch tool the ribbon most recently armed
   * (e.g. `'sk_line'`), or `null`. Surfaced as an honest hint above the mounted
   * sketcher so the ribbon→sketch arming is demonstrably live. The mounted
   * {@link MvpSketchCanvas} owns its OWN tool palette (it has no controlled
   * `activeTool` prop), so this is a read-out, NOT a controlled selector — see
   * the honesty note in the render block. Optional — defaults to `null`.
   */
  readonly armedSketchTool?: string | null
  /**
   * Wave 3e (keystone unlock) — the live sketch model the cockpit's Sketch stage
   * edits. When BOTH this and {@link onSketchDesignChange} are wired (the live
   * `DesignWorkspaceHost`, which threads `session.design` / `session.onDesignChange`),
   * the Sketch stage mounts the session-persisted {@link SketchSurface} instead
   * of the self-contained `MvpSketchCanvas` — so a drawn vector persists into the
   * design model, survives `manufacture:save` + reload, and is preserved across
   * Sketch↔Model stage switches.
   *
   * Optional + additive: when omitted (the splash preview, the render-pin tests),
   * the Sketch stage falls back to the self-contained `MvpSketchCanvas` exactly as
   * before, so every existing Part-view / sketch-mode pin holds.
   */
  readonly sketchDesign?: DesignFileV2
  /** Apply a sketch edit to the session model. Pairs with {@link sketchDesign}. */
  readonly onSketchDesignChange?: (next: DesignFileV2) => void
  /**
   * Wave 3f — import machinable DXF vectors directly onto the live Sketch
   * surface. Forwarded to {@link SketchSurface} as `onImportDxf`; when wired
   * (the live `DesignWorkspaceHost`) the palette shows an "Import DXF" button
   * that additive-merges the parsed DXF into the SAME session design model and
   * persists it — so the imported vectors appear on the mounted canvas at once.
   * Optional + additive: omitted on the splash preview + render-pin tests (the
   * button simply does not render), so every existing Sketch-stage pin holds.
   */
  readonly onSketchImportDxf?: () =>
    | void
    | DesignFileV2
    | null
    | Promise<void | DesignFileV2 | null>
  /**
   * FG-5 (Wave 2 Integrate) — a request from the ribbon's Solid commands to open
   * a per-feature dialog in the Properties pane. When this changes to a non-null
   * {@link FeatureDialogKind}, the workspace opens that dialog and calls
   * {@link onFeatureDialogConsumed} so the host can clear the one-shot request.
   * Optional — when omitted the dialogs are only reachable via the in-pane
   * 6-way picker (the FG-5b behavior), so every existing pin holds.
   */
  readonly requestedFeatureDialog?: FeatureDialogKind | null
  /** FG-5 — acknowledge that {@link requestedFeatureDialog} was applied (one-shot reset). */
  readonly onFeatureDialogConsumed?: () => void
  /**
   * FG-5 Inspect — a one-shot request from the ribbon's Inspect commands
   * (`'ut_measure'` | `'ut_section'`). When this changes to a non-null value the
   * workspace TOGGLES the matching viewport mode (measure tool / section clip) —
   * so dispatching Measure twice turns it off, the Fusion behavior — then calls
   * {@link onInspectConsumed} so the host can clear the one-shot. Optional —
   * when omitted Inspect is only reachable via the in-viewport HUD toggles, so
   * every existing pin holds.
   */
  readonly requestedInspect?: 'ut_measure' | 'ut_section' | null
  /** FG-5 Inspect — acknowledge that {@link requestedInspect} was applied (one-shot reset). */
  readonly onInspectConsumed?: () => void
  /**
   * Construct sketch-on-face — when `true`, the workspace arms viewport FACE-pick
   * so the next face the operator clicks becomes the sketch plane. Driven by the
   * Construct `sk_choose_plane` command (host `armSketchPlane`). On a pick the
   * workspace records the face plane, enters sketch mode (via {@link onSketchEnter}),
   * surfaces the chosen plane to the operator, and calls {@link onSketchPlanePicked}.
   * Optional + additive — when omitted face-pick-for-sketch is simply unavailable
   * and every existing mount is unchanged.
   */
  readonly sketchPlanePickArmed?: boolean
  /**
   * Construct sketch-on-face — fired with the picked face's plane basis (world
   * origin / outward normal / in-plane xAxis, all mm) once the operator clicks a
   * face while {@link sketchPlanePickArmed}. The host records it as the active
   * sketch plane. Optional — when omitted the workspace still enters sketch mode
   * + shows the plane readout, just without host-side capture.
   */
  readonly onSketchPlanePicked?: (plane: {
    readonly origin: [number, number, number]
    readonly normal: [number, number, number]
    readonly xAxis: [number, number, number]
  }) => void
  /**
   * FG-1/FG-3 — push the combined command surface (`hasSelection` ∪
   * `selectionKind` ∪ `sketchMode`) up into the Context Engine so the contextual
   * Sketch ribbon tab appears in sketch mode and selection-gated commands
   * enable/disable with the live pick. The host supplies the provider's
   * `useCommandSurface` setter here (DesignWorkspace stays provider-less so the
   * splash preview + render-pin tests keep rendering it without a
   * `CommandContextProvider`). Optional — when omitted the push is skipped.
   */
  readonly onCommandSurface?: (surface: SelectionSurface & { readonly sketchMode: boolean }) => void
  /**
   * Wave 3n — pass-through of the mounted sketch surface's pointer→world
   * output (`SketchSurface.onCursorWorld` ← the canvas's own snap-resolved
   * sketch-plane mm; `null` on pointer-leave/unmount). The host feeds it into
   * the shell `CursorCoordsContext` so the StatusBar shows live X/Y. The
   * workspace stays provider-less — it only threads the callback. Optional.
   */
  readonly onSketchCursorWorld?: (xyMm: readonly [number, number] | null) => void
  /**
   * Wave 3n — pass-through of the viewport's last face/edge PICK point
   * (`Viewport3D.onPickPoint`, world mm — fires only when a pick registers;
   * hover is deliberately not raycast). Same StatusBar destination. Optional.
   */
  readonly onViewportPickPoint?: (pointMm: {
    readonly x: number
    readonly y: number
    readonly z: number
  }) => void
  /**
   * No-code build→render: the live `THREE.BufferGeometry` of the kernel-built
   * solid (or sketch-preview / imported asset) the host's
   * `DesignSessionContext` maintains. When the operator builds a model with the
   * no-code feature timeline (extrude → fillet a picked edge, …) rather than the
   * CadQuery code drawer, THIS is the geometry that appears in the cockpit
   * viewport.
   *
   * Priority: a freshly-Run script result (the internal selection-grade
   * `viewportGeometry`) ALWAYS wins so the CadQuery code path is unchanged; this
   * is the fallback shown when no script has been run. Optional + additive:
   * omitted by the splash preview / render-pin tests, in which case the viewport
   * behaves exactly as before (empty-state until a Run).
   *
   * No `onSelect` is wired for this geometry — the kernel STL carries no
   * `userData.faceIds` parallel array, so face-pick stays a script-path feature
   * (honest: we don't fake a selectable surface we can't resolve).
   */
  readonly kernelViewportGeometry?: BufferGeometry | null
  /**
   * No-code build→render: `true` while the host's kernel build (`build_part.py`)
   * is in flight. Surfaced as a non-blocking "Building model…" overlay so the
   * operator sees the timeline edit is being applied. Optional — defaults to
   * `false`.
   */
  readonly kernelBuilding?: boolean
  /**
   * CAD V2 persistence -- the hydrated Drawings sheet state (dimensions + GD&T
   * frames + title block + annotations) the host loaded from `drawing.json`.
   * When SUPPLIED (host-controlled), the DrawingView renders THESE and every
   * change is folded + pushed up via {@link onDrawing} (which the host debounces
   * + persists). `null` means "host owns it but it has not hydrated yet" (render
   * the empty default). When the prop is OMITTED entirely the workspace falls
   * back to local in-state drawing edits (the legacy write-only behaviour the
   * SSR render-pins exercise). Documentation overlays only (Safety Rule 1).
   */
  readonly drawing?: DrawingViewState | null
  /**
   * CAD V2 persistence -- fired whenever the Drawings sheet changes (a placed
   * dimension, a GD&T frame, an edited title block). The host writes the result
   * to `drawing.json` (debounced). Only meaningful when {@link drawing} is
   * supplied (controlled mode). Optional + readonly (additive).
   */
  readonly onDrawing?: (next: DrawingViewState) => void
  // -- Drawings MULTI-SHEET seam (the tab strip) -----------------------------
  /**
   * The full ordered Drawings sheet set (id + name) for the tab strip. When
   * SUPPLIED (host-controlled, threaded from `session.drawingWorkspace.sheets`)
   * the DrawingView renders one tab per entry and reports add/rename/delete/switch
   * INTENT up through the callbacks below; the host owns the persisted sheet list
   * + re-points the single-sheet `drawing` at the active sheet so per-sheet
   * content swaps. When OMITTED the DrawingView shows ONE implicit fallback tab
   * (legacy single-sheet behaviour). Documentation overlays only (Safety Rule 1).
   */
  readonly drawingSheets?: readonly DrawingSheetTab[]
  /** Active Drawings sheet id (controlled). Falls back to the first sheet when unmatched. */
  readonly drawingActiveSheetId?: string
  /** Switch the active Drawings sheet (host re-points the per-sheet content). */
  readonly onDrawingSelectSheet?: (sheetId: string) => void
  /** Add a new Drawings sheet (host mints id + default name, persists it). */
  readonly onDrawingAddSheet?: () => void
  /** Rename a Drawings sheet (trimmed, non-empty enforced before this fires). */
  readonly onDrawingRenameSheet?: (sheetId: string, name: string) => void
  /** Delete a Drawings sheet (host keeps a minimum of one). */
  readonly onDrawingDeleteSheet?: (sheetId: string) => void
  /**
   * Placeable Drawings BOM rows the host derived via the engine
   * `deriveDrawingBom` seam (qty / name / source roll-up from the assembly or the
   * CAD design models). When SUPPLIED a BOM panel renders these; an EMPTY array
   * renders an honest empty state; OMITTED hides the panel entirely. Documentation
   * overlays only (Safety Rule 1).
   */
  readonly drawingBomLines?: readonly DrawingBomLine[]
  /**
   * Phase-3 named user parameters, threaded from the host's
   * `deriveUserParameterViews(session.design)` into the OPS FeatureTree in the
   * left browser (NOT the CadQuery-script params instance in the Properties
   * pane — those are sidecar script defaults, a different table). The shape is
   * structurally `UserParameterView`, so hosts pass the derived rows straight
   * through. Optional + additive: when all five are omitted (the splash
   * preview, every render-pin) the section does not render and the existing
   * Feature-Tree contract holds unchanged.
   */
  readonly userParameters?: ReadonlyArray<FeatureTreeUserParameter>
  /** Add a named parameter (`name = expression`). */
  readonly onUserParameterAdd?: (name: string, expression: string) => void
  /** Replace the named parameter's expression. */
  readonly onUserParameterEdit?: (name: string, expression: string) => void
  /** Rename a parameter (the session rewrites references in dependents). */
  readonly onUserParameterRename?: (from: string, to: string) => void
  /** Remove the named parameter. */
  readonly onUserParameterDelete?: (name: string) => void
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

/**
 * FG-3 — friendly label for a ribbon-armed sketch-tool catalog id (e.g.
 * `'sk_line'` → `'line'`). Resolves through the existing
 * `sketchToolForDesignCommand` map (the same map the host uses); falls back to
 * the raw id for ids the map does not cover (so the read-out is never blank).
 * Pure + module-level so it needs no hook.
 */
function sketchToolHint(commandId: string): string {
  // `sk_text` has no draw-tool mapping (it opens the Text dialog on the surface);
  // give it a friendly read-out instead of the raw catalog id.
  if (commandId === 'sk_text') return 'text'
  return sketchToolForDesignCommand(commandId) ?? commandId
}

export function DesignWorkspace({
  initialScript = '',
  onSave,
  onSendToCam,
  onToast,
  initialSelection = null,
  initialViewMode = 'part',
  initialAssemblyParts = [],
  initialAssemblyMates = [],
  onAssemblyPartsChange,
  initialAssemblyHandle = null,
  onMateAdded,
  kernelOps,
  rolledBackTo,
  onKernelMove,
  onKernelReorder,
  onKernelSuppressToggle,
  onKernelSetRollback,
  onKernelClearRollback,
  onKernelDelete,
  onAppendKernelOp,
  kernelOpsDisabled = false,
  sketchActive = false,
  onSketchExit,
  onSketchEnter,
  armedSketchTool = null,
  sketchDesign,
  onSketchDesignChange,
  onSketchImportDxf,
  requestedFeatureDialog = null,
  onFeatureDialogConsumed,
  requestedInspect = null,
  onInspectConsumed,
  sketchPlanePickArmed = false,
  onSketchPlanePicked,
  onCommandSurface,
  onSketchCursorWorld,
  onViewportPickPoint,
  kernelViewportGeometry = null,
  kernelBuilding = false,
  drawing,
  onDrawing,
  drawingSheets,
  drawingActiveSheetId,
  onDrawingSelectSheet,
  onDrawingAddSheet,
  onDrawingRenameSheet,
  onDrawingDeleteSheet,
  drawingBomLines,
  userParameters,
  onUserParameterAdd,
  onUserParameterEdit,
  onUserParameterRename,
  onUserParameterDelete,
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
  /**
   * CAD foundation — durable mate constraints (Model C) for the Assembly view.
   * Seeded from the host's hydrated `assembly.json` so a saved assembly shows
   * its mates after reload and the solver positions parts. Mutated when a part
   * is removed (its dangling mates are pruned so the picker + solver never see
   * a ref to a part that is gone).
   */
  const [assemblyMates, setAssemblyMates] =
    useState<readonly AssemblyMateConstraint[]>(initialAssemblyMates)
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
   * FG-5 · Which entity kind a plain viewport click picks: `'face'` (shell /
   * sketch-on-face) or `'edge'` (fillet / chamfer). Drives the cockpit's
   * face/edge toggle AND the `Viewport3D.selectionMode` prop. Switching modes
   * clears any active selection (a picked face is meaningless once the operator
   * is hunting edges, and vice versa) so the highlight never lies.
   */
  const [selectionMode, setSelectionModeState] = useState<SelectionKind>('face')
  const handleSelectionModeChange = useCallback((next: SelectionKind): void => {
    setSelectionModeState((prev) => {
      if (prev !== next) setSelectionState(clearSelection())
      return next
    })
  }, [])

  // ── FG-5 Inspect — measure + section-clip state (drives the mounted viewport) ─
  /**
   * Whether the viewport's built-in point-to-point measure tool is armed. Driven
   * by the ribbon's `runInspect('ut_measure')` (one-shot toggle) AND the cockpit
   * Inspect toggle below; mirrored back from `Viewport3D.onMeasureActiveChange`
   * so the viewport's own HUD button stays in sync (ESC inside the viewport
   * disarms it, which flows back here).
   */
  const [measureActive, setMeasureActive] = useState(false)
  /**
   * Whether the engineering section clip is on. When on, the workspace passes a
   * `sectionClipY` (the model's mid-height) to `Viewport3D` so geometry below
   * that world-Y plane is clipped away — the built-in section HUD the catalog
   * `ut_section` row promises. Toggled by `runInspect('ut_section')` + the
   * cockpit toggle.
   */
  const [sectionActive, setSectionActive] = useState(false)

  // ── Construct sketch-on-face — the picked face plane (readout + host capture) ─
  /**
   * The face plane the operator picked via `sk_choose_plane` (Construct →
   * Sketch on face). Captured on the viewport face-pick while
   * `sketchPlanePickArmed`; surfaced as a cockpit readout so the operator sees
   * which face their sketch is keyed to. `null` until a face is picked.
   */
  const [sketchFacePlane, setSketchFacePlane] = useState<{
    readonly origin: [number, number, number]
    readonly normal: [number, number, number]
    readonly xAxis: [number, number, number]
  } | null>(null)

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

  /**
   * Persisted, associative surface-texture symbols for the active part's sheet
   * (`sheet.annotations.surfaceFinishes`). Threaded into the DrawingView in
   * controlled mode so a placed symbol records its snapped feature's `refId` and
   * re-resolves against fresh geometry on every re-projection. Held here (not
   * inside DrawingView) so it survives view-tab switches and is the value a
   * future project-save writes into `drawing.json`. Documentation overlays only
   * — never read by CAM/G-code (Safety Rule 1). Mirrors {@link drawingGdtFrames}.
   */
  const [drawingSurfaceFinishes, setDrawingSurfaceFinishes] = useState<readonly SurfaceFinishSymbol[]>([])

  // ── Drawings persistence seam ──────────────────────────────────────────────
  //
  // CONTROLLED mode: the host (DesignWorkspaceHost → DesignSessionContext) supplies
  // the hydrated `drawing` state + an `onDrawing` sink it debounces to drawing.json.
  // We render dimensions / GD&T / title block from `drawing` and fold every change
  // back through `onDrawing`, so a placed dimension or an edited title block SURVIVES
  // reload + a Drawings↔other-route switch. UNCONTROLLED (prop omitted): fall back to
  // the legacy local state (the SSR render-pins + the splash preview exercise this).
  const drawingControlled = drawing !== undefined
  const effectiveDrawing = drawingControlled ? drawing ?? emptyDrawingViewState() : null
  const effectiveDrawingDimensions = effectiveDrawing
    ? effectiveDrawing.dimensions
    : drawingDimensions
  const effectiveDrawingGdtFrames = effectiveDrawing
    ? effectiveDrawing.featureControlFrames
    : drawingGdtFrames
  const effectiveDrawingSurfaceFinishes = effectiveDrawing
    ? effectiveDrawing.surfaceFinishes
    : drawingSurfaceFinishes
  const effectiveDrawingTitleBlock: DrawingTitleBlock | undefined = effectiveDrawing
    ? effectiveDrawing.titleBlock
    : undefined

  const handlePersistDrawingDimensions = useCallback(
    (next: readonly DrawingDimension[]): void => {
      if (drawingControlled) {
        const base = drawing ?? emptyDrawingViewState()
        onDrawing?.({ ...base, dimensions: next })
      } else {
        setDrawingDimensions(next)
      }
    },
    [drawingControlled, drawing, onDrawing],
  )
  const handlePersistDrawingGdt = useCallback(
    (next: readonly GdtFeatureControlFrame[]): void => {
      if (drawingControlled) {
        const base = drawing ?? emptyDrawingViewState()
        onDrawing?.({ ...base, featureControlFrames: next })
      } else {
        setDrawingGdtFrames(next)
      }
    },
    [drawingControlled, drawing, onDrawing],
  )
  const handlePersistDrawingSurfaceFinishes = useCallback(
    (next: readonly SurfaceFinishSymbol[]): void => {
      if (drawingControlled) {
        const base = drawing ?? emptyDrawingViewState()
        onDrawing?.({ ...base, surfaceFinishes: next })
      } else {
        setDrawingSurfaceFinishes(next)
      }
    },
    [drawingControlled, drawing, onDrawing],
  )
  const handlePersistDrawingTitleBlock = useCallback(
    (next: DrawingTitleBlock): void => {
      if (!drawingControlled) return
      const base = drawing ?? emptyDrawingViewState()
      onDrawing?.({ ...base, titleBlock: next })
    },
    [drawingControlled, drawing, onDrawing],
  )

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
  // codeOpen drives the CadQuery slide-over drawer (default CLOSED so the Part
  // view reads as a no-code cockpit). Local UI state with no sidecar side-effects.
  const [codeOpen, setCodeOpen] = useState(false)
  // Collapsible cockpit side panels — collapsing a panel narrows its grid column
  // (driven inline on `.dc-cockpit` below) so the viewport reclaims the width.
  // Sticky across remounts via localStorage (best-effort; no-ops under SSR/tests).
  const [browserCollapsed, setBrowserCollapsed] = useState<boolean>(() => {
    try {
      return globalThis.localStorage?.getItem('wt.design.browserCollapsed') === '1'
    } catch {
      return false
    }
  })
  const [propsCollapsed, setPropsCollapsed] = useState<boolean>(() => {
    try {
      return globalThis.localStorage?.getItem('wt.design.propsCollapsed') === '1'
    } catch {
      return false
    }
  })
  // The CadQuery code `</>` toggle is optional (the no-code cockpit can hide it). Persisted; default
  // shown so existing behaviour/pins hold (missing pref → shown).
  const [showCodeToggle, setShowCodeToggle] = useState<boolean>(() => {
    try {
      return globalThis.localStorage?.getItem('wt.design.showCodeToggle') !== '0'
    } catch {
      return true
    }
  })
  /**
   * FG-5b — which per-feature property dialog is open in the Properties pane,
   * or `null` for the picker (no dialog active). Local UI state; selecting a
   * feature does not touch the kernel until the operator clicks the dialog's
   * Apply. Only rendered when the host threads `onAppendKernelOp`.
   */
  const [activeFeatureDialog, setActiveFeatureDialog] =
    useState<FeatureDialogKind | null>(null)

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
      // #11 DISTINCT GEOMETRY — each added part references its OWN geometry
      // source, never a silent alias of `firstMesh.handle`.
      //   • When the last Run produced MULTIPLE bodies, the Nth add cycles to
      //     the Nth mesh so distinct bodies land as distinct parts (round-robin
      //     so adds beyond the body count still spread across the real meshes).
      //   • When only one body exists, the 2nd+ add is an honest distinct
      //     INSTANCE of that body (its own id + a non-overlapping offset
      //     transform), with `geometrySource` set to the body's handle so the
      //     persistence seam records WHICH body it is — not a fake new body.
      const meshes = lastTessellation?.meshes ?? []
      const sourceMesh = meshes.length > 0 ? meshes[prev.length % meshes.length] : firstMesh
      const handle = sourceMesh?.handle ?? firstMesh.handle
      // Stack instances along +X so two parts from one body do not overlap in
      // the viewport (the assembly solver can still move them via mates).
      const offsetX = prev.length * ASSEMBLY_PART_OFFSET_MM
      const position: readonly [number, number, number] = [offsetX, 0, 0]
      const next: AssemblyPart = {
        id: `part-${Date.now().toString(36)}-${idx}`,
        name: `Part ${idx}`,
        handle,
        // Durable geometry identity: the body's handle is the source token even
        // when it is the SAME body as a sibling instance (distinct instance,
        // shared source — documented, never silently aliased).
        geometrySource: handle,
        transform: offsetX !== 0 ? { position } : undefined,
        transformSummary: offsetX !== 0 ? `@(${offsetX}, 0, 0)` : 'identity',
      }
      return [...prev, next]
    })
  }, [firstMesh, lastTessellation, toast])

  const handleRemoveAssemblyPart = useCallback((id: string): void => {
    setAssemblyParts((prev) => prev.filter((p) => p.id !== id))
    // Prune any mate that referenced the removed part so the solver + the mate
    // pickers never see a dangling part ref (the row is gone, the constraint
    // would be unsolvable). Idempotent: a part with no mates leaves this a no-op.
    setAssemblyMates((prev) =>
      prev.filter((m) => m.part1Id !== id && m.part2Id !== id),
    )
  }, [])

  /**
   * CAD foundation (#8) — persist the parts list whenever it changes so the
   * rows land in `assembly.json` `components` and a mate's part refs resolve.
   * The host (DesignWorkspaceHost) folds the rows via `partsToComponents` and
   * writes them. Skipped entirely when the host did not wire the callback (the
   * splash preview, the render-pin tests). Guarded by a ref so a re-created
   * callback identity never re-fires the persist on an unchanged parts list.
   */
  /**
   * Apply the mate solver's solved poses (forwarded from {@link AssemblyView} after a successful
   * `assembly:solve`) back onto the live part rows so the assembly re-renders at the solved
   * placements — the apply-back that closes the "solver runs but parts never move" gap. The
   * `onAssemblyPartsChange` effect below then persists the new poses. `applySolvedTransforms`
   * returns the SAME list reference when nothing changed, so a no-transform solve is a no-op.
   */
  const handleSolvedTransforms = useCallback(
    (solved: ReadonlyArray<SolvedComponentTransform>): void => {
      setAssemblyParts((prev) => applySolvedTransforms(prev, solved))
    },
    []
  )

  const onAssemblyPartsChangeRef = useRef(onAssemblyPartsChange)
  onAssemblyPartsChangeRef.current = onAssemblyPartsChange
  const assemblyPartsDidMount = useRef(false)
  useEffect(() => {
    // Skip the mount pass: the initial list came FROM the host (hydrate /
    // initialAssemblyParts), so echoing it straight back would be a redundant
    // write. Only operator-driven add/remove after mount should persist.
    if (!assemblyPartsDidMount.current) {
      assemblyPartsDidMount.current = true
      return
    }
    onAssemblyPartsChangeRef.current?.(assemblyParts)
  }, [assemblyParts])

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

  // ── FG-3 — sketch mode (drives the center-pane swap + contextual ribbon) ────
  /**
   * Effective sketch mode for the Part view. Mirrors the host-supplied
   * `sketchActive` prop. Only the Part view honors it (Assembly/Drawing own
   * their own bodies).
   */
  const sketchMode = sketchActive === true

  // ── FG-5 — open a feature dialog requested by the ribbon's Solid commands ───
  // `requestedFeatureDialog` is a one-shot from the host; when it lands, open
  // that dialog and acknowledge so the host can clear the request. Guard on the
  // value so re-renders with the same (already-consumed) request don't reopen a
  // dialog the operator just closed.
  useEffect(() => {
    if (requestedFeatureDialog === null) return
    setActiveFeatureDialog(requestedFeatureDialog)
    onFeatureDialogConsumed?.()
  }, [requestedFeatureDialog, onFeatureDialogConsumed])

  // ── FG-5 Inspect — open a measure/section request from the ribbon ───────────
  // `requestedInspect` is a one-shot from the host; when it lands, TOGGLE the
  // matching viewport mode (so a second dispatch turns it off — the Fusion
  // behavior) and acknowledge so the host can clear the request. Toggling
  // measure ON also drops section, and vice versa, so the two inspect overlays
  // never fight each other on the same viewport.
  useEffect(() => {
    if (requestedInspect === null) return
    if (requestedInspect === 'ut_measure') {
      setMeasureActive((on) => {
        const next = !on
        if (next) setSectionActive(false)
        return next
      })
    } else if (requestedInspect === 'ut_section') {
      setSectionActive((on) => {
        const next = !on
        if (next) setMeasureActive(false)
        return next
      })
    }
    onInspectConsumed?.()
  }, [requestedInspect, onInspectConsumed])

  // ── FG-1/FG-3 — push the combined command surface up to the Context Engine ──
  // selection ∪ sketchMode, in ONE push, so the provider's single `setSurface`
  // cell carries both (a selection-only push would clobber sketchMode and vice
  // versa). The provider de-dupes by field equality, so identical pushes are
  // cheap. Skipped entirely when the host did not wire `onCommandSurface` (the
  // splash preview + render-pin tests render DesignWorkspace provider-less).
  useEffect(() => {
    if (!onCommandSurface) return
    const base = selectionToSurface(selection)
    onCommandSurface({
      hasSelection: base.hasSelection,
      selectionKind: base.selectionKind,
      sketchMode
    })
  }, [onCommandSurface, selection, sketchMode])

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
    if (selection.kind === 'edge') {
      // FG-5: the edgeMap is keyed by the STABLE edge id (occtHash on the
      // selection), NOT by the ordinal — so look up the length via occtHash.
      const entry =
        selection.occtHash != null
          ? selectionTessellation?.edgeMap?.[selection.occtHash]
          : undefined
      if (entry?.length && Number.isFinite(entry.length)) {
        return `Edge ${selection.faceId} · ${entry.length.toFixed(1)} mm`
      }
      return `Edge ${selection.faceId}`
    }
    return `Vertex ${selection.faceId}`
  }, [selection, selectionTessellation])

  /**
   * FG-2 — the live `THREE.BufferGeometry` handed to the mounted
   * `Viewport3D`. Built from the selection-grade tessellation
   * (`cad.tessellate_with_ids`, held in `selectionTessellation`) so the
   * viewport's face-pick can resolve a triangle to a face id via the
   * `userData.faceIds` parallel array. `null` until the first successful
   * Run — the center pane then shows the empty-state instead of mounting
   * an empty WebGL canvas. Disposal is owned by `Viewport3D` (its internal
   * `stable` memo disposes the previous geometry when this value changes),
   * so the workspace must NOT also dispose it here (double-free).
   */
  const viewportGeometry = useMemo(
    () => buildViewportGeometry(selectionTessellation),
    [selectionTessellation],
  )

  /**
   * No-code build→render — the geometry the cockpit viewport actually mounts.
   * A freshly-Run CadQuery script result (`viewportGeometry`, which carries the
   * `userData.faceIds` for face-pick) takes priority so the code path is
   * unchanged; otherwise we fall back to the host session's kernel-built solid
   * (`kernelViewportGeometry`) so adding a no-code feature actually displays the
   * model. `null` → the empty-state shows (no model built yet either way).
   *
   * Face/edge picking gates on CAPABILITY, not source (task_f76b39b3): a
   * script tessellation AND a pick-tagged no-code kernel mesh (rebuilt from
   * `output/kernel-part.pick.json`) both carry `faceIds` / `pickableEdges`
   * userData; a legacy untagged kernel STL stays honestly unpickable.
   */
  const displayedViewportGeometry: BufferGeometry | null =
    viewportGeometry ?? kernelViewportGeometry
  const displayedPickUserData = displayedViewportGeometry?.userData as
    | Record<string, unknown>
    | undefined
  const pickableGeometryActive = Boolean(
    displayedPickUserData &&
      (Array.isArray(displayedPickUserData.faceIds) ||
        Array.isArray(displayedPickUserData.pickableEdges))
  )

  /**
   * FG-5 Inspect — the world-Y plane the section clip cuts at when
   * `sectionActive`. Sits at the displayed model's mid-height (so the cut bites
   * into the body, not above/below it). `null` when section is off OR there is
   * no geometry — `Viewport3D` treats a null/non-finite `sectionClipY` as "no
   * clip", so the viewport renders whole.
   */
  const sectionClipY = useMemo<number | null>(() => {
    if (!sectionActive || displayedViewportGeometry === null) return null
    const { min, max } = worldYRangeFromExtrudeMeshGeometry(displayedViewportGeometry)
    return (min + max) / 2
  }, [sectionActive, displayedViewportGeometry])

  /**
   * Construct sketch-on-face — `true` while the viewport should accept a face
   * pick to choose the sketch plane. Gated on ANY displayed geometry (the
   * face-pick reads the face origin/normal straight off the Three.js click — it
   * does NOT need the kernel faceIds stash that `onSelect` requires, so the
   * no-code kernel solid works too) AND not already in sketch mode. When armed,
   * `Viewport3D.facePickMode` is enabled and a plain face click routes to
   * {@link handleSketchPlaneFacePick} instead of selection.
   */
  const facePickForSketchActive =
    sketchPlanePickArmed === true && displayedViewportGeometry !== null && !sketchMode

  /**
   * Construct sketch-on-face — the operator clicked a face while arming the
   * sketch plane. Capture the face plane basis (origin / normal / xAxis the
   * viewport derives from the pick), enter sketch mode, surface the plane as a
   * readout, and hand the plane to the host. The picked basis matches the
   * `sketchPlane = { kind: 'face', origin, normal, xAxis }` shape `build_part.py`
   * consumes for face-plane placement, so a future session wire is a drop-in.
   */
  const handleSketchPlaneFacePick = useCallback(
    (pick: {
      origin: [number, number, number]
      normal: [number, number, number]
      xAxis: [number, number, number]
    }): void => {
      setSketchFacePlane(pick)
      onSketchPlanePicked?.(pick)
      onSketchEnter?.()
      toast('ok', 'Sketch plane set to the picked face.')
    },
    [onSketchPlanePicked, onSketchEnter, toast],
  )

  // Leaving sketch mode clears the captured face plane so a stale readout never
  // lingers into the next sketch.
  useEffect(() => {
    if (!sketchMode) setSketchFacePlane(null)
  }, [sketchMode])

  // ── FG-5b — per-feature property dialogs ──────────────────────────────────
  /**
   * Tier-2 · Index of the CURRENT build's pickable entities (id → signature),
   * built from the live selection-grade tessellation. Handed to the feature
   * dialogs so `resolvePickedSelectionId` can resolve a picked id+signature
   * against the current geometry — recovering a pick that MOVED / UNIFORMLY
   * RESIZED upstream (Tier 2) instead of emitting a now-dead id. Rebuilt only
   * when the tessellation changes.
   */
  const currentPickIndex = useMemo(
    () => buildPickIndex(selectionTessellation),
    [selectionTessellation],
  )

  /**
   * Selection context handed to the active feature dialog. Reuses the same
   * `selection` cell + the already-computed `selectionLabel` so the dialog's
   * picked-edge read-out and the bottom-center status chip always agree, plus
   * the Tier-2 `currentPickIndex` so the picked-edge consumers route through the
   * tiered resolver.
   */
  const featureDialogSelectionInfo = useMemo(
    () => ({ selection, label: selectionLabel, currentPickIndex }),
    [selection, selectionLabel, currentPickIndex],
  )

  /**
   * FG-5 — the dialog that should render NOW: the locally-armed picker choice,
   * OR the ribbon's one-shot `requestedFeatureDialog` when nothing is locally
   * armed yet. The fallback makes a ribbon request render on the FIRST pass
   * (the open-on-request `useEffect` only commits it to `activeFeatureDialog`
   * after a render cycle, and effects do not run under SSR); the picker active
   * state + the spec both read this so they always agree.
   */
  const effectiveFeatureDialog: FeatureDialogKind | null =
    activeFeatureDialog ?? requestedFeatureDialog

  /**
   * Seed the active dialog with sensible starting params. Extrude/Revolve read
   * the declared script parameter's current value when present (so the dialog
   * opens on the live value, not a hard-coded guess); the kernel-op dialogs
   * (fillet/chamfer/shell/hole) open on conservative defaults the operator then
   * tunes. `null` when no dialog is active.
   */
  // Sketch-derived picker options for the selection-heavy feature dialogs (Press/Pull, Sweep, …).
  const sketchProfiles = useMemo(() => profileOptions(sketchDesign), [sketchDesign])
  const sketchPaths = useMemo(() => pathOptions(sketchDesign), [sketchDesign])

  const featureDialogSpec: FeatureDialogSpec | null = useMemo(() => {
    if (effectiveFeatureDialog === null) return null
    const numericParam = (name: string): number | undefined => {
      const p = parameters.find((row) => row.name === name && row.kind === 'number')
      return p && typeof p.value === 'number' ? p.value : undefined
    }
    switch (effectiveFeatureDialog) {
      case 'extrude':
        return {
          kind: 'extrude',
          params: { depthMm: numericParam('extrudeDepthMm') ?? 10 },
        }
      case 'revolve':
        return {
          kind: 'revolve',
          params: { angleDeg: numericParam('revolveAngleDeg') ?? 360 },
        }
      case 'fillet':
        return { kind: 'fillet', params: { radiusMm: 2, mode: 'all' } }
      case 'chamfer':
        return { kind: 'chamfer', params: { lengthMm: 1, mode: 'all' } }
      case 'shell':
        return { kind: 'shell', params: { thicknessMm: 2, openDirection: '+Z' } }
      case 'hole':
        return {
          kind: 'hole',
          params: { profileIndex: 0, mode: 'through_all', depthMm: 10, zStartMm: 0 },
        }
      case 'datum_plane':
        return { kind: 'datum_plane', params: { basePlane: 'XY', offsetMm: 0 } }
      case 'datum_axis':
        return { kind: 'datum_axis', params: { axis: 'Z', originXMm: 0, originYMm: 0, originZMm: 0 } }
      case 'datum_point':
        return { kind: 'datum_point', params: { xMm: 0, yMm: 0, zMm: 0 } }
      case 'transform_translate':
        return { kind: 'transform_translate', params: { dxMm: 0, dyMm: 0, dzMm: 0, mode: 'move' } }
      case 'mirror_union_plane':
        return {
          kind: 'mirror_union_plane',
          params: { plane: 'YZ', originXMm: 0, originYMm: 0, originZMm: 0 },
        }
      case 'split_keep_halfspace':
        return { kind: 'split_keep_halfspace', params: { axis: 'Z', offsetMm: 0, keep: 'positive' } }
      case 'pattern_rectangular':
        return {
          kind: 'pattern_rectangular',
          params: { countX: 2, countY: 1, spacingXMm: 20, spacingYMm: 20 },
        }
      case 'pattern_circular':
        return {
          kind: 'pattern_circular',
          params: { count: 4, centerXMm: 0, centerYMm: 0, startAngleDeg: 0, totalAngleDeg: 360 },
        }
      case 'pattern_linear_3d':
        return { kind: 'pattern_linear_3d', params: { count: 3, dxMm: 10, dyMm: 0, dzMm: 0 } }
      case 'boolean_union_box':
        return {
          kind: 'boolean_union_box',
          params: { xMinMm: 0, xMaxMm: 10, yMinMm: 0, yMaxMm: 10, zMinMm: 0, zMaxMm: 10 },
        }
      case 'boolean_subtract_box':
        return {
          kind: 'boolean_subtract_box',
          params: { xMinMm: 0, xMaxMm: 10, yMinMm: 0, yMaxMm: 10, zMinMm: 0, zMaxMm: 10 },
        }
      case 'boolean_intersect_box':
        return {
          kind: 'boolean_intersect_box',
          params: { xMinMm: -10, xMaxMm: 10, yMinMm: -10, yMaxMm: 10, zMinMm: 0, zMaxMm: 20 },
        }
      case 'boolean_subtract_cylinder':
        return {
          kind: 'boolean_subtract_cylinder',
          params: { centerXMm: 0, centerYMm: 0, radiusMm: 5, zMinMm: 0, zMaxMm: 10 },
        }
      case 'thread_wizard':
        return {
          kind: 'thread_wizard',
          params: {
            centerXMm: 0,
            centerYMm: 0,
            majorRadiusMm: 8,
            pitchMm: 1.25,
            lengthMm: 20,
            depthMm: 0.8,
            zStartMm: 0,
            hand: 'right',
            mode: 'modeled',
            standard: 'ISO',
            designation: 'M',
            class: '6g',
            starts: 1,
          },
        }
      case 'thicken_offset':
        return { kind: 'thicken_offset', params: { distanceMm: 2, side: 'outward' } }
      case 'coil_cut':
        return {
          kind: 'coil_cut',
          params: {
            centerXMm: 0,
            centerYMm: 0,
            majorRadiusMm: 10,
            pitchMm: 2,
            turns: 5,
            depthMm: 1,
            zStartMm: 0,
          },
        }
      case 'plastic_rule_fillet':
        return { kind: 'plastic_rule_fillet', params: { radiusMm: 2 } }
      case 'plastic_boss':
        return {
          kind: 'plastic_boss',
          params: {
            centerXMm: 0,
            centerYMm: 0,
            zBaseMm: 0,
            outerRadiusMm: 5,
            heightMm: 8,
            draftDeg: 1,
          },
        }
      case 'plastic_lip_groove':
        return {
          kind: 'plastic_lip_groove',
          params: { mode: 'lip', xMinMm: 0, xMaxMm: 50, yMinMm: 0, yMaxMm: 30, zBaseMm: 10, depthMm: 2 },
        }
      case 'press_pull_profile':
        return { kind: 'press_pull_profile', params: { profileIndex: 0, deltaMm: 5, zStartMm: 0 } }
      case 'boolean_combine_profile':
        return {
          kind: 'boolean_combine_profile',
          params: { mode: 'union', extrudeDepthMm: 5, zStartMm: 0 },
        }
      case 'pipe_path':
        return {
          kind: 'pipe_path',
          params: { outerRadiusMm: 5, zStartMm: 0, orientationMode: 'frenet' },
        }
      case 'pattern_path':
        return {
          kind: 'pattern_path',
          params: { count: 4, closedPath: false, alignToPathTangent: false },
        }
      case 'sweep_profile_path_true':
        return {
          kind: 'sweep_profile_path_true',
          params: { zStartMm: 0, orientationMode: 'frenet' },
        }
      default: {
        const _never: never = effectiveFeatureDialog
        void _never
        return null
      }
    }
  }, [effectiveFeatureDialog, parameters])

  /**
   * Kernel-op sink for the dialogs. Delegates to the host's `onAppendKernelOp`
   * (the session's `appendKernelOp`). On success we toast + leave the dialog
   * open so the operator can stack another op of the same kind.
   */
  const handleFeatureKernelOp = useCallback(
    (op: KernelPostSolidOp): void => {
      if (!onAppendKernelOp) return
      onAppendKernelOp(op)
    },
    [onAppendKernelOp],
  )

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

  // ── FG-6 — view-mode tab bar REMOVED (de-duped into the shell). ────────────
  // The shell `WorkspaceNav` (Design · Assemble · Drawings) + the FG-4 ribbon's
  // view switching now own moving between Part / Assembly / Drawing — having an
  // in-workspace tab bar too was the divergent third UX model the FG-6 audit
  // flagged. `activeView` is still driven by `initialViewMode` (the route maps
  // `design`→part, `assemble`→assembly, `drawings`→drawing in `WorkspaceHost`),
  // so each route lands on the right body; the workspace just no longer paints
  // its own redundant tab strip. `setActiveView` stays the seed sink.

  // ── Empty-state branch (no script yet) ────────────────────────────────────
  // Only triggers in Part view — when the operator has switched to
  // Assembly or Drawing they should land on those views regardless of
  // whether a script has been typed (the assembly/drawing surfaces own
  // their OWN empty-state UX).
  if (activeView === 'part' && scriptText.trim().length === 0 && !lastTessellation) {
    return (
      <div className="design-workspace" data-testid="design-workspace-empty">
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
        <div
          className="design-workspace__view-panel design-workspace__view-panel--assembly"
          role="tabpanel"
          id="design-workspace-panel-assembly"
          aria-label="Assembly"
        >
          <AssemblyView
            parts={assemblyParts}
            mateConstraints={assemblyMates}
            onAddPart={handleAddPartToAssembly}
            onRemovePart={handleRemoveAssemblyPart}
            onAssemblyHandle={setAssemblyHandle}
            onSolvedTransforms={handleSolvedTransforms}
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
        <div
          className="design-workspace__view-panel"
          role="tabpanel"
          id="design-workspace-panel-drawing"
          aria-label="Drawing"
        >
          <DrawingView
            partHandle={activePartHandle}
            onExport={handleExportDrawing}
            onToast={onToast}
            persistedDimensions={effectiveDrawingDimensions}
            onPersistDimensions={handlePersistDrawingDimensions}
            persistedGdtFrames={effectiveDrawingGdtFrames}
            onPersistGdt={handlePersistDrawingGdt}
            persistedSurfaceFinishes={effectiveDrawingSurfaceFinishes}
            onPersistSurfaceFinishes={handlePersistDrawingSurfaceFinishes}
            initialTitleBlock={effectiveDrawingTitleBlock}
            onPersistTitleBlock={
              drawingControlled ? handlePersistDrawingTitleBlock : undefined
            }
            onDetail={handleDetailView}
            // Multi-sheet tab strip — controlled by the host (session workspace).
            // When omitted the DrawingView shows one implicit fallback tab.
            sheets={drawingSheets}
            activeSheetId={drawingActiveSheetId}
            onSelectSheet={onDrawingSelectSheet}
            onAddSheet={onDrawingAddSheet}
            onRenameSheet={onDrawingRenameSheet}
            onDeleteSheet={onDrawingDeleteSheet}
            // Placeable BOM rows derived via the engine deriveDrawingBom seam.
            bomLines={drawingBomLines}
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
      <div
        className="dc-cockpit"
        style={{
          gridTemplateColumns: `${browserCollapsed ? '34px' : '280px'} 1fr ${propsCollapsed ? '34px' : '300px'}`
        }}
      >
        {/* LEFT — Feature-tree browser */}
        <aside
          className={browserCollapsed ? 'dc-browser dc-browser--collapsed' : 'dc-browser'}
          aria-label="Feature tree"
        >
          <div className="dc-panel-head">
            {!browserCollapsed && <span className="dc-panel-head__label">Feature Tree</span>}
            <button
              type="button"
              className="dc-collapse-btn"
              data-testid="dc-browser-collapse"
              aria-expanded={!browserCollapsed}
              aria-label={browserCollapsed ? 'Expand Feature Tree panel' : 'Collapse Feature Tree panel'}
              title={browserCollapsed ? 'Expand Feature Tree' : 'Collapse Feature Tree'}
              onClick={() =>
                setBrowserCollapsed((v) => {
                  const next = !v
                  try {
                    globalThis.localStorage?.setItem('wt.design.browserCollapsed', next ? '1' : '0')
                  } catch {
                    /* best-effort */
                  }
                  return next
                })
              }
            >
              {browserCollapsed ? '›' : '‹'}
            </button>
          </div>
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
                userParameters={userParameters}
                onUserParameterAdd={onUserParameterAdd}
                onUserParameterEdit={onUserParameterEdit}
                onUserParameterRename={onUserParameterRename}
                onUserParameterDelete={onUserParameterDelete}
                kernelOps={kernelOps}
                rolledBackTo={rolledBackTo}
                onKernelMove={onKernelMove}
                onKernelReorder={onKernelReorder}
                onKernelSuppressToggle={onKernelSuppressToggle}
                onKernelSetRollback={onKernelSetRollback}
                onKernelClearRollback={onKernelClearRollback}
                onKernelDelete={onKernelDelete}
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
            codeOpen={codeOpen}
            onToggleCode={() => setCodeOpen((open) => !open)}
            showCodeToggle={showCodeToggle}
          />
          {/*
            FG-2 — the real Three.js viewport. `Viewport3D` brings its own
            orbit/pan/zoom + viewcube + triad + standard-view HUD + measure
            tool, so the decorative chrome that used to live in `ViewportChrome`
            was trimmed to avoid duplicating any of those. We mount it ONLY
            once a geometry exists (after a successful Run) so a cold/SSR render
            never instantiates an empty WebGL canvas; the empty-state surface
            covers the no-model case. `firstMesh` gates the build summary that
            previously rendered here — now it just guards the same "have a
            model?" question that `viewportGeometry` answers.
          */}
          {sketchMode ? (
            /*
              Wave 3e (keystone unlock) — the mounted 2D sketcher.

              When the host threads the live session model (`sketchDesign` +
              `onSketchDesignChange`, which `DesignWorkspaceHost` fills from
              `session.design` / `session.onDesignChange`), we mount the
              SESSION-PERSISTED `SketchSurface`: a drawn vector dispatches into the
              design model, so it survives `manufacture:save` + reload and a
              Sketch↔Model stage switch. `SketchSurface` carries its OWN tool
              palette + snap toggle, and the legacy canvas it wraps brings the
              numeric dimension popovers — so the ribbon's `armSketchTool` actually
              pre-selects the matching palette tool (passed as `armedToolCommandId`).

              Without the session props (the splash preview + render-pin tests), we
              fall back to the self-contained `MvpSketchCanvas`: it owns its tool
              palette, the planegcs/local solver, undo/redo, AND the DOF badge
              (`selectDofBadgeView` honesty contract). Its entity state lives in its
              own reducer (it does NOT persist) — acceptable for the preview, and it
              keeps every existing FG-3 render-pin holding.
            */
            <div
              className="design-workspace__sketch-host"
              data-testid="design-workspace-sketch-host"
            >
              {armedSketchTool !== null && (
                <div
                  className="design-workspace__sketch-armed"
                  role="status"
                  aria-live="polite"
                  data-testid="design-workspace-sketch-armed"
                >
                  Ribbon armed: <strong>{sketchToolHint(armedSketchTool)}</strong>
                  {sketchDesign && onSketchDesignChange
                    ? ' — selected in the sketch palette.'
                    : ' — pick the matching tool in the sketcher palette.'}
                </div>
              )}
              {sketchDesign && onSketchDesignChange ? (
                <SketchSurface
                  design={sketchDesign}
                  onDesignChange={onSketchDesignChange}
                  onImportDxf={onSketchImportDxf}
                  armedToolCommandId={armedSketchTool}
                  onSketchHint={(msg) => onToast?.('ok', msg)}
                  onCursorWorld={onSketchCursorWorld}
                  planeLabel={
                    sketchFacePlane !== null
                      ? `Face @ (${sketchFacePlane.origin.map((c) => c.toFixed(0)).join(', ')})`
                      : 'XY datum'
                  }
                />
              ) : (
                <MvpSketchCanvas />
              )}
              {onSketchExit && (
                <div className="design-workspace__sketch-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    data-testid="design-workspace-sketch-finish"
                    onClick={onSketchExit}
                  >
                    Finish sketch
                  </button>
                </div>
              )}
            </div>
          ) : displayedViewportGeometry ? (
            <Viewport3D
              geometry={displayedViewportGeometry}
              // Face/edge-pick only against the script-path geometry (it carries
              // the userData.faceIds + pickableEdges the picker resolves). The
              // no-code kernel STL has neither, so we don't wire a selectable
              // surface we can't map back. While arming the sketch plane the
              // face click is consumed by `onPickFace` (sketch-on-face), so we
              // suppress `onSelect` to avoid double-handling the same click.
              onSelect={
                pickableGeometryActive && !facePickForSketchActive
                  ? handleViewportSelect
                  : undefined
              }
              // Wave 3n — the viewport reports the raycast point ONLY for a
              // registered pick (gated inside Viewport3D on onSelect), so this
              // can be threaded unconditionally.
              onPickPoint={onViewportPickPoint}
              selectionMode={selectionMode}
              // Construct sketch-on-face: a plain face click chooses the sketch
              // plane (origin/normal/xAxis) while armed via `sk_choose_plane`.
              facePickMode={facePickForSketchActive}
              onPickFace={facePickForSketchActive ? handleSketchPlaneFacePick : undefined}
              // FG-5 Inspect: controlled measure-tool activation (ribbon
              // `ut_measure`) + section clip (`ut_section`); mirrored back so the
              // viewport's own HUD button + the cockpit toggle stay in sync.
              measureActive={measureActive}
              onMeasureActiveChange={setMeasureActive}
              sectionClipY={sectionClipY}
              highlightedFaceId={
                pickableGeometryActive && selection?.kind === 'face'
                  ? selection.faceId
                  : null
              }
              highlightedEdgeId={
                pickableGeometryActive && selection?.kind === 'edge'
                  ? selection.faceId
                  : null
              }
            />
          ) : (
            <EmptyState
              testId="design-workspace-viewport-empty"
              title="Build a model to see it here"
              body="Sketch a profile and add a feature (extrude, fillet…), or open the code drawer to write a CadQuery script — your built model appears here."
            />
          )}
          {/*
            No-code build→render — non-blocking "Building model…" overlay while
            the host session's kernel build (build_part.py) is in flight after a
            timeline edit. Honest progress cue: the operator sees the feature is
            being applied rather than wondering if the click did nothing.
          */}
          {kernelBuilding && (
            <div
              className="design-workspace__build-indicator"
              role="status"
              aria-live="polite"
              data-testid="design-workspace-build-indicator"
            >
              Building model…
            </div>
          )}
          {/*
            FG-5 — face/edge selection-mode toggle. Picks what a plain viewport
            click selects: faces (shell / sketch-on-face) or edges (fillet /
            chamfer). Shown whenever the mounted geometry carries pick data --
            a script tessellation OR a pick-tagged no-code kernel mesh. Anchored
            top-center so it never fights the bottom-center selection chip.
          */}
          {pickableGeometryActive && !sketchMode && (
            <div
              className="design-workspace__selection-mode"
              role="group"
              aria-label="Selection mode"
              data-testid="design-workspace-selection-mode"
            >
              <button
                type="button"
                className={`design-workspace__selection-mode-btn${selectionMode === 'face' ? ' design-workspace__selection-mode-btn--active' : ''}`}
                aria-pressed={selectionMode === 'face'}
                onClick={() => handleSelectionModeChange('face')}
                title="Select faces (shell, sketch on face)"
                data-testid="design-workspace-selection-mode-face"
              >
                Faces
              </button>
              <button
                type="button"
                className={`design-workspace__selection-mode-btn${selectionMode === 'edge' ? ' design-workspace__selection-mode-btn--active' : ''}`}
                aria-pressed={selectionMode === 'edge'}
                onClick={() => handleSelectionModeChange('edge')}
                title="Select edges (fillet, chamfer)"
                data-testid="design-workspace-selection-mode-edge"
              >
                Edges
              </button>
            </div>
          )}
          {/*
            FG-5 Inspect — Measure / Section toggles. The same `measureActive` /
            `sectionActive` state the ribbon's `ut_measure` / `ut_section`
            commands drive, surfaced in-cockpit so Inspect is reachable both from
            the ribbon AND the viewport. Mounted whenever a model is displayed
            (measure/section need geometry); hidden in sketch mode (the sketcher
            owns the center pane then).
          */}
          {displayedViewportGeometry && !sketchMode && (
            <div
              className="design-workspace__inspect-tools"
              role="group"
              aria-label="Inspect"
              data-testid="design-workspace-inspect-tools"
            >
              <button
                type="button"
                className={`design-workspace__inspect-btn${measureActive ? ' design-workspace__inspect-btn--active' : ''}`}
                aria-pressed={measureActive}
                onClick={() =>
                  setMeasureActive((on) => {
                    const next = !on
                    if (next) setSectionActive(false)
                    return next
                  })
                }
                title="Measure — Shift+click two points on the model"
                data-testid="design-workspace-inspect-measure"
              >
                Measure
              </button>
              <button
                type="button"
                className={`design-workspace__inspect-btn${sectionActive ? ' design-workspace__inspect-btn--active' : ''}`}
                aria-pressed={sectionActive}
                onClick={() =>
                  setSectionActive((on) => {
                    const next = !on
                    if (next) setMeasureActive(false)
                    return next
                  })
                }
                title="Section — clip the model at its mid-height (world Y)"
                data-testid="design-workspace-inspect-section"
              >
                Section
              </button>
            </div>
          )}
          {/*
            Construct sketch-on-face — honest prompt while arming the sketch
            plane (the operator dispatched `sk_choose_plane`): click a face to
            choose it. Once a face is picked the readout shows the chosen plane
            (and the workspace has entered sketch mode).
          */}
          {facePickForSketchActive && (
            <div
              className="design-workspace__sketch-plane-prompt"
              role="status"
              aria-live="polite"
              data-testid="design-workspace-sketch-plane-prompt"
            >
              Click a face to start a sketch on its plane.
            </div>
          )}
          {sketchMode && sketchFacePlane !== null && (
            <div
              className="design-workspace__sketch-plane-readout"
              role="status"
              aria-live="polite"
              data-testid="design-workspace-sketch-plane-readout"
            >
              Sketch plane: face at ({sketchFacePlane.origin.map((c) => c.toFixed(1)).join(', ')})
            </div>
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
          className={
            propsCollapsed
              ? 'design-workspace__tree-col dc-props dc-props--collapsed'
              : 'design-workspace__tree-col dc-props'
          }
          aria-label="Properties"
        >
          <div className="dc-panel-head">
            {!propsCollapsed && <span className="dc-panel-head__label">Properties</span>}
            <button
              type="button"
              className="dc-collapse-btn"
              data-testid="dc-props-collapse"
              aria-expanded={!propsCollapsed}
              aria-label={propsCollapsed ? 'Expand Properties panel' : 'Collapse Properties panel'}
              title={propsCollapsed ? 'Expand Properties' : 'Collapse Properties'}
              onClick={() =>
                setPropsCollapsed((v) => {
                  const next = !v
                  try {
                    globalThis.localStorage?.setItem('wt.design.propsCollapsed', next ? '1' : '0')
                  } catch {
                    /* best-effort */
                  }
                  return next
                })
              }
            >
              {propsCollapsed ? '‹' : '›'}
            </button>
          </div>
          <div className="dc-props-body">
            <label
              className="dc-prop-card"
              data-testid="design-workspace-show-code-pref"
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', cursor: 'pointer' }}
            >
              <input
                type="checkbox"
                checked={showCodeToggle}
                onChange={(e) => {
                  const next = e.target.checked
                  setShowCodeToggle(next)
                  if (!next) setCodeOpen(false)
                  try {
                    globalThis.localStorage?.setItem('wt.design.showCodeToggle', next ? '1' : '0')
                  } catch {
                    /* best-effort */
                  }
                }}
              />
              Show CadQuery code button
            </label>
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

            {/*
              FG-5b — per-feature property dialog. Opened from the Design ribbon's
              Solid / Construct commands (`openFeatureDialog` → `requestedFeatureDialog`
              → `activeFeatureDialog`); the in-panel 6-way picker was retired as a
              redundant launcher. Only rendered when the host threads `onAppendKernelOp`
              (a live session) AND a dialog is actually open, so the splash preview +
              the prop-less render pins still never see it. The header ✕ closes the
              dialog (the picker used to be the only dismissal). Applies through the
              existing kernel-op append (fillet/chamfer/shell/hole) or script-param
              rebuild (extrude/revolve) paths.
            */}
            {onAppendKernelOp && featureDialogSpec !== null && (
              <div
                className="dc-prop-card design-workspace__feature-dialogs"
                data-testid="design-workspace-feature-dialogs"
              >
                <div className="design-workspace__feature-dialog-head">
                  <h3 className="dc-prop-card-title">Feature</h3>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm design-workspace__feature-dialog-close"
                    data-testid="design-workspace-feature-dialog-close"
                    aria-label="Close feature dialog"
                    onClick={() => setActiveFeatureDialog(null)}
                  >
                    ✕
                  </button>
                </div>
                <FeatureDialogHost
                  spec={featureDialogSpec}
                  selectionInfo={featureDialogSelectionInfo}
                  onAppendKernelOp={handleFeatureKernelOp}
                  onScriptParams={handleParamsChange}
                  busy={busy}
                  disabled={kernelOpsDisabled}
                  sketchProfiles={sketchProfiles}
                  sketchPaths={sketchPaths}
                />
              </div>
            )}

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
