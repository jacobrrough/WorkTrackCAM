/**
 * CAD V1 — pure mapping between the assembly **mate-creation form** and the
 * `cad.add_assembly_mate` IPC wire shape, plus the result/error → solver-badge
 * mapping the panel paints.
 *
 * Pure module. No React, no DOM, no IPC. The `AssemblyMatePanel` owns the
 * draft form state (two part ids, a kind, and the per-kind 3-vector feature
 * inputs entered as strings) and threads it through:
 *
 *   1. {@link buildAddMateRequest} — validate + normalise the draft into the
 *      exact `{ handle, mate }` envelope `window.fab.cad.addAssemblyMate`
 *      accepts (the sidecar's `CadAddAssemblyMateParams`, Model B: 3-vectors,
 *      NOT face ids). On any malformed field it returns a structured
 *      `{ ok: false, error, field }` the panel surfaces inline before burning
 *      a Python round-trip.
 *   2. {@link mateOutcomeToBadge} — fold the IPC response (`{ ok: true, result }`
 *      with the post-solve bbox, OR `{ ok: false, error, hint }` carrying the
 *      sidecar's `mate_solve_failed` / `bad_params` vocabulary) onto a
 *      {@link MateBadgeView} whose label + status mirror the existing
 *      `design-assembly__solver-badge` wording (`AssemblyView.tsx` / the sketch
 *      DOF badge in `sketch-solve-status.ts`).
 *
 * Why a separate Model-B form (not the face-id `AssemblyMate` the existing
 * `AssemblyView` modal collects)? The `cad.add_assembly_mate` solver consumes
 * 3-vectors (point / axis / plane normal in each child's local frame). Deriving
 * those vectors from a picked face is a follow-up that needs a new sidecar verb
 * (face id → centroid/normal); this V1 lets the operator enter the vectors
 * directly, which maps 1:1 onto the wire and keeps the surface honest. Keeping
 * the mapping pure mirrors `sketch-solve-status.ts` so every branch is
 * unit-tested with plain objects — no jsdom, no bridge.
 */

import type {
  CadAddAssemblyMateParams,
  CadAssemblyMate,
  CadAssemblyMateKind,
} from '../../shared/sidecar-protocol'

// ── Form draft (what the panel's controlled inputs hold) ─────────────────────

/**
 * The mate-creation form's draft state. Vector cells are kept as **strings**
 * (raw `<input type="number">` values) so an in-progress edit like ``-`` or
 * ``1.`` does not crash the controlled input; {@link buildAddMateRequest}
 * parses + validates them at confirm time.
 *
 * Field layout per kind (mirrors `CadAssemblyMate`):
 *   - point: `point1` + `point2` (a 3-vector each).
 *   - axis:  `axis1`  + `axis2`  (a 3-vector each; direction, non-zero).
 *   - plane: `point1` + `normal1` + `point2` + `normal2`.
 *
 * All four vector slots are always present in the draft (the panel renders the
 * subset the active `kind` needs); the unused slots are simply ignored by the
 * builder. This keeps the reducer trivial — no add/remove of fields on a kind
 * switch.
 */
export type MateFormDraft = {
  readonly kind: CadAssemblyMateKind
  /** Part 1 child id (AssemblyPart.name at the IPC boundary; see panel). */
  readonly part1Id: string
  /** Part 2 child id (must differ from part1Id). */
  readonly part2Id: string
  /** point / plane / distance: point1. Raw string cells `[x, y, z]`. */
  readonly point1: VectorDraft
  /** point / plane / distance: point2. */
  readonly point2: VectorDraft
  /** axis: axis1. */
  readonly axis1: VectorDraft
  /** axis: axis2. */
  readonly axis2: VectorDraft
  /** plane: normal1. */
  readonly normal1: VectorDraft
  /** plane: normal2. */
  readonly normal2: VectorDraft
  /**
   * distance: the target separation (mm) between point1 and point2, kept as a
   * **raw string** (like the vector cells) so an in-progress edit (`-`, `1.`)
   * does not crash the controlled input. Parsed + validated (finite,
   * non-negative) by {@link buildAddMateRequest} only for the `distance` kind;
   * ignored by every other kind.
   */
  readonly value: string
}

/**
 * The mate kinds the authoring form **offers** — the single source of truth the
 * panel's kind picker should map over (rather than hard-coding a list). Every
 * entry here is genuinely actionable: `point` / `axis` / `plane` solve live via
 * the sidecar; `distance` folds to a Model-C constraint the TypeScript solver
 * positions. See {@link CadAssemblyMateKind} for why `angle` / `tangent` are
 * **not** here (the foundation solver has no rotational free variables, so it
 * cannot position them — offering them would be dishonest).
 */
export const OFFERED_MATE_KINDS: readonly CadAssemblyMateKind[] = [
  'point',
  'axis',
  'plane',
  'distance',
]

/**
 * Mate kinds intentionally **deferred** from the authoring form, each with the
 * honest reason. Exported so a UI (or a test) can surface "coming soon" copy
 * without re-deriving the rationale. These are *not* offered — see
 * {@link OFFERED_MATE_KINDS}.
 */
export const DEFERRED_MATE_KINDS: ReadonlyArray<{
  readonly kind: 'angle' | 'tangent'
  readonly reason: string
}> = [
  {
    kind: 'angle',
    reason:
      'The assembly solver currently exposes only translational degrees of freedom, so it cannot rotate a part to hit an angle target. Available once rotational DOF land.',
  },
  {
    kind: 'tangent',
    reason:
      'Tangency is a rotational/contact condition; the foundation solver has no rotational DOF to satisfy it yet. Deferred until rotational DOF land.',
  },
]

/**
 * Is this mate kind solved **live** by the Python sidecar (`add_assembly_mate`)?
 * `true` for point/axis/plane (the wire union carries them); `false` for
 * `distance` (persist-only — the renderer skips the sidecar and folds it straight
 * into a Model-C constraint). Lets the panel branch its submit path without
 * re-encoding the rule.
 */
export function mateKindUsesSidecar(kind: CadAssemblyMateKind): boolean {
  return kind === 'point' || kind === 'axis' || kind === 'plane'
}

/** A single vector's three raw string cells (x, y, z) as typed in the inputs. */
export type VectorDraft = readonly [string, string, string]

/** A blank vector draft — three empty cells. */
export const EMPTY_VECTOR: VectorDraft = ['', '', '']

/**
 * Fresh form draft seeded with two part ids. Defaults to a `point` mate (the
 * most common: weld two points). Axis drafts default to the +Z unit vector so
 * the operator isn't forced to type a non-zero direction from scratch (a
 * zero-length axis is rejected by the builder); point/plane origins default to
 * the origin.
 */
export function makeMateFormDraft(part1Id: string, part2Id: string): MateFormDraft {
  return {
    kind: 'point',
    part1Id,
    part2Id,
    point1: ['0', '0', '0'],
    point2: ['0', '0', '0'],
    axis1: ['0', '0', '1'],
    axis2: ['0', '0', '1'],
    normal1: ['0', '0', '1'],
    normal2: ['0', '0', '1'],
    // distance target (mm) — defaults to 0 (a coincident-equivalent separation).
    value: '0',
  }
}

// ── Form → request mapping ───────────────────────────────────────────────────

/**
 * Which draft field failed validation. The panel maps this onto the offending
 * input so the operator sees a precise, inline error (mirrors the sidecar's
 * "point a hint at the bad field" posture in `validateAddAssemblyMatePayload`).
 */
export type MateFormField =
  | 'handle'
  | 'part1Id'
  | 'part2Id'
  | 'point1'
  | 'point2'
  | 'axis1'
  | 'axis2'
  | 'normal1'
  | 'normal2'
  | 'value'

/**
 * A validated **persist-only** mate (the `distance` kind). Carries the two
 * feature points (each part's local frame) + the numeric target so the renderer
 * can adapt it onto `assembly-mate-persist`'s `SolvedMateDraftInput` and fold it
 * into a Model-C `distance` constraint — WITHOUT a sidecar round-trip (the
 * Python `add_assembly_mate` does not accept distance). Mirrors the fields the
 * persist layer reads for a distance fold.
 */
export type PersistOnlyMate = {
  readonly kind: 'distance'
  readonly part1Id: string
  readonly part2Id: string
  readonly point1: readonly [number, number, number]
  readonly point2: readonly [number, number, number]
  /** Target separation (mm), finite and non-negative. */
  readonly value: number
}

/**
 * Discriminated result of {@link buildAddMateRequest}.
 *
 *   - `{ ok: true, request }`      — a live mate (point/axis/plane): send
 *                                     `request` to `cad.addAssemblyMate`.
 *   - `{ ok: true, persistOnly }`  — a `distance` mate: do NOT call the sidecar;
 *                                     fold `persistOnly` straight into a Model-C
 *                                     constraint via `assembly-mate-persist`.
 *   - `{ ok: false, field, message }` — a precise inline validation error.
 *
 * Both success shapes carry `ok: true`; the renderer discriminates on the
 * presence of `request` vs `persistOnly` (or calls {@link mateKindUsesSidecar}
 * first). Keeping live + persist-only in one result type means the panel's
 * submit handler has a single validation call site.
 */
export type BuildMateRequestResult =
  | { readonly ok: true; readonly request: CadAddAssemblyMateParams; readonly persistOnly?: undefined }
  | { readonly ok: true; readonly persistOnly: PersistOnlyMate; readonly request?: undefined }
  | { readonly ok: false; readonly field: MateFormField; readonly message: string }

/**
 * Parse one vector draft into a finite `[x, y, z]` tuple, or `null` if any cell
 * is empty / non-numeric / non-finite. Kept narrow + pure so the builder can
 * reuse it per kind.
 */
function parseVector(v: VectorDraft): [number, number, number] | null {
  const out: [number, number, number] = [0, 0, 0]
  for (let i = 0; i < 3; i += 1) {
    const cell = v[i]
    if (cell.trim().length === 0) return null
    const n = Number(cell)
    if (!Number.isFinite(n)) return null
    out[i] = n
  }
  return out
}

/** Is a parsed vector the zero vector (within an exact compare)? */
function isZeroVector(v: readonly [number, number, number]): boolean {
  return v[0] === 0 && v[1] === 0 && v[2] === 0
}

/**
 * Parse one raw numeric cell into a finite number, or `null` if empty /
 * non-numeric / non-finite. The scalar analogue of {@link parseVector} — used
 * for the `distance` target field.
 */
function parseFiniteNumber(cell: string): number | null {
  if (cell.trim().length === 0) return null
  const n = Number(cell)
  return Number.isFinite(n) ? n : null
}

/**
 * Validate + normalise a {@link MateFormDraft} (plus the assembly handle).
 *
 *   - **Live kinds** (`point` / `axis` / `plane`) → `{ ok: true, request }`: the
 *     `{ handle, mate }` envelope `cad.add_assembly_mate` accepts.
 *   - **`distance`** → `{ ok: true, persistOnly }`: a validated
 *     {@link PersistOnlyMate} the renderer folds straight into a Model-C
 *     constraint (NO sidecar — the Python verb does not accept distance). The
 *     `handle` is NOT required for this kind (persistence needs no live B-rep).
 *
 * Validation order (fail fast, precise field pointer):
 *   1. for **live kinds only**, `handle` non-empty (the assembly must exist).
 *   2. both part ids non-empty and **distinct** (a mate joins two parts).
 *   3. the per-kind feature vectors parse to finite 3-tuples.
 *   4. axis / normal vectors are **non-zero** (a zero-length direction is
 *      degenerate — the sidecar would raise `bad_params` at solve time, so we
 *      reject it up front with a clearer message).
 *   5. for `distance`, the target `value` parses to a **finite, non-negative**
 *      number (a separation cannot be negative).
 *
 * On a live-kind success the returned `request.mate` is a real
 * {@link CadAssemblyMate} (discriminated by `kind`) ready to `JSON.stringify`
 * onto the wire. No `any`: each kind builds its concrete member explicitly.
 */
export function buildAddMateRequest(
  handle: string,
  draft: MateFormDraft,
): BuildMateRequestResult {
  // The assembly handle is only needed for the live sidecar solve; a persist-only
  // distance mate folds to a Model-C constraint with no live B-rep, so skip it.
  if (mateKindUsesSidecar(draft.kind) && (typeof handle !== 'string' || handle.trim().length === 0)) {
    return {
      ok: false,
      field: 'handle',
      message: 'No assembly handle yet — add at least two parts first.',
    }
  }
  if (draft.part1Id.trim().length === 0) {
    return { ok: false, field: 'part1Id', message: 'Select a part on side 1.' }
  }
  if (draft.part2Id.trim().length === 0) {
    return { ok: false, field: 'part2Id', message: 'Select a part on side 2.' }
  }
  if (draft.part1Id === draft.part2Id) {
    return {
      ok: false,
      field: 'part2Id',
      message: 'A mate must connect two different parts.',
    }
  }

  if (draft.kind === 'distance') {
    const point1 = parseVector(draft.point1)
    if (!point1) {
      return { ok: false, field: 'point1', message: 'Point 1 needs three finite numbers.' }
    }
    const point2 = parseVector(draft.point2)
    if (!point2) {
      return { ok: false, field: 'point2', message: 'Point 2 needs three finite numbers.' }
    }
    const target = parseFiniteNumber(draft.value)
    if (target == null) {
      return { ok: false, field: 'value', message: 'Distance needs a finite number (mm).' }
    }
    if (target < 0) {
      return { ok: false, field: 'value', message: 'Distance must be zero or positive (mm).' }
    }
    return {
      ok: true,
      persistOnly: {
        kind: 'distance',
        part1Id: draft.part1Id,
        part2Id: draft.part2Id,
        point1,
        point2,
        value: target,
      },
    }
  }

  if (draft.kind === 'point') {
    const point1 = parseVector(draft.point1)
    if (!point1) {
      return { ok: false, field: 'point1', message: 'Point 1 needs three finite numbers.' }
    }
    const point2 = parseVector(draft.point2)
    if (!point2) {
      return { ok: false, field: 'point2', message: 'Point 2 needs three finite numbers.' }
    }
    const mate: CadAssemblyMate = {
      kind: 'point',
      part1Id: draft.part1Id,
      point1,
      part2Id: draft.part2Id,
      point2,
    }
    return { ok: true, request: { handle, mate } }
  }

  if (draft.kind === 'axis') {
    const axis1 = parseVector(draft.axis1)
    if (!axis1) {
      return { ok: false, field: 'axis1', message: 'Axis 1 needs three finite numbers.' }
    }
    if (isZeroVector(axis1)) {
      return { ok: false, field: 'axis1', message: 'Axis 1 must be a non-zero direction.' }
    }
    const axis2 = parseVector(draft.axis2)
    if (!axis2) {
      return { ok: false, field: 'axis2', message: 'Axis 2 needs three finite numbers.' }
    }
    if (isZeroVector(axis2)) {
      return { ok: false, field: 'axis2', message: 'Axis 2 must be a non-zero direction.' }
    }
    const mate: CadAssemblyMate = {
      kind: 'axis',
      part1Id: draft.part1Id,
      axis1,
      part2Id: draft.part2Id,
      axis2,
    }
    return { ok: true, request: { handle, mate } }
  }

  // plane
  const point1 = parseVector(draft.point1)
  if (!point1) {
    return { ok: false, field: 'point1', message: 'Plane 1 origin needs three finite numbers.' }
  }
  const normal1 = parseVector(draft.normal1)
  if (!normal1) {
    return { ok: false, field: 'normal1', message: 'Plane 1 normal needs three finite numbers.' }
  }
  if (isZeroVector(normal1)) {
    return { ok: false, field: 'normal1', message: 'Plane 1 normal must be non-zero.' }
  }
  const point2 = parseVector(draft.point2)
  if (!point2) {
    return { ok: false, field: 'point2', message: 'Plane 2 origin needs three finite numbers.' }
  }
  const normal2 = parseVector(draft.normal2)
  if (!normal2) {
    return { ok: false, field: 'normal2', message: 'Plane 2 normal needs three finite numbers.' }
  }
  if (isZeroVector(normal2)) {
    return { ok: false, field: 'normal2', message: 'Plane 2 normal must be non-zero.' }
  }
  const mate: CadAssemblyMate = {
    kind: 'plane',
    part1Id: draft.part1Id,
    point1,
    normal1,
    part2Id: draft.part2Id,
    point2,
    normal2,
  }
  return { ok: true, request: { handle, mate } }
}

// ── Result / error → solver badge ────────────────────────────────────────────

/**
 * The IPC response shape from `window.fab.cad.addAssemblyMate`. Declared
 * locally (rather than importing `CadAddAssemblyMateResponse` from the main
 * process) so this renderer module stays free of main-process types — the
 * shop-types bridge surface is permissive (`Record<string, unknown>`), so the
 * panel narrows the raw response into this shape before calling
 * {@link mateOutcomeToBadge}. Extra fields on the real wire result are ignored.
 */
export type AddMateOutcome =
  | { readonly ok: true; readonly result?: AddMateResultLike }
  | { readonly ok: false; readonly error: string; readonly hint?: string }

/** The fields of `CadAddAssemblyMateResult` this module reads for the badge. */
export type AddMateResultLike = {
  readonly bbox?: {
    readonly min?: readonly [number, number, number]
    readonly max?: readonly [number, number, number]
  }
}

/**
 * Badge status the mate panel paints. Mirrors the `design-assembly__solver-badge`
 * status family (`AssemblyView.tsx`) so the CSS modifier suffixes line up:
 *   - `idle`            — no mate solved yet (gray "Not solved").
 *   - `solving`         — a round-trip is in flight.
 *   - `solved`          — `cq.Assembly.solve()` succeeded; the mate held.
 *   - `over-constrained`— `mate_solve_failed` (the common over-constrained
 *                          case): red, with a "loosen a constraint" hint.
 *   - `error`           — any other structured failure (`bad_params`,
 *                          `invalid_handle`, sidecar unavailable, …): red.
 */
export type MateBadgeStatus =
  | 'idle'
  | 'solving'
  | 'solved'
  | 'over-constrained'
  | 'error'

/** Label + status + optional secondary hint the badge renders. */
export type MateBadgeView = {
  /** The exact string the operator reads in the badge. */
  readonly label: string
  /** data-status / BEM suffix the badge style consumes. */
  readonly status: MateBadgeStatus
  /**
   * Optional second-line operator guidance (e.g. "loosen a constraint" on an
   * over-constrained solve, or the sidecar's raw `hint`). Undefined when the
   * label alone is sufficient.
   */
  readonly detail?: string
}

/** Idle badge — no mate solved yet. */
export const IDLE_MATE_BADGE: MateBadgeView = { label: 'No mate solved', status: 'idle' }

/** In-flight badge — a mate round-trip is running. */
export const SOLVING_MATE_BADGE: MateBadgeView = { label: 'Solving mate…', status: 'solving' }

/**
 * Sidecar error codes that mean "the constraint system could not be solved"
 * — almost always an over-constrained stack (the operator added a mate that
 * conflicts with the existing ones). `cad_handlers.py` surfaces these as the
 * `error` field of the IPC failure envelope.
 */
const OVER_CONSTRAINED_ERRORS: ReadonlySet<string> = new Set([
  'mate_solve_failed',
])

/**
 * Fold an {@link AddMateOutcome} onto the badge the panel paints.
 *
 * Honesty contract (mirrors `sketch-solve-status.selectDofBadgeView`):
 *   - success ⇒ "Mate solved" (green). When the post-solve bbox is present we
 *     append its extent so the operator can confirm the parts actually moved.
 *   - `mate_solve_failed` ⇒ "Over-constrained" (red) + a "loosen a constraint"
 *     hint — this is the dominant real-world failure and deserves a specific,
 *     actionable message rather than a raw OCCT dump.
 *   - any other failure ⇒ "Mate failed: <error>" (red), carrying the sidecar's
 *     `hint` through as the detail line so `bad_params` ("part1Id refers to a
 *     child not in the assembly") reaches the operator verbatim.
 *
 * Pure: the panel calls this with the narrowed response and drops the result
 * straight into the badge span — no formatting logic leaks into the JSX.
 */
export function mateOutcomeToBadge(outcome: AddMateOutcome): MateBadgeView {
  if (outcome.ok) {
    const extent = bboxExtentSummary(outcome.result?.bbox)
    return {
      label: extent ? `Mate solved (${extent})` : 'Mate solved',
      status: 'solved',
    }
  }
  if (OVER_CONSTRAINED_ERRORS.has(outcome.error)) {
    return {
      label: 'Over-constrained',
      status: 'over-constrained',
      detail: outcome.hint ?? 'The mates conflict — loosen or remove a constraint and retry.',
    }
  }
  return {
    label: `Mate failed: ${outcome.error}`,
    status: 'error',
    detail: outcome.hint,
  }
}

/**
 * Compact "Δx × Δy × Δz mm" summary of the post-solve bbox extent, or `null`
 * when the bbox is absent / malformed. Rounded to 2 decimals so the badge text
 * stays short. Defensive: a partial bbox (missing min/max, wrong arity) yields
 * `null` rather than throwing — the success badge degrades to the bare label.
 */
export function bboxExtentSummary(
  bbox: AddMateResultLike['bbox'] | undefined,
): string | null {
  const min = bbox?.min
  const max = bbox?.max
  if (!isVec3(min) || !isVec3(max)) return null
  const dx = round2(max[0] - min[0])
  const dy = round2(max[1] - min[1])
  const dz = round2(max[2] - min[2])
  return `${dx} × ${dy} × ${dz} mm`
}

/** Round to at most 2 decimals, dropping a trailing ``.0`` (``1.50`` → ``1.5``). */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Narrow guard: a finite `[number, number, number]` tuple. */
function isVec3(v: unknown): v is readonly [number, number, number] {
  return (
    Array.isArray(v) &&
    v.length === 3 &&
    typeof v[0] === 'number' &&
    Number.isFinite(v[0]) &&
    typeof v[1] === 'number' &&
    Number.isFinite(v[1]) &&
    typeof v[2] === 'number' &&
    Number.isFinite(v[2])
  )
}

/**
 * Narrow an opaque IPC response (the permissive `Record<string, unknown>` the
 * `window.fab.cad.addAssemblyMate` bridge returns) into the typed
 * {@link AddMateOutcome} the badge mapper consumes. Defensive: a response that
 * is neither a well-formed success nor a well-formed failure folds onto a
 * generic `sidecar_protocol_error` so the panel never crashes on a shape it
 * didn't expect. Pure + no `any`.
 */
export function narrowAddMateResponse(raw: unknown): AddMateOutcome {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'sidecar_protocol_error', hint: 'Empty response from addAssemblyMate.' }
  }
  const r = raw as { ok?: unknown; error?: unknown; hint?: unknown; result?: unknown }
  if (r.ok === true) {
    const result = r.result
    if (result && typeof result === 'object') {
      const bbox = (result as { bbox?: unknown }).bbox
      if (bbox && typeof bbox === 'object') {
        const b = bbox as { min?: unknown; max?: unknown }
        if (isVec3(b.min) && isVec3(b.max)) {
          return { ok: true, result: { bbox: { min: b.min, max: b.max } } }
        }
      }
    }
    return { ok: true }
  }
  if (r.ok === false && typeof r.error === 'string') {
    return {
      ok: false,
      error: r.error,
      hint: typeof r.hint === 'string' ? r.hint : undefined,
    }
  }
  return { ok: false, error: 'sidecar_protocol_error', hint: 'Malformed addAssemblyMate response.' }
}
