/**
 * docs/EDIT-WORKFLOW.md -- docs-drift guard [ID-0089] + [ID-0095] (Cycle 20,
 * docs-and-dx, 2026-04-24).
 *
 * This test file is the pin between the Python-via-bash edit-workflow doc
 * and the places in the repo that reference it (CLAUDE.md Safety Rule 6,
 * .claude/commands/improve.md Safety Rule 7). It exists because the
 * workflow is the mitigation for [ID-0067] -- the Edit-tool silent
 * truncation bug that has now fired in 11 of 12 consecutive cycles
 * (Cycles 8-19). If the doc, the CLAUDE.md Safety Rule, or the playbook
 * reference ever drift out of sync, future cycles will fall back to the
 * Edit tool on large files and re-lose test coverage (as Cycle 19 did).
 *
 * Scope: the checklist items spelled out in Cycle 20's daily plan and the
 * improvement-log Cycle 19 FAILED/REVERTED post-mortem. No machine-facing
 * numbers, no G-code, no post templates -- pure process-doc pin.
 *
 * Safety Rules preserved: none of the asserts touch production behavior.
 * Failure of any assert means the doc/workflow drifted, not that shipping
 * code is broken.
 *
 * Mirrors the pattern in `machines-docs-pin.test.ts` ([ID-0083], Cycle 15).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = join(__dirname, '..', '..')

function loadEditWorkflow(): string {
  return readFileSync(join(repoRoot, 'docs', 'EDIT-WORKFLOW.md'), 'utf-8')
}

function loadClaudeMd(): string {
  return readFileSync(join(repoRoot, 'CLAUDE.md'), 'utf-8')
}

function loadPlaybook(): string {
  return readFileSync(join(repoRoot, '.claude', 'commands', 'improve.md'), 'utf-8')
}

describe('docs/EDIT-WORKFLOW.md pins [ID-0089] + [ID-0095]', () => {
  describe('file presence and structure', () => {
    it('EDIT-WORKFLOW.md exists and is non-trivial', () => {
      const doc = loadEditWorkflow()
      // Doc is non-empty and at least the five rules + references section.
      // Set a floor (not a ceiling) so future expansion is allowed.
      expect(doc.length).toBeGreaterThan(2000)
    })

    it('headlines the five workflow rules', () => {
      const doc = loadEditWorkflow()
      expect(doc).toMatch(/^## Rule 1 .+Choose the write path/m)
      expect(doc).toMatch(/^## Rule 2 .+marker[- ]uniqueness/m)
      expect(doc).toMatch(/^## Rule 3 .+Post-edit verification/m)
      expect(doc).toMatch(/^## Rule 4 .+Never commit a truncated file/m)
      expect(doc).toMatch(/^## Rule 5 .+Document every truncation/m)
    })
  })

  describe('Rule 1 -- write-path decision table', () => {
    it('documents the >800-line threshold for bypassing the Edit tool', () => {
      const doc = loadEditWorkflow()
      // 800 is the empirical threshold established in Cycles 8-19. Any
      // future change to this number MUST update this test first.
      expect(doc).toMatch(/> 800 lines/)
    })

    it('documents the Python-via-bash `p.write_text(...)` pattern', () => {
      const doc = loadEditWorkflow()
      expect(doc).toContain('from pathlib import Path')
      expect(doc).toContain('p.write_text(')
    })

    it('documents the .claude/ log append pattern', () => {
      const doc = loadEditWorkflow()
      // Log files grow unbounded; the append pattern is the only safe
      // write path for them. Spot-check a characteristic fragment.
      expect(doc).toMatch(/improvement-log\.md/)
      expect(doc).toMatch(/with p\.open\(['"]a['"]/)
    })
  })

  describe('Rule 2 -- splice-recovery marker-uniqueness checklist', () => {
    it('requires `txt.count(marker) == 1` as a hard gate', () => {
      const doc = loadEditWorkflow()
      // The Cycle 19 counter-factual is the strongest argument for this
      // rule. Pin the assertion snippet verbatim so it can be copy-pasted
      // by future cycles without reformatting risk.
      expect(doc).toContain('txt.count(marker) == 1')
    })

    it('documents `rfind` as the preferred fallback when the shared tail is at EOF', () => {
      const doc = loadEditWorkflow()
      expect(doc).toMatch(/text\.rfind\(marker\)/)
      expect(doc).toMatch(/text\.find\(marker\)/)
      // Explicit preference statement -- not just both-are-mentioned.
      expect(doc).toMatch(/prefer\s+`?text\.rfind/i)
    })

    it('documents line-index splicing as the safest splice primitive', () => {
      const doc = loadEditWorkflow()
      expect(doc).toMatch(/splitlines\(keepends=True\)/)
    })

    it('mandates full-file reconstruction for files > 500 lines with repeated fixtures', () => {
      const doc = loadEditWorkflow()
      // This is the Cycle-19 lesson promoted to a hard rule: if the
      // file has more than one `describe(...)` referencing the same
      // fixture field, splices are unsafe.
      expect(doc).toMatch(/prefer full-file reconstruction/i)
    })

    it('documents the Cycle 19 worked-example failure mode', () => {
      const doc = loadEditWorkflow()
      // The worked example is the teaching tool. Pin the specific
      // marker string and the line-count delta so a future cycle can't
      // accidentally reword the example into an uninstructive paraphrase.
      expect(doc).toContain("chamberTempC: profile.chamberT")
      expect(doc).toMatch(/858/)
      expect(doc).toMatch(/341/)
    })
  })

  describe('Rule 3 -- post-edit verification checklist', () => {
    it('requires `wc -l` and landmark grep checks', () => {
      const doc = loadEditWorkflow()
      expect(doc).toMatch(/wc -l/)
      // Landmark grep is the #1 way to catch silent tail truncation --
      // pin the pattern name explicitly.
      expect(doc).toMatch(/landmark grep/i)
    })

    it('requires focused `vitest` run after any .test.ts edit', () => {
      const doc = loadEditWorkflow()
      expect(doc).toMatch(/npx vitest run/)
    })

    it('requires G-code snapshot validation after any post-template edit', () => {
      const doc = loadEditWorkflow()
      // Safety Rule 1 hook -- the doc must carry the G-code snapshot
      // reminder or a post-template edit slips through without it.
      expect(doc).toMatch(/G-code (snapshot|is sacred)/i)
    })
  })

  describe('roadmap ID references (cross-cycle stability)', () => {
    it('references [ID-0067] as the originating truncation bug', () => {
      const doc = loadEditWorkflow()
      expect(doc).toContain('[ID-0067]')
    })

    it('references [ID-0089] as the Python-first workflow ID', () => {
      const doc = loadEditWorkflow()
      expect(doc).toContain('[ID-0089]')
    })

    it('references [ID-0095] as the marker-uniqueness ID', () => {
      const doc = loadEditWorkflow()
      expect(doc).toContain('[ID-0095]')
    })

    it('references [ID-0094] as the Cycle-19 damage follow-up', () => {
      const doc = loadEditWorkflow()
      // [ID-0094] is the HIGH-priority test reconstruction ticket blocked
      // on a safe edit path -- the doc's worked example is the exact
      // reason that ticket exists.
      expect(doc).toContain('[ID-0094]')
    })
  })

  describe('CLAUDE.md and playbook cross-links', () => {
    it('CLAUDE.md Safety Rule 6 links to docs/EDIT-WORKFLOW.md', () => {
      const claudeMd = loadClaudeMd()
      // Safety Rule 6 is the hard enforcement point -- if it drifts,
      // future cycles silently lose the mitigation.
      expect(claudeMd).toMatch(/Safety Rules[\s\S]*6\.\s.*docs\/EDIT-WORKFLOW\.md/)
    })

    it('CLAUDE.md Architecture Quick Reference links to docs/EDIT-WORKFLOW.md', () => {
      const claudeMd = loadClaudeMd()
      // Architecture section is the discovery path for humans skimming
      // the repo. Pin that the link is present so a future restructure
      // of the quick reference doesn't quietly drop it.
      expect(claudeMd).toMatch(/Architecture Quick Reference[\s\S]*docs\/EDIT-WORKFLOW\.md/)
    })

    it('.claude/commands/improve.md Safety Rule 7 links to docs/EDIT-WORKFLOW.md', () => {
      const playbook = loadPlaybook()
      // Rule 7 in the playbook is the enforcement hook for autonomous
      // cycles. If it drifts, the daily-inventory and hourly workers
      // lose the mitigation path.
      expect(playbook).toMatch(/7\.\s+\*\*Large-file edits[\s\S]*docs\/EDIT-WORKFLOW\.md/)
    })

    it('EDIT-WORKFLOW.md back-references prior-art docs-pin test', () => {
      const doc = loadEditWorkflow()
      // The doc's References section should cite the
      // machines-docs-pin.test.ts prior art so future readers can find
      // the pattern. Zero-bytes-on-wire safety property for docs drift.
      expect(doc).toContain('machines-docs-pin.test.ts')
    })
  })

  describe('Rule 1.5 -- content-characteristic override [ID-0067] Cycle 26 data update', () => {
    it('headlines a Rule 1.5 section', () => {
      const doc = loadEditWorkflow()
      // Rule 1.5 was added by Cycle 26 (docs-and-dx) after the size-correlation
      // hypothesis was falsified twice in a row (Cycles 22 + 24). It is the
      // content-characteristic override on top of R1's size table; if it
      // disappears, future cycles will re-default to `Edit` on small files
      // with risky content shapes.
      expect(doc).toMatch(/^## Rule 1\.5 .+Content-characteristic override/m)
    })

    it('updates the cumulative [ID-0067] failure rate to 26 of 37 cycles (Cycle 63 [ID-0067-data-v10] refresh)', () => {
      const doc = loadEditWorkflow()
      // The cumulative count is the data point that drives every future
      // tooling decision (when to scrap the threshold, when to ask for a
      // sandbox-side fix). Pin the post-Cycle-62 number so it cannot drift
      // backward. Provenance: 14/15 (post-Cycle-24) -> 17/18 (Cycle 30
      // after Cycles 27 + 28 spikes) -> 21/22 (Cycle 35 after Cycles 32 +
      // 34) -> 22/23 (Cycle 40 after Cycle 39 two-files-in-one) -> 22/23
      // UNCHANGED across the seven-cycle workflow-prevented streak (Cycles
      // 40-46) -> still 22/23 across the ten-in-a-row streak through Cycle
      // 49 -> 23/24 (Cycle 53 after Cycle 50's 23-line vitest.config.ts
      // single fire) -> 23/28 across the post-reset 4-in-a-row clean run
      // (Cycles 51-54 each ZERO fires; denominator only) -> 25/30 (Cycle
      // 56 [ID-0067-data-v8] after Cycle 55's TWO fires) -> 26/31 (Cycle
      // 56 self-referential fire on this very pin file 720 -> 716 lines
      // mid-pin-block, FIRST self-referential fire in the [ID-0067]
      // ledger; the LARGEST size on record for an Edit-tool truncation
      // since Cycle 28's 840-line post-process-snapshots.test.ts) ->
      // 26/33 (Cycle 59 [ID-0067-data-v9] after Cycles 57 + 58 each ZERO
      // fires denominator-only) -> 26/34 (Cycle 59 close, denominator-only)
      // -> 26/35 (Cycle 60 [ID-0013-followup] post-processing clean) ->
      // 26/36 (Cycle 61 [ID-0152] ui-polish clean) -> **26/37** (Cycle 62
      // [ID-0091] perf + bonus [ID-0152-followup] clean). Cycle 63
      // [ID-0067-data-v10] absorbs Cycles 60 + 61 + 62 as three new
      // denominator-only workflow-prevented datapoints; the post-Cycle-56-
      // reset streak is now SIX-in-a-row (Cycles 57-62), the longest
      // post-reset clean stretch since the [ID-0067] ledger opened.
      expect(doc).toMatch(/29 of 53 consecutive improvement cycles/)
      expect(doc).toMatch(/29 out of 53 cycles/)
    })

    it('documents the size-correlation hypothesis being falsified', () => {
      const doc = loadEditWorkflow()
      // The phrase 'size-correlation hypothesis falsified' is the headline
      // of the Cycle 26 update. Pin it verbatim so a future reword cannot
      // soften the conclusion.
      expect(doc).toMatch(/[Ss]ize-correlation hypothesis falsified/)
    })

    it('cites Cycle 22 (30-line .hbs) and Cycle 24 (335-line .ts) as the size-uncorrelated proofs', () => {
      const doc = loadEditWorkflow()
      // These two cycles are the empirical backing for Rule 1.5. If a
      // future reword drops them, the rule loses its evidence chain.
      expect(doc).toMatch(/Cycle 22.*30-line.*\.hbs/)
      expect(doc).toMatch(/Cycle 24.*335-line.*\.ts/)
    })

    it('flags Handlebars block syntax as mandatory Python-via-bash territory', () => {
      const doc = loadEditWorkflow()
      // The .hbs trigger is the Cycle-22 lesson. Pin the literal token
      // so a future reword cannot generalise it into uselessness.
      expect(doc).toMatch(/\{\{#if/)
      expect(doc).toMatch(/Handlebars/)
    })

    it('flags complex regex literals as mandatory Python-via-bash territory', () => {
      const doc = loadEditWorkflow()
      // Cycle 24's truncation point was inside a regex alternation block;
      // the rule must call this out explicitly.
      expect(doc).toMatch(/complex regex/i)
    })

    it('flags multi-byte UTF-8 separators as a risk indicator', () => {
      const doc = loadEditWorkflow()
      // Multi-byte separator handling is one of the leading suspects for
      // the diff-tool failure mode. Pin the call-out.
      expect(doc).toMatch(/multi-byte UTF-8/i)
    })

    it('flags second-Edit-after-truncation as hazardous', () => {
      const doc = loadEditWorkflow()
      // Cycle 24's truncation fired on the SECOND of two `Edit` calls in
      // the same cycle (the first one looked clean). The rule must warn
      // against a naive retry after revert.
      expect(doc).toMatch(/second `Edit`|already truncated once this session/i)
    })

    it('mentions Cycle 26 + Cycle 30 + Cycle 35 + Cycle 40 + Cycle 44 + Cycle 47 + Cycle 53 + Cycle 63 as the docs-and-dx cycles that authored + extended Rule 1.5', () => {
      const doc = loadEditWorkflow()
      // Audit trail -- every doc change in this repo cites the cycle
      // that made it. Pin Cycle 26 (original author), Cycle 30 (Cycle 27
      // + 28 Write-tool-also-truncates extension), Cycle 35 (Cycle 32
      // + 34 first-attempt-on-multi-byte-content escalation),
      // Cycle 40 (Cycle 39 first-ever two-files-in-a-single-cycle
      // spike + differential recovery-strategy guidance), Cycle 44
      // (Cycles 40 + 41 + 42 + 43 four-consecutive-workflow-prevented
      // streak datapoint -- the first time the rule chain has eaten its
      // own dogfood for four cycles in a row), Cycle 47 (extended the
      // streak to 7-in-a-row by appending Cycles 44 + 45 + 46 as
      // workflow-prevented datapoints), and Cycle 53 (records the streak
      // ENDING at Cycle 50 with ONE [ID-0067] fire on a 23-line
      // vitest.config.ts; cumulative rate bumped 22/23 -> 23/24; streak
      // reset to 0; Cycles 51 + 52 opened a new post-reset clean run --
      // [ID-0067-data-v7]) so a future reword cannot anonymise the
      // rule's provenance.
      expect(doc).toMatch(/Cycle 26/)
      expect(doc).toMatch(/Cycle 30/)
      expect(doc).toMatch(/Cycle 35/)
      expect(doc).toMatch(/Cycle 40/)
      expect(doc).toMatch(/Cycle 44/)
      expect(doc).toMatch(/Cycle 47/)
      expect(doc).toMatch(/Cycle 53/)
      expect(doc).toMatch(/Cycle 63/)
    })

    it('cites Cycle 27 (121-line .ts, Write-tool-also-affected) as a size-uncorrelated proof', () => {
      const doc = loadEditWorkflow()
      // Cycle 27 is the evidence that the Write tool also truncates --
      // pin the file-size + the formatFdmTempPreview name so a future
      // reword cannot collapse "Cycle 27" into a generic bullet.
      expect(doc).toMatch(/Cycle 27/)
      expect(doc).toMatch(/121-line/)
      expect(doc).toMatch(/formatFdmTempPreview/)
    })

    it('cites Cycle 28 (840 -> 732 + 108 -> 104 line truncations) as the 4-fire spike proof', () => {
      const doc = loadEditWorkflow()
      // Cycle 28 is the record-holder for [ID-0067] fires-per-cycle.
      // Pin the exact 840 / 732 / 108 / 104 line numbers so a future
      // reword cannot soften the evidence into "around 800 lines".
      expect(doc).toMatch(/Cycle 28/)
      expect(doc).toMatch(/840/)
      expect(doc).toMatch(/732/)
      // The sibling 108-line file is the second failure in the same cycle
      // and its presence is what makes the 4-fire count credible.
      expect(doc).toMatch(/108/)
    })

    it('calls out that `Write` tool ALSO truncates, not just `Edit`', () => {
      const doc = loadEditWorkflow()
      // The doc originally framed [ID-0067] as Edit-only. Cycles 27 + 28
      // proved the Write tool shares the failure mode. Pin the reframe
      // so a future reword cannot revert to the "Edit-only" framing.
      expect(doc).toMatch(/`Write`/)
      expect(doc).toMatch(/sandbox write-path tools/i)
    })

    it('cites Cycle 32 (3-fire spike across post-process.ts + 3 sibling test files) as a size-uncorrelated proof', () => {
      const doc = loadEditWorkflow()
      // Cycle 32 is the second 3+-fire spike on record (after Cycle 28's
      // 4-fire). Pin the file names + the 124/148-line below-floor sizes
      // so a future reword cannot collapse the spike into a generic bullet.
      expect(doc).toMatch(/Cycle 32/)
      expect(doc).toMatch(/post-process\.ts/)
      expect(doc).toMatch(/post-process-end-program-invariants\.test\.ts/)
      // The 148- and 124-line below-floor truncations are the load-bearing
      // evidence that the failure mode is content-shaped, not size-shaped.
      expect(doc).toMatch(/148/)
      expect(doc).toMatch(/124/)
    })

    it('cites Cycle 34 (84-line runner-shims.ts mid-token truncation) as the smallest-size proof', () => {
      const doc = loadEditWorkflow()
      // Cycle 34 is the smallest size yet seen for an Edit-tool single-
      // region replace truncation. Pin the file name + the 84/77-line
      // delta + the lineNumberingSt mid-token landmark so a future reword
      // cannot soften the evidence into "around 100 lines".
      expect(doc).toMatch(/Cycle 34/)
      expect(doc).toMatch(/runner-shims\.ts/)
      expect(doc).toMatch(/84/)
      expect(doc).toMatch(/77/)
      expect(doc).toMatch(/lineNumberingSt/)
    })

    it('mandates Python-via-bash on the FIRST Edit attempt for files matching R1.5 content triggers (Cycle 35 escalation)', () => {
      const doc = loadEditWorkflow()
      // Cycle 35 escalation: R1.5 recognition on a multi-byte file does
      // NOT save the first Edit attempt. The rule must escalate to
      // mandatory Python-via-bash on the first attempt, not the second
      // retry. Pin the literal "Cycle 35 escalation" provenance and the
      // "FIRST" / "first" emphasis so a future reword cannot revert to
      // the second-retry-only framing.
      expect(doc).toMatch(/Cycle 35 escalation/)
      expect(doc).toMatch(/FIRST Edit attempt|first attempt/i)
    })

    it('cites Cycle 39 (two-files-in-a-single-cycle: ToastContext.tsx + ShopApp.tsx) as the SIXTH size-uncorrelated proof', () => {
      const doc = loadEditWorkflow()
      // Cycle 39 is the FIRST cycle on record where two distinct files
      // truncated in succession in a single cycle. Pin both file names,
      // both line-deltas, and both recovery strategies so a future
      // reword cannot collapse the spike into a generic "Cycle 39
      // truncated some files" bullet. The differential recovery
      // strategies (full Python-rewrite for WIP-only content;
      // [ID-0095]-gated HEAD-tail splice for HEAD-clean trailing
      // regions) are the load-bearing operational lesson and must
      // remain explicit.
      expect(doc).toMatch(/Cycle 39/)
      expect(doc).toMatch(/ToastContext\.tsx/)
      expect(doc).toMatch(/ShopApp\.tsx/)
      expect(doc).toMatch(/125/)
      expect(doc).toMatch(/1955/)
      expect(doc).toMatch(/two-files-in-a-single-cycle|two-files-in-one-cycle/)
      expect(doc).toMatch(/full Python-rewrite|full Python-via-bash rewrite/)
      expect(doc).toMatch(/HEAD-tail splice/)
    })

    it('updates the size-uncorrelated evidence chain to EIGHT cycles (22 / 24 / 27 / 28 / 34 / 39 / 50 / 55)', () => {
      const doc = loadEditWorkflow()
      // The evidence chain length is the headline data point for R1.5's
      // "content-shaped, not size-shaped" thesis. Pin the literal "EIGHT
      // cycles" count + the cycle list so a future reword cannot quietly
      // drop a cycle from the chain. Provenance: FIVE (22 / 24 / 27 / 28 /
      // 34) at Cycle 35 -> SIX after Cycle 39 added two-files-in-one ->
      // SEVEN after Cycle 50 added the 23-line vitest.config.ts (Cycle 53
      // [ID-0067-data-v7]) -> EIGHT after Cycle 55 added the 19-line
      // makera-carvera-3axis.json (Cycle 56 [ID-0067-data-v8]; supplants
      // Cycle 50's 23-line record by another order of magnitude AND is the
      // FIRST .json fire in the [ID-0067] ledger).
      expect(doc).toMatch(/EIGHT cycles \(22 \/ 24 \/ 27 \/ 28 \/ 34 \/ 39 \/ 50 \/ 55\)/)
    })

    it('records the [ID-0095] marker-uniqueness gate held both Cycle-39 splices', () => {
      const doc = loadEditWorkflow()
      // The [ID-0095] checklist's hard gate (`txt.count(marker) == 1`)
      // is what kept the Cycle 39 ShopApp.tsx HEAD-tail splice from
      // re-running the Cycle 19 (bonus) ambiguity failure. Pin the
      // call-out so a future reword cannot drop the audit trail.
      expect(doc).toMatch(/\[ID-0095\][^\n]*marker-uniqueness/i)
    })

    it('records the Cycles 40-46 seven-consecutive-workflow-prevented streak (added Cycle 44; extended Cycle 47 [ID-0067] data update)', () => {
      const doc = loadEditWorkflow()
      // Cycle 44 (docs-and-dx, 2026-04-25) was the first cycle to pin a
      // FOUR-in-a-row clean stretch since the [ID-0067] ledger opened
      // at Cycle 8. Cycle 47 (docs-and-dx, 2026-04-25) extends that
      // streak to SEVEN-in-a-row (Cycles 40 + 41 + 42 + 43 + 44 + 45 +
      // 46) by adding Cycles 44 + 45 + 46 as new workflow-prevented
      // datapoints (each wrote files via Python-via-bash from the
      // FIRST attempt; zero [ID-0067] fires). The streak is qualitative
      // evidence that R1 + R1.5 + Cycle-35 first-attempt escalation,
      // applied consistently from the FIRST attempt, prevents the
      // failure mode in practice. Pin BOTH the historical four-cycle
      // call-out (Cycle 44 audit trail still present in the audience
      // paragraph) AND the new seven-cycle extension so a future
      // reword cannot drop either segment of the evidence chain.
      expect(doc).toMatch(/Cycles 40 \+ 41 \+ 42 \+ 43/)
      expect(doc).toMatch(/Cycles 40 \+ 41 \+ 42 \+ 43 \+ 44 \+ 45 \+ 46/)
      expect(doc).toMatch(/workflow-prevented/i)
      expect(doc).toMatch(/four consecutive/i)
      expect(doc).toMatch(/seven consecutive|seven-in-a-row|SEVEN consecutive/)
    })

    it('keeps the cumulative [ID-0067] failure rate UNCHANGED at 22/23 across the workflow-prevented streak', () => {
      const doc = loadEditWorkflow()
      // The streak is denominator-only-eligible if a fire occurred --
      // since none did, neither numerator nor denominator move. Pin the
      // "UNCHANGED at 22/23" framing so a future reword cannot bump
      // the rate without empirical justification (i.e., a real fire).
      // This is the same accounting precedent set by Cycle 40's close
      // ("Cumulative rate UNCHANGED at 22/23; Cycle 40 contributes a
      // 'workflow-prevented' datapoint").
      expect(doc).toMatch(/UNCHANGED at \*?\*?22\/23/)
    })

    it('mentions Cycles 41-46 as the contributing workflow-prevented cycles (Cycle 47 extension)', () => {
      const doc = loadEditWorkflow()
      // Pin all six sibling-cycle citations + their slots so a future
      // reword cannot anonymise the streak. Cycle 41 = perf ([ID-0105]
      // + [ID-0107]); Cycle 42 = cam-engine ([ID-0010b]); Cycle 43 =
      // test-coverage ([ID-0109c]); Cycle 44 = docs-and-dx
      // ([ID-0067-data-v5] -- the four-in-a-row docs refresh that
      // CYCLE 47 EXTENDS); Cycle 45 = test-coverage ([ID-0109d]
      // integration-layer rotary 4-axis end-to-end against
      // carvera_4axis.hbs); Cycle 46 = perf ([ID-0090-refresh] inventory
      // refresh, all >500 ms tier files now empty).
      expect(doc).toMatch(/Cycle 41/)
      expect(doc).toMatch(/Cycle 42/)
      expect(doc).toMatch(/Cycle 43/)
      expect(doc).toMatch(/Cycle 44/)
      expect(doc).toMatch(/Cycle 45/)
      expect(doc).toMatch(/Cycle 46/)
      expect(doc).toMatch(/\[ID-0105\]/)
      expect(doc).toMatch(/\[ID-0010b\]/)
      expect(doc).toMatch(/\[ID-0109c\]/)
      expect(doc).toMatch(/\[ID-0067-data-v5\]/)
      expect(doc).toMatch(/\[ID-0109d\]/)
      expect(doc).toMatch(/\[ID-0090-refresh\]/)
    })

    it('records the seven-cycle workflow-prevented streak (Cycle 47 [ID-0067-data-v6] extension)', () => {
      const doc = loadEditWorkflow()
      // Cycle 47 (docs-and-dx, 2026-04-25) is the first cycle to pin a
      // SEVEN-in-a-row clean stretch since the [ID-0067] ledger opened
      // at Cycle 8. The previous record was four-in-a-row, set at
      // Cycle 44. The [ID-0067-data-v6] reference + the literal
      // 'seven' / 'SEVEN' framing are pinned so a future reword cannot
      // quietly soften the conclusion (e.g., into 'about a week's
      // worth' or similar) without empirical justification.
      expect(doc).toContain('[ID-0067-data-v6]')
      expect(doc).toMatch(/seven-in-a-row|seven consecutive|SEVEN consecutive/)
      expect(doc).toMatch(/previous record: four-in-a-row/)
    })

    it('keeps the cumulative [ID-0067] failure rate UNCHANGED at 22/23 across the seven-cycle streak', () => {
      const doc = loadEditWorkflow()
      // Same accounting precedent as Cycle 44's pin (line 425): the
      // streak is denominator-only-eligible if a fire occurred --
      // since none did across all SEVEN cycles, neither numerator
      // nor denominator move. Pin the 'UNCHANGED at 22/23' framing
      // explicitly tied to the seven-cycle streak so a future reword
      // cannot bump the rate without an empirical fire.
      expect(doc).toMatch(/UNCHANGED at \*?\*?22\/23 across the entire seven-cycle streak/)
    })

    it('extends the Rule 1.5 header provenance to include Cycle 47 + Cycle 53', () => {
      const doc = loadEditWorkflow()
      // The Rule 1.5 header carries the docs-and-dx authorship trail.
      // Cycle 47 + Cycle 53 must both be appended to that header line
      // (alongside Cycles 26 / 30 / 35 / 40 / 44) so the rule's
      // provenance is discoverable from the section header, not just the
      // body paragraphs. Cycle 53 records the [ID-0067-data-v7]
      // datapoint: streak END at Cycle 50 with ONE fire bumping the
      // cumulative rate 22/23 -> 23/24 + post-reset 2-in-a-row Cycles
      // 51 + 52 clean run.
      expect(doc).toMatch(/^## Rule 1\.5 .+Content-characteristic override.*Cycle 47/m)
      expect(doc).toMatch(/^## Rule 1\.5 .+Content-characteristic override.*Cycle 53/m)
    })

    it('records the [ID-0067-data-v7] reference (Cycle 53 docs-and-dx)', () => {
      const doc = loadEditWorkflow()
      // Cycle 53 (docs-and-dx, 2026-04-25) is the first cycle to record
      // [ID-0067-data-v7]: the streak grew to TEN-in-a-row through Cycle
      // 49, then ENDED at Cycle 50 with ONE fire that bumped the
      // cumulative rate 22/23 -> 23/24. The literal '[ID-0067-data-v7]'
      // reference is pinned so a future reword cannot quietly drop the
      // datapoint id.
      expect(doc).toContain('[ID-0067-data-v7]')
    })

    it('records the Cycle 50 fire-and-recover datapoint (vitest.config.ts 23 -> 13 lines)', () => {
      const doc = loadEditWorkflow()
      // Cycle 50 (ui-polish [ID-0072-followup], 2026-04-25) ENDED the
      // ten-in-a-row streak with ONE [ID-0067] fire on a 23-line
      // vitest.config.ts Edit-tool replace that silently truncated to 13
      // lines (entire trailing coverage block + closing })  lost). Pin
      // the file name + the 23/13-line delta + the 'fire-and-recover'
      // framing so a future reword cannot soften the evidence.
      expect(doc).toMatch(/Cycle 50/)
      expect(doc).toMatch(/vitest\.config\.ts/)
      expect(doc).toMatch(/23 -> 13/)
      expect(doc).toMatch(/fire-and-recover/)
    })

    it('updates the cumulative rate framing to 22/23 -> **23/24** at Cycle 50', () => {
      const doc = loadEditWorkflow()
      // The 22/23 -> 23/24 transition is the headline data point of the
      // Cycle 53 [ID-0067-data-v7] update. Pin the literal arrow + the
      // bolded **23/24** target so a future reword cannot bump the rate
      // without empirical justification.
      expect(doc).toMatch(/22\/23 -> \*\*23\/24\*\*|22\/23 to \*\*23\/24\*\*/)
    })

    it('records the ten-in-a-row pre-reset streak (Cycles 40-49) ENDED at Cycle 50', () => {
      const doc = loadEditWorkflow()
      // The streak narrative is: seven-in-a-row through Cycle 46 (Cycle
      // 47 pin); ten-in-a-row through Cycle 49 (Cycle 53 pin); ENDED at
      // Cycle 50 with one fire. Pin the TEN-in-a-row literal + the
      // ENDED-at-Cycle-50 framing so a future reword cannot quietly
      // shorten the pre-reset streak length.
      expect(doc).toMatch(/TEN-in-a-row/)
      expect(doc).toMatch(/ENDED at Cycle 50/)
    })

    it('records the post-reset 2-in-a-row clean run (Cycles 51 + 52)', () => {
      const doc = loadEditWorkflow()
      // After the Cycle 50 streak-end fire, the streak reset to 0;
      // Cycles 51 (test-coverage [ID-0148]) + 52 (perf [ID-0143]) opened
      // a new clean run with ZERO fires. Pin the cycle numbers + their
      // [ID-...] roadmap ids so a future reword cannot anonymise the
      // post-reset run.
      // Doc uses 'Cycles 51 + 52' plural form; allow both forms via \b boundary.
      expect(doc).toMatch(/Cycles? 51\b/)
      expect(doc).toMatch(/Cycles? 52\b|\+ 52\b/)
      expect(doc).toMatch(/\[ID-0148\]/)
      expect(doc).toMatch(/\[ID-0143\]/)
      expect(doc).toMatch(/Streak reset to 0|streak reset to 0/)
    })

    it('records Cycle 50 as the SEVENTH size-uncorrelated proof (smallest yet at 23 lines)', () => {
      const doc = loadEditWorkflow()
      // Cycle 50 is the smallest size yet observed for an [ID-0067]
      // truncation, supplanting Cycle 34's 84-line runner-shims.ts
      // record by an order of magnitude. The file contains zero
      // multi-byte UTF-8 separators and zero complex regex literals --
      // a finding that falsifies R1.5's working theory that content
      // shape alone predicts the failure mode. Pin the literal
      // 'SEVENTH' / 'smallest yet' framing + the 'order of magnitude'
      // comparison so a future reword cannot soften the conclusion.
      expect(doc).toMatch(/SEVENTH size-uncorrelated proof/)
      expect(doc).toMatch(/smallest yet/)
      expect(doc).toMatch(/order of magnitude/)
    })

    it('records that R1.5 content-shape thesis is necessary but not sufficient (Cycle 50 plain-ASCII proof)', () => {
      const doc = loadEditWorkflow()
      // Cycle 50's vitest.config.ts contains zero multi-byte UTF-8
      // separators and zero complex regex literals; the truncation
      // fired anyway on a single-line array-literal broaden. This is
      // the empirical proof that R1.5's content-shape thesis is
      // necessary but not sufficient -- size + content shape together
      // do not fully predict the failure mode. Pin the 'plain ASCII' +
      // 'necessary but not sufficient' framing so a future reword
      // cannot quietly revert to the content-shape-is-sufficient
      // framing.
      expect(doc).toMatch(/plain ASCII/)
      expect(doc).toMatch(/necessary but not sufficient/)
    })

    it('records the [ID-0067-data-v8] reference (Cycle 56 docs-and-dx)', () => {
      const doc = loadEditWorkflow()
      // Cycle 56 (docs-and-dx, 2026-04-25) is the first cycle to record
      // [ID-0067-data-v8]: the post-Cycle-50 streak grew to 4-in-a-row
      // through Cycles 51-54 (each ZERO fires), then ENDED at Cycle 55
      // with TWO fires bumping the cumulative rate 23/28 -> 25/30. The
      // literal '[ID-0067-data-v8]' reference is pinned so a future
      // reword cannot quietly drop the datapoint id.
      expect(doc).toContain('[ID-0067-data-v8]')
    })

    it('records the post-reset 4-in-a-row clean run (Cycles 51-54) ENDED at Cycle 55', () => {
      const doc = loadEditWorkflow()
      // After the Cycle 50 streak-end fire, the streak reset to 0;
      // Cycles 51 (test-coverage [ID-0148]) + 52 (perf [ID-0143]) +
      // 53 (docs-and-dx [ID-0149]) + 54 (perf [ID-0144]) opened a
      // 4-in-a-row clean run with ZERO fires before the streak ENDED
      // at Cycle 55 (post-processing [ID-0093] ATC scaffolding) with
      // TWO fires. Pin all four cycle numbers + their roadmap ids +
      // the streak-ended call-out so a future reword cannot anonymise
      // the post-reset run.
      expect(doc).toMatch(/Cycles? 51\b/)
      expect(doc).toMatch(/Cycle 52|\+ 52\b/)
      expect(doc).toMatch(/Cycle 53|\+ 53\b/)
      expect(doc).toMatch(/Cycle 54|\+ 54\b|and 54\b|51-54|Cycles 51-54/)
      expect(doc).toMatch(/Cycle 55/)
      expect(doc).toMatch(/four-in-a-row|four consecutive|4-in-a-row/i)
      // The streak end is the headline; pin the ENDED-at-Cycle-55 framing.
      expect(doc).toMatch(/ENDED at Cycle 55|ended at Cycle 55/)
    })

    it('records Cycle 55 as the EIGHTH size-uncorrelated proof (smallest yet at 19 lines)', () => {
      const doc = loadEditWorkflow()
      // Cycle 55's makera-carvera-3axis.json (19 lines) supplants Cycle
      // 50's 23-line vitest.config.ts as the smallest size at which an
      // [ID-0067] truncation has been observed. It is also the FIRST
      // .json file in the ledger -- prior fires were .ts / .tsx /
      // .test.ts / .hbs / .config.ts only. Pin all three framings:
      // 'EIGHTH', 'smallest yet', and 'FIRST .json' so a future reword
      // cannot soften the conclusion.
      expect(doc).toMatch(/EIGHTH size-uncorrelated proof/)
      expect(doc).toMatch(/smallest yet/)
      expect(doc).toMatch(/FIRST `?\.json/i)
      expect(doc).toMatch(/19[ -]?line/i)
    })

    it('records the Cycle 55 TWO-fires-in-one-cycle datapoint (machine-schema.ts + carvera-3axis.json)', () => {
      const doc = loadEditWorkflow()
      // Cycle 55 is the SECOND cycle on record (after Cycle 39) where
      // two distinct files truncated in succession in a single cycle.
      // Pin BOTH file names + their truncation deltas so a future
      // reword cannot drop either fire from the audit trail. Also pin
      // the operational-lesson framing reinforcing that there is no
      // truly safe size or content shape for the Edit tool.
      expect(doc).toMatch(/machine-schema\.ts/)
      expect(doc).toMatch(/makera-carvera-3axis\.json|carvera-3axis\.json/)
      expect(doc).toMatch(/242 -> 227|242 to 227/)
      expect(doc).toMatch(/cfsMultiColorEnabled/)
      // The JSON parse-error citation is what caught fire (b); pin it.
      expect(doc).toMatch(/char ~?411|character ~?411/)
    })

    it('updates the cumulative rate framing to 23/28 -> **25/30** at Cycle 55', () => {
      const doc = loadEditWorkflow()
      // The 23/28 -> 25/30 transition is the headline data point of the
      // Cycle 56 [ID-0067-data-v8] update. Pin the literal arrow + the
      // bolded **25/30** target so a future reword cannot bump the rate
      // without empirical justification.
      expect(doc).toMatch(/23\/28 -> \*\*25\/30\*\*|23\/28 to \*\*25\/30\*\*/)
    })

    it('extends the Rule 1.5 header provenance to include Cycle 56', () => {
      const doc = loadEditWorkflow()
      // The Rule 1.5 header carries the docs-and-dx authorship trail.
      // Cycle 56 must be appended to that header line (alongside Cycles
      // 26 / 30 / 35 / 40 / 44 / 47 / 53) so the rule's provenance is
      // discoverable from the section header, not just the body
      // paragraphs.
      expect(doc).toMatch(/^## Rule 1\.5 .+Content-characteristic override.*Cycle 56/m)
    })

    it('pins the FIRST .json fire framing as a new ledger landmark', () => {
      const doc = loadEditWorkflow()
      // Prior to Cycle 55, every [ID-0067] fire was on a TypeScript /
      // Handlebars / config.ts file. Cycle 55's makera-carvera-3axis.json
      // is the FIRST plain-data .json file to hit the failure mode. This
      // matters because it falsifies any "the bug is in the TS-aware
      // diff path" sub-thesis -- whatever the truncation mechanism is,
      // it is not specific to TypeScript / TSX. Pin the framing.
      expect(doc).toMatch(/FIRST `?\.json/i)
      // Either the doc cites the prior file-extension list or it cites
      // 'plain-data .json'. Allow either form.
      expect(doc).toMatch(/\.tsx?|\.test\.ts|\.hbs|\.config\.ts/)
    })

    it('mentions Cycle 56 alongside Cycle 53 in the Rule 1.5 docs-and-dx authorship trail', () => {
      const doc = loadEditWorkflow()
      // Cycle 56's [ID-0067-data-v8] update extends the docs-and-dx
      // authorship trail. The body paragraphs already cite Cycles 26,
      // 30, 35, 40, 44, 47, 53 -- Cycle 56 must now appear in either
      // the audience paragraph or the Rule 1.5 header.
      expect(doc).toMatch(/Cycle 56/)
      expect(doc).toMatch(/Cycle 53.*Cycle 56|Cycle 56.*Cycle 53|Cycle 26.*Cycle 56|Cycle 56.*Cycle 26|Cycle 56 \[ID-0067/s)
    })


    it('records the [ID-0067-data-v9] reference (Cycle 59 docs-and-dx)', () => {
      const doc = loadEditWorkflow()
      // Cycle 59 (docs-and-dx, 2026-04-25) is the first cycle to record
      // [ID-0067-data-v9]: the post-Cycle-55 streak reset fired self-
      // referentially at Cycle 56 with ONE [ID-0067] fire on this very
      // pin test file (720 -> 716 lines mid-pin-block). Cycles 57 + 58
      // then opened a 2-in-a-row post-Cycle-56-reset clean run. The
      // literal '[ID-0067-data-v9]' reference is pinned so a future
      // reword cannot quietly drop the datapoint id.
      expect(doc).toContain('[ID-0067-data-v9]')
    })

    it('records the Cycle 56 self-referential fire datapoint (edit-workflow-docs-pin.test.ts 720 -> 716 lines)', () => {
      const doc = loadEditWorkflow()
      // Cycle 56 is the FIRST self-referential fire in the [ID-0067]
      // ledger -- the file documenting the workflow truncated while
      // documenting the workflow's own truncation. The fire occurred
      // INSIDE the [ID-0067-data-v8] data-update cycle on a single-line
      // regex update at line 639 inside a test specifically guarding
      // the cumulative-rate framing. Pin the file name + the 720 -> 716
      // delta + the 'first self-referential' framing + the line-639
      // anchor so a future reword cannot soften the meta-recursive
      // landmark.
      expect(doc).toMatch(/Cycle 56/)
      expect(doc).toMatch(/edit-workflow-docs-pin\.test\.ts/)
      expect(doc).toMatch(/720 -> 716|720 to 716/)
      expect(doc).toMatch(/first self-referential|FIRST self-referential/i)
      expect(doc).toMatch(/line 639/)
    })

    it('records Cycle 56 as the NINTH size-uncorrelated proof (largest yet since Cycle 28)', () => {
      const doc = loadEditWorkflow()
      // Cycle 56's 720-line pin test file is the LARGEST size on record
      // for an Edit-tool truncation since Cycle 28's 840-line
      // post-process-snapshots.test.ts -- a useful reminder that the
      // failure mode never gets less likely on big multi-byte files.
      // The file contains every R1.5 multi-byte trigger (em-dash
      // U+2014, arrow U+2192, middle-dot U+00B7) by construction
      // across the existing pin assertions; the trigger recognition
      // did NOT save the FIRST Edit attempt. Pin the NINE-cycle chain
      // + the 'LARGEST size on record' framing + the Cycle-28
      // comparison so a future reword cannot drop either landmark.
      expect(doc).toMatch(/NINE cycles \(22 \/ 24 \/ 27 \/ 28 \/ 34 \/ 39 \/ 50 \/ 55 \/ 56\)/)
      expect(doc).toMatch(/LARGEST size on record|largest size on record/)
      expect(doc).toMatch(/840-line/)
      expect(doc).toMatch(/post-process-snapshots\.test\.ts/)
    })

    it('updates the cumulative rate framing to 25/30 -> **26/31** at Cycle 56', () => {
      const doc = loadEditWorkflow()
      // The 25/30 -> 26/31 transition is the headline data point of
      // the Cycle 59 [ID-0067-data-v9] update for Cycle 56's self-
      // referential fire. Pin the literal arrow + the bolded **26/31**
      // target so a future reword cannot bump the rate without
      // empirical justification.
      expect(doc).toMatch(/25\/30 -> \*\*26\/31\*\*|25\/30 to \*\*26\/31\*\*/)
    })

    it('updates the cumulative rate framing to 26/31 -> **26/33** across Cycles 57 + 58 clean run', () => {
      const doc = loadEditWorkflow()
      // The 26/31 -> 26/32 -> 26/33 chain is the denominator-only
      // accounting for Cycles 57 (test-coverage [ID-0151]) + 58 (cam-
      // engine [ID-0010d]) workflow-prevented datapoints. Pin the
      // bolded **26/33** final + the 26/32 intermediate + the
      // denominator-only framing so a future reword cannot quietly
      // bump numerator across clean cycles.
      expect(doc).toMatch(/26\/32/)
      expect(doc).toMatch(/\*\*26\/33\*\*/)
      expect(doc).toMatch(/denominator-only|denominator only/)
    })

    it('records the post-Cycle-56-reset 2-in-a-row clean run (Cycles 57 + 58)', () => {
      const doc = loadEditWorkflow()
      // After the Cycle 56 self-referential fire, the streak reset to
      // 0; Cycles 57 (test-coverage [ID-0151]) + 58 (cam-engine
      // [ID-0010d]) opened a new clean run with ZERO fires (each used
      // Python-via-bash from the FIRST attempt per the Cycle-50 +
      // Cycle-55 + Cycle-56 fire-and-recover discipline). Pin the
      // cycle numbers + their [ID-...] roadmap ids so a future reword
      // cannot anonymise the post-reset run.
      expect(doc).toMatch(/Cycle 57/)
      expect(doc).toMatch(/Cycle 58/)
      expect(doc).toMatch(/\[ID-0151\]/)
      expect(doc).toMatch(/\[ID-0010d\]/)
    })

    it('extends the Rule 1.5 header provenance to include Cycle 59 and Cycle 63', () => {
      const doc = loadEditWorkflow()
      // The Rule 1.5 header carries the docs-and-dx authorship trail.
      // Cycle 59 must be appended to that header line (alongside
      // Cycles 26 / 30 / 35 / 40 / 44 / 47 / 53 / 56) so the rule's
      // provenance is discoverable from the section header, not just
      // the body paragraphs. Cycle 63 [ID-0067-data-v10] absorbs the
      // post-Cycle-56-reset 6-in-a-row clean streak (Cycles 57-62) plus
      // two NEW data findings: Cycle 62 [ID-0067-write-variant] (Write
      // tool truncates a 6757-byte NEW file mid-word) and Cycle 61
      // [ID-0095] count==0 escape-semantics failure mode (Python raw-
      // string fix for `\u2014` literal preservation).
      expect(doc).toMatch(/^## Rule 1\.5 .+Content-characteristic override.*Cycle 59/m)
      expect(doc).toMatch(/^## Rule 1\.5 .+Content-characteristic override.*Cycle 63/m)
    })

    it('pins the meta-recursive framing as a new ledger landmark', () => {
      const doc = loadEditWorkflow()
      // Cycle 56's self-referential fire is meta-recursive: the file
      // documenting the workflow truncated while documenting the
      // workflow's own truncation, on a single-line regex update
      // inside a test specifically guarding the cumulative-rate
      // framing. Pin the 'meta-recursive' framing so a future reword
      // cannot soften the landmark into a generic single-fire bullet.
      expect(doc).toMatch(/meta-recursive/i)
    })

    it('keeps the 78.8% final-rate framing pinned at Cycle 59 close', () => {
      const doc = loadEditWorkflow()
      // The 78.8% rate at Cycle 59 close is the headline percentage
      // for the [ID-0067-data-v9] update. Pin the literal '78.8%' so a
      // future reword cannot quietly drift the headline figure
      // without empirical justification.
      expect(doc).toMatch(/78\.8%/)
      expect(doc).toMatch(/Cycles 8-58|Cycles 8\u201358|Cycles 8–58/)
    })

    it('records the [ID-0067-data-v10] reference (Cycle 63 docs-and-dx)', () => {
      const doc = loadEditWorkflow()
      // Cycle 63 (docs-and-dx, 2026-04-25) is the first cycle to record
      // [ID-0067-data-v10]: the post-Cycle-56-reset 6-in-a-row workflow-
      // prevented streak (Cycles 57 + 58 + 59 + 60 + 61 + 62) plus two
      // NEW data findings landed in Cycles 61 + 62. The literal
      // '[ID-0067-data-v10]' reference is pinned so a future reword
      // cannot quietly drop the datapoint id.
      expect(doc).toContain('[ID-0067-data-v10]')
    })

    it('records the post-Cycle-56-reset 6-in-a-row clean run (Cycles 57 through 62)', () => {
      const doc = loadEditWorkflow()
      // After the Cycle 56 self-referential fire, the streak reset to
      // 0; Cycles 57 (test-coverage [ID-0151]) + 58 (cam-engine
      // [ID-0010d]) + 59 (docs-and-dx [ID-0067-data-v9]) + 60
      // (post-processing [ID-0013-followup]) + 61 (ui-polish [ID-0152])
      // + 62 (perf [ID-0091] + bonus [ID-0152-followup]) opened a new
      // clean run with ZERO fires (each used Python-via-bash from the
      // FIRST attempt per the Cycle-50 + Cycle-55 + Cycle-56 fire-and-
      // recover discipline). This is the longest post-reset clean
      // stretch since the [ID-0067] ledger opened at Cycle 8. Pin the
      // 'SIX-in-a-row' framing + the inclusive cycle range + the
      // [ID-...] roadmap ids so a future reword cannot anonymise the
      // post-reset run.
      expect(doc).toMatch(/SIX-in-a-row|six-in-a-row|6-in-a-row|six consecutive/)
      expect(doc).toMatch(/Cycles 57[ -][^\n]{0,80}62/)
      expect(doc).toMatch(/Cycle 60/)
      expect(doc).toMatch(/Cycle 61/)
      expect(doc).toMatch(/Cycle 62/)
      expect(doc).toMatch(/\[ID-0013-followup\]/)
      expect(doc).toMatch(/\[ID-0152\]/)
      expect(doc).toMatch(/\[ID-0091\]|\[ID-0152-followup\]/)
    })

    it('updates the cumulative rate framing to 26/33 -> **26/37** at Cycle 62 close', () => {
      const doc = loadEditWorkflow()
      // The 26/33 -> 26/34 -> 26/35 -> 26/36 -> 26/37 chain is the
      // denominator-only accounting for Cycles 59 (docs-and-dx) + 60
      // (post-processing) + 61 (ui-polish) + 62 (perf) workflow-
      // prevented datapoints. Pin the bolded **26/37** final + the
      // 26/35 / 26/36 intermediates + the denominator-only framing so a
      // future reword cannot quietly bump numerator across clean cycles.
      expect(doc).toMatch(/26\/35/)
      expect(doc).toMatch(/26\/36/)
      expect(doc).toMatch(/\*\*26\/37\*\*/)
      // The 26/37 transition is also surfaced in the headline rate
      // table line (Why-this-doc-exists section): now "29 out of 53 cycles"
      // (post-Cycle-78). The provenance comment above stays at 26/37 to
      // preserve the Cycle 62 close arithmetic; only the headline asserter
      // bumps in lockstep with each docs-and-dx refresh.
      expect(doc).toMatch(/29 out of 53 cycles/)
    })

    it('records the [ID-0067-write-variant] datapoint (Cycle 62 Write-tool 6757-byte mid-word truncation)', () => {
      const doc = loadEditWorkflow()
      // Cycle 62 [ID-0091] perf + bonus [ID-0152-followup] surfaced a
      // NEW failure mode in the [ID-0067] family. The Write tool
      // silently truncated a 6757-byte NEW TypeScript test file
      // src/renderer/src/shop-app-toolbar-button-types.test.ts mid-word
      // at the literal 'if (!badge) ret' (line 156 of expected 159).
      // Re-running Write reproduced the same truncation; recovery used
      // a Python-via-bash replace() splice. This is the FIRST NEW-file
      // truncation in the ledger -- prior fires were on the Edit-tool
      // diff path against existing files OR on the Write-tool full-
      // file rewrite path on a file that had ALREADY been truncated
      // once this session (Cycles 27 + 28). Cycle 62's fire is on a
      // brand-new file with no prior session history. Pin the literal
      // '[ID-0067-write-variant]' id + the 6757-byte file size + the
      // mid-word truncation landmark + the new-file framing so a
      // future reword cannot collapse the finding into a generic
      // bullet.
      expect(doc).toContain('[ID-0067-write-variant]')
      expect(doc).toMatch(/6757[ -]?byte|6757 byte/)
      expect(doc).toMatch(/shop-app-toolbar-button-types\.test\.ts/)
      expect(doc).toMatch(/if \(!badge\) ret/)
      expect(doc).toMatch(/NEW[ -]file|new[ -]file|brand[ -]new file/i)
    })

    it('records the [ID-0095] count==0 escape-semantics failure mode (Cycle 61 \u2014 -> raw string fix)', () => {
      const doc = loadEditWorkflow()
      // Cycle 61 [ID-0152] hit a NEW [ID-0095] failure mode: the
      // marker-uniqueness gate `assert txt.count(old) == 1` failed
      // with count==0 (not the previously-documented count==2 anchor-
      // too-short failure). Diagnosed: Python's regular triple-quoted
      // string parses '\u2014' as the em-dash byte, but the on-disk
      // TypeScript file contained the LITERAL six-character escape
      // sequence '\u2014' (because the source was a JS template
      // literal with the JS escape, not a UTF-8 em-dash). Fixed by
      // switching the marker to a Python raw string. Pin the literal
      // '[ID-0095-data-v2]' id (or 'count==0 escape-semantics' framing)
      // + the raw-string fix + the Python<->TypeScript boundary
      // call-out so a future reword cannot collapse the new failure
      // mode into the existing count==2 bullet.
      expect(doc).toMatch(/\[ID-0095-data-v2\]|count==0 escape-semantics|count == 0/i)
      expect(doc).toMatch(/raw string|r"\.\.\."|`r"`/)
      expect(doc).toMatch(/Python.*TypeScript|TypeScript.*Python/i)
      expect(doc).toMatch(/\\u2014/)
    })

    it('extends the size-uncorrelated chain framing to capture the Write-tool sub-chain emergence', () => {
      const doc = loadEditWorkflow()
      // The size-uncorrelated chain remains at NINE Edit-tool cycles
      // (22 / 24 / 27 / 28 / 34 / 39 / 50 / 55 / 56) by Cycle 62; the
      // Write-tool [ID-0067-write-variant] is conceptually a separate
      // sub-ledger because it is a different write-path tool. Pin the
      // 'NINE cycles' Edit-tool chain framing AND the new 'Write-tool
      // sub-chain' / 'sub-ledger' framing so a future reword cannot
      // conflate the two ledgers.
      expect(doc).toMatch(/NINE cycles \(22 \/ 24 \/ 27 \/ 28 \/ 34 \/ 39 \/ 50 \/ 55 \/ 56\)/)
      expect(doc).toMatch(/Write-tool sub-chain|sub-ledger|Write-tool sub-ledger/i)
    })

    it('records the Cycle 63 escalation (Write-tool variant) in the Rule 1.5 mandatory-territory checklist', () => {
      const doc = loadEditWorkflow()
      // The Rule 1.5 mandatory-territory checklist now contains a
      // 'Cycle 63 escalation' bullet covering the Write-tool variant.
      // Pin the literal 'Cycle 63 escalation' provenance + the
      // 5 KB / template-literal / JSX-adjacent angle-bracket triggers
      // + the [ID-0067-write-variant] id so a future reword cannot
      // soften the new escalation into a generic bullet.
      expect(doc).toMatch(/Cycle 63 escalation/)
      expect(doc).toMatch(/Write-tool variant|Write-tool/i)
      expect(doc).toMatch(/5 ?KB|>5 ?KB|>?5 KB/)
      expect(doc).toMatch(/template-literal|template literal/)
    })

    it('records the Cycle 61 escalation (count==0 escape-semantics) in the Rule 2 splice-recovery checklist', () => {
      const doc = loadEditWorkflow()
      // Rule 2 (splice-recovery marker-uniqueness checklist) now
      // contains a 'Cycle 61 escalation' bullet documenting the new
      // count==0 escape-semantics failure mode. Pin the literal 'Cycle
      // 61 escalation' provenance + the [ID-0095-data-v2] id + the
      // raw-string fix call-out so a future reword cannot collapse
      // the new failure mode into the existing count==2 bullet.
      expect(doc).toMatch(/Cycle 61 escalation/)
      expect(doc).toMatch(/raw string/i)
    })

    it('records the [ID-0067-data-v11] reference (Cycle 72 docs-and-dx)', () => {
      const doc = loadEditWorkflow()
      // Cycle 72 (docs-and-dx, 2026-04-26) records [ID-0067-data-v11]:
      // the post-Cycle-62 calm proved to be streak-shaped, not a
      // permanent regime change. Cycles 63-66 were absorbed as
      // denominator-only setup; Cycle 67 fired ONE Edit-tool
      // truncation on a Carvera 3-axis paired-pin comment block;
      // Cycle 68 became the WORST CYCLE ON RECORD with 8 Edit + 1
      // Write truncations across 9 distinct files in a single
      // post-processing cycle; Cycles 69 + 70 + 71 then formed a
      // post-Cycle-68-reset workflow-prevented streak using
      // Python-via-bash from the FIRST attempt. Pin the literal
      // '[ID-0067-data-v11]' id so a future reword cannot drop the
      // explicit version stamp tying the data update to its cycle.
      expect(doc).toContain('[ID-0067-data-v11]')
    })

    it('updates the cumulative [ID-0067] failure rate to 28 of 46 cycles (Cycle 72 [ID-0067-data-v11] refresh)', () => {
      const doc = loadEditWorkflow()
      // Provenance carried forward from v10: 26/37 (Cycle 63 close,
      // post-Cycle-56-reset SIX-in-a-row clean stretch) -> 26/38
      // (Cycle 63 clean) -> 26/39 (Cycle 64 clean) -> 26/40 (Cycle
      // 65 clean) -> 26/41 (Cycle 66 clean) -> 27/42 (Cycle 67
      // [ID-0155] test-coverage paired-pin: ONE Edit-tool fire on a
      // long PAIRED-PIN comment block, recovered via [ID-0095]-gated
      // Python-via-bash splice) -> **28/43** (Cycle 68 [ID-0160]
      // post-processing Smoothieware dialect carve-out: NINE fires
      // in one cycle, absorbed as a single denominator increment +
      // numerator increment per the Cycle-32 multi-fire convention)
      // -> 28/44 (Cycle 69 cam-engine [ID-0158] clean) -> 28/45
      // (Cycle 70 test-coverage [ID-0154] clean) -> **28/46** (Cycle
      // 71 ui-polish [ID-0152-extended] clean). Pin the new
      // post-Cycle-71 number so it cannot drift backward.
      expect(doc).toMatch(/29 of 53 consecutive improvement cycles/)
      expect(doc).toMatch(/29 out of 53 cycles/)
    })

    it('records the post-Cycle-62 calm ENDING via Cycle 67 paired-pin Edit-tool fire ([ID-0067-data-v11])', () => {
      const doc = loadEditWorkflow()
      // Cycle 67 [ID-0155] (test-coverage Carvera 3-axis post-
      // contract paired-pin) added ONE Edit-tool fire on a long
      // PAIRED-PIN comment block -- the Edit silently truncated
      // mid-comment at line 409, losing the trailing block plus
      // the closing })) braces; recovered within-cycle via
      // [ID-0095]-gated Python-via-bash splice (anchor unique on
      // first try). Pin the literal Cycle 67 + [ID-0155] +
      // 'paired-pin' provenance so a future reword cannot strip
      // the cycle attribution that anchors the rate transition.
      expect(doc).toMatch(/Cycle 67/)
      expect(doc).toMatch(/\[ID-0155\]/)
      expect(doc).toMatch(/paired-pin|PAIRED-PIN/)
    })

    it('records Cycle 68 as the WORST CYCLE ON RECORD with 9 truncations across 9 distinct files ([ID-0067-data-v11])', () => {
      const doc = loadEditWorkflow()
      // Cycle 68 [ID-0160] (post-processing Smoothieware dialect
      // carve-out) is the WORST CYCLE ON RECORD: EIGHT Edit-tool
      // truncations + ONE Write-tool truncation across NINE
      // distinct files in a single cycle, beating Cycle 28's 4-fire
      // previous record by a factor of 2 and beating Cycle 32's
      // 3-fire spike by a factor of 3. Pin the literal
      // 'WORST CYCLE ON RECORD' framing + the EIGHT/NINE/9 fire
      // counts + at least two of the affected file basenames so a
      // future reword cannot soften the record-setting datapoint.
      expect(doc).toMatch(/WORST CYCLE ON RECORD/)
      expect(doc).toMatch(/\[ID-0160\]/)
      expect(doc).toMatch(/EIGHT.*Edit/i)
      expect(doc).toMatch(/NINE DISTINCT files|NINE distinct files|9 distinct files/i)
      expect(doc).toMatch(/gcode-dialect-compliance/)
      expect(doc).toMatch(/post-process-dialects/)
    })

    it('extends the size-uncorrelated evidence chain to ELEVEN cycles (22 / 24 / 27 / 28 / 34 / 39 / 50 / 55 / 56 / 67 / 68)', () => {
      const doc = loadEditWorkflow()
      // The size-uncorrelated chain grew from NINE cycles
      // (Cycle 59 [ID-0067-data-v9]) to ELEVEN cycles after Cycles
      // 67 + 68. Pin the literal 'ELEVEN cycles' phrase + the full
      // 11-cycle list so a future reword cannot drop a cycle from
      // the chain (the chain IS the evidence -- losing a cycle
      // erases a piece of the size-correlation falsification).
      expect(doc).toMatch(/ELEVEN cycles/)
      expect(doc).toMatch(/22 \/ 24 \/ 27 \/ 28 \/ 34 \/ 39 \/ 50 \/ 55 \/ 56 \/ 67 \/ 68/)
    })

    it('records the Cycles 69 + 70 + 71 workflow-prevented streak with Cycle 71 62-tag milestone ([ID-0067-data-v11])', () => {
      const doc = loadEditWorkflow()
      // Cycles 69 + 70 + 71 formed a THREE-in-a-row clean run after
      // the Cycle-68 reset, each using Python-via-bash from the
      // FIRST attempt per the Cycle-68 lesson. Cycle 71 set a NEW
      // operational milestone for clean Python-via-bash runs: a
      // SINGLE atomic patcher script touched 8 .tsx files and 62
      // <button opening tags in ONE pass with FOUR sanity gates.
      // Pin the streak framing + the 62-tag milestone + the four-
      // sanity-gate count so a future reword cannot collapse the
      // largest size-scale proof of the workflow scaling.
      expect(doc).toMatch(/Cycles 69 \+ 70 \+ 71|69 \+ 70 \+ 71/)
      expect(doc).toMatch(/62[ -]tag|62 `<button|62 button/)
      expect(doc).toMatch(/FOUR sanity gates|four sanity gates/i)
      expect(doc).toMatch(/\[ID-0152-extended\]/)
    })

    it('records the Cycle 68 escalation (worst-cycle-on-record ratification) in the Rule 1.5 mandatory-territory checklist', () => {
      const doc = loadEditWorkflow()
      // The Rule 1.5 mandatory-territory checklist now contains a
      // 'Cycle 68 escalation' bullet covering the worst-cycle-on-
      // record ratification of the always-Python-via-bash operational
      // rule. Pin the literal 'Cycle 68 escalation' provenance +
      // the [ID-0067-data-v11] id + the 'always Python-via-bash'
      // operational-rule call-out so a future reword cannot soften
      // the new escalation into a generic bullet.
      expect(doc).toMatch(/Cycle 68 escalation/)
      expect(doc).toMatch(/\[ID-0067-data-v11\]/)
      expect(doc).toMatch(/always Python-via-bash/i)
    })

    it('records the [ID-0067-data-v12] reference (Cycle 79 docs-and-dx)', () => {
      const doc = loadEditWorkflow()
      // Cycle 79 (docs-and-dx, 2026-04-26) records [ID-0067-data-v12]:
      // the post-Cycle-68 reset matured into a SIX-in-a-row workflow-
      // prevented streak (Cycles 69-74), tying the post-Cycle-56-reset
      // Cycles 57-62 record. The streak ENDED at Cycle 75 [ID-0153]
      // (perf, vitest worker-pool tuning) with ONE Edit-tool fire on
      // a 46-line `vitest.config.ts` single-line `pool: 'threads'`
      // insertion that silently truncated 46 -> 17 lines mid-comment.
      // Cycles 76 + 77 opened a clean 2-in-a-row post-Cycle-75 run,
      // then Cycle 78 [ID-0166] (cam-engine, kinematics.ts paired-pin)
      // ENDED that streak with ONE Edit-tool fire on a 376-line newly-
      // created test file (Edit-on-fresh-file pattern: written via
      // `Write` then mutated via `Edit`). Pin the literal
      // '[ID-0067-data-v12]' id so a future reword cannot drop the
      // explicit version stamp tying the data update to its cycle.
      expect(doc).toContain('[ID-0067-data-v12]')
    })

    it('updates the cumulative [ID-0067] failure rate to 29 of 53 cycles (Cycle 79 [ID-0067-data-v12] refresh)', () => {
      const doc = loadEditWorkflow()
      // Provenance carried forward from v11: 28/46 (Cycle 71 close,
      // post-Cycle-68-reset 3-in-a-row clean run) -> 28/47 (Cycle 72
      // [ID-0067-data-v11] docs-and-dx clean) -> 28/48 (Cycle 73
      // [ID-0159] cam-engine clean) -> 28/49 (Cycle 74 [ID-0163] ui-
      // polish clean) -> 28/50 (Cycle 75 [ID-0153] perf, ONE fire
      // absorbed as denominator-only per Cycle 33 [ID-0108b] tighter
      // accounting interpretation -- the recovery was instantaneous
      // and the file was fully reconstructed with no splice operation;
      // a future docs-and-dx cycle MAY revisit this convention) ->
      // 28/51 (Cycle 76 [ID-0164] test-coverage cam-axis4 emit-
      // contract clean) -> 28/52 (Cycle 77 [ID-0165] post-processing
      // sequenceMultiToolJob clean) -> **29/53** (Cycle 78 [ID-0166]
      // cam-engine kinematics.ts paired-pin: ONE Edit-tool fire on a
      // 376-line newly-created file, recovered via [ID-0095]-gated
      // Python-via-bash splice; both numerator AND denominator
      // increment per the Cycle 32 multi-fire convention). Pin the
      // new post-Cycle-78 number so it cannot drift backward.
      expect(doc).toMatch(/29 of 53 consecutive improvement cycles/)
      expect(doc).toMatch(/29 out of 53 cycles/)
    })

    it('records the Cycles 69-74 SIX-in-a-row workflow-prevented streak ([ID-0067-data-v12])', () => {
      const doc = loadEditWorkflow()
      // Cycles 69-74 formed a SIX-in-a-row clean Python-via-bash-from-
      // first-attempt streak after the Cycle-68 reset (Cycle 69
      // cam-engine [ID-0158], Cycle 70 test-coverage [ID-0154], Cycle
      // 71 ui-polish [ID-0152-extended] 62-tag atomic patch, Cycle 72
      // docs-and-dx [ID-0067-data-v11], Cycle 73 cam-engine [ID-0159],
      // Cycle 74 ui-polish [ID-0163]). This TIES the post-Cycle-56-
      // reset Cycles 57-62 record for longest workflow-prevented
      // streak. Pin the streak framing + the SIX-in-a-row count + the
      // tying-the-record framing so a future reword cannot collapse
      // the largest qualitative proof of the always-Python-via-bash
      // operational rule.
      expect(doc).toMatch(/SIX-in-a-row|six-in-a-row|6-in-a-row/i)
      expect(doc).toMatch(/Cycles 69-74|69 \+ 70 \+ 71 \+ 72 \+ 73 \+ 74|69-74/)
      expect(doc).toMatch(/tying the post-Cycle-56-reset|ties the post-Cycle-56-reset|tying the.*Cycles 57-62/i)
    })

    it('records the Cycle 75 fire on vitest.config.ts (46 -> 17 lines, [ID-0067-data-v12])', () => {
      const doc = loadEditWorkflow()
      // Cycle 75 [ID-0153] (perf, vitest worker-pool tuning) fired
      // ONE Edit-tool truncation on a 46-line `vitest.config.ts`
      // single-line `pool: 'threads'` insertion that silently
      // truncated 46 -> 17 lines mid-comment (`src/shared, 5+ s
      // prepare visible in vitest`). Detected immediately by esbuild
      // parse `Expected identifier but found end of file` at line 18
      // col 49 when the next vitest invocation tripped. Recovered
      // within-cycle via Python-via-bash full-file rewrite. This is
      // the SECOND fire on `vitest.config.ts` in the [ID-0067] ledger
      // (the first was Cycle 50's 23 -> 13 line fire); the file is a
      // small plain-ASCII config with zero multi-byte separators,
      // again proving R1.5's content-shape thesis is necessary but
      // not sufficient. Pin the file basename + the line-count delta
      // + the [ID-0153] roadmap id + the pool-threads provenance so
      // a future reword cannot soften the datapoint.
      expect(doc).toMatch(/\[ID-0153\]/)
      expect(doc).toMatch(/46[ -]line|46 -> 17|46 to 17/)
      expect(doc).toMatch(/vitest\.config\.ts/)
      expect(doc).toMatch(/pool: 'threads'|pool: \\"threads\\"|pool.*threads/i)
    })

    it('records the Cycle 78 fire on kinematics-contract.test.ts (Edit-on-fresh-file pattern, [ID-0067-data-v12])', () => {
      const doc = loadEditWorkflow()
      // Cycle 78 [ID-0166] (cam-engine, kinematics.ts paired-pin)
      // fired ONE Edit-tool truncation on a 376-line newly-created
      // `src/main/cam-axis4/__tests__/kinematics-contract.test.ts` --
      // the Edit replaced a 4-line `expect(KINEMATICS_SOURCE).
      // toContain(...)` block with a 4-line regex variant but
      // silently truncated at line 377 mid-line (cutoff `expe` mid-
      // token), losing the trailing `expect(...).toBe(false)` +
      // closing `})` braces. Caught instantly by vitest
      // `Transform failed: Unexpected end of file`. Recovered via
      // Python-via-bash splice with [ID-0095] marker-uniqueness gate
      // (anchor unique on first try). The fire occurred on a NEW
      // file that had been written via `Write` then mutated via
      // `Edit` -- the Edit-on-fresh-file pattern is the dominant
      // truncation mode in [ID-0067] history. Pin the file basename
      // + the [ID-0166] roadmap id + the Edit-on-fresh-file pattern
      // framing so a future reword cannot soften the operational
      // lesson.
      expect(doc).toMatch(/\[ID-0166\]/)
      expect(doc).toMatch(/376[ -]line|376-line|376 line/)
      expect(doc).toMatch(/kinematics-contract\.test\.ts/)
      expect(doc).toMatch(/Edit-on-fresh-file|Write.*Edit|fresh.*file/i)
    })

    it('extends the size-uncorrelated evidence chain to THIRTEEN cycles ([ID-0067-data-v12])', () => {
      const doc = loadEditWorkflow()
      // The size-uncorrelated chain grew from ELEVEN cycles
      // (Cycle 72 [ID-0067-data-v11]) to THIRTEEN cycles after Cycles
      // 75 + 78. The full 13-cycle list is the evidence -- losing a
      // cycle erases a piece of the size-correlation falsification.
      // Pin the literal 'THIRTEEN cycles' phrase + the full 13-cycle
      // list so a future reword cannot drop a cycle from the chain.
      expect(doc).toMatch(/THIRTEEN cycles/)
      expect(doc).toMatch(/22 \/ 24 \/ 27 \/ 28 \/ 34 \/ 39 \/ 50 \/ 55 \/ 56 \/ 67 \/ 68 \/ 75 \/ 78/)
    })

    it('records the Cycle 79 escalation (Edit-on-fresh-file pattern) in the Rule 1.5 mandatory-territory checklist', () => {
      const doc = loadEditWorkflow()
      // The Rule 1.5 mandatory-territory checklist now contains a
      // 'Cycle 79 escalation' bullet covering the Edit-on-fresh-file
      // pattern + the post-Cycle-68 streak data ratification of the
      // always-Python-via-bash operational rule. Pin the literal
      // 'Cycle 79 escalation' provenance + the [ID-0067-data-v12] id
      // + the 'Edit-on-fresh-file' pattern call-out + the 'Write +
      // Edit sequence' framing so a future reword cannot soften the
      // new escalation into a generic bullet.
      expect(doc).toMatch(/Cycle 79 escalation/)
      expect(doc).toMatch(/\[ID-0067-data-v12\]/)
      expect(doc).toMatch(/Edit-on-fresh-file/i)
      expect(doc).toMatch(/Write.*Edit|post-Write/i)
    })

    it('records the [ID-0067-data-v13] reference (Cycle 87 docs-and-dx)', () => {
      const doc = loadEditWorkflow()
      // Cycle 87 (docs-and-dx, 2026-04-26) records [ID-0067-data-v13]:
      // the post-Cycle-78 reset matured into the longest-on-record
      // clean Python-via-bash-from-first-attempt streak. Cycles 79-86
      // formed an EIGHT-in-a-row workflow-prevented run with ZERO
      // Edit-tool fires, BREAKING the prior post-Cycle-56-reset
      // Cycles 57-62 + post-Cycle-68 Cycles 69-74 SIX-in-a-row joint-
      // record by two cycles, and setting the new all-time longest
      // workflow-prevented streak since the [ID-0067] ledger opened
      // at Cycle 8. Pin the literal '[ID-0067-data-v13]' id so a
      // future reword cannot drop the explicit version stamp tying
      // the data update to its cycle.
      expect(doc).toContain('[ID-0067-data-v13]')
    })

    it('updates the cumulative [ID-0067] failure rate to 29 / 62 cycles (Cycle 87 [ID-0067-data-v13] refresh)', () => {
      const doc = loadEditWorkflow()
      // Provenance carried forward from v12: 29/53 (Cycle 78 close,
      // v12 baseline Cycles 8-78) -> 29/54 (Cycle 79 docs-and-dx
      // clean, denominator-only) -> 29/55 (Cycle 80 ui-polish clean)
      // -> 29/56 (Cycle 81 perf clean) -> 29/57 (Cycle 82 test-
      // coverage clean) -> 29/58 (Cycle 83 test-coverage clean; ONE
      // within-cycle [ID-0095] uniqueness-gated splice on the
      // existing pin test, NOT an Edit-tool truncation per the
      // [ID-0108b] tighter-accounting convention) -> 29/59 (Cycle 84
      // test-coverage clean) -> 29/60 (Cycle 85 post-processing
      // clean; arc-fitting 4-axis safety bypass landed via Python-
      // via-bash splice on the 823-line post-process.ts) -> 29/61
      // (Cycle 86 perf clean; carvera-pipeline.test.ts 1345-line
      // beforeAll hoist via Python-via-bash with [ID-0095] count==9
      // uniqueness gate) -> **29/62** (Cycle 87 [ID-0067-data-v13]
      // docs-and-dx clean denominator-only). Pin both '29/61'
      // (intermediate post-Cycle-86 number) and '29/62 (Cycles 8-87'
      // (final post-Cycle-87 number) so neither can drift backward.
      expect(doc).toContain('29/61')
      expect(doc).toContain('29/62')
      expect(doc).toMatch(/Cycles 8-87/)
      expect(doc).toMatch(/46\.8 ?%/)
    })

    it('records the Cycles 79-86 EIGHT-in-a-row workflow-prevented streak ([ID-0067-data-v13])', () => {
      const doc = loadEditWorkflow()
      // Cycles 79-86 formed an EIGHT-in-a-row clean Python-via-bash-
      // from-first-attempt streak after Cycle 78 [ID-0166] kinematics-
      // contract.test.ts Edit-on-fresh-file fire (Cycle 79 docs-and-dx
      // [ID-0067-data-v12], Cycle 80 ui-polish [ID-0167], Cycle 81
      // perf [ID-0168], Cycle 82 test-coverage [ID-0170], Cycle 83
      // test-coverage [ID-0171], Cycle 84 test-coverage [ID-0172],
      // Cycle 85 post-processing [ID-0173], Cycle 86 perf [ID-0169]).
      // This BREAKS the prior post-Cycle-56-reset Cycles 57-62 SIX-
      // in-a-row record AND the post-Cycle-68-reset Cycles 69-74
      // SIX-in-a-row tie by a margin of TWO cycles. Pin the streak
      // framing + the EIGHT-in-a-row count + the breaking-the-record
      // framing so a future reword cannot collapse the largest
      // qualitative proof of the always-Python-via-bash operational
      // rule.
      expect(doc).toMatch(/EIGHT-in-a-row|eight-in-a-row|8-in-a-row/i)
      expect(doc).toMatch(/Cycles 79-86|79 \+ 80 \+ 81 \+ 82 \+ 83 \+ 84 \+ 85 \+ 86/)
      expect(doc).toMatch(/BREAKING the prior|breaking the prior|new all-time longest/i)
    })

    it('records the Cycle 85 post-process.ts 823-line large-file Safety-Rule-1 fix INSIDE the streak ([ID-0067-data-v13])', () => {
      const doc = loadEditWorkflow()
      // Cycle 85 [ID-0173] (post-processing, applyArcFitting 4-axis
      // safety bypass) was a LARGE-FILE EDIT that closed cleanly via
      // Python-via-bash splice INSIDE the 8-in-a-row streak --
      // crucially, this same file (post-process.ts) previously
      // truncated under [ID-0067] in Cycle 32's 4-fire spike, so
      // the clean Cycle 85 close demonstrates the workflow handles
      // recurrence on previously-truncated large files. The
      // Cycle 85 fix also closed a real Safety Rule 1 violation
      // (the XY-plane-only arc-fitter was silently stripping A-axis
      // words from emitted G2/G3 segments on Carvera 4-axis jobs),
      // proving the rule chain does NOT trade off against substantive
      // engineering progress. Pin the [ID-0173] roadmap id + the
      // file basename + the 823-line size + the Safety Rule 1 framing
      // so a future reword cannot soften the operational lesson.
      expect(doc).toMatch(/\[ID-0173\]/)
      expect(doc).toMatch(/post-process\.ts/)
      expect(doc).toMatch(/823[ -]line|823-line|823 line/)
      expect(doc).toMatch(/Safety Rule 1|G-code is sacred|rotary.axis|A-axis word|applyArcFitting/i)
    })

    it('records the Cycle 86 carvera-pipeline.test.ts 1345-line beforeAll hoist INSIDE the streak ([ID-0067-data-v13])', () => {
      const doc = loadEditWorkflow()
      // Cycle 86 [ID-0169] (perf, carvera-pipeline.test.ts beforeAll
      // hoist of machine-profile load) was a LARGE-FILE EDIT that
      // closed cleanly via Python-via-bash splice INSIDE the 8-in-a-
      // row streak with a multi-occurrence [ID-0095] uniqueness gate
      // (count==9 on the inline 4-line read+parse block). The 1345-
      // line file size + the count==9 multi-replace pattern is the
      // largest combined hazard surface successfully closed inside
      // a single workflow-prevented streak in the [ID-0067] ledger
      // history. Pin the [ID-0169] roadmap id + the file basename +
      // the 1345-line size + the count==9 uniqueness-gate framing so
      // a future reword cannot soften the operational lesson.
      expect(doc).toMatch(/\[ID-0169\]/)
      expect(doc).toMatch(/carvera-pipeline\.test\.ts/)
      expect(doc).toMatch(/1345[ -]line|1345-line|1345 line/)
      expect(doc).toMatch(/count==9|count == 9/)
    })

    it('records the Cycle 87 escalation in the Rule 1.5 mandatory-territory checklist ([ID-0067-data-v13])', () => {
      const doc = loadEditWorkflow()
      // The Rule 1.5 mandatory-territory checklist now contains a
      // 'Cycle 87 escalation' bullet covering the post-Cycle-78 8-in-
      // a-row streak record + the diverse-rotation-slot ratification
      // of the always-Python-via-bash operational rule. Pin the
      // literal 'Cycle 87 escalation' provenance + the
      // [ID-0067-data-v13] id + the 8-in-a-row record framing + the
      // 'breaking the prior ... by two cycles' margin call-out so
      // a future reword cannot soften the new escalation into a
      // generic bullet.
      expect(doc).toMatch(/Cycle 87 escalation/)
      expect(doc).toMatch(/\[ID-0067-data-v13\]/)
      expect(doc).toMatch(/8-in-a-row streak record|EIGHT-in-a-row.*streak/i)
      expect(doc).toMatch(/by (a margin of |)two cycles|by two cycles/i)
    })

    it('records the [ID-0067-data-v13-followup] reference (Cycle 91 docs-and-dx)', () => {
      const doc = loadEditWorkflow()
      // Cycle 91 (docs-and-dx, 2026-04-26) records [ID-0067-data-v13-
      // followup]: the post-Cycle-78 reset extended further. Cycles
      // 87 + 88 + 89 + 90 added FOUR more clean cycles after the v13
      // 8-in-a-row close, advancing the streak from EIGHT-in-a-row to
      // TWELVE-in-a-row (Cycles 79-90) -- the new all-time longest
      // workflow-prevented streak since the [ID-0067] ledger opened
      // at Cycle 8, EXCEEDING the prior post-Cycle-78 8-in-a-row
      // record (set by Cycle 87 [ID-0067-data-v13]) by FOUR more
      // cycles. Pin the literal '[ID-0067-data-v13-followup]' id so
      // a future reword cannot drop the explicit version stamp tying
      // the data update to its cycle.
      expect(doc).toContain('[ID-0067-data-v13-followup]')
    })

    it('updates the cumulative [ID-0067] failure rate to 29 / 65 cycles (Cycle 91 [ID-0067-data-v13-followup] refresh)', () => {
      const doc = loadEditWorkflow()
      // Provenance carried forward from v13: 29/62 (Cycle 87 v13
      // close, Cycles 8-87 baseline) -> 29/63 (Cycle 88 cam-engine
      // [ID-0174] cam-runner-2d.ts paired-pin clean, denominator-
      // only) -> 29/64 (Cycle 89 ui-polish [ID-0175] renderer-wide
      // <svg> a11y pin clean) -> **29/65** (Cycle 90 post-processing
      // [ID-0176] applyCutterCompensation 4-axis rotary safety bypass
      // clean, denominator-only -- a SECOND consecutive large-file
      // edit on the same post-process.ts file as Cycle 85 INSIDE the
      // streak). Pin both '29/65' (final post-Cycle-90 number) and
      // '(Cycles 8-90' so neither can drift backward, and pin the
      // 44.6% rate as the new low watermark.
      expect(doc).toContain('29/65')
      expect(doc).toMatch(/Cycles 8-90/)
      expect(doc).toMatch(/44\.6 ?%/)
    })

    it('records the Cycles 79-90 TWELVE-in-a-row workflow-prevented streak ([ID-0067-data-v13-followup])', () => {
      const doc = loadEditWorkflow()
      // Cycles 79-90 form a TWELVE-in-a-row clean Python-via-bash-
      // from-first-attempt streak after Cycle 78 [ID-0166] kinematics-
      // contract.test.ts Edit-on-fresh-file fire. Streak composition:
      // Cycle 79 docs-and-dx [ID-0067-data-v12], Cycle 80 ui-polish
      // [ID-0167], Cycle 81 perf [ID-0168], Cycle 82 test-coverage
      // [ID-0170], Cycle 83 test-coverage [ID-0171], Cycle 84 test-
      // coverage [ID-0172], Cycle 85 post-processing [ID-0173], Cycle
      // 86 perf [ID-0169], Cycle 87 docs-and-dx [ID-0067-data-v13],
      // Cycle 88 cam-engine [ID-0174], Cycle 89 ui-polish [ID-0175],
      // Cycle 90 post-processing [ID-0176]. The 12-in-a-row streak
      // EXCEEDS the prior post-Cycle-78 8-in-a-row record (set by
      // Cycle 87 v13) by FOUR more cycles, EXCEEDS the prior post-
      // Cycle-56-reset Cycles 57-62 SIX-in-a-row record by SIX more
      // cycles, and EXCEEDS the post-Cycle-68-reset Cycles 69-74
      // SIX-in-a-row tie by SIX more cycles. Pin the streak framing
      // + the TWELVE-in-a-row count + the EXCEEDING/extending-the-
      // record framing so a future reword cannot collapse the largest
      // qualitative proof of the always-Python-via-bash operational
      // rule.
      expect(doc).toMatch(/TWELVE-in-a-row|twelve-in-a-row|12-in-a-row/i)
      expect(doc).toMatch(/Cycles 79-90/)
      expect(doc).toMatch(/EXCEEDING the prior|exceeding the prior|new all-time longest/i)
    })

    it('records the Cycle 88 cam-runner-2d paired-pin INSIDE the streak ([ID-0067-data-v13-followup])', () => {
      const doc = loadEditWorkflow()
      // Cycle 88 [ID-0174] (cam-engine, cam-runner-2d.ts paired-pin)
      // landed a NEW 424-line src/main/cam-runner-2d-contract.test.ts
      // pin file via Python-via-bash from FIRST attempt with `assert
      // not target.exists()` pre-write gate; one within-cycle TS2783
      // fix on the buildJob() helper was performed via Python-via-
      // bash str.replace splice (NOT Edit tool), preserving the
      // streak. Pin the [ID-0174] roadmap id + the cam-runner-2d.ts
      // file basename + the within-cycle TS2783 framing so a future
      // reword cannot soften the operational lesson.
      expect(doc).toMatch(/\[ID-0174\]/)
      expect(doc).toMatch(/cam-runner-2d/)
      expect(doc).toMatch(/buildJob|TS2783|within-cycle/i)
    })

    it('records the Cycle 89 LeftPanel.tsx <svg> a11y pin INSIDE the streak ([ID-0067-data-v13-followup])', () => {
      const doc = loadEditWorkflow()
      // Cycle 89 [ID-0175] (ui-polish, renderer-wide <svg>
      // accessibility pin) edited a 875-line LeftPanel.tsx via
      // Python-via-bash splice with [ID-0095] dual uniqueness gate +
      // wrote a NEW 304-line renderer-svg-accessibility.test.ts pin
      // file via Python-via-bash, completing the renderer-wide
      // defensive-attribute pin family at FIVE element classes.
      // Pin the [ID-0175] roadmap id + the LeftPanel.tsx file
      // basename + the 875-line size so a future reword cannot soften
      // the operational lesson.
      expect(doc).toMatch(/\[ID-0175\]/)
      expect(doc).toMatch(/LeftPanel\.tsx/)
      expect(doc).toMatch(/875[ -]line|875-line|875 line/)
    })

    it('records the Cycle 90 post-process.ts second large-file edit INSIDE the streak ([ID-0067-data-v13-followup])', () => {
      const doc = loadEditWorkflow()
      // Cycle 90 [ID-0176] (post-processing, applyCutterCompensation
      // 4-axis rotary safety bypass) was the SECOND consecutive
      // large-file edit INSIDE the 12-in-a-row streak on the SAME
      // post-process.ts file as Cycle 85 [ID-0173], 856 -> 885 lines
      // (+29 lines). It reused the same module-scoped
      // HAS_ROTARY_AXIS_WORD regex constant introduced in Cycle 85
      // with NO new regex, and closed a real Safety Rule 1 violation
      // (XY-plane-only cutter compensation insertion bracketing a
      // 4-axis rotary toolpath) inside the streak -- mirroring the
      // Cycle 85 arc-fitting fix. The two cycles together establish
      // post-process.ts as a SAFE TARGET for repeated mandatory-R1-
      // territory edits via Python-via-bash, contradicting the Cycle
      // 32 four-fire spike on the same file. Pin the [ID-0176]
      // roadmap id + the post-process.ts file basename + the 885-line
      // size + the applyCutterCompensation function name + the
      // repeat-mandatory-R1-territory framing.
      expect(doc).toMatch(/\[ID-0176\]/)
      expect(doc).toMatch(/post-process\.ts/)
      expect(doc).toMatch(/885[ -]line|885-line|885 line/)
      expect(doc).toMatch(/applyCutterCompensation/)
      expect(doc).toMatch(/repeat-mandatory-R1-territory|repeated mandatory-R1-territory|SAFE TARGET for repeated/i)
    })

    it('records the Cycle 91 escalation in the Rule 1.5 mandatory-territory checklist ([ID-0067-data-v13-followup])', () => {
      const doc = loadEditWorkflow()
      // The Rule 1.5 mandatory-territory checklist now contains a
      // 'Cycle 91 escalation' bullet covering the post-Cycle-78
      // 12-in-a-row streak record + the post-process.ts repeat-
      // mandatory-R1-territory precedent + the Cycles 85+90 shared-
      // HAS_ROTARY_AXIS_WORD regex reuse. Pin the literal 'Cycle 91
      // escalation' provenance + the [ID-0067-data-v13-followup] id
      // + the 12-in-a-row record framing + the 'repeat-mandatory-R1-
      // territory' precedent so a future reword cannot soften the
      // new escalation into a generic bullet.
      expect(doc).toMatch(/Cycle 91 escalation/)
      expect(doc).toMatch(/\[ID-0067-data-v13-followup\]/)
      expect(doc).toMatch(/12-in-a-row|TWELVE-in-a-row/i)
      expect(doc).toMatch(/post-process\.ts repeat-mandatory-R1-territory|repeat-mandatory-R1-territory precedent|repeated mandatory-R1-territory/i)
    })
  })

  describe('Rule 1.5 -- content-characteristic override [ID-0067-data-v14] Cycle 113 data update', () => {
    it('records the [ID-0067-data-v14] reference (Cycle 113 docs-and-dx)', () => {
      const doc = loadEditWorkflow()
      // Cycle 113 (chore [ID-0057] bonus pull, 2026-04-27) recorded
      // [ID-0067-data-v14]: TWO Edit-tool silent truncations on
      // sub-200-line files in a single hour, both well below R1's
      // 800-line table and not under `.claude/`. The fires are a
      // counter-data-point against the threshold-only safety zone
      // hypothesis. Pin the literal '[ID-0067-data-v14]' id so a
      // future reword cannot drop the provenance.
      expect(doc).toContain('[ID-0067-data-v14]')
    })

    it('updates the cumulative [ID-0067] failure rate to 35 / 82 cycles (Cycle 113 [ID-0067-data-v14] refresh)', () => {
      const doc = loadEditWorkflow()
      // Provenance: 33/82 mid-cycle (entering Cycle 113 bonus pull,
      // post-[ID-0063] primary clean) -> **35/82 (42.7 %, Cycles 8-
      // 113)** at end of Cycle 113 with the bonus pull's 2 fires.
      // Pin both '33/82' (mid-cycle baseline) and '35/82' (post-
      // bonus-pull final) and the '42.7 %' rate so a future reword
      // cannot soften the data point.
      expect(doc).toContain('33/82')
      expect(doc).toContain('35/82')
      expect(doc).toMatch(/42\.7\s*%/)
    })

    it('records both Cycle 113 sub-200-line files by basename (package.json + check-no-dump-stubs-gate.test.ts)', () => {
      const doc = loadEditWorkflow()
      // Both files truncated in the same Cycle 113 bonus pull. (a)
      // 97-line `package.json` truncated mid-line 92 dropping
      // fileAssociations + closing braces. (b) 149-line
      // `src/shared/check-no-dump-stubs-gate.test.ts` truncated 4
      // lines short, dropping the final two it() blocks. Pin both
      // basenames AND both line counts so a future reword cannot
      // swap one fire for a vaguer narrative.
      expect(doc).toMatch(/97[ -]line `package\.json`|97-line `package\.json`/)
      expect(doc).toMatch(/149[ -]line `src\/shared\/check-no-dump-stubs-gate\.test\.ts`|149-line `src\/shared\/check-no-dump-stubs-gate\.test\.ts`/)
    })

    it('records the diagnostic error messages that detected each Cycle 113 fire', () => {
      const doc = loadEditWorkflow()
      // Detection signals: (a) `EJSONPARSE: Unterminated string in
      // JSON at position 2598 (line 92 column 46)` for the
      // package.json fire; (b) esbuild `Expected identifier but
      // found end of file ... line 145:23` for the gate test fire.
      // Pinning the exact error-message phrases ensures the
      // narrative carries the diagnostic provenance forward; if a
      // future reword swaps these for handwave 'detected by next
      // run' phrasing, this it() block fires.
      expect(doc).toMatch(/EJSONPARSE.*Unterminated string in JSON|Unterminated string in JSON.*position 2598/)
      expect(doc).toMatch(/Expected identifier but found end of file/)
    })

    it('records the recovery patterns documented for each Cycle 113 fire', () => {
      const doc = loadEditWorkflow()
      // Two distinct recovery patterns cataloged: (i) Python-via-bash
      // `Path.write_text(content)` full-file rewrite for the
      // package.json fire (whole-file restoration); (ii) Python-via-
      // bash str.replace + tail-append for the gate test fire
      // (partial recovery from documented acceptance criteria). Pin
      // both pattern phrases so a future reword cannot collapse them
      // into a single generic 'recovered via Python-via-bash'
      // statement -- the patterns are operationally distinct.
      expect(doc).toMatch(/full-file rewrite|`Path\.write_text\(content\)`/)
      expect(doc).toMatch(/str\.replace \+ tail-append|tail-append rebuild/)
    })

    it('records the Cycle 113 escalation as a counter-data-point against the threshold-only safety zone hypothesis', () => {
      const doc = loadEditWorkflow()
      // The Cycle 113 escalation bullet's operational core: TWO
      // sub-200-line truncations PROVE the >800-line threshold is
      // not the real safety boundary. Pin the literal phrase
      // 'counter-data-point' (or close synonym) AND the literal
      // phrase 'threshold-only safety zone hypothesis' so a future
      // softening cannot reframe the lesson as 'small files are
      // also occasionally hazardous' (which loses the falsification
      // semantics).
      expect(doc).toMatch(/counter-data-point|counter[- ]example/i)
      expect(doc).toMatch(/threshold-only safety zone|threshold-only safety/i)
    })

    it('records that the Cycle 113 spike reset the streak to 0-in-a-row', () => {
      const doc = loadEditWorkflow()
      // Streak provenance: prior Cycles 111+112+[ID-0063]-primary
      // 3-in-a-row clean run reset to 0-in-a-row by Cycle 113's
      // bonus pull. Pin both the prior 3-in-a-row framing and the
      // streak-reset semantics so a future reword cannot soften the
      // streak-accounting honesty principle.
      expect(doc).toMatch(/streak resets to 0|streak reset to 0|0-in-a-row/i)
      expect(doc).toMatch(/3-in-a-row|three-in-a-row/i)
    })

    it('records the Cycle 113 escalation in the Rule 1.5 mandatory-territory checklist ([ID-0067-data-v14])', () => {
      const doc = loadEditWorkflow()
      // The Rule 1.5 mandatory-territory checklist now contains a
      // 'Cycle 113 escalation' bullet covering the sub-200-line
      // two-fire spike + the v14 cumulative rate update + the
      // counter-data-point framing. Pin the literal 'Cycle 113
      // escalation' provenance + the [ID-0067-data-v14] id +
      // 'sub-200-line two-fire spike' framing so a future reword
      // cannot soften the escalation into a generic bullet.
      expect(doc).toMatch(/Cycle 113 escalation/)
      expect(doc).toMatch(/\[ID-0067-data-v14\]/)
      expect(doc).toMatch(/sub-200-line two-fire spike|sub-200-line.*two-fire/i)
    })

    it('extends the Rule 1.5 header chain to include Cycle 113', () => {
      const doc = loadEditWorkflow()
      // The Rule 1.5 section header chain that lists every cycle
      // data-update must now end with 'Cycle 113'. Pin the literal
      // 'Cycle 91, Cycle 113, Cycle 128' adjacency (no other cycles between)
      // so a future reword that drops Cycle 113 / Cycle 128 from the header
      // chain or reorders it fires this it() block.
      expect(doc).toMatch(/Cycle 91, Cycle 113, Cycle 128, Cycle 133, Cycle 138, Cycle 141, Cycle 143, Cycle 148, Cycle 153, Cycle 158, Cycle 164, Cycle 169, Cycle 174, Cycle 179, Cycle 184, Cycle 189, Cycle 195, Cycle 200, Cycle 213, Cycle 218 \[ID-0067\] data update/)
    })
  })
  describe('Rule 1.5 -- content-characteristic override [ID-0067-data-v15] Cycle 128 data update', () => {
    it('records the [ID-0067-data-v15] reference (Cycle 128 docs-and-dx)', () => {
      const doc = loadEditWorkflow()
      // Cycle 128 (docs-and-dx, 2026-04-28) records [ID-0067-data-v15]:
      // refresh of `docs/EDIT-WORKFLOW.md` absorbing Cycles 114-127
      // chronology -- 3-clean / 2-fire / 9-clean / 1-fire pattern with
      // cumulative rate 35/82 -> 38/95 (40.0 %, Cycles 8-127). Pin the
      // literal '[ID-0067-data-v15]' id so a future reword cannot drop
      // the provenance.
      expect(doc).toContain('[ID-0067-data-v15]')
    })

    it('updates the cumulative [ID-0067] failure rate to 38 / 95 cycles (Cycle 128 [ID-0067-data-v15] refresh)', () => {
      const doc = loadEditWorkflow()
      // Provenance: 35/82 (Cycle 113 close) -> 35/85 (Cycles 114-116
      // clean, denominator-only) -> 37/86 (Cycle 117 TWO Edit-tool fires
      // on .hbs files, numerator +2 / denominator +1 per the Cycle 32
      // multi-fire convention) -> 37/94 (Cycles 118-126 nine-in-a-row
      // clean, denominator-only) -> 38/95 (Cycle 127 ONE Edit-tool fire
      // on a 622-line plain-ASCII test file, numerator +1 / denominator
      // +1). Pin '37/86', '37/94', '38/95', and the '40.0 %' rate so a
      // future reword cannot soften the data point or drop a midpoint.
      expect(doc).toContain('37/86')
      expect(doc).toContain('37/94')
      expect(doc).toContain('38/95')
      expect(doc).toMatch(/40\.0\s*%/)
    })

    it('records the Cycle 117 TWO-fire spike on sub-100-line Handlebars post-template files', () => {
      const doc = loadEditWorkflow()
      // Cycle 117 fires were on 68-line `carvera_3axis.hbs` and 67-line
      // `carvera_4axis.hbs`. Pin both basenames + both line counts so
      // a future reword cannot collapse the two distinct .hbs fires
      // into a vaguer 'two .hbs files' phrase.
      expect(doc).toMatch(/68[ -]line `?resources\/posts\/carvera_3axis\.hbs`?|`resources\/posts\/carvera_3axis\.hbs` 68-line/)
      expect(doc).toMatch(/67[ -]line `?resources\/posts\/carvera_4axis\.hbs`?|`resources\/posts\/carvera_4axis\.hbs` 67-line/)
    })

    it('records the Handlebars trigger #1 by-construction provenance for Cycle 117 fires', () => {
      const doc = loadEditWorkflow()
      // Both Cycle 117 .hbs files contain `{{#if}}` / `{{#each}}` blocks
      // per R1.5 trigger #1 (Handlebars override applied by construction).
      // The fires were on the FIRST Edit attempt despite the trigger
      // being active by construction -- this re-confirms the Cycle-35
      // first-attempt escalation rule. Pin both 'Handlebars' and
      // 'first-attempt' framings so the lesson cannot be softened.
      expect(doc).toMatch(/Handlebars/)
      expect(doc).toMatch(/Cycle-35 first-attempt escalation/)
    })

    it('records the Cycle 22 .hbs minimum cross-link (smallest .hbs fire on record)', () => {
      const doc = loadEditWorkflow()
      // The 67-line carvera_4axis.hbs is the SECOND-smallest .hbs fire
      // on record; Cycle 22's 30-line .hbs still holds the .hbs minimum.
      // Pin both the Cycle 22 cross-link and the 'first .hbs fires
      // since Cycle 22' framing so a future reword cannot drop the
      // 95-cycle inter-fire-gap framing on the Handlebars trigger.
      expect(doc).toMatch(/SECOND-smallest \.hbs|second-smallest \.hbs/i)
      expect(doc).toMatch(/FIRST \.hbs fires since Cycle 22|first \.hbs fires since Cycle 22/i)
    })

    it('records the Cycles 118-126 NINE-in-a-row workflow-prevented streak', () => {
      const doc = loadEditWorkflow()
      // The post-Cycle-117-reset 9-in-a-row clean run (Cycles 118-126)
      // is the joint-second-longest streak on record. Pin the literal
      // 'NINE-in-a-row' framing AND the explicit cycle range so a future
      // reword cannot soften it into 'several clean cycles'.
      expect(doc).toMatch(/NINE-in-a-row|nine-in-a-row|9-in-a-row/i)
      expect(doc).toMatch(/Cycles 118[ +-]+126|Cycle 118.*Cycle 126/)
    })

    it('records all 9 streak-cycle rotation slots by ID', () => {
      const doc = loadEditWorkflow()
      // Streak composition pins: Cycle 118 [ID-0193], Cycle 119
      // [ID-0196], Cycle 120 [ID-0197], Cycle 121 [ID-0198], Cycle 122
      // [ID-0199], Cycle 123 [ID-0200], Cycle 124 [ID-0201], Cycle 125
      // [ID-0202], Cycle 126 [ID-0203]. Pin the IDs so a future reword
      // cannot collapse the 9-cycle composition into a vaguer phrase.
      expect(doc).toContain('[ID-0193]')
      expect(doc).toContain('[ID-0196]')
      expect(doc).toContain('[ID-0197]')
      expect(doc).toContain('[ID-0198]')
      expect(doc).toContain('[ID-0199]')
      expect(doc).toContain('[ID-0200]')
      expect(doc).toContain('[ID-0201]')
      expect(doc).toContain('[ID-0202]')
      expect(doc).toContain('[ID-0203]')
    })

    it('records the Cycle 127 ONE-fire on the 622-line plain-ASCII test file', () => {
      const doc = loadEditWorkflow()
      // Cycle 127 fire: 3-line block-replace on the 622-line
      // `src/main/post-process-fdm-passthrough-contract.test.ts` plain-
      // ASCII test file silently truncated mid-comment at line 617
      // ('self-documentati'). Caught by vitest 'Transform failed:
      // Unexpected end of file'. Pin the file basename + the 622-line
      // count + the diagnostic phrase so a future reword cannot soften
      // the size-/content-uncorrelated provenance.
      expect(doc).toMatch(/622[ -]line/)
      expect(doc).toContain('post-process-fdm-passthrough-contract.test.ts')
      expect(doc).toMatch(/Transform failed: Unexpected end of file/)
    })

    it('records the Cycle 127 fire as a fresh size-/content-uncorrelated datapoint', () => {
      const doc = loadEditWorkflow()
      // The 622-line file is plain ASCII -- ZERO Unicode separators,
      // ZERO complex regex literals, ZERO array-literal broaden. This
      // is the textbook 'this should be safe' content shape; the fire
      // reproduces the [ID-0067-data-v8] thesis on a fresh sub-class.
      // Pin the 'plain ASCII' framing AND the 'sub-line block-replace'
      // sub-class label so the lesson cannot be softened.
      expect(doc).toMatch(/plain[ -]ASCII/i)
      expect(doc).toMatch(/sub-line block-replace|3-line block-replace/i)
    })

    it('records the Cycle 127 recovery via Python-via-bash str.replace + [ID-0095] uniqueness gate', () => {
      const doc = loadEditWorkflow()
      // Recovery pattern: Python-via-bash `str.replace` with
      // `count == 1` uniqueness gate per [ID-0095]. Pin both 'Python-
      // via-bash' and the [ID-0095] cross-link so the recovery
      // attribution cannot be lost.
      expect(doc).toMatch(/Python-via-bash/)
      expect(doc).toMatch(/\[ID-0095\]/)
    })

    it('records the size-uncorrelated chain extension to include Cycles 113, 117, and 127', () => {
      const doc = loadEditWorkflow()
      // The chain literal in the Cycle 128 escalation bullet enumerates
      // the full set: 22 / 24 / 27 / 28 / 34 / 39 / 50 / 55 / 56 / 67 /
      // 68 / 75 / 78 / 113 / 117 / 127. Pin the inclusion of the three
      // newest cycle numbers (113, 117, 127) so a future reword cannot
      // drop them from the chain.
      expect(doc).toMatch(/22 \/ 24 \/ 27 \/ 28 \/ 34 \/ 39 \/ 50 \/ 55 \/ 56 \/ 67 \/ 68 \/ 75 \/ 78 \/ 113 \/ 117 \/ 127/)
    })

    it('records the new sub-class label "sub-line block-replace on plain-ASCII test file" added at Cycle 128', () => {
      const doc = loadEditWorkflow()
      // The Cycle 128 escalation bullet adds a NEW sub-class label to
      // R1's mandatory-territory -- 'sub-line block-replace on plain-
      // ASCII test file' -- which joins the prior counter-data-point
      // labels ('array-literal broaden on plain ASCII' from Cycle 50,
      // 'JSON key-insertion' from Cycle 55, 'sub-200-line two-fire
      // spike' from Cycle 113) as size-uncorrelated falsifications of
      // the size-/content-shape safety zone hypothesis. Pin the new
      // sub-class label so a future reword cannot drop it.
      expect(doc).toMatch(/sub-line block-replace on plain-ASCII test file/)
    })

    it('records the Cycle 128 escalation in the Rule 1.5 mandatory-territory checklist ([ID-0067-data-v15])', () => {
      const doc = loadEditWorkflow()
      // The Rule 1.5 mandatory-territory checklist now contains a
      // 'Cycle 128 escalation' bullet covering the Cycles 114-127
      // chronology + the Cycle 117 .hbs two-fire spike + the Cycles
      // 118-126 nine-in-a-row streak + the Cycle 127 plain-ASCII
      // sub-line block-replace fire. Pin the literal 'Cycle 128
      // escalation' provenance + the [ID-0067-data-v15] id + the
      // '9-in-a-row clean streak record' framing so a future reword
      // cannot soften the escalation into a generic bullet.
      expect(doc).toMatch(/Cycle 128 escalation/)
      expect(doc).toMatch(/\[ID-0067-data-v15\]/)
      expect(doc).toMatch(/9-in-a-row clean streak record|nine-in-a-row clean streak record/i)
    })

    it('extends the Rule 1.5 header chain to include Cycle 128', () => {
      const doc = loadEditWorkflow()
      // The Rule 1.5 section header chain that lists every cycle
      // data-update must now end with 'Cycle 128'. Pin the literal
      // 'Cycle 113, Cycle 128' adjacency (no other cycles between)
      // so a future reword that drops Cycle 128 from the header
      // chain or reorders it fires this it() block.
      expect(doc).toMatch(/Cycle 113, Cycle 128, Cycle 133, Cycle 138, Cycle 141, Cycle 143, Cycle 148, Cycle 153, Cycle 158, Cycle 164, Cycle 169, Cycle 174, Cycle 179, Cycle 184, Cycle 189, Cycle 195, Cycle 200, Cycle 213, Cycle 218 \[ID-0067\] data update/)
    })
  })
  describe('Rule 1.5 -- content-characteristic override [ID-0067-data-v16] Cycle 133 data update', () => {
    it('records the [ID-0067-data-v16] reference (Cycle 133 docs-and-dx)', () => {
      const doc = loadEditWorkflow()
      // Cycle 133 (docs-and-dx, 2026-04-28) records [ID-0067-data-v16]:
      // refresh of `docs/EDIT-WORKFLOW.md` absorbing Cycles 128-132
      // chronology -- a FIVE-in-a-row workflow-prevented post-Cycle-127-
      // reset clean run that drives the cumulative failure rate below
      // 39 % for the FIRST time since the [ID-0067] ledger opened at
      // Cycle 8. Pin the literal '[ID-0067-data-v16]' id so a future
      // reword cannot drop the provenance.
      expect(doc).toContain('[ID-0067-data-v16]')
    })

    it('updates the cumulative [ID-0067] failure rate to 38 / 100 cycles (Cycle 133 [ID-0067-data-v16] refresh)', () => {
      const doc = loadEditWorkflow()
      // Pin the exact 38/100 fraction + 38.0 % rate framing so any
      // future drift in the cumulative rate must update this pin.
      // 38/100 is the new low watermark since the ledger opened.
      expect(doc).toMatch(/38\s*\/\s*100/)
      expect(doc).toMatch(/38\.0\s*%/)
      expect(doc).toMatch(/Cycles 8-132/)
    })

    it('records the post-Cycle-127-reset 5-in-a-row clean streak framing', () => {
      const doc = loadEditWorkflow()
      // The Cycle 133 escalation bullet must label the streak as
      // 5-in-a-row, identify it as a post-Cycle-127-reset run, and
      // identify it as the longest streak since Cycles 118-126.
      expect(doc).toMatch(/FIVE-in-a-row|5-in-a-row/)
      expect(doc).toMatch(/post-Cycle-127-reset/)
      expect(doc).toMatch(/longest streak since the Cycle 118-126/)
    })

    it('enumerates all five streak cycles (128 + 129 + 130 + 131 + 132)', () => {
      const doc = loadEditWorkflow()
      // Pin every constituent cycle id so a future reword cannot drop
      // any of them. Each cycle is named together with its rotation
      // slot + the ID it consumed.
      expect(doc).toMatch(/Cycle 128 \(docs-and-dx \[ID-0067-data-v15\]/)
      expect(doc).toMatch(/Cycle 129 \(ui-polish \[ID-0206\]/)
      expect(doc).toMatch(/Cycle 130 \(cam-engine \[ID-0207\]/)
      expect(doc).toMatch(/Cycle 131 \(test-coverage \[ID-0208\]/)
      expect(doc).toMatch(/Cycle 132 \(post-processing \[ID-0209\]/)
    })

    it('records the sub-39 % cumulative milestone framing', () => {
      const doc = loadEditWorkflow()
      // Pin the FIRST-time-below-39 % milestone so any future drift in
      // the cumulative rate framing must update this pin.
      expect(doc).toMatch(/Sub-39 % milestone|sub-39 % cumulative milestone/i)
      expect(doc).toMatch(/below 39 % for the FIRST time since the \[ID-0067\] ledger opened/)
      expect(doc).toMatch(/2\.0 percentage points/)
    })

    it('records the rotation-slot-coverage proof (5 distinct slots)', () => {
      const doc = loadEditWorkflow()
      // The Cycle 133 escalation explicitly enumerates the FIVE
      // distinct rotation slots covered by the streak so the always-
      // Python-via-bash rule is shown to scale across the rotation.
      expect(doc).toMatch(/FIVE distinct rotation slots/)
      expect(doc).toMatch(/docs-and-dx \+ ui-polish \+ cam-engine \+ test-coverage \+ post-processing/)
    })

    it('records the new-file paired-pin pattern as the dominant safe-mode', () => {
      const doc = loadEditWorkflow()
      // Pin the operational lesson that the new-file paired-pin pattern
      // (assert not target.exists() pre-write gate + Python-via-bash
      // Path.write_text + str.replace [ID-0095] gates for in-cycle
      // fixes) is now the dominant rotation-slot mode and the safest
      // workflow on record.
      expect(doc).toMatch(/new-file paired-pin pattern is now the dominant rotation-slot mode|new-file paired-pin pattern.*dominant/i)
      expect(doc).toMatch(/empirically the safest workflow on record/i)
    })

    it('records the Cycle 132 exhaustive-switch-arm-pin pattern as a high-leverage safe target', () => {
      const doc = loadEditWorkflow()
      // The Cycle 132 [ID-0209] post-process-dialects-pin.test.ts is
      // the FIRST exhaustive switch-arm pin in the [ID-0067] ledger.
      // Pin the framing so future docs-and-dx cycles see the pattern
      // recommendation.
      expect(doc).toMatch(/FIRST exhaustive switch-arm pin in the \[ID-0067\] ledger/)
      expect(doc).toMatch(/13 explicit dialect cases byte-equal/)
      expect(doc).toMatch(/RPM-band partition coverage proof/)
    })

    it('records the per-cycle test-count delta evidence (+293 vitest exact across the streak)', () => {
      const doc = loadEditWorkflow()
      // Each constituent cycle records its exact pre-/post- test count
      // delta. Sum: +14 (128) + 66 (129) + 50 (130) + 67 (131) + 107
      // (132) = +304. The bullet uses '+293' which is the sum
      // EXCLUDING the v15 in-pin-file +14 (since v15 was an extension
      // of an EXISTING test file, not a new file). The four NEW-file
      // cycles contributed +66 + +50 + +67 + +107 = +290 vitest exact
      // across +4 new test files. Pin the per-cycle pre/post counts
      // so a future drift surfaces here AND in the Cycle 132 close-out
      // pin.
      expect(doc).toMatch(/pre 5342\/1\/234 -> post 5356\/1\/234/)
      expect(doc).toMatch(/pre 5356\/1\/234 -> post 5422\/1\/235/)
      expect(doc).toMatch(/pre 5422\/1\/235 -> post 5472\/1\/236/)
      expect(doc).toMatch(/pre 5472\/1\/236 -> post 5539\/1\/237/)
      expect(doc).toMatch(/pre 5539\/1\/237 -> post 5646\/1\/238/)
    })

    it('records the in-cycle assertion-fix breakdown (Python-via-bash str.replace, ZERO Edit-tool fires)', () => {
      const doc = loadEditWorkflow()
      // Pin the explicit per-cycle in-cycle-fix counts (0/3/3/1/1) and
      // the framing that EVERY in-cycle fix used Python-via-bash
      // str.replace with [ID-0095] count==1 uniqueness gates -- ZERO
      // Edit-tool fires across all five cycles. This is the
      // empirical proof that the always-Python-via-bash rule held
      // through the streak.
      expect(doc).toMatch(/Cycle 128 had 0/)
      expect(doc).toMatch(/Cycle 129 had 3/)
      expect(doc).toMatch(/Cycle 130 had 3/)
      expect(doc).toMatch(/Cycle 131 had 1 type-only tsc fix \(NOT \[ID-0067\]\)/)
      expect(doc).toMatch(/Cycle 132 had 1 \(`units: 'G21'`/)
      expect(doc).toMatch(/ZERO Edit-tool fires across all five cycles/)
    })

    it('records that the size-uncorrelated chain stays at 16 distinct cycles (clean-by-construction)', () => {
      const doc = loadEditWorkflow()
      // The size-uncorrelated chain only grows when an Edit-tool fire
      // adds a new size-uncorrelated landmark. The five-cycle Cycle
      // 128-132 streak was clean by construction, so the chain stays
      // at 16. Pin so a future reword doesn't accidentally claim a
      // chain extension.
      expect(doc).toMatch(/16 distinct cycles/)
      expect(doc).toMatch(/22 \/ 24 \/ 27 \/ 28 \/ 34 \/ 39 \/ 50 \/ 55 \/ 56 \/ 67 \/ 68 \/ 75 \/ 78 \/ 113 \/ 117 \/ 127/)
      expect(doc).toMatch(/clean by construction/)
    })

    it('records the Cycle 133 escalation in the Rule 1.5 mandatory-territory checklist ([ID-0067-data-v16])', () => {
      const doc = loadEditWorkflow()
      // The Rule 1.5 mandatory-territory checklist now contains a
      // 'Cycle 133 escalation' bullet covering the Cycles 128-132
      // chronology + the sub-39 % milestone + the 5-in-a-row streak
      // framing. Pin the literal 'Cycle 133 escalation' provenance +
      // the [ID-0067-data-v16] id + the 'sub-39 % cumulative
      // milestone' framing so a future reword cannot soften the
      // escalation into a generic bullet.
      expect(doc).toMatch(/Cycle 133 escalation/)
      expect(doc).toMatch(/\[ID-0067-data-v16\]/)
      expect(doc).toMatch(/sub-39 % cumulative milestone/i)
    })

    it('extends the Rule 1.5 header chain to include Cycle 133', () => {
      const doc = loadEditWorkflow()
      // The Rule 1.5 section header chain that lists every cycle
      // data-update must now end with 'Cycle 133'. Pin the literal
      // 'Cycle 128, Cycle 133' adjacency (no other cycles between)
      // so a future reword that drops Cycle 133 from the header
      // chain or reorders it fires this it() block.
      expect(doc).toMatch(/Cycle 128, Cycle 133, Cycle 138, Cycle 141, Cycle 143, Cycle 148, Cycle 153, Cycle 158, Cycle 164, Cycle 169, Cycle 174, Cycle 179, Cycle 184, Cycle 189, Cycle 195, Cycle 200, Cycle 213, Cycle 218 \[ID-0067\] data update/)
    })
  })

  describe('Rule 1.5 -- content-characteristic override [ID-0067-data-v17] Cycle 138 data update', () => {
    it('records the [ID-0067-data-v17] reference (Cycle 138 docs-and-dx)', () => {
      const doc = loadEditWorkflow()
      // Cycle 138 (docs-and-dx, 2026-04-28) records [ID-0067-data-v17]:
      // refresh of `docs/EDIT-WORKFLOW.md` absorbing Cycles 133-137
      // chronology -- a five-cycle continuation of the post-Cycle-127-
      // reset clean run that brings the combined streak to TEN-in-a-row
      // (Cycles 128-137), the joint-second-longest streak on record.
      // Pin the literal '[ID-0067-data-v17]' id so a future reword
      // cannot drop the provenance.
      expect(doc).toContain('[ID-0067-data-v17]')
    })

    it('updates the cumulative [ID-0067] failure rate to 38 / 105 cycles (Cycle 138 [ID-0067-data-v17] refresh)', () => {
      const doc = loadEditWorkflow()
      // Pin the exact 38/105 fraction + 36.2 % rate framing so any
      // future drift in the cumulative rate must update this pin.
      // 38/105 is the new low watermark since the ledger opened.
      expect(doc).toMatch(/38\s*\/\s*105/)
      expect(doc).toMatch(/36\.2\s*%/)
      expect(doc).toMatch(/Cycles 8-137/)
    })

    it('records the post-Cycle-127-reset 10-in-a-row clean streak framing', () => {
      const doc = loadEditWorkflow()
      // The Cycle 138 escalation bullet must label the streak as
      // 10-in-a-row, identify it as a post-Cycle-127-reset run, and
      // identify it as the joint-second-longest streak on record.
      expect(doc).toMatch(/TEN-in-a-row|10-in-a-row/)
      expect(doc).toMatch(/post-Cycle-127-reset/)
      expect(doc).toMatch(/joint-second-longest streak on record/)
    })

    it('enumerates all five new streak cycles (133 + 134 + 135 + 136 + 137)', () => {
      const doc = loadEditWorkflow()
      // Pin every constituent cycle id so a future reword cannot drop
      // any of them. Each cycle is named together with its rotation
      // slot + the ID it consumed.
      expect(doc).toMatch(/Cycle 133 \(docs-and-dx \[ID-0067-data-v16\]/)
      expect(doc).toMatch(/Cycle 134 \(ui-polish \[ID-0210\]/)
      expect(doc).toMatch(/Cycle 135 \(cam-engine \[ID-0211\]/)
      expect(doc).toMatch(/Cycle 136 \(test-coverage \[ID-0212\]/)
      expect(doc).toMatch(/Cycle 137 \(post-processing \[ID-0213\]/)
    })

    it('records the sub-36 % cumulative milestone framing', () => {
      const doc = loadEditWorkflow()
      // Pin the new sub-36 % milestone so any future drift in the
      // cumulative rate framing must update this pin.
      expect(doc).toMatch(/Sub-36 % milestone|sub-36 % cumulative milestone/i)
      expect(doc).toMatch(/1\.8 percentage points/)
      expect(doc).toMatch(/approaching the 36 % floor for the first time/)
    })

    it('records the all-time-record-context framing (joint-second to Cycles 79-90 12-in-a-row)', () => {
      const doc = loadEditWorkflow()
      // The Cycle 138 escalation explicitly anchors against the all-
      // time-record 12-in-a-row Cycles 79-90 streak as the still-
      // standing benchmark. Pin so a future reword cannot drop the
      // anchor.
      expect(doc).toMatch(/Cycle 79-90 TWELVE-in-a-row \[ID-0067-data-v13-followup\] streak still holds the all-time record/)
    })

    it('records the post-domain facade pinning precedent at Cycle 137 [ID-0213]', () => {
      const doc = loadEditWorkflow()
      // Pin the operational lesson that Cycle 137's [ID-0213] paired-
      // pin is the FIRST telemetry-stage-label paired-pin in the
      // [ID-0067] ledger -- the canonical 'cam.post_render' literal
      // pinned via mock-spy assertions + source-text-whitelist.
      expect(doc).toMatch(/FIRST telemetry-stage-label paired-pin in the \[ID-0067\] ledger/)
      expect(doc).toMatch(/canonical [`']+cam\.post_render[`']+ literal/)
      expect(doc).toMatch(/16-key opts pass-through invariance/)
    })

    it('records the four-NEW-paired-pin-files framing across Cycles 134-137', () => {
      const doc = loadEditWorkflow()
      // Pin the explicit FOUR new files framing so a future reword
      // cannot drop the count. Each new pin file's line count is
      // anchored on the per-cycle text counts in the test below.
      expect(doc).toMatch(/FOUR new co-located paired-pin files/)
      expect(doc).toMatch(/480\/562\/408\/~520 lines/)
    })

    it('records the per-cycle test-count delta evidence across Cycles 133-137', () => {
      const doc = loadEditWorkflow()
      // Each constituent cycle records its exact pre-/post- test count
      // delta. Pin the per-cycle pre/post counts so a future drift
      // surfaces here AND in each cycle's close-out pin.
      expect(doc).toMatch(/pre 5646\/1\/238 -> post 5659\/1\/238/)
      expect(doc).toMatch(/pre 5659\/1\/238 -> post 5719\/1\/239/)
      expect(doc).toMatch(/pre 5719\/1\/239 -> post 5784\/1\/240/)
      expect(doc).toMatch(/pre 5784\/1\/240 -> post 5849\/1\/241/)
      expect(doc).toMatch(/pre 5849\/1\/241 -> post 5915\/1\/242/)
    })

    it('records the in-cycle assertion-fix breakdown across Cycles 133-137 (ZERO Edit-tool fires)', () => {
      const doc = loadEditWorkflow()
      // Pin the explicit per-cycle in-cycle-fix counts (0/0/2/2/0) and
      // the framing that EVERY in-cycle fix used Python-via-bash
      // str.replace with [ID-0095] count==1 uniqueness gates -- ZERO
      // Edit-tool fires across all five cycles.
      expect(doc).toMatch(/Cycle 133 had 0/)
      expect(doc).toMatch(/Cycle 134 had 0 \(FIRST first-run-clean cycle since Cycle 128\)/)
      expect(doc).toMatch(/Cycle 135 had 2/)
      expect(doc).toMatch(/Cycle 136 had 2/)
      expect(doc).toMatch(/Cycle 137 had 0 \(FIRST first-run-clean cycle since Cycle 134\)/)
      expect(doc).toMatch(/ZERO Edit-tool fires across all five cycles/)
    })

    it('records that the size-uncorrelated chain stays at 16 distinct cycles (clean-by-construction)', () => {
      const doc = loadEditWorkflow()
      // The size-uncorrelated chain only grows when an Edit-tool fire
      // adds a new size-uncorrelated landmark. The five-cycle Cycle
      // 133-137 streak was clean by construction, so the chain stays
      // at 16. Pin so a future reword does not accidentally claim a
      // chain extension.
      expect(doc).toMatch(/16 distinct cycles \(22 \/ 24 \/ 27 \/ 28 \/ 34 \/ 39 \/ 50 \/ 55 \/ 56 \/ 67 \/ 68 \/ 75 \/ 78 \/ 113 \/ 117 \/ 127\) at v17 close/)
      expect(doc).toMatch(/clean by construction/)
    })

    it('records the Cycle 138 escalation in the Rule 1.5 mandatory-territory checklist ([ID-0067-data-v17])', () => {
      const doc = loadEditWorkflow()
      // The Rule 1.5 mandatory-territory checklist now contains a
      // 'Cycle 138 escalation' bullet covering the Cycles 133-137
      // chronology + the sub-36 % milestone + the 10-in-a-row streak
      // framing + the post-domain facade pinning precedent. Pin the
      // literal 'Cycle 138 escalation' provenance + the
      // [ID-0067-data-v17] id + the 'sub-36 % cumulative milestone'
      // framing so a future reword cannot soften the escalation.
      expect(doc).toMatch(/Cycle 138 escalation/)
      expect(doc).toMatch(/\[ID-0067-data-v17\]/)
      expect(doc).toMatch(/sub-36 % cumulative milestone/i)
      expect(doc).toMatch(/post-domain facade paired-pin precedent/)
    })

    it('extends the Rule 1.5 header chain to include Cycle 138', () => {
      const doc = loadEditWorkflow()
      // The Rule 1.5 section header chain that lists every cycle
      // data-update must now end with 'Cycle 138'. Pin the literal
      // 'Cycle 133, Cycle 138' adjacency (no other cycles between)
      // so a future reword that drops Cycle 138 from the header
      // chain or reorders it fires this it() block.
      expect(doc).toMatch(/Cycle 133, Cycle 138, Cycle 141, Cycle 143, Cycle 148, Cycle 153, Cycle 158, Cycle 164, Cycle 169, Cycle 174, Cycle 179, Cycle 184, Cycle 189, Cycle 195, Cycle 200, Cycle 213, Cycle 218 \[ID-0067\] data update/)
    })
  })
  describe('Rule 1.5 -- content-characteristic override [ID-0067-data-v18] Cycle 141 data update', () => {
    it('records the [ID-0067-data-v18] reference (Cycle 141 docs-and-dx)', () => {
      const doc = loadEditWorkflow()
      // Cycle 141 (docs-and-dx, 2026-04-28) records [ID-0067-data-v18]:
      // refresh of `docs/EDIT-WORKFLOW.md` Rule 1.5 ledger absorbing
      // Cycles 138-140 chronology -- Cycle 138 docs-and-dx clean, Cycle
      // 139 cam-engine [ID-0214] laguna-vacuum-allocator-ui paired-pin
      // with Write-tool truncation NEW SUB-CLASS at byte 42031 / line
      // 1046 on a first-pass NEW 1054-line file (TYING the all-time-
      // record 12-in-a-row streak at Cycle 139), Cycle 140 ui-polish
      // [ID-0215] setup-sheet paired-pin with EDIT-TOOL MID-CYCLE
      // truncation on a file that crossed the 800-line R1 threshold
      // mid-cycle (R1.5 violation by the assistant; BREAKING the joint-
      // all-time-record 12-in-a-row streak). Pin the literal
      // '[ID-0067-data-v18]' id so a future reword cannot drop the
      // provenance.
      expect(doc).toContain('[ID-0067-data-v18]')
    })

    it('updates the cumulative [ID-0067] failure rate to 39 / 108 cycles (Cycle 141 [ID-0067-data-v18] refresh)', () => {
      const doc = loadEditWorkflow()
      // Provenance: 38/105 (Cycle 137 close) -> 38/106 (Cycle 138
      // docs-and-dx clean denominator-only) -> 38/107 (Cycle 139
      // [ID-0067-write-variant] Write-tool fire absorbed as denominator-
      // only per the Cycle 62 Write-tool sub-ledger convention) ->
      // 39/108 (Cycle 140 Edit-tool fire numerator +1 / denominator +1
      // per Cycle 33 [ID-0108b] convention; Cycle 141 docs-and-dx clean
      // denominator-only). Final rate at Cycle 141 close: 39/108 =
      // 36.1 % (Cycles 8-141). Pin both the new 39/108 framing AND the
      // 36.1 % rate so a future reword cannot drift either number.
      expect(doc).toContain('39/108')
      expect(doc).toContain('36.1 %')
    })

    it('records the post-Cycle-127-reset 12-in-a-row clean streak that TIED the all-time record at Cycle 139', () => {
      const doc = loadEditWorkflow()
      // The Cycle 141 escalation bullet must label the Cycles 128-139
      // streak as 12-in-a-row AND TYING the all-time-record from
      // Cycles 79-90. Pin the explicit 'TYING the all-time-record
      // 12-in-a-row from Cycles 79-90' framing so a future reword that
      // drops the joint-record context fires this it() block.
      expect(doc).toMatch(/12-in-a-row \(Cycles 128-139\), TYING the all-time-record 12-in-a-row from Cycles 79-90/)
    })

    it('records the streak-break framing at Cycle 140 (joint-all-time-record BROKEN by R1.5 violation)', () => {
      const doc = loadEditWorkflow()
      // The Cycle 141 escalation bullet must label Cycle 140 as
      // BREAKING the joint-all-time-record 12-in-a-row streak with a
      // STRICT R1.5 VIOLATION BY THE ASSISTANT. Pin the explicit
      // 'STRICT R1.5 VIOLATION BY THE ASSISTANT' framing so a future
      // reword that softens the accountability framing fires this
      // it() block.
      expect(doc).toContain('STRICT R1.5 VIOLATION BY THE ASSISTANT')
      expect(doc).toMatch(/BROKE the joint-all-time-record 12-in-a-row streak/)
    })

    it('records the NEW Write-tool first-pass NEW-file >40 KB / >1000-line truncation sub-class (Cycle 139)', () => {
      const doc = loadEditWorkflow()
      // The Cycle 141 escalation bullet must explicitly label the Cycle
      // 139 fire as a NEW [ID-0067] sub-class distinct from Cycle 62's
      // [ID-0067-write-variant] (6757-byte / line 156 mid-word
      // truncation). Pin the explicit 'NEW [ID-0067] sub-class' framing
      // AND the byte 42031 + line 1046 + 1054-line context AND the
      // distinguishing-from-Cycle-62 reference so a future reword that
      // collapses the new sub-class into the existing Cycle 62 datapoint
      // fires this it() block.
      expect(doc).toMatch(/NEW \[ID-0067\] sub-class/)
      expect(doc).toContain('byte 42031')
      expect(doc).toContain('line 1046')
      expect(doc).toContain('1054-line')
      expect(doc).toContain('Cycle 62')
    })

    it('records the NEW Edit-tool MID-CYCLE truncation on file that crossed the 800-line threshold mid-cycle (Cycle 140)', () => {
      const doc = loadEditWorkflow()
      // The Cycle 141 escalation bullet must explicitly label the Cycle
      // 140 fire as an in-cycle file-growth case where the prior 3
      // Edits worked because the file was sub-800 lines AT the time of
      // each call, but the 4th Edit fired AFTER the file crossed the
      // 800-line R1 threshold. Pin the explicit '925 lines pre-
      // truncation' detail AND the 'sub-800 lines AT the time of each
      // call' attribution AND the 8-line trailing drop so a future
      // reword that loses the operational specifics fires this
      // it() block.
      expect(doc).toContain('925 lines pre-truncation')
      expect(doc).toContain('sub-800 lines AT the time of each call')
      expect(doc).toMatch(/SILENTLY DROPPED the trailing 8 lines/)
    })

    it('records the NEW operational rule for mid-cycle wc -l rechecks before each Edit', () => {
      const doc = loadEditWorkflow()
      // The Cycle 141 escalation bullet must include the NEW operational
      // rule: re-check `wc -l` BEFORE each Edit during a cycle that's
      // adding lines, switch to Python-via-bash str.replace the moment
      // the file crosses the 800-line threshold mid-cycle. This rule
      // extends the Cycle-35 first-attempt escalation to the mid-cycle
      // file-growth case. Pin the literal 'NEW operational rule' marker
      // AND the 're-check `wc -l`' detail AND the explicit Cycle-35
      // cross-link so a future reword that drops the operational
      // specifics fires this it() block.
      expect(doc).toContain('NEW operational rule')
      expect(doc).toContain('re-check `wc -l`')
      expect(doc).toContain('Cycle-35 first-attempt escalation rule')
    })

    it('extends the size-uncorrelated chain to 18 distinct cycles (adds 139 + 140)', () => {
      const doc = loadEditWorkflow()
      // The Cycle 141 escalation bullet must record the size-uncorrelated
      // chain extension from 16 to 18 distinct cycles (adding 139 + 140
      // to the existing 22/24/27/28/34/39/50/55/56/67/68/75/78/113/117/
      // 127 chain). Pin the literal '18 distinct cycles' framing AND
      // the full chain enumeration so a future reword that drops the
      // chain-length update fires this it() block.
      expect(doc).toContain('18 distinct cycles')
      expect(doc).toContain('22 / 24 / 27 / 28 / 34 / 39 / 50 / 55 / 56 / 67 / 68 / 75 / 78 / 113 / 117 / 127 / 139 / 140')
    })

    it('records the FIRST mid-cycle-threshold-crossing fire framing (Cycle 140 vs prior always-above-800 / always-below-800 fires)', () => {
      const doc = loadEditWorkflow()
      // The Cycle 141 escalation bullet must label Cycle 140 as the
      // FIRST mid-cycle-threshold-crossing fire in the ledger -- prior
      // fires were either always-above-800 or always-below-800 from
      // cycle start. Pin the literal 'FIRST mid-cycle-threshold-
      // crossing fire' framing so a future reword that drops the
      // historical-first-of-its-kind context fires this it() block.
      expect(doc).toMatch(/FIRST mid-cycle-threshold-crossing fire in the ledger/)
    })

    it('records the per-cycle test-count delta evidence across Cycles 138-141 (+189 vitest exact)', () => {
      const doc = loadEditWorkflow()
      // The Cycle 141 escalation bullet must record the +189 vitest
      // delta context (Cycle 138 +13, Cycle 139 +111, Cycle 140 +65;
      // 13 + 111 + 65 = 189). Pin the literal '+189 vitest' framing
      // AND the 'streak-and-recovery sequence' phrasing so a future
      // reword that drops the substantive-engineering-progress framing
      // fires this it() block.
      expect(doc).toContain('+189 vitest')
      expect(doc).toContain('streak-and-recovery sequence')
    })

    it('records the FIRST cross-cuts-ALL-three-target-machines pin framing (Cycle 140 setup-sheet)', () => {
      const doc = loadEditWorkflow()
      // The Cycle 141 escalation bullet must record that Cycle 140's
      // setup-sheet paired-pin is the FIRST pin file in the [ID-0067]
      // ledger that cross-cuts ALL three target machines in a single
      // file (K2 Plus FDM + Laguna Swift 3-axis + Carvera 4-axis
      // rotary). Pin the explicit three-machine cross-cut framing so a
      // future reword that drops the all-three-machines context fires
      // this it() block.
      expect(doc).toContain('K2 Plus FDM + Laguna Swift 3-axis + Carvera 4-axis rotary')
    })

    it('records that the [ID-0095] uniqueness checklist held across BOTH Cycle 139 and Cycle 140 splice recoveries', () => {
      const doc = loadEditWorkflow()
      // The Cycle 141 escalation bullet must label the [ID-0095]
      // marker-uniqueness checklist as 100 % clean across all 18
      // size-uncorrelated cycles -- both Cycle 139 and Cycle 140
      // splices were count==1 on first try. Pin the literal '100 %
      // clean' framing AND the 'count==1 on first try in both cases'
      // detail so a future reword that drops the splice-recovery
      // sub-ledger framing fires this it() block.
      expect(doc).toContain('100 % clean across all 18 size-uncorrelated cycles')
      expect(doc).toContain('count==1 on first try in both cases')
    })

    it('records the joint-all-time-record fragility framing (single mid-cycle threshold-crossing slips by 1 fire)', () => {
      const doc = loadEditWorkflow()
      // The Cycle 141 escalation bullet must label the all-time record
      // as both REACHABLE (proven twice now -- Cycles 79-90 + 128-139)
      // and FRAGILE (single mid-cycle threshold-crossing Edit slips the
      // streak). Pin both the 'reachable' AND 'FRAGILE' framing so a
      // future reword that drops either side of the duality fires
      // this it() block.
      expect(doc).toContain('FRAGILE')
      expect(doc).toMatch(/all-time-record IS reachable/)
    })

    it('records the Cycle 141 escalation bullet provenance in the Rule 1.5 mandatory-territory checklist ([ID-0067-data-v18])', () => {
      const doc = loadEditWorkflow()
      // The Rule 1.5 mandatory-territory checklist must contain a
      // 'Cycle 141 escalation' bullet covering the Cycles 138-140
      // chronology + the [ID-0067-data-v18] surface. Pin both the
      // literal 'Cycle 141 escalation' provenance + the
      // [ID-0067-data-v18] id + the 'sub-36 % cumulative milestone'
      // framing absent (because Cycle 141 ticks the cumulative rate
      // BACK ABOVE 36 % to 36.1 %, ending the sub-36 % run from Cycle
      // 138's 36.2 % watermark). Pin all three substring anchors.
      expect(doc).toMatch(/Cycle 141 escalation/)
      expect(doc).toMatch(/\[ID-0067-data-v18\]/)
      expect(doc).toContain('36.1 %')
    })

    it('extends the Rule 1.5 header chain to include Cycle 141', () => {
      const doc = loadEditWorkflow()
      // The Rule 1.5 section header chain that lists every cycle
      // data-update must now end with 'Cycle 141'. Pin the literal
      // 'Cycle 138, Cycle 141' adjacency (no other cycles between)
      // so a future reword that drops Cycle 141 from the header
      // chain or reorders it fires this it() block.
      expect(doc).toMatch(/Cycle 138, Cycle 141, Cycle 143, Cycle 148, Cycle 153, Cycle 158, Cycle 164, Cycle 169, Cycle 174, Cycle 179, Cycle 184, Cycle 189, Cycle 195, Cycle 200, Cycle 213, Cycle 218 \[ID-0067\] data update/)
    })
  })
  describe('Rule 1.5 -- content-characteristic override [ID-0067-data-v19] Cycle 143 data update', () => {
    it('records the [ID-0067-data-v19] reference (Cycle 143 docs-and-dx)', () => {
      const doc = loadEditWorkflow()
      // Cycle 143 (docs-and-dx, 2026-04-28) records [ID-0067-data-v19]:
      // refresh of `docs/EDIT-WORKFLOW.md` Rule 1.5 ledger absorbing
      // Cycles 141-142 chronology -- Cycle 141 docs-and-dx clean
      // (1-in-a-row post-Cycle-140-reset open), Cycle 142 post-processing
      // [ID-0216] cam-domain.ts paired-pin with NEW Edit-tool sub-class
      // truncation on a 670-line / 29013-byte NEW test file. Pin the
      // literal '[ID-0067-data-v19]' id so a future reword cannot drop
      // the provenance.
      expect(doc).toContain('[ID-0067-data-v19]')
    })

    it('updates the cumulative [ID-0067] failure rate to 40 / 110 cycles (Cycle 143 [ID-0067-data-v19] refresh)', () => {
      const doc = loadEditWorkflow()
      // Provenance: 39/108 (Cycle 141 close, 36.1 %) -> 40/109 (Cycle
      // 142 fire absorbed as numerator +1 / denominator +1 per Cycle 33
      // [ID-0108b] convention; 36.7 % rate, Cycles 8-142) -> 40/110
      // (Cycle 143 docs-and-dx clean denominator-only; 36.4 % rate,
      // Cycles 8-143). Pin both the new 40/110 framing AND the 36.4 %
      // rate so a future reword cannot drift either number.
      expect(doc).toContain('40/110')
      expect(doc).toContain('36.4 %')
    })

    it('records the intermediate 40/109 (36.7 %) Cycle 142 close rate', () => {
      const doc = loadEditWorkflow()
      // The intermediate rate at Cycle 142 close (BEFORE this Cycle 143
      // refresh applies its denominator-only increment) must be visible
      // in the bullet so the trajectory framing is auditable. Pin both
      // '40/109' AND '36.7 %' so a future reword that collapses the
      // intermediate datapoint into the final 40/110 rate fires this
      // it() block.
      expect(doc).toContain('40/109')
      expect(doc).toContain('36.7 %')
    })

    it('records the NEW Edit-tool sub-class on multi-line block-replace at sub-800-line NEW test file (Cycle 142)', () => {
      const doc = loadEditWorkflow()
      // The Cycle 143 escalation bullet must explicitly label the Cycle
      // 142 fire as a NEW [ID-0067] Edit-tool sub-class distinct from
      // Cycle 139's Write-tool first-pass NEW-file >40 KB / >1000-line
      // sub-class AND distinct from Cycle 140's Edit-tool MID-CYCLE
      // truncation on file that crossed the 800-line threshold mid-cycle
      // sub-class. Pin both the explicit 'NEW [ID-0067] Edit-tool
      // sub-class' framing AND the multi-line block-replace context AND
      // the sub-800-line NEW test file qualifier so a future reword
      // that collapses the new sub-class into Cycle 139 / Cycle 140
      // fires this it() block.
      expect(doc).toMatch(/NEW \[ID-0067\] Edit-tool sub-class/)
      expect(doc).toContain('multi-line block-replace')
      expect(doc).toContain('sub-800-line NEW test file')
    })

    it('records the 670-line / 29013-byte / line 677 TS1005 detection context', () => {
      const doc = loadEditWorkflow()
      // The Cycle 143 escalation bullet must record the full forensic
      // context of the Cycle 142 fire: 670 lines / 29013 bytes file
      // size, the trailing-7-line drop, and the `TS1005: '}' expected.`
      // detection at line 677 (one past the truncated 676-line file).
      // Pin the byte size + line count + TS error code + line 677 so a
      // future reword that drops the operational specifics fires this
      // it() block.
      expect(doc).toContain('670-line / 29013-byte')
      expect(doc).toContain('TS1005')
      expect(doc).toContain('line 677')
      expect(doc).toMatch(/trailing 7 lines/)
    })

    it('records the threshold revision from ~800 lines to ~670 lines for multi-line block-replace Edits on NEW test files', () => {
      const doc = loadEditWorkflow()
      // The Cycle 143 escalation bullet must explicitly label the
      // empirically-observed truncation threshold for multi-line
      // block-replace Edit-tool calls on NEW test files as lowered from
      // ~800 lines to ~670 lines. Pin the explicit '~800 lines to ~670
      // lines' threshold revision framing AND the 'multi-line
      // block-replace' qualifier so a future reword that drops the
      // material threshold update fires this it() block.
      expect(doc).toContain('~800 lines to ~670 lines')
      expect(doc).toContain('multi-line block-replace')
    })

    it('extends the size-uncorrelated chain to 19 distinct cycles (adds 142)', () => {
      const doc = loadEditWorkflow()
      // The Cycle 143 escalation bullet must record the size-uncorrelated
      // chain extension from 18 to 19 distinct cycles (adding 142 to the
      // existing 22/24/27/28/34/39/50/55/56/67/68/75/78/113/117/127/139/
      // 140 chain). Pin the literal '19 distinct cycles' framing AND
      // the full chain enumeration so a future reword that drops the
      // chain-length update fires this it() block.
      expect(doc).toContain('19 distinct cycles')
      expect(doc).toContain('22 / 24 / 27 / 28 / 34 / 39 / 50 / 55 / 56 / 67 / 68 / 75 / 78 / 113 / 117 / 127 / 139 / 140 / 142')
    })

    it('records the SMALLEST-documented-file-size-fire framing (Cycle 142 in the post-Cycle-127 chain)', () => {
      const doc = loadEditWorkflow()
      // The Cycle 143 escalation bullet must label Cycle 142 as the
      // SMALLEST documented file-size fire in the post-Cycle-127 chain
      // AND the FIRST sub-800-line multi-line block-replace fire on a
      // NEW test file in the [ID-0067] ledger. Pin the literal 'SMALLEST
      // documented file-size fire' framing AND the 'FIRST sub-800-line
      // multi-line block-replace fire on a NEW test file' first-of-its-
      // kind context so a future reword that drops either historical
      // landmark fires this it() block.
      expect(doc).toContain('SMALLEST documented file-size fire in the post-Cycle-127 chain')
      expect(doc).toContain('FIRST sub-800-line multi-line block-replace fire on a NEW test file')
    })

    it('records the SECOND telemetry-stage-label paired-pin precedent (Cycle 142 cam-domain.ts after Cycle 137 post-domain.ts)', () => {
      const doc = loadEditWorkflow()
      // The Cycle 143 escalation bullet must record that Cycle 142
      // [ID-0216] cam-domain.ts paired-pin is the SECOND telemetry-stage-
      // label paired-pin in the [ID-0067] ledger after Cycle 137
      // [ID-0213] post-domain.ts was the first. Pin the canonical
      // 'cam.run_pipeline' stage label literal AND the 'SECOND
      // telemetry-stage-label paired-pin' framing AND the cross-link to
      // Cycle 137 [ID-0213] so a future reword that drops the sister-
      // facade lineage fires this it() block.
      expect(doc).toContain("'cam.run_pipeline'")
      expect(doc).toContain('SECOND telemetry-stage-label paired-pin')
      expect(doc).toMatch(/Cycle 137 \[ID-0213\]/)
    })

    it('records the SECOND cross-cuts-ALL-three-machines pin precedent (Cycle 142 cam-domain after Cycle 140 setup-sheet)', () => {
      const doc = loadEditWorkflow()
      // The Cycle 143 escalation bullet must record that Cycle 142
      // [ID-0216] is the SECOND cross-cuts-ALL-three-machines pin in
      // the [ID-0067] ledger after the Cycle 140 setup-sheet pin. Pin
      // the explicit three-machine cross-cut framing for cam-domain
      // (K2 Plus FDM Klipper/Moonraker + Laguna Swift 3-axis RichAuto/
      // Mach3 + Carvera 4-axis Makera Controller) AND the 'SECOND
      // cross-cuts-ALL-three-machines pin' framing so a future reword
      // that drops the sister-facade three-machine lineage fires this
      // it() block.
      expect(doc).toContain('K2 Plus FDM Klipper/Moonraker + Laguna Swift 3-axis RichAuto/Mach3 + Carvera 4-axis Makera Controller')
      expect(doc).toContain('SECOND cross-cuts-ALL-three-machines pin')
    })

    it('records the operational rule extension for multi-line block-replace Edits on >600-line NEW test files', () => {
      const doc = loadEditWorkflow()
      // The Cycle 143 escalation bullet must include the operational
      // rule extension: any multi-line block-replace Edit on a NEW test
      // file >600 lines should default to Python-via-bash str.replace
      // from the FIRST attempt regardless of how small the diff or how
      // recently the file was created. Pin the literal '>600 lines'
      // threshold AND the 'mandatory-territory' framing so a future
      // reword that drops the operational rule fires this it() block.
      expect(doc).toContain('>600 lines')
      expect(doc).toContain('mandatory-territory')
    })

    it('records the most-material-operational-rule-update-since-Cycle-79 framing', () => {
      const doc = loadEditWorkflow()
      // The Cycle 143 escalation bullet must label the threshold revision
      // from ~800 to ~670 lines as 'the most material operational rule
      // update since the Cycle 79 [ID-0067-data-v12] mandatory-territory
      // escalation'. Pin the literal 'most material operational rule
      // update' framing AND the 'Cycle 79 [ID-0067-data-v12]' cross-
      // reference so a future reword that softens the historical
      // significance fires this it() block.
      expect(doc).toContain('most material operational rule update')
      expect(doc).toMatch(/Cycle 79 \[ID-0067-data-v12\]/)
    })

    it('records the post-Cycle-140-reset window cycle-success rate framing (2/3 = 66.7 % vs 12/12 = 100 % all-time-record window)', () => {
      const doc = loadEditWorkflow()
      // The Cycle 143 escalation bullet must label the post-Cycle-140-
      // reset window (Cycles 141-143 = 1 clean + 1 fire + 1 clean) as
      // 2/3 = 66.7 % cycle-success rate, well below the 12/12 = 100 %
      // all-time-record window cycle-success rate (Cycles 79-90 +
      // Cycles 128-139). Pin both the '2/3 = 66.7 %' rate AND the
      // '12/12 = 100 %' contrast so a future reword that drops the
      // window-success contextualisation fires this it() block.
      expect(doc).toContain('2/3 = 66.7 %')
      expect(doc).toContain('12/12 = 100 %')
    })

    it('records that the [ID-0095] uniqueness checklist held during the Cycle 142 splice recovery (count==1 first try)', () => {
      const doc = loadEditWorkflow()
      // The Cycle 143 escalation bullet must label the [ID-0095] marker-
      // uniqueness checklist as 100 % clean across all 19 size-
      // uncorrelated cycles -- the Cycle 142 splice was count==1 on
      // first try. Pin both the '100 % clean across all 19 size-
      // uncorrelated cycles' framing AND the 'count==1 on first try'
      // detail so a future reword that drops the splice-recovery sub-
      // ledger framing fires this it() block.
      expect(doc).toContain('100 % clean across all 19 size-uncorrelated cycles')
      expect(doc).toContain('count==1 on first try')
    })

    it('records the Cycle 143 escalation bullet provenance in the Rule 1.5 mandatory-territory checklist ([ID-0067-data-v19])', () => {
      const doc = loadEditWorkflow()
      // The Rule 1.5 mandatory-territory checklist must contain a
      // 'Cycle 143 escalation' bullet covering the Cycles 141-142
      // chronology + the [ID-0067-data-v19] surface. Pin both the
      // literal 'Cycle 143 escalation' provenance + the
      // [ID-0067-data-v19] id + the 36.4 % cumulative-rate framing.
      expect(doc).toMatch(/Cycle 143 escalation/)
      expect(doc).toMatch(/\[ID-0067-data-v19\]/)
      expect(doc).toContain('36.4 %')
    })

    it('extends the Rule 1.5 header chain to include Cycle 143', () => {
      const doc = loadEditWorkflow()
      // The Rule 1.5 section header chain that lists every cycle
      // data-update must now end with 'Cycle 143'. Pin the literal
      // 'Cycle 141, Cycle 143' adjacency (no other cycles between)
      // so a future reword that drops Cycle 143 from the header chain
      // or reorders it fires this it() block.
      expect(doc).toMatch(/Cycle 141, Cycle 143, Cycle 148, Cycle 153, Cycle 158, Cycle 164, Cycle 169, Cycle 174, Cycle 179, Cycle 184, Cycle 189, Cycle 195, Cycle 200, Cycle 213, Cycle 218 \[ID-0067\] data update/)
    })
  })

  describe('Rule 1.5 -- content-characteristic override [ID-0067-data-v20] Cycle 148 data update', () => {
    it('records the [ID-0067-data-v20] reference (Cycle 148 docs-and-dx)', () => {
      const doc = loadEditWorkflow()
      // Cycle 148 (docs-and-dx, 2026-04-28) records [ID-0067-data-v20]:
      // refresh of `docs/EDIT-WORKFLOW.md` Rule 1.5 ledger absorbing
      // Cycles 144-147 chronology -- 4 cycles of denominator-only
      // growth + 2 NEW [ID-0067] sub-classes (assertion-side-fix +
      // JSDoc-honesty-trim) + a 3-in-a-row FIRST-RUN-CLEAN streak
      // BROKEN at Cycle 146 + a 1-in-a-row post-Cycle-146-reset open
      // at Cycle 147. Pin the literal '[ID-0067-data-v20]' id so a
      // future reword cannot drop the provenance.
      expect(doc).toContain('[ID-0067-data-v20]')
    })

    it('updates the cumulative [ID-0067] failure rate to 40/114 cycles (35.1 %, Cycle 147 close)', () => {
      const doc = loadEditWorkflow()
      // Provenance: 40/110 (Cycle 143 close, 36.4 %) -> 40/111 (Cycle
      // 144 cam-engine clean denominator-only) -> 40/112 (Cycle 145
      // post-processing clean denominator-only) -> 40/113 (Cycle 146
      // ui-polish ZERO Edit-tool fires; 3 assertion-side fixes are
      // denominator-only per the NEW assertion-side-fix sub-class) ->
      // 40/114 (Cycle 147 cam-engine clean denominator-only). NEW
      // low-watermark cumulative rate.
      expect(doc).toContain('40/114')
      expect(doc).toContain('35.1 %')
    })

    it('records the four intermediate denominator-only increments (40/111, 40/112, 40/113)', () => {
      const doc = loadEditWorkflow()
      // The four-cycle trajectory must be visible in the bullet so the
      // 'denominator-only across 4 cycles' framing is auditable. Pin
      // each intermediate rate so a future reword that collapses them
      // into a single 40/110 -> 40/114 jump fires this it() block.
      expect(doc).toContain('40/111')
      expect(doc).toContain('40/112')
      expect(doc).toContain('40/113')
    })

    it('records the NEW assertion-side-fix sub-class as a NAMED [ID-0067] convention', () => {
      const doc = loadEditWorkflow()
      // The Cycle 148 escalation bullet must explicitly NAME the
      // assertion-side-fix sub-class as a NEW [ID-0067] sub-class
      // (previously a denominator-only convention but never named).
      // Pin the literal phrase 'assertion-side-fix sub-class' so a
      // future reword that drops the explicit naming fires this it().
      expect(doc).toMatch(/assertion-side-fix sub-class/)
    })

    it('records the NEW JSDoc-honesty-trim sub-class for first-Write near-threshold trims', () => {
      const doc = loadEditWorkflow()
      // The Cycle 148 escalation bullet must explicitly NAME the
      // JSDoc-honesty-trim sub-class as a NEW [ID-0067] sub-class
      // covering Cycle 147's 805 -> 795 line in-cycle trim. Pin the
      // literal phrase 'JSDoc-honesty-trim sub-class'.
      expect(doc).toMatch(/JSDoc-honesty-trim sub-class/)
    })

    it('records Cycle 146 as the streak-breaking cycle with three assertion-side fixes', () => {
      const doc = loadEditWorkflow()
      // The Cycle 148 escalation bullet must label Cycle 146 as the
      // FIRST cycle on the [ID-0067] ledger where the cycle ended
      // NON-FIRST-RUN-CLEAN entirely due to assertion-side fixes
      // without any Edit-tool truncation. Pin the explicit
      // 'BROKEN at Cycle 146' and the FIRST-cycle framing.
      expect(doc).toMatch(/BROKEN at Cycle 146/)
      expect(doc).toMatch(/FIRST cycle on the \[ID-0067\] ledger/)
    })

    it('records the post-Cycle-142-reset 3-in-a-row FIRST-RUN-CLEAN streak framing', () => {
      const doc = loadEditWorkflow()
      // The streak that ran Cycles 143 + 144 + 145 must be labelled
      // as a 3-in-a-row post-Cycle-142-reset FIRST-RUN-CLEAN streak.
      expect(doc).toMatch(/post-Cycle-142-reset/)
      expect(doc).toMatch(/3-in-a-row FIRST-RUN-CLEAN/)
    })

    it('records the post-Cycle-146-reset 1-in-a-row open at Cycle 147', () => {
      const doc = loadEditWorkflow()
      // The Cycle 147 cam-engine [ID-0222] cam-engine-adapter pin
      // opened a NEW post-Cycle-146-reset streak at 1-in-a-row.
      expect(doc).toMatch(/post-Cycle-146-reset/)
      expect(doc).toMatch(/1-in-a-row FIRST-RUN-CLEAN \(Cycle 147 only\)/)
    })

    it('records the per-cycle id + slot enumeration for Cycles 144-147', () => {
      const doc = loadEditWorkflow()
      // The Cycle 148 escalation bullet must explicitly enumerate the
      // four cycles by id + slot. Pin the four [ID-NNNN] ids that
      // together prove the four-rotation-slot diversity (cam-engine /
      // post-processing / ui-polish / cam-engine).
      expect(doc).toContain('[ID-0217]')
      expect(doc).toContain('[ID-0218]')
      expect(doc).toContain('[ID-0220]')
      expect(doc).toContain('[ID-0222]')
    })

    it('records the Cycle 147 805 -> 795 mid-cycle trim arithmetic', () => {
      const doc = loadEditWorkflow()
      // The Cycle 148 escalation bullet must record the explicit
      // 805 -> 795 line trim arithmetic for Cycle 147's
      // JSDoc-honesty-trim sub-class. Pin both numbers + the directional
      // arrow so a future reword that drops the auditability fires
      // this it() block.
      expect(doc).toMatch(/805 -> 795/)
    })

    it('records the operational guidance (negative-regex anchors + threshold-trim convention)', () => {
      const doc = loadEditWorkflow()
      // The Cycle 148 escalation bullet must include the operational
      // guidance lessons: prefer word-boundary anchors over bare
      // substring negative-regex; prefer in-cycle Python-via-bash
      // str.replace trims when a first-Write lands within 5 lines
      // of the 800-line R1 threshold.
      expect(doc).toMatch(/word-boundary anchors/)
      expect(doc).toMatch(/within 5 lines of the 800-line R1 threshold/)
    })

    it('records the Cycle 148 escalation bullet provenance in the Rule 1.5 mandatory-territory checklist ([ID-0067-data-v20])', () => {
      const doc = loadEditWorkflow()
      // The Rule 1.5 mandatory-territory checklist must contain a
      // 'Cycle 148 escalation' bullet covering the Cycles 144-147
      // chronology + the [ID-0067-data-v20] surface. Pin both the
      // literal 'Cycle 148 escalation' provenance + the
      // [ID-0067-data-v20] id + the 35.1 % cumulative-rate framing.
      expect(doc).toMatch(/Cycle 148 escalation/)
      expect(doc).toMatch(/\[ID-0067-data-v20\]/)
      expect(doc).toContain('35.1 %')
    })

    it('extends the Rule 1.5 header chain to include Cycle 148', () => {
      const doc = loadEditWorkflow()
      // The Rule 1.5 section header chain that lists every cycle
      // data-update must now end with 'Cycle 148'. Pin the literal
      // 'Cycle 143, Cycle 148' adjacency (no other cycles between)
      // so a future reword that drops Cycle 148 from the header
      // chain or reorders it fires this it() block.
      expect(doc).toMatch(/Cycle 143, Cycle 148, Cycle 153, Cycle 158, Cycle 164, Cycle 169, Cycle 174, Cycle 179, Cycle 184, Cycle 189, Cycle 195, Cycle 200, Cycle 213, Cycle 218 \[ID-0067\] data update/)
    })

  describe('Rule 1.5 -- content-characteristic override [ID-0067-data-v21] Cycle 153 data update', () => {
    it('records the [ID-0067-data-v21] reference (Cycle 153 docs-and-dx)', () => {
      const doc = loadEditWorkflow()
      // Cycle 153 is the docs-and-dx slot pull immediately following
      // Cycle 148's [ID-0067-data-v20] refresh (5 cycles cooled).
      // The v21 surface absorbs Cycles 149-152 chronology including
      // the NEW NAMED comment-strip-update sub-class fired by Cycle 152.
      expect(doc).toContain('[ID-0067-data-v21]')
    })

    it('updates the cumulative [ID-0067] failure rate to 42 / 119 cycles (Cycle 152 close, 35.3 %)', () => {
      const doc = loadEditWorkflow()
      // Provenance: 40/114 (Cycle 148 close) -> 41/115 (Cycle 149,
      // numerator+denominator) -> 41/116 (Cycle 150, denominator-only
      // assertion-side) -> 41/117 (Cycle 150 re-tally) -> 41/118 (Cycle
      // 151, denominator-only FIRST-RUN-CLEAN) -> 42/119 (Cycle 152,
      // numerator+denominator) at end of Cycle 152.
      expect(doc).toContain('42/119')
      expect(doc).toContain('35.3 %')
    })

    it('records the Cycle 152 NEW NAMED comment-strip-update [ID-0067] sub-class', () => {
      const doc = loadEditWorkflow()
      // Cycle 152's 3-line block-replace at line ~647 of the
      // freshly-Written 681-line plain-ASCII pin-test file truncated
      // the trailing 9 lines. The escalation bullet must name the
      // sub-class verbatim AND record that the Edit was a 3-line diff
      // (the SMALLEST-DIFF documented fire on the ledger).
      expect(doc).toContain('comment-strip-update sub-class')
      expect(doc).toContain('3-line block-replace')
    })

    it('records the Cycle 149 NEW NAMED globalThis-pollution-cleanup sub-class', () => {
      const doc = loadEditWorkflow()
      // Cycle 149's afterAll-block insert recovered via splice + the
      // independent globalThis pollution that broke Viewport3D.test.ts
      // via detect-gpu's window.navigator.userAgent probe. Pin the
      // sub-class name and the technical recovery (snapshot+restore
      // descriptors + vi.unstubAllGlobals).
      expect(doc).toContain('globalThis-pollution-cleanup sub-class')
      expect(doc).toContain('vi.unstubAllGlobals')
    })

    it('records the Cycle 150 SECOND-ledger-datapoint of the assertion-side-fix sub-class', () => {
      const doc = loadEditWorkflow()
      // Cycle 150 carvera-zeroing-pin extended the assertion-side-fix
      // sub-class established at Cycle 146 -- the SECOND ledger
      // datapoint with 4 in-cycle assertion-side fixes (Function.length
      // miscount, /\bM3\b/ collision, /M30/ collision, TS2352 cast).
      expect(doc).toContain('SECOND ledger datapoint')
    })

    it('records that Cycle 151 RESTARTED a 1-in-a-row post-Cycle-149-reset FIRST-RUN-CLEAN streak', () => {
      const doc = loadEditWorkflow()
      expect(doc).toContain('post-Cycle-149-reset')
      expect(doc).toMatch(/1-in-a-row.*Cycle 151/)
    })

    it('records that Cycle 152 BROKE the 1-in-a-row streak (post-Cycle-152-reset = 0-in-a-row)', () => {
      const doc = loadEditWorkflow()
      expect(doc).toContain('post-Cycle-152-reset = 0-in-a-row')
    })

    it('records the operational rule extension: always-Python-via-bash applies to test files > 670 lines regardless of diff size', () => {
      const doc = loadEditWorkflow()
      // The Cycle 152 681-line file with a 3-line diff fired [ID-0067],
      // confirming truncation correlates with FILE size, not DIFF size.
      expect(doc).toMatch(/test files\s*>\s*670 lines/)
    })

    it('records the size-uncorrelated chain extension to 21 distinct cycles', () => {
      const doc = loadEditWorkflow()
      // Cycle 149 (936 lines) + Cycle 152 (681 lines) extend the chain
      // from 19 to 21 distinct cycles. Cycle 152's 681-line file is
      // the SECOND-SMALLEST sub-800-line multi-line block-replace fire.
      expect(doc).toContain('21 distinct cycles')
    })

    it('records that the Cycle 152 fire reverses the 5-cycle low-watermark trend by +0.6 pp', () => {
      const doc = loadEditWorkflow()
      // Cycles 147-151 were 35.1 / 34.8 / 35.3 / 35.0 / 34.7 %
      // (denominator-only); Cycle 152 lifts to 35.3 % (+0.6 pp from
      // 34.7 %). The escalation bullet must record this reversal.
      expect(doc).toContain('+0.6 pp')
    })

    it('records the Cycle 152 splice-recovery marker uniqueness gate ([ID-0095] count==1)', () => {
      const doc = loadEditWorkflow()
      // The Cycle 152 recovery used the marker
      // '\n\n    expect(SOURCE).not.toMatch(/window' which had
      // count==1 uniqueness; the splice-recovery sub-ledger remains
      // 100 % clean across all 21 size-uncorrelated cycles.
      expect(doc).toContain('[ID-0095] count==1 uniqueness gate')
    })

    it('records the Cycle 153 escalation bullet provenance in the Rule 1.5 mandatory-territory checklist ([ID-0067-data-v21])', () => {
      const doc = loadEditWorkflow()
      expect(doc).toMatch(/Cycle 153 escalation/)
      expect(doc).toMatch(/\[ID-0067-data-v21\]/)
    })

    it('extends the Rule 1.5 header chain to include Cycle 153', () => {
      const doc = loadEditWorkflow()
      // The Rule 1.5 section header chain that lists every cycle
      // data-update must now end with 'Cycle 153'. Pin the literal
      // 'Cycle 148, Cycle 153' adjacency (no other cycles between)
      // so a future reword that drops Cycle 153 from the header
      // chain or reorders it fires this it() block.
      expect(doc).toMatch(/Cycle 148, Cycle 153, Cycle 158, Cycle 164, Cycle 169, Cycle 174, Cycle 179, Cycle 184, Cycle 189, Cycle 195, Cycle 200, Cycle 213, Cycle 218 \[ID-0067\] data update/)
    })
  })

  describe('Rule 1.5 -- content-characteristic override [ID-0067-data-v22] Cycle 158 data update', () => {
    it('records the [ID-0067-data-v22] reference (Cycle 158 docs-and-dx)', () => {
      const doc = loadEditWorkflow()
      // Cycle 158 is the docs-and-dx slot pull immediately following
      // Cycle 153's [ID-0067-data-v21] refresh (5 cycles cooled). The
      // v22 surface absorbs Cycles 154-157 chronology including TWO
      // NEW empirical-threshold sub-class shifts: (a) NEW LOWEST-FILE
      // SIZE DOCUMENTED FIRE at Cycle 156 (541 lines / ~22 KB beating
      // the prior Cycle 152 681-line minimum by 140 lines / ~6 KB);
      // and (b) NEW HIGH-WATERMARK first-pass NEW-file Write-tool
      // success at Cycle 157 (1094 lines / ~38 KB beating the prior
      // Cycle 139 [ID-0214] 1054-line / 42031-byte truncation
      // threshold by 40 lines).
      expect(doc).toContain('[ID-0067-data-v22]')
    })

    it('updates the cumulative [ID-0067] failure rate to 43 / 124 cycles (Cycle 157 close, 34.7 %)', () => {
      const doc = loadEditWorkflow()
      // Provenance: 42/119 (Cycle 152 close) -> 42/120 (Cycle 153,
      // denominator-only) -> 42/121 (Cycle 154, denominator-only,
      // FIRST-RUN-CLEAN) -> 42/122 (Cycle 155, denominator-only,
      // FIRST-RUN-CLEAN) -> 43/123 (Cycle 156, numerator+denominator,
      // ONE Edit-tool fire on the alias-prefix assertion-side-fix) ->
      // 43/124 (Cycle 157, denominator-only, FIRST-RUN-CLEAN) at end
      // of Cycle 157.
      expect(doc).toContain('43/124')
      expect(doc).toContain('34.7 %')
    })

    it('records the Cycle 156 NEW LOWEST-FILE-SIZE DOCUMENTED [ID-0067] fire (541 lines / ~22 KB)', () => {
      const doc = loadEditWorkflow()
      // Cycle 156 ui-polish [ID-0229] command-palette-search-pin
      // fired ONE Edit-tool truncation on a 16-line block-replace at
      // a 541-line plain-ASCII pin-test file -- the new lowest file
      // size in the documented [ID-0067] ledger, beating the prior
      // Cycle 152 681-line minimum by 140 lines / ~6 KB. The
      // escalation bullet must record the file size + the prior
      // record + the delta.
      expect(doc).toContain('NEW LOWEST-FILE-SIZE DOCUMENTED FIRE: 541 lines / ~22 KB')
      expect(doc).toContain('140 lines / ~6 KB')
    })

    it('records the Cycle 157 NEW HIGH-WATERMARK first-pass NEW-file Write-tool success (1094 lines / ~38 KB)', () => {
      const doc = loadEditWorkflow()
      // Cycle 157 cam-engine [ID-0230] cura-slice-defaults-pin
      // landed a 1094-line / ~38-KB single-shot Write-tool create
      // intact -- 40 lines past the Cycle 139 [ID-0214] empirical
      // 1054-line / 42031-byte first-pass NEW-file Write-tool
      // truncation sub-class. The escalation bullet must record the
      // line count + the prior threshold + the delta.
      expect(doc).toContain('NEW HIGH-WATERMARK first-pass NEW-file Write-tool success')
      expect(doc).toContain('1094 lines')
      expect(doc).toContain('40 lines past')
    })

    it('records the Cycle 155 sub-class confirmation: 687-line first-pass Write success past the 670-line block-replace truncation threshold', () => {
      const doc = loadEditWorkflow()
      // Cycle 155 post-processing [ID-0228] post-process-atc-
      // capability-pin landed a 687-line / ~26-KB single-shot Write
      // intact, 17 lines past the Cycle 142 [ID-0067] empirical
      // 670-line block-replace truncation threshold for the Edit
      // tool but well below the Cycle 139 1054-line Write-tool
      // first-pass threshold. Pin both numbers.
      expect(doc).toContain('687-line')
      expect(doc).toContain('17 lines past')
    })

    it('records the Cycle 156 typecheck-side-fix sub-class extension to THREE ledger datapoints', () => {
      const doc = loadEditWorkflow()
      // Cycle 156 added the THIRD ledger datapoint of the typecheck
      // side-fix sub-class (Cycle 146 first; Cycle 150 second; Cycle
      // 156 third) -- the synthetic FusionStyleCommand fixture had
      // wrong shape (assumed `tab/group/handler/tier/moduleScope`
      // fields but the actual type is
      // `id/label/ribbon/workspace/status/fusionRibbon?/notes?`;
      // corrected via Python-via-bash str.replace).
      expect(doc).toContain('THREE ledger datapoints')
      expect(doc).toContain('FusionStyleCommand fixture')
    })

    it('records the post-Cycle-152-reset 3-in-a-row FIRST-RUN-CLEAN streak (Cycles 153 + 154 + 155)', () => {
      const doc = loadEditWorkflow()
      // Cycles 153 + 154 + 155 form a 3-in-a-row FIRST-RUN-CLEAN
      // streak (post-Cycle-152-reset); Cycle 156 BROKE the streak.
      expect(doc).toMatch(/3-in-a-row \(Cycles 153 \+ 154 \+ 155\)/)
    })

    it('records that Cycle 156 BROKE the 3-in-a-row streak (post-Cycle-156-reset)', () => {
      const doc = loadEditWorkflow()
      expect(doc).toContain('post-Cycle-156-reset')
    })

    it('records the size-uncorrelated chain extension to 23 distinct cycles', () => {
      const doc = loadEditWorkflow()
      // Cycle 156's 541-line fire extends the size-uncorrelated chain
      // from 22 to 23 distinct cycles. Pin the literal '23 distinct
      // cycles' so a future reword that drops the count fires this
      // it() block.
      expect(doc).toContain('23 distinct cycles')
    })

    it('records the operational sub-rule extension: empirical Write-tool first-pass NEW-file ceiling now at LEAST 1094 lines', () => {
      const doc = loadEditWorkflow()
      // Cycle 158's escalation bullet adds the new operational sub-
      // rule: the Write-tool first-pass NEW-file empirical success
      // ceiling is now at LEAST 1094 lines / ~38 KB (Cycle 157
      // datapoint). Past the Cycle 139 [ID-0214] 1054-line
      // truncation sub-class. Above 1100 lines remains untested in
      // this dataset.
      expect(doc).toContain('1100 lines')
    })

    it('records the Cycle 158 escalation bullet provenance in the Rule 1.5 mandatory-territory checklist ([ID-0067-data-v22])', () => {
      const doc = loadEditWorkflow()
      expect(doc).toMatch(/Cycle 158 escalation/)
      expect(doc).toMatch(/\[ID-0067-data-v22\]/)
    })

    it('extends the Rule 1.5 header chain to include Cycle 158', () => {
      const doc = loadEditWorkflow()
      // The Rule 1.5 section header chain that lists every cycle
      // data-update must now end with 'Cycle 158'. Pin the literal
      // 'Cycle 153, Cycle 158' adjacency (no other cycles between)
      // so a future reword that drops Cycle 158 from the header
      // chain or reorders it fires this it() block.
      expect(doc).toMatch(/Cycle 153, Cycle 158, Cycle 164, Cycle 169, Cycle 174, Cycle 179, Cycle 184, Cycle 189, Cycle 195, Cycle 200, Cycle 213, Cycle 218 \[ID-0067\] data update/)
    })

    it('records the Cycle 156 splice-recovery marker uniqueness gate ([ID-0095] count==1)', () => {
      const doc = loadEditWorkflow()
      // The Cycle 156 recovery used the marker
      // 'it(\'module references NO fore' which had count==1
      // uniqueness; the splice-recovery sub-ledger remains 100 %
      // clean across all 22 size-uncorrelated cycles + 1 NEW LOWEST
      // sub-class (Cycle 156).
      expect(doc).toContain('[ID-0095] count==1 uniqueness gate')
      expect(doc).toContain('splice-recovery sub-ledger')
    })
  })
  describe('Rule 1.5 -- content-characteristic override [ID-0067-data-v23] Cycle 164 data update', () => {
    it('records the [ID-0067-data-v23] reference (Cycle 164 docs-and-dx)', () => {
      const doc = loadEditWorkflow()
      // Cycle 164 is the docs-and-dx slot pull immediately following
      // Cycle 158's [ID-0067-data-v22] refresh (5 cycles cooled).
      // Cycle 163 hand-off named docs-and-dx as the TOP recommended
      // pull. The v23 surface absorbs Cycles 159-163 chronology,
      // covering the assertion-side-fix sub-class extending from THIRD
      // (Cycle 161) through FOURTH (Cycle 162) to FIFTH (Cycle 163)
      // ledger datapoints, the NEW HIGH-WATERMARK first-pass NEW-file
      // Write-tool success at 1135 lines (Cycle 159 [ID-0232]), and
      // the sub-34 % cumulative milestone broken downward at Cycle 160
      // for the FIRST time since the [ID-0067] ledger opened at Cycle
      // 8 + the 1/3 cumulative threshold broken at Cycle 162.
      expect(doc).toContain('[ID-0067-data-v23]')
    })

    it('updates the cumulative [ID-0067] failure rate to 43 / 130 cycles (Cycle 163 close, 33.1 %)', () => {
      const doc = loadEditWorkflow()
      // Provenance: 43/124 (Cycle 158 close) -> 43/125 (Cycle 159
      // close, denominator-only FIRST-RUN-CLEAN) -> 43/126 (Cycle 160,
      // denominator-only FIRST-RUN-CLEAN, sub-34 % milestone) ->
      // 43/127 (Cycle 161, denominator-only assertion-side fix, sub-
      // 34 % low-watermark) -> 43/129 (Cycle 162, denominator-only
      // assertion-side fix, 1/3 milestone broken downward) -> 43/130
      // (Cycle 163 close, denominator-only assertion-side fix, NEW
      // 33.1 % low watermark).
      expect(doc).toContain('43/130')
      expect(doc).toContain('33.1 %')
    })

    it('records the Cycle 159 NEW HIGH-WATERMARK first-pass NEW-file Write-tool success (1135 lines / ~42.5 KB)', () => {
      const doc = loadEditWorkflow()
      // Cycle 159 post-processing [ID-0232] laguna-vacuum-postlude-pin
      // landed a 1135-line / ~42.5-KB single-shot Write-tool create
      // intact -- 41 lines past the prior Cycle 157 [ID-0230]
      // 1094-line / ~38-KB ceiling. The escalation bullet must
      // record the line count + the prior threshold + the delta.
      expect(doc).toContain('NEW HIGH-WATERMARK first-pass NEW-file Write-tool success above the prior Cycle 157')
      expect(doc).toContain('1135')
      expect(doc).toContain('41 lines / ~5 KB')
    })

    it('records the Cycle 160 sub-34 % cumulative milestone broken downward for the FIRST time', () => {
      const doc = loadEditWorkflow()
      // Cycle 160 test-coverage [ID-0223] cam-runtime-telemetry-pin
      // landed FIRST-RUN-CLEAN with 110/110 it() pass. Cumulative
      // rate moved 43/125 -> 43/126 -- crossing the sub-34 %
      // threshold for the FIRST time since the [ID-0067] ledger
      // opened at Cycle 8.
      expect(doc).toContain('crossing the sub-34 % threshold for the FIRST time')
    })

    it('records the Cycle 161 assertion-side-fix sub-class THIRD ledger datapoint (shellLayoutStorage try/catch miscount)', () => {
      const doc = loadEditWorkflow()
      // Cycle 161 ui-polish [ID-0233] shellLayoutStorage-pin BROKE
      // the post-Cycle-156-reset 3-in-a-row FIRST-RUN-CLEAN streak
      // with ONE in-cycle assertion-side fix on the try/catch count
      // miscount (assumed 4, source has 3 because the two readers
      // share a private readKey() helper). This is the THIRD ledger
      // datapoint of the assertion-side-fix sub-class established
      // at Cycle 146 [ID-0220] and codified at Cycle 148.
      expect(doc).toContain('THIRD ledger datapoint of the assertion-side-fix sub-class')
      expect(doc).toContain('try/catch count miscount')
    })

    it('records the Cycle 162 assertion-side-fix sub-class FOURTH ledger datapoint (cam-progress /progress/i regex collision)', () => {
      const doc = loadEditWorkflow()
      // Cycle 162 cam-engine [ID-0234] cam-progress-pin extended
      // the assertion-side-fix sub-class to its FOURTH ledger
      // datapoint: /progress/i regex with `i` flag matched canonical
      // 'PROGRESS' itself; corrected to two paired non-`/i` regex
      // patterns matching only the lowercase or mixed-case drift
      // variants.
      expect(doc).toContain('FOURTH ledger datapoint')
      expect(doc).toContain('canonical')
    })

    it('records the Cycle 162 1/3 cumulative threshold broken downward for the FIRST time', () => {
      const doc = loadEditWorkflow()
      // Cycle 162 brought cumulative rate from 43/127 (33.9 %) to
      // 43/129 (33.3 %) -- crossing the 1/3 cumulative threshold
      // for the FIRST time since the [ID-0067] ledger opened at
      // Cycle 8.
      expect(doc).toContain('crossing the 1/3 cumulative threshold for the FIRST time')
    })

    it('records the Cycle 163 assertion-side-fix sub-class FIFTH ledger datapoint (machine-post-template-hints JSDoc-substring-vs-quoted-literal collision)', () => {
      const doc = loadEditWorkflow()
      // Cycle 163 post-processing [ID-0235] machine-post-template-
      // hints-pin extended the assertion-side-fix sub-class to its
      // FIFTH ledger datapoint: per-filename literal-count regex
      // matched both the source's runtime tuple entry AND the JSDoc
      // reference for `cnc_4axis_grbl.hbs`; corrected to count
      // single-quoted occurrences only.
      expect(doc).toContain('FIFTH ledger datapoint')
      expect(doc).toContain('JSDoc-substring-vs-quoted-literal')
    })

    it('codifies the assertion-side-fix sub-class as the dominant in-cycle-fix mode for the post-Cycle-127-reset era', () => {
      const doc = loadEditWorkflow()
      // Cycle 164 explicit codification: across Cycles 128-163 (36
      // cycles), the assertion-side-fix sub-class accounts for 5 of
      // the in-cycle fixes (Cycles 146 + 150 + 161 + 162 + 163)
      // versus 0 Edit-tool truncation fires.
      expect(doc).toContain('dominant in-cycle-fix mode for the post-Cycle-127-reset era')
      expect(doc).toContain('Cycles 146 + 150 + 161 + 162 + 163')
    })

    it('records the two-tier hazard model: tool-side silent-truncation + test-side assertion-side-fix', () => {
      const doc = loadEditWorkflow()
      // The Cycle 164 escalation introduces the two-tier hazard
      // model: (1) original Edit/Write silent-truncation tier
      // (mitigated by R1 + R1.5 mandatory-territory Python-via-bash),
      // and (2) NEW assertion-side-fix tier where focused vitest
      // catches the miscount/regex-collision/Function.length-arity
      // issue on the FIRST run and Python-via-bash str.replace
      // fixes the assertion text (NOT the source under test).
      expect(doc).toContain('two-tier hazard')
      expect(doc).toContain('test-side authoring hazard')
    })

    it('lists all FIVE collision classes (a-e) for assertion-side-fix pre-flight', () => {
      const doc = loadEditWorkflow()
      // The Cycle 164 escalation lists collision classes:
      // (a) localStorage-word-vs-call (Cycle 146)
      // (b) Function.length 0->1 from optional `?` argument (Cycle 150)
      // (c) JSDoc/comment-text collision with negative-pattern target (Cycle 150 + 163)
      // (d) regex `/i` flag matching canonical token itself (Cycle 162)
      // (e) try/catch / runtime-symbol miscount when source has shared private helpers (Cycle 161)
      expect(doc).toContain('localStorage-word-vs-call')
      expect(doc).toContain('Function.length 0->1')
      expect(doc).toContain('JSDoc/comment-text collision')
      expect(doc).toContain('try/catch / runtime-symbol miscount')
    })

    it('records the size-uncorrelated chain stable at 23 distinct cycles (no Edit-tool fire across Cycles 159-163)', () => {
      const doc = loadEditWorkflow()
      // Cycles 159-163 each landed with ZERO Edit-tool fires.
      // The size-uncorrelated chain has stayed at 23 distinct
      // cycles since Cycle 156.
      expect(doc).toContain('23 distinct cycles')
      expect(doc).toContain('size-uncorrelated chain')
    })

    it('records the splice-recovery sub-ledger remains 100 % clean across all 23 cycles + 5 assertion-side-fix datapoints', () => {
      const doc = loadEditWorkflow()
      // The splice-recovery sub-ledger has not had a single
      // marker-uniqueness collision across the entire 23-cycle
      // size-uncorrelated chain plus the 5 assertion-side-fix
      // sub-class datapoints.
      expect(doc).toContain('Splice-recovery sub-ledger remains 100 % clean across all 23 size-uncorrelated cycles')
      expect(doc).toContain('5 assertion-side-fix sub-class datapoints')
    })

    it('records the Cycle 164 escalation bullet provenance in the Rule 1.5 mandatory-territory checklist ([ID-0067-data-v23])', () => {
      const doc = loadEditWorkflow()
      expect(doc).toMatch(/Cycle 164 escalation/)
      expect(doc).toMatch(/\[ID-0067-data-v23\]/)
    })

    it('extends the Rule 1.5 header chain to include Cycle 164', () => {
      const doc = loadEditWorkflow()
      // The Rule 1.5 section header chain that lists every cycle
      // data-update must now end with 'Cycle 164'. Pin the literal
      // 'Cycle 158, Cycle 164' adjacency (no other cycles between)
      // so a future reword that drops Cycle 164 from the header
      // chain or reorders it fires this it() block.
      expect(doc).toMatch(/Cycle 158, Cycle 164, Cycle 169, Cycle 174, Cycle 179, Cycle 184, Cycle 189, Cycle 195, Cycle 200, Cycle 213, Cycle 218 \[ID-0067\] data update/)
    })
  })
  describe('Rule 1.5 -- content-characteristic override [ID-0067-data-v24] Cycle 169 data update', () => {
    it('records the [ID-0067-data-v24] reference (Cycle 169 docs-and-dx)', () => {
      const doc = loadEditWorkflow()
      // Cycle 169 is the docs-and-dx slot pull immediately following
      // Cycle 164's [ID-0067-data-v23] refresh (5 cycles cooled).
      // Cycle 168 hand-off named docs-and-dx as the TOP recommended
      // pull. The v24 surface absorbs Cycles 164-168 chronology,
      // covering the 3-in-a-row FIRST-RUN-CLEAN streak (Cycles
      // 166 + 167 + 168), the ZERO-Edit-tool 4-of-5 cycles streak
      // (Cycles 164 + 166 + 167 + 168), the 841-line clean Write
      // (Cycle 168), and the NEW LOW WATERMARK 32.6 % cumulative
      // rate at Cycle 168 close.
      expect(doc).toContain('[ID-0067-data-v24]')
    })

    it('updates the cumulative [ID-0067] failure rate to 44 / 135 cycles (Cycle 168 close, 32.6 % NEW LOW WATERMARK)', () => {
      const doc = loadEditWorkflow()
      // Provenance: 43/130 (Cycle 163 close) -> 43/131 (Cycle 164
      // close, denominator-only ZERO-Edit-tool docs-and-dx) ->
      // 44/132 (Cycle 165 close, numerator+denominator,
      // [ID-0089] silent truncation on 4th sequential replace_all)
      // -> 44/133 (Cycle 166, denominator-only FIRST-RUN-CLEAN)
      // -> 44/134 (Cycle 167, denominator-only FIRST-RUN-CLEAN,
      // EQUAL-TIES the 32.8 % low-watermark of Cycle 164)
      // -> 44/135 (Cycle 168 close, denominator-only
      // FIRST-RUN-CLEAN, NEW LOW WATERMARK 32.6 %).
      expect(doc).toContain('44/135')
      expect(doc).toContain('32.6 %')
      expect(doc).toContain('NEW LOW WATERMARK')
    })

    it('records the Cycle 165 [ID-0089] silent truncation on 4th sequential replace_all (493 -> 530 lines)', () => {
      const doc = loadEditWorkflow()
      // Cycle 165 ui-polish [ID-0237] path-join-pin BROKE the
      // post-Cycle-161-reset clean run with ONE Edit-tool fire:
      // the 4th sequential replace_all mid-file edit on the
      // docstring + (D) + (G) + regex-contract bullets silently
      // truncated the file at line 493 of the 503-line first-pass
      // NEW-file Write, losing the trailing 37 lines (recovery
      // 493 -> 530 via Python-via-bash str.replace per R1.5
      // mandatory-territory escalation with [ID-0095] count==1
      // uniqueness gate).
      expect(doc).toContain('4th sequential')
      expect(doc).toContain('493')
      expect(doc).toContain('530')
    })

    it('records the Cycle 166 ZERO Edit-tool fires single-shot 538-line Write success', () => {
      const doc = loadEditWorkflow()
      // Cycle 166 test-coverage [ID-0238] kernel-placement-parity-pin
      // landed a 538-line / 48-it() paired-pin file via single-shot
      // Write of 538 lines succeeded cleanly RESTORING the
      // FIRST-RUN-CLEAN streak after Cycle 165's [ID-0089] truncation.
      expect(doc).toContain('538')
      expect(doc).toContain('RESTORING the FIRST-RUN-CLEAN streak')
    })

    it('records the Cycle 167 ZERO Edit-tool fires single-shot 946-line Write success (2nd-largest clean Write)', () => {
      const doc = loadEditWorkflow()
      // Cycle 167 cam-engine [ID-0239] cam-scallop-stepover-pin
      // landed a 946-line / 81-it() paired-pin file via single-shot
      // Write succeeded cleanly EXTENDING the FIRST-RUN-CLEAN streak
      // to 2-in-a-row. The 946-line first-pass NEW-file Write is
      // the 2nd-largest clean Write of the post-Cycle-156-reset era
      // (high watermark: 1135 lines / Cycle 159).
      expect(doc).toContain('946')
      expect(doc).toContain('2nd-largest clean Write')
    })

    it('records the Cycle 168 NEW LOW WATERMARK 32.6 % cumulative rate (-0.2 pp from prior 32.8 % low)', () => {
      const doc = loadEditWorkflow()
      // Cycle 168 post-processing [ID-0240] gcode-header-invariants-pin
      // landed an 841-line / 113-it() paired-pin file via single-shot
      // Write succeeded cleanly EXTENDING the FIRST-RUN-CLEAN streak
      // to 3-in-a-row; cumulative rate ticked DOWN 44/134 -> 44/135
      // (32.6 %, -0.2 pp -- NEW LOW WATERMARK breaking the 32.8 %
      // previous low (Cycles 164 + 167) by 0.2 percentage points).
      expect(doc).toContain('32.6 %')
      expect(doc).toContain('breaking the 32.8 % previous low')
    })

    it('records the 3-in-a-row FIRST-RUN-CLEAN streak (Cycles 166 + 167 + 168)', () => {
      const doc = loadEditWorkflow()
      // Cycles 166 + 167 + 168 each landed FIRST-RUN-CLEAN (538/538
      // it() Cycle 166 in 7 ms; 81/81 it() Cycle 167 in 10 ms;
      // 113/113 it() Cycle 168 in 17 ms). The streak progression
      // 1 -> 0 -> 1 -> 2 -> 3 (Cycle 166 restores after Cycle 165;
      // Cycles 167 + 168 extend) is the post-Cycle-161-reset record.
      expect(doc).toContain('3-in-a-row FIRST-RUN-CLEAN')
      expect(doc).toContain('Cycles 166 + 167 + 168')
    })

    it('records ZERO-Edit-tool fires in 4 of 5 cycles (Cycles 164/166/167/168)', () => {
      const doc = loadEditWorkflow()
      // Across the v24 5-cycle stretch, ZERO-Edit-tool fires
      // landed in 4 of 5 cycles: Cycle 164 (docs-and-dx ZERO
      // fires), Cycle 166 (test-coverage ZERO fires), Cycle 167
      // (cam-engine ZERO fires), Cycle 168 (post-processing
      // ZERO fires). Only Cycle 165 broke the streak with ONE
      // [ID-0089] silent-truncation sub-class fire.
      expect(doc).toContain('ZERO-Edit-tool')
      expect(doc).toContain('4 of 5 cycles')
    })

    it('extends the size-uncorrelated chain from 23 to 27 distinct cycles since Cycle 156', () => {
      const doc = loadEditWorkflow()
      // The size-uncorrelated chain extended via the Cycle 165
      // [ID-0089] sub-class fire (24th cycle) and via the Cycles
      // 166 + 167 + 168 clean cycles (25th, 26th, 27th datapoints
      // confirming the chain was not broken by any new
      // size-correlated truncation).
      expect(doc).toContain('27 distinct cycles')
    })

    it('introduces the NEW operational sub-rule for sequential replace_all > 3 in a row', () => {
      const doc = loadEditWorkflow()
      // The Cycle 165 [ID-0089] truncation manifested on the
      // 4th sequential replace_all -- the 1st through 3rd
      // succeeded cleanly, the 4th truncated mid-file. The NEW
      // sub-rule: when authoring with replace_all for sequential
      // same-file edits beyond 3 in a row, escalate to
      // Python-via-bash str.replace from the FIRST attempt
      // regardless of file size or content shape.
      expect(doc).toContain('replace_all')
      expect(doc).toContain('beyond 3 in a row')
    })

    it('records FIVE distinct rotation slots covered (docs-and-dx + ui-polish + test-coverage + cam-engine + post-processing)', () => {
      const doc = loadEditWorkflow()
      // Cycles 164-168 covered five distinct rotation slots:
      // docs-and-dx (Cycle 164), ui-polish (Cycle 165),
      // test-coverage (Cycle 166), cam-engine (Cycle 167),
      // post-processing (Cycle 168).
      expect(doc).toContain('Five distinct rotation slots')
    })

    it('records the splice-recovery sub-ledger remains 100 % clean across all 27 cycles + 5 assertion-side-fix datapoints + 1 sequential-replace_all datapoint', () => {
      const doc = loadEditWorkflow()
      // The Cycle 165 [ID-0089] truncation absorbed via
      // Python-via-bash str.replace recovery counts as a clean
      // splice-recovery (the recovery itself was successful
      // first-try with a count==1 uniqueness gate), so the
      // splice-recovery sub-ledger remains 100 % clean across
      // all 27 size-uncorrelated cycles + 5 assertion-side-fix
      // sub-class datapoints + 1 sequential-replace_all
      // sub-class datapoint at Cycle 165.
      expect(doc).toContain('1 sequential-replace_all sub-class datapoint')
    })

    it('records the four NEW paired-pin files authored across Cycles 165-168 (530 + 538 + 946 + 841 = 2855 lines)', () => {
      const doc = loadEditWorkflow()
      // The four paired-pin files authored across Cycles 165-168
      // total 530 + 538 + 946 + 841 = 2855 lines of clean
      // paired-pin assertion authoring. Cycle 164's docs-and-dx
      // work is doc/test-pin update only, not a NEW pin file.
      expect(doc).toContain('2855 lines')
    })

    it('records the Cycle 169 escalation bullet provenance in the Rule 1.5 mandatory-territory checklist ([ID-0067-data-v24])', () => {
      const doc = loadEditWorkflow()
      expect(doc).toMatch(/Cycle 169 escalation/)
      expect(doc).toMatch(/\[ID-0067-data-v24\]/)
    })

    it('extends the Rule 1.5 header chain to include Cycle 169', () => {
      const doc = loadEditWorkflow()
      // The Rule 1.5 section header chain that lists every cycle
      // data-update must now end with 'Cycle 169'. Pin the literal
      // 'Cycle 164, Cycle 169' adjacency (no other cycles between)
      // so a future reword that drops Cycle 169 from the header
      // chain or reorders it fires this it() block.
      expect(doc).toMatch(/Cycle 164, Cycle 169, Cycle 174, Cycle 179, Cycle 184, Cycle 189, Cycle 195, Cycle 200, Cycle 213, Cycle 218 \[ID-0067\] data update/)
    })
  })
  describe('Rule 1.5 -- content-characteristic override [ID-0067-data-v25] Cycle 174 data update', () => {
    it('records the [ID-0067-data-v25] reference (Cycle 174 docs-and-dx)', () => {
      const doc = loadEditWorkflow()
      // Cycle 174 is the docs-and-dx slot pull immediately following
      // Cycle 169's [ID-0067-data-v24] refresh (5 cycles cooled).
      // Cycle 173 hand-off named docs-and-dx as the TOP recommended
      // pull. The v25 surface absorbs Cycles 169-173 chronology,
      // covering the NEW HIGH-WATERMARK first-pass NEW-file Write
      // at 1436 lines (Cycle 173) + the NEW empirical
      // FIRST-EDIT-AFTER-WRITE truncation sub-class first observed
      // at Cycle 171 (TWO Edit-tool fires both triggering [ID-0089]
      // truncations on a 650-line file just-Written) + the 5-in-a-row
      // FIRST-RUN-CLEAN streak (Cycles 166-170) BROKEN at Cycle 171
      // + the 32.1 % cumulative low-watermark TIED twice
      // (Cycles 170 + 173) within the v25 window.
      expect(doc).toContain('[ID-0067-data-v25]')
    })

    it('updates the cumulative [ID-0067] failure rate to 45 / 140 cycles (Cycle 173 close, 32.1 % TIES the previous low-watermark)', () => {
      const doc = loadEditWorkflow()
      // Provenance: 44/135 (Cycle 168 close) -> 44/136 (Cycle 169
      // close, denominator-only ZERO-Edit-tool docs-and-dx, NEW LOW
      // 32.4 %) -> 44/137 (Cycle 170 close, denominator-only
      // FIRST-RUN-CLEAN, NEW LOW 32.1 %) -> 45/138 (Cycle 171 close,
      // numerator+denominator, TWO Edit-tool fires both [ID-0089]
      // silent truncations on a 650-line just-Written file, +0.5 pp
      // to 32.6 %) -> 45/139 (Cycle 172, denominator-only
      // FIRST-RUN-CLEAN, 32.4 %) -> 45/140 (Cycle 173 close,
      // denominator-only FIRST-RUN-CLEAN, 32.1 % TIES the previous
      // low-watermark held at Cycle 170 close).
      expect(doc).toContain('45/140')
      expect(doc).toContain('TIES the previous 32.1 % low-watermark')
    })

    it('records the Cycle 170 NEW HIGH-WATERMARK 1189-line clean Write (gcode-export-safety-pin)', () => {
      const doc = loadEditWorkflow()
      // Cycle 170 ui-polish [ID-0242] gcode-export-safety-pin
      // landed a 1189-line / 89-it() paired-pin file via single-shot
      // Write of 1189 lines succeeded cleanly EXTENDING the
      // FIRST-RUN-CLEAN streak to 5-in-a-row (Cycles 166-170).
      // The 1189-line first-pass NEW-file Write is the NEW
      // HIGH-WATERMARK clean Write of the post-Cycle-156-reset era
      // at Cycle 170 close, surpassing the previous high of
      // 1135 lines (Cycle 159) by 54 lines.
      expect(doc).toContain('1189')
      expect(doc).toContain('NEW HIGH-WATERMARK')
    })

    it('records the Cycle 171 TWO Edit-tool fires both [ID-0089] silent truncations (650 -> 645 / 653 -> 648)', () => {
      const doc = loadEditWorkflow()
      // Cycle 171 test-coverage [ID-0243] stl-vec3-pin BROKE the
      // post-Cycle-161-reset 5-in-a-row FIRST-RUN-CLEAN streak with
      // TWO Edit-tool fires in a single cycle, BOTH triggering
      // [ID-0089] silent truncations on a 650-line file
      // just-Written (650 -> 645 lines on Fix #1 nearArr eps=0
      // helper bug; 653 -> 648 lines on Fix #2 IEEE-754 +/-0
      // bug). Both recovered via Python-via-bash str.replace per
      // R1.5 mandatory-territory escalation with [ID-0095] count==1
      // uniqueness gates.
      expect(doc).toContain('TWO Edit-tool fires')
      expect(doc).toContain('650 -> 645')
      expect(doc).toContain('653 -> 648')
    })

    it('introduces the NEW FIRST-EDIT-AFTER-WRITE truncation sub-class', () => {
      const doc = loadEditWorkflow()
      // Both Cycle 171 Edit-tool fires were SHORT replace_all on a
      // SAME-FILE that had already been recently Written via the
      // Write tool. The hazard manifests on the FIRST Edit after a
      // Write, not on a long replace_all chain. This refines the
      // Cycle 169 [ID-0067-data-v24] sequential-replace_all > 3
      // sub-rule -- the truncation hazard appears to fire on ANY
      // Edit after a Write, regardless of chain length.
      expect(doc).toContain('FIRST-EDIT-AFTER-WRITE')
    })

    it('promotes the FIRST-EDIT-AFTER-WRITE rule from recommendation to hard requirement on the FIRST post-Write mutation', () => {
      const doc = loadEditWorkflow()
      // Operational rule extension: for any cycle that has just
      // authored a NEW pin file via the Write tool, the FIRST
      // mutation of that same file in the same session MUST be
      // Python-via-bash str.replace, NOT an Edit-tool replace --
      // regardless of file size, content shape, or diff size.
      expect(doc).toContain('hard requirement on the FIRST post-Write mutation')
    })

    it('records the Cycle 172 ZERO Edit-tool fires single-shot 1007-line Write success (cam-machine-envelope-pin)', () => {
      const doc = loadEditWorkflow()
      // Cycle 172 cam-engine [ID-0244] cam-machine-envelope-pin
      // landed a 1007-line / 115-it() paired-pin file via
      // single-shot Write succeeded cleanly RESTORING the
      // FIRST-RUN-CLEAN streak after Cycle 171's TWO [ID-0089]
      // truncations.
      expect(doc).toContain('1007')
      expect(doc).toContain("RESTORING the FIRST-RUN-CLEAN streak after Cycle 171")
    })

    it('records the Cycle 173 NEW HIGH-WATERMARK 1436-line clean Write (gcode-end-program-invariants-pin)', () => {
      const doc = loadEditWorkflow()
      // Cycle 173 post-processing [ID-0245]
      // gcode-end-program-invariants-pin landed a 1436-line /
      // 151-it() paired-pin file via single-shot Write succeeded
      // cleanly. The 1436-line first-pass NEW-file Write is the
      // NEW HIGH-WATERMARK clean Write of the post-Cycle-156-reset
      // era at Cycle 173 close, surpassing the previous high of
      // 1189 lines (Cycle 170 / [ID-0242]) by 247 lines AND the
      // prior absolute-record 1345-line carvera-pipeline.test.ts
      // Python-via-bash splice (Cycle 86) by 91 lines.
      expect(doc).toContain('1436')
      expect(doc).toContain('247 lines')
    })

    it('records the streak progression 4 -> 5 -> 0 -> 1 -> 2 across the v25 window', () => {
      const doc = loadEditWorkflow()
      // FIRST-RUN-CLEAN streak progression across Cycles 169-173:
      // 4-in-a-row (Cycles 166-169) extends to 5-in-a-row at
      // Cycle 170 (post-Cycle-161-reset record), BROKEN at Cycle 171
      // by the TWO [ID-0089] truncations, then RESTARTED at 1
      // (Cycle 172) and EXTENDED to 2 (Cycles 172 + 173).
      expect(doc).toContain('4 -> 5 -> 0')
      expect(doc).toContain('1 (Cycle 172) -> 2 (Cycle 173)')
    })

    it('records the size-uncorrelated chain extension to 30 distinct cycles since Cycle 156', () => {
      const doc = loadEditWorkflow()
      // The size-uncorrelated chain extends from 28 distinct cycles
      // (Cycle 169 close) to 30 distinct cycles (Cycle 173 close)
      // -- adding Cycle 171 (650-line just-Written file truncation)
      // but stable across Cycles 170 + 172 + 173 (no new
      // size-correlated truncation).
      expect(doc).toContain('30 distinct cycles since Cycle 156')
    })

    it('records the splice-recovery sub-ledger remains 100 % clean across all 30 cycles + 5 assertion-side-fix datapoints + 1 sequential-replace_all + 2 NEW FIRST-EDIT-AFTER-WRITE datapoints', () => {
      const doc = loadEditWorkflow()
      // Both Cycle 171 fires recovered first-try with count==1
      // uniqueness gates -- the splice-recovery sub-ledger remains
      // 100 % clean across all 30 size-uncorrelated cycles + 5
      // assertion-side-fix sub-class datapoints + 1
      // sequential-replace_all sub-class datapoint at Cycle 165 + 2
      // NEW FIRST-EDIT-AFTER-WRITE sub-class datapoints at Cycle 171.
      expect(doc).toContain('2 NEW FIRST-EDIT-AFTER-WRITE sub-class datapoints')
    })

    it('records the four NEW paired-pin files authored across Cycles 170-173 (1189 + 657 + 1007 + 1436 = 4289 lines)', () => {
      const doc = loadEditWorkflow()
      // The four paired-pin files authored across Cycles 170-173
      // total 1189 + 657 + 1007 + 1436 = 4289 lines of paired-pin
      // assertion authoring across the v25 window -- a +50.2 %
      // uplift over the v24 window's 2855 lines (Cycles 165-168) AND
      // the largest 5-cycle clean-Write tally on record.
      expect(doc).toContain('4289 lines')
    })

    it('records the FIVE distinct rotation slots covered across Cycles 169-173', () => {
      const doc = loadEditWorkflow()
      // Cycles 169-173 covered five distinct rotation slots:
      // docs-and-dx (Cycle 169), ui-polish (Cycle 170),
      // test-coverage (Cycle 171), cam-engine (Cycle 172),
      // post-processing (Cycle 173).
      expect(doc).toContain('Five distinct rotation slots')
    })

    it('records the post-Cycle-127-reset stable band bottom is now at ~32 % with Cycle 170 + Cycle 173 TIE', () => {
      const doc = loadEditWorkflow()
      // The 32.1 % low-watermark TIE at Cycle 173 confirms the
      // post-Cycle-127-reset stable band's bottom is now at ~32 %,
      // with single-cycle excursions UP from FIRST-EDIT-AFTER-WRITE
      // fires (Cycle 171 +0.5 pp) absorbed within 2 clean cycles
      // via denominator-only ticks DOWN (Cycles 172 + 173).
      expect(doc).toContain('32.1 % low-watermark TIE at Cycle 173')
    })

    it('records the Cycle 174 escalation bullet provenance in the Rule 1.5 mandatory-territory checklist ([ID-0067-data-v25])', () => {
      const doc = loadEditWorkflow()
      expect(doc).toMatch(/Cycle 174 escalation/)
      expect(doc).toMatch(/\[ID-0067-data-v25\]/)
    })

    it('extends the Rule 1.5 header chain to include Cycle 174', () => {
      const doc = loadEditWorkflow()
      // The Rule 1.5 section header chain that lists every cycle
      // data-update must now end with 'Cycle 174'. Pin the literal
      // 'Cycle 169, Cycle 174' adjacency (no other cycles between)
      // so a future reword that drops Cycle 174 from the header
      // chain or reorders it fires this it() block.
      expect(doc).toMatch(/Cycle 169, Cycle 174, Cycle 179, Cycle 184, Cycle 189, Cycle 195, Cycle 200, Cycle 213, Cycle 218 \[ID-0067\] data update/)
    })
  })

  describe('Rule 1.5 -- content-characteristic override [ID-0067-data-v26] Cycle 179 data update', () => {
    it('records the [ID-0067-data-v26] reference (Cycle 179 docs-and-dx)', () => {
      const doc = loadEditWorkflow()
      // Cycle 179 is the docs-and-dx slot pull immediately following
      // Cycle 174's [ID-0067-data-v25] refresh (5 cycles cooled).
      // Cycle 178 hand-off named docs-and-dx as the TOP recommended
      // pull. The v26 surface absorbs Cycles 174-178 chronology,
      // covering the FIRST 5-cycle window with ZERO Edit-tool fires
      // since the [ID-0067] ledger opened at Cycle 8 + the 31.0 %
      // NEW LOW WATERMARK crossing the sub-31.5 % threshold for the
      // FIRST time + the FIRST-EDIT-AFTER-WRITE hard rule HOLDING
      // cleanly across all 5 cycles + the SIXTH ledger datapoint of
      // the assertion-side-fix sub-class at Cycle 176.
      expect(doc).toContain('[ID-0067-data-v26]')
    })

    it('updates the cumulative [ID-0067] failure rate to 45 / 145 cycles (Cycle 178 close, 31.0 % NEW LOW)', () => {
      const doc = loadEditWorkflow()
      // Provenance: 45/140 (Cycle 173 close, 32.1 %) -> 45/141
      // (Cycle 174 close, denominator-only, 31.9 % NEW LOW
      // crossing sub-32 % threshold for the FIRST time)
      // -> 45/142 (Cycle 175 close, denominator-only,
      // 31.7 % NEW LOW) -> 45/143 (Cycle 176 close,
      // denominator-only via Python-via-bash NOT Edit, 31.5 % NEW LOW)
      // -> 45/144 (Cycle 177 close, denominator-only, 31.3 % NEW LOW)
      // -> 45/145 (Cycle 178 close, denominator-only, 31.0 % NEW LOW
      // crossing sub-31.5 % threshold for the FIRST time).
      expect(doc).toContain('45/145')
      expect(doc).toContain('31.0 %')
    })

    it('records the FIRST sub-32 % threshold crossing at Cycle 174 close (31.9 %)', () => {
      const doc = loadEditWorkflow()
      // Cycle 174 (this very file's prior refresh = v25 itself) was
      // ZERO Edit-tool fires; cumulative rate ticked to 45/141
      // (31.9 %) -- NEW LOW WATERMARK breaking the 32.1 %
      // previous low (Cycles 170 + 173) by 0.2 pp AND crossing the
      // sub-32 % threshold for the FIRST time since the [ID-0067]
      // ledger opened at Cycle 8.
      expect(doc).toContain('crossing the sub-32 % threshold for the FIRST time')
    })

    it('records the FIRST sub-31.5 % threshold crossing at Cycle 178 close (31.0 %)', () => {
      const doc = loadEditWorkflow()
      // Cycle 178 (post-processing [ID-0250] gcode-header-read-pin)
      // was ZERO Edit-tool fires; cumulative rate ticked DOWN
      // 45/144 -> 45/145 (31.0 %, -0.3 pp -- NEW LOW WATERMARK
      // extending sub-32 % to 5 consecutive cycles AND crossing the
      // sub-31.5 % threshold for the FIRST time).
      expect(doc).toContain('crossing the sub-31.5 % threshold for the FIRST time')
    })

    it('records the ZERO Edit-tool fires across an ENTIRE 5-cycle window FIRST since Cycle 8', () => {
      const doc = loadEditWorkflow()
      // NEW datapoint: ZERO Edit-tool fires across an ENTIRE
      // 5-cycle window -- the FIRST such window since the [ID-0067]
      // ledger opened at Cycle 8 (prior best: 4-of-5 in v23 / v24
      // with Cycle 165 fire breaking the v23 streak; v25 had 1
      // broken cycle at Cycle 171 with TWO truncations).
      expect(doc).toContain('ZERO Edit-tool fires across an ENTIRE 5-cycle window')
    })

    it('records the FIRST-EDIT-AFTER-WRITE hard rule HOLDING across all 5 cycles in v26', () => {
      const doc = loadEditWorkflow()
      // The v25 [ID-0067-data-v25] FIRST-EDIT-AFTER-WRITE hard rule
      // held across ALL 5 cycles in the v26 window -- every NEW pin
      // file landed via Python-via-bash `Path.write_text(...)` +
      // byte-equality post-write gate, not via Edit-tool replace,
      // including the single in-cycle pin-side fix at Cycle 176
      // which was applied via Python-via-bash str.replace + count==1
      // uniqueness gate.
      expect(doc).toContain('FIRST-EDIT-AFTER-WRITE hard rule HOLDING cleanly across all 5 cycles')
    })

    it('records the assertion-side-fix SIXTH ledger datapoint at Cycle 176 (unique-asset-filename-pin dot-self-collision)', () => {
      const doc = loadEditWorkflow()
      // ONE in-cycle assertion-side fix (the `(G) preferred name "."`
      // test-side modeling error: the dot-self-collision case asserts
      // `dir/._1` not `dir/.` because `.` resolves to the dir itself
      // via `access(dir/., F_OK)` so the cascade always rolls forward
      // to `._1` on a fresh empty dir) applied via Python-via-bash
      // str.replace with [ID-0095] count==1 uniqueness gate -- NOT
      // an Edit-tool fire. SIXTH ledger datapoint of the
      // assertion-side-fix sub-class.
      expect(doc).toContain('SIXTH ledger datapoint of the assertion-side-fix sub-class')
      expect(doc).toContain('dot-self-collision')
    })

    it('records the streak progression 2 -> 3 -> 4 -> 0 -> 1 -> 2 across the v26 window', () => {
      const doc = loadEditWorkflow()
      // FIRST-RUN-CLEAN streak progression across Cycles 174-178:
      // 2-in-a-row (Cycles 172 + 173) extends to 3-in-a-row at
      // Cycle 174, 4-in-a-row at Cycle 175, BROKEN to 0 at Cycle 176
      // by the assertion-side fix, RESTORED to 1-in-a-row at
      // Cycle 177, EXTENDED to 2-in-a-row at Cycle 178.
      expect(doc).toContain('FIRST-RUN-CLEAN streak progression 2 -> 3 -> 4 -> 0')
      expect(doc).toContain('Cycle 176 broke via assertion-side fix')
    })

    it('records the size-uncorrelated chain extension to 33 distinct cycles since Cycle 156', () => {
      const doc = loadEditWorkflow()
      // The size-uncorrelated chain extends from 30 distinct cycles
      // (Cycle 173 close) to 33 distinct cycles since Cycle 156
      // (Cycle 178 close) -- adding Cycles 175 + 177 + 178 (each NEW
      // pin file authored cleanly without Edit-tool fire).
      expect(doc).toContain('33 distinct cycles since Cycle 156')
    })

    it('records the splice-recovery sub-ledger remains 100 % clean across all 33 cycles + 6 assertion-side + 1 seq-replace + 2 FIRST-EDIT-AFTER-WRITE', () => {
      const doc = loadEditWorkflow()
      // Splice-recovery sub-ledger remains 100 % clean across all 33
      // size-uncorrelated cycles + 6 assertion-side-fix sub-class
      // datapoints (Cycle 176 = SIXTH datapoint) + 1
      // sequential-replace_all sub-class datapoint at Cycle 165 + 2
      // NEW FIRST-EDIT-AFTER-WRITE sub-class datapoints at Cycle 171.
      expect(doc).toContain('6 assertion-side-fix sub-class datapoints (Cycle 176 = SIXTH datapoint)')
    })

    it('records the four NEW paired-pin files authored across Cycles 175-178 (355 + 717 + 726 + 499 = 2297 lines)', () => {
      const doc = loadEditWorkflow()
      // The four paired-pin files authored across Cycles 175-178
      // total 355 + 717 + 726 + 499 = 2297 lines of paired-pin
      // assertion authoring across the v26 window -- a -46.4 %
      // decrease from v25's 4289 lines (the v26 window pulled
      // smaller helpers; the high-watermark surfaces were already
      // absorbed by v25).
      expect(doc).toContain('2297 lines')
    })

    it('records the FIVE distinct rotation slots covered across Cycles 174-178', () => {
      const doc = loadEditWorkflow()
      // Cycles 174-178 covered five distinct rotation slots:
      // docs-and-dx (Cycle 174), ui-polish (Cycle 175),
      // test-coverage (Cycle 176), cam-engine (Cycle 177),
      // post-processing (Cycle 178).
      expect(doc).toContain('Five distinct rotation slots')
    })

    it('records the post-Cycle-127-reset stable band bottom dropping from ~32 % to ~31 % across the v26 window', () => {
      const doc = loadEditWorkflow()
      // The 31.0 % low-watermark crossing the sub-31.5 % threshold
      // for the first time confirms the post-Cycle-127-reset stable
      // band's bottom is now at ~31 % -- a ~1.0 pp drop from the v25
      // close ~32 % bottom -- with continued denominator-only
      // accumulation expected to preserve the downward trajectory
      // absent new Edit-tool sub-classes.
      expect(doc).toContain("post-Cycle-127-reset stable band's bottom is now at ~31 %")
    })

    it('records the Cycle 179 escalation bullet provenance in the Rule 1.5 mandatory-territory checklist ([ID-0067-data-v26])', () => {
      const doc = loadEditWorkflow()
      expect(doc).toMatch(/Cycle 179 escalation/)
      expect(doc).toMatch(/\[ID-0067-data-v26\]/)
    })

    it('extends the Rule 1.5 header chain to include Cycle 179', () => {
      const doc = loadEditWorkflow()
      // The Rule 1.5 section header chain that lists every cycle
      // data-update must now end with 'Cycle 179'. Pin the literal
      // 'Cycle 174, Cycle 179' adjacency (no other cycles between)
      // so a future reword that drops Cycle 179 from the header
      // chain or reorders it fires this it() block.
      expect(doc).toMatch(/Cycle 174, Cycle 179, Cycle 184, Cycle 189, Cycle 195, Cycle 200, Cycle 213, Cycle 218 \[ID-0067\] data update/)
    })
  })

  describe('Rule 1.5 -- content-characteristic override [ID-0067-data-v27] Cycle 184 data update', () => {
    it('records the [ID-0067-data-v27] reference (Cycle 184 docs-and-dx)', () => {
      const doc = loadEditWorkflow()
      // Cycle 184 docs-and-dx pull immediately following Cycle 179's
      // [ID-0067-data-v26] refresh (5 cycles cooled at Cycle 184).
      // Cycle 183 hand-off named docs-and-dx as the TOP recommended
      // pull. The v27 surface absorbs Cycles 179-184 chronology,
      // covering the FIRST 6-cycle window with ZERO Edit-tool fires +
      // 29.8 % NEW LOW WATERMARK crossing the SUB-30 % MILESTONE for
      // the FIRST time since the [ID-0067] ledger opened at Cycle 8 +
      // the FIRST-EDIT-AFTER-WRITE hard rule HOLDING cleanly across
      // all 6 cycles + SIX distinct rotation slots covered (NEW
      // MAXIMUM) + perf slot's first refresh since Cycle 118.
      expect(doc).toContain('[ID-0067-data-v27]')
    })

    it('updates the cumulative [ID-0067] failure rate to 45 / 151 cycles (Cycle 184 close, 29.8 % NEW LOW crossing SUB-30 % MILESTONE)', () => {
      const doc = loadEditWorkflow()
      // Provenance: 45/145 (Cycle 178 close, 31.0 %) -> 45/146
      // (Cycle 179 close, denominator-only, 30.8 % NEW LOW) -> 45/147
      // (Cycle 180 close, denominator-only, 30.6 % NEW LOW) -> 45/148
      // (Cycle 181 close, denominator-only, 30.4 % NEW LOW) -> 45/149
      // (Cycle 182 close, denominator-only, 30.2 % NEW LOW) -> 45/150
      // (Cycle 183 close, denominator-only, 30.0 % NEW LOW crossing
      // 30.0 % EXACT-ROUND-NUMBER threshold for the FIRST time)
      // -> 45/151 (Cycle 184 close, denominator-only, 29.8 % NEW LOW
      // crossing SUB-30 % MILESTONE for the FIRST time).
      expect(doc).toContain('45/151')
      expect(doc).toContain('29.8 %')
    })

    it('records the FIRST 30.0 % EXACT-ROUND-NUMBER threshold crossing at Cycle 183 close', () => {
      const doc = loadEditWorkflow()
      // Cycle 183 (post-processing [ID-0255] posts-manager-pin)
      // ticked DOWN 45/149 -> 45/150 (30.0 %) -- crossing the
      // 30.0 % EXACT-ROUND-NUMBER THRESHOLD for the FIRST time
      // since the [ID-0067] ledger opened at Cycle 8.
      expect(doc).toContain('crossing the 30.0 % EXACT-ROUND-NUMBER THRESHOLD for the FIRST time')
    })

    it('records the FIRST SUB-30 % MILESTONE crossing at Cycle 184 close (29.8 %)', () => {
      const doc = loadEditWorkflow()
      // Cycle 184 (perf [ID-0259] perf-inventory refresh) ticked
      // DOWN 45/150 -> 45/151 (29.8 %, -0.2 pp -- NEW LOW WATERMARK
      // extending sub-31 % to 6 consecutive cycles AND crossing the
      // SUB-30 % MILESTONE for the FIRST time since the [ID-0067]
      // ledger opened at Cycle 8).
      expect(doc).toContain('crossing the SUB-30 % MILESTONE for the FIRST time')
    })

    it('records the ZERO Edit-tool fires across an ENTIRE 6-cycle window EXTENDING v26 to a CONTINUOUS 11-CYCLE ZERO-FIRE RUN since Cycle 174', () => {
      const doc = loadEditWorkflow()
      // NEW datapoint: ZERO Edit-tool fires across an ENTIRE 6-cycle
      // window EXTENDING the v26 5-cycle ZERO-fire window
      // (Cycles 174-178) to a CONTINUOUS 11-CYCLE ZERO-FIRE RUN
      // since Cycle 174 across v26 + v27. THE LONGEST ZERO-FIRE
      // WINDOW IN THE [ID-0067] LEDGER HISTORY.
      expect(doc).toContain('CONTINUOUS 11-CYCLE ZERO-FIRE RUN since Cycle 174')
      expect(doc).toContain('LONGEST ZERO-FIRE WINDOW IN THE [ID-0067] LEDGER HISTORY')
    })

    it('records the FIRST-EDIT-AFTER-WRITE hard rule HOLDING across all 6 cycles in v27', () => {
      const doc = loadEditWorkflow()
      // The v25 [ID-0067-data-v25] FIRST-EDIT-AFTER-WRITE hard rule
      // held across ALL 6 cycles in the v27 window -- every NEW pin
      // file landed via Python-via-bash `Path.write_text(...)` +
      // byte-equality post-write gate, not via Edit-tool replace.
      expect(doc).toContain('FIRST-EDIT-AFTER-WRITE hard rule HOLDING cleanly across ALL 6 cycles')
    })

    it('records the 8-in-a-row FIRST-RUN-CLEAN streak (Cycles 177-184) as NEW POST-CYCLE-161-RESET RECORD', () => {
      const doc = loadEditWorkflow()
      // FIRST-RUN-CLEAN streak EXTENDED to 8-in-a-row (Cycles
      // 177-184) -- EXTENDS the prior 7-in-a-row record set at
      // Cycle 183 by 1 cycle and SETS A NEW POST-CYCLE-161-RESET
      // RECORD.
      expect(doc).toContain('8-in-a-row')
      expect(doc).toContain('NEW POST-CYCLE-161-RESET RECORD')
    })

    it('records the streak progression 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 across the v27 window continuously running', () => {
      const doc = loadEditWorkflow()
      // FIRST-RUN-CLEAN streak progression across Cycles 178-184:
      // 2-in-a-row (Cycle 178 baseline) -> 3 -> 4 -> 5 -> 6 -> 7 -> 8
      // (continuously RUNNING throughout the v27 window with NO
      // breaks -- ZERO assertion-side fixes in v27, distinguishing
      // it from the v26 window which had the SIXTH ledger datapoint
      // at Cycle 176).
      expect(doc).toContain('2 (Cycle 178 baseline) -> 3 -> 4 -> 5 -> 6 -> 7 -> **8**')
      expect(doc).toContain('continuously RUNNING throughout the v27 window')
    })

    it('records the size-uncorrelated chain extension to 39 distinct cycles since Cycle 156', () => {
      const doc = loadEditWorkflow()
      // The size-uncorrelated chain extends from 33 distinct cycles
      // (Cycle 178 close) to 39 distinct cycles since Cycle 156
      // (Cycle 184 close) -- adding Cycles 180 + 181 + 182 + 183 + 184.
      expect(doc).toContain('39 distinct cycles since Cycle 156')
    })

    it('records the splice-recovery sub-ledger remains 100 % clean across all 39 cycles + 6 assertion-side + 1 seq-replace + 2 FIRST-EDIT-AFTER-WRITE (NO new in v27)', () => {
      const doc = loadEditWorkflow()
      // Splice-recovery sub-ledger remains 100 % clean across all 39
      // size-uncorrelated cycles + 6 assertion-side-fix sub-class
      // datapoints (Cycle 176 = SIXTH datapoint, NO new datapoints
      // fired in v27) + 1 sequential-replace_all sub-class datapoint
      // at Cycle 165 + 2 FIRST-EDIT-AFTER-WRITE sub-class datapoints
      // at Cycle 171.
      expect(doc).toContain('NO new datapoints fired in v27')
    })

    it('records the four NEW paired-pin files authored across Cycles 180-183 (390 + 892 + 775 + 815 = 2872 lines)', () => {
      const doc = loadEditWorkflow()
      // The four paired-pin files authored across Cycles 180-183
      // total 390 + 892 + 775 + 815 = 2872 lines of paired-pin
      // assertion authoring across the v27 window -- a +25.0 %
      // uplift over v26's 2297 lines. Cycle 179 was docs-only
      // (this very file's prior refresh = v26 itself); Cycle 184 was
      // pure-measurement (no NEW pin file).
      expect(doc).toContain('2872 lines')
    })

    it('records the SIX distinct rotation slots covered across Cycles 179-184 as NEW MAXIMUM', () => {
      const doc = loadEditWorkflow()
      // Cycles 179-184 covered six distinct rotation slots:
      // docs-and-dx (Cycle 179), ui-polish (Cycle 180),
      // test-coverage (Cycle 181), cam-engine (Cycle 182),
      // post-processing (Cycle 183), perf (Cycle 184) -- NEW
      // MAXIMUM beating the prior 5-slot v25 / v26 record by 1 slot.
      expect(doc).toContain('Six distinct rotation slots')
      expect(doc).toContain('NEW MAXIMUM')
    })

    it('records the perf rotation slot first refresh since Cycle 118 (66 cycles cooled) absorbed cleanly at Cycle 184', () => {
      const doc = loadEditWorkflow()
      // Cycle 184 (perf [ID-0259]) was the FIRST perf rotation slot
      // pull since Cycle 118 / 66 cycles cooled -- absorbed cleanly
      // with ZERO Edit-tool fires AND ZERO source/test edits AND
      // ZERO regressions in the vitest count (9287/1/278 unchanged).
      expect(doc).toContain('66 cycles cooled')
    })

    it('records the post-Cycle-127-reset stable band bottom dropping from ~31 % to ~30 % across the v27 window', () => {
      const doc = loadEditWorkflow()
      // The 29.8 % low-watermark crossing the SUB-30 % MILESTONE for
      // the first time confirms the post-Cycle-127-reset stable
      // band's bottom is now at ~30 % -- a ~1.0 pp drop from the v26
      // close ~31 % bottom -- continuing the steady ~1.0-pp-per-v-window
      // downward trajectory established since v25 (~32 %) -> v26 (~31 %)
      // -> v27 (~30 %).
      expect(doc).toContain("post-Cycle-127-reset stable band's bottom is now at ~30 %")
    })

    it('records the Cycle 184 escalation bullet provenance in the Rule 1.5 mandatory-territory checklist ([ID-0067-data-v27])', () => {
      const doc = loadEditWorkflow()
      expect(doc).toMatch(/Cycle 184 escalation/)
      expect(doc).toMatch(/\[ID-0067-data-v27\]/)
    })

    it('extends the Rule 1.5 header chain to include Cycle 184', () => {
      const doc = loadEditWorkflow()
      // The Rule 1.5 section header chain that lists every cycle
      // data-update must now end with 'Cycle 184'. Pin the literal
      // 'Cycle 179, Cycle 184' adjacency (no other cycles between)
      // so a future reword that drops Cycle 184 from the header
      // chain or reorders it fires this it() block.
      expect(doc).toMatch(/Cycle 179, Cycle 184, Cycle 189, Cycle 195, Cycle 200, Cycle 213, Cycle 218 \[ID-0067\] data update/)
    })
  })

  describe('[ID-0067-data-v28] Cycle 189 data update -- Cycles 185-189 v28 surface', () => {
    it('records the Cycle 189 escalation bullet provenance in the Rule 1.5 mandatory-territory checklist ([ID-0067-data-v28])', () => {
      const doc = loadEditWorkflow()
      expect(doc).toMatch(/Cycle 189 escalation/)
      expect(doc).toMatch(/\[ID-0067-data-v28\]/)
    })

    it('extends the Rule 1.5 header chain to include Cycle 189', () => {
      const doc = loadEditWorkflow()
      // The Rule 1.5 section header chain must now end with 'Cycle 189'.
      // Pin the literal 'Cycle 184, Cycle 189' adjacency so a future
      // reword that drops Cycle 189 or inserts another cycle between
      // them fires this assertion.
      expect(doc).toMatch(/Cycle 184, Cycle 189, Cycle 195, Cycle 200, Cycle 213, Cycle 218 \[ID-0067\] data update/)
    })

    it('pins the v28 cumulative rate trajectory 29.8 % -> 28.8 % across Cycles 184-189', () => {
      const doc = loadEditWorkflow()
      // The v28 trajectory: 29.8 % (Cycle 184 baseline) -> 29.6 ->
      // 29.4 -> 29.2 -> 29.0 -> 28.8 % (Cycle 189 close, NEW LOW
      // WATERMARK, CROSSES 29.0 % EXACT-ROUND-NUMBER threshold).
      expect(doc).toContain('29.8 % (Cycle 184 baseline)')
      expect(doc).toContain('28.8 %')
    })

    it('pins the 28.8 % NEW LOW WATERMARK at Cycle 189 close', () => {
      const doc = loadEditWorkflow()
      expect(doc).toMatch(/45\/156 \(28\.8 %/)
    })

    it('pins the 29.0 % EXACT-ROUND-NUMBER threshold crossing at Cycle 188', () => {
      const doc = loadEditWorkflow()
      // Cycle 188 cam-engine [ID-0258] crossed the 29.0 % EXACT-ROUND-NUMBER
      // threshold for the first time. Pin the milestone-crossing language.
      expect(doc).toContain('29.0 % EXACT-ROUND-NUMBER')
    })

    it('pins the 16-cycle ZERO-Edit-tool-fire run since Cycle 174 (LONGEST in the ledger)', () => {
      const doc = loadEditWorkflow()
      // The v28 window extends the v25 + v26 + v27 ZERO-fire chain to
      // 16 consecutive cycles -- the LONGEST ZERO-FIRE WINDOW in the
      // [ID-0067] ledger history.
      expect(doc).toContain('16-CYCLE ZERO-FIRE RUN since Cycle 174')
      expect(doc).toContain('LONGEST ZERO-FIRE WINDOW IN THE [ID-0067] LEDGER HISTORY')
    })

    it('pins the 6-consecutive-cycle sub-30 % milestone (Cycles 184-189)', () => {
      const doc = loadEditWorkflow()
      expect(doc).toContain('extending sub-30 % to 6 consecutive cycles')
    })

    it('pins the THREE-CYCLE INDEPENDENT-STREAK DECOUPLING PATTERN at Cycles 187 + 188 + 189', () => {
      const doc = loadEditWorkflow()
      // The v28 window's signature observation: the FIRST-RUN-CLEAN
      // streak repeatedly broke (4 + 6 + 3 = 13 cumulative assertion-
      // side fixes) while the ZERO-Edit-tool streak held across all
      // three cycles -- empirical evidence the two streaks are
      // OPERATIONALLY INDEPENDENT under the FIRST-EDIT-AFTER-WRITE
      // hard rule.
      expect(doc).toContain('THREE-CYCLE INDEPENDENT-STREAK DECOUPLING PATTERN')
      expect(doc).toContain('Cycles 187 + 188 + 189')
    })

    it('pins the assertion-side-fix sub-class extension to NINE ledger datapoints', () => {
      const doc = loadEditWorkflow()
      // The sub-class extends from 6 datapoints at v27 close to 9
      // datapoints at v28 close (Cycles 187 + 188 + 189 each NEW).
      // SEVENTH datapoint = Cycle 187; EIGHTH = Cycle 188; NINTH = Cycle 189.
      expect(doc).toContain('SEVENTH LEDGER DATAPOINT')
      expect(doc).toContain('EIGHTH LEDGER DATAPOINT')
      expect(doc).toContain('NINTH LEDGER DATAPOINT')
    })

    it('pins the Cycle 187 cam-toolpath-guardrails 4-fix surface', () => {
      const doc = loadEditWorkflow()
      // Four assertion-side fixes at Cycle 187: Infinity-clamp-direction +
      // note-count off-by-one + export-count miscount + tsc job-narrowing.
      expect(doc).toContain('Infinity-clamp-direction modeling error')
    })

    it('pins the Cycle 188 cam-simulation-preview 6-fix surface incl. modal-initial-state-included xyBounds', () => {
      const doc = loadEditWorkflow()
      // Six fixes at Cycle 188 incl. the NEW DATAPOINT pinning the
      // documented modal-initial-state-included contract for xyBounds.
      expect(doc).toContain('Laguna xyBounds minX/minY modeling error')
      expect(doc).toContain('modal-initial-state-included contract')
    })

    it('pins the Cycle 189 fdm-temp-preview 3-fix surface incl. source-byte assertion inversion', () => {
      const doc = loadEditWorkflow()
      // Three fixes at Cycle 189 incl. the source-byte assertion
      // inversion -- the source uses the 6-ASCII-char JS escape \u00b7
      // not the literal 2-byte UTF-8 sequence.
      expect(doc).toContain('source-byte assertion inversion')
      expect(doc).toContain('6-ASCII-char JS escape')
    })

    it('pins the FOURTH paired-pin volume uplift v28 4192 lines vs v27 2872 lines (+46.0 %)', () => {
      const doc = loadEditWorkflow()
      // 5-cycle clean-Write tally: 0 (Cycle 185 docs) + 841 (quick-switch-pin)
      // + 1144 (cam-toolpath-guardrails-pin) + 1096 (cam-simulation-preview-pin)
      // + 1111 (fdm-temp-preview-pin) = 4192 lines.
      expect(doc).toContain('4192 lines')
      expect(doc).toContain('+46.0 % uplift over the v27 window')
    })

    it('pins the post-Cycle-127-reset stable-band trajectory v25 (~32) -> v26 (~31) -> v27 (~30) -> v28 (~29)', () => {
      const doc = loadEditWorkflow()
      // Steady ~1.0-pp-per-v-window downward trajectory.
      expect(doc).toContain('v25 (~32 %) -> v26 (~31 %) -> v27 (~30 %) -> v28 (~29 %)')
    })

    it('pins the size-uncorrelated chain extension to 44 distinct cycles since Cycle 156', () => {
      const doc = loadEditWorkflow()
      expect(doc).toContain('44 distinct cycles since Cycle 156')
    })

    it('pins the splice-recovery sub-ledger 100 % clean across 9 assertion-side + 1 sequential + 2 FIRST-EDIT-AFTER-WRITE datapoints', () => {
      const doc = loadEditWorkflow()
      // The full sub-class enumeration at v28 close.
      expect(doc).toContain('9 assertion-side-fix sub-class datapoints')
      expect(doc).toContain('1 sequential-replace_all sub-class datapoint at Cycle 165')
      expect(doc).toContain('2 FIRST-EDIT-AFTER-WRITE sub-class datapoints at Cycle 171')
    })
  })

  describe('[ID-0067-data-v29] Cycle 195 data update -- Cycles 190-195 v29 surface', () => {
    it('records the Cycle 195 escalation bullet provenance in the Rule 1.5 mandatory-territory checklist ([ID-0067-data-v29])', () => {
      const doc = loadEditWorkflow()
      expect(doc).toMatch(/Cycle 195 escalation/)
      expect(doc).toMatch(/\[ID-0067-data-v29\]/)
    })

    it('extends the Rule 1.5 header chain to include Cycle 195 (Cycle 189 -> Cycle 195 adjacency)', () => {
      const doc = loadEditWorkflow()
      // The v28 header chain ended with `Cycle 184, Cycle 189`. The v29 update
      // must extend it to `Cycle 184, Cycle 189, Cycle 195`. Pin the literal
      // adjacency so a future reword that drops Cycle 195 fires this it().
      expect(doc).toMatch(/Cycle 184, Cycle 189, Cycle 195, Cycle 200, Cycle 213, Cycle 218 \[ID-0067\] data update/)
    })

    it('pins the 22-cycle ZERO-Edit-tool-fire run since Cycle 174 (NEW LONGEST WINDOW)', () => {
      const doc = loadEditWorkflow()
      expect(doc).toContain('22-cycle ZERO-fire run since Cycle 174')
      expect(doc).toContain('THE NEW LONGEST ZERO-FIRE WINDOW IN THE [ID-0067] LEDGER HISTORY at the 22-cycle milestone')
    })

    it('pins the 27.8 % cumulative rate NEW LOW WATERMARK (45/162)', () => {
      const doc = loadEditWorkflow()
      expect(doc).toContain('45/161 -> 45/162 (27.8 %')
      expect(doc).toContain('27.8 % NEW LOW WATERMARK')
    })

    it('pins the EXACT-ROUND-NUMBER 28.0 % threshold crossing at Cycle 194', () => {
      const doc = loadEditWorkflow()
      expect(doc).toContain('CROSSES THE EXACT-ROUND-NUMBER 28.0 % THRESHOLD')
    })

    it('pins the 10000-test suite-doubling milestone crossed at Cycle 192', () => {
      const doc = loadEditWorkflow()
      expect(doc).toContain('10000-TEST SUITE-DOUBLING MILESTONE CROSSED at Cycle 192')
      expect(doc).toContain('+101.6 %')
    })

    it('pins the 50-cycle size-uncorrelated chain milestone at Cycle 195', () => {
      const doc = loadEditWorkflow()
      expect(doc).toContain('50 distinct cycles since Cycle 156')
      expect(doc).toContain('50-CYCLE MILESTONE')
    })

    it('pins the assertion-side-fix sub-class extension to 10 datapoints (Cycle 194 grid-quantization)', () => {
      const doc = loadEditWorkflow()
      expect(doc).toContain('TENTH LEDGER DATAPOINT of the assertion-side-fix sub-class')
      expect(doc).toContain('grid-quantization-aware')
    })

    it('pins the v29 covers-ALL-SIX-rotation-slots milestone (FIRST v-window)', () => {
      const doc = loadEditWorkflow()
      expect(doc).toContain('FIRST v-window to cover ALL SIX rotation slots')
    })

    it('pins the post-Cycle-127-reset stable-band trajectory v25 (~32) -> v26 (~31) -> v27 (~30) -> v28 (~29) -> v29 (~28)', () => {
      const doc = loadEditWorkflow()
      // Steady ~1.0-pp-per-v-window downward trajectory now extends to v29.
      expect(doc).toContain('v25 (~32 %) -> v26 (~31 %) -> v27 (~30 %) -> v28 (~29 %) -> v29 (~28 %)')
    })

    it('pins the v29 6-cycle clean-Write tally and slot coverage', () => {
      const doc = loadEditWorkflow()
      // 6-cycle clean-Write tally: 0 (Cycle 190 docs) + 617 (cam-ipc-contract-pin)
      // + 1266 (cam-tool-resolve-pin) + 0 (Cycle 193 perf) + 1059 (cam-heightfield-2d5-pin)
      // + 1043 (carvera-cli-run-pin) = 3985 lines.
      expect(doc).toContain('3985 lines')
    })

    it('pins the splice-recovery sub-ledger 100 % clean across 10 assertion-side + 1 sequential + 2 FIRST-EDIT-AFTER-WRITE datapoints', () => {
      const doc = loadEditWorkflow()
      expect(doc).toContain('10 assertion-side-fix sub-class datapoints')
      expect(doc).toContain('1 sequential-replace_all sub-class datapoint at Cycle 165')
      expect(doc).toContain('2 FIRST-EDIT-AFTER-WRITE sub-class datapoints at Cycle 171')
    })

    it('pins the FIRST-EDIT-AFTER-WRITE hard rule durability across all 22 v25-v29 cycles', () => {
      const doc = loadEditWorkflow()
      expect(doc).toContain("FIRST-EDIT-AFTER-WRITE hard rule (codified at Cycle 174 [ID-0067-data-v25]) held cleanly across ALL 22 v25-v26-v27-v28-v29 cycles")
    })

    it('pins the Cycle 192 +100 % suite-doubling threshold milestone phrasing', () => {
      const doc = loadEditWorkflow()
      expect(doc).toContain('CROSSES THE +100 % SUITE-DOUBLING MILESTONE')
    })
  })

  describe('[ID-0067-data-v30] Cycle 200 data update -- Cycles 196-200 v30 surface', () => {
    it('records the Cycle 200 escalation bullet provenance in the Rule 1.5 mandatory-territory checklist ([ID-0067-data-v30])', () => {
      const doc = loadEditWorkflow()
      expect(doc).toMatch(/Cycle 200 escalation/)
      expect(doc).toMatch(/\[ID-0067-data-v30\]/)
    })

    it('extends the Rule 1.5 header chain to include Cycle 200 (Cycle 195 -> Cycle 200 adjacency)', () => {
      const doc = loadEditWorkflow()
      // The v29 header chain ended with `Cycle 184, Cycle 189, Cycle 195`. The v30
      // update must extend it to `Cycle 184, Cycle 189, Cycle 195, Cycle 200`. Pin
      // the literal adjacency so a future reword that drops Cycle 200 fires this it().
      expect(doc).toMatch(/Cycle 184, Cycle 189, Cycle 195, Cycle 200, Cycle 213, Cycle 218 \[ID-0067\] data update/)
    })

    it('pins the 27-cycle ZERO-Edit-tool-fire run since Cycle 174 (NEW LONGEST WINDOW)', () => {
      const doc = loadEditWorkflow()
      expect(doc).toContain('27-cycle ZERO-fire run since Cycle 174')
      expect(doc).toContain('THE NEW LONGEST ZERO-FIRE WINDOW IN THE [ID-0067] LEDGER HISTORY at the 27-cycle milestone')
    })

    it('pins the 26.9 % cumulative rate NEW LOW WATERMARK (45/167) at Cycle 200', () => {
      const doc = loadEditWorkflow()
      expect(doc).toContain('45/166 -> 45/167 (26.9 %')
      expect(doc).toContain('26.9 % NEW LOW WATERMARK')
    })

    it('pins the parse-time heredoc-mangling NEW EMPIRICAL SUB-CLASS at Cycle 197 (FIRST datapoint)', () => {
      const doc = loadEditWorkflow()
      // Cycle 197 source-side fix established a NEW empirical sub-class distinct
      // from assertion-side-fix: parse-time heredoc-mangling fires when Python-via-bash
      // heredoc swallows \r/\n regex escapes and the source becomes unparseable.
      expect(doc).toContain('parse-time heredoc-mangling')
      expect(doc).toContain('FIRST ledger datapoint of the parse-time heredoc-mangling sub-class lands at Cycle 197')
    })

    it('pins the [ID-0263] mean drift-watch TRIPPED FIRST TIME at Cycle 198 (18.31 > 17.5)', () => {
      const doc = loadEditWorkflow()
      // Cycle 198 perf re-baseline tripped the [ID-0263] mean drift threshold for the
      // first time. Driver isolated to ONE outlier (cam-heightfield-2d5-pin at 3.78 ms/test).
      expect(doc).toContain('[ID-0263] mean drift-watch TRIPPED FIRST TIME at Cycle 198')
      expect(doc).toContain('18.31')
      expect(doc).toContain('17.5')
    })

    it('pins the [ID-0270] file-level perf watch on cam-heightfield-2d5-pin (NEW Cycle 198)', () => {
      const doc = loadEditWorkflow()
      expect(doc).toContain('[ID-0270] file-level perf watch on `src/shared/cam-heightfield-2d5-pin.test.ts`')
      expect(doc).toContain('5.0 ms/test threshold')
    })

    it('pins the two-class paired-pin perf taxonomy established at Cycle 198 (Lean vs Real-CAM-math)', () => {
      const doc = loadEditWorkflow()
      // Two-class taxonomy: Lean (assertion-only, 0.05-0.6 ms/test, [ID-0264] 3.0 floor)
      // vs Real-CAM-math (Float32Array/geometry, 1.0-5.0 ms/test, [ID-0270] 5.0 floor).
      expect(doc).toContain('Lean class 0.05-0.6 ms/test floor 3.0 [ID-0264]')
      expect(doc).toContain('Real-CAM-math class 1.0-5.0 ms/test floor 5.0 [ID-0270]')
    })

    it('pins the assertion-side-fix sub-class extension to 11 datapoints (Cycle 199 em-dash + Object.is(-0,+0))', () => {
      const doc = loadEditWorkflow()
      // Cycle 199 cam-4axis-params-pin landed TWO assertion-side fixes (em-dash regex
      // literal + Object.is(-0,+0) sign-of-zero divergence), bringing the
      // assertion-side-fix sub-class to 11 ledger datapoints.
      expect(doc).toContain('11 ledger datapoints at v30 close')
      expect(doc).toContain('em-dash regex literal')
      expect(doc).toContain('Object.is(-0, +0) divergence')
    })

    it('pins the post-Cycle-127-reset stable-band trajectory v25 (~32) -> ... -> v30 (~27)', () => {
      const doc = loadEditWorkflow()
      // Steady ~1.0-pp-per-v-window downward trajectory now extends to v30.
      expect(doc).toContain('v25 (~32 %) -> v26 (~31 %) -> v27 (~30 %) -> v28 (~29 %) -> v29 (~28 %) -> **v30 (~27 %)**')
    })

    it('pins the v30 5-cycle clean-Write tally (2677 lines) and 5-of-6 rotation-slot coverage', () => {
      const doc = loadEditWorkflow()
      // 5-cycle clean-Write tally: 0 (Cycle 196 docs +14 it()) + 872 (197 manufacture-cam-driving-op-pin)
      // + 0 (Cycle 198 perf measurement-only) + 849 (199 cam-4axis-params-pin) + 956 (200 gcode-dialect-compliance-pin)
      // = 2677 lines. Rotation-slot coverage = 5 of 6 (missing ui-polish 191 + chore 113).
      expect(doc).toContain('= **2677 lines**')
      expect(doc).toContain('v30 rotation-slot coverage: 5 of 6')
    })

    it('pins the FIRST-EDIT-AFTER-WRITE hard rule durability across all 27 v25-v30 cycles', () => {
      const doc = loadEditWorkflow()
      expect(doc).toContain('FIRST-EDIT-AFTER-WRITE hard rule HOLDING cleanly across ALL 27 v25-v26-v27-v28-v29-v30 cycles')
    })

    it('pins the Cycle 200 956-line clean Write as 2nd-largest of post-Cycle-156-reset era', () => {
      const doc = loadEditWorkflow()
      // 956-line first-pass NEW-file Write at Cycle 200 (gcode-dialect-compliance-pin) is
      // the 2nd-largest clean Write of the post-Cycle-156-reset era; high watermark
      // is 1135 lines / Cycle 159.
      expect(doc).toContain('2nd-largest clean Write of the post-Cycle-156-reset era')
      expect(doc).toContain('1135 lines / Cycle 159')
    })

    it('pins the splice-recovery sub-ledger extended to 11 + 1 + 2 + 1 (parse-time heredoc-mangling) datapoints', () => {
      const doc = loadEditWorkflow()
      expect(doc).toContain('11** assertion-side-fix sub-class')
      expect(doc).toContain('1 sequential-replace_all sub-class datapoint at Cycle 165')
      expect(doc).toContain('2 FIRST-EDIT-AFTER-WRITE sub-class datapoints at Cycle 171')
      expect(doc).toContain('1 NEW parse-time heredoc-mangling sub-class datapoint at Cycle 197')
    })
  })

  describe('[ID-0067-data-v31] Cycle 214 data update -- Cycles 201-213 v31 surface', () => {
    it('records the Cycle 214 escalation bullet provenance in the Rule 1.5 mandatory-territory checklist ([ID-0067-data-v31])', () => {
      const doc = loadEditWorkflow()
      expect(doc).toMatch(/Cycle 214 escalation/)
      expect(doc).toMatch(/\[ID-0067-data-v31\]/)
    })

    it('extends the Rule 1.5 header chain to include Cycle 213 (Cycle 200 -> Cycle 213 adjacency)', () => {
      const doc = loadEditWorkflow()
      // The v30 header chain ended with `Cycle 184, Cycle 189, Cycle 195, Cycle 200`. The v31
      // update must extend it to `Cycle 184, Cycle 189, Cycle 195, Cycle 200, Cycle 213`.
      // Cycle 213 is the LAST cycle in the v31 surface (Cycles 201-213); Cycle 214 is the
      // update cycle itself and is NOT in the header chain (mirrors v30: surface 196-200,
      // update Cycle 201 -- header tail was Cycle 200, not Cycle 201).
      expect(doc).toMatch(/Cycle 184, Cycle 189, Cycle 195, Cycle 200, Cycle 213, Cycle 218 \[ID-0067\] data update/)
    })

    it('pins the 40-cycle ZERO-Edit-tool-fire run since Cycle 174 (NEW LONGEST WINDOW + 40-cycle exact-round-number milestone)', () => {
      const doc = loadEditWorkflow()
      expect(doc).toContain('40-cycle ZERO-fire run since Cycle 174')
      expect(doc).toContain('THE NEW LONGEST ZERO-FIRE WINDOW IN THE [ID-0067] LEDGER HISTORY at the 40-cycle EXACT-ROUND-NUMBER milestone')
    })

    it('pins the 30-cycle sub-30 % milestone EXACT-ROUND-NUMBER threshold crossing (Cycles 184-213)', () => {
      const doc = loadEditWorkflow()
      expect(doc).toContain('sub-30 % milestone EXTENDED to 30 consecutive cycles')
      expect(doc).toContain('30-CYCLE EXACT-ROUND-NUMBER THRESHOLD CROSSING for the sub-30 % streak')
      expect(doc).toContain('Cycles 184-213')
    })

    it('pins the v31 final cumulative rate 49/179 (27.4 %) and the +0.5 pp net up-tick vs. v30 close', () => {
      const doc = loadEditWorkflow()
      // v30 close was 45/167 (26.9 %); v31 close is 49/179 (27.4 %); +0.5 pp net up-tick.
      expect(doc).toContain('49/179 (Cycle 213 v31 close, 27.4 %)')
      expect(doc).toContain('NET +0.5 pp vs. v30 close low watermark 26.9 %')
    })

    it('pins the v25 -> v31 stable-band trajectory PLATEAU at ~27 % (FIRST upward v-window-close drift)', () => {
      const doc = loadEditWorkflow()
      // Steady ~1.0-pp-per-v-window downward trajectory PLATEAUS at v31 due to 4 in-cycle fixes
      // (Cycles 205 + 208 + 210 + 213). v31 ends at the same ~27 % band v30 closed at.
      expect(doc).toContain('v25 (~32 %) -> v26 (~31 %) -> v27 (~30 %) -> v28 (~29 %) -> v29 (~28 %) -> v30 (~27 %) -> **v31 (~27 % PLATEAU)**')
      expect(doc).toContain('FIRST upward v-window-close drift in the post-Cycle-127-reset stable-band trajectory')
    })

    it('pins the assertion-side-fix sub-class extension to 14 ledger datapoints at v31 close', () => {
      const doc = loadEditWorkflow()
      // v30 close: 11 datapoints. v31 +4 cycle-level additions (Cycles 205 + 208 + 210 + 213).
      // Cycle 210 landed TWO fixes but counts as ONE sub-class cycle per cycle-level convention.
      expect(doc).toContain('14 ledger datapoints at v31 close')
      expect(doc).toContain('Cycles 146 + 150 + 161 + 162 + 163 + 176 + 187 + 188 + 189 + 194 + 199 + 205 + 208 + 210 + 213')
      expect(doc).toContain('TWO-fix-in-one-cycle sub-sub-class FIRST landing at Cycle 210')
    })

    it('pins the Cycle 210 NEW assertion-side-fix root-cause taxonomy (Function.length=2 + IEEE754 toFixed)', () => {
      const doc = loadEditWorkflow()
      // Cycle 210 introduced two NEW assertion-side-fix sub-class root causes that should
      // be visible in the v31 bullet so future cycles recognise these failure modes:
      // (i) Function.length=2 -- TS optional ?: params still count toward Function.length
      // (ii) IEEE754 toFixed half-down rounding -- (1.2345).toFixed(3) === '1.234'
      expect(doc).toContain('Function.length=2 vs 1')
      expect(doc).toContain('TS optional `?:` params still count toward Function.length')
      expect(doc).toContain('IEEE754 toFixed half-down rounding')
      expect(doc).toContain("(1.2345).toFixed(3) returns '1.234' not '1.235'")
    })

    it('pins the v31 13-cycle clean-Write line tally ~10576 lines (LARGEST v-window tally on record)', () => {
      const doc = loadEditWorkflow()
      // Sum across 11 paired-pin landings + 2 perf measurement-only cycles = ~10576 lines.
      expect(doc).toContain('= **~10576 lines**')
      expect(doc).toContain("LARGEST v-window clean-Write tally on record")
      expect(doc).toContain('beats v30')
    })

    it('pins v31 rotation-slot coverage 6 of 6 -- FIRST FULL-SLATE V-WINDOW IN THE LEDGER', () => {
      const doc = loadEditWorkflow()
      // First v-window in the [ID-0067-data-vN] ledger to cover all 6 rotation slots within
      // a single window. Chore slot remains last-touched Cycle 113 / 100 cooled.
      expect(doc).toContain('6 of 6 -- FIRST FULL-SLATE ROTATION COVERAGE V-WINDOW IN THE [ID-0067-data-vN] LEDGER')
      expect(doc).toContain('100-CYCLE EXACT-ROUND-NUMBER THRESHOLD CROSSING at Cycle 213')
    })

    it('pins the 1557-line NEW HIGH WATERMARK clean-Write line count at Cycle 212 manufacture-readiness-pin', () => {
      const doc = loadEditWorkflow()
      // Cycle 212 lands a 1557-line first-pass NEW-file Write -- NEW HIGH WATERMARK for the
      // post-Cycle-156-reset era, beating the prior 1478-line Cycle 202 record by 79 lines / 5.3 %.
      expect(doc).toContain('NEW HIGH WATERMARK for clean-Write line count in the post-Cycle-156-reset era at 1557 lines / Cycle 212')
      expect(doc).toContain('beats prior 1478-line Cycle 202 [ID-0274] gcode-safe-z-retract-invariants-pin record by 79 lines / 5.3 %')
    })

    it('pins the Cycle 209 cohort marginal cost 0.045 ms/test = NEW ALL-TIME LOW for paired-pin file batches', () => {
      const doc = loadEditWorkflow()
      expect(doc).toContain('0.045 ms/test = NEW ALL-TIME LOW')
      expect(doc).toContain('beats Cycle 198 -> 204 cohort 0.073 ms/test by 38 %')
    })

    it('pins the Cycle 209 [ID-0263] mean DOWNGRADED FOR SECOND CONSECUTIVE CYCLE (18.31 -> 18.18 -> 18.00)', () => {
      const doc = loadEditWorkflow()
      // [ID-0263] mean drift-watch decreased for the second consecutive cycle.
      // Threshold STILL TRIPPED but STRONGLY DOWNGRADED.
      expect(doc).toContain('[ID-0263] mean drift-watch DOWNGRADED FOR SECOND CONSECUTIVE CYCLE')
      expect(doc).toContain('18.31 Cycle 198 -> 18.18 Cycle 204 -> **18.00 Cycle 209**')
      expect(doc).toContain('FIRST TIME the [ID-0263] watch ledger has logged TWO consecutive decreases')
    })

    it('pins the Cycle 209 [ID-0270] cam-heightfield-2d5-pin DOWNWARD-TRENDING SECOND CONSECUTIVE CYCLE', () => {
      const doc = loadEditWorkflow()
      expect(doc).toContain('[ID-0270] cam-heightfield-2d5-pin DOWNWARD-TRENDING SECOND CONSECUTIVE CYCLE')
      expect(doc).toContain('3.78 Cycle 194/198 -> 3.56 Cycle 204 -> **3.51 Cycle 209**')
      expect(doc).toContain('cumulative -7.1 % from C194 establish over 15 cycles')
    })

    it('pins the FIRST-EDIT-AFTER-WRITE hard rule durability across all 40 v25-v31 cycles', () => {
      const doc = loadEditWorkflow()
      expect(doc).toContain('FIRST-EDIT-AFTER-WRITE hard rule (codified at Cycle 174 [ID-0067-data-v25]) HOLDING cleanly across ALL 40 v25-v26-v27-v28-v29-v30-v31 cycles')
    })

    it('pins the splice-recovery sub-ledger composition at v31 close (14 + 1 + 2 + 1)', () => {
      const doc = loadEditWorkflow()
      // v31 close composition: 14 assertion-side-fix + 1 sequential-replace_all + 2 FIRST-EDIT-AFTER-WRITE + 1 parse-time heredoc-mangling.
      expect(doc).toContain('**14** assertion-side-fix sub-class datapoints')
      expect(doc).toContain('1 sequential-replace_all sub-class datapoint at Cycle 165')
      expect(doc).toContain('2 FIRST-EDIT-AFTER-WRITE sub-class datapoints at Cycle 171')
      expect(doc).toContain('1 parse-time heredoc-mangling sub-class datapoint at Cycle 197')
    })
  })

  describe('[ID-0067-data-v32] Cycle 219 data update -- Cycles 214-218 v32 surface', () => {
    it('records the Cycle 219 escalation bullet provenance in the Rule 1.5 mandatory-territory checklist ([ID-0067-data-v32])', () => {
      const doc = loadEditWorkflow()
      expect(doc).toMatch(/Cycle 219 escalation/)
      expect(doc).toMatch(/\[ID-0067-data-v32\]/)
    })

    it('extends the Rule 1.5 header chain to include Cycle 218 (Cycle 213 -> Cycle 218 adjacency)', () => {
      const doc = loadEditWorkflow()
      // The v31 header chain ended with `Cycle 184, Cycle 189, Cycle 195, Cycle 200, Cycle 213`. The v32
      // update extends it to `Cycle 184, Cycle 189, Cycle 195, Cycle 200, Cycle 213, Cycle 218`.
      // Cycle 218 is the LAST cycle in the v32 surface (Cycles 214-218); Cycle 219 is the
      // update cycle itself and is NOT in the header chain (mirrors v31: surface 201-213,
      // update Cycle 214 -- header tail was Cycle 213, not Cycle 214).
      expect(doc).toMatch(/Cycle 184, Cycle 189, Cycle 195, Cycle 200, Cycle 213, Cycle 218 \[ID-0067\] data update/)
    })

    it('pins the 42-cycle ZERO-Edit-tool-fire run since Cycle 174 ENDING at Cycle 216 (FIRST Edit-tool fire since Cycle 174 codification)', () => {
      const doc = loadEditWorkflow()
      // The 42-cycle ZERO-Edit-tool-fire run that began at Cycle 174 [ID-0067-data-v25]
      // ENDS at Cycle 216 [ID-0288] cam-setup-defaults-pin -- the FIRST Edit-tool fire
      // since the FIRST-EDIT-AFTER-WRITE rule was codified at Cycle 174.
      expect(doc).toContain('42-cycle ZERO-Edit-tool-fire run since Cycle 174 ENDS at Cycle 216')
      expect(doc).toContain('FIRST Edit-tool fire since Cycle 174')
    })

    it('pins the post-Cycle-216 ZERO-Edit-tool-fire streak begin (Cycles 217 + 218 = 2 consecutive)', () => {
      const doc = loadEditWorkflow()
      expect(doc).toContain('NEW post-Cycle-216 ZERO-Edit-tool-fire streak begins')
      expect(doc).toContain('reaching 2 consecutive cycles by Cycle 218 close')
    })

    it('pins the assertion-side-fix sub-class extension to 18 ledger datapoints at v32 close', () => {
      const doc = loadEditWorkflow()
      // v31 close: 14 datapoints. v32 +4 cycle-level additions (Cycles 214 + 215 + 216 + 217).
      expect(doc).toContain('18 ledger datapoints at v32 close')
      expect(doc).toContain('Cycles 146 + 150 + 161 + 162 + 163 + 176 + 187 + 188 + 189 + 194 + 199 + 205 + 208 + 210 + 213 + 214 + 215 + 216 + 217')
    })

    it('pins the NEW mid-880-line-file silent-truncation-with-recovery sub-class established at Cycle 216', () => {
      const doc = loadEditWorkflow()
      // The Cycle 216 [ID-0288] cam-setup-defaults-pin Edit-tool fire established a NEW
      // [ID-0067] sub-class: mid-880-line-file silent-truncation-with-recovery. Tail dropped
      // at byte ~30896, file truncated mid-string-literal at line 881; recovery via
      // Python-via-bash splice under [ID-0095] count==1 marker-uniqueness gate.
      expect(doc).toContain('mid-880-line-file silent-truncation-with-recovery')
      expect(doc).toContain('tail dropped at byte ~30896')
      expect(doc).toContain('truncated mid-string-literal at line 881')
      expect(doc).toContain("anchor `it ('all dimension-returning helpers return number | undefin`")
    })

    it('pins the v32 final cumulative rate 53/183 (29.0 %) and the +1.2 pp net up-tick vs. v31 close', () => {
      const doc = loadEditWorkflow()
      // v31 close was 50/180 (27.8 %); v32 close is 53/183 (29.0 %); +1.2 pp net up-tick.
      expect(doc).toContain('53/183 (Cycle 217 v32 close, 29.0 %)')
      expect(doc).toContain('NET +1.2 pp vs. v31 close 27.8 %')
    })

    it('pins the v25 -> v32 stable-band trajectory UP-DRIFT (SECOND consecutive upward v-window-close drift)', () => {
      const doc = loadEditWorkflow()
      // v25 (~32) -> v26 (~31) -> v27 (~30) -> v28 (~29) -> v29 (~28) -> v30 (~27) ->
      // v31 (~27 PLATEAU) -> v32 (~29 UP-DRIFT). The FIRST multi-window upward drift in the ledger.
      expect(doc).toContain('v25 (~32 %) -> v26 (~31 %) -> v27 (~30 %) -> v28 (~29 %) -> v29 (~28 %) -> v30 (~27 %) -> v31 (~27 % PLATEAU) -> **v32 (~29 % UP-DRIFT)**')
      expect(doc).toContain('FIRST multi-window upward drift in the ledger')
    })

    it('pins the sub-30 % milestone EXTENDED to 35 consecutive cycles (Cycles 184-218)', () => {
      const doc = loadEditWorkflow()
      expect(doc).toContain('sub-30 % milestone EXTENDED to **35 consecutive cycles**')
      expect(doc).toContain('Cycles 184-218')
    })

    it('pins the FIRST-EDIT-AFTER-WRITE hard rule held cleanly across 42 v25-v31 cycles before Cycle 216 ENDED the streak', () => {
      const doc = loadEditWorkflow()
      // The Cycle 216 fire was on a Cycle-216-Write file, so FIRST-EDIT-AFTER-WRITE applied
      // AND was violated -- the rule's effectiveness depends on agent compliance, not on
      // the rule's mere existence; the v32 datapoint REINFORCES the rule rather than weakening it.
      expect(doc).toContain('HOLDING cleanly across **42 v25-v31 cycles** before the Cycle 216 fire ENDED the streak')
      expect(doc).toContain("the rule's effectiveness depends on agent compliance, not on the rule's mere existence")
    })

    it('pins the [ID-0263] mean drift-watch RE-TRIPPED at Cycle 218 (TWO-FILE-PROXY artifact)', () => {
      const doc = loadEditWorkflow()
      // [ID-0263] re-tripped after Cycle 209 had downgraded it. Driver is the two-file
      // Real-CAM-math class proxy. Action at next perf cycle: split into Lean +
      // Real-CAM-math subset means.
      expect(doc).toContain('[ID-0263] mean drift-watch RE-TRIPPED at Cycle 218')
      expect(doc).toContain('TWO-FILE-PROXY artifact')
      expect(doc).toContain('split inventory into Lean + Real-CAM-math subset means')
    })

    it('pins the NEW [ID-0294] file-level perf watch FILED at Cycle 218 for cam-voxel-removal-proxy-pin', () => {
      const doc = loadEditWorkflow()
      // C218 perf cycle filed [ID-0294] for cam-voxel-removal-proxy-pin (Real-CAM-math class
      // floor at 1.04 ms/test); thresholds 500 ms file-level + 3.0 ms/test.
      expect(doc).toContain('NEW [ID-0294] file-level perf watch FILED at Cycle 218')
      expect(doc).toContain('cam-voxel-removal-proxy-pin.test.ts')
      expect(doc).toContain('500 ms file-level + 3.0 ms/test')
    })

    it('pins the two-class paired-pin perf taxonomy update -- Real-CAM-math class now has TWO files', () => {
      const doc = loadEditWorkflow()
      // After Cycle 215 voxel-removal-proxy-pin landed, the Real-CAM-math class crossed
      // from a single-file proxy to a TWO-file class proper.
      expect(doc).toContain('Real-CAM-math class now has **TWO files**')
      expect(doc).toContain('class proper rather than single-file proxy')
    })

    it('pins the v32 5-cycle clean-Write line tally 2537 lines + 4-of-6 rotation-slot coverage', () => {
      const doc = loadEditWorkflow()
      // v32 5-cycle clean-Write tally = 0 + 912 + 892 + 733 + 0 = 2537 lines across
      // 3 paired-pin landings + 1 docs in-place + 1 perf measurement-only.
      expect(doc).toContain('= **2537 lines**')
      expect(doc).toContain('4 of 6')
    })

    it('pins the Cycle 216 880-line / ~30896-byte NEW empirical FILE-SIZE DATAPOINT for Edit-tool silent-truncation', () => {
      const doc = loadEditWorkflow()
      // The Cycle 216 fire establishes an 880-line / ~30896-byte empirical datapoint for
      // Rule 1.5 trigger #1 (>800-line file) on plain-ASCII content with no multi-byte
      // UTF-8 separators and no complex regex literals -- size alone was the trigger.
      expect(doc).toContain('NEW empirical FILE-SIZE DATAPOINT for Edit-tool silent-truncation')
      expect(doc).toContain('880-line / ~30896-byte mark')
      expect(doc).toContain('Rule 1.5 trigger #1 (>800-line file) as the LOAD-BEARING trigger')
    })

    it('pins the splice-recovery sub-ledger composition at v32 close (18 + 1 + 2 + 1 + 1)', () => {
      const doc = loadEditWorkflow()
      // v32 close composition: 18 assertion-side-fix + 1 sequential-replace_all +
      // 2 FIRST-EDIT-AFTER-WRITE + 1 parse-time heredoc-mangling + 1 NEW mid-880-line silent-truncation.
      expect(doc).toContain('**18** assertion-side-fix sub-class datapoints')
      expect(doc).toContain('1 sequential-replace_all sub-class datapoint at Cycle 165')
      expect(doc).toContain('2 FIRST-EDIT-AFTER-WRITE sub-class datapoints at Cycle 171')
      expect(doc).toContain('1 parse-time heredoc-mangling sub-class datapoint at Cycle 197')
      expect(doc).toContain('**1 NEW mid-880-line-file silent-truncation-with-recovery sub-class datapoint at Cycle 216**')
    })

    it('pins the operational lesson: 42 ZERO-fire cycles do NOT relax Rule 1.5 trigger #1 (>800-line file) compliance', () => {
      const doc = loadEditWorkflow()
      // The Cycle 216 fire happened AFTER 42 consecutive ZERO-fire cycles -- the long
      // ZERO-fire run does NOT relax the rule; pin-authoring volume continues to grow so
      // the agent will REPEATEDLY encounter mandatory-territory triggers; the FIRST-EDIT-
      // AFTER-WRITE hard rule covers Edit fires WITHIN a session (after a Write) but the
      // Cycle 216 fire was on a Cycle-216-Write file, so the rule applied AND was violated.
      expect(doc).toContain('the long ZERO-fire run does NOT relax the rule')
      expect(doc).toContain('future cycles must default to Python-via-bash str.replace FROM THE FIRST EDIT')
    })
  })

  })
})
