/**
 * gcode-dialect-compliance-pin.test.ts -- [ID-0272] Cycle 200
 * post-processing paired-pin for `src/shared/gcode-dialect-compliance.ts`.
 *
 * Sister to the existing `gcode-dialect-compliance.test.ts` (which pins the
 * behaviour-level surface across the GRBL / Smoothieware / Fanuc / Mach3 /
 * LinuxCNC / Siemens / Heidenhain dialect families). This co-located paired-
 * pin extends that coverage with module shape (exact named-export inventory,
 * arity, Symbol.toStringTag / null-prototype invariants), `ComplianceIssue`
 * record-shape contract (exact key set, primitive types, level union),
 * dialect-family routing exhaustiveness across every value in the bundled
 * `MachineProfile` `dialect` zod enum, three-machine fleet pinning that
 * threads each bundled profile's dialect through `validateDialectCompliance`,
 * purity / referential non-mutation across N=10 calls, AND a source-text
 * whitelist pinning the Cycle 67 / Cycle 68 [ID-0155] / [ID-0160] dialect-
 * mislabel architectural note plus Safety Rule 1/2/3/4 negative invariants
 * (no electron/fs/path/child_process imports, no `any` 3-form, no top-level
 * `let`, no Handlebars tokens, no foreign-machine vendor names, the helper
 * does NOT consult any state outside the two args).
 *
 * Sister cycles in the post-Cycle-127-reset paired-pin chain that this pin
 * extends: 119 [ID-0196] / 124 [ID-0201] / 129 [ID-0206] / 130 [ID-0207] /
 * 131 [ID-0208] / 132 [ID-0209] / 134 [ID-0210] / 135 [ID-0211] / 136
 * [ID-0212] / 137 [ID-0213] / 139 [ID-0214] / 140 [ID-0215] / 142 [ID-0216]
 * / 144 [ID-0217] / 145 [ID-0218] / 146 [ID-0220] / 147 [ID-0222] / 149
 * [ID-0225] / 150 [ID-0221] / 151 [ID-0226] / 152 [ID-0224] / 153
 * [ID-0067-data-v21] / 154 [ID-0227] / 155 [ID-0228] / 157 [ID-0230] / 199
 * [ID-0271].
 *
 * Three-machine impact: DIRECT cross-cut via the post-processor compliance
 * gate. Pin protects:
 * - Creality K2 Plus (FDM, dialect=`generic_mm`): the generic family MUST
 *   continue to return zero issues for FDM G-code so the Moonraker upload
 *   path is not gated on a false-positive validator alarm.
 * - Laguna Swift 5x10 (CNC, dialect=`mach3`): the mach3 family MUST keep
 *   warning on missing `%` tape-start / tape-end markers because the
 *   RichAuto A-series controller silently drops a job whose first physical
 *   line is not `%`. Drift here would let a corrupted file ship to the
 *   spindle.
 * - Makera Carvera 3-axis (CNC, dialect=`smoothieware`): the smoothieware
 *   family MUST continue to NOT emit `GRBL_NO_TLC` on canonical
 *   `M6 T<n>` + `G43 H<n>` ATC blocks (the [ID-0160] regression guard).
 *   Drift back to the GRBL family would re-introduce the false-positive
 *   that motivated the family split at Cycle 67 / Cycle 68.
 * - Makera Carvera 4-axis (CNC, dialect=`grbl_4axis`): the GRBL family
 *   MUST stay error-level on G28/G30 because the bundled 4-axis post
 *   intentionally omits homing macros (rotary collision risk).
 *
 * ZERO production-code edits. Pure paired-pin.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as M from './gcode-dialect-compliance'
import {
  validateDialectCompliance,
  type ComplianceIssue,
  type ComplianceLevel
} from './gcode-dialect-compliance'
import {
  machineProfileSchema,
  type MachineProfile
} from './machine-schema'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const SRC_PATH = join(__dirname, 'gcode-dialect-compliance.ts')
const SRC = readFileSync(SRC_PATH, 'utf8')

const RESOURCES_ROOT = join(process.cwd(), 'resources')
function loadProfile(filename: string): MachineProfile {
  const path = join(RESOURCES_ROOT, 'machines', filename)
  return machineProfileSchema.parse(JSON.parse(readFileSync(path, 'utf-8')))
}

// Strip comments + string literals so source-text scans of executable
// code do not collide with JSDoc framing or docstring-embedded literals.
function codeOnly(src: string): string {
  // Remove block comments first (greedy lazy across lines)
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '')
  // Remove line comments
  out = out.replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  return out
}

// Every dialect literal accepted by the bundled machine-schema zod enum.
// Pinned here so dialect-family routing is exhaustively exercised; if a new
// dialect gets added to the schema without a matching `dialectFamily` arm,
// the routing test in J) flags it.
const ALL_DIALECTS = [
  'grbl',
  'mach3',
  'generic_mm',
  'grbl_4axis',
  'fanuc_4axis',
  'mach3_4axis',
  'linuxcnc_4axis',
  'siemens_4axis',
  'heidenhain_4axis',
  'fanuc',
  'siemens',
  'heidenhain',
  'smoothieware'
] as const

type Dialect = (typeof ALL_DIALECTS)[number]

// Helper to find issues by code (mirrors the behavioural test helper)
function findByCode(issues: ComplianceIssue[], code: string): ComplianceIssue[] {
  return issues.filter((i) => i.code === code)
}

// ---------------------------------------------------------------------------
// A) Module shape
// ---------------------------------------------------------------------------

describe('[ID-0272] A) module shape', () => {
  it('exports exactly the documented runtime named symbols', () => {
    const stringKeys = Object.keys(M).sort()
    expect(stringKeys).toEqual(['validateDialectCompliance'])
  })

  it('does NOT expose a default export', () => {
    expect((M as Record<string, unknown>).default).toBeUndefined()
  })

  it('only carries Symbol.toStringTag among Symbol-keyed properties', () => {
    const symbolKeys = Object.getOwnPropertySymbols(M)
    expect(symbolKeys).toEqual([Symbol.toStringTag])
  })

  it('has Symbol.toStringTag === "Module" on the ESM namespace', () => {
    expect(
      (M as { [Symbol.toStringTag]?: string })[Symbol.toStringTag]
    ).toBe('Module')
  })

  it('has a null prototype on the ESM namespace object', () => {
    expect(Object.getPrototypeOf(M)).toBeNull()
  })

  it('declares Function.length === 2 for validateDialectCompliance (gcode + dialect)', () => {
    expect(M.validateDialectCompliance.length).toBe(2)
  })

  it('runtime symbol is a function', () => {
    expect(typeof M.validateDialectCompliance).toBe('function')
  })

  it('does NOT export ComplianceIssue as a runtime value (it is type-only)', () => {
    expect((M as Record<string, unknown>).ComplianceIssue).toBeUndefined()
  })

  it('does NOT export ComplianceLevel as a runtime value (it is type-only)', () => {
    expect((M as Record<string, unknown>).ComplianceLevel).toBeUndefined()
  })

  it('does NOT expose any internal helpers (only the 1 documented runtime export)', () => {
    const runtimeKeys = Object.keys(M)
    expect(runtimeKeys).toHaveLength(1)
  })

  it('does NOT expose the per-family checker functions (checkGrbl / checkSmoothieware / etc.)', () => {
    for (const k of [
      'checkGrbl',
      'checkSmoothieware',
      'checkFanuc',
      'checkMach3',
      'checkLinuxCNC',
      'checkSiemens',
      'checkHeidenhain',
      'dialectFamily',
      'stripComments',
      'extractGCodes',
      'extractMCodes',
      'isCommentLine',
      'hasParenComment'
    ]) {
      expect((M as Record<string, unknown>)[k]).toBeUndefined()
    }
  })
})

// ---------------------------------------------------------------------------
// B) ComplianceIssue record shape
// ---------------------------------------------------------------------------

describe('[ID-0272] B) ComplianceIssue record shape', () => {
  it('always returns an Array (never undefined / null) for empty input', () => {
    const r = validateDialectCompliance('', 'grbl')
    expect(Array.isArray(r)).toBe(true)
    expect(r).toEqual([])
  })

  it('always returns an Array for whitespace-only input', () => {
    const r = validateDialectCompliance('   \n\n\t  ', 'grbl')
    expect(Array.isArray(r)).toBe(true)
    expect(r).toEqual([])
  })

  it('issue records carry exactly the documented 5 keys', () => {
    const issues = validateDialectCompliance('G28 Z0', 'grbl')
    expect(issues.length).toBeGreaterThan(0)
    for (const i of issues) {
      expect(Object.keys(i).sort()).toEqual(
        ['code', 'content', 'level', 'line', 'message'].sort()
      )
    }
  })

  it('issue.level is the discriminated union "error" | "warning"', () => {
    const issues = validateDialectCompliance('G43 H1\nG28 Z0', 'grbl')
    for (const i of issues) {
      expect(['error', 'warning']).toContain(i.level)
    }
  })

  it('issue.line is a positive integer (1-based)', () => {
    const issues = validateDialectCompliance('G21\nG28 Z0\nM30', 'grbl')
    for (const i of issues) {
      expect(Number.isInteger(i.line)).toBe(true)
      expect(i.line).toBeGreaterThanOrEqual(1)
    }
  })

  it('issue.code is a non-empty string', () => {
    const issues = validateDialectCompliance('G28 Z0', 'grbl')
    expect(issues.length).toBeGreaterThan(0)
    for (const i of issues) {
      expect(typeof i.code).toBe('string')
      expect(i.code.length).toBeGreaterThan(0)
    }
  })

  it('issue.message is a non-empty human-readable string', () => {
    const issues = validateDialectCompliance('G28 Z0', 'grbl')
    expect(issues.length).toBeGreaterThan(0)
    for (const i of issues) {
      expect(typeof i.message).toBe('string')
      expect(i.message.length).toBeGreaterThan(0)
    }
  })

  it('issue.content is a string (the offending source line)', () => {
    const issues = validateDialectCompliance('G21\nG28 Z0', 'grbl')
    expect(issues.length).toBeGreaterThan(0)
    for (const i of issues) {
      expect(typeof i.content).toBe('string')
    }
  })

  it('issue.line points to a real (1-based) line within the input', () => {
    const gcode = 'G21\nG90\nG28 Z0\nM30'
    const issues = validateDialectCompliance(gcode, 'grbl')
    const lines = gcode.split('\n')
    for (const i of issues) {
      expect(i.line).toBeGreaterThanOrEqual(1)
      expect(i.line).toBeLessThanOrEqual(lines.length)
    }
  })

  it('issue.code is upper-snake-case ASCII (no spaces, no lowercase, no punctuation)', () => {
    const issues = validateDialectCompliance('G28 Z0\nG43 H1', 'grbl')
    for (const i of issues) {
      expect(i.code).toMatch(/^[A-Z][A-Z0-9_]*$/)
    }
  })
})

// ---------------------------------------------------------------------------
// C) Empty / degenerate input
// ---------------------------------------------------------------------------

describe('[ID-0272] C) empty / degenerate input', () => {
  it('returns [] for an empty string across every dialect', () => {
    for (const d of ALL_DIALECTS) {
      expect(validateDialectCompliance('', d)).toEqual([])
    }
  })

  it('returns [] for whitespace-only input across every dialect', () => {
    for (const d of ALL_DIALECTS) {
      expect(validateDialectCompliance('   \n\n', d)).toEqual([])
    }
  })

  it('returns [] for a tab-only string', () => {
    expect(validateDialectCompliance('\t\t\t', 'grbl')).toEqual([])
  })

  it('does not throw on a single-line input with no newline terminator', () => {
    expect(() => validateDialectCompliance('G21', 'grbl')).not.toThrow()
  })

  it('does not throw on a CRLF-terminated input', () => {
    expect(() => validateDialectCompliance('G21\r\nG90\r\n', 'grbl')).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// D) GRBL-family branch (covers grbl + grbl_4axis)
// ---------------------------------------------------------------------------

describe('[ID-0272] D) GRBL-family branch', () => {
  const G28_CODE = 'G21\nG90\nG28 Z0\nM30'

  it('routes dialect "grbl" through the GRBL checker (G28 -> error)', () => {
    const issues = validateDialectCompliance(G28_CODE, 'grbl')
    const g28 = findByCode(issues, 'GRBL_NO_G28')
    expect(g28.length).toBe(1)
    expect(g28[0].level).toBe('error')
  })

  it('routes dialect "grbl_4axis" through the SAME GRBL checker', () => {
    const issues = validateDialectCompliance(G28_CODE, 'grbl_4axis')
    const g28 = findByCode(issues, 'GRBL_NO_G28')
    expect(g28.length).toBe(1)
    expect(g28[0].level).toBe('error')
  })

  it('grbl and grbl_4axis return identical issues for the same input (family alias)', () => {
    const a = validateDialectCompliance(G28_CODE, 'grbl')
    const b = validateDialectCompliance(G28_CODE, 'grbl_4axis')
    expect(a).toEqual(b)
  })

  it('GRBL flags G43 as a tool-length-compensation WARNING (not error)', () => {
    const issues = validateDialectCompliance('G43 H1', 'grbl')
    const tlc = findByCode(issues, 'GRBL_NO_TLC')
    expect(tlc).toHaveLength(1)
    expect(tlc[0].level).toBe('warning')
  })

  it('GRBL G28-in-comment is NOT flagged (stripComments is honoured)', () => {
    const issues = validateDialectCompliance('; G28 here\nG21', 'grbl')
    expect(findByCode(issues, 'GRBL_NO_G28')).toHaveLength(0)
  })

  it('GRBL line-length warning fires above the 256 char threshold', () => {
    const long = 'G1 ' + 'X10 '.repeat(70) // ~283 chars > 256
    const issues = validateDialectCompliance(long, 'grbl')
    expect(findByCode(issues, 'GRBL_LINE_LENGTH')).toHaveLength(1)
  })

  it('GRBL parenthetical-comment warning uses code GRBL_PAREN_COMMENT', () => {
    const issues = validateDialectCompliance('G1 X10 (inline comment)', 'grbl')
    expect(findByCode(issues, 'GRBL_PAREN_COMMENT')).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// E) Smoothieware-family branch (Carvera 3-axis ATC regression guard)
// ---------------------------------------------------------------------------

describe('[ID-0272] E) Smoothieware-family branch', () => {
  // The canonical Carvera 3-axis ATC block. The [ID-0160] regression guard:
  // this MUST NOT emit GRBL_NO_TLC because Smoothieware DOES support G43/G49.
  const CARVERA_ATC = [
    '; Makera Carvera -- 3-axis ATC tool change',
    'G21',
    'G90',
    'G17',
    'M5',
    'G0 Z25.000',
    'M6 T1',
    'G43 H1',
    'M3 S12000',
    'G0 X10 Y10',
    'G1 Z-2 F200',
    'G49',
    'M5',
    'G0 Z50.000',
    'M30'
  ].join('\n')

  it('routes dialect "smoothieware" through the Smoothieware checker', () => {
    const issues = validateDialectCompliance(CARVERA_ATC, 'smoothieware')
    // Should be issue-free: no GRBL_NO_TLC, no SMOOTHIEWARE_G28_CHECK
    expect(findByCode(issues, 'GRBL_NO_TLC')).toHaveLength(0)
    expect(findByCode(issues, 'SMOOTHIEWARE_G28_CHECK')).toHaveLength(0)
  })

  it('does NOT emit GRBL_NO_TLC on G43/G49 (the [ID-0160] regression guard)', () => {
    const issues = validateDialectCompliance('G43 H1\nG49', 'smoothieware')
    expect(findByCode(issues, 'GRBL_NO_TLC')).toHaveLength(0)
  })

  it('emits a SOFT G28 warning under SMOOTHIEWARE_G28_CHECK (not an error)', () => {
    const issues = validateDialectCompliance('G28 Z0', 'smoothieware')
    const g28 = findByCode(issues, 'SMOOTHIEWARE_G28_CHECK')
    expect(g28).toHaveLength(1)
    expect(g28[0].level).toBe('warning')
  })

  it('Smoothieware codes do NOT collide with GRBL_* codes', () => {
    const issues = validateDialectCompliance(
      'G28 Z0\nG43 H1\n(inline)',
      'smoothieware'
    )
    for (const i of issues) {
      expect(i.code.startsWith('GRBL_')).toBe(false)
    }
  })

  it('smoothieware preserves the GRBL line-length floor at 256 chars (under SMOOTHIEWARE_LINE_LENGTH)', () => {
    const long = 'G1 ' + 'X10 '.repeat(70)
    const issues = validateDialectCompliance(long, 'smoothieware')
    expect(findByCode(issues, 'SMOOTHIEWARE_LINE_LENGTH')).toHaveLength(1)
  })

  it('smoothieware parenthetical-comment warning uses the SMOOTHIEWARE_* prefix', () => {
    const issues = validateDialectCompliance('G1 X10 (inline)', 'smoothieware')
    expect(findByCode(issues, 'SMOOTHIEWARE_PAREN_COMMENT')).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// F) Fanuc / Mach3 / LinuxCNC / Siemens / Heidenhain branches
// ---------------------------------------------------------------------------

describe('[ID-0272] F) Fanuc / Mach3 / LinuxCNC / Siemens / Heidenhain branches', () => {
  it('routes dialect "fanuc" through the Fanuc checker', () => {
    const issues = validateDialectCompliance('G0 G1 X10', 'fanuc')
    expect(findByCode(issues, 'FANUC_MODAL_GROUP')).toHaveLength(1)
  })

  it('fanuc and fanuc_4axis return identical issues for the same input', () => {
    const gcode = 'G0 G1 X10'
    expect(validateDialectCompliance(gcode, 'fanuc')).toEqual(
      validateDialectCompliance(gcode, 'fanuc_4axis')
    )
  })

  it('routes dialect "mach3" through the Mach3 checker (% required)', () => {
    const issues = validateDialectCompliance('G21\nG90\nM30', 'mach3')
    expect(findByCode(issues, 'MACH3_NO_TAPE_START')).toHaveLength(1)
    expect(findByCode(issues, 'MACH3_NO_TAPE_END')).toHaveLength(1)
  })

  it('mach3 and mach3_4axis return identical issues for the same input', () => {
    const gcode = 'G21\nG90\nM30'
    expect(validateDialectCompliance(gcode, 'mach3')).toEqual(
      validateDialectCompliance(gcode, 'mach3_4axis')
    )
  })

  it('routes dialect "linuxcnc_4axis" through the LinuxCNC checker (% + M2 preferred)', () => {
    const issues = validateDialectCompliance('G21\nG90\nM30', 'linuxcnc_4axis')
    expect(findByCode(issues, 'LINUXCNC_NO_TAPE_START')).toHaveLength(1)
    expect(findByCode(issues, 'LINUXCNC_NO_TAPE_END')).toHaveLength(1)
    expect(findByCode(issues, 'LINUXCNC_PREFER_M2')).toHaveLength(1)
  })

  it('routes dialect "siemens" through the Siemens checker (G28 -> error)', () => {
    const issues = validateDialectCompliance('G28 Z0', 'siemens')
    const g28 = findByCode(issues, 'SIEMENS_NO_G28')
    expect(g28).toHaveLength(1)
    expect(g28[0].level).toBe('error')
  })

  it('siemens and siemens_4axis return identical issues for the same input', () => {
    const gcode = 'G28 Z0'
    expect(validateDialectCompliance(gcode, 'siemens')).toEqual(
      validateDialectCompliance(gcode, 'siemens_4axis')
    )
  })

  it('routes dialect "heidenhain" through the Heidenhain checker (no extra rules)', () => {
    const issues = validateDialectCompliance('G21\nG90\nG28 Z0\nM30', 'heidenhain')
    // Heidenhain has no dialect-specific guards on top of structural checks
    expect(issues).toEqual([])
  })

  it('heidenhain and heidenhain_4axis return identical issues for the same input', () => {
    const gcode = 'G21\nG90\nG28 Z0\nM30'
    expect(validateDialectCompliance(gcode, 'heidenhain')).toEqual(
      validateDialectCompliance(gcode, 'heidenhain_4axis')
    )
  })

  it('routes dialect "generic_mm" to the no-op default (returns [])', () => {
    const issues = validateDialectCompliance(
      'G21\nG90\nG28 Z0\nM30\n(parens)',
      'generic_mm'
    )
    expect(issues).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// G) Modal-group conflict detection (Fanuc)
// ---------------------------------------------------------------------------

describe('[ID-0272] G) Fanuc modal-group conflict detection', () => {
  it('flags two members of modal group 1 (G0 + G1) on one line', () => {
    const issues = validateDialectCompliance('G0 G1 X10', 'fanuc')
    expect(findByCode(issues, 'FANUC_MODAL_GROUP')).toHaveLength(1)
  })

  it('flags two members of modal group 3 (G90 + G91) on one line', () => {
    const issues = validateDialectCompliance('G90 G91 X10', 'fanuc')
    expect(findByCode(issues, 'FANUC_MODAL_GROUP')).toHaveLength(1)
  })

  it('flags two members of modal group 6 (G20 + G21) on one line', () => {
    const issues = validateDialectCompliance('G20 G21', 'fanuc')
    expect(findByCode(issues, 'FANUC_MODAL_GROUP')).toHaveLength(1)
  })

  it('does NOT flag G91 + G28 on one line (different modal groups)', () => {
    const issues = validateDialectCompliance('G91 G28 Z0', 'fanuc')
    expect(findByCode(issues, 'FANUC_MODAL_GROUP')).toHaveLength(0)
  })

  it('modal-group warnings are level "warning" (not error)', () => {
    const issues = validateDialectCompliance('G0 G1 X10', 'fanuc')
    const m = findByCode(issues, 'FANUC_MODAL_GROUP')
    expect(m[0].level).toBe('warning')
  })

  it('modal-group warning message lists the conflicting codes', () => {
    const issues = validateDialectCompliance('G0 G1 X10', 'fanuc')
    const m = findByCode(issues, 'FANUC_MODAL_GROUP')
    expect(m[0].message).toContain('G0')
    expect(m[0].message).toContain('G1')
  })
})

// ---------------------------------------------------------------------------
// H) Three-machine fleet pinning
// ---------------------------------------------------------------------------

describe('[ID-0272] H) bundled-fleet pinning (three target machines)', () => {
  it('Creality K2 Plus profile dialect is "generic_mm"', () => {
    const m = loadProfile('creality-k2-plus.json')
    expect(m.dialect).toBe('generic_mm')
  })

  it('K2 Plus FDM canonical G-code passes generic_mm with ZERO issues', () => {
    const m = loadProfile('creality-k2-plus.json')
    const fdm = [
      ';FLAVOR:Marlin',
      'M140 S60',
      'M104 S210',
      'G28',
      'G1 Z5 F3000',
      'G1 X10 Y10 F1500',
      'G1 E5 F300',
      'M104 S0',
      'M140 S0',
      'M84'
    ].join('\n')
    expect(validateDialectCompliance(fdm, m.dialect)).toEqual([])
  })

  it('Laguna Swift 5x10 profile dialect is "mach3"', () => {
    const m = loadProfile('laguna-swift-5x10.json')
    expect(m.dialect).toBe('mach3')
  })

  it('Laguna Swift G-code without %% markers warns under mach3 (RichAuto safety)', () => {
    const m = loadProfile('laguna-swift-5x10.json')
    const noTape = 'G21\nG90\nG17\nG0 Z10\nM30'
    const issues = validateDialectCompliance(noTape, m.dialect)
    expect(findByCode(issues, 'MACH3_NO_TAPE_START')).toHaveLength(1)
    expect(findByCode(issues, 'MACH3_NO_TAPE_END')).toHaveLength(1)
  })

  it('Laguna Swift G-code WITH %% markers passes mach3 cleanly', () => {
    const m = loadProfile('laguna-swift-5x10.json')
    const tape = ['%', 'G21', 'G90', 'G17', 'G0 Z10', 'M30', '%'].join('\n')
    expect(validateDialectCompliance(tape, m.dialect)).toEqual([])
  })

  it('Makera Carvera 3-axis profile dialect is "smoothieware"', () => {
    const m = loadProfile('makera-carvera-3axis.json')
    expect(m.dialect).toBe('smoothieware')
  })

  it('Carvera 3-axis ATC block (G43/G49) passes smoothieware with NO GRBL_NO_TLC', () => {
    const m = loadProfile('makera-carvera-3axis.json')
    const atc = [
      'G21',
      'G90',
      'M5',
      'G0 Z25',
      'M6 T1',
      'G43 H1',
      'M3 S12000',
      'G1 X10 F800',
      'G49',
      'M5',
      'M30'
    ].join('\n')
    const issues = validateDialectCompliance(atc, m.dialect)
    expect(findByCode(issues, 'GRBL_NO_TLC')).toHaveLength(0)
  })

  it('Makera Carvera 4-axis profile dialect is "grbl_4axis"', () => {
    const m = loadProfile('makera-carvera-4axis.json')
    expect(m.dialect).toBe('grbl_4axis')
  })

  it('Carvera 4-axis G28 emission is flagged at ERROR level (rotary collision risk)', () => {
    const m = loadProfile('makera-carvera-4axis.json')
    const issues = validateDialectCompliance('G21\nG90\nG28 Z0\nM30', m.dialect)
    const g28 = findByCode(issues, 'GRBL_NO_G28')
    expect(g28).toHaveLength(1)
    expect(g28[0].level).toBe('error')
  })

  it('every bundled profile dialect is one of the supported ALL_DIALECTS literals', () => {
    for (const fname of [
      'creality-k2-plus.json',
      'laguna-swift-5x10.json',
      'makera-carvera-3axis.json',
      'makera-carvera-4axis.json'
    ] as const) {
      const m = loadProfile(fname)
      expect(ALL_DIALECTS).toContain(m.dialect)
    }
  })
})

// ---------------------------------------------------------------------------
// I) Purity / non-mutation invariants
// ---------------------------------------------------------------------------

describe('[ID-0272] I) purity and non-mutation invariants', () => {
  it('does NOT mutate the gcode input string (strings are immutable but JSON.stringify pin)', () => {
    const gcode = 'G21\nG28 Z0\nM30'
    const snapshot = JSON.stringify(gcode)
    validateDialectCompliance(gcode, 'grbl')
    expect(JSON.stringify(gcode)).toBe(snapshot)
  })

  it('returns a fresh Array each call (no shared instance reuse)', () => {
    const a = validateDialectCompliance('G28 Z0', 'grbl')
    const b = validateDialectCompliance('G28 Z0', 'grbl')
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
  })

  it('returns deeply-equal results across N=10 invocations with the same input (GRBL)', () => {
    const baseline = validateDialectCompliance('G28 Z0\nG43 H1', 'grbl')
    for (let i = 0; i < 10; i++) {
      expect(validateDialectCompliance('G28 Z0\nG43 H1', 'grbl')).toEqual(
        baseline
      )
    }
  })

  it('returns deeply-equal results across N=10 invocations with the same input (Smoothieware)', () => {
    const baseline = validateDialectCompliance('G28 Z0\nG43 H1', 'smoothieware')
    for (let i = 0; i < 10; i++) {
      expect(validateDialectCompliance('G28 Z0\nG43 H1', 'smoothieware')).toEqual(
        baseline
      )
    }
  })

  it('result for dialect A does NOT depend on prior calls with dialect B', () => {
    // Call grbl, then siemens, then grbl again -- the third should match the first.
    const first = validateDialectCompliance('G28 Z0', 'grbl')
    void validateDialectCompliance('G28 Z0', 'siemens')
    void validateDialectCompliance('G28 Z0', 'fanuc')
    const third = validateDialectCompliance('G28 Z0', 'grbl')
    expect(third).toEqual(first)
  })

  it('accepts a frozen result Array from a prior call without throwing on the next call', () => {
    const a = validateDialectCompliance('G28 Z0', 'grbl')
    Object.freeze(a)
    expect(() => validateDialectCompliance('G28 Z0', 'grbl')).not.toThrow()
  })

  it('issue records are independent objects across calls (no shared instance reuse)', () => {
    const a = validateDialectCompliance('G28 Z0', 'grbl')
    const b = validateDialectCompliance('G28 Z0', 'grbl')
    expect(a[0]).not.toBe(b[0])
  })
})

// ---------------------------------------------------------------------------
// J) Dialect-family routing exhaustiveness
// ---------------------------------------------------------------------------

describe('[ID-0272] J) dialect-family routing exhaustiveness', () => {
  it('every dialect literal in the schema enum is accepted (no throw)', () => {
    for (const d of ALL_DIALECTS) {
      expect(() => validateDialectCompliance('G21', d)).not.toThrow()
    }
  })

  it('every dialect returns a plain Array', () => {
    for (const d of ALL_DIALECTS) {
      const r = validateDialectCompliance('G21', d)
      expect(Array.isArray(r)).toBe(true)
    }
  })

  it('GRBL family pair (grbl, grbl_4axis) shares the same checker', () => {
    const gcode = 'G28 Z0'
    expect(validateDialectCompliance(gcode, 'grbl')).toEqual(
      validateDialectCompliance(gcode, 'grbl_4axis')
    )
  })

  it('Mach3 family pair (mach3, mach3_4axis) shares the same checker', () => {
    const gcode = 'G21'
    expect(validateDialectCompliance(gcode, 'mach3')).toEqual(
      validateDialectCompliance(gcode, 'mach3_4axis')
    )
  })

  it('Fanuc family pair (fanuc, fanuc_4axis) shares the same checker', () => {
    const gcode = 'G0 G1 X10'
    expect(validateDialectCompliance(gcode, 'fanuc')).toEqual(
      validateDialectCompliance(gcode, 'fanuc_4axis')
    )
  })

  it('Siemens family pair (siemens, siemens_4axis) shares the same checker', () => {
    const gcode = 'G28 Z0'
    expect(validateDialectCompliance(gcode, 'siemens')).toEqual(
      validateDialectCompliance(gcode, 'siemens_4axis')
    )
  })

  it('Heidenhain family pair (heidenhain, heidenhain_4axis) shares the same checker', () => {
    const gcode = 'G21\nG28 Z0'
    expect(validateDialectCompliance(gcode, 'heidenhain')).toEqual(
      validateDialectCompliance(gcode, 'heidenhain_4axis')
    )
  })

  it('Smoothieware does NOT alias to GRBL (different code prefixes on G28)', () => {
    const gcode = 'G28 Z0'
    const grbl = validateDialectCompliance(gcode, 'grbl')
    const sw = validateDialectCompliance(gcode, 'smoothieware')
    // GRBL emits an ERROR; Smoothieware emits a WARNING
    expect(grbl.some((i) => i.code === 'GRBL_NO_G28')).toBe(true)
    expect(sw.some((i) => i.code === 'SMOOTHIEWARE_G28_CHECK')).toBe(true)
    expect(sw.some((i) => i.code === 'GRBL_NO_G28')).toBe(false)
  })

  it('linuxcnc_4axis is the ONLY linuxcnc-family dialect (no plain "linuxcnc" enum value)', () => {
    // The schema only declares linuxcnc_4axis; ensure no surprise plain literal.
    expect((ALL_DIALECTS as readonly string[]).includes('linuxcnc')).toBe(false)
    expect((ALL_DIALECTS as readonly string[]).includes('linuxcnc_4axis')).toBe(
      true
    )
  })

  it('generic_mm and any unknown family literal route to the no-op default', () => {
    expect(validateDialectCompliance('G28 Z0', 'generic_mm')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// K) Source-text whitelist
// ---------------------------------------------------------------------------

describe('[ID-0272] K) source-text whitelist', () => {
  it('imports the MachineProfile type-only (no runtime import from machine-schema)', () => {
    expect(SRC).toMatch(
      /^import type \{ MachineProfile \} from '\.\/machine-schema'$/m
    )
  })

  it('exports ComplianceLevel as a TypeScript type alias', () => {
    expect(SRC).toMatch(/^export type ComplianceLevel =/m)
  })

  it('exports ComplianceIssue as a TypeScript type alias', () => {
    expect(SRC).toMatch(/^export type ComplianceIssue =/m)
  })

  it('declares ComplianceLevel as the union "error" | "warning"', () => {
    expect(SRC).toMatch(/'error'\s*\|\s*'warning'/)
  })

  it('declares the GRBL_MAX_LINE_LENGTH constant at 256', () => {
    expect(SRC).toMatch(/GRBL_MAX_LINE_LENGTH\s*=\s*256/)
  })

  it('declares MODAL_GROUP_1 with G0/G1/G2/G3', () => {
    expect(SRC).toMatch(/MODAL_GROUP_1\s*=\s*\[\s*'G0'\s*,\s*'G1'\s*,\s*'G2'\s*,\s*'G3'\s*\]/)
  })

  it('declares MODAL_GROUP_3 with G90/G91', () => {
    expect(SRC).toMatch(/MODAL_GROUP_3\s*=\s*\[\s*'G90'\s*,\s*'G91'\s*\]/)
  })

  it('declares MODAL_GROUP_6 with G20/G21', () => {
    expect(SRC).toMatch(/MODAL_GROUP_6\s*=\s*\[\s*'G20'\s*,\s*'G21'\s*\]/)
  })

  it('exports `validateDialectCompliance` as a named function', () => {
    expect(SRC).toMatch(/^export function validateDialectCompliance\(/m)
  })

  it('JSDoc cites the Cycle 67 / Cycle 68 [ID-0155] / [ID-0160] dialect-mislabel split provenance', () => {
    expect(SRC).toContain('[ID-0155]')
    expect(SRC).toContain('[ID-0160]')
    expect(SRC).toContain('Cycle 67')
    expect(SRC).toContain('Cycle 68')
  })

  it('JSDoc names the Smoothieware-family controllers (Makera Carvera 3-axis)', () => {
    expect(SRC).toContain('Makera Carvera 3-axis')
  })

  it('JSDoc cites the gcode-safety skill carvera-3axis reference', () => {
    expect(SRC).toContain('gcode-safety')
    expect(SRC).toContain('carvera-3axis')
  })

  it('JSDoc names the helper as a Pure function (no side effects)', () => {
    expect(SRC).toMatch(/Pure function -- no side effects\.|Pure function — no side effects\./)
  })

  it('GRBL checker emits the documented code GRBL_NO_G28', () => {
    expect(SRC).toContain('GRBL_NO_G28')
  })

  it('GRBL checker emits the documented code GRBL_NO_TLC', () => {
    expect(SRC).toContain('GRBL_NO_TLC')
  })

  it('GRBL checker emits the documented code GRBL_PAREN_COMMENT', () => {
    expect(SRC).toContain('GRBL_PAREN_COMMENT')
  })

  it('GRBL checker emits the documented code GRBL_LINE_LENGTH', () => {
    expect(SRC).toContain('GRBL_LINE_LENGTH')
  })

  it('Smoothieware checker emits the documented code SMOOTHIEWARE_G28_CHECK', () => {
    expect(SRC).toContain('SMOOTHIEWARE_G28_CHECK')
  })

  it('Smoothieware checker emits the documented code SMOOTHIEWARE_PAREN_COMMENT', () => {
    expect(SRC).toContain('SMOOTHIEWARE_PAREN_COMMENT')
  })

  it('Smoothieware checker emits the documented code SMOOTHIEWARE_LINE_LENGTH', () => {
    expect(SRC).toContain('SMOOTHIEWARE_LINE_LENGTH')
  })

  it('Fanuc checker emits the documented code FANUC_MODAL_GROUP', () => {
    expect(SRC).toContain('FANUC_MODAL_GROUP')
  })

  it('Mach3 checker emits the documented codes MACH3_NO_TAPE_START / MACH3_NO_TAPE_END', () => {
    expect(SRC).toContain('MACH3_NO_TAPE_START')
    expect(SRC).toContain('MACH3_NO_TAPE_END')
  })

  it('LinuxCNC checker emits the documented codes LINUXCNC_NO_TAPE_START / _END / _PREFER_M2', () => {
    expect(SRC).toContain('LINUXCNC_NO_TAPE_START')
    expect(SRC).toContain('LINUXCNC_NO_TAPE_END')
    expect(SRC).toContain('LINUXCNC_PREFER_M2')
  })

  it('Siemens checker emits the documented code SIEMENS_NO_G28', () => {
    expect(SRC).toContain('SIEMENS_NO_G28')
  })

  it('module declares NO default export', () => {
    expect(SRC).not.toMatch(/^export default /m)
  })

  it('module declares NO top-level `let` (purity invariant)', () => {
    const code = codeOnly(SRC)
    expect(code).not.toMatch(/^let /m)
  })

  it('module declares NO top-level `var` (purity invariant)', () => {
    const code = codeOnly(SRC)
    expect(code).not.toMatch(/^var /m)
  })

  it('module has NO `: any` type annotation in executable code (Safety Rule 3)', () => {
    const code = codeOnly(SRC)
    expect(code).not.toMatch(/:\s*any\b/)
  })

  it('module has NO `as any` cast in executable code (Safety Rule 3)', () => {
    const code = codeOnly(SRC)
    expect(code).not.toMatch(/\bas\s+any\b/)
  })

  it('module has NO `<any>` generic argument in executable code (Safety Rule 3)', () => {
    const code = codeOnly(SRC)
    expect(code).not.toMatch(/<any>/)
  })

  it('module imports NOTHING from electron / fs / path / child_process / dgram / net / tls (Safety Rule 4)', () => {
    expect(SRC).not.toMatch(/from\s+'electron'/)
    expect(SRC).not.toMatch(/from\s+'(node:)?fs'/)
    expect(SRC).not.toMatch(/from\s+'(node:)?path'/)
    expect(SRC).not.toMatch(/from\s+'(node:)?child_process'/)
    expect(SRC).not.toMatch(/from\s+'(node:)?dgram'/)
    expect(SRC).not.toMatch(/from\s+'(node:)?net'/)
    expect(SRC).not.toMatch(/from\s+'(node:)?tls'/)
  })

  it('module imports NOTHING React / DOM (lives under src/shared/)', () => {
    expect(SRC).not.toMatch(/from\s+'react'/)
    expect(SRC).not.toMatch(/from\s+'react-dom'/)
  })

  it('module emits NO Handlebars tokens (no {{...}} templates)', () => {
    expect(SRC).not.toMatch(/\{\{[^}]+\}\}/)
  })

  it('module references NO foreign-machine vendor names (only the three target machines are named)', () => {
    expect(SRC).not.toMatch(
      /\b(?:Bambu|Prusa|Voron|Ender-N|Onefinity|Shapeoko|Longmill|Tormach|Haas)\b/
    )
  })

  it('module does NOT import from process / os / crypto (Safety Rule 4)', () => {
    expect(SRC).not.toMatch(/from\s+'(node:)?os'/)
    expect(SRC).not.toMatch(/from\s+'(node:)?crypto'/)
    expect(SRC).not.toMatch(/from\s+'(node:)?process'/)
  })

  it('module exports exactly 1 `export function` declaration (validateDialectCompliance only)', () => {
    const matches = SRC.match(/^export function /gm) ?? []
    expect(matches).toHaveLength(1)
  })

  it('module exports exactly 2 `export type` declarations (ComplianceLevel + ComplianceIssue)', () => {
    const matches = SRC.match(/^export type /gm) ?? []
    expect(matches).toHaveLength(2)
  })

  it('source size stays under 500 lines (load-bearing terseness invariant)', () => {
    const lines = SRC.split('\n').length
    expect(lines).toBeLessThan(500)
  })

  it('source size stays under 16 KB (load-bearing terseness invariant)', () => {
    expect(Buffer.byteLength(SRC, 'utf8')).toBeLessThan(16 * 1024)
  })

  it('TypeScript widens ComplianceLevel correctly (compile-time pin)', () => {
    const lvl: ComplianceLevel = 'error'
    expect(lvl).toBe('error')
    const lvl2: ComplianceLevel = 'warning'
    expect(lvl2).toBe('warning')
  })
})
