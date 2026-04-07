/**
 * Stock simulation 3D overlay — renders the voxel-based stock removal mesh
 * as a translucent overlay inside the Three.js viewport.
 *
 * Features:
 *   - Remaining stock rendered as semi-transparent blue
 *   - Gouge zones highlighted in red
 *   - Progress slider to scrub through the toolpath (0–100%)
 *   - Color-coded legend for visual clarity
 *
 * Consumes output from `StockSimulator` (src/shared/stock-simulation.ts).
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { ToolpathSegment3 } from '../../shared/cam-gcode-toolpath'
import {
  StockSimulator,
  type GougeFinding,
  type StockMeshData,
  type StockSimulationConfig,
  type StockSimulationStats
} from '../../shared/stock-simulation'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Props = {
  /** Stock dimensions and resolution for the voxel grid. */
  stockConfig: StockSimulationConfig
  /** Parsed toolpath segments from G-code. */
  segments: ToolpathSegment3[]
  /** Tool diameter in mm. */
  toolDiameter: number
  /** Tool shape for simulation. Default 'flat'. */
  toolShape?: 'flat' | 'ball'
  /** Z floor for gouge detection (mm). Optional. */
  gougeFloorZ?: number
  /** Whether to show the overlay. */
  visible?: boolean
}

// ---------------------------------------------------------------------------
// Mesh sub-component (inside Canvas/R3F tree)
// ---------------------------------------------------------------------------

const StockMesh = memo(function StockMesh({
  meshData
}: {
  meshData: StockMeshData
}) {
  const geometryRef = useRef<THREE.BufferGeometry | null>(null)

  const geometry = useMemo(() => {
    if (meshData.triangleCount === 0) return null
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(meshData.positions, 3))
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(meshData.normals, 3))
    return geo
  }, [meshData])

  useEffect(() => {
    return () => {
      geometryRef.current?.dispose()
    }
  }, [])

  useEffect(() => {
    geometryRef.current?.dispose()
    geometryRef.current = geometry
  }, [geometry])

  if (!geometry) return null

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        color="#3b82f6"
        transparent
        opacity={0.35}
        side={THREE.DoubleSide}
        depthWrite={false}
        metalness={0.05}
        roughness={0.6}
      />
    </mesh>
  )
})

// ---------------------------------------------------------------------------
// Gouge markers
// ---------------------------------------------------------------------------

const GougeMarkers = memo(function GougeMarkers({
  gouges
}: {
  gouges: ReadonlyArray<GougeFinding>
}) {
  if (gouges.length === 0) return null
  return (
    <group>
      {gouges.map((g, i) => (
        <mesh key={i} position={[g.x, g.y, g.z]}>
          <sphereGeometry args={[Math.max(0.5, g.depthMm * 0.5), 12, 12]} />
          <meshStandardMaterial
            color="#ef4444"
            emissive="#7f1d1d"
            emissiveIntensity={0.5}
            transparent
            opacity={0.7}
          />
        </mesh>
      ))}
    </group>
  )
})

// ---------------------------------------------------------------------------
// HUD overlay (scrubbing slider + stats)
// ---------------------------------------------------------------------------

const SimulationHud = memo(function SimulationHud({
  progress,
  onProgressChange,
  stats,
  gougeCount
}: {
  progress: number
  onProgressChange: (pct: number) => void
  stats: StockSimulationStats
  gougeCount: number
}) {
  const handleSlider = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onProgressChange(Number(e.target.value))
    },
    [onProgressChange]
  )

  const removedPct = (stats.materialRemovedFraction * 100).toFixed(1)
  const cycleMin = (stats.estimatedCycleTimeSeconds / 60).toFixed(1)

  return (
    <div className="stock-sim__hud" role="group" aria-label="Stock simulation controls">
      <div className="stock-sim__slider-row">
        <label className="stock-sim__label" htmlFor="stock-sim-progress">
          Progress
        </label>
        <input
          id="stock-sim-progress"
          type="range"
          className="stock-sim__slider"
          min={0}
          max={100}
          step={1}
          value={progress}
          onChange={handleSlider}
          aria-label="Toolpath progress"
        />
        <span className="stock-sim__pct">{progress}%</span>
      </div>
      <div className="stock-sim__stats">
        <span className="stock-sim__stat" title="Material removed">
          Removed: {removedPct}%
        </span>
        <span className="stock-sim__stat" title="Estimated cycle time">
          ~{cycleMin} min
        </span>
        <span className="stock-sim__stat" title="Voxel count">
          {stats.voxelCount.toLocaleString()} voxels
        </span>
        {gougeCount > 0 && (
          <span className="stock-sim__stat stock-sim__stat--gouge" title="Gouge warnings">
            {gougeCount} gouge{gougeCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      <div className="stock-sim__legend">
        <span className="stock-sim__legend-item">
          <span className="stock-sim__swatch stock-sim__swatch--stock" />
          Remaining
        </span>
        {gougeCount > 0 && (
          <span className="stock-sim__legend-item">
            <span className="stock-sim__swatch stock-sim__swatch--gouge" />
            Gouge
          </span>
        )}
      </div>
    </div>
  )
})

// ---------------------------------------------------------------------------
// Main overlay component
// ---------------------------------------------------------------------------

/**
 * Stock simulation overlay — drop this inside a Three.js `<Canvas>` to
 * render the voxel simulation. The HUD is rendered as a sibling HTML element
 * outside the canvas (see usage note below).
 *
 * Usage:
 *   The 3D mesh parts (`StockSimulationScene`) go inside `<Canvas>`.
 *   The HUD (`StockSimulationHud`) is an HTML div placed alongside.
 *   Both are exported separately so the parent can compose them correctly.
 */

export function useStockSimulation(
  stockConfig: StockSimulationConfig | null,
  segments: ToolpathSegment3[],
  toolDiameter: number,
  options?: {
    toolShape?: 'flat' | 'ball'
    gougeFloorZ?: number
  }
): {
  meshData: StockMeshData | null
  gouges: ReadonlyArray<GougeFinding>
  stats: StockSimulationStats | null
  progress: number
  setProgress: (pct: number) => void
} {
  const [progress, setProgress] = useState(100)
  const simulatorRef = useRef<StockSimulator | null>(null)

  const result = useMemo(() => {
    if (!stockConfig || segments.length === 0 || toolDiameter <= 0) {
      return { meshData: null, gouges: [] as GougeFinding[], stats: null }
    }

    let sim = simulatorRef.current
    if (!sim) {
      sim = new StockSimulator()
      simulatorRef.current = sim
    }

    try {
      sim.initializeStock(stockConfig)
      sim.applyToolpath(segments, toolDiameter, {
        toolShape: options?.toolShape,
        progressFraction: progress / 100,
        gougeFloorZ: options?.gougeFloorZ
      })

      return {
        meshData: sim.getRemovalMesh(),
        gouges: sim.getGouges(),
        stats: sim.getStats()
      }
    } catch {
      return { meshData: null, gouges: [] as GougeFinding[], stats: null }
    }
  }, [stockConfig, segments, toolDiameter, options?.toolShape, options?.gougeFloorZ, progress])

  return {
    ...result,
    progress,
    setProgress
  }
}

/**
 * 3D scene elements for stock simulation — place inside `<Canvas>`.
 */
export const StockSimulationScene = memo(function StockSimulationScene({
  meshData,
  gouges,
  visible = true
}: {
  meshData: StockMeshData | null
  gouges: ReadonlyArray<GougeFinding>
  visible?: boolean
}) {
  if (!visible || !meshData || meshData.triangleCount === 0) return null

  return (
    <group>
      <StockMesh meshData={meshData} />
      <GougeMarkers gouges={gouges} />
    </group>
  )
})

/**
 * HTML HUD for stock simulation — place as sibling to viewport div.
 */
export const StockSimulationHud = memo(function StockSimulationHud({
  stats,
  progress,
  onProgressChange,
  gougeCount,
  visible = true
}: {
  stats: StockSimulationStats | null
  progress: number
  onProgressChange: (pct: number) => void
  gougeCount: number
  visible?: boolean
}) {
  if (!visible || !stats) return null

  return (
    <SimulationHud
      progress={progress}
      onProgressChange={onProgressChange}
      stats={stats}
      gougeCount={gougeCount}
    />
  )
})

/**
 * All-in-one overlay for simple integration.
 * This is a convenience wrapper that handles both scene and HUD.
 * Note: The 3D parts must be rendered inside a Canvas; this component
 * produces only the HTML HUD overlay and must be placed as a sibling
 * to the Canvas, not inside it.
 */
export const StockSimulationOverlay = memo(function StockSimulationOverlay({
  stockConfig,
  segments,
  toolDiameter,
  toolShape,
  gougeFloorZ,
  visible = true
}: Props) {
  const { stats, gouges, progress, setProgress } = useStockSimulation(
    visible ? stockConfig : null,
    segments,
    toolDiameter,
    { toolShape, gougeFloorZ }
  )

  if (!visible) return null

  return (
    <StockSimulationHud
      stats={stats}
      progress={progress}
      onProgressChange={setProgress}
      gougeCount={gouges.length}
      visible={visible}
    />
  )
})
