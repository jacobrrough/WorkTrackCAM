import { useCallback, useState } from 'react'

/**
 * Top-level workspace the new shell is showing. Replaces the legacy shell's
 * mix of `phase` / `navSection` / `designOpen` with one explicit router. CAD
 * (`design`) is the default surface — the app is CAD-first (P4).
 */
export type WorkspaceId =
  | 'design'
  | 'assemble'
  | 'manufacture'
  | 'drawings'
  | 'workshop'
  | 'utilities'

export interface WorkspaceRouter {
  readonly activeWorkspace: WorkspaceId
  readonly setActiveWorkspace: (w: WorkspaceId) => void
}

export function useWorkspaceRouter(initial: WorkspaceId = 'design'): WorkspaceRouter {
  const [activeWorkspace, setActive] = useState<WorkspaceId>(initial)
  const setActiveWorkspace = useCallback((w: WorkspaceId) => setActive(w), [])
  return { activeWorkspace, setActiveWorkspace }
}
