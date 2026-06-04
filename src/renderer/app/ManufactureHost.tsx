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
 * SAFETY: ADVISORY-ONLY G-CODE GENERATION ("G-code is sacred")
 * ──────────────────────────────────────────────────────────────────────────
 * In this increment the host does **NOT** generate, post, or upload any
 * G-code. `onRunSlice` and `onRunCam` are wired to advisory toasts ONLY — they
 * never invoke the slice / camRun / post IPC paths. Operators must continue to
 * generate & post G-code from the classic shell (the default build) until the
 * generation path through the new shell is brought online behind the
 * gcode-safety quality gate. Wiring real generation here is an explicit,
 * separate, gcode-safety-gated follow-up task.
 *
 * Tool-library props (`tools` / `projectTools` / `machineTools`) are passed as
 * `null`: the MachineSessionContext exposes `machineTools` as a `ToolRecord[]`,
 * but ManufactureWorkspace expects a `ToolLibraryFile` (a different,
 * file-shaped type). Rather than fabricate a partial library here, the host
 * passes `null` for all three until a real `ToolLibraryFile` source is wired.
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { ManufactureWorkspace } from '../manufacture/ManufactureWorkspace'
import { useMachineSession } from '../contexts/MachineSessionContext'
import { useToast } from '../contexts/ToastContext'
import { fab } from '../src/shop-types'
import { appSettingsSchema, type AppSettings } from '../../shared/project-schema'
import type { ManufacturePanelTab } from '../shell/workspaceMemory'

/** Advisory shown when generation is attempted from the not-yet-wired shell. */
const GENERATION_ADVISORY =
  'G-code generation from the new shell is being wired with full safety ' +
  'validation — for now generate & post G-code from the classic shell ' +
  '(the default build).'

/** Advisory shown for tool-import affordances not yet wired in the new shell. */
const TOOL_IMPORT_ADVISORY =
  'Tool import from the new shell is coming — use Utilities → Library for now.'

/** Advisory shown for the Settings / Project navigation affordances. */
const NAVIGATE_ADVISORY = 'Open Settings / your project from the top bar.'

/** Default sub-tab when the host first mounts — the "Plan" job overview. */
const DEFAULT_PANEL_TAB: ManufacturePanelTab = 'plan'

export function ManufactureHost(): ReactElement {
  const { machines, sessionMachine } = useMachineSession()
  const { pushToast } = useToast()

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

  // ── Advisory-only handlers (NO G-code generation in this increment) ───────
  const handleRunSlice = useCallback((): void => {
    pushToast('warn', GENERATION_ADVISORY)
  }, [pushToast])

  const handleRunCam = useCallback((): void => {
    // The ctx ({ mfg, selectedOpIndex }) is intentionally ignored — this path
    // must not touch any toolpath/post IPC until it is gcode-safety-gated.
    pushToast('warn', GENERATION_ADVISORY)
  }, [pushToast])

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
        projectDir={settings?.lastProjectPath ?? null}
        machines={machines}
        tools={null}
        projectTools={null}
        machineTools={null}
        activeMachineId={sessionMachine?.id ?? null}
        panelTab={panelTab}
        onPanelTabChange={setPanelTab}
        settings={settings}
        project={null}
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
