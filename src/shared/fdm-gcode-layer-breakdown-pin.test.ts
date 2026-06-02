/**
 * fdm-gcode-layer-breakdown-pin.test.ts — paired pin for the session-only
 * per-layer slicer-breakdown contract (CAD V1.5).
 *
 * Companion to the behavior file `fdm-gcode-layer-breakdown.test.ts`. This
 * pin file additionally locks the SHAPE of `src/shared/fdm-gcode-layer-
 * breakdown.ts` so a careless rename / re-type / stray import fails CI:
 *
 *   (A) Module shape — exact named value exports + symbol-key whitelist.
 *   (B) FdmLineType vocabulary — canonical members, length, ordering.
 *   (C) Source-text whitelist — z.number().nonnegative() (NOT .nonneg()),
 *       session-only docstring, no fs/electron/react imports, no `any`.
 *
 * Mirrors the `fdm-gcode-layer-summary-pin.test.ts` style. ZERO production-
 * code edits. NEW file < 800 lines so the Write tool is safe per
 * `docs/EDIT-WORKFLOW.md` R1.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as M from './fdm-gcode-layer-breakdown'
import {
  EMPTY_FDM_LAYER_BREAKDOWN_RESULT,
  FDM_LINE_TYPES,
  fdmLayerBreakdownResultSchema,
  fdmLayerBreakdownSchema,
  fdmLineTypeCountsSchema,
  fdmLineTypeSchema
} from './fdm-gcode-layer-breakdown'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC_PATH = join(HERE, 'fdm-gcode-layer-breakdown.ts')
const SRC = readFileSync(SRC_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// (A) Module shape
// ---------------------------------------------------------------------------

describe('[CAD-V1.5] fdm-gcode-layer-breakdown module shape', () => {
  it('exports the five Zod schema values + line-type list + empty constant', () => {
    expect(Object.keys(M).sort()).toEqual([
      'EMPTY_FDM_LAYER_BREAKDOWN_RESULT',
      'FDM_LINE_TYPES',
      'fdmLayerBreakdownResultSchema',
      'fdmLayerBreakdownSchema',
      'fdmLineTypeCountsSchema',
      'fdmLineTypeSchema'
    ])
  })

  it('schemas are zod parse-capable objects (expose .parse + .safeParse)', () => {
    for (const s of [
      fdmLineTypeSchema,
      fdmLineTypeCountsSchema,
      fdmLayerBreakdownSchema,
      fdmLayerBreakdownResultSchema
    ]) {
      expect(typeof s.parse).toBe('function')
      expect(typeof s.safeParse).toBe('function')
    }
  })

  it('only Symbol key allowed on the namespace is Symbol.toStringTag', () => {
    const symbolKeys = Reflect.ownKeys(M).filter((k): k is symbol => typeof k === 'symbol')
    for (const s of symbolKeys) {
      expect(s).toBe(Symbol.toStringTag)
    }
  })

  it('EMPTY_FDM_LAYER_BREAKDOWN_RESULT is frozen-shape zero/null shell', () => {
    expect(EMPTY_FDM_LAYER_BREAKDOWN_RESULT.layers).toEqual([])
    expect(EMPTY_FDM_LAYER_BREAKDOWN_RESULT.totalTimeSec).toBeNull()
    expect(EMPTY_FDM_LAYER_BREAKDOWN_RESULT.totalFilamentMm).toBeNull()
    expect(EMPTY_FDM_LAYER_BREAKDOWN_RESULT.layerCount).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// (B) FdmLineType vocabulary
// ---------------------------------------------------------------------------

describe('[CAD-V1.5] FdmLineType vocabulary', () => {
  it('FDM_LINE_TYPES is the exact canonical ordered list', () => {
    expect([...FDM_LINE_TYPES]).toEqual([
      'Outer wall',
      'Inner wall',
      'Sparse infill',
      'Internal solid infill',
      'Top surface',
      'Bottom surface',
      'Bridge',
      'Support',
      'Support interface',
      'Skirt',
      'Brim',
      'Custom',
      'Other'
    ])
  })

  it('every FDM_LINE_TYPES member round-trips through fdmLineTypeSchema', () => {
    for (const t of FDM_LINE_TYPES) {
      expect(fdmLineTypeSchema.parse(t)).toBe(t)
    }
  })

  it("includes the catch-all 'Other' bucket", () => {
    expect(FDM_LINE_TYPES).toContain('Other')
  })
})

// ---------------------------------------------------------------------------
// (C) Source-text whitelist
// ---------------------------------------------------------------------------

describe('[CAD-V1.5] source-text whitelist', () => {
  it('docstring marks the module SESSION-ONLY (no persistence / no migration)', () => {
    expect(SRC).toContain('SESSION-ONLY')
    expect(SRC.toLowerCase()).toContain('no migration')
  })

  it('uses z.number().nonnegative() — NOT the non-existent .nonneg()', () => {
    expect(SRC).toContain('z.number().nonnegative()')
    expect(SRC).not.toContain('.nonneg(')
  })

  it('imports zod', () => {
    expect(SRC).toMatch(/import \{ z \} from ['"]zod['"]/)
  })

  it('declares the canonical exported symbol names verbatim', () => {
    expect(SRC).toContain('export type FdmLineType')
    expect(SRC).toContain('export type FdmLineTypeCounts')
    expect(SRC).toContain('export interface FdmLayerBreakdown')
    expect(SRC).toContain('export interface FdmLayerBreakdownResult')
    expect(SRC).toContain('export const fdmLayerBreakdownSchema')
    expect(SRC).toContain('export const fdmLayerBreakdownResultSchema')
  })

  it('FdmLayerBreakdown carries the six documented fields', () => {
    expect(SRC).toContain('index: number')
    expect(SRC).toContain('zMm: number')
    expect(SRC).toContain('estTimeSec: number | null')
    expect(SRC).toContain('estFilamentMm: number | null')
    expect(SRC).toContain('lineTypeCounts: FdmLineTypeCounts | null')
    expect(SRC).toContain('maxSpeedMmMin: number | null')
  })

  it('FdmLayerBreakdownResult carries the four documented fields', () => {
    expect(SRC).toContain('layers: readonly FdmLayerBreakdown[]')
    expect(SRC).toContain('totalTimeSec: number | null')
    expect(SRC).toContain('totalFilamentMm: number | null')
    expect(SRC).toContain('layerCount: number')
  })

  it('no fs / subprocess / path / electron / react imports (pure schema invariant)', () => {
    expect(SRC).not.toMatch(/from ['"]node:fs/)
    expect(SRC).not.toMatch(/from ['"]node:child_process/)
    expect(SRC).not.toMatch(/from ['"]node:path/)
    expect(SRC).not.toMatch(/from ['"]node:readline/)
    expect(SRC).not.toMatch(/from ['"]electron/)
    expect(SRC).not.toMatch(/from ['"]react/)
    expect(SRC).not.toContain('window.')
    expect(SRC).not.toContain('document.')
  })

  it('does NOT import the persisted project schema (session-only)', () => {
    // The breakdown is ephemeral preview data; it must not couple to the
    // persisted project file. Guard against a stray import only — the
    // docstring may still describe the session-only intent in prose.
    expect(SRC).not.toMatch(/from ['"][^'"]*project-schema['"]/)
    expect(SRC).not.toMatch(/from ['"][^'"]*manufacture-schema['"]/)
  })

  it('no `any` type / `as any` / `<any>` (Safety Rule 3)', () => {
    expect(SRC).not.toMatch(/:\s*any\b/)
    expect(SRC).not.toMatch(/\bas any\b/)
    expect(SRC).not.toMatch(/<any>/)
  })
})
