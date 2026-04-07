import { designFileSchemaV2, normalizeDesign, type DesignFileV2 } from './design-schema'
import { partFeaturesFileSchema, type PartFeaturesFile } from './part-features-schema'
import { kernelManifestSchema, type KernelManifest } from './kernel-manifest-schema'

/**
 * Canonical JSON string hashed for `part/kernel-manifest.json` `designHash`
 * (must match `build-kernel-part.ts` on disk build).
 */
export function kernelDesignHashPayload(design: DesignFileV2): string {
  const parsed = designFileSchemaV2.parse(normalizeDesign(design as unknown))
  return JSON.stringify(parsed)
}

/**
 * Canonical JSON for features sidecar — must match `build-kernel-part.ts` `featuresHash`.
 */
export function kernelFeaturesHashPayload(features: PartFeaturesFile | null): string {
  if (!features) return ''
  return JSON.stringify(partFeaturesFileSchema.parse(features))
}

export function parseKernelManifestJson(data: unknown): KernelManifest | null {
  const r = kernelManifestSchema.safeParse(data)
  return r.success ? r.data : null
}

export type KernelInspectStaleReason =
  | 'no_manifest'
  | 'manifest_not_ok'
  | 'design_changed'
  | 'features_changed'

export function kernelInspectStaleReason(params: {
  manifest: KernelManifest | null
  designHash: string
  featuresHash: string
}): KernelInspectStaleReason | null {
  const { manifest, designHash, featuresHash } = params
  if (!manifest) return 'no_manifest'
  if (!manifest.ok) return 'manifest_not_ok'
  if (manifest.designHash != null && manifest.designHash !== designHash) return 'design_changed'
  if (manifest.featuresHash != null && manifest.featuresHash !== featuresHash) return 'features_changed'
  return null
}
