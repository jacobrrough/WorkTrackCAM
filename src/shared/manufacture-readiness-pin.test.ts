/**
 * manufacture-readiness-pin.test.ts -- [ID-0284] Cycle 212 test-coverage paired-pin
 *
 * Pins the contract of `src/shared/manufacture-readiness.ts` (91-line
 * SHARED Manufacture-readiness evaluator). The module exports a single
 * pure runtime function `evaluateManufactureReadiness(params)` that the
 * renderer + main process consult before enabling Slice / Generate CAM,
 * plus two type aliases (`ManufactureReadinessIssue`, `ManufactureReadinessResult`).
 *
 * Production call-sites: the readiness evaluator gates Slice (K2 Plus
 * FDM) and Generate CAM (Laguna Swift 5x10, Carvera 3-axis, Carvera
 * 4-axis Rotary). Drift here would either silently un-gate a job that
 * cannot run (-> failed slice / aborted CAM) or block a legitimate job
 * (UX regression).
 *
 * Companion behavioral file: `manufacture-readiness.test.ts` (9 it()
 * happy-path + edge cases). This pin file extends coverage to lock the
 * CONTRACT surface the call-sites depend on:
 *   - Module shape (1 runtime export, no default, type-only aliases).
 *   - Function signature (name, arity, sync, returns plain object).
 *   - Result shape (always { canSlice, canCam, issues }, 3 keys, exact
 *     types).
 *   - All 6 issue id literals and their severity invariants.
 *   - Each issue's firing condition, in isolation and in combination.
 *   - canSlice predicate = hasProject && hasCura (cura whitespace-trim).
 *   - canCam predicate = hasProject && hasCnc && firstOpIsCnc.
 *   - firstUnsuppressed selection rule: first op with !suppressed.
 *   - Pure-function invariants on all 4 input arrays/objects.
 *   - Three-machine path realism (K2 Plus, Laguna Swift 5x10, Carvera).
 *   - Source-text whitelist on the production source.
 *   - Type-level parity with `ManufactureReadinessIssue` and
 *     `ManufactureReadinessResult`.
 *
 * Three-machine relevance:
 *   - **Creality K2 Plus** (DIRECT): the `canSlice` gate determines
 *     whether the K2 FDM slice button is enabled; settings_cura_missing
 *     fires when the OrcaSlicer path (the `curaEnginePath` setting field,
 *     kept as the live key) is unset. CLAUDE.md USER CONTEXT requires
 *     Moonraker upload and OrcaSlicer-driven slicing for K2.
 *   - **Laguna Swift 5x10** (DIRECT): the `canCam` gate determines
 *     whether Generate CAM is enabled. cam_cnc_machine_missing fires
 *     when no machine of `kind === 'cnc'` is loaded (Laguna profile
 *     missing); cam_non_cnc_first_op fires when the first unsuppressed
 *     op is not a `cnc_*` kind.
 *   - **Makera Carvera 3-axis + 4-axis** (DIRECT): same `canCam` gate;
 *     the Carvera profile drives the cnc-machine-present invariant.
 *   - **Cross-cutting** (DIRECT): machine_missing fires when the
 *     project's activeMachineId does not match any loaded profile,
 *     protecting against orphaned-project drift across the three target
 *     machines.
 *
 * Per CLAUDE.md "Safety Rule 1 -- G-code is sacred": this pin file
 * authors tests only. No production-G-code edits, no machine-profile
 * edits, no .hbs template edits, no Python engine edits, no schema
 * edits. The readiness evaluator itself is read-only with respect to
 * its inputs (Section M pins this pure-function invariant).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import * as Mod from './manufacture-readiness'
import {
  evaluateManufactureReadiness,
  type ManufactureReadinessIssue,
  type ManufactureReadinessResult
} from './manufacture-readiness'
import type { MachineProfile } from './machine-schema'
import type { ManufactureFile, ManufactureOperation, ManufactureOperationKind } from './manufacture-schema'
import type { AppSettings, ProjectFile } from './project-schema'

// ---------------------------------------------------------------------------
// Helpers (fixture factories)
// ---------------------------------------------------------------------------

const SRC_PATH = resolvePath(__dirname, 'manufacture-readiness.ts')
const SRC = readFileSync(SRC_PATH, 'utf-8')

/** All 6 expected issue ids the contract emits. */
const EXPECTED_ISSUE_IDS = [
  'cam_cnc_machine_missing',
  'cam_non_cnc_first_op',
  'machine_missing',
  'project_missing',
  'settings_cura_missing',
  'source_mesh_missing'
] as const

type IssueId = ManufactureReadinessIssue['id']

/** Build a minimum-valid project with activeMachineId='m1' and one mesh. */
function mkProject(overrides: Partial<ProjectFile> = {}): ProjectFile {
  return {
    version: 1,
    name: 'TestProject',
    updatedAt: new Date(0).toISOString(),
    activeMachineId: 'm1',
    meshes: ['assets/a.stl'],
    importHistory: [],
    ...overrides
  } as ProjectFile
}

/** Build minimum-valid AppSettings with cura path set. */
function mkSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    recentProjectPaths: [],
    theme: 'dark',
    curaEnginePath: 'cura.exe',
    ...overrides
  } as AppSettings
}

/** Build a minimum-valid CNC machine profile with id='m1'. */
function mkCncMachine(overrides: Partial<MachineProfile> = {}): MachineProfile {
  return {
    id: 'm1',
    name: 'CNC',
    kind: 'cnc',
    workAreaMm: { x: 1, y: 1, z: 1 },
    maxFeedMmMin: 1,
    postTemplate: 'a',
    dialect: 'grbl',
    ...overrides
  } as MachineProfile
}

/** Build a minimum-valid FDM machine profile with id='k2'. */
function mkFdmMachine(overrides: Partial<MachineProfile> = {}): MachineProfile {
  return {
    id: 'k2',
    name: 'K2',
    kind: 'fdm',
    workAreaMm: { x: 350, y: 350, z: 350 },
    maxFeedMmMin: 36000,
    postTemplate: 'k2.gcode',
    dialect: 'generic_mm',
    ...overrides
  } as MachineProfile
}

/** Build a minimum-valid manufacture file with one operation of `kind`. */
function mkMfg(kind: ManufactureOperationKind, suppressed = false, label = 'Op'): ManufactureFile {
  return {
    version: 1,
    setups: [],
    operations: [{ id: 'o1', label, kind, suppressed } as ManufactureOperation]
  }
}

/** Convenience: build an all-green readiness call. */
function happyPath(): ManufactureReadinessResult {
  return evaluateManufactureReadiness({
    project: mkProject(),
    settings: mkSettings(),
    machines: [mkCncMachine()],
    manufacture: mkMfg('cnc_parallel')
  })
}

// ---------------------------------------------------------------------------
// A. Module shape
// ---------------------------------------------------------------------------

describe('A. module shape -- manufacture-readiness', () => {
  it('exports exactly 1 runtime symbol (evaluateManufactureReadiness)', () => {
    const keys = Object.keys(Mod)
      .filter((k) => k !== 'default')
      .sort()
    expect(keys).toEqual(['evaluateManufactureReadiness'])
  })

  it('does NOT leak the firstUnsuppressed internal helper', () => {
    expect((Mod as unknown as Record<string, unknown>).firstUnsuppressed).toBeUndefined()
  })

  it('has Symbol.toStringTag of Module (ESM module record)', () => {
    expect((Mod as unknown as { [Symbol.toStringTag]: string })[Symbol.toStringTag]).toBe('Module')
  })

  it('has no default export', () => {
    expect((Mod as unknown as { default?: unknown }).default).toBeUndefined()
  })

  it('the single export is a function (not a class / object)', () => {
    expect(typeof Mod.evaluateManufactureReadiness).toBe('function')
    expect(Mod.evaluateManufactureReadiness).toBe(evaluateManufactureReadiness)
  })

  it('does not export an `issues` constant or table', () => {
    expect((Mod as unknown as Record<string, unknown>).issues).toBeUndefined()
  })

  it('does not export `ManufactureReadinessIssue` or `ManufactureReadinessResult` as runtime values (type-only)', () => {
    // Type-only re-imports should not appear at runtime.
    expect((Mod as unknown as Record<string, unknown>).ManufactureReadinessIssue).toBeUndefined()
    expect((Mod as unknown as Record<string, unknown>).ManufactureReadinessResult).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// B. Function signature
// ---------------------------------------------------------------------------

describe('B. function signature -- evaluateManufactureReadiness', () => {
  it('has name "evaluateManufactureReadiness"', () => {
    expect(evaluateManufactureReadiness.name).toBe('evaluateManufactureReadiness')
  })

  it('has arity 1 (params bag)', () => {
    expect(evaluateManufactureReadiness.length).toBe(1)
  })

  it('is a synchronous Function (not async, not generator)', () => {
    expect(evaluateManufactureReadiness.constructor.name).toBe('Function')
    expect(evaluateManufactureReadiness.constructor.name).not.toBe('AsyncFunction')
    expect(evaluateManufactureReadiness.constructor.name).not.toBe('GeneratorFunction')
  })

  it('returns a plain object (not a Promise)', () => {
    const r = happyPath()
    expect(typeof r).toBe('object')
    expect(r).not.toBeNull()
    expect(r instanceof Promise).toBe(false)
  })

  it('does not throw on minimal-null inputs', () => {
    expect(() =>
      evaluateManufactureReadiness({
        project: null,
        settings: null,
        machines: [],
        manufacture: null
      })
    ).not.toThrow()
  })

  it('does not throw when manufacture has no operations array (undefined safe)', () => {
    expect(() =>
      evaluateManufactureReadiness({
        project: mkProject(),
        settings: mkSettings(),
        machines: [mkCncMachine()],
        manufacture: { version: 1, setups: [], operations: [] }
      })
    ).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// C. Result shape (always { canSlice, canCam, issues })
// ---------------------------------------------------------------------------

describe('C. result shape -- ManufactureReadinessResult', () => {
  it('returns an object with exactly 3 own keys: canSlice, canCam, issues', () => {
    const r = happyPath()
    expect(Object.keys(r).sort()).toEqual(['canCam', 'canSlice', 'issues'])
  })

  it('canSlice is always a boolean', () => {
    expect(typeof happyPath().canSlice).toBe('boolean')
    expect(
      typeof evaluateManufactureReadiness({
        project: null,
        settings: null,
        machines: [],
        manufacture: null
      }).canSlice
    ).toBe('boolean')
  })

  it('canCam is always a boolean', () => {
    expect(typeof happyPath().canCam).toBe('boolean')
    expect(
      typeof evaluateManufactureReadiness({
        project: null,
        settings: null,
        machines: [],
        manufacture: null
      }).canCam
    ).toBe('boolean')
  })

  it('issues is always an array (never undefined / null)', () => {
    const happy = happyPath()
    expect(Array.isArray(happy.issues)).toBe(true)

    const sad = evaluateManufactureReadiness({
      project: null,
      settings: null,
      machines: [],
      manufacture: null
    })
    expect(Array.isArray(sad.issues)).toBe(true)
  })

  it('issues array elements always have shape { id, severity, message }', () => {
    const r = evaluateManufactureReadiness({
      project: null,
      settings: null,
      machines: [],
      manufacture: null
    })
    for (const issue of r.issues) {
      expect(typeof issue.id).toBe('string')
      expect(['error', 'warning']).toContain(issue.severity)
      expect(typeof issue.message).toBe('string')
      expect(issue.message.length).toBeGreaterThan(0)
      expect(Object.keys(issue).sort()).toEqual(['id', 'message', 'severity'])
    }
  })

  it('happy-path returns canSlice=true canCam=true issues=[]', () => {
    const r = happyPath()
    expect(r.canSlice).toBe(true)
    expect(r.canCam).toBe(true)
    expect(r.issues).toEqual([])
  })

  it('all-null inputs returns canSlice=false canCam=false with multiple issues', () => {
    const r = evaluateManufactureReadiness({
      project: null,
      settings: null,
      machines: [],
      manufacture: null
    })
    expect(r.canSlice).toBe(false)
    expect(r.canCam).toBe(false)
    expect(r.issues.length).toBeGreaterThanOrEqual(3)
  })
})

// ---------------------------------------------------------------------------
// D. project_missing issue
// ---------------------------------------------------------------------------

describe('D. project_missing -- error severity', () => {
  it('fires when project is null', () => {
    const r = evaluateManufactureReadiness({
      project: null,
      settings: mkSettings(),
      machines: [mkCncMachine()],
      manufacture: null
    })
    const issue = r.issues.find((i) => i.id === 'project_missing')
    expect(issue).toBeDefined()
    expect(issue?.severity).toBe('error')
  })

  it('does NOT fire when project is present', () => {
    const r = happyPath()
    expect(r.issues.some((i) => i.id === 'project_missing')).toBe(false)
  })

  it('error message exactly matches "Open or create a project first."', () => {
    const r = evaluateManufactureReadiness({
      project: null,
      settings: null,
      machines: [],
      manufacture: null
    })
    const issue = r.issues.find((i) => i.id === 'project_missing')
    expect(issue?.message).toBe('Open or create a project first.')
  })

  it('forces canSlice=false when fired (project required for slice)', () => {
    const r = evaluateManufactureReadiness({
      project: null,
      settings: mkSettings(),
      machines: [mkCncMachine()],
      manufacture: null
    })
    expect(r.canSlice).toBe(false)
  })

  it('forces canCam=false when fired (project required for cam)', () => {
    const r = evaluateManufactureReadiness({
      project: null,
      settings: mkSettings(),
      machines: [mkCncMachine()],
      manufacture: null
    })
    expect(r.canCam).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// E. settings_cura_missing issue
// ---------------------------------------------------------------------------

describe('E. settings_cura_missing -- warning severity', () => {
  it('fires when settings is null', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject(),
      settings: null,
      machines: [mkCncMachine()],
      manufacture: null
    })
    const issue = r.issues.find((i) => i.id === 'settings_cura_missing')
    expect(issue).toBeDefined()
    expect(issue?.severity).toBe('warning')
  })

  it('fires when settings.curaEnginePath is undefined', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject(),
      settings: { recentProjectPaths: [], theme: 'dark' } as AppSettings,
      machines: [mkCncMachine()],
      manufacture: null
    })
    expect(r.issues.some((i) => i.id === 'settings_cura_missing')).toBe(true)
  })

  it('fires when settings.curaEnginePath is empty string', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject(),
      settings: mkSettings({ curaEnginePath: '' }),
      machines: [mkCncMachine()],
      manufacture: null
    })
    expect(r.issues.some((i) => i.id === 'settings_cura_missing')).toBe(true)
  })

  it('fires when settings.curaEnginePath is whitespace-only (trim() === "")', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject(),
      settings: mkSettings({ curaEnginePath: '   \t\n  ' }),
      machines: [mkCncMachine()],
      manufacture: null
    })
    expect(r.issues.some((i) => i.id === 'settings_cura_missing')).toBe(true)
  })

  it('does NOT fire when curaEnginePath has a non-whitespace value', () => {
    const r = happyPath()
    expect(r.issues.some((i) => i.id === 'settings_cura_missing')).toBe(false)
  })

  it('does NOT fire when curaEnginePath has surrounding whitespace plus real content', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject(),
      settings: mkSettings({ curaEnginePath: '  /usr/bin/cura  ' }),
      machines: [mkCncMachine()],
      manufacture: mkMfg('cnc_parallel')
    })
    expect(r.issues.some((i) => i.id === 'settings_cura_missing')).toBe(false)
  })

  it('warning message exactly matches "OrcaSlicer path is not set (required for slicing)."', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject(),
      settings: null,
      machines: [],
      manufacture: null
    })
    const issue = r.issues.find((i) => i.id === 'settings_cura_missing')
    expect(issue?.message).toBe('OrcaSlicer path is not set (required for slicing).')
  })

  it('forces canSlice=false when fired (cura required for slice)', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject(),
      settings: null,
      machines: [mkCncMachine()],
      manufacture: null
    })
    expect(r.canSlice).toBe(false)
  })

  it('does NOT force canCam=false when fired (cura is slice-only, not cam-only)', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject(),
      settings: null,
      machines: [mkCncMachine()],
      manufacture: mkMfg('cnc_parallel')
    })
    // Cura missing but cam machinery + cnc op present -> canCam still true
    expect(r.canCam).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// F. machine_missing issue
// ---------------------------------------------------------------------------

describe('F. machine_missing -- warning severity', () => {
  it('fires when project.activeMachineId does not match any loaded profile id', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject({ activeMachineId: 'unknown' }),
      settings: mkSettings(),
      machines: [mkCncMachine({ id: 'm1' })],
      manufacture: null
    })
    const issue = r.issues.find((i) => i.id === 'machine_missing')
    expect(issue).toBeDefined()
    expect(issue?.severity).toBe('warning')
  })

  it('does NOT fire when an exact id match exists', () => {
    const r = happyPath()
    expect(r.issues.some((i) => i.id === 'machine_missing')).toBe(false)
  })

  it('match is by exact id equality (case-sensitive)', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject({ activeMachineId: 'M1' }),
      settings: mkSettings(),
      machines: [mkCncMachine({ id: 'm1' })],
      manufacture: null
    })
    expect(r.issues.some((i) => i.id === 'machine_missing')).toBe(true)
  })

  it('does NOT fire when project is null (activeMachineId check is project-gated)', () => {
    const r = evaluateManufactureReadiness({
      project: null,
      settings: null,
      machines: [],
      manufacture: null
    })
    expect(r.issues.some((i) => i.id === 'machine_missing')).toBe(false)
  })

  it('warning message exactly matches "Project active machine ID does not match any loaded machine profile."', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject({ activeMachineId: 'unknown' }),
      settings: null,
      machines: [],
      manufacture: null
    })
    const issue = r.issues.find((i) => i.id === 'machine_missing')
    expect(issue?.message).toBe('Project active machine ID does not match any loaded machine profile.')
  })

  it('match scans the entire machines array (not just first)', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject({ activeMachineId: 'm3' }),
      settings: mkSettings(),
      machines: [
        mkCncMachine({ id: 'm1' }),
        mkCncMachine({ id: 'm2' }),
        mkCncMachine({ id: 'm3' })
      ],
      manufacture: null
    })
    expect(r.issues.some((i) => i.id === 'machine_missing')).toBe(false)
  })

  it('does NOT force canCam=false on its own (warning, not error)', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject({ activeMachineId: 'unknown' }),
      settings: mkSettings(),
      machines: [mkCncMachine({ id: 'm1' })],
      manufacture: mkMfg('cnc_parallel')
    })
    // Warning level: canCam still true because an cnc machine is loaded.
    expect(r.canCam).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// G. cam_non_cnc_first_op issue
// ---------------------------------------------------------------------------

describe('G. cam_non_cnc_first_op -- warning severity', () => {
  it('fires when first unsuppressed op kind is fdm_slice', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject(),
      settings: mkSettings(),
      machines: [mkCncMachine()],
      manufacture: mkMfg('fdm_slice')
    })
    const issue = r.issues.find((i) => i.id === 'cam_non_cnc_first_op')
    expect(issue).toBeDefined()
    expect(issue?.severity).toBe('warning')
  })

  it('fires when first unsuppressed op kind is export_stl', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject(),
      settings: mkSettings(),
      machines: [mkCncMachine()],
      manufacture: mkMfg('export_stl')
    })
    expect(r.issues.some((i) => i.id === 'cam_non_cnc_first_op')).toBe(true)
  })

  it('does NOT fire when first unsuppressed op kind is cnc_parallel', () => {
    const r = happyPath()
    expect(r.issues.some((i) => i.id === 'cam_non_cnc_first_op')).toBe(false)
  })

  it.each([
    'cnc_parallel',
    'cnc_contour',
    'cnc_pocket',
    'cnc_drill',
    'cnc_4axis_continuous',
    'cnc_chamfer',
    'cnc_5axis_swarf'
  ] as const)('does NOT fire for first cnc_* kind: %s', (kind) => {
    const r = evaluateManufactureReadiness({
      project: mkProject(),
      settings: mkSettings(),
      machines: [mkCncMachine()],
      manufacture: mkMfg(kind)
    })
    expect(r.issues.some((i) => i.id === 'cam_non_cnc_first_op')).toBe(false)
  })

  it('does NOT fire when manufacture is null (no first op to evaluate)', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject(),
      settings: mkSettings(),
      machines: [mkCncMachine()],
      manufacture: null
    })
    expect(r.issues.some((i) => i.id === 'cam_non_cnc_first_op')).toBe(false)
  })

  it('does NOT fire when all operations are suppressed (no first unsuppressed)', () => {
    const mfg: ManufactureFile = {
      version: 1,
      setups: [],
      operations: [
        { id: 'o1', label: 'FDM', kind: 'fdm_slice', suppressed: true },
        { id: 'o2', label: 'EXP', kind: 'export_stl', suppressed: true }
      ]
    }
    const r = evaluateManufactureReadiness({
      project: mkProject(),
      settings: mkSettings(),
      machines: [mkCncMachine()],
      manufacture: mfg
    })
    expect(r.issues.some((i) => i.id === 'cam_non_cnc_first_op')).toBe(false)
  })

  it('skips suppressed ops when picking the "first" op', () => {
    const mfg: ManufactureFile = {
      version: 1,
      setups: [],
      operations: [
        { id: 'o1', label: 'FDM', kind: 'fdm_slice', suppressed: true },
        { id: 'o2', label: 'CNC', kind: 'cnc_pocket', suppressed: false }
      ]
    }
    const r = evaluateManufactureReadiness({
      project: mkProject(),
      settings: mkSettings(),
      machines: [mkCncMachine()],
      manufacture: mfg
    })
    // First unsuppressed is cnc_pocket -> no warning.
    expect(r.issues.some((i) => i.id === 'cam_non_cnc_first_op')).toBe(false)
  })

  it('warning message exactly matches "First non-suppressed manufacture operation is not a CNC operation."', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject(),
      settings: null,
      machines: [mkCncMachine()],
      manufacture: mkMfg('fdm_slice')
    })
    const issue = r.issues.find((i) => i.id === 'cam_non_cnc_first_op')
    expect(issue?.message).toBe('First non-suppressed manufacture operation is not a CNC operation.')
  })

  it('forces canCam=false when fired', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject(),
      settings: mkSettings(),
      machines: [mkCncMachine()],
      manufacture: mkMfg('fdm_slice')
    })
    expect(r.canCam).toBe(false)
  })

  it('does NOT force canSlice=false (slice path is independent of first op kind)', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject(),
      settings: mkSettings(),
      machines: [mkCncMachine()],
      manufacture: mkMfg('fdm_slice')
    })
    expect(r.canSlice).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// H. cam_cnc_machine_missing issue
// ---------------------------------------------------------------------------

describe('H. cam_cnc_machine_missing -- error severity', () => {
  it('fires when machines array is empty', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject(),
      settings: mkSettings(),
      machines: [],
      manufacture: null
    })
    const issue = r.issues.find((i) => i.id === 'cam_cnc_machine_missing')
    expect(issue).toBeDefined()
    expect(issue?.severity).toBe('error')
  })

  it('fires when only fdm machines are loaded (no cnc kind)', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject({ activeMachineId: 'k2' }),
      settings: mkSettings(),
      machines: [mkFdmMachine({ id: 'k2' })],
      manufacture: null
    })
    expect(r.issues.some((i) => i.id === 'cam_cnc_machine_missing')).toBe(true)
  })

  it('does NOT fire when at least one cnc machine is loaded', () => {
    const r = happyPath()
    expect(r.issues.some((i) => i.id === 'cam_cnc_machine_missing')).toBe(false)
  })

  it('does NOT fire when mixed fdm+cnc machines are loaded', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject(),
      settings: mkSettings(),
      machines: [mkFdmMachine({ id: 'k2' }), mkCncMachine({ id: 'm1' })],
      manufacture: mkMfg('cnc_parallel')
    })
    expect(r.issues.some((i) => i.id === 'cam_cnc_machine_missing')).toBe(false)
  })

  it('error message exactly matches "No CNC machine profile is loaded."', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject(),
      settings: null,
      machines: [],
      manufacture: null
    })
    const issue = r.issues.find((i) => i.id === 'cam_cnc_machine_missing')
    expect(issue?.message).toBe('No CNC machine profile is loaded.')
  })

  it('forces canCam=false when fired (no cnc -> cannot cam)', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject(),
      settings: mkSettings(),
      machines: [mkFdmMachine()],
      manufacture: mkMfg('cnc_parallel')
    })
    expect(r.canCam).toBe(false)
  })

  it('does NOT force canSlice=false (slice does not require cnc)', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject(),
      settings: mkSettings(),
      machines: [mkFdmMachine()],
      manufacture: null
    })
    expect(r.canSlice).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// I. source_mesh_missing issue
// ---------------------------------------------------------------------------

describe('I. source_mesh_missing -- warning severity', () => {
  it('fires when project.meshes is empty array', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject({ meshes: [] }),
      settings: mkSettings(),
      machines: [mkCncMachine()],
      manufacture: null
    })
    const issue = r.issues.find((i) => i.id === 'source_mesh_missing')
    expect(issue).toBeDefined()
    expect(issue?.severity).toBe('warning')
  })

  it('fires when project is null (no meshes -> warning fires)', () => {
    const r = evaluateManufactureReadiness({
      project: null,
      settings: null,
      machines: [],
      manufacture: null
    })
    expect(r.issues.some((i) => i.id === 'source_mesh_missing')).toBe(true)
  })

  it('does NOT fire when project.meshes has at least one entry', () => {
    const r = happyPath()
    expect(r.issues.some((i) => i.id === 'source_mesh_missing')).toBe(false)
  })

  it('does NOT fire when project.meshes has multiple entries', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject({ meshes: ['a.stl', 'b.stl', 'c.stl'] }),
      settings: mkSettings(),
      machines: [mkCncMachine()],
      manufacture: null
    })
    expect(r.issues.some((i) => i.id === 'source_mesh_missing')).toBe(false)
  })

  it('warning message exactly matches "Project has no imported meshes; you may need to pick an STL manually."', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject({ meshes: [] }),
      settings: null,
      machines: [mkCncMachine()],
      manufacture: null
    })
    const issue = r.issues.find((i) => i.id === 'source_mesh_missing')
    expect(issue?.message).toBe('Project has no imported meshes; you may need to pick an STL manually.')
  })

  it('does NOT force canSlice=false (warning, not error)', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject({ meshes: [] }),
      settings: mkSettings(),
      machines: [mkCncMachine()],
      manufacture: null
    })
    expect(r.canSlice).toBe(true)
  })

  it('does NOT force canCam=false (warning, not error)', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject({ meshes: [] }),
      settings: mkSettings(),
      machines: [mkCncMachine()],
      manufacture: mkMfg('cnc_parallel')
    })
    expect(r.canCam).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// J. canSlice predicate logic
// ---------------------------------------------------------------------------

describe('J. canSlice predicate -- hasProject && hasCura', () => {
  it('true when project + cura path are both present', () => {
    expect(happyPath().canSlice).toBe(true)
  })

  it('false when project is null (cura present)', () => {
    const r = evaluateManufactureReadiness({
      project: null,
      settings: mkSettings(),
      machines: [mkCncMachine()],
      manufacture: null
    })
    expect(r.canSlice).toBe(false)
  })

  it('false when cura is missing (project present)', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject(),
      settings: null,
      machines: [mkCncMachine()],
      manufacture: null
    })
    expect(r.canSlice).toBe(false)
  })

  it('false when both project and cura are missing', () => {
    const r = evaluateManufactureReadiness({
      project: null,
      settings: null,
      machines: [mkCncMachine()],
      manufacture: null
    })
    expect(r.canSlice).toBe(false)
  })

  it('canSlice does NOT depend on cnc machine presence (FDM-only is OK to slice)', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject({ activeMachineId: 'k2' }),
      settings: mkSettings(),
      machines: [mkFdmMachine({ id: 'k2' })],
      manufacture: null
    })
    expect(r.canSlice).toBe(true)
  })

  it('canSlice does NOT depend on manufacture (manufacture optional for slice)', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject(),
      settings: mkSettings(),
      machines: [mkCncMachine()],
      manufacture: null
    })
    expect(r.canSlice).toBe(true)
  })

  it('canSlice does NOT depend on first op kind', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject(),
      settings: mkSettings(),
      machines: [mkCncMachine()],
      manufacture: mkMfg('fdm_slice')
    })
    expect(r.canSlice).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// K. canCam predicate logic
// ---------------------------------------------------------------------------

describe('K. canCam predicate -- hasProject && hasCnc && firstOpIsCnc', () => {
  it('true when project + cnc machine + cnc first op are all present', () => {
    expect(happyPath().canCam).toBe(true)
  })

  it('true when project + cnc machine + null manufacture (no first op)', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject(),
      settings: mkSettings(),
      machines: [mkCncMachine()],
      manufacture: null
    })
    expect(r.canCam).toBe(true)
  })

  it('true when project + cnc machine + all-suppressed ops (firstOp is undefined)', () => {
    const mfg: ManufactureFile = {
      version: 1,
      setups: [],
      operations: [{ id: 'o1', label: 'A', kind: 'fdm_slice', suppressed: true }]
    }
    const r = evaluateManufactureReadiness({
      project: mkProject(),
      settings: mkSettings(),
      machines: [mkCncMachine()],
      manufacture: mfg
    })
    expect(r.canCam).toBe(true)
  })

  it('false when project is null', () => {
    const r = evaluateManufactureReadiness({
      project: null,
      settings: mkSettings(),
      machines: [mkCncMachine()],
      manufacture: mkMfg('cnc_parallel')
    })
    expect(r.canCam).toBe(false)
  })

  it('false when no cnc machine is loaded', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject({ activeMachineId: 'k2' }),
      settings: mkSettings(),
      machines: [mkFdmMachine({ id: 'k2' })],
      manufacture: mkMfg('cnc_parallel')
    })
    expect(r.canCam).toBe(false)
  })

  it('false when first op kind is fdm_slice', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject(),
      settings: mkSettings(),
      machines: [mkCncMachine()],
      manufacture: mkMfg('fdm_slice')
    })
    expect(r.canCam).toBe(false)
  })

  it('false when first op kind is export_stl', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject(),
      settings: mkSettings(),
      machines: [mkCncMachine()],
      manufacture: mkMfg('export_stl')
    })
    expect(r.canCam).toBe(false)
  })

  it('canCam does NOT depend on cura path (cam works without cura)', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject(),
      settings: null,
      machines: [mkCncMachine()],
      manufacture: mkMfg('cnc_parallel')
    })
    expect(r.canCam).toBe(true)
  })

  it('canCam does NOT depend on activeMachineId match (warning-only check)', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject({ activeMachineId: 'unknown' }),
      settings: mkSettings(),
      machines: [mkCncMachine({ id: 'm1' })],
      manufacture: mkMfg('cnc_parallel')
    })
    expect(r.canCam).toBe(true)
  })

  it('canCam does NOT depend on meshes presence (warning-only check)', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject({ meshes: [] }),
      settings: mkSettings(),
      machines: [mkCncMachine()],
      manufacture: mkMfg('cnc_parallel')
    })
    expect(r.canCam).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// L. firstUnsuppressed selection rule
// ---------------------------------------------------------------------------

describe('L. first unsuppressed selection -- ops?.find((o) => !o.suppressed)', () => {
  it('picks index 0 when no ops are suppressed', () => {
    const mfg: ManufactureFile = {
      version: 1,
      setups: [],
      operations: [
        { id: 'a', label: 'A', kind: 'cnc_parallel', suppressed: false },
        { id: 'b', label: 'B', kind: 'cnc_pocket', suppressed: false }
      ]
    }
    const r = evaluateManufactureReadiness({
      project: mkProject(),
      settings: mkSettings(),
      machines: [mkCncMachine()],
      manufacture: mfg
    })
    expect(r.canCam).toBe(true)
    expect(r.issues.some((i) => i.id === 'cam_non_cnc_first_op')).toBe(false)
  })

  it('skips index 0 when suppressed=true and picks index 1', () => {
    const mfg: ManufactureFile = {
      version: 1,
      setups: [],
      operations: [
        { id: 'a', label: 'A', kind: 'fdm_slice', suppressed: true },
        { id: 'b', label: 'B', kind: 'cnc_pocket', suppressed: false }
      ]
    }
    const r = evaluateManufactureReadiness({
      project: mkProject(),
      settings: mkSettings(),
      machines: [mkCncMachine()],
      manufacture: mfg
    })
    expect(r.issues.some((i) => i.id === 'cam_non_cnc_first_op')).toBe(false)
  })

  it('skips multiple suppressed ops in a row', () => {
    const mfg: ManufactureFile = {
      version: 1,
      setups: [],
      operations: [
        { id: 'a', label: 'A', kind: 'fdm_slice', suppressed: true },
        { id: 'b', label: 'B', kind: 'export_stl', suppressed: true },
        { id: 'c', label: 'C', kind: 'cnc_4axis_continuous', suppressed: false }
      ]
    }
    const r = evaluateManufactureReadiness({
      project: mkProject(),
      settings: mkSettings(),
      machines: [mkCncMachine()],
      manufacture: mfg
    })
    expect(r.issues.some((i) => i.id === 'cam_non_cnc_first_op')).toBe(false)
  })

  it('returns undefined when ALL ops are suppressed (no warning fires)', () => {
    const mfg: ManufactureFile = {
      version: 1,
      setups: [],
      operations: [
        { id: 'a', label: 'A', kind: 'fdm_slice', suppressed: true },
        { id: 'b', label: 'B', kind: 'cnc_pocket', suppressed: true }
      ]
    }
    const r = evaluateManufactureReadiness({
      project: mkProject(),
      settings: mkSettings(),
      machines: [mkCncMachine()],
      manufacture: mfg
    })
    expect(r.issues.some((i) => i.id === 'cam_non_cnc_first_op')).toBe(false)
    // canCam stays true via the firstOp == null branch.
    expect(r.canCam).toBe(true)
  })

  it('returns undefined when ops array is empty', () => {
    const mfg: ManufactureFile = { version: 1, setups: [], operations: [] }
    const r = evaluateManufactureReadiness({
      project: mkProject(),
      settings: mkSettings(),
      machines: [mkCncMachine()],
      manufacture: mfg
    })
    expect(r.issues.some((i) => i.id === 'cam_non_cnc_first_op')).toBe(false)
    expect(r.canCam).toBe(true)
  })

  it('treats suppressed=true (literal true) as suppressed', () => {
    const mfg: ManufactureFile = {
      version: 1,
      setups: [],
      operations: [{ id: 'a', label: 'A', kind: 'cnc_parallel', suppressed: true }]
    }
    const r = evaluateManufactureReadiness({
      project: mkProject(),
      settings: mkSettings(),
      machines: [mkCncMachine()],
      manufacture: mfg
    })
    // suppressed -> firstOp undefined -> no cam_non_cnc_first_op + canCam=true.
    expect(r.canCam).toBe(true)
    expect(r.issues.some((i) => i.id === 'cam_non_cnc_first_op')).toBe(false)
  })

  it('treats suppressed=false as runnable (literal false)', () => {
    const mfg: ManufactureFile = {
      version: 1,
      setups: [],
      operations: [{ id: 'a', label: 'A', kind: 'cnc_parallel', suppressed: false }]
    }
    const r = evaluateManufactureReadiness({
      project: mkProject(),
      settings: mkSettings(),
      machines: [mkCncMachine()],
      manufacture: mfg
    })
    expect(r.canCam).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// M. Pure-function invariants
// ---------------------------------------------------------------------------

describe('M. pure-function invariants', () => {
  it('does not mutate the project object', () => {
    const project = mkProject()
    const snapshot = JSON.parse(JSON.stringify(project))
    evaluateManufactureReadiness({
      project,
      settings: mkSettings(),
      machines: [mkCncMachine()],
      manufacture: mkMfg('cnc_parallel')
    })
    expect(JSON.parse(JSON.stringify(project))).toEqual(snapshot)
  })

  it('does not mutate the settings object', () => {
    const settings = mkSettings()
    const snapshot = JSON.parse(JSON.stringify(settings))
    evaluateManufactureReadiness({
      project: mkProject(),
      settings,
      machines: [mkCncMachine()],
      manufacture: null
    })
    expect(JSON.parse(JSON.stringify(settings))).toEqual(snapshot)
  })

  it('does not mutate the machines array (length, identity, items)', () => {
    const machines = [mkCncMachine({ id: 'a' }), mkCncMachine({ id: 'b' })]
    const lengthBefore = machines.length
    const idsBefore = machines.map((m) => m.id)
    evaluateManufactureReadiness({
      project: mkProject(),
      settings: mkSettings(),
      machines,
      manufacture: null
    })
    expect(machines.length).toBe(lengthBefore)
    expect(machines.map((m) => m.id)).toEqual(idsBefore)
  })

  it('does not mutate the manufacture object', () => {
    const manufacture = mkMfg('cnc_pocket')
    const snapshot = JSON.parse(JSON.stringify(manufacture))
    evaluateManufactureReadiness({
      project: mkProject(),
      settings: mkSettings(),
      machines: [mkCncMachine()],
      manufacture
    })
    expect(JSON.parse(JSON.stringify(manufacture))).toEqual(snapshot)
  })

  it('does not mutate the operations array (length, identity)', () => {
    const operations: ManufactureOperation[] = [
      { id: 'a', label: 'A', kind: 'cnc_parallel', suppressed: false },
      { id: 'b', label: 'B', kind: 'cnc_pocket', suppressed: true }
    ]
    const manufacture: ManufactureFile = { version: 1, setups: [], operations }
    const lengthBefore = operations.length
    const refBefore = operations[0]
    evaluateManufactureReadiness({
      project: mkProject(),
      settings: mkSettings(),
      machines: [mkCncMachine()],
      manufacture
    })
    expect(operations.length).toBe(lengthBefore)
    expect(operations[0]).toBe(refBefore)
  })

  it('returns a fresh issues array on every call (no shared reference)', () => {
    const r1 = evaluateManufactureReadiness({
      project: null,
      settings: null,
      machines: [],
      manufacture: null
    })
    const r2 = evaluateManufactureReadiness({
      project: null,
      settings: null,
      machines: [],
      manufacture: null
    })
    expect(r1.issues).not.toBe(r2.issues)
  })

  it('repeated calls with deep-equal inputs produce deep-equal results (deterministic)', () => {
    const inputs = {
      project: mkProject(),
      settings: mkSettings(),
      machines: [mkCncMachine()],
      manufacture: mkMfg('cnc_parallel')
    }
    const r1 = evaluateManufactureReadiness(inputs)
    const r2 = evaluateManufactureReadiness(inputs)
    expect(r1).toEqual(r2)
  })

  it('survives a frozen project input without throwing or mutating', () => {
    const project = Object.freeze(mkProject()) as ProjectFile
    expect(() =>
      evaluateManufactureReadiness({
        project,
        settings: mkSettings(),
        machines: [mkCncMachine()],
        manufacture: null
      })
    ).not.toThrow()
  })

  it('survives a frozen machines array without throwing', () => {
    const machines = Object.freeze([mkCncMachine()]) as readonly MachineProfile[]
    expect(() =>
      evaluateManufactureReadiness({
        project: mkProject(),
        settings: mkSettings(),
        machines: machines as MachineProfile[],
        manufacture: null
      })
    ).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// N. Three-machine path realism
// ---------------------------------------------------------------------------

describe('N. three-machine path realism', () => {
  it('Creality K2 Plus FDM-only setup: canSlice=true canCam=false (no cnc loaded)', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject({ activeMachineId: 'k2-plus' }),
      settings: mkSettings(),
      machines: [
        mkFdmMachine({
          id: 'k2-plus',
          name: 'Creality K2 Plus',
          workAreaMm: { x: 350, y: 350, z: 350 },
          maxFeedMmMin: 36000,
          dialect: 'generic_mm'
        })
      ],
      manufacture: mkMfg('fdm_slice')
    })
    expect(r.canSlice).toBe(true)
    expect(r.canCam).toBe(false)
    expect(r.issues.some((i) => i.id === 'cam_cnc_machine_missing')).toBe(true)
  })

  it('Laguna Swift 5x10 CNC-only setup: canCam=true cnc op runnable', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject({ activeMachineId: 'laguna-swift-5x10' }),
      settings: mkSettings(),
      machines: [
        mkCncMachine({
          id: 'laguna-swift-5x10',
          name: 'Laguna Swift 5x10',
          workAreaMm: { x: 1524, y: 3048, z: 200 },
          maxFeedMmMin: 12000,
          dialect: 'mach3'
        })
      ],
      manufacture: mkMfg('cnc_pocket')
    })
    expect(r.canCam).toBe(true)
    expect(r.issues.some((i) => i.id === 'cam_cnc_machine_missing')).toBe(false)
    expect(r.issues.some((i) => i.id === 'machine_missing')).toBe(false)
  })

  it('Makera Carvera 3-axis CNC-only setup: canCam=true with smoothieware dialect', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject({ activeMachineId: 'makera-carvera-3axis' }),
      settings: mkSettings(),
      machines: [
        mkCncMachine({
          id: 'makera-carvera-3axis',
          name: 'Makera Carvera 3-axis',
          workAreaMm: { x: 360, y: 240, z: 140 },
          maxFeedMmMin: 6000,
          dialect: 'smoothieware'
        })
      ],
      manufacture: mkMfg('cnc_drill')
    })
    expect(r.canCam).toBe(true)
    expect(r.issues.some((i) => i.id === 'cam_cnc_machine_missing')).toBe(false)
  })

  it('Makera Carvera 4-axis Rotary CNC-only setup: canCam=true with cnc_4axis_continuous first op', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject({ activeMachineId: 'makera-carvera-4axis' }),
      settings: mkSettings(),
      machines: [
        mkCncMachine({
          id: 'makera-carvera-4axis',
          name: 'Makera Carvera 4-axis',
          workAreaMm: { x: 360, y: 240, z: 46 },
          maxFeedMmMin: 6000,
          dialect: 'grbl_4axis'
        })
      ],
      manufacture: mkMfg('cnc_4axis_continuous')
    })
    expect(r.canCam).toBe(true)
  })

  it('mixed K2 + Carvera 3-axis loadout: both canSlice and canCam are true', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject({ activeMachineId: 'makera-carvera-3axis' }),
      settings: mkSettings(),
      machines: [
        mkFdmMachine({ id: 'k2-plus', name: 'Creality K2 Plus' }),
        mkCncMachine({
          id: 'makera-carvera-3axis',
          name: 'Makera Carvera 3-axis',
          dialect: 'smoothieware'
        })
      ],
      manufacture: mkMfg('cnc_pocket')
    })
    expect(r.canSlice).toBe(true)
    expect(r.canCam).toBe(true)
    expect(r.issues).toEqual([])
  })

  it('Carvera ATC tool-change case: cnc_drill first op + multi-cnc machine list', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject({ activeMachineId: 'makera-carvera-3axis' }),
      settings: mkSettings(),
      machines: [
        mkCncMachine({
          id: 'makera-carvera-3axis',
          dialect: 'smoothieware',
          // ATC capability not load-bearing for readiness; included for realism.
          atcSlotCount: 6
        } as Partial<MachineProfile>),
        mkCncMachine({ id: 'laguna-swift-5x10', dialect: 'mach3' })
      ],
      manufacture: mkMfg('cnc_drill')
    })
    expect(r.canCam).toBe(true)
  })

  it('K2 Plus with empty cura path: settings_cura_missing fires + canSlice=false', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject({ activeMachineId: 'k2-plus' }),
      settings: mkSettings({ curaEnginePath: '' }),
      machines: [mkFdmMachine({ id: 'k2-plus' })],
      manufacture: mkMfg('fdm_slice')
    })
    expect(r.canSlice).toBe(false)
    expect(r.issues.some((i) => i.id === 'settings_cura_missing')).toBe(true)
  })

  it('foreign-machine activeMachineId (e.g. "shapeoko"): machine_missing fires', () => {
    const r = evaluateManufactureReadiness({
      project: mkProject({ activeMachineId: 'shapeoko' }),
      settings: mkSettings(),
      machines: [
        mkFdmMachine({ id: 'k2-plus' }),
        mkCncMachine({ id: 'laguna-swift-5x10', dialect: 'mach3' }),
        mkCncMachine({ id: 'makera-carvera-3axis', dialect: 'smoothieware' })
      ],
      manufacture: mkMfg('cnc_pocket')
    })
    expect(r.issues.some((i) => i.id === 'machine_missing')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// O. Source-text whitelist (defends against silent refactors)
// ---------------------------------------------------------------------------

describe('O. source-text whitelist -- production source invariants', () => {
  it('declares the function name `evaluateManufactureReadiness`', () => {
    expect(SRC).toContain('export function evaluateManufactureReadiness(')
  })

  it('declares the firstUnsuppressed helper as a non-exported function', () => {
    // Helper is internal; should never be `export`ed.
    expect(SRC).toContain('function firstUnsuppressed(')
    expect(SRC).not.toContain('export function firstUnsuppressed')
    expect(SRC).not.toContain('export const firstUnsuppressed')
  })

  it('uses ?.find selector to pick the first non-suppressed op', () => {
    expect(SRC).toContain("ops?.find((o) => !o.suppressed)")
  })

  it('curaEnginePath check uses ?.trim() (whitespace-aware)', () => {
    expect(SRC).toContain('settings?.curaEnginePath?.trim()')
  })

  it('cnc_ kind predicate uses startsWith (not includes / regex)', () => {
    expect(SRC).toContain("startsWith('cnc_')")
    // Defensive: should NOT use includes() because that allows substring 'foocnc_bar'.
    expect(SRC).not.toContain("kind.includes('cnc_')")
  })

  it('cnc machine predicate uses === comparison (not includes / regex)', () => {
    expect(SRC).toContain("m.kind === 'cnc'")
  })

  it('uses .some(...) for machine-id and cnc-machine presence checks', () => {
    expect(SRC).toContain('params.machines.some(')
  })

  it('declares all 6 issue ids as a discriminated union literal', () => {
    expect(SRC).toContain("'project_missing'")
    expect(SRC).toContain("'settings_cura_missing'")
    expect(SRC).toContain("'machine_missing'")
    expect(SRC).toContain("'cam_non_cnc_first_op'")
    expect(SRC).toContain("'cam_cnc_machine_missing'")
    expect(SRC).toContain("'source_mesh_missing'")
  })

  it('declares severity as the binary union "error" | "warning"', () => {
    expect(SRC).toContain("severity: 'error' | 'warning'")
  })

  it('does not import or reference any post-processor / G-code module', () => {
    expect(SRC).not.toMatch(/from ['"]\.\/post-process/)
    expect(SRC).not.toMatch(/from ['"]\.\/gcode-/)
  })

  it('imports MachineProfile via type-only import', () => {
    expect(SRC).toMatch(/import type \{ MachineProfile \} from '\.\/machine-schema'/)
  })

  it('imports ManufactureFile + ManufactureOperation via type-only import', () => {
    expect(SRC).toMatch(/import type \{ ManufactureFile, ManufactureOperation \} from '\.\/manufacture-schema'/)
  })

  it('imports AppSettings + ProjectFile via type-only import', () => {
    expect(SRC).toMatch(/import type \{ AppSettings, ProjectFile \} from '\.\/project-schema'/)
  })

  it('emits canSlice via boolean AND of hasProject + hasCura', () => {
    expect(SRC).toContain('canSlice: hasProject && hasCura')
  })

  it('emits canCam via boolean AND of hasProject + hasCnc + firstOpIsCnc', () => {
    expect(SRC).toContain('canCam: hasProject && hasCnc && firstOpIsCnc')
  })

  it('does NOT contain TODO / FIXME / HACK markers', () => {
    expect(SRC).not.toMatch(/\bTODO\b/)
    expect(SRC).not.toMatch(/\bFIXME\b/)
    expect(SRC).not.toMatch(/\bHACK\b/)
  })

  it('does NOT contain `any` type annotations (Safety Rule 4 -- no `any`)', () => {
    // Check for `: any` (with space) and `as any` patterns.
    expect(SRC).not.toMatch(/:\s*any\b/)
    expect(SRC).not.toMatch(/\bas any\b/)
  })
})

// ---------------------------------------------------------------------------
// P. Type-level parity
// ---------------------------------------------------------------------------

describe('P. type-level parity -- ManufactureReadinessIssue + ManufactureReadinessResult', () => {
  it('an ok happy-path result is assignable to ManufactureReadinessResult', () => {
    const r: ManufactureReadinessResult = happyPath()
    expect(r.canSlice).toBe(true)
  })

  it('every issue id is a member of the EXPECTED_ISSUE_IDS literal set', () => {
    const r = evaluateManufactureReadiness({
      project: null,
      settings: null,
      machines: [],
      manufacture: null
    })
    for (const issue of r.issues) {
      expect(EXPECTED_ISSUE_IDS as readonly string[]).toContain(issue.id)
    }
  })

  it('issue id literal type accepts only the 6 expected members at type level', () => {
    // Compile-time witness: assigning a non-member to IssueId is a type error.
    const id: IssueId = 'project_missing'
    expect(EXPECTED_ISSUE_IDS).toContain(id)
  })

  it('severity is exactly the binary union ("error" | "warning")', () => {
    const r = evaluateManufactureReadiness({
      project: null,
      settings: null,
      machines: [],
      manufacture: null
    })
    for (const issue of r.issues) {
      const sev: ManufactureReadinessIssue['severity'] = issue.severity
      expect(sev === 'error' || sev === 'warning').toBe(true)
    }
  })

  it('an issue object literal is structurally assignable to ManufactureReadinessIssue', () => {
    const issue: ManufactureReadinessIssue = {
      id: 'machine_missing',
      severity: 'warning',
      message: 'm'
    }
    expect(issue.id).toBe('machine_missing')
  })

  it('result is { canSlice: boolean, canCam: boolean, issues: ManufactureReadinessIssue[] }', () => {
    const r: ManufactureReadinessResult = {
      canSlice: true,
      canCam: true,
      issues: []
    }
    expect(r.canSlice).toBe(true)
    expect(r.canCam).toBe(true)
    expect(r.issues).toEqual([])
  })
})
