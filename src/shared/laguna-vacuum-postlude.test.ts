/**
 * Laguna Swift 5x10 -- vacuum-zone post preamble / postamble
 * paired-pin contract ([ID-0020-followup]).
 *
 * Pins the public surface of `src/shared/laguna-vacuum-postlude.ts`
 * against silent drift. Mirrors the Cycle 97 [ID-0014] /
 * Cycle 98 [ID-0014b] / Cycle 100 [ID-0020] paired-pin shape:
 * one describe block per public symbol family, dense it() coverage
 * across happy-path, defensive, and JSDoc paired-pin invariants.
 *
 * Per-machine coverage:
 *   PRIMARY = Laguna Swift 5x10 (the only target machine with a
 *   6-zone vacuum sheet bed). UNAFFECTED = Creality K2 Plus,
 *   Makera Carvera + 4th Axis (neither has a sheet-vacuum bed).
 *
 * Safety Rule 1 (G-code is sacred): this test file is pure additive
 * paired-pin -- zero production-code edits and the helper module
 * itself emits no toolpath G-code. The wrap helper appends and
 * prepends documentation lines + optional digital-output M-codes
 * around an existing toolpath array, never mutates the toolpath
 * bytes themselves.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  allocateLagunaVacuumZones,
  allocateLagunaVacuumZonesForSheet,
  LAGUNA_VACUUM_ZONES,
  LAGUNA_VACUUM_ZONE_COUNT
} from './laguna-vacuum-allocator'
import {
  LAGUNA_VACUUM_DIGITAL_OUTPUT_MAP,
  LAGUNA_VACUUM_MCODE_WARNING,
  LAGUNA_VACUUM_OUTSIDE_ENVELOPE_WARNING,
  LAGUNA_VACUUM_POSTAMBLE_CLOSE,
  LAGUNA_VACUUM_POSTAMBLE_OPEN,
  LAGUNA_VACUUM_PREAMBLE_CLOSE,
  LAGUNA_VACUUM_PREAMBLE_OPEN,
  buildLagunaVacuumPostambleLines,
  buildLagunaVacuumPreambleLines,
  lagunaVacuumZonePNumber,
  wrapLagunaToolpathWithVacuumBlocks
} from './laguna-vacuum-postlude'

const POSTLUDE_TS_PATH = join(
  __dirname,
  'laguna-vacuum-postlude.ts'
)

function loadPostludeSource(): string {
  return readFileSync(POSTLUDE_TS_PATH, 'utf8')
}

describe('laguna-vacuum-postlude -- stable marker constants', () => {
  it('preamble open marker carries the Laguna machine name', () => {
    expect(LAGUNA_VACUUM_PREAMBLE_OPEN).toBe(
      '; --- Laguna Swift 5x10 vacuum zone allocation ---'
    )
  })

  it('preamble close marker is symmetric with the open marker', () => {
    expect(LAGUNA_VACUUM_PREAMBLE_CLOSE).toBe(
      '; --- end vacuum zone allocation ---'
    )
  })

  it('postamble open marker calls out the release block', () => {
    expect(LAGUNA_VACUUM_POSTAMBLE_OPEN).toBe(
      '; --- Laguna Swift 5x10 vacuum zone release ---'
    )
  })

  it('postamble close marker mirrors the open marker', () => {
    expect(LAGUNA_VACUUM_POSTAMBLE_CLOSE).toBe(
      '; --- end vacuum zone release ---'
    )
  })

  it('M-code warning is operator-readable + a semicolon comment', () => {
    expect(LAGUNA_VACUUM_MCODE_WARNING.startsWith('; ')).toBe(true)
    expect(LAGUNA_VACUUM_MCODE_WARNING).toMatch(/M64\/M65/)
    expect(LAGUNA_VACUUM_MCODE_WARNING).toMatch(/digital outputs/)
  })

  it('outside-envelope warning is a single line semicolon comment', () => {
    expect(LAGUNA_VACUUM_OUTSIDE_ENVELOPE_WARNING.startsWith('; ')).toBe(true)
    expect(LAGUNA_VACUUM_OUTSIDE_ENVELOPE_WARNING).toMatch(/past bed envelope/)
    expect(LAGUNA_VACUUM_OUTSIDE_ENVELOPE_WARNING.includes('\n')).toBe(false)
  })
})

describe('LAGUNA_VACUUM_DIGITAL_OUTPUT_MAP', () => {
  it('maps every zone id to a unique 0..5 P-number', () => {
    const ids = LAGUNA_VACUUM_ZONES.map((zone) => zone.id)
    const ps = ids.map((id) => LAGUNA_VACUUM_DIGITAL_OUTPUT_MAP[id])
    expect(ps).toEqual([0, 1, 2, 3, 4, 5])
    expect(new Set(ps).size).toBe(LAGUNA_VACUUM_ZONE_COUNT)
  })

  it('column-major order matches LAGUNA_VACUUM_ZONES exactly', () => {
    expect(LAGUNA_VACUUM_DIGITAL_OUTPUT_MAP['X0Y0']).toBe(0)
    expect(LAGUNA_VACUUM_DIGITAL_OUTPUT_MAP['X0Y1']).toBe(1)
    expect(LAGUNA_VACUUM_DIGITAL_OUTPUT_MAP['X0Y2']).toBe(2)
    expect(LAGUNA_VACUUM_DIGITAL_OUTPUT_MAP['X1Y0']).toBe(3)
    expect(LAGUNA_VACUUM_DIGITAL_OUTPUT_MAP['X1Y1']).toBe(4)
    expect(LAGUNA_VACUUM_DIGITAL_OUTPUT_MAP['X1Y2']).toBe(5)
  })

  it('is frozen so callers cannot mutate the map', () => {
    expect(Object.isFrozen(LAGUNA_VACUUM_DIGITAL_OUTPUT_MAP)).toBe(true)
  })
})

describe('lagunaVacuumZonePNumber', () => {
  it('returns the registered P-number for known ids', () => {
    expect(lagunaVacuumZonePNumber('X0Y0')).toBe(0)
    expect(lagunaVacuumZonePNumber('X1Y2')).toBe(5)
  })

  it('returns null for unknown ids', () => {
    expect(lagunaVacuumZonePNumber('X2Y0')).toBeNull()
    expect(lagunaVacuumZonePNumber('garbage')).toBeNull()
    expect(lagunaVacuumZonePNumber('')).toBeNull()
  })

  it('returns null for non-string inputs (defensive)', () => {
    // Cast through unknown to exercise the typeof guard at runtime.
    expect(
      lagunaVacuumZonePNumber(undefined as unknown as string)
    ).toBeNull()
    expect(
      lagunaVacuumZonePNumber(null as unknown as string)
    ).toBeNull()
    expect(
      lagunaVacuumZonePNumber(0 as unknown as string)
    ).toBeNull()
  })
})

describe('buildLagunaVacuumPreambleLines -- happy path (full sheet)', () => {
  const sheet = allocateLagunaVacuumZonesForSheet('full-sheet-48x96')
  if (!sheet) throw new Error('full-sheet-48x96 must resolve')
  const allocation = sheet.allocation
  const lines = buildLagunaVacuumPreambleLines(allocation)

  it('opens with the preamble open marker', () => {
    expect(lines[0]).toBe(LAGUNA_VACUUM_PREAMBLE_OPEN)
  })

  it('closes with the preamble close marker', () => {
    expect(lines[lines.length - 1]).toBe(LAGUNA_VACUUM_PREAMBLE_CLOSE)
  })

  it('reports 6 of 6 zones engaged with bed-coverage percentage', () => {
    const summary = lines.find((line) => line.includes('zones engaged'))
    expect(summary).toBeDefined()
    expect(summary).toMatch(/6 of 6 zones engaged/)
    expect(summary).toMatch(/% bed coverage/)
  })

  it('lists every engaged zone exactly once in column-major order', () => {
    const engagedLine = lines.find((line) =>
      line.startsWith('; Engaged zones:')
    )
    expect(engagedLine).toBeDefined()
    expect(engagedLine).toContain('X0Y0')
    expect(engagedLine).toContain('X0Y1')
    expect(engagedLine).toContain('X0Y2')
    expect(engagedLine).toContain('X1Y0')
    expect(engagedLine).toContain('X1Y1')
    expect(engagedLine).toContain('X1Y2')
    const idx0 = engagedLine!.indexOf('X0Y0')
    const idx5 = engagedLine!.indexOf('X1Y2')
    expect(idx0).toBeLessThan(idx5)
  })

  it('emits "(none)" sentinel on the idle line when 0 idle zones', () => {
    const idleLine = lines.find((line) =>
      line.startsWith('; Idle zones:')
    )
    expect(idleLine).toBeDefined()
    expect(idleLine).toContain('(none)')
  })

  it('always ends with the operator-confirm hint just before close', () => {
    const closeIdx = lines.lastIndexOf(LAGUNA_VACUUM_PREAMBLE_CLOSE)
    const hintIdx = lines.findIndex((line) =>
      line.includes('OPERATOR: confirm vacuum zones engaged')
    )
    expect(hintIdx).toBeGreaterThan(0)
    expect(hintIdx).toBeLessThan(closeIdx)
  })

  it('does NOT emit any M64 line when M-codes are off (default)', () => {
    expect(lines.some((line) => line.startsWith('M64 '))).toBe(false)
    expect(lines.some((line) => line.startsWith('M65 '))).toBe(false)
  })

  it('does NOT emit the outside-envelope warning when in-bounds', () => {
    expect(allocation.outsideEnvelope).toBe(false)
    expect(lines).not.toContain(LAGUNA_VACUUM_OUTSIDE_ENVELOPE_WARNING)
  })
})

describe('buildLagunaVacuumPreambleLines -- partial sheets', () => {
  it('half-sheet shows 4 of 6 engaged + 2 idle', () => {
    const sheet = allocateLagunaVacuumZonesForSheet('half-sheet-48x48')
    if (!sheet) throw new Error('half-sheet-48x48 must resolve')
    const lines = buildLagunaVacuumPreambleLines(sheet.allocation)
    const summary = lines.find((line) => line.includes('zones engaged'))
    expect(summary).toMatch(/4 of 6 zones engaged/)
    const idleLine = lines.find((line) =>
      line.startsWith('; Idle zones:')
    )
    expect(idleLine).toBeDefined()
    // The idle line should list 2 zones, not "(none)".
    expect(idleLine).not.toContain('(none)')
    const commaCount = (idleLine!.match(/,/g) ?? []).length
    expect(commaCount).toBe(1) // 2 idle ids -> 1 comma
  })

  it('quarter-sheet shows 2 of 6 engaged + 4 idle', () => {
    const sheet = allocateLagunaVacuumZonesForSheet('quarter-sheet-24x48')
    if (!sheet) throw new Error('quarter-sheet-24x48 must resolve')
    const lines = buildLagunaVacuumPreambleLines(sheet.allocation)
    const summary = lines.find((line) => line.includes('zones engaged'))
    expect(summary).toMatch(/2 of 6 zones engaged/)
    const idleLine = lines.find((line) =>
      line.startsWith('; Idle zones:')
    )
    expect(idleLine).toBeDefined()
    const commaCount = (idleLine!.match(/,/g) ?? []).length
    expect(commaCount).toBe(3) // 4 idle ids -> 3 commas
  })
})

describe('buildLagunaVacuumPreambleLines -- defensive coverage', () => {
  it('zero-engaged allocation still emits open/close + (none) sentinels', () => {
    // Zero-size stock outside any zone's positive-area overlap.
    const allocation = allocateLagunaVacuumZones(0, 0, 0, 0)
    expect(allocation.engagedCount).toBe(0)
    const lines = buildLagunaVacuumPreambleLines(allocation)
    expect(lines[0]).toBe(LAGUNA_VACUUM_PREAMBLE_OPEN)
    expect(lines[lines.length - 1]).toBe(LAGUNA_VACUUM_PREAMBLE_CLOSE)
    const summary = lines.find((line) => line.includes('zones engaged'))
    expect(summary).toMatch(/0 of 6 zones engaged/)
    const engagedLine = lines.find((line) =>
      line.startsWith('; Engaged zones:')
    )
    expect(engagedLine).toContain('(none)')
  })

  it('zero-engaged + M-codes-on still emits no M64 (no engaged zones to engage)', () => {
    const allocation = allocateLagunaVacuumZones(0, 0, 0, 0)
    const lines = buildLagunaVacuumPreambleLines(allocation, {
      enableMach3DigitalOutputs: true
    })
    expect(lines.some((line) => line.startsWith('M64 '))).toBe(false)
    // The M-code warning is also suppressed when there is nothing to fire.
    expect(lines).not.toContain(LAGUNA_VACUUM_MCODE_WARNING)
  })

  it('outside-envelope allocation emits the warning line', () => {
    // Place a sheet that hangs past the bed (origin near envelope corner).
    const allocation = allocateLagunaVacuumZones(1500, 0, 200, 200)
    expect(allocation.outsideEnvelope).toBe(true)
    const lines = buildLagunaVacuumPreambleLines(allocation)
    expect(lines).toContain(LAGUNA_VACUUM_OUTSIDE_ENVELOPE_WARNING)
  })

  it('NaN bed-coverage fraction collapses to 0.0% in summary', () => {
    // Construct a degenerate allocation directly to exercise the
    // formatter's NaN guard without relying on the allocator's
    // defensive collapse.
    const lines = buildLagunaVacuumPreambleLines({
      engaged: [],
      idle: ['X0Y0', 'X0Y1', 'X0Y2', 'X1Y0', 'X1Y1', 'X1Y2'],
      engagedCount: 0,
      totalOverlapMm2: 0,
      bedCoverageFraction: Number.NaN,
      fullBedEngaged: false,
      outsideEnvelope: false,
      zones: []
    })
    const summary = lines.find((line) => line.includes('zones engaged'))
    expect(summary).toMatch(/0\.0% bed coverage/)
  })

  it('determinism: two calls produce structurally equal arrays', () => {
    const sheet = allocateLagunaVacuumZonesForSheet('full-sheet-48x96')
    if (!sheet) throw new Error('full-sheet-48x96 must resolve')
    const a = buildLagunaVacuumPreambleLines(sheet.allocation)
    const b = buildLagunaVacuumPreambleLines(sheet.allocation)
    expect(a).toEqual(b)
  })

  it('every emitted line is single-line (no embedded newlines)', () => {
    const sheet = allocateLagunaVacuumZonesForSheet('full-sheet-48x96')
    if (!sheet) throw new Error('full-sheet-48x96 must resolve')
    const lines = buildLagunaVacuumPreambleLines(sheet.allocation, {
      enableMach3DigitalOutputs: true
    })
    for (const line of lines) {
      expect(line.includes('\n')).toBe(false)
      expect(line.includes('\r')).toBe(false)
    }
  })
})

describe('buildLagunaVacuumPreambleLines -- M-code emission opt-in', () => {
  const sheet = allocateLagunaVacuumZonesForSheet('full-sheet-48x96')
  if (!sheet) throw new Error('full-sheet-48x96 must resolve')

  it('emits M64 P0..P5 lines for full-sheet engagement when enabled', () => {
    const lines = buildLagunaVacuumPreambleLines(sheet.allocation, {
      enableMach3DigitalOutputs: true
    })
    const m64Lines = lines.filter((line) => line.startsWith('M64 P'))
    expect(m64Lines).toHaveLength(6)
    // P-numbers should appear in column-major order matching engaged[].
    expect(m64Lines[0]).toMatch(/^M64 P0\b/)
    expect(m64Lines[5]).toMatch(/^M64 P5\b/)
  })

  it('emits the M-code warning above the M64 lines when enabled', () => {
    const lines = buildLagunaVacuumPreambleLines(sheet.allocation, {
      enableMach3DigitalOutputs: true
    })
    const warningIdx = lines.indexOf(LAGUNA_VACUUM_MCODE_WARNING)
    const firstM64Idx = lines.findIndex((line) =>
      line.startsWith('M64 P')
    )
    expect(warningIdx).toBeGreaterThan(0)
    expect(firstM64Idx).toBeGreaterThan(warningIdx)
  })

  it('inline comment after M64 names the zone for operator readability', () => {
    const lines = buildLagunaVacuumPreambleLines(sheet.allocation, {
      enableMach3DigitalOutputs: true
    })
    const m64X0Y0 = lines.find((line) => line.startsWith('M64 P0 '))
    expect(m64X0Y0).toContain('engage X0Y0')
  })

  it('half-sheet engaged zones map to non-contiguous P-numbers', () => {
    const half = allocateLagunaVacuumZonesForSheet('half-sheet-48x48')
    if (!half) throw new Error('half-sheet-48x48 must resolve')
    const lines = buildLagunaVacuumPreambleLines(half.allocation, {
      enableMach3DigitalOutputs: true
    })
    const m64Ps = lines
      .filter((line) => line.startsWith('M64 P'))
      .map((line) => Number(line.match(/^M64 P(\d+)/)?.[1] ?? -1))
    expect(m64Ps).toHaveLength(half.allocation.engaged.length)
    expect(m64Ps).toEqual(
      half.allocation.engaged.map(
        (id) => LAGUNA_VACUUM_DIGITAL_OUTPUT_MAP[id]
      )
    )
  })
})

describe('buildLagunaVacuumPostambleLines', () => {
  it('opens with the postamble open marker + closes with the close', () => {
    const sheet = allocateLagunaVacuumZonesForSheet('full-sheet-48x96')
    if (!sheet) throw new Error('full-sheet-48x96 must resolve')
    const lines = buildLagunaVacuumPostambleLines(sheet.allocation)
    expect(lines[0]).toBe(LAGUNA_VACUUM_POSTAMBLE_OPEN)
    expect(lines[lines.length - 1]).toBe(LAGUNA_VACUUM_POSTAMBLE_CLOSE)
  })

  it('reports the correct zone-release count in the summary', () => {
    const sheet = allocateLagunaVacuumZonesForSheet('half-sheet-48x48')
    if (!sheet) throw new Error('half-sheet-48x48 must resolve')
    const lines = buildLagunaVacuumPostambleLines(sheet.allocation)
    const summary = lines.find((line) => line.includes('Releasing'))
    expect(summary).toMatch(/Releasing 4 zone/)
  })

  it('emits M65 (release) instead of M64 when enabled', () => {
    const sheet = allocateLagunaVacuumZonesForSheet('full-sheet-48x96')
    if (!sheet) throw new Error('full-sheet-48x96 must resolve')
    const lines = buildLagunaVacuumPostambleLines(sheet.allocation, {
      enableMach3DigitalOutputs: true
    })
    expect(lines.some((line) => line.startsWith('M65 P'))).toBe(true)
    expect(lines.some((line) => line.startsWith('M64 P'))).toBe(false)
  })

  it('M65 P-numbers match the engaged-zone column-major order', () => {
    const sheet = allocateLagunaVacuumZonesForSheet('full-sheet-48x96')
    if (!sheet) throw new Error('full-sheet-48x96 must resolve')
    const lines = buildLagunaVacuumPostambleLines(sheet.allocation, {
      enableMach3DigitalOutputs: true
    })
    const m65Ps = lines
      .filter((line) => line.startsWith('M65 P'))
      .map((line) => Number(line.match(/^M65 P(\d+)/)?.[1] ?? -1))
    expect(m65Ps).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('omits all M65 lines when M-codes disabled (default)', () => {
    const sheet = allocateLagunaVacuumZonesForSheet('full-sheet-48x96')
    if (!sheet) throw new Error('full-sheet-48x96 must resolve')
    const lines = buildLagunaVacuumPostambleLines(sheet.allocation)
    expect(lines.some((line) => line.startsWith('M65 '))).toBe(false)
    expect(lines).not.toContain(LAGUNA_VACUUM_MCODE_WARNING)
  })

  it('zero-engaged + M-codes-on still emits no M65 lines', () => {
    const allocation = allocateLagunaVacuumZones(0, 0, 0, 0)
    const lines = buildLagunaVacuumPostambleLines(allocation, {
      enableMach3DigitalOutputs: true
    })
    expect(lines.some((line) => line.startsWith('M65 '))).toBe(false)
  })

  it('determinism: two calls produce structurally equal arrays', () => {
    const sheet = allocateLagunaVacuumZonesForSheet('full-sheet-48x96')
    if (!sheet) throw new Error('full-sheet-48x96 must resolve')
    const a = buildLagunaVacuumPostambleLines(sheet.allocation, {
      enableMach3DigitalOutputs: true
    })
    const b = buildLagunaVacuumPostambleLines(sheet.allocation, {
      enableMach3DigitalOutputs: true
    })
    expect(a).toEqual(b)
  })
})

describe('wrapLagunaToolpathWithVacuumBlocks', () => {
  const baseToolpath = [
    'G0 X0 Y0',
    'G1 X100 Y0 F1500',
    'G1 X100 Y100',
    'G1 X0 Y100',
    'G1 X0 Y0'
  ]

  it('preserves toolpath bytes verbatim in the middle slice', () => {
    const sheet = allocateLagunaVacuumZonesForSheet('full-sheet-48x96')
    if (!sheet) throw new Error('full-sheet-48x96 must resolve')
    const wrapped = wrapLagunaToolpathWithVacuumBlocks(
      baseToolpath,
      sheet.allocation
    )
    const tpStart = wrapped.indexOf(baseToolpath[0]!)
    expect(tpStart).toBeGreaterThan(0)
    const slice = wrapped.slice(tpStart, tpStart + baseToolpath.length)
    expect(slice).toEqual(baseToolpath)
  })

  it('orders preamble before toolpath before postamble', () => {
    const sheet = allocateLagunaVacuumZonesForSheet('full-sheet-48x96')
    if (!sheet) throw new Error('full-sheet-48x96 must resolve')
    const wrapped = wrapLagunaToolpathWithVacuumBlocks(
      baseToolpath,
      sheet.allocation
    )
    const preCloseIdx = wrapped.indexOf(LAGUNA_VACUUM_PREAMBLE_CLOSE)
    const tpStart = wrapped.indexOf(baseToolpath[0]!)
    const postOpenIdx = wrapped.indexOf(LAGUNA_VACUUM_POSTAMBLE_OPEN)
    expect(preCloseIdx).toBeLessThan(tpStart)
    expect(tpStart).toBeLessThan(postOpenIdx)
  })

  it('total length = preamble + toolpath + postamble (additive only)', () => {
    const sheet = allocateLagunaVacuumZonesForSheet('full-sheet-48x96')
    if (!sheet) throw new Error('full-sheet-48x96 must resolve')
    const pre = buildLagunaVacuumPreambleLines(sheet.allocation)
    const post = buildLagunaVacuumPostambleLines(sheet.allocation)
    const wrapped = wrapLagunaToolpathWithVacuumBlocks(
      baseToolpath,
      sheet.allocation
    )
    expect(wrapped).toHaveLength(
      pre.length + baseToolpath.length + post.length
    )
  })

  it('empty toolpath still produces preamble + postamble back-to-back', () => {
    const sheet = allocateLagunaVacuumZonesForSheet('full-sheet-48x96')
    if (!sheet) throw new Error('full-sheet-48x96 must resolve')
    const wrapped = wrapLagunaToolpathWithVacuumBlocks([], sheet.allocation)
    const preCloseIdx = wrapped.indexOf(LAGUNA_VACUUM_PREAMBLE_CLOSE)
    const postOpenIdx = wrapped.indexOf(LAGUNA_VACUUM_POSTAMBLE_OPEN)
    expect(postOpenIdx).toBe(preCloseIdx + 1)
  })

  it('passes M-code option through to both halves', () => {
    const sheet = allocateLagunaVacuumZonesForSheet('full-sheet-48x96')
    if (!sheet) throw new Error('full-sheet-48x96 must resolve')
    const wrapped = wrapLagunaToolpathWithVacuumBlocks(
      baseToolpath,
      sheet.allocation,
      { enableMach3DigitalOutputs: true }
    )
    expect(wrapped.some((line) => line.startsWith('M64 P'))).toBe(true)
    expect(wrapped.some((line) => line.startsWith('M65 P'))).toBe(true)
  })

  it('M-codes off (default) keeps the wrapped output free of M64/M65', () => {
    const sheet = allocateLagunaVacuumZonesForSheet('full-sheet-48x96')
    if (!sheet) throw new Error('full-sheet-48x96 must resolve')
    const wrapped = wrapLagunaToolpathWithVacuumBlocks(
      baseToolpath,
      sheet.allocation
    )
    expect(wrapped.some((line) => line.startsWith('M64 '))).toBe(false)
    expect(wrapped.some((line) => line.startsWith('M65 '))).toBe(false)
  })

  it('readonly toolpath input is accepted (TypeScript variance check)', () => {
    const sheet = allocateLagunaVacuumZonesForSheet('full-sheet-48x96')
    if (!sheet) throw new Error('full-sheet-48x96 must resolve')
    const readonlyToolpath: readonly string[] = baseToolpath
    const wrapped = wrapLagunaToolpathWithVacuumBlocks(
      readonlyToolpath,
      sheet.allocation
    )
    expect(wrapped).toContain(baseToolpath[0])
  })
})

describe('cross-helper invariants', () => {
  it('sum of M64 + M65 lines == 2 x engagedCount when M-codes enabled', () => {
    for (const planformId of [
      'full-sheet-48x96',
      'half-sheet-48x48',
      'quarter-sheet-24x48'
    ]) {
      const sheet = allocateLagunaVacuumZonesForSheet(planformId)
      if (!sheet) throw new Error(`${planformId} must resolve`)
      const wrapped = wrapLagunaToolpathWithVacuumBlocks([], sheet.allocation, {
        enableMach3DigitalOutputs: true
      })
      const m64Count = wrapped.filter((line) =>
        line.startsWith('M64 P')
      ).length
      const m65Count = wrapped.filter((line) =>
        line.startsWith('M65 P')
      ).length
      expect(m64Count).toBe(sheet.allocation.engagedCount)
      expect(m65Count).toBe(sheet.allocation.engagedCount)
      expect(m64Count + m65Count).toBe(2 * sheet.allocation.engagedCount)
    }
  })

  it('preamble + postamble both bracket their own marker pair (1:1)', () => {
    const sheet = allocateLagunaVacuumZonesForSheet('full-sheet-48x96')
    if (!sheet) throw new Error('full-sheet-48x96 must resolve')
    const wrapped = wrapLagunaToolpathWithVacuumBlocks(
      ['G1 X1'],
      sheet.allocation
    )
    const preOpens = wrapped.filter(
      (line) => line === LAGUNA_VACUUM_PREAMBLE_OPEN
    ).length
    const preCloses = wrapped.filter(
      (line) => line === LAGUNA_VACUUM_PREAMBLE_CLOSE
    ).length
    const postOpens = wrapped.filter(
      (line) => line === LAGUNA_VACUUM_POSTAMBLE_OPEN
    ).length
    const postCloses = wrapped.filter(
      (line) => line === LAGUNA_VACUUM_POSTAMBLE_CLOSE
    ).length
    expect(preOpens).toBe(1)
    expect(preCloses).toBe(1)
    expect(postOpens).toBe(1)
    expect(postCloses).toBe(1)
  })

  it('every wrapped line is either an existing toolpath byte or a documented marker line', () => {
    const sheet = allocateLagunaVacuumZonesForSheet('full-sheet-48x96')
    if (!sheet) throw new Error('full-sheet-48x96 must resolve')
    const wrapped = wrapLagunaToolpathWithVacuumBlocks(
      ['G0 X0 Y0', 'G1 X1 Y1'],
      sheet.allocation,
      { enableMach3DigitalOutputs: true }
    )
    // Sanity: no surprises -- every line is either a comment, an M-code,
    // or a literal toolpath byte.
    for (const line of wrapped) {
      const isComment = line.startsWith('; ')
      const isMcode =
        line.startsWith('M64 P') || line.startsWith('M65 P')
      const isToolpath = line === 'G0 X0 Y0' || line === 'G1 X1 Y1'
      expect(isComment || isMcode || isToolpath).toBe(true)
    }
  })
})

describe('JSDoc paired-pin (module shape + Safety Rule 1 contract)', () => {
  const source = loadPostludeSource()

  it('module exports the full named surface', () => {
    expect(source).toContain('export const LAGUNA_VACUUM_PREAMBLE_OPEN')
    expect(source).toContain('export const LAGUNA_VACUUM_PREAMBLE_CLOSE')
    expect(source).toContain('export const LAGUNA_VACUUM_POSTAMBLE_OPEN')
    expect(source).toContain('export const LAGUNA_VACUUM_POSTAMBLE_CLOSE')
    expect(source).toContain('export const LAGUNA_VACUUM_MCODE_WARNING')
    expect(source).toContain('export const LAGUNA_VACUUM_OUTSIDE_ENVELOPE_WARNING')
    expect(source).toContain('export const LAGUNA_VACUUM_DIGITAL_OUTPUT_MAP')
    expect(source).toContain('export function lagunaVacuumZonePNumber')
    expect(source).toContain('export function buildLagunaVacuumPreambleLines')
    expect(source).toContain('export function buildLagunaVacuumPostambleLines')
    expect(source).toContain('export function wrapLagunaToolpathWithVacuumBlocks')
  })

  it('JSDoc cites Safety Rule 1 (G-code is sacred) so future drift is caught', () => {
    expect(source).toContain('Safety Rule 1')
    expect(source).toMatch(/G-code is sacred/)
  })

  it('JSDoc cites the [ID-0020-followup] tracking ID', () => {
    expect(source).toContain('[ID-0020-followup]')
  })

  it('JSDoc spells out the column-major P-number map for the operator', () => {
    expect(source).toContain('X0Y0 -> P0')
    expect(source).toContain('X1Y2 -> P5')
  })

  it('JSDoc warns against unverified wiring before opting M-codes on', () => {
    expect(source).toMatch(/multimeter|control-panel/)
  })
})
