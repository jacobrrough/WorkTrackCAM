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
import { FeatureTree, type FeatureTreeOperation } from '../FeatureTree'

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
