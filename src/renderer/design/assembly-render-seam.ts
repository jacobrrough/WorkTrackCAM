/**
 * assembly-render-seam — the thin RENDERER adapter over the shared, pure
 * assembly **interference** + **BOM** cores, for the two analysis surfaces this
 * cycle adds to {@link AssemblyView}:
 *
 *   1. **Interference** — bbox-level (AABB) clash detection
 *      ({@link interferencesForParts}), backed by the engine's
 *      `assembly-interference.ts` `detectInterferences`.
 *   2. **BOM** — a qty/name/source roll-up ({@link bomForParts}), backed by the
 *      engine's `assembly-bom.ts` `deriveBom`.
 *
 * The campaign's ENGINE agent owns the canonical, framework-agnostic cores in
 * `shared`; this module is the SINGLE small translation layer between the
 * renderer's `AssemblyPart` row shape and those cores (the same posture as
 * `assembly-part-bridge.ts` for persistence). Keeping the adaptation here means
 * the components consume one renderer-friendly shape while the real logic lives
 * once in `shared` — no drift, no duplicated AABB / roll-up math.
 *
 * The mate-kind SSOT lives elsewhere again (the engine's `assembly-mate-form.ts`
 * `OFFERED_MATE_KINDS`); the AssemblyMatePanel consumes THAT directly.
 *
 * HONESTY CONTRACT (load-bearing):
 *   - Interference is **bbox-level**: the engine returns `fidelity: 'bbox'` and
 *     this module surfaces it. A reported pair may not truly intersect (two
 *     L-shapes can share a bounding box without touching); a cleared pair
 *     reliably does not. The renderer's `AssemblyPart` carries NO real geometry
 *     size, so each part is given a fixed {@link NOMINAL_HALF_EXTENT_MM} local
 *     box centred at its placement — an honest "are these parts at ~the same
 *     place" heuristic, labelled as nominal where it surfaces.
 *   - BOM `qty` is the summed instance count per durable geometry source; it is
 *     not a geometry-resolved de-dupe (two rows referencing the same body via
 *     different ref kinds do not merge — the documented limit of a pure BOM).
 *
 * Pure: no React, no DOM, no IPC. Unit-tested with plain objects
 * (`__tests__/assembly-render-seam.test.ts`).
 */

import { partsToComponents } from './assembly-part-bridge'
import type { AssemblyPart } from './AssemblyView'
import {
  detectInterferences,
  type InterferencePart,
  type InterferenceReport,
} from '../../shared/assembly-interference'
import { deriveBom, type BomResult, type BomRow } from '../../shared/assembly-bom'
import type { AssemblyFile } from '../../shared/assembly-schema'

// Re-export the engine result/row types so AssemblyView imports them from the
// one seam (it never needs to reach into two shared modules directly).
export type { InterferenceReport, InterferencePair } from '../../shared/assembly-interference'
export type { BomResult, BomRow } from '../../shared/assembly-bom'

// ── (1) Interference (bbox-level clash) ──────────────────────────────────────

/**
 * Nominal half-extent (mm) for a part's stand-in local AABB. The renderer's
 * {@link AssemblyPart} carries only a transform (position + rotation), NOT a real
 * geometry size — so interference is computed on a fixed-size box centred at the
 * origin in each part's local frame and placed by its transform. This is an
 * HONEST heuristic, NOT a B-rep solver: it flags parts that sit at (or within
 * ~one box of) the same place — the dominant "I forgot to move the second
 * instance" mistake. Surfaces labelled "bbox-level (nominal extents)". The real
 * per-part tessellation bbox is threaded through {@link interferencesForParts}'s
 * optional `boxes` arg once available.
 */
export const NOMINAL_HALF_EXTENT_MM = 10

function nominalLocalBox(): InterferencePart['localBox'] {
  const h = NOMINAL_HALF_EXTENT_MM
  return { min: [-h, -h, -h], max: [h, h, h] }
}

/**
 * Map one renderer {@link AssemblyPart} onto an engine {@link InterferencePart}:
 * the part id, its placement transform (position + rotation; identity → origin),
 * and a local box (the caller-supplied real box for this id, else the nominal
 * cube). The engine maps the local box through the transform (Euler-ZYX) to a
 * conservative world AABB, so a placed/rotated part lands where the solver +
 * viewport place it.
 */
function partToInterferencePart(
  part: AssemblyPart,
  boxes?: ReadonlyMap<string, InterferencePart['localBox']>
): InterferencePart {
  const pos = part.transform?.position
  const rot = part.transform?.rotation
  return {
    id: part.id,
    localBox: boxes?.get(part.id) ?? nominalLocalBox(),
    transform: {
      x: pos?.[0] ?? 0,
      y: pos?.[1] ?? 0,
      z: pos?.[2] ?? 0,
      rxDeg: rot?.[0] ?? 0,
      ryDeg: rot?.[1] ?? 0,
      rzDeg: rot?.[2] ?? 0,
    },
  }
}

/**
 * Run bbox-level interference detection over the renderer's part rows, returning
 * the engine's {@link InterferenceReport} (clashing pairs + fidelity tag). Pure +
 * synchronous. Pass `boxes` to override the nominal cube with each part's real
 * local AABB (keyed by part id) once tessellation bboxes are threaded through.
 */
export function interferencesForParts(
  parts: readonly AssemblyPart[],
  boxes?: ReadonlyMap<string, InterferencePart['localBox']>
): InterferenceReport {
  return detectInterferences(parts.map((p) => partToInterferencePart(p, boxes)))
}

/** The set of part ids participating in any clash (for highlighting rows). */
export function clashingPartIds(report: InterferenceReport): ReadonlySet<string> {
  const ids = new Set<string>()
  for (const pair of report.clashingPairs) {
    ids.add(pair.aId)
    ids.add(pair.bId)
  }
  return ids
}

// ── (2) BOM roll-up (qty / name / source) ────────────────────────────────────

/**
 * Roll up the renderer's part rows into a source-keyed BOM via the engine's
 * `deriveBom`. The rows are adapted to schema components through the shared
 * `partsToComponents` core (so the durable geometry-source preference + the
 * roll-up rule live once, in `shared`), wrapped in an ephemeral
 * {@link AssemblyFile}, and rolled up. Pure + synchronous.
 *
 * A blank-id part row cannot be a component (it has no stable identity), so
 * `partsToComponents` drops it — it never appears as a BOM line.
 */
export function bomForParts(parts: readonly AssemblyPart[]): BomResult {
  const file: AssemblyFile = {
    version: 2,
    name: 'Assembly',
    components: partsToComponents(parts),
    mateConstraints: [],
  }
  return deriveBom(file)
}

/**
 * One-line human label for a BOM row's source: the durable ref kind + value
 * (`designModel:abc`, `relPath:assets/x.stl`, `handle:script:…`, `partPath:…`).
 * Surfaced in the BOM table's Source column so the operator can see which body a
 * line rolls up. Long refs are tail-truncated to keep the cell compact.
 */
export function bomRowSourceLabel(row: BomRow): string {
  const { kind, ref } = row.source
  const short = ref.length > 40 ? `…${ref.slice(ref.length - 39)}` : ref
  return `${kind}: ${short}`
}
