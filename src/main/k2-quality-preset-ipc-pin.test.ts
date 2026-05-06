/**
 * Phase 2 [P2-K2-SLICE]/Cycle 6 paired pin: K2 Plus quality preset picker UI
 * end-to-end IPC plumbing.
 *
 * This file ALSO functions as a doc-vs-code drift gate. The Manufacture
 * workspace surfaces a K2-only "K2 Plus quality preset" select in
 * `SliceManufacturePanel` whose chosen id ('standard' | 'high_speed') flows:
 *
 *   1. Persisted to `AppSettings.k2QualityPresetId` (project-schema.ts)
 *   2. Surfaced in `SliceManufacturePanel` only when active machine kind === 'fdm'
 *   3. Threaded through `Api.sliceCura` payload (preload/index.ts)
 *   4. Forwarded by the `slice:cura` IPC handler in ipc-fabrication.ts
 *   5. Consumed by `SliceRequest.k2QualityPresetId` in slicer.ts (already pinned)
 *
 * Each step is asserted from on-disk SOURCE text so a careless rename, drop,
 * or re-route at any layer fails CI BEFORE it can ship.
 *
 * Three-machine cross-cut: DIRECT on Creality K2 Plus (the only FDM in the
 * three-machine cohort); INDIRECT on Laguna Swift 5x10 + Makera Carvera
 * (zero CNC-vendor identifiers in the picker code path; the picker is hidden
 * for non-FDM machines).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { appSettingsSchema } from '../shared/project-schema'
import {
  K2_PLUS_QUALITY_PRESET_IDS,
  K2_PLUS_SLICE_PRESETS
} from '../shared/k2-plus-slice-presets'

const REPO_ROOT = resolve(__dirname, '..', '..')
const SCHEMA_SRC = readFileSync(
  resolve(REPO_ROOT, 'src', 'shared', 'project-schema.ts'),
  'utf8'
)
const PRELOAD_SRC = readFileSync(
  resolve(REPO_ROOT, 'src', 'preload', 'index.ts'),
  'utf8'
)
const IPC_SRC = readFileSync(
  resolve(REPO_ROOT, 'src', 'main', 'ipc-fabrication.ts'),
  'utf8'
)
const WORKSPACE_SRC = readFileSync(
  resolve(REPO_ROOT, 'src', 'renderer', 'manufacture', 'ManufactureWorkspace.tsx'),
  'utf8'
)
const PANELS_SRC = readFileSync(
  resolve(REPO_ROOT, 'src', 'renderer', 'manufacture', 'ManufactureAuxPanels.tsx'),
  'utf8'
)

describe('A. AppSettings schema accepts k2QualityPresetId', () => {
  it('A1: schema field is declared in source as z.enum standard|high_speed optional', () => {
    expect(SCHEMA_SRC).toContain(
      "k2QualityPresetId: z.enum(['standard', 'high_speed']).optional()"
    )
  })

  it('A2: appSettingsSchema accepts k2QualityPresetId="standard"', () => {
    const r = appSettingsSchema.safeParse({ k2QualityPresetId: 'standard' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.k2QualityPresetId).toBe('standard')
  })

  it('A3: appSettingsSchema accepts k2QualityPresetId="high_speed"', () => {
    const r = appSettingsSchema.safeParse({ k2QualityPresetId: 'high_speed' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.k2QualityPresetId).toBe('high_speed')
  })

  it('A4: appSettingsSchema rejects unknown k2QualityPresetId', () => {
    const r = appSettingsSchema.safeParse({ k2QualityPresetId: 'turbo' })
    expect(r.success).toBe(false)
  })

  it('A5: appSettingsSchema treats k2QualityPresetId as optional (omit OK)', () => {
    const r = appSettingsSchema.safeParse({})
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.k2QualityPresetId).toBeUndefined()
  })

  it('A6: schema string mentions Phase 2 [P2-K2-SLICE]/Cycle 6 roadmap tag', () => {
    expect(SCHEMA_SRC).toContain('[P2-K2-SLICE]/Cycle 6')
  })

  it('A7: schema string documents that the field is K2-Plus-only', () => {
    expect(SCHEMA_SRC).toMatch(/Creality K2 Plus|active machine.*K2/i)
  })

  it('A8: enum values match the shared K2_PLUS_QUALITY_PRESET_IDS tuple', () => {
    expect([...K2_PLUS_QUALITY_PRESET_IDS]).toEqual(['standard', 'high_speed'])
  })
})

describe('B. preload Api.sliceCura payload type carries k2QualityPresetId', () => {
  it('B1: preload sliceCura type signature includes k2QualityPresetId', () => {
    expect(PRELOAD_SRC).toContain(
      "k2QualityPresetId?: 'standard' | 'high_speed'"
    )
  })

  it('B2: preload sliceCura k2QualityPresetId field has Phase 2 doc anchor', () => {
    expect(PRELOAD_SRC).toMatch(/sliceCura[\s\S]*k2QualityPresetId[\s\S]*?\}\)/)
    expect(PRELOAD_SRC).toContain('[P2-K2-SLICE]/Cycle 6')
  })

  it('B3: preload sliceCura field is OPTIONAL (?: not :)', () => {
    expect(PRELOAD_SRC).not.toMatch(
      /k2QualityPresetId: 'standard' \| 'high_speed'(?!\?)/
    )
    expect(PRELOAD_SRC).toContain(
      "k2QualityPresetId?: 'standard' | 'high_speed'"
    )
  })

  it('B4: preload sliceCura type body block is well-formed', () => {
    const m = PRELOAD_SRC.match(/sliceCura: \(payload: \{([\s\S]+?)\}\) =>/)
    expect(m).not.toBeNull()
    if (m) {
      expect(m[1]).toContain('stlPath: string')
      expect(m[1]).toContain('outPath: string')
      expect(m[1]).toContain('curaEnginePath: string')
      expect(m[1]).toContain('k2QualityPresetId')
    }
  })
})

describe('C. ipc-fabrication.ts slice:cura handler forwards k2QualityPresetId', () => {
  it('C1: handler payload type includes k2QualityPresetId field', () => {
    const handler = IPC_SRC.match(/'slice:cura'[\s\S]+?\)\s*\}\s*\)/)
    expect(handler).not.toBeNull()
    if (handler) {
      expect(handler[0]).toContain(
        "k2QualityPresetId?: 'standard' | 'high_speed'"
      )
    }
  })

  it('C2: handler forwards payload.k2QualityPresetId to sliceWithCuraEngine', () => {
    expect(IPC_SRC).toContain('k2QualityPresetId: payload.k2QualityPresetId')
  })

  it('C3: forwarded field appears INSIDE sliceWithCuraEngine call body', () => {
    const slicerCallMatch = IPC_SRC.match(
      /return sliceWithCuraEngine\(\{([\s\S]+?)\}\)/
    )
    expect(slicerCallMatch).not.toBeNull()
    if (slicerCallMatch) {
      expect(slicerCallMatch[1]).toContain(
        'k2QualityPresetId: payload.k2QualityPresetId'
      )
      // Sanity: the existing fields are still there
      expect(slicerCallMatch[1]).toContain('curaEnginePath: payload.curaEnginePath')
      expect(slicerCallMatch[1]).toContain('inputStlPath: payload.stlPath')
      expect(slicerCallMatch[1]).toContain('outputGcodePath: payload.outPath')
      expect(slicerCallMatch[1]).toContain('slicePreset: payload.slicePreset')
      expect(slicerCallMatch[1]).toContain(
        'curaEngineSettings: payload.curaEngineSettings'
      )
    }
  })

  it('C4: handler payload type Phase 2 doc anchor present', () => {
    const handler = IPC_SRC.match(/'slice:cura'[\s\S]+?\)\s*\}\s*\)/)
    expect(handler).not.toBeNull()
    if (handler) {
      expect(handler[0]).toContain('[P2-K2-SLICE]/Cycle 6')
    }
  })
})

describe('D. ManufactureWorkspace runFdmSliceFromOp threads the preset', () => {
  it('D1: runFdmSliceFromOp passes k2QualityPresetId from settings', () => {
    expect(WORKSPACE_SRC).toContain('k2QualityPresetId: settings.k2QualityPresetId')
  })

  it('D2: the call is inside a fab.sliceCura(...) invocation body', () => {
    const sliceCallMatch = WORKSPACE_SRC.match(
      /fab\.sliceCura\(\{([\s\S]+?)\}\)/
    )
    expect(sliceCallMatch).not.toBeNull()
    if (sliceCallMatch) {
      expect(sliceCallMatch[1]).toContain(
        'k2QualityPresetId: settings.k2QualityPresetId'
      )
      expect(sliceCallMatch[1]).toContain('stlPath')
      expect(sliceCallMatch[1]).toContain('outPath: out')
      expect(sliceCallMatch[1]).toContain('curaEnginePath')
      expect(sliceCallMatch[1]).toContain('slicePreset')
    }
  })

  it('D3: runFdmSliceFromOp body has Phase 2 doc anchor', () => {
    expect(WORKSPACE_SRC).toContain('[P2-K2-SLICE]/Cycle 6')
  })

  it('D4: runFdmSliceFromOp guards on op.kind === fdm_slice (preserved)', () => {
    expect(WORKSPACE_SRC).toContain("op.kind !== 'fdm_slice'")
  })
})

describe('E. ManufactureAuxPanels SliceManufacturePanel renders the picker', () => {
  it('E1: imports K2 preset module from ../../shared/k2-plus-slice-presets', () => {
    expect(PANELS_SRC).toContain("from '../../shared/k2-plus-slice-presets'")
    expect(PANELS_SRC).toContain('K2_PLUS_QUALITY_PRESET_IDS')
    expect(PANELS_SRC).toContain('K2_PLUS_SLICE_PRESETS')
    expect(PANELS_SRC).toContain('type K2PlusQualityPresetId')
  })

  it('E2: derives isK2Plus from active machine kind FDM', () => {
    expect(PANELS_SRC).toContain("p.activeMachine?.kind === 'fdm'")
  })

  it('E3: defaults k2QualityPresetId to "standard" when settings is undefined', () => {
    expect(PANELS_SRC).toMatch(
      /k2QualityPresetId.*=\s*\n?\s*p\.settings\?\.k2QualityPresetId \?\? 'standard'/
    )
  })

  it('E4: renders <select id="mfg-k2-quality-preset"> conditionally on isK2Plus', () => {
    expect(PANELS_SRC).toContain('isK2Plus ? (')
    expect(PANELS_SRC).toContain('id="mfg-k2-quality-preset"')
    expect(PANELS_SRC).toContain(') : null}')
  })

  it('E5: select onChange dispatches onSaveSettingsField with k2QualityPresetId', () => {
    expect(PANELS_SRC).toContain(
      'k2QualityPresetId: e.target.value as K2PlusQualityPresetId'
    )
    expect(PANELS_SRC).toContain('p.onSaveSettingsField')
  })

  it('E6: option list iterates K2_PLUS_QUALITY_PRESET_IDS with K2_PLUS_SLICE_PRESETS labels', () => {
    expect(PANELS_SRC).toContain('K2_PLUS_QUALITY_PRESET_IDS.map((id) =>')
    expect(PANELS_SRC).toContain('{K2_PLUS_SLICE_PRESETS[id].label}')
  })

  it('E7: data-testid hook present for downstream UI integration tests', () => {
    expect(PANELS_SRC).toContain('data-testid="k2-quality-preset-picker"')
  })

  it('E8: visible label text matches "K2 Plus quality preset"', () => {
    expect(PANELS_SRC).toContain('K2 Plus quality preset')
  })
})

describe('F. K2 preset table contract still surfaces both ids with labels', () => {
  it('F1: K2_PLUS_QUALITY_PRESET_IDS exposes exactly standard + high_speed', () => {
    expect([...K2_PLUS_QUALITY_PRESET_IDS]).toEqual(['standard', 'high_speed'])
  })

  it('F2: K2_PLUS_SLICE_PRESETS.standard has a non-empty human label', () => {
    expect(K2_PLUS_SLICE_PRESETS.standard.label.length).toBeGreaterThan(0)
    expect(K2_PLUS_SLICE_PRESETS.standard.label).toMatch(/standard/i)
  })

  it('F3: K2_PLUS_SLICE_PRESETS.high_speed has a non-empty human label', () => {
    expect(K2_PLUS_SLICE_PRESETS.high_speed.label.length).toBeGreaterThan(0)
    expect(K2_PLUS_SLICE_PRESETS.high_speed.label).toMatch(/high.?speed/i)
  })

  it('F4: every preset has a non-empty description suitable for a tooltip', () => {
    for (const id of K2_PLUS_QUALITY_PRESET_IDS) {
      expect(K2_PLUS_SLICE_PRESETS[id].description.length).toBeGreaterThan(20)
    }
  })

  it('F5: every preset settings map has at least the layer_height key', () => {
    for (const id of K2_PLUS_QUALITY_PRESET_IDS) {
      expect(K2_PLUS_SLICE_PRESETS[id].settings.layer_height).toBeDefined()
    }
  })
})

describe('G. Three-machine cross-cut: DIRECT on K2, INDIRECT on Laguna + Carvera', () => {
  it('G1: panels source mentions K2 Plus by name (DIRECT cross-cut anchor)', () => {
    expect(PANELS_SRC).toContain('K2 Plus quality preset')
  })

  it('G2: panels source has zero non-K2 machine vendor identifiers in the picker block', () => {
    // Take just the picker block text
    const m = PANELS_SRC.match(/\{isK2Plus \? \(([\s\S]+?)\) : null\}/)
    expect(m).not.toBeNull()
    if (m) {
      const block = m[1]
      expect(block).not.toMatch(/Laguna/i)
      expect(block).not.toMatch(/RichAuto/i)
      expect(block).not.toMatch(/Carvera/i)
      expect(block).not.toMatch(/Makera/i)
      expect(block).not.toMatch(/Smoothieware/i)
      expect(block).not.toMatch(/spindle/i)
      expect(block).not.toMatch(/router/i)
      expect(block).not.toMatch(/4-axis|four-axis|rotary/i)
    }
  })

  it('G3: the picker is conditionally rendered on FDM machines only', () => {
    expect(PANELS_SRC).toContain("p.activeMachine?.kind === 'fdm'")
  })

  it('G4: schema field is also vendor-neutral by enum (no Creality/Klipper string)', () => {
    const m = SCHEMA_SRC.match(
      /k2QualityPresetId: z\.enum\(\[(.+?)\]\)\.optional\(\)/
    )
    expect(m).not.toBeNull()
    if (m) {
      // Enum literals are id strings, not vendor strings
      expect(m[1]).toContain("'standard'")
      expect(m[1]).toContain("'high_speed'")
      expect(m[1]).not.toMatch(/Creality|Klipper|Moonraker/i)
    }
  })

  it('G5: ipc-fabrication slice:cura handler block has no other machine vendor identifiers', () => {
    const handler = IPC_SRC.match(/'slice:cura'[\s\S]+?\)\s*\}\s*\)/)
    expect(handler).not.toBeNull()
    if (handler) {
      const block = handler[0]
      expect(block).not.toMatch(/Laguna|RichAuto|Carvera|Makera|Smoothieware/i)
      expect(block).not.toMatch(/spindle|router/i)
    }
  })

  it('G6: preload sliceCura signature has no other machine vendor identifiers', () => {
    const m = PRELOAD_SRC.match(
      /sliceCura: \(payload: \{[\s\S]+?\}\) =>[\s\S]+?stdout\?: string \}>/
    )
    expect(m).not.toBeNull()
    if (m) {
      const block = m[0]
      expect(block).not.toMatch(/Laguna|RichAuto|Carvera|Makera|Smoothieware/i)
    }
  })
})

describe('H. SOURCE-text purity: no G-code emission inside the picker block', () => {
  it('H1: panels picker block has no raw G## or M## codes', () => {
    const m = PANELS_SRC.match(/\{isK2Plus \? \(([\s\S]+?)\) : null\}/)
    expect(m).not.toBeNull()
    if (m) {
      const block = m[1]
      expect(block).not.toMatch(/\bG[0-9]+\b/)
      expect(block).not.toMatch(/\bM[0-9]+\b/)
    }
  })

  it('H2: schema field block has no raw G## or M## codes', () => {
    expect(SCHEMA_SRC).not.toMatch(/\bG[0-9][0-9]\b/)
    expect(SCHEMA_SRC).not.toMatch(/\bM[0-9][0-9]\b/)
  })

  it('H3: workspace runFdmSliceFromOp body has no raw G## or M## codes', () => {
    const body = WORKSPACE_SRC.match(
      /async function runFdmSliceFromOp[\s\S]+?^\s*\}/m
    )
    expect(body).not.toBeNull()
    if (body) {
      expect(body[0]).not.toMatch(/\bG[0-9][0-9]\b/)
      expect(body[0]).not.toMatch(/\bM[0-9][0-9]\b/)
    }
  })
})

describe('I. Cross-module invariants', () => {
  it('I1: schema enum values exactly match preload type union', () => {
    // Both sides express the same two literals; assert structurally.
    expect(SCHEMA_SRC).toContain("z.enum(['standard', 'high_speed'])")
    expect(PRELOAD_SRC).toContain("'standard' | 'high_speed'")
    expect(IPC_SRC).toContain("'standard' | 'high_speed'")
  })

  it('I2: K2_PLUS_QUALITY_PRESET_IDS membership matches preload + schema literals', () => {
    for (const id of K2_PLUS_QUALITY_PRESET_IDS) {
      expect(SCHEMA_SRC).toContain(`'${id}'`)
      expect(PRELOAD_SRC).toContain(`'${id}'`)
      expect(IPC_SRC).toContain(`'${id}'`)
    }
  })

  it('I3: every layer references the same field name (no rename drift)', () => {
    // Field name stays "k2QualityPresetId" at every layer
    expect(SCHEMA_SRC.match(/k2QualityPresetId/g)?.length ?? 0).toBeGreaterThanOrEqual(1)
    expect(PRELOAD_SRC.match(/k2QualityPresetId/g)?.length ?? 0).toBeGreaterThanOrEqual(1)
    expect(IPC_SRC.match(/k2QualityPresetId/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
    expect(WORKSPACE_SRC.match(/k2QualityPresetId/g)?.length ?? 0).toBeGreaterThanOrEqual(1)
    expect(PANELS_SRC.match(/k2QualityPresetId/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })

  it('I4: workspace fab.sliceCura body has the same field tied to settings.k2QualityPresetId', () => {
    expect(WORKSPACE_SRC).toContain('k2QualityPresetId: settings.k2QualityPresetId')
  })
})

describe('J. On-disk source provenance + Phase 2 sentinels', () => {
  it('J1: on-disk schema source is a real file with K2 field literal', () => {
    expect(SCHEMA_SRC.length).toBeGreaterThan(1000)
    expect(SCHEMA_SRC).toContain('k2QualityPresetId')
  })

  it('J2: on-disk preload source is a real file with K2 field literal', () => {
    expect(PRELOAD_SRC.length).toBeGreaterThan(1000)
    expect(PRELOAD_SRC).toContain('k2QualityPresetId')
  })

  it('J3: on-disk ipc-fabrication source is a real file with K2 field literal', () => {
    expect(IPC_SRC.length).toBeGreaterThan(1000)
    expect(IPC_SRC).toContain('k2QualityPresetId')
  })

  it('J4: on-disk renderer workspace + panels sources both reference k2QualityPresetId', () => {
    expect(WORKSPACE_SRC.length).toBeGreaterThan(1000)
    expect(WORKSPACE_SRC).toContain('k2QualityPresetId')
    expect(PANELS_SRC.length).toBeGreaterThan(1000)
    expect(PANELS_SRC).toContain('k2QualityPresetId')
  })

  it('J5: every modified source carries a [P2-K2-SLICE]/Cycle 6 doc anchor at the new edge', () => {
    expect(SCHEMA_SRC).toContain('[P2-K2-SLICE]/Cycle 6')
    expect(PRELOAD_SRC).toContain('[P2-K2-SLICE]/Cycle 6')
    expect(IPC_SRC).toContain('[P2-K2-SLICE]/Cycle 6')
    expect(WORKSPACE_SRC).toContain('[P2-K2-SLICE]/Cycle 6')
  })
})
