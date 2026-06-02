/**
 * electron-builder-config-pin.test.ts
 *
 * Pins the inline `"build"` block in package.json that the electron-builder
 * 25.1.8 -> 26.8.1 upgrade was validated against, plus the `^26.` devDep floor.
 *
 * Guards against silent config drift that could produce a broken NSIS installer
 * for the three shop targets (Creality K2 Plus / Laguna Swift 5x10 / Makera
 * Carvera) or an accidental downgrade off the audited-clean v26 tree
 * (`npm audit` == 0 only holds on >= 26; v25 carried the dev-only tar/cacache
 * high-severity chain — see docs/SECURITY.md).
 *
 * Pure JSON/config pin — zero production-code edits.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

type BuildConfig = {
  productName: string
  appId: string
  artifactName: string
  files: string[]
  extraResources: Array<{ from: string; to: string }>
  win: { target: string }
  nsis: Record<string, unknown>
  fileAssociations: Array<{ ext: string }>
}

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG_PATH = join(HERE, '..', '..', 'package.json')
const PKG = JSON.parse(readFileSync(PKG_PATH, 'utf-8')) as {
  devDependencies: Record<string, string>
  build: BuildConfig
}

describe('electron-builder version pin', () => {
  it('electron-builder devDep is on the v26 major (audited-clean tree)', () => {
    expect(PKG.devDependencies['electron-builder']).toMatch(/^\^26\./)
  })

  it('electron-builder is NOT pinned back to the v25 tree (regression guard)', () => {
    expect(PKG.devDependencies['electron-builder']).not.toMatch(/^\^?25\./)
  })
})

describe('electron-builder build config pin', () => {
  const b = PKG.build

  it('product identity is stable', () => {
    expect(b.productName).toBe('WorkTrackCAM')
    expect(b.appId).toBe('com.worktrack.cam')
    expect(b.artifactName).toContain('${productName}-${version}-Setup.${ext}')
  })

  it('Windows NSIS is the primary target with the expected installer flags', () => {
    expect(b.win.target).toBe('nsis')
    expect(b.nsis.oneClick).toBe(false)
    expect(b.nsis.perMachine).toBe(false)
    expect(b.nsis.allowToChangeInstallationDirectory).toBe(true)
  })

  it('.wtcam file association is declared', () => {
    expect(b.fileAssociations[0]?.ext).toBe('wtcam')
  })

  it('sidecar engines + win32 OrcaSlicer + profiles are packed via extraResources', () => {
    const froms = b.extraResources.map((r) => r.from)
    expect(froms).toContain('engines')
    expect(froms).toContain('resources/orca-slicer/win32-x64')
    expect(froms).toContain('resources/orca-slicer/profiles')
  })

  it('non-win32 OrcaSlicer trees are excluded from the package (no cross-platform bloat)', () => {
    expect(b.files).toContain('!resources/orca-slicer/win32-x64/**')
    expect(b.files).toContain('!resources/orca-slicer/darwin-arm64/**')
    expect(b.files).toContain('!resources/orca-slicer/linux-x64/**')
  })
})
