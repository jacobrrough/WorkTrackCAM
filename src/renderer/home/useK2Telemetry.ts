/**
 * Live K2 Plus telemetry for the Home shell.
 *
 * The K2 (Moonraker) is the ONLY machine with a live feed. When the active
 * machine is FDM and a Moonraker URL is configured, this polls
 * `moonrakerStatus` (print state + progress + ETA) and `moonrakerInfo` (live
 * nozzle/bed temps) every few seconds and returns a normalized snapshot.
 * Returns `null` for non-FDM machines, when no URL is set, offline, or in
 * isolation (no `window.fab`) — callers fall back to spec display.
 */
import { useEffect, useState } from 'react'
import type { MachineProfile } from '../../shared/machine-schema'
import { fab } from '../src/shop-types'

export interface K2Live {
  readonly online: boolean
  readonly state?: string
  readonly filename?: string
  /** 0–100, present only while a print is running. */
  readonly progressPct?: number
  readonly eta?: string
  readonly nozzle?: { presentC?: number; targetC?: number }
  readonly bed?: { presentC?: number; targetC?: number }
  readonly hostname?: string
  readonly firmwareVersion?: string
}

const POLL_MS = 6000

const hasFab = (): boolean => typeof window !== 'undefined' && Boolean((window as { fab?: unknown }).fab)

function normalizePct(progress: number | undefined): number | undefined {
  if (typeof progress !== 'number') return undefined
  const pct = progress <= 1 ? progress * 100 : progress
  return Math.max(0, Math.min(100, Math.round(pct)))
}

function formatEta(seconds: number | undefined): string | undefined {
  if (typeof seconds !== 'number' || seconds <= 0) return undefined
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `ETA ${m}:${String(s).padStart(2, '0')}`
}

export function useK2Telemetry(machine: MachineProfile | null): K2Live | null {
  const [live, setLive] = useState<K2Live | null>(null)
  const isFdm = machine?.kind === 'fdm'
  const machineId = machine?.id

  useEffect(() => {
    if (!isFdm || !hasFab()) {
      setLive(null)
      return
    }
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | undefined

    const poll = async (): Promise<void> => {
      try {
        const settings = await fab().settingsGet()
        const url = typeof settings.moonrakerUrl === 'string' ? settings.moonrakerUrl : ''
        if (!url) {
          if (!cancelled) setLive(null)
          return
        }
        const [status, info] = await Promise.all([
          fab().moonrakerStatus(url).catch(() => ({ ok: false as const })),
          fab().moonrakerInfo(url).catch(() => ({ ok: false as const, error: 'unreachable' }))
        ])
        if (cancelled) return
        if (!status.ok && !info.ok) {
          setLive({ online: false })
          return
        }
        setLive({
          online: true,
          state: status.ok ? (status.rawState ?? status.state) : info.ok ? info.state : undefined,
          filename: status.ok ? status.filename : undefined,
          progressPct: status.ok ? normalizePct(status.progress) : undefined,
          eta: status.ok ? formatEta(status.etaSeconds) : undefined,
          nozzle: info.ok ? info.nozzle : undefined,
          bed: info.ok ? info.bed : undefined,
          hostname: info.ok ? info.hostname : undefined,
          firmwareVersion: info.ok ? info.firmwareVersion : undefined
        })
      } catch {
        if (!cancelled) setLive(null)
      }
    }

    void poll()
    timer = setInterval(() => void poll(), POLL_MS)
    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
  }, [isFdm, machineId])

  return live
}
