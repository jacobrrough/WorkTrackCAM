import { collectAsciiStlTriangles, isBinaryStlLayout, isLikelyAsciiStl, iterateBinaryStlTriangles, type Vec3 } from "./stl"
import { addVecStl, mulVecStl, rotateXYZDeg } from "./stl-vec3"

type PlacementMode = "as_is" | "center_origin" | "center_xy_ground_z"
type UpAxisMode = "y_up" | "z_up"
type TransformMode = {
  translateMm?: [number, number, number]
  rotateDeg?: [number, number, number]
  scale?: [number, number, number]
}

function zUpToYUpStl(v: Vec3): Vec3 {
  const [x, y, z] = v
  return [x, z, -y]
}

function triangleNormalStl(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const e1x = b[0] - a[0]
  const e1y = b[1] - a[1]
  const e1z = b[2] - a[2]
  const e2x = c[0] - a[0]
  const e2y = c[1] - a[1]
  const e2z = c[2] - a[2]
  let nx = e1y * e2z - e1z * e2y
  let ny = e1z * e2x - e1x * e2z
  let nz = e1x * e2y - e1y * e2x
  const len = Math.hypot(nx, ny, nz) || 1
  return [nx / len, ny / len, nz / len]
}

function encodeBinaryStlFromTriangles(triangles: Array<[Vec3, Vec3, Vec3]>): Buffer {
  const header = Buffer.alloc(80, 0)
  header.write("UFS import", 0)
  const count = triangles.length
  const out = Buffer.alloc(84 + count * 50)
  header.copy(out, 0)
  out.writeUInt32LE(count, 80)
  let o = 84
  for (const [a, b, c] of triangles) {
    const [nx, ny, nz] = triangleNormalStl(a, b, c)
    out.writeFloatLE(nx, o)
    o += 4
    out.writeFloatLE(ny, o)
    o += 4
    out.writeFloatLE(nz, o)
    o += 4
    for (const p of [a, b, c]) {
      out.writeFloatLE(p[0], o)
      o += 4
      out.writeFloatLE(p[1], o)
      o += 4
      out.writeFloatLE(p[2], o)
      o += 4
    }
    out.writeUInt16LE(0, o)
    o += 2
  }
  return out
}

export function transformBinaryStlWithPlacement(
  buffer: Buffer,
  placement: PlacementMode,
  upAxis: UpAxisMode,
  transform?: TransformMode
): { ok: true; buffer: Buffer } | { ok: false; error: string; detail?: string } {
  if (buffer.length < 84) {
    return { ok: false, error: "stl_too_small" }
  }

  const mapUp = upAxis === "z_up" ? zUpToYUpStl : (v: Vec3): Vec3 => [v[0], v[1], v[2]]

  const tris: Array<[Vec3, Vec3, Vec3]> = []

  // Handle both ASCII and binary STL formats
  if (isLikelyAsciiStl(buffer) && !isBinaryStlLayout(buffer)) {
    // ASCII STL: parse triangles and proceed (previously rejected)
    const ascii = collectAsciiStlTriangles(buffer, 500_000)
    if (ascii.triangles.length < 1) {
      return { ok: false, error: "empty_stl" }
    }
    for (const [v0, v1, v2] of ascii.triangles) {
      tris.push([mapUp(v0), mapUp(v1), mapUp(v2)])
    }
  } else {
    const triangleCount = buffer.readUInt32LE(80)
    if (triangleCount < 1) {
      return { ok: false, error: "empty_stl" }
    }
    const r = iterateBinaryStlTriangles(buffer, triangleCount, (v0, v1, v2) => {
      tris.push([mapUp(v0), mapUp(v1), mapUp(v2)])
    })
    if (r.truncated || r.yielded !== triangleCount) {
      return { ok: false, error: "stl_triangle_read_mismatch" }
    }
  }

  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (const tri of tris) {
    for (const p of tri) {
      minX = Math.min(minX, p[0])
      minY = Math.min(minY, p[1])
      minZ = Math.min(minZ, p[2])
      maxX = Math.max(maxX, p[0])
      maxY = Math.max(maxY, p[1])
      maxZ = Math.max(maxZ, p[2])
    }
  }

  let tx = 0
  let ty = 0
  let tz = 0
  if (placement === "center_origin") {
    tx = -((minX + maxX) / 2)
    ty = -((minY + maxY) / 2)
    tz = -((minZ + maxZ) / 2)
  } else if (placement === "center_xy_ground_z") {
    tx = -((minX + maxX) / 2)
    ty = -((minY + maxY) / 2)
    tz = -minZ
  }

  const t: [number, number, number] = [tx, ty, tz]
  let outTris: Array<[Vec3, Vec3, Vec3]> = tris.map(([a, b, c]) => [addVecStl(a, t), addVecStl(b, t), addVecStl(c, t)])

  const rot = transform?.rotateDeg ?? [0, 0, 0]
  const trn = transform?.translateMm ?? [0, 0, 0]
  const scl = transform?.scale ?? [1, 1, 1]
  const hasRot = Math.abs(rot[0]) > 1e-6 || Math.abs(rot[1]) > 1e-6 || Math.abs(rot[2]) > 1e-6
  const hasTrn = Math.abs(trn[0]) > 1e-6 || Math.abs(trn[1]) > 1e-6 || Math.abs(trn[2]) > 1e-6
  const hasScl = Math.abs(scl[0] - 1) > 1e-6 || Math.abs(scl[1] - 1) > 1e-6 || Math.abs(scl[2] - 1) > 1e-6
  if (hasRot || hasTrn || hasScl) {
    outTris = outTris.map(([a, b, c]) => {
      const sa = hasScl ? mulVecStl(a, scl) : a
      const sb = hasScl ? mulVecStl(b, scl) : b
      const sc = hasScl ? mulVecStl(c, scl) : c
      const ra = hasRot ? rotateXYZDeg(sa, rot) : sa
      const rb = hasRot ? rotateXYZDeg(sb, rot) : sb
      const rc = hasRot ? rotateXYZDeg(sc, rot) : sc
      if (!hasTrn) return [ra, rb, rc]
      return [addVecStl(ra, trn), addVecStl(rb, trn), addVecStl(rc, trn)]
    })
  }

  return { ok: true, buffer: encodeBinaryStlFromTriangles(outTris) }
}
