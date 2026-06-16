/**
 * Assembly **bill of materials** derivation (pure).
 *
 * Rolls an assembly's `components` up into a part-list keyed by **geometry
 * source** — the "N instances of one body collapse into one BOM line with
 * quantity N" view a shop expects. This is the data-layer half of the Assembly
 * BOM feature; the renderer consumes {@link deriveBom} to paint a BOM table and
 * the existing `assembly:exportBom*` IPC writes the per-instance CSV.
 *
 * ## What "source" means (and the rollup rule)
 *
 * Each row aggregates every active (non-suppressed) component that shares the
 * same **source key**. The source is derived from the component's
 * `geometrySource` (closes the "all parts shared one handle" defect — each row
 * now carries its OWN body ref), preferring the most **durable** reference:
 *
 *   1. `designModelId` — a stable `DesignModel` id saved in the project. The
 *      durable cross-session ref → the canonical rollup key.
 *   2. `relPath`       — a project-relative exported-body path. Portable on disk.
 *   3. `handle`        — an ephemeral CadQuery session handle. A last resort
 *      (does not survive a restart) but still distinguishes bodies in-session.
 *   4. `partPath`      — fallback when a component has NO `geometrySource`
 *      (legacy rows). The schema guarantees a non-empty `partPath`, so every
 *      component lands in exactly one bucket.
 *
 * Quantities sum each component's `bomQuantity` (a single component may itself
 * stand for multiple physical instances), so the line `qty` is the **total
 * physical count** of that body across the assembly.
 *
 * Honesty: the rollup is only as good as the geometry refs. Two rows pointing at
 * the *same* body via *different* ref kinds (one `designModelId`, one bare
 * `handle`) will NOT merge — that is correct (we cannot prove they are the same
 * body without resolving geometry), and is the documented limit of a pure,
 * geometry-blind BOM.
 *
 * Pure: no React, no DOM, no IPC, no `Date.now` / `crypto`. Deterministic — rows
 * are returned in a stable, sorted order.
 */

import type { AssemblyComponent, AssemblyFile } from './assembly-schema'

/** Which kind of reference a BOM row's source key was derived from. */
export type BomSourceKind = 'designModel' | 'relPath' | 'handle' | 'partPath'

/** The geometry source a BOM row aggregates on. */
export type BomSource = {
  /** Which ref kind produced {@link ref} (durability order: designModel > relPath > handle > partPath). */
  readonly kind: BomSourceKind
  /** The concrete reference value (a designModelId / relPath / handle / partPath). */
  readonly ref: string
  /**
   * Stable rollup key = `${kind}:${ref}`. Components with an identical `key`
   * aggregate into one row. Exposed so a consumer can correlate a row back to its
   * components without re-deriving the rule.
   */
  readonly key: string
}

/** One aggregated BOM line. */
export type BomRow = {
  /**
   * A representative component id for this line (the first contributing component
   * in sorted order). For a multi-instance line the other ids are in
   * {@link instanceIds}; this is the "click target" the renderer can select.
   */
  readonly partId: string
  /**
   * Display name for the line. The representative component's `name`; when
   * contributing components disagree on name, this is the first (sorted) one and
   * {@link nameVaries} is set so the UI can flag it.
   */
  readonly name: string
  /** The geometry source this line rolls up. */
  readonly source: BomSource
  /** Total physical quantity = Σ `bomQuantity` over contributing components. */
  readonly qty: number
  /** Every contributing component id (sorted). `length` is the instance/row count. */
  readonly instanceIds: string[]
  /** True when contributing components carried more than one distinct `name`. */
  readonly nameVaries: boolean
}

/** Result of {@link deriveBom}. */
export type BomResult = {
  /** Aggregated lines, deterministic order (by source key). */
  readonly rows: BomRow[]
  /** Distinct BOM lines (== `rows.length`). */
  readonly lineCount: number
  /** Total physical quantity across all lines (Σ row.qty). */
  readonly totalQuantity: number
  /** Active components that contributed (excludes suppressed). */
  readonly contributingComponentCount: number
}

/** Trim a candidate ref; return undefined when empty/whitespace. */
function cleanRef(value: string | undefined): string | undefined {
  if (value == null) return undefined
  const t = value.trim()
  return t.length > 0 ? t : undefined
}

/**
 * Derive the {@link BomSource} for one component, applying the durability
 * preference order (designModelId → relPath → handle → partPath). Exported so a
 * caller can compute a single component's rollup key in isolation (e.g. to
 * highlight which line a selected part belongs to).
 */
export function bomSourceFor(component: AssemblyComponent): BomSource {
  const g = component.geometrySource
  const designModelId = cleanRef(g?.designModelId)
  if (designModelId != null) {
    return { kind: 'designModel', ref: designModelId, key: `designModel:${designModelId}` }
  }
  const relPath = cleanRef(g?.relPath)
  if (relPath != null) {
    return { kind: 'relPath', ref: relPath, key: `relPath:${relPath}` }
  }
  const handle = cleanRef(g?.handle)
  if (handle != null) {
    return { kind: 'handle', ref: handle, key: `handle:${handle}` }
  }
  // Legacy fallback — schema guarantees a non-empty partPath.
  const partPath = component.partPath
  return { kind: 'partPath', ref: partPath, key: `partPath:${partPath}` }
}

/**
 * Roll an assembly up into a source-keyed BOM.
 *
 * Suppressed components are excluded. Active components are grouped by their
 * {@link bomSourceFor} key; each group becomes one {@link BomRow} whose `qty` is
 * the sum of the group's `bomQuantity`. Within a group the representative
 * `partId` / `name` are taken from the first component in id order, and
 * `instanceIds` lists all contributors (sorted). Rows are returned sorted by
 * source key for deterministic output.
 *
 * @param assembly a parsed assembly file
 */
export function deriveBom(assembly: AssemblyFile): BomResult {
  const active = assembly.components.filter((c) => !c.suppressed)

  // Group by source key. Track contributors so we can pick a stable representative.
  const groups = new Map<
    string,
    { source: BomSource; components: AssemblyComponent[]; qty: number }
  >()
  for (const c of active) {
    const source = bomSourceFor(c)
    const existing = groups.get(source.key)
    if (existing) {
      existing.components.push(c)
      existing.qty += c.bomQuantity
    } else {
      groups.set(source.key, { source, components: [c], qty: c.bomQuantity })
    }
  }

  const rows: BomRow[] = []
  for (const { source, components, qty } of groups.values()) {
    const sortedComponents = [...components].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    const rep = sortedComponents[0]!
    const distinctNames = new Set(sortedComponents.map((c) => c.name))
    rows.push({
      partId: rep.id,
      name: rep.name,
      source,
      qty,
      instanceIds: sortedComponents.map((c) => c.id),
      nameVaries: distinctNames.size > 1
    })
  }

  // Deterministic row order by source key.
  rows.sort((a, b) => (a.source.key < b.source.key ? -1 : a.source.key > b.source.key ? 1 : 0))

  let totalQuantity = 0
  for (const r of rows) totalQuantity += r.qty

  return {
    rows,
    lineCount: rows.length,
    totalQuantity,
    contributingComponentCount: active.length
  }
}
