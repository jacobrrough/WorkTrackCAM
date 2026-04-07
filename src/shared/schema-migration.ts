/**
 * Schema migration utilities for versioned project data files.
 *
 * Provides a type-safe pipeline for transforming saved project data when
 * schema versions are bumped. Each migration is a pure function that
 * transforms data from version N to version N+1.
 *
 * Usage pattern for a new v2 migration:
 * ```ts
 * import { buildMigrationPipeline, type SchemaMigrationStep } from './schema-migration'
 *
 * const migrateManufactureV1toV2: SchemaMigrationStep<ManufactureFileV1, ManufactureFileV2> = {
 *   fromVersion: 1,
 *   toVersion: 2,
 *   migrate: (v1) => ({
 *     ...v1,
 *     version: 2,
 *     newField: 'default',
 *   }),
 * }
 *
 * const pipeline = buildMigrationPipeline([migrateManufactureV1toV2])
 * const latest = pipeline.migrateToLatest({ version: 1, ... })
 * ```
 */

/**
 * A single version migration step: transforms data from `fromVersion` to `toVersion`.
 * The migrate function must be a pure function (no side effects, no I/O).
 */
export interface SchemaMigrationStep<TFrom = unknown, TTo = unknown> {
  readonly fromVersion: number
  readonly toVersion: number
  /** Pure transform from one version to the next. */
  migrate(data: TFrom): TTo
}

/**
 * Result of a migration pipeline execution.
 */
export interface MigrationResult<T> {
  /** The migrated data at the latest version. */
  data: T
  /** The version the input data started at. */
  originalVersion: number
  /** The version after migration (should equal latestVersion). */
  finalVersion: number
  /** Number of migration steps applied. */
  stepsApplied: number
}

/**
 * A migration pipeline that can transform data from any known version to the latest.
 */
export interface MigrationPipeline<TLatest> {
  /** The highest version this pipeline migrates to. */
  readonly latestVersion: number
  /** All registered step versions (ascending). */
  readonly knownVersions: readonly number[]
  /**
   * Migrate data from its current version to the latest.
   * Throws if the input version is unknown or higher than latest.
   */
  migrateToLatest(data: { version: number; [key: string]: unknown }): MigrationResult<TLatest>
  /**
   * Check if a version number has a known migration path to latest.
   */
  canMigrate(version: number): boolean
}

/**
 * Build a migration pipeline from an ordered array of steps.
 * Steps must be contiguous (1->2, 2->3, ...) and ascending.
 *
 * @param steps - Ordered migration steps. Empty array means only version
 *   `baseVersion` is supported (identity migration).
 * @param baseVersion - The base version when no steps exist (default: 1).
 */
export function buildMigrationPipeline<TLatest>(
  steps: readonly SchemaMigrationStep[],
  baseVersion: number = 1
): MigrationPipeline<TLatest> {
  // Validate step ordering
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!
    const expectedFrom = i === 0 ? baseVersion : steps[i - 1]!.toVersion
    if (step.fromVersion !== expectedFrom) {
      throw new Error(
        `Migration step ${i} has fromVersion=${step.fromVersion} but expected ${expectedFrom}. ` +
          'Steps must be contiguous and ascending.'
      )
    }
    if (step.toVersion <= step.fromVersion) {
      throw new Error(
        `Migration step ${i} has toVersion=${step.toVersion} <= fromVersion=${step.fromVersion}. ` +
          'Each step must increase the version.'
      )
    }
  }

  const latestVersion = steps.length > 0 ? steps[steps.length - 1]!.toVersion : baseVersion

  // Build a map of fromVersion -> step for O(1) lookup
  const stepMap = new Map<number, SchemaMigrationStep>()
  for (const step of steps) {
    stepMap.set(step.fromVersion, step)
  }

  // Known versions: baseVersion through latestVersion
  const knownVersions: number[] = []
  for (let v = baseVersion; v <= latestVersion; v++) {
    knownVersions.push(v)
  }

  return {
    latestVersion,
    knownVersions,

    canMigrate(version: number): boolean {
      return version >= baseVersion && version <= latestVersion
    },

    migrateToLatest(
      data: { version: number; [key: string]: unknown }
    ): MigrationResult<TLatest> {
      const originalVersion = data.version

      if (originalVersion > latestVersion) {
        throw new Error(
          `Data version ${originalVersion} is newer than the latest known version ${latestVersion}. ` +
            'Update the application to read this file.'
        )
      }

      if (originalVersion < baseVersion) {
        throw new Error(
          `Data version ${originalVersion} is older than the minimum supported version ${baseVersion}. ` +
            'This file cannot be migrated.'
        )
      }

      // Already at latest — no migration needed
      if (originalVersion === latestVersion) {
        return {
          data: data as unknown as TLatest,
          originalVersion,
          finalVersion: latestVersion,
          stepsApplied: 0
        }
      }

      // Apply steps sequentially
      let current: unknown = data
      let stepsApplied = 0
      let currentVersion = originalVersion

      while (currentVersion < latestVersion) {
        const step = stepMap.get(currentVersion)
        if (!step) {
          throw new Error(
            `No migration step found for version ${currentVersion}. ` +
              `Known steps: ${[...stepMap.keys()].sort((a, b) => a - b).join(', ')}`
          )
        }
        current = step.migrate(current)
        currentVersion = step.toVersion
        stepsApplied++
      }

      return {
        data: current as TLatest,
        originalVersion,
        finalVersion: currentVersion,
        stepsApplied
      }
    }
  }
}

// ─── Concrete migration helpers for WorkTrackCAM schemas ──────────────────

/**
 * Manufacture file v1 -> v2 migration template.
 * Activating this requires:
 * 1. Define ManufactureFileV2 schema
 * 2. Widen manufactureFileSchema to accept version: 1 | 2
 * 3. Wire into parseManufactureFile()
 *
 * This exported function demonstrates the pattern and is used in tests.
 */
export function migrateManufactureV1toV2(
  v1: { version: 1; setups: unknown[]; operations: unknown[] }
): { version: 2; setups: unknown[]; operations: unknown[]; migratedAt: string } {
  return {
    ...v1,
    version: 2,
    // v2 adds a migratedAt timestamp for audit trail
    migratedAt: new Date().toISOString()
  }
}

/**
 * Project file v1 -> v2 migration template.
 * Same pattern: pure transform, add defaults for new fields.
 */
export function migrateProjectV1toV2(
  v1: {
    version: 1
    name: string
    updatedAt: string
    activeMachineId: string
    meshes: string[]
    [key: string]: unknown
  }
): {
  version: 2
  name: string
  updatedAt: string
  activeMachineId: string
  meshes: string[]
  migratedAt: string
  tags: string[]
  [key: string]: unknown
} {
  return {
    ...v1,
    version: 2,
    // v2 adds project tags and migration timestamp
    migratedAt: new Date().toISOString(),
    tags: []
  }
}

/**
 * Tool library v1 -> v2 migration template.
 */
export function migrateToolLibraryV1toV2(
  v1: { version: 1; tools: unknown[] }
): { version: 2; tools: unknown[]; migratedAt: string } {
  return {
    ...v1,
    version: 2,
    migratedAt: new Date().toISOString()
  }
}
