import type { DesignFileV2 } from '../../shared/design-schema'
import type { PartFeaturesFile } from '../../shared/part-features-schema'
import { extractKernelProfiles } from '../../shared/sketch-profile'

/** Derive Fusion-style browser rows from current design solid settings. Preserves `kernelOps` from the prior file when saving. */
export function derivePartFeatures(d: DesignFileV2, prev?: PartFeaturesFile | null): PartFeaturesFile {
  const items: PartFeaturesFile['items'] = [{ id: 'sk1', kind: 'sketch', label: 'Sketch1' }]
  if (d.solidKind === 'extrude') {
    items.push({
      id: 'ex1',
      kind: 'extrude',
      label: 'Extrude1',
      params: { depthMm: d.extrudeDepthMm }
    })
  } else if (d.solidKind === 'revolve') {
    items.push({
      id: 'rv1',
      kind: 'revolve',
      label: 'Revolve1',
      params: { angleDeg: d.revolve.angleDeg, axisX: d.revolve.axisX }
    })
  } else {
    const profileCount = extractKernelProfiles(d)?.length
    items.push({
      id: 'lf1',
      kind: 'loft',
      label: 'Loft1',
      params: { separationMm: d.loftSeparationMm, profileCount }
    })
  }
  const base: PartFeaturesFile = { version: 1, items }
  if (prev?.kernelOps !== undefined) {
    const last = prev.kernelOps[prev.kernelOps.length - 1]
    if (last) {
      if (last.kind.startsWith('sheet_')) {
        items.push({ id: `sm${prev.kernelOps.length}`, kind: 'sheet', label: `Sheet ${last.kind}` })
      } else if (last.kind.startsWith('plastic_')) {
        items.push({ id: `pl${prev.kernelOps.length}`, kind: 'plastic', label: `Plastic ${last.kind}` })
      }
    }
    return { ...base, kernelOps: prev.kernelOps }
  }
  return base
}
