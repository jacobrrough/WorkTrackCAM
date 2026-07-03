/**
 * workspace-host-handoff — the pure, React-free core of the two
 * `WorkspaceHost` CAD↔CAM bridges wired in Wave 3h.
 *
 * `WorkspaceHost` renders inside React providers (toast, CAM hand-off mailbox,
 * machine session, project session) and cannot be exercised by the node-env
 * renderer test suite (no jsdom / no real click — see the sibling
 * `DesignWorkspaceHost.dxf-import.test.tsx` rationale). So the load-bearing
 * behavior of the two formerly-stub handlers lives here as plain functions over
 * INJECTED dependencies, exactly the way `cam-handoff-store` /
 * `assembly-mate-persist` factor their cores out of the host component. The host
 * is then a thin adapter that supplies the real `fab()` calls + context setters.
 *
 *   1. {@link runSendToCam} — queue the freshly-exported STL into the CAM
 *      hand-off mailbox, then navigate to Manufacture. `ManufactureHost`'s
 *      consume-once effect imports the queued STL into the first plate (the
 *      proven `assets:importMesh` → bind → `manufacture:save` path) and emits
 *      its own "Part landed in CAM" toast. This function returns the honest
 *      "sending <name> to <machine>" toast the host shows at the queue point —
 *      it names the part + the target machine and never claims an import that
 *      `ManufactureHost` hasn't performed yet.
 *   2. {@link runPersistMate} — fold a solved Model-B mate into the on-disk
 *      assembly's Model-C `mateConstraints` and re-save it. Loads the assembly
 *      (injected `loadAssembly`), runs the pure {@link persistMate} fold, and on
 *      success writes it back (injected `saveAssembly`). Returns a structured
 *      result the host turns into a "Mate saved" / failure toast.
 *
 * SAFETY: data-only. This module copies a path, edits the assembly data model,
 * and persists assembly JSON. It emits NO G-code and runs NO toolpath engine —
 * the actual mesh import is `ManufactureHost`'s job; the mate fold is
 * additive-only (Safety Rule 2 — `mateConstraints` is `.optional().default([])`,
 * so a legacy assembly.json with no mates still loads and simply gains the row).
 */

import type { AssemblyFile } from '../../shared/assembly-schema'
import type { AssemblyMateConstraint } from '../../shared/assembly-mate-schema'
import {
  persistMate,
  type SolvedCardinalAxis,
  type SolvedMateDraftInput,
  type SolvedMateInput,
  type SolvedMateKind,
  type SolvedVec3
} from '../../shared/assembly-mate-persist'
import { persistParts } from '../../shared/assembly-hydrate'
import type { SolvedMate } from '../design/AssemblyMatePanel'
import type { MateCardinalAxis, MateFormDraft, VectorDraft } from '../design/assembly-mate-form'
import {
  hydrateAssembly,
  partToView,
  type HydratedAssembly
} from '../design/assembly-part-bridge'
import type { AssemblyPart } from '../design/AssemblyView'

// ── Toast shape (matches ToastContext.pushToast) ─────────────────────────────

/** The kind + message a host toast carries. The host calls `pushToast(kind, message)`. */
export interface HandoffToast {
  readonly kind: 'ok' | 'err' | 'warn'
  readonly message: string
}

// ── (1) Send-to-CAM hand-off ─────────────────────────────────────────────────

/** A queued CAM import request (mirrors `PendingCamImport`). */
export interface QueuedCamImport {
  readonly stlPath: string
  readonly sourceName?: string
}

/** Injected dependencies for {@link runSendToCam}. */
export interface SendToCamDeps {
  /** Absolute path to the STL the CAD sidecar just exported (`payload.stlPath`). */
  readonly stlPath: string
  /** Optional display name for the source part (defaults derived from the STL stem). */
  readonly sourceName?: string
  /** Human label of the active machine for the toast (e.g. "K2 Plus"). `null` ⇒ generic "CAM". */
  readonly machineLabel: string | null
  /** Queue the import into the CAM hand-off mailbox (`useCamHandoff().setPendingCamImport`). */
  readonly setPendingCamImport: (req: QueuedCamImport) => void
  /** Navigate to the Manufacture workspace (`WorkspaceHost.onNavigate`). */
  readonly navigateToManufacture: () => void
}

/** Discriminated result of {@link runSendToCam}. */
export type SendToCamResult =
  | { readonly ok: true; readonly queued: QueuedCamImport; readonly toast: HandoffToast }
  | { readonly ok: false; readonly toast: HandoffToast }

/**
 * Best-effort human label from an absolute STL path: the file stem with the
 * extension stripped (`…/widget.stl` → `widget`). Returns `null` when no usable
 * stem can be derived (so the caller can fall back to a generic label).
 */
export function deriveSourceNameFromStlPath(stlPath: string): string | null {
  const base = stlPath.split(/[\\/]/).pop() ?? ''
  const stem = base.replace(/\.[^.]+$/, '').trim()
  return stem.length > 0 ? stem : null
}

/**
 * Queue the exported STL for CAM import, then navigate to Manufacture.
 *
 * Order is load-bearing: the mailbox is set FIRST (so the slot is populated
 * before `ManufactureHost` mounts and its consume effect runs), THEN we
 * navigate. A blank `stlPath` is rejected with a clear failure toast and no
 * navigation — a malformed hand-off must not silently bounce the operator to an
 * empty Manufacture view.
 */
export function runSendToCam(deps: SendToCamDeps): SendToCamResult {
  const stlPath = typeof deps.stlPath === 'string' ? deps.stlPath.trim() : ''
  if (stlPath.length === 0) {
    return {
      ok: false,
      toast: {
        kind: 'err',
        message: 'Send to CAM failed: the design export produced no STL path.'
      }
    }
  }
  const sourceName =
    (typeof deps.sourceName === 'string' && deps.sourceName.trim().length > 0
      ? deps.sourceName.trim()
      : deriveSourceNameFromStlPath(stlPath)) ?? undefined
  const queued: QueuedCamImport =
    sourceName !== undefined ? { stlPath, sourceName } : { stlPath }

  // Mailbox first, then navigate — see the order note above.
  deps.setPendingCamImport(queued)
  deps.navigateToManufacture()

  const partLabel = sourceName ?? 'the part'
  const target = deps.machineLabel?.trim() || 'CAM'
  return {
    ok: true,
    queued,
    toast: {
      kind: 'ok',
      // Honest: this function queued the import + navigated. `ManufactureHost`
      // emits the authoritative "Part landed in CAM → <rel>" toast once the STL
      // is actually bound to the plate.
      message: `Sending ${partLabel} to ${target}…`
    }
  }
}

// ── (2) Assembly mate persistence ────────────────────────────────────────────

/**
 * Parse one {@link VectorDraft} (raw `<input type=number>` string cells) into a
 * finite {@link SolvedVec3}, or `null` if any cell is empty / non-numeric /
 * non-finite. The `AssemblyMatePanel` keeps its vectors as strings; a SOLVED
 * mate's draft always parses (the bridge already validated it through
 * `buildAddMateRequest`), but we re-parse defensively so a malformed draft folds
 * to a clean rejection instead of an `NaN` constraint.
 */
function parseDraftVector(v: VectorDraft | undefined): SolvedVec3 | null {
  if (!Array.isArray(v) || v.length !== 3) return null
  const out: [number, number, number] = [0, 0, 0]
  for (let i = 0; i < 3; i += 1) {
    const cell = v[i]
    if (typeof cell !== 'string' || cell.trim().length === 0) return null
    const n = Number(cell)
    if (!Number.isFinite(n)) return null
    out[i] = n
  }
  return out as SolvedVec3
}

/**
 * Narrow a draft's cardinal-axis cell (the form's axis picker holds a
 * {@link MateCardinalAxis}) onto the shared {@link SolvedCardinalAxis}, or `null`
 * if it is not one of `'x' | 'y' | 'z'`. Defensive: an angle/tangent SolvedMate's
 * axis always parses (the picker offers only the three), but re-checking keeps a
 * malformed draft from folding to a degenerate (axis-less) rotational constraint.
 */
function parseDraftCardinalAxis(v: MateCardinalAxis | undefined): SolvedCardinalAxis | null {
  return v === 'x' || v === 'y' || v === 'z' ? v : null
}

/**
 * Adapt a renderer {@link SolvedMate} (whose `draft` is a {@link MateFormDraft}
 * with STRING vector cells) onto the shared {@link SolvedMateInput} (NUMBER
 * 3-vectors) that {@link persistMate} consumes. Only the fields the mate's `kind`
 * needs are parsed; an unparseable required cell yields `null` so the caller
 * rejects the persist rather than writing a degenerate constraint.
 *
 * Every kind has an EXPLICIT branch — point / axis / distance / **angle** /
 * **tangent** — and the remaining `plane` is the final fall-through. The angle /
 * tangent branches read the cardinal axis picks (+ degrees for angle); they are
 * handled before the fall-through so a rotational mate is never silently folded
 * as a `plane` flush constraint.
 *
 * Pure: no React, no IPC. The kind enum is shared 1:1 between the form
 * (`CadAssemblyMateKind`) and the fold (`SolvedMateKind`).
 */
export function solvedMateToInput(mate: SolvedMate): SolvedMateInput | null {
  const draft: MateFormDraft = mate.draft
  const kind = draft.kind as SolvedMateKind
  const base = { kind, part1Id: draft.part1Id, part2Id: draft.part2Id }

  if (kind === 'point') {
    const point1 = parseDraftVector(draft.point1)
    const point2 = parseDraftVector(draft.point2)
    if (!point1 || !point2) return null
    const adapted: SolvedMateDraftInput = { ...base, point1, point2 }
    return { id: mate.id, draft: adapted }
  }
  if (kind === 'axis') {
    const axis1 = parseDraftVector(draft.axis1)
    const axis2 = parseDraftVector(draft.axis2)
    if (!axis1 || !axis2) return null
    const adapted: SolvedMateDraftInput = { ...base, axis1, axis2 }
    return { id: mate.id, draft: adapted }
  }
  if (kind === 'distance') {
    // Persist-only parametric mate: two feature points + a numeric target (mm).
    // (The panel normally routes distance straight to persist via `persistOnly`,
    // bypassing this SolvedMate adapter; this branch keeps the seam complete so a
    // distance SolvedMate is never mis-handled as the plane fall-through.)
    const point1 = parseDraftVector(draft.point1)
    const point2 = parseDraftVector(draft.point2)
    if (!point1 || !point2) return null
    const value = Number(draft.value)
    if (!Number.isFinite(value) || value < 0) return null
    const adapted: SolvedMateDraftInput = { ...base, point1, point2, value }
    return { id: mate.id, draft: adapted }
  }
  if (kind === 'angle') {
    // Persist-only ROTATIONAL mate: two cardinal feature axes + a degrees target.
    // Explicit branch so an angle SolvedMate is NOT silently mis-folded as a plane
    // flush constraint (the historic fall-through bug). The cardinal axes come
    // straight off the form's axis picker; angleDeg is the right-angle target.
    const axis1Cardinal = parseDraftCardinalAxis(draft.axis1Cardinal)
    const axis2Cardinal = parseDraftCardinalAxis(draft.axis2Cardinal)
    if (!axis1Cardinal || !axis2Cardinal) return null
    const angleDeg = Number(draft.angleDeg)
    if (!Number.isFinite(angleDeg)) return null
    const adapted: SolvedMateDraftInput = { ...base, axis1Cardinal, axis2Cardinal, angleDeg }
    return { id: mate.id, draft: adapted }
  }
  if (kind === 'tangent') {
    // Persist-only ROTATIONAL mate: two cardinal feature axes, NO target
    // (perpendicular contact). Explicit branch (no plane fall-through).
    const axis1Cardinal = parseDraftCardinalAxis(draft.axis1Cardinal)
    const axis2Cardinal = parseDraftCardinalAxis(draft.axis2Cardinal)
    if (!axis1Cardinal || !axis2Cardinal) return null
    const adapted: SolvedMateDraftInput = { ...base, axis1Cardinal, axis2Cardinal }
    return { id: mate.id, draft: adapted }
  }
  // plane
  const point1 = parseDraftVector(draft.point1)
  const normal1 = parseDraftVector(draft.normal1)
  const point2 = parseDraftVector(draft.point2)
  const normal2 = parseDraftVector(draft.normal2)
  if (!point1 || !normal1 || !point2 || !normal2) return null
  const adapted: SolvedMateDraftInput = { ...base, point1, normal1, point2, normal2 }
  return { id: mate.id, draft: adapted }
}

/** Injected dependencies for {@link runPersistMate}. */
export interface PersistMateDeps {
  /** The solved mate handed back by the AssemblyMatePanel. */
  readonly mate: SolvedMate
  /** Open project directory, or `null` when none is open. */
  readonly projectDir: string | null
  /** Load `<projectDir>/assembly.json` (`fab().assemblyLoad`). */
  readonly loadAssembly: (projectDir: string) => Promise<AssemblyFile>
  /** Persist the updated assembly JSON (`fab().assemblySave`). */
  readonly saveAssembly: (projectDir: string, json: string) => Promise<void>
}

/** Discriminated result of {@link runPersistMate}. */
export type PersistMateOutcome =
  | { readonly ok: true; readonly toast: HandoffToast }
  | { readonly ok: false; readonly toast: HandoffToast }

/**
 * Durably persist a solved mate into the project's assembly.
 *
 * Steps (all guarded — every failure folds to a toast, never throws):
 *   1. require an open project (no `projectDir` ⇒ warn toast, no write);
 *   2. adapt the renderer draft → shared input ({@link solvedMateToInput});
 *   3. load the on-disk assembly (`loadAssembly`);
 *   4. run the pure {@link persistMate} fold (point→coincident, axis→concentric,
 *      plane→flush; idempotent re-persist by id);
 *   5. on success, re-save the assembly and toast "Mate saved"; on a rejected
 *      draft, toast the precise reason and DO NOT save.
 *
 * The save payload is `JSON.stringify(result.assembly)`; the `assembly:save`
 * handler re-validates it through `assemblyFileSchema` before writing, so a
 * corrupt fold can never reach disk.
 */
export async function runPersistMate(deps: PersistMateDeps): Promise<PersistMateOutcome> {
  const { mate, projectDir, loadAssembly, saveAssembly } = deps
  if (!projectDir) {
    return {
      ok: false,
      toast: {
        kind: 'warn',
        message: 'Open a project before saving an assembly mate.'
      }
    }
  }
  const input = solvedMateToInput(mate)
  if (!input) {
    return {
      ok: false,
      toast: {
        kind: 'err',
        message: 'Mate not saved: the solved mate had malformed feature vectors.'
      }
    }
  }

  let assembly: AssemblyFile
  try {
    assembly = await loadAssembly(projectDir)
  } catch (e) {
    return {
      ok: false,
      toast: {
        kind: 'err',
        message: `Mate not saved: could not load assembly.json (${e instanceof Error ? e.message : String(e)}).`
      }
    }
  }

  const result = persistMate(assembly, input)
  if (!result.ok) {
    return {
      ok: false,
      toast: { kind: 'err', message: `Mate not saved: ${result.reason}` }
    }
  }

  try {
    await saveAssembly(projectDir, JSON.stringify(result.assembly))
  } catch (e) {
    return {
      ok: false,
      toast: {
        kind: 'err',
        message: `Mate solved but failed to save: ${e instanceof Error ? e.message : String(e)}`
      }
    }
  }

  const count = result.assembly.mateConstraints.length
  return {
    ok: true,
    toast: {
      kind: 'ok',
      message: `Mate saved (${result.constraint.kind}). ${count} mate${count === 1 ? '' : 's'} on this assembly.`
    }
  }
}

// ── (3) Assembly hydrate (reload surface) ─────────────────────────────────────

/** Injected dependencies for {@link runHydrateAssembly}. */
export interface HydrateAssemblyDeps {
  /** Open project directory, or `null` when none is open. */
  readonly projectDir: string | null
  /** Load `<projectDir>/assembly.json` (`fab().assemblyLoad`). */
  readonly loadAssembly: (projectDir: string) => Promise<AssemblyFile>
}

/** Discriminated result of {@link runHydrateAssembly}. */
export type HydrateAssemblyOutcome =
  | { readonly ok: true; readonly hydrated: HydratedAssembly }
  | { readonly ok: false; readonly reason: string }

/**
 * Load the project's `assembly.json` and hydrate it into the renderer's
 * view-model (parts + durable mate constraints) so a SAVED assembly shows its
 * parts + mates after reload (closes #9). Pure orchestration over an injected
 * `loadAssembly` so the host stays a thin adapter and this is unit-testable.
 *
 * Backward-compatible: a legacy `assembly.json` with no `components` /
 * `mateConstraints` (the IPC returns an `emptyAssembly()` for ENOENT, and the
 * schema defaults both arrays) hydrates to empty parts/mates — the AssemblyView
 * then shows its own empty-state. No project open ⇒ a clean empty hydrate (no
 * load, no error) so the assemble route still mounts.
 */
export async function runHydrateAssembly(
  deps: HydrateAssemblyDeps
): Promise<HydrateAssemblyOutcome> {
  const { projectDir, loadAssembly } = deps
  if (!projectDir) {
    return {
      ok: true,
      hydrated: { name: 'Assembly', parts: [], mateConstraints: [], danglingMateIds: [] }
    }
  }
  let assembly: AssemblyFile
  try {
    assembly = await loadAssembly(projectDir)
  } catch (e) {
    return {
      ok: false,
      reason: `Could not load assembly.json (${e instanceof Error ? e.message : String(e)}).`
    }
  }
  return { ok: true, hydrated: hydrateAssembly(assembly) }
}

// ── (4) Assembly parts persistence (#8 — parts → components) ───────────────────

/** Injected dependencies for {@link runPersistAssemblyParts}. */
export interface PersistAssemblyPartsDeps {
  /** The current part rows from the AssemblyView. */
  readonly parts: readonly AssemblyPart[]
  /** Open project directory, or `null` when none is open. */
  readonly projectDir: string | null
  /** Load `<projectDir>/assembly.json` (`fab().assemblyLoad`). */
  readonly loadAssembly: (projectDir: string) => Promise<AssemblyFile>
  /** Persist the updated assembly JSON (`fab().assemblySave`). */
  readonly saveAssembly: (projectDir: string, json: string) => Promise<void>
}

/** Discriminated result of {@link runPersistAssemblyParts}. */
export type PersistAssemblyPartsOutcome =
  | { readonly ok: true; readonly componentCount: number }
  | { readonly ok: false; readonly reason: string }

/**
 * Fold the renderer's parts list into the on-disk assembly's `components` and
 * re-save (closes the write-only #8 gap so a mate's `part1Id`/`part2Id` resolve
 * against real saved components).
 *
 * Loads the CURRENT assembly first so the existing `mateConstraints` (written by
 * the mate-persist path) are PRESERVED — only `components` is replaced with the
 * fresh rows. The host serializes this through the SAME promise chain as
 * `runPersistMate` so a parts-save and a mate-save can never stale-base each
 * other's load (a silent lost-update). Additive + backward-compatible (Safety
 * Rule 2): the save payload round-trips through `assemblyFileSchema` in the
 * `assembly:save` IPC, which re-validates before writing.
 *
 * No project open ⇒ a clean no-op success (in-memory only); a load/save failure
 * folds to a reason the host can toast.
 */
export async function runPersistAssemblyParts(
  deps: PersistAssemblyPartsDeps
): Promise<PersistAssemblyPartsOutcome> {
  const { parts, projectDir, loadAssembly, saveAssembly } = deps
  if (!projectDir) {
    return { ok: true, componentCount: 0 }
  }
  let assembly: AssemblyFile
  try {
    assembly = await loadAssembly(projectDir)
  } catch (e) {
    return {
      ok: false,
      reason: `Could not load assembly.json (${e instanceof Error ? e.message : String(e)}).`
    }
  }
  // Fold the rows into `components` via the shared persistParts core (id-keyed,
  // order-preserving; updates in place so prior component fields the renderer's
  // row does not model — grounded / joint / BOM metadata — are PRESERVED on a
  // re-persist). Adapt each renderer AssemblyPart onto the shared AssemblyPartView.
  const folded = persistParts(assembly, parts.filter((p) => p.id?.trim().length).map(partToView))
  // Drop any mate whose part refs no longer exist among the new components, so a
  // removed part can't leave a dangling constraint on disk (the renderer already
  // prunes its in-memory mates on remove; this keeps the persisted file in sync).
  const componentIds = new Set(folded.components.map((c) => c.id))
  const mateConstraints = (folded.mateConstraints ?? []).filter(
    (m) => componentIds.has(m.part1Id) && componentIds.has(m.part2Id)
  )
  const next: AssemblyFile = { ...folded, mateConstraints }
  try {
    await saveAssembly(projectDir, JSON.stringify(next))
  } catch (e) {
    return {
      ok: false,
      reason: `Could not save assembly.json (${e instanceof Error ? e.message : String(e)}).`
    }
  }
  return { ok: true, componentCount: folded.components.length }
}

// ── (5) Assembly mate-LIST persistence (delete / edit-scalar / suppress) ───────
//
// The Mates panel's per-row DELETE / EDIT / SUPPRESS actions all reduce to the
// same durable operation: REPLACE the on-disk assembly's `mateConstraints` with a
// new list the renderer already computed (via the pure folds in
// `assembly-mate-persist`: removeMateConstraint / setMateConstraintScalar /
// setMateSuppress), then re-save. This ONE runner covers all three — it mirrors
// `runPersistAssemblyParts` (load → replace one field → save), preserving
// `components` untouched, and it serializes through the SAME host promise chain as
// the mate-ADD path so a list edit can never stale-base a concurrent parts / mate
// save. SAFETY: assembly-data write only; no G-code. Additive (Safety Rule 2): the
// save payload round-trips through `assemblyFileSchema` in `assembly:save`.

/** Injected dependencies for {@link runPersistMateConstraints}. */
export interface PersistMateConstraintsDeps {
  /** The FULL desired mate list (renderer already applied the delete/edit/suppress fold). */
  readonly mateConstraints: readonly AssemblyMateConstraint[]
  /** Open project directory, or `null` when none is open. */
  readonly projectDir: string | null
  /** Load `<projectDir>/assembly.json` (`fab().assemblyLoad`). */
  readonly loadAssembly: (projectDir: string) => Promise<AssemblyFile>
  /** Persist the updated assembly JSON (`fab().assemblySave`). */
  readonly saveAssembly: (projectDir: string, json: string) => Promise<void>
}

/** Discriminated result of {@link runPersistMateConstraints}. */
export type PersistMateConstraintsOutcome =
  | { readonly ok: true; readonly mateCount: number }
  | { readonly ok: false; readonly reason: string }

/**
 * Replace the on-disk assembly's `mateConstraints` with the renderer's current
 * list and re-save. Loads the CURRENT assembly first so `components` (+ every
 * field the mate list does not model) is PRESERVED — only `mateConstraints` is
 * swapped. No project open ⇒ a clean no-op success (in-memory only); a load / save
 * failure folds to a reason the host can toast.
 */
export async function runPersistMateConstraints(
  deps: PersistMateConstraintsDeps
): Promise<PersistMateConstraintsOutcome> {
  const { mateConstraints, projectDir, loadAssembly, saveAssembly } = deps
  if (!projectDir) {
    return { ok: true, mateCount: 0 }
  }
  let assembly: AssemblyFile
  try {
    assembly = await loadAssembly(projectDir)
  } catch (e) {
    return {
      ok: false,
      reason: `Could not load assembly.json (${e instanceof Error ? e.message : String(e)}).`
    }
  }
  const next: AssemblyFile = { ...assembly, mateConstraints: [...mateConstraints] }
  try {
    await saveAssembly(projectDir, JSON.stringify(next))
  } catch (e) {
    return {
      ok: false,
      reason: `Could not save assembly.json (${e instanceof Error ? e.message : String(e)}).`
    }
  }
  return { ok: true, mateCount: next.mateConstraints.length }
}
