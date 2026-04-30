/**
 * carvera-cli-run-pin.test.ts -- [ID-0256] Cycle 195 post-processing paired-pin
 *
 * Pins the contract of `src/main/carvera-cli-run.ts` -- the community-`carvera-cli`
 * (https://github.com/hagmonk/carvera-cli) USB/WiFi push helper consumed by the
 * Makera Carvera 3-axis + 4-axis upload path.
 *
 * Sister cycles: Cycle 132 [ID-0209] `post-process-dialects-pin.test.ts`,
 * Cycle 189 [ID-0254] `fdm-temp-preview-pin.test.ts`. The existing behavioural
 * `carvera-cli-run.test.ts` (103 lines, 5 it()) only spot-checks happy paths
 * for 4 of the 5 connection modes and one prefer-remote-path case; THIS pin
 * extends coverage to lock the precise argv-build contract every Carvera
 * upload click depends on.
 *
 * Three-machine impact -- DIRECT for Carvera, NEGATIVE for K2 Plus / Laguna:
 *
 *   - **Makera Carvera 3-axis + 4-axis Rotary** (community-firmware Smoothieware
 *     superset): EVERY G-code/NC upload from the Manufacture tab lands on the
 *     SD card via this argv-builder. A regression in arg ordering (e.g. moving
 *     `--timeout` AFTER `upload`), in flag spelling (`--remote-path` vs
 *     `--remotePath`), in the `--overwrite` placement, OR in the
 *     timeout-seconds rounding (Math.ceil 1500 ms -> 2 s, Math.ceil 999 ms ->
 *     1 s -- the documented seconds-grain resolution carvera-cli accepts)
 *     would silently fail mid-upload OR clobber unrelated files on the SD
 *     card. The 4-axis rotary path inherits the SAME argv-builder; the rotary
 *     post emits `cam.nc` exactly like the 3-axis post -- the upload mechanism
 *     is shared.
 *   - **Creality K2 Plus** (FDM, Klipper/Moonraker): NEVER uses this path.
 *     K2 G-code uploads route through the Moonraker direct-push API per the
 *     CLAUDE.md "Required capabilities" line. Pin asserts the .ts source
 *     contains zero references to `moonraker` / `klipper` / `fluidd` so a
 *     future refactor that conflated the two upload paths fires the source
 *     whitelist immediately.
 *   - **Laguna Swift 5x10** (RichAuto A-series): NEVER uses this path. Laguna
 *     uploads route through USB stick / RichAuto pendant manual transfer per
 *     the user's documented workflow -- there is no in-app upload helper for
 *     Laguna. Pin asserts the .ts source contains zero references to
 *     `richauto` / `mach3` / `laguna` so a future refactor that re-purposed
 *     this helper for Laguna fires the source whitelist immediately.
 *
 * Pin coverage groups (A-J):
 *   (A) module shape -- exported runtime names + type alias presence + class-
 *       free + Symbol.toStringTag,
 *   (B) function signatures -- `buildCarveraUploadArgs` arity 2 native
 *       Function returning {command,args}; `carveraUpload` arity 2 async
 *       Promise; both throw-free for invalid input,
 *   (C) command resolution -- default `carvera-cli` literal; user override
 *       wins; whitespace-only override falls back to default; trim() applied,
 *   (D) extra-args parsing contract -- valid JSON array of strings ->
 *       prefix; non-array -> []; non-string elements filtered; malformed JSON
 *       -> []; empty/whitespace string -> []; undefined -> [],
 *   (E) connection mode encoding -- `wifi` -> `--wifi`; `usb` -> `--usb`;
 *       `auto` -> NO connection flag (omitted entirely); device flag emitted
 *       only when payload.device set + non-whitespace,
 *   (F) timeout-seconds rounding -- `Math.ceil(ms/1000)` with 1-s floor;
 *       60_000 ms -> "60"; 60_500 ms -> "61"; 999 ms -> "1"; 0 ms -> NO
 *       --timeout flag; negative ms -> NO --timeout flag; missing -> default
 *       120_000 ms -> "120"; explicit 120_000 also -> "120",
 *   (G) positional arg ordering invariant -- `upload <gcodePath>` always
 *       precedes any post-positional flag; remote-path/dir is post-positional;
 *       `--overwrite` is the LAST flag when set,
 *   (H) remote path/directory contract -- `remotePath` wins over
 *       `remoteDirectory`; remoteDirectory becomes second positional after
 *       `<gcodePath>`; whitespace-only treated as absent; both absent ->
 *       neither flag/positional emitted,
 *   (I) three-machine path realism -- Carvera 3-axis cam.nc upload via WiFi
 *       to documented IP; Carvera 4-axis rotary cam.nc upload via USB COM
 *       port; cross-platform path realism (Windows backslash + POSIX slash);
 *       remoteDirectory `/sd/gcodes/` literal preserved verbatim;
 *       overwrite flag survives last-arg position,
 *   (J) source-text whitelist -- file <= 130 lines, <= 4 KB; argv builder
 *       export named verbatim; carveraUpload export named verbatim;
 *       statSync import from node:fs; spawnBounded import from
 *       ./subprocess-bounded; AppSettings type-only import; no electron/path/
 *       child_process direct imports; no foreign machine vendors (moonraker /
 *       klipper / fluidd / richauto / mach3 / laguna); no toolpath G/M-code
 *       literals; no console.log / no throw new Error / no `:any`/`as any`/
 *       `<any>`; default executable string literal `'carvera-cli'`; default
 *       timeout literal `120_000`.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import * as carveraCliRun from './carvera-cli-run'
import { buildCarveraUploadArgs } from './carvera-cli-run'
import type { AppSettings } from '../shared/project-schema'

const SOURCE_PATH = new URL('./carvera-cli-run.ts', import.meta.url)
const SOURCE_TEXT = readFileSync(SOURCE_PATH, 'utf8')

const baseSettings: AppSettings = {
  theme: 'dark',
  recentProjectPaths: []
}

// -----------------------------------------------------------------------------
// (A) module shape
// -----------------------------------------------------------------------------

describe('[ID-0256] (A) module shape', () => {
  it('exports exactly the documented runtime symbols', () => {
    const keys = Object.keys(carveraCliRun).sort()
    // Type-only exports (CarveraConnectionMode, CarveraUploadPayload,
    // CarveraUploadResult) erase at runtime; only runtime exports observable.
    expect(keys).toEqual(['buildCarveraUploadArgs', 'carveraUpload'])
  })

  it('exports buildCarveraUploadArgs as a function', () => {
    expect(typeof carveraCliRun.buildCarveraUploadArgs).toBe('function')
  })

  it('exports carveraUpload as a function', () => {
    expect(typeof carveraCliRun.carveraUpload).toBe('function')
  })

  it('module is a namespace object (not a class instance)', () => {
    expect(carveraCliRun).not.toBeInstanceOf(Function)
    expect(carveraCliRun.constructor === Object).toBe(false) // module wrapper
    expect(typeof carveraCliRun).toBe('object')
  })

  it('module has Module Symbol.toStringTag', () => {
    const tag = (carveraCliRun as unknown as { [Symbol.toStringTag]?: string })[
      Symbol.toStringTag
    ]
    expect(tag).toBe('Module')
  })

  it('source file declares the documented type-only exports', () => {
    expect(SOURCE_TEXT).toMatch(/export type CarveraConnectionMode\b/)
    expect(SOURCE_TEXT).toMatch(/export type CarveraUploadPayload\b/)
    expect(SOURCE_TEXT).toMatch(/export type CarveraUploadResult\b/)
  })
})

// -----------------------------------------------------------------------------
// (B) function signatures
// -----------------------------------------------------------------------------

describe('[ID-0256] (B) function signatures', () => {
  it('buildCarveraUploadArgs has arity 2', () => {
    expect(buildCarveraUploadArgs.length).toBe(2)
  })

  it('buildCarveraUploadArgs.name === "buildCarveraUploadArgs"', () => {
    expect(buildCarveraUploadArgs.name).toBe('buildCarveraUploadArgs')
  })

  it('buildCarveraUploadArgs is a native (non-bound, non-arrow-stripped) Function', () => {
    expect(buildCarveraUploadArgs).toBeInstanceOf(Function)
    // Bound functions report names like "bound buildCarveraUploadArgs"; we
    // assert it's the original.
    expect(buildCarveraUploadArgs.name.startsWith('bound ')).toBe(false)
  })

  it('buildCarveraUploadArgs returns an object with `command` (string) and `args` (string[])', () => {
    const r = buildCarveraUploadArgs(baseSettings, {
      gcodePath: '/x.nc',
      connection: 'auto'
    })
    expect(typeof r.command).toBe('string')
    expect(Array.isArray(r.args)).toBe(true)
    for (const a of r.args) expect(typeof a).toBe('string')
  })

  it('carveraUpload has arity 2', () => {
    expect(carveraCliRun.carveraUpload.length).toBe(2)
  })

  it('carveraUpload.name === "carveraUpload"', () => {
    expect(carveraCliRun.carveraUpload.name).toBe('carveraUpload')
  })

  it('carveraUpload is async (constructor name AsyncFunction)', () => {
    expect(carveraCliRun.carveraUpload.constructor.name).toBe('AsyncFunction')
  })

  it('buildCarveraUploadArgs does not throw for minimal valid input', () => {
    expect(() =>
      buildCarveraUploadArgs(baseSettings, {
        gcodePath: '',
        connection: 'auto'
      })
    ).not.toThrow()
  })
})

// -----------------------------------------------------------------------------
// (C) command resolution
// -----------------------------------------------------------------------------

describe('[ID-0256] (C) command resolution', () => {
  it('defaults command to literal "carvera-cli" when carveraCliPath unset', () => {
    const { command } = buildCarveraUploadArgs(baseSettings, {
      gcodePath: '/x.nc',
      connection: 'auto'
    })
    expect(command).toBe('carvera-cli')
  })

  it('uses user-configured carveraCliPath when set', () => {
    const { command } = buildCarveraUploadArgs(
      { ...baseSettings, carveraCliPath: 'C:\\tools\\carvera-cli.exe' },
      { gcodePath: '/x.nc', connection: 'auto' }
    )
    expect(command).toBe('C:\\tools\\carvera-cli.exe')
  })

  it('falls back to default when carveraCliPath is empty string', () => {
    const { command } = buildCarveraUploadArgs(
      { ...baseSettings, carveraCliPath: '' },
      { gcodePath: '/x.nc', connection: 'auto' }
    )
    expect(command).toBe('carvera-cli')
  })

  it('falls back to default when carveraCliPath is whitespace-only', () => {
    const { command } = buildCarveraUploadArgs(
      { ...baseSettings, carveraCliPath: '   \t  ' },
      { gcodePath: '/x.nc', connection: 'auto' }
    )
    expect(command).toBe('carvera-cli')
  })

  it('does NOT trim user-configured path internally (preserves embedded spaces)', () => {
    const userPath = 'C:\\Program Files\\carvera\\carvera-cli.exe'
    const { command } = buildCarveraUploadArgs(
      { ...baseSettings, carveraCliPath: userPath },
      { gcodePath: '/x.nc', connection: 'auto' }
    )
    // After trim() the leading/trailing whitespace is stripped, but embedded
    // spaces survive verbatim because trim only touches the ends.
    expect(command).toBe(userPath)
  })

  it('trims surrounding whitespace from user-configured path', () => {
    const { command } = buildCarveraUploadArgs(
      { ...baseSettings, carveraCliPath: '  /usr/local/bin/carvera-cli  ' },
      { gcodePath: '/x.nc', connection: 'auto' }
    )
    expect(command).toBe('/usr/local/bin/carvera-cli')
  })
})

// -----------------------------------------------------------------------------
// (D) extra-args parsing contract
// -----------------------------------------------------------------------------

describe('[ID-0256] (D) extra-args parsing contract', () => {
  it('valid JSON string-array prefixes args', () => {
    const { args } = buildCarveraUploadArgs(
      {
        ...baseSettings,
        carveraCliPath: 'python.exe',
        carveraCliExtraArgsJson: '["-m", "carvera_cli"]'
      },
      { gcodePath: '/x.nc', connection: 'auto', timeoutMs: 60_000 }
    )
    expect(args[0]).toBe('-m')
    expect(args[1]).toBe('carvera_cli')
  })

  it('non-array JSON resolves to empty prefix', () => {
    const { args } = buildCarveraUploadArgs(
      { ...baseSettings, carveraCliExtraArgsJson: '{"not":"array"}' },
      { gcodePath: '/x.nc', connection: 'auto', timeoutMs: 60_000 }
    )
    // First arg should be the timeout flag, not anything from the object.
    expect(args[0]).toBe('--timeout')
  })

  it('non-string array elements are filtered out', () => {
    const { args } = buildCarveraUploadArgs(
      {
        ...baseSettings,
        carveraCliExtraArgsJson: '["-m", 42, null, true, "carvera_cli"]'
      },
      { gcodePath: '/x.nc', connection: 'auto', timeoutMs: 60_000 }
    )
    // Only the two strings survive.
    expect(args[0]).toBe('-m')
    expect(args[1]).toBe('carvera_cli')
    expect(args[2]).toBe('--timeout')
  })

  it('malformed JSON resolves to empty prefix (no throw)', () => {
    expect(() =>
      buildCarveraUploadArgs(
        { ...baseSettings, carveraCliExtraArgsJson: '{not valid json' },
        { gcodePath: '/x.nc', connection: 'auto', timeoutMs: 60_000 }
      )
    ).not.toThrow()

    const { args } = buildCarveraUploadArgs(
      { ...baseSettings, carveraCliExtraArgsJson: '{not valid json' },
      { gcodePath: '/x.nc', connection: 'auto', timeoutMs: 60_000 }
    )
    expect(args[0]).toBe('--timeout')
  })

  it('empty-string carveraCliExtraArgsJson resolves to empty prefix', () => {
    const { args } = buildCarveraUploadArgs(
      { ...baseSettings, carveraCliExtraArgsJson: '' },
      { gcodePath: '/x.nc', connection: 'auto', timeoutMs: 60_000 }
    )
    expect(args[0]).toBe('--timeout')
  })

  it('whitespace-only carveraCliExtraArgsJson resolves to empty prefix', () => {
    const { args } = buildCarveraUploadArgs(
      { ...baseSettings, carveraCliExtraArgsJson: '   \n\t  ' },
      { gcodePath: '/x.nc', connection: 'auto', timeoutMs: 60_000 }
    )
    expect(args[0]).toBe('--timeout')
  })

  it('undefined carveraCliExtraArgsJson resolves to empty prefix', () => {
    const { args } = buildCarveraUploadArgs(baseSettings, {
      gcodePath: '/x.nc',
      connection: 'auto',
      timeoutMs: 60_000
    })
    expect(args[0]).toBe('--timeout')
  })

  it('empty-array JSON resolves to empty prefix', () => {
    const { args } = buildCarveraUploadArgs(
      { ...baseSettings, carveraCliExtraArgsJson: '[]' },
      { gcodePath: '/x.nc', connection: 'auto', timeoutMs: 60_000 }
    )
    expect(args[0]).toBe('--timeout')
  })

  it('all-non-string array still produces empty prefix', () => {
    const { args } = buildCarveraUploadArgs(
      { ...baseSettings, carveraCliExtraArgsJson: '[1, 2, true, null, {}]' },
      { gcodePath: '/x.nc', connection: 'auto', timeoutMs: 60_000 }
    )
    expect(args[0]).toBe('--timeout')
  })

  it('preserves prefix arg ordering verbatim', () => {
    const { args } = buildCarveraUploadArgs(
      {
        ...baseSettings,
        carveraCliExtraArgsJson: '["alpha", "beta", "gamma"]'
      },
      { gcodePath: '/x.nc', connection: 'auto', timeoutMs: 60_000 }
    )
    expect(args.slice(0, 3)).toEqual(['alpha', 'beta', 'gamma'])
  })
})

// -----------------------------------------------------------------------------
// (E) connection mode encoding
// -----------------------------------------------------------------------------

describe('[ID-0256] (E) connection mode encoding', () => {
  it('connection "wifi" emits "--wifi"', () => {
    const { args } = buildCarveraUploadArgs(baseSettings, {
      gcodePath: '/x.nc',
      connection: 'wifi',
      timeoutMs: 60_000
    })
    expect(args).toContain('--wifi')
    expect(args).not.toContain('--usb')
  })

  it('connection "usb" emits "--usb"', () => {
    const { args } = buildCarveraUploadArgs(baseSettings, {
      gcodePath: '/x.nc',
      connection: 'usb',
      timeoutMs: 60_000
    })
    expect(args).toContain('--usb')
    expect(args).not.toContain('--wifi')
  })

  it('connection "auto" emits NEITHER --wifi NOR --usb', () => {
    const { args } = buildCarveraUploadArgs(baseSettings, {
      gcodePath: '/x.nc',
      connection: 'auto',
      timeoutMs: 60_000
    })
    expect(args).not.toContain('--wifi')
    expect(args).not.toContain('--usb')
  })

  it('device flag emitted when payload.device set', () => {
    const { args } = buildCarveraUploadArgs(baseSettings, {
      gcodePath: '/x.nc',
      connection: 'wifi',
      device: '192.168.1.42',
      timeoutMs: 60_000
    })
    const i = args.indexOf('--device')
    expect(i).toBeGreaterThanOrEqual(0)
    expect(args[i + 1]).toBe('192.168.1.42')
  })

  it('device flag NOT emitted when payload.device unset', () => {
    const { args } = buildCarveraUploadArgs(baseSettings, {
      gcodePath: '/x.nc',
      connection: 'auto',
      timeoutMs: 60_000
    })
    expect(args).not.toContain('--device')
  })

  it('device flag NOT emitted when payload.device is empty string', () => {
    const { args } = buildCarveraUploadArgs(baseSettings, {
      gcodePath: '/x.nc',
      connection: 'usb',
      device: '',
      timeoutMs: 60_000
    })
    expect(args).not.toContain('--device')
  })

  it('device flag NOT emitted when payload.device is whitespace-only', () => {
    const { args } = buildCarveraUploadArgs(baseSettings, {
      gcodePath: '/x.nc',
      connection: 'usb',
      device: '   \t  ',
      timeoutMs: 60_000
    })
    expect(args).not.toContain('--device')
  })

  it('device value is trimmed before emission', () => {
    const { args } = buildCarveraUploadArgs(baseSettings, {
      gcodePath: '/x.nc',
      connection: 'usb',
      device: '  COM4  ',
      timeoutMs: 60_000
    })
    const i = args.indexOf('--device')
    expect(args[i + 1]).toBe('COM4')
  })

  it('connection flag precedes device flag in argv order', () => {
    const { args } = buildCarveraUploadArgs(baseSettings, {
      gcodePath: '/x.nc',
      connection: 'wifi',
      device: '192.168.1.99',
      timeoutMs: 60_000
    })
    expect(args.indexOf('--wifi')).toBeLessThan(args.indexOf('--device'))
  })
})

// -----------------------------------------------------------------------------
// (F) timeout-seconds rounding
// -----------------------------------------------------------------------------

describe('[ID-0256] (F) timeout-seconds rounding', () => {
  it('60_000 ms -> "60"', () => {
    const { args } = buildCarveraUploadArgs(baseSettings, {
      gcodePath: '/x.nc',
      connection: 'auto',
      timeoutMs: 60_000
    })
    const i = args.indexOf('--timeout')
    expect(args[i + 1]).toBe('60')
  })

  it('60_500 ms rounds UP to "61" (Math.ceil)', () => {
    const { args } = buildCarveraUploadArgs(baseSettings, {
      gcodePath: '/x.nc',
      connection: 'auto',
      timeoutMs: 60_500
    })
    const i = args.indexOf('--timeout')
    expect(args[i + 1]).toBe('61')
  })

  it('61_001 ms rounds UP to "62"', () => {
    const { args } = buildCarveraUploadArgs(baseSettings, {
      gcodePath: '/x.nc',
      connection: 'auto',
      timeoutMs: 61_001
    })
    const i = args.indexOf('--timeout')
    expect(args[i + 1]).toBe('62')
  })

  it('999 ms rounds UP to "1" (sub-second floors to 1 s)', () => {
    const { args } = buildCarveraUploadArgs(baseSettings, {
      gcodePath: '/x.nc',
      connection: 'auto',
      timeoutMs: 999
    })
    const i = args.indexOf('--timeout')
    expect(args[i + 1]).toBe('1')
  })

  it('1 ms rounds UP to "1" (1-s floor)', () => {
    const { args } = buildCarveraUploadArgs(baseSettings, {
      gcodePath: '/x.nc',
      connection: 'auto',
      timeoutMs: 1
    })
    const i = args.indexOf('--timeout')
    expect(args[i + 1]).toBe('1')
  })

  it('0 ms emits NO --timeout flag', () => {
    const { args } = buildCarveraUploadArgs(baseSettings, {
      gcodePath: '/x.nc',
      connection: 'auto',
      timeoutMs: 0
    })
    expect(args).not.toContain('--timeout')
  })

  it('negative ms emits NO --timeout flag', () => {
    const { args } = buildCarveraUploadArgs(baseSettings, {
      gcodePath: '/x.nc',
      connection: 'auto',
      timeoutMs: -500
    })
    expect(args).not.toContain('--timeout')
  })

  it('missing timeoutMs defaults to 120_000 ms -> "120"', () => {
    const { args } = buildCarveraUploadArgs(baseSettings, {
      gcodePath: '/x.nc',
      connection: 'auto'
    })
    const i = args.indexOf('--timeout')
    expect(args[i + 1]).toBe('120')
  })

  it('explicit 120_000 also -> "120"', () => {
    const { args } = buildCarveraUploadArgs(baseSettings, {
      gcodePath: '/x.nc',
      connection: 'auto',
      timeoutMs: 120_000
    })
    const i = args.indexOf('--timeout')
    expect(args[i + 1]).toBe('120')
  })

  it('--timeout value is always a string (not a number)', () => {
    const { args } = buildCarveraUploadArgs(baseSettings, {
      gcodePath: '/x.nc',
      connection: 'auto',
      timeoutMs: 30_000
    })
    const i = args.indexOf('--timeout')
    expect(typeof args[i + 1]).toBe('string')
    expect(args[i + 1]).toBe('30')
  })

  it('--timeout positioned BEFORE upload positional', () => {
    const { args } = buildCarveraUploadArgs(baseSettings, {
      gcodePath: '/x.nc',
      connection: 'auto',
      timeoutMs: 60_000
    })
    expect(args.indexOf('--timeout')).toBeLessThan(args.indexOf('upload'))
  })
})

// -----------------------------------------------------------------------------
// (G) positional arg ordering invariant
// -----------------------------------------------------------------------------

describe('[ID-0256] (G) positional arg ordering invariant', () => {
  it('"upload" positional precedes the gcode path positional', () => {
    const { args } = buildCarveraUploadArgs(baseSettings, {
      gcodePath: '/path/to/cam.nc',
      connection: 'auto',
      timeoutMs: 60_000
    })
    const u = args.indexOf('upload')
    expect(u).toBeGreaterThanOrEqual(0)
    expect(args[u + 1]).toBe('/path/to/cam.nc')
  })

  it('--remote-path positioned AFTER gcodePath positional', () => {
    const { args } = buildCarveraUploadArgs(baseSettings, {
      gcodePath: '/x.nc',
      connection: 'auto',
      remotePath: '/sd/gcodes/job.nc',
      timeoutMs: 60_000
    })
    const u = args.indexOf('upload')
    const rp = args.indexOf('--remote-path')
    expect(rp).toBeGreaterThan(u + 1)
  })

  it('remoteDirectory positional positioned AFTER gcodePath positional', () => {
    const { args } = buildCarveraUploadArgs(baseSettings, {
      gcodePath: '/x.nc',
      connection: 'auto',
      remoteDirectory: '/sd/gcodes/',
      timeoutMs: 60_000
    })
    const u = args.indexOf('upload')
    expect(args[u + 1]).toBe('/x.nc')
    expect(args[u + 2]).toBe('/sd/gcodes/')
  })

  it('--overwrite is the LAST flag when set with --remote-path', () => {
    const { args } = buildCarveraUploadArgs(baseSettings, {
      gcodePath: '/x.nc',
      connection: 'auto',
      remotePath: '/sd/gcodes/job.nc',
      overwrite: true,
      timeoutMs: 60_000
    })
    expect(args[args.length - 1]).toBe('--overwrite')
  })

  it('--overwrite is the LAST flag when set with remoteDirectory', () => {
    const { args } = buildCarveraUploadArgs(baseSettings, {
      gcodePath: '/x.nc',
      connection: 'auto',
      remoteDirectory: '/sd/gcodes/',
      overwrite: true,
      timeoutMs: 60_000
    })
    expect(args[args.length - 1]).toBe('--overwrite')
  })

  it('--overwrite is the LAST flag when no remote path/dir set', () => {
    const { args } = buildCarveraUploadArgs(baseSettings, {
      gcodePath: '/x.nc',
      connection: 'auto',
      overwrite: true,
      timeoutMs: 60_000
    })
    expect(args[args.length - 1]).toBe('--overwrite')
  })

  it('--overwrite NOT emitted when overwrite undefined', () => {
    const { args } = buildCarveraUploadArgs(baseSettings, {
      gcodePath: '/x.nc',
      connection: 'auto',
      timeoutMs: 60_000
    })
    expect(args).not.toContain('--overwrite')
  })

  it('--overwrite NOT emitted when overwrite false', () => {
    const { args } = buildCarveraUploadArgs(baseSettings, {
      gcodePath: '/x.nc',
      connection: 'auto',
      overwrite: false,
      timeoutMs: 60_000
    })
    expect(args).not.toContain('--overwrite')
  })
})

// -----------------------------------------------------------------------------
// (H) remote path/directory contract
// -----------------------------------------------------------------------------

describe('[ID-0256] (H) remote path/directory contract', () => {
  it('remotePath wins over remoteDirectory when BOTH set', () => {
    const { args } = buildCarveraUploadArgs(baseSettings, {
      gcodePath: '/x.nc',
      connection: 'auto',
      remotePath: '/sd/gcodes/winner.nc',
      remoteDirectory: '/sd/gcodes/loser/',
      timeoutMs: 60_000
    })
    expect(args).toContain('--remote-path')
    expect(args).toContain('/sd/gcodes/winner.nc')
    expect(args).not.toContain('/sd/gcodes/loser/')
  })

  it('remotePath emits "--remote-path <value>" pair', () => {
    const { args } = buildCarveraUploadArgs(baseSettings, {
      gcodePath: '/x.nc',
      connection: 'auto',
      remotePath: '/sd/gcodes/abc.nc',
      timeoutMs: 60_000
    })
    const i = args.indexOf('--remote-path')
    expect(args[i + 1]).toBe('/sd/gcodes/abc.nc')
  })

  it('remoteDirectory becomes second positional after gcodePath', () => {
    const { args } = buildCarveraUploadArgs(baseSettings, {
      gcodePath: '/path/cam.nc',
      connection: 'auto',
      remoteDirectory: '/sd/gcodes/proj/',
      timeoutMs: 60_000
    })
    const u = args.indexOf('upload')
    expect(args[u + 1]).toBe('/path/cam.nc')
    expect(args[u + 2]).toBe('/sd/gcodes/proj/')
  })

  it('whitespace-only remotePath treated as absent', () => {
    const { args } = buildCarveraUploadArgs(baseSettings, {
      gcodePath: '/x.nc',
      connection: 'auto',
      remotePath: '   \t   ',
      timeoutMs: 60_000
    })
    expect(args).not.toContain('--remote-path')
  })

  it('whitespace-only remoteDirectory treated as absent', () => {
    const { args } = buildCarveraUploadArgs(baseSettings, {
      gcodePath: '/x.nc',
      connection: 'auto',
      remoteDirectory: '   \t   ',
      timeoutMs: 60_000
    })
    // No remote-path either; second positional is missing.
    expect(args).not.toContain('--remote-path')
    const u = args.indexOf('upload')
    // upload + gcodePath are the last positionals
    expect(args[u]).toBe('upload')
    expect(args[u + 1]).toBe('/x.nc')
  })

  it('whitespace-only remotePath falls back to remoteDirectory if set', () => {
    const { args } = buildCarveraUploadArgs(baseSettings, {
      gcodePath: '/x.nc',
      connection: 'auto',
      remotePath: '   ',
      remoteDirectory: '/sd/gcodes/fallback/',
      timeoutMs: 60_000
    })
    expect(args).not.toContain('--remote-path')
    const u = args.indexOf('upload')
    expect(args[u + 2]).toBe('/sd/gcodes/fallback/')
  })

  it('both absent -> neither flag NOR positional emitted', () => {
    const { args } = buildCarveraUploadArgs(baseSettings, {
      gcodePath: '/x.nc',
      connection: 'auto',
      timeoutMs: 60_000
    })
    expect(args).not.toContain('--remote-path')
    const u = args.indexOf('upload')
    // After upload + gcodePath, next slot must not be a directory-looking
    // string -- args may end at u+1 (length === u+2) or have flags but
    // those flags would fire other tests.
    expect(args.length).toBe(u + 2)
  })

  it('remotePath value is trimmed before emission', () => {
    const { args } = buildCarveraUploadArgs(baseSettings, {
      gcodePath: '/x.nc',
      connection: 'auto',
      remotePath: '  /sd/gcodes/job.nc  ',
      timeoutMs: 60_000
    })
    const i = args.indexOf('--remote-path')
    expect(args[i + 1]).toBe('/sd/gcodes/job.nc')
  })

  it('remoteDirectory value is trimmed before emission', () => {
    const { args } = buildCarveraUploadArgs(baseSettings, {
      gcodePath: '/x.nc',
      connection: 'auto',
      remoteDirectory: '  /sd/gcodes/proj/  ',
      timeoutMs: 60_000
    })
    const u = args.indexOf('upload')
    expect(args[u + 2]).toBe('/sd/gcodes/proj/')
  })
})

// -----------------------------------------------------------------------------
// (I) three-machine path realism
// -----------------------------------------------------------------------------

describe('[ID-0256] (I) three-machine path realism', () => {
  it('Carvera 3-axis WiFi cam.nc upload to documented IP', () => {
    const { command, args } = buildCarveraUploadArgs(baseSettings, {
      gcodePath: 'C:\\Users\\jrrou\\WorkTrackCAM\\output\\cam.nc',
      connection: 'wifi',
      device: '192.168.4.1',
      remotePath: '/sd/gcodes/cam.nc',
      overwrite: true,
      timeoutMs: 120_000
    })
    expect(command).toBe('carvera-cli')
    expect(args).toEqual([
      '--wifi',
      '--device',
      '192.168.4.1',
      '--timeout',
      '120',
      'upload',
      'C:\\Users\\jrrou\\WorkTrackCAM\\output\\cam.nc',
      '--remote-path',
      '/sd/gcodes/cam.nc',
      '--overwrite'
    ])
  })

  it('Carvera 4-axis rotary USB cam.nc upload via COM port', () => {
    const { args } = buildCarveraUploadArgs(baseSettings, {
      gcodePath: 'D:\\rotary-job\\cam.nc',
      connection: 'usb',
      device: 'COM4',
      remoteDirectory: '/sd/gcodes/rotary/',
      overwrite: false,
      timeoutMs: 90_000
    })
    expect(args).toEqual([
      '--usb',
      '--device',
      'COM4',
      '--timeout',
      '90',
      'upload',
      'D:\\rotary-job\\cam.nc',
      '/sd/gcodes/rotary/'
    ])
  })

  it('Carvera POSIX path realism (Linux/Mac dev box)', () => {
    const { args } = buildCarveraUploadArgs(baseSettings, {
      gcodePath: '/home/jacob/projects/clock-face/output/cam.nc',
      connection: 'wifi',
      device: 'carvera.local',
      timeoutMs: 60_000
    })
    expect(args).toContain('upload')
    expect(args).toContain('/home/jacob/projects/clock-face/output/cam.nc')
    expect(args).toContain('carvera.local')
  })

  it('Carvera 4-axis rotary auto-discover (no explicit connection)', () => {
    const { args } = buildCarveraUploadArgs(baseSettings, {
      gcodePath: '/tmp/rotary.nc',
      connection: 'auto',
      remoteDirectory: '/sd/gcodes/auto/',
      timeoutMs: 120_000
    })
    expect(args).not.toContain('--wifi')
    expect(args).not.toContain('--usb')
    expect(args).not.toContain('--device')
    const u = args.indexOf('upload')
    expect(args[u + 1]).toBe('/tmp/rotary.nc')
    expect(args[u + 2]).toBe('/sd/gcodes/auto/')
  })

  it('Carvera community-firmware python -m carvera_cli prefix', () => {
    const { command, args } = buildCarveraUploadArgs(
      {
        ...baseSettings,
        carveraCliPath: 'C:\\Python311\\python.exe',
        carveraCliExtraArgsJson: '["-m", "carvera_cli"]'
      },
      {
        gcodePath: '/x.nc',
        connection: 'wifi',
        device: '192.168.4.1',
        timeoutMs: 60_000
      }
    )
    expect(command).toBe('C:\\Python311\\python.exe')
    expect(args.slice(0, 2)).toEqual(['-m', 'carvera_cli'])
    expect(args).toContain('--wifi')
  })

  it('Carvera SD card root upload (remote-path is absolute SD path)', () => {
    const { args } = buildCarveraUploadArgs(baseSettings, {
      gcodePath: '/x.nc',
      connection: 'wifi',
      remotePath: '/sd/job.nc',
      timeoutMs: 60_000
    })
    const i = args.indexOf('--remote-path')
    expect(args[i + 1]).toBe('/sd/job.nc')
  })

  it('Carvera large rotary job 600 s timeout (10 min) rounds correctly', () => {
    const { args } = buildCarveraUploadArgs(baseSettings, {
      gcodePath: '/x.nc',
      connection: 'wifi',
      timeoutMs: 600_000
    })
    const i = args.indexOf('--timeout')
    expect(args[i + 1]).toBe('600')
  })
})

// -----------------------------------------------------------------------------
// (J) source-text whitelist
// -----------------------------------------------------------------------------

describe('[ID-0256] (J) source-text whitelist', () => {
  it('source file has <= 130 lines (current: 120)', () => {
    const lineCount = SOURCE_TEXT.split('\n').length
    expect(lineCount).toBeLessThanOrEqual(130)
    expect(lineCount).toBeGreaterThanOrEqual(110)
  })

  it('source file is <= 4 KB on disk', () => {
    expect(Buffer.byteLength(SOURCE_TEXT, 'utf8')).toBeLessThanOrEqual(4096)
  })

  it('declares the documented runtime exports verbatim', () => {
    expect(SOURCE_TEXT).toMatch(/export function buildCarveraUploadArgs\(/)
    expect(SOURCE_TEXT).toMatch(/export async function carveraUpload\(/)
  })

  it('imports statSync from node:fs (not require)', () => {
    expect(SOURCE_TEXT).toMatch(/import \{ statSync \} from ['"]node:fs['"]/)
  })

  it('imports spawnBounded from ./subprocess-bounded', () => {
    expect(SOURCE_TEXT).toMatch(
      /import \{ spawnBounded \} from ['"]\.\/subprocess-bounded['"]/
    )
  })

  it('imports AppSettings type-only from project-schema', () => {
    expect(SOURCE_TEXT).toMatch(
      /import type \{ AppSettings \} from ['"]\.\.\/shared\/project-schema['"]/
    )
  })

  it('does NOT import electron directly', () => {
    expect(SOURCE_TEXT).not.toMatch(/from ['"]electron['"]/)
  })

  it('does NOT import node:path', () => {
    expect(SOURCE_TEXT).not.toMatch(/from ['"]node:path['"]/)
  })

  it('does NOT import node:child_process directly', () => {
    expect(SOURCE_TEXT).not.toMatch(/from ['"]node:child_process['"]/)
  })

  it('does NOT reference foreign-machine vendors moonraker / klipper / fluidd', () => {
    // K2 Plus FDM upload path lives elsewhere; this helper is Carvera-only.
    expect(SOURCE_TEXT).not.toMatch(/moonraker/i)
    expect(SOURCE_TEXT).not.toMatch(/klipper/i)
    expect(SOURCE_TEXT).not.toMatch(/fluidd/i)
  })

  it('does NOT reference foreign-machine vendors richauto / mach3 / laguna', () => {
    // Laguna upload is manual USB stick; this helper is Carvera-only.
    expect(SOURCE_TEXT).not.toMatch(/richauto/i)
    expect(SOURCE_TEXT).not.toMatch(/\bmach3\b/i)
    expect(SOURCE_TEXT).not.toMatch(/laguna/i)
  })

  it('does NOT contain G-code / M-code literals (e.g. G0 G1 M3 M5)', () => {
    // Argv builder must not embed toolpath. M3/M5/G0/G1 belong in posts.
    expect(SOURCE_TEXT).not.toMatch(/['"]G0\b/)
    expect(SOURCE_TEXT).not.toMatch(/['"]G1\b/)
    expect(SOURCE_TEXT).not.toMatch(/['"]M3\b/)
    expect(SOURCE_TEXT).not.toMatch(/['"]M5\b/)
  })

  it('does NOT contain `:any` / `as any` / `<any>` casts', () => {
    expect(SOURCE_TEXT).not.toMatch(/:\s*any\b/)
    expect(SOURCE_TEXT).not.toMatch(/\bas\s+any\b/)
    expect(SOURCE_TEXT).not.toMatch(/<\s*any\s*>/)
  })

  it('does NOT use console.log / console.error / console.warn', () => {
    expect(SOURCE_TEXT).not.toMatch(/console\.\w+/)
  })

  it('does NOT use `throw new Error` (returns Result-shaped objects instead)', () => {
    expect(SOURCE_TEXT).not.toMatch(/throw new Error/)
  })

  it('declares default executable literal `carvera-cli`', () => {
    expect(SOURCE_TEXT).toMatch(/['"]carvera-cli['"]/)
  })

  it('declares default timeout literal 120_000', () => {
    expect(SOURCE_TEXT).toMatch(/120_000/)
  })

  it('declares CarveraConnectionMode union with auto / wifi / usb', () => {
    expect(SOURCE_TEXT).toMatch(
      /export type CarveraConnectionMode\s*=\s*['"]auto['"]\s*\|\s*['"]wifi['"]\s*\|\s*['"]usb['"]/
    )
  })

  it('declares CarveraUploadResult discriminated union (ok: true / ok: false)', () => {
    expect(SOURCE_TEXT).toMatch(/ok:\s*true/)
    expect(SOURCE_TEXT).toMatch(/ok:\s*false/)
  })

  it('uses Math.ceil for seconds-grain timeout (NOT Math.floor / Math.round)', () => {
    expect(SOURCE_TEXT).toMatch(/Math\.ceil\(\s*timeoutMs\s*\/\s*1000\s*\)/)
    expect(SOURCE_TEXT).not.toMatch(/Math\.floor\(\s*timeoutMs\s*\/\s*1000\s*\)/)
    expect(SOURCE_TEXT).not.toMatch(/Math\.round\(\s*timeoutMs\s*\/\s*1000\s*\)/)
  })

  it('uses 1-second floor via Math.max(1, ...)', () => {
    expect(SOURCE_TEXT).toMatch(/Math\.max\(\s*1\s*,/)
  })

  it('error path returns G-code-not-found result with workflow hint', () => {
    expect(SOURCE_TEXT).toMatch(/G-code file not found\./)
    expect(SOURCE_TEXT).toMatch(/Generate toolpath/)
  })

  it('ENOENT hint surfaces External tool paths Settings', () => {
    expect(SOURCE_TEXT).toMatch(/spawn\|ENOENT/)
    expect(SOURCE_TEXT).toMatch(/External tool paths/)
  })

  it('does NOT use `default export`', () => {
    expect(SOURCE_TEXT).not.toMatch(/^export default\b/m)
  })

  it('does NOT declare any class', () => {
    expect(SOURCE_TEXT).not.toMatch(/^class\s+\w+/m)
    expect(SOURCE_TEXT).not.toMatch(/^export\s+class\s+\w+/m)
  })

  it('declares exactly two runtime exports (functions only)', () => {
    const exportFunctionLines = (
      SOURCE_TEXT.match(/^export\s+(?:async\s+)?function\s+\w+/gm) ?? []
    ).length
    expect(exportFunctionLines).toBe(2)
  })

  it('uses `--remote-path` flag spelling exactly (not --remotePath)', () => {
    expect(SOURCE_TEXT).toMatch(/['"]--remote-path['"]/)
    expect(SOURCE_TEXT).not.toMatch(/--remotePath\b/)
  })

  it('uses `--overwrite` flag spelling exactly', () => {
    expect(SOURCE_TEXT).toMatch(/['"]--overwrite['"]/)
  })

  it('uses `--timeout` flag spelling exactly (not --timeout-sec)', () => {
    expect(SOURCE_TEXT).toMatch(/['"]--timeout['"]/)
    expect(SOURCE_TEXT).not.toMatch(/--timeout-sec\b/)
  })
})
