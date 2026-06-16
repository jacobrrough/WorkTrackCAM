/**
 * CAM ENHANCE render-pin: the Cycle-263 true-arc engine knob (`arcTolMm`, read by
 * `resolveArcFitOptions`) is now reachable from the op editor as an "Output arcs
 * (G2/G3)" toggle + tolerance field.
 *
 * Honesty contract pinned here:
 *   - The toggle is ROUTER-ONLY. It appears for `cnc_contour` / `cnc_pocket` when
 *     the resolved CAM machine is a router whose post emits circular interpolation
 *     (Laguna mach3 / Carvera-3 smoothieware), and is ABSENT for the K2 Plus FDM
 *     controller (generic_mm), for non-contour/pocket kinds, and when no CNC
 *     machine is resolved.
 *   - Enabling the toggle stamps a sane default `arcTolMm`; disabling clears
 *     `arcTolMm` (and the optional `arcMinSweepDeg` refinement).
 *   - The tolerance field only renders once arcs are enabled.
 *
 * Like the sibling empty-state / tree pins, this runs in the vitest `node`
 * environment via `react-dom/server` (markup pins) plus a virtual-DOM walk that
 * captures the `onChange` handlers and invokes them directly (no jsdom).
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ManufactureOperationList } from './ManufactureOperationList'
import {
  machineSupportsArcOutput,
  ARC_OUTPUT_DEFAULT_TOL_MM,
  ARC_OUTPUT_CAPABLE_DIALECTS
} from './manufacture-op-helpers'
import type { ManufactureOperation } from '../../shared/manufacture-schema'
import type { MachineProfile } from '../../shared/machine-schema'

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeOp(overrides: Partial<ManufactureOperation> = {}): ManufactureOperation {
  return {
    id: 'op-1',
    kind: 'cnc_contour',
    label: 'Contour Op',
    sourceMesh: 'assets/sample.stl',
    // contourPoints present so the op is "ready" rather than missing-geometry
    // (the arc row is independent of readiness, but this keeps the fixture sane).
    params: { contourPoints: [[0, 0], [50, 0], [50, 25], [0, 25]] },
    ...overrides
  } as ManufactureOperation
}

/** Minimal-but-valid MachineProfile shapes for the three target machines. */
function makeMachine(overrides: Partial<MachineProfile> = {}): MachineProfile {
  return {
    id: 'm-test',
    name: 'Test Machine',
    kind: 'cnc',
    workAreaMm: { x: 1524, y: 3048, z: 200 },
    maxFeedMmMin: 12000,
    postTemplate: 'vcarve_mach3.hbs',
    dialect: 'mach3',
    ...overrides
  } as MachineProfile
}

const LAGUNA = makeMachine({ id: 'laguna-swift-5x10', name: 'Laguna Swift 5x10', kind: 'cnc', dialect: 'mach3' })
const CARVERA3 = makeMachine({
  id: 'makera-carvera-3axis',
  name: 'Makera Carvera 3-axis',
  kind: 'cnc',
  dialect: 'smoothieware',
  workAreaMm: { x: 360, y: 240, z: 140 }
})
const K2 = makeMachine({
  id: 'creality-k2-plus',
  name: 'Creality K2 Plus',
  kind: 'fdm',
  dialect: 'generic_mm',
  workAreaMm: { x: 350, y: 350, z: 350 },
  postTemplate: 'k2_klipper.hbs'
})

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

// Virtual-DOM walk helpers (same approach as the empty-state test) so we can
// capture and invoke onChange handlers without a DOM.
type AnyNode = { props?: { [k: string]: unknown; children?: unknown }; type?: unknown }

function findByTestId(node: unknown, id: string): AnyNode | null {
  if (!node || typeof node !== 'object') return null
  const n = node as AnyNode
  const props = n.props
  if (props && (props as Record<string, unknown>)['data-testid'] === id) return n
  const children = props?.children
  if (children == null) return null
  const list = Array.isArray(children) ? children : [children]
  for (const c of list) {
    const found = findByTestId(c, id)
    if (found) return found
  }
  return null
}

function renderTree(props: Props): React.ReactElement {
  return (ManufactureOperationList as unknown as (p: Props) => React.ReactElement)(props)
}

// ── Pure-helper pins ─────────────────────────────────────────────────────────

describe('machineSupportsArcOutput', () => {
  it('is true for the Laguna (mach3) router', () => {
    expect(machineSupportsArcOutput(LAGUNA)).toBe(true)
  })
  it('is true for the Carvera 3-axis (smoothieware) router', () => {
    expect(machineSupportsArcOutput(CARVERA3)).toBe(true)
  })
  it('is false for the K2 Plus FDM (generic_mm) controller', () => {
    expect(machineSupportsArcOutput(K2)).toBe(false)
  })
  it('is false when no machine is resolved', () => {
    expect(machineSupportsArcOutput(undefined)).toBe(false)
  })
  it('is false for a CNC machine on a 4-axis rotary dialect (engine is 3-axis only)', () => {
    expect(machineSupportsArcOutput(makeMachine({ kind: 'cnc', dialect: 'grbl_4axis' }))).toBe(false)
  })
  it('only lists mach3 + smoothieware as arc-capable dialects', () => {
    expect([...ARC_OUTPUT_CAPABLE_DIALECTS].sort()).toEqual(['mach3', 'smoothieware'])
  })
  it('uses a conservative default tolerance', () => {
    expect(ARC_OUTPUT_DEFAULT_TOL_MM).toBeGreaterThan(0)
    expect(ARC_OUTPUT_DEFAULT_TOL_MM).toBeLessThanOrEqual(0.1)
  })
})

// ── Visibility pins (markup) ─────────────────────────────────────────────────

describe('ManufactureOperationList — arc-output toggle visibility (CAM ENHANCE)', () => {
  it('shows the toggle for cnc_contour on a Laguna router', () => {
    const op = makeOp({ kind: 'cnc_contour' })
    const html = render(makeProps({ operations: [op], filteredOps: [op], camMachine: LAGUNA }))
    expect(html).toContain(`data-testid="op-arc-output-${op.id}"`)
    expect(html).toContain(`data-testid="op-arc-output-toggle-${op.id}"`)
    expect(html).toContain('Output arcs (G2/G3)')
  })

  it('shows the toggle for cnc_pocket on a Carvera 3-axis router', () => {
    const op = makeOp({ kind: 'cnc_pocket' })
    const html = render(makeProps({ operations: [op], filteredOps: [op], camMachine: CARVERA3 }))
    expect(html).toContain(`data-testid="op-arc-output-toggle-${op.id}"`)
    expect(html).toContain('Output arcs (G2/G3)')
  })

  it('HIDES the toggle for the K2 Plus FDM machine (no arc dialect)', () => {
    const op = makeOp({ kind: 'cnc_contour' })
    const html = render(makeProps({ operations: [op], filteredOps: [op], camMachine: K2 }))
    expect(html).not.toContain(`data-testid="op-arc-output-${op.id}"`)
    expect(html).not.toContain('Output arcs (G2/G3)')
  })

  it('HIDES the toggle when no CAM machine is resolved', () => {
    const op = makeOp({ kind: 'cnc_contour' })
    const html = render(makeProps({ operations: [op], filteredOps: [op], camMachine: undefined }))
    expect(html).not.toContain(`data-testid="op-arc-output-${op.id}"`)
  })

  it('HIDES the toggle for a non-contour/pocket CNC kind even on a router', () => {
    // cnc_drill is a router-capable kind but the arc-fit engine only applies to
    // contour/pocket loops, so the toggle must not appear for it.
    const op = makeOp({ kind: 'cnc_drill', params: { drillPoints: [[10, 10]] } })
    const html = render(makeProps({ operations: [op], filteredOps: [op], camMachine: LAGUNA }))
    expect(html).not.toContain(`data-testid="op-arc-output-${op.id}"`)
  })

  it('renders the tolerance field only once arcs are enabled', () => {
    const off = makeOp({ id: 'op-off', kind: 'cnc_contour' })
    const offHtml = render(makeProps({ operations: [off], filteredOps: [off], camMachine: LAGUNA }))
    expect(offHtml).not.toContain('data-testid="op-arc-output-tol-op-off"')

    const on = makeOp({
      id: 'op-on',
      kind: 'cnc_contour',
      params: { contourPoints: [[0, 0], [50, 0], [50, 25]], arcTolMm: ARC_OUTPUT_DEFAULT_TOL_MM }
    })
    const onHtml = render(makeProps({ operations: [on], filteredOps: [on], camMachine: LAGUNA }))
    expect(onHtml).toContain('data-testid="op-arc-output-tol-op-on"')
    expect(onHtml).toContain('Arc tolerance (mm)')
  })

  it('reflects the enabled state in the checkbox when arcTolMm > 0', () => {
    const on = makeOp({
      kind: 'cnc_contour',
      params: { contourPoints: [[0, 0], [50, 0], [50, 25]], arcTolMm: 0.05 }
    })
    const html = render(makeProps({ operations: [on], filteredOps: [on], camMachine: LAGUNA }))
    // The checkbox should be checked (React renders checked boolean as checked="").
    expect(html).toMatch(/data-testid="op-arc-output-toggle-op-1"[^>]*checked=""/)
  })
})

// ── Behavior pins (handler walks) ────────────────────────────────────────────

describe('ManufactureOperationList — arc-output toggle wiring (CAM ENHANCE)', () => {
  it('enabling the toggle stamps the default arcTolMm onto the op', () => {
    const onUpdateOp = vi.fn()
    const op = makeOp({ kind: 'cnc_contour' })
    const tree = renderTree(makeProps({ operations: [op], filteredOps: [op], camMachine: LAGUNA, onUpdateOp }))
    const toggle = findByTestId(tree, `op-arc-output-toggle-${op.id}`)
    expect(toggle).not.toBeNull()
    const onChange = (toggle?.props as { onChange?: (e: { target: { checked: boolean } }) => void } | undefined)
      ?.onChange
    expect(typeof onChange).toBe('function')
    onChange!({ target: { checked: true } })
    expect(onUpdateOp).toHaveBeenCalledTimes(1)
    const [idx, patch] = onUpdateOp.mock.calls[0] as [number, Partial<ManufactureOperation>]
    expect(idx).toBe(0)
    expect(patch.params?.['arcTolMm']).toBe(ARC_OUTPUT_DEFAULT_TOL_MM)
    // The pre-existing contourPoints must be preserved (additive patch).
    expect(Array.isArray(patch.params?.['contourPoints'])).toBe(true)
  })

  it('disabling the toggle clears arcTolMm and the optional arcMinSweepDeg', () => {
    const onUpdateOp = vi.fn()
    const op = makeOp({
      kind: 'cnc_pocket',
      params: {
        contourPoints: [[0, 0], [50, 0], [50, 25]],
        arcTolMm: 0.05,
        arcMinSweepDeg: 10
      }
    })
    const tree = renderTree(makeProps({ operations: [op], filteredOps: [op], camMachine: CARVERA3, onUpdateOp }))
    const toggle = findByTestId(tree, `op-arc-output-toggle-${op.id}`)
    const onChange = (toggle?.props as { onChange?: (e: { target: { checked: boolean } }) => void } | undefined)
      ?.onChange
    expect(typeof onChange).toBe('function')
    onChange!({ target: { checked: false } })
    expect(onUpdateOp).toHaveBeenCalledTimes(1)
    const [, patch] = onUpdateOp.mock.calls[0] as [number, Partial<ManufactureOperation>]
    expect(patch.params?.['arcTolMm']).toBeUndefined()
    expect(patch.params?.['arcMinSweepDeg']).toBeUndefined()
    // contourPoints survive the clear.
    expect(Array.isArray(patch.params?.['contourPoints'])).toBe(true)
  })

  it('the tolerance input is wired to onSetCutParam("arcTolMm", positive)', () => {
    const onSetCutParam = vi.fn()
    const op = makeOp({
      kind: 'cnc_contour',
      params: { contourPoints: [[0, 0], [50, 0], [50, 25]], arcTolMm: ARC_OUTPUT_DEFAULT_TOL_MM }
    })
    const tree = renderTree(makeProps({ operations: [op], filteredOps: [op], camMachine: LAGUNA, onSetCutParam }))
    const tol = findByTestId(tree, `op-arc-output-tol-${op.id}`)
    expect(tol).not.toBeNull()
    const onChange = (tol?.props as { onChange?: (e: { target: { value: string } }) => void } | undefined)?.onChange
    expect(typeof onChange).toBe('function')
    onChange!({ target: { value: '0.03' } })
    expect(onSetCutParam).toHaveBeenCalledWith(0, 'arcTolMm', '0.03', 'positive')
  })
})
