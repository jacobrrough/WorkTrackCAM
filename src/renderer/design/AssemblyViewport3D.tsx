/**
 * AssemblyViewport3D — the Assembly workspace's real Three.js / R3F scene.
 *
 * Replaces the node-safe summary PLACEHOLDER that previously filled the
 * AssemblyView's viewport column: parts, poses, interference and motion playback
 * were READ as text rows but never SEEN. This component draws one box per
 * non-suppressed part, placed by the part's 6-DOF pose, so the assembly is
 * finally visible in 3D.
 *
 * ── Honest geometry (read before trusting the render) ─────────────────────────
 * The renderer's `AssemblyPart` carries NO real mesh — only a transform. Parts
 * were added from live design tessellations, but that geometry is NOT retained on
 * the row (the live `handle` is session-only and blank after a reload; the durable
 * `geometrySource` is an identity token, not vertices), and the `tessellateAssembly`
 * bridge returns only a summary (`bodyCount` / `triangleCount` / `stlPath`), not
 * renderable meshes. So every part is drawn as a labelled NOMINAL BOX — the SAME
 * stand-in the bbox interference check uses (`assembly-render-seam`'s
 * `NOMINAL_HALF_EXTENT_MM`), so a visible overlap lines up with a reported clash.
 * This is deliberately labelled in the HUD as a schematic, not a solid preview.
 *
 * ── What it consumes ──────────────────────────────────────────────────────────
 *   - `parts` → one box each (suppressed rows filtered by the caller).
 *   - `playbackOverlay` (wave-2 motion-study contract) → OVERRIDES part transforms
 *     while a study scrubs/plays, so the 3D parts animate.
 *   - `clashIds` → the interfering parts tint with the error role (the bbox check
 *     becomes visible).
 *   - `selectedId` + `onSelectPart` → row ↔ viewport highlight sync (clicking a box
 *     selects its row; a selected row highlights its box).
 *   - `explode` → a view-only 0..1 factor separates parts along the configured axis
 *     (reuses the shared `explodeOffsetMm`; never persisted from here).
 *
 * ── Node safety ───────────────────────────────────────────────────────────────
 * The R3F `<Canvas>` needs `window` / `document` / WebGL, which the project's
 * node-env vitest does NOT provide (mirror of `Viewport3D`, whose tests only
 * exercise pure exports). {@link canMountAssemblyCanvas} gates the mount: in
 * node / SSR it returns false and the component renders the SAME summary
 * placeholder AssemblyView shipped before — preserving the pinned
 * `design-assembly-summary` testid + "Assembly preview" text so every existing
 * render pin stays green. The Canvas subtree is isolated in {@link AssemblyScene}
 * so it is only referenced on the branch that actually mounts.
 */

import { memo, useMemo, type JSX } from 'react'
import { Canvas } from '@react-three/fiber'
import { GizmoHelper, GizmoViewcube, Grid, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { MotionPoseTransform } from './assembly-motion-playback'
import {
  FALLBACK_BOX_HALF_EXTENT_MM,
  computePartRenderStates,
  type AssemblyViewportPart,
  type ExplodeConfig,
  type PartColorRole,
  type PartRenderState
} from './assembly-viewport-transforms'

/** Camera home + fov shared with the design {@link Viewport3D} so both scenes read the same. */
const HOME_POS: [number, number, number] = [120, 90, 120]
const DESIGN_FOV_DEG = 45

/** Orbit dolly range — matches the design viewport's mm envelope. */
const MIN_DISTANCE_MM = 6
const MAX_DISTANCE_MM = 6000

/**
 * Per-role box material colours. Aligned with the app palette: selected → accent
 * blue (`--accent`), clash → error red (`--err`), grounded → a desaturated slate
 * (subtle "fixed in space" cue), default → the design viewport's amethyst so an
 * assembly part reads like a design body. Concrete hex (not CSS vars) because
 * these drive WebGL materials inside the Canvas, where CSS custom properties do
 * not resolve.
 */
const ROLE_COLOR: Record<PartColorRole, string> = {
  clash: '#f87171',
  selected: '#4d8aff',
  grounded: '#64748b',
  default: '#a855f7'
}

/** Per-role emissive accent (kept dim; only selected/clash glow to draw the eye). */
const ROLE_EMISSIVE: Record<PartColorRole, string> = {
  clash: '#7f1d1d',
  selected: '#1e3a8a',
  grounded: '#0b0f16',
  default: '#2a1240'
}

/**
 * Shared unit-cube geometries. Every part draws the SAME nominal box today
 * (`FALLBACK_BOX_HALF_EXTENT_MM` for all half-extents), so one BoxGeometry +
 * one EdgesGeometry serves every instance — no per-part / per-render geometry
 * allocation, no disposal churn. Sized `2 × half-extent` on each axis. These
 * are only constructed on the branch that mounts the Canvas (this module is
 * imported lazily-in-effect terms: the constants evaluate at import, and `three`
 * is import-safe in node — only the R3F `<Canvas>` requires WebGL).
 */
const H = FALLBACK_BOX_HALF_EXTENT_MM
const SHARED_BOX_GEOMETRY = new THREE.BoxGeometry(H * 2, H * 2, H * 2)
const SHARED_BOX_EDGES = new THREE.EdgesGeometry(SHARED_BOX_GEOMETRY)

/**
 * True when an R3F `<Canvas>` can actually mount — i.e. a browser-like
 * environment with `window` + `document`. False under node / SSR (the vitest
 * render-pin pool), where the component falls back to the summary placeholder.
 * Exported so tests can assert the guard directly without a DOM.
 */
export function canMountAssemblyCanvas(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined'
}

/** One drawn part box. Memoised so orbiting the camera does not rebuild materials. */
const PartBox = memo(function PartBox({
  state,
  onSelect
}: {
  state: PartRenderState
  onSelect?: (id: string) => void
}): JSX.Element {
  // The composed world matrix already carries position + rotation; apply it to
  // the group (matrixAutoUpdate off, so R3F writes our matrix verbatim). Clone
  // once per matrix change so R3F owns its own instance (mutating a shared one
  // across frames is unsafe). Every part draws the SAME shared nominal box
  // geometry — the per-part difference is entirely in this matrix.
  const groupMatrix = useMemo(() => state.matrix.clone(), [state.matrix])
  const color = ROLE_COLOR[state.colorRole]
  const emissive = ROLE_EMISSIVE[state.colorRole]
  const highlighted = state.colorRole === 'selected' || state.colorRole === 'clash'
  return (
    <group matrixAutoUpdate={false} matrix={groupMatrix}>
      <mesh
        geometry={SHARED_BOX_GEOMETRY}
        onClick={(e) => {
          if (!onSelect) return
          e.stopPropagation()
          onSelect(state.id)
        }}
      >
        <meshStandardMaterial
          color={color}
          emissive={emissive}
          emissiveIntensity={highlighted ? 0.55 : 0.22}
          metalness={0.1}
          roughness={0.5}
          transparent
          opacity={state.grounded ? 0.62 : 0.9}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Wire outline for shape readability (CAD convention) + a brighter edge on
          the highlighted (selected / clash) part. */}
      <lineSegments geometry={SHARED_BOX_EDGES} renderOrder={highlighted ? 3 : 1}>
        <lineBasicMaterial
          color={highlighted ? '#fde047' : '#e9d5ff'}
          transparent
          opacity={highlighted ? 0.95 : 0.4}
          depthTest={!highlighted}
        />
      </lineSegments>
    </group>
  )
})

/**
 * The Canvas subtree. Split out so the R3F imports are only reached on the branch
 * that mounts (the node fallback never evaluates this element).
 */
function AssemblyScene({
  renderStates,
  onSelectPart
}: {
  renderStates: readonly PartRenderState[]
  onSelectPart?: (id: string) => void
}): JSX.Element {
  return (
    <Canvas
      camera={{ position: HOME_POS, fov: DESIGN_FOV_DEG, near: 0.5, far: 8000 }}
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: 'high-performance', alpha: false }}
    >
      <color attach="background" args={['#0c0612']} />
      <ambientLight intensity={0.4} />
      <hemisphereLight args={['#c4b5fd', '#1a1024', 0.45]} />
      <directionalLight position={[90, 140, 70]} intensity={1.05} />
      <directionalLight position={[-70, 55, -55]} intensity={0.32} color="#e9d5ff" />
      {renderStates.map((state) => (
        <PartBox key={state.id} state={state} onSelect={onSelectPart} />
      ))}
      <Grid
        args={[520, 520]}
        cellSize={10}
        sectionSize={50}
        cellColor="#2a1f38"
        sectionColor="#4c3d63"
        cellThickness={0.6}
        sectionThickness={1.1}
        fadeDistance={300}
        fadeStrength={1.05}
        infiniteGrid
        followCamera
        position={[0, 0, 0]}
      />
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.085}
        rotateSpeed={0.72}
        zoomSpeed={0.8}
        panSpeed={0.88}
        minDistance={MIN_DISTANCE_MM}
        maxDistance={MAX_DISTANCE_MM}
        maxPolarAngle={Math.PI - 0.06}
        minPolarAngle={0}
        screenSpacePanning
      />
      <GizmoHelper alignment="top-right" margin={[72, 72]}>
        <GizmoViewcube
          color="#1a1024"
          textColor="#e8eaf0"
          strokeColor="#3e4260"
          opacity={0.88}
          hoverColor="#3d7eff"
        />
      </GizmoHelper>
    </Canvas>
  )
}

/** Public props for the assembly 3D viewport. */
export interface AssemblyViewport3DProps {
  /** Non-suppressed parts to draw (the caller filters suppressed rows out). */
  readonly parts: readonly AssemblyViewportPart[]
  /**
   * Motion-study playback overlay (wave-2 contract). When present, each part's
   * pose is OVERRIDDEN by the overlay's pose for that id while the study
   * scrubs/plays — so the boxes animate. `null` when no study is active.
   */
  readonly playbackOverlay?: ReadonlyMap<string, MotionPoseTransform> | null
  /** Ids that participate in a reported interference pair — tinted with the error role. */
  readonly clashIds?: ReadonlySet<string> | null
  /** The selected part id (row ↔ viewport sync). */
  readonly selectedId?: string | null
  /** Fired when a box is clicked so the parent can select the matching row. */
  readonly onSelectPart?: (id: string) => void
  /** View-only explode config (axis + step + 0..1 factor). Omit / null = assembled. */
  readonly explode?: ExplodeConfig | null
  // ── Fields used only by the node/SSR summary fallback ──────────────────────
  /** True while the assembly build/tessellation is in flight (fallback caption). */
  readonly busy?: boolean
  /** Triangle/body summary line for the fallback caption, when known. */
  readonly triangleSummary?: string | null
  /** STL path from the last tessellation, surfaced in the fallback. */
  readonly stlPath?: string | null
  /** Count of active mate constraints — surfaced in the fallback caption. */
  readonly mateConstraintCount?: number
  /** True when a playback overlay is active — the fallback notes the preview overlay. */
  readonly playbackActive?: boolean
  /**
   * Test-only escape hatch to FORCE the summary-fallback branch even in a DOM
   * env, so a DOM spec can assert the fallback markup without a real WebGL
   * context. Defaults to undefined (the real guard decides).
   */
  readonly forceFallback?: boolean
}

/**
 * The summary placeholder shown in node/SSR (and when forced). Byte-compatible
 * with the markup AssemblyView shipped before this component existed, so the
 * `design-assembly-summary` render pins hold.
 */
function ViewportSummaryFallback({
  parts,
  busy,
  triangleSummary,
  stlPath,
  mateConstraintCount,
  playbackActive
}: {
  parts: readonly AssemblyViewportPart[]
  busy?: boolean
  triangleSummary?: string | null
  stlPath?: string | null
  mateConstraintCount?: number
  playbackActive?: boolean
}): JSX.Element {
  return (
    <div className="design-assembly__viewport-summary" data-testid="design-assembly-summary">
      <div className="design-assembly__viewport-title">{'▢'} Assembly preview</div>
      <div className="design-assembly__viewport-meta">
        {busy
          ? 'Building assembly…'
          : triangleSummary ?? `${parts.length} part${parts.length === 1 ? '' : 's'}`}
      </div>
      {playbackActive && (
        <div
          className="design-assembly__viewport-playback-note"
          data-testid="design-assembly-playback-note"
        >
          Motion playback — preview overlay, not saved
        </div>
      )}
      {mateConstraintCount !== undefined && mateConstraintCount > 0 && (
        <div className="design-assembly__viewport-mates" data-testid="design-assembly-mate-count">
          {`${mateConstraintCount} mate${mateConstraintCount === 1 ? '' : 's'} positioning parts`}
        </div>
      )}
      {stlPath && (
        <div className="design-assembly__viewport-path" title={stlPath}>
          {stlPath}
        </div>
      )}
    </div>
  )
}

/**
 * The Assembly 3D viewport. Renders the R3F scene in a browser-like environment,
 * and the summary placeholder in node/SSR (or when `forceFallback`). The scene
 * and the fallback share the SAME outer wrapper class so the CSS covers both.
 */
export function AssemblyViewport3D(props: AssemblyViewport3DProps): JSX.Element {
  const {
    parts,
    playbackOverlay,
    clashIds,
    selectedId,
    onSelectPart,
    explode,
    forceFallback
  } = props

  // Resolve render states unconditionally (pure + cheap) so the hook order is
  // stable across the guard branch — the fallback simply ignores them.
  const renderStates = useMemo(
    () =>
      computePartRenderStates(parts, {
        playbackOverlay: playbackOverlay ?? null,
        explode: explode ?? null,
        clashIds: clashIds ?? null,
        selectedId: selectedId ?? null
      }),
    [parts, playbackOverlay, explode, clashIds, selectedId]
  )

  const showFallback = forceFallback === true || !canMountAssemblyCanvas()

  if (showFallback) {
    return (
      <ViewportSummaryFallback
        parts={parts}
        busy={props.busy}
        triangleSummary={props.triangleSummary}
        stlPath={props.stlPath}
        mateConstraintCount={props.mateConstraintCount}
        playbackActive={props.playbackActive}
      />
    )
  }

  return (
    <div className="design-assembly__viewport-3d" data-testid="design-assembly-viewport-3d">
      <AssemblyScene renderStates={renderStates} onSelectPart={onSelectPart} />
      <div className="design-assembly__viewport-3d-hud" aria-hidden="true">
        Schematic — nominal boxes (no per-part mesh)
      </div>
    </div>
  )
}

export default AssemblyViewport3D
