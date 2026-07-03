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
import {
  emptyDesign,
  addUserParameter as addUserParameterOp,
  editUserParameterExpression as editUserParameterOp,
  renameUserParameter as renameUserParameterOp,
  deleteUserParameter as deleteUserParameterOp
} from '../../shared/design-schema'
import { resolveUserParametersAndSolve } from './sketch-dimension-drive'
import { formatLoadRejection } from '../../shared/file-parse-errors'
import {
  decideRecoveryOffer,
  type DesignRecoverySnapshot
} from '../../shared/design-recovery'
import {
  kernelInspectStaleReason,
  type KernelInspectStaleReason
} from '../../shared/kernel-inspect-hash'
import { formatKernelBuildStatus } from '../../shared/kernel-build-messages'
import type { KernelManifest } from '../../shared/kernel-manifest-schema'
import {
  defaultPartFeatures,
  kernelPostSolidOpSchema,
  type KernelPostSolidOp,
  type PartFeaturesFile
} from '../../shared/part-features-schema'
import {
  emptyDrawingViewState,
  emptyDrawingWorkspaceState,
  foldDrawingState,
  hydrateActiveSheet,
  hydrateDrawingWorkspace,
  type DrawingViewState,
  type DrawingWorkspaceState
} from '../../shared/drawing-hydrate'
import type { DrawingFile } from '../../shared/drawing-sheet-schema'
import {
  addSheet as addDrawingSheet,
  deleteSheet as deleteDrawingSheet,
  renameSheet as renameDrawingSheet,
  resolveActiveSheetId as resolveDrawingActiveSheetId,
  setActiveSheet as setDrawingActiveSheet
} from '../../shared/drawing-sheet-ops'
import {
  applyTimelineAction,
  invertAppendKernelOp,
  invertRemoveKernelOpAt,
  invertMoveKernelOp,
  invertReorderKernelOps,
  invertUpdateKernelOpAt,
  invertSetKernelOpSuppressedAt,
  invertSetKernelRollbackMarker,
  type TimelineCommitFold,
  type TimelineState
} from './feature-timeline-actions'
import { UndoManager, ReplayCommand } from '../src/undo-manager'
import {
  isTypableKeyboardTarget,
  matchesRedo,
  matchesUndo
} from '../../shared/app-keyboard-shortcuts'
import { linearPatternSketch, mirrorDesignAcrossYAxis } from './design-ops'
import { derivePartFeatures } from './derive-features'
import { meshToStlBase64 } from './export-stl'
import { sketchPreviewPlacementMatrix } from './sketch-preview-placement'
import { buildExtrudedGeometry } from './sketch-mesh'
import { buildKernelPickGeometry } from './viewport3d-geometry'
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

/**
 * Debounce window (ms) for the no-code auto-build. A timeline gesture (append /
 * edit / reorder / suppress / roll-back) persists features.json then bumps the
 * timeline signature; this delay coalesces a burst of gestures into ONE kernel
 * build so the operator isn't slicing OCC on every keystroke. Matches the
 * 300–400 ms cadence used elsewhere (DesignWorkspace's list-ops debounce).
 */
const KERNEL_AUTO_BUILD_DEBOUNCE_MS = 400

/**
 * Debounce window (ms) for persisting the Drawings sheet to `drawing.json`. A
 * title-block keystroke or a placed dimension flips `drawing` state immediately
 * (the UI stays live); this delay coalesces a typing burst into ONE `drawing:save`
 * so we never write the file on every character. Matches the 300–400 ms cadence
 * used by the kernel auto-build + the DesignWorkspace list-ops debounce.
 */
const DRAWING_SAVE_DEBOUNCE_MS = 400

/**
 * AUTOSAVE + CRASH RECOVERY (Phase 1, docs/PARITY-ROADMAP.md). A sketch edit
 * schedules a recovery-snapshot write this many ms after the LAST edit (a
 * drawing burst coalesces into one write), and the periodic floor guarantees
 * a dirty session is snapshotted at least this often even while the operator
 * keeps editing continuously (each edit resets the debounce timer, so the
 * floor is what bounds worst-case loss). Snapshot writes go to
 * userData/recovery/ via `recovery:designWrite` and NEVER touch React state.
 */
const DESIGN_RECOVERY_DEBOUNCE_MS = 2000
const DESIGN_RECOVERY_PERIODIC_FLOOR_MS = 30_000

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

/**
 * The identity a loaded design is keyed by: the open project + its on-disk
 * revision. The load effect remembers the last key and skips reloading when it
 * is unchanged, so a spurious effect re-fire (e.g. the provider's inline
 * `onStatus` arrow changing identity on a parent re-render) can never reload the
 * on-disk sketch over unsaved in-memory edits. `null` when no project is open.
 * Exported so the regression test pins the anti-clobber contract.
 */
export function designLoadKey(
  projectDir: string | null,
  designDiskRevision: number | undefined
): string | null {
  return projectDir === null ? null : JSON.stringify([projectDir, designDiskRevision ?? 0])
}


/**
 * Display metadata for a pending crash-recovery offer (the snapshot itself
 * stays in a provider ref so the large design payload never churns renders).
 */
export type DesignRecoveryOffer = {
  savedAtMs: number
  entityCount: number
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
  /** True while a no-code kernel build (`build_part.py`) is in flight. */
  kernelBuilding: boolean
  /** Reload `output/kernel-part.stl` + manifest (e.g. after Build STEP). */
  refreshKernelInspectGeometry: () => Promise<void>
  /**
   * No-code build→render: persist the live sketch, run the CadQuery kernel build
   * (`design/sketch.json` + `part/features.json` kernelOps → STEP + STL), then
   * reload the built STL into {@link viewportGeometry}. Surfaces build
   * warnings/errors via `onStatus`. Never throws. No-op without a project.
   * The kernel-op timeline editors fire this automatically (debounced); also
   * callable directly for an explicit "Build" action.
   */
  buildKernelPart: () => Promise<void>
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
  // ── USER PARAMETERS (design-side named params + expressions, Phase-3) ─────
  // Each mutation runs the pure reference-integrity op (design-schema.ts), then
  // — on success — RESOLVES every user parameter into the numeric `parameters`
  // cache and RE-SOLVES the sketch (`resolveUserParametersAndSolve`), and
  // dispatches an `edit` so the change lands on the SKETCH undo stack (the
  // docReducer `past` stack — user parameters live in the design file exactly
  // like `parameters`/`entities`, so they belong on the sketch undo route, NOT
  // the timeline `undoableCommit` stack; documented on the value below). A
  // rejected op (invalid name, cycle-free duplicate, delete-while-referenced)
  // surfaces its reason via `onStatus` and does NOT dispatch.
  /** Add a user parameter `name = expression`. Rejections toast; no state change. */
  addUserParameter: (name: string, expression: string) => void
  /** Set an existing user parameter's expression + re-resolve dependents. */
  editUserParameter: (name: string, expression: string) => void
  /** Rename a user parameter, cascading references (expressions + dimension keys). */
  renameUserParameter: (from: string, to: string) => void
  /** Delete a user parameter (blocked + toasted when still referenced). */
  deleteUserParameter: (name: string) => void
  mirrorX: () => void
  pattern40X: () => void
  undo: () => void
  setFeatures: (f: PartFeaturesFile) => void
  appendKernelOp: (op: KernelPostSolidOp) => Promise<void>
  /**
   * FEATURE RE-EDIT — replace the kernel op at `index` IN PLACE (same timeline
   * position). Validates the replacement against `kernelPostSolidOpSchema`
   * before accepting, preserves the op's `suppressed` flag unless the edit
   * explicitly changes it, and keeps the roll-back bar where it is (list
   * length is unchanged). Persists + rebuilds through the same serialized
   * commit path as the other timeline editors.
   */
  updateKernelOpAt: (index: number, op: KernelPostSolidOp) => Promise<void>
  removeKernelOpAt: (index: number) => Promise<void>
  moveKernelOp: (index: number, delta: -1 | 1) => Promise<void>
  /** Drag-to-reorder: move the kernel op at `from` to land at `to`. */
  reorderKernelOps: (from: number, to: number) => Promise<void>
  setKernelOpSuppressedAt: (index: number, suppressed: boolean) => Promise<void>
  /** Set (index >= 0) or clear (`null`) the design-level roll-back marker. */
  setKernelRollbackMarker: (index: number | null) => Promise<void>
  updateFeatureSuppressed: (featureId: string, suppressed: boolean) => void
  // ── FEATURE-TIMELINE UNDO/REDO (Phase-3 parity) ──────────────────────────
  // A timeline-scoped undo stack, SEPARATE from the sketch surface's own
  // `SketchHistory` (own linear stack + own Ctrl+Z handler, mounted only in
  // sketch mode). Routing rule (documented on the keydown effect below): while
  // the sketch surface is mounted it owns Ctrl+Z / Ctrl+Y; otherwise (3D
  // viewport / feature-timeline focus) these fire the TIMELINE stack. Every
  // timeline mutation (append / remove / move / reorder / update / suppress /
  // roll-back) is recorded as an undoable command whose inverse replays through
  // the SAME `commitKernelFeatures` chain (persist + debounced rebuild), so
  // undo/redo never raw-poke React state or disk. Optional so hand-built test
  // session values stay valid (additive change).
  /** Undo the most recent timeline mutation (no-op when the stack is empty). */
  timelineUndo?: () => void
  /** Redo the most recently undone timeline mutation. */
  timelineRedo?: () => void
  /** Whether there is a timeline mutation to undo. */
  canTimelineUndo?: boolean
  /** Whether there is a timeline mutation to redo. */
  canTimelineRedo?: boolean
  solveReport: string
  /**
   * The Drawings sheet state hydrated from `<projectDir>/drawing/drawing.json`
   * on project-open (dimensions + GD&T frames + title block + the remaining
   * annotation arrays). `null` until the first load settles for the open
   * project (or when no project is open); the Drawings workspace renders from
   * the empty default until then. Documentation overlays only — never read by
   * CAM/G-code (Safety Rule 1).
   */
  drawing: DrawingViewState | null
  /**
   * Persist a new Drawings sheet state. The session DEBOUNCES the
   * `drawing:save` and folds the COMMITTED state through the `DrawingFile`
   * schema (additive — a legacy/empty `drawing.json` round-trips unchanged,
   * Safety Rule 2). The fold targets the ACTIVE sheet (see {@link drawingWorkspace}),
   * so editing a secondary tab never clobbers the primary sheet. No-op without an
   * open project. Survives reload + a Drawings↔other-route switch.
   */
  onDrawingChange: (next: DrawingViewState) => void
  /**
   * The full multi-sheet Drawings workspace (every sheet, in order, + the
   * resolved active sheet id) hydrated from `drawing.json`. The Drawings tab
   * strip renders from this; {@link drawing} above is the ACTIVE sheet's view
   * state derived from it (so per-sheet content swaps on a tab switch). `null`
   * until the first load settles for the open project (or when no project is
   * open). Documentation overlays only — never read by CAM/G-code (Safety Rule 1).
   */
  drawingWorkspace: DrawingWorkspaceState | null
  /**
   * Switch the active Drawings sheet. Re-derives {@link drawing} from the newly
   * active sheet (so the per-sheet `persisted*` props re-point) and persists the
   * active-id change (debounced). No-op without an open project or for an
   * unknown id.
   */
  onDrawingSelectSheet: (sheetId: string) => void
  /**
   * Append a fresh empty Drawings sheet (the session mints a stable id + name)
   * and make it active. Persists the new sheet set. No-op without an open project.
   */
  onDrawingAddSheet: () => void
  /** Rename a Drawings sheet (trimmed, non-empty enforced). Persists. */
  onDrawingRenameSheet: (sheetId: string, name: string) => void
  /**
   * Delete a Drawings sheet, keeping a minimum of one (the engine op refuses to
   * empty the file). Re-points the active id at a neighbour when the active sheet
   * is deleted. Persists. No-op without an open project.
   */
  onDrawingDeleteSheet: (sheetId: string) => void
  /**
   * AUTOSAVE + CRASH RECOVERY - non-null while a recovery snapshot NEWER than
   * the persisted sketch is on offer for the open project. The banner renders
   * from this; restoring is ALWAYS an explicit user action (Cycle-249 rule:
   * no effect may replace in-memory design state). Optional so existing
   * hand-built test session values stay valid (additive change).
   */
  recoveryOffer?: DesignRecoveryOffer | null
  /** Apply the offered snapshot to the in-memory design (undoable edit). */
  restoreRecoveredDesign?: () => void
  /** Dismiss the offer and delete the snapshot file. */
  discardRecoveredDesign?: () => void
  onStatus?: (msg: string) => void
  onExportedStl?: (path: string) => void
}

const Ctx = createContext<DesignSessionValue | null>(null)

/**
 * Raw context object. Exported ONLY so render-pin tests can mount a host that
 * calls `useDesignSession()` with a hand-built session value (the real
 * `DesignSessionProvider` derives its value asynchronously from `fab`, which a
 * synchronous `renderToStaticMarkup` cannot flush). Production code must use
 * `DesignSessionProvider` — never wrap `Ctx.Provider` directly.
 */
export const DesignSessionContext = Ctx

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
  // Drawings sheet state hydrated from drawing.json on project-open. `null`
  // until the first load settles (or when no project is open). See the drawing
  // load + persist block below. `drawing` is the ACTIVE sheet's view state (per-
  // sheet annotations); `drawingWorkspace` is the full sheet set + active id.
  const [drawing, setDrawing] = useState<DrawingViewState | null>(null)
  const [drawingWorkspace, setDrawingWorkspace] = useState<DrawingWorkspaceState | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [selection, setSelection] = useState<DesignSelection>(null)
  const [solveReport, setSolveReport] = useState('')
  const [kernelManifest, setKernelManifest] = useState<KernelManifest | null>(null)
  const [kernelInspectGeometry, setKernelInspectGeometry] = useState<THREE.BufferGeometry | null>(null)
  const [assetImportGeometry, setAssetImportGeometry] = useState<THREE.BufferGeometry | null>(null)
  const [designHashHex, setDesignHashHex] = useState('')
  const [featuresHashHex, setFeaturesHashHex] = useState('')
  const [kernelBuilding, setKernelBuilding] = useState(false)
  const kernelGeomRef = useRef<THREE.BufferGeometry | null>(null)
  const assetGeomRef = useRef<THREE.BufferGeometry | null>(null)
  // No-code build→render serialization. `kernelBuildInFlightRef` guards against
  // overlapping CadQuery builds (the sidecar is single-flight per process);
  // `kernelRebuildPendingRef` coalesces a request that arrives mid-build into a
  // single trailing rebuild so the final on-screen solid always reflects the
  // latest timeline. `lastBuiltTimelineSigRef` lets the auto-build effect skip
  // the initial load + no-op re-renders (only an actual timeline change builds).
  const kernelBuildInFlightRef = useRef(false)
  const kernelRebuildPendingRef = useRef(false)
  const lastBuiltTimelineSigRef = useRef<string | null>(null)
  // -- AUTOSAVE + CRASH RECOVERY state ------------------------------------
  // `recoveryOffer` drives the restore banner; the offered snapshot lives in
  // `recoverySnapshotRef` until the operator explicitly restores or discards.
  // `lastPersistedDesignJsonRef` is the dirty baseline: the JSON of the design
  // as last LOADED from or SAVED to design/sketch.json. null = baseline
  // unknown (sketch.json failed to load) - then we neither snapshot NOR
  // delete, so a possibly-valuable existing recovery file is preserved.
  const [recoveryOffer, setRecoveryOffer] = useState<DesignRecoveryOffer | null>(null)
  const recoverySnapshotRef = useRef<DesignRecoverySnapshot | null>(null)
  const lastPersistedDesignJsonRef = useRef<string | null>(null)
  const lastRecoveryWriteMsRef = useRef(0)
  // One recovery-offer check per open project (the anti-clobber key pattern:
  // a re-render re-firing the effect can never re-run the read or the offer).
  const lastRecoveryOfferKeyRef = useRef<string | null>(null)

  const fab = window.fab

  // task: sketches disappearing — read the latest onStatus through a ref so the
  // load effect below does NOT list it as a dependency. The provider passes an
  // inline arrow (new identity each parent render); depending on it re-ran the
  // destructive disk reload on every re-render, wiping unsaved sketch edits.
  const onStatusRef = useRef(onStatus)
  onStatusRef.current = onStatus
  // The (projectDir, designDiskRevision) key the design was last loaded for; the
  // load effect skips a redundant reload when unchanged (the anti-clobber guard).
  const lastDesignLoadKeyRef = useRef<string | null>(null)

  // ── Drawings persistence plumbing (mirrors the design load-guard + the
  // kernel-features serialized-write pattern) ─────────────────────────────────
  // The (projectDir) key the drawing was last hydrated for. The load effect
  // skips a redundant reload when unchanged so a re-render that re-fires the
  // effect can NEVER reload drawing.json over unsaved in-memory drawing edits
  // (the Cycle-249 anti-clobber guard, applied to the Drawings sheet).
  const lastDrawingLoadKeyRef = useRef<string | null>(null)
  // The freshest COMMITTED drawing state (the ACTIVE sheet's view state). The
  // debounced save reads THIS (not a render-cycle closure) so it always persists
  // the latest committed edits and never captures a stale eager-updater snapshot
  // (Cycle-256). Updated synchronously by `onDrawingChange` before it schedules
  // the save.
  const drawingRef = useRef<DrawingViewState | null>(null)
  drawingRef.current = drawing
  // The id of the ACTIVE Drawings sheet — the fold target so a secondary-tab
  // edit lands on the right sheet (not always the primary). Kept in a ref so the
  // debounced flush + the unmount flush read the freshest value without listing
  // `drawingWorkspace` in their deps.
  const drawingActiveSheetIdRef = useRef<string | null>(null)
  drawingActiveSheetIdRef.current = drawingWorkspace?.activeSheetId ?? null
  // The LOADED-from-disk DrawingFile for the open project. The fold persists
  // onto this base so any sheets / sheet fields the renderer does not model are
  // preserved across a save (additive, Safety Rule 2). Updated on each load AND
  // on every persisted edit (so the next fold lands on the prior result).
  const drawingFileBaseRef = useRef<DrawingFile | null>(null)
  // Debounce timer for the drawing save; cleared on unmount + on every change so
  // a typing burst in the title block coalesces into ONE save.
  const drawingSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Serialize drawing.json writes so two debounced saves never interleave.
  const drawingWriteChainRef = useRef<Promise<void>>(Promise.resolve())
  // Latest projectDir, read by the unmount FLUSH (its effect has [] deps so it
  // can't close over the live projectDir prop).
  const projectDirRef = useRef(projectDir)
  projectDirRef.current = projectDir

  // task: kernel-op edits clobbering each other — the seven timeline editors
  // (append / remove / move / suppress / reorder / roll-back / feature-suppress)
  // each read `features`, fold a `next`, then `featuresSave` + `setFeatures`. The
  // render-cycle `features` closure goes STALE the instant two gestures fire
  // inside one IPC round-trip (a feature dialog stays open after Apply, the
  // timeline buttons have no in-flight gate), so the second gesture folds onto
  // the pre-first snapshot and the last write silently drops the first edit on
  // disk AND in memory. Fix mirrors the onStatus/Cycle-249 ref pattern: read the
  // freshest features through `featuresRef` (refreshed every render AND updated
  // synchronously before each await), and serialize the disk writes behind a
  // single promise chain so each fold lands on the prior result, never a stale
  // base. `designRef` keeps the rare `derivePartFeatures` fallback (no features
  // loaded yet) off the same stale-closure trap.
  const featuresRef = useRef(features)
  featuresRef.current = features
  const designRef = useRef(design)
  designRef.current = design
  const featuresWriteChainRef = useRef<Promise<void>>(Promise.resolve())
  // FEATURE-TIMELINE UNDO/REDO — one timeline-scoped UndoManager per provider
  // (default 50-entry stack, 1000 ms coalescing — same as the sketch numeric
  // edits). `timelineUndoVersion` mirrors the manager's monotonic version into
  // React state so `canTimelineUndo/Redo` re-render on every stack change; the
  // subscription is wired once in an effect below.
  const timelineUndoRef = useRef<UndoManager | null>(null)
  if (timelineUndoRef.current === null) timelineUndoRef.current = new UndoManager()
  const [timelineUndoVersion, setTimelineUndoVersion] = useState(0)
  useEffect(() => {
    const mgr = timelineUndoRef.current
    if (!mgr) return
    return mgr.on('change', () => setTimelineUndoVersion(mgr.version))
  }, [])

  useEffect(() => {
    if (!projectDir) {
      lastDesignLoadKeyRef.current = null
      lastPersistedDesignJsonRef.current = null
      dispatch({ type: 'replace', design: emptyDesign() })
      setLoaded(false)
      setFeatures(null)
      setSelection(null)
      return
    }
    // Anti-clobber guard (task: sketches disappearing): only (re)load from
    // disk when the project or its on-disk revision actually changed. Without
    // it a re-render that re-ran this effect would `replace` the in-memory
    // design with the on-disk copy, silently wiping unsaved sketch edits
    // (they live only in the reducer until an explicit Save).
    const loadKey = designLoadKey(projectDir, designDiskRevision)
    if (loadKey !== null && lastDesignLoadKeyRef.current === loadKey) return
    lastDesignLoadKeyRef.current = loadKey
    let cancelled = false
    void (async () => {
      const [dr, fr] = await Promise.allSettled([fab.designLoad(projectDir), fab.featuresLoad(projectDir)])
      if (cancelled) return
      const errs: string[] = []
      if (dr.status === 'fulfilled') {
        const loadedDesign = dr.value ?? emptyDesign()
        // AUTOSAVE baseline: memory now matches disk (or a fresh empty design
        // when no sketch.json exists yet); dirty checks compare against this.
        lastPersistedDesignJsonRef.current = JSON.stringify(loadedDesign)
        dispatch({ type: 'replace', design: loadedDesign })
      } else {
        errs.push(formatLoadRejection('design/sketch.json', dr.reason))
        // Load FAILED (unreadable sketch.json, not merely absent): baseline
        // unknown. Never snapshot the empty fallback over a possibly-valuable
        // recovery file, and never delete one on teardown.
        lastPersistedDesignJsonRef.current = null
        dispatch({ type: 'replace', design: emptyDesign() })
      }
      if (fr.status === 'fulfilled') {
        setFeatures(fr.value)
      } else {
        errs.push(formatLoadRejection('part/features.json', fr.reason))
        setFeatures(defaultPartFeatures())
      }
      if (errs.length) onStatusRef.current?.(errs.join(' · '))
      setLoaded(true)
    })()
    return () => {
      cancelled = true
    }
  }, [fab, projectDir, designDiskRevision])

  // ── Drawings load → hydrate ────────────────────────────────────────────────
  //
  // Hydrate the Drawings sheet (dimensions + GD&T + title block + annotations)
  // from `<projectDir>/drawing/drawing.json` when a project opens. Keyed on
  // (projectDir) ALONE — NOT designDiskRevision — so a design-only revision bump
  // (e.g. an IPC parameter merge) can never re-fire this and reload drawing.json
  // over unsaved in-memory drawing edits. The (projectDir) load-key guard makes
  // a plain re-render that re-runs the effect a no-op (the Cycle-249 anti-clobber
  // contract, applied to the Drawings sheet). A failed load folds to a status
  // toast and seeds empty state. NOTE: deliberately does NOT depend on
  // designDiskRevision — the eslint dep rule is satisfied because the only
  // load-bearing inputs are `fab` (stable) + `projectDir`.
  useEffect(() => {
    if (!projectDir) {
      lastDrawingLoadKeyRef.current = null
      drawingFileBaseRef.current = null
      drawingRef.current = null
      drawingActiveSheetIdRef.current = null
      setDrawing(null)
      setDrawingWorkspace(null)
      return
    }
    // Anti-clobber guard: only (re)load when the project actually changed.
    if (lastDrawingLoadKeyRef.current === projectDir) return
    lastDrawingLoadKeyRef.current = projectDir
    let cancelled = false
    void (async () => {
      try {
        const file = await fab.drawingLoad(projectDir)
        if (cancelled) return
        drawingFileBaseRef.current = file
        // The full sheet set + active id drive the tab strip; the ACTIVE sheet's
        // view state drives the per-sheet annotation props.
        const workspace = hydrateDrawingWorkspace(file)
        const view = hydrateActiveSheet(file)
        drawingRef.current = view
        drawingActiveSheetIdRef.current = workspace.activeSheetId
        setDrawing(view)
        setDrawingWorkspace(workspace)
      } catch (e) {
        if (cancelled) return
        // Honest fallback: seed empty state so the workspace still renders, and
        // start the persist base from an empty file (a later save creates a
        // clean drawing.json rather than corrupting the unreadable one).
        drawingFileBaseRef.current = null
        const empty = emptyDrawingViewState()
        drawingRef.current = empty
        drawingActiveSheetIdRef.current = null
        setDrawing(empty)
        setDrawingWorkspace(emptyDrawingWorkspaceState())
        onStatusRef.current?.(
          formatLoadRejection('drawing/drawing.json', e instanceof Error ? e : String(e))
        )
      }
    })()
    return () => {
      cancelled = true
    }
  }, [fab, projectDir])

  // -- AUTOSAVE + CRASH RECOVERY --------------------------------------------
  //
  // The in-memory `design` (sketch entities / points / constraints /
  // parameters / dimensions / plane / extrude settings) is the session's ONLY
  // fully volatile state: kernel-op gestures persist immediately through
  // commitKernelFeatures, drawing edits persist behind a 400 ms debounce +
  // unmount flush, but sketch edits reach disk only on an explicit Save, a
  // kernel build, or a DXF import. A crash between edits and Save lost them
  // (Fusion-parity gap). The machinery below snapshots the dirty design to
  // userData/recovery/ (debounced after each edit + a periodic floor), offers
  // a restore ONCE per project-open when a newer-than-disk snapshot exists,
  // and deletes the snapshot on every clean save. CRITICAL (Cycle-249):
  // NOTHING here ever replaces in-memory state - snapshot writes are
  // fire-and-forget, and the restore runs only inside the explicit
  // `restoreRecoveredDesign` user action. All effects below depend ONLY on
  // stable primitives (fab / projectDir / loaded / design) - never callbacks.

  // Write the snapshot NOW if (and only if) the design is dirty. Reads
  // everything through refs so the identity is stable and timer/unmount
  // callers always capture the freshest design. Guarded on the bridge
  // function existing so older partial `fab` test mocks stay harmless.
  const writeDesignRecoveryNow = useCallback((): void => {
    const dir = projectDirRef.current
    if (!dir || typeof fab.designRecoveryWrite !== 'function') return
    const baseline = lastPersistedDesignJsonRef.current
    if (baseline === null) return
    const liveJson = JSON.stringify(designRef.current)
    if (liveJson === baseline) return
    lastRecoveryWriteMsRef.current = Date.now()
    const snapshot: DesignRecoverySnapshot = {
      version: 1,
      projectDir: dir,
      savedAtMs: Date.now(),
      design: designRef.current
    }
    void fab.designRecoveryWrite(JSON.stringify(snapshot)).catch(() => {})
  }, [fab])
  const writeDesignRecoveryNowRef = useRef(writeDesignRecoveryNow)
  useEffect(() => {
    writeDesignRecoveryNowRef.current = writeDesignRecoveryNow
  }, [writeDesignRecoveryNow])

  // Restore-offer check: ONCE per loaded project, read the recovery snapshot
  // and run the pure decideRecoveryOffer gate (newer-than-disk + genuinely
  // different content). On offer, stash the snapshot in a ref and surface
  // banner metadata. NEVER dispatches into the design reducer.
  useEffect(() => {
    if (!projectDir || !loaded) {
      setRecoveryOffer(null)
      recoverySnapshotRef.current = null
      if (!projectDir) lastRecoveryOfferKeyRef.current = null
      return
    }
    if (lastRecoveryOfferKeyRef.current === projectDir) return
    lastRecoveryOfferKeyRef.current = projectDir
    if (typeof fab.designRecoveryRead !== 'function') return
    let cancelled = false
    void (async () => {
      try {
        const read = await fab.designRecoveryRead(projectDir)
        if (cancelled) return
        const decision = decideRecoveryOffer(read, {
          projectDir,
          loadedDesign: designRef.current
        })
        if (!decision.offer) return
        recoverySnapshotRef.current = decision.snapshot
        setRecoveryOffer({
          savedAtMs: decision.snapshot.savedAtMs,
          entityCount: decision.snapshot.design.entities.length
        })
      } catch {
        // Recovery is best-effort; a failed read never blocks project open.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [fab, projectDir, loaded])

  // Debounced-after-edit snapshot: every dirty design change re-arms a short
  // timer; the trailing write captures the freshest state via the ref.
  useEffect(() => {
    if (!projectDir || !loaded) return
    const baseline = lastPersistedDesignJsonRef.current
    if (baseline === null || JSON.stringify(design) === baseline) return
    const handle = setTimeout(() => {
      writeDesignRecoveryNowRef.current()
    }, DESIGN_RECOVERY_DEBOUNCE_MS)
    return () => {
      clearTimeout(handle)
    }
  }, [projectDir, loaded, design])

  // Periodic floor: continuous editing keeps resetting the debounce timer, so
  // this interval bounds worst-case loss to the floor window while dirty
  // (writeDesignRecoveryNow no-ops when clean).
  useEffect(() => {
    if (!projectDir || !loaded) return
    const interval = setInterval(() => {
      if (Date.now() - lastRecoveryWriteMsRef.current < DESIGN_RECOVERY_PERIODIC_FLOOR_MS) return
      writeDesignRecoveryNowRef.current()
    }, DESIGN_RECOVERY_PERIODIC_FLOOR_MS)
    return () => {
      clearInterval(interval)
    }
  }, [projectDir, loaded])

  // Teardown flush: a route switch away from Design unmounts this provider and
  // DROPS the reducer state - flush one final snapshot when dirty so the work
  // is offered back on the next mount; when clean, delete the now-redundant
  // snapshot (the on-quit half of delete-on-clean-quit; the on-save half lives
  // in saveDesign/buildKernelPart).
  useEffect(() => {
    return () => {
      const dir = projectDirRef.current
      const baseline = lastPersistedDesignJsonRef.current
      if (!dir || baseline === null) return
      if (JSON.stringify(designRef.current) !== baseline) {
        writeDesignRecoveryNowRef.current()
      } else {
        const bridge = window.fab
        if (bridge && typeof bridge.designRecoveryDelete === 'function') {
          void bridge.designRecoveryDelete(dir).catch(() => {})
        }
      }
    }
  }, [])

  // EXPLICIT user action - the ONLY code path that applies a recovery
  // snapshot to the in-memory design (never an effect; Cycle-249 contract).
  // Dispatched as an `edit` so the pre-restore design lands on the undo
  // stack: Ctrl+Z reverts the restore.
  const restoreRecoveredDesign = useCallback((): void => {
    const snap = recoverySnapshotRef.current
    if (!snap) return
    dispatch({ type: 'edit', design: cloneDesign(snap.design) })
    recoverySnapshotRef.current = null
    setRecoveryOffer(null)
    onStatusRef.current?.('Recovered unsaved design changes - Save to keep them.')
  }, [])

  const discardRecoveredDesign = useCallback((): void => {
    recoverySnapshotRef.current = null
    setRecoveryOffer(null)
    const dir = projectDirRef.current
    if (dir && typeof fab.designRecoveryDelete === 'function') {
      void fab.designRecoveryDelete(dir).catch(() => {})
    }
  }, [fab])

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
    // task_f76b39b3: prefer the PICKABLE tessellation the kernel build persisted
    // (stable PRE-placement ids + world-space display) so the no-code body
    // supports face/edge picking whose ids resolve at the next build. Falls back
    // to the untagged STL when absent/invalid (display works, picking honestly off).
    try {
      const pickRes = await fab.designReadKernelPickJson(projectDir)
      if (pickRes.ok) {
        const tagged = buildKernelPickGeometry(pickRes.pick)
        if (tagged) {
          kernelGeomRef.current?.dispose()
          kernelGeomRef.current = tagged
          setKernelInspectGeometry(tagged)
          return
        }
      }
    } catch {
      // Non-fatal -- fall through to the plain-STL load below.
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

  // ── No-code build→render ───────────────────────────────────────────────────
  // Persist the live sketch (so the BASE solid matches what the operator drew —
  // the kernel-op editors only persist part/features.json, not design/sketch.json)
  // then run the CadQuery kernel build and reload the built STL into the viewport.
  // The kernel is sacred (CLAUDE.md Safety Rule 1): a bad op never aborts the
  // build (build_part.py skips it with a warning), and an outright build failure
  // is surfaced honestly via onStatus — never faked as success.
  const buildKernelPart = useCallback(async () => {
    if (!projectDir) return
    // Serialize: if a build is already running, request a single trailing rebuild
    // and return — the in-flight build's tail will pick up the latest on-disk state.
    if (kernelBuildInFlightRef.current) {
      kernelRebuildPendingRef.current = true
      return
    }
    kernelBuildInFlightRef.current = true
    setKernelBuilding(true)
    onStatus?.('Building model…')
    try {
      // Sync the BASE sketch to disk so build_part.py reads the current profiles.
      try {
        const designJson = JSON.stringify(design)
        await fab.designSave(projectDir, designJson)
        // AUTOSAVE baseline: this closure's design is now persisted. Drop the
        // recovery snapshot only when the LIVE design matches what was just
        // saved (an edit made mid-build stays protected until its own save).
        lastPersistedDesignJsonRef.current = designJson
        if (
          JSON.stringify(designRef.current) === designJson &&
          typeof fab.designRecoveryDelete === 'function'
        ) {
          void fab.designRecoveryDelete(projectDir).catch(() => {})
        }
      } catch (e) {
        onStatus?.(e instanceof Error ? e.message : String(e))
        return
      }
      const settings = await fab.settingsGet()
      const pythonPath = (settings?.pythonPath ?? '').trim() || 'python'
      const result = await fab.kernelBuild(projectDir, pythonPath)
      if (!result.ok) {
        onStatus?.(formatKernelBuildStatus(result.error, result.detail))
        // Still refresh so the manifest (now ok:false) marks the inspect mesh
        // stale rather than leaving a confidently-wrong solid on screen.
        await refreshKernelInspectGeometry()
        return
      }
      // Reload the freshly built STL + manifest into viewportGeometry.
      await refreshKernelInspectGeometry()
      const warnings = result.warnings ?? []
      if (warnings.length > 0) {
        onStatus?.(`Model built with ${warnings.length} warning${warnings.length === 1 ? '' : 's'}: ${warnings[0]}`)
      } else {
        onStatus?.('Model built.')
      }
    } catch (e) {
      onStatus?.(e instanceof Error ? e.message : String(e))
    } finally {
      kernelBuildInFlightRef.current = false
      setKernelBuilding(false)
      // Drain a coalesced rebuild requested while this build was running.
      // Use the LATEST closure (`buildKernelPartRef.current`), not this build's
      // own `buildKernelPart`: this instance closed over the design at build-start
      // (D0), and a sketch edit during the multi-second build produced a newer
      // closure (D1) whose `designSave(design)` would otherwise be skipped while
      // D0's save re-runs — re-clobbering the D1 sketch on disk (Cycle-249 damage
      // profile). The ref always points at the freshest design closure.
      if (kernelRebuildPendingRef.current) {
        kernelRebuildPendingRef.current = false
        void buildKernelPartRef.current()
      }
    }
  }, [fab, projectDir, design, onStatus, refreshKernelInspectGeometry])

  // Keep the auto-build effect's dep list to the SIGNATURE alone by routing the
  // trigger through a ref to the latest `buildKernelPart`. `buildKernelPart`'s
  // identity changes on every sketch edit (it closes over `design`); if it were
  // in the effect deps, a sketch edit during the debounce window would re-run
  // the effect, its cleanup would clear the pending timer, and the build would
  // be silently cancelled. The ref decouples that: the effect fires only when
  // the timeline signature (or project/loaded) actually changes.
  const buildKernelPartRef = useRef(buildKernelPart)
  useEffect(() => {
    buildKernelPartRef.current = buildKernelPart
  }, [buildKernelPart])

  // Signature of the EFFECTIVE kernel-op timeline (order + each op's body +
  // suppress flag + the design-level roll-back marker). Changing the timeline
  // — appending/editing an op via a feature dialog, reordering, suppressing, or
  // moving the roll-back bar — changes this string and re-triggers a build.
  const kernelTimelineSig = useMemo(
    () =>
      JSON.stringify({
        ops: features?.kernelOps ?? [],
        rolledBackTo: features?.rolledBackTo ?? null
      }),
    [features?.kernelOps, features?.rolledBackTo]
  )

  // Debounced auto-build: when the timeline signature changes after the initial
  // load, rebuild the solid. We skip the FIRST settled signature per project so
  // opening a project (which already lazy-loads any existing kernel STL via
  // refreshKernelInspectGeometry) does not kick off a redundant rebuild — only a
  // genuine edit does. A short debounce coalesces rapid timeline gestures.
  useEffect(() => {
    if (!projectDir || !loaded) {
      // Reset the baseline so the next project's first signature is treated as
      // initial (no auto-build) rather than a change vs. the previous project.
      lastBuiltTimelineSigRef.current = null
      return
    }
    if (lastBuiltTimelineSigRef.current === null) {
      // First settled signature for this project — adopt it as the baseline and
      // do NOT build (the existing kernel mesh, if any, is already loaded).
      lastBuiltTimelineSigRef.current = kernelTimelineSig
      return
    }
    if (lastBuiltTimelineSigRef.current === kernelTimelineSig) return
    lastBuiltTimelineSigRef.current = kernelTimelineSig
    const handle = setTimeout(() => {
      void buildKernelPartRef.current()
    }, KERNEL_AUTO_BUILD_DEBOUNCE_MS)
    return () => {
      clearTimeout(handle)
    }
  }, [projectDir, loaded, kernelTimelineSig])

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
          onStatusRef.current?.('Imported STL is ASCII; 3D preview needs binary STL. Re-import or convert the file.')
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
  }, [projectDir, loaded, assetMeshPathsKey, fab])

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

  // ── Drawings persist-on-change (debounced; commits the COMMITTED state) ─────
  //
  // Called by the Drawings workspace whenever a dimension / GD&T frame / title
  // block / annotation changes. The new state lands in `drawing` state (and
  // `drawingRef`) SYNCHRONOUSLY so the UI is live, then a debounced `drawing:save`
  // fires. CRITICAL persistence-safety: the timer body reads `drawingRef.current`
  // (the freshest COMMITTED state) — NOT the `next` captured here — so a rapid
  // burst persists the LAST committed value and never an eager-updater snapshot
  // (Cycle-256). The fold runs over `drawingFileBaseRef.current` so sheets /
  // sheet fields the renderer doesn't model are preserved (additive, Safety
  // Rule 2). Writes are serialized behind `drawingWriteChainRef` so two flushes
  // can't interleave. No-op without an open project.
  // Enqueue a serialized `drawing:save` of an ALREADY-FOLDED file. Adopts the
  // file as the new base so the next fold lands on the prior result, and writes
  // behind `drawingWriteChainRef` so two flushes can't interleave. Shared by the
  // active-sheet flush below and the sheet-structure ops (add/rename/delete/
  // select). No-op without an open project (the project dir is read from the ref
  // so the unmount flush works under [] effect deps).
  const persistDrawingFile = useCallback(
    (file: DrawingFile): void => {
      const dir = projectDirRef.current
      if (!dir) return
      drawingFileBaseRef.current = file
      drawingWriteChainRef.current = drawingWriteChainRef.current
        .catch(() => {})
        .then(async () => {
          try {
            await fab.drawingSave(dir, JSON.stringify(file))
          } catch (e) {
            onStatusRef.current?.(e instanceof Error ? e.message : String(e))
          }
        })
    },
    [fab]
  )

  // Fold the COMMITTED active-sheet drawing state onto the loaded base file and
  // enqueue a serialized `drawing:save`. Reads `drawingRef.current` (the freshest
  // committed value, NOT a captured closure -- Cycle-256) + `projectDirRef.current`
  // (so the unmount flush works under [] effect deps). The fold targets the ACTIVE
  // sheet (`drawingActiveSheetIdRef`) so an edit made on a secondary tab lands on
  // THAT sheet, never the primary; foreign sheets + the active id are preserved
  // (additive, Safety Rule 2). No-op without an open project or before hydration.
  const flushDrawingSave = useCallback((): void => {
    const dir = projectDirRef.current
    const committed = drawingRef.current
    if (!dir || committed === null) return
    const activeId = drawingActiveSheetIdRef.current ?? undefined
    const file = foldDrawingState(committed, drawingFileBaseRef.current ?? undefined, activeId)
    persistDrawingFile(file)
  }, [persistDrawingFile])

  const onDrawingChange = useCallback(
    (next: DrawingViewState): void => {
      // Commit synchronously (UI is live; the debounced flush reads this ref).
      drawingRef.current = next
      setDrawing(next)
      if (!projectDir) return
      if (drawingSaveTimerRef.current !== null) clearTimeout(drawingSaveTimerRef.current)
      drawingSaveTimerRef.current = setTimeout(() => {
        drawingSaveTimerRef.current = null
        flushDrawingSave()
      }, DRAWING_SAVE_DEBOUNCE_MS)
    },
    [projectDir, flushDrawingSave]
  )

  // ── Drawings sheet-structure ops (add / rename / delete / select) ────────────
  //
  // The renderer's tab strip reports add/rename/delete/switch INTENT; these turn
  // it into a NEW `DrawingFile` via the pure `drawing-sheet-ops` algebra. Each op
  // FIRST folds the committed active-sheet edits onto the base (so an uncommitted
  // dimension is not lost when the sheet set is restructured), applies the op,
  // then re-derives the active-sheet view + workspace state and persists. The
  // active-sheet fold is what keeps a half-typed title block on the current tab
  // safe across a sheet add/switch. No-op without an open project.
  const applyDrawingSheetOp = useCallback(
    (op: (file: DrawingFile) => DrawingFile): void => {
      if (projectDirRef.current === null) return
      // Cancel any pending debounced active-sheet flush — this op subsumes it
      // (it folds the committed active-sheet state in before restructuring).
      if (drawingSaveTimerRef.current !== null) {
        clearTimeout(drawingSaveTimerRef.current)
        drawingSaveTimerRef.current = null
      }
      const committed = drawingRef.current
      const base = drawingFileBaseRef.current
      const activeId = drawingActiveSheetIdRef.current ?? undefined
      // Fold the live active-sheet edits in first (so they survive the restructure).
      // `foldDrawingState` always returns a canonical, schema-valid file (creating a
      // primary sheet when neither a base nor committed state exists yet), so `op`
      // always receives a real `DrawingFile`.
      const folded =
        committed === null
          ? base ?? foldDrawingState(emptyDrawingViewState())
          : foldDrawingState(committed, base ?? undefined, activeId)
      const next = op(folded)
      // Re-derive the per-sheet view + the full workspace from the new file.
      const view = hydrateActiveSheet(next)
      const workspace = hydrateDrawingWorkspace(next)
      drawingRef.current = view
      drawingActiveSheetIdRef.current = workspace.activeSheetId
      setDrawing(view)
      setDrawingWorkspace(workspace)
      persistDrawingFile(next)
    },
    [persistDrawingFile]
  )

  const onDrawingSelectSheet = useCallback(
    (sheetId: string): void => {
      applyDrawingSheetOp((file) => setDrawingActiveSheet(file, sheetId))
    },
    [applyDrawingSheetOp]
  )

  const onDrawingAddSheet = useCallback((): void => {
    // Deterministic-enough unique id (the pure layer mints none); the engine op
    // makes it active + names it with a numbered default when blank.
    const id = `sheet-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    applyDrawingSheetOp((file) => addDrawingSheet(file, id, ''))
  }, [applyDrawingSheetOp])

  const onDrawingRenameSheet = useCallback(
    (sheetId: string, name: string): void => {
      applyDrawingSheetOp((file) => renameDrawingSheet(file, sheetId, name))
    },
    [applyDrawingSheetOp]
  )

  const onDrawingDeleteSheet = useCallback(
    (sheetId: string): void => {
      applyDrawingSheetOp((file) => deleteDrawingSheet(file, sheetId))
    },
    [applyDrawingSheetOp]
  )

  // Flush-safety: on unmount (e.g. a route switch to a NON-CAD workspace that
  // tears down the provider), FLUSH any pending debounced edit synchronously
  // instead of dropping it -- so a drawing edit made <debounce-window before
  // navigating away is still persisted (the "survive a route switch" contract).
  // The write itself is async but is enqueued before teardown completes.
  useEffect(() => {
    return () => {
      if (drawingSaveTimerRef.current !== null) {
        clearTimeout(drawingSaveTimerRef.current)
        drawingSaveTimerRef.current = null
        flushDrawingSave()
      }
    }
  }, [flushDrawingSave])

  const saveDesign = useCallback(async () => {
    if (!projectDir) return
    try {
      const designJson = JSON.stringify(design)
      await fab.designSave(projectDir, designJson)
      // Clean save: disk now matches this design - move the autosave baseline
      // and delete the recovery snapshot (it protects nothing anymore).
      lastPersistedDesignJsonRef.current = designJson
      if (typeof fab.designRecoveryDelete === 'function') {
        void fab.designRecoveryDelete(projectDir).catch(() => {})
      }
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

  // ── USER PARAMETERS — run the pure op, then resolve + re-solve + edit-dispatch.
  // A single shared applier keeps the four gestures identical: run the schema
  // op; on rejection toast the reason (no state change); on success feed the
  // op's design through `resolveUserParametersAndSolve` (writes the resolved
  // numeric cache + lands dependent dimensions) and dispatch an `edit` (sketch
  // undo). Pure ops + a pure resolve = deterministic; Ctrl+Z in sketch mode
  // reverts the whole parameter edit in one step.
  const applyUserParameterOp = useCallback(
    (result: { ok: true; design: DesignFileV2 } | { ok: false; reason: string }) => {
      if (!result.ok) {
        onStatusRef.current?.(result.reason)
        return
      }
      dispatch({ type: 'edit', design: resolveUserParametersAndSolve(result.design) })
    },
    []
  )

  const addUserParameter = useCallback(
    (name: string, expression: string) => {
      applyUserParameterOp(addUserParameterOp(design, name, expression))
    },
    [design, applyUserParameterOp]
  )

  const editUserParameter = useCallback(
    (name: string, expression: string) => {
      applyUserParameterOp(editUserParameterOp(design, name, expression))
    },
    [design, applyUserParameterOp]
  )

  const renameUserParameter = useCallback(
    (from: string, to: string) => {
      applyUserParameterOp(renameUserParameterOp(design, from, to))
    },
    [design, applyUserParameterOp]
  )

  const deleteUserParameter = useCallback(
    (name: string) => {
      applyUserParameterOp(deleteUserParameterOp(design, name))
    },
    [design, applyUserParameterOp]
  )

  const mirrorX = useCallback(() => {
    dispatch({ type: 'edit', design: mirrorDesignAcrossYAxis(design) })
  }, [design])

  const pattern40X = useCallback(() => {
    dispatch({ type: 'edit', design: linearPatternSketch(design, 40, 0) })
  }, [design])

  const undo = useCallback(() => dispatch({ type: 'undo' }), [])

  /**
   * Outcome of a kernel-features mutation passed to {@link commitKernelFeatures}:
   *   - `{ next, status }` — a fold to persist + the status toast on success;
   *   - `{ reject }`       — a validation failure (surface the reason, no write);
   *   - `null`             — a no-op (out-of-range index, etc.); silently ignore.
   */
  type KernelFeaturesMutation =
    | { next: PartFeaturesFile; status: string }
    | { reject: string }
    | null

  /**
   * Serialize a kernel-features read-modify-write so concurrent timeline
   * gestures never clobber each other (the bug above). `compute` receives the
   * FRESHEST features (`featuresRef.current`, updated synchronously by the prior
   * gesture before its await) — NOT the render-cycle closure — and returns the
   * fold to persist. The fold is committed to `featuresRef` IMMEDIATELY (so a
   * second synchronous gesture folds onto it) and the disk write is chained onto
   * `featuresWriteChainRef` so saves land in gesture order. `setFeatures(next)`
   * still drives the render — the ref is only the synchronous fold base.
   */
  const commitKernelFeatures = useCallback(
    (compute: (base: PartFeaturesFile) => KernelFeaturesMutation): boolean => {
      if (!projectDir) return false
      const base = featuresRef.current ?? derivePartFeatures(designRef.current, null)
      const outcome = compute(base)
      if (outcome === null) return false
      if ('reject' in outcome) {
        onStatusRef.current?.(outcome.reject)
        return false
      }
      const { next, status } = outcome
      // Fold lands synchronously so a same-tick second gesture sees it.
      featuresRef.current = next
      setFeatures(next)
      featuresWriteChainRef.current = featuresWriteChainRef.current
        .catch(() => {})
        .then(async () => {
          try {
            await fab.featuresSave(projectDir, JSON.stringify(next))
            onStatusRef.current?.(status)
          } catch (e) {
            onStatusRef.current?.(e instanceof Error ? e.message : String(e))
          }
        })
      return true
    },
    [fab, projectDir]
  )

  // ── FEATURE-TIMELINE UNDO/REDO — record + replay through the SAME chain ──────
  //
  // A `TimelineCommitFold` (from feature-timeline-actions) has EXACTLY the
  // `KernelFeaturesMutation` shape, so an inverse fold commits through the same
  // `commitKernelFeatures` serialized read-modify-write as every forward gesture
  // — persistence + the debounced kernel rebuild stay consistent (no raw state
  // poke; the race-test pins on the commit chain hold).
  //
  // `undoableCommit` runs the forward mutation FIRST (via commitKernelFeatures,
  // which reports whether it actually committed), then — only on a real change —
  // RECORDS an already-executed `ReplayCommand` onto the timeline stack. The
  // command's inverse replays `inverse` (built from the captured pre-mutation
  // state); its forward replays `forward` (deterministic given the post-undo
  // state, which equals the original pre-mutation base). A rejected / no-op
  // gesture is never recorded. `coalesceKey` merges a rapid burst (e.g. a dialog
  // spinner re-applying the same index) into one undo step — the `record`
  // contract keeps the FIRST inverse and adopts the LATEST forward.
  const undoableCommit = useCallback(
    (
      forward: (base: PartFeaturesFile) => KernelFeaturesMutation,
      buildInverse: (preState: PartFeaturesFile) => TimelineCommitFold,
      label: string,
      coalesceKey?: string
    ): boolean => {
      // Capture the PRE-mutation base (the exact one commitKernelFeatures folds
      // onto) so the inverse restores the state that existed a moment ago.
      const preState = featuresRef.current ?? derivePartFeatures(designRef.current, null)
      const committed = commitKernelFeatures(forward)
      if (!committed) return false
      const mgr = timelineUndoRef.current
      if (mgr) {
        const inverse = buildInverse(preState)
        const cmd = new ReplayCommand(
          () => commitKernelFeatures(forward),
          () => commitKernelFeatures(inverse),
          label,
          coalesceKey
        )
        mgr.record(cmd)
      }
      return true
    },
    [commitKernelFeatures]
  )

  const timelineUndo = useCallback((): void => {
    timelineUndoRef.current?.undo()
  }, [])
  const timelineRedo = useCallback((): void => {
    timelineUndoRef.current?.redo()
  }, [])

  // Ctrl+Z / Ctrl+Y (and Cmd/Ctrl+Shift+Z) → the TIMELINE stack — but ONLY when
  // the sketch surface is NOT mounted. The sketch surface owns its own linear
  // `SketchHistory` and binds its OWN window keydown handler (mounted only in
  // sketch mode); routing both to one keystroke would double-undo. The mounted-
  // surface DOM probe (`.sketch-surface`) is the focus/mode gate: while the 2D
  // sketcher is on screen it owns undo; otherwise (3D viewport / feature-timeline
  // focus) the timeline stack owns it. Typable targets are skipped identically
  // (`isTypableKeyboardTarget`) so typing a value in a dialog spinner is never
  // hijacked. Linear per-scope stacks with this one routing rule — no
  // cross-scope time-travel (a defensible V1; documented on the session value).
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (isTypableKeyboardTarget(e.target)) return
      // Sketch mode owns Ctrl+Z while its surface is mounted.
      if (typeof document !== 'undefined' && document.querySelector('.sketch-surface')) return
      if (matchesUndo(e)) {
        e.preventDefault()
        timelineUndoRef.current?.undo()
      } else if (matchesRedo(e)) {
        e.preventDefault()
        timelineUndoRef.current?.redo()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const appendKernelOp = useCallback(
    async (op: KernelPostSolidOp) => {
      undoableCommit(
        (base) => ({
          next: { ...base, kernelOps: [...(base.kernelOps ?? []), op] },
          status: 'Kernel op saved — rebuilding model…'
        }),
        // Inverse: remove the op that landed at the (pre-append) end index.
        (preState) => invertAppendKernelOp((preState.kernelOps ?? []).length),
        'Add kernel op'
      )
    },
    [undoableCommit]
  )

  const removeKernelOpAt = useCallback(
    async (index: number) => {
      undoableCommit(
        (base) => {
          const ops = [...(base.kernelOps ?? [])]
          if (index < 0 || index >= ops.length) return null
          ops.splice(index, 1)
          return {
            next: { ...base, kernelOps: ops.length ? ops : undefined },
            status: 'Kernel op removed — rebuilding model…'
          }
        },
        // Inverse: re-insert the captured op AT its original index — suppressed
        // flag + every parameter byte-identical to what was deleted.
        (preState) => {
          const removed = (preState.kernelOps ?? [])[index]
          return removed === undefined
            ? () => null
            : invertRemoveKernelOpAt(index, removed)
        },
        'Delete kernel op'
      )
    },
    [undoableCommit]
  )

  const moveKernelOp = useCallback(
    async (index: number, delta: -1 | 1) => {
      undoableCommit(
        (base) => {
          const ops = [...(base.kernelOps ?? [])]
          const j = index + delta
          if (index < 0 || index >= ops.length || j < 0 || j >= ops.length) return null
          const a = ops[index]!
          const b = ops[j]!
          const order = canSwapKernelOpOrder(a, b, delta)
          if (!order.ok) return { reject: order.reason }
          ops[index] = b
          ops[j] = a
          return { next: { ...base, kernelOps: ops }, status: 'Kernel op order updated — rebuilding model…' }
        },
        // Inverse: swap the same index pair back (a ±1 swap is its own inverse);
        // skips the order-rule re-check since it restores a state that existed.
        () => invertMoveKernelOp(index, delta),
        'Move kernel op'
      )
    },
    [undoableCommit]
  )

  const setKernelOpSuppressedAt = useCallback(
    async (index: number, suppressed: boolean) => {
      undoableCommit(
        (base) => {
          const ops = [...(base.kernelOps ?? [])]
          if (index < 0 || index >= ops.length) return null
          const cur = ops[index]!
          ops[index] = { ...cur, suppressed: suppressed ? true : undefined }
          return {
            next: { ...base, kernelOps: ops },
            status: suppressed ? 'Kernel op suppressed (skipped in build).' : 'Kernel op active again.'
          }
        },
        // Inverse: restore the captured previous flag (clearing drops the key).
        (preState) =>
          invertSetKernelOpSuppressedAt(
            index,
            (preState.kernelOps ?? [])[index]?.suppressed === true
          ),
        'Suppress kernel op'
      )
    },
    [undoableCommit]
  )

  /**
   * Fold a pure {@link applyTimelineAction} next-state (kernelOps + rolledBackTo)
   * onto a features base. Shared by `reorderKernelOps` / `setKernelRollbackMarker`
   * so both run through {@link commitKernelFeatures}'s serialized write path (a
   * Build STEP picks up the change identically). Drops `rolledBackTo` entirely
   * when there is no marker so the persisted file stays canonical.
   */
  const foldTimelineState = useCallback(
    (base: PartFeaturesFile, nextTimeline: TimelineState): PartFeaturesFile => {
      const next: PartFeaturesFile = {
        ...base,
        kernelOps: nextTimeline.kernelOps as KernelPostSolidOp[],
        ...(nextTimeline.rolledBackTo === undefined ? {} : { rolledBackTo: nextTimeline.rolledBackTo })
      }
      if (nextTimeline.rolledBackTo === undefined && 'rolledBackTo' in next) {
        delete (next as { rolledBackTo?: number }).rolledBackTo
      }
      return next
    },
    []
  )

  const reorderKernelOps = useCallback(
    async (from: number, to: number) => {
      undoableCommit(
        (base) => {
          const state: TimelineState = { kernelOps: base.kernelOps ?? [], rolledBackTo: base.rolledBackTo }
          const result = applyTimelineAction(state, { type: 'reorder', from, to })
          if (!result.changed) return { reject: result.reason }
          return { next: foldTimelineState(base, result.state), status: result.status }
        },
        // Inverse: restore the pre-drag op order AND the pre-drag roll-back marker
        // (the forward reorder can re-clamp the marker; the capture puts it back).
        (preState) =>
          invertReorderKernelOps(preState.kernelOps ?? [], preState.rolledBackTo),
        'Reorder kernel ops'
      )
    },
    [undoableCommit, foldTimelineState]
  )

  /**
   * FEATURE RE-EDIT — replace the kernel op at `index` in place. The edited op
   * is validated against the REAL `kernelPostSolidOpSchema` before it can touch
   * the timeline (a malformed op is rejected with the schema's reason — the
   * kernel is sacred, Safety Rule 1); the pure `update` timeline action then
   * enforces the finishing-op order rule, preserves the current `suppressed`
   * flag when the replacement omits it, and keeps the roll-back marker intact.
   * Runs through {@link commitKernelFeatures} so concurrent gestures serialize
   * exactly like every other timeline editor.
   */
  const updateKernelOpAt = useCallback(
    async (index: number, op: KernelPostSolidOp) => {
      undoableCommit(
        (base) => {
          const parsed = kernelPostSolidOpSchema.safeParse(op)
          if (!parsed.success) {
            const first = parsed.error.issues[0]?.message ?? 'invalid op'
            return { reject: `Edited op failed validation (${first}) — nothing was changed.` }
          }
          const state: TimelineState = { kernelOps: base.kernelOps ?? [], rolledBackTo: base.rolledBackTo }
          const result = applyTimelineAction(state, { type: 'update', index, op: parsed.data })
          if (!result.changed) return { reject: result.reason }
          return { next: foldTimelineState(base, result.state), status: 'Kernel op updated — rebuilding model…' }
        },
        // Inverse: put the captured previous op back at `index` (it existed a
        // moment ago, so it needs no re-validation — only the range check).
        (preState) => {
          const previous = (preState.kernelOps ?? [])[index]
          return previous === undefined
            ? () => null
            : invertUpdateKernelOpAt(index, previous)
        },
        'Edit kernel op',
        // Coalesce a dialog spinner's rapid same-index re-applies into one step
        // (1000 ms window; mirrors the sketch numeric-edit coalescing).
        `update-kernel-op:${index}`
      )
    },
    [undoableCommit, foldTimelineState]
  )

  const setKernelRollbackMarker = useCallback(
    async (index: number | null) => {
      undoableCommit(
        (base) => {
          const state: TimelineState = { kernelOps: base.kernelOps ?? [], rolledBackTo: base.rolledBackTo }
          const result = applyTimelineAction(
            state,
            index === null ? { type: 'clearRollback' } : { type: 'setRollback', index }
          )
          if (!result.changed) return { reject: result.reason }
          return { next: foldTimelineState(base, result.state), status: result.status }
        },
        // Inverse: restore the captured previous marker (undefined/-1 → build all).
        (preState) => invertSetKernelRollbackMarker(preState.rolledBackTo),
        'Move roll-back marker'
      )
    },
    [undoableCommit, foldTimelineState]
  )

  const updateFeatureSuppressed = useCallback(
    async (featureId: string, suppressed: boolean) => {
      commitKernelFeatures((base) => {
        if (!base.items?.some((it) => it.id === featureId)) return null
        const items = base.items.map((it) => (it.id === featureId ? { ...it, suppressed } : it))
        return {
          next: { ...base, items },
          status: suppressed ? 'Feature suppressed.' : 'Feature unsuppressed.'
        }
      })
    },
    [commitKernelFeatures]
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
      kernelBuilding,
      refreshKernelInspectGeometry,
      buildKernelPart,
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
      addUserParameter,
      editUserParameter,
      renameUserParameter,
      deleteUserParameter,
      mirrorX,
      pattern40X,
      undo,
      setFeatures,
      appendKernelOp,
      removeKernelOpAt,
      moveKernelOp,
      reorderKernelOps,
      updateKernelOpAt,
      setKernelOpSuppressedAt,
      setKernelRollbackMarker,
      updateFeatureSuppressed,
      timelineUndo,
      timelineRedo,
      // Derived from the manager's live version (mirrored into timelineUndoVersion
      // so this memo recomputes whenever the stack changes).
      canTimelineUndo: timelineUndoRef.current?.canUndo ?? false,
      canTimelineRedo: timelineUndoRef.current?.canRedo ?? false,
      solveReport,
      recoveryOffer,
      restoreRecoveredDesign,
      discardRecoveredDesign,
      drawing,
      onDrawingChange,
      drawingWorkspace,
      onDrawingSelectSheet,
      onDrawingAddSheet,
      onDrawingRenameSheet,
      onDrawingDeleteSheet,
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
      kernelBuilding,
      refreshKernelInspectGeometry,
      buildKernelPart,
      selection,
      solveReport,
      recoveryOffer,
      restoreRecoveredDesign,
      discardRecoveredDesign,
      onDesignChange,
      saveDesign,
      exportStl,
      removeEntity,
      addPresetRect,
      addConstraint,
      runSolve,
      setParameter,
      addUserParameter,
      editUserParameter,
      renameUserParameter,
      deleteUserParameter,
      mirrorX,
      pattern40X,
      undo,
      appendKernelOp,
      removeKernelOpAt,
      moveKernelOp,
      reorderKernelOps,
      updateKernelOpAt,
      setKernelOpSuppressedAt,
      setKernelRollbackMarker,
      updateFeatureSuppressed,
      timelineUndo,
      timelineRedo,
      timelineUndoVersion,
      drawing,
      onDrawingChange,
      drawingWorkspace,
      onDrawingSelectSheet,
      onDrawingAddSheet,
      onDrawingRenameSheet,
      onDrawingDeleteSheet,
      onStatus,
      onExportedStl
    ]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
