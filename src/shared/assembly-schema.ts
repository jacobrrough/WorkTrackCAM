import { z } from 'zod'

/** Root assembly display name: trim; blank or whitespace-only becomes default. */
const assemblyRootNameSchema = z.preprocess(
  (val) => (typeof val === 'string' ? val.trim() || undefined : val),
  z.string().min(1).optional().default('Assembly')
)

const transformSchema = z.object({
  x: z.number().default(0),
  y: z.number().default(0),
  z: z.number().default(0),
  rxDeg: z.number().default(0),
  ryDeg: z.number().default(0),
  rzDeg: z.number().default(0)
})

/** Persisted joint kinds (assembly.json). */
export const assemblyJointEnum = z.enum([
  'rigid',
  'slider',
  'revolute',
  'planar',
  'cylindrical',
  'ball',
  /** Universal (Cardan) — two intersecting revolute axes; kinematics stub only */
  'universal'
])

/**
 * Motion / mate **link stub** (persisted on an instance). No kinematic solver; pairs this row with another instance id.
 */
export const assemblyMotionLinkKindEnum = z.enum(['mate', 'contact', 'align'])

/** World axes for kinematic preview stubs (viewport only). */
export const assemblyWorldAxisEnum = z.enum(['x', 'y', 'z'])

export type AssemblyWorldAxis = z.infer<typeof assemblyWorldAxisEnum>

/** Whether revolute/slider preview axis is interpreted in **world** space or **parent** local space (parent’s stored `transform` rotation only — preview-only). */
export const assemblyKinematicAxisFrameEnum = z.enum(['world', 'parent'])

export type AssemblyKinematicAxisFrame = z.infer<typeof assemblyKinematicAxisFrameEnum>

export const assemblyJointStateSchema = z
  .object({
    scalarDeg: z.number().finite().optional(),
    scalarMm: z.number().finite().optional(),
    uMm: z.number().finite().optional(),
    vMm: z.number().finite().optional(),
    angle1Deg: z.number().finite().optional(),
    angle2Deg: z.number().finite().optional(),
    slideMm: z.number().finite().optional(),
    spinDeg: z.number().finite().optional(),
    rxDeg: z.number().finite().optional(),
    ryDeg: z.number().finite().optional(),
    rzDeg: z.number().finite().optional()
  })
  .optional()

export const assemblyJointLimitsSchema = z
  .object({
    scalarMinDeg: z.number().finite().optional(),
    scalarMaxDeg: z.number().finite().optional(),
    scalarMinMm: z.number().finite().optional(),
    scalarMaxMm: z.number().finite().optional(),
    uMinMm: z.number().finite().optional(),
    uMaxMm: z.number().finite().optional(),
    vMinMm: z.number().finite().optional(),
    vMaxMm: z.number().finite().optional(),
    angle1MinDeg: z.number().finite().optional(),
    angle1MaxDeg: z.number().finite().optional(),
    angle2MinDeg: z.number().finite().optional(),
    angle2MaxDeg: z.number().finite().optional(),
    slideMinMm: z.number().finite().optional(),
    slideMaxMm: z.number().finite().optional(),
    spinMinDeg: z.number().finite().optional(),
    spinMaxDeg: z.number().finite().optional(),
    rxMinDeg: z.number().finite().optional(),
    rxMaxDeg: z.number().finite().optional(),
    ryMinDeg: z.number().finite().optional(),
    ryMaxDeg: z.number().finite().optional(),
    rzMinDeg: z.number().finite().optional(),
    rzMaxDeg: z.number().finite().optional()
  })
  .optional()

export const assemblyComponentSchema = z.object({
  id: z.string().trim().min(1),
  /** Display name */
  name: z.string().trim().min(1),
  /** Relative path to part folder or `design/sketch.json` root */
  partPath: z.string().trim().min(1),
  transform: transformSchema.default({}),
  /** If true, acts like Fusion grounded component */
  grounded: z.boolean().default(false),
  /** Fusion-style rigid joint to parent instance id (optional) */
  parentId: z.string().optional(),
  joint: assemblyJointEnum.optional(),
  /** Optional item / drawing reference for BOM or external hooks */
  referenceTag: z.string().optional(),
  /** Optional part / stock number for BOM and ERP-style references */
  partNumber: z.string().optional(),
  /**
   * Optional PDM / PLM / ERP **component** identifier (distinct from `referenceTag` drawing refs).
   */
  externalComponentRef: z.string().optional(),
  /** Free-text BOM / manufacturing notes for this line */
  bomNotes: z.string().optional(),
  /** Line quantity for BOM export (instances of this part in the assembly) */
  bomQuantity: z.number().int().min(1).default(1),
  /** Excluded from interference / motion stubs when true */
  suppressed: z.boolean().default(false),
  /**
   * Optional path to a **binary** STL (relative to project root) used for mesh/AABB interference checks.
   * Omit for sketch-only rows; ASCII STL is not parsed in main yet.
   */
  meshPath: z.string().optional(),
  /**
   * Kinematics / isolation hook: when true, stubs may treat this instance as decoupled from parent motion
   * (no solver yet; persisted for future constraints / analysis).
   */
  motionIsolated: z.boolean().default(false),
  /**
   * Optional **other instance** id for mate/contact/align stubs (must exist among component ids and not equal this row).
   */
  linkedInstanceId: z.string().trim().min(1).optional(),
  /** When set with `linkedInstanceId`, classifies the stub link (no solver). */
  motionLinkKind: assemblyMotionLinkKindEnum.optional(),
  /**
   * Solver-oriented joint state. Optional so legacy files continue to load.
   * `parseAssemblyFile()` migrates from legacy preview fields when absent.
   */
  jointState: assemblyJointStateSchema,
  /** Solver-oriented hard limits; migrated from legacy preview min/max fields when absent. */
  jointLimits: assemblyJointLimitsSchema,
  /**
   * Preview-only revolute angle (degrees) for 3D viewport — rotates this row and `parentId` descendants about a **world**
   * axis (`revolutePreviewAxis`, default **z**) at this instance’s pivot. Ignored when `joint` is not `revolute`.
   */
  revolutePreviewAngleDeg: z.number().finite().optional(),
  /** World axis for revolute preview rotation (defaults **z**). */
  revolutePreviewAxis: assemblyWorldAxisEnum.optional(),
  /** When **`parent`**, `revolutePreviewAxis` is about parent **local** +X/+Y/+Z using the parent row’s `transform` Euler (falls back to world if there is no `parentId`). */
  revolutePreviewAxisFrame: assemblyKinematicAxisFrameEnum.optional(),
  /** Clamp lower bound for `revolutePreviewAngleDeg` (defaults −180). */
  revolutePreviewMinDeg: z.number().finite().optional(),
  /** Clamp upper bound for `revolutePreviewAngleDeg` (defaults +180). */
  revolutePreviewMaxDeg: z.number().finite().optional(),
  /**
   * Preview-only slider translation (mm) for 3D viewport — moves this row and `parentId` descendants along a **world**
   * axis. Ignored when `joint` is not `slider`.
   */
  sliderPreviewMm: z.number().finite().optional(),
  /** World axis for slider preview (defaults **z**). */
  sliderPreviewAxis: assemblyWorldAxisEnum.optional(),
  /** When **`parent`**, `sliderPreviewAxis` is along parent **local** +X/+Y/+Z (falls back to world if there is no `parentId`). */
  sliderPreviewAxisFrame: assemblyKinematicAxisFrameEnum.optional(),
  sliderPreviewMinMm: z.number().finite().optional(),
  sliderPreviewMaxMm: z.number().finite().optional(),
  /**
   * Planar preview — translate subtree in the plane orthogonal to `planarPreviewNormalAxis` (+X/+Y/+Z in world or parent local).
   * Displacement is `planarPreviewUMm` along **U** and `planarPreviewVMm` along **V** (orthonormal in-plane basis from the normal; viewport only).
   * Ignored when `joint` is not `planar`.
   */
  planarPreviewNormalAxis: assemblyWorldAxisEnum.optional(),
  planarPreviewNormalFrame: assemblyKinematicAxisFrameEnum.optional(),
  planarPreviewUMm: z.number().finite().optional(),
  planarPreviewVMm: z.number().finite().optional(),
  planarPreviewUMinMm: z.number().finite().optional(),
  planarPreviewUMaxMm: z.number().finite().optional(),
  planarPreviewVMinMm: z.number().finite().optional(),
  planarPreviewVMaxMm: z.number().finite().optional(),
  /**
   * Universal (Cardan) preview — rotate subtree about **axis1**, then about **axis2** (both world or parent-local per frame).
   * Ignored when `joint` is not `universal`.
   */
  universalPreviewAxis1: assemblyWorldAxisEnum.optional(),
  universalPreviewAxis1Frame: assemblyKinematicAxisFrameEnum.optional(),
  universalPreviewAngle1Deg: z.number().finite().optional(),
  universalPreviewAngle1MinDeg: z.number().finite().optional(),
  universalPreviewAngle1MaxDeg: z.number().finite().optional(),
  universalPreviewAxis2: assemblyWorldAxisEnum.optional(),
  universalPreviewAxis2Frame: assemblyKinematicAxisFrameEnum.optional(),
  universalPreviewAngle2Deg: z.number().finite().optional(),
  universalPreviewAngle2MinDeg: z.number().finite().optional(),
  universalPreviewAngle2MaxDeg: z.number().finite().optional(),
  /**
   * Cylindrical preview — translate along `cylindricalPreviewAxis`, then rotate about the **same** axis through the joint pivot.
   * Ignored when `joint` is not `cylindrical`.
   */
  cylindricalPreviewAxis: assemblyWorldAxisEnum.optional(),
  cylindricalPreviewAxisFrame: assemblyKinematicAxisFrameEnum.optional(),
  cylindricalPreviewSlideMm: z.number().finite().optional(),
  cylindricalPreviewSlideMinMm: z.number().finite().optional(),
  cylindricalPreviewSlideMaxMm: z.number().finite().optional(),
  cylindricalPreviewSpinDeg: z.number().finite().optional(),
  cylindricalPreviewSpinMinDeg: z.number().finite().optional(),
  cylindricalPreviewSpinMaxDeg: z.number().finite().optional(),
  /**
   * Ball (spherical) preview — sequential rotations about **world** +X, then +Y, then +Z through this row’s pivot.
   * Ignored when `joint` is not `ball`.
   */
  ballPreviewRxDeg: z.number().finite().optional(),
  ballPreviewRyDeg: z.number().finite().optional(),
  ballPreviewRzDeg: z.number().finite().optional(),
  ballPreviewRxMinDeg: z.number().finite().optional(),
  ballPreviewRxMaxDeg: z.number().finite().optional(),
  ballPreviewRyMinDeg: z.number().finite().optional(),
  ballPreviewRyMaxDeg: z.number().finite().optional(),
  ballPreviewRzMinDeg: z.number().finite().optional(),
  ballPreviewRzMaxDeg: z.number().finite().optional(),
  /** Optional BOM unit (ea, m, kg, …). */
  bomUnit: z.string().max(120).optional(),
  /** Optional vendor / supplier label for BOM exports. */
  bomVendor: z.string().max(400).optional(),
  /** Optional cost per line (free text; e.g. currency + value) for BOM exports. */
  bomCostEach: z.string().max(400).optional()
})

/**
 * Explode presentation: axis + step drive **viewport offsets** (active row order × step × preview factor) and exports.
 */
export const assemblyExplodeViewMetadataSchema = z.object({
  axis: z.enum(['x', 'y', 'z']).default('z'),
  /** Separation step per sibling index along `axis` (mm), documentation-only until a viewer uses it. */
  stepMm: z.number().finite().nonnegative().default(10),
  notes: z.string().max(4000).optional()
})

export type AssemblyExplodeViewMetadata = z.infer<typeof assemblyExplodeViewMetadataSchema>

/**
 * Motion study stub: `keyframesJson` can drive **preview-only** +Y rotation in the assembly viewport (see `assembly-viewport-math`).
 */
export const assemblyMotionStudyStubSchema = z.object({
  name: z.string().max(200).default('Motion study (stub)'),
  dofHint: z.enum(['none', 'planar2d', 'spatial6']).default('none'),
  /** Optional JSON array/object string for future keyframe payloads (validated loosely in UI). */
  keyframesJson: z.string().max(32000).optional(),
  notes: z.string().max(4000).optional()
})

export type AssemblyMotionStudyStub = z.infer<typeof assemblyMotionStudyStubSchema>

const assemblyIncomingSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]).optional().default(1),
  name: assemblyRootNameSchema,
  components: z.array(assemblyComponentSchema).default([]),
  explodeView: assemblyExplodeViewMetadataSchema.optional(),
  motionStudy: assemblyMotionStudyStubSchema.optional()
})

/** Canonical on-disk / in-memory shape after load (v1 files migrate here). */
export const assemblyFileSchema = z.object({
  version: z.literal(2),
  name: assemblyRootNameSchema,
  components: z.array(assemblyComponentSchema),
  explodeView: assemblyExplodeViewMetadataSchema.optional(),
  motionStudy: assemblyMotionStudyStubSchema.optional()
})

export type AssemblyFile = z.infer<typeof assemblyFileSchema>
export type AssemblyComponent = z.infer<typeof assemblyComponentSchema>
export type AssemblyJointState = z.infer<NonNullable<typeof assemblyJointStateSchema>>
export type AssemblyJointLimits = z.infer<NonNullable<typeof assemblyJointLimitsSchema>>

/** Quick joint picks for assembly UI (sets `joint` only). */
export const assemblyJointPresets: { id: string; label: string; joint: AssemblyComponent['joint'] }[] = [
  { id: 'none', label: '—', joint: undefined },
  { id: 'rigid', label: 'Rigid (fixed)', joint: 'rigid' },
  { id: 'slider', label: 'Slider (prismatic)', joint: 'slider' },
  { id: 'revolute', label: 'Revolute (hinge)', joint: 'revolute' },
  { id: 'planar', label: 'Planar', joint: 'planar' },
  { id: 'cylindrical', label: 'Cylindrical', joint: 'cylindrical' },
  { id: 'ball', label: 'Ball (spherical)', joint: 'ball' },
  { id: 'universal', label: 'Universal (Cardan)', joint: 'universal' }
]

/** Short UI copy: typical DOF for a persisted joint kind (preview / data only — not a solver). */
export function assemblyJointDofHint(joint: AssemblyComponent['joint'] | undefined): string {
  if (joint == null) {
    return 'No joint kind — treat as independent placement unless you set a parent and joint.'
  }
  const map: Record<NonNullable<AssemblyComponent['joint']>, string> = {
    rigid: '0 DOF — fixed relative to parent.',
    slider:
      '1 DOF — prismatic slide; state/limits drive motion along world or **parent local** X/Y/Z.',
    revolute:
      '1 DOF — hinge; state/limits drive axis angle (world or **parent local** X/Y/Z).',
    planar:
      '2 DOF — translation in a plane; state/limits drive in-plane U/V (normal from +X/+Y/+Z, world or parent local).',
    cylindrical:
      '2 DOF — slide + spin about a shared axis; state/limits drive slide mm + spin °.',
    ball:
      '3 DOF — spherical orientation; state/limits drive X→Y→Z orientation through pivot.',
    universal:
      '2 DOF — Cardan; state/limits drive axis1 then axis2 angles.'
  }
  return map[joint]
}

/** Explains motion study `dofHint` for the Assembly UI. */
export function motionStudyDofHintLine(dofHint: AssemblyMotionStudyStub['dofHint']): string {
  switch (dofHint) {
    case 'none':
      return 'Rigid hint — keyframes still only drive preview rotation, not a solver.'
    case 'planar2d':
      return 'Planar motion hint — use for 2D mechanisms; keyframes remain preview-only.'
    case 'spatial6':
      return 'Spatial hint — up to six DOF semantics in other tools; here keyframes are preview-only.'
    default:
      return ''
  }
}

/** Inline validation for motion link stub fields on one row. */
export function motionLinkStubIssues(c: AssemblyComponent): string[] {
  const msgs: string[] = []
  const hasL = c.linkedInstanceId != null && c.linkedInstanceId.trim() !== ''
  const hasK = c.motionLinkKind != null
  if (hasL && !hasK) msgs.push('Set link kind (mate / contact / align), or clear the link peer.')
  if (!hasL && hasK) msgs.push('Pick a link peer instance, or clear link kind.')
  return msgs
}

/**
 * Heuristic checks for `meshPath` before save / interference (main process may still reject unsafe paths).
 */
export function meshPathLintIssues(meshPath: string | undefined): string[] {
  if (meshPath == null) return []
  const raw = meshPath
  const p = raw.trim()
  if (p === '') return []
  const issues: string[] = []
  if (p.startsWith('/') || p.startsWith('\\')) {
    issues.push('Use a path relative to the project folder (no leading slash).')
  }
  if (/^[a-zA-Z]:[/\\]/.test(p)) {
    issues.push('Avoid absolute drive letters; keep paths relative to the project root.')
  }
  if (p.includes('..')) {
    issues.push('Avoid ".." segments so projects stay portable.')
  }
  if (!/\.stl$/i.test(p)) {
    issues.push('The mesh checker expects a .stl file (binary STL recommended).')
  }
  if (/\\/.test(p)) {
    issues.push('Prefer forward slashes (/) so paths stay portable when the project moves between machines.')
  }
  if (/\/\/|\\\\/.test(p)) {
    issues.push('Avoid doubled path separators (// or \\\\).')
  }
  if (/[\x00-\x1f]/.test(p)) {
    issues.push('Path must not contain control characters or line breaks.')
  }
  if (p.length > 512) {
    issues.push('Path is very long; consider moving the mesh under a shorter folder name.')
  }
  if (raw !== raw.trim()) {
    issues.push('Trim leading/trailing spaces from the path.')
  }
  return issues
}

export type AssemblyInterferenceReport = {
  ok: true
  message: string
  /**
   * Component pairs to treat as **possible interference** for downstream UX:
   * narrow-phase **SAT hit**, or **incomplete** narrow phase (mesh / SAT budget truncation), or AABB-only when
   * narrow phase did not run. Pairs cleared by completed narrow phase (AABB overlap but no triangle hit) are omitted.
   */
  conflictingPairs: { aId: string; bId: string }[]
  /**
   * Heuristic: two active components share the same transform — they may overlap until geometry is checked.
   * Not a substitute for real interference detection.
   */
  sameTransformPairs?: { aId: string; bId: string; aName: string; bName: string }[]
  /** Active rows with `meshPath` and a readable binary STL */
  meshResolvedCount?: number
  /** Pairs among resolved meshes whose world axis-aligned bounds overlap (coarse; not full interference). */
  meshAabbOverlapPairs?: { aId: string; bId: string; aName: string; bName: string }[]
  /**
   * When AABB overlap, test **first triangle vs first triangle** (SAT stub); false positives/negatives are expected.
   */
  triangleStubPairs?: { aId: string; bId: string; aName: string; bName: string }[]
  /**
   * After AABB overlap: uniform-grid broad phase + triangle–triangle SAT on candidates (capped per mesh / per pair).
   * A hit means at least one intersecting triangle pair was found (still not a certified B-rep interference solver).
   */
  narrowPhaseOverlapPairs?: { aId: string; bId: string; aName: string; bName: string }[]
  /** Budget / truncation notes for narrow phase (e.g. triangle cap, SAT test cap). */
  meshNarrowPhaseNotes?: string[]
  /** Load/parse issues (missing file, ASCII STL, corrupt mesh, unsafe path, …) */
  meshWarnings?: string[]
  /** Roll-up for stubs / future analysis UIs */
  assemblyStats?: {
    activeComponentCount: number
    totalBomQuantity: number
    jointCounts: Record<string, number>
    /** Active components with motionIsolated === true */
    motionIsolatedCount?: number
  }
}

/** Tallies over non-suppressed components (shared by summary + interference stubs). */
export type ActiveAssemblyStats = {
  jointCounts: Record<string, number>
  totalBomQuantity: number
  motionIsolatedCount: number
}

export function rollActiveAssemblyStats(active: AssemblyComponent[]): ActiveAssemblyStats {
  const jointCounts: Record<string, number> = {}
  let totalBomQuantity = 0
  let motionIsolatedCount = 0
  for (const c of active) {
    const key = c.joint ?? 'none'
    jointCounts[key] = (jointCounts[key] ?? 0) + 1
    totalBomQuantity += c.bomQuantity
    if (c.motionIsolated) motionIsolatedCount += 1
  }
  return { jointCounts, totalBomQuantity, motionIsolatedCount }
}

function transformsEqual(a: AssemblyComponent['transform'], b: AssemblyComponent['transform']): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.z === b.z &&
    a.rxDeg === b.rxDeg &&
    a.ryDeg === b.ryDeg &&
    a.rzDeg === b.rzDeg
  )
}

/** Active rows whose `parentId` points at their own instance id (invalid tree link). */
export function countActiveParentSelfRefs(active: AssemblyComponent[]): number {
  let n = 0
  for (const c of active) {
    if (c.parentId != null && c.parentId === c.id) n += 1
  }
  return n
}

/**
 * Among **active** rows only: `true` if following `parentId` (staying inside active ids) revisits a node.
 * Includes self-parent (`parentId === id`) as a cycle.
 */
export function activeAssemblyParentGraphHasCycle(active: AssemblyComponent[]): boolean {
  const byId = new Map(active.map((c) => [c.id, c]))
  const activeIds = new Set(active.map((c) => c.id))
  for (const start of active) {
    const seen = new Set<string>()
    let cur: string | undefined = start.id
    let guard = 0
    while (cur != null && guard++ <= active.length + 2) {
      if (seen.has(cur)) return true
      seen.add(cur)
      const parentId: string | undefined = byId.get(cur)?.parentId
      if (!parentId || !activeIds.has(parentId)) break
      cur = parentId
    }
  }
  return false
}

/** Count of unordered active pairs sharing an identical transform (placement heuristic only). */
export function countActiveSameTransformPairs(active: AssemblyComponent[]): number {
  let n = 0
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      if (transformsEqual(active[i]!.transform, active[j]!.transform)) n += 1
    }
  }
  return n
}

/** IPC roll-up for analysis / palette without writing files (additive fields OK for consumers). */
export type AssemblySummaryReport = {
  name: string
  componentCount: number
  activeComponentCount: number
  /** Rows with suppressed === true */
  suppressedCount: number
  motionIsolatedCount: number
  totalBomQuantity: number
  jointCounts: Record<string, number>
  uniquePartPaths: string[]
  /** Active lines only: total BOM quantity grouped by partPath */
  bomQuantityByPartPath: Record<string, number>
  groundedActiveCount: number
  /** Active rows with no parentId */
  rootActiveCount: number
  /** Active rows with parentId set */
  childActiveCount: number
  /** Active rows whose parentId is set but does not match any component id */
  invalidParentRefActiveCount: number
  /** Unordered pairs of active rows with identical transforms */
  sameTransformActivePairCount: number
  /** Active rows: counts per non-empty referenceTag */
  referenceTagCounts: Record<string, number>
  /** Active rows: counts per non-empty externalComponentRef (PDM/ERP id) */
  externalComponentRefCounts: Record<string, number>
  /** Sorted unique part numbers among active rows (non-empty) */
  distinctActivePartNumbers: string[]
  /** Sorted unique external component refs among active rows (non-empty) */
  distinctActiveExternalRefs: string[]
  /** Active rows with non-empty trimmed `bomNotes` */
  activeWithBomNotesCount: number
  /** Active rows where `parentId === id` */
  activeParentSelfRefCount: number
  /**
   * Among active rows, following `parentId` within active ids revisits a node (includes self-parent).
   */
  activeParentGraphHasCycle: boolean
  /** Active rows with a non-empty `meshPath` */
  activeWithMeshPathCount: number
  /**
   * How many distinct `partPath` strings appear on **two or more** active rows (separate instances).
   */
  activePartPathsWithMultipleRows: number
  /**
   * How many distinct trimmed **part numbers** appear on **two or more** active rows (duplicate PN lines).
   */
  activePartNumbersWithMultipleRows: number
  /** More than one active row has `grounded === true` (often unintended). */
  multipleActiveGrounded: boolean
  /** Top-level `explodeView` block present */
  hasExplodeViewMetadata: boolean
  /** Top-level `motionStudy` block present */
  hasMotionStudyStub: boolean
  /** Active rows with a non-empty `linkedInstanceId` */
  activeWithLinkedInstanceCount: number
  /**
   * Active rows: `linkedInstanceId` set but missing from component ids, equals self, or points at a suppressed row
   * (treated as invalid for stub UX).
   */
  invalidLinkedInstanceRefActiveCount: number
  /** Active rows with both `linkedInstanceId` and `motionLinkKind` and a valid peer id (non-self, known id). */
  activeMotionLinkStubCount: number
  /** Active rows with only one of `linkedInstanceId` / `motionLinkKind` set (incomplete stub). */
  activeMotionLinkIncompleteCount: number
  /** Active rows: counts per `motionLinkKind` when set */
  motionLinkKindCounts: Record<string, number>
}

/** Active-component BOM tree: roots are rows with no `parentId` or whose parent is missing/suppressed. */
export type BomHierarchyNode = {
  id: string
  name: string
  partPath: string
  bomQuantity: number
  joint?: AssemblyComponent['joint']
  grounded: boolean
  meshPath?: string
  parentId?: string
  referenceTag?: string
  partNumber?: string
  externalComponentRef?: string
  bomNotes?: string
  bomUnit?: string
  bomVendor?: string
  bomCostEach?: string
  motionIsolated: boolean
  linkedInstanceId?: string
  motionLinkKind?: AssemblyComponent['motionLinkKind']
  children: BomHierarchyNode[]
}

/** CSV header written by `assembly:exportBom` (trailing `instanceId` for spreadsheet / ERP joins). */
export const ASSEMBLY_BOM_CSV_HEADER =
  'name,partPath,meshPath,grounded,joint,parentId,referenceTag,partNumber,externalComponentRef,bomNotes,bomQuantity,bomUnit,bomVendor,bomCostEach,suppressed,motionIsolated,linkedInstanceId,motionLinkKind,instanceId'

export function escapeAssemblyBomCsvField(value: string): string {
  const normalized = String(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  return `"${normalized.replace(/"/g, '""')}"`
}

/** One line per component + header row; used by main process BOM export. */
export function buildAssemblyBomCsvLines(asm: AssemblyFile): string[] {
  const lines = [ASSEMBLY_BOM_CSV_HEADER]
  for (const c of asm.components) {
    lines.push(
      [
        c.name,
        c.partPath,
        c.meshPath ?? '',
        String(c.grounded),
        c.joint ?? '',
        c.parentId ?? '',
        c.referenceTag ?? '',
        c.partNumber ?? '',
        c.externalComponentRef ?? '',
        c.bomNotes ?? '',
        String(c.bomQuantity),
        c.bomUnit ?? '',
        c.bomVendor ?? '',
        c.bomCostEach ?? '',
        String(c.suppressed),
        String(c.motionIsolated),
        c.linkedInstanceId ?? '',
        c.motionLinkKind ?? '',
        c.id
      ]
        .map(escapeAssemblyBomCsvField)
        .join(',')
    )
  }
  return lines
}

export function buildBomHierarchy(asm: AssemblyFile): BomHierarchyNode[] {
  const active = asm.components.filter((c) => !c.suppressed)
  const activeById = new Map(active.map((c) => [c.id, c]))
  const childrenMap = new Map<string, AssemblyComponent[]>()
  for (const c of active) {
    const pid = c.parentId
    if (pid && activeById.has(pid)) {
      const arr = childrenMap.get(pid) ?? []
      arr.push(c)
      childrenMap.set(pid, arr)
    }
  }
  for (const arr of childrenMap.values()) {
    arr.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  }

  function nodeFor(c: AssemblyComponent): BomHierarchyNode {
    const kids = (childrenMap.get(c.id) ?? []).map(nodeFor)
    return {
      id: c.id,
      name: c.name,
      partPath: c.partPath,
      bomQuantity: c.bomQuantity,
      joint: c.joint,
      grounded: c.grounded,
      meshPath: c.meshPath,
      parentId: c.parentId,
      referenceTag: c.referenceTag,
      partNumber: c.partNumber,
      externalComponentRef: c.externalComponentRef,
      bomNotes: c.bomNotes,
      bomUnit: c.bomUnit,
      bomVendor: c.bomVendor,
      bomCostEach: c.bomCostEach,
      motionIsolated: c.motionIsolated,
      linkedInstanceId: c.linkedInstanceId,
      motionLinkKind: c.motionLinkKind,
      children: kids
    }
  }

  const roots = active.filter((c) => !c.parentId || !activeById.has(c.parentId))
  roots.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  return roots.map(nodeFor)
}

/** Same payload shape as `assembly:exportBomHierarchyJson` writes under `output/bom-hierarchy.json`. */
export function buildBomHierarchyJsonText(asm: AssemblyFile, generatedAt = new Date().toISOString()): string {
  return JSON.stringify(
    {
      assemblyName: asm.name,
      generatedAt,
      tree: buildBomHierarchy(asm)
    },
    null,
    2
  )
}

export function buildAssemblySummaryReport(asm: AssemblyFile): AssemblySummaryReport {
  const components = asm.components
  const active = components.filter((c) => !c.suppressed)
  const idSet = new Set(components.map((c) => c.id))
  const compById = new Map(components.map((c) => [c.id, c]))
  const { jointCounts, totalBomQuantity, motionIsolatedCount } = rollActiveAssemblyStats(active)

  const bomQuantityByPartPath: Record<string, number> = {}
  const referenceTagCounts: Record<string, number> = {}
  const externalComponentRefCounts: Record<string, number> = {}
  const partNumbers = new Set<string>()
  const activeRowCountByPartNumber: Record<string, number> = {}
  let groundedActiveCount = 0
  let activeWithBomNotesCount = 0
  let rootActiveCount = 0
  let childActiveCount = 0
  let invalidParentRefActiveCount = 0
  let activeWithLinkedInstanceCount = 0
  let invalidLinkedInstanceRefActiveCount = 0
  let activeMotionLinkStubCount = 0
  let activeMotionLinkIncompleteCount = 0
  const motionLinkKindCounts: Record<string, number> = {}

  for (const c of active) {
    bomQuantityByPartPath[c.partPath] = (bomQuantityByPartPath[c.partPath] ?? 0) + c.bomQuantity
    if (c.grounded) groundedActiveCount += 1
    if (c.parentId) {
      childActiveCount += 1
      if (!idSet.has(c.parentId)) invalidParentRefActiveCount += 1
    } else {
      rootActiveCount += 1
    }
    const tag = c.referenceTag?.trim()
    if (tag) referenceTagCounts[tag] = (referenceTagCounts[tag] ?? 0) + 1
    const extRef = c.externalComponentRef?.trim()
    if (extRef) externalComponentRefCounts[extRef] = (externalComponentRefCounts[extRef] ?? 0) + 1
    const pn = c.partNumber?.trim()
    if (pn) {
      partNumbers.add(pn)
      activeRowCountByPartNumber[pn] = (activeRowCountByPartNumber[pn] ?? 0) + 1
    }
    if (c.bomNotes != null && c.bomNotes.trim() !== '') activeWithBomNotesCount += 1

    const linkTrim = c.linkedInstanceId?.trim()
    const hasLink = linkTrim != null && linkTrim !== ''
    const hasKind = c.motionLinkKind != null
    if (hasLink) activeWithLinkedInstanceCount += 1
    if (hasLink) {
      const peer = compById.get(linkTrim!)
      if (linkTrim === c.id || !peer || peer.suppressed) invalidLinkedInstanceRefActiveCount += 1
    }
    if ((hasLink && !hasKind) || (!hasLink && hasKind)) activeMotionLinkIncompleteCount += 1
    if (hasKind && c.motionLinkKind) {
      const k = c.motionLinkKind
      motionLinkKindCounts[k] = (motionLinkKindCounts[k] ?? 0) + 1
    }
    if (hasLink && hasKind && linkTrim && linkTrim !== c.id) {
      const peer = compById.get(linkTrim)
      if (peer && !peer.suppressed) activeMotionLinkStubCount += 1
    }
  }

  const distinctActivePartNumbers = [...partNumbers].sort((a, b) => a.localeCompare(b))
  const distinctActiveExternalRefs = Object.keys(externalComponentRefCounts).sort((a, b) => a.localeCompare(b))
  let activeWithMeshPathCount = 0
  const activeRowCountByPartPath: Record<string, number> = {}
  for (const c of active) {
    if (c.meshPath != null && c.meshPath.trim() !== '') activeWithMeshPathCount += 1
    activeRowCountByPartPath[c.partPath] = (activeRowCountByPartPath[c.partPath] ?? 0) + 1
  }
  let activePartPathsWithMultipleRows = 0
  for (const n of Object.values(activeRowCountByPartPath)) {
    if (n > 1) activePartPathsWithMultipleRows += 1
  }
  let activePartNumbersWithMultipleRows = 0
  for (const n of Object.values(activeRowCountByPartNumber)) {
    if (n > 1) activePartNumbersWithMultipleRows += 1
  }

  return {
    name: asm.name,
    componentCount: components.length,
    activeComponentCount: active.length,
    suppressedCount: components.length - active.length,
    motionIsolatedCount,
    totalBomQuantity,
    jointCounts,
    uniquePartPaths: [...new Set(components.map((c) => c.partPath))],
    bomQuantityByPartPath,
    groundedActiveCount,
    rootActiveCount,
    childActiveCount,
    invalidParentRefActiveCount,
    sameTransformActivePairCount: countActiveSameTransformPairs(active),
    referenceTagCounts,
    externalComponentRefCounts,
    distinctActivePartNumbers,
    distinctActiveExternalRefs,
    activeWithBomNotesCount,
    activeParentSelfRefCount: countActiveParentSelfRefs(active),
    activeParentGraphHasCycle: activeAssemblyParentGraphHasCycle(active),
    activeWithMeshPathCount,
    activePartPathsWithMultipleRows,
    activePartNumbersWithMultipleRows,
    multipleActiveGrounded: groundedActiveCount > 1,
    hasExplodeViewMetadata: asm.explodeView != null,
    hasMotionStudyStub: asm.motionStudy != null,
    activeWithLinkedInstanceCount,
    invalidLinkedInstanceRefActiveCount,
    activeMotionLinkStubCount,
    activeMotionLinkIncompleteCount,
    motionLinkKindCounts
  }
}

/** Accept legacy `assembly.json` (version 1 or missing version) and normalize to v2. */
export function parseAssemblyFile(input: unknown): AssemblyFile {
  const p = assemblyIncomingSchema.parse(input)
  const migratedComponents = p.components.map((c) => {
    const jointState = c.jointState ?? inferJointStateFromLegacy(c)
    const jointLimits = c.jointLimits ?? inferJointLimitsFromLegacy(c)
    return {
      ...c,
      ...(jointState != null ? { jointState } : {}),
      ...(jointLimits != null ? { jointLimits } : {})
    }
  })
  return {
    version: 2,
    name: p.name,
    components: migratedComponents,
    explodeView: p.explodeView,
    motionStudy: p.motionStudy
  }
}

function inferJointStateFromLegacy(c: AssemblyComponent): AssemblyJointState | undefined {
  switch (c.joint) {
    case 'revolute':
      return c.revolutePreviewAngleDeg == null ? undefined : { scalarDeg: c.revolutePreviewAngleDeg }
    case 'slider':
      return c.sliderPreviewMm == null ? undefined : { scalarMm: c.sliderPreviewMm }
    case 'planar': {
      const next: AssemblyJointState = {}
      if (c.planarPreviewUMm != null) next.uMm = c.planarPreviewUMm
      if (c.planarPreviewVMm != null) next.vMm = c.planarPreviewVMm
      return Object.keys(next).length > 0 ? next : undefined
    }
    case 'universal': {
      const next: AssemblyJointState = {}
      if (c.universalPreviewAngle1Deg != null) next.angle1Deg = c.universalPreviewAngle1Deg
      if (c.universalPreviewAngle2Deg != null) next.angle2Deg = c.universalPreviewAngle2Deg
      return Object.keys(next).length > 0 ? next : undefined
    }
    case 'cylindrical': {
      const next: AssemblyJointState = {}
      if (c.cylindricalPreviewSlideMm != null) next.slideMm = c.cylindricalPreviewSlideMm
      if (c.cylindricalPreviewSpinDeg != null) next.spinDeg = c.cylindricalPreviewSpinDeg
      return Object.keys(next).length > 0 ? next : undefined
    }
    case 'ball': {
      const next: AssemblyJointState = {}
      if (c.ballPreviewRxDeg != null) next.rxDeg = c.ballPreviewRxDeg
      if (c.ballPreviewRyDeg != null) next.ryDeg = c.ballPreviewRyDeg
      if (c.ballPreviewRzDeg != null) next.rzDeg = c.ballPreviewRzDeg
      return Object.keys(next).length > 0 ? next : undefined
    }
    default:
      return undefined
  }
}

function inferJointLimitsFromLegacy(c: AssemblyComponent): AssemblyJointLimits | undefined {
  switch (c.joint) {
    case 'revolute': {
      const next: AssemblyJointLimits = {}
      if (c.revolutePreviewMinDeg != null) next.scalarMinDeg = c.revolutePreviewMinDeg
      if (c.revolutePreviewMaxDeg != null) next.scalarMaxDeg = c.revolutePreviewMaxDeg
      return Object.keys(next).length > 0 ? next : undefined
    }
    case 'slider': {
      const next: AssemblyJointLimits = {}
      if (c.sliderPreviewMinMm != null) next.scalarMinMm = c.sliderPreviewMinMm
      if (c.sliderPreviewMaxMm != null) next.scalarMaxMm = c.sliderPreviewMaxMm
      return Object.keys(next).length > 0 ? next : undefined
    }
    case 'planar': {
      const next: AssemblyJointLimits = {}
      if (c.planarPreviewUMinMm != null) next.uMinMm = c.planarPreviewUMinMm
      if (c.planarPreviewUMaxMm != null) next.uMaxMm = c.planarPreviewUMaxMm
      if (c.planarPreviewVMinMm != null) next.vMinMm = c.planarPreviewVMinMm
      if (c.planarPreviewVMaxMm != null) next.vMaxMm = c.planarPreviewVMaxMm
      return Object.keys(next).length > 0 ? next : undefined
    }
    case 'universal': {
      const next: AssemblyJointLimits = {}
      if (c.universalPreviewAngle1MinDeg != null) next.angle1MinDeg = c.universalPreviewAngle1MinDeg
      if (c.universalPreviewAngle1MaxDeg != null) next.angle1MaxDeg = c.universalPreviewAngle1MaxDeg
      if (c.universalPreviewAngle2MinDeg != null) next.angle2MinDeg = c.universalPreviewAngle2MinDeg
      if (c.universalPreviewAngle2MaxDeg != null) next.angle2MaxDeg = c.universalPreviewAngle2MaxDeg
      return Object.keys(next).length > 0 ? next : undefined
    }
    case 'cylindrical': {
      const next: AssemblyJointLimits = {}
      if (c.cylindricalPreviewSlideMinMm != null) next.slideMinMm = c.cylindricalPreviewSlideMinMm
      if (c.cylindricalPreviewSlideMaxMm != null) next.slideMaxMm = c.cylindricalPreviewSlideMaxMm
      if (c.cylindricalPreviewSpinMinDeg != null) next.spinMinDeg = c.cylindricalPreviewSpinMinDeg
      if (c.cylindricalPreviewSpinMaxDeg != null) next.spinMaxDeg = c.cylindricalPreviewSpinMaxDeg
      return Object.keys(next).length > 0 ? next : undefined
    }
    case 'ball': {
      const next: AssemblyJointLimits = {}
      if (c.ballPreviewRxMinDeg != null) next.rxMinDeg = c.ballPreviewRxMinDeg
      if (c.ballPreviewRxMaxDeg != null) next.rxMaxDeg = c.ballPreviewRxMaxDeg
      if (c.ballPreviewRyMinDeg != null) next.ryMinDeg = c.ballPreviewRyMinDeg
      if (c.ballPreviewRyMaxDeg != null) next.ryMaxDeg = c.ballPreviewRyMaxDeg
      if (c.ballPreviewRzMinDeg != null) next.rzMinDeg = c.ballPreviewRzMinDeg
      if (c.ballPreviewRzMaxDeg != null) next.rzMaxDeg = c.ballPreviewRzMaxDeg
      return Object.keys(next).length > 0 ? next : undefined
    }
    default:
      return undefined
  }
}

/**
 * Indented BOM from `parentId` links (instance tree). Each line shows that row's `bomQuantity` (no roll-up).
 * Rows with missing/unknown `parentId` are roots. Cycles or unvisited rows are listed under `# Unattached`.
 */
export function buildHierarchicalBomText(asm: AssemblyFile): string {
  const byId = new Map(asm.components.map((c) => [c.id, c]))
  const childMap = new Map<string, AssemblyComponent[]>()
  for (const c of asm.components) {
    const p = c.parentId
    if (p && byId.has(p)) {
      const arr = childMap.get(p) ?? []
      arr.push(c)
      childMap.set(p, arr)
    }
  }
  const roots = asm.components.filter((c) => !c.parentId || !byId.has(c.parentId))
  const lines: string[] = [`Assembly: ${asm.name}`, '']
  const visited = new Set<string>()

  function lineFor(c: AssemblyComponent, depth: number): string {
    const pad = '  '.repeat(depth)
    const sup = c.suppressed ? '[suppressed] ' : ''
    const joint = c.joint ? ` joint=${c.joint}` : ''
    const meta: string[] = []
    const pn = c.partNumber?.trim()
    if (pn) meta.push(`PN ${pn}`)
    const rt = c.referenceTag?.trim()
    if (rt) meta.push(`Ref ${rt}`)
    const ext = c.externalComponentRef?.trim()
    if (ext) meta.push(`Ext ${ext}`)
    const note = c.bomNotes?.trim()
    if (note) {
      const short = note.length > 48 ? `${note.slice(0, 45)}…` : note
      meta.push(`Note ${short}`)
    }
    const u = c.bomUnit?.trim()
    if (u) meta.push(`Unit ${u}`)
    const v = c.bomVendor?.trim()
    if (v) {
      const short = v.length > 40 ? `${v.slice(0, 37)}…` : v
      meta.push(`Vendor ${short}`)
    }
    const cost = c.bomCostEach?.trim()
    if (cost) {
      const short = cost.length > 32 ? `${cost.slice(0, 29)}…` : cost
      meta.push(`Cost ${short}`)
    }
    const linkTo = c.linkedInstanceId?.trim()
    if (linkTo) meta.push(`Link→${linkTo}`)
    if (c.motionLinkKind) meta.push(`LinkKind ${c.motionLinkKind}`)
    const tail = meta.length > 0 ? `  (${meta.join(' · ')})` : ''
    return `${pad}${sup}${c.name} ×${c.bomQuantity}  ${c.partPath}${joint}${tail}`
  }

  function walk(c: AssemblyComponent, depth: number): void {
    if (visited.has(c.id)) return
    visited.add(c.id)
    lines.push(lineFor(c, depth))
    const kids = childMap.get(c.id) ?? []
    kids.sort((a, b) => a.name.localeCompare(b.name))
    for (const k of kids) walk(k, depth + 1)
  }

  roots.sort((a, b) => a.name.localeCompare(b.name))
  for (const r of roots) walk(r, 0)

  const unattached = asm.components.filter((c) => !visited.has(c.id))
  if (unattached.length > 0) {
    lines.push('', '# Unattached (cycle or inconsistent parent tree)')
    unattached.sort((a, b) => a.name.localeCompare(b.name))
    for (const c of unattached) walk(c, 0)
  }

  return lines.join('\n')
}

export function emptyAssembly(name = 'Assembly'): AssemblyFile {
  return { version: 2, name, components: [] }
}
