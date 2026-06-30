/**
 * FG-5b · Per-feature property-dialog contract (pure, framework-light types).
 *
 * The six dialogs in this folder (Extrude, Revolve, Fillet, Chamfer, Shell,
 * Hole) are **presentational and props-driven**. Each one:
 *   1. reads the operator's current 3D selection (`Selection` — a picked
 *      face / edge / vertex id from `design/selection-state.ts`), and
 *   2. reads the feature's current params (its own typed `*Params` shape), and
 *   3. emits param changes back up to the host, which flows them to the kernel
 *      through the EXISTING path (no new IPC, no new kernel call):
 *        - Fillet / Chamfer / Shell / Hole → a {@link KernelPostSolidOp} that the
 *          host appends to `part/features.json` `kernelOps[]` via
 *          `DesignSessionContext.appendKernelOp` (replayed by Build STEP through
 *          `resolveTimeline`).
 *        - Extrude / Revolve → a CadQuery **script-parameter patch**
 *          (`Record<string, CadScriptParamValue>`) that the host hands to
 *          `DesignWorkspace.handleParamsChange` → `cad.execute({ script,
 *          buildParameters })`. There is no `extrude` / `revolve` kernelOp
 *          variant in `kernelPostSolidOpSchema` today (the schema is *post*-base
 *          ops only; the base solid still comes from the script), so emitting a
 *          fake kernelOp would be dishonest. The dialog therefore drives the
 *          parameter the script already exposes (e.g. `extrudeDepthMm`).
 *
 * Why a discriminated-union emit type instead of two separate callbacks? So the
 * host can wire a single `onApply` per dialog and switch on `change.target` to
 * pick the right existing sink. That keeps the dialogs decoupled from *which*
 * sink the host uses while still being explicit (no `any`, no stringly-typed
 * dispatch).
 *
 * Honesty note (CLAUDE.md "do not fake capability"): the kernel's fillet /
 * chamfer / shell selection has TWO real paths. (1) The axis bucket
 * (`edgeDirection` / `openDirection`: ±X/±Y/±Z) — the always-available default.
 * (2) FG-5b picked-id targeting — when the operator's live {@link Selection}
 * carries a STABLE OCCT id (`occtHash` = `"e:<hex>"` for an edge, `"f:<hex>"`
 * for a face), the dialog emits it as `fillet_select.pickedEdgeIds` /
 * `chamfer_select.pickedEdgeIds` / `shell_inward.pickedFaceIds`, and the kernel
 * resolves it back to the exact topology at build (falling back to the axis
 * bucket if it no longer resolves — topological-naming limit). A picked
 * Selection WITHOUT a stable `occtHash` (e.g. a legacy face id with no
 * `faceOcctIds` stash) carries only as context — it never fakes an id reaching
 * the kernel. See {@link FeatureDialogSelectionInfo} + {@link pickedOcctIdFor}.
 */

import type { KernelPostSolidOp } from '../../../shared/part-features-schema'
import type { CadScriptParamValue } from '../../../shared/sidecar-protocol'
import {
  resolvePickedId,
  type CurrentPickIndex,
  type PickLostReason,
  type StoredPick,
} from '../../../shared/kernel-pick-file'
import type { Selection } from '../selection-state'

/**
 * The features that have a property dialog in this folder. Mirrors the catalog
 * ids (`so_extrude`, `so_revolve`, `so_fillet`, `so_chamfer`, `so_shell`,
 * `so_hole`, plus the Construct datum rows `co_offset_plane` / `co_datum_axis` /
 * `co_datum_point`) without coupling the dialog kit to the full catalog.
 *
 * The three `datum_*` kinds emit a CONSTRUCTION-geometry marker op (no solid
 * change) — see {@link FeatureDialogChange} `target: 'kernelOp'` and the
 * `datum_plane` / `datum_axis` / `datum_point` schemas in
 * `part-features-schema.ts`. They build via `build_part.py` as manifest markers.
 */
export type FeatureDialogKind =
  | 'extrude'
  | 'revolve'
  | 'fillet'
  | 'chamfer'
  | 'shell'
  | 'hole'
  | 'datum_plane'
  | 'datum_axis'
  | 'datum_point'
  // ── Wave-wired kernelOp dialogs (Move/Copy, Mirror, Split, patterns,
  //    box/cylinder booleans, Thread, Thicken, Coil, plastic features). Each is a
  //    member of `kernelPostSolidOpSchema` driven purely by params — see the
  //    matching `*Dialog.tsx` op-builders.
  | 'transform_translate'
  | 'mirror_union_plane'
  | 'split_keep_halfspace'
  | 'pattern_rectangular'
  | 'pattern_circular'
  | 'pattern_linear_3d'
  | 'boolean_union_box'
  | 'boolean_subtract_box'
  | 'boolean_intersect_box'
  | 'boolean_subtract_cylinder'
  | 'thread_wizard'
  | 'thicken_offset'
  | 'coil_cut'
  | 'plastic_rule_fillet'
  | 'plastic_boss'
  | 'plastic_lip_groove'
  // ── Selection-heavy profile/path dialogs: a profile by index and/or a path as a
  //    point list, picked from sketch-derived dropdowns (ProfilePathFields).
  | 'press_pull_profile'
  | 'boolean_combine_profile'
  | 'pipe_path'
  | 'pattern_path'
  | 'sweep_profile_path_true'

/** The catalog command id each dialog corresponds to (single source of truth). */
export const FEATURE_DIALOG_COMMAND_ID: Readonly<Record<FeatureDialogKind, string>> = {
  extrude: 'so_extrude',
  revolve: 'so_revolve',
  fillet: 'so_fillet',
  chamfer: 'so_chamfer',
  shell: 'so_shell',
  hole: 'so_hole',
  datum_plane: 'co_offset_plane',
  datum_axis: 'co_datum_axis',
  datum_point: 'co_datum_point',
  // Catalog ids that already exist in fusion-style-command-catalog.ts (so the
  // Solid/Construct ribbon buttons + palette rows were already rendered; this
  // wiring is what makes the button OPEN the dialog instead of toasting).
  transform_translate: 'so_move_copy',
  mirror_union_plane: 'so_mirror_body',
  split_keep_halfspace: 'so_split',
  pattern_rectangular: 'so_pattern_rect',
  pattern_circular: 'so_pattern_circ',
  thread_wizard: 'so_thread',
  thicken_offset: 'so_thicken',
  coil_cut: 'so_coil',
  plastic_rule_fillet: 'pl_rule_fillet',
  plastic_boss: 'pl_boss',
  plastic_lip_groove: 'pl_lip_groove',
  // New catalog rows added for ops that had a kernel + dialog but no catalog
  // entry yet (so a ribbon button now exists for them).
  pattern_linear_3d: 'so_pattern_linear',
  boolean_union_box: 'so_add_box',
  boolean_subtract_box: 'so_cut_box',
  boolean_intersect_box: 'so_intersect_box',
  boolean_subtract_cylinder: 'so_cut_cylinder',
  // Selection-heavy profile/path dialogs (catalog rows already exist).
  press_pull_profile: 'so_press_pull',
  boolean_combine_profile: 'so_combine',
  pipe_path: 'so_pipe',
  pattern_path: 'so_pattern_path',
  sweep_profile_path_true: 'so_sweep'
}

/**
 * The axis-bucket directions the kernel's `fillet_select` / `chamfer_select` /
 * `shell_inward` ops accept. This is the ONLY edge/face targeting the kernel
 * supports today — a coarse "all edges pointing roughly +Z" bucket, not a
 * picked edge. Kept as a const tuple so the pickers iterate it and the type
 * stays in lockstep with `part-features-schema.ts`.
 */
export const EDGE_DIRECTION_OPTIONS = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'] as const
export type EdgeDirection = (typeof EDGE_DIRECTION_OPTIONS)[number]

/** Human-readable label for an axis-bucket direction (for the picker UI). */
export const EDGE_DIRECTION_LABELS: Readonly<Record<EdgeDirection, string>> = {
  '+X': '+X (right)',
  '-X': '−X (left)',
  '+Y': '+Y (back)',
  '-Y': '−Y (front)',
  '+Z': '+Z (top)',
  '-Z': '−Z (bottom)'
}

/**
 * What a dialog hands back when the operator applies it. A discriminated union
 * so the host routes each to its existing sink:
 *   - `target: 'kernelOp'`  → `appendKernelOp(op)` (Fillet/Chamfer/Shell/Hole)
 *   - `target: 'scriptParams'` → `handleParamsChange(patch)` (Extrude/Revolve)
 */
export type FeatureDialogChange =
  | { readonly target: 'kernelOp'; readonly op: KernelPostSolidOp }
  | {
      readonly target: 'scriptParams'
      readonly params: Readonly<Record<string, CadScriptParamValue>>
    }

/**
 * Selection context handed to every dialog. Carries the operator's live pick
 * (or `null`) plus an optional friendly label (e.g. "Face 4 · 25.0 mm²") the
 * host already derives in `DesignWorkspace`. The dialogs read this to:
 *   - show the operator WHAT they have selected, and
 *   - (Fillet/Chamfer) pre-hint an axis bucket / honestly flag that the picked
 *     edge cannot yet drive the kernel.
 *
 * It is deliberately NOT a hard requirement to apply most dialogs — the
 * axis-bucket ops work with no selection at all — but the dialog surfaces a
 * gentle prompt when a selection would make the choice clearer.
 */
export interface FeatureDialogSelectionInfo {
  /** The live pick from `DesignWorkspace` selection state, or `null`. */
  readonly selection: Selection | null
  /** Friendly label the host already computed (area-aware), or `null`. */
  readonly label: string | null
  /**
   * Tier-2 · OPTIONAL index of the CURRENT build's pickable entities (built by
   * the host from the live selection tessellation via `buildPickIndex`). When
   * present, {@link resolvePickedSelectionId} routes the picked id+signature
   * through the tiered resolver so a pick that MOVED / UNIFORMLY RESIZED upstream
   * still resolves to its current stable id (Tier 2) instead of emitting a dead
   * id. Absent on hosts that don't supply it — the dialogs then emit the live
   * pick id unchanged (the existing Tier-1-only behaviour).
   */
  readonly currentPickIndex?: CurrentPickIndex
}

/** Shared props every feature dialog accepts. */
export interface FeatureDialogBaseProps {
  /** Current 3D selection context (face/edge pick + label). */
  readonly selectionInfo: FeatureDialogSelectionInfo
  /**
   * Apply the dialog's current values. The host wires this to the matching
   * existing sink based on `change.target`. Required — a dialog with no sink is
   * meaningless.
   */
  readonly onApply: (change: FeatureDialogChange) => void
  /**
   * True while the host is mid-flight applying the previous change (e.g. a
   * `cad.execute` re-run or a `featuresSave`). Disables the Apply button so a
   * double-click can't double-submit. Optional — defaults to `false`.
   */
  readonly busy?: boolean
  /**
   * True when the host has no open project / no built model yet, so applying
   * would be a no-op (e.g. `appendKernelOp` early-returns when `projectDir` is
   * null). Lets the dialog render a disabled Apply + an honest hint instead of
   * silently dropping the click. Optional — defaults to `false`.
   */
  readonly disabled?: boolean
}

/** Clamp a parsed number to a finite, strictly-positive mm value or `null`. */
export function parsePositiveMm(raw: string): number | null {
  if (raw.trim() === '') return null
  const n = Number.parseFloat(raw)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

/** Clamp a parsed number to any finite mm value (signed) or `null`. */
export function parseFiniteMm(raw: string): number | null {
  if (raw.trim() === '') return null
  const n = Number.parseFloat(raw)
  if (!Number.isFinite(n)) return null
  return n
}

/** Clamp a parsed integer into `[min, max]`, or `null` if unparseable. */
export function parseClampedInt(raw: string, min: number, max: number): number | null {
  if (raw.trim() === '') return null
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n)) return null
  return Math.max(min, Math.min(max, n))
}

/**
 * FG-5b · Extract the STABLE picked-OCCT id (`"e:<hex>"` / `"f:<hex>"`) from a
 * selection when it is BOTH the requested `kind` AND carries a non-empty
 * `occtHash`. Returns `null` otherwise — which is the dialog's signal to fall
 * back to the axis bucket. This is the one gate that decides "does this pick
 * drive the kernel by id, or only by axis bucket?", so it is intentionally
 * strict: a selection of the wrong kind (e.g. a face pick handed to a fillet,
 * which wants an edge), or one with no stable id, NEVER produces a picked id.
 * Pure; exported for the op-builder test.
 */
export function pickedOcctIdFor(
  selection: Selection | null,
  kind: Selection['kind']
): string | null {
  if (selection === null || selection.kind !== kind) return null
  const id = selection.occtHash
  return typeof id === 'string' && id.length > 0 ? id : null
}

/**
 * Tier-2 · The picked-id resolution a dialog acts on. Distinguishes the THREE
 * tiers so the dialog can be honest in its read-out:
 *   * `{ id, tier: 1 }`     — exact id hit (or no current index supplied, so the
 *                             live id is used as-is — Tier-1-only behaviour).
 *   * `{ id, tier: 2 }`     — the pick MOVED / RESIZED upstream and was recovered
 *                             by its geometry-invariant signature; `id` is the
 *                             CURRENT build's id for that entity (what to emit).
 *   * `{ id: null, reason }` — no usable id: either there was never a stable pick
 *                             (axis-bucket-only, `reason: undefined`) OR the pick
 *                             was honestly lost after the edit (`reason` set).
 */
export type PickedIdResolution =
  | { readonly id: string; readonly tier: 1 | 2 }
  | { readonly id: null; readonly reason?: PickLostReason }

/**
 * Tier-2 · The single gate the picked-edge consumers (Fillet / Chamfer / Shell)
 * route through. Given the live {@link Selection}, the entity `kind` the op
 * wants, and the host's optional {@link CurrentPickIndex}, decide WHICH stable id
 * (if any) the op should target:
 *
 *   1. Extract the live picked id via {@link pickedOcctIdFor} (wrong-kind / no
 *      stable id → no picked id at all, `{ id: null }` — axis bucket).
 *   2. If the host supplied no `currentPickIndex`, emit the live id unchanged
 *      (`tier: 1`) — the pre-Tier-2 behaviour, so a host that hasn't wired the
 *      index keeps working exactly as before.
 *   3. Otherwise route `{ id, signature }` through {@link resolvePickedId}:
 *        - Tier 1 exact hit  → `{ id, tier: 1 }`.
 *        - Tier 2 recovery   → `{ id: <current id>, tier: 2 }` (the entity moved/
 *          resized; emit the build's CURRENT id, not the stale one).
 *        - honest loss       → `{ id: null, reason }` (caller falls back to the
 *          axis bucket and surfaces the loss — never guesses).
 *
 * Pure; exported for the resolver-routing unit test.
 */
export function resolvePickedSelectionId(
  selection: Selection | null,
  kind: Exclude<Selection['kind'], 'vertex'>,
  currentPickIndex?: CurrentPickIndex
): PickedIdResolution {
  const liveId = pickedOcctIdFor(selection, kind)
  if (liveId === null) return { id: null }

  // No current build to resolve against → Tier-1-only: emit the live id as-is.
  if (!currentPickIndex) return { id: liveId, tier: 1 }

  // `selection` is non-null and of the requested kind (pickedOcctIdFor proved
  // it), so its signature — if any — is the matching variant. Build the StoredPick.
  const stored: StoredPick =
    kind === 'face'
      ? { kind: 'face', id: liveId, signature: selection?.kind === 'face' ? selection.signature : undefined }
      : { kind: 'edge', id: liveId, signature: selection?.kind === 'edge' ? selection.signature : undefined }

  const res = resolvePickedId(stored, currentPickIndex)
  if (res.ok) return { id: res.id, tier: res.tier }
  return { id: null, reason: res.reason }
}
