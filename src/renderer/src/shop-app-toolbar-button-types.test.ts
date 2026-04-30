/**
 * Cycle 62 ui-polish (bonus work) [ID-0152-followup] -- defensive regression
 * pin: every `<button class="tb-btn ...">` (or `tb-machine-badge ...`) in
 * src/renderer/src/ShopApp.tsx MUST have an explicit `type="button"`.
 *
 * Why this matters:
 *   HTML `<button>` defaults to `type="submit"`. None of the toolbar
 *   buttons sit inside a `<form>` today, so the latent-submit bug never
 *   actually fires -- but if a future cycle ever wraps the toolbar in a
 *   `<form>` (e.g. for a shortcut binding or job-name validation), every
 *   un-typed button would silently become a submit button and trigger an
 *   accidental page reload (or worse, navigate away from unsaved work).
 *
 * This test parses the ShopApp.tsx source as plain text and walks every
 * `<button` opening tag, classifying it by className. Every tb-btn /
 * tb-machine-badge instance must include the literal substring
 * `type="button"` somewhere inside its opening tag (typically right after
 * the tag name).
 *
 * Cycle-history context:
 *   - Cycle 61 [ID-0152] fixed the brand-bar machine-badge button (sole
 *     instance at that time) and flagged the 7 toolbar tb-btn instances
 *     as [ID-0152-followup].
 *   - Cycle 62 (this cycle) adds `type="button"` to those 7 + this
 *     defensive regression test so a future drop-back is caught at the
 *     test level, not at the operator's keyboard.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SHOP_APP_PATH = join(process.cwd(), 'src/renderer/src/ShopApp.tsx')

/**
 * Parse the file and return every `<button ...>` opening tag substring.
 * Each returned entry is the literal text from the opening `<` up to and
 * including the closing `>` of the opening tag (children NOT included).
 *
 * Note: this regex tolerates JSX expression containers (`{...}`) inside
 * attribute values, which can themselves contain nested braces. We use a
 * brace-balance walk for the `{...}` regions to avoid mis-matching.
 */
function extractButtonOpeningTags(src: string): string[] {
  const tags: string[] = []
  let i = 0
  while (i < src.length) {
    const next = src.indexOf('<button', i)
    if (next < 0) break
    // Confirm token boundary: the next character after "<button" must be
    // whitespace or ">" so we don't false-match "<buttonsomething".
    const after = src[next + '<button'.length]
    if (after !== ' ' && after !== '\t' && after !== '\n' && after !== '>' && after !== '\r') {
      i = next + 1
      continue
    }
    // Walk forward to the matching ">" of the opening tag, balancing braces.
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

/** Does the opening tag include the literal substring `type="button"`? */
function hasExplicitButtonType(tag: string): boolean {
  return tag.includes('type="button"')
}

/**
 * Toolbar / brand-bar predicates: a button is "toolbar-class" if its
 * className mentions `tb-btn` or `tb-machine-badge`. Matches both the
 * `className="..."` string-literal form and the `className={`...`}`
 * template-literal form via a simple substring include.
 *
 * For this defensive pin we focus on the tb-* family since those were the
 * Cycle 61 / 62 [ID-0152] / [ID-0152-followup] focus. The btn-generate /
 * btn-send / btn-ghost classes are out of scope (they live in different
 * functional regions and use a different uniformity convention).
 */
function isToolbarClassButton(tag: string): boolean {
  if (!tag.includes('className=')) return false
  return tag.includes('tb-btn') || tag.includes('tb-machine-badge')
}

describe('ShopApp.tsx toolbar button type="button" pin [ID-0152-followup]', () => {
  const src = readFileSync(SHOP_APP_PATH, 'utf-8')
  const tags = extractButtonOpeningTags(src)
  const toolbarTags = tags.filter(isToolbarClassButton)

  it('parses at least 12 button opening tags (smoke check that the regex finds buttons)', () => {
    // Sanity: ShopApp.tsx has a lot of buttons; if the parser regresses to
    // 0 the rest of the assertions become vacuous-true. Pin a floor.
    expect(tags.length).toBeGreaterThanOrEqual(12)
  })

  it('finds at least 12 toolbar-class buttons (5 brand-bar + 1 badge + 7 toolbar minimum)', () => {
    // Cycle 62 minimum: 5 brand-bar tb-btn + 1 tb-machine-badge + 7
    // toolbar tb-btn = 13. Floor at 12 to allow conditional-render
    // variants the parser counts once per source occurrence.
    expect(toolbarTags.length).toBeGreaterThanOrEqual(12)
  })

  it('every toolbar-class button has explicit type="button" (no latent-submit)', () => {
    const offenders = toolbarTags.filter((t) => !hasExplicitButtonType(t))
    // Build a friendly diagnostic so a future regression names the offender.
    const diag = offenders.map((t) => t.slice(0, 120).replace(/\s+/g, ' ')).join('\n  ')
    expect(offenders.length, `Buttons missing type="button":\n  ${diag}`).toBe(0)
  })

  it('the 7 specific [ID-0152-followup] buttons each carry type="button"', () => {
    // Anchor each Cycle-62 fix to a unique title= signature so future
    // refactors that reorder lines do not weaken the pin.
    const anchors: ReadonlyArray<string> = [
      'Apply material cut params to all operations',
      'Generate Setup Sheet',
      'Import model',
      'New project (Ctrl+N)',
      'Open project file (Ctrl+O)',
      'Save session to file (Ctrl+S)',
      'Help reference panel (F1)'
    ]
    for (const anchor of anchors) {
      const tag = toolbarTags.find((t) => t.includes(anchor))
      expect(tag, `No toolbar button found with title containing "${anchor}"`).toBeDefined()
      if (!tag) continue
      expect(hasExplicitButtonType(tag), `Button "${anchor}" missing type="button"`).toBe(true)
    }
  })

  it('the brand-bar machine badge (Cycle 61 [ID-0152]) still carries type="button" (no regression)', () => {
    const badge = toolbarTags.find((t) => t.includes('tb-machine-badge'))
    expect(badge).toBeDefined()
    if (!badge) return
    expect(hasExplicitButtonType(badge)).toBe(true)
  })
})
