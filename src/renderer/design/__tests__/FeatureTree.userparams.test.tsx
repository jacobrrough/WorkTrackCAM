/**
 * FeatureTree — USER PARAMETERS section render-contract pins (Phase-3 parity).
 *
 * Mirrors the existing FeatureTree.test.tsx convention: `renderToStaticMarkup`
 * in the node vitest env (no jsdom). Pins:
 *   - The section is SUPPRESSED when none of the user-parameter wiring is present
 *     (existing operations-only callers render unchanged).
 *   - When ANY wiring is present the section renders — including an EMPTY array
 *     (the add affordance shows on a fresh design).
 *   - Each row renders the name, the expression input, and either the resolved
 *     value or the evaluation error.
 *   - Delete / rename / edit inputs render disabled when their callback is absent
 *     (read-only fallback).
 *   - Section is emitted even when operations are empty (a design with only user
 *     params is not the EmptyState).
 */

import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  FeatureTree,
  type FeatureTreeOperation,
  type FeatureTreeUserParameter
} from '../FeatureTree'

function op(line: number, name: string, args: string): FeatureTreeOperation {
  return { line, op: name, args }
}

function up(
  name: string,
  expression: string,
  resolvedValue: number | null,
  errorMessage?: string
): FeatureTreeUserParameter {
  return { name, expression, resolvedValue, errorMessage }
}

describe('FeatureTree — user parameters section', () => {
  it('suppresses the section when no user-parameter wiring is supplied', () => {
    const html = renderToStaticMarkup(
      createElement(FeatureTree, { operations: [op(1, 'box', 'l=10')] })
    )
    expect(html).not.toContain('data-testid="cad-user-params"')
    expect(html).not.toContain('data-testid="cad-user-param-row"')
  })

  it('renders the section (with add affordance) even when the array is empty', () => {
    const html = renderToStaticMarkup(
      createElement(FeatureTree, {
        operations: [],
        userParameters: [],
        onUserParameterAdd: vi.fn()
      })
    )
    expect(html).toContain('data-testid="cad-user-params"')
    expect(html).toContain('data-testid="cad-user-params-empty"')
    expect(html).toContain('data-testid="cad-user-param-add"')
    expect(html).toContain('data-testid="cad-user-param-add-btn"')
  })

  it('does NOT fall back to the operations EmptyState when only user params are wired', () => {
    const html = renderToStaticMarkup(
      createElement(FeatureTree, {
        operations: [],
        userParameters: [up('thickness', '6', 6)],
        onUserParameterAdd: vi.fn()
      })
    )
    expect(html).not.toContain('data-testid="cad-feature-empty-state"')
    expect(html).toContain('data-testid="cad-user-params"')
  })

  it('renders one row per user parameter with name + expression + resolved value', () => {
    const html = renderToStaticMarkup(
      createElement(FeatureTree, {
        operations: [],
        userParameters: [up('d1', '10', 10), up('width', 'd1 * 2 + 5', 25)],
        onUserParameterEdit: vi.fn(),
        onUserParameterRename: vi.fn(),
        onUserParameterDelete: vi.fn()
      })
    )
    const rows = html.match(/data-testid="cad-user-param-row"/g) ?? []
    expect(rows).toHaveLength(2)
    expect(html).toContain('data-param-name="d1"')
    expect(html).toContain('data-param-name="width"')
    // Expression input carries the current expression as its value.
    expect(html).toMatch(/data-testid="cad-user-param-expr"[^>]*value="d1 \* 2 \+ 5"/)
    // Resolved value read-out shows 25 (trimmed).
    expect(html).toMatch(/data-testid="cad-user-param-value"[^>]*>25</)
  })

  it('shows the evaluation error instead of a value when the expression fails', () => {
    const html = renderToStaticMarkup(
      createElement(FeatureTree, {
        operations: [],
        userParameters: [up('bad', '1/0', null, 'Division by zero')],
        onUserParameterEdit: vi.fn()
      })
    )
    expect(html).toMatch(/data-param-name="bad"[^>]*data-param-error="true"/)
    expect(html).toContain('data-testid="cad-user-param-error"')
    expect(html).toContain('Division by zero')
    // No value read-out on an errored row.
    expect(html).not.toContain('data-testid="cad-user-param-value"')
  })

  it('formats the resolved value without trailing zeros', () => {
    const html = renderToStaticMarkup(
      createElement(FeatureTree, {
        operations: [],
        userParameters: [up('half', 'w/2', 12.5)],
        onUserParameterEdit: vi.fn()
      })
    )
    expect(html).toMatch(/data-testid="cad-user-param-value"[^>]*>12\.5</)
  })

  it('renders the expression input + delete disabled in the read-only fallback', () => {
    // userParameters present but NO callbacks -> read-only.
    const html = renderToStaticMarkup(
      createElement(FeatureTree, {
        operations: [],
        userParameters: [up('d1', '10', 10)]
      })
    )
    expect(html).toContain('data-testid="cad-user-params"')
    // Expression input rendered but disabled.
    expect(html).toMatch(/data-testid="cad-user-param-expr"[^>]*disabled/)
    expect(html).toMatch(/data-testid="cad-user-param-delete"[^>]*disabled/)
    // No add row without onAdd.
    expect(html).not.toContain('data-testid="cad-user-param-add"')
  })

  it('the section renders ABOVE the CadQuery-script params + operations', () => {
    const html = renderToStaticMarkup(
      createElement(FeatureTree, {
        operations: [op(1, 'box', 'l=10')],
        userParameters: [up('d1', '10', 10)],
        onUserParameterAdd: vi.fn()
      })
    )
    const idxUser = html.indexOf('data-testid="cad-user-params"')
    const idxTree = html.indexOf('data-testid="cad-feature-tree"')
    expect(idxUser).toBeGreaterThanOrEqual(0)
    expect(idxTree).toBeGreaterThan(idxUser)
  })

  it('the add button is disabled until a name is typed (empty draft)', () => {
    const html = renderToStaticMarkup(
      createElement(FeatureTree, {
        operations: [],
        userParameters: [],
        onUserParameterAdd: vi.fn()
      })
    )
    expect(html).toMatch(/data-testid="cad-user-param-add-btn"[^>]*disabled/)
  })

  it('does not throw or log on a typical user-params render', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      renderToStaticMarkup(
        createElement(FeatureTree, {
          operations: [],
          userParameters: [up('d1', '10', 10), up('bad', 'x+', null, 'Syntax error')],
          onUserParameterAdd: vi.fn(),
          onUserParameterEdit: vi.fn(),
          onUserParameterRename: vi.fn(),
          onUserParameterDelete: vi.fn()
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
