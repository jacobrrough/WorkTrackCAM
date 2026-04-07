import { describe, expect, it } from 'vitest'
import {
  projectSchema,
  appSettingsSchema,
  importHistoryEntrySchema,
  roundTripLevelSchema,
  type ProjectFile,
  type AppSettings,
  type ImportHistoryEntry
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

  it('rejects invalid theme values', () => {
    expect(() => appSettingsSchema.parse({ theme: 'blue' })).toThrow()
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
})
