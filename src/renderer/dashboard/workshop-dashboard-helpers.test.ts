/**
 * Pinning test for the WorkshopDashboard pure helpers (Gap #10).
 *
 * No DOM — these helpers run in the node-vitest environment.
 * The component (`WorkshopDashboard.test.tsx`) covers the render contract
 * separately via `react-dom/server.renderToStaticMarkup`.
 */
import { describe, expect, it } from 'vitest'
import type { Job } from '../src/shop-types'
import {
  DASHBOARD_CARD_IDS,
  dashboardCardIdForMachine,
  latestJobForCard,
  k2StatusKindFromMoonraker,
  statusFromJob,
  fileBasename,
  k2CanSendLatestSlice,
  formatEta,
  formatProgressPercent,
  DASHBOARD_STATUS_LABELS
} from './workshop-dashboard-helpers'

const job = (id: string, machineId: string | null, status: Job['status'] = 'idle'): Job => ({
  id,
  name: id,
  stlPath: null,
  machineId,
  materialId: null,
  stock: { x: 100, y: 100, z: 20 },
  transform: {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 }
  },
  stockProfile: 'cylinder',
  operations: [],
  posts: null,
  chuckDepthMm: 5,
  clampOffsetMm: 0,
  gcodeOut: null,
  status,
  lastLog: '',
  printerUrl: ''
})

describe('workshop-dashboard-helpers — card scope (My-Shop-Only)', () => {
  it('DASHBOARD_CARD_IDS is exactly the three slot identifiers in canonical order', () => {
    expect(DASHBOARD_CARD_IDS).toEqual([
      'laguna-swift-5x10',
      'creality-k2-plus',
      'makera-carvera'
    ])
    expect(DASHBOARD_CARD_IDS.length).toBe(3)
  })

  it('dashboardCardIdForMachine maps the three target IDs into the three slots', () => {
    expect(dashboardCardIdForMachine('laguna-swift-5x10')).toBe('laguna-swift-5x10')
    expect(dashboardCardIdForMachine('creality-k2-plus')).toBe('creality-k2-plus')
    expect(dashboardCardIdForMachine('makera-carvera-3axis')).toBe('makera-carvera')
    expect(dashboardCardIdForMachine('makera-carvera-4axis')).toBe('makera-carvera')
  })

  it('dashboardCardIdForMachine returns null for any non-shop machine ID', () => {
    expect(dashboardCardIdForMachine('prusa-mk4')).toBeNull()
    expect(dashboardCardIdForMachine('shapeoko-pro')).toBeNull()
    expect(dashboardCardIdForMachine('')).toBeNull()
    expect(dashboardCardIdForMachine(null)).toBeNull()
    expect(dashboardCardIdForMachine(undefined)).toBeNull()
  })
})

describe('workshop-dashboard-helpers — latestJobForCard', () => {
  it('returns null when no job targets the card slot', () => {
    expect(latestJobForCard([], 'laguna-swift-5x10')).toBeNull()
    expect(
      latestJobForCard(
        [job('j1', 'creality-k2-plus'), job('j2', 'makera-carvera-4axis')],
        'laguna-swift-5x10'
      )
    ).toBeNull()
  })

  it('returns the LATEST job matching the slot when many exist (newest-by-insertion-order)', () => {
    const jobs = [
      job('first', 'laguna-swift-5x10'),
      job('middle', 'creality-k2-plus'),
      job('latest-laguna', 'laguna-swift-5x10'),
      job('latest-k2', 'creality-k2-plus')
    ]
    expect(latestJobForCard(jobs, 'laguna-swift-5x10')?.id).toBe('latest-laguna')
    expect(latestJobForCard(jobs, 'creality-k2-plus')?.id).toBe('latest-k2')
  })

  it('the Carvera slot collects both 3-axis and 4-axis variants', () => {
    const jobs = [
      job('three', 'makera-carvera-3axis'),
      job('four', 'makera-carvera-4axis')
    ]
    expect(latestJobForCard(jobs, 'makera-carvera')?.id).toBe('four')
    // Drop the latest and the 3-axis one becomes the head of the bucket.
    expect(latestJobForCard([jobs[0]], 'makera-carvera')?.id).toBe('three')
  })

  it('ignores jobs with null / unknown machine IDs (no leakage into any card)', () => {
    const jobs = [
      job('floating', null),
      job('foreign', 'prusa-mk4'),
      job('laguna', 'laguna-swift-5x10')
    ]
    expect(latestJobForCard(jobs, 'laguna-swift-5x10')?.id).toBe('laguna')
    expect(latestJobForCard(jobs, 'creality-k2-plus')).toBeNull()
    expect(latestJobForCard(jobs, 'makera-carvera')).toBeNull()
  })
})

describe('workshop-dashboard-helpers — status derivation', () => {
  it('statusFromJob maps Job.status into the dashboard kind 1:1', () => {
    expect(statusFromJob(null)).toBe('idle')
    expect(statusFromJob(job('j', 'creality-k2-plus', 'idle'))).toBe('idle')
    expect(statusFromJob(job('j', 'creality-k2-plus', 'running'))).toBe('running')
    expect(statusFromJob(job('j', 'creality-k2-plus', 'error'))).toBe('error')
    expect(statusFromJob(job('j', 'creality-k2-plus', 'done'))).toBe('done')
  })

  it('k2StatusKindFromMoonraker maps known Moonraker states', () => {
    expect(k2StatusKindFromMoonraker('printing')).toBe('printing')
    expect(k2StatusKindFromMoonraker('paused')).toBe('paused')
    expect(k2StatusKindFromMoonraker('error')).toBe('error')
    expect(k2StatusKindFromMoonraker('complete')).toBe('done')
    expect(k2StatusKindFromMoonraker('standby')).toBe('idle')
    expect(k2StatusKindFromMoonraker('cancelled')).toBe('idle')
  })

  it('k2StatusKindFromMoonraker returns null for missing / unknown states (caller falls back)', () => {
    expect(k2StatusKindFromMoonraker(undefined)).toBeNull()
    expect(k2StatusKindFromMoonraker(null)).toBeNull()
    expect(k2StatusKindFromMoonraker('')).toBeNull()
    expect(k2StatusKindFromMoonraker('unknown')).toBeNull()
    expect(k2StatusKindFromMoonraker('weird-future-state')).toBeNull()
  })

  it('DASHBOARD_STATUS_LABELS covers every status kind', () => {
    // Exhaustive — TypeScript widens to all the keys via the Record type,
    // so every kind below must have a non-empty label.
    const labels = Object.entries(DASHBOARD_STATUS_LABELS)
    expect(labels.length).toBeGreaterThanOrEqual(8)
    for (const [, label] of labels) {
      expect(label.length).toBeGreaterThan(0)
    }
  })
})

describe('workshop-dashboard-helpers — fileBasename', () => {
  it('returns the trailing component of POSIX paths', () => {
    expect(fileBasename('/home/jacob/projects/job1/output/pocket.gcode')).toBe('pocket.gcode')
  })

  it('returns the trailing component of Windows paths', () => {
    expect(fileBasename('C:\\Users\\jacob\\projects\\job1\\output\\pocket.gcode')).toBe('pocket.gcode')
  })

  it('returns the input verbatim when there is no separator', () => {
    expect(fileBasename('lone.gcode')).toBe('lone.gcode')
  })

  it('returns null for empty / null / undefined inputs', () => {
    expect(fileBasename(null)).toBeNull()
    expect(fileBasename(undefined)).toBeNull()
    expect(fileBasename('')).toBeNull()
  })
})

describe('workshop-dashboard-helpers — k2CanSendLatestSlice gating', () => {
  it('requires BOTH a slice path AND a Moonraker URL', () => {
    expect(
      k2CanSendLatestSlice({ lastSliceGcodePath: '/p/s.gcode', moonrakerUrl: 'http://k2.local' })
    ).toBe(true)
  })

  it('rejects when either is missing / blank', () => {
    expect(k2CanSendLatestSlice({ lastSliceGcodePath: '', moonrakerUrl: 'http://k2.local' })).toBe(false)
    expect(k2CanSendLatestSlice({ lastSliceGcodePath: '/p/s.gcode', moonrakerUrl: '' })).toBe(false)
    expect(k2CanSendLatestSlice({ lastSliceGcodePath: null, moonrakerUrl: 'http://k2.local' })).toBe(false)
    expect(k2CanSendLatestSlice({ lastSliceGcodePath: '/p/s.gcode', moonrakerUrl: null })).toBe(false)
    expect(k2CanSendLatestSlice({ lastSliceGcodePath: undefined, moonrakerUrl: undefined })).toBe(false)
  })

  it('trims whitespace before checking truthiness', () => {
    expect(k2CanSendLatestSlice({ lastSliceGcodePath: '   ', moonrakerUrl: '   ' })).toBe(false)
    expect(
      k2CanSendLatestSlice({ lastSliceGcodePath: '  /p/s.gcode  ', moonrakerUrl: '  http://k2.local  ' })
    ).toBe(true)
  })
})

describe('workshop-dashboard-helpers — formatEta', () => {
  it('formats hours + minutes when both are non-zero', () => {
    expect(formatEta(3 * 3600 + 17 * 60)).toBe('3 h 17 m')
  })

  it('formats hours only when minutes round to zero', () => {
    expect(formatEta(2 * 3600)).toBe('2 h')
  })

  it('formats minutes only when under an hour', () => {
    expect(formatEta(45 * 60)).toBe('45 m')
  })

  it('formats sub-minute remaining times as "<1 m"', () => {
    expect(formatEta(30)).toBe('<1 m')
  })

  it('returns null for missing / non-positive / non-finite inputs', () => {
    expect(formatEta(undefined)).toBeNull()
    expect(formatEta(null)).toBeNull()
    expect(formatEta(0)).toBeNull()
    expect(formatEta(-100)).toBeNull()
    expect(formatEta(Number.NaN)).toBeNull()
    expect(formatEta(Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe('workshop-dashboard-helpers — formatProgressPercent', () => {
  it('formats a fractional progress as an integer percent', () => {
    expect(formatProgressPercent(0.5)).toBe('50%')
    expect(formatProgressPercent(0.123)).toBe('12%')
    expect(formatProgressPercent(1)).toBe('100%')
    expect(formatProgressPercent(0)).toBe('0%')
  })

  it('returns null for inputs outside [0,1] (Moonraker never reports >1 / <0 but be defensive)', () => {
    expect(formatProgressPercent(1.5)).toBeNull()
    expect(formatProgressPercent(-0.1)).toBeNull()
  })

  it('returns null for missing / non-finite inputs', () => {
    expect(formatProgressPercent(undefined)).toBeNull()
    expect(formatProgressPercent(null)).toBeNull()
    expect(formatProgressPercent(Number.NaN)).toBeNull()
    expect(formatProgressPercent(Number.POSITIVE_INFINITY)).toBeNull()
  })
})
