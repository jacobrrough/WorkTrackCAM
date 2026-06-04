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
import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { ManufactureWorkspace } from '../manufacture/ManufactureWorkspace'
import { useMachineSession } from '../contexts/MachineSessionContext'
import { useToast } from '../contexts/ToastContext'
import { fab } from '../src/shop-types'
import { appSettingsSchema, type AppSettings } from '../../shared/project-schema'
import type { ManufacturePanelTab } from '../shell/workspaceMemory'
import { useProjectSession } from './useProjectSession'
import { runCamForOp } from '../manufacture/run-cam-for-op'
import { runSliceForOp } from '../manufacture/run-slice-for-op'
import { getPlates } from '../manufacture/plate-state'
import type { ManufactureFile, ManufactureOperation } from '../../shared/manufacture-schema'

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

/** Advisory shown for tool-import affordances not yet wired in the new shell. */
const TOOL_IMPORT_ADVISORY =
  'Tool import from the new shell is coming — use Utilities → Library for now.'

/** Advisory shown for the Settings / Project navigation affordances. */
const NAVIGATE_ADVISORY = 'Open Settings / your project from the top bar.'

/** Default sub-tab when the host first mounts — the "Plan" job overview. */
const DEFAULT_PANEL_TAB: ManufacturePanelTab = 'plan'

export function ManufactureHost(): ReactElement {
  const { machines, sessionMachine, materials } = useMachineSession()
  const { pushToast } = useToast()

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

  const handleImportTools = useCallback((): void => {
    pushToast('warn', TOOL_IMPORT_ADVISORY)
  }, [pushToast])

  const handleImportToolLibraryFromFile = useCallback((): void => {
    pushToast('warn', TOOL_IMPORT_ADVISORY)
  }, [pushToast])

  const handleGoSettings = useCallback((): void => {
    pushToast('warn', NAVIGATE_ADVISORY)
  }, [pushToast])

  const handleGoProject = useCallback((): void => {
    pushToast('warn', NAVIGATE_ADVISORY)
  }, [pushToast])

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
      />
    </div>
  )
}
