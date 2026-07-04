/**
 * assembly-render-seam — the thin RENDERER adapter over the shared, pure
 * assembly **interference** + **BOM** cores, for the two analysis surfaces this
 * cycle adds to {@link AssemblyView}:
 *
 *   1. **Interference** — AABB broad-phase clash detection
 *      ({@link interferencesForParts}), backed by the engine's
 *      `assembly-interference.ts` `detectInterferencesWithDims`. When a part
 *      carries a real local AABB (its persisted `geometrySourceRef.cachedBounds`,
 *      or a live-geometry override), the engine's OBB narrow phase activates and
 *      rotation-inflated bbox false positives are cleared (`fidelity:
 *      'bbox+narrow'`); otherwise the result is the pure conservative broad phase
 *      (`fidelity: 'bbox'`).
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
 *   - Interference stays a **bounding-box** check (never a B-rep boolean), but its
 *     fidelity now depends on whether a part carries real geometry:
 *       · a part with a real local AABB (its persisted
 *         `geometrySourceRef.cachedBounds`, or a live-geometry override via
 *         {@link localAabbFromGeometry}) is measured at its TRUE extent and refined
 *         by the engine's OBB narrow phase — rotation-inflated false positives are
 *         cleared (`fidelity: 'bbox+narrow'`);
 *       · a part with NO cached box falls back to a fixed
 *         {@link NOMINAL_HALF_EXTENT_MM} cube centred at its placement — the honest
 *         "are these parts at ~the same place" heuristic, and the narrow phase
 *         keeps any such pair conservatively.
 *     A reported pair may still not truly intersect at the bbox level; a cleared
 *     pair reliably does not.
 *   - BOM `qty` is the summed instance count per durable geometry source; it is
 *     not a geometry-resolved de-dupe (two rows referencing the same body via
 *     different ref kinds do not merge — the documented limit of a pure BOM).
 *
 * Pure: no React, no DOM, no IPC. Unit-tested with plain objects
 * (`__tests__/assembly-render-seam.test.ts`).
 */

import type { BufferGeometry } from 'three'
import { partsToComponents } from './assembly-part-bridge'
import type { AssemblyPart } from './AssemblyView'
import {
  detectInterferencesWithDims,
  type InterferencePart,
  type InterferenceReport,
  type NarrowPhaseGeometry,
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
 * Compute a part's **local-frame** axis-aligned bounding box from a live Three.js
 * {@link BufferGeometry} — the exact mesh already tessellated for the viewport, so
 * no sidecar round-trip and no protocol change. Returns the box in the engine's
 * `{ min, max }` {@link InterferencePart} `localBox` shape the narrow phase
 * consumes.
 *
 * `computeBoundingBox()` fills `geometry.boundingBox`; a geometry with no position
 * data (or a non-finite box — an empty/degenerate mesh) yields `null` so a bad
 * mesh degrades to the conservative nominal box rather than corrupting the check.
 * Pure aside from mutating `geometry.boundingBox` (Three.js's own cache field);
 * exported for the focused unit test.
 */
export function localAabbFromGeometry(
  geometry: BufferGeometry | null | undefined,
): InterferencePart['localBox'] | null {
  if (!geometry) return null
  if (geometry.boundingBox == null) geometry.computeBoundingBox()
  const box = geometry.boundingBox
  if (box == null) return null
  const { min, max } = box
  if (
    !Number.isFinite(min.x) ||
    !Number.isFinite(min.y) ||
    !Number.isFinite(min.z) ||
    !Number.isFinite(max.x) ||
    !Number.isFinite(max.y) ||
    !Number.isFinite(max.z)
  ) {
    return null
  }
  return { min: [min.x, min.y, min.z], max: [max.x, max.y, max.z] }
}

/**
 * A part's real **local** AABB, sourced from its persisted, structured geometry
 * source (`geometrySourceRef.cachedBounds` — the tessellation bbox captured when
 * an external STEP body was imported; see `assembly-schema.ts`). `undefined` when
 * the row carries no structured source or no cached box — the interference check
 * then uses the nominal cube for that part and the narrow phase treats it as "no
 * dims" (kept conservatively). `cachedBounds` is already in the engine's
 * `{ min, max }` `localBox` shape, so no conversion is needed.
 */
function realLocalBox(part: AssemblyPart): InterferencePart['localBox'] | undefined {
  const cached = part.geometrySourceRef?.cachedBounds
  if (cached == null) return undefined
  return { min: [...cached.min], max: [...cached.max] }
}

/**
 * Map one renderer {@link AssemblyPart} onto an engine {@link InterferencePart}:
 * the part id, its placement transform (position + rotation; identity → origin),
 * and a local box. The local box is, in preference order:
 *   1. the caller-supplied `boxes` override for this id (freshly computed from a
 *      live geometry), else
 *   2. the part's persisted `geometrySourceRef.cachedBounds` box, else
 *   3. the fixed nominal cube.
 *
 * The engine maps the local box through the transform (Euler-ZYX) to a
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
    localBox: boxes?.get(part.id) ?? realLocalBox(part) ?? nominalLocalBox(),
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
 * Build the id-keyed {@link NarrowPhaseGeometry} map that activates the engine's
 * OBB **narrow phase**. A part contributes an entry ONLY when it has a real local
 * AABB — the caller-supplied `boxes` override for its id, else its persisted
 * `geometrySourceRef.cachedBounds`. Parts with only the nominal cube are OMITTED so
 * the narrow phase treats them as "no dims" (keeps the pair conservatively rather
 * than refining a fake extent). The transform is carried through so the OBB SAT
 * rotates each real box exactly as the broad phase does. Returns an empty map when
 * no part carries real geometry (the check then stays byte-identical to the pure
 * bbox path).
 */
function narrowPhaseGeometryForParts(
  parts: readonly AssemblyPart[],
  boxes?: ReadonlyMap<string, InterferencePart['localBox']>
): ReadonlyMap<string, NarrowPhaseGeometry> {
  const out = new Map<string, NarrowPhaseGeometry>()
  for (const part of parts) {
    const localBox = boxes?.get(part.id) ?? realLocalBox(part)
    if (localBox == null) continue
    const pos = part.transform?.position
    const rot = part.transform?.rotation
    out.set(part.id, {
      localBox,
      transform: {
        x: pos?.[0] ?? 0,
        y: pos?.[1] ?? 0,
        z: pos?.[2] ?? 0,
        rxDeg: rot?.[0] ?? 0,
        ryDeg: rot?.[1] ?? 0,
        rzDeg: rot?.[2] ?? 0,
      },
    })
  }
  return out
}

/**
 * Run interference detection over the renderer's part rows, returning the engine's
 * {@link InterferenceReport}. Pure + synchronous.
 *
 * When any part carries a real local AABB (its persisted
 * `geometrySourceRef.cachedBounds`, or a live-geometry override in `boxes`), the
 * engine's OBB **narrow phase** activates via {@link detectInterferencesWithDims}:
 * rotation-inflated bbox false positives are cleared and `fidelity` becomes
 * `'bbox+narrow'`. When NO part carries real geometry the map is empty, so the
 * result is byte-identical to the conservative bbox-only path (`fidelity: 'bbox'`)
 * — no regression for un-hydrated assemblies. A part missing dims degrades to its
 * nominal cube for the broad phase and is kept conservatively by the narrow phase
 * (never crashes, never a false negative).
 *
 * Pass `boxes` to override a part's persisted box with one freshly computed from a
 * live geometry (see {@link localAabbFromGeometry}); it takes precedence over the
 * persisted `cachedBounds` for both the broad and narrow phases.
 */
export function interferencesForParts(
  parts: readonly AssemblyPart[],
  boxes?: ReadonlyMap<string, InterferencePart['localBox']>
): InterferenceReport {
  return detectInterferencesWithDims(
    parts.map((p) => partToInterferencePart(p, boxes)),
    narrowPhaseGeometryForParts(parts, boxes),
  )
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
