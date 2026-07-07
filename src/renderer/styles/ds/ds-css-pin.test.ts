/**
 * ds-css-pin.test.ts — presence pins for the vendored @worktrack/design-system
 * CSS: the `.ds-*` component recipes, the `--c-*` token bridge across all 10
 * WorkTrack themes, and the self-hosted @font-face block.
 *
 * Same pattern as my-shop-css-pin.test.ts: read the files from disk and assert
 * exact selector/token strings so a rename or accidental deletion fails loudly.
 * The native component port (ds/__tests__/ds-primitives.test.tsx) proves the
 * primitives emit these classes; this proves the classes still have recipes.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { THEME_IDS } from '../../theme/theme-registry'

const __dirname = dirname(fileURLToPath(import.meta.url))
const read = (name: string): string => readFileSync(resolve(__dirname, name), 'utf8')

describe('DS component recipes — ds-components.css', () => {
  const css = read('ds-components.css')
  const RECIPES = [
    '.ds-btn {',
    '.ds-btn-primary',
    '.ds-btn-secondary',
    '.ds-btn-danger',
    '.ds-btn--sm',
    '.ds-btn--lg',
    '.ds-card {',
    '.ds-card-interactive',
    '.ds-primary-card',
    '.ds-list-row',
    '.ds-input',
    '.ds-icon-btn',
    '.ds-icon-btn--sm',
    '.ds-icon-badge',
    '.ds-icon-badge--accent',
    '.ds-header',
    '.ds-brand-mark',
    '.ds-display',
    '.ds-section-title',
    '.ds-eyebrow',
    '.ds-modal-backdrop'
  ]
  it.each(RECIPES)('defines %s', (sel) => {
    expect(css).toContain(sel)
  })

  it('scopes recipes under .ds and drives them off --c-* tokens', () => {
    expect(css).toContain('.ds {')
    expect(css).toContain('rgb(var(--c-')
  })
})

describe('DS token bridge — ds-tokens.css', () => {
  const css = read('ds-tokens.css')

  it('defines the global destructive fill on :root', () => {
    expect(css).toContain('--c-danger: 220 38 38;')
    expect(css).toContain('--c-on-danger: 255 255 255;')
  })

  it.each(THEME_IDS)("bridges the core --c-* tokens for [data-theme='%s']", (id) => {
    const block = css.slice(css.indexOf(`[data-theme='${id}']`))
    // core tokens the recipes consume must all be present in the block
    for (const tok of ['--c-bg:', '--c-surface:', '--c-border:', '--c-text:', '--c-accent:', '--c-on-accent:']) {
      expect(block.startsWith(`[data-theme='${id}']`)).toBe(true)
      expect(block).toContain(tok)
    }
  })

  it('bridges per-environment accent overrides so DS accent follows the workspace', () => {
    for (const env of ['design', 'vcarve_pro', 'creality_print', 'makera_cam']) {
      expect(css).toContain(`[data-environment='${env}']`)
    }
    expect(css).toContain('--c-accent: 124 92 255;') // design env = purple
  })

  it('emits RGB channel triples, never hex or var() indirection', () => {
    // every --c-<name> token value is three integers (so rgb(var(--c-x)/a) works)
    const decls = css.match(/--c-[a-z0-9-]+:\s*[^;]+;/g) ?? []
    expect(decls.length).toBeGreaterThan(50)
    for (const d of decls) {
      const value = d.slice(d.indexOf(':') + 1).replace(';', '').trim()
      expect(value).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/)
    }
  })
})

describe('DS typography — fonts.css', () => {
  const css = read('fonts.css')
  it('self-hosts Hanken + Schibsted Grotesk from bundled woff2', () => {
    expect(css).toContain("font-family: 'Hanken Grotesk'")
    expect(css).toContain("font-family: 'Schibsted Grotesk'")
    expect(css).toContain('.woff2')
    expect(css).toContain("format('woff2')")
  })
  it('declares the four Hanken weights + Schibsted 800', () => {
    for (const w of [400, 500, 600, 700, 800]) {
      expect(css).toContain(`font-weight: ${w};`)
    }
  })
})
