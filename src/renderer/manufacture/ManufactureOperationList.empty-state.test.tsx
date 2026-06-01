/**
 * BROKEN PATH #4 render-pin: ManufactureOperationList must render two
 * distinct empty-state blocks so filtering an op list down to zero is
 * never silent:
 *
 *   - `operations.length === 0` (no ops at all)       → "No operations yet"
 *     plus an "Add operation" CTA (only when onAddOp is wired).
 *   - `operations.length > 0 && filteredOps.length === 0` (filter excluded
 *     every op)                                       → "No operations match
 *     this filter" plus a "Clear filter" button that resets opFilter to
 *     'all' AND turns the actionable-only toggle back off.
 *
 * When there's at least one op visible (filteredOps.length > 0) the
 * component must NOT render either empty-state block.
 *
 * Pattern follows the existing `manufacture-aux-k2-send-render.test.tsx`
 * approach: `react-dom/server.renderToStaticMarkup` so the test runs in
 * the existing vitest `node` environment without a jsdom dependency.
 * Click handlers are validated by invoking the captured `onClick` props
 * through `renderToString`'s static output is not enough, so the test
 * additionally constructs the component element tree and invokes the
 * callback handlers via the captured props on a child node walk.
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ManufactureOperationList } from './ManufactureOperationList'
import type { ManufactureOperation } from '../../shared/manufacture-schema'

// ── Fixture op ──────────────────────────────────────────────────────────────

function makeOp(overrides: Partial<ManufactureOperation> = {}): ManufactureOperation {
  return {
    id: 'op-1',
    kind: 'cnc_parallel',
    label: 'Op 1',
    sourceMesh: 'assets/sample.stl',
    ...overrides
  } as ManufactureOperation
}

// ── Default-props builder ───────────────────────────────────────────────────
// Most callbacks just need to be present; the empty-state branches we test
// rely only on `onAddOp`, `onSetOpFilter`, and `onSetActionableOnly`.

type Props = Parameters<typeof ManufactureOperationList>[0]

function makeProps(overrides: Partial<Props> = {}): Props {
  const noop = vi.fn()
  return {
    operations: [],
    filteredOps: [],
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

describe('ManufactureOperationList — empty-state branches (BROKEN PATH #4)', () => {
  it('renders "No operations yet" + Add CTA when there are no operations at all', () => {
    const onAddOp = vi.fn()
    const html = render(makeProps({ operations: [], filteredOps: [], onAddOp }))
    expect(html).toContain('data-testid="manufacture-op-empty-none"')
    expect(html).toContain('No operations yet')
    expect(html).toContain('data-testid="manufacture-op-empty-add"')
    expect(html).toContain('Add operation')
    // The filtered-empty block must NOT appear when the unfiltered list is empty.
    expect(html).not.toContain('data-testid="manufacture-op-empty-filtered"')
  })

  it('omits the Add CTA when onAddOp is not wired but still shows the title', () => {
    const html = render(makeProps({ operations: [], filteredOps: [], onAddOp: undefined }))
    expect(html).toContain('data-testid="manufacture-op-empty-none"')
    expect(html).toContain('No operations yet')
    expect(html).not.toContain('data-testid="manufacture-op-empty-add"')
  })

  it('renders the filtered empty-state when filter excludes every op', () => {
    const op = makeOp()
    const html = render(
      makeProps({
        operations: [op],
        filteredOps: [],
        opFilter: 'missing geometry',
        activeFilterLabel: 'missing geometry'
      })
    )
    expect(html).toContain('data-testid="manufacture-op-empty-filtered"')
    expect(html).toContain('No operations match this filter')
    expect(html).toContain('data-testid="manufacture-op-empty-clear"')
    expect(html).toContain('Clear filter')
    // Must reference the unfiltered count so the user knows what they'd see.
    expect(html).toContain('see all 1 operation')
    // The no-ops-yet branch must NOT appear when at least one op exists.
    expect(html).not.toContain('data-testid="manufacture-op-empty-none"')
  })

  it('Clear filter button resets opFilter to "all" and turns actionableOnly off', () => {
    const onSetOpFilter = vi.fn()
    const onSetActionableOnly = vi.fn()
    const op = makeOp()

    // Walk the component tree to grab the captured onClick on the
    // "Clear filter" button. We use React.createElement directly (no JSX)
    // so the resulting tree is a plain virtual DOM we can introspect.
    const tree = createElement(ManufactureOperationList, makeProps({
      operations: [op],
      filteredOps: [],
      actionableOnly: true,
      opFilter: 'missing geometry',
      activeFilterLabel: 'missing geometry',
      onSetOpFilter,
      onSetActionableOnly
    }))

    // Render the component output (the function-component invocation)
    // by calling it directly. The component returns a React fragment;
    // we walk children and look for the data-testid we care about.
    const result = (ManufactureOperationList as unknown as (p: Props) => React.ReactElement)(tree.props as Props)

    type AnyNode = {
      props?: { [k: string]: unknown; children?: unknown }
      type?: unknown
    }

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

    const btn = findByTestId(result, 'manufacture-op-empty-clear')
    expect(btn).not.toBeNull()
    const onClick = (btn?.props as { onClick?: () => void } | undefined)?.onClick
    expect(typeof onClick).toBe('function')
    onClick!()
    expect(onSetActionableOnly).toHaveBeenCalledWith(false)
    expect(onSetOpFilter).toHaveBeenCalledWith('all')
  })

  it('renders neither empty-state block when at least one op is visible', () => {
    const op = makeOp()
    const html = render(makeProps({ operations: [op], filteredOps: [op] }))
    expect(html).not.toContain('data-testid="manufacture-op-empty-none"')
    expect(html).not.toContain('data-testid="manufacture-op-empty-filtered"')
  })
})
