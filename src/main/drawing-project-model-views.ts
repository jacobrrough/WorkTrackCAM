import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DrawingViewPlaceholder } from '../shared/drawing-sheet-schema'
import { getEnginesRoot } from './paths'
import { runPythonJson } from './cad/occt-import'

export type ProjectedSegment = { x1: number; y1: number; x2: number; y2: number }

export type ProjectedDrawingView = {
  id: string
  axis: string
  label: string
  segments: ProjectedSegment[]
}

function axisForPlaceholder(p: DrawingViewPlaceholder): string {
  if (p.kind === 'base') return p.viewFrom ?? 'front'
  return p.projectionDirection ?? 'right'
}

export async function projectDrawingViewsFromKernelStl(params: {
  projectDir: string
  placeholders: DrawingViewPlaceholder[]
  pythonPath: string
  appRoot: string
  /** Default A — B/C add section segments; C adds STEP BRep section when STEP exists (see `project_views.py`). */
  meshProjectionTier?: 'A' | 'B' | 'C'
}): Promise<
  | { ok: true; views: ProjectedDrawingView[] }
  | { ok: false; error: string; detail?: string }
> {
  const stlPath = join(params.projectDir, 'output', 'kernel-part.stl')
  const stepPath = join(params.projectDir, 'output', 'kernel-part.step')
  try {
    await readFile(stlPath)
  } catch {
    return { ok: false, error: 'kernel_stl_missing' }
  }

  if (params.placeholders.length === 0) {
    return { ok: true, views: [] }
  }

  const views = params.placeholders.map((p) => ({
    id: p.id,
    axis: axisForPlaceholder(p)
  }))

  const outDir = join(params.projectDir, 'output')
  await mkdir(outDir, { recursive: true })
  const payloadPath = join(outDir, '.drawing-project-payload.json')
  const tier =
    params.meshProjectionTier === 'C' ? 'C' : params.meshProjectionTier === 'B' ? 'B' : 'A'
  let stepForPayload: string | undefined
  if (tier === 'C') {
    try {
      await readFile(stepPath)
      stepForPayload = stepPath
    } catch {
      /* Tier C falls back to A+B linework in Python when STEP missing */
    }
  }
  await writeFile(
    payloadPath,
    JSON.stringify(
      {
        stlPath,
        ...(stepForPayload ? { stepPath: stepForPayload } : {}),
        views,
        snapTolMm: 0.025,
        maxSegments: 22000,
        includeConvexHull: true,
        meshProjectionTier: tier
      },
      null,
      2
    ),
    'utf-8'
  )

  const script = join(getEnginesRoot(), 'occt', 'project_views.py')
  const { code, json } = await runPythonJson(params.pythonPath, [script, payloadPath], params.appRoot)

  if (code !== 0 || !json?.ok) {
    return {
      ok: false,
      error: (json?.error as string) ?? 'project_views_failed',
      detail: json?.detail as string | undefined
    }
  }

  const rawViews = json.views as unknown
  if (!Array.isArray(rawViews)) {
    return { ok: false, error: 'project_views_bad_response' }
  }

  const byId = new Map(params.placeholders.map((p) => [p.id, p]))
  const projected: ProjectedDrawingView[] = []
  for (const row of rawViews) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const id = typeof r.id === 'string' ? r.id : ''
    const axis = typeof r.axis === 'string' ? r.axis : ''
    const segsRaw = r.segments
    const ph = byId.get(id)
    if (!ph) continue
    const segments: ProjectedSegment[] = []
    if (Array.isArray(segsRaw)) {
      for (const s of segsRaw) {
        if (!s || typeof s !== 'object') continue
        const o = s as Record<string, unknown>
        const x1 = Number(o.x1)
        const y1 = Number(o.y1)
        const x2 = Number(o.x2)
        const y2 = Number(o.y2)
        if (![x1, y1, x2, y2].every((n) => Number.isFinite(n))) continue
        segments.push({ x1, y1, x2, y2 })
      }
    }
    projected.push({
      id,
      axis,
      label: ph.label?.trim() ? ph.label : id.slice(0, 8),
      segments
    })
  }

  return { ok: true, views: projected }
}
