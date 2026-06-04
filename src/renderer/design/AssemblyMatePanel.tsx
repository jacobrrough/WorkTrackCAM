/**
 * AssemblyMatePanel — CAD V1 mate-creation surface.
 *
 * A self-contained panel that lets the operator define a single assembly mate
 * (point / axis / plane), push it through the `cad.add_assembly_mate` bridge
 * (now backed by the fixed CadQuery solve — see `engines/cad/cadquery_assembly.py`
 * `_apply_mate_constraint`), and read back either a **solved** badge (the parts
 * moved; the post-solve bbox confirms it) or a **structured error** badge
 * (over-constrained / bad-params) using the same wording family as the
 * `design-assembly__solver-badge` in `AssemblyView.tsx`.
 *
 * Why a NEW panel (not the existing `AssemblyView` mate modal)?
 * ------------------------------------------------------------
 * The `AssemblyView` modal collects **face ids** (`AssemblyMate.feature1/2:
 * number`) and is heavily pinned by `__tests__/AssemblyView.test.tsx` (the
 * `(#{feature1})` summary, the `feature1` number inputs). The
 * `cad.add_assembly_mate` solver, by contrast, consumes **3-vectors** (point /
 * axis / plane normal in each child's local frame — `CadAssemblyMate`). Rather
 * than break the AssemblyView pins by reshaping its inputs, this panel collects
 * the Model-B vectors directly and maps them 1:1 onto the wire via the pure
 * `assembly-mate-form.ts` module. Wiring this panel into the Assembly tab is a
 * follow-up (the "Wire phase"); this cycle ships the surface + its bridge call.
 *
 * Contract (pinned by `__tests__/AssemblyMatePanel.test.tsx`)
 * ----------------------------------------------------------
 *   1. Root carries `data-testid="assembly-mate-panel"` + BEM class
 *      `assembly-mate-panel` (theme-driven; no inline styles).
 *   2. The kind picker (`assembly-mate-kind`) + the two part selects
 *      (`assembly-mate-part1` / `-part2`) are always present when ≥1 part.
 *   3. The per-kind vector inputs carry stable testids:
 *      `assembly-mate-point1-{0,1,2}`, `-point2-*`, `-axis1-*`, `-axis2-*`,
 *      `-normal1-*`, `-normal2-*` (only the subset the active kind needs).
 *   4. The "Solve mate" button (`assembly-mate-solve`) is disabled when fewer
 *      than two parts exist OR no assembly handle is available.
 *   5. The solver badge (`assembly-mate-badge`) reuses the
 *      `design-assembly__solver-badge--{status}` modifier family.
 *   6. No `any`, props are `readonly`, errors fold into the badge / inline
 *      field error — never thrown. The bridge is only touched inside the
 *      click handler, so `renderToStaticMarkup` never calls IPC.
 */

import { useCallback, useMemo, useState, type JSX } from 'react'
import { fab } from '../src/shop-types'
import type { AssemblyPart } from './AssemblyView'
import type { CadAssemblyMateKind } from '../../shared/sidecar-protocol'
import {
  buildAddMateRequest,
  makeMateFormDraft,
  mateOutcomeToBadge,
  narrowAddMateResponse,
  IDLE_MATE_BADGE,
  SOLVING_MATE_BADGE,
  type MateBadgeView,
  type MateFormDraft,
  type MateFormField,
  type VectorDraft,
} from './assembly-mate-form'

/**
 * A mate that successfully solved — handed back to the host so it can persist
 * it (typically into the assembly's `mateConstraints` list, Model C) and append
 * a row to the AssemblyView Mates panel. Carries the renderer-owned id + the
 * full draft so the host has everything it needs without re-reading the form.
 */
export type SolvedMate = {
  /** Renderer-owned stable id (UUID-ish). */
  readonly id: string
  /** The draft that produced the solved mate (part ids + kind + vectors). */
  readonly draft: MateFormDraft
}

export interface AssemblyMatePanelProps {
  /** Parts available to mate (same list the AssemblyView renders). */
  readonly parts: readonly AssemblyPart[]
  /**
   * Opaque assembly handle from a prior `cad.create_assembly` round-trip. When
   * `null`, the panel renders but the Solve button is disabled with a hint
   * (the host hasn't built the assembly yet). The host owns this handle.
   */
  readonly assemblyHandle: string | null
  /**
   * Fired after a mate solves successfully. The host persists the mate (e.g.
   * into `assembly.json` via the Model-C `mateConstraints` array) and may
   * re-frame the viewport. Optional — when omitted the panel still solves and
   * shows the badge, just without host-side persistence.
   */
  readonly onMateAdded?: (mate: SolvedMate) => void
  /** Toast hook from the host. Optional — falls back to a no-op. */
  readonly onToast?: (kind: 'ok' | 'err' | 'warn', message: string) => void
  /**
   * Render-pin escape hatch: seed the form draft so a static render can assert
   * the per-kind inputs without simulating a kind switch. Defaults to a fresh
   * point-mate draft seeded with the first two parts.
   */
  readonly initialDraft?: MateFormDraft
  /**
   * Render-pin escape hatch: seed the solver badge so a static render can
   * assert badge text without calling the bridge. Defaults to the idle badge.
   */
  readonly initialBadge?: MateBadgeView
}

/** Labels for the kind picker — matches the AssemblyView modal capitalization. */
const KIND_LABELS: Record<CadAssemblyMateKind, string> = {
  point: 'Point',
  axis: 'Axis',
  plane: 'Plane',
}

/** Kind options in declaration order (point first — the common case). */
const KINDS: readonly CadAssemblyMateKind[] = ['point', 'axis', 'plane']

/** Per-cell axis labels for the vector inputs. */
const CELL_LABELS: readonly ['X', 'Y', 'Z'] = ['X', 'Y', 'Z']

export function AssemblyMatePanel({
  parts,
  assemblyHandle,
  onMateAdded,
  onToast,
  initialDraft,
  initialBadge,
}: AssemblyMatePanelProps): JSX.Element {
  const firstId = parts[0]?.id ?? ''
  const secondId = parts.find((p) => p.id !== firstId)?.id ?? ''

  const [draft, setDraft] = useState<MateFormDraft>(
    initialDraft ?? makeMateFormDraft(firstId, secondId),
  )
  const [badge, setBadge] = useState<MateBadgeView>(initialBadge ?? IDLE_MATE_BADGE)
  const [fieldError, setFieldError] = useState<{ field: MateFormField; message: string } | null>(
    null,
  )
  const [solving, setSolving] = useState(false)

  const toast = useCallback(
    (kind: 'ok' | 'err' | 'warn', message: string): void => {
      onToast?.(kind, message)
    },
    [onToast],
  )

  const partNameById = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {}
    for (const p of parts) out[p.id] = p.name
    return out
  }, [parts])

  // ── Controlled-input setters (pure draft updates) ──────────────────────────
  const setKind = useCallback((kind: CadAssemblyMateKind): void => {
    setDraft((d) => ({ ...d, kind }))
    setFieldError(null)
  }, [])

  const setPart = useCallback((side: 1 | 2, id: string): void => {
    setDraft((d) => (side === 1 ? { ...d, part1Id: id } : { ...d, part2Id: id }))
    setFieldError(null)
  }, [])

  const setVectorCell = useCallback(
    (slot: keyof MateFormDraft, index: 0 | 1 | 2, value: string): void => {
      setDraft((d) => {
        const current = d[slot]
        if (!Array.isArray(current)) return d
        const next: [string, string, string] = [current[0], current[1], current[2]]
        next[index] = value
        return { ...d, [slot]: next as VectorDraft }
      })
      setFieldError(null)
    },
    [],
  )

  // ── Solve handler — build request, call bridge, map to badge ────────────────
  const canSolve = parts.length >= 2 && typeof assemblyHandle === 'string' && assemblyHandle.length > 0
  const solveDisabled = !canSolve || solving

  const handleSolve = useCallback((): void => {
    if (solveDisabled) return
    const built = buildAddMateRequest(assemblyHandle ?? '', draft)
    if (!built.ok) {
      setFieldError({ field: built.field, message: built.message })
      setBadge({ label: built.message, status: 'error' })
      return
    }
    setFieldError(null)
    setBadge(SOLVING_MATE_BADGE)
    setSolving(true)

    const cadBridge = (fab() as unknown) as {
      cad?: { addAssemblyMate?: (payload: Record<string, unknown>) => Promise<unknown> }
    }
    const addMate = cadBridge.cad?.addAssemblyMate
    if (!addMate) {
      setSolving(false)
      const view: MateBadgeView = {
        label: 'Mate failed: bridge_unavailable',
        status: 'error',
        detail: 'cad.addAssemblyMate bridge not available — IPC handler pending.',
      }
      setBadge(view)
      return
    }

    // The wire payload is the typed request cast to the permissive bridge
    // surface (`Record<string, unknown>`); `JSON.stringify`-safe by construction.
    const payload = built.request as unknown as Record<string, unknown>
    void addMate(payload)
      .then((raw) => {
        setSolving(false)
        const outcome = narrowAddMateResponse(raw)
        const view = mateOutcomeToBadge(outcome)
        setBadge(view)
        if (outcome.ok) {
          const id = `mate-${Date.now().toString(36)}-${Math.floor(Math.random() * 1_000_000).toString(36)}`
          onMateAdded?.({ id, draft })
          toast('ok', `Mate solved: ${KIND_LABELS[draft.kind]}`)
        } else {
          toast('err', `Mate failed: ${outcome.error}`)
        }
      })
      .catch((e: unknown) => {
        setSolving(false)
        const message = e instanceof Error ? e.message : String(e)
        setBadge({ label: `Mate threw: ${message}`, status: 'error' })
        toast('err', `Mate threw: ${message}`)
      })
  }, [solveDisabled, assemblyHandle, draft, onMateAdded, toast])

  // ── Badge BEM modifier (mirrors design-assembly__solver-badge--*) ──────────
  const badgeModifier = `design-assembly__solver-badge--${badgeStatusToModifier(badge.status)}`

  return (
    <div className="assembly-mate-panel" data-testid="assembly-mate-panel">
      <div className="assembly-mate-panel__header">
        <span className="assembly-mate-panel__title">Define mate</span>
        <span
          className={`assembly-mate-panel__badge design-assembly__solver-badge ${badgeModifier}`}
          data-testid="assembly-mate-badge"
          data-status={badge.status}
        >
          {badge.label}
        </span>
      </div>

      {badge.detail !== undefined && (
        <div
          className="assembly-mate-panel__badge-detail"
          data-testid="assembly-mate-badge-detail"
          role="status"
        >
          {badge.detail}
        </div>
      )}

      {parts.length < 2 ? (
        <div className="assembly-mate-panel__hint" data-testid="assembly-mate-need-parts">
          Add a second part before defining a mate.
        </div>
      ) : (
        <div className="assembly-mate-panel__form">
          {/* Kind */}
          <div className="assembly-mate-panel__field">
            <label className="assembly-mate-panel__label" htmlFor="assembly-mate-kind">
              Mate kind
            </label>
            <select
              id="assembly-mate-kind"
              className="assembly-mate-panel__select"
              data-testid="assembly-mate-kind"
              value={draft.kind}
              onChange={(e) => setKind(e.target.value as CadAssemblyMateKind)}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </div>

          {/* Part 1 / Part 2 */}
          <div className="assembly-mate-panel__field">
            <label className="assembly-mate-panel__label" htmlFor="assembly-mate-part1">
              Part 1
            </label>
            <select
              id="assembly-mate-part1"
              className="assembly-mate-panel__select"
              data-testid="assembly-mate-part1"
              value={draft.part1Id}
              onChange={(e) => setPart(1, e.target.value)}
            >
              {parts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="assembly-mate-panel__field">
            <label className="assembly-mate-panel__label" htmlFor="assembly-mate-part2">
              Part 2
            </label>
            <select
              id="assembly-mate-part2"
              className="assembly-mate-panel__select"
              data-testid="assembly-mate-part2"
              value={draft.part2Id}
              onChange={(e) => setPart(2, e.target.value)}
            >
              {parts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Per-kind feature vectors */}
          {draft.kind === 'point' && (
            <>
              <VectorField
                slot="point1"
                label={`Point 1 — ${partNameById[draft.part1Id] ?? draft.part1Id} (mm)`}
                vector={draft.point1}
                onCell={setVectorCell}
              />
              <VectorField
                slot="point2"
                label={`Point 2 — ${partNameById[draft.part2Id] ?? draft.part2Id} (mm)`}
                vector={draft.point2}
                onCell={setVectorCell}
              />
            </>
          )}
          {draft.kind === 'axis' && (
            <>
              <VectorField
                slot="axis1"
                label={`Axis 1 — ${partNameById[draft.part1Id] ?? draft.part1Id} (direction)`}
                vector={draft.axis1}
                onCell={setVectorCell}
              />
              <VectorField
                slot="axis2"
                label={`Axis 2 — ${partNameById[draft.part2Id] ?? draft.part2Id} (direction)`}
                vector={draft.axis2}
                onCell={setVectorCell}
              />
            </>
          )}
          {draft.kind === 'plane' && (
            <>
              <VectorField
                slot="point1"
                label={`Plane 1 origin — ${partNameById[draft.part1Id] ?? draft.part1Id} (mm)`}
                vector={draft.point1}
                onCell={setVectorCell}
              />
              <VectorField
                slot="normal1"
                label="Plane 1 normal"
                vector={draft.normal1}
                onCell={setVectorCell}
              />
              <VectorField
                slot="point2"
                label={`Plane 2 origin — ${partNameById[draft.part2Id] ?? draft.part2Id} (mm)`}
                vector={draft.point2}
                onCell={setVectorCell}
              />
              <VectorField
                slot="normal2"
                label="Plane 2 normal"
                vector={draft.normal2}
                onCell={setVectorCell}
              />
            </>
          )}

          {fieldError !== null && (
            <div
              className="assembly-mate-panel__error"
              role="alert"
              data-testid="assembly-mate-error"
            >
              {fieldError.message}
            </div>
          )}

          <div className="assembly-mate-panel__actions">
            <button
              type="button"
              className="btn btn-primary"
              data-testid="assembly-mate-solve"
              onClick={handleSolve}
              disabled={solveDisabled}
              aria-disabled={solveDisabled}
              title={
                !canSolve
                  ? 'Add a second part and build the assembly before solving a mate.'
                  : 'Solve this mate'
              }
            >
              {solving ? 'Solving…' : 'Solve mate'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * One labelled 3-vector input row (X / Y / Z number cells). Pulled out so the
 * point / axis / plane branches share the exact markup + testid scheme without
 * duplication. `slot` is the `MateFormDraft` key the cells write to.
 */
function VectorField({
  slot,
  label,
  vector,
  onCell,
}: {
  readonly slot: keyof MateFormDraft
  readonly label: string
  readonly vector: VectorDraft
  readonly onCell: (slot: keyof MateFormDraft, index: 0 | 1 | 2, value: string) => void
}): JSX.Element {
  return (
    <div className="assembly-mate-panel__field assembly-mate-panel__field--vector">
      <span className="assembly-mate-panel__label">{label}</span>
      <div className="assembly-mate-panel__vector">
        {([0, 1, 2] as const).map((i) => (
          <label key={i} className="assembly-mate-panel__vector-cell">
            <span className="assembly-mate-panel__vector-axis">{CELL_LABELS[i]}</span>
            <input
              className="assembly-mate-panel__input"
              data-testid={`assembly-mate-${String(slot)}-${i}`}
              type="number"
              inputMode="decimal"
              value={vector[i]}
              onChange={(e) => onCell(slot, i, e.target.value)}
            />
          </label>
        ))}
      </div>
    </div>
  )
}

/**
 * Map a {@link MateBadgeView} status onto the `design-assembly__solver-badge--*`
 * BEM modifier suffix already used by AssemblyView. Keeps the new panel's badge
 * visually identical to the assembly solver badge (shared CSS), so the theme
 * covers both without new rules.
 *   - solved          → converged (green)
 *   - over-constrained → over-constrained (red)
 *   - error           → error (red)
 *   - solving / idle  → not-solved (gray)
 */
function badgeStatusToModifier(status: MateBadgeView['status']): string {
  switch (status) {
    case 'solved':
      return 'converged'
    case 'over-constrained':
      return 'over-constrained'
    case 'error':
      return 'error'
    case 'solving':
    case 'idle':
    default:
      return 'not-solved'
  }
}

export default AssemblyMatePanel
