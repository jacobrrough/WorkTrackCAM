/**
 * CadQueryEditor — render-contract pin (BUILD 4, Cycle 233 CAD MVP).
 *
 * Uses `react-dom/server.renderToStaticMarkup` to keep the suite in
 * the existing `node` vitest environment without a jsdom dependency
 * (matches the EmptyState / MoonrakerPreviewBanner pattern).
 *
 * Contract pinned here:
 *   - The root container always carries `data-testid="cad-editor-root"`
 *     so DesignWorkspace integration tests can scope-select it.
 *   - The Run button always renders as a real `<button type="button">`
 *     with `data-testid="cad-editor-run"`.
 *   - The textarea always renders with `data-testid="cad-editor-textarea"`
 *     and the supplied `value` flows through to the DOM.
 *   - The Run button reuses the `.btn` + `.btn-primary` primitive
 *     classes (no custom button styling per the task brief).
 *   - When `busy === true` the Run button is `disabled`, its label
 *     flips to "Running…", and the aria-busy attribute on the root
 *     reads `"true"`.
 *   - Spellcheck / autocorrect / autocapitalize are off on the
 *     textarea so the editor never auto-mangles CadQuery identifiers.
 *
 * Interactive behaviour (`onChange`, `onRun`, Ctrl+Enter shortcut) is
 * covered by direct handler invocation on the rendered React tree so
 * we don't need jsdom.
 */

import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CadQueryEditor } from '../CadQueryEditor'

interface AnyNode {
  type?: unknown
  props?: { [k: string]: unknown; children?: unknown }
}

function findByTestId(node: unknown, testId: string): AnyNode | null {
  if (!node || typeof node !== 'object') return null
  const n = node as AnyNode
  if (n.props?.['data-testid'] === testId) return n
  const children = n.props?.children
  if (children == null) return null
  const list = Array.isArray(children) ? children : [children]
  for (const c of list) {
    const found = findByTestId(c, testId)
    if (found) return found
  }
  return null
}

function renderToTree(props: Parameters<typeof CadQueryEditor>[0]): unknown {
  return (
    CadQueryEditor as unknown as (
      p: Parameters<typeof CadQueryEditor>[0]
    ) => React.ReactElement
  )(props)
}

function baseProps(
  overrides: Partial<Parameters<typeof CadQueryEditor>[0]> = {}
): Parameters<typeof CadQueryEditor>[0] {
  return {
    value: 'cq.Workplane("XY").box(50,30,10)',
    onChange: vi.fn(),
    onRun: vi.fn(),
    busy: false,
    ...overrides
  }
}

describe('CadQueryEditor — render contract (BUILD 4)', () => {
  it('renders the root container with cad-editor-root testid', () => {
    const html = renderToStaticMarkup(createElement(CadQueryEditor, baseProps()))
    expect(html).toContain('data-testid="cad-editor-root"')
  })

  it('renders the Run button as a real <button type="button">', () => {
    const html = renderToStaticMarkup(createElement(CadQueryEditor, baseProps()))
    expect(html).toMatch(/<button[^>]*type="button"[^>]*data-testid="cad-editor-run"/)
  })

  it('Run button reuses the .btn + .btn-primary primitive classes', () => {
    const html = renderToStaticMarkup(createElement(CadQueryEditor, baseProps()))
    expect(html).toMatch(/<button[^>]*class="btn btn-primary"[^>]*data-testid="cad-editor-run"/)
  })

  it('renders the textarea with cad-editor-textarea testid and the supplied value', () => {
    const html = renderToStaticMarkup(
      createElement(CadQueryEditor, baseProps({ value: 'box(1,2,3)' }))
    )
    expect(html).toContain('data-testid="cad-editor-textarea"')
    expect(html).toContain('box(1,2,3)')
  })

  it('renders the textarea with spellcheck / autocorrect / autocapitalize off', () => {
    const html = renderToStaticMarkup(createElement(CadQueryEditor, baseProps()))
    // CadQuery scripts are Python identifiers -- never let the browser
    // helpfully correct them into prose. React emits these attrs in
    // camelCase in static markup (the DOM still accepts them) -- we
    // match case-insensitively to stay robust against a future React
    // serialiser tweak.
    expect(html).toMatch(/spellcheck="false"/i)
    expect(html).toMatch(/autocorrect="off"/i)
    expect(html).toMatch(/autocapitalize="off"/i)
  })

  it('renders aria-label="CadQuery Python script" on the textarea', () => {
    const html = renderToStaticMarkup(createElement(CadQueryEditor, baseProps()))
    expect(html).toMatch(/<textarea[^>]*aria-label="CadQuery Python script"/)
  })

  it('when busy=false the Run button is enabled and labelled "Run"', () => {
    const html = renderToStaticMarkup(
      createElement(CadQueryEditor, baseProps({ busy: false }))
    )
    expect(html).not.toMatch(/data-testid="cad-editor-run"[^>]*disabled/)
    expect(html).toMatch(/data-testid="cad-editor-run"[^>]*>Run</)
    expect(html).toContain('aria-busy="false"')
  })

  it('when busy=true the Run button is disabled and labelled "Running…"', () => {
    const html = renderToStaticMarkup(
      createElement(CadQueryEditor, baseProps({ busy: true }))
    )
    expect(html).toMatch(/data-testid="cad-editor-run"[^>]*disabled/)
    expect(html).toContain('Running')
    expect(html).toContain('aria-busy="true"')
  })

  it('renders the Ctrl+Enter hint next to the Run button', () => {
    const html = renderToStaticMarkup(createElement(CadQueryEditor, baseProps()))
    expect(html).toContain('Ctrl+Enter to run')
  })

  it('onRun fires when the Run button is clicked', () => {
    const onRun = vi.fn()
    const tree = renderToTree(baseProps({ onRun })) as AnyNode
    const runBtn = findByTestId(tree, 'cad-editor-run')
    expect(runBtn).not.toBeNull()
    const handler = (runBtn?.props as { onClick?: () => void } | undefined)?.onClick
    expect(typeof handler).toBe('function')
    handler!()
    expect(onRun).toHaveBeenCalledTimes(1)
  })

  it('onChange fires with the new value when the textarea changes', () => {
    const onChange = vi.fn()
    const tree = renderToTree(baseProps({ onChange })) as AnyNode
    const textarea = findByTestId(tree, 'cad-editor-textarea')
    expect(textarea).not.toBeNull()
    const handler = (
      textarea?.props as {
        onChange?: (e: { target: { value: string } }) => void
      } | undefined
    )?.onChange
    expect(typeof handler).toBe('function')
    handler!({ target: { value: 'box(10,20,30)' } })
    expect(onChange).toHaveBeenCalledWith('box(10,20,30)')
  })

  it('Ctrl+Enter inside the textarea triggers onRun', () => {
    const onRun = vi.fn()
    const tree = renderToTree(baseProps({ onRun })) as AnyNode
    const textarea = findByTestId(tree, 'cad-editor-textarea')
    const handler = (
      textarea?.props as {
        onKeyDown?: (e: {
          key: string
          ctrlKey: boolean
          metaKey: boolean
          preventDefault: () => void
        }) => void
      } | undefined
    )?.onKeyDown
    expect(typeof handler).toBe('function')
    const preventDefault = vi.fn()
    handler!({ key: 'Enter', ctrlKey: true, metaKey: false, preventDefault })
    expect(onRun).toHaveBeenCalledTimes(1)
    expect(preventDefault).toHaveBeenCalledTimes(1)
  })

  it('Cmd+Enter (mac) inside the textarea triggers onRun', () => {
    const onRun = vi.fn()
    const tree = renderToTree(baseProps({ onRun })) as AnyNode
    const textarea = findByTestId(tree, 'cad-editor-textarea')
    const handler = (
      textarea?.props as {
        onKeyDown?: (e: {
          key: string
          ctrlKey: boolean
          metaKey: boolean
          preventDefault: () => void
        }) => void
      } | undefined
    )?.onKeyDown
    handler!({ key: 'Enter', ctrlKey: false, metaKey: true, preventDefault: vi.fn() })
    expect(onRun).toHaveBeenCalledTimes(1)
  })

  it('plain Enter inside the textarea does NOT trigger onRun (newline still wins)', () => {
    const onRun = vi.fn()
    const tree = renderToTree(baseProps({ onRun })) as AnyNode
    const textarea = findByTestId(tree, 'cad-editor-textarea')
    const handler = (
      textarea?.props as {
        onKeyDown?: (e: {
          key: string
          ctrlKey: boolean
          metaKey: boolean
          preventDefault: () => void
        }) => void
      } | undefined
    )?.onKeyDown
    const preventDefault = vi.fn()
    handler!({ key: 'Enter', ctrlKey: false, metaKey: false, preventDefault })
    expect(onRun).not.toHaveBeenCalled()
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('Ctrl+Enter is a no-op when busy=true so the sidecar never sees overlapping runs', () => {
    const onRun = vi.fn()
    const tree = renderToTree(baseProps({ onRun, busy: true })) as AnyNode
    const textarea = findByTestId(tree, 'cad-editor-textarea')
    const handler = (
      textarea?.props as {
        onKeyDown?: (e: {
          key: string
          ctrlKey: boolean
          metaKey: boolean
          preventDefault: () => void
        }) => void
      } | undefined
    )?.onKeyDown
    const preventDefault = vi.fn()
    handler!({ key: 'Enter', ctrlKey: true, metaKey: false, preventDefault })
    expect(onRun).not.toHaveBeenCalled()
    // preventDefault still fires so the shortcut never inserts a newline.
    expect(preventDefault).toHaveBeenCalledTimes(1)
  })

  it('does not throw and produces no console errors on a typical render', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      renderToStaticMarkup(createElement(CadQueryEditor, baseProps()))
      expect(errSpy).not.toHaveBeenCalled()
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      errSpy.mockRestore()
      warnSpy.mockRestore()
    }
  })
})
