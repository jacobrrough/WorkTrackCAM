import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { MachineProfile } from '../shared/machine-schema'
import {
  applyLineNumbering,
  detectRepeatPatterns,
  renderPost,
  wrapRepeatPatternsAsSubroutines,
} from './post-process'
import type { LineNumberingConfig } from './post-process'

const machine: MachineProfile = {
  id: 'test-mill',
  name: 'Test mill',
  kind: 'cnc',
  workAreaMm: { x: 200, y: 200, z: 100 },
  maxFeedMmMin: 5000,
  postTemplate: 'cnc_generic_mm.hbs',
  dialect: 'grbl',
}

const resourcesRoot = join(process.cwd(), 'resources')

// ── detectRepeatPatterns ────────────────────────────────────────────────────────

describe('detectRepeatPatterns', () => {
  it('detects a 2-line block repeated 3 times', () => {
    const lines = [
      'G0 Z5',
      'G1 Z-1 F200',
      'G0 Z5',
      'G1 Z-1 F200',
      'G0 Z5',
      'G1 Z-1 F200',
    ]
    const patterns = detectRepeatPatterns(lines)
    expect(patterns.length).toBe(1)
    expect(patterns[0]!.lines).toEqual(['G0 Z5', 'G1 Z-1 F200'])
    expect(patterns[0]!.count).toBe(3)
    expect(patterns[0]!.startIndex).toBe(0)
  })

  it('detects a 3-line block repeated 4 times', () => {
    const lines = Array.from({ length: 4 }, () => [
      'G0 X10',
      'G1 Z-2 F300',
      'G0 Z5',
    ]).flat()
    const patterns = detectRepeatPatterns(lines)
    expect(patterns.length).toBe(1)
    expect(patterns[0]!.lines.length).toBe(3)
    expect(patterns[0]!.count).toBe(4)
  })

  it('returns empty for non-repeating lines', () => {
    const lines = ['G0 X1', 'G0 X2', 'G0 X3', 'G0 X4']
    const patterns = detectRepeatPatterns(lines)
    expect(patterns.length).toBe(0)
  })

  it('returns empty when block repeats fewer than minRepeats', () => {
    const lines = [
      'G0 Z5',
      'G1 Z-1 F200',
      'G0 Z5',
      'G1 Z-1 F200',
    ]
    const patterns = detectRepeatPatterns(lines, 3) // needs 3 repeats, only has 2
    expect(patterns.length).toBe(0)
  })

  it('ignores extra whitespace when matching', () => {
    const lines = [
      'G0 Z5',
      'G1 Z-1 F200',
      'G0  Z5',           // extra space
      'G1 Z-1  F200',     // extra space
      'G0 Z5',
      'G1 Z-1 F200',
    ]
    const patterns = detectRepeatPatterns(lines)
    expect(patterns.length).toBe(1)
    expect(patterns[0]!.count).toBe(3)
  })

  it('handles custom minRepeats parameter', () => {
    const lines = Array.from({ length: 5 }, () => ['G0 Z5', 'G1 Z-1 F200']).flat()
    const patterns = detectRepeatPatterns(lines, 5)
    expect(patterns.length).toBe(1)
    expect(patterns[0]!.count).toBe(5)
  })

  it('handles lines with content before and after the repeat block', () => {
    const lines = [
      'G21',
      'G90',
      'G0 Z5',
      'G1 Z-1 F200',
      'G0 Z5',
      'G1 Z-1 F200',
      'G0 Z5',
      'G1 Z-1 F200',
      'M30',
    ]
    const patterns = detectRepeatPatterns(lines)
    expect(patterns.length).toBe(1)
    expect(patterns[0]!.startIndex).toBe(2)
    expect(patterns[0]!.count).toBe(3)
  })
})

// ── wrapRepeatPatternsAsSubroutines ─────────────────────────────────────────────

describe('wrapRepeatPatternsAsSubroutines', () => {
  const repeatingLines = [
    'G0 Z5',
    'G1 Z-1 F200',
    'G0 Z5',
    'G1 Z-1 F200',
    'G0 Z5',
    'G1 Z-1 F200',
  ]

  it('Fanuc: replaces repeat block with M98 call and generates O-word subroutine', () => {
    const result = wrapRepeatPatternsAsSubroutines(repeatingLines, 'fanuc')

    // Main lines should contain the M98 call
    expect(result.mainLines.some((l) => l.startsWith('M98 P1000 L3'))).toBe(true)

    // Subroutine defs should contain O-word, body, and M99
    const defsStr = result.subroutineDefs.join('\n')
    expect(defsStr).toContain('O1000')
    expect(defsStr).toContain('G0 Z5')
    expect(defsStr).toContain('G1 Z-1 F200')
    expect(defsStr).toContain('M99')
  })

  it('Siemens: replaces repeat block with CALL L and generates L-label subroutine', () => {
    const result = wrapRepeatPatternsAsSubroutines(repeatingLines, 'siemens')

    expect(result.mainLines.some((l) => l.startsWith('CALL L1000 REP 3'))).toBe(true)

    const defsStr = result.subroutineDefs.join('\n')
    expect(defsStr).toContain('L1000:')
    expect(defsStr).toContain('RET')
  })

  it('Mach3: replaces repeat block with M98 call and generates O-sub/endsub', () => {
    const result = wrapRepeatPatternsAsSubroutines(repeatingLines, 'mach3')

    expect(result.mainLines.some((l) => l.startsWith('M98 P1000 L3'))).toBe(true)

    const defsStr = result.subroutineDefs.join('\n')
    expect(defsStr).toContain('O1000 sub')
    expect(defsStr).toContain('O1000 endsub')
  })

  it('returns original lines when no repeat patterns found', () => {
    const noRepeat = ['G0 X1', 'G0 X2', 'G0 X3']
    const result = wrapRepeatPatternsAsSubroutines(noRepeat, 'fanuc')

    expect(result.mainLines).toEqual(noRepeat)
    expect(result.subroutineDefs.length).toBe(0)
  })

  it('custom startSubNumber changes the O/L number', () => {
    const result = wrapRepeatPatternsAsSubroutines(repeatingLines, 'fanuc', 5000)

    expect(result.mainLines.some((l) => l.includes('P5000'))).toBe(true)
    const defsStr = result.subroutineDefs.join('\n')
    expect(defsStr).toContain('O5000')
  })

  it('main lines are shorter than original when subroutines are extracted', () => {
    const result = wrapRepeatPatternsAsSubroutines(repeatingLines, 'fanuc')
    // 6 original lines -> 2 (comment + call) + subroutine defs
    expect(result.mainLines.length).toBeLessThan(repeatingLines.length)
  })

  it('subroutine body contains the block lines (one copy)', () => {
    const result = wrapRepeatPatternsAsSubroutines(repeatingLines, 'fanuc')
    const defsStr = result.subroutineDefs.join('\n')
    // Should have exactly one copy of the block in the subroutine def
    const g0Count = defsStr.split('G0 Z5').length - 1
    expect(g0Count).toBe(1)
  })
})

// ── applyLineNumbering ──────────────────────────────────────────────────────────

describe('applyLineNumbering', () => {
  const defaultConfig: LineNumberingConfig = { enabled: true, start: 10, increment: 10 }

  it('prepends N-words starting at configured start value', () => {
    const gcode = 'G21\nG90\nG0 X0 Y0'
    const result = applyLineNumbering(gcode, defaultConfig)
    const lines = result.split('\n')
    expect(lines[0]).toBe('N10 G21')
    expect(lines[1]).toBe('N20 G90')
    expect(lines[2]).toBe('N30 G0 X0 Y0')
  })

  it('increments by the configured increment value', () => {
    const gcode = 'G21\nG90\nG0 X0'
    const config: LineNumberingConfig = { enabled: true, start: 5, increment: 5 }
    const result = applyLineNumbering(gcode, config)
    const lines = result.split('\n')
    expect(lines[0]).toBe('N5 G21')
    expect(lines[1]).toBe('N10 G90')
    expect(lines[2]).toBe('N15 G0 X0')
  })

  it('custom start=100 and increment=100 produces N100, N200, N300...', () => {
    const gcode = 'G21\nG90\nG0 X0'
    const config: LineNumberingConfig = { enabled: true, start: 100, increment: 100 }
    const result = applyLineNumbering(gcode, config)
    const lines = result.split('\n')
    expect(lines[0]).toBe('N100 G21')
    expect(lines[1]).toBe('N200 G90')
    expect(lines[2]).toBe('N300 G0 X0')
  })

  it('skips blank lines — no N-word on empty lines', () => {
    const gcode = 'G21\n\nG90'
    const result = applyLineNumbering(gcode, defaultConfig)
    const lines = result.split('\n')
    expect(lines[0]).toBe('N10 G21')
    expect(lines[1]).toBe('')  // blank line unchanged
    expect(lines[2]).toBe('N20 G90')
  })

  it('skips semicolon comment lines', () => {
    const gcode = '; This is a comment\nG21\n; Another comment\nG90'
    const result = applyLineNumbering(gcode, defaultConfig)
    const lines = result.split('\n')
    expect(lines[0]).toBe('; This is a comment')  // unchanged
    expect(lines[1]).toBe('N10 G21')
    expect(lines[2]).toBe('; Another comment')  // unchanged
    expect(lines[3]).toBe('N20 G90')
  })

  it('skips parenthetical comment lines (Fanuc style)', () => {
    const gcode = '(PROGRAM START)\nG21\n(END)'
    const result = applyLineNumbering(gcode, defaultConfig)
    const lines = result.split('\n')
    expect(lines[0]).toBe('(PROGRAM START)')
    expect(lines[1]).toBe('N10 G21')
    expect(lines[2]).toBe('(END)')
  })

  it('returns gcode unchanged when enabled=false', () => {
    const gcode = 'G21\nG90\nG0 X0'
    const config: LineNumberingConfig = { enabled: false, start: 10, increment: 10 }
    const result = applyLineNumbering(gcode, config)
    expect(result).toBe(gcode)
  })

  it('numbers M-codes and motion commands correctly', () => {
    const gcode = 'M3 S12000\nG0 X10 Y10\nG1 Z-5 F200\nM5\nM30'
    const result = applyLineNumbering(gcode, defaultConfig)
    const lines = result.split('\n')
    expect(lines[0]).toBe('N10 M3 S12000')
    expect(lines[1]).toBe('N20 G0 X10 Y10')
    expect(lines[2]).toBe('N30 G1 Z-5 F200')
    expect(lines[3]).toBe('N40 M5')
    expect(lines[4]).toBe('N50 M30')
  })

  it('works with start=1 and increment=1', () => {
    const gcode = 'G21\nG90'
    const config: LineNumberingConfig = { enabled: true, start: 1, increment: 1 }
    const result = applyLineNumbering(gcode, config)
    const lines = result.split('\n')
    expect(lines[0]).toBe('N1 G21')
    expect(lines[1]).toBe('N2 G90')
  })

  it('handles mixed comments and code correctly', () => {
    const gcode = '; Header\nG21\n; comment\n\nG90\nG0 X10\n; footer'
    const result = applyLineNumbering(gcode, defaultConfig)
    const lines = result.split('\n')
    expect(lines[0]).toBe('; Header')
    expect(lines[1]).toBe('N10 G21')
    expect(lines[2]).toBe('; comment')
    expect(lines[3]).toBe('')
    expect(lines[4]).toBe('N20 G90')
    expect(lines[5]).toBe('N30 G0 X10')
    expect(lines[6]).toBe('; footer')
  })
})

// ── renderPost integration — subroutines ────────────────────────────────────────

describe('renderPost with enableSubroutines', () => {
  it('Fanuc subroutines: repeated toolpath lines get wrapped with M98 call', async () => {
    const repeating = Array.from({ length: 3 }, () => ['G0 Z5', 'G1 Z-1 F200']).flat()
    const { gcode } = await renderPost(resourcesRoot, { ...machine, dialect: 'fanuc' }, repeating, {
      enableSubroutines: true,
      subroutineDialect: 'fanuc',
    })
    expect(gcode).toContain('M98 P1000 L3')
    expect(gcode).toContain('O1000')
    expect(gcode).toContain('M99')
    expect(gcode).toContain('SUBROUTINE DEFINITIONS')
  })

  it('Siemens subroutines: uses CALL L syntax', async () => {
    const repeating = Array.from({ length: 4 }, () => ['G0 Z5', 'G1 Z-1 F200']).flat()
    const { gcode } = await renderPost(resourcesRoot, { ...machine, dialect: 'siemens' }, repeating, {
      enableSubroutines: true,
      subroutineDialect: 'siemens',
    })
    expect(gcode).toContain('CALL L1000 REP 4')
    expect(gcode).toContain('L1000:')
    expect(gcode).toContain('RET')
  })

  it('Mach3 subroutines: uses O-sub/endsub syntax', async () => {
    const repeating = Array.from({ length: 3 }, () => ['G0 Z5', 'G1 Z-1 F200']).flat()
    const { gcode } = await renderPost(resourcesRoot, { ...machine, dialect: 'mach3' }, repeating, {
      enableSubroutines: true,
      subroutineDialect: 'mach3',
    })
    expect(gcode).toContain('M98 P1000 L3')
    expect(gcode).toContain('O1000 sub')
    expect(gcode).toContain('O1000 endsub')
  })

  it('no subroutines when enableSubroutines is false', async () => {
    const repeating = Array.from({ length: 3 }, () => ['G0 Z5', 'G1 Z-1 F200']).flat()
    const { gcode } = await renderPost(resourcesRoot, machine, repeating, {
      enableSubroutines: false,
    })
    expect(gcode).not.toContain('M98')
    expect(gcode).not.toContain('SUBROUTINE DEFINITIONS')
  })

  it('no subroutines when no repeating patterns exist', async () => {
    const unique = ['G0 X1', 'G0 X2', 'G0 X3']
    const { gcode } = await renderPost(resourcesRoot, machine, unique, {
      enableSubroutines: true,
      subroutineDialect: 'fanuc',
    })
    expect(gcode).not.toContain('M98')
    expect(gcode).not.toContain('SUBROUTINE DEFINITIONS')
  })
})

// ── renderPost integration — line numbering ─────────────────────────────────────

describe('renderPost with lineNumbering', () => {
  it('adds N-words to G-code output when enabled', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine, ['G0 X1 Y1'], {
      lineNumbering: { enabled: true, start: 10, increment: 10 },
    })
    // Should have at least one N-word line
    expect(gcode).toMatch(/N\d+ /)
    // First numbered line should be N10
    const firstN = gcode.split('\n').find((l) => l.startsWith('N'))
    expect(firstN).toMatch(/^N10 /)
  })

  it('does not add N-words when disabled', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine, ['G0 X1 Y1'], {
      lineNumbering: { enabled: false, start: 10, increment: 10 },
    })
    // No lines should start with N followed by digits
    const nLines = gcode.split('\n').filter((l) => /^N\d+\s/.test(l.trim()))
    expect(nLines.length).toBe(0)
  })

  it('custom start and increment are respected', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine, ['G0 X1 Y1'], {
      lineNumbering: { enabled: true, start: 100, increment: 50 },
    })
    // First numbered line should be N100
    const firstN = gcode.split('\n').find((l) => l.startsWith('N'))
    expect(firstN).toMatch(/^N100 /)
  })

  it('comment lines are not numbered', async () => {
    const { gcode } = await renderPost(resourcesRoot, machine, ['G0 X1'], {
      lineNumbering: { enabled: true, start: 10, increment: 10 },
    })
    // Comment lines (;) should NOT have N-words
    const commentLines = gcode.split('\n').filter((l) => l.trim().startsWith(';'))
    for (const cl of commentLines) {
      expect(cl).not.toMatch(/^N\d+/)
    }
  })

  it('line numbering combined with subroutines works correctly', async () => {
    const repeating = Array.from({ length: 3 }, () => ['G0 Z5', 'G1 Z-1 F200']).flat()
    const { gcode } = await renderPost(resourcesRoot, { ...machine, dialect: 'fanuc' }, repeating, {
      enableSubroutines: true,
      subroutineDialect: 'fanuc',
      lineNumbering: { enabled: true, start: 10, increment: 10 },
    })
    // Should have both subroutine calls AND N-words
    expect(gcode).toContain('M98 P1000 L3')
    expect(gcode).toMatch(/N\d+ /)
  })
})
