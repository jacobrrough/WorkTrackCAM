/**
 * Paired-pin contract for `src/renderer/design/design-command-map.ts` -- a 60-line
 * SHARED renderer-side palette / command-id → SketchTool + SketchConstraint type
 * lookup module consumed by the Fusion-style command palette and the
 * design-command-bridge wiring.
 *
 * The module exports four runtime symbols:
 *
 * - `DESIGN_SKETCH_COMMAND_TO_TOOL`: 26-key Record<commandId, SketchTool>
 *   mapping `sk_*` palette IDs to the `SketchTool` literal-union values
 *   declared in `Sketch2DCanvas.tsx`.
 * - `DESIGN_CONSTRAINT_COMMAND_TO_TYPE`: 16-key Record<commandId, constraint
 *   `type`> mapping `co_*` palette IDs to the discriminated-union `type`
 *   literals from `src/shared/design-schema.ts`.
 * - `sketchToolForDesignCommand`: thin wrapper around the sketch lookup;
 *   returns `undefined` for unknown ids.
 * - `constraintTypeForDesignCommand`: thin wrapper around the constraint
 *   lookup; returns `undefined` for unknown ids.
 *
 * Three-machine impact: INDIRECT cross-cut. The renderer-side design
 * environment is shared across all three target machines (Creality K2 Plus
 * + Laguna Swift 5x10 + Makera Carvera 3-axis + 4-axis Rotary): every
 * machine's ShopApp environment delegates 2D sketch authoring to this
 * module's command-id table. A regression in either lookup table would
 * silently disable a sketch tool or constraint across all four
 * shop-environment quick-switches simultaneously.
 *
 * This pin co-locates with the existing behavioral test
 * `design-command-map.test.ts` (3 it() blocks); the pin is exhaustive
 * against the frozen 26+16 = 42-key table set so any rename, deletion, or
 * addition forces a deliberate update to this file.
 *
 * Roadmap ID: [ID-0293] / Cycle 221.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as M from './design-command-map'
import {
  constraintTypeForDesignCommand,
  DESIGN_CONSTRAINT_COMMAND_TO_TYPE,
  DESIGN_SKETCH_COMMAND_TO_TOOL,
  sketchToolForDesignCommand
} from './design-command-map'

const SOURCE_PATH = resolve(__dirname, 'design-command-map.ts')
const SOURCE = readFileSync(SOURCE_PATH, 'utf-8')

// Frozen reference: the EXACT command-id → tool/type table set as of Cycle 221.
const FROZEN_SKETCH_TABLE = {
  sk_rect: 'rect',
  sk_rect_3pt: 'rect_3pt',
  sk_slot_center: 'slot_center',
  sk_slot_overall: 'slot_overall',
  sk_circle_center: 'circle',
  sk_circle_2pt: 'circle_2pt',
  sk_circle_3pt: 'circle_3pt',
  sk_polyline: 'polyline',
  sk_polygon: 'polygon',
  sk_point: 'point',
  sk_line: 'line',
  sk_arc_3pt: 'arc',
  sk_arc_center: 'arc_center',
  sk_ellipse: 'ellipse',
  sk_spline_fit: 'spline_fit',
  sk_spline_cp: 'spline_cp',
  sk_trim: 'trim',
  sk_split: 'split',
  sk_break: 'break',
  sk_extend: 'extend',
  sk_fillet_sk: 'fillet',
  sk_chamfer_sk: 'chamfer',
  sk_move_sk: 'move_sk',
  sk_rotate_sk: 'rotate_sk',
  sk_scale_sk: 'scale_sk',
  sk_mirror_sk: 'mirror_sk'
} as const

const FROZEN_CONSTRAINT_TABLE = {
  co_horizontal: 'horizontal',
  co_vertical: 'vertical',
  co_coincident: 'coincident',
  co_distance: 'distance',
  co_fix: 'fix',
  co_perpendicular: 'perpendicular',
  co_parallel: 'parallel',
  co_equal: 'equal',
  co_collinear: 'collinear',
  co_midpoint: 'midpoint',
  co_angle: 'angle',
  co_tangent: 'tangent',
  co_symmetric: 'symmetric',
  co_concentric: 'concentric',
  co_radius: 'radius',
  co_diameter: 'diameter'
} as const

describe('design-command-map-pin -- frozen palette/command table contract', () => {
  // ────────────────────────────────────────────────────────────────────────────
  // A. Module shape: exactly four runtime exports.
  // ────────────────────────────────────────────────────────────────────────────
  describe('A. module shape -- exact export set', () => {
    it('exports DESIGN_SKETCH_COMMAND_TO_TOOL', () => {
      expect((M as Record<string, unknown>).DESIGN_SKETCH_COMMAND_TO_TOOL).toBeDefined()
    })

    it('exports DESIGN_CONSTRAINT_COMMAND_TO_TYPE', () => {
      expect((M as Record<string, unknown>).DESIGN_CONSTRAINT_COMMAND_TO_TYPE).toBeDefined()
    })

    it('exports sketchToolForDesignCommand', () => {
      expect((M as Record<string, unknown>).sketchToolForDesignCommand).toBeDefined()
      expect(typeof sketchToolForDesignCommand).toBe('function')
    })

    it('exports constraintTypeForDesignCommand', () => {
      expect((M as Record<string, unknown>).constraintTypeForDesignCommand).toBeDefined()
      expect(typeof constraintTypeForDesignCommand).toBe('function')
    })

    it('exports exactly four runtime symbols (no extras)', () => {
      const keys = Object.keys(M).filter((k) => k !== 'default' && k !== '__esModule')
      expect(keys.sort()).toEqual([
        'DESIGN_CONSTRAINT_COMMAND_TO_TYPE',
        'DESIGN_SKETCH_COMMAND_TO_TOOL',
        'constraintTypeForDesignCommand',
        'sketchToolForDesignCommand'
      ].sort())
    })

    it('does not export a default', () => {
      expect((M as Record<string, unknown>).default).toBeUndefined()
    })

    it('sketchToolForDesignCommand is unary (length === 1)', () => {
      expect(sketchToolForDesignCommand.length).toBe(1)
    })

    it('constraintTypeForDesignCommand is unary (length === 1)', () => {
      expect(constraintTypeForDesignCommand.length).toBe(1)
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  // B. DESIGN_SKETCH_COMMAND_TO_TOOL: exact 26-key set + value contract.
  // ────────────────────────────────────────────────────────────────────────────
  describe('B. DESIGN_SKETCH_COMMAND_TO_TOOL -- exact 26-key contract', () => {
    it('has exactly 26 keys', () => {
      const keys = Object.keys(DESIGN_SKETCH_COMMAND_TO_TOOL)
      expect(keys.length).toBe(26)
    })

    it('all keys start with sk_ prefix', () => {
      for (const k of Object.keys(DESIGN_SKETCH_COMMAND_TO_TOOL)) {
        expect(k.startsWith('sk_')).toBe(true)
      }
    })

    it('exact key set matches the frozen reference', () => {
      const liveKeys = Object.keys(DESIGN_SKETCH_COMMAND_TO_TOOL).sort()
      const frozenKeys = Object.keys(FROZEN_SKETCH_TABLE).sort()
      expect(liveKeys).toEqual(frozenKeys)
    })

    it('exact key/value pairs match the frozen reference', () => {
      for (const [k, v] of Object.entries(FROZEN_SKETCH_TABLE)) {
        expect(DESIGN_SKETCH_COMMAND_TO_TOOL[k]).toBe(v)
      }
    })

    it('sk_circle_center maps to circle (NOT circle_center -- intentional)', () => {
      // The palette command id is `sk_circle_center` but the underlying
      // SketchTool literal is plain 'circle' (the default circle tool is
      // the center-radius variant). This is documentation: do not "fix"
      // the asymmetry without updating the renderer's tool dispatcher.
      expect(DESIGN_SKETCH_COMMAND_TO_TOOL.sk_circle_center).toBe('circle')
      expect(DESIGN_SKETCH_COMMAND_TO_TOOL.sk_circle_center).not.toBe('circle_center')
    })

    it('sk_arc_3pt maps to arc (NOT arc_3pt -- intentional)', () => {
      // Same asymmetry: the palette id is `sk_arc_3pt` but the SketchTool
      // literal is plain 'arc' (the default 3-point variant).
      expect(DESIGN_SKETCH_COMMAND_TO_TOOL.sk_arc_3pt).toBe('arc')
      expect(DESIGN_SKETCH_COMMAND_TO_TOOL.sk_arc_3pt).not.toBe('arc_3pt')
    })

    it('sk_fillet_sk maps to fillet (the _sk suffix is palette-only)', () => {
      expect(DESIGN_SKETCH_COMMAND_TO_TOOL.sk_fillet_sk).toBe('fillet')
    })

    it('sk_chamfer_sk maps to chamfer (the _sk suffix is palette-only)', () => {
      expect(DESIGN_SKETCH_COMMAND_TO_TOOL.sk_chamfer_sk).toBe('chamfer')
    })

    it('sk_move_sk / sk_rotate_sk / sk_scale_sk / sk_mirror_sk preserve the _sk suffix in the SketchTool value (transform tools)', () => {
      // Unlike fillet/chamfer, the four transform tools KEEP the `_sk` suffix
      // in the SketchTool literal because the underlying tool dispatcher uses
      // the suffix to disambiguate sketch-level transforms from feature-level
      // ones.
      expect(DESIGN_SKETCH_COMMAND_TO_TOOL.sk_move_sk).toBe('move_sk')
      expect(DESIGN_SKETCH_COMMAND_TO_TOOL.sk_rotate_sk).toBe('rotate_sk')
      expect(DESIGN_SKETCH_COMMAND_TO_TOOL.sk_scale_sk).toBe('scale_sk')
      expect(DESIGN_SKETCH_COMMAND_TO_TOOL.sk_mirror_sk).toBe('mirror_sk')
    })

    it('all tool values are unique-or-intentionally-shared strings', () => {
      // Most tool literals are unique. The asymmetric pair sk_circle_center→
      // 'circle' and sk_arc_3pt→'arc' are intentional defaults and are the
      // ONLY two NON-injective entries.
      const pairs = Object.entries(DESIGN_SKETCH_COMMAND_TO_TOOL)
      const valueCounts = new Map<string, number>()
      for (const [, v] of pairs) {
        valueCounts.set(v, (valueCounts.get(v) ?? 0) + 1)
      }
      // No value appears more than once (each tool literal has at most one
      // command-id mapping it).
      for (const [, count] of valueCounts) {
        expect(count).toBeLessThanOrEqual(1)
      }
    })

    it('tool values are non-empty kebab-or-snake strings', () => {
      for (const v of Object.values(DESIGN_SKETCH_COMMAND_TO_TOOL)) {
        expect(typeof v).toBe('string')
        expect(v.length).toBeGreaterThan(0)
        expect(v).toMatch(/^[a-z][a-z0-9_]*$/)
      }
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  // C. DESIGN_CONSTRAINT_COMMAND_TO_TYPE: exact 16-key set + value contract.
  // ────────────────────────────────────────────────────────────────────────────
  describe('C. DESIGN_CONSTRAINT_COMMAND_TO_TYPE -- exact 16-key contract', () => {
    it('has exactly 16 keys', () => {
      const keys = Object.keys(DESIGN_CONSTRAINT_COMMAND_TO_TYPE)
      expect(keys.length).toBe(16)
    })

    it('all keys start with co_ prefix', () => {
      for (const k of Object.keys(DESIGN_CONSTRAINT_COMMAND_TO_TYPE)) {
        expect(k.startsWith('co_')).toBe(true)
      }
    })

    it('exact key set matches the frozen reference', () => {
      const liveKeys = Object.keys(DESIGN_CONSTRAINT_COMMAND_TO_TYPE).sort()
      const frozenKeys = Object.keys(FROZEN_CONSTRAINT_TABLE).sort()
      expect(liveKeys).toEqual(frozenKeys)
    })

    it('exact key/value pairs match the frozen reference', () => {
      for (const [k, v] of Object.entries(FROZEN_CONSTRAINT_TABLE)) {
        expect(DESIGN_CONSTRAINT_COMMAND_TO_TYPE[k]).toBe(v)
      }
    })

    it('all constraint types are valid SketchConstraint discriminated-union literals', () => {
      // The 16 constraint type literals must match the discriminated-union
      // tags in `src/shared/design-schema.ts` constraintSchema. If a NEW
      // constraint type is added to the schema, this pin must also gain
      // a NEW co_* command-id.
      const validTypes = new Set([
        'coincident', 'distance', 'horizontal', 'vertical', 'fix',
        'perpendicular', 'parallel', 'equal', 'collinear', 'midpoint',
        'angle', 'tangent', 'symmetric', 'concentric', 'radius', 'diameter'
      ])
      for (const v of Object.values(DESIGN_CONSTRAINT_COMMAND_TO_TYPE)) {
        expect(validTypes.has(v)).toBe(true)
      }
    })

    it('co_* command id strips its prefix to form the type literal (canonical mapping)', () => {
      // For all 16 constraint commands, the type literal is the command id
      // with the `co_` prefix stripped. This is the canonical naming
      // contract -- a violation indicates a typo or rename drift.
      for (const [k, v] of Object.entries(DESIGN_CONSTRAINT_COMMAND_TO_TYPE)) {
        expect(k.slice('co_'.length)).toBe(v)
      }
    })

    it('all 16 constraint types appear exactly once (injective table)', () => {
      const valueCounts = new Map<string, number>()
      for (const v of Object.values(DESIGN_CONSTRAINT_COMMAND_TO_TYPE)) {
        valueCounts.set(v, (valueCounts.get(v) ?? 0) + 1)
      }
      expect(valueCounts.size).toBe(16)
      for (const [, count] of valueCounts) {
        expect(count).toBe(1)
      }
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  // D. sketchToolForDesignCommand: lookup + undefined fallback.
  // ────────────────────────────────────────────────────────────────────────────
  describe('D. sketchToolForDesignCommand -- lookup wrapper', () => {
    it('returns the mapped tool for a known sk_* id', () => {
      expect(sketchToolForDesignCommand('sk_line')).toBe('line')
      expect(sketchToolForDesignCommand('sk_rect')).toBe('rect')
      expect(sketchToolForDesignCommand('sk_polyline')).toBe('polyline')
      expect(sketchToolForDesignCommand('sk_arc_center')).toBe('arc_center')
    })

    it('returns undefined for an unknown id', () => {
      expect(sketchToolForDesignCommand('unknown_id')).toBeUndefined()
      expect(sketchToolForDesignCommand('')).toBeUndefined()
    })

    it('returns undefined for a co_* id (constraint id, not sketch id)', () => {
      // The two tables are disjoint. Passing a co_* id to the sketch lookup
      // must return undefined, NOT silently leak through.
      expect(sketchToolForDesignCommand('co_distance')).toBeUndefined()
      expect(sketchToolForDesignCommand('co_horizontal')).toBeUndefined()
    })

    it('is case-sensitive (SK_LINE returns undefined)', () => {
      expect(sketchToolForDesignCommand('SK_LINE')).toBeUndefined()
      expect(sketchToolForDesignCommand('Sk_Line')).toBeUndefined()
    })

    it('returns undefined for whitespace-padded id', () => {
      expect(sketchToolForDesignCommand(' sk_line ')).toBeUndefined()
      expect(sketchToolForDesignCommand('sk_line ')).toBeUndefined()
      expect(sketchToolForDesignCommand(' sk_line')).toBeUndefined()
    })

    it('does not throw for special-character ids', () => {
      expect(() => sketchToolForDesignCommand('___proto___')).not.toThrow()
      expect(() => sketchToolForDesignCommand('toString')).not.toThrow()
      expect(() => sketchToolForDesignCommand('hasOwnProperty')).not.toThrow()
    })

    it('hits all 26 known sk_* ids', () => {
      // Exhaustive: every key in the table resolves through the wrapper.
      for (const [k, v] of Object.entries(FROZEN_SKETCH_TABLE)) {
        expect(sketchToolForDesignCommand(k)).toBe(v)
      }
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  // E. constraintTypeForDesignCommand: lookup + undefined fallback.
  // ────────────────────────────────────────────────────────────────────────────
  describe('E. constraintTypeForDesignCommand -- lookup wrapper', () => {
    it('returns the mapped type for a known co_* id', () => {
      expect(constraintTypeForDesignCommand('co_distance')).toBe('distance')
      expect(constraintTypeForDesignCommand('co_tangent')).toBe('tangent')
      expect(constraintTypeForDesignCommand('co_perpendicular')).toBe('perpendicular')
      expect(constraintTypeForDesignCommand('co_diameter')).toBe('diameter')
    })

    it('returns undefined for an unknown id', () => {
      expect(constraintTypeForDesignCommand('unknown_id')).toBeUndefined()
      expect(constraintTypeForDesignCommand('')).toBeUndefined()
    })

    it('returns undefined for a sk_* id (sketch id, not constraint id)', () => {
      // The two tables are disjoint.
      expect(constraintTypeForDesignCommand('sk_line')).toBeUndefined()
      expect(constraintTypeForDesignCommand('sk_rect')).toBeUndefined()
    })

    it('is case-sensitive (CO_DISTANCE returns undefined)', () => {
      expect(constraintTypeForDesignCommand('CO_DISTANCE')).toBeUndefined()
      expect(constraintTypeForDesignCommand('Co_Distance')).toBeUndefined()
    })

    it('returns undefined for the bare type name (must use the co_* form)', () => {
      // The table maps `co_distance` → `distance`, not `distance` → `distance`.
      expect(constraintTypeForDesignCommand('distance')).toBeUndefined()
      expect(constraintTypeForDesignCommand('horizontal')).toBeUndefined()
    })

    it('hits all 16 known co_* ids', () => {
      for (const [k, v] of Object.entries(FROZEN_CONSTRAINT_TABLE)) {
        expect(constraintTypeForDesignCommand(k)).toBe(v)
      }
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  // F. Pure-function invariants: lookups are referentially transparent and
  //    don't mutate the underlying tables.
  // ────────────────────────────────────────────────────────────────────────────
  describe('F. pure-function invariants', () => {
    it('repeated calls with the same id return the same value (referential transparency)', () => {
      const a = sketchToolForDesignCommand('sk_line')
      const b = sketchToolForDesignCommand('sk_line')
      const c = sketchToolForDesignCommand('sk_line')
      expect(a).toBe(b)
      expect(b).toBe(c)
      expect(a).toBe('line')
    })

    it('repeated calls with the same constraint id return the same value', () => {
      const a = constraintTypeForDesignCommand('co_distance')
      const b = constraintTypeForDesignCommand('co_distance')
      expect(a).toBe(b)
      expect(a).toBe('distance')
    })

    it('the sketch table itself is not mutated by lookups', () => {
      const before = JSON.stringify(DESIGN_SKETCH_COMMAND_TO_TOOL)
      sketchToolForDesignCommand('sk_line')
      sketchToolForDesignCommand('sk_unknown')
      sketchToolForDesignCommand('co_distance')
      const after = JSON.stringify(DESIGN_SKETCH_COMMAND_TO_TOOL)
      expect(after).toBe(before)
    })

    it('the constraint table itself is not mutated by lookups', () => {
      const before = JSON.stringify(DESIGN_CONSTRAINT_COMMAND_TO_TYPE)
      constraintTypeForDesignCommand('co_distance')
      constraintTypeForDesignCommand('co_unknown')
      constraintTypeForDesignCommand('sk_line')
      const after = JSON.stringify(DESIGN_CONSTRAINT_COMMAND_TO_TYPE)
      expect(after).toBe(before)
    })

    it('lookups do not throw for any string input', () => {
      const inputs = ['', ' ', 'sk_line', 'co_distance', 'sk_', 'co_', '123', 'a'.repeat(10000)]
      for (const i of inputs) {
        expect(() => sketchToolForDesignCommand(i)).not.toThrow()
        expect(() => constraintTypeForDesignCommand(i)).not.toThrow()
      }
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  // G. Three-machine path realism: the design environment is shared across
  //    K2 Plus + Laguna + Carvera 3-axis + Carvera 4-axis. The pin asserts
  //    the table set is INDEPENDENT of which target machine is active --
  //    no machine should be able to disable a sketch tool or constraint.
  // ────────────────────────────────────────────────────────────────────────────
  describe('G. three-machine path realism', () => {
    it('the sketch and constraint tables do not depend on environment / machine state', () => {
      // The module exports plain const records, NOT functions of an
      // environment. The lookups are pure and the tables are static. This
      // pin asserts the tables are POJO-shaped, not derived from any
      // K2/Laguna/Carvera-specific config.
      expect(typeof DESIGN_SKETCH_COMMAND_TO_TOOL).toBe('object')
      expect(typeof DESIGN_CONSTRAINT_COMMAND_TO_TYPE).toBe('object')
      expect(DESIGN_SKETCH_COMMAND_TO_TOOL).not.toBeInstanceOf(Function)
      expect(DESIGN_CONSTRAINT_COMMAND_TO_TYPE).not.toBeInstanceOf(Function)
    })

    it('source has no machine-specific branching (no K2/Laguna/Carvera/Moonraker references)', () => {
      // The design palette is shared across all four shop environments;
      // any leak of machine-specific text into this module would indicate
      // a coupling regression.
      expect(SOURCE).not.toContain('K2 Plus')
      expect(SOURCE).not.toContain('Laguna')
      expect(SOURCE).not.toContain('Carvera')
      expect(SOURCE).not.toContain('Makera')
      expect(SOURCE).not.toContain('Moonraker')
      expect(SOURCE).not.toContain('Klipper')
      expect(SOURCE).not.toContain('RichAuto')
    })

    it('no FDM-specific or CNC-specific verbs leak into the sketch/constraint tables', () => {
      // The palette is geometric, not manufacturing. Words like "extrude",
      // "drill", "feed", "spindle" must NOT appear as command ids or values.
      const allKeys = [
        ...Object.keys(DESIGN_SKETCH_COMMAND_TO_TOOL),
        ...Object.keys(DESIGN_CONSTRAINT_COMMAND_TO_TYPE)
      ]
      const allValues = [
        ...Object.values(DESIGN_SKETCH_COMMAND_TO_TOOL),
        ...Object.values(DESIGN_CONSTRAINT_COMMAND_TO_TYPE)
      ]
      const forbidden = ['extrude', 'drill', 'spindle', 'feed', 'plunge', 'rapid', 'g0', 'g1', 'm6', 'klipper', 'moonraker']
      for (const k of allKeys) {
        for (const f of forbidden) {
          expect(k.toLowerCase()).not.toContain(f)
        }
      }
      for (const v of allValues) {
        for (const f of forbidden) {
          expect(v.toLowerCase()).not.toContain(f)
        }
      }
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  // H. Source-text whitelist: lock the on-disk shape of the module.
  // ────────────────────────────────────────────────────────────────────────────
  describe('H. source-text whitelist', () => {
    it('source file exists and is readable', () => {
      expect(SOURCE.length).toBeGreaterThan(0)
    })

    it('source file is small (< 4 KB)', () => {
      expect(SOURCE.length).toBeLessThan(4096)
    })

    it('source declares the exact two table-comment annotations', () => {
      expect(SOURCE).toContain('Palette / command IDs')
      expect(SOURCE).toContain('sketch drawing tool')
      expect(SOURCE).toContain('constraint type')
    })

    it('source declares import of SketchConstraint type from design-schema', () => {
      expect(SOURCE).toContain("import type { SketchConstraint } from '../../shared/design-schema'")
    })

    it('source declares import of SketchTool type from Sketch2DCanvas', () => {
      expect(SOURCE).toContain("import type { SketchTool } from './Sketch2DCanvas'")
    })

    it('source has exactly TWO `export const` declarations (the two tables)', () => {
      const matches = SOURCE.match(/export const /g) ?? []
      expect(matches.length).toBe(2)
    })

    it('source has exactly TWO `export function` declarations (the two wrappers)', () => {
      const matches = SOURCE.match(/export function /g) ?? []
      expect(matches.length).toBe(2)
    })

    it('source uses Record<string, ...> typings for both tables', () => {
      expect(SOURCE).toContain('Record<string, SketchTool>')
      expect(SOURCE).toContain("Record<string, SketchConstraint['type']>")
    })

    it("source's wrappers return undefined for unknown ids (via index access semantics)", () => {
      // The wrappers return `Map[id]` directly; for an unknown id this
      // yields `undefined`. The pin asserts the implementation pattern
      // does not introduce a default fallback.
      expect(SOURCE).toContain('return DESIGN_SKETCH_COMMAND_TO_TOOL[commandId]')
      expect(SOURCE).toContain('return DESIGN_CONSTRAINT_COMMAND_TO_TYPE[commandId]')
    })

    it('source has NO console., eval, Function, or async/await (synchronous, no I/O)', () => {
      expect(SOURCE).not.toContain('console.')
      expect(SOURCE).not.toMatch(/\beval\s*\(/)
      expect(SOURCE).not.toMatch(/\bnew\s+Function\b/)
      expect(SOURCE).not.toMatch(/\basync\b/)
      expect(SOURCE).not.toMatch(/\bawait\b/)
      expect(SOURCE).not.toMatch(/\bPromise\b/)
    })

    it('source has NO require() calls (ESM only)', () => {
      expect(SOURCE).not.toContain('require(')
    })

    it('source has NO fs/path/os imports (no I/O)', () => {
      expect(SOURCE).not.toContain("from 'node:fs'")
      expect(SOURCE).not.toContain("from 'node:path'")
      expect(SOURCE).not.toContain("from 'node:os'")
    })

    it('source has NO React-component artifacts (this is a plain TS lookup module)', () => {
      expect(SOURCE).not.toContain('React.')
      expect(SOURCE).not.toContain('useState')
      expect(SOURCE).not.toContain('useEffect')
      expect(SOURCE).not.toContain('JSX')
    })

    it('source contains all 26 sk_* command ids exactly once as object keys (followed by `:`)', () => {
      // Some sk_* ids share prefixes (sk_rect / sk_rect_3pt; sk_circle_2pt / sk_circle_3pt
      // / sk_circle_center). We anchor on the trailing `:` that separates the key from
      // the value in the object literal so each id matches its own table entry exactly.
      for (const k of Object.keys(FROZEN_SKETCH_TABLE)) {
        const occurrences = SOURCE.split(k + ':').length - 1
        expect(occurrences).toBe(1)
      }
    })

    it('source contains all 16 co_* command ids exactly once as object keys (followed by `:`)', () => {
      for (const k of Object.keys(FROZEN_CONSTRAINT_TABLE)) {
        const occurrences = SOURCE.split(k + ':').length - 1
        expect(occurrences).toBe(1)
      }
    })

    it('source ends with a single trailing newline (POSIX-clean)', () => {
      expect(SOURCE.endsWith('\n')).toBe(true)
      expect(SOURCE.endsWith('\n\n')).toBe(false)
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  // I. Type-level parity: the wrappers return SketchTool | undefined and
  //    SketchConstraint['type'] | undefined respectively (not `any`).
  // ────────────────────────────────────────────────────────────────────────────
  describe('I. type-level parity', () => {
    it('sketchToolForDesignCommand returns string | undefined at runtime', () => {
      const known = sketchToolForDesignCommand('sk_line')
      const unknown = sketchToolForDesignCommand('unknown_id')
      // `known` is the SketchTool literal-union; at runtime it's a string.
      // `unknown` is undefined.
      expect(typeof known === 'string' || typeof known === 'undefined').toBe(true)
      expect(unknown).toBeUndefined()
    })

    it('constraintTypeForDesignCommand returns string | undefined at runtime', () => {
      const known = constraintTypeForDesignCommand('co_distance')
      const unknown = constraintTypeForDesignCommand('unknown_id')
      expect(typeof known === 'string' || typeof known === 'undefined').toBe(true)
      expect(unknown).toBeUndefined()
    })

    it('returned tool literals survive JSON.stringify round-trip', () => {
      const json = JSON.stringify({ tool: sketchToolForDesignCommand('sk_line') })
      expect(json).toBe('{"tool":"line"}')
      const parsed = JSON.parse(json) as { tool: string | undefined }
      expect(parsed.tool).toBe('line')
    })

    it('undefined results survive JSON.stringify (drop key) round-trip', () => {
      const json = JSON.stringify({ tool: sketchToolForDesignCommand('unknown_id') })
      // `JSON.stringify` drops keys with `undefined` values.
      expect(json).toBe('{}')
    })
  })
})
