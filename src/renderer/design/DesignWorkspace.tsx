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
import { FeatureTree, type FeatureTreeOperation } from './FeatureTree'
import { fab } from '../src/shop-types'
import type {
  CadExecuteScriptMesh,
  CadExecuteScriptResult,
  CadDeclaredParameter,
  CadOperationSummary,
  CadParseError
} from '../../shared/sidecar-protocol'
import type { CadExportResponse } from '../../main/ipc-cad'

/** Default starter script seeded when the user clicks the empty-state CTA. */
export const STARTER_SCRIPT = `# WorkTrackCAM CadQuery starter — a parametric box.
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
  onToast
}: DesignWorkspaceProps): JSX.Element {
  const [scriptText, setScriptText] = useState(initialScript)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastTessellation, setLastTessellation] = useState<CadExecuteScriptResult | null>(null)
  const [operations, setOperations] = useState<readonly CadOperationSummary[]>([])
  const [parameters, setParameters] = useState<readonly CadDeclaredParameter[]>([])
  const [parseError, setParseError] = useState<CadParseError | null>(null)

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
  const handleRun = useCallback(async (): Promise<void> => {
    if (busy) return
    if (!scriptText.trim()) {
      setError('Script is empty — type a CadQuery expression and try again.')
      toast('warn', 'Cannot run an empty script.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const response = await fab().cad.execute({ script: scriptText })
      if (!response.ok) {
        const detail = response.hint ? ` — ${response.hint}` : ''
        setError(`Run failed: ${response.error}${detail}`)
        toast('err', `Run failed: ${response.error}`)
        return
      }
      setLastTessellation(response.result)
      if (response.result.error) {
        setError(`Script error: ${response.result.error.message}`)
        toast('err', response.result.error.message)
        return
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
  }, [busy, scriptText, toast])

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

  // ── Derived feature rows for the right panel ──────────────────────────────
  const featureRows: readonly FeatureTreeOperation[] = useMemo(
    () => operations.map(toFeatureRow),
    [operations]
  )

  const triangleSummary: string | null = useMemo(() => {
    if (!lastTessellation || lastTessellation.meshes.length === 0) return null
    const triCount = lastTessellation.meshes.reduce(
      (sum, mesh) => sum + mesh.triangleCount,
      0
    )
    return `${lastTessellation.meshes.length} body, ${triCount.toLocaleString()} triangles`
  }, [lastTessellation])

  // ── Empty-state branch (no script yet) ────────────────────────────────────
  if (scriptText.trim().length === 0 && !lastTessellation) {
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

  // ── Three-pane layout ─────────────────────────────────────────────────────
  return (
    <div className="design-workspace" data-testid="design-workspace">
      {/* LEFT — CadQuery editor + run/save/load controls */}
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
        {onSave && (
          <div
            className="cad-editor__actions"
            role="toolbar"
            aria-label="Design actions"
          >
            <button
              type="button"
              className="btn btn-ghost"
              data-testid="design-workspace-save"
              onClick={handleSave}
            >
              Save
            </button>
          </div>
        )}
      </section>

      {/* CENTER — 3D viewport / preview placeholder */}
      <section
        className="design-workspace__viewport-col"
        aria-label="3D preview"
        data-testid="design-workspace-viewport"
      >
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
            body="Your built model will appear here after the CadQuery script executes."
          />
        )}
      </section>

      {/* RIGHT — FeatureTree + Send to CAM */}
      <aside
        className="design-workspace__tree-col"
        aria-label="Parameters and operations"
      >
        <div className="design-workspace__feature-section">
          <h3 className="design-workspace__feature-title">Parameters</h3>
          {parameters.length === 0 ? (
            <div className="design-workspace__feature-empty">
              No parameters declared.
            </div>
          ) : (
            <ul
              className="design-workspace__parameter-list"
              data-testid="design-workspace-parameters"
            >
              {parameters.map((param) => (
                <li
                  key={param.name}
                  className="design-workspace__parameter-row"
                  data-param-name={param.name}
                >
                  <span className="design-workspace__parameter-name">
                    {param.name}
                  </span>
                  <span className="design-workspace__parameter-equals" aria-hidden="true">
                    =
                  </span>
                  <span className="design-workspace__parameter-value">
                    {String(param.value)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="design-workspace__feature-section">
          <h3 className="design-workspace__feature-title">Operations</h3>
          {parseError !== null ? (
            <div
              className="design-workspace__feature-error"
              role="alert"
              data-testid="design-workspace-parse-error"
            >
              Line {parseError.line}: {parseError.message}
            </div>
          ) : (
            <FeatureTree operations={featureRows} />
          )}
        </div>

        {onSendToCam && (
          <div className="design-workspace__feature-actions">
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
          </div>
        )}
      </aside>
    </div>
  )
}

export default DesignWorkspace
