/**
 * Gap #4 paired pin: `calibration:generate` IPC surface end-to-end plumbing.
 *
 * Mirrors the SOURCE-pin pattern of `slice-orca-ipc-pin.test.ts`.
 * Each describe block asserts the on-disk source text at one layer of
 * the wire so a careless rename, drop, or re-route at any layer fails
 * CI BEFORE it can ship.
 *
 * Layers covered (top → bottom of the renderer-→-calibration-generator stack):
 *
 *   A. ipc-fabrication.ts registers `calibration:generate` and delegates to
 *      the pure dispatcher at `src/main/calibration/k2-plus-tests.ts`.
 *   B. preload/index.ts declares `calibrationGenerate` on the Api type and
 *      wires it to the `calibration:generate` IPC channel.
 *   C. shop-types.ts (renderer-side window typing) declares
 *      `calibrationGenerate` so renderer code that pulls `window.fab`
 *      typechecks.
 *   D. ManufactureWorkspace mounts the CalibrationPanel under the
 *      `calibrate` sub-tab.
 *   E. CalibrationPanel itself calls `window.fab.calibrationGenerate(...)`
 *      with the K2 Plus output path scheme.
 *
 * Three-machine cross-cut: DIRECT on Creality K2 Plus (the only FDM in
 * the three-machine cohort and the only target of this surface). The
 * CalibrationPanel hard-gates `isK2Plus === true` so Laguna / Carvera
 * cannot reach the calibration generator -- pin D5 asserts that gate.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPO_ROOT = resolve(__dirname, '..', '..', '..')
const IPC_SRC = readFileSync(resolve(REPO_ROOT, 'src', 'main', 'ipc-fabrication.ts'), 'utf8')
const PRELOAD_SRC = readFileSync(resolve(REPO_ROOT, 'src', 'preload', 'index.ts'), 'utf8')
const SHOP_TYPES_SRC = readFileSync(resolve(REPO_ROOT, 'src', 'renderer', 'src', 'shop-types.ts'), 'utf8')
const WORKSPACE_SRC = readFileSync(
  resolve(REPO_ROOT, 'src', 'renderer', 'manufacture', 'ManufactureWorkspace.tsx'),
  'utf8'
)
const PANEL_SRC = readFileSync(
  resolve(REPO_ROOT, 'src', 'renderer', 'manufacture', 'CalibrationPanel.tsx'),
  'utf8'
)
const SUBTAB_SRC = readFileSync(
  resolve(REPO_ROOT, 'src', 'renderer', 'manufacture', 'ManufactureSubTabStrip.tsx'),
  'utf8'
)
const WORKSPACE_MEMORY_SRC = readFileSync(
  resolve(REPO_ROOT, 'src', 'renderer', 'shell', 'workspaceMemory.ts'),
  'utf8'
)

// ── A. IPC handler ──────────────────────────────────────────────────────────

describe('A. ipc-fabrication registers calibration:generate', () => {
  it('A1: handler is registered for the calibration:generate channel', () => {
    expect(IPC_SRC).toMatch(/ipcMain\.handle\(\s*'calibration:generate'/)
  })

  it('A2: handler imports buildCalibrationGcode from ./calibration/k2-plus-tests', () => {
    expect(IPC_SRC).toContain("from './calibration/k2-plus-tests'")
    expect(IPC_SRC).toContain('buildCalibrationGcode')
  })

  it('A3: handler rejects unknown kinds at the boundary', () => {
    // Anchor on the calibration:generate handler; this is the LAST
    // ipcMain.handle in the file so we just slice from the anchor to EOF
    // (the registerFabricationIpcHandlers function's closing brace).
    const start = IPC_SRC.search(/ipcMain\.handle\(\s*'calibration:generate'/)
    expect(start).toBeGreaterThan(-1)
    const handlerBody = IPC_SRC.slice(start)
    expect(handlerBody).toContain("'invalid_kind'")
    expect(handlerBody).toContain("'missing_output_path'")
  })

  it('A4: handler rejects null-byte paths (path-injection guard)', () => {
    const start = IPC_SRC.search(/ipcMain\.handle\(\s*'calibration:generate'/)
    expect(start).toBeGreaterThan(-1)
    const handlerBody = IPC_SRC.slice(start)
    expect(handlerBody).toContain("'invalid_path'")
    expect(handlerBody).toContain("includes('\\0')")
  })

  it('A5: handler writes the generated file via fs/promises writeFile', () => {
    const start = IPC_SRC.search(/ipcMain\.handle\(\s*'calibration:generate'/)
    expect(start).toBeGreaterThan(-1)
    const handlerBody = IPC_SRC.slice(start)
    expect(handlerBody).toContain('writeFile(result.outputGcodePath, result.gcode')
    expect(handlerBody).toMatch(/mkdir\(dirname\(/)
  })

  it('A6: handler covers all three calibration kinds', () => {
    const start = IPC_SRC.search(/ipcMain\.handle\(\s*'calibration:generate'/)
    expect(start).toBeGreaterThan(-1)
    const handlerBody = IPC_SRC.slice(start)
    expect(handlerBody).toContain('temperature-tower')
    expect(handlerBody).toContain('flow-rate')
    expect(handlerBody).toContain('pressure-advance')
  })
})

// ── B. preload bridge ──────────────────────────────────────────────────────

describe('B. preload/index.ts wires calibrationGenerate', () => {
  it('B1: preload Api type declares calibrationGenerate', () => {
    expect(PRELOAD_SRC).toContain('calibrationGenerate: ')
  })

  it('B2: preload implementation routes to the calibration:generate channel', () => {
    expect(PRELOAD_SRC).toMatch(
      /calibrationGenerate:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\(\s*'calibration:generate'/
    )
  })

  it('B3: preload type covers all three calibration kinds in the discriminated union', () => {
    expect(PRELOAD_SRC).toContain("kind: 'temperature-tower'")
    expect(PRELOAD_SRC).toContain("kind: 'flow-rate'")
    expect(PRELOAD_SRC).toContain("kind: 'pressure-advance'")
  })
})

// ── C. shop-types.ts (renderer window typing) ──────────────────────────────

describe('C. shop-types.ts declares calibrationGenerate on window.fab', () => {
  it('C1: window.fab type includes calibrationGenerate', () => {
    expect(SHOP_TYPES_SRC).toContain('calibrationGenerate: (payload')
  })

  it('C2: window.fab calibrationGenerate covers all three kinds', () => {
    expect(SHOP_TYPES_SRC).toContain("kind: 'temperature-tower'")
    expect(SHOP_TYPES_SRC).toContain("kind: 'flow-rate'")
    expect(SHOP_TYPES_SRC).toContain("kind: 'pressure-advance'")
  })
})

// ── D. ManufactureWorkspace wires the Calibrate sub-tab ────────────────────

describe('D. ManufactureWorkspace mounts the CalibrationPanel', () => {
  it('D1: imports CalibrationPanel', () => {
    expect(WORKSPACE_SRC).toContain("from './CalibrationPanel'")
    expect(WORKSPACE_SRC).toContain('CalibrationPanel')
  })

  it('D2: routes panelTab === "calibrate" to <CalibrationPanel>', () => {
    expect(WORKSPACE_SRC).toMatch(/panelTab === 'calibrate'/)
    expect(WORKSPACE_SRC).toMatch(/<CalibrationPanel[\s\S]+?activeMachine=/)
  })

  it('D3: workspaceMemory declares "calibrate" in the panel tab union', () => {
    expect(WORKSPACE_MEMORY_SRC).toContain("'calibrate'")
    // Both the type alias and the validator set must include it.
    expect(WORKSPACE_MEMORY_SRC).toMatch(/'plan'\s*\|\s*'setup'\s*\|\s*'cam'\s*\|\s*'simulate'\s*\|\s*'slice'\s*\|\s*'calibrate'\s*\|\s*'tools'/)
  })

  it('D4: ManufactureSubTabStrip includes a Calibrate tab entry', () => {
    expect(SUBTAB_SRC).toMatch(/id:\s*'calibrate'/)
    expect(SUBTAB_SRC).toContain('Calibrate')
  })

  it('D5: CalibrationPanel gates on isK2Plus (My-Shop-Only hard constraint)', () => {
    expect(PANEL_SRC).toContain("'creality-k2-plus'")
    expect(PANEL_SRC).toContain('isK2Plus')
    expect(PANEL_SRC).toContain('K2 Plus only')
  })

  it('D6: CalibrationPanel calls window.fab.calibrationGenerate for all three kinds', () => {
    expect(PANEL_SRC).toMatch(/calibrationGenerate\(\{[\s\S]+kind:\s*'temperature-tower'/)
    expect(PANEL_SRC).toMatch(/calibrationGenerate\(\{[\s\S]+kind:\s*'flow-rate'/)
    expect(PANEL_SRC).toMatch(/calibrationGenerate\(\{[\s\S]+kind:\s*'pressure-advance'/)
  })

  it('D7: CalibrationPanel reuses moonrakerPush for "Send to K2 Plus"', () => {
    expect(PANEL_SRC).toContain('moonrakerPush(payload)')
    expect(PANEL_SRC).toContain('buildMoonrakerPushPayload')
  })
})
