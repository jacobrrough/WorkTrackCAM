/**
 * Pin: every `<button class="cc-header__...">` in AppHeader.tsx MUST have
 * an explicit `type="button"`.
 *
 * Migrated from the ShopApp.tsx tb-btn/tb-machine-badge pin when the
 * Control Center layout moved all header buttons into AppHeader.tsx with
 * cc-header__* class names.
 *
 * Original history:
 *   - Cycle 61 [ID-0152] fixed the machine-badge button.
 *   - Cycle 62 [ID-0152-followup] added type="button" to 7 toolbar buttons.
 *   - Control Center overhaul relocated buttons to AppHeader.tsx.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const HEADER_PATH = join(process.cwd(), 'src/renderer/src/AppHeader.tsx')

/**
 * Parse the file and return every `<button ...>` opening tag substring.
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

function isHeaderButton(tag: string): boolean {
  if (!tag.includes('className=')) return false
  return tag.includes('cc-header__')
}

describe('AppHeader.tsx button type="button" pin [ID-0152-followup]', () => {
  const src = readFileSync(HEADER_PATH, 'utf-8')
  const tags = extractButtonOpeningTags(src)
  const headerTags = tags.filter(isHeaderButton)

  it('parses at least 10 button opening tags (smoke check)', () => {
    expect(tags.length).toBeGreaterThanOrEqual(10)
  })

  it('finds at least 10 header-class buttons (machine + env + generate + gcode + icon buttons)', () => {
    expect(headerTags.length).toBeGreaterThanOrEqual(10)
  })

  it('every header-class button has explicit type="button" (no latent-submit)', () => {
    const offenders = headerTags.filter((t) => !hasExplicitButtonType(t))
    const diag = offenders.map((t) => t.slice(0, 120).replace(/\s+/g, ' ')).join('\n  ')
    expect(offenders.length, `Buttons missing type="button":\n  ${diag}`).toBe(0)
  })

  it('key header icon buttons each carry type="button"', () => {
    const anchors: ReadonlyArray<string> = [
      'Import model',
      'Setup sheet',
      'New project (Ctrl+N)',
      'Open project (Ctrl+O)',
      'Save (Ctrl+S)',
      'Command palette (Ctrl+K)',
      'Shortcuts (Ctrl+Shift+?)',
    ]
    for (const anchor of anchors) {
      const tag = headerTags.find((t) => t.includes(anchor))
      expect(tag, `No header button found with title containing "${anchor}"`).toBeDefined()
      if (!tag) continue
      expect(hasExplicitButtonType(tag), `Button "${anchor}" missing type="button"`).toBe(true)
    }
  })

  it('the machine selector button carries type="button" (no regression)', () => {
    const badge = headerTags.find((t) => t.includes('cc-header__machine-btn'))
    expect(badge).toBeDefined()
    if (!badge) return
    expect(hasExplicitButtonType(badge)).toBe(true)
  })
})
