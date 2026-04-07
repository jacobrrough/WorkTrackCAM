import { z } from 'zod'

/** How to reposition the imported mesh in model space (applied to output STL in `assets/`). */
export const meshImportPlacementSchema = z.enum(['as_is', 'center_origin', 'center_xy_ground_z'])

export type MeshImportPlacement = z.infer<typeof meshImportPlacementSchema>

/** File vertical axis before UFS Y-up convention (viewport / sketch use Y-up). */
export const meshImportUpAxisSchema = z.enum(['y_up', 'z_up'])

export type MeshImportUpAxis = z.infer<typeof meshImportUpAxisSchema>

export type MeshImportTransform = {
  /** mm translation applied after up-axis + preset placement */
  translateMm: [number, number, number]
  /** XYZ Euler rotation in degrees applied after up-axis + preset placement */
  rotateDeg: [number, number, number]
}

export const MESH_IMPORT_PLACEMENT_DEFAULTS = {
  placement: 'as_is' satisfies MeshImportPlacement,
  upAxis: 'y_up' satisfies MeshImportUpAxis,
  transform: {
    translateMm: [0, 0, 0] as [number, number, number],
    rotateDeg: [0, 0, 0] as [number, number, number]
  } satisfies MeshImportTransform
} as const

function parseVec3(raw: unknown): [number, number, number] | undefined {
  if (!Array.isArray(raw) || raw.length !== 3) return undefined
  const x = Number(raw[0])
  const y = Number(raw[1])
  const z = Number(raw[2])
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return undefined
  return [x, y, z]
}

/** Parse optional IPC/renderer payload for `assets:importMesh` (unknown fields ignored). */
export function parseMeshImportPlacementPayload(raw: unknown): {
  placement?: MeshImportPlacement
  upAxis?: MeshImportUpAxis
  transform?: MeshImportTransform
} {
  if (raw == null || typeof raw !== 'object') return {}
  const o = raw as Record<string, unknown>
  const out: { placement?: MeshImportPlacement; upAxis?: MeshImportUpAxis; transform?: MeshImportTransform } = {}
  const p = meshImportPlacementSchema.safeParse(o.placement)
  const u = meshImportUpAxisSchema.safeParse(o.upAxis)
  if (p.success) out.placement = p.data
  if (u.success) out.upAxis = u.data
  const t = parseVec3(o.translateMm)
  const r = parseVec3(o.rotateDeg)
  if (t || r) {
    out.transform = {
      translateMm: t ?? MESH_IMPORT_PLACEMENT_DEFAULTS.transform.translateMm,
      rotateDeg: r ?? MESH_IMPORT_PLACEMENT_DEFAULTS.transform.rotateDeg
    }
  }
  return out
}
