/**
 * Cycle 89 ui-polish [ID-0175] -- renderer-wide `<svg>` accessibility pin.
 *
 * Extends the Cycle 71 [ID-0152-extended] / Cycle 74 [ID-0163] / Cycle 80
 * [ID-0167] brace-balance walker family with a fifth element class:
 * inline `<svg>` elements. WCAG 2.1 AA (1.1.1 Non-text Content) requires
 * every non-text image, including inline SVG, to carry either:
 *
 *   1. an `aria-hidden="true"` attribute -- the SVG is purely decorative
 *      and the screen-reader skip is correct (the relevant information
 *      is conveyed through surrounding accessible labels), OR
 *   2. a `role="img"` + `aria-label="..."` attribute pair -- the SVG is
 *      semantically meaningful and must be named for screen readers.
 *
 * An SVG with NEITHER attribute is a WCAG 2.1 1.1.1 violation: most screen
 * readers will either silently skip it or read out the raw element name,
 * yielding either missing or garbage output for users who depend on
 * assistive technology.
 *
 * Cycle 89 baseline: 1 inline `<svg>` element (the post-arrangement
 * visual diagram in `LeftPanel.tsx`). It is decorative -- the post count,
 * diameter, and offset radius are conveyed through the labelled inputs
 * immediately below the diagram -- so it gets `aria-hidden="true"`. The
 * pin then locks in 0 violations forever.
 *
 * Why a separate file from Cycle 80`s pin?
 * ----------------------------------------
 * `<select>` and `<textarea>` share the React controlled-vs-uncontrolled
 * defect class. `<svg>` is a different defect class (WCAG 2.1 a11y, not
 * React state). Keeping each defect class in its own file means a
 * regression in one walker cannot silently take down the other; each
 * test is independent and fails with focused diagnostics.
 *
 * Cycle-history context (renderer-wide defensive-attribute pin family)
 * --------------------------------------------------------------------
 *   - Cycle 61 [ID-0152]: brand-bar machine badge button.
 *   - Cycle 62 [ID-0152-followup]: 7 toolbar `tb-btn` buttons.
 *   - Cycle 71 [ID-0152-extended]: 62 non-toolbar `<button>` elements.
 *   - Cycle 74 [ID-0163]: untyped `<input>` + `<img>` defensive pin.
 *   - Cycle 80 [ID-0167]: `<select>` + `<textarea>` controlled-or-defaulted.
 *   - Cycle 89 [ID-0175] (THIS pin): `<svg>` aria-hidden-or-labelled.
 *
 * Implementation
 * --------------
 * Walks `src/renderer/src/**\/*.tsx`, parses every `<svg` opening tag with
 * brace-balance + quote tracking (so JSX expression containers `{...}`
 * with nested braces, and quoted attribute values containing brackets/
 * angles, do not confuse the regex).
 *
 * The walker is intentionally a fresh implementation rather than an
 * import from prior pin files so the test stays independent: a refactor
 * that breaks one walker cannot silently take down the other.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const RENDERER_ROOT = join(process.cwd(), 'src/renderer/src')

/**
 * Recursively collect every `.tsx` file under `dir`. Excludes test files
 * (`*.test.tsx`) so the walker does not assert on test-fixture SVGs that
 * may be intentionally bare for negative-case assertions.
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
 * Walk every `<NAME ...>` opening tag in `src` with brace-balance +
 * quote tracking. Returns the literal text of each opening tag from
 * `<` through the closing `>`. Tag-name match requires that the
 * character immediately after the name is whitespace, `>`, or `/` (so
 * `<svgelement>` does NOT match `<svg`).
 */
function extractOpeningTags(src: string, name: string): string[] {
  const tags: string[] = []
  const needle = '<' + name
  let i = 0
  while (i < src.length) {
    const next = src.indexOf(needle, i)
    if (next < 0) break
    const after = src[next + needle.length]
    if (
      after !== ' ' &&
      after !== '\t' &&
      after !== '\n' &&
      after !== '\r' &&
      after !== '>' &&
      after !== '/'
    ) {
      i = next + 1
      continue
    }
    let j = next + needle.length
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
      throw new Error(`Unterminated <${name} opening tag at offset ${next}`)
    }
    tags.push(src.slice(next, j + 1))
    i = j + 1
  }
  return tags
}

function hasAttribute(tag: string, attrName: string): boolean {
  // Match `<attr>=` somewhere in the tag, with whitespace or `{` before it.
  // Avoids substring false-positives like `data-role=` matching `role=`.
  const re = new RegExp(`(^|[\\s{])${attrName}\\s*=`)
  return re.test(tag)
}

function getAttributeValue(tag: string, attrName: string): string | null {
  // Returns the string value of an attribute literal, or null if not
  // found / not a string literal. Only recognizes "quoted" or 'quoted'
  // values; JSX expression containers (`attr={expr}`) return null.
  const re = new RegExp(`(?:^|[\\s{])${attrName}\\s*=\\s*("([^"]*)"|'([^']*)')`)
  const m = tag.match(re)
  if (!m) return null
  return m[2] !== undefined ? m[2] : (m[3] ?? null)
}

describe('renderer-wide <svg> accessibility pin [ID-0175]', () => {
  const files = listTsxFiles(RENDERER_ROOT)

  it('discovers at least 5 .tsx files (smoke check that the tree walker is alive)', () => {
    expect(files.length).toBeGreaterThanOrEqual(5)
  })

  it('every <svg opening tag has aria-hidden="true" OR (role="img" + aria-label="..."}', () => {
    type Offender = { file: string; lineNumber: number; tag: string; reason: string }
    const offenders: Offender[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf-8')
      const tags = extractOpeningTags(src, 'svg')
      for (const tag of tags) {
        const ariaHiddenLiteral = getAttributeValue(tag, 'aria-hidden')
        const ariaHiddenIsLiteralTrue = ariaHiddenLiteral === 'true'
        const role = getAttributeValue(tag, 'role')
        const hasAriaLabel = hasAttribute(tag, 'aria-label')
        const isLabelledImg = role === 'img' && hasAriaLabel
        if (ariaHiddenIsLiteralTrue) continue
        if (isLabelledImg) continue
        // Determine the most informative reason
        let reason: string
        if (!hasAttribute(tag, 'aria-hidden') && !hasAttribute(tag, 'role')) {
          reason = 'missing aria-hidden AND role'
        } else if (hasAttribute(tag, 'aria-hidden') && !ariaHiddenIsLiteralTrue) {
          reason = `aria-hidden present but not literal "true" (got ${ariaHiddenLiteral === null ? 'JSX-expr' : `"${ariaHiddenLiteral}"`})`
        } else if (role !== 'img') {
          reason = `role present but not "img" (got ${role === null ? 'JSX-expr' : `"${role}"`})`
        } else {
          reason = 'role="img" but missing aria-label'
        }
        const offsetInSrc = src.indexOf(tag)
        const lineNumber =
          offsetInSrc < 0 ? -1 : src.slice(0, offsetInSrc).split('\n').length
        offenders.push({
          file: file.slice(file.indexOf('src/renderer/src')),
          lineNumber,
          tag: tag.slice(0, 140).replace(/\s+/g, ' '),
          reason
        })
      }
    }
    const diag = offenders
      .map((o) => `${o.file}:${o.lineNumber}  [${o.reason}]  ${o.tag}`)
      .join('\n  ')
    expect(
      offenders.length,
      `<svg> tags missing accessibility attributes (WCAG 2.1 1.1.1 risk):\n  ${diag}`
    ).toBe(0)
  })

  it('finds at least 1 <svg> opening tag across the renderer (regression-floor pin)', () => {
    // Cycle 89 baseline: 1 <svg> tag (LeftPanel.tsx post-arrangement
    // visual diagram, fixed up with aria-hidden="true" in this cycle).
    // Floor at 1 to detect the accidental removal of the only currently
    // pinned SVG (which would suggest the walker is broken or the
    // diagram was deleted entirely).
    let total = 0
    for (const file of files) {
      total += extractOpeningTags(readFileSync(file, 'utf-8'), 'svg').length
    }
    expect(total).toBeGreaterThanOrEqual(1)
  })

  it('the LeftPanel post-arrangement diagram specifically has aria-hidden="true"', () => {
    // Anchor pin for the only SVG currently in the renderer: explicitly
    // assert the production fix landed in this cycle survives.
    const leftPanelSrc = readFileSync(
      join(RENDERER_ROOT, 'LeftPanel.tsx'),
      'utf-8'
    )
    const tags = extractOpeningTags(leftPanelSrc, 'svg')
    expect(tags.length).toBe(1)
    expect(getAttributeValue(tags[0], 'aria-hidden')).toBe('true')
  })
})

describe('walker brace-balance + quote regressions [ID-0175]', () => {
  it('the walker correctly handles brace-balanced JSX expression containers for <svg>', () => {
    // Synthetic SVG that would trip a naive regex: a JSX expression
    // container with a nested object literal in a style prop.
    const src =
      '<svg width={size} aria-hidden="true" style={{ fill: theme.color, stroke: "black" }}>x</svg>'
    const tags = extractOpeningTags(src, 'svg')
    expect(tags.length).toBe(1)
    expect(tags[0]).toContain('aria-hidden="true"')
    expect(tags[0].endsWith('>')).toBe(true)
  })

  it('the walker treats quoted attribute values opaquely (does not parse JSX inside strings)', () => {
    // Synthetic: a string attribute containing what looks like JSX.
    const src =
      '<svg aria-hidden="true" data-note="this <svg width={y}> is fake" />'
    const tags = extractOpeningTags(src, 'svg')
    expect(tags.length).toBe(1)
    expect(getAttributeValue(tags[0], 'aria-hidden')).toBe('true')
  })

  it('hasAttribute does not false-positive on substring-shaped attribute names', () => {
    // `data-role=` should NOT count as `role=`. The hasAttribute helper
    // requires whitespace or `{` before the attribute name to prevent
    // this mis-match.
    const tag1 = '<svg data-role="visual" />'
    const tag2 = '<svg role="img" aria-label="x" />'
    expect(hasAttribute(tag1, 'role')).toBe(false)
    expect(hasAttribute(tag2, 'role')).toBe(true)
  })

  it('the tag-name match excludes false-positive prefixes (e.g. <svgelement)', () => {
    const src = '<svgelement name="foo" />'
    expect(extractOpeningTags(src, 'svg')).toEqual([])
  })

  it('getAttributeValue returns the literal string value for double-quoted attributes', () => {
    const tag = '<svg role="img" aria-label="post layout diagram" />'
    expect(getAttributeValue(tag, 'role')).toBe('img')
    expect(getAttributeValue(tag, 'aria-label')).toBe('post layout diagram')
  })

  it('getAttributeValue returns the literal string value for single-quoted attributes', () => {
    const tag = "<svg role='img' aria-label='diagram' />"
    expect(getAttributeValue(tag, 'role')).toBe('img')
    expect(getAttributeValue(tag, 'aria-label')).toBe('diagram')
  })

  it('getAttributeValue returns null for JSX expression-container values (cannot pin literally)', () => {
    // We intentionally only accept literal string attributes for the
    // pin-zero check: a JSX-expr aria-hidden={someBoolean} is opaque to
    // a static pin and should be treated as "unable to confirm" (which
    // the test interprets as a failure, forcing the author to either
    // make it a literal "true" or move to role="img" + aria-label).
    const tag = '<svg aria-hidden={isDecorative} />'
    expect(getAttributeValue(tag, 'aria-hidden')).toBe(null)
  })

  it('the literal-only aria-hidden gate rejects JSX-expr values to prevent silent flips', () => {
    // The contract is: only `aria-hidden="true"` (literal string) counts.
    // A future regression that switches the existing literal to a JSX
    // expression would drop screen-reader hiding when the boolean
    // happens to be false; the pin catches this by demanding the literal.
    const decorative = '<svg aria-hidden="true" />'
    const expr = '<svg aria-hidden={true} />'
    const trueIsh = '<svg aria-hidden="True" />'
    expect(getAttributeValue(decorative, 'aria-hidden')).toBe('true')
    expect(getAttributeValue(expr, 'aria-hidden')).toBe(null)
    // Case-sensitive: "True" / "TRUE" do NOT count (HTML aria values are
    // case-insensitive in practice but React forwards them verbatim, and
    // some screen readers do case-sensitive parsing -- pin the canonical
    // lowercase form to be safe).
    expect(getAttributeValue(trueIsh, 'aria-hidden')).toBe('True')
  })
})
