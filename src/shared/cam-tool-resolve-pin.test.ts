/**
 * Co-located paired-pin contract for `src/shared/cam-tool-resolve.ts`
 *
 * [ID-0267] Cycle 192 test-coverage paired-pin -- pins the runtime contract
 * of the 88-line / 3152-byte SHARED CAM tool-resolution helper consumed by:
 *   - `src/main/cam-edge-cases.test.ts` (main-process CAM-runner test surface)
 *   - `src/renderer/manufacture/ManufactureCamSimulationPanel.tsx:32`
 *     (renderer-side simulation panel for ALL THREE target machines).
 *
 * The module exposes 3 exported pure functions:
 *   - `resolveCamToolDiameterMm({operation, tools}): number | undefined`
 *   - `resolveCamToolType({operation, tools}): ToolRecord['type'] | undefined`
 *   - `resolveCamToolStickoutMm({operation, tools}): number | undefined`
 * plus 3 internal helpers (`positiveNumber`, `positiveNumberFromString`,
 * `firstMillingToolDiameter`) and 1 internal `TYPE_PRIORITY` const tuple.
 *
 * The existing behavioural test `src/shared/cam-tool-resolve.test.ts`
 * (189 lines / 22 it()) covers happy paths and a few negatives. This
 * paired-pin extends coverage to lock the precise contract callers depend
 * on, so a future refactor that silently changes (e.g.) the priority
 * ordering, the strict-positive stickout floor, the explicit-toolDiameterMm
 * precedence over toolId, or the asymmetric handling of NaN/Infinity in the
 * helpers surfaces here.
 *
 * Pinned in this file:
 *   (A) Module shape (3 runtime exports + 0 default + 0 class)
 *   (B) Function signatures (names, arity, native Function, return types)
 *   (C) resolveCamToolDiameterMm priority chain
 *       (explicit toolDiameterMm > toolId > library-first-by-TYPE_PRIORITY)
 *   (D) positiveNumber + positiveNumberFromString edge cases
 *       (NaN / Infinity / 0 / negative / "" / "  " / "abc" / "6.35" / "0.0")
 *   (E) TYPE_PRIORITY ordering --
 *       endmill > ball > face > vbit > drill > other; chamfer / thread_mill
 *       / o_flute / corn are SKIPPED by the picker (NOT in TYPE_PRIORITY)
 *   (F) resolveCamToolType contract (toolId-only path; no param fallback)
 *   (G) resolveCamToolStickoutMm strict-positive contract (`> 0`, not `>= 0`)
 *   (H) Pure-function invariants (idempotent, no input mutation, fresh per
 *       call, no this binding, fuzz-lite no-throw)
 *   (I) Three-machine path realism
 *       (Carvera 4-axis 3 mm ball-end, Laguna 12.7 mm endmill on plywood,
 *       K2 Plus 0.4 mm nozzle line-width)
 *   (J) Source-text whitelist (size, type-only imports, no `any`, no
 *       toolpath G/M-code, no foreign vendors, no electron/fs/three)
 */
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

import * as moduleNs from './cam-tool-resolve'
import {
  resolveCamToolDiameterMm,
  resolveCamToolStickoutMm,
  resolveCamToolType
} from './cam-tool-resolve'
import type { ManufactureOperation } from './manufacture-schema'
import type { ToolLibraryFile, ToolRecord } from './tool-schema'

// --------------------------------------------------------------------------
// Source-text reader (cached) -- used by the whitelist describe block (J).
// --------------------------------------------------------------------------
const SRC_PATH = 'src/shared/cam-tool-resolve.ts'
let SRC: string | null = null
async function readSrc(): Promise<string> {
  if (SRC === null) SRC = await readFile(SRC_PATH, 'utf-8')
  return SRC
}

// --------------------------------------------------------------------------
// Fixtures -- realistic three-machine tool libraries.
// --------------------------------------------------------------------------
const lib6: ToolLibraryFile = {
  version: 1,
  tools: [
    { id: 'p', name: 'Probe', type: 'other', diameterMm: 6 },
    { id: 'em3', name: 'EM 3.175', type: 'endmill', diameterMm: 3.175 },
    { id: 'ball6', name: 'Ball 6', type: 'ball', diameterMm: 6 },
    { id: 'em6s', name: 'EM 6 stickout', type: 'endmill', diameterMm: 6, stickoutMm: 22 },
    { id: 'face25', name: 'Face 25', type: 'face', diameterMm: 25 },
    { id: 'drill5', name: 'Drill 5', type: 'drill', diameterMm: 5 }
  ]
}

function op(params?: Record<string, unknown>): ManufactureOperation {
  return {
    id: 'op-1',
    kind: 'cnc_parallel',
    label: 'op',
    ...(params !== undefined ? { params } : {})
  }
}

// --------------------------------------------------------------------------
// (A) Module shape
// --------------------------------------------------------------------------
describe('[ID-0267] (A) module shape', () => {
  it('exports exactly the 3 expected runtime symbols', () => {
    const keys = Object.keys(moduleNs).sort()
    expect(keys).toEqual([
      'resolveCamToolDiameterMm',
      'resolveCamToolStickoutMm',
      'resolveCamToolType'
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

  it('does not leak the 3 internal helpers (positiveNumber, positiveNumberFromString, firstMillingToolDiameter)', () => {
    const ns = moduleNs as unknown as Record<string, unknown>
    expect(ns.positiveNumber).toBeUndefined()
    expect(ns.positiveNumberFromString).toBeUndefined()
    expect(ns.firstMillingToolDiameter).toBeUndefined()
  })

  it('does not leak the internal TYPE_PRIORITY tuple', () => {
    const ns = moduleNs as unknown as Record<string, unknown>
    expect(ns.TYPE_PRIORITY).toBeUndefined()
  })

  it('every export is a native Function (not a class)', () => {
    for (const k of Object.keys(moduleNs)) {
      const v = (moduleNs as unknown as Record<string, unknown>)[k]
      expect(typeof v).toBe('function')
      // Class constructors stringify with the leading `class ` keyword;
      // pure functions do not.
      expect(String(v).startsWith('class ')).toBe(false)
    }
  })
})

// --------------------------------------------------------------------------
// (B) Function signatures
// --------------------------------------------------------------------------
describe('[ID-0267] (B) function signatures', () => {
  it('resolveCamToolDiameterMm.name is "resolveCamToolDiameterMm"', () => {
    expect(resolveCamToolDiameterMm.name).toBe('resolveCamToolDiameterMm')
  })

  it('resolveCamToolType.name is "resolveCamToolType"', () => {
    expect(resolveCamToolType.name).toBe('resolveCamToolType')
  })

  it('resolveCamToolStickoutMm.name is "resolveCamToolStickoutMm"', () => {
    expect(resolveCamToolStickoutMm.name).toBe('resolveCamToolStickoutMm')
  })

  it('all 3 functions take exactly 1 parameter (Function.length)', () => {
    expect(resolveCamToolDiameterMm.length).toBe(1)
    expect(resolveCamToolType.length).toBe(1)
    expect(resolveCamToolStickoutMm.length).toBe(1)
  })

  it('return type is number|undefined for diameter and stickout', () => {
    const d = resolveCamToolDiameterMm({ operation: op({ toolDiameterMm: 6 }), tools: lib6 })
    expect(typeof d === 'number' || d === undefined).toBe(true)
    const s = resolveCamToolStickoutMm({ operation: op({ toolId: 'em6s' }), tools: lib6 })
    expect(typeof s === 'number' || s === undefined).toBe(true)
  })

  it('return type is string|undefined for type (one of the ToolRecord type union)', () => {
    const t = resolveCamToolType({ operation: op({ toolId: 'em3' }), tools: lib6 })
    expect(typeof t === 'string' || t === undefined).toBe(true)
  })

  it('does not throw for an empty input object (operation+tools both undefined)', () => {
    expect(() =>
      resolveCamToolDiameterMm({ operation: undefined, tools: undefined })
    ).not.toThrow()
    expect(() => resolveCamToolType({ operation: undefined, tools: undefined })).not.toThrow()
    expect(() => resolveCamToolStickoutMm({ operation: undefined, tools: undefined })).not.toThrow()
  })

  it('does not throw for an operation with explicitly-undefined params', () => {
    const o: ManufactureOperation = { id: '1', kind: 'cnc_parallel', label: 'x' }
    expect(() => resolveCamToolDiameterMm({ operation: o, tools: lib6 })).not.toThrow()
    expect(() => resolveCamToolType({ operation: o, tools: lib6 })).not.toThrow()
    expect(() => resolveCamToolStickoutMm({ operation: o, tools: lib6 })).not.toThrow()
  })
})

// --------------------------------------------------------------------------
// (C) resolveCamToolDiameterMm priority chain
// --------------------------------------------------------------------------
describe('[ID-0267] (C) resolveCamToolDiameterMm priority chain', () => {
  it('explicit toolDiameterMm wins over toolId + library', () => {
    const o = op({ toolDiameterMm: 8, toolId: 'em3' })
    // explicit 8 beats em3=3.175.
    expect(resolveCamToolDiameterMm({ operation: o, tools: lib6 })).toBe(8)
  })

  it('explicit toolDiameterMm wins even when toolId is missing from library', () => {
    const o = op({ toolDiameterMm: 12.7, toolId: 'unknown' })
    expect(resolveCamToolDiameterMm({ operation: o, tools: lib6 })).toBe(12.7)
  })

  it('toolId resolves from library when toolDiameterMm absent', () => {
    expect(resolveCamToolDiameterMm({ operation: op({ toolId: 'ball6' }), tools: lib6 })).toBe(6)
  })

  it('toolId missing from library falls through to first-by-priority', () => {
    // No toolDiameterMm, toolId="missing" -- skips the toolId branch and
    // falls to firstMillingToolDiameter which picks em3 (endmill, first
    // by TYPE_PRIORITY).
    expect(resolveCamToolDiameterMm({ operation: op({ toolId: 'missing' }), tools: lib6 })).toBe(
      3.175
    )
  })

  it('no toolDiameterMm + no toolId + library -> first-by-priority', () => {
    expect(resolveCamToolDiameterMm({ operation: op({}), tools: lib6 })).toBe(3.175)
  })

  it('no params + library -> first-by-priority', () => {
    expect(resolveCamToolDiameterMm({ operation: op(), tools: lib6 })).toBe(3.175)
  })

  it('undefined operation + library -> first-by-priority (no operation = no params)', () => {
    expect(resolveCamToolDiameterMm({ operation: undefined, tools: lib6 })).toBe(3.175)
  })

  it('library is null -> undefined (no fallback path)', () => {
    expect(resolveCamToolDiameterMm({ operation: op(), tools: null })).toBeUndefined()
  })

  it('library is undefined -> undefined (no fallback path)', () => {
    expect(resolveCamToolDiameterMm({ operation: op(), tools: undefined })).toBeUndefined()
  })

  it('empty library + no explicit -> undefined', () => {
    const empty: ToolLibraryFile = { version: 1, tools: [] }
    expect(resolveCamToolDiameterMm({ operation: op(), tools: empty })).toBeUndefined()
  })

  it('explicit toolDiameterMm of 0 (rejected by positiveNumber) falls through', () => {
    // 0 is not positive -> positiveNumber returns undefined -> falls through
    // to toolId (absent) -> first-by-priority.
    expect(
      resolveCamToolDiameterMm({ operation: op({ toolDiameterMm: 0 }), tools: lib6 })
    ).toBe(3.175)
  })

  it('explicit toolDiameterMm of -1 (rejected) falls through', () => {
    expect(
      resolveCamToolDiameterMm({ operation: op({ toolDiameterMm: -1 }), tools: lib6 })
    ).toBe(3.175)
  })

  it('explicit toolDiameterMm of NaN (rejected) falls through', () => {
    expect(
      resolveCamToolDiameterMm({ operation: op({ toolDiameterMm: Number.NaN }), tools: lib6 })
    ).toBe(3.175)
  })

  it('explicit toolDiameterMm of Infinity (rejected) falls through', () => {
    expect(
      resolveCamToolDiameterMm({
        operation: op({ toolDiameterMm: Number.POSITIVE_INFINITY }),
        tools: lib6
      })
    ).toBe(3.175)
  })

  it('toolId is empty string -> skipped (length-0 guard) -> first-by-priority', () => {
    expect(resolveCamToolDiameterMm({ operation: op({ toolId: '' }), tools: lib6 })).toBe(3.175)
  })

  it('toolId is non-string (number) -> skipped -> first-by-priority', () => {
    expect(
      resolveCamToolDiameterMm({ operation: op({ toolId: 42 as unknown as string }), tools: lib6 })
    ).toBe(3.175)
  })

  it('params is non-object (string) -> falls back to first-by-priority', () => {
    const o: ManufactureOperation = {
      id: '1',
      kind: 'cnc_parallel',
      label: 'x',
      params: 'oops' as unknown as ManufactureOperation['params']
    }
    expect(resolveCamToolDiameterMm({ operation: o, tools: lib6 })).toBe(3.175)
  })

  it('params is null -> falls back to first-by-priority', () => {
    const o: ManufactureOperation = {
      id: '1',
      kind: 'cnc_parallel',
      label: 'x',
      params: null as unknown as ManufactureOperation['params']
    }
    expect(resolveCamToolDiameterMm({ operation: o, tools: lib6 })).toBe(3.175)
  })
})

// --------------------------------------------------------------------------
// (D) positiveNumber + positiveNumberFromString edge cases
// --------------------------------------------------------------------------
describe('[ID-0267] (D) positiveNumber + string parsing edge cases', () => {
  it('parses numeric string "6.35" with float precision', () => {
    expect(
      resolveCamToolDiameterMm({ operation: op({ toolDiameterMm: '6.35' }), tools: lib6 })
    ).toBeCloseTo(6.35, 5)
  })

  it('parses numeric string "12.7" (Laguna 1/2-inch endmill)', () => {
    expect(
      resolveCamToolDiameterMm({ operation: op({ toolDiameterMm: '12.7' }), tools: lib6 })
    ).toBeCloseTo(12.7, 5)
  })

  it('parses numeric string with leading whitespace " 6.35 " via parseFloat', () => {
    // Number.parseFloat handles leading whitespace per ECMA-262.
    expect(
      resolveCamToolDiameterMm({ operation: op({ toolDiameterMm: ' 6.35 ' }), tools: lib6 })
    ).toBeCloseTo(6.35, 5)
  })

  it('parses numeric string with trailing units "6.35mm" (parseFloat stops at non-numeric)', () => {
    // Number.parseFloat reads as far as it can: "6.35mm" -> 6.35.
    expect(
      resolveCamToolDiameterMm({ operation: op({ toolDiameterMm: '6.35mm' }), tools: lib6 })
    ).toBeCloseTo(6.35, 5)
  })

  it('rejects empty string (passes guard but parseFloat returns NaN)', () => {
    expect(
      resolveCamToolDiameterMm({ operation: op({ toolDiameterMm: '' }), tools: lib6 })
    ).toBe(3.175)
  })

  it('rejects whitespace-only string ("   ") via the trim() === "" guard', () => {
    // The function early-rejects whitespace-only strings before parseFloat.
    expect(
      resolveCamToolDiameterMm({ operation: op({ toolDiameterMm: '   ' }), tools: lib6 })
    ).toBe(3.175)
  })

  it('rejects "abc" (parseFloat -> NaN -> rejected)', () => {
    expect(
      resolveCamToolDiameterMm({ operation: op({ toolDiameterMm: 'abc', toolId: 'ball6' }), tools: lib6 })
    ).toBe(6)
  })

  it('rejects "0" string (parseFloat -> 0 -> not positive)', () => {
    expect(
      resolveCamToolDiameterMm({ operation: op({ toolDiameterMm: '0' }), tools: lib6 })
    ).toBe(3.175)
  })

  it('rejects "-3" string (parseFloat -> -3 -> not positive)', () => {
    expect(
      resolveCamToolDiameterMm({ operation: op({ toolDiameterMm: '-3' }), tools: lib6 })
    ).toBe(3.175)
  })

  it('rejects "Infinity" string (parseFloat -> Infinity -> not finite)', () => {
    expect(
      resolveCamToolDiameterMm({ operation: op({ toolDiameterMm: 'Infinity' }), tools: lib6 })
    ).toBe(3.175)
  })

  it('rejects "NaN" string (parseFloat -> NaN -> rejected)', () => {
    expect(
      resolveCamToolDiameterMm({ operation: op({ toolDiameterMm: 'NaN' }), tools: lib6 })
    ).toBe(3.175)
  })

  it('rejects "3,175" (comma decimal -- parseFloat stops at comma -> 3 -- but locale-comma is parsed as 3 not 3.175)', () => {
    // ASSUMPTION: positiveNumberFromString uses parseFloat which is
    // locale-insensitive. "3,175" parses to 3 (positive), so the helper
    // RETURNS 3, not falls through. This pin documents the locale-dot-only
    // contract -- a regression that adopted locale-aware parsing would
    // surface here.
    expect(
      resolveCamToolDiameterMm({ operation: op({ toolDiameterMm: '3,175' }), tools: lib6 })
    ).toBe(3)
  })

  it('explicit numeric 0 is rejected (positiveNumber strict-positive)', () => {
    expect(
      resolveCamToolDiameterMm({ operation: op({ toolDiameterMm: 0 }), tools: lib6 })
    ).toBe(3.175)
  })

  it('explicit numeric -0 is rejected (-0 is not strictly positive)', () => {
    expect(
      resolveCamToolDiameterMm({ operation: op({ toolDiameterMm: -0 }), tools: lib6 })
    ).toBe(3.175)
  })

  it('explicit numeric Number.MIN_VALUE accepted (smallest positive double)', () => {
    expect(
      resolveCamToolDiameterMm({
        operation: op({ toolDiameterMm: Number.MIN_VALUE }),
        tools: lib6
      })
    ).toBe(Number.MIN_VALUE)
  })

  it('explicit numeric -Infinity rejected (not finite)', () => {
    expect(
      resolveCamToolDiameterMm({
        operation: op({ toolDiameterMm: Number.NEGATIVE_INFINITY }),
        tools: lib6
      })
    ).toBe(3.175)
  })

  it('explicit boolean true is rejected (typeof !== number)', () => {
    expect(
      resolveCamToolDiameterMm({
        operation: op({ toolDiameterMm: true as unknown as number }),
        tools: lib6
      })
    ).toBe(3.175)
  })

  it('explicit array [6] is rejected (typeof object) -- not a number, not a string', () => {
    // typeof [6] === 'object', so positiveNumber rejects it AND the
    // string-branch guard (typeof 'string') also rejects it.
    expect(
      resolveCamToolDiameterMm({
        operation: op({ toolDiameterMm: [6] as unknown as number }),
        tools: lib6
      })
    ).toBe(3.175)
  })

  it('explicit object {value:6} is rejected', () => {
    expect(
      resolveCamToolDiameterMm({
        operation: op({ toolDiameterMm: { value: 6 } as unknown as number }),
        tools: lib6
      })
    ).toBe(3.175)
  })
})

// --------------------------------------------------------------------------
// (E) TYPE_PRIORITY ordering -- 6-tuple, NOT the full 10-value enum
// --------------------------------------------------------------------------
describe('[ID-0267] (E) TYPE_PRIORITY ordering', () => {
  it('endmill is first priority (when present, picked over ball/face/vbit/drill/other)', () => {
    const lib: ToolLibraryFile = {
      version: 1,
      tools: [
        { id: 'a', name: 'Other', type: 'other', diameterMm: 99 },
        { id: 'b', name: 'EM', type: 'endmill', diameterMm: 5 },
        { id: 'c', name: 'Ball', type: 'ball', diameterMm: 7 }
      ]
    }
    expect(resolveCamToolDiameterMm({ operation: op(), tools: lib })).toBe(5)
  })

  it('ball is second priority (when no endmill, picked over face/vbit/drill/other)', () => {
    const lib: ToolLibraryFile = {
      version: 1,
      tools: [
        { id: 'a', name: 'Other', type: 'other', diameterMm: 99 },
        { id: 'b', name: 'Ball', type: 'ball', diameterMm: 7 },
        { id: 'c', name: 'Face', type: 'face', diameterMm: 25 }
      ]
    }
    expect(resolveCamToolDiameterMm({ operation: op(), tools: lib })).toBe(7)
  })

  it('face is third priority (when no endmill/ball)', () => {
    const lib: ToolLibraryFile = {
      version: 1,
      tools: [
        { id: 'a', name: 'Drill', type: 'drill', diameterMm: 5 },
        { id: 'b', name: 'Face', type: 'face', diameterMm: 25 },
        { id: 'c', name: 'Vbit', type: 'vbit', diameterMm: 6 }
      ]
    }
    expect(resolveCamToolDiameterMm({ operation: op(), tools: lib })).toBe(25)
  })

  it('vbit is fourth priority (when no endmill/ball/face)', () => {
    const lib: ToolLibraryFile = {
      version: 1,
      tools: [
        { id: 'a', name: 'Drill', type: 'drill', diameterMm: 5 },
        { id: 'b', name: 'Vbit', type: 'vbit', diameterMm: 6 }
      ]
    }
    expect(resolveCamToolDiameterMm({ operation: op(), tools: lib })).toBe(6)
  })

  it('drill is fifth priority (before other)', () => {
    const lib: ToolLibraryFile = {
      version: 1,
      tools: [
        { id: 'a', name: 'Other', type: 'other', diameterMm: 99 },
        { id: 'b', name: 'Drill', type: 'drill', diameterMm: 5 }
      ]
    }
    expect(resolveCamToolDiameterMm({ operation: op(), tools: lib })).toBe(5)
  })

  it('other is the last-resort fallback', () => {
    const lib: ToolLibraryFile = {
      version: 1,
      tools: [{ id: 'a', name: 'Probe', type: 'other', diameterMm: 6 }]
    }
    expect(resolveCamToolDiameterMm({ operation: op(), tools: lib })).toBe(6)
  })

  it('within a type, .find() picks the FIRST one inserted (insertion order)', () => {
    const lib: ToolLibraryFile = {
      version: 1,
      tools: [
        { id: 'em-a', name: 'EM A', type: 'endmill', diameterMm: 4 },
        { id: 'em-b', name: 'EM B', type: 'endmill', diameterMm: 5 },
        { id: 'em-c', name: 'EM C', type: 'endmill', diameterMm: 6 }
      ]
    }
    expect(resolveCamToolDiameterMm({ operation: op(), tools: lib })).toBe(4)
  })

  it('chamfer-only library returns undefined (chamfer is NOT in TYPE_PRIORITY)', () => {
    // ASSUMPTION: TYPE_PRIORITY = [endmill, ball, face, vbit, drill, other],
    // explicitly excluding chamfer / thread_mill / o_flute / corn. A library
    // that ONLY has those 4 omitted types yields undefined. This is the
    // documented "milling tool" scope -- specialty tools are out of scope
    // for the auto-pick fallback.
    const lib: ToolLibraryFile = {
      version: 1,
      tools: [
        { id: 'a', name: 'Chamfer', type: 'chamfer', diameterMm: 12 }
      ]
    }
    expect(resolveCamToolDiameterMm({ operation: op(), tools: lib })).toBeUndefined()
  })

  it('thread_mill-only library returns undefined (thread_mill not in TYPE_PRIORITY)', () => {
    const lib: ToolLibraryFile = {
      version: 1,
      tools: [{ id: 'a', name: 'TM', type: 'thread_mill', diameterMm: 8 }]
    }
    expect(resolveCamToolDiameterMm({ operation: op(), tools: lib })).toBeUndefined()
  })

  it('o_flute-only library returns undefined (o_flute not in TYPE_PRIORITY)', () => {
    const lib: ToolLibraryFile = {
      version: 1,
      tools: [{ id: 'a', name: 'OFlute', type: 'o_flute', diameterMm: 6 }]
    }
    expect(resolveCamToolDiameterMm({ operation: op(), tools: lib })).toBeUndefined()
  })

  it('corn-only library returns undefined (corn not in TYPE_PRIORITY)', () => {
    const lib: ToolLibraryFile = {
      version: 1,
      tools: [{ id: 'a', name: 'Corn', type: 'corn', diameterMm: 6 }]
    }
    expect(resolveCamToolDiameterMm({ operation: op(), tools: lib })).toBeUndefined()
  })

  it('mixed: endmill is picked even if listed AFTER chamfer/thread_mill', () => {
    const lib: ToolLibraryFile = {
      version: 1,
      tools: [
        { id: 'a', name: 'Chamfer', type: 'chamfer', diameterMm: 12 },
        { id: 'b', name: 'TM', type: 'thread_mill', diameterMm: 8 },
        { id: 'c', name: 'EM', type: 'endmill', diameterMm: 3 }
      ]
    }
    expect(resolveCamToolDiameterMm({ operation: op(), tools: lib })).toBe(3)
  })

  it('toolId can still resolve a chamfer/thread_mill tool (priority is fallback only)', () => {
    const lib: ToolLibraryFile = {
      version: 1,
      tools: [
        { id: 'cham', name: 'Chamfer', type: 'chamfer', diameterMm: 12 },
        { id: 'em', name: 'EM', type: 'endmill', diameterMm: 3 }
      ]
    }
    expect(
      resolveCamToolDiameterMm({ operation: op({ toolId: 'cham' }), tools: lib })
    ).toBe(12)
  })
})

// --------------------------------------------------------------------------
// (F) resolveCamToolType -- toolId-only path, no priority fallback
// --------------------------------------------------------------------------
describe('[ID-0267] (F) resolveCamToolType', () => {
  it('returns the type when toolId resolves in library', () => {
    expect(resolveCamToolType({ operation: op({ toolId: 'em3' }), tools: lib6 })).toBe('endmill')
  })

  it('returns "ball" for a ball tool', () => {
    expect(resolveCamToolType({ operation: op({ toolId: 'ball6' }), tools: lib6 })).toBe('ball')
  })

  it('returns "face" for a face tool', () => {
    expect(resolveCamToolType({ operation: op({ toolId: 'face25' }), tools: lib6 })).toBe('face')
  })

  it('returns "drill" for a drill tool', () => {
    expect(resolveCamToolType({ operation: op({ toolId: 'drill5' }), tools: lib6 })).toBe('drill')
  })

  it('returns undefined when toolId not found', () => {
    expect(
      resolveCamToolType({ operation: op({ toolId: 'missing' }), tools: lib6 })
    ).toBeUndefined()
  })

  it('returns undefined when toolId is omitted (NO priority fallback)', () => {
    // Unlike resolveCamToolDiameterMm, resolveCamToolType has NO library-
    // first-by-priority fallback. This pin protects that asymmetric contract.
    expect(resolveCamToolType({ operation: op(), tools: lib6 })).toBeUndefined()
  })

  it('returns undefined when toolId present but library is null', () => {
    expect(
      resolveCamToolType({ operation: op({ toolId: 'em3' }), tools: null })
    ).toBeUndefined()
  })

  it('returns undefined when toolId present but library is undefined', () => {
    expect(
      resolveCamToolType({ operation: op({ toolId: 'em3' }), tools: undefined })
    ).toBeUndefined()
  })

  it('returns undefined when no params', () => {
    const o: ManufactureOperation = { id: '1', kind: 'cnc_parallel', label: 'x' }
    expect(resolveCamToolType({ operation: o, tools: lib6 })).toBeUndefined()
  })

  it('returns undefined when params is null', () => {
    const o: ManufactureOperation = {
      id: '1',
      kind: 'cnc_parallel',
      label: 'x',
      params: null as unknown as ManufactureOperation['params']
    }
    expect(resolveCamToolType({ operation: o, tools: lib6 })).toBeUndefined()
  })

  it('returns undefined for undefined operation', () => {
    expect(resolveCamToolType({ operation: undefined, tools: lib6 })).toBeUndefined()
  })

  it('toolId is empty string -> length-0 guard rejects -> undefined', () => {
    expect(
      resolveCamToolType({ operation: op({ toolId: '' }), tools: lib6 })
    ).toBeUndefined()
  })

  it('toolId is non-string -> typeof guard rejects -> undefined', () => {
    expect(
      resolveCamToolType({
        operation: op({ toolId: 123 as unknown as string }),
        tools: lib6
      })
    ).toBeUndefined()
  })

  it('does NOT consider toolDiameterMm as a route to resolving type', () => {
    // toolDiameterMm alone never yields a type. The pin protects callers
    // who rely on type to come ONLY from toolId.
    expect(
      resolveCamToolType({ operation: op({ toolDiameterMm: 6 }), tools: lib6 })
    ).toBeUndefined()
  })
})

// --------------------------------------------------------------------------
// (G) resolveCamToolStickoutMm strict-positive contract
// --------------------------------------------------------------------------
describe('[ID-0267] (G) resolveCamToolStickoutMm strict-positive', () => {
  it('returns stickout when tool has positive stickoutMm', () => {
    expect(resolveCamToolStickoutMm({ operation: op({ toolId: 'em6s' }), tools: lib6 })).toBe(22)
  })

  it('returns undefined when matched tool has no stickoutMm', () => {
    expect(
      resolveCamToolStickoutMm({ operation: op({ toolId: 'em3' }), tools: lib6 })
    ).toBeUndefined()
  })

  it('returns undefined when stickoutMm is 0 (strict > 0, not >= 0)', () => {
    // The schema allows nonnegative() (0 is valid), but the resolver applies
    // a strict > 0 check. This asymmetry pins the resolver's tighter floor:
    // a 0-mm stickout is meaningless to the simulation panel and is treated
    // as "absent". A regression that relaxed the check to >= 0 would make
    // the panel render zero-length endmills.
    const lib: ToolLibraryFile = {
      version: 1,
      tools: [{ id: 't', name: 'T', type: 'endmill', diameterMm: 6, stickoutMm: 0 }]
    }
    expect(
      resolveCamToolStickoutMm({ operation: op({ toolId: 't' }), tools: lib })
    ).toBeUndefined()
  })

  it('returns small positive stickout (0.5 mm) intact (no clamping)', () => {
    const lib: ToolLibraryFile = {
      version: 1,
      tools: [{ id: 't', name: 'T', type: 'endmill', diameterMm: 6, stickoutMm: 0.5 }]
    }
    expect(resolveCamToolStickoutMm({ operation: op({ toolId: 't' }), tools: lib })).toBe(0.5)
  })

  it('returns large positive stickout (240 mm Carvera 4-axis flute length) intact', () => {
    const lib: ToolLibraryFile = {
      version: 1,
      tools: [{ id: 't', name: 'Long', type: 'endmill', diameterMm: 6, stickoutMm: 240 }]
    }
    expect(resolveCamToolStickoutMm({ operation: op({ toolId: 't' }), tools: lib })).toBe(240)
  })

  it('returns undefined when toolId not in library', () => {
    expect(
      resolveCamToolStickoutMm({ operation: op({ toolId: 'missing' }), tools: lib6 })
    ).toBeUndefined()
  })

  it('returns undefined when library is null', () => {
    expect(
      resolveCamToolStickoutMm({ operation: op({ toolId: 'em6s' }), tools: null })
    ).toBeUndefined()
  })

  it('returns undefined when library is undefined', () => {
    expect(
      resolveCamToolStickoutMm({ operation: op({ toolId: 'em6s' }), tools: undefined })
    ).toBeUndefined()
  })

  it('returns undefined when no params', () => {
    const o: ManufactureOperation = { id: '1', kind: 'cnc_parallel', label: 'x' }
    expect(resolveCamToolStickoutMm({ operation: o, tools: lib6 })).toBeUndefined()
  })

  it('returns undefined for undefined operation', () => {
    expect(resolveCamToolStickoutMm({ operation: undefined, tools: lib6 })).toBeUndefined()
  })

  it('does NOT fall back to library-first-by-priority (toolId-only)', () => {
    // Like resolveCamToolType, stickout has NO library-first fallback. A
    // regression that added one would silently render endmill stickouts for
    // ops that did NOT name a tool.
    expect(resolveCamToolStickoutMm({ operation: op(), tools: lib6 })).toBeUndefined()
  })

  it('toolId is empty string -> length-0 guard rejects -> undefined', () => {
    expect(
      resolveCamToolStickoutMm({ operation: op({ toolId: '' }), tools: lib6 })
    ).toBeUndefined()
  })
})

// --------------------------------------------------------------------------
// (H) Pure-function invariants
// --------------------------------------------------------------------------
describe('[ID-0267] (H) pure-function invariants', () => {
  it('resolveCamToolDiameterMm is idempotent across N=20 calls', () => {
    const o = op({ toolDiameterMm: 6.35, toolId: 'em3' })
    const first = resolveCamToolDiameterMm({ operation: o, tools: lib6 })
    for (let i = 0; i < 20; i++) {
      expect(resolveCamToolDiameterMm({ operation: o, tools: lib6 })).toBe(first)
    }
  })

  it('resolveCamToolType is idempotent across N=20 calls', () => {
    const o = op({ toolId: 'ball6' })
    const first = resolveCamToolType({ operation: o, tools: lib6 })
    for (let i = 0; i < 20; i++) {
      expect(resolveCamToolType({ operation: o, tools: lib6 })).toBe(first)
    }
  })

  it('resolveCamToolStickoutMm is idempotent across N=20 calls', () => {
    const o = op({ toolId: 'em6s' })
    const first = resolveCamToolStickoutMm({ operation: o, tools: lib6 })
    for (let i = 0; i < 20; i++) {
      expect(resolveCamToolStickoutMm({ operation: o, tools: lib6 })).toBe(first)
    }
  })

  it('does not mutate the input operation', () => {
    const o = op({ toolDiameterMm: 6, toolId: 'em3' })
    const before = JSON.stringify(o)
    resolveCamToolDiameterMm({ operation: o, tools: lib6 })
    resolveCamToolType({ operation: o, tools: lib6 })
    resolveCamToolStickoutMm({ operation: o, tools: lib6 })
    expect(JSON.stringify(o)).toBe(before)
  })

  it('does not mutate the input library', () => {
    const before = JSON.stringify(lib6)
    resolveCamToolDiameterMm({ operation: op({ toolId: 'em3' }), tools: lib6 })
    resolveCamToolType({ operation: op({ toolId: 'em3' }), tools: lib6 })
    resolveCamToolStickoutMm({ operation: op({ toolId: 'em6s' }), tools: lib6 })
    expect(JSON.stringify(lib6)).toBe(before)
  })

  it('does not retain a `this` binding (.call(null) works)', () => {
    expect(() =>
      resolveCamToolDiameterMm.call(null, { operation: op(), tools: lib6 })
    ).not.toThrow()
    expect(() =>
      resolveCamToolType.call(null, { operation: op({ toolId: 'em3' }), tools: lib6 })
    ).not.toThrow()
    expect(() =>
      resolveCamToolStickoutMm.call(null, { operation: op({ toolId: 'em6s' }), tools: lib6 })
    ).not.toThrow()
  })

  it('does not retain a `this` binding (.apply(undefined) works)', () => {
    expect(() =>
      resolveCamToolDiameterMm.apply(undefined, [{ operation: op(), tools: lib6 }])
    ).not.toThrow()
  })

  it('fuzz-lite: 15 random-ish inputs do not throw', () => {
    const inputs: Array<{ operation: ManufactureOperation | undefined; tools: ToolLibraryFile | null | undefined }> = [
      { operation: undefined, tools: undefined },
      { operation: undefined, tools: null },
      { operation: undefined, tools: lib6 },
      { operation: op(), tools: undefined },
      { operation: op(), tools: null },
      { operation: op(), tools: lib6 },
      { operation: op({}), tools: lib6 },
      { operation: op({ toolDiameterMm: 0 }), tools: lib6 },
      { operation: op({ toolDiameterMm: -1 }), tools: lib6 },
      { operation: op({ toolDiameterMm: Number.NaN }), tools: lib6 },
      { operation: op({ toolDiameterMm: 'bogus' }), tools: lib6 },
      { operation: op({ toolId: 'missing' }), tools: lib6 },
      { operation: op({ toolId: 42 as unknown as string }), tools: lib6 },
      { operation: op({ toolId: 'em3', toolDiameterMm: '6.35' }), tools: lib6 },
      { operation: op({ toolId: 'em6s' }), tools: lib6 }
    ]
    for (const inp of inputs) {
      expect(() => resolveCamToolDiameterMm(inp)).not.toThrow()
      expect(() => resolveCamToolType(inp)).not.toThrow()
      expect(() => resolveCamToolStickoutMm(inp)).not.toThrow()
    }
  })

  it('numeric-result equality across the 3 functions for separate calls (no shared state)', () => {
    // Calling diameter then type then stickout in any order on the same
    // input produces the same per-call result.
    const o = op({ toolId: 'em6s', toolDiameterMm: 9 })
    const d1 = resolveCamToolDiameterMm({ operation: o, tools: lib6 })
    const t1 = resolveCamToolType({ operation: o, tools: lib6 })
    const s1 = resolveCamToolStickoutMm({ operation: o, tools: lib6 })
    // Different call order:
    const s2 = resolveCamToolStickoutMm({ operation: o, tools: lib6 })
    const t2 = resolveCamToolType({ operation: o, tools: lib6 })
    const d2 = resolveCamToolDiameterMm({ operation: o, tools: lib6 })
    expect(d1).toBe(d2)
    expect(t1).toBe(t2)
    expect(s1).toBe(s2)
  })
})

// --------------------------------------------------------------------------
// (I) Three-machine path realism
// --------------------------------------------------------------------------
describe('[ID-0267] (I) three-machine path realism', () => {
  // K2 Plus is FDM and does not have a tool library in the same sense, but
  // the simulation panel still calls these helpers with FDM-shaped operations
  // (line-width as "diameter" in some sim contexts). The realistic K2 Plus
  // input is an op with explicit toolDiameterMm = 0.4 (nozzle diameter).
  describe('Creality K2 Plus -- 0.4 mm nozzle line-width', () => {
    it('explicit toolDiameterMm 0.4 (K2 default 0.4 mm nozzle) round-trips', () => {
      const o = op({ toolDiameterMm: 0.4, kind: 'fdm_layer' })
      expect(resolveCamToolDiameterMm({ operation: o, tools: null })).toBe(0.4)
    })

    it('K2 0.6 mm high-flow nozzle round-trips', () => {
      expect(
        resolveCamToolDiameterMm({ operation: op({ toolDiameterMm: 0.6 }), tools: null })
      ).toBe(0.6)
    })

    it('K2 0.2 mm fine nozzle round-trips', () => {
      expect(
        resolveCamToolDiameterMm({ operation: op({ toolDiameterMm: 0.2 }), tools: null })
      ).toBe(0.2)
    })

    it('K2 with empty FDM tool library + no explicit -> undefined (no fallback to milling tools)', () => {
      const empty: ToolLibraryFile = { version: 1, tools: [] }
      expect(resolveCamToolDiameterMm({ operation: op(), tools: empty })).toBeUndefined()
    })
  })

  // Laguna Swift 5x10 is a 3-axis CNC router. Realistic tools: 12.7 mm
  // (1/2") and 6.35 mm (1/4") endmills for plywood/MDF, 25 mm face mill for
  // surfacing, 90-degree V-bit for signage.
  describe('Laguna Swift 5x10 -- full-sheet routing', () => {
    const lagunaLib: ToolLibraryFile = {
      version: 1,
      tools: [
        { id: 'em-1-2', name: '1/2 EM', type: 'endmill', diameterMm: 12.7, stickoutMm: 35 },
        { id: 'em-1-4', name: '1/4 EM', type: 'endmill', diameterMm: 6.35, stickoutMm: 25 },
        { id: 'face-25', name: 'Face 25', type: 'face', diameterMm: 25 },
        { id: 'vbit-90', name: '90 V-bit', type: 'vbit', diameterMm: 12.7 }
      ]
    }

    it('1/2-inch (12.7 mm) endmill resolves by toolId', () => {
      expect(
        resolveCamToolDiameterMm({ operation: op({ toolId: 'em-1-2' }), tools: lagunaLib })
      ).toBe(12.7)
    })

    it('1/4-inch (6.35 mm) endmill resolves by toolId', () => {
      expect(
        resolveCamToolDiameterMm({ operation: op({ toolId: 'em-1-4' }), tools: lagunaLib })
      ).toBe(6.35)
    })

    it('1/2-inch endmill type is "endmill"', () => {
      expect(
        resolveCamToolType({ operation: op({ toolId: 'em-1-2' }), tools: lagunaLib })
      ).toBe('endmill')
    })

    it('V-bit signage tool type is "vbit"', () => {
      expect(
        resolveCamToolType({ operation: op({ toolId: 'vbit-90' }), tools: lagunaLib })
      ).toBe('vbit')
    })

    it('Face mill type is "face"', () => {
      expect(
        resolveCamToolType({ operation: op({ toolId: 'face-25' }), tools: lagunaLib })
      ).toBe('face')
    })

    it('1/2-inch endmill has 35 mm stickout', () => {
      expect(
        resolveCamToolStickoutMm({ operation: op({ toolId: 'em-1-2' }), tools: lagunaLib })
      ).toBe(35)
    })

    it('full-sheet routing op without toolId picks 12.7 mm (first endmill)', () => {
      expect(
        resolveCamToolDiameterMm({ operation: op({}), tools: lagunaLib })
      ).toBe(12.7)
    })

    it('explicit override 19.05 mm (3/4") wins over the library default', () => {
      expect(
        resolveCamToolDiameterMm({
          operation: op({ toolDiameterMm: 19.05, toolId: 'em-1-2' }),
          tools: lagunaLib
        })
      ).toBe(19.05)
    })
  })

  // Makera Carvera + 4-axis: small precision tools. Realistic library is
  // 3 mm ball-end for finishing, 1 mm endmill for fine detail, 6 mm endmill
  // for roughing. The 4th-axis rotary engraving uses small-diameter tools
  // exclusively.
  describe('Makera Carvera + 4th Axis -- small precision tools', () => {
    const carveraLib: ToolLibraryFile = {
      version: 1,
      tools: [
        { id: 'ball-3', name: '3 mm Ball', type: 'ball', diameterMm: 3, stickoutMm: 18 },
        { id: 'em-1', name: '1 mm EM', type: 'endmill', diameterMm: 1, stickoutMm: 8 },
        { id: 'em-6', name: '6 mm EM', type: 'endmill', diameterMm: 6, stickoutMm: 25 },
        { id: 'drill-2', name: '2 mm Drill', type: 'drill', diameterMm: 2 }
      ]
    }

    it('3 mm ball-end finishing tool resolves by toolId', () => {
      expect(
        resolveCamToolDiameterMm({ operation: op({ toolId: 'ball-3' }), tools: carveraLib })
      ).toBe(3)
    })

    it('1 mm fine-detail endmill resolves by toolId', () => {
      expect(
        resolveCamToolDiameterMm({ operation: op({ toolId: 'em-1' }), tools: carveraLib })
      ).toBe(1)
    })

    it('3 mm ball type is "ball" (rotary 4-axis finishing tool)', () => {
      expect(
        resolveCamToolType({ operation: op({ toolId: 'ball-3' }), tools: carveraLib })
      ).toBe('ball')
    })

    it('Carvera op without toolId picks 1 mm (first endmill, NOT ball-3 which is type ball)', () => {
      // TYPE_PRIORITY = endmill > ball > face > vbit > drill > other.
      // Endmill comes BEFORE ball, so the 1 mm em-1 wins over the 3 mm ball-3.
      expect(
        resolveCamToolDiameterMm({ operation: op(), tools: carveraLib })
      ).toBe(1)
    })

    it('rotary_finish op with explicit 2 mm ball override', () => {
      expect(
        resolveCamToolDiameterMm({
          operation: op({ toolDiameterMm: 2, toolId: 'ball-3', kind: 'rotary_finish' }),
          tools: carveraLib
        })
      ).toBe(2)
    })

    it('3 mm ball stickout is 18 mm (Carvera ER-11 collet)', () => {
      expect(
        resolveCamToolStickoutMm({ operation: op({ toolId: 'ball-3' }), tools: carveraLib })
      ).toBe(18)
    })

    it('1 mm endmill stickout is 8 mm (short-flute fine detail)', () => {
      expect(
        resolveCamToolStickoutMm({ operation: op({ toolId: 'em-1' }), tools: carveraLib })
      ).toBe(8)
    })

    it('drill-only op resolves drill type and diameter', () => {
      expect(
        resolveCamToolDiameterMm({ operation: op({ toolId: 'drill-2' }), tools: carveraLib })
      ).toBe(2)
      expect(
        resolveCamToolType({ operation: op({ toolId: 'drill-2' }), tools: carveraLib })
      ).toBe('drill')
    })
  })

  describe('cross-machine fixture coexistence', () => {
    // The simulation panel can have multiple machines' tools loaded
    // simultaneously (one library per project, but the project may include
    // ops for any of the three machines). Verify that the resolver uses
    // the operation's toolId, not the machine, to pick the right tool.
    it('mixed library: K2 nozzle + Laguna endmill + Carvera ball -- each toolId resolves correctly', () => {
      const lib: ToolLibraryFile = {
        version: 1,
        tools: [
          { id: 'k2', name: 'K2 0.4', type: 'other', diameterMm: 0.4 },
          { id: 'laguna', name: 'Laguna 1/2', type: 'endmill', diameterMm: 12.7 },
          { id: 'carvera', name: 'Carvera 3 ball', type: 'ball', diameterMm: 3 }
        ]
      }
      expect(resolveCamToolDiameterMm({ operation: op({ toolId: 'k2' }), tools: lib })).toBe(0.4)
      expect(
        resolveCamToolDiameterMm({ operation: op({ toolId: 'laguna' }), tools: lib })
      ).toBe(12.7)
      expect(
        resolveCamToolDiameterMm({ operation: op({ toolId: 'carvera' }), tools: lib })
      ).toBe(3)
    })

    it('mixed library: priority fallback picks endmill (Laguna 12.7) over ball (Carvera 3) and other (K2 0.4)', () => {
      const lib: ToolLibraryFile = {
        version: 1,
        tools: [
          { id: 'k2', name: 'K2 0.4', type: 'other', diameterMm: 0.4 },
          { id: 'laguna', name: 'Laguna 1/2', type: 'endmill', diameterMm: 12.7 },
          { id: 'carvera', name: 'Carvera 3 ball', type: 'ball', diameterMm: 3 }
        ]
      }
      // Op without toolId -> first-by-priority -> endmill -> 12.7.
      expect(resolveCamToolDiameterMm({ operation: op(), tools: lib })).toBe(12.7)
    })
  })
})

// --------------------------------------------------------------------------
// (J) Source-text whitelist
// --------------------------------------------------------------------------
describe('[ID-0267] (J) source-text whitelist', () => {
  it('source file is <= 100 lines (small, focused resolver)', async () => {
    const src = await readSrc()
    expect(src.split('\n').length).toBeLessThanOrEqual(100)
  })

  it('source file is <= 4000 bytes (size canary)', async () => {
    const src = await readSrc()
    expect(Buffer.byteLength(src, 'utf-8')).toBeLessThanOrEqual(4000)
  })

  it('exports exactly 3 runtime functions', async () => {
    const src = await readSrc()
    const matches = src.match(/^export\s+function\s+\w+/gm) ?? []
    expect(matches.length).toBe(3)
  })

  it('exports no const symbols (TYPE_PRIORITY is internal)', async () => {
    const src = await readSrc()
    const matches = src.match(/^export\s+const\s+\w+/gm) ?? []
    expect(matches.length).toBe(0)
  })

  it('exports no type aliases (consumers use the imported types)', async () => {
    const src = await readSrc()
    const matches = src.match(/^export\s+type\s+\w+/gm) ?? []
    expect(matches.length).toBe(0)
  })

  it('imports ManufactureOperation type-only from manufacture-schema', async () => {
    const src = await readSrc()
    expect(src).toMatch(/import\s+type\s+\{[^}]*ManufactureOperation[^}]*\}\s+from\s+'\.\/manufacture-schema'/)
  })

  it('imports ToolLibraryFile + ToolRecord type-only from tool-schema', async () => {
    const src = await readSrc()
    expect(src).toMatch(/import\s+type\s+\{[^}]*ToolLibraryFile[^}]*\}\s+from\s+'\.\/tool-schema'/)
    expect(src).toMatch(/import\s+type\s+\{[^}]*ToolRecord[^}]*\}\s+from\s+'\.\/tool-schema'/)
  })

  it('TYPE_PRIORITY tuple appears verbatim with the 6-value ordering', async () => {
    const src = await readSrc()
    expect(src).toMatch(
      /TYPE_PRIORITY[^=]*=\s*\[\s*'endmill'\s*,\s*'ball'\s*,\s*'face'\s*,\s*'vbit'\s*,\s*'drill'\s*,\s*'other'\s*\]/
    )
  })

  it('TYPE_PRIORITY does NOT include chamfer/thread_mill/o_flute/corn', async () => {
    const src = await readSrc()
    // The full enum has 10 values; TYPE_PRIORITY has 6. Confirm the four
    // omitted specialty types do NOT appear in the priority tuple line.
    const m = src.match(/TYPE_PRIORITY[^=]*=\s*\[[^\]]*\]/)
    expect(m).not.toBeNull()
    if (m) {
      expect(m[0]).not.toContain("'chamfer'")
      expect(m[0]).not.toContain("'thread_mill'")
      expect(m[0]).not.toContain("'o_flute'")
      expect(m[0]).not.toContain("'corn'")
    }
  })

  it('positiveNumber strict-positive guard appears (typeof + finite + > 0)', async () => {
    const src = await readSrc()
    expect(src).toMatch(/typeof\s+v\s*!==\s*'number'/)
    expect(src).toMatch(/Number\.isFinite/)
    expect(src).toMatch(/v\s*<=\s*0/)
  })

  it('positiveNumberFromString uses Number.parseFloat (locale-insensitive)', async () => {
    const src = await readSrc()
    expect(src).toMatch(/Number\.parseFloat/)
    // Should NOT use locale-aware Intl.NumberFormat parsing.
    expect(src).not.toContain('Intl.NumberFormat')
  })

  it('strict-positive stickout check `> 0` (not `>= 0`)', async () => {
    const src = await readSrc()
    // The exact source has `rec.stickoutMm > 0`. Confirm `>= 0` is NOT used.
    expect(src).toMatch(/stickoutMm\s*>\s*0/)
    expect(src).not.toMatch(/stickoutMm\s*>=\s*0/)
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
      'M65',
      'M104',
      'M140',
      'M109',
      'M190'
    ]) {
      expect(src).not.toContain(code)
    }
  })

  it('no electron / child_process / fs / path / react / three leakage', async () => {
    const src = await readSrc()
    for (const banned of [
      'electron',
      'child_process',
      'node:fs',
      'node:path',
      "from 'react'",
      "from 'three'"
    ]) {
      expect(src).not.toContain(banned)
    }
  })

  it('no default export', async () => {
    const src = await readSrc()
    expect(src).not.toMatch(/^export\s+default\b/m)
  })

  it('no class declaration', async () => {
    const src = await readSrc()
    expect(src).not.toMatch(/^\s*(?:export\s+)?(?:abstract\s+)?class\s+\w+/m)
  })

  it('imports are type-only (no runtime imports beyond the source itself)', async () => {
    const src = await readSrc()
    // Every `import` line should start with `import type` (we have only 2
    // imports; both should be type-only).
    const importLines = src.split('\n').filter((l) => /^\s*import\b/.test(l))
    expect(importLines.length).toBe(2)
    for (const l of importLines) {
      expect(l).toMatch(/^\s*import\s+type\b/)
    }
  })

  it('no `console.` calls (pure function, no side effects)', async () => {
    const src = await readSrc()
    expect(src).not.toMatch(/\bconsole\.\w+/)
  })

  it('no `throw new` in source (resolver is total -- always returns)', async () => {
    const src = await readSrc()
    expect(src).not.toMatch(/\bthrow\s+new\b/)
  })

  it('TYPE_PRIORITY const is `readonly` (immutability marker)', async () => {
    const src = await readSrc()
    // Source declares: `const TYPE_PRIORITY: readonly ToolRecord['type'][] = ...`
    expect(src).toMatch(/TYPE_PRIORITY\s*:\s*readonly\s+ToolRecord\['type'\]\[\]/)
  })
})
