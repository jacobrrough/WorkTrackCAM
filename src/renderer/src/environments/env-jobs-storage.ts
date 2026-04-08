/**
 * Per-environment job storage helpers.
 *
 * The legacy single-bucket key `fab-jobs-v1` is split into three env-scoped
 * keys (`fab-jobs-vcarve-v1`, `fab-jobs-creality-v1`, `fab-jobs-makera-v1`).
 * Existing local state is preserved via a one-time migration that buckets
 * legacy jobs into their owning environment by `machineId`.
 *
 * Pure functions over a structural `Storage`-like interface so tests run in
 * Node without a DOM. The Phase 3 React hook will pass `localStorage`.
 */
import type { Job } from '../shop-types'
import { ENVIRONMENT_LIST, type EnvironmentId, type ShopEnvironment } from './registry'

/** Legacy single-bucket job key shipped before the environment split. */
export const LEGACY_JOBS_KEY = 'fab-jobs-v1'

/**
 * Minimal subset of the DOM `Storage` interface used by the helpers.
 * Lets tests inject an in-memory mock and keeps the module DOM-free.
 */
export interface JobsStorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** Result of `loadEnvJobs` — distinguishes scoped data from a fresh migration. */
export interface LoadEnvJobsResult {
  jobs: Job[]
  /** True when the result was sourced from the legacy key (one-time migration). */
  migrated: boolean
}

/**
 * Load the job list for an environment.
 *
 * Order of resolution:
 *   1. If the env-scoped key has data, return it (no migration).
 *   2. Otherwise, look at the legacy key. Bucket legacy jobs whose `machineId`
 *      belongs to this environment, write them to the env-scoped key, and
 *      return them as a migration result.
 *   3. If neither key has data, return an empty list.
 *
 * The legacy key is intentionally NOT deleted here — all three environments
 * each need a chance to claim their share. Call `finalizeLegacyJobsMigration`
 * after the last env shell mounts to clean it up.
 */
export function loadEnvJobs(env: ShopEnvironment, storage: JobsStorageLike): LoadEnvJobsResult {
  const scopedRaw = storage.getItem(env.jobsStorageKey)
  if (scopedRaw) {
    const parsed = parseJobsArray(scopedRaw)
    if (parsed) return { jobs: parsed, migrated: false }
  }
  const migrated = migrateLegacyJobsForEnv(env, storage)
  return { jobs: migrated, migrated: migrated.length > 0 }
}

/** Persist the job list to the env-scoped key. Empty arrays remove the key entirely. */
export function saveEnvJobs(
  env: ShopEnvironment,
  jobs: readonly Job[],
  storage: JobsStorageLike
): void {
  if (jobs.length === 0) {
    storage.removeItem(env.jobsStorageKey)
    return
  }
  storage.setItem(env.jobsStorageKey, JSON.stringify(jobs))
}

/**
 * Bucket legacy jobs into the given environment by `machineId`.
 * Writes the env-scoped key when at least one job matches; otherwise leaves
 * storage untouched. Returns the bucketed jobs (with `environmentId` stamped).
 */
export function migrateLegacyJobsForEnv(env: ShopEnvironment, storage: JobsStorageLike): Job[] {
  const legacyRaw = storage.getItem(LEGACY_JOBS_KEY)
  if (!legacyRaw) return []
  const all = parseJobsArray(legacyRaw)
  if (!all) return []
  const owned: Job[] = []
  for (const job of all) {
    if (job.machineId && env.machineIds.includes(job.machineId)) {
      owned.push({ ...job, environmentId: env.id })
    }
  }
  if (owned.length > 0) {
    storage.setItem(env.jobsStorageKey, JSON.stringify(owned))
  }
  return owned
}

/**
 * Delete the legacy `fab-jobs-v1` bucket once every environment has had a
 * chance to migrate. Call from the env shell after the per-env load succeeds.
 *
 * Safe to call repeatedly — `removeItem` is a no-op when the key is missing.
 */
export function finalizeLegacyJobsMigration(storage: JobsStorageLike): void {
  // Only delete if all three env-scoped keys have already been written at
  // least once, otherwise an env that hasn't been opened yet would lose its
  // share. We check by reading all three.
  for (const env of ENVIRONMENT_LIST) {
    if (storage.getItem(env.jobsStorageKey) === null) return
  }
  storage.removeItem(LEGACY_JOBS_KEY)
}

/**
 * Determine which environment owns a job by inspecting `environmentId` first
 * and falling back to `machineId` lookup. Used by the migration finalizer and
 * by orphan-job recovery in the splash screen.
 */
export function resolveJobEnvironmentId(job: Job): EnvironmentId | null {
  if (job.environmentId) return job.environmentId
  if (!job.machineId) return null
  for (const env of ENVIRONMENT_LIST) {
    if (env.machineIds.includes(job.machineId)) return env.id
  }
  return null
}

// ── Internal ────────────────────────────────────────────────────────────────

function parseJobsArray(raw: string): Job[] | null {
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return parsed as Job[]
  } catch {
    return null
  }
}
