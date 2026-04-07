import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { drawingFileSchema, emptyDrawingFile, type DrawingFile } from '../shared/drawing-sheet-schema'
import { isENOENT } from '../shared/file-parse-errors'

export async function loadDrawingFile(projectDir: string): Promise<DrawingFile> {
  const p = join(projectDir, 'drawing', 'drawing.json')
  try {
    const raw = await readFile(p, 'utf-8')
    const j = JSON.parse(raw) as unknown
    return drawingFileSchema.parse(j)
  } catch (e) {
    if (isENOENT(e)) return emptyDrawingFile()
    throw e
  }
}

export async function saveDrawingFile(projectDir: string, file: DrawingFile): Promise<void> {
  const dir = join(projectDir, 'drawing')
  await mkdir(dir, { recursive: true })
  const normalized = drawingFileSchema.parse(file)
  await writeFile(join(dir, 'drawing.json'), JSON.stringify(normalized, null, 2), 'utf-8')
}
