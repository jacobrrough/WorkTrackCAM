import { memo } from 'react'

export type Workspace = 'design' | 'assemble' | 'manufacture' | 'utilities'

type Props = {
  workspace: Workspace
  onChange: (w: Workspace) => void
  /** When set, only these workbenches are shown (e.g. WorkTrackCAD vs WorkTrackCAM builds). */
  allowedWorkspaces?: Workspace[] | null
}

const ITEMS: { id: Workspace; label: string; title: string; ariaLabel: string }[] = [
  {
    id: 'design',
    label: 'Design',
    title: 'Design — parametric sketches, solids, and 3D preview',
    ariaLabel: 'Design workspace: sketches, features, and 3D model'
  },
  {
    id: 'assemble',
    label: 'Assemble',
    title: 'Assemble — components, joints, and interference',
    ariaLabel: 'Assemble workspace: components and joints'
  },
  {
    id: 'manufacture',
    label: 'Manufacture',
    title: 'Manufacture — setups, CAM, slicing, and tools',
    ariaLabel: 'Manufacture workspace: CAM, slice, and tool library'
  },
  {
    id: 'utilities',
    label: 'File',
    title: 'File — project folder, settings, drawings, and parameters',
    ariaLabel: 'File workspace: project and application settings'
  }
]

export const WorkspaceBar = memo(function WorkspaceBar({ workspace, onChange, allowedWorkspaces }: Props) {
  const items =
    allowedWorkspaces != null && allowedWorkspaces.length > 0
      ? ITEMS.filter((it) => allowedWorkspaces.includes(it.id))
      : ITEMS
  return (
    <nav className="workspace-bar workspace-bar--fusion" aria-label="Workspace">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          className={workspace === it.id ? 'active' : ''}
          aria-current={workspace === it.id ? 'page' : undefined}
          aria-label={it.ariaLabel}
          title={it.title}
          onClick={() => onChange(it.id)}
        >
          {it.label}
        </button>
      ))}
    </nav>
  )
})
