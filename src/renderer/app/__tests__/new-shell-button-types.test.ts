/**
 * Pin: every `<button>` opening tag in the WorkTrack3D shell
 * (`src/renderer/app/**\/*.tsx`) MUST carry an explicit `type="button"`.
 *
 * A `<button>` with no explicit type defaults to `type="submit"`, which inside
 * any ancestor `<form>` submits + reloads the renderer — a latent footgun that
 * has bitten this codebase before (ID-0152).
 *
 * Replaces the retired `shop-app-toolbar-button-types` pin at the P5 cutover:
 * the legacy ShopApp/AppHeader header was deleted, so this retargets the same
 * invariant onto the new CAD-first shell. `renderer-button-types-extended`
 * walks `src/renderer/src/**`; this covers the `app/` shell tree it does not.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const APP_DIR = join(process.cwd(), 'src/renderer/app')

/** Recursively collect every non-test `.tsx` under `dir`. */
function collectTsxFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === '__tests__') continue
      out.push(...collectTsxFiles(full))
    } else if (name.endsWith('.tsx') && !name.endsWith('.test.tsx')) {
      out.push(full)
    }
  }
  return out
}

/** Parse the file and return every `<button ...>` opening-tag substring. */
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

describe('new-shell button type="button" pin (P5 cutover, replaces shop-app-toolbar pin)', () => {
  const files = collectTsxFiles(APP_DIR)

  it('discovers the shell .tsx tree (smoke check)', () => {
    expect(files.length).toBeGreaterThanOrEqual(5)
  })

  it('every <button> opening tag in the app/ shell has explicit type="button"', () => {
    const offenders: string[] = []
    for (const file of files) {
      const tags = extractButtonOpeningTags(readFileSync(file, 'utf-8'))
      for (const tag of tags) {
        if (!hasExplicitButtonType(tag)) {
          offenders.push(`${file.replace(process.cwd(), '.')}: ${tag.slice(0, 100).replace(/\s+/g, ' ')}`)
        }
      }
    }
    expect(offenders.length, `Buttons missing type="button":\n  ${offenders.join('\n  ')}`).toBe(0)
  })
})
