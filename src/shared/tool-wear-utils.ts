import type { ToolRecord } from './tool-schema'

// ── Types ────────────────────────────────────────────────────────────────────

export type ToolLifeStatus = 'ok' | 'warn' | 'expired'

export interface ToolLifeCheck {
  /** ok = plenty of life, warn = past 80 %, expired = past 100 % */
  status: ToolLifeStatus
  /** 0–100 (can exceed 100 when over-life). -1 when life is unknown. */
  remainingPercent: number
  /** Human-readable one-liner for the operator. */
  message: string
}

export interface ToolChangeReminder {
  toolId: string
  toolName: string
  status: ToolLifeStatus
  remainingPercent: number
  message: string
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Percentage threshold where status flips from "ok" to "warn". */
const WARN_THRESHOLD = 20

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Evaluate a tool's remaining useful life.
 *
 * Rules:
 * - If `toolLifeMinutes` is not set (or zero), life tracking is disabled and
 *   the status is always "ok" with remainingPercent = -1 (unknown).
 * - Once `toolLifeUsedMinutes >= toolLifeMinutes`, the tool is "expired".
 * - Once remaining percentage drops to or below {@link WARN_THRESHOLD}, the
 *   tool is in "warn" state.
 * - Negative `toolLifeUsedMinutes` is clamped to 0 (defensive).
 */
export function checkToolLife(tool: ToolRecord): ToolLifeCheck {
  const totalLife = tool.toolLifeMinutes
  if (totalLife == null || totalLife <= 0) {
    return {
      status: 'ok',
      remainingPercent: -1,
      message: 'Tool life tracking is not configured.'
    }
  }

  const used = Math.max(0, tool.toolLifeUsedMinutes ?? 0)
  const remaining = totalLife - used
  const remainingPercent = Math.round((remaining / totalLife) * 100)

  if (remaining <= 0) {
    return {
      status: 'expired',
      remainingPercent: Math.max(remainingPercent, 0),
      message: `Tool life expired — used ${used.toFixed(1)} min of ${totalLife} min total.`
    }
  }

  if (remainingPercent <= WARN_THRESHOLD) {
    return {
      status: 'warn',
      remainingPercent,
      message: `Tool nearing end of life — ${remaining.toFixed(1)} min remaining (${remainingPercent}%).`
    }
  }

  return {
    status: 'ok',
    remainingPercent,
    message: `Tool OK — ${remaining.toFixed(1)} min remaining (${remainingPercent}%).`
  }
}

/**
 * Return a new `ToolRecord` with `toolLifeUsedMinutes` increased by the
 * given operation time. The original record is not mutated.
 *
 * Negative `operationTimeMinutes` values are clamped to 0.
 */
export function accumulateCutTime(
  tool: ToolRecord,
  operationTimeMinutes: number
): ToolRecord {
  const delta = Math.max(0, operationTimeMinutes)
  const current = Math.max(0, tool.toolLifeUsedMinutes ?? 0)
  return {
    ...tool,
    toolLifeUsedMinutes: current + delta
  }
}

/**
 * Scan a list of tools and return reminders for any that are in "warn" or
 * "expired" state. Tools without life tracking configured are excluded.
 *
 * Results are sorted: expired tools first, then warn, ordered by ascending
 * remaining percent within each group.
 */
export function generateToolChangeReminder(
  tools: ReadonlyArray<ToolRecord>
): ToolChangeReminder[] {
  const reminders: ToolChangeReminder[] = []

  for (const tool of tools) {
    const check = checkToolLife(tool)
    if (check.status === 'ok') continue
    reminders.push({
      toolId: tool.id,
      toolName: tool.name,
      status: check.status,
      remainingPercent: check.remainingPercent,
      message: check.message
    })
  }

  // Sort: expired first, then warn. Within same status, lower remaining % first.
  const statusOrder: Record<ToolLifeStatus, number> = { expired: 0, warn: 1, ok: 2 }
  reminders.sort(
    (a, b) =>
      statusOrder[a.status] - statusOrder[b.status] ||
      a.remainingPercent - b.remainingPercent
  )

  return reminders
}

/**
 * Human-readable one-line wear status string.
 *
 * Examples:
 * - "6mm 2-flute endmill — OK (75% life remaining)"
 * - "6mm 2-flute endmill — WARNING: 15% life remaining"
 * - "6mm 2-flute endmill — EXPIRED (0% life remaining)"
 * - "6mm 2-flute endmill — life tracking not configured"
 */
export function formatWearStatus(tool: ToolRecord): string {
  const check = checkToolLife(tool)
  const prefix = tool.name

  if (check.remainingPercent === -1) {
    return `${prefix} — life tracking not configured`
  }

  switch (check.status) {
    case 'ok':
      return `${prefix} — OK (${check.remainingPercent}% life remaining)`
    case 'warn':
      return `${prefix} — WARNING: ${check.remainingPercent}% life remaining`
    case 'expired':
      return `${prefix} — EXPIRED (${check.remainingPercent}% life remaining)`
  }
}
