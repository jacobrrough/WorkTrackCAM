/**
 * [P2-K2-PUSH]/Cycle 358-359 INTERACTIVE test (happy-dom): the K2 Plus
 * "Send to K2 Plus" flow must, once a Send is in-flight, surface a real
 * <progress> meter + "N% uploaded" label AND drive a polite screen-reader
 * live region from the live Moonraker upload-progress feed.
 *
 * A `renderToStaticMarkup` render-pin can never prove this -- the meter only
 * mounts while `k2Percent !== null` (i.e. during an active upload) and its
 * value + the live-region text update on each `onMoonrakerPushProgress`
 * tick, which requires a real click + effect lifecycle. Run with
 * `npm run test:dom`.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SliceManufacturePanel, type ManufactureAuxPanelsProps } from '../ManufactureAuxPanels'
import type { MachineProfile } from '../../../shared/machine-schema'

const k2Plus: MachineProfile = {
  id: 'creality-k2-plus',
  name: 'Creality K2 Plus',
  kind: 'fdm',
  workAreaMm: { x: 350, y: 350, z: 350 },
  maxFeedMmMin: 36000,
  axisCount: 3,
  dialect: 'generic_mm',
  postTemplate: 'fdm_passthrough.hbs'
}

type ProgressCb = (event: { sentBytes: number; totalBytes: number; percent: number }) => void

function installFabStub(): {
  emit: ProgressCb
  resolvePush: () => void
} {
  let captured: ProgressCb = () => {}
  let resolvePush: () => void = () => {}
  const fab = {
    filamentsList: vi.fn().mockResolvedValue([]),
    readTextFile: vi.fn().mockResolvedValue('G28\nG1 X0 Y0\n'),
    // Keep the push pending until the test releases it so the in-flight
    // meter is observable.
    moonrakerPush: vi.fn(
      () =>
        new Promise((resolve) => {
          resolvePush = () => resolve({ ok: true, filename: 'part.gcode', uploadedPath: 'part.gcode', printStarted: false, printerUrl: 'http://k2' })
        })
    ),
    onMoonrakerPushProgress: vi.fn((cb: ProgressCb) => {
      captured = cb
      return () => {}
    })
  }
  const g = globalThis as unknown as Record<string, unknown>
  g['window'] = globalThis
  g['fab'] = fab
  ;(globalThis as unknown as { window: { fab: unknown } }).window = globalThis as never
  ;(globalThis as unknown as { fab: unknown }).fab = fab
  return {
    emit: (event) => act(() => captured(event)),
    resolvePush: () => act(() => resolvePush())
  }
}

function baseProps(): ManufactureAuxPanelsProps {
  return {
    machines: [k2Plus],
    settings: { theme: 'dark', recentProjectPaths: [], moonrakerUrl: 'http://k2.local' } as never,
    project: null,
    manufacture: null,
    activeMachine: k2Plus,
    projectDir: '/proj',
    sliceOut: '',
    camOut: '',
    lastSliceGcodePath: '/proj/output/part.gcode',
    tools: null,
    onSaveSettingsField: vi.fn(),
    onStatus: vi.fn(),
    showSendButton: true
  } as unknown as ManufactureAuxPanelsProps
}

describe('SliceManufacturePanel -- K2 send progress meter (happy-dom)', () => {
  it('shows the progress meter + label + SR live region while uploading', async () => {
    const { emit, resolvePush } = installFabStub()
    const user = userEvent.setup()
    render(<SliceManufacturePanel {...baseProps()} />)

    // Idle: no meter yet, but the SR live region is always present.
    expect(screen.queryByTestId('k2-send-progress-meter')).toBeNull()
    expect(screen.getByTestId('k2-send-to-printer-status')).toBeTruthy()

    // Click Send -> the subscription is active and the meter mounts at 0%.
    await user.click(screen.getByTestId('k2-send-to-printer-button'))

    await waitFor(() => {
      expect(screen.getByTestId('k2-send-progress-meter')).toBeTruthy()
    })

    // Drive a mid-flight tick -> meter value + label update.
    emit({ sentBytes: 50, totalBytes: 100, percent: 50 })
    await waitFor(() => {
      const meter = screen.getByTestId('k2-send-progress-meter') as HTMLProgressElement
      expect(meter.value).toBe(50)
      expect(screen.getByTestId('k2-send-progress-label').textContent).toContain('50%')
    })

    // The 50% threshold announces into the polite live region.
    await waitFor(() => {
      expect(screen.getByTestId('k2-send-to-printer-status').textContent).toContain('50%')
    })

    // Release the push so the finally-block tears the meter down.
    resolvePush()
    await waitFor(() => {
      expect(screen.queryByTestId('k2-send-progress-meter')).toBeNull()
    })
  })
})
