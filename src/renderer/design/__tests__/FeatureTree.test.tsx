/**
 * FeatureTree — render-contract pin (BUILD 4, Cycle 233 CAD MVP).
 *
 * Uses `react-dom/server.renderToStaticMarkup` to keep the suite in
 * the existing `node` vitest environment without a jsdom dependency
 * (matches the EmptyState / CadQueryEditor pattern).
 *
 * Contract pinned here:
 *   - Empty `operations` -> renders the shared `EmptyState` component
 *     with the canonical CAD-MVP copy and testid
 *     `cad-feature-empty-state`. The component MUST NOT roll its own
 *     empty-state markup (CLAUDE.md rule).
 *   - Non-empty operations -> renders an ordered list, one
 *     `cad-feature-row` per entry, line numbers in script order,
 *     `data-line` + `data-op` attributes on every row.
 *   - The full args string is preserved in the `title` attribute
 *     even when the visible text is truncated.
 *   - Args longer than the cap render with a U+2026 ellipsis.
 *   - When `onLineClick` is supplied, the row gets `role="button"`,
 *     `tabIndex={0}`, and an `onClick` that forwards the row's line.
 *     When omitted, the row stays a presentational `<li>` (no fake
 *     button role leaking to assistive tech).
 */

import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  FeatureTree,
  type FeatureTreeOperation,
  type FeatureTreeParameter
} from '../FeatureTree'

interface AnyNode {
  type?: unknown
  props?: { [k: string]: unknown; children?: unknown }
}

function findAllByTestId(node: unknown, testId: string, acc: AnyNode[] = []): AnyNode[] {
  if (!node || typeof node !== 'object') return acc
  const n = node as AnyNode
  if (n.props?.['data-testid'] === testId) acc.push(n)
  const children = n.props?.children
  if (children == null) return acc
  const list = Array.isArray(children) ? children : [children]
  for (const c of list) findAllByTestId(c, testId, acc)
  return acc
}

function renderToTree(props: Parameters<typeof FeatureTree>[0]): unknown {
  return (
    FeatureTree as unknown as (
      p: Parameters<typeof FeatureTree>[0]
    ) => React.ReactElement
  )(props)
}

function op(line: number, name: string, args: string): FeatureTreeOperation {
  return { line, op: name, args }
}

describe('FeatureTree — render contract (BUILD 4)', () => {
  it('renders the shared EmptyState when operations is empty', () => {
    const html = renderToStaticMarkup(
      createElement(FeatureTree, { operations: [] })
    )
    expect(html).toContain('class="empty-state"')
    expect(html).toContain('data-testid="cad-feature-empty-state"')
    expect(html).toContain('No operations yet')
    expect(html).toContain('Write a CadQuery script and hit Run.')
    // EmptyState wires role="status" + aria-live="polite" so screen
    // readers announce the empty state non-destructively.
    expect(html).toMatch(/role="status"[^>]*aria-live="polite"/)
  })

  it('empty state does NOT render any cad-feature-row entries', () => {
    const html = renderToStaticMarkup(
      createElement(FeatureTree, { operations: [] })
    )
    expect(html).not.toContain('data-testid="cad-feature-row"')
    expect(html).not.toContain('cad-feature-tree')
  })

  it('renders one row per operation in script order', () => {
    const ops: FeatureTreeOperation[] = [
      op(1, 'box', 'l=50, w=30, h=10'),
      op(2, 'fillet', 'radius=2'),
      op(3, 'shell', 'thickness=1.5')
    ]
    const html = renderToStaticMarkup(
      createElement(FeatureTree, { operations: ops })
    )
    expect(html).toContain('data-testid="cad-feature-tree"')
    // Three rows.
    const rowMatches = html.match(/data-testid="cad-feature-row"/g)
    expect(rowMatches).toHaveLength(3)
    // Order is preserved.
    const idxBox = html.indexOf('data-op="box"')
    const idxFillet = html.indexOf('data-op="fillet"')
    const idxShell = html.indexOf('data-op="shell"')
    expect(idxBox).toBeGreaterThanOrEqual(0)
    expect(idxFillet).toBeGreaterThan(idxBox)
    expect(idxShell).toBeGreaterThan(idxFillet)
  })

  it('each row exposes the line number via data-line and the visible gutter', () => {
    const html = renderToStaticMarkup(
      createElement(FeatureTree, {
        operations: [op(7, 'extrude', 'distance=12')]
      })
    )
    expect(html).toContain('data-line="7"')
    expect(html).toContain('class="cad-feature-row__line"')
    // Visible line number in the gutter.
    expect(html).toMatch(/cad-feature-row__line"[^>]*aria-hidden="true">7</)
  })

  it('renders op name + args in their own monospace spans', () => {
    const html = renderToStaticMarkup(
      createElement(FeatureTree, {
        operations: [op(1, 'extrude', 'distance=12, taper=3')]
      })
    )
    expect(html).toContain('class="cad-feature-row__op">extrude<')
    expect(html).toContain('class="cad-feature-row__args">distance=12, taper=3<')
  })

  it('truncates args longer than the 48-char cap with a U+2026 ellipsis', () => {
    const longArgs = 'a'.repeat(60)
    const html = renderToStaticMarkup(
      createElement(FeatureTree, {
        operations: [op(1, 'box', longArgs)]
      })
    )
    // U+2026 (3-byte UTF-8 e2 80 a6).
    expect(html).toContain('…')
    // Truncated visible string is exactly 48 chars long.
    const visibleMatch = html.match(/class="cad-feature-row__args">([^<]+)</)
    expect(visibleMatch).not.toBeNull()
    expect(visibleMatch![1]!.length).toBe(48)
    expect(visibleMatch![1]!.endsWith('…')).toBe(true)
  })

  it('preserves the full untruncated args string in the row title attribute', () => {
    const longArgs = 'b'.repeat(80)
    const html = renderToStaticMarkup(
      createElement(FeatureTree, {
        operations: [op(1, 'box', longArgs)]
      })
    )
    // The title attribute carries the full string -- hovering shows
    // the complete args even when the visible text is clipped.
    expect(html).toContain(`title="${longArgs}"`)
  })

  it('does NOT truncate args that fit within the 48-char cap', () => {
    const shortArgs = 'distance=12'
    const html = renderToStaticMarkup(
      createElement(FeatureTree, {
        operations: [op(1, 'extrude', shortArgs)]
      })
    )
    expect(html).toContain(`class="cad-feature-row__args">${shortArgs}<`)
    expect(html).not.toContain('…')
  })

  it('omits role="button" + tabIndex when onLineClick is not supplied', () => {
    const html = renderToStaticMarkup(
      createElement(FeatureTree, {
        operations: [op(1, 'box', 'l=10')]
      })
    )
    expect(html).not.toContain('role="button"')
    expect(html).not.toContain('tabindex="0"')
  })

  it('adds role="button" + tabIndex=0 when onLineClick is supplied', () => {
    const html = renderToStaticMarkup(
      createElement(FeatureTree, {
        operations: [op(1, 'box', 'l=10')],
        onLineClick: vi.fn()
      })
    )
    expect(html).toContain('role="button"')
    expect(html).toContain('tabindex="0"')
  })

  it('onLineClick fires with the row line number when the row is clicked', () => {
    const onLineClick = vi.fn()
    const tree = renderToTree({
      operations: [
        op(1, 'box', 'l=10'),
        op(5, 'fillet', 'r=2'),
        op(9, 'shell', 't=1')
      ],
      onLineClick
    }) as AnyNode
    const rows = findAllByTestId(tree, 'cad-feature-row')
    expect(rows).toHaveLength(3)
    const middleHandler = (rows[1]?.props as { onClick?: () => void }).onClick
    expect(typeof middleHandler).toBe('function')
    middleHandler!()
    expect(onLineClick).toHaveBeenCalledWith(5)
  })

  it('renders an aria-label on the ordered list for screen readers', () => {
    const html = renderToStaticMarkup(
      createElement(FeatureTree, {
        operations: [op(1, 'box', 'l=10')]
      })
    )
    expect(html).toContain('aria-label="CadQuery feature tree"')
  })

  it('does not throw and produces no console errors on a typical render', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      renderToStaticMarkup(
        createElement(FeatureTree, {
          operations: [op(1, 'box', 'l=10'), op(2, 'fillet', 'r=2')]
        })
      )
      expect(errSpy).not.toHaveBeenCalled()
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      errSpy.mockRestore()
      warnSpy.mockRestore()
    }
  })
})

// ── BUILD 6 / CAD V1 — editable parameters contract ───────────────────────
//
// Pins the new prop surface added when wiring CQGI build_parameters into
// the FeatureTree:
//
//   - `parameters` prop absent or empty -> NO params section in the DOM
//     (existing tests above prove the legacy operations-only contract is
//     untouched).
//   - `parameters` present + NO `onParamsChange` -> read-only fallback
//     (renders the name + value, no inputs, no Apply button).
//   - `parameters` + `onParamsChange` present -> editable inputs matched
//     to the parameter kind plus per-row Reset and a global Apply button.
//     The Apply button is disabled when no row is dirty.
//
// These pins guarantee the parametric edit flow that ships in the
// DesignWorkspace's right column (`paramOverrides` <-> `cad.execute`
// round-trip) cannot regress silently.

function param(
  name: string,
  value: number | boolean | string,
  kind: 'number' | 'boolean' | 'string'
): FeatureTreeParameter {
  return { name, value, kind }
}

describe('FeatureTree — editable parameters contract (BUILD 6 / CAD V1)', () => {
  it('omits the params section entirely when `parameters` is absent', () => {
    const html = renderToStaticMarkup(
      createElement(FeatureTree, { operations: [op(1, 'box', 'l=10')] })
    )
    expect(html).not.toContain('data-testid="cad-feature-params"')
    expect(html).not.toContain('data-testid="cad-feature-param-input"')
    expect(html).not.toContain('data-testid="cad-feature-params-apply"')
  })

  it('omits the params section when `parameters` is an empty array', () => {
    const html = renderToStaticMarkup(
      createElement(FeatureTree, {
        operations: [op(1, 'box', 'l=10')],
        parameters: []
      })
    )
    expect(html).not.toContain('data-testid="cad-feature-params"')
  })

  it('renders read-only params (no inputs) when onParamsChange is omitted', () => {
    const html = renderToStaticMarkup(
      createElement(FeatureTree, {
        operations: [],
        parameters: [
          param('length', 50, 'number'),
          param('mirror', true, 'boolean')
        ]
      })
    )
    expect(html).toContain('data-testid="cad-feature-params"')
    expect(html).toContain('data-testid="cad-feature-param-row"')
    // Read-only mode renders the value as plain text, not an <input>.
    expect(html).not.toContain('data-testid="cad-feature-param-input"')
    expect(html).not.toContain('data-testid="cad-feature-params-apply"')
    expect(html).toContain('length')
    expect(html).toContain('mirror')
  })

  it('renders one input per param when onParamsChange is supplied', () => {
    const html = renderToStaticMarkup(
      createElement(FeatureTree, {
        operations: [],
        parameters: [
          param('length', 50, 'number'),
          param('mirror', true, 'boolean'),
          param('label', 'plate', 'string')
        ],
        onParamsChange: vi.fn()
      })
    )
    const inputCount = (html.match(/data-testid="cad-feature-param-input"/g) ?? []).length
    expect(inputCount).toBe(3)
  })

  it('matches the input type to the param kind (number / checkbox / text)', () => {
    const html = renderToStaticMarkup(
      createElement(FeatureTree, {
        operations: [],
        parameters: [
          param('length', 50, 'number'),
          param('mirror', true, 'boolean'),
          param('label', 'plate', 'string')
        ],
        onParamsChange: vi.fn()
      })
    )
    // Number input — type="number" + step="any"
    expect(html).toMatch(
      /data-param-name="length"[^>]*data-param-kind="number"/
    )
    expect(html).toMatch(/type="number"[^>]*step="any"/)
    // Boolean checkbox
    expect(html).toMatch(
      /data-param-name="mirror"[^>]*data-param-kind="boolean"/
    )
    expect(html).toContain('type="checkbox"')
    // String input
    expect(html).toMatch(
      /data-param-name="label"[^>]*data-param-kind="string"/
    )
    expect(html).toMatch(/type="text"/)
  })

  it('renders a per-row Reset button when editable', () => {
    const html = renderToStaticMarkup(
      createElement(FeatureTree, {
        operations: [],
        parameters: [param('length', 50, 'number')],
        onParamsChange: vi.fn()
      })
    )
    expect(html).toContain('data-testid="cad-feature-param-reset"')
    expect(html).toContain('data-param-name="length"')
    expect(html).toContain('aria-label="Reset length to default"')
  })

  it('renders a global Apply button when editable, disabled with no overrides', () => {
    const html = renderToStaticMarkup(
      createElement(FeatureTree, {
        operations: [],
        parameters: [param('length', 50, 'number')],
        onParamsChange: vi.fn()
      })
    )
    expect(html).toContain('data-testid="cad-feature-params-apply"')
    // Initial render with no overrides -> Apply is disabled because no
    // row is dirty.
    expect(html).toMatch(
      /data-testid="cad-feature-params-apply"[^>]*disabled/
    )
  })

  it('shows the override value (not the script default) when paramOverrides is supplied', () => {
    const html = renderToStaticMarkup(
      createElement(FeatureTree, {
        operations: [],
        parameters: [param('length', 50, 'number')],
        paramOverrides: { length: 75 },
        onParamsChange: vi.fn()
      })
    )
    // The number input must show the override value, not the default.
    expect(html).toMatch(/data-param-name="length"[^>]*data-param-dirty="true"/)
    expect(html).toMatch(/value="75"/)
    expect(html).not.toMatch(/value="50"/)
  })

  it('seeds the read-only fallback with the override value too', () => {
    const html = renderToStaticMarkup(
      createElement(FeatureTree, {
        operations: [],
        parameters: [param('mirror', false, 'boolean')],
        paramOverrides: { mirror: true }
        // no onParamsChange -> read-only path
      })
    )
    // Read-only path renders the value as plain text from the override map.
    expect(html).toContain('>true<')
    expect(html).not.toContain('>false<')
  })

  it('does not render any params input when only operations are supplied', () => {
    // Regression guard: passing a normal operations-only payload must
    // not accidentally surface any params chrome (data-testid, input,
    // Apply). Existing read-only callers depend on this invariant.
    const html = renderToStaticMarkup(
      createElement(FeatureTree, {
        operations: [op(1, 'box', 'l=10'), op(2, 'fillet', 'r=2')]
      })
    )
    expect(html).not.toContain('cad-feature-params')
    expect(html).not.toContain('cad-feature-param-row')
  })
})

// ── Apply / dirty-state behavioral pins (renderToStaticMarkup) ────────────
//
// `renderToStaticMarkup` strips event handlers (no DOM to fire them
// against) so we can't `.click()` the Apply button. Instead we exercise
// the same effective contract through the rendered HTML:
//
//   - With NO paramOverrides supplied, the local draft is empty so no
//     row is dirty -> Apply renders with `disabled`.
//   - With a `paramOverrides` value that differs from the script
//     default, the row is dirty -> Apply renders WITHOUT `disabled` and
//     the row carries `data-param-dirty="true"`.
//   - With a `paramOverrides` value that MATCHES the script default,
//     the row is NOT dirty (`data-param-dirty="false"`) and Apply
//     stays disabled.
//
// The Apply -> onParamsChange callback path is covered indirectly by
// the integration test in DesignWorkspace (UNIFY 1 pattern) where
// performSendToCam-style pure helpers carry the load-bearing logic.

describe('FeatureTree — Apply / dirty-state pins', () => {
  it('Apply is disabled at first render with no paramOverrides', () => {
    const html = renderToStaticMarkup(
      createElement(FeatureTree, {
        operations: [],
        parameters: [param('length', 50, 'number')],
        onParamsChange: vi.fn()
      })
    )
    expect(html).toMatch(
      /data-testid="cad-feature-params-apply"[^>]*disabled/
    )
  })

  it('Apply is enabled when a paramOverride differs from the default', () => {
    const html = renderToStaticMarkup(
      createElement(FeatureTree, {
        operations: [],
        parameters: [param('length', 50, 'number')],
        paramOverrides: { length: 75 },
        onParamsChange: vi.fn()
      })
    )
    // Apply must NOT carry the disabled attribute when there is a
    // dirty override.
    expect(html).toMatch(/data-testid="cad-feature-params-apply"[^>]*>Apply</)
    expect(html).not.toMatch(
      /data-testid="cad-feature-params-apply"[^>]*disabled/
    )
  })

  it('Apply stays disabled when paramOverride equals the default', () => {
    const html = renderToStaticMarkup(
      createElement(FeatureTree, {
        operations: [],
        parameters: [param('length', 50, 'number')],
        // Override matches the script default -> NOT dirty.
        paramOverrides: { length: 50 },
        onParamsChange: vi.fn()
      })
    )
    expect(html).toMatch(
      /data-testid="cad-feature-params-apply"[^>]*disabled/
    )
    expect(html).toMatch(
      /data-param-name="length"[^>]*data-param-dirty="false"/
    )
  })

  it('per-row Reset is disabled when the row is not dirty', () => {
    const html = renderToStaticMarkup(
      createElement(FeatureTree, {
        operations: [],
        parameters: [param('length', 50, 'number')],
        onParamsChange: vi.fn()
      })
    )
    expect(html).toMatch(
      /data-testid="cad-feature-param-reset"[^>]*disabled/
    )
  })

  it('per-row Reset is enabled when the row is dirty', () => {
    const html = renderToStaticMarkup(
      createElement(FeatureTree, {
        operations: [],
        parameters: [param('length', 50, 'number')],
        paramOverrides: { length: 75 },
        onParamsChange: vi.fn()
      })
    )
    // The Reset button for `length` must NOT carry disabled when a
    // dirty override exists.
    const resetMatch = html.match(
      /<button[^>]*data-testid="cad-feature-param-reset"[^>]*data-param-name="length"[^>]*>/
    )
    expect(resetMatch).not.toBeNull()
    expect(resetMatch![0].includes('disabled')).toBe(false)
  })

  it('renders dirty + non-dirty rows simultaneously with the right markers', () => {
    const html = renderToStaticMarkup(
      createElement(FeatureTree, {
        operations: [],
        parameters: [
          param('length', 50, 'number'),
          param('width', 30, 'number')
        ],
        // length is dirty (75 != 50); width override matches default.
        paramOverrides: { length: 75, width: 30 },
        onParamsChange: vi.fn()
      })
    )
    expect(html).toMatch(
      /data-param-name="length"[^>]*data-param-dirty="true"/
    )
    expect(html).toMatch(
      /data-param-name="width"[^>]*data-param-dirty="false"/
    )
    // At least one row dirty -> Apply enabled.
    expect(html).not.toMatch(
      /data-testid="cad-feature-params-apply"[^>]*disabled/
    )
  })
})
