import type { Workspace } from './WorkspaceBar'

type Props = {
  workspace: Workspace
  onOpenCommandPalette: () => void
}

export function TasksPanel({ workspace, onOpenCommandPalette }: Props) {
  return (
    <div className="tasks-panel">
      <p className="tasks-panel__lead">
        Contextual steps and wizards can live here (FreeCAD-style <strong>Tasks</strong>). For now, use the command palette
        and workspace ribbon for actions.
      </p>
      {workspace === 'design' && (
        <p className="tasks-panel__hint msg msg--muted">
          In <strong>Design</strong>, pick a sketch plane, draw in the sketch, then use the ribbon for solid tools and kernel
          build. Selections in the <strong>Model</strong> tab update the properties column.
        </p>
      )}
      {workspace === 'assemble' && (
        <p className="tasks-panel__hint msg msg--muted">
          In <strong>Assemble</strong>, use the browser to pick components and setups; joint and transform tools are in the main
          canvas area.
        </p>
      )}
      {workspace === 'manufacture' && (
        <p className="tasks-panel__hint msg msg--muted">
          In <strong>Manufacture</strong>, define setups and operations in the plan; run slice and CAM from the manufacture
          panels or Utilities.
        </p>
      )}
      {workspace === 'utilities' && (
        <p className="tasks-panel__hint msg msg--muted">
          The <strong>File</strong> workspace is for project folder, settings, drawings, and command reference — switch to
          Design, Assemble, or Manufacture for modeling tasks.
        </p>
      )}
      <button type="button" className="primary tasks-panel__cta" onClick={onOpenCommandPalette}>
        Open command palette
      </button>
      <p className="tasks-panel__kbd msg msg--muted">Shortcut: Ctrl+K / ⌘K</p>
    </div>
  )
}
