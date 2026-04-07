/**
 * Shared types, constants, and utilities for the ShopApp component tree.
 *
 * Extracted from ShopApp.tsx to allow child components to import
 * without circular dependencies.
 */
import type { MachineProfile } from '../../shared/machine-schema'
import type { ManufactureOperation, ManufactureOperationKind } from '../../shared/manufacture-schema'
import type { ToolRecord } from '../../shared/tool-schema'
import type { MaterialRecord } from '../../shared/material-schema'
import type { ModelTransform, StockDimensions } from './ShopModelViewer'
import type { MachineUIMode } from './shop-stock-bounds'
import type { CpsImportSummary } from '../../main/machine-cps-import'
import type { ToolLibraryFile } from '../../shared/tool-schema'
import type { DxfParseResult } from '../../shared/dxf-parser'
import type { MaterialAuditResult } from '../../shared/material-audit'

// ── Re-exports for convenience ───────────────────────────────────────────────
export type { MachineUIMode } from './shop-stock-bounds'
export type { ModelTransform, StockDimensions, GizmoMode } from './ShopModelViewer'
export type { ManufactureOperation, ManufactureOperationKind } from '../../shared/manufacture-schema'
export type { MachineProfile } from '../../shared/machine-schema'
export type { ToolRecord, ToolLibraryFile } from '../../shared/tool-schema'
export type { MaterialRecord, MaterialCategory } from '../../shared/material-schema'
export { MATERIAL_CATEGORY_LABELS } from '../../shared/material-schema'

// ── Electron API type ─────────────────────────────────────────────────────────
export declare const window: Window & {
  fab: {
    machinesList: () => Promise<MachineProfile[]>
    machinesCatalog: () => Promise<{ machines: MachineProfile[]; diagnostics: unknown[] }>
    machinesSaveUser: (p: MachineProfile) => Promise<MachineProfile>
    machinesDeleteUser: (id: string) => Promise<boolean>
    machinesImportJson: (text: string) => Promise<MachineProfile>
    machinesImportFile: (filePath: string) => Promise<MachineProfile>
    machinesExportUser: (id: string) => Promise<{ ok: true; path: string } | { ok: false; error: string }>
    machinesImportCpsFile: (filePath: string) => Promise<CpsImportSummary>
    machinesPickAndImportCps: () => Promise<CpsImportSummary | null>
    settingsGet: () => Promise<{ pythonPath?: string; curaEnginePath?: string; lastMachineId?: string; [k: string]: unknown }>
    settingsSet: (p: Record<string, unknown>) => Promise<Record<string, unknown>>
    dialogOpenFile: (filters: { name: string; extensions: string[] }[], dp?: string) => Promise<string | null>
    dialogOpenFiles: (filters: { name: string; extensions: string[] }[]) => Promise<string[]>
    stlStage: (projectDir: string, stlPath: string) => Promise<string>
    stlTransformForCam: (payload: {
      stlPath: string
      transform: {
        position: { x: number; y: number; z: number }
        rotation: { x: number; y: number; z: number }
        scale: { x: number; y: number; z: number }
      }
    }) => Promise<string>
    camRun: (payload: {
      stlPath: string; outPath: string; machineId: string
      zPassMm: number; stepoverMm: number; feedMmMin: number
      plungeMmMin: number; safeZMm: number; pythonPath: string
      operationKind?: string; toolDiameterMm?: number
      operationParams?: Record<string, unknown>
      rotaryStockLengthMm?: number
      rotaryStockDiameterMm?: number
      rotaryChuckDepthMm?: number
      rotaryClampOffsetMm?: number
      stockBoxZMm?: number
      stockBoxXMm?: number
      stockBoxYMm?: number
      priorPostedGcode?: string
      useMeshMachinableXClamp?: boolean
    }) => Promise<{ ok: boolean; gcode?: string; error?: string; hint?: string; usedEngine?: string; warnings?: string[] }>
    readTextFile: (filePath: string) => Promise<string>
    sliceCura: (payload: {
      stlPath: string; outPath: string; curaEnginePath: string
      slicePreset?: string | null
    }) => Promise<{ ok: boolean; stderr?: string }>
    toolsRead: (dir: string) => Promise<ToolLibraryFile>
    toolsSave: (dir: string, lib: ToolLibraryFile) => Promise<void>
    toolsImport: (dir: string, payload: { kind: 'csv' | 'json' | 'fusion' | 'fusion_csv'; content: string }) => Promise<ToolLibraryFile>
    toolsImportFile: (dir: string, filePath: string) => Promise<ToolLibraryFile>
    machineToolsRead: (machineId: string) => Promise<ToolLibraryFile>
    machineToolsSave: (machineId: string, lib: ToolLibraryFile) => Promise<void>
    machineToolsImport: (machineId: string, payload: { kind: string; content: string }) => Promise<ToolLibraryFile>
    machineToolsImportFile: (machineId: string, filePath: string) => Promise<ToolLibraryFile>
    postsList: () => Promise<Array<{ filename: string; path: string; source: 'bundled' | 'user'; preview: string }>>
    postsSave: (filename: string, content: string) => Promise<{ filename: string; path: string; source: 'bundled' | 'user'; preview: string }>
    postsRead: (filename: string) => Promise<string>
    postsUploadFile: (filePath: string) => Promise<{ filename: string; path: string; source: 'bundled' | 'user'; preview: string }>
    postsPickAndUpload: () => Promise<{ filename: string; path: string; source: 'bundled' | 'user'; preview: string } | null>
    moonrakerPush: (payload: { gcodePath: string; printerUrl: string; uploadPath?: string; startAfterUpload?: boolean; timeoutMs?: number }) => Promise<{ ok: boolean; filename?: string; error?: string; detail?: string }>
    moonrakerStatus: (url: string) => Promise<{ ok: boolean; state?: string; filename?: string; progress?: number; etaSeconds?: number; error?: string }>
    moonrakerCancel: (url: string) => Promise<{ ok: boolean; error?: string }>
    materialsList: () => Promise<MaterialRecord[]>
    materialsSave: (record: MaterialRecord) => Promise<MaterialRecord>
    materialsDelete: (id: string) => Promise<boolean>
    materialsImportJson: (jsonText: string) => Promise<MaterialRecord[]>
    materialsImportFile: (filePath: string) => Promise<MaterialRecord[]>
    materialsPickAndImport: () => Promise<MaterialRecord[] | null>
    fsReadBase64: (filePath: string) => Promise<string>
    dialogSaveFile: (filters: { name: string; extensions: string[] }[], defaultPath?: string) => Promise<string | null>
    fsWriteText: (filePath: string, content: string) => Promise<void>
    shellOpenPath: (filePath: string) => Promise<void>
    dxfImport: (filePath: string) => Promise<({ ok: true } & DxfParseResult) | { ok: false; error: string }>
    materialAudit: () => Promise<({ ok: true } & MaterialAuditResult) | { ok: false; error: string }>
  }
}

/** Accessor for the Electron bridge */
export const fab = (): typeof globalThis.window & { fab: typeof window['fab'] } extends { fab: infer F } ? F : never =>
  (globalThis.window as unknown as typeof window).fab

// ── Toast ─────────────────────────────────────────────────────────────────────
export interface Toast { id: number; kind: 'ok' | 'err' | 'warn'; msg: string }

// ── Machine UI helpers ────────────────────────────────────────────────────────
export function getMachineMode(m: MachineProfile): MachineUIMode {
  if (m.kind === 'fdm') return 'fdm'
  const axes = m.axisCount ?? 3
  if (axes >= 5) return 'cnc_5axis'
  if (axes === 4 || m.dialect === 'grbl_4axis') return 'cnc_4axis'
  if (m.meta?.cncProfile === '3d') return 'cnc_3d'
  return 'cnc_2d'
}

export const MODE_LABELS: Record<MachineUIMode, string> = {
  fdm: 'FDM Printer', cnc_2d: 'CNC Standard', cnc_3d: 'CNC 3D',
  cnc_4axis: 'CNC 4-Axis', cnc_5axis: 'CNC 5-Axis'
}
export const MODE_ICONS: Record<MachineUIMode, string> = {
  fdm: '\u{1F5A8}', cnc_2d: '\u229E', cnc_3d: '\u2B21', cnc_4axis: '\u21BB', cnc_5axis: '\u2726'
}

// ── Op lists per mode ─────────────────────────────────────────────────────────
export interface OpGroups { primary: ManufactureOperationKind[]; secondary: ManufactureOperationKind[] }

export const OPS_BY_MODE: Record<MachineUIMode, OpGroups> = {
  fdm: { primary: ['fdm_slice'], secondary: ['export_stl'] },
  cnc_2d: {
    primary: ['cnc_pocket', 'cnc_contour', 'cnc_drill', 'cnc_parallel', 'cnc_adaptive'],
    secondary: ['cnc_waterline', 'cnc_raster', 'cnc_pencil', 'cnc_3d_rough', 'cnc_3d_finish', 'export_stl']
  },
  cnc_3d: {
    primary: ['cnc_3d_rough', 'cnc_3d_finish', 'cnc_waterline', 'cnc_raster', 'cnc_pencil', 'cnc_parallel'],
    secondary: ['cnc_pocket', 'cnc_contour', 'cnc_drill', 'cnc_adaptive', 'export_stl']
  },
  cnc_4axis: {
    primary: ['cnc_4axis_roughing', 'cnc_4axis_finishing', 'cnc_4axis_contour', 'cnc_4axis_indexed', 'cnc_3d_rough', 'cnc_3d_finish'],
    secondary: ['cnc_waterline', 'cnc_raster', 'cnc_pencil', 'cnc_parallel', 'cnc_pocket', 'cnc_contour', 'cnc_drill', 'export_stl']
  },
  cnc_5axis: {
    primary: ['cnc_4axis_roughing', 'cnc_4axis_finishing', 'cnc_4axis_contour', 'cnc_4axis_indexed', 'cnc_3d_rough', 'cnc_3d_finish'],
    secondary: ['cnc_waterline', 'cnc_raster', 'cnc_pencil', 'cnc_parallel', 'cnc_pocket', 'cnc_contour', 'cnc_drill', 'export_stl']
  }
}

export const KIND_LABELS: Partial<Record<ManufactureOperationKind, string>> = {
  fdm_slice: '3D Print (FDM)', cnc_parallel: 'Parallel Finish',
  cnc_contour: 'Contour', cnc_pocket: 'Pocket', cnc_drill: 'Drill',
  cnc_adaptive: 'Adaptive Clearing', cnc_waterline: 'Waterline',
  cnc_raster: 'Raster', cnc_pencil: 'Pencil / Rest',
  cnc_4axis_roughing: '4-Axis Roughing', cnc_4axis_finishing: '4-Axis Finishing',
  cnc_4axis_contour: '4-Axis Contour', cnc_4axis_indexed: '4-Axis Indexed',
  cnc_3d_rough: '3D Rough (Adaptive)', cnc_3d_finish: '3D Finish',
  export_stl: 'Export STL'
}

// ── Types ─────────────────────────────────────────────────────────────────────
export type ViewKind = 'jobs' | 'library' | 'settings'
export type LibTab = 'machines' | 'tools' | 'materials' | 'posts'

/**
 * Support post -- a cylindrical rod that runs axially through the centre of the
 * workpiece along the rotation axis.
 */
export interface PostConfig {
  count: number
  diameterMm: number
  offsetRadiusMm: number
}

/** Cross-section profile for 4-axis rotary stock. */
export type RotaryStockProfile = 'cylinder' | 'square'

export interface Job {
  id: string; name: string; stlPath: string | null
  machineId: string | null; materialId: string | null
  stock: StockDimensions; transform: ModelTransform
  /** Cross-section shape for 4-axis rotary stock ('cylinder' = round bar, 'square' = square bar). */
  stockProfile: RotaryStockProfile
  operations: ManufactureOperation[]
  posts: PostConfig | null
  chuckDepthMm: 5 | 10
  clampOffsetMm: number
  gcodeOut: string | null; status: 'idle' | 'running' | 'done' | 'error'
  lastLog: string; printerUrl: string
}
