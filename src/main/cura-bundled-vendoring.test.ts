/**
 * Vendored CuraEngine binary verification — Phase 2 [P2-K2-SLICE]/Cycle 3.
 *
 * Asserts that the win32-x64 CuraEngine binary set + the FDM definitions
 * tree have actually landed on disk in the canonical paths the resolver
 * (`src/main/cura-bundled-paths.ts`) expects.
 *
 * Runs UNGATED on every CI / local invocation (unlike `slicer-bundled.test.ts`
 * which actually spawns CuraEngine and is therefore env-gated + Windows-only).
 * The verification is purely on-disk: file existence + non-zero size + a
 * valid Windows PE header magic for the .exe. We do NOT execute CuraEngine
 * here — this test runs on Linux too and the .exe wouldn't run anyway.
 *
 * Why this exists: the act of vendoring a binary blob is the load-bearing
 * step for the Phase 2 [P2-K2-SLICE]/Cycle 3 outcome ("Jacob loads STL,
 * clicks Slice, gets G-code"). If the blob ever gets accidentally deleted
 * by a `git clean -fdx` / `npm run clean` / over-eager `rm -rf` this gate
 * goes red immediately rather than silently breaking the K2 Plus user
 * journey at runtime.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  bundledCuraEngineRelativePath,
  resolveBundledCuraDefinitionsPath,
  resolveBundledCuraEnginePath
} from './cura-bundled-paths'

/**
 * Path to the bundled `resources/` folder inside the source tree. This is
 * the same root the production resolver picks up via `getResourcesRoot()`
 * in dev mode.
 */
const RESOURCES_ROOT = resolve(__dirname, '..', '..', 'resources')

/**
 * Minimum sane size for the CuraEngine.exe binary. Cura 5.12.1's
 * CuraEngine.exe is ~21 MB. Anything dramatically smaller is a bad
 * vendoring state (e.g., placeholder file, partial download).
 */
const MIN_CURAENGINE_BYTES = 1_000_000 // 1 MB floor

describe('Vendored CuraEngine binary set (win32-x64) — Phase 2 [P2-K2-SLICE]/Cycle 3', () => {
  it('CuraEngine.exe is present at the resolver-expected path', () => {
    const rel = bundledCuraEngineRelativePath('win32', 'x64')
    expect(rel).toBe('bin/win32-x64/CuraEngine.exe')
    const full = join(RESOURCES_ROOT, 'slicer', ...rel!.split('/'))
    expect(existsSync(full)).toBe(true)
  })

  it('CuraEngine.exe is non-trivially sized (>= 1 MB) — guards against placeholder files', () => {
    const full = join(
      RESOURCES_ROOT,
      'slicer',
      'bin',
      'win32-x64',
      'CuraEngine.exe'
    )
    const sz = statSync(full).size
    expect(sz).toBeGreaterThan(MIN_CURAENGINE_BYTES)
  })

  it('CuraEngine.exe has a valid Windows PE header magic (MZ ... PE)', () => {
    const full = join(
      RESOURCES_ROOT,
      'slicer',
      'bin',
      'win32-x64',
      'CuraEngine.exe'
    )
    // Read just the first 1 KB — enough for both the DOS stub MZ and the
    // PE signature pointer.
    const head = readFileSync(full).subarray(0, 1024)
    expect(head[0]).toBe(0x4d) // 'M'
    expect(head[1]).toBe(0x5a) // 'Z'
    // PE header offset lives at byte 0x3C (little-endian uint32)
    const peOffset = head.readUInt32LE(0x3c)
    expect(peOffset).toBeGreaterThan(0)
    expect(peOffset).toBeLessThan(head.length - 4)
    // The four bytes at peOffset should be 'P','E',0,0
    expect(head[peOffset]).toBe(0x50) // 'P'
    expect(head[peOffset + 1]).toBe(0x45) // 'E'
    expect(head[peOffset + 2]).toBe(0x00)
    expect(head[peOffset + 3]).toBe(0x00)
  })

  it('the resolver returns ok=true for win32-x64 against the real on-disk tree', () => {
    const result = resolveBundledCuraEnginePath(RESOURCES_ROOT, {
      platform: 'win32',
      arch: 'x64'
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.path.endsWith('CuraEngine.exe')).toBe(true)
      expect(existsSync(result.path)).toBe(true)
    }
  })

  it('the essential MSVC + UCRT runtime DLLs are vendored alongside CuraEngine.exe', () => {
    const binDir = join(RESOURCES_ROOT, 'slicer', 'bin', 'win32-x64')
    // The minimum DLL set CuraEngine.exe links against on Windows. Any
    // missing entry will surface at first-launch with a "VCRUNTIME140.dll
    // not found" style dialog the user can't easily diagnose.
    const required = [
      'VCRUNTIME140.dll',
      'VCRUNTIME140_1.dll',
      'MSVCP140.dll',
      'ucrtbase.dll'
    ]
    for (const dll of required) {
      expect(existsSync(join(binDir, dll))).toBe(true)
    }
  })

  it('the CuraEngine support DLLs (Arcus, Savitar) are vendored', () => {
    const binDir = join(RESOURCES_ROOT, 'slicer', 'bin', 'win32-x64')
    // Arcus = Cura's protobuf bridge; Savitar = 3MF reader. Both ship
    // alongside CuraEngine.exe in every Cura release and are required at
    // runtime even for STL → G-code slicing (Arcus is a hard dep).
    expect(existsSync(join(binDir, 'Arcus.dll'))).toBe(true)
    expect(existsSync(join(binDir, 'Savitar.dll'))).toBe(true)
  })
})

describe('Vendored CuraEngine FDM definitions — Phase 2 [P2-K2-SLICE]/Cycle 3', () => {
  it('the definitions resolver returns ok=true against the on-disk tree', () => {
    const result = resolveBundledCuraDefinitionsPath(RESOURCES_ROOT)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.path.endsWith('definitions')).toBe(true)
      expect(existsSync(join(result.path, 'fdmprinter.def.json'))).toBe(true)
    }
  })

  it('fdmprinter.def.json is non-trivially sized (>= 100 KB)', () => {
    const fp = join(
      RESOURCES_ROOT,
      'slicer',
      'definitions',
      'fdmprinter.def.json'
    )
    expect(statSync(fp).size).toBeGreaterThan(100_000)
  })

  it('fdmextruder.def.json is non-trivially sized (>= 1 KB)', () => {
    const fe = join(
      RESOURCES_ROOT,
      'slicer',
      'definitions',
      'fdmextruder.def.json'
    )
    expect(statSync(fe).size).toBeGreaterThan(1_000)
  })

  it('fdmprinter.def.json parses as valid JSON with the expected Ultimaker shape', () => {
    const raw = readFileSync(
      join(
        RESOURCES_ROOT,
        'slicer',
        'definitions',
        'fdmprinter.def.json'
      ),
      'utf-8'
    )
    const parsed: unknown = JSON.parse(raw)
    // Ultimaker's definition root has at least a `version`, a `name`,
    // and a `metadata` block. We don't pin the exact value because that
    // bumps with each Cura release; we just want the shape.
    expect(typeof parsed).toBe('object')
    expect(parsed).not.toBeNull()
    const obj = parsed as Record<string, unknown>
    expect(typeof obj.version).toBe('number')
    expect(typeof obj.name).toBe('string')
    expect(typeof obj.metadata).toBe('object')
  })

  it('fdmextruder.def.json declares the extruder metadata type', () => {
    const raw = readFileSync(
      join(
        RESOURCES_ROOT,
        'slicer',
        'definitions',
        'fdmextruder.def.json'
      ),
      'utf-8'
    )
    const parsed = JSON.parse(raw) as {
      name?: string
      metadata?: { type?: string }
    }
    // Ultimaker's extruder root is type='extruder' (not type='machine')
    // and has name='Extruder'. The K2 Plus stub at
    // `resources/slicer/creality_k2_plus.def.json` resolves the extruder
    // block via this file, so a wrong type would break slice-time.
    expect(parsed.name).toBe('Extruder')
    expect(parsed.metadata?.type).toBe('extruder')
  })
})

describe('AGPLv3 license attribution', () => {
  it('AGPLv3.txt is shipped alongside the bundled binary set', () => {
    const lic = join(
      RESOURCES_ROOT,
      'slicer',
      'LICENSES',
      'AGPLv3.txt'
    )
    expect(existsSync(lic)).toBe(true)
    expect(statSync(lic).size).toBeGreaterThan(10_000)
    const head = readFileSync(lic, 'utf-8').slice(0, 200)
    expect(head).toContain('GNU AFFERO GENERAL PUBLIC LICENSE')
  })

  it('THIRD_PARTY_LICENSES.md lists the win32-x64 binary as VENDORED', () => {
    const docPath = join(
      RESOURCES_ROOT,
      'slicer',
      'THIRD_PARTY_LICENSES.md'
    )
    const doc = readFileSync(docPath, 'utf-8')
    expect(doc).toContain('VENDORED 2026-05-05')
    expect(doc).toContain('win32-x64/CuraEngine.exe')
    // SHA256 line for CuraEngine.exe must be present so a future re-vendor
    // updates this file (the test fails until the new SHA256 lands).
    expect(doc).toMatch(/`bin\/win32-x64\/CuraEngine\.exe`:\s+`[0-9a-f]{64}`/)
  })
})
