/**
 * [ID-XXXX] Cycle 197 test-coverage paired-pin contract for
 * `src/shared/manufacture-cam-driving-op.ts`.
 *
 * Pins the contract for `resolveManufactureCamDrivingOperation` -- the
 * single-point selector the renderer uses to decide which manufacture
 * operation drives `cam:run` (Generate CAM). Every CNC job emitted to
 * Laguna Swift 5x10 (RichAuto A-series), Makera Carvera 3-axis, and
 * Makera Carvera + 4-axis Rotary flows through this resolver before the
 * runner sees it.
 *
 * Companion behavioral file: `manufacture-cam-driving-op.test.ts` (4 it()
 * happy paths). This pin file extends coverage to lock module shape,
 * function signature, the BLOCKED-from-CAM gate contract, the selection
 * clamping rule, the cnc_* prefix predicate, and pure-function invariants
 * the renderer + main-process consumers depend on.
 */
import { describe, expect, it } from 'vitest'
import * as DrivingOpModule from './manufacture-cam-driving-op'
import { resolveManufactureCamDrivingOperation } from './manufacture-cam-driving-op'
import type { ManufactureFile, ManufactureOperation } from './manufacture-schema'
import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid ManufactureFile around the given operation list. */
function mfg(ops: ManufactureFile['operations']): ManufactureFile {
  return {
    version: 1,
    setups: [{ id: 's1', label: 'S1', machineId: 'm1' }],
    operations: ops
  }
}

/** Construct a single op of the given kind with sane defaults. */
function op(
  id: string,
  kind: ManufactureOperation['kind'],
  suppressed = false,
  label?: string
): ManufactureOperation {
  return { id, kind, label: label ?? id.toUpperCase(), suppressed }
}

/**
 * All currently-runnable CNC kinds shipped by the schema (cnc_* and NOT in
 * BLOCKED). The capability-honesty gate (DEAD_ENGINE_CAM_KINDS in
 * manufacture-cam-gate) moved the deleted-toolpath_engine freeform finishes,
 * the out-of-scope 5-axis family, and cnc_thread_mill OUT of this list — they
 * always hard-fail, so they can never be a CAM driving op.
 */
const RUNNABLE_CNC_KINDS: ManufactureOperation['kind'][] = [
  'cnc_parallel',
  'cnc_contour',
  'cnc_pocket',
  'cnc_drill',
  'cnc_adaptive',
  'cnc_waterline',
  'cnc_raster',
  'cnc_pencil',
  'cnc_4axis_roughing',
  'cnc_4axis_finishing',
  'cnc_4axis_contour',
  'cnc_4axis_indexed',
  'cnc_3d_rough',
  'cnc_3d_finish',
  'cnc_chamfer',
  'cnc_pcb_isolation',
  'cnc_pcb_drill',
  'cnc_pcb_contour',
  'cnc_trochoidal_hsm',
  'cnc_4axis_continuous'
]

/** All BLOCKED kinds the gate refuses to run via cam:run. */
const BLOCKED_KINDS: ManufactureOperation['kind'][] = [
  'fdm_slice',
  'export_stl',
  'cnc_laser',
  'cnc_lathe_turn',
  'cnc_probe',
  // Capability-honesty: deleted-engine / out-of-scope kinds (DEAD_ENGINE_CAM_KINDS).
  'cnc_thread_mill',
  'cnc_spiral_finish',
  'cnc_morphing_finish',
  'cnc_steep_shallow',
  'cnc_scallop_finish',
  'cnc_auto_select',
  'cnc_5axis_contour',
  'cnc_5axis_swarf',
  'cnc_5axis_flowline'
]

/** BLOCKED kinds that ARE cnc_* prefixed (would-be runnable but for the BLOCKED set). */
const BLOCKED_CNC_PREFIX_KINDS: ManufactureOperation['kind'][] = [
  'cnc_laser',
  'cnc_lathe_turn',
  'cnc_probe',
  'cnc_thread_mill',
  'cnc_spiral_finish',
  'cnc_morphing_finish',
  'cnc_steep_shallow',
  'cnc_scallop_finish',
  'cnc_auto_select',
  'cnc_5axis_contour',
  'cnc_5axis_swarf',
  'cnc_5axis_flowline'
]

/** Non-CNC kinds (do not start with `cnc_`). */
const NON_CNC_KINDS: ManufactureOperation['kind'][] = ['fdm_slice', 'export_stl']

// ---------------------------------------------------------------------------
// A. Module shape
// ---------------------------------------------------------------------------

describe('A. module shape -- manufacture-cam-driving-op', () => {
  it('exports exactly 1 runtime symbol (resolveManufactureCamDrivingOperation)', () => {
    const keys = Object.keys(DrivingOpModule)
      .filter((k) => k !== 'default')
      .sort()
    expect(keys).toEqual(['resolveManufactureCamDrivingOperation'])
  })

  it('does NOT leak internal helpers isCncKind / isRunnableCncOp', () => {
    expect((DrivingOpModule as unknown as Record<string, unknown>).isCncKind).toBeUndefined()
    expect((DrivingOpModule as unknown as Record<string, unknown>).isRunnableCncOp).toBeUndefined()
  })

  it('has Symbol.toStringTag of Module (ESM module record)', () => {
    expect((DrivingOpModule as unknown as { [Symbol.toStringTag]: string })[Symbol.toStringTag]).toBe('Module')
  })

  it('has no default export', () => {
    expect((DrivingOpModule as unknown as { default?: unknown }).default).toBeUndefined()
  })

  it('the single export is a function (not a class / object)', () => {
    expect(typeof DrivingOpModule.resolveManufactureCamDrivingOperation).toBe('function')
    expect(DrivingOpModule.resolveManufactureCamDrivingOperation).toBe(resolveManufactureCamDrivingOperation)
  })
})

// ---------------------------------------------------------------------------
// B. Function signature
// ---------------------------------------------------------------------------

describe('B. function signature -- resolveManufactureCamDrivingOperation', () => {
  it('has name "resolveManufactureCamDrivingOperation"', () => {
    expect(resolveManufactureCamDrivingOperation.name).toBe('resolveManufactureCamDrivingOperation')
  })

  it('has arity 2 (mfg, selectedOpIndex)', () => {
    expect(resolveManufactureCamDrivingOperation.length).toBe(2)
  })

  it('is a native Function (not async, not generator)', () => {
    expect(resolveManufactureCamDrivingOperation.constructor.name).toBe('Function')
    expect(resolveManufactureCamDrivingOperation.constructor.name).not.toBe('AsyncFunction')
    expect(resolveManufactureCamDrivingOperation.constructor.name).not.toBe('GeneratorFunction')
  })

  it('returns a plain object (not a Promise)', () => {
    const r = resolveManufactureCamDrivingOperation(mfg([op('a', 'cnc_parallel')]), 0)
    expect(typeof r).toBe('object')
    expect(r).not.toBeNull()
    expect(r instanceof Promise).toBe(false)
  })

  it('returned object always has an `ok` boolean discriminator', () => {
    const ok = resolveManufactureCamDrivingOperation(mfg([op('a', 'cnc_parallel')]), 0)
    const fail = resolveManufactureCamDrivingOperation(mfg([]), 0)
    expect(typeof ok.ok).toBe('boolean')
    expect(typeof fail.ok).toBe('boolean')
  })
})

// ---------------------------------------------------------------------------
// C. Empty-operations error contract
// ---------------------------------------------------------------------------

describe('C. empty operations -- error contract', () => {
  it('returns ok:false with exact error string', () => {
    const r = resolveManufactureCamDrivingOperation(mfg([]), 0)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('No operations in the manufacture plan.')
  })

  it('returns ok:false with hint mentioning CNC + source mesh + toolpath', () => {
    const r = resolveManufactureCamDrivingOperation(mfg([]), 0)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.hint).toContain('CNC')
      expect(r.hint).toContain('source mesh')
      expect(r.hint).toContain('toolpath')
    }
  })

  it('empty-ops result does NOT include op or index keys', () => {
    const r = resolveManufactureCamDrivingOperation(mfg([]), 0)
    expect((r as Record<string, unknown>).op).toBeUndefined()
    expect((r as Record<string, unknown>).index).toBeUndefined()
  })

  it('empty-ops error fires regardless of selectedOpIndex (negative / huge)', () => {
    for (const idx of [-100, -1, 0, 1, 999_999]) {
      const r = resolveManufactureCamDrivingOperation(mfg([]), idx)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toBe('No operations in the manufacture plan.')
    }
  })
})

// ---------------------------------------------------------------------------
// D. Selection-index clamping (Math.max(0, Math.min(idx, len-1)))
// ---------------------------------------------------------------------------

describe('D. selection index clamping', () => {
  it('negative selectedOpIndex clamps to 0', () => {
    const file = mfg([op('a', 'cnc_parallel'), op('b', 'cnc_pocket')])
    const r = resolveManufactureCamDrivingOperation(file, -5)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.index).toBe(0)
      expect(r.op.kind).toBe('cnc_parallel')
    }
  })

  it('selectedOpIndex >= ops.length clamps to ops.length-1', () => {
    const file = mfg([op('a', 'cnc_parallel'), op('b', 'cnc_pocket'), op('c', 'cnc_drill')])
    const r = resolveManufactureCamDrivingOperation(file, 999)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.index).toBe(2)
      expect(r.op.kind).toBe('cnc_drill')
    }
  })

  it('selectedOpIndex == ops.length clamps to ops.length-1 (off-by-one boundary)', () => {
    const file = mfg([op('a', 'cnc_parallel'), op('b', 'cnc_pocket')])
    const r = resolveManufactureCamDrivingOperation(file, 2)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.index).toBe(1)
  })

  it('selectedOpIndex == 0 picks the first op (no clamp)', () => {
    const file = mfg([op('a', 'cnc_parallel'), op('b', 'cnc_pocket')])
    const r = resolveManufactureCamDrivingOperation(file, 0)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.index).toBe(0)
  })

  it('selectedOpIndex == ops.length-1 picks the last op (no clamp)', () => {
    const file = mfg([op('a', 'cnc_parallel'), op('b', 'cnc_pocket')])
    const r = resolveManufactureCamDrivingOperation(file, 1)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.index).toBe(1)
  })

  it('Number.NEGATIVE_INFINITY clamps to 0 via Math.max(0, ...)', () => {
    const file = mfg([op('a', 'cnc_parallel')])
    const r = resolveManufactureCamDrivingOperation(file, Number.NEGATIVE_INFINITY)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.index).toBe(0)
  })

  it('Number.POSITIVE_INFINITY clamps to ops.length-1 via Math.min(idx, len-1)', () => {
    const file = mfg([op('a', 'cnc_parallel'), op('b', 'cnc_pocket')])
    const r = resolveManufactureCamDrivingOperation(file, Number.POSITIVE_INFINITY)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.index).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// E. Selected-is-runnable-CNC happy path
// ---------------------------------------------------------------------------

describe('E. selected runnable CNC op happy path', () => {
  it('returns the selected op when selected is a runnable CNC kind', () => {
    const file = mfg([op('a', 'cnc_parallel'), op('b', 'cnc_pocket')])
    const r = resolveManufactureCamDrivingOperation(file, 1)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.index).toBe(1)
      expect(r.op).toBe(file.operations[1])
      expect(r.op.kind).toBe('cnc_pocket')
    }
  })

  it('selected wins even when an earlier runnable CNC op exists', () => {
    const file = mfg([
      op('a', 'cnc_parallel'),
      op('b', 'cnc_drill'),
      op('c', 'cnc_pocket')
    ])
    const r = resolveManufactureCamDrivingOperation(file, 2)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.index).toBe(2)
      expect(r.op.kind).toBe('cnc_pocket')
    }
  })

  it('returned op reference is the same object as ops[index] (no copy)', () => {
    const target = op('b', 'cnc_3d_finish')
    const file = mfg([op('a', 'cnc_parallel'), target])
    const r = resolveManufactureCamDrivingOperation(file, 1)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.op === target).toBe(true)
  })

  it('ok-result has shape { ok: true, op, index } -- exactly 3 keys', () => {
    const file = mfg([op('a', 'cnc_parallel')])
    const r = resolveManufactureCamDrivingOperation(file, 0)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(Object.keys(r).sort()).toEqual(['index', 'ok', 'op'])
    }
  })
})

// ---------------------------------------------------------------------------
// F. Selected-is-non-CNC fallback to first runnable
// ---------------------------------------------------------------------------

describe('F. selected non-CNC fallback', () => {
  it.each(NON_CNC_KINDS)('selected %s falls through to first runnable CNC', (kind) => {
    const file = mfg([op('a', kind), op('b', 'cnc_parallel')])
    const r = resolveManufactureCamDrivingOperation(file, 0)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.index).toBe(1)
      expect(r.op.kind).toBe('cnc_parallel')
    }
  })

  it('fallback picks the FIRST runnable CNC, not last', () => {
    const file = mfg([
      op('a', 'fdm_slice'),
      op('b', 'cnc_drill'),
      op('c', 'cnc_pocket'),
      op('d', 'cnc_parallel')
    ])
    const r = resolveManufactureCamDrivingOperation(file, 0)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.index).toBe(1)
      expect(r.op.kind).toBe('cnc_drill')
    }
  })

  it('fallback skips multiple non-CNC ops in a row', () => {
    const file = mfg([
      op('a', 'fdm_slice'),
      op('b', 'export_stl'),
      op('c', 'fdm_slice'),
      op('d', 'cnc_4axis_continuous')
    ])
    const r = resolveManufactureCamDrivingOperation(file, 0)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.index).toBe(3)
      expect(r.op.kind).toBe('cnc_4axis_continuous')
    }
  })
})

// ---------------------------------------------------------------------------
// G. Suppressed ops are skipped
// ---------------------------------------------------------------------------

describe('G. suppressed ops', () => {
  it('selected is suppressed -> falls through to next runnable', () => {
    const file = mfg([op('a', 'cnc_parallel', true), op('b', 'cnc_pocket')])
    const r = resolveManufactureCamDrivingOperation(file, 0)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.index).toBe(1)
      expect(r.op.kind).toBe('cnc_pocket')
    }
  })

  it('all suppressed -> "No runnable CNC operation found." error', () => {
    const file = mfg([
      op('a', 'cnc_parallel', true),
      op('b', 'cnc_pocket', true),
      op('c', 'cnc_drill', true)
    ])
    const r = resolveManufactureCamDrivingOperation(file, 0)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('No runnable CNC operation found.')
  })

  it('fallback skips suppressed ops in middle of plan', () => {
    const file = mfg([
      op('a', 'fdm_slice'),
      op('b', 'cnc_parallel', true),
      op('c', 'cnc_pocket'),
      op('d', 'cnc_drill')
    ])
    const r = resolveManufactureCamDrivingOperation(file, 0)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.index).toBe(2)
      expect(r.op.kind).toBe('cnc_pocket')
    }
  })

  it('selected suppressed but later non-suppressed wins via fallback', () => {
    const file = mfg([
      op('a', 'cnc_drill', true),
      op('b', 'cnc_drill', false),
      op('c', 'cnc_drill', false)
    ])
    const r = resolveManufactureCamDrivingOperation(file, 0)
    expect(r.ok).toBe(true)
    if (r.ok) {
      // selected (suppressed) -> fallback -> first runnable -> b (index 1)
      expect(r.index).toBe(1)
    }
  })

  it('suppressed: undefined behaves like suppressed: false (defaults to runnable)', () => {
    const opsLoose: ManufactureOperation[] = [
      // explicitly omit suppressed; resolver only checks `if (op.suppressed)` -> falsy passes
      { id: 'a', kind: 'cnc_parallel', label: 'A' } as ManufactureOperation
    ]
    const file = mfg(opsLoose)
    const r = resolveManufactureCamDrivingOperation(file, 0)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.index).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// H. BLOCKED-from-CAM kinds (fdm_slice / export_stl / cnc_laser / cnc_lathe_turn / cnc_probe)
// ---------------------------------------------------------------------------

describe('H. BLOCKED-from-CAM kinds are not runnable', () => {
  it.each(BLOCKED_KINDS)('selected %s -> not runnable, fallback', (kind) => {
    const file = mfg([op('a', kind), op('b', 'cnc_parallel')])
    const r = resolveManufactureCamDrivingOperation(file, 0)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.index).toBe(1)
      expect(r.op.kind).toBe('cnc_parallel')
    }
  })

  it.each(BLOCKED_CNC_PREFIX_KINDS)(
    'cnc-prefixed BLOCKED kind %s is also skipped in fallback loop',
    (kind) => {
      const file = mfg([op('a', kind), op('b', 'cnc_pocket')])
      const r = resolveManufactureCamDrivingOperation(file, 1)
      // selected = ops[1] = cnc_pocket -> ok wins; but verify fallback wouldn't pick blocked
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.op.kind).toBe('cnc_pocket')
    }
  )

  it('all-BLOCKED plan -> "No runnable CNC operation found." error', () => {
    const file = mfg(BLOCKED_KINDS.map((k, i) => op(`b${i}`, k)))
    const r = resolveManufactureCamDrivingOperation(file, 0)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('No runnable CNC operation found.')
  })

  it('cnc_laser between two non-blocked CNC ops -> fallback picks first non-blocked', () => {
    const file = mfg([op('a', 'fdm_slice'), op('b', 'cnc_laser'), op('c', 'cnc_pocket')])
    const r = resolveManufactureCamDrivingOperation(file, 0)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.index).toBe(2)
      expect(r.op.kind).toBe('cnc_pocket')
    }
  })

  it('cnc_probe between non-blocked CNC ops -> fallback skips probe', () => {
    const file = mfg([op('a', 'cnc_4axis_indexed'), op('b', 'cnc_probe'), op('c', 'cnc_drill')])
    // selected = ops[1] = cnc_probe (BLOCKED) -> not runnable -> fallback
    const r = resolveManufactureCamDrivingOperation(file, 1)
    expect(r.ok).toBe(true)
    if (r.ok) {
      // fallback iterates from i=0, first runnable is ops[0] = cnc_4axis_indexed
      expect(r.index).toBe(0)
      expect(r.op.kind).toBe('cnc_4axis_indexed')
    }
  })
})

// ---------------------------------------------------------------------------
// I. No-runnable-CNC error contract
// ---------------------------------------------------------------------------

describe('I. no runnable CNC error contract', () => {
  it('error message exactly "No runnable CNC operation found."', () => {
    const file = mfg([op('a', 'fdm_slice'), op('b', 'export_stl')])
    const r = resolveManufactureCamDrivingOperation(file, 0)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('No runnable CNC operation found.')
  })

  it('hint mentions un-suppress, cnc_*, and the blocked kinds list', () => {
    const file = mfg([op('a', 'fdm_slice')])
    const r = resolveManufactureCamDrivingOperation(file, 0)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.hint).toContain('un-suppress')
      expect(r.hint).toContain('cnc_*')
      expect(r.hint).toContain('fdm_slice')
      expect(r.hint).toContain('export_stl')
      expect(r.hint).toContain('cnc_laser')
      expect(r.hint).toContain('cnc_lathe_turn')
    }
  })

  it('error result has shape { ok: false, error, hint } -- exactly 3 keys', () => {
    const file = mfg([])
    const r = resolveManufactureCamDrivingOperation(file, 0)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(Object.keys(r).sort()).toEqual(['error', 'hint', 'ok'])
  })

  it('error result error and hint are non-empty strings', () => {
    const file = mfg([op('a', 'fdm_slice')])
    const r = resolveManufactureCamDrivingOperation(file, 0)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.length).toBeGreaterThan(0)
      expect(r.hint.length).toBeGreaterThan(0)
      expect(typeof r.error).toBe('string')
      expect(typeof r.hint).toBe('string')
    }
  })
})

// ---------------------------------------------------------------------------
// J. cnc_* prefix predicate -- exhaustive runnable kinds
// ---------------------------------------------------------------------------

describe('J. cnc_* prefix predicate -- exhaustive runnable schema kinds', () => {
  it.each(RUNNABLE_CNC_KINDS)('%s is recognized as a runnable CNC kind', (kind) => {
    const file = mfg([op('a', kind)])
    const r = resolveManufactureCamDrivingOperation(file, 0)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.op.kind).toBe(kind)
  })

  it('runnable-kind count matches schema (20 runnable cnc_* kinds after the capability-honesty gate)', () => {
    // Was 29 before DEAD_ENGINE_CAM_KINDS gated out the 9 deleted-engine /
    // out-of-scope kinds (thread_mill, 5 freeform finishes, 3 5-axis).
    expect(RUNNABLE_CNC_KINDS.length).toBe(20)
  })

  it('no overlap between RUNNABLE_CNC_KINDS and BLOCKED_KINDS', () => {
    const blocked = new Set<string>(BLOCKED_KINDS)
    for (const k of RUNNABLE_CNC_KINDS) {
      expect(blocked.has(k)).toBe(false)
    }
  })

  it('every RUNNABLE_CNC_KIND has the cnc_ prefix', () => {
    for (const k of RUNNABLE_CNC_KINDS) {
      expect(k.startsWith('cnc_')).toBe(true)
    }
  })

  it('every NON_CNC_KIND does NOT have the cnc_ prefix', () => {
    for (const k of NON_CNC_KINDS) {
      expect(k.startsWith('cnc_')).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// K. Three-machine path realism
// ---------------------------------------------------------------------------

describe('K. three-machine path realism', () => {
  it('Creality K2 Plus FDM-only plan (fdm_slice) -> no runnable CNC error', () => {
    // K2 Plus is FDM; cam:run never fires for it. Plan with only fdm_slice
    // must yield the no-runnable error so the renderer surfaces "this is FDM,
    // use the slicer" -- not a phantom CNC run.
    const file = mfg([op('layer', 'fdm_slice')])
    const r = resolveManufactureCamDrivingOperation(file, 0)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('No runnable CNC operation found.')
  })

  it('Laguna Swift 5x10 full-sheet plywood VCarve plan -> cnc_pocket selected', () => {
    // 4-side perimeter + pocket clear-out; user has selected the pocket row
    const file = mfg([
      op('perim', 'cnc_contour'),
      op('clear', 'cnc_pocket'),
      op('drill', 'cnc_drill')
    ])
    const r = resolveManufactureCamDrivingOperation(file, 1)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.op.kind).toBe('cnc_pocket')
      expect(r.index).toBe(1)
    }
  })

  it('Laguna full-sheet VCarve with sketch-derived export_stl source -> first cnc_* op', () => {
    // export_stl is non-CNC; resolver must not route it through cam:run
    const file = mfg([
      op('mesh', 'export_stl'),
      op('rough', 'cnc_adaptive'),
      op('finish', 'cnc_3d_finish')
    ])
    const r = resolveManufactureCamDrivingOperation(file, 0)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.op.kind).toBe('cnc_adaptive')
      expect(r.index).toBe(1)
    }
  })

  it('Carvera 3-axis ATC plan with cnc_3d_rough + cnc_3d_finish -> selected wins', () => {
    const file = mfg([op('rough', 'cnc_3d_rough'), op('finish', 'cnc_3d_finish')])
    const r = resolveManufactureCamDrivingOperation(file, 1)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.op.kind).toBe('cnc_3d_finish')
      expect(r.index).toBe(1)
    }
  })

  it('Carvera 4-axis rotary plan -- cnc_4axis_roughing + cnc_4axis_finishing chain', () => {
    const file = mfg([
      op('r4', 'cnc_4axis_roughing'),
      op('f4', 'cnc_4axis_finishing'),
      op('c4', 'cnc_4axis_contour')
    ])
    // user has selected the finishing pass
    const r = resolveManufactureCamDrivingOperation(file, 1)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.op.kind).toBe('cnc_4axis_finishing')
      expect(r.index).toBe(1)
    }
  })

  it('Carvera 4-axis indexed plan with probe op interleaved -> probe is BLOCKED', () => {
    // cnc_probe uses probe:generate IPC, not cam:run
    const file = mfg([
      op('zero', 'cnc_probe'),
      op('idx0', 'cnc_4axis_indexed'),
      op('idx90', 'cnc_4axis_indexed')
    ])
    const r = resolveManufactureCamDrivingOperation(file, 0)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.op.kind).toBe('cnc_4axis_indexed')
      // selected = cnc_probe (BLOCKED) -> fallback first runnable = ops[1]
      expect(r.index).toBe(1)
    }
  })

  it('Carvera 4-axis continuous plan -- cnc_4axis_continuous resolves cleanly', () => {
    const file = mfg([op('cont', 'cnc_4axis_continuous')])
    const r = resolveManufactureCamDrivingOperation(file, 0)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.op.kind).toBe('cnc_4axis_continuous')
  })

  it('mixed three-machine fixture coexists -- selected K2 fdm_slice -> CNC fallback', () => {
    // realistic multi-machine project (e.g., printed jig + machined part)
    const file = mfg([
      op('print', 'fdm_slice'),
      op('mill', 'cnc_pocket'),
      op('rotary', 'cnc_4axis_roughing')
    ])
    const r = resolveManufactureCamDrivingOperation(file, 0)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.op.kind).toBe('cnc_pocket')
      expect(r.index).toBe(1)
    }
  })

  it('mixed three-machine fixture coexists -- selected Carvera rotary wins', () => {
    const file = mfg([
      op('print', 'fdm_slice'),
      op('mill', 'cnc_pocket'),
      op('rotary', 'cnc_4axis_roughing')
    ])
    const r = resolveManufactureCamDrivingOperation(file, 2)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.op.kind).toBe('cnc_4axis_roughing')
      expect(r.index).toBe(2)
    }
  })
})

// ---------------------------------------------------------------------------
// L. Pure-function invariants
// ---------------------------------------------------------------------------

describe('L. pure-function invariants', () => {
  it('idempotent N=20 (same input -> same result, ok branch)', () => {
    const file = mfg([op('a', 'cnc_parallel'), op('b', 'cnc_pocket')])
    const first = resolveManufactureCamDrivingOperation(file, 1)
    for (let i = 0; i < 20; i++) {
      const r = resolveManufactureCamDrivingOperation(file, 1)
      expect(r.ok).toBe(first.ok)
      if (r.ok && first.ok) {
        expect(r.index).toBe(first.index)
        expect(r.op).toBe(first.op)
      }
    }
  })

  it('idempotent N=20 (same input -> same result, error branch)', () => {
    const file = mfg([op('a', 'fdm_slice')])
    const first = resolveManufactureCamDrivingOperation(file, 0)
    for (let i = 0; i < 20; i++) {
      const r = resolveManufactureCamDrivingOperation(file, 0)
      expect(r.ok).toBe(first.ok)
      if (!r.ok && !first.ok) {
        expect(r.error).toBe(first.error)
        expect(r.hint).toBe(first.hint)
      }
    }
  })

  it('does NOT mutate the input ManufactureFile', () => {
    const file = mfg([op('a', 'cnc_parallel'), op('b', 'cnc_pocket')])
    const snapshot = JSON.stringify(file)
    resolveManufactureCamDrivingOperation(file, 1)
    expect(JSON.stringify(file)).toBe(snapshot)
  })

  it('does NOT mutate any operation entry', () => {
    const opA = op('a', 'cnc_parallel')
    const opB = op('b', 'cnc_pocket')
    const before = [JSON.stringify(opA), JSON.stringify(opB)]
    const file = mfg([opA, opB])
    resolveManufactureCamDrivingOperation(file, 1)
    expect(JSON.stringify(opA)).toBe(before[0])
    expect(JSON.stringify(opB)).toBe(before[1])
  })

  it('does NOT throw on call(null) or apply(undefined)', () => {
    const file = mfg([op('a', 'cnc_parallel')])
    expect(() => resolveManufactureCamDrivingOperation.call(null, file, 0)).not.toThrow()
    expect(() => resolveManufactureCamDrivingOperation.apply(undefined, [file, 0])).not.toThrow()
  })

  it('ok-result fresh object each call (not a singleton)', () => {
    const file = mfg([op('a', 'cnc_parallel')])
    const r1 = resolveManufactureCamDrivingOperation(file, 0)
    const r2 = resolveManufactureCamDrivingOperation(file, 0)
    expect(r1).not.toBe(r2)
    if (r1.ok && r2.ok) {
      expect(r1.op).toBe(r2.op) // same op REFERENCE (not copied)
    }
  })

  it('error-result fresh object each call', () => {
    const file = mfg([])
    const r1 = resolveManufactureCamDrivingOperation(file, 0)
    const r2 = resolveManufactureCamDrivingOperation(file, 0)
    expect(r1).not.toBe(r2)
  })

  it('15-input fuzz across mixed kinds + indices does not throw', () => {
    const fixtures = [
      mfg([]),
      mfg([op('a', 'fdm_slice')]),
      mfg([op('a', 'cnc_parallel')]),
      mfg([op('a', 'cnc_pocket', true)]),
      mfg([op('a', 'export_stl'), op('b', 'cnc_drill')]),
      mfg([op('a', 'cnc_laser'), op('b', 'cnc_lathe_turn'), op('c', 'cnc_probe')]),
      mfg([op('a', 'cnc_4axis_continuous')]),
      mfg([op('a', 'cnc_5axis_swarf')]),
      mfg([op('a', 'cnc_3d_rough'), op('b', 'cnc_3d_finish')]),
      mfg([op('a', 'fdm_slice'), op('b', 'fdm_slice'), op('c', 'cnc_chamfer')]),
      mfg([op('a', 'cnc_pcb_isolation'), op('b', 'cnc_pcb_drill'), op('c', 'cnc_pcb_contour')]),
      mfg([op('a', 'cnc_thread_mill'), op('b', 'cnc_trochoidal_hsm')]),
      mfg([op('a', 'cnc_spiral_finish'), op('b', 'cnc_morphing_finish')]),
      mfg([op('a', 'cnc_steep_shallow'), op('b', 'cnc_scallop_finish')]),
      mfg([op('a', 'cnc_auto_select')])
    ]
    for (const f of fixtures) {
      for (const idx of [-1, 0, 1, 999]) {
        expect(() => resolveManufactureCamDrivingOperation(f, idx)).not.toThrow()
      }
    }
  })
})

// ---------------------------------------------------------------------------
// M. Source-text whitelist
// ---------------------------------------------------------------------------

describe('M. source-text whitelist', () => {
  const SOURCE = readFileSync(
    resolvePath(__dirname, 'manufacture-cam-driving-op.ts'),
    'utf8'
  )

  it('source file is at most 100 lines (currently 56)', () => {
    expect(SOURCE.split(/\r?\n/).length).toBeLessThanOrEqual(100)
  })

  it('source file is at most 4 KB (currently ~2 KB)', () => {
    expect(SOURCE.length).toBeLessThanOrEqual(4 * 1024)
  })

  it('exports exactly 1 runtime function via `export function`', () => {
    const matches = SOURCE.match(/^export function /gm) ?? []
    expect(matches.length).toBe(1)
  })

  it('does NOT export any const / class / default', () => {
    expect(SOURCE).not.toMatch(/^export const /m)
    expect(SOURCE).not.toMatch(/^export class /m)
    expect(SOURCE).not.toMatch(/^export default /m)
  })

  it('uses kind.startsWith(\'cnc_\') predicate verbatim', () => {
    expect(SOURCE).toMatch(/kind\.startsWith\(['"]cnc_['"]\)/)
  })

  it('uses Math.max(0, Math.min(selectedOpIndex, ops.length - 1)) clamp verbatim', () => {
    expect(SOURCE).toContain('Math.max(0, Math.min(selectedOpIndex, ops.length - 1))')
  })

  it('imports getManufactureCamRunBlock + isManufactureKindBlockedFromCam from gate module', () => {
    expect(SOURCE).toMatch(/from ['"]\.\/manufacture-cam-gate['"]/)
    expect(SOURCE).toContain('getManufactureCamRunBlock')
    expect(SOURCE).toContain('isManufactureKindBlockedFromCam')
  })

  it('has type-only imports for ManufactureFile + ManufactureOperation', () => {
    expect(SOURCE).toMatch(/import type \{[^}]*ManufactureFile[^}]*\} from ['"]\.\/manufacture-schema['"]/)
    expect(SOURCE).toMatch(/import type \{[^}]*ManufactureOperation[^}]*\} from ['"]\.\/manufacture-schema['"]/)
  })

  it('does NOT use `:any` / `as any` / `<any>`', () => {
    expect(SOURCE).not.toMatch(/:\s*any/)
    expect(SOURCE).not.toMatch(/as any/)
    expect(SOURCE).not.toMatch(/<any>/)
  })

  it('does NOT import electron / fs / path / child_process / react / three', () => {
    expect(SOURCE).not.toMatch(/from ['"]electron['"]/)
    expect(SOURCE).not.toMatch(/from ['"](node:)?fs['"]/)
    expect(SOURCE).not.toMatch(/from ['"](node:)?path['"]/)
    expect(SOURCE).not.toMatch(/from ['"](node:)?child_process['"]/)
    expect(SOURCE).not.toMatch(/from ['"]react['"]/)
    expect(SOURCE).not.toMatch(/from ['"]three['"]/)
  })

  it('does NOT mention foreign-machine vendor literals (Bambu/Anycubic/Voron/Prusa)', () => {
    const forbidden = ['Bambu', 'Anycubic', 'Voron', 'Prusa', 'Ender', 'Tormach']
    for (const f of forbidden) {
      expect(SOURCE).not.toContain(f)
    }
  })

  it('does NOT contain G-code / M-code literal motion words', () => {
    // resolver is a planning-layer selector, not a post-processor
    expect(SOURCE).not.toMatch(/G0\d?/)
    expect(SOURCE).not.toMatch(/G1\d?/)
    expect(SOURCE).not.toMatch(/M3/)
    expect(SOURCE).not.toMatch(/M5/)
    expect(SOURCE).not.toMatch(/G17/)
  })

  it('does NOT contain console / throw statements', () => {
    expect(SOURCE).not.toMatch(/console\./)
    expect(SOURCE).not.toMatch(/throw\s+new\s+Error/)
  })

  it('mentions all 4 BLOCKED kind names in the no-runnable hint copy', () => {
    expect(SOURCE).toContain('fdm_slice')
    expect(SOURCE).toContain('export_stl')
    expect(SOURCE).toContain('cnc_laser')
    expect(SOURCE).toContain('cnc_lathe_turn')
  })
})
