import { machineProfileSchema, type MachineProfile } from '../shared/machine-schema'

/** Defaults for fields we can't always extract from CPS */
const CPS_STUB_DEFAULTS = {
  kind: 'cnc' as const,
  workAreaMm: { x: 300, y: 300, z: 120 },
  maxFeedMmMin: 2000,
  postTemplate: 'cnc_generic_mm.hbs',
  dialect: 'grbl' as const
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** First meaningful `//` or `description = "..."` in the first 48 lines (Fusion-style CPS). */
export function tryExtractCpsLabel(text: string): string | undefined {
  const lines = text.split(/\r?\n/).slice(0, 48)
  for (const line of lines) {
    const comment = line.match(/^\s*\/\/\s*(.+?)\s*$/)
    const c = comment?.[1]?.trim()
    if (c) return c.slice(0, 120)
  }
  for (const line of lines) {
    const dq = line.match(/^\s*description\s*=\s*"([^"]*)"/)
    if (dq?.[1] != null) { const t = dq[1].trim(); if (t) return t.slice(0, 120) }
    const sq = line.match(/^\s*description\s*=\s*'([^']*)'/)
    if (sq?.[1] != null) { const t = sq[1].trim(); if (t) return t.slice(0, 120) }
  }
  return undefined
}

function sanitizeMachineIdFromBasename(fileBasename: string): string {
  const s = fileBasename
    .replace(/\.cps$/i, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase()
  return s.length > 0 ? s : `cps_import_${Date.now()}`
}

function titleishFromBase(base: string): string {
  const raw = base.replace(/\.cps$/i, '').replace(/[_-]+/g, ' ').trim()
  if (!raw) return 'Imported CPS post'
  return raw.replace(/\b\w/g, (c) => c.toUpperCase())
}

// ── Field extraction ───────────────────────────────────────────────────────────

/**
 * Detect the closest dialect supported by the app from the CPS filename/content.
 *
 * Supported dialects: 'grbl' | 'mach3' | 'mach3_4axis' | 'generic_mm' | 'grbl_4axis'
 *   | 'fanuc_4axis' | 'linuxcnc_4axis' | 'siemens_4axis' | 'heidenhain_4axis'
 *
 * Mapping:
 *   Fanuc, Haas, Okuma, Mazak, Mitsubishi → fanuc_4axis (4-axis) or generic_mm (3-axis)
 *   Siemens, Sinumerik → siemens_4axis (4-axis) or siemens (3-axis)
 *   Heidenhain → heidenhain_4axis (4-axis) or heidenhain (3-axis)
 *   Mach3, Mach4, Centroid, UCCNC → mach3_4axis (4-axis) or mach3 (3-axis)
 *   LinuxCNC → linuxcnc_4axis (4-axis) or grbl (3-axis)
 *   GRBL → grbl_4axis (4-axis) or grbl (3-axis)
 *   Default → grbl_4axis (4-axis) or grbl (3-axis)
 */
function detectDialect(
  basename: string,
  cpsText: string,
  axisCount: number
): MachineProfile['dialect'] {
  const hay = (basename + ' ' + cpsText.slice(0, 4000)).toLowerCase()

  const isFanuc = /fanuc|haas|okuma|mazak|mitsubishi/.test(hay)
  const isSiemens = /siemens|sinumerik/.test(hay)
  const isHeidenhain = /heidenhain/.test(hay)
  const isGenericMm = /hurco|fagor|fidia|deckel|dmg|doosan|cincinnati|fadal/.test(hay)
  const isMach = /mach3|mach4|centroid|uccnc|mach\s*3|mach\s*4/.test(hay)
  const isGrbl = /\bgrbl\b|linuxcnc|linux\s*cnc|estlcam|openbuilds/.test(hay)

  if (isFanuc) return axisCount >= 4 ? 'fanuc_4axis' : 'generic_mm'
  if (isSiemens) return axisCount >= 4 ? 'siemens_4axis' : 'siemens'
  if (isHeidenhain) return axisCount >= 4 ? 'heidenhain_4axis' : 'heidenhain'
  if (isGenericMm) return 'generic_mm'
  if (isMach) return axisCount >= 4 ? 'mach3_4axis' : 'mach3'
  if (isGrbl) {
    if (axisCount >= 4 && /linuxcnc|linux\s*cnc/.test(hay)) return 'linuxcnc_4axis'
    return axisCount >= 4 ? 'grbl_4axis' : 'grbl'
  }
  return axisCount >= 4 ? 'grbl_4axis' : 'grbl'
}

/**
 * Extract the maximum feed rate (mm/min) from the CPS text.
 * Looks for `maximumFeedrate`, properties entries, or `maxFeedrate`.
 * Returns undefined if not found.
 */
function extractMaxFeedMmMin(cpsText: string): number | undefined {
  // Direct top-level variable: maximumFeedrate = 10000;
  const direct = cpsText.match(/\bmaximumFeedrate\s*=\s*(\d+(?:\.\d+)?)/)
  if (direct) return +direct[1]

  // Inside properties block: maximumFeedrate: { ... value: 10000 ... }
  const propBlock = cpsText.match(/\bmaximumFeedrate\b[\s\S]{0,200}?value\s*:\s*(\d+(?:\.\d+)?)/)
  if (propBlock) return +propBlock[1]

  // maxFeedrate alias
  const alias = cpsText.match(/\bmaxFeedrate\s*=\s*(\d+(?:\.\d+)?)/)
  if (alias) return +alias[1]

  return undefined
}

/**
 * Extract spindle RPM limits from the CPS text.
 */
function extractSpindleRpm(cpsText: string): { min?: number; max?: number } {
  const maxMatch = cpsText.match(/\bmaximumSpindleSpeed\s*=\s*(\d+(?:\.\d+)?)/)
    ?? cpsText.match(/\bmaxSpindleSpeed\s*=\s*(\d+(?:\.\d+)?)/)
  const minMatch = cpsText.match(/\bminimumSpindleSpeed\s*=\s*(\d+(?:\.\d+)?)/)
    ?? cpsText.match(/\bminSpindleSpeed\s*=\s*(\d+(?:\.\d+)?)/)

  return {
    max: maxMatch ? +maxMatch[1] : undefined,
    min: minMatch ? +minMatch[1] : undefined
  }
}

/**
 * Detect axis count by looking for A/B/C axis output declarations,
 * useAAxis/useBAxis property references, or rotaryAxes mentions.
 *
 * Returns 3, 4, or 5.
 */
function detectAxisCount(cpsText: string): number {
  const hay = cpsText.slice(0, 12000)

  // Strong signals for 5-axis
  const has5axis = /\b5.axis\b|five.axis|\bBOutput\b|\bbOutput\b|b\s*axis|\bhasB\b|\buseBAxis\b/i.test(hay)
  if (has5axis) return 5

  // 4-axis signals: A axis output, useAAxis property, rotaryAxes reference
  const has4axis = /\b4.axis\b|four.axis|\baOutput\b|\baAxis\b|\bhasA\b|\buseAAxis\b|\bcAxisMode\b|rotaryAxes|fourth.axis|a.axis.feed/i.test(hay)
  if (has4axis) return 4

  return 3
}

/**
 * Detect whether the CPS file uses inch units (returns true) vs metric (returns false).
 * Defaults to metric when ambiguous.
 */
function detectInchUnits(cpsText: string): boolean {
  const hay = cpsText.slice(0, 4000)
  const inch = /\bUNIT_INCH\b|\binch\b|\bin\.\b/.test(hay)
  const mm   = /\bUNIT_MM\b|\bmm\b/.test(hay)
  if (inch && !mm) return true
  return false
}

/**
 * Try to extract work area from machineConfiguration calls or xAxis/yAxis/zAxis max declarations.
 * Returns dimensions in mm. Returns undefined if nothing reliable found.
 */
/** Extract travel span from a setRange(min, max) pattern — handles negative-to-0 Z ranges */
function spanFromSetRange(text: string, axis: 'x' | 'y' | 'z'): number | undefined {
  const re = new RegExp(
    axis + 'Axis\\s*\\.?\\s*setRange\\s*\\(?\\s*(-?[\\d.]+)\\s*,\\s*(-?[\\d.]+)\\s*\\)?'
  )
  const m = text.match(re)
  if (!m) return undefined
  const lo = +m[1], hi = +m[2]
  const span = Math.abs(hi - lo)
  return span > 0 ? span : undefined
}

function extractWorkAreaMm(
  cpsText: string,
  useInch: boolean
): { x: number; y: number; z: number } | undefined {
  const toMm = (v: number) => useInch ? Math.round(v * 25.4) : Math.round(v)

  // Try xAxis.setRange(min, max) pattern first — compute travel span
  const xs = spanFromSetRange(cpsText, 'x')
  const ys = spanFromSetRange(cpsText, 'y')
  const zs = spanFromSetRange(cpsText, 'z')

  if (xs && ys && zs) {
    const x = toMm(xs), y = toMm(ys), z = toMm(zs)
    if (x > 10 && y > 10 && z > 10) return { x, y, z }
  }

  // Try variable declarations: var xAxisMaximum = 600;
  const xv = cpsText.match(/x[Aa]xis[Mm]ax(?:imum)?\s*=\s*([\d.]+)/)
  const yv = cpsText.match(/y[Aa]xis[Mm]ax(?:imum)?\s*=\s*([\d.]+)/)
  const zv = cpsText.match(/z[Aa]xis[Mm]ax(?:imum)?\s*=\s*([\d.]+)/)

  if (xv && yv && zv) {
    const x = toMm(+xv[1]), y = toMm(+yv[1]), z = toMm(+zv[1])
    if (x > 10 && y > 10 && z > 10) return { x, y, z }
  }

  return undefined
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Build a valid `MachineProfile` stub from a Fusion `.cps` post file.
 * Unified Fab does not execute CPS posts — this creates a machine configuration
 * stub that can be further edited in the Library.
 */
export function machineProfileFromCpsContent(fileBasename: string, cpsText: string): MachineProfile {
  const id = sanitizeMachineIdFromBasename(fileBasename)
  const fromFile = tryExtractCpsLabel(cpsText)
  const nameRaw = (fromFile && fromFile.length > 0 ? fromFile : titleishFromBase(fileBasename)).trim()
  const name = nameRaw.length > 0 ? nameRaw : 'Imported CPS post'

  const useInch = detectInchUnits(cpsText)
  const axisCount = detectAxisCount(cpsText)
  const dialect = detectDialect(fileBasename, cpsText, axisCount)
  const workAreaMm = extractWorkAreaMm(cpsText, useInch) ?? CPS_STUB_DEFAULTS.workAreaMm

  const rawFeed = extractMaxFeedMmMin(cpsText)
  const maxFeedMmMin = rawFeed
    ? (useInch ? Math.round(rawFeed * 25.4) : rawFeed)
    : CPS_STUB_DEFAULTS.maxFeedMmMin

  const spindleRpm = extractSpindleRpm(cpsText)

  // Pick post template by dialect.
  //
  // The 4-axis subsystem rewrite (April 2026) collapsed all 4-axis post output
  // to the GRBL/Carvera dialect. The non-GRBL 4-axis templates were deleted but
  // the dialect enum is preserved so existing user machine profiles in
  // %APPDATA%/WorkTrackCAM/machines/ continue to load. Imported CPS files for
  // those dialects now point at `cnc_4axis_grbl.hbs` instead.
  const postTemplateMap: Record<MachineProfile['dialect'], string> = {
    grbl:            'cnc_generic_mm.hbs',
    grbl_4axis:      'cnc_4axis_grbl.hbs',
    fanuc_4axis:     'cnc_4axis_grbl.hbs',
    mach3_4axis:     'cnc_4axis_grbl.hbs',
    linuxcnc_4axis:  'cnc_4axis_grbl.hbs',
    siemens_4axis:   'cnc_4axis_grbl.hbs',
    heidenhain_4axis: 'cnc_4axis_grbl.hbs',
    mach3:           'cnc_generic_mm.hbs',
    generic_mm:      'cnc_generic_mm.hbs',
    fanuc:           'cnc_5axis_fanuc.hbs',
    siemens:         'cnc_5axis_siemens.hbs',
    heidenhain:      'cnc_generic_mm.hbs'
  }
  if (
    dialect === 'fanuc_4axis' ||
    dialect === 'mach3_4axis' ||
    dialect === 'linuxcnc_4axis' ||
    dialect === 'siemens_4axis' ||
    dialect === 'heidenhain_4axis'
  ) {
    console.warn(
      `[machine-cps-import] dialect "${dialect}" no longer has a dedicated post template; ` +
      `falling back to cnc_4axis_grbl.hbs. Output is GRBL/Carvera-compatible only.`
    )
  }

  const candidate: Omit<MachineProfile, 'meta'> & { meta: NonNullable<MachineProfile['meta']> } = {
    id,
    name,
    kind: 'cnc',
    workAreaMm,
    maxFeedMmMin,
    postTemplate: postTemplateMap[dialect],
    dialect,
    axisCount: axisCount > 3 ? axisCount : undefined,
    meta: {
      importedFromCps: true,
      cpsOriginalBasename: fileBasename,
      source: 'user',
      ...(spindleRpm.max ? { model: `Max RPM: ${spindleRpm.max}` } : {})
    }
  }

  return machineProfileSchema.parse(candidate)
}

/**
 * Summarise what was extracted from a CPS file so the UI can show the user
 * what fields were detected vs defaulted.
 */
export interface CpsImportSummary {
  profile: MachineProfile
  detected: {
    name: boolean
    workArea: boolean
    maxFeed: boolean
    dialect: boolean
    axisCount: boolean
    spindleMax?: number
  }
}

export function machineProfileWithSummaryFromCps(
  fileBasename: string,
  cpsText: string
): CpsImportSummary {
  const nameRaw = tryExtractCpsLabel(cpsText)
  const useInch = detectInchUnits(cpsText)
  const axisCount = detectAxisCount(cpsText)
  const workArea = extractWorkAreaMm(cpsText, useInch)
  const rawFeed = extractMaxFeedMmMin(cpsText)
  const spindleRpm = extractSpindleRpm(cpsText)
  const dialectHay = (fileBasename + ' ' + cpsText.slice(0, 4000)).toLowerCase()
  const dialectDetected = /fanuc|haas|okuma|mazak|mach3|mach4|grbl|linuxcnc|siemens|sinumerik|heidenhain|centroid|hurco/.test(dialectHay)

  const profile = machineProfileFromCpsContent(fileBasename, cpsText)

  return {
    profile,
    detected: {
      name: !!(nameRaw && nameRaw.length > 0),
      workArea: !!workArea,
      maxFeed: !!rawFeed,
      dialect: dialectDetected,
      axisCount: axisCount > 3,
      spindleMax: spindleRpm.max
    }
  }
}
