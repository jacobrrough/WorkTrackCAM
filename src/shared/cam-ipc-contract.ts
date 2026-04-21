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
