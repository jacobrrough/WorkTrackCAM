/**
 * ManufactureOperationList — Setup-rooted operation tree with status icons.
 *
 * UX MOVE 6 (Fusion / Mastercam pattern): operations nest under their parent
 * Setup. Each Setup is a collapsible group with the setup label, an op-count
 * badge and a chevron. Operations without a `setupId` fall under a synthetic
 * "(Unassigned)" group at the top so they remain discoverable.
 *
 * Per-row status icon (.op-tree-op-status) is derived from existing readiness
 * data (opReadiness + isOperationSourceMeshStale):
 *   - error   (red)    : missing geometry
 *   - stale   (yellow) : stale geometry / mesh newer than posted G-code
 *   - done    (green)  : ready
 *   - idle    (gray)   : suppressed / non-cam
 *   - running (blue)   : reserved — currently no per-op live-running signal,
 *                       but the className is in place for future CAM runs.
 *
 * Setup collapse is owned by the native <details> element so users can fold
 * finished setups while iterating on a new one. We avoid React state here
 * because the existing empty-state tests invoke this component as a plain
 * function — a hookless component keeps that pattern working. Persistence
 * across reloads is intentionally not wired (no IPC churn for ephemeral UI).
 */
import type { ManufactureOperation, ManufactureSetup } from '../../shared/manufacture-schema'
import type { MachineProfile } from '../../shared/machine-schema'
import type { DerivedContourCandidate } from '../../shared/cam-2d-derive'
import type { ToolLibraryFile } from '../../shared/tool-schema'
import { CAM_CUT_DEFAULTS } from '../../shared/cam-cut-params'
import type { ManufactureOpFilter } from '../shell/workspaceMemory'
import {
  cncOp,
  contourPointsStats,
  formatDerivedAt,
  toolDiameterFieldValue,
  cutParamFieldValue,
  geometryJsonFieldValue,
  contourDriftState,
  opReadiness,
  filterButtonClass
} from './manufacture-op-helpers'
import { isOperationSourceMeshStale } from '../../shared/cam-source-stale'
import { OFFERED_CAM_OP_KINDS } from '../../shared/manufacture-cam-gate'

/** Status variant rendered as the .op-tree-op-status indicator. */
export type OpTreeStatus = 'error' | 'stale' | 'done' | 'idle' | 'running'

/** Synthetic group id used for operations that have no `setupId`. */
export const UNASSIGNED_SETUP_ID = '__unassigned__'

/**
 * Resolve the parent setup-id for an operation.
 *
 * Linkage convention (additive, backward-compatible with v1/v2 schemas):
 * `op.params.setupId` is a string. Operations without it group under the
 * synthetic "(Unassigned)" group.
 */
export function getOpSetupId(op: ManufactureOperation): string | undefined {
  const raw = op.params?.['setupId']
  if (typeof raw === 'string' && raw.trim() !== '') return raw.trim()
  return undefined
}

/**
 * Map readiness + stale-mesh state to a single status variant for the
 * tree-row indicator. Pure function — easy to pin in tests.
 */
export function deriveOpTreeStatus(
  op: ManufactureOperation,
  contourCandidates: DerivedContourCandidate[],
  camStaleMeshRelativePaths: readonly string[]
): OpTreeStatus {
  const readiness = opReadiness(op, contourCandidates).label
  if (readiness === 'suppressed' || readiness === 'non-cam') return 'idle'
  if (readiness === 'missing geometry') return 'error'
  if (readiness === 'stale geometry') return 'stale'
  // ready — check whether the source STL is newer than the posted cam.nc
  if (cncOp(op.kind) && isOperationSourceMeshStale(op.sourceMesh, camStaleMeshRelativePaths)) {
    return 'stale'
  }
  return 'done'
}

/** Group filtered operations under their parent setup id, preserving order. */
export function groupOpsBySetup(
  setups: readonly ManufactureSetup[],
  filteredOps: readonly ManufactureOperation[]
): Array<{ setup: ManufactureSetup | null; ops: ManufactureOperation[] }> {
  const groups = new Map<string, ManufactureOperation[]>()
  const unassigned: ManufactureOperation[] = []
  for (const op of filteredOps) {
    const sid = getOpSetupId(op)
    if (!sid) {
      unassigned.push(op)
      continue
    }
    const known = setups.find((s) => s.id === sid)
    if (!known) {
      // Operation references a setup that has been removed — surface it under
      // (Unassigned) rather than dropping it silently.
      unassigned.push(op)
      continue
    }
    const arr = groups.get(sid) ?? []
    arr.push(op)
    groups.set(sid, arr)
  }
  const result: Array<{ setup: ManufactureSetup | null; ops: ManufactureOperation[] }> = []
  if (unassigned.length > 0) result.push({ setup: null, ops: unassigned })
  for (const s of setups) {
    const ops = groups.get(s.id)
    if (ops && ops.length > 0) result.push({ setup: s, ops })
  }
  return result
}

type Props = {
  operations: ManufactureOperation[]
  filteredOps: ManufactureOperation[]
  /** Parent setups for tree grouping. Optional for back-compat with older callers/tests. */
  setups?: ManufactureSetup[]
  selectedOpIndex: number
  contourCandidates: DerivedContourCandidate[]
  tools: ToolLibraryFile | null
  camMachine: MachineProfile | undefined
  readinessCounts: Record<'ready' | 'missing geometry' | 'stale geometry' | 'suppressed' | 'non-cam', number>
  activeFilterLabel: string
  opFilter: ManufactureOpFilter
  actionableOnly: boolean
  nowTickMs: number
  /** Source meshes newer than posted `output/cam.nc` (project-relative paths). */
  camStaleMeshRelativePaths?: string[]
  onSelectOp: (i: number) => void
  onSetOpFilter: (f: ManufactureOpFilter) => void
  onSetActionableOnly: (v: boolean | ((prev: boolean) => boolean)) => void
  onUpdateOp: (i: number, patch: Partial<ManufactureOperation>) => void
  onRemoveOp: (i: number) => void
  onSetToolDiameterMm: (i: number, raw: string) => void
  onSetToolFromLibrary: (i: number, toolId: string) => void
  onSetCutParam: (i: number, key: string, raw: string, mode: 'nonzero' | 'positive' | 'nonnegative') => void
  onSetGeometryJson: (i: number, key: 'contourPoints' | 'drillPoints', raw: string) => void
  onDeriveOpGeometry: (i: number) => void
  onLoadContourCandidates: () => void
  onRunFdmSlice: (i: number) => void
  /** Optional: when supplied, the "no operations yet" empty state renders an "Add operation" CTA. */
  onAddOp?: () => void
}

export function ManufactureOperationList({
  operations,
  filteredOps,
  setups = [],
  selectedOpIndex,
  contourCandidates,
  tools,
  camMachine,
  readinessCounts,
  activeFilterLabel,
  opFilter,
  actionableOnly,
  nowTickMs,
  camStaleMeshRelativePaths = [],
  onSelectOp,
  onSetOpFilter,
  onSetActionableOnly,
  onUpdateOp,
  onRemoveOp,
  onSetToolDiameterMm,
  onSetToolFromLibrary,
  onSetCutParam,
  onSetGeometryJson,
  onDeriveOpGeometry,
  onLoadContourCandidates,
  onRunFdmSlice,
  onAddOp
}: Props): React.ReactElement {
  // Collapse state is owned by the browser via the native <details> element.
  // No React state needed — the harness is intentionally hookless so renderer
  // tests can invoke the component as a plain function (see empty-state tests).
  const groups = groupOpsBySetup(setups, filteredOps)
  return (
    <>
      <h3 className="subh">Operations</h3>
      <p className="msg">
        <strong>Make &rarr; Generate CAM</strong> uses the <em>first non-suppressed operation</em> here for strategy (kind +
        <code>params</code>). <strong>Tool diameter</strong> and default <strong>feeds / Z / stepover</strong> still resolve
        from the first non-suppressed <code>cnc_*</code> row. <code>fdm_slice</code> and <code>export_stl</code> are not CNC
        toolpaths &mdash; use the <strong>Slice</strong> tab or Design/assets export, or put a <code>cnc_*</code> row first for Make. Run
        toolpaths from <strong>Manufacture &rarr; CAM</strong> (<strong>Generate toolpath&hellip;</strong>); then{' '}
        <strong>Preview G-code analysis</strong>{' '}
        (text-only stats &mdash; not machine simulation) and optional <strong>Last run</strong> details show engine choice
        (OpenCAMLib vs built-in fallback) plus reason.
      </p>
      <div className="row row--align-center-8">
        <span className="msg msg-row-flex">
          CAM readiness: {readinessCounts.ready} ready, {readinessCounts['non-cam']} not CAM,{' '}
          {readinessCounts['stale geometry']} stale, {readinessCounts['missing geometry']} missing,{' '}
          {readinessCounts.suppressed} suppressed (filter: {activeFilterLabel})
        </span>
        <button
          type="button"
          className={filterButtonClass(!actionableOnly && opFilter === 'all')}
          onClick={() => onSetOpFilter('all')}
          aria-pressed={!actionableOnly && opFilter === 'all'}
          aria-label="Filter operations: show all"
        >
          All
        </button>
        <button
          type="button"
          className={filterButtonClass(!actionableOnly && opFilter === 'missing geometry')}
          onClick={() => onSetOpFilter('missing geometry')}
          aria-pressed={!actionableOnly && opFilter === 'missing geometry'}
          aria-label="Filter operations: missing geometry only"
        >
          Missing
        </button>
        <button
          type="button"
          className={filterButtonClass(!actionableOnly && opFilter === 'stale geometry')}
          onClick={() => onSetOpFilter('stale geometry')}
          aria-pressed={!actionableOnly && opFilter === 'stale geometry'}
          aria-label="Filter operations: stale geometry only"
        >
          Stale
        </button>
        <button
          type="button"
          className={filterButtonClass(!actionableOnly && opFilter === 'suppressed')}
          onClick={() => onSetOpFilter('suppressed')}
          aria-pressed={!actionableOnly && opFilter === 'suppressed'}
          aria-label="Filter operations: suppressed only"
        >
          Suppressed
        </button>
        <button
          type="button"
          className={filterButtonClass(!actionableOnly && opFilter === 'non-cam')}
          onClick={() => onSetOpFilter('non-cam')}
          title="fdm_slice and export_stl rows (blocked from Make &rarr; Generate CAM)"
          aria-pressed={!actionableOnly && opFilter === 'non-cam'}
          aria-label="Filter operations: non-CAM only"
        >
          Not CAM
        </button>
        <label className={`chk mfg-actionable-toggle${actionableOnly ? ' mfg-actionable-toggle--on' : ''}`}>
          <input type="checkbox" checked={actionableOnly} onChange={(e) => onSetActionableOnly(e.target.checked)} />
          Show actionable only
        </label>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            onSetActionableOnly(false)
            onSetOpFilter('all')
          }}
          aria-label="Clear all operation filters"
        >
          Clear filters
        </button>
      </div>
      <p className="msg">
        Shortcuts (panel focused): <code>A</code> all, <code>M</code> missing, <code>S</code> stale, <code>U</code>{' '}
        suppressed, <code>N</code> not CAM, <code>F</code> actionable toggle, <code>C</code> clear.
      </p>
      {filteredOps.length === 0 && operations.length === 0 ? (
        <div
          className="empty-state manufacture-op-empty"
          data-testid="manufacture-op-empty-none"
          role="status"
        >
          <p className="manufacture-op-empty__title">No operations yet</p>
          <p className="manufacture-op-empty__hint">
            Add your first operation to start planning toolpaths or slicing.
          </p>
          {onAddOp ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={onAddOp}
              aria-label="Add new manufacture operation"
              data-testid="manufacture-op-empty-add"
            >
              Add operation
            </button>
          ) : null}
        </div>
      ) : null}
      {filteredOps.length === 0 && operations.length > 0 ? (
        <div
          className="empty-state manufacture-op-empty"
          data-testid="manufacture-op-empty-filtered"
          role="status"
        >
          <p className="manufacture-op-empty__title manufacture-op-empty__title--italic">
            No operations match this filter
          </p>
          <p className="manufacture-op-empty__hint">
            Filter: <code>{activeFilterLabel}</code>. Clear it to see all {operations.length}{' '}
            operation{operations.length === 1 ? '' : 's'}.
          </p>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              onSetActionableOnly(false)
              onSetOpFilter('all')
            }}
            aria-label="Clear active operation filter"
            data-testid="manufacture-op-empty-clear"
          >
            Clear filter
          </button>
        </div>
      ) : null}
      <div className="op-tree" role="tree" aria-label="Operations grouped by setup">
        {groups.map((group) => {
          const groupId = group.setup?.id ?? UNASSIGNED_SETUP_ID
          const groupName = group.setup?.label ?? '(Unassigned)'
          const setupTestId = `op-tree-setup-${groupId}`
          return (
            <details
              key={groupId}
              open
              className={`op-tree-setup${group.setup ? '' : ' op-tree-setup--unassigned'}`}
              data-testid={setupTestId}
            >
              <summary
                className="op-tree-setup__header"
                aria-label={`Setup ${groupName} — ${group.ops.length} operation${group.ops.length === 1 ? '' : 's'}`}
              >
                <span
                  className="op-tree-setup__chevron"
                  aria-hidden="true"
                  data-testid={`op-tree-setup-chevron-${groupId}`}
                />
                <span className="op-tree-setup__name">{groupName}</span>
                <span
                  className="op-tree-setup__count"
                  aria-label={`${group.ops.length} operation${group.ops.length === 1 ? '' : 's'}`}
                >
                  {group.ops.length}
                </span>
              </summary>
              <ul className="op-tree-ops tools entity-list entity-list--stack" role="group">
                  {group.ops.map((op) => {
                    const i = operations.findIndex((x) => x.id === op.id)
                    const status = deriveOpTreeStatus(op, contourCandidates, camStaleMeshRelativePaths)
                    return (
          <li
            key={op.id}
            className={`op-tree-op-row manufacture-op-li${selectedOpIndex === i ? ' manufacture-op-li--selected' : ''} op-tree-op-row--${status}`}
            role="treeitem"
            data-testid={`op-tree-op-row-${op.id}`}
          >
            <span
              className={`op-tree-op-status op-tree-op-status--${status}`}
              aria-label={`Status: ${status}`}
              data-testid={`op-tree-op-status-${op.id}`}
              title={
                status === 'error'
                  ? 'Missing geometry — operation cannot generate G-code'
                  : status === 'stale'
                    ? 'Geometry / source mesh has changed since last generate'
                    : status === 'done'
                      ? 'Ready — geometry is in sync'
                      : status === 'running'
                        ? 'Running'
                        : 'Idle (suppressed or not a CAM op)'
              }
            />
            <div className="row">
              <button
                type="button"
                className={selectedOpIndex === i ? 'primary' : 'secondary'}
                onClick={() => onSelectOp(i)}
                title="Use this operation's source mesh in the 3D workspace"
                aria-label={`Select ${op.label} for 3D preview`}
                aria-pressed={selectedOpIndex === i}
              >
                3D preview
              </button>
              <label>
                Label
                <input value={op.label} onChange={(e) => onUpdateOp(i, { label: e.target.value })} />
              </label>
              <span
                className={`status-chip status-chip--${opReadiness(op, contourCandidates).variant}`}
                title={
                  opReadiness(op, contourCandidates).label === 'non-cam'
                    ? 'FDM slice / export STL — not generated by Make → Generate CAM'
                    : 'Operation CAM readiness'
                }
              >
                {opReadiness(op, contourCandidates).label === 'non-cam' ? 'Not CAM' : opReadiness(op, contourCandidates).label}
              </span>
              {cncOp(op.kind) && isOperationSourceMeshStale(op.sourceMesh, camStaleMeshRelativePaths) ? (
                <span
                  className="status-chip status-chip--warn"
                  title="STL on disk is newer than output/cam.nc — run Generate toolpath again"
                >
                  Mesh &gt; G-code
                </span>
              ) : null}
              {op.kind === 'cnc_contour' || op.kind === 'cnc_pocket' || op.kind === 'cnc_vcarve' || op.kind === 'cnc_adaptive' || op.kind === 'cnc_trochoidal_hsm' ? (
                <span
                  className={`status-chip status-chip--${
                    contourDriftState(op, contourCandidates) === 'changed' || contourDriftState(op, contourCandidates) === 'missing'
                      ? 'error'
                      : contourDriftState(op, contourCandidates) === 'ok'
                        ? 'ok'
                        : 'neutral'
                  }`}
                  title="Sketch profile drift status"
                >
                  {contourDriftState(op, contourCandidates) === 'changed'
                    ? 'Profile stale'
                    : contourDriftState(op, contourCandidates) === 'missing'
                      ? 'Profile missing'
                      : contourDriftState(op, contourCandidates) === 'ok'
                        ? 'Profile synced'
                        : 'Profile unknown'}
                </span>
              ) : null}
              <label>
                Kind
                <select
                  value={op.kind}
                  onChange={(e) => onUpdateOp(i, { kind: e.target.value as ManufactureOperation['kind'] })}
                >
                  {/* Options are derived from OFFERED_CAM_OP_KINDS (single source
                      of truth in manufacture-cam-gate) so dead/blocked kinds can
                      never drift back into the picker. */}
                  {OFFERED_CAM_OP_KINDS.map((o) => (
                    <option key={o.kind} value={o.kind}>
                      {o.label}
                    </option>
                  ))}
                  {/* A legacy saved op may carry a now-blocked kind (e.g.
                      cnc_5axis_*, cnc_spiral_finish). Surface its current value as
                      a trailing option so the <select> shows it honestly and the
                      operator can switch to a runnable kind — without re-offering
                      the blocked kind to every other op. */}
                  {OFFERED_CAM_OP_KINDS.every((o) => o.kind !== op.kind) ? (
                    <option value={op.kind}>{op.kind} (unsupported — pick another)</option>
                  ) : null}
                </select>
              </label>
              <label>
                Source mesh
                <input
                  value={op.sourceMesh ?? ''}
                  onChange={(e) => onUpdateOp(i, { sourceMesh: e.target.value })}
                  placeholder="assets/model.stl"
                />
              </label>
              <label className="chk">
                <input
                  type="checkbox"
                  checked={!!op.suppressed}
                  onChange={(e) => onUpdateOp(i, { suppressed: e.target.checked })}
                />
                Suppressed
              </label>
              <button type="button" className="secondary" onClick={() => onRemoveOp(i)} aria-label={`Remove operation ${op.label}`}>
                Remove
              </button>
            </div>
            {cncOp(op.kind) ? (
              <div className="row">
                <label>
                  Tool &Oslash; (mm) for CAM
                  <input
                    type="number"
                    min={0.01}
                    step={0.01}
                    value={toolDiameterFieldValue(op)}
                    onChange={(e) => onSetToolDiameterMm(i, e.target.value)}
                    placeholder="default 6 or from library"
                  />
                </label>
                {tools && tools.tools.length > 0 ? (
                  <label>
                    Library tool
                    <select
                      value={typeof op.params?.['toolId'] === 'string' ? op.params['toolId'] : ''}
                      onChange={(e) => onSetToolFromLibrary(i, e.target.value)}
                    >
                      <option value="">—</option>
                      {tools.tools.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} (&Oslash;{t.diameterMm} mm)
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>
            ) : null}
            {cncOp(op.kind) ? (
              <>
                <div className="row">
                  <label title="Parallel: G1 work Z. Waterline/OCL: slice spacing (mm).">
                    Z pass / slice step (mm)
                    <input
                      type="number"
                      step={0.1}
                      value={cutParamFieldValue(op, 'zPassMm')}
                      onChange={(e) => onSetCutParam(i, 'zPassMm', e.target.value, 'nonzero')}
                      placeholder={String(CAM_CUT_DEFAULTS.zPassMm)}
                    />
                  </label>
                  <label>
                    Stepover (mm)
                    <input
                      type="number"
                      min={0.01}
                      step={0.1}
                      value={cutParamFieldValue(op, 'stepoverMm')}
                      onChange={(e) => onSetCutParam(i, 'stepoverMm', e.target.value, 'positive')}
                      placeholder={String(CAM_CUT_DEFAULTS.stepoverMm)}
                    />
                  </label>
                  <label>
                    Feed (mm/min)
                    <input
                      type="number"
                      min={1}
                      step={10}
                      value={cutParamFieldValue(op, 'feedMmMin')}
                      onChange={(e) => onSetCutParam(i, 'feedMmMin', e.target.value, 'positive')}
                      placeholder={String(CAM_CUT_DEFAULTS.feedMmMin)}
                    />
                  </label>
                  <label>
                    Plunge (mm/min)
                    <input
                      type="number"
                      min={1}
                      step={10}
                      value={cutParamFieldValue(op, 'plungeMmMin')}
                      onChange={(e) => onSetCutParam(i, 'plungeMmMin', e.target.value, 'positive')}
                      placeholder={String(CAM_CUT_DEFAULTS.plungeMmMin)}
                    />
                  </label>
                  <label>
                    Safe Z (mm)
                    <input
                      type="number"
                      min={0.01}
                      step={0.5}
                      value={cutParamFieldValue(op, 'safeZMm')}
                      onChange={(e) => onSetCutParam(i, 'safeZMm', e.target.value, 'positive')}
                      placeholder={String(CAM_CUT_DEFAULTS.safeZMm)}
                    />
                  </label>
                </div>
                {op.kind === 'cnc_pencil' ? (
                  <div className="row row--mt-xs">
                    <label title="Multiplies resolved stepover before the tight raster pass (default 0.22). Ignored if pencil stepover mm is set.">
                      Pencil stepover factor
                      <input
                        type="number"
                        min={0.05}
                        max={1}
                        step={0.01}
                        value={cutParamFieldValue(op, 'pencilStepoverFactor')}
                        onChange={(e) => onSetCutParam(i, 'pencilStepoverFactor', e.target.value, 'positive')}
                        placeholder="0.22"
                      />
                    </label>
                    <label title="Optional fixed pencil stepover in mm (overrides factor).">
                      Pencil stepover (mm)
                      <input
                        type="number"
                        min={0.05}
                        step={0.05}
                        value={cutParamFieldValue(op, 'pencilStepoverMm')}
                        onChange={(e) => onSetCutParam(i, 'pencilStepoverMm', e.target.value, 'positive')}
                        placeholder="(optional)"
                      />
                    </label>
                  </div>
                ) : null}
              </>
            ) : null}
            {op.kind === 'cnc_4axis_roughing' || op.kind === 'cnc_4axis_finishing' || op.kind === 'cnc_4axis_contour' || op.kind === 'cnc_4axis_indexed' || op.kind === 'cnc_4axis_continuous' ? (
              <div className="row row--mt-xs" data-testid={`op-4axis-rotary-tuning-${i}`}>
                <label title="Angular stepover (degrees) around the rotation axis. Blank = auto from linear stepover and stock �.">
                  Stepover (&deg;)
                  <input
                    type="number"
                    min={0.1}
                    step={1}
                    data-testid={`op-4axis-stepover-deg-${i}`}
                    value={cutParamFieldValue(op, 'stepoverDeg')}
                    onChange={(e) => onSetCutParam(i, 'stepoverDeg', e.target.value, 'positive')}
                    placeholder="auto"
                  />
                </label>
                <label title="Extend cuts past material edges (mm). Blank = tool diameter.">
                  Overcut (mm)
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    data-testid={`op-4axis-overcut-${i}`}
                    value={
                      typeof op.params?.['overcutMm'] === 'number'
                        ? String(op.params['overcutMm'])
                        : ''
                    }
                    onChange={(e) => {
                      const base: Record<string, unknown> = { ...(op.params ?? {}) }
                      const v = e.target.value.trim()
                      if (!v) delete base.overcutMm
                      else {
                        const n = Number.parseFloat(v)
                        if (Number.isFinite(n) && n >= 0) base.overcutMm = n
                      }
                      onUpdateOp(i, { params: Object.keys(base).length ? base : undefined })
                    }}
                    placeholder="= tool &Oslash;"
                  />
                </label>
                <label title="Insert extra A-axis passes where surface curvature is high (denser sampling on corners/edges).">
                  <input
                    type="checkbox"
                    data-testid={`op-4axis-adaptive-refinement-${i}`}
                    checked={op.params?.['adaptiveRefinement'] === true}
                    onChange={(e) => {
                      const base: Record<string, unknown> = { ...(op.params ?? {}) }
                      if (e.target.checked) base.adaptiveRefinement = true
                      else delete base.adaptiveRefinement
                      onUpdateOp(i, { params: Object.keys(base).length ? base : undefined })
                    }}
                  />
                  Adaptive A refinement
                </label>
                <label title="Skip empty waterline passes above the mesh's max radial extent (faster on undersized parts).">
                  <input
                    type="checkbox"
                    data-testid={`op-4axis-mesh-radial-z-bands-${i}`}
                    checked={op.params?.['useMeshRadialZBands'] === true}
                    onChange={(e) => {
                      const base: Record<string, unknown> = { ...(op.params ?? {}) }
                      if (e.target.checked) base.useMeshRadialZBands = true
                      else delete base.useMeshRadialZBands
                      onUpdateOp(i, { params: Object.keys(base).length ? base : undefined })
                    }}
                  />
                  Mesh-radial Z bands
                </label>
              </div>
            ) : null}
            {op.kind === 'cnc_4axis_roughing' || op.kind === 'cnc_4axis_finishing' || op.kind === 'cnc_4axis_contour' || op.kind === 'cnc_4axis_indexed' || op.kind === 'cnc_4axis_continuous' ? (
              <div className="row row--mt-xs">
                <label title="Clamp machinable X to STL bounding box (disable if WCS mismatch)">
                  <input
                    type="checkbox"
                    checked={op.params?.['useMeshMachinableXClamp'] !== false}
                    onChange={(e) => {
                      const base: Record<string, unknown> = { ...(op.params ?? {}) }
                      if (e.target.checked) delete base.useMeshMachinableXClamp
                      else base.useMeshMachinableXClamp = false
                      onUpdateOp(i, { params: base })
                    }}
                  />
                  Clamp X to STL
                </label>
                {op.kind === 'cnc_4axis_roughing' ? (
                  <>
                    <label>
                      Z step (mm)
                      <input
                        type="number"
                        min={0}
                        step={0.1}
                        value={cutParamFieldValue(op, 'zStepMm')}
                        onChange={(e) => onSetCutParam(i, 'zStepMm', e.target.value, 'positive')}
                        placeholder="0 = auto"
                      />
                    </label>
                  </>
                ) : null}
                {op.kind === 'cnc_4axis_finishing' ? (
                  <>
                    <label title="Angular stepover for finish pass (degrees)">
                      Finish stepover (&deg;)
                      <input
                        type="number"
                        min={0.1}
                        step={0.5}
                        value={
                          typeof op.params?.['finishStepoverDeg'] === 'number'
                            ? String(op.params['finishStepoverDeg'])
                            : ''
                        }
                        onChange={(e) => {
                          const base: Record<string, unknown> = { ...(op.params ?? {}) }
                          const v = e.target.value.trim()
                          if (!v) delete base.finishStepoverDeg
                          else {
                            const n = Number.parseFloat(v)
                            if (Number.isFinite(n) && n > 0) base.finishStepoverDeg = n
                          }
                          onUpdateOp(i, { params: Object.keys(base).length ? base : undefined })
                        }}
                        placeholder="= half of stepover"
                      />
                    </label>
                    <label title="Leave stock on mesh hits (mm)">
                      Finish allowance (mm)
                      <input
                        type="number"
                        min={0}
                        step={0.05}
                        value={
                          typeof op.params?.['rotaryFinishAllowanceMm'] === 'number'
                            ? String(op.params['rotaryFinishAllowanceMm'])
                            : ''
                        }
                        onChange={(e) => {
                          const base: Record<string, unknown> = { ...(op.params ?? {}) }
                          const v = e.target.value.trim()
                          if (!v) delete base.rotaryFinishAllowanceMm
                          else {
                            const n = Number.parseFloat(v)
                            if (Number.isFinite(n) && n >= 0) base.rotaryFinishAllowanceMm = n
                          }
                          onUpdateOp(i, { params: Object.keys(base).length ? base : undefined })
                        }}
                        placeholder="0"
                      />
                    </label>
                  </>
                ) : null}
                {op.kind === 'cnc_4axis_indexed' ? (
                  <label>
                    Index angles (&deg;, comma-sep)
                    <input
                      type="text"
                      value={
                        Array.isArray(op.params?.['indexAnglesDeg'])
                          ? (op.params!['indexAnglesDeg'] as number[]).join(', ')
                          : '0, 90, 180, 270'
                      }
                      onChange={(e) => {
                        const base: Record<string, unknown> = { ...(op.params ?? {}) }
                        const arr = e.target.value
                          .split(',')
                          .map((s) => Number.parseFloat(s.trim()))
                          .filter((n) => !Number.isNaN(n))
                        if (arr.length) base.indexAnglesDeg = arr
                        else delete base.indexAnglesDeg
                        onUpdateOp(i, { params: Object.keys(base).length ? base : undefined })
                      }}
                    />
                  </label>
                ) : null}
              </div>
            ) : null}
            {op.kind === 'cnc_4axis_contour' ? (
              <div className="row">
                <label className="label--wide-420">
                  contourPoints JSON
                  <input
                    value={geometryJsonFieldValue(op, 'contourPoints')}
                    onChange={(e) => onSetGeometryJson(i, 'contourPoints', e.target.value)}
                    placeholder="[[x,y],…] unwrap coordinates"
                  />
                </label>
                <label>
                  Contour source
                  <select
                    value={typeof op.params?.['contourSourceId'] === 'string' ? op.params['contourSourceId'] : ''}
                    onChange={(e) => {
                      const base: Record<string, unknown> = { ...(op.params ?? {}) }
                      if (!e.target.value) delete base.contourSourceId
                      else base.contourSourceId = e.target.value
                      onUpdateOp(i, { params: Object.keys(base).length ? base : undefined })
                    }}
                  >
                    <option value="">first closed profile</option>
                    {contourCandidates.map((c) => (
                      <option key={c.sourceId} value={c.sourceId}>
                        {c.label} ({c.points.length} pts)
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" className="secondary" onClick={() => onLoadContourCandidates()} aria-label="Refresh available sketch profiles for contour source selection">
                  Refresh sketch profiles
                </button>
                <button type="button" className="secondary" onClick={() => onDeriveOpGeometry(i)} aria-label={`Derive contour geometry from sketch for ${op.label}`}>
                  Derive contour
                </button>
              </div>
            ) : null}
            {op.kind === 'cnc_4axis_roughing' || op.kind === 'cnc_4axis_finishing' || op.kind === 'cnc_4axis_contour' || op.kind === 'cnc_4axis_indexed' || op.kind === 'cnc_4axis_continuous' ? (
              <p className="msg manufacture-op-hint">
                <strong>4-axis rotary:</strong> requires a machine profile with <code>axisCount: 4</code>.
                Roughing and finishing use the mesh-aware cylindrical heightmap engine.
                See <code>docs/CAM_4TH_AXIS_REFERENCE.md</code> and <code>docs/MACHINES.md</code>.
              </p>
            ) : null}
            {op.kind === 'cnc_5axis_contour' || op.kind === 'cnc_5axis_swarf' || op.kind === 'cnc_5axis_flowline' ? (
              <p className="msg manufacture-op-hint">
                <strong>5-axis:</strong> requires a machine profile with <code>axisCount: 5</code>.
                Requires Python toolpath engine. See <code>docs/MACHINES.md</code>.
              </p>
            ) : null}
            {op.kind === 'cnc_scallop_finish' ? (
              <div className="row row--mt-xs">
                <label title="Target surface roughness in µm (default 3.2 µm Ra)">
                  Surface finish Ra (µm)
                  <input
                    type="number"
                    min={0.1}
                    max={25}
                    step={0.1}
                    value={cutParamFieldValue(op, 'surfaceFinishRaUm')}
                    onChange={(e) => onSetCutParam(i, 'surfaceFinishRaUm', e.target.value, 'positive')}
                    placeholder="3.2"
                  />
                </label>
              </div>
            ) : null}
            {op.kind === 'cnc_trochoidal_hsm' ? (
              <div className="row row--mt-xs">
                <label title="Trochoidal circle advance per revolution (mm)">
                  Trochoidal stepover (mm)
                  <input
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={cutParamFieldValue(op, 'stepoverMm')}
                    onChange={(e) => onSetCutParam(i, 'stepoverMm', e.target.value, 'positive')}
                    placeholder="(stepover)"
                  />
                </label>
              </div>
            ) : null}
            {op.kind === 'cnc_5axis_contour' || op.kind === 'cnc_5axis_swarf' || op.kind === 'cnc_5axis_flowline' ? (
              <div className="row row--mt-xs">
                <label title="Maximum tool tilt from vertical (degrees)">
                  Max tilt (&deg;)
                  <input
                    type="number"
                    min={1}
                    max={120}
                    step={1}
                    value={cutParamFieldValue(op, 'maxTiltDeg')}
                    onChange={(e) => onSetCutParam(i, 'maxTiltDeg', e.target.value, 'positive')}
                    placeholder="60"
                  />
                </label>
                <label>
                  Tool shape
                  <select
                    value={(op.params?.['toolShape'] as string) ?? 'ball'}
                    onChange={(e) => onUpdateOp(i, { params: { ...(op.params ?? {}), toolShape: e.target.value } })}
                  >
                    <option value="ball">Ball nose</option>
                    <option value="flat">Flat end</option>
                    <option value="bull">Bull nose</option>
                  </select>
                </label>
              </div>
            ) : null}
            {op.kind === 'cnc_adaptive' || op.kind === 'cnc_trochoidal_hsm' ? (
              <div className="row row--mt-xs">
                <label title="Radial engagement cap (mm). Cut runs whose local bite into uncleared material would exceed this get trochoidal relief loops; channels narrower than ~tool diameter + stepover are cleared fully trochoidally. Default 40% of tool diameter (20% for trochoidal HSM).">
                  Max engagement (mm)
                  <input
                    type="number"
                    min={0.05}
                    step={0.1}
                    value={cutParamFieldValue(op, 'maxEngagementMm')}
                    onChange={(e) => onSetCutParam(i, 'maxEngagementMm', e.target.value, 'positive')}
                    placeholder={op.kind === 'cnc_trochoidal_hsm' ? '20% of tool diameter' : '40% of tool diameter'}
                  />
                </label>
                <label title="Trochoid relief circle radius (mm). Default cap/2; clamped to 80% of the engagement cap so relief passes stay under the cap.">
                  Trochoid radius (mm)
                  <input
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={cutParamFieldValue(op, 'trochoidRadiusMm')}
                    onChange={(e) => onSetCutParam(i, 'trochoidRadiusMm', e.target.value, 'positive')}
                    placeholder="cap / 2"
                  />
                </label>
                <label title="Forward advance per trochoid relief circle (mm). Default cap/4; clamped to the trochoid radius. Smaller = gentler bite, longer program.">
                  Trochoid step (mm)
                  <input
                    type="number"
                    min={0.05}
                    step={0.05}
                    value={cutParamFieldValue(op, 'trochoidStepMm')}
                    onChange={(e) => onSetCutParam(i, 'trochoidStepMm', e.target.value, 'positive')}
                    placeholder="cap / 4"
                  />
                </label>
              </div>
            ) : null}
            {op.kind === 'cnc_pocket' || op.kind === 'cnc_adaptive' || op.kind === 'cnc_trochoidal_hsm' ? (
              <div className="row row--mt-xs">
                <label title="Rest machining: clear only what the previous tool left -- set to that tool's diameter (mm). Must be LARGER than this op's tool. The engine clears just the corner/channel material the bigger tool provably could not reach and skips the wall finish trace (the previous op already finished the walls). Equal or smaller values fail honestly; leave blank for a normal full-region pass. Adaptive note: cusped corner lobes are skipped with a hint -- pocket raster/offset-spiral clears those.">
                  Rest: previous tool diameter (mm)
                  <input
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={cutParamFieldValue(op, 'restPrevToolDiameterMm')}
                    onChange={(e) => onSetCutParam(i, 'restPrevToolDiameterMm', e.target.value, 'positive')}
                    placeholder="off (full region)"
                  />
                </label>
              </div>
            ) : null}
            {op.kind === 'cnc_adaptive' || op.kind === 'cnc_trochoidal_hsm' ? (
              <p className="msg manufacture-op-hint">
                <strong>Adaptive clearing (adaptive-lite v1):</strong> with <strong>contourPoints</strong> set (derive
                from sketch below), the 2D engine clears concentric offset levels and inserts <strong>trochoidal
                relief</strong> wherever the radial engagement would exceed the cap; over-narrow channels are cut fully
                trochoidally. Relief arcs are emitted as fine <strong>G1 line segments</strong> &mdash; no G2/G3 in v1
                &mdash; region-core entry loops are cut fully buried (prefer ramp entry), and unrelievable spots are{' '}
                <strong>skipped with material left</strong> + a hint, never slotted above the cap. Depth is hard-capped
                to stock thickness; Stepover (mm) above sets the steady-state engagement.{' '}
                {op.kind === 'cnc_trochoidal_hsm' ? (
                  <>
                    Trochoidal HSM is the same engine with a tighter <strong>20%</strong> default cap; without
                    contourPoints it falls back to the built-in parallel finish (the Python engine it once targeted was
                    removed).
                  </>
                ) : (
                  <>
                    Without contourPoints the op runs the legacy STL path (OpenCAMLib <strong>AdaptiveWaterline</strong>{' '}
                    or the parallel-finish fallback).
                  </>
                )}{' '}
                G-code is <strong>unverified</strong> until post/machine checks (<code>docs/MACHINES.md</code>).
              </p>
            ) : null}
            {op.kind === 'cnc_waterline' ? (
              <p className="msg manufacture-op-hint">
                With <strong>OpenCAMLib</strong>, <strong>Generate CAM</strong> runs <strong>Z-level waterline</strong>{' '}
                on the STL and posts through your machine template; otherwise it falls back to the built-in parallel
                finish. G-code is <strong>unverified</strong> until post/machine checks (
                <code>docs/MACHINES.md</code>).
              </p>
            ) : null}
            {op.kind === 'cnc_raster' ? (
              <p className="msg manufacture-op-hint">
                <strong>Generate CAM</strong> tries <strong>OpenCAMLib PathDropCutter</strong> XY raster when Python has{' '}
                <code>opencamlib</code>; otherwise a <strong>2.5D mesh height-field</strong> raster, then an{' '}
                <strong>orthogonal bounds</strong> zigzag at fixed Z if needed. G-code is <strong>unverified</strong>{' '}
                until post/machine checks (<code>docs/MACHINES.md</code>).
              </p>
            ) : null}
            {op.kind === 'cnc_pencil' ? (
              <p className="msg manufacture-op-hint">
                <strong>Pencil / rest cleanup:</strong> same OpenCAMLib <strong>raster</strong> path as CNC raster, but the CAM
                runner applies a <strong>tighter stepover</strong> (default <code>pencilStepoverFactor</code> 0.22 &times; your
                stepover, or set <code>pencilStepoverMm</code>). This is <strong>not</strong> automatic leftover-material
                detection &mdash; tune tool and stepover for your prior roughing. G-code is <strong>unverified</strong> (
                <code>docs/MACHINES.md</code>).
              </p>
            ) : null}
            {op.kind === 'cnc_parallel' ? (
              <p className="msg manufacture-op-hint">
                <strong>Generate CAM</strong> uses the built-in <strong>parallel finish</strong> from STL mesh bounds (no
                OpenCAMLib required for this op). G-code is <strong>unverified</strong> until post/machine checks (
                <code>docs/MACHINES.md</code>).
              </p>
            ) : null}
            {op.kind === 'cnc_contour' || op.kind === 'cnc_pocket' || op.kind === 'cnc_drill' ? (
              <p className="msg manufacture-op-hint">
                Uses built-in 2D paths when geometry params are provided: <code>contourPoints</code> for contour/pocket,
                <code>drillPoints</code> for drill. Missing or invalid geometry is a hard error (no mesh-bounds parallel
                fallback). G-code is <strong>unverified</strong> until post/machine checks (<code>docs/MACHINES.md</code>).
              </p>
            ) : null}
            {op.kind === 'fdm_slice' ? (
              <div className="msg manufacture-op-hint">
                <p>
                  Not generated by <strong>Generate CAM</strong>. Slice from the <strong>Device / Send</strong> tab
                  (ProfileStack &rarr; Send to K2 Plus) or use <strong>Slice with OrcaSlicer</strong> below (uses{' '}
                  <strong>source mesh</strong>, the K2 quality preset + filament, and any PROCESS overrides from Settings).
                  Slicing runs through the bundled OrcaSlicer; G-code is unverified until you match printer profiles &mdash;{' '}
                  <code>docs/MACHINES.md</code>.
                </p>
                <button type="button" className="secondary" onClick={() => onRunFdmSlice(i)} aria-label={`Slice ${op.label} with OrcaSlicer`}>
                  Slice with OrcaSlicer&hellip;
                </button>
              </div>
            ) : null}
            {op.kind === 'export_stl' ? (
              <p className="msg manufacture-op-hint">
                Not generated by <strong>Generate CAM</strong>. Export meshes from Design or project <code>assets/</code>.
                Put a <code>cnc_*</code> operation first when you want Make to post CNC toolpaths.
              </p>
            ) : null}
            {op.kind === 'cnc_contour' ? (
              <div className="row">
                <label>
                  Contour side
                  <select
                    value={typeof op.params?.['contourSide'] === 'string' ? op.params['contourSide'] : 'climb'}
                    onChange={(e) => {
                      const base: Record<string, unknown> = { ...(op.params ?? {}) }
                      base.contourSide = e.target.value === 'conventional' ? 'conventional' : 'climb'
                      onUpdateOp(i, { params: base })
                    }}
                  >
                    <option value="climb">Climb</option>
                    <option value="conventional">Conventional</option>
                  </select>
                </label>
                <label>
                  Lead-in (mm)
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={cutParamFieldValue(op, 'leadInMm')}
                    onChange={(e) => onSetCutParam(i, 'leadInMm', e.target.value, 'nonnegative')}
                    placeholder="0"
                  />
                </label>
                <label>
                  Lead-out (mm)
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={cutParamFieldValue(op, 'leadOutMm')}
                    onChange={(e) => onSetCutParam(i, 'leadOutMm', e.target.value, 'nonnegative')}
                    placeholder="0"
                  />
                </label>
                <label title="Linear: straight tangent approach. Arc: quarter-circle G2/G3 tangential entry/exit for reduced tool deflection.">
                  Lead mode
                  <select
                    value={typeof op.params?.['leadInMode'] === 'string' ? op.params['leadInMode'] : 'linear'}
                    onChange={(e) => {
                      const base: Record<string, unknown> = { ...(op.params ?? {}) }
                      base.leadInMode = e.target.value === 'arc' ? 'arc' : 'linear'
                      base.leadOutMode = e.target.value === 'arc' ? 'arc' : 'linear'
                      onUpdateOp(i, { params: base })
                    }}
                  >
                    <option value="linear">Linear</option>
                    <option value="arc">Arc (G2/G3)</option>
                  </select>
                </label>
                <label title="When Z pass / slice step is negative, optional step-down between full contour passes (mm).">
                  Z step-down (mm, optional)
                  <input
                    type="number"
                    min={0.01}
                    step={0.1}
                    value={cutParamFieldValue(op, 'zStepMm')}
                    onChange={(e) => onSetCutParam(i, 'zStepMm', e.target.value, 'positive')}
                    placeholder="single pass if empty"
                  />
                </label>
              </div>
            ) : null}
            {op.kind === 'cnc_pocket' ? (
              <div className="row">
                <label>
                  Z step-down (mm)
                  <input
                    type="number"
                    min={0.01}
                    step={0.1}
                    value={cutParamFieldValue(op, 'zStepMm')}
                    onChange={(e) => onSetCutParam(i, 'zStepMm', e.target.value, 'positive')}
                    placeholder="= Z pass depth"
                  />
                </label>
                <label title="Clearing pattern. Raster: parallel zig-zag rows (legacy default). Offset spiral: successive concentric insets of (outer - islands) traced inside-out, with a safe-Z lift between every loop.">
                  Clearing strategy
                  <select
                    value={op.params?.['pocketStrategy'] === 'offset_spiral' ? 'offset_spiral' : 'raster'}
                    onChange={(e) => {
                      const base: Record<string, unknown> = { ...(op.params ?? {}) }
                      base.pocketStrategy = e.target.value === 'offset_spiral' ? 'offset_spiral' : 'raster'
                      onUpdateOp(i, { params: base })
                    }}
                  >
                    <option value="raster">Raster (zig-zag)</option>
                    <option value="offset_spiral">Offset spiral (concentric)</option>
                  </select>
                </label>
                <label>
                  Entry mode
                  <select
                    value={typeof op.params?.['entryMode'] === 'string' ? op.params['entryMode'] : 'plunge'}
                    onChange={(e) => {
                      const base: Record<string, unknown> = { ...(op.params ?? {}) }
                      base.entryMode = e.target.value === 'ramp' ? 'ramp' : 'plunge'
                      onUpdateOp(i, { params: base })
                    }}
                  >
                    <option value="plunge">Plunge</option>
                    <option value="ramp">Ramp</option>
                  </select>
                </label>
                <label>
                  Ramp length (mm)
                  <input
                    type="number"
                    min={0.01}
                    step={0.1}
                    value={cutParamFieldValue(op, 'rampMm')}
                    onChange={(e) => onSetCutParam(i, 'rampMm', e.target.value, 'positive')}
                    placeholder="2"
                  />
                </label>
                {op.params?.['entryMode'] === 'ramp' ? (
                  <label>
                    Ramp max angle (&deg;)
                    <input
                      type="number"
                      min={1}
                      max={89}
                      step={1}
                      value={cutParamFieldValue(op, 'rampMaxAngleDeg')}
                      onChange={(e) => onSetCutParam(i, 'rampMaxAngleDeg', e.target.value, 'positive')}
                      placeholder="45"
                      title="Max ramp angle from horizontal; XY run is lengthened within each segment when possible."
                    />
                  </label>
                ) : null}
                <label>
                  Wall stock (mm)
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={cutParamFieldValue(op, 'wallStockMm')}
                    onChange={(e) => onSetCutParam(i, 'wallStockMm', e.target.value, 'nonnegative')}
                    placeholder="0"
                  />
                </label>
                <label className="chk">
                  <input
                    type="checkbox"
                    checked={op.params?.['finishPass'] !== false}
                    onChange={(e) => {
                      const base: Record<string, unknown> = { ...(op.params ?? {}) }
                      base.finishPass = e.target.checked
                      onUpdateOp(i, { params: base })
                    }}
                  />
                  Finish contour pass
                </label>
                <label className="chk">
                  <input
                    type="checkbox"
                    checked={op.params?.['finishEachDepth'] === true}
                    onChange={(e) => {
                      const base: Record<string, unknown> = { ...(op.params ?? {}) }
                      base.finishEachDepth = e.target.checked
                      onUpdateOp(i, { params: base })
                    }}
                  />
                  Finish each depth
                </label>
                <label>
                  Finish side
                  <select
                    value={typeof op.params?.['contourSide'] === 'string' ? op.params['contourSide'] : 'climb'}
                    onChange={(e) => {
                      const base: Record<string, unknown> = { ...(op.params ?? {}) }
                      base.contourSide = e.target.value === 'conventional' ? 'conventional' : 'climb'
                      onUpdateOp(i, { params: base })
                    }}
                  >
                    <option value="climb">Climb</option>
                    <option value="conventional">Conventional</option>
                  </select>
                </label>
                <label>
                  Finish lead-in (mm)
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={cutParamFieldValue(op, 'leadInMm')}
                    onChange={(e) => onSetCutParam(i, 'leadInMm', e.target.value, 'nonnegative')}
                    placeholder="0"
                  />
                </label>
                <label>
                  Finish lead-out (mm)
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={cutParamFieldValue(op, 'leadOutMm')}
                    onChange={(e) => onSetCutParam(i, 'leadOutMm', e.target.value, 'nonnegative')}
                    placeholder="0"
                  />
                </label>
                <label title="Linear: straight tangent approach. Arc: quarter-circle G2/G3 tangential entry/exit for reduced tool deflection.">
                  Lead mode
                  <select
                    value={typeof op.params?.['leadInMode'] === 'string' ? op.params['leadInMode'] : 'linear'}
                    onChange={(e) => {
                      const base: Record<string, unknown> = { ...(op.params ?? {}) }
                      base.leadInMode = e.target.value === 'arc' ? 'arc' : 'linear'
                      base.leadOutMode = e.target.value === 'arc' ? 'arc' : 'linear'
                      onUpdateOp(i, { params: base })
                    }}
                  >
                    <option value="linear">Linear</option>
                    <option value="arc">Arc (G2/G3)</option>
                  </select>
                </label>
              </div>
            ) : null}
            {op.kind === 'cnc_vcarve' ? (
              <div className="row">
                <label title="FULL included angle of the V-bit (degrees), e.g. 60 or 90. Sets the depth-from-width: depth = clearanceRadius / tan(angle/2).">
                  V-bit angle (&deg;)
                  <input
                    type="number"
                    min={1}
                    max={179}
                    step={1}
                    value={cutParamFieldValue(op, 'vBitAngleDeg')}
                    onChange={(e) => onSetCutParam(i, 'vBitAngleDeg', e.target.value, 'positive')}
                    placeholder="90"
                  />
                </label>
                <label title="HARD depth cap (mm). The V-carve never plunges deeper than this — and is further capped to the stock thickness so the bit can't drive past the material.">
                  Max depth (mm)
                  <input
                    type="number"
                    min={0.01}
                    step={0.1}
                    value={cutParamFieldValue(op, 'maxDepthMm')}
                    onChange={(e) => onSetCutParam(i, 'maxDepthMm', e.target.value, 'positive')}
                    placeholder="from Z pass / stock"
                  />
                </label>
                <label title="Medial-axis sampling resolution (mm). Smaller = finer ridge + more moves. Defaults to a size-derived value, clamped for main-process safety.">
                  Carve resolution (mm)
                  <input
                    type="number"
                    min={0.05}
                    step={0.1}
                    value={cutParamFieldValue(op, 'stepoverMm')}
                    onChange={(e) => onSetCutParam(i, 'stepoverMm', e.target.value, 'positive')}
                    placeholder="auto"
                  />
                </label>
                <label title="Flat-bottom (prism) carving: where the carve saturates Max depth, a second chained pass clears the flat floor at -Max depth using this raster stepover (mm), plus a rim finish joining floor to V-walls. Leave empty for V-walls only.">
                  Flat-bottom clearance (mm)
                  <input
                    type="number"
                    min={0.01}
                    step={0.1}
                    value={cutParamFieldValue(op, 'flatBottomClearance')}
                    onChange={(e) => onSetCutParam(i, 'flatBottomClearance', e.target.value, 'positive')}
                    placeholder="none (V-walls only)"
                  />
                </label>
              </div>
            ) : null}
            {op.kind === 'cnc_vcarve' ? (
              <p className="msg manufacture-op-hint">
                <strong>V-carve (medial-axis, variable depth):</strong> from a closed <strong>contourPoints</strong> loop the
                engine solves a ridge; at each point the carve depth follows the local half-width (deepest where the shape is
                widest, running out to zero at narrow tips) for the chosen V-bit angle. Depth is HARD-capped to
                <strong> Max depth</strong> and to the stock thickness, so the bit never plunges past the material. Routes through
                the same 2D post (<code>vcarve_mach3.hbs</code> for the Laguna). Output is unverified until post/machine checks (
                <code>docs/MACHINES.md</code>).
              </p>
            ) : null}
            {op.kind === 'cnc_contour' || op.kind === 'cnc_pocket' || op.kind === 'cnc_vcarve' || op.kind === 'cnc_adaptive' || op.kind === 'cnc_trochoidal_hsm' ? (
              <div className="row">
                <label className="label--wide-420">
                  contourPoints JSON (Array of [x,y] mm)
                  <input
                    value={geometryJsonFieldValue(op, 'contourPoints')}
                    onChange={(e) => onSetGeometryJson(i, 'contourPoints', e.target.value)}
                    placeholder='[[0,0],[50,0],[50,25],[0,25]]'
                  />
                </label>
                <label>
                  Contour source
                  <select
                    value={typeof op.params?.['contourSourceId'] === 'string' ? op.params['contourSourceId'] : ''}
                    onChange={(e) => {
                      const base: Record<string, unknown> = { ...(op.params ?? {}) }
                      if (!e.target.value) delete base.contourSourceId
                      else base.contourSourceId = e.target.value
                      onUpdateOp(i, { params: Object.keys(base).length ? base : undefined })
                    }}
                  >
                    <option value="">first closed profile</option>
                    {contourCandidates.map((c) => (
                      <option key={c.sourceId} value={c.sourceId}>
                        {c.label} ({c.points.length} pts)
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" className="secondary" onClick={() => onLoadContourCandidates()} aria-label="Refresh available sketch profiles for contour source selection">
                  Refresh sketch profiles
                </button>
                <button type="button" className="secondary" onClick={() => onDeriveOpGeometry(i)} aria-label={`Derive contour points from sketch for ${op.label}`}>
                  Derive from sketch
                </button>
              </div>
            ) : null}
            {op.kind === 'cnc_contour' || op.kind === 'cnc_pocket' || op.kind === 'cnc_vcarve' || op.kind === 'cnc_adaptive' || op.kind === 'cnc_trochoidal_hsm' ? (
              (() => {
                const s = contourPointsStats(op.params?.['contourPoints'])
                return s ? <p className="msg msg--muted">{s}</p> : null
              })()
            ) : null}
            {op.kind === 'cnc_contour' || op.kind === 'cnc_pocket' || op.kind === 'cnc_vcarve' || op.kind === 'cnc_adaptive' || op.kind === 'cnc_trochoidal_hsm' ? (
              (() => {
                const sourceId = typeof op.params?.['contourSourceId'] === 'string' ? op.params['contourSourceId'] : ''
                const sig = typeof op.params?.['contourSourceSignature'] === 'string' ? op.params['contourSourceSignature'] : ''
                if (!sourceId || !sig) return null
                const cur = contourCandidates.find((c) => c.sourceId === sourceId)
                if (!cur) {
                  return (
                    <p className="msg manufacture-op-hint">
                      Selected contour source is not present in current sketch; derive again or choose a different profile.
                      <button type="button" className="secondary ml-2" onClick={() => onDeriveOpGeometry(i)} aria-label={`Re-derive contour geometry for ${op.label}`}>
                        Re-derive now
                      </button>
                    </p>
                  )
                }
                if (cur.signature !== sig) {
                  return (
                    <p className="msg manufacture-op-hint">
                      Selected contour profile changed since last derive ({cur.label}). Re-derive to keep CAM geometry in sync.
                      <button type="button" className="secondary ml-2" onClick={() => onDeriveOpGeometry(i)} aria-label={`Re-derive stale contour geometry for ${op.label}`}>
                        Re-derive now
                      </button>
                    </p>
                  )
                }
                return null
              })()
            ) : null}
            {op.kind === 'cnc_contour' || op.kind === 'cnc_pocket' || op.kind === 'cnc_vcarve' || op.kind === 'cnc_adaptive' || op.kind === 'cnc_trochoidal_hsm' ? (
              (() => {
                const derivedAt = typeof op.params?.['contourDerivedAt'] === 'string' ? op.params['contourDerivedAt'] : ''
                if (!derivedAt) return null
                return <p className="msg">Contour derived: {formatDerivedAt(derivedAt, nowTickMs)}</p>
              })()
            ) : null}
            {op.kind === 'cnc_contour' || op.kind === 'cnc_pocket' ? (
              <p className="msg manufacture-op-hint">
                <strong>2D contour / pocket:</strong> toolpath XY follows a closed <strong>contourPoints</strong> loop in
                setup WCS; depth and feeds use the cut parameters on this row. Tool diameter must fit inside pockets &mdash;
                offset failures return an empty toolpath with a hint. <strong>Pocket</strong> ramp mode may add CAM hints when
                segments are short for the ramp angle. Output is unverified until post/machine checks (
                <code>docs/MACHINES.md</code>).
              </p>
            ) : null}
            {op.kind === 'cnc_drill' ? (
              <p className="msg manufacture-op-hint">
                <strong>Machine-aware cycles:</strong>{' '}
                {camMachine ? (
                  <>
                    first matching setup uses <strong>{camMachine.name}</strong> (<code>{camMachine.dialect}</code>).{' '}
                    {camMachine.dialect === 'grbl' ? (
                      <>
                        Grbl defaults to <strong>expanded</strong> G0/G1 drill moves unless you pick a canned cycle; many
                        Grbl builds omit G81&ndash;G83.
                      </>
                    ) : camMachine.dialect === 'mach3' ? (
                      <>
                        Mach-class posts usually emit <strong>G81</strong>/<strong>G82</strong>/<strong>G83</strong> when
                        params match; set <strong>Peck Q</strong> for G83 and <strong>Dwell P</strong> for G82.
                      </>
                    ) : (
                      <>
                        Generic mm post follows the cycle override or auto-selects from peck/dwell; verify R/Q/P on your
                        controller.
                      </>
                    )}
                  </>
                ) : (
                  <>Add a setup with a CNC machine so cycle defaults match your post.</>
                )}{' '}
                <strong>Depth</strong> is <code>zPassMm</code>; <strong>R</strong> uses <code>retractMm</code> or falls back
                to <code>safeZMm</code>.
              </p>
            ) : null}
            {op.kind === 'cnc_drill' ? (
              <div className="row">
                <label className="label--wide-420">
                  drillPoints JSON (Array of [x,y] mm)
                  <input
                    value={geometryJsonFieldValue(op, 'drillPoints')}
                    onChange={(e) => onSetGeometryJson(i, 'drillPoints', e.target.value)}
                    placeholder='[[10,10],[40,10],[40,30]]'
                  />
                </label>
                <button type="button" className="secondary" onClick={() => onDeriveOpGeometry(i)} aria-label={`Derive drill points from sketch circles for ${op.label}`}>
                  Derive from sketch circles
                </button>
                <label>
                  Drill cycle
                  <select
                    value={typeof op.params?.['drillCycle'] === 'string' ? op.params['drillCycle'] : ''}
                    onChange={(e) => {
                      const base: Record<string, unknown> = { ...(op.params ?? {}) }
                      if (!e.target.value) delete base.drillCycle
                      else base.drillCycle = e.target.value
                      onUpdateOp(i, { params: Object.keys(base).length ? base : undefined })
                    }}
                  >
                    <option value="">machine default</option>
                    <option value="expanded">expanded (G0/G1)</option>
                    <option value="g73">G73 High-Speed Peck</option>
                    <option value="g81">G81</option>
                    <option value="g82">G82 dwell</option>
                    <option value="g83">G83 peck</option>
                  </select>
                </label>
                <label>
                  Drill retract R (mm)
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={cutParamFieldValue(op, 'retractMm')}
                    onChange={(e) => onSetCutParam(i, 'retractMm', e.target.value, 'positive')}
                    placeholder="safe Z"
                  />
                </label>
                <label>
                  Peck Q (mm, G73/G83)
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={cutParamFieldValue(op, 'peckMm')}
                    onChange={(e) => onSetCutParam(i, 'peckMm', e.target.value, 'positive')}
                    placeholder="optional"
                  />
                </label>
                <label>
                  Dwell P (ms, G82)
                  <input
                    type="number"
                    min={0}
                    step={10}
                    value={cutParamFieldValue(op, 'dwellMs')}
                    onChange={(e) => onSetCutParam(i, 'dwellMs', e.target.value, 'positive')}
                    placeholder="optional"
                  />
                </label>
              </div>
            ) : null}
            {op.kind === 'cnc_drill' ? (
              <p className="msg manufacture-op-hint">
                <strong>Drill cycles:</strong> Make tab <strong>Generate CAM</strong> merges cycle hints (auto G81/G82/G83
                vs explicit override, peck/dwell fallbacks). Peck depth <strong>Q</strong> must be set for G73/G83; dwell{' '}
                <strong>P</strong> for G82. G-code stays unverified until post/machine checks (<code>docs/MACHINES.md</code>
                ).
              </p>
            ) : null}
            {op.kind === 'cnc_drill' ? (
              (() => {
                const derivedAt = typeof op.params?.['drillDerivedAt'] === 'string' ? op.params['drillDerivedAt'] : ''
                if (!derivedAt) return null
                return <p className="msg">Drill points derived: {formatDerivedAt(derivedAt, nowTickMs)}</p>
              })()
            ) : null}
            {/* -- Post-Processing Options (CNC ops only) -- */}
            {cncOp(op.kind) ? (
              <details className="post-processing-options">
                <summary className="post-processing-options__summary">Post-Processing Options</summary>
                <div className="post-processing-options__body">
                  {/* Arc fitting */}
                  <div className="post-processing-options__row">
                    <label className="chk">
                      <input
                        type="checkbox"
                        checked={op.params?.['enableArcFitting'] === true}
                        onChange={(e) => {
                          const base: Record<string, unknown> = { ...(op.params ?? {}) }
                          if (e.target.checked) base.enableArcFitting = true
                          else { delete base.enableArcFitting; delete base.arcTolerance }
                          onUpdateOp(i, { params: Object.keys(base).length ? base : undefined })
                        }}
                      />
                      Enable arc fitting (G2/G3)
                    </label>
                    {op.params?.['enableArcFitting'] === true ? (
                      <label title="Maximum deviation from fitted arc (mm). Lower = tighter arcs, larger file.">
                        Arc tolerance (mm)
                        <input
                          type="number"
                          min={0.001}
                          max={1}
                          step={0.001}
                          value={typeof op.params?.['arcTolerance'] === 'number' ? String(op.params['arcTolerance']) : ''}
                          onChange={(e) => {
                            const base: Record<string, unknown> = { ...(op.params ?? {}) }
                            const v = e.target.value.trim()
                            if (!v) delete base.arcTolerance
                            else {
                              const n = Number.parseFloat(v)
                              if (Number.isFinite(n) && n > 0) base.arcTolerance = n
                            }
                            onUpdateOp(i, { params: Object.keys(base).length ? base : undefined })
                          }}
                          placeholder="0.01"
                        />
                      </label>
                    ) : null}
                  </div>
                  {/* Cutter compensation */}
                  <div className="post-processing-options__row">
                    <label title="G41 (climb) / G42 (conventional) cutter compensation. Controller uses stored tool diameter or D-register.">
                      Cutter compensation
                      <select
                        value={typeof op.params?.['cutterCompensation'] === 'string' ? op.params['cutterCompensation'] : 'none'}
                        onChange={(e) => {
                          const base: Record<string, unknown> = { ...(op.params ?? {}) }
                          const v = e.target.value
                          if (v === 'none') { delete base.cutterCompensation; delete base.cutterCompDRegister }
                          else base.cutterCompensation = v
                          onUpdateOp(i, { params: Object.keys(base).length ? base : undefined })
                        }}
                      >
                        <option value="none">None</option>
                        <option value="left">Left (G41 &mdash; climb)</option>
                        <option value="right">Right (G42 &mdash; conventional)</option>
                      </select>
                    </label>
                    {op.params?.['cutterCompensation'] === 'left' || op.params?.['cutterCompensation'] === 'right' ? (
                      <label title="D-register number for wear offset (G41 D<n> / G42 D<n>). Leave blank to use active tool diameter.">
                        D register
                        <input
                          type="number"
                          min={1}
                          max={99}
                          step={1}
                          value={typeof op.params?.['cutterCompDRegister'] === 'number' ? String(op.params['cutterCompDRegister']) : ''}
                          onChange={(e) => {
                            const base: Record<string, unknown> = { ...(op.params ?? {}) }
                            const v = e.target.value.trim()
                            if (!v) delete base.cutterCompDRegister
                            else {
                              const n = Number.parseInt(v, 10)
                              if (Number.isFinite(n) && n >= 1) base.cutterCompDRegister = n
                            }
                            onUpdateOp(i, { params: Object.keys(base).length ? base : undefined })
                          }}
                          placeholder="(active tool)"
                        />
                      </label>
                    ) : null}
                  </div>
                  {/* Subroutines */}
                  <div className="post-processing-options__row">
                    <label className="chk">
                      <input
                        type="checkbox"
                        checked={op.params?.['enableSubroutines'] === true}
                        onChange={(e) => {
                          const base: Record<string, unknown> = { ...(op.params ?? {}) }
                          if (e.target.checked) { base.enableSubroutines = true; if (!base.subroutineDialect) base.subroutineDialect = 'fanuc' }
                          else { delete base.enableSubroutines; delete base.subroutineDialect }
                          onUpdateOp(i, { params: Object.keys(base).length ? base : undefined })
                        }}
                      />
                      Enable subroutines
                    </label>
                    {op.params?.['enableSubroutines'] === true ? (
                      <label title="Controller dialect for subroutine call/define syntax.">
                        Dialect
                        <select
                          value={typeof op.params?.['subroutineDialect'] === 'string' ? op.params['subroutineDialect'] : 'fanuc'}
                          onChange={(e) => {
                            const base: Record<string, unknown> = { ...(op.params ?? {}) }
                            base.subroutineDialect = e.target.value
                            onUpdateOp(i, { params: base })
                          }}
                        >
                          <option value="fanuc">Fanuc</option>
                          <option value="siemens">Siemens</option>
                          <option value="mach3">Mach3</option>
                        </select>
                      </label>
                    ) : null}
                  </div>
                  {/* Line numbering */}
                  <div className="post-processing-options__row">
                    <label className="chk">
                      <input
                        type="checkbox"
                        checked={op.params?.['lineNumberingEnabled'] === true}
                        onChange={(e) => {
                          const base: Record<string, unknown> = { ...(op.params ?? {}) }
                          if (e.target.checked) { base.lineNumberingEnabled = true; if (base.lineNumberingStart == null) base.lineNumberingStart = 10; if (base.lineNumberingIncrement == null) base.lineNumberingIncrement = 10 }
                          else { delete base.lineNumberingEnabled; delete base.lineNumberingStart; delete base.lineNumberingIncrement }
                          onUpdateOp(i, { params: Object.keys(base).length ? base : undefined })
                        }}
                      />
                      Line numbering (N-words)
                    </label>
                    {op.params?.['lineNumberingEnabled'] === true ? (
                      <>
                        <label>
                          Start
                          <input
                            type="number"
                            min={1}
                            step={1}
                            value={typeof op.params?.['lineNumberingStart'] === 'number' ? String(op.params['lineNumberingStart']) : ''}
                            onChange={(e) => {
                              const base: Record<string, unknown> = { ...(op.params ?? {}) }
                              const v = e.target.value.trim()
                              if (!v) delete base.lineNumberingStart
                              else {
                                const n = Number.parseInt(v, 10)
                                if (Number.isFinite(n) && n >= 1) base.lineNumberingStart = n
                              }
                              onUpdateOp(i, { params: Object.keys(base).length ? base : undefined })
                            }}
                            placeholder="10"
                          />
                        </label>
                        <label>
                          Increment
                          <input
                            type="number"
                            min={1}
                            step={1}
                            value={typeof op.params?.['lineNumberingIncrement'] === 'number' ? String(op.params['lineNumberingIncrement']) : ''}
                            onChange={(e) => {
                              const base: Record<string, unknown> = { ...(op.params ?? {}) }
                              const v = e.target.value.trim()
                              if (!v) delete base.lineNumberingIncrement
                              else {
                                const n = Number.parseInt(v, 10)
                                if (Number.isFinite(n) && n >= 1) base.lineNumberingIncrement = n
                              }
                              onUpdateOp(i, { params: Object.keys(base).length ? base : undefined })
                            }}
                            placeholder="10"
                          />
                        </label>
                      </>
                    ) : null}
                  </div>
                  {/* Inverse-time feed -- only for 4/5-axis ops */}
                  {op.kind.includes('4axis') || op.kind.includes('5axis') ? (
                    <div className="post-processing-options__row">
                      <label className="chk">
                        <input
                          type="checkbox"
                          checked={op.params?.['inverseTimeFeed'] === true}
                          onChange={(e) => {
                            const base: Record<string, unknown> = { ...(op.params ?? {}) }
                            if (e.target.checked) base.inverseTimeFeed = true
                            else delete base.inverseTimeFeed
                            onUpdateOp(i, { params: Object.keys(base).length ? base : undefined })
                          }}
                        />
                        G93 inverse-time feed
                      </label>
                    </div>
                  ) : null}
                  {/* [ID-0064] Dust collection -- per-job opt-in for posts that wire M7/M9 */}
                  {/* (Laguna Swift 5x10 vcarve_mach3.hbs today: emits M7 after spindle warm-up */}
                  {/* and M9 before spindle-off when set; otherwise commented reminders only). */}
                  <div className="post-processing-options__row">
                    <label
                      className="chk"
                      title="Emit M7 (dust collection ON) after spindle warm-up and M9 (OFF) before spindle-off. Currently honored by the Laguna Swift 5x10 RichAuto post (vcarve_mach3.hbs); other posts ignore the flag and emit commented reminders only."
                    >
                      <input
                        type="checkbox"
                        checked={op.params?.['dustCollection'] === true}
                        onChange={(e) => {
                          const base: Record<string, unknown> = { ...(op.params ?? {}) }
                          if (e.target.checked) base.dustCollection = true
                          else delete base.dustCollection
                          onUpdateOp(i, { params: Object.keys(base).length ? base : undefined })
                        }}
                      />
                      Dust collection (M7/M9)
                    </label>
                  </div>
                  {/* [ID-0013-integration] Manual tool change -- ATC opt-out for the */}
                  {/* Makera Carvera 3-axis post. Default off (ATC mode); checking the box */}
                  {/* sets manualToolChange=true which suppresses M6 + G43 emission and */}
                  {/* emits a manual-change reminder block instead. No-op on non-Carvera-3 posts. */}
                  {!op.kind.includes('4axis') && !op.kind.includes('5axis') ? (
                    <div className="post-processing-options__row">
                      <label
                        className="chk"
                        title="Suppress automatic tool change (M6 T<n> + G43 H<n>) on Carvera 3-axis. Use for diagnostic / single-tool jobs where the tool is already loaded. Default off (ATC enabled)."
                      >
                        <input
                          type="checkbox"
                          checked={op.params?.['manualToolChange'] === true}
                          onChange={(e) => {
                            const base: Record<string, unknown> = { ...(op.params ?? {}) }
                            if (e.target.checked) base.manualToolChange = true
                            else delete base.manualToolChange
                            onUpdateOp(i, { params: Object.keys(base).length ? base : undefined })
                          }}
                        />
                        Manual tool change (suppress ATC M6/G43)
                      </label>
                    </div>
                  ) : null}
                  {/* [ID-0015] Simultaneous 4-axis -- UNVERIFIED community-firmware opt-in */}
                  {/* for cnc_4axis_continuous. Default off; checking adds a prominent */}
                  {/* warning header to the emitted G-code acknowledging the opt-in. */}
                  {op.kind === 'cnc_4axis_continuous' ? (
                    <div className="post-processing-options__row">
                      <label
                        className="chk"
                        title="Acknowledge that simultaneous 4-axis moves (XYZ + A blended in a single G1 block) require community firmware on the Carvera. Adds a prominent UNVERIFIED warning block to the G-code header. Default off."
                      >
                        <input
                          type="checkbox"
                          checked={op.params?.['enableSimultaneous4Axis'] === true}
                          onChange={(e) => {
                            const base: Record<string, unknown> = { ...(op.params ?? {}) }
                            if (e.target.checked) base.enableSimultaneous4Axis = true
                            else delete base.enableSimultaneous4Axis
                            onUpdateOp(i, { params: Object.keys(base).length ? base : undefined })
                          }}
                        />
                        Simultaneous 4-axis (UNVERIFIED -- community firmware required)
                      </label>
                    </div>
                  ) : null}
                </div>
              </details>
            ) : null}
          </li>
                    )
                  })}
                </ul>
            </details>
          )
        })}
      </div>
    </>
  )
}
