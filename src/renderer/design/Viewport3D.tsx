import { Canvas } from '@react-three/fiber'
import { Bounds, GizmoHelper, GizmoViewcube, Grid, OrbitControls } from '@react-three/drei'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { measureMarkerRadiusMmFromGeometry } from './viewport3d-bounds'
import { Viewport3DDatumPlanes, type SketchDatumId } from './Viewport3DDatumPlanes'
import { Viewport3DMeasurementLabels } from './Viewport3DMeasurementLabels'
import { CameraAnimator } from './Viewport3DCameraAnimator'
import {
  MeasurementToolScene,
  MeasurementToolHud,
  useMeasurementTool,
  type MeasurementUnit
} from './MeasurementTool'
import {
  computeStandardViewGoal,
  createInactiveAnimation,
  startCameraAnimation,
  type CameraAnimationState,
  type StandardView
} from './viewport3d-camera-animate'

export type MeasureMarker = { x: number; y: number; z: number }

type FacePick = {
  origin: [number, number, number]
  normal: [number, number, number]
  xAxis: [number, number, number]
}

type NavMode = 'orbit' | 'pan' | 'zoom'

type Props = {
  geometry: THREE.BufferGeometry | null
  /**
   * 3D pick modes are mutually exclusive in the parent (`DesignWorkspace` viewport reducer):
   * measure (Shift+click), project (plain click), face pick. `Solid` evaluates handlers in that order.
   */
  /** When true, **Shift+click** the solid to pick world points (see `onMeasurePoint`). */
  measureMode?: boolean
  onMeasurePoint?: (p: THREE.Vector3) => void
  /** When true, plain click on the solid reports a world point for sketch **Project** (see `onProjectSketchPoint`). */
  projectSketchMode?: boolean
  onProjectSketchPoint?: (p: THREE.Vector3) => void
  /** When true, plain click picks a model face for sketch placement. */
  facePickMode?: boolean
  onPickFace?: (pick: FacePick) => void
  measureMarkers?: MeasureMarker[]
  /** World Y (mm) — clip geometry below this plane when `sectionClipY` is finite. */
  sectionClipY?: number | null
  /** Sketch tab + model phase: allow clicking tinted datum planes (with solid / measure / face pick off). */
  datumPlanePickMode?: boolean
  sketchPlaneIsFace?: boolean
  activeDatum?: SketchDatumId | null
  onDatumPlaneSelect?: (d: SketchDatumId) => void
  /** Unit system for the built-in measurement tool (default: 'mm'). */
  measureUnit?: MeasurementUnit
}

const HOME_POS: [number, number, number] = [120, 90, 120]

/** Geometry is already placed in world space (see `sketchPreviewPlacementMatrix`). */
const Solid = memo(function Solid({
  geometry,
  measureMode,
  onMeasurePoint,
  projectSketchMode,
  onProjectSketchPoint,
  facePickMode,
  onPickFace,
  clipPlane
}: {
  geometry: THREE.BufferGeometry
  measureMode?: boolean
  onMeasurePoint?: (p: THREE.Vector3) => void
  projectSketchMode?: boolean
  onProjectSketchPoint?: (p: THREE.Vector3) => void
  facePickMode?: boolean
  onPickFace?: (pick: FacePick) => void
  clipPlane?: THREE.Plane | null
}) {
  const clippingPlanes = clipPlane ? [clipPlane] : undefined

  /* Memoize the expensive EdgesGeometry computation so it is only rebuilt when
     the source geometry changes, not on every render of Solid.  Dispose the
     previous one when the dependency changes or on unmount. */
  const edgesGeom = useMemo(() => new THREE.EdgesGeometry(geometry, 15), [geometry])
  const prevEdgesRef = useRef<THREE.EdgesGeometry | null>(null)
  useEffect(() => {
    if (prevEdgesRef.current && prevEdgesRef.current !== edgesGeom) {
      prevEdgesRef.current.dispose()
    }
    prevEdgesRef.current = edgesGeom
    return () => {
      edgesGeom.dispose()
    }
  }, [edgesGeom])

  return (
    <group>
      <mesh geometry={geometry} position={[0, 0, 0]}
        onClick={(e) => {
          if (measureMode && onMeasurePoint) {
            if (!e.shiftKey) return
            e.stopPropagation()
            onMeasurePoint(e.point.clone())
            return
          }
          if (projectSketchMode && onProjectSketchPoint) {
            e.stopPropagation()
            onProjectSketchPoint(e.point.clone())
            return
          }
          if (!facePickMode || !onPickFace) return
          e.stopPropagation()
          const worldNormal = e.face?.normal.clone().transformDirection(e.object.matrixWorld).normalize()
          if (!worldNormal || worldNormal.lengthSq() < 1e-8) return
          let xAxis = new THREE.Vector3(1, 0, 0)
          if (Math.abs(worldNormal.dot(xAxis)) > 0.97) xAxis.set(0, 1, 0)
          xAxis.addScaledVector(worldNormal, -xAxis.dot(worldNormal)).normalize()
          if (xAxis.lengthSq() < 1e-8) xAxis.set(0, 0, 1)
          onPickFace({
            origin: [e.point.x, e.point.y, e.point.z],
            normal: [worldNormal.x, worldNormal.y, worldNormal.z],
            xAxis: [xAxis.x, xAxis.y, xAxis.z]
          })
        }}
      >
        <meshStandardMaterial
          color="#a855f7"
          metalness={0.12}
          roughness={0.42}
          side={THREE.DoubleSide}
          clippingPlanes={clippingPlanes}
          clipShadows={!!clipPlane}
        />
      </mesh>
      {/* Edge overlay — improves shape readability on complex geometry (CAD convention) */}
      <lineSegments geometry={edgesGeom} position={[0, 0, 0]} renderOrder={1}>
        <lineBasicMaterial
          color="#e9d5ff"
          transparent
          opacity={0.38}
          clippingPlanes={clippingPlanes}
        />
      </lineSegments>
    </group>
  )
})

const Markers = memo(function Markers({ markers, radiusMm }: { markers: MeasureMarker[]; radiusMm: number }) {
  /* Share one SphereGeometry across all marker meshes to avoid redundant GPU
     uploads.  Dispose the previous when radiusMm changes or on unmount. */
  const sphereGeom = useMemo(() => new THREE.SphereGeometry(radiusMm, 16, 16), [radiusMm])
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

  /* Share a single material instance across all marker meshes. */
  const markerMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#fbbf24',
        emissive: '#78350f',
        emissiveIntensity: 0.35
      }),
    []
  )
  useEffect(() => {
    return () => {
      markerMat.dispose()
    }
  }, [markerMat])

  return (
    <group>
      {markers.map((m, i) => (
        <mesh key={i} position={[m.x, m.y, m.z]} geometry={sphereGeom} material={markerMat} />
      ))}
    </group>
  )
})

/**
 * WCS origin triad — three colored arrows at the world origin showing the
 * X (red), Y (green), Z (blue) axes.  Matches the datum-plane color convention
 * (YZ=orange/red, XZ=green, XY=blue) but uses simpler R/G/B for axes.
 * `sizeMm` is scaled to the model so it stays legible without overwhelming the scene.
 */
const WcsTriad = memo(function WcsTriad({ sizeMm }: { sizeMm: number }) {
  const arrowX = useMemo(
    () =>
      new THREE.ArrowHelper(
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(0, 0, 0),
        sizeMm,
        0xe74c3c,       // red — X axis
        sizeMm * 0.22,
        sizeMm * 0.14
      ),
    [sizeMm]
  )
  const arrowY = useMemo(
    () =>
      new THREE.ArrowHelper(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(0, 0, 0),
        sizeMm,
        0x2ecc71,       // green — Y axis (up in Three.js convention)
        sizeMm * 0.22,
        sizeMm * 0.14
      ),
    [sizeMm]
  )
  const arrowZ = useMemo(
    () =>
      new THREE.ArrowHelper(
        new THREE.Vector3(0, 0, 1),
        new THREE.Vector3(0, 0, 0),
        sizeMm,
        0x3d7eff,       // blue — Z axis
        sizeMm * 0.22,
        sizeMm * 0.14
      ),
    [sizeMm]
  )

  /* Dispose ArrowHelper sub-geometries/materials when sizeMm changes or on unmount. */
  useEffect(() => {
    return () => {
      arrowX.dispose()
      arrowY.dispose()
      arrowZ.dispose()
    }
  }, [arrowX, arrowY, arrowZ])

  return (
    <group>
      <primitive object={arrowX} />
      <primitive object={arrowY} />
      <primitive object={arrowZ} />
    </group>
  )
})

/**
 * Instantly snap the camera to a standard view (no animation).
 * Used by tests and as fallback when no animation ref is available.
 */
export function applyStandardView(controls: OrbitControlsImpl, preset: 'top' | 'front' | 'back' | 'right' | 'left' | 'bottom' | 'iso') {
  const cam = controls.object as THREE.PerspectiveCamera
  const goal = computeStandardViewGoal(cam.position, controls.target, preset as StandardView)

  cam.position.copy(goal.position)
  cam.up.copy(goal.up)
  controls.target.copy(goal.target)
  cam.lookAt(goal.target)
  controls.update()
}

/**
 * Start an animated fly-to transition toward a standard view.
 * Falls back to instant snap if animRef is null.
 */
export function applyStandardViewAnimated(
  controls: OrbitControlsImpl,
  preset: StandardView,
  animRef: React.RefObject<CameraAnimationState> | null,
  durationMs: number = 400
): void {
  const cam = controls.object as THREE.PerspectiveCamera
  const goal = computeStandardViewGoal(cam.position, controls.target, preset)

  if (!animRef?.current) {
    // Fallback to instant snap
    cam.position.copy(goal.position)
    cam.up.copy(goal.up)
    controls.target.copy(goal.target)
    cam.lookAt(goal.target)
    controls.update()
    return
  }

  startCameraAnimation(
    animRef.current,
    cam.position,
    cam.up,
    controls.target,
    goal,
    durationMs
  )
}

function ViewportHud({
  controlsRef,
  animRef,
  navMode,
  onNavMode
}: {
  controlsRef: React.RefObject<OrbitControlsImpl | null>
  animRef: React.RefObject<CameraAnimationState>
  navMode: NavMode
  onNavMode: (m: NavMode) => void
}) {
  const runAnimated = useCallback(
    (preset: StandardView) => {
      const c = controlsRef.current
      if (c) applyStandardViewAnimated(c, preset, animRef)
    },
    [controlsRef, animRef]
  )

  return (
    <div className="viewport-3d__hud">
      <div className="viewport-3d__viewcube" role="group" aria-label="Standard views">
        <button type="button" className="viewport-3d__cube-btn" onClick={() => runAnimated('iso')} title="Isometric" aria-label="Isometric view">
          ISO
        </button>
        <button type="button" className="viewport-3d__cube-btn" onClick={() => runAnimated('top')} title="Top" aria-label="Top view">
          T
        </button>
        <button type="button" className="viewport-3d__cube-btn" onClick={() => runAnimated('front')} title="Front" aria-label="Front view">
          F
        </button>
        <button type="button" className="viewport-3d__cube-btn" onClick={() => runAnimated('right')} title="Right" aria-label="Right view">
          R
        </button>
        <button
          type="button"
          className="viewport-3d__cube-btn viewport-3d__cube-btn--home"
          onClick={() => {
            const c = controlsRef.current
            if (!c) return
            const cam = c.object as THREE.PerspectiveCamera
            const goal = {
              position: new THREE.Vector3(HOME_POS[0], HOME_POS[1], HOME_POS[2]),
              up: new THREE.Vector3(0, 1, 0),
              target: new THREE.Vector3(0, 0, 0)
            }
            if (animRef.current) {
              startCameraAnimation(animRef.current, cam.position, cam.up, c.target, goal, 400)
            } else {
              cam.position.set(HOME_POS[0], HOME_POS[1], HOME_POS[2])
              c.target.set(0, 0, 0)
              cam.up.set(0, 1, 0)
              c.update()
            }
          }}
          title="Home view"
          aria-label="Reset to home view"
        >
          &#8962;
        </button>
      </div>

      <div className="viewport-3d__navstrip" role="toolbar" aria-label="Viewport navigation">
        <button
          type="button"
          className={`viewport-3d__nav-btn${navMode === 'orbit' ? ' viewport-3d__nav-btn--active' : ''}`}
          onClick={() => onNavMode('orbit')}
          title="Orbit (rotate)"
          aria-label="Orbit navigation mode"
          aria-pressed={navMode === 'orbit'}
        >
          Orbit
        </button>
        <button
          type="button"
          className={`viewport-3d__nav-btn${navMode === 'pan' ? ' viewport-3d__nav-btn--active' : ''}`}
          onClick={() => onNavMode('pan')}
          title="Pan"
          aria-label="Pan navigation mode"
          aria-pressed={navMode === 'pan'}
        >
          Pan
        </button>
        <button
          type="button"
          className={`viewport-3d__nav-btn${navMode === 'zoom' ? ' viewport-3d__nav-btn--active' : ''}`}
          onClick={() => onNavMode('zoom')}
          title="Zoom only"
          aria-label="Zoom navigation mode"
          aria-pressed={navMode === 'zoom'}
        >
          Zoom
        </button>
      </div>
    </div>
  )
}

export function Viewport3D({
  geometry,
  measureMode,
  onMeasurePoint,
  projectSketchMode,
  onProjectSketchPoint,
  facePickMode,
  onPickFace,
  measureMarkers,
  sectionClipY,
  datumPlanePickMode = false,
  sketchPlaneIsFace = false,
  activeDatum = null,
  onDatumPlaneSelect,
  measureUnit = 'mm'
}: Props) {
  const disposed = useRef<THREE.BufferGeometry | null>(null)
  const controlsRef = useRef<OrbitControlsImpl | null>(null)
  const animRef = useRef<CameraAnimationState>(createInactiveAnimation())
  const [navMode, setNavMode] = useState<NavMode>('orbit')

  /* Built-in measurement tool (independent from parent measureMode/measureMarkers). */
  const measureTool = useMeasurementTool(measureUnit)

  /**
   * Unified Shift+click handler: feeds the built-in measurement tool AND
   * the external `onMeasurePoint` callback when both are relevant.
   */
  const handleMeasurePoint = useCallback(
    (v: THREE.Vector3) => {
      if (measureTool.active) {
        measureTool.addPoint(v)
      }
      onMeasurePoint?.(v)
    },
    [measureTool, onMeasurePoint]
  )

  /* The Solid's measureMode should be active when EITHER the parent's
     measureMode is on OR the built-in measurement tool is active. */
  const effectiveMeasureMode = measureMode || measureTool.active

  useEffect(() => {
    return () => {
      disposed.current?.dispose()
    }
  }, [])

  const stable = useMemo(() => {
    disposed.current?.dispose()
    disposed.current = geometry
    return geometry
  }, [geometry])

  const clipPlane = useMemo(() => {
    if (sectionClipY == null || !Number.isFinite(sectionClipY)) return null
    return new THREE.Plane(new THREE.Vector3(0, 1, 0), -sectionClipY)
  }, [sectionClipY])

  const clipping = clipPlane != null

  const gridFade = datumPlanePickMode ? 1.12 : clipping ? 0.92 : 1.05
  const gridCell = datumPlanePickMode ? '#1a1220' : clipping ? '#30253c' : '#2a1f38'

  const measureMarkerRadiusMm = useMemo(() => measureMarkerRadiusMmFromGeometry(stable), [stable])

  /** Scale the WCS triad to the model: ~18% of bounding sphere radius, clamped 8–50 mm. */
  const triSizeMm = Math.min(50, Math.max(8, measureMarkerRadiusMm * 12))

  const enableRotate = navMode === 'orbit'
  const enablePan = navMode !== 'zoom'
  const enableZoom = true

  return (
    <div className="viewport-3d" role="region" aria-label="3D model viewport">
      <Canvas
        camera={{ position: HOME_POS, fov: 45, near: 0.5, far: 8000 }}
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: 'high-performance', alpha: false, localClippingEnabled: clipping }}
      >
        <color attach="background" args={['#0c0612']} />
        <ambientLight intensity={0.38} />
        <hemisphereLight args={['#c4b5fd', '#1a1024', 0.45]} />
        <directionalLight position={[90, 140, 70]} intensity={1.05} />
        <directionalLight position={[-70, 55, -55]} intensity={0.32} color="#e9d5ff" />
        {stable ? (
          <Bounds fit clip margin={1.32} maxDuration={0.38} key={stable.uuid}>
            <Solid
              geometry={stable}
              measureMode={effectiveMeasureMode}
              onMeasurePoint={handleMeasurePoint}
              projectSketchMode={projectSketchMode}
              onProjectSketchPoint={onProjectSketchPoint}
              facePickMode={facePickMode}
              onPickFace={onPickFace}
              clipPlane={clipPlane}
            />
          </Bounds>
        ) : null}
        {measureMarkers && measureMarkers.length > 0 ? (
          <Markers markers={measureMarkers} radiusMm={measureMarkerRadiusMm} />
        ) : null}
        {/* Persistent measurement labels with distance annotation (external/parent measure) */}
        {measureMarkers && measureMarkers.length === 2 ? (
          <Viewport3DMeasurementLabels markers={measureMarkers} />
        ) : null}
        {/* Built-in measurement tool scene overlay (markers + line + label) */}
        {measureTool.active && measureTool.points.length > 0 ? (
          <MeasurementToolScene
            points={measureTool.points}
            markerRadiusMm={measureMarkerRadiusMm}
            unit={measureUnit}
          />
        ) : null}
        <Grid
          args={[520, 520]}
          cellSize={10}
          sectionSize={50}
          cellColor={gridCell}
          sectionColor={clipping ? '#8b7aad' : '#4c3d63'}
          cellThickness={0.6}
          sectionThickness={clipping ? 1.42 : 1.1}
          fadeDistance={clipping ? 380 : 300}
          fadeStrength={gridFade}
          infiniteGrid
          followCamera
          position={[0, 0, 0]}
        />
        <Viewport3DDatumPlanes
          halfExtentMm={200}
          datumPlanePickMode={datumPlanePickMode}
          sketchPlaneIsFace={sketchPlaneIsFace}
          activeDatum={activeDatum}
          onDatumPlaneSelect={onDatumPlaneSelect}
        />
        <WcsTriad sizeMm={triSizeMm} />
        <OrbitControls
          ref={controlsRef}
          makeDefault
          enableDamping
          dampingFactor={0.085}
          rotateSpeed={0.72}
          zoomSpeed={0.8}
          panSpeed={0.88}
          minDistance={6}
          maxDistance={6000}
          maxPolarAngle={Math.PI - 0.06}
          minPolarAngle={0}
          screenSpacePanning={true}
          enableRotate={enableRotate}
          enablePan={enablePan}
          enableZoom={enableZoom}
        />
        {/* Animated camera fly-to driver (zero-render, runs in useFrame) */}
        <CameraAnimator animRef={animRef} controlsRef={controlsRef} />
        {/* Interactive 3D orientation cube (Fusion 360 style) — top-right corner */}
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
      <ViewportHud controlsRef={controlsRef} animRef={animRef} navMode={navMode} onNavMode={setNavMode} />
      {/* Measurement tool HUD controls (toggle button + status) */}
      <MeasurementToolHud
        active={measureTool.active}
        onToggle={measureTool.toggle}
        onCancel={measureTool.cancel}
        points={measureTool.points}
        unit={measureUnit}
      />
    </div>
  )
}
