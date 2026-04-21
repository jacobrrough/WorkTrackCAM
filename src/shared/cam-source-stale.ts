/**
 * Pure helpers for “source mesh newer than posted G-code” (design–CAM associativity hints).
 * Main process supplies mtimes from `stat`; renderer uses results for banners and op badges.
 */

export type CamSourceMeshMtime = {
  relativePath: string
  mtimeMs: number | null
}

/**
 * @param gcodeMtimeMs - `mtimeMs` of posted output (e.g. `output/cam.nc`), or null if missing
 * @param meshes - project-relative asset paths (e.g. `assets/part.stl`) with mtimes when the file exists
 */
export function listStaleSourceMeshesVersusGcode(
  gcodeMtimeMs: number | null,
  meshes: readonly CamSourceMeshMtime[]
): { staleRelativePaths: string[]; noGcode: boolean } {
  if (gcodeMtimeMs == null || !Number.isFinite(gcodeMtimeMs)) {
    return { staleRelativePaths: [], noGcode: true }
  }
  const stale: string[] = []
  for (const m of meshes) {
    const rel = m.relativePath.trim().replace(/^[\\/]+/, '')
    if (!rel) continue
    const t = m.mtimeMs
    if (t == null || !Number.isFinite(t)) continue
    if (t > gcodeMtimeMs) stale.push(rel)
  }
  return { staleRelativePaths: [...new Set(stale)].sort(), noGcode: false }
}

/** Whether a single operation’s `sourceMesh` is in the stale set (normalized path compare). */
export function isOperationSourceMeshStale(sourceMesh: string | null | undefined, staleRelativePaths: readonly string[]): boolean {
  const rel = sourceMesh?.trim().replace(/^[\\/]+/, '') ?? ''
  if (!rel) return false
  return staleRelativePaths.includes(rel)
}
