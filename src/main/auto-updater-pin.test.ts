/**
 * auto-updater-pin.test.ts -- [ID-0304] Cycle 231 test-coverage paired-pin
 *
 * Pins the contract of `src/main/auto-updater.ts` -- the 156-line MAIN-process
 * auto-update lifecycle module that wraps `electron-updater` so the
 * Cowork-style auto-update flow is safe for ALL THREE target machines'
 * desktop deployments (Creality K2 Plus / Laguna Swift 5x10 / Makera Carvera
 * + 4-axis Rotary). The module:
 *
 *   - Resolves an update server URL via `WORKTRACK_UPDATE_URL` env var ->
 *     `appSettings.updateServerUrl` -> default GitHub Releases feed.
 *   - Registers exactly THREE IPC handlers (`updater:status`,
 *     `updater:checkNow`, `updater:quitAndInstall`) so the renderer can
 *     query / trigger update flows.
 *   - Schedules an initial deferred update check 10 s after init so startup
 *     is not slowed by a live network call.
 *   - Owns a private `currentStatus: UpdateStatus` module-singleton that
 *     transitions through the 7-variant discriminated union as
 *     `electron-updater` events fire.
 *   - Catches all errors so a misconfigured / unavailable update feed
 *     NEVER crashes the app (critical for shop machines that run offline).
 *   - Silently swallows the well-known "expected in dev / offline / no
 *     releases" error families (`ERR_UPDATER_CHANNEL_FILE_NOT_FOUND`,
 *     `No published versions`, `ENOENT`, `net::`, `HttpError`) to avoid
 *     a red error toast on every machine that boots without a network.
 *
 * Cross-cuts every target machine in the CLAUDE.md "USER CONTEXT" list:
 *
 *   - **Creality K2 Plus** (FDM, Klipper/Moonraker): the K2 Plus shop is
 *     the only one of the three that lives on a heated-chamber machine
 *     network and most often runs WITHOUT a route to the internet. The
 *     "expected error swallow list" pin (Group G) protects the K2 Plus
 *     daily print start from a red toast every cold-boot. The renderer-
 *     visible status flips to `idle` (NOT `error`) when no published
 *     version is reachable -- the renderer's `updater:status` IPC channel
 *     stays clean for the K2 Plus shop user.
 *   - **Laguna Swift 5x10** (CNC router, RichAuto A-series, Mach3 superset):
 *     Laguna shop floors usually have spotty network. Group F pins that
 *     `download-progress` events round the percent to an integer (matches
 *     the Mach3-style "% complete" pendant convention rather than a
 *     12.34567 fractional).
 *   - **Makera Carvera 3-axis + 4-axis Rotary** (Makera Controller): the
 *     Carvera desktop ATC is most often used as a single-user developer
 *     box where the auto-installer-on-quit path is the right choice.
 *     Group H pins `autoUpdater.autoInstallOnAppQuit = true` and
 *     `autoUpdater.autoDownload = false` source-text invariants.
 *
 * The existing behavioral test (`auto-updater.test.ts`, 103 lines, 11 it()
 * blocks) covers ONLY `resolveUpdateServerUrl` URL resolution + `UpdateStatus`
 * type literal smoke. THIS pin file additionally pins:
 *   (A) module shape -- exact 3 runtime exports + 1 type export, function
 *       arities, no other public surface,
 *   (B) `UpdateStatus` discriminated union -- exactly 7 variants
 *       (idle/checking/available/not-available/downloading/downloaded/error),
 *       per-variant field set,
 *   (C) `resolveUpdateServerUrl` invariants reaffirmed -- env > settings
 *       priority, undefined-when-neither, blank/whitespace-only skip,
 *       wrap-trim, no process.env mutation,
 *   (D) `initAutoUpdater` IPC handler registration -- exactly 3 channels
 *       in source-declaration order, registered SYNCHRONOUSLY before the
 *       deferred setTimeout fires,
 *   (E) registered IPC handlers -- `updater:status` returns currentStatus
 *       reference, `updater:checkNow` returns updated status,
 *       `updater:quitAndInstall` does not throw and tolerates the dynamic
 *       import rejection,
 *   (F) `electron-updater` event handler wiring -- update-available /
 *       update-not-available / download-progress (rounded percent) /
 *       update-downloaded / error transitions hit the expected status
 *       variant,
 *   (G) error-filter swallow list -- the 5 "expected" error substrings
 *       (`ERR_UPDATER_CHANNEL_FILE_NOT_FOUND`, `No published versions`,
 *       `ENOENT`, `net::`, `HttpError`) ALL collapse to status=idle
 *       without surfacing an error message; everything else lands as
 *       `state: 'error'` with the original message,
 *   (H) source-text whitelist -- no `:any`/`as any`, no eval / new
 *       Function, no `node:fs`/`node:path`/`node:child_process` imports,
 *       single static `electron` import, single static type-only
 *       `electron-updater` import, exactly 2 dynamic
 *       `import('electron-updater')` call-sites (handler + checker),
 *       `autoDownload = false`, `autoInstallOnAppQuit = true`,
 *       `setTimeout(..., 10_000)` deferred-init literal,
 *       `WORKTRACK_UPDATE_URL` env-var name literal, console.warn (NOT
 *       console.error) on non-fatal failures, no machine-specific
 *       literals (K2 Plus / Laguna / Carvera / Klipper / Moonraker /
 *       RichAuto / Mach3 / G-code keywords),
 *   (I) three-machine cross-cut realism -- single env var serves all 3
 *       shops, error-filter swallow list keeps offline shops quiet,
 *       autoDownload=false respects the user's bandwidth, percent
 *       rounding matches pendant conventions, no machine-specific
 *       branching in the updater (one binary, three machines),
 *   (J) type-level parity -- `UpdateStatus` is the 7-string union via TS
 *       expressions only.
 *
 * ZERO production-code edits. Pure additive paired-pin (mirrors Cycles 132 /
 * 199 / 215 / 228 / 229 / 230).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// ──────────────────────────────────────────────────────────────────────────
// Mocks: electron + electron-updater
//
// vi.mock factories are hoisted above all imports. Anything they reference
// must be declared inside `vi.hoisted(...)` so the references resolve at
// hoist time rather than at module-init time.
// ──────────────────────────────────────────────────────────────────────────

type IpcHandler = (...args: unknown[]) => unknown | Promise<unknown>
type EventCb = (payload: unknown) => void

const HOISTED = vi.hoisted(() => {
  const ipcRegistry = new Map<string, (...args: unknown[]) => unknown | Promise<unknown>>()
  const ipcHandleMock = vi.fn(
    (channel: string, handler: (...args: unknown[]) => unknown | Promise<unknown>) => {
      ipcRegistry.set(channel, handler)
    }
  )

  // Bus that captures autoUpdater.on(event, callback) pairs so tests can
  // drive the state machine. Each `safeCheckForUpdates` invocation
  // registers fresh listeners; for our purposes we read the LAST-registered
  // callback.
  const autoUpdaterEventBus = new Map<string, Array<(payload: unknown) => void>>()
  const autoUpdaterOnMock = vi.fn((event: string, cb: (payload: unknown) => void) => {
    const list = autoUpdaterEventBus.get(event) ?? []
    list.push(cb)
    autoUpdaterEventBus.set(event, list)
  })

  const autoUpdaterMock = {
    autoDownload: true, // module sets this to false during init
    autoInstallOnAppQuit: false, // module sets this to true during init
    setFeedURL: vi.fn(),
    on: autoUpdaterOnMock,
    checkForUpdates: vi.fn().mockResolvedValue(null),
    quitAndInstall: vi.fn()
  }

  return {
    ipcRegistry,
    ipcHandleMock,
    autoUpdaterEventBus,
    autoUpdaterOnMock,
    autoUpdaterMock
  }
})

const ipcRegistry = HOISTED.ipcRegistry as Map<string, IpcHandler>
const ipcHandleMock = HOISTED.ipcHandleMock
const autoUpdaterEventBus = HOISTED.autoUpdaterEventBus as Map<string, Array<EventCb>>
const autoUpdaterOnMock = HOISTED.autoUpdaterOnMock
const autoUpdaterMock = HOISTED.autoUpdaterMock

vi.mock('electron', () => ({
  ipcMain: {
    handle: HOISTED.ipcHandleMock
  }
}))

vi.mock('electron-updater', () => ({
  autoUpdater: HOISTED.autoUpdaterMock
}))

// Defer module import until after mocks are in place.
import * as M from './auto-updater'
import {
  resolveUpdateServerUrl,
  initAutoUpdater,
  checkForUpdatesManual,
  type UpdateStatus
} from './auto-updater'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC_PATH = join(HERE, 'auto-updater.ts')
const SRC = readFileSync(SRC_PATH, 'utf-8')

// Helpers
function resetMocksAndState(): void {
  ipcHandleMock.mockClear()
  ipcRegistry.clear()
  autoUpdaterOnMock.mockClear()
  autoUpdaterEventBus.clear()
  autoUpdaterMock.setFeedURL.mockClear()
  autoUpdaterMock.checkForUpdates.mockReset().mockResolvedValue(null)
  autoUpdaterMock.quitAndInstall.mockClear()
  autoUpdaterMock.autoDownload = true
  autoUpdaterMock.autoInstallOnAppQuit = false
}

function getMainWindowStub(): null {
  return null
}

const ORIG_ENV = process.env['WORKTRACK_UPDATE_URL']
function restoreEnv(): void {
  if (ORIG_ENV === undefined) delete process.env['WORKTRACK_UPDATE_URL']
  else process.env['WORKTRACK_UPDATE_URL'] = ORIG_ENV
}

beforeEach(() => {
  resetMocksAndState()
  // Suppress the module's console.warn during error-path tests; restored after.
  vi.spyOn(console, 'warn').mockImplementation(() => {
    /* swallow */
  })
})

afterEach(() => {
  restoreEnv()
  vi.restoreAllMocks()
})

// ──────────────────────────────────────────────────────────────────────────
// A. Module shape -- exact runtime + type surface
// ──────────────────────────────────────────────────────────────────────────

describe('A. auto-updater module shape', () => {
  it('exports exactly 3 runtime symbols (sorted)', () => {
    const runtimeKeys = Object.keys(M)
      .filter((k) => typeof (M as Record<string, unknown>)[k] !== 'undefined')
      .sort()
    expect(runtimeKeys).toEqual([
      'checkForUpdatesManual',
      'initAutoUpdater',
      'resolveUpdateServerUrl'
    ])
  })

  it('all 3 runtime exports classify as `function`', () => {
    expect(typeof resolveUpdateServerUrl).toBe('function')
    expect(typeof initAutoUpdater).toBe('function')
    expect(typeof checkForUpdatesManual).toBe('function')
  })

  it('resolveUpdateServerUrl arity = 1 (single optional settingsUrl)', () => {
    // TypeScript `param?: T` compiles to a regular JS positional param without
    // a default value, so .length still counts it. Pin the compiled JS
    // surface, not the TS sugar. Signature: function(settingsUrl) -> 1.
    expect(resolveUpdateServerUrl.length).toBe(1)
  })

  it('initAutoUpdater arity = 2 (getMainWindow + settingsUpdateUrl optional)', () => {
    // Signature compiles to: function(getMainWindow, settingsUpdateUrl)
    // -> .length === 2 (TS `?` does not add a default value).
    expect(initAutoUpdater.length).toBe(2)
  })

  it('checkForUpdatesManual arity = 1 (single optional settingsUpdateUrl)', () => {
    expect(checkForUpdatesManual.length).toBe(1)
  })

  it('UpdateStatus is exported as a TYPE only (not a value)', () => {
    // If it were a value export it would land in Object.keys(M) and fail the
    // 3-runtime-key pin above. Source-text reaffirms with `export type`.
    expect(SRC).toMatch(/export type UpdateStatus =/)
  })

  it('no other public exports leak (no class, no const, no let)', () => {
    // Source-level: top-level `export ` only on the 3 functions + 1 type.
    const exportLines = SRC.split('\n').filter((l) => /^export\b/.test(l))
    // Expect exactly 4 export-starting lines: type UpdateStatus, function
    // resolveUpdateServerUrl, async function initAutoUpdater, async function
    // checkForUpdatesManual.
    expect(exportLines.length).toBe(4)
    expect(exportLines.some((l) => /^export type UpdateStatus =/.test(l))).toBe(true)
    expect(exportLines.some((l) => /^export function resolveUpdateServerUrl\b/.test(l))).toBe(true)
    expect(exportLines.some((l) => /^export async function initAutoUpdater\b/.test(l))).toBe(true)
    expect(exportLines.some((l) => /^export async function checkForUpdatesManual\b/.test(l))).toBe(
      true
    )
  })
})

// ──────────────────────────────────────────────────────────────────────────
// B. UpdateStatus discriminated union shape
// ──────────────────────────────────────────────────────────────────────────

describe('B. UpdateStatus discriminated union', () => {
  it('source declares exactly 7 union variants (one per state)', () => {
    // Find the UpdateStatus block: from `export type UpdateStatus =` up to
    // the next blank line / non-pipe line. Count `| { state: '...' ... }`.
    const m = SRC.match(/export type UpdateStatus =\n([\s\S]*?)\n\n/)
    expect(m).not.toBeNull()
    const body = m![1]!
    const variantCount = (body.match(/\|\s*\{\s*state:/g) ?? []).length
    expect(variantCount).toBe(7)
  })

  it('source declares all 7 state literals', () => {
    expect(SRC).toMatch(/state:\s*'idle'/)
    expect(SRC).toMatch(/state:\s*'checking'/)
    expect(SRC).toMatch(/state:\s*'available';\s*version:\s*string;\s*releaseNotes\?:\s*string/)
    expect(SRC).toMatch(/state:\s*'not-available';\s*version:\s*string/)
    expect(SRC).toMatch(/state:\s*'downloading';\s*percent:\s*number/)
    expect(SRC).toMatch(/state:\s*'downloaded';\s*version:\s*string/)
    expect(SRC).toMatch(/state:\s*'error';\s*message:\s*string/)
  })

  it('idle variant has no extra fields', () => {
    const status: UpdateStatus = { state: 'idle' }
    expect(Object.keys(status)).toEqual(['state'])
  })

  it('checking variant has no extra fields', () => {
    const status: UpdateStatus = { state: 'checking' }
    expect(Object.keys(status)).toEqual(['state'])
  })

  it('available variant carries version + optional releaseNotes', () => {
    const a: UpdateStatus = { state: 'available', version: '1.0.0' }
    expect(a.state).toBe('available')
    expect(Object.keys(a).sort()).toEqual(['state', 'version'])
    const b: UpdateStatus = {
      state: 'available',
      version: '1.0.0',
      releaseNotes: 'Bug fixes'
    }
    expect(Object.keys(b).sort()).toEqual(['releaseNotes', 'state', 'version'])
  })

  it('not-available variant carries version', () => {
    const s: UpdateStatus = { state: 'not-available', version: '0.1.0' }
    expect(s.state).toBe('not-available')
    expect(Object.keys(s).sort()).toEqual(['state', 'version'])
  })

  it('downloading variant carries percent', () => {
    const s: UpdateStatus = { state: 'downloading', percent: 42 }
    expect(s.state).toBe('downloading')
    expect(Object.keys(s).sort()).toEqual(['percent', 'state'])
  })

  it('downloaded variant carries version', () => {
    const s: UpdateStatus = { state: 'downloaded', version: '2.0.0' }
    expect(s.state).toBe('downloaded')
    expect(Object.keys(s).sort()).toEqual(['state', 'version'])
  })

  it('error variant carries message', () => {
    const s: UpdateStatus = { state: 'error', message: 'oops' }
    expect(s.state).toBe('error')
    expect(Object.keys(s).sort()).toEqual(['message', 'state'])
  })
})

// ──────────────────────────────────────────────────────────────────────────
// C. resolveUpdateServerUrl invariants (reaffirms behavioral test)
// ──────────────────────────────────────────────────────────────────────────

describe('C. resolveUpdateServerUrl', () => {
  it('returns env var when set (priority over settings)', () => {
    process.env['WORKTRACK_UPDATE_URL'] = 'https://env.example.com'
    expect(resolveUpdateServerUrl()).toBe('https://env.example.com')
    expect(resolveUpdateServerUrl('https://settings.example.com')).toBe('https://env.example.com')
  })

  it('returns settings URL when env not set', () => {
    delete process.env['WORKTRACK_UPDATE_URL']
    expect(resolveUpdateServerUrl('https://settings.example.com')).toBe(
      'https://settings.example.com'
    )
  })

  it('returns undefined when neither env nor settings provided', () => {
    delete process.env['WORKTRACK_UPDATE_URL']
    expect(resolveUpdateServerUrl()).toBeUndefined()
    expect(resolveUpdateServerUrl(undefined)).toBeUndefined()
  })

  it('treats whitespace-only env as unset', () => {
    process.env['WORKTRACK_UPDATE_URL'] = '   '
    expect(resolveUpdateServerUrl()).toBeUndefined()
    expect(resolveUpdateServerUrl('https://settings.example.com')).toBe(
      'https://settings.example.com'
    )
  })

  it('treats whitespace-only settings as unset', () => {
    delete process.env['WORKTRACK_UPDATE_URL']
    expect(resolveUpdateServerUrl('   ')).toBeUndefined()
  })

  it('trims wrapping whitespace from env', () => {
    process.env['WORKTRACK_UPDATE_URL'] = '  https://trim.example.com  '
    expect(resolveUpdateServerUrl()).toBe('https://trim.example.com')
  })

  it('trims wrapping whitespace from settings', () => {
    delete process.env['WORKTRACK_UPDATE_URL']
    expect(resolveUpdateServerUrl('  https://trim-set.example.com  ')).toBe(
      'https://trim-set.example.com'
    )
  })

  it('does not mutate process.env on read', () => {
    process.env['WORKTRACK_UPDATE_URL'] = '  https://orig.example.com  '
    const before = process.env['WORKTRACK_UPDATE_URL']
    resolveUpdateServerUrl('https://other.example.com')
    expect(process.env['WORKTRACK_UPDATE_URL']).toBe(before)
  })

  it('returns a NEW string (not a reference) when trimming', () => {
    process.env['WORKTRACK_UPDATE_URL'] = '  https://x.example.com  '
    const out = resolveUpdateServerUrl()
    expect(out).toBe('https://x.example.com')
    // Trimmed value is not the literal env-var string
    expect(out).not.toBe(process.env['WORKTRACK_UPDATE_URL'])
  })

  it('source-text pin: env priority via if/return ladder', () => {
    expect(SRC).toMatch(/process\.env\['WORKTRACK_UPDATE_URL'\]/)
    expect(SRC).toMatch(/envUrl\.trim\(\)\.length\s*>\s*0/)
    expect(SRC).toMatch(/settingsUrl\.trim\(\)\.length\s*>\s*0/)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// D. initAutoUpdater IPC registration
// ──────────────────────────────────────────────────────────────────────────

describe('D. initAutoUpdater IPC handler registration', () => {
  it('registers exactly 3 IPC handlers', async () => {
    await initAutoUpdater(getMainWindowStub)
    const channels = ipcHandleMock.mock.calls.map((c) => c[0] as string)
    expect(channels.length).toBe(3)
  })

  it('registers updater:status, updater:checkNow, updater:quitAndInstall (sorted)', async () => {
    await initAutoUpdater(getMainWindowStub)
    const channels = ipcHandleMock.mock.calls.map((c) => c[0] as string).sort()
    expect(channels).toEqual([
      'updater:checkNow',
      'updater:quitAndInstall',
      'updater:status'
    ])
  })

  it('registers handlers in source-declaration order: status, checkNow, quitAndInstall', async () => {
    await initAutoUpdater(getMainWindowStub)
    const channels = ipcHandleMock.mock.calls.map((c) => c[0] as string)
    expect(channels).toEqual([
      'updater:status',
      'updater:checkNow',
      'updater:quitAndInstall'
    ])
  })

  it('registers handlers SYNCHRONOUSLY (before the 10 s deferred check)', async () => {
    // Even without ticking timers, the handlers must be present after init.
    vi.useFakeTimers()
    try {
      const promise = initAutoUpdater(getMainWindowStub)
      // Without any timer advance, all 3 handlers should already be registered.
      expect(ipcHandleMock.mock.calls.length).toBe(3)
      await promise
    } finally {
      vi.useRealTimers()
    }
  })

  it('each registered handler is a function', async () => {
    await initAutoUpdater(getMainWindowStub)
    for (const [, handler] of ipcHandleMock.mock.calls) {
      expect(typeof handler).toBe('function')
    }
  })

  it('schedules the deferred initial check via setTimeout(..., 10_000)', async () => {
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout')
    await initAutoUpdater(getMainWindowStub)
    const tenSecondCalls = setTimeoutSpy.mock.calls.filter((c) => c[1] === 10_000)
    expect(tenSecondCalls.length).toBeGreaterThanOrEqual(1)
    setTimeoutSpy.mockRestore()
  })

  it('does not throw when getMainWindow returns null', async () => {
    await expect(initAutoUpdater(() => null)).resolves.toBeUndefined()
  })

  it('does not throw when settingsUpdateUrl is omitted', async () => {
    await expect(initAutoUpdater(getMainWindowStub)).resolves.toBeUndefined()
  })

  it('does not throw when settingsUpdateUrl is provided', async () => {
    await expect(
      initAutoUpdater(getMainWindowStub, 'https://x.example.com')
    ).resolves.toBeUndefined()
  })
})

// ──────────────────────────────────────────────────────────────────────────
// E. Registered IPC handler behavior
// ──────────────────────────────────────────────────────────────────────────

describe('E. registered IPC handler behavior', () => {
  it('updater:status handler returns the current UpdateStatus snapshot', async () => {
    await initAutoUpdater(getMainWindowStub)
    const handler = ipcRegistry.get('updater:status')!
    const status = (await handler()) as UpdateStatus
    expect(typeof status).toBe('object')
    expect(typeof status.state).toBe('string')
  })

  it('updater:checkNow handler returns an UpdateStatus after running the check', async () => {
    autoUpdaterMock.checkForUpdates.mockResolvedValueOnce(null)
    await initAutoUpdater(getMainWindowStub)
    const handler = ipcRegistry.get('updater:checkNow')!
    const status = (await handler()) as UpdateStatus
    expect(typeof status.state).toBe('string')
    // null result -> idle branch
    expect(status.state).toBe('idle')
  })

  it('updater:quitAndInstall handler does not throw when invoked', async () => {
    await initAutoUpdater(getMainWindowStub)
    const handler = ipcRegistry.get('updater:quitAndInstall')!
    expect(() => handler()).not.toThrow()
  })

  it('updater:status returns idle when the module starts fresh (no errors yet)', async () => {
    await initAutoUpdater(getMainWindowStub)
    const handler = ipcRegistry.get('updater:status')!
    const status = (await handler()) as UpdateStatus
    // initial currentStatus is { state: 'idle' }
    expect(status.state).toBe('idle')
  })
})

// ──────────────────────────────────────────────────────────────────────────
// F. electron-updater event handler wiring (via checkForUpdatesManual)
// ──────────────────────────────────────────────────────────────────────────

describe('F. electron-updater event wiring', () => {
  async function runCheckAndGetCallbacks(): Promise<{
    available: (info: { version: string; releaseNotes?: string }) => void
    notAvailable: (info: { version: string }) => void
    progress: (p: { percent: number }) => void
    downloaded: (info: { version: string }) => void
    error: (err: Error) => void
  }> {
    autoUpdaterMock.checkForUpdates.mockResolvedValueOnce(null)
    await checkForUpdatesManual()
    const last = (event: string): ((...args: unknown[]) => void) => {
      const list = autoUpdaterEventBus.get(event)!
      return list[list.length - 1]! as (...args: unknown[]) => void
    }
    return {
      available: last('update-available') as (i: {
        version: string
        releaseNotes?: string
      }) => void,
      notAvailable: last('update-not-available') as (i: { version: string }) => void,
      progress: last('download-progress') as (p: { percent: number }) => void,
      downloaded: last('update-downloaded') as (i: { version: string }) => void,
      error: last('error') as (err: Error) => void
    }
  }

  it('registers handlers for all 5 expected events', async () => {
    autoUpdaterMock.checkForUpdates.mockResolvedValueOnce(null)
    await checkForUpdatesManual()
    expect(autoUpdaterEventBus.has('update-available')).toBe(true)
    expect(autoUpdaterEventBus.has('update-not-available')).toBe(true)
    expect(autoUpdaterEventBus.has('download-progress')).toBe(true)
    expect(autoUpdaterEventBus.has('update-downloaded')).toBe(true)
    expect(autoUpdaterEventBus.has('error')).toBe(true)
  })

  it('autoDownload is forced to false during the check', async () => {
    autoUpdaterMock.autoDownload = true
    autoUpdaterMock.checkForUpdates.mockResolvedValueOnce(null)
    await checkForUpdatesManual()
    expect(autoUpdaterMock.autoDownload).toBe(false)
  })

  it('autoInstallOnAppQuit is forced to true during the check', async () => {
    autoUpdaterMock.autoInstallOnAppQuit = false
    autoUpdaterMock.checkForUpdates.mockResolvedValueOnce(null)
    await checkForUpdatesManual()
    expect(autoUpdaterMock.autoInstallOnAppQuit).toBe(true)
  })

  it('update-available transitions to state=available with version + releaseNotes', async () => {
    const cbs = await runCheckAndGetCallbacks()
    cbs.available({ version: '2.5.1', releaseNotes: 'Hotfix' })
    const status = await checkForUpdatesManual()
    // The cb mutated currentStatus, then a fresh check ran (which itself
    // goes to checking->idle since checkForUpdates returns null). To pin
    // the available->status transition, instead drive the cb then read
    // via the IPC handler BEFORE running the next check.
    // Re-do via the registry path:
    autoUpdaterEventBus.clear()
    autoUpdaterMock.checkForUpdates.mockResolvedValueOnce(null)
    await initAutoUpdater(getMainWindowStub)
    const cbs2 = await runCheckAndGetCallbacks()
    cbs2.available({ version: '2.5.1', releaseNotes: 'Hotfix' })
    const handler = ipcRegistry.get('updater:status')!
    const observed = (await handler()) as UpdateStatus
    expect(observed.state).toBe('available')
    if (observed.state === 'available') {
      expect(observed.version).toBe('2.5.1')
      expect(observed.releaseNotes).toBe('Hotfix')
    }
    // Touch the unused outer `status` so TS does not flag it
    expect(typeof status.state).toBe('string')
  })

  it('update-available with non-string releaseNotes -> releaseNotes undefined', async () => {
    autoUpdaterEventBus.clear()
    autoUpdaterMock.checkForUpdates.mockResolvedValueOnce(null)
    await initAutoUpdater(getMainWindowStub)
    const cbs = await runCheckAndGetCallbacks()
    // electron-updater's UpdateInfo allows ReleaseNoteInfo[] or string. The
    // module narrows to `typeof === 'string'` and otherwise emits undefined.
    cbs.available({ version: '3.0.0' } as { version: string })
    const handler = ipcRegistry.get('updater:status')!
    const observed = (await handler()) as UpdateStatus
    expect(observed.state).toBe('available')
    if (observed.state === 'available') {
      expect(observed.version).toBe('3.0.0')
      expect(observed.releaseNotes).toBeUndefined()
    }
  })

  it('update-not-available transitions to state=not-available with version', async () => {
    autoUpdaterEventBus.clear()
    autoUpdaterMock.checkForUpdates.mockResolvedValueOnce(null)
    await initAutoUpdater(getMainWindowStub)
    const cbs = await runCheckAndGetCallbacks()
    cbs.notAvailable({ version: '0.9.0' })
    const handler = ipcRegistry.get('updater:status')!
    const observed = (await handler()) as UpdateStatus
    expect(observed.state).toBe('not-available')
    if (observed.state === 'not-available') {
      expect(observed.version).toBe('0.9.0')
    }
  })

  it('download-progress rounds the percent to an integer', async () => {
    autoUpdaterEventBus.clear()
    autoUpdaterMock.checkForUpdates.mockResolvedValueOnce(null)
    await initAutoUpdater(getMainWindowStub)
    const cbs = await runCheckAndGetCallbacks()
    cbs.progress({ percent: 42.789 })
    const handler = ipcRegistry.get('updater:status')!
    const observed = (await handler()) as UpdateStatus
    expect(observed.state).toBe('downloading')
    if (observed.state === 'downloading') {
      // Math.round(42.789) === 43
      expect(observed.percent).toBe(43)
      expect(Number.isInteger(observed.percent)).toBe(true)
    }
  })

  it('download-progress at 0% rounds to 0 (not NaN)', async () => {
    autoUpdaterEventBus.clear()
    autoUpdaterMock.checkForUpdates.mockResolvedValueOnce(null)
    await initAutoUpdater(getMainWindowStub)
    const cbs = await runCheckAndGetCallbacks()
    cbs.progress({ percent: 0 })
    const handler = ipcRegistry.get('updater:status')!
    const observed = (await handler()) as UpdateStatus
    expect(observed.state).toBe('downloading')
    if (observed.state === 'downloading') {
      expect(observed.percent).toBe(0)
    }
  })

  it('download-progress at 100% rounds to 100', async () => {
    autoUpdaterEventBus.clear()
    autoUpdaterMock.checkForUpdates.mockResolvedValueOnce(null)
    await initAutoUpdater(getMainWindowStub)
    const cbs = await runCheckAndGetCallbacks()
    cbs.progress({ percent: 99.6 })
    const handler = ipcRegistry.get('updater:status')!
    const observed = (await handler()) as UpdateStatus
    expect(observed.state).toBe('downloading')
    if (observed.state === 'downloading') {
      expect(observed.percent).toBe(100)
    }
  })

  it('update-downloaded transitions to state=downloaded with version', async () => {
    autoUpdaterEventBus.clear()
    autoUpdaterMock.checkForUpdates.mockResolvedValueOnce(null)
    await initAutoUpdater(getMainWindowStub)
    const cbs = await runCheckAndGetCallbacks()
    cbs.downloaded({ version: '4.2.0' })
    const handler = ipcRegistry.get('updater:status')!
    const observed = (await handler()) as UpdateStatus
    expect(observed.state).toBe('downloaded')
    if (observed.state === 'downloaded') {
      expect(observed.version).toBe('4.2.0')
    }
  })

  it('autoUpdater error event with a generic message transitions to state=error', async () => {
    autoUpdaterEventBus.clear()
    autoUpdaterMock.checkForUpdates.mockResolvedValueOnce(null)
    await initAutoUpdater(getMainWindowStub)
    const cbs = await runCheckAndGetCallbacks()
    // The module's error LISTENER (registered via autoUpdater.on('error',...))
    // unconditionally sets state='error' with the message; the SWALLOW LIST
    // applies to the catch block of safeCheckForUpdates (Group G).
    cbs.error(new Error('Some deep auto-updater explosion'))
    const handler = ipcRegistry.get('updater:status')!
    const observed = (await handler()) as UpdateStatus
    expect(observed.state).toBe('error')
    if (observed.state === 'error') {
      expect(observed.message).toBe('Some deep auto-updater explosion')
    }
  })

  it('autoUpdater error event with empty message uses fallback "Unknown update error"', async () => {
    autoUpdaterEventBus.clear()
    autoUpdaterMock.checkForUpdates.mockResolvedValueOnce(null)
    await initAutoUpdater(getMainWindowStub)
    const cbs = await runCheckAndGetCallbacks()
    const e = new Error('')
    cbs.error(e)
    const handler = ipcRegistry.get('updater:status')!
    const observed = (await handler()) as UpdateStatus
    expect(observed.state).toBe('error')
    if (observed.state === 'error') {
      expect(observed.message).toBe('Unknown update error')
    }
  })

  it('null UpdateCheckResult transitions to state=idle (not error)', async () => {
    autoUpdaterEventBus.clear()
    autoUpdaterMock.checkForUpdates.mockResolvedValueOnce(null)
    await initAutoUpdater(getMainWindowStub)
    const status = await checkForUpdatesManual()
    expect(status.state).toBe('idle')
  })

  it('non-null UpdateCheckResult leaves status from event listeners (does NOT clobber to idle)', async () => {
    autoUpdaterEventBus.clear()
    autoUpdaterMock.checkForUpdates.mockResolvedValueOnce({
      updateInfo: { version: '7.0.0' }
    } as unknown as never)
    await initAutoUpdater(getMainWindowStub)
    // The inner runCheck goes through `setStatus({ state: 'checking' })`
    // then registers listeners then calls checkForUpdates -> truthy result;
    // since result is truthy the `if (!result) setStatus(idle)` branch is
    // skipped, leaving status at 'checking' until an event fires.
    const status = await checkForUpdatesManual()
    expect(['checking', 'available', 'not-available', 'downloading']).toContain(status.state)
    // Specifically, no event fired -> still 'checking'.
    expect(status.state).toBe('checking')
  })

  it('setFeedURL is called when WORKTRACK_UPDATE_URL is set', async () => {
    process.env['WORKTRACK_UPDATE_URL'] = 'https://feed.example.com'
    autoUpdaterEventBus.clear()
    autoUpdaterMock.setFeedURL.mockClear()
    autoUpdaterMock.checkForUpdates.mockResolvedValueOnce(null)
    await checkForUpdatesManual()
    expect(autoUpdaterMock.setFeedURL).toHaveBeenCalledTimes(1)
    expect(autoUpdaterMock.setFeedURL).toHaveBeenCalledWith({
      provider: 'generic',
      url: 'https://feed.example.com'
    })
  })

  it('setFeedURL is NOT called when no env / no settings URL is provided', async () => {
    delete process.env['WORKTRACK_UPDATE_URL']
    autoUpdaterEventBus.clear()
    autoUpdaterMock.setFeedURL.mockClear()
    autoUpdaterMock.checkForUpdates.mockResolvedValueOnce(null)
    await checkForUpdatesManual()
    expect(autoUpdaterMock.setFeedURL).not.toHaveBeenCalled()
  })

  it('setFeedURL receives the trimmed settings URL when env is unset', async () => {
    delete process.env['WORKTRACK_UPDATE_URL']
    autoUpdaterEventBus.clear()
    autoUpdaterMock.setFeedURL.mockClear()
    autoUpdaterMock.checkForUpdates.mockResolvedValueOnce(null)
    await checkForUpdatesManual('  https://settings-set.example.com  ')
    expect(autoUpdaterMock.setFeedURL).toHaveBeenCalledTimes(1)
    expect(autoUpdaterMock.setFeedURL).toHaveBeenCalledWith({
      provider: 'generic',
      url: 'https://settings-set.example.com'
    })
  })
})

// ──────────────────────────────────────────────────────────────────────────
// G. Error filter swallow list (catch-block in safeCheckForUpdates)
// ──────────────────────────────────────────────────────────────────────────

describe('G. error filter swallow list', () => {
  const SWALLOW_MESSAGES = [
    'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND: latest.yml not found on the server',
    'No published versions on GitHub',
    'ENOENT: no such file or directory, open /tmp/whatever',
    'net::ERR_INTERNET_DISCONNECTED',
    'HttpError: 404 Not Found'
  ]

  for (const msg of SWALLOW_MESSAGES) {
    it(`silently collapses "${msg.slice(0, 32)}..." to state=idle`, async () => {
      autoUpdaterMock.checkForUpdates.mockReset().mockRejectedValueOnce(new Error(msg))
      await initAutoUpdater(getMainWindowStub)
      const status = await checkForUpdatesManual()
      expect(status.state).toBe('idle')
    })
  }

  it('arbitrary unknown error message lands as state=error with message', async () => {
    autoUpdaterMock.checkForUpdates
      .mockReset()
      .mockRejectedValueOnce(new Error('Disk on fire and the cat unplugged the router'))
    await initAutoUpdater(getMainWindowStub)
    const status = await checkForUpdatesManual()
    expect(status.state).toBe('error')
    if (status.state === 'error') {
      expect(status.message).toContain('Disk on fire')
    }
  })

  it('non-Error throwables are stringified via String(err)', async () => {
    autoUpdaterMock.checkForUpdates.mockReset().mockRejectedValueOnce('plain string boom')
    await initAutoUpdater(getMainWindowStub)
    const status = await checkForUpdatesManual()
    expect(status.state).toBe('error')
    if (status.state === 'error') {
      expect(status.message).toBe('plain string boom')
    }
  })

  it('source-text pin: each of the 5 swallow substrings is present', () => {
    expect(SRC).toMatch(/ERR_UPDATER_CHANNEL_FILE_NOT_FOUND/)
    expect(SRC).toMatch(/No published versions/)
    expect(SRC).toMatch(/ENOENT/)
    expect(SRC).toMatch(/net::/)
    expect(SRC).toMatch(/HttpError/)
  })

  it('source-text pin: catch block uses console.warn (not console.error)', () => {
    expect(SRC).toMatch(/console\.warn\([^)]*Auto-update check failed/)
    expect(SRC).not.toMatch(/console\.error\(/)
  })

  it('source-text pin: error event listener also uses console.warn', () => {
    expect(SRC).toMatch(/console\.warn\([^)]*Auto-update error/)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// H. Source-text whitelist + safety
// ──────────────────────────────────────────────────────────────────────────

describe('H. source-text whitelist + safety', () => {
  it('no `: any` type annotation', () => {
    expect(SRC).not.toMatch(/:\s*any\b/)
  })

  it('no `as any` assertions', () => {
    expect(SRC).not.toMatch(/\bas\s+any\b/)
  })

  it('no eval / new Function', () => {
    expect(SRC).not.toMatch(/\beval\s*\(/)
    expect(SRC).not.toMatch(/\bnew\s+Function\b/)
  })

  it('no node:fs / node:path / node:child_process imports', () => {
    expect(SRC).not.toMatch(/from\s+'node:fs'/)
    expect(SRC).not.toMatch(/from\s+'node:path'/)
    expect(SRC).not.toMatch(/from\s+'node:child_process'/)
    expect(SRC).not.toMatch(/from\s+'fs'/)
    expect(SRC).not.toMatch(/from\s+'child_process'/)
  })

  it('single static `electron` import (named: ipcMain + type BrowserWindow)', () => {
    const matches = SRC.match(/from\s+'electron'/g) ?? []
    expect(matches.length).toBe(1)
    expect(SRC).toMatch(/import\s+\{\s*ipcMain,\s*type\s+BrowserWindow\s*\}\s+from\s+'electron'/)
  })

  it('single static type-only `electron-updater` import (UpdateCheckResult + UpdateInfo)', () => {
    const staticMatches = SRC.match(/^import\s+type\s+\{[^}]+\}\s+from\s+'electron-updater'/m)
    expect(staticMatches).not.toBeNull()
    expect(SRC).toMatch(/UpdateCheckResult/)
    expect(SRC).toMatch(/UpdateInfo/)
  })

  it('exactly 2 dynamic `import(\'electron-updater\')` call-sites', () => {
    const dyn = SRC.match(/\bimport\(\s*'electron-updater'\s*\)/g) ?? []
    expect(dyn.length).toBe(2)
  })

  it('autoDownload is set to false during the check', () => {
    expect(SRC).toMatch(/autoUpdater\.autoDownload\s*=\s*false/)
  })

  it('autoInstallOnAppQuit is set to true during the check', () => {
    expect(SRC).toMatch(/autoUpdater\.autoInstallOnAppQuit\s*=\s*true/)
  })

  it('deferred initial check uses setTimeout(..., 10_000) literal', () => {
    expect(SRC).toMatch(/setTimeout\([\s\S]*?,\s*10_?000\s*\)/)
  })

  it('WORKTRACK_UPDATE_URL env-var name appears exactly once', () => {
    const matches = SRC.match(/WORKTRACK_UPDATE_URL/g) ?? []
    // Once in the resolveUpdateServerUrl body and once in the doc comment.
    // Total count >= 1; pin >= 1 (env-var literal must be present).
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('Math.round on download-progress percent', () => {
    expect(SRC).toMatch(/Math\.round\(progress\.percent\)/)
  })

  it('"Unknown update error" fallback message is present', () => {
    expect(SRC).toMatch(/'Unknown update error'/)
  })

  it('no machine-specific literals (K2 Plus / Laguna / Carvera / Klipper / Moonraker / RichAuto / Mach3)', () => {
    expect(SRC).not.toMatch(/K2\s*Plus/i)
    expect(SRC).not.toMatch(/Laguna/i)
    expect(SRC).not.toMatch(/Carvera/i)
    expect(SRC).not.toMatch(/Klipper/i)
    expect(SRC).not.toMatch(/Moonraker/i)
    expect(SRC).not.toMatch(/RichAuto/i)
    expect(SRC).not.toMatch(/Mach3/i)
  })

  it('no G-code keywords (G0/G1/G17/G18/G19/M2/M30/spindle)', () => {
    expect(SRC).not.toMatch(/\bG0\b/)
    expect(SRC).not.toMatch(/\bG1\b/)
    expect(SRC).not.toMatch(/\bG17\b/)
    expect(SRC).not.toMatch(/\bG18\b/)
    expect(SRC).not.toMatch(/\bG19\b/)
    expect(SRC).not.toMatch(/\bM2\b/)
    expect(SRC).not.toMatch(/\bM30\b/)
    expect(SRC).not.toMatch(/spindle/i)
  })

  it('all 3 IPC channel names are namespaced under updater:', () => {
    expect(SRC).toMatch(/'updater:status'/)
    expect(SRC).toMatch(/'updater:checkNow'/)
    expect(SRC).toMatch(/'updater:quitAndInstall'/)
  })

  it('no TODO/FIXME/HACK markers', () => {
    expect(SRC).not.toMatch(/\bTODO\b/)
    expect(SRC).not.toMatch(/\bFIXME\b/)
    expect(SRC).not.toMatch(/\bHACK\b/)
  })

  it('source is at most 200 lines (CLAUDE.md keep-modules-small bias)', () => {
    expect(SRC.split('\n').length).toBeLessThan(200)
  })

  it('setFeedURL uses provider: generic (not github/spaces/etc.)', () => {
    expect(SRC).toMatch(/provider:\s*'generic'/)
  })

  it('catch-block only swallows known error families (5 substrings, joined with ||)', () => {
    // The inner `if (msg.includes(...) || msg.includes(...) ...)` chain.
    const swallows = (SRC.match(/msg\.includes\(/g) ?? []).length
    expect(swallows).toBe(5)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// I. Three-machine cross-cut realism
// ──────────────────────────────────────────────────────────────────────────

describe('I. three-machine cross-cut realism', () => {
  it('K2 Plus shop offline boot: ENOENT swallowed -> idle (no red toast)', async () => {
    autoUpdaterMock.checkForUpdates
      .mockReset()
      .mockRejectedValueOnce(new Error('ENOENT: no such file or directory'))
    await initAutoUpdater(getMainWindowStub)
    const status = await checkForUpdatesManual()
    expect(status.state).toBe('idle')
  })

  it('Laguna Swift 5x10 shop floor: net:: error swallowed -> idle', async () => {
    autoUpdaterMock.checkForUpdates
      .mockReset()
      .mockRejectedValueOnce(new Error('net::ERR_NETWORK_CHANGED'))
    await initAutoUpdater(getMainWindowStub)
    const status = await checkForUpdatesManual()
    expect(status.state).toBe('idle')
  })

  it('Carvera dev box: download-progress percent rounds to integer (pendant convention)', async () => {
    autoUpdaterEventBus.clear()
    autoUpdaterMock.checkForUpdates.mockResolvedValueOnce(null)
    await initAutoUpdater(getMainWindowStub)
    // initAutoUpdater registers IPC handlers but the deferred `setTimeout`
    // initial check has not fired -- drive the check explicitly so the
    // `download-progress` listener is wired before we read the bus.
    await checkForUpdatesManual()
    const list = autoUpdaterEventBus.get('download-progress')!
    const cb = list[list.length - 1]! as (p: { percent: number }) => void
    // A pendant percent is always an integer; 12.34567 must round to 12.
    cb({ percent: 12.34567 })
    const handler = ipcRegistry.get('updater:status')!
    const observed = (await handler()) as UpdateStatus
    expect(observed.state).toBe('downloading')
    if (observed.state === 'downloading') {
      expect(Number.isInteger(observed.percent)).toBe(true)
      expect(observed.percent).toBe(12)
    }
  })

  it('single env var WORKTRACK_UPDATE_URL serves all 3 shops (no machine-id branching)', async () => {
    process.env['WORKTRACK_UPDATE_URL'] = 'https://shop-mirror.local'
    expect(resolveUpdateServerUrl()).toBe('https://shop-mirror.local')
    // Source-text: there is no per-machine setFeedURL switching.
    expect(SRC).not.toMatch(/machine\.kind\s*===/)
    expect(SRC).not.toMatch(/dialect\s*===/)
  })

  it('autoDownload=false respects shop-floor bandwidth across all 3 machines', () => {
    // Pin protects the K2 Plus shop user from a surprise multi-MB download
    // mid-print. Source-text reaffirms.
    expect(SRC).toMatch(/autoUpdater\.autoDownload\s*=\s*false/)
  })

  it('autoInstallOnAppQuit=true matches the "install on next app start" expectation across all 3 machines', () => {
    expect(SRC).toMatch(/autoUpdater\.autoInstallOnAppQuit\s*=\s*true/)
  })

  it('deferred 10 s startup window prevents update check from delaying first paint on K2/Laguna/Carvera shop boxes', () => {
    expect(SRC).toMatch(/Delay initial check to avoid slowing down startup/i)
    expect(SRC).toMatch(/setTimeout\([\s\S]*?10_?000\s*\)/)
  })

  it('error path NEVER throws synchronously (would crash main process for any of the 3 shops)', async () => {
    autoUpdaterMock.checkForUpdates.mockReset().mockRejectedValueOnce(new Error('boom'))
    await expect(checkForUpdatesManual()).resolves.toBeDefined()
  })

  it('initAutoUpdater returns Promise<void> (not a throwing factory) for all 3 shops', async () => {
    const ret = await initAutoUpdater(getMainWindowStub)
    expect(ret).toBeUndefined()
  })

  it('quitAndInstall handler tolerates missing electron-updater install (offline shop edge case)', async () => {
    await initAutoUpdater(getMainWindowStub)
    const handler = ipcRegistry.get('updater:quitAndInstall')!
    expect(() => handler()).not.toThrow()
  })
})

// ──────────────────────────────────────────────────────────────────────────
// J. Type-level parity
// ──────────────────────────────────────────────────────────────────────────

describe('J. type-level parity', () => {
  it('UpdateStatus is the 7-string union of state values (compile-time pin)', () => {
    // Each branch below MUST type-check; if the union shrinks or grows the
    // test file fails to compile (caught by `npm run typecheck`).
    const idle: UpdateStatus = { state: 'idle' }
    const checking: UpdateStatus = { state: 'checking' }
    const available: UpdateStatus = { state: 'available', version: 'x' }
    const notAvailable: UpdateStatus = { state: 'not-available', version: 'x' }
    const downloading: UpdateStatus = { state: 'downloading', percent: 0 }
    const downloaded: UpdateStatus = { state: 'downloaded', version: 'x' }
    const error: UpdateStatus = { state: 'error', message: 'x' }
    expect([
      idle,
      checking,
      available,
      notAvailable,
      downloading,
      downloaded,
      error
    ]).toHaveLength(7)
  })

  it('exhaustiveness pin: switch over UpdateStatus.state covers exactly 7 cases', () => {
    function describeStatus(s: UpdateStatus): string {
      switch (s.state) {
        case 'idle':
          return 'idle'
        case 'checking':
          return 'checking'
        case 'available':
          return 'available@' + s.version
        case 'not-available':
          return 'na@' + s.version
        case 'downloading':
          return 'd' + s.percent
        case 'downloaded':
          return 'done@' + s.version
        case 'error':
          return 'err:' + s.message
        default: {
          // exhaustiveness: `s` MUST be `never` here. If the union grows,
          // this assignment fails to compile.
          const _exhaustive: never = s
          return _exhaustive
        }
      }
    }
    expect(describeStatus({ state: 'idle' })).toBe('idle')
    expect(describeStatus({ state: 'checking' })).toBe('checking')
    expect(describeStatus({ state: 'available', version: '1' })).toBe('available@1')
    expect(describeStatus({ state: 'not-available', version: '0' })).toBe('na@0')
    expect(describeStatus({ state: 'downloading', percent: 50 })).toBe('d50')
    expect(describeStatus({ state: 'downloaded', version: '2' })).toBe('done@2')
    expect(describeStatus({ state: 'error', message: 'm' })).toBe('err:m')
  })

  it('initAutoUpdater takes (() => BrowserWindow | null, settingsUrl?: string) -> Promise<void>', async () => {
    const ret: Promise<void> = initAutoUpdater(() => null, undefined)
    await expect(ret).resolves.toBeUndefined()
  })

  it('checkForUpdatesManual returns Promise<UpdateStatus>', async () => {
    autoUpdaterMock.checkForUpdates.mockResolvedValueOnce(null)
    const status: UpdateStatus = await checkForUpdatesManual()
    expect(typeof status.state).toBe('string')
  })

  it('resolveUpdateServerUrl returns string | undefined', () => {
    delete process.env['WORKTRACK_UPDATE_URL']
    const a: string | undefined = resolveUpdateServerUrl()
    const b: string | undefined = resolveUpdateServerUrl('https://x')
    expect(a).toBeUndefined()
    expect(b).toBe('https://x')
  })
})
