/**
 * useProjectSession — the new WorkTrack3D shell's project open/create hook.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 * ──────────────────────────────────────────────────────────────────────────
 * The new app shell (`src/renderer/app/*`) had no project-open/create flow.
 * `ManufactureHost` derived `projectDir` solely from `settings.lastProjectPath`,
 * which nothing in the new shell ever set — so `projectDir` was effectively
 * always `null`. Because the FDM slice path derives its output as
 * `${projectDir}/output/slice.gcode`, a real `projectDir` is the hard
 * prerequisite for ever producing G-code from the new shell. This hook is that
 * missing piece: it owns `{ projectDir, project }` state and exposes
 * `openProject` / `newProject` / `refresh`, persisting the choice back to
 * `settings.lastProjectPath` so the rest of the shell can read it.
 *
 * It does NOT generate, post, or upload any G-code — it only manages the
 * `project.json` directory binding. The CAM plan persists through the separate
 * `manufacture:*` channel; design-model writes go through `project:save`. This
 * hook stays strictly in the open/create/read lane.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * fab() IPC METHODS USED (all flat on `window.fab`, verified against
 * src/preload/index.ts):
 *   - fab().projectOpenDir()                    → 'project:openDir'  (native dir picker)
 *   - fab().projectRead(dir)                    → 'project:read'
 *   - fab().projectCreate({ dir, name, machineId }) → 'project:create'
 *   - fab().settingsGet()                       → 'settings:get'
 *   - fab().settingsSet(partial)                → 'settings:set'
 * ──────────────────────────────────────────────────────────────────────────
 */
import { useCallback, useEffect, useState } from 'react'
import { fab } from '../src/shop-types'
import { useToast } from '../contexts/ToastContext'
import { useMachineSession } from '../contexts/MachineSessionContext'
import type { ProjectFile } from '../../shared/project-schema'

/** Public shape returned by {@link useProjectSession}. */
export interface ProjectSession {
  /** Absolute directory holding `project.json`, or `null` when no project is open. */
  readonly projectDir: string | null
  /** The parsed, migrated project file, or `null` when no project is open. */
  readonly project: ProjectFile | null
  /** Pick a directory via the native dialog and read its `project.json`. */
  readonly openProject: () => Promise<void>
  /**
   * Create a new project. When `settings.projectsRoot` is set, a child folder
   * named after the project is created under it; otherwise the native
   * directory picker is used to choose the target folder.
   */
  readonly newProject: (name?: string) => Promise<void>
  /** Re-read the currently-open `project.json` from disk (no-op if none open). */
  readonly refresh: () => Promise<void>
}

/** Default name applied when `newProject()` is called without one. */
const DEFAULT_PROJECT_NAME = 'Untitled project'

/**
 * Read a string-valued field off the loose `settings:get` record.
 *
 * `fab().settingsGet()` is typed as `{ ...; [k: string]: unknown }`, so
 * `projectsRoot` / `lastProjectPath` arrive as `unknown` and must be narrowed
 * before use. Returns `null` for anything that is not a non-empty string.
 */
function readStringField(
  settings: Record<string, unknown> | null | undefined,
  key: string
): string | null {
  if (!settings) return null
  const v = settings[key]
  return typeof v === 'string' && v.length > 0 ? v : null
}

/**
 * Sanitize a project name into a filesystem-safe folder segment. Strips
 * path separators and reserved characters, collapses whitespace to single
 * underscores, and falls back to `project` when nothing usable remains.
 */
function toFolderName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, '_')
    .replace(/^[._]+|[._]+$/g, '')
  return cleaned.length > 0 ? cleaned : 'project'
}

/**
 * Join an absolute root with a child segment using the separator the root
 * already uses (so Windows `\` paths stay `\` and POSIX `/` stays `/`).
 * The renderer cannot import `node:path`, so this infers the separator.
 */
function joinUnderRoot(root: string, child: string): string {
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/'
  const trimmed = root.replace(/[\\/]+$/, '')
  return `${trimmed}${sep}${child}`
}

export function useProjectSession(): ProjectSession {
  const { pushToast } = useToast()
  const { sessionMachine, lastMachineId, machines } = useMachineSession()

  const [projectDir, setProjectDir] = useState<string | null>(null)
  const [project, setProject] = useState<ProjectFile | null>(null)

  /**
   * Resolve the machine id to stamp into a freshly-created project. The
   * `project:create` handler requires a non-empty id (Zod `.trim().min(1)`),
   * so we prefer the live session machine, then the last-used id, then the
   * first machine in the library.
   */
  const resolveMachineId = useCallback((): string | null => {
    return sessionMachine?.id ?? lastMachineId ?? machines[0]?.id ?? null
  }, [sessionMachine, lastMachineId, machines])

  /**
   * Read `project.json` from `dir`, set state, and persist the binding to
   * settings. Shared by `openProject`, `newProject`, and initial hydration.
   * Returns the loaded file, or `null` on failure (caller decides whether to
   * surface a toast — initial hydration tolerates a missing/stale path).
   */
  const loadFromDir = useCallback(
    async (dir: string, opts?: { persistMachine?: boolean }): Promise<ProjectFile | null> => {
      const pf = await fab().projectRead(dir)
      setProjectDir(dir)
      setProject(pf)
      const partial: Record<string, unknown> = { lastProjectPath: dir }
      if (opts?.persistMachine && pf.activeMachineId) {
        partial.lastMachineId = pf.activeMachineId
      }
      await fab().settingsSet(partial)
      return pf
    },
    []
  )

  const openProject = useCallback(async (): Promise<void> => {
    try {
      const dir = await fab().projectOpenDir()
      if (!dir) return // user cancelled the dialog
      await loadFromDir(dir, { persistMachine: true })
    } catch (e) {
      console.error(e)
      pushToast('err', 'Failed to open project')
    }
  }, [loadFromDir, pushToast])

  const newProject = useCallback(
    async (name?: string): Promise<void> => {
      try {
        const machineId = resolveMachineId()
        if (!machineId) {
          pushToast('err', 'Select a machine before creating a project')
          return
        }

        const projectName = (name ?? '').trim() || DEFAULT_PROJECT_NAME

        // Choose the target directory. Prefer a child of `projectsRoot`; fall
        // back to the native picker when no root is configured. The main
        // `project:create` handler mkdir's the directory recursively.
        let dir: string | null = null
        const settings = (await fab().settingsGet()) as Record<string, unknown>
        const projectsRoot = readStringField(settings, 'projectsRoot')
        if (projectsRoot) {
          dir = joinUnderRoot(projectsRoot, toFolderName(projectName))
        } else {
          dir = await fab().projectOpenDir()
          if (!dir) return // user cancelled the dialog
        }

        const pf = await fab().projectCreate({ dir, name: projectName, machineId })
        setProjectDir(dir)
        setProject(pf)
        await fab().settingsSet({ lastProjectPath: dir, lastMachineId: machineId })
      } catch (e) {
        console.error(e)
        pushToast('err', 'Failed to create project')
      }
    },
    [resolveMachineId, pushToast]
  )

  const refresh = useCallback(async (): Promise<void> => {
    if (!projectDir) return
    try {
      const pf = await fab().projectRead(projectDir)
      setProject(pf)
    } catch (e) {
      console.error(e)
      pushToast('err', 'Failed to reload project')
    }
  }, [projectDir, pushToast])

  // Initial hydration: adopt `settings.lastProjectPath` if it still points at a
  // readable project. Tolerate failure (the directory may have moved or been
  // deleted) by leaving state `null` without a toast — a missing recent project
  // is not an error worth interrupting the operator over.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const settings = (await fab().settingsGet()) as Record<string, unknown>
        const last = readStringField(settings, 'lastProjectPath')
        if (!last || cancelled) return
        const pf = await fab().projectRead(last)
        if (cancelled) return
        setProjectDir(last)
        setProject(pf)
      } catch {
        // Stale / missing recent project — stay null, no toast.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return { projectDir, project, openProject, newProject, refresh }
}
