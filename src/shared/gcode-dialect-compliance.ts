import type { MachineProfile } from './machine-schema'

export type ComplianceLevel = 'error' | 'warning'

export type ComplianceIssue = {
  level: ComplianceLevel
  /** 1-based line number in the G-code output */
  line: number
  /** Machine-readable code, e.g. 'GRBL_NO_G28' */
  code: string
  /** Human-readable description */
  message: string
  /** The offending G-code line content */
  content: string
}

type Dialect = MachineProfile['dialect']

/** GRBL maximum line length (characters). */
const GRBL_MAX_LINE_LENGTH = 256

/**
 * G-code modal groups (ISO 6983 / RS-274).
 * Two G-codes from the same group on one line is a fault on most controllers.
 */
const MODAL_GROUP_1 = ['G0', 'G1', 'G2', 'G3'] as const
const MODAL_GROUP_3 = ['G90', 'G91'] as const
const MODAL_GROUP_6 = ['G20', 'G21'] as const

/** Strip inline comments and whitespace from a G-code line for analysis. */
function stripComments(line: string): string {
  // Remove parenthetical comments
  let result = line.replace(/\([^)]*\)/g, '')
  // Remove semicolon comments
  const semiIdx = result.indexOf(';')
  if (semiIdx >= 0) result = result.substring(0, semiIdx)
  return result.trim()
}

/** Check if a line is purely a comment (starts with ; or is entirely a parenthetical). */
function isCommentLine(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed === '' || trimmed.startsWith(';')) return true
  if (trimmed.startsWith('(') && trimmed.endsWith(')')) return true
  if (trimmed === '%') return true
  return false
}

/** Extract G-codes from a line (e.g. ['G0', 'G1', 'G21']). */
function extractGCodes(stripped: string): string[] {
  const matches = stripped.match(/G\d+(\.\d+)?/gi)
  return matches ? matches.map(m => m.toUpperCase()) : []
}

/** Extract M-codes from a line. */
function extractMCodes(stripped: string): string[] {
  const matches = stripped.match(/M\d+/gi)
  return matches ? matches.map(m => m.toUpperCase()) : []
}

/** Check if line contains a parenthetical comment. */
function hasParenComment(line: string): boolean {
  return /\([^)]*\)/.test(line)
}

// ── Dialect-specific rule sets ─────────────────────────────────────────────

function checkGrbl(lines: string[]): ComplianceIssue[] {
  const issues: ComplianceIssue[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNum = i + 1
    const stripped = stripComments(line)
    if (!stripped) continue

    const gCodes = extractGCodes(stripped)

    // G28/G30 unsupported on GRBL — causes alarm
    for (const g of gCodes) {
      if (g === 'G28' || g === 'G30') {
        issues.push({
          level: 'error',
          line: lineNum,
          code: 'GRBL_NO_G28',
          message: `${g} (reference return) is not supported by GRBL — remove or replace with G0 to a known position`,
          content: line
        })
      }
      // G43/G49 tool length compensation unsupported on stock GRBL
      if (g === 'G43' || g === 'G49') {
        issues.push({
          level: 'warning',
          line: lineNum,
          code: 'GRBL_NO_TLC',
          message: `${g} (tool length compensation) is not supported by stock GRBL firmware`,
          content: line
        })
      }
    }

    // Parenthetical comments — not all GRBL firmware supports them.
    // Only flag parens in the code portion (before any ; comment), since
    // text after ; is already ignored by GRBL.
    const codePortion = line.indexOf(';') >= 0 ? line.substring(0, line.indexOf(';')) : line
    if (hasParenComment(codePortion) && !isCommentLine(line)) {
      issues.push({
        level: 'warning',
        line: lineNum,
        code: 'GRBL_PAREN_COMMENT',
        message: 'Parenthetical comments may not be supported by all GRBL firmware — use ; comments instead',
        content: line
      })
    }

    // Line length — GRBL has a 256-char receive buffer
    if (line.length > GRBL_MAX_LINE_LENGTH) {
      issues.push({
        level: 'warning',
        line: lineNum,
        code: 'GRBL_LINE_LENGTH',
        message: `Line exceeds GRBL maximum length of ${GRBL_MAX_LINE_LENGTH} characters (${line.length} chars)`,
        content: line
      })
    }
  }
  return issues
}

function checkFanuc(lines: string[]): ComplianceIssue[] {
  const issues: ComplianceIssue[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNum = i + 1
    const stripped = stripComments(line)
    if (!stripped) continue

    const gCodes = extractGCodes(stripped)

    // Modal group conflicts: two G-codes from the same group on one line
    for (const group of [MODAL_GROUP_1, MODAL_GROUP_3, MODAL_GROUP_6]) {
      const found = gCodes.filter(g => (group as readonly string[]).includes(g))
      if (found.length > 1) {
        issues.push({
          level: 'warning',
          line: lineNum,
          code: 'FANUC_MODAL_GROUP',
          message: `Multiple G-codes from the same modal group on one line (${found.join(', ')}) — may cause alarm on Fanuc controllers`,
          content: line
        })
      }
    }
  }
  return issues
}

function checkMach3(lines: string[]): ComplianceIssue[] {
  const issues: ComplianceIssue[] = []
  const text = lines.join('\n')
  const trimmedFirst = lines[0]?.trim()
  const trimmedLast = lines[lines.length - 1]?.trim()

  // % tape start/end markers required
  if (trimmedFirst !== '%') {
    issues.push({
      level: 'warning',
      line: 1,
      code: 'MACH3_NO_TAPE_START',
      message: 'Missing % tape start marker — Mach3 expects RS-274 standard % at program start',
      content: lines[0] ?? ''
    })
  }
  if (trimmedLast !== '%') {
    // Check if % appears anywhere near the end
    let foundEnd = false
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 3); i--) {
      if (lines[i].trim() === '%') { foundEnd = true; break }
    }
    if (!foundEnd) {
      issues.push({
        level: 'warning',
        line: lines.length,
        code: 'MACH3_NO_TAPE_END',
        message: 'Missing % tape end marker — Mach3 expects RS-274 standard % at program end',
        content: lines[lines.length - 1] ?? ''
      })
    }
  }

  return issues
}

function checkLinuxCNC(lines: string[]): ComplianceIssue[] {
  const issues: ComplianceIssue[] = []

  // % tape markers required (RS-274NGC)
  const trimmedFirst = lines[0]?.trim()
  if (trimmedFirst !== '%') {
    issues.push({
      level: 'warning',
      line: 1,
      code: 'LINUXCNC_NO_TAPE_START',
      message: 'Missing % tape start marker — LinuxCNC expects RS-274NGC standard % at program start',
      content: lines[0] ?? ''
    })
  }
  let foundEnd = false
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 3); i--) {
    if (lines[i].trim() === '%') { foundEnd = true; break }
  }
  if (!foundEnd) {
    issues.push({
      level: 'warning',
      line: lines.length,
      code: 'LINUXCNC_NO_TAPE_END',
      message: 'Missing % tape end marker — LinuxCNC expects RS-274NGC standard % at program end',
      content: lines[lines.length - 1] ?? ''
    })
  }

  // Warn on M30 (M2 preferred on LinuxCNC)
  for (let i = 0; i < lines.length; i++) {
    const stripped = stripComments(lines[i])
    if (!stripped) continue
    const mCodes = extractMCodes(stripped)
    if (mCodes.includes('M30')) {
      issues.push({
        level: 'warning',
        line: i + 1,
        code: 'LINUXCNC_PREFER_M2',
        message: 'M30 rewinds on LinuxCNC — prefer M2 for program end',
        content: lines[i]
      })
    }
  }

  return issues
}

function checkSiemens(lines: string[]): ComplianceIssue[] {
  const issues: ComplianceIssue[] = []
  for (let i = 0; i < lines.length; i++) {
    const stripped = stripComments(lines[i])
    if (!stripped) continue
    const gCodes = extractGCodes(stripped)

    // G28 unsupported on Siemens — use SUPA or G75
    for (const g of gCodes) {
      if (g === 'G28' || g === 'G30') {
        issues.push({
          level: 'error',
          line: i + 1,
          code: 'SIEMENS_NO_G28',
          message: `${g} is not supported by Siemens Sinumerik — use SUPA G0 or G75 for reference return`,
          content: lines[i]
        })
      }
    }
  }
  return issues
}

function checkHeidenhain(lines: string[]): ComplianceIssue[] {
  // Heidenhain TNC in DIN/ISO mode accepts standard G-codes.
  // No additional dialect-specific checks beyond what's already validated structurally.
  return []
}

// ── Main validator ─────────────────────────────────────────────────────────

/** Base dialect family for rule selection. */
function dialectFamily(dialect: Dialect): string {
  if (dialect === 'grbl' || dialect === 'grbl_4axis') return 'grbl'
  if (dialect === 'fanuc' || dialect === 'fanuc_4axis') return 'fanuc'
  if (dialect === 'mach3' || dialect === 'mach3_4axis') return 'mach3'
  if (dialect === 'linuxcnc_4axis') return 'linuxcnc'
  if (dialect === 'siemens' || dialect === 'siemens_4axis') return 'siemens'
  if (dialect === 'heidenhain' || dialect === 'heidenhain_4axis') return 'heidenhain'
  return 'generic'
}

/**
 * Validate rendered G-code against controller-specific compliance rules.
 *
 * Pure function — no side effects. Takes the full G-code output string and
 * the target dialect, returns a list of compliance issues (errors and warnings).
 *
 * Errors indicate G-code that will alarm or fault the target controller.
 * Warnings indicate non-standard usage that may cause issues on some firmware builds.
 */
export function validateDialectCompliance(gcode: string, dialect: Dialect): ComplianceIssue[] {
  if (!gcode.trim()) return []
  const lines = gcode.split('\n')
  const family = dialectFamily(dialect)

  switch (family) {
    case 'grbl': return checkGrbl(lines)
    case 'fanuc': return checkFanuc(lines)
    case 'mach3': return checkMach3(lines)
    case 'linuxcnc': return checkLinuxCNC(lines)
    case 'siemens': return checkSiemens(lines)
    case 'heidenhain': return checkHeidenhain(lines)
    default: return []
  }
}
