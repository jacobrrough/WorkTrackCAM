/**
 * Pure helper functions for ManufactureWorkspace operation management.
 * Extracted from ManufactureWorkspace.tsx to reduce file size and improve testability.
 */

import type { ManufactureFile, ManufactureOperation } from '../../shared/manufacture-schema'
import type { MachineProfile } from '../../shared/machine-schema'
import type { DerivedContourCandidate } from '../../shared/cam-2d-derive'
import { isManufactureKindBlockedFromCam } from '../../shared/manufacture-cam-gate'

/** Resolve the CNC machine profile used by the manufacture plan. */
export function resolveManufactureCamMachine(
  mfg: ManufactureFile,
  machines: MachineProfile[]
): MachineProfile | undefined {
  const cnc = machines.filter((m) => m.kind === 'cnc')
  if (cnc.length === 0) return undefined
  for (const st of mfg.setups) {
    const hit = cnc.find((m) => m.id === st.machineId)
    if (hit) return hit
  }
  return cnc[0]
}

/** Returns true when the op kind is a CNC toolpath strategy (starts with `cnc_`). */
export function cncOp(kind: ManufactureOperation['kind']): boolean {
  return kind.startsWith('cnc_')
}

/** Human-readable stats for valid contourPoints arrays (setup WCS, mm). */
export function contourPointsStats(raw: unknown): string | null {
  if (!Array.isArray(raw) || raw.length < 3) return null
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let n = 0
  for (const pt of raw) {
    if (!Array.isArray(pt) || pt.length < 2) continue
    const x = Number(pt[0])
    const y = Number(pt[1])
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    n++
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  if (n < 3) return null
  return `${n} vertices \u00B7 XY bbox ${minX.toFixed(1)}\u2013${maxX.toFixed(1)} \u00D7 ${minY.toFixed(1)}\u2013${maxY.toFixed(1)} mm`
}

/** Format a derived-at ISO timestamp with relative age. */
export function formatDerivedAt(raw: string, nowTickMs: number): string {
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return raw
  const deltaSec = Math.max(0, Math.floor((nowTickMs - d.getTime()) / 1000))
  const age =
    deltaSec < 10
      ? 'just now'
      : deltaSec < 60
        ? `${deltaSec}s ago`
        : deltaSec < 3600
          ? `${Math.floor(deltaSec / 60)}m ago`
          : deltaSec < 86400
            ? `${Math.floor(deltaSec / 3600)}h ago`
            : `${Math.floor(deltaSec / 86400)}d ago`
  return `${d.toLocaleString()} (${age})`
}

/** Read a numeric or string tool diameter from op params for display. */
export function toolDiameterFieldValue(op: ManufactureOperation): string {
  const v = op.params?.['toolDiameterMm']
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (typeof v === 'string' && v.trim() !== '') return v
  return ''
}

/** Read any numeric cut parameter for display in an input field. */
export function cutParamFieldValue(op: ManufactureOperation, key: string): string {
  const v = op.params?.[key]
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (typeof v === 'string' && v.trim() !== '') return v
  return ''
}

/** Read contourPoints or drillPoints as JSON string for editing. */
export function geometryJsonFieldValue(op: ManufactureOperation, key: 'contourPoints' | 'drillPoints'): string {
  const v = op.params?.[key]
  if (!Array.isArray(v)) return ''
  try {
    return JSON.stringify(v)
  } catch {
    return ''
  }
}

/** Detect whether the contour source profile has drifted since last derive. */
export function contourDriftState(
  op: ManufactureOperation,
  contourCandidates: DerivedContourCandidate[]
): 'ok' | 'missing' | 'changed' | 'unknown' {
  if (!(op.kind === 'cnc_contour' || op.kind === 'cnc_pocket')) return 'unknown'
  const sourceId = typeof op.params?.['contourSourceId'] === 'string' ? op.params['contourSourceId'] : ''
  const sig = typeof op.params?.['contourSourceSignature'] === 'string' ? op.params['contourSourceSignature'] : ''
  if (!sourceId || !sig) return 'unknown'
  const cur = contourCandidates.find((c) => c.sourceId === sourceId)
  if (!cur) return 'missing'
  if (cur.signature !== sig) return 'changed'
  return 'ok'
}

export type OpReadinessLabel = 'ready' | 'missing geometry' | 'stale geometry' | 'suppressed' | 'non-cam'

/** CSS class variant for status chip background. */
export type OpReadinessVariant = 'ok' | 'error' | 'warn' | 'suppressed' | 'neutral'

/** Compute the CAM readiness status for an operation. */
export function opReadiness(
  op: ManufactureOperation,
  contourCandidates: DerivedContourCandidate[]
): { label: OpReadinessLabel; bg: string; variant: OpReadinessVariant } {
  if (op.suppressed) return { label: 'suppressed', bg: '#334155', variant: 'suppressed' }
  if (isManufactureKindBlockedFromCam(op.kind)) {
    return { label: 'non-cam', bg: '#475569', variant: 'neutral' }
  }
  if (op.kind === 'cnc_contour' || op.kind === 'cnc_pocket') {
    const contour = op.params?.['contourPoints']
    if (!Array.isArray(contour) || contour.length < 3) return { label: 'missing geometry', bg: '#7f1d1d', variant: 'error' }
    const drift = contourDriftState(op, contourCandidates)
    if (drift === 'changed' || drift === 'missing') return { label: 'stale geometry', bg: '#92400e', variant: 'warn' }
    return { label: 'ready', bg: '#14532d', variant: 'ok' }
  }
  if (op.kind === 'cnc_drill') {
    const drill = op.params?.['drillPoints']
    if (!Array.isArray(drill) || drill.length < 1) return { label: 'missing geometry', bg: '#7f1d1d', variant: 'error' }
    return { label: 'ready', bg: '#14532d', variant: 'ok' }
  }
  return { label: 'ready', bg: '#14532d', variant: 'ok' }
}

/** Panel-facing status mapping from opReadiness. */
export function opStatusForPanel(
  op: ManufactureOperation,
  contourCandidates: DerivedContourCandidate[]
): 'ready' | 'missing' | 'stale' | 'suppressed' | 'non-cam' {
  const r = opReadiness(op, contourCandidates).label
  if (r === 'missing geometry') return 'missing'
  if (r === 'stale geometry') return 'stale'
  if (r === 'suppressed') return 'suppressed'
  if (r === 'non-cam') return 'non-cam'
  return 'ready'
}

/** CSS class for filter toggle buttons. */
export function filterButtonClass(active: boolean): string {
  return active ? 'secondary filter-btn--active' : 'secondary'
}
