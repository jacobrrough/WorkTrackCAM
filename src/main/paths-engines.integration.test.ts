import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const electronApp = vi.hoisted(() => ({
  isPackaged: false,
  getAppPath: vi.fn(() => process.cwd())
}))

vi.mock('electron', () => ({
  app: electronApp
}))

import { getEnginesBundleDiagnostics } from './paths'

describe('getEnginesBundleDiagnostics (repo engines/)', () => {
  beforeEach(() => {
    electronApp.isPackaged = false
    electronApp.getAppPath.mockReturnValue(process.cwd())
  })

  it('finds CAM sentinels, mesh script, and OCCT step script', async () => {
    const d = await getEnginesBundleDiagnostics()
    expect(d.enginesRoot).toBe(join(process.cwd(), 'engines'))
    expect(d.directoryReadable).toBe(true)
    expect(d.camBundleComplete).toBe(true)
    expect(d.missingCamSentinels).toEqual([])
    expect(d.meshScriptPresent).toBe(true)
    expect(d.occtStepScriptPresent).toBe(true)
  })
})
