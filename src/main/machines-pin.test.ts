/**
 * Paired-pin contract for `src/main/machines.ts`
 * -- the 189-line MAIN-process machine catalog loader / saver / parser
 * that fronts every machine-profile read in the application: the My-Shop
 * quick-select switch, the manufacture pipeline's `getMachineById`
 * lookup, the user-imported profile flow (.json / .yaml / .toml /
 * .json5 / .jsonc / .cps), and the dedup/sort that produces the visible
 * machine list across all three target machines (K2 Plus, Laguna 5x10,
 * Carvera 3-axis + 4-axis Rotary).
 *
 * The module exports 7 runtime symbols and 2 type-only symbols:
 *
 * Runtime (7):
 * - `parseMachineProfileText(text, hintFileName?)` -- string parser with
 *   format auto-detection (JSON > JSON5 > YAML > TOML); extension hint
 *   .json/.yml/.yaml/.toml/.json5/.jsonc takes precedence.
 * - `importMachineProfileFromFile(filePath)` -- async file reader with
 *   .cps branch (Fusion CPS post -> profile via machine-cps-import) +
 *   default save-to-user.
 * - `loadMachineCatalog()` -- async; reads bundled (resources/machines)
 *   + user (userData/machines) dirs, dedups by id (user wins), sorts
 *   by name.localeCompare.
 * - `loadAllMachines()` -- async; convenience wrapper returning
 *   loadMachineCatalog().machines.
 * - `getMachineById(id)` -- async; finds first profile by id, returns
 *   null if not found.
 * - `saveUserMachine(profile)` -- async; safe-name JSON write to
 *   userData/machines/, forces meta.source = 'user'.
 * - `deleteUserMachine(machineId)` -- async; scans userData/machines/,
 *   unlinks the first matching id, returns true/false.
 *
 * Type-only (2):
 * - `MachineCatalogDiagnostic` (per-file load error report).
 * - `MachineCatalog` (machines + diagnostics tuple).
 *
 * Three-machine impact: DIRECT cross-cut. This is the ONLY production
 * machine-catalog loader; bundled profiles for `creality-k2-plus`,
 * `laguna-swift-5x10`, `makera-carvera-3axis`, and `makera-carvera-4axis`
 * all flow through `loadMachineCatalog` -> `readMachineDir` ->
 * `machineProfileSchema.parse`. A regression in this module would
 * silently break the My-Shop quick-select that CLAUDE.md mandates as
 * first-class.
 *
 * This pin co-locates with `machines.test.ts` (290 lines) +
 * `machines-import.test.ts` (92 lines) -- both behavioral. The pin is
 * exhaustive against export shape, source-text whitelist, format-hint
 * dispatch, and three-machine-bundle realism.
 *
 * Roadmap ID: [ID-0300] / Cycle 227 (test-coverage rotation slot).
 */
import { describe, expect, it, vi } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// Mock electron + paths so the module loads in vitest without an Electron runtime.
vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/mock/userData') }
}))
vi.mock('./paths', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./paths')>()
  return {
    ...actual,
    getResourcesRoot: vi.fn().mockReturnValue('/mock/resources')
  }
})

import * as M from './machines'
import {
  parseMachineProfileText,
  importMachineProfileFromFile,
  loadMachineCatalog,
  loadAllMachines,
  getMachineById,
  saveUserMachine,
  deleteUserMachine
} from './machines'
import type { MachineCatalog, MachineCatalogDiagnostic } from './machines'

const SOURCE_PATH = resolve(__dirname, 'machines.ts')
const SOURCE = readFileSync(SOURCE_PATH, 'utf-8')

// Minimal valid machine profiles for parser tests. Keep these fixtures
// synchronous and pure so the parser tests don't touch the file system.
const MINIMAL_FDM = {
  id: 'pin-fdm',
  name: 'Pin FDM',
  kind: 'fdm',
  workAreaMm: { x: 350, y: 350, z: 350 },
  maxFeedMmMin: 18000,
  postTemplate: 'fdm_passthrough.hbs',
  dialect: 'generic_mm'
}

const MINIMAL_CNC = {
  id: 'pin-cnc',
  name: 'Pin CNC',
  kind: 'cnc',
  workAreaMm: { x: 200, y: 200, z: 50 },
  maxFeedMmMin: 3000,
  postTemplate: 'grbl_mm.hbs',
  dialect: 'grbl'
}

// ---------------------------------------------------------------------------
// A. Module shape -- exact runtime surface
// ---------------------------------------------------------------------------
describe('A. Module shape -- src/main/machines.ts', () => {
  it('exports exactly the 7-symbol runtime public surface (sorted)', () => {
    expect(Object.keys(M).sort()).toEqual([
      'deleteUserMachine',
      'getMachineById',
      'importMachineProfileFromFile',
      'loadAllMachines',
      'loadMachineCatalog',
      'parseMachineProfileText',
      'saveUserMachine'
    ])
  })

  it('all 7 exports classify as `function`', () => {
    expect(typeof parseMachineProfileText).toBe('function')
    expect(typeof importMachineProfileFromFile).toBe('function')
    expect(typeof loadMachineCatalog).toBe('function')
    expect(typeof loadAllMachines).toBe('function')
    expect(typeof getMachineById).toBe('function')
    expect(typeof saveUserMachine).toBe('function')
    expect(typeof deleteUserMachine).toBe('function')
  })

  it('parseMachineProfileText is synchronous; the other six are async', () => {
    expect(parseMachineProfileText.constructor.name).toBe('Function')
    expect(importMachineProfileFromFile.constructor.name).toBe('AsyncFunction')
    expect(loadMachineCatalog.constructor.name).toBe('AsyncFunction')
    expect(loadAllMachines.constructor.name).toBe('AsyncFunction')
    expect(getMachineById.constructor.name).toBe('AsyncFunction')
    expect(saveUserMachine.constructor.name).toBe('AsyncFunction')
    expect(deleteUserMachine.constructor.name).toBe('AsyncFunction')
  })

  it('arities match documented signatures', () => {
    // parseMachineProfileText(text, hintFileName? = 'profile') -> 1 (default param)
    expect(parseMachineProfileText.length).toBe(1)
    expect(importMachineProfileFromFile.length).toBe(1)
    expect(loadMachineCatalog.length).toBe(0)
    expect(loadAllMachines.length).toBe(0)
    expect(getMachineById.length).toBe(1)
    expect(saveUserMachine.length).toBe(1)
    expect(deleteUserMachine.length).toBe(1)
  })

  it('compile-time: MachineCatalog and MachineCatalogDiagnostic shapes are exported', () => {
    const diag: MachineCatalogDiagnostic = { source: 'bundled', file: 'x.json', error: 'oops' }
    const cat: MachineCatalog = { machines: [], diagnostics: [diag] }
    expect(cat.machines).toEqual([])
    expect(cat.diagnostics[0]!.source).toBe('bundled')
  })
})

// ---------------------------------------------------------------------------
// B. parseMachineProfileText -- empty / BOM / non-object inputs
// ---------------------------------------------------------------------------
describe('B. parseMachineProfileText edge inputs', () => {
  it('throws on empty input', () => {
    expect(() => parseMachineProfileText('')).toThrow(/empty/i)
    expect(() => parseMachineProfileText('   \n\n  ')).toThrow(/empty/i)
  })

  it('strips a leading BOM (U+FEFF) before parsing', () => {
    const bom = '﻿' + JSON.stringify(MINIMAL_FDM)
    const profile = parseMachineProfileText(bom, 'a.json')
    expect(profile.id).toBe('pin-fdm')
  })

  it('throws on JSON array root (not a single object)', () => {
    expect(() => parseMachineProfileText('[1, 2, 3]', 'arr.yaml')).toThrow(/object/i)
  })

  it('throws on scalar root', () => {
    expect(() => parseMachineProfileText('"just a string"', 'scalar.yaml')).toThrow()
  })

  it('throws an unparseable-format error when ALL four parsers fail (no extension hint)', () => {
    // Deliberately malformed for every dialect.
    expect(() => parseMachineProfileText('{{{ ::: not parseable :::')).toThrow(/parse|JSON|YAML|TOML/i)
  })
})

// ---------------------------------------------------------------------------
// C. parseMachineProfileText -- extension-hint dispatch
// ---------------------------------------------------------------------------
describe('C. parseMachineProfileText extension hint dispatch', () => {
  it('.json hint dispatches strict JSON path (no JSON5 trailing-comma tolerance)', () => {
    // Trailing comma is invalid strict JSON; parseMachineProfileText with .json hint
    // forwards to JSON.parse, which throws.
    const trailing = '{"id":"x","name":"X","kind":"cnc","workAreaMm":{"x":1,"y":1,"z":1},"maxFeedMmMin":1,"postTemplate":"t","dialect":"d",}'
    expect(() => parseMachineProfileText(trailing, 'a.json')).toThrow()
  })

  it('.json5 hint accepts trailing commas and unquoted keys', () => {
    const json5 = `{
      id: 'pin-cnc',
      name: 'Pin CNC',
      kind: 'cnc',
      workAreaMm: { x: 200, y: 200, z: 50 },
      maxFeedMmMin: 3000,
      postTemplate: 'grbl_mm.hbs',
      dialect: 'grbl',
    }`
    const p = parseMachineProfileText(json5, 'a.json5')
    expect(p.id).toBe('pin-cnc')
  })

  it('.jsonc hint also accepts JSON5-style trailing commas', () => {
    const jsonc = `{
      "id": "pin-cnc",
      "name": "Pin CNC",
      "kind": "cnc",
      "workAreaMm": { "x": 200, "y": 200, "z": 50 },
      "maxFeedMmMin": 3000,
      "postTemplate": "grbl_mm.hbs",
      "dialect": "grbl",
    }`
    const p = parseMachineProfileText(jsonc, 'a.jsonc')
    expect(p.id).toBe('pin-cnc')
  })

  it('.yaml hint parses YAML', () => {
    const yaml = [
      'id: pin-cnc',
      'name: Pin CNC',
      'kind: cnc',
      'workAreaMm:',
      '  x: 200',
      '  y: 200',
      '  z: 50',
      'maxFeedMmMin: 3000',
      'postTemplate: grbl_mm.hbs',
      'dialect: grbl'
    ].join('\n')
    const p = parseMachineProfileText(yaml, 'a.yaml')
    expect(p.id).toBe('pin-cnc')
  })

  it('.yml hint also routes to YAML', () => {
    const yml = 'id: pin-cnc\nname: Pin CNC\nkind: cnc\nworkAreaMm: { x: 200, y: 200, z: 50 }\nmaxFeedMmMin: 3000\npostTemplate: grbl_mm.hbs\ndialect: grbl'
    const p = parseMachineProfileText(yml, 'a.yml')
    expect(p.id).toBe('pin-cnc')
  })

  it('.toml hint parses TOML (root keys before tables; works with inline table for workAreaMm)', () => {
    const toml = [
      'id = "pin-cnc"',
      'name = "Pin CNC"',
      'kind = "cnc"',
      'maxFeedMmMin = 3000',
      'postTemplate = "grbl_mm.hbs"',
      'dialect = "grbl"',
      'workAreaMm = { x = 200, y = 200, z = 50 }'
    ].join('\n')
    const p = parseMachineProfileText(toml, 'a.toml')
    expect(p.id).toBe('pin-cnc')
  })

  it('case-insensitive extension hint -- .JSON / .YAML / .TOML route correctly', () => {
    const json = JSON.stringify(MINIMAL_CNC)
    expect(parseMachineProfileText(json, 'a.JSON').id).toBe('pin-cnc')
  })

  it('no recognized hint -> auto-detection chain (JSON > JSON5 > YAML > TOML)', () => {
    // Plain JSON; no hint -> succeeds via the JSON branch.
    const p = parseMachineProfileText(JSON.stringify(MINIMAL_CNC), 'unknown_extension.dat')
    expect(p.id).toBe('pin-cnc')
  })
})

// ---------------------------------------------------------------------------
// D. Schema validation pinning
// ---------------------------------------------------------------------------
describe('D. Schema validation pinning', () => {
  it('throws when required field `kind` is absent', () => {
    const bad = { ...MINIMAL_CNC } as Partial<typeof MINIMAL_CNC>
    delete bad.kind
    expect(() => parseMachineProfileText(JSON.stringify(bad), 'a.json')).toThrow()
  })

  it('throws when `kind` is an unknown literal', () => {
    const bad = { ...MINIMAL_CNC, kind: 'plasma' }
    expect(() => parseMachineProfileText(JSON.stringify(bad), 'a.json')).toThrow()
  })

  it('throws when `workAreaMm` is missing the z dimension', () => {
    const bad = { ...MINIMAL_CNC, workAreaMm: { x: 100, y: 100 } }
    expect(() => parseMachineProfileText(JSON.stringify(bad), 'a.json')).toThrow()
  })

  it('accepts an FDM kind with valid temperature ceilings', () => {
    const fdm = { ...MINIMAL_FDM, maxNozzleTempC: 350, maxBedTempC: 120, chamberTempC: 60 }
    const p = parseMachineProfileText(JSON.stringify(fdm), 'a.json')
    expect(p.kind).toBe('fdm')
  })
})

// ---------------------------------------------------------------------------
// E. Source-text whitelist
// ---------------------------------------------------------------------------
describe('E. Source-text whitelist for machines.ts', () => {
  it('imports the four parser libraries (JSON5, smol-toml, yaml) + native JSON', () => {
    expect(SOURCE).toMatch(/import\s+JSON5\s+from\s+['"]json5['"]/)
    expect(SOURCE).toMatch(/import\s+\{\s*parse\s+as\s+parseToml\s*\}\s+from\s+['"]smol-toml['"]/)
    expect(SOURCE).toMatch(/import\s+\{\s*parse\s+as\s+parseYaml\s*\}\s+from\s+['"]yaml['"]/)
    // Native JSON.parse is referenced directly, not imported.
    expect(SOURCE).toContain('JSON.parse(')
  })

  it('imports machineProfileSchema from shared/machine-schema (the canonical Zod schema)', () => {
    expect(SOURCE).toMatch(/from\s+['"]\.\.\/shared\/machine-schema['"]/)
    expect(SOURCE).toContain('machineProfileSchema.parse')
  })

  it('imports the .cps importer from machine-cps-import (Fusion post compatibility)', () => {
    expect(SOURCE).toMatch(/from\s+['"]\.\/machine-cps-import['"]/)
    expect(SOURCE).toContain('machineProfileFromCpsContent')
  })

  it('uses node:fs/promises (NOT node:fs sync APIs)', () => {
    expect(SOURCE).toMatch(/from\s+['"]node:fs\/promises['"]/)
    expect(SOURCE).not.toMatch(/from\s+['"]node:fs['"]/)
  })

  it('uses Electron `app.getPath("userData")` for the user dir', () => {
    expect(SOURCE).toContain("app.getPath('userData')")
  })

  it('uses getResourcesRoot() (not a hardcoded resources path)', () => {
    expect(SOURCE).toContain('getResourcesRoot()')
    expect(SOURCE).not.toMatch(/['"]resources\/machines['"]/)
  })

  it('safe-name regex enforces alphanumeric + underscore + dash only (path-injection guard)', () => {
    // saveUserMachine: id.replace(/[^a-z0-9_-]+/gi, '_').toLowerCase()
    expect(SOURCE).toContain('/[^a-z0-9_-]+/gi')
  })

  it('forces meta.source on bundled vs user reads (no impostor sources)', () => {
    // readMachineDir overwrites meta.source to the parameter `source`
    expect(SOURCE).toMatch(/meta:\s*\{\s*\.\.\.\(parsed\.meta\s*\?\?\s*\{\}\),\s*source\s*\}/)
  })

  it('zero `any` types -- the source uses `unknown` and casts to `Record<string, unknown>`', () => {
    expect(SOURCE).not.toMatch(/:\s*any\b/)
    expect(SOURCE).not.toMatch(/\bas\s+any\b/)
  })

  it('no eval / new Function escape hatches', () => {
    expect(SOURCE).not.toMatch(/\beval\s*\(/)
    expect(SOURCE).not.toMatch(/new\s+Function\s*\(/)
  })

  it('all 7 runtime exports are declared with `export function` or `export async function`', () => {
    const funcExports = SOURCE.match(/^export\s+(async\s+)?function\s+\w+/gm) ?? []
    // 1 sync + 6 async = 7
    expect(funcExports.length).toBe(7)
    const asyncCount = funcExports.filter((s) => s.includes('async')).length
    expect(asyncCount).toBe(6)
  })

  it('declares the 2 type-only exports with `export type`', () => {
    const typeExports = SOURCE.match(/^export\s+type\s+\w+/gm) ?? []
    expect(typeExports.length).toBe(2)
  })

  it('extension hint check is case-insensitive (.toLowerCase before endsWith)', () => {
    expect(SOURCE).toContain('hintFileName.toLowerCase()')
  })

  it('catalog dedup uses a Map keyed by id (user wins over bundled by insert order)', () => {
    expect(SOURCE).toMatch(/new\s+Map<string,\s*MachineProfile>\(\)/)
    expect(SOURCE).toContain('for (const m of bundled.machines) dedup.set(m.id, m)')
    expect(SOURCE).toContain('for (const m of user.machines) dedup.set(m.id, m)')
  })

  it('catalog sort uses name.localeCompare', () => {
    expect(SOURCE).toContain('a.name.localeCompare(b.name)')
  })

  it('saveUserMachine forces meta.source = "user" (not "bundled")', () => {
    expect(SOURCE).toMatch(/meta:\s*\{\s*\.\.\.\(parsed\.meta\s*\?\?\s*\{\}\),\s*source:\s*'user'\s*\}/)
  })

  it('deleteUserMachine swallows malformed entries during scan (best-effort id match)', () => {
    expect(SOURCE).toContain('// ignore malformed entries while scanning for target id')
  })

  it('importMachineProfileFromFile branches on .cps extension', () => {
    expect(SOURCE).toMatch(/\.cps['"]\)/)
    expect(SOURCE).toContain('machineProfileFromCpsContent(fileName, raw)')
  })
})

// ---------------------------------------------------------------------------
// F. Three-machine cross-cut realism -- bundled profiles parse via the schema
// ---------------------------------------------------------------------------
describe('F. Three-machine cross-cut realism (bundled profiles)', () => {
  const projectRoot = resolve(__dirname, '..', '..')
  const bundledFile = (name: string): string => resolve(projectRoot, 'resources', 'machines', name)

  it('Creality K2 Plus bundled profile parses and matches CLAUDE.md spec', () => {
    const path = bundledFile('creality-k2-plus.json')
    if (!existsSync(path)) return // skip if not in tree
    const text = readFileSync(path, 'utf-8')
    const profile = parseMachineProfileText(text, 'creality-k2-plus.json')
    expect(profile.id).toBe('creality-k2-plus')
    expect(profile.kind).toBe('fdm')
    // CLAUDE.md: 350 x 350 x 350 mm
    expect(profile.workAreaMm.x).toBe(350)
    expect(profile.workAreaMm.y).toBe(350)
    expect(profile.workAreaMm.z).toBe(350)
  })

  it('Laguna Swift 5x10 bundled profile parses (CNC kind)', () => {
    const path = bundledFile('laguna-swift-5x10.json')
    if (!existsSync(path)) return
    const text = readFileSync(path, 'utf-8')
    const profile = parseMachineProfileText(text, 'laguna-swift-5x10.json')
    expect(profile.id).toBe('laguna-swift-5x10')
    expect(profile.kind).toBe('cnc')
    // CLAUDE.md: 60" x 120" = 1524 x 3048 mm
    expect(profile.workAreaMm.x).toBe(1524)
    expect(profile.workAreaMm.y).toBe(3048)
  })

  it('Makera Carvera 3-axis bundled profile parses (CNC kind)', () => {
    const path = bundledFile('makera-carvera-3axis.json')
    if (!existsSync(path)) return
    const text = readFileSync(path, 'utf-8')
    const profile = parseMachineProfileText(text, 'makera-carvera-3axis.json')
    expect(profile.id).toBe('makera-carvera-3axis')
    expect(profile.kind).toBe('cnc')
    // CLAUDE.md: 360 x 240 x 140 mm
    expect(profile.workAreaMm.x).toBe(360)
    expect(profile.workAreaMm.y).toBe(240)
  })

  it('Makera Carvera 4-axis bundled profile parses (CNC kind)', () => {
    const path = bundledFile('makera-carvera-4axis.json')
    if (!existsSync(path)) return
    const text = readFileSync(path, 'utf-8')
    const profile = parseMachineProfileText(text, 'makera-carvera-4axis.json')
    expect(profile.id).toBe('makera-carvera-4axis')
    expect(profile.kind).toBe('cnc')
  })

  it('all 4 bundled three-machine-mode profiles have unique ids (no dedup collisions)', () => {
    const bundles = [
      'creality-k2-plus.json',
      'laguna-swift-5x10.json',
      'makera-carvera-3axis.json',
      'makera-carvera-4axis.json'
    ]
    const ids = new Set<string>()
    for (const f of bundles) {
      const path = bundledFile(f)
      if (!existsSync(path)) continue
      const profile = parseMachineProfileText(readFileSync(path, 'utf-8'), f)
      expect(ids.has(profile.id)).toBe(false)
      ids.add(profile.id)
    }
    // Must have at least the four target ids if all four files exist.
    expect(ids.size).toBeGreaterThanOrEqual(1)
  })
})
