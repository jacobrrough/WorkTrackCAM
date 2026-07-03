import { Canvas, useFrame, useThree } from '@react-three/fiber'
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
  computeFitViewGoal,
  createInactiveZoomAnimation,
  orthoZoomForPerspectiveDistance,
  perspectiveDistanceForOrthoZoom,
  readFitBounds,
  startZoomAnimation,
  tickZoomAnimation,
  MAX_FIT_DISTANCE_MM,
  MIN_FIT_DISTANCE_MM,
  ORTHO_CAMERA_FAR_MM,
  ORTHO_CAMERA_NEAR_MM,
  type ProjectionMode,
  type ZoomAnimationState
} from './viewport3d-camera-fit'
import {
  makeEdgeSelection,
  makeFaceSelection,
  makeVertexSelection,
  type Selection,
  type SelectionKind
} from './selection-state'
import {
  triangleToFaceId,
  trianglesForFace,
  trianglesForFaces
} from './selection-raycast'
import {
  beginBoxDrag,
  boxDragRect,
  computeBoxSelectedFaceIds,
  isBoxDragClick,
  updateBoxDrag,
  type BoxDragState
} from './selection-box'
import {
  shouldOpenViewportContextMenu,
  type RightPointerDownSample,
  type ViewportContextMenuRequest
} from './viewport-context-menu-items'
import {
  readGeometryPickableEdges,
  type PickableEdge
} from './viewport3d-geometry'
import type { CadFaceSignature } from '../../shared/sidecar-protocol'

export type MeasureMarker = { x: number; y: number; z: number }

type FacePick = {
  origin: [number, number, number]
  normal: [number, number, number]
  xAxis: [number, number, number]
}

/**
 * Modifier context for a plain-click entity pick (Workflow H / Phase 2
 * multi-select). `toggle` is `true` for a Ctrl/Cmd-click — the parent runs
 * the membership-toggle transition (`toggleFaceInSelection`) instead of the
 * replace transition, so the operator can build up / prune a face set one
 * click at a time. Plain clicks keep the classic replace behavior.
 */
export interface SelectionPickModifiers {
  readonly toggle: boolean
}

type NavMode = 'orbit' | 'pan' | 'zoom'

/**
 * The camera actions `Viewport3D` exposes through its optional `actionsRef`
 * prop -- the SAME handlers the HUD buttons invoke (fit-to-view, animated
 * standard-view fly-to, perspective/orthographic swap), so external surfaces
 * (the right-click context menu in `DesignWorkspace`) reuse them without
 * duplicating any camera logic.
 */
export interface Viewport3DActions {
  /** Frame the displayed geometry along the current view direction. */
  readonly fitView: () => void
  /** Animated fly-to to a standard view preset (`'iso' | 'top' | ...`). */
  readonly standardView: (preset: StandardView) => void
  /** Toggle perspective <-> orthographic (scale-preserving swap). */
  readonly toggleProjection: () => void
  /** The projection mode currently active. */
  readonly getProjection: () => ProjectionMode
}

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
  onSelect?: (selection: Selection, modifiers?: SelectionPickModifiers) => void
  /**
   * Wave 3n — fires with the raycast intersection's WORLD point (mm) for the
   * exact click that produced an {@link onSelect} face/edge pick. Feeds the
   * shell StatusBar's last-pick X/Y/Z read-out. A per-frame hover raycast was
   * deliberately rejected (too heavy); the honest scope is the LAST PICK.
   * Optional + additive — omitted, nothing changes.
   */
  onPickPoint?: (pointMm: { x: number; y: number; z: number }) => void
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
  /**
   * MULTI-EDGE (wave 4) · ALL currently-selected edge ordinals. When non-empty,
   * EVERY matching edge line renders highlighted (bright accent); takes
   * precedence over the single `highlightedEdgeId` (a single pick yields a
   * one-entry array, so the visual is identical to the classic single-edge
   * path). The mirror of {@link highlightedFaceIds} for the fillet/chamfer
   * multi-edge accumulation flow. No-ops when the geometry has no
   * `pickableEdges` stash.
   */
  highlightedEdgeIds?: readonly number[] | null
  /**
   * WINDOW/BOX SELECT (Phase 2) · ALL currently-selected face ids. When
   * non-empty, the highlight overlay covers EVERY face in the set (union
   * built by `trianglesForFaces`); takes precedence over the single
   * `highlightedFaceId` when both are provided. Gracefully no-ops when the
   * geometry has no `faceIds` stash, exactly like the single prop.
   */
  highlightedFaceIds?: readonly number[] | null
  /**
   * WINDOW/BOX SELECT (Phase 2) · fires on a SHIFT+left-drag release with
   * the face ids whose projected triangle vertices fall inside the drag
   * rectangle (CROSSING semantics — `selection-box.ts`; the hit-test runs
   * ONCE on release, never per-frame). The parent owns the transition
   * (additive union via `addFacesToSelection`). The gesture arms ONLY when
   * this callback is wired AND the plain-click pick mode is `'face'` AND no
   * other click mode (measure / sketch-plane / project / lay-flat) owns the
   * pointer — and the pointerdown is intercepted in the CAPTURE phase
   * before OrbitControls sees it, so camera navigation is never rebound
   * (plain left-drag still orbits; right-drag still pans). Fires only when
   * at least one face is hit — an empty box changes nothing.
   */
  onBoxSelectFaces?: (faceIds: readonly number[]) => void
  /**
   * Fusion-style right-click context menu request. Fired on a right-button
   * RELEASE with negligible pointer travel (<= CONTEXT_MENU_MAX_TRAVEL_PX
   * between the recorded `pointerdown` and the `contextmenu` event, which
   * Chromium fires at release) so OrbitControls right-DRAG panning is never
   * interrupted -- see `viewport-context-menu-items.ts`. Carries the release
   * position in CLIENT px; the parent (`DesignWorkspace`) anchors + renders
   * the menu and owns dispatch. Optional + additive -- when omitted,
   * right-click only suppresses the native browser menu (OrbitControls
   * already claims the gesture for pan).
   */
  onContextMenuRequest?: (request: ViewportContextMenuRequest) => void
  /**
   * Imperative bridge exposing the viewport's EXISTING camera handlers (fit
   * view / animated standard views / projection toggle) -- see
   * {@link Viewport3DActions}. Assigned while mounted; reset to `null` on
   * unmount. Optional + additive.
   */
  actionsRef?: React.MutableRefObject<Viewport3DActions | null>
}

const HOME_POS: [number, number, number] = [120, 90, 120]

/** Perspective vertical fov (deg) -- single source for the Canvas camera AND the ortho/persp scale equivalence. */
const DESIGN_FOV_DEG = 45

/** Orthographic dolly (zoom) range -- the ortho counterpart of the 6-6000 mm perspective dolly range. */
const ORTHO_MIN_ZOOM = 0.05
const ORTHO_MAX_ZOOM = 400

/** Type guard: is the active viewport camera orthographic? */
function isOrthoCamera(cam: THREE.Camera): cam is THREE.OrthographicCamera {
  return (cam as THREE.OrthographicCamera).isOrthographicCamera === true
}

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
 * Tier-2 · Read the per-triangle geometry-invariant FACE-signature stash, if the
 * geometry carries one (`DesignWorkspace` stashes it via `buildViewportGeometry`
 * → `buildFaceSignatures`). A face pick carries the matching entry up as
 * `FaceSelection.signature` so a moved/resized pick can be recovered by
 * `resolvePickedId`. Returns `null` when absent (legacy / pre-Tier-2 / assembly
 * tessellation). Exported for tests; pure.
 */
export function readGeometryFaceSignatures(
  geometry: THREE.BufferGeometry | null | undefined
): ReadonlyArray<CadFaceSignature | undefined> | null {
  if (!geometry || !geometry.userData) return null
  const candidate = (geometry.userData as Record<string, unknown>).faceSignatures
  if (!Array.isArray(candidate)) return null
  return candidate as ReadonlyArray<CadFaceSignature | undefined>
}

/**
 * Tier-2 · Resolve a triangle index to its FACE signature from a parallel
 * signature stash. Mirrors {@link triangleToOcctId}; returns `undefined` when the
 * stash is absent, the index is out of range, or that triangle's face had no
 * signature — so a face pick on a signature-less triangle simply captures none
 * (it still resolves at Tier 1). Pure.
 */
function triangleToFaceSignature(
  triangleIndex: number | undefined | null,
  signatures: ReadonlyArray<CadFaceSignature | undefined> | null
): CadFaceSignature | undefined {
  if (signatures === null) return undefined
  if (triangleIndex === undefined || triangleIndex === null) return undefined
  if (!Number.isInteger(triangleIndex) || triangleIndex < 0) return undefined
  if (triangleIndex >= signatures.length) return undefined
  return signatures[triangleIndex]
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
  // Tier-2: also capture the face's geometry-invariant signature (when stashed)
  // so the picked-face consumers can recover it after a parametric move/resize.
  const signature = triangleToFaceSignature(triangleIndex, readGeometryFaceSignatures(geometry))
  return makeFaceSelection(faceId, occtId, signature)
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
  onPick: (
    edge: PickableEdge,
    pointMm: { x: number; y: number; z: number },
    modifiers: SelectionPickModifiers
  ) => void
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
        // Wave 3n — the raycast point rides along so the parent can report
        // the pick location (StatusBar last-pick read-out). Wave 4 — the
        // Ctrl/Cmd modifier rides along so the parent can TOGGLE this edge's
        // membership in a multi-edge fillet/chamfer set (mirrors the face path).
        onPick(
          edge,
          { x: e.point.x, y: e.point.y, z: e.point.z },
          { toggle: e.ctrlKey || e.metaKey }
        )
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
  highlightedEdgeIds,
  onPickEdge,
  clipPlane
}: {
  geometry: THREE.BufferGeometry
  active: boolean
  highlightedEdgeId?: number | null
  /**
   * MULTI-EDGE (wave 4) · every selected edge ordinal. When non-empty, EVERY
   * matching edge line renders highlighted (bright accent); takes precedence
   * over the single `highlightedEdgeId`. A single pick yields a one-entry set,
   * so the visual is identical to the classic single-edge path.
   */
  highlightedEdgeIds?: readonly number[] | null
  onPickEdge: (
    edge: PickableEdge,
    pointMm: { x: number; y: number; z: number },
    modifiers: SelectionPickModifiers
  ) => void
  clipPlane?: THREE.Plane | null
}) {
  const edges = useMemo(() => readGeometryPickableEdges(geometry), [geometry])
  // Build the highlight set ONCE per render (not per edge): the multi-edge set
  // when provided + non-empty, else the single ordinal, else empty.
  const highlightSet = useMemo(() => {
    if (highlightedEdgeIds && highlightedEdgeIds.length > 0) return new Set(highlightedEdgeIds)
    if (highlightedEdgeId != null && Number.isFinite(highlightedEdgeId)) {
      return new Set<number>([highlightedEdgeId])
    }
    return new Set<number>()
  }, [highlightedEdgeId, highlightedEdgeIds])
  if (!active || !edges) return null
  return (
    <group data-testid="viewport-3d-pickable-edges">
      {edges.map((edge) => (
        <PickableEdgeLine
          key={edge.occtId}
          edge={edge}
          highlighted={highlightSet.has(edge.edgeId)}
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
  onPickPoint,
  selectionMode,
  highlightedFaceId,
  highlightedFaceIds,
  highlightedEdgeId,
  highlightedEdgeIds,
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
  onSelect?: (selection: Selection, modifiers?: SelectionPickModifiers) => void
  /** Wave 3n — world point (mm) of a registered face/edge pick. */
  onPickPoint?: (pointMm: { x: number; y: number; z: number }) => void
  selectionMode?: SelectionKind
  highlightedFaceId?: number | null
  highlightedFaceIds?: readonly number[] | null
  highlightedEdgeId?: number | null
  highlightedEdgeIds?: readonly number[] | null
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
    // WINDOW/BOX SELECT — the multi-face set (when provided and non-empty)
    // takes precedence; otherwise fall back to the classic single-face prop.
    const wanted: readonly number[] =
      highlightedFaceIds && highlightedFaceIds.length > 0
        ? highlightedFaceIds
        : highlightedFaceId != null && Number.isFinite(highlightedFaceId)
          ? [highlightedFaceId]
          : []
    if (wanted.length === 0) return null
    const faceIds = readGeometryFaceIds(geometry)
    if (!faceIds) return null
    const triangles =
      wanted.length === 1
        ? trianglesForFace(wanted[0], faceIds)
        : trianglesForFaces(wanted, faceIds)
    if (triangles.length === 0) return null
    const positions = buildFaceHighlightSegments(geometry, triangles)
    if (positions.length === 0) return null
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    return g
  }, [geometry, highlightedFaceId, highlightedFaceIds])
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
   *
   * Tier-2 · also forwards the edge's geometry-invariant `signature` (when the
   * pickable edge carried one) so the Fillet / Chamfer dialogs can recover the
   * pick through `resolvePickedId` after a parametric MOVE / UNIFORM RESIZE —
   * mirroring the face pick, which already captures its signature.
   */
  const handleEdgePick = useCallback(
    (
      edge: PickableEdge,
      pointMm: { x: number; y: number; z: number },
      modifiers: SelectionPickModifiers
    ): void => {
      if (!onSelect) return
      // Wave 4 — the Ctrl/Cmd modifier rides along so the parent can toggle
      // this edge's membership in a multi-edge fillet/chamfer set (mirrors the
      // face path); a plain click replaces, as before.
      onSelect(makeEdgeSelection(edge.edgeId, edge.occtId, edge.signature), modifiers)
      // Wave 3n — report the pick location only when the pick registered.
      onPickPoint?.(pointMm)
    },
    [onSelect, onPickPoint],
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
            // Phase 2 multi-select: Ctrl/Cmd-click toggles membership in the
            // parent's face set; a plain click keeps the replace behavior.
            onSelect(next, { toggle: e.ctrlKey || e.metaKey })
            // Wave 3n — the resolved pick registered; report its world point.
            onPickPoint?.({ x: e.point.x, y: e.point.y, z: e.point.z })
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
        highlightedEdgeIds={highlightedEdgeIds}
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

/**
 * CameraRig -- zero-render Canvas child that owns the projection swap
 * (perspective <-> orthographic), the orthographic fit-zoom animation, and
 * the HUD-side viewport-size bridge.
 *
 * The swap preserves the view direction AND the apparent scale: entering
 * ortho derives `zoom` from the current perspective distance
 * (`orthoZoomForPerspectiveDistance`); leaving ortho re-derives the
 * distance from the current zoom (`perspectiveDistanceForOrthoZoom`), so
 * the geometry never jumps in size. The default camera is swapped via
 * `set({ camera })` -- drei's `<OrbitControls makeDefault>` reacts by
 * recreating its controls instance with a RESET target, so the previous
 * target is stashed in `pendingTargetRef` and restored inside `useFrame`
 * on the first frame the new controls exist (useFrame runs before the
 * render pass, so there is no one-frame flash).
 */
function CameraRig({
  projection,
  controlsRef,
  zoomAnimRef,
  sizeRef
}: {
  projection: ProjectionMode
  controlsRef: React.RefObject<OrbitControlsImpl | null>
  zoomAnimRef: React.RefObject<ZoomAnimationState>
  sizeRef: React.RefObject<{ width: number; height: number }>
}) {
  const camera = useThree((s) => s.camera)
  const set = useThree((s) => s.set)
  const size = useThree((s) => s.size)
  const orthoCamRef = useRef<THREE.OrthographicCamera | null>(null)
  const perspCamRef = useRef<THREE.PerspectiveCamera | null>(null)
  const pendingTargetRef = useRef<THREE.Vector3 | null>(null)

  /* Bridge the Canvas pixel size out to the HUD's fit-view handler. */
  useEffect(() => {
    sizeRef.current = { width: size.width, height: size.height }
  }, [size, sizeRef])

  useEffect(() => {
    const wantOrtho = projection === 'orthographic'
    if (wantOrtho === isOrthoCamera(camera)) return
    const controls = controlsRef.current
    const target = controls ? controls.target.clone() : new THREE.Vector3()

    if (wantOrtho) {
      const persp = camera as THREE.PerspectiveCamera
      perspCamRef.current = persp
      const distance = Math.max(persp.position.distanceTo(target), 1e-3)
      let ortho = orthoCamRef.current
      if (!ortho) {
        ortho = new THREE.OrthographicCamera()
        orthoCamRef.current = ortho
      }
      /* R3F's resize handler keeps this frustum synced afterwards
         (updateCamera writes +-size/2 for non-manual ortho cameras). */
      ortho.near = ORTHO_CAMERA_NEAR_MM
      ortho.far = ORTHO_CAMERA_FAR_MM
      ortho.left = size.width / -2
      ortho.right = size.width / 2
      ortho.top = size.height / 2
      ortho.bottom = size.height / -2
      ortho.zoom = orthoZoomForPerspectiveDistance(distance, persp.fov, size.height)
      ortho.position.copy(persp.position)
      ortho.up.copy(persp.up)
      ortho.lookAt(target)
      ortho.updateProjectionMatrix()
      pendingTargetRef.current = target
      set({ camera: ortho })
    } else {
      const ortho = camera as THREE.OrthographicCamera
      const persp = perspCamRef.current
      if (!persp) return
      /* Clamp to the OrbitControls dolly range so the controls do not
         snap the camera on the next user interaction. */
      const distance = Math.min(
        MAX_FIT_DISTANCE_MM,
        Math.max(perspectiveDistanceForOrthoZoom(ortho.zoom, persp.fov, size.height), MIN_FIT_DISTANCE_MM)
      )
      const dir = ortho.position.clone().sub(target)
      if (dir.lengthSq() < 1e-10) dir.set(1, 0.75, 1)
      dir.normalize()
      persp.position.copy(target).addScaledVector(dir, distance)
      persp.up.copy(ortho.up)
      persp.lookAt(target)
      persp.aspect = size.width / Math.max(size.height, 1)
      persp.updateProjectionMatrix()
      pendingTargetRef.current = target
      set({ camera: persp })
    }
  }, [projection, camera, controlsRef, set, size])

  useFrame(() => {
    /* Restore the stashed orbit target on the first frame the recreated
       controls exist. */
    const pending = pendingTargetRef.current
    const controls = controlsRef.current
    if (pending && controls) {
      controls.target.copy(pending)
      controls.update()
      pendingTargetRef.current = null
    }
    /* Ortho fit-to-view: apply the animated zoom (position/up/target ride
       the existing CameraAnimator on the same 400 ms smoothstep clock). */
    const zoomState = zoomAnimRef.current
    if (zoomState) {
      const z = tickZoomAnimation(zoomState, performance.now())
      if (z !== null) {
        camera.zoom = z
        camera.updateProjectionMatrix()
      }
    }
  })

  return null
}

function ViewportHud({
  controlsRef,
  animRef,
  navMode,
  onNavMode,
  projection,
  onToggleProjection,
  onFitView,
  onCenterOnBed,
  onSnapToBed,
  layOnFaceMode,
  onToggleLayOnFace
}: {
  controlsRef: React.RefObject<OrbitControlsImpl | null>
  animRef: React.RefObject<CameraAnimationState>
  navMode: NavMode
  onNavMode: (m: NavMode) => void
  projection: ProjectionMode
  onToggleProjection: () => void
  onFitView: () => void
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
        <button
          type="button"
          className="viewport-3d__cube-btn viewport-3d__cube-btn--wide"
          onClick={onFitView}
          title="Fit view"
          aria-label="Fit view"
        >
          FIT
        </button>
        <button
          type="button"
          className={`viewport-3d__cube-btn viewport-3d__cube-btn--wide${projection === 'orthographic' ? ' viewport-3d__cube-btn--active' : ''}`}
          onClick={onToggleProjection}
          title={projection === 'orthographic' ? 'Perspective view' : 'Orthographic view'}
          aria-label={projection === 'orthographic' ? 'Switch to perspective view' : 'Switch to orthographic view'}
          aria-pressed={projection === 'orthographic'}
        >
          {projection === 'orthographic' ? 'ORTHO' : 'PERSP'}
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
  onPickPoint,
  selectionMode = 'face',
  highlightedFaceId = null,
  highlightedFaceIds = null,
  highlightedEdgeId = null,
  highlightedEdgeIds = null,
  onBoxSelectFaces,
  onContextMenuRequest,
  actionsRef
}: Props) {
  const disposed = useRef<THREE.BufferGeometry | null>(null)
  const controlsRef = useRef<OrbitControlsImpl | null>(null)
  const animRef = useRef<CameraAnimationState>(createInactiveAnimation())
  const [navMode, setNavMode] = useState<NavMode>('orbit')
  const [layOnFaceInternal, setLayOnFaceInternal] = useState(false)
  const layOnFaceActive = layOnFaceModeExternal ?? layOnFaceInternal
  const [projection, setProjection] = useState<ProjectionMode>('perspective')
  const zoomAnimRef = useRef<ZoomAnimationState>(createInactiveZoomAnimation())
  /** Canvas pixel size, bridged out of the Canvas by CameraRig for the HUD fit handler. */
  const viewportSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 })

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

  const handleToggleProjection = useCallback(() => {
    setProjection((p) => (p === 'perspective' ? 'orthographic' : 'perspective'))
  }, [])

  /**
   * Fit-to-view (zoom to extents): frame the displayed geometry along the
   * CURRENT view direction -- never a reset to home; an empty scene falls
   * back to the home pose. Works in both projections: the pose animates
   * through the existing CameraAnimationState; in ortho mode the zoom
   * rides the parallel ZoomAnimationState (applied by CameraRig).
   */
  const handleFitView = useCallback(() => {
    const c = controlsRef.current
    if (!c) return
    const cam = c.object as THREE.PerspectiveCamera | THREE.OrthographicCamera
    const orthoActive = isOrthoCamera(cam)
    const { width, height } = viewportSizeRef.current
    const goal = computeFitViewGoal(readFitBounds(stable), cam.position, cam.up, c.target, {
      projection: orthoActive ? 'orthographic' : 'perspective',
      fovDeg: orthoActive ? DESIGN_FOV_DEG : (cam as THREE.PerspectiveCamera).fov,
      aspect: height > 0 ? width / height : 1,
      viewportHeightPx: height,
      homePosition: new THREE.Vector3(HOME_POS[0], HOME_POS[1], HOME_POS[2])
    })
    if (animRef.current) {
      startCameraAnimation(animRef.current, cam.position, cam.up, c.target, goal, 400)
    } else {
      cam.position.copy(goal.position)
      cam.up.copy(goal.up)
      c.target.copy(goal.target)
      cam.lookAt(goal.target)
      c.update()
    }
    if (goal.zoom !== null) {
      startZoomAnimation(zoomAnimRef.current, cam.zoom, goal.zoom, 400)
    }
  }, [stable])

  /* -- Fusion-style right-click context menu (viewport-context-menu-items) --
     OrbitControls owns right-DRAG (pan), so the menu request fires only on a
     right-button release with <= CONTEXT_MENU_MAX_TRAVEL_PX of travel between
     the recorded pointerdown and the contextmenu event (Chromium fires
     `contextmenu` at release). The native menu is always suppressed. */
  const rightDownRef = useRef<RightPointerDownSample | null>(null)
  const handleRootPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button === 2) rightDownRef.current = { x: e.clientX, y: e.clientY }
  }, [])
  const handleRootContextMenu = useCallback(
    (e: React.MouseEvent<HTMLDivElement>): void => {
      e.preventDefault()
      const down = rightDownRef.current
      rightDownRef.current = null
      if (!onContextMenuRequest) return
      if (!shouldOpenViewportContextMenu(down, { x: e.clientX, y: e.clientY })) return
      onContextMenuRequest({ clientX: e.clientX, clientY: e.clientY })
    },
    [onContextMenuRequest]
  )

  /* -- WINDOW/BOX SELECT (Phase 2): SHIFT + left-drag --------------------------
     The pointerdown is intercepted in the CAPTURE phase (before the Canvas --
     and therefore OrbitControls -- receives it) so camera navigation is never
     rebound: plain left-drag still orbits, right-drag still pans, and the box
     only arms under SHIFT while the plain 'face' pick mode owns clicks (never
     while measure / sketch-plane / project / lay-flat modes own the pointer,
     and never on a geometry without the kernel faceIds stash). The pointer is
     captured to the wrapper so moves/release keep flowing during fast drags.
     The face hit-test (projected-vertex CROSSING -- selection-box.ts) runs
     ONCE on release against the live camera, never per-frame. */
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [boxDrag, setBoxDrag] = useState<BoxDragState | null>(null)
  const boxSelectArmed =
    onBoxSelectFaces !== undefined &&
    selectionMode === 'face' &&
    !effectiveMeasureMode &&
    !projectSketchMode &&
    !facePickMode &&
    !layOnFaceActive &&
    stable !== null &&
    readGeometryFaceIds(stable) !== null

  /** Client px -> wrapper-local px (the overlay + hit-test coordinate space). */
  const boxLocalPoint = useCallback((clientX: number, clientY: number): { x: number; y: number } => {
    const rect = rootRef.current?.getBoundingClientRect()
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) }
  }, [])

  const handleBoxPointerDownCapture = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      if (!boxSelectArmed || boxDrag !== null) return
      if (e.button !== 0 || !e.shiftKey) return
      // Only gestures that START on the WebGL canvas qualify -- shift-clicks
      // on the HUD buttons / measure chrome must keep working untouched.
      if (!(e.target instanceof HTMLCanvasElement)) return
      // Claim the gesture BEFORE the Canvas / OrbitControls see the pointerdown.
      e.stopPropagation()
      e.preventDefault()
      if (typeof e.currentTarget.setPointerCapture === 'function') {
        e.currentTarget.setPointerCapture(e.pointerId)
      }
      const p = boxLocalPoint(e.clientX, e.clientY)
      setBoxDrag(beginBoxDrag(e.pointerId, p.x, p.y))
    },
    [boxSelectArmed, boxDrag, boxLocalPoint]
  )

  const handleBoxPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      if (boxDrag === null || e.pointerId !== boxDrag.pointerId) return
      const p = boxLocalPoint(e.clientX, e.clientY)
      setBoxDrag((prev) => (prev === null ? null : updateBoxDrag(prev, p.x, p.y)))
    },
    [boxDrag, boxLocalPoint]
  )

  const handleBoxPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      if (boxDrag === null || e.pointerId !== boxDrag.pointerId) return
      const p = boxLocalPoint(e.clientX, e.clientY)
      const finalState = updateBoxDrag(boxDrag, p.x, p.y)
      setBoxDrag(null)
      if (
        typeof e.currentTarget.hasPointerCapture === 'function' &&
        e.currentTarget.hasPointerCapture(e.pointerId)
      ) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
      // Below-slop travel = a shift+click, not a box -- change nothing.
      if (isBoxDragClick(finalState)) return
      if (!onBoxSelectFaces || stable === null) return
      const faceIds = readGeometryFaceIds(stable)
      if (!faceIds) return
      const camera = controlsRef.current?.object
      if (!camera) return
      const hits = computeBoxSelectedFaceIds(
        stable,
        faceIds,
        camera,
        boxDragRect(finalState),
        viewportSizeRef.current
      )
      // An empty box adds nothing (additive SHIFT convention) -- stay silent.
      if (hits.length > 0) onBoxSelectFaces(hits)
    },
    [boxDrag, boxLocalPoint, onBoxSelectFaces, stable]
  )

  const handleBoxPointerCancel = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      if (boxDrag === null || e.pointerId !== boxDrag.pointerId) return
      setBoxDrag(null)
    },
    [boxDrag]
  )

  /* Imperative camera-action bridge: expose the EXISTING HUD handlers to the
     parent (right-click context menu) -- assigned while mounted, nulled on
     unmount so a stale ref can never drive an unmounted viewport. */
  useEffect(() => {
    if (!actionsRef) return undefined
    actionsRef.current = {
      fitView: handleFitView,
      standardView: (preset: StandardView) => {
        const c = controlsRef.current
        if (c) applyStandardViewAnimated(c, preset, animRef)
      },
      toggleProjection: handleToggleProjection,
      getProjection: () => projection
    }
    return () => {
      actionsRef.current = null
    }
  }, [actionsRef, handleFitView, handleToggleProjection, projection])

  const enableRotate = navMode === 'orbit'
  const enablePan = navMode !== 'zoom'
  const enableZoom = true

  return (
    <div
      ref={rootRef}
      className="viewport-3d"
      role="region"
      aria-label="3D model viewport"
      onPointerDown={handleRootPointerDown}
      onPointerDownCapture={handleBoxPointerDownCapture}
      onPointerMove={handleBoxPointerMove}
      onPointerUp={handleBoxPointerUp}
      onPointerCancel={handleBoxPointerCancel}
      onContextMenu={handleRootContextMenu}
    >
      <Canvas
        camera={{ position: HOME_POS, fov: DESIGN_FOV_DEG, near: 0.5, far: 8000 }}
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
              onPickPoint={onPickPoint}
              selectionMode={selectionMode}
              highlightedFaceId={highlightedFaceId}
              highlightedFaceIds={highlightedFaceIds}
              highlightedEdgeId={highlightedEdgeId}
              highlightedEdgeIds={highlightedEdgeIds}
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
          minDistance={MIN_FIT_DISTANCE_MM}
          maxDistance={MAX_FIT_DISTANCE_MM}
          minZoom={ORTHO_MIN_ZOOM}
          maxZoom={ORTHO_MAX_ZOOM}
          maxPolarAngle={Math.PI - 0.06}
          minPolarAngle={0}
          screenSpacePanning={true}
          enableRotate={enableRotate}
          enablePan={enablePan}
          enableZoom={enableZoom}
        />
        {/* Animated camera fly-to driver (zero-render, runs in useFrame) */}
        <CameraAnimator animRef={animRef} controlsRef={controlsRef} />
        {/* Projection swap (persp <-> ortho) + ortho fit-zoom animation + HUD size bridge */}
        <CameraRig
          projection={projection}
          controlsRef={controlsRef}
          zoomAnimRef={zoomAnimRef}
          sizeRef={viewportSizeRef}
        />
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
      {/*
        WINDOW/BOX SELECT -- the dashed drag rectangle (screen-space overlay).
        Rendered only while an above-slop drag is in flight. Position/size ARE
        the live drag rect, so this is the one place an inline style is
        load-bearing (dynamic geometry); the visual styling (dash, tint,
        z-order) lives in workspace.css under .viewport-3d__box-select.
      */}
      {boxDrag !== null && !isBoxDragClick(boxDrag) ? (
        <div
          className="viewport-3d__box-select"
          data-testid="viewport-3d-box-select"
          aria-hidden="true"
          style={{
            left: `${boxDragRect(boxDrag).minX}px`,
            top: `${boxDragRect(boxDrag).minY}px`,
            width: `${boxDragRect(boxDrag).maxX - boxDragRect(boxDrag).minX}px`,
            height: `${boxDragRect(boxDrag).maxY - boxDragRect(boxDrag).minY}px`
          }}
        />
      ) : null}
      <ViewportHud
        controlsRef={controlsRef}
        animRef={animRef}
        navMode={navMode}
        onNavMode={setNavMode}
        projection={projection}
        onToggleProjection={handleToggleProjection}
        onFitView={handleFitView}
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
