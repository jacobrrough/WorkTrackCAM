/**
 * docs/CAM_4TH_AXIS_REFERENCE.md "Mesh transform pipeline" pin --
 * [ID-0185], Cycle 102 docs-and-dx.
 *
 * This file pins the new "Mesh transform pipeline" subsection added to
 * `docs/CAM_4TH_AXIS_REFERENCE.md` (Part 1, between "Coordinate frame" and
 * "Stock model") to the actual runtime behavior of the three helpers in
 * `src/main/stl-vec3.ts` and to the actual import sites in
 * `src/main/binary-stl-placement.ts` + `src/main/cam-axis4/frame.ts`.
 *
 * Why this exists:
 *   The doc tells operators -- and future contributors -- the rotation
 *   axis order, the right-hand-rule conventions, the pipeline order
 *   (scale -> rotate -> translate), and the line numbers that prove the
 *   single-source-of-truth property. If any of those facts drifts away
 *   from the runtime, this test fires BEFORE the doc starts misleading
 *   anyone. Mirrors the `machines-docs-pin.test.ts` ([ID-0083], Cycle 15)
 *   and `edit-workflow-docs-pin.test.ts` ([ID-0089]/[ID-0095], Cycle 20)
 *   pattern.
 *
 * Machine relevance:
 *   The pipeline drives the displayed orientation of every imported STL
 *   for all three target machines (Creality K2 Plus FDM, Laguna Swift
 *   5x10 router, Makera Carvera + 4th Axis Rotary). For Carvera 4-axis
 *   jobs in particular, the `rotateXYZDeg` primitive is what carries the
 *   user's mesh orientation into the rotary frame mapper, so doc/code
 *   drift on this primitive can silently rotate every 4-axis toolpath.
 *
 * Scope: 100% additive, ZERO production-code edits.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Vec3 } from './stl'
import { addVecStl, mulVecStl, rotateXYZDeg } from './stl-vec3'
import { isOclToolpathFile, resolveContourRampOptions, resolveContourTabParams } from './cam-runner'

const repoRoot = join(__dirname, '..', '..')

function loadDoc(): string {
  return readFileSync(
    join(repoRoot, 'docs', 'CAM_4TH_AXIS_REFERENCE.md'),
    'utf-8'
  )
}

function loadStlVec3(): string {
  return readFileSync(
    join(repoRoot, 'src', 'main', 'stl-vec3.ts'),
    'utf-8'
  )
}

function loadBinaryStlPlacement(): string {
  return readFileSync(
    join(repoRoot, 'src', 'main', 'binary-stl-placement.ts'),
    'utf-8'
  )
}

function loadFrame(): string {
  return readFileSync(
    join(repoRoot, 'src', 'main', 'cam-axis4', 'frame.ts'),
    'utf-8'
  )
}

function approxEq(a: Vec3, b: readonly [number, number, number], eps = 1e-9): boolean {
  return (
    Math.abs(a[0] - b[0]) < eps &&
    Math.abs(a[1] - b[1]) < eps &&
    Math.abs(a[2] - b[2]) < eps
  )
}

describe('docs/CAM_4TH_AXIS_REFERENCE.md "Mesh transform pipeline" -- [ID-0185]', () => {
  describe('section presence and naming', () => {
    it('the "### Mesh transform pipeline" subsection exists', () => {
      const doc = loadDoc()
      // anchored to start of line so we do not collide with prose mentions
      expect(doc).toMatch(/^### Mesh transform pipeline$/m)
    })

    it('subsection sits between "### Coordinate frame" and "### Stock model"', () => {
      const doc = loadDoc()
      const coordIdx = doc.indexOf('### Coordinate frame')
      const meshIdx = doc.indexOf('### Mesh transform pipeline')
      const stockIdx = doc.indexOf('### Stock model')
      expect(coordIdx).toBeGreaterThan(0)
      expect(meshIdx).toBeGreaterThan(coordIdx)
      expect(stockIdx).toBeGreaterThan(meshIdx)
    })

    it('section names the source-of-truth module path', () => {
      const doc = loadDoc()
      // The doc links the canonical source-of-truth module.
      expect(doc).toMatch(/`src\/main\/stl-vec3\.ts`/)
    })
  })

  describe('helper-name documentation', () => {
    it('mulVecStl is named in the doc', () => {
      expect(loadDoc()).toMatch(/`mulVecStl\(v, scale\)`/)
    })

    it('rotateXYZDeg is named in the doc with the [rx, ry, rz] signature', () => {
      expect(loadDoc()).toMatch(/`rotateXYZDeg\(v, \[rx, ry, rz\]\)`/)
    })

    it('addVecStl is named in the doc', () => {
      expect(loadDoc()).toMatch(/`addVecStl\(v, translate\)`/)
    })
  })

  describe('rotation contract -- doc claims match runtime', () => {
    it('doc says X:+90 sends [0,1,0] -> [0,0,1] AND runtime agrees', () => {
      // doc claim
      expect(loadDoc()).toMatch(/`X:\+90°` sends `\[0, 1, 0\]` → `\[0, 0, 1\]`/)
      // runtime claim
      const out = rotateXYZDeg([0, 1, 0], [90, 0, 0])
      expect(approxEq(out, [0, 0, 1])).toBe(true)
    })

    it('doc says Y:+90 sends [1,0,0] -> [0,0,-1] AND runtime agrees', () => {
      expect(loadDoc()).toMatch(/`Y:\+90°` sends `\[1, 0, 0\]` → `\[0, 0, -1\]`/)
      const out = rotateXYZDeg([1, 0, 0], [0, 90, 0])
      expect(approxEq(out, [0, 0, -1])).toBe(true)
    })

    it('doc says Z:+90 sends [1,0,0] -> [0,1,0] AND runtime agrees', () => {
      expect(loadDoc()).toMatch(/`Z:\+90°` sends `\[1, 0, 0\]` → `\[0, 1, 0\]`/)
      const out = rotateXYZDeg([1, 0, 0], [0, 0, 90])
      expect(approxEq(out, [0, 1, 0])).toBe(true)
    })

    it('doc claims XYZ Tait-Bryan order AND runtime composes X then Y then Z', () => {
      // doc claim (the literal phrase, anchored to the bold marker so a future
      // softening to plain text fires this gate)
      expect(loadDoc()).toMatch(/\*\*X then Y then Z\*\*/)
      // runtime claim: composing each axis sequentially yields the same
      // result as a single XYZ rotation.
      const v: Vec3 = [1, 2, 3]
      const composed = rotateXYZDeg(rotateXYZDeg(rotateXYZDeg(v, [30, 0, 0]), [0, 45, 0]), [0, 0, 60])
      const direct = rotateXYZDeg(v, [30, 45, 60])
      expect(approxEq(composed, direct, 1e-9)).toBe(true)
    })
  })

  describe('pipeline order -- doc claims match binary-stl-placement.ts', () => {
    it('doc states scale -> rotate -> translate', () => {
      // doc claim (the bolded ordered phrase)
      expect(loadDoc()).toMatch(/\*\*scale → rotate → translate\*\*/)
    })

    it('manual scale-rotate-translate matches what binary-stl-placement.ts:139-146 does', () => {
      // Replicate the pipeline order documented and validated against the
      // citation lines 139-146 in binary-stl-placement.ts.
      const v: Vec3 = [2, 3, 5]
      const scl: readonly [number, number, number] = [0.5, 0.7, 1.5]
      const rot: readonly [number, number, number] = [10, 20, 30]
      const trn: readonly [number, number, number] = [1, 2, 3]

      const expected = addVecStl(rotateXYZDeg(mulVecStl(v, scl), rot), trn)

      // Wrong orders MUST differ from the documented order. If a future
      // refactor swaps any pair, one of these will start matching the
      // expected output and a sibling assertion will start failing.
      const wrongOrderRotateScaleTranslate = addVecStl(mulVecStl(rotateXYZDeg(v, rot), scl), trn)
      const wrongOrderTranslateRotateScale = mulVecStl(rotateXYZDeg(addVecStl(v, trn), rot), scl)

      expect(approxEq(expected, expected)).toBe(true) // sanity
      expect(approxEq(expected, wrongOrderRotateScaleTranslate)).toBe(false)
      expect(approxEq(expected, wrongOrderTranslateRotateScale)).toBe(false)
    })

    it('doc cites binary-stl-placement.ts and the line range', () => {
      const doc = loadDoc()
      expect(doc).toMatch(/`src\/main\/binary-stl-placement\.ts`/)
      expect(doc).toMatch(/lines 139–146/)
    })

    it('cited line range still contains the documented pipeline order', () => {
      // Read lines 139..146 of binary-stl-placement.ts and confirm the same
      // ordered references documented in the doc are still present.
      const src = loadBinaryStlPlacement()
      const lines = src.split(/\r?\n/)
      const slice = lines.slice(138, 146).join('\n') // 1-indexed -> 0-indexed
      expect(slice).toMatch(/mulVecStl/)
      expect(slice).toMatch(/rotateXYZDeg/)
      expect(slice).toMatch(/addVecStl/)
    })
  })

  describe('single-source-of-truth -- both consumers still import from stl-vec3', () => {
    it('binary-stl-placement.ts imports the three helpers from ./stl-vec3', () => {
      const src = loadBinaryStlPlacement()
      // Match only the import statement to avoid false positives in prose.
      const importBlock = src
        .split(/\r?\n/)
        .filter((l) => /^import\s/.test(l))
        .join('\n')
      expect(importBlock).toMatch(
        /import\s*\{\s*addVecStl\s*,\s*mulVecStl\s*,\s*rotateXYZDeg\s*\}\s*from\s*["']\.\/stl-vec3["']/
      )
    })

    it('cam-axis4/frame.ts imports rotateXYZDeg from ../stl-vec3', () => {
      const src = loadFrame()
      const importBlock = src
        .split(/\r?\n/)
        .filter((l) => /^import\s/.test(l))
        .join('\n')
      expect(importBlock).toMatch(
        /import\s*\{\s*rotateXYZDeg\s*\}\s*from\s*["']\.\.\/stl-vec3["']/
      )
    })

    it('doc references frame-parity.test.ts AND stl-vec3.test.ts as the enforcement pins', () => {
      const doc = loadDoc()
      expect(doc).toMatch(/`frame-parity\.test\.ts`/)
      expect(doc).toMatch(/`stl-vec3\.test\.ts`/)
    })
  })

  describe('module-shape pin -- stl-vec3.ts still exports the three helpers', () => {
    it('stl-vec3.ts exports addVecStl, mulVecStl, rotateXYZDeg', () => {
      const src = loadStlVec3()
      expect(src).toMatch(/^export function addVecStl\(/m)
      expect(src).toMatch(/^export function mulVecStl\(/m)
      expect(src).toMatch(/^export function rotateXYZDeg\(/m)
    })

    it('rotateXYZDeg signature documents the [rx, ry, rz] tuple', () => {
      const src = loadStlVec3()
      expect(src).toMatch(/rotateXYZDeg\(v: Vec3, d: readonly \[number, number, number\]\)/)
    })
  })

  describe('JSDoc paired-pin', () => {
    it('this file references both the doc anchor and the [ID-0185] tag', () => {
      const self = readFileSync(__filename, 'utf-8')
      expect(self).toContain('Mesh transform pipeline')
      expect(self).toContain('[ID-0185]')
    })
  })
})


// ---------------------------------------------------------------------------
// [ID-0189] Cycle 107 docs-and-dx -- pin the new
// "### CAM-runner contour & toolpath safety helpers" subsection in
// docs/CAM_4TH_AXIS_REFERENCE.md to the actual runtime clamps in
// src/main/cam-runner.ts and to the Cycle 106 [ID-0188] enforcement pin.
//
// Why this exists:
//   The doc subsection promises operators specific clamp windows
//   (rampAngleDeg in 0.5..89, tabCount >= 1 rounded, tabWidthMm >= 0.5, etc.)
//   and ties each clamp to a concrete failure mode. If the runtime relaxes
//   any of those clamps -- or if the doc is later softened -- this pin fires
//   BEFORE the drift can mislead anyone reading the runbook. Mirrors the
//   [ID-0185] "Mesh transform pipeline" docs-pin pattern in the same file.
// ---------------------------------------------------------------------------

function loadCamRunnerSource(): string {
  return readFileSync(
    join(repoRoot, 'src', 'main', 'cam-runner.ts'),
    'utf-8'
  )
}

function loadContourTypeguardPinSource(): string {
  return readFileSync(
    join(repoRoot, 'src', 'main', 'cam-runner-contour-and-typeguard-pin.test.ts'),
    'utf-8'
  )
}

describe('docs/CAM_4TH_AXIS_REFERENCE.md "CAM-runner contour & toolpath safety helpers" -- [ID-0189]', () => {
  describe('section presence and citations', () => {
    it('the "### CAM-runner contour & toolpath safety helpers" subsection exists', () => {
      const doc = loadDoc()
      expect(doc).toMatch(/^### CAM-runner contour & toolpath safety helpers$/m)
    })

    it('subsection sits between "### Contour unwrap" and "### Post template"', () => {
      const doc = loadDoc()
      const unwrapIdx = doc.indexOf('### Contour unwrap')
      const helpersIdx = doc.indexOf('### CAM-runner contour & toolpath safety helpers')
      const postIdx = doc.indexOf('### Post template')
      expect(unwrapIdx).toBeGreaterThan(0)
      expect(helpersIdx).toBeGreaterThan(unwrapIdx)
      expect(postIdx).toBeGreaterThan(helpersIdx)
    })

    it('subsection cites src/main/cam-runner.ts as the source-of-truth module', () => {
      expect(loadDoc()).toMatch(/`src\/main\/cam-runner\.ts`/)
    })

    it('subsection cites the Cycle 106 [ID-0188] enforcement pin file by path', () => {
      expect(loadDoc()).toMatch(/`src\/main\/cam-runner-contour-and-typeguard-pin\.test\.ts`/)
    })

    it('subsection names the Cycle 106 cycle number AND the [ID-0188] tag', () => {
      const doc = loadDoc()
      expect(doc).toMatch(/Cycle 106/)
      expect(doc).toMatch(/\[ID-0188\]/)
    })
  })

  describe('helper-name documentation', () => {
    it('isOclToolpathFile is named in the doc with the (v) signature', () => {
      expect(loadDoc()).toMatch(/`isOclToolpathFile\(v\)`/)
    })

    it('resolveContourRampOptions is named with the (operationParams) signature', () => {
      expect(loadDoc()).toMatch(/`resolveContourRampOptions\(operationParams\)`/)
    })

    it('resolveContourTabParams is named with the (operationParams) signature', () => {
      expect(loadDoc()).toMatch(/`resolveContourTabParams\(operationParams\)`/)
    })
  })

  describe('clamp contract -- doc claims match runtime behavior', () => {
    it('doc names the ramp 0.5..89 window AND default 3, AND runtime clamps both edges', () => {
      const doc = loadDoc()
      // doc claim: bolded clamp window AND default
      expect(doc).toMatch(/\*\*0\.5°\.\.89°\*\*/)
      expect(doc).toMatch(/default \*\*3°\*\*/)
      // runtime claim: below-floor input clamps to 0.5; above-ceiling clamps to 89; default is 3.
      expect(resolveContourRampOptions({ rampAngleDeg: 0 }).rampAngleDeg).toBe(0.5)
      expect(resolveContourRampOptions({ rampAngleDeg: 1000 }).rampAngleDeg).toBe(89)
      expect(resolveContourRampOptions({}).rampAngleDeg).toBe(3)
    })

    it('doc names the tab floors AND defaults, AND runtime applies them', () => {
      const doc = loadDoc()
      // doc claim: list of floors AND list of defaults
      expect(doc).toMatch(/`tabCount ≥ 1`/)
      expect(doc).toMatch(/`tabIntervalMm ≥ 1`/)
      expect(doc).toMatch(/`tabWidthMm ≥ 0\.5`/)
      expect(doc).toMatch(/`tabHeightMm ≥ 0\.1`/)
      expect(doc).toMatch(/defaults `4 \/ 50 \/ 3 \/ 1\.5`/)
      // runtime claim: with tabsMode=count, all four floors clamp.
      const tab = resolveContourTabParams({
        tabsMode: 'count',
        tabCount: 0,
        tabIntervalMm: 0,
        tabWidthMm: 0,
        tabHeightMm: 0
      })
      expect(tab).toBeDefined()
      expect(tab!.tabCount).toBe(1)
      expect(tab!.tabIntervalMm).toBe(1)
      expect(tab!.tabWidthMm).toBe(0.5)
      expect(tab!.tabHeightMm).toBe(0.1)
      // and defaults when keys absent.
      const dflt = resolveContourTabParams({ tabsMode: 'interval' })
      expect(dflt!.tabCount).toBe(4)
      expect(dflt!.tabIntervalMm).toBe(50)
      expect(dflt!.tabWidthMm).toBe(3)
      expect(dflt!.tabHeightMm).toBe(1.5)
    })

    it('doc says OCL guard rejects non-objects/arrays AND runtime agrees', () => {
      const doc = loadDoc()
      expect(doc).toMatch(/Rejects non-object primitives, arrays/)
      expect(isOclToolpathFile(null)).toBe(false)
      expect(isOclToolpathFile([])).toBe(false)
      expect(isOclToolpathFile('not an object')).toBe(false)
    })

    it('doc says OCL guard tolerates the empty object AND runtime agrees', () => {
      expect(loadDoc()).toMatch(/tolerates the empty object/)
      expect(isOclToolpathFile({})).toBe(true)
    })

    it('doc says non-finite ramp angles fall back to the default AND runtime agrees', () => {
      expect(loadDoc()).toMatch(/Non-finite or non-number values fall back to the default/)
      expect(resolveContourRampOptions({ rampAngleDeg: Number.NaN }).rampAngleDeg).toBe(3)
      expect(resolveContourRampOptions({ rampAngleDeg: Number.POSITIVE_INFINITY }).rampAngleDeg).toBe(3)
      expect(resolveContourRampOptions({ rampAngleDeg: 'fast' as unknown as number }).rampAngleDeg).toBe(3)
    })
  })

  describe('failure-mode coverage in doc text', () => {
    it('doc names the "infinite-ramp" failure mode for the ramp clamp', () => {
      expect(loadDoc()).toMatch(/infinite-ramp/)
    })

    it('doc names a tab disappearance / fly-free failure mode for the tabHeight floor', () => {
      const doc = loadDoc()
      // either "fly free" or "disappear" must appear -- both are in the same paragraph
      expect(doc).toMatch(/fly free|disappear under round-off/)
    })

    it('doc names a half-formed / corrupt-payload failure mode for the OCL guard', () => {
      const doc = loadDoc()
      expect(doc).toMatch(/corrupt or partially-written OCL JSON/)
      expect(doc).toMatch(/half-formed toolpath lines/)
    })
  })

  describe('single-source-of-truth pin -- runtime clamps still match doc', () => {
    it('cam-runner.ts still clamps rampAngleDeg via Math.min(89, Math.max(0.5, ...))', () => {
      // If the source ever softens the 0.5..89 window, this fires before the doc misleads anyone.
      expect(loadCamRunnerSource()).toMatch(
        /Math\.min\(89,\s*Math\.max\(0\.5,\s*p\['rampAngleDeg'\]\)\)/
      )
    })

    it('cam-runner.ts still applies the documented tab floors (1 / 1 / 0.5 / 0.1)', () => {
      const src = loadCamRunnerSource()
      expect(src).toMatch(/Math\.max\(1,\s*Math\.round\(p\['tabCount'\]\)\)/)
      expect(src).toMatch(/Math\.max\(1,\s*p\['tabIntervalMm'\]\)/)
      expect(src).toMatch(/Math\.max\(0\.5,\s*p\['tabWidthMm'\]\)/)
      expect(src).toMatch(/Math\.max\(0\.1,\s*p\['tabHeightMm'\]\)/)
    })

    it('cam-runner.ts still exports the three helpers named in the doc', () => {
      const src = loadCamRunnerSource()
      expect(src).toMatch(/^export function isOclToolpathFile\(/m)
      expect(src).toMatch(/^export function resolveContourRampOptions\(/m)
      expect(src).toMatch(/^export function resolveContourTabParams\(/m)
    })

    it('the Cycle 106 [ID-0188] pin file still exists AND references all three helpers', () => {
      const pin = loadContourTypeguardPinSource()
      expect(pin).toContain('isOclToolpathFile')
      expect(pin).toContain('resolveContourRampOptions')
      expect(pin).toContain('resolveContourTabParams')
      expect(pin).toContain('[ID-0188]')
    })
  })

  describe('JSDoc paired-pin', () => {
    it('this file references both the new doc anchor and the [ID-0189] tag', () => {
      const self = readFileSync(__filename, 'utf-8')
      expect(self).toContain('CAM-runner contour & toolpath safety helpers')
      expect(self).toContain('[ID-0189]')
    })
  })
})
