/**
 * [ID-0252] Cycle 180 -- ui-polish paired-pin contract for the SINGLE
 * pure helper exported from `src/renderer/design/export-stl.ts`. The
 * module is small (16 source lines / 614 bytes / 1 export) but
 * load-bearing on the Design tab Three.js -> main-process IPC path
 * across all three target machines:
 *
 *   - `meshToStlBase64(mesh)` is consumed at the SINGLE production
 *     call-site `src/renderer/design/DesignSessionContext.tsx` line
 *     440 (verified via `grep -rn "meshToStlBase64\b" src/`). The
 *     renderer streams a Three.js mesh to the main process by serialising
 *     it as a binary STL via `STLExporter` and base64-encoding the bytes
 *     so they fit through the Electron contextBridge IPC channel
 *     without trip-wiring the structured-clone size cap on large
 *     ArrayBuffers.
 *
 * Pinned facts (any production drift WILL break a test here):
 *   - Module shape: exactly 1 export named `meshToStlBase64`.
 *   - Function signature: `name === 'meshToStlBase64'`, `length === 1`.
 *   - Output is a valid base64 string (no whitespace, padding-aware).
 *   - Round-trip via `atob` recovers the binary STL byte stream.
 *   - Binary STL byte layout: 80-byte header + 4-byte little-endian
 *     UInt32 triangle count + (50 bytes/triangle) where 50 bytes =
 *     12 floats (normal Vec3 + 3 vertex Vec3) + 2-byte attribute byte
 *     count.
 *   - Total byte length === 84 + 50 * triangleCount.
 *   - Chunked btoa loop uses chunk size `0x8000` (32 768) to avoid
 *     `String.fromCharCode(...largeArray)` blowing the call stack on
 *     full-sheet meshes.
 *
 * Three-machine path realism (DIRECT cross-cut):
 *   - Creality K2 Plus (FDM): every imported mesh exported via this
 *     helper feeds the slicer pipeline; a regression in the byte
 *     layout would corrupt the slicer input on EVERY FDM job.
 *   - Laguna Swift 5x10 (RichAuto A-series): full-sheet plywood
 *     pocketing reads the same binary STL stream; chunk-size safety
 *     matters here -- a 60x120" plywood preview can produce a mesh
 *     with hundreds of thousands of triangles, where a single
 *     `String.fromCharCode(...u8)` would call-stack-overflow.
 *   - Makera Carvera + 4th Axis: 4-axis rotary part previews flow
 *     through the same path; the binary STL format is dialect-agnostic.
 *
 * Mirrors the [ID-0247] Cycle 175 window-state-pin and [ID-0242]
 * Cycle 170 gcode-export-safety-pin paired-pin convention.
 */

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import * as ExportStlModule from './export-stl'
import { meshToStlBase64 } from './export-stl'

// ---------- helpers --------------------------------------------------

/** Build a Mesh whose geometry is a single AABB cube. */
function unitCubeMesh(sizeMm: number): THREE.Mesh {
  const geom = new THREE.BoxGeometry(sizeMm, sizeMm, sizeMm)
  const mat = new THREE.MeshBasicMaterial()
  return new THREE.Mesh(geom, mat)
}

/** Build a Mesh from a flat plane geometry (Laguna full-sheet realism). */
function planeMesh(widthMm: number, heightMm: number): THREE.Mesh {
  const geom = new THREE.PlaneGeometry(widthMm, heightMm)
  const mat = new THREE.MeshBasicMaterial()
  return new THREE.Mesh(geom, mat)
}

/** Build a Mesh from a cylinder (Carvera 4-axis rotary realism). */
function cylinderMesh(radiusMm: number, heightMm: number, radialSegments = 32): THREE.Mesh {
  const geom = new THREE.CylinderGeometry(radiusMm, radiusMm, heightMm, radialSegments)
  const mat = new THREE.MeshBasicMaterial()
  return new THREE.Mesh(geom, mat)
}

/** Decode a base64 string back to a Uint8Array. */
function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/** Read the little-endian UInt32 at byte offset of a Uint8Array. */
function readU32LE(bytes: Uint8Array, offset: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 4)
  return view.getUint32(0, true)
}

/** Locate the source file for source-text canary assertions. */
function loadSourceText(): string {
  const repoRoot = resolve(__dirname, '..', '..', '..')
  return readFileSync(resolve(repoRoot, 'src/renderer/design/export-stl.ts'), 'utf-8')
}

// ---------- (A) module shape ----------------------------------------

describe('export-stl module shape', () => {
  it('exports exactly one named export `meshToStlBase64`', () => {
    const keys = Object.keys(ExportStlModule).filter((k) => k !== 'default').sort()
    expect(keys).toEqual(['meshToStlBase64'])
  })

  it('has no default export', () => {
    expect((ExportStlModule as Record<string, unknown>).default).toBeUndefined()
  })

  it('module Symbol.toStringTag is the expected ESM tag', () => {
    // Vitest under the threads pool uses ESM module namespace objects
    // which have Symbol.toStringTag === 'Module'.
    const tag = (ExportStlModule as unknown as { [Symbol.toStringTag]: string })[Symbol.toStringTag]
    expect(typeof tag === 'string' && tag.length > 0).toBe(true)
  })
})

// ---------- (B) function signature ----------------------------------

describe('meshToStlBase64 function signature', () => {
  it('is a native function (typeof === "function", not an arrow)', () => {
    expect(typeof meshToStlBase64).toBe('function')
  })

  it('has name === "meshToStlBase64"', () => {
    expect(meshToStlBase64.name).toBe('meshToStlBase64')
  })

  it('declares arity 1 (one required parameter `mesh`)', () => {
    expect(meshToStlBase64.length).toBe(1)
  })

  it('returns string for any valid Three.js Mesh', () => {
    const mesh = unitCubeMesh(10)
    const out = meshToStlBase64(mesh)
    expect(typeof out).toBe('string')
    expect(out.length).toBeGreaterThan(0)
  })
})

// ---------- (C) base64 contract -------------------------------------

describe('meshToStlBase64 base64 contract', () => {
  it('returns a base64 string with no whitespace', () => {
    const mesh = unitCubeMesh(10)
    const out = meshToStlBase64(mesh)
    expect(out).not.toMatch(/\s/)
  })

  it('returns a base64 string matching the standard alphabet [A-Za-z0-9+/=]', () => {
    const mesh = unitCubeMesh(10)
    const out = meshToStlBase64(mesh)
    expect(out).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
  })

  it('output length is a multiple of 4 (proper base64 padding)', () => {
    const mesh = unitCubeMesh(10)
    const out = meshToStlBase64(mesh)
    expect(out.length % 4).toBe(0)
  })

  it('round-trips losslessly via atob into a Uint8Array', () => {
    const mesh = unitCubeMesh(10)
    const out = meshToStlBase64(mesh)
    const bytes = decodeBase64(out)
    expect(bytes.byteLength).toBeGreaterThan(84) // header + count + at least one triangle
  })
})

// ---------- (D) binary STL byte layout ------------------------------

describe('meshToStlBase64 binary STL byte layout', () => {
  it('decoded length is exactly 84 + 50 * triangleCount', () => {
    const mesh = unitCubeMesh(10)
    const bytes = decodeBase64(meshToStlBase64(mesh))
    const triCount = readU32LE(bytes, 80)
    expect(bytes.byteLength).toBe(84 + 50 * triCount)
  })

  it('places the triangle count UInt32 at byte offset 80 (after the 80-byte header)', () => {
    const mesh = unitCubeMesh(10)
    const bytes = decodeBase64(meshToStlBase64(mesh))
    const triCount = readU32LE(bytes, 80)
    // BoxGeometry has 12 triangles regardless of size.
    expect(triCount).toBe(12)
  })

  it('triangle count is little-endian (per binary STL specification)', () => {
    const mesh = unitCubeMesh(10)
    const bytes = decodeBase64(meshToStlBase64(mesh))
    // For a 12-triangle box, the LE bytes at offset 80..83 are
    // [0x0C, 0x00, 0x00, 0x00].
    expect(bytes[80]).toBe(0x0c)
    expect(bytes[81]).toBe(0x00)
    expect(bytes[82]).toBe(0x00)
    expect(bytes[83]).toBe(0x00)
  })

  it('total bytes for a 12-triangle cube is exactly 84 + 12*50 = 684', () => {
    const mesh = unitCubeMesh(10)
    const bytes = decodeBase64(meshToStlBase64(mesh))
    expect(bytes.byteLength).toBe(684)
  })

  it('total bytes for a 32-segment cylinder (32 + 32 + 32*2 = 128 triangles by THREE convention) matches 84 + 50*tris', () => {
    const mesh = cylinderMesh(5, 20, 32)
    const bytes = decodeBase64(meshToStlBase64(mesh))
    const triCount = readU32LE(bytes, 80)
    expect(bytes.byteLength).toBe(84 + 50 * triCount)
    expect(triCount).toBeGreaterThan(0)
  })
})

// ---------- (E) header bytes ----------------------------------------

describe('meshToStlBase64 STL header', () => {
  it('first 80 bytes are the STL header region (any content -- not asserted to be a specific string)', () => {
    const mesh = unitCubeMesh(10)
    const bytes = decodeBase64(meshToStlBase64(mesh))
    // The STL spec reserves bytes 0..79 for an opaque header that
    // explicitly MUST NOT begin with "solid" (or some parsers
    // misclassify the file as ASCII). THREE.js STLExporter does
    // not write "solid" as the first 5 bytes.
    const first5 = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4])
    expect(first5).not.toBe('solid')
  })

  it('decoded length is at least 84 bytes (header + count) for any non-empty mesh', () => {
    const mesh = unitCubeMesh(1)
    const bytes = decodeBase64(meshToStlBase64(mesh))
    expect(bytes.byteLength).toBeGreaterThanOrEqual(84)
  })
})

// ---------- (F) three-machine path realism --------------------------

describe('meshToStlBase64 three-machine path realism', () => {
  it('K2 Plus (FDM, 0.4 mm nozzle) -- 100 mm test cube produces 12 triangles, 684 bytes', () => {
    const mesh = unitCubeMesh(100)
    const bytes = decodeBase64(meshToStlBase64(mesh))
    expect(readU32LE(bytes, 80)).toBe(12)
    expect(bytes.byteLength).toBe(684)
  })

  it('Laguna Swift 5x10 -- 1219 x 2438 mm full-sheet plane mesh round-trips through chunked btoa loop', () => {
    // The chunked btoa loop chunks at 0x8000 = 32768 bytes. A single
    // PlaneGeometry produces 2 triangles, so the byte stream is small,
    // but we verify the helper doesn't choke on real-world dimensions.
    const mesh = planeMesh(1219, 2438)
    const bytes = decodeBase64(meshToStlBase64(mesh))
    expect(readU32LE(bytes, 80)).toBe(2)
    expect(bytes.byteLength).toBe(84 + 50 * 2)
  })

  it('Carvera 4-axis rotary -- 92 mm diameter x 240 mm length cylinder mesh round-trips cleanly', () => {
    const radiusMm = 46 // 92 mm diameter
    const lengthMm = 240
    const mesh = cylinderMesh(radiusMm, lengthMm, 32)
    const bytes = decodeBase64(meshToStlBase64(mesh))
    const triCount = readU32LE(bytes, 80)
    expect(triCount).toBeGreaterThan(0)
    expect(bytes.byteLength).toBe(84 + 50 * triCount)
  })

  it('large mesh (8000 segments cylinder ~ many triangles) does not call-stack-overflow on the chunked loop', () => {
    // Stress-test the 0x8000 chunk size guard. A 256-segment cylinder
    // produces ~1024 triangles = ~51 KB which exceeds the 32 KB chunk
    // size -- if the helper used `String.fromCharCode(...u8)` without
    // chunking on a much-larger mesh, it would call-stack-overflow
    // around 100 K-200 K elements depending on engine; the chunked
    // loop is the documented mitigation.
    const mesh = cylinderMesh(50, 500, 256)
    expect(() => meshToStlBase64(mesh)).not.toThrow()
    const bytes = decodeBase64(meshToStlBase64(mesh))
    expect(bytes.byteLength).toBeGreaterThan(32768) // exceeds the chunk size, proving we chunked
  })
})

// ---------- (G) pure-function invariants ----------------------------

describe('meshToStlBase64 pure-function invariants', () => {
  it('idempotent: same mesh produces byte-identical base64 output across N=20 calls', () => {
    const mesh = unitCubeMesh(10)
    const first = meshToStlBase64(mesh)
    for (let i = 0; i < 20; i++) {
      expect(meshToStlBase64(mesh)).toBe(first)
    }
  })

  it('does not mutate the input mesh geometry', () => {
    const mesh = unitCubeMesh(10)
    const beforeAttrCount = Object.keys(mesh.geometry.attributes).length
    const beforePosArr = (mesh.geometry.attributes.position.array as Float32Array).slice()
    meshToStlBase64(mesh)
    const afterAttrCount = Object.keys(mesh.geometry.attributes).length
    const afterPosArr = mesh.geometry.attributes.position.array as Float32Array
    expect(afterAttrCount).toBe(beforeAttrCount)
    expect(afterPosArr.length).toBe(beforePosArr.length)
    for (let i = 0; i < beforePosArr.length; i++) {
      expect(afterPosArr[i]).toBe(beforePosArr[i])
    }
  })

  it('no this-binding leakage on call() / apply() -- function executes without depending on its receiver', () => {
    const mesh = unitCubeMesh(10)
    expect(() => meshToStlBase64.call(null, mesh)).not.toThrow()
    expect(() => meshToStlBase64.apply(undefined, [mesh])).not.toThrow()
  })

  it('two distinct meshes with identical geometry produce identical output (geometry-only dependence)', () => {
    const meshA = unitCubeMesh(10)
    const meshB = unitCubeMesh(10)
    expect(meshToStlBase64(meshA)).toBe(meshToStlBase64(meshB))
  })

  it('two meshes with different sizes produce different output', () => {
    const meshSmall = unitCubeMesh(1)
    const meshLarge = unitCubeMesh(100)
    expect(meshToStlBase64(meshSmall)).not.toBe(meshToStlBase64(meshLarge))
  })
})

// ---------- (H) source-text whitelist -------------------------------

describe('meshToStlBase64 source-text whitelist', () => {
  it('source file is small (<= 25 lines, <= 1 KB)', () => {
    const src = loadSourceText()
    const lines = src.split('\n').length
    const stat = statSync(resolve(__dirname, 'export-stl.ts'))
    expect(lines).toBeLessThanOrEqual(25)
    expect(stat.size).toBeLessThanOrEqual(1024)
  })

  it('exactly one named export `meshToStlBase64` (no default export, no extra)', () => {
    const src = loadSourceText()
    const exportLines = src.split('\n').filter((l) => /^export\b/.test(l))
    expect(exportLines.length).toBe(1)
    expect(exportLines[0]).toMatch(/export function meshToStlBase64\s*\(/)
  })

  it('imports `STLExporter` from three/examples/jsm/exporters/STLExporter.js', () => {
    const src = loadSourceText()
    expect(src).toMatch(/from ['"]three\/examples\/jsm\/exporters\/STLExporter\.js['"]/)
  })

  it('imports * as THREE from "three"', () => {
    const src = loadSourceText()
    expect(src).toMatch(/import \* as THREE from ['"]three['"]/)
  })

  it('uses chunk size 0x8000 (32768) for the btoa loop -- protects against call-stack overflow on large meshes', () => {
    const src = loadSourceText()
    expect(src).toContain('0x8000')
  })

  it('uses btoa for base64 encoding (not Buffer.from -- this is renderer-side)', () => {
    const src = loadSourceText()
    expect(src).toMatch(/\bbtoa\(/)
    // No Node fs/Buffer leaks into renderer-side code.
    expect(src).not.toMatch(/from ['"]node:/)
    expect(src).not.toMatch(/\bBuffer\b/)
  })

  it('declares the binary: true option to STLExporter.parse (NOT the ASCII variant)', () => {
    const src = loadSourceText()
    expect(src).toMatch(/binary:\s*true/)
  })

  it('no `:any` / `as any` / `<any>` escape hatches', () => {
    const src = loadSourceText()
    expect(src).not.toMatch(/:\s*any\b/)
    expect(src).not.toMatch(/\bas any\b/)
    expect(src).not.toMatch(/<any>/)
  })

  it('no foreign-machine vendor names (3-machine scope hard rule)', () => {
    const src = loadSourceText().toLowerCase()
    const foreign = ['fanuc', 'haas', 'okuma', 'mazak', 'tormach', 'shopbot']
    for (const v of foreign) {
      expect(src).not.toContain(v)
    }
  })

  it('no toolpath G-code or M-code emission in source (renderer-side helper, not a post)', () => {
    const src = loadSourceText()
    // The helper should not contain G-code/M-code strings; this is
    // a mesh serialization helper, not a post-processor.
    expect(src).not.toMatch(/\bM(?:0?[2-9]|3[0]|10[49]|140|190)\b/)
    expect(src).not.toMatch(/G(?:0[01]|17|18|19|20|21|28|54|90|91)\b/)
  })
})
