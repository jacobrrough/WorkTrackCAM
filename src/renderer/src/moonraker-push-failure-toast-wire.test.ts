/**
 * Cycle 96 post-processing [ID-0088] -- INTEGRATION pin: the Moonraker
 * push-failure split-toast + Copy-button wire-up MUST stay structurally
 * intact across BOTH the call-site (`src/renderer/src/ShopApp.tsx`) and
 * the toast renderer (`src/renderer/contexts/ToastContext.tsx`).
 *
 * Why this matters
 * ----------------
 * `moonraker-push-payload.test.ts` (Cycle 14) covers the pure helpers
 * `splitMoonrakerPushFailureForToast` and
 * `buildMoonrakerPushFailureClipboardText` in isolation.
 * `toast-clipboard.test.ts` (Cycle 14) covers `copyToastTextToClipboard`
 * (the navigator.clipboard wrapper) in isolation. What those tests do
 * NOT cover is the parent integration: the renderer call-site that turns
 * a `MoonrakerPushResult` rejection into a two-line toast, and the
 * ToastContext renderer that draws the Copy button.
 *
 * There are at least NINE silently-survivable regression vectors:
 *
 *   1. The call-site reverts to the legacy single-line
 *      `pushToast('err', formatMoonrakerPushFailure(r))` form -- the
 *      ~150-char detail with `(+N more)` would once again get chopped at
 *      200 chars by `formatErrorForToast`. Typecheck passes, the legacy
 *      single-line tests still pass, but the operator loses the verbose
 *      validator output that motivated [ID-0088].
 *   2. The call-site drops the `if (split.detail !== null)` guard and
 *      always passes the 3-arg form -- a null detail would render the
 *      `--with-detail` row with an empty body and an aria-labeled Copy
 *      button that copies "Send failed: " (trailing colon-space).
 *   3. The call-site stops wrapping `split.title` in
 *      `formatErrorForToast(...)` -- a future validator with a 300-char
 *      `error` field would overflow the toast bubble's first line.
 *   4. The `Toast` shape in `ToastContext.tsx` drops the optional
 *      `detail?: string` field -- the call-site's third argument would
 *      be silently ignored at the Provider boundary (TS would error on
 *      the destructure but a stray retype to `Record<string, unknown>`
 *      could survive).
 *   5. The `pushToast` ContextValue signature drops the third parameter
 *      -- same silent-ignore problem at a different layer.
 *   6. The doubled TTL when a detail is present
 *      (`TOAST_TTL_WITH_DETAIL_MS = 8000`) is dropped, so long-form
 *      toasts auto-dismiss at 4 s before the operator can read or copy.
 *   7. The Copy button aria-label is changed away from "Copy full
 *      message to clipboard", silently breaking screen-reader UX.
 *   8. The clipboard text construction `${msg}: ${detail}` drifts
 *      (e.g. someone "improves" it to `${msg}\n${detail}`) and the
 *      paste-into-bug-report shape no longer matches
 *      `buildMoonrakerPushFailureClipboardText` -- the legacy
 *      single-line reconstruction Safety Rule 2 invariant breaks
 *      silently.
 *   9. The `copyToastTextToClipboard` export is renamed or removed --
 *      `toast-clipboard.test.ts` would break, but a future cycle that
 *      "fixes" the test by inlining the helper would silently lose the
 *      separately-tested navigator.clipboard fallback chain.
 *
 * Each is silently survivable for typecheck + the existing pure-helper
 * tests. This file pins them as literal source-text invariants on
 * `ShopApp.tsx` and `ToastContext.tsx` so any structural drop-back fails
 * one of the named `it()` blocks below with a precise diagnostic.
 *
 * Implementation
 * --------------
 * Reads the two source files as plain text and asserts the presence
 * (and, where appropriate, uniqueness) of each anchor string. No JSX
 * parsing, no jsdom -- consistent with the existing static-analysis pin
 * family (`moonraker-preview-banner-shopapp-wire.test.ts`,
 * `shop-app-toolbar-button-types.test.ts`,
 * `renderer-button-types-extended.test.ts`,
 * `renderer-input-img-types.test.ts`,
 * `renderer-select-textarea-controlled.test.ts`,
 * `renderer-svg-accessibility.test.ts`).
 *
 * Cycle-history context
 * ---------------------
 *   - Cycle 14 [ID-0088]: split-toast helpers
 *     (`splitMoonrakerPushFailureForToast`,
 *     `buildMoonrakerPushFailureClipboardText`) shipped, ToastContext
 *     learned about `detail`, ShopApp.tsx wired the failure branch.
 *   - Cycle 71 ui-polish: audit pass on the split-toast
 *     (no production-code changes required per Cycle 71 daily-plan).
 *   - Cycle 96 (THIS pin): the audit closes [ID-0088] by pinning the
 *     ShopApp.tsx + ToastContext.tsx wire-up so the close-on-confirm
 *     path becomes a test-enforced invariant rather than a documentation
 *     note. Mirrors the close-on-audit pattern used by Cycle 95 for
 *     [ID-0072] (`moonraker-preview-banner-shopapp-wire.test.ts`).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SHOP_APP_PATH = join(process.cwd(), 'src/renderer/src/ShopApp.tsx')
const TOAST_CONTEXT_PATH = join(process.cwd(), 'src/renderer/contexts/ToastContext.tsx')

/**
 * Lazy-load the source ONCE per test module (vitest worker-scoped).
 * Both files are scanned for literal substrings only; reading them in
 * module-level constants keeps the it() blocks from re-reading on every
 * assertion.
 */
const SHOP_APP_SRC: string = readFileSync(SHOP_APP_PATH, 'utf8')
const TOAST_CONTEXT_SRC: string = readFileSync(TOAST_CONTEXT_PATH, 'utf8')

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

describe('[ID-0088] Moonraker push-failure split-toast wire-up -- Cycle 96 integration pin', () => {
  describe('1. ShopApp.tsx imports the split-toast helpers from moonraker-push-payload', () => {
    it('imports splitMoonrakerPushFailureForToast from ./moonraker-push-payload', () => {
      // The Cycle 14 wire-up uses a named import. A path-only edit (e.g.
      // moving the helper module) would silently break the runtime
      // failure-branch render. Pinning the literal import name means a
      // path drift is caught here rather than at the operator's printer.
      expect(SHOP_APP_SRC).toContain('splitMoonrakerPushFailureForToast')
      expect(SHOP_APP_SRC).toContain("} from './moonraker-push-payload'")
    })

    it('keeps formatMoonrakerPushFailure imported as the legacy single-line fallback', () => {
      // ShopApp.tsx Cycle 14 comment block explicitly preserves the
      // legacy formatter as a fallback for any future call-site that
      // still needs a single string. Removing this import would silently
      // delete the documented fallback path. Two import lines must
      // coexist (Safety Rule 2: no behavior loss vs pre-[ID-0088]).
      expect(SHOP_APP_SRC).toContain('formatMoonrakerPushFailure')
    })
  })

  describe('2. ShopApp.tsx threads the split into pushToast', () => {
    it('calls splitMoonrakerPushFailureForToast(r) exactly once in the failure branch', () => {
      // Single-call invariant. The split helper is pure, but a duplicate
      // call would double-process the result and double-mount the toast.
      // Zero calls is a silent regression of the entire feature.
      const callSite = 'const split = splitMoonrakerPushFailureForToast(r)'
      expect(countSubstring(SHOP_APP_SRC, callSite)).toBe(1)
    })

    it('wraps split.title in formatErrorForToast for the toast first line', () => {
      // formatErrorForToast applies a 200-char clamp suitable for a
      // toast title. Dropping it would let a 300-char `error` field
      // overflow the bubble's first line. Pinning the call-site keeps
      // the title-vs-detail clamp-asymmetry explicit (only the title is
      // clamped; the detail renders verbatim so the operator can match
      // it against the G-code line).
      expect(SHOP_APP_SRC).toContain(
        "const titleForToast = formatErrorForToast(split.title, 'Send to printer')"
      )
    })

    it('threads split.detail into the 3-arg pushToast form when non-null', () => {
      // The non-null branch MUST pass `titleForToast` AND `split.detail`
      // as the second + third args. Dropping the third arg would still
      // typecheck (detail is optional) but the Copy-button row would
      // never render -- silent UX regression.
      expect(SHOP_APP_SRC).toContain(
        "pushToast('err', titleForToast, split.detail)"
      )
    })

    it('falls back to the 2-arg pushToast form when split.detail is null', () => {
      // The null-detail branch keeps the legacy 2-arg shape so the
      // existing 30+ pushToast call-sites that pass two arguments stay
      // byte-identical. Replacing this with a 3-arg `pushToast('err',
      // titleForToast, '')` would render an empty `.toast-item__detail`
      // and mount the Copy button with " " on the clipboard.
      expect(SHOP_APP_SRC).toContain("pushToast('err', titleForToast)")
    })

    it('uses an if/else on split.detail !== null (not a truthy check that misclassifies "")', () => {
      // The Cycle 14 contract is a strict null check -- the helper
      // returns `null` (not `''`) when there is no detail. A drift to
      // `if (split.detail)` would be subtly wrong if a future helper
      // version returns `''` for "absent": the truthy branch would skip
      // both forms and the toast would never render at all.
      expect(SHOP_APP_SRC).toContain('if (split.detail !== null) {')
    })
  })

  describe('3. ToastContext.tsx Toast shape carries the optional detail field', () => {
    it('declares detail?: string on the Toast row shape', () => {
      // The Toast row type MUST carry an optional `detail` field so the
      // Provider stores it for the renderer to consume. A retype to
      // `Record<string, unknown>` or a removal of the field would let
      // the third pushToast arg silently get dropped at the Provider
      // boundary.
      expect(TOAST_CONTEXT_SRC).toContain(
        'type Toast = { id: number; kind: ToastKind; msg: string; detail?: string }'
      )
    })

    it('declares pushToast as a (kind, msg, detail?) 3-arg signature on the context value', () => {
      // The ContextValue interface MUST expose the 3-arg signature so
      // the call-site can pass detail. A future TS-narrowing edit to
      // `(kind, msg) => void` would silently drop the third arg even if
      // the implementation kept accepting it.
      expect(TOAST_CONTEXT_SRC).toContain(
        'pushToast: (kind: ToastKind, msg: string, detail?: string) => void'
      )
    })
  })

  describe('4. ToastContext.tsx TTL doubles when a detail is present', () => {
    it('declares the legacy 4 s TTL constant for plain toasts', () => {
      // Legacy toasts MUST keep the historic 4000 ms window. Bumping
      // this would slow the existing happy-path UX (file-saved
      // confirmations etc.) without operator benefit.
      expect(TOAST_CONTEXT_SRC).toContain('const TOAST_TTL_MS = 4000')
    })

    it('declares the doubled 8 s TTL constant for detail-bearing toasts', () => {
      // Detail-bearing toasts MUST get 8000 ms so the operator has time
      // to read the long-form body and click Copy. Halving this back to
      // 4 s would silently reintroduce the original Cycle-14 motivation
      // (operator could not read or copy the validator output before
      // the toast auto-dismissed).
      expect(TOAST_CONTEXT_SRC).toContain('const TOAST_TTL_WITH_DETAIL_MS = 8000')
    })

    it('selects the doubled TTL via the hasDetail flag, not via msg length or kind', () => {
      // Pin the selection logic so a future "make all err toasts 8 s"
      // refactor (which would change behavior for the 30+ legacy 2-arg
      // err call-sites) is caught here. The pin is the literal ternary
      // on the boolean derived from the third arg.
      expect(TOAST_CONTEXT_SRC).toContain(
        'const ttl = hasDetail ? TOAST_TTL_WITH_DETAIL_MS : TOAST_TTL_MS'
      )
    })
  })

  describe('5. ToastContext.tsx renders the Copy button with the correct contract', () => {
    it('builds the clipboard text as `${msg}: ${detail}` to match buildMoonrakerPushFailureClipboardText', () => {
      // Clipboard-text invariant: the join shape MUST be `: ` (colon +
      // space) so the paste-into-bug-report output matches the legacy
      // single-line `formatMoonrakerPushFailure` rendering byte-for-byte.
      // A drift to `\n` or ` -- ` would silently break the
      // `buildMoonrakerPushFailureClipboardText` round-trip pinned in
      // moonraker-push-payload.test.ts.
      expect(TOAST_CONTEXT_SRC).toContain(
        'const clipboardText = `${t.msg}: ${t.detail}`'
      )
    })

    it('renders the Copy button with the documented aria-label', () => {
      // Screen-reader contract: the button MUST announce as "Copy full
      // message to clipboard". A drift to "Copy" alone or to a
      // role-only button would silently break SR-driven operator
      // workflows that rely on the announce text to disambiguate from
      // other Copy controls (file path copy, G-code excerpt copy).
      expect(TOAST_CONTEXT_SRC).toContain('aria-label="Copy full message to clipboard"')
    })

    it('wires the Copy button onClick to copyToastTextToClipboard with the joined text', () => {
      // The onClick MUST call the exported helper (which has its own
      // navigator-fallback unit tests). Inlining the navigator call
      // here would silently lose the secure-context fallback chain and
      // would drop the rejection-swallowing behavior that the Cycle 14
      // helper documents.
      expect(TOAST_CONTEXT_SRC).toContain(
        'onClick={() => copyToastTextToClipboard(clipboardText)}'
      )
    })

    it('exports copyToastTextToClipboard so the helper stays unit-testable', () => {
      // The export keyword MUST stay on the helper. A future "fix" that
      // inlines the helper into the onClick would break
      // `toast-clipboard.test.ts` directly -- but a refactor that
      // simply removes the `export` and keeps the helper file-local
      // would also break the test, and a follow-up "the test is
      // outdated" deletion would silently lose the navigator-fallback
      // coverage. Pin the export anchor explicitly.
      expect(TOAST_CONTEXT_SRC).toContain('export function copyToastTextToClipboard')
    })

    it('applies the --with-detail modifier class only when a detail is present', () => {
      // CSS-modifier invariant: the toast row MUST get the
      // `toast-item--with-detail` class so the renderer-only stylesheet
      // can grow the bubble's max-width and add the second-line
      // typography. Dropping the modifier would render the long-form
      // body in the legacy 360-px-wide single-line bubble, which is the
      // exact overflow case [ID-0088] was filed to fix.
      expect(TOAST_CONTEXT_SRC).toContain('toast-item--with-detail')
    })
  })
})
