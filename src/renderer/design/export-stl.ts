import * as THREE from 'three'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'

/** Binary STL as base64 for IPC to main process. */
export function meshToStlBase64(mesh: THREE.Mesh): string {
  const exporter = new STLExporter()
  const out = exporter.parse(mesh, { binary: true }) as DataView
  const buf = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength)
  const u8 = new Uint8Array(buf)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < u8.length; i += chunk) {
    binary += String.fromCharCode(...u8.subarray(i, i + chunk))
  }
  return btoa(binary)
}
