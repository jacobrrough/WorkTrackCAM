/**
 * Task #9 (2026-05-27 OrcaSlicer pivot) paired pin: `slice:orca` IPC
 * surface end-to-end plumbing.
 *
 * Mirrors the SOURCE-pin pattern of `k2-moonraker-push-ui-pin.test.ts`.
 * Each describe block asserts the on-disk source text at one layer of
 * the wire so a careless rename, drop, or re-route at any layer fails
 * CI BEFORE it can ship.
 *
 * Layers covered (top → bottom of the renderer-→-OrcaSlicer stack):
 *
 *   A. ipc-fabrication.ts registers `slice:orca` and delegates to the
 *      OrcaSlicer wrapper at `src/main/slicer/orca-wrapper.ts`.
 *   B. preload/index.ts declares `sliceOrca` on the Api type and wires
 *      it to the `slice:orca` IPC channel.
 *   C. shop-types.ts (renderer-side window typing) declares `sliceOrca`
 *      so renderer code that pulls `const fab = window.fab` typechecks.
 *   D. ManufactureWorkspace.runFdmSliceFromOp calls `fab.sliceOrca(...)`
 *      with the K2 quality preset + filament id from settings, and
 *      records the output path in `lastSliceGcodePath` on success.
 *   E. SliceManufacturePanel docstring tags task #9 (pivot anchor) so
 *      the panel rebuild is traceable to this cycle's intent.
 *
 * Three-machine cross-cut: DIRECT on Creality K2 Plus (the only FDM
 * in the three-machine cohort). INDIRECT on Laguna Swift 5x10 +
 * Makera Carvera (the handler bails with `not_fdm_machine` when a
 * CNC profile is passed -- pin A6 asserts that gate).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPO_ROOT = resolve(__dirname, '..', '..')
const IPC_SRC = readFileSync(
  resolve(REPO_ROOT, 'src', 'main', 'ipc-fabrication.ts'),
  'utf8'
)
const PRELOAD_SRC = readFileSync(
  resolve(REPO_ROOT, 'src', 'preload', 'index.ts'),
  'utf8'
)
const SHOP_TYPES_SRC = readFileSync(
  resolve(REPO_ROOT, 'src', 'renderer', 'src', 'shop-types.ts'),
  'utf8'
)
const WORKSPACE_SRC = readFileSync(
  resolve(REPO_ROOT, 'src', 'renderer', 'manufacture', 'ManufactureWorkspace.tsx'),
  'utf8'
)
const PANELS_SRC = readFileSync(
  resolve(REPO_ROOT, 'src', 'renderer', 'manufacture', 'ManufactureAuxPanels.tsx'),
  'utf8'
)
const ORCA_SRC = readFileSync(
  resolve(REPO_ROOT, 'src', 'main', 'slicer', 'orca-wrapper.ts'),
  'utf8'
)

describe('A. ipc-fabrication registers slice:orca and routes through runOrcaSlice', () => {
  it('A1: handler is registered for the slice:orca channel', () => {
    expect(IPC_SRC).toMatch(/ipcMain\.handle\(\s*'slice:orca'/)
  })

  it('A2: handler imports runOrcaSlice from ./slicer/orca-wrapper', () => {
    expect(IPC_SRC).toContain("from './slicer/orca-wrapper'")
    expect(IPC_SRC).toContain('runOrcaSlice')
  })

  it('A3: handler payload type carries stlPath / outPath / machineId / qualityPresetId / filamentId / overrides', () => {
    // Anchor on the `ipcMain.handle('slice:orca', ...)` call and stop at
    // the next `ipcMain.handle(` so the captured body is the full handler
    // and nothing else (the docstring above the call also contains the
    // string `'slice:orca'`, so a naive anchor matches the comment).
    const handler = IPC_SRC.match(/ipcMain\.handle\(\s*'slice:orca',[\s\S]+?(?=ipcMain\.handle\(\s*')/)
    expect(handler).not.toBeNull()
    if (handler) {
      const body = handler[0]
      expect(body).toContain('stlPath: string')
      expect(body).toContain('outPath: string')
      expect(body).toContain('machineId: string')
      expect(body).toMatch(/qualityPresetId\?:\s*'standard'\s*\|\s*'high_speed'/)
      expect(body).toContain('filamentId?: string')
      expect(body).toContain('overrides?: Record<string, string | number>')
    }
  })

  it('A4: handler rejects missing payload fields at the boundary', () => {
    // Anchor on the `ipcMain.handle('slice:orca', ...)` call and stop at
    // the next `ipcMain.handle(` so the captured body is the full handler
    // and nothing else (the docstring above the call also contains the
    // string `'slice:orca'`, so a naive anchor matches the comment).
    const handler = IPC_SRC.match(/ipcMain\.handle\(\s*'slice:orca',[\s\S]+?(?=ipcMain\.handle\(\s*')/)
    expect(handler).not.toBeNull()
    if (handler) {
      const body = handler[0]
      expect(body).toContain("'missing_stl_path'")
      expect(body).toContain("'missing_out_path'")
      expect(body).toContain("'missing_machine_id'")
    }
  })

  it('A5: handler rejects null-byte injection in either path', () => {
    // Anchor on the `ipcMain.handle('slice:orca', ...)` call and stop at
    // the next `ipcMain.handle(` so the captured body is the full handler
    // and nothing else (the docstring above the call also contains the
    // string `'slice:orca'`, so a naive anchor matches the comment).
    const handler = IPC_SRC.match(/ipcMain\.handle\(\s*'slice:orca',[\s\S]+?(?=ipcMain\.handle\(\s*')/)
    expect(handler).not.toBeNull()
    if (handler) {
      const body = handler[0]
      expect(body).toContain("payload.stlPath.includes('\\0')")
      expect(body).toContain("payload.outPath.includes('\\0')")
    }
  })

  it('A6: handler bails with not_fdm_machine when the resolved profile is not FDM', () => {
    // Anchor on the `ipcMain.handle('slice:orca', ...)` call and stop at
    // the next `ipcMain.handle(` so the captured body is the full handler
    // and nothing else (the docstring above the call also contains the
    // string `'slice:orca'`, so a naive anchor matches the comment).
    const handler = IPC_SRC.match(/ipcMain\.handle\(\s*'slice:orca',[\s\S]+?(?=ipcMain\.handle\(\s*')/)
    expect(handler).not.toBeNull()
    if (handler) {
      const body = handler[0]
      expect(body).toContain("machine.kind !== 'fdm'")
      expect(body).toContain("'not_fdm_machine'")
    }
  })

  it('A7: handler resolves profile ini paths under resources/orca-slicer/profiles', () => {
    // Anchor on the `ipcMain.handle('slice:orca', ...)` call and stop at
    // the next `ipcMain.handle(` so the captured body is the full handler
    // and nothing else (the docstring above the call also contains the
    // string `'slice:orca'`, so a naive anchor matches the comment).
    const handler = IPC_SRC.match(/ipcMain\.handle\(\s*'slice:orca',[\s\S]+?(?=ipcMain\.handle\(\s*')/)
    expect(handler).not.toBeNull()
    if (handler) {
      const body = handler[0]
      expect(body).toContain("'orca-slicer'")
      expect(body).toContain("'profiles'")
      expect(body).toContain("'machines'")
      expect(body).toContain("'process'")
      expect(body).toContain("'filament'")
    }
  })

  it('A8: handler catches OrcaSlicer-unavailable errors with a clean envelope', () => {
    // Anchor on the `ipcMain.handle('slice:orca', ...)` call and stop at
    // the next `ipcMain.handle(` so the captured body is the full handler
    // and nothing else (the docstring above the call also contains the
    // string `'slice:orca'`, so a naive anchor matches the comment).
    const handler = IPC_SRC.match(/ipcMain\.handle\(\s*'slice:orca',[\s\S]+?(?=ipcMain\.handle\(\s*')/)
    expect(handler).not.toBeNull()
    if (handler) {
      const body = handler[0]
      expect(body).toContain("'orca_unavailable'")
      expect(body).toContain("'orca_slice_failed'")
    }
  })

  it('A9: handler returns outputGcodePath verbatim on success', () => {
    // Anchor on the `ipcMain.handle('slice:orca', ...)` call and stop at
    // the next `ipcMain.handle(` so the captured body is the full handler
    // and nothing else (the docstring above the call also contains the
    // string `'slice:orca'`, so a naive anchor matches the comment).
    const handler = IPC_SRC.match(/ipcMain\.handle\(\s*'slice:orca',[\s\S]+?(?=ipcMain\.handle\(\s*')/)
    expect(handler).not.toBeNull()
    if (handler) {
      const body = handler[0]
      expect(body).toContain('outputGcodePath: result.outputGcodePath')
    }
  })
})

describe('B. preload bridges sliceOrca onto the slice:orca IPC channel', () => {
  it('B1: preload Api type declares sliceOrca', () => {
    expect(PRELOAD_SRC).toContain('sliceOrca:')
  })

  it('B2: preload sliceOrca type signature includes the same payload shape as the handler', () => {
    const m = PRELOAD_SRC.match(/sliceOrca: \(payload: \{([\s\S]+?)\}\) =>/)
    expect(m).not.toBeNull()
    if (m) {
      const body = m[1]
      expect(body).toContain('stlPath: string')
      expect(body).toContain('outPath: string')
      expect(body).toContain('machineId: string')
      expect(body).toMatch(/qualityPresetId\?:\s*'standard'\s*\|\s*'high_speed'/)
      expect(body).toContain('filamentId?: string')
      expect(body).toContain('overrides?: Record<string, string | number>')
    }
  })

  it('B3: preload implementation invokes the slice:orca channel', () => {
    expect(PRELOAD_SRC).toContain("ipcRenderer.invoke('slice:orca', payload)")
  })

  it('B4: preload docstring tags task #9 (pivot anchor)', () => {
    // The doc comment immediately above the sliceOrca declaration must
    // reference the pivot task so the bridge is traceable.
    expect(PRELOAD_SRC).toMatch(/task #9[\s\S]{0,400}?sliceOrca:/)
  })
})

describe('C. shop-types declares sliceOrca on window.fab for renderer typecheck', () => {
  it('C1: shop-types Window.fab includes sliceOrca', () => {
    expect(SHOP_TYPES_SRC).toContain('sliceOrca:')
  })

  it('C2: shop-types sliceOrca signature matches the preload payload shape', () => {
    const m = SHOP_TYPES_SRC.match(/sliceOrca: \(payload: \{([\s\S]+?)\}\) =>/)
    expect(m).not.toBeNull()
    if (m) {
      const body = m[1]
      expect(body).toContain('stlPath: string')
      expect(body).toContain('outPath: string')
      expect(body).toContain('machineId: string')
    }
  })

  it('C3: shop-types no longer references the deleted sliceCura bridge', () => {
    expect(SHOP_TYPES_SRC).not.toContain('sliceCura:')
  })
})

describe('D. ManufactureWorkspace.runFdmSliceFromOp calls fab.sliceOrca', () => {
  it('D1: workspace body contains a fab.sliceOrca invocation', () => {
    expect(WORKSPACE_SRC).toContain('fab.sliceOrca(')
  })

  it('D2: the call threads stlPath / outPath / machineId / qualityPresetId / filamentId', () => {
    const m = WORKSPACE_SRC.match(/fab\.sliceOrca\(\{([\s\S]+?)\}\)/)
    expect(m).not.toBeNull()
    if (m) {
      const body = m[1]
      expect(body).toContain('stlPath')
      expect(body).toContain('outPath: out')
      expect(body).toContain('machineId: activeMachineId')
      expect(body).toContain('qualityPresetId: settings?.k2QualityPresetId')
      expect(body).toContain('filamentId: settings?.activeFilamentId')
    }
  })

  it('D3: success path records the output path via setLastSliceGcodePath', () => {
    // The setter is set with the same `out` const used in the payload --
    // critical for the Send-to-K2 button to have a real on-disk file.
    expect(WORKSPACE_SRC).toContain('setLastSliceGcodePath(out)')
  })

  it('D4: failure path surfaces the IPC error + hint via onStatus', () => {
    // Match the failure-branch string pattern. We do not enforce exact
    // wording (operator-facing copy may evolve), only that the error
    // code and the optional hint both reach the status surface.
    expect(WORKSPACE_SRC).toMatch(/Slice failed[\s\S]{0,80}?r\.error[\s\S]{0,80}?r\.hint/)
  })

  it('D5: runFdmSliceFromOp guards on op.kind === fdm_slice (preserved)', () => {
    expect(WORKSPACE_SRC).toContain("op.kind !== 'fdm_slice'")
  })

  it('D6: runFdmSliceFromOp body has the task #9 doc anchor', () => {
    const body = WORKSPACE_SRC.match(/async function runFdmSliceFromOp[\s\S]+?^\s*\}/m)
    // The doc comment lives immediately above the function, so look in a
    // window from "// ── FDM slice" through to the function close.
    const region = WORKSPACE_SRC.match(/FDM slice from operation[\s\S]+?^\s*\}/m)
    expect(body).not.toBeNull()
    expect(region).not.toBeNull()
    if (region) {
      expect(region[0]).toContain('task #9')
    }
  })
})

describe('E. SliceManufacturePanel anchors the pivot task in its docstring', () => {
  it('E1: panel docstring references task #9 (pivot anchor)', () => {
    expect(PANELS_SRC).toContain('task #9')
  })

  it('E2: panel still imports K2 preset module + FilamentPicker + the send seam', () => {
    expect(PANELS_SRC).toContain("from '../../shared/k2-plus-slice-presets'")
    expect(PANELS_SRC).toContain("from './FilamentPicker'")
    // Wave 3m INTENDED DRIFT: the moonraker-push payload helpers moved
    // behind the export-safety send seam; the panel now imports that seam
    // and the seam imports the payload helpers (pinned transitively).
    expect(PANELS_SRC).toContain("from './gcode-send-gate'")
    const gateSrc = readFileSync(
      resolve(REPO_ROOT, 'src', 'renderer', 'manufacture', 'gcode-send-gate.ts'),
      'utf8'
    )
    expect(gateSrc).toContain("from '../src/moonraker-push-payload'")
  })

  it('E3: panel does NOT call window.fab.sliceCura (deleted with pivot)', () => {
    expect(PANELS_SRC).not.toMatch(/window\.fab\.sliceCura/)
    expect(PANELS_SRC).not.toMatch(/fab\(\)\.sliceCura/)
  })
})

describe('F. Orca wrapper still exposes runOrcaSlice + resolveOrcaInstall (regression pin)', () => {
  it('F1: runOrcaSlice export present', () => {
    expect(ORCA_SRC).toContain('export async function runOrcaSlice')
  })

  it('F2: resolveOrcaInstall export present', () => {
    expect(ORCA_SRC).toContain('export function resolveOrcaInstall')
  })

  it('F3: buildOrcaArgs pure helper still exported (used by orca-wrapper.test.ts)', () => {
    expect(ORCA_SRC).toContain('export function buildOrcaArgs')
  })
})

describe('G. Three-machine cross-cut: DIRECT on K2, INDIRECT on Laguna + Carvera', () => {
  it('G1: handler block has zero non-K2 machine vendor identifiers', () => {
    // Anchor on the `ipcMain.handle('slice:orca', ...)` call and stop at
    // the next `ipcMain.handle(` so the captured body is the full handler
    // and nothing else (the docstring above the call also contains the
    // string `'slice:orca'`, so a naive anchor matches the comment).
    const handler = IPC_SRC.match(/ipcMain\.handle\(\s*'slice:orca',[\s\S]+?(?=ipcMain\.handle\(\s*')/)
    expect(handler).not.toBeNull()
    if (handler) {
      const body = handler[0]
      expect(body).not.toMatch(/Laguna|RichAuto|Carvera|Makera|Smoothieware/i)
      expect(body).not.toMatch(/spindle|router|rotary|4-axis|four-axis/i)
    }
  })

  it('G2: handler does NOT emit any G## or M## tokens (Safety Rule 1)', () => {
    // Anchor on the `ipcMain.handle('slice:orca', ...)` call and stop at
    // the next `ipcMain.handle(` so the captured body is the full handler
    // and nothing else (the docstring above the call also contains the
    // string `'slice:orca'`, so a naive anchor matches the comment).
    const handler = IPC_SRC.match(/ipcMain\.handle\(\s*'slice:orca',[\s\S]+?(?=ipcMain\.handle\(\s*')/)
    expect(handler).not.toBeNull()
    if (handler) {
      const body = handler[0]
      expect(body).not.toMatch(/\bG[0-9]+\b/)
      expect(body).not.toMatch(/\bM[0-9]+\b/)
    }
  })

  it('G3: handler bails when the active machine profile is not FDM (gate that protects CNC machines)', () => {
    // Anchor on the `ipcMain.handle('slice:orca', ...)` call and stop at
    // the next `ipcMain.handle(` so the captured body is the full handler
    // and nothing else (the docstring above the call also contains the
    // string `'slice:orca'`, so a naive anchor matches the comment).
    const handler = IPC_SRC.match(/ipcMain\.handle\(\s*'slice:orca',[\s\S]+?(?=ipcMain\.handle\(\s*')/)
    expect(handler).not.toBeNull()
    if (handler) {
      expect(handler[0]).toContain("machine.kind !== 'fdm'")
    }
  })
})

// ── CAD V1.5: slice:layerBreakdown end-to-end plumbing ──────────────────────
// New per-layer slice-breakdown channel. Same source-pin discipline as the
// slice:orca section above — pin each layer of the wire (handler, preload,
// shop-types) so a careless rename / drop / re-route fails CI.
//
// The `slice:layerBreakdown` handler is anchored from its `ipcMain.handle(
// 'slice:layerBreakdown'` call to the NEXT `ipcMain.handle(` (the docstring
// above the call references the channel only in backtick prose + an error-
// string, never as `ipcMain.handle('slice:layerBreakdown'`, so the anchor is
// unique).
function layerBreakdownHandlerBody(): string {
  const m = IPC_SRC.match(/ipcMain\.handle\(\s*'slice:layerBreakdown',[\s\S]+?(?=ipcMain\.handle\(\s*')/)
  expect(m).not.toBeNull()
  return m ? m[0] : ''
}

describe('H. ipc-fabrication registers slice:layerBreakdown inside registerFabricationIpc', () => {
  it('H1: handler is registered for the slice:layerBreakdown channel', () => {
    expect(IPC_SRC).toMatch(/ipcMain\.handle\(\s*'slice:layerBreakdown'/)
  })

  it('H2: the registration lives inside the registerFabricationIpc function body', () => {
    // registerFabricationIpc is the ONLY exported register* function in this
    // module; the IPC-ordering invariant (src/main/index.ts) depends on the
    // handler being registered here (called in app.whenReady() before
    // createWindow()). Assert the channel string appears AFTER the
    // `export function registerFabricationIpc(` declaration.
    const fnIdx = IPC_SRC.indexOf('export function registerFabricationIpc(')
    const channelIdx = IPC_SRC.indexOf("ipcMain.handle(\n    'slice:layerBreakdown'")
    expect(fnIdx).toBeGreaterThanOrEqual(0)
    expect(channelIdx).toBeGreaterThan(fnIdx)
  })

  it('H3: handler imports + calls the streaming parser', () => {
    expect(IPC_SRC).toContain("from './slicer/fdm-gcode-stream-parser'")
    expect(IPC_SRC).toContain('parseFdmGcodeLayersFromFile')
    expect(layerBreakdownHandlerBody()).toContain('parseFdmGcodeLayersFromFile(payload.gcodePath)')
  })

  it('H4: handler payload carries gcodePath: string', () => {
    expect(layerBreakdownHandlerBody()).toContain('gcodePath: string')
  })

  it('H5: handler rejects missing / null-byte gcodePath at the boundary', () => {
    const body = layerBreakdownHandlerBody()
    expect(body).toContain("'missing_gcode_path'")
    expect(body).toContain("payload.gcodePath.includes('\\0')")
    expect(body).toContain("'invalid_path'")
  })

  it('H6: handler returns the FdmLayerBreakdownResult under `result` on success', () => {
    const body = layerBreakdownHandlerBody()
    expect(body).toContain('ok: true as const, result')
  })

  it('H7: handler folds parser failures into a clean { ok:false } envelope', () => {
    const body = layerBreakdownHandlerBody()
    expect(body).toContain("'layer_breakdown_failed'")
    expect(body).toMatch(/catch\s*\(/)
  })

  it('H8: handler does NOT emit any G## or M## tokens + no non-K2 vendor ids (Safety Rule 1)', () => {
    const body = layerBreakdownHandlerBody()
    expect(body).not.toMatch(/\bG[0-9]+\b/)
    expect(body).not.toMatch(/\bM[0-9]+\b/)
    expect(body).not.toMatch(/Laguna|RichAuto|Carvera|Makera|spindle|rotary/i)
  })
})

describe('I. preload + shop-types bridge sliceLayerBreakdown onto the channel', () => {
  it('I1: preload Api type declares sliceLayerBreakdown', () => {
    expect(PRELOAD_SRC).toContain('sliceLayerBreakdown:')
  })

  it('I2: preload implementation invokes the slice:layerBreakdown channel', () => {
    expect(PRELOAD_SRC).toContain("ipcRenderer.invoke('slice:layerBreakdown', payload)")
  })

  it('I3: preload signature takes { gcodePath } and returns the result envelope', () => {
    const m = PRELOAD_SRC.match(/sliceLayerBreakdown: \(payload: \{ gcodePath: string \}\) =>[\s\S]+?>\n/)
    expect(m).not.toBeNull()
    if (m) {
      expect(m[0]).toContain('FdmLayerBreakdownResult')
    }
  })

  it('I4: shop-types window.fab declares sliceLayerBreakdown', () => {
    expect(SHOP_TYPES_SRC).toContain('sliceLayerBreakdown:')
    expect(SHOP_TYPES_SRC).toContain('FdmLayerBreakdownResult')
  })

  it('I5: workspace fetches the breakdown via fab.sliceLayerBreakdown (not the old readTextFile+parseLayers flow)', () => {
    // Whitespace-tolerant (the file is CRLF; the call wraps `void fab` ->
    // `.sliceLayerBreakdown(...)` across lines).
    expect(WORKSPACE_SRC).toMatch(
      /fab\s*\.sliceLayerBreakdown\(\{\s*gcodePath:\s*lastSliceGcodePath\s*\}\)/
    )
    // The coarse renderer-side parse flow for the Preview body is gone.
    expect(WORKSPACE_SRC).not.toContain('parseLayers(gcodeText)')
  })
})
