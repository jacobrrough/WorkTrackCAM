/**
 * desktop-launcher-contract.test.ts
 *
 * Pins the "always run latest source" desktop launcher so a future change
 * cannot silently break the one-click workflow the shop relies on:
 *
 *   - `scripts/launch.ps1`      — rebuild-if-stale then run the built app
 *   - `scripts/install-desktop-shortcut.ps1` — writes the Desktop .lnk
 *   - `Launch WorkTrack3D.bat`  — double-click entry point
 *   - package.json scripts      — `build:app`, `launch`, `shortcut:install`
 *
 * The launcher deliberately runs the freshly built local source via
 * electron-vite (NOT the frozen NSIS install), which is the whole point:
 * the installed 0.1.0 shortcut launched a stale build.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')

function read(rel: string): string {
  return readFileSync(join(REPO, rel), 'utf-8')
}

describe('desktop launcher — package.json scripts', () => {
  const pkg = JSON.parse(read('package.json')) as {
    scripts: Record<string, string>
  }

  it('build:app compiles the app without the NSIS installer', () => {
    // Must be plain electron-vite build — adding electron-builder here would
    // drag the whole installer into every launch.
    expect(pkg.scripts['build:app']).toBe('electron-vite build')
  })

  it('launch builds then runs the built app', () => {
    expect(pkg.scripts['launch']).toBe('npm run build:app && npm run preview')
  })

  it('preview runs electron-vite preview (the built-app runner)', () => {
    expect(pkg.scripts['preview']).toBe('electron-vite preview')
  })

  it('shortcut:install invokes the install-desktop-shortcut script', () => {
    expect(pkg.scripts['shortcut:install']).toContain('scripts/install-desktop-shortcut.ps1')
  })

  it('the frozen installer build path is left untouched', () => {
    // The full `build` (installer) script must still exist and still chain
    // electron-builder — the launcher is additive, not a replacement.
    expect(pkg.scripts['build']).toBe('electron-vite build && electron-builder')
  })
})

describe('desktop launcher — launch.ps1', () => {
  const src = read('scripts/launch.ps1')

  it('resolves the repo root from the script location (portable across machines)', () => {
    expect(src).toMatch(/Split-Path\s+-Parent\s+\$PSScriptRoot/)
  })

  it('rebuilds by comparing source mtime against the built out/main/index.js', () => {
    expect(src).toMatch(/out\\main\\index\.js/)
    expect(src).toMatch(/LastWriteTimeUtc/)
  })

  it('skips test/spec files when deciding whether a rebuild is needed', () => {
    expect(src).toMatch(/\\\.\(test\|spec\)\\\./)
  })

  it('builds via the installer-free build:app script', () => {
    expect(src).toMatch(/npm run build:app/)
    expect(src).not.toMatch(/electron-builder/)
  })

  it('launches the built app via preview (latest source, not the NSIS install)', () => {
    expect(src).toMatch(/npm run preview/)
  })

  it('runs the first-time npm install when node_modules is missing', () => {
    expect(src).toMatch(/node_modules/)
    expect(src).toMatch(/npm install/)
  })
})

describe('desktop launcher — install-desktop-shortcut.ps1', () => {
  const src = read('scripts/install-desktop-shortcut.ps1')

  it('writes a WorkTrack3D.lnk onto the Desktop', () => {
    expect(src).toMatch(/GetFolderPath\('Desktop'\)/)
    expect(src).toMatch(/WorkTrack3D\.lnk/)
  })

  it('targets PowerShell running launch.ps1 with a bypassed execution policy', () => {
    expect(src).toMatch(/powershell\.exe/i)
    expect(src).toMatch(/ExecutionPolicy Bypass/)
    expect(src).toMatch(/launch\.ps1/)
  })

  it('prefers the installed app icon but falls back to the Electron binary', () => {
    expect(src).toMatch(/Programs\\WorkTrack3D\\WorkTrack3D\.exe/)
    expect(src).toMatch(/node_modules\\electron\\dist\\electron\.exe/)
  })
})

describe('desktop launcher — Launch WorkTrack3D.bat', () => {
  const src = read('Launch WorkTrack3D.bat')

  it('invokes launch.ps1 relative to the bat location', () => {
    expect(src).toMatch(/%~dp0scripts\\launch\.ps1/)
    expect(src).toMatch(/ExecutionPolicy Bypass/)
  })
})
