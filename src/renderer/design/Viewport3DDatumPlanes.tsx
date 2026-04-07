import { memo } from 'react'
import * as THREE from 'three'

export type SketchDatumId = 'XY' | 'XZ' | 'YZ'

type Props = {
  /** Half-size of each square plane (mm). */
  halfExtentMm: number
  /** When true, clicking a tinted plane selects that datum (same as Top/Front/Right). */
  datumPlanePickMode: boolean
  /** Face sketch plane: show faint reference only; no picking. */
  sketchPlaneIsFace: boolean
  /** Highlight when `design.sketchPlane.kind === 'datum'`. */
  activeDatum: SketchDatumId | null
  onDatumPlaneSelect?: (d: SketchDatumId) => void
}

const COLORS: Record<SketchDatumId, { color: string; emissive: string }> = {
  XY: { color: '#2563eb', emissive: '#1e3a8a' },
  XZ: { color: '#16a34a', emissive: '#14532d' },
  YZ: { color: '#ea580c', emissive: '#7c2d12' }
}

const DatumPlane = memo(function DatumPlane({
  datum,
  halfExtentMm,
  pickEnabled,
  faceOnly,
  active,
  onSelect
}: {
  datum: SketchDatumId
  halfExtentMm: number
  pickEnabled: boolean
  faceOnly: boolean
  active: boolean
  onSelect?: (d: SketchDatumId) => void
}) {
  /** Top (XY) = horizontal XZ (normal +Y); Front (XZ) = z=0 (normal +Z); Right (YZ) = x=0 (normal +X). */
  const rotation: [number, number, number] =
    datum === 'XY' ? [-Math.PI / 2, 0, 0] : datum === 'YZ' ? [0, Math.PI / 2, 0] : [0, 0, 0]

  const c = COLORS[datum]
  const opacity = faceOnly ? 0.07 : active ? 0.42 : 0.2
  const emissiveIntensity = active ? 0.55 : faceOnly ? 0.02 : 0.12

  return (
    <mesh
      rotation={rotation}
      position={[0, 0, 0]}
      renderOrder={-2}
      onPointerDown={(e) => {
        if (!pickEnabled || !onSelect) return
        e.stopPropagation()
        onSelect(datum)
      }}
    >
      <planeGeometry args={[halfExtentMm * 2, halfExtentMm * 2]} />
      <meshStandardMaterial
        color={c.color}
        emissive={c.emissive}
        emissiveIntensity={emissiveIntensity}
        metalness={0.05}
        roughness={0.85}
        transparent
        opacity={opacity}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  )
})

/**
 * Semi-transparent datum planes (XY / XZ / YZ) for sketch orientation and optional click-to-select.
 */
export const Viewport3DDatumPlanes = memo(function Viewport3DDatumPlanes({
  halfExtentMm,
  datumPlanePickMode,
  sketchPlaneIsFace,
  activeDatum,
  onDatumPlaneSelect
}: Props) {
  const pickEnabled = datumPlanePickMode && !sketchPlaneIsFace

  const datums: SketchDatumId[] = ['XY', 'XZ', 'YZ']

  return (
    <group renderOrder={-2}>
      {datums.map((d) => (
        <DatumPlane
          key={d}
          datum={d}
          halfExtentMm={halfExtentMm}
          pickEnabled={pickEnabled}
          faceOnly={sketchPlaneIsFace}
          active={!sketchPlaneIsFace && activeDatum === d}
          onSelect={onDatumPlaneSelect}
        />
      ))}
    </group>
  )
})
