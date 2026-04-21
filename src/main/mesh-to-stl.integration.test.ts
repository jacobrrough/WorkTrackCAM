import { mkdtemp, readFile, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { runPythonJson } from './cad/occt-import'

let pythonHasTrimesh = false
/** Executable + optional prefix (e.g. `py -3`) for spawning mesh_to_stl. */
let pythonLauncher: { file: string; prefix: string[] } = { file: 'python', prefix: [] }

beforeAll(() => {
  const candidates: { file: string; probeArgs: string[]; prefix: string[] }[] = [
    { file: 'python', probeArgs: ['-c', 'import trimesh'], prefix: [] },
    { file: 'py', probeArgs: ['-3', '-c', 'import trimesh'], prefix: ['-3'] },
    { file: 'py', probeArgs: ['-c', 'import trimesh'], prefix: [] }
  ]
  for (const c of candidates) {
    try {
      execFileSync(c.file, c.probeArgs, { stdio: 'ignore' })
      pythonHasTrimesh = true
      pythonLauncher = { file: c.file, prefix: c.prefix }
      return
    } catch {
      /* try next */
    }
  }
  pythonHasTrimesh = false
})

describe('mesh_to_stl.py', () => {
  let tmp: string | undefined

  afterEach(async () => {
    if (tmp) {
      await unlink(join(tmp, 't.obj')).catch(() => {})
      await unlink(join(tmp, 'out.stl')).catch(() => {})
      tmp = undefined
    }
  })

  it.skipIf(!pythonHasTrimesh)('writes binary STL and JSON ok for minimal OBJ', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'wtcam-mesh-'))
    const objPath = join(tmp, 't.obj')
    const stlPath = join(tmp, 'out.stl')
    await writeFile(
      objPath,
      ['v 0 0 0', 'v 1 0 0', 'v 0 1 0', 'f 1 2 3', ''].join('\n'),
      'utf-8'
    )
    const script = join(process.cwd(), 'engines', 'mesh', 'mesh_to_stl.py')
    const r = await runPythonJson(
      pythonLauncher.file,
      [...pythonLauncher.prefix, script, objPath, stlPath],
      process.cwd()
    )
    expect(r.code).toBe(0)
    expect(r.json?.ok).toBe(true)
    const buf = await readFile(stlPath)
    expect(buf.length).toBeGreaterThan(84)
    expect(buf.readUInt32LE(80)).toBeGreaterThanOrEqual(1)
  })
})
