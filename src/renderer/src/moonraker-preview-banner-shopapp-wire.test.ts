/**
 * Cycle 95 ui-polish [ID-0072] -- INTEGRATION pin: the
 * `MoonrakerPreviewBanner` Cycle 50 [ID-0072-followup] wire-up in
 * `src/renderer/src/ShopApp.tsx` MUST stay structurally intact.
 *
 * Why this matters
 * ----------------
 * `MoonrakerPreviewBanner.test.tsx` (Cycle 50) covers the component in
 * isolation: render contract, `null`-on-empty, kind ordering, max-target
 * collapse, snapshot. What that test does NOT cover is the parent
 * wire-up in `ShopApp.tsx`, which has SIX latent ways to silently
 * regress and leave the operator with no pre-flight temp preview:
 *
 *   1. The component import line is dropped (banner stops rendering --
 *      typecheck catches the JSX reference but a stray rename of the
 *      default export would compile and silently render undefined).
 *   2. The `moonrakerPreviewSamples` `useState` slot is renamed or
 *      retyped to a non-`GcodeTempSample[]` value (would break the
 *      formatter contract at runtime, not at compile time, since
 *      `formatFdmTempPreview` accepts `unknown[]` defensively).
 *   3. The `view === 'jobs' && isFdm` mount gate is loosened (banner
 *      leaks into non-FDM machines -- Laguna router, Carvera 4-axis --
 *      where the temperature preview is meaningless).
 *   4. The `view === 'jobs' && isFdm` mount gate is tightened (banner
 *      stops rendering even on FDM K2 jobs -- silent UX regression).
 *   5. The `useEffect` reset on `[activeJobId, activeJob?.gcodeOut]`
 *      is dropped (stale samples from a previous K2 push leak into the
 *      next job's drawer -- the operator sees temperatures that belong
 *      to a different job and may approve a print that will overheat).
 *   6. The `setMoonrakerPreviewSamples(previewSamples)` flow after
 *      `r.tempValidation?.samples` is dropped (banner never populates;
 *      operator gets the post-Send rejection toast but no pre-flight
 *      banner on the next attempt).
 *
 * Each of these is silently survivable for typecheck + the existing
 * isolated render tests. This file pins them as literal source-text
 * invariants on `ShopApp.tsx` so any structural drop-back fails one of
 * the named `it()` blocks below with a precise diagnostic.
 *
 * Implementation
 * --------------
 * Reads `src/renderer/src/ShopApp.tsx` as plain text and asserts the
 * presence + uniqueness of each anchor string. No JSX parsing, no
 * jsdom -- consistent with the existing static-analysis pin family
 * (`shop-app-toolbar-button-types.test.ts`,
 * `renderer-button-types-extended.test.ts`,
 * `renderer-input-img-types.test.ts`,
 * `renderer-select-textarea-controlled.test.ts`,
 * `renderer-svg-accessibility.test.ts`).
 *
 * Cycle-history context
 * ---------------------
 *   - Cycle 27 [ID-0072]: `formatFdmTempPreview` formatter shipped
 *     (pure function in `src/shared/fdm-temp-preview.ts`).
 *   - Cycle 50 [ID-0072-followup]: `MoonrakerPreviewBanner` component
 *     + ShopApp.tsx wire-up + render-contract pins shipped.
 *   - Cycle 71 ui-polish: audit pass on the banner component
 *     (no production-code changes required).
 *   - Cycle 95 (THIS pin): the audit closes [ID-0072] by pinning the
 *     ShopApp.tsx wire-up so the close-on-confirm path becomes a
 *     test-enforced invariant rather than a documentation note.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SHOP_APP_PATH = join(process.cwd(), 'src/renderer/src/ShopApp.tsx')

/**
 * Lazy-load the source ONCE per test module (vitest worker-scoped).
 * The file is large (~1900 lines) but we only ever scan it for
 * literal substrings; reading it in a module-level constant keeps the
 * 8 it() blocks from re-reading on every assertion.
 */
const SHOP_APP_SRC: string = readFileSync(SHOP_APP_PATH, 'utf8')

/**
 * Count exact substring occurrences with no regex semantics.
 * Used to enforce both presence (count >= 1) and uniqueness
 * (count === 1) on each anchor.
 */
function countSubstring(haystack: string, needle: string): number {
  if (needle.length === 0) return 0
  let n = 0
  let i = 0
  while (true) {
    const found = haystack.indexOf(needle, i)
    if (found < 0) return n
    n += 1
    i = found + needle.length
  }
}

describe('MoonrakerPreviewBanner ShopApp.tsx wire-up -- [ID-0072] Cycle 95 integration pin', () => {
  describe('1. Import + component reference', () => {
    it('imports the MoonrakerPreviewBanner default export from ./MoonrakerPreviewBanner', () => {
      // The Cycle 50 wire-up uses a default-export import. A rename
      // would still typecheck (TS would error elsewhere) but a stray
      // path-only edit (e.g. moving the file) would silently break
      // the runtime render. Pinning the literal import line means a
      // path drift is caught here rather than at the operator's
      // print queue.
      const importLine = "import MoonrakerPreviewBanner from './MoonrakerPreviewBanner'"
      expect(countSubstring(SHOP_APP_SRC, importLine)).toBe(1)
    })

    it('renders <MoonrakerPreviewBanner samples={moonrakerPreviewSamples} /> exactly once', () => {
      // Single-mount invariant. Two mounts would double-render the
      // banner (visual bug, no functional impact); zero mounts is a
      // silent regression of the entire feature.
      const mountTag = '<MoonrakerPreviewBanner samples={moonrakerPreviewSamples} />'
      expect(countSubstring(SHOP_APP_SRC, mountTag)).toBe(1)
    })
  })

  describe('2. State slot + reset effect', () => {
    it('declares the moonrakerPreviewSamples useState slot with readonly GcodeTempSample[] | undefined typing', () => {
      // The state hook MUST be typed as `readonly GcodeTempSample[] |
      // undefined` so the formatter contract holds at compile time.
      // A retype to `unknown[]` or `GcodeTempSample[]` (mutable) would
      // pass typecheck but lose the immutability guarantee that
      // `MoonrakerPreviewBannerProps.samples` requires.
      expect(SHOP_APP_SRC).toContain(
        'const [moonrakerPreviewSamples, setMoonrakerPreviewSamples] = useState<'
      )
      expect(SHOP_APP_SRC).toContain('readonly GcodeTempSample[] | undefined')
    })

    it('resets moonrakerPreviewSamples to undefined when activeJobId or activeJob.gcodeOut changes', () => {
      // The reset useEffect's body MUST call
      // `setMoonrakerPreviewSamples(undefined)` and its dependency
      // array MUST include both `activeJobId` and `activeJob?.gcodeOut`.
      // Dropping either leaks samples between jobs (silent safety
      // hazard: operator sees stale temps).
      expect(SHOP_APP_SRC).toContain('setMoonrakerPreviewSamples(undefined)')
      expect(SHOP_APP_SRC).toContain('}, [activeJobId, activeJob?.gcodeOut])')
    })
  })

  describe('3. Mount gate -- view === jobs AND isFdm', () => {
    it('mounts the banner only when view === jobs AND isFdm (the FDM-only K2 path)', () => {
      // The mount gate combines a string equality on `view` with the
      // boolean `isFdm` derived from `getMachineMode(sessionMachine)
      // === 'fdm'`. Both halves are required: the K2 fab drawer is the
      // ONLY drawer that surfaces a Moonraker push button, and the
      // banner above that button is meaningless for the Laguna router
      // and the Carvera 4-axis (no nozzle/bed/chamber on those).
      const gate = "view === 'jobs' && isFdm"
      expect(countSubstring(SHOP_APP_SRC, gate)).toBeGreaterThanOrEqual(1)
      // The literal MOUNT block ties the gate to the banner JSX.
      expect(SHOP_APP_SRC).toContain(
        "{view === 'jobs' && isFdm && (\n        <MoonrakerPreviewBanner samples={moonrakerPreviewSamples} />\n      )}"
      )
    })

    it('declares isFdm via getMachineMode === fdm comparison (not a regex on machine name)', () => {
      // Pin the derivation source so a future cycle that
      // accidentally swaps `mode === 'fdm'` for a brittle name-based
      // check (e.g. `name.includes('K2')`) is caught here.
      expect(SHOP_APP_SRC).toContain("const isFdm = mode === 'fdm'")
    })
  })

  describe('4. Push-result -> samples flow', () => {
    it('threads r.tempValidation?.samples into setMoonrakerPreviewSamples after a Moonraker push', () => {
      // Per Cycle 50, the validator surfaces samples on BOTH the ok
      // and rejection paths. Dropping the assignment leaves the
      // banner permanently empty (silent regression).
      expect(SHOP_APP_SRC).toContain('const previewSamples = r.tempValidation?.samples')
      expect(SHOP_APP_SRC).toContain('setMoonrakerPreviewSamples(previewSamples)')
    })

    it('forwards the samples to the moonrakerPreview IPC bridge with a swallowed-error catch', () => {
      // The Cycle 50 contract: the preview IPC is non-critical
      // telemetry; the user-facing flow MUST stay byte-identical to
      // the pre-[ID-0072-followup] behavior even if the bridge throws.
      // Dropping the .catch() would let a future preload regression
      // surface as an unhandled rejection in the K2 push path.
      expect(SHOP_APP_SRC).toContain('void fab().moonrakerPreview(previewSamples).catch(()')
    })

    it('gates the banner-state assignment on previewSamples being non-empty', () => {
      // The Cycle 50 contract guards against assigning an empty
      // samples[] (which would still mount the banner with a
      // formatter-null result, but the empty-array guard makes the
      // intent explicit and avoids unnecessary re-renders).
      expect(SHOP_APP_SRC).toContain('previewSamples && previewSamples.length > 0')
    })
  })
})
