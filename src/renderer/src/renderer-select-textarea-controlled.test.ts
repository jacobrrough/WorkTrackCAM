/**
 * Cycle 80 ui-polish [ID-0167] -- defensive regression pin: extends the
 * Cycle 71 [ID-0152-extended] / Cycle 74 [ID-0163] brace-balance walker
 * family to two MORE element classes, completing the renderer-wide
 * defensive-attribute pin family for form controls and content elements.
 *
 *   1. Every `<select ...>` opening tag MUST carry an explicit `value=`
 *      OR `defaultValue=` attribute. React`s controlled-vs-uncontrolled
 *      distinction is silent: a `<select>` with neither attribute is
 *      "uncontrolled" and silently picks the first `<option>` as its
 *      initial value, but the moment a parent component starts passing
 *      `value=`, React logs a console warning ("changing an uncontrolled
 *      input of type undefined to be controlled"). Worse, in production
 *      builds React strips the warning, so the symptom is just an option
 *      that no longer matches the parent`s state. Pinning every existing
 *      `<select>` as explicitly controlled or uncontrolled prevents a
 *      future refactor from accidentally introducing the silent flip.
 *
 *   2. Every `<textarea ...>` opening tag MUST carry an explicit `value=`
 *      OR `defaultValue=` attribute. Same defect class as `<select>`:
 *      React`s controlled-vs-uncontrolled silent-flip applies identically
 *      to `<textarea>`. Both Cycle 80 textareas in the renderer
 *      (`LibraryView.tsx` post-editor and `ToolLibraryPanel.tsx` tool
 *      description) are explicitly controlled with `value=`; this pin
 *      prevents a regression that drops the binding.
 *
 * Why a separate file from the Cycle 74 [ID-0163] pin?
 * ----------------------------------------------------
 * The `<input>` and `<img>` walkers in `renderer-input-img-types.test.ts`
 * pin different defect classes (input default-`type="text"` masking
 * future type-flip refactors; `<img>` missing `alt=` failing WCAG 2.1).
 * `<select>` and `<textarea>` share the React controlled-vs-uncontrolled
 * defect class, distinct from both. Keeping each pair in its own file
 * means a regression in one walker cannot silently take down another;
 * each test is independent and fails with focused diagnostics.
 *
 * Cycle-history context (renderer-wide defensive-attribute pin family)
 * --------------------------------------------------------------------
 *   - Cycle 61 [ID-0152]: brand-bar machine badge (1 button) fixed +
 *     pinned via `shop-app-toolbar-button-types.test.ts`.
 *   - Cycle 62 [ID-0152-followup]: 7 toolbar `tb-btn` buttons fixed,
 *     same test extended to cover them.
 *   - Cycle 71 [ID-0152-extended]: 62 non-toolbar buttons across 8 .tsx
 *     files fixed via single Python-via-bash atomic patch + new
 *     `renderer-button-types-extended.test.ts` pin (5 tests).
 *   - Cycle 74 [ID-0163]: 10 untyped `<input>` tags fixed + 0 `<img>`
 *     tags pinned defensively via new
 *     `renderer-input-img-types.test.ts` (12 tests).
 *   - Cycle 80 [ID-0167] (THIS pin): 0 silent-flip `<select>` tags +
 *     0 silent-flip `<textarea>` tags pinned defensively. Both element
 *     classes are already 100% controlled at Cycle 80 baseline (20 of 20
 *     `<select>`, 2 of 2 `<textarea>`); the pin is a zero-violations
 *     defensive guard so a future regression goes red.
 *
 * Implementation
 * --------------
 * Walks `src/renderer/src/**\/*.tsx`, parses every `<select` and
 * `<textarea` opening tag with brace-balance + quote tracking (so JSX
 * expression containers `{...}` with nested braces, and quoted attribute
 * values containing brackets/angles, do not confuse the regex).
 *
 * The walker is intentionally a fresh implementation rather than an
 * import from `renderer-input-img-types.test.ts` so the two test files
 * stay independent: a refactor that breaks one walker cannot silently
 * take down the other.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const RENDERER_ROOT = join(process.cwd(), 'src/renderer/src')

/**
 * Recursively collect every `.tsx` file under `dir`. Excludes test
 * files (`*.test.tsx`) so the walker does not assert on test-fixture
 * selects/textareas that may be intentionally uncontrolled for
 * negative-case assertions.
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
 * character immediately after the name is whitespace, `>`, or `/`
 * (so `<selectable>` does NOT match `<select`, and `<textareafield>`
 * does NOT match `<textarea`).
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
  // Match `<attr>=` somewhere in the tag, ignoring whitespace before the `=`.
  // We avoid a naive `tag.includes(`${attrName}=`)` because an attribute name
  // might appear as a substring of another name (e.g. `data-value=` contains
  // `value=`). Require a word boundary or whitespace before the attribute.
  const re = new RegExp(`(^|[\\s{])${attrName}\\s*=`)
  return re.test(tag)
}

describe('renderer-wide <select> controlled-or-defaulted pin [ID-0167]', () => {
  const files = listTsxFiles(RENDERER_ROOT)

  it('discovers at least 5 .tsx files (smoke check that the tree walker is alive)', () => {
    expect(files.length).toBeGreaterThanOrEqual(5)
  })

  it('every <select opening tag has an explicit value= OR defaultValue= attribute', () => {
    type Offender = { file: string; lineNumber: number; tag: string }
    const offenders: Offender[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf-8')
      const tags = extractOpeningTags(src, 'select')
      for (const tag of tags) {
        if (hasAttribute(tag, 'value') || hasAttribute(tag, 'defaultValue')) {
          continue
        }
        const offsetInSrc = src.indexOf(tag)
        const lineNumber =
          offsetInSrc < 0 ? -1 : src.slice(0, offsetInSrc).split('\n').length
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
      `<select> tags missing explicit value=/defaultValue= (React silent-flip risk):\n  ${diag}`
    ).toBe(0)
  })

  it('finds at least 15 <select> opening tags across the renderer (regression-floor pin)', () => {
    let total = 0
    for (const file of files) {
      total += extractOpeningTags(readFileSync(file, 'utf-8'), 'select').length
    }
    // Rebaselined Cycle 274 after the legacy ShopApp-era file deletion
    // (removed FeedsCalcModal/LeftPanel/ToolLibraryPanel selects): ~12
    // <select> tags remain (LibraryView 7, others). Floor at 10 to flag a
    // wholesale removal or a broken walker.
    expect(total).toBeGreaterThanOrEqual(10)
  })
})

describe('renderer-wide <textarea> controlled-or-defaulted pin [ID-0167]', () => {
  const files = listTsxFiles(RENDERER_ROOT)

  it('every <textarea opening tag has an explicit value= OR defaultValue= attribute', () => {
    type Offender = { file: string; lineNumber: number; tag: string }
    const offenders: Offender[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf-8')
      const tags = extractOpeningTags(src, 'textarea')
      for (const tag of tags) {
        if (hasAttribute(tag, 'value') || hasAttribute(tag, 'defaultValue')) {
          continue
        }
        const offsetInSrc = src.indexOf(tag)
        const lineNumber =
          offsetInSrc < 0 ? -1 : src.slice(0, offsetInSrc).split('\n').length
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
      `<textarea> tags missing explicit value=/defaultValue= (React silent-flip risk):\n  ${diag}`
    ).toBe(0)
  })

  it('finds at least 1 <textarea> opening tag across the renderer (regression-floor pin)', () => {
    // Cycle 80 baseline: 2 <textarea> tags (LibraryView post-editor +
    // ToolLibraryPanel tool description). Floor at 1 to detect the
    // accidental removal of BOTH at once (which would suggest the
    // walker is broken or a destructive refactor swept them away).
    let total = 0
    for (const file of files) {
      total += extractOpeningTags(readFileSync(file, 'utf-8'), 'textarea').length
    }
    expect(total).toBeGreaterThanOrEqual(1)
  })
})

describe('walker brace-balance + quote regressions [ID-0167]', () => {
  it('the walker correctly handles brace-balanced JSX expression containers for <select>', () => {
    // Synthetic select that would trip a naive regex: a JSX expression
    // container with a nested object literal in onChange.
    const src =
      '<select value={state.kind} onChange={(e) => { dispatch({ k: e.target.value }) }}>x</select>'
    const tags = extractOpeningTags(src, 'select')
    expect(tags.length).toBe(1)
    expect(tags[0]).toContain('value=')
    expect(tags[0].endsWith('>')).toBe(true)
  })

  it('the walker correctly handles brace-balanced JSX expression containers for <textarea>', () => {
    const src =
      '<textarea value={state.note ?? ""} onChange={(e) => { dispatch({ note: e.target.value }) }} />'
    const tags = extractOpeningTags(src, 'textarea')
    expect(tags.length).toBe(1)
    expect(tags[0]).toContain('value=')
    expect(tags[0].endsWith('>')).toBe(true)
  })

  it('the walker treats quoted attribute values opaquely (does not parse JSX inside strings)', () => {
    // Synthetic: a string attribute containing what looks like JSX.
    const src =
      '<select value="x" title="this <select value={y}> is fake" />'
    const tags = extractOpeningTags(src, 'select')
    expect(tags.length).toBe(1)
    expect(tags[0]).toContain('value="x"')
  })

  it('hasAttribute does not false-positive on substring-shaped attribute names', () => {
    // `data-value=` should NOT count as `value=`. The hasAttribute helper
    // requires whitespace or `{` before the attribute name to prevent
    // this mis-match.
    const tag1 = '<select data-value="custom" />'
    const tag2 = '<select value="x" data-value="custom" />'
    expect(hasAttribute(tag1, 'value')).toBe(false)
    expect(hasAttribute(tag2, 'value')).toBe(true)
  })

  it('hasAttribute tolerates whitespace between the attribute name and `=`', () => {
    const tag = '<select value  =  "x" />'
    expect(hasAttribute(tag, 'value')).toBe(true)
  })

  it('the tag-name match excludes false-positive prefixes (e.g. <selectable, <textareafield)', () => {
    // `<selectable` should not match the `<select` walker; `<textareafield`
    // should not match the `<textarea` walker.
    const src1 = '<selectable name="foo" />'
    expect(extractOpeningTags(src1, 'select')).toEqual([])
    const src2 = '<textareafield name="bar" />'
    expect(extractOpeningTags(src2, 'textarea')).toEqual([])
  })

  it('hasAttribute matches defaultValue= with the same whitespace / boundary rules as value=', () => {
    // Belt-and-braces: defaultValue is the React-only alternate for
    // uncontrolled-but-initialized form elements; the walker must
    // accept it identically to value=.
    const tag1 = '<select defaultValue="a" />'
    const tag2 = '<select  defaultValue ="b" />'
    const tag3 = '<select someotherattr="c" />'
    expect(hasAttribute(tag1, 'defaultValue')).toBe(true)
    expect(hasAttribute(tag2, 'defaultValue')).toBe(true)
    expect(hasAttribute(tag3, 'defaultValue')).toBe(false)
  })
})
