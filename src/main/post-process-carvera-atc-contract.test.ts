/**
 * Carvera ATC contract paired-pin -- Cycle 112 [ID-0013-spec].
 *
 * Locks the FIVE invariants the [ID-0013-spec] roadmap entry promises for the
 * Makera Carvera ATC (automatic tool changer) macro. The contract is the
 * stitching point between TWO independently-pinned layers:
 *
 *   - Template path: `resources/posts/carvera_3axis.hbs` rendered via
 *     `renderPost('./resources', carvera3, ...)` -- pinned in
 *     `src/main/post-process-carvera-3axis-contract.test.ts` (Cycle 67
 *     [ID-0155]) for header-step ordering.
 *   - Helper path:  `sequenceMultiToolJob(blocks, safeZ, prefix, opts)`
 *     -- pinned in `src/main/post-process-sequence-multi-tool-job-contract.test.ts`
 *     (Cycle 77 [ID-0165]) for the 5-step mid-job tool change emission.
 *
 * What this file adds: the Carvera-3-axis-SPECIFIC integration story, where
 * the bundled `makera-carvera-3axis.json` profile drives both the template
 * and the helper through `deriveAtcCapability(profile)`. Each it() block
 * names which (a)-(e) acceptance criterion it pins, so a future regression
 * in either layer fails an it() block whose name maps cleanly onto the
 * roadmap entry.
 *
 * Acceptance criteria (verbatim from `.claude/roadmap.md` line 95):
 *   (a) `T<n> M6` emits in tool-change order
 *   (b) `G43 H<n>` follows on the next line iff `emitToolLengthComp === true`
 *   (c) spindle is M5 before M6
 *   (d) G0 to safe Z precedes M6
 *   (e) M6 omitted when `supportsToolChange === false`
 *
 * Companion contract files in the per-machine pin set (do NOT duplicate
 * what they cover; do pin the cross-layer wiring story they leave open):
 *   - Cycle 65 [ID-0156]: post-process-carvera-4axis-contract.test.ts
 *     -- pins that the 4-axis Carvera template MUST NOT emit M6 (rotary
 *     occupies the ATC bay). Complement, not overlap.
 *   - Cycle 67 [ID-0155]: post-process-carvera-3axis-contract.test.ts
 *     -- pins the FIRST-tool template path. This file pins the MID-JOB
 *     sequencer path AND the deriveAtcCapability-driven supported/unsupported
 *     branching across the bundled fleet.
 *   - Cycle 77 [ID-0165]: post-process-sequence-multi-tool-job-contract.test.ts
 *     -- pins the helper in isolation (no profile JSON). This file plumbs
 *     the helper through real Carvera profile data.
 *   - Cycle 57 [ID-0151]: `post-process.test.ts` lines 936-1108 --
 *     fleet-wide table for the gate boolean. This file pins the per-criterion
 *     story instead of the fleet table.
 *
 * Pure read-side: no mutation of `resources/`, no fixture writes.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  machineProfileSchema,
  type MachineProfile
} from '../shared/machine-schema'
import {
  deriveAtcCapability,
  machineSupportsAtc
} from '../shared/post-process-atc-capability'
import {
  renderPost,
  sequenceMultiToolJob,
  type ToolOperationBlock
} from './post-process'

// ─── Fixture loading ────────────────────────────────────────────────────────

const RESOURCES_ROOT = join(process.cwd(), 'resources')

function loadProfile(filename: string): MachineProfile {
  return machineProfileSchema.parse(
    JSON.parse(
      readFileSync(join(RESOURCES_ROOT, 'machines', filename), 'utf-8')
    )
  )
}

const SAMPLE_3AXIS_TOOLPATH = [
  '; --- 3-axis facing pass ---',
  'G0 X10.000 Y10.000 Z140.000',
  'G1 X10.000 Y10.000 Z2.000 F600',
  'G1 X100.000 Y10.000 Z2.000 F2400',
  'G0 Z140.000'
]

/**
 * Build a multi-operation tool-change job representative of a real Carvera
 * ATC workflow: a roughing pass with T1, a finishing pass with T2, and a
 * spring pass with T1 again. Same-tool gaps must NOT trigger an extra M6
 * (criterion (a) ordering -- ALSO defends against a "always emit M6" bug).
 */
function buildAlternatingTrio(): ToolOperationBlock[] {
  return [
    { toolSlot: 1, gcode: 'G1 X10 F800', label: 'Roughing' },
    { toolSlot: 2, gcode: 'G1 X20 F600', label: 'Finishing' },
    { toolSlot: 1, gcode: 'G1 X30 F600', label: 'Spring pass' }
  ]
}

function buildTwoToolJob(): ToolOperationBlock[] {
  return [
    { toolSlot: 1, gcode: 'G1 X10 F800', label: 'Roughing' },
    { toolSlot: 2, gcode: 'G1 X20 F600', label: 'Finishing' }
  ]
}

const CARVERA_SAFE_Z_MM = 140

// ─── Acceptance criterion (a): T<n> M6 emits in tool-change order ─────────────

describe('Carvera ATC contract [ID-0013-spec] (a) -- T<n> M6 ordering', () => {
  it('template path: M6 T<n> precedes the toolpath body for default toolNumber=1', async () => {
    const carvera3 = loadProfile('makera-carvera-3axis.json')
    const { gcode } = await renderPost(RESOURCES_ROOT, carvera3, SAMPLE_3AXIS_TOOLPATH)
    const m6Idx = gcode.search(/^M6 T1\b/m)
    const toolpathIdx = gcode.indexOf('; --- Toolpath ---')
    expect(m6Idx).toBeGreaterThan(-1)
    expect(toolpathIdx).toBeGreaterThan(m6Idx)
  })

  it('template path: explicit toolNumber=4 routes through M6 T4 (no M6 T1 leak)', async () => {
    const carvera3 = loadProfile('makera-carvera-3axis.json')
    const { gcode } = await renderPost(RESOURCES_ROOT, carvera3, SAMPLE_3AXIS_TOOLPATH, {
      toolNumber: 4
    })
    expect(gcode).toMatch(/^M6 T4\b/m)
    expect(gcode).not.toMatch(/^M6 T1\b/m)
  })

  it('sequencer path: alternating-tool trio emits M6 lines in T2 → T1 order (one per transition)', () => {
    const carvera3 = loadProfile('makera-carvera-3axis.json')
    const result = sequenceMultiToolJob(buildAlternatingTrio(), CARVERA_SAFE_Z_MM, '; ', {
      supportsToolChange: machineSupportsAtc(carvera3)
    })
    const m6Lines = result.split('\n').filter((l) => /^T\d+ M6$/.test(l))
    // Two transitions (T1→T2, T2→T1) → two M6 lines.
    expect(m6Lines).toEqual(['T2 M6', 'T1 M6'])
  })

  it('sequencer path: same-tool gap in trio emits exactly two M6 (not three)', () => {
    const carvera3 = loadProfile('makera-carvera-3axis.json')
    const result = sequenceMultiToolJob(buildAlternatingTrio(), CARVERA_SAFE_Z_MM, '; ', {
      supportsToolChange: machineSupportsAtc(carvera3)
    })
    const m6Count = (result.match(/T\d+ M6/g) ?? []).length
    expect(m6Count).toBe(2)
  })
})

// ─── Acceptance criterion (b): G43 H<n> follows iff emitToolLengthComp ────────

describe('Carvera ATC contract [ID-0013-spec] (b) -- G43 H<n> emitToolLengthComp gate', () => {
  it('template path: G43 H<n> ALWAYS follows M6 T<n> on the very next line (no flag needed)', async () => {
    // The template-path G43 emission is unconditional -- the carvera_3axis.hbs
    // header always pairs M6 with G43 H so the FIRST tool change has the
    // correct length offset. The flag (emitToolLengthComp) is the *helper*
    // gate for MID-JOB transitions; the template gate is implicit-true.
    const carvera3 = loadProfile('makera-carvera-3axis.json')
    const { gcode } = await renderPost(RESOURCES_ROOT, carvera3, SAMPLE_3AXIS_TOOLPATH, {
      toolNumber: 5
    })
    const lines = gcode.split('\n')
    const m6LineIdx = lines.findIndex((l) => /^M6 T5\b/.test(l))
    expect(m6LineIdx).toBeGreaterThan(-1)
    const nextLine = lines[m6LineIdx + 1] ?? ''
    expect(nextLine).toMatch(/^G43 H5\b/)
  })

  it('sequencer path: emitToolLengthComp=true emits G43 H<n> on the line directly after T<n> M6', () => {
    const result = sequenceMultiToolJob(buildTwoToolJob(), CARVERA_SAFE_Z_MM, '; ', {
      supportsToolChange: true,
      emitToolLengthComp: true
    })
    const lines = result.split('\n')
    const m6Idx = lines.findIndex((l) => l === 'T2 M6')
    expect(m6Idx).toBeGreaterThan(-1)
    expect(lines[m6Idx + 1]).toBe('G43 H2')
  })

  it('sequencer path: emitToolLengthComp=false emits ZERO G43 lines between operations', () => {
    const result = sequenceMultiToolJob(buildTwoToolJob(), CARVERA_SAFE_Z_MM, '; ', {
      supportsToolChange: true,
      emitToolLengthComp: false
    })
    expect(result).toContain('T2 M6')
    expect(result).not.toMatch(/^G43 /m)
  })

  it('sequencer path: emitToolLengthComp default (undefined) is treated as false (byte-identical to pre-flag)', () => {
    const explicitFalse = sequenceMultiToolJob(buildTwoToolJob(), CARVERA_SAFE_Z_MM, '; ', {
      supportsToolChange: true,
      emitToolLengthComp: false
    })
    const undefinedFlag = sequenceMultiToolJob(buildTwoToolJob(), CARVERA_SAFE_Z_MM, '; ', {
      supportsToolChange: true
    })
    expect(undefinedFlag).toBe(explicitFalse)
  })

  it('wiring: deriveAtcCapability(carvera3).supported drives emitToolLengthComp wiring contract end-to-end', () => {
    // Real-world Carvera 3-axis multi-tool callers should set
    // emitToolLengthComp = deriveAtcCapability(profile).supported so that
    // the G43 follow-up is emitted iff ATC is supported. Pin this wiring
    // contract here so a future regression that flips it (e.g. forgetting
    // to plumb the flag) fails this it() block.
    const carvera3 = loadProfile('makera-carvera-3axis.json')
    const cap = deriveAtcCapability(carvera3)
    expect(cap.supported).toBe(true)
    const result = sequenceMultiToolJob(buildTwoToolJob(), CARVERA_SAFE_Z_MM, '; ', {
      supportsToolChange: cap.supported,
      emitToolLengthComp: cap.supported
    })
    const lines = result.split('\n')
    const m6Idx = lines.findIndex((l) => l === 'T2 M6')
    expect(lines[m6Idx + 1]).toBe('G43 H2')
  })
})

// ─── Acceptance criterion (c): spindle is M5 before M6 ───────────────────────

describe('Carvera ATC contract [ID-0013-spec] (c) -- M5 precedes M6 in mid-job tool change', () => {
  it('sequencer path: M5 line appears strictly before each T<n> M6 line', () => {
    const carvera3 = loadProfile('makera-carvera-3axis.json')
    const result = sequenceMultiToolJob(buildTwoToolJob(), CARVERA_SAFE_Z_MM, '; ', {
      supportsToolChange: machineSupportsAtc(carvera3)
    })
    const m5Idx = result.indexOf('\nM5\n')
    const m6Idx = result.indexOf('\nT2 M6')
    expect(m5Idx).toBeGreaterThan(-1)
    expect(m6Idx).toBeGreaterThan(m5Idx)
  })

  it('sequencer path: alternating trio emits M5 before EACH of the two M6 lines (one M5 per transition)', () => {
    const carvera3 = loadProfile('makera-carvera-3axis.json')
    const result = sequenceMultiToolJob(buildAlternatingTrio(), CARVERA_SAFE_Z_MM, '; ', {
      supportsToolChange: machineSupportsAtc(carvera3)
    })
    // Each tool transition contributes exactly one M5 + one T<n> M6.
    // The trio has two transitions, so exactly two of each.
    const m5Count = (result.match(/^M5$/gm) ?? []).length
    const m6Count = (result.match(/^T\d+ M6$/gm) ?? []).length
    expect(m5Count).toBe(2)
    expect(m6Count).toBe(2)
  })
})

// ─── Acceptance criterion (d): G0 to safe Z precedes M6 ──────────────────────

describe('Carvera ATC contract [ID-0013-spec] (d) -- G0 Z<safe> precedes M6 in mid-job tool change', () => {
  it('sequencer path: G0 Z<safeZMm> line appears between M5 and the M6 line', () => {
    const carvera3 = loadProfile('makera-carvera-3axis.json')
    const result = sequenceMultiToolJob(buildTwoToolJob(), CARVERA_SAFE_Z_MM, '; ', {
      supportsToolChange: machineSupportsAtc(carvera3)
    })
    const lines = result.split('\n')
    const m5Idx = lines.findIndex((l) => l === 'M5')
    const safeZIdx = lines.findIndex((l) => l === `G0 Z${CARVERA_SAFE_Z_MM}`)
    const m6Idx = lines.findIndex((l) => l === 'T2 M6')
    expect(m5Idx).toBeGreaterThan(-1)
    expect(safeZIdx).toBe(m5Idx + 1)
    expect(m6Idx).toBe(safeZIdx + 1)
  })

  it('sequencer path: explicit safeZMm value is interpolated raw (no decimal padding for integers)', () => {
    // Pin that the safe-Z value passed in is what shows up in the G0 Z
    // line, byte-for-byte. Defends against a future refactor that adds
    // .toFixed(3) padding and changes the snapshot shape.
    const result = sequenceMultiToolJob(buildTwoToolJob(), 50, '; ', {
      supportsToolChange: true
    })
    expect(result).toContain('G0 Z50')
    expect(result).not.toContain('G0 Z50.000')
  })

  it('sequencer path: non-integer safeZMm (140.5) preserves the float exactly via Number.toString', () => {
    const result = sequenceMultiToolJob(buildTwoToolJob(), 140.5, '; ', {
      supportsToolChange: true
    })
    expect(result).toContain('G0 Z140.5')
  })
})

// ─── Acceptance criterion (e): M6 omitted when supportsToolChange === false ──

describe('Carvera ATC contract [ID-0013-spec] (e) -- M6 suppression on supportsToolChange=false', () => {
  it('sequencer path: explicit supportsToolChange=false emits ZERO M6 lines and a manual-change comment instead', () => {
    const result = sequenceMultiToolJob(buildTwoToolJob(), CARVERA_SAFE_Z_MM, '; ', {
      supportsToolChange: false
    })
    expect(result).not.toContain('M6')
    expect(result).toContain('Manual tool change required: load T2 before continuing')
  })

  it('wiring: K2 Plus FDM profile → deriveAtcCapability.supported=false → no M6 emitted by sequencer', () => {
    const k2 = loadProfile('creality-k2-plus.json')
    const cap = deriveAtcCapability(k2)
    expect(cap.supported).toBe(false)
    if (!cap.supported) expect(cap.reason).toBe('fdm')
    const result = sequenceMultiToolJob(buildTwoToolJob(), 50, '; ', {
      supportsToolChange: cap.supported
    })
    expect(result).not.toContain('M6')
  })

  it('wiring: Carvera 4-axis (rotary occupies bay, no atcSlotCount) → deriveAtcCapability.supported=false → no M6 emitted', () => {
    const carvera4 = loadProfile('makera-carvera-4axis.json')
    const cap = deriveAtcCapability(carvera4)
    expect(cap.supported).toBe(false)
    if (!cap.supported) expect(cap.reason).toBe('no-atc-slots')
    const result = sequenceMultiToolJob(buildTwoToolJob(), 46, '; ', {
      supportsToolChange: cap.supported
    })
    expect(result).not.toContain('M6')
    expect(result).toContain('Manual tool change required')
  })

  it('wiring: Laguna Swift 5x10 (manual ER-20, no atcSlotCount) → no M6 emitted', () => {
    const laguna = loadProfile('laguna-swift-5x10.json')
    const cap = deriveAtcCapability(laguna)
    expect(cap.supported).toBe(false)
    if (!cap.supported) expect(cap.reason).toBe('no-atc-slots')
    const result = sequenceMultiToolJob(buildTwoToolJob(), 25, '; ', {
      supportsToolChange: cap.supported
    })
    expect(result).not.toContain('M6')
  })

  it('sequencer path: M5 + G0 Z<safe> are STILL emitted when supportsToolChange=false (only M6 is gated)', () => {
    // Defends against an over-broad refactor that suppresses the entire
    // mid-job sequence when ATC is missing. The spindle-stop + safe-Z
    // retract are SAFETY moves -- they must always run before a manual
    // tool swap, otherwise the operator reaches into a spinning spindle
    // or hits the workpiece while changing the tool.
    const result = sequenceMultiToolJob(buildTwoToolJob(), CARVERA_SAFE_Z_MM, '; ', {
      supportsToolChange: false
    })
    expect(result).toMatch(/^M5$/m)
    expect(result).toContain(`G0 Z${CARVERA_SAFE_Z_MM}`)
    expect(result).not.toContain('M6')
  })
})

// ─── End-to-end: criterion-bundling sanity check on the Carvera 3-axis ──────

describe('Carvera ATC contract [ID-0013-spec] -- end-to-end Carvera 3-axis bundle', () => {
  it('all five criteria hold simultaneously in one Carvera 3-axis multi-tool sequencer call', () => {
    const carvera3 = loadProfile('makera-carvera-3axis.json')
    const cap = deriveAtcCapability(carvera3)
    expect(cap.supported).toBe(true)
    const result = sequenceMultiToolJob(buildTwoToolJob(), CARVERA_SAFE_Z_MM, '; ', {
      supportsToolChange: cap.supported,
      emitToolLengthComp: cap.supported
    })
    const lines = result.split('\n')
    const m5Idx = lines.findIndex((l) => l === 'M5')
    const safeZIdx = lines.findIndex((l) => l === `G0 Z${CARVERA_SAFE_Z_MM}`)
    const m6Idx = lines.findIndex((l) => l === 'T2 M6')
    const g43Idx = lines.findIndex((l) => l === 'G43 H2')
    // (a) ordering: M6 appears (single transition).
    expect(m6Idx).toBeGreaterThan(-1)
    // (b) G43 H<n> on the line after M6 since emitToolLengthComp=true.
    expect(g43Idx).toBe(m6Idx + 1)
    // (c) M5 strictly before M6.
    expect(m5Idx).toBeGreaterThan(-1)
    expect(m5Idx).toBeLessThan(m6Idx)
    // (d) G0 Z<safe> strictly between M5 and M6.
    expect(safeZIdx).toBe(m5Idx + 1)
    expect(safeZIdx).toBeLessThan(m6Idx)
    // (e) M6 IS emitted because supportsToolChange=true (cap.supported).
    expect(result).toContain('T2 M6')
    expect(result).not.toContain('Manual tool change required')
  })
})
