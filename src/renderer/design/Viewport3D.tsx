import { Canvas, useThree } from '@react-three/fiber'
import { Bounds, GizmoHelper, GizmoViewcube, Grid, OrbitControls } from '@react-three/drei'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { measureMarkerRadiusMmFromGeometry } from './viewport3d-bounds'
import { FdmBuildPlate } from './FdmBuildPlate'
import type { MachineProfile } from '../../shared/machine-schema'
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
import {
  makeEdgeSelection,
  makeFaceSelection,
  makeVertexSelection,
  type Selection,
  type SelectionKind
} from './selection-state'
import {
  triangleToFaceId,
  trianglesForFace
} from './selection-raycast'
import {
  readGeometryPickableEdges,
  type PickableEdge
} from './viewport3d-geometry'

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
  /**
   * CONTROLLED activation of the viewport's built-in point-to-point measure
   * tool (the one the HUD's "Measure" button toggles). When the parent flips
   * this to `true` (e.g. the Design ribbon's `runInspect('ut_measure')`), the
   * tool arms exactly as if the operator clicked the HUD button; flipping it to
   * `false` disarms + clears the in-flight points. Optional + additive — when
   * omitted the tool stays operator-driven (every existing mount is unchanged).
   * The parent should mirror the tool's own state via {@link onMeasureActiveChange}
   * so the HUD button and the ribbon stay in sync.
   */
  measureActive?: boolean
  /** Fires when the built-in measure tool's active state changes (HUD toggle, ESC cancel, or controlled `measureActive`). */
  onMeasureActiveChange?: (active: boolean) => void
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
  /** Active machine profile for FDM build plate visualization. */
  machineProfile?: MachineProfile | null
  /** When true, clicking a face rotates the model to lay that face on the bed. */
  layOnFaceMode?: boolean
  onLayOnFace?: (faceNormal: { x: number; y: number; z: number }) => void
  onCenterOnBed?: () => void
  onSnapToBed?: () => void
  /**
   * Which entity kind a plain (no-modifier) click should pick.
   *
   * - `'face'` (default) — resolves the clicked triangle to a CadQuery
   *   face id via the geometry's `userData.faceIds` parallel array. This
   *   is the kernel-backed pick (`cad.tessellate_with_ids`). FG-5b: when
   *   the geometry also carries the parallel `userData.faceOcctIds` stash,
   *   the `FaceSelection.occtHash` carries the STABLE `"f:<hex>"` handle
   *   the Shell dialog emits as `shell_inward.pickedFaceIds`.
   * - `'edge'` — the edge-fillet / chamfer flow. FG-5: the mesh is
   *   face-tessellated (no per-triangle edge mapping), so the edge pick does
   *   NOT come from the body raycast. Instead `cad.tessellate_with_ids` emits a
   *   per-edge sampled POLYLINE list (`edges`), the geometry carries it on
   *   `userData.pickableEdges`, and the viewport renders one raycastable
   *   `LineSegments` per edge (only in this mode, so they never steal face
   *   clicks). A click near one resolves to its stable `"e:<hex>"` id via
   *   `makeEdgeSelection` → forwarded as `pickedEdgeIds`. A body click in this
   *   mode still routes through `resolveSelectionFromPick`, which correctly
   *   no-ops (no per-triangle edge stash) so clicking the surface selects
   *   nothing.
   * - `'vertex'` — reserved. HONEST LIMITATION: no kernel vertex-id mapping
   *   exists yet, so a body click looks for a `vertexIds` stash and no-ops
   *   cleanly when absent — it never fabricates an id.
   */
  selectionMode?: SelectionKind
  /**
   * CAD V1 Workflow H — entity-selection callback. Fires when the
   * operator left-clicks the solid in plain (no-modifier) mode AND the
   * hit triangle resolves to a face id via the geometry's
   * `userData.faceIds` parallel array.
   *
   * Mutually exclusive with `measureMode`, `projectSketchMode`,
   * `facePickMode`, and `layOnFaceMode` — the parent's viewport
   * reducer ensures only one pick mode is active at a time.
   *
   * Receives a `Selection` value. A face pick is `{ kind: 'face', faceId,
   * occtHash? }` — `occtHash` carries the stable `"f:<hex>"` handle when the
   * geometry has the `faceOcctIds` stash (FG-5b). The wider union is in place
   * so the edge / vertex picks extend the callback without breaking consumers.
   */
  onSelect?: (selection: Selection) => void
  /**
   * Currently-highlighted face id. When non-null, the viewport renders
   * a wire-outline overlay along the boundary triangles of that face
   * so the operator gets clear visual feedback for the active
   * selection.
   *
   * The component looks up triangles from the geometry's
   * `userData.faceIds` array; if no `faceIds` are present (e.g. legacy
   * tessellation), the overlay silently no-ops.
   */
  highlightedFaceId?: number | null
  /**
   * FG-5 · Currently-highlighted edge id (the `EdgeSelection.faceId`, i.e. the
   * polyline ordinal). When set AND the geometry carries the
   * `userData.pickableEdges` stash, the matching edge line renders in the bright
   * selection color so the operator gets clear "this edge is picked" feedback.
   * Silently no-ops when absent (legacy tessellation / no edges).
   */
  highlightedEdgeId?: number | null
}

const HOME_POS: [number, number, number] = [120, 90, 120]

/**
 * Read the `faceIds` parallel array stashed on the geometry's `userData`
 * by `DesignWorkspace` after `cad.tessellate_with_ids`. Defensive — when
 * the array is missing or malformed (legacy `cad.execute_script`-only
 * tessellation), returns `null` so the click handler can short-circuit.
 *
 * Exported for tests; pure (no Three.js dependencies on the value side).
 */
export function readGeometryFaceIds(
  geometry: THREE.BufferGeometry | null | undefined
): readonly number[] | null {
  if (!geometry || !geometry.userData) return null
  const candidate = (geometry.userData as Record<string, unknown>).faceIds
  if (!Array.isArray(candidate)) return null
  // Trust the stash — DesignWorkspace already validated each entry is a
  // finite integer before writing. Cast to readonly for downstream safety.
  return candidate as readonly number[]
}

/**
 * Read an arbitrary parallel numeric-id stash off the geometry's `userData`.
 * Internal helper behind the per-kind readers — defensive (returns `null`
 * on a missing/malformed stash) so callers short-circuit cleanly.
 */
function readGeometryIdStash(
  geometry: THREE.BufferGeometry | null | undefined,
  key: 'edgeIds' | 'vertexIds'
): readonly number[] | null {
  if (!geometry || !geometry.userData) return null
  const candidate = (geometry.userData as Record<string, unknown>)[key]
  if (!Array.isArray(candidate)) return null
  return candidate as readonly number[]
}

/**
 * FG-5b · Read a parallel STABLE-string id stash off the geometry's
 * `userData` (`"f:<hex>"` / `"e:<hex>"` per triangle). Mirrors
 * {@link readGeometryIdStash} but for the string-keyed handles
 * `DesignWorkspace` stashes via `buildViewportGeometry`. Defensive — a
 * missing/malformed stash returns `null` so the pick degrades to id-only.
 */
function readGeometryOcctIdStash(
  geometry: THREE.BufferGeometry | null | undefined,
  key: 'faceOcctIds' | 'edgeOcctIds' | 'vertexOcctIds'
): readonly string[] | null {
  if (!geometry || !geometry.userData) return null
  const candidate = (geometry.userData as Record<string, unknown>)[key]
  if (!Array.isArray(candidate)) return null
  return candidate as readonly string[]
}

/**
 * FG-5b · Read the per-triangle STABLE face-id (`"f:<hex>"`) stash, if the
 * geometry carries one. This is the value `DesignWorkspace` derives from the
 * sidecar's `faceMap` and stashes parallel to the numeric `faceIds`; a face
 * pick carries it up as `FaceSelection.occtHash` so the Shell dialog can emit
 * `shell_inward.pickedFaceIds`. Returns `null` when absent (legacy / assembly
 * tessellation) — the pick still resolves the numeric face id. Exported for
 * tests; pure.
 */
export function readGeometryFaceOcctIds(
  geometry: THREE.BufferGeometry | null | undefined
): readonly string[] | null {
  return readGeometryOcctIdStash(geometry, 'faceOcctIds')
}

/**
 * FG-5b · Resolve a triangle index to a STABLE string id from a parallel
 * occt-id stash. Mirrors {@link triangleToFaceId} (the numeric resolver) but
 * for the `"f:<hex>"` / `"e:<hex>"` handles. Returns `undefined` when the
 * stash is absent or the index is out of range, so the caller can build a
 * Selection with the numeric id only (no fabricated stable id).
 */
function triangleToOcctId(
  triangleIndex: number | undefined | null,
  occtIds: readonly string[] | null
): string | undefined {
  if (occtIds === null) return undefined
  if (triangleIndex === undefined || triangleIndex === null) return undefined
  if (!Number.isInteger(triangleIndex) || triangleIndex < 0) return undefined
  if (triangleIndex >= occtIds.length) return undefined
  const id = occtIds[triangleIndex]
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

/**
 * Read the per-triangle `edgeIds` parallel array, if the geometry carries
 * one. HONEST SEAM: the sidecar's `cad.tessellate_with_ids` does NOT emit
 * edge ids today (only `faceIds` + `faceMap` — see
 * `engines/cad/cadquery_script.py::tessellate_with_face_ids`), so this
 * returns `null` for every geometry the running shell produces. It exists
 * so a future `tessellate_with_edge_ids` surface enables edge picking
 * without touching the viewport's click handler. Exported for tests; pure.
 */
export function readGeometryEdgeIds(
  geometry: THREE.BufferGeometry | null | undefined
): readonly number[] | null {
  return readGeometryIdStash(geometry, 'edgeIds')
}

/**
 * Read the per-triangle `vertexIds` parallel array, if present. Same honest
 * seam as {@link readGeometryEdgeIds} — no kernel vertex-id mapping exists
 * yet, so this returns `null` for every geometry the shell produces today.
 * Exported for tests; pure.
 */
export function readGeometryVertexIds(
  geometry: THREE.BufferGeometry | null | undefined
): readonly number[] | null {
  return readGeometryIdStash(geometry, 'vertexIds')
}

/**
 * Decide which {@link Selection} a plain-click pick should produce, given
 * the active {@link SelectionKind} mode, the geometry, and the resolved
 * triangle index (Three.js `Intersection.faceIndex`). Returns `null` when
 * the click cannot resolve a stable entity id — the click handler then
 * leaves the current selection untouched and does NOT call `onSelect`.
 *
 * Pure (no Three.js event, no React) so the branching is unit-testable in
 * the `node` vitest pool without the R3F reconciler.
 *
 * Honesty contract by mode:
 *   - `'face'`   → maps the triangle to a CadQuery face id via `faceIds`
 *                  (kernel-backed; the real capability today). FG-5b: when
 *                  the geometry ALSO carries the parallel `faceOcctIds`
 *                  stash, the returned `FaceSelection.occtHash` carries the
 *                  STABLE `"f:<hex>"` handle the Shell dialog emits as
 *                  `shell_inward.pickedFaceIds`.
 *   - `'edge'`   → maps via an `edgeIds` stash IF present; the mesh is
 *                  face-tessellated so the sidecar emits NO per-triangle
 *                  edge array today, so this returns `null` (no fabricated
 *                  edge id). FG-5b: when a future per-triangle `edgeIds` +
 *                  parallel `edgeOcctIds` stash lands, the resulting
 *                  `EdgeSelection.occtHash` carries the stable `"e:<hex>"`
 *                  handle Fillet/Chamfer emit as `pickedEdgeIds`.
 *   - `'vertex'` → maps via a `vertexIds` stash IF present; same seam.
 */
export function resolveSelectionFromPick(
  selectionMode: SelectionKind,
  geometry: THREE.BufferGeometry,
  triangleIndex: number | undefined | null
): Selection | null {
  if (selectionMode === 'edge') {
    const edgeIds = readGeometryEdgeIds(geometry)
    if (!edgeIds) return null
    const edgeId = triangleToFaceId(triangleIndex, edgeIds)
    if (edgeId === null) return null
    const occtId = triangleToOcctId(triangleIndex, readGeometryOcctIdStash(geometry, 'edgeOcctIds'))
    return makeEdgeSelection(edgeId, occtId)
  }
  if (selectionMode === 'vertex') {
    const vertexIds = readGeometryVertexIds(geometry)
    if (!vertexIds) return null
    const vertexId = triangleToFaceId(triangleIndex, vertexIds)
    if (vertexId === null) return null
    const occtId = triangleToOcctId(triangleIndex, readGeometryOcctIdStash(geometry, 'vertexOcctIds'))
    return makeVertexSelection(vertexId, occtId)
  }
  // Default + 'face': the kernel-backed face pick.
  const faceIds = readGeometryFaceIds(geometry)
  if (!faceIds) return null
  const faceId = triangleToFaceId(triangleIndex, faceIds)
  if (faceId === null) return null
  const occtId = triangleToOcctId(triangleIndex, readGeometryFaceOcctIds(geometry))
  return makeFaceSelection(faceId, occtId)
}

/**
 * Build a `Float32Array` of triangle-edge segment positions for the
 * highlight overlay. Renders three line segments per triangle (the
 * three edges) so the wire-outline trace runs along every triangle of
 * the picked face. Visually this draws the face boundary plus its
 * interior tessellation edges — perfectly fine for V1 (the operator
 * just needs unambiguous "this face is selected" feedback).
 *
 * Pure — no Three.js objects beyond reading the input geometry. Safe to
 * call with a missing-position BufferGeometry (returns an empty array).
 * Exported for the test pin.
 */
export function buildFaceHighlightSegments(
  geometry: THREE.BufferGeometry,
  triangleIndices: readonly number[],
): Float32Array {
  if (triangleIndices.length === 0) return new Float32Array(0)
  const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!positionAttr) return new Float32Array(0)
  const indexAttr = geometry.index
  // Each triangle contributes 3 line segments × 2 endpoints × 3 floats = 18 floats.
  const out = new Float32Array(triangleIndices.length * 18)
  let cursor = 0
  for (const triIdx of triangleIndices) {
    let i0: number
    let i1: number
    let i2: number
    if (indexAttr) {
      i0 = indexAttr.getX(triIdx * 3)
      i1 = indexAttr.getX(triIdx * 3 + 1)
      i2 = indexAttr.getX(triIdx * 3 + 2)
    } else {
      i0 = triIdx * 3
      i1 = triIdx * 3 + 1
      i2 = triIdx * 3 + 2
    }
    const x0 = positionAttr.getX(i0); const y0 = positionAttr.getY(i0); const z0 = positionAttr.getZ(i0)
    const x1 = positionAttr.getX(i1); const y1 = positionAttr.getY(i1); const z1 = positionAttr.getZ(i1)
    const x2 = positionAttr.getX(i2); const y2 = positionAttr.getY(i2); const z2 = positionAttr.getZ(i2)
    // edge 0 → 1
    out[cursor++] = x0; out[cursor++] = y0; out[cursor++] = z0
    out[cursor++] = x1; out[cursor++] = y1; out[cursor++] = z1
    // edge 1 → 2
    out[cursor++] = x1; out[cursor++] = y1; out[cursor++] = z1
    out[cursor++] = x2; out[cursor++] = y2; out[cursor++] = z2
    // edge 2 → 0
    out[cursor++] = x2; out[cursor++] = y2; out[cursor++] = z2
    out[cursor++] = x0; out[cursor++] = y0; out[cursor++] = z0
  }
  return out
}

/**
 * FG-5 · One selectable edge line. Renders a `THREE.LineSegments` from the
 * polyline's pre-built segment-endpoint buffer and reports an edge pick on
 * click. The line carries its own clickable mesh so Three.js raycasts it
 * directly (no per-triangle edge mapping needed — the mesh is face-tessellated).
 *
 * `onPick` fires only in edge `selectionMode` (the parent gates it). The line's
 * material brightens when `highlighted` so the active pick is unmistakable. A
 * geometry is built per edge and disposed on unmount / when the positions change.
 */
const PickableEdgeLine = memo(function PickableEdgeLine({
  edge,
  highlighted,
  onPick,
  clipPlane
}: {
  edge: PickableEdge
  highlighted: boolean
  onPick: (edge: PickableEdge) => void
  clipPlane?: THREE.Plane | null
}) {
  const clippingPlanes = clipPlane ? [clipPlane] : undefined
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(edge.positions, 3))
    return g
  }, [edge.positions])
  const prevRef = useRef<THREE.BufferGeometry | null>(null)
  useEffect(() => {
    if (prevRef.current && prevRef.current !== geom) prevRef.current.dispose()
    prevRef.current = geom
    return () => {
      geom.dispose()
    }
  }, [geom])

  return (
    <lineSegments
      geometry={geom}
      position={[0, 0, 0]}
      renderOrder={highlighted ? 4 : 3}
      onClick={(e) => {
        e.stopPropagation()
        onPick(edge)
      }}
    >
      <lineBasicMaterial
        color={highlighted ? '#fde047' : '#67e8f9'}
        transparent
        opacity={highlighted ? 0.98 : 0.6}
        depthTest={!highlighted}
        clippingPlanes={clippingPlanes}
      />
    </lineSegments>
  )
})

/**
 * FG-5 · The full set of pickable edges for the active solid. Renders nothing
 * unless edge `selectionMode` is active (face mode keeps the plain decorative
 * `EdgesGeometry` overlay only — these selectable lines would otherwise steal
 * clicks meant for faces). Reads the polylines off the geometry's
 * `userData.pickableEdges` stash; silently renders nothing when absent.
 */
const PickableEdges = memo(function PickableEdges({
  geometry,
  active,
  highlightedEdgeId,
  onPickEdge,
  clipPlane
}: {
  geometry: THREE.BufferGeometry
  active: boolean
  highlightedEdgeId?: number | null
  onPickEdge: (edge: PickableEdge) => void
  clipPlane?: THREE.Plane | null
}) {
  const edges = useMemo(() => readGeometryPickableEdges(geometry), [geometry])
  if (!active || !edges) return null
  return (
    <group data-testid="viewport-3d-pickable-edges">
      {edges.map((edge) => (
        <PickableEdgeLine
          key={edge.occtId}
          edge={edge}
          highlighted={highlightedEdgeId === edge.edgeId}
          onPick={onPickEdge}
          clipPlane={clipPlane}
        />
      ))}
    </group>
  )
})

/**
 * FG-5 · Reactively set the raycaster's Line-pick threshold (world mm) from
 * inside the Canvas. The default Three.js Line threshold is 1 world unit, which
 * is too tight to grab a thin edge on a small part and too loose on a huge one —
 * so we scale it to the model. A zero-render component (only touches the
 * raycaster object) mounted alongside the scene.
 */
function LineRaycastThreshold({ thresholdMm }: { thresholdMm: number }): null {
  const raycaster = useThree((s) => s.raycaster)
  useEffect(() => {
    raycaster.params.Line = { ...(raycaster.params.Line ?? {}), threshold: thresholdMm }
  }, [raycaster, thresholdMm])
  return null
}

/** Geometry is already placed in world space (see `sketchPreviewPlacementMatrix`). */
const Solid = memo(function Solid({
  geometry,
  measureMode,
  onMeasurePoint,
  projectSketchMode,
  onProjectSketchPoint,
  facePickMode,
  onPickFace,
  layOnFaceMode,
  onLayOnFace,
  onSelect,
  selectionMode,
  highlightedFaceId,
  highlightedEdgeId,
  clipPlane
}: {
  geometry: THREE.BufferGeometry
  measureMode?: boolean
  onMeasurePoint?: (p: THREE.Vector3) => void
  projectSketchMode?: boolean
  onProjectSketchPoint?: (p: THREE.Vector3) => void
  facePickMode?: boolean
  onPickFace?: (pick: FacePick) => void
  layOnFaceMode?: boolean
  onLayOnFace?: (faceNormal: { x: number; y: number; z: number }) => void
  onSelect?: (selection: Selection) => void
  selectionMode?: SelectionKind
  highlightedFaceId?: number | null
  highlightedEdgeId?: number | null
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

  /**
   * Build a `BufferGeometry` for the highlight overlay covering every
   * triangle of the highlighted face. Memoized on (geometry, faceId) so
   * orbiting the camera doesn't pay the cost of rebuilding the overlay.
   * Returns `null` when no face is highlighted OR the geometry has no
   * `faceIds` stash.
   */
  const highlightGeom = useMemo(() => {
    if (highlightedFaceId == null) return null
    if (!Number.isFinite(highlightedFaceId)) return null
    const faceIds = readGeometryFaceIds(geometry)
    if (!faceIds) return null
    const triangles = trianglesForFace(highlightedFaceId, faceIds)
    if (triangles.length === 0) return null
    const positions = buildFaceHighlightSegments(geometry, triangles)
    if (positions.length === 0) return null
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    return g
  }, [geometry, highlightedFaceId])
  const prevHighlightRef = useRef<THREE.BufferGeometry | null>(null)
  useEffect(() => {
    if (prevHighlightRef.current && prevHighlightRef.current !== highlightGeom) {
      prevHighlightRef.current.dispose()
    }
    prevHighlightRef.current = highlightGeom
    return () => {
      highlightGeom?.dispose()
    }
  }, [highlightGeom])

  /**
   * FG-5 · An edge line was clicked. Build an `EdgeSelection` carrying the
   * polyline ordinal as `faceId` and the stable `"e:<hex>"` id as `occtHash`
   * (the value the Fillet / Chamfer dialogs forward as `pickedEdgeIds`). Only
   * meaningful in edge `selectionMode`, which is also the only mode in which the
   * `PickableEdges` lines render at all.
   */
  const handleEdgePick = useCallback(
    (edge: PickableEdge): void => {
      if (!onSelect) return
      onSelect(makeEdgeSelection(edge.edgeId, edge.occtId))
    },
    [onSelect],
  )

  const edgePickActive = selectionMode === 'edge' && !!onSelect

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
          if (layOnFaceMode && onLayOnFace) {
            e.stopPropagation()
            const wn = e.face?.normal.clone().transformDirection(e.object.matrixWorld).normalize()
            if (wn && wn.lengthSq() > 1e-8) {
              onLayOnFace({ x: wn.x, y: wn.y, z: wn.z })
            }
            return
          }
          if (facePickMode && onPickFace) {
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
            return
          }
          // CAD V1 Workflow H / FG-5a — plain-click entity selection.
          // Falls through only when no other pick mode owns the click, so
          // the existing measurement / sketch flows keep priority. The
          // selection KIND is driven by `selectionMode` (default 'face');
          // `resolveSelectionFromPick` decides which Selection (if any) to
          // fire. It returns null — leaving the current selection untouched
          // and skipping onSelect — when the click can't resolve a stable
          // id (e.g. edge/vertex mode before the kernel emits those ids).
          if (onSelect) {
            // Three.js event uses `faceIndex` (triangle index) when the
            // geometry has an index attribute, which is what the sidecar
            // emits for tessellate_with_ids.
            const next = resolveSelectionFromPick(selectionMode ?? 'face', geometry, e.faceIndex)
            if (next === null) return
            e.stopPropagation()
            onSelect(next)
          }
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
      {/*
        Selection highlight overlay — a bright wire outline along every
        triangle edge of the currently-picked face. Renders only when
        `highlightedFaceId` is set AND the geometry carries the
        `userData.faceIds` parallel array (gracefully degrades on
        legacy tessellations).
      */}
      {highlightGeom ? (
        <lineSegments
          geometry={highlightGeom}
          position={[0, 0, 0]}
          renderOrder={2}
          data-testid="viewport-3d-selection-highlight"
        >
          <lineBasicMaterial
            color="#fde047"
            transparent
            opacity={0.92}
            depthTest={false}
            clippingPlanes={clippingPlanes}
          />
        </lineSegments>
      ) : null}
      {/*
        FG-5 — pickable edge lines (edge-mode fillet/chamfer). Renders one
        selectable line per topology edge ONLY in edge selectionMode, so the
        lines never steal clicks meant for faces. Reads the polylines off the
        geometry's `userData.pickableEdges` stash; no-ops cleanly when absent.
      */}
      <PickableEdges
        geometry={geometry}
        active={edgePickActive}
        highlightedEdgeId={highlightedEdgeId}
        onPickEdge={handleEdgePick}
        clipPlane={clipPlane}
      />
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
  onNavMode,
  onCenterOnBed,
  onSnapToBed,
  layOnFaceMode,
  onToggleLayOnFace
}: {
  controlsRef: React.RefObject<OrbitControlsImpl | null>
  animRef: React.RefObject<CameraAnimationState>
  navMode: NavMode
  onNavMode: (m: NavMode) => void
  onCenterOnBed?: () => void
  onSnapToBed?: () => void
  layOnFaceMode?: boolean
  onToggleLayOnFace?: () => void
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

      {(onCenterOnBed || onSnapToBed || onToggleLayOnFace) && (
        <div className="viewport-3d__toolstrip" role="toolbar" aria-label="Placement tools">
          {onCenterOnBed && (
            <button type="button" className="viewport-3d__tool-btn" onClick={onCenterOnBed} title="Center on bed" aria-label="Center object on build plate">
              Center
            </button>
          )}
          {onSnapToBed && (
            <button type="button" className="viewport-3d__tool-btn" onClick={onSnapToBed} title="Snap to bed" aria-label="Snap object bottom to build plate">
              Snap
            </button>
          )}
          {onToggleLayOnFace && (
            <button
              type="button"
              className={`viewport-3d__tool-btn${layOnFaceMode ? ' viewport-3d__tool-btn--active' : ''}`}
              onClick={onToggleLayOnFace}
              title="Lay on face — click a face to orient it downward"
              aria-label="Lay on face mode"
              aria-pressed={layOnFaceMode}
            >
              Lay Flat
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function Viewport3D({
  geometry,
  measureMode,
  onMeasurePoint,
  measureActive,
  onMeasureActiveChange,
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
  measureUnit = 'mm',
  machineProfile = null,
  layOnFaceMode: layOnFaceModeExternal,
  onLayOnFace,
  onCenterOnBed,
  onSnapToBed,
  onSelect,
  selectionMode = 'face',
  highlightedFaceId = null,
  highlightedEdgeId = null
}: Props) {
  const disposed = useRef<THREE.BufferGeometry | null>(null)
  const controlsRef = useRef<OrbitControlsImpl | null>(null)
  const animRef = useRef<CameraAnimationState>(createInactiveAnimation())
  const [navMode, setNavMode] = useState<NavMode>('orbit')
  const [layOnFaceInternal, setLayOnFaceInternal] = useState(false)
  const layOnFaceActive = layOnFaceModeExternal ?? layOnFaceInternal

  /* Built-in measurement tool (independent from parent measureMode/measureMarkers). */
  const measureTool = useMeasurementTool(measureUnit)

  /* CONTROLLED measure activation: mirror the parent's `measureActive` prop into
     the tool. Only acts when the prop is defined AND differs from the tool's
     current state, so the operator's own HUD toggle is never fought by a stale
     prop value. */
  const measureSetActive = measureTool.setActive
  useEffect(() => {
    if (measureActive === undefined) return
    if (measureActive !== measureTool.active) {
      measureSetActive(measureActive)
    }
  }, [measureActive, measureTool.active, measureSetActive])

  /* Report the tool's active state back up (HUD toggle, ESC cancel, or the
     controlled prop) so the parent can keep the ribbon/chrome in sync. */
  const notifyMeasureActive = onMeasureActiveChange
  useEffect(() => {
    notifyMeasureActive?.(measureTool.active)
  }, [measureTool.active, notifyMeasureActive])

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

  /**
   * FG-5 · Raycaster line-pick threshold (world mm). Three.js raycasts a line
   * only when the ray passes within this distance, so an operator never has to
   * click a 1-px-wide edge exactly. Scaled to the model (≈ the measure-marker
   * radius) and clamped so it stays a forgiving-but-precise grab band on both
   * tiny Carvera parts and full-sheet Laguna stock.
   */
  const linePickThresholdMm = Math.min(4, Math.max(0.6, measureMarkerRadiusMm * 0.9))

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
        {/* FG-5: scale the Line raycast band to the model so near-edge clicks register. */}
        <LineRaycastThreshold thresholdMm={linePickThresholdMm} />
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
              layOnFaceMode={layOnFaceActive}
              onLayOnFace={onLayOnFace ? (n) => { setLayOnFaceInternal(false); onLayOnFace(n) } : undefined}
              onSelect={onSelect}
              selectionMode={selectionMode}
              highlightedFaceId={highlightedFaceId}
              highlightedEdgeId={highlightedEdgeId}
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
        {machineProfile?.kind === 'fdm' && machineProfile.workAreaMm ? (
          <FdmBuildPlate
            workAreaMm={machineProfile.workAreaMm}
            brand={machineProfile.id === 'creality-k2-plus' ? 'creality' : 'generic'}
            showVolume
          />
        ) : (
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
        )}
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
      <ViewportHud
        controlsRef={controlsRef}
        animRef={animRef}
        navMode={navMode}
        onNavMode={setNavMode}
        onCenterOnBed={onCenterOnBed}
        onSnapToBed={onSnapToBed}
        layOnFaceMode={layOnFaceActive}
        onToggleLayOnFace={onLayOnFace ? () => setLayOnFaceInternal(v => !v) : undefined}
      />
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
