/**
 * Carvera 4-axis end-to-end pipeline test.
 *
 * Loads the REAL bundled Carvera 4-axis machine profile
 * (`resources/machines/makera-carvera-4axis.json`) — not a synthetic test
 * double — and drives a `cnc_4axis_contour` job through `runCamPipeline`.
 * Asserts the Carvera-specific invariants that matter for running the output
 * on the actual machine without crashing it or losing the SD card file:
 *
 *   1. Posted G-code uses the Carvera 4-axis post template
 *      (`carvera_4axis.hbs`), not the generic GRBL 4-axis post.
 *   2. Program ends with `M2`, NEVER `M30` (Smoothieware would delete the
 *      file from the SD card).
 *   3. Header centers on the rotary axis via `G0 Y0` before any feed move.
 *   4. `G4 P2` spindle dwell is present after spindle-on so the DC spindle
 *      reaches commanded RPM before the first cut.
 *   5. Motion is 4-axis (X/Z/A words present) and respects the chuck +
 *      clamp-offset machinable span.
 *
 * Companion tests:
 *   - `integration.test.ts` — machine-frame contract, synthetic GRBL post
 *   - `../post-process-4axis-integration.test.ts` — post template coverage
 *     with fabricated toolpath lines (no runCamPipeline)
 *   - `../post-process-safety.test.ts` — asserts M2 for Carvera at the post
 *     layer only
 *
 * This test is the only one that proves the full cam-runner → runAxis4 →
 * carvera_4axis.hbs pipe produces a file the Carvera can actually execute.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { MachineProfile } from '../../../shared/machine-schema'
import { extractToolpathSegments4AxisFromGcode } from '../../../shared/cam-gcode-toolpath'
import { parseMachineProfileText } from '../../machines'
import { FULL_WRAP_SPLIT_DEG } from '../strategies/contour'
import { runCamPipeline } from '../../cam-runner'
import type { CamJobConfig } from '../../cam-runner'

// Hoisted above imports so the `vi.mock` factory below can close over
// `scratchDir`. See the twin comment in `integration.test.ts` — both files
// previously mocked `getEnginesRoot` to `process.cwd()`, which made
// `cam-runner` write `cam/_tmp_*.json` into the repo root on every test
// run. Cycle-4 Task-4.2 redirects those writes into a per-file tmpdir.
const { scratchDir } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted before imports
  const nodeFs = require('node:fs') as typeof import('node:fs')
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted before imports
  const nodePath = require('node:path') as typeof import('node:path')
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted before imports
  const nodeOs = require('node:os') as typeof import('node:os')
  return { scratchDir: nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'carvera-pipe-')) }
})

vi.mock('../../paths', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../paths')>()
  return {
    ...actual,
    getEnginesRoot: () => scratchDir
  }
})

const resourcesRoot = join(process.cwd(), 'resources')

// [ID-0169] perf: hoist the bundled Carvera 4-axis machine profile read+parse
// into a single beforeAll. Pre-Cycle-86 this file did the same `await
// readFile(makera-carvera-4axis.json) + parseMachineProfileText` 16 times
// (9 inline in the first describe + 7 via `loadCarvera()` in the second).
// The JSON file is read-only and the parse is deterministic, so a single
// shared snapshot is byte-identical to the per-test parses. Verification:
// post-hoist all 16 it() blocks must still pass with their existing G-code
// assertions intact (those assertions ARE the byte-equality guarantee --
// any drift in the parsed profile would surface as a regex-match failure
// against the emitted G-code from the post template).
let cachedCarveraMachine!: MachineProfile

beforeAll(async () => {
  const profileText = await readFile(
    join(resourcesRoot, 'machines/makera-carvera-4axis.json'),
    'utf-8'
  )
  cachedCarveraMachine = parseMachineProfileText(profileText, 'makera-carvera-4axis.json')
})


describe('Carvera 4-axis pipeline (real machine profile, full pipe)', () => {
  const scratch = (name: string): string => join(scratchDir, name)

  it('posts a contour groove job that is safe to run on the Carvera', async () => {
    // Load the actual bundled machine profile — same file loaded in production.
    const machine = cachedCarveraMachine

    // Sanity: we've loaded the 4-axis profile, not the 3-axis.
    expect(machine.id).toBe('makera-carvera-4axis')
    expect(machine.axisCount).toBe(4)
    expect(machine.postTemplate).toBe('carvera_4axis.hbs')
    expect(machine.dialect).toBe('grbl_4axis')

    // Partial-wrap groove at axial X = 40 on a 30 mm diameter bar.
    // Circumference = π × 30 ≈ 94.248 mm; use intermediate points at fractions
    // of the circumference so the contour sweeps ~324° (0° → 108° → 216° → 324°).
    // A true 360° destination collapses to 0° in the modal A-axis state (since
    // 0° ≡ 360°), so a partial wrap is what actually exercises A-word emission.
    const C = Math.PI * 30
    const contourPoints: [number, number][] = [
      [40, 0],
      [40, C * 0.3],
      [40, C * 0.6],
      [40, C * 0.9]
    ]

    const stockLen = 80
    const stockDia = 30
    const chuckDepth = 15
    const clampOffset = 2

    const job: CamJobConfig = {
      stlPath: scratch('carvera-unused.stl'),
      outputGcodePath: scratch('carvera-pipeline-out.nc'),
      machine,
      resourcesRoot,
      appRoot: process.cwd(),
      zPassMm: -0.5,
      stepoverMm: 1,
      feedMmMin: 400,
      plungeMmMin: 120,
      safeZMm: 25,
      pythonPath: 'python',
      operationKind: 'cnc_4axis_contour',
      operationLabel: 'groove-test',
      rotaryStockLengthMm: stockLen,
      rotaryStockDiameterMm: stockDia,
      rotaryChuckDepthMm: chuckDepth,
      rotaryClampOffsetMm: clampOffset,
      toolDiameterMm: 3.0,
      operationParams: { contourPoints },
      workCoordinateIndex: 1 // G54
    }

    const result = await runCamPipeline(job)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.usedEngine).toBe('builtin')
    const gcode = result.gcode
    expect(gcode.length).toBeGreaterThan(200)

    // ── Carvera header identifier ────────────────────────────────────────────
    // The 4-axis post template opens with a specific identifier string. If
    // this fails, we're probably running through the wrong template (e.g. the
    // generic carvera_4axis_grbl.hbs fallback).
    expect(gcode).toMatch(/;\s*Makera Carvera — 4-Axis Rotary G-code/)

    // ── Units, absolute mode, plane select ──────────────────────────────────
    expect(gcode).toMatch(/^G21\b/m)
    expect(gcode).toMatch(/^G90\b/m)
    expect(gcode).toMatch(/^G17\b/m)

    // ── WCS emitted (G54 for workCoordinateIndex: 1) ────────────────────────
    expect(gcode).toMatch(/^G54\b/m)

    // ── Rotary centering — Y must be parked at 0 before any feed move ───────
    // The 4-axis post template emits `G0 Y0` explicitly with a comment about
    // centering the tool on the rotation axis. Losing this line would drive
    // the tool off-center and miss the part (or hit the chuck jaws).
    expect(gcode).toMatch(/G0\s+Y0\b/)

    // ── Spindle-on and dwell ────────────────────────────────────────────────
    // grbl_4axis dialect default is `M3 S12000`. The 2-second dwell after is
    // critical for the Carvera's DC spindle to reach commanded RPM before the
    // first feed move — chatter and carbide chipping result if skipped.
    expect(gcode).toMatch(/M3\s+S\d+/)
    expect(gcode).toMatch(/^G4\s+P2\b/m)

    // ── Program end must be M2, NEVER M30 ───────────────────────────────────
    // M30 on Smoothieware has historically been interpreted as "delete the
    // SD card file". The Carvera post templates hard-code M2; if this test
    // fails we've regressed onto a non-Carvera template.
    expect(gcode).toMatch(/^M2\b/m)
    expect(gcode).not.toMatch(/^M30\b/m)

    // ── Spindle-off and coolant-off before program end ──────────────────────
    expect(gcode).toMatch(/^M5\b/m)
    expect(gcode).toMatch(/^M9\b/m)

    // ── Motion is actually 4-axis — X/Z/A words with A-axis sweep ───────────
    const segs = extractToolpathSegments4AxisFromGcode(gcode)
    expect(segs.length).toBeGreaterThan(0)

    const xs = segs.flatMap((s) => [s.x0, s.x1])
    const zs = segs.flatMap((s) => [s.z0, s.z1])
    const as = segs.flatMap((s) => [s.a0, s.a1])

    // X must never dip into the chuck + clamp-offset zone. machXStart =
    // chuckDepth + clampOffset = 15 + 2 = 17.
    // Allow small epsilon for rapid approach tolerance but never go negative.
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    expect(minX).toBeGreaterThanOrEqual(0 - 1e-6)
    // Rapids may retract to X=0 (park), but feed moves must respect the span.
    // Assert the machinable window is respected by checking the contour's own
    // target X (40) lies within it.
    expect(maxX).toBeLessThanOrEqual(stockLen + 5)
    expect(xs.some((x) => x >= chuckDepth + clampOffset)).toBe(true)

    // Z must stay within the machine work area z (46 mm on the Carvera 4-axis
    // profile); retract moves reach workAreaMm.z, cut moves dip to
    // stockRadius + zPassMm = 15 + (-0.5) = 14.5.
    const minZ = Math.min(...zs)
    const maxZ = Math.max(...zs)
    expect(minZ).toBeGreaterThanOrEqual(0 - 1e-6)
    expect(maxZ).toBeLessThanOrEqual(machine.workAreaMm.z + 1)
    // At least one feed move should be at cut depth (~14.5 mm radial).
    const feedZs = segs.filter((s) => s.kind === 'feed').flatMap((s) => [s.z0, s.z1])
    expect(feedZs.some((z) => z < stockDia / 2 && z > stockDia / 2 - 1)).toBe(true)

    // A axis must sweep — this is a rotary job, not a stuck 3-axis pass.
    // The contour goes from y=0 to y=π·D, which linearizes to A=0 → A=360°.
    const minA = Math.min(...as)
    const maxA = Math.max(...as)
    expect(maxA - minA).toBeGreaterThan(300) // allow slack vs exact 360°

    // ── No bad M-codes that would confuse the Carvera controller ────────────
    // M30 already checked above. Also assert no M6 (auto tool change) — in
    // 4-axis mode the ATC is unavailable because the rotary fixture occupies
    // the carousel zone, so any M6 in the output would be operator error.
    expect(gcode).not.toMatch(/\bM6\b/)
  }, 15_000)

  it('respects the chuck depth + clamp offset machinable span', async () => {
    // Two complementary checks of the X-span contract:
    //   (a) A contour that dips into the chuck zone is REJECTED up-front by
    //       the pre-generation validator. This is the chief safety gate — the
    //       engine errors rather than silently clamping, because a clamp
    //       would also change the shape of the cut.
    //   (b) A contour fully inside the span posts successfully and every feed
    //       move respects X ≥ machStart (rapids may still retract to X=0).
    const machine = cachedCarveraMachine

    const stockLen = 100
    const chuckDepth = 20
    const clampOffset = 5
    const machStart = chuckDepth + clampOffset // 25
    const C = Math.PI * 30

    // (a) Contour that dips into the chuck zone → validator rejects.
    const badContourPoints: [number, number][] = [
      [0, 0], // inside chuck zone
      [10, 0], // inside chuck zone
      [50, 0],
      [50, C * 0.9]
    ]

    const baseJob = {
      stlPath: scratch('carvera-span.stl'),
      outputGcodePath: scratch('carvera-span-out.nc'),
      machine,
      resourcesRoot,
      appRoot: process.cwd(),
      zPassMm: -0.3,
      stepoverMm: 1,
      feedMmMin: 400,
      plungeMmMin: 120,
      safeZMm: 25,
      pythonPath: 'python',
      operationKind: 'cnc_4axis_contour' as const,
      operationLabel: 'span-test',
      rotaryStockLengthMm: stockLen,
      rotaryStockDiameterMm: 30,
      rotaryChuckDepthMm: chuckDepth,
      rotaryClampOffsetMm: clampOffset,
      toolDiameterMm: 3.0
    }

    const bad = await runCamPipeline({
      ...baseJob,
      operationParams: { contourPoints: badContourPoints }
    })
    expect(bad.ok).toBe(false)
    if (!bad.ok) {
      expect(bad.error).toMatch(/machinable span/i)
    }

    // (b) Same job with a contour fully inside the span → posts cleanly.
    const okContourPoints: [number, number][] = [
      [30, 0], // right of machStart=25
      [30, C * 0.3],
      [80, C * 0.6],
      [80, C * 0.9]
    ]

    const result = await runCamPipeline({
      ...baseJob,
      operationParams: { contourPoints: okContourPoints }
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const segs = extractToolpathSegments4AxisFromGcode(result.gcode)
    // Every FEED move's X endpoint must be ≥ machStart. Rapid retracts are
    // allowed to park at X=0 (machine home), but feeds must respect the span.
    const feedXs = segs
      .filter((s) => s.kind === 'feed')
      .flatMap((s) => [s.x0, s.x1])
    expect(feedXs.length).toBeGreaterThan(0)
    for (const x of feedXs) {
      expect(x).toBeGreaterThanOrEqual(machStart - 1e-6)
    }
  }, 15_000)

  it('surfaces a chuck-collision warning when rotaryFixture is supplied with a wide chuck', async () => {
    // Third invariant: the opt-in rotary fixture sweep catches the complement
    // of the X-span validator — a contour that is past chuckDepth axially but
    // whose cut radius dives inside the chuck body's OUTER radius. On a 3-jaw
    // Carvera setup the chuck OD (~80 mm) is much larger than the stock OD
    // (30 mm); a contour at X just past machXStart will post cleanly but the
    // sweep should warn that the chuck body overlaps the cut depth.
    const machine = cachedCarveraMachine

    const stockLen = 80
    const stockDia = 30
    const chuckDepth = 15
    const clampOffset = 2
    const C = Math.PI * stockDia

    // Contour right at the axial boundary (X = machXStart + 1), sweeping rotary.
    const contourPoints: [number, number][] = [
      [chuckDepth + clampOffset + 1, 0],
      [chuckDepth + clampOffset + 1, C * 0.3],
      [chuckDepth + clampOffset + 1, C * 0.6],
      [chuckDepth + clampOffset + 1, C * 0.9]
    ]

    // On the Carvera 4th Axis HD, the CHUCK BODY (the jaw housing and motor
    // shoulder) extends further along X than the stock's clamp depth. Model
    // a 35-mm body shadow against 15 mm of stock clamp: a cut at X=18 sits
    // inside the body's axial shadow, even though the stock-level validator
    // (which uses only `rotaryChuckDepthMm + rotaryClampOffsetMm = 17`) lets
    // the contour through.
    const chuckBodyDepth = 35
    const chuckBodyOuterRadius = 40

    const result = await runCamPipeline({
      stlPath: scratch('carvera-fixture.stl'),
      outputGcodePath: scratch('carvera-fixture-out.nc'),
      machine,
      resourcesRoot,
      appRoot: process.cwd(),
      zPassMm: -0.5,
      stepoverMm: 1,
      feedMmMin: 400,
      plungeMmMin: 120,
      safeZMm: 25,
      pythonPath: 'python',
      operationKind: 'cnc_4axis_contour',
      operationLabel: 'fixture-test',
      rotaryStockLengthMm: stockLen,
      rotaryStockDiameterMm: stockDia,
      rotaryChuckDepthMm: chuckDepth,
      rotaryClampOffsetMm: clampOffset,
      toolDiameterMm: 3.0,
      operationParams: { contourPoints },
      workCoordinateIndex: 1,
      rotaryFixture: {
        chuckDepthMm: chuckBodyDepth,
        chuckOuterRadiusMm: chuckBodyOuterRadius
      }
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The cut sits at X=18, inside the chuck BODY's axial shadow (37 mm with
    // margins) and at Z=14.5 mm — well below the chuck OD-radius of 40 mm —
    // so the sweep emits a chuck warning.
    expect(result.warnings).toBeDefined()
    expect(result.warnings!.some((w) => /chuck/i.test(w))).toBe(true)
  }, 15_000)

  it('does NOT warn about the chuck when the cut is fully clear of the chuck OD', async () => {
    // Same setup, but contour is past the chuck in BOTH axes:
    //   X well past chuckDepth + toolR + margin
    //   Z cut depth is meaningful but we park the contour far enough axially
    //   that no sample ever sits inside the chuck's axial shadow.
    const machine = cachedCarveraMachine

    const stockLen = 80
    const stockDia = 30
    const chuckDepth = 15
    const clampOffset = 2
    const C = Math.PI * stockDia

    // Contour at X=50 — well outside the chuck's axial shadow.
    const contourPoints: [number, number][] = [
      [50, 0],
      [50, C * 0.3],
      [50, C * 0.6],
      [50, C * 0.9]
    ]

    const result = await runCamPipeline({
      stlPath: scratch('carvera-fixture-clear.stl'),
      outputGcodePath: scratch('carvera-fixture-clear-out.nc'),
      machine,
      resourcesRoot,
      appRoot: process.cwd(),
      zPassMm: -0.5,
      stepoverMm: 1,
      feedMmMin: 400,
      plungeMmMin: 120,
      safeZMm: 25,
      pythonPath: 'python',
      operationKind: 'cnc_4axis_contour',
      operationLabel: 'fixture-clear-test',
      rotaryStockLengthMm: stockLen,
      rotaryStockDiameterMm: stockDia,
      rotaryChuckDepthMm: chuckDepth,
      rotaryClampOffsetMm: clampOffset,
      toolDiameterMm: 3.0,
      operationParams: { contourPoints },
      workCoordinateIndex: 1,
      rotaryFixture: {
        chuckDepthMm: chuckDepth,
        chuckOuterRadiusMm: 40
      }
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const chuckWarns = (result.warnings ?? []).filter((w) => /chuck/i.test(w))
    // Rapid retracts may still pass over the chuck, but Z is always ≥ stockR
    // + zPass (cut level ~14.5) only during feeds, and feeds live at X=50
    // (well past the chuck's axial shadow of 17 = 15 + 1.5 + 0.5).
    expect(chuckWarns).toHaveLength(0)
  }, 15_000)

  // Wave 3a -- TAILSTOCK collision sweep reachable end-to-end. Before Wave 3a
  // nothing supplied a rotaryFixture WITH tailstock fields across the IPC
  // boundary (camRunPayloadSchema had no rotaryFixture key), so the tailstock
  // arm of checkRotaryFixtureCollision was dead. This pins the full path:
  // a contour cutting PAST the tailstock start, at a radial Z well inside the
  // tailstock body radius, must surface a tailstock collision warning.
  it('Wave 3a: surfaces a TAILSTOCK collision warning when rotaryFixture carries tailstock geometry', async () => {
    const machine = cachedCarveraMachine

    const stockLen = 80
    const stockDia = 30
    const chuckDepth = 15
    const clampOffset = 2
    const C = Math.PI * stockDia

    // Contour at X = 60 -- well past the chuck's axial shadow AND past the
    // tailstock start (X = 50). The feed cut sits at radial Z ~14.5 mm, deep
    // inside the 20 mm tailstock body radius.
    const contourPoints: [number, number][] = [
      [60, 0],
      [60, C * 0.3],
      [60, C * 0.6],
      [60, C * 0.9]
    ]

    const result = await runCamPipeline({
      stlPath: scratch('carvera-tailstock.stl'),
      outputGcodePath: scratch('carvera-tailstock-out.nc'),
      machine,
      resourcesRoot,
      appRoot: process.cwd(),
      zPassMm: -0.5,
      stepoverMm: 1,
      feedMmMin: 400,
      plungeMmMin: 120,
      safeZMm: 25,
      pythonPath: 'python',
      operationKind: 'cnc_4axis_contour',
      operationLabel: 'tailstock-test',
      rotaryStockLengthMm: stockLen,
      rotaryStockDiameterMm: stockDia,
      rotaryChuckDepthMm: chuckDepth,
      rotaryClampOffsetMm: clampOffset,
      toolDiameterMm: 3.0,
      operationParams: { contourPoints },
      workCoordinateIndex: 1,
      // Wave 3a: caller-supplied chuck + TAILSTOCK fixture (this is the exact
      // shape run-cam-for-op.resolveRotaryFixture assembles from a setup with
      // tailstock fields, threaded through cam:run's new rotaryFixture key).
      rotaryFixture: {
        chuckDepthMm: chuckDepth + clampOffset,
        chuckOuterRadiusMm: 46,
        tailstockStartXMm: 50,
        tailstockOuterRadiusMm: 20
      }
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The tailstock arm of the sweep must fire: a feed cut at X=60 / Z~14.5 is
    // inside the tailstock body (starts X=50, radius 20). SAFETY: this is a
    // warning only -- the emitted G-code is unchanged (post contract intact).
    expect(result.warnings).toBeDefined()
    expect(result.warnings!.some((w) => /tailstock/i.test(w))).toBe(true)

    // And the post contract is untouched: still M2 (never M30) + Y0 centering.
    expect(result.gcode).toMatch(/^M2\b/m)
    expect(result.gcode).not.toMatch(/^M30\b/m)
    expect(result.gcode).toMatch(/G0\s+Y0\b/)
  }, 15_000)

  // [ID-0008] default-on rotary-collision sweep
  // The 2026-04-24 cycle lifts the rotary fixture sweep from opt-in to
  // on-by-default whenever: the machine is a 4-axis CNC with a known
  // rotaryChuckOuterRadiusMm AND the job supplies a positive
  // rotaryChuckDepthMm. The bundled Carvera 4-axis profile sets
  // rotaryChuckOuterRadiusMm: 46 (derived from CLAUDE.md's 92 mm rotary-
  // module diameter), so any 4-axis Carvera job hits the default path
  // unless the caller supplies an explicit rotaryFixture.

  it('runs the default rotary fixture sweep when no explicit fixture is supplied — surfaces the Carvera workAreaMm.z full-retract near-miss', async () => {
    // Same Carvera profile + safe contour as the "fully clear of the chuck
    // OD" test above, but with NO explicit rotaryFixture. The default sweep
    // must run (against rotaryChuckOuterRadiusMm: 46 from the profile and
    // chuckDepthMm = 15 + 2 = 17 from the job) and SURFACE the real-world
    // near-miss the Carvera 4-axis post creates: the
    // `G0 Z{{machine.workAreaMm.z}}` retract emits G0 Z46, and the chuck
    // clearance floor on a 46 mm-radius body is 46 + toolR (1.5) + margin
    // (0.5) = 48 mm. The retract pierces the clearance envelope by 2 mm
    // while the tool is still in the chuck's axial shadow (the establishing
    // rapid from X=0 toward the contour). This pins the default-on path
    // as actually invoking checkRotaryFixtureCollision — the warning only
    // appears when the synthesized default fixture was populated from the
    // profile's rotaryChuckOuterRadiusMm.
    const machine = cachedCarveraMachine
    expect(machine.rotaryChuckOuterRadiusMm).toBe(46)

    const stockLen = 80
    const stockDia = 30
    const chuckDepth = 15
    const clampOffset = 2
    const C = Math.PI * stockDia

    const contourPoints: [number, number][] = [
      [50, 0],
      [50, C * 0.3],
      [50, C * 0.6],
      [50, C * 0.9]
    ]

    const result = await runCamPipeline({
      stlPath: scratch('carvera-default-safe.stl'),
      outputGcodePath: scratch('carvera-default-safe-out.nc'),
      machine,
      resourcesRoot,
      appRoot: process.cwd(),
      zPassMm: -0.5,
      stepoverMm: 1,
      feedMmMin: 400,
      plungeMmMin: 120,
      safeZMm: 25,
      pythonPath: 'python',
      operationKind: 'cnc_4axis_contour',
      operationLabel: 'default-sweep-safe',
      rotaryStockLengthMm: stockLen,
      rotaryStockDiameterMm: stockDia,
      rotaryChuckDepthMm: chuckDepth,
      rotaryClampOffsetMm: clampOffset,
      toolDiameterMm: 3.0,
      operationParams: { contourPoints },
      workCoordinateIndex: 1
      // No rotaryFixture — exercising the default-on path.
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Default sweep ran (chuck warnings only appear when the default
    // fixture was synthesized from machine.rotaryChuckOuterRadiusMm).
    // The near-miss must be tagged as a RAPID, not a FEED — a feed
    // warning here would mean the compliant cut at X=50 (past the axial
    // shadow) was flagged, which would be a false positive.
    const chuckWarns = (result.warnings ?? []).filter((w) => /chuck/i.test(w))
    expect(chuckWarns.length).toBeGreaterThan(0)
    expect(chuckWarns.every((w) => /rapid/i.test(w))).toBe(true)
    expect(chuckWarns.some((w) => /feed move/i.test(w))).toBe(false)
  }, 15_000)

  // [ID-0010] full-wrap contour subdivision
  // Before the fix, a two-point contour [[X, 0], [X, pi*D]] collapsed to a
  // single cutTo call with raw delta-A = 360 deg. Emitter.cutTo uses
  // shortestAngularPath, which maps 0 -> 360 to a zero delta and drops the
  // A-word -- the groove posts clean G-code but never rotates. The strategy
  // layer now subdivides any segment whose raw |delta-A| exceeds
  // FULL_WRAP_SPLIT_DEG (170 deg) so every sub-move has an unambiguous
  // shortest-path decision, and the cumulative 360 deg sweep reaches the A
  // axis. This test drives a real two-point full-wrap groove through the
  // actual Carvera profile and asserts multiple distinct A words land in the
  // posted G-code, with the final A near 360 deg.

  it('[ID-0010] full-wrap contour (two-point 0 -> pi*D) emits subdivided A-words reaching 360 deg', async () => {
    const machine = cachedCarveraMachine

    const stockLen = 80
    const stockDia = 30
    const chuckDepth = 15
    const clampOffset = 2
    const C = Math.PI * stockDia

    // Exactly the two-point contour that triggered the bug: no intermediate
    // samples, full-circumference Y span. Without [ID-0010]'s subdivision,
    // this posts G-code with zero A-words on the feed path.
    const contourPoints: [number, number][] = [
      [40, 0],
      [40, C]
    ]

    const result = await runCamPipeline({
      stlPath: scratch('carvera-fullwrap.stl'),
      outputGcodePath: scratch('carvera-fullwrap-out.nc'),
      machine,
      resourcesRoot,
      appRoot: process.cwd(),
      zPassMm: -0.5,
      stepoverMm: 1,
      feedMmMin: 400,
      plungeMmMin: 120,
      safeZMm: 25,
      pythonPath: 'python',
      operationKind: 'cnc_4axis_contour',
      operationLabel: 'fullwrap-test',
      rotaryStockLengthMm: stockLen,
      rotaryStockDiameterMm: stockDia,
      rotaryChuckDepthMm: chuckDepth,
      rotaryClampOffsetMm: clampOffset,
      toolDiameterMm: 3.0,
      operationParams: { contourPoints },
      workCoordinateIndex: 1
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    // Collect every A-word value from the posted G-code. With subdivision at
    // 170 deg, a 360 deg sweep yields ceil(360 / 170) = 3 sub-segments, so
    // we expect at least 3 distinct A samples on the feed path.
    const aLines = result.gcode.split(/\r?\n/).filter((l) => /\bA-?\d/.test(l))
    const aVals = aLines.flatMap((l) => {
      const m = l.match(/A(-?\d+(?:\.\d+)?)/)
      return m ? [parseFloat(m[1]!)] : []
    })
    expect(aVals.length).toBeGreaterThanOrEqual(3)

    // The cumulative sweep must reach the caller-requested 360 deg (within
    // the post's numeric precision -- typically 3 decimal places).
    expect(aVals.some((a) => Math.abs(a - 360) < 1e-2)).toBe(true)

    // And the machine-frame extractor must see an A sweep of roughly 360 deg
    // across the feed segments (not a 0-degree no-op).
    const segs = extractToolpathSegments4AxisFromGcode(result.gcode)
    const feedAs = segs.filter((s) => s.kind === 'feed').flatMap((s) => [s.a0, s.a1])
    expect(feedAs.length).toBeGreaterThan(0)
    const sweep = Math.max(...feedAs) - Math.min(...feedAs)
    expect(sweep).toBeGreaterThan(300)
  }, 15_000)

  it('synthesized default fixture catches a wide-chuck collision near the machinable-X start when no explicit fixture is supplied', async () => {
    // Same Carvera profile but the contour sits AT the axial boundary
    // (X = chuckDepth + clampOffset + 1 = 18). The default-on sweep
    // synthesizes chuckDepthMm = 17 and chuckOuterRadiusMm = 46 from the
    // machine profile. At that X the feed sample is inside the chuck's
    // axial shadow, and its Z sits well below the 46 mm chuck-OD clearance
    // floor, so the sweep must emit a chuck-collision warning. This pins
    // the default path as actually exercising checkRotaryFixtureCollision
    // on the FEED side of the sweep -- not only on rapids.
    const machine = cachedCarveraMachine
    expect(machine.rotaryChuckOuterRadiusMm).toBe(46)

    const stockLen = 80
    const stockDia = 30
    const chuckDepth = 15
    const clampOffset = 2
    const C = Math.PI * stockDia

    // Contour at the axial boundary, sweeping rotary.
    const contourPoints: [number, number][] = [
      [chuckDepth + clampOffset + 1, 0],
      [chuckDepth + clampOffset + 1, C * 0.3],
      [chuckDepth + clampOffset + 1, C * 0.6],
      [chuckDepth + clampOffset + 1, C * 0.9]
    ]

    const result = await runCamPipeline({
      stlPath: scratch('carvera-default-collision.stl'),
      outputGcodePath: scratch('carvera-default-collision-out.nc'),
      machine,
      resourcesRoot,
      appRoot: process.cwd(),
      zPassMm: -0.5,
      stepoverMm: 1,
      feedMmMin: 400,
      plungeMmMin: 120,
      safeZMm: 25,
      pythonPath: 'python',
      operationKind: 'cnc_4axis_contour',
      operationLabel: 'default-sweep-collision',
      rotaryStockLengthMm: stockLen,
      rotaryStockDiameterMm: stockDia,
      rotaryChuckDepthMm: chuckDepth,
      rotaryClampOffsetMm: clampOffset,
      toolDiameterMm: 3.0,
      operationParams: { contourPoints },
      workCoordinateIndex: 1
      // NO rotaryFixture -- the synthesized default uses the machine's
      // rotaryChuckOuterRadiusMm (46) to flag the crash.
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toBeDefined()
    expect(result.warnings!.some((w) => /chuck/i.test(w))).toBe(true)
  }, 15_000)

  // [ID-0010b] multi-wrap (>360 deg) end-to-end pipeline regression --
  // DISCOVERED-2026-04-25.
  // The existing [ID-0010] integration test pins a single full wrap
  // (Y span = pi*D = 360 deg). The strategy-unit tests separately pin
  // 2x and 3x wraps. This integration test pins the > 360 deg path
  // through the FULL pipe (cam-runner -> runAxis4 -> carvera_4axis.hbs
  // -> posted G-code) so any regression in the post template, the
  // emitter's absolute-angle handling, or the strategy's cumulative-A
  // interpolation is caught against the REAL bundled Carvera profile.

  it('[ID-0010b] multi-wrap contour (two-point 0 -> 2*pi*D) end-to-end emits subdivided A-words reaching 720 deg with monotonic cumulative sweep within at least one Z-pass cluster', async () => {
    const machine = cachedCarveraMachine

    const stockLen = 80
    const stockDia = 30
    const chuckDepth = 15
    const clampOffset = 2
    const C = Math.PI * stockDia

    // Two-point contour spanning two full circumferences. Without the
    // [ID-0010] subdivision, the emitter's shortestAngularPath would
    // alias 0 -> 720 deg to a zero delta and drop the A-word entirely.
    const contourPoints: [number, number][] = [
      [40, 0],
      [40, 2 * C]
    ]

    const result = await runCamPipeline({
      stlPath: scratch('carvera-multiwrap-2x.stl'),
      outputGcodePath: scratch('carvera-multiwrap-2x-out.nc'),
      machine,
      resourcesRoot,
      appRoot: process.cwd(),
      zPassMm: -0.5,
      stepoverMm: 1,
      feedMmMin: 400,
      plungeMmMin: 120,
      safeZMm: 25,
      pythonPath: 'python',
      operationKind: 'cnc_4axis_contour',
      operationLabel: 'multiwrap-2x-test',
      rotaryStockLengthMm: stockLen,
      rotaryStockDiameterMm: stockDia,
      rotaryChuckDepthMm: chuckDepth,
      rotaryClampOffsetMm: clampOffset,
      toolDiameterMm: 3.0,
      operationParams: { contourPoints },
      workCoordinateIndex: 1
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const segs = extractToolpathSegments4AxisFromGcode(result.gcode)
    const feedSegs = segs.filter((s) => s.kind === 'feed')
    // 720 / FULL_WRAP_SPLIT_DEG (170) -> 5 sub-segments per Z pass; the
    // pipeline's auto-Z-stepdown can generate multiple passes from a
    // single zPassMm input, so we expect AT LEAST 5 feed segments overall
    // (one full sweep) and accept multi-pass clustering below.
    expect(feedSegs.length).toBeGreaterThanOrEqual(5)

    // Multi-pass behavior: the strategy retracts + rotates A back to the
    // contour-start angle (0 deg here) at the head of every Z pass, so a
    // single "all feed segments are monotonic" check would falsely fail
    // when Z stepdown emits >1 pass. Instead, split feedSegs into
    // monotonic CLUSTERS at every A-reset boundary (a1 strictly less
    // than the previous segment's a1) and require AT LEAST ONE cluster
    // to sweep 0 -> 720 deg without aliasing.
    type FeedCluster = { a0: number; aMax: number; segs: typeof feedSegs }
    const clusters: FeedCluster[] = []
    let cur: FeedCluster | null = null
    let prevA1Local = -Infinity
    for (const s of feedSegs) {
      if (cur === null || s.a1 < prevA1Local - 1e-6) {
        cur = { a0: s.a0, aMax: s.a1, segs: [s] }
        clusters.push(cur)
      } else {
        cur.segs.push(s)
        cur.aMax = Math.max(cur.aMax, s.a1)
      }
      prevA1Local = s.a1
    }
    const reaches720 = clusters.find((c) => Math.abs(c.aMax - 720) < 1e-3)
    expect(reaches720).toBeDefined()
    if (!reaches720) return
    // Within the reaching cluster, A must be monotonically non-decreasing
    // and cover the full 0 -> 720 sweep (start angle is 0 because the
    // contour origin is Y=0).
    expect(Math.abs(reaches720.a0)).toBeLessThan(1e-3)
    let inner = -Infinity
    for (const s of reaches720.segs) {
      expect(s.a1).toBeGreaterThanOrEqual(inner - 1e-6)
      inner = s.a1
    }
    // And every step inside the cluster respects FULL_WRAP_SPLIT_DEG.
    for (const s of reaches720.segs) {
      expect(Math.abs(s.a1 - s.a0)).toBeLessThanOrEqual(FULL_WRAP_SPLIT_DEG + 1e-3)
    }

    // The posted G-code must contain A-words ABOVE 360 deg -- a regression
    // that mod-360s the controller word would strip these.
    const aValsRaw = result.gcode.split(/\r?\n/).flatMap((l) => {
      const m = l.match(/A(-?\d+(?:\.\d+)?)/)
      return m ? [parseFloat(m[1]!)] : []
    })
    expect(aValsRaw.some((a) => a > 360)).toBe(true)
    expect(aValsRaw.some((a) => Math.abs(a - 720) < 1e-2)).toBe(true)
  }, 15_000)

  it('[ID-0010b] fractional multi-wrap contour (1.5*pi*D = 540 deg) end-to-end posts monotonic cumulative A reaching 540 deg', async () => {
    // Pins the non-multiple-of-FULL_WRAP_SPLIT_DEG case at the integration
    // layer. ceil(540/170) = 4 sub-segments of 135 deg each. The final A
    // must land exactly on 540 (not snapped to 510 = 3 * 170).
    const machine = cachedCarveraMachine

    const stockLen = 80
    const stockDia = 28
    const chuckDepth = 15
    const clampOffset = 2
    const C = Math.PI * stockDia

    const contourPoints: [number, number][] = [
      [40, 0],
      [40, 1.5 * C]
    ]

    const result = await runCamPipeline({
      stlPath: scratch('carvera-multiwrap-1p5x.stl'),
      outputGcodePath: scratch('carvera-multiwrap-1p5x-out.nc'),
      machine,
      resourcesRoot,
      appRoot: process.cwd(),
      zPassMm: -0.5,
      stepoverMm: 1,
      feedMmMin: 400,
      plungeMmMin: 120,
      safeZMm: 25,
      pythonPath: 'python',
      operationKind: 'cnc_4axis_contour',
      operationLabel: 'multiwrap-1p5x-test',
      rotaryStockLengthMm: stockLen,
      rotaryStockDiameterMm: stockDia,
      rotaryChuckDepthMm: chuckDepth,
      rotaryClampOffsetMm: clampOffset,
      toolDiameterMm: 3.0,
      operationParams: { contourPoints },
      workCoordinateIndex: 1
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const segs = extractToolpathSegments4AxisFromGcode(result.gcode)
    const feedSegs = segs.filter((s) => s.kind === 'feed')
    expect(feedSegs.length).toBeGreaterThanOrEqual(4)

    // Posted G-code contains the exact final A = 540 deg (within the
    // post's typical 3-decimal precision).
    const aValsRaw = result.gcode.split(/\r?\n/).flatMap((l) => {
      const m = l.match(/A(-?\d+(?:\.\d+)?)/)
      return m ? [parseFloat(m[1]!)] : []
    })
    expect(aValsRaw.some((a) => Math.abs(a - 540) < 1e-2)).toBe(true)
    // And nothing above 540 + tolerance (the contour ends at 540, so a
    // regression that overshoots into a second sub-cycle would fire here).
    const maxA = Math.max(...aValsRaw)
    expect(maxA).toBeLessThanOrEqual(540 + 1e-2)

    // Cumulative feed-segment sweep is ~540 deg.
    const firstA = feedSegs[0]!.a0
    const lastA = feedSegs.at(-1)!.a1
    const sweep = lastA - firstA
    expect(sweep).toBeGreaterThan(530)
    expect(sweep).toBeLessThan(550)
  }, 15_000)
})


// ────────────────────────────────────────────────────────────────────────────
// [ID-0148] runCamPipeline -- 4-axis cylindrical waterline integration
// invariants. DISCOVERED-2026-04-25 -- integration-layer mirror of Cycle 49
// [ID-0010c] strategy-roughing unit pins. Drives a synthetic centered-box STL
// through cnc_4axis_roughing -> runCamPipeline -> runAxis4 -> carvera_4axis.hbs
// against the bundled `resources/machines/makera-carvera-4axis.json` profile +
// `resources/posts/carvera_4axis.hbs` template, so the seven unit-layer
// invariants survive any future emit/post-template refactor.
// Test-only cycle: zero production-code edits. Safety Rule 1 (G-code is
// sacred) by construction -- regression here lights up the green test in the
// pipeline before bad G-code reaches the SD card.
// ────────────────────────────────────────────────────────────────────────────

describe('runCamPipeline -- 4-axis cylindrical waterline integration invariants (DISCOVERED-2026-04-25 [ID-0148])', () => {
  // Per-test scratch path under the same hoisted scratchDir as the suite above.
  const scratch = (name: string): string => join(scratchDir, name)

  // ─── Synthetic STL builder ────────────────────────────────────────────────
  // Centered axis-aligned box, X in [-length/2, +length/2], Y/Z in
  // [-halfYZ, +halfYZ]. After frame.ts shifts X by +length/2, the part lands
  // at X in [0, length] with sharp 4-corner cross-section -- the same shape
  // the strategy-roughing unit tests use to exercise corner-curvature
  // adaptive refinement (see strategy-roughing.test.ts `makeBox`). 12
  // triangles, all faces. Normals are computed by `buildBinaryStl`.
  function buildBinaryStl(triangles: number[][]): Buffer {
    const header = Buffer.alloc(80, 0)
    const count = Buffer.alloc(4)
    count.writeUInt32LE(triangles.length, 0)
    const tris = triangles.map((t) => {
      const buf = Buffer.alloc(50)
      let o = 0
      const ax = t[3]! - t[0]!
      const ay = t[4]! - t[1]!
      const az = t[5]! - t[2]!
      const bx = t[6]! - t[0]!
      const by = t[7]! - t[1]!
      const bz = t[8]! - t[2]!
      let nx = ay * bz - az * by
      let ny = az * bx - ax * bz
      let nz = ax * by - ay * bx
      const nl = Math.hypot(nx, ny, nz) || 1
      nx /= nl; ny /= nl; nz /= nl
      buf.writeFloatLE(nx, o); o += 4
      buf.writeFloatLE(ny, o); o += 4
      buf.writeFloatLE(nz, o); o += 4
      for (let i = 0; i < 9; i++) {
        buf.writeFloatLE(t[i]!, o); o += 4
      }
      buf.writeUInt16LE(0, o)
      return buf
    })
    return Buffer.concat([header, count, ...tris])
  }

  function buildCenteredBoxStl(lengthMm: number, halfYZ: number): Buffer {
    const xMin = -lengthMm / 2
    const xMax = lengthMm / 2
    const triangles: number[][] = []
    // -X face
    triangles.push([xMin, -halfYZ, -halfYZ, xMin, halfYZ, -halfYZ, xMin, halfYZ, halfYZ])
    triangles.push([xMin, -halfYZ, -halfYZ, xMin, halfYZ, halfYZ, xMin, -halfYZ, halfYZ])
    // +X face
    triangles.push([xMax, -halfYZ, -halfYZ, xMax, halfYZ, halfYZ, xMax, halfYZ, -halfYZ])
    triangles.push([xMax, -halfYZ, -halfYZ, xMax, -halfYZ, halfYZ, xMax, halfYZ, halfYZ])
    // -Y face
    triangles.push([xMin, -halfYZ, -halfYZ, xMax, -halfYZ, halfYZ, xMax, -halfYZ, -halfYZ])
    triangles.push([xMin, -halfYZ, -halfYZ, xMin, -halfYZ, halfYZ, xMax, -halfYZ, halfYZ])
    // +Y face
    triangles.push([xMin, halfYZ, -halfYZ, xMax, halfYZ, -halfYZ, xMax, halfYZ, halfYZ])
    triangles.push([xMin, halfYZ, -halfYZ, xMax, halfYZ, halfYZ, xMin, halfYZ, halfYZ])
    // -Z face
    triangles.push([xMin, -halfYZ, -halfYZ, xMax, -halfYZ, -halfYZ, xMax, halfYZ, -halfYZ])
    triangles.push([xMin, -halfYZ, -halfYZ, xMax, halfYZ, -halfYZ, xMin, halfYZ, -halfYZ])
    // +Z face
    triangles.push([xMin, -halfYZ, halfYZ, xMax, halfYZ, halfYZ, xMax, -halfYZ, halfYZ])
    triangles.push([xMin, -halfYZ, halfYZ, xMin, halfYZ, halfYZ, xMax, halfYZ, halfYZ])
    return buildBinaryStl(triangles)
  }

  // ─── Gcode line extractors (post template emits strategy lines verbatim) ──
  // The carvera_4axis.hbs template wraps the strategy lines in a header and
  // footer; the wrapped body lives between `; --- 4-axis toolpath moves begin`
  // and `; --- end toolpath ---` markers. For invariants that should NOT be
  // contaminated by post-emitted retracts (e.g. the post emits its own
  // `G0 Z{{workAreaMm.z}}` and final `G0 A0`), narrow the regex domain to the
  // toolpath body before counting. Other invariants that intentionally bound
  // the FULL gcode (e.g. workAreaMm.z ceiling) extract from the full string.
  function extractToolpathBody(gcode: string): string[] {
    const lines = gcode.split(/\r?\n/)
    const start = lines.findIndex((l) => /---\s*4-axis toolpath moves begin/.test(l))
    const end = lines.findIndex((l) => /---\s*end toolpath\b/.test(l))
    if (start < 0 || end < 0 || end <= start + 1) return []
    return lines.slice(start + 1, end)
  }
  function extractG1ZValues(lines: string[]): number[] {
    return lines
      .filter((l) => /^G1\s+.*Z[\d.]/i.test(l))
      .flatMap((l) => {
        const m = l.match(/Z(\d+(?:\.\d+)?)/)
        return m ? [parseFloat(m[1]!)] : []
      })
  }
  function extractAllG0ZValues(lines: string[]): number[] {
    return lines
      .filter((l) => /^G0\s+.*Z[\d.]/i.test(l))
      .flatMap((l) => {
        const m = l.match(/Z(\d+(?:\.\d+)?)/)
        return m ? [parseFloat(m[1]!)] : []
      })
  }
  function extractAllXValues(lines: string[]): number[] {
    return lines
      .filter((l) => /^G[01]\s+.*X-?[\d.]/i.test(l))
      .flatMap((l) => {
        const m = l.match(/X(-?\d+(?:\.\d+)?)/)
        return m ? [parseFloat(m[1]!)] : []
      })
  }

  // Shared job baseline for the seven invariants. Each test overrides the
  // fields it needs (operationParams, safeZMm, feed/plunge, etc.) but reuses
  // the bundled Carvera 4-axis profile + resourcesRoot so the post template
  // and machine profile are EXACTLY the production-bundled artifacts.
  async function loadCarvera() {
    return cachedCarveraMachine
  }

  // Standard centered-box test fixture: lengthX=70, halfYZ=6 -> after
  // frame.ts shifts X by +stockLen/2=40, the box lands at X in [5, 75]. With
  // chuckDepth=15 + clampOffset=2 the machinable span is [17, 80].
  const STOCK_LEN_MM = 80
  const STOCK_DIA_MM = 30
  const CHUCK_DEPTH_MM = 15
  const CLAMP_OFFSET_MM = 2
  const MACH_X_START = CHUCK_DEPTH_MM + CLAMP_OFFSET_MM // 17
  const MACH_X_END = STOCK_LEN_MM // 80

  it('[ID-0148.1] finishAllowanceMm shifts the cut-Z distribution upward through the full pipe', async () => {
    // Integration mirror of strategy-roughing.test.ts invariant 1.
    // Build a centered-box mesh, run TWO pipeline jobs identical except for
    // operationParams.rotaryFinishAllowanceMm, and compare G1-Z distributions
    // from the posted gcode. Allowance can only push cuts shallower-from-axis
    // (= larger Z value), so max(zWithAllow) must exceed max(zNoAllow) and
    // mean(zWithAllow) >= mean(zNoAllow). Same contract pinned at the unit
    // layer in Cycle 49 [ID-0010c]. End-to-end coverage proves the parameter
    // round-trips through cam-runner -> runAxis4 -> generateRoughing without
    // being silently dropped or aliased by the post.
    const machine = await loadCarvera()
    const stl = scratch('id0148-allowance.stl')
    // halfYZ=10 so the box's corner-up radius (~14.14) sits ABOVE targetCutR at
    // shallow zd levels -- this lets `cutZ = max(compR + allowance, targetCutR)`
    // route through the compR branch and demonstrably shift max(zVals) when
    // allowance is non-zero. With halfYZ=6 the corners (~8.49) sat below
    // targetCutR=13 at zd=-2, so both runs collapsed to cutZ=13 and the test
    // could not detect the allowance signal end-to-end.
    await writeFile(stl, buildCenteredBoxStl(70, 10))

    const baseJob: CamJobConfig = {
      stlPath: stl,
      outputGcodePath: scratch('id0148-allowance-out.nc'),
      machine,
      resourcesRoot,
      appRoot: process.cwd(),
      zPassMm: -10,
      stepoverMm: 5,
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      pythonPath: 'python',
      operationKind: 'cnc_4axis_roughing',
      operationLabel: 'allowance-test',
      rotaryStockLengthMm: STOCK_LEN_MM,
      rotaryStockDiameterMm: STOCK_DIA_MM,
      rotaryChuckDepthMm: CHUCK_DEPTH_MM,
      rotaryClampOffsetMm: CLAMP_OFFSET_MM,
      toolDiameterMm: 3.175,
      operationParams: { stepoverDeg: 30 },
      workCoordinateIndex: 1
    }

    const noAllow = await runCamPipeline(baseJob)
    const withAllow = await runCamPipeline({
      ...baseJob,
      outputGcodePath: scratch('id0148-allowance-with-out.nc'),
      operationParams: { stepoverDeg: 30, rotaryFinishAllowanceMm: 4 }
    })
    expect(noAllow.ok).toBe(true)
    expect(withAllow.ok).toBe(true)
    if (!noAllow.ok || !withAllow.ok) return

    const zNoAllow = extractG1ZValues(extractToolpathBody(noAllow.gcode))
    const zWithAllow = extractG1ZValues(extractToolpathBody(withAllow.gcode))
    expect(zNoAllow.length).toBeGreaterThan(0)
    expect(zWithAllow.length).toBeGreaterThan(0)

    const maxNo = Math.max(...zNoAllow)
    const maxWith = Math.max(...zWithAllow)
    expect(maxWith).toBeGreaterThan(maxNo + 0.5)

    const meanNo = zNoAllow.reduce((a, b) => a + b, 0) / zNoAllow.length
    const meanWith = zWithAllow.reduce((a, b) => a + b, 0) / zWithAllow.length
    expect(meanWith).toBeGreaterThanOrEqual(meanNo)
  }, 30_000)

  it('[ID-0148.2] maxZMm clamp prevents any G0 Z above the bundled Carvera workAreaMm.z (46)', async () => {
    // Integration mirror of strategy-roughing.test.ts invariant 2. The
    // strategy clamps clearZ to maxZMm - 1 = 45 when (stockR + safeZMm) would
    // otherwise exceed the machine's workAreaMm.z. Pick safeZMm=40 so the
    // raw clearZ = stockR(15) + 40 = 55 BLOWS the workArea ceiling -- without
    // the clamp every G0 Z line in the toolpath body would emit at Z55, which
    // is past the Carvera's mechanical Z travel of 46 mm and would crash the
    // gantry into the upper limit switch on the very first retract. The post
    // template's own `G0 Z{{machine.workAreaMm.z}}` retracts (header line 45,
    // footer line 63 of carvera_4axis.hbs) emit at exactly Z=46, so the
    // ceiling for the FULL gcode is `<= machine.workAreaMm.z + 1e-6`. This
    // pins the clamp end-to-end so any future emit/post change that bypasses
    // the maxZMm wire-up resurrects the crash.
    const machine = await loadCarvera()
    expect(machine.workAreaMm.z).toBe(46)
    const stl = scratch('id0148-maxz.stl')
    await writeFile(stl, buildCenteredBoxStl(70, 6))

    const result = await runCamPipeline({
      stlPath: stl,
      outputGcodePath: scratch('id0148-maxz-out.nc'),
      machine,
      resourcesRoot,
      appRoot: process.cwd(),
      zPassMm: -2,
      stepoverMm: 5,
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 40,
      pythonPath: 'python',
      operationKind: 'cnc_4axis_roughing',
      operationLabel: 'maxz-test',
      rotaryStockLengthMm: STOCK_LEN_MM,
      rotaryStockDiameterMm: STOCK_DIA_MM,
      rotaryChuckDepthMm: CHUCK_DEPTH_MM,
      rotaryClampOffsetMm: CLAMP_OFFSET_MM,
      toolDiameterMm: 3.175,
      operationParams: { stepoverDeg: 30 },
      workCoordinateIndex: 1
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const allG0Z = extractAllG0ZValues(result.gcode.split(/\r?\n/))
    expect(allG0Z.length).toBeGreaterThan(0)
    expect(Math.max(...allG0Z)).toBeLessThanOrEqual(machine.workAreaMm.z + 1e-6)

    // The strategy's clamped clearZ = min(stockR + safeZMm, maxZMm - 1) =
    // min(55, 45) = 45. Without the clamp the strategy would emit Z55 in
    // every retract line. Pin the clamped value as actually appearing.
    const toolpathG0Z = extractAllG0ZValues(extractToolpathBody(result.gcode))
    expect(toolpathG0Z.some((z) => Math.abs(z - 45) < 1e-3)).toBe(true)
  }, 30_000)

  it('[ID-0148.3] adaptiveRefinement: true inserts extra A angles end-to-end past the post template', async () => {
    // Integration mirror of strategy-roughing.test.ts invariant 3.
    // Centered box has 4 sharp corners -> high angular curvature; the
    // strategy's buildAdaptiveAngles inserts midpoint passes there, which
    // surface in the posted gcode as additional G0 A lines. Filter out the
    // post template's own footer `G0 A0 ; return A to home` (strategy emit)
    // AND `G0 A0` (post template footer) by counting only G0 A lines inside
    // the toolpath body and excluding the unit-modulus `A0` repositioning at
    // the head of every Z-pass cluster. Adaptive must insert STRICTLY more
    // A angles than the non-adaptive baseline for the same mesh + stepover.
    const machine = await loadCarvera()
    const stl = scratch('id0148-adaptive.stl')
    await writeFile(stl, buildCenteredBoxStl(70, 8))

    const baseJob: CamJobConfig = {
      stlPath: stl,
      outputGcodePath: scratch('id0148-adaptive-no-out.nc'),
      machine,
      resourcesRoot,
      appRoot: process.cwd(),
      zPassMm: -2,
      stepoverMm: 5,
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      pythonPath: 'python',
      operationKind: 'cnc_4axis_roughing',
      operationLabel: 'adaptive-test',
      rotaryStockLengthMm: STOCK_LEN_MM,
      rotaryStockDiameterMm: STOCK_DIA_MM,
      rotaryChuckDepthMm: CHUCK_DEPTH_MM,
      rotaryClampOffsetMm: CLAMP_OFFSET_MM,
      toolDiameterMm: 3.175,
      operationParams: { stepoverDeg: 15 },
      workCoordinateIndex: 1
    }

    const without = await runCamPipeline(baseJob)
    const withAdaptive = await runCamPipeline({
      ...baseJob,
      outputGcodePath: scratch('id0148-adaptive-yes-out.nc'),
      operationParams: { stepoverDeg: 15, adaptiveRefinement: true }
    })
    expect(without.ok).toBe(true)
    expect(withAdaptive.ok).toBe(true)
    if (!without.ok || !withAdaptive.ok) return

    // Count G0 A lines in the toolpath body. Both runs share the strategy's
    // own `G0 A0 ; return A to home` line at the tail (1 line each) and the
    // first `rotateA` line at A=0 -- so the difference is the corner-pass
    // insertions. Total A-line count must be strictly greater for adaptive.
    const aWithout = extractToolpathBody(without.gcode).filter((l) => /^G0\s+A/i.test(l)).length
    const aWith = extractToolpathBody(withAdaptive.gcode).filter((l) => /^G0\s+A/i.test(l)).length
    expect(aWithout).toBeGreaterThan(0)
    expect(aWith).toBeGreaterThan(aWithout)
  }, 30_000)

  it('[ID-0148.4] plunge G1 Z lines (no X) use plungeMmMin feed (F300, never F800) end-to-end', async () => {
    // Integration mirror of strategy-roughing.test.ts invariant 4. The
    // post template emits strategy lines verbatim, so a regression that
    // mis-wired plunge feed would surface here as F800 on a pure-plunge
    // line -- which on a 0.5-mm-per-pass roughing job snaps a 3.175 mm
    // carbide endmill the moment the spindle hits stock. F300 is the
    // plungeMmMin we set, F800 is the feedMmMin; either swap fires this
    // test.
    const machine = await loadCarvera()
    const stl = scratch('id0148-plunge.stl')
    await writeFile(stl, buildCenteredBoxStl(70, 6))

    const result = await runCamPipeline({
      stlPath: stl,
      outputGcodePath: scratch('id0148-plunge-out.nc'),
      machine,
      resourcesRoot,
      appRoot: process.cwd(),
      zPassMm: -2,
      stepoverMm: 5,
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      pythonPath: 'python',
      operationKind: 'cnc_4axis_roughing',
      operationLabel: 'plunge-feed-test',
      rotaryStockLengthMm: STOCK_LEN_MM,
      rotaryStockDiameterMm: STOCK_DIA_MM,
      rotaryChuckDepthMm: CHUCK_DEPTH_MM,
      rotaryClampOffsetMm: CLAMP_OFFSET_MM,
      toolDiameterMm: 3.175,
      operationParams: { stepoverDeg: 30 },
      workCoordinateIndex: 1
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const body = extractToolpathBody(result.gcode)
    const plungeLines = body.filter((l) => /^G1\s+Z[\d.]/i.test(l) && !/X-?[\d.]/.test(l))
    expect(plungeLines.length).toBeGreaterThan(0)
    for (const line of plungeLines) {
      const fm = line.match(/F(\d+)/)
      expect(fm).not.toBeNull()
      expect(parseInt(fm![1]!, 10)).toBe(300)
    }
  }, 30_000)

  it('[ID-0148.5] lateral cut moves at constant Z (G1 X with no Z word) use feedMmMin (F800), never plunge feed (F300)', async () => {
    // Integration mirror of strategy-roughing.test.ts invariant 5. A flat
    // lateral cut that slips into plunge feed cuts at 37.5% of the intended
    // surface speed, ruining tool engagement and chip evacuation. F800 must
    // appear at least once on a flat lateral cut line (no Z word emitted
    // when |dz| <= 0.005 mm in the emitter), and F300 must NEVER appear on
    // such a line.
    const machine = await loadCarvera()
    const stl = scratch('id0148-lateral.stl')
    await writeFile(stl, buildCenteredBoxStl(70, 6))

    const result = await runCamPipeline({
      stlPath: stl,
      outputGcodePath: scratch('id0148-lateral-out.nc'),
      machine,
      resourcesRoot,
      appRoot: process.cwd(),
      zPassMm: -2,
      stepoverMm: 5,
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      pythonPath: 'python',
      operationKind: 'cnc_4axis_roughing',
      operationLabel: 'lateral-feed-test',
      rotaryStockLengthMm: STOCK_LEN_MM,
      rotaryStockDiameterMm: STOCK_DIA_MM,
      rotaryChuckDepthMm: CHUCK_DEPTH_MM,
      rotaryClampOffsetMm: CLAMP_OFFSET_MM,
      toolDiameterMm: 3.175,
      operationParams: { stepoverDeg: 30 },
      workCoordinateIndex: 1
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const body = extractToolpathBody(result.gcode)
    const cutLines = body.filter((l) => /^G1\s+X-?[\d.]/i.test(l))
    expect(cutLines.length).toBeGreaterThan(0)
    const flatLateralCuts = cutLines.filter((l) => !/\bZ-?[\d.]/.test(l))
    expect(flatLateralCuts.length).toBeGreaterThan(0)
    const f800Flat = flatLateralCuts.filter((l) => /\bF800\b/.test(l))
    const f300Flat = flatLateralCuts.filter((l) => /\bF300\b/.test(l))
    expect(f800Flat.length).toBeGreaterThan(0)
    expect(f300Flat.length).toBe(0)
  }, 30_000)

  it('[ID-0148.6] toolpath body ends with the strategy returnHome sequence (G0 Z<clearZ> Y0; G0 A0 ; return A to home)', async () => {
    // Integration mirror of strategy-roughing.test.ts invariant 6. The
    // strategy's `Emitter.returnHome()` (emit.ts lines 228-230) is the LAST
    // pair of lines in the toolpath body (between the post template's
    // `; --- 4-axis toolpath moves begin` and `; --- end toolpath ---`
    // markers). Pinning this end-to-end guards against a post-template
    // regression that strips the strategy's tail OR a strategy regression
    // that drops returnHome (which would leave the rotary at an arbitrary
    // angle when the post's footer M9/M2 fires -- no immediate crash, but
    // the next job's WCS-zero assumption breaks).
    const machine = await loadCarvera()
    const stl = scratch('id0148-returnhome.stl')
    await writeFile(stl, buildCenteredBoxStl(70, 6))

    const result = await runCamPipeline({
      stlPath: stl,
      outputGcodePath: scratch('id0148-returnhome-out.nc'),
      machine,
      resourcesRoot,
      appRoot: process.cwd(),
      zPassMm: -2,
      stepoverMm: 5,
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      pythonPath: 'python',
      operationKind: 'cnc_4axis_roughing',
      operationLabel: 'returnhome-test',
      rotaryStockLengthMm: STOCK_LEN_MM,
      rotaryStockDiameterMm: STOCK_DIA_MM,
      rotaryChuckDepthMm: CHUCK_DEPTH_MM,
      rotaryClampOffsetMm: CLAMP_OFFSET_MM,
      toolDiameterMm: 3.175,
      operationParams: { stepoverDeg: 30 },
      workCoordinateIndex: 1
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const body = extractToolpathBody(result.gcode)
    expect(body.length).toBeGreaterThan(2)
    const last = body[body.length - 1]!
    const secondLast = body[body.length - 2]!
    expect(last).toMatch(/^G0\s+A0(?:\.\d+)?\s+;\s*return\s+A\s+to\s+home/i)
    expect(secondLast).toMatch(/^G0\s+Z[\d.]+\s+Y0\b/i)
  }, 30_000)

  it('[ID-0148.7] overcutMm: 0 keeps cut X within [machXStart, machXEnd] tolerance through the full pipe', async () => {
    // Integration mirror of strategy-roughing.test.ts invariant 7. The
    // strategy's default overcut is one tool diameter, which extends the
    // machinable range past machXEnd for a clean exit. With overcutMm=0
    // every cut X must remain inside [machXStart, machXEnd] within the
    // grid-cell tolerance (~0.05 mm). machXStart=17 (chuck-face safety from
    // chuckDepth + clampOffset), machXEnd=80 (stockLen). A regression that
    // ignores operationParams.overcutMm would re-introduce default overcut
    // and surface as cuts past stockLen + small slack.
    const machine = await loadCarvera()
    const stl = scratch('id0148-overcut.stl')
    await writeFile(stl, buildCenteredBoxStl(70, 6))

    const result = await runCamPipeline({
      stlPath: stl,
      outputGcodePath: scratch('id0148-overcut-out.nc'),
      machine,
      resourcesRoot,
      appRoot: process.cwd(),
      zPassMm: -2,
      stepoverMm: 5,
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      pythonPath: 'python',
      operationKind: 'cnc_4axis_roughing',
      operationLabel: 'overcut-test',
      rotaryStockLengthMm: STOCK_LEN_MM,
      rotaryStockDiameterMm: STOCK_DIA_MM,
      rotaryChuckDepthMm: CHUCK_DEPTH_MM,
      rotaryClampOffsetMm: CLAMP_OFFSET_MM,
      toolDiameterMm: 3.175,
      operationParams: { stepoverDeg: 30, overcutMm: 0 },
      workCoordinateIndex: 1
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const body = extractToolpathBody(result.gcode)
    const cutLines = body.filter((l) => /^G1\s+X-?[\d.]/i.test(l))
    expect(cutLines.length).toBeGreaterThan(0)
    const cutXs = extractAllXValues(cutLines)
    expect(cutXs.length).toBeGreaterThan(0)
    expect(Math.min(...cutXs)).toBeGreaterThanOrEqual(MACH_X_START - 0.05)
    expect(Math.max(...cutXs)).toBeLessThanOrEqual(MACH_X_END + 0.05)
  }, 30_000)
})
