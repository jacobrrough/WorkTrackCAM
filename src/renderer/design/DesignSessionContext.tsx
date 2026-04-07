import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode
} from 'react'
import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import type { DesignFileV2, SketchConstraint } from '../../shared/design-schema'
import { emptyDesign } from '../../shared/design-schema'
import { formatLoadRejection } from '../../shared/file-parse-errors'
import {
  kernelInspectStaleReason,
  type KernelInspectStaleReason
} from '../../shared/kernel-inspect-hash'
import type { KernelManifest } from '../../shared/kernel-manifest-schema'
import { defaultPartFeatures, type KernelPostSolidOp, type PartFeaturesFile } from '../../shared/part-features-schema'
import { linearPatternSketch, mirrorDesignAcrossYAxis } from './design-ops'
import { derivePartFeatures } from './derive-features'
import { meshToStlBase64 } from './export-stl'
import { sketchPreviewPlacementMatrix } from './sketch-preview-placement'
import { buildExtrudedGeometry } from './sketch-mesh'
import { computeKernelDesignHashWeb, computeKernelFeaturesHashWeb } from './kernel-inspect-web-hash'
import { cloneDesign, sketchResidualReport, solveSketch } from './solver2d'

type DocState = { design: DesignFileV2; past: DesignFileV2[] }

type DocAction =
  | { type: 'replace'; design: DesignFileV2 }
  | { type: 'edit'; design: DesignFileV2 }
  | { type: 'undo' }

function docReducer(state: DocState, action: DocAction): DocState {
  if (action.type === 'replace') {
    return { design: action.design, past: [] }
  }
  if (action.type === 'undo') {
    if (state.past.length === 0) return state
    const prev = state.past[state.past.length - 1]!
    return { design: cloneDesign(prev), past: state.past.slice(0, -1) }
  }
  return {
    design: action.design,
    past: [...state.past, cloneDesign(state.design)].slice(-64)
  }
}

const kernelFinishingOpKinds = new Set<KernelPostSolidOp['kind']>([
  'fillet_all',
  'fillet_select',
  'chamfer_all',
  'chamfer_select',
  'shell_inward'
])

function isKernelFinishingOp(op: KernelPostSolidOp): boolean {
  return kernelFinishingOpKinds.has(op.kind)
}

function canSwapKernelOpOrder(
  movingOp: KernelPostSolidOp,
  neighborOp: KernelPostSolidOp,
  delta: -1 | 1
): { ok: true } | { ok: false; reason: string } {
  const movingIsFinishing = isKernelFinishingOp(movingOp)
  const neighborIsFinishing = isKernelFinishingOp(neighborOp)
  if (delta < 0 && movingIsFinishing && !neighborIsFinishing) {
    return { ok: false, reason: 'Finishing ops should stay after create/boolean/pattern ops.' }
  }
  if (delta > 0 && !movingIsFinishing && neighborIsFinishing) {
    return { ok: false, reason: 'Move blocked: keep finishing ops at the end of the queue.' }
  }
  return { ok: true }
}

export type DesignSelection =
  | { scope: 'feature'; id: string }
  | { scope: 'entity'; id: string }
  | { scope: 'constraint'; id: string }
  | { scope: 'point'; id: string }
  | null

export type DesignSessionValue = {
  projectDir: string | null
  design: DesignFileV2
  pastLength: number
  features: PartFeaturesFile | null
  loaded: boolean
  /** Sketch/extrude preview mesh (Design workspace). */
  geometry: THREE.BufferGeometry | null
  /** 3D model view: kernel STL when fresh, else preview mesh. */
  viewportGeometry: THREE.BufferGeometry | null
  /** Human-readable inspect source for measure/section copy. */
  inspectMeshSourceLabel: string
  /** Last-read `part/kernel-manifest.json` (null if missing). */
  kernelManifest: KernelManifest | null
  /** When non-null, kernel mesh exists but current design/features may not match it. */
  kernelInspectStaleReason: KernelInspectStaleReason | null
  /** Reload `output/kernel-part.stl` + manifest (e.g. after Build STEP). */
  refreshKernelInspectGeometry: () => Promise<void>
  selection: DesignSelection
  setSelection: (s: DesignSelection) => void
  dispatch: React.Dispatch<DocAction>
  onDesignChange: (next: DesignFileV2) => void
  saveDesign: () => Promise<void>
  exportStl: () => Promise<void>
  removeEntity: (id: string) => void
  addPresetRect: () => void
  addConstraint: (c: {
    cType: SketchConstraint['type']
    cA: string
    cB: string
    cC?: string
    cD?: string
    cParam: string
  }) => void
  runSolve: () => void
  setParameter: (key: string, value: number) => void
  mirrorX: () => void
  pattern40X: () => void
  undo: () => void
  setFeatures: (f: PartFeaturesFile) => void
  appendKernelOp: (op: KernelPostSolidOp) => Promise<void>
  removeKernelOpAt: (index: number) => Promise<void>
  moveKernelOp: (index: number, delta: -1 | 1) => Promise<void>
  setKernelOpSuppressedAt: (index: number, suppressed: boolean) => Promise<void>
  updateFeatureSuppressed: (featureId: string, suppressed: boolean) => void
  solveReport: string
  onStatus?: (msg: string) => void
  onExportedStl?: (path: string) => void
}

const Ctx = createContext<DesignSessionValue | null>(null)

export function useDesignSession(): DesignSessionValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useDesignSession outside provider')
  return v
}

export function useDesignSessionOptional(): DesignSessionValue | null {
  return useContext(Ctx)
}

type ProviderProps = {
  projectDir: string | null
  /** Increment (e.g. after IPC merges disk-only edits) to reload sketch + features from project. */
  designDiskRevision?: number
  /**
   * Relative mesh paths from `project.json` (`meshes` array).
   * First `.stl` is shown in the 3D viewport when there is no kernel mesh and no sketch preview yet.
   */
  assetMeshRelPaths?: string[]
  children: ReactNode
  onStatus?: (msg: string) => void
  onExportedStl?: (path: string) => void
}

export function DesignSessionProvider({
  projectDir,
  designDiskRevision = 0,
  assetMeshRelPaths,
  children,
  onStatus,
  onExportedStl
}: ProviderProps) {
  const [{ design, past }, dispatch] = useReducer(docReducer, { design: emptyDesign(), past: [] })
  const [features, setFeatures] = useState<PartFeaturesFile | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [selection, setSelection] = useState<DesignSelection>(null)
  const [solveReport, setSolveReport] = useState('')
  const [kernelManifest, setKernelManifest] = useState<KernelManifest | null>(null)
  const [kernelInspectGeometry, setKernelInspectGeometry] = useState<THREE.BufferGeometry | null>(null)
  const [assetImportGeometry, setAssetImportGeometry] = useState<THREE.BufferGeometry | null>(null)
  const [designHashHex, setDesignHashHex] = useState('')
  const [featuresHashHex, setFeaturesHashHex] = useState('')
  const kernelGeomRef = useRef<THREE.BufferGeometry | null>(null)
  const assetGeomRef = useRef<THREE.BufferGeometry | null>(null)

  const fab = window.fab

  useEffect(() => {
    if (!projectDir) {
      dispatch({ type: 'replace', design: emptyDesign() })
      setLoaded(false)
      setFeatures(null)
      setSelection(null)
      return
    }
    let cancelled = false
    void (async () => {
      const [dr, fr] = await Promise.allSettled([fab.designLoad(projectDir), fab.featuresLoad(projectDir)])
      if (cancelled) return
      const errs: string[] = []
      if (dr.status === 'fulfilled') {
        dispatch({ type: 'replace', design: dr.value ?? emptyDesign() })
      } else {
        errs.push(formatLoadRejection('design/sketch.json', dr.reason))
        dispatch({ type: 'replace', design: emptyDesign() })
      }
      if (fr.status === 'fulfilled') {
        setFeatures(fr.value)
      } else {
        errs.push(formatLoadRejection('part/features.json', fr.reason))
        setFeatures(defaultPartFeatures())
      }
      if (errs.length) onStatus?.(errs.join(' · '))
      setLoaded(true)
    })()
    return () => {
      cancelled = true
    }
  }, [fab, projectDir, onStatus, designDiskRevision])

  const geometry = useMemo(() => {
    const g = buildExtrudedGeometry(design)
    if (!g) return null
    const M = sketchPreviewPlacementMatrix(design.sketchPlane)
    g.applyMatrix4(M)
    g.computeVertexNormals()
    return g
  }, [design])

  useEffect(() => {
    return () => {
      geometry?.dispose()
    }
  }, [geometry])

  useEffect(() => {
    let cancelled = false
    void computeKernelDesignHashWeb(design).then((h) => {
      if (!cancelled) setDesignHashHex(h)
    })
    return () => {
      cancelled = true
    }
  }, [design])

  useEffect(() => {
    let cancelled = false
    void computeKernelFeaturesHashWeb(features).then((h) => {
      if (!cancelled) setFeaturesHashHex(h)
    })
    return () => {
      cancelled = true
    }
  }, [features])

  const kernelInspectStale = useMemo(
    () =>
      kernelInspectStaleReason({
        manifest: kernelManifest,
        designHash: designHashHex,
        featuresHash: featuresHashHex
      }),
    [kernelManifest, designHashHex, featuresHashHex]
  )

  const refreshKernelInspectGeometry = useCallback(async () => {
    if (!projectDir) {
      setKernelManifest(null)
      if (kernelGeomRef.current) {
        kernelGeomRef.current.dispose()
        kernelGeomRef.current = null
      }
      setKernelInspectGeometry(null)
      return
    }
    const man = await fab.designReadKernelManifest(projectDir)
    setKernelManifest(man)
    if (!man?.ok) {
      if (kernelGeomRef.current) {
        kernelGeomRef.current.dispose()
        kernelGeomRef.current = null
      }
      setKernelInspectGeometry(null)
      return
    }
    const r = await fab.designReadKernelStlBase64(projectDir)
    if (!r.ok) {
      if (kernelGeomRef.current) {
        kernelGeomRef.current.dispose()
        kernelGeomRef.current = null
      }
      setKernelInspectGeometry(null)
      return
    }
    try {
      const loader = new STLLoader()
      const raw = atob(r.base64)
      const buf = new Uint8Array(raw.length)
      for (let k = 0; k < raw.length; k++) buf[k] = raw.charCodeAt(k)
      const geom = loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
      geom.computeVertexNormals()
      kernelGeomRef.current?.dispose()
      kernelGeomRef.current = geom
      setKernelInspectGeometry(geom)
    } catch (e) {
      console.error('Failed to parse kernel inspect STL:', e)
      if (kernelGeomRef.current) {
        kernelGeomRef.current.dispose()
        kernelGeomRef.current = null
      }
      setKernelInspectGeometry(null)
    }
  }, [fab, projectDir])

  useEffect(() => {
    if (!projectDir || !loaded) {
      setKernelManifest(null)
      if (kernelGeomRef.current) {
        kernelGeomRef.current.dispose()
        kernelGeomRef.current = null
      }
      setKernelInspectGeometry(null)
      return
    }
    void refreshKernelInspectGeometry()
  }, [projectDir, loaded, designDiskRevision, refreshKernelInspectGeometry])

  useEffect(() => {
    return () => {
      kernelGeomRef.current?.dispose()
      kernelGeomRef.current = null
    }
  }, [])

  const assetMeshPathsKey = useMemo(() => (assetMeshRelPaths ?? []).join('\0'), [assetMeshRelPaths])

  useEffect(() => {
    if (!projectDir || !loaded) {
      assetGeomRef.current?.dispose()
      assetGeomRef.current = null
      setAssetImportGeometry(null)
      return
    }
    const stlRel = (assetMeshRelPaths ?? []).find((p) => p.toLowerCase().endsWith('.stl'))
    if (!stlRel) {
      assetGeomRef.current?.dispose()
      assetGeomRef.current = null
      setAssetImportGeometry(null)
      return
    }
    let cancelled = false
    void (async () => {
      const r = await fab.assemblyReadStlBase64(projectDir, stlRel)
      if (cancelled) return
      if (!r.ok) {
        assetGeomRef.current?.dispose()
        assetGeomRef.current = null
        setAssetImportGeometry(null)
        if (r.error === 'ascii_stl_not_supported_in_viewport') {
          onStatus?.('Imported STL is ASCII; 3D preview needs binary STL. Re-import or convert the file.')
        }
        return
      }
      try {
        const loader = new STLLoader()
        const raw = atob(r.base64)
        const buf = new Uint8Array(raw.length)
        for (let k = 0; k < raw.length; k++) buf[k] = raw.charCodeAt(k)
        const geom = loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
        geom.computeVertexNormals()
        assetGeomRef.current?.dispose()
        assetGeomRef.current = geom
        setAssetImportGeometry(geom)
      } catch {
        assetGeomRef.current?.dispose()
        assetGeomRef.current = null
        setAssetImportGeometry(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectDir, loaded, assetMeshPathsKey, fab, onStatus])

  useEffect(() => {
    return () => {
      assetGeomRef.current?.dispose()
      assetGeomRef.current = null
    }
  }, [])

  const viewportGeometry = useMemo(() => {
    if (kernelInspectGeometry && kernelManifest?.ok && kernelInspectStale == null) {
      return kernelInspectGeometry
    }
    if (geometry) return geometry
    if (assetImportGeometry) return assetImportGeometry
    return null
  }, [kernelInspectGeometry, kernelManifest, kernelInspectStale, geometry, assetImportGeometry])

  const inspectMeshSourceLabel = useMemo(() => {
    if (kernelInspectGeometry && kernelManifest?.ok && kernelInspectStale == null) {
      const tol = kernelManifest.stlMeshAngularToleranceDeg
      const tolBit =
        typeof tol === 'number' && Number.isFinite(tol)
          ? ` STL export angular tolerance ${tol}° (manifest).`
          : ''
      return kernelManifest.inspectBackend === 'kernel_stl_tessellation'
        ? `Kernel STL (tessellated STEP export; not live B-rep).${tolBit}`
        : `Kernel STL (tessellated).${tolBit}`
    }
    if (geometry) return 'Sketch preview mesh'
    if (assetImportGeometry) return 'Imported asset (STL)'
    return '—'
  }, [kernelInspectGeometry, kernelManifest, kernelInspectStale, geometry, assetImportGeometry])

  const onDesignChange = useCallback((next: DesignFileV2) => {
    dispatch({ type: 'edit', design: next })
  }, [])

  const saveDesign = useCallback(async () => {
    if (!projectDir) return
    try {
      await fab.designSave(projectDir, JSON.stringify(design))
      const derived = derivePartFeatures(design, features)
      await fab.featuresSave(projectDir, JSON.stringify(derived))
      setFeatures(derived)
      onStatus?.('Design + feature metadata saved.')
    } catch (e) {
      onStatus?.(e instanceof Error ? e.message : String(e))
    }
  }, [fab, projectDir, design, features, onStatus])

  const exportStl = useCallback(async () => {
    if (!projectDir || !geometry) {
      onStatus?.('Open a project and add a closed profile first.')
      return
    }
    const mesh = new THREE.Mesh(geometry.clone(), new THREE.MeshBasicMaterial())
    mesh.updateMatrixWorld(true)
    const b64 = meshToStlBase64(mesh)
    mesh.geometry.dispose()
    const name = `design-${Date.now()}.stl`
    const r = await fab.modelExportStl(projectDir, name, b64)
    if (!r.ok) {
      onStatus?.('Export failed.')
      return
    }
    onStatus?.(`Exported ${r.path}`)
    onExportedStl?.(r.path)
  }, [fab, projectDir, geometry, onStatus, onExportedStl])

  const removeEntity = useCallback(
    (id: string) => {
      dispatch({
        type: 'edit',
        design: { ...design, entities: design.entities.filter((e) => e.id !== id) }
      })
      setSelection((s) => (s?.scope === 'entity' && s.id === id ? null : s))
    },
    [design]
  )

  const addPresetRect = useCallback(() => {
    const id = crypto.randomUUID()
    dispatch({
      type: 'edit',
      design: {
        ...design,
        entities: [...design.entities, { id, kind: 'rect', cx: 0, cy: 0, w: 50, h: 30, rotation: 0 }]
      }
    })
  }, [design])

  const addConstraint = useCallback(
    (opts: {
      cType: SketchConstraint['type']
      cA: string
      cB: string
      cC?: string
      cD?: string
      cParam: string
    }) => {
      const { cType, cA, cB, cC = '', cD = '', cParam } = opts
      const id = crypto.randomUUID()
      let nextParams = { ...design.parameters }
      if (cType === 'distance' && nextParams[cParam] == null) {
        nextParams[cParam] = 25
      }
      if (cType === 'angle' && nextParams[cParam] == null) {
        nextParams[cParam] = 90
      }
      if (cType === 'radius' && nextParams[cParam] == null) {
        nextParams[cParam] = 10
      }
      if (cType === 'diameter' && nextParams[cParam] == null) {
        nextParams[cParam] = 20
      }
      let c: SketchConstraint
      if (cType === 'fix') {
        c = { id, type: 'fix', pointId: cA }
      } else if (cType === 'distance') {
        c = { id, type: 'distance', a: { pointId: cA }, b: { pointId: cB }, parameterKey: cParam }
      } else if (cType === 'perpendicular' || cType === 'parallel' || cType === 'equal') {
        c = {
          id,
          type: cType,
          a1: { pointId: cA },
          b1: { pointId: cB },
          a2: { pointId: cC },
          b2: { pointId: cD }
        }
      } else if (cType === 'angle') {
        c = {
          id,
          type: 'angle',
          a1: { pointId: cA },
          b1: { pointId: cB },
          a2: { pointId: cC },
          b2: { pointId: cD },
          parameterKey: cParam
        }
      } else if (cType === 'collinear') {
        c = {
          id,
          type: 'collinear',
          a: { pointId: cA },
          b: { pointId: cB },
          c: { pointId: cC }
        }
      } else if (cType === 'midpoint') {
        c = {
          id,
          type: 'midpoint',
          m: { pointId: cA },
          a: { pointId: cB },
          b: { pointId: cC }
        }
      } else if (cType === 'tangent') {
        const arcEnt = design.entities.find((e) => {
          if (e.kind !== 'arc') return false
          return e.startId === cC || e.endId === cC
        })
        if (!arcEnt || arcEnt.kind !== 'arc') {
          onStatus?.('Tangent: point C must be the start or end vertex of an arc entity.')
          return
        }
        const arcTangentAt: 'start' | 'end' = arcEnt.startId === cC ? 'start' : 'end'
        const lineTangentAt: 'a' | 'b' = cC === cB ? 'b' : 'a'
        c = {
          id,
          type: 'tangent',
          lineA: { pointId: cA },
          lineB: { pointId: cB },
          arcStart: { pointId: arcEnt.startId },
          arcVia: { pointId: arcEnt.viaId },
          arcEnd: { pointId: arcEnt.endId },
          arcTangentAt,
          lineTangentAt
        }
      } else if (cType === 'symmetric') {
        c = {
          id,
          type: 'symmetric',
          p1: { pointId: cA },
          p2: { pointId: cB },
          la: { pointId: cC },
          lb: { pointId: cD }
        }
      } else if (cType === 'concentric') {
        c = {
          id,
          type: 'concentric',
          entityAId: cA,
          entityBId: cB
        }
      } else if (cType === 'radius' || cType === 'diameter') {
        c = {
          id,
          type: cType,
          entityId: cA,
          parameterKey: cParam
        }
      } else {
        c = { id, type: cType, a: { pointId: cA }, b: { pointId: cB } }
      }
      dispatch({
        type: 'edit',
        design: {
          ...design,
          parameters: nextParams,
          constraints: [...design.constraints, c]
        }
      })
      onStatus?.('Constraint added — run Solve.')
    },
    [design, onStatus]
  )

  const runSolve = useCallback(() => {
    const base = cloneDesign(design)
    solveSketch(base, 140, 0.45)
    const rep = sketchResidualReport(base)
    setSolveReport(`Energy≈${rep.total.toExponential(2)}\n${rep.lines.join('\n')}`)
    dispatch({ type: 'edit', design: base })
    onStatus?.('Sketch solved.')
  }, [design, onStatus])

  const setParameter = useCallback(
    (key: string, value: number) => {
      dispatch({
        type: 'edit',
        design: { ...design, parameters: { ...design.parameters, [key]: value } }
      })
    },
    [design]
  )

  const mirrorX = useCallback(() => {
    dispatch({ type: 'edit', design: mirrorDesignAcrossYAxis(design) })
  }, [design])

  const pattern40X = useCallback(() => {
    dispatch({ type: 'edit', design: linearPatternSketch(design, 40, 0) })
  }, [design])

  const undo = useCallback(() => dispatch({ type: 'undo' }), [])

  const appendKernelOp = useCallback(
    async (op: KernelPostSolidOp) => {
      if (!projectDir) return
      const base = features ?? derivePartFeatures(design, null)
      const next: PartFeaturesFile = {
        ...base,
        kernelOps: [...(base.kernelOps ?? []), op]
      }
      try {
        await fab.featuresSave(projectDir, JSON.stringify(next))
        setFeatures(next)
        onStatus?.('Kernel op saved — run Build STEP (kernel) to apply.')
      } catch (e) {
        onStatus?.(e instanceof Error ? e.message : String(e))
      }
    },
    [fab, projectDir, features, design, onStatus]
  )

  const removeKernelOpAt = useCallback(
    async (index: number) => {
      if (!projectDir) return
      const base = features ?? derivePartFeatures(design, null)
      const ops = [...(base.kernelOps ?? [])]
      if (index < 0 || index >= ops.length) return
      ops.splice(index, 1)
      const next: PartFeaturesFile = { ...base, kernelOps: ops.length ? ops : undefined }
      try {
        await fab.featuresSave(projectDir, JSON.stringify(next))
        setFeatures(next)
        onStatus?.('Kernel op removed.')
      } catch (e) {
        onStatus?.(e instanceof Error ? e.message : String(e))
      }
    },
    [fab, projectDir, features, design, onStatus]
  )

  const moveKernelOp = useCallback(
    async (index: number, delta: -1 | 1) => {
      if (!projectDir) return
      const base = features ?? derivePartFeatures(design, null)
      const ops = [...(base.kernelOps ?? [])]
      const j = index + delta
      if (index < 0 || index >= ops.length || j < 0 || j >= ops.length) return
      const a = ops[index]!
      const b = ops[j]!
      const order = canSwapKernelOpOrder(a, b, delta)
      if (!order.ok) {
        onStatus?.(order.reason)
        return
      }
      ops[index] = b
      ops[j] = a
      const next: PartFeaturesFile = { ...base, kernelOps: ops }
      try {
        await fab.featuresSave(projectDir, JSON.stringify(next))
        setFeatures(next)
        onStatus?.('Kernel op order updated.')
      } catch (e) {
        onStatus?.(e instanceof Error ? e.message : String(e))
      }
    },
    [fab, projectDir, features, design, onStatus]
  )

  const setKernelOpSuppressedAt = useCallback(
    async (index: number, suppressed: boolean) => {
      if (!projectDir) return
      const base = features ?? derivePartFeatures(design, null)
      const ops = [...(base.kernelOps ?? [])]
      if (index < 0 || index >= ops.length) return
      const cur = ops[index]!
      ops[index] = { ...cur, suppressed: suppressed ? true : undefined }
      const next: PartFeaturesFile = { ...base, kernelOps: ops }
      try {
        await fab.featuresSave(projectDir, JSON.stringify(next))
        setFeatures(next)
        onStatus?.(suppressed ? 'Kernel op suppressed (skipped in build).' : 'Kernel op active again.')
      } catch (e) {
        onStatus?.(e instanceof Error ? e.message : String(e))
      }
    },
    [fab, projectDir, features, design, onStatus]
  )

  const updateFeatureSuppressed = useCallback(
    async (featureId: string, suppressed: boolean) => {
      if (!features || !projectDir) return
      const items = features.items.map((it) => (it.id === featureId ? { ...it, suppressed } : it))
      const next: PartFeaturesFile = { ...features, items }
      setFeatures(next)
      try {
        await fab.featuresSave(projectDir, JSON.stringify(next))
        onStatus?.(suppressed ? 'Feature suppressed.' : 'Feature unsuppressed.')
      } catch (e) {
        onStatus?.(e instanceof Error ? e.message : String(e))
      }
    },
    [features, projectDir, fab, onStatus]
  )

  const value = useMemo<DesignSessionValue>(
    () => ({
      projectDir,
      design,
      pastLength: past.length,
      features,
      loaded,
      geometry,
      viewportGeometry,
      inspectMeshSourceLabel,
      kernelManifest,
      kernelInspectStaleReason: kernelInspectStale,
      refreshKernelInspectGeometry,
      selection,
      setSelection,
      dispatch,
      onDesignChange,
      saveDesign,
      exportStl,
      removeEntity,
      addPresetRect,
      addConstraint,
      runSolve,
      setParameter,
      mirrorX,
      pattern40X,
      undo,
      setFeatures,
      appendKernelOp,
      removeKernelOpAt,
      moveKernelOp,
      setKernelOpSuppressedAt,
      updateFeatureSuppressed,
      solveReport,
      onStatus,
      onExportedStl
    }),
    [
      projectDir,
      design,
      past.length,
      features,
      loaded,
      geometry,
      viewportGeometry,
      inspectMeshSourceLabel,
      kernelManifest,
      kernelInspectStale,
      refreshKernelInspectGeometry,
      selection,
      solveReport,
      onDesignChange,
      saveDesign,
      exportStl,
      removeEntity,
      addPresetRect,
      addConstraint,
      runSolve,
      setParameter,
      mirrorX,
      pattern40X,
      undo,
      appendKernelOp,
      removeKernelOpAt,
      moveKernelOp,
      setKernelOpSuppressedAt,
      updateFeatureSuppressed,
      onStatus,
      onExportedStl
    ]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
