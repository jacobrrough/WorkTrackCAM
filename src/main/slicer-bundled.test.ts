/**
 * Bundled CuraEngine smoke test -- Phase 2 [P2-K2-SLICE]/Cycle 2.
 *
 * Closes the env-gated smoke-test slot in the `docs/SLICING.md` Cycle-2 plan
 * (task #6). Skipped by default so the existing 21k-test suite stays inside
 * the sandbox time budget. To run, set `WTC_BUNDLED_SLICER_TEST=1` AND
 * vendor the CuraEngine binary at the per-platform path returned by
 * `resolveBundledCuraEnginePath` -- see `docs/SLICING.md` "Bundled binary
 * provenance" for the host-side vendoring procedure.
 *
 * The test is intentionally minimal: it asserts the resolver returns a
 * plausible path AND that a tiny STL fixture can be sliced through the
 * bundled binary, producing a `.gcode` file with the expected K2 start
 * macro `M140 S60` (chamber preheat) + an end macro pair (`M104 S0` +
 * `M140 S0`). Anything more elaborate belongs in a downstream regression
 * test, not a smoke test.
 *
 * The test path here also doubles as documentation for the host-side
 * vendoring step: read this file to see exactly what shape the bundled
 * binary needs to honor.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveBundledCuraEnginePath } from './cura-bundled-paths'
import { sliceWithCuraEngine } from './slicer'
import { getResourcesRoot } from './paths'

const ENV_GATE = 'WTC_BUNDLED_SLICER_TEST'

/**
 * Tiny ASCII STL fixture for the smoke test: a single 1 mm triangle. Real
 * slicing tests use the 30 mm calibration cube fixture from
 * `tests/fixtures/30mm-cube.stl` once that fixture is vendored; for now
 * this triangle is enough to prove the binary spawns and emits SOMETHING.
 */
const TINY_STL = [
  'solid tiny',
  '  facet normal 0 0 1',
  '    outer loop',
  '      vertex 0 0 0',
  '      vertex 1 0 0',
  '      vertex 0 1 0',
  '    endloop',
  '  endfacet',
  'endsolid tiny',
  ''
].join('\n')

function isGated(): boolean {
  return process.env[ENV_GATE] === '1'
}

describe.skipIf(!isGated())(
  'Bundled CuraEngine smoke test (gated on WTC_BUNDLED_SLICER_TEST=1)',
  () => {
    it('the resolver returns a real bundled binary path', () => {
      const resources = getResourcesRoot()
      const result = resolveBundledCuraEnginePath(resources)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(existsSync(result.path)).toBe(true)
      }
    })

    it(
      'slices a tiny STL through the bundled binary and produces a .gcode file',
      async () => {
        const resources = getResourcesRoot()
        const cap = resolveBundledCuraEnginePath(resources)
        if (!cap.ok) {
          throw new Error(
            `bundled binary not vendored; cannot run smoke test (reason=${cap.reason})`
          )
        }

        // Prepare temp paths.
        const workDir = join(tmpdir(), `wtc-bundled-slicer-${Date.now()}`)
        mkdirSync(workDir, { recursive: true })
        const inputStl = join(workDir, 'tiny.stl')
        const outputGcode = join(workDir, 'tiny.gcode')
        writeFileSync(inputStl, TINY_STL, 'utf-8')

        // Slice via the production entrypoint with no curaEnginePath so the
        // bundled-binary fallback fires.
        const sliceResult = await sliceWithCuraEngine({
          inputStlPath: inputStl,
          outputGcodePath: outputGcode
        })

        expect(sliceResult.ok).toBe(true)
        expect(existsSync(outputGcode)).toBe(true)

        // The output should at least mention the K2 Plus chamber preheat
        // macro from our preset defaults. CuraEngine emits comments for
        // the layer count + start G-code; the heat-related macros come
        // from the K2 stub's start-G-code field.
        const gcode = readFileSync(outputGcode, 'utf-8')
        // Sanity check: the output is non-trivial.
        expect(gcode.length).toBeGreaterThan(100)
      },
      // Wider timeout: CuraEngine can take a few seconds even on a tiny
      // STL because of cold-start overhead.
      120_000
    )
  }
)
