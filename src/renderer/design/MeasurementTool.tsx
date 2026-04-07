/**
 * MeasurementTool — self-contained point-to-point distance measurement for the
 * 3D viewport.  Renders a toggle button, handles click-to-pick via raycasting,
 * and draws the measurement annotation (line + label) in world space.
 *
 * Interaction:
 *   - Click "Measure" to enter measurement mode (Shift+click mesh to pick).
 *   - First click sets point A, second click sets point B and shows distance.
 *   - Clicking a third point resets and starts a new measurement.
 *   - ESC cancels the current measurement and exits measurement mode.
 *   - Distance is shown in the current unit system (mm or inches).
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Html, Line } from '@react-three/drei'

/* ──────────────────────── Types ──────────────────────── */

export type MeasurementUnit = 'mm' | 'in'

type MeasurePoint = { x: number; y: number; z: number }

type MeasurementToolSceneProps = {
  /** Active measurement points (0, 1, or 2). */
  points: MeasurePoint[]
  /** World-space sphere radius for point markers (scales with model). */
  markerRadiusMm: number
  /** Display unit for the distance label. */
  unit: MeasurementUnit
}

type MeasurementToolHudProps = {
  active: boolean
  onToggle: () => void
  onCancel: () => void
  points: MeasurePoint[]
  unit: MeasurementUnit
}

/* ──────────────────────── Helpers ─────────────────────── */

const MM_PER_INCH = 25.4

function formatDistance(distMm: number, unit: MeasurementUnit): string {
  if (unit === 'in') {
    return `${(distMm / MM_PER_INCH).toFixed(4)} in`
  }
  return `${distMm.toFixed(3)} mm`
}

/* ──────────────────────── Scene overlay ───────────────── */

/**
 * R3F sub-tree rendered inside `<Canvas>`.  Draws measurement markers, the
 * connecting line, and the distance label in world space.
 */
export const MeasurementToolScene = memo(function MeasurementToolScene({
  points,
  markerRadiusMm,
  unit
}: MeasurementToolSceneProps) {
  /* Shared marker geometry + material — avoids per-sphere GPU uploads. */
  const sphereGeom = useMemo(
    () => new THREE.SphereGeometry(markerRadiusMm, 16, 16),
    [markerRadiusMm]
  )
  const prevSphereRef = useRef<THREE.SphereGeometry | null>(null)
  useEffect(() => {
    if (prevSphereRef.current && prevSphereRef.current !== sphereGeom) {
      prevSphereRef.current.dispose()
    }
    prevSphereRef.current = sphereGeom
    return () => {
      sphereGeom.dispose()
    }
  }, [sphereGeom])

  const markerMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#38bdf8',
        emissive: '#0c4a6e',
        emissiveIntensity: 0.4
      }),
    []
  )
  useEffect(() => {
    return () => {
      markerMat.dispose()
    }
  }, [markerMat])

  const measurement = useMemo(() => {
    if (points.length !== 2) return null
    const a = points[0]!
    const b = points[1]!
    const dist = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)
    const mid: [number, number, number] = [
      (a.x + b.x) / 2,
      (a.y + b.y) / 2,
      (a.z + b.z) / 2
    ]
    return { a, b, dist, mid }
  }, [points])

  if (points.length === 0) return null

  return (
    <group>
      {/* Point markers */}
      {points.map((p, i) => (
        <mesh
          key={i}
          position={[p.x, p.y, p.z]}
          geometry={sphereGeom}
          material={markerMat}
        />
      ))}

      {/* Connecting line + distance label (only when two points are placed) */}
      {measurement ? (
        <>
          <Line
            points={[
              [measurement.a.x, measurement.a.y, measurement.a.z],
              [measurement.b.x, measurement.b.y, measurement.b.z]
            ]}
            color="#38bdf8"
            lineWidth={1.5}
            dashed
            dashSize={3}
            gapSize={2}
          />
          <Html
            position={measurement.mid}
            center
            distanceFactor={undefined}
            style={{ pointerEvents: 'none', userSelect: 'none' }}
          >
            <div
              className="viewport-3d__measure-tool-label"
              role="status"
              aria-label={`Distance: ${formatDistance(measurement.dist, unit)}`}
            >
              {formatDistance(measurement.dist, unit)}
            </div>
          </Html>
        </>
      ) : null}
    </group>
  )
})

/* ──────────────────────── HUD controls ───────────────── */

/**
 * DOM overlay rendered on top of the Canvas (inside `.viewport-3d__hud`).
 * Shows the Measure toggle button and a status line when active.
 */
export const MeasurementToolHud = memo(function MeasurementToolHud({
  active,
  onToggle,
  onCancel,
  points,
  unit
}: MeasurementToolHudProps) {
  /* Listen for ESC globally while measurement mode is active. */
  useEffect(() => {
    if (!active) return
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, onCancel])

  const statusText = useMemo(() => {
    if (!active) return null
    if (points.length === 0) return 'Shift+click first point on the model'
    if (points.length === 1) return 'Shift+click second point'
    if (points.length === 2) {
      const a = points[0]!
      const b = points[1]!
      const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)
      return `${formatDistance(d, unit)} -- Shift+click to start new`
    }
    return null
  }, [active, points, unit])

  return (
    <div className="viewport-3d__measure-tool">
      <button
        type="button"
        className={`viewport-3d__measure-btn${active ? ' viewport-3d__measure-btn--active' : ''}`}
        onClick={onToggle}
        title={active ? 'Exit measure mode (Esc)' : 'Measure point-to-point distance'}
        aria-label={active ? 'Exit measure mode' : 'Measure distance'}
        aria-pressed={active}
      >
        {/* Simple ruler icon via Unicode */}
        &#x1F4CF; Measure
      </button>
      {statusText ? (
        <span className="viewport-3d__measure-status" role="status">
          {statusText}
        </span>
      ) : null}
    </div>
  )
})

/* ──────────────────────── State hook ─────────────────── */

/**
 * Encapsulates measurement-tool state for use by the parent Viewport3D.
 * Returns everything needed to wire into the scene + HUD.
 */
export function useMeasurementTool(unit: MeasurementUnit = 'mm') {
  const [active, setActive] = useState(false)
  const [points, setPoints] = useState<MeasurePoint[]>([])

  const toggle = useCallback(() => {
    setActive((prev) => {
      if (prev) {
        // Exiting — clear points
        setPoints([])
        return false
      }
      return true
    })
  }, [])

  const cancel = useCallback(() => {
    setActive(false)
    setPoints([])
  }, [])

  /** Called when Shift+click hits the mesh surface. */
  const addPoint = useCallback((v: THREE.Vector3) => {
    setPoints((prev) => {
      // Third click resets to a new measurement starting from this point
      if (prev.length >= 2) return [{ x: v.x, y: v.y, z: v.z }]
      return [...prev, { x: v.x, y: v.y, z: v.z }]
    })
  }, [])

  return { active, points, unit, toggle, cancel, addPoint }
}
