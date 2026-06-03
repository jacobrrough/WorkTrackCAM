import { describe, expect, it } from 'vitest'
import {
  getAppDisplayName,
  getSplashLead,
  isWorkspaceAllowed,
  resolveWorkspaceForProduct,
  workspacesForProduct
} from './app-product'

describe('app-product', () => {
  it('workspacesForProduct limits CAD and CAM builds', () => {
    expect(workspacesForProduct('unified').length).toBe(4)
    expect(workspacesForProduct('cad')).toEqual(['design', 'assemble', 'utilities'])
    expect(workspacesForProduct('cam')).toEqual(['manufacture', 'utilities'])
  })

  it('resolveWorkspaceForProduct clamps disallowed workspaces', () => {
    expect(resolveWorkspaceForProduct('manufacture', 'cad')).toBe('design')
    expect(resolveWorkspaceForProduct('design', 'cam')).toBe('manufacture')
    expect(resolveWorkspaceForProduct('assemble', 'cad')).toBe('assemble')
    expect(resolveWorkspaceForProduct('utilities', 'cam')).toBe('utilities')
  })

  it('isWorkspaceAllowed matches workspacesForProduct', () => {
    for (const w of workspacesForProduct('cad')) {
      expect(isWorkspaceAllowed(w, 'cad')).toBe(true)
    }
    expect(isWorkspaceAllowed('manufacture', 'cad')).toBe(false)
  })

  it('getAppDisplayName returns the unified WorkTrack3D brand for every build', () => {
    expect(getAppDisplayName('cad')).toBe('WorkTrack3D')
    expect(getAppDisplayName('cam')).toBe('WorkTrack3D')
    expect(getAppDisplayName('unified')).toBe('WorkTrack3D')
  })

  it('getSplashLead returns non-empty strings', () => {
    for (const p of ['unified', 'cad', 'cam'] as const) {
      expect(getSplashLead(p).length).toBeGreaterThan(20)
    }
  })
})
