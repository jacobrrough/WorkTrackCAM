/**
 * Wave 3l wiring pins -- companion placement stamping (nesting finishers).
 *
 * Style mirrors `src/main/nesting/laguna-nesting-pin.test.ts` (read the
 * source files, assert the load-bearing lines). That file is the Wave 3j
 * contract and is deliberately left untouched; THIS file extends the same
 * E5-style pin chain for the Wave 3l drift it cannot describe:
 *
 * INTENDED DRIFT (Wave 3l) vs the Wave 3j pins:
 *   - D6 over there pins `op.kind !== 'cnc_contour'` with the comment
 *     "Must only mutate cnc_contour ops". That guard is STILL TRUE for
 *     DIRECT placements (the nest only places contour outlines, and a
 *     placement keyed to a non-contour op id is still ignored -- W4 below
 *     re-pins the literal). What changed: COMPANION 2D ops
 *     (pocket / v-carve / chamfer / drill of the SAME nested part) now
 *     inherit the part's placement through the documented association rule
 *     in `src/shared/cam-placement-siblings.ts` (same setup + unambiguous
 *     containment in the nested outline), because a part is usually cut by
 *     several ops and moving only the outline scraps the sheet.
 *   - E5 over there pins the sheet>0 strip lines -- those survive verbatim,
 *     and the strip now ALSO clears the Wave 3l anchor params (W3 below).
 *
 * Behavior coverage lives in the pure planners' own suites:
 *   - association rule:      src/shared/cam-placement-siblings.test.ts
 *   - transform consumption: src/shared/cam-placement-transform.test.ts
 * This file pins the WIRING so the workspace executor cannot silently
 * disconnect from the planner.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPO_ROOT = resolve(__dirname, '..', '..', '..')

const WORKSPACE_SRC = readFileSync(
  resolve(REPO_ROOT, 'src', 'renderer', 'manufacture', 'ManufactureWorkspace.tsx'),
  'utf-8'
)
const PANEL_SRC = readFileSync(
  resolve(REPO_ROOT, 'src', 'renderer', 'manufacture', 'LagunaNestingPanel.tsx'),
  'utf-8'
)
const SIBLINGS_SRC = readFileSync(
  resolve(REPO_ROOT, 'src', 'shared', 'cam-placement-siblings.ts'),
  'utf-8'
)
const TRANSFORM_SRC = readFileSync(
  resolve(REPO_ROOT, 'src', 'shared', 'cam-placement-transform.ts'),
  'utf-8'
)

describe('W. Wave 3l workspace executor wiring (applyNestingPlacements)', () => {
  it('W1: the workspace imports + calls the shared stamp planner', () => {
    expect(WORKSPACE_SRC).toContain(
      "import { planNestingPlacementStamps } from '../../shared/cam-placement-siblings'"
    )
    expect(WORKSPACE_SRC).toMatch(/planNestingPlacementStamps\(plate\.operations,\s*placements\)/)
  })

  it('W2: companion stamps write BOTH anchor params from the plan entry', () => {
    expect(WORKSPACE_SRC).toMatch(
      /baseParams\.placementAnchorMinXMm\s*=\s*entry\.anchorMinXMm/
    )
    expect(WORKSPACE_SRC).toMatch(
      /baseParams\.placementAnchorMinYMm\s*=\s*entry\.anchorMinYMm/
    )
    // Companion-gated: only viaSibling entries carry the anchor.
    expect(WORKSPACE_SRC).toMatch(/entry\.viaSibling\s*&&/)
  })

  it('W3: the sheet>0 strip ALSO clears the Wave 3l anchor params (overflow honesty)', () => {
    expect(WORKSPACE_SRC).toMatch(/delete\s+baseParams\.placementAnchorMinXMm/)
    expect(WORKSPACE_SRC).toMatch(/delete\s+baseParams\.placementAnchorMinYMm/)
    // And the Wave 3j strip lines the no-touch E5 pin requires are intact.
    expect(WORKSPACE_SRC).toMatch(/delete\s+baseParams\.placementXMm/)
    expect(WORKSPACE_SRC).toMatch(/delete\s+baseParams\.placementNestVersion/)
  })

  it('W4: direct placements still only land on cnc_contour ops (Wave 3j guard intact)', () => {
    expect(WORKSPACE_SRC).toMatch(/byId\.has\(op\.id\)\s*&&\s*op\.kind\s*!==\s*'cnc_contour'/)
  })

  it('W5: applyNestingPlacements returns the companion stamp count for the panel', () => {
    expect(WORKSPACE_SRC).toMatch(/nestVersion\?\:\s*string\s*\n\s*\)\: number \{/)
    expect(WORKSPACE_SRC).toContain('return companionStampCount')
  })

  it('W6: contour ops never keep a stale companion anchor (re-nest hygiene)', () => {
    // The else-branch delete pair must exist OUTSIDE the strip branch too --
    // pinned by requiring two delete occurrences per anchor param.
    const xDeletes = WORKSPACE_SRC.match(/delete\s+baseParams\.placementAnchorMinXMm/g) ?? []
    const yDeletes = WORKSPACE_SRC.match(/delete\s+baseParams\.placementAnchorMinYMm/g) ?? []
    expect(xDeletes.length).toBe(2)
    expect(yDeletes.length).toBe(2)
  })
})

describe('P. Wave 3l panel honesty (LagunaNestingPanel)', () => {
  it('P1: the apply status reports companion stamps when the workspace returns a count', () => {
    expect(PANEL_SRC).toContain('const companionStamps = onApplyPlacements(')
    expect(PANEL_SRC).toMatch(/typeof companionStamps === 'number' && companionStamps > 0/)
    expect(PANEL_SRC).toContain('companion 2D op(s) of the same part(s)')
  })

  it('P2: the callback type is additively widened to `number | void` (older callers stay valid)', () => {
    expect(PANEL_SRC).toMatch(/\)\s*=>\s*number \| void/)
  })

  it('P3: the Wave 3j overflow honesty message is untouched (NOT applied)', () => {
    expect(PANEL_SRC).toMatch(/NOT applied/)
  })
})

describe('S. Wave 3l shared planner module surface', () => {
  it('S1: documents the association rule the executor relies on', () => {
    expect(SIBLINGS_SRC).toContain('ASSOCIATION RULE')
    expect(SIBLINGS_SRC).toContain('SAME SETUP')
    expect(SIBLINGS_SRC).toContain('GEOMETRIC CONTAINMENT')
    expect(SIBLINGS_SRC).toContain('UNIQUENESS')
  })

  it('S2: exports the planner + the exact companion kind set', () => {
    expect(SIBLINGS_SRC).toMatch(/export\s+function\s+planNestingPlacementStamps\b/)
    expect(SIBLINGS_SRC).toMatch(/export\s+const\s+COMPANION_2D_OP_KINDS\b/)
    for (const kind of ["'cnc_pocket'", "'cnc_vcarve'", "'cnc_chamfer'", "'cnc_drill'"]) {
      expect(SIBLINGS_SRC).toContain(kind)
    }
  })

  it('S3: anchor math reuses the dispatcher rotation kernel (bit-parity on cardinals)', () => {
    expect(SIBLINGS_SRC).toContain(
      "import { rotatePointCcwDeg } from './cam-placement-transform'"
    )
  })
})

describe('T. Wave 3l transform consumption (cam-placement-transform)', () => {
  it('T1: the dispatcher-side transform resolves the anchor override', () => {
    expect(TRANSFORM_SRC).toContain("params['placementAnchorMinXMm']")
    expect(TRANSFORM_SRC).toContain("params['placementAnchorMinYMm']")
  })

  it('T2: a half-written anchor is identity, never a wrong-corner move', () => {
    expect(TRANSFORM_SRC).toMatch(/anchorMin\.kind === 'invalid'\) return params/)
  })

  it('T3: the valid anchor replaces the own-bbox translation derivation', () => {
    expect(TRANSFORM_SRC).toMatch(/anchorMin\.kind === 'valid' && bboxSource\.length > 0/)
    expect(TRANSFORM_SRC).toMatch(/dxMm: placement\.xMm - anchorMin\.minXMm/)
    expect(TRANSFORM_SRC).toMatch(/dyMm: placement\.yMm - anchorMin\.minYMm/)
  })
})

describe('Schema compatibility: Wave 3l anchor params parse under the existing manufacture schema', () => {
  it('manufactureFileSchema accepts companion params with placement* + anchor fields', async () => {
    const { manufactureFileSchema } = await import('../../shared/manufacture-schema')
    const payload = {
      version: 1 as const,
      setups: [],
      operations: [
        {
          id: 'op-pocket-1',
          kind: 'cnc_pocket' as const,
          label: 'Pocket with companion placement',
          params: {
            contourPoints: [
              [20, 20],
              [40, 20],
              [40, 40]
            ],
            placementXMm: 500,
            placementYMm: 700,
            placementRotationDeg: 90,
            placementNestVersion: 'nfp-v2',
            placementSheetIndex: 0,
            placementAnchorMinXMm: -100,
            placementAnchorMinYMm: 0
          }
        }
      ]
    }
    expect(() => manufactureFileSchema.parse(payload)).not.toThrow()
  })
})
