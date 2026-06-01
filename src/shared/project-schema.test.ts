import { describe, expect, it } from 'vitest'
import {
  projectSchema,
  appSettingsSchema,
  importHistoryEntrySchema,
  roundTripLevelSchema,
  designModelSchema,
  designTessellationSchema,
  type ProjectFile,
  type AppSettings,
  type ImportHistoryEntry,
  type DesignModel,
  type DesignTessellation
} from './project-schema'

describe('roundTripLevelSchema', () => {
  it('accepts valid round trip levels', () => {
    expect(roundTripLevelSchema.parse('mesh_only')).toBe('mesh_only')
    expect(roundTripLevelSchema.parse('partial')).toBe('partial')
    expect(roundTripLevelSchema.parse('full')).toBe('full')
  })

  it('rejects invalid values', () => {
    expect(() => roundTripLevelSchema.parse('invalid')).toThrow()
    expect(() => roundTripLevelSchema.parse('')).toThrow()
    expect(() => roundTripLevelSchema.parse(123)).toThrow()
  })
})

describe('importHistoryEntrySchema', () => {
  const validEntry = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    importedAt: '2024-01-01T00:00:00.000Z',
    sourceFormat: 'stl',
    sourceFileName: 'part.stl',
    assetRelativePath: 'assets/part.stl',
    roundTripLevel: 'mesh_only' as const
  }

  it('accepts a valid entry', () => {
    const result = importHistoryEntrySchema.parse(validEntry)
    expect(result.id).toBe(validEntry.id)
    expect(result.sourceFormat).toBe('stl')
    expect(result.roundTripLevel).toBe('mesh_only')
  })

  it('accepts an entry with warnings array', () => {
    const withWarnings = { ...validEntry, warnings: ['Scale mismatch detected'] }
    const result = importHistoryEntrySchema.parse(withWarnings)
    expect(result.warnings).toEqual(['Scale mismatch detected'])
  })

  it('accepts an entry without optional warnings', () => {
    const result = importHistoryEntrySchema.parse(validEntry)
    expect(result.warnings).toBeUndefined()
  })

  it('rejects an entry with invalid UUID', () => {
    expect(() => importHistoryEntrySchema.parse({ ...validEntry, id: 'not-a-uuid' })).toThrow()
  })

  it('rejects an entry missing required fields', () => {
    const { sourceFormat, ...incomplete } = validEntry
    expect(() => importHistoryEntrySchema.parse(incomplete)).toThrow()
  })
})

describe('projectSchema', () => {
  const validProject = {
    version: 1 as const,
    name: 'My Project',
    updatedAt: '2024-06-15T12:30:00.000Z',
    activeMachineId: 'machine-001'
  }

  it('accepts a minimal valid project', () => {
    const result = projectSchema.parse(validProject)
    expect(result.version).toBe(1)
    expect(result.name).toBe('My Project')
    expect(result.activeMachineId).toBe('machine-001')
    expect(result.meshes).toEqual([])
    expect(result.importHistory).toEqual([])
  })

  it('applies defaults for meshes and importHistory', () => {
    const result = projectSchema.parse(validProject)
    expect(result.meshes).toEqual([])
    expect(result.importHistory).toEqual([])
  })

  it('accepts a project with all optional fields', () => {
    const full = {
      ...validProject,
      meshes: ['part1.stl', 'part2.stl'],
      importHistory: [],
      notes: 'Initial import',
      physicalMaterial: { name: 'Aluminum 6061', densityKgM3: 2700 },
      appearanceNotes: 'Brushed silver finish'
    }
    const result = projectSchema.parse(full)
    expect(result.notes).toBe('Initial import')
    expect(result.physicalMaterial?.name).toBe('Aluminum 6061')
    expect(result.physicalMaterial?.densityKgM3).toBe(2700)
    expect(result.appearanceNotes).toBe('Brushed silver finish')
  })

  it('rejects version != 1', () => {
    expect(() => projectSchema.parse({ ...validProject, version: 2 })).toThrow()
    expect(() => projectSchema.parse({ ...validProject, version: 0 })).toThrow()
  })

  it('rejects empty name', () => {
    expect(() => projectSchema.parse({ ...validProject, name: '' })).toThrow()
    expect(() => projectSchema.parse({ ...validProject, name: '   ' })).toThrow()
  })

  it('trims whitespace from name', () => {
    const result = projectSchema.parse({ ...validProject, name: '  Trimmed  ' })
    expect(result.name).toBe('Trimmed')
  })

  it('rejects empty activeMachineId', () => {
    expect(() => projectSchema.parse({ ...validProject, activeMachineId: '' })).toThrow()
  })

  it('rejects non-positive density', () => {
    const bad = {
      ...validProject,
      physicalMaterial: { name: 'Steel', densityKgM3: -100 }
    }
    expect(() => projectSchema.parse(bad)).toThrow()
  })

  it('accepts physicalMaterial with only name (no density)', () => {
    const partial = {
      ...validProject,
      physicalMaterial: { name: 'Wood' }
    }
    const result = projectSchema.parse(partial)
    expect(result.physicalMaterial?.name).toBe('Wood')
    expect(result.physicalMaterial?.densityKgM3).toBeUndefined()
  })
})

// ── Design workspace (CadQuery) — additive schema pinning ───────────────────
// SPEC-pinned: the Design workspace stores CadQuery scripts inside the project
// file with optional cached tessellation descriptors. The field is additive
// with `.default([])` so v1 project.json files saved before the workspace
// landed parse unchanged. Safety Rule 2 (never break existing saved projects)
// is the load-bearing invariant here — if the v1-without-designModels test
// ever fails, every existing user project breaks on open.

describe('designTessellationSchema', () => {
  const validTessellation = {
    stlRelativePath: 'assets/designs/550e8400-e29b-41d4-a716-446655440000/tessellation_0.05mm.stl',
    toleranceMm: 0.05,
    triangleCount: 1248,
    bbox: {
      min: [-25.4, -25.4, 0] as [number, number, number],
      max: [25.4, 25.4, 12.7] as [number, number, number]
    },
    generatedAt: '2026-06-01T10:00:00.000Z'
  }

  it('accepts a valid tessellation descriptor', () => {
    const result = designTessellationSchema.parse(validTessellation)
    expect(result.stlRelativePath).toBe(validTessellation.stlRelativePath)
    expect(result.toleranceMm).toBe(0.05)
    expect(result.triangleCount).toBe(1248)
  })

  it('preserves bbox tuples exactly (no rearrangement)', () => {
    const result = designTessellationSchema.parse(validTessellation)
    expect(result.bbox.min).toEqual([-25.4, -25.4, 0])
    expect(result.bbox.max).toEqual([25.4, 25.4, 12.7])
  })

  it('rejects non-positive toleranceMm (zero or negative chord tolerance is nonsense)', () => {
    expect(() => designTessellationSchema.parse({ ...validTessellation, toleranceMm: 0 })).toThrow()
    expect(() => designTessellationSchema.parse({ ...validTessellation, toleranceMm: -0.1 })).toThrow()
  })

  it('rejects non-integer triangleCount', () => {
    expect(() => designTessellationSchema.parse({ ...validTessellation, triangleCount: 1.5 })).toThrow()
  })

  it('rejects negative triangleCount', () => {
    expect(() => designTessellationSchema.parse({ ...validTessellation, triangleCount: -1 })).toThrow()
  })

  it('rejects bbox tuples with wrong arity (must be exactly [x, y, z])', () => {
    expect(() =>
      designTessellationSchema.parse({
        ...validTessellation,
        bbox: { min: [0, 0], max: [1, 1, 1] }
      })
    ).toThrow()
    expect(() =>
      designTessellationSchema.parse({
        ...validTessellation,
        bbox: { min: [0, 0, 0, 0], max: [1, 1, 1] }
      })
    ).toThrow()
  })
})

describe('designModelSchema', () => {
  const validDesign: DesignModel = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    name: 'Bracket v1',
    scriptText: 'import cadquery as cq\nresult = cq.Workplane("XY").box(50, 50, 25)\n',
    createdAt: '2026-06-01T09:00:00.000Z',
    updatedAt: '2026-06-01T09:15:00.000Z'
  }

  it('accepts a minimal design model (no tessellation yet)', () => {
    const result = designModelSchema.parse(validDesign)
    expect(result.id).toBe(validDesign.id)
    expect(result.name).toBe('Bracket v1')
    expect(result.scriptText).toContain('cq.Workplane')
    expect(result.lastTessellation).toBeUndefined()
  })

  it('accepts a design model with cached tessellation', () => {
    const withTessellation = {
      ...validDesign,
      lastTessellation: {
        stlRelativePath: 'assets/designs/550e8400-e29b-41d4-a716-446655440000/tessellation_0.1mm.stl',
        toleranceMm: 0.1,
        triangleCount: 512,
        bbox: { min: [-25, -25, 0] as [number, number, number], max: [25, 25, 25] as [number, number, number] },
        generatedAt: '2026-06-01T09:20:00.000Z'
      }
    }
    const result = designModelSchema.parse(withTessellation)
    expect(result.lastTessellation?.triangleCount).toBe(512)
    expect(result.lastTessellation?.bbox.max).toEqual([25, 25, 25])
  })

  it('rejects scriptText: undefined (script text is the source of truth — cannot be absent)', () => {
    const { scriptText: _omitted, ...withoutScript } = validDesign
    expect(() => designModelSchema.parse(withoutScript)).toThrow()
    expect(() => designModelSchema.parse({ ...validDesign, scriptText: undefined })).toThrow()
  })

  it('rejects a design model missing id', () => {
    const { id: _omitted, ...withoutId } = validDesign
    expect(() => designModelSchema.parse(withoutId)).toThrow()
  })

  it('rejects a non-UUID id', () => {
    expect(() => designModelSchema.parse({ ...validDesign, id: 'not-a-uuid' })).toThrow()
  })

  it('rejects empty name', () => {
    expect(() => designModelSchema.parse({ ...validDesign, name: '' })).toThrow()
    expect(() => designModelSchema.parse({ ...validDesign, name: '   ' })).toThrow()
  })

  it('trims whitespace from name', () => {
    const result = designModelSchema.parse({ ...validDesign, name: '  Bracket v1  ' })
    expect(result.name).toBe('Bracket v1')
  })
})

describe('projectSchema designModels field (Safety Rule 2: never break existing saved projects)', () => {
  const baseProject = {
    version: 1 as const,
    name: 'Existing Project',
    updatedAt: '2026-06-01T12:00:00.000Z',
    activeMachineId: 'machine-001'
  }

  it('v1 project JSON WITHOUT designModels parses and defaults to [] (load-bearing back-compat)', () => {
    // This is the load-bearing test for Safety Rule 2. If it ever fails, every
    // existing .wtcam project on disk breaks on open. The `.default([])` on the
    // `designModels` field is the line that makes this work.
    const result = projectSchema.parse(baseProject)
    expect(result.designModels).toEqual([])
    expect(Array.isArray(result.designModels)).toBe(true)
  })

  it('round-trip with a populated designModel preserves scriptText, bbox tuples, and uuid id', () => {
    const designId = '550e8400-e29b-41d4-a716-446655440000'
    const scriptText = 'import cadquery as cq\nresult = cq.Workplane("XY").box(50, 50, 25).faces(">Z").hole(10)\n'
    const tessellation = {
      stlRelativePath: `assets/designs/${designId}/tessellation_0.05mm.stl`,
      toleranceMm: 0.05,
      triangleCount: 2048,
      bbox: {
        min: [-25, -25, 0] as [number, number, number],
        max: [25, 25, 25] as [number, number, number]
      },
      generatedAt: '2026-06-01T10:00:00.000Z'
    }
    const projectWithDesign = {
      ...baseProject,
      designModels: [
        {
          id: designId,
          name: 'Bracket with hole',
          scriptText,
          createdAt: '2026-06-01T09:00:00.000Z',
          updatedAt: '2026-06-01T09:30:00.000Z',
          lastTessellation: tessellation
        }
      ]
    }

    // Round-trip: parse → stringify → parse again. Pins that nothing is lossy
    // (in particular bbox tuples and the uuid id) across JSON serialization.
    const parsed = projectSchema.parse(projectWithDesign)
    const roundTripped = projectSchema.parse(JSON.parse(JSON.stringify(parsed)))

    expect(roundTripped.designModels).toHaveLength(1)
    const design = roundTripped.designModels[0]
    expect(design.id).toBe(designId)
    expect(design.scriptText).toBe(scriptText)
    expect(design.lastTessellation?.bbox.min).toEqual([-25, -25, 0])
    expect(design.lastTessellation?.bbox.max).toEqual([25, 25, 25])
    expect(design.lastTessellation?.toleranceMm).toBe(0.05)
    expect(design.lastTessellation?.stlRelativePath).toBe(
      `assets/designs/${designId}/tessellation_0.05mm.stl`
    )
  })

  it('rejects a project whose designModels entry has scriptText: undefined', () => {
    const bad = {
      ...baseProject,
      designModels: [
        {
          id: '550e8400-e29b-41d4-a716-446655440000',
          name: 'Broken design',
          // scriptText omitted — the schema must reject this.
          createdAt: '2026-06-01T09:00:00.000Z',
          updatedAt: '2026-06-01T09:00:00.000Z'
        }
      ]
    }
    expect(() => projectSchema.parse(bad)).toThrow()
  })

  it('rejects a project whose designModels entry is missing the id field', () => {
    const bad = {
      ...baseProject,
      designModels: [
        {
          // id omitted
          name: 'Idless',
          scriptText: 'import cadquery as cq\nresult = cq.Workplane("XY").box(10, 10, 10)\n',
          createdAt: '2026-06-01T09:00:00.000Z',
          updatedAt: '2026-06-01T09:00:00.000Z'
        }
      ]
    }
    expect(() => projectSchema.parse(bad)).toThrow()
  })

  it('inferred ProjectFile type carries designModels as DesignModel[] (compile-time pin)', () => {
    // Compile-time-only assertion: if the inferred type ever drops the field
    // or widens it to `unknown[]`, this assignment fails typecheck. Runtime is
    // a no-op tautology.
    const result = projectSchema.parse(baseProject)
    const _typed: ProjectFile['designModels'] = result.designModels
    expect(_typed).toEqual([])
  })
})

describe('appSettingsSchema', () => {
  it('accepts empty object and applies defaults', () => {
    const result = appSettingsSchema.parse({})
    expect(result.theme).toBe('dark')
    expect(result.recentProjectPaths).toEqual([])
  })

  it('accepts a full settings object', () => {
    const full = {
      curaEnginePath: '/usr/bin/CuraEngine',
      pythonPath: '/usr/bin/python3',
      theme: 'light' as const,
      recentProjectPaths: ['/home/user/project1'],
      lastProjectPath: '/home/user/project1',
      camDefaultPostTemplate: 'grbl-mm.gcode.hbs',
      camDefaultMachineDialect: 'grbl' as const,
      camGcodeSafetyAcknowledged: true,
      lastMachineId: 'cnc-001'
    }
    const result = appSettingsSchema.parse(full)
    expect(result.theme).toBe('light')
    expect(result.curaEnginePath).toBe('/usr/bin/CuraEngine')
    expect(result.camDefaultMachineDialect).toBe('grbl')
  })

  it('accepts valid theme values', () => {
    expect(appSettingsSchema.parse({ theme: 'dark' }).theme).toBe('dark')
    expect(appSettingsSchema.parse({ theme: 'light' }).theme).toBe('light')
  })

  it('accepts the system theme value (post-Settings-rebuild)', () => {
    // Real Settings view added `system` as a first-class theme option that defers
    // to the OS prefers-color-scheme. Existing stored `dark` / `light` settings
    // must continue to parse (covered by the prior test).
    expect(appSettingsSchema.parse({ theme: 'system' }).theme).toBe('system')
  })

  it('rejects invalid theme values', () => {
    expect(() => appSettingsSchema.parse({ theme: 'blue' })).toThrow()
  })

  it('accepts the additive units / defaultMachineId / moonrakerApiKey fields', () => {
    // Real Settings view rebuild — every new field on appSettingsSchema MUST be
    // optional so existing saved settings continue to parse (CLAUDE.md schema
    // additions-are-additive gate). This test pins the new contract.
    const parsed = appSettingsSchema.parse({
      units: 'mm',
      defaultMachineId: 'creality_k2_plus',
      moonrakerApiKey: 'abc123'
    })
    expect(parsed.units).toBe('mm')
    expect(parsed.defaultMachineId).toBe('creality_k2_plus')
    expect(parsed.moonrakerApiKey).toBe('abc123')
  })

  it('accepts inch as a valid units value', () => {
    expect(appSettingsSchema.parse({ units: 'inch' }).units).toBe('inch')
  })

  it('rejects invalid units values', () => {
    expect(() => appSettingsSchema.parse({ units: 'cubits' })).toThrow()
  })

  it('omits new optional fields by default (no surprise defaults)', () => {
    const empty = appSettingsSchema.parse({})
    expect(empty.units).toBeUndefined()
    expect(empty.defaultMachineId).toBeUndefined()
    expect(empty.moonrakerApiKey).toBeUndefined()
  })

  it('accepts hasCompletedOnboarding=true (first-launch wizard flag)', () => {
    const result = appSettingsSchema.parse({ hasCompletedOnboarding: true })
    expect(result.hasCompletedOnboarding).toBe(true)
  })

  it('treats missing hasCompletedOnboarding as undefined (additive optional)', () => {
    const result = appSettingsSchema.parse({})
    expect(result.hasCompletedOnboarding).toBeUndefined()
  })

  it('accepts valid curaSlicePreset values', () => {
    expect(appSettingsSchema.parse({ curaSlicePreset: 'balanced' }).curaSlicePreset).toBe('balanced')
    expect(appSettingsSchema.parse({ curaSlicePreset: 'draft' }).curaSlicePreset).toBe('draft')
    expect(appSettingsSchema.parse({ curaSlicePreset: 'fine' }).curaSlicePreset).toBe('fine')
  })

  it('rejects invalid curaSlicePreset values', () => {
    expect(() => appSettingsSchema.parse({ curaSlicePreset: 'ultra' })).toThrow()
  })

  it('accepts valid camDefaultMachineDialect values', () => {
    for (const d of ['grbl', 'mach3', 'generic_mm'] as const) {
      expect(appSettingsSchema.parse({ camDefaultMachineDialect: d }).camDefaultMachineDialect).toBe(d)
    }
  })

  it('validates curaEngineExtraSettingsJson is a JSON object', () => {
    const good = appSettingsSchema.parse({
      curaEngineExtraSettingsJson: '{"infill_pattern":"grid"}'
    })
    expect(good.curaEngineExtraSettingsJson).toBe('{"infill_pattern":"grid"}')
  })

  it('rejects curaEngineExtraSettingsJson that is not a JSON object', () => {
    expect(() =>
      appSettingsSchema.parse({ curaEngineExtraSettingsJson: '"just a string"' })
    ).toThrow()
    expect(() =>
      appSettingsSchema.parse({ curaEngineExtraSettingsJson: '[1,2,3]' })
    ).toThrow()
    expect(() =>
      appSettingsSchema.parse({ curaEngineExtraSettingsJson: 'not json' })
    ).toThrow()
  })

  it('validates curaSliceProfilesJson is a JSON array', () => {
    const good = appSettingsSchema.parse({
      curaSliceProfilesJson: '[{"id":"pla","label":"PLA"}]'
    })
    expect(good.curaSliceProfilesJson).toBe('[{"id":"pla","label":"PLA"}]')
  })

  it('rejects curaSliceProfilesJson that is not a JSON array', () => {
    expect(() =>
      appSettingsSchema.parse({ curaSliceProfilesJson: '{"not":"an array"}' })
    ).toThrow()
    expect(() =>
      appSettingsSchema.parse({ curaSliceProfilesJson: 'invalid' })
    ).toThrow()
  })

  it('validates carveraCliExtraArgsJson is a JSON array', () => {
    const good = appSettingsSchema.parse({
      carveraCliExtraArgsJson: '["-m","carvera_cli"]'
    })
    expect(good.carveraCliExtraArgsJson).toBe('["-m","carvera_cli"]')
  })

  it('rejects carveraCliExtraArgsJson that is not a JSON array', () => {
    expect(() =>
      appSettingsSchema.parse({ carveraCliExtraArgsJson: '{"not":"array"}' })
    ).toThrow()
    expect(() =>
      appSettingsSchema.parse({ carveraCliExtraArgsJson: 'bad json' })
    ).toThrow()
  })

  // ── CFS multi-material v1 ─────────────────────────────────────────────────
  // The Creality K2 Plus Combo ships with one CFS unit holding four spools
  // (slots 0..3, zero-indexed to match Bambu AMS / OrcaSlicer's extruder
  // index convention and the K2 wiki guide). The field is additive /
  // optional so existing saved settings continue to parse unchanged.

  it('accepts cfsSlotId=0 (first CFS spool, default)', () => {
    const r = appSettingsSchema.parse({ cfsSlotId: 0 })
    expect(r.cfsSlotId).toBe(0)
  })

  it('accepts cfsSlotId=3 (last CFS spool in a 4-spool unit)', () => {
    const r = appSettingsSchema.parse({ cfsSlotId: 3 })
    expect(r.cfsSlotId).toBe(3)
  })

  it('accepts every valid CFS slot id 0..3', () => {
    for (const slot of [0, 1, 2, 3]) {
      expect(appSettingsSchema.parse({ cfsSlotId: slot }).cfsSlotId).toBe(slot)
    }
  })

  it('rejects negative cfsSlotId', () => {
    expect(() => appSettingsSchema.parse({ cfsSlotId: -1 })).toThrow()
  })

  it('rejects cfsSlotId above the 4-spool CFS upper bound', () => {
    expect(() => appSettingsSchema.parse({ cfsSlotId: 4 })).toThrow()
    expect(() => appSettingsSchema.parse({ cfsSlotId: 99 })).toThrow()
  })

  it('rejects non-integer cfsSlotId', () => {
    expect(() => appSettingsSchema.parse({ cfsSlotId: 1.5 })).toThrow()
  })

  it('treats missing cfsSlotId as undefined (additive optional)', () => {
    const r = appSettingsSchema.parse({})
    expect(r.cfsSlotId).toBeUndefined()
  })
})
