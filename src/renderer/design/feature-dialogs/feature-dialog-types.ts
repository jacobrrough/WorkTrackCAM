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
  datum_point: 'co_datum_point'
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
