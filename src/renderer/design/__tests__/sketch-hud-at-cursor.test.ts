/**
 * SOURCE-LEVEL pins for the at-cursor read-out (the floating HUD that tracks the pointer).
 *
 * Why textual pins: positioning the HUD reads layout (`getBoundingClientRect`) and reacts to input
 * focus — neither of which node-env vitest can exercise (no DOM box model, no focus). The pure entry
 * math is covered behaviourally in `Sketch2DCanvas.hud.test.ts` (`resolvePolarEntryPoint` /
 * `resolveHudTargetPoint`); the LAST inch of wiring is pinned here, the same convention as
 * `sketch-cursor-world-threading-pin.test.ts`.
 *
 * The two non-obvious robustness contracts these pins protect:
 *   1. The HUD floats at the cursor but FREEZES the moment a field is focused — otherwise the
 *      Tab-to-type inputs would run away from the pointer reaching for them.
 *   2. Pointer-leave does NOT blank the read-out while a field is being edited — moving the cursor
 *      onto a HUD input fires the canvas's mouseleave, and tearing the HUD down would drop the edit.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const CANVAS = readFileSync(resolve(__dirname, '../Sketch2DCanvas.tsx'), 'utf-8')

describe('Sketch2DCanvas — at-cursor read-out (floating HUD source pins)', () => {
  it('floats the HUD at the cursor: mouse-move records canvas-local px, the div consumes it', () => {
    expect(CANVAS).toContain('setHudScreen({ x: hx, y: hy')
    expect(CANVAS).toContain('left: hudScreen.x')
    expect(CANVAS).toContain('top: hudScreen.y')
    // right/bottom are overridden so the floating left/top win over the docked CSS corner.
    expect(CANVAS).toContain("right: 'auto'")
    expect(CANVAS).toContain("bottom: 'auto'")
  })

  it('flips off the right/bottom edge by its own size so it stays on-canvas', () => {
    expect(CANVAS).toContain('hudScreen.flipX')
    expect(CANVAS).toContain('hudScreen.flipY')
    expect(CANVAS).toContain('calc(-100% - 14px)')
  })

  it('FREEZES the float while a field is focused (the input must not run from the pointer)', () => {
    // The mouse-move position update is gated on the same hudFocused latch that freezes the values.
    expect(CANVAS).toMatch(/if \(!hudFocused\.current\) \{[\s\S]{0,200}?setHudScreen\(\{ x: hx/)
  })

  it('pointer-leave does NOT blank the read-out mid-edit (guarded by !hudFocused)', () => {
    expect(CANVAS).toMatch(
      /if \(!hudFocused\.current\) \{\s*\n\s*setHudCursor\(null\)\s*\n\s*setInferenceKind\(null\)\s*\n\s*setHudScreen\(null\)/
    )
  })
})
