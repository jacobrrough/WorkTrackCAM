import { z } from 'zod'

/** Written to `part/kernel-manifest.json` after each kernel build attempt (Phase 1). */
export const kernelManifestSchema = z.object({
  version: z.literal(1),
  builtAt: z.string(),
  ok: z.boolean(),
  error: z.string().optional(),
  detail: z.string().optional(),
  stepPath: z.string().trim().min(1).optional(),
  stlPath: z.string().trim().min(1).optional(),
  solidKind: z.enum(['extrude', 'revolve', 'loft']).optional(),
  profileCount: z.number().optional(),
  /**
   * Kernel JSON payload:
   * 1 = base solid only
   * 2 = legacy postSolidOps
   * 3 = extended postSolidOps
   * 4 = true sweep/thread/thicken op set (with compatibility mapping for legacy surrogates)
   */
  payloadVersion: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  postSolidOpCount: z.number().optional(),
  /** Placement source used for kernel STEP/STL transform. */
  sketchPlaneKind: z.enum(['datum', 'face']).optional(),
  /** Present when `sketchPlaneKind` is `datum`. */
  sketchPlaneDatum: z.enum(['XY', 'XZ', 'YZ']).optional(),
  /** Preview-vs-kernel placement parity from STL AABB check. */
  placementParity: z.enum(['ok', 'mismatch', 'error']).optional(),
  placementParityDetail: z.string().optional(),
  placementParityMaxDeltaMm: z.number().optional(),
  /** SHA-256 hex of canonical design JSON used for the build (optional). */
  designHash: z.string().optional(),
  /** SHA-256 hex of canonical `part/features.json` JSON (optional; omitted on older manifests). */
  featuresHash: z.string().optional(),
  /**
   * CadQuery loft strategy when `solidKind` is loft: two-profile tags (`smooth+align`, `ruled+flip`, …)
   * or multi-profile `multi+union-chain:<n>:…`. Omitted for extrude/revolve or older Python builds.
   */
  loftStrategy: z.string().trim().min(1).optional(),
  /** Flat pattern strategy emitted when sheet fold/flat ops are present. */
  flatPatternStrategy: z.string().trim().min(1).optional(),
  /** Optional short operator hint (mirrors toast guidance from `kernel-build-messages.ts`). */
  userHint: z.string().trim().min(1).optional(),
  /**
   * Last applied `split_keep_halfspace` op (diagnostic). When the Python build exports the discarded half,
   * `splitDiscardedStepPath` / `splitDiscardedStlPath` are set.
   */
  splitKeepHalfspace: z
    .object({
      axis: z.enum(['X', 'Y', 'Z']),
      offsetMm: z.number().finite(),
      keep: z.enum(['positive', 'negative'])
    })
    .optional(),
  /** Optional STEP for the half-space discarded by the last split (same sketch placement as main body). */
  splitDiscardedStepPath: z.string().trim().min(1).optional(),
  /** Optional STL tessellation for the discarded split half (same mesh settings as main body when set). */
  splitDiscardedStlPath: z.string().trim().min(1).optional(),
  /**
   * When `loft_guide_rails` ops were present: `marker` = rail stored for UI only; `sketch_xy_align` =
   * first rail segment used as sketch-XY yaw hint for the second loft profile (bounded OCC influence).
   */
  loftGuideRailsKernelMode: z.enum(['marker', 'sketch_xy_align']).optional(),
  /**
   * Inspect/measure in Design uses tessellated kernel STL from STEP export — not live B-rep topology queries.
   */
  inspectBackend: z.literal('kernel_stl_tessellation').optional(),
  /**
   * When the kernel build payload set `stlMeshAngularToleranceDeg`, echoed here so inspect UI can state
   * tessellation intent (not a guarantee of B-rep accuracy).
   */
  stlMeshAngularToleranceDeg: z.number().finite().optional()
})

export type KernelManifest = z.infer<typeof kernelManifestSchema>

export function emptyKernelManifest(): KernelManifest {
  return {
    version: 1,
    builtAt: new Date().toISOString(),
    ok: false,
    error: 'never_built'
  }
}
