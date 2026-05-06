/**
 * Laguna Swift 5x10 -- Mach3-superset dialect-reuse paired-pin
 * [ID-0063] (Cycle 113, docs-and-dx).
 *
 * Background -- the dialect-reuse decision history.
 *
 *   The Laguna Swift 5x10's RichAuto A-series handheld controller accepts
 *   Mach3 G-code as a strict superset (G21/G90/G17, G0/G1/G2/G3,
 *   M3/M5, S/F, M7/M9, M30, and `%` tape markers are all honored).
 *   When `vcarve_mach3.hbs` was wired up for the Laguna in Cycle 4
 *   [ID-0004], the team explicitly chose to REUSE the existing
 *   `dialect: "mach3"` enum rather than introduce a new `richauto_a`
 *   enum (CLAUDE.md Safety Rule 2: schema changes need migrations --
 *   for zero behavioural gain, the migration cost was not justified).
 *
 *   That decision was documented in TWO places:
 *     1. The preamble comment of `resources/posts/vcarve_mach3.hbs`
 *        (the post template's "Controller-dialect note" block).
 *     2. The Laguna section of `docs/MACHINES.md` (the operator-facing
 *        machine reference).
 *
 *   If the two places ever drift -- if the docs claim a controller
 *   accepts a token that the post template does not actually emit, or
 *   if the post template's preamble loses the rationale that the docs
 *   point at -- an operator reading the docs would be misled. This
 *   pin test fires before that drift can ship.
 *
 * Scope -- ONLY the Mach3-superset cross-link invariant. Other Laguna
 * dialect details (warm-up dwells, dust-collection M-codes, RPM clamps,
 * tape markers in actual output) are pinned by:
 *   - `src/main/post-process-laguna-richauto.test.ts` (Cycle 4 [ID-0004]
 *     -- 15 assertions on actual rendered output bytes).
 *   - `src/shared/machines-docs-pin.test.ts::Laguna Swift 5x10 fields`
 *     (Cycle 15 [ID-0083] -- mach3 + RichAuto are mentioned).
 * This file is a NARROW close-on-audit gate for [ID-0063]: the
 * cross-link integrity between the two documentation sites.
 *
 * Cycle 113 hand-off note: this test file is the test-enforced form of
 * the [ID-0063] roadmap entry's "consider closing on next docs-and-dx
 * pull". The roadmap entry can move to COMPLETED once this gate is
 * green because any future drift will trip the pin BEFORE an operator
 * reads stale docs. Same close-on-audit pattern as Cycle 95 [ID-0072].
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = join(__dirname, '..', '..')

function loadMachinesMd(): string {
  return readFileSync(join(repoRoot, 'docs', 'MACHINES.md'), 'utf-8')
}

function loadVcarvePost(): string {
  return readFileSync(
    join(repoRoot, 'resources', 'posts', 'vcarve_mach3.hbs'),
    'utf-8'
  )
}

/**
 * The G-code subset both documentation sites must enumerate. Drift on
 * either side is a documentation bug. Tokens are bare strings (not
 * regex) so the assertion message names the missing token verbatim.
 */
const GCODE_SUBSET_TOKENS: readonly string[] = [
  'G21',
  'G90',
  'G17',
  'G0',
  'G1',
  'G2',
  'G3',
  'M3',
  'M5',
  'M30',
] as const

describe('Laguna Mach3-superset cross-link [ID-0063]', () => {
  describe('docs/MACHINES.md side', () => {
    it('contains the explicit cross-link to the post template preamble', () => {
      // The Laguna section must point operators (and future
      // maintainers) at the post template where the per-feature
      // rationale lives. A relative link from docs/ to resources/posts/
      // is `../resources/posts/vcarve_mach3.hbs`.
      const doc = loadMachinesMd()
      expect(doc).toMatch(/\.\.\/resources\/posts\/vcarve_mach3\.hbs/)
    })

    it('cites both [ID-0004] and [ID-0063] on the dialect-reuse decision', () => {
      // [ID-0004] is the original Laguna post landing (Cycle 4); its
      // sibling [ID-0063] is the close-out tracker that this very
      // cycle is closing. Both must be cited so a future reader can
      // trace the why.
      const doc = loadMachinesMd()
      const lines = doc.split('\n')
      const dialectLine = lines.find(
        (l) => /\*\*Dialect:\*\* `mach3`/.test(l) && /Mach3/.test(l)
      )
      expect(
        dialectLine,
        'docs/MACHINES.md must have a "**Dialect:** `mach3`" bullet in the Laguna section that mentions Mach3 by name'
      ).toBeDefined()
      expect(dialectLine).toMatch(/\[ID-0004\]/)
      expect(dialectLine).toMatch(/\[ID-0063\]/)
    })

    it('describes the dialect relationship as a "superset" (not just compatibility)', () => {
      // The phrasing matters: "Mach3-compatible" understates the
      // claim, "Mach3 superset" captures that RichAuto accepts ALL
      // the Mach3 tokens this post emits and would also accept
      // additional RichAuto-only tokens (which we don't use).
      const doc = loadMachinesMd()
      expect(doc).toMatch(/superset/i)
    })

    it('mentions the RichAuto A-series controller by name', () => {
      const doc = loadMachinesMd()
      expect(doc).toMatch(/RichAuto/i)
      expect(doc).toMatch(/A-series/i)
    })

    it('enumerates the Mach3 G-code subset that RichAuto accepts (one token per check)', () => {
      const doc = loadMachinesMd()
      // The doc must spell out the specific subset so an operator
      // doesn't have to take "superset" on faith. Each token gets its
      // own check so the failure message names which one regressed.
      for (const token of GCODE_SUBSET_TOKENS) {
        expect(doc).toContain(token)
      }
    })

    it('mentions `%` tape markers (Mach3 program tape convention)', () => {
      // Tape markers are the most-likely-to-be-dropped item if a
      // future docs refresh shortens the bullet for prose flow.
      // They are also the lowest-cost RichAuto feature to verify
      // (they appear on the very first/last lines of the rendered
      // output so an operator can eyeball them).
      const doc = loadMachinesMd()
      expect(doc).toMatch(/`%`\s*tape\s*markers/i)
    })

    it('mentions M7/M9 dust-collection M-codes (RichAuto-honored)', () => {
      // M7/M9 are part of the Mach3 superset. The Laguna post emits
      // them gated on the `dustCollection` job flag (see [ID-0004]).
      // The docs must list them so an operator wiring up dust
      // collection knows the flag triggers real M-codes, not just
      // commented reminders.
      const doc = loadMachinesMd()
      expect(doc).toMatch(/`M7`\/`M9`|M7\/M9/)
    })
  })

  describe('resources/posts/vcarve_mach3.hbs side', () => {
    it('contains a preamble comment block (Handlebars `{{!-- ... --}}`)', () => {
      const post = loadVcarvePost()
      expect(post).toMatch(/^\{\{!--/m)
      expect(post).toMatch(/--\}\}/)
    })

    it('cites the [ID-0063] roadmap entry inside the preamble', () => {
      // The post's preamble carries the per-feature rationale. The
      // [ID-0063] tag is what the docs side cross-links *to*.
      // Without the tag here the cross-link is unanchored.
      const post = loadVcarvePost()
      expect(post).toMatch(/\[ID-0063\]/)
    })

    it('describes the dialect relationship as a "superset" (matches docs phrasing)', () => {
      const post = loadVcarvePost()
      expect(post).toMatch(/superset/i)
    })

    it('mentions the RichAuto A-series controller by name (matches docs)', () => {
      const post = loadVcarvePost()
      expect(post).toMatch(/RichAuto/i)
      expect(post).toMatch(/A-series/i)
    })

    it('enumerates the same Mach3 G-code subset (one token per check)', () => {
      const post = loadVcarvePost()
      for (const token of GCODE_SUBSET_TOKENS) {
        expect(post).toContain(token)
      }
    })

    it('mentions `%` tape markers (matches docs)', () => {
      const post = loadVcarvePost()
      // Match either the literal "% tape markers" prose form or the
      // separator-tolerant variant. The post's preamble currently
      // uses prose, the docs use a backtick-wrapped form.
      expect(post).toMatch(/%[`'"\s]*tape\s*markers/i)
    })

    it('explicitly states why a new `richauto_a` enum was NOT introduced (CLAUDE.md Safety Rule 2)', () => {
      // The decision rationale must be on disk somewhere a future
      // maintainer can find it. The post template's preamble is the
      // canonical home; the docs cross-link to it. If this rationale
      // ever moves (e.g. to a separate ADR), update the cross-link
      // expectation in the docs side above to match.
      const post = loadVcarvePost()
      // Allow either "schema migration" or "Safety Rule 2" phrasing
      // -- both forms appear historically and either is sufficient
      // to communicate the why.
      expect(post).toMatch(/schema\s+migration|Safety\s*Rule\s*2/i)
    })
  })

  describe('cross-link consistency', () => {
    it('both documents agree the dialect is `mach3` (not richauto_a)', () => {
      const doc = loadMachinesMd()
      const post = loadVcarvePost()
      // Both files must use the lowercase enum name `mach3` (the
      // schema enum literal). A drift to `Mach3` capitalization is
      // tolerated in prose but the bare enum name must appear.
      expect(doc).toMatch(/`mach3`/)
      expect(post).toMatch(/dialect:\s*"mach3"/)
    })

    it('neither document references a hypothetical `richauto_a` dialect enum', () => {
      // Negative pin: if a future cycle ever introduces a
      // `richauto_a` enum, [ID-0063]'s decision must be re-litigated
      // and BOTH documents must be re-aligned in the same cycle.
      // Until then, neither side may quietly mention the new enum
      // and leave the other behind.
      const doc = loadMachinesMd()
      const post = loadVcarvePost()
      expect(doc).not.toMatch(/`richauto_a`/)
      expect(post).not.toMatch(/dialect:\s*"richauto_a"/)
    })

    it('the docs cross-link path resolves to the post template that exists on disk', () => {
      // The link in docs/MACHINES.md is `../resources/posts/vcarve_mach3.hbs`.
      // A future restructure of resources/ would silently break that
      // relative link. This pin asserts the file exists at the path
      // the docs claim.
      const doc = loadMachinesMd()
      expect(doc).toMatch(/\.\.\/resources\/posts\/vcarve_mach3\.hbs/)
      // The loadVcarvePost() call above already proves the file
      // exists (readFileSync would throw); re-prove it here so this
      // test is self-contained.
      const post = loadVcarvePost()
      expect(post.length).toBeGreaterThan(0)
    })

    it('both documents enumerate ALL the same Mach3 G-code subset tokens', () => {
      const doc = loadMachinesMd()
      const post = loadVcarvePost()
      // The previous per-side tests already prove each side
      // contains every token. This test asserts the union and the
      // intersection are equal, i.e. no token appears on only one
      // side. Keeps both lists honest in lockstep.
      const docHits = GCODE_SUBSET_TOKENS.filter((t) => doc.includes(t))
      const postHits = GCODE_SUBSET_TOKENS.filter((t) => post.includes(t))
      expect(docHits).toEqual([...GCODE_SUBSET_TOKENS])
      expect(postHits).toEqual([...GCODE_SUBSET_TOKENS])
    })
  })
})
