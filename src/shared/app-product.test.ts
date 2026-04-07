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

  it('getAppDisplayName maps products', () => {
    expect(getAppDisplayName('cad')).toBe('WorkTrackCAD')
    expect(getAppDisplayName('cam')).toBe('WorkTrackCAM')
    expect(getAppDisplayName('unified')).toBe('Unified Fab Studio')
  })

  it('getSplashLead returns non-empty strings', () => {
    for (const p of ['unified', 'cad', 'cam'] as const) {
      expect(getSplashLead(p).length).toBeGreaterThan(20)
    }
  })
})
