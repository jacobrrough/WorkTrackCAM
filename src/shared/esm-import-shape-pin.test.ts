import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Guard against the Rollup-vs-esbuild ESM default-export trap.
 *
 * Some npm packages ship an ESM build with NO default export (named-only).
 * `opentype.js` 2.0's `dist/opentype.mjs` exports only `{ Font, Glyph, Path,
 * BoundingBox, parse, load, loadSync }`. A DEFAULT import
 * (`import opentype from 'opentype.js'`) typechecks (tsc synthesizes a default
 * via esModuleInterop) AND passes vitest (esbuild does the same), but Rollup —
 * the electron-vite PRODUCTION renderer bundler — rejects it, so `npm run build`
 * goes red while `tsc` + `vitest` stay green. This bit Wave 3f.
 *
 * The fix is always a NAMESPACE import: `import * as opentype from 'opentype.js'`
 * (plus a separate `import type { Font } from 'opentype.js'` for the types).
 *
 * NOTE the INVERSE trap: `clipper-lib` is a CommonJS module whose ESM interop
 * needs a DEFAULT import (`import ClipperLib from 'clipper-lib'`) — do NOT add it
 * here. This pin lists only genuinely named-only-ESM packages.
 *
 * The comprehensive guard remains `npm run build` (the build-smoke discipline);
 * this fast static pin catches the specific, recurring opentype shape in the
 * normal `vitest run` gate so the regression never reaches a manual build.
 */
const NAMED_ONLY_ESM_MODULES = ['opentype.js'] as const

const THIS_FILE = 'esm-import-shape-pin.test.ts'

function walkTsFiles(dir: string): string[] {
  const out: string[] = []
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of names) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = join(dir, name)
    let isDir = false
    try {
      isDir = statSync(full).isDirectory()
    } catch {
      continue
    }
    if (isDir) {
      out.push(...walkTsFiles(full))
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(full)
    }
  }
  return out
}

/**
 * Match a DEFAULT import binding from `module`:
 *   `import Foo from 'module'`           (default only)
 *   `import Foo, { Bar } from 'module'`  (default + named)
 * but NOT:
 *   `import * as Foo from 'module'`      (namespace)
 *   `import { Bar } from 'module'`       (named)
 *   `import type { Bar } from 'module'`  (type-only named)
 */
function defaultImportRegex(module: string): RegExp {
  const mod = module.replace(/\./g, '\\.')
  return new RegExp(
    `import\\s+(?!type\\s)([A-Za-z_$][\\w$]*)\\s*(?:,\\s*\\{[^}]*\\})?\\s*from\\s+['"]${mod}['"]`
  )
}

describe('ESM import-shape pin (Rollup vs esbuild default-export trap)', () => {
  it('no source DEFAULT-imports a named-only-ESM module (e.g. opentype.js)', () => {
    const srcRoot = join(process.cwd(), 'src')
    const offenders: string[] = []
    for (const file of walkTsFiles(srcRoot)) {
      if (file.endsWith(THIS_FILE)) continue
      const text = readFileSync(file, 'utf8')
      for (const mod of NAMED_ONLY_ESM_MODULES) {
        if (defaultImportRegex(mod).test(text)) {
          offenders.push(`${file.replace(srcRoot, 'src')} -> default import of '${mod}'`)
        }
      }
    }
    expect(
      offenders,
      'Use a namespace import — these modules have NO ESM default export and Rollup ' +
        '(electron-vite build) rejects a default import even though tsc + vitest pass:\n' +
        offenders.join('\n')
    ).toEqual([])
  })
})
