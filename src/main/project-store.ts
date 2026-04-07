import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { projectSchema, type ProjectFile } from '../shared/project-schema'
import { buildMigrationPipeline } from '../shared/schema-migration'

/**
 * Migration pipeline for project.json files.
 *
 * Currently v1-only (identity). When a v2 schema is added:
 *   1. Import migrateProjectV1toV2 from schema-migration
 *   2. Add the step: { fromVersion: 1, toVersion: 2, migrate: migrateProjectV1toV2 }
 *   3. Widen projectSchema.version to accept 2
 *
 * The pipeline auto-applies all needed steps so old project files open seamlessly.
 */
const projectMigrationPipeline = buildMigrationPipeline<ProjectFile>([], 1)

export async function readProjectFile(projectDir: string): Promise<ProjectFile> {
  const p = join(projectDir, 'project.json')
  const raw = await readFile(p, 'utf-8')
  const data = JSON.parse(raw) as unknown

  // Run through migration pipeline if the file has a version field
  if (
    typeof data === 'object' &&
    data !== null &&
    'version' in data &&
    typeof (data as Record<string, unknown>).version === 'number'
  ) {
    const versioned = data as { version: number; [key: string]: unknown }
    if (projectMigrationPipeline.canMigrate(versioned.version)) {
      const migrated = projectMigrationPipeline.migrateToLatest(versioned)
      return projectSchema.parse(migrated.data)
    }
  }

  return projectSchema.parse(data)
}

export async function writeProjectFile(projectDir: string, project: ProjectFile): Promise<void> {
  await mkdir(projectDir, { recursive: true })
  const p = join(projectDir, 'project.json')
  await writeFile(p, JSON.stringify(project, null, 2), 'utf-8')
}

export function newProject(name: string, activeMachineId: string): ProjectFile {
  return {
    version: 1,
    name,
    updatedAt: new Date().toISOString(),
    activeMachineId,
    meshes: [],
    importHistory: [],
    notes: ''
  }
}
