import { z } from 'zod'

export const camRunPayloadSchema = z.object({
  stlPath: z.string().min(1),
  outPath: z.string().min(1),
  machineId: z.string().min(1),
  zPassMm: z.number().finite(),
  stepoverMm: z.number().finite(),
  feedMmMin: z.number().finite(),
  plungeMmMin: z.number().finite(),
  safeZMm: z.number().finite(),
  pythonPath: z.string().min(1),
  operationKind: z.string().optional(),
  operationLabel: z.string().optional(),
  workCoordinateIndex: z.number().int().min(1).max(6).optional(),
  toolDiameterMm: z.number().finite().positive().optional(),
  operationParams: z.record(z.unknown()).optional(),
  rotaryStockLengthMm: z.number().finite().positive().optional(),
  rotaryStockDiameterMm: z.number().finite().positive().optional(),
  rotaryChuckDepthMm: z.number().finite().min(0).optional(),
  rotaryClampOffsetMm: z.number().finite().min(0).optional(),
  stockBoxZMm: z.number().finite().optional(),
  stockBoxXMm: z.number().finite().optional(),
  stockBoxYMm: z.number().finite().optional(),
  priorPostedGcode: z.string().optional(),
  useMeshMachinableXClamp: z.boolean().optional(),
  toolSlot: z.number().int().min(1).max(99).optional(),
  /**
   * Optional Three.js viewer-space gizmo placement (position/rotation in
   * degrees/scale). When supplied, the 4-axis engine applies this transform
   * to the raw STL itself instead of relying on a renderer-baked
   * `.cam-aligned.stl`. The renderer should send this for 4-axis ops.
   */
  placement: z
    .object({
      position: z.object({
        x: z.number().finite(),
        y: z.number().finite(),
        z: z.number().finite()
      }),
      rotation: z.object({
        x: z.number().finite(),
        y: z.number().finite(),
        z: z.number().finite()
      }),
      scale: z.object({
        x: z.number().finite(),
        y: z.number().finite(),
        z: z.number().finite()
      })
    })
    .optional(),
  /**
   * Optional rotary fixture geometry (chuck + optional tailstock) for the
   * 4-axis collision sweep. Mirrors `RotaryFixtureConfig` in
   * `src/shared/rotary-collision.ts`. When supplied, the 4-axis engine parses
   * its own posted G-code into segments and checks every move for radial
   * clearance against the chuck/tailstock cylinders, surfacing any violations
   * as WARNINGS on the run result. Safety: advisory-only — never alters the
   * emitted toolpath/post output. Ignored by non-4-axis ops. When the renderer
   * omits the tailstock fields the engine still runs the chuck-only sweep
   * (synthesizing a chuck from the machine profile's `rotaryChuckOuterRadiusMm`
   * when neither this fixture's chuck radius nor a setup override is present).
   */
  rotaryFixture: z
    .object({
      chuckDepthMm: z.number().nonnegative().finite(),
      // nonnegative (not positive): the tailstock-only case sends
      // chuckOuterRadiusMm = 0 to mean "no chuck override — defer the chuck
      // sweep to the engine's machine-profile default" (see
      // `resolveRotaryFixture` in run-cam-for-op.ts). A 0-radius chuck cylinder
      // never flags a collision, so the engine's default chuck sweep is what
      // actually runs in that case.
      chuckOuterRadiusMm: z.number().nonnegative().finite(),
      tailstockStartXMm: z.number().nonnegative().finite().optional(),
      tailstockOuterRadiusMm: z.number().positive().finite().optional()
    })
    .optional()
})

export type CamRunPayload = z.infer<typeof camRunPayloadSchema>

export const camRunEngineSchema = z.object({
  requestedEngine: z.enum(['advanced', 'ocl', 'builtin']),
  usedEngine: z.enum(['advanced', 'ocl', 'builtin']),
  fallbackApplied: z.boolean(),
  fallbackReason: z
    .enum([
      'invalid_numeric_params',
      'stl_missing',
      'config_error',
      'stl_read_error',
      'opencamlib_not_installed',
      'ocl_runtime_or_empty',
      'python_spawn_failed',
      'advanced_engine_failed',
      'unknown_ocl_failure'
    ])
    .optional(),
  fallbackDetail: z.string().optional()
})

export const camRunSuccessSchema = z.object({
  ok: z.literal(true),
  gcode: z.string().optional(),
  usedEngine: z.enum(['advanced', 'ocl', 'builtin']),
  engine: camRunEngineSchema,
  hint: z.string().optional(),
  warnings: z.array(z.string()).optional()
})

export const camRunFailureSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
  hint: z.string().optional()
})

export const camRunResultSchema = z.union([camRunSuccessSchema, camRunFailureSchema])

export type CamRunResultContract = z.infer<typeof camRunResultSchema>
