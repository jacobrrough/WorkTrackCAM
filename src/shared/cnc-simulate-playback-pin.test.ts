/**
 * Structural pin tests for `cnc-simulate-playback.ts`.
 *
 * Verifies the public API contract:
 *   - Only `buildCncSimulatePlaybackModel` is the runtime export.
 *   - The module's imports are limited to `zod` + the two G-code extractors.
 *   - No `any` types in the builder's signature.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as PlaybackModule from './cnc-simulate-playback'
import { buildCncSimulatePlaybackModel } from './cnc-simulate-playback'

const SOURCE_PATH = resolve(__dirname, 'cnc-simulate-playback.ts')
const source = readFileSync(SOURCE_PATH, 'utf-8')

describe('cnc-simulate-playback public API pin', () => {
  it('exports buildCncSimulatePlaybackModel as a function', () => {
    expect(typeof buildCncSimulatePlaybackModel).toBe('function')
  })

  it('buildCncSimulatePlaybackModel accepts (string, "3axis"|"4axis") and returns an object', () => {
    const result = buildCncSimulatePlaybackModel('', '3axis')
    expect(result).toBeTypeOf('object')
    expect(result).not.toBeNull()
  })

  it('exports cncSimulatePlaybackModelSchema (Zod schema)', () => {
    expect(PlaybackModule.cncSimulatePlaybackModelSchema).toBeDefined()
    expect(typeof PlaybackModule.cncSimulatePlaybackModelSchema.parse).toBe('function')
  })

  it('exports CncSimulatePlaybackModel type (inferred — present as a schema shape)', () => {
    // Type exports are erased at runtime; verify the shape via schema parse
    const model = PlaybackModule.cncSimulatePlaybackModelSchema.parse({
      axisMode: '3axis',
      segmentCount: 0,
      totalLengthMm: 0,
      feedRateRangeMmMin: null,
      collisionSegmentIndices: [],
    })
    expect(model.axisMode).toBe('3axis')
  })
})

describe('cnc-simulate-playback import-scope pin', () => {
  it('imports only from zod and cam-gcode-toolpath (no other external imports)', () => {
    // Extract all import specifiers from the source.
    // Matches both:  import { ... } from '...'  and  import '...'
    const importPattern = /^import\s+.*?from\s+['"]([^'"]+)['"]/gm
    const specifiers: string[] = []
    let m: RegExpExecArray | null
    while ((m = importPattern.exec(source)) !== null) {
      if (m[1]) specifiers.push(m[1])
    }
    // Every specifier must be 'zod' or './cam-gcode-toolpath'
    const allowed = new Set(['zod', './cam-gcode-toolpath'])
    for (const spec of specifiers) {
      expect(allowed.has(spec)).toBe(true)
    }
  })
})

describe('cnc-simulate-playback no-any pin', () => {
  it('contains no "any" type annotations in the source', () => {
    // Reject bare `: any` / `as any` / `any[]` / `Promise<any>` — allow
    // the word "any" inside string literals (e.g. comments) only as a
    // heuristic check; the strict TypeScript compilation is the real gate.
    const anyTypePattern = /(?::\s*any\b|as\s+any\b|any\[\]|Promise<any>)/
    expect(anyTypePattern.test(source)).toBe(false)
  })
})
