/**
 * End-to-end integration test for the OrcaSlicer pipeline.
 *
 * Unlike `orca-wrapper.test.ts` (pure-function `buildOrcaArgs` + missing-bundle
 * `resolveOrcaInstall` checks), this suite actually invokes the **bundled
 * OrcaSlicer binary** against a programmatic 5 mm cube STL and asserts the
 * real G-code output for the Creality K2 Plus standard preset + generic PLA
 * filament profile.
 *
 * Why this test exists
 * --------------------
 * Every other test in the slicing pipeline mocks something:
 *   - `orca-wrapper.test.ts`           mocks the binary (pure-arg tests only).
 *   - `slice-orca-ipc-pin.test.ts`     pins source-text strings, never spawns.
 *   - `moonraker-push-thumbnail.test.ts` synthesises G-code in-memory.
 *
 * A complete pivot regression (e.g. profile key rename, binary CLI flag change,
 * Klipper start-gcode break) could ship green through ALL of those and still
 * crash the K2 Plus in production. This e2e binds the entire stack from the
 * bundled .exe through to a parsed K2-quality header, in one shot.
 *
 * Skip semantics
 * --------------
 * The bundled binary is NOT committed to git (.gitignore excludes
 * `resources/orca-slicer/{win32-x64,darwin-arm64,linux-x64}/`). On any
 * machine where the binary is missing (CI without the bundle script,
 * cross-platform sandboxes, fresh clones), the test SKIPS with a clear
 * message instead of failing. Run `scripts/bundle-orca-slicer.ps1` on a
 * Windows dev box (Jacob's box) to materialise the binary tree.
 *
 * Safety
 * ------
 * Safety Rule 1 (G-code is sacred): this test READS G-code, never emits it.
 * The slice config is locked to the STANDARD preset (no high-speed accel)
 * so the printed envelope stays well inside the K2_PLUS_HARDWARE_CEILINGS.
 * A sanity scan asserts no `G1 F` value exceeds F36000 (= 600 mm/s, the K2
 * XY motion ceiling per CLAUDE.md Sec.1).
 *
 * Three-machine scope
 * -------------------
 *   - Creality K2 Plus: DIRECT consumer. This entire test exercises the K2
 *     standard preset + generic PLA. A green run proves the FDM stack ships.
 *   - Laguna Swift 5x10: NOT exercised. CNC posts are not slicer output.
 *   - Makera Carvera + 4-axis: NOT exercised. Same rationale.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runOrcaSlice, type OrcaSliceConfig } from './orca-wrapper'
import { checkGcodeHeaderHealth } from '../../shared/gcode-header-health'

// ── Bundle resolution ────────────────────────────────────────────────────────

/**
 * Locate the bundled OrcaSlicer binary relative to the test's own working
 * tree. Returns the appRoot to pass into `runOrcaSlice` when the binary is
 * present, or `null` when it is not bundled (in which case the test skips).
 *
 * NOTE: This intentionally only checks `process.cwd()` -- the binary is
 * gitignored, so isolated agent worktrees and sandboxes cleanly skip while
 * the user's primary repo (where `scripts/bundle-orca-slicer.ps1` has been
 * run) executes the real slice.
 */
function resolveAppRootWithBinary(): string | null {
  const platformDir =
    process.platform === 'win32'
      ? 'win32-x64'
      : process.platform === 'darwin'
        ? 'darwin-arm64'
        : 'linux-x64'
  const binName = process.platform === 'win32' ? 'orca-slicer.exe' : 'orca-slicer'

  const root = process.cwd()
  const binary = resolve(root, 'resources', 'orca-slicer', platformDir, binName)
  return existsSync(binary) ? root : null
}

const APP_ROOT = resolveAppRootWithBinary()
const BUNDLE_PRESENT = APP_ROOT !== null

// ── Programmatic 5 mm cube binary STL ────────────────────────────────────────

/**
 * Build a binary-STL payload for a 5 mm axis-aligned cube at the origin.
 *
 * Format: 80-byte free-form header + uint32 triangle count + N × 50-byte
 * triangle records (3 floats normal + 3 × 3 floats vertices + uint16 attr).
 * Mirrors the writer in `engines/cad/cadquery_import.py::_build_binary_stl`
 * so the STL is bit-for-bit compatible with OpenCAMLib's STLReader and with
 * OrcaSlicer's mesh importer.
 *
 * 12 triangles (2 per face × 6 faces). All normals point outward (right-hand
 * rule on the listed vertex order).
 */
function buildCubeStl(sideMm: number): Buffer {
  const s = sideMm
  // 8 corner vertices.
  const v: Array<[number, number, number]> = [
    [0, 0, 0], // 0
    [s, 0, 0], // 1
    [s, s, 0], // 2
    [0, s, 0], // 3
    [0, 0, s], // 4
    [s, 0, s], // 5
    [s, s, s], // 6
    [0, s, s], // 7
  ]
  // 12 triangles, each with an outward-facing normal.
  type Tri = { n: [number, number, number]; a: number; b: number; c: number }
  const tris: Tri[] = [
    // Bottom face (z=0), normal -Z
    { n: [0, 0, -1], a: 0, b: 2, c: 1 },
    { n: [0, 0, -1], a: 0, b: 3, c: 2 },
    // Top face (z=s), normal +Z
    { n: [0, 0, 1], a: 4, b: 5, c: 6 },
    { n: [0, 0, 1], a: 4, b: 6, c: 7 },
    // Front face (y=0), normal -Y
    { n: [0, -1, 0], a: 0, b: 1, c: 5 },
    { n: [0, -1, 0], a: 0, b: 5, c: 4 },
    // Back face (y=s), normal +Y
    { n: [0, 1, 0], a: 3, b: 7, c: 6 },
    { n: [0, 1, 0], a: 3, b: 6, c: 2 },
    // Left face (x=0), normal -X
    { n: [-1, 0, 0], a: 0, b: 4, c: 7 },
    { n: [-1, 0, 0], a: 0, b: 7, c: 3 },
    // Right face (x=s), normal +X
    { n: [1, 0, 0], a: 1, b: 2, c: 6 },
    { n: [1, 0, 0], a: 1, b: 6, c: 5 },
  ]

  const headerSize = 80
  const countSize = 4
  const triSize = 50
  const buf = Buffer.alloc(headerSize + countSize + triSize * tris.length)
  buf.write('WorkTrackCAM E2E cube fixture', 0, 'ascii')
  buf.writeUInt32LE(tris.length, headerSize)

  let off = headerSize + countSize
  for (const t of tris) {
    buf.writeFloatLE(t.n[0], off)
    off += 4
    buf.writeFloatLE(t.n[1], off)
    off += 4
    buf.writeFloatLE(t.n[2], off)
    off += 4
    for (const idx of [t.a, t.b, t.c]) {
      const [x, y, z] = v[idx]
      buf.writeFloatLE(x, off)
      off += 4
      buf.writeFloatLE(y, off)
      off += 4
      buf.writeFloatLE(z, off)
      off += 4
    }
    buf.writeUInt16LE(0, off)
    off += 2
  }
  return buf
}

// ── E2E test ────────────────────────────────────────────────────────────────

describe('runOrcaSlice end-to-end against the bundled binary (K2 standard preset)', () => {
  it.skipIf(!BUNDLE_PRESENT)(
    'slices a 5 mm cube and emits a K2-quality G-code file',
    async () => {
      // APP_ROOT is non-null inside the skipIf branch.
      const appRoot: string = APP_ROOT as string

      const tmp = mkdtempSync(join(tmpdir(), 'wtcam-orca-e2e-'))
      try {
        const stlPath = join(tmp, 'cube-5mm.stl')
        writeFileSync(stlPath, buildCubeStl(5))
        const outPath = join(tmp, 'cube-5mm.gcode')

        const profilesDir = join(appRoot, 'resources', 'orca-slicer', 'profiles')
        const cfg: OrcaSliceConfig = {
          inputPath: stlPath,
          outputGcodePath: outPath,
          machineProfileIni: join(profilesDir, 'machines', 'creality-k2-plus.ini'),
          processProfileIni: join(profilesDir, 'process', 'standard.ini'),
          filamentProfileIni: join(profilesDir, 'filament', 'pla-generic.ini'),
          preset: 'standard',
        }

        // Generous 5-minute ceiling — a 5 mm cube usually slices in 5-30 s,
        // but cold-start on a fresh OrcaSlicer install can stretch to 60+ s.
        const result = await runOrcaSlice(appRoot, cfg, { timeoutMs: 5 * 60_000 })

        // Hard-fail on a non-zero exit so the captured stderr is surfaced
        // in the vitest log rather than being silently swallowed by a later
        // file-not-found assertion.
        if (!result.ok) {
          throw new Error(
            `OrcaSlicer exited with code ${result.exitCode}. ` +
              `stderr=\n${result.stderr}\nstdout=\n${result.stdout}`,
          )
        }
        expect(result.exitCode).toBe(0)

        // ── 1. Non-empty (> 1 KB) ────────────────────────────────────────
        expect(existsSync(outPath)).toBe(true)
        const gcode = readFileSync(outPath, 'utf-8')
        expect(gcode.length).toBeGreaterThan(1024)

        // ── 2. Standard Klipper / Slic3r header lines ────────────────────
        // OrcaSlicer emits Slic3r-style `; estimated printing time...`
        // and Klipper-flavoured comments. Accept either family so the
        // test stays robust across OrcaSlicer minor versions.
        const hasOrcaTime = /^;\s*estimated printing time/im.test(gcode)
        const hasCuraTime = /^;\s*TIME:\s*\d+/m.test(gcode)
        const hasSlic3rTime = /^;\s*PRINT_TIME:\s*\d+/m.test(gcode)
        expect(hasOrcaTime || hasCuraTime || hasSlic3rTime).toBe(true)

        const hasOrcaFilament = /^;\s*filament used\s*\[(?:mm|g)\]/im.test(gcode)
        const hasCuraFilament = /^;\s*Filament used:/m.test(gcode)
        expect(hasOrcaFilament || hasCuraFilament).toBe(true)

        expect(/^;\s*layer_height\s*[:=]/im.test(gcode)).toBe(true)

        // ── 3. Embedded thumbnail block (K2 profile sets thumbnails = 300x300,96x96)
        expect(/^;\s*thumbnail\s+begin\s+\d+x\d+\s+\d+/im.test(gcode)).toBe(true)

        // ── 4. checkGcodeHeaderHealth comes back fully green ─────────────
        // The bounded header for K2 thumbnails can be large (300x300 PNG ~
        // 60-100 KB of base64). Pass the FULL gcode text -- the parser is
        // bounded by regex, not by buffer size.
        const health = checkGcodeHeaderHealth(gcode)
        if (!health.ok) {
          throw new Error(
            `K2 header health check failed. Missing: ${health.missingFields.join(', ')}. ` +
              `Summary: ${health.summary}`,
          )
        }
        expect(health.ok).toBe(true)
        expect(health.missingFields).toEqual([])
        expect(health.fields.thumbnail).toBeDefined()
        expect(health.fields.timeSeconds).toBeGreaterThan(0)
        expect(health.fields.filament).toBeDefined()
        expect(health.fields.layerCount).toBeGreaterThan(0)

        // ── 5. No G1 F values exceed K2 XY ceiling (F36000 = 600 mm/s) ──
        // Sanity scan: G1 lines may carry an F<feed-rate-mm-per-min> param.
        // K2_PLUS_HARDWARE_CEILINGS caps XY at 600 mm/s == 36000 mm/min.
        // OrcaSlicer's machine_max_speed_x/y of 600 should already clamp
        // anything emitted; this assertion is a belt-AND-braces guard
        // that catches a profile regression BEFORE bad G-code ships.
        const feedRateRegex = /^G[01]\s+(?:[^F\n]*\s)?F(\d+(?:\.\d+)?)/gm
        let m: RegExpExecArray | null
        const offenders: number[] = []
        while ((m = feedRateRegex.exec(gcode)) !== null) {
          const f = Number.parseFloat(m[1])
          if (f > 36000) offenders.push(f)
        }
        if (offenders.length > 0) {
          throw new Error(
            `${offenders.length} G1/G0 lines exceed K2 XY ceiling (F36000 = 600 mm/s). ` +
              `Examples: ${offenders.slice(0, 3).map((n) => `F${n}`).join(', ')}`,
          )
        }
        expect(offenders).toEqual([])
      } finally {
        try {
          rmSync(tmp, { recursive: true, force: true })
        } catch {
          /* best-effort tmpdir cleanup */
        }
      }
    },
    // Vitest per-test timeout override -- the default 15 s is not enough
    // for a binary spawn + slice. Allow up to 6 minutes (1 min headroom
    // over the inner runOrcaSlice 5-min ceiling).
    6 * 60_000,
  )

  it('records why the test was skipped when the bundle is absent', () => {
    // This second case is INFORMATIONAL — when the binary is bundled it
    // passes trivially; when it is not, it documents the skip reason in
    // the vitest log so a reviewer doesn't have to guess.
    if (!BUNDLE_PRESENT) {
      // Tip the reader off without failing CI.
      // eslint-disable-next-line no-console
      console.warn(
        '[orca-wrapper.e2e] Skipped: OrcaSlicer binary not bundled at ' +
          `resources/orca-slicer/${process.platform === 'win32' ? 'win32-x64' : process.platform === 'darwin' ? 'darwin-arm64' : 'linux-x64'}/. ` +
          'Run scripts/bundle-orca-slicer.ps1 on a Windows dev box ' +
          'to materialise the bundle, then re-run npm test.',
      )
    }
    expect(typeof BUNDLE_PRESENT).toBe('boolean')
  })
})
