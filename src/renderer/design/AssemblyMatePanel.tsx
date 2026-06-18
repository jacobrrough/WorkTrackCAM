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

import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import { fab } from '../src/shop-types'
import type { AssemblyPart } from './AssemblyView'
import {
  buildAddMateRequest,
  isRotationalMateKind,
  makeMateFormDraft,
  mateKindUsesSidecar,
  mateOutcomeToBadge,
  narrowAddMateResponse,
  rotationalMatesSupportedFor,
  IDLE_MATE_BADGE,
  MATE_CARDINAL_AXES,
  OFFERED_MATE_KINDS,
  ROTATIONAL_MATE_KINDS,
  SOLVING_MATE_BADGE,
  type MateBadgeView,
  type MateCardinalAxis,
  type MateFormDraft,
  type MateFormField,
  type MateFormKind,
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
const KIND_LABELS: Record<MateFormKind, string> = {
  point: 'Point',
  axis: 'Axis',
  plane: 'Plane',
  distance: 'Distance',
  angle: 'Angle',
  tangent: 'Tangent',
}

/** Per-cell axis labels for the cardinal axis pickers. */
const AXIS_LABELS: Record<MateCardinalAxis, string> = { x: 'X', y: 'Y', z: 'Z' }

/**
 * Kind options the picker offers — the SINGLE SOURCE OF TRUTH is the engine's
 * `OFFERED_MATE_KINDS` (`assembly-mate-form.ts`), NOT a list re-typed here. Every
 * entry is genuinely actionable: point/axis/plane solve live via the sidecar;
 * `distance` folds straight into a Model-C constraint the TS solver positions;
 * `angle` / `tangent` fold into a Model-C rotational constraint the solver drives
 * by rotating a revolute hinge (Cycle 272). The two rotational kinds are GATED at
 * render — their `<option>` is disabled (and their inputs are withheld) unless the
 * selected driven part (Part 2) is a non-grounded **revolute** hinge, the only
 * case the solver converges (`rotationalMatesSupportedFor`). Deriving from the
 * shared constant means the picker can never drift from the solver's vocabulary.
 */
const KINDS: readonly MateFormKind[] = OFFERED_MATE_KINDS

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

  const partById = useMemo<Record<string, AssemblyPart>>(() => {
    const out: Record<string, AssemblyPart> = {}
    for (const p of parts) out[p.id] = p
    return out
  }, [parts])

  // ── Rotational-mate gate ────────────────────────────────────────────────────
  // `angle` / `tangent` converge ONLY when the DRIVEN part (Part 2 of the mate)
  // is a non-grounded revolute hinge — the one rotational DOF the foundation
  // solver wires. Offer those kinds only then; otherwise disable their options +
  // withhold their inputs so the operator can't author a mate the solver can't
  // satisfy. (Part 2 is the driven side: Part 1 is the reference, mirroring the
  // `assembly-solver-revolute` fixtures where the grounded base is part1.)
  const drivenPart: AssemblyPart | undefined = partById[draft.part2Id]
  const rotationalSupported = rotationalMatesSupportedFor(drivenPart)

  // Snap an unsupported rotational draft back to a positional kind: if Part 2 is
  // switched to a non-revolute part while an angle/tangent kind is active, the
  // form must not keep showing rotational inputs for a part the solver can't move.
  useEffect(() => {
    if (isRotationalMateKind(draft.kind) && !rotationalSupported) {
      setDraft((d) => ({ ...d, kind: 'point' }))
      setFieldError(null)
    }
  }, [draft.kind, rotationalSupported])

  // ── Controlled-input setters (pure draft updates) ──────────────────────────
  const setKind = useCallback((kind: MateFormKind): void => {
    setDraft((d) => ({ ...d, kind }))
    setFieldError(null)
  }, [])

  const setPart = useCallback((side: 1 | 2, id: string): void => {
    setDraft((d) => (side === 1 ? { ...d, part1Id: id } : { ...d, part2Id: id }))
    setFieldError(null)
  }, [])

  // Cardinal-axis picker setter (angle / tangent feature axes per part).
  const setCardinalAxis = useCallback((side: 1 | 2, axis: MateCardinalAxis): void => {
    setDraft((d) => (side === 1 ? { ...d, axis1Cardinal: axis } : { ...d, axis2Cardinal: axis }))
    setFieldError(null)
  }, [])

  // Angle-target scalar setter (raw string; the builder parses it).
  const setAngleDeg = useCallback((value: string): void => {
    setDraft((d) => ({ ...d, angleDeg: value }))
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

  // Distance-target scalar setter (raw string so an in-progress edit like `1.`
  // or `-` does not crash the controlled input; the builder parses it).
  const setValue = useCallback((value: string): void => {
    setDraft((d) => ({ ...d, value }))
    setFieldError(null)
  }, [])

  // ── Solve handler — build request, call bridge, map to badge ────────────────
  //
  // Two submit paths, branched on `mateKindUsesSidecar(draft.kind)`:
  //   - LIVE kinds (point / axis / plane) need a built B-rep assembly, so Solve
  //     stays disabled until a non-empty `assemblyHandle` exists. They round-trip
  //     through `cad.add_assembly_mate`.
  //   - PERSIST-ONLY `distance` needs NO live B-rep — it folds straight into a
  //     Model-C constraint via the host's `onMateAdded` → `persistMate` path — so
  //     it only requires two parts (the assembly handle is irrelevant).
  const usesSidecar = mateKindUsesSidecar(draft.kind)
  const canSolve =
    parts.length >= 2 &&
    (usesSidecar ? typeof assemblyHandle === 'string' && assemblyHandle.length > 0 : true)
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

    // ── PERSIST-ONLY path (distance / angle / tangent) ───────────────────────
    // No sidecar: the durable Model-C constraint is folded by the host
    // (`onMateAdded` → `runPersistMate` → `persistMate`), and the TS
    // `solveMateConstraints` drives the part (translation for distance; a revolute
    // hinge rotation for angle/tangent) to the target on the next Solve in
    // AssemblyView. We hand the SolvedMate straight back and paint a "solved"
    // badge — honest: the mate is recorded + solver-backed, the pose is realised
    // when the assembly solve runs.
    if (built.persistOnly !== undefined) {
      const po = built.persistOnly
      const id = `mate-${Date.now().toString(36)}-${Math.floor(Math.random() * 1_000_000).toString(36)}`
      onMateAdded?.({ id, draft })
      const summary =
        po.kind === 'distance'
          ? `${KIND_LABELS.distance} ${po.value} mm`
          : po.kind === 'angle'
            ? `${KIND_LABELS.angle} ${po.angleDeg}°`
            : KIND_LABELS.tangent
      const detail =
        po.kind === 'distance'
          ? 'Saved as a distance constraint — runs in the assembly solve.'
          : 'Saved as a rotational constraint — the revolute hinge rotates to satisfy it in the assembly solve.'
      setBadge({ label: `Mate added: ${summary}`, status: 'solved', detail })
      toast('ok', `Mate added: ${summary}`)
      return
    }

    // ── LIVE path (point / axis / plane) ─────────────────────────────────────
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
              onChange={(e) => setKind(e.target.value as MateFormKind)}
            >
              {KINDS.map((k) => {
                // Gate the rotational kinds: their option is present (the picker
                // is SSOT-complete) but DISABLED unless the driven part is a
                // non-grounded revolute hinge — the only case the solver converges.
                const gatedOff = isRotationalMateKind(k) && !rotationalSupported
                return (
                  <option key={k} value={k} disabled={gatedOff}>
                    {KIND_LABELS[k]}
                    {gatedOff ? ' (needs a revolute part)' : ''}
                  </option>
                )
              })}
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
          {draft.kind === 'distance' && (
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
              <div className="assembly-mate-panel__field assembly-mate-panel__field--scalar">
                <label className="assembly-mate-panel__label" htmlFor="assembly-mate-value">
                  Target separation (mm)
                </label>
                <input
                  id="assembly-mate-value"
                  className="assembly-mate-panel__input"
                  data-testid="assembly-mate-value"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={draft.value}
                  onChange={(e) => setValue(e.target.value)}
                />
              </div>
            </>
          )}
          {/* angle / tangent: a cardinal axis picker per part (no free vectors —
              the solver compares cardinal feature axes), plus the degrees target
              for angle. Only reachable when the rotational gate passed (an
              unsupported kind is snapped back to point by the gate effect). */}
          {(draft.kind === 'angle' || draft.kind === 'tangent') && (
            <>
              <AxisPickerField
                side={1}
                label={`Axis 1 — ${partNameById[draft.part1Id] ?? draft.part1Id}`}
                value={draft.axis1Cardinal}
                onPick={setCardinalAxis}
              />
              <AxisPickerField
                side={2}
                label={`Axis 2 — ${partNameById[draft.part2Id] ?? draft.part2Id} (revolute hinge)`}
                value={draft.axis2Cardinal}
                onPick={setCardinalAxis}
              />
              {draft.kind === 'angle' && (
                <div className="assembly-mate-panel__field assembly-mate-panel__field--scalar">
                  <label className="assembly-mate-panel__label" htmlFor="assembly-mate-angle">
                    Target angle (degrees)
                  </label>
                  <input
                    id="assembly-mate-angle"
                    className="assembly-mate-panel__input"
                    data-testid="assembly-mate-angle"
                    type="number"
                    inputMode="decimal"
                    value={draft.angleDeg}
                    onChange={(e) => setAngleDeg(e.target.value)}
                  />
                </div>
              )}
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
                  ? usesSidecar
                    ? 'Add a second part and build the assembly before solving a mate.'
                    : 'Add a second part before defining a mate.'
                  : usesSidecar
                    ? 'Solve this mate'
                    : 'Add this distance constraint (runs in the assembly solve).'
              }
            >
              {solving ? 'Solving…' : usesSidecar ? 'Solve mate' : 'Add mate'}
            </button>
          </div>

          {/*
            HONESTY: the rotational kinds (angle / tangent) are now offered + fold
            to a Model-C constraint the solver drives by rotating a revolute hinge
            (Cycle 272). They converge ONLY when the driven part (Part 2) is a
            non-grounded revolute hinge, so the picker GATES them on exactly that.
            This note states the gate condition + its current status so the surface
            stays honest — never offers a combination the solver can't satisfy.
          */}
          <p
            className="assembly-mate-panel__gate-note"
            data-testid="assembly-mate-rotational-gate"
          >
            {rotationalSupported
              ? `${ROTATIONAL_MATE_KINDS.join(' / ')} mates available: ${
                  partNameById[draft.part2Id] ?? draft.part2Id
                } is a revolute hinge.`
              : `${ROTATIONAL_MATE_KINDS.join(' / ')} mates need the driven part (Part 2) to be a non-grounded revolute joint.`}
          </p>
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
 * One labelled cardinal-axis picker (X / Y / Z radio-style select) for an
 * angle / tangent feature. The rotational solver compares cardinal feature axes,
 * so the operator picks one of the three local axes per part rather than typing a
 * free direction. `side` keys the stable testid (`assembly-mate-axis{1,2}-cardinal`)
 * + routes the pick to the matching draft field.
 */
function AxisPickerField({
  side,
  label,
  value,
  onPick,
}: {
  readonly side: 1 | 2
  readonly label: string
  readonly value: MateCardinalAxis
  readonly onPick: (side: 1 | 2, axis: MateCardinalAxis) => void
}): JSX.Element {
  const id = `assembly-mate-axis${side}-cardinal`
  return (
    <div className="assembly-mate-panel__field assembly-mate-panel__field--axis-pick">
      <label className="assembly-mate-panel__label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="assembly-mate-panel__select"
        data-testid={id}
        value={value}
        onChange={(e) => onPick(side, e.target.value as MateCardinalAxis)}
      >
        {MATE_CARDINAL_AXES.map((ax) => (
          <option key={ax} value={ax}>
            {AXIS_LABELS[ax]}
          </option>
        ))}
      </select>
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
