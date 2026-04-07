import { access, constants } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'

/** Pick `dir/<name>` or `dir/<base>_2<ext>` … so batch imports never overwrite. */
export async function resolveUniqueFilenameInDir(
  dir: string,
  preferredFileName: string
): Promise<string> {
  const ext = extname(preferredFileName)
  const base = basename(preferredFileName, ext) || 'asset'
  let n = 0
  for (;;) {
    const name = n === 0 ? `${base}${ext}` : `${base}_${n}${ext}`
    const full = join(dir, name)
    try {
      await access(full, constants.F_OK)
      n++
    } catch {
      return full
    }
  }
}
