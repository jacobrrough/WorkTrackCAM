/**
 * ds-primitives.test.ts — node-env render pins for the native DS component port.
 *
 * renderToStaticMarkup each primitive and assert it emits the exact `.ds-*`
 * recipe class (+ variant/size/modifier classes and prop pass-through) the
 * vendored CSS keys off. This is the source-of-truth for "the port produces the
 * same markup as the upstream bundle"; the CSS-presence pin (ds-css-pin.test.ts)
 * proves the recipes those classes hook still exist.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  Button,
  Card,
  PrimaryCard,
  ListRow,
  Input,
  IconButton,
  IconBadge,
  AppHeader,
  Brand,
  Display,
  SectionTitle,
  Eyebrow,
  DsScope
} from '..'

describe('DS Button', () => {
  it('defaults to primary fill with type=button and accent focus ring', () => {
    const html = renderToStaticMarkup(<Button>Go</Button>)
    expect(html).toContain('class="ds-btn ds-btn-primary ds-focus-on-accent"')
    expect(html).toContain('type="button"')
    expect(html).toContain('>Go</button>')
  })

  it('secondary variant drops the accent-fill focus class', () => {
    const html = renderToStaticMarkup(<Button variant="secondary">x</Button>)
    expect(html).toContain('ds-btn-secondary')
    expect(html).not.toContain('ds-focus-on-accent')
    expect(html).not.toContain('ds-btn-primary')
  })

  it('danger variant keeps the accent-fill focus class', () => {
    const html = renderToStaticMarkup(<Button variant="danger">x</Button>)
    expect(html).toContain('ds-btn-danger')
    expect(html).toContain('ds-focus-on-accent')
  })

  it('size sm/lg add the size modifier; md adds none', () => {
    expect(renderToStaticMarkup(<Button size="sm">x</Button>)).toContain('ds-btn--sm')
    expect(renderToStaticMarkup(<Button size="lg">x</Button>)).toContain('ds-btn--lg')
    const md = renderToStaticMarkup(<Button size="md">x</Button>)
    expect(md).not.toContain('ds-btn--sm')
    expect(md).not.toContain('ds-btn--lg')
  })

  it('block stretches to full width', () => {
    expect(renderToStaticMarkup(<Button block>x</Button>)).toContain('width:100%')
  })

  it('merges caller className and passes through arbitrary props', () => {
    const html = renderToStaticMarkup(
      <Button className="mine" data-testid="send" disabled>
        x
      </Button>
    )
    expect(html).toContain('ds-btn')
    expect(html).toContain('mine')
    expect(html).toContain('data-testid="send"')
    expect(html).toContain('disabled')
  })
})

describe('DS surfaces', () => {
  it('Card base + interactive modifier', () => {
    expect(renderToStaticMarkup(<Card />)).toContain('class="ds-card"')
    expect(renderToStaticMarkup(<Card interactive />)).toContain(
      'class="ds-card ds-card-interactive"'
    )
  })

  it('PrimaryCard / ListRow emit their recipe class', () => {
    expect(renderToStaticMarkup(<PrimaryCard />)).toContain('class="ds-primary-card"')
    expect(renderToStaticMarkup(<ListRow />)).toContain('class="ds-list-row"')
  })

  it('Input renders an <input> on the ds-input recipe and forwards attrs', () => {
    const html = renderToStaticMarkup(<Input placeholder="Search" value="6061" readOnly />)
    expect(html).toMatch(/^<input /)
    expect(html).toContain('class="ds-input"')
    expect(html).toContain('placeholder="Search"')
    expect(html).toContain('value="6061"')
  })
})

describe('DS icon controls', () => {
  it('IconButton size sm adds the modifier; md does not', () => {
    expect(renderToStaticMarkup(<IconButton size="sm" />)).toContain('ds-icon-btn--sm')
    expect(renderToStaticMarkup(<IconButton />)).toContain('class="ds-icon-btn"')
  })

  it('IconBadge accent adds the accent modifier', () => {
    expect(renderToStaticMarkup(<IconBadge />)).toContain('class="ds-icon-badge"')
    expect(renderToStaticMarkup(<IconBadge accent />)).toContain(
      'class="ds-icon-badge ds-icon-badge--accent"'
    )
  })
})

describe('DS header + brand', () => {
  it('AppHeader renders a <header> on the ds-header recipe', () => {
    const html = renderToStaticMarkup(<AppHeader />)
    expect(html).toMatch(/^<header /)
    expect(html).toContain('class="ds-header"')
  })

  it('Brand renders a masked mark with role=img and square sizing', () => {
    const html = renderToStaticMarkup(<Brand size={48} />)
    expect(html).toContain('class="ds-brand-mark"')
    expect(html).toContain('role="img"')
    expect(html).toContain('width:48px')
    expect(html).toContain('height:48px')
  })

  it('Brand src sets the --ds-brand-src custom property', () => {
    const html = renderToStaticMarkup(<Brand src="url(/logo.svg)" />)
    expect(html).toContain('--ds-brand-src:url(/logo.svg)')
  })
})

describe('DS type set', () => {
  it('Display defaults to h1, honours as=, keeps the recipe', () => {
    expect(renderToStaticMarkup(<Display>1.2</Display>)).toMatch(/^<h1 [^>]*ds-display/)
    expect(renderToStaticMarkup(<Display as="h3">1.2</Display>)).toMatch(/^<h3 /)
  })

  it('SectionTitle defaults to h2; Eyebrow is a span', () => {
    expect(renderToStaticMarkup(<SectionTitle>Stock</SectionTitle>)).toMatch(
      /^<h2 [^>]*ds-section-title/
    )
    expect(renderToStaticMarkup(<Eyebrow>role</Eyebrow>)).toMatch(/^<span [^>]*ds-eyebrow/)
  })
})

describe('DsScope', () => {
  it('renders the .ds boundary and opts into the page background', () => {
    expect(renderToStaticMarkup(<DsScope>x</DsScope>)).toContain('class="ds"')
    expect(renderToStaticMarkup(<DsScope appBg>x</DsScope>)).toContain('class="ds ds-app-bg"')
  })
})
