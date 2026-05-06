/**
 * [ID-0087] Optional-machineId IPC-payload audit (Cycle 29, test-coverage,
 * 2026-04-24).
 *
 * Background -- why this file exists
 * -----------------------------------
 * Cycle 14's [ID-0080] closed a "silent unreachable resolver branch" gap on
 * the `moonraker:push` IPC handler. The handler accepted
 * `payload.machineId?: string` and resolved it into `machineCapabilities`
 * (the three FDM temperature ceilings) via `getMachineById` +
 * `extractFdmCapabilitiesFromProfile`, but the renderer's
 * `fab().moonrakerPush(...)` call-site NEVER threaded `machineId` into the
 * outgoing payload. The resolver branch was therefore unreachable in
 * production, and the pre-upload temperature guard was effectively disarmed
 * for every real Creality K2 Plus job. The preload / renderer IPC type
 * signatures did not even declare `machineId`, so a caller could not opt in
 * without a typecheck error.
 *
 * This test file is the formal audit deliverable for [ID-0087]: it pins the
 * CURRENT optional-machineId surface area to a known minimal set so any
 * future cycle that introduces a NEW optional-machineId IPC payload MUST
 * also add:
 *   1. A preload wire-up that accepts `machineId?: string`.
 *   2. A renderer-side payload builder that conditionally threads it
 *      (analogous to `buildMoonrakerPushPayload`).
 *   3. An updated pin in this file so the audit stays meaningful.
 *
 * If the count drifts without these updates, the silent-unreachable-branch
 * pattern has been re-introduced. This test fails at CI time rather than at
 * operator runtime when, say, a K2 job unexpectedly skips a safety ceiling
 * check.
 *
 * Scope
 * -----
 * Target machines (per CLAUDE.md USER CONTEXT -- TARGET MACHINES):
 *   - Creality K2 Plus (FDM / Moonraker)
 *   - Laguna Swift 5x10 (CNC router)
 *   - Makera Carvera + 4th Axis (desktop 4-axis CNC)
 *
 * The K2 Plus is the only Moonraker-bearing target. The optional-machineId
 * resolver hook is therefore Moonraker-specific TODAY. If a future cycle
 * adds a CNC-facing optional-machineId hook (e.g. `carvera:upload` with
 * an optional machine-profile-driven probing toggle), this audit must be
 * updated to list it AND a corresponding renderer-side payload builder
 * must exist.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildMoonrakerPushPayload,
  type MoonrakerPushPayload,
  type ShopJobForPush
} from '../renderer/src/moonraker-push-payload'

const repoRoot = join(__dirname, '..', '..')
const ipcFabSource = readFileSync(join(repoRoot, 'src/main/ipc-fabrication.ts'), 'utf-8')
const preloadSource = readFileSync(join(repoRoot, 'src/preload/index.ts'), 'utf-8')

/**
 * Count occurrences of the optional-machineId type declaration in a source
 * text. Uses `machineId?: string` literal search -- Zod payload shapes
 * extend this pattern uniformly across the codebase (see
 * `MoonrakerPushIpcPayload` + the inline `moonraker:push` handler payload
 * in `src/main/ipc-fabrication.ts`).
 */
function countOptionalMachineIdDeclarations(source: string): number {
  const matches = source.match(/machineId\?:\s*string/g)
  return matches?.length ?? 0
}

describe('[ID-0087] optional-machineId IPC payload audit -- main/ipc-fabrication.ts', () => {
  it('pins EXACTLY 2 occurrences of `machineId?: string` in src/main/ipc-fabrication.ts', () => {
    // Occurrence 1: the `MoonrakerPushIpcPayload` type alias that the pure
    // `resolveMoonrakerPushCapabilities` helper consumes.
    // Occurrence 2: the inline payload type on the `moonraker:push`
    // ipcMain.handle(...) registration.
    // A third occurrence = a NEW optional-machineId IPC handler has been
    // added WITHOUT updating this audit (or the companion renderer-side
    // payload builder). See [ID-0080] for the hazard.
    const count = countOptionalMachineIdDeclarations(ipcFabSource)
    expect(count).toBe(2)
  })

  it('both occurrences are anchored within 80 lines of a moonraker-context marker', () => {
    // Anchor test: walk each `machineId?: string` hit line and look BACK up
    // to 80 lines for a `MoonrakerPushIpcPayload` or `moonraker:push` or
    // `Moonraker / moonraker`-handler marker. Every hit must resolve to a
    // moonraker anchor; if a new optional-machineId hook is added in a
    // non-moonraker handler, no such anchor will be within the look-back
    // window and this test fails.
    const lines = ipcFabSource.split('\n')
    const hitLines: number[] = []
    lines.forEach((line, idx) => {
      if (/machineId\?:\s*string/.test(line)) hitLines.push(idx)
    })
    expect(hitLines.length).toBe(2)
    for (const hit of hitLines) {
      let anchored = false
      for (let i = hit; i >= Math.max(0, hit - 80); i--) {
        if (/MoonrakerPushIpcPayload|moonraker:push/.test(lines[i]!)) {
          anchored = true
          break
        }
      }
      expect(anchored).toBe(true)
    }
  })

  it('exports `MoonrakerPushIpcPayload` with `machineId?: string`', () => {
    // Structural pin: the export surface must include the type alias
    // so both the handler + the resolver helper share one shape.
    expect(ipcFabSource).toMatch(/export type MoonrakerPushIpcPayload\s*=\s*\{[^}]*machineId\?:\s*string/s)
  })

  it('`resolveMoonrakerPushCapabilities` signature consumes `MoonrakerPushIpcPayload`', () => {
    // If a new optional-machineId handler is added, it must either use the
    // existing resolver (and extend its payload type) OR introduce its own
    // resolver. This pin makes the existing-resolver path visible to code
    // search.
    expect(ipcFabSource).toMatch(
      /export async function resolveMoonrakerPushCapabilities\(\s*payload:\s*MoonrakerPushIpcPayload/
    )
  })
})

describe('[ID-0087] optional-machineId IPC payload audit -- preload/index.ts', () => {
  it('pins EXACTLY 1 occurrence of `machineId?: string` in src/preload/index.ts', () => {
    // Only `moonrakerPush` accepts an optional machine id today. Every
    // other preload API that needs a machine id takes it as a REQUIRED
    // positional parameter (see e.g. `machinesDeleteUser`,
    // `machineToolsRead`, `machineToolsImport`) so a caller cannot
    // silently omit it.
    const count = countOptionalMachineIdDeclarations(preloadSource)
    expect(count).toBe(1)
  })

  it('the single optional-machineId preload method is `moonrakerPush`', () => {
    // Structural pin: find the name of the preload method whose payload
    // contains `machineId?: string`. The preload source block for
    // `moonrakerPush` starts with the method name and ends with the
    // closing `>` of its Promise return type; searching for the nearest
    // preceding method name before the `machineId?: string` line
    // identifies the owning method.
    const lines = preloadSource.split('\n')
    const hitLineIdx = lines.findIndex((l) => /machineId\?:\s*string/.test(l))
    expect(hitLineIdx).toBeGreaterThan(-1)
    // Walk backward to the nearest method-name line (of the form
    // `  <name>: (payload: {` or similar). The preload API method names
    // for optional-payload methods follow `<name>: (<arg>: {` and this
    // regex anchors on them.
    let owningMethod: string | null = null
    for (let i = hitLineIdx - 1; i >= 0; i--) {
      const m = lines[i]!.match(/^\s{2}([a-zA-Z][a-zA-Z0-9]*):\s*\(/)
      if (m) {
        owningMethod = m[1]!
        break
      }
    }
    expect(owningMethod).toBe('moonrakerPush')
  })
})

describe('[ID-0087] optional-machineId IPC payload audit -- renderer-side builder', () => {
  it('`buildMoonrakerPushPayload` threads a non-empty `machineId` through', () => {
    const job: ShopJobForPush = {
      gcodeOut: '/tmp/job.gcode',
      printerUrl: 'http://k2.local',
      machineId: 'creality-k2-plus'
    }
    const payload: MoonrakerPushPayload = buildMoonrakerPushPayload(job)
    expect(payload.machineId).toBe('creality-k2-plus')
  })

  it('`buildMoonrakerPushPayload` drops an empty-string `machineId`', () => {
    const job: ShopJobForPush = {
      gcodeOut: '/tmp/job.gcode',
      printerUrl: 'http://k2.local',
      machineId: ''
    }
    const payload: MoonrakerPushPayload = buildMoonrakerPushPayload(job)
    expect(payload.machineId).toBeUndefined()
  })

  it('`buildMoonrakerPushPayload` drops a `null` `machineId` (Safety Rule 2 pre-[ID-0078] parity)', () => {
    const job: ShopJobForPush = {
      gcodeOut: '/tmp/job.gcode',
      printerUrl: 'http://k2.local',
      machineId: null
    }
    const payload: MoonrakerPushPayload = buildMoonrakerPushPayload(job)
    expect(payload.machineId).toBeUndefined()
  })

  it('`buildMoonrakerPushPayload` drops a missing `machineId` (pre-[ID-0078] parity)', () => {
    const job: ShopJobForPush = {
      gcodeOut: '/tmp/job.gcode',
      printerUrl: 'http://k2.local'
    }
    const payload: MoonrakerPushPayload = buildMoonrakerPushPayload(job)
    expect(payload.machineId).toBeUndefined()
  })
})

describe('[ID-0087] optional-machineId IPC payload audit -- negative-gap fingerprint', () => {
  it('no non-moonraker preload method declares an optional `machineId?: string` payload field', () => {
    // Every preload method that accepts an OPTIONAL machineId must go
    // through the moonraker-push resolver (or a future analogous resolver).
    // This is a stricter-than-count assertion: we walk the preload source
    // line-by-line, find every `machineId?: string` hit, and for each hit
    // confirm the owning method name is in the known allow-list.
    const allowlist = new Set<string>(['moonrakerPush'])
    const lines = preloadSource.split('\n')
    const hitLines: number[] = []
    lines.forEach((line, idx) => {
      if (/machineId\?:\s*string/.test(line)) {
        hitLines.push(idx)
      }
    })
    for (const hit of hitLines) {
      let owningMethod: string | null = null
      for (let i = hit - 1; i >= 0; i--) {
        const m = lines[i]!.match(/^\s{2}([a-zA-Z][a-zA-Z0-9]*):\s*\(/)
        if (m) {
          owningMethod = m[1]!
          break
        }
      }
      expect(owningMethod).not.toBeNull()
      expect(allowlist.has(owningMethod!)).toBe(true)
    }
  })

  it('no non-moonraker ipc-fabrication handler registers an optional `machineId?: string` payload field', () => {
    // Same fingerprint on the main-process source. Every hit must be
    // near a `MoonrakerPushIpcPayload` or `moonraker:push` marker.
    const lines = ipcFabSource.split('\n')
    const hitLines: number[] = []
    lines.forEach((line, idx) => {
      if (/machineId\?:\s*string/.test(line)) {
        hitLines.push(idx)
      }
    })
    expect(hitLines.length).toBe(2)
    for (const hit of hitLines) {
      // Look back up to 80 lines for a moonraker-context anchor.
      let anchored = false
      for (let i = hit; i >= Math.max(0, hit - 80); i--) {
        if (/MoonrakerPushIpcPayload|moonraker:push|moonraker\/.*push/.test(lines[i]!)) {
          anchored = true
          break
        }
      }
      expect(anchored).toBe(true)
    }
  })
})
