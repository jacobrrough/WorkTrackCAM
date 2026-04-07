import { z } from 'zod'

/**
 * Structured progress event emitted by Python CAM engines via stdout JSON lines.
 * The main process parses these and forwards them to the renderer via `cam:progress`.
 *
 * Python engines emit one JSON object per line to stdout, prefixed with `PROGRESS:`:
 * ```
 * PROGRESS:{"phase":"toolpath","percent":45,"message":"Generating raster passes"}
 * ```
 *
 * The main process strips the prefix, parses the JSON, validates against this schema,
 * and sends it to the renderer via `webContents.send('cam:progress', data)`.
 */
export const camProgressEventSchema = z.object({
  /** Current processing phase. */
  phase: z
    .enum([
      'init',
      'mesh_load',
      'heightfield',
      'toolpath',
      'post_process',
      'write',
      'complete',
      'error'
    ])
    .describe('Current CAM engine processing phase'),
  /** Progress percentage (0–100). May be approximate. */
  percent: z.number().min(0).max(100).describe('Progress percentage 0-100'),
  /** Optional human-readable status message for UI display. */
  message: z.string().optional().describe('Human-readable status message'),
  /** Optional phase-specific metadata. */
  detail: z
    .object({
      /** Number of toolpath points generated so far. */
      pointCount: z.number().int().nonnegative().optional(),
      /** Estimated total toolpath length in mm. */
      estimatedLengthMm: z.number().nonnegative().optional(),
      /** Current Z layer depth (for waterline/roughing). */
      currentZMm: z.number().optional(),
      /** Engine strategy name (for multi-strategy ops). */
      strategy: z.string().optional()
    })
    .optional()
    .describe('Phase-specific metadata for detailed progress reporting')
})

export type CamProgressEvent = z.infer<typeof camProgressEventSchema>

/** Prefix for progress JSON lines in Python engine stdout. */
export const CAM_PROGRESS_LINE_PREFIX = 'PROGRESS:'

/**
 * Try to parse a stdout line as a CAM progress event.
 * Returns the parsed event if the line matches the progress format, or null otherwise.
 * Non-progress lines (regular engine output) are silently skipped.
 */
export function parseCamProgressLine(line: string): CamProgressEvent | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith(CAM_PROGRESS_LINE_PREFIX)) return null

  const jsonPart = trimmed.slice(CAM_PROGRESS_LINE_PREFIX.length)
  try {
    const parsed = JSON.parse(jsonPart)
    const result = camProgressEventSchema.safeParse(parsed)
    return result.success ? result.data : null
  } catch {
    return null
  }
}
