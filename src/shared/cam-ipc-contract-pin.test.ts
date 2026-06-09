/**
 * Co-located paired-pin contract for `src/shared/cam-ipc-contract.ts`
 *
 * [ID-0262] Cycle 191 ui-polish paired-pin -- pins the runtime contract of the
 * 94-line / 3074-byte SHARED CAM IPC payload + result schema layer that gates
 * every renderer ↔ main `cam:run` round-trip for all three target machines:
 *   - Creality K2 Plus (FDM, Klipper/Moonraker)
 *   - Laguna Swift 5x10 (RichAuto A-series)
 *   - Makera Carvera + 4-axis (Smoothieware/Makera Controller)
 *
 * Production consumers:
 *   - `src/main/ipc-fabrication.ts` (validates inbound `cam:run` requests)
 *   - `src/main/cam-engine-adapter.ts` (validates engine results)
 *   - `src/preload/index.ts` (renderer-side type surface)
 *   - `src/renderer/src/manufacture/...` (renderer typing surface)
 *
 * Existing behavioural test: `src/shared/cam-ipc-contract.test.ts` (3 it() /
 * 54 lines) -- thin happy-path coverage. This paired-pin extends coverage to
 * lock the schema contract any caller relies on, so a future refactor that
 * silently changes (e.g.) the fallbackReason enum, the workCoordinateIndex
 * range, the toolSlot range, the placement nested-object shape, or the
 * success/failure discriminator surfaces here.
 *
 * Pinned in this file:
 *   (A) Module shape (5 runtime schema exports + 2 type aliases)
 *   (B) camRunPayloadSchema required-field accept/reject contract
 *   (C) camRunPayloadSchema optional-field range + nested placement contract
 *   (D) camRunEngineSchema enum + fallbackReason whitelist contract
 *   (E) camRunSuccessSchema accept/reject contract
 *   (F) camRunFailureSchema accept/reject contract
 *   (G) camRunResultSchema discriminated union round-trip
 *   (H) Three-machine path realism (K2 FDM, Laguna 5x10, Carvera 4-axis)
 *   (I) Source-text whitelist (size, no foreign vendors, no toolpath G/M-code)
 */
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

import * as moduleNs from './cam-ipc-contract'
import {
  camRunEngineSchema,
  camRunFailureSchema,
  camRunPayloadSchema,
  camRunResultSchema,
  camRunSuccessSchema
} from './cam-ipc-contract'

const SRC_PATH = 'src/shared/cam-ipc-contract.ts'
let SRC: string | null = null
async function readSrc(): Promise<string> {
  if (SRC === null) SRC = await readFile(SRC_PATH, 'utf-8')
  return SRC
}

const ENGINE_IDS = ['advanced', 'ocl', 'builtin'] as const
const FALLBACK_REASONS = [
  'invalid_numeric_params',
  'stl_missing',
  'config_error',
  'stl_read_error',
  'opencamlib_not_installed',
  'ocl_runtime_or_empty',
  'python_spawn_failed',
  'advanced_engine_failed',
  'unknown_ocl_failure'
] as const

// Minimal valid `cam:run` payload (all required fields, no optionals).
function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    stlPath: '/tmp/in.stl',
    outPath: '/tmp/out.nc',
    machineId: 'machine-1',
    zPassMm: 1,
    stepoverMm: 0.5,
    feedMmMin: 800,
    plungeMmMin: 200,
    safeZMm: 10,
    pythonPath: '/usr/bin/python',
    ...overrides
  }
}

function validEngine(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requestedEngine: 'advanced',
    usedEngine: 'advanced',
    fallbackApplied: false,
    ...overrides
  }
}

function validSuccess(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ok: true,
    usedEngine: 'advanced',
    engine: validEngine(),
    ...overrides
  }
}

function validFailure(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ok: false,
    error: 'bad input',
    ...overrides
  }
}

function validPlacement(): Record<string, unknown> {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 }
  }
}

// --------------------------------------------------------------------------
// (A) Module shape
// --------------------------------------------------------------------------
describe('[ID-0262] (A) module shape', () => {
  it('exports exactly the expected 5 runtime schema symbols', () => {
    const keys = Object.keys(moduleNs)
      .filter((k) => k.endsWith('Schema'))
      .sort()
    expect(keys).toEqual([
      'camRunEngineSchema',
      'camRunFailureSchema',
      'camRunPayloadSchema',
      'camRunResultSchema',
      'camRunSuccessSchema'
    ])
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

  it('namespace Symbol.toStringTag is Module', () => {
    expect((moduleNs as unknown as { [Symbol.toStringTag]?: string })[Symbol.toStringTag]).toBe(
      'Module'
    )
  })

  it('does not have a default export', () => {
    expect((moduleNs as unknown as { default?: unknown }).default).toBeUndefined()
  })

  it('exposes exactly 5 runtime keys (Schema-suffixed; type aliases erase)', () => {
    const runtimeKeys = Object.keys(moduleNs).filter((k) => k.endsWith('Schema'))
    expect(runtimeKeys).toHaveLength(5)
  })
})

// --------------------------------------------------------------------------
// (B) camRunPayloadSchema -- required fields
// --------------------------------------------------------------------------
describe('[ID-0262] (B) camRunPayloadSchema required fields', () => {
  it('accepts a minimal valid payload', () => {
    const out = camRunPayloadSchema.parse(validPayload())
    expect(out.stlPath).toBe('/tmp/in.stl')
    expect(out.outPath).toBe('/tmp/out.nc')
    expect(out.machineId).toBe('machine-1')
    expect(out.zPassMm).toBe(1)
  })

  it('rejects empty stlPath', () => {
    expect(() => camRunPayloadSchema.parse(validPayload({ stlPath: '' }))).toThrow()
  })

  it('rejects empty outPath', () => {
    expect(() => camRunPayloadSchema.parse(validPayload({ outPath: '' }))).toThrow()
  })

  it('rejects empty machineId', () => {
    expect(() => camRunPayloadSchema.parse(validPayload({ machineId: '' }))).toThrow()
  })

  it('rejects empty pythonPath', () => {
    expect(() => camRunPayloadSchema.parse(validPayload({ pythonPath: '' }))).toThrow()
  })

  it('rejects missing stlPath', () => {
    const r = validPayload()
    delete r.stlPath
    expect(() => camRunPayloadSchema.parse(r)).toThrow()
  })

  it('rejects missing safeZMm', () => {
    const r = validPayload()
    delete r.safeZMm
    expect(() => camRunPayloadSchema.parse(r)).toThrow()
  })

  it('rejects NaN zPassMm', () => {
    expect(() => camRunPayloadSchema.parse(validPayload({ zPassMm: NaN }))).toThrow()
  })

  it('rejects Infinity stepoverMm', () => {
    expect(() => camRunPayloadSchema.parse(validPayload({ stepoverMm: Infinity }))).toThrow()
  })

  it('rejects -Infinity feedMmMin', () => {
    expect(() => camRunPayloadSchema.parse(validPayload({ feedMmMin: -Infinity }))).toThrow()
  })

  it('rejects NaN plungeMmMin', () => {
    expect(() => camRunPayloadSchema.parse(validPayload({ plungeMmMin: NaN }))).toThrow()
  })

  it('rejects non-number safeZMm (string)', () => {
    expect(() => camRunPayloadSchema.parse(validPayload({ safeZMm: '10' }))).toThrow()
  })

  it('rejects non-string stlPath (number)', () => {
    expect(() => camRunPayloadSchema.parse(validPayload({ stlPath: 7 }))).toThrow()
  })

  it('accepts negative safeZMm (no positivity constraint -- finite only)', () => {
    expect(() => camRunPayloadSchema.parse(validPayload({ safeZMm: -1 }))).not.toThrow()
  })

  it('accepts zero stepoverMm (finite, no positivity constraint)', () => {
    expect(() => camRunPayloadSchema.parse(validPayload({ stepoverMm: 0 }))).not.toThrow()
  })
})

// --------------------------------------------------------------------------
// (C) camRunPayloadSchema -- optional fields
// --------------------------------------------------------------------------
describe('[ID-0262] (C) camRunPayloadSchema optional fields', () => {
  it('accepts workCoordinateIndex 1 (lower bound)', () => {
    const out = camRunPayloadSchema.parse(validPayload({ workCoordinateIndex: 1 }))
    expect(out.workCoordinateIndex).toBe(1)
  })

  it('accepts workCoordinateIndex 6 (upper bound)', () => {
    const out = camRunPayloadSchema.parse(validPayload({ workCoordinateIndex: 6 }))
    expect(out.workCoordinateIndex).toBe(6)
  })

  it('rejects workCoordinateIndex 0 (below min)', () => {
    expect(() => camRunPayloadSchema.parse(validPayload({ workCoordinateIndex: 0 }))).toThrow()
  })

  it('rejects workCoordinateIndex 7 (above max)', () => {
    expect(() => camRunPayloadSchema.parse(validPayload({ workCoordinateIndex: 7 }))).toThrow()
  })

  it('rejects non-integer workCoordinateIndex (1.5)', () => {
    expect(() => camRunPayloadSchema.parse(validPayload({ workCoordinateIndex: 1.5 }))).toThrow()
  })

  it('accepts toolSlot 1 (lower bound)', () => {
    const out = camRunPayloadSchema.parse(validPayload({ toolSlot: 1 }))
    expect(out.toolSlot).toBe(1)
  })

  it('accepts toolSlot 99 (upper bound)', () => {
    const out = camRunPayloadSchema.parse(validPayload({ toolSlot: 99 }))
    expect(out.toolSlot).toBe(99)
  })

  it('rejects toolSlot 0 (below min)', () => {
    expect(() => camRunPayloadSchema.parse(validPayload({ toolSlot: 0 }))).toThrow()
  })

  it('rejects toolSlot 100 (above max)', () => {
    expect(() => camRunPayloadSchema.parse(validPayload({ toolSlot: 100 }))).toThrow()
  })

  it('rejects non-integer toolSlot (2.5)', () => {
    expect(() => camRunPayloadSchema.parse(validPayload({ toolSlot: 2.5 }))).toThrow()
  })

  it('rejects zero toolDiameterMm (positive when present)', () => {
    expect(() => camRunPayloadSchema.parse(validPayload({ toolDiameterMm: 0 }))).toThrow()
  })

  it('rejects negative toolDiameterMm', () => {
    expect(() => camRunPayloadSchema.parse(validPayload({ toolDiameterMm: -1 }))).toThrow()
  })

  it('accepts positive toolDiameterMm 6.35 (1/4")', () => {
    const out = camRunPayloadSchema.parse(validPayload({ toolDiameterMm: 6.35 }))
    expect(out.toolDiameterMm).toBe(6.35)
  })

  it('rejects zero rotaryStockLengthMm (positive when present)', () => {
    expect(() => camRunPayloadSchema.parse(validPayload({ rotaryStockLengthMm: 0 }))).toThrow()
  })

  it('rejects zero rotaryStockDiameterMm (positive when present)', () => {
    expect(() => camRunPayloadSchema.parse(validPayload({ rotaryStockDiameterMm: 0 }))).toThrow()
  })

  it('accepts rotaryChuckDepthMm 0 (min(0) -- 0 is allowed)', () => {
    const out = camRunPayloadSchema.parse(validPayload({ rotaryChuckDepthMm: 0 }))
    expect(out.rotaryChuckDepthMm).toBe(0)
  })

  it('rejects negative rotaryChuckDepthMm', () => {
    expect(() => camRunPayloadSchema.parse(validPayload({ rotaryChuckDepthMm: -0.1 }))).toThrow()
  })

  it('accepts rotaryClampOffsetMm 0 (min(0) -- 0 is allowed)', () => {
    const out = camRunPayloadSchema.parse(validPayload({ rotaryClampOffsetMm: 0 }))
    expect(out.rotaryClampOffsetMm).toBe(0)
  })

  it('rejects negative rotaryClampOffsetMm', () => {
    expect(() => camRunPayloadSchema.parse(validPayload({ rotaryClampOffsetMm: -1 }))).toThrow()
  })

  it('accepts useMeshMachinableXClamp true', () => {
    const out = camRunPayloadSchema.parse(validPayload({ useMeshMachinableXClamp: true }))
    expect(out.useMeshMachinableXClamp).toBe(true)
  })

  it('rejects non-boolean useMeshMachinableXClamp (string)', () => {
    expect(() =>
      camRunPayloadSchema.parse(validPayload({ useMeshMachinableXClamp: 'true' }))
    ).toThrow()
  })

  it('accepts operationParams as a record of unknown', () => {
    const out = camRunPayloadSchema.parse(
      validPayload({ operationParams: { passes: 3, label: 'rough' } })
    )
    expect(out.operationParams).toEqual({ passes: 3, label: 'rough' })
  })

  it('rejects operationParams that is not an object', () => {
    expect(() => camRunPayloadSchema.parse(validPayload({ operationParams: 'foo' }))).toThrow()
  })

  it('accepts a fully-populated placement', () => {
    const out = camRunPayloadSchema.parse(validPayload({ placement: validPlacement() }))
    expect(out.placement?.position).toEqual({ x: 0, y: 0, z: 0 })
    expect(out.placement?.rotation).toEqual({ x: 0, y: 0, z: 0 })
    expect(out.placement?.scale).toEqual({ x: 1, y: 1, z: 1 })
  })

  it('rejects placement missing the position object', () => {
    const p = validPlacement()
    delete (p as Record<string, unknown>).position
    expect(() => camRunPayloadSchema.parse(validPayload({ placement: p }))).toThrow()
  })

  it('rejects placement missing the rotation object', () => {
    const p = validPlacement()
    delete (p as Record<string, unknown>).rotation
    expect(() => camRunPayloadSchema.parse(validPayload({ placement: p }))).toThrow()
  })

  it('rejects placement missing the scale object', () => {
    const p = validPlacement()
    delete (p as Record<string, unknown>).scale
    expect(() => camRunPayloadSchema.parse(validPayload({ placement: p }))).toThrow()
  })

  it('rejects placement.position missing a coord', () => {
    const p = validPlacement()
    delete (p.position as Record<string, unknown>).z
    expect(() => camRunPayloadSchema.parse(validPayload({ placement: p }))).toThrow()
  })

  it('rejects NaN in placement.position.x', () => {
    const p = validPlacement()
    ;(p.position as Record<string, unknown>).x = NaN
    expect(() => camRunPayloadSchema.parse(validPayload({ placement: p }))).toThrow()
  })

  it('rejects Infinity in placement.scale.y', () => {
    const p = validPlacement()
    ;(p.scale as Record<string, unknown>).y = Infinity
    expect(() => camRunPayloadSchema.parse(validPayload({ placement: p }))).toThrow()
  })

  it('omits placement from output when not present', () => {
    const out = camRunPayloadSchema.parse(validPayload())
    expect('placement' in out).toBe(false)
  })

  // ── Wave 3a: rotaryFixture (chuck + optional tailstock) contract ──
  it('accepts a chuck-only rotaryFixture', () => {
    const out = camRunPayloadSchema.parse(
      validPayload({ rotaryFixture: { chuckDepthMm: 17, chuckOuterRadiusMm: 46 } })
    )
    expect(out.rotaryFixture?.chuckDepthMm).toBe(17)
    expect(out.rotaryFixture?.chuckOuterRadiusMm).toBe(46)
    expect(out.rotaryFixture?.tailstockStartXMm).toBeUndefined()
  })

  it('accepts a chuck + tailstock rotaryFixture', () => {
    const out = camRunPayloadSchema.parse(
      validPayload({
        rotaryFixture: {
          chuckDepthMm: 17,
          chuckOuterRadiusMm: 40,
          tailstockStartXMm: 70,
          tailstockOuterRadiusMm: 12
        }
      })
    )
    expect(out.rotaryFixture?.tailstockStartXMm).toBe(70)
    expect(out.rotaryFixture?.tailstockOuterRadiusMm).toBe(12)
  })

  it('accepts chuckOuterRadiusMm = 0 (tailstock-only: chuck deferred to engine)', () => {
    // run-cam-for-op's tailstock-only path emits chuckOuterRadiusMm = 0 to mean
    // "no chuck override — let the engine run its machine-default chuck sweep".
    // The schema MUST accept it (nonnegative, not positive) or that payload
    // would be rejected at the IPC boundary and the tailstock check lost.
    const out = camRunPayloadSchema.parse(
      validPayload({
        rotaryFixture: {
          chuckDepthMm: 17,
          chuckOuterRadiusMm: 0,
          tailstockStartXMm: 75,
          tailstockOuterRadiusMm: 10
        }
      })
    )
    expect(out.rotaryFixture?.chuckOuterRadiusMm).toBe(0)
    expect(out.rotaryFixture?.tailstockStartXMm).toBe(75)
  })

  it('rejects a non-finite chuckOuterRadiusMm', () => {
    expect(() =>
      camRunPayloadSchema.parse(
        validPayload({ rotaryFixture: { chuckDepthMm: 17, chuckOuterRadiusMm: NaN } })
      )
    ).toThrow()
  })

  it('rejects a negative chuckDepthMm', () => {
    expect(() =>
      camRunPayloadSchema.parse(
        validPayload({ rotaryFixture: { chuckDepthMm: -1, chuckOuterRadiusMm: 40 } })
      )
    ).toThrow()
  })

  it('rejects a rotaryFixture missing chuckOuterRadiusMm', () => {
    expect(() =>
      camRunPayloadSchema.parse(validPayload({ rotaryFixture: { chuckDepthMm: 17 } }))
    ).toThrow()
  })

  it('omits rotaryFixture from output when not present', () => {
    const out = camRunPayloadSchema.parse(validPayload())
    expect('rotaryFixture' in out).toBe(false)
  })

  it('omits operationParams from output when not present', () => {
    const out = camRunPayloadSchema.parse(validPayload())
    expect('operationParams' in out).toBe(false)
  })

  it('omits operationKind from output when not present', () => {
    const out = camRunPayloadSchema.parse(validPayload())
    expect('operationKind' in out).toBe(false)
  })

  it('accepts priorPostedGcode as an empty string (optional, non-min)', () => {
    const out = camRunPayloadSchema.parse(validPayload({ priorPostedGcode: '' }))
    expect(out.priorPostedGcode).toBe('')
  })

  it('rejects non-finite stockBoxZMm (NaN)', () => {
    expect(() => camRunPayloadSchema.parse(validPayload({ stockBoxZMm: NaN }))).toThrow()
  })
})

// --------------------------------------------------------------------------
// (D) camRunEngineSchema
// --------------------------------------------------------------------------
describe('[ID-0262] (D) camRunEngineSchema', () => {
  it('accepts a minimal engine record (no fallback)', () => {
    const out = camRunEngineSchema.parse(validEngine())
    expect(out.requestedEngine).toBe('advanced')
    expect(out.usedEngine).toBe('advanced')
    expect(out.fallbackApplied).toBe(false)
  })

  it('accepts all 3 engine ids for requestedEngine', () => {
    for (const id of ENGINE_IDS) {
      expect(() => camRunEngineSchema.parse(validEngine({ requestedEngine: id }))).not.toThrow()
    }
  })

  it('accepts all 3 engine ids for usedEngine', () => {
    for (const id of ENGINE_IDS) {
      expect(() => camRunEngineSchema.parse(validEngine({ usedEngine: id }))).not.toThrow()
    }
  })

  it('rejects unknown engine id "haas"', () => {
    expect(() => camRunEngineSchema.parse(validEngine({ requestedEngine: 'haas' }))).toThrow()
  })

  it('rejects case-mismatch engine id "Advanced"', () => {
    expect(() => camRunEngineSchema.parse(validEngine({ usedEngine: 'Advanced' }))).toThrow()
  })

  it('rejects non-boolean fallbackApplied', () => {
    expect(() => camRunEngineSchema.parse(validEngine({ fallbackApplied: 'no' }))).toThrow()
  })

  it('accepts optional fallbackReason for every whitelist value', () => {
    for (const reason of FALLBACK_REASONS) {
      expect(() =>
        camRunEngineSchema.parse(validEngine({ fallbackApplied: true, fallbackReason: reason }))
      ).not.toThrow()
    }
  })

  it('rejects unknown fallbackReason "did_not_finish"', () => {
    expect(() =>
      camRunEngineSchema.parse(
        validEngine({ fallbackApplied: true, fallbackReason: 'did_not_finish' })
      )
    ).toThrow()
  })

  it('rejects empty-string fallbackReason', () => {
    expect(() =>
      camRunEngineSchema.parse(validEngine({ fallbackApplied: true, fallbackReason: '' }))
    ).toThrow()
  })

  it('accepts optional fallbackDetail string', () => {
    const out = camRunEngineSchema.parse(
      validEngine({ fallbackApplied: true, fallbackDetail: 'some detail' })
    )
    expect(out.fallbackDetail).toBe('some detail')
  })

  it('rejects missing requestedEngine', () => {
    const e = validEngine()
    delete e.requestedEngine
    expect(() => camRunEngineSchema.parse(e)).toThrow()
  })

  it('rejects missing fallbackApplied', () => {
    const e = validEngine()
    delete e.fallbackApplied
    expect(() => camRunEngineSchema.parse(e)).toThrow()
  })
})

// --------------------------------------------------------------------------
// (E) camRunSuccessSchema
// --------------------------------------------------------------------------
describe('[ID-0262] (E) camRunSuccessSchema', () => {
  it('accepts a complete success', () => {
    const out = camRunSuccessSchema.parse(
      validSuccess({ gcode: 'G21\nG90\nM30\n', warnings: ['low feed'] })
    )
    expect(out.ok).toBe(true)
    expect(out.gcode).toBe('G21\nG90\nM30\n')
    expect(out.warnings).toEqual(['low feed'])
  })

  it('accepts success without optional gcode/warnings/hint', () => {
    const out = camRunSuccessSchema.parse(validSuccess())
    expect(out.ok).toBe(true)
    expect('gcode' in out).toBe(false)
    expect('warnings' in out).toBe(false)
    expect('hint' in out).toBe(false)
  })

  it('rejects ok: false (literal pin)', () => {
    expect(() => camRunSuccessSchema.parse(validSuccess({ ok: false }))).toThrow()
  })

  it('rejects unknown usedEngine', () => {
    expect(() => camRunSuccessSchema.parse(validSuccess({ usedEngine: 'mach4' }))).toThrow()
  })

  it('rejects warnings that is not an array', () => {
    expect(() => camRunSuccessSchema.parse(validSuccess({ warnings: 'oops' }))).toThrow()
  })

  it('rejects warnings array with a non-string element', () => {
    expect(() => camRunSuccessSchema.parse(validSuccess({ warnings: [42] }))).toThrow()
  })

  it('rejects missing engine block', () => {
    const r = validSuccess()
    delete r.engine
    expect(() => camRunSuccessSchema.parse(r)).toThrow()
  })

  it('rejects engine block with bad fallbackReason', () => {
    expect(() =>
      camRunSuccessSchema.parse(
        validSuccess({
          engine: validEngine({ fallbackApplied: true, fallbackReason: 'rocket_failure' })
        })
      )
    ).toThrow()
  })
})

// --------------------------------------------------------------------------
// (F) camRunFailureSchema
// --------------------------------------------------------------------------
describe('[ID-0262] (F) camRunFailureSchema', () => {
  it('accepts {ok:false, error}', () => {
    const out = camRunFailureSchema.parse(validFailure())
    expect(out.ok).toBe(false)
    expect(out.error).toBe('bad input')
  })

  it('accepts optional hint', () => {
    const out = camRunFailureSchema.parse(validFailure({ hint: 'try again' }))
    expect(out.hint).toBe('try again')
  })

  it('rejects ok: true (literal pin)', () => {
    expect(() => camRunFailureSchema.parse(validFailure({ ok: true }))).toThrow()
  })

  it('rejects missing error', () => {
    const r = validFailure()
    delete r.error
    expect(() => camRunFailureSchema.parse(r)).toThrow()
  })

  it('rejects non-string error', () => {
    expect(() => camRunFailureSchema.parse(validFailure({ error: 42 }))).toThrow()
  })

  it('omits hint when not present', () => {
    const out = camRunFailureSchema.parse(validFailure())
    expect('hint' in out).toBe(false)
  })
})

// --------------------------------------------------------------------------
// (G) camRunResultSchema (discriminated union)
// --------------------------------------------------------------------------
describe('[ID-0262] (G) camRunResultSchema', () => {
  it('accepts a success branch', () => {
    const out = camRunResultSchema.parse(validSuccess({ gcode: 'G21\n' }))
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.gcode).toBe('G21\n')
  })

  it('accepts a failure branch', () => {
    const out = camRunResultSchema.parse(validFailure())
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error).toBe('bad input')
  })

  it('rejects a hybrid record (ok:true + error field, missing engine)', () => {
    expect(() => camRunResultSchema.parse({ ok: true, error: 'x' })).toThrow()
  })

  it('rejects an empty object', () => {
    expect(() => camRunResultSchema.parse({})).toThrow()
  })

  it('round-trips a success then a failure with the same parser', () => {
    const a = camRunResultSchema.parse(validSuccess())
    const b = camRunResultSchema.parse(validFailure())
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(false)
  })

  it('rejects ok-as-string ("true")', () => {
    expect(() =>
      camRunResultSchema.parse({
        ok: 'true',
        usedEngine: 'advanced',
        engine: validEngine()
      })
    ).toThrow()
  })
})

// --------------------------------------------------------------------------
// (H) Three-machine path realism
// --------------------------------------------------------------------------
describe('[ID-0262] (H) three-machine path realism', () => {
  it('a K2 Plus FDM payload (no rotary, no toolDiameter) round-trips', () => {
    const out = camRunPayloadSchema.parse(
      validPayload({
        machineId: 'creality-k2-plus',
        feedMmMin: 18000,
        plungeMmMin: 1800,
        stepoverMm: 0.4,
        zPassMm: 0.2,
        safeZMm: 5
      })
    )
    expect(out.machineId).toBe('creality-k2-plus')
    expect(out.feedMmMin).toBe(18000)
  })

  it('a Laguna Swift 5x10 router payload (large bed, generous safeZ) round-trips', () => {
    const out = camRunPayloadSchema.parse(
      validPayload({
        machineId: 'laguna-swift-5x10',
        feedMmMin: 6000,
        plungeMmMin: 1500,
        stepoverMm: 6.0,
        zPassMm: 3.0,
        safeZMm: 25,
        toolDiameterMm: 12.7,
        useMeshMachinableXClamp: true
      })
    )
    expect(out.machineId).toBe('laguna-swift-5x10')
    expect(out.toolDiameterMm).toBe(12.7)
  })

  it('a Carvera 4-axis rotary payload (rotary stock + chuck depth) round-trips', () => {
    const out = camRunPayloadSchema.parse(
      validPayload({
        machineId: 'makera-carvera-4axis',
        feedMmMin: 600,
        plungeMmMin: 200,
        stepoverMm: 0.3,
        zPassMm: 0.5,
        safeZMm: 10,
        toolDiameterMm: 3.0,
        rotaryStockLengthMm: 100,
        rotaryStockDiameterMm: 30,
        rotaryChuckDepthMm: 8,
        rotaryClampOffsetMm: 2,
        toolSlot: 4
      })
    )
    expect(out.machineId).toBe('makera-carvera-4axis')
    expect(out.rotaryStockLengthMm).toBe(100)
    expect(out.rotaryStockDiameterMm).toBe(30)
    expect(out.rotaryChuckDepthMm).toBe(8)
    expect(out.rotaryClampOffsetMm).toBe(2)
    expect(out.toolSlot).toBe(4)
  })

  it('a result for each engine round-trips through camRunResultSchema', () => {
    for (const engineId of ENGINE_IDS) {
      const r = camRunResultSchema.parse({
        ok: true,
        usedEngine: engineId,
        engine: validEngine({ requestedEngine: engineId, usedEngine: engineId })
      })
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.usedEngine).toBe(engineId)
    }
  })

  it('an opencamlib_not_installed fallback (typical OCL-on-Windows) round-trips', () => {
    const r = camRunResultSchema.parse({
      ok: true,
      usedEngine: 'builtin',
      engine: validEngine({
        requestedEngine: 'ocl',
        usedEngine: 'builtin',
        fallbackApplied: true,
        fallbackReason: 'opencamlib_not_installed'
      })
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.engine.fallbackApplied).toBe(true)
      expect(r.engine.fallbackReason).toBe('opencamlib_not_installed')
    }
  })
})

// --------------------------------------------------------------------------
// (I) Source-text whitelist
// --------------------------------------------------------------------------
describe('[ID-0262] (I) source-text whitelist', () => {
  it('source file is exactly 120 lines (size pin)', async () => {
    // Wave 3a: +26 lines for the optional `rotaryFixture` object on
    // camRunPayloadSchema (chuck + tailstock geometry for the 4-axis collision
    // sweep, incl. the nonnegative-chuck rationale comment). Was 94 lines
    // pre-Wave-3a.
    const src = await readSrc()
    expect(src.split('\n').length).toBe(121) // 120 lines + trailing newline -> 121 split entries
  })

  it('source file is <= 5000 bytes (small, focused schema layer)', async () => {
    // Wave 3a bumped the cap from 4000 -> 5000 for the `rotaryFixture` object.
    const src = await readSrc()
    expect(Buffer.byteLength(src, 'utf-8')).toBeLessThanOrEqual(5000)
  })

  it('imports zod (not yup, joi, or other validators)', async () => {
    const src = await readSrc()
    expect(src).toContain("from 'zod'")
    expect(src).not.toContain("from 'yup'")
    expect(src).not.toContain("from 'joi'")
  })

  it('exports exactly 5 schema constants and 2 type aliases', async () => {
    const src = await readSrc()
    const constMatches = src.match(/^export\s+const\s+\w+/gm) ?? []
    const typeMatches = src.match(/^export\s+type\s+\w+/gm) ?? []
    expect(constMatches.length).toBe(5)
    expect(typeMatches.length).toBe(2)
  })

  it('engine-id enum values appear verbatim in source', async () => {
    const src = await readSrc()
    expect(src).toContain("'advanced'")
    expect(src).toContain("'ocl'")
    expect(src).toContain("'builtin'")
  })

  it('all 9 fallbackReason values appear verbatim in source', async () => {
    const src = await readSrc()
    for (const reason of FALLBACK_REASONS) {
      expect(src).toContain(`'${reason}'`)
    }
  })

  it('workCoordinateIndex range is min(1).max(6)', async () => {
    const src = await readSrc()
    expect(src).toMatch(/workCoordinateIndex:\s*z\.number\(\)\.int\(\)\.min\(1\)\.max\(6\)/)
  })

  it('toolSlot range is min(1).max(99)', async () => {
    const src = await readSrc()
    expect(src).toMatch(/toolSlot:\s*z\.number\(\)\.int\(\)\.min\(1\)\.max\(99\)/)
  })

  it('rotaryChuckDepthMm uses min(0) (zero allowed)', async () => {
    const src = await readSrc()
    expect(src).toMatch(/rotaryChuckDepthMm:\s*z\.number\(\)\.finite\(\)\.min\(0\)/)
  })

  it('rotaryClampOffsetMm uses min(0) (zero allowed)', async () => {
    const src = await readSrc()
    expect(src).toMatch(/rotaryClampOffsetMm:\s*z\.number\(\)\.finite\(\)\.min\(0\)/)
  })

  it('result-discriminator literals appear verbatim', async () => {
    const src = await readSrc()
    expect(src).toContain('ok: z.literal(true)')
    expect(src).toContain('ok: z.literal(false)')
  })

  it('union schema is z.union([camRunSuccessSchema, camRunFailureSchema])', async () => {
    const src = await readSrc()
    expect(src).toMatch(
      /z\.union\(\[camRunSuccessSchema,\s*camRunFailureSchema\]\)/
    )
  })

  it('engine block is reused via camRunEngineSchema (not inlined twice)', async () => {
    const src = await readSrc()
    // Reference to camRunEngineSchema must appear inside camRunSuccessSchema
    // -- the success branch consumes the engine schema to avoid drift.
    expect(src).toMatch(/engine:\s*camRunEngineSchema/)
  })

  it('placement is an optional nested object with position/rotation/scale', async () => {
    const src = await readSrc()
    expect(src).toMatch(/placement:\s*z\s*\.object/)
    expect(src).toContain('position: z.object')
    expect(src).toContain('rotation: z.object')
    expect(src).toContain('scale: z.object')
    expect(src).toMatch(/\.optional\(\)\s*\}\)\s*$/m)
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

  it('no toolpath G-code or M-code literals in source (pure schema layer)', async () => {
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

  it('no electron/child_process/fs/path/three/react leakage (pure schema layer)', async () => {
    const src = await readSrc()
    for (const banned of [
      'electron',
      'child_process',
      'node:fs',
      'node:path',
      'react',
      'three'
    ]) {
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
    expect(matches.length).toBe(2)
  })
})
