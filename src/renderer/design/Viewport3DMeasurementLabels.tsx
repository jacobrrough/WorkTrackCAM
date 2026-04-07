/**
 * Persistent measurement labels — renders a 3D dimension annotation
 * between two measure points as an Html overlay that stays visible
 * and readable regardless of camera angle.
 */
import { memo, useMemo } from 'react'
import { Html, Line } from '@react-three/drei'
import type { MeasureMarker } from './Viewport3D'

type Props = {
  markers: MeasureMarker[]
}

/**
 * When exactly 2 markers are present, renders:
 *   1. A dashed line connecting the two points
 *   2. An Html label at the midpoint showing the distance in mm
 */
export const Viewport3DMeasurementLabels = memo(function Viewport3DMeasurementLabels({
  markers
}: Props) {
  const measurement = useMemo(() => {
    if (markers.length !== 2) return null
    const a = markers[0]!
    const b = markers[1]!
    const dist = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)
    const mid: [number, number, number] = [
      (a.x + b.x) / 2,
      (a.y + b.y) / 2,
      (a.z + b.z) / 2
    ]
    return { a, b, dist, mid }
  }, [markers])

  if (!measurement) return null

  const { a, b, dist, mid } = measurement

  return (
    <group>
      {/* Dashed line connecting the two measurement points */}
      <Line
        points={[
          [a.x, a.y, a.z],
          [b.x, b.y, b.z]
        ]}
        color="#fbbf24"
        lineWidth={1.5}
        dashed
        dashSize={3}
        gapSize={2}
      />
      {/* Persistent dimension label at midpoint */}
      <Html
        position={mid}
        center
        distanceFactor={undefined}
        style={{
          pointerEvents: 'none',
          userSelect: 'none'
        }}
      >
        <div
          className="viewport-3d__measure-label"
          role="status"
          aria-label={`Distance: ${dist.toFixed(3)} mm`}
        >
          {dist.toFixed(3)} mm
        </div>
      </Html>
    </group>
  )
})
