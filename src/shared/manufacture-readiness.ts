import type { MachineProfile } from './machine-schema'
import type { ManufactureFile, ManufactureOperation } from './manufacture-schema'
import type { AppSettings, ProjectFile } from './project-schema'

export type ManufactureReadinessIssue = {
  id:
    | 'project_missing'
    | 'settings_cura_missing'
    | 'machine_missing'
    | 'cam_non_cnc_first_op'
    | 'cam_cnc_machine_missing'
    | 'source_mesh_missing'
  severity: 'error' | 'warning'
  message: string
}

export type ManufactureReadinessResult = {
  canSlice: boolean
  canCam: boolean
  issues: ManufactureReadinessIssue[]
}

function firstUnsuppressed(ops: ManufactureOperation[] | undefined): ManufactureOperation | undefined {
  return ops?.find((o) => !o.suppressed)
}

export function evaluateManufactureReadiness(params: {
  project: ProjectFile | null
  settings: AppSettings | null
  machines: MachineProfile[]
  manufacture: ManufactureFile | null
}): ManufactureReadinessResult {
  const issues: ManufactureReadinessIssue[] = []
  const project = params.project
  const settings = params.settings
  const firstOp = firstUnsuppressed(params.manufacture?.operations)

  if (!project) {
    issues.push({
      id: 'project_missing',
      severity: 'error',
      message: 'Open or create a project first.'
    })
  }
  if (!settings?.curaEnginePath?.trim()) {
    issues.push({
      id: 'settings_cura_missing',
      severity: 'warning',
      message: 'CuraEngine path is not set (required for slicing).'
    })
  }
  if (project && !params.machines.some((m) => m.id === project.activeMachineId)) {
    issues.push({
      id: 'machine_missing',
      severity: 'warning',
      message: 'Project active machine ID does not match any loaded machine profile.'
    })
  }
  if (firstOp && !firstOp.kind.startsWith('cnc_')) {
    issues.push({
      id: 'cam_non_cnc_first_op',
      severity: 'warning',
      message: 'First non-suppressed manufacture operation is not a CNC operation.'
    })
  }
  if (!params.machines.some((m) => m.kind === 'cnc')) {
    issues.push({
      id: 'cam_cnc_machine_missing',
      severity: 'error',
      message: 'No CNC machine profile is loaded.'
    })
  }
  if (!project?.meshes?.length) {
    issues.push({
      id: 'source_mesh_missing',
      severity: 'warning',
      message: 'Project has no imported meshes; you may need to pick an STL manually.'
    })
  }

  const hasProject = project != null
  const hasCura = !!settings?.curaEnginePath?.trim()
  const hasCnc = params.machines.some((m) => m.kind === 'cnc')
  const firstOpIsCnc = firstOp == null || firstOp.kind.startsWith('cnc_')

  return {
    canSlice: hasProject && hasCura,
    canCam: hasProject && hasCnc && firstOpIsCnc,
    issues
  }
}
