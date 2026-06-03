import { app } from 'electron'
import { access, cp, mkdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'

/**
 * One-time userData migration for the WorkTrackCAM → WorkTrack3D rename.
 *
 * Electron derives the per-user data directory from the product name, so
 * renaming `productName` relocates it (e.g. `%APPDATA%/WorkTrackCAM` →
 * `%APPDATA%/WorkTrack3D`, and the macOS / Linux equivalents). Without a
 * migration, an operator who already ran the app would silently lose their
 * `settings.json` (Moonraker URL, machine defaults, onboarding flag) plus any
 * imported machine profiles, materials, tool libraries, and user post
 * templates on first launch of the renamed build.
 *
 * This copies that operator-authored content across once. It is deliberately
 * an allowlist — Electron internals (GPUCache, Cookies, Local Storage, …) and
 * transient `logs/` are NOT carried over, only real configuration.
 */

/** Legacy Electron product name, used to locate the pre-rename userData dir. */
const LEGACY_APP_NAME = 'WorkTrackCAM'

/**
 * Operator-authored userData entries worth carrying across the rename. Mirrors
 * every `join(app.getPath('userData'), …)` writer in `src/main`:
 *   settings.json  — settings-store.ts
 *   machines/      — machines.ts
 *   materials/     — filament-manager.ts, materials-manager.ts
 *   tool-libraries/— machine-tool-library.ts
 *   posts/         — posts-manager.ts
 * (`logs/` from main-process-diagnostics.ts is intentionally excluded.)
 */
const MIGRATE_ENTRIES = ['settings.json', 'machines', 'materials', 'tool-libraries', 'posts'] as const

export interface UserDataMigrationResult {
  /** True when at least one entry was copied across. */
  migrated: boolean
  /** Names of the entries that were copied. */
  copied: string[]
  /** The legacy directory data was copied from (only set when migrated). */
  from?: string
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Migrate the allowlisted entries from `legacyDir` into `currentDir`.
 *
 * Pure with respect to Electron (takes explicit paths) so it can be exercised
 * against real temp directories in tests. Idempotent: a no-op once `currentDir`
 * already has its own `settings.json`, and never clobbers files the new
 * directory already holds (`force: false`).
 */
export async function migrateUserDataDirs(
  currentDir: string,
  legacyDir: string
): Promise<UserDataMigrationResult> {
  // Rename was a no-op, the new dir is already set up, or there's nothing legacy.
  if (legacyDir === currentDir) return { migrated: false, copied: [] }
  if (await pathExists(join(currentDir, 'settings.json'))) return { migrated: false, copied: [] }
  if (!(await pathExists(legacyDir))) return { migrated: false, copied: [] }

  await mkdir(currentDir, { recursive: true })

  const copied: string[] = []
  for (const entry of MIGRATE_ENTRIES) {
    const src = join(legacyDir, entry)
    if (!(await pathExists(src))) continue
    await cp(src, join(currentDir, entry), {
      recursive: true,
      force: false,
      errorOnExist: false
    })
    copied.push(entry)
  }

  return { migrated: copied.length > 0, copied, from: legacyDir }
}

/**
 * Resolve the real Electron paths and run {@link migrateUserDataDirs}.
 * Call once at startup, before any `loadSettings()` / profile reads.
 */
export async function migrateLegacyUserData(): Promise<UserDataMigrationResult> {
  const currentDir = app.getPath('userData')
  const legacyDir = join(app.getPath('appData'), LEGACY_APP_NAME)
  return migrateUserDataDirs(currentDir, legacyDir)
}
