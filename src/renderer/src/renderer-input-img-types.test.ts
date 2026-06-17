/**
 * Cycle 74 ui-polish [ID-0163] -- defensive regression pin: extends Cycle
 * 71's `[ID-0152-extended]` brace-balance walker (originally written for
 * `<button>` tags in `renderer-button-types-extended.test.ts`) to two
 * additional element classes:
 *
 *   1. Every `<input ...>` opening tag MUST carry an explicit `type=`
 *      attribute. The HTML default for `<input>` is `type="text"`, so
 *      omitting the attribute is byte-identical for plain text inputs --
 *      but a future refactor that needs to flip an existing input to
 *      `type="number"` / `type="checkbox"` / etc. will silently no-op
 *      if the attribute is missing because the developer assumed the
 *      input was already typed. Cycle 74 found 10 untyped `<input>` tags
 *      across 5 files (LeftPanel, LibraryView, SettingsView, ShopApp,
 *      ToolLibraryPanel); each was fixed to explicit `type="text"` (the
 *      HTML default, so production behavior is byte-identical per
 *      Safety Rule 2). This test pins the renderer-wide invariant so a
 *      future regression goes red.
 *
 *   2. Every `<img ...>` opening tag MUST carry an explicit `alt=`
 *      attribute. WCAG 2.1 SC 1.1.1 (Non-text Content, Level A) requires
 *      a text alternative for every non-decorative image; decorative
 *      images need `alt=""` (empty, not omitted). Today the renderer
 *      has ZERO `<img>` tags (verified by this test's smoke pin); this
 *      pin defends the zero-or-typed invariant so the first developer
 *      to add an `<img>` cannot silently ship an unannotated image.
 *
 * Why a separate file from the Cycle 71 button pin?
 * --------------------------------------------------
 * The `<button>` walker in `renderer-button-types-extended.test.ts`
 * pins a different defect class (HTML default `type="submit"` is
 * dangerous; HTML default `type="text"` for `<input>` is harmless and
 * default `<img>` is non-existent). Keeping the two pin sets separate
 * means a regression that breaks the input/img walker cannot silently
 * take down the button pin (and vice versa); each test is independent
 * and can fail with a focused diagnostic.
 *
 * Cycle-history context
 * ---------------------
 *   - Cycle 61 [ID-0152]: brand-bar machine badge (1 button) fixed +
 *     pinned via `shop-app-toolbar-button-types.test.ts`.
 *   - Cycle 62 [ID-0152-followup]: 7 toolbar `tb-btn` buttons fixed,
 *     same test extended to cover them.
 *   - Cycle 71 [ID-0152-extended]: 62 non-toolbar buttons across 8 .tsx
 *     files fixed via single Python-via-bash atomic patch + new
 *     `renderer-button-types-extended.test.ts` pin.
 *   - Cycle 74 [ID-0163] (THIS pin): mirrors the same shape for
 *     `<input>` and `<img>` element classes. 10 untyped `<input>` tags
 *     fixed via single Python-via-bash atomic patch (same shape as
 *     Cycle 71); zero `<img>` tags exist today, so the `<img>` pin is
 *     a zero-floor defensive guard.
 *
 * Implementation
 * --------------
 * Walks `src/renderer/src/**\/*.tsx`, parses every `<input` and `<img`
 * opening tag with brace-balance + quote tracking (so JSX expression
 * containers `{...}` with nested braces, and quoted attribute values
 * containing brackets/angles, do not confuse the regex). Children are
 * not inspected (input and img are void elements anyway).
 *
 * The walker is intentionally written from scratch rather than imported
 * from `renderer-button-types-extended.test.ts` so the two tests stay
 * independent.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const RENDERER_ROOT = join(process.cwd(), 'src/renderer/src')

/**
 * Recursively collect every `.tsx` file under `dir`. Excludes test
 * files (`*.test.ts`, `*.test.tsx`) so the walker does not assert on
 * test-fixture inputs/imgs that are intentionally untyped or commented
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
 * Walk every `<NAME ...>` opening tag in `src` with brace-balance +
 * quote tracking. Returns the literal text of each opening tag from
 * `<` through the closing `>`. Tag-name match requires that the
 * character immediately after the name is whitespace, `>`, or `/`
 * (so `<inputmask>` does NOT match `<input`).
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
  // might appear as a substring of another name (e.g. `data-type=` contains
  // `type=`). Require a word boundary or whitespace before the attribute.
  const re = new RegExp(`(^|[\\s{])${attrName}\\s*=`)
  return re.test(tag)
}

describe('renderer-wide <input> type= pin [ID-0163]', () => {
  const files = listTsxFiles(RENDERER_ROOT)

  it('discovers at least 5 .tsx files (smoke check that the tree walker is alive)', () => {
    expect(files.length).toBeGreaterThanOrEqual(5)
  })

  it('every <input opening tag in every .tsx file has an explicit type= attribute', () => {
    type Offender = { file: string; lineNumber: number; tag: string }
    const offenders: Offender[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf-8')
      const tags = extractOpeningTags(src, 'input')
      for (const tag of tags) {
        if (hasAttribute(tag, 'type')) continue
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
      `<input> tags missing explicit type=:\n  ${diag}`
    ).toBe(0)
  })

  it('finds at least 30 <input> opening tags across the renderer (regression-floor pin)', () => {
    let total = 0
    for (const file of files) {
      total += extractOpeningTags(readFileSync(file, 'utf-8'), 'input').length
    }
    // Rebaselined Cycle 274 after the legacy ShopApp-era file deletion:
    // ~13 <input> tags remain in src/renderer/src. Floor at 10 to flag a
    // wholesale removal or a broken walker.
    expect(total).toBeGreaterThanOrEqual(10)
  })
})

describe('renderer-wide <img> alt= pin [ID-0163]', () => {
  const files = listTsxFiles(RENDERER_ROOT)

  it('every <img opening tag in every .tsx file has an explicit alt= attribute', () => {
    // Per WCAG 2.1 SC 1.1.1 (Non-text Content, Level A), every <img>
    // requires a text alternative; decorative images use `alt=""` (empty,
    // not omitted). At Cycle 74 the renderer has ZERO <img> tags, so this
    // assertion is vacuously true today; it defends against the first
    // future <img> shipped without alt= going unnoticed.
    type Offender = { file: string; lineNumber: number; tag: string }
    const offenders: Offender[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf-8')
      const tags = extractOpeningTags(src, 'img')
      for (const tag of tags) {
        if (hasAttribute(tag, 'alt')) continue
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
      `<img> tags missing explicit alt= (WCAG 2.1 SC 1.1.1):\n  ${diag}`
    ).toBe(0)
  })

  it('records the renderer\u2019s current <img> count (zero-floor pin)', () => {
    // The renderer surfaces machine state via inline SVG icons (see
    // MODE_ICONS in ShopApp.tsx) and emoji glyphs, not raster <img>
    // tags. Pinning the zero-count makes the first <img> introduction
    // an explicit, reviewed change rather than an accident.
    let total = 0
    for (const file of files) {
      total += extractOpeningTags(readFileSync(file, 'utf-8'), 'img').length
    }
    // ASSUMPTION: if a future cycle intentionally introduces <img>,
    // this pin must be updated together with the new alt= invariant.
    expect(total).toBe(0)
  })
})

describe('walker brace-balance + quote regressions [ID-0163]', () => {
  it('the walker correctly handles brace-balanced JSX expression containers for <input>', () => {
    // Synthetic input that would trip a naive regex: a JSX expression
    // container with a nested object literal.
    const src =
      '<input type="text" className={`x${cond ? "a" : "b"}`} onChange={(e) => { foo({ k: 1 }) }} />'
    const tags = extractOpeningTags(src, 'input')
    expect(tags.length).toBe(1)
    expect(tags[0]).toContain('type="text"')
    expect(tags[0].endsWith('>')).toBe(true)
  })

  it('the walker correctly handles brace-balanced JSX expression containers for <img>', () => {
    const src =
      '<img alt={cond ? `x${y}` : "fallback"} src={url} style={{ width: 16 }} />'
    const tags = extractOpeningTags(src, 'img')
    expect(tags.length).toBe(1)
    expect(tags[0]).toContain('alt=')
    expect(tags[0].endsWith('>')).toBe(true)
  })

  it('the walker treats quoted attribute values opaquely (does not parse JSX inside strings)', () => {
    // Synthetic: a string attribute containing what looks like JSX.
    const src =
      '<input type="text" title="this <input value={x}> looks fake" />'
    const tags = extractOpeningTags(src, 'input')
    // Exactly one outer input. The "<input value={x}>" inside the title
    // string is inside double quotes; the walker tracks quote state and
    // does not match.
    expect(tags.length).toBe(1)
    expect(tags[0]).toContain('type="text"')
  })

  it('hasAttribute does not false-positive on substring-shaped attribute names', () => {
    // `data-type=` should NOT count as `type=`. The hasAttribute helper
    // requires whitespace or `{` before the attribute name to prevent
    // this mis-match.
    const tag1 = '<input data-type="custom" />'
    const tag2 = '<input type="text" data-type="custom" />'
    expect(hasAttribute(tag1, 'type')).toBe(false)
    expect(hasAttribute(tag2, 'type')).toBe(true)
  })

  it('hasAttribute tolerates whitespace between the attribute name and `=`', () => {
    const tag = '<input type  =  "text" />'
    expect(hasAttribute(tag, 'type')).toBe(true)
  })

  it('the tag-name match excludes false-positive prefixes (e.g. <inputmask, <imgloader)', () => {
    // `<inputmask` should not match the `<input` walker; `<imgloader`
    // should not match the `<img` walker.
    const src1 = '<inputmask name="foo" />'
    expect(extractOpeningTags(src1, 'input')).toEqual([])
    const src2 = '<imgloader src="x" />'
    expect(extractOpeningTags(src2, 'img')).toEqual([])
  })
})
