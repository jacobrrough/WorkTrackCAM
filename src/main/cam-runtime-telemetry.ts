export type CamRuntimeStageEvent = {
  stage: string
  durationMs: number
  ok: boolean
  detail?: string
}

export type CamRuntimeTelemetrySink = (event: CamRuntimeStageEvent) => void

function defaultSink(event: CamRuntimeStageEvent): void {
  if (process.env.DEBUG_CAM === '1' || process.env.DEBUG_CAM === 'true') {
    const status = event.ok ? 'ok' : 'error'
    const detail = event.detail ? ` (${event.detail})` : ''
    console.error(`[cam-telemetry] ${event.stage}: ${status} ${event.durationMs}ms${detail}`)
  }
}

export async function withCamStageTelemetry<T>(
  stage: string,
  run: () => Promise<T>,
  sink: CamRuntimeTelemetrySink = defaultSink
): Promise<T> {
  const t0 = Date.now()
  try {
    const value = await run()
    sink({ stage, durationMs: Date.now() - t0, ok: true })
    return value
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    sink({ stage, durationMs: Date.now() - t0, ok: false, detail })
    throw error
  }
}
