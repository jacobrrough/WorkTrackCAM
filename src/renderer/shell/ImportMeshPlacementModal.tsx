import { OrbitControls, TransformControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { BufferGeometry, Group, MeshStandardMaterial } from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import type { MeshImportPlacement, MeshImportTransform, MeshImportUpAxis } from '../../shared/mesh-import-placement'
import { MESH_IMPORT_PLACEMENT_DEFAULTS } from '../../shared/mesh-import-placement'

type Props = {
  open: boolean
  fileCount: number
  previewSourcePath?: string
  previewPythonPath?: string
  onConfirm: (placement: MeshImportPlacement, upAxis: MeshImportUpAxis, transform: MeshImportTransform) => void
  onCancel: () => void
}

const PLACEMENT_OPTIONS: { id: MeshImportPlacement; label: string; hint: string }[] = [
  { id: 'as_is', label: 'Keep file origin', hint: 'No automatic centering; use when source origin is already correct.' },
  { id: 'center_origin', label: 'Center at world origin', hint: 'Moves model bounds center to world (0,0,0).' },
  { id: 'center_xy_ground_z', label: 'Center on ground', hint: 'Centers in XY and places model bottom on Z=0.' }
]

const UP_AXIS_OPTIONS: { id: MeshImportUpAxis; label: string; hint: string }[] = [
  { id: 'y_up', label: 'Y-up (default)', hint: 'Use when source is already Y-up.' },
  { id: 'z_up', label: 'Z-up -> Y-up', hint: 'Applies -90 degree X rotation before placement.' }
]

function PlacementMesh({
  geometry,
  placement,
  upAxis,
  transform,
  mode,
  onTransformChange
}: {
  geometry: BufferGeometry | null
  placement: MeshImportPlacement
  upAxis: MeshImportUpAxis
  transform: MeshImportTransform
  mode: 'translate' | 'rotate'
  onTransformChange: (next: MeshImportTransform) => void
}) {
  const groupRef = useRef<Group | null>(null)
  const [dragging, setDragging] = useState(false)
  const material = useMemo(
    () => new MeshStandardMaterial({ color: '#9333ea', roughness: 0.45, metalness: 0.08, emissive: '#32104f' }),
    []
  )

  useEffect(() => () => material.dispose(), [material])

  const basePosition = useMemo<[number, number, number]>(() => {
    if (placement === 'center_origin') return [0, 0, 0]
    if (placement === 'center_xy_ground_z') return [0, 12, 0]
    return [22, 20, -16]
  }, [placement])

  const baseRotation = useMemo<[number, number, number]>(() => {
    return upAxis === 'z_up' ? [-Math.PI / 2, 0, 0] : [0, 0, 0]
  }, [upAxis])

  return (
    <>
      <TransformControls
        object={groupRef.current ?? undefined}
        mode={mode}
        onMouseDown={() => setDragging(true)}
        onMouseUp={() => setDragging(false)}
        onObjectChange={() => {
          const g = groupRef.current
          if (!g) return
          onTransformChange({
            translateMm: [g.position.x - basePosition[0], g.position.y - basePosition[1], g.position.z - basePosition[2]],
            rotateDeg: [
              ((g.rotation.x - baseRotation[0]) * 180) / Math.PI,
              ((g.rotation.y - baseRotation[1]) * 180) / Math.PI,
              ((g.rotation.z - baseRotation[2]) * 180) / Math.PI
            ]
          })
        }}
      />
      <group
        ref={groupRef}
        position={[
          basePosition[0] + transform.translateMm[0],
          basePosition[1] + transform.translateMm[1],
          basePosition[2] + transform.translateMm[2]
        ]}
        rotation={[
          baseRotation[0] + (transform.rotateDeg[0] * Math.PI) / 180,
          baseRotation[1] + (transform.rotateDeg[1] * Math.PI) / 180,
          baseRotation[2] + (transform.rotateDeg[2] * Math.PI) / 180
        ]}
      >
        <mesh geometry={geometry ?? undefined} material={material}>
          {!geometry ? <boxGeometry args={[40, 24, 30]} /> : null}
        </mesh>
      </group>
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} enabled={!dragging} minDistance={30} maxDistance={2400} />
    </>
  )
}

export function ImportMeshPlacementModal({
  open,
  fileCount,
  previewSourcePath,
  previewPythonPath,
  onConfirm,
  onCancel
}: Props) {
  const titleId = useId()
  const [placement, setPlacement] = useState<MeshImportPlacement>(MESH_IMPORT_PLACEMENT_DEFAULTS.placement)
  const [upAxis, setUpAxis] = useState<MeshImportUpAxis>(MESH_IMPORT_PLACEMENT_DEFAULTS.upAxis)
  const [transform, setTransform] = useState<MeshImportTransform>(MESH_IMPORT_PLACEMENT_DEFAULTS.transform)
  const [mode, setMode] = useState<'translate' | 'rotate'>('translate')
  const [geometry, setGeometry] = useState<BufferGeometry | null>(null)
  const [previewError, setPreviewError] = useState('')

  useEffect(() => {
    if (!open) return
    setPlacement(MESH_IMPORT_PLACEMENT_DEFAULTS.placement)
    setUpAxis(MESH_IMPORT_PLACEMENT_DEFAULTS.upAxis)
    setTransform(MESH_IMPORT_PLACEMENT_DEFAULTS.transform)
    setMode('translate')
  }, [open])

  useEffect(() => {
    if (!open || !previewSourcePath) {
      setGeometry(null)
      setPreviewError('')
      return
    }
    let canceled = false
    setPreviewError('')
    void window.fab
      .meshPreviewStlBase64(previewSourcePath, previewPythonPath ?? 'python')
      .then((r) => {
        if (canceled) return
        if (!r.ok) {
          setGeometry(null)
          setPreviewError(r.detail ? `${r.error}: ${r.detail}` : r.error)
          return
        }
        const raw = atob(r.base64)
        const buf = new Uint8Array(raw.length)
        for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i)
        const loader = new STLLoader()
        const g = loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
        g.computeVertexNormals()
        g.center()
        setGeometry(g)
      })
      .catch((e) => {
        if (canceled) return
        setGeometry(null)
        setPreviewError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      canceled = true
    }
  }, [open, previewSourcePath, previewPythonPath])

  useEffect(() => {
    if (!open) return
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  useEffect(() => {
    return () => geometry?.dispose()
  }, [geometry])

  if (!open) return null
  const fileLabel = fileCount === 1 ? '1 file' : `${fileCount} files`

  return (
    <div className="import-placement-backdrop import-placement-backdrop--fullscreen" role="presentation">
      <div className="import-placement-dialog import-placement-dialog--fullscreen" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="import-placement-layout">
          <section className="import-placement-viewer-pane">
            <h2 id={titleId} className="import-placement-title">
              Interactive import positioning
            </h2>
            <p className="import-placement-lead msg msg--muted">
              {fileLabel}. Orbit/pan/zoom the model and use the gizmo to fully move/rotate before import.
            </p>
            <div className="import-placement-preview-viewport import-placement-preview-viewport--fullscreen">
              <Canvas camera={{ position: [95, 72, 95], fov: 38 }}>
                <color attach="background" args={['#100a16']} />
                <ambientLight intensity={0.7} />
                <directionalLight position={[80, 120, 80]} intensity={0.9} />
                <directionalLight position={[-50, 35, -20]} intensity={0.35} />
                <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
                  <planeGeometry args={[240, 240]} />
                  <meshStandardMaterial color="#1f1430" roughness={0.92} metalness={0.02} />
                </mesh>
                <gridHelper args={[240, 12, '#6d28d9', '#2b1d40']} position={[0, 0.03, 0]} />
                <mesh position={[0, 0.7, 0]}>
                  <sphereGeometry args={[1.2, 16, 16]} />
                  <meshStandardMaterial color="#f3e8ff" emissive="#8b5cf6" emissiveIntensity={0.4} />
                </mesh>
                <PlacementMesh
                  geometry={geometry}
                  placement={placement}
                  upAxis={upAxis}
                  transform={transform}
                  mode={mode}
                  onTransformChange={setTransform}
                />
              </Canvas>
            </div>
            {previewError ? <p className="msg import-placement-preview-error">Preview note: {previewError}</p> : null}
          </section>

          <aside className="import-placement-controls-pane">
            <fieldset className="import-placement-fieldset">
              <legend className="import-placement-legend">Gizmo</legend>
              <div className="import-placement-axis-row">
                <button type="button" className={`import-placement-axis-btn${mode === 'translate' ? ' is-selected' : ''}`} onClick={() => setMode('translate')}>
                  <span className="import-placement-card-title">Move</span>
                </button>
                <button type="button" className={`import-placement-axis-btn${mode === 'rotate' ? ' is-selected' : ''}`} onClick={() => setMode('rotate')}>
                  <span className="import-placement-card-title">Rotate</span>
                </button>
              </div>
            </fieldset>

            <fieldset className="import-placement-fieldset">
              <legend className="import-placement-legend">Position preset</legend>
              <div className="import-placement-card-grid">
                {PLACEMENT_OPTIONS.map((o) => (
                  <button key={o.id} type="button" className={`import-placement-card${placement === o.id ? ' is-selected' : ''}`} onClick={() => setPlacement(o.id)}>
                    <span className="import-placement-card-title">{o.label}</span>
                    <span className="import-placement-card-hint">{o.hint}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="import-placement-fieldset">
              <legend className="import-placement-legend">Up axis</legend>
              <div className="import-placement-card-grid">
                {UP_AXIS_OPTIONS.map((o) => (
                  <button key={o.id} type="button" className={`import-placement-card${upAxis === o.id ? ' is-selected' : ''}`} onClick={() => setUpAxis(o.id)}>
                    <span className="import-placement-card-title">{o.label}</span>
                    <span className="import-placement-card-hint">{o.hint}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="import-placement-transform-readout msg msg--muted">
              <div>T(mm): {transform.translateMm.map((v) => v.toFixed(2)).join(', ')}</div>
              <div>R(deg): {transform.rotateDeg.map((v) => v.toFixed(1)).join(', ')}</div>
            </div>

            <div className="import-placement-actions">
              <button type="button" className="secondary" onClick={onCancel}>
                Cancel
              </button>
              <button type="button" className="primary" onClick={() => onConfirm(placement, upAxis, transform)} autoFocus>
                Import
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
