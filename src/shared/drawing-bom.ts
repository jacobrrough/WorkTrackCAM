/**
 * Drawings **bill-of-materials** derivation (pure).
 *
 * Turns whatever the Drawings workspace knows about its source geometry into the
 * persisted {@link DrawingBomRow} rows a drawing sheet stores (and the renderer
 * stamps onto the SVG via `cad.drawing_bom_table`). One entry point,
 * {@link deriveDrawingBom}, handles every case the workspace can be in:
 *
 *   1. **An assembly is loaded** → reuse the assembly BOM rollup
 *      ({@link deriveBom} from `assembly-bom.ts`): N instances of one body
 *      collapse into ONE line with quantity N, exactly like the Assemble
 *      workspace's BOM table. Each rolled-up line becomes one `DrawingBomRow`.
 *   2. **Only CAD design models** (single-part documentation, no assembly) →
 *      one row per {@link DesignModel} (qty 1 each). This is the common
 *      Laguna/Carvera case: you drew ONE part and you're dimensioning it.
 *   3. **A bare part name** → a single stub row (qty 1). The honest minimum when
 *      all the workspace has is "this is one part".
 *   4. **Nothing** → an empty list. No invented rows.
 *
 * The output is the SAME `DrawingBomRow` shape the sheet schema persists
 * (`{ item, qty, partNumber, description }`), so a derived BOM round-trips
 * through `drawing.json` unchanged. A thin adapter, {@link toBomTableRows},
 * converts those rows into the renderer's `cad.drawing_bom_table` row shape
 * (string `item` + `partName`/`quantity`) so the renderer agent can stamp them
 * without re-deriving anything.
 *
 * ## Honesty
 * The assembly rollup is only as good as the assembly's geometry refs — two
 * rows that point at the same body via *different* ref kinds will NOT merge (the
 * documented limit of the geometry-blind `deriveBom`). `deriveDrawingBom` adds
 * no geometry resolution of its own; it inherits that contract verbatim.
 *
 * Pure: no React, no DOM, no IPC, no `Date.now` / `crypto`. Deterministic — rows
 * come out in a stable order (assembly path: `deriveBom`'s source-key order;
 * design-model path: input order). Safety Rule 1 — a BOM is documentation;
 * nothing here is ever read by the CAM toolpath or post-processor pipeline.
 */

import type { AssemblyComponent, AssemblyFile } from './assembly-schema'
import { deriveBom } from './assembly-bom'
import type { DesignModel } from './project-schema'
import { drawingBomRowSchema, type DrawingBomRow } from './drawing-annotation-schema'

/**
 * What {@link deriveDrawingBom} derives a BOM from. A discriminated union so the
 * caller passes whatever it has on hand:
 *
 *   - `{ kind: 'assembly', assembly }`      — roll up an assembly's components.
 *   - `{ kind: 'designModels', designModels }` — one row per CAD design model.
 *   - `{ kind: 'singlePart', name, partNumber? }` — a single stub row.
 *   - `{ kind: 'empty' }`                   — no rows.
 */
export type DrawingBomInput =
  | { kind: 'assembly'; assembly: AssemblyFile }
  | { kind: 'designModels'; designModels: readonly DesignModel[] }
  | { kind: 'singlePart'; name: string; partNumber?: string }
  | { kind: 'empty' }

/** Trim a candidate string; return undefined when empty/whitespace. */
function clean(value: string | undefined): string | undefined {
  if (value == null) return undefined
  const t = value.trim()
  return t.length > 0 ? t : undefined
}

/**
 * Best part-number for an assembly BOM line: the representative component's
 * explicit `partNumber` when set, else its `referenceTag`, else the rolled-up
 * source ref (a stable body identifier). Never empty — the schema's
 * `partNumber` is a plain string and an empty cell reads worse than the ref.
 */
function partNumberForLine(rep: AssemblyComponent | undefined, sourceRef: string): string {
  return clean(rep?.partNumber) ?? clean(rep?.referenceTag) ?? sourceRef
}

/**
 * Derive the persisted {@link DrawingBomRow} rows for a drawing sheet from its
 * source geometry. See the module doc for the four input cases. `item` is a
 * 1-based find-number in row order; `qty` is the physical count (assembly path:
 * the rolled-up quantity; otherwise 1). The result is re-validated through
 * `drawingBomRowSchema` so it is always sheet-persistable.
 */
export function deriveDrawingBom(input: DrawingBomInput): DrawingBomRow[] {
  const rows: DrawingBomRow[] = ((): DrawingBomRow[] => {
    switch (input.kind) {
      case 'assembly': {
        const result = deriveBom(input.assembly)
        const byId = new Map(input.assembly.components.map((c) => [c.id, c]))
        return result.rows.map((line, i) => {
          const rep = byId.get(line.partId)
          return {
            item: i + 1,
            qty: line.qty,
            partNumber: partNumberForLine(rep, line.source.ref),
            description: clean(line.name) ?? line.source.ref
          }
        })
      }
      case 'designModels': {
        return input.designModels.map((m, i) => ({
          item: i + 1,
          qty: 1,
          partNumber: clean(m.name) ?? m.id,
          description: clean(m.name) ?? m.id
        }))
      }
      case 'singlePart': {
        const name = clean(input.name) ?? 'Part'
        return [
          {
            item: 1,
            qty: 1,
            partNumber: clean(input.partNumber) ?? name,
            description: name
          }
        ]
      }
      case 'empty':
        return []
    }
  })()
  // Canonical + persistable (also coerces ints / guards shape).
  return rows.map((r) => drawingBomRowSchema.parse(r))
}

// ── Renderer stamp adapter (cad.drawing_bom_table row shape) ──────────────────

/**
 * One row in the renderer's `cad.drawing_bom_table` contract (mirrors
 * `DrawingBomTableRow` in `DrawingView.tsx`). `item` is a STRING here (the
 * find-number / balloon text) and the persisted numeric `qty` becomes
 * `quantity`. Declared here so the engine owns the BOM→stamp mapping and the
 * renderer doesn't re-derive it.
 */
export type DrawingBomTableRow = {
  readonly item: string
  readonly partName: string
  readonly quantity: number
  readonly partNumber?: string
}

/**
 * Adapt persisted {@link DrawingBomRow} rows into the renderer's stamp shape.
 * The numeric `item` becomes its string form, `description` becomes `partName`,
 * `qty` becomes `quantity`, and `partNumber` is carried through (dropped when it
 * is identical to the description, so the stamp doesn't print the same text
 * twice). Pure + total.
 */
export function toBomTableRows(rows: readonly DrawingBomRow[]): DrawingBomTableRow[] {
  return rows.map((r) => ({
    item: String(r.item),
    partName: r.description,
    quantity: r.qty,
    ...(r.partNumber && r.partNumber !== r.description ? { partNumber: r.partNumber } : {})
  }))
}
