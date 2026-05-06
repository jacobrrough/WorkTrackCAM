/**
 * Bundled CuraEngine path resolver unit tests -- Phase 2 [P2-K2-SLICE]/Cycle 2.
 *
 * Pins the per-platform path mapping + the "binary not vendored" /
 * "definitions not vendored" / "unsupported platform" failure modes for
 * `src/main/cura-bundled-paths.ts`. Filesystem-isolated via the test seam
 * `existsSyncImpl` so the tests do not depend on the actual binary blob
 * being present.
 *
 * These tests stay green BEFORE the host-side vendoring step lands the
 * actual CuraEngine binary blobs into `resources/slicer/bin/`. Once the
 * blobs land, the env-gated `slicer-bundled.test.ts` smoke test exercises
 * the real subprocess path; this file is the always-green contract.
 */
import { describe, expect, it } from 'vitest'
import {
  bundledCuraEngineRelativePath,
  resolveBundledCuraDefinitionsPath,
  resolveBundledCuraEnginePath
} from './cura-bundled-paths'

describe('bundledCuraEngineRelativePath -- pure platform mapping', () => {
  it('Windows x64 -> bin/win32-x64/CuraEngine.exe', () => {
    expect(bundledCuraEngineRelativePath('win32', 'x64')).toBe(
      'bin/win32-x64/CuraEngine.exe'
    )
  })

  it('macOS Apple-silicon (arm64) -> bin/darwin-arm64/CuraEngine', () => {
    expect(bundledCuraEngineRelativePath('darwin', 'arm64')).toBe(
      'bin/darwin-arm64/CuraEngine'
    )
  })

  it('macOS Intel (x64) -> bin/darwin-x64/CuraEngine', () => {
    expect(bundledCuraEngineRelativePath('darwin', 'x64')).toBe(
      'bin/darwin-x64/CuraEngine'
    )
  })

  it('Linux x64 -> bin/linux-x64/CuraEngine', () => {
    expect(bundledCuraEngineRelativePath('linux', 'x64')).toBe(
      'bin/linux-x64/CuraEngine'
    )
  })

  it('Windows ARM64 returns null (not in supported matrix)', () => {
    expect(bundledCuraEngineRelativePath('win32', 'arm64')).toBeNull()
  })

  it('FreeBSD x64 returns null (not in supported matrix)', () => {
    expect(bundledCuraEngineRelativePath('freebsd', 'x64')).toBeNull()
  })

  it('Linux arm64 returns null (CuraEngine releases do not ship aarch64 Linux)', () => {
    expect(bundledCuraEngineRelativePath('linux', 'arm64')).toBeNull()
  })

  it('Windows extension is exactly .exe (case-sensitive)', () => {
    expect(bundledCuraEngineRelativePath('win32', 'x64')).toMatch(/\.exe$/)
  })

  it('non-Windows entries do NOT carry a .exe suffix', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      const arches = platform === 'darwin' ? ['arm64', 'x64'] : ['x64']
      for (const arch of arches) {
        const rel = bundledCuraEngineRelativePath(platform, arch)
        expect(rel).not.toMatch(/\.exe$/)
      }
    }
  })
})

describe('resolveBundledCuraEnginePath -- discriminated-union resolution', () => {
  const root = '/app/resources'

  it('returns ok=true with the joined path when the binary exists', () => {
    const result = resolveBundledCuraEnginePath(root, {
      platform: 'linux',
      arch: 'x64',
      existsSyncImpl: () => true
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.path).toContain('slicer')
      expect(result.path).toContain('linux-x64')
      expect(result.path).toContain('CuraEngine')
    }
  })

  it('returns ok=false reason=binary-not-vendored when the file is missing', () => {
    const result = resolveBundledCuraEnginePath(root, {
      platform: 'win32',
      arch: 'x64',
      existsSyncImpl: () => false
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('binary-not-vendored')
      expect(result.expectedPath).toContain('win32-x64')
      expect(result.expectedPath).toContain('CuraEngine.exe')
    }
  })

  it('returns ok=false reason=unsupported-platform with expectedPath=null for an unsupported tuple', () => {
    const result = resolveBundledCuraEnginePath(root, {
      platform: 'aix',
      arch: 'ppc64',
      existsSyncImpl: () => true
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('unsupported-platform')
      expect(result.expectedPath).toBeNull()
    }
  })

  it('passes the candidate path to existsSyncImpl exactly once (no double-stat)', () => {
    const seen: string[] = []
    resolveBundledCuraEnginePath(root, {
      platform: 'darwin',
      arch: 'arm64',
      existsSyncImpl: (p) => {
        seen.push(p)
        return true
      }
    })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toContain('darwin-arm64')
  })

  it('joins resourcesRoot + slicer + bin/<platform>-<arch> in the result path', () => {
    const result = resolveBundledCuraEnginePath('/foo/bar', {
      platform: 'linux',
      arch: 'x64',
      existsSyncImpl: () => true
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      // Path contains all three segments in order.
      expect(result.path).toMatch(/foo.+bar.+slicer.+bin.+linux-x64.+CuraEngine/)
    }
  })

  it('uses process.platform / process.arch when no overrides are supplied', () => {
    // Live-process resolution: just confirm it returns something coherent
    // for whatever platform the test runs on. We do NOT assert path-on-disk
    // because the bundled binary is not vendored yet -- the result is
    // expected to be ok=false with reason=binary-not-vendored OR
    // unsupported-platform.
    const result = resolveBundledCuraEnginePath(root)
    if (result.ok) {
      // If a future host-side vendoring step lands the binary, the live
      // path will exist -- in which case ok=true is also a valid outcome.
      expect(result.path).toContain('slicer')
    } else {
      expect(['binary-not-vendored', 'unsupported-platform']).toContain(
        result.reason
      )
    }
  })
})

describe('resolveBundledCuraDefinitionsPath -- definitions tree resolution', () => {
  const root = '/app/resources'

  it('returns ok=true when fdmprinter.def.json exists', () => {
    const result = resolveBundledCuraDefinitionsPath(root, {
      existsSyncImpl: () => true
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.path).toContain('slicer')
      expect(result.path).toContain('definitions')
      expect(result.path).not.toContain('fdmprinter.def.json') // path is the FOLDER
    }
  })

  it('returns ok=false reason=definitions-not-vendored with expectedPath when missing', () => {
    const result = resolveBundledCuraDefinitionsPath(root, {
      existsSyncImpl: () => false
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('definitions-not-vendored')
      expect(result.expectedPath).toContain('slicer')
      expect(result.expectedPath).toContain('definitions')
    }
  })

  it('checks fdmprinter.def.json by name (not just any file in the folder)', () => {
    const seen: string[] = []
    resolveBundledCuraDefinitionsPath(root, {
      existsSyncImpl: (p) => {
        seen.push(p)
        return true
      }
    })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatch(/fdmprinter\.def\.json$/)
  })

  it('uses the live existsSync when no override is supplied (smoke: returns SOME shape)', () => {
    const result = resolveBundledCuraDefinitionsPath(root)
    expect(['boolean']).toContain(typeof result.ok)
    if (!result.ok) {
      expect(result.reason).toBe('definitions-not-vendored')
    }
  })
})

describe('resolveBundledCuraEnginePath -- three-machine context', () => {
  const root = '/app/resources'

  it('Creality K2 Plus (FDM, sole consumer of the bundled CuraEngine) is supported on all 4 desktop platforms', () => {
    // The K2 Plus is the only FDM machine in the three-machine cohort, so
    // the bundled CuraEngine matrix MUST cover the three desktop platforms
    // Jacob and any future user could plausibly run WorkTrackCAM on.
    const matrix: ReadonlyArray<{ platform: string; arch: string }> = [
      { platform: 'win32', arch: 'x64' },
      { platform: 'darwin', arch: 'arm64' },
      { platform: 'darwin', arch: 'x64' },
      { platform: 'linux', arch: 'x64' }
    ]
    for (const { platform, arch } of matrix) {
      const result = resolveBundledCuraEnginePath(root, {
        platform,
        arch,
        existsSyncImpl: () => true
      })
      expect(result.ok).toBe(true)
    }
  })

  it('Laguna Swift 5x10 + Makera Carvera (CNC, do not consume the bundled CuraEngine) are unaffected by the resolver', () => {
    // The CNC machines never touch the slicer path -- this is a sanity
    // pin that the resolver does NOT have any per-machine special-case
    // logic. The same (platform, arch) inputs return the same outputs
    // regardless of which machine profile happens to be active in the UI.
    const a = resolveBundledCuraEnginePath(root, {
      platform: 'win32',
      arch: 'x64',
      existsSyncImpl: () => true
    })
    const b = resolveBundledCuraEnginePath(root, {
      platform: 'win32',
      arch: 'x64',
      existsSyncImpl: () => true
    })
    expect(a).toEqual(b)
  })
})
