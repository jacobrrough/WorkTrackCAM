import { describe, expect, it } from 'vitest'
import {
  buildMigrationPipeline,
  migrateManufactureV1toV2,
  migrateProjectV1toV2,
  migrateToolLibraryV1toV2,
  type SchemaMigrationStep
} from './schema-migration'

describe('buildMigrationPipeline', () => {
  it('returns identity for data already at latest version (no steps)', () => {
    const pipeline = buildMigrationPipeline<{ version: 1 }>([], 1)
    expect(pipeline.latestVersion).toBe(1)
    expect(pipeline.knownVersions).toEqual([1])

    const result = pipeline.migrateToLatest({ version: 1 })
    expect(result.data).toEqual({ version: 1 })
    expect(result.originalVersion).toBe(1)
    expect(result.finalVersion).toBe(1)
    expect(result.stepsApplied).toBe(0)
  })

  it('applies a single migration step v1 -> v2', () => {
    const step: SchemaMigrationStep = {
      fromVersion: 1,
      toVersion: 2,
      migrate: (data: unknown) => ({ ...(data as Record<string, unknown>), version: 2, newField: 'default' })
    }

    const pipeline = buildMigrationPipeline<{ version: 2; newField: string }>([step])
    expect(pipeline.latestVersion).toBe(2)
    expect(pipeline.knownVersions).toEqual([1, 2])

    const result = pipeline.migrateToLatest({ version: 1, name: 'test' })
    expect(result.data).toEqual({ version: 2, name: 'test', newField: 'default' })
    expect(result.originalVersion).toBe(1)
    expect(result.finalVersion).toBe(2)
    expect(result.stepsApplied).toBe(1)
  })

  it('applies multiple chained migration steps v1 -> v2 -> v3', () => {
    const step1: SchemaMigrationStep = {
      fromVersion: 1,
      toVersion: 2,
      migrate: (data: unknown) => ({ ...(data as Record<string, unknown>), version: 2, addedInV2: true })
    }
    const step2: SchemaMigrationStep = {
      fromVersion: 2,
      toVersion: 3,
      migrate: (data: unknown) => ({ ...(data as Record<string, unknown>), version: 3, addedInV3: 'hello' })
    }

    const pipeline = buildMigrationPipeline<{ version: 3; addedInV2: boolean; addedInV3: string }>(
      [step1, step2]
    )
    expect(pipeline.latestVersion).toBe(3)

    // From v1
    const r1 = pipeline.migrateToLatest({ version: 1 })
    expect(r1.data).toEqual({ version: 3, addedInV2: true, addedInV3: 'hello' })
    expect(r1.stepsApplied).toBe(2)

    // From v2 (skip first step)
    const r2 = pipeline.migrateToLatest({ version: 2, addedInV2: true })
    expect(r2.data).toEqual({ version: 3, addedInV2: true, addedInV3: 'hello' })
    expect(r2.stepsApplied).toBe(1)

    // From v3 (already latest, no migration)
    const r3 = pipeline.migrateToLatest({ version: 3, addedInV2: true, addedInV3: 'hello' })
    expect(r3.stepsApplied).toBe(0)
  })

  it('canMigrate returns correct results', () => {
    const step: SchemaMigrationStep = {
      fromVersion: 1,
      toVersion: 2,
      migrate: (d: unknown) => d
    }

    const pipeline = buildMigrationPipeline([step])
    expect(pipeline.canMigrate(0)).toBe(false)
    expect(pipeline.canMigrate(1)).toBe(true)
    expect(pipeline.canMigrate(2)).toBe(true)
    expect(pipeline.canMigrate(3)).toBe(false)
  })

  it('throws on version newer than latest', () => {
    const pipeline = buildMigrationPipeline([], 1)
    expect(() => pipeline.migrateToLatest({ version: 2 })).toThrow(
      /newer than the latest known version/
    )
  })

  it('throws on version older than base', () => {
    const pipeline = buildMigrationPipeline([], 1)
    expect(() => pipeline.migrateToLatest({ version: 0 })).toThrow(
      /older than the minimum supported version/
    )
  })

  it('throws on non-contiguous steps', () => {
    const step1: SchemaMigrationStep = { fromVersion: 1, toVersion: 2, migrate: (d: unknown) => d }
    // Skips v2 -> v3
    const step3: SchemaMigrationStep = { fromVersion: 3, toVersion: 4, migrate: (d: unknown) => d }

    expect(() => buildMigrationPipeline([step1, step3])).toThrow(/must be contiguous/)
  })

  it('throws when step does not increase version', () => {
    const bad: SchemaMigrationStep = { fromVersion: 1, toVersion: 1, migrate: (d: unknown) => d }
    expect(() => buildMigrationPipeline([bad])).toThrow(/must increase the version/)
  })
})

describe('migrateManufactureV1toV2', () => {
  it('bumps version to 2 and adds migratedAt', () => {
    const v1 = { version: 1 as const, setups: [{ id: 's1' }], operations: [{ id: 'op1' }] }
    const v2 = migrateManufactureV1toV2(v1)
    expect(v2.version).toBe(2)
    expect(v2.setups).toEqual([{ id: 's1' }])
    expect(v2.operations).toEqual([{ id: 'op1' }])
    expect(v2.migratedAt).toBeDefined()
    expect(() => new Date(v2.migratedAt).toISOString()).not.toThrow()
  })

  it('preserves all v1 data', () => {
    const v1 = { version: 1 as const, setups: [], operations: [] }
    const v2 = migrateManufactureV1toV2(v1)
    expect(v2.setups).toEqual([])
    expect(v2.operations).toEqual([])
  })
})

describe('migrateProjectV1toV2', () => {
  it('bumps version to 2 and adds tags + migratedAt', () => {
    const v1 = {
      version: 1 as const,
      name: 'TestProject',
      updatedAt: '2026-01-01T00:00:00Z',
      activeMachineId: 'mill-1',
      meshes: ['foo.stl']
    }
    const v2 = migrateProjectV1toV2(v1)
    expect(v2.version).toBe(2)
    expect(v2.name).toBe('TestProject')
    expect(v2.meshes).toEqual(['foo.stl'])
    expect(v2.tags).toEqual([])
    expect(v2.migratedAt).toBeDefined()
  })
})

describe('migrateToolLibraryV1toV2', () => {
  it('bumps version to 2 and adds migratedAt', () => {
    const v1 = { version: 1 as const, tools: [{ id: 't1', name: '6mm' }] }
    const v2 = migrateToolLibraryV1toV2(v1)
    expect(v2.version).toBe(2)
    expect(v2.tools).toEqual([{ id: 't1', name: '6mm' }])
    expect(v2.migratedAt).toBeDefined()
  })
})

describe('migration pipeline with concrete manufacture migration', () => {
  it('integrates manufacture v1->v2 via pipeline', () => {
    const step: SchemaMigrationStep = {
      fromVersion: 1,
      toVersion: 2,
      migrate: (data: unknown) => migrateManufactureV1toV2(
        data as { version: 1; setups: unknown[]; operations: unknown[] }
      )
    }

    const pipeline = buildMigrationPipeline<ReturnType<typeof migrateManufactureV1toV2>>([step])
    const result = pipeline.migrateToLatest({
      version: 1,
      setups: [{ id: 's1', label: 'Setup 1', machineId: 'm1' }],
      operations: [{ id: 'op1', kind: 'cnc_parallel', label: 'Rough' }]
    })

    expect(result.data.version).toBe(2)
    expect(result.data.migratedAt).toBeDefined()
    expect(result.stepsApplied).toBe(1)
    expect(result.originalVersion).toBe(1)
  })
})
