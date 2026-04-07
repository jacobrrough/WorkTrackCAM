import { useMemo } from 'react'
import type { ManufactureOperation } from '../../shared/manufacture-schema'
import type { ToolRecord } from '../../shared/tool-schema'

/** Default assumed time per tool change in seconds (M6 + spindle spin-up). */
const TOOL_CHANGE_SECONDS = 30

/**
 * Resolved data for a single step in the tool change timeline.
 */
type TimelineStep = {
  /** Index in the original operations array. */
  opIndex: number
  /** Operation label for display. */
  label: string
  /** CNC operation kind. */
  kind: string
  /** Resolved tool name (from library) or fallback display. */
  toolName: string
  /** Tool diameter in mm. */
  toolDiameterMm: number
  /** ATC tool slot (1-6) or undefined. */
  toolSlot: number | undefined
  /** Whether a tool change is required before this step. */
  toolChangeRequired: boolean
}

export type ToolChangeTimelineProps = {
  /** All operations in the manufacture plan. */
  operations: ManufactureOperation[]
  /** Merged tool library for resolving tool names. */
  tools: ToolRecord[]
}

/**
 * Visual timeline showing tool usage across multiple CNC operations.
 * Highlights tool change points and shows estimated time impact.
 * Only renders when multiple operations use different tools.
 */
export function ToolChangeTimeline({ operations, tools }: ToolChangeTimelineProps): React.ReactNode {
  const timeline = useMemo((): TimelineStep[] => {
    const cncOps = operations
      .map((op, i) => ({ op, opIndex: i }))
      .filter(({ op }) => op.kind.startsWith('cnc_') && !op.suppressed)

    if (cncOps.length < 2) return []

    const steps: TimelineStep[] = []
    let prevToolId: string | undefined
    let prevSlot: number | undefined

    for (const { op, opIndex } of cncOps) {
      const toolId = typeof op.params?.['toolId'] === 'string' ? op.params['toolId'] : undefined
      const rec = toolId ? tools.find((t) => t.id === toolId) : undefined
      const diamMm =
        typeof op.params?.['toolDiameterMm'] === 'number'
          ? op.params['toolDiameterMm']
          : rec?.diameterMm ?? 6
      const slot = rec?.toolSlot
      const toolName = rec ? rec.name : toolId ? `Tool ${toolId}` : `Default (${diamMm} mm)`

      // Determine if a tool change is needed: different toolId or different slot
      const changed =
        steps.length > 0 &&
        (toolId !== prevToolId || (slot != null && prevSlot != null && slot !== prevSlot))

      steps.push({
        opIndex,
        label: op.label,
        kind: op.kind,
        toolName,
        toolDiameterMm: diamMm,
        toolSlot: slot,
        toolChangeRequired: changed
      })

      prevToolId = toolId
      prevSlot = slot
    }

    return steps
  }, [operations, tools])

  const toolChangeCount = useMemo(
    () => timeline.filter((s) => s.toolChangeRequired).length,
    [timeline]
  )

  // Only show the timeline when there are actual tool changes
  if (toolChangeCount === 0) return null

  const estimatedTimeSec = toolChangeCount * TOOL_CHANGE_SECONDS
  const uniqueTools = new Set(timeline.map((s) => s.toolName))

  return (
    <section
      className="tool-change-timeline"
      aria-label="Tool change timeline"
    >
      <div className="tool-change-timeline__header">
        <h4 className="tool-change-timeline__title">Tool Changes</h4>
        <span className="tool-change-timeline__summary">
          {toolChangeCount} change{toolChangeCount !== 1 ? 's' : ''} across {uniqueTools.size} tools
          {' '}({formatTime(estimatedTimeSec)} est.)
        </span>
      </div>

      <div className="tool-change-timeline__track" role="list">
        {timeline.map((step, i) => (
          <div
            key={`${step.opIndex}-${i}`}
            className={`tool-change-timeline__step${step.toolChangeRequired ? ' tool-change-timeline__step--change' : ''}`}
            role="listitem"
          >
            {step.toolChangeRequired ? (
              <div className="tool-change-timeline__divider" aria-label="Tool change point">
                <span className="tool-change-timeline__divider-icon">M6</span>
                <span className="tool-change-timeline__divider-label">
                  T{step.toolSlot ?? '?'}
                </span>
              </div>
            ) : null}
            <div className="tool-change-timeline__op">
              <span className="tool-change-timeline__op-index">
                {step.opIndex + 1}
              </span>
              <div className="tool-change-timeline__op-info">
                <span className="tool-change-timeline__op-label">{step.label}</span>
                <span className="tool-change-timeline__op-tool">
                  {step.toolName}
                  {step.toolSlot != null ? ` (T${step.toolSlot})` : ''}
                  {' \u2014 \u00D8'}{step.toolDiameterMm.toFixed(1)} mm
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function formatTime(sec: number): string {
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}
