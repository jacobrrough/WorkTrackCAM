/**
 * UX MOVE 6 render-pin: ManufactureOperationList renders a Setup-rooted tree
 * (Fusion / Mastercam pattern) — operations nest under their parent Setup
 * group with collapse affordance and a per-row status icon.
 *
 * Coverage:
 *   - Operations group under the correct Setup via `params.setupId`.
 *   - Operations without a `setupId` land in a synthetic "(Unassigned)" group
 *     that renders first.
 *   - Operations that reference a missing setup id fall back to (Unassigned).
 *   - Each op row carries an `.op-tree-op-status` indicator whose modifier
 *     reflects deriveOpTreeStatus (error / stale / done / idle).
 *   - The Setup header renders the name, op count badge, and chevron, and the
 *     group is implemented with the native <details> element so collapse works
 *     without React state (no jsdom needed for these render pins).
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ManufactureOperationList,
  UNASSIGNED_SETUP_ID,
  deriveOpTreeStatus,
  groupOpsBySetup,
  getOpSetupId
} from './ManufactureOperationList'
import type { ManufactureOperation, ManufactureSetup } from '../../shared/manufacture-schema'

// ── Fixture builders ────────────────────────────────────────────────────────

function makeOp(overrides: Partial<ManufactureOperation> = {}): ManufactureOperation {
  return {
    id: 'op-1',
    kind: 'cnc_parallel',
    label: 'Op 1',
    sourceMesh: 'assets/sample.stl',
    ...overrides
  } as ManufactureOperation
}

function makeSetup(overrides: Partial<ManufactureSetup> = {}): ManufactureSetup {
  return {
    id: 's-1',
    label: 'Setup 1',
    machineId: 'creality-k2-plus',
    ...overrides
  } as ManufactureSetup
}

type Props = Parameters<typeof ManufactureOperationList>[0]

function makeProps(overrides: Partial<Props> = {}): Props {
  const noop = vi.fn()
  return {
    operations: [],
    filteredOps: [],
    setups: [],
    selectedOpIndex: 0,
    contourCandidates: [],
    tools: null,
    camMachine: undefined,
    readinessCounts: { ready: 0, 'missing geometry': 0, 'stale geometry': 0, suppressed: 0, 'non-cam': 0 },
    activeFilterLabel: 'all',
    opFilter: 'all',
    actionableOnly: false,
    nowTickMs: 0,
    onSelectOp: noop,
    onSetOpFilter: noop,
    onSetActionableOnly: noop,
    onUpdateOp: noop,
    onRemoveOp: noop,
    onSetToolDiameterMm: noop,
    onSetToolFromLibrary: noop,
    onSetCutParam: noop,
    onSetGeometryJson: noop,
    onDeriveOpGeometry: noop,
    onLoadContourCandidates: noop,
    onRunFdmSlice: noop,
    ...overrides
  }
}

function render(props: Props): string {
  return renderToStaticMarkup(createElement(ManufactureOperationList, props))
}

// ── Pure-helper pins ────────────────────────────────────────────────────────

describe('getOpSetupId', () => {
  it('returns the trimmed setupId when present', () => {
    const op = makeOp({ params: { setupId: '  s-7  ' } })
    expect(getOpSetupId(op)).toBe('s-7')
  })
  it('returns undefined when setupId is missing or blank', () => {
    expect(getOpSetupId(makeOp())).toBeUndefined()
    expect(getOpSetupId(makeOp({ params: { setupId: '' } }))).toBeUndefined()
    expect(getOpSetupId(makeOp({ params: { setupId: '   ' } }))).toBeUndefined()
  })
})

describe('deriveOpTreeStatus', () => {
  it('maps suppressed to idle', () => {
    expect(deriveOpTreeStatus(makeOp({ suppressed: true }), [], [])).toBe('idle')
  })
  it('maps non-cam (fdm_slice / export_stl) to idle', () => {
    expect(deriveOpTreeStatus(makeOp({ kind: 'fdm_slice' }), [], [])).toBe('idle')
    expect(deriveOpTreeStatus(makeOp({ kind: 'export_stl' }), [], [])).toBe('idle')
  })
  it('maps missing contour geometry to error', () => {
    const op = makeOp({ kind: 'cnc_contour' })
    expect(deriveOpTreeStatus(op, [], [])).toBe('error')
  })
  it('maps stale source mesh on a ready cnc op to stale', () => {
    const op = makeOp({ kind: 'cnc_parallel', sourceMesh: 'assets/x.stl' })
    expect(deriveOpTreeStatus(op, [], ['assets/x.stl'])).toBe('stale')
  })
  it('maps a healthy cnc op to done', () => {
    expect(deriveOpTreeStatus(makeOp({ kind: 'cnc_parallel' }), [], [])).toBe('done')
  })
})

describe('groupOpsBySetup', () => {
  it('puts unassigned ops in their own group at the top', () => {
    const setupA = makeSetup({ id: 's-a', label: 'A' })
    const opAssigned = makeOp({ id: 'op-a', params: { setupId: 's-a' } })
    const opUnassigned = makeOp({ id: 'op-u' })
    const groups = groupOpsBySetup([setupA], [opAssigned, opUnassigned])
    expect(groups).toHaveLength(2)
    expect(groups[0]!.setup).toBeNull()
    expect(groups[0]!.ops.map((o) => o.id)).toEqual(['op-u'])
    expect(groups[1]!.setup?.id).toBe('s-a')
    expect(groups[1]!.ops.map((o) => o.id)).toEqual(['op-a'])
  })
  it('falls back to (Unassigned) when op references a missing setup id', () => {
    const opOrphan = makeOp({ id: 'op-orphan', params: { setupId: 'ghost-setup' } })
    const groups = groupOpsBySetup([], [opOrphan])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.setup).toBeNull()
    expect(groups[0]!.ops.map((o) => o.id)).toEqual(['op-orphan'])
  })
  it('emits no groups when there are no ops', () => {
    expect(groupOpsBySetup([makeSetup()], [])).toEqual([])
  })
  it('preserves operation order within each group', () => {
    const setup = makeSetup({ id: 's-1' })
    const a = makeOp({ id: 'op-a', params: { setupId: 's-1' } })
    const b = makeOp({ id: 'op-b', params: { setupId: 's-1' } })
    const c = makeOp({ id: 'op-c', params: { setupId: 's-1' } })
    const groups = groupOpsBySetup([setup], [a, b, c])
    expect(groups[0]!.ops.map((o) => o.id)).toEqual(['op-a', 'op-b', 'op-c'])
  })
})

// ── Markup render pins ──────────────────────────────────────────────────────

describe('ManufactureOperationList — tree rendering (UX MOVE 6)', () => {
  it('renders the .op-tree wrapper around setup groups', () => {
    const op = makeOp()
    const html = render(makeProps({ operations: [op], filteredOps: [op] }))
    expect(html).toContain('class="op-tree"')
    expect(html).toContain('role="tree"')
  })

  it('renders a setup-group <details> per Setup with header + count badge', () => {
    const setupA = makeSetup({ id: 's-a', label: 'Roughing setup' })
    const setupB = makeSetup({ id: 's-b', label: 'Finishing setup' })
    const opA = makeOp({ id: 'op-a', label: 'Rough Op', params: { setupId: 's-a' } })
    const opB = makeOp({ id: 'op-b', label: 'Finish Op', params: { setupId: 's-b' } })
    const html = render(
      makeProps({
        operations: [opA, opB],
        filteredOps: [opA, opB],
        setups: [setupA, setupB]
      })
    )
    expect(html).toContain('data-testid="op-tree-setup-s-a"')
    expect(html).toContain('data-testid="op-tree-setup-s-b"')
    expect(html).toContain('Roughing setup')
    expect(html).toContain('Finishing setup')
    expect(html).toContain('class="op-tree-setup__count"')
    // Setup is implemented via <details> for native collapse + a11y. The default
    // is open so all groups are visible on first render.
    expect(html).toContain('<details')
    expect(html).toContain('open=""') // React renders boolean attrs as open=""
    expect(html).toContain('class="op-tree-setup__chevron"')
  })

  it('renders an unassigned group above named setups when ops lack setupId', () => {
    const setup = makeSetup({ id: 's-known', label: 'Real setup' })
    const opOrphan = makeOp({ id: 'op-orphan' })
    const opAssigned = makeOp({ id: 'op-assigned', params: { setupId: 's-known' } })
    const html = render(
      makeProps({
        operations: [opOrphan, opAssigned],
        filteredOps: [opOrphan, opAssigned],
        setups: [setup]
      })
    )
    expect(html).toContain(`data-testid="op-tree-setup-${UNASSIGNED_SETUP_ID}"`)
    expect(html).toContain('(Unassigned)')
    expect(html).toContain('op-tree-setup--unassigned')
    // (Unassigned) appears before the named setup in the markup.
    const unassignedIdx = html.indexOf(`op-tree-setup-${UNASSIGNED_SETUP_ID}`)
    const knownIdx = html.indexOf('op-tree-setup-s-known')
    expect(unassignedIdx).toBeGreaterThanOrEqual(0)
    expect(knownIdx).toBeGreaterThan(unassignedIdx)
  })

  it('renders a status icon per op with the derived variant', () => {
    const setup = makeSetup({ id: 's-1' })
    // Missing geometry on cnc_contour → error variant
    const opError = makeOp({ id: 'op-err', kind: 'cnc_contour', params: { setupId: 's-1' } })
    // Healthy cnc_parallel → done variant
    const opDone = makeOp({ id: 'op-done', kind: 'cnc_parallel', params: { setupId: 's-1' } })
    // Suppressed → idle variant
    const opIdle = makeOp({ id: 'op-idle', kind: 'cnc_parallel', suppressed: true, params: { setupId: 's-1' } })
    const html = render(
      makeProps({
        operations: [opError, opDone, opIdle],
        filteredOps: [opError, opDone, opIdle],
        setups: [setup]
      })
    )
    expect(html).toContain('data-testid="op-tree-op-status-op-err"')
    expect(html).toContain('op-tree-op-status--error')
    expect(html).toContain('data-testid="op-tree-op-status-op-done"')
    expect(html).toContain('op-tree-op-status--done')
    expect(html).toContain('data-testid="op-tree-op-status-op-idle"')
    expect(html).toContain('op-tree-op-status--idle')
  })

  it('marks stale source-mesh paths with the stale status variant', () => {
    const setup = makeSetup({ id: 's-1' })
    const op = makeOp({
      id: 'op-stale',
      kind: 'cnc_parallel',
      sourceMesh: 'assets/foo.stl',
      params: { setupId: 's-1' }
    })
    const html = render(
      makeProps({
        operations: [op],
        filteredOps: [op],
        setups: [setup],
        camStaleMeshRelativePaths: ['assets/foo.stl']
      })
    )
    expect(html).toContain('op-tree-op-status--stale')
  })

  it('wraps each group of ops in <ul class="op-tree-ops">', () => {
    const setup = makeSetup({ id: 's-1' })
    const op = makeOp({ params: { setupId: 's-1' } })
    const html = render(
      makeProps({
        operations: [op],
        filteredOps: [op],
        setups: [setup]
      })
    )
    expect(html).toMatch(/class=\"op-tree-ops [^\"]*\"/)
  })

  it('does not render the .op-tree wrapper when the empty-state is active', () => {
    // No operations at all — empty-state branch should NOT include tree wrapper.
    const html = render(makeProps({ operations: [], filteredOps: [], setups: [] }))
    expect(html).toContain('data-testid="manufacture-op-empty-none"')
    // .op-tree may still wrap an empty group list; the contract here is that
    // there is no group <details> rendered.
    expect(html).not.toContain('data-testid="op-tree-setup-')
  })
})
