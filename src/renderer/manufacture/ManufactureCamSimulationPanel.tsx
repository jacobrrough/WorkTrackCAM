import { Canvas } from '@react-three/fiber'
import { Bounds, ContactShadows, Grid, Line, OrbitControls } from '@react-three/drei'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as THREE from 'three'
import { buildHeightFieldFromCuttingSegments } from '../../shared/cam-heightfield-2d5'
import { compareToolpathToMachineEnvelope } from '../../shared/cam-machine-envelope'
import {
  apply4AxisCylindricalTransform,
  apply4AxisRadialZToMillPreviewSegments,
  buildContiguousPathChains,
  buildToolpathLengthSampler,
  extractToolpathSegments4AxisFromGcode,
  extractToolpathSegments5AxisFromGcode,
  extractToolpathSegmentsFromGcode,
  isManufactureKind4AxisForPreview,
  isManufactureKind5AxisForPreview,
  resolve4AxisCylinderDiameterMm,
  type ToolpathSegment4,
  type ToolpathSegment5
} from '../../shared/cam-gcode-toolpath'
import {
  buildCylindricalHeightFieldFromSegments,
  type CylindricalHeightField
} from '../../shared/cam-heightfield-cylindrical'
import {
  buildVoxelRemovalFromCuttingSegments,
  VOXEL_SIM_QUALITY_PRESETS,
  type VoxelSimQualityPreset
} from '../../shared/cam-voxel-removal-proxy'
import type { MachineProfile } from '../../shared/machine-schema'
import type { ManufactureFile, ManufactureOperation } from '../../shared/manufacture-schema'
import { resolveCamToolDiameterMm, resolveCamToolStickoutMm, resolveCamToolType } from '../../shared/cam-tool-resolve'
import type { HeightFieldToolShape } from '../../shared/cam-heightfield-2d5'
import {
  stockBoxDimensionsFromPartBounds,
  triangulateBinaryStl,
  type StlAxisAlignedBounds
} from '../../shared/stl-binary-preview'
import type { ToolLibraryFile } from '../../shared/tool-schema'
import {
  useStockSimulationToggle,
  StockSimulationToggleButton,
  StockSimulationSceneLayer,
  StockSimulationHudLayer
} from './StockSimulationToggle'

/** G-code XYZ → Three.js (X, Y_up, Z) with CNC Z vertical as Three Y. Part STL vertices use the same mapping. */
function gcodeToThree(x: number, y: number, z: number): THREE.Vector3Tuple {
  return [x, z, y]
}

function gcodePointKey(p: { x: number; y: number; z: number }): string {
  return `${p.x.toFixed(6)},${p.y.toFixed(6)},${p.z.toFixed(6)}`
}

function dedupeGcodePolyline(points: { x: number; y: number; z: number }[]): { x: number; y: number; z: number }[] {
  if (points.length <= 1) return points
  const out: { x: number; y: number; z: number }[] = [points[0]!]
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!
    if (gcodePointKey(p) !== gcodePointKey(out[out.length - 1]!)) out.push(p)
  }
  return out
}

function chainToTubeGeometry(points: THREE.Vector3[], radius: number): THREE.BufferGeometry | null {
  if (points.length < 2) return null
  const path = new THREE.CurvePath<THREE.Vector3>()
  for (let i = 0; i < points.length - 1; i++) {
    path.add(new THREE.LineCurve3(points[i]!, points[i + 1]!))
  }
  const tubular = Math.min(512, Math.max(8, (points.length - 1) * 4))
  return new THREE.TubeGeometry(path, tubular, radius, 8, false)
}

function ToolpathMeshTubes({
  chains,
  rapidRadiusMm,
  feedRadiusMm
}: {
  chains: ReturnType<typeof buildContiguousPathChains>
  rapidRadiusMm: number
  feedRadiusMm: number
}): ReactNode {
  const items = useMemo(() => {
    const out: { key: string; geometry: THREE.BufferGeometry; kind: 'rapid' | 'feed' }[] = []
    let k = 0
    for (const chain of chains) {
      const deduped = dedupeGcodePolyline(chain.points)
      if (deduped.length < 2) continue
      const pts = deduped.map((p) => new THREE.Vector3(...gcodeToThree(p.x, p.y, p.z)))
      const r = chain.kind === 'rapid' ? rapidRadiusMm : feedRadiusMm
      const geom = chainToTubeGeometry(pts, r)
      if (geom) {
        out.push({ key: `c-${k++}`, geometry: geom, kind: chain.kind })
      }
    }
    return out
  }, [chains, rapidRadiusMm, feedRadiusMm])

  return (
    <group>
      {items.map((item) => {
        const color = item.kind === 'rapid' ? '#fbbf24' : '#22d3ee'
        return (
          <mesh key={item.key} geometry={item.geometry} castShadow>
            <meshStandardMaterial
              color={color}
              metalness={0.42}
              roughness={0.38}
              emissive={color}
              emissiveIntensity={0.12}
            />
          </mesh>
        )
      })}
    </group>
  )
}

/** Progressive toolpath lines — only renders segments up to `visibleCount`. */
function ProgressiveToolpathLines({
  segments,
  visibleCount
}: {
  segments: ReturnType<typeof extractToolpathSegmentsFromGcode>
  visibleCount: number
}): ReactNode {
  const geometry = useMemo(() => {
    const n = Math.min(visibleCount, segments.length)
    if (n === 0) return { rapid: null, feed: null }
    const rapidPts: number[] = []
    const feedPts: number[] = []
    for (let i = 0; i < n; i++) {
      const s = segments[i]!
      const a = gcodeToThree(s.x0, s.y0, s.z0)
      const b = gcodeToThree(s.x1, s.y1, s.z1)
      const arr = s.kind === 'rapid' ? rapidPts : feedPts
      arr.push(a[0], a[1], a[2], b[0], b[1], b[2])
    }
    function makeGeo(pts: number[]): THREE.BufferGeometry | null {
      if (pts.length === 0) return null
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(pts), 3))
      return g
    }
    return { rapid: makeGeo(rapidPts), feed: makeGeo(feedPts) }
  }, [segments, visibleCount])

  return (
    <group>
      {geometry.rapid ? (
        <lineSegments geometry={geometry.rapid}>
          <lineBasicMaterial color="#fbbf24" linewidth={1.25} transparent opacity={0.7} />
        </lineSegments>
      ) : null}
      {geometry.feed ? (
        <lineSegments geometry={geometry.feed}>
          <lineBasicMaterial color="#22d3ee" linewidth={2} />
        </lineSegments>
      ) : null}
    </group>
  )
}

/** Progressive tube toolpath — rebuilds chains from visible segments only. */
function ProgressiveToolpathTubes({
  segments,
  visibleCount,
  rapidRadiusMm,
  feedRadiusMm
}: {
  segments: ReturnType<typeof extractToolpathSegmentsFromGcode>
  visibleCount: number
  rapidRadiusMm: number
  feedRadiusMm: number
}): ReactNode {
  const chains = useMemo(
    () => buildContiguousPathChains(segments.slice(0, visibleCount)),
    [segments, visibleCount]
  )
  return (
    <ToolpathMeshTubes chains={chains} rapidRadiusMm={rapidRadiusMm} feedRadiusMm={feedRadiusMm} />
  )
}

function ToolpathLines({ segments }: { segments: ReturnType<typeof extractToolpathSegmentsFromGcode> }): ReactNode {
  return (
    <group>
      {segments.map((s, i) => {
        const a = gcodeToThree(s.x0, s.y0, s.z0)
        const b = gcodeToThree(s.x1, s.y1, s.z1)
        const color = s.kind === 'rapid' ? '#fbbf24' : '#22d3ee'
        const lw = s.kind === 'rapid' ? 1.25 : 2
        return <Line key={i} points={[a, b]} color={color} lineWidth={lw} />
      })}
    </group>
  )
}

function StockOutlineBox({
  sx,
  sy,
  sz
}: {
  sx: number
  sy: number
  sz: number
}): ReactNode {
  const geo = useMemo(() => new THREE.BoxGeometry(sx, sz, sy), [sx, sy, sz])
  return (
    <group>
      {/* Solid translucent stock */}
      <mesh position={[sx / 2, -sz / 2, sy / 2]} geometry={geo} receiveShadow>
        <meshStandardMaterial
          color="#64748b"
          roughness={0.85}
          metalness={0.05}
          transparent
          opacity={0.18}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Wireframe edges */}
      <mesh position={[sx / 2, -sz / 2, sy / 2]} geometry={geo}>
        <meshBasicMaterial color="#94a3b8" wireframe transparent opacity={0.45} depthWrite={false} />
      </mesh>
    </group>
  )
}

/**
 * Cylindrical stock outline for 4-axis rotary operations.
 * Renders a translucent cylinder aligned along the X axis (rotation axis),
 * matching the G-code convention where X is axial and A rotates around X.
 */
function StockOutlineCylinder({
  diameterMm,
  lengthMm
}: {
  diameterMm: number
  lengthMm: number
}): ReactNode {
  const r = diameterMm / 2
  const geo = useMemo(() => new THREE.CylinderGeometry(r, r, lengthMm, 24), [r, lengthMm])
  // CylinderGeometry axis is Y in Three.js; rotate -90° around Z to align with X (G-code axial)
  return (
    <group position={[lengthMm / 2, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
      {/* Solid translucent stock */}
      <mesh geometry={geo} receiveShadow>
        <meshStandardMaterial
          color="#64748b"
          roughness={0.85}
          metalness={0.05}
          transparent
          opacity={0.18}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Wireframe edges */}
      <mesh geometry={geo}>
        <meshBasicMaterial color="#94a3b8" wireframe transparent opacity={0.45} depthWrite={false} />
      </mesh>
    </group>
  )
}

/**
 * Machine work volume from profile `workAreaMm` — same corner convention as {@link StockOutlineBox}
 * (G-code origin at one corner; box spans 0…wx, 0…wy, 0…wz in X/Y/Z).
 */
function MachineEnvelopeBox({ wx, wy, wz }: { wx: number; wy: number; wz: number }): ReactNode {
  const geo = useMemo(() => new THREE.BoxGeometry(wx, wz, wy), [wx, wy, wz])
  return (
    <mesh position={[wx / 2, -wz / 2, wy / 2]} geometry={geo}>
      <meshBasicMaterial color="#a855f7" wireframe transparent opacity={0.5} depthWrite={false} />
    </mesh>
  )
}

/** Table plane at G-code Z=0 (CNC XY), spanning machine X × Y extent. Maps to Three.js XZ at y_three=0. */
function MachineTablePlane({ wx, wy }: { wx: number; wy: number }): ReactNode {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[wx / 2, 0, wy / 2]} receiveShadow>
      <planeGeometry args={[wx, wy]} />
      <meshStandardMaterial
        color="#475569"
        roughness={0.92}
        metalness={0.08}
        transparent
        opacity={0.45}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

function VoxelCarveSamples({ positions }: { positions: Float32Array }): ReactNode {
  const geometry = useMemo(() => {
    if (positions.length < 3) return null
    const n = positions.length / 3
    const arr = new Float32Array(positions.length)
    for (let i = 0; i < n; i++) {
      const x = positions[i * 3]!
      const y = positions[i * 3 + 1]!
      const z = positions[i * 3 + 2]!
      const t = gcodeToThree(x, y, z)
      arr[i * 3] = t[0]
      arr[i * 3 + 1] = t[1]
      arr[i * 3 + 2] = t[2]
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3))
    return geo
  }, [positions])

  if (!geometry) return null
  return (
    <points geometry={geometry}>
      <pointsMaterial color="#fb923c" size={0.45} sizeAttenuation transparent opacity={0.9} depthWrite={false} />
    </points>
  )
}

function HeightFieldTerrain({ hf }: { hf: ReturnType<typeof buildHeightFieldFromCuttingSegments> }): ReactNode {
  const geometry = useMemo(() => {
    if (!hf) return null
    const { originX, originY, cellMm, cols, rows, topZ, stockTopZ } = hf
    const vx = cols + 1
    const vy = rows + 1
    const positions = new Float32Array(vx * vy * 3)
    const sample = (ci: number, cj: number) => {
      const ii = Math.max(0, Math.min(cols - 1, ci))
      const jj = Math.max(0, Math.min(rows - 1, cj))
      return topZ[jj * cols + ii]!
    }
    for (let j = 0; j < vy; j++) {
      for (let i = 0; i < vx; i++) {
        const zAvg =
          0.25 *
          (sample(i - 1, j - 1) + sample(i, j - 1) + sample(i - 1, j) + sample(i, j))
        const gx = originX + i * cellMm
        const gy = originY + j * cellMm
        const o = (j * vx + i) * 3
        positions[o] = gx
        positions[o + 1] = zAvg
        positions[o + 2] = gy
      }
    }
    const indices: number[] = []
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const a = j * vx + i
        const b = j * vx + i + 1
        const c = (j + 1) * vx + i
        const d = (j + 1) * vx + i + 1
        indices.push(a, c, b, b, c, d)
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setIndex(indices)
    geo.computeVertexNormals()

    let minTop = Infinity
    for (let i = 0; i < topZ.length; i++) minTop = Math.min(minTop, topZ[i]!)

    const colors = new Float32Array(vx * vy * 3)
    const denom = Math.max(1e-6, stockTopZ - minTop)
    for (let j = 0; j < vy; j++) {
      for (let i = 0; i < vx; i++) {
        const o = (j * vx + i) * 3
        const zAvg = positions[o + 1]!
        const t = Math.min(1, Math.max(0, (stockTopZ - zAvg) / denom))
        const c = new THREE.Color().setHSL(0.55 - t * 0.45, 0.65, 0.45)
        colors[o] = c.r
        colors[o + 1] = c.g
        colors[o + 2] = c.b
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    return geo
  }, [hf])

  if (!geometry) return null
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial vertexColors roughness={0.85} metalness={0.05} side={THREE.DoubleSide} transparent opacity={0.88} />
    </mesh>
  )
}

/**
 * Cylindrical heightfield terrain — wraps the (axial X, angular A) → radius grid
 * around the rotation axis to display 4-axis material removal.
 */
function CylindricalHeightFieldTerrain({ hf }: { hf: CylindricalHeightField }): ReactNode {
  const geometry = useMemo(() => {
    if (!hf) return null
    const { originX, cellMm, cellDeg, cols, rows, radii, stockRadius } = hf

    // Vertex grid: (cols+1) axial × (rows+1) angular.
    // The extra angular row wraps back to 0° to close the cylinder.
    const vx = cols + 1
    const vy = rows + 1
    const positions = new Float32Array(vx * vy * 3)

    const sample = (ci: number, ai: number): number => {
      const ii = Math.max(0, Math.min(cols - 1, ci))
      const jj = ((ai % rows) + rows) % rows
      return radii[jj * cols + ii]!
    }

    for (let aj = 0; aj < vy; aj++) {
      for (let xi = 0; xi < vx; xi++) {
        const rAvg =
          0.25 *
          (sample(xi - 1, ((aj - 1) % rows + rows) % rows) +
            sample(xi, ((aj - 1) % rows + rows) % rows) +
            sample(xi - 1, aj % rows) +
            sample(xi, aj % rows))

        const axialPos = originX + xi * cellMm
        const angleRad = (aj * cellDeg * Math.PI) / 180

        // Match cylindrical→Cartesian mapping used by toolpath and stock cylinder:
        //   Three.js X = axial,  Y = r·cos(angle),  Z = r·sin(angle)
        // then gcodeToThree: X→X, Z→Y(up), Y→Z  ⟹ final: X, r·sin, r·cos
        const o = (aj * vx + xi) * 3
        positions[o] = axialPos
        positions[o + 1] = rAvg * Math.sin(angleRad)
        positions[o + 2] = rAvg * Math.cos(angleRad)
      }
    }

    const indices: number[] = []
    for (let aj = 0; aj < rows; aj++) {
      for (let xi = 0; xi < cols; xi++) {
        const a = aj * vx + xi
        const b = aj * vx + xi + 1
        const c = (aj + 1) * vx + xi
        const d = (aj + 1) * vx + xi + 1
        indices.push(a, c, b, b, c, d)
      }
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setIndex(indices)
    geo.computeVertexNormals()

    // Vertex colors — depth-mapped from stock surface inward
    let minRadius = Infinity
    for (let i = 0; i < radii.length; i++) minRadius = Math.min(minRadius, radii[i]!)

    const colors = new Float32Array(vx * vy * 3)
    const denom = Math.max(1e-6, stockRadius - minRadius)
    for (let aj = 0; aj < vy; aj++) {
      for (let xi = 0; xi < vx; xi++) {
        const rAvg =
          0.25 *
          (sample(xi - 1, ((aj - 1) % rows + rows) % rows) +
            sample(xi, ((aj - 1) % rows + rows) % rows) +
            sample(xi - 1, aj % rows) +
            sample(xi, aj % rows))
        const o = (aj * vx + xi) * 3
        const t = Math.min(1, Math.max(0, (stockRadius - rAvg) / denom))
        const c = new THREE.Color().setHSL(0.55 - t * 0.45, 0.65, 0.45)
        colors[o] = c.r
        colors[o + 1] = c.g
        colors[o + 2] = c.b
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))

    return geo
  }, [hf])

  if (!geometry) return null
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial vertexColors roughness={0.85} metalness={0.05} side={THREE.DoubleSide} transparent opacity={0.88} />
    </mesh>
  )
}

function PartStlMesh({ geometry }: { geometry: THREE.BufferGeometry }): ReactNode {
  useEffect(() => {
    return () => geometry.dispose()
  }, [geometry])
  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial
        color="#94a3b8"
        metalness={0.22}
        roughness={0.65}
        transparent
        opacity={0.4}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

/** Endmill tool visualization — cylinder with a rounded tip at the cutting end. */
function PlaybackToolHead({
  position,
  toolDiameter,
  fluteLength,
  rotation
}: {
  position: THREE.Vector3Tuple
  toolDiameter: number
  fluteLength: number
  /** Optional quaternion for non-vertical tool orientation (e.g. 4-axis radial). */
  rotation?: THREE.Quaternion
}): ReactNode {
  const r = toolDiameter * 0.5
  const fl = fluteLength
  const shankLen = fl * 0.6
  return (
    <group position={position} quaternion={rotation}>
      {/* Flute (cutting portion) — cylinder from tip upward */}
      <mesh position={[0, fl * 0.5, 0]} castShadow>
        <cylinderGeometry args={[r, r, fl, 20]} />
        <meshStandardMaterial
          color="#c084fc"
          metalness={0.55}
          roughness={0.3}
          emissive="#7c3aed"
          emissiveIntensity={0.2}
          transparent
          opacity={0.85}
        />
      </mesh>
      {/* Tip — hemisphere at the bottom */}
      <mesh position={[0, 0, 0]} castShadow>
        <sphereGeometry args={[r, 16, 8, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5]} />
        <meshStandardMaterial
          color="#c084fc"
          metalness={0.55}
          roughness={0.3}
          emissive="#7c3aed"
          emissiveIntensity={0.2}
          transparent
          opacity={0.85}
        />
      </mesh>
      {/* Shank (holder portion) — slightly thicker, above the flute */}
      <mesh position={[0, fl + shankLen * 0.5, 0]} castShadow>
        <cylinderGeometry args={[r * 1.25, r * 1.15, shankLen, 16]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.7} roughness={0.25} />
      </mesh>
    </group>
  )
}

function base64ToUint8Array(b64: string): Uint8Array {
  const bin = atob(b64)
  const len = bin.length
  const u8 = new Uint8Array(len)
  for (let i = 0; i < len; i++) u8[i] = bin.charCodeAt(i)
  return u8
}

type Props = {
  projectDir: string
  mfg: ManufactureFile
  tools?: ToolLibraryFile | null
  /** Active CNC machine for work envelope + table preview (G-code vs profile bounds). */
  machine?: MachineProfile
  /** Setup row whose stock drives the preview box (CAM-resolved setup index). */
  stockSetupIndex?: number
  /** Project-relative path to preview in the viewport (e.g. selected op `sourceMesh`). */
  previewMeshRelativePath?: string | null
  /** Operation used for tool-diameter proxy (e.g. selected row). */
  previewOperation?: ManufactureOperation | null
  /** Last **Generate toolpath…** output from the app — syncs the viewer and textarea. */
  camOut?: string
  /** When `workspace`, the 3D canvas is shown first and uses a taller viewport. */
  layout?: 'compact' | 'workspace'
}

const VOXEL_QUALITY_STORAGE_KEY = 'ufs.manufacture.camSim.voxelQuality'

function readStoredVoxelQuality(): VoxelSimQualityPreset {
  try {
    const v = localStorage.getItem(VOXEL_QUALITY_STORAGE_KEY)
    if (v === 'fast' || v === 'balanced' || v === 'detailed') return v
  } catch {
    /* ignore */
  }
  return 'balanced'
}

const TUBE_MAX_SEGMENTS = 10000
const TUBE_MAX_CHAINS = 900
/** Playback speed presets (path fraction per second). */
const SPEED_PRESETS = [
  { label: '0.25x', value: 0.025 },
  { label: '0.5x', value: 0.045 },
  { label: '1x', value: 0.09 },
  { label: '2x', value: 0.18 },
  { label: '5x', value: 0.45 },
  { label: '10x', value: 0.9 }
] as const
/** Height field rebuild interval during playback (ms). */
const HF_REBUILD_INTERVAL_MS = 400
/** Grid resolution cap (cols × rows) for the 2.5D height field preview. */
const HF_PREVIEW_MAX_COLS = 88
const HF_PREVIEW_MAX_ROWS = 88
/** Feed segments at or above this Z are treated as air moves and excluded from the height field. */
const HF_CUTTING_Z_THRESHOLD = 0.08
/** Rebuild throttle: only re-stamp height field when visible segment count advances by this fraction of total. */
const HF_REBUILD_STEP_DIVISOR = 200
/** Minimum scrubber step denominator: gives at least 1/500 resolution on short toolpaths. */
const SCRUBBER_MIN_STEP_DENOM = 500
/** Minimum fluteLength (mm) for the endmill 3D model when no tool record is available. */
const TOOL_MODEL_MIN_FLUTE_LENGTH_MM = 12

export function ManufactureCamSimulationPanel({
  projectDir,
  mfg,
  tools,
  machine,
  stockSetupIndex = 0,
  previewMeshRelativePath = null,
  previewOperation = null,
  camOut = '',
  layout = 'compact'
}: Props): ReactNode {
  const [gcode, setGcode] = useState<string>(() => camOut ?? '')
  const [loadNote, setLoadNote] = useState<string | null>(null)
  const [showRemoval, setShowRemoval] = useState(true)
  const [removalMode, setRemovalMode] = useState<'tier2' | 'tier3'>('tier2')
  const [voxelQuality, setVoxelQuality] = useState<VoxelSimQualityPreset>(() => readStoredVoxelQuality())
  const [pathPreviewMode, setPathPreviewMode] = useState<'rendered' | 'lines'>('rendered')
  const [showPartMesh, setShowPartMesh] = useState(true)
  const [partLoadNote, setPartLoadNote] = useState<string | null>(null)
  const [partBoundsCnc, setPartBoundsCnc] = useState<StlAxisAlignedBounds | null>(null)
  const [partPositionsRaw, setPartPositionsRaw] = useState<Float32Array | null>(null)
  const [playbackU, setPlaybackU] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackSpeed, setPlaybackSpeed] = useState(0.09)
  const [progressiveMode, setProgressiveMode] = useState(true)
  /** 5-axis segments retained for A/B angle lookup during playback. */
  const segs5Ref = useRef<ToolpathSegment5[]>([])
  /** Raw 4-axis segments (before cylindrical→Cartesian transform) for cylindrical heightfield. */
  const segs4Ref = useRef<ToolpathSegment4[]>([])
  /** Last segment index at which the height field was rebuilt. */
  const lastHfRebuildIdx = useRef(-1)
  const lastHfRebuildTime = useRef(0)

  useEffect(() => {
    setGcode(camOut ?? '')
  }, [camOut])

  useEffect(() => {
    try {
      localStorage.setItem(VOXEL_QUALITY_STORAGE_KEY, voxelQuality)
    } catch {
      /* ignore */
    }
  }, [voxelQuality])

  const setupIdx = Math.max(0, Math.min(stockSetupIndex, Math.max(0, mfg.setups.length - 1)))
  const stockDef = mfg.setups[setupIdx]?.stock

  const toolOp =
    previewOperation && !previewOperation.suppressed && previewOperation.kind.startsWith('cnc_')
      ? previewOperation
      : mfg.operations.find((o) => !o.suppressed && o.kind.startsWith('cnc_'))
  const toolDia = useMemo(
    () => resolveCamToolDiameterMm({ operation: toolOp, tools: tools ?? undefined }) ?? 6,
    [toolOp, tools]
  )
  const toolShape: HeightFieldToolShape = useMemo(() => {
    const tt = resolveCamToolType({ operation: toolOp, tools: tools ?? undefined })
    return tt === 'ball' ? 'ball' : 'flat'
  }, [toolOp, tools])
  const toolFluteLength = useMemo(() => {
    const stickout = resolveCamToolStickoutMm({ operation: toolOp, tools: tools ?? undefined })
    return Math.max(stickout ?? toolDia * 2, TOOL_MODEL_MIN_FLUTE_LENGTH_MM)
  }, [toolOp, tools, toolDia])

  const is4Axis = previewOperation != null && isManufactureKind4AxisForPreview(previewOperation.kind)
  const is5Axis = previewOperation != null && isManufactureKind5AxisForPreview(previewOperation.kind)
  const rotaryCylinder = useMemo(() => {
    if (!is4Axis || !previewOperation) return null
    const d = resolve4AxisCylinderDiameterMm(previewOperation.params)
    const rawLen = previewOperation.params?.['rotaryStockLengthMm']
    const rawCylLen = previewOperation.params?.['cylinderLengthMm']
    const stockLen = typeof rawLen === 'number' && rawLen > 0 ? rawLen
      : typeof rawCylLen === 'number' && rawCylLen > 0 ? rawCylLen
        : 100
    return { diameterMm: d, lengthMm: Math.max(1, stockLen) }
  }, [is4Axis, previewOperation])

  const stockBox = useMemo(() => {
    const st = stockDef
    if (!st) return null
    if (st.kind === 'box') {
      const x = st.x ?? 0
      const y = st.y ?? 0
      const z = st.z ?? 0
      if (!(x > 0) || !(y > 0) || !(z > 0)) return null
      return { x, y, z }
    }
    if (st.kind === 'fromExtents') {
      if (!partBoundsCnc) return null
      const pad = st.allowanceMm ?? 0
      return stockBoxDimensionsFromPartBounds(partBoundsCnc, pad)
    }
    return null
  }, [stockDef, partBoundsCnc])

  const partGeometry = useMemo(() => {
    if (!partPositionsRaw || !showPartMesh) return null
    const n = partPositionsRaw.length
    const pos = new Float32Array(n)

    if (is4Axis && partBoundsCnc) {
      // ── 4-axis: center on rotation axis ────────���─────────────────────────
      // The CAM engine centers the mesh on the rotation axis (YZ midpoint → 0).
      // Apply the same centering so the part overlay aligns with the cylinder
      // stock outline and the cylindrical toolpath.
      const cY = (partBoundsCnc.min[1] + partBoundsCnc.max[1]) / 2
      const cZ = (partBoundsCnc.min[2] + partBoundsCnc.max[2]) / 2
      for (let i = 0; i < n; i += 3) {
        const x = partPositionsRaw[i]!
        const y = partPositionsRaw[i + 1]! - cY
        const z = partPositionsRaw[i + 2]! - cZ
        // CNC → Three.js: X→X, CNC-Z→Three-Y (up), CNC-Y→Three-Z (depth)
        pos[i]     = x
        pos[i + 1] = z
        pos[i + 2] = y
      }
    } else {
      // ── 3-axis: WCS-alignment offset ──────────────────────────────────────
      // G-code uses a WCS where:
      //   X=0, Y=0 = stock min corner (front-left)
      //   Z=0       = TOP of stock (all cuts go negative Z)
      //
      // The raw STL vertices carry whatever coordinates the CAD model was saved
      // at, which is almost never at the G-code WCS origin.  Without correction,
      // the part mesh renders at its model-space coordinates while the toolpath
      // renders near [0,0,0] — they appear far apart.
      //
      // Fix: translate every vertex so that:
      //   • STL minX → 0  (aligns part left edge with G-code X=0)
      //   • STL minY → 0  (aligns part front edge with G-code Y=0)
      //   • STL maxZ → 0  (aligns part TOP face with G-code Z=0)
      //
      // After this transform the part, stock outline box, and toolpath tubes
      // all share the same Three.js origin.
      const ox = partBoundsCnc ? partBoundsCnc.min[0] : 0
      const oy = partBoundsCnc ? partBoundsCnc.min[1] : 0
      const ozTop = partBoundsCnc ? partBoundsCnc.max[2] : 0   // top of part → Z=0

      for (let i = 0; i < n; i += 3) {
        const x = partPositionsRaw[i]! - ox
        const y = partPositionsRaw[i + 1]! - oy
        const z = partPositionsRaw[i + 2]! - ozTop  // part top lands at Z=0; rest is negative

        // CNC → Three.js axis remap: X→X, CNC-Z→Three-Y (up), CNC-Y→Three-Z (depth)
        pos[i]     = x
        pos[i + 1] = z   // CNC Z (now offset so top=0) → Three.js Y
        pos[i + 2] = y
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.computeVertexNormals()
    return g
  }, [partPositionsRaw, showPartMesh, partBoundsCnc, is4Axis])

  useEffect(() => {
    const rel = previewMeshRelativePath?.trim()
    if (!projectDir || !rel) {
      setPartLoadNote(null)
      setPartBoundsCnc(null)
      setPartPositionsRaw(null)
      return
    }
    let cancelled = false
    setPartLoadNote('Loading mesh…')
    void (async () => {
      try {
        const r = await window.fab.assemblyReadStlBase64(projectDir, rel)
        if (cancelled) return
        if (!r.ok) {
          setPartLoadNote(r.error)
          setPartBoundsCnc(null)
          setPartPositionsRaw(null)
          return
        }
        const u8 = base64ToUint8Array(r.base64)
        const tri = triangulateBinaryStl(u8, 120_000)
        if ('error' in tri) {
          setPartLoadNote(tri.error)
          setPartBoundsCnc(null)
          setPartPositionsRaw(null)
          return
        }
        setPartBoundsCnc(tri.bbox)
        setPartPositionsRaw(tri.positions)
        setPartLoadNote(
          tri.truncated
            ? `Preview uses first ${(tri.positions.length / 9).toLocaleString()} triangles (${tri.triangleCount.toLocaleString()} in file).`
            : null
        )
      } catch (e) {
        if (!cancelled) {
          setPartLoadNote(e instanceof Error ? e.message : String(e))
          setPartBoundsCnc(null)
          setPartPositionsRaw(null)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectDir, previewMeshRelativePath])

  const rawSegments = useMemo(
    () => (gcode.trim() ? extractToolpathSegmentsFromGcode(gcode) : []),
    [gcode]
  )

  const segments = useMemo(() => {
    const raw = rawSegments
    const op = previewOperation && !previewOperation.suppressed ? previewOperation : null
    if (!op) { segs4Ref.current = []; return raw }
    // 5-axis: XYZ is Cartesian, A/B affect tool orientation only — parse to get arc support then project to 3-axis
    if (isManufactureKind5AxisForPreview(op.kind)) {
      segs4Ref.current = []
      if (!/\b[AB]-?\d/.test(gcode)) { segs5Ref.current = []; return raw }
      const segs5 = extractToolpathSegments5AxisFromGcode(gcode)
      if (segs5.length > 0) {
        segs5Ref.current = segs5
        return segs5.map((s) => ({ kind: s.kind, x0: s.x0, y0: s.y0, z0: s.z0, x1: s.x1, y1: s.y1, z1: s.z1 }))
      }
      segs5Ref.current = []
      return raw
    }
    // 4-axis: cylindrical transform — also retain raw segments for cylindrical heightfield
    if (!isManufactureKind4AxisForPreview(op.kind)) { segs4Ref.current = []; return raw }
    if (!/\bA-?\d/.test(gcode)) { segs4Ref.current = []; return raw }
    const segs4 = extractToolpathSegments4AxisFromGcode(gcode)
    if (segs4.length > 0) {
      segs4Ref.current = segs4
      return apply4AxisCylindricalTransform(segs4)
    }
    segs4Ref.current = []
    const d = resolve4AxisCylinderDiameterMm(op.params)
    return apply4AxisRadialZToMillPreviewSegments(raw, d)
  }, [rawSegments, gcode, previewOperation])

  // ── WCS-align toolpath segments to match the part mesh ──────────────────────
  // G-code generators (built-in, OCL, advanced engine) emit coordinates in the
  // raw STL coordinate space.  The part mesh preview is translated so that its
  // min corner sits at (0,0) and its top face at Z=0 (the CNC WCS convention).
  // Apply the same offset to the toolpath segments so they overlay the part.
  //
  // For 4-axis operations the segments are already in cylindrical-to-Cartesian
  // space centered on the rotation axis — the planar WCS offset does not apply.
  const viewSegments = useMemo(() => {
    if (is4Axis) return segments
    if (!partBoundsCnc || segments.length === 0) return segments
    const ox = partBoundsCnc.min[0]
    const oy = partBoundsCnc.min[1]
    const oz = partBoundsCnc.max[2]
    if (Math.abs(ox) < 1e-6 && Math.abs(oy) < 1e-6 && Math.abs(oz) < 1e-6) return segments
    return segments.map((s) => ({
      ...s,
      x0: s.x0 - ox, y0: s.y0 - oy, z0: s.z0 - oz,
      x1: s.x1 - ox, y1: s.y1 - oy, z1: s.z1 - oz,
    }))
  }, [segments, partBoundsCnc, is4Axis])

  const pathSampler = useMemo(() => buildToolpathLengthSampler(viewSegments), [viewSegments])

  const pathChains = useMemo(() => buildContiguousPathChains(viewSegments), [viewSegments])

  // ── Stock simulation (voxel-based overlay) ───────────────────────────────
  const stockSimulation = useStockSimulationToggle({
    stockBox,
    segments: viewSegments,
    toolDiameterMm: toolDia,
    toolShape: toolShape === 'ball' ? 'ball' : 'flat'
  })

  const tubeTooHeavy =
    viewSegments.length > TUBE_MAX_SEGMENTS ||
    pathChains.length > TUBE_MAX_CHAINS ||
    viewSegments.length === 0

  const rapidRadiusMm = Math.max(0.22, toolDia * 0.065)
  const feedRadiusMm = Math.max(0.38, toolDia * 0.11)

  const envelopeMachine = machine?.kind === 'cnc' ? machine : undefined
  const workArea = envelopeMachine?.workAreaMm

  const envelopeCheck = useMemo(() => {
    if (!workArea || segments.length === 0) return null
    return compareToolpathToMachineEnvelope(segments, workArea)
  }, [segments, workArea])

  const heightField = useMemo(() => {
    if (is4Axis || !showRemoval || removalMode !== 'tier2' || viewSegments.length === 0) return null
    return buildHeightFieldFromCuttingSegments(viewSegments, {
      toolRadiusMm: toolDia * 0.5,
      maxCols: HF_PREVIEW_MAX_COLS,
      maxRows: HF_PREVIEW_MAX_ROWS,
      stockTopZ: 0,
      cuttingZThreshold: HF_CUTTING_Z_THRESHOLD,
      toolShape
    })
  }, [is4Axis, viewSegments, showRemoval, removalMode, toolDia, toolShape])

  /** Cylindrical heightfield for 4-axis material removal preview. */
  const cylindricalHeightField = useMemo((): CylindricalHeightField | null => {
    if (!is4Axis || !showRemoval || removalMode !== 'tier2' || viewSegments.length === 0) return null
    const segs4 = segs4Ref.current
    if (segs4.length === 0) return null
    const cylDia = rotaryCylinder?.diameterMm ?? 50
    let xMin = Infinity, xMax = -Infinity
    for (const s of segs4) {
      xMin = Math.min(xMin, s.x0, s.x1)
      xMax = Math.max(xMax, s.x0, s.x1)
    }
    if (!Number.isFinite(xMin) || !Number.isFinite(xMax)) return null
    return buildCylindricalHeightFieldFromSegments(segs4, {
      toolRadiusMm: toolDia * 0.5,
      cylinderDiameterMm: cylDia,
      stockXMin: xMin,
      stockXMax: xMax,
      maxCols: 96,
      maxRows: 120,
      toolShape: toolShape === 'ball' ? 'ball' : 'flat',
    })
  }, [is4Axis, showRemoval, removalMode, viewSegments.length, toolDia, toolShape, rotaryCylinder])

  const voxelPreview = useMemo(() => {
    if (!showRemoval || removalMode !== 'tier3' || viewSegments.length === 0) return null
    const vq = VOXEL_SIM_QUALITY_PRESETS[voxelQuality]
    return buildVoxelRemovalFromCuttingSegments(viewSegments, {
      toolRadiusMm: toolDia * 0.5,
      ...vq,
      stockTopZ: 0,
      ...(stockBox && stockBox.z > 0 ? { stockBottomZ: -stockBox.z } : {}),
      ...(stockBox && stockBox.x > 0 && stockBox.y > 0
        ? { stockRectXYMm: { minX: 0, maxX: stockBox.x, minY: 0, maxY: stockBox.y } }
        : {}),
      cuttingZThreshold: HF_CUTTING_Z_THRESHOLD,
      toolShape
    })
  }, [viewSegments, showRemoval, removalMode, toolDia, toolShape, stockBox, voxelQuality])

  useEffect(() => {
    if (!isPlaying || pathSampler.totalMm < 1e-9) return
    let raf = 0
    let last = performance.now()
    const speed = playbackSpeed
    const loop = (now: number) => {
      const dt = Math.min(0.12, (now - last) / 1000)
      last = now
      setPlaybackU((u) => {
        const nu = u + speed * dt
        return nu >= 1 ? nu % 1 : nu
      })
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [isPlaying, pathSampler.totalMm, playbackSpeed])

  const playbackGcodePos = useMemo(() => {
    if (viewSegments.length === 0) return null
    return pathSampler.atUnit(playbackU)
  }, [pathSampler, playbackU, viewSegments.length])

  /** Number of segments visible at the current playback position. */
  const visibleSegmentCount = useMemo(() => {
    if (!progressiveMode || viewSegments.length === 0) return viewSegments.length
    // +1 because segmentIndexAtUnit returns 0-based index, we want count
    return Math.min(viewSegments.length, pathSampler.segmentIndexAtUnit(playbackU) + 1)
  }, [progressiveMode, viewSegments, pathSampler, playbackU])

  /** Progressive height field — rebuilds periodically during playback based on visible segments. */
  const progressiveHeightField = useMemo(() => {
    if (is4Axis || !showRemoval || removalMode !== 'tier2') return null
    if (!progressiveMode) return heightField
    const n = visibleSegmentCount
    if (n === 0) return null
    // Throttle rebuilds: only rebuild if segment index advanced enough or time elapsed
    const now = performance.now()
    const timeSinceLast = now - lastHfRebuildTime.current
    const step = Math.max(1, Math.floor(viewSegments.length / HF_REBUILD_STEP_DIVISOR))
    if (lastHfRebuildIdx.current >= 0 && n - lastHfRebuildIdx.current < step && timeSinceLast < HF_REBUILD_INTERVAL_MS && n < viewSegments.length) {
      // Return previous height field (will be stale but avoids per-frame rebuilds)
      return heightField
    }
    lastHfRebuildIdx.current = n
    lastHfRebuildTime.current = now
    const visibleSegs = viewSegments.slice(0, n)
    return buildHeightFieldFromCuttingSegments(visibleSegs, {
      toolRadiusMm: toolDia * 0.5,
      maxCols: HF_PREVIEW_MAX_COLS,
      maxRows: HF_PREVIEW_MAX_ROWS,
      stockTopZ: 0,
      cuttingZThreshold: HF_CUTTING_Z_THRESHOLD,
      toolShape
    })
  }, [is4Axis, showRemoval, removalMode, progressiveMode, visibleSegmentCount, viewSegments, toolDia, toolShape, heightField])

  /** Progressive cylindrical height field for 4-axis playback. */
  const progressiveCylindricalHf = useMemo((): CylindricalHeightField | null => {
    if (!is4Axis || !showRemoval || removalMode !== 'tier2') return null
    if (!progressiveMode) return cylindricalHeightField
    const segs4 = segs4Ref.current
    if (segs4.length === 0) return null
    // Map visible fraction from transformed segments to raw 4-axis segments
    const frac = viewSegments.length > 0 ? visibleSegmentCount / viewSegments.length : 1
    const rawN = Math.max(1, Math.ceil(frac * segs4.length))
    if (rawN >= segs4.length) return cylindricalHeightField
    // Throttle rebuilds
    const now = performance.now()
    const timeSinceLast = now - lastHfRebuildTime.current
    const step = Math.max(1, Math.floor(segs4.length / HF_REBUILD_STEP_DIVISOR))
    if (lastHfRebuildIdx.current >= 0 && rawN - lastHfRebuildIdx.current < step && timeSinceLast < HF_REBUILD_INTERVAL_MS) {
      return cylindricalHeightField
    }
    lastHfRebuildIdx.current = rawN
    lastHfRebuildTime.current = now
    const visibleSegs4 = segs4.slice(0, rawN)
    const cylDia = rotaryCylinder?.diameterMm ?? 50
    let xMin = Infinity, xMax = -Infinity
    for (const s of visibleSegs4) {
      xMin = Math.min(xMin, s.x0, s.x1)
      xMax = Math.max(xMax, s.x0, s.x1)
    }
    if (!Number.isFinite(xMin) || !Number.isFinite(xMax)) return null
    return buildCylindricalHeightFieldFromSegments(visibleSegs4, {
      toolRadiusMm: toolDia * 0.5,
      cylinderDiameterMm: cylDia,
      stockXMin: xMin,
      stockXMax: xMax,
      maxCols: 96,
      maxRows: 120,
      toolShape: toolShape === 'ball' ? 'ball' : 'flat',
    })
  }, [is4Axis, showRemoval, removalMode, progressiveMode, visibleSegmentCount, viewSegments.length, cylindricalHeightField, toolDia, toolShape, rotaryCylinder])

  async function loadOutputCam(): Promise<void> {
    setLoadNote(null)
    const sep = projectDir.includes('\\') ? '\\' : '/'
    const path = `${projectDir}${sep}output${sep}cam.nc`
    try {
      const text = await window.fab.readTextFile(path)
      setGcode(text)
      setLoadNote(`Loaded ${path}`)
    } catch (e) {
      setLoadNote(e instanceof Error ? e.message : String(e))
    }
  }

  const hasPath = viewSegments.length > 0
  const showSimCanvas =
    hasPath ||
    Boolean(envelopeMachine && workArea) ||
    Boolean(stockBox) ||
    Boolean(showPartMesh && partGeometry)

  const useTubePreview = hasPath && pathPreviewMode === 'rendered' && !tubeTooHeavy

  const playbackHeadThree = playbackGcodePos
    ? (gcodeToThree(playbackGcodePos.x, playbackGcodePos.y, playbackGcodePos.z) as THREE.Vector3Tuple)
    : null

  // For 4-axis operations, orient the tool radially inward toward the rotation axis (X).
  // In Three.js coords (X, Y=up, Z), default tool axis is Y-up. For 4-axis, the tool
  // should point from the position toward the X axis (Y=0, Z=0).
  // For 5-axis, derive orientation from interpolated A/B angles stored in segs5Ref.
  const toolRotation = useMemo(() => {
    if (is5Axis && segs5Ref.current.length > 0 && viewSegments.length > 0) {
      const segIdx = pathSampler.segmentIndexAtUnit(playbackU)
      const seg5 = segs5Ref.current[Math.min(segIdx, segs5Ref.current.length - 1)]
      if (seg5) {
        // Interpolate A/B within the segment based on fractional progress
        const cumMm = pathSampler.cumulativeMm
        const segStart = segIdx > 0 ? cumMm[segIdx - 1]! : 0
        const segEnd = cumMm[segIdx]!
        const segLen = segEnd - segStart
        const distMm = playbackU * pathSampler.totalMm
        const t = segLen > 1e-6 ? Math.max(0, Math.min(1, (distMm - segStart) / segLen)) : 0
        const aDeg = seg5.a0 + (seg5.a1 - seg5.a0) * t
        const bDeg = seg5.b0 + (seg5.b1 - seg5.b0) * t
        if (Math.abs(aDeg) > 0.01 || Math.abs(bDeg) > 0.01) {
          // G-code A rotates around X, B rotates around Y; tool default is along Z.
          // Convert to Three.js: G-code (X,Y,Z) → Three.js (X,Z,Y), so
          // A (around G-code X) → around Three.js X, B (around G-code Y) → around Three.js Z.
          const aRad = (aDeg * Math.PI) / 180
          const bRad = (bDeg * Math.PI) / 180
          const qa = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), aRad)
          const qb = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), bRad)
          return qb.multiply(qa)
        }
      }
      return undefined
    }
    if (!is4Axis || !playbackHeadThree) return undefined
    const [, py, pz] = playbackHeadThree
    const radialLen = Math.hypot(py, pz)
    if (radialLen < 1e-6) return undefined
    // Direction from position toward rotation axis
    const dir = new THREE.Vector3(0, -py / radialLen, -pz / radialLen)
    const up = new THREE.Vector3(0, 1, 0)
    return new THREE.Quaternion().setFromUnitVectors(up, dir)
  }, [is4Axis, is5Axis, playbackHeadThree, playbackU, pathSampler, viewSegments.length])

  const viewportWrapClass =
    layout === 'workspace'
      ? 'cam-sim-viewport-wrap cam-sim-viewport-wrap--workspace'
      : 'cam-sim-viewport-wrap'

  const canvasBlock = (
    <div className={viewportWrapClass}>
      {showSimCanvas ? (
        <Canvas shadows camera={{ position: [80, 70, 80], fov: 45 }} gl={{ antialias: true }}>
          <color attach="background" args={['#0f172a']} />
          <fog attach="fog" args={['#0f172a', 120, 520]} />
          <hemisphereLight intensity={0.35} color="#a5b4fc" groundColor="#1e293b" />
          <ambientLight intensity={0.45} />
          <directionalLight castShadow position={[55, 110, 45]} intensity={1.05} shadow-mapSize={[1024, 1024]} />
          <Grid
            infiniteGrid
            fadeDistance={220}
            fadeStrength={1.2}
            cellSize={5}
            sectionSize={25}
            sectionColor="#6366f1"
            cellColor="#334155"
            position={[0, 0, 0]}
          />
          <Bounds fit clip observe margin={1.2} maxDuration={0.45}>
            <group>
              {envelopeMachine && workArea ? (
                <>
                  <MachineTablePlane wx={workArea.x} wy={workArea.y} />
                  <MachineEnvelopeBox wx={workArea.x} wy={workArea.y} wz={workArea.z} />
                </>
              ) : null}
              {rotaryCylinder ? (
                <StockOutlineCylinder diameterMm={rotaryCylinder.diameterMm} lengthMm={rotaryCylinder.lengthMm} />
              ) : stockBox ? (
                <StockOutlineBox sx={stockBox.x} sy={stockBox.y} sz={stockBox.z} />
              ) : null}
              {showPartMesh && partGeometry ? <PartStlMesh geometry={partGeometry} /> : null}
              {showRemoval && removalMode === 'tier2' && is4Axis ? (() => {
                const chf = progressiveMode ? progressiveCylindricalHf : cylindricalHeightField
                return chf ? <CylindricalHeightFieldTerrain hf={chf} /> : null
              })() : null}
              {showRemoval && removalMode === 'tier2' && !is4Axis && (progressiveMode ? progressiveHeightField : heightField) ? (
                <HeightFieldTerrain hf={(progressiveMode ? progressiveHeightField : heightField)!} />
              ) : null}
              {showRemoval && removalMode === 'tier3' && voxelPreview && voxelPreview.samplePositions.length > 0 ? (
                <VoxelCarveSamples positions={voxelPreview.samplePositions} />
              ) : null}
              {hasPath ? (
                progressiveMode ? (
                  useTubePreview ? (
                    <ProgressiveToolpathTubes
                      segments={viewSegments}
                      visibleCount={visibleSegmentCount}
                      rapidRadiusMm={rapidRadiusMm}
                      feedRadiusMm={feedRadiusMm}
                    />
                  ) : (
                    <ProgressiveToolpathLines segments={viewSegments} visibleCount={visibleSegmentCount} />
                  )
                ) : useTubePreview ? (
                  <ToolpathMeshTubes
                    chains={pathChains}
                    rapidRadiusMm={rapidRadiusMm}
                    feedRadiusMm={feedRadiusMm}
                  />
                ) : (
                  <ToolpathLines segments={viewSegments} />
                )
              ) : null}
              {hasPath && playbackHeadThree ? (
                <PlaybackToolHead
                  position={playbackHeadThree}
                  toolDiameter={toolDia}
                  fluteLength={toolFluteLength}
                  rotation={toolRotation}
                />
              ) : null}
              <StockSimulationSceneLayer
                enabled={stockSimulation.enabled}
                meshData={stockSimulation.meshData}
                gouges={stockSimulation.gouges}
              />
            </group>
          </Bounds>
          <ContactShadows
            position={[0, 0.04, 0]}
            opacity={0.45}
            scale={260}
            blur={2.2}
            far={6}
            color="#0f172a"
          />
          <OrbitControls makeDefault enableDamping />
        </Canvas>
      ) : (
        <p className="msg msg--muted cam-sim-pad">
          Select a mesh path on an operation, define stock, or load G-code. With a CNC machine profile, the work envelope
          appears even before paths or parts load.
        </p>
      )}
      <StockSimulationHudLayer
        enabled={stockSimulation.enabled}
        stats={stockSimulation.stats}
        progress={stockSimulation.progress}
        onProgressChange={stockSimulation.setProgress}
        gougeCount={stockSimulation.gouges.length}
      />
    </div>
  )

  const metaBlock = (
    <>
      <h3 className="subh">Fabrication 3D workspace — path, stock, part mesh</h3>
      <p className="msg msg--muted">
        <strong>Part mesh</strong> uses the same CNC→Three mapping as G-code (X→X, CNC Z→Three Y, CNC Y→Three Z).{' '}
        <strong>Tier 1:</strong> rendered tubes vs lines. <strong>Tier 2:</strong> fixed ~88×88 2.5D height field from feed
        stamps (not stock-exact).         <strong>Tier 3:</strong> coarse voxels; quality preset scales grid/stamp budget (still
        approximate). Tier 2–3 trade <strong>resolution vs UI responsiveness</strong> under fixed caps — not a
        certified removal model. Not collision-safe — <code>docs/MACHINES.md</code>.
      </p>
      <p className="msg msg--muted msg--xs" aria-live="polite">
        <strong>Machine safety:</strong> verify posts, units, tool length, and clearances before running G-code. Purple
        wireframe = profile work volume (may not match fixture / WCS).
      </p>
      {envelopeMachine && workArea ? (
        <p className="msg msg--muted msg--xs">
          <strong>Machine envelope (preview):</strong> {envelopeMachine.name} — {workArea.x}×{workArea.y}×{workArea.z} mm
        </p>
      ) : null}
      {envelopeMachine?.kind === 'cnc' && (envelopeMachine.axisCount ?? 3) >= 4 && (envelopeMachine.axisCount ?? 3) < 5 ? (
        <p className="msg msg--muted msg--xs" role="note">
          <strong>Rotary (A):</strong> Tier 1 tube/lines map <code>X</code>, radial <code>Z</code>, and <code>A</code> into a
          cylindrical preview rig. Tier 2–3 material proxies remain coarse 2.5D / voxel stamps — not full rotary swept-volume
          or collision checking. Compare <code>A</code> to <code>aAxisRangeDeg</code>
          {envelopeMachine.aAxisRangeDeg != null
            ? ` (${envelopeMachine.aAxisRangeDeg}° nominal)`
            : ' (defaults to 360° when unset)'}
          . See <code>docs/CAM_4TH_AXIS_REFERENCE.md</code> and <code>docs/MACHINES.md</code>.
        </p>
      ) : null}
      {envelopeMachine?.kind === 'cnc' && (envelopeMachine.axisCount ?? 3) >= 5 ? (
        <p className="msg msg--muted msg--xs" role="note">
          <strong>5-axis (A+B):</strong> Preview shows XYZ Cartesian toolpath only — tool tilt
          (A/B orientation) is not rendered. Tier 2–3 removal proxies use 3-axis swept-volume assumptions; they do not
          model tool-axis inclination. Verify kinematic limits against <code>maxTiltDeg</code>
          {envelopeMachine.maxTiltDeg != null
            ? ` (${envelopeMachine.maxTiltDeg}° max)`
            : ' (defaults to 60° when unset)'}
          {envelopeMachine.fiveAxisType
            ? `, chain: ${envelopeMachine.fiveAxisType}`
            : ''}
          . See <code>docs/MACHINES.md</code>.
        </p>
      ) : null}
      {stockDef?.kind === 'fromExtents' ? (
        <p className="msg msg--muted msg--xs">
          Stock kind <strong>from extents</strong>: preview box = part AABB + allowance (mm per side). Use <strong>Fit stock
          from part</strong> in the sidebar to write a box into <code>manufacture.json</code>.
        </p>
      ) : null}
      {hasPath && envelopeCheck && workArea ? (
        <p
          className={`msg msg--xs ${envelopeCheck.withinEnvelope ? 'msg--muted' : ''}`}
          role="status"
          aria-live="polite"
        >
          {envelopeCheck.bounds ? (
            <>
              <strong>G-code bounds (mm):</strong> X [{envelopeCheck.bounds.minX.toFixed(2)}, {envelopeCheck.bounds.maxX.toFixed(2)}],
              Y [{envelopeCheck.bounds.minY.toFixed(2)}, {envelopeCheck.bounds.maxY.toFixed(2)}], Z [
              {envelopeCheck.bounds.minZ.toFixed(2)}, {envelopeCheck.bounds.maxZ.toFixed(2)}] vs profile [0,{workArea.x}]×[0,
              {workArea.y}]×[0,{workArea.z}].{' '}
            </>
          ) : null}
          {envelopeCheck.withinEnvelope ? (
            <span>Within machine profile box (does not prove collision-safe).</span>
          ) : (
            <span>
              <strong>Outside profile box:</strong>{' '}
              {envelopeCheck.violations.map((v) => {
                const lim = v.axis === 'x' ? workArea.x : v.axis === 'y' ? workArea.y : workArea.z
                return (
                  <span key={`${v.axis}-${v.kind}`}>
                    {v.axis.toUpperCase()}{' '}
                    {v.kind === 'below_min' ? 'below 0' : `above ${lim} mm`} by {v.excessMm.toFixed(2)} mm;{' '}
                  </span>
                )
              })}
            </span>
          )}
        </p>
      ) : null}
    </>
  )

  const controlsBlock = (
    <>
      <div className="row row--align-center row--wrap">
        <button type="button" className="secondary" onClick={() => void loadOutputCam()}>
          Load output/cam.nc
        </button>
        <label className="chk">
          <input type="checkbox" checked={showPartMesh} onChange={(e) => setShowPartMesh(e.target.checked)} />
          Show part mesh
        </label>
        <label>
          Path display
          <select
            value={tubeTooHeavy ? 'lines' : pathPreviewMode}
            onChange={(e) => setPathPreviewMode(e.target.value as 'rendered' | 'lines')}
            disabled={!hasPath}
            className="ml-6"
          >
            <option value="rendered">Rendered (3D tubes)</option>
            <option value="lines">Lines (fast)</option>
          </select>
        </label>
        {hasPath && tubeTooHeavy ? (
          <span className="msg msg--muted msg--xs">
            Switched to lines: program has {viewSegments.length.toLocaleString()} segments or {pathChains.length.toLocaleString()}{' '}
            chains (limit for tube preview).
          </span>
        ) : null}
        <StockSimulationToggleButton
          enabled={stockSimulation.enabled}
          canEnable={stockSimulation.canEnable}
          onToggle={stockSimulation.toggle}
        />
        <label className="chk">
          <input type="checkbox" checked={showRemoval} onChange={(e) => setShowRemoval(e.target.checked)} />
          Show removal preview
        </label>
        {showRemoval ? (
          <label>
            Model
            <select
              value={removalMode}
              onChange={(e) => setRemovalMode(e.target.value as 'tier2' | 'tier3')}
              className="ml-6"
            >
              <option value="tier2">Tier 2 — 2.5D height field</option>
              <option value="tier3">Tier 3 — coarse voxels (experimental)</option>
            </select>
          </label>
        ) : null}
        {showRemoval && removalMode === 'tier3' ? (
          <label title="Tier 3 grid resolution and sphere-stamp budget (saved in this browser)">
            Voxel quality
            <select
              value={voxelQuality}
              onChange={(e) => setVoxelQuality(e.target.value as VoxelSimQualityPreset)}
              className="ml-6"
            >
              <option value="fast">Fast (coarse)</option>
              <option value="balanced">Balanced</option>
              <option value="detailed">Detailed (slow)</option>
            </select>
          </label>
        ) : null}
        <span className="msg msg--muted msg--xs">
          Tool Ø for proxy: {toolDia.toFixed(2)} mm (selected or first CNC op + library)
        </span>
      </div>
      {hasPath ? (
        <div className="row row--align-center manufacture-playback-row">
          <span className="msg msg--muted msg--xs">Playback</span>
          <button type="button" className="secondary" onClick={() => setIsPlaying((p) => !p)}>
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          <label className="manufacture-playback-scrub">
            <span className="msg msg--xs msg--muted">Position</span>
            <input
              type="range"
              min={0}
              max={1}
              step={viewSegments.length > 0 ? 1 / Math.max(SCRUBBER_MIN_STEP_DENOM, viewSegments.length) : 1 / SCRUBBER_MIN_STEP_DENOM}
              value={playbackU}
              onChange={(e) => {
                setPlaybackU(Number(e.target.value))
                setIsPlaying(false)
              }}
            />
          </label>
          <span className="msg msg--muted msg--xs">
            {pathSampler.totalMm > 0 ? `${pathSampler.totalMm.toFixed(1)} mm path` : ''}
          </span>
        </div>
      ) : null}
      {showRemoval && removalMode === 'tier3' && voxelPreview ? (
        <p className="msg msg--muted cam-msg-tier3">
          Tier 3: grid {voxelPreview.cols}×{voxelPreview.rows}×{voxelPreview.layers}, cell ≈{voxelPreview.cellMm.toFixed(2)}{' '}
          mm — carved voxels ~{voxelPreview.carvedVoxelCount.toLocaleString()} (~
          {voxelPreview.approxRemovedVolumeMm3.toFixed(0)} mm³ heuristic).
          {voxelPreview.stampsCapped ? ' Stamp budget capped for performance.' : ''} Orange points sample removed volume.
          {' '}
          Approximate only — not collision-safe. With a setup stock box, the grid extends to nominal XY and Z stock (still heuristic).
        </p>
      ) : null}
      {showRemoval && removalMode === 'tier3' && viewSegments.length > 0 && !voxelPreview ? (
        <p className="msg msg--muted cam-msg-tier3">
          Tier 3: no voxel data (no qualifying feed moves below the Z threshold, or path too small).
        </p>
      ) : null}
      {showRemoval && removalMode === 'tier2' && heightField ? (
        <p className="msg msg--muted cam-msg-tier3">
          Tier 2: grid {heightField.cols}×{heightField.rows}, cell ≈{heightField.cellMm.toFixed(2)} mm — upper-envelope proxy
          only; does not model holder/fixture collisions or true swept volume.
        </p>
      ) : null}
      {loadNote ? <p className="msg">{loadNote}</p> : null}
      {partLoadNote ? <p className="msg msg--muted msg--xs">{partLoadNote}</p> : null}
    </>
  )

  const textareaBlock = (
    <label className="cam-label-stack">
      <span className="msg">G-code (paste or load)</span>
      <textarea
        value={gcode}
        onChange={(e) => setGcode(e.target.value)}
        rows={layout === 'workspace' ? 4 : 5}
        className="textarea--code input--full"
        spellCheck={false}
      />
    </label>
  )

  return (
    <section className="panel panel--nested" aria-label="CAM path and approximate stock preview" id="manufacture-cam-simulation">
      {layout === 'workspace' ? (
        <>
          {canvasBlock}
          {metaBlock}
          {controlsBlock}
          {textareaBlock}
        </>
      ) : (
        <>
          {metaBlock}
          {controlsBlock}
          {textareaBlock}
          {canvasBlock}
        </>
      )}
    </section>
  )
}
