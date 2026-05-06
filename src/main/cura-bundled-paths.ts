/**
 * Bundled CuraEngine path resolver -- Phase 2 [P2-K2-SLICE]/Cycle 2.
 *
 * Implements tasks 4 + 5 of the `docs/SLICING.md` Cycle-2 plan: a per-platform
 * resolver that picks the right CuraEngine binary out of `resources/slicer/bin/`
 * and the trimmed definitions tree out of `resources/slicer/definitions/`.
 *
 * Approved 2026-05-05 by Jacob ("approve a"). The host-side vendoring step
 * (downloading the CuraEngine 5.8.x release binaries + the trimmed
 * `fdmprinter.def.json` + `fdmextruder.def.json` into the repo) is a
 * separate cycle's work; until those blobs land, the resolver returns a
 * `{ ok: false, reason: 'binary-not-vendored' }` discriminator that the
 * caller (`sliceWithCuraEngine`) translates into the existing user-supplied
 * `curaEnginePath` fallback so today's behavior is byte-identical until the
 * binary lands.
 *
 * Pure & FS-isolated: the platform mapping helper
 * (`bundledCuraEngineRelativePath`) is filesystem-free so unit tests can
 * exercise every supported (platform, arch) tuple without FS. The
 * full-resolver functions do touch the FS (existence check) so they are
 * tested in their own gate.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Supported (platform, arch) tuples for the bundled CuraEngine. The tuple
 * list is hard-coded to match Ultimaker's CuraEngine 5.8.x release artifact
 * matrix. Add new tuples deliberately; do NOT silently fall through to a
 * "use whatever binary is in `bin/`" path -- that defeats the whole point
 * of the per-platform layout.
 */
export type BundledCuraEnginePlatform =
  | { platform: 'win32'; arch: 'x64' }
  | { platform: 'darwin'; arch: 'arm64' }
  | { platform: 'darwin'; arch: 'x64' }
  | { platform: 'linux'; arch: 'x64' }

/**
 * Result of resolving the bundled CuraEngine path.
 *
 * - `ok: true`  -- the binary exists at `path` and is ready to spawn.
 * - `ok: false` -- the resolver could not locate a bundled binary; the
 *   discriminated `reason` lets the caller decide whether to fall back to
 *   a user-supplied path or to surface a friendly error.
 *
 * `reason` values:
 *   - `'unsupported-platform'`: the (platform, arch) tuple has no entry in
 *     the bundled matrix. The user must supply their own `curaEnginePath`.
 *   - `'binary-not-vendored'`: the (platform, arch) tuple IS supported but
 *     the binary file does not exist at the expected path. This is the
 *     default state until the host-side vendoring step lands the blobs;
 *     today's behavior is preserved by falling back to the user-supplied
 *     path.
 */
export type BundledCuraEngineResolution =
  | { readonly ok: true; readonly path: string }
  | {
      readonly ok: false
      readonly reason: 'unsupported-platform' | 'binary-not-vendored'
      readonly expectedPath: string | null
    }

/**
 * Result of resolving the bundled CuraEngine definitions tree.
 *
 * `definitions/` holds (at minimum) `fdmprinter.def.json` +
 * `fdmextruder.def.json` -- the inheritance roots for the K2 stub.
 */
export type BundledCuraDefinitionsResolution =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly reason: 'definitions-not-vendored'; readonly expectedPath: string }

/**
 * Pure helper: relative path under `resources/slicer/bin/` for a given
 * (platform, arch). Returns `null` when the tuple is unsupported.
 *
 * No filesystem access. Safe for unit tests on any platform; the
 * `existsSync` wrap lives in `resolveBundledCuraEnginePath`.
 *
 * Example outputs (forward-slash form -- caller joins with `path.join`):
 *
 *   ('win32',  'x64')   -> 'bin/win32-x64/CuraEngine.exe'
 *   ('darwin', 'arm64') -> 'bin/darwin-arm64/CuraEngine'
 *   ('darwin', 'x64')   -> 'bin/darwin-x64/CuraEngine'
 *   ('linux',  'x64')   -> 'bin/linux-x64/CuraEngine'
 */
export function bundledCuraEngineRelativePath(platform: string, arch: string): string | null {
  if (platform === 'win32' && arch === 'x64') {
    return 'bin/win32-x64/CuraEngine.exe'
  }
  if (platform === 'darwin' && arch === 'arm64') {
    return 'bin/darwin-arm64/CuraEngine'
  }
  if (platform === 'darwin' && arch === 'x64') {
    return 'bin/darwin-x64/CuraEngine'
  }
  if (platform === 'linux' && arch === 'x64') {
    return 'bin/linux-x64/CuraEngine'
  }
  return null
}

/**
 * Optional inputs (mainly for tests) so the resolver can be exercised
 * without depending on `process.platform` / `process.arch` of the host
 * running the test suite.
 */
export type BundledCuraEngineResolverOpts = {
  /** Override `process.platform`. Defaults to the live process value. */
  platform?: string
  /** Override `process.arch`. Defaults to the live process value. */
  arch?: string
  /** Override `existsSync`. Defaults to the real Node `fs.existsSync`. */
  existsSyncImpl?: (p: string) => boolean
}

/**
 * Resolve the bundled CuraEngine binary path.
 *
 * Combines `bundledCuraEngineRelativePath` with an existence check. When
 * the file is not present, returns `{ ok: false, reason: 'binary-not-vendored' }`
 * so the caller can fall back to a user-supplied path without surfacing a
 * confusing "missing file" error.
 *
 * @param resourcesRoot Absolute path to the bundled `resources/` folder.
 * @param opts Optional test seams (platform / arch / existsSync override).
 */
export function resolveBundledCuraEnginePath(
  resourcesRoot: string,
  opts?: BundledCuraEngineResolverOpts
): BundledCuraEngineResolution {
  const platform = opts?.platform ?? process.platform
  const arch = opts?.arch ?? process.arch
  const exists = opts?.existsSyncImpl ?? existsSync

  const rel = bundledCuraEngineRelativePath(platform, arch)
  if (rel === null) {
    return { ok: false, reason: 'unsupported-platform', expectedPath: null }
  }

  // Use forward-slash split to keep the relative path platform-neutral.
  const expectedPath = join(resourcesRoot, 'slicer', ...rel.split('/'))
  if (!exists(expectedPath)) {
    return { ok: false, reason: 'binary-not-vendored', expectedPath }
  }

  return { ok: true, path: expectedPath }
}

/**
 * Resolve the bundled CuraEngine definitions folder. The folder is the
 * directory that directly contains `fdmprinter.def.json` (Ultimaker's
 * inheritance root).
 *
 * @param resourcesRoot Absolute path to the bundled `resources/` folder.
 * @param opts Optional `existsSync` test seam.
 */
export function resolveBundledCuraDefinitionsPath(
  resourcesRoot: string,
  opts?: { existsSyncImpl?: (p: string) => boolean }
): BundledCuraDefinitionsResolution {
  const exists = opts?.existsSyncImpl ?? existsSync

  const definitionsDir = join(resourcesRoot, 'slicer', 'definitions')
  const fdmprinter = join(definitionsDir, 'fdmprinter.def.json')

  if (!exists(fdmprinter)) {
    return {
      ok: false,
      reason: 'definitions-not-vendored',
      expectedPath: definitionsDir
    }
  }

  return { ok: true, path: definitionsDir }
}
