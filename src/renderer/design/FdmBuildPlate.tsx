import { memo, useMemo } from 'react'
import * as THREE from 'three'
import { Line } from '@react-three/drei'

type FdmBuildPlateProps = {
  workAreaMm: { x: number; y: number; z: number }
  brand?: 'creality' | 'generic'
  showVolume?: boolean
}

const PLATE_COLOR = '#2a2a2a'
const GRID_COLOR = '#3a3a3a'
const ACCENT_COLOR = '#a855f7'
const CELL_SIZE = 10

function BuildPlateGrid({ width, depth }: { width: number; depth: number }) {
  const lineGeometry = useMemo(() => {
    const points: THREE.Vector3[] = []
    for (let x = 0; x <= width; x += CELL_SIZE) {
      points.push(new THREE.Vector3(x, 0.05, 0), new THREE.Vector3(x, 0.05, depth))
    }
    for (let z = 0; z <= depth; z += CELL_SIZE) {
      points.push(new THREE.Vector3(0, 0.05, z), new THREE.Vector3(width, 0.05, z))
    }
    const geom = new THREE.BufferGeometry().setFromPoints(points)
    return geom
  }, [width, depth])

  return (
    <lineSegments geometry={lineGeometry}>
      <lineBasicMaterial color={GRID_COLOR} transparent opacity={0.4} />
    </lineSegments>
  )
}

function CenterCrosshair({ width, depth }: { width: number; depth: number }) {
  const cx = width / 2
  const cz = depth / 2
  const armLen = Math.min(width, depth) * 0.03
  return (
    <group>
      <Line
        points={[[cx - armLen, 0.06, cz], [cx + armLen, 0.06, cz]]}
        color={ACCENT_COLOR}
        lineWidth={1.5}
        transparent
        opacity={0.6}
      />
      <Line
        points={[[cx, 0.06, cz - armLen], [cx, 0.06, cz + armLen]]}
        color={ACCENT_COLOR}
        lineWidth={1.5}
        transparent
        opacity={0.6}
      />
    </group>
  )
}

function PlateEdge({ width, depth }: { width: number; depth: number }) {
  const points: [number, number, number][] = [
    [0, 0.02, 0],
    [width, 0.02, 0],
    [width, 0.02, depth],
    [0, 0.02, depth],
    [0, 0.02, 0]
  ]
  return (
    <Line
      points={points}
      color={ACCENT_COLOR}
      lineWidth={1.5}
      transparent
      opacity={0.5}
    />
  )
}

function VolumeWireframe({ width, depth, height }: { width: number; depth: number; height: number }) {
  return (
    <mesh position={[width / 2, height / 2, depth / 2]}>
      <boxGeometry args={[width, height, depth]} />
      <meshBasicMaterial
        wireframe
        color={ACCENT_COLOR}
        transparent
        opacity={0.12}
      />
    </mesh>
  )
}

export const FdmBuildPlate = memo(function FdmBuildPlate({
  workAreaMm,
  brand,
  showVolume = true
}: FdmBuildPlateProps) {
  const { x: width, y: depth, z: height } = workAreaMm

  return (
    <group>
      {/* Build plate surface */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[width / 2, 0, depth / 2]} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial
          color={PLATE_COLOR}
          metalness={0.6}
          roughness={0.4}
          side={THREE.DoubleSide}
        />
      </mesh>

      <BuildPlateGrid width={width} depth={depth} />
      <CenterCrosshair width={width} depth={depth} />
      <PlateEdge width={width} depth={depth} />

      {showVolume && <VolumeWireframe width={width} depth={depth} height={height} />}

      {brand === 'creality' && (
        <mesh position={[width / 2, 0.03, 8]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[60, 6]} />
          <meshBasicMaterial color={ACCENT_COLOR} transparent opacity={0.15} />
        </mesh>
      )}
    </group>
  )
})
