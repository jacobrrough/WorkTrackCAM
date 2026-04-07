import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { attachKernelPostOpsToPayload, buildKernelBuildPayload } from '../../shared/sketch-profile'
import { partFeaturesFileSchema, type PartFeaturesFile } from '../../shared/part-features-schema'
import { designFileSchemaV2, normalizeDesign } from '../../shared/design-schema'
import { kernelBuildDetailGuidance } from '../../shared/kernel-build-messages'
import { kernelManifestSchema, type KernelManifest } from '../../shared/kernel-manifest-schema'
import { getEnginesRoot } from '../paths'
import { runPythonJson } from './occt-import'

function parseSplitKeepHalfspace(raw: unknown): KernelManifest['splitKeepHalfspace'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const axis = typeof o.axis === 'string' ? o.axis.trim().toUpperCase() : ''
  const keep = typeof o.keep === 'string' ? o.keep.trim().toLowerCase() : ''
  const offsetMm = typeof o.offsetMm === 'number' && Number.isFinite(o.offsetMm) ? o.offsetMm : NaN
  if (
    (axis !== 'X' && axis !== 'Y' && axis !== 'Z') ||
    (keep !== 'positive' && keep !== 'negative') ||
    !Number.isFinite(offsetMm)
  ) {
    return undefined
  }
  return { axis, offsetMm, keep }
}

export type KernelBuildResult =
  | { ok: true; stepPath: string; stlPath: string; manifest: KernelManifest }
  | { ok: false; error: string; detail?: string; manifest: KernelManifest }

/**
 * Phase 1: design/sketch.json → JSON payload → CadQuery `build_part.py` → STEP + STL in project output/.
 */
export async function buildKernelPartFromProject(params: {
  projectDir: string
  pythonPath: string
  appRoot: string
}): Promise<KernelBuildResult> {
  const designPath = join(params.projectDir, 'design', 'sketch.json')
  const featuresPath = join(params.projectDir, 'part', 'features.json')
  const outputDir = join(params.projectDir, 'output')
  const partDir = join(params.projectDir, 'part')
  await mkdir(outputDir, { recursive: true })
  await mkdir(partDir, { recursive: true })

  const manifestPath = join(partDir, 'kernel-manifest.json')
  const base = 'kernel-part'
  const payloadPath = join(outputDir, '.kernel-build-payload.json')

  function withManifestHint(m: KernelManifest, err?: string, det?: string): KernelManifest {
    const hint = kernelBuildDetailGuidance(det, err)
    return hint ? { ...m, userHint: hint } : m
  }

  let raw: string
  try {
    raw = await readFile(designPath, 'utf-8')
  } catch {
    const manifest = withManifestHint(
      {
        version: 1,
        builtAt: new Date().toISOString(),
        ok: false,
        error: 'design_file_missing',
        detail: designPath
      },
      'design_file_missing',
      designPath
    )
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')
    return { ok: false, error: 'design_file_missing', detail: designPath, manifest }
  }

  const design = normalizeDesign(JSON.parse(raw) as unknown)
  const parsed = designFileSchemaV2.parse(design)
  const designHash = createHash('sha256').update(JSON.stringify(parsed)).digest('hex')
  const sketchPlaneKind = parsed.sketchPlane.kind
  const sketchPlaneDatum = parsed.sketchPlane.kind === 'datum' ? parsed.sketchPlane.datum : undefined

  let featuresParsed: PartFeaturesFile | null = null
  try {
    const fraw = await readFile(featuresPath, 'utf-8')
    featuresParsed = partFeaturesFileSchema.parse(JSON.parse(fraw) as unknown)
  } catch {
    featuresParsed = null
  }
  const featuresHash = createHash('sha256')
    .update(featuresParsed ? JSON.stringify(featuresParsed) : '')
    .digest('hex')
  const kernelOpsFromFeatures = featuresParsed?.kernelOps

  const payloadResult = buildKernelBuildPayload(parsed)
  if (!payloadResult.ok) {
    const manifest = withManifestHint(
      {
        version: 1,
        builtAt: new Date().toISOString(),
        ok: false,
        error: payloadResult.error,
        designHash,
        featuresHash,
        solidKind: parsed.solidKind,
        profileCount: 0,
        payloadVersion: 1,
        postSolidOpCount: 0,
        sketchPlaneKind,
        sketchPlaneDatum
      },
      payloadResult.error
    )
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')
    return { ok: false, error: payloadResult.error, manifest }
  }

  const payload = attachKernelPostOpsToPayload(payloadResult.payload, kernelOpsFromFeatures)
  await writeFile(payloadPath, JSON.stringify(payload, null, 2), 'utf-8')

  const script = join(getEnginesRoot(), 'occt', 'build_part.py')
  const { code, json } = await runPythonJson(params.pythonPath, [script, payloadPath, outputDir, base], params.appRoot)

  if (code !== 0 || !json?.ok) {
    const errCode = (json?.error as string) ?? 'kernel_build_failed'
    const det = json?.detail as string | undefined
    const manifest = withManifestHint(
      {
        version: 1,
        builtAt: new Date().toISOString(),
        ok: false,
        error: errCode,
        detail: det,
        designHash,
        featuresHash,
        solidKind: parsed.solidKind,
        profileCount: payloadResult.payload.profiles.length,
        payloadVersion: payload.version,
        postSolidOpCount: payload.postSolidOps?.length ?? 0,
        sketchPlaneKind,
        sketchPlaneDatum,
        loftStrategy: typeof json?.loftStrategy === 'string' ? json.loftStrategy : undefined,
        flatPatternStrategy: typeof json?.flatPatternStrategy === 'string' ? json.flatPatternStrategy : undefined
      },
      errCode,
      det
    )
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')
    return {
      ok: false,
      error: manifest.error ?? 'kernel_build_failed',
      detail: manifest.detail,
      manifest
    }
  }

  const stepPath = json.stepPath as string
  const stlPath = json.stlPath as string
  const manifest: KernelManifest = {
    version: 1,
    builtAt: new Date().toISOString(),
    ok: true,
    stepPath,
    stlPath,
    designHash,
    featuresHash,
    solidKind: parsed.solidKind,
    profileCount: payloadResult.payload.profiles.length,
    payloadVersion: payload.version,
    postSolidOpCount: payload.postSolidOps?.length ?? 0,
    sketchPlaneKind,
    sketchPlaneDatum,
    loftStrategy: typeof json.loftStrategy === 'string' ? json.loftStrategy : undefined,
    flatPatternStrategy: typeof json.flatPatternStrategy === 'string' ? json.flatPatternStrategy : undefined,
    splitKeepHalfspace: parseSplitKeepHalfspace(json?.splitKeepHalfspace),
    splitDiscardedStepPath:
      typeof json?.splitDiscardedStepPath === 'string' && json.splitDiscardedStepPath.trim().length > 0
        ? json.splitDiscardedStepPath.trim()
        : undefined,
    splitDiscardedStlPath:
      typeof json?.splitDiscardedStlPath === 'string' && json.splitDiscardedStlPath.trim().length > 0
        ? json.splitDiscardedStlPath.trim()
        : undefined,
    loftGuideRailsKernelMode:
      json?.loftGuideRailsKernelMode === 'marker' || json?.loftGuideRailsKernelMode === 'sketch_xy_align'
        ? json.loftGuideRailsKernelMode
        : undefined,
    inspectBackend: 'kernel_stl_tessellation',
    stlMeshAngularToleranceDeg:
      typeof payload.stlMeshAngularToleranceDeg === 'number' &&
      Number.isFinite(payload.stlMeshAngularToleranceDeg)
        ? payload.stlMeshAngularToleranceDeg
        : undefined
  }
  kernelManifestSchema.parse(manifest)
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')

  return { ok: true, stepPath, stlPath, manifest }
}
