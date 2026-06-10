/**
 * LagunaNestingPanel — true-shape nesting UI for the Laguna Swift 5x10.
 *
 * Gap #9 from docs/COMPETITIVE-GAP-ANALYSIS.md, upgraded by Wave 3j
 * (docs/plans/catalog/vcarve-laguna.md — polygon-NFP P1 + multi-sheet P2).
 * Renders only when the active machine is the Laguna Swift 5x10
 * (My-Shop-Only gate). Lets the operator:
 *  1. Pick a rotation set (0/90 · cardinal · 45° steps · 15° steps) and,
 *     when needed, fall back to the v1 bounding-box BLF engine.
 *  2. Click "Nest parts on stock" to run the engine over every cnc_contour
 *     op that has contourPoints. The default engine is the true-shape
 *     No-Fit-Polygon nester (nfp-v2) with multi-sheet overflow.
 *  3. See overall + per-sheet utilization, which sheet each part landed on,
 *     and the unplaced list.
 *  4. Click "Apply layout" to write SHEET 1 placements back onto each op's
 *     scalar placement* params. Parts that overflowed to sheets 2+ are NOT
 *     applied (the scalar params describe one physical sheet) — the panel
 *     says so honestly instead of silently stacking two sheets' layouts onto
 *     one program, which would overlap parts and scrap the stock.
 *
 * Safety Rule 1 (G-code is sacred): nothing here writes machine motion. The
 * panel produces planning data only; the existing post-process contract tests
 * (e.g. post-process-laguna-swift-contract.test.ts) still gate downstream
 * G-code emission.
 */
import { useMemo, useState } from 'react'
import type { ManufactureOperation } from '../../shared/manufacture-schema'
import { fab } from '../src/shop-types'
import { EmptyState } from '../src/EmptyState'

interface Props {
  /** Active machine id (gates the panel). Only renders for laguna-swift-5x10. */
  activeMachineId: string | null
  /** Current operations. Only cnc_contour ops with contourPoints are nestable. */
  operations: ManufactureOperation[]
  /** Sheet width in mm from the active Laguna setup stock. */
  sheetWidthMm: number | null
  /** Sheet height in mm from the active Laguna setup stock. */
  sheetHeightMm: number | null
  /**
   * Apply the placement list back onto the operations. `sheetIndex` is the
   * additive multi-sheet field (absent = sheet 0). The workspace applies
   * sheet-0 placements only and strips stale placement params from parts
   * that overflowed to other sheets. `nestVersion` stamps
   * params.placementNestVersion ('v1' | 'nfp-v2') for layout diffing.
   */
  onApplyPlacements: (
    placements: ReadonlyArray<{
      partId: string
      xMm: number
      yMm: number
      rotationDeg: number
      sheetIndex?: number
    }>,
    nestVersion?: string
  ) => void
  /** Status toast hook. */
  onStatus?: (msg: string) => void
}

/** id used by ipc-fabrication for the Laguna router profile. */
const LAGUNA_MACHINE_ID = 'laguna-swift-5x10'

/** Default Laguna 5x10 sheet size when no Laguna setup stock is defined. */
const LAGUNA_DEFAULT_SHEET_W_MM = 1524
const LAGUNA_DEFAULT_SHEET_H_MM = 3048

/** Rotation-set choices surfaced in the UI. Step modes are NFP-only. */
type RotationMode = 'r-0-90' | 'r-cardinal' | 'step-45' | 'step-15'

const ROTATION_MODE_OPTIONS: ReadonlyArray<{
  value: RotationMode
  label: string
  nfpOnly: boolean
}> = [
  { value: 'r-0-90', label: '0° / 90°', nfpOnly: false },
  { value: 'r-cardinal', label: '0° / 90° / 180° / 270°', nfpOnly: false },
  { value: 'step-45', label: '45° steps (8 orientations)', nfpOnly: true },
  { value: 'step-15', label: '15° steps (24 orientations)', nfpOnly: true }
]

function isRotationMode(v: string): v is RotationMode {
  return v === 'r-0-90' || v === 'r-cardinal' || v === 'step-45' || v === 'step-15'
}

interface NestPreview {
  placements: Array<{
    partId: string
    xMm: number
    yMm: number
    rotationDeg: number
    sheetIndex?: number
  }>
  unplaced: string[]
  utilizationPct: number
  sheetsUsed: number
  nestVersion: 'v1' | 'nfp-v2'
  engineUsed: 'nfp' | 'blf'
}

/** Absolute shoelace polygon area in mm^2 (per-sheet utilization readout). */
function polygonAreaAbsMm2(points: ReadonlyArray<readonly [number, number]>): number {
  const n = points.length
  if (n < 3) return 0
  let s = 0
  for (let i = 0; i < n; i++) {
    const a = points[i]!
    const b = points[(i + 1) % n]!
    s += a[0] * b[1] - b[0] * a[1]
  }
  return Math.abs(s) / 2
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
  const [rotationMode, setRotationMode] = useState<RotationMode>('r-cardinal')
  const [useBlfFallback, setUseBlfFallback] = useState(false)

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

  // The BLF fallback supports only cardinal rotations — step modes coerce
  // to the cardinal set while the fallback is on. The select shows the
  // coerced value and disables the step options, so what runs is what shows.
  const effectiveRotationMode: RotationMode =
    useBlfFallback && (rotationMode === 'step-45' || rotationMode === 'step-15')
      ? 'r-cardinal'
      : rotationMode

  async function runNest(): Promise<void> {
    if (nestableParts.length === 0) {
      onStatus?.('No cnc_contour operations with contourPoints to nest. Derive contour geometry first.')
      return
    }
    setBusy(true)
    try {
      const opts: {
        partMarginMm: number
        engine: 'nfp' | 'blf'
        allowedRotations?: ReadonlyArray<number>
        rotationStepDeg?: number
        snapMm?: number
        maxSheets?: number
      } = { partMarginMm: 3, engine: useBlfFallback ? 'blf' : 'nfp' }
      if (effectiveRotationMode === 'r-0-90') opts.allowedRotations = [0, 90]
      else if (effectiveRotationMode === 'r-cardinal') opts.allowedRotations = [0, 90, 180, 270]
      else if (effectiveRotationMode === 'step-45') opts.rotationStepDeg = 45
      else opts.rotationStepDeg = 15
      if (useBlfFallback) opts.snapMm = 5
      else opts.maxSheets = 8

      const response = await fab().nestingNestPolygons({
        parts: nestableParts.map((p) => ({ id: p.id, points: p.points })),
        sheet: { widthMm: effectiveSheetW, heightMm: effectiveSheetH, marginMm: 10 },
        opts
      })
      if (!response.ok) {
        onStatus?.(`Nesting failed: ${response.error}${response.hint ? ` — ${response.hint}` : ''}`)
        setPreview(null)
        return
      }
      const r = response.result
      const next: NestPreview = {
        placements: r.placements,
        unplaced: r.unplaced,
        utilizationPct: r.utilizationPct,
        sheetsUsed: r.sheetsUsed ?? (r.placements.length > 0 ? 1 : 0),
        nestVersion: r.nestVersion ?? 'v1',
        engineUsed: r.engineUsed ?? (r.nestVersion === 'nfp-v2' ? 'nfp' : 'blf')
      }
      setPreview(next)
      onStatus?.(
        `Nested ${next.placements.length}/${nestableParts.length} parts on ${Math.max(next.sheetsUsed, 1)} sheet(s) at ${next.utilizationPct}% utilization` +
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

  // Per-sheet utilization: placed part area on each sheet / single-sheet area.
  const perSheetStats = useMemo(() => {
    if (!preview) return []
    const areaById = new Map(nestableParts.map((p) => [p.id, polygonAreaAbsMm2(p.points)]))
    const used = new Map<number, number>()
    for (const pl of preview.placements) {
      const s = pl.sheetIndex ?? 0
      used.set(s, (used.get(s) ?? 0) + (areaById.get(pl.partId) ?? 0))
    }
    const sheetArea = effectiveSheetW * effectiveSheetH
    return [...used.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([sheetIndex, areaMm2]) => ({
        sheetIndex,
        utilizationPct: sheetArea > 0 ? Math.round((areaMm2 / sheetArea) * 1000) / 10 : 0
      }))
  }, [preview, nestableParts, effectiveSheetW, effectiveSheetH])

  const overflowCount = preview
    ? preview.placements.filter((p) => (p.sheetIndex ?? 0) > 0).length
    : 0

  function applyLayout(): void {
    if (!preview || preview.placements.length === 0) return
    const sheetOneCount = preview.placements.length - overflowCount
    onApplyPlacements(preview.placements, preview.nestVersion)
    onStatus?.(
      overflowCount > 0
        ? `Applied sheet 1 placements to ${sheetOneCount} contour operation(s). ${overflowCount} part(s) overflowed to sheets 2+ and were NOT applied — cut sheet 1, then re-nest the remaining parts as a separate job.`
        : `Applied nesting layout to ${sheetOneCount} contour operation(s).`
    )
  }

  return (
    <section className="laguna-nesting-panel" aria-labelledby="laguna-nesting-heading">
      <h3 id="laguna-nesting-heading" className="subh">
        Sheet nesting (Laguna 5×10) — true-shape NFP v2
      </h3>
      <p className="msg msg--muted">
        Lay out every <code>cnc_contour</code> operation on a {effectiveSheetW.toFixed(0)} × {effectiveSheetH.toFixed(0)} mm
        sheet. The default engine nests true polygon shapes (No-Fit-Polygon) with 3 mm geometric clearance and
        overflows extra parts onto additional sheets instead of dropping them. The v1 bounding-box BLF engine
        stays available as a fallback. No G-code is emitted; this writes placements that the post-processor consumes.
      </p>
      <div className="row row--align-center-8">
        <label className="msg" htmlFor="laguna-nesting-rotation-mode">
          Rotations
        </label>
        <select
          id="laguna-nesting-rotation-mode"
          value={effectiveRotationMode}
          disabled={busy}
          onChange={(e) => {
            if (isRotationMode(e.target.value)) setRotationMode(e.target.value)
          }}
          aria-label="Allowed part rotations"
        >
          {ROTATION_MODE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value} disabled={useBlfFallback && opt.nfpOnly}>
              {opt.label}
            </option>
          ))}
        </select>
        <label
          className="msg"
          title="Use the v1 axis-aligned bounding-box bottom-left-fill engine instead of the true-shape NFP nester. Single sheet only; cardinal rotations only."
        >
          <input
            type="checkbox"
            checked={useBlfFallback}
            disabled={busy}
            onChange={(e) => setUseBlfFallback(e.target.checked)}
          />{' '}
          BLF fallback (v1 bounding-box)
        </label>
      </div>
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
          {overflowCount > 0 ? 'Apply layout (sheet 1 only)' : 'Apply layout'}
        </button>
      </div>
      {preview ? (
        <div className="laguna-nesting-result">
          <p className="msg">
            <strong>Utilization:</strong> {preview.utilizationPct}% &middot;{' '}
            <strong>Placed:</strong> {preview.placements.length} &middot;{' '}
            <strong>Unplaced:</strong> {preview.unplaced.length} &middot;{' '}
            <strong>Sheets:</strong> {Math.max(preview.sheetsUsed, 1)} &middot;{' '}
            <strong>Engine:</strong> {preview.engineUsed === 'nfp' ? 'NFP v2 (true-shape)' : 'BLF v1 (bounding-box)'}
          </p>
          {perSheetStats.length > 1 ? (
            <p className="msg">
              {perSheetStats.map((s, i) => (
                <span key={s.sheetIndex}>
                  {i > 0 ? ' · ' : ''}
                  Sheet {s.sheetIndex + 1}: {s.utilizationPct}%
                </span>
              ))}
            </p>
          ) : null}
          {overflowCount > 0 ? (
            <p className="msg msg--warn">
              {overflowCount} part{overflowCount === 1 ? '' : 's'} overflowed to sheets 2+. Apply layout writes
              sheet 1 placements only — the placement params describe one physical sheet, so stacking
              several sheets into one program would overlap parts and scrap the stock. Cut sheet 1 first, then
              re-nest the remaining parts as a separate job.
            </p>
          ) : null}
          {preview.placements.length > 0 ? (
            <ul className="laguna-nesting-list">
              {preview.placements.map((p) => {
                const part = nestableParts.find((np) => np.id === p.partId)
                return (
                  <li key={p.partId}>
                    <code>{part?.label ?? p.partId}</code> &rarr; ({p.xMm.toFixed(1)}, {p.yMm.toFixed(1)}) mm,
                    rotation {p.rotationDeg}°
                    {preview.sheetsUsed > 1 ? <> &middot; sheet {(p.sheetIndex ?? 0) + 1}</> : null}
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
              These parts are larger than the sheet or did not fit within the sheet limit after rotation.
            </p>
          ) : null}
        </div>
      ) : (
        /*
         * UX Overhaul #8 — shared `EmptyState` slot. Surfaces when the
         * operator opens the Laguna nesting panel before kicking off a
         * nesting pass. The CTA delegates straight to the same `runNest`
         * routine that the "Nest parts on stock" button above uses, so
         * Empty-state semantics never invent a new code path. Disabled
         * when there are no nestable parts (matches the primary button).
         */
        <EmptyState
          testId="laguna-nesting-empty-state"
          title="No nesting result yet"
          body="Run a nesting pass to see results here."
          cta={{
            label: 'Run nesting',
            onClick: () => void runNest(),
            variant: 'primary'
          }}
        />
      )}
    </section>
  )
}
