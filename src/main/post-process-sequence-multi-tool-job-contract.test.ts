/**
 * sequenceMultiToolJob helper-level contract paired-pin set -- Cycle 77 [ID-0165]
 *
 * Following the doc-tied paired-pin shape established by:
 *   - Cycle 64 [ID-0007b-followup] K2 Moonraker upload contract
 *   - Cycle 65 [ID-0156] Carvera 4-axis post contract
 *   - Cycle 67 [ID-0155] Carvera 3-axis post contract
 *   - Cycle 70 [ID-0154] Laguna Swift 5x10 post contract
 *   - Cycle 76 [ID-0164] cam-axis4 Emitter shared-emitter contract
 *
 * Each invariant section asserts BOTH the documented intent (the JSDoc
 * block immediately above `sequenceMultiToolJob` in
 * `src/main/post-process.ts`) AND the runtime behavior (against direct
 * helper invocation), so doc-vs-code drift fails one of the pair.
 *
 * Scope: `sequenceMultiToolJob` is the multi-operation merger that the
 * Makera Carvera 3-axis ATC pipeline ([ID-0151]) and the
 * `[ID-0013-followup]` G43-H<n> tool-length-comp follow-up wrap. The
 * existing `post-process.test.ts` describe blocks pin INDIVIDUAL behaviors
 * (M5 ordering, label inclusion, supportsToolChange flag, the G43 H<n>
 * follow-up). This file pins the helper-level CONTRACT shape that all of
 * those callers rely on:
 *   - the JSDoc 5-step numbered tool-change sequence
 *   - the byte-identity emission of input gcode (no rewriting / no dedup)
 *   - the exact comment delimiters (`--- TOOL CHANGE: T<n>` /
 *     `--- NEXT OPERATION` / `(same tool T<n>)`)
 *   - the blank-line bracket lines around tool-change blocks
 *   - the em-dash separator between tool slot and label
 *   - default-value gates for every option in `opts`
 *   - safeZMm raw-interpolation contract (no decimal padding)
 *
 * If a future refactor (e.g. switching the comment glyph or removing the
 * blank-line brackets to "save bytes") drifts away from any of these
 * invariants, this file is the single point that fails BEFORE the
 * carvera_3axis.hbs preamble or the [ID-0151] integration suite cascades.
 *
 * Machine scope per CLAUDE.md "My-Shop-Only Mode": the multi-tool job
 * sequencer is exclusively consumed by Makera Carvera 3-axis ATC jobs
 * (the Carvera 3-axis is the only target machine with `supportsToolChange:
 * true`; K2 Plus has no tool changer, Laguna Swift uses manual changes
 * via the RichAuto pendant and runs through the supportsToolChange:false
 * path which IS pinned here). All three machines exercise this module
 * indirectly through the multi-op posting pipeline.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { sequenceMultiToolJob, type ToolOperationBlock } from './post-process'

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/** Reads post-process.ts source text once for the doc-text paired pins. */
const POST_PROCESS_SOURCE = readFileSync(
  resolve(__dirname, 'post-process.ts'),
  'utf-8'
)

/**
 * Extracts only the JSDoc block immediately above `export function
 * sequenceMultiToolJob(`. This isolates doc-pin assertions to the helper's
 * own contract -- a regex match against `POST_PROCESS_SOURCE` would also
 * match unrelated text elsewhere in the file (e.g. the [ID-0013-followup]
 * commentary block inside the function body).
 */
function extractSequenceMultiToolJobJsDoc(): string {
  const exportLine = POST_PROCESS_SOURCE.indexOf(
    'export function sequenceMultiToolJob('
  )
  if (exportLine < 0) {
    throw new Error(
      'sequenceMultiToolJob export not found in post-process.ts -- ' +
        'the contract pin file is anchored to the JSDoc above this export.'
    )
  }
  // Walk backward to the start of the JSDoc that immediately precedes the export.
  const docEnd = POST_PROCESS_SOURCE.lastIndexOf('*/', exportLine)
  const docStart = POST_PROCESS_SOURCE.lastIndexOf('/**', docEnd)
  if (docStart < 0 || docEnd < 0) {
    throw new Error(
      'JSDoc block above sequenceMultiToolJob not found -- contract pin ' +
        'expects a /** ... */ block immediately preceding the export.'
    )
  }
  return POST_PROCESS_SOURCE.slice(docStart, docEnd + 2)
}

const SEQUENCE_JSDOC = extractSequenceMultiToolJobJsDoc()

/**
 * Two-block fixture used wherever the test does not care about the gcode
 * payload. ASCII-only so byte-identity assertions are not muddled by
 * encoding edge cases.
 */
const TWO_BLOCKS_DIFFERENT_TOOLS: ToolOperationBlock[] = [
  { toolSlot: 1, gcode: 'G0 X0 Y0\nG1 X10 F800\nM5' },
  { toolSlot: 2, gcode: 'G0 X20 Y20\nG1 X30 F600\nM5' }
]

// ===========================================================================
// Section 1 -- JSDoc structure pins (doc-side only; runtime pinned in S3-S6)
// ===========================================================================

describe('sequenceMultiToolJob -- JSDoc structure invariants [ID-0165]', () => {
  it('JSDoc summary line states the merge-with-M6-on-tool-slot-change contract', () => {
    // DOC PIN: the helper's purpose is fixed in the JSDoc summary line so
    // a future refactor that flips the M6-insertion semantics has to update
    // the doc here first.
    expect(SEQUENCE_JSDOC).toContain(
      'Merge multiple posted G-code operations into a single program'
    )
    expect(SEQUENCE_JSDOC).toContain(
      'M6 tool change commands inserted between operations when the tool slot changes'
    )
  })

  it('JSDoc enumerates the 5-step tool change sequence in order', () => {
    // DOC PIN: the 5-step list (M5 -> Z retract -> T<n> M6 -> G43 H<n> ->
    // comment) is the public contract every caller relies on. Re-ordering
    // here without re-ordering the runtime emission would crash machines
    // (Safety Rule 1).
    const step1 = SEQUENCE_JSDOC.indexOf('1. Spindle stop (M5)')
    const step2 = SEQUENCE_JSDOC.indexOf('2. Safe Z retract')
    const step3 = SEQUENCE_JSDOC.indexOf('3. Tool change (T<n> M6)')
    const step4 = SEQUENCE_JSDOC.indexOf('4. Tool length compensation re-apply (G43 H<n>)')
    const step5 = SEQUENCE_JSDOC.indexOf('5. A comment indicating the new operation')
    expect(step1).toBeGreaterThan(-1)
    expect(step2).toBeGreaterThan(step1)
    expect(step3).toBeGreaterThan(step2)
    expect(step4).toBeGreaterThan(step3)
    expect(step5).toBeGreaterThan(step4)
  })

  it('JSDoc pins the supportsToolChange === false suppression of M6', () => {
    // DOC PIN: the manual-change path (Laguna Swift / any non-ATC machine)
    // MUST NOT emit M6. The doc states the suppression explicitly.
    expect(SEQUENCE_JSDOC).toMatch(
      /Tool change \(T<n> M6\) -- omitted when supportsToolChange === false/
    )
  })

  it('JSDoc pins the emitToolLengthComp default-false byte-identical safety', () => {
    // DOC PIN: the [ID-0013-followup] flag default is false explicitly so
    // pre-existing callers stay byte-identical (Safety Rule 2). Flipping
    // the default would silently change every Carvera ATC job's output.
    expect(SEQUENCE_JSDOC).toContain('[ID-0013-followup]')
    expect(SEQUENCE_JSDOC).toContain(
      'Default false so'
    )
    expect(SEQUENCE_JSDOC).toMatch(/byte-identical/)
  })

  it('JSDoc pins the same-tool no-G43 reasoning', () => {
    // DOC PIN: when consecutive blocks share a tool, the doc explicitly
    // says G43 H<n> is also omitted because no length offset has changed.
    // This justifies the runtime branch and prevents accidental no-op G43
    // re-emissions on same-tool transitions.
    expect(SEQUENCE_JSDOC).toMatch(
      /When consecutive operations use the same tool slot, no tool change is\s*\*\s*inserted/
    )
    expect(SEQUENCE_JSDOC).toMatch(/G43 H<n> is\s*\*\s*also omitted/)
  })

  it('JSDoc declares all four parameters with their defaults', () => {
    // DOC PIN: every parameter must be documented with its default so
    // callers know which knobs are safe to omit.
    expect(SEQUENCE_JSDOC).toMatch(/@param blocks/)
    expect(SEQUENCE_JSDOC).toMatch(/@param safeZMm/)
    expect(SEQUENCE_JSDOC).toMatch(/@param commentPrefix.*default "; "/)
    expect(SEQUENCE_JSDOC).toMatch(/supportsToolChange.*default true/)
    expect(SEQUENCE_JSDOC).toMatch(/emitToolLengthComp.*default false/)
  })
})

// ===========================================================================
// Section 2 -- Block-emission byte-identity contract
// ===========================================================================

describe('sequenceMultiToolJob -- block emission contract [ID-0165]', () => {
  it('returns empty string (not undefined / null) for empty blocks array', () => {
    // RUNTIME PIN: the empty-array fast-path returns the literal empty
    // string. Callers tend to chain `.split('\n')` on the result; null or
    // undefined would explode here.
    const result = sequenceMultiToolJob([], 100)
    expect(result).toBe('')
    expect(typeof result).toBe('string')
  })

  it('returns single block.gcode unchanged (no decoration, no trailing newline)', () => {
    // RUNTIME PIN: the single-block fast-path is a literal pass-through.
    // Wrapping it in any decorator (header/footer/blank line) would break
    // tests downstream that assert byte-identity for single-op jobs.
    const gcode = 'G0 X0\nG1 X10 F800\nM30'
    const result = sequenceMultiToolJob([{ toolSlot: 1, gcode }], 100)
    expect(result).toBe(gcode)
    // Byte-identity check: no extra trailing newline, no whitespace prefix.
    expect(result.length).toBe(gcode.length)
  })

  it('emits each input block.gcode verbatim across tool changes (no rewriting)', () => {
    // RUNTIME PIN: each block.gcode is emitted as-is. The helper does NOT
    // re-order, dedupe, or normalize the gcode -- that is renderPost()'s
    // responsibility upstream. This pin guards against a future "smart"
    // refactor that tries to rewrite header/footer collisions.
    const blocks: ToolOperationBlock[] = [
      { toolSlot: 1, gcode: '; OP1 START\nG0 X1\nG1 X2 F500\n; OP1 END' },
      { toolSlot: 2, gcode: '; OP2 START\nG0 X3\nG1 X4 F600\n; OP2 END' }
    ]
    const result = sequenceMultiToolJob(blocks, 75)
    expect(result).toContain('; OP1 START\nG0 X1\nG1 X2 F500\n; OP1 END')
    expect(result).toContain('; OP2 START\nG0 X3\nG1 X4 F600\n; OP2 END')
  })

  it('preserves input block order across N>=3 alternating tool slots', () => {
    // RUNTIME PIN: alternating tool slots must NOT cause re-ordering. A
    // future "merge same-tool ops together" optimization would silently
    // change cut order and is out of scope for this helper.
    const result = sequenceMultiToolJob(
      [
        { toolSlot: 1, gcode: ';OP-A' },
        { toolSlot: 2, gcode: ';OP-B' },
        { toolSlot: 1, gcode: ';OP-C' }
      ],
      100
    )
    const ai = result.indexOf(';OP-A')
    const bi = result.indexOf(';OP-B')
    const ci = result.indexOf(';OP-C')
    expect(ai).toBeGreaterThan(-1)
    expect(bi).toBeGreaterThan(ai)
    expect(ci).toBeGreaterThan(bi)
  })
})

// ===========================================================================
// Section 3 -- Tool-change sequence ordering (M5 -> Z -> M6 -> [G43] -> gcode)
// ===========================================================================

describe('sequenceMultiToolJob -- tool change sequence ordering [ID-0165]', () => {
  it('emits the documented 5-step sequence in order between blocks', () => {
    // RUNTIME PIN: matches the JSDoc Section 1 "5-step tool change
    // sequence" exactly. Without G43 (default false) the order is:
    // [tool-change comment] -> M5 -> G0 Z<safe> -> T<n> M6 -> [next gcode].
    const result = sequenceMultiToolJob(
      [
        { toolSlot: 1, gcode: ';BLOCK1' },
        { toolSlot: 4, gcode: ';BLOCK2' }
      ],
      80
    )
    const cmtIdx = result.indexOf('--- TOOL CHANGE: T4')
    const m5Idx = result.indexOf('M5', cmtIdx)
    const zIdx = result.indexOf('G0 Z80', m5Idx)
    const t6Idx = result.indexOf('T4 M6', zIdx)
    const nextOpIdx = result.indexOf(';BLOCK2', t6Idx)
    expect(cmtIdx).toBeGreaterThan(-1)
    expect(m5Idx).toBeGreaterThan(cmtIdx)
    expect(zIdx).toBeGreaterThan(m5Idx)
    expect(t6Idx).toBeGreaterThan(zIdx)
    expect(nextOpIdx).toBeGreaterThan(t6Idx)
  })

  it('brackets the tool change block with blank lines on both sides', () => {
    // RUNTIME PIN: the helper push('') before AND after the tool-change
    // block to keep the merged G-code visually scannable. A future bytes-
    // saving refactor that drops these would make the multi-op output
    // unreadable on the Carvera handheld.
    const result = sequenceMultiToolJob(
      [
        { toolSlot: 1, gcode: ';BLOCK1' },
        { toolSlot: 2, gcode: ';BLOCK2' }
      ],
      50
    )
    const lines = result.split('\n')
    const cmtLine = lines.findIndex((l) => l.includes('--- TOOL CHANGE'))
    expect(cmtLine).toBeGreaterThan(-1)
    // Line BEFORE the comment must be empty (the leading blank-line bracket).
    expect(lines[cmtLine - 1]).toBe('')
    // Find T<n> M6 line, then there must be a trailing blank line before the next gcode.
    const t6Line = lines.findIndex((l) => l === 'T2 M6')
    expect(t6Line).toBeGreaterThan(cmtLine)
    expect(lines[t6Line + 1]).toBe('')
  })

  it('tool-change comment uses the exact "--- TOOL CHANGE: T<n>" format', () => {
    // RUNTIME PIN: the comment glyph triple-dash is fixed; some controllers
    // (RichAuto A-series) treat lines starting with `(` as comments and
    // others use `;`. The triple-dash visual delimiter is dialect-agnostic.
    const result = sequenceMultiToolJob(TWO_BLOCKS_DIFFERENT_TOOLS, 50)
    expect(result).toMatch(/--- TOOL CHANGE: T2 ---/)
  })

  it('uses U+2014 em-dash separator when label is provided', () => {
    // RUNTIME PIN: the separator is the unicode em-dash (U+2014), not a
    // hyphen-minus. Mixing them would break visual alignment in the
    // Carvera dump file. Captured here as a literal codepoint.
    const result = sequenceMultiToolJob(
      [
        { toolSlot: 1, gcode: ';OP1' },
        { toolSlot: 2, gcode: ';OP2', label: 'Finishing Pass' }
      ],
      50
    )
    expect(result).toContain('--- TOOL CHANGE: T2 \u2014 Finishing Pass ---')
    // And the codepoint is exactly em-dash, not hyphen.
    expect(result).not.toContain('--- TOOL CHANGE: T2 - Finishing Pass ---')
  })

  it('respects custom commentPrefix on the tool-change comment line', () => {
    // RUNTIME PIN: custom prefix is interpolated verbatim. Used by the
    // Mach3-style "(comment)" dialect family (no longer in scope per the
    // 3-machine rule but the helper supports it for the unit-test surface).
    const result = sequenceMultiToolJob(
      [
        { toolSlot: 1, gcode: ';OP1' },
        { toolSlot: 2, gcode: ';OP2' }
      ],
      50,
      '( '
    )
    expect(result).toContain('( --- TOOL CHANGE: T2 ---')
    // Default `; ` prefix should NOT appear on the tool-change comment line.
    expect(result).not.toMatch(/^; --- TOOL CHANGE/m)
  })
})

// ===========================================================================
// Section 4 -- Same-tool-transition contract
// ===========================================================================

describe('sequenceMultiToolJob -- same-tool transition contract [ID-0165]', () => {
  it('omits M5 / G0 Z / T<n> M6 entirely when consecutive blocks share a tool', () => {
    // RUNTIME PIN: same-tool transitions skip the entire 5-step sequence
    // because the spindle Z reference is already correct. A future "always
    // re-stage between ops for safety" refactor would burn cycle time and
    // make multi-op jobs measurably slower.
    const result = sequenceMultiToolJob(
      [
        { toolSlot: 3, gcode: ';OP1' },
        { toolSlot: 3, gcode: ';OP2' }
      ],
      50
    )
    expect(result).not.toContain('M5')
    expect(result).not.toContain('G0 Z50')
    expect(result).not.toContain('T3 M6')
    expect(result).not.toContain('--- TOOL CHANGE')
  })

  it('emits "--- NEXT OPERATION" comment with "(same tool T<n>)" suffix', () => {
    // RUNTIME PIN: the same-tool separator comment uses a different
    // visual marker ("NEXT OPERATION") than the tool-change one ("TOOL
    // CHANGE") so an operator scanning the dump can tell at a glance.
    const result = sequenceMultiToolJob(
      [
        { toolSlot: 5, gcode: ';OP1' },
        { toolSlot: 5, gcode: ';OP2' }
      ],
      50
    )
    expect(result).toMatch(/--- NEXT OPERATION \(same tool T5\) ---/)
  })

  it('inlines the label after the colon when label is provided', () => {
    // RUNTIME PIN: same-tool labels appear as `--- NEXT OPERATION:
    // <label> (same tool T<n>) ---`. Different from the tool-change
    // shape (which uses em-dash separator).
    const result = sequenceMultiToolJob(
      [
        { toolSlot: 2, gcode: ';OP1' },
        { toolSlot: 2, gcode: ';OP2', label: 'Cleanup Pass' }
      ],
      50
    )
    expect(result).toMatch(
      /--- NEXT OPERATION: Cleanup Pass \(same tool T2\) ---/
    )
  })

  it('respects custom commentPrefix on the same-tool transition line', () => {
    // RUNTIME PIN: custom prefix interpolates verbatim on the NEXT
    // OPERATION comment too -- not just the TOOL CHANGE comment.
    const result = sequenceMultiToolJob(
      [
        { toolSlot: 7, gcode: ';OP1' },
        { toolSlot: 7, gcode: ';OP2' }
      ],
      50,
      '( '
    )
    expect(result).toContain('( --- NEXT OPERATION (same tool T7) ---')
  })
})

// ===========================================================================
// Section 5 -- supportsToolChange flag (manual-change vs ATC dialect routing)
// ===========================================================================

describe('sequenceMultiToolJob -- supportsToolChange flag [ID-0165]', () => {
  it('default (undefined) is treated as true -- emits T<n> M6', () => {
    // RUNTIME PIN: the `opts?.supportsToolChange !== false` check makes
    // undefined -> true. A future flip to `opts?.supportsToolChange ===
    // true` would silently break every existing call site that omits
    // opts (Safety Rule 2 byte-identity).
    const explicitDefault = sequenceMultiToolJob(
      TWO_BLOCKS_DIFFERENT_TOOLS,
      50
    )
    const undefinedOpts = sequenceMultiToolJob(
      TWO_BLOCKS_DIFFERENT_TOOLS,
      50,
      '; ',
      undefined
    )
    const explicitTrue = sequenceMultiToolJob(
      TWO_BLOCKS_DIFFERENT_TOOLS,
      50,
      '; ',
      { supportsToolChange: true }
    )
    expect(explicitDefault).toBe(undefinedOpts)
    expect(explicitDefault).toBe(explicitTrue)
    expect(explicitDefault).toContain('T2 M6')
  })

  it('explicit false suppresses both T<n> M6 AND any G43 H<n> follow-up', () => {
    // RUNTIME PIN: when supportsToolChange is false, the entire ATC sub-
    // block (M6 and the optional G43) collapses. A regression that left
    // G43 dangling without the M6 above it would be an interpreter error
    // on the Carvera and a no-op on the Laguna RichAuto.
    const result = sequenceMultiToolJob(
      TWO_BLOCKS_DIFFERENT_TOOLS,
      50,
      '; ',
      { supportsToolChange: false, emitToolLengthComp: true }
    )
    expect(result).not.toContain('T2 M6')
    expect(result).not.toContain('M6')
    expect(result).not.toContain('G43')
  })

  it('false emits the manual-change instruction with exact "load T<n> before continuing" copy', () => {
    // RUNTIME PIN: the operator-instruction text is the literal contract
    // for any non-ATC machine. The Laguna Swift 5x10 RichAuto pendant
    // displays this comment to the operator -- changing the wording would
    // confuse the shop floor.
    const result = sequenceMultiToolJob(
      TWO_BLOCKS_DIFFERENT_TOOLS,
      50,
      '; ',
      { supportsToolChange: false }
    )
    expect(result).toContain(
      '; Manual tool change required: load T2 before continuing'
    )
  })

  it('still emits M5 + G0 Z<retract> even when supportsToolChange is false', () => {
    // RUNTIME PIN: the spindle stop and Z retract MUST happen regardless
    // of ATC support -- the operator needs the spindle off and the head
    // up before they can change the tool. Suppressing these would create
    // a Safety Rule 1 collision risk during a manual change.
    const result = sequenceMultiToolJob(
      TWO_BLOCKS_DIFFERENT_TOOLS,
      125,
      '; ',
      { supportsToolChange: false }
    )
    expect(result).toContain('M5')
    expect(result).toContain('G0 Z125')
    // And in the right order: M5 before G0 Z, both before the manual-change comment.
    const m5Idx = result.indexOf('M5')
    const zIdx = result.indexOf('G0 Z125')
    const manualIdx = result.indexOf('Manual tool change required')
    expect(m5Idx).toBeGreaterThan(-1)
    expect(zIdx).toBeGreaterThan(m5Idx)
    expect(manualIdx).toBeGreaterThan(zIdx)
  })
})

// ===========================================================================
// Section 6 -- emitToolLengthComp flag [ID-0013-followup]
// ===========================================================================

describe('sequenceMultiToolJob -- emitToolLengthComp flag [ID-0013-followup]', () => {
  it('default (undefined) is false -- byte-identical to pre-flag callers', () => {
    // RUNTIME PIN: the strict `=== true` check makes any other value
    // (undefined, null cast, falsy) emit no G43. This is the Safety Rule
    // 2 byte-identity guarantee: pre-cycle-60 callers see no change.
    const noOpts = sequenceMultiToolJob(TWO_BLOCKS_DIFFERENT_TOOLS, 50)
    const undefinedFlag = sequenceMultiToolJob(
      TWO_BLOCKS_DIFFERENT_TOOLS,
      50,
      '; ',
      { supportsToolChange: true }
    )
    const explicitFalse = sequenceMultiToolJob(
      TWO_BLOCKS_DIFFERENT_TOOLS,
      50,
      '; ',
      { supportsToolChange: true, emitToolLengthComp: false }
    )
    expect(noOpts).toBe(undefinedFlag)
    expect(noOpts).toBe(explicitFalse)
    expect(noOpts).not.toContain('G43')
  })

  it('explicit true emits "G43 H<block.toolSlot>" immediately after T<n> M6', () => {
    // RUNTIME PIN: the G43 line appears DIRECTLY after T<n> M6 with no
    // intervening lines. The Carvera Smoothieware controller treats
    // intervening moves between M6 and G43 as using the OLD length
    // offset -- a Safety Rule 1 hazard.
    const result = sequenceMultiToolJob(
      [
        { toolSlot: 1, gcode: ';OP1' },
        { toolSlot: 4, gcode: ';OP2' }
      ],
      50,
      '; ',
      { supportsToolChange: true, emitToolLengthComp: true }
    )
    const lines = result.split('\n')
    const m6Line = lines.findIndex((l) => l === 'T4 M6')
    expect(m6Line).toBeGreaterThan(-1)
    // The very next line must be the G43 H<slot> companion.
    expect(lines[m6Line + 1]).toBe('G43 H4')
  })

  it('emits G43 with the NEW block toolSlot, not the previous toolSlot', () => {
    // RUNTIME PIN: the slot in G43 H<n> tracks the slot just loaded, not
    // the slot just removed. Mixing these would apply the OLD length
    // offset to the NEW tool -- another Safety Rule 1 hazard.
    const result = sequenceMultiToolJob(
      [
        { toolSlot: 2, gcode: ';OP1' },
        { toolSlot: 6, gcode: ';OP2' }
      ],
      50,
      '; ',
      { supportsToolChange: true, emitToolLengthComp: true }
    )
    expect(result).toContain('T6 M6')
    expect(result).toContain('G43 H6')
    expect(result).not.toContain('G43 H2')
  })

  it('does NOT emit G43 H<n> on same-tool transitions even when flag is true', () => {
    // RUNTIME PIN: same-tool transitions don't change the length offset,
    // so a redundant G43 H<n> would be wasted bytes (and on some Smoothie-
    // ware variants triggers a reset of modal feed state). The flag only
    // gates the post-M6 emission.
    const result = sequenceMultiToolJob(
      [
        { toolSlot: 3, gcode: ';OP1' },
        { toolSlot: 3, gcode: ';OP2' }
      ],
      50,
      '; ',
      { supportsToolChange: true, emitToolLengthComp: true }
    )
    expect(result).not.toContain('G43')
    expect(result).not.toContain('M6')
  })

  it('flag is gated by supportsToolChange -- both must be true to emit G43', () => {
    // RUNTIME PIN: the truth table is (supportsToolChange && emitToolLengthComp).
    // Setting the flag without ATC support yields the manual-change comment
    // and NO G43 -- because there's no M6 either, and a dangling G43 H<n>
    // on a manual-change machine is a controller error.
    const noAtcButFlag = sequenceMultiToolJob(
      TWO_BLOCKS_DIFFERENT_TOOLS,
      50,
      '; ',
      { supportsToolChange: false, emitToolLengthComp: true }
    )
    const atcAndFlag = sequenceMultiToolJob(
      TWO_BLOCKS_DIFFERENT_TOOLS,
      50,
      '; ',
      { supportsToolChange: true, emitToolLengthComp: true }
    )
    expect(noAtcButFlag).not.toContain('G43')
    expect(noAtcButFlag).toContain('Manual tool change required')
    expect(atcAndFlag).toContain('G43')
    expect(atcAndFlag).toContain('T2 M6')
  })
})

// ===========================================================================
// Section 7 -- safeZMm interpolation contract
// ===========================================================================

describe('sequenceMultiToolJob -- safeZMm interpolation contract [ID-0165]', () => {
  it('interpolates safeZMm raw with no decimal padding for integers', () => {
    // RUNTIME PIN: the helper uses template literal `G0 Z${safeZMm}`, which
    // for the integer 50 yields "G0 Z50" (NOT "G0 Z50.000"). Some posts
    // pad to fixed decimals via renderPost(); this helper deliberately
    // does not, so the upstream post-processor can normalize once.
    const result = sequenceMultiToolJob(TWO_BLOCKS_DIFFERENT_TOOLS, 50)
    expect(result).toContain('G0 Z50')
    expect(result).not.toContain('G0 Z50.000')
    expect(result).not.toContain('G0 Z50.0')
  })

  it('preserves float safeZMm exactly via JS Number.toString', () => {
    // RUNTIME PIN: a 50.5 safeZMm yields "G0 Z50.5" verbatim. Callers
    // that need trailing-zero formatting must do it upstream.
    const result = sequenceMultiToolJob(TWO_BLOCKS_DIFFERENT_TOOLS, 50.5)
    expect(result).toContain('G0 Z50.5')
  })

  it('handles a zero safeZMm without crashing -- emits literal "G0 Z0"', () => {
    // RUNTIME PIN: a degenerate safeZMm = 0 should still emit valid G-code
    // (the upstream caller is responsible for rejecting zero-Z safety
    // levels per Safety Rule 1). The helper itself is a string emitter
    // and must not throw on numeric edge cases.
    const result = sequenceMultiToolJob(TWO_BLOCKS_DIFFERENT_TOOLS, 0)
    expect(result).toContain('G0 Z0')
  })
})
