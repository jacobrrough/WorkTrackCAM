/**
 * Laguna Swift 5×10 — 6-zone vacuum ALLOCATOR panel ([ID-0020]).
 *
 * The sibling `src/shared/laguna-vacuum-allocator.ts` ships the deterministic
 * stock-footprint → engaged-zone math but had no UI; this panel is that UI. The
 * operator picks the sheet planform for the current job and the panel calls
 * `allocateLagunaVacuumZonesForSheet` to show which of the bed's six vacuum zones
 * the stock actually covers (a 2×3 grid map + per-zone coverage + a "your sheet is
 * hanging off the table" warning when the placement overruns the envelope). One
 * click writes the allocator's engaged set onto `appSettings.lagunaActiveZones` so
 * the existing 6-zone toggle picker + the `M8 P<n>`/`M9 P<n>` post emission honor
 * the computed allocation instead of the operator eyeballing it.
 *
 * Zone numbering bridge: the allocator orders its zones column-major
 * (`LAGUNA_VACUUM_ZONES` = [X0Y0, X0Y1, X0Y2, X1Y0, X1Y1, X1Y2]); the renderer +
 * post number zones 1..6. `registry index + 1` is the stable bridge between the
 * two — `allocatorZoneNumber()` below is the single source of that mapping.
 *
 * Safety: this panel emits NO G-code and loads NO machine profile. The allocator
 * returns metadata only; the panel's sole side-effect is persisting the engaged
 * zone numbers through the host's existing `onSaveSettingsField` callback. My-Shop
 * scope: Laguna Swift 5×10 ONLY — the host gates this panel behind `/laguna/i`
 * exactly like the existing `util-laguna-*` surfaces.
 */

import { useMemo, useState, type ReactNode } from 'react'
import {
  LAGUNA_VACUUM_ZONES,
  LAGUNA_VACUUM_ZONE_COLUMNS,
  LAGUNA_VACUUM_ZONE_ROWS,
  allocateLagunaVacuumZonesForSheet
} from '../../shared/laguna-vacuum-allocator'
import {
  LAGUNA_SHEET_PLANFORMS,
  LAGUNA_SHEET_THICKNESSES
} from '../../shared/laguna-full-sheet-stock'

/**
 * Map an allocator zone id (e.g. 'X1Y2') to the 1..6 zone number the renderer
 * picker + the `M8/M9 P<n>` post emission use. The allocator's registry order is
 * column-major and stable, so `index + 1` is the canonical bridge. Returns 0 for
 * an unknown id (defensive against allocator/registry drift — never throws).
 */
export function allocatorZoneNumber(zoneId: string): number {
  const idx = LAGUNA_VACUUM_ZONES.findIndex((z) => z.id === zoneId)
  return idx < 0 ? 0 : idx + 1
}

/** Engaged zone ids → sorted, de-duplicated 1..6 numbers (drops any unknown id). */
export function engagedZoneNumbers(engagedIds: readonly string[]): number[] {
  const nums = new Set<number>()
  for (const id of engagedIds) {
    const n = allocatorZoneNumber(id)
    if (n > 0) nums.add(n)
  }
  return [...nums].sort((a, b) => a - b)
}

export interface LagunaVacuumPanelProps {
  /**
   * Persist the computed engaged-zone numbers (1..6). Same callback the host
   * threads to the existing 6-zone toggle picker, so assigning here updates the
   * single `appSettings.lagunaActiveZones` source of truth.
   */
  readonly onAssignZones: (zoneNumbers: number[]) => void
  /** Initial planform id (optional — for tests / presets). Defaults to the full sheet. */
  readonly initialPlanformId?: string
  /** Initial thickness id (optional). Defaults to 3/4 in (the allocator default). */
  readonly initialThicknessId?: string
}

/**
 * Sheet-placement → vacuum-zone allocator UI. Self-contained pickers (planform +
 * thickness) so it drops into the Laguna util area without threading setup/stock
 * state; the allocator is pure so the readout recomputes synchronously on change.
 */
export function LagunaVacuumPanel({
  onAssignZones,
  initialPlanformId = LAGUNA_SHEET_PLANFORMS[0]?.id ?? 'full-sheet-48x96',
  initialThicknessId = '3-4'
}: LagunaVacuumPanelProps): ReactNode {
  const [planformId, setPlanformId] = useState(initialPlanformId)
  const [thicknessId, setThicknessId] = useState(initialThicknessId)

  const resolution = useMemo(
    () => allocateLagunaVacuumZonesForSheet(planformId, { thicknessId }),
    [planformId, thicknessId]
  )

  // Per-zone overlap keyed by zone id for O(1) grid lookup.
  const overlapById = useMemo(() => {
    const map = new Map<string, { engaged: boolean; coverage: number }>()
    if (resolution) {
      for (const z of resolution.allocation.zones) {
        map.set(z.id, { engaged: z.engaged, coverage: z.zoneCoverageFraction })
      }
    }
    return map
  }, [resolution])

  const engagedNumbers = resolution
    ? engagedZoneNumbers(resolution.allocation.engaged)
    : []

  return (
    <section
      className="panel workspace-util-panel"
      aria-labelledby="mfg-laguna-vacuum-alloc-heading"
      data-testid="laguna-vacuum-allocator"
    >
      <h3
        id="mfg-laguna-vacuum-alloc-heading"
        className="subh util-section-heading"
      >
        Vacuum Zone Allocator
      </h3>
      <p className="msg msg--muted util-panel-intro">
        Pick the sheet for this job; the allocator maps the stock footprint onto the
        bed&rsquo;s six vacuum zones (2&times;3 grid; back-left is Zone 1). Engaged
        zones have stock above them and should pull vacuum.{' '}
        <strong>Assign</strong> writes them onto the zone toggles above so the
        emitted <code>M8/M9 P&lt;n&gt;</code> matches the placement.
      </p>

      <div className="row util-laguna-alloc-controls">
        <label className="util-panel-control">
          Sheet
          <select
            value={planformId}
            onChange={(e) => setPlanformId(e.target.value)}
            data-testid="laguna-alloc-planform"
          >
            {LAGUNA_SHEET_PLANFORMS.map((pf) => (
              <option key={pf.id} value={pf.id}>
                {pf.label}
              </option>
            ))}
          </select>
        </label>
        <label className="util-panel-control">
          Thickness
          <select
            value={thicknessId}
            onChange={(e) => setThicknessId(e.target.value)}
            data-testid="laguna-alloc-thickness"
          >
            {LAGUNA_SHEET_THICKNESSES.map((th) => (
              <option key={th.id} value={th.id}>
                {th.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {resolution ? (
        <>
          {/*
           * Zone map — a 2×3 grid mirroring the physical bed. Rendered row-major
           * top-to-bottom so Y2 (right/far) sits on top and Y0 (left/near) on the
           * bottom, matching the ASCII bed diagram in the allocator module. Each
           * cell shows its 1..6 number, X/Y id, and stock-coverage %.
           */}
          <div
            className="util-laguna-zone-grid"
            data-testid="laguna-alloc-grid"
            role="group"
            aria-label="Vacuum zone coverage map"
            style={{
              gridTemplateColumns: `repeat(${LAGUNA_VACUUM_ZONE_COLUMNS}, 1fr)`
            }}
          >
            {Array.from({ length: LAGUNA_VACUUM_ZONE_ROWS }, (_, rowFromTop) => {
              // Top row of the grid is the FAR end of the bed (highest Y row).
              const row = LAGUNA_VACUUM_ZONE_ROWS - 1 - rowFromTop
              return LAGUNA_VACUUM_ZONES.filter((z) => z.row === row)
                .sort((a, b) => a.column - b.column)
                .map((zone) => {
                  const ov = overlapById.get(zone.id)
                  const engaged = ov?.engaged ?? false
                  const pct = Math.round((ov?.coverage ?? 0) * 100)
                  const num = allocatorZoneNumber(zone.id)
                  return (
                    <div
                      key={zone.id}
                      className={`util-laguna-zone-cell${engaged ? ' util-laguna-zone-cell--engaged' : ''}`}
                      data-testid={`laguna-alloc-zone-${num}`}
                      data-engaged={engaged ? 'true' : 'false'}
                      data-zone-id={zone.id}
                    >
                      <span className="util-laguna-zone-cell-num">Zone {num}</span>
                      <span className="util-laguna-zone-cell-id">{zone.id}</span>
                      <span className="util-laguna-zone-cell-cov">
                        {engaged ? `${pct}% covered` : 'idle'}
                      </span>
                    </div>
                  )
                })
            })}
          </div>

          <dl className="util-fs-readout" data-testid="laguna-alloc-readout">
            <div className="util-fs-row">
              <dt>Engaged</dt>
              <dd data-testid="laguna-alloc-engaged">
                {resolution.allocation.engagedCount} of {LAGUNA_VACUUM_ZONES.length}
                {engagedNumbers.length > 0 ? ` (${engagedNumbers.join(', ')})` : ''}
              </dd>
            </div>
            <div className="util-fs-row">
              <dt>Bed coverage</dt>
              <dd data-testid="laguna-alloc-coverage">
                {Math.round(resolution.allocation.bedCoverageFraction * 100)}%
              </dd>
            </div>
            <div className="util-fs-row">
              <dt>Stock</dt>
              <dd>
                {Math.round(resolution.stock.x)} &times; {Math.round(resolution.stock.y)} mm
              </dd>
            </div>
          </dl>

          {resolution.allocation.outsideEnvelope ? (
            <p className="msg msg--warn" role="status" data-testid="laguna-alloc-oversize">
              Sheet overruns the 1524 &times; 3048 mm bed &mdash; zones are computed
              from the on-bed portion only. Trim the stock or reposition before
              running.
            </p>
          ) : null}

          <div className="row util-laguna-alloc-actions">
            <button
              type="button"
              className="btn primary"
              data-testid="laguna-alloc-assign"
              disabled={engagedNumbers.length === 0}
              onClick={() => onAssignZones(engagedNumbers)}
            >
              Assign engaged zones
            </button>
            <p className="msg msg--muted util-laguna-alloc-hint" role="status">
              {engagedNumbers.length === 0
                ? 'No zones engaged — pick a sheet that sits on the bed.'
                : `Sets the zone toggles to ${engagedNumbers.join(', ')}.`}
            </p>
          </div>
        </>
      ) : (
        <p className="msg msg--muted" role="status" data-testid="laguna-alloc-unavailable">
          No stock could be built for this sheet/thickness — pick another.
        </p>
      )}
    </section>
  )
}

export default LagunaVacuumPanel
