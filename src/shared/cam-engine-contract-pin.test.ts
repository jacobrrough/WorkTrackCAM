/**
 * Co-located paired-pin contract for `src/shared/cam-engine-contract.ts`
 *
 * [ID-0254] Cycle 182 cam-engine paired-pin -- pins the runtime contract of the
 * 51-line / 1647-byte SHARED CAM-engine IPC Zod schema layer that gates every
 * request / response between the renderer and the cam-engine-adapter:
 *   - 7 runtime schema exports: camEngineIdSchema, camEngineRequestSchema,
 *     camEngineProgressSchema, camEngineWarningSchema, camEngineFailureSchema,
 *     camEngineSuccessSchema, camEngineErrorSchema, camEngineResultSchema
 *     (the union of success+error).
 *   - 5 type-only exports via z.infer: CamEngineRequest, CamEngineProgress,
 *     CamEngineWarning, CamEngineFailure, CamEngineResult.
 *
 * Production consumer: `src/main/cam-engine-adapter.ts`.
 * Existing behavioral test: `src/shared/cam-engine-contract.test.ts` (3 it()
 * / 46 lines) -- thin happy-path coverage. This paired-pin extends coverage
 * to lock the schema contract any caller relies on, so a future refactor that
 * silently changes (e.g.) the engine-id enum values, the warnings default,
 * the success/error discriminator, or the percent-range constraint surfaces
 * here.
 *
 * Pinned in this file:
 *   (A) Module shape (8 runtime schema exports)
 *   (B) camEngineIdSchema enum contract (advanced / ocl / builtin)
 *   (C) camEngineRequestSchema accept/reject contract
 *   (D) camEngineProgressSchema accept/reject + percent range
 *   (E) camEngineWarningSchema accept/reject
 *   (F) camEngineFailureSchema accept/reject
 *   (G) camEngineSuccessSchema accept/reject + warnings default
 *   (H) camEngineErrorSchema accept/reject
 *   (I) camEngineResultSchema discriminated union
 *   (J) Three-machine path realism (advanced for K2/Carvera, builtin for Laguna)
 *   (K) Source-text whitelist (size, no foreign vendors, no toolpath G/M-code)
 */
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

import * as moduleNs from './cam-engine-contract'
import {
  camEngineErrorSchema,
  camEngineFailureSchema,
  camEngineIdSchema,
  camEngineProgressSchema,
  camEngineRequestSchema,
  camEngineResultSchema,
  camEngineSuccessSchema,
  camEngineWarningSchema
} from './cam-engine-contract'

const SRC_PATH = 'src/shared/cam-engine-contract.ts'
let SRC: string | null = null
async function readSrc(): Promise<string> {
  if (SRC === null) SRC = await readFile(SRC_PATH, 'utf-8')
  return SRC
}

const ENGINE_IDS = ['advanced', 'ocl', 'builtin'] as const

// Minimal valid request fixture (all numeric fields finite-positive; stlPath
// non-empty; optional fields omitted).
function validRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    stlPath: '/tmp/part.stl',
    feedMmMin: 1200,
    plungeMmMin: 600,
    stepoverMm: 0.4,
    zPassMm: 1.0,
    ...overrides
  }
}

function validSuccess(engineId: 'advanced' | 'ocl' | 'builtin'): Record<string, unknown> {
  return {
    ok: true,
    engineId,
    postedGcode: 'G21\nG90\nM30\n'
  }
}

function validError(engineId: 'advanced' | 'ocl' | 'builtin'): Record<string, unknown> {
  return {
    ok: false,
    engineId,
    failure: { code: 'engine_failed', message: 'engine failed' }
  }
}

// --------------------------------------------------------------------------
// (A) Module shape
// --------------------------------------------------------------------------
describe('[ID-0254] (A) module shape', () => {
  it('exports exactly the expected 8 runtime schema symbols', () => {
    const keys = Object.keys(moduleNs).sort()
    expect(keys).toEqual([
      'camEngineErrorSchema',
      'camEngineFailureSchema',
      'camEngineIdSchema',
      'camEngineProgressSchema',
      'camEngineRequestSchema',
      'camEngineResultSchema',
      'camEngineSuccessSchema',
      'camEngineWarningSchema'
    ])
  })

  it('namespace Symbol.toStringTag is Module', () => {
    expect((moduleNs as unknown as { [Symbol.toStringTag]?: string })[Symbol.toStringTag]).toBe(
      'Module'
    )
  })

  it('does not have a default export', () => {
    expect((moduleNs as unknown as { default?: unknown }).default).toBeUndefined()
  })

  it('every schema export has a .parse function', () => {
    for (const k of Object.keys(moduleNs)) {
      const s = (moduleNs as unknown as Record<string, { parse?: unknown }>)[k]
      expect(typeof s?.parse).toBe('function')
    }
  })

  it('every schema export has a .safeParse function', () => {
    for (const k of Object.keys(moduleNs)) {
      const s = (moduleNs as unknown as Record<string, { safeParse?: unknown }>)[k]
      expect(typeof s?.safeParse).toBe('function')
    }
  })

  it('exactly 8 runtime keys (no leakage of helpers or types)', () => {
    expect(Object.keys(moduleNs)).toHaveLength(8)
  })
})

// --------------------------------------------------------------------------
// (B) camEngineIdSchema enum contract
// --------------------------------------------------------------------------
describe('[ID-0254] (B) camEngineIdSchema', () => {
  it('accepts "advanced"', () => {
    expect(camEngineIdSchema.parse('advanced')).toBe('advanced')
  })

  it('accepts "ocl"', () => {
    expect(camEngineIdSchema.parse('ocl')).toBe('ocl')
  })

  it('accepts "builtin"', () => {
    expect(camEngineIdSchema.parse('builtin')).toBe('builtin')
  })

  it('rejects unknown engine id "kdf"', () => {
    expect(() => camEngineIdSchema.parse('kdf')).toThrow()
  })

  it('rejects empty string', () => {
    expect(() => camEngineIdSchema.parse('')).toThrow()
  })

  it('rejects case-mismatch "Advanced"', () => {
    expect(() => camEngineIdSchema.parse('Advanced')).toThrow()
  })

  it('rejects non-string types (number)', () => {
    expect(() => camEngineIdSchema.parse(0)).toThrow()
  })

  it('rejects non-string types (null)', () => {
    expect(() => camEngineIdSchema.parse(null)).toThrow()
  })

  it('exposes the exact 3-value enum', () => {
    // The 3 enum values must match `ENGINE_IDS` exactly (no extras).
    for (const id of ENGINE_IDS) {
      expect(() => camEngineIdSchema.parse(id)).not.toThrow()
    }
    expect(ENGINE_IDS).toHaveLength(3)
  })
})

// --------------------------------------------------------------------------
// (C) camEngineRequestSchema
// --------------------------------------------------------------------------
describe('[ID-0254] (C) camEngineRequestSchema', () => {
  it('accepts a minimal valid request (all required fields, no optionals)', () => {
    const out = camEngineRequestSchema.parse(validRequest())
    expect(out.stlPath).toBe('/tmp/part.stl')
    expect(out.feedMmMin).toBe(1200)
  })

  it('accepts optional operationKind', () => {
    const out = camEngineRequestSchema.parse(validRequest({ operationKind: 'pocket' }))
    expect(out.operationKind).toBe('pocket')
  })

  it('accepts optional toolDiameterMm', () => {
    const out = camEngineRequestSchema.parse(validRequest({ toolDiameterMm: 6.0 }))
    expect(out.toolDiameterMm).toBe(6.0)
  })

  it('rejects empty stlPath', () => {
    expect(() => camEngineRequestSchema.parse(validRequest({ stlPath: '' }))).toThrow()
  })

  it('rejects missing stlPath', () => {
    const r = validRequest()
    delete r.stlPath
    expect(() => camEngineRequestSchema.parse(r)).toThrow()
  })

  it('rejects negative feedMmMin', () => {
    expect(() => camEngineRequestSchema.parse(validRequest({ feedMmMin: -1 }))).toThrow()
  })

  it('rejects zero feedMmMin (positive is exclusive)', () => {
    expect(() => camEngineRequestSchema.parse(validRequest({ feedMmMin: 0 }))).toThrow()
  })

  it('rejects NaN plungeMmMin', () => {
    expect(() => camEngineRequestSchema.parse(validRequest({ plungeMmMin: NaN }))).toThrow()
  })

  it('rejects Infinity stepoverMm', () => {
    expect(() => camEngineRequestSchema.parse(validRequest({ stepoverMm: Infinity }))).toThrow()
  })

  it('rejects negative zPassMm', () => {
    expect(() => camEngineRequestSchema.parse(validRequest({ zPassMm: -0.1 }))).toThrow()
  })

  it('rejects zero toolDiameterMm (positive when present)', () => {
    expect(() => camEngineRequestSchema.parse(validRequest({ toolDiameterMm: 0 }))).toThrow()
  })

  it('rejects negative toolDiameterMm', () => {
    expect(() => camEngineRequestSchema.parse(validRequest({ toolDiameterMm: -3 }))).toThrow()
  })

  it('rejects non-string stlPath', () => {
    expect(() => camEngineRequestSchema.parse(validRequest({ stlPath: 42 }))).toThrow()
  })

  it('rejects non-number feedMmMin', () => {
    expect(() => camEngineRequestSchema.parse(validRequest({ feedMmMin: '1200' }))).toThrow()
  })

  it('omits operationKind from output when not present', () => {
    const out = camEngineRequestSchema.parse(validRequest())
    expect('operationKind' in out).toBe(false)
  })

  it('omits toolDiameterMm from output when not present', () => {
    const out = camEngineRequestSchema.parse(validRequest())
    expect('toolDiameterMm' in out).toBe(false)
  })
})

// --------------------------------------------------------------------------
// (D) camEngineProgressSchema
// --------------------------------------------------------------------------
describe('[ID-0254] (D) camEngineProgressSchema', () => {
  it('accepts {phase: "slicing", percent: 0}', () => {
    const out = camEngineProgressSchema.parse({ phase: 'slicing', percent: 0 })
    expect(out).toEqual({ phase: 'slicing', percent: 0 })
  })

  it('accepts {phase: "posting", percent: 100}', () => {
    const out = camEngineProgressSchema.parse({ phase: 'posting', percent: 100 })
    expect(out.percent).toBe(100)
  })

  it('accepts optional detail', () => {
    const out = camEngineProgressSchema.parse({ phase: 'p', percent: 50, detail: 'd' })
    expect(out.detail).toBe('d')
  })

  it('rejects empty phase', () => {
    expect(() => camEngineProgressSchema.parse({ phase: '', percent: 0 })).toThrow()
  })

  it('rejects negative percent (< 0)', () => {
    expect(() => camEngineProgressSchema.parse({ phase: 'p', percent: -0.01 })).toThrow()
  })

  it('rejects percent > 100', () => {
    expect(() => camEngineProgressSchema.parse({ phase: 'p', percent: 100.01 })).toThrow()
  })

  it('accepts percent boundary 0', () => {
    expect(() => camEngineProgressSchema.parse({ phase: 'p', percent: 0 })).not.toThrow()
  })

  it('accepts percent boundary 100', () => {
    expect(() => camEngineProgressSchema.parse({ phase: 'p', percent: 100 })).not.toThrow()
  })

  it('rejects missing phase', () => {
    expect(() => camEngineProgressSchema.parse({ percent: 50 })).toThrow()
  })

  it('rejects missing percent', () => {
    expect(() => camEngineProgressSchema.parse({ phase: 'p' })).toThrow()
  })

  it('rejects NaN percent', () => {
    expect(() => camEngineProgressSchema.parse({ phase: 'p', percent: NaN })).toThrow()
  })
})

// --------------------------------------------------------------------------
// (E) camEngineWarningSchema
// --------------------------------------------------------------------------
describe('[ID-0254] (E) camEngineWarningSchema', () => {
  it('accepts {code, message}', () => {
    const out = camEngineWarningSchema.parse({ code: 'low_feed', message: 'feed below floor' })
    expect(out.code).toBe('low_feed')
    expect(out.message).toBe('feed below floor')
  })

  it('rejects empty code', () => {
    expect(() => camEngineWarningSchema.parse({ code: '', message: 'm' })).toThrow()
  })

  it('rejects empty message', () => {
    expect(() => camEngineWarningSchema.parse({ code: 'c', message: '' })).toThrow()
  })

  it('rejects missing code', () => {
    expect(() => camEngineWarningSchema.parse({ message: 'm' })).toThrow()
  })

  it('rejects missing message', () => {
    expect(() => camEngineWarningSchema.parse({ code: 'c' })).toThrow()
  })

  it('rejects non-string code', () => {
    expect(() => camEngineWarningSchema.parse({ code: 42, message: 'm' })).toThrow()
  })
})

// --------------------------------------------------------------------------
// (F) camEngineFailureSchema
// --------------------------------------------------------------------------
describe('[ID-0254] (F) camEngineFailureSchema', () => {
  it('accepts {code, message} (no detail)', () => {
    const out = camEngineFailureSchema.parse({ code: 'x', message: 'y' })
    expect(out.code).toBe('x')
    expect(out.message).toBe('y')
  })

  it('accepts optional detail', () => {
    const out = camEngineFailureSchema.parse({ code: 'x', message: 'y', detail: 'd' })
    expect(out.detail).toBe('d')
  })

  it('rejects empty code', () => {
    expect(() => camEngineFailureSchema.parse({ code: '', message: 'y' })).toThrow()
  })

  it('rejects empty message', () => {
    expect(() => camEngineFailureSchema.parse({ code: 'x', message: '' })).toThrow()
  })

  it('rejects missing code', () => {
    expect(() => camEngineFailureSchema.parse({ message: 'y' })).toThrow()
  })

  it('omits detail when not present', () => {
    const out = camEngineFailureSchema.parse({ code: 'x', message: 'y' })
    expect('detail' in out).toBe(false)
  })
})

// --------------------------------------------------------------------------
// (G) camEngineSuccessSchema
// --------------------------------------------------------------------------
describe('[ID-0254] (G) camEngineSuccessSchema', () => {
  it('accepts a complete success', () => {
    const out = camEngineSuccessSchema.parse({
      ok: true,
      engineId: 'advanced',
      postedGcode: 'G21\nG90\n'
    })
    expect(out.ok).toBe(true)
    expect(out.engineId).toBe('advanced')
  })

  it('warnings defaults to empty array when missing', () => {
    const out = camEngineSuccessSchema.parse({
      ok: true,
      engineId: 'advanced',
      postedGcode: 'G21\n'
    })
    expect(out.warnings).toEqual([])
  })

  it('accepts non-empty warnings array', () => {
    const out = camEngineSuccessSchema.parse({
      ok: true,
      engineId: 'advanced',
      postedGcode: 'G21\n',
      warnings: [{ code: 'w', message: 'm' }]
    })
    expect(out.warnings).toHaveLength(1)
  })

  it('rejects ok: false (literal pin)', () => {
    expect(() =>
      camEngineSuccessSchema.parse({ ok: false, engineId: 'advanced', postedGcode: 'g' })
    ).toThrow()
  })

  it('rejects empty postedGcode', () => {
    expect(() =>
      camEngineSuccessSchema.parse({ ok: true, engineId: 'advanced', postedGcode: '' })
    ).toThrow()
  })

  it('rejects unknown engineId', () => {
    expect(() =>
      camEngineSuccessSchema.parse({ ok: true, engineId: 'xyz', postedGcode: 'g' })
    ).toThrow()
  })

  it('rejects missing engineId', () => {
    expect(() =>
      camEngineSuccessSchema.parse({ ok: true, postedGcode: 'g' })
    ).toThrow()
  })

  it('rejects missing postedGcode', () => {
    expect(() =>
      camEngineSuccessSchema.parse({ ok: true, engineId: 'advanced' })
    ).toThrow()
  })

  it('rejects malformed warning entry', () => {
    expect(() =>
      camEngineSuccessSchema.parse({
        ok: true,
        engineId: 'advanced',
        postedGcode: 'g',
        warnings: [{ code: '' }]
      })
    ).toThrow()
  })
})

// --------------------------------------------------------------------------
// (H) camEngineErrorSchema
// --------------------------------------------------------------------------
describe('[ID-0254] (H) camEngineErrorSchema', () => {
  it('accepts a complete error', () => {
    const out = camEngineErrorSchema.parse(validError('builtin'))
    expect(out.ok).toBe(false)
    expect(out.engineId).toBe('builtin')
    expect(out.failure.code).toBe('engine_failed')
  })

  it('rejects ok: true (literal pin)', () => {
    const r = validError('builtin') as Record<string, unknown>
    r.ok = true
    expect(() => camEngineErrorSchema.parse(r)).toThrow()
  })

  it('rejects malformed failure (empty message)', () => {
    expect(() =>
      camEngineErrorSchema.parse({
        ok: false,
        engineId: 'builtin',
        failure: { code: 'x', message: '' }
      })
    ).toThrow()
  })

  it('rejects unknown engineId', () => {
    expect(() =>
      camEngineErrorSchema.parse({
        ok: false,
        engineId: 'xyz',
        failure: { code: 'x', message: 'y' }
      })
    ).toThrow()
  })

  it('rejects missing failure', () => {
    expect(() => camEngineErrorSchema.parse({ ok: false, engineId: 'builtin' })).toThrow()
  })

  it('accepts failure with optional detail', () => {
    const out = camEngineErrorSchema.parse({
      ok: false,
      engineId: 'builtin',
      failure: { code: 'c', message: 'm', detail: 'd' }
    })
    expect(out.failure.detail).toBe('d')
  })
})

// --------------------------------------------------------------------------
// (I) camEngineResultSchema -- discriminated union
// --------------------------------------------------------------------------
describe('[ID-0254] (I) camEngineResultSchema', () => {
  it('accepts a success branch', () => {
    const out = camEngineResultSchema.parse(validSuccess('advanced'))
    expect(out.ok).toBe(true)
  })

  it('accepts an error branch', () => {
    const out = camEngineResultSchema.parse(validError('builtin'))
    expect(out.ok).toBe(false)
  })

  it('rejects an object missing the ok discriminator', () => {
    expect(() =>
      camEngineResultSchema.parse({
        engineId: 'advanced',
        postedGcode: 'g'
      })
    ).toThrow()
  })

  it('rejects an object with non-boolean ok', () => {
    expect(() =>
      camEngineResultSchema.parse({
        ok: 1,
        engineId: 'advanced',
        postedGcode: 'g'
      })
    ).toThrow()
  })

  it('safeParse succeeds on a valid success', () => {
    const r = camEngineResultSchema.safeParse(validSuccess('ocl'))
    expect(r.success).toBe(true)
  })

  it('safeParse succeeds on a valid error', () => {
    const r = camEngineResultSchema.safeParse(validError('ocl'))
    expect(r.success).toBe(true)
  })

  it('safeParse fails on an empty object', () => {
    const r = camEngineResultSchema.safeParse({})
    expect(r.success).toBe(false)
  })
})

// --------------------------------------------------------------------------
// (J) Three-machine path realism
// --------------------------------------------------------------------------
describe('[ID-0254] (J) three-machine path realism', () => {
  it('K2 Plus FDM: builtin engine slice + post round-trips a success', () => {
    const r = camEngineResultSchema.parse({
      ok: true,
      engineId: 'builtin',
      postedGcode: 'M104 S210\nM140 S60\nG28\nG21\nG90\nM30\n'
    })
    expect(r.ok).toBe(true)
  })

  it('Laguna Swift 5x10 RichAuto: advanced engine for full-sheet routing success', () => {
    const r = camEngineResultSchema.parse({
      ok: true,
      engineId: 'advanced',
      postedGcode: 'G21\nG90\nG17\nM3 S18000\nG0 X0 Y0\nM5\nM30\n'
    })
    expect(r.ok).toBe(true)
  })

  it('Carvera 4-axis: ocl engine for rotary 4-axis success', () => {
    const r = camEngineResultSchema.parse({
      ok: true,
      engineId: 'ocl',
      postedGcode: 'G21\nG90\nG17\nM3 S15000\nG0 X0 Y0 A0\nM5\nM2\n'
    })
    expect(r.ok).toBe(true)
  })

  it('a request with realistic K2 Plus FDM feeds round-trips', () => {
    const out = camEngineRequestSchema.parse(
      validRequest({
        feedMmMin: 36000,
        plungeMmMin: 9000,
        stepoverMm: 0.16,
        zPassMm: 0.2,
        toolDiameterMm: 0.4
      })
    )
    expect(out.feedMmMin).toBe(36000)
    expect(out.toolDiameterMm).toBe(0.4)
  })

  it('a request with realistic Laguna router feeds round-trips', () => {
    const out = camEngineRequestSchema.parse(
      validRequest({
        feedMmMin: 5000,
        plungeMmMin: 1000,
        stepoverMm: 4.0,
        zPassMm: 6.0,
        toolDiameterMm: 12.7
      })
    )
    expect(out.toolDiameterMm).toBe(12.7)
  })

  it('a request with realistic Carvera 4-axis feeds round-trips', () => {
    const out = camEngineRequestSchema.parse(
      validRequest({
        feedMmMin: 600,
        plungeMmMin: 200,
        stepoverMm: 0.3,
        zPassMm: 0.5,
        toolDiameterMm: 3.0,
        operationKind: 'rotary_finish'
      })
    )
    expect(out.operationKind).toBe('rotary_finish')
  })

  it('an engine error round-trips for each of the 3 engines', () => {
    for (const engineId of ENGINE_IDS) {
      const r = camEngineResultSchema.parse(validError(engineId))
      expect(r.ok).toBe(false)
      // discriminant narrowing on .ok keeps engineId visible.
      if (!r.ok) expect(r.engineId).toBe(engineId)
    }
  })
})

// --------------------------------------------------------------------------
// (K) Source-text whitelist
// --------------------------------------------------------------------------
describe('[ID-0254] (K) source-text whitelist', () => {
  it('source file is <= 60 lines (small, focused schema layer)', async () => {
    const src = await readSrc()
    expect(src.split('\n').length).toBeLessThanOrEqual(60)
  })

  it('source file is <= 2000 bytes', async () => {
    const src = await readSrc()
    expect(Buffer.byteLength(src, 'utf-8')).toBeLessThanOrEqual(2000)
  })

  it('imports zod (not yup, joi, or other validators)', async () => {
    const src = await readSrc()
    expect(src).toContain("from 'zod'")
    expect(src).not.toContain("from 'yup'")
    expect(src).not.toContain("from 'joi'")
  })

  it('exports exactly 8 schema constants and 5 type aliases', async () => {
    const src = await readSrc()
    const constMatches = src.match(/^export\s+const\s+\w+/gm) ?? []
    const typeMatches = src.match(/^export\s+type\s+\w+/gm) ?? []
    expect(constMatches.length).toBe(8)
    expect(typeMatches.length).toBe(5)
  })

  it('engine-id enum values appear verbatim in source', async () => {
    const src = await readSrc()
    expect(src).toContain("'advanced'")
    expect(src).toContain("'ocl'")
    expect(src).toContain("'builtin'")
  })

  it('warnings default is `[]` (empty array)', async () => {
    const src = await readSrc()
    expect(src).toMatch(/warnings:\s*z\.array\(\s*camEngineWarningSchema\s*\)\.default\(\[\]\)/)
  })

  it('percent range constraints are min(0).max(100)', async () => {
    const src = await readSrc()
    expect(src).toMatch(/percent:\s*z\.number\(\)\.min\(0\)\.max\(100\)/)
  })

  it('all string fields use min(1) (non-empty)', async () => {
    const src = await readSrc()
    // At least 7 occurrences of `.min(1)` across stlPath + phase + warning.code +
    // warning.message + failure.code + failure.message + postedGcode.
    const matches = src.match(/\.min\(1\)/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(7)
  })

  it('all numeric fields use finite() (no NaN/Infinity allowed)', async () => {
    const src = await readSrc()
    const matches = src.match(/\.finite\(\)/g) ?? []
    // feedMmMin + plungeMmMin + stepoverMm + zPassMm + toolDiameterMm = 5
    expect(matches.length).toBeGreaterThanOrEqual(5)
  })

  it('all positive numeric fields use positive()', async () => {
    const src = await readSrc()
    const matches = src.match(/\.positive\(\)/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(5)
  })

  it('discriminator literal `ok` appears in both success and error', async () => {
    const src = await readSrc()
    expect(src).toContain('ok: z.literal(true)')
    expect(src).toContain('ok: z.literal(false)')
  })

  it('union schema is z.union([success, error])', async () => {
    const src = await readSrc()
    expect(src).toMatch(/z\.union\(\[camEngineSuccessSchema,\s*camEngineErrorSchema\]\)/)
  })

  it('no `:any` runtime annotation in source', async () => {
    const src = await readSrc()
    const codeOnly = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(codeOnly).not.toMatch(/:\s*any\b/)
    expect(codeOnly).not.toMatch(/<\s*any\s*>/)
    expect(codeOnly).not.toMatch(/\bas\s+any\b/)
  })

  it('no foreign-machine vendors leak into the source', async () => {
    const src = (await readSrc()).toLowerCase()
    for (const vendor of [
      'bambu',
      'prusa',
      'haas',
      'tormach',
      'mach4',
      'shapeoko',
      'onefinity',
      'x-carve',
      'fanuc',
      'siemens'
    ]) {
      expect(src).not.toContain(vendor)
    }
  })

  it('no toolpath G-code or M-code literals in source', async () => {
    const src = await readSrc()
    for (const code of [
      'G0 ',
      'G1 ',
      'G17',
      'G18',
      'G19',
      'G20',
      'G21',
      'G28',
      'G54',
      'G90',
      'G91',
      'M3 ',
      'M5 ',
      'M30',
      'M64',
      'M65'
    ]) {
      expect(src).not.toContain(code)
    }
  })

  it('no electron/child_process/fs/path leakage (pure schema layer)', async () => {
    const src = await readSrc()
    for (const banned of ['electron', 'child_process', 'node:fs', 'node:path', 'react', 'three']) {
      expect(src).not.toContain(banned)
    }
  })

  it('no default export', async () => {
    const src = await readSrc()
    expect(src).not.toMatch(/^export\s+default\b/m)
  })

  it('every type alias uses z.infer<typeof ...>', async () => {
    const src = await readSrc()
    const matches = src.match(/z\.infer<typeof\s+\w+>/g) ?? []
    expect(matches.length).toBe(5)
  })
})
