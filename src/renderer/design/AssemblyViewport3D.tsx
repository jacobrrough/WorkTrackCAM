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
 * The renderer's `AssemblyPart` carries only a transform. REAL geometry is threaded
 * in separately as a per-part `descriptors` map (built by the host from the meshes
 * `cad.execute` already returns), resolving each part to one of three tiers
 * (`assembly-viewport-transforms`):
 *   (a) `'mesh'`  — a real triangle mesh (same-session part) → a BufferGeometry.
 *   (b) `'bbox'`  — a true axis-aligned bbox → the shared unit box SCALED to the
 *                   part's real half-extents (real proportions, real center offset).
 *   (c) `'nominal'`— no descriptor → the honest last-resort nominal cube, the SAME
 *                   stand-in the bbox interference check uses (`assembly-render-seam`'s
 *                   `NOMINAL_HALF_EXTENT_MM`), so a visible overlap lines up with a
 *                   reported clash.
 * A triangle budget degrades mesh parts to their bbox tier past the cap. The HUD
 * honestly reports how many parts are schematic (bbox + nominal) vs. real meshes —
 * no silent cap, no pretending a box is a solid.
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

import { memo, useEffect, useMemo, type JSX } from 'react'
import { Canvas } from '@react-three/fiber'
import { GizmoHelper, GizmoViewcube, Grid, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { MotionPoseTransform } from './assembly-motion-playback'
import {
  FALLBACK_BOX_HALF_EXTENT_MM,
  computePartRenderStates,
  summarizeRenderTiers,
  type AssemblyViewportPart,
  type ExplodeConfig,
  type PartColorRole,
  type PartGeometryDescriptor,
  type PartMeshGeometry,
  type PartRenderState,
  type RenderTierSummary
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
 * Shared UNIT-cube geometries (side 1, centred at the origin). A box-tier part
 * (bbox / nominal) reuses these and SCALES them by `2 × half-extent` per axis via
 * the mesh's `scale`, so one BoxGeometry + one EdgesGeometry serves every box
 * instance regardless of proportions — no per-part box geometry allocation, no box
 * disposal churn. Mesh-tier parts get their OWN BufferGeometry (built + disposed
 * per part, below). `three` is import-safe in node; only the R3F `<Canvas>` needs
 * WebGL, so these constants evaluate fine in the node fallback branch too.
 */
const SHARED_BOX_GEOMETRY = new THREE.BoxGeometry(1, 1, 1)
const SHARED_BOX_EDGES = new THREE.EdgesGeometry(SHARED_BOX_GEOMETRY)

/**
 * Build a BufferGeometry from a captured part mesh (tier a). Positions are copied
 * into a fresh `Float32Array` (the descriptor's buffer may be a plain number[]);
 * an index buffer is set when present. Normals are used verbatim when the
 * descriptor carries them, else computed (`computeVertexNormals`) so the standard
 * material lights correctly. The CALLER owns disposal (see {@link PartMesh}).
 */
function buildMeshGeometry(mesh: PartMeshGeometry): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry()
  const positions =
    mesh.positions instanceof Float32Array
      ? mesh.positions
      : Float32Array.from(mesh.positions as ArrayLike<number>)
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  if (mesh.indices && mesh.indices.length >= 3) {
    const idxSrc = mesh.indices as ArrayLike<number>
    // Uint32 is always safe; the small extra cost over Uint16 is worth avoiding a
    // silent overflow on a >65k-vertex part.
    const indices = idxSrc instanceof Uint32Array ? idxSrc : Uint32Array.from(idxSrc)
    geom.setIndex(new THREE.BufferAttribute(indices, 1))
  }
  if (mesh.normals && mesh.normals.length === positions.length) {
    const normals =
      mesh.normals instanceof Float32Array
        ? mesh.normals
        : Float32Array.from(mesh.normals as ArrayLike<number>)
    geom.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  } else {
    geom.computeVertexNormals()
  }
  return geom
}

/**
 * True when an R3F `<Canvas>` can actually mount — i.e. a browser-like
 * environment with `window` + `document`. False under node / SSR (the vitest
 * render-pin pool), where the component falls back to the summary placeholder.
 * Exported so tests can assert the guard directly without a DOM.
 */
export function canMountAssemblyCanvas(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined'
}

/**
 * One drawn part. Memoised so orbiting the camera does not rebuild materials.
 *
 * The OUTER group carries the composed placement matrix (position ∘ rotation ∘
 * explode) — identical for every tier. The INNER group applies the geometry's own
 * LOCAL center offset (a real bbox is rarely centred on the part origin), so a
 * mesh / true-proportion box sits where the real geometry sits WITHOUT touching
 * the tier-independent placement matrix. The drawn primitive then depends on tier:
 *   - `'mesh'`  → a per-part BufferGeometry (built + disposed here).
 *   - box tiers → the SHARED unit box, scaled by `2 × half-extent` per axis.
 */
const PartMesh = memo(function PartMesh({
  state,
  onSelect
}: {
  state: PartRenderState
  onSelect?: (id: string) => void
}): JSX.Element {
  // Clone the placement matrix once per matrix change so R3F owns its own instance
  // (mutating a shared one across frames is unsafe). matrixAutoUpdate off → R3F
  // writes our matrix verbatim.
  const groupMatrix = useMemo(() => state.matrix.clone(), [state.matrix])
  const color = ROLE_COLOR[state.colorRole]
  const emissive = ROLE_EMISSIVE[state.colorRole]
  const highlighted = state.colorRole === 'selected' || state.colorRole === 'clash'
  const geometry = state.geometry
  const [ox, oy, oz] = geometry.centerOffsetMm

  // Mesh tier: build a per-part BufferGeometry and DISPOSE it when the mesh source
  // changes or the part unmounts (part removal). Box tiers reuse the shared box —
  // meshGeometry stays null and there is nothing to dispose.
  const meshGeometry = useMemo<THREE.BufferGeometry | null>(
    () => (geometry.tier === 'mesh' ? buildMeshGeometry(geometry.mesh) : null),
    [geometry]
  )
  useEffect(() => {
    // Cleanup runs on unmount AND before the next effect when meshGeometry changes,
    // so a swapped-in mesh never leaks the prior one.
    return () => {
      meshGeometry?.dispose()
    }
  }, [meshGeometry])

  const onClick = (e: { stopPropagation: () => void }): void => {
    if (!onSelect) return
    e.stopPropagation()
    onSelect(state.id)
  }

  const material = (
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
  )

  return (
    <group matrixAutoUpdate={false} matrix={groupMatrix}>
      <group position={[ox, oy, oz]}>
        {meshGeometry ? (
          // Tier a — real mesh. Vertices are already in the part's LOCAL frame
          // relative to the bbox centre, so the inner-group offset places it
          // correctly; no per-part box scaling.
          <mesh geometry={meshGeometry} onClick={onClick}>
            {material}
          </mesh>
        ) : (
          // Tiers b/c — the shared unit box scaled to the real (or nominal)
          // full extents (2 × half-extent per axis).
          <mesh
            geometry={SHARED_BOX_GEOMETRY}
            scale={[
              geometry.halfExtentsMm[0] * 2,
              geometry.halfExtentsMm[1] * 2,
              geometry.halfExtentsMm[2] * 2
            ]}
            onClick={onClick}
          >
            {material}
          </mesh>
        )}
        {/* Wire outline for box tiers only (CAD convention + a brighter edge on the
            highlighted part). Meshes read their own silhouette, so no box outline. */}
        {!meshGeometry && (
          <lineSegments
            geometry={SHARED_BOX_EDGES}
            scale={[
              geometry.halfExtentsMm[0] * 2,
              geometry.halfExtentsMm[1] * 2,
              geometry.halfExtentsMm[2] * 2
            ]}
            renderOrder={highlighted ? 3 : 1}
          >
            <lineBasicMaterial
              color={highlighted ? '#fde047' : '#e9d5ff'}
              transparent
              opacity={highlighted ? 0.95 : 0.4}
              depthTest={!highlighted}
            />
          </lineSegments>
        )}
      </group>
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
        <PartMesh key={state.id} state={state} onSelect={onSelectPart} />
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
  /**
   * Per-part REAL geometry descriptors, keyed by part id (built by the host from
   * the meshes `cad.execute` already returns — no new IPC). A `'mesh'` descriptor
   * renders a real triangle mesh; a `'bbox'` descriptor renders a true-proportion
   * box; a part with no descriptor draws the nominal cube. Omit / null = every part
   * nominal (identical to the pre-wave-7 schematic). Additive + backward-compatible.
   */
  readonly descriptors?: ReadonlyMap<string, PartGeometryDescriptor> | null
  /**
   * Total mesh-tier triangle budget before parts DEGRADE to their bbox tier
   * (`assembly-viewport-transforms` DEFAULT_TRIANGLE_BUDGET when omitted). Degraded
   * parts are counted in the HUD's honest schematic tally — never silently capped.
   */
  readonly triangleBudget?: number
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
    descriptors,
    triangleBudget,
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
        selectedId: selectedId ?? null,
        descriptors: descriptors ?? null,
        triangleBudget
      }),
    [parts, playbackOverlay, explode, clashIds, selectedId, descriptors, triangleBudget]
  )

  // Honest tier tally for the HUD (mesh vs. schematic = bbox + nominal).
  const tierSummary = useMemo(() => summarizeRenderTiers(renderStates), [renderStates])

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
      <div
        className="design-assembly__viewport-3d-hud"
        data-testid="design-assembly-viewport-3d-hud"
        aria-hidden="true"
      >
        {hudTierLabel(tierSummary)}
      </div>
    </div>
  )
}

/**
 * The honest HUD caption for the resolved tiers. When every part is a real mesh:
 * "Real meshes". When some parts are boxes: "N of M parts schematic" (a
 * budget-degraded mesh is counted as schematic — no silent cap). When every part
 * is a box (the pre-wave-7 case, or no descriptors): "Schematic — N boxes (no
 * per-part mesh)" so the operator is never misled that a box is a solid.
 */
function hudTierLabel(t: RenderTierSummary): string {
  if (t.total === 0) return 'No parts'
  if (t.schematic === 0) return `Real meshes — ${t.mesh} part${t.mesh === 1 ? '' : 's'}`
  if (t.mesh === 0) {
    return `Schematic — ${t.schematic} box${t.schematic === 1 ? '' : 'es'} (no per-part mesh)`
  }
  return `${t.schematic} of ${t.total} parts schematic — ${t.mesh} real mesh${
    t.mesh === 1 ? '' : 'es'
  }`
}

export default AssemblyViewport3D
