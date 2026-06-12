import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import DesignWorkspace, { type DesignViewMode } from '../design/DesignWorkspace'
import type { SolvedMate } from '../design/AssemblyMatePanel'
import { useDesignSession } from '../design/DesignSessionContext'
import {
  registerDesignCommands,
  useOptionalCommandSurface,
  type DesignCommandActions
} from '../commands'
import { useOptionalSetCursorCoords } from './CursorCoordsContext'
import {
  FEATURE_DIALOG_COMMAND_ID,
  type FeatureDialogKind
} from '../design/feature-dialogs'
import type { SelectionSurface } from '../design/selection-state'
import type { CadExecuteScriptMesh } from '../../shared/sidecar-protocol'
import { dxfToSketch } from '../../shared/dxf-to-sketch'
import type { DesignFileV2 } from '../../shared/design-schema'
import type { DxfParseResult } from '../../shared/dxf-parser'

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
  // FG-5 Inspect — a one-shot "open measure/section" request the workspace
  // consumes to TOGGLE the matching viewport overlay, then acks via
  // `onInspectConsumed` so we clear it.
  const [requestedInspect, setRequestedInspect] = useState<'ut_measure' | 'ut_section' | null>(null)
  // Construct sketch-on-face — armed by `sk_choose_plane`; the workspace turns
  // it into viewport face-pick and clears it once a face is chosen.
  const [sketchPlanePickArmed, setSketchPlanePickArmed] = useState(false)

  // ── FG-3 — the Design-ribbon host actions (the seam design-commands.ts left) ─
  // Stable identities so a single `registerDesignCommands` registration covers
  // the host's lifetime. The state setters from useState are already stable.
  const designActions = useMemo<DesignCommandActions>(
    () => ({
      armSketchMode: () => {
        setSketchActive(true)
      },
      armSketchPlane: () => {
        // Construct `sk_choose_plane`: arm viewport face-pick so the next picked
        // face becomes the sketch plane. The workspace enters sketch mode once a
        // face is chosen (via `onSketchPlanePicked` → our `setSketchActive`).
        setSketchPlanePickArmed(true)
      },
      disarmSketchMode: () => {
        setSketchActive(false)
        setArmedSketchTool(null)
        setSketchPlanePickArmed(false)
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
        // FG-5 Inspect — drive the mounted Viewport3D's measure tool / section
        // clip directly: hand the workspace a one-shot request it TOGGLES (a
        // second dispatch turns the overlay back off). Only the two Inspect ids
        // this module registers reach here.
        if (kind === 'ut_measure' || kind === 'ut_section') {
          setRequestedInspect(kind)
        }
      }
    }),
    [onToast]
  )

  // Register the Design-ribbon handlers on the shared registry; dispose on
  // unmount so a host remount never double-registers (mirrors AppShell's
  // registerStarterCommands wiring).
  useEffect(() => registerDesignCommands(designActions), [designActions])

  // Wave 3e — Save now persists BOTH the script (the host's `onSave` → session
  // state + toast) AND the live sketch model to `design/sketch.json` via
  // `session.saveDesign()` (which also re-derives `part/features.json`). Without
  // this, a vector drawn on the mounted SketchSurface lived only in the in-memory
  // design reducer and was lost on reload — defeating the round-trip requirement.
  // `saveDesign` no-ops cleanly when no project is open (`projectDir == null`).
  const handleSave = useCallback(
    (script: string) => {
      onSave(script)
      void session.saveDesign()
    },
    [onSave, session]
  )

  // Wave 3f — Import DXF directly onto the LIVE Design sketch surface.
  //
  // The only DXF-import button used to live on the Manufacture ribbon
  // (`importVectorsFromDxf`), which reloaded the on-disk sketch, merged, and
  // re-saved — so a DXF imported there was NOT visible on an already-mounted
  // Design canvas until a reload (the Wave-3e item-e caveat). This handler closes
  // that gap: it folds the parsed DXF into the SAME in-memory `session.design`
  // (the exact model the mounted SketchSurface renders), pushes it through
  // `session.onDesignChange` so the bulge-accurate vectors appear on the canvas
  // immediately, then persists the MERGED model straight to `design/sketch.json`
  // via `fab.designSave` (NOT `session.saveDesign`, which would close over the
  // pre-merge design — see the persist comment below). importedCount /
  // skippedCount + the converter notes surface as toasts.
  //
  // SAFETY: imports sketch geometry only — emits no toolpath / G-code. The Laguna
  // RichAuto/Mach3 post invariants + the V-carve depth cap to stock thickness all
  // live downstream in cam-local → cam-runner-2d → vcarve_mach3.hbs, untouched.
  // Sketch S2 (race fix): resolve the MERGED design on success and `null` on
  // every nothing-changed path, so SketchSurface's one-undo-step decision is
  // deterministic (no dependence on React flushing the session edit first).
  const handleImportDxf = useCallback(async (): Promise<DesignFileV2 | null> => {
    const projectDir = session.projectDir
    if (projectDir === null) {
      onToast('warn', 'Open a project before importing DXF vectors.')
      return null
    }
    const fab = window.fab
    let filePath: string | null
    try {
      filePath = await fab.dialogOpenFile([{ name: 'DXF vectors', extensions: ['dxf'] }])
    } catch (e) {
      onToast('err', `DXF import failed: ${e instanceof Error ? e.message : String(e)}`)
      return null
    }
    if (!filePath) return null // user cancelled the picker
    let res: ({ ok: true } & DxfParseResult) | { ok: false; error: string }
    try {
      res = await fab.dxfImport(filePath)
    } catch (e) {
      onToast('err', `DXF import failed: ${e instanceof Error ? e.message : String(e)}`)
      return null
    }
    if (!res.ok) {
      onToast('err', `DXF import failed: ${res.error}`)
      return null
    }
    const parse: DxfParseResult = {
      entities: res.entities,
      layers: res.layers,
      units: res.units,
      warnings: res.warnings
    }
    if (parse.entities.length === 0) {
      onToast('warn', 'DXF parsed but contained no supported 2D geometry (LINE/CIRCLE/ARC/POLYLINE).')
      return null
    }
    // Additive merge onto the LIVE session model (never `replace`) so the import
    // can't clobber CAD-authored geometry already on the canvas. Using
    // `session.design` (in-memory) rather than a disk reload is what makes the
    // result appear instantly on the mounted surface.
    const { design, importedCount, skippedCount, notes } = dxfToSketch(parse, session.design)
    // Push into the session reducer (immediate canvas update on the mounted
    // SketchSurface — it renders `session.design`).
    session.onDesignChange(design)
    // Persist `design/sketch.json` directly with the MERGED design. We can't lean
    // on `session.saveDesign()` here: that callback closes over the pre-merge
    // `session.design` (the reducer edit above only lands on the next render), so
    // it would write the stale model. Saving the explicit `design` avoids that
    // race — mirrors the Manufacture-ribbon importer's `fab.designSave(...)` call.
    // `part/features.json` is re-derived by the next explicit Save / kernel build;
    // the sketch JSON is the load-bearing artefact the contour/V-carve derive reads.
    try {
      await fab.designSave(projectDir, JSON.stringify(design))
    } catch (e) {
      onToast('err', `DXF imported onto the canvas but failed to save: ${e instanceof Error ? e.message : String(e)}`)
      // The merge IS applied to the session (onDesignChange above) -- still the
      // surface's undo step; only persistence failed.
      return design
    }
    const skipNote = skippedCount > 0 ? ` (${skippedCount} skipped)` : ''
    onToast(
      'ok',
      `Imported ${importedCount} DXF vector${importedCount === 1 ? '' : 's'}${skipNote} onto the sketch.`
    )
    for (const n of notes.slice(0, 3)) onToast('warn', n)
    return design
  }, [session, onToast])

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

  // Wave 3n — publish the Design coordinate sources to the shell StatusBar via
  // CursorCoordsContext. Provider-tolerant (stable no-op under the SSR pins,
  // same rationale as useOptionalCommandSurface). Two sources, both THREADED
  // from where they are already computed — never recomputed here:
  //   - sketch2d: the mounted canvas's own snap-resolved pointer→world value
  //     (null on pointer-leave / surface unmount → read-out blanks);
  //   - pick3d: the viewport's last registered face/edge pick point.
  const setCursorCoords = useOptionalSetCursorCoords()
  const handleSketchCursorWorld = useCallback(
    (xyMm: readonly [number, number] | null): void => {
      setCursorCoords(xyMm === null ? null : { kind: 'sketch2d', xMm: xyMm[0], yMm: xyMm[1] })
    },
    [setCursorCoords]
  )
  const handleViewportPickPoint = useCallback(
    (pointMm: { readonly x: number; readonly y: number; readonly z: number }): void => {
      setCursorCoords({ kind: 'pick3d', xMm: pointMm.x, yMm: pointMm.y, zMm: pointMm.z })
    },
    [setCursorCoords]
  )
  // Route switch unmounts this host (WorkspaceHost renders exactly one
  // workspace): blank the read-out so the StatusBar never shows coordinates
  // from a workspace that is no longer mounted.
  useEffect(() => {
    return () => {
      setCursorCoords(null)
    }
  }, [setCursorCoords])

  return (
    <DesignWorkspace
      initialScript={initialScript}
      onSave={handleSave}
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
      // Wave 3e (keystone unlock) — the live session sketch model + its edit sink.
      // Threading these mounts the SESSION-PERSISTED SketchSurface in the Sketch
      // stage (instead of the self-contained MvpSketchCanvas), so a drawn vector
      // persists into `session.design`, survives save + reload, and is preserved
      // across Sketch↔Model stage switches. `onDesignChange` dispatches an `edit`
      // into the session's design reducer (the same path `addPresetRect`/`mirrorX`
      // use); `session.saveDesign` writes it to `design/sketch.json`.
      sketchDesign={session.design}
      onSketchDesignChange={session.onDesignChange}
      // Wave 3f — Import DXF onto the live sketch surface (additive-merge into the
      // session model + persist), so the SketchSurface palette shows the button.
      onSketchImportDxf={handleImportDxf}
      requestedFeatureDialog={requestedFeatureDialog}
      onFeatureDialogConsumed={() => setRequestedFeatureDialog(null)}
      // FG-5 Inspect — one-shot measure/section request + its ack.
      requestedInspect={requestedInspect}
      onInspectConsumed={() => setRequestedInspect(null)}
      // Construct sketch-on-face — arm face-pick; on a pick enter sketch mode +
      // disarm so the next plain click goes back to normal selection.
      sketchPlanePickArmed={sketchPlanePickArmed}
      onSketchPlanePicked={() => {
        setSketchActive(true)
        setSketchPlanePickArmed(false)
      }}
      onCommandSurface={handleCommandSurface}
      // Wave 3n — live cursor / last-pick coordinates for the shell StatusBar.
      onSketchCursorWorld={handleSketchCursorWorld}
      onViewportPickPoint={handleViewportPickPoint}
      // No-code build→render: the session maintains the kernel-built solid's
      // geometry (rebuilt automatically when the feature timeline changes) and a
      // build-in-flight flag. Threading them here is what makes "add a no-code
      // feature → see the model" actually display in the cockpit viewport.
      kernelViewportGeometry={session.viewportGeometry}
      kernelBuilding={session.kernelBuilding}
    />
  )
}

export default DesignWorkspaceHost
