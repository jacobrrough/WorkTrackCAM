/**
 * my-shop-css-pin.test.ts — CSS-presence pin for My Shop component classes.
 *
 * Wave C agent (MyShop drawer CSS) landed rules for `wt-myshop-btn`,
 * `my-shop-panel`, and `my-shop-card` in `components.css`.  This pin
 * file guards against accidental deletion or class renames the same way
 * the PlateTabs Wave-2 W3 CSS-presence tests guard manufacture.css:
 * read the file from disk, assert the exact selector strings are present.
 *
 * Mirrors the pattern in:
 *   src/renderer/manufacture/PlateTabs.test.tsx
 *   (describe 'PlateTabs Wave-2 W3 -- layer-slider + toolpath-stats CSS presence')
 *
 * Token-driven only — all rules in the appended block use var(--*) tokens;
 * no hard-coded colors or px values outside the layout geometry.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

function readComponentsCss(): string {
  const cssPath = resolve(__dirname, 'components.css')
  return readFileSync(cssPath, 'utf8')
}

// ---------------------------------------------------------------------------
// TopBar trigger button
// ---------------------------------------------------------------------------

describe('My Shop CSS pin — wt-myshop-btn (TopBar trigger)', () => {
  it('components.css contains .wt-myshop-btn base block', () => {
    const css = readComponentsCss()
    expect(css).toContain('.wt-myshop-btn {')
  })

  it('components.css contains .wt-myshop-btn:hover', () => {
    const css = readComponentsCss()
    expect(css).toContain('.wt-myshop-btn:hover {')
  })

  it('components.css contains .wt-myshop-btn:focus-visible', () => {
    const css = readComponentsCss()
    expect(css).toContain('.wt-myshop-btn:focus-visible {')
  })

  it('components.css contains .wt-myshop-btn__icon', () => {
    const css = readComponentsCss()
    expect(css).toContain('.wt-myshop-btn__icon {')
  })
})

// ---------------------------------------------------------------------------
// Panel root + header
// ---------------------------------------------------------------------------

describe('My Shop CSS pin — my-shop-panel', () => {
  it('components.css contains .my-shop-panel base block', () => {
    const css = readComponentsCss()
    expect(css).toContain('.my-shop-panel {')
  })

  it('components.css contains .my-shop-panel__header', () => {
    const css = readComponentsCss()
    expect(css).toContain('.my-shop-panel__header {')
  })

  it('components.css contains .my-shop-panel__title', () => {
    const css = readComponentsCss()
    expect(css).toContain('.my-shop-panel__title {')
  })

  it('components.css contains .my-shop-panel__sub', () => {
    const css = readComponentsCss()
    expect(css).toContain('.my-shop-panel__sub {')
  })

  it('components.css contains .my-shop-panel__grid', () => {
    const css = readComponentsCss()
    expect(css).toContain('.my-shop-panel__grid {')
  })

  it('components.css contains .my-shop-panel__footer', () => {
    const css = readComponentsCss()
    expect(css).toContain('.my-shop-panel__footer {')
  })

  it('components.css contains .my-shop-panel__preset-count', () => {
    const css = readComponentsCss()
    expect(css).toContain('.my-shop-panel__preset-count {')
  })
})

// ---------------------------------------------------------------------------
// Machine card base + modifiers
// ---------------------------------------------------------------------------

describe('My Shop CSS pin — my-shop-card base + modifiers', () => {
  it('components.css contains .my-shop-card base block', () => {
    const css = readComponentsCss()
    expect(css).toContain('.my-shop-card {')
  })

  it('components.css contains .my-shop-card:hover', () => {
    const css = readComponentsCss()
    expect(css).toContain('.my-shop-card:hover {')
  })

  it('components.css contains .my-shop-card--current modifier', () => {
    const css = readComponentsCss()
    expect(css).toContain('.my-shop-card--current {')
  })

  it('components.css contains .my-shop-card--uninstalled modifier', () => {
    const css = readComponentsCss()
    expect(css).toContain('.my-shop-card--uninstalled {')
  })
})

// ---------------------------------------------------------------------------
// Machine card elements
// ---------------------------------------------------------------------------

describe('My Shop CSS pin — my-shop-card elements', () => {
  it('components.css contains .my-shop-card__header', () => {
    const css = readComponentsCss()
    expect(css).toContain('.my-shop-card__header {')
  })

  it('components.css contains .my-shop-card__glyph', () => {
    const css = readComponentsCss()
    expect(css).toContain('.my-shop-card__glyph {')
  })

  it('components.css contains .my-shop-card__titleblock', () => {
    const css = readComponentsCss()
    expect(css).toContain('.my-shop-card__titleblock {')
  })

  it('components.css contains .my-shop-card__name', () => {
    const css = readComponentsCss()
    expect(css).toContain('.my-shop-card__name {')
  })

  it('components.css contains .my-shop-card__env', () => {
    const css = readComponentsCss()
    expect(css).toContain('.my-shop-card__env {')
  })

  it('components.css contains .my-shop-card__badge', () => {
    const css = readComponentsCss()
    expect(css).toContain('.my-shop-card__badge {')
  })

  it('components.css contains .my-shop-card__specs', () => {
    const css = readComponentsCss()
    expect(css).toContain('.my-shop-card__specs {')
  })

  it('components.css contains .my-shop-card__presets', () => {
    const css = readComponentsCss()
    expect(css).toContain('.my-shop-card__presets {')
  })
})

// ---------------------------------------------------------------------------
// Preset buttons + install affordance
// ---------------------------------------------------------------------------

describe('My Shop CSS pin — preset buttons + install affordance', () => {
  it('components.css contains .my-shop-card__preset-btn base block', () => {
    const css = readComponentsCss()
    expect(css).toContain('.my-shop-card__preset-btn {')
  })

  it('components.css contains .my-shop-card__preset-btn:hover:not(:disabled)', () => {
    const css = readComponentsCss()
    expect(css).toContain('.my-shop-card__preset-btn:hover:not(:disabled) {')
  })

  it('components.css contains .my-shop-card__preset-btn:focus-visible', () => {
    const css = readComponentsCss()
    expect(css).toContain('.my-shop-card__preset-btn:focus-visible {')
  })

  it('components.css contains .my-shop-card__preset-btn:disabled', () => {
    const css = readComponentsCss()
    expect(css).toContain('.my-shop-card__preset-btn:disabled {')
  })

  it('components.css contains .my-shop-card__preset-label', () => {
    const css = readComponentsCss()
    expect(css).toContain('.my-shop-card__preset-label {')
  })

  it('components.css contains .my-shop-card__preset-desc', () => {
    const css = readComponentsCss()
    expect(css).toContain('.my-shop-card__preset-desc {')
  })

  it('components.css contains .my-shop-card__install-btn base block', () => {
    const css = readComponentsCss()
    expect(css).toContain('.my-shop-card__install-btn {')
  })

  it('components.css contains .my-shop-card__install-btn:hover', () => {
    const css = readComponentsCss()
    expect(css).toContain('.my-shop-card__install-btn:hover {')
  })

  it('components.css contains .my-shop-card__install-btn:focus-visible', () => {
    const css = readComponentsCss()
    expect(css).toContain('.my-shop-card__install-btn:focus-visible {')
  })
})

// ---------------------------------------------------------------------------
// Token discipline — no hard-coded hex colors in the My Shop block
// ---------------------------------------------------------------------------

describe('My Shop CSS pin — token discipline (no hard-coded colors)', () => {
  /**
   * Extract just the My Shop section from components.css (from the first
   * "wt-myshop" or "my-shop" selector onward) to avoid false positives from
   * pre-existing legacy hex values in sibling blocks.
   */
  function myShopBlock(): string {
    const css = readComponentsCss()
    const marker = '/* ── My Shop trigger button'
    const idx = css.indexOf(marker)
    return idx === -1 ? '' : css.slice(idx)
  }

  it('My Shop block exists in components.css (marker comment present)', () => {
    expect(myShopBlock().length).toBeGreaterThan(0)
  })

  it('My Shop block does not contain hard-coded hex color values', () => {
    // Hex color = # followed by 3, 4, 6, or 8 hex digits that are NOT
    // inside a CSS comment or var() reference.  The existing pre-My-Shop
    // blocks intentionally use a small number of literal hex values; we
    // only enforce token discipline for the new block.
    const block = myShopBlock()
    // Strip CSS line comments first so /* #aabbcc */ explanatory comments
    // don't trigger the assertion.
    const noComments = block.replace(/\/\*[\s\S]*?\*\//g, '')
    // Now reject any bare # color that's NOT already inside var(…).
    // Strategy: remove all var(…) occurrences, then look for # + hex digits.
    const noVars = noComments.replace(/var\([^)]+\)/g, '')
    expect(noVars).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })
})
