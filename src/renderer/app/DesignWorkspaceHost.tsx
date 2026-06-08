import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import DesignWorkspace, { type DesignViewMode } from '../design/DesignWorkspace'
import type { SolvedMate } from '../design/AssemblyMatePanel'
import { useDesignSession } from '../design/DesignSessionContext'
import {
  registerDesignCommands,
  useOptionalCommandSurface,
  type DesignCommandActions
} from '../commands'
import {
  FEATURE_DIALOG_COMMAND_ID,
  type FeatureDialogKind
} from '../design/feature-dialogs'
import type { SelectionSurface } from '../design/selection-state'
import type { CadExecuteScriptMesh } from '../../shared/sidecar-protocol'

/**
 * Reverse of {@link FEATURE_DIALOG_COMMAND_ID}: catalog id (`'so_extrude'`,
 * `'so_fillet'`, …) → the {@link FeatureDialogKind} the Properties pane opens.
 * Built once at module load. Catalog rows that have NO dialog yet (Sweep, Loft,
 * Combine, …) are absent from this map — the host surfaces an honest toast for
 * those rather than opening a wrong dialog (FG-5 "do not fake capability").
 */
const FEATURE_DIALOG_KIND_BY_COMMAND: ReadonlyMap<string, FeatureDialogKind> = new Map(
  (Object.entries(FEATURE_DIALOG_COMMAND_ID) as Array<[FeatureDialogKind, string]>).map(
    ([kind, id]) => [id, kind]
  )
)

/**
 * Bridge between the new-shell `WorkspaceHost` and the prop-driven
 * `DesignWorkspace`.
 *
 * This is the ONLY new-shell code that reads `useDesignSession()`. It must be
 * rendered INSIDE a `DesignSessionProvider` (WorkspaceHost mounts that around
 * the `design`/`assemble`/`drawings` route) AND inside the AppShell's
 * `CommandContextProvider` (it calls {@link useCommandSurface} +
 * {@link registerDesignCommands}). Keeping the `useDesignSession()` call here —
 * rather than inside `DesignWorkspace` — preserves DesignWorkspace as a pure,
 * provider-less component so the legacy ShopApp path, the splash preview, and
 * every existing render-pin test keep rendering it without a context (the
 * additive/backward-compat rule).
 *
 * It threads the session's editable kernel-op timeline (`features.kernelOps` +
 * the reorder / move / suppress / roll-back handlers) into DesignWorkspace,
 * which forwards them to the FeatureTree's KernelTimeline. When no project is
 * open the provider is inert (`projectDir == null` -> `features == null`), so
 * `kernelOps` is `undefined` and the timeline simply does not render — exactly
 * the required "timeline just doesn't show" fallback.
 *
 * **FG-3 / FG-5 (Wave 2 Integrate) — the ribbon goes live here.** This host owns
 * the small "command intent" state the Design ribbon's commands drive
 * (sketch-mode, the last-armed sketch tool, and a one-shot feature-dialog
 * request) and registers the {@link DesignCommandActions} on the shared command
 * registry, so every Design-ribbon button dispatches to real behavior:
 *   - `armSketchMode` / `armSketchTool` → flip sketch-mode on (mounting the
 *     sketcher in the cockpit center) + record the armed tool id;
 *   - `disarmSketchMode` → flip it back off;
 *   - `openFeatureDialog(catalogId)` → open the matching per-feature dialog in
 *     the Properties pane (or toast honestly when no dialog exists yet);
 *   - `runInspect(kind)` → honest hint toward the viewport's own measure/section
 *     HUD (the mounted `Viewport3D` owns those; DesignWorkspace exposes no
 *     controlled measure/section prop yet — flagged, not faked).
 * The combined command surface (selection ∪ sketch mode) is pushed up via
 * {@link useCommandSurface} so the contextual Sketch ribbon tab appears in
 * sketch mode and selection-gated commands track the live pick.
 */
export function DesignWorkspaceHost({
  initialScript,
  onSave,
  onSendToCam,
  onToast,
  initialViewMode,
  onMateAdded
}: {
  readonly initialScript: string
  readonly onSave: (script: string) => void
  readonly onSendToCam: (payload: { readonly stlPath: string; readonly mesh: CadExecuteScriptMesh }) => void
  readonly onToast: (kind: 'ok' | 'err' | 'warn', message: string) => void
  /**
   * Which CAD view-mode tab the workspace should open on. The `WorkspaceHost`
   * maps the active route here (`assemble` → `'assembly'`, `drawings` →
   * `'drawing'`, `design` → `'part'`) so the operator lands on the right view
   * instead of always seeing the Part editor. Optional — when omitted
   * DesignWorkspace falls back to its own `'part'` default (preserves the
   * legacy ShopApp path + every existing render-pin).
   */
  readonly initialViewMode?: DesignViewMode
  /**
   * Forwarded to DesignWorkspace's {@link AssemblyMatePanel}. Fires after a
   * mate solves. Optional — the new shell currently wires this to a toast
   * acknowledgment; durable Model-C persistence into `assembly.json` is a
   * follow-up.
   */
  readonly onMateAdded?: (mate: SolvedMate) => void
}): ReactElement {
  const session = useDesignSession()
  // Provider-tolerant: the host is rendered in isolation by node-env SSR pins
  // that don't mount the full CommandContextProvider chain. Live, it's always
  // inside the provider (AppShell wraps the shell), so the push reaches the engine.
  const pushSurface = useOptionalCommandSurface()

  // ── FG-3 / FG-5 — ribbon command-intent state (driven by the actions below) ─
  const [sketchActive, setSketchActive] = useState(false)
  const [armedSketchTool, setArmedSketchTool] = useState<string | null>(null)
  const [requestedFeatureDialog, setRequestedFeatureDialog] = useState<FeatureDialogKind | null>(null)

  // ── FG-3 — the Design-ribbon host actions (the seam design-commands.ts left) ─
  // Stable identities so a single `registerDesignCommands` registration covers
  // the host's lifetime. The state setters from useState are already stable.
  const designActions = useMemo<DesignCommandActions>(
    () => ({
      armSketchMode: () => {
        setSketchActive(true)
      },
      disarmSketchMode: () => {
        setSketchActive(false)
        setArmedSketchTool(null)
      },
      armSketchTool: (toolId: string) => {
        // Arming a tool implies entering sketch mode (design-commands.ts
        // contract). The mounted sketcher owns its own tool palette, so we
        // record the catalog id as an honest read-out (DesignWorkspace surfaces
        // it above the canvas) rather than driving a controlled tool.
        setSketchActive(true)
        setArmedSketchTool(toolId)
      },
      openFeatureDialog: (catalogId: string) => {
        const kind = FEATURE_DIALOG_KIND_BY_COMMAND.get(catalogId)
        if (kind) {
          setRequestedFeatureDialog(kind)
          return
        }
        // Honest path: a Solid/Construct command that has a working kernel op
        // but no dialog yet (Sweep, Loft, Combine, Pattern, datum planes, …).
        onToast('warn', `${catalogId}: no property dialog yet — drive it from the CadQuery code drawer for now.`)
      },
      runInspect: (kind: string) => {
        // Measure / Section live in the mounted Viewport3D's own HUD; the
        // workspace exposes no controlled measure/section prop yet. Point the
        // operator at the live tool rather than pretending to run it.
        const tool = kind === 'ut_section' ? 'Section' : 'Measure'
        onToast('ok', `${tool}: use the ${tool} control in the 3D viewport toolbar.`)
      }
    }),
    [onToast]
  )

  // Register the Design-ribbon handlers on the shared registry; dispose on
  // unmount so a host remount never double-registers (mirrors AppShell's
  // registerStarterCommands wiring).
  useEffect(() => registerDesignCommands(designActions), [designActions])

  // Forward the combined command surface (selection ∪ sketch mode) DesignWorkspace
  // computes up into the Context Engine. DesignWorkspace stays provider-less; the
  // host (always inside CommandContextProvider) owns the actual push.
  const handleCommandSurface = useCallback(
    (surface: SelectionSurface & { readonly sketchMode: boolean }) => {
      pushSurface({
        hasSelection: surface.hasSelection,
        selectionKind: surface.selectionKind,
        sketchMode: surface.sketchMode
      })
    },
    [pushSurface]
  )

  return (
    <DesignWorkspace
      initialScript={initialScript}
      onSave={onSave}
      onSendToCam={onSendToCam}
      onToast={onToast}
      initialViewMode={initialViewMode}
      onMateAdded={onMateAdded}
      kernelOps={session.features?.kernelOps}
      rolledBackTo={session.features?.rolledBackTo}
      onKernelMove={(index, delta) => {
        void session.moveKernelOp(index, delta)
      }}
      onKernelReorder={(from, to) => {
        void session.reorderKernelOps(from, to)
      }}
      onKernelSuppressToggle={(index, suppressed) => {
        void session.setKernelOpSuppressedAt(index, suppressed)
      }}
      onKernelSetRollback={(index) => {
        void session.setKernelRollbackMarker(index)
      }}
      onKernelClearRollback={() => {
        void session.setKernelRollbackMarker(null)
      }}
      onAppendKernelOp={(op) => {
        void session.appendKernelOp(op)
      }}
      // The session's `appendKernelOp` early-returns when no project is open,
      // so surface that as a disabled dialog Apply with an honest hint rather
      // than letting the click silently no-op.
      kernelOpsDisabled={session.projectDir === null}
      // FG-3 / FG-5 — ribbon-driven cockpit state.
      sketchActive={sketchActive}
      onSketchEnter={() => setSketchActive(true)}
      onSketchExit={() => {
        setSketchActive(false)
        setArmedSketchTool(null)
      }}
      armedSketchTool={armedSketchTool}
      requestedFeatureDialog={requestedFeatureDialog}
      onFeatureDialogConsumed={() => setRequestedFeatureDialog(null)}
      onCommandSurface={handleCommandSurface}
    />
  )
}

export default DesignWorkspaceHost
