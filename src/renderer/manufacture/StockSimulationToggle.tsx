/**
 * StockSimulationToggle — Integrates the voxel-based stock simulation overlay
 * into the ManufactureCamSimulationPanel viewport.
 *
 * Renders a "Simulation" toggle button plus the StockSimulationHud scrubber
 * when active. The parent feeds stock dimensions and G-code segments; this
 * component owns the StockSimulator lifecycle and progress state.
 *
 * Designed as a standalone component to avoid modifying ManufactureWorkspace
 * or ManufactureCamSimulationPanel directly.
 */

import { memo, useCallback, useMemo, useState } from 'react'
import {
  useStockSimulation,
  StockSimulationScene,
  StockSimulationHud
} from '../design/StockSimulationOverlay'
import type { StockSimulationConfig } from '../../shared/stock-simulation'
import type { ToolpathSegment3 } from '../../shared/cam-gcode-toolpath'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface StockSimulationToggleProps {
  /** Stock box dimensions from the active setup (null = no stock defined). */
  stockBox: { x: number; y: number; z: number } | null
  /** Parsed toolpath segments from G-code. */
  segments: ToolpathSegment3[]
  /** Tool diameter in mm (resolved from the active operation). */
  toolDiameterMm: number
  /** Tool shape for simulation envelope. */
  toolShape?: 'flat' | 'ball'
  /** Z floor for gouge detection (mm). */
  gougeFloorZ?: number
}

// ---------------------------------------------------------------------------
// Voxel resolution for the simulation grid (mm per cell).
// Coarser = faster, finer = more detail. 1.5 mm is a reasonable default for
// interactive scrubbing on typical hobby/prosumer stock sizes.
// ---------------------------------------------------------------------------

const SIM_RESOLUTION_MM = 1.5

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Toggle button + HUD controls for stock simulation.
 *
 * Usage in a parent layout:
 *   - Place `<StockSimulationToggleButton>` alongside other viewport controls
 *   - Place `<StockSimulationSceneLayer>` inside the Three.js `<Canvas>`
 *   - Place `<StockSimulationHudLayer>` as a sibling HTML overlay to the canvas
 *
 * All three sub-components share simulation state via this hook component.
 */
export function useStockSimulationToggle({
  stockBox,
  segments,
  toolDiameterMm,
  toolShape = 'flat',
  gougeFloorZ
}: StockSimulationToggleProps) {
  const [enabled, setEnabled] = useState(false)

  const toggle = useCallback(() => setEnabled((v) => !v), [])

  const stockConfig: StockSimulationConfig | null = useMemo(() => {
    if (!enabled || !stockBox) return null
    return {
      widthMm: stockBox.x,
      heightMm: stockBox.y,
      depthMm: stockBox.z,
      resolutionMm: SIM_RESOLUTION_MM
    }
  }, [enabled, stockBox])

  const { meshData, gouges, stats, progress, setProgress } = useStockSimulation(
    stockConfig,
    segments,
    toolDiameterMm,
    { toolShape, gougeFloorZ }
  )

  const canEnable = stockBox != null && segments.length > 0 && toolDiameterMm > 0

  return {
    enabled,
    toggle,
    canEnable,
    meshData,
    gouges,
    stats,
    progress,
    setProgress
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/**
 * Toggle button for stock simulation — place alongside viewport controls.
 */
export const StockSimulationToggleButton = memo(function StockSimulationToggleButton({
  enabled,
  canEnable,
  onToggle
}: {
  enabled: boolean
  canEnable: boolean
  onToggle: () => void
}) {
  return (
    <label className="chk" title={canEnable ? 'Toggle voxel stock simulation overlay' : 'Requires stock dimensions, toolpath, and tool diameter'}>
      <input
        type="checkbox"
        checked={enabled}
        onChange={onToggle}
        disabled={!canEnable}
      />
      Simulation
    </label>
  )
})

/**
 * 3D scene layer — place inside `<Canvas>` (React Three Fiber tree).
 */
export const StockSimulationSceneLayer = memo(function StockSimulationSceneLayer({
  enabled,
  meshData,
  gouges
}: {
  enabled: boolean
  meshData: ReturnType<typeof useStockSimulationToggle>['meshData']
  gouges: ReturnType<typeof useStockSimulationToggle>['gouges']
}) {
  return <StockSimulationScene meshData={meshData} gouges={gouges} visible={enabled} />
})

/**
 * HTML HUD overlay — place as sibling to viewport canvas div.
 */
export const StockSimulationHudLayer = memo(function StockSimulationHudLayer({
  enabled,
  stats,
  progress,
  onProgressChange,
  gougeCount
}: {
  enabled: boolean
  stats: ReturnType<typeof useStockSimulationToggle>['stats']
  progress: number
  onProgressChange: (pct: number) => void
  gougeCount: number
}) {
  return (
    <StockSimulationHud
      stats={stats}
      progress={progress}
      onProgressChange={onProgressChange}
      gougeCount={gougeCount}
      visible={enabled}
    />
  )
})
