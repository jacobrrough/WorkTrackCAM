import { beforeEach, describe, expect, it } from 'vitest'
import type { Job } from '../shop-types'
import {
  finalizeLegacyJobsMigration,
  LEGACY_JOBS_KEY,
  loadEnvJobs,
  migrateLegacyJobsForEnv,
  resolveJobEnvironmentId,
  saveEnvJobs,
  type JobsStorageLike
} from './env-jobs-storage'
import { ENVIRONMENT_LIST, ENVIRONMENTS } from './registry'

/** In-memory storage shim used by all tests in this file. */
class MemStorage implements JobsStorageLike {
  private store = new Map<string, string>()

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }
  removeItem(key: string): void {
    this.store.delete(key)
  }
  has(key: string): boolean {
    return this.store.has(key)
  }
  size(): number {
    return this.store.size
  }
}

const fakeJob = (id: string, machineId: string | null): Job => ({
  id,
  name: id,
  stlPath: null,
  machineId,
  materialId: null,
  stock: { x: 100, y: 100, z: 100 },
  transform: {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 }
  },
  stockProfile: 'cylinder',
  operations: [],
  posts: null,
  chuckDepthMm: 5,
  clampOffsetMm: 0,
  gcodeOut: null,
  status: 'idle',
  lastLog: '',
  printerUrl: ''
})

let storage: MemStorage

beforeEach(() => {
  storage = new MemStorage()
})

describe('env-jobs-storage / loadEnvJobs', () => {
  it('returns empty list when both env-scoped and legacy keys are missing', () => {
    const result = loadEnvJobs(ENVIRONMENTS.vcarve_pro, storage)
    expect(result.jobs).toEqual([])
    expect(result.migrated).toBe(false)
  })

  it('returns env-scoped data without migrating when scoped key already exists', () => {
    const job = fakeJob('a', 'laguna-swift-5x10')
    storage.setItem(ENVIRONMENTS.vcarve_pro.jobsStorageKey, JSON.stringify([job]))
    const result = loadEnvJobs(ENVIRONMENTS.vcarve_pro, storage)
    expect(result.jobs).toHaveLength(1)
    expect(result.jobs[0].id).toBe('a')
    expect(result.migrated).toBe(false)
  })

  it('migrates legacy jobs into env scope when scoped key is empty', () => {
    const legacyJobs = [
      fakeJob('a', 'laguna-swift-5x10'),
      fakeJob('b', 'creality-k2-plus'),
      fakeJob('c', 'makera-carvera-3axis'),
      fakeJob('d', null)
    ]
    storage.setItem(LEGACY_JOBS_KEY, JSON.stringify(legacyJobs))

    const vcarve = loadEnvJobs(ENVIRONMENTS.vcarve_pro, storage)
    expect(vcarve.jobs.map((j) => j.id)).toEqual(['a'])
    expect(vcarve.migrated).toBe(true)
    expect(vcarve.jobs[0].environmentId).toBe('vcarve_pro')

    const creality = loadEnvJobs(ENVIRONMENTS.creality_print, storage)
    expect(creality.jobs.map((j) => j.id)).toEqual(['b'])
    expect(creality.jobs[0].environmentId).toBe('creality_print')

    const makera = loadEnvJobs(ENVIRONMENTS.makera_cam, storage)
    expect(makera.jobs.map((j) => j.id)).toEqual(['c'])
    expect(makera.jobs[0].environmentId).toBe('makera_cam')
  })

  it('migration is idempotent — second load reads the env-scoped key without re-migrating', () => {
    storage.setItem(
      LEGACY_JOBS_KEY,
      JSON.stringify([fakeJob('x', 'laguna-swift-5x10')])
    )
    const first = loadEnvJobs(ENVIRONMENTS.vcarve_pro, storage)
    expect(first.migrated).toBe(true)

    const second = loadEnvJobs(ENVIRONMENTS.vcarve_pro, storage)
    expect(second.migrated).toBe(false)
    expect(second.jobs.map((j) => j.id)).toEqual(['x'])
  })

  it('drops legacy jobs whose machineId does not belong to any environment', () => {
    storage.setItem(
      LEGACY_JOBS_KEY,
      JSON.stringify([fakeJob('orphan', 'unknown-machine')])
    )
    const result = loadEnvJobs(ENVIRONMENTS.vcarve_pro, storage)
    expect(result.jobs).toEqual([])
  })

  it('handles malformed legacy JSON gracefully (returns empty)', () => {
    storage.setItem(LEGACY_JOBS_KEY, '{not json')
    const result = loadEnvJobs(ENVIRONMENTS.vcarve_pro, storage)
    expect(result.jobs).toEqual([])
    expect(result.migrated).toBe(false)
  })

  it('handles malformed scoped JSON by falling back to migration', () => {
    storage.setItem(ENVIRONMENTS.vcarve_pro.jobsStorageKey, '{not json')
    storage.setItem(
      LEGACY_JOBS_KEY,
      JSON.stringify([fakeJob('a', 'laguna-swift-5x10')])
    )
    const result = loadEnvJobs(ENVIRONMENTS.vcarve_pro, storage)
    expect(result.jobs.map((j) => j.id)).toEqual(['a'])
  })
})

describe('env-jobs-storage / saveEnvJobs', () => {
  it('persists jobs to the env-scoped key', () => {
    const job = fakeJob('a', 'laguna-swift-5x10')
    saveEnvJobs(ENVIRONMENTS.vcarve_pro, [job], storage)
    const raw = storage.getItem(ENVIRONMENTS.vcarve_pro.jobsStorageKey)
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw!) as Job[]
    expect(parsed[0].id).toBe('a')
  })

  it('removes the env-scoped key when saving an empty list', () => {
    const job = fakeJob('a', 'laguna-swift-5x10')
    saveEnvJobs(ENVIRONMENTS.vcarve_pro, [job], storage)
    expect(storage.has(ENVIRONMENTS.vcarve_pro.jobsStorageKey)).toBe(true)

    saveEnvJobs(ENVIRONMENTS.vcarve_pro, [], storage)
    expect(storage.has(ENVIRONMENTS.vcarve_pro.jobsStorageKey)).toBe(false)
  })

  it('keeps each env scoped — saving to vcarve does not affect creality or makera', () => {
    saveEnvJobs(
      ENVIRONMENTS.vcarve_pro,
      [fakeJob('a', 'laguna-swift-5x10')],
      storage
    )
    expect(storage.has(ENVIRONMENTS.creality_print.jobsStorageKey)).toBe(false)
    expect(storage.has(ENVIRONMENTS.makera_cam.jobsStorageKey)).toBe(false)
  })
})

describe('env-jobs-storage / migrateLegacyJobsForEnv', () => {
  it('does not write the env-scoped key when no jobs match', () => {
    storage.setItem(
      LEGACY_JOBS_KEY,
      JSON.stringify([fakeJob('a', 'creality-k2-plus')])
    )
    const result = migrateLegacyJobsForEnv(ENVIRONMENTS.vcarve_pro, storage)
    expect(result).toEqual([])
    expect(storage.has(ENVIRONMENTS.vcarve_pro.jobsStorageKey)).toBe(false)
  })

  it('stamps environmentId on each migrated job', () => {
    storage.setItem(
      LEGACY_JOBS_KEY,
      JSON.stringify([fakeJob('a', 'makera-carvera-4axis')])
    )
    const result = migrateLegacyJobsForEnv(ENVIRONMENTS.makera_cam, storage)
    expect(result).toHaveLength(1)
    expect(result[0].environmentId).toBe('makera_cam')
  })
})

describe('env-jobs-storage / finalizeLegacyJobsMigration', () => {
  it('removes the legacy key only after every env has its scoped key written', () => {
    storage.setItem(LEGACY_JOBS_KEY, '[]')
    storage.setItem(ENVIRONMENTS.vcarve_pro.jobsStorageKey, '[]')

    finalizeLegacyJobsMigration(storage)
    expect(storage.has(LEGACY_JOBS_KEY)).toBe(true) // creality and makera not yet migrated

    storage.setItem(ENVIRONMENTS.creality_print.jobsStorageKey, '[]')
    storage.setItem(ENVIRONMENTS.makera_cam.jobsStorageKey, '[]')

    finalizeLegacyJobsMigration(storage)
    expect(storage.has(LEGACY_JOBS_KEY)).toBe(false)
  })

  it('is safe to call when legacy key is already gone', () => {
    for (const env of ENVIRONMENT_LIST) {
      storage.setItem(env.jobsStorageKey, '[]')
    }
    expect(() => finalizeLegacyJobsMigration(storage)).not.toThrow()
    expect(storage.has(LEGACY_JOBS_KEY)).toBe(false)
  })
})

describe('env-jobs-storage / resolveJobEnvironmentId', () => {
  it('prefers explicit environmentId when present', () => {
    const job = fakeJob('a', 'laguna-swift-5x10')
    job.environmentId = 'makera_cam' // intentional mismatch
    expect(resolveJobEnvironmentId(job)).toBe('makera_cam')
  })

  it('falls back to machineId lookup when environmentId is missing', () => {
    expect(resolveJobEnvironmentId(fakeJob('a', 'laguna-swift-5x10'))).toBe('vcarve_pro')
    expect(resolveJobEnvironmentId(fakeJob('a', 'creality-k2-plus'))).toBe('creality_print')
    expect(resolveJobEnvironmentId(fakeJob('a', 'makera-carvera-3axis'))).toBe('makera_cam')
    expect(resolveJobEnvironmentId(fakeJob('a', 'makera-carvera-4axis'))).toBe('makera_cam')
  })

  it('returns null for jobs with no machineId and no environmentId', () => {
    expect(resolveJobEnvironmentId(fakeJob('a', null))).toBeNull()
  })

  it('returns null for jobs with an unknown machineId', () => {
    expect(resolveJobEnvironmentId(fakeJob('a', 'unknown-machine'))).toBeNull()
  })
})
