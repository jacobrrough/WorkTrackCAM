/**
 * EmptyState — shared component render-pin (UX Overhaul #8).
 *
 * Uses `react-dom/server.renderToStaticMarkup` so the suite runs in the
 * existing `node` vitest environment without a jsdom dependency
 * (matches the WorkshopDashboard / MoonrakerPreviewBanner pattern).
 *
 * The contract this pin protects:
 *   - The root container always carries the BEM `.empty-state` class so
 *     Agent G's CSS hooks bind correctly.
 *   - The title element always renders.
 *   - The icon / body / CTA slots are gated on their props being present.
 *   - The CTA button is a real `<button type="button">` so default form
 *     submit behavior never fires inside a form.
 *   - The CTA variant maps to the correct `.btn-*` modifier class.
 *   - The optional `testId` lands as `data-testid` on the root.
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { EmptyState } from './EmptyState'

describe('EmptyState — shared component contract', () => {
  it('renders the BEM root class and the title', () => {
    const html = renderToStaticMarkup(
      createElement(EmptyState, { title: 'Nothing here yet' })
    )
    expect(html).toContain('class="empty-state"')
    expect(html).toContain('class="empty-state__title"')
    expect(html).toContain('Nothing here yet')
  })

  it('omits icon / body / cta when their props are not supplied', () => {
    const html = renderToStaticMarkup(
      createElement(EmptyState, { title: 'No data' })
    )
    expect(html).not.toContain('empty-state__icon')
    expect(html).not.toContain('empty-state__body')
    expect(html).not.toContain('empty-state__cta')
    expect(html).not.toContain('<button')
  })

  it('renders the icon slot when an icon node is passed', () => {
    const html = renderToStaticMarkup(
      createElement(EmptyState, {
        title: 'No jobs',
        icon: createElement('span', { 'data-testid': 'icon-glyph' }, '!')
      })
    )
    expect(html).toContain('class="empty-state__icon"')
    expect(html).toContain('data-testid="icon-glyph"')
    // The icon wrapper is hidden from assistive tech (decorative).
    expect(html).toMatch(/class="empty-state__icon"[^>]*aria-hidden="true"/)
  })

  it('renders the body slot when body is supplied', () => {
    const html = renderToStaticMarkup(
      createElement(EmptyState, {
        title: 'No jobs',
        body: 'Create your first project to begin.'
      })
    )
    expect(html).toContain('class="empty-state__body"')
    expect(html).toContain('Create your first project to begin.')
  })

  it('renders a real <button type="button"> when a CTA is supplied', () => {
    const html = renderToStaticMarkup(
      createElement(EmptyState, {
        title: 'No jobs',
        cta: { label: 'Create project', onClick: vi.fn(), variant: 'primary' }
      })
    )
    expect(html).toContain('class="empty-state__cta"')
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>/)
    expect(html).toContain('Create project')
  })

  it('CTA variant prop maps to the matching .btn-* modifier', () => {
    for (const [variant, klass] of [
      ['primary', 'btn-primary'],
      ['secondary', 'btn-secondary'],
      ['ghost', 'btn-ghost']
    ] as const) {
      const html = renderToStaticMarkup(
        createElement(EmptyState, {
          title: 'No jobs',
          cta: { label: 'Go', onClick: vi.fn(), variant }
        })
      )
      expect(html).toContain(`class="btn ${klass}"`)
    }
  })

  it('defaults the CTA variant to "secondary" when omitted', () => {
    const html = renderToStaticMarkup(
      createElement(EmptyState, {
        title: 'No jobs',
        cta: { label: 'Go', onClick: vi.fn() }
      })
    )
    expect(html).toContain('class="btn btn-secondary"')
  })

  it('forwards the optional testId as data-testid on the root', () => {
    const html = renderToStaticMarkup(
      createElement(EmptyState, {
        title: 'No jobs',
        testId: 'my-empty-state'
      })
    )
    expect(html).toMatch(/<div[^>]*class="empty-state"[^>]*data-testid="my-empty-state"/)
  })

  it('announces the surface to screen readers via role + aria-live', () => {
    const html = renderToStaticMarkup(
      createElement(EmptyState, { title: 'No jobs' })
    )
    // role="status" with aria-live="polite" — empty states are
    // informational, not blocking, so polite is the correct mode.
    expect(html).toMatch(/role="status"[^>]*aria-live="polite"/)
  })

  it('CTA onClick is wired through to the supplied callback', () => {
    const onClick = vi.fn()
    type AnyNode = {
      type?: unknown
      props?: { [k: string]: unknown; children?: unknown }
    }
    function findButton(node: unknown): AnyNode | null {
      if (!node || typeof node !== 'object') return null
      const n = node as AnyNode
      if (n.type === 'button') return n
      const children = n.props?.children
      if (children == null) return null
      const list = Array.isArray(children) ? children : [children]
      for (const c of list) {
        const found = findButton(c)
        if (found) return found
      }
      return null
    }
    const tree = (EmptyState as unknown as (
      p: Parameters<typeof EmptyState>[0]
    ) => React.ReactElement)({
      title: 'No jobs',
      cta: { label: 'Go', onClick, variant: 'primary' }
    })
    const btn = findButton(tree)
    expect(btn).not.toBeNull()
    const handler = (btn?.props as { onClick?: () => void } | undefined)?.onClick
    expect(typeof handler).toBe('function')
    handler!()
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
