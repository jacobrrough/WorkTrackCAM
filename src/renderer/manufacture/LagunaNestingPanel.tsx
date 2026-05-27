/**
 * LagunaNestingPanel — v1 true-shape nesting UI for Laguna Swift 5x10.
 *
 * Gap #9 from docs/COMPETITIVE-GAP-ANALYSIS.md. Renders only when the active
 * machine is the Laguna Swift 5x10 (My-Shop-Only gate). Lets the operator:
 *  1. Click "Nest parts on stock" to run the BLF algorithm over every
 *     cnc_contour op that has contourPoints.
 *  2. See utilization % and placed/unplaced counts as a flat preview list.
 *  3. Click "Apply layout" to write the placement back onto each op's
 *     `params.placement` field, which downstream CAM + post-processors
 *     consume when emitting the toolpath G-code.
 *
 * Safety Rule 1 (G-code is sacred): nothing here writes machine motion. The
 * panel produces planning data only; the existing post-process contract tests
 * (e.g. post-process-laguna-swift-contract.test.ts) still gate downstream
 * G-code emission.
 */
import { useMemo, useState } from 'react'
import type { ManufactureOperation } from '../../shared/manufacture-schema'
import { fab } from '../src/shop-types'

interface Props {
  /** Active machine id (gates the panel). Only renders for laguna-swift-5x10. */
  activeMachineId: string | null
  /** Current operations. Only cnc_contour ops with contourPoints are nestable. */
  operations: ManufactureOperation[]
  /** Sheet width in mm from the active Laguna setup stock. */
  sheetWidthMm: number | null
  /** Sheet height in mm from the active Laguna setup stock. */
  sheetHeightMm: number | null
  /** Apply the placement list back onto the operations. */
  onApplyPlacements: (placements: ReadonlyArray<{
    partId: string
    xMm: number
    yMm: number
    rotationDeg: 0 | 90 | 180 | 270
  }>) => void
  /** Status toast hook. */
  onStatus?: (msg: string) => void
}

/** id used by ipc-fabrication for the Laguna router profile. */
const LAGUNA_MACHINE_ID = 'laguna-swift-5x10'

/** Default Laguna 5x10 sheet size when no Laguna setup stock is defined. */
const LAGUNA_DEFAULT_SHEET_W_MM = 1524
const LAGUNA_DEFAULT_SHEET_H_MM = 3048

interface NestPreview {
  placements: Array<{
    partId: string
    xMm: number
    yMm: number
    rotationDeg: 0 | 90 | 180 | 270
  }>
  unplaced: string[]
  utilizationPct: number
}

export function LagunaNestingPanel({
  activeMachineId,
  operations,
  sheetWidthMm,
  sheetHeightMm,
  onApplyPlacements,
  onStatus
}: Props): React.ReactElement | null {
  // My-Shop-Only gate: only show for the Laguna Swift 5x10.
  if (activeMachineId !== LAGUNA_MACHINE_ID) return null

  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<NestPreview | null>(null)

  // Extract nestable polygons from the operations. Each cnc_contour op with
  // a closed contourPoints loop contributes one polygon. The op id becomes
  // the polygon id so we can map placements back unambiguously.
  const nestableParts = useMemo(() => {
    const parts: Array<{ id: string; points: ReadonlyArray<readonly [number, number]>; label: string }> = []
    for (const op of operations) {
      if (op.kind !== 'cnc_contour') continue
      if (op.suppressed) continue
      const raw = op.params?.['contourPoints']
      if (!Array.isArray(raw)) continue
      const pts: Array<readonly [number, number]> = []
      for (const v of raw) {
        if (Array.isArray(v) && v.length >= 2 && typeof v[0] === 'number' && typeof v[1] === 'number') {
          pts.push([v[0], v[1]])
        }
      }
      if (pts.length >= 3) {
        parts.push({ id: op.id, points: pts, label: op.label })
      }
    }
    return parts
  }, [operations])

  const effectiveSheetW = sheetWidthMm && sheetWidthMm > 0 ? sheetWidthMm : LAGUNA_DEFAULT_SHEET_W_MM
  const effectiveSheetH = sheetHeightMm && sheetHeightMm > 0 ? sheetHeightMm : LAGUNA_DEFAULT_SHEET_H_MM

  async function runNest(): Promise<void> {
    if (nestableParts.length === 0) {
      onStatus?.('No cnc_contour operations with contourPoints to nest. Derive contour geometry first.')
      return
    }
    setBusy(true)
    try {
      const response = await fab().nestingNestPolygons({
        parts: nestableParts.map((p) => ({ id: p.id, points: p.points })),
        sheet: { widthMm: effectiveSheetW, heightMm: effectiveSheetH, marginMm: 10 },
        opts: { snapMm: 5, partMarginMm: 3, allowedRotations: [0, 90] }
      })
      if (!response.ok) {
        onStatus?.(`Nesting failed: ${response.error}${response.hint ? ` — ${response.hint}` : ''}`)
        setPreview(null)
        return
      }
      const next: NestPreview = {
        placements: response.result.placements,
        unplaced: response.result.unplaced,
        utilizationPct: response.result.utilizationPct
      }
      setPreview(next)
      onStatus?.(
        `Nested ${next.placements.length}/${nestableParts.length} parts at ${next.utilizationPct}% utilization` +
          (next.unplaced.length > 0 ? ` (${next.unplaced.length} unplaced).` : '.')
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      onStatus?.(`Nesting error: ${msg}`)
      setPreview(null)
    } finally {
      setBusy(false)
    }
  }

  function applyLayout(): void {
    if (!preview || preview.placements.length === 0) return
    onApplyPlacements(preview.placements)
    onStatus?.(`Applied nesting layout to ${preview.placements.length} contour operation(s).`)
  }

  return (
    <section className="laguna-nesting-panel" aria-labelledby="laguna-nesting-heading">
      <h3 id="laguna-nesting-heading" className="subh">Sheet nesting (Laguna 5×10) — v1 BLF</h3>
      <p className="msg msg--muted">
        Lay out every <code>cnc_contour</code> operation on a {effectiveSheetW.toFixed(0)} × {effectiveSheetH.toFixed(0)} mm
        sheet using bottom-left-fill. v1 uses axis-aligned bounding boxes — good for cabinet / sign panels,
        leaves room for v2 NFP+GA. No G-code is emitted; this writes placements that the post-processor consumes.
      </p>
      <div className="row row--align-center-8">
        <span className="msg">
          {nestableParts.length} nestable contour op{nestableParts.length === 1 ? '' : 's'}
        </span>
        <button
          type="button"
          className="primary"
          disabled={busy || nestableParts.length === 0}
          onClick={() => void runNest()}
          aria-label="Nest parts on stock"
        >
          {busy ? 'Nesting…' : 'Nest parts on stock'}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy || !preview || preview.placements.length === 0}
          onClick={applyLayout}
          aria-label="Apply nesting layout to operations"
        >
          Apply layout
        </button>
      </div>
      {preview ? (
        <div className="laguna-nesting-result">
          <p className="msg">
            <strong>Utilization:</strong> {preview.utilizationPct}% &middot;{' '}
            <strong>Placed:</strong> {preview.placements.length} &middot;{' '}
            <strong>Unplaced:</strong> {preview.unplaced.length}
          </p>
          {preview.placements.length > 0 ? (
            <ul className="laguna-nesting-list">
              {preview.placements.map((p) => {
                const part = nestableParts.find((np) => np.id === p.partId)
                return (
                  <li key={p.partId}>
                    <code>{part?.label ?? p.partId}</code> &rarr; ({p.xMm.toFixed(1)}, {p.yMm.toFixed(1)}) mm,
                    rotation {p.rotationDeg}°
                  </li>
                )
              })}
            </ul>
          ) : null}
          {preview.unplaced.length > 0 ? (
            <p className="msg msg--warn">
              Could not place: {preview.unplaced
                .map((id) => nestableParts.find((np) => np.id === id)?.label ?? id)
                .join(', ')}.
              These parts are larger than the sheet or did not fit after rotation.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
