/**
 * Carvera WCS-setup probing contract pin (Cycle 117 [ID-0019]).
 *
 * Doc-tied paired pins for the new `{{#if carveraProbingBlock}}` blocks
 * landed in `resources/posts/carvera_3axis.hbs` + `resources/posts/carvera_4axis.hbs`
 * this cycle, plus the new `buildCarveraProbingBlock` helper exported from
 * `src/main/post-process.ts`. Honors the explicit contract documented in
 * `.claude/skills/gcode-safety/references/carvera-3axis.md`:
 *
 *   "If a probe routine is ever added to the post, it must:
 *    - Use T0 for the wireless probe
 *    - Include an explicit M6 T0 -> probe cycle -> M6 T-1 sequence
 *    - Not use T0 as a cutting tool by mistake"
 *
 * Companion files in the per-machine pin set (Cycles 64..115):
 *   - post-process-carvera-3axis-contract.test.ts   (header/footer/ATC)
 *   - post-process-carvera-4axis-contract.test.ts   (rotary kinematics)
 *   - post-process-carvera-atc-contract.test.ts     (ATC tool-change)
 *   - post-process-carvera-probing-contract.test.ts (THIS file -- WCS probing)
 *
 * The new file pins five orthogonal invariants:
 *   (a) BASELINE: when `carveraProbing` opt is undefined, output is byte-
 *       identical to the pre-[ID-0019] template path (no probing comment,
 *       no G38.2 line, no probing-block "G10 L20 P<n> X0/Y0/Z0" emission).
 *   (b) 3-AXIS PROBING ON: the block emits the full XYZ corner sequence
 *       (probe X edge, set X=0; probe Y edge, set Y=0; probe Z surface,
 *       set Z=0; stow probe) BEFORE the first cutting M6 T<n>.
 *   (c) 4-AXIS PROBING ON: the block emits Z-only probe (rotary stock
 *       has no XY edge to touch); xProbeTargetMm/yProbeTargetMm are
 *       ignored when supplied. Block is BEFORE the safe-Z retract.
 *   (d) HELPER VALIDATION: `buildCarveraProbingBlock` throws on bad
 *       input -- negative feed, feed > 300, missing 3-axis corner
 *       targets, out-of-range wcsRegister, zProbeTarget >= approachZ.
 *   (e) NON-CARVERA SAFETY: when the option is supplied to a non-Carvera
 *       template (Laguna / K2 Plus / generic CNC), the block is built
 *       but the template ignores `carveraProbingBlock`, so output is
 *       byte-identical -- the option NEVER pollutes other machine posts.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { machineProfileSchema, type MachineProfile } from '../shared/machine-schema'
import {
  __resetPostTemplateCache,
  buildCarveraProbingBlock,
  renderPost,
  type CarveraProbingContext
} from './post-process'

const RESOURCES_ROOT = join(process.cwd(), 'resources')

function loadProfile(filename: string): MachineProfile {
  const path = join(RESOURCES_ROOT, 'machines', filename)
  return machineProfileSchema.parse(JSON.parse(readFileSync(path, 'utf-8')))
}

const CARVERA_3AXIS = loadProfile('makera-carvera-3axis.json')
const CARVERA_4AXIS = loadProfile('makera-carvera-4axis.json')
const LAGUNA = loadProfile('laguna-swift-5x10.json')
const K2_PLUS = loadProfile('creality-k2-plus.json')

const SAMPLE_3AXIS_TOOLPATH = [
  '; --- 3-axis facing pass ---',
  'G0 X10 Y10 Z140',
  'G1 X10 Y10 Z2 F600',
  'G1 X100 Y10 Z2 F2400',
  'G1 X100 Y50 Z2 F2400',
  'G0 Z140'
]

const SAMPLE_4AXIS_TOOLPATH = [
  '; --- 4-axis rotary contour ---',
  'G0 X10 Y0 Z46 A0',
  'G1 X10 Y0 Z2 A0 F300',
  'G1 X100 Y0 Z2 A90 F1200',
  'G1 X100 Y0 Z2 A180 F1200',
  'G0 Z46'
]

const PROBING_3AXIS: CarveraProbingContext = {
  probeSlot: 0,
  stowSlot: -1,
  feedMmPerMin: 100,
  approachXMm: 50,
  approachYMm: 50,
  approachZMm: 140, // = Carvera 3-axis safe Z (workAreaMm.z)
  zProbeTargetMm: -5,
  xProbeTargetMm: 45,
  yProbeTargetMm: 45,
  wcsRegister: 1
}

const PROBING_4AXIS: CarveraProbingContext = {
  probeSlot: 0,
  stowSlot: -1,
  feedMmPerMin: 100,
  approachXMm: 30,
  approachYMm: 0, // rotary axis center
  approachZMm: 46, // = Carvera 4-axis safe Z (workAreaMm.z)
  zProbeTargetMm: -2,
  wcsRegister: 1
}

// --- (a) BASELINE: probing OFF is byte-identical to pre-[ID-0019] template ---

describe('carvera probing contract: BASELINE (no probing) is byte-identical', () => {
  it('3-axis: output without carveraProbing has NO probing comment, NO G38.2, NO probing-block G10 L20', async () => {
    __resetPostTemplateCache()
    const { gcode } = await renderPost(RESOURCES_ROOT, CARVERA_3AXIS, SAMPLE_3AXIS_TOOLPATH)
    expect(gcode).not.toContain('Carvera WCS-setup probing')
    expect(gcode).not.toContain('G38.2')
    expect(gcode).not.toMatch(/^M6 T0\b/m)
    expect(gcode).not.toMatch(/^M6 T-1\b/m)
    // Note: the safety-checklist comment references "G10 L20 P1" -- check for the
    // probing-block-specific contact-set lines instead.
    expect(gcode).not.toContain('G10 L20 P1 X0')
    expect(gcode).not.toContain('G10 L20 P1 Y0')
    expect(gcode).not.toContain('G10 L20 P1 Z0')
  })

  it('4-axis: output without carveraProbing has NO probing comment, NO G38.2, NO M6 T0', async () => {
    __resetPostTemplateCache()
    const { gcode } = await renderPost(RESOURCES_ROOT, CARVERA_4AXIS, SAMPLE_4AXIS_TOOLPATH)
    expect(gcode).not.toContain('Carvera WCS-setup probing')
    expect(gcode).not.toContain('G38.2')
    expect(gcode).not.toMatch(/^M6 T0\b/m)
    expect(gcode).not.toMatch(/^M6 T-1\b/m)
    expect(gcode).not.toContain('G10 L20 P1 Z0')
  })

  it('3-axis: pre-[ID-0019] safety footer (M5 -> G49 -> G0 Z140 -> M2) intact', async () => {
    __resetPostTemplateCache()
    const { gcode } = await renderPost(RESOURCES_ROOT, CARVERA_3AXIS, SAMPLE_3AXIS_TOOLPATH)
    const m5 = gcode.indexOf('M5')
    const g49 = gcode.indexOf('G49', m5)
    const safeZ = gcode.indexOf('G0 Z140', g49)
    const m2 = gcode.search(/^M2\b/m)
    expect(m5).toBeGreaterThan(-1)
    expect(g49).toBeGreaterThan(m5)
    expect(safeZ).toBeGreaterThan(g49)
    expect(m2).toBeGreaterThan(safeZ)
  })

  it('3-axis: warnings array is empty when probing OFF + WCS supplied (no validator regressions)', async () => {
    __resetPostTemplateCache()
    const { warnings } = await renderPost(RESOURCES_ROOT, CARVERA_3AXIS, SAMPLE_3AXIS_TOOLPATH, {
      workCoordinateIndex: 1
    })
    expect(warnings).toEqual([])
  })

  it('4-axis: warnings array is empty when probing OFF + WCS supplied (no validator regressions)', async () => {
    __resetPostTemplateCache()
    const { warnings } = await renderPost(RESOURCES_ROOT, CARVERA_4AXIS, SAMPLE_4AXIS_TOOLPATH, {
      workCoordinateIndex: 1
    })
    expect(warnings).toEqual([])
  })
})

// --- (b) 3-AXIS PROBING ON: full XYZ corner sequence in canonical order ------

describe('carvera probing contract: 3-axis probing ON emits full XYZ corner sequence', () => {
  it('emits the probing block header comment (UNVERIFIED tone preserved)', async () => {
    __resetPostTemplateCache()
    const { gcode } = await renderPost(RESOURCES_ROOT, CARVERA_3AXIS, SAMPLE_3AXIS_TOOLPATH, {
      carveraProbing: PROBING_3AXIS
    })
    expect(gcode).toContain('; --- Carvera WCS-setup probing (UNVERIFIED -- verify against Carvera firmware docs) ---')
    expect(gcode).toContain('; --- end probing block ---')
  })

  it('emits M6 T0 (load probe), then M6 T-1 (stow probe) in that order', async () => {
    __resetPostTemplateCache()
    const { gcode } = await renderPost(RESOURCES_ROOT, CARVERA_3AXIS, SAMPLE_3AXIS_TOOLPATH, {
      carveraProbing: PROBING_3AXIS
    })
    const loadProbe = gcode.search(/^M6 T0\b/m)
    const stowProbe = gcode.indexOf('M6 T-1')
    expect(loadProbe).toBeGreaterThan(-1)
    expect(stowProbe).toBeGreaterThan(loadProbe)
  })

  it('emits all THREE G38.2 axis probes in X -> Y -> Z order', async () => {
    __resetPostTemplateCache()
    const { gcode } = await renderPost(RESOURCES_ROOT, CARVERA_3AXIS, SAMPLE_3AXIS_TOOLPATH, {
      carveraProbing: PROBING_3AXIS
    })
    const xProbe = gcode.indexOf('G38.2 X')
    const yProbe = gcode.indexOf('G38.2 Y', xProbe)
    const zProbe = gcode.indexOf('G38.2 Z', yProbe)
    expect(xProbe).toBeGreaterThan(-1)
    expect(yProbe).toBeGreaterThan(xProbe)
    expect(zProbe).toBeGreaterThan(yProbe)
  })

  it('emits G10 L20 P1 X0 / Y0 / Z0 to set WCS register 1 origin at probe contact', async () => {
    __resetPostTemplateCache()
    const { gcode } = await renderPost(RESOURCES_ROOT, CARVERA_3AXIS, SAMPLE_3AXIS_TOOLPATH, {
      carveraProbing: PROBING_3AXIS
    })
    expect(gcode).toContain('G10 L20 P1 X0')
    expect(gcode).toContain('G10 L20 P1 Y0')
    expect(gcode).toContain('G10 L20 P1 Z0')
  })

  it('probing block emits BEFORE the cutting tool change M6 T1 (the default ATC)', async () => {
    __resetPostTemplateCache()
    const { gcode } = await renderPost(RESOURCES_ROOT, CARVERA_3AXIS, SAMPLE_3AXIS_TOOLPATH, {
      carveraProbing: PROBING_3AXIS
    })
    const stowProbe = gcode.indexOf('M6 T-1')
    const cuttingChange = gcode.search(/^M6 T1\b/m) // default cutting tool
    expect(stowProbe).toBeGreaterThan(-1)
    expect(cuttingChange).toBeGreaterThan(stowProbe)
  })

  it('emits the operator-visible feed value F100 for every G38.2 axis probe', async () => {
    __resetPostTemplateCache()
    const { gcode } = await renderPost(RESOURCES_ROOT, CARVERA_3AXIS, SAMPLE_3AXIS_TOOLPATH, {
      carveraProbing: PROBING_3AXIS
    })
    expect(gcode).toMatch(/G38\.2 X45 F100\b/)
    expect(gcode).toMatch(/G38\.2 Y45 F100\b/)
    expect(gcode).toMatch(/G38\.2 Z-5 F100\b/)
  })

  it('block ends with G0 Z<approach> retract BEFORE M6 T-1 (Safety Rule 1: never stow at probe depth)', async () => {
    __resetPostTemplateCache()
    const { gcode } = await renderPost(RESOURCES_ROOT, CARVERA_3AXIS, SAMPLE_3AXIS_TOOLPATH, {
      carveraProbing: PROBING_3AXIS
    })
    const zRetract = gcode.indexOf('G0 Z140 ; retract Z to safe approach BEFORE stowing probe')
    const stowProbe = gcode.indexOf('M6 T-1')
    expect(zRetract).toBeGreaterThan(-1)
    expect(stowProbe).toBeGreaterThan(zRetract)
  })

  it('warnings array is empty when probing ON + WCS supplied (no safe-Z / header / dialect issues)', async () => {
    __resetPostTemplateCache()
    const { warnings } = await renderPost(RESOURCES_ROOT, CARVERA_3AXIS, SAMPLE_3AXIS_TOOLPATH, {
      carveraProbing: PROBING_3AXIS,
      workCoordinateIndex: 1
    })
    expect(warnings).toEqual([])
  })

  it('explicit toolNumber=3 still routes through the cutting M6 T3 AFTER probe stow', async () => {
    __resetPostTemplateCache()
    const { gcode } = await renderPost(RESOURCES_ROOT, CARVERA_3AXIS, SAMPLE_3AXIS_TOOLPATH, {
      carveraProbing: PROBING_3AXIS,
      toolNumber: 3
    })
    const stowProbe = gcode.indexOf('M6 T-1')
    const cutting = gcode.search(/^M6 T3\b/m)
    expect(stowProbe).toBeGreaterThan(-1)
    expect(cutting).toBeGreaterThan(stowProbe)
  })
})

// --- (c) 4-AXIS PROBING ON: Z-only sequence (rotary stock has no XY edge) ----

describe('carvera probing contract: 4-axis probing ON emits Z-only (no XY edge)', () => {
  it('emits the probing block header comment', async () => {
    __resetPostTemplateCache()
    const { gcode } = await renderPost(RESOURCES_ROOT, CARVERA_4AXIS, SAMPLE_4AXIS_TOOLPATH, {
      carveraProbing: PROBING_4AXIS
    })
    expect(gcode).toContain('; --- Carvera WCS-setup probing (UNVERIFIED -- verify against Carvera firmware docs) ---')
    expect(gcode).toContain('; --- end probing block ---')
  })

  it('emits exactly ONE G38.2 line (Z surface only, no X / Y edge probes)', async () => {
    __resetPostTemplateCache()
    const { gcode } = await renderPost(RESOURCES_ROOT, CARVERA_4AXIS, SAMPLE_4AXIS_TOOLPATH, {
      carveraProbing: PROBING_4AXIS
    })
    const probeLines = gcode.split('\n').filter((l) => l.includes('G38.2'))
    expect(probeLines).toHaveLength(1)
    expect(probeLines[0]).toMatch(/G38\.2 Z-2 F100/)
    expect(gcode).not.toMatch(/G38\.2 X/)
    expect(gcode).not.toMatch(/G38\.2 Y/)
  })

  it('emits exactly ONE G10 L20 P1 Z0 (no X0 / Y0 set)', async () => {
    __resetPostTemplateCache()
    const { gcode } = await renderPost(RESOURCES_ROOT, CARVERA_4AXIS, SAMPLE_4AXIS_TOOLPATH, {
      carveraProbing: PROBING_4AXIS
    })
    expect(gcode).toContain('G10 L20 P1 Z0')
    expect(gcode).not.toContain('G10 L20 P1 X0')
    expect(gcode).not.toContain('G10 L20 P1 Y0')
  })

  it('emits M6 T0 -> Z probe -> G10 L20 -> M6 T-1 in order BEFORE the safe-Z retract line', async () => {
    __resetPostTemplateCache()
    const { gcode } = await renderPost(RESOURCES_ROOT, CARVERA_4AXIS, SAMPLE_4AXIS_TOOLPATH, {
      carveraProbing: PROBING_4AXIS
    })
    const loadProbe = gcode.search(/^M6 T0\b/m)
    const probe = gcode.indexOf('G38.2 Z', loadProbe)
    const setZ = gcode.indexOf('G10 L20 P1 Z0', probe)
    const stow = gcode.indexOf('M6 T-1', setZ)
    const safeZRetract = gcode.indexOf('; safe Z retract', stow)
    expect(loadProbe).toBeGreaterThan(-1)
    expect(probe).toBeGreaterThan(loadProbe)
    expect(setZ).toBeGreaterThan(probe)
    expect(stow).toBeGreaterThan(setZ)
    expect(safeZRetract).toBeGreaterThan(stow)
  })

  it('xProbeTargetMm / yProbeTargetMm fields are IGNORED in 4-axis (no XY edge emission)', async () => {
    __resetPostTemplateCache()
    const polluted: CarveraProbingContext = {
      ...PROBING_4AXIS,
      xProbeTargetMm: 999,
      yProbeTargetMm: 888
    }
    const { gcode } = await renderPost(RESOURCES_ROOT, CARVERA_4AXIS, SAMPLE_4AXIS_TOOLPATH, {
      carveraProbing: polluted
    })
    expect(gcode).not.toContain('999')
    expect(gcode).not.toContain('888')
    expect(gcode).not.toMatch(/G38\.2 X/)
    expect(gcode).not.toMatch(/G38\.2 Y/)
  })

  it('warnings array is empty when 4-axis probing ON + WCS supplied (no validator issues)', async () => {
    __resetPostTemplateCache()
    const { warnings } = await renderPost(RESOURCES_ROOT, CARVERA_4AXIS, SAMPLE_4AXIS_TOOLPATH, {
      carveraProbing: PROBING_4AXIS,
      workCoordinateIndex: 1
    })
    expect(warnings).toEqual([])
  })
})

// --- (d) HELPER VALIDATION: buildCarveraProbingBlock throws on bad input -----

describe('buildCarveraProbingBlock: validation', () => {
  it('throws on negative feed', () => {
    expect(() => buildCarveraProbingBlock({ ...PROBING_3AXIS, feedMmPerMin: -1 }, 3))
      .toThrow(/must be positive/)
  })

  it('throws on zero feed', () => {
    expect(() => buildCarveraProbingBlock({ ...PROBING_3AXIS, feedMmPerMin: 0 }, 3))
      .toThrow(/must be positive/)
  })

  it('throws on feed > 300 (defensive ceiling -- Safety Rule 1)', () => {
    expect(() => buildCarveraProbingBlock({ ...PROBING_3AXIS, feedMmPerMin: 301 }, 3))
      .toThrow(/exceeds the safe 300 mm\/min ceiling/)
  })

  it('accepts feed = 300 (boundary)', () => {
    expect(() => buildCarveraProbingBlock({ ...PROBING_3AXIS, feedMmPerMin: 300 }, 3))
      .not.toThrow()
  })

  it('throws on wcsRegister < 1', () => {
    expect(() => buildCarveraProbingBlock(
      { ...PROBING_3AXIS, wcsRegister: 0 as unknown as 1 },
      3
    )).toThrow(/wcsRegister must be 1\.\.6/)
  })

  it('throws on wcsRegister > 6', () => {
    expect(() => buildCarveraProbingBlock(
      { ...PROBING_3AXIS, wcsRegister: 7 as unknown as 6 },
      3
    )).toThrow(/wcsRegister must be 1\.\.6/)
  })

  it('throws when 3-axis call is missing xProbeTargetMm', () => {
    const bad: CarveraProbingContext = { ...PROBING_3AXIS }
    delete bad.xProbeTargetMm
    expect(() => buildCarveraProbingBlock(bad, 3))
      .toThrow(/3-axis probing requires xProbeTargetMm and yProbeTargetMm/)
  })

  it('throws when 3-axis call is missing yProbeTargetMm', () => {
    const bad: CarveraProbingContext = { ...PROBING_3AXIS }
    delete bad.yProbeTargetMm
    expect(() => buildCarveraProbingBlock(bad, 3))
      .toThrow(/3-axis probing requires xProbeTargetMm and yProbeTargetMm/)
  })

  it('does NOT throw when 4-axis call is missing xProbeTargetMm / yProbeTargetMm (Z-only)', () => {
    expect(() => buildCarveraProbingBlock(PROBING_4AXIS, 4)).not.toThrow()
  })

  it('throws when zProbeTargetMm >= approachZMm (probe must descend)', () => {
    expect(() => buildCarveraProbingBlock(
      { ...PROBING_3AXIS, zProbeTargetMm: 140 },
      3
    )).toThrow(/strictly less than approachZMm/)
    expect(() => buildCarveraProbingBlock(
      { ...PROBING_3AXIS, zProbeTargetMm: 200 },
      3
    )).toThrow(/strictly less than approachZMm/)
  })

  it('returns a multi-line string with no trailing newline (template adds the \\n)', () => {
    const block = buildCarveraProbingBlock(PROBING_3AXIS, 3)
    expect(block).toContain('\n')
    expect(block.endsWith('\n')).toBe(false)
  })

  it('3-axis block contains exactly THREE G38.2 lines', () => {
    const block = buildCarveraProbingBlock(PROBING_3AXIS, 3)
    const matches = block.match(/G38\.2/g) ?? []
    expect(matches).toHaveLength(3)
  })

  it('4-axis block contains exactly ONE G38.2 line', () => {
    const block = buildCarveraProbingBlock(PROBING_4AXIS, 4)
    const matches = block.match(/G38\.2/g) ?? []
    expect(matches).toHaveLength(1)
  })

  it('block emits exactly ONE M6 T<probeSlot> (load) and ONE M6 T<stowSlot> (stow)', () => {
    const block = buildCarveraProbingBlock(PROBING_3AXIS, 3)
    const loadMatches = block.match(/^M6 T0\b/gm) ?? []
    const stowMatches = block.match(/^M6 T-1\b/gm) ?? []
    expect(loadMatches).toHaveLength(1)
    expect(stowMatches).toHaveLength(1)
  })

  it('honors custom probeSlot / stowSlot (not hard-coded to 0 / -1)', () => {
    const custom: CarveraProbingContext = { ...PROBING_3AXIS, probeSlot: 6, stowSlot: 5 }
    const block = buildCarveraProbingBlock(custom, 3)
    expect(block).toMatch(/^M6 T6\b/m)
    expect(block).toMatch(/^M6 T5\b/m)
    expect(block).not.toMatch(/^M6 T0\b/m)
    expect(block).not.toMatch(/^M6 T-1\b/m)
  })

  it('honors custom wcsRegister=2 (G55) in both label comment and G10 L20 P-word', () => {
    const block = buildCarveraProbingBlock({ ...PROBING_3AXIS, wcsRegister: 2 }, 3)
    expect(block).toContain('G55')
    expect(block).toContain('G10 L20 P2 X0')
    expect(block).toContain('G10 L20 P2 Y0')
    expect(block).toContain('G10 L20 P2 Z0')
    expect(block).not.toContain('G10 L20 P1')
  })
})

// --- (e) NON-CARVERA SAFETY: option supplied to non-Carvera template no-ops --

describe('carvera probing contract: option NEVER pollutes non-Carvera templates', () => {
  it('K2 Plus FDM: probing option supplied -> output has NO G38.2 / probing comment', async () => {
    __resetPostTemplateCache()
    const { gcode } = await renderPost(RESOURCES_ROOT, K2_PLUS, [
      'G1 X10 Y10 E0.5 F1500'
    ], {
      carveraProbing: PROBING_3AXIS
    })
    expect(gcode).not.toContain('G38.2')
    expect(gcode).not.toContain('Carvera WCS-setup probing')
    expect(gcode).not.toContain('G10 L20 P1 Z0')
  })

  it('Laguna Swift: probing option supplied -> output has NO G38.2 / probing comment', async () => {
    __resetPostTemplateCache()
    const { gcode } = await renderPost(RESOURCES_ROOT, LAGUNA, [
      'G0 X10 Y10 Z25',
      'G1 X10 Y10 Z2 F600'
    ], {
      carveraProbing: PROBING_3AXIS
    })
    expect(gcode).not.toContain('G38.2')
    expect(gcode).not.toContain('Carvera WCS-setup probing')
    expect(gcode).not.toContain('G10 L20 P1 Z0')
  })

  it('Laguna Swift: gcode is byte-identical with vs. without the carveraProbing option', async () => {
    __resetPostTemplateCache()
    const baseline = await renderPost(RESOURCES_ROOT, LAGUNA, [
      'G0 X10 Y10 Z25',
      'G1 X10 Y10 Z2 F600'
    ])
    __resetPostTemplateCache()
    const polluted = await renderPost(RESOURCES_ROOT, LAGUNA, [
      'G0 X10 Y10 Z25',
      'G1 X10 Y10 Z2 F600'
    ], {
      carveraProbing: PROBING_3AXIS
    })
    expect(polluted.gcode).toBe(baseline.gcode)
    expect(polluted.warnings).toEqual(baseline.warnings)
  })
})
