/**
 * ManufactureHost — mounts the existing CAM workspace (`<ManufactureWorkspace>`)
 * inside the new WorkTrack3D app shell.
 *
 * This is a *thin host*: it sources every prop ManufactureWorkspace requires
 * from the shared contexts (machine session, toast), a one-shot settings load
 * via the `fab()` IPC bridge, and local component state. It deliberately keeps
 * its own surface small — the workspace component owns all of the real UI.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * G-CODE GENERATION ("G-code is sacred")
 * ──────────────────────────────────────────────────────────────────────────
 * `onRunCam` and `onRunSlice` now drive the PROVEN engine helpers
 * (`runCamForOp` / `runSliceForOp`) — the same `fab().camRun` / `fab().sliceOrca`
 * IPC paths the classic shell uses. Neither path invents toolpath or slicer
 * logic: `runCamForOp` resolves the selected op + its parent setup into the
 * existing camRun payload, and `runSliceForOp` is a thin wrapper over
 * `slice:orca`. Generation only produces the toolpath / G-code file on disk;
 * the runtime export-safety gate still runs at SEND/PUSH time (Send-to-K2 /
 * export), not here, mirroring the classic shell.
 *
 * Both handlers are DEFENSIVE: with no open project (`projectDir === null`) or
 * no active machine they toast a clear message and return WITHOUT touching any
 * engine IPC. `onRunCam` targets the CNC `camRun` engine; `onRunSlice` targets
 * the FDM OrcaSlicer path (it loads the manufacture plan, finds the first
 * `fdm_slice` op with a source mesh, and slices that).
 *
 * `projectDir` / `project` come from {@link useProjectSession} (which owns the
 * open/create/read lane and persists `settings.lastProjectPath`); the loaded
 * `settings.lastProjectPath` is kept only as a read-only fallback.
 *
 * Tool-library props (`tools` / `projectTools` / `machineTools`) are passed as
 * `null`: the MachineSessionContext exposes `machineTools` as a `ToolRecord[]`,
 * but ManufactureWorkspace expects a `ToolLibraryFile` (a different,
 * file-shaped type). Rather than fabricate a partial library here, the host
 * passes `null` for all three until a real `ToolLibraryFile` source is wired.
 * `runCamForOp` likewise receives `tools: null` (toolId→diameter lookups then
 * degrade to each op's explicit `toolDiameterMm` or the 6 mm default).
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { ManufactureWorkspace, type WorkflowStage } from '../manufacture/ManufactureWorkspace'
import { useMachineSession } from '../contexts/MachineSessionContext'
import { useToast } from '../contexts/ToastContext'
import { fab } from '../src/shop-types'
import { appSettingsSchema, type AppSettings } from '../../shared/project-schema'
import type { ManufacturePanelTab } from '../shell/workspaceMemory'
import { useProjectSession } from './useProjectSession'
import { runCamForOp } from '../manufacture/run-cam-for-op'
import { runSliceForOp } from '../manufacture/run-slice-for-op'
import { getPlates, getActivePlate } from '../manufacture/plate-state'
import { useCamHandoff } from './CamHandoffContext'
import type { CamImportEnv } from './import-stl-into-first-plate'
import type { PendingMeshImport } from '../manufacture/manufacture-load-guard'
import type { ManufactureFile, ManufactureOperation } from '../../shared/manufacture-schema'
import {
  registerCamCommands,
  registerFdmCommands,
  registerRouterCommands,
  ROUTER_COMMAND_OP_KIND,
  ROUTER_OP_DRILL_COMMAND_ID,
  ROUTER_OP_POCKET_COMMAND_ID,
  ROUTER_OP_PROFILE_COMMAND_ID,
  ROUTER_OP_VCARVE_COMMAND_ID,
  type CamCommandActions,
  type FdmCommandActions,
  type RouterCommandActions
} from '../commands'

/** Default Python interpreter when `settings.pythonPath` is unset. */
const DEFAULT_PYTHON_PATH = 'python'

/**
 * POSIX-style basename for a slash- or backslash-delimited path. Used to show
 * just the written G-code file name in success toasts (the renderer cannot
 * import `node:path`).
 */
function baseName(p: string): string {
  const parts = p.split(/[\\/]/)
  return parts[parts.length - 1] || p
}

/**
 * Find the first `fdm_slice` operation that declares a `sourceMesh`, scanning
 * the top-level operations first, then every plate's operations (v2 plates are
 * the source of truth when present; `getPlates` always yields ≥1 plate and
 * folds v1 top-level arrays into a synthetic default plate).
 */
function findFdmSliceOp(mfg: ManufactureFile): { sourceMesh: string } | null {
  const hasMesh = (
    op: ManufactureOperation
  ): op is ManufactureOperation & { sourceMesh: string } =>
    op.kind === 'fdm_slice' &&
    typeof op.sourceMesh === 'string' &&
    op.sourceMesh.trim().length > 0
  const top = mfg.operations.find(hasMesh)
  if (top) return { sourceMesh: top.sourceMesh }
  for (const plate of getPlates(mfg)) {
    const match = plate.operations.find(hasMesh)
    if (match) return { sourceMesh: match.sourceMesh }
  }
  return null
}

/** Tool-library file filter shared with Utilities → Library (LibraryView.importTools). */
const TOOL_LIBRARY_FILE_FILTERS: ReadonlyArray<{ name: string; extensions: string[] }> = [
  { name: 'Tool Libraries', extensions: ['json', 'csv', 'tools'] }
]

/**
 * Laguna Swift 5x10 default sheet (mm) — used when no Laguna setup stock is
 * defined. Mirrors LagunaNestingPanel's LAGUNA_DEFAULT_SHEET_{W,H}_MM so the
 * host's auto-arrange routine nests onto the same physical sheet the panel does.
 */
const ARRANGE_DEFAULT_SHEET_W_MM = 1524
const ARRANGE_DEFAULT_SHEET_H_MM = 3048

/** Part margin (mm) the auto-arrange nest leaves between parts. Matches the panel. */
const ARRANGE_PART_MARGIN_MM = 3
/** Sheet edge margin (mm) for auto-arrange. Matches the panel. */
const ARRANGE_SHEET_MARGIN_MM = 10

/** A nestable 2D part: an op id + its closed contour polygon. */
export interface NestablePart {
  readonly id: string
  readonly points: ReadonlyArray<readonly [number, number]>
}

/**
 * Extract the nestable 2D parts from a plate's operations. PURE — mirrors
 * `LagunaNestingPanel.nestableParts` exactly so the host's auto-arrange feeds
 * the SAME polygon set the manual nesting panel does: every un-suppressed
 * `cnc_contour` op whose `contourPoints` form a closed loop (>= 3 points)
 * contributes one polygon, keyed by the op id so placements map back
 * unambiguously. Reused (not reimplemented): the actual bin-packing lives in
 * the `nesting:nestPolygons` engine; this only collects its input.
 */
export function extractNestableParts(
  operations: ReadonlyArray<ManufactureOperation>
): NestablePart[] {
  const parts: NestablePart[] = []
  for (const op of operations) {
    if (op.kind !== 'cnc_contour') continue
    if (op.suppressed) continue
    const raw = op.params?.['contourPoints']
    if (!Array.isArray(raw)) continue
    const pts: Array<readonly [number, number]> = []
    for (const v of raw) {
      if (Array.isArray(v) && v.length >= 2 && typeof v[0] === 'number' && typeof v[1] === 'number') {
        pts.push([v[0], v[1]])
      }
    }
    if (pts.length >= 3) parts.push({ id: op.id, points: pts })
  }
  return parts
}

/** Advisory shown for the Settings / Project navigation affordances. */
const NAVIGATE_ADVISORY = 'Open Settings / your project from the top bar.'

/** Default sub-tab when the host first mounts — the "Plan" job overview. */
const DEFAULT_PANEL_TAB: ManufacturePanelTab = 'plan'

export function ManufactureHost(): ReactElement {
  const { machines, sessionMachine, materials } = useMachineSession()
  const { pushToast } = useToast()
  // Design → Manufacture STL hand-off mailbox. Design queues a freshly-exported
  // STL here; the consume effect below imports it into the first plate exactly
  // once (see {@link useCamHandoff} consume-once semantics).
  const { pendingCamImport, consumePendingCamImport } = useCamHandoff()

  // Project binding (open/create/read lane). `projectDir` from the session is
  // authoritative; the loaded `settings.lastProjectPath` is only a fallback for
  // the first render before the session's hydration effect resolves.
  const { projectDir: sessionProjectDir, project } = useProjectSession()

  // App settings are loaded once via the IPC bridge. `settingsGet()` returns a
  // loose record; we coerce it through the Zod schema (every field is
  // `.optional()`, so a real settings object parses cleanly) to obtain a
  // properly-typed `AppSettings` without using `any` or an unchecked cast.
  const [settings, setSettings] = useState<AppSettings | null>(null)

  // Local UI state owned by the host.
  const [panelTab, setPanelTab] = useState<ManufacturePanelTab>(DEFAULT_PANEL_TAB)
  const [importText, setImportText] = useState<string>('')
  // Monotonic nonce bumped after the host writes a hand-off STL into the
  // manufacture plan on disk (Design → Manufacture). The workspace re-reads
  // `manufacture.json` whenever this changes, so the imported part appears in
  // the plate without remounting the workspace. Session-only.
  // Legacy disk-reload nonce. Kept wired (stable 0) for backward-compat with
  // the workspace's reloadNonce path, but no longer bumped: the Send-to-CAM
  // import now merges into the workspace's LIVE plan (requestedMeshImport)
  // instead of re-reading disk, so unsaved in-memory edits are preserved.
  const [reloadNonce] = useState<number>(0)

  // Wave 3a (Mill-4 ribbon) — one-shot requests the host pushes DOWN into the
  // workspace so the CAM ribbon commands can drive the workflow-stage strip +
  // op-seeding the workspace owns internally. Cleared via the workspace's
  // `onRequested*Handled` callbacks after it consumes each request.
  const [requestedStage, setRequestedStage] = useState<WorkflowStage | null>(null)
  const [requestedNewOpKind, setRequestedNewOpKind] = useState<string | null>(null)
  // Wave 3d (Laguna router ribbon) — monotonic nonce the host bumps to ask the
  // workspace to run a DXF vector import (file picker → dxf:import → fold into
  // the sketch). A counter (not a boolean) so two back-to-back imports each
  // fire; the workspace clears it via `onRequestedDxfImportHandled`.
  const [requestedDxfImportNonce, setRequestedDxfImportNonce] = useState<number>(0)
  // Design -> Manufacture STL hand-off applied to the workspace's LIVE plan.
  // The consume effect below copies the STL via `assets:importMesh`, then sets
  // this request; the workspace folds it into its current in-memory `mfg` (NOT
  // a stale disk read) and persists. Merging into the live plan preserves the
  // operator's unsaved setups/ops — a disk-read merge silently discarded them
  // (the DXF-import persistence-race). Cleared via `onRequestedMeshImportHandled`.
  const [requestedMeshImport, setRequestedMeshImport] = useState<PendingMeshImport | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const raw = await fab().settingsGet()
        if (cancelled) return
        const parsed = appSettingsSchema.safeParse(raw)
        if (parsed.success) {
          setSettings(parsed.data)
        } else {
          // Stored settings somehow failed validation — keep `null` (the
          // workspace tolerates a null settings object) and surface the issue.
          setSettings(null)
          pushToast('err', 'Failed to load settings')
        }
      } catch {
        if (!cancelled) {
          setSettings(null)
          pushToast('err', 'Failed to load settings')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pushToast])

  /**
   * Persist a single settings field. Mirrors the change into local state so the
   * workspace re-renders immediately, then writes it through the IPC bridge.
   */
  const handleSaveSettingsField = useCallback(
    (partial: Partial<AppSettings>): void => {
      setSettings((prev) => (prev ? { ...prev, ...partial } : prev))
      void fab().settingsSet(partial as Record<string, unknown>)
    },
    []
  )

  // Effective project directory: the session's open project wins; fall back to
  // the persisted `settings.lastProjectPath` for the first render before the
  // session hydration effect resolves. `null` ⇒ no project is open.
  const projectDir = sessionProjectDir ?? settings?.lastProjectPath ?? null
  const activeMachineId = sessionMachine?.id ?? null
  const pythonPath = settings?.pythonPath ?? DEFAULT_PYTHON_PATH

  // ── Design → Manufacture STL hand-off (consume-once) ──────────────────────
  // When Design queues an STL (via the CamHandoff mailbox), import it into the
  // FIRST plate of the manufacture plan. This REUSES the proven mesh-import IPC
  // (`assets:importMesh` — same path the workspace's "Import mesh" button uses):
  // it copies the STL into the project's `assets/` and returns a project-
  // relative path. We then HAND that path to the workspace via the one-shot
  // `requestedMeshImport` prop; the workspace folds it into its LIVE in-memory
  // plan (binding onto the first plate's first op, or seeding one when empty)
  // and persists. We deliberately do NOT load+merge+save from disk here: that
  // disk read happened WITHOUT the operator's unsaved setups/ops, so the
  // merge+save+reload silently discarded them (the DXF-import persistence-race,
  // mirror of the Cycle-249 clobber). SAFETY: no G-code here — STL copy +
  // plate-data write only. Consume-once: `consumePendingCamImport` atomically
  // clears the slot, so a re-fired effect (project/machine change, Strict-Mode
  // double-invoke) sees nothing and no-ops.
  useEffect(() => {
    if (!pendingCamImport) return
    if (!projectDir) {
      // No project open yet — leave the request queued; the effect re-runs when
      // a project opens (projectDir flips non-null) and imports it then.
      return
    }
    const req = consumePendingCamImport()
    if (!req) return
    const env: CamImportEnv =
      machines.find((m) => m.id === activeMachineId)?.kind === 'fdm' ? 'fdm' : 'cnc'
    void (async () => {
      try {
        const imp = await fab().assetsImportMesh(projectDir, req.stlPath, pythonPath)
        if (!imp.ok) {
          pushToast('err', 'Send to CAM: mesh import failed', imp.detail ?? imp.error)
          return
        }
        // Hand the imported (project-relative) mesh to the workspace, which
        // folds it into its LIVE in-memory plan and persists. We do NOT load
        // + merge + save from disk here: that read happened WITHOUT the
        // operator's unsaved setups/ops, so the merge+save+reload silently
        // discarded them (the DXF-import persistence-race). The workspace
        // emits the authoritative "Part landed in CAM" toast after it saves.
        setRequestedMeshImport({
          relPath: imp.relativePath,
          env,
          ...(req.sourceName !== undefined ? { opLabel: req.sourceName } : {})
        })
      } catch (e) {
        pushToast('err', 'Send to CAM failed', e instanceof Error ? e.message : String(e))
      }
    })()
  }, [pendingCamImport, projectDir, consumePendingCamImport, machines, activeMachineId, pythonPath, pushToast])

  // ── G-code generation handlers (PROVEN engine helpers) ────────────────────
  // CNC toolpath generation. Receives the live manufacture plan + selected op
  // index from the workspace; resolves the selected op + its parent setup into
  // the existing `fab().camRun` payload via `runCamForOp`. Defensive: no project
  // dir or no machine ⇒ toast + return before any engine IPC.
  const handleRunCam = useCallback(
    async (ctx: { mfg: ManufactureFile; selectedOpIndex: number }): Promise<void> => {
      if (!projectDir) {
        pushToast('warn', 'Open a project before generating a toolpath.')
        return
      }
      // CNC-only resolution (mirrors the classic Make → Generate path's
      // `camRunCncMachineId`): prefer the active machine when it is itself CNC,
      // else the first installed CNC. This BLOCKS the FDM K2 Plus from ever
      // posting CNC G-code through the cam engine — for the K2, the operator
      // uses the FDM slice path instead.
      const cncMachines = machines.filter((m) => m.kind === 'cnc')
      const camMachineId =
        activeMachineId && cncMachines.some((m) => m.id === activeMachineId)
          ? activeMachineId
          : cncMachines[0]?.id
      if (!camMachineId) {
        pushToast(
          'warn',
          'CAM toolpaths need a CNC machine (Laguna or Carvera). For the K2 Plus, run the FDM slice instead.'
        )
        return
      }
      // Host convention (matches ManufactureWorkspace): posted G-code lands at
      // `<projectDir>/output/cam.nc`. POSIX-style join works on Windows for the
      // Node fs layer; `runCamForOp` recovers `projectDir` from this tail to
      // resolve the op's project-relative source mesh.
      const outPath = `${projectDir}/output/cam.nc`
      const r = await runCamForOp({
        mfg: ctx.mfg,
        selectedOpIndex: ctx.selectedOpIndex,
        machineId: camMachineId,
        materials,
        tools: null, // no ToolLibraryFile source wired yet (see header note)
        pythonPath,
        outPath
      })
      if (r.ok) {
        const where = r.gcodePath ? baseName(r.gcodePath) : baseName(outPath)
        // The new-shell CAM path does not yet thread a per-op placement
        // transform, so the program zero follows the setup/centered stock, not a
        // viewport gizmo. Tell the operator to verify the datum + retracts (and
        // simulate) before cutting — generation writes a file only; nothing is
        // sent to a machine here.
        pushToast(
          'ok',
          `Toolpath generated → ${where}. Verify program zero / WCS + retracts against your setup (simulate) before running on a machine.`
        )
        for (const w of r.warnings ?? []) pushToast('warn', w)
        return
      }
      pushToast('err', r.error ?? 'CAM generation failed', r.hint)
    },
    [projectDir, machines, activeMachineId, materials, pythonPath, pushToast]
  )

  // FDM slice. The top-level slice button carries no op context, so the host
  // loads the manufacture plan and slices the first `fdm_slice` op that declares
  // a source mesh. Defensive: no project dir, no machine, or no sliceable op ⇒
  // toast + return before any engine IPC.
  const handleRunSlice = useCallback((): void => {
    void (async () => {
      if (!projectDir) {
        pushToast('warn', 'Open a project before running an FDM slice.')
        return
      }
      if (!activeMachineId) {
        pushToast('warn', 'Select an FDM machine before running a slice.')
        return
      }
      let mfg: ManufactureFile
      try {
        mfg = await fab().manufactureLoad(projectDir)
      } catch {
        pushToast('err', 'Failed to load the manufacture plan for slicing.')
        return
      }
      const op = findFdmSliceOp(mfg)
      if (!op) {
        pushToast('warn', 'No FDM slice operation with a source mesh in this project.')
        return
      }
      // Host convention (matches ManufactureWorkspace.runFdmSliceFromOp): source
      // mesh is project-relative; output lands at `<projectDir>/output/slice.gcode`.
      const r = await runSliceForOp({
        stlPath: `${projectDir}/${op.sourceMesh}`,
        outPath: `${projectDir}/output/slice.gcode`,
        machineId: activeMachineId,
        ...(settings?.k2QualityPresetId !== undefined
          ? { qualityPresetId: settings.k2QualityPresetId }
          : {}),
        ...(settings?.activeFilamentId !== undefined
          ? { filamentId: settings.activeFilamentId }
          : {})
      })
      if (r.ok) {
        pushToast('ok', `Sliced via OrcaSlicer → ${r.gcodePath ? baseName(r.gcodePath) : 'slice.gcode'}`)
        return
      }
      pushToast('err', r.error ?? 'Slice failed', r.hint)
    })()
  }, [projectDir, activeMachineId, settings, pushToast])

  // ── Tool-library import (REUSES Utilities → Library's import IPC) ────────
  // Both affordances now drive the SAME pipeline `LibraryView.importTools` uses:
  // a native file picker (`dialog:openFile`) restricted to tool-library files,
  // then `tools:importFile` (global 'default' library) or
  // `machineTools:importFile` (per-machine) — no parallel importer. When a CNC
  // machine is active the tools land in that machine's library (so its ops can
  // resolve diameters); otherwise they land in the global 'default' library,
  // exactly mirroring the Library view's `selectedMachineId` branch.
  const importToolLibrary = useCallback((): void => {
    void (async () => {
      try {
        const path = await fab().dialogOpenFile([...TOOL_LIBRARY_FILE_FILTERS])
        if (!path) return
        // Prefer the active CNC machine's library; FDM (K2) and no-machine fall
        // back to the global 'default' library (FDM uses no cutting tools).
        const cncMachineId =
          activeMachineId && machines.some((m) => m.id === activeMachineId && m.kind === 'cnc')
            ? activeMachineId
            : null
        if (cncMachineId) {
          const lib = await fab().machineToolsImportFile(cncMachineId, path)
          pushToast('ok', `Imported ${lib.tools.length} tool(s) into the machine library.`)
        } else {
          const lib = await fab().toolsImportFile('default', path)
          pushToast('ok', `Imported ${lib.tools.length} tool(s) into the global library.`)
        }
      } catch (e) {
        pushToast('err', 'Tool import failed', e instanceof Error ? e.message : String(e))
      }
    })()
  }, [activeMachineId, machines, pushToast])

  // ManufactureWorkspace exposes two tool-import entry points (a header button +
  // a file menu item); both map onto the single reused import pipeline above.
  const handleImportTools = importToolLibrary
  const handleImportToolLibraryFromFile = importToolLibrary

  const handleGoSettings = useCallback((): void => {
    pushToast('warn', NAVIGATE_ADVISORY)
  }, [pushToast])

  const handleGoProject = useCallback((): void => {
    pushToast('warn', NAVIGATE_ADVISORY)
  }, [pushToast])

  // Stable clear for the one-shot Send-to-CAM mesh-import request. Memoized so
  // the prop identity does not churn the workspace's destructive merge effect
  // (the Cycle-249 inline-arrow-prop lesson). The workspace calls this after it
  // has folded the import into the live plan + saved.
  const handleRequestedMeshImportHandled = useCallback((): void => {
    setRequestedMeshImport(null)
  }, [])

  // ── Mill-4 ribbon go-live (Wave 3a) ───────────────────────────────────────
  // Register the Manufacture-ribbon command handlers on the shared command
  // registry (mirrors DesignWorkspaceHost's `registerDesignCommands` wiring).
  // The action bag is the seam between a catalog `command.id` and real shell
  // behavior: setup / probing / simulate / send navigate the workspace's
  // workflow-stage strip (via the one-shot `requestedStage` prop), op-seeding
  // pushes a `cnc_*` kind down through `requestedNewOpKind`, multi-setup +
  // tool-library route to the Setup / Tools sub-tabs. SAFETY: these handlers
  // only OPEN authoring surfaces — they never generate, mutate, or post a
  // toolpath (that stays in `runCamForOp` + the engine + the carvera_4axis.hbs
  // post, all untouched here). Enablement gating (rotary ops require `mill4`,
  // etc.) lives in `cam-commands.ts` `camCommandEnabled`.
  const camActions = useMemo<CamCommandActions>(
    () => ({
      openSetup: () => {
        setPanelTab('setup')
        setRequestedStage('setup')
      },
      newOperation: (kind: string) => {
        // The kind is already the runtime `cnc_*` op kind (cam-commands maps the
        // catalog id via CAM_COMMAND_OP_KIND before calling this). Seed it on the
        // active plate; the workspace navigates to Plan to surface the new op.
        setRequestedNewOpKind(kind)
      },
      openProbing: () => setRequestedStage('probing'),
      openSimulate: () => {
        setPanelTab('simulate')
        setRequestedStage('simulate')
      },
      openSend: () => {
        setPanelTab('cam')
        setRequestedStage('send')
      },
      openMultiSetup: () => {
        // The Multi-Setup Wizard is mounted inside the 4-axis Setup tab body.
        setPanelTab('setup')
        setRequestedStage('setup')
      },
      openToolLibrary: () => setPanelTab('tools')
    }),
    []
  )

  // Register on the shared registry; dispose on unmount so a host remount never
  // double-registers (the effect returns `registerCamCommands`'s disposer).
  useEffect(() => registerCamCommands(camActions), [camActions])

  // ── FDM (K2 Plus) ribbon go-live (Wave 3b) ────────────────────────────────
  // Register the FDM slicer-ribbon command handlers on the shared registry
  // (mirrors the CAM wiring above). The action bag is the seam between a
  // catalog `command.id` and real shell behavior:
  //   - openProcess / openSupports / openPreview / openDevice navigate the
  //     workspace's FDM workflow-stage strip via the one-shot `requestedStage`
  //     prop (the Process editor + Supports toggle live in the Device stage).
  //   - slicePlate / sliceAll defer to the host's proven `handleRunSlice`
  //     OrcaSlicer path (behind which the per-slice temperature clamp +
  //     pre-upload `validateGcodeFileTemps` gate still run). They emit no
  //     G-code here.
  //   - jobPause / jobResume / jobCancel call the existing Moonraker job IPC
  //     on the configured printer URL. No temperature targets move.
  //   - arrange runs the host's `handleArrangeParts`, which drives the EXISTING
  //     true-shape nesting engine (`nesting:nestPolygons` — the same engine the
  //     LagunaNestingPanel uses) over the active plate's nestable contour ops
  //     and reports the layout. importModel / autoOrient still surface an honest
  //     advisory: the mesh-binding import is workspace-internal and FDM
  //     auto-orient (overhang-minimizing mesh analysis) is not yet built, so
  //     those entry points greet the operator with the right place to act rather
  //     than pretending. Enablement gating (FDM machine + Manufacture route)
  //     lives in `fdm-commands.ts`.
  const handleFdmJobControl = useCallback(
    (verb: 'pause' | 'resume' | 'cancel'): void => {
      const url = settings?.moonrakerUrl?.trim() ?? ''
      if (url.length === 0) {
        pushToast('warn', 'Add a Moonraker URL in Settings to control the running print.')
        return
      }
      void (async () => {
        try {
          const call =
            verb === 'pause'
              ? fab().moonrakerPause(url)
              : verb === 'resume'
                ? fab().moonrakerResume(url)
                : fab().moonrakerCancel(url)
          const r = await call
          if (r.ok) pushToast('ok', `K2 Plus: ${verb} sent.`)
          else pushToast('err', `K2 Plus ${verb} failed`, r.error)
        } catch (e) {
          pushToast('err', `K2 Plus ${verb} failed`, e instanceof Error ? e.message : String(e))
        }
      })()
    },
    [settings, pushToast]
  )

  // ── Auto-arrange (REUSES the existing true-shape nesting engine) ──────────
  // Drives the SAME `nesting:nestPolygons` engine the LagunaNestingPanel uses:
  // it loads the live plan, collects the active plate's nestable `cnc_contour`
  // polygons via `extractNestableParts` (a byte-for-byte mirror of the panel's
  // `nestableParts`), and runs the nester over them. It does NOT reimplement
  // bin-packing. The placements are reported; applying them back onto the ops
  // (the workspace-internal `applyNestingPlacements`) stays in the dedicated
  // nesting panel, which the operator reaches via the router `nest` ribbon
  // entry. SAFETY: no G-code — the engine returns placement coordinates only.
  const handleArrangeParts = useCallback((): void => {
    if (!projectDir) {
      pushToast('warn', 'Open a project before auto-arranging the plate.')
      return
    }
    void (async () => {
      let mfg: ManufactureFile
      try {
        mfg = await fab().manufactureLoad(projectDir)
      } catch {
        pushToast('err', 'Failed to load the manufacture plan for arranging.')
        return
      }
      const plate = getActivePlate(mfg, null)
      const parts = extractNestableParts(plate.operations)
      if (parts.length === 0) {
        pushToast(
          'warn',
          'No nestable contour parts on the plate. Derive cnc_contour geometry first (auto-arrange nests 2D contour outlines).'
        )
        return
      }
      try {
        const response = await fab().nestingNestPolygons({
          parts: parts.map((pt) => ({ id: pt.id, points: pt.points })),
          sheet: {
            widthMm: ARRANGE_DEFAULT_SHEET_W_MM,
            heightMm: ARRANGE_DEFAULT_SHEET_H_MM,
            marginMm: ARRANGE_SHEET_MARGIN_MM
          },
          opts: {
            engine: 'nfp',
            partMarginMm: ARRANGE_PART_MARGIN_MM,
            allowedRotations: [0, 90, 180, 270],
            maxSheets: 8
          }
        })
        if (!response.ok) {
          pushToast('err', 'Auto-arrange failed', response.hint ?? response.error)
          return
        }
        const r = response.result
        const placed = r.placements.length
        const unplaced = r.unplaced.length
        pushToast(
          unplaced > 0 ? 'warn' : 'ok',
          `Arranged ${placed}/${parts.length} part(s) at ${r.utilizationPct}% utilization` +
            (unplaced > 0 ? ` (${unplaced} did not fit).` : '.') +
            ` Open the nesting panel to apply the layout.`
        )
      } catch (e) {
        pushToast('err', 'Auto-arrange failed', e instanceof Error ? e.message : String(e))
      }
    })()
  }, [projectDir, pushToast])

  const fdmActions = useMemo<FdmCommandActions>(
    () => ({
      importModel: () =>
        pushToast(
          'warn',
          'Import a mesh from the Manufacture → Plan tab (bind an STL to an FDM slice op).'
        ),
      arrange: () => handleArrangeParts(),
      autoOrient: () => pushToast('warn', 'Auto-orient is coming — set part orientation in Design for now.'),
      openSupports: () => setRequestedStage('device'),
      openProcess: () => setRequestedStage('device'),
      openPreview: () => setRequestedStage('preview'),
      openDevice: () => setRequestedStage('device'),
      slicePlate: () => handleRunSlice(),
      sliceAll: () => handleRunSlice(),
      jobPause: () => handleFdmJobControl('pause'),
      jobResume: () => handleFdmJobControl('resume'),
      jobCancel: () => handleFdmJobControl('cancel')
    }),
    [pushToast, handleRunSlice, handleFdmJobControl, handleArrangeParts]
  )

  useEffect(() => registerFdmCommands(fdmActions), [fdmActions])

  // ── Laguna router (VCarve 2.5D) ribbon go-live (Wave 3d) ──────────────────
  // Register the router slicer-ribbon command handlers on the shared registry
  // (mirrors the CAM + FDM wiring above). The action bag is the seam between a
  // catalog `command.id` and real shell behavior:
  //   - importVectorsDxf bumps `requestedDxfImportNonce`, asking the workspace to
  //     run its `importVectorsFromDxf` data path (file picker → `dxf:import` →
  //     fold into the project sketch via `dxfToSketch` → `design:save`). The
  //     imported closed loops then feed the op editor's "Derive from sketch".
  //   - opProfile / opPocket / opVcarve / opDrill seed a new op by pushing the
  //     concrete `cnc_*` kind (from ROUTER_COMMAND_OP_KIND) down through
  //     `requestedNewOpKind` — the SAME one-shot seam the CAM ribbon uses. The
  //     V-carve row seeds the NEW `cnc_vcarve` op (medial-axis variable depth),
  //     NOT `cnc_chamfer` (the gap-audit bug).
  //   - nest opens the Plan tab (the LagunaNestingPanel lives there) on the Setup
  //     stage; simulate / post navigate the workflow-stage strip.
  // SAFETY: these handlers only OPEN authoring surfaces / seed an op kind — they
  // never generate, mutate, or post a toolpath. Laguna toolpath generation + the
  // vcarve_mach3.hbs RichAuto/Mach3 invariants (% markers, G21/G90/G17, M3 warm-up
  // G4 P2, M5+G4 P3 cool-down, dust M7/M9, safe-Z, M30 end) + the V-carve depth
  // cap to stock thickness all live downstream and are untouched here. Enablement
  // gating (router machine + Manufacture route) lives in `router-commands.ts`.
  const routerActions = useMemo<RouterCommandActions>(
    () => ({
      importVectorsDxf: () => {
        // Surface the op list (Plan) so the operator sees where derived geometry
        // lands, then trigger the workspace's import data path.
        setPanelTab('plan')
        setRequestedDxfImportNonce((n) => n + 1)
      },
      opProfile: () => setRequestedNewOpKind(ROUTER_COMMAND_OP_KIND[ROUTER_OP_PROFILE_COMMAND_ID] ?? 'cnc_contour'),
      opPocket: () => setRequestedNewOpKind(ROUTER_COMMAND_OP_KIND[ROUTER_OP_POCKET_COMMAND_ID] ?? 'cnc_pocket'),
      opVcarve: () => setRequestedNewOpKind(ROUTER_COMMAND_OP_KIND[ROUTER_OP_VCARVE_COMMAND_ID] ?? 'cnc_vcarve'),
      opDrill: () => setRequestedNewOpKind(ROUTER_COMMAND_OP_KIND[ROUTER_OP_DRILL_COMMAND_ID] ?? 'cnc_drill'),
      nest: () => {
        // The true-shape nesting panel is rendered in the Plan tab body.
        setPanelTab('plan')
        setRequestedStage('setup')
      },
      simulate: () => {
        setPanelTab('simulate')
        setRequestedStage('simulate')
      },
      post: () => {
        setPanelTab('cam')
        setRequestedStage('send')
      }
    }),
    []
  )

  useEffect(() => registerRouterCommands(routerActions), [routerActions])

  return (
    <div className="wt-workspace-host">
      <ManufactureWorkspace
        projectDir={projectDir}
        machines={machines}
        tools={null}
        projectTools={null}
        machineTools={null}
        activeMachineId={activeMachineId}
        panelTab={panelTab}
        onPanelTabChange={setPanelTab}
        reloadNonce={reloadNonce}
        settings={settings}
        project={project}
        sliceOut=""
        camOut=""
        camLastHint=""
        importText={importText}
        onImportTextChange={setImportText}
        onSaveSettingsField={handleSaveSettingsField}
        onRunSlice={handleRunSlice}
        onRunCam={handleRunCam}
        onImportTools={handleImportTools}
        onImportToolLibraryFromFile={handleImportToolLibraryFromFile}
        onGoSettings={handleGoSettings}
        onGoProject={handleGoProject}
        requestedStage={requestedStage}
        onRequestedStageHandled={() => setRequestedStage(null)}
        requestedNewOpKind={requestedNewOpKind}
        onRequestedNewOpKindHandled={() => setRequestedNewOpKind(null)}
        requestedDxfImportNonce={requestedDxfImportNonce}
        onRequestedDxfImportHandled={() => {
          /* nonce is monotonic; nothing to reset — the workspace effect keys on the change */
        }}
        requestedMeshImport={requestedMeshImport}
        onRequestedMeshImportHandled={handleRequestedMeshImportHandled}
      />
    </div>
  )
}
