/**
 * ASSEMBLY FILE-EXISTENCE PROBE — main-process IPC (`assembly:fileExists`).
 *
 * Wave-8 companion to the external-STEP import round-trip. A hydrated assembly
 * row whose durable `geometrySource` is an EXTERNAL vendor STEP (Phase-4 "Insert
 * from file") records the `.step` path the operator picked — which commonly lives
 * OUTSIDE the project tree (vendor libraries). After a reload that file may have
 * moved or been deleted, and the renderer must decide whether to paint an honest
 * DANGLING badge (the row still renders its cached-bbox schematic + stays
 * deletable — see `stepImportSourceIsDangling`). That decision needs ONE IO fact:
 * does the path still resolve on disk?
 *
 * This channel answers exactly that and NOTHING more:
 *
 *   - Input:  an absolute-ish file path (the row's `geometrySource.stepPath`).
 *   - Output: a plain `boolean` — `true` iff the path resolves to an existing
 *             regular file. A missing path, a directory, a null-byte path, a
 *             non-string, or any `stat` error all resolve to `false`.
 *   - It performs an EXISTENCE probe only — it does NOT open the file, read its
 *     bytes, or report its size. There is no path allow-listing because the whole
 *     point is to check an operator-picked EXTERNAL path (unlike the project-tree
 *     handlers that scope reads with `isPathSafe`); the null-byte reject is the
 *     one lexical guard, matching the pure `validateStepImportPath` posture.
 *
 * Posture mirrors the sibling assembly IPC (`ipc-assembly-step-import.ts`): never
 * throws, registered in `src/main/index.ts` inside `app.whenReady()` BEFORE
 * `createWindow()` next to the other `register*Ipc` calls (the IPC ordering
 * invariant) so a cold-start renderer can never hit "No handler registered".
 *
 * SAFETY: Rule 1 — emits NO G-code. Rule 4 — null-byte-rejects the path and
 * performs a read-only `stat` (no open, no write, no subprocess).
 */
import { ipcMain } from 'electron'
import { stat } from 'node:fs/promises'
import type { MainIpcWindowContext } from './ipc-context'

/**
 * Existence-only check for a single file path. Pure of Electron (takes the raw
 * arg) so a unit test drives it directly. Returns:
 *   - `false` for a non-string / empty / null-byte path (no `stat` attempted),
 *   - `false` when the path does not exist OR is not a regular file,
 *   - `true`  only for an existing regular file.
 *
 * Never throws — a `stat` rejection (ENOENT, EACCES, …) folds to `false` so the
 * renderer gets a clean boolean and treats an unreadable path as dangling.
 */
export async function assemblyFileExists(rawPath: unknown): Promise<boolean> {
  if (typeof rawPath !== 'string') return false
  const path = rawPath.trim()
  if (path.length === 0) return false
  // Null-byte reject: a null byte defeats every downstream path check and can
  // truncate the string at the syscall boundary. Refuse rather than probe.
  if (path.includes('\0')) return false
  try {
    const st = await stat(path)
    return st.isFile()
  } catch {
    // Missing / permission-denied / any IO error → not resolvable → dangling.
    return false
  }
}

/**
 * Register the `assembly:fileExists` channel. `_ctx` is accepted for signature
 * symmetry with the other `register*Ipc` functions (this probe needs no window).
 */
export function registerAssemblyFileExistsIpc(_ctx: MainIpcWindowContext): void {
  void _ctx
  ipcMain.handle('assembly:fileExists', async (_e, rawPath: unknown): Promise<boolean> => {
    return assemblyFileExists(rawPath)
  })
}
