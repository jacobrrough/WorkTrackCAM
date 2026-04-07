/** Same IDs as `WorkspaceBar` — duplicated here so `src/shared` stays renderer-agnostic. */
export type AppWorkspaceId = 'design' | 'assemble' | 'manufacture' | 'utilities'

/**
 * Build-time product, injected as `__APP_PRODUCT__` by electron-vite (main + renderer).
 * - `unified`: all workbenches (default for `npm run dev` / legacy)
 * - `cad`: WorkTrackCAD — design + assembly + file utilities
 * - `cam`: WorkTrackCAM — manufacture + file utilities
 */
export type AppProduct = 'unified' | 'cad' | 'cam'

declare const __APP_PRODUCT__: string

export function getAppProductFromBuild(): AppProduct {
  const v = __APP_PRODUCT__
  if (v === 'cad' || v === 'cam' || v === 'unified') return v
  return 'unified'
}

export function getAppDisplayName(product: AppProduct): string {
  switch (product) {
    case 'cad':
      return 'WorkTrackCAD'
    case 'cam':
      return 'WorkTrackCAM'
    default:
      return 'Unified Fab Studio'
  }
}

export function getAppWindowTitle(product: AppProduct): string {
  return getAppDisplayName(product)
}

/** Splash welcome paragraph per product build. */
export function getSplashLead(product: AppProduct): string {
  switch (product) {
    case 'cad':
      return 'Sketch, model, and assemble parts — open a project or import STL / STEP / mesh; everything stays on your machine.'
    case 'cam':
      return 'Toolpaths, slicing, and manufacturing — open a project or import meshes; everything stays on your machine.'
    default:
      return 'Open a project, start fresh, or import STL / STEP / mesh files — everything stays on your machine.'
  }
}

/** Workbenches available for the current product build. */
export function workspacesForProduct(product: AppProduct): AppWorkspaceId[] {
  if (product === 'cad') return ['design', 'assemble', 'utilities']
  if (product === 'cam') return ['manufacture', 'utilities']
  return ['design', 'assemble', 'manufacture', 'utilities']
}

export function isWorkspaceAllowed(workspace: AppWorkspaceId, product: AppProduct): boolean {
  return workspacesForProduct(product).includes(workspace)
}

/** Map a requested workspace to one allowed for this product (for persistence / commands). */
export function resolveWorkspaceForProduct(workspace: AppWorkspaceId, product: AppProduct): AppWorkspaceId {
  if (product === 'unified') return workspace
  if (isWorkspaceAllowed(workspace, product)) return workspace
  if (product === 'cad') return 'design'
  return 'manufacture'
}
