/**
 * Tier-2 · Source pin: the picked-edge consumers route through the tiered
 * resolver, and surface the honest "pick lost" path.
 *
 * The whole point of the Tier-2 layer is that a picked fillet/chamfer/shell
 * SURVIVES an upstream parametric MOVE / UNIFORM RESIZE (resolves to the same
 * topology) instead of silently dropping to the axis bucket. That only happens
 * if the three dialogs actually call {@link resolvePickedSelectionId} (not the
 * raw {@link pickedOcctIdFor}) AND consult the host's `currentPickIndex`. A
 * behavioural unit test for each builder lives in `feature-dialog-ops.test.ts`;
 * this file is the cheap structural guard that the WIRING doesn't regress (a
 * future refactor that reverts a dialog to `pickedOcctIdFor` would silently lose
 * the move/resize recovery — exactly the kind of quiet regression a pin catches).
 *
 * It also pins the HONEST-OFF surface: each dialog must reference
 * `pickLostMessage` so a genuinely-lost pick is explained to the operator rather
 * than vanishing into a wrong-edge axis-bucket cut.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const DIALOG_DIR = join(__dirname, '..')

function read(file: string): string {
  return readFileSync(join(DIALOG_DIR, file), 'utf8')
}

const FILLET = read('FilletDialog.tsx')
const CHAMFER = read('ChamferDialog.tsx')
const SHELL = read('ShellDialog.tsx')
const TYPES = read('feature-dialog-types.ts')

describe('Tier-2 picked-edge consumers route through the resolver', () => {
  it('Fillet/Chamfer resolve EVERY accumulated EDGE pick through resolvePickedEdgeIds against currentPickIndex (wave-4 multi-edge)', () => {
    for (const src of [FILLET, CHAMFER]) {
      // The multi-edge resolver iterates the accumulated set and routes EACH
      // entry through the tiered resolvePickedId (verified in feature-dialog-types).
      expect(src).toContain('resolvePickedEdgeIds(')
      expect(src).toContain('selectionInfo.currentPickIndex')
      // The raw single-tier extractor must NOT be the path the dialog emits from.
      expect(src).not.toContain('pickedOcctIdFor(')
      // And it must emit the resolved ARRAY (not a single id) to the op builder.
      expect(src).toContain('pickedEdgeIds')
    }
  })

  it('Shell resolves the FACE pick through resolvePickedSelectionId against currentPickIndex', () => {
    expect(SHELL).toContain('resolvePickedSelectionId(')
    expect(SHELL).toContain("'face'")
    expect(SHELL).toContain('selectionInfo.currentPickIndex')
    expect(SHELL).not.toContain('pickedOcctIdFor(')
  })

  it('Fillet/Chamfer surface the HONEST pick-lost copy (dropped after an edit) via lostCount', () => {
    for (const src of [FILLET, CHAMFER]) {
      // The honest-off branch reads the multi-edge resolver's lost count.
      expect(src).toContain('pickRes.lostCount')
    }
  })

  it('Shell surfaces the HONEST pick-lost copy via pickLostMessage / pickRes.reason', () => {
    expect(SHELL).toContain('pickLostMessage(')
    expect(SHELL).toContain('pickRes.reason')
  })

  it('Fillet/Chamfer distinguish a Tier-2 recovery (pickRes.tier2Count) in their read-out', () => {
    for (const src of [FILLET, CHAMFER]) {
      expect(src).toContain('pickRes.tier2Count')
    }
  })

  it('Shell distinguishes a Tier-2 recovery (pickRes.tier === 2) in its read-out', () => {
    expect(SHELL).toContain('pickRes.tier === 2')
  })
})

describe('the resolver seam itself is honest (never guesses)', () => {
  it('resolvePickedSelectionId delegates to the tiered resolvePickedId and returns null on loss', () => {
    // The seam must build a StoredPick and route it through resolvePickedId; on a
    // resolver failure it returns { id: null, reason } (axis-bucket fallback),
    // never a fabricated id.
    expect(TYPES).toContain('resolvePickedId(stored, currentPickIndex)')
    expect(TYPES).toMatch(/if \(res\.ok\) return \{ id: res\.id, tier: res\.tier \}/)
    expect(TYPES).toContain('return { id: null, reason: res.reason }')
  })

  it('a host that supplies NO currentPickIndex keeps the Tier-1-only behaviour', () => {
    expect(TYPES).toMatch(/if \(!currentPickIndex\) return \{ id: liveId, tier: 1 \}/)
  })
})
