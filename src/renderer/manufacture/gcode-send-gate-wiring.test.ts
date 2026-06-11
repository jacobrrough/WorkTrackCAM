/**
 * gcode-send-gate-wiring.test.ts -- Wave 3m SOURCE-LEVEL wiring pins.
 *
 * The behavioral contract of the send/export safety seam lives in
 * `gcode-send-gate.test.ts` (real bundled machine dims, mocked IPC boundary,
 * blocked-path abort assertions). Those tests exercise the EXACT functions
 * the buttons run -- but node-env vitest cannot click hook-bearing
 * components, so this sibling pins the LAST inch textually: the component
 * closures actually route through the seam (same convention as
 * `new-shell-button-types.test.ts` walking source).
 *
 * If any pin here fails, a send/export surface has been rewired AWAY from
 * the export-safety gate -- which is exactly the regression that shipped
 * with the P5 cutover (3 dead ShopApp call sites, zero export-time safety
 * messaging). Do not delete a pin without re-wiring the surface.
 *
 * Also pins the Wave 3m HARD NO-TOUCH contract for the K2 path: the seam
 * never imports main-process code, and the main-process Moonraker push
 * still runs its own temperature validator (the K2's real hard gate).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const here = (rel: string): string => readFileSync(resolve(__dirname, rel), 'utf-8')

const AUX = here('ManufactureAuxPanels.tsx')
const WORKSPACE = here('ManufactureWorkspace.tsx')
const SEAM = here('gcode-send-gate.ts')
const MOONRAKER_MAIN = here('../../main/moonraker-push.ts')

describe('Wave 3m wiring -- ManufactureAuxPanels surfaces', () => {
  it('the K2 send button routes through runK2PushSurface on the exact on-disk slice path', () => {
    expect(AUX).toMatch(/await runK2PushSurface\(\{\s*\n\s*gcodePath: sendCandidatePath,/)
    expect(AUX).toContain('machine: p.activeMachine,')
  })

  it('the K2 surface no longer builds its own Moonraker payload (single tested code path)', () => {
    expect(AUX).not.toContain('buildMoonrakerPushPayload')
    expect(AUX).not.toContain('formatMoonrakerPushFailure')
  })

  it('the Carvera upload routes through runCarveraUploadSurface with the resolved gate machine', () => {
    expect(AUX).toMatch(/await runCarveraUploadSurface\(\{\s*\n\s*gcodePath,\s*\n\s*gateMachine: carveraGateMachine,/)
  })

  it('the Carvera gate machine prefers the active CNC and falls back to an installed Carvera profile', () => {
    expect(AUX).toContain('? activeCnc')
    expect(AUX).toContain("p.machines.find((m) => m.kind === 'cnc' && /carvera/i.test(`${m.id} ${m.name}`))")
  })

  it('the production GateIo reads program bytes through the preload IPC (window.fab.readTextFile)', () => {
    expect(AUX).toContain('readTextFile: (filePath: string) => window.fab.readTextFile(filePath)')
  })
})

describe('Wave 3m wiring -- ManufactureWorkspace ProfileStack sends', () => {
  it('the FDM Device stage ProfileStack Send is wired (no dead onSend left)', () => {
    expect(WORKSPACE).toContain('onSend={fdmProfileStackSend}')
  })

  it('the CNC Send stage ProfileStack Send is wired', () => {
    expect(WORKSPACE).toContain('onSend={cncProfileStackSend}')
  })

  it('NO ProfileStack mount ships a permanently-disabled onSend={null} anymore', () => {
    expect(WORKSPACE).not.toContain('onSend={null}')
  })

  it('the K2 ProfileStack send routes through runK2PushSurface', () => {
    expect(WORKSPACE).toMatch(/async function sendSlicedProgramToK2\(\): Promise<void> \{[\s\S]*?runK2PushSurface\(\{/)
  })

  it('the Carvera ProfileStack send routes through runCarveraUploadSurface on output/cam.nc', () => {
    expect(WORKSPACE).toMatch(/async function sendPostedProgramToCarvera\(\): Promise<void> \{[\s\S]*?runCarveraUploadSurface\(\{/)
    expect(WORKSPACE).toContain('output${sendSep}cam.nc')
  })

  it('the Laguna ProfileStack send routes through runLagunaExportSurface (save dialog + verified bytes)', () => {
    expect(WORKSPACE).toMatch(/async function exportPostedProgramForLaguna\(\): Promise<void> \{[\s\S]*?runLagunaExportSurface\(\{/)
    expect(WORKSPACE).toContain('fab.dialogSaveFile(')
    expect(WORKSPACE).toContain('writeTextFile: (filePath, content) => fab.fsWriteText(filePath, content)')
  })

  it('a busy latch guards the ProfileStack send against double dispatch', () => {
    expect(WORKSPACE).toContain('const [profileStackSendBusy, setProfileStackSendBusy] = useState(false)')
    expect(WORKSPACE).toContain('!profileStackSendBusy')
  })

  it('the setup-sheet export gates the embedded program NON-blockingly via formatSetupSheetGateNotice', () => {
    expect(WORKSPACE).toContain('gateCncProgramForSend({ gcode: gcodeText, machine: machineProf })')
    expect(WORKSPACE).toContain('formatSetupSheetGateNotice(')
    expect(WORKSPACE).toContain('if (notice !== null) onStatus?.(notice)')
  })
})

describe('Wave 3m honesty pins -- K2 hard gate stays in the main process', () => {
  it('the seam is renderer-pure: it never imports main-process modules', () => {
    const importLines = SEAM.split(/\r?\n/).filter((l) => l.startsWith('import '))
    expect(importLines.length).toBeGreaterThan(0)
    for (const line of importLines) {
      expect(line).not.toContain('/main/')
    }
    // The header may MENTION the temp validator (documentation); the code
    // must never call it -- that gate belongs to the main process.
    expect(SEAM).not.toContain('validateGcodeFileTemps(')
  })

  it('the main-process Moonraker push still runs the temperature validator (untouched by 3m)', () => {
    expect(MOONRAKER_MAIN).toContain('validateGcodeFileTemps(')
  })

  it('the FDM pre-flight documents the deliberate workAreaMm omission (advisory-only contract)', () => {
    expect(SEAM).toContain('workAreaMm DELIBERATELY omitted')
  })

  it('the CNC gate threads workAreaMm from the machine profile (the hard envelope gate)', () => {
    expect(SEAM).toContain('workAreaMm: input.machine.workAreaMm')
  })
})

describe('Wave 3n wiring -- lifted Carvera connection picker', () => {
  it('the workspace owns the lifted picker state', () => {
    expect(WORKSPACE).toContain(
      "const [carveraConn, setCarveraConn] = useState<'auto' | 'wifi' | 'usb'>('auto')"
    )
    expect(WORKSPACE).toContain("const [carveraDevice, setCarveraDevice] = useState('')")
  })

  it('the ProfileStack Carvera send dispatches with the picker state (no hardcoded auto)', () => {
    expect(WORKSPACE).toMatch(
      /async function sendPostedProgramToCarvera\(\): Promise<void> \{[\s\S]*?connection: carveraConn,/
    )
    expect(WORKSPACE).toContain('device: carveraDevice.trim() || undefined,')
    expect(WORKSPACE).not.toContain("connection: 'auto',")
  })

  it('the workspace threads the lifted picker into the aux panels bundle', () => {
    expect(WORKSPACE).toContain('onCarveraConnChange: setCarveraConn,')
    expect(WORKSPACE).toContain('onCarveraDeviceChange: setCarveraDevice')
  })

  it('CamManufacturePanel honors the lifted state when provided (controlled mode)', () => {
    expect(AUX).toContain('const carveraConn = p.carveraConn ?? localCarveraConn')
    expect(AUX).toContain('const setCarveraConn = p.onCarveraConnChange ?? setLocalCarveraConn')
    expect(AUX).toContain('const carveraDevice = p.carveraDevice ?? localCarveraDevice')
    expect(AUX).toContain('const setCarveraDevice = p.onCarveraDeviceChange ?? setLocalCarveraDevice')
  })
})

describe('Wave 3n honesty pins -- FDM advisory de-noise stays in the seam', () => {
  it('the de-noise filter lives in gcode-send-gate.ts, scoped to the FDM path', () => {
    expect(SEAM).toContain('FDM_NOISE_ADVISORY_PATTERN')
    expect(SEAM).toMatch(
      /adviseFdmProgramForPush[\s\S]*?warnings: assessment\.warnings\.filter\(\(w\) => !FDM_NOISE_ADVISORY_PATTERN\.test\(w\)\)/
    )
  })

  it('the PINNED shared assessor still emits the advisory (CNC surfaces keep it)', () => {
    const ASSESSOR = here('../src/gcode-export-safety.ts')
    expect(ASSESSOR).toContain('Safe retract to machine max Z')
    // The CNC gate result carries the assessor warnings UNFILTERED.
    expect(SEAM).toMatch(/gateCncProgramForSend[\s\S]*?warnings: assessment\.warnings\s*\}/)
  })
})
