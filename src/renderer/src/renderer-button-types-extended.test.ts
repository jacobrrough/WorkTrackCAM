/**
 * Cycle 71 ui-polish [ID-0152-extended] -- defensive regression pin: every
 * `<button ...>` opening tag in `src/renderer/src/**\/*.tsx` MUST carry an
 * explicit `type="button"`. This extends the Cycle 62 [ID-0152-followup]
 * pin (which only covered the ShopApp.tsx toolbar `tb-btn` family) to the
 * full renderer source tree -- ConfirmDialog, FeedsCalcModal, HelpPanel,
 * LeftPanel, LibraryView, SettingsView, ShopApp non-toolbar, and
 * ToolLibraryPanel.
 *
 * Why the latent bug matters
 * --------------------------
 * HTML `<button>` defaults to `type="submit"`. None of the buttons in
 * the renderer sit inside a `<form>` today, so the latent-submit bug
 * never actually fires -- but if a future cycle ever wraps a region in a
 * `<form>` (e.g. for a job-name validation flow or a Library import
 * wizard with native validation), every un-typed button inside that
 * form would silently become a submit button and trigger an accidental
 * page reload (or worse, navigate away from unsaved work).
 *
 * Cycle-history context
 * ---------------------
 *   - Cycle 61 [ID-0152]: brand-bar machine badge (1 button) fixed +
 *     pinned via `shop-app-toolbar-button-types.test.ts`.
 *   - Cycle 62 [ID-0152-followup]: 7 toolbar `tb-btn` buttons fixed,
 *     same test extended to cover them.
 *   - Cycle 71 [ID-0152-extended] (THIS pin): the remaining 62 non-tb
 *     buttons across the renderer fixed in one Python-via-bash atomic
 *     pass; this test pins the invariant for every .tsx in the renderer
 *     source so a future drop-back is caught at the test level, not at
 *     the operator's keyboard.
 *
 * Implementation
 * --------------
 * Walks `src/renderer/src/**\/*.tsx`, parses every `<button` opening
 * tag with brace-balance + quote tracking (so JSX expression containers
 * `{...}` with nested braces do not confuse the regex), and asserts
 * each tag contains the literal substring `type="button"` somewhere
 * before the opening tag's closing `>`. Children are not inspected.
 *
 * The walker is intentionally written from scratch (rather than
 * imported from `shop-app-toolbar-button-types.test.ts`) so the two
 * tests stay independent -- a regression that breaks the helper here
 * cannot silently take down the toolbar pin.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const RENDERER_ROOT = join(process.cwd(), 'src/renderer/src')

/**
 * Recursively collect every `.tsx` file under `dir`. Excludes test
 * files (`*.test.ts`, `*.test.tsx`) so the walker does not assert on
 * test-fixture buttons that are intentionally typeless or commented
 * out for negative-case assertions.
 */
function listTsxFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      out.push(...listTsxFiles(full))
    } else if (name.endsWith('.tsx') && !name.endsWith('.test.tsx')) {
      out.push(full)
    }
  }
  return out
}

/**
 * Walk every `<button ...>` opening tag in `src` with brace-balance +
 * quote tracking. Returns the literal text of each opening tag from
 * `<` through the closing `>`.
 */
function extractButtonOpeningTags(src: string): string[] {
  const tags: string[] = []
  let i = 0
  while (i < src.length) {
    const next = src.indexOf('<button', i)
    if (next < 0) break
    const after = src[next + '<button'.length]
    if (after !== ' ' && after !== '\t' && after !== '\n' && after !== '>' && after !== '\r') {
      i = next + 1
      continue
    }
    let j = next + '<button'.length
    let depth = 0
    let inSingle = false
    let inDouble = false
    while (j < src.length) {
      const c = src[j]
      if (inSingle) {
        if (c === "'") inSingle = false
      } else if (inDouble) {
        if (c === '"') inDouble = false
      } else if (depth === 0) {
        if (c === '>') break
        if (c === '{') depth = 1
        else if (c === "'") inSingle = true
        else if (c === '"') inDouble = true
      } else {
        if (c === '{') depth += 1
        else if (c === '}') depth -= 1
      }
      j += 1
    }
    if (j >= src.length) {
      throw new Error(`Unterminated <button opening tag at offset ${next}`)
    }
    tags.push(src.slice(next, j + 1))
    i = j + 1
  }
  return tags
}

function hasExplicitButtonType(tag: string): boolean {
  return tag.includes('type="button"')
}

describe('renderer-wide button type="button" pin [ID-0152-extended]', () => {
  const files = listTsxFiles(RENDERER_ROOT)

  it('discovers at least 5 .tsx files (smoke check that the tree walker is alive)', () => {
    expect(files.length).toBeGreaterThanOrEqual(5)
  })

  it('every <button opening tag in every .tsx file has explicit type="button"', () => {
    type Offender = { file: string; lineNumber: number; tag: string }
    const offenders: Offender[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf-8')
      const tags = extractButtonOpeningTags(src)
      for (const tag of tags) {
        if (hasExplicitButtonType(tag)) continue
        const offsetInSrc = src.indexOf(tag)
        const lineNumber = offsetInSrc < 0 ? -1 : src.slice(0, offsetInSrc).split('\n').length
        offenders.push({
          file: file.slice(file.indexOf('src/renderer/src')),
          lineNumber,
          tag: tag.slice(0, 140).replace(/\s+/g, ' ')
        })
      }
    }
    const diag = offenders
      .map((o) => `${o.file}:${o.lineNumber}  ${o.tag}`)
      .join('\n  ')
    expect(
      offenders.length,
      `Buttons missing explicit type="button":\n  ${diag}`
    ).toBe(0)
  })

  it('finds at least 60 button opening tags across the renderer (regression-floor pin)', () => {
    let total = 0
    for (const file of files) {
      total += extractButtonOpeningTags(readFileSync(file, 'utf-8')).length
    }
    // Cycle 71 baseline: 62 buttons in non-toolbar renderer + 13 toolbar
    // tb-btn / tb-machine-badge in ShopApp.tsx (tb-btn family pinned by
    // a sibling test) = 75 minimum. Floor at 60 to allow conditional-render
    // variants the parser counts once per source occurrence.
    expect(total).toBeGreaterThanOrEqual(60)
  })

  it('the parser correctly handles brace-balanced JSX attributes (regression smoke)', () => {
    // Synthetic input that would trip a naive regex: a JSX expression
    // container with a nested object literal.
    const src = '<button type="button" className={`x${cond ? "a" : "b"}`} onClick={() => { foo({ k: 1 }) }}>OK</button>'
    const tags = extractButtonOpeningTags(src)
    expect(tags.length).toBe(1)
    expect(tags[0]).toContain('type="button"')
    expect(tags[0].endsWith('>')).toBe(true)
  })

  it('the per-file walker does not double-count nested buttons inside expression containers', () => {
    // Synthetic input: a button that LOOKS like it has a nested <button
    // string but it is actually inside a string literal. We use a string
    // attribute value so the brace-walker does not enter, then verify the
    // walker still finds exactly one outer <button.
    const src = '<button type="button" title="this <button looks fake">X</button>'
    const tags = extractButtonOpeningTags(src)
    // Exactly one outer button. (The inner "<button" is inside a quoted
    // string attribute; the walker tracks quote state and does not match.)
    expect(tags.length).toBe(1)
  })
})
