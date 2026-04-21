import { z } from 'zod'

export const camEngineIdSchema = z.enum(['advanced', 'ocl', 'builtin'])

export const camEngineRequestSchema = z.object({
  stlPath: z.string().min(1),
  operationKind: z.string().optional(),
  toolDiameterMm: z.number().finite().positive().optional(),
  feedMmMin: z.number().finite().positive(),
  plungeMmMin: z.number().finite().positive(),
  stepoverMm: z.number().finite().positive(),
  zPassMm: z.number().finite().positive()
})

export const camEngineProgressSchema = z.object({
  phase: z.string().min(1),
  percent: z.number().min(0).max(100),
  detail: z.string().optional()
})

export const camEngineWarningSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1)
})

export const camEngineFailureSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  detail: z.string().optional()
})

export const camEngineSuccessSchema = z.object({
  ok: z.literal(true),
  engineId: camEngineIdSchema,
  postedGcode: z.string().min(1),
  warnings: z.array(camEngineWarningSchema).default([])
})

export const camEngineErrorSchema = z.object({
  ok: z.literal(false),
  engineId: camEngineIdSchema,
  failure: camEngineFailureSchema
})

export const camEngineResultSchema = z.union([camEngineSuccessSchema, camEngineErrorSchema])

export type CamEngineRequest = z.infer<typeof camEngineRequestSchema>
export type CamEngineProgress = z.infer<typeof camEngineProgressSchema>
export type CamEngineWarning = z.infer<typeof camEngineWarningSchema>
export type CamEngineFailure = z.infer<typeof camEngineFailureSchema>
export type CamEngineResult = z.infer<typeof camEngineResultSchema>
