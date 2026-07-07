/**
 * Pin: DS-scoped form controls inherit the `.ds` font (Hanken Grotesk).
 *
 * UA `<button>`/`<input>` don't inherit `font-family`, so without this reset
 * every `.ds-btn` / `.ds-input` renders in Arial despite the `.ds` root setting
 * Hanken — regressed silently until hands-on verification caught it on the Home
 * shell. Keep this reset (and its wiring into the CSS entry) in place.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (name: string): string => readFileSync(resolve(__dirname, name), 'utf8')

describe('DS control-font reset — ds-controls.css', () => {
  it('re-homes .ds buttons/inputs onto the inherited (Hanken) font', () => {
    const css = read('ds-controls.css')
    expect(css).toContain('.ds button')
    expect(css).toContain('.ds input')
    expect(css).toContain('font-family: inherit;')
  })

  it('is wired into the CSS entry after the DS component recipes', () => {
    const index = readFileSync(resolve(__dirname, '..', 'index.css'), 'utf8')
    const componentsAt = index.indexOf("ds/ds-components.css")
    const controlsAt = index.indexOf("ds/ds-controls.css")
    expect(componentsAt).toBeGreaterThanOrEqual(0)
    expect(controlsAt).toBeGreaterThan(componentsAt)
  })
})
