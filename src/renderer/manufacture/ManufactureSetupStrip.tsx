import type { ReactNode } from 'react'
import type { MachineProfile } from '../../shared/machine-schema'
import type { ProjectFile } from '../../shared/project-schema'

type Props = {
  project: ProjectFile
  machines: MachineProfile[]
  machineToolCount: number
  projectToolCount: number
  onActiveMachineChange: (machineId: string) => void | Promise<void>
  onGoSettings: () => void
  onGoProject: () => void
}

export function ManufactureSetupStrip(p: Props): ReactNode {
  const cnc = p.machines.filter((m) => m.kind === 'cnc')
  const machineOptions = cnc.length > 0 ? cnc : p.machines
  return (
    <section className="panel panel--nested manufacture-setup-strip" aria-labelledby="mfg-setup-heading">
      <h3 id="mfg-setup-heading" className="subh">
        Setup
      </h3>
      <p className="msg util-panel-intro">
        Pick the <strong>active CNC machine</strong> for this project (saved in <code>project.json</code>). Tool libraries can live
        in <strong>app storage per machine</strong> (shared across projects) plus optional <code>tools.json</code> in the
        project folder. Manufacture merges <strong>machine tools first</strong>, then project-only tools.
      </p>
      <div className="row row--wrap">
        <label htmlFor="mfg-setup-machine">
          Active machine
          <select
            id="mfg-setup-machine"
            value={p.project.activeMachineId}
            onChange={(e) => void p.onActiveMachineChange(e.target.value)}
          >
            {machineOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.id})
              </option>
            ))}
          </select>
        </label>
        <p className="msg msg--muted msg-row-flex">
          Machine library: <strong>{p.machineToolCount}</strong> tool{p.machineToolCount === 1 ? '' : 's'} · Project{' '}
          <code>tools.json</code>: <strong>{p.projectToolCount}</strong>
        </p>
      </div>
      <ul className="tools manufacture-setup-checklist">
        <li>
          Import or edit machines under{' '}
          <button type="button" className="secondary" onClick={p.onGoSettings}>
            File → Settings → Machine Manager
          </button>
          .
        </li>
        <li>
          Confirm{' '}
          <button type="button" className="secondary" onClick={p.onGoProject}>
            File → Project
          </button>{' '}
          active machine matches your shop setup.
        </li>
        <li>Use the <strong>Tools</strong> tab here to import CSV/JSON/Fusion into the machine or project library.</li>
      </ul>
    </section>
  )
}
