import type { DesignFileV2 } from '../../shared/design-schema'
import type { PartFeaturesFile } from '../../shared/part-features-schema'
import { kernelDesignHashPayload, kernelFeaturesHashPayload } from '../../shared/kernel-inspect-hash'

export async function sha256HexUtf8(text: string): Promise<string> {
  const data = new TextEncoder().encode(text)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function computeKernelDesignHashWeb(design: DesignFileV2): Promise<string> {
  return sha256HexUtf8(kernelDesignHashPayload(design))
}

export function computeKernelFeaturesHashWeb(features: PartFeaturesFile | null): Promise<string> {
  return sha256HexUtf8(kernelFeaturesHashPayload(features))
}
